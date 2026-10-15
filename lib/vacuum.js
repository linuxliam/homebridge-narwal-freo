// The Freo as a Matter RoboticVacuumCleaner (Apple Home shows it as a native vacuum).

import { lookupError } from './errors.js';
import { NarwalMode, Suction, Water, inJob, onDock } from './protocol.js';

// Matter enum values (matter.js RvcOperationalState / RvcRunMode / RvcCleanMode).
const Op = { Stopped: 0, Running: 1, Paused: 2, Error: 3, SeekingCharger: 64, Charging: 65, Docked: 66 };
const RunTag = { Idle: 16384, Cleaning: 16385 };
const CleanTag = { Auto: 0, Quick: 1, DeepClean: 16384, Vacuum: 16385, Mop: 16386 };
const ErrorState = { NoError: 0, UnableToCompleteOperation: 2 };
const ChargeState = { IsCharging: 1, IsAtFullCharge: 2, IsNotCharging: 3 };

// How long after a start the robot may take to report the job before the security hold is released.
const START_TIMEOUT = 2 * 60 * 1000;

const RUN_IDLE = 0;
const RUN_CLEANING = 1;

// matter.js's ServiceArea server requires supportedMaps; the Freo has one floor.
const MAP_ID = 1;

// Matter Common Area namespace tags (areaType), so Siri can match "vacuum the kitchen".
const AREA_TAGS = {
  balcony: 4, bathroom: 6, bedroom: 7, cloakroom: 13, closet: 14, corridor: 16, den: 20, dining: 21,
  diningroom: 21, entrance: 27, entryway: 28, entry: 28, familyroom: 29, foyer: 30, garage: 34,
  guestbedroom: 39, guestroom: 41, gym: 42, hallway: 43, hall: 43, kidsroom: 45, kitchen: 47,
  laundryroom: 49, laundry: 49, library: 51, livingroom: 52, lounge: 53, mudroom: 55, nursery: 57,
  office: 58, pantry: 61, playroom: 65, primarybathroom: 68, primarybedroom: 69, masterbedroom: 69,
  mainbedroom: 69, recreationroom: 72, staircase: 84, stairs: 84, storageroom: 86, studio: 87,
  study: 88, sunroom: 89, utilityroom: 92, toilet: 95,
};
// Narwal room type -> area tag, for rooms whose name doesn't match a tag.
const TYPE_TAGS = { 1: 69, 2: 7, 3: 52, 4: 47, 5: 88, 6: 6, 7: 21, 8: 21, 9: 4, 10: 16, 11: 13, 12: 57, 13: 72, 14: 6 };

function areaType(room) {
  const key = room.name.toLowerCase().replace(/[^a-z]/g, '');
  return AREA_TAGS[key] ?? TYPE_TAGS[room.type] ?? null;
}

/**
 * Home app clean-mode slots. Apple Home lists the modes in three groups by their Vacuum / Mop tags,
 * names each group after its first mode's label, and shows the others in its "…" menu by their
 * intensity tag (Automatic, Quick, Deep Clean). What each slot does is set in the plugin settings
 * (`cleanModes`); `mode` numbers are fixed (Matter persists the current one, see RETIRED_MODES).
 */
const SLOTS = [
  { mode: 1, key: 'vacuum', group: 'vacuum', tags: [CleanTag.Vacuum, CleanTag.Auto] },
  { mode: 5, key: 'vacuumQuick', group: 'vacuum', tags: [CleanTag.Vacuum, CleanTag.Quick] },
  { mode: 6, key: 'vacuumDeep', group: 'vacuum', tags: [CleanTag.Vacuum, CleanTag.DeepClean] },
  { mode: 2, key: 'mop', group: 'mop', tags: [CleanTag.Mop, CleanTag.Auto] },
  { mode: 7, key: 'mopQuick', group: 'mop', tags: [CleanTag.Mop, CleanTag.Quick] },
  { mode: 8, key: 'mopDeep', group: 'mop', tags: [CleanTag.Mop, CleanTag.DeepClean] },
  { mode: 0, key: 'both', group: 'both', tags: [CleanTag.Vacuum, CleanTag.Mop] },
  { mode: 9, key: 'bothQuick', group: 'both', tags: [CleanTag.Vacuum, CleanTag.Mop, CleanTag.Quick] },
  { mode: 3, key: 'bothDeep', group: 'both', tags: [CleanTag.Vacuum, CleanTag.Mop, CleanTag.DeepClean] },
  { mode: 4, key: 'bothAuto', group: 'both', tags: [CleanTag.Vacuum, CleanTag.Mop, CleanTag.Auto] },
];

