// magicWand.js — Fires a projectile toward the nearest enemy

export const magicWand = {
  name: "Magic Wand",
  description: "Fires a magic bolt at the nearest enemy.",
  baseDamage: 13,
  baseCooldown: 1.0,
  baseProjectileCount: 1,
  baseSpeed: 14,
  basePierce: 0,
  baseLifetime: 2.0,
  maxLevel: 8,
  projectileColor: 0x44ccff,
  projectileSize: 0.15,

  /** Return stats for a given weapon level. */
  getStats(level) {
    return {
      damage: this.baseDamage + level * 3,
      cooldown: Math.max(0.3, this.baseCooldown - level * 0.1),
      projectileCount: this.baseProjectileCount + Math.floor(level / 3),
      speed: this.baseSpeed,
      pierce: this.basePierce + Math.floor(level / 4),
      lifetime: this.baseLifetime,
      color: this.projectileColor,
      size: this.projectileSize,
    };
  },
};
