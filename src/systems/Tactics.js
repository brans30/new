import { t } from '../i18n.js';
import { TILE, roleOf, TEAM, raceOf, upValue } from '../data/config.js';

// =====================================================================
//  Battle tactics: formations, terrain, flanking and damage rules.
//  Everything that makes "where and how you fight" matter lives here.
// =====================================================================

export const FORMATIONS = {
  line: { name: t('خط'), icon: '▬' },    // wide front: melee in front, ranged behind
  box:  { name: t('مربع'), icon: '◼' },  // melee on the outside, ranged & healers inside
  loose:{ name: t('حر'), icon: '⁘' },    // simple grid, no roles
};

const FRONT_ORDER = { spearman: 0, swordsman: 1, axeman: 2, arthax: 1, grum: 1, kanji: 2, knight: 3, assassin: 4 };
const SPACING = 11;

/**
 * Positions for a group moving to (x,y).
 * The formation faces the direction of travel (from the group's centre to the target):
 * row 0 is the front line.  Returns a Map unit -> {x, y}.
 */
export function formationSlots(units, x, y, type = 'line') {
  const out = new Map();
  if (!units.length) return out;
  const cx = units.reduce((s, u) => s + u.x, 0) / units.length;
  const cy = units.reduce((s, u) => s + u.y, 0) / units.length;
  let a = Math.atan2(y - cy, x - cx);
  if (Math.hypot(x - cx, y - cy) < 8) a = -Math.PI / 2;
  const fx = Math.cos(a), fy = Math.sin(a);         // forward
  const sx = -fy, sy = fx;                            // side
  const place = (u, f, s) => out.set(u, { x: x + fx * f + sx * s, y: y + fy * f + sy * s });

  const front = units.filter(u => roleOf(u.def) === 'front').sort((p, q) => (FRONT_ORDER[p.kind] ?? 5) - (FRONT_ORDER[q.kind] ?? 5));
  const back = units.filter(u => roleOf(u.def) === 'back');
  const support = units.filter(u => roleOf(u.def) === 'support');

  if (type === 'loose') {
    const cols = Math.ceil(Math.sqrt(units.length));
    units.forEach((u, i) => place(u, -Math.floor(i / cols) * SPACING, ((i % cols) - (cols - 1) / 2) * SPACING));
    return out;
  }

  if (type === 'line') {
    // each role gets its own rows, front first
    const width = Math.max(4, Math.ceil(Math.sqrt(units.length) * 1.6));
    let row = 0;
    for (const group of [front, back, support]) {
      for (let i = 0; i < group.length; i += width) {
        const rowUnits = group.slice(i, i + width);
        rowUnits.forEach((u, j) => place(u, -row * SPACING, (j - (rowUnits.length - 1) / 2) * SPACING));
        row++;
      }
    }
    return out;
  }

  // box: square grid; outer ring = melee, inside = ranged then support
  const k = Math.max(2, Math.ceil(Math.sqrt(units.length)));
  const cells = [];
  for (let r = 0; r < k; r++) for (let c = 0; c < k; c++) {
    const ring = Math.min(r, c, k - 1 - r, k - 1 - c);
    cells.push({ f: ((k - 1) / 2 - r) * SPACING, s: (c - (k - 1) / 2) * SPACING, ring, frontness: -r });
  }
  // outer ring first (front side first), then inner rings
  cells.sort((p, q) => p.ring - q.ring || q.frontness - p.frontness);
  const order = [...front, ...back, ...support];
  // melee fill the outer cells, everyone else fills from the inside out
  const outer = cells.filter(c => c.ring === 0), inner = cells.filter(c => c.ring > 0).reverse();
  const meleeCells = outer.slice(0, front.length).concat(inner.slice(0, Math.max(0, front.length - outer.length)));
  const rest = cells.filter(c => !meleeCells.includes(c)).sort((p, q) => q.ring - p.ring);
  front.forEach((u, i) => place(u, meleeCells[i].f, meleeCells[i].s));
  [...back, ...support].forEach((u, i) => place(u, rest[i].f, rest[i].s));
  return out;
}

// ---------------- terrain ----------------
const NEAR = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]];

