// The robot's saved maps ("floors") and their rooms as the Home app sees them, with the display names
// and stair detection chosen in the plugin settings (`maps` of a robot):
//   maps: [{ id, name, stairDetection, rooms: [{ id, name }] }]   (every field but `id` optional)

const NAME_MAX = 64; // Matter's limit for map and area names

/**
 * Matter area id of a room. The main map's rooms keep their Narwal room id (that is what 0.5.0 and
 * earlier published, and Home scenes and automations remember it); another map's rooms are
 * `map id * 1000 + room id`, since room ids repeat from map to map.
 */
export function areaIdFor(mainMapId, mapId, roomId) {
  return mapId === mainMapId ? roomId : mapId * 1000 + roomId;
}

/** A name that isn't in `used` yet ("Hallway", "Hallway 2", …); adds it to `used`. */
function unique(name, used) {
  let candidate = name;
  for (let n = 2; used.has(candidate.toLowerCase()); n++) {
    candidate = `${name} ${n}`;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

const clean = text => (typeof text === 'string' ? text.trim().slice(0, NAME_MAX) : '');

/**
 * The floors to publish.
 * @param {Array} maps the robot's maps, as saved by the plugin ([{ id, name, hasDock, main, start, rooms }])
 * @param {number} mainId the map the vacuum has always been published for (the one with the base station)
 * @param {Array} [settings] the `maps` setting
 * @returns {Array} [{ id, name, narwalName, main, hasDock, start, stairDetection, managed, rooms }] where
 *   `name` is what the Home app shows, `managed` is whether the plugin sets the robot's stair detection
 *   for this floor (every floor of a robot with several maps; a lone map only when the user chose a value),
 *   and each room is { id (Narwal's), areaId, name, narwalName, type }
 */
export function buildFloors(maps = [], mainId, settings = []) {
  const entries = Array.isArray(settings) ? settings : [];
  const usedMaps = new Set();
  return maps.map((map) => {
    const entry = entries.find(e => Number(e?.id) === map.id);
    const narwalName = clean(map.name) || (map.id === mainId ? 'Main Map' : `Map ${map.id}`);
    const usedRooms = new Set();
    return {
      id: map.id,
      name: unique(clean(entry?.name) || narwalName, usedMaps),
      narwalName,
      main: map.id === mainId,
      hasDock: map.hasDock !== false,
      start: map.start ?? { x: 0, y: 0 },
      stairDetection: typeof entry?.stairDetection === 'boolean' ? entry.stairDetection : true,
      managed: maps.length > 1 || typeof entry?.stairDetection === 'boolean',
      rooms: (map.rooms ?? []).map((room) => {
        const chosen = clean(entry?.rooms?.find(r => Number(r?.id) === room.id)?.name);
        return {
          id: room.id,
          areaId: areaIdFor(mainId, map.id, room.id),
          name: unique(chosen || room.name, usedRooms),
          narwalName: room.name,
          type: room.type,
        };
      }),
    };
  });
}

/** Every room of every floor, with the floor's id: [{ areaId, mapId, roomId, name, narwalName, type }]. */
export function allAreas(floors) {
  return floors.flatMap(f => f.rooms.map(r => ({
    areaId: r.areaId, mapId: f.id, roomId: r.id, name: r.name, narwalName: r.narwalName, type: r.type,
  })));
}

/**
 * A robot's saved maps for the settings page, as the robot names them: [{ id, name, main, hasDock, rooms: [{ id, name }] }].
 * Reads the plugin's saved state, including the layout of 0.5.x and earlier (one map's rooms).
 */
export function savedMaps(robotStore = {}) {
  const maps = robotStore.maps
    ?? (robotStore.rooms?.length ? [{ id: robotStore.mapId ?? 1, name: '', hasDock: true, main: true, rooms: robotStore.rooms }] : []);
  const mainId = robotStore.mainMapId ?? maps.find(m => m.main)?.id;
  return buildFloors(maps, mainId).map(f => ({
    id: f.id,
    name: f.narwalName,
    main: f.main,
    hasDock: f.hasDock,
    rooms: f.rooms.map(r => ({ id: r.id, name: r.narwalName })),
  }));
}
