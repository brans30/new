import { t } from '../i18n.js';
import { TILE, TEAM } from '../data/config.js';
import { hostile, allied, nameOf } from './Match.js';
import { Soldier } from '../entities/Soldier.js';
import { Worker } from '../entities/Worker.js';

// =====================================================================
//  The enemy's war commander: how it defends and how it attacks.
//
//  DEFENCE — every soldier gets a job:
//    keepGuard   stays by the keep, chases only a short way
//    gateSpear   spearmen holding a line in front of the gate (they don't move)
//    gateArcher  archers right behind the wall: protected and shooting further
//    resGuard    watch the workers at the busiest resource outside the walls
//    army        everybody else: the attack force
//  When anything of ours is hit, the closest guards + the army at home respond,
//  workers run home, and if the keep itself is in danger the alarm bell rings.
//
//  ATTACK — a plan in phases instead of sending soldiers one by one:
//    build   -> wait until the army is big enough
//    gather  -> meet at a rally point outside the gate
//    march   -> walk together in formation to the weakest valuable target
//               fast units (knights, assassins) go around and hit the archers;
//               siege units (ballista, axemen) break walls and towers
//    retreat -> when the army drops under 35 % strength, run back to the well
//    regroup -> heal, then start again
// =====================================================================
export class WarCommander {
  constructor(ai) {
    this.ai = ai;
    this.scene = ai.scene;
    this.team = ai.team;
    this.roles = new Map();         // soldier -> role
    this.phase = 'build';
    this.phaseAt = 0;
    this.alerts = [];               // recent attacks on us: { x, y, attacker, t }
    this.bellOn = false;
    this.quietSince = 0;
  }

  get now() { return this.scene.simTime; }
  get enemyTeam() { return this.ai.focus; }
  get cfg() { return this.ai.cfg; }

  // called by the scene when something of ours gets hit
  // forAlly: it happened to an ally — only the army at home may go and help
  onAttacked(victim, attacker, forAlly = false) {
    if (!attacker?.alive || !hostile(attacker.team, this.team)) return;
    if (forAlly) {
      const keep = this.scene.keepOf(this.team);
      if (!keep || Math.hypot(attacker.x - keep.x, attacker.y - keep.y) > TILE * 34) return;
    }
    const last = this.alerts[this.alerts.length - 1];
    if (last && last.attacker === attacker && this.now - last.t < 1500) return;
    this.alerts.push({ x: attacker.x, y: attacker.y, attacker, victim, t: this.now, forAlly });
    if (this.alerts.length > 12) this.alerts.shift();
  }

  // ---------------- job assignment ----------------
  defenderTarget(total) {
    return Math.min(12, Math.floor(total * 0.5));
  }

  // high ground worth holding: our own hill and the one in the middle (not the player's)
  hillPosts() {
    const s = this.scene, ter = s.terrain;
    if (!ter?.plateaus.length) return [];
    const mine = s.keepOf(this.team), theirs = s.keepOf(this.enemyTeam);
    if (!mine || !theirs) return [];
    const hills = ter.plateaus
      .filter(p => Math.hypot(p.cx - mine.x, p.cy - mine.y) <= Math.hypot(p.cx - theirs.x, p.cy - theirs.y) + TILE * 2)
      .sort((a, b) => Math.hypot(a.cx - mine.x, a.cy - mine.y) - Math.hypot(b.cx - mine.x, b.cy - mine.y))
      .slice(0, 2);
    const posts = [];
    for (const p of hills) {
      // top tiles closest to the hill's centre
      const tops = [];
      for (const [x, y] of p.high)
        if (ter.isHigh(x, y) && s.grid.isFree(x, y)) tops.push({ x: (x + 0.5) * TILE, y: (y + 0.5) * TILE, d: Math.hypot((x + 0.5) * TILE - p.cx, (y + 0.5) * TILE - p.cy) });
      tops.sort((a, b) => a.d - b.d);
      posts.push(...tops.slice(0, 3));
    }
    return posts;
  }

