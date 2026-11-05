import { BUILDINGS, MAP_W, MAP_H, TILE } from '../data/config.js';
import { planWall } from './WallBuilder.js';

// A town plan for an AI base, so it builds like a real city instead of
// dropping buildings anywhere:
//
//        top wall  ─────────[gate toward resources]──────────
//       |  mill      houses houses houses                    |
//  front|  military    ═══ road ═══  KEEP  houses houses     | back
//  gate |  military                        houses houses     | (map edge)
//       |  mill      towers at the gates and corners         |
//        bottom wall ───────[gate toward resources]──────────
//
// Coordinates: u = tiles toward the enemy ("front"), v = tiles sideways.
// Every building sits on a 2-tile grid, so there is always a 1-tile path
// between buildings, and the road in front of the keep is kept clear.
export class BasePlanner {
  constructor(scene, team, keep) {
    this.scene = scene;
    this.team = team;
    this.keep = keep;
    this.f = keep.x > (MAP_W * TILE) / 2 ? -1 : 1;          // direction of the enemy
    this.c0 = this.f > 0 ? keep.tx + 1 : keep.tx;            // keep's front column
    this.ky = keep.ty;
    // wall rectangle (in u/v), clipped to the map
    this.front = 9; this.back = -9; this.top = -8; this.bottom = 9;
  }

  tile(u, v) { return { tx: this.c0 + this.f * u, ty: this.ky + v }; }
  uv(tx, ty) { return { u: (tx - this.c0) * this.f, v: ty - this.ky }; }
  inMap(t) { return t.tx >= 0 && t.ty >= 0 && t.tx < MAP_W && t.ty < MAP_H; }

  onRoad(u, v) { return u >= 1 && (v === 0 || v === 1); }        // keep -> front gate
  insideWalls(u, v) { return u > this.back + 1 && u < this.front - 1 && v > this.top + 1 && v < this.bottom - 1; }

  // ---------------- building spots ----------------
  // score: lower = better. Each kind has its own district.
  score(kind, u, v) {
    const av = Math.abs(v - 0.5);
    switch (kind) {
      case 'house':    return (u <= -3 ? -u : 20 + Math.abs(u)) + av * 0.8;       // rows behind the keep
      case 'barracks':
      case 'workshop':
      case 'chapel':   return (u >= 3 ? u : 30) + Math.abs(av - 3.5) * 1.2;       // front, either side of the road
      case 'mill':     return Math.abs(u - 1) + (8 - av) * 1.5;                   // near the top/bottom walls
      case 'well':     return Math.abs(u - 3) + Math.abs(av - 3.5);                  // just in front of the keep, by the road
      case 'blacksmith':
      case 'market':
      case 'tavern':   return 2 + Math.abs(u) + Math.abs(av - 5.5) * 1.2;          // the side streets
      case 'storehouse': return 0;
      default:         return Math.abs(u) + av;
    }
  }

  spotFor(kind) {
    const s = this.scene, size = BUILDINGS[kind].size;
    let best = null, bestScore = Infinity;
    for (let u = this.back + 2; u <= this.front - 2; u++) {
      for (let v = this.top + 2; v <= this.bottom - 2; v++) {
        // the 2-tile grid: odd columns, even rows (relative to the keep)
        if (((u % 2) + 2) % 2 !== 1 || ((v % 2) + 2) % 2 !== 0) continue;
        if (this.onRoad(u, v) || this.onRoad(u, v + 1)) continue;
        const t = this.tile(u, v);
        if (!this.inMap(t)) continue;
        if (!s.areaFree(t.tx - 1, t.ty - 1, size + 2)) continue;      // keeps a path all around
        const sc = this.score(kind, u, v);
        if (sc < bestScore) { bestScore = sc; best = t; }
      }
    }
    return best;
  }

  // a storehouse right next to the nearest forest / mine that's away from the keep
  storehouseSpot() {
    const s = this.scene, k = this.keep;
    const nodes = s.nodes.filter(n => n.alive)
      .map(n => ({ n, d: Phaser.Math.Distance.Between(n.x, n.y, k.x, k.y) }))
      .filter(o => o.d > TILE * 7).sort((a, b) => a.d - b.d);
    for (const { n } of nodes.slice(0, 12)) {
      const spot = s.findBuildSpot(n.tx, n.ty, 1, 0, 4);
      if (spot) return spot;
    }
    return null;
  }