/** Slot defaults; "app" means the room settings saved in the Narwal app. */
export const DEFAULT_CLEAN_MODES = {
  vacuum: { passes: 'app', suction: 'app' },
  vacuumQuick: { passes: '1', suction: 'app' },
  vacuumDeep: { passes: '2', suction: 'app' },
  mop: { passes: 'app', water: 'app' },
  mopQuick: { passes: '1', water: 'app' },
  mopDeep: { passes: '2', water: 'app' },
  both: { task: 'vacuum_and_mop', passes: 'app', suction: 'app', water: 'app' },
  bothQuick: { task: 'vacuum_and_mop', passes: '1', suction: 'app', water: 'app' },
  bothDeep: { task: 'vacuum_then_mop', passes: '2', suction: 'app', water: 'app' },
  bothAuto: { task: 'freo_mind' },
};

// Earlier `defaultCleanMode` values (named after what the slot did up to 0.2.0) -> slot keys.
const LEGACY_KEYS = {
  vacuum_quick: 'vacuumQuick', vacuum_deep: 'vacuumDeep', mop_quick: 'mopQuick', mop_deep: 'mopDeep',
  vacuum_then_mop: 'both', vacuum_mop: 'both', vacuum_then_mop_quick: 'bothQuick',
  vacuum_then_mop_deep: 'bothDeep', freo_mind: 'bothAuto',
};

export function slotKey(key) {
  return LEGACY_KEYS[key] ?? key;
}

const TASKS = {
  vacuum_and_mop: { narwal: NarwalMode.VACUUM_AND_MOP, label: 'Vacuum and Mop' },
  vacuum_then_mop: { narwal: NarwalMode.VACUUM_THEN_MOP, label: 'Vacuum then Mop' },
  freo_mind: { narwal: NarwalMode.FREO_MIND, label: 'Freo Mind' },
};
const SUCTION_LABELS = { quiet: 'quiet', standard: 'standard suction', strong: 'strong suction' };
const WATER_LABELS = { dry: 'slightly dry', standard: 'standard water', wet: 'slightly wet' };

/** The clean modes offered to the Home app, from the `cleanModes` setting. */
export function buildModes(config = {}) {
  return SLOTS.map(slot => {
    const c = { ...DEFAULT_CLEAN_MODES[slot.key], ...config[slot.key] };
    const task = slot.group === 'vacuum' ? { narwal: NarwalMode.VACUUM, label: 'Vacuum' }
      : slot.group === 'mop' ? { narwal: NarwalMode.MOP, label: 'Mop' }
        : TASKS[c.task] ?? TASKS[DEFAULT_CLEAN_MODES[slot.key].task];
    const settings = {};
    const details = [];
    if (task.narwal !== NarwalMode.FREO_MIND) {
      const passes = Number(c.passes);
      if (passes >= 1 && passes <= 3) {
        settings.passes = passes;
        details.push(`${passes} pass${passes > 1 ? 'es' : ''}`);
      }
      if (task.narwal !== NarwalMode.MOP && Suction[c.suction]) {
        settings.suction = Suction[c.suction];
        details.push(SUCTION_LABELS[c.suction]);
      }
      if (task.narwal !== NarwalMode.VACUUM && Water[c.water]) {
        settings.water = Water[c.water];
        details.push(WATER_LABELS[c.water]);
      }
    }
    return {
      mode: slot.mode,
      key: slot.key,
      label: [task.label, ...details].join(', '),
      narwal: task.narwal,
      settings,
      tags: slot.tags,
    };
  });
}

