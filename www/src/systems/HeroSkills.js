import { TILE, TEAM, PROJECTILES } from '../data/config.js';
import { hostile, allied } from './Match.js';
import { Building } from '../entities/Building.js';
import { t } from '../i18n.js';

// =====================================================================
//  Hero skills: three per hero, used from the bar on the left (ui/SkillBar.js).
//  The computer's heroes use the same skills on their own (see aiThink).
//
//  target: 'area'  -> tap a place (within range of the hero)
//          'enemy' -> tap near an enemy: the closest one to the tap
//          'line'  -> tap a place: a wall of fire across the hero's way
//          'self'  -> fires at once around the hero
//  Damage is kept modest: no skill kills a healthy swordsman (110 hp) by itself.
// =====================================================================
export const SKILLS = {
  meteor:    { icon: 0, name: t('نيزك'), desc: t('يسقط من السماء: 70 ضرراً في المركز'), cd: 75000, target: 'area', range: TILE * 11, radius: TILE * 2, sound: 'boom_l' },
  arrows:    { icon: 1, name: t('مطر السهام'), desc: t('5 موجات من السهام على منطقة'), cd: 40000, target: 'area', range: TILE * 10, radius: TILE * 3, sound: 'bow' },
  warhorn:   { icon: 2, name: t('نفير الحرب'), desc: t('+25% ضرر و+15% سرعة لجنودك حولك 10 ث'), cd: 45000, target: 'self', radius: TILE * 6, sound: 'warhorn' },
  lightning: { icon: 3, name: t('صاعقة'), desc: t('تضرب عدواً ثم تقفز إلى 3 آخرين'), cd: 35000, target: 'enemy', range: TILE * 9, sound: 'thunder' },
  whirlwind: { icon: 4, name: t('الدوامة'), desc: t('يضرب كل من حوله'), cd: 15000, target: 'self', radius: 30, sound: 'sword' },
  quake:     { icon: 5, name: t('زلزال'), desc: t('يوقف الأعداء حوله 2.5 ث'), cd: 50000, target: 'self', radius: TILE * 3.5, sound: 'collapse' },
  dash:      { icon: 6, name: t('الاندفاع'), desc: t('يقفز على عدو ويضربه ×3'), cd: 12000, target: 'enemy', range: TILE * 6, sound: 'sword' },
  smoke:     { icon: 7, name: t('قنبلة دخان'), desc: t('السهام تخطئ جنودك داخلها 6 ث'), cd: 45000, target: 'area', range: TILE * 9, radius: TILE * 2.5, sound: 'swoosh' },
  firewall:  { icon: 8, name: t('خط النار'), desc: t('جدار نار يحرق من يقف عليه 6 ث'), cd: 50000, target: 'line', range: TILE * 8, length: TILE * 5, sound: 'fireball' },
};
export const HERO_SKILLS = { arthax: ['meteor', 'arrows', 'warhorn'], grum: ['lightning', 'whirlwind', 'quake'], kanji: ['dash', 'smoke', 'firewall'] };

export class HeroSkills {
  constructor(scene) {
    this.s = scene;
    this.smokes = [];          // { x, y, r, until, team }
    this.fires = [];           // { x1, y1, x2, y2, until, team, tick }
    this.aiT = 0;
  }

  get now() { return this.s.simTime; }
  skillsOf(hero) { return hero ? HERO_SKILLS[hero.kind] || [] : []; }
  readyIn(hero, key) { return Math.max(0, (hero.cd?.[key] || 0) - this.now); }

  foes(team) { return this.s.units.filter(e => e.alive && !e.hidden && hostile(e.team, team)); }
  near(list, x, y, r) { return list.filter(e => Math.hypot(e.x - x, e.y - y) <= r + (e.radius || 6)); }

