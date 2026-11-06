import { t } from '../i18n.js';
// ============================================================
//  config.js — all game data in one place.
//  To add a new unit or building: add an entry here only.
// ============================================================

export const TILE = 16;          // tile size in pixels (the sprites are 16x16)
// map size in tiles: set by the chosen map before the game scene starts
export let MAP_W = 64;
export let MAP_H = 40;
export function setMapSize(w, h) { MAP_W = w; MAP_H = h; }

// A team is a kingdom, named by its colour. Which kingdoms play is chosen in the
// setup screen (see systems/Match.js); TEAMS / TEAM.PLAYER are filled in from it.
export const ALL_COLORS = ['cyan', 'red', 'lime', 'purple', 'orcr', 'orcy'];
export const TEAM = { PLAYER: 'cyan' };
export const TEAMS = ['cyan', 'red'];
export const KINGDOMS = {
  cyan:   { name: t('المملكة الزرقاء'),     short: t('الزرقاء'),   css: '#4ecbc6', hex: 0x4ecbc6, race: 'human' },
  red:    { name: t('المملكة الحمراء'),     short: t('الحمراء'),   css: '#e05a52', hex: 0xe05a52, race: 'human' },
  lime:   { name: t('المملكة الخضراء'),     short: t('الخضراء'),   css: '#93b847', hex: 0x93b847, race: 'human' },
  purple: { name: t('المملكة البنفسجية'),   short: t('البنفسجية'), css: '#b45aa8', hex: 0xb45aa8, race: 'human' },
  orcr:   { name: t('قبيلة الدم'),          short: t('الدم'),      css: '#b8322c', hex: 0xb8322c, race: 'orc' },
  orcy:   { name: t('قبيلة الشمس'),         short: t('الشمس'),     css: '#e0a83a', hex: 0xe0a83a, race: 'orc' },
};

// ---------------- Peoples ----------------
// Same buildings and roles for both, with their own look, names and strengths.
//   meleeHp / meleeDmg / rangedDmg : multipliers for their soldiers
//   wallHp                         : walls, gates and towers (orcs build wooden palisades)
//   noUnits                        : units this people can't train
export const RACES = {
  human: { name: t('البشر'), desc: t('أسوار وأبراج حجرية، رماة وبنادق ومنجنيق'), meleeHp: 1, meleeDmg: 1, rangedDmg: 1, wallHp: 1, noUnits: [] },
  orc: {
    name: t('الأورك'), desc: t('مقاتلون أشداء في الالتحام، غوبلن انتحاري ومينوتور'),
    meleeHp: 1.2, meleeDmg: 1.15, rangedDmg: 0.85, wallHp: 0.8, noUnits: ['musketeer', 'ballista'],
    units: {
      worker: t('غوبلن مزارع'), swordsman: t('غوبلن بهراوة'), spearman: t('غوبلن رمّاح'), axeman: t('أورك محارب'),
      bowman: t('غوبلن رامٍ'), assassin: t('غوبلن انتحاري'), mage: t('ساحر أورك'), priest: t('شامان'), knight: t('مينوتور'),
    },
    unitDesc: { assassin: t('ينفجر في الأعداء'), knight: t('ثور هائج يندفع'), axeman: t('قوي جداً في الالتحام'), priest: t('يعالج الأورك') },
    buildings: {
      keep: t('المعقل'), house: t('كوخ'), barracks: t('ساحة القتال'), workshop: t('حظيرة الوحوش'), chapel: t('مذبح الأرواح'),
      storehouse: t('مخزن'), mill: t('حظيرة'), tower: t('برج مراقبة'), wall: t('سياج'), gate: t('بوابة خشبية'),
      well: t('نبع'), blacksmith: t('حدّاد'), market: t('سوق المقايضة'), tavern: t('ضريح الأبطال'),
    },
  },
};
export const raceOf = (team) => RACES[KINGDOMS[team]?.race || 'human'];
export const unitName = (kind, team) => raceOf(team).units?.[kind] || UNITS[kind].name;
export const unitDesc = (kind, team) => raceOf(team).unitDesc?.[kind] || UNITS[kind].desc;
export const buildingName = (kind, team) => raceOf(team).buildings?.[kind] || BUILDINGS[kind].name;
export const canTrainKind = (kind, team) => !raceOf(team).noUnits.includes(kind);

