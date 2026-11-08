import { DIFFICULTY, TEAM, TEAMS, UNITS, BUILDINGS, TILE, canTrainKind, boosted } from '../data/config.js';
import { hostile, allied, kingdomOf } from './Match.js';
import { Worker } from '../entities/Worker.js';
import { Soldier } from '../entities/Soldier.js';
import { buildWall, planWall } from './WallBuilder.js';
import { BasePlanner } from './BasePlanner.js';
import { WarCommander } from './WarCommander.js';
import { UPGRADES, MARKET } from '../data/config.js';

// A computer kingdom that plays by the same rules as the player
// (there is one of these for every computer kingdom, allies included):
// it has workers, gathers, spends resources, builds, trains, and attacks.
// Every second it runs through a simple priority list ("think").
export class EnemyAI {
  constructor(scene, team, difficulty = 'normal') {
    this.scene = scene;
    this.team = team;
    const base = DIFFICULTY[difficulty] || DIFFICULTY.normal;
    this.cfg = hostile(team, TEAM.PLAYER) ? boosted(base) : base;     // enemies of the player: +50%
    this.focus = null;          // the enemy kingdom we're fighting right now
    this.elapsed = 0;
    this.thinkT = 0;
    this.attacks = 0;
    this.lastAttackAt = 0;
    this.planner = null;        // town plan, created once we know where the keep is
    this.wallSides = null;      // sides still to build, in order
    this.wallSites = [];        // pieces of the side being built now
    this.repairT = 0;
    this.skipUntil = {};        // kind -> time: stop saving for it for a while
    this.commander = new WarCommander(this);
  }

  onAttacked(victim, attacker, forAlly = false) { this.commander.onAttacked(victim, attacker, forAlly); }

  // Which enemy kingdom to fight. Allies of the player follow the player's fight;
  // everyone in an alliance gangs up on the same enemy; otherwise the closest/weakest.
  chooseFocus(keep) {
    const s = this.scene;
    const foes = TEAMS.filter(t => hostile(t, this.team) && !s.defeated.has(t) && s.keepOf(t));
    if (!foes.length) return null;
    if (allied(this.team, TEAM.PLAYER) && foes.includes(s.playerFocus)) return s.playerFocus;
    const A = kingdomOf(this.team)?.alliance;
    if (A) {
      const mate = Object.values(s.ais).find(a => a !== this && a.focus && allied(a.team, this.team) && foes.includes(a.focus));
      if (mate) return mate.focus;
    }
    if (foes.includes(this.focus)) return this.focus;      // don't switch every second
    const power = (t) => s.units.filter(u => u.alive && u.team === t && u.def.damage).length;
    return foes.map(t => { const k = s.keepOf(t); return { t, score: Math.hypot(k.x - keep.x, k.y - keep.y) / TILE + power(t) * 1.5 }; })
      .sort((a, b) => a.score - b.score)[0].t;
  }

  get eco() { return this.scene.eco[this.team]; }

  update(time, dt) {
    this.elapsed += dt;
    this.thinkT += dt;
    if (this.thinkT < this.cfg.thinkEvery) return;
    this.thinkT = 0;
    this.think();
  }

