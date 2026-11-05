import { t } from '../i18n.js';
import { BUILD_TABS, UNITS, BUILDINGS, TEAM, TEAMS, KINGDOMS, unitName, unitDesc, buildingName, canTrainKind, RES_ICON, BUILD_MENU, RESOURCES, UPGRADES, MARKET, upLevel, UP_LEVEL3_NEEDS } from '../data/config.js';
import { relation } from '../systems/Match.js';
import { menu } from './Menu.js';
import { minimap } from './Minimap.js';
import { loading } from './Loading.js';
import { FORMATIONS } from '../systems/Tactics.js';
import { Building } from '../entities/Building.js';
import { Worker } from '../entities/Worker.js';
import { Soldier } from '../entities/Soldier.js';
import { sfx } from '../systems/Sound.js';
import { MATCH } from '../systems/Match.js';
import { STAGES, stageById } from '../data/campaign.js';
import { allyPanel } from './AllyPanel.js';
import { skillBar } from './SkillBar.js';
import { adOffer } from './AdOffer.js';
import { ads } from '../systems/Ads.js';

// HTML user interface on top of the game canvas.
// Uses plain DOM (easy to style, Arabic text works out of the box).
// It only talks to GameScene through its public methods and events.
const $ = (id) => document.getElementById(id);

const RES_INDEX = { gold: 0, wood: 1, stone: 2 };

// cost as little pixel-icon pills; each pill turns red when we can't pay that part
const costPills = (cost = {}, per = '') => `<span class="cost">${Object.entries(cost).map(([k, v]) =>
  `<span class="c" data-k="${k}" data-v="${v}"><i style="--i:${RES_INDEX[k]}"></i>${v}</span>`).join('')}${per ? `<span class="per">/${per}</span>` : ''}</span>`;

// little pixel-art icon cut from a sprite sheet (sizes recorded by BootScene)
export function icon(sheet, frame, size = 26) {
  const s = window.__sheets[sheet];
  const cols = s.w / s.frame;
  const fx = (frame % cols) * s.frame, fy = Math.floor(frame / cols) * s.frame;
  const k = size / s.frame;
  return `<span class="icon" style="width:${size}px;height:${size}px;background-image:url(assets/${s.file});
    background-size:${s.w * k}px ${s.h * k}px;background-position:-${fx * k}px -${fy * k}px"></span>`;
}
// blacksmith upgrade pictures (assets/ui/upgrades.png, 32 px each)
export const upIcon = (key, size = 26) => `<span class="icon upic" style="width:${size}px;height:${size}px;background-size:${size * 6}px ${size}px;background-position:-${(UPGRADES[key]?.icon || 0) * size}px 0"></span>`;
const pips = (n, max) => `<i class="pips">${'●'.repeat(n)}${'○'.repeat(max - n)}</i>`;
const unitIcon = (kind, team = TEAM.PLAYER, size) => {
  if (kind.startsWith('up:')) return upIcon(kind.split(':')[1], size || 26);
  return icon(`${UNITS[kind].sprite}_${team}`, 0, size);
};
const buildingIcon = (kind, team = TEAM.PLAYER, size) => {
  const d = BUILDINGS[kind];
  return icon(d.sheet.replace('{team}', team), kind === 'wall' ? 10 : d.frame, size);
};
// remembered between games (per player, in this browser only)
const store = {
  get(k, d) { try { return localStorage.getItem(k) ?? d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* no storage */ } },
};

export class Hud {
  attach(scene) {
    this.scene = scene;
    const ev = scene.events;
    const onSel = () => this.render();
    const onToast = (m) => this.toast(m);
    const onOver = (won, survived) => this.gameOver(won, survived);
    const onEco = () => this.refresh();
    ev.on('selection', onSel); ev.on('placing', onSel);
    ev.on('toast', onToast); ev.on('gameover', onOver);
    const onKing = () => this.renderKingdoms();
    ev.on('kingdoms', onKing);
    scene.economy.on('changed', onEco);
    // the app goes to the background (home button, a call...): pause the battle
    const onHide = (e) => {
      if ((e?.type !== 'app-pause' && document.visibilityState !== 'hidden') || scene.over || ads.busy || !scene.sys.isActive()) return;
      $('menubtn').onclick?.();
    };
    document.addEventListener('visibilitychange', onHide);
    document.addEventListener('app-pause', onHide);              // the Android app went to the background
    ev.once('shutdown', () => {
      document.removeEventListener('visibilitychange', onHide);
      document.removeEventListener('app-pause', onHide);
      ev.off('selection', onSel); ev.off('placing', onSel);
      ev.off('toast', onToast); ev.off('gameover', onOver); ev.off('kingdoms', onKing);
    });
    document.body.classList.add('in-game');
    $('pause').classList.add('hidden');
    this.bindMenu();
    this.renderKingdoms();
    minimap.attach(scene);
    allyPanel.attach(scene);
    skillBar.attach(scene);
    adOffer.attach(scene);
    if (!document.getElementById('loading').classList.contains('hidden')) loading.done();     // the battle is ready
    this.bindTopBar();
    clearInterval(this.timer);
    this.timer = setInterval(() => this.tick(), 250);
    clearTimeout(this.overT);
    $('over').classList.add('hidden');
    this.render();
  }