  // the player (or the AI) asks for a skill. Far targets: the hero walks closer first.
  cast(hero, key, x, y) {
    const sk = SKILLS[key];
    if (!hero?.alive || !sk || this.readyIn(hero, key) > 0) return false;
    if (sk.target === 'self') { x = hero.x; y = hero.y; }
    if (sk.target === 'enemy') {
      const foe = this.near(this.foes(hero.team), x, y, TILE * 3).sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y))[0];
      if (!foe) return false;
      hero.pendingCast = { key, foe };
    } else hero.pendingCast = { key, x, y };
    if (sk.range && Math.hypot(this.targetOf(hero).x - hero.x, this.targetOf(hero).y - hero.y) > sk.range) {
      const p = this.targetOf(hero);
      hero.command({ type: 'move', x: p.x, y: p.y });
      return true;                         // update() fires it once in range
    }
    this.fire(hero);
    return true;
  }

  targetOf(hero) { const c = hero.pendingCast; return c.foe ? c.foe : c; }

  fire(hero) {
    const c = hero.pendingCast; hero.pendingCast = null;
    if (!c) return;
    const sk = SKILLS[c.key], p = c.foe || c;
    if (c.foe && !c.foe.alive) return;
    (hero.cd = hero.cd || {})[c.key] = this.now + sk.cd;
    hero.faceTarget?.(p);
    this[c.key](hero, p.x, p.y, c.foe);
    this.s.sfx?.at(sk.sound, hero.x, hero.y);
    this.s.events.emit('skills');
  }

  // ---------------- the skills ----------------
  meteor(h, x, y) {
    const s = this.s, sk = SKILLS.meteor;
    const shadow = s.add.ellipse(x, y + 2, 8, 4, 0x000000, 0.35).setDepth(99980);
    s.tweens.add({ targets: shadow, scaleX: 5, scaleY: 5, duration: 1000 });
    const rock = s.add.circle(x - 110, y - 200, 6, 0x8a4f2a).setStrokeStyle(2, 0xffb347).setDepth(99995);
    const glow = s.add.circle(x - 110, y - 200, 10, 0xff8a2a, 0.45).setDepth(99994).setBlendMode(Phaser.BlendModes.ADD);
    let tick = 0;
    s.tweens.add({ targets: [rock, glow], x, y, duration: 1000, ease: 'Quad.easeIn',
      onUpdate: () => { if (++tick % 2 === 0) s.fx?.emit('trailF', rock.x, rock.y, 2); },
      onComplete: () => {
        rock.destroy(); glow.destroy(); shadow.destroy();
        s.fx.explode(x, y, 1.6, 3);
        for (const e of [...this.foes(h.team), ...s.buildings.filter(b => b.alive && hostile(b.team, h.team))]) {
          const d = Math.max(0, Math.hypot(e.x - x, e.y - y) - (e.radius || 6));
          if (d > sk.radius) continue;
          const dmg = 70 * (1 - 0.6 * d / sk.radius) * (e instanceof Building ? 0.5 : 1);
          s.dealDamage(h, e, dmg, true);
        }
      } });
  }

  arrows(h, x, y) {
    const s = this.s, sk = SKILLS.arrows, pr = PROJECTILES.arrow;
    for (let w = 0; w < 5; w++) s.time.delayedCall(w * 600, () => {
      for (let i = 0; i < 8; i++) {
        const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * sk.radius;
        const tx = x + Math.cos(a) * r, ty = y + Math.sin(a) * r;
        if (!s.fx?.onScreen(tx, ty)) continue;
        const sp = s.add.sprite(tx - 30, ty - 70, pr.sheet, pr.frame).setDepth(99990);
        sp.rotation = Math.atan2(70, 30);
        s.tweens.add({ targets: sp, x: tx, y: ty, duration: 260 + Math.random() * 120, onComplete: () => { sp.destroy(); s.fx?.emit('dust', tx, ty, 1); } });
      }
      s.sfx?.at('bow', x, y, 0.7);
      s.time.delayedCall(300, () => this.near(this.foes(h.team), x, y, sk.radius).slice(0, 10).forEach(e => s.dealDamage(h, e, 7, true)));
    });
  }

  warhorn(h) {
    const s = this.s, sk = SKILLS.warhorn;
    for (const a of s.units) if (a.alive && allied(a.team, h.team) && a.team === h.team && Math.hypot(a.x - h.x, a.y - h.y) <= sk.radius) {
      a.buffUntil = this.now + 10000; a.buffMult = 1.25; a.speedBuff = 1.15;
      s.fx?.emit('sparkle', a.x, a.y - 6, 2);
    }
    s.ring(h.x, h.y, sk.radius, 0xffd84a);
    s.floatText(h, t('نفير الحرب!'), '#ffd84a');
  }

  lightning(h, x, y, foe) {
    const s = this.s, hit = [foe], dmg = [45, 35, 25, 15];
    let cur = foe;
    for (let i = 1; i < 4; i++) {
      const next = this.near(this.foes(h.team), cur.x, cur.y, TILE * 3).filter(e => !hit.includes(e))
        .sort((a, b) => Math.hypot(a.x - cur.x, a.y - cur.y) - Math.hypot(b.x - cur.x, b.y - cur.y))[0];
      if (!next) break;
      hit.push(next); cur = next;
    }
    const g = s.add.graphics().setDepth(99996).setBlendMode(Phaser.BlendModes.ADD);
    const bolt = (x1, y1, x2, y2) => {
      g.lineStyle(2, 0xfff3a0, 1).beginPath().moveTo(x1, y1);
      for (let k = 1; k < 6; k++) g.lineTo(x1 + (x2 - x1) * k / 6 + (Math.random() - 0.5) * 8, y1 + (y2 - y1) * k / 6 + (Math.random() - 0.5) * 8);
      g.lineTo(x2, y2).strokePath();
    };
    bolt(foe.x - 20, foe.y - 120, foe.x, foe.y - 4);
    for (let i = 1; i < hit.length; i++) bolt(hit[i - 1].x, hit[i - 1].y - 4, hit[i].x, hit[i].y - 4);
    hit.forEach((e, i) => { s.dealDamage(h, e, dmg[i], true); s.fx?.emit('spark', e.x, e.y - 4, 6); });
    s.tweens.add({ targets: g, alpha: 0, duration: 380, onComplete: () => g.destroy() });
  }

  whirlwind(h) {
    const s = this.s, sk = SKILLS.whirlwind;
    s.ring(h.x, h.y, sk.radius, 0xb36bff);
    s.tweens.add({ targets: h, angle: 360, duration: 380, onComplete: () => { h.angle = 0; } });
    this.near(this.foes(h.team), h.x, h.y, sk.radius).forEach(e => s.dealDamage(h, e, 30, true));
    s.floatText(h, t('الدوامة!'), '#c99bff');
  }

  quake(h) {
    const s = this.s, sk = SKILLS.quake;
    s.cameras.main.shake(260, 0.006);
    const g = s.add.graphics().setDepth(-5);
    g.lineStyle(1.5, 0x3a2412, 0.8);
    for (let i = 0; i < 7; i++) {
      const a = i / 7 * Math.PI * 2 + Math.random() * 0.4;
      g.beginPath().moveTo(h.x, h.y + 4);
      let px = h.x, py = h.y + 4;
      for (let k = 1; k <= 4; k++) { px = h.x + Math.cos(a) * sk.radius * k / 4 + (Math.random() - 0.5) * 5; py = h.y + 4 + Math.sin(a) * sk.radius * k / 4 * 0.6 + (Math.random() - 0.5) * 4; g.lineTo(px, py); }
      g.strokePath();
    }
    s.tweens.add({ targets: g, alpha: 0, delay: 1800, duration: 900, onComplete: () => g.destroy() });
    for (const e of this.near(this.foes(h.team), h.x, h.y, sk.radius)) {
      s.dealDamage(h, e, 15, true);
      e.stunUntil = this.now + 2500;
      s.fx?.emit('dust', e.x, e.y + 4, 3);
    }
    s.ring(h.x, h.y, sk.radius, 0xc8a070);
  }

  dash(h, x, y, foe) {
    const s = this.s;
    const a = Math.atan2(h.y - foe.y, h.x - foe.x);
    s.dust(h.x, h.y + 4);
    h.x = foe.x + Math.cos(a) * 12; h.y = foe.y + Math.sin(a) * 12; h.path = null;
    s.dealDamage(h, foe, h.def.damage * 3, true);
    h.engage?.(foe);
    s.floatText(h, t('اندفاع!'), '#ff8a5a');
  }

  smoke(h, x, y) {
    const sk = SKILLS.smoke, s = this.s;
    const cloud = { x, y, r: sk.radius, until: this.now + 6000, team: h.team, puffs: [] };
    for (let i = 0; i < 9; i++) {
      const a = i / 9 * Math.PI * 2, r = i ? sk.radius * 0.6 : 0;
      const c = s.add.circle(x + Math.cos(a) * r, y + Math.sin(a) * r * 0.7, sk.radius * 0.42, 0xe6e6ee, 0.0).setDepth(y + 30);
      s.tweens.add({ targets: c, fillAlpha: 0.3, duration: 400 });
      s.tweens.add({ targets: c, scale: 1.12, duration: 1400 + i * 90, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      cloud.puffs.push(c);
    }
    this.smokes.push(cloud);
  }

  firewall(h, x, y) {
    const sk = SKILLS.firewall;
    const a = Math.atan2(y - h.y, x - h.x) + Math.PI / 2, L = sk.length / 2;
    this.fires.push({ x1: x - Math.cos(a) * L, y1: y - Math.sin(a) * L, x2: x + Math.cos(a) * L, y2: y + Math.sin(a) * L, until: this.now + 6000, team: h.team, from: h, tick: 0, fx: 0 });
  }

  // arrows and bullets shot at someone inside an allied smoke cloud miss half the time
  missesInSmoke(target) {
    for (const c of this.smokes) if (allied(c.team, target.team) && Math.hypot(target.x - c.x, target.y - c.y) < c.r) return Math.random() < 0.5;
    return false;
  }

  // ---------------- every frame ----------------
  update(dt) {
    const s = this.s, now = this.now;
    // heroes walking to cast a far skill
    for (const h of s.units) {
      const c = h.pendingCast;
      if (!c || !h.alive) continue;
      const p = c.foe || c;
      if (c.foe && !c.foe.alive) { h.pendingCast = null; continue; }
      if (Math.hypot(p.x - h.x, p.y - h.y) <= SKILLS[c.key].range) { h.command({ type: 'move', x: h.x, y: h.y }); this.fire(h); }
    }
    // smoke clouds fade out
    for (const c of this.smokes) if (now > c.until && !c.gone) {
      c.gone = true;
      for (const p of c.puffs) s.tweens.add({ targets: p, fillAlpha: 0, duration: 600, onComplete: () => p.destroy() });
    }
    this.smokes = this.smokes.filter(c => !c.gone);
    // walls of fire: flames along the line, 6 damage a second to enemies on it
    for (const f of this.fires) {
      if ((f.fx += dt) > 120) {
        f.fx = 0;
        for (let k = 0; k <= 5; k++) { const px = f.x1 + (f.x2 - f.x1) * k / 5, py = f.y1 + (f.y2 - f.y1) * k / 5; if (s.fx?.onScreen(px, py)) s.fx.emit('fire', px + (Math.random() - 0.5) * 4, py, 1); }
      }
      if ((f.tick += dt) >= 1000) {
        f.tick = 0;
        for (const e of [...this.foes(f.team), ...s.buildings.filter(b => b.alive && hostile(b.team, f.team))]) {
          const vx = f.x2 - f.x1, vy = f.y2 - f.y1, l2 = vx * vx + vy * vy;
          const k = Math.max(0, Math.min(1, ((e.x - f.x1) * vx + (e.y - f.y1) * vy) / l2));
          if (Math.hypot(e.x - (f.x1 + vx * k), e.y - (f.y1 + vy * k)) <= 7 + (e.radius || 6)) s.dealDamage(f.from?.alive ? f.from : null, e, e instanceof Building ? 3 : 6, true);
        }
      }
    }
    this.fires = this.fires.filter(f => now < f.until);
    // the computer's heroes, once a second
    if ((this.aiT += dt) > 1000) { this.aiT = 0; for (const h of s.units) if (h.alive && h.def.hero && h.team !== TEAM.PLAYER && !h.pendingCast) this.aiThink(h); }
  }

  // simple, sensible use of skills by computer heroes
  aiThink(h) {
    const foes = this.foes(h.team).filter(e => Math.hypot(e.x - h.x, e.y - h.y) < TILE * 11);
    if (!foes.length) return;
    // the enemy with the most other enemies around it (a crowd worth hitting)
    const crowd = (r) => { let best = null, n = 0; for (const e of foes) { const c = this.near(foes, e.x, e.y, r).length; if (c > n) { n = c; best = e; } } return { at: best, n }; };
    for (const key of this.skillsOf(h)) {
      if (this.readyIn(h, key) > 0) continue;
      const sk = SKILLS[key], close = this.near(foes, h.x, h.y, sk.radius || 0).length;
      if (key === 'meteor' || key === 'arrows' || key === 'firewall') { const c = crowd(sk.radius || TILE * 2.5); if (c.n >= (key === 'meteor' ? 4 : 3)) return this.cast(h, key, c.at.x, c.at.y); }
      if (key === 'smoke') { const shooters = foes.filter(e => e.def.ranged).length; if (shooters >= 3) return this.cast(h, key, h.x, h.y); }
      if ((key === 'warhorn' && foes.length >= 3) || (key === 'whirlwind' && close >= 2) || (key === 'quake' && close >= 3)) return this.cast(h, key);
      if (key === 'lightning' && foes.length >= 2) return this.cast(h, key, foes[0].x, foes[0].y);
      if (key === 'dash') { const f = foes.find(e => e.def.ranged && Math.hypot(e.x - h.x, e.y - h.y) > 24 && Math.hypot(e.x - h.x, e.y - h.y) < sk.range); if (f) return this.cast(h, key, f.x, f.y); }
    }
  }
}