// computer difficulty (per kingdom)
export const DIFFICULTY = {
  easy:   { name: t('سهل'),   thinkEvery: 1600, firstAttackArmy: 4, armyGrowth: 1, minFirstAttack: 330000, maxWaitBetweenAttacks: 260000, incomeBonus: 0.8,  workerCap: 18 },
  normal: { name: t('متوسط'), thinkEvery: 1000, firstAttackArmy: 5, armyGrowth: 2, minFirstAttack: 210000, maxWaitBetweenAttacks: 180000, incomeBonus: 1.0,  workerCap: 28 },
  hard:   { name: t('صعب'),   thinkEvery: 700,  firstAttackArmy: 6, armyGrowth: 3, minFirstAttack: 150000, maxWaitBetweenAttacks: 130000, incomeBonus: 1.3,  workerCap: 34 },
  // very hard: thinks twice as often, starts richer, earns 60% more, attacks early and often,
  // walls and towers up sooner, and pulls its army back before losing it
  veryhard: { name: t('صعب جداً'), thinkEvery: 450, firstAttackArmy: 7, armyGrowth: 4, minFirstAttack: 115000, maxWaitBetweenAttacks: 95000, incomeBonus: 1.6, workerCap: 40,
    startBonus: { gold: 150, wood: 150, stone: 80 }, wallsAt: 2, retreatAt: 0.45 },
};

// Every ENEMY of the player is 20% stronger than its difficulty level says (allies are not):
// 20% more income, decides 1.2x as often, attacks 1.2x sooner and more often,
// its attack force grows 1.2x faster and it keeps 10% more workers.
// (It was 50% before; the player asked for 20% less on every level: 1.5 x 0.8 = 1.2.)
export const ENEMY_BOOST = 1.2;         // was 1.5; lowered by 20% (1.5 x 0.8) on every level
export function boosted(cfg, k = ENEMY_BOOST) {
  return { ...cfg,
    incomeBonus: cfg.incomeBonus * k,
    thinkEvery: Math.round(cfg.thinkEvery / k),
    minFirstAttack: Math.round(cfg.minFirstAttack / k),
    maxWaitBetweenAttacks: Math.round(cfg.maxWaitBetweenAttacks / k),
    armyGrowth: Math.round(cfg.armyGrowth * k * 10) / 10,
    workerCap: Math.round(cfg.workerCap * (1 + (k - 1) / 2)),
  };
}

export const RESOURCES = ['gold', 'wood', 'stone'];
export const RES_ICON = { gold: '🪙', wood: '🪵', stone: '🪨' };
export const RES_COLOR = { gold: '#ffd84a', wood: '#c8f08a', stone: '#d6dbe0' };

// Starting resources for each side
export const START_RESOURCES = { gold: 150, wood: 120, stone: 40 };

