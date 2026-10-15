// Narwal Freo (YJCC012 / "J3") MQTT message formats.
//
// Ported from the MIT-licensed Home Assistant integrations
// mk0000001/ha-narwal-cloud and madsah211/ha-narwal-cloud-eu, and checked
// against captures from our own Freo.

import { randomUUID } from 'node:crypto';

import {
  decodeFields, encodeFields, encodeVarint, fieldBytes, fieldString, fieldVarint, getFloat, getInt, getMessage, getMessages,
  unwrapTransport,
} from './proto.js';

/** Topics the robot publishes on. The broker only delivers them to explicit subscriptions. */
export const BROADCAST_TOPICS = [
  'status/robot_base_status',
  'status/working_status',
  'upgrade/upgrade_status',
  'status/download_status',
  'map/display_map',
  'status/time_line_status',
];

/** Extra subscriptions the official app holds (older Freo firmware won't answer get_map without them). */
export const EXTRA_SUBSCRIPTIONS = [
  'status/point_navi_plan_traj',
  'developer/planning_debug_info',
  'map/get_map/response',
  'clean/plan/get/response',
  'common/active_robot_publish/response',
  'general/service/response',
];

/** Narwal easy_clean modes. */
export const NarwalMode = {
  FREO_MIND: 1,
  VACUUM: 2,
  MOP: 3,
  VACUUM_AND_MOP: 4,
  VACUUM_THEN_MOP: 5,
};

/**
 * robot_base_status field 3.1 values seen on our Freo. Anything else is a cleaning job: 2 and 3 were
 * seen on vacuum / mop runs, 4 for a whole Vacuum then Mop job, mop-wash visits to the dock included.
 * 1 with field 3.3 set is idle on the dock (before and right after a job); 14 is the base station
 * working with the robot on it (field 3.12 says what: 4 = drying the mops).
 */
export const WorkState = {
  IDLE: 1,
  STATION: 14,
};

/** The robot is in a cleaning job (out cleaning, paused, or back at the dock mid-job to wash its mops). */
export function inJob(s) {
  return Boolean(s) && ![0, WorkState.IDLE, WorkState.STATION].includes(s.state);
}

/** The robot is on the dock and not in a job. */
export function onDock(s) {
  return Boolean(s) && (s.state === WorkState.STATION || (s.state === WorkState.IDLE && s.docked));
}

// Names for rooms that have a type but no custom name. The upstream table had
// 8 = Corridor, but on our Freo the Narwal app shows type 8 as "Dining room"
// (and the corridor is type 10).
const ROOM_TYPE_NAMES = {
  0: 'Room', 1: 'Main bedroom', 2: 'Bedroom', 3: 'Living room', 4: 'Kitchen', 5: 'Study', 6: 'Bathroom',
  7: 'Dining room', 8: 'Dining room', 9: 'Balcony', 10: 'Corridor', 11: 'Cloakroom', 12: 'Nursery',
  13: 'Recreation room', 14: 'Shower room', 15: 'Other room',
};

/**
 * Wrap a command body in Narwal's request header. The header names the
 * account (twice) and the topic the robot should reply on; the command body
 * follows outside the declared header length.
 */
export function taskPayload(clientUuid, responseTopic, body = Buffer.alloc(0)) {
  const response = Buffer.concat([fieldString(1, responseTopic), fieldString(2, randomUUID())]);
  const header = Buffer.concat([fieldString(1, clientUuid), fieldString(2, clientUuid), fieldBytes(5, response)]);
  return Buffer.concat([Buffer.from([1]), encodeVarint(header.length), header, body]);
}

/** Ask the robot to publish its broadcasts for `seconds` (what the app does when opened). */
export function activeRobotBody(seconds = 600) {
  return Buffer.concat(BROADCAST_TOPICS.map(topic =>
    fieldBytes(1, Buffer.concat([fieldString(1, topic), fieldVarint(2, seconds)]))));
}

/** The official app's "app opened" sequence: [topic suffix, body, wants a response]. */
export function wakeRequests() {
  return [
    ['common/notify_app_event', fieldVarint(1, 1), true],
    ['common/active_robot_publish', activeRobotBody(600), true],
    ['common/active_robot_publish', fieldVarint(1, 600), false],
    ['status/app_status_heartbeat', fieldVarint(1, 1), false],
    ['status/get_device_base_status', Buffer.alloc(0), true],
  ];
}

/** consumable/reset_consumable_info body: { 1: { 2: consumable type } } (types as in the cloud's consumables list). */
export function resetConsumableBody(type) {
  return fieldBytes(1, fieldVarint(2, type));
}

