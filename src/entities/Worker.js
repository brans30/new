import { hostile, allied } from '../systems/Match.js';
import { Unit } from './Unit.js';
import { TILE, upValue } from '../data/config.js';

// Worker: gathers resources and constructs buildings.
//   gather  -> walk to resource, harvest for a while
//   return  -> carry the load to the nearest keep/storehouse, then gather again
//   build   -> build the current site, then the next one in its build list
//   flee    -> an enemy soldier is close and no friend protects us: run home, then go back to work
//   garrison / inside -> the alarm bell rang: hide in the keep (it shoots more arrows)
export class Worker extends Unit {
  constructor(scene, x, y, team) {
    super(scene, x, y, 'worker', team);
    this.carrying = null;       // { type: 'wood', amount: 10 }
    this.node = null;           // current resource node
    this.site = null;           // current construction site
    this.buildList = [];        // more sites to build afterwards (walls!)
    this.workStart = 0;
  }

  get busy() { return this.state !== 'idle'; }

  update(time, dt) {
    if (!this.alive) return;
    // every 0.3 s: is a soldier coming for us?
    if ((this.dangerT = (this.dangerT || 0) + dt) > 300) {
      this.dangerT = 0;
      if (['gather', 'return', 'build', 'idle'].includes(this.state) && this.inDanger()) this.flee(time);
    }
    super.update(time, dt);
  }

  inDanger() {
    const s = this.scene;
    let threat = null;
    for (const u of s.units) {
      if (!u.alive || !hostile(u.team, this.team) || !u.def.damage || u.hidden) continue;
      if (Math.hypot(u.x - this.x, u.y - this.y) < 46) { threat = u; break; }
    }
    if (!threat) return false;
    // a friendly soldier right here will handle it
    return !s.units.some(u => u.alive && allied(u.team, this.team) && u.def.damage && !u.def.healer
      && Math.hypot(u.x - this.x, u.y - this.y) < 70);
  }

  flee(time) {
    const home = this.scene.keepOf(this.team) || this.scene.findDropOff(this);
    if (!home) return;
    this.fleeFrom = this.state === 'build' ? { state: 'build', site: this.site } : { state: this.state === 'idle' ? 'idle' : 'gather' };
    this.state = 'flee';
    this.fleeUntil = time + 5000;
    this.path = null;
  }

  state_flee(time, dt) {
    const home = this.scene.keepOf(this.team) || this.scene.findDropOff(this);
    if (home && this.edgeDist(home) > 6) this.navigate(home.x, home.y, dt, this.radius + home.radius + 4, home);
    else this.anim('idle');
    if (time > this.fleeUntil && !this.inDanger()) {
      // danger over: back to work
      const f = this.fleeFrom || {};
      this.path = null;
      if (f.state === 'build' && f.site?.alive && !f.site.complete) { this.state = 'build'; this.site = f.site; }
      else if (this.carrying) this.state = 'return';
      else if (!this.autoAssign()) this.state = this.node?.alive ? 'gather' : 'idle';
    }
  }

  // ---------------- alarm bell ----------------
  state_garrison(time, dt) {
    const k = this.scene.keepOf(this.team);
    if (!k) { this.state = 'idle'; return; }
    if (this.edgeDist(k) > 4) { this.navigate(k.x, k.y, dt, this.radius + k.radius + 2, k); return; }
    this.hidden = true;
    this.setVisible(false);
    this.state = 'inside';
    k.garrison = (k.garrison || 0) + 1;
    this.scene.events.emit('selection');
  }

  state_inside() {}

  leaveKeep() {
    const k = this.scene.keepOf(this.team);
    this.hidden = false;
    this.setVisible(true);
    if (k) {
      k.garrison = Math.max(0, (k.garrison || 0) - 1);
      const spot = this.scene.freeTileNear(k);
      if (spot) { this.x = spot.x + Phaser.Math.Between(-3, 3); this.y = spot.y; }
    }
    this.state = 'idle';
    if (this.carrying) this.state = 'return';
    else this.autoAssign();
  }

  command(cmd) {
    super.command(cmd);
    const now = this.scene.simTime;
    if (cmd.type === 'gather') {
      this.node = cmd.node; this.lastType = cmd.node.type; this.state = 'gather'; this.workStart = 0;
      this.site = null; this.buildList = [];
      // sent by hand: the auto-distribution leaves this worker alone for 90 s
      this.manualUntil = cmd.auto ? 0 : now + 90000;
    }
    if (cmd.type === 'build') {
      this.site = cmd.building; this.buildList = cmd.queue ? [...cmd.queue] : [];
      this.state = 'build';
      this.manualUntil = 0;
    }
    if (cmd.type === 'move') { this.node = null; this.site = null; this.buildList = []; this.manualUntil = now + 20000; }
    if (cmd.type === 'garrison') { this.state = 'garrison'; }
  }

  get manager() { return this.scene.workerMgr?.[this.team]; }

  // let the manager decide what to do next (returns false if auto mode is off)
  autoAssign() {
    const m = this.manager;
    if (!m || !m.auto) return false;
    this.manualUntil = 0;
    return m.assign(this);
  }

  // other workers of ours right at this node (then we're queueing, not blocked)
  friendsAt(n) {
    for (const u of this.scene.nearUnits(n.x, n.y)) if (u !== this && u.alive && u.team === this.team && u.node === n && u.edgeDist(n) < 6) return true;
    return false;
  }

