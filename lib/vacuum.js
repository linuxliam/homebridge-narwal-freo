// The Freo as a Matter RoboticVacuumCleaner (Apple Home shows it as a native vacuum).

import { lookupError } from './errors.js';
import { allAreas, buildFloors } from './floors.js';
import { NarwalMode, Suction, Water, inJob, onDock } from './protocol.js';

// Matter enum values (matter.js RvcOperationalState / RvcRunMode / RvcCleanMode).
const Op = { Stopped: 0, Running: 1, Paused: 2, Error: 3, SeekingCharger: 64, Charging: 65, Docked: 66 };
const RunTag = { Idle: 16384, Cleaning: 16385 };
const CleanTag = { Auto: 0, Quick: 1, DeepClean: 16384, Vacuum: 16385, Mop: 16386 };
// UnableToStartOrResume: a start (or resume) the plugin refused or couldn't set up; UnableToCompleteOperation:
// a clean the plugin had to pause (stair detection); FailedToFindChargingDock: Return to dock on a floor with no base.
const ErrorState = { NoError: 0, UnableToStartOrResume: 1, UnableToCompleteOperation: 2, FailedToFindChargingDock: 64 };
const ChargeState = { IsCharging: 1, IsAtFullCharge: 2, IsNotCharging: 3 };

// How long after a start the robot may take to report the job before the security hold is released.
const START_TIMEOUT = 2 * 60 * 1000;

// Security hold stop detection: the robot counts as stopped while its position stays within this many
// metres and its heading within this many radians (neither drifts when still; it can turn on the
// spot for several seconds before driving off), and only while positions keep arriving (~1.5 s apart).
const STILL_TOLERANCE = 0.3;
const TURN_TOLERANCE = 0.5;
const POSE_GAP = 15 * 1000;
// After pausing for the security plugin: time to coast to a stop, and to check the pause landed.
const HALT_SETTLE = 10 * 1000;
const HALT_CHECK = 8 * 1000;
// Sent home because the security system is arming Away: be in the base this long before the motion
// sensors arm, or pause where it is. The deadline is what keeps it safe; the estimate only skips trips
// that can't possibly make it: start-up and docking time plus the straight line to the base (about
// (0, 0) on the map) at full speed. Measured 2026-10-16: ~6 s turning before it sets off, 0.25 m/s
// driving, ~10 s backing into the base; routes around furniture can be several times the straight line.
const HOME_MARGIN = 10 * 1000;
const HOME_OVERHEAD = 16 * 1000;
const RETURN_SPEED = 0.25;
// A trip to a starting point (no base station) can't be told from "not set off yet" for this long.
const HOME_SETTLE = 5 * 1000;

const RUN_IDLE = 0;
const RUN_CLEANING = 1;

// While a job runs on a floor that needs stair detection, the robot's setting is checked this often.
const STAIR_CHECK = 60 * 1000;

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

// The tag for a room: by the name shown in the Home app, else Narwal's name for it, else its room type.
function areaType(room) {
  const tag = name => AREA_TAGS[name.toLowerCase().replace(/[^a-z]/g, '')];
  return tag(room.name) ?? tag(room.narwalName ?? '') ?? TYPE_TAGS[room.type] ?? null;
}

/**
 * Home app clean-mode slots. Apple Home lists the modes in three groups by their Vacuum / Mop tags,
 * names each group after its first mode's label, and shows the others in its "…" menu by their
 * intensity tag (Automatic, Quick, Deep Clean); tapping a group picks its Automatic mode. What each
 * slot does is set in the plugin settings (`cleanModes`); `mode` numbers stay put (see RETIRED_MODES).
 */
const SLOTS = [
  { mode: 1, key: 'vacuum', group: 'vacuum', tags: [CleanTag.Vacuum, CleanTag.Auto] },
  { mode: 5, key: 'vacuumQuick', group: 'vacuum', tags: [CleanTag.Vacuum, CleanTag.Quick] },
  { mode: 6, key: 'vacuumDeep', group: 'vacuum', tags: [CleanTag.Vacuum, CleanTag.DeepClean] },
  { mode: 2, key: 'mop', group: 'mop', tags: [CleanTag.Mop, CleanTag.Auto] },
  { mode: 7, key: 'mopQuick', group: 'mop', tags: [CleanTag.Mop, CleanTag.Quick] },
  { mode: 8, key: 'mopDeep', group: 'mop', tags: [CleanTag.Mop, CleanTag.DeepClean] },
  { mode: 0, key: 'both', group: 'both', tags: [CleanTag.Vacuum, CleanTag.Mop, CleanTag.Auto] },
  { mode: 9, key: 'bothQuick', group: 'both', tags: [CleanTag.Vacuum, CleanTag.Mop, CleanTag.Quick] },
  { mode: 3, key: 'bothDeep', group: 'both', tags: [CleanTag.Vacuum, CleanTag.Mop, CleanTag.DeepClean] },
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
};