  // ---------------- walls ----------------
  // The 3 or 4 sides of the rectangle (sides on the map edge are skipped: the edge is a wall already).
  // Each side gets a gate where it's most useful: the front gate on the road toward the enemy,
  // the other gates on the point closest to resources outside the walls.
  wallSides() {
    const sides = [];
    const add = (name, a, b) => {
      const ta = this.tile(a.u, a.v), tb = this.tile(b.u, b.v);
      const vertical = ta.tx === tb.tx;
      const fixed = vertical ? ta.tx : ta.ty, max = vertical ? MAP_W - 1 : MAP_H - 1;
      if (fixed <= 0 || fixed >= max) return;          // on/over the map edge: the edge is our wall
      const clip = (t) => ({ tx: Phaser.Math.Clamp(t.tx, 0, MAP_W - 1), ty: Phaser.Math.Clamp(t.ty, 0, MAP_H - 1) });
      sides.push({ name, a: clip(ta), b: clip(tb) });
    };
    add('front',  { u: this.front, v: this.top },    { u: this.front, v: this.bottom });
    add('top',    { u: this.back,  v: this.top },    { u: this.front, v: this.top });
    add('bottom', { u: this.back,  v: this.bottom }, { u: this.front, v: this.bottom });
    add('back',   { u: this.back,  v: this.top },    { u: this.back,  v: this.bottom });
    return sides;
  }

  gateTilesFor(side, tiles) {
    if (side.name === 'front') {
      // two gates side by side on the road
      return tiles.filter(t => { const { v } = this.uv(t.tx, t.ty); return v === 0 || v === 1; });
    }
    // closest wall tile to a resource outside the walls
    const outside = this.scene.nodes.filter(n => n.alive && !this.insideWalls(this.uv(n.tx, n.ty).u, this.uv(n.tx, n.ty).v));
    let best = null, bd = Infinity;
    for (let i = 2; i < tiles.length - 2; i++) {
      const t = tiles[i];
      // a gate needs a buildable tile with open ground on both sides of the wall
      if (t.status !== 'new' || !this.openAcross(t, tiles)) continue;
      for (const n of outside) {
        const d = Math.abs(n.tx - t.tx) + Math.abs(n.ty - t.ty);
        if (d < bd) { bd = d; best = t; }
      }
    }
    if (best) return [best];
    const fallback = tiles.filter(t => t.status === 'new');
    return fallback.length ? [fallback[Math.floor(fallback.length / 2)]] : [];
  }

  // is the ground free on both sides of this wall tile (so the gate leads somewhere)?
  openAcross(t, tiles) {
    const horizontal = tiles.length > 1 && tiles[0].ty === tiles[tiles.length - 1].ty;
    const g = this.scene.grid;
    return horizontal ? g.isFree(t.tx, t.ty - 1) && g.isFree(t.tx, t.ty + 1)
                      : g.isFree(t.tx - 1, t.ty) && g.isFree(t.tx + 1, t.ty);
  }

  // plan one side: like the player's wall tool, but with our own gate positions
  planSide(side) {
    const plan = planWall(this.scene, this.team, side.a, side.b, false);
    // this side already has its gate(s)? then repairs only add plain wall
    const g = this.scene.grid;
    const hasGate = plan.tiles.some(t => t.status === 'have' && g.get(t.tx, t.ty)?.def?.gate);
    const gates = hasGate ? [] : this.gateTilesFor(side, plan.tiles);
    for (const g of gates) {
      const t = plan.tiles.find(p => p.tx === g.tx && p.ty === g.ty);
      if (t && t.status === 'new') t.kind = 'gate';
    }
    // recompute the cost with the gates
    const cost = {};
    for (const t of plan.tiles) if (t.status === 'new')
      for (const [k, v] of Object.entries(BUILDINGS[t.kind].cost)) cost[k] = (cost[k] || 0) + v;
    plan.cost = cost;
    return plan;
  }

  // towers: beside the front gate first, then on the corners
  towerSpots() {
    const spots = [
      { u: this.front - 2, v: -2 }, { u: this.front - 2, v: 3 },
      { u: this.front - 2, v: this.top + 2 }, { u: this.front - 2, v: this.bottom - 2 },
      { u: this.back + 2, v: this.top + 2 }, { u: this.back + 2, v: this.bottom - 2 },
    ];
    return spots.map(p => this.tile(p.u, p.v))
      .filter(t => this.inMap(t) && this.scene.grid.isFree(t.tx, t.ty) && this.freeAround(t));
  }

  freeAround(t) {
    // a tower may touch the wall, but needs at least 2 free neighbours to be reachable
    const g = this.scene.grid;
    return [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => g.isFree(t.tx + dx, t.ty + dy)).length >= 2;
  }
}
