import { RESOURCES, TILE } from '../data/config.js';
import { Worker } from '../entities/Worker.js';

// Smart worker distribution (used by the player AND the enemy AI).
//
// 1) Decide how many workers each resource should get ("targets"):
//      base share  x  low stock bonus  x  shortage bonus  x  player priority
//    - low stock: the less we have, the more workers it gets
//    - shortage:  we tried to buy something and were missing this resource
//    - priority:  the player taps a resource in the top bar (normal / high / off)
// 2) Every worker re-decides when it drops off a load: stay, or switch to
//    the resource that is furthest below its target.
// 3) Idle workers are put to work automatically.
// 4) Every few seconds, if one resource is badly under target, one worker
//    from an over-staffed resource is moved right away.
// A worker you command by hand is left alone for a while ("manual").
const BASE = { gold: 0.38, wood: 0.47, stone: 0.15 };
const COMFORT = { gold: 200, wood: 200, stone: 60 };   // stock we're happy with
export const PRIORITY_STEPS = [1, 2.5, 0];        // normal -> high -> off

export class WorkerManager {
  constructor(scene, team) {
    this.scene = scene;
    this.team = team;
    this.auto = true;
    this.priority = { gold: 1, wood: 1, stone: 1 };
    this.t = 0;
    this.rebalanceT = 0;
  }

  get eco() { return this.scene.eco[this.team]; }
  get now() { return this.scene.simTime; }

  workers() {
    return this.scene.units.filter(u => u.alive && u.team === this.team && u instanceof Worker);
  }
  isManual(w) { return w.manualUntil && w.manualUntil > this.now; }

  cyclePriority(type) {
    const i = PRIORITY_STEPS.indexOf(this.priority[type]);
    this.priority[type] = PRIORITY_STEPS[(i + 1) % PRIORITY_STEPS.length];
    this.rebalanceT = 99999;          // react right away
    return this.priority[type];
  }

  // ---------- how many workers should be on each resource ----------
  weights() {
    const res = this.eco.res, w = {};
    for (const k of RESOURCES) {
      let v = BASE[k];
      v *= Phaser.Math.Clamp((COMFORT[k] + 80) / ((res[k] || 0) + 80), 0.25, 2.5);   // low stock -> more
      const short = this.eco.shortage(k);
      if (short > 0) v *= 1 + Math.min(2, short / 60);                // we need it now
      v *= this.priority[k];
      if (!this.scene.nodes.some(n => n.alive && n.type === k && n.canGather(this.team) && !this.scene.isDangerous(this.team, n.x, n.y))) v = 0; // nothing we can safely mine
      w[k] = v;
    }
    const sum = Object.values(w).reduce((a, b) => a + b, 0) || 1;
    for (const k of RESOURCES) w[k] /= sum;
    return w;
  }

  // integer targets that add up to n (largest remainder)
  targets(n) {
    const w = this.weights(), t = {}, rest = [];
    let used = 0;
    for (const k of RESOURCES) { t[k] = Math.floor(w[k] * n); used += t[k]; rest.push([k, w[k] * n - t[k]]); }
    rest.sort((a, b) => b[1] - a[1]);
    for (let i = 0; used < n && i < rest.length; i++) if (w[rest[i][0]] > 0) { t[rest[i][0]]++; used++; }
    return t;
  }

  counts(exclude = null) {
    const c = { gold: 0, wood: 0, stone: 0 };
    for (const w of this.workers()) {
      if (w === exclude || !w.lastType) continue;
      if (w.state === 'gather' || w.state === 'return') c[w.lastType]++;
    }
    return c;
  }

  gathererCount() {
    return this.workers().filter(w => w.state !== 'build').length;
  }

  // the resource this worker should gather next
  chooseType(worker) {
    const t = this.targets(this.gathererCount());
    const c = this.counts(worker);
    const cur = worker.lastType;
    if (cur && c[cur] < t[cur]) return cur;               // still needed here: stay (no ping-pong)
    let best = null, bestGap = -Infinity;
    for (const k of RESOURCES) {
      if (t[k] === 0 && this.priority[k] === 0) continue;
      const gap = t[k] - c[k];
      if (gap > bestGap) { bestGap = gap; best = k; }
    }
    return best || cur || 'wood';
  }

