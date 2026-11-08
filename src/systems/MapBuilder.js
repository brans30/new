import { T, lakeDepthAt, cliffPiece } from './Terrain.js';
import { MAPS } from '../data/maps.js';

// =====================================================================
//  MapBuilder: makes the whole layout of a map from its theme and a seed.
//  It does not touch Phaser, so the setup screen uses the very same plan
//  to draw its preview — what you see there is what you get.
//
//  Fairness: everything is made for ONE part of the map and copied by
//  symmetry (left half -> right for 2 kingdoms, one corner -> all four
//  for 3-4 kingdoms), so every start spot gets the same land.
//
//  Natural look:
//    - lakes are several overlapping circles with a wobbly shore
//    - forests are noise blobs: thick in the middle, ragged at the edges
//    - plateaus are unions of rectangles (L, T and bean shapes) drawn
//      with the cliff pack's corner and inside-corner pieces
//    - after placing everything we check that every base can reach every
//      other base and its mines; trees on the way are cleared
// =====================================================================

export const SIZES = {
  2: { w: 68, h: 44, sym: 'x', spots: [[6, 21], [60, 21]] },
  4: { w: 80, h: 60, sym: 'xy', spots: [[8, 8], [70, 8], [8, 50], [70, 50]] },
  // 5-6 kingdoms: three blocks side by side, two rows. The left block is designed and the
  // others are mirror copies (middle) or straight copies (right), top and bottom mirrored.
  6: { w: 102, h: 62, sym: '6', spots: [[16, 8], [50, 8], [84, 8], [16, 52], [50, 52], [84, 52]] },
};
export const sizeKey = (players) => (players <= 2 ? 2 : players <= 4 ? 4 : 6);

