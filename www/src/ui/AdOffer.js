import { TEAM, TILE } from '../data/config.js';
import { hostile } from '../systems/Match.js';
import { ads } from '../systems/Ads.js';
import { sfx } from '../systems/Sound.js';
import { t } from '../i18n.js';

// =====================================================================
//  A rewarded-ad offer, only when the player really needs a hand, never annoying.
//
//  Offered when ALL of these are true:
//    * at least 3 minutes into the battle
//    * a crisis: 3+ workers lost in the last 2 minutes
//      (or 5+ soldiers lost and only a few left)
//    * you can't afford to recover: little gold and wood
//    * the keep isn't already training workers
//  ...and it waits for a calm moment: no enemies at your keep, not placing a
//  building, not aiming a hero skill.
//
//  Limits: once every 6 minutes, at most twice a battle, and after two
//  "no thanks" in a row it never comes back in this battle.
//  The box slides in on the left and goes away by itself after 12 s.
//  The game pauses while the ad plays; the reward comes only after the whole ad.
// =====================================================================
const $ = (id) => document.getElementById(id);
const MIN_TIME = 3 * 60000, COOLDOWN = 6 * 60000, WINDOW = 2 * 60000, MAX_OFFERS = 2, SHOW_FOR = 12000;

class AdOffer {
  attach(scene) {
    this.s = scene;
    this.lost = { worker: [], soldier: [] };
    this.offers = 0; this.declines = 0; this.lastOffer = -1e9;
    this.open = null; this.checkT = 0;
    const el = $('adoffer');
    el.classList.add('hidden');
    el.onclick = (e) => this.tap(e);
    scene.events.on('unitLost', (u) => { if (u.team === TEAM.PLAYER) this.lost[u.kind === 'worker' ? 'worker' : 'soldier'].push(scene.simTime); });
    const tick = (time, dt) => this.update(dt * (scene.speed || 1));
    scene.events.on('update', tick);
    scene.events.once('shutdown', () => { scene.events.off('update', tick); clearTimeout(this.hideT); el.classList.add('hidden'); this.open = null; });
  }

  // called by the scene every frame
  update(dt) {
    if ((this.checkT += dt) < 2000 || this.open || !this.s) return;
    this.checkT = 0;
    const why = this.crisis();
    if (why && this.calm()) this.show(why);
  }

  mine(kind) { return this.s.units.filter(u => u.alive && u.team === TEAM.PLAYER && (kind === 'worker' ? u.kind === 'worker' : u.kind !== 'worker' && u.def.damage)).length; }

  // what went wrong ('worker' / 'soldier'), or null
  crisis() {
    const s = this.s, now = s.simTime;
    if (s.over || now < MIN_TIME || this.offers >= MAX_OFFERS || this.declines >= 2 || now - this.lastOffer < COOLDOWN) return null;
    if (!s.keepOf(TEAM.PLAYER)) return null;
    for (const k of ['worker', 'soldier']) this.lost[k] = this.lost[k].filter(t0 => now - t0 < WINDOW);
    const res = s.economy.res;
    const poor = res.gold < 80 && res.wood < 100;
    if (!poor) return null;
    const keep = s.keepOf(TEAM.PLAYER);
    const training = keep.queue.some(q => q === 'worker');
    const lw = this.lost.worker.length, aw = this.mine('worker');
    if (!training && lw >= 3) return 'worker';
    const ls = this.lost.soldier.length, as = this.mine('soldier');
    if (ls >= 5 && as <= 3) return 'soldier';
    return null;
  }

  // a quiet moment: nobody attacking the keep, and the player isn't in the middle of something
  calm() {
    const s = this.s, keep = s.keepOf(TEAM.PLAYER);
    if (s.placing || s.castMode || s.pendingOrder || s.box) return false;
    if (s.lastHitOnMe && s.simTime - s.lastHitOnMe.t < 6000) return false;
    return !s.units.some(u => u.alive && hostile(u.team, TEAM.PLAYER) && u.def.damage && Math.hypot(u.x - keep.x, u.y - keep.y) < TILE * 12);
  }