// Sprite sheets.  "{team}" is replaced with each kingdom colour (cyan, red, lime, purple).
export const SHEETS = {
  'worker_{team}':    { file: 'worker_{team}.png',    frame: 16 },
  'swordsman_{team}': { file: 'swordsman_{team}.png', frame: 16 },
  'spearman_{team}':  { file: 'spearman_{team}.png',  frame: 16 },
  'axeman_{team}':    { file: 'axeman_{team}.png',    frame: 16 },
  'bowman_{team}':    { file: 'bowman_{team}.png',    frame: 16 },
  'musketeer_{team}': { file: 'musketeer_{team}.png', frame: 16 },
  'mage_{team}':      { file: 'mage_{team}.png',      frame: 16 },
  'knight_{team}':    { file: 'knight_{team}.png',    frame: 32 },
  'keep_{team}':      { file: 'keep_{team}.png',      frame: 32 },
  'houses_{team}':    { file: 'houses_{team}.png',    frame: 16 },
  'barracks_{team}':  { file: 'barracks_{team}.png',  frame: 16 },
  'workshops_{team}': { file: 'workshops_{team}.png', frame: 16 },
  'chapels_{team}':   { file: 'chapels_{team}.png',   frame: 16 },
  'resources_{team}': { file: 'resources_{team}.png', frame: 16 },
  'tower_{team}':     { file: 'tower_{team}.png',     frame: 16 },
  'walls_{team}':     { file: 'walls_{team}.png',     frame: 16 },
  'assassin_{team}':  { file: 'assassin_{team}.png',  frame: 16 },
  'priest_{team}':    { file: 'priest_{team}.png',    frame: 16 },
  'well_{team}':      { file: 'well_{team}.png',      frame: 16 },
  'market_{team}':    { file: 'market_{team}.png',    frame: 16 },
  'taverns_{team}':   { file: 'taverns_{team}.png',   frame: 16 },
  // same picture for both teams (the team shows in the health bar / ring)
  'ballista_{team}':  { file: 'ballista.png',         frame: 16 },
  'arthax_{team}':    { file: 'hero_arthax.png',      frame: 16 },
  'grum_{team}':      { file: 'hero_grum.png',        frame: 16 },
  'kanji_{team}':     { file: 'hero_kanji.png',       frame: 16 },
  spearwall:          { file: 'spearwall.png',        frame: 16 },
  cliff:              { file: 'cliff.png',            frame: 16 },
  // map themes (tools/make_terrain.py)
  explosion:          { file: 'explosion.png',        frame: 16 },   // effects (tools/make_fx.py)
  tombstones:         { file: 'tombstones.png',       frame: 16 },
  chests:             { file: 'chests.png',           frame: 16 },
  signs:              { file: 'signs.png',            frame: 16 },
  cliff_winter:       { file: 'cliff_winter.png',     frame: 16 },
  cliff_waste:        { file: 'cliff_waste.png',      frame: 16 },
  cliffwater:         { file: 'cliffwater.png',       frame: 16 },
  ground_winter:      { file: 'ground_winter.png',    frame: 16 },
  ground_waste:       { file: 'ground_waste.png',     frame: 16 },
  wintertrees:        { file: 'wintertrees.png',      frame: 16 },
  winterdead:         { file: 'winterdead.png',       frame: 16 },
  deadtrees:          { file: 'deadtrees.png',        frame: 16 },
  cactus:             { file: 'cactus.png',           frame: 16 },
  tumbleweed:         { file: 'tumbleweed.png',       frame: 16 },
  resources_wood:     { file: 'resources_wood.png',   frame: 16 },   // neutral (unowned) mines
  marine:             { file: 'marine.png',           frame: 16 },
  horse:              { file: 'horse.png',            frame: 32 },
  pines:              { file: 'pines.png',            frame: 16 },
  palms:              { file: 'palms.png',            frame: 16 },
  wheat:              { file: 'wheat.png',            frame: 16 },
  rubble:             { file: 'rubble.png',           frame: 16 },
  bolt:               { file: 'bolt.png',             frame: 16 },
  grass:              { file: 'grass.png',            frame: 16 },
  trees:              { file: 'trees.png',            frame: 16 },
  rocks:              { file: 'rocks.png',            frame: 16 },
  arrow:              { file: 'arrow.png',            frame: 16 },
  construction:       { file: 'construction.png',     frame: 16 },
  fireball:           { file: 'fireball.png',         frame: 16 },
  bullet:             { file: 'bullet.png',           frame: 16 },
};

