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

/** robot_base_status field 3.1 values seen on our Freo. */
export const WorkState = {
  IDLE_OFF_DOCK: 1,
  VACUUMING: 2,
  MOPPING: 3,
  DOCKED: 14,
};

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

export function forceEndBody() {
  return fieldBytes(2, Buffer.from([1, 2]));
}

/**
 * Build a clean/easy_clean/start body. Uses the official app's per-room
 * template for this mode when available (it carries the suction, water and
 * pass settings chosen in the Narwal app), otherwise the defaults the HA
 * integration verified for each mode.
 */
export function easyCleanBody(roomIds, mode, templates = {}, passes = undefined) {
  const parts = [fieldVarint(1, mode), fieldVarint(2, 1)];
  for (const roomId of roomIds) {
    let room = templates[roomId] ?? defaultRoomSettings(roomId, mode);
    if (passes) {
      room = withPasses(room, mode, passes);
    }
    parts.push(fieldBytes(3, room));
  }
  return Buffer.concat(parts);
}

// Room settings sub-message per mode; its field 2 is the number of passes.
const SETTINGS_FIELD = { [NarwalMode.VACUUM]: 4, [NarwalMode.MOP]: 5 };

// Vacuum then Mop: field 7 holds { 1: vacuum settings, 2: mop settings }.
const VACUUM_THEN_MOP_FIELD = 7;

/** Set field 2 (passes) of a settings message. */
function setPasses(settings, passes) {
  const fields = decodeFields(settings).filter(s => s.number !== 2);
  fields.push({ number: 2, wireType: 0, value: passes });
  fields.sort((a, b) => a.number - b.number);
  return encodeFields(fields);
}

/** Change the pass count in a room message, keeping its suction / water settings. */
function withPasses(room, mode, passes) {
  const settingsField = mode === NarwalMode.VACUUM_THEN_MOP ? VACUUM_THEN_MOP_FIELD : SETTINGS_FIELD[mode];
  if (!settingsField) {
    return room;
  }
  const fields = decodeFields(room).map(f => {
    if (f.number !== settingsField || f.wireType !== 2) {
      return f;
    }
    if (mode !== NarwalMode.VACUUM_THEN_MOP) {
      return { ...f, value: setPasses(f.value, passes) };
    }
    const parts = decodeFields(f.value).map(p => (p.wireType === 2 && (p.number === 1 || p.number === 2))
      ? { ...p, value: setPasses(p.value, passes) } : p);
    return { ...f, value: encodeFields(parts) };
  });
  return encodeFields(fields);
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