  posts(keep) {
    const p = this.ai.planner;
    const at = (u, v) => { const t = p.tile(u, v); return { x: (t.tx + 0.5) * TILE, y: (t.ty + 0.5) * TILE }; };
    const front = p.front;
    return {
      keepGuard: [at(2, -1), at(2, 2)],
      // spearmen in a line just outside the gate, archers just inside the wall next to it
      gateSpear: [at(front + 2, 0), at(front + 2, 1), at(front + 2, -1), at(front + 2, 2)],
      gateArcher: [at(front - 1, -2), at(front - 1, 3), at(front - 1, -3), at(front - 1, 4)],
      resGuard: this.resourcePost(keep),
      hill: this.hillPosts(),
    };
  }

  // where most of our workers are busy outside the walls
  resourcePost(keep) {
    const p = this.ai.planner;
    const ws = this.scene.units.filter(u => u.alive && u.team === this.team && u instanceof Worker && u.node?.alive);
    const outside = ws.filter(w => { const { u, v } = p.uv(w.node.tx, w.node.ty); return !p.insideWalls(u, v); });
    const pick = outside.length ? outside : ws;
    if (!pick.length) return [];
    const x = pick.reduce((s, w) => s + w.node.x, 0) / pick.length;
    const y = pick.reduce((s, w) => s + w.node.y, 0) / pick.length;
    return [{ x: x + 10, y }, { x: x - 10, y: y + 8 }];
  }

  assignRoles(soldiers, keep) {
    for (const [u] of this.roles) if (!u.alive) this.roles.delete(u);
    const posts = this.posts(keep);
    const want = { keepGuard: 2, gateSpear: 3, gateArcher: 2, resGuard: posts.resGuard.length ? 2 : 0, hill: posts.hill.length };
    let budget = this.defenderTarget(soldiers.length);
    const count = (r) => [...this.roles.values()].filter(x => x === r).length;
    budget -= [...this.roles.values()].filter(r => r !== 'army').length;

    const free = soldiers.filter(u => !this.roles.has(u) || this.roles.get(u) === 'army')
      .filter(u => !u.def.hero && !u.def.siege && !u.def.healer && (this.phase === 'build' || !this.roles.has(u)));
    const take = (role, test) => {
      while (budget > 0 && count(role) < want[role]) {
        const u = free.find(x => test(x) && this.roles.get(x) !== role && !this.isDefender(x));
        if (!u) break;
        this.roles.set(u, role); budget--;
        free.splice(free.indexOf(u), 1);
      }
    };
    take('keepGuard', u => !u.def.ranged);
    take('gateSpear', u => u.kind === 'spearman');
    take('gateSpear', u => u.kind === 'swordsman');
    take('gateArcher', u => u.def.ranged);
    take('resGuard', u => !u.def.ranged);
    // hills: archers on top (they shoot further and harder from up there), plus a guard
    take('hill', u => u.def.ranged && !u.def.siege);
    take('hill', u => !u.def.ranged);
    for (const u of soldiers) if (!this.roles.has(u)) this.roles.set(u, 'army');

    // send defenders to their posts
    const idx = {};
    for (const [u, role] of this.roles) {
      if (role === 'army') continue;
      const list = posts[role] || [];
      const i = idx[role] = (idx[role] || 0);
      idx[role]++;
      const post = list[i % Math.max(1, list.length)];
      if (!post) { this.roles.set(u, 'army'); continue; }
      const leash = { keepGuard: TILE * 7, gateSpear: TILE * 2, gateArcher: TILE * 1.5, resGuard: TILE * 9, hill: TILE * 3 }[role];
      const changed = !u.post || Math.hypot(u.post.x - post.x, u.post.y - post.y) > 20;
      u.post = { x: post.x, y: post.y, leash };
      u.setStance(role === 'gateSpear' || role === 'gateArcher' || (role === 'hill' && u.def.ranged) ? 'hold' : 'aggressive');
      if (changed && u.state === 'idle') u.command({ type: 'move', x: post.x, y: post.y, keepPost: true });
    }
  }

  isDefender(u) { const r = this.roles.get(u); return r && r !== 'army'; }
  army() { return [...this.roles].filter(([u, r]) => r === 'army' && u.alive).map(([u]) => u); }