  rewardOf(why) {
    return why === 'soldier'
      ? { soldiers: 3, gold: 200, wood: 150, text: t('3 جنود + 200 ذهب + 150 خشب') }
      : { workers: 5, gold: 200, wood: 150, text: t('5 عمال + 200 ذهب + 150 خشب') };
  }

  show(why) {
    const el = $('adoffer');
    this.open = { why, reward: this.rewardOf(why) };
    this.offers++; this.lastOffer = this.s.simTime;
    el.innerHTML = `<div class="ao-title">⚠️ ${t('مملكتك في خطر!')}</div>
      <p>${t('شاهد إعلاناً قصيراً واحصل على')}:</p>
      <div class="ao-gift">🎁 ${this.open.reward.text}</div>
      <div class="ao-btns"><button class="ao-yes" data-ao="yes">🎬 ${t('شاهد')}</button><button class="ao-no" data-ao="no">✕ ${t('لا شكراً')}</button></div>
      <i class="ao-timer"></i>`;
    el.classList.remove('hidden', 'out');
    sfx.ui('msg');
    clearTimeout(this.hideT);
    this.hideT = setTimeout(() => this.close(true), SHOW_FOR);
  }

  // closing without watching counts as a "no thanks"
  close(declined) {
    clearTimeout(this.hideT);
    if (declined) this.declines++;
    const el = $('adoffer');
    el.classList.add('out');
    setTimeout(() => { el.classList.add('hidden'); el.classList.remove('out'); }, 300);
    this.open = null;
  }

  note(text) {
    const el = $('adoffer');
    el.innerHTML = `<div class="ao-note">${text}</div>`;
    el.classList.remove('hidden', 'out');
    clearTimeout(this.hideT);
    this.hideT = setTimeout(() => this.close(false), 3200);
  }

  async tap(e) {
    const b = e.target.closest('[data-ao]');
    if (!b || !this.open) return;
    if (b.dataset.ao === 'no') return this.close(true);
    const offer = this.open, s = this.s;
    clearTimeout(this.hideT);
    this.declines = 0;
    const r = await ads.showRewarded();            // pauses the battle and its sounds while it plays
    if (r === 'rewarded') { s.adWatched = true; this.give(offer.reward); this.open = null; this.note(`✅ ${t('وصلت المكافأة!')} ${offer.reward.text}`); }
    else if (r === 'closed') { this.open = null; this.note(`😕 ${t('أُغلق الإعلان قبل نهايته، لا مكافأة هذه المرة')}`); }
    else {
      // no ad to show (offline...): doesn't count, may be offered again a bit later
      this.offers--; this.lastOffer = s.simTime - COOLDOWN + 90000;
      this.open = null; this.note(`📡 ${t('لا يوجد إعلان الآن، حاول لاحقاً')}`);
    }
  }

  give(rw) {
    const s = this.s, keep = s.keepOf(TEAM.PLAYER);
    if (!keep) return;
    s.economy.add('gold', rw.gold); s.economy.add('wood', rw.wood);
    const kinds = rw.workers ? Array(rw.workers).fill('worker') : ['swordsman', 'spearman', 'bowman'];
    kinds.forEach((k, i) => s.time.delayedCall(i * 180, () => {
      const spot = s.freeTileNear(keep);
      if (!spot) return;
      const u = s.spawnUnit(k, TEAM.PLAYER, spot.x, spot.y);
      s.fx?.emit('sparkle', u.x, u.y - 4, 4);
      if (k === 'worker') u.autoAssign?.();
    }));
    s.fx?.upgradeGlow?.(TEAM.PLAYER);
    sfx.ui('done');
  }
}

export const adOffer = new AdOffer();