/**
 * Matter persists the current clean mode, and matter.js refuses to start the vacuum if that
 * number isn't offered any more, so never drop a mode number — reuse it. History: 0 was
 * "Vacuum & Mop" (Narwal 4) up to 0.1.6; 3 was "Vacuum then Mop" (app settings) in 0.1.4–0.1.7.
 * Since 0.3.0 the numbers are fixed slots whose meaning is set in `cleanModes`.
 * Saved plugin choices that changed meaning map here.
 */
const RETIRED_MODES = {};

export class NarwalVacuum {
  /**
   * @param {object} opts
   * @param {import('homebridge').API} opts.api
   * @param {import('homebridge').Logging} opts.log
   * @param {import('./robot.js').NarwalRobot} opts.robot
   * @param {object} opts.device Narwal device record
   * @param {string} opts.name
   * @param {object} opts.store persisted state (rooms, plans, cleanMode, selectedAreas)
   * @param {() => void} opts.save persist `store`
   * @param {import('./security-hold.js').SecurityHold} [opts.security] switch ecobee Away to Stay while cleaning
   * @param {object} [opts.cleanModes] the `cleanModes` setting (see buildModes)
   */
  constructor({ api, log, robot, device, name, store, save, security, cleanModes }) {
    if (store.cleanMode in RETIRED_MODES) {
      store.cleanMode = RETIRED_MODES[store.cleanMode];
    }
    this.api = api;
    this.matter = api.matter;
    this.log = log;
    this.robot = robot;
    this.store = store;
    this.save = save;
    this.modeList = buildModes(cleanModes);
    this.ready = false;
    this.status = undefined;
    this.fault = undefined;
    this.uuid = this.matter.uuid.generate(`narwal-${device.deviceId}`);
    this.name = name;
    this.device = device;
    this.opState = Op.Docked;
    this.security = security;
    // Whether the security system was checked (and held, if Away) for the current outing.
    this.securityChecked = false;
  }

  stop() {
    clearTimeout(this.releaseTimer);
  }

  get rooms() {
    return this.store.rooms ?? [];
  }

  /** Modes offered to the Home app (always all of them: see RETIRED_MODES). */
  get modes() {
    return this.modeList;
  }

  get cleanMode() {
    return this.modes.find(m => m.mode === this.store.cleanMode) ?? this.modes[0];
  }

  supportedAreas() {
    return this.rooms.map(room => ({
      areaId: room.id,
      mapId: MAP_ID,
      areaInfo: {
        locationInfo: { locationName: room.name, floorNumber: 0, areaType: areaType(room) },
        landmarkInfo: null,
      },
    }));
  }

