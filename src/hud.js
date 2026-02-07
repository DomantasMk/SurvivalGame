// hud.js — HTML overlay: HP bars for N players, XP bar, timer, kill count

import { getXpForNextLevel } from "./xpManager.js";

let container;
let xpBar, levelText;
let timerText, killText, waveText;
let bossBarContainer, bossBar, bossHpText;
let buffContainer;

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

  // Top row: timer, wave, and kill count
  const topRow = document.createElement("div");
  topRow.style.cssText = `display: flex; justify-content: space-between; align-items: center;`;

  timerText = document.createElement("div");
  timerText.style.cssText = `color: #fff; font-size: 22px; font-weight: bold; text-shadow: 0 1px 4px #000;`;
  timerText.textContent = "00:00";

  waveText = document.createElement("div");
  waveText.style.cssText = `color: #ffcc00; font-size: 18px; font-weight: bold; text-shadow: 0 1px 4px #000; letter-spacing: 1px;`;
  waveText.textContent = "Wave 1";

  killText = document.createElement("div");
  killText.style.cssText = `color: #ff8888; font-size: 18px; font-weight: bold; text-shadow: 0 1px 4px #000;`;
  killText.textContent = "Kills: 0";

  topRow.appendChild(timerText);
  topRow.appendChild(waveText);
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

  // --- Buff Indicators (row of colored pills showing active buffs) ---
  buffContainer = document.createElement("div");
  buffContainer.style.cssText = `
    display: flex; gap: 6px; margin-top: 4px; min-height: 22px;
  `;
  container.appendChild(buffContainer);

  document.body.appendChild(container);

  // --- Boss HP Bar (centered at top, hidden by default) ---
  bossBarContainer = document.createElement("div");
  bossBarContainer.style.cssText = `
    position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
    width: 400px; display: none; flex-direction: column; align-items: center;
    z-index: 150; pointer-events: none;
    font-family: 'Segoe UI', Tahoma, sans-serif;
  `;

  const bossLabel = document.createElement("div");
  bossLabel.style.cssText = `
    color: #ff4444; font-size: 14px; font-weight: bold;
    text-shadow: 0 0 10px #ff000066; margin-bottom: 3px;
    letter-spacing: 3px;
  `;
  bossLabel.textContent = "BOSS";
  bossBarContainer.appendChild(bossLabel);

  const bossBarBg = document.createElement("div");
  bossBarBg.style.cssText = `
    width: 100%; height: 18px;
    background: rgba(0,0,0,0.6);
    border-radius: 9px; overflow: hidden;
    border: 2px solid #ff444488;
    position: relative;
  `;

  bossBar = document.createElement("div");
  bossBar.style.cssText = `
    width: 100%; height: 100%;
    background: linear-gradient(90deg, #cc0022, #ff2244);
    border-radius: 9px;
    transition: width 0.15s;
  `;
  bossBarBg.appendChild(bossBar);

  bossHpText = document.createElement("div");
  bossHpText.style.cssText = `
    position: absolute; inset: 0;
    display: flex; align-items: center; justify-content: center;
    color: #fff; font-size: 11px; font-weight: bold;
    text-shadow: 0 1px 2px #000;
  `;
  bossBarBg.appendChild(bossHpText);
  bossBarContainer.appendChild(bossBarBg);
  document.body.appendChild(bossBarContainer);
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

  // Wave number
  if (waveText) {
    waveText.textContent = `Wave ${gameState.currentWave || 1}`;
  }

  // Kills (shared)
  killText.textContent = `Kills: ${gameState.totalKills}`;

  // Active buff indicators
  if (buffContainer && localPlayer.buffs) {
    let buffHtml = "";
    const buffEntries = [
      {
        key: "doubleProjectiles",
        name: "Double Shot",
        icon: "\u2726\u2726",
        color: "#aa66ff",
      },
      {
        key: "speedBoost",
        name: "Speed",
        icon: "\u00BB",
        color: "#44ccff",
      },
      {
        key: "glowingArmor",
        name: "Armor",
        icon: "\u25C6",
        color: "#ffcc00",
      },
    ];
    for (const b of buffEntries) {
      const t = localPlayer.buffs[b.key];
      if (t > 0) {
        const secs = Math.ceil(t);
        buffHtml += `<div style="
          background: ${b.color}22; border: 1px solid ${b.color}66;
          border-radius: 6px; padding: 2px 8px;
          color: ${b.color}; font-size: 11px; font-weight: bold;
          text-shadow: 0 1px 2px #000; white-space: nowrap;
        ">${b.icon} ${b.name} ${secs}s</div>`;
      }
    }
    buffContainer.innerHTML = buffHtml;
  }

  // Boss HP bar
  if (bossBarContainer) {
    if (gameState.bossActive && gameState.bossMaxHp > 0) {
      bossBarContainer.style.display = "flex";
      const bossPct = Math.max(
        0,
        (gameState.bossHp / gameState.bossMaxHp) * 100,
      );
      bossBar.style.width = `${bossPct}%`;
      bossHpText.textContent = `${Math.ceil(gameState.bossHp)} / ${gameState.bossMaxHp}`;
    } else {
      bossBarContainer.style.display = "none";
    }
  }
}