  pickNext(type, maxDist) {
    const m = this.scene.workerMgr[this.team];
    const n = m?.pickNode(this, type, maxDist);
    if (n && !m.canWalkTo(this, n)) return m.pickReachable(this, type);
    return n || this.scene.findNearestNode(this.x, this.y, type, maxDist, this.team);
  }

  state_gather(time, dt) {
    // node exhausted? look for another one of the same type nearby
    // node gone, or a mine the other side owns now: find another
    if (!this.node || !this.node.alive || !this.node.canGather(this.team)) {
      // next one of the same kind: close by, and close to a storehouse if possible
      this.node = this.pickNext(this.lastType, 220);
      this.path = null;
      if (!this.node) {
        if (this.carrying) { this.state = 'return'; return; }
        if (!this.autoAssign()) this.state = 'idle';
        return;
      }
    }
    if (this.carrying && this.carrying.type !== this.node.type) { this.state = 'return'; return; }
    // walk to the resource; once harvesting, a little push from a neighbour doesn't reset the work
    const gap = this.edgeDist(this.node);
    // a busy mine: the workers around it squeeze in, so one right behind them may start too
    const closeEnough = gap < 9 && this.stalled(900);
    if (gap > (this.workStart ? 7 : 3) && !closeEnough) {
      this.navigate(this.node.x, this.node.y, dt, this.radius + this.node.radius, this.node);
      this.workStart = 0;
      // no progress for 4 s while still far (a tree boxed in behind a wall): give up on it for a minute.
      // (Waiting behind other workers right at the node is not "unreachable".)
      if (!this.progress || this.progress.node !== this.node || gap < this.progress.best - 2) this.progress = { node: this.node, best: gap, t: time };
      else if (time - this.progress.t > 4000 && (gap > TILE * 1.5 || !this.friendsAt(this.node))) {
        (this.node.unreachable = this.node.unreachable || {})[this.team] = time + 60000;
        this.node = null; this.path = null; this.progress = null;
        if (!this.autoAssign()) this.state = 'idle';
      }
      return;
    }
    this.progress = null;
    // harvesting (and claiming the mine if it's neutral)
    this.node.onWork(this.team, time);
    this.faceTarget(this.node);
    this.anim('act');
    if (time - (this.sfxT || 0) > 620) { this.sfxT = time + Math.random() * 120; this.scene.sfx?.at(this.node.type === 'wood' ? 'chop' : 'pick', this.x, this.y); }
    if (!this.workStart) this.workStart = time;
    const gatherTime = this.def.gatherTime / (1 + upValue(this.scene.eco[this.team], 'tools'));
    if (time - this.workStart >= gatherTime) {
      this.carrying = { type: this.node.type, amount: this.node.take(this.def.carry) };
      this.workStart = 0;
      this.path = null;
      this.state = 'return';
    }
  }

  state_return(time, dt) {
    // pick the drop-off once per trip (by real walking distance) and stick to it:
    // re-choosing every step made workers walk back and forth between two of them
    let home = this.dropAt?.alive && this.dropAt.complete ? this.dropAt : null;
    if (!home) { home = this.dropAt = this.scene.bestDropOff(this); this.path = null; }
    if (!home) { this.state = 'idle'; return; }
    const gap = this.edgeDist(home);
    // next to it (or right behind other workers handing in their loads for a moment): deliver
    if (gap > 3 && !(gap < 10 && this.stalled(900))) {
      this.navigate(home.x, home.y, dt, this.radius + home.radius, home);
      return;
    }
    this.dropAt = null; this.prog = null;
    if (this.carrying) this.scene.deposit(this.team, this.carrying);
    this.carrying = null;
    this.path = null;
    this.state = 'gather';      // back to work automatically...
    this.manager?.onDeposit(this);   // ...maybe on another resource if it's needed more
  }

  state_build(time, dt) {
    let s = this.site;
    if (!s || !s.alive || s.complete) {
      // next site in the list: always the closest one (walls get built in a nice order)
      this.buildList = this.buildList.filter(b => b.alive && !b.complete);
      if (this.buildList.length) {
        this.buildList.sort((a, b) => Phaser.Math.Distance.Squared(this.x, this.y, a.x, a.y)
                                   - Phaser.Math.Distance.Squared(this.x, this.y, b.x, b.y));
        this.site = s = this.buildList.shift();
        this.path = null;
      } else {
        this.site = null;
        // any unfinished building nearby that nobody is working on? help there first
        const next = this.scene.findUnattendedSite(this);
        if (next) { this.site = next; this.path = null; return; }
        // done building: the manager picks the most needed resource
        if (this.autoAssign()) return;
        this.lastType = this.lastType || 'wood';
        this.node = this.pickNext(this.lastType, 300);
        this.state = this.node ? 'gather' : 'idle';
        return;
      }
    }
    const sgap = this.edgeDist(s);
    if (sgap > 3 && !(sgap < 10 && this.stalled(900))) {
      this.navigate(s.x, s.y, dt, this.radius + s.radius, s);
      return;
    }
    this.faceTarget(s);
    this.anim('act');
    if (time - (this.sfxT || 0) > 560) { this.sfxT = time + Math.random() * 100; this.scene.sfx?.at('hammer', s.x, s.y); }
    s.addBuildProgress(dt);
  }
}