  /** The accessory definition handed to api.matter.registerPlatformAccessories. */
  accessory() {
    const status = this.matter.status;
    return {
      UUID: this.uuid,
      displayName: this.name,
      deviceType: this.matter.deviceTypes.RoboticVacuumCleaner,
      serialNumber: this.device.snNumber ?? this.device.deviceId,
      manufacturer: 'Narwal',
      model: this.device.robotName ?? 'Freo',
      firmwareRevision: this.device.firmwareVersion ?? '1.0.0',
      context: { deviceId: this.device.deviceId },
      clusters: {
        powerSource: {
          status: 1,
          order: 0,
          description: 'Battery',
          batPercentRemaining: (this.status?.battery ?? 100) * 2,
          batChargeLevel: 0,
          batReplaceability: 1,
          batChargeState: ChargeState.IsAtFullCharge,
        },
        rvcRunMode: {
          supportedModes: [
            { label: 'Idle', mode: RUN_IDLE, modeTags: [{ value: RunTag.Idle }] },
            { label: 'Cleaning', mode: RUN_CLEANING, modeTags: [{ value: RunTag.Cleaning }] },
          ],
          currentMode: RUN_IDLE,
        },
        rvcCleanMode: {
          supportedModes: this.modes.map(m => ({ label: m.label, mode: m.mode, modeTags: m.tags.map(value => ({ value })) })),
          currentMode: this.cleanMode.mode,
        },
        rvcOperationalState: {
          operationalStateList: Object.values(Op).map(id => ({ operationalStateId: id })),
          operationalState: Op.Docked,
          operationalError: { errorStateId: ErrorState.NoError },
        },
        serviceArea: {
          supportedMaps: [{ mapId: MAP_ID, name: 'Home' }],
          supportedAreas: this.supportedAreas(),
          selectedAreas: this.validSelection(this.store.selectedAreas),
          currentArea: null,
        },
      },
      handlers: this.logged({
        rvcRunMode: {
          changeToMode: async ({ newMode }) => {
            if (newMode === RUN_CLEANING) {
              await this.start();
            } else if (newMode === RUN_IDLE) {
              await this.goHome();
            } else {
              throw new status.InvalidCommand(`Unknown run mode ${newMode}`);
            }
          },
        },
        rvcCleanMode: {
          changeToMode: async ({ newMode }) => {
            const mode = this.modes.find(m => m.mode === newMode);
            if (!mode) {
              throw new status.InvalidCommand(`Unknown clean mode ${newMode}`);
            }
            this.store.cleanMode = mode.mode;
            this.save();
            this.log.info(`Clean mode set to ${mode.label}`);
          },
        },
        identify: {
          // The Home app's "Play Sound to Locate".
          identify: async () => {
            this.ensureConnected();
            this.log.info('Playing the locate sound');
            this.robot.locate();
          },
        },
        rvcOperationalState: {
          pause: async () => this.pause(),
          resume: async () => this.resume(),
          goHome: async () => this.goHome(),
        },
        serviceArea: {
          selectAreas: async ({ newAreas }) => {
            const known = new Set(this.rooms.map(r => r.id));
            const bad = newAreas.filter(id => !known.has(id));
            if (bad.length) {
              throw new status.NotFound(`Unknown room ${bad.join(', ')}`);
            }
            this.store.selectedAreas = [...newAreas];
            this.save();
            const names = newAreas.map(id => this.rooms.find(r => r.id === id)?.name).join(', ');
            this.log.info(`Rooms selected: ${names || 'all'}`);
          },
          skipArea: async ({ skippedArea }) => {
            this.store.selectedAreas = (this.store.selectedAreas ?? []).filter(id => id !== skippedArea);
            this.save();
          },
        },
      }),
    };
  }

  /** Wrap every Home app command handler so each call, and any refusal, shows in the log. */
  logged(handlers) {
    return Object.fromEntries(Object.entries(handlers).map(([cluster, methods]) => [cluster,
      Object.fromEntries(Object.entries(methods).map(([name, fn]) => [name, async (request, ...rest) => {
        const args = request && Object.keys(request).length ? ` ${JSON.stringify(request)}` : '';
        this.log.debug(`Home app: ${cluster}.${name}${args} (state ${this.opState})`);
        try {
          return await fn(request, ...rest);
        } catch (error) {
          this.log.warn(`Home app ${cluster}.${name}${args} refused: ${error.message}`);
          throw error;
        }
      }]))]));
  }

  validSelection(ids) {
    const known = new Set(this.rooms.map(r => r.id));
    return (ids ?? []).filter(id => known.has(id));
  }

  setReady() {
    this.ready = true;
    const s = this.status;
    if (s) {
      // Statuses that arrived before publishing weren't sent; push this one in full.
      this.status = undefined;
      this.opState = undefined;
      this.applyStatus(s);
    }
  }

