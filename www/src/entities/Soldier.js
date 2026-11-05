import { raceOf } from '../data/config.js';
import { Unit } from './Unit.js';
import { TILE } from '../data/config.js';
import { rangeFor, isHigh } from '../systems/Tactics.js';

// Soldier: every fighting unit (and healers / heroes).
//
// States
//   idle        stand still, react to enemies according to the stance
//   move        forced move, ignores enemies (also used to retreat)
//   attackMove  walk to a point but fight anything on the way
//   attack      chase the target and hit it when in range
//   patrol      walk back and forth between two points, fighting on the way
//   heal        (priests) walk to a wounded friend and heal him
//
// Stance (chosen by the player or the AI)
//   aggressive  chase anything in sight (default)
//   hold        never leave the spot: only hit what comes within range
//
// Guard post (used by the AI): after a chase the soldier returns to its post,
// and it never follows an enemy further than `post.leash` from it.
export class Soldier extends Unit {
  constructor(scene, x, y, kind, team) {
    super(scene, x, y, kind, team);
    this.target = null;
    this.resume = null;      // what to do after the target dies
    this.canBreakWalls = !this.def.healer;
    this.stance = 'aggressive';
    this.post = null;        // { x, y, leash }
    this.patrolPts = null;   // { a, b }
    this.runDist = 0;        // distance run while charging (knights)
    this.abilityAt = 0;      // next time the hero ability is ready
    this.buffUntil = 0; this.buffMult = 1;
    // heroes are bigger than normal soldiers
    if (this.def.hero) this.setScale(1.15);
  }

  command(cmd) {
    super.command(cmd);
    this.retreating = false;
    if (!cmd.keepPost) this.post = null;
    if (cmd.type !== 'patrol') this.patrolPts = null;
    if (cmd.type !== 'move') this.calmAfterMove = false;
    if (cmd.type === 'attack') { this.target = cmd.target; this.resume = null; this.state = 'attack'; }
    if (cmd.type === 'attackMove') { this.dest = { x: cmd.x, y: cmd.y }; this.state = 'attackMove'; }
    if (cmd.type === 'patrol') {
      this.patrolPts = { a: { x: this.x, y: this.y }, b: { x: cmd.x, y: cmd.y } };
      this.dest = this.patrolPts.b; this.state = 'patrol';
    }
    if (cmd.type === 'retreat') {          // run home ignoring enemies, then heal at the well
      this.dest = { x: cmd.x, y: cmd.y }; this.state = 'move'; this.retreating = true;
    }
    this.groupSpeed = cmd.groupSpeed || 0;
  }

  setStance(stance) { this.stance = stance; }

  get range() { return rangeFor(this.scene, this); }

  // Someone hit us: fight back if we're not busy (healers and retreating units don't)
  onDamaged(attacker) {
    if (!attacker?.alive || this.def.healer || this.retreating) return;
    if (this.stance === 'hold' && this.edgeDist(attacker) > this.range + 2) return;
    if (this.state === 'idle' || this.state === 'attackMove' || this.state === 'patrol') this.engage(attacker);
    this.scene.onUnitAttacked?.(this, attacker);
  }

  engage(target) {
    if (this.state !== 'attack') this.resume = ['attackMove', 'move', 'patrol'].includes(this.state) ? this.state : 'idle';
    this.target = target;
    this.state = 'attack';
    this.path = null;
  }

  scan() {
    if (this.def.healer) return null;
    // just arrived from an ordered retreat/move: only fight what comes really close for a few seconds
    const calm = this.calmUntil > this.scene.simTime;
    // from high ground you see further
    const reach = (this.stance === 'hold' || calm ? this.range + 4 : this.def.sight) + (isHigh(this.scene, this) ? 30 : 0);
    return this.scene.findNearestEnemy(this, reach, !!this.def.siege);
  }

  update(time, dt) {
    if (!this.alive) return;
    if (this.def.healer && this.state !== 'move') this.healerThink(time, dt);
    super.update(time, dt);
  }

  // ---------------- states ----------------
  state_idle(time, dt) {
    super.state_idle(time, dt);
    const e = this.scan();
    if (e) { this.engage(e); return; }
    // drifted away from our guard post? walk back
    if (this.post && Math.hypot(this.post.x - this.x, this.post.y - this.y) > 10) {
      this.navigate(this.post.x, this.post.y, dt, 4);
    }
  }