  // ------------------------------------------------------------
  think() {
    const s = this.scene, team = this.team;
    const keep = s.keepOf(team);
    if (!keep) return;
    const mine = s.units.filter(u => u.alive && u.team === team);
    const workers = mine.filter(u => u instanceof Worker);
    const soldiers = mine.filter(u => u instanceof Soldier);
    const blds = s.buildings.filter(b => b.alive && b.team === team);
    const count = (k) => blds.filter(b => b.kind === k).length;
    const building = (k) => blds.some(b => b.kind === k && !b.complete);
    const minutes = this.elapsed / 60000;
    this.armySize = soldiers.length;
    if (!this.planner) this.planner = new BasePlanner(s, team, keep);
    this.focus = this.chooseFocus(keep);
    this.saving = null;

    // 1) workers: the shared WorkerManager spreads them over gold/wood/stone
    //    (it reacts to what we're short of, same as for the player)

    // 2) more workers
    // more workers over time, and more for every storehouse we run
    const target = Math.min(this.cfg.workerCap, 7 + Math.floor(minutes * 1.8) + count('storehouse') * 2);
    if (workers.length + keep.queue.length < target && keep.queue.length < 2) this.train(keep, 'worker');

    // 3) houses before we get stuck: the bigger the town, the earlier (and two at once later on)
    const queued = blds.reduce((n, b) => n + b.queue.length, 0);
    const room = this.eco.popCap - this.eco.pop - queued;
    const houseSites = blds.filter(b => b.kind === 'house' && !b.complete).length;
    if (room <= 3 + Math.floor(this.eco.pop / 12) && houseSites < (this.eco.pop > 30 ? 2 : 1) && this.eco.popCap < 80)
      this.build('house', workers);

    // 3b) no forgotten building sites: every unfinished building gets a builder,
    //     and the important ones get a helper
    this.manageSites(workers, blds);

    // 4) storehouses where the workers walk too far, then the build order
    this.manageStorehouses(workers, count);
    this.followBuildOrder(workers, count, building);

    // 5) walls all around the base, one side at a time (front first), then keep them repaired
    const wallsAt = this.cfg.wallsAt ?? 3;
    if (minutes > wallsAt) this.manageWalls(workers);

    // towers guard the gates and corners (once the front wall exists)
    const towerTarget = Math.min(this.cfg.wallsAt ? 8 : 6, Math.floor((minutes - wallsAt) / 1.5));
    if (this.wallSides && !this.wallSides.includes('front') && count('tower') < towerTarget && !building('tower')) {
      const spot = this.planner.towerSpots()[0];
      if (spot) this.buildAt('tower', spot, workers);
    }

    if (this.wallSides && !this.wallSides.includes('front') && minutes > 5) this.buildBarriers(workers);
    this.useBuildings(blds);

    // 6) soldiers: the mix counters what the player is building.
    //    Don't hoard: the army cap grows with each attack (this is the difficulty knob).
    const need = this.cfg.firstAttackArmy + this.attacks * this.cfg.armyGrowth;
    // rich? a bigger army (resources sitting in the bank don't win wars)
    const r = this.eco.res;
    const richBonus = Math.min(12, Math.floor(Math.min(r.gold, r.wood) / 250) * 2);
    const armyCap = need + this.commander.defenderTarget(soldiers.length + 4) + 2 + richBonus;
    const underAttack = s.units.some(u => u.alive && hostile(u.team, team) && u.def.damage
      && Phaser.Math.Distance.Between(u.x, u.y, keep.x, keep.y) < TILE * 14);
    const workersFirst = workers.length < target && this.eco.res.gold < 110 && !underAttack;
    // saving up for a building/research never stops us rebuilding a too-small attack force
    const armyTooSmall = this.commander.army().length < need * 0.6;
    if (soldiers.length < armyCap && !workersFirst && (!this.saving || underAttack || armyTooSmall)) this.trainArmy(blds, soldiers, underAttack);

    // 6b) catapults for the walls: once the walls stand, a few ballistas guard them from inside
    const siegeHave = soldiers.filter(u => u.def.siege).length + blds.reduce((n, b) => n + b.queue.filter(k => k === 'ballista').length, 0);
    if (siegeHave < this.commander.siegeWant() && !workersFirst) {
      const shop = blds.find(b => b.kind === 'workshop' && b.complete && b.queue.length < 2);
      if (shop && !this.train(shop, 'ballista') && !underAttack) this.eco.noteShort(UNITS.ballista.cost);
    }

    // 7) defence & attack: the war commander gives every soldier a job
    this.commander.think(soldiers, keep);
  }

