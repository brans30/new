import { TEAM, TILE } from '../data/config.js';
import { MATCH, hostile } from '../systems/Match.js';
import { Worker } from '../entities/Worker.js';
import { Soldier } from '../entities/Soldier.js';
import { hud } from './Hud.js';
import { sfx } from '../systems/Sound.js';
import { t } from '../i18n.js';

// =====================================================================
//  The first-time lesson: a real little battle where a coach bubble
//  (top of the screen) says what to do next and a golden ring with a
//  pointing hand shows WHERE (a button, the map, a tree, a building).
//
//  Most steps wait until the player actually does it (select a worker,
//  tap a tree, build, train, move, attack); the few "info" steps have
//  a Next button. "Skip" is always there: the battle then simply goes on.
//
//  During the lesson the enemy doesn't play (no attacks), its guards are
//  gone and its keep is weakened, so the last step (destroy the enemy
//  keep) is quick. No ads at all in the lesson.
//
//  First start: the title screen asks "learn to play?" once
//  (see Menu.showTitle); Settings can start the lesson again.
// =====================================================================
const KEY = 'mk.tut';
export const tutorialSeen = () => { try { return !!localStorage.getItem(KEY); } catch (e) { return true; } };
export const markTutorial = (v) => { try { localStorage.setItem(KEY, v); } catch (e) { /* no storage */ } };

const $ = (id) => document.getElementById(id);
const el = (id, cls) => { let e = $(id); if (!e) { e = document.createElement('div'); e.id = id; if (cls) e.className = cls; document.body.appendChild(e); } return e; };

class Tutorial {
  // the scene calls this in create() when MATCH.tutorial is set
  attach(scene) {
    this.s = scene;
    this.i = -1;
    this.flags = {};
    this.active = true;
    scene.tutorialHold = true;                // the enemy computer waits
    this.prepareEnemy();
    this.bubble = el('tut', 'tut');
    this.ring = el('tut-ring', 'tut-ring');
    this.hand = el('tut-hand', 'tut-hand');
    this.hand.textContent = '👆';
    this.bubble.onclick = (e) => {
      const b = e.target.closest('[data-tut]');
      if (!b) return;
      if (b.dataset.tut === 'next') this.next();
      if (b.dataset.tut === 'skip') this.skip();
    };
    const onTut = (name, data) => { this.flags[name] = data ?? true; };
    const onOver = (won) => this.finish(won);
    scene.events.on('tut', onTut);
    scene.events.once('gameover', onOver);
    const tick = () => this.update();
    scene.events.on('postupdate', tick);
    scene.events.once('shutdown', () => {
      scene.events.off('tut', onTut); scene.events.off('gameover', onOver); scene.events.off('postupdate', tick);
      this.hide(); this.active = false;
    });
    this.steps = this.makeSteps();
    scene.time.delayedCall(700, () => this.next());
  }

  // the enemy: no guards, a weakened keep, so the final attack is short
  prepareEnemy() {
    const s = this.s;
    for (const b of s.buildings) if (b.alive && b.kind === 'keep' && hostile(b.team, TEAM.PLAYER)) { b.hp = Math.round(b.maxHp * 0.3); }
  }

  // ---------------- helpers for the steps ----------------
  mine(fn) { return this.s.units.filter(u => u.alive && !u.hidden && u.team === TEAM.PLAYER && fn(u)); }
  soldiers() { return this.mine(u => u instanceof Soldier && !u.def.hero); }
  keep() { return this.s.keepOf(TEAM.PLAYER); }
  enemyKeep() { return this.s.buildings.find(b => b.alive && b.kind === 'keep' && hostile(b.team, TEAM.PLAYER)); }
  myBuilding(kind) { return this.s.buildings.find(b => b.alive && b.team === TEAM.PLAYER && b.kind === kind); }
  nearest(list, x, y) { let best = null, d = Infinity; for (const o of list) { const e = Math.hypot(o.x - x, o.y - y); if (e < d) { d = e; best = o; } } return best; }
  tree() {
    const w = this.s.selected.find(u => u instanceof Worker) || this.keep();
    return this.nearest(this.s.nodes.filter(n => n.alive && n.type === 'wood'), w.x, w.y);
  }
  showPanel(tab) {
    this.s.select([]);
    hud.collapsed = false; hud.tab = tab; hud.render();
  }
  btn(act) { return document.querySelector(`#actions [data-act="${act}"]`); }

