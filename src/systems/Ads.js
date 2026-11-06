// =====================================================================
//  Ads for the web game — ready for Google AdSense (H5 Games Ads).
//
//  Today: NO ads at all (AdMob was removed when the game became a web game).
//  Every ad spot in the game still calls this file, so turning ads on later
//  only needs your AdSense ids below:
//
//    ADSENSE.client      your publisher id, e.g. 'ca-pub-1234567890123456'
//    ADSENSE.bannerSlot  (optional) a display ad unit id for the menu banner
//    ADSENSE.test        true while testing (Google shows test ads), false when live
//
//  Until ADSENSE.client is set:
//    * full-screen ads are skipped silently
//    * the "watch an ad for a reward" buttons are hidden
//    * no banner, nothing is loaded from Google
//
//  Rules (never annoying), kept from the app:
//    * nothing in the first 2 minutes after the game is opened
//    * banners only in menus / the pause and game-over boxes, never while playing
//    * full-screen ads:
//        - once before the first battle after the game is opened
//        - at the end of every campaign stage (won or lost)
//        - at the end of every 2nd direct (custom) battle
//      never two within 60 s of each other
//    * the game and its sounds pause while an ad plays
// =====================================================================

export const ADSENSE = {
  client: null,          // ← 'ca-pub-…' : put your AdSense publisher id here to turn ads on
  bannerSlot: null,      // ← optional banner ad unit id (menus only)
  test: true,            // ← false when your game is approved and live
};

const QUIET_START = 2 * 60000;        // no ads right after opening the game
const INTER_GAP = 60000;              // never two full-screen ads this close together
const DIRECT_EVERY = 2;               // direct battles between two full-screen ads

class Ads {
  constructor() {
    this.start = performance.now();
    this.ready = false; this.busy = false;
    this.wantBanner = false; this.bannerOn = false;
    this.battles = 0; this.directSince = 0; this.lastInter = -1e9; this.startShown = false;
    this.privacyRequired = false;      // AdSense shows Google's own consent message (set up in AdSense → Privacy & messaging)
    setInterval(() => this.syncBanner(), 5000);   // a banner asked for during the quiet start shows up later
  }

  get enabled() { return !!ADSENSE.client; }
  get quiet() { return performance.now() - this.start < QUIET_START; }
  // the "🎬 watch an ad" buttons show only when ads exist
  get canReward() { return this.enabled && this.ready; }

  init() {
    if (!this.enabled || this.loading) return;
    this.loading = true;
    const s = document.createElement('script');
    s.async = true;
    s.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' + encodeURIComponent(ADSENSE.client);
    s.crossOrigin = 'anonymous';
    s.dataset.adClient = ADSENSE.client;
    if (ADSENSE.test) s.dataset.adbreakTest = 'on';
    s.onerror = () => { this.loading = false; };     // blocked / offline: the game simply has no ads
    document.head.appendChild(s);
    window.adsbygoogle = window.adsbygoogle || [];
    window.adBreak = window.adConfig = (o) => window.adsbygoogle.push(o);
    window.adConfig({ preloadAdBreaks: 'on', sound: 'on', onReady: () => { this.ready = true; } });
  }

  // nothing to show here: AdSense's own consent message handles privacy
  async showPrivacy() {}

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

  // runs one AdSense ad break; resolves with Google's placement info when it's over
  adBreak(opts) {
    return new Promise((resolve) => {
      let done = false;
      const end = (info) => { if (done) return; done = true; clearTimeout(guard); resolve(info || { breakStatus: 'timeout' }); };
      const guard = setTimeout(() => end(), 90000);        // never leave the game frozen
      try {
        window.adBreak({
          ...opts,
          beforeAd: () => { this.freeze(); },
          afterAd: () => { this.thaw(); },
          adBreakDone: (info) => { this.thaw(); end(info); },
        });
      } catch (e) { end({ breakStatus: 'error' }); }
    });
  }

  // ================= BANNER (menus only) =================
  banner(on) { this.wantBanner = on; this.syncBanner(); }

  syncBanner() {
    const show = this.wantBanner && !this.quiet && !this.busy && this.enabled && !!ADSENSE.bannerSlot;
    if (show === this.bannerOn) return;
    this.bannerOn = show;
    document.body.classList.toggle('has-banner', show);
    let el = document.getElementById('adbanner');
    if (show && !el) {
      el = document.createElement('div'); el.id = 'adbanner';
      el.innerHTML = `<ins class="adsbygoogle" style="display:inline-block;width:320px;height:50px" data-ad-client="${ADSENSE.client}" data-ad-slot="${ADSENSE.bannerSlot}"></ins>`;
      document.body.appendChild(el);
      try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch (e) { /* no banner */ }
    }
    if (el) el.classList.toggle('hidden', !show);
  }

  syncBannerHidden() {
    if (!this.bannerOn) return;
    this.bannerOn = false; document.body.classList.remove('has-banner');
    document.getElementById('adbanner')?.classList.add('hidden');
  }

  // ================= FULL SCREEN (between battles) =================
  // once, just before the first battle after the game is opened
  async beforeFirstBattle() {
    if (this.startShown) return false;
    this.startShown = true;
    return this.showInterstitialNow('start');
  }

  // a battle ended (or was left half-way). -> true if a full-screen ad is due now:
  // every finished campaign stage, every 2nd direct battle
  battleEnded(campaign, finished = true) {
    this.battles++;
    if (!this.enabled) return false;
    if (campaign) return finished;
    if (++this.directSince < DIRECT_EVERY) return false;
    this.directSince = 0;
    return true;
  }

  // a full-screen ad now (if none in the last minute); resolves when it's gone. -> true if one was shown
  async showInterstitialNow(type = 'next') {
    if (!this.canReward || this.busy || performance.now() - this.lastInter < INTER_GAP) return false;
    this.busy = true; this.syncBannerHidden();
    try {
      const info = await this.adBreak({ type, name: type === 'start' ? 'before-battle' : 'after-battle' });
      const ok = info.breakStatus === 'viewed';
      if (ok) this.lastInter = performance.now();
      return ok;
    } finally { this.thaw(); this.busy = false; this.syncBanner(); }
  }

  // ================= REWARDED =================
  // -> 'rewarded' | 'closed' (closed before the end) | 'unavailable'
  async showRewarded() {
    if (!this.canReward || this.busy) return 'unavailable';
    this.busy = true; this.syncBannerHidden();
    let result = 'unavailable';
    try {
      await this.adBreak({
        type: 'reward', name: 'reward',
        beforeReward: (showAdFn) => { showAdFn(); },     // the player already tapped "watch"
        adViewed: () => { result = 'rewarded'; },
        adDismissed: () => { result = 'closed'; },
      });
      return result;
    } finally { this.thaw(); this.busy = false; this.syncBanner(); }
  }
}

export const ads = new Ads();
ads.init();
window.__ads = ads;
