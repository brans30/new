import { TEAM, UNITS, unitName } from '../data/config.js';
import { SKILLS } from '../systems/HeroSkills.js';
import { icon } from './Hud.js';
import { sfx } from '../systems/Sound.js';
import { ads } from '../systems/Ads.js';
import { t } from '../i18n.js';

// =====================================================================
//  The hero's skills, bottom-left just above the panel. Only while you have a hero.
//    [portrait + health]  [skill] [skill] [skill]
//  A skill button fills up while it recharges (and shows the seconds left).
//  Tap: 'self' skills fire at once; the others glow and wait for a tap on the map
//  (a gold circle shows how far the hero can reach). Tap it again to cancel.
// =====================================================================
const $ = (id) => document.getElementById(id);
const skillIcon = (i, size = 30) => `<span class="sk-ic" style="width:${size}px;height:${size}px;background-size:${size * 9}px ${size}px;background-position:-${i * size}px 0"></span>`;

class SkillBar {
  attach(scene) {
    this.s = scene;
    this.heroId = null;
    const el = $('skills');
    el.onclick = (e) => this.tap(e);
    const draw = () => this.render();
    scene.events.on('skills', draw);
    scene.events.on('selection', draw);
    this.timer = scene.time.addEvent({ delay: 200, loop: true, callback: () => this.tick() });
    scene.events.once('shutdown', () => { scene.events.off('skills', draw); scene.events.off('selection', draw); el.classList.add('hidden'); });
    this.render();
  }

  // the hero on the field (heroOf also returns the tavern while one is being hired)
  hero() { const h = this.s.heroOf(TEAM.PLAYER); return h?.alive && h.def?.hero ? h : null; }

  tap(e) {
    const b = e.target.closest('button'), s = this.s, h = this.hero();
    if (!b || !h) return;
    if (b.dataset.hero !== undefined) { s.select([h]); s.cameras.main.pan(h.x, h.y, 300, 'Sine.easeInOut'); return; }
    // 🎬 watch an ad: every skill ready at once (once a battle)
    if (b.dataset.adcharge !== undefined) {
      if (s.adRecharged) return;
      b.disabled = true;
      ads.showRewarded().then(r => {
        b.disabled = false;
        if (r !== 'rewarded') return;
        s.adRecharged = true; s.adWatched = true;
        h.cd = {}; sfx.ui('done'); s.fx?.emit('sparkle', h.x, h.y - 6, 8);
        this.render();
      });
      return;
    }
    const key = b.dataset.sk, sk = SKILLS[key];
    if (!sk) return;
    if (s.skills.readyIn(h, key) > 0) { b.classList.remove('nope'); void b.offsetWidth; b.classList.add('nope'); sfx.ui('nope'); return; }
    if (s.castMode === key) s.castMode = null;                       // tapped again: cancel
    else if (sk.target === 'self') { s.castMode = null; s.skills.cast(h, key); }
    else { s.castMode = key; sfx.ui('choose'); }
    this.render();
  }

  render() {
    const el = $('skills'), h = this.hero();
    el.classList.toggle('hidden', !h);
    if (!h) { this.heroId = null; if (this.s.castMode) this.s.castMode = null; return; }
    this.lastHero = h;
    const keys = this.s.skills.skillsOf(h);
    const hint = this.s.castMode ? `<div class="sk-hint">🎯 ${t('المس الخريطة لاستخدام')} ${SKILLS[this.s.castMode].name}</div>` : '';
    el.innerHTML = `${hint}
      <button class="sk-hero" data-hero aria-label="${unitName(h.kind, TEAM.PLAYER)}">${icon(`${UNITS[h.kind].sprite}_${TEAM.PLAYER}`, 0, 34)}<i class="sk-hp"><b id="sk-hpbar"></b></i></button>
      ${keys.map(k => `<button class="sk ${this.s.castMode === k ? 'on' : ''}" data-sk="${k}" aria-label="${SKILLS[k].name}">
        ${skillIcon(SKILLS[k].icon)}<i class="sk-cd" data-cd="${k}"></i><b class="sk-sec" data-sec="${k}"></b><small>${SKILLS[k].name}</small></button>`).join('')}
      <button class="sk-ad hidden" data-adcharge aria-label="${t('اشحن الآن')}">🎬<small>${t('اشحن الآن')}</small></button>`;
    this.tick();
  }

  // cooldown rings and the hero's health, 5 times a second (no re-render)
  tick() {
    const h = this.hero(), el = $('skills');
    if (!!h === el.classList.contains('hidden') || (h && h !== this.lastHero)) { this.lastHero = h; return this.render(); }
    if (!h) return;
    const bar = $('sk-hpbar');
    if (bar) bar.style.width = Math.max(0, h.hp / h.maxHp * 100) + '%';
    // sit just above the bottom panel
    const top = $('panel')?.getBoundingClientRect().top;
    if (top) el.style.bottom = (innerHeight - top + 8) + 'px';
    let anyWait = false;
    for (const k of this.s.skills.skillsOf(h)) {
      const left = this.s.skills.readyIn(h, k), cd = SKILLS[k].cd;
      const ring = el.querySelector(`[data-cd="${k}"]`), sec = el.querySelector(`[data-sec="${k}"]`);
      if (!ring) continue;
      ring.style.setProperty('--p', left ? (1 - left / cd) * 360 + 'deg' : '360deg');
      ring.parentElement.classList.toggle('wait', left > 0);
      if (left > 0) anyWait = true;
      sec.textContent = left > 0 ? Math.ceil(left / 1000) : '';
    }
    el.querySelector('[data-adcharge]')?.classList.toggle('hidden', !anyWait || !!this.s.adRecharged);
  }
}

export const skillBar = new SkillBar();
