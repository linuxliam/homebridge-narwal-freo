// Room shapes for zone cleaning. On a map without a base station the Narwal app offers no rooms, only
// zones, and the robot takes a zone as an outline of cells (see zoneCleanBody in protocol.js). A room's
// outline is the edge of its floor cells on the map (parseMapShape), minus the map's no-go zones.

const DIRECTIONS = [[0, -1], [1, 0], [0, 1], [-1, 0]]; // north, east, south, west (y grows southward)

// A patch of floor smaller than this many cells (about 0.1 m²) is a speck, not a part of the room.
const MIN_CELLS = 40;

/** Whether (x, y) is inside a polygon (ray casting). */
function insidePolygon(polygon, x, y) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if (((yi > y) !== (yj > y)) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Trace a region's edge with the right hand on the wall: the cells along its boundary, step by step
 * (each one next to the last), starting at the top row's right end and heading west, as the app's
 * outlines do. `has(x, y)` tells whether a cell is in the region.
 */
function trace(start, has, limit) {
  const path = [start];
  let [x, y] = start;
  let heading = 3; // west
  let first;
  for (let step = 0; step < limit; step++) {
    let moved;
    for (const turn of [1, 0, 3, 2]) { // right, straight, left, back
      const d = (heading + turn) % 4;
      if (has(x + DIRECTIONS[d][0], y + DIRECTIONS[d][1])) {
        moved = d;
        break;
      }
    }
    if (moved === undefined) {
      break; // a single cell
    }
    if (first === undefined) {
      first = moved;
    } else if (x === start[0] && y === start[1] && moved === first) {
      break; // back at the start and about to go round again
    }
    x += DIRECTIONS[moved][0];
    y += DIRECTIONS[moved][1];
    heading = moved;
    path.push([x, y]);
  }
  // The loop closes on the start cell; the app's outlines don't repeat it.
  const last = path[path.length - 1];
  if (path.length > 1 && last[0] === start[0] && last[1] === start[1]) {
    path.pop();
  }
  return path;
}

/**
 * The outlines of one room, one per separate patch of floor: [{ cells, points, box }] in zone
 * coordinates, ordered as the app's are: `points` a closed loop that isn't repeated at its end,
 * `box` the corners of its bounding box (top right, top left, bottom left, bottom right). The biggest
 * patch comes first. Empty when the map has no floor for the room.
 * @param {object} shape from parseMapShape
 * @param {number} roomId
 */
export function roomOutlines(shape, roomId) {
  const { width, height, x0, y0, rooms, noGo } = shape;
  const free = new Uint8Array(width * height);
  for (let i = 0; i < free.length; i++) {
    if (rooms[i] !== roomId) {
      continue;
    }
    const x = x0 + (i % width);
    const y = y0 + Math.floor(i / width);
    // A no-go zone takes the cells on its low-x edge but not those on its low-y edge, as the app's
    // outline does (checked against its hallway zone): the cell is tested a little up and right.
    free[i] = noGo.some(zone => insidePolygon(zone, x + 0.25, y - 0.25)) ? 0 : 1;
  }
  const seen = new Uint8Array(width * height);
  const patches = [];
  for (let i = 0; i < free.length; i++) {
    if (!free[i] || seen[i]) {
      continue;
    }
    // Flood the patch (cells next to each other, not diagonal).
    const cells = [];
    const stack = [i];
    seen[i] = 1;
    while (stack.length) {
      const at = stack.pop();
      cells.push(at);
      const col = at % width;
      for (const next of [col > 0 ? at - 1 : -1, col < width - 1 ? at + 1 : -1, at - width, at + width]) {
        if (next >= 0 && next < free.length && free[next] && !seen[next]) {
          seen[next] = 1;
          stack.push(next);
        }
      }
    }
    if (cells.length >= MIN_CELLS) {
      patches.push(cells);
    }
  }
  patches.sort((a, b) => b.length - a.length);

  return patches.map(cells => outlineOf(shape, cells));
}

/**
 * The outline of one patch of cells (indexes into the map's cell array, cells next to each other):
 * { cells, points, box } as roomOutlines describes.
 */
function outlineOf(shape, cells) {
  const { width, height, x0, y0 } = shape;
  const inPatch = new Set(cells);
  const has = (x, y) => {
    const col = x - x0;
    const row = y - y0;
    return col >= 0 && col < width && row >= 0 && row < height && inPatch.has(row * width + col);
  };
  // Top row, right end.
  let top = cells[0];
  for (const at of cells) {
    const row = Math.floor(at / width);
    const topRow = Math.floor(top / width);
    if (row < topRow || (row === topRow && at % width > top % width)) {
      top = at;
    }
  }
  const start = [x0 + (top % width), y0 + Math.floor(top / width)];
  const points = trace(start, has, cells.length * 4 + 8);
  const xs = points.map(p => p[0]);
  const ys = points.map(p => p[1]);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  return {
    cells: cells.length,
    points,
    box: [[maxX, minY], [minX, minY], [minX, maxY], [maxX, maxY]],
  };
}

// The zone a robot is sent to, to take it to a map's starting point: this many cells (5 cm each) a side.
const SPOT_CELLS = 6;

/**
 * A small square zone around a point, to move the robot there (a map without a base station has no
 * "go to" command; a zone clean is the only way to send it somewhere). `point` is in cells (the map's
 * zone coordinates, 5 cm each). The square is SPOT_CELLS cells a side with the point in its middle,
 * clipped to the map's floor cells: if the point's own cell isn't floor, the nearest floor cell is the
 * middle instead. Returns { roomId, cell: [x, y] (the middle), cells, points, box } like roomOutlines
 * (roomId = the room at the middle cell), or undefined when the map has no floor.
 * @param {object} shape from parseMapShape
 * @param {{x: number, y: number}} point in cells
 */
export function spotOutline(shape, point) {
  const { width, height, x0, y0, rooms, noGo } = shape;
  const floorAt = (x, y) => {
    const col = x - x0;
    const row = y - y0;
    if (col < 0 || col >= width || row < 0 || row >= height || !rooms[row * width + col]) {
      return false;
    }
    return !noGo.some(zone => insidePolygon(zone, x + 0.25, y - 0.25));
  };
  const px = Math.round(point.x);
  const py = Math.round(point.y);
  // The point's cell, else the nearest floor cell (searching outwards ring by ring).
  let middle;
  const reach = Math.max(width, height);
  for (let r = 0; r <= reach && !middle; r++) {
    let best;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r || !floorAt(px + dx, py + dy)) {
          continue;
        }
        const d = dx * dx + dy * dy;
        if (!best || d < best.d) {
          best = { d, x: px + dx, y: py + dy };
        }
      }
    }
    middle = best;
  }
  if (!middle) {
    return undefined;
  }
  // SPOT_CELLS cells a side with the middle cell just right of and below the centre (3 left/up, 2 right/down).
  const half = SPOT_CELLS / 2;
  const members = new Set();
  const stack = [[middle.x, middle.y]];
  const inBlock = (x, y) => x >= middle.x - half && x < middle.x - half + SPOT_CELLS
    && y >= middle.y - half && y < middle.y - half + SPOT_CELLS;
  while (stack.length) {
    const [x, y] = stack.pop();
    const key = (y - y0) * width + (x - x0);
    if (members.has(key) || !inBlock(x, y) || !floorAt(x, y)) {
      continue;
    }
    members.add(key);
    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
  const outline = outlineOf(shape, [...members]);
  return {
    roomId: rooms[(middle.y - y0) * width + (middle.x - x0)],
    cell: [middle.x, middle.y],
    ...outline,
  };
}