// Animation layout of each character sheet.
//   cols: frames per row in the sheet
//   idle / walk / act: { rows: [down, up, right, left], n: frame count }
//   c0: first column of the animation (default 0)
//   act missing = the unit "lunges" at its target instead (sheets with odd attack rows)
const dirRows = (r) => [r, r + 1, r + 2, r + 3];
// per-people overrides of the table below (sheets made by tools/make_orcs.py)
export const ANIMS_RACE = {
  orc: {
    axeman: { cols: 6, idle: { rows: dirRows(0), n: 1 }, walk: { rows: dirRows(0), n: 5 }, act: { rows: dirRows(4), n: 6 } },
    priest: { cols: 6, idle: { rows: dirRows(0), n: 1 }, walk: { rows: dirRows(0), n: 5 }, act: { rows: dirRows(4), n: 6 } },
  },
};
export const ANIMS = {
  worker:    { cols: 5, idle: { rows: dirRows(0), n: 5 }, walk: { rows: dirRows(4), n: 5 }, act: { rows: dirRows(8), n: 3 } },
  swordsman: { cols: 5, idle: { rows: dirRows(0), n: 1 }, walk: { rows: dirRows(0), n: 5 }, act: { rows: dirRows(4), n: 4 } },
  spearman:  { cols: 5, idle: { rows: dirRows(0), n: 1 }, walk: { rows: dirRows(0), n: 5 } },
  axeman:    { cols: 6, idle: { rows: dirRows(0), n: 1 }, walk: { rows: dirRows(0), n: 5 } },
  bowman:    { cols: 5, idle: { rows: dirRows(0), n: 1 }, walk: { rows: dirRows(0), n: 5 }, act: { rows: dirRows(4), n: 3 } },
  musketeer: { cols: 5, idle: { rows: dirRows(0), n: 1 }, walk: { rows: dirRows(0), n: 5 }, act: { rows: dirRows(4), n: 4 } },
  mage:      { cols: 6, idle: { rows: dirRows(0), n: 1 }, walk: { rows: dirRows(0), n: 4 }, act: { rows: dirRows(4), n: 6 } },
  // knight sheet: 3 rows per direction (idle, walk, attack) in the order down, right, left, up
  knight:    { cols: 4, idle: { rows: [0, 9, 3, 6], n: 4 }, walk: { rows: [1, 10, 4, 7], n: 4 }, act: { rows: [2, 11, 5, 8], n: 4 } },
  assassin:  { cols: 5, idle: { rows: dirRows(0), n: 1 }, walk: { rows: dirRows(0), n: 5 }, act: { rows: dirRows(4), n: 4 } },
  priest:    { cols: 6, idle: { rows: dirRows(0), n: 1 }, walk: { rows: dirRows(0), n: 4 }, act: { rows: dirRows(4), n: 6 } },
  // ballista sheet rows: up, down, right, left; loaded = column 0, firing = columns 3..6
  ballista:  { cols: 7, idle: { rows: [1, 0, 2, 3], n: 1 }, walk: { rows: [1, 0, 2, 3], n: 3 }, act: { rows: [1, 0, 2, 3], n: 4, c0: 3 } },
  arthax:    { cols: 5, idle: { rows: dirRows(0), n: 1 }, walk: { rows: dirRows(0), n: 5 }, act: { rows: dirRows(4), n: 5 } },
  grum:      { cols: 5, idle: { rows: dirRows(0), n: 1 }, walk: { rows: dirRows(0), n: 5 }, act: { rows: dirRows(5), n: 3 } },
  kanji:     { cols: 6, idle: { rows: dirRows(0), n: 1 }, walk: { rows: dirRows(0), n: 5 }, act: { rows: dirRows(4), n: 6 } },
};

// Projectiles: sheet frame, how it's rotated, speed (ms per pixel)
export const PROJECTILES = {
  arrow:    { sheet: 'arrow', frame: 2, rotate: 0, speed: 5 },
  fireball: { sheet: 'fireball', frame: 0, rotate: Math.PI / 2, speed: 7 },
  bullet:   { sheet: 'bullet', frame: 2, rotate: 0, speed: 2.5 },
  bolt:     { sheet: 'bolt', frame: 1, rotate: 0, speed: 3.5 },
};

