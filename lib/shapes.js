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

  return patches.map((cells) => {
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
  });
}