  // tap a resource = cycle its priority (normal -> high -> off)
  bindTopBar() {
    const names = { gold: t('الذهب'), wood: t('الخشب'), stone: t('الحجر') };
    document.querySelectorAll('#resbar [data-res]').forEach(el => {
      el.onclick = () => {
        const m = this.scene.workerMgr[TEAM.PLAYER];
        const p = m.cyclePriority(el.dataset.res);
        const n = names[el.dataset.res];
        this.toast(p > 1 ? `⬆ ${t('أولوية عالية: عمال أكثر على')} ${n}` : p === 0 ? `⛔ ${t('أوقفت جمع')} ${n}` : `${t('أولوية عادية لـ')}${n}`);
        el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
        this.tick();
      };
    });
  }

  // ---------- top bar + live bits ----------
  refresh() {
    const e = this.scene.economy;
    for (const k of RESOURCES) $(k).textContent = e.res[k];
    $('pop').textContent = `${e.pop}/${e.popCap}`;
    $('popcell').classList.toggle('full', e.pop >= e.popCap);
    document.querySelectorAll('#panel .c').forEach(c => {
      c.classList.toggle('no', (e.res[c.dataset.k] || 0) < +c.dataset.v);
    });
    document.querySelectorAll('#actions .btn[data-cost]').forEach(b => {
      b.classList.toggle('poor', !e.canAfford(JSON.parse(b.dataset.cost)));
    });
  }

  tick() {
    const s = this.scene;
    if (!s?.ai) return;
    // workers per resource (orange = fewer than the manager wants)
    const m = s.workerMgr[TEAM.PLAYER];
    const c = m.counts(), t = m.targets(m.gathererCount());
    for (const k of RESOURCES) {
      const el = $('w-' + k);
      el.textContent = c[k];
      el.classList.toggle('under', c[k] < t[k]);
      const cell = el.parentElement;
      cell.classList.toggle('high', m.priority[k] > 1);
      cell.classList.toggle('off', m.priority[k] === 0);
    }
    const sel = s.selected[0];
    const bar = $('trainbar');
    if (bar && sel instanceof Building) bar.style.width = `${Math.round(sel.trainProgress * 100)}%`;
    const hp = $('hpval');
    if (hp && sel?.alive) hp.textContent = `${Math.ceil(sel.hp)}/${sel.maxHp}`;
    if (sel instanceof Building && !sel.complete && sel.team === TEAM.PLAYER) {
      const sm = $('title').querySelector('small');
      if (sm) sm.textContent = `${t('قيد البناء')} ${Math.round(sel.progress * 100)}%`;
    }
  }

  // ---------- bottom panel ----------
  // one button: { id, label, icon, cost, note, cls }
  // per: "/piece" after the cost (walls) • note: small line under the cost
  btn({ id, label, icon: ic = '', cost = null, note = '', per = '', cls = '', tip = '', badge = '' }) {
    const kind = ic ? 'card' : 'pill';
    return `<button class="btn ${kind} ${cls}" data-act="${id}" ${tip ? `title="${tip}"` : ''} ${cost ? `data-cost='${JSON.stringify(cost)}'` : ''}>
      ${badge ? `<i class="badge">${badge}</i>` : ''}${ic}<span class="lbl">${label}</span>${cost ? costPills(cost, per) : ''}${note ? `<small>${note}</small>` : ''}</button>`;
  }

