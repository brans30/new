import { TILE, MAP_W, MAP_H, KINGDOMS } from '../data/config.js';
import { quality } from './Quality.js';

// purely decorative particles: halved on medium quality, gone on low
const DECO = new Set(['chimney', 'dark', 'dust', 'foot', 'trailF', 'trailS', 'ember', 'splash']);

// =====================================================================
//  Visual effects + render performance. None of this changes the rules.
//
//  PERFORMANCE
//   - every small effect (sparks, dust, smoke, trails, rain splashes,
//     embers, fireworks) is a particle from a FEW shared emitters:
//     one draw call each, no new objects or tweens per spark
//   - culling: trees, rocks, buildings, units, tombs outside the camera
//     are not drawn (checked 5 times a second)
//   - lights and dust are only made for what's on screen
//
//  LOOK
//   explosions (pack sprite + glow + fire + smoke + scorch mark), tombstones,
//   treasure chest, rally sign, hit sparks, dust & snow footprints,
//   falling bodies, move/attack markers, projectile trails, hero aura,
//   weather (snow, rain with splashes and lightning, sand, leaves, mist),
//   cloud shadows, day & night with warm layered building lights,
//   lights switching on one by one at dusk, rising embers, upgrade glow, fireworks
// =====================================================================
const DAY = 360000;            // one full day in game time (6 minutes)

// night lights per building: [warm pool colour, core colour, size, y offset, embers]
const LIGHT = {
  keep:       [0xffa040, 0xffe2a0, 1.9, 6, true],
  house:      [0xffb860, 0xfff0b0, 1.0, 5, false],
  barracks:   [0xffa050, 0xffd890, 1.1, 5, true],
  tavern:     [0xff9a3a, 0xffd080, 1.2, 5, false],
  blacksmith: [0xff6a2a, 0xffb070, 1.2, 4, true],
  workshop:   [0xff7a30, 0xffc080, 1.1, 4, true],
  chapel:     [0x8fa8ff, 0xd8e2ff, 1.1, 4, false],
  market:     [0xffc070, 0xfff0c0, 1.0, 5, false],
  storehouse: [0xffb060, 0xffe0a0, 0.8, 5, false],
  mill:       [0xffb060, 0xffe0a0, 0.7, 5, false],
  tower:      [0xffb050, 0xffe8b0, 0.9, -6, true],
  well:       [0x80c8ff, 0xd0f0ff, 0.6, 2, false],
};

export class Effects {
  constructor(scene) {
    this.s = scene;
    this.makeTextures();
    this.makeAnims();
    this.makeEmitters();
    this.lights = new Map();       // building -> { pool, core }
    this.auras = new Map();        // hero -> image
    this.tombs = [];
    this.trailT = 0; this.cullT = 0; this.emberT = 0;
    this.weather = { kind: 'clear', until: 0, next: 60000 + Math.random() * 60000 };
    this.setupWeather();
    this.setupClouds();
    // full-screen layers that follow the camera
    // the night is a low-resolution "light map": darkness everywhere, with soft holes
    // cut out around every lit building, so the ground, the walls and the soldiers and
    // workers standing near a house are really lit (1 texel = 4 world pixels: light is soft anyway)
    this.Q = 4;
    this.lightmap = scene.add.renderTexture(0, 0, 32, 32).setOrigin(0).setDepth(99400).setBlendMode(Phaser.BlendModes.MULTIPLY).setScale(this.Q).setVisible(false);
    this.eraser = scene.make.image({ key: 'fx_glow', add: false });
    // light should be smooth, not pixel-art blocky
    this.lightmap.texture.setFilter(Phaser.Textures.FilterMode.LINEAR);
    for (const k of ['fx_glow', 'fx_soft', 'fx_cloud', 'fx_mist', 'fx_vignette', 'fx_scorch']) scene.textures.get(k).setFilter(Phaser.Textures.FilterMode.LINEAR);
    this.vignette = scene.add.image(0, 0, 'fx_vignette').setOrigin(0).setDepth(99401).setBlendMode(Phaser.BlendModes.MULTIPLY).setAlpha(0);
    this.dim = scene.add.rectangle(0, 0, 10, 10, 0x1a2333, 0).setOrigin(0).setDepth(99402);           // storm darkness
    this.flash = scene.add.rectangle(0, 0, 10, 10, 0xdfe8ff, 0).setOrigin(0).setDepth(99700);         // lightning
    this.nightTint = scene.add.rectangle(0, 0, 10, 10, 0x18245a, 0).setOrigin(0).setDepth(99399);    // night on medium / low quality
    this.mist = [];
    this.clock = DAY * 0.3;        // start in the morning
    // graphics quality (settings, or lowered automatically on a slow phone)
    const off = quality.onChange(() => this.applyQuality());
    scene.events.once('shutdown', off);
    this.applyQuality();
  }

