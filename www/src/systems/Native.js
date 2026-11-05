// =====================================================================
//  The Android app (Capacitor). Everything here does nothing in a browser.
//
//   * nativePlugin(name)  the native plugin (AdMob, KeepAwake, App), or null
//   * Android back button:
//       battle          -> opens / closes the pause box
//       a menu screen   -> back to the previous screen
//       the title       -> the app goes to the background (it isn't killed)
//       while an ad shows nothing happens (the ad handles it)
//   * the app going to the background pauses the battle (see Hud: 'app-pause')
// =====================================================================
const cache = {};

export const isNative = () => !!window.Capacitor?.isNativePlatform?.();

export function nativePlugin(name) {
  if (!isNative()) return null;
  if (cache[name] !== undefined) return cache[name];
  const C = window.Capacitor;
  let p = null;
  try { p = C.Plugins?.[name] || C.registerPlugin?.(name) || null; } catch (e) { p = null; }
  return (cache[name] = p);
}

const $ = (id) => document.getElementById(id);
// (fixed boxes have no offsetParent, so look at what is actually drawn)
const visible = (el) => !!el && !el.classList.contains('hidden') && el.getClientRects().length > 0;
const shown = (id) => visible($(id));

function onBack() {
  if (document.getElementById('testad')) return;              // a (test) ad is on screen
  if (document.body.classList.contains('in-game')) {
    if (shown('over')) return;                                 // the result box: use its buttons
    if (shown('pause')) $('p-resume')?.click();
    else $('menubtn')?.click();
    return;
  }
  const back = document.getElementById('m-back');
  if (visible(back)) { back.click(); return; }
  nativePlugin('App')?.minimizeApp?.();
}

export function initNative() {
  if (!isNative()) return;
  document.body.classList.add('native');
  if (window.APP_ENV === 'test') document.body.classList.add('env-test');     // the TEST badge (your test app only; testers' beta has none)
  const App = nativePlugin('App');
  if (!App) return;
  try {
    App.addListener('backButton', onBack);
    App.addListener('pause', () => document.dispatchEvent(new Event('app-pause')));
  } catch (e) { console.warn('[native] listeners', e); }
}