// tiny seeded random generator (same seed = same map, here and in the preview)
function rng(seedText) {
  let h = 1779033703;
  for (let i = 0; i < seedText.length; i++) { h = Math.imul(h ^ seedText.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = h >>> 0;
  const next = () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    frac: next,
    between: (a0, b0) => a0 + next() * (b0 - a0),
    int: (a0, b0) => Math.floor(a0 + next() * (b0 - a0 + 1)),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
  };
}

const cache = new Map();
export function buildMap(mapId, players, seed = 1) {
  const key = `${mapId}:${sizeKey(players)}:${seed}`;
  if (!cache.has(key)) cache.set(key, buildFresh(mapId, players, seed));
  return cache.get(key);
}

function buildFresh(mapId, players, seed) {
  const theme = MAPS[mapId] || MAPS.green;
  for (let attempt = 0; attempt < 12; attempt++) {
    const plan = tryBuild(theme, mapId, players, `${mapId}:${players}:${seed}:${attempt}`);
    if (plan) return plan;
  }
  // should never happen; fall back to an empty but playable field
  return tryBuild({ ...theme, lakes: { n: 0 }, hills: { n: 0 }, midLake: 0 }, mapId, players, 'fallback');
}

function tryBuild(theme, mapId, players, seedText) {
  const R = rng(seedText);
  const S = SIZES[sizeKey(players)];
  const W = S.w, H = S.h, sym = S.sym;
  const N = W * H;
  const idx = (x, y) => y * W + x;
  const inMap = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
  const ter = new Uint8Array(N);              // T.* codes
  const node = new Array(N).fill(null);       // resource kind per tile
  const keepOut = new Uint8Array(N);          // 1 = nothing may grow here (bases, stairs)
  const clear = new Set();                    // stairs + approach (never built on)
  const spots = S.spots.map(([x, y]) => ({ x, y }));
  const src = spots[0];                       // the spot whose part of the map we design
  const RW = sym === '6' ? W / 3 : W / 2;     // width of the designed block
  const regionW = RW, regionH = sym === 'x' ? H : H / 2;
  const inRegion = (x, y) => x >= 0 && y >= 0 && x < regionW && y < regionH;
  // the symmetry: [x transform, y transform, flips left-right?, flips up-down?]
  const MX = (x) => 2 * RW - 1 - x;           // mirror into the next block
  const FLIPS = sym === 'x' ? [[(x) => x, (y) => y, 0, 0], [(x) => W - 1 - x, (y) => y, 1, 0]]
    : sym === 'xy' ? [[(x) => x, (y) => y, 0, 0], [(x) => W - 1 - x, (y) => y, 1, 0], [(x) => x, (y) => H - 1 - y, 0, 1], [(x) => W - 1 - x, (y) => H - 1 - y, 1, 1]]
    : [0, 1].flatMap(fy => [[(x) => x, 0], [MX, 1], [(x) => 2 * RW + x, 0]].map(([fx, m]) => [fx, fy ? (y) => H - 1 - y : (y) => y, m, fy]));
  // every copy of a tile under the symmetry
  const copies = (x, y) => FLIPS.map(([fx, fy]) => [fx(x), fy(y)]);
  const center = { x: (W - 1) / 2, y: (H - 1) / 2 };
  // direction from our spot toward the middle of the map (6 kingdoms: toward the next block, and down)
  const toMid = sym === '6' ? { x: 1, y: 1 } : { x: Math.sign(center.x - src.x) || 1, y: sym === 'xy' ? Math.sign(center.y - src.y) || 1 : 0 };
  const kc = { x: src.x + 1, y: src.y + 1 };   // keep centre (in tiles)
  const distSpot = (x, y) => Math.min(...spots.map(s => Math.hypot(x - s.x - 0.5, y - s.y - 0.5)));

  // ---------- 1) bases: nothing in the 2x2 keep and a ring around it ----------
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (distSpot(x, y) < 4.5) keepOut[idx(x, y)] = 1;

  // ---------- 2) lakes ----------
  const lakes = [];
  const addLake = (circles) => {
    const seen = new Set();
    for (const [fx, fy] of FLIPS) {
      const m = circles.map(([x, y, r]) => [fx(x), fy(y), r]);
      const k = JSON.stringify(m.map(c => c.map(v => Math.round(v * 10))).sort());
      if (!seen.has(k)) { seen.add(k); lakes.push(m); }
    }
  };
  // a river through the middle, with shallow fords to cross it (2 kingdoms: north-south;
  // 4 kingdoms: a cross that splits the map into four, fords on every arm)
  if (theme.river && sym === '6') {
    // 6 kingdoms: one river across the middle, a ford in front of every kingdom and between them
    const rw = theme.river.w, fords = [RW * 0.5, RW, RW * 1.5, RW * 2, RW * 2.5].map(f => f - 0.5);
    let seg = [];
    for (let t = -1; t <= W + 1; t += 1.1) {
      if (fords.some(f => Math.abs(t - f) < 2.4)) { if (seg.length) lakes.push(seg); seg = []; continue; }
      seg.push([t, center.y, rw * (0.85 + 0.3 * Math.sin(t * 0.45) * Math.sin(t * 0.17 + 1))]);
    }
    if (seg.length) lakes.push(seg);
  } else if (theme.river) {
    const rw = theme.river.w;
    const run = (along, len, fixed, fords, vertical) => {
      let seg = [];
      for (let t = -1; t <= len + 1; t += 1.1) {
        const ford = fords.some(f => Math.abs(t - f) < 2.4);
        if (ford) { if (seg.length) addLake(seg); seg = []; continue; }
        const rr = rw * (0.85 + 0.3 * Math.sin(t * 0.45) * Math.sin(t * 0.17 + 1));
        seg.push(vertical ? [fixed, t, rr] : [t, fixed, rr]);
      }
      if (seg.length) addLake(seg);
    };
    if (sym === 'xy') {
      run('y', H, center.x, [H * 0.22, H * 0.78, center.y], true);
      run('x', W, center.y, [W * 0.22, W * 0.78, center.x], false);
    } else run('y', H, center.x, [H * 0.18, H * 0.5, H * 0.82], true);
  }
  if (theme.midLake) {
    const r = theme.midLake;
    if (sym === '6') addLake([[RW / 2 - 0.5, center.y, r], [RW / 2 - 0.5 - r * 0.7, center.y, r * 0.65], [RW / 2 - 0.5 + r * 0.7, center.y, r * 0.65]]);
    else if (sym === 'xy') addLake([[center.x, center.y, r], [center.x - r * 0.7, center.y, r * 0.65], [center.x + r * 0.7, center.y, r * 0.65]]);
    else addLake([[center.x, H * 0.33, r], [center.x - r * 0.6, H * 0.33 + r * 0.5, r * 0.6], [center.x + r * 0.6, H * 0.33 + r * 0.5, r * 0.6]]);
  }
  for (let i = 0, tries = 0; i < (theme.lakes?.n || 0) && tries < 200; tries++) {
    const r = R.between(...theme.lakes.r);
    const x = R.between(2, regionW - 1), y = R.between(2, regionH - 2);
    if (distSpot(x, y) < r + 8) continue;
    if (lakes.some(l => l.some(([cx, cy, cr]) => Math.hypot(cx - x, cy - y) < cr + r + 3.5))) continue;
    const parts = [[x, y, r]];
    for (let k = R.int(0, 2); k > 0; k--) { const a = R.between(0, 6.28); parts.push([x + Math.cos(a) * r * 0.9, y + Math.sin(a) * r * 0.7, r * R.between(0.5, 0.8)]); }
    addLake(parts);
    i++;
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++)
    if (lakeDepthAt(lakes, (x + 0.5) * 16, (y + 0.5) * 16) > 3) ter[idx(x, y)] = T.WATER;
  // a base must never be flooded
  for (const s of spots) for (let y = s.y - 3; y < s.y + 5; y++) for (let x = s.x - 3; x < s.x + 5; x++) if (inMap(x, y) && ter[idx(x, y)] === T.WATER) return null;

  // decorative rocky islands in the middle of big lakes (Cliff-Water.png)
  const islands = [];
  if (theme.islands) for (const lake of lakes) {
    const [cx, cy, r] = lake[0];
    if (r < 3) continue;
    const x0 = Math.round(cx) - 1, y0 = Math.round(cy) - 1;
    let deep = true;
    for (let y = y0 - 1; y < y0 + 4 && deep; y++) for (let x = x0 - 1; x < x0 + 4; x++)
      if (!inMap(x, y) || ter[idx(x, y)] !== T.WATER) { deep = false; break; }
    if (deep) islands.push([x0, y0]);
  }

  // ---------- 3) plateaus ----------
  const plateaus = [];
  const isPlateau = new Uint8Array(N);
  const nearWater = (x, y, d) => { for (let dy = -d; dy <= d; dy++) for (let dx = -d; dx <= d; dx++) if (inMap(x + dx, y + dy) && ter[idx(x + dx, y + dy)] === T.WATER) return true; return false; };
  for (let i = 0, tries = 0; i < (theme.hills?.n || 0) && tries < 400; tries++) {
    // a main block plus one or two blocks sticking out: L, T, bean shapes
    const hs = theme.hills.size || [5, 8, 4, 6];
    const w0 = R.int(hs[0], hs[1]), h0 = R.int(hs[2], hs[3]);
    const x0 = R.int(1, Math.floor(regionW) - w0 - 2), y0 = R.int(1, Math.floor(regionH) - h0 - 2);
    const rects = [[x0, y0, w0, h0]];
    for (let k = R.int(1, 2); k > 0; k--) {
      const w = R.int(3, 5), h = R.int(3, 4);
      const side = R.int(0, 3);
      const ox = side === 0 ? x0 - w + 2 : side === 1 ? x0 + w0 - 2 : x0 + R.int(0, Math.max(0, w0 - w));
      const oy = side === 2 ? y0 - h + 2 : side === 3 ? y0 + h0 - 2 : y0 + R.int(0, Math.max(0, h0 - h));
      rects.push([ox, oy, w, h]);
    }
    const cells = new Set();
    for (const [rx, ry, rw, rh] of rects) for (let y = ry; y < ry + rh; y++) for (let x = rx; x < rx + rw; x++) cells.add(idx(x, y));
    const list = [...cells].map(i2 => [i2 % W, (i2 / W) | 0]);
    // must stay inside our part of the map, away from water, bases and other plateaus
    if (list.some(([x, y]) => !inRegion(x, y) || x < 1 || y < 1 || x > regionW - 2 || y > regionH - 2 || (sym === 'x' ? y > H - 2 : false))) continue;
    if (list.some(([x, y]) => nearWater(x, y, 2) || distSpot(x, y) < 9 || isPlateau[idx(x, y)])) continue;
    if (list.some(([x, y]) => { for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) if (inMap(x + dx, y + dy) && isPlateau[idx(x + dx, y + dy)]) return true; return false; })) continue;
    // every tile must have a cliff piece that can be drawn
    const inside = (x, y) => inMap(x, y) && cells.has(idx(x, y));
    const pieces = list.map(([x, y]) => [x, y, cliffPiece(inside, x, y)]);
    if (pieces.some(p => !p[2])) continue;
    const high = pieces.filter(p => p[2] === 'c');
    if (high.length < 6) continue;
    // stairs: two side by side on the front (or back) cliff face, facing the middle if possible
    const faces = [];
    for (const [x, y, p] of pieces) {
      if (p === 'b' && inside(x + 1, y) && pieces.find(q => q[0] === x + 1 && q[1] === y)?.[2] === 'b'
        && inside(x, y - 1) && cliffPiece(inside, x, y - 1) === 'c' && cliffPiece(inside, x + 1, y - 1) === 'c') faces.push({ x, y, dir: 1 });
      if (p === 't' && pieces.find(q => q[0] === x + 1 && q[1] === y)?.[2] === 't'
        && cliffPiece(inside, x, y + 1) === 'c' && cliffPiece(inside, x + 1, y + 1) === 'c') faces.push({ x, y, dir: -1 });
    }
    const okFace = (f) => [0, 1].every(dx => [1, 2].every(k => {
      const tx = f.x + dx, ty = f.y + f.dir * k;
      return inMap(tx, ty) && ter[idx(tx, ty)] === T.GRASS && !cells.has(idx(tx, ty)) && !isPlateau[idx(tx, ty)];
    }));
    const usable = faces.filter(okFace).sort((a, b) =>
      Math.hypot(a.x - center.x, a.y - center.y) - Math.hypot(b.x - center.x, b.y - center.y));
    if (!usable.length) continue;
    const chosen = [usable[0]];
    const other = usable.find(f => f.dir !== usable[0].dir || Math.abs(f.x - usable[0].x) > 3);
    if (other && R.frac() < 0.6) chosen.push(other);
    // accept: mark it (and its mirror copies)
    for (const [mx, my, , fy] of FLIPS) {
      const mc = new Set(list.map(([x, y]) => idx(mx(x), my(y))));
      const mInside = (x, y) => inMap(x, y) && mc.has(idx(x, y));
      const mp = { cells: [], high: [], stairs: [], cx: 0, cy: 0 };
      for (const [x, y] of list) {
        const X = mx(x), Y = my(y), piece = cliffPiece(mInside, X, Y);
        mp.cells.push([X, Y, piece]);
        isPlateau[idx(X, Y)] = 1;
        ter[idx(X, Y)] = piece === 'c' ? T.HIGH : T.CLIFF;
        if (piece === 'c') mp.high.push([X, Y]);
        mp.cx += (X + 0.5) * 16; mp.cy += (Y + 0.5) * 16;
      }
      mp.cx /= list.length; mp.cy /= list.length;
      for (const f of chosen) for (const dx of [0, 1]) {
        // mirroring left-right swaps which stair tile is left; flipping up-down turns front steps into back steps
        const X = mx(f.x + dx), Y = my(f.y), dir = fy ? -f.dir : f.dir;
        ter[idx(X, Y)] = T.STAIRS;
        mp.stairs.push([X, Y, dir]);
        for (const k of [-1, 0, 1, 2]) { const ty = Y + dir * k; clear.add(idx(X, ty)); keepOut[idx(X, ty)] = 1; }
      }
      plateaus.push(mp);
    }
    i++;
  }

  // ---------- 4) resources ----------
  const free = (x, y) => inMap(x, y) && ter[idx(x, y)] === T.GRASS && !node[idx(x, y)] && !keepOut[idx(x, y)];
  const put = (x, y, kind) => {
    if (!free(x, y)) return false;
    for (const [cx, cy] of copies(x, y)) if (free(cx, cy)) node[idx(cx, cy)] = kind;
    return true;
  };
  // nearest free tile to a wished-for spot (inside our part of the map)
  const near = (x, y, maxR = 4) => {
    for (let r = 0; r <= maxR; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const tx = Math.round(x) + dx, ty = Math.round(y) + dy;
      if (Math.max(Math.abs(dx), Math.abs(dy)) === r && inRegion(tx, ty) && free(tx, ty)) return [tx, ty];
    }
    return null;
  };
  const placeNear = (x, y, kind, maxR) => { const p = near(x, y, maxR); if (p) put(p[0], p[1], kind); return p; };

  // smooth value noise for ragged forest edges
  const nOff = R.frac() * 1000;
  const hash = (x, y) => { const s = Math.sin((x + nOff) * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
  const noise = (x, y) => {
    const X = Math.floor(x / 3), Y = Math.floor(y / 3), fx = x / 3 - X, fy = y / 3 - Y;
    const a = hash(X, Y), b = hash(X + 1, Y), c = hash(X, Y + 1), d = hash(X + 1, Y + 1);
    const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  const treeKind = (x, y) => {
    const t = theme.trees;
    const wet = [[1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [-2, 0], [0, 2], [0, -2]].some(([dx, dy]) => inMap(x + dx, y + dy) && ter[idx(x + dx, y + dy)] === T.WATER);
    if (wet && t.wet) return t.wet;
    let r = R.frac();
    for (const [kind, p] of t.mix) { if (r < p) return kind; r -= p; }
    return t.mix[0][0];
  };
  const blob = (cx, cy, rad, kind, density) => {
    for (let y = Math.floor(cy - rad - 2); y <= cy + rad + 2; y++) for (let x = Math.floor(cx - rad - 2); x <= cx + rad + 2; x++) {
      if (!inRegion(x, y)) continue;
      const d = Math.hypot((x - cx) / rad, (y - cy) / (rad * 0.8)) + (noise(x, y) - 0.5) * 0.9;
      if (d > 1) continue;
      if (R.frac() < density * (d < 0.6 ? 1 : 0.7)) put(x, y, kind === 'tree' ? treeKind(x, y) : kind);
    }
  };

  // home: a gold mine and a quarry beside the keep, a forest and some rocks close by
  const side = sym === 'x' ? 1 : toMid.y;
  placeNear(kc.x + toMid.x * 5, kc.y - 4 * side, 'gold');
  placeNear(kc.x + toMid.x * 5, kc.y + 4 * side, 'quarry');
  blob(kc.x - toMid.x * 1, kc.y - side * 10, R.between(3.2, 4.2), 'tree', theme.forestDensity);
  blob(kc.x + toMid.x * 4, kc.y + side * 10, R.between(2.6, 3.6), 'tree', theme.forestDensity);
  blob(kc.x - toMid.x * 4, kc.y + side * 6, 1.6, theme.rock, 0.6);

  // expansions: richer spots further away, then the contested middle
  const want = (kind, dMin, dMax, tries = 300) => {
    for (let t = 0; t < tries; t++) {
      const x = R.int(1, Math.floor(regionW) - 2), y = R.int(1, Math.floor(regionH) - 2);
      const d = Math.hypot(x - kc.x, y - kc.y);
      if (d < dMin || d > dMax || !free(x, y)) continue;
      // keep mines apart from each other
      let ok = true;
      for (let dy = -4; dy <= 4 && ok; dy++) for (let dx = -4; dx <= 4; dx++) { const n = inMap(x + dx, y + dy) && node[idx(x + dx, y + dy)]; if (n === 'gold' || n === 'quarry') { ok = false; break; } }
      if (ok && put(x, y, kind)) return true;
    }
    return false;
  };
  want('gold', 13, 20); want('gold', 15, 26); want('quarry', 12, 22);
  want('gold', 20, 34); want('quarry', 20, 34);
  if (theme.extraGold) want('gold', 22, 36);

  for (let i = 0; i < theme.forests.n; i++) {
    for (let t = 0; t < 60; t++) {
      const x = R.between(2, regionW - 2), y = R.between(2, regionH - 2), r = R.between(...theme.forests.r);
      if (Math.hypot(x - kc.x, y - kc.y) < r + 9) continue;
      blob(x, y, r, 'tree', theme.forestDensity);
      break;
    }
  }
  for (let i = 0; i < theme.rocks.n; i++) {
    const x = R.between(3, regionW - 3), y = R.between(3, regionH - 3);
    if (Math.hypot(x - kc.x, y - kc.y) < 9) { i--; continue; }
    blob(x, y, R.between(1.2, 2.2), theme.rock, 0.55);
  }
  // lone trees on open ground
  for (let y = 0; y < regionH; y++) for (let x = 0; x < regionW; x++)
    if (R.frac() < theme.loneTrees && Math.hypot(x - kc.x, y - kc.y) > 7) put(x, y, treeKind(x, y));

  // ---------- 5) every base must reach every other base and its mines ----------
  const passable = (i2) => (ter[i2] === T.GRASS || ter[i2] === T.HIGH || ter[i2] === T.STAIRS) && !node[i2];
  const start = (s) => idx(s.x + 1, s.y + 2 < H ? s.y + 2 : s.y - 1);
  const reach = (from) => {
    const seen = new Uint8Array(N), q = [from]; seen[from] = 1;
    while (q.length) {
      const c = q.pop(), cx = c % W, cy = (c / W) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy;
        if (!inMap(nx, ny)) continue;
        const n2 = idx(nx, ny);
        if (!seen[n2] && (passable(n2) || isKeepTile(nx, ny))) { seen[n2] = 1; q.push(n2); }
      }
    }
    return seen;
  };
  const isKeepTile = (x, y) => spots.some(s => x >= s.x && x < s.x + 2 && y >= s.y && y < s.y + 2);
  // cut a road through trees (never through water or cliffs) where something is cut off
  const carve = (from, to) => {
    const g = new Float32Array(N).fill(Infinity), came = new Int32Array(N).fill(-1), done = new Uint8Array(N);
    g[from] = 0;
    const open = [from];
    while (open.length) {
      let bi = 0; for (let k = 1; k < open.length; k++) if (g[open[k]] < g[open[bi]]) bi = k;
      const c = open.splice(bi, 1)[0];
      if (c === to) break;
      if (done[c]) continue; done[c] = 1;
      const cx = c % W, cy = (c / W) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy;
        if (!inMap(nx, ny)) continue;
        const n2 = idx(nx, ny), t2 = ter[n2];
        if (!(t2 === T.GRASS || t2 === T.HIGH || t2 === T.STAIRS) && n2 !== to) continue;
        const cost = node[n2] && n2 !== to ? 6 : 1;
        if (g[c] + cost < g[n2]) { g[n2] = g[c] + cost; came[n2] = c; open.push(n2); }
      }
    }
    if (came[to] === -1) return false;
    for (let c = came[to]; c !== -1 && c !== from; c = came[c]) {
      if (node[c]) for (const [mx, my] of copies(c % W, (c / W) | 0)) node[idx(mx, my)] = null;
    }
    return true;
  };
  for (let pass = 0; pass < 6; pass++) {
    const seen = reach(start(spots[0]));
    let bad = null;
    for (const s of spots) if (!seen[start(s)]) { bad = start(s); break; }
    if (!bad) for (let i2 = 0; i2 < N && !bad; i2++) {
      if (node[i2] !== 'gold' && node[i2] !== 'quarry') continue;
      const x = i2 % W, y = (i2 / W) | 0;
      const ok = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => inMap(x + dx, y + dy) && seen[idx(x + dx, y + dy)]);
      if (!ok) bad = i2;
    }
    if (!bad) break;
    if (!carve(start(spots[0]), bad)) return null;
    if (pass === 5) return null;
  }
  // every plateau top must be reachable too
  { const seen = reach(start(spots[0])); if (plateaus.some(p => p.high.some(([x, y]) => !seen[idx(x, y)] && !node[idx(x, y)]))) return null; }

  // ---------- 6) decoration + animals ----------
  const decor = [];
  if (theme.decor === 'wheat') {
    for (const [ox, oy, w, h] of [[-4, 3, 3, 2], [3, -6, 2, 1]]) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const tx = src.x + 1 + ox * toMid.x + x, ty = src.y + oy * (sym === 'x' ? 1 : side) + y;
      for (const [cx, cy] of copies(tx, ty)) if (inMap(cx, cy) && ter[idx(cx, cy)] === T.GRASS && !node[idx(cx, cy)] && !isKeepTile(cx, cy) && !clear.has(idx(cx, cy)))
        decor.push([cx, cy, 'wheat', 1 + ((x + y) % 3)]);
    }
  } else if (theme.decor === 'tumbleweed') {
    for (let y = 0; y < regionH; y++) for (let x = 0; x < regionW; x++)
      if (R.frac() < 0.012) for (const [cx, cy] of copies(x, y)) if (ter[idx(cx, cy)] === T.GRASS && !node[idx(cx, cy)]) decor.push([cx, cy, 'tumbleweed', R.int(0, 1)]);
  }
  const horses = [];
  if (theme.horses) for (let t = 0, n = 0; t < 200 && n < 3; t++) {
    const x = R.int(2, Math.floor(regionW) - 2), y = R.int(2, Math.floor(regionH) - 2);
    if (Math.hypot(x - kc.x, y - kc.y) > 12 && free(x, y)) { for (const c of copies(x, y)) horses.push(c); n++; }
  }

  const nodes = [];
  for (let i2 = 0; i2 < N; i2++) if (node[i2]) nodes.push([i2 % W, (i2 / W) | 0, node[i2]]);
  return { mapId, w: W, h: H, sym, spots, ter, lakes, islands, plateaus, clear: [...clear], nodes, decor, horses, theme };
}
