import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { NarwalCloud } from './cloud.js';
import { NarwalRobot } from './robot.js';
import { SecurityHold } from './security-hold.js';
import { FreoSensors } from './sensors.js';
import { NarwalVacuum, buildModes, slotKey } from './vacuum.js';

export const PLUGIN_NAME = 'homebridge-narwal-freo';
export const PLATFORM_NAME = 'NarwalPlatform';

const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

const FAULT_POLL = 3 * 60 * 1000;

export class NarwalPlatform {
  /**
   * @param {import('homebridge').Logging} log
   * @param {import('homebridge').PlatformConfig} config
   * @param {import('homebridge').API} api
   */
  constructor(log, config, api) {
    this.log = log;
    this.config = config ?? {};
    this.api = api;
    this.cached = [];

    if (!this.config.email || !this.config.password) {
      log.error('Set your Narwal account email and password in the plugin settings.');
      return;
    }
    if (!api.isMatterEnabled?.() || !api.matter) {
      log.error('Matter is not enabled for this bridge. The Freo needs Matter to appear as a robot vacuum: '
        + 'enable Matter for this child bridge (externals only is enough) and restart.');
      return;
    }

    const dir = join(api.user.storagePath(), 'narwal');
    mkdirSync(dir, { recursive: true });
    this.storePath = join(dir, 'state.json');
    this.store = this.load();

    this.cloud = new NarwalCloud({
      email: this.config.email,
      password: this.config.password,
      region: this.config.region ?? 'us',
      tokens: this.store.tokens ?? {},
      onTokens: (tokens) => {
        this.store.tokens = tokens;
        this.save();
      },
      log,
    });

    api.on('didFinishLaunching', () => {
      this.launch().catch(error => log.error(`Startup failed: ${error.message}`));
    });
    api.on('shutdown', () => {
      clearInterval(this.faultTimer);
      this.sensors?.stop();
      this.vacuum?.stop();
      this.robot?.stop();
    });
  }

  /** Called for cached Matter accessories; we re-register the vacuum on every start. */
  configureMatterAccessory() {}

  /** @param {import('homebridge').PlatformAccessory} accessory */
  configureAccessory(accessory) {
    this.cached.push(accessory);
  }

  load() {
    try {
      return JSON.parse(readFileSync(this.storePath, 'utf8'));
    } catch {
      return {};
    }
  }

  save() {
    try {
      writeFileSync(this.storePath, JSON.stringify(this.store, null, 2), { mode: 0o600 });
      chmodSync(this.storePath, 0o600);
    } catch (error) {
      this.log.warn(`Could not save plugin state: ${error.message}`);
    }
  }

  async launch() {
    const device = await this.findDevice();
    if (!device) {
      return;
    }
    this.log.info(`Found ${device.robotName ?? 'robot'} (firmware ${device.firmwareVersion ?? '?'})`);

    if (this.store.deviceId !== device.deviceId) {
      // A different robot: forget rooms and plans from the old one.
      this.store = { tokens: this.store.tokens, deviceId: device.deviceId };
    }
    if (this.store.cleanMode === undefined) {
      const modes = buildModes();
      const key = slotKey(this.config.defaultCleanMode ?? 'both');
      this.store.cleanMode = (modes.find(m => m.key === key) ?? modes.find(m => m.key === 'both')).mode;
    }
    this.save();

    this.robot = new NarwalRobot({
      cloud: this.cloud,
      deviceId: device.deviceId,
      productId: device.productId,
      log: this.log,
    });
    this.vacuum = new NarwalVacuum({
      api: this.api,
      log: this.log,
      robot: this.robot,
      device,
      name: this.config.name || device.robotName || 'Freo',
      store: this.store,
      save: () => this.save(),
      security: this.config.securityHold
        ? new SecurityHold({
          socketPath: join(this.api.user.storagePath(), 'ecobee-security', 'control.sock'),
          by: this.config.name || device.robotName || 'Freo',
        })
        : undefined,
      cleanModes: this.config.cleanModes,
    });
    this.setupSensors(device);

    this.robot.on('status', s => this.vacuum.applyStatus(s));
    this.robot.on('working', w => this.vacuum.applyWorking(w));
    this.robot.on('plans', plans => {
      this.store.plans = plans;
      this.save();
      this.log.debug(`Cleaning plans updated for modes ${Object.keys(plans).join(', ')}`);
    });
    this.robot.on('map', map => this.onMap(map));
    this.robot.start();
    this.sensors?.start();

    if (this.store.rooms?.length) {
      await this.register();
    } else {
      this.log.warn('Waiting for the Freo\'s room list. Open the Narwal app on the Freo\'s map for a minute '
        + 'so the robot sends it; the vacuum appears in Homebridge once the rooms arrive.');
    }

    this.faultTimer = setInterval(() => this.pollFault(device), FAULT_POLL);
  }

