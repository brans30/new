import { TEAM, TEAMS, TILE } from '../data/config.js';
import { allied, hostile, nameOf } from './Match.js';
import { t } from '../i18n.js';

// =====================================================================
//  Talking with your allies (the panel on the right, ui/AllyPanel.js).
//
//  You can ask them:  attack with me · defend me · send me gold/wood/stone
//  and you can send them resources.
//  They answer, and they also ask YOU — but only when it makes sense:
//    * their keep is under attack        -> "help me!"  (your idle army can go)
//    * they lack a resource you have lots of -> "I need wood" (send 100)
//    * they start an attack              -> "join me!"
//    * they are rich in something you lack -> they just send you some
//  Every kind of message has a cooldown, so they never spam.
// =====================================================================
const RES = ['gold', 'wood', 'stone'];
const RES_NAME = () => ({ gold: t('ذهب'), wood: t('خشب'), stone: t('حجر') });

export class Diplomacy {
  constructor(scene) {
    this.s = scene;
    this.log = [];            // { id, from, text, actions?, t }
    this.cool = {};
    this.lastAsk = 0;         // last message an ally started (not an answer)
    this.thinkT = 0;
    this.seq = 0;
  }

  get now() { return this.s.simTime; }
  // allies still in the game
  allies() { return TEAMS.filter(k => k !== TEAM.PLAYER && allied(k, TEAM.PLAYER) && !this.s.defeated.has(k) && this.s.keepOf(k)); }

  ready(key, ms) { if ((this.cool[key] || -1e9) + ms > this.now) return false; this.cool[key] = this.now; return true; }

  say(from, text, actions = null) {
    const m = { id: ++this.seq, from, text, actions, t: this.now };
    this.log.push(m);
    if (this.log.length > 8) this.log.shift();
    this.s.events.emit('diplo', m);
    return m;
  }

  resolve(m, i) {
    const a = m.actions?.[i];
    m.actions = null;
    if (a?.fn) a.fn();
    this.s.events.emit('diplo');
  }

  // ---------------- what YOU ask ----------------
  // the enemy kingdom you're fighting: near your selected soldiers, or the one you hit last, or the closest
  enemyForMe() {
    const s = this.s, foes = TEAMS.filter(k => hostile(k, TEAM.PLAYER) && !s.defeated.has(k) && s.keepOf(k));
    if (!foes.length) return null;
    const army = s.selected.filter(u => u.alive && u.team === TEAM.PLAYER && u.def?.damage);
    if (army.length) {
      const cx = army.reduce((a, u) => a + u.x, 0) / army.length, cy = army.reduce((a, u) => a + u.y, 0) / army.length;
      let best = null, bd = TILE * 22;
      for (const e of [...s.units, ...s.buildings]) {
        if (!e.alive || !foes.includes(e.team)) continue;
        const d = Math.hypot(e.x - cx, e.y - cy);
        if (d < bd) { bd = d; best = e.team; }
      }
      if (best) return best;
    }
    if (foes.includes(s.playerFocus)) return s.playerFocus;
    const k = s.keepOf(TEAM.PLAYER);
    return foes.sort((a, b) => { const A = s.keepOf(a), B = s.keepOf(b); return Math.hypot(A.x - k.x, A.y - k.y) - Math.hypot(B.x - k.x, B.y - k.y); })[0];
  }

  // where you need help: the last place you were hit (last 20 s), or your keep
  helpPoint() {
    const last = this.s.lastHitOnMe;
    if (last && this.now - last.t < 20000) return last;
    return this.s.keepOf(TEAM.PLAYER);
  }

  askAttack(to) {
    const foe = this.enemyForMe();
    this.say(TEAM.PLAYER, t('⚔️ هاجم معي!'));
    if (!foe) return;
    this.s.playerFocus = foe;
    for (const a of this.targets(to)) {
      const n = this.s.ais[a]?.commander.attackFor(foe) || 0;
      this.reply(a, n ? t('⚔️ حسناً! أهاجم {0} بـ{1} جندي', nameOf(foe), n) : t('😓 جيشي صغير الآن، سأهاجم حين يكتمل'));
    }
  }

  askDefend(to) {
    const p = this.helpPoint();
    this.say(TEAM.PLAYER, t('🛡 دافع عني!'));
    for (const a of this.targets(to)) {
      const n = this.s.ais[a]?.commander.helpAt(p.x, p.y) || 0;
      this.reply(a, n ? t('🛡 قادم إليك بـ{0} جندي!', n) : t('😓 لا أملك جنوداً الآن'));
    }
  }