/**
 * The order to clean rooms in, nearest first: the room the point `from` (cells) is in, or the one whose
 * floor is nearest to it; then, again and again, the remaining room nearest to the middle (centroid)
 * of the one before. Nearest = the smallest distance from that point to any floor cell of the room;
 * ties go to the earlier room in `roomIds`. Rooms with no floor on the map keep their place at the end.
 * @param {object} shape from parseMapShape
 * @param {number[]} roomIds in the order asked for
 * @param {{x: number, y: number}} from in cells
 */
export function nearestFirst(shape, roomIds, from) {
  const { width, x0, y0, rooms } = shape;
  const cells = new Map(roomIds.map(id => [id, []]));
  for (let i = 0; i < rooms.length; i++) {
    cells.get(rooms[i])?.push([x0 + (i % width), y0 + Math.floor(i / width)]);
  }
  const distance = (id, point) => cells.get(id).reduce((best, [x, y]) => Math.min(best, Math.hypot(x - point.x, y - point.y)), Infinity);
  const centroid = (id) => {
    const list = cells.get(id);
    return { x: list.reduce((sum, c) => sum + c[0], 0) / list.length, y: list.reduce((sum, c) => sum + c[1], 0) / list.length };
  };
  const left = roomIds.filter(id => cells.get(id).length);
  const order = [];
  let point = from;
  while (left.length) {
    let best = 0;
    let bestDistance = Infinity;
    left.forEach((id, n) => {
      const d = distance(id, point);
      if (d < bestDistance) {
        best = n;
        bestDistance = d;
      }
    });
    const [id] = left.splice(best, 1);
    order.push(id);
    point = centroid(id);
  }
  return [...order, ...roomIds.filter(id => !cells.get(id).length)];
}