  // ------------------------------------------------------------
  // BUILD ORDER: a priority list. We build the first thing we don't have yet;
  // if we can't pay for it we SAVE for it (cheaper things further down must wait),
  // so important buildings don't get delayed forever by small purchases.
  // Anything the player already has jumps to the front: the enemy keeps up.
  followBuildOrder(workers, count, building) {
    const s = this.scene, team = this.team, W = workers.length;
    const playerCount = (k) => s.buildings.filter(b => b.alive && b.team === this.focus && b.kind === k && b.complete).length;
    const barracks = s.hasBuilding(team, 'barracks');
    const list = [];
    const wish = (kind, n, ok = true) => { if (ok && count(kind) < n && !list.some(w => w.kind === kind && w.n >= n)) list.push({ kind, n }); };

    // match the player first (production, economy and tech; not houses or walls)
    for (const k of ['barracks', 'mill', 'well', 'blacksmith', 'workshop', 'market', 'chapel', 'tavern', 'tower']) {
      const pc = Math.min(playerCount(k), k === 'tower' ? 6 : 3);
      if (pc > count(k)) wish(k, pc, !BUILDINGS[k].requires || barracks);
    }
    // our own plan
    wish('barracks', 1, W >= 5);
    wish('mill', 1, W >= 6);
    wish('well', 1, barracks);
    wish('blacksmith', 1, barracks && W >= 8);
    wish('workshop', 1, barracks && W >= 9);
    wish('market', 1, W >= 10);
    wish('mill', 2, W >= 10);
    wish('chapel', 1, barracks && W >= 11);
    wish('barracks', 2, W >= 12);
    wish('tavern', 1, barracks && W >= 13);
    wish('mill', 3, W >= 15);
    // lots of unspent resources: more production and defence
    const rich = this.eco.res.gold > 500 && this.eco.res.wood > 500;
    wish('barracks', 3, rich);
    wish('workshop', 2, rich && this.eco.res.stone > 300);
    wish('tower', Math.min(8, count('tower') + 1), rich && this.eco.res.stone > 300 && this.wallSides && !this.wallSides.includes('front'));
    this.buildPlan = list.map(w => w.kind);

    for (const { kind } of list) {
      if (building(kind)) continue;                    // one of each at a time
      // saved for this one too long (a resource we barely collect): let others go first for a while
      if ((this.skipUntil[kind] || 0) > this.elapsed) continue;
      const r = this.build(kind, workers);
      if (r === 'nomoney') {
        if (this.saveFor?.k !== kind) this.saveFor = { k: kind, since: this.elapsed };
        else if (this.elapsed - this.saveFor.since > 40000) { this.skipUntil[kind] = this.elapsed + 30000; this.saveFor = null; continue; }
        return;                                        // save for this one
      }
      if (this.saveFor?.k === kind) this.saveFor = null;
    }
  }

  // Building sites: a site nobody works on gets the nearest free worker;
  // big or urgent buildings (barracks, workshop, towers, ...) get a second builder
  // once the town has enough workers. Wall pieces are left to the wall planner.
  manageSites(workers, blds) {
    const s = this.scene;
    const sites = blds.filter(b => !b.complete && !b.def.wall);
    if (!sites.length) return;
    const on = new Map();
    for (const w of workers) if (w.state === 'build' && w.site) on.set(w.site, (on.get(w.site) || 0) + 1);
    const queued = new Set();
    for (const w of workers) for (const b of w.buildList || []) queued.add(b);
    let spare = workers.filter(w => w.state !== 'build' && !w.buildList?.length);
    for (const b of sites) {
      const big = b.def.hp >= 450 || b.kind === 'house' && this.eco.popCap - this.eco.pop <= 1;
      const want = !on.get(b) && !queued.has(b) ? 1 : big && workers.length >= 8 && (on.get(b) || 0) < 2 ? 1 : 0;
      if (!want || !spare.length) continue;
      spare.sort((p, q) => Phaser.Math.Distance.Squared(p.x, p.y, b.x, b.y) - Phaser.Math.Distance.Squared(q.x, q.y, b.x, b.y));
      const w = spare.shift();
      if (Phaser.Math.Distance.Between(w.x, w.y, b.x, b.y) > TILE * 30) continue;
      s.assignBuilders(b, [w]);
    }
  }

