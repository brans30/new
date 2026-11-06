// =====================================================================
//  Performance: one texture for every sprite sheet.
//
//  The game has ~180 small sprite sheets (each unit in each colour, buildings,
//  trees...). Sorted by depth they alternate all the time, and the GPU has to
//  stop and switch textures: ~100 draw calls a frame. All sheets together are
//  only ~1.6 megapixels, so at start-up they're copied into one (or a few)
//  2048x2048 atlas pages and every frame is pointed at its new place.
//  Nothing else changes: keys, frame numbers and animations stay the same.
// =====================================================================
const SIZE = 2048, PAD = 2;

export function packAtlas(scene) {
  const tm = scene.textures;
  const items = [];
  for (const [key, tex] of Object.entries(tm.list)) {
    if (key.startsWith('__') || tex.source.length !== 1) continue;
    const src = tex.source[0];
    if (!(src.image instanceof HTMLImageElement) || src.width > SIZE / 2 || src.height > SIZE / 2) continue;
    items.push({ key, tex, w: src.width, h: src.height });
  }
  if (!items.length) return 0;
  // shelf packing, tallest first
  items.sort((a, b) => b.h - a.h || b.w - a.w);
  const pages = [];
  let page = null, x = 0, y = 0, shelf = 0;
  const newPage = () => { page = { items: [] }; pages.push(page); x = PAD; y = PAD; shelf = 0; };
  newPage();
  for (const it of items) {
    if (x + it.w + PAD > SIZE) { x = PAD; y += shelf + PAD; shelf = 0; }
    if (y + it.h + PAD > SIZE) newPage();
    it.x = x; it.y = y; page.items.push(it);
    x += it.w + PAD; shelf = Math.max(shelf, it.h);
  }
  pages.forEach((pg, i) => {
    const used = Math.max(...pg.items.map(it => it.y + it.h)) + PAD;
    const h = 1 << Math.ceil(Math.log2(Math.max(64, used)));       // a smaller page when it's not full
    const canvas = document.createElement('canvas');
    canvas.width = SIZE; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    for (const it of pg.items) ctx.drawImage(it.tex.source[0].image, it.x, it.y);
    const atlas = tm.addCanvas('__atlas' + i, canvas);
    const asrc = atlas.source[0];
    for (const it of pg.items) {
      const old = it.tex.source[0];
      for (const f of Object.values(it.tex.frames)) {
        f.source = asrc; f.sourceIndex = 0;
        f.setSize(f.cutWidth, f.cutHeight, f.cutX + it.x, f.cutY + it.y);
      }
      it.tex.source[0] = asrc;
      old.destroy();
    }
  });
  return pages.length;
}
