import { t } from '../i18n.js';
import { tutorialSeen, markTutorial } from './Tutorial.js';
import { quality } from '../systems/Quality.js';
import { ALL_COLORS, KINGDOMS, DIFFICULTY, TILE, RESOURCE_NODES, RACES } from '../data/config.js';
import { MAPS } from '../data/maps.js';
import { buildMap } from '../systems/MapBuilder.js';
import { T, SHORES } from '../systems/Terrain.js';
import { MATCH, setMatch } from '../systems/Match.js';
import { icon } from './Hud.js';
import { loading } from './Loading.js';
import { STAGES, progress, unlocked, stageById } from '../data/campaign.js';
import { sfx } from '../systems/Sound.js';
import { ads } from '../systems/Ads.js';
import { isEn, LANG, setLang } from '../i18n.js';

// =====================================================================
//  Start screen + battle setup (plain DOM, like the HUD).
//
//  You are always kingdom #0; every other kingdom is played by the computer.
//  Choose: your people and colour, the map, how many kingdoms, who is allied
//  with whom, how hard each computer is, and where you start on the map.
// =====================================================================
const $ = (id) => document.getElementById(id);
const TEAMS_ABC = [null, 'A', 'B', 'C', 'D'];
const TEAM_NAME = { A: t('فريق أ'), B: t('فريق ب'), C: t('فريق ج'), D: t('فريق د') };
const TEAM_CSS = { A: '#3d8bd6', B: '#d65a3d', C: '#8a5bd6', D: '#d6a63d' };
const SAVE_KEY = 'mk.setup.v1';

const PRESETS = {
  2: [{ id: 'duel', label: t('واحد ضد واحد'), teams: [null, null] }],
  3: [
    { id: 'ffa', label: t('الكل ضد الكل'), teams: [null, null, null] },
    { id: 'ally', label: t('أنت وحليف ضد واحد'), teams: ['A', 'A', 'B'] },
    { id: 'alone', label: t('أنت ضد اثنين متحالفين'), teams: ['A', 'B', 'B'] },
  ],
  4: [
    { id: 'ffa', label: t('الكل ضد الكل'), teams: [null, null, null, null] },
    { id: '2v2', label: t('٢ ضد ٢'), teams: ['A', 'A', 'B', 'B'] },
    { id: '3v1', label: t('أنت وحليفان ضد واحد'), teams: ['A', 'A', 'A', 'B'] },
    { id: 'alone', label: t('أنت وحدك ضد ٣'), teams: ['A', 'B', 'B', 'B'] },
  ],
};


function defaults() {
  return {
    race: 'human', map: 'green', seed: 1, preset: 'duel', spot: 'random', enemyLevel: 'normal',
    kingdoms: [
      { color: 'cyan', alliance: null, difficulty: 'normal' },
      { color: 'red', alliance: null, difficulty: 'normal' },
    ],
  };
}

class Menu {
  constructor() { this.state = this.load(); }

