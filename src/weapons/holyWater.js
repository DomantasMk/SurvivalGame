// holyWater.js — Drops a damaging zone on the ground

export const holyWater = {
  name: "Holy Water",
  description: "Drops a damaging pool on the ground.",
  baseDamage: 10,
  baseCooldown: 2.5,
  baseArea: 3.0,
  baseDuration: 2.5,
  maxLevel: 8,

  getStats(level) {
    return {
      damage: this.baseDamage + level * 3,
      cooldown: Math.max(1.0, this.baseCooldown - level * 0.2),
      area: this.baseArea + level * 0.3,
      duration: this.baseDuration + level * 0.3,
    };
  },
};