  // ------------------------------------------------------------
  // STOREHOUSES: every 10 s look at where our workers actually gather.
  // A busy (or rich) resource spot far from any drop-off gets a storehouse next to it.
  manageStorehouses(workers, count) {
    if ((this.storeT = (this.storeT || 0) + this.cfg.thinkEvery) < 10000) return;
    this.storeT = 0;
    const s = this.scene, team = this.team;
    const drops = s.buildings.filter(b => b.alive && b.team === team && b.def.dropOff);
    if (count('storehouse') >= 1 + Math.floor(workers.length / 5)) return;
    if (s.buildings.some(b => b.alive && b.team === team && b.kind === 'storehouse' && !b.complete)) return;
    const keep = s.keepOf(team);
    const distToDrop = (x, y) => Math.min(...drops.map(d => Math.hypot(d.x - x, d.y - y))) / TILE;

    // group resources into 5x5-tile cells
    const cells = new Map();
    for (const n of s.nodes) {
      if (!n.alive || !s.reachable(n)) continue;
      if (Math.hypot(n.x - keep.x, n.y - keep.y) > TILE * 24) continue;
      const key = Math.floor(n.tx / 5) + ',' + Math.floor(n.ty / 5);
      const c = cells.get(key) || { nodes: [], amount: 0, users: 0, x: 0, y: 0 };
      c.nodes.push(n); c.amount += n.amount; c.x += n.x; c.y += n.y;
      cells.set(key, c);
    }
    for (const w of workers) if (w.node?.alive) {
      const c = cells.get(Math.floor(w.node.tx / 5) + ',' + Math.floor(w.node.ty / 5));
      if (c) c.users++;
    }
    let best = null, bestScore = 0;
    for (const c of cells.values()) {
      c.x /= c.nodes.length; c.y /= c.nodes.length;
      const far = distToDrop(c.x, c.y);
      if (far < 7) continue;                                         // already close to a drop-off
      if (this.commander.defenceAt(c.x, c.y) > 1) continue;         // too close to the player's army/towers
      const score = c.users * 3 + Math.min(6, c.amount / 150) + far * 0.3;
      if (score > bestScore && (c.users >= 2 || c.amount >= 600)) { bestScore = score; best = c; }
    }
    if (!best) return;
    // right next to the resources, on the side facing our keep
    const anchor = best.nodes.sort((p, q) => Math.hypot(p.x - keep.x, p.y - keep.y) - Math.hypot(q.x - keep.x, q.y - keep.y))[0];
    const spot = s.findBuildSpot(anchor.tx, anchor.ty, 1, 0, 4);
    if (!spot) return;
    const r = this.buildAt('storehouse', spot, workers);
    if (r === 'nomoney' && best.users >= 3) this.saving = 'storehouse';
  }

  // blacksmith research, market trading, hiring a hero
  useBuildings(blds) {
    const s = this.scene, eco = this.eco;
    // research and the hero are worth saving for, once the army is decent
    const armyOk = this.attacks > 0 && this.armySize >= this.cfg.firstAttackArmy + this.attacks * this.cfg.armyGrowth;
    const smith = blds.find(b => b.kind === 'blacksmith' && b.complete);
    if (smith && !smith.queue.length) {
      // round-robin: every useful upgrade to level 1, then level 2, then 3
      const order = ['melee', 'armor', 'tools', 'ranged', 'masonry', 'horse'];
      let next = null, cost = null;
      for (const lvl of [1, 2, 3]) {
        for (const k of order) {
          if ((eco.upgrades[k] || 0) !== lvl - 1) continue;
          const n = s.nextUpgrade(this.team, k);
          if (n.cost) { next = k; cost = n.cost; break; }
        }
        if (next) break;
      }
      if (next && eco.canAfford(cost)) s.research(smith, next);
      else if (next && armyOk) { eco.noteShort(cost); this.saving = 'research'; }
    }
    const market = blds.find(b => b.kind === 'market' && b.complete);
    if (market && eco.res.gold < 150) {
      if (eco.res.wood > 260) s.trade(this.team, 'wood', 'sell');
      else if (eco.res.stone > 260) s.trade(this.team, 'stone', 'sell');
    } else if (market) {
      // short of wood or stone (a map with few trees, say) but rich in gold: buy it
      for (const r of ['wood', 'stone']) if (eco.res[r] < 120 && eco.res.gold > MARKET.buy[r] + 200) { s.trade(this.team, r, 'buy'); break; }
    }
    const tavern = blds.find(b => b.kind === 'tavern' && b.complete);
    if (tavern && !s.heroOf(this.team)) {
      const their = s.units.filter(u => u.alive && u.team === this.focus && u.def.damage);
      const ranged = their.filter(u => u.def.ranged).length;
      const hero = ranged > their.length / 2 ? 'kanji' : their.length > 8 ? 'grum' : 'arthax';
      if (!this.train(tavern, hero) && armyOk) { eco.noteShort(UNITS[hero].cost); this.saving = 'hero'; }
    }
  }

