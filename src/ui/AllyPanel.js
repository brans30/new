import { TEAM, KINGDOMS } from '../data/config.js';
import { icon } from './Hud.js';
import { sfx } from '../systems/Sound.js';
import { t } from '../i18n.js';

// =====================================================================
//  The small allies panel on the right edge of the screen.
//  A tab with an arrow opens / closes it. Only shown when you have allies.
//    top     : who you talk to (each ally, or all of them)
//    buttons : attack with me · defend me · ask for / send gold, wood, stone
//    below   : the last messages; an ally's request has its own buttons
// =====================================================================
const $ = (id) => document.getElementById(id);
const store = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* */ } } };
const res = (i) => `<span class="icon resi" style="--i:${i}"></span>`;

class AllyPanel {
  attach(scene) {
    this.s = scene;
    this.to = 'all';
    this.open = store.get('mk.allies.open') !== '0';
    this.unread = 0;
    const el = $('allies');
    const on = (m) => { if (m && m.from !== TEAM.PLAYER) { if (!this.open) this.unread++; sfx.ui('msg'); } this.render(); };
    scene.events.on('diplo', on);
    scene.events.on('kingdoms', () => this.render());
    scene.events.once('shutdown', () => { scene.events.off('diplo', on); el.classList.add('hidden'); });
    el.onclick = (e) => this.tap(e);
    this.render();
  }

  tap(e) {
    const b = e.target.closest('button');
    if (!b) return;
    const d = this.s.diplo, a = b.dataset;
    if (a.toggle !== undefined) { this.open = !this.open; this.unread = 0; store.set('mk.allies.open', this.open ? '1' : '0'); }
    else if (a.to) this.to = a.to;
    else if (a.cmd === 'attack') d.askAttack(this.to);
    else if (a.cmd === 'defend') d.askDefend(this.to);
    else if (a.ask) d.askResource(this.to, a.ask);
    else if (a.give) { if (!d.give(this.to, a.give)) { b.classList.remove('nope'); void b.offsetWidth; b.classList.add('nope'); sfx.ui('nope'); return; } }
    else if (a.msg) { const m = d.log.find(x => x.id === +a.msg); if (m) d.resolve(m, +a.act); }
    this.render();
  }

  render() {
    const el = $('allies'), d = this.s?.diplo;
    const allies = d ? d.allies() : [];
    el.classList.toggle('hidden', !allies.length);
    if (!allies.length) return;
    if (this.to !== 'all' && !allies.includes(this.to)) this.to = 'all';
    el.classList.toggle('open', this.open);
    const badge = this.unread ? `<b class="al-badge">${this.unread}</b>` : '';
    const tab = `<button class="al-tab" data-toggle aria-label="${t('الحلفاء')}">🤝${badge}<i>${this.open ? '›' : '‹'}</i></button>`;
    if (!this.open) { el.innerHTML = tab; return; }
    const who = allies.length > 1 ? `<div class="al-who">
        <button class="${this.to === 'all' ? 'on' : ''}" data-to="all">${t('الكل')}</button>
        ${allies.map(a => `<button class="${this.to === a ? 'on' : ''}" data-to="${a}" style="--k:${KINGDOMS[a].css}">${icon(`keep_${a}`, 0, 18)}</button>`).join('')}
      </div>` : `<div class="al-name" style="--k:${KINGDOMS[allies[0]].css}">${icon(`keep_${allies[0]}`, 0, 20)}<b>${KINGDOMS[allies[0]].short}</b></div>`;
    const msgs = d.log.slice(innerHeight < 520 ? -2 : -3).map(m => {
      const mine = m.from === TEAM.PLAYER;
      const acts = m.actions ? `<div class="al-acts">${m.actions.map((x, i) => `<button data-msg="${m.id}" data-act="${i}" class="${i ? 'no' : 'yes'}">${x.label}</button>`).join('')}</div>` : '';
      return `<div class="al-msg ${mine ? 'me' : ''}" style="--k:${KINGDOMS[m.from].css}">${mine ? '' : `<em>${KINGDOMS[m.from].short}</em>`}<span>${m.text}</span>${acts}</div>`;
    }).join('');
    el.innerHTML = `${tab}
      <div class="al-box">
        ${who}
        <div class="al-cmds">
          <button data-cmd="attack">⚔️<small>${t('هاجم معي')}</small></button>
          <button data-cmd="defend">🛡<small>${t('دافع عني')}</small></button>
        </div>
        <div class="al-row"><label>${t('اطلب')}</label>${['gold', 'wood', 'stone'].map((r, i) => `<button data-ask="${r}">${res(i)}</button>`).join('')}</div>
        <div class="al-row"><label>${t('أرسل')}</label>${['gold', 'wood', 'stone'].map((r, i) => `<button data-give="${r}">${res(i)}<small>100</small></button>`).join('')}</div>
        <div class="al-log">${msgs || `<p class="al-empty">${t('لا رسائل بعد')}</p>`}</div>
      </div>`;
    const log = el.querySelector('.al-log');
    if (log) log.scrollTop = log.scrollHeight;          // newest message (and its buttons) in view
  }
}

export const allyPanel = new AllyPanel();