  render() {
    const s = this.scene, sel = s.selected;
    let title = '', html = '', showTabs = false;
    if (this.tab === undefined) { this.tab = store.get('mk.tab', 'eco'); this.collapsed = store.get('mk.collapsed', '0') === '1'; }
    const actions = {};
    this.holdActions = {};
    const add = (o, fn) => { html += this.btn(o); actions[o.id] = fn; };

    // build menu: one tab at a time (economy / military / defence), small cards,
    // locked ones at the end, how many you own on each card, hold for details,
    // drag a card onto the map to build it there
    const buildButtons = () => {
      showTabs = true;
      const tab = BUILD_TABS[this.tab] ? this.tab : 'eco';
      const owned = (k) => s.buildings.filter(b => b.alive && b.team === TEAM.PLAYER && b.kind === k).length;
      const items = BUILD_TABS[tab].items.map(kind => ({ kind, locked: !!BUILDINGS[kind].requires && !s.hasBuilding(TEAM.PLAYER, BUILDINGS[kind].requires) }))
        .sort((a, b) => a.locked - b.locked);
      for (const { kind, locked } of items) {
        const d = BUILDINGS[kind];
        const nm = buildingName(kind, TEAM.PLAYER);
        const n = d.wall ? 0 : owned(kind);
        if (locked) add({ id: 'build_' + kind, label: nm, icon: buildingIcon(kind, TEAM.PLAYER, 20),
                          note: `🔒 ${buildingName(d.requires, TEAM.PLAYER)}`, cls: 'locked sm' }, () => s.startPlacing(kind));
        else add({ id: 'build_' + kind, label: nm, icon: buildingIcon(kind, TEAM.PLAYER, 20), badge: n ? `×${n}` : '',
                   cost: d.cost, per: kind === 'wall' ? t('قطعة') : '', cls: 'sm' }, () => s.startPlacing(kind));
        this.holdActions['build_' + kind] = (el) => this.showTip(el, { kind, building: true, owned: n, locked });
      }
    };

    if (s.placing === 'wall') {
      const wt = s.wallTool, plan = wt.plan;
      if (wt.stage === 'start') title = t('اضغط على نقطة بداية السور');
      else if (wt.stage !== 'ready') title = t('اضغط على نقطة النهاية');
      else {
        const gates = plan.tiles.filter(t => t.kind === 'gate' && t.status === 'new').length;
        const skipped = plan.tiles.filter(t => t.status === 'blocked').length;
        title = `${t('سور')}: ${plan.count} ${t('قطعة')}${gates ? t(' + بوابة') : ''}${skipped ? `<small>${t('يتخطى')} ${skipped} ${t('محجوب')}</small>` : ''}`;
        add({ id: 'wall_ok', label: t('✔ ابنِ'), cost: plan.cost, cls: 'go' }, () => s.confirmWall());
      }
      add({ id: 'wall_gate', label: wt.autoGate ? t('🚪 بوابة تلقائية') : t('🚪 بدون بوابة'), cls: wt.autoGate ? 'on' : '' }, () => wt.toggleGate());
      if (wt.start) add({ id: 'wall_restart', label: t('↺ من جديد') }, () => s.startPlacing('wall'));
      add({ id: 'cancel', label: t('✕ إلغاء') }, () => s.cancelPlacing());
    } else if (s.placing) {
      title = `${t('اضغط على الخريطة لبناء')} ${buildingName(s.placing, TEAM.PLAYER)}`;
      add({ id: 'cancel', label: t('✕ إلغاء') }, () => s.cancelPlacing());
    } else if (sel.length === 1 && sel[0] instanceof Building) {
      const b = sel[0];
      const mine = b.team === TEAM.PLAYER;
      title = `${mine ? '' : '👹 '}${buildingName(b.kind, b.team)} <span class="hp">❤️ <b id="hpval"></b></span>`;
      if (mine && !b.complete) title += `<small>${t('قيد البناء')} ${Math.round(b.progress * 100)}%</small>`;
      else if (b.def.desc && b.kind !== 'wall' && !b.def.trains) title += `<small>${b.def.desc}</small>`;
      add({ id: 'desel', label: '✕' }, () => s.select([]));
      if (mine && b.complete && b.def.garrison) {
        add({ id: 'bell', label: b.bell ? `✅ ${t('انتهى الخطر')} (${b.garrison})` : t('🔔 ناقوس الخطر'), cls: b.bell ? 'on' : 'warn' },
          () => s.ringBell(TEAM.PLAYER, !b.bell));
      }
      if (mine && b.complete && b.def.research) {
        // one card per upgrade: its own picture, the level reached (●●○), what the next level gives
        for (const key of b.def.research) {
          const up = UPGRADES[key], lvl = upLevel(s.economy, key), n = s.nextUpgrade(TEAM.PLAYER, key);
          const pct = (l) => Math.round(up.values[l - 1] * 100);
          const label = `${up.name} ${pips(lvl, up.max)}`;
          const tip = n.level ? t(up.desc, pct(n.level)) : t(up.desc, pct(up.max));
          if (n.why === 'max') add({ id: 'up_' + key, label, icon: upIcon(key, 22), note: `✅ ${t('الدرجة القصوى')}`, cls: 'done sm up' }, () => {});
          else if (n.why === 'busy') add({ id: 'up_' + key, label, icon: upIcon(key, 22), note: t('جارٍ…'), cls: 'done sm up' }, () => {});
          else if (n.why === 'needs') add({ id: 'up_' + key, label, icon: upIcon(key, 22), note: `🔒 ${buildingName(UP_LEVEL3_NEEDS, TEAM.PLAYER)}`, cls: 'locked sm up' }, () => this.toast(`🔒 ${t('يحتاج')} ${buildingName(UP_LEVEL3_NEEDS, TEAM.PLAYER)}`));
          else add({ id: 'up_' + key, label, icon: upIcon(key, 22), cost: n.cost, cls: 'sm up', note: tip }, () => s.research(b, key));
          this.holdActions['up_' + key] = (el) => this.showUpTip(el, key);
        }
        if (b.queue.length) html += `<div class="queue"><div class="prog"><div id="trainbar"></div></div></div>`;
      }
      if (mine && b.complete && b.def.market) {
        const resIcon = (i) => `<span class="icon resi" style="--i:${i}"></span>`;
        for (const r of ['wood', 'stone']) {
          const n = r === 'wood' ? t('خشب') : t('حجر'), i = r === 'wood' ? 1 : 2;
          add({ id: 'sell_' + r, label: `${t('بيع')} ${n}`, icon: resIcon(i), cost: { [r]: 100 }, note: `← ${MARKET.sell[r]} ${t('ذهب')}` }, () => s.trade(TEAM.PLAYER, r, 'sell'));
          add({ id: 'buy_' + r, label: `${t('شراء')} ${n}`, icon: resIcon(i), cost: { gold: MARKET.buy[r] }, note: `← 100 ${n}` }, () => s.trade(TEAM.PLAYER, r, 'buy'));
        }
        // 🎬 free chest: 250 of the resource you pick, once every 5 minutes
        const wait = Math.max(0, (s.adChestAt || -1e9) + 300000 - s.simTime);
        ['gold', 'wood', 'stone'].forEach((r, i) => {
          const n = r === 'gold' ? t('ذهب') : r === 'wood' ? t('خشب') : t('حجر');
          if (wait) add({ id: 'adbox_' + r, label: `🎬 250 ${n}`, icon: resIcon(i), note: `⏳ ${Math.ceil(wait / 60000)} ${t('د')}`, cls: 'done adbox' }, () => {});
          else add({ id: 'adbox_' + r, label: `🎬 250 ${n}`, icon: resIcon(i), note: t('صندوق مجاني'), cls: 'adbox' }, async () => {
            const res = await ads.showRewarded();
            if (res !== 'rewarded') return this.toast(res === 'closed' ? t('أُغلق الإعلان قبل نهايته') : t('لا يوجد إعلان الآن'));
            s.economy.add(r, 250); s.adChestAt = s.simTime; s.adWatched = true;
            s.fx?.chest(b.x, b.y, r === 'gold'); sfx.ui('coins'); this.render();
          });
        });
      }
      if (mine && b.complete && b.def.trains) {
        if (b.kind === 'tavern') title += `<small>${s.heroOf(TEAM.PLAYER) ? t('لديك بطل الآن') : t('بطل واحد فقط في نفس الوقت')}</small>`;
        else if (!b.queue.length) title += `<small>${b.kind === 'keep' ? t('العمال الجدد يعملون مباشرة ⛏️') : t('المس الأرض لنقطة تجمع 🚩')}</small>`;
        for (const kind of b.def.trains) {
          if (!canTrainKind(kind, b.team)) continue;          // orcs have no guns or siege engines
          const u = UNITS[kind];
          const q = b.queue.filter(k => k === kind).length;
          add({ id: 'train_' + kind, label: unitName(kind, b.team), icon: unitIcon(kind, TEAM.PLAYER, 20), cost: u.cost, tip: unitDesc(kind, b.team), cls: 'unit sm', badge: q ? `+${q}` : '' }, () => s.train(b, kind));
          this.holdActions['train_' + kind] = (el) => this.showTip(el, { kind, building: false, owned: s.units.filter(x => x.alive && x.team === TEAM.PLAYER && x.kind === kind).length });
        }
        if (b.queue.length) {
          html += `<div class="queue">${b.queue.map(k => unitIcon(k, TEAM.PLAYER, 20)).join('')}
                   <div class="prog"><div id="trainbar"></div></div></div>`;
        }
      }
    } else if (sel.length) {
      const w = sel.filter(u => u instanceof Worker).length;
      const so = sel.filter(u => u instanceof Soldier).length;
      const enemy = sel[0].team !== TEAM.PLAYER;
      if (enemy) {
        title = `👹 ${sel[0].kind ? unitName(sel[0].kind, sel[0].team) : sel[0].def.name} ${t('عدو')} <span class="hp">❤️ <b id="hpval"></b></span>`;
      } else {
        title = [w && `${w} ${t('عامل')}`, so && `${so} ${t('جندي')}`].filter(Boolean).join(' + ');
        if (s.selKind) title = `${s.group.length} ${unitName(s.selKind, TEAM.PLAYER)} <small class="sk">${t('من')} ${sel.length}</small>`;
        if (sel.length === 1) title += ` <span class="hp">❤️ <b id="hpval"></b></span>`;
        title += `<small>${w && !so ? t('المس مورداً للجمع') : t('المس الأرض للتحرك بتشكيل')}</small>`;
        if (s.pendingOrder === 'patrol') title = t('🔁 المس نقطة نهاية الدورية');
      }
      add({ id: 'desel', label: t('✕ إلغاء') }, () => s.select([]));
      // the kinds in the selection: tap one to send only those, "all" (or the same card again) for everyone
      if (!enemy) {
        const kinds = new Map();
        for (const u of sel) if (u.alive && u.team === TEAM.PLAYER) kinds.set(u.kind, (kinds.get(u.kind) || 0) + 1);
        if (kinds.size > 1) {
          add({ id: 'sk_all', label: t('الكل'), icon: `<span class="icon skall">👥</span>`, badge: `×${sel.length}`, cls: 'unit sm kind ' + (!s.selKind ? 'on' : '') }, () => s.setSelKind(null));
          for (const [kind, n] of [...kinds].sort((a, b) => b[1] - a[1]))
            add({ id: 'sk_' + kind, label: unitName(kind, TEAM.PLAYER), icon: unitIcon(kind, TEAM.PLAYER, 20), badge: `×${n}`, cls: 'unit sm kind ' + (s.selKind === kind ? 'on' : '') }, () => s.setSelKind(kind));
        }
      }
      if (!enemy && so) this.tacticButtons(add, s.group.filter(u => u instanceof Soldier));
      if (!enemy && w) buildButtons();
    } else {
      // home: the build cards (saved groups first, if any), and the fold button at the end
      title = '';
      this.groupButtons(add, true);
      if (!this.collapsed) {
        buildButtons();
        add({ id: 'fold', label: '⌄', cls: 'fold', tip: t('طيّ القائمة') }, () => { this.collapsed = true; store.set('mk.collapsed', '1'); this.render(); });
      } else add({ id: 'unfold', label: t('⌃ البناء'), cls: 'unfold' }, () => { this.collapsed = false; store.set('mk.collapsed', '0'); this.render(); });
    }

    $('title').innerHTML = title;
    this.renderTabs(showTabs, !sel.length && !s.placing);
    $('phead').classList.toggle('has-title', !!title);
    const panel = $('actions');
    // keep the scroll position when the same menu is drawn again
    const menuKey = Object.keys(actions).join('|');
    const keepScroll = menuKey === this.menuKey ? panel.scrollLeft : 0;
    this.menuKey = menuKey;
    this.actions = actions;
    panel.innerHTML = html;
    panel.scrollLeft = keepScroll;
    this.bindActions();
    this.updateArrows();
    this.refresh();
    this.tick();
  }