  async update(cluster, attributes) {
    if (!this.ready) {
      return;
    }
    try {
      await this.matter.updateAccessoryState(this.uuid, cluster, attributes);
    } catch (error) {
      this.log.warn(`Matter update of ${cluster} failed: ${error.message}`);
      return false;
    }
    return true;
  }

  // ── Commands from the Home app ──

  ensureConnected() {
    if (!this.robot.connected) {
      throw new this.matter.status.Busy('Not connected to the Narwal cloud yet');
    }
  }

  /** The robot is inside a vacuum/mop task (running, paused, or halted by an error). */
  inTask() {
    const s = this.status;
    return inJob(s) && !s.returning;
  }

  /** A task the robot is holding that `resume` would continue (paused, or stopped by an error). */
  canResume() {
    return this.opState === Op.Paused || (this.inTask() && (this.status.paused || this.opState === Op.Error));
  }

  async start() {
    this.ensureConnected();
    if (this.canResume()) {
      return this.resume();
    }
    if (!this.rooms.length) {
      throw new this.matter.status.InvalidInState(
        'The room list has not loaded yet. Open the Narwal app on the Freo\'s map for a minute, then try again.');
    }
    const selected = this.validSelection(this.store.selectedAreas);
    const roomIds = selected.length ? selected : this.rooms.map(r => r.id);
    const mode = this.cleanMode;
    const templates = Object.fromEntries(
      Object.entries(this.store.plans?.[mode.narwal] ?? {}).map(([id, hex]) => [id, Buffer.from(hex, 'hex')]));
    if (mode.narwal === NarwalMode.FREO_MIND && roomIds.some(id => !templates[id])) {
      throw new this.matter.status.InvalidInState(
        'Freo Mind needs the room plans from the Narwal app. Open the app on the Freo\'s map for a minute, then try again.');
    }
    const missing = roomIds.filter(id => !templates[id]);
    if (missing.length) {
      this.log.info(`No Narwal app settings for this task in ${missing.map(id => this.rooms.find(r => r.id === id)?.name ?? id)
        .join(', ')} yet; using standard suction and water (opening the Narwal app on the map sends them).`);
    }
    await this.holdSecurity();
    const names = roomIds.map(id => this.rooms.find(r => r.id === id)?.name ?? id).join(', ');
    this.log.info(`Starting ${mode.label}: ${names}`);
    this.robot.startClean(roomIds, mode.narwal, templates, mode.settings);
    await this.setOpState(Op.Running);
    await this.update('rvcRunMode', { currentMode: RUN_CLEANING });
  }

  async pause() {
    this.ensureConnected();
    if (this.opState !== Op.Running && this.opState !== Op.SeekingCharger) {
      throw new this.matter.status.InvalidInState('The robot is not cleaning');
    }
    this.log.info('Pausing');
    this.robot.pause();
    await this.setOpState(Op.Paused);
  }

  async resume() {
    this.ensureConnected();
    if (!this.canResume()) {
      throw new this.matter.status.InvalidInState('The robot has no paused task to resume');
    }
    await this.holdSecurity();
    this.log.info('Resuming');
    this.robot.resume();
    await this.setOpState(Op.Running);
    await this.update('rvcRunMode', { currentMode: RUN_CLEANING });
  }

  async goHome() {
    this.ensureConnected();
    if (this.opState === Op.Docked || this.opState === Op.Charging) {
      return;
    }
    this.log.info('Returning to dock');
    this.robot.returnToDock();
    await this.setOpState(Op.SeekingCharger);
    await this.update('rvcRunMode', { currentMode: RUN_IDLE });
  }

  // ── Security hold (ecobee Away -> Stay while the robot is out) ──