  state_move(time, dt) {
    if (!this.dest) { this.state = 'idle'; return; }
    const r = this.navigate(this.dest.x, this.dest.y, dt, 2);
    if (r === true) {
      this.state = 'idle'; this.retreating = false;
      if (this.calmAfterMove) { this.calmAfterMove = false; this.calmUntil = this.scene.simTime + 5000; }
    }
    else if (r?.blocked && !this.retreating) this.engage(r.blocked);     // forced move into an enemy wall: break it
  }

  state_attackMove(time, dt) {
    if (!this.dest) { this.state = 'idle'; return; }
    const e = this.scan();
    if (e) { this.engage(e); return; }
    const r = this.navigate(this.dest.x, this.dest.y, dt, 4);
    if (r === true) this.state = 'idle';
    else if (r?.blocked) this.engage(r.blocked);
  }

  state_patrol(time, dt) {
    if (!this.dest) { this.state = 'idle'; return; }
    const e = this.scan();
    if (e) { this.engage(e); return; }
    const r = this.navigate(this.dest.x, this.dest.y, dt, 4);
    if (r === true) {
      const p = this.patrolPts;
      this.dest = this.dest === p.b ? p.a : p.b;
      this.path = null;
    } else if (r?.blocked) this.engage(r.blocked);
  }

  state_attack(time, dt) {
    const t = this.target;
    const leashed = this.post && Math.hypot(this.post.x - this.x, this.post.y - this.y) > this.post.leash;
    if (!t || !t.alive || t.hidden || leashed) {
      this.target = null;
      this.path = null;
      this.runDist = 0;
      this.state = this.resume || 'idle';
      if (['attackMove', 'move', 'patrol'].includes(this.state) && !this.dest) this.state = 'idle';
      if (leashed) this.state = 'idle';           // idle walks us back to the post
      return;
    }
    if (this.edgeDist(t) > this.range) {
      if (this.stance === 'hold') { this.target = null; this.state = 'idle'; return; }   // hold the line
      const ox = this.x, oy = this.y;
      const r = this.navigate(t.x, t.y, dt, 0, t);
      if (r?.blocked && r.blocked !== t) { this.target = r.blocked; this.path = null; }   // wall first
      // knights charging: a long run makes the first hit count double
      if (this.def.mounted) this.runDist += Math.hypot(this.x - ox, this.y - oy);
      return;
    }
    this.faceTarget(t);
    if (this.def.mounted && this.runDist > TILE * 3) { this.chargeReady = true; }
    this.runDist = 0;
    if (time - this.lastAttack >= this.def.attackRate) {
      this.lastAttack = time;
      // the orcs' kamikaze goblin blows itself up among the enemies
      if (this.kind === 'assassin' && raceOf(this.team).units) return this.scene.explode(this, t);
      if (this.hasAnim('act')) {
        this.anim('act');
        this.once('animationcomplete', () => this.alive && this.anim('idle'));
      } else this.lunge(t);
      if (this.def.ranged) this.scene.fireProjectile(this, t, this.def.damage, this.def.projectile, this.def.splash);
      else this.scene.dealDamage(this, t, this.def.damage);
    }
  }

  // ---------------- priests ----------------
  healerThink(time, dt) {
    const h = this.def.healer;
    const s = this.scene;
    // most wounded friend nearby
    let best = null, worst = 0.999;
    for (const u of s.units) {
      if (!u.alive || u.team !== this.team || u === this || u.hidden || u.kind === 'worker') continue;
      if (Math.hypot(u.x - this.x, u.y - this.y) > h.range + 50) continue;
      const f = u.hp / u.maxHp;
      if (f < worst) { worst = f; best = u; }
    }
    if (!best) { if (this.state === 'heal') this.state = this.resume || 'idle'; return; }
    if (this.state !== 'heal') { this.resume = ['attackMove', 'patrol'].includes(this.state) ? this.state : 'idle'; this.state = 'heal'; }
    this.healTarget = best;
  }

  state_heal(time, dt) {
    const t = this.healTarget, h = this.def.healer;
    if (!t || !t.alive) { this.state = this.resume || 'idle'; return; }
    if (Math.hypot(t.x - this.x, t.y - this.y) > h.range) {
      if (this.stance === 'hold') return;
      this.navigate(t.x, t.y, dt, h.range - 6);
      return;
    }
    this.faceTarget(t);
    if (this.state === 'heal' && !this.anims.isPlaying) this.anim('idle');
    if (time - this.lastAttack >= h.rate) {
      this.lastAttack = time;
      this.anim('act');
      this.once('animationcomplete', () => this.alive && this.anim('idle'));
      this.scene.heal(t, h.amount, this);
    }
  }
}
