// The Freo as a Matter RoboticVacuumCleaner (Apple Home shows it as a native vacuum).

import { lookupError } from './errors.js';
import { NarwalMode, WorkState } from './protocol.js';

// Matter enum values (matter.js RvcOperationalState / RvcRunMode / RvcCleanMode).
const Op = { Stopped: 0, Running: 1, Paused: 2, Error: 3, SeekingCharger: 64, Charging: 65, Docked: 66 };
const RunTag = { Idle: 16384, Cleaning: 16385 };
const CleanTag = { Auto: 0, Quick: 1, DeepClean: 16384, Vacuum: 16385, Mop: 16386 };
const ErrorState = { NoError: 0, UnableToCompleteOperation: 2 };
const ChargeState = { IsCharging: 1, IsAtFullCharge: 2, IsNotCharging: 3 };

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
 * Home app clean modes -> Narwal easy_clean modes. `mode` numbers are stable (saved in state.json).
 * Apple Home only lists Vacuum / Mop / Both and labels the modes inside a group by an
 * intensity tag (Automatic, Quick, Deep Clean) in its "…" menu:
 *   Vacuum / Mop: Automatic = the Narwal app's settings, Quick = 1 pass, Deep Clean = 2 passes
 *   Vacuum then Mop: button = the Narwal app's settings, Quick = 1 pass each,
 *   Deep Clean = 2 passes each, Automatic = Freo Mind
 * The Home app names each group after its first mode's label. `passes` overrides only the
 * pass count; suction and water level still come from the app. Narwal mode 4 ("vacuum and
 * mop") isn't offered: the original Freo's app doesn't have it and the robot mops first.
 */
export const CLEAN_MODES = [
  { mode: 1, key: 'vacuum', label: 'Vacuum', narwal: NarwalMode.VACUUM, tags: [CleanTag.Vacuum, CleanTag.Auto] },
  { mode: 5, key: 'vacuum_quick', label: 'Vacuum, 1 pass', narwal: NarwalMode.VACUUM, passes: 1, tags: [CleanTag.Vacuum, CleanTag.Quick] },
  { mode: 6, key: 'vacuum_deep', label: 'Vacuum, 2 passes', narwal: NarwalMode.VACUUM, passes: 2, tags: [CleanTag.Vacuum, CleanTag.DeepClean] },
  { mode: 2, key: 'mop', label: 'Mop', narwal: NarwalMode.MOP, tags: [CleanTag.Mop, CleanTag.Auto] },
  { mode: 7, key: 'mop_quick', label: 'Mop, 1 pass', narwal: NarwalMode.MOP, passes: 1, tags: [CleanTag.Mop, CleanTag.Quick] },
  { mode: 8, key: 'mop_deep', label: 'Mop, 2 passes', narwal: NarwalMode.MOP, passes: 2, tags: [CleanTag.Mop, CleanTag.DeepClean] },
  { mode: 0, key: 'vacuum_then_mop', label: 'Vacuum then Mop', narwal: NarwalMode.VACUUM_THEN_MOP, tags: [CleanTag.Vacuum, CleanTag.Mop] },
  { mode: 9, key: 'vacuum_then_mop_quick', label: 'Vacuum then Mop, 1 pass', narwal: NarwalMode.VACUUM_THEN_MOP, passes: 1, tags: [CleanTag.Vacuum, CleanTag.Mop, CleanTag.Quick] },
  { mode: 3, key: 'vacuum_then_mop_deep', label: 'Vacuum then Mop, 2 passes', narwal: NarwalMode.VACUUM_THEN_MOP, passes: 2, tags: [CleanTag.Vacuum, CleanTag.Mop, CleanTag.DeepClean] },
  { mode: 4, key: 'freo_mind', label: 'Freo Mind', narwal: NarwalMode.FREO_MIND, tags: [CleanTag.Vacuum, CleanTag.Mop, CleanTag.Auto] },
];

/**
 * Matter persists the current clean mode, and matter.js refuses to start the vacuum if that
 * number isn't offered any more, so never drop a mode number — reuse it. History: 0 was
 * "Vacuum & Mop" (Narwal 4) up to 0.1.6; 3 was "Vacuum then Mop" (app settings) in 0.1.4–0.1.7.
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
   * @param {number} [opts.releaseAfter] ms on the dock before the security system goes back to Away
   */
  constructor({ api, log, robot, device, name, store, save, security, releaseAfter }) {
    if (store.cleanMode in RETIRED_MODES) {
      store.cleanMode = RETIRED_MODES[store.cleanMode];
    }
    this.api = api;
    this.matter = api.matter;
    this.log = log;
    this.robot = robot;
    this.store = store;
    this.save = save;
    this.ready = false;
    this.status = undefined;
    this.fault = undefined;
    this.uuid = this.matter.uuid.generate(`narwal-${device.deviceId}`);
    this.name = name;
    this.device = device;
    this.opState = Op.Docked;
    this.security = security;
    this.releaseAfter = releaseAfter;
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
    return CLEAN_MODES;
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
          batPercentRemaining: 200,
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
    if (this.status) {
      this.applyStatus(this.status);
    }
  }

  async update(cluster, attributes) {
    if (!this.ready) {
      return;
    }
    try {
      await this.matter.updateAccessoryState(this.uuid, cluster, attributes);
    } catch (error) {
      this.log.debug(`Matter update of ${cluster} failed: ${error.message}`);
    }
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
    return Boolean(s) && ![WorkState.DOCKED, WorkState.IDLE_OFF_DOCK, 0].includes(s.state) && !s.returning;
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
    await this.holdSecurity();
    const names = roomIds.map(id => this.rooms.find(r => r.id === id)?.name ?? id).join(', ');
    this.log.info(`Starting ${mode.label}: ${names}`);
    this.robot.startClean(roomIds, mode.narwal, templates, mode.passes);
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
    if (result.held && !this.store.securityHeld) {
      this.log.info('Security system switched from Away to Stay while cleaning.');
      this.store.securityHeld = true;
      this.save();
    }
  }

  /** Track outings for the security hold: check when the robot leaves, release once it has settled on the dock. */
  securityFollow(op) {
    if (!this.security) {
      return;
    }
    const onDock = op === Op.Docked || op === Op.Charging;
    if (!onDock) {
      clearTimeout(this.releaseTimer);
      this.releaseTimer = undefined;
      if (op === Op.Running && !this.securityChecked && !this.checking) {
        // Started from the Narwal app or its schedule: switch now, a little late.
        this.log.warn('Cleaning started outside the Home app; checking the security system now.');
        this.checking = true;
        this.holdSecurity().catch(() => {}).finally(() => { this.checking = false; });
      }
      return;
    }
    if (this.releaseTimer || (!this.securityChecked && !this.store.securityHeld)) {
      return;
    }
    // Mid-clean the Freo goes back to the base to wash its mops, so wait until it has stayed there.
    this.releaseTimer = setTimeout(() => this.releaseSecurity(), this.releaseAfter);
  }

  async releaseSecurity() {
    this.releaseTimer = undefined;
    const op = this.status?.op;
    if (op !== Op.Docked && op !== Op.Charging) {
      return;
    }
    this.securityChecked = false;
    if (!this.store.securityHeld) {
      return;
    }
    try {
      const result = await this.security.release();
      this.store.securityHeld = false;
      this.save();
      this.log.info(result.released ? 'Back on the dock: security system set to Away again.'
        : `Back on the dock: security system left as ${result.state} (changed while cleaning).`);
    } catch (error) {
      this.log.warn(`Could not set the security system back to Away (${error.message}); retrying in 2 min.`);
      this.releaseTimer = setTimeout(() => this.releaseSecurity(), 2 * 60 * 1000);
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
    } else if (s.state === WorkState.DOCKED) {
      op = s.battery !== undefined && s.battery < 100 ? Op.Charging : Op.Docked;
    } else if (s.returning) {
      op = Op.SeekingCharger;
    } else if (s.paused) {
      op = Op.Paused;
    } else if (s.state === WorkState.IDLE_OFF_DOCK || s.state === 0) {
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
      await this.update('powerSource', {
        batPercentRemaining: level * 2,
        batChargeLevel: level < 15 ? 2 : level < 30 ? 1 : 0,
        batChargeState: op === Op.Charging ? ChargeState.IsCharging
          : op === Op.Docked ? ChargeState.IsAtFullCharge : ChargeState.IsNotCharging,
      });
    }
    this.status.op = op;
    this.securityFollow(op);
    // Raw robot state, so an error raised while docked (e.g. empty tank) still counts as on the dock.
    this.onDock?.(s.state === WorkState.DOCKED);
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
