// upgradeMenu.js — Level-up screen: pause game, show 3 random choices

import { gameState } from "./main.js";
import {
  equippedWeapons,
  WEAPON_DEFS,
  addWeapon,
  levelUpWeapon,
} from "./weaponManager.js";
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
    apply(player) {
      player.maxHp += 20;
      player.hp = Math.min(player.hp + 20, player.maxHp);
    },
  },
  {
    id: "speed",
    name: "+10% Speed",
    description: "Move faster.",
    apply(player) {
      player.speed *= 1.1;
    },
  },
  {
    id: "pickup",
    name: "+30% Pickup Radius",
    description: "Collect XP gems from farther away.",
    apply(player) {
      player.pickupRadius *= 1.3;
    },
  },
  {
    id: "armor",
    name: "+2 Armor",
    description: "Reduces all incoming damage.",
    apply(player) {
      player.armor += 2;
    },
  },
  {
    id: "heal",
    name: "Heal 30 HP",
    description: "Recover some health.",
    apply(player) {
      player.hp = Math.min(player.hp + 30, player.maxHp);
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

export function showUpgradeMenu(player) {
  _isOpen = true;
  gameState.paused = true;

  const choices = _generateChoices();
  _renderChoices(choices, player);

  overlay.style.display = "flex";
}

function _hideMenu() {
  _isOpen = false;
  gameState.paused = false;
  overlay.style.display = "none";
  overlay.innerHTML = "";
}

function _generateChoices() {
  const options = [];

  // New weapons (if slots available)
  const equippedIds = new Set(equippedWeapons.map((w) => w.id));
  if (equippedWeapons.length < MAX_WEAPON_SLOTS) {
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
  for (const w of equippedWeapons) {
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

function _renderChoices(choices, player) {
  overlay.innerHTML = `
    <h2 style="color: #ffcc00; font-size: 36px; margin-bottom: 24px; text-shadow: 0 0 10px #ffcc00;">
      LEVEL UP!
    </h2>
    <div style="color: #ccc; font-size: 16px; margin-bottom: 20px;">Choose an upgrade:</div>
    <div id="upgrade-cards" style="display: flex; gap: 16px; flex-wrap: wrap; justify-content: center;"></div>
  `;

  const cardsContainer = overlay.querySelector("#upgrade-cards");

  for (const choice of choices) {
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
      _applyChoice(choice, player);
      _hideMenu();
    });

    cardsContainer.appendChild(card);
  }
}

function _applyChoice(choice, player) {
  switch (choice.type) {
    case "newWeapon":
      addWeapon(choice.id);
      break;
    case "levelWeapon":
      levelUpWeapon(choice.id);
      break;
    case "passive": {
      const passive = PASSIVE_UPGRADES.find((p) => p.id === choice.id);
      if (passive) passive.apply(player);
      break;
    }
  }
}