// ---------------- Units ----------------
// bonus: damage multiplier against a target class
//   'knight' (mounted), 'building' (incl. walls), 'ranged', 'worker', 'unit' (any soldier)
// role: where the unit stands in a formation: front / back / support
export const UNITS = {
  worker: {
    name: t('عامل'), sprite: 'worker', hp: 40, speed: 38,
    cost: { gold: 50 }, trainTime: 4000,
    carry: 10, gatherTime: 1500,
  },
  swordsman: {
    name: t('سيّاف'), desc: t('متوازن'), sprite: 'swordsman', hp: 110, speed: 34,
    damage: 12, range: 14, attackRate: 900, sight: 80,
    cost: { gold: 60, wood: 20 }, trainTime: 6000,
  },
  spearman: {
    name: t('رمّاح'), desc: t('قوي ضد الفرسان'), sprite: 'spearman', hp: 95, speed: 34,
    damage: 10, range: 20, attackRate: 1000, sight: 80, bonus: { knight: 3 },
    cost: { gold: 40, wood: 40 }, trainTime: 5500,
  },
  axeman: {
    name: t('فأس'), desc: t('يهدم المباني والأسوار'), sprite: 'axeman', hp: 120, speed: 30,
    damage: 15, range: 14, attackRate: 1300, sight: 75, bonus: { building: 3 },
    cost: { gold: 70, wood: 30 }, trainTime: 7000,
  },
  bowman: {
    name: t('رامي'), desc: t('يهاجم من بعيد'), sprite: 'bowman', hp: 60, speed: 36,
    damage: 9, range: 70, attackRate: 1300, sight: 95, ranged: true, projectile: 'arrow',
    cost: { gold: 40, wood: 40 }, trainTime: 6000,
  },
  musketeer: {
    name: t('بندقي'), desc: t('مدى طويل وضربة قوية'), sprite: 'musketeer', hp: 70, speed: 32,
    damage: 26, range: 95, attackRate: 2400, sight: 110, ranged: true, projectile: 'bullet', bonus: { knight: 1.5 },
    cost: { gold: 90, wood: 30, stone: 20 }, trainTime: 8000,
  },
  knight: {
    name: t('فارس'), desc: t('سريع وقوي'), sprite: 'knight', hp: 200, speed: 58, mounted: true,
    damage: 18, range: 16, attackRate: 1000, sight: 95, bonus: { ranged: 1.5 },
    cost: { gold: 120, wood: 40 }, trainTime: 9000, radius: 8,
  },
  mage: {
    name: t('ساحر'), desc: t('كرة نار تصيب مجموعة'), sprite: 'mage', hp: 55, speed: 32,
    damage: 14, range: 80, attackRate: 2000, sight: 100, ranged: true, projectile: 'fireball', splash: 20,
    cost: { gold: 110, stone: 40 }, trainTime: 9000,
  },
  assassin: {
    name: t('قاتل'), desc: t('سريع، يفتك بالرماة والعمال'), sprite: 'assassin', hp: 70, speed: 54,
    damage: 15, range: 14, attackRate: 800, sight: 90, bonus: { ranged: 2, worker: 2.5 },
    cost: { gold: 80, wood: 20 }, trainTime: 6500,
  },
  priest: {
    name: t('كاهن'), desc: t('يعالج الجنود حوله'), sprite: 'priest', hp: 60, speed: 32, role: 'support',
    healer: { amount: 9, range: 60, rate: 1400 }, sight: 100,
    cost: { gold: 90, stone: 30 }, trainTime: 8000,
  },
  ballista: {
    name: t('منجنيق'), desc: t('يدمّر المباني من بعيد'), sprite: 'ballista', hp: 140, speed: 20, role: 'support',
    damage: 34, range: 135, attackRate: 3200, sight: 140, ranged: true, projectile: 'bolt', siege: true,
    bonus: { building: 3, unit: 0.5 }, cost: { gold: 120, wood: 160 }, trainTime: 11000,
  },
  // heroes: one at a time per side, hired at the tavern, each with an automatic ability
  arthax: {
    name: t('آرثاكس'), desc: t('نيزك · مطر السهام · نفير الحرب'), sprite: 'arthax', hp: 420, speed: 38, hero: true,
    damage: 22, range: 15, attackRate: 900, sight: 100,
    ability: { type: 'warcry', every: 12000, radius: 60, mult: 1.35, duration: 6000 },
    cost: { gold: 300, wood: 100 }, trainTime: 12000,
  },
  grum: {
    name: t('غروم'), desc: t('صاعقة · الدوامة · زلزال'), sprite: 'grum', hp: 520, speed: 32, hero: true,
    damage: 26, range: 15, attackRate: 1100, sight: 90,
    ability: { type: 'whirlwind', every: 8000, radius: 24, damage: 30 },
    cost: { gold: 300, stone: 100 }, trainTime: 12000,
  },
  kanji: {
    name: t('كانجي'), desc: t('الاندفاع · قنبلة دخان · خط النار'), sprite: 'kanji', hp: 360, speed: 46, hero: true,
    damage: 20, range: 15, attackRate: 700, sight: 110,
    ability: { type: 'dash', every: 7000, range: 90, mult: 3 },
    cost: { gold: 300, wood: 60, stone: 40 }, trainTime: 12000,
  },
};