  /**
   * Before the robot moves: if the security system is armed Away, have it switched to Stay so
   * the motion sensors don't set it off. Refuses the command when that can't be done, because
   * cleaning under Away means a false alarm (and a monitoring call).
   */
  async holdSecurity() {
    if (!this.security) {
      return;
    }
    clearTimeout(this.releaseTimer);
    let result;
    try {
      result = await this.security.hold();
    } catch (error) {
      this.log.error(`Not cleaning: could not check the security system (${error.message}).`);
      throw new this.matter.status.Busy(`Security system unreachable: ${error.message}`.slice(0, 64));
    }
    if (!result.ok) {
      this.log.warn(`Not cleaning: ${result.reason ?? 'the security system said no'}.`);
      throw new this.matter.status.InvalidInState(`Security system: ${result.reason ?? 'not safe to clean'}`);
    }
    this.securityChecked = true;
    this.heldAt = Date.now();
    this.jobSeen = inJob(this.status);
    if (result.held && !this.store.securityHeld) {
      this.log.info('Security system switched from Away to Stay while cleaning.');
      this.store.securityHeld = true;
      this.save();
    }
  }

  /**
   * Follow cleaning jobs for the security hold: check when a job starts (also one started from the
   * Narwal app), release when it ends. The robot reports the job through its dock visits.
   */
  securityFollow(active) {
    if (!this.security) {
      return;
    }
    if (active) {
      this.jobSeen = true;
      if (!this.securityChecked && !this.checking) {
        // Started from the Narwal app or its schedule: switch now, a little late.
        this.log.warn('Cleaning started outside the Home app; checking the security system now.');
        this.checking = true;
        this.holdSecurity().catch(() => {}).finally(() => { this.checking = false; });
      }
      return;
    }
    if (!this.securityChecked && !this.store.securityHeld) {
      return;
    }
    // Right after a start the robot still reports idle for a moment; release only once the job has
    // been seen, or if it never got going.
    if (!this.jobSeen && Date.now() - (this.heldAt ?? 0) < START_TIMEOUT) {
      return;
    }
    if (!this.releasing && !this.releaseTimer) {
      this.releaseSecurity();
    }
  }

  async releaseSecurity() {
    this.releaseTimer = undefined;
    if (inJob(this.status)) {
      return;
    }
    this.securityChecked = false;
    this.jobSeen = false;
    if (!this.store.securityHeld) {
      return;
    }
    this.releasing = true;
    try {
      const result = await this.security.release();
      this.store.securityHeld = false;
      this.save();
      this.log.info(result.released ? 'Cleaning finished: security system set to Away again.'
        : `Cleaning finished: security system left as it is (${result.state ?? 'changed while cleaning, or still held for another robot'}).`);
    } catch (error) {
      this.log.warn(`Could not set the security system back to Away (${error.message}); retrying in 2 min.`);
      this.releaseTimer = setTimeout(() => this.releaseSecurity(), 2 * 60 * 1000);
    } finally {
      this.releasing = false;
    }
  }

  async setOpState(state, fromCommand = true) {
    this.opState = state;
    if (fromCommand) {
      // The robot keeps reporting its old state for a second or two after a command.
      this.commandGraceUntil = Date.now() + 8000;
    }
    await this.update('rvcOperationalState', { operationalState: state });
  }

  // ── State from the robot ──

  async applyStatus(s) {
    this.lastStatusAt = Date.now();
    await this.setError(s.code);
    await this.refresh(s);
  }

