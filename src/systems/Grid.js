import { allied } from './Match.js';
import { TILE } from '../data/config.js';

// The map grid: which entity occupies each tile, plus A* pathfinding.
//
// Movement rules:
//   empty tile            -> walkable
//   own gate              -> walkable (only for its owner)
//   enemy wall / gate     -> soldiers can path "through" it at a high cost,
//                            and will attack it when they reach it
//   anything else         -> blocked (trees, rocks, mines, buildings)
export class Grid {
  constructor(w, h) {
    this.w = w; this.h = h;
    this.cells = new Array(w * h).fill(null);
  }

  inside(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }
  get(x, y) { return this.inside(x, y) ? this.cells[y * this.w + x] : undefined; }
  set(x, y, e) { if (this.inside(x, y)) this.cells[y * this.w + x] = e; }
  clear(x, y, e) { if (this.get(x, y) === e) this.cells[y * this.w + x] = null; }
  // empty AND on walkable ground (not water / cliff)
  isFree(x, y) { return this.inside(x, y) && !this.cells[y * this.w + x] && (!this.terrain || this.terrain.walkable(x, y)); }

  static tileOf(px) { return Math.floor(px / TILE); }

  // cost to step on a tile for a unit of `team` (Infinity = blocked)
  cost(x, y, team, canBreak) {
    if (!this.inside(x, y)) return Infinity;
    if (this.terrain && !this.terrain.walkable(x, y)) return Infinity;
    const e = this.cells[y * this.w + x];
    if (!e) return 1;
    if (e.def?.wall) {
      if (allied(e.team, team)) return e.def.gate ? 1 : Infinity;      // own / allied gates open
      return canBreak ? 14 : Infinity;
    }
    return Infinity;
  }

  // can a unit stand at pixel position (x,y)?
  walkablePx(x, y, team) {
    const tx = Grid.tileOf(x), ty = Grid.tileOf(y);
    const e = this.get(tx, ty);
    if (e === undefined) return false;
    if (this.terrain && !this.terrain.walkable(tx, ty)) return false;
    return !e || (e.def?.gate && allied(e.team, team));
  }

  /**
   * A* from tile (sx,sy) to tile (gx,gy).
   * goalTiles: optional Set of tile indices that count as "arrived" even if blocked
   *            (e.g. the footprint of the tree / building we are walking to).
   * If the goal can't be reached, returns the path to the closest reachable tile.
   * Returns an array of {x,y} tiles (start excluded).
   */
  findPath(sx, sy, gx, gy, { team, canBreak = false, goalTiles = null } = {}) {
    const W = this.w, H = this.h, N = W * H;
    const start = sy * W + sx, goal = gy * W + gx;
    if (!this.inside(sx, sy) || !this.inside(gx, gy)) return [];
    const isGoal = (i) => i === goal || (goalTiles && goalTiles.has(i));
    const crowd = this.crowd;
    // the search arrays are kept between calls; a "generation" stamp marks which
    // entries belong to this search, so nothing has to be cleared or allocated
    if (!this.gBuf || this.gBuf.length !== N) {
      this.gBuf = new Float32Array(N); this.cameBuf = new Int32Array(N);
      this.seenGen = new Uint32Array(N); this.closedGen = new Uint32Array(N); this.gen = 0;
    }
    const gen = ++this.gen;
    const gArr = this.gBuf, cameArr = this.cameBuf, seen = this.seenGen, closedGen = this.closedGen;
    const g = { get: (i) => seen[i] === gen ? gArr[i] : Infinity };
    const came = { get: (i) => seen[i] === gen ? cameArr[i] : -1 };
    const closed = { has: (i) => closedGen[i] === gen };
    const h = (i) => {
      const dx = Math.abs((i % W) - gx), dy = Math.abs(((i / W) | 0) - gy);
      return Math.max(dx, dy) + 0.414 * Math.min(dx, dy);
    };
    const heap = new MinHeap();
    seen[start] = gen; gArr[start] = 0; cameArr[start] = -1;
    heap.push(start, h(start));
    let best = start, bestH = h(start);

    while (heap.size) {
      const cur = heap.pop();
      if (closed.has(cur)) continue;
      closedGen[cur] = gen;
      if (isGoal(cur)) { best = cur; break; }
      const hc = h(cur);
      if (hc < bestH) { bestH = hc; best = cur; }
      const cx = cur % W, cy = (cur / W) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = cx + dx, ny = cy + dy;
        if (!this.inside(nx, ny)) continue;
        const ni = ny * W + nx;
        if (closed.has(ni)) continue;
        if (this.terrain && !this.terrain.walkable(nx, ny)) continue;
        let c = isGoal(ni) ? 1 : this.cost(nx, ny, team, canBreak);
        if (c === Infinity) continue;
        // units standing on a tile (workers at a mine, a guard post): walk around them if it's not much longer
        if (crowd && !isGoal(ni)) c += crowd(nx, ny);
        if (dx && dy) {
          // no cutting corners past blocked tiles (and never diagonally through walls)
          const c1 = this.cost(cx + dx, cy, team, false), c2 = this.cost(cx, cy + dy, team, false);
          if (c1 === Infinity || c2 === Infinity) continue;
          c *= 1.414;
        }
        const ng = g.get(cur) + c;
        if (ng < g.get(ni)) { seen[ni] = gen; gArr[ni] = ng; cameArr[ni] = cur; heap.push(ni, ng + h(ni)); }
      }
    }
    const path = [];
    for (let i = best; i !== start && i !== -1; i = came.get(i)) path.push({ x: i % W, y: (i / W) | 0, i });
    return path.reverse();
  }
}

// small binary heap for A*
class MinHeap {
  constructor() { this.items = []; this.prio = []; }
  get size() { return this.items.length; }
  push(item, p) {
    const it = this.items, pr = this.prio;
    let i = it.length; it.push(item); pr.push(p);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (pr[parent] <= pr[i]) break;
      [it[i], it[parent]] = [it[parent], it[i]]; [pr[i], pr[parent]] = [pr[parent], pr[i]];
      i = parent;
    }
  }
  pop() {
    const it = this.items, pr = this.prio;
    const top = it[0], lastI = it.pop(), lastP = pr.pop();
    if (it.length) {
      it[0] = lastI; pr[0] = lastP;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < it.length && pr[l] < pr[m]) m = l;
        if (r < it.length && pr[r] < pr[m]) m = r;
        if (m === i) break;
        [it[i], it[m]] = [it[m], it[i]]; [pr[i], pr[m]] = [pr[m], pr[i]];
        i = m;
      }
    }
    return top;
  }
}