// formation role of each unit (default: ranged -> back, others -> front)
export const roleOf = (def) => def.role || (def.ranged ? 'back' : 'front');

// ---------------- Upgrades (researched at the blacksmith) ----------------
// Blacksmith upgrades, researched level by level. values[i] = the bonus at level i+1
// (kept modest on purpose). icon = its picture in assets/ui/upgrades.png.
// Level 3 needs a workshop. desc uses {0} for the bonus of the next level.
const UP_COST = [{ gold: 100, wood: 80 }, { gold: 200, wood: 150, stone: 50 }, { gold: 350, wood: 250, stone: 120 }];
const UP_TIME = [20000, 30000, 40000];
export const UPGRADES = {
  tools:   { icon: 0, name: t('أدوات العمال'), desc: t('العمال يجمعون أسرع {0}%'), values: [0.10, 0.20, 0.30] },
  melee:   { icon: 1, name: t('أسلحة الالتحام'), desc: t('+{0}% ضرر للسيوف والرماح والفؤوس'), values: [0.08, 0.16, 0.24] },
  ranged:  { icon: 2, name: t('الرماية'), desc: t('+{0}% ضرر للرماة والبنادق'), values: [0.08, 0.16, 0.24] },
  armor:   { icon: 3, name: t('الدروع'), desc: t('جنودك يأخذون ضرراً أقل {0}%'), values: [0.06, 0.12, 0.18] },
  horse:   { icon: 4, name: t('حدوة الخيل'), desc: t('الفرسان أسرع {0}%'), values: [0.08, 0.15] },
  masonry: { icon: 5, name: t('الأسوار الحجرية'), desc: t('الأسوار والأبراج أقوى {0}%'), values: [0.30, 0.60] },
};
for (const u of Object.values(UPGRADES)) { u.max = u.values.length; u.costs = UP_COST.slice(0, u.max); u.times = UP_TIME.slice(0, u.max); }
export const UP_LEVEL3_NEEDS = 'workshop';
// the current level / bonus of an upgrade for a kingdom's economy
export const upLevel = (eco, key) => eco?.upgrades?.[key] || 0;
export const upValue = (eco, key) => { const l = upLevel(eco, key); return l ? UPGRADES[key].values[l - 1] : 0; };

// ---------------- Market prices (per 100) ----------------
export const MARKET = {
  sell: { wood: 50, stone: 60 },     // you get this much gold for 100
  buy:  { wood: 90, stone: 110 },    // you pay this much gold for 100
};