  makeSteps() {
    const s = this.s;
    return [
      { text: () => `👑 ${t('أهلاً بك أيها القائد! هذه قلعتك.')}<br>${t('هدفك: ابنِ مملكتك وجيشك، ثم دمّر قلعة العدو.')}`,
        target: () => this.keep(), next: true },
      { text: () => `🖐️ ${t('اسحب الخريطة بإصبع واحد لتتحرك، وباعد إصبعين للتكبير.')}`,
        enter: () => { const c = s.cameras.main; this.cam0 = { x: c.scrollX, y: c.scrollY, z: c.zoom }; },
        done: () => { const c = s.cameras.main; return Math.hypot(c.scrollX - this.cam0.x, c.scrollY - this.cam0.y) > 50 || Math.abs(c.zoom - this.cam0.z) > 0.15; } },
      { text: () => `💰 ${t('هذه مواردك: ذهب وخشب وحجر. العمال يجمعونها، والرقم الأخير عدد السكان.')}`,
        target: () => $('resbar'), next: true },
      { text: () => `👷 ${t('المس أحد عمالك لتختاره.')}`,
        enter: () => s.select([]),
        target: () => { const k = this.keep(); return this.nearest(this.mine(u => u instanceof Worker), k.x, k.y); },
        done: () => s.selected.some(u => u instanceof Worker) },
      { text: () => `🌲 ${t('الآن المس شجرة، فيذهب العامل لقطع الخشب.')}`,
        target: () => this.tree(),
        done: () => this.flags.gather },
      { text: () => `🏠 ${t('البيوت تزيد عدد السكان. المس بطاقة «منزل» ثم المس مكاناً فارغاً قرب قلعتك.')}`,
        enter: () => this.showPanel('eco'),
        target: () => (s.placing ? null : this.btn('build_house')),
        done: () => this.flags.placed === 'house' || !!this.myBuilding('house') },
      { text: () => `⚔️ ${t('الثكنة تدرّب الجنود. ابنِها بنفس الطريقة من قسم «عسكري».')}`,
        enter: () => this.showPanel('war'),
        target: () => (s.placing ? null : this.btn('build_barracks')),
        done: () => !!this.myBuilding('barracks') },
      { text: () => `🔨 ${t('العمال يبنون الثكنة الآن… لحظات.')} <small>⏩ ${t('سرّعنا الوقت قليلاً')}</small>`,
        enter: () => { s.speed = 2; },
        exit: () => { s.speed = 1; },
        target: () => this.myBuilding('barracks'),
        done: () => this.myBuilding('barracks')?.complete },
      { text: () => `🗡️ ${t('المس الثكنة، ثم درّب 3 جنود.')} <small>(${this.soldiers().length}/3)</small>`,
        enter: () => { s.speed = 2; },
        exit: () => { s.speed = 1; },
        target: () => {
          const b = this.myBuilding('barracks');
          if (s.selected[0] !== b) return b;
          return this.soldiers().length + b.queue.length >= 3 ? b : this.btn('train_swordsman');
        },
        done: () => this.soldiers().length >= 3 },
      { text: () => `✌️ ${t('المس أحد جنودك مرتين بسرعة لتختار كل الجنود حوله.')}<small>${t('أو: اضغط مطولاً على الخريطة ثم اسحب لترسم مربعاً حولهم.')}</small>`,
        enter: () => s.select([]),
        target: () => { const k = this.myBuilding('barracks') || this.keep(); return this.nearest(this.soldiers(), k.x, k.y); },
        done: () => s.selected.filter(u => u instanceof Soldier).length >= 2 },
      { text: () => `🚩 ${t('المس الأرض لتحريك جيشك إلى هناك.')}`,
        done: () => this.flags.move },
      { text: () => `⚒️ ${t('الحدّاد يقوّي جنودك (أسلحة ودروع وخيول). والحانة تعطيك بطلاً، تظهر مهاراته على يسار الشاشة.')}`,
        enter: () => this.showPanel('war'),
        target: () => this.btn('build_blacksmith'), next: true },
      { text: () => `🗺️ ${t('الخريطة الصغيرة: المس أي مكان فيها للذهاب إليه. النقاط الحمراء أعداء.')}`,
        target: () => $('minimap'), next: true },
      { text: () => `⏸️ ${t('من هنا توقف اللعبة وتغيّر السرعة والصوت.')}`,
        target: () => $('menubtn'), next: true },
      { text: () => `🔥 ${t('حان وقت الهجوم! اختر جنودك، ثم المس قلعة العدو.')}<small>${t('أضعفنا القلعة من أجل هذا التدريب.')}</small>`,
        enter: () => { const e = this.enemyKeep(); if (e) s.cameras.main.pan(e.x, e.y + 20, 900, 'Sine.easeInOut'); },
        target: () => (s.selected.some(u => u instanceof Soldier) ? this.enemyKeep() : this.nearest(this.soldiers(), this.enemyKeep()?.x || 0, this.enemyKeep()?.y || 0)),
        done: () => !this.enemyKeep() },
    ];
  }

  // ---------------- flow ----------------
  next() {
    const prev = this.steps[this.i];
    prev?.exit?.();
    this.i++;
    this.flags = {};
    const st = this.steps[this.i];
    if (!st) { this.ring.classList.add('hidden'); this.hand.classList.add('hidden'); return; }
    st.enter?.();
    sfx.ui(this.i ? 'done' : 'msg');
    this.draw();
  }