// Earlier `defaultCleanMode` values (named after what the slot did up to 0.2.0) -> slot keys.
const LEGACY_KEYS = {
  vacuum_quick: 'vacuumQuick', vacuum_deep: 'vacuumDeep', mop_quick: 'mopQuick', mop_deep: 'mopDeep',
  vacuum_then_mop: 'both', vacuum_mop: 'both', vacuum_then_mop_quick: 'bothQuick',
  vacuum_then_mop_deep: 'bothDeep',
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

// How the Home app shows each slot, to tell apart slots that are set up the same.
const SLOT_NAMES = {
  vacuum: 'Automatic', vacuumQuick: 'Quick', vacuumDeep: 'Deep Clean', mop: 'Automatic', mopQuick: 'Quick',
  mopDeep: 'Deep Clean', both: 'Automatic', bothQuick: 'Quick', bothDeep: 'Deep Clean',
};

/**
 * The clean modes offered to the Home app, from the `cleanModes` setting. Matter requires unique
 * labels (matter.js won't publish the vacuum otherwise), so slots set up the same get their slot name.
 */
export function buildModes(config = {}) {
  const modes = buildSlots(config);
  const count = label => modes.filter(m => m.label === label).length;
  const duplicates = new Set(modes.map(m => m.label).filter(label => count(label) > 1));
  for (const mode of modes) {
    if (duplicates.has(mode.label)) {
      mode.label = `${mode.label} (${SLOT_NAMES[mode.key]})`;
    }
  }
  return modes;
}

function buildSlots(config = {}) {
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
 * The vacuum must offer the mode it reports as current, or matter.js won't publish it, so a saved
 * mode number that's no longer offered maps to one that is (unknown ones fall back to the first).
 * History: 0 was "Vacuum & Mop" (Narwal 4) up to 0.1.6; 3 was "Vacuum then Mop" (app settings) in
 * 0.1.4–0.1.7; 4 was the combined button's separate Automatic (Freo Mind) until 0.3.0, when every
 * button got the same Automatic / Quick / Deep Clean and Freo Mind became a task choice.
 */
const RETIRED_MODES = { 4: 0 };

const FRESH_STATUS = 5000; // a status this recent is trusted by Return to dock
const STATUS_WAIT = 5000; // how long Return to dock waits for a status from a robot that was quiet
const BATTERY_LAND = 3000; // a battery update should show in Homebridge's Matter state within this
const RECALL_CHECK = 20000; // the robot should be on its way home this soon after Return to dock

/**
 * On the dock and not in a job. Field 11 saying out of the base wins over the state: a robot lifted
 * off its base while idle may keep reporting the station state or the docked flag.
 */
function isDocked(s) {
  return onDock(s) && s.base !== 1;
}

// Why a clean ended: Narwal app's TaskResult enum (only 1 and 2 seen on the Freo so far).
const END_REASONS = {
  1: 'finished', 2: 'stopped by you', 3: 'the robot shut down', 4: 'battery too low',
  5: 'overflow (tank or dustbin full)', 6: 'paused too long', 7: 'system error', 8: 'stopped at the base station',
  9: 'stopped from the Narwal app', 10: 'sent back to the base', 11: 'finished, but the map couldn\'t be updated',
  12: 'the map didn\'t match', 13: 'the robot lost its position (near the base)',
  14: 'the robot lost its position (away from the base)', 15: 'an error before the job started',
  16: 'ended by a schedule', 17: 'never started', 18: 'pet not found',
};
// Normal or user-driven ends; every other reason is logged as a warning.
const NORMAL_END_REASONS = [1, 2, 8, 9, 10, 16];

/** One log line for a parseCleanReport result. */
export function formatCleanReport(r) {
  const how = END_REASONS[r.reason] ?? (r.reason === undefined ? 'ended' : `ended (reason ${r.reason})`);
  const parts = [];
  if (r.percent !== undefined) {
    parts.push(`${r.percent}% done`);
  }
  const details = [];
  if (r.area !== undefined) {
    details.push(`${r.area.toFixed(1)} m²`);
  }
  if (r.seconds !== undefined) {
    details.push(r.seconds >= 60 ? `${Math.floor(r.seconds / 60)} min ${r.seconds % 60} s` : `${r.seconds} s`);
  }
  const text = [...parts, details.join(' in ')].filter(Boolean).join(', ');
  return `Clean report: ${how}${text ? `, ${text}` : ''}.`;
}

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
   * @param {import('./security-hold.js').SecurityHold} [opts.security] switch the security system from Away to Stay while cleaning
   * @param {number} [opts.securityStoppedMinutes] let the security system go back to Away once the
   *   robot has stood still this long off the base mid-job (0: keep the hold until the job ends)
   * @param {object} [opts.cleanModes] the `cleanModes` setting (see buildModes)
   * @param {Array} [opts.mapSettings] the `maps` setting: floor names, room names, stair detection (see floors.js)
   * @param {number} [opts.vacationCleans] cleans allowed after vacation mode is turned on
   * @param {string} [opts.vacationAfter] then: 'none' (refuse cleans) or 'vacuum' (vacuum only)
   */
  constructor({ api, log, robot, device, name, store, save, security, securityStoppedMinutes = 10, cleanModes,
    mapSettings, vacationCleans = 1, vacationAfter = 'none' }) {
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
    this.mapSettings = mapSettings;
    this.refreshFloors();
    this.ready = false;
    this.status = undefined;
    this.fault = undefined;
    this.uuid = this.matter.uuid.generate(`narwal-${device.deviceId}`);
    this.name = name;
    this.device = device;
    this.opState = Op.Docked;
    this.security = security;
    this.securityStoppedMinutes = securityStoppedMinutes;
    this.vacationCleans = vacationCleans;
    this.vacationAfter = vacationAfter;
    // Whether the security system was checked (and held, if Away) for the current outing.
    this.securityChecked = false;
  }

  stop() {
    clearTimeout(this.releaseTimer);
    clearTimeout(this.haltTimer);
    clearTimeout(this.homeTimer);
    clearTimeout(this.stairFirst);
    clearInterval(this.stairTimer);
  }

  /** Rebuild the floors (maps and their rooms, with the names and stair detection chosen in the settings). */
  refreshFloors() {
    this.floors = buildFloors(this.store.maps ?? [], this.store.mainMapId, this.mapSettings);
    this.areas = allAreas(this.floors);
  }

  /** The floor the robot is on: where the last job started until it's back on its base, else its current map. */
  robotFloor() {
    const id = this.store.robotMapId ?? this.robot.currentMapId;
    return this.floors.find(f => f.id === id) ?? this.floors.find(f => f.main) ?? this.floors[0];
  }

  /** Modes offered to the Home app. */
  get modes() {
    return this.modeList;
  }

  get cleanMode() {
    return this.modes.find(m => m.mode === this.store.cleanMode) ?? this.modes[0];
  }

  supportedMaps() {
    return this.floors.map(f => ({ mapId: f.id, name: f.name }));
  }

  supportedAreas() {
    return this.areas.map(area => ({
      areaId: area.areaId,
      mapId: area.mapId,
      areaInfo: {
        locationInfo: { locationName: area.name, floorNumber: 0, areaType: areaType(area) },
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
          supportedMaps: this.supportedMaps(),
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
            // Home ignores a refusal here and sends the start anyway, so the request is remembered
            // either way: start() decides what to do with it.
            this.store.selectedAreas = [...newAreas];
            this.save();
            const known = new Map(this.areas.map(a => [a.areaId, a]));
            const bad = newAreas.filter(id => !known.has(id));
            if (bad.length) {
              throw new status.NotFound(`Unknown room ${bad.join(', ')}`);
            }
            if (new Set(newAreas.map(id => known.get(id).mapId)).size > 1) {
              throw new status.InvalidCommand('Pick rooms from one floor');
            }
            this.log.info(`Rooms selected: ${newAreas.map(id => this.floorLabel(known.get(id))).join(', ') || 'all'}`);
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

  /** A room's name for the log; with several floors, the floor's too. */
  floorLabel(area) {
    return this.floors.length > 1 ? `${area.name} (${this.floors.find(f => f.id === area.mapId)?.name})` : area.name;
  }

  /** The selection as the Home app should see it: rooms we know, all on one floor (the first room's). */
  validSelection(ids) {
    const known = new Map(this.areas.map(a => [a.areaId, a]));
    const valid = (ids ?? []).filter(id => known.has(id));
    return valid.filter(id => known.get(id).mapId === known.get(valid[0]).mapId);
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
    if (this.starting) {
      throw new this.matter.status.Busy('A clean is already starting');
    }
    this.starting = true;
    try {
      await this.clearNotice();
      await this.startClean();
    } finally {
      this.starting = false;
    }
  }

  /**
   * Refuse a start: the reason goes to the log and, shorter (`tile`: Matter allows 64 characters), onto the
   * tile as a Matter error, and the Home app gets the exception to throw. The robot isn't started.
   */
  async refuse(message, tile = message) {
    this.log.warn(`Not cleaning: ${message}.`);
    await this.setNotice(ErrorState.UnableToStartOrResume, tile).catch(() => {});
    return new this.matter.status.InvalidInState(tile.slice(0, 64));
  }

  /**
   * Which floor and rooms the Home app asked for. The rooms decide the floor (Home never mixes floors);
   * with none selected, it's every room of the robot's current floor. A selection we can't make sense of
   * is refused, never turned into a clean of everything.
   */
  async cleanTarget() {
    const asked = this.store.selectedAreas ?? [];
    if (!asked.length) {
      const floor = this.robotFloor();
      return { floor, rooms: floor.rooms };
    }
    const known = new Map(this.areas.map(a => [a.areaId, a]));
    if (asked.some(id => !known.has(id))) {
      throw await this.refuse('Some of the selected rooms no longer exist. Pick the rooms again', 'Selected rooms no longer exist');
    }
    const floors = new Set(asked.map(id => known.get(id).mapId));
    if (floors.size > 1) {
      throw await this.refuse('The selected rooms are on different floors. Pick rooms from one floor', 'Selected rooms are on different floors');
    }
    const floor = this.floors.find(f => f.id === known.get(asked[0]).mapId);
    return { floor, rooms: asked.map(id => floor.rooms.find(r => r.areaId === id)) };
  }

  /** The cleaning plans saved for a floor (the app's per-room settings for each mode). */
  plansFor(floor) {
    return this.store.plansByMap?.[floor.id];
  }

  async startClean() {
    if (!this.areas.length) {
      throw new this.matter.status.InvalidInState(
        'The room list has not loaded yet. Try again in a minute; if it keeps failing, check that the robot is online.');
    }
    const { floor, rooms } = await this.cleanTarget();
    const roomIds = rooms.map(r => r.id);
    const mode = this.vacationMode(this.cleanMode);

    // The robot cleans the floor it is set to, and the start command names none: change floors first.
    // Everything must be confirmed by the robot's replies; otherwise nothing starts.
    let switched = false;
    if (this.floors.length > 1) {
      const here = await this.robot.currentMap();
      if (here !== floor.id) {
        if (inJob(this.status)) {
          throw await this.refuse(`Can't change to ${floor.name} while the robot is cleaning`, 'Can\'t change floors while cleaning');
        }
        this.log.info(`Switching the robot to ${floor.name}.`);
        await this.robot.switchMap(floor.id).catch(async (error) => {
          throw await this.refuse(`Could not change to ${floor.name} (${error.message})`, error.message);
        });
        switched = true;
      }
    }
    await this.ensureStairs(floor);
    let plans = this.plansFor(floor);
    if (this.floors.length > 1 && (switched || !plans)) {
      await this.robot.fetchPlans();
      plans = this.plansFor(floor) ?? plans;
    }

    const templates = Object.fromEntries(
      Object.entries(plans?.[mode.narwal] ?? {}).map(([id, hex]) => [id, Buffer.from(hex, 'hex')]));
    if (mode.narwal === NarwalMode.FREO_MIND && roomIds.some(id => !templates[id])) {
      throw new this.matter.status.InvalidInState(
        'Freo Mind needs the room plans from the robot, which have not loaded yet. Try again in a minute.');
    }
    const missing = rooms.filter(r => !templates[r.id]);
    if (missing.length) {
      this.log.info(`No Narwal app settings for this task in ${missing.map(r => r.name).join(', ')} yet; using standard suction and water.`);
    }
    await this.holdSecurity();
    this.log.info(`Starting ${mode.label}: ${rooms.map(r => r.name).join(', ')}${this.floors.length > 1 ? ` (${floor.name})` : ''}`);
    this.store.robotMapId = floor.id;
    this.save();
    const reply = await this.robot.startClean(roomIds, mode.narwal, templates, mode.settings);
    if (reply && !reply.ok && !reply.timedOut) {
      throw await this.refuse('The robot refused to start');
    }
    await this.setOpState(Op.Running);
    await this.update('rvcRunMode', { currentMode: RUN_CLEANING });
  }

  // ── Stair detection (per floor) ──

  /**
   * Make the robot's stair detection what the floor's setting says, and check it took. A floor that
   * needs stair detection on is not cleaned if that can't be set (a robot without it could drive down
   * the stairs); one that wants it off still is, with a warning, since it only risks false "stuck" errors.
   */
  async ensureStairs(floor) {
    if (!floor.managed) {
      return;
    }
    const want = !floor.stairDetection; // stairless mode
    const word = on => (on ? 'on' : 'off');
    const fail = async (what) => {
      if (floor.stairDetection) {
        throw await this.refuse(`${what}. ${floor.name} needs stair detection on`, what);
      }
      this.log.warn(`${what}; cleaning ${floor.name} with stair detection as the robot has it.`);
    };
    const have = await this.robot.stairless();
    if (have === undefined) {
      return fail('Could not read the robot\'s stair detection setting');
    }
    if (have !== want) {
      if (!await this.robot.setStairless(want)) {
        return fail(`The robot didn't accept turning stair detection ${word(!want)}`);
      }
      if (await this.robot.stairless() !== want) {
        return fail(`The robot didn't keep stair detection ${word(!want)}`);
      }
      this.log.info(`Stair detection turned ${word(!want)} for ${floor.name}.`);
    }
    this.stairPaused = false;
  }

  /**
   * While a job runs on a floor that needs stair detection, check the robot still has it (something
   * else, such as the Narwal app, may have turned it off): if not, pause the robot and say so on the tile.
   */
  async checkStairs() {
    const floor = this.robotFloor();
    if (this.checkingStairs || !floor?.managed || !floor.stairDetection || !inJob(this.status)
      || this.status.paused || !this.robot.connected) {
      return;
    }
    this.checkingStairs = true;
    try {
      if (await this.robot.stairless(true) !== true || !inJob(this.status) || this.status.paused) {
        return;
      }
      this.stairPaused = true;
      this.log.warn(`Stair detection is off on the robot, but ${floor.name} needs it on: pausing the robot. `
        + 'Resume it from the Home app to turn stair detection back on and carry on.');
      this.robot.pause();
      await this.setOpState(Op.Paused).catch(() => {});
      await this.setNotice(ErrorState.UnableToCompleteOperation, `Stair detection is off, but ${floor.name} needs it on`);
    } catch (error) {
      this.log.debug(`Stair detection check skipped: ${error.message}`);
    } finally {
      this.checkingStairs = false;
    }
  }

  /** Keep checking stair detection while a job runs (and once soon after it starts). */
  watchStairs(active) {
    if (!active) {
      clearTimeout(this.stairFirst);
      clearInterval(this.stairTimer);
      this.stairFirst = this.stairTimer = undefined;
      return;
    }
    if (!this.stairTimer) {
      this.stairFirst = setTimeout(() => this.checkStairs(), 3000);
      this.stairTimer = setInterval(() => this.checkStairs(), STAIR_CHECK);
      this.stairFirst.unref?.();
      this.stairTimer.unref?.();
    }
  }

  // ── Errors the plugin puts on the tile (the robot's own errors are `fault`) ──

  async setNotice(matter, message) {
    this.notice = { matter, message };
    this.opState = Op.Error;
    this.commandGraceUntil = 0;
    await this.update('rvcOperationalState', {
      operationalState: Op.Error,
      operationalError: { errorStateId: matter, errorStateDetails: message.slice(0, 64) },
    });
  }

  async clearNotice() {
    if (!this.notice) {
      return;
    }
    this.notice = undefined;
    if (!this.fault) {
      this.opState = undefined; // re-evaluate from the next status
      await this.update('rvcOperationalState', { operationalError: { errorStateId: ErrorState.NoError } });
      if (this.status) {
        await this.refresh(this.status);
      }
    }
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
    const floor = this.robotFloor();
    if (this.stairPaused && floor) {
      await this.ensureStairs(floor);
    }
    await this.clearNotice();
    await this.holdSecurity();
    this.log.info('Resuming');
    this.robot.resume();
    await this.setOpState(Op.Running);
    await this.update('rvcRunMode', { currentMode: RUN_CLEANING });
  }

  async goHome() {
    this.ensureConnected();
    // The tile can be stale (a robot lifted off its base while idle may still look docked), so ask
    // the robot, not the cached state.
    let s = this.status;
    if (Date.now() - (this.lastStatusAt ?? 0) > FRESH_STATUS) {
      const asked = this.lastStatusAt ?? 0;
      this.robot.wake();
      for (let waited = 0; waited < STATUS_WAIT && (this.lastStatusAt ?? 0) === asked; waited += 250) {
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      s = (this.lastStatusAt ?? 0) !== asked ? this.status : undefined;
    }
    if (s && isDocked(s)) {
      this.log.info('Already on its base; nothing to do.');
      return;
    }
    // Still no status: send it anyway. Recalling a robot that is already on its base is assumed harmless.
    // The trip home passes the motion sensors like a clean does, so it needs the security system's
    // OK first, and the robot stays put without it. Not needed while this robot's hold is still in
    // force (a job that got the OK, not released since), or for a trip home the security plugin
    // ordered (halt).
    const holdActive = this.store.securityHeld && !this.releasing && !this.store.securityStopped;
    if (this.security && !this.homeBound && !holdActive) {
      this.recalling = !inJob(s);
      try {
        await this.holdSecurity('returning to the base');
      } catch (error) {
        this.recalling = false;
        throw error;
      }
    }
    await this.clearNotice();
    // A floor without a base station: the robot is expected to drive back to its starting point.
    const floor = this.robotFloor();
    const noBase = floor && !floor.hasDock;
    this.log.info((this.fault ? `Returning to dock (the robot reports: ${this.fault.message})` : 'Returning to dock')
      + (noBase ? `; ${floor.name} has no base station, so it should go back to its starting point` : ''));
    const reply = this.robot.returnToDock();
    if (noBase) {
      const answer = await reply;
      if (!answer.ok && !answer.timedOut) {
        return this.dockFailed(floor, 'The robot refused to return');
      }
    }
    await this.setOpState(Op.SeekingCharger);
    await this.update('rvcRunMode', { currentMode: RUN_IDLE });
    this.checkRecall(noBase ? floor : undefined);
  }

  /**
   * Return to dock didn't work on a floor with no base station: end the job where the robot is, and say
   * so on the tile (the closest Matter error is FailedToFindChargingDock).
   */
  async dockFailed(floor, why) {
    clearTimeout(this.recallTimer);
    this.recalling = false;
    this.log.warn(`${why}: ending the clean. ${floor.name} has no base station to dock at.`);
    this.robot.stopTask();
    await this.setNotice(ErrorState.FailedToFindChargingDock, `No base station on ${floor.name}; couldn't return`);
    await this.update('rvcRunMode', { currentMode: RUN_IDLE });
  }

  /**
   * The Freo never acknowledges commands, and one with an error to clear (say, a brush jammed and
   * then freed) may ignore Return to dock. Check that it set off, and say so if it didn't. On a floor with
   * no base station (`noBase`: that floor) a robot that didn't set off ends the job with an error instead.
   */
  checkRecall(noBase) {
    clearTimeout(this.recallTimer);
    this.recallTimer = setTimeout(async () => {
      const s = this.status;
      if (!s || s.returning || s.atBase || isDocked(s)) {
        return;
      }
      if (noBase) {
        await this.dockFailed(noBase, 'The robot didn\'t set off');
        return;
      }
      this.log.warn('The robot didn\'t start back to its base'
        + (this.fault ? ` (it reports: ${this.fault.message}). Clear the error with the robot's button or in the Narwal app, then try again.`
          : '. Check it isn\'t stuck, then try again.'));
      // Show what it's really doing rather than "returning".
      this.commandGraceUntil = 0;
      this.opState = undefined;
      await this.refresh(s).catch(() => {});
    }, RECALL_CHECK);
    this.recallTimer.unref?.();
  }

  // ── Vacation mode (a set number of cleans, then none or vacuum only) ──

  /** The vacation switch changed (or was read for the first time). */
  setVacation(on) {
    if (on && !this.store.vacation) {
      this.store.vacation = { since: Date.now(), cleans: 0 };
      const then = this.vacationAfter === 'vacuum' ? 'vacuum only' : 'no cleaning';
      this.log.info(`Vacation mode on: ${this.vacationCleans ? `the next ${this.vacationCleans === 1 ? 'clean runs'
        : `${this.vacationCleans} cleans run`} as usual, then ${then}` : then} until it's off.`);
    } else if (!on && this.store.vacation) {
      delete this.store.vacation;
      this.log.info('Vacation mode off: cleaning as usual.');
    } else {
      return;
    }
    this.save();
  }

  /** A job started (from anywhere): under vacation mode, it counts toward the allowed cleans. */
  vacationJob() {
    const vacation = this.store.vacation;
    if (!vacation) {
      return;
    }
    vacation.cleans = (vacation.cleans ?? 0) + 1;
    this.save();
    if (vacation.cleans === this.vacationCleans) {
      this.log.info(`Vacation mode: this is the last clean allowed as usual; after it, ${this.vacationAfter === 'vacuum'
        ? 'cleans vacuum only' : 'cleans are refused'} until vacation mode is off.`);
    }
  }

  /** The mode to start in: as chosen, or (allowed cleans used up) refused or switched to vacuuming. */
  vacationMode(mode) {
    const vacation = this.store.vacation;
    if (!vacation || (vacation.cleans ?? 0) < this.vacationCleans) {
      return mode;
    }
    const since = new Date(vacation.since).toLocaleString();
    if (this.vacationAfter !== 'vacuum') {
      this.log.info(`Vacation mode (on since ${since}): not cleaning; cleans start again when it's turned off.`);
      throw new this.matter.status.InvalidInState('Vacation mode: no more cleaning');
    }
    if (mode.narwal === NarwalMode.VACUUM) {
      return mode;
    }
    // Same intensity: Mop / Vacuum and Mop Quick -> Vacuum Quick, and so on.
    const key = mode.key.replace(/^(mop|both)/, 'vacuum');
    const vacuum = this.modes.find(m => m.key === key) ?? this.modes.find(m => m.key === 'vacuum');
    this.log.info(`Vacation mode (on since ${since}): vacuuming only, ${vacuum.label} instead of ${mode.label}.`);
    return vacuum;
  }

  // ── Security hold (Away -> Stay while the robot is out) ──

  /**
   * Before the robot moves: if the security system is armed Away, have it switched to Stay so
   * the motion sensors don't set it off. Refuses the command when that can't be done, because
   * cleaning under Away means a false alarm (and a monitoring call). A trip home from off the base
   * moves past the sensors too, so it's refused the same way (`what` names it in the log).
   */
  async holdSecurity(what = 'cleaning') {
    if (!this.security) {
      return;
    }
    clearTimeout(this.releaseTimer);
    // Moving again on purpose: a pending "did the halt's pause land?" check must not pause it again.
    clearTimeout(this.haltTimer);
    this.cancelHome();
    let result;
    try {
      result = await this.security.hold();
    } catch (error) {
      this.log.error(`Not ${what}: could not check the security system (${error.message}).`);
      throw new this.matter.status.Busy(`Security system unreachable: ${error.message}`.slice(0, 64));
    }
    if (!result.ok) {
      this.log.warn(`Not ${what}: ${result.reason ?? 'the security system said no'}.`);
      throw new this.matter.status.InvalidInState(`Security system: ${result.reason ?? 'not safe to clean'}`);
    }
    this.securityChecked = true;
    this.unapproved = false;
    this.heldAt = Date.now();
    if (this.store.securityStopped) {
      delete this.store.securityStopped;
      this.save();
    }
    this.jobSeen = inJob(this.status);
    // securityHeld: the security plugin knows this robot is out ('out'), and holds Stay for it (true).
    if (!this.store.securityHeld || (result.held && this.store.securityHeld === 'out')) {
      if (result.held) {
        this.log.info(`Security system switched from Away to Stay while the robot is ${this.recalling ? 'on its way back' : 'cleaning'}.`);
      }
      this.store.securityHeld = result.held ? true : 'out';
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
      // Released because the robot stopped: applyPose pauses and asks again once it moves. Sent home
      // by the security plugin: no new hold on the way. Sent home from the Home app: the hold was
      // already granted before it set off.
      if (!this.securityChecked && !this.store.securityStopped && !this.homeBound && !this.recalling
        && !this.unapproved && !this.checking) {
        const st = this.status;
        if (this.store.securityHeld) {
          // Restarted mid-job with the hold on record: it was approved before the restart.
          this.securityChecked = true;
        } else if (st?.base !== 1 && (st?.base || isDocked(st))) {
          // Still in the base: whatever it reports there (the base's own work, the end of a trip
          // home) isn't moving past sensors. A job that really starts is caught as it leaves.
        } else {
          // Started from the Narwal app, its schedule or the robot's button, or found running at
          // startup: it must not keep moving without the security system's OK.
          this.checkBeforeMoving('Cleaning started outside the Home app', 'cleaning started outside the Home app')
            .catch(error => this.log.warn(`Could not pause the robot (${error.message}).`));
        }
      }
      return;
    }
    if (this.jobSeen) {
      // The trip home is over (right after the command the robot still reports idle for a moment).
      this.recalling = false;
    }
    this.unapproved = false;
    if (this.store.securityStopped) {
      delete this.store.securityStopped;
      this.save();
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

  /**
   * The security plugin is arming Away while this robot is out. The plugin has already let go of
   * the hold; moving again (a resume) asks for a new one.
   * @param {number} [armAt] when the motion sensors arm (ms; the end of the exit delay). The robot
   *   heads back to its base if it can be in `HOME_MARGIN` before then, and pauses wherever it is if
   *   it isn't. Without it (already armed), or too far away: pause where it is now.
   */
  async halt(armAt) {
    this.store.securityHeld = false;
    clearTimeout(this.haltTimer);
    this.cancelHome();
    if (!inJob(this.status)) {
      this.save();
      return { halted: false, reason: 'not cleaning' };
    }
    if (this.status.paused) {
      this.store.securityStopped = true;
      this.save();
      this.haltSettleUntil = Date.now() + HALT_SETTLE;
      this.log.info('Security system arming Away; the robot is already paused, so it stays where it is.');
      return { halted: true };
    }
    const deadline = armAt - HOME_MARGIN;
    const left = deadline - Date.now();
    if (Number.isFinite(left) && left > 0 && !this.status.atBase) {
      // Without a recent position, try anyway: the deadline still pauses it in time. On a floor with
      // no base station the trip ends at the map's starting point, not at the base (about (0, 0)).
      const floor = this.robotFloor();
      const noBase = Boolean(floor && !floor.hasDock);
      const goal = noBase ? floor.start : { x: 0, y: 0 };
      const pose = Date.now() - (this.poseAt ?? 0) <= POSE_GAP ? this.pose : undefined;
      const distance = pose && Math.hypot(pose.x - goal.x, pose.y - goal.y);
      const needs = HOME_OVERHEAD + (distance === undefined ? 0 : distance / RETURN_SPEED * 1000);
      if (needs <= left) {
        return this.sendHome(deadline, distance, noBase);
      }
      this.log.warn(`Security system arming Away: the robot can't be back at its ${noBase ? 'starting point' : 'base'} within ${Math.round(left / 1000)} s`
        + (distance === undefined ? '.' : ` (${distance.toFixed(1)} m away).`));
    }
    return this.pauseForSecurity(armAt > Date.now() ? 'Security system arming Away' : 'Security system armed Away');
  }

  /**
   * Back to the base before the motion sensors arm; pause wherever it is at `deadline`. On a floor with
   * no base station (`noBase`) "home" is the map's starting point, and the trip is over when the job ends.
   */
  sendHome(deadline, distance, noBase = false) {
    const at = new Date(deadline).toLocaleTimeString();
    this.log.warn(`Security system arming Away: sending the robot back to its ${noBase ? 'starting point' : 'base'}${distance === undefined ? ''
      : ` (${distance.toFixed(1)} m away)`}; if it isn't in by ${at}, it pauses where it is.`);
    this.homeBound = { since: Date.now(), distance, noBase };
    this.robot.returnToDock();
    this.setOpState(Op.SeekingCharger).catch(() => {});
    this.update('rvcRunMode', { currentMode: RUN_IDLE }).catch(() => {});
    // The Freo never acknowledges commands: check it's on its way, and try once more.
    this.haltTimer = setTimeout(() => {
      const s = this.status;
      if (this.homeBound && inJob(s) && !s.returning && !s.atBase) {
        this.log.warn('The robot did not head back; trying again.');
        this.robot.returnToDock();
      }
    }, HALT_CHECK);
    this.homeTimer = setTimeout(() => {
      this.homeTimer = undefined;
      if (this.homeBound && !this.arrived(this.status)) {
        this.homeBound = undefined;
        this.pauseForSecurity('Not back at the base in time');
        this.reportIn();
      }
    }, deadline - Date.now());
    return { halted: true, returning: true };
  }

  /**
   * A robot sent home has arrived: in the base, or (no base station on its floor) its job has ended
   * where it stopped, a few seconds after the recall.
   */
  arrived(s) {
    if (!s) {
      return false;
    }
    return s.atBase || isDocked(s)
      || Boolean(this.homeBound?.noBase && Date.now() - this.homeBound.since > HOME_SETTLE && !inJob(s) && !s.returning);
  }

  /** Sent home and now in the base: log how long it took. */
  arrivedHome() {
    const { since, distance, noBase } = this.homeBound;
    const secs = Math.round((Date.now() - since) / 1000);
    this.log.info(`The robot is back at its ${noBase ? 'starting point' : 'base'} after ${secs} s${distance === undefined ? '' : ` from ${distance.toFixed(1)} m away`
      + (secs > 0 ? ` (${(distance / secs).toFixed(2)} m/s straight-line)` : '')}.`);
    this.cancelHome();
    this.reportIn();
  }

  /** Tell the security plugin the robot is in (or stopped), so it needn't wait for it to arm Away. */
  reportIn() {
    this.security?.release().catch(error => this.log.warn(`Could not tell the security system the robot is in (${error.message}).`));
  }

  cancelHome() {
    clearTimeout(this.homeTimer);
    this.homeTimer = undefined;
    this.homeBound = undefined;
  }

  /** Stop where it is (pause, not dock, so it doesn't drive through the house). */
  async pauseForSecurity(why) {
    this.store.securityStopped = true;
    this.save();
    this.haltSettleUntil = Date.now() + HALT_SETTLE;
    this.log.warn(`${why}: pausing the robot where it is.`);
    this.robot.pause();
    await this.setOpState(Op.Paused).catch(() => {});
    // The Freo never acknowledges commands: check its status, and try once more.
    clearTimeout(this.haltTimer);
    this.haltTimer = setTimeout(() => {
      const s = this.status;
      if ((inJob(s) || s?.returning) && !s.paused && !s.atBase) {
        this.log.warn('The robot did not pause; trying again.');
        this.robot.pause();
      }
    }, HALT_CHECK);
    return { halted: true };
  }

  /**
   * The robot is moving without the security system's OK (a job from the Narwal app, its schedule or
   * the robot's button; or moving again after the stop release): ask for the hold straight away (the
   * answer takes about a second, while the robot is still by its base or where it stopped). With the
   * OK it carries on; if the security system can't be reached or says no, pause it and leave it
   * paused (once per start: a Home app Resume goes through resume() and asks again).
   * @param {string} message what was noticed (log)
   * @param {string} how what to tell the user the robot did
   */
  async checkBeforeMoving(message, how) {
    if (this.checking) {
      return;
    }
    this.checking = true;
    try {
      this.log.info(`${message}; checking the security system.`);
      try {
        await this.holdSecurity('cleaning');
        return;
      } catch (error) {
        this.unapproved = true;
        this.robot.pause();
        await this.setOpState(Op.Paused).catch(() => {});
        await this.update('rvcRunMode', { currentMode: RUN_CLEANING }).catch(() => {});
        this.log.warn(`Paused: ${how}, and the security system didn't give the OK (${error.message}). `
          + 'Resume it from the Home app once the security system allows it.');
        // The Freo never acknowledges commands: check the pause landed, and try once more.
        clearTimeout(this.haltTimer);
        this.haltTimer = setTimeout(() => {
          const s = this.status;
          if (this.unapproved && inJob(s) && !s.paused && !s.atBase) {
            this.log.warn('The robot did not pause; trying again.');
            this.robot.pause();
          }
        }, HALT_CHECK);
      }
    } finally {
      this.checking = false;
    }
  }

  /** Log the robot's end-of-clean report once (the broker may deliver it again). */
  applyCleanReport(r) {
    const key = `${r.start}-${r.end}`;
    if (r.start !== undefined && key === this.lastReport) {
      return;
    }
    this.lastReport = key;
    this.log[NORMAL_END_REASONS.includes(r.reason) ? 'info' : 'warn'](formatCleanReport(r));
  }

  /**
   * Robot position during a job. A robot that has stood still off the base for
   * `securityStoppedMinutes` (stuck, lifted, paused…) can't set off motion sensors: release the
   * hold, and hold again as soon as it moves or turns. Any change counts, re-localisation jumps
   * included, and a gap in the positions restarts the wait: both only keep Stay longer.
   */
  applyPose(p) {
    if (!this.security) {
      return;
    }
    const now = Date.now();
    this.pose = p;
    const anchor = this.stillFrom;
    const turn = anchor && Math.abs(Math.atan2(Math.sin(p.heading - anchor.heading), Math.cos(p.heading - anchor.heading)));
    const moved = anchor !== undefined && (Math.hypot(p.x - anchor.x, p.y - anchor.y) > STILL_TOLERANCE || turn > TURN_TOLERANCE);
    const counting = inJob(this.status) && !this.status.atBase && now - (this.poseAt ?? 0) <= POSE_GAP;
    // Coasting to a stop right after a halt isn't moving again.
    if (now < (this.haltSettleUntil ?? 0)) {
      this.poseAt = now;
      this.stillFrom = { x: p.x, y: p.y, heading: p.heading, at: now };
      return;
    }
    this.poseAt = now;
    if (!anchor || moved || !counting) {
      this.stillFrom = { x: p.x, y: p.y, heading: p.heading, at: now };
    }
    // Sent home by the security plugin: driving there isn't a reason to hold again.
    if (!inJob(this.status) || this.homeBound) {
      return;
    }
    if (this.store.securityStopped) {
      if (moved) {
        delete this.store.securityStopped;
        this.save();
        this.checkBeforeMoving('Robot moving again', 'it started moving again').catch(() => {});
      }
      return;
    }
    if (this.isStopped() && this.store.securityHeld && !this.releasing && !this.releaseTimer) {
      this.releaseSecurity(true);
    }
  }

  /** Stood still off the base, with fresh positions, for `securityStoppedMinutes`. */
  isStopped() {
    const now = Date.now();
    return this.securityStoppedMinutes > 0 && this.stillFrom !== undefined && now - (this.poseAt ?? 0) <= POSE_GAP
      && now - this.stillFrom.at >= this.securityStoppedMinutes * 60 * 1000;
  }

  /** @param {boolean} [stopped] release although the job is still open, because the robot stopped moving */
  async releaseSecurity(stopped = false) {
    this.releaseTimer = undefined;
    if (inJob(this.status) && !(stopped && this.isStopped())) {
      return;
    }
    if (!stopped) {
      this.securityChecked = false;
      this.jobSeen = false;
    }
    if (!this.store.securityHeld) {
      return;
    }
    const why = stopped ? `Robot hasn't moved for ${this.securityStoppedMinutes} min` : 'Cleaning finished';
    const held = this.store.securityHeld;
    this.releasing = true;
    try {
      const result = await this.security.release();
      this.store.securityHeld = false;
      if (stopped) {
        this.store.securityStopped = true;
      }
      this.save();
      if (result.released) {
        this.log.info(`${why}: security system set to Away again.`);
      } else {
        // Nothing to say if the system wasn't Away when the robot set off.
        this.log[held === 'out' ? 'debug' : 'info'](`${why}: security system left as it is (${result.state ?? 'changed while cleaning, or still held for another robot'}).`);
      }
    } catch (error) {
      this.log.warn(`Could not set the security system back to Away (${error.message}); retrying in 2 min.`);
      this.releaseTimer = setTimeout(() => this.releaseSecurity(stopped), 2 * 60 * 1000);
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
    if (this.fault || this.notice) {
      op = Op.Error;
    } else if (isDocked(s)) {
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
      this.log.debug(`Robot state ${s.state}${s.paused ? ' paused' : ''}${s.returning ? ' returning' : ''}`
        + ` (base ${s.base}, docked ${s.docked ? 1 : 0}) -> Matter ${op}`);
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
    if (this.homeBound && this.arrived(s)) {
      this.arrivedHome();
    }
    // From the raw state, so an error during a job doesn't end it.
    const active = inJob(s);
    if (active && previous && !inJob(previous)) {
      this.vacationJob();
      this.jobStarted();
    }
    if (isDocked(s) && this.store.robotMapId !== undefined) {
      // On its base: back on the floor that has it.
      delete this.store.robotMapId;
      this.save();
    }
    if (!active) {
      this.stairPaused = false;
    }
    this.watchStairs(active);
    this.securityFollow(active);
    this.onJob?.(active);
  }

  /** A job began, from the Home app or anywhere else. */
  jobStarted() {
    if (this.notice && !this.starting) {
      this.clearNotice().catch(() => {});
    }
    // Started elsewhere (the Narwal app, a schedule, the robot's button): it's on the map the robot is set to.
    if (this.store.robotMapId === undefined && this.robot.currentMapId !== undefined) {
      this.store.robotMapId = this.robot.currentMapId;
      this.save();
    }
  }

  /** Read the battery back from Matter, so a dropped update shows in the log. */
  async checkBattery(level, first) {
    try {
      const read = async () => (await this.matter.getAccessoryState(this.uuid, 'powerSource'))?.batPercentRemaining;
      // Homebridge applies an update a moment after updateAccessoryState() returns (it only queues
      // it), so a read straight away still sees the old value: wait for it to land.
      let reported = await read();
      for (let waited = 0; reported !== undefined && reported !== level * 2 && waited < BATTERY_LAND; waited += 200) {
        await new Promise(resolve => setTimeout(resolve, 200));
        reported = await read();
      }
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
    // Room ids repeat from floor to floor: the room is on the floor the robot is cleaning.
    const floorId = this.robotFloor()?.id;
    const area = w.roomId && this.areas.find(a => a.mapId === floorId && a.roomId === w.roomId);
    if ((this.opState === Op.Running || this.opState === Op.Paused) && area) {
      await this.update('serviceArea', { currentArea: area.areaId });
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
      await this.update('rvcOperationalState', {
        operationalError: this.notice
          ? { errorStateId: this.notice.matter, errorStateDetails: this.notice.message.slice(0, 64) }
          : { errorStateId: ErrorState.NoError },
      });
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

  /** New maps or rooms: update the Home app's floor and room lists. */
  async applyRooms() {
    // A selection that lost rooms (a changed map) is dropped rather than turned into a smaller clean.
    const known = new Set(this.areas.map(a => a.areaId));
    if ((this.store.selectedAreas ?? []).some(id => !known.has(id))) {
      this.store.selectedAreas = this.validSelection(this.store.selectedAreas);
      this.save();
    }
    await this.update('serviceArea', {
      supportedMaps: this.supportedMaps(),
      supportedAreas: this.supportedAreas(),
      selectedAreas: this.validSelection(this.store.selectedAreas),
    });
  }
}