  applyQuality() {
    this.q = quality.n;
    for (const c of this.clouds) c.setVisible(this.q === 2);
    if (this.q < 2) {
      for (const L of this.lights.values()) { L.pool.destroy(); L.core.destroy(); }
      this.lights.clear(); this.lightmap.setVisible(false);
      this.mist.forEach(m => m.destroy()); this.mist = [];
    }
    if (this.weather.kind === 'clear') this.startBase(); else this.startStorm();
  }

  // a weather emitter's rate, thinned out on medium quality
  rate(e, freq, qty) { e.setFrequency(this.q === 1 ? freq * 2 : freq, qty); e.start(); }

  // ---------- small generated textures ----------
  makeTextures() {
    const s = this.s;
    const make = (key, w, h, draw) => {
      if (s.textures.exists(key)) return;
      const g = s.make.graphics({ x: 0, y: 0, add: false });
      draw(g); g.generateTexture(key, w, h); g.destroy();
    };
    make('fx_px', 2, 2, g => g.fillStyle(0xffffff).fillRect(0, 0, 2, 2));
    make('fx_flake', 3, 3, g => { g.fillStyle(0x9fb3c2).fillRect(0, 0, 3, 3); g.fillStyle(0xffffff).fillRect(1, 0, 1, 3).fillRect(0, 1, 3, 1); });
    make('fx_rain', 1, 7, g => g.fillStyle(0xcfe6ff).fillRect(0, 0, 1, 7));
    make('fx_leaf', 3, 2, g => g.fillStyle(0xffffff).fillRect(0, 0, 3, 2));
    make('fx_sand', 10, 2, g => { g.fillStyle(0xffffff, 0.6).fillRect(0, 0, 10, 2); g.fillStyle(0xffffff).fillRect(2, 0, 6, 1); });
    make('fx_ring', 12, 6, g => g.lineStyle(1, 0xffffff, 1).strokeEllipse(6, 3, 11, 5));
    const blob = (key, size, stops) => {
      if (s.textures.exists(key)) return;
      const t = s.textures.createCanvas(key, size, size), c = t.getContext();
      const gr = c.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      stops.forEach(([o, col]) => gr.addColorStop(o, col));
      c.fillStyle = gr; c.fillRect(0, 0, size, size); t.refresh();
    };
    blob('fx_soft', 16, [[0, 'rgba(255,255,255,1)'], [0.5, 'rgba(255,255,255,.6)'], [1, 'rgba(255,255,255,0)']]);
    blob('fx_glow', 64, [[0, 'rgba(255,255,255,1)'], [0.25, 'rgba(255,255,255,.55)'], [0.6, 'rgba(255,255,255,.18)'], [1, 'rgba(255,255,255,0)']]);
    blob('fx_cloud', 128, [[0, 'rgba(0,0,0,1)'], [0.55, 'rgba(0,0,0,.75)'], [1, 'rgba(0,0,0,0)']]);
    blob('fx_mist', 128, [[0, 'rgba(255,255,255,1)'], [0.6, 'rgba(255,255,255,.5)'], [1, 'rgba(255,255,255,0)']]);
    blob('fx_scorch', 32, [[0, 'rgba(30,20,10,.85)'], [0.6, 'rgba(40,28,14,.45)'], [1, 'rgba(40,28,14,0)']]);
    // dark edges at night (white centre = untouched under MULTIPLY)
    if (!s.textures.exists('fx_vignette')) {
      const t = s.textures.createCanvas('fx_vignette', 256, 256), c = t.getContext();
      const gr = c.createRadialGradient(128, 128, 60, 128, 128, 182);
      gr.addColorStop(0, 'rgb(255,255,255)'); gr.addColorStop(1, 'rgb(60,70,110)');
      c.fillStyle = gr; c.fillRect(0, 0, 256, 256); t.refresh();
    }
  }

  makeAnims() {
    const a = this.s.anims;
    if (!a.exists('fx_explode')) a.create({ key: 'fx_explode', frames: a.generateFrameNumbers('explosion', { start: 0, end: 5 }), frameRate: 14, repeat: 0 });
  }

