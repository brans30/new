import { hostile, allied } from '../systems/Match.js';
import { Entity } from './Entity.js';
import { UNITS, TILE, upValue } from '../data/config.js';
import { Grid } from '../systems/Grid.js';

const DIRS = ['down', 'up', 'right', 'left'];

// Base unit: pathfinding movement, animation, simple separation.
// Behaviour is a small state machine: each state has its own method
// (state_idle, state_move, ...) and subclasses add their own states.
export class Unit extends Entity {
  constructor(scene, x, y, kind, team) {
    const def = UNITS[kind];
    super(scene, x, y, `${def.sprite}_${team}`, 0, team, def.hp);
    this.kind = kind;
    this.def = def;
    this.dir = 'down';
    this.state = 'idle';
    this.dest = null;
    this.lastAttack = 0;
    this.path = null;        // list of tiles from the pathfinder
    this.navKey = null;      // what the current path leads to
    this.stuck = 0;
    this.stuckCount = 0;
    this.canBreakWalls = false;
    if (def.radius) this.radius = def.radius;
    this.setOrigin(0.5, 0.6);
    this.anim('idle');
  }

  // ---------- commands (called by input or AI) ----------
  command(cmd) {
    this.path = null; this.navKey = null;
    if (cmd.type === 'move') { this.dest = { x: cmd.x, y: cmd.y }; this.state = 'move'; }
  }

  // ---------- frame update ----------
  update(time, dt) {
    if (!this.alive) return;
    // stunned (earthquake): can't move or fight for a moment
    if (this.stunUntil > this.scene.simTime) { this.anim('idle'); return; }
    const fn = this['state_' + this.state];
    if (fn) fn.call(this, time, dt);
    // only touch the depth when it really changes: every change makes Phaser re-sort the whole scene
    const d = Math.round(this.y);
    if (d !== this.depth) this.depth = d;
  }

  // a group moving in formation walks at the speed of its slowest member
  get speed() {
    const moving = this.state === 'move' || this.state === 'attackMove' || this.state === 'patrol';
    let base = this.def.mounted ? this.def.speed * (1 + upValue(this.scene.eco[this.team], 'horse')) : this.def.speed;
    if (this.speedBuff && this.buffUntil > this.scene.simTime) base *= this.speedBuff;     // war horn
    return moving && this.groupSpeed ? Math.min(this.groupSpeed, base) : base;
  }

  state_idle() { this.anim('idle'); this.groupSpeed = 0; }

  state_move(time, dt) {
    if (!this.dest) { this.state = 'idle'; return; }
    const r = this.navigate(this.dest.x, this.dest.y, dt, 2);
    if (r === true) this.state = 'idle';
  }

  /**
   * Walk toward a point using the pathfinder.
   * target (optional): the entity we are walking to, so its tiles count as the goal.
   * Returns true when arrived, false while walking,
   * or { blocked: wall } when an enemy wall is in the way.
   */
  navigate(tx, ty, dt, stopDist = 2, target = null) {
    const grid = this.scene.grid;
    const d = Math.hypot(tx - this.x, ty - this.y);
    if (d <= stopDist) { this.anim('idle'); this.stuck = 0; return true; }

    // close by: walk straight
    if (d < TILE * 1.6) return this.stepToward(tx, ty, dt, stopDist);

    const gx = Grid.tileOf(tx), gy = Grid.tileOf(ty);
    const key = gx + ',' + gy;
    if (this.navKey !== key || !this.path) {
      this.navKey = key;
      let goalTiles = null;
      if (target?.tilesIndex) goalTiles = target.tilesIndex(grid.w);
      this.path = grid.findPath(Grid.tileOf(this.x), Grid.tileOf(this.y), gx, gy,
        { team: this.team, canBreak: this.canBreakWalls, goalTiles });
    }

    while (this.path.length) {
      const wp = this.path[0];
      const occ = grid.get(wp.x, wp.y);
      const isGoal = target && occ === target;
      if (occ && !isGoal && !(occ.def?.gate && allied(occ.team, this.team))) {
        if (occ.def?.wall && hostile(occ.team, this.team) && occ.alive) return { blocked: occ };
        this.path = null;                        // map changed: find a new path next frame
        return false;
      }
      if (isGoal) break;                         // the rest is handled by the straight walk
      const cx = wp.x * TILE + TILE / 2, cy = wp.y * TILE + TILE / 2;
      // waypoint reached: close to its centre, or already standing on that tile with more to go.
      // (Never insist on the exact centre: two units aiming for the same centre
      //  would push each other away forever.)
      const onTile = Grid.tileOf(this.x) === wp.x && Grid.tileOf(this.y) === wp.y;
      if (Math.hypot(cx - this.x, cy - this.y) < 6 || (onTile && this.path.length > 1)) { this.path.shift(); continue; }
      this.stepToward(cx, cy, dt, 0, true);
      // blocked by other units for a moment: skip this waypoint, and if it keeps
      // happening find a fresh path from where we are
      if (this.stuck > 300) {
        this.stuck = 0;
        this.path.shift();
        if (++this.stuckCount > 3) { this.stuckCount = 0; this.path = null; this.nudge(); }
      }
      return false;
    }
    return this.stepToward(tx, ty, dt, stopDist);
  }

