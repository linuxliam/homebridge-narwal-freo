// One long-lived MQTT session to Narwal's broker for a single robot.
//
// Events: 'status' (parseBaseStatus result), 'working' (parseWorkingStatus),
// 'report' (parseCleanReport result), 'map' ({ mapId, rooms }: the main map's rooms), 'plans' ({ mode: { roomId: hex } }),
// 'connected', 'disconnected'.

import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';

import mqtt from 'mqtt';

import { NarwalAuthError } from './cloud.js';
import {
  BROADCAST_TOPICS, EXTRA_SUBSCRIPTIONS, correlationId, easyCleanBody, forceEndBody, parseBaseStatus, parseCleanReport,
  parseCommandResult, parseCurrentMapId, parseDisplayMap, parsePlansResponse, parseReducedMaps, parseWorkingStatus, pickMainMap,
  requestProperties, resetConsumableBody, taskPayload, wakeRequests,
} from './protocol.js';
import { fieldVarint } from './proto.js';

const WAKE_INTERVAL = 5 * 60 * 1000; // the robot keeps publishing for 600 s per wake
const STALE_AFTER = 3 * 60 * 1000;
const MAP_RETRY = 2 * 60 * 1000;
const MAP_REFRESH = 6 * 60 * 60 * 1000;
const ACK_TIMEOUT = 5000;
const MAP_REQUEST = Buffer.from([0x08, 0x00, 0x10, 0x00]); // get_map: the current map

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
    this.mainMapId = undefined;
    this.mapCount = 0;
    this.currentMapId = undefined;
    this.noMainWarned = false;
    this.pending = new Map(); // command topic suffix -> [{ id, name, timer }] waiting for a reply
    this.stopped = false;
  }

  start() {
    this.stopped = false;
    this.connect();
    this.timers.push(setInterval(() => this.keepAwake(), WAKE_INTERVAL));
    this.timers.push(setInterval(() => this.checkStale(), 60 * 1000));
  }

  stop() {
    this.stopped = true;
    this.timers.forEach(t => clearInterval(t));
    clearTimeout(this.mapTimer);
    clearTimeout(this.reconnectTimer);
    this.clearPending();
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
        this.scheduleMapRequest(3000);
        this.emit('connected');
      });
    });
    client.on('message', (topic, payload, packet) => this.onMessage(topic, payload, packet));
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
      this.clearPending();
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

  /**
   * Publish like the Narwal app does: a request that wants a reply carries MQTT 5 Response Topic and
   * Correlation Data (the Freo ignores it otherwise), with the same request id in the payload header.
   * Returns the request id.
   */
  publish(suffix, body = Buffer.alloc(0), wantsResponse = true) {
    if (!this.client?.connected) {
      throw new Error('Not connected to the Narwal cloud');
    }
    const topic = this.prefix + suffix;
    const responseTopic = suffix === 'common/notify_app_event'
      ? this.prefix + 'general/service/response'
      : (wantsResponse ? `${topic}/response` : '');
    const id = randomUUID();
    const properties = responseTopic ? requestProperties(responseTopic, id) : undefined;
    this.client.publish(topic, taskPayload(this.cloud.uuid, responseTopic, body, id), { qos: 0, properties });
    return id;
  }

  /** Publish a command and watch for the robot's reply; a refusal or silence is logged as a warning. */
  command(suffix, name, body = Buffer.alloc(0)) {
    const id = this.publish(suffix, body);
    const entry = { id, name };
    entry.timer = setTimeout(() => {
      this.settle(suffix, entry);
      this.log.warn(`The Freo did not answer ${name} within ${ACK_TIMEOUT / 1000} s`);
    }, ACK_TIMEOUT);
    this.pending.set(suffix, [...(this.pending.get(suffix) ?? []), entry]);
  }

  settle(suffix, entry) {
    clearTimeout(entry.timer);
    const left = (this.pending.get(suffix) ?? []).filter(e => e !== entry);
    if (left.length) {
      this.pending.set(suffix, left);
    } else {
      this.pending.delete(suffix);
    }
  }

  clearPending() {
    this.pending.forEach(list => list.forEach(e => clearTimeout(e.timer)));
    this.pending.clear();
  }

  /**
   * A reply on a command's response topic. The topic is shared with the Narwal app, so a reply whose
   * correlation data names another request is not ours; one without correlation data goes to our oldest
   * waiting command on that topic.
   */
  onCommandReply(suffix, payload, packet) {
    const list = this.pending.get(suffix);
    if (!list?.length) {
      return;
    }
    const id = packet?.properties?.correlationData ? correlationId(packet.properties.correlationData) : undefined;
    const entry = id ? list.find(e => e.id === id) : list[0];
    if (!entry) {
      return;
    }
    this.settle(suffix, entry);
    let result;
    try {
      result = parseCommandResult(payload);
    } catch (error) {
      this.log.debug(`Could not read the reply to ${entry.name}: ${error.message}`);
      return;
    }
    if (result === 1) {
      this.log.debug(`The Freo accepted ${entry.name}`);
    } else {
      this.log.warn(`The Freo did not accept ${entry.name} (reply ${result ?? 'empty'})`);
    }
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

  /**
   * Ask for the saved maps (rooms) and which map is current. The cleaning plans follow once the current
   * map is known to be the main one: the plans reply doesn't say which map it belongs to.
   */
  requestMap() {
    this.plansDue = true;
    try {
      this.publish('map/get_all_reduced_maps');
      this.publish('map/get_map', MAP_REQUEST);
    } catch (error) {
      this.log.debug(`Map request skipped: ${error.message}`);
    }
  }

  requestPlans() {
    this.plansDue = false;
    try {
      this.publish('clean/plan/get');
    } catch (error) {
      this.log.debug(`Plans request skipped: ${error.message}`);
    }
  }

  /** The current map is the one the plugin publishes (or there is only one map). */
  onMainMap() {
    return this.mainMapId !== undefined && (this.mapCount === 1 || this.currentMapId === this.mainMapId);
  }

  scheduleMapRequest(delay) {
    clearTimeout(this.mapTimer);
    this.mapTimer = setTimeout(() => {
      this.requestMap();
      this.scheduleMapRequest(this.haveRooms ? MAP_REFRESH : MAP_RETRY);
    }, delay);
  }

  onReducedMaps(maps) {
    this.mapCount = maps.length;
    const main = pickMainMap(maps);
    if (!main) {
      if (!this.noMainWarned) {
        this.noMainWarned = true;
        this.log.warn('The Freo has no saved map with a base station, so there are no rooms to publish.');
      }
      return;
    }
    this.noMainWarned = false;
    this.mainMapId = main.id;
    this.log.debug(`Maps on the robot: ${maps.map(m => `${m.id}${m.name ? ` "${m.name}"` : ''}${m.id === main.id ? ' (main)' : ''}`).join(', ')}`);
    if (main.rooms.length) {
      this.haveRooms = true;
      this.emit('map', { mapId: main.id, rooms: main.rooms });
    }
    this.maybeRequestPlans();
  }

  onCurrentMap(mapId) {
    if (mapId === undefined || mapId === this.currentMapId) {
      return;
    }
    const changed = this.currentMapId !== undefined;
    this.currentMapId = mapId;
    this.log.debug(`Current map on the robot: ${mapId}`);
    if (changed) {
      // The map changed (carried upstairs, switched in the Narwal app): refresh the list; plans only count on the main map.
      this.requestMap();
    }
    this.maybeRequestPlans();
  }

  maybeRequestPlans() {
    if (this.plansDue && this.onMainMap()) {
      this.requestPlans();
    }
  }

  onMessage(topic, payload, packet) {
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
        case 'map/display_map': {
          const pose = parseDisplayMap(payload);
          if (pose) {
            this.emit('pose', pose);
          }
          break;
        }
        case 'report/clean_report':
          this.emit('report', parseCleanReport(payload));
          break;
        case 'map/get_all_reduced_maps/response':
          this.onReducedMaps(parseReducedMaps(payload));
          break;
        case 'map/get_map/response':
          // Replies go to every client, the Narwal app's included: only learn which map is current from it.
          this.onCurrentMap(parseCurrentMapId(payload));
          break;
        case 'clean/plan/get/response':
          if (this.onMainMap()) {
            this.emit('plans', parsePlansResponse(payload));
          } else {
            this.log.debug('Ignoring cleaning plans: the robot\'s current map is not the main map');
          }
          break;
        default:
          if (suffix.endsWith('/response') && this.pending.has(suffix.slice(0, -'/response'.length))) {
            this.onCommandReply(suffix.slice(0, -'/response'.length), payload, packet);
          }
          break;
      }
    } catch (error) {
      this.log.debug(`Could not parse ${suffix}: ${error.message}`);
    }
  }

  // ── Commands (the reply is only checked and logged; watch 'status' for the effect) ──

  startClean(roomIds, mode, templates, settings) {
    this.command('clean/easy_clean/start', 'the clean', easyCleanBody(roomIds, mode, templates, settings));
  }

  pause() {
    this.command('task/pause', 'pause');
  }

  resume() {
    this.command('task/resume', 'resume');
  }

  returnToDock() {
    this.command('supply/recall', 'return to dock');
  }

  stopTask() {
    this.command('task/force_end', 'stop', forceEndBody());
  }

  /** "Locate robot" in the Narwal app: the robot plays a sound. */
  locate() {
    this.command('common/yell', 'locate');
  }

  /** Reset a consumable's usage counter after replacing it. */
  resetConsumable(type) {
    this.command('consumable/reset_consumable_info', 'the consumable reset', resetConsumableBody(type));
  }
}
