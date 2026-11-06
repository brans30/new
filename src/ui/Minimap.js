import { TILE, MAP_W, MAP_H, KINGDOMS, TEAM } from '../data/config.js';
import { T, SHORES } from '../systems/Terrain.js';

// =====================================================================
//  Minimap (right side of the bottom panel) + alerts on it instead of text.
//
//  - the land (lakes, cliffs, forests, mines) is drawn once
//  - every 1/4 s: buildings and units as dots in their kingdom colour,
//    and the white frame of what the camera sees
//  - tap or drag on it to move the camera there
//
//  Alerts are pulsing rings on the minimap (CSS animation), the minimap frame
//  glows, and the phone vibrates a little for attacks:
//    attack   red      your workers, soldiers or buildings are being hit
//    march    red, big an enemy army is marching on you
//    ally     blue     an ally is being attacked
//    done     green    a building is finished
//    mine     gold     you took a mine
//    lost     grey     you lost a mine
//    fall     white    a keep has fallen
// =====================================================================
const $ = (id) => document.getElementById(id);

export class Minimap {
  attach(scene) {
    this.scene = scene;
    this.wrap = $('minimap');
    this.cv = $('mm-canvas');
    this.pings = $('mm-pings');
    this.pings.innerHTML = '';
    this.recent = new Map();          // throttle: area -> time of the last alert there
    this.S = 3;                       // canvas pixels per tile
    this.cv.width = MAP_W * this.S; this.cv.height = MAP_H * this.S;
    this.wrap.style.setProperty('--ar', `${MAP_W} / ${MAP_H}`);
    this.drawLand();
    this.bindInput();
    clearInterval(this.timer);
    this.timer = setInterval(() => this.draw(), 250);
    const onAlert = (a) => this.alert(a);
    scene.events.on('alert', onAlert);
    scene.events.once('shutdown', () => { scene.events.off('alert', onAlert); clearInterval(this.timer); });
    this.draw();
    // leave room for the minimap on the right of the bottom panel
    const fit = () => $('panel').style.setProperty('--mmw', this.wrap.offsetWidth + 'px');
    requestAnimationFrame(fit);
    if (!this.resizeBound) { this.resizeBound = true; window.addEventListener('resize', () => requestAnimationFrame(fit)); }
  }

