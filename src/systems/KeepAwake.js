// =====================================================================
//  Keep the screen on during a battle only (menus let the phone sleep as usual).
//  Android app: the @capacitor-community/keep-awake plugin (see ANDROID_ADS.md).
//  Browser: the Screen Wake Lock API when there is one. Nothing happens otherwise.
// =====================================================================
let lock = null, wanted = false;
import { nativePlugin } from './Native.js';

const plugin = () => nativePlugin('KeepAwake');

async function apply() {
  const P = plugin();
  try {
    if (P) { await (wanted ? P.keepAwake() : P.allowSleep()); return; }
    if (wanted && !lock && navigator.wakeLock && document.visibilityState === 'visible') {
      lock = await navigator.wakeLock.request('screen');
      lock.addEventListener?.('release', () => { lock = null; });
    } else if (!wanted && lock) { await lock.release(); lock = null; }
  } catch (e) { lock = null; }
}

export const keepAwake = {
  on() { wanted = true; apply(); },
  off() { wanted = false; apply(); },
};

// the browser drops the lock when the app is hidden: take it again on return
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && wanted) apply(); });