  /** The optional HAP accessory: Cleaning occupancy sensor and consumables. */
  setupSensors(device) {
    const cleaning = Boolean(this.config.cleaningSensor);
    const consumables = Boolean(this.config.consumables);
    const uuid = this.api.hap.uuid.generate(`narwal-sensors-${device.deviceId}`);
    const cached = this.cached.find(a => a.UUID === uuid);
    const stale = this.cached.filter(a => a.UUID !== uuid || (!cleaning && !consumables));
    if (stale.length) {
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, stale);
    }
    if (!cleaning && !consumables) {
      return;
    }
    const base = this.config.name || device.robotName || 'Freo';
    let accessory = cached;
    if (!accessory) {
      accessory = new this.api.platformAccessory(`${base} ${cleaning ? 'Cleaning' : 'Maintenance'}`, uuid);
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    }
    this.sensors = new FreoSensors({
      api: this.api,
      log: this.log,
      accessory,
      device,
      cloud: this.cloud,
      cleaning,
      consumables,
      replaceAt: Math.min(100, Math.max(0, Number(this.config.replaceAtPercent ?? 10))),
      version: VERSION,
    });
    if (cleaning) {
      this.vacuum.onJob = active => this.sensors.follow(active);
    }
  }

  async findDevice() {
    const devices = await this.cloud.getDevices();
    if (!devices.length) {
      this.log.error('No robots found on this Narwal account.');
      return undefined;
    }
    const wanted = this.config.serialNumber;
    const device = wanted ? devices.find(d => d.snNumber === wanted || d.deviceId === wanted) : devices[0];
    if (!device) {
      this.log.error(`No robot with serial number ${wanted} on this Narwal account.`);
      return undefined;
    }
    if (!wanted && devices.length > 1) {
      this.log.warn(`Several robots on this account; using ${device.robotName} (${device.snNumber}). `
        + 'Set "serialNumber" in the plugin settings to pick another.');
    }
    return device;
  }

  async onMap(map) {
    const before = JSON.stringify(this.store.rooms ?? []);
    this.store.rooms = map.rooms;
    this.store.mapRevision = map.revision;
    this.save();
    if (JSON.stringify(map.rooms) === before) {
      return;
    }
    this.log.info(`Rooms: ${map.rooms.map(r => r.name).join(', ')}`);
    if (this.registered) {
      await this.vacuum.applyRooms();
    } else {
      await this.register();
    }
  }

  async register() {
    if (this.registered || this.registering) {
      return;
    }
    this.registering = true;
    try {
      await this.api.matter.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [this.vacuum.accessory()]);
      // registerPlatformAccessories resolves even when publishing failed; check the endpoint exists.
      const state = await this.api.matter.getAccessoryState(this.vacuum.uuid, 'rvcOperationalState');
      if (!state) {
        this.log.error('Homebridge could not publish the Matter vacuum; see the Matter errors above.');
        return;
      }
      this.registered = true;
      this.vacuum.setReady();
      this.log.info(`${this.vacuum.name} is published as a Matter robot vacuum. If it isn't in the Home app yet, `
        + 'add it with the pairing code shown above (Home app > + > Add Accessory).');
    } catch (error) {
      this.log.error(`Could not publish the Matter vacuum: ${error.message}`);
    } finally {
      this.registering = false;
    }
  }

  async pollFault(device) {
    try {
      const work = await this.cloud.getWorkStatus(device.deviceId, device.productId);
      await this.vacuum.applyFault(work);
    } catch (error) {
      this.log.debug(`Work status poll failed: ${error.message}`);
    }
  }
}