  // a line of spear barriers in front of the front wall, leaving the road open
  buildBarriers(workers) {
    if (this.barriersDone) return;
    const p = this.planner;
    const segs = [[{ u: p.front + 2, v: -5 }, { u: p.front + 2, v: -2 }], [{ u: p.front + 2, v: 3 }, { u: p.front + 2, v: 6 }]];
    let built = false;
    for (const [a, b] of segs) {
      const plan = planWall(this.scene, this.team, p.tile(a.u, a.v), p.tile(b.u, b.v), false, 'barrier');
      if (!plan.count) continue;
      if (!this.eco.canAfford(plan.cost)) return;
      buildWall(this.scene, this.team, plan, workers.filter(w => w.state !== 'build').slice(0, 1));
      built = true;
    }
    if (!built) this.barriersDone = true;
  }

  // ------------------------------------------------------------
  train(b, kind) {
    if (!b.canTrain(kind)) return false;
    if (!this.eco.spend(UNITS[kind].cost)) return false;
    b.queue.push(kind);
    return true;
  }

  // build in the district the town plan reserves for this kind of building.
  // returns the building, or 'nomoney' / 'nospot'
  build(kind, workers) {
    if (!this.eco.canAfford(BUILDINGS[kind].cost)) {
      this.eco.noteShort(BUILDINGS[kind].cost);           // workers go fetch what's missing
      this.saving = kind;
      return 'nomoney';
    }
    let spot = null;
    if (kind === 'tower') spot = this.planner.towerSpots()[0] || this.planner.spotFor('tower');
    else if (kind === 'storehouse') spot = this.planner.storehouseSpot();
    else spot = this.planner.spotFor(kind);
    return this.buildAt(kind, spot, workers);
  }

  buildAt(kind, spot, workers) {
    const s = this.scene;
    if (!spot) return 'nospot';
    if (!this.eco.spend(BUILDINGS[kind].cost)) { this.saving = kind; return 'nomoney'; }
    const b = s.addBuilding(spot.tx, spot.ty, kind, this.team, false);
    s.assignBuilders(b);                // nearest free worker, or queued for a busy one
    return b;
  }

  pickBuilder(workers, near) {
    return workers.filter(w => w.state !== 'build')
      .sort((a, b) => Phaser.Math.Distance.Squared(a.x, a.y, near.x, near.y) - Phaser.Math.Distance.Squared(b.x, b.y, near.x, near.y))[0];
  }

  // Smart walls: a rectangle around the base (map edges count as walls),
  // gates on the road to the enemy and toward outside resources,
  // one side at a time, then repairs: gaps left by chopped trees or
  // destroyed pieces are filled again every 20 s.
  manageWalls(workers) {
    const p = this.planner;
    if (!this.wallSides) this.wallSides = p.wallSides().map(sd => sd.name);
    this.wallSites = this.wallSites.filter(w => w.alive && !w.complete);
    if (this.wallSites.length) return;                    // still building the current side

    if (this.wallSides.length) {
      const side = p.wallSides().find(sd => sd.name === this.wallSides[0]);
      if (!side) { this.wallSides.shift(); return; }
      const plan = p.planSide(side);
      if (!plan.count) { this.wallSides.shift(); return; }
      if (!this.eco.canAfford(plan.cost)) { this.eco.noteShort(plan.cost); return; }
      const builders = workers.filter(w => w.state !== 'build').slice(0, 3);
      const sites = buildWall(this.scene, this.team, plan, builders);
      if (sites) { this.wallSites = sites; this.wallSides.shift(); }
      return;
    }

    // all sides done: repair
    this.repairT += this.cfg.thinkEvery;
    if (this.repairT < 20000) return;
    this.repairT = 0;
    for (const side of p.wallSides()) {
      const plan = p.planSide(side);
      if (plan.count && this.eco.canAfford(plan.cost)) {
        const sites = buildWall(this.scene, this.team, plan, workers.filter(w => w.state !== 'build').slice(0, 2));
        if (sites) { this.wallSites = sites; return; }
      }
    }
  }

