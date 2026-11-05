import { TILE, MAP_W, MAP_H } from '../data/config.js';

// =====================================================================
//  Terrain layer: ground, lakes, plateaus (high ground) and their stairs.
//
//    GRASS   walkable
//    WATER   blocked (lakes)
//    CLIFF   blocked (the rocky rim of a plateau)
//    HIGH    walkable top of a plateau: archers up here shoot further and harder
//    STAIRS  the only way up or down a plateau
//
//  The layout itself (where lakes and plateaus are) comes from MapBuilder;
//  this class stores it, answers "can I walk here?", and draws it.
// =====================================================================
export const T = { GRASS: 0, WATER: 1, CLIFF: 2, HIGH: 3, STAIRS: 4 };

// lake colours per map theme: shore -> shallow -> deep -> deeper
export const SHORES = {
  sand:  [[231, 213, 147], [177, 201, 167], [119, 192, 180], [78, 188, 185], [66, 172, 175]],
  ice:   [[236, 246, 248], [196, 232, 236], [148, 214, 220], [110, 196, 208], [88, 178, 196]],
  oasis: [[222, 200, 140], [190, 196, 150], [119, 192, 180], [78, 188, 185], [66, 172, 175]],
};

// signed distance (in pixels) into the nearest lake; > 0 = inside the water.
// Shared by the map builder (which tiles are water) and the drawing.
export function lakeDepthAt(lakes, px, py) {
  let best = -1e9;
  for (const lake of lakes) for (const [cx, cy, r] of lake) {
    const d = r * TILE - Math.hypot(px - (cx + 0.5) * TILE, py - (cy + 0.5) * TILE);
    if (d > best) best = d;
  }
  // a little wobble so shores aren't perfect circles
  return best + 2.2 * Math.sin(px * 0.19) * Math.cos(py * 0.23) + 1.4 * Math.sin((px + py) * 0.11);
}

// Cliff.png pieces (stone and sandy sets) for each part of a plateau.
//   tl t tr / l c r / bl b br : the 3x3 plateau     in* : inside corners (where the shape bends in)
const CLIFF_SETS = {
  stone: { tl: 0, t: 1, tr: 2, l: 7, c: 8, r: 9, bl: 14, b: 15, br: 16, inw: 17, ine: 18, isw: 24, ise: 25, steps: 40 },
  sand:  { tl: 42, t: 43, tr: 44, l: 49, c: 50, r: 51, bl: 56, b: 57, br: 58, inw: 52, ine: 53, isw: 59, ise: 60, steps: 61 },
};

// Which piece a plateau tile needs, from which neighbours are part of the same plateau.
// Returns null for shapes the tile set can't draw (the builder avoids those).
export function cliffPiece(inside, x, y) {
  const n = inside(x, y - 1), s = inside(x, y + 1), w = inside(x - 1, y), e = inside(x + 1, y);
  if (!n && !s || !w && !e) return null;
  if (!n && !w) return 'tl';
  if (!n && !e) return 'tr';
  if (!s && !w) return 'bl';
  if (!s && !e) return 'br';
  const nw = inside(x - 1, y - 1), ne = inside(x + 1, y - 1), sw = inside(x - 1, y + 1), se = inside(x + 1, y + 1);
  if (!n) return sw && se ? 't' : null;
  if (!s) return nw && ne ? 'b' : null;
  if (!w) return ne && se ? 'l' : null;
  if (!e) return nw && sw ? 'r' : null;
  const miss = [!nw, !ne, !sw, !se].filter(Boolean).length;
  if (miss > 1) return null;
  return !nw ? 'inw' : !ne ? 'ine' : !sw ? 'isw' : !se ? 'ise' : 'c';
}

export class Terrain {
  constructor(w = MAP_W, h = MAP_H) {
    this.w = w; this.h = h;
    this.t = new Uint8Array(w * h);
    this.lakes = [];          // each lake: list of circles [cx, cy, r] in tiles
    this.plateaus = [];       // { cells: [[x, y, piece]], high: [[x, y]], stairs: [[x, y, dir]], cx, cy }
    this.islands = [];        // little rocky islands drawn inside big lakes (just for looks)
    this.clear = new Set();   // tiles that must stay open (stairs and their approach)
  }

  get(x, y) { return (x < 0 || y < 0 || x >= this.w || y >= this.h) ? T.CLIFF : this.t[y * this.w + x]; }
  set(x, y, v) { if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.t[y * this.w + x] = v; }
  walkable(x, y) { const v = this.get(x, y); return v === T.GRASS || v === T.HIGH || v === T.STAIRS; }
  isHigh(x, y) { return this.get(x, y) === T.HIGH; }
  isWater(x, y) { return this.get(x, y) === T.WATER; }
  lakeDepth(px, py) { return lakeDepthAt(this.lakes, px, py); }

  key(x, y) { return y * this.w + x; }
  // can a building, wall or resource go here? (never on stairs or blocking the way up)
  buildable(x, y) {
    const v = this.get(x, y);
    return (v === T.GRASS || v === T.HIGH) && !this.clear.has(this.key(x, y));
  }

  // take over a layout made by MapBuilder
  loadPlan(plan) {
    this.t.set(plan.ter);
    this.lakes = plan.lakes;
    this.plateaus = plan.plateaus;
    this.islands = plan.islands || [];
    this.clear = new Set(plan.clear);
  }

