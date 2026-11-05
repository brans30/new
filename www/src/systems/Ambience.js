import { TILE, TEAMS } from '../data/config.js';
import { T } from './Terrain.js';

// =====================================================================
//  Life on the map. Nothing here changes the game rules; it only makes
//  the world feel alive:
//   - windmills turn, chimneys smoke, forges glow
//   - damaged buildings smoke and burn, hits shake them, ruins stay a while
//   - fish and turtles swim in the lakes, wild horses wander and shy away
// =====================================================================
const SMOKE = { house: 0.35, keep: 0.3, blacksmith: 0.6, workshop: 0.5, tavern: 0.45, market: 0.15, chapel: 0.1, barracks: 0.15 };
const GLOW = { blacksmith: 0xff7a1a, workshop: 0xff9a2a };

export class Ambience {
  constructor(scene) {
    this.scene = scene;
    this.t = 0;
    this.makeAnims();
    this.animals = [];
    this.spawnSeaLife();
    this.spawnHorses();
  }

  makeAnims() {
    const a = this.scene.anims;
    for (const team of TEAMS) {
      if (!a.exists('mill_' + team)) a.create({ key: 'mill_' + team, frames: a.generateFrameNumbers('resources_' + team, { start: 3, end: 5 }), frameRate: 5, repeat: -1 });
    }
    if (!a.exists('turtle')) a.create({ key: 'turtle', frames: a.generateFrameNumbers('marine', { frames: [0, 1] }), frameRate: 2, repeat: -1 });
    // horse sheet (32px, 4 frames a row): rows 0-1 facing down, 2-3 facing right, 4-5 facing up
    // (left = mirrored right). First row of each pair = walk, second = gallop.
    const h = (key, row, fps) => !a.exists(key) && a.create({ key, frames: a.generateFrameNumbers('horse', { start: row * 4, end: row * 4 + 3 }), frameRate: fps, repeat: -1 });
    h('hw_down', 0, 6); h('hr_down', 1, 11); h('hw_side', 2, 6); h('hr_side', 3, 11); h('hw_up', 4, 6); h('hr_up', 5, 11);
  }

  // ---------------- buildings ----------------
  onBuilt(b) {
    if (b.kind === 'mill') b.play('mill_' + b.team);
    if (GLOW[b.kind] && !b.glow) {
      b.glow = this.scene.add.circle(b.x - 2, b.y + 4, 2.4, GLOW[b.kind], 0.85).setDepth(b.depth + 1).setBlendMode(Phaser.BlendModes.ADD);
      this.scene.tweens.add({ targets: b.glow, alpha: 0.25, scale: 1.4, duration: 380 + Math.random() * 200, yoyo: true, repeat: -1 });
    }
  }

  onHit(b) {
    if (b.def.wall || b.shaking) return;
    b.shaking = true;
    const x0 = b.x;
    this.scene.tweens.add({ targets: b, x: x0 + 1, duration: 35, yoyo: true, repeat: 1, onComplete: () => { b.x = x0; b.shaking = false; } });
  }

  onDestroyed(b) {
    const s = this.scene;
    b.glow?.destroy(); b.fire?.destroy();
    if (s.fx && !s.fx.onScreen(b.x, b.y, 80)) return;           // nobody sees it: no dust, no rubble
    s.dust(b.x, b.y + 4);
    const n = b.def.wall ? 1 : b.size * b.size;
    for (let i = 0; i < n; i++) {
      const r = s.add.image(b.x + (i % b.size) * 8 - (b.size - 1) * 4, b.y + Math.floor(i / b.size) * 8 - (b.size - 1) * 4, 'rubble')
        .setDepth(b.y - 8).setScale(b.def.wall ? 0.7 : 1).setFlipX(Math.random() < 0.5);
      s.tweens.add({ targets: r, alpha: 0, delay: 25000, duration: 3000, onComplete: () => r.destroy() });
    }
  }

  // ---------------- every frame ----------------
  update(dt) {
    this.t += dt;
    for (const a of this.animals) a.update(dt);
    if (this.t < 650) return;
    this.t = 0;
    const s = this.scene, cam = s.cameras.main.worldView;
    for (const b of s.buildings) {
      if (!b.alive || !b.complete) continue;
      const visible = Phaser.Geom.Rectangle.Contains(cam, b.x, b.y) || Phaser.Geom.Rectangle.Contains(cam, b.x, b.y + 20);
      const hurt = b.hp / b.maxHp;
      // fire on badly damaged buildings
      if (hurt < 0.25 && !b.def.wall && !b.fire) {
        b.fire = s.add.sprite(b.x + 2, b.y - 3, 'fireball', 1).setDepth(b.depth + 2).setScale(0.8);
        s.tweens.add({ targets: b.fire, scaleY: 1.05, scaleX: 0.65, alpha: 0.75, duration: 160, yoyo: true, repeat: -1 });
      } else if (hurt >= 0.3 && b.fire) { b.fire.destroy(); b.fire = null; }
      if (!visible) continue;
      if (hurt < 0.5 && !b.def.wall && Math.random() < 0.8) this.puff(b, true);        // dark smoke when damaged
      else if (SMOKE[b.kind] && Math.random() < SMOKE[b.kind]) this.puff(b, false);   // chimney smoke
    }
    // a sparkle on the water now and then
    if (s.terrain && Math.random() < 0.6) this.sparkle();
  }

