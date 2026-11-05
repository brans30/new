import { SHEETS, ANIMS, ANIMS_RACE, ALL_COLORS, KINGDOMS } from '../data/config.js';
import { menu } from '../ui/Menu.js';
import { loading } from '../ui/Loading.js';
import { DIRS } from '../entities/Unit.js';
import { SFX_FILES } from '../systems/Sound.js';
import { packAtlas } from '../systems/Atlas.js';

// Expands "{team}" entries into one sheet per kingdom colour
export function allSheets() {
  const out = {};
  for (const [key, s] of Object.entries(SHEETS)) {
    if (key.includes('{team}')) {
      for (const t of ALL_COLORS) out[key.replace('{team}', t)] = { ...s, file: s.file.replace('{team}', t) };
    } else out[key] = s;
  }
  return out;
}

// Loads all images and builds every animation from the data in config.js
export class BootScene extends Phaser.Scene {
  constructor() { super('Boot'); }

  preload() {
    // the loading screen's bar follows the real loader
    loading.start();
    let last = '';
    this.load.on('fileprogress', (f) => { last = f.key; });
    this.load.on('progress', (p) => loading.progress(p * 0.95, last));
    this.load.setPath('assets/');
    for (const [key, s] of Object.entries(allSheets())) {
      this.load.spritesheet(key, s.file, { frameWidth: s.frame, frameHeight: s.frame });
    }
    // sounds: ogg where it plays (Android / Chrome), mp3 otherwise
    for (const k of SFX_FILES) this.load.audio('sfx_' + k, [`sfx/${k}.ogg`, `sfx/${k}.mp3`]);
  }

  create() {
    // remember sheet sizes so the HTML UI can cut icons out of them
    window.__sheets = {};
    for (const [key, s] of Object.entries(allSheets())) {
      const img = this.textures.get(key).getSourceImage();
      window.__sheets[key] = { ...s, w: img.width, h: img.height };
    }
    // performance: every sprite sheet into one big texture (far fewer draw calls)
    window.__atlasPages = packAtlas(this);
    // every character animation comes from the layout table in config.js
    for (const [sprite, base] of Object.entries(ANIMS)) {
      for (const team of ALL_COLORS) {
        const spec = ANIMS_RACE[KINGDOMS[team].race]?.[sprite] || base;
        const tex = `${sprite}_${team}`;
        for (const name of ['idle', 'walk', 'act']) {
          const a = spec[name];
          if (!a) continue;                       // no attack row: the unit lunges instead
          DIRS.forEach((dir, i) => {
            const start = a.rows[i] * spec.cols + (a.c0 || 0);
            this.anims.create({
              key: `${tex}_${name}_${dir}`,
              frames: this.anims.generateFrameNumbers(tex, { start, end: start + a.n - 1 }),
              frameRate: name === 'idle' ? 4 : (sprite === 'knight' && name === 'walk' ? 11 : 9),
              repeat: name !== 'act' || sprite === 'worker' ? -1 : 0,
            });
          });
        }
      }
    }
    // the start menu (or straight into a default match with ?quick, used by the tests)
    if (new URLSearchParams(location.search).has('quick')) loading.done(() => this.scene.start('Game'));
    else loading.done(() => menu.open(this.game));
  }
}
