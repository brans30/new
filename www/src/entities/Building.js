import { Entity } from './Entity.js';
import { BUILDINGS, UNITS, UPGRADES, TILE, canTrainKind, raceOf, upLevel, upValue } from '../data/config.js';

// Building: may be under construction, may train units, shoot (tower/keep),
// produce income (mill), or be a wall piece that auto-connects to its neighbours.
export class Building extends Entity {
  constructor(scene, tx, ty, kind, team, complete = false) {
    const def = BUILDINGS[kind];
    const size = def.size;
    // tx,ty = top-left tile of the footprint
    // orcs build wooden walls and towers: weaker than stone
    const hp = Math.round(def.hp * ((def.wall || kind === 'tower') ? raceOf(team).wallHp : 1));
    super(scene, (tx + size / 2) * TILE, (ty + size / 2) * TILE, def.sheet.replace('{team}', team), def.frame, team, hp);
    this.kind = kind;
    this.def = def;
    this.tx = tx; this.ty = ty; this.size = size;
    this.radius = size * TILE / 2 - 1;
    this.depth = this.y + this.radius;
    this.queue = [];            // unit kinds waiting to be trained
    this.trainElapsed = 0;
    this.lastShot = 0;
    this.incomeElapsed = 0;
    this.complete = complete;
    this.progress = complete ? 1 : 0;
    this.finalLook = [def.sheet.replace('{team}', team), def.frame];
    this.stage = -1;
    this.garrison = 0;          // workers hiding inside (keep)
    this.healElapsed = 0;
    // stone-wall upgrade: walls, gates and towers are twice as tough
    if ((def.wall || kind === 'tower') && upLevel(scene.eco?.[team], 'masonry')) { this.maxHp = Math.round(this.maxHp * (1 + upValue(scene.eco[team], 'masonry'))); this.hp = this.maxHp; }
    if (!complete) {
      this.hp = Math.max(1, def.hp * 0.1);
      if (def.wall) this.setAlpha(0.45);       // walls just fade in
      else this.showStage(0);
    }
  }

  // construction look: 0 = marked plot, 1 = stone foundation, 2 = wooden frame
  showStage(stage) {
    if (stage === this.stage || this.def.wall) return;
    this.stage = stage;
    const wip = this.def.wip;
    if (stage === 0) this.setTexture('construction', 0);
    else if (stage === 1) this.setTexture('construction', 1);
    else if (wip) this.setTexture(wip[0].replace('{team}', this.team), wip[1]);
    if (stage > 0) this.pop();
  }

  pop() {
    this.scene.tweens.add({ targets: this, scaleX: 1.12, scaleY: 0.9, duration: 90, yoyo: true, ease: 'Quad.easeOut' });
    this.scene.dust?.(this.x, this.y + this.radius - 2);
  }

  tilesIndex(w) {
    const s = new Set();
    for (let y = 0; y < this.size; y++) for (let x = 0; x < this.size; x++) s.add((this.ty + y) * w + this.tx + x);
    return s;
  }

  addBuildProgress(dt) {
    if (this.complete) return;
    const step = dt / this.def.buildTime;
    this.progress = Math.min(1, this.progress + step);
    this.hp = Math.min(this.maxHp, this.hp + this.maxHp * step * 0.9);
    if (this.def.wall) this.setAlpha(0.45 + 0.55 * this.progress);
    else this.showStage(this.progress < 0.3 ? 0 : this.progress < 0.62 ? 1 : 2);
    if (this.progress >= 1) {
      this.complete = true;
      this.setAlpha(1);
      if (!this.def.wall) { this.setTexture(this.finalLook[0], this.finalLook[1]); this.pop(); }
      this.scene.onBuildingComplete(this);
    }
  }

  canTrain(kind) { return this.complete && (this.def.trains || []).includes(kind) && canTrainKind(kind, this.team); }

  // queue items are unit kinds, or 'up:<upgrade>' for research
  // research items are 'up:<key>:<level>'
  static itemTime(item) { if (!item.startsWith('up:')) return UNITS[item].trainTime; const [, k, l] = item.split(':'); return UPGRADES[k].times[(+l || 1) - 1]; }

  update(time, dt) {
    if (!this.alive || !this.complete) return;
    const d = this.def;

    // defensive buildings shoot at the nearest enemy.
    // Workers hiding in the keep add arrows: one extra target for every 2 workers inside.
    if (d.attack && time - this.lastShot >= d.attack.rate) {
      const volley = 1 + Math.floor(this.garrison / 2);
      const targets = this.scene.findEnemiesNear(this, d.attack.range, volley);
      if (targets.length) {
        this.lastShot = time;
        // (the tower may be destroyed before the later arrows of the volley leave)
        const sc = this.scene;
        targets.forEach((e, i) => sc.time.delayedCall(i * 90, () => this.alive && e.alive && sc.fireProjectile(this, e, d.attack.damage, 'arrow')));
      }
    }

    // the well heals our wounded soldiers around it
    if (d.heal) {
      this.healElapsed += dt;
      if (this.healElapsed >= d.heal.every) {
        this.healElapsed = 0;
        for (const u of this.scene.units) {
          if (u.alive && u.team === this.team && u.hp < u.maxHp && Math.hypot(u.x - this.x, u.y - this.y) <= d.heal.radius)
            this.scene.heal(u, d.heal.amount, this);
        }
      }
    }

    // passive income
    if (d.income) {
      this.incomeElapsed += dt;
      if (this.incomeElapsed >= d.income.every) {
        this.incomeElapsed = 0;
        this.scene.deposit(this.team, { type: d.income.type, amount: d.income.amount }, this);
      }
    }

    // training / research queue
    if (!this.queue.length) return;
    const item = this.queue[0];
    this.trainElapsed += dt;
    if (this.trainElapsed >= Building.itemTime(item)) {
      if (item.startsWith('up:')) {
        this.trainElapsed = 0; this.queue.shift();
        this.scene.completeUpgrade(this.team, item.split(':')[1]);
        return;
      }
      if (!this.scene.hasPopRoom(this.team)) return;   // wait for a house
      this.trainElapsed = 0;
      this.queue.shift();
      this.scene.spawnUnitFrom(this, item);
    }
  }

  get trainProgress() {
    return this.queue.length ? this.trainElapsed / Building.itemTime(this.queue[0]) : 0;
  }

  // ----- walls: pick the sprite that matches the neighbours -----
  // mask bits: N=1 E=2 S=4 W=8   (frames 0..15), gate: 16 horizontal / 17 vertical
  updateWallFrame() {
    if (!this.def.wall || this.def.noTile) return;
    const g = this.scene.grid;
    const same = (x, y) => { const e = g.get(x, y); return e && e.def?.wall && !e.def.noTile && e.team === this.team; };
    const m = (same(this.tx, this.ty - 1) ? 1 : 0) | (same(this.tx + 1, this.ty) ? 2 : 0)
            | (same(this.tx, this.ty + 1) ? 4 : 0) | (same(this.tx - 1, this.ty) ? 8 : 0);
    if (this.def.gate) this.setFrame((m & 5) && !(m & 10) ? 17 : 16);
    else this.setFrame(m);
  }
}
