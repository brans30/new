// Resources and population for one team: one single source of truth.
// Emits 'changed' whenever anything changes so the UI can update.
// Also remembers what we recently could NOT afford ("shortages"),
// so the worker manager can send more workers to that resource.
export class Economy extends Phaser.Events.EventEmitter {
  constructor(start, clock = () => performance.now()) {
    super();
    this.res = { ...start };
    this.pop = 0;
    this.popCap = 0;
    this.clock = clock;
    this.short = {};          // type -> { amount, at }
    this.upgrades = {};       // researched at the blacksmith: { tools: true, ... }
  }
  canAfford(cost = {}) {
    return Object.entries(cost).every(([k, v]) => (this.res[k] || 0) >= v);
  }
  spend(cost = {}) {
    if (!this.canAfford(cost)) { this.noteShort(cost); return false; }
    for (const [k, v] of Object.entries(cost)) this.res[k] -= v;
    this.emit('changed');
    return true;
  }
  // we wanted something but couldn't pay: remember what was missing
  noteShort(cost = {}) {
    for (const [k, v] of Object.entries(cost)) {
      const missing = v - (this.res[k] || 0);
      if (missing > 0) this.short[k] = { amount: Math.max(missing, this.shortage(k)), at: this.clock() };
    }
  }
  // how much of `type` we are still missing (forgotten after 60 s or once we have it)
  shortage(type) {
    const s = this.short[type];
    if (!s) return 0;
    if (this.clock() - s.at > 60000 || (this.res[type] || 0) >= s.amount) { delete this.short[type]; return 0; }
    return s.amount - (this.res[type] || 0);
  }
  refund(cost = {}) {
    for (const [k, v] of Object.entries(cost)) this.res[k] = (this.res[k] || 0) + v;
    this.emit('changed');
  }
  add(type, amount) {
    this.res[type] = (this.res[type] || 0) + amount;
    this.emit('changed');
  }
  setPop(pop, cap) {
    if (pop === this.pop && cap === this.popCap) return;
    this.pop = pop; this.popCap = cap;
    this.emit('changed');
  }
}
