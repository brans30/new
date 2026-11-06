// Touch-friendly camera.
//   1 finger drag  -> pan
//   2 fingers      -> pinch to zoom (around the fingers) and pan with them
//   short tap      -> command (onTap)
//   hold ~0.45 s still, then drag -> selection box (onBox: 'start' | 'move' | 'end')
//   mouse: drag to pan, wheel to zoom, click = tap
//
// Fingers are tracked by their pointer id. A finger that is lifted anywhere
// (even over the HTML menus) is removed, so a stale finger can never turn a
// normal drag into a pinch.
export class CameraControls {
  constructor(scene, onTap, onBox = null) {
    this.scene = scene;
    this.cam = scene.cameras.main;
    this.onTap = onTap;
    this.onBox = onBox;
    this.HOLD = 450;               // ms a finger must stay still to start a selection box
    this.hoverWorld = null;
    this.fingers = new Map();      // pointerId -> {x, y}
    this.gesture = null;           // 'tap' | 'pan' | 'pinch'
    this.minZoom = 1.5; this.maxZoom = 6;

    scene.input.addPointer(2);
    // a battle starts fully zoomed out (as far as pinching out goes)
    this.cam.setZoom(this.minZoom);
    this.cam.roundPixels = true;

    const input = scene.input;
    input.on('pointerdown', (p) => this.down(p));
    input.on('pointermove', (p) => this.move(p));
    input.on('pointerup', (p) => this.up(p, true));
    input.on('pointerupoutside', (p) => this.up(p, false));
    input.on('gameout', () => { if (!scene.input.activePointer.isDown) this.reset(); });
    input.on('wheel', (p, objs, dx, dy) => this.zoomAt(this.cam.zoom * (dy > 0 ? 0.9 : 1.1), p.x, p.y));

    // safety net: any finger released anywhere on the page (over the menus too).
    // Phaser uses touch events, so we match fingers by Touch.identifier.
    // Only for fingers lifted OUTSIDE the canvas, and a moment later, so Phaser
    // handles every normal lift (and taps) first.
    const canvas = scene.game.canvas;
    const forget = (k) => setTimeout(() => {
      if (this.fingers.delete(k) && !this.fingers.size) this.gesture = null;
    }, 120);
    this.onTouchEnd = (e) => {
      if (e.target === canvas) return;
      for (const t of e.changedTouches) forget('t' + t.identifier);
    };
    this.onMouseUp = (e) => { if (e.target !== canvas) forget('m'); };
    this.onBlur = () => this.reset();
    window.addEventListener('touchend', this.onTouchEnd, true);
    window.addEventListener('touchcancel', this.onTouchEnd, true);
    window.addEventListener('mouseup', this.onMouseUp, true);
    window.addEventListener('blur', this.onBlur);
    scene.events.once('shutdown', () => {
      window.removeEventListener('touchend', this.onTouchEnd, true);
      window.removeEventListener('touchcancel', this.onTouchEnd, true);
      window.removeEventListener('mouseup', this.onMouseUp, true);
      window.removeEventListener('blur', this.onBlur);
    });
  }

  // Phaser pointers carry the touch identifier
  key(p) { return p.wasTouch ? 't' + p.identifier : 'm'; }

  reset() { this.fingers.clear(); this.gesture = null; }

  down(p) {
    // ignore the fake mouse events some phones send after a touch
    if (!p.wasTouch && [...this.fingers.keys()].some(k => k[0] === 't')) return;
    this.fingers.set(this.key(p), { x: p.x, y: p.y, sx: p.x, sy: p.y, t: performance.now() });
    if (this.fingers.size === 1) this.gesture = 'tap';
    else {
      if (this.gesture === 'box') this.onBox?.('cancel');
      this.gesture = 'pinch'; this.startPinch();
    }
  }

