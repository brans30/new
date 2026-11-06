import { hostile, allied } from '../systems/Match.js';
// Shared base for everything that has a team and health (units + buildings).
export class Entity extends Phaser.GameObjects.Sprite {
  constructor(scene, x, y, texture, frame, team, maxHp) {
    super(scene, x, y, texture, frame);
    scene.add.existing(this);
    this.team = team;
    this.maxHp = maxHp;
    this.hp = maxHp;
    this.alive = true;
    this.radius = 6;          // used for distance / range / hit-testing
  }

  isEnemyOf(other) { return other && hostile(other.team, this.team); }

  takeDamage(amount, attacker) {
    if (!this.alive) return;
    this.hp -= amount;
    // white flash; one timer at a time even when hit many times a second
    if (!this.flashing) {
      this.flashing = true;
      this.setTintFill(0xffffff);
      this.scene.time.delayedCall(70, () => { this.flashing = false; if (this.alive) this.clearTint(); });
    }
    this.onDamaged?.(attacker);
    if (this.hp <= 0) this.die();
  }

  die() {
    if (!this.alive) return;
    this.alive = false;
    this.scene.onEntityDied(this);
    // units topple over and fade (a tombstone may stay), buildings just fade (the explosion covers it)
    if (this.def && !this.def.size && this.scene.fx) return this.scene.fx.fall(this);
    this.scene.tweens.add({
      targets: this, alpha: 0, duration: 300,
      onComplete: () => this.destroy(),
    });
  }

  // distance from this entity's edge to another entity's edge
  edgeDist(other) {
    return Phaser.Math.Distance.Between(this.x, this.y, other.x, other.y)
      - this.radius - other.radius;
  }
}
