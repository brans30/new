// =====================================================================
//  Install the web game on the home screen (PWA) + play offline.
//    * sw.js keeps every game file on the phone after the first visit
//    * Android / desktop Chrome: our own "📲 Install" button (beforeinstallprompt)
//    * iPhone / iPad Safari: no install prompt exists, so we show how
//      (Share ⬆️ → Add to Home Screen)
//    * browser full screen for players who don't install
// =====================================================================
let deferred = null;
const listeners = new Set();
const changed = () => listeners.forEach(f => { try { f(); } catch (e) {} });

export const pwa = {
  // opened from the home-screen icon?
  installed() {
    return window.matchMedia?.('(display-mode: standalone)').matches || window.matchMedia?.('(display-mode: fullscreen)').matches || navigator.standalone === true;
  },
  isIOS() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  },
  canInstall() { return !this.installed() && (!!deferred || this.isIOS()); },
  // -> 'accepted' | 'dismissed' | 'ios' (show the Share → Add to Home Screen hint) | 'none'
  async install() {
    if (deferred) {
      const d = deferred; deferred = null;
      try { d.prompt(); const r = await d.userChoice; changed(); return r?.outcome || 'dismissed'; }
      catch (e) { changed(); return 'none'; }
    }
    return this.isIOS() ? 'ios' : 'none';
  },
  onChange(f) { listeners.add(f); return () => listeners.delete(f); },

  // ---- full screen in the browser (the installed game is already full screen) ----
  canFullscreen() { return !this.installed() && !!document.documentElement.requestFullscreen && document.fullscreenEnabled !== false; },
  isFullscreen() { return !!document.fullscreenElement; },
  async toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    } catch (e) { /* not allowed here */ }
  },
};

window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; changed(); });
window.addEventListener('appinstalled', () => { deferred = null; changed(); });

// offline cache (only on a real web address: https, or localhost while testing)
if ('serviceWorker' in navigator && (location.protocol === 'https:' || /[?&]sw=1/.test(location.search))) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
}
window.__pwa = pwa;
