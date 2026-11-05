import { t } from '../i18n.js';
import { BUILDINGS, TILE, TEAM } from '../data/config.js';
import { Worker } from '../entities/Worker.js';

// Smart walls:
//  1) tap a start point, 2) tap (or hover) an end point.
//  - nearly straight lines snap to perfectly straight
//  - otherwise the wall turns once (L shape) along the longer side first
//  - tiles with trees/buildings are skipped, existing walls are reused
//  - long walls get a gate automatically in the middle of a straight part
//  - pieces auto-connect (corners, T-junctions, crosses)
//  - workers build the pieces in order, always the nearest one next
//
// planWall / buildWall are plain functions so the enemy AI uses the same code.

export function wallLine(a, b) {
  let dx = b.tx - a.tx, dy = b.ty - a.ty;
  // snap: almost horizontal / vertical -> straight
  if (Math.abs(dy) <= 1 && Math.abs(dx) >= 3) dy = 0;
  if (Math.abs(dx) <= 1 && Math.abs(dy) >= 3) dx = 0;
  const tiles = [];
  const sx = Math.sign(dx), sy = Math.sign(dy);
  let x = a.tx, y = a.ty;
  tiles.push({ tx: x, ty: y });
  const horizFirst = Math.abs(dx) >= Math.abs(dy);
  const walk = (axis) => {
    if (axis === 'x') while (x !== a.tx + dx) { x += sx; tiles.push({ tx: x, ty: y }); }
    else while (y !== a.ty + dy) { y += sy; tiles.push({ tx: x, ty: y }); }
  };
  if (horizFirst) { walk('x'); walk('y'); } else { walk('y'); walk('x'); }
  return tiles;
}

export function planWall(scene, team, a, b, autoGate = true, kind = 'wall') {
  if (kind !== 'wall') autoGate = false;
  const grid = scene.grid;
  const tiles = wallLine(a, b).map(t => {
    const e = grid.get(t.tx, t.ty);
    let status = 'new';
    if (e === undefined) status = 'blocked';
    else if (e && e.def?.wall && e.team === team) status = 'have';
    else if (e) status = 'blocked';
    return { ...t, status: status === 'have' && kind !== 'wall' ? 'blocked' : status, kind };
  });
  // automatic gate: middle of the longest straight run of new pieces (needs >= 5)
  if (autoGate) {
    const fresh = tiles.filter(t => t.status === 'new');
    if (fresh.length >= 5) {
      const straight = (i) => {
        const p = tiles[i - 1], n = tiles[i + 1];
        return p && n && (p.tx === n.tx || p.ty === n.ty) && tiles[i].status === 'new'
          && p.status !== 'blocked' && n.status !== 'blocked';
      };
      const mid = Math.floor(tiles.length / 2);
      let best = -1;
      for (let k = 0; k < tiles.length; k++) {
        for (const i of [mid - k, mid + k]) if (best < 0 && straight(i)) best = i;
        if (best >= 0) break;
      }
      if (best >= 0) tiles[best].kind = 'gate';
    }
  }
  const cost = {};
  for (const t of tiles) if (t.status === 'new')
    for (const [k, v] of Object.entries(BUILDINGS[t.kind].cost)) cost[k] = (cost[k] || 0) + v;
  return { tiles, cost, count: tiles.filter(t => t.status === 'new').length };
}

export function buildWall(scene, team, plan, builders) {
  const eco = scene.eco[team];
  if (!plan.count) return null;
  if (!eco.spend(plan.cost)) return null;
  const sites = [];
  for (const t of plan.tiles) {
    if (t.status !== 'new' || !scene.grid.isFree(t.tx, t.ty)) continue;
    if (scene.terrain && !scene.terrain.buildable(t.tx, t.ty)) continue;
    sites.push(scene.addBuilding(t.tx, t.ty, t.kind, team, false));
  }
  if (!sites.length) return null;
  // split the line into chunks: each worker starts on its own part, then helps the rest
  const n = Math.max(1, builders.length);
  const chunk = Math.ceil(sites.length / n);
  builders.forEach((w, i) => {
    const first = sites[Math.min(sites.length - 1, i * chunk)];
    w.command({ type: 'build', building: first, queue: sites });
  });
  return sites;
}

// ---------------- the interactive tool for the player ----------------
export class WallTool {
  constructor(scene) {
    this.scene = scene;
    this.autoGate = true;
    this.kind = 'wall';          // 'wall' or 'barrier'
    this.pool = [];
    this.reset();
  }

  reset() {
    this.start = null;
    this.end = null;
    this.endChosen = false;
    this.plan = null;
    this.draw();
  }