  // one emitter per kind of little thing; particles are cheap, objects + tweens are not
  makeEmitters() {
    const s = this.s;
    const em = (tex, depth, cfg) => s.add.particles(0, 0, tex, { emitting: false, ...cfg }).setDepth(depth);
    this.p = {
      spark:   em('fx_px', 99988, { lifespan: { min: 220, max: 420 }, speed: { min: 30, max: 90 }, gravityY: 160, scale: { start: 0.7, end: 0.1 }, tint: [0xffe7a0, 0xffc24a, 0xffffff], blendMode: 'ADD' }),
      chip:    em('fx_px', 99987, { lifespan: { min: 300, max: 500 }, speed: { min: 20, max: 60 }, gravityY: 220, scale: { start: 0.8, end: 0.3 }, tint: [0xbfb8a8, 0x8f887a, 0xa8794f] }),
      fire:    em('fx_soft', 99986, { lifespan: { min: 300, max: 600 }, speed: { min: 10, max: 55 }, scale: { start: 0.9, end: 0.1 }, alpha: { start: 0.9, end: 0 }, tint: [0xffd060, 0xff8a2a, 0xff5a1a], blendMode: 'ADD' }),
      chimney: em('fx_soft', 99970, { lifespan: { min: 1400, max: 2000 }, speedY: { min: -10, max: -6 }, speedX: { min: 1, max: 5 }, scale: { start: 0.25, end: 0.9 }, alpha: { start: 0.45, end: 0 }, tint: 0xd6d0c4 }),
      dark:    em('fx_soft', 99971, { lifespan: { min: 1400, max: 2200 }, speedY: { min: -14, max: -8 }, speedX: { min: -2, max: 5 }, scale: { start: 0.35, end: 1.4 }, alpha: { start: 0.7, end: 0 }, tint: 0x3b3833 }),
      dust:    em('fx_soft', -6, { lifespan: { min: 380, max: 620 }, speedY: { min: -8, max: -3 }, speedX: { min: -6, max: 6 }, scale: { start: 0.3, end: 0.8 }, alpha: { start: 0.55, end: 0 }, tint: 0xe2d2a6 }),
      foot:    em('fx_px', -6, { lifespan: 4500, speed: 0, scale: 0.55, alpha: { start: 0.65, end: 0 }, tint: 0x9fb6c4 }),
      trailF:  em('fx_soft', 99989, { lifespan: 380, speed: { min: 2, max: 8 }, scale: { start: 0.4, end: 0.05 }, alpha: { start: 0.8, end: 0 }, tint: [0xffa040, 0x7a7068] }),
      trailS:  em('fx_px', 99989, { lifespan: 160, speed: 0, scale: 0.45, alpha: { start: 0.55, end: 0 }, tint: 0xffffff }),
      ember:   em('fx_px', 99460, { lifespan: { min: 900, max: 1600 }, speedY: { min: -26, max: -12 }, speedX: { min: -5, max: 5 }, scale: { start: 0.6, end: 0.1 }, alpha: { start: 1, end: 0 }, tint: [0xffd060, 0xff8a2a], blendMode: 'ADD' }),
      splash:  em('fx_ring', -5, { lifespan: 320, speed: 0, scale: { start: 0.3, end: 1 }, alpha: { start: 0.55, end: 0 }, tint: 0xd8ecff }),
      sparkle: em('fx_px', -8.7, { lifespan: 600, speed: 0, scaleX: { start: 0.6, end: 2 }, scaleY: 0.5, alpha: { start: 1, end: 0 }, tint: 0xffffff, blendMode: 'ADD' }),
      heal:    em('fx_px', 99989, { lifespan: 700, speedY: { min: -22, max: -12 }, speedX: { min: -4, max: 4 }, scale: { start: 0.9, end: 0.3 }, alpha: { start: 1, end: 0 }, tint: 0x7dff8a, blendMode: 'ADD' }),
      firework: em('fx_px', 99990, { lifespan: { min: 800, max: 1100 }, speed: { min: 40, max: 90 }, gravityY: 40, scale: { start: 1.3, end: 0.2 }, alpha: { start: 1, end: 0 }, blendMode: 'ADD' }),
    };
  }

  emit(name, x, y, n = 1) {
    if (DECO.has(name) && (this.q === 0 || (this.q === 1 && Math.random() < 0.5))) return;
    if (this.onScreen(x, y, 30)) this.p[name].emitParticleAt(x, y, n);
  }

  onScreen(x, y, m = 40) {
    const v = this.s.cameras.main.worldView;
    return x > v.x - m && x < v.right + m && y > v.y - m && y < v.bottom + m;
  }