  // ---------------- main loop (called every second) ----------------
  think(soldiers, keep) {
    const s = this.scene;
    this.assignRoles(soldiers, keep);
    this.respond(keep);
    this.bell(keep);
    this.plan(keep);
  }

  // ---------------- defence ----------------
  respond(keep) {
    const s = this.scene;
    this.alerts = this.alerts.filter(a => this.now - a.t < 5000 && a.attacker.alive);
    if (!this.alerts.length) return;
    const a = this.alerts[this.alerts.length - 1];
    const dKeep = Math.hypot(a.x - keep.x, a.y - keep.y);
    for (const [u, role] of this.roles) {
      if (!u.alive || u.state === 'attack' || u.retreating) continue;
      const d = Math.hypot(u.x - a.x, u.y - a.y);
      const goes = a.forAlly ? (role === 'army' && this.phase === 'build' && d < TILE * 34) :
        (role === 'resGuard' && d < TILE * 14) ||
        (role === 'keepGuard' && dKeep < TILE * 9) ||
        (role === 'army' && this.phase !== 'march' && d < TILE * 26);
      if (goes) u.command({ type: 'attack', target: a.attacker, keepPost: true });
    }
  }

  // the keep is under attack and we can't hold it: hide the workers inside
  bell(keep) {
    const s = this.scene;
    const near = (test, r) => s.units.filter(u => u.alive && !u.hidden && test(u.team) && u.def.damage
      && Math.hypot(u.x - keep.x, u.y - keep.y) < r);
    const enemies = near(t => hostile(t, this.team), TILE * 9).length;
    const friends = near(t => allied(t, this.team), TILE * 10).length;
    if (!this.bellOn && enemies >= 3 && friends < enemies) { this.bellOn = true; s.ringBell(this.team, true); }
    if (enemies) this.quietSince = this.now;
    if (this.bellOn && !enemies && this.now - this.quietSince > 8000) { this.bellOn = false; s.ringBell(this.team, false); }
  }

  // ---------------- attack plan ----------------
  strength(units) { return units.reduce((t, u) => t + (u.alive ? u.hp : 0), 0); }

  setPhase(p) { this.phase = p; this.phaseAt = this.now; }

  plan(keep) {
    const s = this.scene, ai = this.ai;
    const army = this.army();
    const p = ai.planner;
    const rallyT = p.tile(p.front + 5, 0);
    const rally = { x: (rallyT.tx + 0.5) * TILE, y: (rallyT.ty + 1) * TILE };
    const need = this.cfg.firstAttackArmy + ai.attacks * this.cfg.armyGrowth;
    const waited = this.now - (ai.lastAttackAt || 0);

    if (this.phase === 'build') {
      const ready = army.filter(u => u.state === 'idle' || u.state === 'move');
      const time = ai.elapsed > this.cfg.minFirstAttack;
      if (time && (ready.length >= need || (ai.attacks > 0 && waited > this.cfg.maxWaitBetweenAttacks && ready.length >= 3))) {
        s.commandGroup(army, rally.x, rally.y, 'move', 'line');
        this.setPhase('gather');
      }
      return;
    }

    if (this.phase === 'gather') {
      const there = army.filter(u => Math.hypot(u.x - rally.x, u.y - rally.y) < TILE * 4).length;
      if (there >= army.length * 0.8 || this.now - this.phaseAt > 20000) {
        this.target = this.chooseTarget();
        if (!this.target) { this.setPhase('build'); return; }
        this.startStrength = this.strength(army);
        this.marchArmy = army.slice();
        s.commandGroup(army, this.target.x, this.target.y, 'attackMove', 'line');
        this.raid(army);
        ai.attacks++;
        ai.lastAttackAt = this.now;
        this.setPhase('march');
        this.announceMarch(army.length);
      }
      return;
    }

    if (this.phase === 'march') {
      const force = this.marchArmy.filter(u => u.alive);
      // losing: pull back and heal
      if (this.strength(force) < this.startStrength * (this.cfg.retreatAt ?? 0.35) || !force.length) {
        const well = s.buildings.find(b => b.alive && b.complete && b.team === this.team && b.def.heal);
        const home = well || keep;
        force.forEach((u, i) => u.command({ type: 'retreat', ...s.formation(home.x, home.y + 18, i, force.length) }));
        if (force.length && this.aboutPlayer()) s.events.emit('toast', `🏳️ ${nameOf(this.team)} ${t('تنسحب')}!`);
        this.setPhase('regroup');
        return;
      }
      // target gone: next one
      if (!this.targetValid(this.target)) {
        this.target = this.chooseTarget();
        if (!this.target) { this.setPhase('build'); return; }
        s.commandGroup(force.filter(u => u.state !== 'attack'), this.target.x, this.target.y, 'attackMove', 'line');
      }
      // keep the army together: idle ones rejoin the march
      const idle = force.filter(u => u.state === 'idle');
      if (idle.length) s.commandGroup(idle, this.target.x, this.target.y, 'attackMove', 'line');
      this.flank(force);
      return;
    }

    // helping the human ally: stay around the point they asked for, then come home
    if (this.phase === 'help') {
      if (this.now > this.help.until) { this.setPhase('regroup'); return; }
      const idle = army.filter(u => u.state === 'idle');
      if (idle.length) s.commandGroup(idle, this.help.x, this.help.y, 'attackMove', 'loose');
      return;
    }

    if (this.phase === 'regroup') {
      // wait until everyone is home and healed (at least 20 s, at most 60 s)
      const force = army;
      const home = force.every(u => !u.retreating);
      const hp = force.length ? force.reduce((t, u) => t + u.hp / u.maxHp, 0) / force.length : 1;
      const t = this.now - this.phaseAt;
      if ((home && hp > 0.85 && t > 20000) || t > 60000) this.setPhase('build');
    }
  }