  // the land never changes much: draw it once (trees and mines are redrawn when they go)
  drawLand() {
    const s = this.scene, plan = s.plan, M = plan.theme.mini, sh = SHORES[plan.theme.shore] || SHORES.sand;
    const c = document.createElement('canvas');
    c.width = MAP_W; c.height = MAP_H;
    const g = c.getContext('2d');
    g.fillStyle = M.ground; g.fillRect(0, 0, MAP_W, MAP_H);
    const rgb = (a) => `rgb(${a[0]},${a[1]},${a[2]})`;
    for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
      const t = s.terrain.get(x, y);
      if (t === T.GRASS) continue;
      g.fillStyle = t === T.WATER ? rgb(sh[3]) : t === T.CLIFF ? M.cliff : t === T.HIGH ? M.top : '#e3d6aa';
      g.fillRect(x, y, 1, 1);
    }
    this.land = c;
    this.nodesAt = -1;
    this.base = null;
  }

  draw() {
    const s = this.scene;
    if (!s.sys?.isActive() && !s.sys?.isPaused()) return;
    const g = this.cv.getContext('2d'), S = this.S, M = s.plan.theme.mini;
    g.imageSmoothingEnabled = false;
    // the land + resources layer is cached, and only redrawn when a tree/rock/mine is used up
    if (!this.base || this.nodesAt !== s.nodes.length) {
      this.nodesAt = s.nodes.length;
      this.base = this.base || document.createElement('canvas');
      this.base.width = MAP_W * S; this.base.height = MAP_H * S;
      const b = this.base.getContext('2d');
      b.imageSmoothingEnabled = false;
      b.drawImage(this.land, 0, 0, MAP_W * S, MAP_H * S);
      for (const n of s.nodes) {
        if (!n.alive) continue;
        if (n.def.mine) { b.fillStyle = n.type === 'gold' ? '#ffd84a' : '#f4f4f0'; b.fillRect(n.tx * S, n.ty * S, S, S); }
        else { b.fillStyle = n.type === 'stone' ? M.rock : M.tree; b.fillRect(n.tx * S + 0.5, n.ty * S + 0.5, S - 1, S - 1); }
      }
    }
    g.drawImage(this.base, 0, 0);
    // buildings, then units, in kingdom colours (yours get a light outline)
    for (const b of s.buildings) {
      if (!b.alive) continue;
      const col = KINGDOMS[b.team]?.css || '#fff';
      g.fillStyle = col;
      const big = b.size * S;
      g.fillRect(b.tx * S, b.ty * S, big, big);
      if (b.kind === 'keep') { g.strokeStyle = b.team === TEAM.PLAYER ? '#fff' : '#1b130b'; g.lineWidth = 1; g.strokeRect(b.tx * S + 0.5, b.ty * S + 0.5, big - 1, big - 1); }
    }
    for (const u of s.units) {
      if (!u.alive || u.hidden) continue;
      g.fillStyle = KINGDOMS[u.team]?.css || '#fff';
      const x = Math.round(u.x / TILE * S), y = Math.round(u.y / TILE * S);
      g.fillRect(x - 1, y - 1, 2, 2);
    }
    // what the camera sees
    const v = s.cameras.main.worldView;
    g.strokeStyle = 'rgba(255,255,255,.95)'; g.lineWidth = 1;
    g.strokeRect(Math.round(v.x / TILE * S) + 0.5, Math.round(v.y / TILE * S) + 0.5, Math.round(v.width / TILE * S), Math.round(v.height / TILE * S));
  }

  // tap / drag = move the camera
  bindInput() {
    if (this.bound) return;
    this.bound = true;
    let down = false;
    const go = (e) => {
      const r = this.cv.getBoundingClientRect();
      const fx = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), fy = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
      this.scene.cameras.main.centerOn(fx * MAP_W * TILE, fy * MAP_H * TILE);
      this.draw();
    };
    this.wrap.addEventListener('pointerdown', (e) => { down = true; this.wrap.setPointerCapture?.(e.pointerId); go(e); e.preventDefault(); e.stopPropagation(); });
    this.wrap.addEventListener('pointermove', (e) => { if (down) { go(e); e.preventDefault(); } });
    const up = () => { down = false; };
    this.wrap.addEventListener('pointerup', up);
    this.wrap.addEventListener('pointercancel', up);
  }

  // ---------------- alerts ----------------
  alert({ type, x, y }) {
    const now = this.scene.simTime;
    // one alert per area (6x6 tiles) per type every few seconds, so a long fight doesn't spam
    const key = type + ':' + Math.floor(x / TILE / 6) + ',' + Math.floor(y / TILE / 6);
    const gap = { attack: 6000, ally: 9000, march: 15000 }[type] || 0;
    if (gap && now - (this.recent.get(key) ?? -1e9) < gap) return;
    this.recent.set(key, now);
    const p = document.createElement('i');
    p.className = 'ping ' + type;
    p.style.left = (x / (MAP_W * TILE) * 100) + '%';
    p.style.top = (y / (MAP_H * TILE) * 100) + '%';
    this.pings.appendChild(p);
    setTimeout(() => p.remove(), type === 'march' ? 4200 : 3000);
    if (type === 'attack' || type === 'march') {
      this.wrap.classList.remove('alarm'); void this.wrap.offsetWidth; this.wrap.classList.add('alarm');
      // a short buzz on phones (not more than once every 8 s)
      if (now - (this.lastBuzz || -1e9) > 8000) { this.lastBuzz = now; try { navigator.vibrate?.(type === 'march' ? [60, 60, 60] : 50); } catch (e) { /* not supported */ } }
    }
    this.last = { x, y, t: now };
  }
}

export const minimap = new Minimap();
