import { MAP_W, MAP_H, TILE } from '../data/config.js';
import { Terrain, T } from './Terrain.js';
import { MATCH } from './Match.js';
import { buildMap } from './MapBuilder.js';

// Puts the chosen map into the game: ground, lakes, plateaus, keeps, resources,
// decoration and starting units. The layout comes from MapBuilder (the same plan
// the setup screen showed as its preview).
export function generateMap(scene) {
  const plan = scene.plan || buildMap(MATCH.map, MATCH.kingdoms.length, MATCH.seed);
  const theme = plan.theme;
  // random ground tiles from a seeded generator, so a restart looks the same
  const rnd = new Phaser.Math.RandomDataGenerator([`${plan.mapId}-${MATCH.seed}`]);

  // ---- ground tiles: patches of light and dark ground (smooth noise, like real
  //      meadows) instead of a random checkerboard, with a few tufts ----
  const G = 5, gw = Math.ceil(MAP_W / G) + 2, gh = Math.ceil(MAP_H / G) + 2;
  const grid = Array.from({ length: gw * gh }, () => rnd.frac());
  const smooth = (x, y) => {
    const X = Math.floor(x / G), Y = Math.floor(y / G), fx = x / G - X, fy = y / G - Y;
    const v = (i, j) => grid[(Y + j) * gw + X + i];
    const u = fx * fx * (3 - 2 * fx), w = fy * fy * (3 - 2 * fy);
    return (v(0, 0) * (1 - u) + v(1, 0) * u) * (1 - w) + (v(0, 1) * (1 - u) + v(1, 1) * u) * w;
  };
  const data = [];
  for (let y = 0; y < MAP_H; y++) {
    const row = [];
    for (let x = 0; x < MAP_W; x++) {
      const dark = smooth(x, y) + (rnd.frac() - 0.5) * 0.18 > 0.5;
      const tuft = rnd.frac() < 0.07;
      row.push(tuft ? (dark ? rnd.pick([4, 5]) : rnd.pick([1, 2])) : (dark ? 3 : 0));
    }
    data.push(row);
  }
  const map = scene.make.tilemap({ data, tileWidth: TILE, tileHeight: TILE });
  map.createLayer(0, map.addTilesetImage(theme.ground), 0, 0).setDepth(-10);
  scene.cameras.main.setBackgroundColor(theme.bg);

  // ---- terrain: lakes, islands, plateaus ----
  const terrain = new Terrain();
  terrain.loadPlan(plan);
  scene.terrain = terrain;
  scene.grid.terrain = terrain;
  terrain.draw(scene, theme);

  // ---- keeps: one per kingdom on its chosen spot ----
  for (const k of MATCH.kingdoms) {
    const sp = plan.spots[k.spot];
    scene.addBuilding(sp.x, sp.y, 'keep', k.color, true);
  }

  // ---- resources ----
  for (const [x, y, kind] of plan.nodes) if (terrain.buildable(x, y)) scene.addNode(x, y, kind);

  // ---- decoration (just for looks) ----
  const decor = [];
  for (const [x, y, sheet, frame] of plan.decor)
    if (scene.grid.isFree(x, y)) decor.push(scene.add.image((x + 0.5) * TILE, (y + 0.5) * TILE, sheet, frame).setDepth(-7).setAlpha(0.95));
  terrain.bake(scene, decor);
  terrain.freeze(scene);              // survives the GPU being reset (Android, app in the background)          // painted into the terrain texture: no objects left behind

  // ---- starting units: 3 workers each; computer kingdoms also get a small guard ----
  for (const k of MATCH.kingdoms) {
    const keep = scene.keepOf(k.color);
    const dir = keep.x < (MAP_W * TILE) / 2 ? 1 : -1;            // facing the middle of the map
    const vy = keep.y <= (MAP_H * TILE) / 2 ? 1 : -1;
    for (let i = 0; i < 3; i++) {
      const w = scene.spawnUnit('worker', k.color, keep.x + dir * (26 + i * 10), keep.y + 22 * vy);
      if (!k.ai) w.autoAssign();
    }
    if (k.ai) [['swordsman', 26, -12], ['swordsman', 26, 8], ['bowman', 8, -24 * vy]].forEach(([kind, dx, dy]) =>
      scene.spawnUnit(kind, k.color, keep.x + dir * dx, keep.y + dy));
  }
}
