// =====================================================================
//  Languages: Arabic (the game is written in it) and English.
//
//  Every Arabic text in the code goes through t('...'). In Arabic it is
//  returned as it is; in English it is looked up in EN (lang/en.js).
//  The language is read once at start-up (changing it reloads the game),
//  so data tables can call t() when they are defined.
// =====================================================================
import { EN } from './lang/en.js';

const KEY = 'mk.lang';
const read = () => { try { return localStorage.getItem(KEY) === 'en' ? 'en' : 'ar'; } catch (e) { return 'ar'; } };
export const LANG = read();
export const isEn = LANG === 'en';

const DIGITS = { '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9' };
const missing = new Set();

export function t(s, ...args) {
  if (typeof s !== 'string') return s;
  const fill = (x) => args.length ? x.replace(/\{(\d+)\}/g, (m, i) => args[+i] ?? m) : x;
  if (!isEn) return fill(s);
  let out = EN[s];
  if (out === undefined) {
    const k = s.trim();
    out = EN[k] !== undefined ? s.replace(k, EN[k]) : s;
    if (EN[k] === undefined && /[؀-ۿ]/.test(s)) missing.add(s);
  }
  return fill(out.replace(/[٠-٩]/g, d => DIGITS[d]));
}

export function setLang(l) {
  try { localStorage.setItem(KEY, l); } catch (e) { /* no storage */ }
  location.reload();
}

// text written straight into index.html (pause box, loading screen...)
export function translatePage(root = document.body) {
  if (!isEn) return;
  document.documentElement.lang = 'en';
  document.documentElement.dir = 'ltr';
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) if (/[؀-ۿ]/.test(n.nodeValue)) n.nodeValue = t(n.nodeValue);
  for (const el of root.querySelectorAll('[aria-label]')) el.setAttribute('aria-label', t(el.getAttribute('aria-label')));
  document.title = 'Mini Kingdom';
}

window.__i18n = { missing, LANG };