  // ---------------- drawing ----------------
  draw(scene, theme) {
    this.theme = theme;
    this.drawWater(scene, SHORES[theme.shore] || SHORES.sand);
    const mark = scene.children.list.length;
    this.drawIslands(scene);
    this.drawPlateaus(scene, theme.cliff, CLIFF_SETS[theme.cliffSet] || CLIFF_SETS.stone);
    this.bake(scene, scene.children.list.slice(mark));
  }

  // Performance: hundreds of cliff, stair and island pieces never change, so they are
  // painted once into a single texture (one draw call) and the pieces are thrown away.
  // MapGen adds the decoration (wheat, tumbleweeds) to the same texture.
  bake(scene, objects) {
    if (!objects.length) return;
    if (!this.rt) this.rt = scene.add.renderTexture(0, 0, this.w * TILE, this.h * TILE).setOrigin(0).setDepth(-8);
    const list = objects.slice().sort((a, b) => a.depth - b.depth);
    this.rt.draw(list);
    for (const o of objects) o.destroy();
  }

  // Android may drop the GPU's memory when the app goes to the background; a render
  // texture comes back empty (no cliffs, no wheat), an image comes back by itself.
  // So once the map is finished, the baked layer is copied into a plain image.
  freeze(scene) {
    const rt = this.rt;
    if (!rt || this.frozen) return;
    this.frozen = true;
    rt.snapshot((img) => {
      if (!rt.scene || !img) return;             // the battle was left meanwhile
      const key = 'terrainBake';
      if (scene.textures.exists(key)) scene.textures.remove(key);
      scene.textures.addImage(key, img);
      this.rt = scene.add.image(0, 0, key).setOrigin(0).setDepth(rt.depth);
      rt.destroy();
    });
  }

  // lakes painted pixel by pixel: shore, shallow water, deep water
  drawWater(scene, SHORE) {
    if (!this.lakes.length) return;
    const W = this.w * TILE, H = this.h * TILE;
    const key = 'waterLayer';
    if (scene.textures.exists(key)) scene.textures.remove(key);
    const tex = scene.textures.createCanvas(key, W, H);
    const ctx = tex.getContext();
    const img = ctx.createImageData(W, H);
    const data = img.data;
    // only scan around each lake
    for (const lake of this.lakes) {
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (const [cx, cy, r] of lake) { x0 = Math.min(x0, cx - r - 1); y0 = Math.min(y0, cy - r - 1); x1 = Math.max(x1, cx + r + 2); y1 = Math.max(y1, cy + r + 2); }
      for (let py = Math.max(0, y0 * TILE | 0); py < Math.min(H, y1 * TILE); py++) {
        for (let px = Math.max(0, x0 * TILE | 0); px < Math.min(W, x1 * TILE); px++) {
          const d = this.lakeDepth(px + 0.5, py + 0.5);
          if (d < -3) continue;
          const c = d <= 0 ? SHORE[0] : d <= 3 ? SHORE[1] : d <= 6 ? SHORE[2] : d <= 13 ? SHORE[3] : SHORE[4];
          const i = (py * W + px) * 4;
          data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = 255;
        }
      }
    }
    ctx.putImageData(img, 0, 0);
    tex.refresh();
    scene.add.image(0, 0, key).setOrigin(0).setDepth(-9);
  }

  // 3x3 rocky islands from Cliff-Water.png (frames 0-2, 5-7, 10-12)
  drawIslands(scene) {
    for (const [x, y] of this.islands) for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++)
      scene.add.image((x + dx + 0.5) * TILE, (y + dy + 0.5) * TILE, 'cliffwater', dy * 5 + dx).setDepth(-8.8);
  }

  // plateaus: every tile gets the cliff piece that fits its neighbours, stairs on top
  drawPlateaus(scene, sheet, set) {
    for (const p of this.plateaus) {
      // soft shadow on the ground under each piece of cliff face
      const sh = scene.add.graphics().setDepth(-8.6).fillStyle(0x203a14, 0.2);
      for (const [x, y, piece] of p.cells)
        if (piece === 'b' || piece === 'bl' || piece === 'br') sh.fillRect(x * TILE + (piece === 'bl' ? 3 : 0), (y + 1) * TILE - 3, TILE - (piece === 'b' ? 0 : 3), 5);
      for (const [x, y, piece] of p.cells) {
        const px = (x + 0.5) * TILE, py = (y + 0.5) * TILE;
        scene.add.image(px, py, sheet, set[piece]).setDepth(-8);
      }
      for (const [x, y, dir] of p.stairs) {
        // wide stairs: drop the inner posts so the steps join into one flight
        const l = this.get(x - 1, y) === T.STAIRS, r = this.get(x + 1, y) === T.STAIRS;
        const img = scene.add.image((x + 0.5) * TILE + (r && !l ? 1 : l && !r ? -1 : 0), (y + 0.5) * TILE + (dir > 0 ? 2 : 3), sheet, set.steps).setDepth(-7.8);
        const c0 = l ? 1 : 0, c1 = r ? 15 : 16;
        if (l || r) img.setCrop(c0, 0, c1 - c0, 16);
      }
    }
  }
}