// standing among trees: harder to hit with arrows, and hidden from far away
export function inCover(scene, u) {
  const tx = Math.floor(u.x / TILE), ty = Math.floor(u.y / TILE);
  let trees = 0;
  for (const [dx, dy] of NEAR) { const e = scene.grid.get(tx + dx, ty + dy); if (e && e.type === 'wood' && e.alive) trees++; }
  return trees >= 2;
}

// right next to our own wall / tower / keep: protected, and archers shoot further
export function nearDefense(scene, u) {
  const tx = Math.floor(u.x / TILE), ty = Math.floor(u.y / TILE);
  for (const [dx, dy] of NEAR) {
    const e = scene.grid.get(tx + dx, ty + dy);
    if (e && e.team === u.team && e.alive && (e.def?.wall || e.def?.attack)) return true;
  }
  return false;
}

// nothing around: knights fight best in the open
export function openGround(scene, u) {
  const tx = Math.floor(u.x / TILE), ty = Math.floor(u.y / TILE);
  for (const [dx, dy] of NEAR) if (!scene.grid.isFree(tx + dx, ty + dy)) return false;
  return true;
}

// standing on top of a plateau
export function isHigh(scene, u) {
  return !!scene.terrain?.isHigh(Math.floor(u.x / TILE), Math.floor(u.y / TILE));
}

const DIR_VEC = { down: [0, 1], up: [0, -1], right: [1, 0], left: [-1, 0] };

// is the attacker hitting the target from behind?
export function fromBehind(attacker, target) {
  const v = DIR_VEC[target.dir];
  if (!v || target.state === 'idle') return false;    // standing still = watching all around
  const dx = attacker.x - target.x, dy = attacker.y - target.y;
  const d = Math.hypot(dx, dy) || 1;
  return (dx * v[0] + dy * v[1]) / d < -0.5;
}

/**
 * Final damage multiplier for one hit. Returns { mult, tag } (tag = short text shown in battle).
 */
export function damageFor(scene, from, target, isUnitTarget, isBuilding) {
  let mult = 1, tag = '';
  const d = from?.def || {};
  const tdef = target.def || {};
  const b = d.bonus || {};
  if (b.knight && tdef.mounted) mult *= b.knight;
  if (b.building && isBuilding) mult *= b.building;
  if (b.ranged && tdef.ranged) mult *= b.ranged;
  if (b.worker && target.kind === 'worker') mult *= b.worker;
  if (b.unit && isUnitTarget) mult *= b.unit;

  // the people's strengths: orcs hit harder up close, shoot weaker
  if (from?.team && d.damage && !d.hero) { const R = raceOf(from.team); mult *= d.ranged ? R.rangedDmg : R.meleeDmg; }
  // blacksmith: sharper blades / better arrows for the attacker, armour for the target
  const myEco = from?.team ? scene.eco[from.team] : null;
  if (myEco && d.damage && !d.hero && from.kind !== 'worker') mult *= 1 + upValue(myEco, d.ranged ? 'ranged' : 'melee');
  if (isUnitTarget && target.team && target.kind !== 'worker' && !target.def?.hero) mult *= 1 - upValue(scene.eco[target.team], 'armor');
  if (from?.buffUntil > scene.simTime) mult *= from.buffMult || 1;

  if (isUnitTarget && from?.x !== undefined) {
    if (!d.ranged && from.kind && fromBehind(from, target)) { mult *= 1.5; tag = 'flank'; }
    if (d.ranged && inCover(scene, target)) { mult *= 0.65; tag = 'cover'; }
    if (d.ranged && nearDefense(scene, target)) mult *= 0.7;
    // high ground: shooting down hits harder, shooting up is weaker
    const hiFrom = isHigh(scene, from), hiTo = isHigh(scene, target);
    if (d.ranged && hiFrom && !hiTo) { mult *= 1.25; tag = tag || 'high'; }
    if (d.ranged && hiTo && !hiFrom) mult *= 0.75;
  }
  if (d.mounted && from.kind && openGround(scene, from)) mult *= 1.2;
  if (from?.chargeReady) { mult *= 2; tag = 'charge'; from.chargeReady = false; }
  return { mult, tag };
}

// range bonus: archers next to our walls/towers shoot 25% further, on high ground 30% further
export function rangeFor(scene, u) {
  if (!u.def.ranged) return u.def.range;
  let r = u.def.range;
  if (nearDefense(scene, u)) r *= 1.25;
  if (isHigh(scene, u)) r *= 1.3;
  return r;
}

export { TEAM };