  // ---------------- requests from the human ally (Diplomacy.js) ----------------
  // "attack with me": the whole army marches on that kingdom now. Returns how many go.
  attackFor(team) {
    const s = this.scene, army = this.army().filter(u => !u.retreating);
    if (army.length < 2 || this.phase === 'march') return this.phase === 'march' ? this.marchArmy.filter(u => u.alive).length : 0;
    this.ai.focus = team;
    this.target = this.chooseTarget();
    if (!this.target) return 0;
    this.startStrength = this.strength(army);
    this.marchArmy = army.slice();
    s.commandGroup(army, this.target.x, this.target.y, 'attackMove', 'line');
    this.ai.attacks++;
    this.ai.lastAttackAt = this.now;
    this.setPhase('march');
    return army.length;
  }

  // "defend me": the army goes to that point and guards it for a minute
  helpAt(x, y, ms = 60000) {
    const army = this.army().filter(u => !u.retreating);
    if (!army.length) return 0;
    this.help = { x, y, until: this.now + ms };
    this.setPhase('help');
    this.scene.commandGroup(army, x, y, 'attackMove', 'loose');
    return army.length;
  }

  // does this attack concern the human player (on them, or by/against an ally)?
  aboutPlayer() { return this.enemyTeam === TEAM.PLAYER || allied(this.team, TEAM.PLAYER) || allied(this.enemyTeam, TEAM.PLAYER); }

  announceMarch(n) {
    const s = this.scene, me = nameOf(this.team), them = nameOf(this.enemyTeam);
    // a big red pulse on the minimap where the army is, when it's coming for you
    const army = this.army(), cx = army.reduce((t, u) => t + u.x, 0) / Math.max(1, army.length), cy = army.reduce((t, u) => t + u.y, 0) / Math.max(1, army.length);
    if (this.enemyTeam === TEAM.PLAYER) s.events.emit('alert', { type: 'march', x: cx, y: cy });
    else if (allied(this.enemyTeam, TEAM.PLAYER)) s.events.emit('alert', { type: 'ally', x: cx, y: cy });
    if (allied(this.team, TEAM.PLAYER) && this.team !== TEAM.PLAYER) s.diplo?.allyMarches(this.team, this.enemyTeam, n);
    if (this.enemyTeam === TEAM.PLAYER) s.events.emit('toast', `⚠️ ${me} ${t('تزحف نحوك بجيش من')} ${n}!`);
    else if (allied(this.team, TEAM.PLAYER)) s.events.emit('toast', `🤝 ${t('حليفك')} ${me} ${t('يهاجم')} ${them} ${t('بـ')}${n} ${t('جندي')}`);
    else if (allied(this.enemyTeam, TEAM.PLAYER)) s.events.emit('toast', `⚔️ ${me} ${t('تهاجم حليفك')} ${them}!`);
  }

