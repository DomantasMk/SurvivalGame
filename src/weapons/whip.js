// whip.js — Short-range arc in front of player, hits multiple enemies

export const whip = {
  name: "Whip",
  description: "Slashes a wide arc in front of you.",
  baseDamage: 18,
  baseCooldown: 1.3,
  baseArea: 3.0,
  maxLevel: 8,

  getStats(level) {
    return {
      damage: this.baseDamage + level * 5,
      cooldown: Math.max(0.4, this.baseCooldown - level * 0.1),
      area: this.baseArea + level * 0.4,
    };
  },
};
