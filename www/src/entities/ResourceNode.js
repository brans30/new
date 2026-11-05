import { RESOURCE_NODES, MINE_RELEASE_MS, TEAM } from '../data/config.js';

// A tree, rock, quarry or gold mine on the map.
//
// Mines (gold, quarry) can be OWNED:
//   - they start neutral (wooden look)
//   - the first side whose worker starts mining one takes it: it turns that side's colour
//   - only the owner can mine it
//   - with no owner worker on it for 10 s it becomes neutral again,
//     so you take an enemy mine by driving its workers away
export class ResourceNode extends Phaser.GameObjects.Sprite {
  constructor(scene, x, y, kind) {
    const def = RESOURCE_NODES[kind];
    super(scene, x, y, def.sheet, Phaser.Utils.Array.GetRandom(def.frames));
    scene.add.existing(this);
    this.kind = kind;
    this.def = def;
    this.type = def.type;        // 'wood' | 'gold' | 'stone'
    this.amount = def.amount;
    this.alive = true;
    this.radius = 6;
    this.depth = y + 6;
    this.owner = null;           // mines only: team that owns it
    this.lastWork = 0;
  }

  tilesIndex(w) { return new Set([this.ty * w + this.tx]); }

  // ---------- ownership (mines) ----------
  canGather(team) { return !this.def.mine || !this.owner || this.owner === team; }

  // a worker of `team` is mining here right now
  onWork(team, now) {
    if (!this.def.mine) return;
    if (!this.owner) this.setOwner(team);
    if (this.owner === team) this.lastWork = now;
  }

  setOwner(team) {
    if (this.owner === team) return;
    const old = this.owner;
    this.owner = team;
    this.setTexture(team ? `resources_${team}` : 'resources_wood', this.frame.name);
    // a little flash so the change is noticed
    this.scene.tweens.add({ targets: this, scale: 1.25, duration: 120, yoyo: true });
    this.scene.onMineOwner?.(this, old, team);
  }

  // called about once a second
  checkOwner(now) {
    if (this.def.mine && this.owner && now - this.lastWork > MINE_RELEASE_MS) this.setOwner(null);
  }

  take(n) {
    const got = Math.min(n, this.amount);
    this.amount -= got;
    if (this.amount <= 0) this.deplete();
    return got;
  }

  deplete() {
    this.alive = false;
    this.scene.onNodeDepleted(this);
    if (this.def.stump !== undefined) { this.setFrame(this.def.stump); this.depth = this.y - 8; this.scene.stumps.push(this); }   // leave a stump
    else this.destroy();
  }
}

export { TEAM };
