// hud.js — HTML overlay: HP bars for N players, XP bar, timer, kill count

import { getXpForNextLevel } from "./xpManager.js";

let container;
let xpBar, levelText;
let timerText, killText;

// Dynamic arrays for N player HP bars
const _hpBars = []; // { bar, text } per player
let _playerCount = 0;

// Gradient color pairs for HP bars (darker, lighter) per player color
const BAR_GRADIENTS = [
  ["#3366cc", "#4488ff"], // blue
  ["#cc3333", "#ff4444"], // red
  ["#33aa33", "#44cc44"], // green
  ["#7733aa", "#aa44ff"], // purple
  ["#cc6600", "#ff8800"], // orange
];

/**
 * Create HUD elements for N-player display.
 * @param {number} playerCount - Number of players
 * @param {string[]} hexColors - Array of hex color strings for each player
 */
export function createHud(playerCount, hexColors) {
  _playerCount = playerCount;

  container = document.createElement("div");
  container.id = "hud";
  container.style.cssText = `
    position: fixed;
    top: 0; left: 0; right: 0;
    pointer-events: none;
    z-index: 100;
    font-family: 'Segoe UI', Tahoma, sans-serif;
    padding: 12px 16px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  `;

  // Top row: timer and kill count
  const topRow = document.createElement("div");
  topRow.style.cssText = `display: flex; justify-content: space-between; align-items: center;`;

  timerText = document.createElement("div");
  timerText.style.cssText = `color: #fff; font-size: 22px; font-weight: bold; text-shadow: 0 1px 4px #000;`;
  timerText.textContent = "00:00";

  killText = document.createElement("div");
  killText.style.cssText = `color: #ff8888; font-size: 18px; font-weight: bold; text-shadow: 0 1px 4px #000;`;
  killText.textContent = "Kills: 0";

  topRow.appendChild(timerText);
  topRow.appendChild(killText);
  container.appendChild(topRow);

  // --- Dynamic Player HP Bars ---
  for (let i = 0; i < playerCount; i++) {
    const color = hexColors[i % hexColors.length];
    const gradient = BAR_GRADIENTS[i % BAR_GRADIENTS.length];

    const row = document.createElement("div");
    row.style.cssText = `display: flex; align-items: center; gap: 8px;`;

    const label = document.createElement("div");
    label.style.cssText = `color: ${color}; font-size: 12px; font-weight: bold; text-shadow: 0 1px 2px #000; min-width: 20px;`;
    label.textContent = `P${i + 1}`;
    row.appendChild(label);

    const hpContainer = document.createElement("div");
    hpContainer.style.cssText = `
      width: 200px; height: 14px;
      background: rgba(0,0,0,0.5);
      border-radius: 8px; overflow: hidden;
      position: relative;
      border: 1px solid ${color}44;
    `;

    const hpBar = document.createElement("div");
    hpBar.style.cssText = `
      height: 100%; width: 100%;
      background: linear-gradient(90deg, ${gradient[0]}, ${gradient[1]});
      border-radius: 8px;
      transition: width 0.15s;
    `;
    hpContainer.appendChild(hpBar);

    const hpText = document.createElement("div");
    hpText.style.cssText = `
      position: absolute; inset: 0;
      display: flex; align-items: center; justify-content: center;
      color: #fff; font-size: 10px; font-weight: bold;
      text-shadow: 0 1px 2px #000;
    `;
    hpContainer.appendChild(hpText);
    row.appendChild(hpContainer);
    container.appendChild(row);

    _hpBars.push({ bar: hpBar, text: hpText });
  }

  // --- XP Bar (for local player) ---
  const xpContainer = document.createElement("div");
  xpContainer.style.cssText = `
    width: 260px; height: 12px;
    background: rgba(0,0,0,0.5);
    border-radius: 6px; overflow: hidden;
    position: relative;
    border: 1px solid rgba(255,255,255,0.1);
  `;

  xpBar = document.createElement("div");
  xpBar.style.cssText = `
    height: 100%; width: 0%;
    background: linear-gradient(90deg, #44aaff, #66ccff);
    border-radius: 6px;
    transition: width 0.1s;
  `;
  xpContainer.appendChild(xpBar);

  levelText = document.createElement("div");
  levelText.style.cssText = `
    position: absolute; inset: 0;
    display: flex; align-items: center; justify-content: center;
    color: #fff; font-size: 9px; font-weight: bold;
    text-shadow: 0 1px 2px #000;
  `;
  xpContainer.appendChild(levelText);
  container.appendChild(xpContainer);

  document.body.appendChild(container);
}

/**
 * Update HUD with all players' info.
 * @param {object} localPlayer - The local player (for XP bar)
 * @param {Array} allPlayers - Array of all player objects
 * @param {object} gameState - Game state object
 */
export function updateHud(localPlayer, allPlayers, gameState) {
  // Update each player's HP bar
  for (let i = 0; i < _hpBars.length && i < allPlayers.length; i++) {
    const p = allPlayers[i];
    const hpPct = Math.max(0, (p.hp / p.maxHp) * 100);
    _hpBars[i].bar.style.width = `${hpPct}%`;
    _hpBars[i].text.textContent = p.alive
      ? `${Math.ceil(p.hp)} / ${p.maxHp}`
      : "DEAD";
  }

  // XP (local player)
  const needed = getXpForNextLevel(localPlayer.level);
  const xpPct = Math.min(100, (localPlayer.xp / needed) * 100);
  xpBar.style.width = `${xpPct}%`;
  levelText.textContent = `Lv ${localPlayer.level}`;

  // Timer
  const totalSec = Math.floor(gameState.gameTime);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  timerText.textContent = `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;

  // Kills (shared)
  killText.textContent = `Kills: ${gameState.totalKills}`;
}