  // How much of each unit the enemy wants in its army.
  // Every unit type it can train gets a share (so it really uses all of them),
  // and the shares grow for units that counter what the player is fielding.
  wantedMix() {
    const s = this.scene, enemyTeam = this.focus;
    const their = s.units.filter(u => u.alive && u.team === enemyTeam && u.def.damage);
    const n = Math.max(1, their.length);
    const knights = their.filter(u => u.def.mounted).length / n;
    const ranged = their.filter(u => u.def.ranged).length / n;
    const melee = Math.max(0, 1 - knights - ranged);
    const walls = s.buildings.filter(x => x.alive && x.team === enemyTeam && (x.def.wall || x.kind === 'tower')).length;
    return {
      swordsman: 2,
      spearman: 1.2 + knights * 5,             // spears beat horses
      axeman: 0.8 + (walls > 6 ? 1.5 : 0),     // axes break walls and towers
      bowman: 1.8,
      assassin: 0.5 + ranged * 2,              // assassins hunt archers
      knight: 1.4 + ranged * 3,                // horses run down archers
      musketeer: 1.2 + knights * 1.5,
      ballista: 0.6 + (walls > 6 ? 1.2 : 0),   // siege against walls and towers
      mage: 0.9 + melee * 1.5,                 // fireballs hit packed melee
      priest: 0.9,                             // healers for the army
    };
  }

  // train the unit that is furthest below its share, at a building that makes it
  trainArmy(blds, soldiers, underAttack) {
    const want = this.wantedMix();
    const makers = {};
    for (const b of blds) {
      if (!b.complete || b.kind === 'keep' || b.kind === 'tavern' || !b.def.trains) continue;
      for (const k of b.def.trains) if (want[k] !== undefined && canTrainKind(k, this.team)) (makers[k] = makers[k] || []).push(b);
    }
    const kinds = Object.keys(makers);
    if (!kinds.length) return;
    // current army + what is already in the queues
    const have = {};
    for (const u of soldiers) if (!u.def.hero) have[u.kind] = (have[u.kind] || 0) + 1;
    for (const b of blds) for (const q of b.queue) have[q] = (have[q] || 0) + 1;
    const total = kinds.reduce((t, k) => t + (have[k] || 0), 0) + 1;
    const sum = kinds.reduce((t, k) => t + want[k], 0);
    const ranked = kinds.map(k => ({ k, gap: (want[k] / sum) * total - (have[k] || 0) })).sort((a, b) => b.gap - a.gap);

    for (const { k } of ranked) {
      const b = makers[k].filter(m => m.queue.length < 2).sort((x, y) => x.queue.length - y.queue.length)[0];
      if (!b) continue;                                     // its buildings are busy: try the next type
      if (this.train(b, k)) { this.waitingFor = null; return; }
      // can't pay for the unit we need most: save for it (up to 30 s),
      // unless we're under attack — then take anything affordable right now
      const halfReady = soldiers.length >= (this.cfg.firstAttackArmy + this.attacks * this.cfg.armyGrowth) / 2;
      if (!underAttack && halfReady) {
        if (!this.waitingFor || this.waitingFor.k !== k) this.waitingFor = { k, since: this.elapsed };
        this.eco.noteShort(UNITS[k].cost);
        if (this.elapsed - this.waitingFor.since < 20000) return;
      }
    }
  }



}