  // start -> (end chosen by a 2nd tap, or by hovering with a mouse) -> ready
  get stage() {
    if (!this.start) return 'start';
    return (this.endChosen || this.end.tx !== this.start.tx || this.end.ty !== this.start.ty) && this.plan?.count ? 'ready' : 'end';
  }

  tap(tx, ty) {
    if (!this.start) { this.start = { tx, ty }; this.end = { tx, ty }; this.endChosen = false; }
    else { this.end = { tx, ty }; this.endChosen = true; }     // tapping the start again = a single piece
    this.replan();
  }

  hover(tx, ty) {
    if (!this.start || this.endChosen || (this.end.tx === tx && this.end.ty === ty)) return;
    this.end = { tx, ty };
    this.replan();
  }

  toggleGate() { this.autoGate = !this.autoGate; this.replan(); }

  replan() {
    this.plan = this.start ? planWall(this.scene, TEAM.PLAYER, this.start, this.end, this.autoGate, this.kind) : null;
    this.draw();
    this.scene.events.emit('placing', 'wall');
  }

  confirm() {
    const s = this.scene;
    if (!this.plan?.count) return false;
    if (!s.economy.canAfford(this.plan.cost)) {
      s.economy.noteShort(this.plan.cost);
      s.events.emit('toast', t('❌ موارد غير كافية — العمال سيجمعون الناقص')); return false;
    }
    // builders: the selected workers, otherwise the 3 workers closest to the wall
    let builders = s.selected.filter(u => u instanceof Worker && u.alive);
    if (!builders.length) {
      const mid = this.plan.tiles[Math.floor(this.plan.tiles.length / 2)];
      const mx = mid.tx * TILE, my = mid.ty * TILE;
      builders = s.units.filter(u => u.alive && u.team === TEAM.PLAYER && u instanceof Worker)
        .sort((a, b) => Phaser.Math.Distance.Squared(a.x, a.y, mx, my) - Phaser.Math.Distance.Squared(b.x, b.y, mx, my))
        .slice(0, 3);
    }
    const sites = buildWall(s, TEAM.PLAYER, this.plan, builders);
    if (sites) s.events.emit('toast', this.kind === 'barrier' ? `🔱 ${sites.length} ${t('حاجز رماح قيد البناء')}` : `🧱 ${sites.length} ${t('قطعة سور قيد البناء')}`);
    this.reset();
    return !!sites;
  }

  // preview sprites, auto-connected like the real thing
  draw() {
    this.pool.forEach(sp => sp.setVisible(false));
    if (!this.plan) {
      if (this.start) this.sprite(0).setTexture(this.kind === 'barrier' ? 'spearwall' : 'walls_cyan', 0)
        .setPosition((this.start.tx + .5) * TILE, (this.start.ty + .5) * TILE).setTint(0x88ff88).setVisible(true);
      return;
    }
    const s = this.scene;
    const planned = new Set(this.plan.tiles.filter(t => t.status !== 'blocked').map(t => t.tx + ',' + t.ty));
    const isWall = (x, y) => {
      if (planned.has(x + ',' + y)) return true;
      const e = s.grid.get(x, y);
      return e && e.def?.wall && e.team === TEAM.PLAYER;
    };
    this.plan.tiles.forEach((t, i) => {
      const sp = this.sprite(i).setPosition((t.tx + .5) * TILE, (t.ty + .5) * TILE).setVisible(true);
      if (t.status === 'have') { sp.setVisible(false); return; }
      const m = (isWall(t.tx, t.ty - 1) ? 1 : 0) | (isWall(t.tx + 1, t.ty) ? 2 : 0)
              | (isWall(t.tx, t.ty + 1) ? 4 : 0) | (isWall(t.tx - 1, t.ty) ? 8 : 0);
      if (this.kind === 'barrier') { sp.setTexture('spearwall', 0).setTint(t.status === 'blocked' ? 0xff4040 : 0xb8ffb8); return; }
      sp.setTexture('walls_cyan');
      if (t.status === 'blocked') sp.setFrame(0).setTint(0xff4040);
      else if (t.kind === 'gate') sp.setFrame((m & 5) && !(m & 10) ? 17 : 16).setTint(0xb8ffb8);
      else sp.setFrame(m).setTint(0xb8ffb8);
    });
  }

  sprite(i) {
    while (this.pool.length <= i) {
      this.pool.push(this.scene.add.sprite(0, 0, 'walls_cyan', 0).setAlpha(0.7).setDepth(99997).setVisible(false));
    }
    return this.pool[i];
  }
}
