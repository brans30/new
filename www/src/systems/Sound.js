// =====================================================================
//  Sound effects and ambience (all files made by tools/make_sfx.py).
//
//  sfx.at(name, x, y)  a sound in the world: only heard when it is on screen,
//                      panned left/right, a little quieter when zoomed far out.
//  sfx.ui(name)        an interface / news sound (always heard).
//
//  Performance on phones:
//    * every sound has a cap on how many copies play at once and a minimum
//      gap between two starts, plus a global cap (MAX_TOTAL);
//    * random variant + small pitch change, so 20 woodcutters don't sound robotic;
//    * the ambience is 5 loops that only change volume (never restarted).
// =====================================================================
const VARIANTS = { sword: 3, blunt: 3, thud: 3, die_h: 3, die_o: 3, chop: 3, pick: 3, hammer: 3,
  bow: 2, arrowhit: 2, gun: 2, ballista: 2, fireball: 2 };
const SINGLE = ['boom_s', 'boom_l', 'collapse', 'heal', 'done', 'coins', 'train', 'victory', 'defeat',
  'warhorn', 'alarm', 'thunder', 'click', 'nope', 'select', 'order', 'place', 'choose', 'swoosh', 'start', 'msg'];
const LOOPS = ['amb_day', 'amb_night', 'rain', 'wind', 'water'];

// every file to load (BootScene)
export const SFX_FILES = [
  ...Object.entries(VARIANTS).flatMap(([n, k]) => Array.from({ length: k }, (_, i) => `${n}_${i + 1}`)),
  ...SINGLE, ...LOOPS,
];

// name: [volume, copies at once, min ms between starts]
const CFG = {
  sword: [0.5, 4, 70], blunt: [0.5, 4, 70], thud: [0.45, 3, 100],
  die_h: [0.38, 3, 140], die_o: [0.42, 3, 140],
  chop: [0.26, 3, 140], pick: [0.22, 3, 140], hammer: [0.28, 3, 140],
  bow: [0.32, 4, 60], arrowhit: [0.22, 3, 70], gun: [0.42, 3, 90], ballista: [0.5, 2, 140], fireball: [0.42, 3, 90],
  boom_s: [0.55, 3, 110], boom_l: [0.7, 2, 160], collapse: [0.55, 2, 260], heal: [0.22, 2, 350],
  done: [0.5, 1, 400], coins: [0.42, 1, 220], train: [0.32, 1, 350],
  victory: [0.8, 1, 0], defeat: [0.8, 1, 0], warhorn: [0.65, 1, 1500], alarm: [0.5, 1, 9000], thunder: [0.6, 1, 900],
  choose: [0.42, 2, 40], swoosh: [0.3, 1, 120], start: [0.7, 1, 500], msg: [0.4, 1, 300],
  click: [0.32, 2, 45], nope: [0.4, 1, 160], select: [0.28, 1, 90], order: [0.3, 1, 90], place: [0.45, 1, 100],
};
const MAX_TOTAL = 14;

const load = () => { try { return JSON.parse(localStorage.getItem('mk_sound')) || {}; } catch (e) { return {}; } };

class SoundFX {
  constructor() {
    const st = load();
    this.sfxVol = st.sfx ?? 0.8;      // effects
    this.ambVol = st.amb ?? 0.6;      // nature sounds
    this.muted = !!st.muted;
    this.live = {}; this.last = {}; this.total = 0;
    this.loops = {}; this.loopVol = {};
    this.scene = null;
    this.ambT = 0;
  }

  get mgr() { return window.game?.sound; }
  ready(key) { return this.mgr && window.game.cache.audio.exists(key); }
  save() { try { localStorage.setItem('mk_sound', JSON.stringify({ sfx: this.sfxVol, amb: this.ambVol, muted: this.muted })); } catch (e) { /* private mode */ } }

  setVolume(kind, v) { this[kind === 'amb' ? 'ambVol' : 'sfxVol'] = v; this.save(); }
  setMuted(m) { this.muted = m; this.save(); if (m) this.silenceLoops(); }

  // ---------- one-shots ----------
  at(name, x, y, vol = 1) {
    const s = this.scene;
    if (!s || this.muted) return;
    const cam = s.cameras.main, v = cam.worldView, m = 30;
    if (x < v.x - m || x > v.right + m || y < v.y - m || y > v.bottom + m) return;
    const pan = Math.max(-0.6, Math.min(0.6, (x - v.centerX) / (v.width / 2) * 0.6));
    const zoomVol = Math.max(0.45, Math.min(1, cam.zoom / 2.2));
    this.play(name, vol * zoomVol, pan);
  }