  // stance / formation / groups for selected soldiers
  tacticButtons(add, sol) {
    const s = this.scene;
    const stance = sol.every(u => u.stance === 'hold') ? 'hold' : 'aggressive';
    add({ id: 'st_aggr', label: t('⚔ هجوم'), cls: 'tac ' + (stance === 'aggressive' ? 'on' : ''), tip: t('يطاردون أي عدو يرونه') }, () => s.setStance('aggressive'));
    add({ id: 'st_hold', label: t('🛡 دفاع'), cls: 'tac ' + (stance === 'hold' ? 'on' : ''), tip: t('يثبتون مكانهم ويضربون من يقترب') }, () => s.setStance('hold'));
    add({ id: 'st_patrol', label: t('🔁 دورية'), cls: 'tac ' + (s.pendingOrder === 'patrol' ? 'on' : ''), tip: t('المس نقطة: يتنقلون بينها وبين مكانهم') }, () => s.setStance('patrol'));
    for (const [k, f] of Object.entries(FORMATIONS)) {
      add({ id: 'fm_' + k, label: `${f.icon} ${f.name}`, cls: 'tac fm ' + (s.formationType === k ? 'on' : '') }, () => s.setFormation(k));
    }
    this.groupButtons(add, false);
  }

  // control groups: tap = select the group, long-press = save the current selection
  groupButtons(add, onlySaved) {
    const s = this.scene;
    for (const n of [1, 2, 3]) {
      const g = s.groups[n].filter(u => u.alive);
      if (onlySaved && !g.length) continue;
      add({ id: 'grp_' + n, label: `👥${n}`, note: g.length ? `${g.length}` : t('احفظ'), cls: 'tac grp ' + (g.length ? 'has' : ''),
            tip: t('لمسة: اختيار المجموعة • ضغطة طويلة: حفظ المختارين') }, () => s.useGroup(n, false));
      this.holdActions = this.holdActions || {};
      this.holdActions['grp_' + n] = () => s.useGroup(n, true);
    }
  }

