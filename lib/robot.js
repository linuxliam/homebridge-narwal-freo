// One long-lived MQTT session to Narwal's broker for a single robot.
//
// Events: 'status' (parseBaseStatus result), 'working' (parseWorkingStatus),
// 'map' ({ revision, rooms }), 'plans' ({ mode: { roomId: hex } }),
// 'connected', 'disconnected'.

import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';

import mqtt from 'mqtt';

import { NarwalAuthError } from './cloud.js';
import {
  BROADCAST_TOPICS, EXTRA_SUBSCRIPTIONS, easyCleanBody, forceEndBody, parseBaseStatus, parseMapResponse,
  parsePlansResponse, parseWorkingStatus, taskPayload, wakeRequests,
} from './protocol.js';
import { fieldVarint } from './proto.js';

const WAKE_INTERVAL = 5 * 60 * 1000; // the robot keeps publishing for 600 s per wake
const STALE_AFTER = 3 * 60 * 1000;
const MAP_RETRY = 2 * 60 * 1000;
const MAP_REFRESH = 6 * 60 * 60 * 1000;

export class NarwalRobot extends EventEmitter {
  /**
   * @param {object} opts
   * @param {import('./cloud.js').NarwalCloud} opts.cloud
   * @param {string} opts.deviceId
   * @param {string} opts.productId
   * @param {import('homebridge').Logging} opts.log
   */
  constructor({ cloud, deviceId, productId, log }) {
    super();
    this.cloud = cloud;
    this.deviceId = deviceId;
    this.productId = productId;
    this.log = log;
    this.prefix = `/${productId}/${deviceId}/`;
    this.client = undefined;
    this.timers = [];
    this.reconnectDelay = 5000;
    this.lastStatusAt = 0;
    this.haveRooms = false;
    this.stopped = false;
  }

  start() {
    this.stopped = false;
    this.connect();
    this.timers.push(setInterval(() => this.keepAwake(), WAKE_INTERVAL));
    this.timers.push(setInterval(() => this.checkStale(), 60 * 1000));
    this.scheduleMapRequest(15 * 1000);
  }

  stop() {
    this.stopped = true;
    this.timers.forEach(t => clearInterval(t));
    clearTimeout(this.mapTimer);
    clearTimeout(this.reconnectTimer);
    this.client?.end(true);
    this.client = undefined;
  }

  get connected() {
    return Boolean(this.client?.connected);
  }

  async connect() {
    if (this.stopped) {
      return;
    }
    let token;
    let brokerUrl;
    try {
      token = await this.cloud.ensureToken();
      brokerUrl = await this.cloud.getBrokerUrl();
    } catch (error) {
      this.log.warn(`Cannot reach Narwal cloud: ${error.message}`);
      this.scheduleReconnect();
      return;
    }
    const uuid = this.cloud.uuid;
    const client = mqtt.connect(brokerUrl, {
      protocolVersion: 5,
      clientId: `app_${uuid}_${randomUUID()}`,
      username: uuid,
      password: token,
      keepalive: 30,
      clean: true,
      reconnectPeriod: 0, // we reconnect ourselves so each attempt gets a fresh token
      connectTimeout: 15000,
      resubscribe: false,
    });
    this.client = client;

    client.on('connect', () => {
      this.reconnectDelay = 5000;
      this.log.info('Connected to Narwal MQTT broker');
      const topics = [...BROADCAST_TOPICS, ...EXTRA_SUBSCRIPTIONS].map(t => this.prefix + t);
      client.subscribe(topics, { qos: 0 }, (error) => {
        if (error) {
          this.log.warn(`MQTT subscribe failed: ${error.message}`);
          return;
        }
        this.wake();
        this.emit('connected');
      });
    });
    client.on('message', (topic, payload) => this.onMessage(topic, payload));
    client.on('error', (error) => {
      // CONNACK 134/135 = bad credentials / not authorized: renew before the next attempt
      if (error?.code === 134 || error?.code === 135 || error instanceof NarwalAuthError) {
        this.log.warn('Narwal broker rejected the session; renewing sign-in');
        this.cloud.renew().catch(e => this.log.warn(`Narwal sign-in failed: ${e.message}`));
      } else {
        this.log.debug(`MQTT error: ${error?.message ?? error}`);
      }
    });
    client.on('close', () => {
      if (this.client !== client) {
        return;
      }
      this.client = undefined;
      this.emit('disconnected');
      if (!this.stopped) {
        this.log.warn(`Narwal MQTT connection closed; reconnecting in ${Math.round(this.reconnectDelay / 1000)} s`);
        this.scheduleReconnect();
      }
    });
  }

