// =====================================================================
//  Ads (AdMob through Capacitor): banner, interstitial (full screen) and rewarded.
//
//  In the Android app (Capacitor + @capacitor-community/admob) the real plugin
//  is used; everywhere else (the browser, while testing) look-alike TEST ads are
//  drawn on the page, so every placement can be tried before building the app.
//  Until you send your own ids, Google's official TEST ad units are used.
//  See ANDROID_ADS.md.
//
//  Rules (never annoying):
//    * nothing in the first 2 minutes after the game is opened
//    * banners only in menus / the pause and game-over boxes, never while playing
//    * full-screen ads (your own unit):
//        - once before the first battle after the game is opened
//        - at the end of every campaign stage (won or lost)
//        - at the end of every 2nd direct (custom) battle
//      never two within 60 s of each other
//    * the game and its sounds pause while a full-screen or rewarded ad plays
// =====================================================================
import { t } from '../i18n.js';

export const AD_CONFIG = {
  appId: 'ca-app-pub-9600707427827471~9678181409',          // goes in AndroidManifest.xml
  // Google's TEST units (Android). Replace with yours (they look like ca-app-pub-XXXX/YYYY).
  bannerId: 'ca-app-pub-3940256099942544/6300978111',
  interstitialId: 'ca-app-pub-9600707427827471/7563988102',     // yours ("regular" ad): before the first battle / after stages
  rewardedId: 'ca-app-pub-9600707427827471/8904989931',         // yours: rewarded
  testing: true,                                             // false only for the store release
};

const QUIET_START = 2 * 60000;        // no ads right after opening the game
const INTER_GAP = 60000;              // never two full-screen ads this close together
const DIRECT_EVERY = 2;               // direct battles between two full-screen ads

import { nativePlugin } from './Native.js';

const plugin = () => nativePlugin('AdMob');
const listen = (A, name, fn) => Promise.resolve(A.addListener(name, fn));

class Ads {
  constructor() {
    this.start = performance.now();
    this.ready = false; this.busy = false;
    this.loaded = { rewarded: false, interstitial: false };
    this.wantBanner = false; this.bannerOn = false;
    this.battles = 0; this.directSince = 0; this.lastInter = -1e9; this.startShown = false;
    setInterval(() => this.syncBanner(), 5000);        // a banner asked for during the quiet start shows up later
  }

  get native() { return !!plugin(); }
  get quiet() { return performance.now() - this.start < QUIET_START; }

  async init() {
    const A = plugin();
    if (!A || this.ready) return;
    try {
      await A.initialize({ initializeForTesting: AD_CONFIG.testing });
      await this.consent(A);
      this.ready = true; this.preload('rewarded'); this.preload('interstitial');
    } catch (e) { console.warn('[ads] init failed', e); }
  }

  // Privacy consent (Google's message, needed for players in Europe / the UK; set it up once in
  // AdMob -> Privacy & messaging). Asked once; elsewhere nothing is shown.
  async consent(A) {
    try {
      let info = await A.requestConsentInfo();
      if (!info.canRequestAds && info.isConsentFormAvailable && info.status === 'REQUIRED') info = await A.showConsentForm();
      this.privacyRequired = info.privacyOptionsRequirementStatus === 'REQUIRED';
    } catch (e) { /* no consent message set up: ads still load */ }
  }

  // the settings button "privacy options" (only where the law needs it)
  async showPrivacy() {
    try { await plugin()?.showPrivacyOptionsForm(); } catch (e) { /* nothing to show */ }
  }

  async preload(kind) {
    const A = plugin();
    if (!A || this.loaded[kind]) return;
    try {
      if (kind === 'rewarded') await A.prepareRewardVideoAd({ adId: AD_CONFIG.rewardedId, isTesting: AD_CONFIG.testing });
      else await A.prepareInterstitial({ adId: AD_CONFIG.interstitialId, isTesting: AD_CONFIG.testing });
      this.loaded[kind] = true;
    } catch (e) { this.loaded[kind] = false; }
  }

  // ---------------- pause the battle while an ad covers the screen ----------------
  freeze() {
    const g = window.game, sc = g?.scene;
    this.froze = !!(sc?.isActive('Game'));
    if (this.froze) sc.pause('Game');
    g?.sound?.pauseAll();
  }
  thaw() {
    const g = window.game;
    if (this.froze) g.scene.resume('Game');
    this.froze = false;
    g?.sound?.resumeAll();
  }

  // ================= BANNER =================
  // menus call banner(true), the battle calls banner(false)
  banner(on) { this.wantBanner = on; this.syncBanner(); }

  async syncBanner() {
    const show = this.wantBanner && !this.quiet && !this.busy;
    if (show === this.bannerOn) return;
    this.bannerOn = show;
    document.body.classList.toggle('has-banner', show);
    const A = plugin();
    if (A) {
      try {
        if (show) await A.showBanner({ adId: AD_CONFIG.bannerId, adSize: 'ADAPTIVE_BANNER', position: 'BOTTOM_CENTER', margin: 0, isTesting: AD_CONFIG.testing });
        else await A.hideBanner();
      } catch (e) { /* no banner right now */ }
      return;
    }
    // browser: a look-alike test banner
    let el = document.getElementById('testbanner');
    if (show && !el) {
      el = document.createElement('div'); el.id = 'testbanner';
      el.innerHTML = `<span class="tb-tag">Ad</span><b>${t('بانر تجريبي')}</b><small>Test Ad · 320×50</small>`;
      document.body.appendChild(el);
    }
    if (el) el.classList.toggle('hidden', !show);
  }