  // smoke is a particle from a shared emitter (Effects.js): no new object per puff
  puff(b, dark) {
    const x = b.x + (b.kind === 'keep' ? Phaser.Math.Between(-8, 8) : 3), y = b.y - b.radius - 1;
    this.scene.fx?.smoke(x, y, dark);
  }

  sparkle() {
    const s = this.scene, ter = s.terrain;
    for (let tries = 0; tries < 6; tries++) {
      const tx = Phaser.Math.Between(0, ter.w - 1), ty = Phaser.Math.Between(0, ter.h - 1);
      if (!ter.isWater(tx, ty)) continue;
      s.fx?.glint((tx + Math.random()) * TILE, (ty + Math.random()) * TILE);
      return;
    }
  }

  // ---------------- animals ----------------
  waterTiles() {
    const ter = this.scene.terrain, list = [];
    for (let y = 0; y < ter.h; y++) for (let x = 0; x < ter.w; x++) {
      // deep enough: all 4 neighbours are water too
      if (ter.isWater(x, y) && ter.isWater(x + 1, y) && ter.isWater(x - 1, y) && ter.isWater(x, y + 1) && ter.isWater(x, y - 1)) list.push({ x, y });
    }
    return list;
  }

  spawnSeaLife() {
    const s = this.scene;
    if (!s.terrain) return;
    const water = this.waterTiles();
    if (!water.length) return;
    // group water tiles by lake (simple flood fill)
    const key = (t) => t.x + ',' + t.y;
    const left = new Map(water.map(t => [key(t), t]));
    const lakes = [];
    while (left.size) {
      const start = left.values().next().value; left.delete(key(start));
      const lake = [start], q = [start];
      while (q.length) {
        const c = q.pop();
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const k = (c.x + dx) + ',' + (c.y + dy);
          if (left.has(k)) { const n = left.get(k); left.delete(k); lake.push(n); q.push(n); }
        }
      }
      lakes.push(lake);
    }
    for (const lake of lakes) {
      const fish = Math.min(3, 1 + Math.floor(lake.length / 6));
      for (let i = 0; i < fish; i++) this.animals.push(new Swimmer(s, lake, 'fish', 2 + (i % 3)));
      if (lake.length >= 6) this.animals.push(new Swimmer(s, lake, 'turtle', 0));
    }
  }

  spawnHorses() {
    const s = this.scene;
    for (const [x, y] of s.plan?.horses || []) {
      if (s.grid.isFree(x, y)) this.animals.push(new Horse(s, (x + 0.5) * TILE, (y + 0.5) * TILE));
    }
  }
}

// fish / turtle moving between deep water tiles of one lake
class Swimmer {
  constructor(scene, tiles, kind, col) {
    this.s = scene; this.tiles = tiles; this.kind = kind; this.col = col;
    const t = Phaser.Utils.Array.GetRandom(tiles);
    this.sp = scene.add.sprite((t.x + 0.5) * TILE, (t.y + 0.5) * TILE, 'marine', kind === 'turtle' ? 0 : col).setDepth(-8.7).setAlpha(0.9);
    if (kind === 'turtle') { this.sp.play('turtle'); this.sp.setScale(0.8); }
    else this.sp.setScale(0.75);
    this.wait = Math.random() * 2000;
    this.target = null;
  }
  update(dt) {
    if (this.wait > 0) { this.wait -= dt; return; }
    if (!this.target) {
      const t = Phaser.Utils.Array.GetRandom(this.tiles);
      this.target = { x: (t.x + Math.random()) * TILE, y: (t.y + Math.random()) * TILE };
      // fish dive and come back up
      if (this.kind === 'fish') this.s.tweens.add({ targets: this.sp, alpha: Phaser.Math.FloatBetween(0.35, 0.95), duration: 800 });
    }
    const dx = this.target.x - this.sp.x, dy = this.target.y - this.sp.y, d = Math.hypot(dx, dy);
    const speed = this.kind === 'turtle' ? 4 : 11;
    if (d < 1) { this.target = null; this.wait = 600 + Math.random() * 2500; return; }
    const step = Math.min(d, speed * dt / 1000);
    this.sp.x += dx / d * step; this.sp.y += dy / d * step;
    if (this.kind === 'fish') {
      // marine sheet: fish rows 0 up, 1 left, 2 right, 3 down
      const row = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 1 : 2) : (dy < 0 ? 0 : 3);
      this.sp.setFrame(row * 5 + this.col);
    }
  }
}