  // ---------- explosions ----------
  explode(x, y, scale = 1, shake = 0) {
    const s = this.s;
    if (shake && this.onScreen(x, y)) s.cameras.main.shake(140 + shake * 60, 0.003 * shake);
    s.sfx?.at(scale >= 1.2 ? 'boom_l' : 'boom_s', x, y);
    if (!this.onScreen(x, y, 60)) return;
    // budget: never more than 6 big explosions alive at once (a whole town can fall together)
    if ((this.booms || 0) >= 6) { this.p.fire.emitParticleAt(x, y, 4); this.p.dark.emitParticleAt(x, y, 1); return; }
    this.booms = (this.booms || 0) + 1;
    const e = s.add.sprite(x, y, 'explosion', 0).setDepth(99985).setScale(scale);
    e.once('destroy', () => { this.booms--; });
    e.play('fx_explode');
    e.once('animationcomplete', () => e.destroy());
    const glow = s.add.image(x, y, 'fx_glow').setTint(0xffa040).setBlendMode(Phaser.BlendModes.ADD).setDepth(99984).setScale(0.25 * scale).setAlpha(0.9);
    s.tweens.add({ targets: glow, scale: 0.7 * scale, alpha: 0, duration: 420, onComplete: () => glow.destroy() });
    this.p.fire.emitParticleAt(x, y, Math.round(6 + 4 * scale));
    this.p.spark.emitParticleAt(x, y, Math.round(5 + 4 * scale));
    this.p.dark.emitParticleAt(x, y - 2, Math.round(2 + scale * 2));
    // a scorch mark that fades away
    const sc = s.add.image(x, y + 3, 'fx_scorch').setDepth(-7).setScale(0.35 * scale, 0.22 * scale);
    s.tweens.add({ targets: sc, alpha: 0, delay: 12000, duration: 4000, onComplete: () => sc.destroy() });
  }

  buildingFalls(b) {
    if (!this.onScreen(b.x, b.y, 120)) return;
    const n = b.def.wall ? 1 : b.size === 1 ? 1 : 3;
    for (let i = 0; i < n; i++) {
      this.s.time.delayedCall(i * 110, () => this.explode(b.x + Phaser.Math.Between(-6, 6) * b.size, b.y + Phaser.Math.Between(-6, 6) * b.size,
        b.def.wall ? 0.8 : 1 + b.size * 0.25, i === 0 ? (b.kind === 'keep' ? 3 : 1) : 0));
    }
  }

  // ---------- tombstones ----------
  tomb(x, y) {
    if (Math.random() < 0.35) return;
    const t = this.s.add.image(x, y + 2, 'tombstones', Phaser.Math.Between(0, 7)).setDepth(y - 6).setAlpha(0);
    this.s.tweens.add({ targets: t, alpha: 0.95, duration: 400, delay: 700 });
    this.s.tweens.add({ targets: t, alpha: 0, delay: 40000, duration: 4000, onComplete: () => { t.destroy(); this.tombs = this.tombs.filter(o => o !== t); } });
    this.tombs.push(t);
  }

  // ---------- treasure chest ----------
  chest(x, y, gold = true) {
    if (!this.onScreen(x, y)) return;
    const c = this.s.add.image(x, y - 4, 'chests', gold ? 1 : 0).setDepth(99990).setScale(0.4);
    this.s.tweens.add({ targets: c, y: y - 18, scale: 1, duration: 380, ease: 'Back.easeOut' });
    this.s.tweens.add({ targets: c, alpha: 0, y: y - 24, delay: 1100, duration: 500, onComplete: () => c.destroy() });
    this.s.time.delayedCall(350, () => this.p.spark.emitParticleAt(x, y - 18, 10));
  }