  // the most valuable, least defended thing the enemy kingdom has
  chooseTarget() {
    const s = this.scene, enemy = this.enemyTeam;
    const value = { keep: 3, barracks: 6, workshop: 7, chapel: 6, tavern: 5, blacksmith: 5, storehouse: 8, mill: 7, market: 5, well: 5, house: 3, tower: 2 };
    let best = null, bestScore = -Infinity;
    for (const b of s.buildings) {
      if (!b.alive || b.team !== enemy || b.def.wall) continue;
      const def = this.defenceAt(b.x, b.y);
      const d = Math.hypot(b.x - s.keepOf(this.team).x, b.y - s.keepOf(this.team).y) / TILE;
      const score = (value[b.kind] || 3) * 3 - def * 2 - d * 0.15;
      if (score > bestScore) { bestScore = score; best = b; }
    }
    // mines the player took near the middle: kill the workers there so the mine turns neutral
    for (const n of s.nodes) {
      if (!n.alive || !n.def.mine || n.owner !== enemy) continue;
      const def = this.defenceAt(n.x, n.y);
      const d = Math.hypot(n.x - s.keepOf(this.team).x, n.y - s.keepOf(this.team).y) / TILE;
      const score = (n.type === 'gold' ? 8 : 6) * 3 - def * 2 - d * 0.15;
      if (score > bestScore) { bestScore = score; best = n; }
    }
    return best || s.keepOf(enemy);
  }

  // a target is still worth attacking: alive, and (for mines) still an enemy's
  targetValid(t) { return t?.alive && (!t.def?.mine || hostile(t.owner, this.team)); }

  // how well a point is protected by the player
  defenceAt(x, y) {
    const s = this.scene;
    let d = 0;
    for (const u of s.units) if (u.alive && hostile(u.team, this.team) && u.def.damage && Math.hypot(u.x - x, u.y - y) < TILE * 7) d += 1;
    for (const b of s.buildings) if (b.alive && b.complete && hostile(b.team, this.team) && b.def.attack && Math.hypot(b.x - x, b.y - y) < b.def.attack.range + 20) d += 3;
    return d;
  }

  // fast units hit undefended workers first (raid), then go for the archers
  raid(army) {
    const s = this.scene;
    const fast = army.filter(u => u.kind === 'knight' || u.kind === 'assassin');
    if (fast.length < 2) return;
    const workers = s.units.filter(u => u.alive && u.team === this.enemyTeam && u instanceof Worker && !u.hidden);
    const soft = workers.filter(w => this.defenceAt(w.x, w.y) <= 1);
    if (!soft.length) return;
    const t = soft[0];
    fast.forEach(u => u.command({ type: 'attackMove', x: t.x, y: t.y }));
    if (this.enemyTeam === TEAM.PLAYER) s.events.emit('alert', { type: 'attack', x: t.x, y: t.y });
  }

  // once the fight starts, fast units go around and attack the enemy's archers and mages
  flank(force) {
    const s = this.scene;
    const fast = force.filter(u => (u.kind === 'knight' || u.kind === 'assassin' || u.kind === 'kanji') && u.state !== 'attack');
    if (!fast.length) return;
    const shooters = s.units.filter(u => u.alive && u.team === this.enemyTeam && (u.def.ranged || u.def.healer) && !u.hidden);
    const cx = force.reduce((t, u) => t + u.x, 0) / force.length, cy = force.reduce((t, u) => t + u.y, 0) / force.length;
    const close = shooters.filter(u => Math.hypot(u.x - cx, u.y - cy) < TILE * 12);
    if (!close.length) return;
    fast.forEach((u, i) => u.command({ type: 'attack', target: close[i % close.length] }));
  }
}