// ---------------- Buildings ----------------
// sheet: texture name ("{team}" is replaced), frame: frame in the sheet, size: tiles
// wip: the unpainted wooden version shown in the last building stage
//      (stages: marked plot -> stone foundation -> wooden frame -> finished)
export const BUILDINGS = {
  keep: {
    name: t('القلعة'), sheet: 'keep_{team}', frame: 0, size: 2, hp: 1500,
    pop: 5, trains: ['worker'], dropOff: true,
    attack: { damage: 6, range: 75, rate: 1500 },
    garrison: true,       // workers can hide inside (alarm bell) and shoot from it
  },
  house: {
    name: t('منزل'), desc: t('+5 سكان'), sheet: 'houses_{team}', frame: 3, size: 1, hp: 250,
    pop: 5, cost: { wood: 60 }, buildTime: 6000, wip: ['houses_{team}', 0],
  },
  barracks: {
    name: t('ثكنة'), desc: t('تدريب الجنود'), sheet: 'barracks_{team}', frame: 5, size: 1, hp: 450,
    cost: { gold: 80, wood: 120 }, buildTime: 9000, wip: ['houses_{team}', 1],
    trains: ['swordsman', 'spearman', 'axeman', 'bowman', 'assassin'],
  },
  workshop: {
    name: t('ورشة'), wip: ['houses_{team}', 2], desc: t('فرسان وبنادق'), sheet: 'workshops_{team}', frame: 4, size: 1, hp: 500,
    cost: { gold: 120, wood: 100, stone: 60 }, buildTime: 11000, requires: 'barracks',
    trains: ['knight', 'musketeer', 'ballista'],
  },
  chapel: {
    name: t('معبد'), desc: t('سحرة وكهنة'), wip: ['chapels_{team}', 0], sheet: 'chapels_{team}', frame: 4, size: 1, hp: 450,
    cost: { gold: 150, stone: 100 }, buildTime: 12000, requires: 'barracks',
    trains: ['mage', 'priest'],
  },
  storehouse: {
    name: t('مخزن'), desc: t('نقطة تسليم قريبة'), sheet: 'resources_{team}', frame: 6, size: 1, hp: 300,
    cost: { wood: 80 }, buildTime: 6000, dropOff: true, wip: ['houses_{team}', 2],
  },
  mill: {
    name: t('طاحونة'), desc: t('+4 ذهب كل 5 ث'), sheet: 'resources_{team}', frame: 3, size: 1, hp: 250,
    cost: { gold: 40, wood: 100 }, buildTime: 8000, wip: ['houses_{team}', 0],
    income: { type: 'gold', amount: 4, every: 5000 },
  },
  tower: {
    name: t('برج'), desc: t('يرمي السهام'), sheet: 'tower_{team}', frame: 9, size: 1, hp: 500,
    cost: { wood: 50, stone: 80 }, buildTime: 10000, wip: ['tower_{team}', 0],
    attack: { damage: 8, range: 85, rate: 1100 },
  },
  wall: {
    name: t('سور'), desc: t('اسحب خطاً'), sheet: 'walls_{team}', frame: 10, size: 1, hp: 400,
    cost: { stone: 5 }, buildTime: 1800, wall: true,
  },
  gate: {
    name: t('بوابة'), sheet: 'walls_{team}', frame: 16, size: 1, hp: 500,
    cost: { wood: 20, stone: 10 }, buildTime: 3000, wall: true, gate: true,
  },
  barrier: {
    name: t('حاجز رماح'), desc: t('يجرح من يضربه، ×3 للفرسان'), sheet: 'spearwall', frame: 0, size: 1, hp: 220,
    cost: { wood: 15 }, buildTime: 1500, wall: true, noTile: true, thorns: 7,
  },
  well: {
    name: t('بئر'), desc: t('يعالج جنودك القريبين'), sheet: 'well_{team}', frame: 0, size: 1, hp: 300,
    cost: { wood: 60, stone: 40 }, buildTime: 7000, wip: ['houses_{team}', 0],
    heal: { radius: 56, amount: 5, every: 1000 },
  },
  blacksmith: {
    name: t('حدّاد'), desc: t('ترقيات دائمة'), sheet: 'workshops_{team}', frame: 7, size: 1, hp: 450,
    cost: { gold: 100, wood: 120 }, buildTime: 10000, wip: ['houses_{team}', 1], requires: 'barracks',
    research: ['tools', 'melee', 'ranged', 'armor', 'horse', 'masonry'],
  },
  market: {
    name: t('سوق'), desc: t('بيع وشراء الموارد'), sheet: 'market_{team}', frame: 4, size: 1, hp: 350,
    cost: { wood: 120, gold: 40 }, buildTime: 8000, wip: ['houses_{team}', 2], market: true,
  },
  tavern: {
    name: t('حانة'), desc: t('توظيف بطل'), sheet: 'taverns_{team}', frame: 1, size: 1, hp: 450,
    cost: { gold: 120, wood: 120 }, buildTime: 10000, wip: ['houses_{team}', 0], requires: 'barracks',
    trains: ['arthax', 'grum', 'kanji'],
  },
};