  // ================= INTERSTITIAL (full screen) =================
  // once, just before the first battle after the game is opened
  async beforeFirstBattle() {
    if (this.startShown) return false;
    this.startShown = true;
    return this.showInterstitialNow();
  }

  // a battle ended (or was left half-way). -> true if a full-screen ad is due now:
  // every finished campaign stage, every 2nd direct battle
  battleEnded(campaign, finished = true) {
    this.battles++;
    if (campaign) return finished;
    if (++this.directSince < DIRECT_EVERY) return false;
    this.directSince = 0;
    return true;
  }

  // a full-screen ad now (if none was shown in the last minute); resolves when it's gone
  async showInterstitialNow() {
    if (this.busy || performance.now() - this.lastInter < INTER_GAP) return false;
    this.busy = true; this.syncBannerHidden();
    this.freeze();
    try {
      const ok = this.native ? await this.showInterNative() : await this.showInterTest();
      if (ok) this.lastInter = performance.now();
      return ok;
    } finally { this.thaw(); this.busy = false; this.syncBanner(); }
  }

  syncBannerHidden() { if (this.bannerOn) { this.bannerOn = false; document.body.classList.remove('has-banner'); document.getElementById('testbanner')?.classList.add('hidden'); plugin()?.hideBanner?.().catch?.(() => {}); } }

  async showInterNative() {
    const A = plugin();
    if (!this.ready) await this.init();
    if (!this.loaded.interstitial) await this.preload('interstitial');
    if (!this.loaded.interstitial) return false;
    const subs = [];
    const gone = new Promise(res => { subs.push(listen(A, 'interstitialAdDismissed', res)); subs.push(listen(A, 'interstitialAdFailedToShow', res)); });
    try { this.loaded.interstitial = false; await A.showInterstitial(); await Promise.race([gone, new Promise(r => setTimeout(r, 60000))]); }
    catch (e) { /* failed to show */ }
    (await Promise.all(subs)).forEach(s => s?.remove?.());
    this.preload('interstitial');
    return true;
  }

  // browser: full-screen test ad, "skip" after 5 s
  showInterTest() {
    return new Promise((resolve) => {
      const el = document.createElement('div');
      el.id = 'testad'; el.className = 'inter';
      el.innerHTML = `<div class="ta-box"><span class="tb-tag">Ad</span><b>🖼️ ${t('إعلان كامل تجريبي')}</b><p>${t('في تطبيق الأندرويد يظهر هنا إعلان AdMob حقيقي')}</p>
        <div class="ta-count">5</div><button class="ta-close" disabled>${t('تخطَّ الإعلان')} ›</button></div>`;
      document.body.appendChild(el);
      let n = 5;
      const btn = el.querySelector('.ta-close'), cnt = el.querySelector('.ta-count');
      const tick = setInterval(() => { n--; cnt.textContent = n > 0 ? n : ''; if (n <= 0) { clearInterval(tick); btn.disabled = false; } }, 1000);
      btn.onclick = () => { clearInterval(tick); el.remove(); resolve(true); };
    });
  }

  // ================= REWARDED =================
  // -> 'rewarded' | 'closed' (closed before the end) | 'unavailable'
  async showRewarded() {
    if (this.busy) return 'unavailable';
    this.busy = true; this.syncBannerHidden();
    this.freeze();
    try { return this.native ? await this.showRewardNative() : await this.showRewardTest(); }
    finally { this.thaw(); this.busy = false; this.syncBanner(); }
  }

  async showRewardNative() {
    const A = plugin();
    if (!this.ready) await this.init();
    if (!this.loaded.rewarded) await this.preload('rewarded');
    if (!this.loaded.rewarded) return 'unavailable';
    let rewarded = false;
    const subs = [];
    const gone = new Promise((res) => {
      subs.push(listen(A, 'onRewardedVideoAdReward', () => { rewarded = true; }));
      subs.push(listen(A, 'onRewardedVideoAdDismissed', res));
      subs.push(listen(A, 'onRewardedVideoAdFailedToShow', res));
    });
    try {
      this.loaded.rewarded = false;
      const r = await A.showRewardVideoAd();
      if (r && (r.amount !== undefined || r.type)) rewarded = true;
      await Promise.race([gone, new Promise(r2 => setTimeout(r2, 1500))]);
    } catch (e) { (await Promise.all(subs)).forEach(s => s?.remove?.()); this.preload('rewarded'); return 'unavailable'; }
    (await Promise.all(subs)).forEach(s => s?.remove?.());
    this.preload('rewarded');
    return rewarded ? 'rewarded' : 'closed';
  }

  // browser: a 5 s test video; closing it early gives nothing
  showRewardTest() {
    return new Promise((resolve) => {
      if (navigator.onLine === false) return resolve('unavailable');
      const el = document.createElement('div');
      el.id = 'testad';
      el.innerHTML = `<div class="ta-box"><span class="tb-tag">Ad</span><b>🎬 ${t('إعلان مكافأة تجريبي')}</b><p>${t('في تطبيق الأندرويد يظهر هنا إعلان AdMob حقيقي')}</p>
        <div class="ta-count">5</div><button class="ta-close">✕ ${t('إغلاق الآن (بدون مكافأة)')}</button></div>`;
      document.body.appendChild(el);
      let n = 5;
      const tick = setInterval(() => {
        n--;
        el.querySelector('.ta-count').textContent = n > 0 ? n : '✓';
        if (n <= 0) { clearInterval(tick); setTimeout(() => { el.remove(); resolve('rewarded'); }, 400); }
      }, 1000);
      el.querySelector('.ta-close').onclick = () => { clearInterval(tick); el.remove(); resolve('closed'); };
    });
  }
}

export const ads = new Ads();
ads.init();
window.__ads = ads;
