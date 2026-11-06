import { t } from '../i18n.js';
import { TILE, MAP_W, MAP_H, setMapSize, buildingName, raceOf, TEAM, TEAMS, START_RESOURCES, BUILDINGS, UNITS, DIFFICULTY, KINGDOMS, RES_COLOR, PROJECTILES, UPGRADES, MARKET, upLevel, upValue, UP_LEVEL3_NEEDS } from '../data/config.js';
import { buildMap } from '../systems/MapBuilder.js';
import { MATCH, hostile, allied, kingdomOf, nameOf, relation } from '../systems/Match.js';
import { formationSlots, damageFor, inCover } from '../systems/Tactics.js';
import { Economy } from '../systems/Economy.js';
import { EnemyAI } from '../systems/EnemyAI.js';
import { Grid } from '../systems/Grid.js';
import { generateMap } from '../systems/MapGen.js';
import { WallTool } from '../systems/WallBuilder.js';
import { WorkerManager } from '../systems/WorkerManager.js';
import { Worker } from '../entities/Worker.js';
import { Soldier } from '../entities/Soldier.js';
import { Building } from '../entities/Building.js';
import { ResourceNode } from '../entities/ResourceNode.js';
import { CameraControls } from '../systems/CameraControls.js';
import { hud } from '../ui/Hud.js';
import { Ambience } from '../systems/Ambience.js';
import { Effects } from '../systems/Effects.js';
import { sfx } from '../systems/Sound.js';
import { completeStage } from '../data/campaign.js';
import { Diplomacy } from '../systems/Diplomacy.js';
import { ads } from '../systems/Ads.js';
import { HeroSkills, SKILLS } from '../systems/HeroSkills.js';
import { quality } from '../systems/Quality.js';
import { keepAwake } from '../systems/KeepAwake.js';
import { tutorial } from '../ui/Tutorial.js';

// melee kinds that swing a blade (metal clang); the rest thump
const SWORDS = new Set(['swordsman', 'knight', 'arthax', 'kanji', 'assassin']);
const SHOT = { arrow: 'bow', bullet: 'gun', bolt: 'ballista', fireball: 'fireball' };

export class GameScene extends Phaser.Scene {
  constructor() { super('Game'); }

  create() {
    this.units = [];
    this.buildings = [];
    this.nodes = [];
    this.stumps = [];            // tree stumps left behind (only drawn when on screen)
    this.selected = [];          // selected units OR one building
    this.placing = null;         // building kind being placed, or 'wall'
    this.over = false;
    this.speed = 1;              // 2 = double speed
    this.formationType = 'line'; // how the player's groups line up
    this.groups = { 1: [], 2: [], 3: [] };   // control groups
    this.pendingOrder = null;    // 'patrol': the next tap sets the patrol point
    this.simTime = 0;            // game clock (ms), independent of real time
    // the map for this match: its size must be known before anything is built
    this.plan = buildMap(MATCH.map, MATCH.kingdoms.length, MATCH.seed);
    setMapSize(this.plan.w, this.plan.h);
    this.grid = new Grid(MAP_W, MAP_H);
    this.eco = {};
    this.workerMgr = {};
    for (const t of TEAMS) {
      // stages can give you more (or fewer) resources to start with
      const k = t === TEAM.PLAYER ? (MATCH.playerRes || 1) : 1;
      const bonus = (kingdomOf(t)?.ai && DIFFICULTY[kingdomOf(t).difficulty]?.startBonus) || {};
      const adGift = t === TEAM.PLAYER && MATCH.adBonus ? { gold: 200, wood: 200 } : {};      // watched a "strong start" ad
      const res = Object.fromEntries(Object.entries(START_RESOURCES).map(([r, v]) => [r, Math.round(v * k) + (bonus[r] || 0) + (adGift[r] || 0)]));
      this.eco[t] = new Economy(res, () => this.simTime);
      this.workerMgr[t] = new WorkerManager(this, t);
    }
    this.economy = this.eco[TEAM.PLAYER];      // shortcut used by the UI
    this.makeSafe();
    // one computer brain per AI kingdom (allies included)
    this.ais = {};
    for (const k of MATCH.kingdoms) if (k.ai) this.ais[k.color] = new EnemyAI(this, k.color, k.difficulty);
    const ais = this.ais;
    this.ai = {
      update(time, dt) { for (const a of Object.values(ais)) a.update(time, dt); },
      // something got hit: its owner reacts, and its allies come to help
      onAttacked(victim, attacker) {
        for (const a of Object.values(ais)) {
          if (a.team === victim.team) a.onAttacked(victim, attacker);
          else if (allied(a.team, victim.team)) a.onAttacked(victim, attacker, true);
        }
      },
    };
    this.defeated = new Set();       // kingdoms whose keep has fallen
    this.playerFocus = null;         // the enemy kingdom the player is fighting (allies join in)
    this.wallTool = new WallTool(this);

    this.cameras.main.setBounds(0, -16, MAP_W * TILE, MAP_H * TILE + 48);
    generateMap(this);
    this.ambience = new Ambience(this);          // windmills, smoke, fish, horses...
    this.fx = new Effects(this);
    // the screen stays on during a battle only
    keepAwake.on();
    this.events.once('shutdown', () => keepAwake.off());
    quality.resetMeter();
    this.diplo = new Diplomacy(this);          // messages with your allies
    this.skills = new HeroSkills(this);        // hero skills (bar on the left)
    this.castMode = null;                      // a skill waiting for a tap on the map
    sfx.attach(this);                            // sound effects and nature ambience
    this.sfx = sfx;
    this.events.on('alert', (a) => {
      if (a.type === 'attack') sfx.ui('alarm');
      else if (a.type === 'fall') sfx.ui('warhorn');
      else if (a.type === 'mine') sfx.ui('coins', 0.7);
    });                 // explosions, weather, day and night...
    for (const b of this.buildings) if (b.complete) this.ambience.onBuilt(b);
    this.overlay = this.add.graphics().setDepth(100000);   // hp bars + selection rings
    this.ghost = this.add.sprite(0, 0, 'houses_cyan').setAlpha(0.6).setVisible(false).setDepth(99999);

    this.cam = new CameraControls(this, (x, y) => this.onTap(x, y), (ev, w, a) => this.onBox(ev, w, a));
    this.boxG = this.add.graphics().setDepth(100001);       // the selection box
    this.selKind = null;                                     // one kind picked in the bottom panel (null = all)
    const k = this.keepOf(TEAM.PLAYER);
    this.cameras.main.centerOn(k.x + (k.x < MAP_W * TILE / 2 ? 50 : -50), k.y + 10);

    this.recountPop();
    hud.attach(this);
    this.tutorialHold = false;
    if (MATCH.tutorial) tutorial.attach(this);        // the first-time lesson
  }

  // ================= WORLD OBJECTS =================
  addNode(tx, ty, kind) {
    if (!this.grid.isFree(tx, ty)) return null;
    const n = new ResourceNode(this, tx * TILE + TILE / 2, ty * TILE + TILE / 2, kind);
    n.tx = tx; n.ty = ty;
    this.grid.set(tx, ty, n);
    this.nodes.push(n);
    return n;
  }

  addBuilding(tx, ty, kind, team, complete) {
    const b = new Building(this, tx, ty, kind, team, complete);
    for (let y = 0; y < b.size; y++) for (let x = 0; x < b.size; x++) this.grid.set(tx + x, ty + y, b);
    this.buildings.push(b);
    if (b.def.wall) this.refreshWalls(tx, ty);
    if (complete && this.ambience) this.ambience.onBuilt(b);
    return b;
  }