// Buildings shown on the build menu (in order)
export const BUILD_MENU = ['house', 'barracks', 'storehouse', 'mill', 'well', 'tower', 'wall', 'barrier', 'blacksmith', 'market', 'workshop', 'chapel', 'tavern'];
// the build menu in three tabs (bottom panel)
export const BUILD_TABS = {
  eco: { icon: '🏠', name: t('اقتصاد'), items: ['house', 'storehouse', 'mill', 'market', 'well'] },
  war: { icon: '⚔️', name: t('عسكري'), items: ['barracks', 'workshop', 'chapel', 'blacksmith', 'tavern'] },
  def: { icon: '🛡', name: t('دفاع'), items: ['tower', 'wall', 'barrier'] },
};

// ---------------- Resources on the map ----------------
// (amounts raised: trees and mines last about 2.5x longer, so forests don't vanish in minutes)
// mine: true = can be owned. A mine starts neutral; the first side whose workers
// mine it takes it (it turns that side's colour) and only that side can mine it.
// It becomes neutral again after 10 s with no owner worker on it.
export const RESOURCE_NODES = {
  tree:   { type: 'wood',  sheet: 'trees',          frames: [1, 2, 3],    amount: 150, stump: 0 },
  pine:   { type: 'wood',  sheet: 'pines',          frames: [1, 1, 2],    amount: 170, stump: 0 },
  palm:   { type: 'wood',  sheet: 'palms',          frames: [2, 3, 4, 5], amount: 130, stump: 0 },
  rock:   { type: 'stone', sheet: 'rocks',          frames: [0, 1, 2],    amount: 280 },
  // winter
  snowtree:  { type: 'wood',  sheet: 'wintertrees', frames: [13, 15],  amount: 150, stump: 12 },
  snowpine:  { type: 'wood',  sheet: 'wintertrees', frames: [14],      amount: 170, stump: 12 },
  frostdead: { type: 'wood',  sheet: 'winterdead',  frames: [2, 3],    amount: 110, stump: 0 },
  snowrock:  { type: 'stone', sheet: 'rocks',       frames: [9, 10, 11], amount: 280 },
  // wasteland
  cactus:    { type: 'wood',  sheet: 'cactus',      frames: [0, 1, 2, 3], amount: 160 },
  deadtree:  { type: 'wood',  sheet: 'deadtrees',   frames: [2, 3],    amount: 180, stump: 0 },
  quarry: { type: 'stone', sheet: 'resources_wood', frames: [9],          amount: 1800, mine: true },
  gold:   { type: 'gold',  sheet: 'resources_wood', frames: [12],         amount: 2200, mine: true },
};
export const MINE_RELEASE_MS = 10000;

// ---------------- Enemy AI ----------------
export const ENEMY = {
  thinkEvery: 1000,       // ms between decisions
  workerTarget: [7, 12, 16],   // wanted workers (grows over time)
  firstAttackArmy: 5,     // soldiers needed for the first attack
  armyGrowth: 2,          // each attack needs this many more
  maxWaitBetweenAttacks: 180000, // attack anyway after this long
  minFirstAttack: 210000, // never attack before 3.5 minutes
  incomeBonus: 1.0,       // >1 = cheating enemy (difficulty)
};