  // One set of listeners for the whole bar (bound once).
  //  - a button fires only on a real tap: swiping to scroll never triggers it
  //  - mouse: drag to scroll, wheel scrolls sideways
  bindActions() {
    if (this.actionsBound) return;
    this.actionsBound = true;
    const panel = $('actions');
    let start = null, drag = null;
    let holdTimer = null, held = false;
    panel.addEventListener('pointerdown', (e) => {
      start = { x: e.clientX, y: e.clientY, scroll: panel.scrollLeft };
      held = false;
      clearTimeout(holdTimer);
      const el = e.target.closest('[data-act]');
      if (el && this.holdActions?.[el.dataset.act]) {
        holdTimer = setTimeout(() => { held = true; el.classList.add('tapped'); this.holdActions[el.dataset.act](el); }, 450);
      }
      if (e.pointerType === 'mouse') drag = { x: e.clientX, scroll: panel.scrollLeft, moved: false };
    });
    panel.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x;
      if (Math.abs(dx) > 4) { drag.moved = true; panel.classList.add('dragging'); }
      if (drag.moved) panel.scrollLeft = drag.scroll - dx;
    });
    const endDrag = () => { drag = null; panel.classList.remove('dragging'); };
    window.addEventListener('pointerup', endDrag);
    panel.addEventListener('pointercancel', () => { start = null; endDrag(); });
    panel.addEventListener('wheel', (e) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { panel.scrollLeft -= e.deltaY; e.preventDefault(); }
    }, { passive: false });
    window.addEventListener('pointerup', () => { clearTimeout(holdTimer); this.hideTip(); });
    window.addEventListener('pointercancel', () => { clearTimeout(holdTimer); this.hideTip(); });
    panel.addEventListener('scroll', () => this.updateArrows(), { passive: true });
    this.bindDragToMap(panel);
    panel.addEventListener('pointermove', (e) => { if (start && Math.abs(e.clientX - start.x) > 10) clearTimeout(holdTimer); });
    panel.addEventListener('click', (e) => {
      const el = e.target.closest('[data-act]');
      if (!el) return;
      e.preventDefault();
      if (held) { held = false; return; }
      const moved = start && (Math.abs(e.clientX - start.x) > 10 || Math.abs(panel.scrollLeft - start.scroll) > 4);
      start = null;
      if (moved) return;
      el.classList.remove('tapped'); void el.offsetWidth; el.classList.add('tapped');
      this.lastTapped = el;
      this.actions[el.dataset.act]?.();
    });
  }

  // ---------- build tabs + collapse button ----------
  renderTabs(show, canCollapse) {
    const el = $('tabs');
    $('panel').classList.toggle('collapsed', !!this.collapsed && canCollapse);
    let h = '';
    // a small column of icons beside the cards (no extra row): 🏠 ⚔️ 🛡
    if (show && !(this.collapsed && canCollapse)) h += Object.entries(BUILD_TABS).map(([id, t]) =>
      `<button class="tab ${id === this.tab ? 'on' : ''}" data-tab="${id}" title="${t.name}" aria-label="${t.name}">${t.icon}</button>`).join('');
    el.innerHTML = h;
    el.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => {
      if (this.tab === b.dataset.tab) return;
      this.tab = b.dataset.tab; store.set('mk.tab', this.tab);
      $('actions').scrollLeft = 0; this.menuKey = null; this.render();
    });
    const fold = el.querySelector('[data-fold]');
    if (fold) fold.onclick = () => { this.collapsed = !this.collapsed; store.set('mk.collapsed', this.collapsed ? '1' : '0'); this.render(); };
  }

  // little arrows on the edges of the strip when more buttons are hidden that way
  updateArrows() {
    const a = $('actions'), max = a.scrollWidth - a.clientWidth;
    const pos = Math.abs(a.scrollLeft);                 // RTL: scrollLeft goes negative
    $('panel').classList.toggle('more-start', max > 4 && pos > 4);
    $('panel').classList.toggle('more-end', max > 4 && pos < max - 4);
  }

  // long-press bubble: what it does, full cost, how many you have
  showTip(el, { kind, building, owned, locked }) {
    const tip = $('tip'), team = TEAM.PLAYER;
    const d = building ? BUILDINGS[kind] : UNITS[kind];
    const name = building ? buildingName(kind, team) : unitName(kind, team);
    const desc = building ? d.desc : unitDesc(kind, team);
    let extra = '';
    if (building && locked) extra = `<p class="lock">🔒 ${t('يحتاج')} ${buildingName(d.requires, team)}</p>`;
    if (!building && d.damage) extra = `<p>❤️ ${d.hp} · ⚔️ ${d.damage}${d.ranged ? t(' · 🏹 رمي') : ''}</p>`;
    if (building && d.pop) extra += `<p>👥 +${d.pop} ${t('سكان')}</p>`;
    tip.innerHTML = `<b>${name}</b>${desc ? `<p>${desc}</p>` : ''}${extra}${costPills(d.cost)}${owned ? `<p class="own">${t('لديك')}: ${owned}</p>` : ''}`;
    tip.classList.remove('hidden');
    const r = el.getBoundingClientRect(), w = tip.offsetWidth;
    tip.style.left = Math.max(6, Math.min(window.innerWidth - w - 6, r.left + r.width / 2 - w / 2)) + 'px';
    tip.style.bottom = (window.innerHeight - $('panel').getBoundingClientRect().top + 8) + 'px';
    this.refresh();
  }
  // hold an upgrade card: every level with its bonus, the current one marked
  showUpTip(el, key) {
    const tip = $('tip'), up = UPGRADES[key], lvl = upLevel(this.scene.economy, key);
    const rows = up.values.map((v, i) => `<p class="${i < lvl ? 'own' : ''}">${i < lvl ? '✅' : i === lvl ? '▶' : '·'} ${t('الدرجة')} ${i + 1}: ${t(up.desc, Math.round(v * 100))}${i === 2 ? ` <small>(${buildingName(UP_LEVEL3_NEEDS, TEAM.PLAYER)})</small>` : ''}</p>`).join('');
    tip.innerHTML = `<b>${upIcon(key, 20)} ${up.name}</b>${rows}${lvl < up.max ? costPills(up.costs[lvl]) : ''}`;
    tip.classList.remove('hidden');
    const r = el.getBoundingClientRect(), w = tip.offsetWidth;
    tip.style.left = Math.max(6, Math.min(window.innerWidth - w - 6, r.left + r.width / 2 - w / 2)) + 'px';
    tip.style.bottom = (window.innerHeight - $('panel').getBoundingClientRect().top + 8) + 'px';
  }
  hideTip() { $('tip')?.classList.add('hidden'); }

  // drag a building card up onto the map: it follows the finger, let go to build there
  bindDragToMap(panel) {
    let d = null;
    panel.addEventListener('pointerdown', (e) => {
      const el = e.target.closest('[data-act^="build_"]');
      d = el && !el.classList.contains('locked') ? { kind: el.dataset.act.slice(6), x: e.clientX, y: e.clientY, on: false, el } : null;
    });
    const move = (e) => {
      if (!d) return;
      const s = this.scene, top = $('panel').getBoundingClientRect().top;
      if (!d.on) {
        // starts when the finger goes up out of the panel (sideways = scrolling the strip)
        if (e.clientY > top - 6 || d.y - e.clientY < 24 || Math.abs(e.clientX - d.x) > d.y - e.clientY) return;
        this.lastTapped = d.el;
        s.startPlacing(d.kind);
        if (!s.placing) { d = null; return; }       // can't afford / locked: the card shook
        d.on = true;
        this.hideTip();
      }
      // the building appears a little above the finger so you can see it
      const w = s.cameras.main.getWorldPoint(e.clientX, e.clientY - 34);
      s.cam.hoverWorld = w;
    };
    window.addEventListener('pointermove', move);
    const up = (e) => {
      if (!d) return;
      const s = this.scene, was = d; d = null;
      if (!was.on) return;
      const top = $('panel').getBoundingClientRect().top;
      if (e.type === 'pointercancel' || e.clientY > top) return s.cancelPlacing();
      const w = s.cameras.main.getWorldPoint(e.clientX, e.clientY - 34);
      if (s.placing === 'wall') s.wallTool.tap(Math.floor(w.x / 16), Math.floor(w.y / 16));   // wall: this is its first end
      else s.tryPlace(w.x, w.y);
      s.cam.hoverWorld = null;
    };
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  // No text messages any more: news shows up as pings on the minimap (see Minimap.js).
  // A refused action (can't afford, locked, queue full...) makes the button you
  // just tapped shake red instead.
  toast(msg) {
    if (!/^(❌|🔒|لا يمكن|الطابور|لديك بطل|Can.t|Queue|You already)/.test(msg)) return;
    const el = this.lastTapped;
    if (!el?.isConnected) return;
    el.classList.remove('nope'); void el.offsetWidth; el.classList.add('nope');
    sfx.ui('nope');
    try { navigator.vibrate?.(30); } catch (e) { /* not supported */ }
  }

  gameOver(won, survived) {
    const allies = TEAMS.some(t => t !== TEAM.PLAYER && relation(t) === 'ally');
    $('overmsg').textContent = won
      ? (survived ? (allies ? t('🏆 انتصر فريقك!') : t('🏆 انتصرت! سقطت كل قلاع الأعداء')) : t('🏆 انتصر حلفاؤك رغم سقوط قلعتك'))
      : (allies ? t('💀 هُزم فريقك') : t('💀 سقطت قلعتك'));
    // a victory gets a moment of fireworks before the box.
    // End of a campaign stage / every 2nd direct battle: a full-screen ad first (no banner on that box).
    const adDue = !!this.scene.adDue;
    clearTimeout(this.overT);
    this.overT = setTimeout(async () => {
      if (adDue) await ads.showInterstitialNow();
      $('over').classList.remove('hidden');
    }, won ? 2600 : 1200);
    const leave = (go) => () => { clearTimeout(this.bannerT); $('over').classList.add('hidden'); ads.banner(false); go(); };
    $('restart').onclick = leave(() => this.scene.scene.restart());
    $('o-menu').onclick = leave(() => menu.quitToMenu());
    clearTimeout(this.bannerT);
    if (!adDue) this.bannerT = setTimeout(() => ads.banner(true), won ? 2600 : 600);
    // stages: the next one opens on a win
    const st = MATCH.campaign && stageById(MATCH.campaign), next = st && stageById(st.id + 1);
    $('restart').textContent = st ? t('↻ أعد المرحلة') : t('العب مرة أخرى');
    $('o-menu').textContent = st ? t('🏰 قائمة المراحل') : t('🏠 القائمة الرئيسية');
    $('restart').classList.toggle('go', !(won && next));
    $('o-next').classList.toggle('hidden', !(won && next));
    $('o-next').onclick = leave(() => menu.startStage(next.id));
    if (st) $('overmsg').textContent = won
      ? (next ? `🏆 ${t('أنهيت المرحلة')} ${st.id}: ${st.name}` : `👑 ${t('أنهيت كل المراحل! أنت سيد الممالك')}`)
      : `💀 ${t('خسرت المرحلة')} ${st.id}: ${st.name} — ${t('حاول مرة أخرى')}`;
  }

  // ☰ button: pause with continue / restart / main menu
  bindMenu() {
    const sc = () => this.scene.scene;
    $('menubtn').onclick = () => { if (this.scene.over) return; sc().pause(); $('pause').classList.remove('hidden'); ads.banner(true); };
    $('p-resume').onclick = () => { $('pause').classList.add('hidden'); ads.banner(false); sc().resume(); };
    // leaving a direct battle half-way also counts toward "every 2nd battle" (a stage left half-way doesn't get one)
    const quit = (go) => async () => { $('pause').classList.add('hidden'); ads.banner(false); const s = this.scene;
      if (!s.over && ads.battleEnded(!!MATCH.campaign, false)) await ads.showInterstitialNow(); go(); };
    $('p-restart').onclick = quit(() => sc().restart());
    $('p-menu').onclick = quit(() => menu.quitToMenu());
    // sound settings (kept between games)
    const vs = $('p-sfx'), va = $('p-amb'), mu = $('p-mute');
    const show = () => { mu.textContent = sfx.muted ? t('🔇 الصوت مكتوم') : t('🔊 الصوت يعمل'); mu.classList.toggle('off', sfx.muted); };
    vs.value = Math.round(sfx.sfxVol * 100); va.value = Math.round(sfx.ambVol * 100); show();
    vs.oninput = () => sfx.setVolume('sfx', vs.value / 100);
    vs.onchange = () => sfx.ui('sword');
    va.oninput = () => sfx.setVolume('amb', va.value / 100);
    mu.onclick = () => { sfx.setMuted(!sfx.muted); show(); };
  }

  // the kingdoms in this battle: colour, ally / enemy, fallen. Tap one to look at its keep.
  renderKingdoms() {
    const s = this.scene;
    const relCss = { me: '#ffd84a', ally: '#5aa8f0', enemy: '#e34b4b' };
    const relTxt = { me: t('أنت'), ally: t('حليف'), enemy: t('عدو') };
    $('kbar').innerHTML = TEAMS.length > 2 || TEAMS.some(t => t !== TEAM.PLAYER && relation(t) === 'ally') ? TEAMS.map(t => {
      const r = relation(t);
      return `<button data-k="${t}" class="${s.defeated?.has(t) ? 'out' : ''}" style="--k:${KINGDOMS[t].css};--rel:${relCss[r]}">
        <i></i>${KINGDOMS[t].short}<small>${relTxt[r]}</small></button>`;
    }).join('') : '';
    $('kbar').querySelectorAll('[data-k]').forEach(b => b.onclick = () => {
      const k = s.keepOf(b.dataset.k);
      if (k) s.cameras.main.pan(k.x, k.y, 400, 'Sine.easeInOut');
    });
  }
}

export const hud = new Hud();
