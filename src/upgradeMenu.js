// upgradeMenu.js — Level-up screen: per-player upgrades with network support

import { WEAPON_DEFS, addWeapon, levelUpWeapon } from "./weaponManager.js";
import { shuffle } from "./utils.js";

let overlay = null;
let _isOpen = false;

const MAX_WEAPON_SLOTS = 6;

// Passive upgrade definitions
const PASSIVE_UPGRADES = [
  {
    id: "maxHp",
    name: "+20 Max HP",
    description: "Increases your maximum HP by 20 and heals you.",
    apply(playerObj) {
      playerObj.maxHp += 20;
      playerObj.hp = Math.min(playerObj.hp + 20, playerObj.maxHp);
    },
  },
  {
    id: "speed",
    name: "+10% Speed",
    description: "Move faster.",
    apply(playerObj) {
      playerObj.speed *= 1.1;
    },
  },
  {
    id: "pickup",
    name: "+30% Pickup Radius",
    description: "Collect XP gems from farther away.",
    apply(playerObj) {
      playerObj.pickupRadius *= 1.3;
    },
  },
  {
    id: "armor",
    name: "+2 Armor",
    description: "Reduces all incoming damage.",
    apply(playerObj) {
      playerObj.armor += 2;
    },
  },
  {
    id: "heal",
    name: "Heal 30 HP",
    description: "Recover some health.",
    apply(playerObj) {
      playerObj.hp = Math.min(playerObj.hp + 30, playerObj.maxHp);
    },
  },
];

export function createUpgradeMenu() {
  // Create the overlay container once
  overlay = document.createElement("div");
  overlay.id = "upgrade-overlay";
  overlay.style.cssText = `
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.8);
    display: none; flex-direction: column;
    align-items: center; justify-content: center;
    z-index: 500;
    font-family: 'Segoe UI', Tahoma, sans-serif;
  `;
  document.body.appendChild(overlay);
}

export function isUpgradeMenuOpen() {
  return _isOpen;
}

/**
 * Generate upgrade choices for a specific player.
 * Returns an array of choice objects.
 */
export function generateUpgradeChoices(playerObj) {
  const options = [];

  // New weapons (if slots available)
  const equippedIds = new Set(playerObj.weapons.map((w) => w.id));
  if (playerObj.weapons.length < MAX_WEAPON_SLOTS) {
    for (const [id, def] of Object.entries(WEAPON_DEFS)) {
      if (!equippedIds.has(id)) {
        options.push({
          type: "newWeapon",
          id,
          name: `NEW: ${def.name}`,
          description: def.description,
        });
      }
    }
  }

  // Weapon level ups
  for (const w of playerObj.weapons) {
    const def = WEAPON_DEFS[w.id];
    if (w.level < def.maxLevel) {
      options.push({
        type: "levelWeapon",
        id: w.id,
        name: `${def.name} Lv${w.level + 1}`,
        description: `Upgrade ${def.name} to level ${w.level + 1}.`,
      });
    }
  }

  // Passive upgrades
  for (const passive of PASSIVE_UPGRADES) {
    options.push({
      type: "passive",
      id: passive.id,
      name: passive.name,
      description: passive.description,
    });
  }

  // Shuffle and pick 3
  shuffle(options);
  return options.slice(0, 3);
}

/**
 * Show the upgrade menu UI with given choices.
 * @param {Array} choices - Array of choice objects
 * @param {string} playerLabel - Label like "Player 1" or "Player 2"
 * @param {Function} onPick - Callback(choiceIndex) when user picks
 */
export function showUpgradeMenuUI(choices, playerLabel, onPick) {
  _isOpen = true;

  overlay.innerHTML = `
    <h2 style="color: #ffcc00; font-size: 36px; margin-bottom: 8px; text-shadow: 0 0 10px #ffcc00;">
      LEVEL UP!
    </h2>
    <div style="color: #aaa; font-size: 16px; margin-bottom: 20px;">${playerLabel} — Choose an upgrade:</div>
    <div id="upgrade-cards" style="display: flex; gap: 16px; flex-wrap: wrap; justify-content: center;"></div>
  `;

  const cardsContainer = overlay.querySelector("#upgrade-cards");

  choices.forEach((choice, index) => {
    const card = document.createElement("div");
    card.style.cssText = `
      width: 220px; padding: 24px 18px;
      background: linear-gradient(135deg, #1a1a3e, #2a2a5e);
      border: 2px solid #444;
      border-radius: 12px;
      cursor: pointer;
      transition: transform 0.15s, border-color 0.15s;
      text-align: center;
    `;

    const typeLabel =
      choice.type === "newWeapon"
        ? '<span style="color:#44ff44; font-size:12px;">NEW WEAPON</span>'
        : choice.type === "levelWeapon"
          ? '<span style="color:#44aaff; font-size:12px;">WEAPON UPGRADE</span>'
          : '<span style="color:#ffaa44; font-size:12px;">PASSIVE</span>';

    card.innerHTML = `
      ${typeLabel}
      <h3 style="color: #fff; margin: 10px 0 8px; font-size: 18px;">${choice.name}</h3>
      <p style="color: #aaa; font-size: 13px; line-height: 1.4;">${choice.description}</p>
    `;

    card.addEventListener("mouseenter", () => {
      card.style.transform = "scale(1.05)";
      card.style.borderColor = "#ffcc00";
    });
    card.addEventListener("mouseleave", () => {
      card.style.transform = "scale(1)";
      card.style.borderColor = "#444";
    });

    card.addEventListener("click", () => {
      onPick(index);
    });

    cardsContainer.appendChild(card);
  });

  overlay.style.display = "flex";
}

/**
 * Apply an upgrade choice to a player.
 */
export function applyUpgradeChoice(choice, playerObj) {
  switch (choice.type) {
    case "newWeapon":
      addWeapon(playerObj, choice.id);
      break;
    case "levelWeapon":
      levelUpWeapon(playerObj, choice.id);
      break;
    case "passive": {
      const passive = PASSIVE_UPGRADES.find((p) => p.id === choice.id);
      if (passive) passive.apply(playerObj);
      break;
    }
  }
}

/**
 * Hide the upgrade menu and unpause.
 */
export function hideUpgradeMenu() {
  _isOpen = false;
  overlay.style.display = "none";
  overlay.innerHTML = "";
}
