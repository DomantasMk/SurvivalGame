// garlic.js — AoE damage aura around the player

export const garlic = {
  name: "Garlic",
  description: "Damages all nearby enemies around you.",
  baseDamage: 7,
  baseCooldown: 0.7,
  baseArea: 3.5,
  maxLevel: 8,

  getStats(level) {
    return {
      damage: this.baseDamage + level * 2,
      cooldown: Math.max(0.3, this.baseCooldown - level * 0.05),
      area: this.baseArea + level * 0.5,
    };
  },
};