  askResource(to, r) {
    const N = RES_NAME();
    this.say(TEAM.PLAYER, t('🙏 أحتاج {0}', N[r]));
    for (const a of this.targets(to)) {
      const eco = this.s.eco[a];
      const spare = Math.floor((eco.res[r] - 150) / 50) * 50;
      const n = Math.min(200, spare);
      if (n >= 50 && eco.spend({ [r]: n })) {
        this.s.economy.add(r, n);
        this.reply(a, t('🎁 خذ {0} {1}', n, N[r]));
      } else this.reply(a, t('😓 لا أملك ما يكفي من {0} الآن', N[r]));
    }
  }

  give(to, r, n = 100) {
    const list = this.targets(to);
    if (!list.length || !this.s.economy.spend({ [r]: n })) return false;
    const each = Math.floor(n / list.length);
    for (const a of list) this.s.eco[a].add(r, each);
    this.say(TEAM.PLAYER, t('🎁 أرسلت {0} {1}', n, RES_NAME()[r]));
    this.reply(list[0], t('🙏 شكراً يا صديقي!'));
    return true;
  }

  targets(to) { return to === 'all' || !to ? this.allies() : this.allies().filter(a => a === to); }

  // answers come a moment later, as if the ally typed them
  reply(from, text, actions) { this.s.time.delayedCall(500 + Math.random() * 500, () => this.say(from, text, actions)); }

  // ---------------- what THEY ask ----------------
  allyMarches(ally, foe, n) {
    if (!foe || !this.ready('march' + ally, 60000)) return;
    this.say(ally, t('⚔️ سأهاجم {0} بـ{1} جندي، انضم إلي!', nameOf(foe), n), [
      { label: t('⚔️ انضم'), fn: () => this.sendMyArmy(this.s.ais[ally]?.commander.target || this.s.keepOf(foe)) },
      { label: '✕' },
    ]);
  }

  // your soldiers that aren't doing anything
  myIdleArmy() { return this.s.units.filter(u => u.alive && u.team === TEAM.PLAYER && u.def.damage && u.kind !== 'worker' && !u.hidden && (u.state === 'idle' || u.state === 'patrol')); }

  sendMyArmy(target) {
    const army = this.myIdleArmy();
    if (!army.length || !target) { this.say(TEAM.PLAYER, t('😓 ليس لدي جنود متفرغون')); return; }
    this.s.commandGroup(army, target.x, target.y, 'attackMove');
    this.s.fx?.marker(target.x, target.y, true);
    this.say(TEAM.PLAYER, t('⚔️ جنودي في الطريق ({0})', army.length));
  }

  update(dt) {
    if ((this.thinkT += dt) < 3000) return;
    this.thinkT = 0;
    const s = this.s, me = s.economy;
    if (this.now - this.lastAsk < 40000) return;          // at most one request every 40 s
    for (const a of this.allies()) {
      const keep = s.keepOf(a), eco = s.eco[a], N = RES_NAME();
      // 1) their keep is under attack
      const foes = s.units.filter(u => u.alive && hostile(u.team, a) && u.def.damage && Math.hypot(u.x - keep.x, u.y - keep.y) < TILE * 12).length;
      if (foes >= 4 && this.myIdleArmy().length >= 3 && this.ready('help' + a, 90000)) {
        this.lastAsk = this.now;
        this.say(a, t('🆘 العدو يهاجم قلعتي! أرسل جنودك'), [
          { label: t('⚔️ قادم!'), fn: () => this.sendMyArmy(keep) },
          { label: '✕' },
        ]);
        return;
      }
      // 2) they're short of something you have lots of
      for (const r of RES) {
        if (eco.res[r] < 60 && me.res[r] >= 300 && this.now > 120000 && this.ready('need' + a + r, 150000)) {
          this.lastAsk = this.now;
          this.say(a, t('🙏 أحتاج {0}، هل ترسل لي 100؟', N[r]), [
            { label: t('🎁 أرسل 100'), fn: () => { if (!this.give(a, r)) s.events.emit('toast', t('❌ لا يكفي')); } },
            { label: '✕' },
          ]);
          return;
        }
      }
      // 3) they're rich in something you lack: a gift, no question asked
      for (const r of RES) {
        if (eco.res[r] > 900 && me.res[r] < 80 && this.ready('gift' + a + r, 180000)) {
          eco.spend({ [r]: 150 }); me.add(r, 150);
          this.lastAsk = this.now;
          this.say(a, t('🎁 رأيتك تحتاج {0}، أرسلت لك 150', N[r]));
          return;
        }
      }
    }
  }
}
