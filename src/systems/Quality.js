// =====================================================================
//  Graphics quality: high / medium / low, or auto (the default).
//
//   high    everything (night light map, building lights, clouds, mist, all weather and dust)
//   medium  no light map / building lights (a simple dark tint at night), no clouds or mist,
//           half the weather and decorative particles
//   low     medium + no weather particles, no smoke, dust, footprints or embers
//
//  "auto" starts on the level this phone managed last time and steps down by itself
//  if the battle runs slowly (under ~40 fps for 4 s, ignoring pauses); the level it
//  reaches is remembered for next time. Choosing "auto" again in the settings
//  starts over from high.
// =====================================================================
const KEY = 'mk.quality', AUTO_KEY = 'mk.quality.auto';
const LEVELS = ['low', 'medium', 'high'];
const read = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const write = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } };

class Quality {
  constructor() {
    this.pref = read(KEY) || 'auto';
    this.autoLevel = LEVELS.includes(read(AUTO_KEY)) ? read(AUTO_KEY) : 'high';
    this.listeners = new Set();
    this.resetMeter();
  }

  // the level in use: 'high' | 'medium' | 'low'
  get level() { return this.pref === 'auto' ? this.autoLevel : this.pref; }
  // 2 = high, 1 = medium, 0 = low
  get n() { return LEVELS.indexOf(this.level); }

  set(pref) {
    this.pref = pref; write(KEY, pref);
    if (pref === 'auto') { this.autoLevel = 'high'; write(AUTO_KEY, 'high'); }
    this.resetMeter(); this.changed();
  }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  changed() { for (const fn of this.listeners) fn(this.level); }

  resetMeter() { this.acc = 0; this.frames = 0; this.warm = 5000; }

  // called every frame of a battle with the real frame time; -> the new level when it stepped down
  measure(rawDt) {
    if (this.pref !== 'auto' || this.n === 0) return null;
    if (rawDt > 250) return null;                   // paused, hidden or an ad: not a slow phone
    if ((this.warm -= rawDt) > 0) return null;      // the first seconds of a battle are busy anyway
    this.acc += rawDt; this.frames++;
    if (this.acc < 4000) return null;
    const fps = this.frames * 1000 / this.acc;
    this.acc = 0; this.frames = 0;
    if (fps >= 40) return null;
    this.autoLevel = LEVELS[this.n - 1];
    write(AUTO_KEY, this.autoLevel);
    this.warm = 3000;
    this.changed();
    return this.autoLevel;
  }
}

export const quality = new Quality();
window.__quality = quality;