// wild horse: grazes, then walks a few tiles along a real path (never through
// trees, buildings, water or cliffs). Gallops away when a unit comes close.
const HORSE_FRAME = { down: 0, side: 8, up: 16 };   // standing still = first walk frame
class Horse {
  constructor(scene, x, y) {
    this.s = scene;
    this.sp = scene.add.sprite(x, y, 'horse', 0).setOrigin(0.5, 0.7);
    this.dir = 'down';
    this.path = [];
    this.run = false;
    this.wait = 500 + Math.random() * 3000;
    this.look = 0;
  }
  tile() { return { x: Math.floor(this.sp.x / TILE), y: Math.floor(this.sp.y / TILE) }; }

  // stand still on one frame, now and then turn the head the other way
  stand() {
    this.sp.anims.stop();
    this.sp.setFrame(HORSE_FRAME[this.dir]);
  }
  setDir(dx, dy) {
    // a little hysteresis so it doesn't flicker between side and up/down on diagonals
    const side = this.dir === 'side' ? Math.abs(dx) > Math.abs(dy) * 0.6 : Math.abs(dx) > Math.abs(dy) * 1.4;
    this.dir = side ? 'side' : (dy < 0 ? 'up' : 'down');
    if (side && Math.abs(dx) > 0.3) this.sp.setFlipX(dx < 0);
  }
  // plan a path to a free tile `min..max` tiles away, optionally away from a point
  plan(min, max, from) {
    const g = this.s.grid, t = this.tile();
    for (let tries = 0; tries < 12; tries++) {
      let a = Math.random() * Math.PI * 2;
      if (from) a = Math.atan2(this.sp.y - from.y, this.sp.x - from.x) + (Math.random() - 0.5) * 1.2;
      const r = min + Math.random() * (max - min);
      const gx = Math.round(t.x + Math.cos(a) * r), gy = Math.round(t.y + Math.sin(a) * r);
      if (!g.isFree(gx, gy)) continue;
      const path = g.findPath(t.x, t.y, gx, gy, {});
      const last = path[path.length - 1];
      if (!last || last.x !== gx || last.y !== gy || path.length > max * 2) continue;
      // walk to a random spot inside each tile so herds don't line up on the grid
      this.path = path.map((p, i) => ({
        x: (p.x + 0.5) * TILE + (i === path.length - 1 ? (Math.random() - 0.5) * 6 : 0),
        y: (p.y + 0.5) * TILE + (i === path.length - 1 ? (Math.random() - 0.5) * 6 : 0),
      }));
      return true;
    }
    return false;
  }
  update(dt) {
    const sp = this.sp;
    sp.depth = sp.y;
    if (this.s.speed === 0) { sp.anims.pause(); return; }
    if (sp.anims.isPaused) sp.anims.resume();
    dt *= this.s.speed;

    // someone close? gallop away from them
    if (!this.run) {
      const near = this.s.units.find(u => u.alive && !u.hidden && Math.hypot(u.x - sp.x, u.y - sp.y) < 28);
      if (near && this.plan(3, 5, near)) { this.run = true; this.wait = 0; }
    }
    if (this.wait > 0) {
      this.wait -= dt;
      // grazing: look the other way once in a while
      if ((this.look -= dt) < 0) {
        this.look = 1800 + Math.random() * 2500;
        if (this.dir === 'side' && Math.random() < 0.4) sp.setFlipX(!sp.flipX);
      }
      return;
    }
    if (!this.path.length && !this.plan(2, 5)) { this.wait = 800; return; }

    const p = this.path[0];
    const dx = p.x - sp.x, dy = p.y - sp.y, d = Math.hypot(dx, dy);
    const step = (this.run ? 38 : 13) * dt / 1000;
    if (d <= step) {
      sp.x = p.x; sp.y = p.y;
      this.path.shift();
      // the way got blocked (someone built there)? stop and think again
      if (this.path.length && !this.s.grid.isFree(Math.floor(this.path[0].x / TILE), Math.floor(this.path[0].y / TILE))) this.path = [];
      if (!this.path.length) {
        this.run = false;
        this.stand();
        this.wait = 2000 + Math.random() * 5000;
      }
      return;
    }
    sp.x += dx / d * step; sp.y += dy / d * step;
    this.setDir(dx, dy);
    sp.play((this.run ? 'hr_' : 'hw_') + this.dir, true);
  }
}

export { T };