  // small random side-step to get out of a jam
  nudge() {
    const a = Math.random() * Math.PI * 2;
    this.tryMoveTo(this.x + Math.cos(a) * 3, this.y + Math.sin(a) * 3);
  }

  // Straight-line step with collision against blocked tiles (slides along walls).
  stepToward(tx, ty, dt, stopDist = 2, onPath = false) {
    const dx = tx - this.x, dy = ty - this.y;
    const d = Math.hypot(dx, dy);
    if (d <= stopDist) { this.anim('idle'); this.stuck = 0; return true; }
    const step = Math.min(d, this.speed * dt / 1000);
    const nx = this.x + dx / d * step, ny = this.y + dy / d * step;
    const ox = this.x, oy = this.y;
    this.tryMoveTo(nx, ny);
    this.face(dx, dy);
    this.anim('walk');
    this.separate();
    // stuck detection: target is unreachable (e.g. inside a building) -> give up
    if (Math.hypot(this.x - ox, this.y - oy) < step * 0.25) this.stuck += dt; else { this.stuck = 0; this.stuckCount = 0; }
    if (!onPath && this.stuck > 600) { this.stuck = 0; this.anim('idle'); return true; }
    return false;
  }

  tryMoveTo(nx, ny) {
    const g = this.scene.grid;
    const freeNow = g.walkablePx(this.x, this.y, this.team);
    if (!freeNow || g.walkablePx(nx, ny, this.team)) { this.x = nx; this.y = ny; return; }
    if (g.walkablePx(nx, this.y, this.team)) this.x = nx;
    else if (g.walkablePx(this.x, ny, this.team)) this.y = ny;
  }

  // Gently push away from overlapping units so they don't stack.
  separate() {
    // only the units in the 3x3 cells around us (spatial hash built once per step by the scene)
    for (const o of this.scene.nearUnits(this.x, this.y)) {
      if (o === this || !o.alive || o.hidden) continue;
      const dx = this.x - o.x, dy = this.y - o.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > 0.01 && d2 < 64) {
        // two walking units only nudge each other a little, so they can squeeze past;
        // a walking unit is pushed more firmly around someone standing still
        const bothWalking = o.anims.currentAnim?.key?.includes('_walk_');
        const d = Math.sqrt(d2), push = (8 - d) * (bothWalking ? 0.05 : 0.15);
        this.tryMoveTo(this.x + dx / d * push, this.y + dy / d * push);
      }
    }
  }

  face(dx, dy) {
    if (Math.abs(dx) > Math.abs(dy)) this.dir = dx > 0 ? 'right' : 'left';
    else this.dir = dy > 0 ? 'down' : 'up';
  }

  faceTarget(t) { this.face(t.x - this.x, t.y - this.y); }

  hasAnim(name) { return this.scene.anims.exists(`${this.def.sprite}_${this.team}_${name}_${this.dir}`); }

  anim(name) {
    if (!this.hasAnim(name)) name = 'idle';
    const key = `${this.def.sprite}_${this.team}_${name}_${this.dir}`;
    if (this.anims.currentAnim?.key !== key) this.play(key, true);
  }

  // quick jab toward the target (for sheets without attack frames):
  // only the drawing moves, the unit itself stays in place
  lunge(target) {
    const a = Phaser.Math.Angle.Between(this.x, this.y, target.x, target.y);
    const ox = 0.5 - Math.cos(a) * 0.22, oy = 0.6 - Math.sin(a) * 0.22;
    this.scene.tweens.add({ targets: this, originX: ox, originY: oy, duration: 90, yoyo: true, ease: 'Quad.easeOut',
      onUpdate: () => this.updateDisplayOrigin(), onComplete: () => this.setOrigin(0.5, 0.6) });
  }
}

export { DIRS };