export function forceEndBody() {
  return fieldBytes(2, Buffer.from([1, 2]));
}

/**
 * Build a clean/easy_clean/start body. Uses the official app's per-room
 * template for this mode when available (it carries the suction, water and
 * pass settings chosen in the Narwal app), otherwise the defaults the HA
 * integration verified for each mode. `settings` ({ passes, suction, water },
 * each optional) overrides the template's values.
 */
export function easyCleanBody(roomIds, mode, templates = {}, settings = {}) {
  const parts = [fieldVarint(1, mode), fieldVarint(2, 1)];
  for (const roomId of roomIds) {
    const room = templates[roomId] ?? defaultRoomSettings(roomId, mode);
    parts.push(fieldBytes(3, withSettings(room, mode, settings)));
  }
  return Buffer.concat(parts);
}

/** Suction (vacuum) and water level (mop) values in room settings. */
export const Suction = { quiet: 1, standard: 2, strong: 3 };
export const Water = { dry: 1, standard: 2, wet: 3 };

/** Replace varint fields of a message ({ fieldNumber: value }; undefined values are left alone). */
function setFields(message, values) {
  const set = Object.entries(values).filter(([, v]) => v !== undefined).map(([n, v]) => [Number(n), v]);
  const fields = decodeFields(message).filter(f => !set.some(([n]) => n === f.number));
  for (const [number, value] of set) {
    fields.push({ number, wireType: 0, value });
  }
  fields.sort((a, b) => a.number - b.number);
  return encodeFields(fields);
}

/**
 * Apply pass / suction / water overrides to a room message, keeping everything else.
 * Room field 4 = vacuum { 1 suction, 2 passes }, 5 = mop { 1 const, 2 passes, 3 water },
 * 6 = vacuum and mop { 1 suction, 2 vacuum passes, 3 water, 4 mop passes },
 * 7 = vacuum then mop { 1 vacuum settings, 2 mop settings }. Freo Mind is left as is.
 */
function withSettings(room, mode, { passes, suction, water } = {}) {
  if (passes === undefined && suction === undefined && water === undefined) {
    return room;
  }
  const vacuum = msg => setFields(msg, { 1: suction, 2: passes });
  const mop = msg => setFields(msg, { 2: passes, 3: water });
  const edit = {
    [NarwalMode.VACUUM]: [4, vacuum],
    [NarwalMode.MOP]: [5, mop],
    [NarwalMode.VACUUM_AND_MOP]: [6, msg => setFields(msg, { 1: suction, 2: passes, 3: water, 4: passes })],
    [NarwalMode.VACUUM_THEN_MOP]: [7, msg => encodeFields(decodeFields(msg).map(p => {
      if (p.wireType !== 2) {
        return p;
      }
      return p.number === 1 ? { ...p, value: vacuum(p.value) } : p.number === 2 ? { ...p, value: mop(p.value) } : p;
    }))],
  }[mode];
  if (!edit) {
    return room;
  }
  const [settingsField, change] = edit;
  return encodeFields(decodeFields(room).map(f =>
    (f.number === settingsField && f.wireType === 2) ? { ...f, value: change(f.value) } : f));
}

function defaultRoomSettings(roomId, mode) {
  const suction = 2;
  const humidity = 2;
  const cycles = 1;
  const room = [fieldVarint(1, roomId)];
  if (mode === NarwalMode.FREO_MIND) {
    room.push(fieldVarint(2, 3), fieldBytes(6, Buffer.concat([
      fieldVarint(1, 2), fieldVarint(2, 1), fieldVarint(3, 2), fieldVarint(4, 1)])));
  } else if (mode === NarwalMode.VACUUM) {
    room.push(fieldVarint(2, 1), fieldBytes(4, Buffer.concat([fieldVarint(1, suction), fieldVarint(2, cycles)])));
  } else if (mode === NarwalMode.MOP) {
    room.push(fieldVarint(2, 1), fieldBytes(5, Buffer.concat([
      fieldVarint(1, 1), fieldVarint(2, cycles), fieldVarint(3, humidity)])));
  } else if (mode === NarwalMode.VACUUM_AND_MOP) {
    room.push(fieldVarint(2, 1), fieldBytes(6, Buffer.concat([
      fieldVarint(1, suction), fieldVarint(2, cycles), fieldVarint(3, humidity), fieldVarint(4, cycles)])));
  } else {
    const vacuum = Buffer.concat([fieldVarint(1, suction), fieldVarint(2, cycles)]);
    const mop = Buffer.concat([fieldVarint(1, 1), fieldVarint(2, cycles), fieldVarint(3, humidity)]);
    room.push(fieldVarint(2, 1), fieldBytes(7, Buffer.concat([fieldBytes(1, vacuum), fieldBytes(2, mop)])));
  }
  return Buffer.concat(room);
}