  // ---------- rally sign ----------
  rally(b) {
    b.rallySign?.destroy();
    if (!b.rally) return;
    const s = this.s, { x, y } = b.rally;
    const sg = s.add.image(x, y - 4, 'signs', 1).setDepth(y - 2);
    const pole = s.add.rectangle(x, y - 12, 1, 8, 0x5e3b1c).setDepth(y - 1);
    const flag = s.add.rectangle(x + 3, y - 13, 6, 4, KINGDOMS[b.team]?.hex || 0xffffff).setDepth(y - 1);
    const wave = s.tweens.add({ targets: flag, scaleX: 0.7, duration: 500, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    b.rallySign = { destroy: () => { wave.remove(); sg.destroy(); flag.destroy(); pole.destroy(); } };
    sg.setScale(0.3); s.tweens.add({ targets: sg, scale: 1, duration: 250, ease: 'Back.easeOut' });
  }

  // ---------- hits ----------
  hit(target, from, isBuilding) {
    if (isBuilding) this.emit('chip', target.x + Phaser.Math.Between(-4, 4), target.y + Phaser.Math.Between(-4, 2), 3);
    else this.emit('spark', target.x, target.y - 3, from?.def?.ranged ? 2 : 3);
  }

  // ---------- chimney / damage smoke and water glints (used by Ambience) ----------
  smoke(x, y, dark) { this.emit(dark ? 'dark' : 'chimney', x, y, 1); }
  glint(x, y) { this.emit('sparkle', x, y, 1); }

  // ---------- falling bodies ----------
  fall(u) {
    const s = this.s;
    u.anims?.stop();
    u.setFrame(0);                                    // not frozen mid-swing (attack frames have white slashes)
    u.clearTint(); u.setTint(0xb0a090);               // (the white hit flash may still be on)
    if (u.def.damage) this.tomb(u.x, u.y);
    if (!this.onScreen(u.x, u.y, 20)) { u.destroy(); return; }
    const side = u.dir === 'left' ? -1 : 1;
    s.tweens.add({ targets: u, angle: 90 * side, y: u.y + 3, duration: 260, ease: 'Quad.easeIn' });
    s.tweens.add({ targets: u, alpha: 0, delay: 900, duration: 700, onComplete: () => u.destroy() });
    this.p.dust.emitParticleAt(u.x, u.y + 5, 3);
  }

  // ---------- move / attack markers ----------
  marker(x, y, attack = false) {
    const s = this.s, col = attack ? 0xff4a3a : 0xffffff;
    const ring = s.add.ellipse(x, y, 18, 9).setStrokeStyle(1.5, col, 1).setDepth(99997);
    s.tweens.add({ targets: ring, scale: 0.3, alpha: 0, duration: 650, onComplete: () => ring.destroy() });
    const arrow = s.add.triangle(x, y - 12, 0, 0, 6, 0, 3, 5, col).setDepth(99997);
    s.tweens.add({ targets: arrow, y: y - 6, duration: 220, yoyo: true, repeat: 1, onComplete: () => s.tweens.add({ targets: arrow, alpha: 0, duration: 200, onComplete: () => arrow.destroy() }) });
  }

  // ---------- projectile trails ----------
  trail(sp, kind) {
    if (!this.onScreen(sp.x, sp.y, 0)) return;
    this.emit(kind === 'fireball' ? 'trailF' : 'trailS', sp.x, sp.y, 1);
  }

  // ---------- upgrade glow ----------
  upgradeGlow(team) {
    for (const u of this.s.units) {
      if (!u.alive || u.team !== team || !u.def.damage || !this.onScreen(u.x, u.y)) continue;
      u.setTint(0xfff1a0);
      this.s.time.delayedCall(450, () => u.alive && u.clearTint());
      this.p.spark.emitParticleAt(u.x, u.y - 4, 3);
    }
  }

  // ---------- fireworks ----------
  fireworks(colors) {
    const s = this.s, v = s.cameras.main.worldView, z = s.cameras.main.zoom;
    for (let i = 0; i < 14; i++) {
      s.time.delayedCall(i * 230, () => {
        const x = v.x + v.width * (0.15 + Math.random() * 0.7), y = v.y + v.height * (0.15 + Math.random() * 0.45);
        const col = Phaser.Display.Color.HexStringToColor(colors[i % colors.length]).color;
        const r = s.add.image(x, v.bottom, 'fx_px').setDepth(99990).setScale(2 / z + 0.4);
        s.tweens.add({ targets: r, y, duration: 420, ease: 'Quad.easeOut', onComplete: () => {
          r.destroy();
          this.p.firework.particleTint = col;
          this.p.firework.emitParticleAt(x, y, 30);
          const g = s.add.image(x, y, 'fx_glow').setTint(col).setBlendMode(Phaser.BlendModes.ADD).setDepth(99989).setScale(1.2 / z).setAlpha(0.7);
          s.tweens.add({ targets: g, alpha: 0, duration: 600, onComplete: () => g.destroy() });
        } });
      });
    }
  }

  // ---------- weather ----------
  setupWeather() {
    const s = this.s;
    this.zoneTop = new Phaser.Geom.Rectangle(0, 0, 10, 10);
    this.zoneView = new Phaser.Geom.Rectangle(0, 0, 10, 10);
    const em = (tex, cfg, zone) => s.add.particles(0, 0, tex, { emitZone: { type: 'random', source: zone }, emitting: false, ...cfg }).setDepth(99500);
    this.wx = {
      snow: em('fx_flake', { lifespan: 5000, speedY: { min: 14, max: 26 }, speedX: { min: -8, max: 4 }, scale: { min: 0.4, max: 0.9 }, alpha: { start: 0.95, end: 0.6 }, frequency: 40, quantity: 2 }, this.zoneTop),
      rain: em('fx_rain', { lifespan: 650, speedY: { min: 230, max: 280 }, speedX: { min: -40, max: -30 }, rotate: 8, alpha: 0.5, frequency: 14, quantity: 3 }, this.zoneTop),
      leaves: em('fx_leaf', { lifespan: 6000, speedX: { min: -22, max: -10 }, speedY: { min: 4, max: 10 }, rotate: { min: 0, max: 360 }, tint: [0x9ccf4a, 0xd9a43a, 0xc8743a, 0x7fb04a], alpha: { start: 0, end: 0.9, ease: (t) => Math.sin(t * Math.PI) }, frequency: 500, quantity: 1 }, this.zoneView),
      sand: em('fx_sand', { lifespan: 1600, speedX: { min: -160, max: -110 }, speedY: { min: -6, max: 8 }, tint: [0xf0dca6, 0xe2c88c, 0xfff0c8], alpha: { start: 0.9, end: 0 }, scaleX: { min: 1, max: 2.5 }, frequency: 15, quantity: 3 }, this.zoneView),
    };
    this.base = { winter: 'snow', waste: 'sand' }[s.plan.mapId] || 'leaves';
    this.wet = s.plan.mapId !== 'waste';
    this.startBase();
  }

  startBase() {
    for (const e of Object.values(this.wx)) e.stop();
    if (this.q === 0) return;                      // low quality: no weather particles
    if (this.base === 'snow') this.rate(this.wx.snow, 70, 1);
    if (this.base === 'leaves') this.rate(this.wx.leaves, 500, 1);
    if (this.base === 'sand') this.rate(this.wx.sand, 160, 1);
  }

  startStorm() {
    for (const e of Object.values(this.wx)) e.stop();
    if (this.q === 0) return;
    const w = this.weather.kind;
    if (w === 'rain') this.rate(this.wx.rain, 14, 3);
    if (w === 'blizzard') this.rate(this.wx.snow, 15, 3);
    if (w === 'sandstorm') this.rate(this.wx.sand, 10, 4);
  }

  updateWeather(dt) {
    const w = this.weather, now = this.s.simTime;
    if (w.kind === 'clear' && now > w.next) {
      w.kind = this.base === 'snow' ? 'blizzard' : this.wet ? 'rain' : 'sandstorm';
      w.until = now + 50000 + Math.random() * 40000;
      this.startStorm();
    } else if (w.kind !== 'clear' && now > w.until) {
      w.kind = 'clear'; w.next = now + 120000 + Math.random() * 120000;
      this.startBase();
    }
    const target = w.kind === 'rain' ? 0.26 : w.kind === 'blizzard' ? 0.12 : w.kind === 'sandstorm' ? 0.1 : 0;
    this.dim.fillAlpha += (target - this.dim.fillAlpha) * Math.min(1, dt / 1500);
    this.dim.fillColor = w.kind === 'sandstorm' ? 0x6b5530 : w.kind === 'blizzard' ? 0xc8d8e0 : 0x1a2333;
    if (w.kind === 'rain') {
      // drops hitting the ground: little rings
      const v = this.s.cameras.main.worldView;
      for (let k = Math.floor(dt / 45 + Math.random()); k > 0; k--) this.emit('splash', v.x + Math.random() * v.width, v.y + Math.random() * v.height, 1);
      // lightning
      if (Math.random() < dt / 9000) {
        this.flash.fillAlpha = 0.5;
        this.s.time.delayedCall(250 + Math.random() * 900, () => this.s.sfx?.ui('thunder', 0.6 + Math.random() * 0.4));
        this.s.tweens.add({ targets: this.flash, fillAlpha: 0, duration: 260, ease: 'Quad.easeOut' });
        this.s.time.delayedCall(140, () => { this.flash.fillAlpha = 0.32; this.s.tweens.add({ targets: this.flash, fillAlpha: 0, duration: 420 }); });
      }
    }
  }

  // ---------- cloud shadows ----------
  setupClouds() {
    const s = this.s, W = MAP_W * TILE, H = MAP_H * TILE;
    this.clouds = [];
    for (let i = 0; i < 5; i++) {
      const c = s.add.image(Math.random() * W, Math.random() * H, 'fx_cloud').setDepth(99300).setAlpha(0.09)
        .setScale(1.8 + Math.random() * 1.6, 1.1 + Math.random() * 0.8);
      c.speed = 4 + Math.random() * 4;
      this.clouds.push(c);
    }
  }

  // ---------- day and night ----------
  nightLevel() {
    const p = (this.clock % DAY) / DAY;
    const ramp = (a, b, x) => Math.min(1, Math.max(0, (x - a) / (b - a)));
    return ramp(0.6, 0.72, p) * (1 - ramp(0.9, 0.99, p));
  }

  // two layers per lit building: a wide warm pool on the ground and a bright core at the door.
  // Lights come on one by one at dusk (each building has its own moment) and flicker gently.
  updateNight(dt) {
    const s = this.s, n = this.nightLevel();
    this.vignette.setAlpha(n * 0.9);
    const lm = this.lightmap, v = s.cameras.main.worldView, Q = this.Q;
    // medium / low quality: one plain dark layer instead of the light map and building lights
    this.nightTint.setPosition(v.x - 20, v.y - 20).setSize(v.width + 40, v.height + 40).setAlpha(this.q < 2 ? n * 0.42 : 0);
    if (this.q < 2) { lm.setVisible(false); return; }
    lm.setVisible(n > 0.02);
    const holes = [];
    for (const [b, L] of this.lights) if (!b.alive) { L.pool.destroy(); L.core.destroy(); this.lights.delete(b); }
    if (n <= 0.02) {
      if (this.lights.size) { for (const L of this.lights.values()) { L.pool.destroy(); L.core.destroy(); } this.lights.clear(); }
    } else {
      const t = s.simTime / 1000;
      for (const b of s.buildings) {
        const spec = LIGHT[b.kind];
        if (!spec || !b.complete || !b.alive) continue;
        let L = this.lights.get(b);
        if (!L) {
          const [pc, cc, size] = spec;
          L = {
            pool: s.add.image(b.x, b.y, 'fx_glow').setTint(pc).setBlendMode(Phaser.BlendModes.ADD).setDepth(99450).setScale(1.3 * size, 0.95 * size).setAlpha(0),
            core: s.add.image(b.x, b.y, 'fx_glow').setTint(cc).setBlendMode(Phaser.BlendModes.ADD).setDepth(99451).setScale(0.22 * size).setAlpha(0),
            on: Math.random(), seed: Math.random() * 10, spec,
          };
          this.lights.set(b, L);
        }
        const vis = b.visible;
        L.pool.setVisible(vis); L.core.setVisible(vis);
        if (!vis) continue;
        const lit = Math.min(1, Math.max(0, (n - L.on * 0.45) * 3));     // each light switches on at its own moment
        const flick = 0.86 + 0.14 * Math.sin(t * 6.3 + L.seed) * Math.sin(t * 2.7 + L.seed * 1.7);
        const y = b.y + spec[3];
        L.pool.setPosition(b.x, y + 4).setAlpha(lit * 0.14 * flick);
        L.core.setPosition(b.x, y).setAlpha(lit * 0.75 * flick);
        // the hole in the darkness: radius ~3 tiles for a house, ~5 for the keep
        if (lit > 0) holes.push([b.x, y + 4, 46 * spec[2], lit * (0.9 + 0.1 * flick)]);
      }
      // draw the light map: dark fill, then erase soft circles where the lights are
      const W = Math.ceil((v.width + 40) / Q), H = Math.ceil((v.height + 40) / Q);
      if (lm.width !== W || lm.height !== H) { lm.resize(W, H); lm.texture.setFilter(Phaser.Textures.FilterMode.LINEAR); }   // resizing makes a new texture
      lm.setAlpha(n * 0.78);
      // performance: the light map is redrawn every other frame (or when the camera moved),
      // and all its soft holes are erased in ONE batch instead of one draw call each
      const camKey = Math.round(v.x) + ',' + Math.round(v.y) + ',' + v.width;
      if ((this.lmFrame = (this.lmFrame || 0) + 1) % 2 === 0 || camKey !== this.lmCam) {
        this.lmCam = camKey;
        lm.setPosition(v.x - 20, v.y - 20);
        lm.clear().fill(0x18245a, 1);
        const pool = this.erasers || (this.erasers = []);
        let i = 0;
        const er = () => pool[i] || (pool[i] = this.s.make.image({ key: 'fx_glow', add: false }));
        for (const [x, y, R, a] of holes) {
          const px = (x - v.x + 20) / Q, py = (y - v.y + 20) / Q;
          er().setPosition(px, py).setScale((R * 2 / 64) / Q).setAlpha(a); i++;
          er().setPosition(px, py).setScale((R / 64) / Q).setAlpha(a); i++;     // a smaller pass: fully bright centre
        }
        if (i) lm.erase(pool.slice(0, i));
      }
      // embers rising from torches and forges
      if (n > 0.3 && (this.emberT += dt) > 260) {
        this.emberT = 0;
        for (const [b, L] of this.lights) if (L.spec[4] && L.pool.visible && Math.random() < 0.6) this.emit('ember', b.x + Phaser.Math.Between(-5, 5), b.y + L.spec[3] - 2, 1);
      }
    }
    // early-morning mist right after the night
    const p = (this.clock % DAY) / DAY;
    const mistOn = p > 0.93 || p < 0.06;
    if (mistOn && !this.mist.length) this.makeMist();
    for (const m of this.mist) m.setAlpha(Math.max(0, m.alpha + ((mistOn ? 0.2 : 0) - m.alpha) * Math.min(1, dt / 3000)));
    if (!mistOn && this.mist.length && this.mist.every(m => m.alpha < 0.01)) { this.mist.forEach(m => m.destroy()); this.mist = []; }
  }

  makeMist() {
    const W = MAP_W * TILE, H = MAP_H * TILE;
    for (let i = 0; i < 12; i++) {
      const m = this.s.add.image(Math.random() * W, Math.random() * H, 'fx_mist').setDepth(99350).setAlpha(0).setScale(2 + Math.random() * 2, 0.8 + Math.random() * 0.5);
      m.speed = 3 + Math.random() * 3;
      this.mist.push(m);
    }
  }

  // ---------- culling: don't draw what the camera can't see ----------
  cull() {
    const s = this.s, v = s.cameras.main.worldView, m = 48;
    const x0 = v.x - m, x1 = v.right + m, y0 = v.y - m, y1 = v.bottom + m;
    const inV = (o) => o.x > x0 && o.x < x1 && o.y > y0 && o.y < y1;
    for (const n of s.nodes) n.visible = inV(n);
    for (const st of s.stumps) if (st.active) st.visible = inV(st);
    for (const b of s.buildings) { const vis = inV(b); b.visible = vis; if (b.fire) b.fire.visible = vis; }
    for (const u of s.units) if (u.alive) u.visible = !u.hidden && inV(u);
    for (const t of this.tombs) t.visible = inV(t);
  }

  // ---------- every frame ----------
  update(dt) {
    const s = this.s, v = s.cameras.main.worldView;
    const sim = dt * (s.speed || 0);
    this.clock += sim;
    for (const r of [this.dim, this.flash]) r.setPosition(v.x - 20, v.y - 20).setSize(v.width + 40, v.height + 40);
    this.vignette.setPosition(v.x - 20, v.y - 20).setDisplaySize(v.width + 40, v.height + 40);
    this.zoneTop.setTo(v.x - 60, v.y - 40, v.width + 160, v.height * 0.25 + 40);
    this.zoneView.setTo(v.x, v.y, v.width + 60, v.height);
    if ((this.cullT += dt) > 200) { this.cullT = 0; this.cull(); }
    this.updateWeather(sim);
    this.updateNight(sim);
    const W = MAP_W * TILE;
    for (const c of this.clouds) { c.x -= c.speed * sim / 1000; if (c.x < -200) { c.x = W + 200; c.y = Math.random() * MAP_H * TILE; } }
    for (const m of this.mist) { m.x -= m.speed * sim / 1000; if (m.x < -200) m.x = W + 200; }

    // heroes: a soft pulsing light under their feet, in their kingdom's colour
    for (const [u, a] of this.auras) if (!u.alive) { a.destroy(); this.auras.delete(u); }
    for (const u of s.units) if (u.alive && u.def.hero && !this.auras.has(u))
      this.auras.set(u, s.add.image(u.x, u.y, 'fx_glow').setBlendMode(Phaser.BlendModes.ADD).setTint(KINGDOMS[u.team]?.hex || 0xffffff).setScale(0.45, 0.22));
    const pulse = 0.45 + 0.25 * Math.sin(s.simTime / 260);
    for (const [u, a] of this.auras) a.setPosition(u.x, u.y + 6).setDepth(u.y - 1).setAlpha(u.visible ? pulse : 0);

    // dust behind moving armies and riders, footprints in the snow (on screen only)
    if ((this.trailT += sim) > 150) {
      this.trailT = 0;
      const snow = s.plan.mapId === 'winter';
      for (const u of s.units) {
        if (!u.alive || !u.visible) continue;
        const moving = u.lastX !== undefined && Math.abs(u.x - u.lastX) + Math.abs(u.y - u.lastY) > 1.5;
        u.lastX = u.x; u.lastY = u.y;
        if (!moving) continue;
        if (snow) { if (Math.random() < 0.5) this.emit('foot', u.x + Phaser.Math.Between(-1, 1), u.y + 6, 1); }
        else if (u.def.mounted || Math.random() < 0.22) this.emit('dust', u.x + Phaser.Math.Between(-3, 3), u.y + 6, u.def.mounted ? 2 : 1);
      }
    }
  }
}