  load() {
    try {
      const s = JSON.parse(localStorage.getItem(SAVE_KEY));
      if (s?.kingdoms?.length >= 2 && s.kingdoms.every(k => KINGDOMS[k.color])) return { ...defaults(), ...s };
    } catch (e) { /* no storage: defaults */ }
    return defaults();
  }
  save() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(this.state)); } catch (e) { /* ignore */ } }

  // ---------------------------------------------------------------
  open(game) {
    this.game = game;
    ads.banner(true);                         // a banner at the bottom of the menus (never in battle)
    document.body.classList.remove('in-game');
    $('menu').classList.remove('hidden');
    this.showTitle();
  }

  // show a screen of the menu (with a page-turn sound when changing screens)
  screen(html) {
    const el = $('menu');
    if (el.firstElementChild && this.game) sfx.ui('swoosh');
    el.innerHTML = html;
  }

  close() {
    ads.banner(false);
    $('menu').classList.add('hidden');
  }

  // back to the menu from a running game
  quitToMenu() {
    const sc = this.game.scene;
    if (sc.isActive('Game') || sc.isPaused('Game')) sc.stop('Game');
    $('over').classList.add('hidden');
    $('pause').classList.add('hidden');
    this.open(this.game);
    if (MATCH.campaign) this.showCampaign(MATCH.campaign);
  }

  showTitle() {
    const k = this.state.kingdoms;
    this.screen(`
      <div class="m-title">
        <div class="m-logo">
          <div class="emblem"><img src="assets/emblem.png" alt=""></div>
          <div class="m-crowns">${ALL_COLORS.map(c => icon(`keep_${c}`, 0, 44)).join('')}</div>
          <h1>${t('الممالك الصغيرة')}</h1>
          <p>${t('ابنِ مملكتك، اجمع الموارد، وقُد جيشك مع حلفائك')}</p>
        </div>
        <div class="m-col">
          <button class="mbtn big go" id="m-direct">⚔️ ${t('معركة مباشرة')} <small>${t('اختر الخريطة والعدو وابدأ')}</small></button>
          <button class="mbtn big camp" id="m-camp">🏰 ${t('المراحل')} <small>${progress().done.length} / ${STAGES.length} ${t('مرحلة')}</small></button>
          <button class="mbtn" id="m-new">🛠️ ${t('معركة مخصصة')} <small>${t('حتى ٤ ممالك وحلفاء')}</small></button>
          <button class="mbtn pill m-set" id="m-settings">⚙️ ${t('الإعدادات')} <small>${isEn ? 'English' : t('العربية')}</small></button>
        </div>
      </div>`);
    $('m-direct').onclick = () => this.showDirect();
    $('m-camp').onclick = () => this.showCampaign();
    // the very first time: offer the short lesson (once; Settings can start it again)
    if (!tutorialSeen()) {
      const ask = document.createElement('div');
      ask.className = 'tut-ask';
      ask.innerHTML = `<div class="tut-ask-box">
          <div class="tut-ask-ic">🎓</div>
          <h3>${t('أول مرة هنا؟')}</h3>
          <p>${t('درس تفاعلي قصير (٣ دقائق) يعلّمك كل شيء: الموارد، والبناء، والجيش، والهجوم.')}</p>
          <button class="mbtn big go" id="tut-yes">▶ ${t('ابدأ التعليم')}</button>
          <button class="mbtn pill" id="tut-no">${t('تخطَّ، أعرف اللعب')}</button>
        </div>`;
      $('menu').appendChild(ask);
      $('tut-yes').onclick = () => { ask.remove(); this.startTutorial(); };
      $('tut-no').onclick = () => { markTutorial('skipped'); sfx.ui('click'); ask.classList.add('out'); setTimeout(() => ask.remove(), 250); };
    }
    $('m-new').onclick = () => this.showSetup();
    $('m-settings').onclick = () => this.showSettings();
  }

  // ---------------------------------------------------------------
  //  DIRECT BATTLE: you against one computer kingdom. Pick your kingdom,
  //  the map, the enemy and how hard it plays.
  showDirect() {
    const st = this.state;
    st.direct = { map: st.map, enemy: 'random', level: st.enemyLevel || 'normal', ...st.direct };
    this.screen(`
      <div class="m-setup">
        <header class="m-head">
          <button class="mbtn pill" id="m-back">${isEn ? '← ' : '→ '}${t('رجوع')}</button>
          <h2>⚔️ ${t('معركة مباشرة')}</h2>
          <span></span>
        </header>
        <div class="m-body">
          <section class="m-sec"><h3><b>${t('١')}</b> ${t('مملكتك')}</h3><div class="m-row scroll" id="d-me"></div></section>
          <section class="m-sec"><h3><b>${t('٢')}</b> ${t('العدو')}</h3><div class="m-row scroll" id="d-foe"></div>
            <h3 class="sub">${t('صعوبة العدو')}</h3><div class="seg" id="d-level"></div></section>
          <section class="m-sec wide"><h3><b>${t('٣')}</b> ${t('الخريطة')}</h3><div class="m-row scroll" id="d-maps"></div></section>
        </div>
        <footer class="m-foot">
          <div id="d-summary"></div>
          ${this.adBonusBtn()}
          <button class="mbtn big go" id="d-start">${t('ابدأ المعركة')} ⚔️</button>
        </footer>
      </div>`);
    $('m-back').onclick = () => this.showTitle();
    $('d-start').onclick = () => this.startDirect();
    this.bindAdBonus();
    this.renderDirect();
  }

  renderDirect() {
    const st = this.state, d = st.direct, me = st.kingdoms[0].color;
    if (d.enemy === me) d.enemy = 'random';
    const card = (c, on, attr) => `<button class="swatch ${on ? 'on' : ''}" ${attr}="${c}" style="--k:${KINGDOMS[c].css}">
        ${icon(`keep_${c}`, 0, 38)}<small>${KINGDOMS[c].short}</small><small class="race">${RACES[KINGDOMS[c].race].name}</small></button>`;
    $('d-me').innerHTML = ALL_COLORS.map(c => card(c, c === me, 'data-me')).join('');
    $('d-me').querySelectorAll('[data-me]').forEach(b => b.onclick = () => { this.setMyColor(b.dataset.me); this.renderDirect(); });
    $('d-foe').innerHTML = `<button class="swatch rnd ${d.enemy === 'random' ? 'on' : ''}" data-foe="random"><span class="dice">🎲</span><small>${t('عشوائي')}</small></button>`
      + ALL_COLORS.filter(c => c !== me).map(c => card(c, c === d.enemy, 'data-foe')).join('');
    $('d-foe').querySelectorAll('[data-foe]').forEach(b => b.onclick = () => { d.enemy = b.dataset.foe; this.save(); this.renderDirect(); });
    $('d-level').innerHTML = Object.entries(DIFFICULTY).map(([id, x]) => `<button class="${d.level === id ? 'on' : ''}" data-lv="${id}">${x.name}</button>`).join('');
    $('d-level').querySelectorAll('[data-lv]').forEach(b => b.onclick = () => { d.level = b.dataset.lv; this.save(); this.renderDirect(); });
    $('d-maps').innerHTML = `<button class="mapcard ${d.map === 'random' ? 'on' : ''}" data-map="random"><span class="thumb soon">🎲</span><b>${t('عشوائية')}</b><small>${t('أي خريطة')}</small></button>`
      + Object.entries(MAPS).map(([id, m]) => `
      <button class="mapcard ${d.map === id ? 'on' : ''}" data-map="${id}">
        <canvas class="thumb" data-thumb="${id}" width="120" height="76"></canvas><b>${m.name}</b><small>${m.desc}</small></button>`).join('');
    $('d-maps').querySelectorAll('[data-map]').forEach(b => b.onclick = () => { d.map = b.dataset.map; this.save(); this.renderDirect(); });
    $('d-maps').querySelectorAll('[data-thumb]').forEach(cv => this.drawMap(cv, cv.dataset.thumb, false, 2, 1));
    const foe = d.enemy === 'random' ? t('🎲 عدو عشوائي') : KINGDOMS[d.enemy].name;
    $('d-summary').innerHTML = `${KINGDOMS[me].name} ${t('ضد')} ${foe} · ${DIFFICULTY[d.level].name} · ${d.map === 'random' ? t('خريطة عشوائية') : MAPS[d.map].name}`;
  }

  startDirect() {
    const st = this.state, d = st.direct, me = st.kingdoms[0].color;
    const pickOne = (a) => a[Math.floor(Math.random() * a.length)];
    const enemy = d.enemy === 'random' ? pickOne(ALL_COLORS.filter(c => c !== me)) : d.enemy;
    const map = d.map === 'random' ? pickOne(Object.keys(MAPS)) : d.map;
    this.save();
    this.launch({ map, seed: 1 + Math.floor(Math.random() * 9999), spot: 'random', kingdoms: [
      { color: me, alliance: null, difficulty: 'normal' },
      { color: enemy, alliance: null, difficulty: d.level },
    ] });
  }

  // ---------------------------------------------------------------
  //  STAGES: a path of battles, each one harder. Winning opens the next.
  showCampaign(focus) {
    const done = progress().done;
    const next = STAGES.find(s => !done.includes(s.id))?.id || STAGES[STAGES.length - 1].id;
    this.stageSel = focus && unlocked(focus) ? focus : next;
    this.screen(`
      <div class="m-setup">
        <header class="m-head">
          <button class="mbtn pill" id="m-back">${isEn ? '← ' : '→ '}${t('رجوع')}</button>
          <h2>🏰 ${t('المراحل')} <small class="m-count">${done.length} / ${STAGES.length}</small></h2>
          <span></span>
        </header>
        <div class="m-body camp-body">
          <div class="camp-path" id="c-path"></div>
          <section class="m-sec camp-info" id="c-info"></section>
        </div>
      </div>`);
    $('m-back').onclick = () => this.showTitle();
    this.renderCampaign();
  }

  // the colours for a stage: you, then your allies, then the enemies (by race)
  stageKingdoms(stg) {
    const me = this.state.kingdoms[0].color, used = new Set([me]);
    const take = (race) => {
      const c = ALL_COLORS.find(x => !used.has(x) && KINGDOMS[x].race === race) || ALL_COLORS.find(x => !used.has(x));
      used.add(c); return c;
    };
    const ally = (stg.allies || []).length;
    const ks = [{ color: me, alliance: ally ? 'A' : null, difficulty: 'normal' }];
    for (const r of stg.allies || []) ks.push({ color: take(r), alliance: 'A', difficulty: 'normal' });
    for (const r of stg.enemies) ks.push({ color: take(r), alliance: stg.together || ally ? 'B' : null, difficulty: stg.level });
    return ks;
  }

  renderCampaign() {
    const done = progress().done;
    $('c-path').innerHTML = STAGES.map(s => {
      const open = unlocked(s.id), won = done.includes(s.id);
      return `<button class="stage ${won ? 'won' : open ? 'open' : 'locked'} ${this.stageSel === s.id ? 'on' : ''}" data-stage="${s.id}" ${open ? '' : 'disabled'}>
        <span class="num">${won ? '✓' : open ? s.id : '🔒'}</span><b>${s.name}</b><small>${MAPS[s.map].name}</small></button>`;
    }).join('');
    $('c-path').querySelectorAll('[data-stage]').forEach(b => b.onclick = () => { this.stageSel = +b.dataset.stage; this.renderCampaign(); });
    // centre the chosen stage in its row (only that row scrolls, never the whole screen)
    const path = $('c-path'), on = path.querySelector('.on');
    if (on) path.scrollLeft = on.offsetLeft - (path.clientWidth - on.offsetWidth) / 2;

    const s = stageById(this.stageSel), ks = this.stageKingdoms(s);
    const row = (k, who) => `<span class="ck" style="--k:${KINGDOMS[k.color].css}">${icon(`keep_${k.color}`, 0, 26)}<small>${who}</small></span>`;
    const friends = ks.filter(k => k.alliance === 'A' || k === ks[0]);
    const foes = ks.filter(k => !friends.includes(k));
    const resTxt = s.res > 1 ? t('💰 موارد إضافية') : s.res < 1 ? t('⚠️ موارد قليلة') : t('💰 موارد عادية');
    $('c-info').innerHTML = `
      <div class="ci-top">
        <canvas id="c-map" width="150" height="96"></canvas>
        <div class="ci-text">
          <h3><b>${s.id}</b> ${s.name}</h3>
          <p class="story">${s.story}</p>
          <div class="ci-tags"><span class="tag lv-${s.level}">${DIFFICULTY[s.level].name}</span><span class="tag">${MAPS[s.map].name}</span><span class="tag">${resTxt}</span></div>
        </div>
      </div>
      <div class="ci-sides">${friends.map((k, i) => row(k, i === 0 ? t('أنت') : t('حليف'))).join('')}<b class="vs">${t('ضد')}</b>${foes.map(k => row(k, RACES[KINGDOMS[k.color].race].name)).join('')}</div>
      <p class="m-tip">💡 ${s.tip}</p>
      ${this.adBonusBtn()}
      <button class="mbtn big go" id="c-start">${done.includes(s.id) ? t('↻ العب المرحلة مرة أخرى') : t('⚔️ ابدأ المرحلة')}</button>`;
    this.drawMap($('c-map'), s.map, false, ks.length, s.seed);
    $('c-start').onclick = () => this.startStage(s.id);
    this.bindAdBonus();
  }

  // the first-time lesson: an easy little battle with a coach (see Tutorial.js)
  startTutorial() {
    markTutorial('started');
    this.launch({ map: 'green', seed: 5, spot: 'random', kingdoms: [
      { color: 'cyan', alliance: null, difficulty: 'easy' }, { color: 'red', alliance: null, difficulty: 'easy' }] },
    { tutorial: true, playerRes: 2 });
  }

  startStage(id) {
    const s = stageById(id);
    if (!s || !unlocked(id)) return;
    this.launch({ map: s.map, seed: s.seed, spot: 'random', kingdoms: this.stageKingdoms(s) }, { campaign: id, playerRes: s.res });
  }

  // ---------------------------------------------------------------
  //  SETTINGS: language and sound
  showSettings() {
    this.screen(`
      <div class="m-setup">
        <header class="m-head">
          <button class="mbtn pill" id="m-back">${isEn ? '← ' : '→ '}${t('رجوع')}</button>
          <h2>⚙️ ${t('الإعدادات')}</h2>
          <span></span>
        </header>
        <div class="m-body">
          <section class="m-sec"><h3><b>🌐</b> ${t('اللغة')}</h3>
            <div class="seg" id="s-lang">
              <button class="${LANG === 'ar' ? 'on' : ''}" data-lang="ar">${t('العربية')}</button>
              <button class="${LANG === 'en' ? 'on' : ''}" data-lang="en">English</button>
            </div>
            <p class="m-tip">${t('تتغير اللغة فوراً وتعود اللعبة إلى القائمة الرئيسية')}</p></section>
          <section class="m-sec"><h3><b>🔊</b> ${t('الصوت')}</h3>
            <div class="seg" id="s-mute">
              <button class="${!sfx.muted ? 'on' : ''}" data-m="0">🔊 ${t('يعمل')}</button>
              <button class="${sfx.muted ? 'on' : ''}" data-m="1">🔇 ${t('مكتوم')}</button>
            </div>
            <div class="s-vol"><label>⚔️ ${t('المؤثرات')}</label><input type="range" id="s-sfx" min="0" max="100" step="5" value="${Math.round(sfx.sfxVol * 100)}"></div>
            <div class="s-vol"><label>🌿 ${t('الطبيعة')}</label><input type="range" id="s-amb" min="0" max="100" step="5" value="${Math.round(sfx.ambVol * 100)}"></div>
          </section>
          <section class="m-sec"><h3><b>🎓</b> ${t('تعلّم اللعب')}</h3>
            <button class="mbtn pill" id="s-tutorial">▶ ${t('ابدأ التعليم')}</button></section>
          <section class="m-sec"><h3><b>🎨</b> ${t('جودة الرسوم')}</h3>
            <div class="seg" id="s-quality">
              ${[['auto', t('تلقائي')], ['high', t('عالية')], ['medium', t('متوسطة')], ['low', t('منخفضة')]]
                .map(([k, n]) => `<button class="${quality.pref === k ? 'on' : ''}" data-q="${k}">${n}</button>`).join('')}
            </div>
            <p class="m-tip">${quality.pref === 'auto' ? `${t('تلقائي: تختار اللعبة حسب سرعة هاتفك')} (${t('الآن')}: ${{ high: t('عالية'), medium: t('متوسطة'), low: t('منخفضة') }[quality.level]})` : t('المنخفضة أسرع وتوفر البطارية: بدون إضاءة ليلية وسحب وطقس')}</p></section>
          ${ads.privacyRequired ? `<section class="m-sec"><h3><b>🔒</b> ${t('الخصوصية')}</h3>
            <button class="mbtn pill" id="s-privacy">${t('خيارات الخصوصية والإعلانات')}</button></section>` : ''}
        </div>
      </div>`);
    $('m-back').onclick = () => this.showTitle();
    $('s-lang').querySelectorAll('[data-lang]').forEach(b => b.onclick = () => { if (b.dataset.lang !== LANG) setLang(b.dataset.lang); });
    $('s-mute').querySelectorAll('[data-m]').forEach(b => b.onclick = () => { sfx.setMuted(b.dataset.m === '1'); this.showSettings(); });
    $('s-sfx').oninput = (e) => sfx.setVolume('sfx', e.target.value / 100);
    $('s-sfx').onchange = () => sfx.ui('choose');
    $('s-amb').oninput = (e) => sfx.setVolume('amb', e.target.value / 100);
    $('s-privacy')?.addEventListener('click', () => ads.showPrivacy());
    $('s-tutorial').onclick = () => this.startTutorial();
    $('s-quality').querySelectorAll('[data-q]').forEach(b => b.onclick = () => { quality.set(b.dataset.q); this.showSettings(); });
  }

  // ---------------------------------------------------------------
  showSetup() {
    this.screen(`
      <div class="m-setup">
        <header class="m-head">
          <button class="mbtn pill" id="m-back">${isEn ? '← ' : '→ '}${t('رجوع')}</button>
          <h2>${t('إعداد المعركة')}</h2>
          <span></span>
        </header>
        <div class="m-body">
          <section class="m-sec"><h3><b>${t('١')}</b> ${t('شعبك')}</h3><div class="m-row" id="m-race"></div></section>
          <section class="m-sec"><h3><b>${t('٢')}</b> ${t('لون مملكتك')}</h3><div class="m-row" id="m-color"></div></section>
          <section class="m-sec wide"><h3><b>${t('٣')}</b> ${t('الخريطة')}</h3><div class="m-row scroll" id="m-maps"></div></section>
          <section class="m-sec"><h3><b>${t('٤')}</b> ${t('عدد الممالك')}</h3><div class="seg" id="m-count"></div>
            <h3 class="sub">${t('صعوبة الأعداء')}</h3><div class="seg" id="m-level"></div></section>
          <section class="m-sec"><h3><b>${t('٥')}</b> ${t('الحلفاء والأعداء')}</h3><div class="m-chips" id="m-presets"></div><div id="m-list"></div>
            <p class="m-tip">${t('اضغط على الفريق لتغييره')} · ${t('من في نفس الفريق حلفاء')} · ${t('«وحده» يقاتل الجميع')}</p></section>
          <section class="m-sec"><h3><b>${t('٦')}</b> ${t('مكانك على الخريطة')} <button class="chip roll" id="m-roll">🎲 ${t('شكل جديد للخريطة')}</button></h3>
            <div class="m-mapwrap"><canvas id="m-preview"></canvas></div>
            <div class="m-chips" id="m-spot"></div></section>
        </div>
        <footer class="m-foot">
          <div id="m-summary"></div>
          ${this.adBonusBtn()}
          <button class="mbtn big go" id="m-start">${t('ابدأ المعركة')} ⚔️</button>
        </footer>
      </div>`);
    $('m-back').onclick = () => this.showTitle();
    $('m-start').onclick = () => this.start();
    this.bindAdBonus();
    $('m-preview').onclick = (e) => this.tapPreview(e);
    $('m-roll').onclick = () => { this.state.seed = 1 + Math.floor(Math.random() * 9999); this.changed(); };
    this.renderSetup();
  }

  renderSetup() {
    const st = this.state, ks = st.kingdoms, me = ks[0];

    // 1) people
    const myRace = KINGDOMS[me.color].race;
    const face = (race) => race === myRace ? me.color : ALL_COLORS.find(c => KINGDOMS[c].race === race);
    $('m-race').innerHTML = Object.entries(RACES).map(([id, R]) => { const c = face(id); return `
      <button class="pick ${myRace === id ? 'on' : ''}" data-race="${id}">
        <span class="pics">${icon(`keep_${c}`, 0, 40)}${icon(`swordsman_${c}`, 0, 30)}${icon(id === 'orc' ? `axeman_${c}` : `bowman_${c}`, 0, 30)}${icon(`knight_${c}`, 0, 30)}</span>
        <b>${R.name}</b><small>${R.desc}</small></button>`; }).join('');
    $('m-race').querySelectorAll('[data-race]').forEach(b => b.onclick = () => {
      if (b.dataset.race !== myRace) this.setMyColor(ALL_COLORS.find(c => KINGDOMS[c].race === b.dataset.race));
    });

    // 2) colour
    $('m-color').innerHTML = ALL_COLORS.filter(c => KINGDOMS[c].race === myRace).map(c => `
      <button class="swatch ${me.color === c ? 'on' : ''}" data-color="${c}" style="--k:${KINGDOMS[c].css}">
        ${icon(`keep_${c}`, 0, 38)}<small>${KINGDOMS[c].short}</small></button>`).join('');
    $('m-color').querySelectorAll('[data-color]').forEach(b => b.onclick = () => this.setMyColor(b.dataset.color));

    // 3) maps
    $('m-maps').innerHTML = Object.entries(MAPS).map(([id, m]) => `
      <button class="mapcard ${st.map === id ? 'on' : ''}" data-map="${id}">
        <canvas class="thumb" data-thumb="${id}" width="120" height="76"></canvas><b>${m.name}</b><small>${m.desc}</small></button>`).join('');
    $('m-maps').querySelectorAll('[data-map]').forEach(b => b.onclick = () => { st.map = b.dataset.map; this.changed(); });
    $('m-maps').querySelectorAll('[data-thumb]').forEach(cv => this.drawMap(cv, cv.dataset.thumb, false));

    // 4) count + enemy level
    $('m-count').innerHTML = [2, 3, 4].map(n => `<button class="${ks.length === n ? 'on' : ''}" data-n="${n}">${n}</button>`).join('');
    $('m-count').querySelectorAll('[data-n]').forEach(b => b.onclick = () => this.setCount(+b.dataset.n));
    $('m-level').innerHTML = Object.entries(DIFFICULTY).map(([id, d]) => `<button class="${st.enemyLevel === id ? 'on' : ''}" data-lv="${id}">${d.name}</button>`).join('');
    $('m-level').querySelectorAll('[data-lv]').forEach(b => b.onclick = () => this.setEnemyLevel(b.dataset.lv));

    // 5) alliances
    $('m-presets').innerHTML = PRESETS[ks.length].map(p => `<button class="chip ${st.preset === p.id ? 'on' : ''}" data-p="${p.id}">${p.label}</button>`).join('');
    $('m-presets').querySelectorAll('[data-p]').forEach(b => b.onclick = () => this.applyPreset(b.dataset.p));
    $('m-list').innerHTML = ks.map((k, i) => {
      const rel = i === 0 ? '' : this.relationTo(k);
      return `<div class="krow">
        <button class="kdot" data-recolor="${i}" style="--k:${KINGDOMS[k.color].css}" ${i === 0 ? 'disabled' : ''}>${icon(`keep_${k.color}`, 0, 28)}</button>
        <div class="kname"><b>${KINGDOMS[k.color].name}</b><small>${i === 0 ? t('👑 أنت') : t('🖥️ كمبيوتر')} · ${RACES[KINGDOMS[k.color].race].name}${rel}</small></div>
        <button class="tbtn" data-team="${i}" style="--t:${TEAM_CSS[k.alliance] || '#8c7a62'}">${TEAM_NAME[k.alliance] || t('وحده')}</button>
        ${i === 0 ? '<span class="lvl ghost"></span>' : `<button class="lvl lv-${k.difficulty}" data-lvl="${i}">${DIFFICULTY[k.difficulty].name}</button>`}
      </div>`;
    }).join('');
    $('m-list').querySelectorAll('[data-team]').forEach(b => b.onclick = () => this.cycleTeam(+b.dataset.team));
    $('m-list').querySelectorAll('[data-lvl]').forEach(b => b.onclick = () => this.cycleLevel(+b.dataset.lvl));
    $('m-list').querySelectorAll('[data-recolor]').forEach(b => b.onclick = () => this.recolor(+b.dataset.recolor));

    // 6) start spot
    const L = buildMap(st.map, ks.length, st.seed);
    $('m-spot').innerHTML = `<button class="chip ${st.spot === 'random' ? 'on' : ''}" data-spot="random">🎲 ${t('عشوائي')}</button>`
      + L.spots.map((_, i) => `<button class="chip ${st.spot === i ? 'on' : ''}" data-spot="${i}">${t('موقع')} ${i + 1}</button>`).join('');
    $('m-spot').querySelectorAll('[data-spot]').forEach(b => b.onclick = () => {
      st.spot = b.dataset.spot === 'random' ? 'random' : +b.dataset.spot; this.changed();
    });
    this.drawMap($('m-preview'), st.map, true);

    // summary + can we start?
    const err = this.problem();
    $('m-start').disabled = !!err;
    $('m-summary').innerHTML = err ? `<span class="err">⚠️ ${err}</span>` : this.summary();
  }

  relationTo(k) {
    const me = this.state.kingdoms[0];
    return me.alliance && k.alliance === me.alliance ? t(' · <span class="ally">حليف</span>') : t(' · <span class="foe">عدو</span>');
  }

  summary() {
    const ks = this.state.kingdoms;
    const sides = new Map();
    for (const k of ks) { const s = k.alliance || k.color; sides.set(s, (sides.get(s) || 0) + 1); }
    return `${ks.length} ${t('ممالك')} · <bdi>${[...sides.values()].join(t(' ضد '))}</bdi> · ${MAPS[this.state.map].name}`;
  }

  problem() {
    const ks = this.state.kingdoms;
    const sides = new Set(ks.map(k => k.alliance || k.color));
    if (sides.size < 2) return t('الكل في فريق واحد: اجعل مملكة واحدة على الأقل عدواً');
    return null;
  }

  changed() { this.state.preset = this.matchPreset(); this.save(); if ($('m-race')) this.renderSetup(); }

  // which preset (if any) the current teams look like
  matchPreset() {
    const ks = this.state.kingdoms;
    const norm = (arr) => { const map = {}; let n = 0; return arr.map(a => a ? (map[a] = map[a] || 'T' + (n++)) : null).join(','); };
    const cur = norm(ks.map(k => k.alliance));
    return PRESETS[ks.length].find(p => norm(p.teams) === cur)?.id || 'custom';
  }

  setMyColor(c) {
    const ks = this.state.kingdoms;
    const other = ks.find(k => k.color === c);
    if (other) other.color = ks[0].color;
    ks[0].color = c;
    this.changed();
  }

  recolor(i) {
    const ks = this.state.kingdoms, used = new Set(ks.map(k => k.color));
    // next unused colour after this one (humans and orcs in turn), so tapping walks through every kingdom
    const at = ALL_COLORS.indexOf(ks[i].color);
    const free = [...ALL_COLORS.slice(at + 1), ...ALL_COLORS.slice(0, at)].filter(c => !used.has(c));
    if (!free.length) {   // all colours used: swap with the next computer kingdom
      const j = i + 1 < ks.length ? i + 1 : 1;
      if (j !== i) [ks[i].color, ks[j].color] = [ks[j].color, ks[i].color];
    } else ks[i].color = free[0];
    this.changed();
  }

  setCount(n) {
    const ks = this.state.kingdoms;
    while (ks.length > n) ks.pop();
    while (ks.length < n) {
      const used = new Set(ks.map(k => k.color));
      ks.push({ color: ALL_COLORS.find(c => !used.has(c)), alliance: null, difficulty: this.state.enemyLevel });
    }
    const L = buildMap(this.state.map, n, this.state.seed);
    if (this.state.spot !== 'random' && this.state.spot >= L.spots.length) this.state.spot = 'random';
    this.applyPreset(PRESETS[n][n === 4 ? 1 : 0].id);
  }

  setEnemyLevel(lv) {
    this.state.enemyLevel = lv;
    const me = this.state.kingdoms[0];
    for (const k of this.state.kingdoms.slice(1)) if (!(me.alliance && k.alliance === me.alliance)) k.difficulty = lv;
    this.changed();
  }

  applyPreset(id) {
    const p = PRESETS[this.state.kingdoms.length].find(x => x.id === id);
    if (p) this.state.kingdoms.forEach((k, i) => { k.alliance = p.teams[i]; });
    this.changed();
  }

  cycleTeam(i) {
    const k = this.state.kingdoms[i];
    k.alliance = TEAMS_ABC[(TEAMS_ABC.indexOf(k.alliance) + 1) % TEAMS_ABC.length];
    this.changed();
  }

  cycleLevel(i) {
    const ids = Object.keys(DIFFICULTY), k = this.state.kingdoms[i];
    k.difficulty = ids[(ids.indexOf(k.difficulty) + 1) % ids.length];
    this.changed();
  }

  // ---------------------------------------------------------------
  // who starts where: you on your spot, your allies on the spots nearest to you
  assignSpots(st = this.state) {
    const ks = st.kingdoms;
    const L = buildMap(st.map, ks.length, st.seed);
    const free = L.spots.map((p, i) => i);
    let mine = st.spot === 'random' ? free[Math.floor(Math.random() * free.length)] : st.spot;
    if (!free.includes(mine)) mine = 0;
    const out = [mine];
    free.splice(free.indexOf(mine), 1);
    const d = (a, b) => Math.hypot(L.spots[a].x - L.spots[b].x, L.spots[a].y - L.spots[b].y);
    const me = ks[0];
    const order = ks.map((k, i) => i).slice(1)
      .sort((a, b) => (+(ks[b].alliance === me.alliance && !!me.alliance)) - (+(ks[a].alliance === me.alliance && !!me.alliance)));
    const res = new Array(ks.length);
    res[0] = mine;
    for (const i of order) {
      const ally = me.alliance && ks[i].alliance === me.alliance;
      free.sort((a, b) => ally ? d(a, mine) - d(b, mine) : d(b, mine) - d(a, mine));
      res[i] = free.shift();
    }
    return res;
  }

  // draw a little picture of the map: grass, lakes, hills, forests, mines and the start spots
  drawMap(cv, mapId, big, n = this.state.kingdoms.length, seed = this.state.seed) {
    const st = this.state;
    const L = buildMap(mapId, n, seed);
    const box = cv.parentElement.getBoundingClientRect();
    const W = big ? Math.max(200, Math.min(box.width || 320, 520)) : cv.width;
    const H = Math.round(W * L.h / L.w);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = W * dpr; cv.height = H * dpr;
    cv.style.width = W + 'px'; cv.style.height = H + 'px';
    const g = cv.getContext('2d');
    g.setTransform(dpr * W / L.w, 0, 0, dpr * H / L.h, 0, 0);   // 1 unit = 1 tile
    const M = L.theme.mini, sh = SHORES[L.theme.shore] || SHORES.sand;
    const rgb = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;
    g.fillStyle = M.ground; g.fillRect(0, 0, L.w, L.h);
    // tile by tile: water (with a shore line), cliffs, plateau tops, stairs
    for (let y = 0; y < L.h; y++) for (let x = 0; x < L.w; x++) {
      const t = L.ter[y * L.w + x];
      if (t === T.GRASS) {
        const wet = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => L.ter[(y + dy) * L.w + x + dx] === T.WATER && x + dx >= 0 && x + dx < L.w);
        if (!wet) continue;
        g.fillStyle = rgb(sh[0]);
      } else g.fillStyle = t === T.WATER ? rgb(sh[3]) : t === T.CLIFF ? M.cliff : t === T.HIGH ? M.top : '#e3d6aa';
      g.fillRect(x, y, 1.02, 1.02);
    }
    for (const [x, y] of L.islands) { g.fillStyle = M.cliff; g.fillRect(x + 0.3, y + 0.3, 2.4, 2.4); g.fillStyle = M.top; g.fillRect(x + 0.8, y + 0.7, 1.4, 1.3); }
    for (const [x, y, kind] of L.nodes) {
      if (kind === 'gold' || kind === 'quarry') {
        g.fillStyle = kind === 'gold' ? '#ffd84a' : '#f4f4f0';
        g.beginPath(); g.arc(x + 0.5, y + 0.5, 0.95, 0, 7); g.fill();
        g.lineWidth = 0.25; g.strokeStyle = '#2b1d12'; g.stroke();
      } else {
        g.fillStyle = RESOURCE_NODES[kind]?.type === 'stone' ? M.rock : M.tree;
        g.fillRect(x + 0.1, y + 0.1, 0.85, 0.85);
      }
    }
    if (!big) return;
    // the start spots: coloured if already decided, numbered otherwise
    const ks = st.kingdoms;
    const known = st.spot === 'random' ? null : this.assignSpots();
    this.spotHit = [];
    L.spots.forEach((p, i) => {
      const cx = p.x + 1, cy = p.y + 1;
      const who = known ? ks.findIndex((k, j) => known[j] === i) : -1;
      const col = who >= 0 ? KINGDOMS[ks[who].color].css : 'rgba(255,255,255,.85)';
      g.fillStyle = 'rgba(0,0,0,.35)'; g.beginPath(); g.arc(cx, cy + 0.4, 3.2, 0, 7); g.fill();
      g.fillStyle = col; g.beginPath(); g.arc(cx, cy, 3, 0, 7); g.fill();
      g.lineWidth = who === 0 ? 0.8 : 0.4; g.strokeStyle = who === 0 ? '#fff' : '#2b1d12'; g.stroke();
      g.fillStyle = '#2b1d12'; g.font = 'bold 3.4px Cairo, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(who === 0 ? '★' : String(i + 1), cx, cy + 0.2);
      this.spotHit.push({ i, x: cx / L.w, y: cy / L.h });
    });
  }

  tapPreview(e) {
    const r = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    const hit = (this.spotHit || []).map(s => ({ s, d: Math.hypot(s.x - x, (s.y - y) * r.height / r.width) }))
      .sort((a, b) => a.d - b.d)[0];
    if (hit && hit.d < 0.12) { this.state.spot = hit.s.i; this.changed(); }
  }

  // ---------------------------------------------------------------
  start() {
    const st = this.state;
    if (this.problem()) return this.showSetup();
    this.save();
    this.launch({ map: st.map, seed: st.seed || 1, spot: st.spot, kingdoms: st.kingdoms });
  }

  // 🎬 "strong start": watch a rewarded ad, the next battle starts with +200 gold +200 wood
  adBonusBtn() {
    return this.adBonus
      ? `<button class="mbtn adbonus on" id="m-adbonus" disabled>✅ ${t('+200 ذهب +200 خشب')}</button>`
      : `<button class="mbtn adbonus" id="m-adbonus">🎬 ${t('ابدأ بموارد إضافية')}<small>${t('+200 ذهب +200 خشب')}</small></button>`;
  }

  bindAdBonus() {
    const b = $('m-adbonus');
    if (!b || this.adBonus) return;
    b.onclick = async () => {
      b.disabled = true;
      const r = await ads.showRewarded();
      if (r === 'rewarded') { this.adBonus = true; sfx.ui('done'); b.outerHTML = this.adBonusBtn(); }
      else { b.disabled = false; b.querySelector('small').textContent = r === 'closed' ? t('أُغلق قبل نهايته') : t('لا يوجد إعلان الآن'); }
    };
  }

  // set up the match (start spots: you first, allies near you) and start the game
  async launch(setup, extra = {}) {
    if (this.launching) return;
    // the first battle after opening the game: one full-screen ad before it starts
    this.launching = true;
    try { if (!extra.tutorial) await ads.beforeFirstBattle(); } finally { this.launching = false; }   // (no ad before the lesson)
    const spots = this.assignSpots(setup);
    setMatch({
      map: setup.map,
      seed: setup.seed || 1,
      player: setup.kingdoms[0].color,
      kingdoms: setup.kingdoms.map((k, i) => ({ color: k.color, alliance: k.alliance, difficulty: k.difficulty, ai: i > 0, spot: spots[i] })),
      campaign: null, tutorial: false, playerRes: 1, adBonus: !!this.adBonus, ...extra,
    });
    this.adBonus = false;                     // the ad bonus is for one battle only
    sfx.ui('start');
    this.close();
    // a short "preparing the battle" screen while the map is built
    loading.battle();
    setTimeout(() => {
      const sc = (this.game || window.game).scene;
      if (sc.isActive('Game') || sc.isPaused('Game')) sc.stop('Game');
      sc.start('Game');
    }, 60);
  }
}

// The card you just tapped gets a little "pop" once it is drawn again as selected
// (the screens redraw after every choice, so remember which one it was).
let lastPick = null;
document.addEventListener('pointerdown', (e) => {
  const c = e.target.closest?.('#menu .pick, #menu .swatch, #menu .mapcard, #menu .stage, #menu .seg button');
  if (!c) return;
  const attr = [...c.attributes].find(a => a.name.startsWith('data-'));
  lastPick = attr && c.parentElement?.id ? `#${c.parentElement.id} [${attr.name}="${attr.value}"]` : null;
}, { capture: true, passive: true });
new MutationObserver(() => {
  if (!lastPick) return;
  const el = document.querySelector(lastPick);
  if (el) { el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); }
  lastPick = null;
}).observe(document.getElementById('menu') || document.body, { childList: true, subtree: true });

export const menu = new Menu();
window.__menu = menu;