/**
 * Parse status/robot_base_status (published every ~1.5 s while active).
 * Field meanings were worked out by watching our robot through
 * vacuum / pause / resume / dock / mop runs.
 */
export function parseBaseStatus(payload) {
  const fields = decodeFields(payload);
  const battery = getFloat(fields, 2);
  const work = getMessage(fields, 3);
  const w = work ? decodeFields(work) : [];
  // Field 1 carries the current error/notice code (empty when there is none).
  const notice = getMessage(fields, 1);
  let code;
  if (notice?.length) {
    try {
      code = getInt(decodeFields(notice), 1);
    } catch {
      code = undefined;
    }
  }
  return {
    code,
    battery: battery === undefined ? undefined : Math.max(0, Math.min(100, Math.round(battery))),
    state: getInt(w, 1, 0),
    paused: getInt(w, 2, 0) > 0,
    docked: getInt(w, 3, 0) === 1,
    step: getInt(w, 7, 0),
    station: getInt(w, 12, 0),
    returning: getInt(w, 10, 0),
    dockFlag: getInt(fields, 7, 0),
  };
}

/** status/working_status: field 3 elapsed seconds, 6 current room id. */
export function parseWorkingStatus(payload) {
  if (!payload.length) {
    return {};
  }
  const fields = decodeFields(payload);
  return { elapsed: getInt(fields, 3), roomId: getInt(fields, 6) };
}

/** Parse map/get_map/response into { revision, rooms: [{ id, name, type }] }. */
export function parseMapResponse(payload) {
  const { body } = unwrapTransport(payload);
  const response = decodeFields(body);
  if (getInt(response, 1) !== 1) {
    throw new Error('Narwal map request was not successful');
  }
  const mapFields = findSavedMap(decodeFields(getMessage(response, 2) ?? Buffer.alloc(0)));
  if (!mapFields) {
    throw new Error('Narwal response did not contain a saved map');
  }
  const rooms = [];
  const seen = {};
  for (const raw of getMessages(mapFields, 12)) {
    const room = decodeFields(raw);
    const id = getInt(room, 1, 0);
    const type = getInt(room, 2, 0);
    const index = getInt(room, 8, 0);
    let name = (getMessage(room, 3) ?? Buffer.alloc(0)).toString('utf8').trim();
    if (!name) {
      name = ROOM_TYPE_NAMES[type] ?? 'Room';
      if (index > 1) {
        name = `${name} ${index}`;
      }
    }
    seen[name] = (seen[name] ?? 0) + 1;
    if (seen[name] > 1) {
      name = `${name} ${seen[name]}`;
    }
    if (id) {
      rooms.push({ id, name, type });
    }
  }
  return { revision: getInt(mapFields, 1, 0), rooms };
}

function findSavedMap(fields, depth = 0) {
  if (getInt(fields, 1, 0) > 0 && getInt(fields, 4, 0) > 0 && getInt(fields, 5, 0) > 0 && getMessage(fields, 17)) {
    return fields;
  }
  if (depth >= 3) {
    return undefined;
  }
  for (const field of fields) {
    if (field.wireType !== 2) {
      continue;
    }
    try {
      const match = findSavedMap(decodeFields(field.value), depth + 1);
      if (match) {
        return match;
      }
    } catch {
      // not a nested message
    }
  }
  return undefined;
}

/**
 * Parse clean/plan/get/response: the app's saved plan per mode, each holding
 * the exact room messages easy_clean/start accepts. Returns { mode: { roomId: hex } }.
 */
export function parsePlansResponse(payload) {
  const { body } = unwrapTransport(payload);
  const response = decodeFields(body);
  if (getInt(response, 1) !== 1) {
    throw new Error('Narwal cleaning-plan request was not successful');
  }
  const plans = {};
  for (const rawPlan of getMessages(response, 2)) {
    const plan = decodeFields(rawPlan);
    const mode = getInt(plan, 3, 0);
    const templates = {};
    for (const template of getMessages(plan, 9)) {
      const roomId = getInt(decodeFields(template), 1, 0);
      if (roomId) {
        templates[roomId] = Buffer.from(template).toString('hex');
      }
    }
    if (mode) {
      plans[mode] = templates;
    }
  }
  return plans;
}