  async refresh(s) {
    const previous = this.status;
    this.status = s;
    let op;
    if (this.fault) {
      op = Op.Error;
    } else if (onDock(s)) {
      op = s.battery !== undefined && s.battery < 100 ? Op.Charging : Op.Docked;
    } else if (s.returning) {
      op = Op.SeekingCharger;
    } else if (s.paused) {
      op = Op.Paused;
    } else if (!inJob(s)) {
      op = Op.Stopped;
    } else {
      op = Op.Running;
    }
    const inGrace = Date.now() < (this.commandGraceUntil ?? 0);
    if ((op !== this.opState || !previous) && !inGrace) {
      this.log.debug(`Robot state ${s.state}${s.paused ? ' paused' : ''}${s.returning ? ' returning' : ''} -> Matter ${op}`);
      await this.setOpState(op, false);
      const cleaning = op === Op.Running || op === Op.Paused;
      await this.update('rvcRunMode', { currentMode: cleaning ? RUN_CLEANING : RUN_IDLE });
      if (!cleaning) {
        await this.update('serviceArea', { currentArea: null });
      }
    }
    if (s.battery !== undefined && s.battery !== previous?.battery || op !== previous?.op) {
      const level = s.battery ?? 100;
      const sent = await this.update('powerSource', {
        batPercentRemaining: level * 2,
        batChargeLevel: level < 15 ? 2 : level < 30 ? 1 : 0,
        batChargeState: op === Op.Charging ? ChargeState.IsCharging
          : op === Op.Docked ? ChargeState.IsAtFullCharge : ChargeState.IsNotCharging,
      });
      if (sent) {
        await this.checkBattery(level, !previous);
      }
    }
    this.status.op = op;
    // From the raw state, so an error during a job doesn't end it.
    const active = inJob(s);
    this.securityFollow(active);
    this.onJob?.(active);
  }

  /** Read the battery back from Matter, so a dropped update shows in the log. */
  async checkBattery(level, first) {
    try {
      const state = await this.matter.getAccessoryState(this.uuid, 'powerSource');
      const reported = state?.batPercentRemaining;
      if (reported !== undefined && reported !== level * 2) {
        this.log.warn(`Battery: sent ${level}% but the vacuum reports ${reported / 2}%`);
      } else if (first) {
        this.log.info(`Battery ${level}%`);
      }
    } catch (error) {
      this.log.debug(`Could not read the battery back: ${error.message}`);
    }
  }

  async applyWorking(w) {
    if ((this.opState === Op.Running || this.opState === Op.Paused) && w.roomId
      && this.rooms.some(r => r.id === w.roomId)) {
      await this.update('serviceArea', { currentArea: w.roomId });
    }
  }

  /**
   * Set the current Narwal error code (undefined = none). Codes missing from Narwal's error
   * table are routine notices and don't count. Returns true when the error state changed.
   */
  async setError(code) {
    const err = code ? lookupError(code) : undefined;
    const hex = code ? `0x${Number(code).toString(16).toUpperCase().padStart(8, '0')}` : '';
    if (code && !err && this.lastNotice !== code) {
      this.log.debug(`Narwal notice ${hex} (not an error)`);
    }
    this.lastNotice = code;
    if ((err ? code : undefined) === this.fault?.code) {
      return false;
    }
    this.fault = err ? { code, ...err } : undefined;
    if (err) {
      this.log.warn(`Narwal error ${hex}: ${err.message}`);
      this.opState = Op.Error;
      this.commandGraceUntil = 0;
      await this.update('rvcOperationalState', {
        operationalState: Op.Error,
        // Matter limits the details string to 64 characters.
        operationalError: { errorStateId: err.matter, errorStateDetails: err.message.slice(0, 64) },
      });
    } else {
      this.log.info('Narwal error cleared');
      this.opState = undefined; // re-evaluate from the next status
      await this.update('rvcOperationalState', { operationalError: { errorStateId: ErrorState.NoError } });
    }
    return true;
  }

  /** Cloud work status: only a backup for when live robot status isn't arriving. */
  async applyFault(workStatus) {
    if (Date.now() - (this.lastStatusAt ?? 0) < 2 * 60 * 1000) {
      return;
    }
    const changed = await this.setError(workStatus?.fault ? workStatus.fault_code : undefined);
    if (changed && !this.fault && this.status) {
      await this.refresh(this.status);
    }
  }

  /** New rooms from the map: update the Home app's room list if it changed. */
  async applyRooms() {
    await this.update('serviceArea', {
      supportedAreas: this.supportedAreas(),
      selectedAreas: this.validSelection(this.store.selectedAreas),
    });
  }
}