  move(p) {
    const f = this.fingers.get(this.key(p));
    if (!f) {
      if (!p.isDown) this.hoverWorld = this.cam.getWorldPoint(p.x, p.y);
      return;
    }
    const lx = f.x, ly = f.y;
    f.x = p.x; f.y = p.y;

    if (this.gesture === 'pinch' && this.fingers.size >= 2) return this.updatePinch();
    if (this.gesture === 'box') return this.onBox?.('move', this.cam.getWorldPoint(p.x, p.y), p);
    if (this.gesture === 'tap' && Math.hypot(p.x - f.sx, p.y - f.sy) > 10) { this.gesture = 'pan'; this.onBox?.('cancel'); }
    if (this.gesture === 'pan') {
      this.cam.scrollX -= (p.x - lx) / this.cam.zoom;
      this.cam.scrollY -= (p.y - ly) / this.cam.zoom;
    }
  }

  up(p, onCanvas) {
    const k = this.key(p);
    if (!this.fingers.has(k)) return;
    const wasTap = this.gesture === 'tap' && this.fingers.size === 1;
    if (this.gesture === 'box' && this.fingers.size === 1) {
      this.fingers.delete(k); this.gesture = null;
      this.onBox?.('end', this.cam.getWorldPoint(p.x, p.y));
      return;
    }
    this.fingers.delete(k);
    if (wasTap && onCanvas) {
      const w = this.cam.getWorldPoint(p.x, p.y);
      this.onTap(w.x, w.y);
    }
    this.onBox?.('cancel');
    if (!this.fingers.size) this.gesture = null;
    else if (this.gesture === 'pinch') {
      // one finger left after a pinch: keep panning with it, no jump
      this.gesture = 'pan';
    }
  }

  // ---------- pinch: zoom around the middle of the two fingers and follow it ----------
  twoFingers() { const [a, b] = [...this.fingers.values()]; return [a, b]; }

  startPinch() {
    const [a, b] = this.twoFingers();
    this.pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
  }

  updatePinch() {
    const [a, b] = this.twoFingers();
    const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    // pan with the midpoint
    this.cam.scrollX -= (mx - this.pinch.mx) / this.cam.zoom;
    this.cam.scrollY -= (my - this.pinch.my) / this.cam.zoom;
    // zoom only when the fingers really spread/close (ignore tiny jitter)
    const ratio = dist / this.pinch.dist;
    if (Math.abs(ratio - 1) > 0.01) this.zoomAt(this.cam.zoom * ratio, mx, my);
    this.pinch = { dist, mx, my };
  }

  // zoom keeping the world point under (sx,sy) in place
  zoomAt(z, sx, sy) {
    const cam = this.cam;
    z = Phaser.Math.Clamp(z, this.minZoom, this.maxZoom);
    const before = cam.getWorldPoint(sx, sy);
    cam.setZoom(z);
    cam.preRender();
    const after = cam.getWorldPoint(sx, sy);
    cam.scrollX += before.x - after.x;
    cam.scrollY += before.y - after.y;
  }

  // every frame: a finger held still long enough starts the box;
  // while drawing a box near the screen edge, the camera slides that way
  update(dt = 16) {
    if (this.gesture === 'tap' && this.fingers.size === 1 && this.onBox) {
      const f = [...this.fingers.values()][0];
      const held = performance.now() - f.t;
      if (held > 120) this.onBox('hold', this.cam.getWorldPoint(f.sx, f.sy), Math.min(1, held / this.HOLD));
      if (held >= this.HOLD && this.onBox('start', this.cam.getWorldPoint(f.sx, f.sy)) !== false) this.gesture = 'box';
    }
    if (this.gesture === 'box' && this.fingers.size === 1) {
      const f = [...this.fingers.values()][0], W = this.scene.scale.width, H = this.scene.scale.height, m = 36;
      const vx = f.x < m ? -1 : f.x > W - m ? 1 : 0, vy = f.y < m ? -1 : f.y > H - m ? 1 : 0;
      if (vx || vy) {
        const sp = 0.35 * dt / this.cam.zoom;
        this.cam.scrollX += vx * sp; this.cam.scrollY += vy * sp;
        this.onBox('move', this.cam.getWorldPoint(f.x, f.y));
      }
    }
  }
}