  scheduleReconnect() {
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => this.connect(), this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 5 * 60 * 1000);
  }

  checkStale() {
    if (this.connected && Date.now() - this.lastStatusAt > STALE_AFTER) {
      this.log.debug('No robot status recently; waking it again');
      this.wake();
    }
  }

  publish(suffix, body = Buffer.alloc(0), wantsResponse = true) {
    if (!this.client?.connected) {
      throw new Error('Not connected to the Narwal cloud');
    }
    const topic = this.prefix + suffix;
    const responseTopic = suffix === 'common/notify_app_event'
      ? this.prefix + 'general/service/response'
      : (wantsResponse ? `${topic}/response` : '');
    this.client.publish(topic, taskPayload(this.cloud.uuid, responseTopic, body), { qos: 0 });
  }

  /** Same as opening the Narwal app: the robot publishes status for the next 10 minutes. */
  wake() {
    try {
      for (const [suffix, body, wantsResponse] of wakeRequests()) {
        this.publish(suffix, body, wantsResponse);
      }
    } catch (error) {
      this.log.debug(`Wake skipped: ${error.message}`);
    }
  }

  keepAwake() {
    try {
      this.publish('common/active_robot_publish', fieldVarint(1, 600), false);
      this.publish('status/app_status_heartbeat', fieldVarint(1, 1), false);
    } catch {
      // reconnect logic handles it
    }
  }

  /** Ask for the saved map and cleaning plans. The Freo only answers while the Narwal app is open. */
  requestMap() {
    try {
      this.publish('map/get_map', Buffer.from([0x08, 0x00, 0x10, 0x00]));
      this.publish('clean/plan/get');
    } catch (error) {
      this.log.debug(`Map request skipped: ${error.message}`);
    }
  }

  scheduleMapRequest(delay) {
    clearTimeout(this.mapTimer);
    this.mapTimer = setTimeout(() => {
      this.requestMap();
      this.scheduleMapRequest(this.haveRooms ? MAP_REFRESH : MAP_RETRY);
    }, delay);
  }

  onMessage(topic, payload) {
    if (!topic.startsWith(this.prefix)) {
      return;
    }
    const suffix = topic.slice(this.prefix.length);
    try {
      switch (suffix) {
        case 'status/robot_base_status':
          this.lastStatusAt = Date.now();
          this.emit('status', parseBaseStatus(payload));
          break;
        case 'status/working_status':
          this.emit('working', parseWorkingStatus(payload));
          break;
        case 'map/get_map/response': {
          const map = parseMapResponse(payload);
          if (map.rooms.length) {
            this.haveRooms = true;
            this.emit('map', map);
          }
          break;
        }
        case 'clean/plan/get/response':
          this.emit('plans', parsePlansResponse(payload));
          break;
        default:
          break;
      }
    } catch (error) {
      this.log.debug(`Could not parse ${suffix}: ${error.message}`);
    }
  }

  // ── Commands (the Freo doesn't acknowledge them; watch 'status' for the effect) ──

  startClean(roomIds, mode, templates, settings) {
    this.publish('clean/easy_clean/start', easyCleanBody(roomIds, mode, templates, settings));
  }

  pause() {
    this.publish('task/pause');
  }

  resume() {
    this.publish('task/resume');
  }

  returnToDock() {
    this.publish('supply/recall');
  }

  stopTask() {
    this.publish('task/force_end', forceEndBody());
  }
}