  // re-pick wall sprites around a tile (auto-tiling)
  refreshWalls(tx, ty) {
    for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const e = this.grid.get(tx + dx, ty + dy);
      if (e?.def?.wall) e.updateWallFrame();
    }
  }

  // ================= SPAWNING =================
  spawnUnit(kind, team, x, y) {
    const u = kind === 'worker' ? new Worker(this, x, y, team) : new Soldier(this, x, y, kind, team);
    // orc fighters are tougher in close combat
    const R = raceOf(team);
    if (u.def.damage && !u.def.ranged && !u.def.hero && R.meleeHp !== 1) { u.maxHp = Math.round(u.maxHp * R.meleeHp); u.hp = u.maxHp; }
    this.units.push(u);
    this.recountPop();
    return u;
  }

  spawnUnitFrom(building, kind) {
    // appear on a free tile next to the building
    const spot = this.freeTileNear(building) || { x: building.x, y: building.y + building.radius + 6 };
    const u = this.spawnUnit(kind, building.team, spot.x, spot.y);
    if (building.team === TEAM.PLAYER) sfx.at('train', building.x, building.y);
    // new workers always go straight to work, on the resource that's needed most
    if (kind === 'worker') u.autoAssign();
    // soldiers walk to the barracks' rally point (fighting anything on the way)
    else if (building.rally) u.command({ type: 'attackMove', x: building.rally.x, y: building.rally.y });
    this.events.emit('selection');
  }

  freeTileNear(b) {
    const cands = [];
    for (let y = b.ty - 1; y <= b.ty + b.size; y++)
      for (let x = b.tx - 1; x <= b.tx + b.size; x++)
        if (this.grid.isFree(x, y)) cands.push({ x: (x + .5) * TILE, y: (y + .5) * TILE, below: y >= b.ty + b.size });
    cands.sort((a, c) => c.below - a.below);
    return cands.length ? cands[Math.floor(Math.random() * Math.min(3, cands.length))] : null;
  }

  // ================= QUERIES =================
  keepOf(team) { return this.buildings.find(b => b.alive && b.kind === 'keep' && b.team === team); }

  // is this spot dangerous for a worker of `team`? (enemy towers/keep in range, or enemy soldiers close)
  // cached per tile for 1 s, the worker manager asks a lot
  isDangerous(team, x, y) {
    const key = team + Math.floor(x / TILE) + ',' + Math.floor(y / TILE);
    this.dangerCache = this.dangerCache || new Map();
    if (this.dangerAt !== Math.floor(this.simTime / 1000)) {
      this.dangerCache.clear(); this.dangerAt = Math.floor(this.simTime / 1000);
      // once a second: the short lists of things that can hurt (shooting buildings, armed units)
      this.threatB = this.buildings.filter(b => b.alive && b.complete && b.def.attack);
      this.threatU = this.units.filter(u => u.alive && !u.hidden && u.def.damage);
    }
    if (this.dangerCache.has(key)) return this.dangerCache.get(key);
    let bad = false;
    for (const b of this.threatB) {
      if (b.alive && hostile(b.team, team) && Math.abs(b.x - x) < 200 && Math.hypot(b.x - x, b.y - y) < b.def.attack.range + 12) { bad = true; break; }
    }
    if (!bad) for (const u of this.threatU) {
      if (u.alive && !u.hidden && Math.abs(u.x - x) < TILE * 5 && hostile(u.team, team) && Math.hypot(u.x - x, u.y - y) < TILE * 5) { bad = true; break; }
    }
    this.dangerCache.set(key, bad);
    return bad;
  }

  // can a worker stand next to this tree/rock/mine? (one fully boxed in by other trees can't be reached)
  reachable(n) {
    const g = this.grid;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]])
      if (g.isFree(n.tx + dx, n.ty + dy)) return true;
    return false;
  }

  findNearestNode(x, y, type, maxDist = Infinity, team = null) {
    let best = null, bd = maxDist;
    for (const n of this.nodes) {
      if (!n.alive || n.type !== type || !this.reachable(n)) continue;
      if (team && (!n.canGather(team) || n.unreachable?.[team] > this.simTime)) continue;
      const d = Phaser.Math.Distance.Between(x, y, n.x, n.y);
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  }

  findDropOff(unit) {
    let best = null, bd = Infinity;
    for (const b of this.buildings) {
      if (!b.alive || !b.complete || b.team !== unit.team || !b.def.dropOff) continue;
      const d = Phaser.Math.Distance.Between(unit.x, unit.y, b.x, b.y);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }

  // units first, then buildings. Walls are never auto-targeted: soldiers walk
  // around them or through the gate, and only break a wall that blocks their path.
  // Units hiding among trees can only be seen from close by.
  canSee(from, e, d) {
    if (e.hidden) return false;
    if (e.kind && !(e instanceof Building) && d > 40 && inCover(this, e)) return false;
    return true;
  }

  // preferBuildings: siege units shoot towers, walls and buildings before soldiers
  findNearestEnemy(from, range, preferBuildings = false) {
    let best = null, bd = range;
    const check = (e) => {
      if (!e.alive || !hostile(e.team, from.team)) return;
      const d = from.edgeDist(e);
      if (d < bd && this.canSee(from, e, d)) { bd = d; best = e; }
    };
    if (preferBuildings) {
      this.buildings.forEach(b => (b.def.attack || !b.def.wall || b.def.gate) && check(b));
      if (!best) this.buildings.forEach(b => b.def.wall && check(b));
      if (best) return best;
    }
    this.units.forEach(check);
    if (!best) this.buildings.forEach(b => !b.def.wall && check(b));
    return best;
  }

  // up to n targets in range, closest first (for the keep's volleys)
  findEnemiesNear(from, range, n) {
    const list = [];
    for (const e of this.units) {
      if (!e.alive || !hostile(e.team, from.team)) continue;
      const d = from.edgeDist(e);
      if (d < range && this.canSee(from, e, d)) list.push([d, e]);
    }
    if (!list.length) for (const b of this.buildings) {
      if (!b.alive || !hostile(b.team, from.team) || b.def.wall) continue;
      const d = from.edgeDist(b);
      if (d < range) list.push([d, b]);
    }
    return list.sort((a, b) => a[0] - b[0]).slice(0, n).map(x => x[1]);
  }

  entityAt(x, y) {
    let best = null, bd = 11;
    for (const u of this.units) {
      const d = Phaser.Math.Distance.Between(x, y, u.x, u.y);
      if (u.alive && !u.hidden && d < bd) { bd = d; best = u; }
    }
    if (best) return best;
    const e = this.grid.get(Grid.tileOf(x), Grid.tileOf(y));
    return e && e.alive ? e : null;
  }

  // a free spot for a building, searched in rings around (cx,cy).
  // prefer: +1 = east, -1 = west, 0 = anywhere. Leaves a 1-tile gap around it.
  findBuildSpot(cx, cy, size, prefer = 0, maxR = 12) {
    for (let r = 2; r <= maxR; r++) {
      const ring = [];
      for (let ty = cy - r; ty <= cy + r; ty++)
        for (let tx = cx - r; tx <= cx + r; tx++)
          if (Math.max(Math.abs(tx - cx), Math.abs(ty - cy)) === r) ring.push({ tx, ty });
      const score = (p) => (p.tx - cx) * prefer - Math.abs(p.ty - cy) * 0.3;
      ring.sort((a, b) => score(b) - score(a));
      for (const p of ring) if (this.areaFree(p.tx - 1, p.ty - 1, size + 2)) return p;
    }
    return null;
  }

  areaFree(tx, ty, size) {
    const ter = this.terrain;
    for (let y = ty; y < ty + size; y++) for (let x = tx; x < tx + size; x++) {
      if (!this.grid.isFree(x, y)) return false;
      if (ter && !ter.buildable(x, y)) return false;      // never on stairs or right in front of them
    }
    return true;
  }

  hasPopRoom(team) { const e = this.eco[team]; return e.pop < e.popCap; }

  recountPop() {
    for (const t of TEAMS) {
      const pop = this.units.filter(u => u.alive && u.team === t).length;
      const cap = this.buildings.filter(b => b.alive && b.complete && b.team === t)
        .reduce((s, b) => s + (b.def.pop || 0), 0);
      this.eco[t].setPop(pop, cap);
    }
  }

  // ================= EVENTS FROM ENTITIES =================
  deposit(team, load, at = null) {
    if (load.amount <= 0) return;
    const k = kingdomOf(team);
    const amount = !k?.ai ? load.amount : Math.round(load.amount * (this.ais?.[team]?.cfg || DIFFICULTY[k.difficulty]).incomeBonus);
    this.eco[team].add(load.type, amount);
    if (team === TEAM.PLAYER) this.floatText(at || this.keepOf(team), `+${amount}`, RES_COLOR[load.type]);
  }

  // a mine changed hands
  onMineOwner(n, oldTeam, newTeam) {
    const what = n.type === 'gold' ? t('منجم ذهب') : t('محجر');
    if (newTeam === TEAM.PLAYER) { this.events.emit('alert', { type: 'mine', x: n.x, y: n.y }); this.fx?.chest(n.x, n.y); this.floatText(n, t('لك!'), '#7de0ff'); }
    else if (oldTeam === TEAM.PLAYER && !newTeam) { this.events.emit('alert', { type: 'lost', x: n.x, y: n.y }); this.floatText(n, t('محايد'), '#e9d8b4'); }
    else if (newTeam && n.visibleToPlayer !== false) this.floatText(n, allied(newTeam, TEAM.PLAYER) ? t('لحليفك') : t('للعدو'), allied(newTeam, TEAM.PLAYER) ? '#9be08a' : '#ff8a7a');
    else if (!newTeam) this.floatText(n, t('محايد'), '#e9d8b4');
  }

  onNodeDepleted(n) {
    this.nodes = this.nodes.filter(x => x !== n);
    this.grid.clear(n.tx, n.ty, n);
  }

  onBuildingComplete(b) {
    this.recountPop();
    this.ambience?.onBuilt(b);
    if (b.team === TEAM.PLAYER && !b.def.wall) { this.events.emit('alert', { type: 'done', x: b.x, y: b.y }); sfx.ui('done'); }
    this.events.emit('selection');
  }

  onEntityDied(e) {
    this.selected = this.selected.filter(s => s !== e);
    if (e instanceof Building) {
      this.ambience?.onDestroyed(e);
      this.fx?.buildingFalls(e);
      if (e.def.wall) sfx.at('thud', e.x, e.y, 0.9); else sfx.at('collapse', e.x, e.y);
      e.rallySign?.destroy();
      for (let y = 0; y < e.size; y++) for (let x = 0; x < e.size; x++) this.grid.clear(e.tx + x, e.ty + y, e);
      if (e.def.wall) this.refreshWalls(e.tx, e.ty);
      if (e.kind === 'keep') { this.events.emit('alert', { type: 'fall', x: e.x, y: e.y }); this.onKeepLost(e.team); }
    }
    else { sfx.at(raceOf(e.team) === 'orc' ? 'die_o' : 'die_h', e.x, e.y); this.events.emit('unitLost', e); }
    this.time.delayedCall(0, () => {
      this.units = this.units.filter(u => u.alive);
      this.buildings = this.buildings.filter(b => b.alive);
      this.recountPop();
      this.events.emit('selection');
    });
  }

  // a keep fell: that kingdom is out. Its army and town crumble with it.
  onKeepLost(team) {
    if (this.defeated.has(team)) return;
    this.defeated.add(team);
    delete this.ais[team];
    // the whole kingdom crumbles, but in waves (a few buildings every 140 ms, nearest to
    // the keep first) so dozens of explosions never land on the same frame
    const keep = this.buildings.find(b => b.kind === 'keep' && b.team === team) || { x: 0, y: 0 };
    this.time.delayedCall(400, () => {
      for (const u of this.units) if (u.alive && u.team === team) u.die();
      const fall = this.buildings.filter(b => b.alive && b.team === team)
        .sort((a, b) => Math.hypot(a.x - keep.x, a.y - keep.y) - Math.hypot(b.x - keep.x, b.y - keep.y));
      fall.forEach((b, i) => this.time.delayedCall(Math.floor(i / 3) * 140, () => b.alive && b.die()));
    });
    const r = relation(team);
    if (r === 'me') this.events.emit('toast', t('💀 سقطت قلعتك!'));
    else this.events.emit('toast', r === 'ally' ? `💔 ${t('سقطت')} ${nameOf(team)} (${t('حليفك')})` : `🏰 ${t('سقطت')} ${nameOf(team)}!`);
    this.events.emit('kingdoms');
    // the game ends when only one side is left, or when the player is out with no allies left
    const alive = TEAMS.filter(t => !this.defeated.has(t));
    const sides = new Set(alive.map(t => kingdomOf(t).alliance || t));
    const meAlive = !this.defeated.has(TEAM.PLAYER);
    const myTeamAlive = alive.some(t => allied(t, TEAM.PLAYER));
    if (sides.size <= 1) this.endGame(myTeamAlive, meAlive);
    else if (!myTeamAlive) this.endGame(false, false);
    else if (!meAlive) this.events.emit('toast', t('👀 حلفاؤك ما زالوا يقاتلون — تابع المعركة'));
  }

  endGame(won, survived = won) {
    if (this.over) return;
    this.over = true;
    if (won) this.fx?.fireworks([KINGDOMS[TEAM.PLAYER].css, '#ffd84a', '#ffffff', '#ff7a5a']);
    sfx.ui(won ? 'victory' : 'defeat');
    if (won && MATCH.campaign) completeStage(MATCH.campaign);       // the next stage opens
    this.adDue = MATCH.tutorial ? false : ads.battleEnded(!!MATCH.campaign);   // no ads in the lesson                // a full-screen ad before the result box?
    keepAwake.off();
    this.events.emit('gameover', won, survived);
  }

  // ================= COMBAT =================
  // all the rules (counters, upgrades, flanking, cover, charge...) are in Tactics.js
  // skill = a hero skill: its damage is fixed (only the target's armour counts)
  dealDamage(from, target, base, skill = false) {
    if (!target.alive || target.hidden) return;
    const isBuilding = target instanceof Building;
    const { mult, tag } = skill
      ? { mult: !isBuilding && target.kind !== 'worker' && target.team ? 1 - upValue(this.eco[target.team], 'armor') : 1, tag: '' }
      : damageFor(this, from, target, !isBuilding && target.kind !== 'worker', isBuilding);
    target.takeDamage(base * mult, from?.alive ? from : null);
    if (isBuilding) this.ambience?.onHit(target);
    // the sound of the blow (arrows, bullets and bolts make their own when they land)
    if (from && !skill && !from.def?.ranged && !(from instanceof Building))
      sfx.at(isBuilding ? 'thud' : SWORDS.has(from.kind) ? 'sword' : 'blunt', target.x, target.y);
    this.fx?.hit(target, from, isBuilding);
    if (tag) this.tacticTag(target, tag);
    // spear barriers hurt whoever hits them in melee (knights 3x)
    if (target.def.thorns && from?.alive && !from.def?.ranged && from.takeDamage)
      from.takeDamage(target.def.thorns * (from.def.mounted ? 3 : 1), null);
    // tell the AI it's under attack
    if (from?.team) this.ai.onAttacked(target, from);
    // a pulse on the minimap when something of yours (or an ally's) is hit
    if (from?.team && hostile(from.team, target.team)) {
      if (target.team === TEAM.PLAYER) { this.events.emit('alert', { type: 'attack', x: target.x, y: target.y }); this.lastHitOnMe = { x: target.x, y: target.y, t: this.simTime }; }
      else if (allied(target.team, TEAM.PLAYER)) this.events.emit('alert', { type: 'ally', x: target.x, y: target.y });
    }
    // remember who the player is fighting, so allied computers attack the same kingdom
    if (from?.team === TEAM.PLAYER && target.team && hostile(target.team, TEAM.PLAYER)) this.playerFocus = target.team;
  }

  // kamikaze goblin: a small blast around the target, then it's gone.
  // Kept modest: a short radius, damage that fades towards the edge, at most 4 victims
  // (closest first), and none of the assassin's bonuses against archers and workers.
  explode(u, target) {
    if (!u.alive) return;
    const x = (u.x + target.x) / 2, y = (u.y + target.y) / 2, R = 16, base = u.def.damage * 2.2;
    this.fx.explode(x, y, 1.2, 1);
    const hit = [...this.units, ...this.buildings]
      .filter(e => e.alive && !e.hidden && hostile(e.team, u.team))
      .map(e => ({ e, d: Math.max(0, Math.hypot(e.x - x, e.y - y) - (e.radius || 6)) }))
      .filter(h => h.d <= R)
      .sort((a, b) => a.d - b.d)
      .slice(0, 4);
    for (const { e, d } of hit) {
      const fall = 1 - 0.6 * (d / R);                  // 100% in the middle, 40% at the edge
      const dmg = base * fall * (e instanceof Building ? 1.5 : 1);
      e.takeDamage(dmg, u);
      if (e instanceof Building) this.ambience?.onHit(e);
      this.fx?.hit(e, u, e instanceof Building);
      this.ai.onAttacked(e, u);
      if (e.team === TEAM.PLAYER) { this.events.emit('alert', { type: 'attack', x: e.x, y: e.y }); this.lastHitOnMe = { x: e.x, y: e.y, t: this.simTime }; }
    }
    this.floatText({ x, y: y - 6 }, t('بوم!'), '#ffb347');
    u.die();
  }

  // little word over the target so the player sees the tactic working
  tacticTag(target, tag) {
    const now = this.simTime;
    if (target.lastTag && now - target.lastTag < 900) return;
    target.lastTag = now;
    const txt = { flank: t('خلف! ×1.5'), cover: t('غطاء'), charge: t('اندفاع ×2'), high: t('من الأعلى ×1.25') }[tag];
    const col = { flank: '#ffb347', cover: '#9be08a', charge: '#ff6b6b', high: '#8fd3ff' }[tag];
    if (txt) this.floatText({ x: target.x, y: target.y + 6 }, txt, col);
  }

  heal(target, amount, from) {
    if (!target.alive || target.hp >= target.maxHp) return;
    target.hp = Math.min(target.maxHp, target.hp + amount);
    this.fx?.emit('heal', target.x, target.y - 2, 2);
    sfx.at('heal', target.x, target.y);       // green sparks rising (a cheap particle, not a text)
  }

  // hero abilities fire on their own when it makes sense
  tryAbility(u, time) {
    const ab = u.def.ability;
    const foes = this.units.filter(e => e.alive && !e.hidden && hostile(e.team, u.team));
    const near = (r) => foes.filter(e => Math.hypot(e.x - u.x, e.y - u.y) <= r);
    if (ab.type === 'warcry') {
      if (!near(90).length) return;
      for (const a of this.units) if (a.alive && a.team === u.team && Math.hypot(a.x - u.x, a.y - u.y) <= ab.radius) {
        a.buffUntil = time + ab.duration; a.buffMult = ab.mult;
      }
      this.ring(u.x, u.y, ab.radius, 0xffd84a);
      this.floatText(u, t('صرخة الحرب!'), '#ffd84a');
    } else if (ab.type === 'whirlwind') {
      const hits = near(ab.radius + 6);
      if (hits.length < 2) return;
      this.ring(u.x, u.y, ab.radius, 0xb36bff);
      hits.forEach(e => this.dealDamage(u, e, ab.damage));
      this.floatText(u, t('الدوامة!'), '#c99bff');
    } else if (ab.type === 'dash') {
      const foe = near(ab.range).filter(e => Math.hypot(e.x - u.x, e.y - u.y) > 24)
        .sort((a, b) => (a.def.ranged ? 0 : 1) - (b.def.ranged ? 0 : 1))[0];
      if (!foe) return;
      const a = Math.atan2(u.y - foe.y, u.x - foe.x);
      this.dust(u.x, u.y + 4);
      u.x = foe.x + Math.cos(a) * 12; u.y = foe.y + Math.sin(a) * 12; u.path = null;
      this.dealDamage(u, foe, u.def.damage * ab.mult);
      u.engage?.(foe);
      this.floatText(u, t('اندفاع!'), '#ff8a5a');
    }
    u.abilityAt = time + ab.every;
  }

  ring(x, y, r, color) {
    const c = this.add.circle(x, y, r).setStrokeStyle(2, color, 0.9).setDepth(99989);
    c.setScale(0.2);
    this.tweens.add({ targets: c, scale: 1, alpha: 0, duration: 450, onComplete: () => c.destroy() });
  }

  fireProjectile(from, target, damage, kind = 'arrow', splash = 0) {
    const pr = PROJECTILES[kind];
    const sy = from.y - (from instanceof Building ? 8 : 3);
    const tx = target.x, ty = target.y - 2;
    const sp = this.add.sprite(from.x, sy, pr.sheet, pr.frame).setDepth(99990);
    sfx.at(SHOT[kind] || 'bow', from.x, sy);
    let tick = 0;
    const d = Phaser.Math.Distance.Between(from.x, sy, tx, ty);
    sp.rotation = Phaser.Math.Angle.Between(from.x, sy, tx, ty) + pr.rotate;
    this.tweens.add({
      targets: sp, x: tx, y: ty, duration: Math.max(80, d * pr.speed),
      onUpdate: () => { if (++tick % 2 === 0) this.fx?.trail(sp, kind); },
      onComplete: () => {
        sp.destroy();
        if (splash) {
          // fireball: hits every enemy near the impact point
          this.fx.explode(tx, ty, 0.6 + splash / 40, 0);
          const hits = [...this.units, ...this.buildings].filter(e => e.alive && hostile(e.team, from.team)
            && Phaser.Math.Distance.Between(e.x, e.y, tx, ty) <= splash + e.radius);
          hits.forEach(e => this.dealDamage(from, e, e === target ? damage : damage * 0.6));
        } else if (target.alive && this.skills?.missesInSmoke(target)) { this.fx?.emit('dust', tx, ty, 2); }
        else if (target.alive) { this.dealDamage(from, target, damage); sfx.at(target instanceof Building ? 'thud' : 'arrowhit', tx, ty, kind === 'arrow' ? 0.8 : 1.2); }
      },
    });
  }

  boom(x, y, r) {
    const c = this.add.circle(x, y, r, 0xff8a2a, 0.35).setDepth(99989).setStrokeStyle(1, 0xffd84a, 0.9);
    c.setScale(0.3);
    this.tweens.add({ targets: c, scale: 1, alpha: 0, duration: 320, onComplete: () => c.destroy() });
  }

  floatText(at, text, color) {
    if (!at || (this.fx && !this.fx.onScreen(at.x, at.y, 10))) return;     // nobody would see it
    const t = this.add.text(at.x, at.y - 18, text, {
      fontFamily: 'monospace', fontSize: '24px', color, stroke: '#000', strokeThickness: 4,
    }).setOrigin(0.5).setScale(0.25).setDepth(100001);
    this.tweens.add({ targets: t, y: t.y - 10, alpha: 0, duration: 900, onComplete: () => t.destroy() });
  }

  // ================= PLAYER ACTIONS (called from UI) =================
  select(list) {
    this.selected = list.filter(Boolean);
    this.selKind = null;
    if (this.selected.some(e => e.team === TEAM.PLAYER)) sfx.ui('select');
    this.events.emit('selection');
  }

  // the units that get the next order: the selection, or only the kind picked in the panel
  get group() {
    const mine = this.selected.filter(u => u.alive && u.team === TEAM.PLAYER && (u instanceof Worker || u instanceof Soldier));
    if (!this.selKind) return mine;
    const only = mine.filter(u => u.kind === this.selKind);
    if (!only.length) { this.selKind = null; return mine; }
    return only;
  }

  setSelKind(kind) {
    this.selKind = kind && kind !== this.selKind ? kind : null;
    sfx.ui('choose');
    this.events.emit('selection');
  }

  // ---------- hold, then drag: a box that selects my units inside it ----------
  onBox(ev, w, a) {
    const g = this.boxG;
    if (ev === 'hold') {                       // a ring fills up under the finger while holding
      if (this.placing || this.over) return;
      g.clear().lineStyle(2 / this.cameras.main.zoom * 2, 0xffffff, 0.85);
      g.beginPath(); g.arc(w.x, w.y, 9, -Math.PI / 2, -Math.PI / 2 + a * Math.PI * 2); g.strokePath();
      return;
    }
    if (ev === 'start') {
      if (this.placing || this.over || this.pendingOrder) { g.clear(); return false; }
      this.box = { x0: w.x, y0: w.y, x1: w.x, y1: w.y };
      sfx.ui('choose', 0.6);
    }
    if (ev === 'cancel') { this.box = null; g.clear(); return; }
    if (!this.box) return;
    if (ev === 'move' || ev === 'end') { this.box.x1 = w.x; this.box.y1 = w.y; }
    const b = this.box, x = Math.min(b.x0, b.x1), y = Math.min(b.y0, b.y1), bw = Math.abs(b.x1 - b.x0), bh = Math.abs(b.y1 - b.y0);
    const inside = this.units.filter(u => u.alive && !u.hidden && u.team === TEAM.PLAYER && u.x >= x - 3 && u.x <= x + bw + 3 && u.y >= y - 3 && u.y <= y + bh + 3);
    // soldiers first: workers are only picked when the box holds nothing else
    const sol = inside.filter(u => u instanceof Soldier);
    const pick = sol.length ? sol : inside;
    if (ev === 'end' && bw < 6 && bh < 6) {          // held but never dragged: it's just a tap
      g.clear(); this.box = null;
      return this.onTap(w.x, w.y);
    }
    if (ev === 'end') {
      g.clear(); this.box = null;
      this.select(pick);
      for (const u of pick) this.fx?.emit?.('sparkle', u.x, u.y - 4, 1);
      return;
    }
    const z = this.cameras.main.zoom;
    g.clear().fillStyle(0x7cff7c, 0.14).fillRect(x, y, bw, bh).lineStyle(2 / z * 1.5, 0x7cff7c, 0.95).strokeRect(x, y, bw, bh);
    g.lineStyle(1.5 / z * 1.5, 0x7cff7c, 0.9);
    for (const u of pick) g.strokeEllipse(u.x, u.y + 5, (u.radius + 2) * 2.2, (u.radius + 2) * 1.1);
  }

  selectAll(kindFilter) {
    this.select(this.units.filter(u => u.alive && u.team === TEAM.PLAYER && kindFilter(u)));
  }

  heroOf(team) {
    return this.units.find(u => u.alive && u.team === team && u.def.hero)
      || this.buildings.find(b => b.alive && b.team === team && b.queue.some(k => UNITS[k]?.hero));
  }

  train(building, kind) {
    if (!building.canTrain(kind)) return;
    if (UNITS[kind].hero && this.heroOf(building.team)) return this.events.emit('toast', t('لديك بطل بالفعل'));
    if (building.queue.length >= 5) return this.events.emit('toast', t('الطابور ممتلئ'));
    if (!this.economy.spend(UNITS[kind].cost)) return this.events.emit('toast', t('❌ موارد غير كافية'));
    building.queue.push(kind);
    this.events.emit('selection');
  }

  // ---------- blacksmith ----------
  // can this kingdom research the next level of an upgrade? -> { level, cost } or { why }
  nextUpgrade(team, key) {
    const eco = this.eco[team], up = UPGRADES[key], level = upLevel(eco, key) + 1;
    if (level > up.max) return { why: 'max' };
    if (this.buildings.some(b => b.alive && b.team === team && b.queue.some(q => q.startsWith('up:' + key + ':')))) return { why: 'busy' };
    if (level === 3 && !this.hasBuilding(team, UP_LEVEL3_NEEDS)) return { why: 'needs', level };
    return { level, cost: up.costs[level - 1] };
  }

  research(building, key) {
    const eco = this.eco[building.team], n = this.nextUpgrade(building.team, key);
    if (!n.cost) return;
    if (!eco.spend(n.cost)) return building.team === TEAM.PLAYER && this.events.emit('toast', t('❌ موارد غير كافية'));
    building.queue.push(`up:${key}:${n.level}`);
    this.events.emit('selection');
  }

  completeUpgrade(team, key) {
    const eco = this.eco[team];
    const before = 1 + upValue(eco, key);
    eco.upgrades[key] = upLevel(eco, key) + 1;
    const k = (1 + upValue(eco, key)) / before;
    if (key === 'masonry') for (const b of this.buildings) if (b.alive && b.team === team && (b.def.wall || b.kind === 'tower')) { b.maxHp = Math.round(b.maxHp * k); b.hp = Math.round(b.hp * k); }
    if (team === TEAM.PLAYER) this.fx?.upgradeGlow(team);
    this.events.emit('selection');
  }

  // ---------- market ----------
  trade(team, res, action) {
    const eco = this.eco[team];
    if (action === 'sell') {
      if (!eco.spend({ [res]: 100 })) return team === TEAM.PLAYER && this.events.emit('toast', t('❌ لا يكفي'));
      eco.add('gold', MARKET.sell[res]);
    } else {
      if (!eco.spend({ gold: MARKET.buy[res] })) return team === TEAM.PLAYER && this.events.emit('toast', t('❌ لا يكفي ذهب'));
      eco.add(res, 100);
    }
    if (team === TEAM.PLAYER) { const m = this.buildings.find(b => b.alive && b.team === team && b.def.market); if (m) this.fx?.chest(m.x, m.y, action === 'sell'); sfx.ui('coins'); }
  }

  // ---------- alarm bell: workers hide in the keep ----------
  ringBell(team, on) {
    const k = this.keepOf(team);
    if (!k) return;
    k.bell = on;
    for (const w of this.units) {
      if (!w.alive || w.team !== team || !(w instanceof Worker)) continue;
      if (on && !w.hidden && Math.hypot(w.x - k.x, w.y - k.y) < TILE * 18) w.command({ type: 'garrison' });
      if (!on && (w.hidden || w.state === 'garrison')) w.leaveKeep();
    }
    if (team === TEAM.PLAYER) this.events.emit('toast', on ? t('🔔 العمال يحتمون في القلعة') : t('✅ انتهى الخطر، العودة للعمل'));
    this.events.emit('selection');
  }

  // ---------- soldiers: formations, stances, groups ----------
  // move a group in formation: melee in front, archers behind, healers/siege at the back
  commandGroup(units, x, y, type = 'move', formation = this.formationType) {
    const soldiers = units.filter(u => u instanceof Soldier);
    const others = units.filter(u => !(u instanceof Soldier));
    const slots = formationSlots(soldiers, x, y, formation);
    const groupSpeed = soldiers.length > 1 ? Math.min(...soldiers.map(u => u.def.speed)) : 0;
    for (const u of soldiers) { const p = slots.get(u); u.command({ type, x: p.x, y: p.y, groupSpeed }); }
    others.forEach((u, i) => u.command({ type: 'move', ...this.formation(x, y, i, others.length) }));
  }

  setStance(stance) {
    const sol = this.group.filter(u => u instanceof Soldier);
    if (stance === 'patrol') { this.pendingOrder = 'patrol'; this.events.emit('selection'); return; }
    if (stance === 'retreat') {
      // back to the closest well (to heal), or the keep
      const wells = this.buildings.filter(b => b.alive && b.complete && b.team === TEAM.PLAYER && b.def.heal);
      const home = wells[0] || this.keepOf(TEAM.PLAYER);
      if (!home || !sol.length) return;
      const near = wells.sort((a, b) => Math.hypot(a.x - sol[0].x, a.y - sol[0].y) - Math.hypot(b.x - sol[0].x, b.y - sol[0].y))[0] || home;
      sol.forEach((u, i) => u.command({ type: 'retreat', ...this.formation(near.x, near.y + 20, i, sol.length) }));
      this.events.emit('toast', near.def.heal ? t('🏃 انسحاب إلى البئر للعلاج') : t('🏃 انسحاب إلى القلعة'));
      return;
    }
    sol.forEach(u => u.setStance(stance));
    if (stance === 'hold') sol.forEach(u => { if (u.state !== 'idle') u.command({ type: 'move', x: u.x, y: u.y }); });
    this.events.emit('toast', stance === 'hold' ? t('🛡 دفاع: يثبتون في مكانهم') : t('⚔ هجوم: يطاردون الأعداء'));
    this.events.emit('selection');
  }

  setFormation(type) { this.formationType = type; this.events.emit('selection'); }

  // tap a group slot: select it; long-press (or tap an empty slot): save the selection
  useGroup(n, save) {
    const mine = this.selected.filter(u => u.alive && u.team === TEAM.PLAYER && !(u instanceof Building));
    if (save || (!this.groups[n].some(u => u.alive) && mine.length)) {
      this.groups[n] = mine;
      this.events.emit('toast', `💾 ${t('حُفظت المجموعة')} ${n} (${mine.length})`);
      return this.events.emit('selection');
    }
    const g = this.groups[n].filter(u => u.alive);
    if (!g.length) return;
    this.select(g);
    const cx = g.reduce((a, u) => a + u.x, 0) / g.length, cy = g.reduce((a, u) => a + u.y, 0) / g.length;
    this.cameras.main.pan(cx, cy, 250);
  }

  hasBuilding(team, kind) { return this.buildings.some(b => b.alive && b.team === team && b.kind === kind && b.complete); }

  startPlacing(kind) {
    const req = BUILDINGS[kind].requires;
    if (req && !this.hasBuilding(TEAM.PLAYER, req)) return this.events.emit('toast', `🔒 ${t('تحتاج')} ${buildingName(req, TEAM.PLAYER)} ${t('أولاً')}`);
    if (kind !== 'wall' && kind !== 'barrier' && !this.economy.canAfford(BUILDINGS[kind].cost)) {
      this.economy.noteShort(BUILDINGS[kind].cost);      // workers will go fetch what's missing
      return this.events.emit('toast', t('❌ موارد غير كافية — العمال سيجمعون الناقص'));
    }
    // walls and spear barriers are drawn as a line
    if (kind === 'barrier') { this.wallTool.kind = 'barrier'; kind = 'wall'; } else if (kind === 'wall') this.wallTool.kind = 'wall';
    this.placing = kind;
    this.ghost.setVisible(false);
    if (kind === 'wall') this.wallTool.reset();
    else {
      const def = BUILDINGS[kind];
      this.ghost.setTexture(def.sheet.replace('{team}', TEAM.PLAYER), def.frame);
    }
    this.events.emit('placing', kind);
  }

  cancelPlacing() {
    this.placing = null;
    this.ghost.setVisible(false);
    this.wallTool.reset();
    this.events.emit('placing', null);
  }

  confirmWall() {
    if (this.wallTool.confirm()) this.cancelPlacing();
  }

  canPlace(tx, ty, size) { return this.areaFree(tx, ty, size); }

  tryPlace(wx, wy) {
    const kind = this.placing, def = BUILDINGS[kind];
    const tx = Math.floor(wx / TILE), ty = Math.floor(wy / TILE);
    if (!this.canPlace(tx, ty, def.size)) {
      this.ghost.setPosition((tx + def.size / 2) * TILE, (ty + def.size / 2) * TILE).setTint(0xff4444).setVisible(true);
      return this.events.emit('toast', t('لا يمكن البناء هنا'));
    }
    if (!this.economy.spend(def.cost)) { this.cancelPlacing(); return this.events.emit('toast', t('❌ موارد غير كافية')); }
    const b = this.addBuilding(tx, ty, kind, TEAM.PLAYER, false);
    const selected = this.selected.filter(u => u instanceof Worker && u.alive);
    this.assignBuilders(b, selected.length ? selected : null);
    this.dust(b.x, b.y + 6);
    sfx.ui('place');
    this.events.emit('tut', 'placed', kind);
    this.cancelPlacing();
  }

  // Who builds a new site:
  //  - the selected workers, or else the nearest worker that is NOT already building
  //  - a worker that is busy building finishes its current site first:
  //    the new one is added to its to-do list instead of stealing it away
  assignBuilders(site, workers = null) {
    if (!workers) {
      const mine = this.units.filter(u => u.alive && u.team === site.team && u instanceof Worker);
      const dist = (w) => Phaser.Math.Distance.Squared(w.x, w.y, site.x, site.y);
      const free = mine.filter(w => w.state !== 'build').sort((a, c) => dist(a) - dist(c));
      // nobody free: the builder with the shortest to-do list takes it next
      const w = free[0] || mine.sort((a, c) => a.buildList.length - c.buildList.length || dist(a) - dist(c))[0];
      workers = w ? [w] : [];
    }
    for (const w of workers) {
      const busy = w.state === 'build' && w.site?.alive && !w.site.complete && w.site !== site;
      if (busy) { if (!w.buildList.includes(site)) w.buildList.push(site); }
      else w.command({ type: 'build', building: site });
    }
  }

  // an unfinished building of this team that nobody is working on (closest first)
  findUnattendedSite(worker, maxDist = TILE * 14) {
    const taken = new Set();
    for (const u of this.units) if (u !== worker && u.alive && u.state === 'build' && u.site) taken.add(u.site);
    let best = null, bd = maxDist;
    for (const b of this.buildings) {
      if (!b.alive || b.complete || b.team !== worker.team || taken.has(b)) continue;
      const d = Phaser.Math.Distance.Between(worker.x, worker.y, b.x, b.y);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }

  // a puff of dust (particles from the shared emitter: no objects created)
  dust(x, y) {
    if (this.fx) { this.fx.emit('dust', x, y, 5); return; }
  }

  // ================= TAP HANDLING =================
  onTap(wx, wy) {
    if (this.over) return;
    if (this.placing === 'wall') return this.wallTool.tap(Grid.tileOf(wx), Grid.tileOf(wy));
    if (this.placing) return this.tryPlace(wx, wy);
    // a skill is waiting for its target
    if (this.castMode) {
      const hero = this.heroOf(TEAM.PLAYER), key = this.castMode;
      this.castMode = null;
      if (hero?.alive && hero.def?.hero && this.skills.cast(hero, key, wx, wy)) this.fx?.marker(wx, wy, true);
      else this.events.emit('toast', t('❌ لا يوجد هدف هنا'));
      this.events.emit('skills');
      return;
    }

    const hit = this.entityAt(wx, wy);
    this.boxG.clear();
    const myUnits = this.group;             // all the selected, or just the kind picked in the panel
    if (this.pendingOrder === 'patrol') {
      this.pendingOrder = null;
      const sol = myUnits.filter(u => u instanceof Soldier);
      const slots = formationSlots(sol, wx, wy, this.formationType);
      sol.forEach(u => { const p = slots.get(u); u.command({ type: 'patrol', x: p.x, y: p.y }); });
      this.events.emit('toast', t('🔁 دورية بين المكانين'));
      return this.ping(wx, wy, 0x66ccff);
    }
    const workers = myUnits.filter(u => u instanceof Worker);
    const soldiers = myUnits.filter(u => u instanceof Soldier);

    // double tap on one of my units: select all units of that kind (soldiers or workers) around it
    const now = performance.now();
    if (hit && hit.team === TEAM.PLAYER && !(hit instanceof Building)) {
      const last = this.lastTap;
      this.lastTap = { unit: hit, t: now };
      if (last && last.unit === hit && now - last.t < 380) {
        const soldier = hit instanceof Soldier;
        const near = this.units.filter(u => u.alive && !u.hidden && u.team === TEAM.PLAYER
          && (u instanceof Soldier) === soldier && Math.hypot(u.x - hit.x, u.y - hit.y) < TILE * 9);
        this.select(near);
        this.ring(hit.x, hit.y, TILE * 9 * 0.35, 0x7cff7c);
        this.events.emit('toast', `✔ ${near.length} ${soldier ? t('جندي') : t('عامل')} ${t('حوله')}`);
        this.lastTap = null;
        return;
      }
    } else this.lastTap = null;

    // tapped one of my own units/buildings
    if (hit && hit.team === TEAM.PLAYER) {
      if (hit instanceof Building && !hit.complete && workers.length) {
        workers.forEach(w => w.command({ type: 'build', building: hit }));
        return this.ping(hit.x, hit.y, 0x7cff7c);
      }
      if (hit instanceof Building && hit.def.gate && myUnits.length) {
        // tapping my own gate with units selected = walk through it
        this.commandGroup(myUnits, wx, wy, 'move');
        return this.ping(wx, wy, 0xffffff);
      }
      return this.select([hit]);
    }

    // tapped an enemy
    if (hit && hit.team && allied(hit.team, TEAM.PLAYER)) return this.select([hit]);   // an ally: just look
    if (hit && hostile(hit.team, TEAM.PLAYER)) {
      if (soldiers.length) {
        // healers follow along instead of attacking
        soldiers.forEach(s => s.def.healer ? s.command({ type: 'attackMove', x: hit.x, y: hit.y }) : s.command({ type: 'attack', target: hit }));
        return sfx.ui('order'), this.fx.marker(hit.x, hit.y + 4, true);
      }
      return this.select([hit]);   // just inspect it
    }

    // tapped a resource
    if (hit instanceof ResourceNode && workers.length && !hit.canGather(TEAM.PLAYER)) {
      this.events.emit('toast', t('🔴 هذا المنجم للعدو: أبعد عماله 10 ثوانٍ ليصير محايداً'));
      return this.ping(hit.x, hit.y, 0xff5050);
    }
    if (hit instanceof ResourceNode && workers.length) {
      workers.forEach(w => w.command({ type: 'gather', node: hit }));
      this.events.emit('tut', 'gather', hit.type);
      if (soldiers.length) this.commandGroup(soldiers, wx, wy, 'move');
      return this.ping(hit.x, hit.y, 0xffe066);
    }

    // tapped the ground
    if (myUnits.length) {
      // Tapping the ground is obeyed, even in the middle of a fight:
      //  * near enemies (or no enemies around the spot): march there and fight on the way
      //  * an empty spot away from the enemy: break off and walk there, ignoring enemies,
      //    then stay calm for a moment so they don't run straight back into the fight
      const anyHold = myUnits.some(u => u.stance === 'hold');
      const enemyNear = this.units.some(u => u.alive && !u.hidden && hostile(u.team, TEAM.PLAYER) && u.def.damage && Math.hypot(u.x - wx, u.y - wy) < TILE * 3)
        || this.buildings.some(b => b.alive && hostile(b.team, TEAM.PLAYER) && Math.hypot(b.x - wx, b.y - wy) < TILE * 3 + b.radius);
      const fighting = myUnits.some(u => u.state === 'attack');
      const order = anyHold || (fighting && !enemyNear) ? 'move' : 'attackMove';
      this.commandGroup(myUnits, wx, wy, order);
      this.events.emit('tut', 'move');
      if (order === 'move') myUnits.forEach(u => { u.calmAfterMove = true; });
      this.showFormationPreview(myUnits.filter(u => u instanceof Soldier), wx, wy);
      return sfx.ui('order'), this.fx.marker(wx, wy, false);
    }
    // a barracks is selected: tap ground = set the soldiers' rally point
    const b = this.selected[0];
    if (b instanceof Building && b.team === TEAM.PLAYER && b.def.trains?.some(k => k !== 'worker')) {
      b.rally = { x: wx, y: wy };
      this.fx.rally(b);
      return sfx.ui('order'), this.fx.marker(wx, wy, false);
    }
    this.select([]);
  }

  // small grid so a group doesn't pile onto one point
  formation(x, y, i, n) {
    const cols = Math.ceil(Math.sqrt(n)), sp = 10;
    const cx = i % cols, cy = Math.floor(i / cols);
    return { x: x + (cx - (cols - 1) / 2) * sp, y: y + (cy - (Math.ceil(n / cols) - 1) / 2) * sp };
  }

  // brief dots where each soldier will stand
  showFormationPreview(sol, x, y) {
    if (sol.length < 2) return;
    const slots = formationSlots(sol, x, y, this.formationType);
    for (const [u, p] of slots) {
      const col = u.def.role === 'support' ? 0x7dff8a : u.def.ranged ? 0x66ccff : 0xffd84a;
      const c = this.add.circle(p.x, p.y, 1.6, col, 0.9).setDepth(99997);
      this.tweens.add({ targets: c, alpha: 0, duration: 900, delay: 200, onComplete: () => c.destroy() });
    }
  }

  ping(x, y, color) {
    const c = this.add.circle(x, y, 6).setStrokeStyle(1, color).setDepth(99998);
    this.tweens.add({ targets: c, scale: 0.2, alpha: 0, duration: 400, onComplete: () => c.destroy() });
  }

  // ================= SPATIAL HASH =================
  // Units bucketed by 16 px cells once per step, so "who is right next to me?"
  // looks at a handful of units instead of all of them (was the biggest cost per frame).
  hashUnits() {
    const cells = this.unitCells || (this.unitCells = new Map());
    for (const list of cells.values()) list.length = 0;
    for (const u of this.units) {
      if (!u.alive || u.hidden) continue;
      const k = ((u.x >> 4) & 1023) | (((u.y >> 4) & 1023) << 10);
      let list = cells.get(k);
      if (!list) cells.set(k, list = []);
      list.push(u);
    }
  }

  nearUnits(x, y) {
    const out = this.nearBuf || (this.nearBuf = []);
    out.length = 0;
    const cx = x >> 4, cy = y >> 4, cells = this.unitCells;
    if (!cells) return this.units;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const list = cells.get(((cx + dx) & 1023) | (((cy + dy) & 1023) << 10));
      if (list) for (const u of list) out.push(u);
    }
    return out;
  }

  // ================= LOOP =================
  // ================= STABILITY =================
  // One bad unit, building or timer must never freeze the battle: a timer callback
  // that throws would be retried (and throw) every frame forever. Every timer of this
  // scene and every entity update is guarded; an error is logged once and skipped.
  makeSafe() {
    this.errCount = 0;
    const t = this.time;
    if (t.__safe) return;                      // the clock lives on across restarts
    t.__safe = true;
    const scene = this;
    const guard = (fn, scope) => (typeof fn !== 'function' ? fn : function (...a) {
      try { return fn.apply(scope ?? this, a); } catch (e) { scene.reportError(e, 'timer'); }
    });
    const dc = t.delayedCall.bind(t), ae = t.addEvent.bind(t);
    t.delayedCall = (delay, cb, args, scope) => dc(delay, guard(cb, scope), args, scope);
    t.addEvent = (cfg) => (cfg instanceof Phaser.Time.TimerEvent ? ae(cfg) : ae({ ...cfg, callback: guard(cfg.callback, cfg.callbackScope) }));
  }

  reportError(e, where, who) {
    this.errCount++;
    const key = where + ':' + e?.message;
    if ((this.seenErr = this.seenErr || new Set()).has(key)) return;
    this.seenErr.add(key);
    (window.__gameErrors = window.__gameErrors || []).push(key);
    console.error('[game] ' + where + (who?.kind ? ' (' + who.kind + ')' : ''), e);
  }

  update(_, rawDt) {
    sfx.update(rawDt);
    // a slow phone: the "auto" graphics quality steps down by itself
    if (quality.measure(rawDt)) this.events.emit('toast', `⚙️ ${t('خُفِّضت جودة الرسوم لتعمل اللعبة بسلاسة')}`);
    this.cam.update(rawDt);
    if (this.over) return;
    const dt = Math.min(rawDt, 100);
    this.diplo.update(dt * (this.speed || 1));
    this.skills.update(dt * (this.speed || 1));
    // game speed: run the simulation several times per frame
    this.tweens.timeScale = this.speed;
    for (let k = 0; k < this.speed && !this.over; k++) {
      this.simTime += dt;
      const time = this.simTime;
      this.hashUnits();
      for (const u of this.units) { try { u.update(time, dt); } catch (e) { this.reportError(e, 'unit', u); } }
      for (const b of this.buildings) { try { b.update(time, dt); } catch (e) { this.reportError(e, 'building', b); } }
      for (const t of TEAMS) { try { this.workerMgr[t].update(dt); } catch (e) { this.reportError(e, 'workers'); } }
      for (const a of Object.values(this.ais)) { if (this.tutorialHold) break; try { a.update(time, dt); } catch (e) { this.reportError(e, 'ai ' + a.team); } }
      if ((this.mineT = (this.mineT || 0) + dt) > 1000) { this.mineT = 0; for (const n of this.nodes) n.checkOwner?.(time); }
    }

    this.ambience?.update(Math.min(rawDt, 100));
    this.fx?.update(Math.min(rawDt, 100));

    // keep units inside the map
    const W = MAP_W * TILE, H = MAP_H * TILE;
    for (const u of this.units) { u.x = Phaser.Math.Clamp(u.x, 4, W - 4); u.y = Phaser.Math.Clamp(u.y, 4, H - 4); }

    // previews follow the mouse on desktop
    const hov = this.cam.hoverWorld;
    if (this.placing === 'wall' && hov) this.wallTool.hover(Grid.tileOf(hov.x), Grid.tileOf(hov.y));
    else if (this.placing && hov) {
      const def = BUILDINGS[this.placing];
      const tx = Grid.tileOf(hov.x), ty = Grid.tileOf(hov.y);
      this.ghost.setPosition((tx + def.size / 2) * TILE, (ty + def.size / 2) * TILE)
        .setTint(this.canPlace(tx, ty, def.size) ? 0x88ff88 : 0xff4444).setVisible(true);
    }
    this.drawOverlay();
  }

  drawOverlay() {
    const g = this.overlay;
    g.clear();
    if (this.castMode) {
      const h = this.heroOf(TEAM.PLAYER), sk = SKILLS[this.castMode];
      if (h?.alive && h.def?.hero && sk.range) { g.lineStyle(1.5, 0xffd84a, 0.8).strokeCircle(h.x, h.y, sk.range); g.fillStyle(0xffd84a, 0.06).fillCircle(h.x, h.y, sk.range); }
    }
    for (const s of this.selected) {
      if (!s.alive) continue;
      const r = s.radius + 2;
      const faint = this.selKind && s.kind !== this.selKind;
      g.lineStyle(1, s.team === TEAM.PLAYER ? (faint ? 0xffffff : 0x7cff7c) : allied(s.team, TEAM.PLAYER) ? 0x6fb7ff : 0xff5050, faint ? 0.35 : 1);
      g.strokeEllipse(s.x, s.y + (s instanceof Building ? r - 3 : 5), r * 2.2, r * 1.1);
    }
    const bar = (e, w) => {
      if (!e.alive || !e.visible) return;               // off screen (culled): nothing to draw
      const sel = this.selected.includes(e);
      const building = e instanceof Building && !e.complete;
      if (e.hp >= e.maxHp && !sel && !building) return;
      const y = e.y - (e instanceof Building ? e.radius + 4 : e.displayHeight * 0.6 + 1);
      g.fillStyle(0x000000, 0.7).fillRect(e.x - w / 2 - 0.5, y - 0.5, w + 1, 3);
      const p = Math.max(0, e.hp / e.maxHp);
      g.fillStyle(e.team === TEAM.PLAYER ? 0x5be37d : allied(e.team, TEAM.PLAYER) ? 0x5aa8f0 : 0xe34b4b).fillRect(e.x - w / 2, y, w * p, 2);
      if (building) g.fillStyle(0xffd84a).fillRect(e.x - w / 2, y + 3, w * e.progress, 1);
    };
    // heroes always show their team under their feet; soldiers on "hold" show a small shield mark
    for (const u of this.units) {
      if (!u.alive || u.hidden || !u.visible) continue;
      if (u.def.hero) { g.lineStyle(1, KINGDOMS[u.team]?.hex ?? 0xffffff, 0.9); g.strokeEllipse(u.x, u.y + 6, 16, 7); }
      if (u.stance === 'hold' && u.team === TEAM.PLAYER) { g.fillStyle(0x66ccff, 0.9); g.fillRect(u.x + 4, u.y - 8, 2, 2); }
    }
    this.units.forEach(u => !u.hidden && bar(u, u.def.hero ? 16 : 12));
    this.buildings.forEach(b => bar(b, b.def.wall ? 10 : b.size * 14));
  }
}