  ui(name, vol = 1) { if (!this.muted) this.play(name, vol, 0); }

  play(name, vol, pan) {
    const c = CFG[name];
    if (!c || this.sfxVol <= 0 || !this.mgr || this.mgr.locked) return;
    const now = performance.now();
    if (now - (this.last[name] || 0) < c[2]) return;
    if ((this.live[name] || 0) >= c[1] || this.total >= MAX_TOTAL) return;
    const key = 'sfx_' + (VARIANTS[name] ? `${name}_${1 + Math.floor(Math.random() * VARIANTS[name])}` : name);
    if (!this.ready(key)) return;
    this.last[name] = now;
    const one = name === 'victory' || name === 'defeat' || name === 'click';
    const snd = this.mgr.add(key, { volume: c[0] * vol * this.sfxVol, detune: one ? 0 : (Math.random() * 2 - 1) * 110, pan });
    this.live[name] = (this.live[name] || 0) + 1; this.total++;
    let done = false;
    const end = () => { if (done) return; done = true; this.live[name]--; this.total--; snd.destroy(); };
    snd.once('complete', end); snd.once('stop', end);
    snd.play();
  }

  // ---------- ambience ----------
  attach(scene) {
    this.scene = scene;
    scene.events.once('shutdown', () => { this.silenceLoops(true); this.scene = null; });
    scene.events.on('pause', () => this.silenceLoops());
  }

  loop(key) {
    if (this.loops[key]) return this.loops[key];
    if (!this.ready('sfx_' + key)) return null;
    const l = this.mgr.add('sfx_' + key, { loop: true, volume: 0 });
    l.play();
    this.loopVol[key] = 0;
    return (this.loops[key] = l);
  }

  silenceLoops(destroy = false) {
    for (const [k, l] of Object.entries(this.loops)) {
      l.setVolume(0); this.loopVol[k] = 0;
      if (destroy) { l.stop(); l.destroy(); delete this.loops[k]; }
    }
  }

  // twice a second: day birds / night crickets, rain, wind, water nearby
  update(dt) {
    const s = this.scene;
    if (!s || (this.ambT += dt) < 500) return;
    this.ambT = 0;
    const want = {};
    if (!this.muted && this.ambVol > 0 && this.mgr && !this.mgr.locked) {
      const fx = s.fx, night = fx?.nightLevel?.() || 0, w = fx?.weather?.kind || 'clear';
      const wet = w === 'rain', cold = fx?.base === 'snow', dry = fx?.base === 'sand';
      want.amb_day = (1 - night) * (wet ? 0.25 : 1) * (dry ? 0.35 : cold ? 0.5 : 0.8);
      want.amb_night = night * (wet ? 0.3 : 0.75);
      want.rain = wet ? 0.7 : 0;
      want.wind = w === 'blizzard' || w === 'sandstorm' ? 0.75 : cold || dry ? 0.22 : 0;
      want.water = this.waterInView(s) * 0.7;
      const zoom = s.cameras.main.zoom;
      for (const k in want) want[k] *= this.ambVol * (k === 'rain' || k === 'wind' ? 1 : Math.max(0.5, Math.min(1, zoom / 2)));
    }
    for (const k of LOOPS) {
      const target = want[k] || 0;
      if (!target && !this.loops[k]) continue;
      const l = this.loop(k);
      if (!l) continue;
      const v = this.loopVol[k] + (target - this.loopVol[k]) * 0.35;
      this.loopVol[k] = Math.abs(v - target) < 0.005 ? target : v;
      l.setVolume(this.loopVol[k]);
    }
  }

  // share of a 5x5 sample of the view that is water
  waterInView(s) {
    const t = s.terrain, v = s.cameras.main.worldView;
    if (!t?.lakes?.length) return 0;
    let n = 0;
    for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) {
      const x = Math.floor((v.x + v.width * (i + 0.5) / 5) / 16), y = Math.floor((v.y + v.height * (j + 0.5) / 5) / 16);
      if (t.isWater(x, y)) n++;
    }
    return Math.min(1, n / 6);
  }
}

export const sfx = new SoundFX();

// a soft click for every button in the menus and the HUD
document.addEventListener('pointerdown', (e) => {
  const t = e.target.closest?.('button, .btn, .mbtn, .card, .tab, input[type=range]');
  if (!t || t.disabled) return;
  // choosing something (a kingdom, a map, a stage, an option) sounds different from a plain button
  sfx.ui(t.matches('.pick, .swatch, .mapcard, .stage, .seg button, .chip, .tbtn, .lvl, .kdot') ? 'choose' : 'click');
}, { capture: true, passive: true });
window.__sfx = sfx;   // for tests