  // The best node for this worker:
  //  - close to the worker first (a whole trip is: walk there, then carry it home)
  //  - strongly prefers resources right next to a storehouse / the keep (short trips)
  //  - not crowded (one worker per tree or rock, up to 5 in a mine)
  //  - never into enemy fire, never a mine owned by the other side
  pickNode(worker, type, maxDist = Infinity) {
    const s = this.scene;
    const drops = s.buildings.filter(b => b.alive && b.complete && b.team === this.team && b.def.dropOff);
    const crowd = new Map();
    for (const w of this.workers()) if (w !== worker && w.node) crowd.set(w.node, (crowd.get(w.node) || 0) + 1);
    let best = null, bestScore = Infinity;
    for (const n of s.nodes) {
      if (!n.alive || n.type !== type || !s.reachable(n)) continue;
      if (!n.canGather(this.team)) continue;                      // a mine owned by the other side
      if (n.unreachable?.[this.team] > this.now) continue;        // our workers couldn't get to it lately
      if (s.isDangerous(this.team, n.x, n.y)) continue;          // don't send workers into enemy fire
      const toNode = Phaser.Math.Distance.Between(worker.x, worker.y, n.x, n.y);
      if (toNode > maxDist) continue;
      let toDrop = Infinity;
      for (const d of drops) toDrop = Math.min(toDrop, Phaser.Math.Distance.Between(n.x, n.y, d.x, d.y));
      if (toDrop === Infinity) toDrop = 0;
      const capacity = n.def?.mine ? 5 : 1;   // mines fit several workers
      const crowdPenalty = Math.max(0, (crowd.get(n) || 0) - capacity + 1) * TILE * 4;
      // right beside a drop-off (within 4 tiles): a bonus, these trips are the shortest
      const besideStore = toDrop < TILE * 4 ? TILE * 3 : 0;
      const score = toNode * 0.8 + toDrop * 1.3 + crowdPenalty - besideStore;
      if (score < bestScore) { bestScore = score; best = n; }
    }
    return best;
  }

  assign(w) {
    const type = this.chooseType(w);
    const node = this.pickNode(w, type);
    if (node) w.command({ type: 'gather', node, auto: true });
    return !!node;
  }

  // called by a worker right after it drops off a load: switch resource if another is
  // needed more, or switch to a much better spot (e.g. a new storehouse was built next to a forest)
  onDeposit(w) {
    if (!this.auto || this.isManual(w)) return;
    const type = this.chooseType(w);
    if (type !== w.lastType || !w.node?.alive) {
      const node = this.pickNode(w, type);
      if (node) { w.node = node; w.lastType = type; w.path = null; }
      return;
    }
    const cur = w.node, best = this.pickNode(w, type);
    if (!best || best === cur || cur.def.mine) return;
    const trip = (n) => {
      let toDrop = Infinity;
      for (const b of this.scene.buildings) if (b.alive && b.complete && b.team === this.team && b.def.dropOff) toDrop = Math.min(toDrop, Math.hypot(n.x - b.x, n.y - b.y));
      return Math.hypot(n.x - w.x, n.y - w.y) + toDrop * 2;
    };
    if (trip(best) < trip(cur) * 0.65) { w.node = best; w.path = null; }
  }

  update(dt) {
    this.t += dt; this.rebalanceT += dt;
    if (this.t < 1000) return;
    this.t = 0;
    if (!this.auto) return;
    const workers = this.workers();
    for (const w of workers) if (w.state === 'idle' && !this.isManual(w)) this.assign(w);

    // move one worker now if a resource is badly under-staffed
    if (this.rebalanceT < 4000) return;
    this.rebalanceT = 0;
    const t = this.targets(this.gathererCount()), c = this.counts();
    const need = RESOURCES.filter(k => t[k] - c[k] >= 2 || (c[k] === 0 && t[k] > 0)).sort((a, b) => (t[b] - c[b]) - (t[a] - c[a]))[0];
    const extra = RESOURCES.filter(k => c[k] - t[k] >= 1).sort((a, b) => (c[b] - t[b]) - (c[a] - t[a]))[0];
    if (!need || !extra) return;
    const mover = workers.filter(w => w.state === 'gather' && w.lastType === extra && !w.carrying && !this.isManual(w))
      .sort((a, b) => this.distToType(a, need) - this.distToType(b, need))[0];
    if (mover) {
      const node = this.pickNode(mover, need);
      if (node) mover.command({ type: 'gather', node, auto: true });
    }
  }

  distToType(w, type) {
    const n = this.scene.findNearestNode(w.x, w.y, type, Infinity, this.team);
    return n ? Phaser.Math.Distance.Squared(w.x, w.y, n.x, n.y) : Infinity;
  }
}
