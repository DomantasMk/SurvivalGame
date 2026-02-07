// hud.js — HTML overlay: HP bars for both players, XP bar, timer, kill count

import { getXpForNextLevel } from "./xpManager.js";

let container;
let p1HpBar, p1HpText;
let p2HpBar, p2HpText;
let xpBar, levelText;
let timerText, killText;

/**
 * Create HUD elements for two-player display.
 */
export function createHud() {
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
    gap: 6px;
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

  // --- Player 1 HP Bar ---
  const p1Row = document.createElement("div");
  p1Row.style.cssText = `display: flex; align-items: center; gap: 8px;`;

  const p1Label = document.createElement("div");
  p1Label.style.cssText = `color: #4488ff; font-size: 12px; font-weight: bold; text-shadow: 0 1px 2px #000; min-width: 20px;`;
  p1Label.textContent = "P1";
  p1Row.appendChild(p1Label);

  const p1HpContainer = document.createElement("div");
  p1HpContainer.style.cssText = `
    width: 220px; height: 16px;
    background: rgba(0,0,0,0.5);
    border-radius: 8px; overflow: hidden;
    position: relative;
    border: 1px solid rgba(68,136,255,0.3);
  `;

  p1HpBar = document.createElement("div");
  p1HpBar.style.cssText = `
    height: 100%; width: 100%;
    background: linear-gradient(90deg, #3366cc, #4488ff);
    border-radius: 8px;
    transition: width 0.15s;
  `;
  p1HpContainer.appendChild(p1HpBar);

  p1HpText = document.createElement("div");
  p1HpText.style.cssText = `
    position: absolute; inset: 0;
    display: flex; align-items: center; justify-content: center;
    color: #fff; font-size: 10px; font-weight: bold;
    text-shadow: 0 1px 2px #000;
  `;
  p1HpContainer.appendChild(p1HpText);
  p1Row.appendChild(p1HpContainer);
  container.appendChild(p1Row);

  // --- Player 2 HP Bar ---
  const p2Row = document.createElement("div");
  p2Row.style.cssText = `display: flex; align-items: center; gap: 8px;`;

  const p2Label = document.createElement("div");
  p2Label.style.cssText = `color: #ff4444; font-size: 12px; font-weight: bold; text-shadow: 0 1px 2px #000; min-width: 20px;`;
  p2Label.textContent = "P2";
  p2Row.appendChild(p2Label);

  const p2HpContainer = document.createElement("div");
  p2HpContainer.style.cssText = `
    width: 220px; height: 16px;
    background: rgba(0,0,0,0.5);
    border-radius: 8px; overflow: hidden;
    position: relative;
    border: 1px solid rgba(255,68,68,0.3);
  `;

  p2HpBar = document.createElement("div");
  p2HpBar.style.cssText = `
    height: 100%; width: 100%;
    background: linear-gradient(90deg, #cc3333, #ff4444);
    border-radius: 8px;
    transition: width 0.15s;
  `;
  p2HpContainer.appendChild(p2HpBar);

  p2HpText = document.createElement("div");
  p2HpText.style.cssText = `
    position: absolute; inset: 0;
    display: flex; align-items: center; justify-content: center;
    color: #fff; font-size: 10px; font-weight: bold;
    text-shadow: 0 1px 2px #000;
  `;
  p2HpContainer.appendChild(p2HpText);
  p2Row.appendChild(p2HpContainer);
  container.appendChild(p2Row);

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
 * Update HUD with both players' info.
 * @param {object} localPlayer - The local player (for XP bar)
 * @param {object} player1 - Player 1 object
 * @param {object} player2 - Player 2 object
 * @param {object} gameState - Game state object
 */
export function updateHud(localPlayer, player1, player2, gameState) {
  // Player 1 HP
  const p1HpPct = Math.max(0, (player1.hp / player1.maxHp) * 100);
  p1HpBar.style.width = `${p1HpPct}%`;
  p1HpText.textContent = player1.alive
    ? `${Math.ceil(player1.hp)} / ${player1.maxHp}`
    : "DEAD";

  // Player 2 HP
  const p2HpPct = Math.max(0, (player2.hp / player2.maxHp) * 100);
  p2HpBar.style.width = `${p2HpPct}%`;
  p2HpText.textContent = player2.alive
    ? `${Math.ceil(player2.hp)} / ${player2.maxHp}`
    : "DEAD";

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