  draw() {
    const st = this.steps[this.i];
    if (!st) return;
    const n = this.steps.length;
    const html = `<div class="tut-text">${st.text()}</div>
      <div class="tut-foot"><span class="tut-dots" dir="ltr">${this.i + 1} / ${n}</span>
        ${st.next ? `<button class="tut-next" data-tut="next">${t('التالي')} ›</button>` : ''}
        <button class="tut-skip" data-tut="skip">${t('تخطَّ التعليم')}</button></div>`;
    if (html !== this.lastHtml) { this.bubble.innerHTML = html; this.lastHtml = html; }
    this.bubble.classList.remove('hidden');
  }

  update() {
    if (!this.active || this.s.over) return;
    const st = this.steps[this.i];
    if (!st) return;
    if (st.done && st.done()) return this.next();
    this.draw();                                     // texts with live numbers (3/3...)
    this.point(st.target?.());
  }

  // the golden ring + the hand over a DOM element or a thing on the map
  point(tg) {
    if (!tg || $('pause') && !$('pause').classList.contains('hidden')) { this.ring.classList.add('hidden'); this.hand.classList.add('hidden'); this.bubble.style.top = ''; return; }
    let x, y, r;
    if (tg instanceof HTMLElement) {
      const b = tg.getBoundingClientRect();
      if (!b.width) { this.ring.classList.add('hidden'); this.hand.classList.add('hidden'); return; }
      x = b.left + b.width / 2; y = b.top + b.height / 2; r = Math.max(b.width, b.height) / 2 + 6;
      if (b.width > 3 * b.height) {                 // a wide bar: a rounded box instead of a circle
        this.place(b.left - 5, b.top - 5, b.width + 10, b.height + 10, 12);
        this.handAt(x, b.bottom + 4);
        return;
      }
    } else {
      const c = this.s.cameras.main;
      x = (tg.x - c.worldView.x) * c.zoom; y = (tg.y - c.worldView.y) * c.zoom;
      r = Math.max(16, ((tg.def?.size || 1) * TILE * 0.6 + 6) * c.zoom);
      if (x < -40 || y < -40 || x > innerWidth + 40 || y > innerHeight + 40) { this.ring.classList.add('hidden'); this.hand.classList.add('hidden'); return; }
    }
    this.place(x - r, y - r, r * 2, r * 2, r);
    this.handAt(x, y + r * 0.6);
  }
  place(x, y, w, h, rad) {
    this.dodge({ x, y, w, h });
    const s = this.ring.style;
    s.left = x + 'px'; s.top = y + 'px'; s.width = w + 'px'; s.height = h + 'px'; s.borderRadius = rad + 'px';
    this.ring.classList.remove('hidden');
  }
  // the bubble never covers what it points at: if they overlap it moves down, just above the panel
  dodge(r) {
    const bb = this.bubble, top0 = 52;
    const h = bb.offsetHeight, w = bb.offsetWidth, left = (innerWidth - w) / 2;
    const hit = (t) => r.x < left + w && r.x + r.w > left && r.y < t + h + 40 && r.y + r.h > t;   // (+40: the hand below the ring)
    let top = top0;
    if (hit(top0)) {
      const panelTop = document.getElementById('panel')?.getBoundingClientRect().top || innerHeight;
      const low = panelTop - h - 10;
      top = hit(low) ? top0 : Math.max(top0, low);
    }
    bb.style.top = top + 'px';
  }
  handAt(x, y) {
    const s = this.hand.style;
    s.left = (x - 14) + 'px'; s.top = Math.min(innerHeight - 40, y) + 'px';
    this.hand.classList.remove('hidden');
  }
  hide() { for (const e of [this.bubble, this.ring, this.hand]) e?.classList.add('hidden'); }

  // the player skipped: the battle goes on as a normal (easy) one
  skip() {
    this.steps[this.i]?.exit?.();
    markTutorial('skipped');
    this.active = false; this.hide();
    this.s.tutorialHold = false;
    this.s.speed = 1;
    this.s.events.emit('toast', `⏭️ ${t('تخطّيت التعليم — المعركة مستمرة')}`);
  }

  finish(won) {
    this.ring.classList.add('hidden'); this.hand.classList.add('hidden');
    if (!this.active) return;
    this.steps[this.i]?.exit?.();
    this.active = false;
    this.ring.classList.add('hidden'); this.hand.classList.add('hidden');
    if (won) markTutorial('done');
    this.bubble.innerHTML = `<div class="tut-text">${won ? `🎉 ${t('أحسنت! أنهيت التعليم، وأنت جاهز للمعارك الحقيقية.')}` : `💪 ${t('لا بأس! يمكنك إعادة التعليم من الإعدادات.')}`}</div>`;
    this.bubble.classList.remove('hidden');
    setTimeout(() => this.bubble.classList.add('hidden'), 5000);
  }
}

export const tutorial = new Tutorial();
window.__tutorial = tutorial;
