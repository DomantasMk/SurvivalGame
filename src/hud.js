// hud.js — HTML overlay: HP bar, XP bar, timer, kill count

import { getXpForNextLevel } from "./xpManager.js";

let container;
let hpBar, hpText;
let xpBar, levelText;
let timerText, killText;

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

  // HP Bar
  const hpContainer = document.createElement("div");
  hpContainer.style.cssText = `
    width: 260px; height: 18px;
    background: rgba(0,0,0,0.5);
    border-radius: 9px; overflow: hidden;
    position: relative;
    border: 1px solid rgba(255,255,255,0.15);
  `;

  hpBar = document.createElement("div");
  hpBar.style.cssText = `
    height: 100%; width: 100%;
    background: linear-gradient(90deg, #ff4444, #ff6666);
    border-radius: 9px;
    transition: width 0.15s;
  `;
  hpContainer.appendChild(hpBar);

  hpText = document.createElement("div");
  hpText.style.cssText = `
    position: absolute; inset: 0;
    display: flex; align-items: center; justify-content: center;
    color: #fff; font-size: 11px; font-weight: bold;
    text-shadow: 0 1px 2px #000;
  `;
  hpContainer.appendChild(hpText);
  container.appendChild(hpContainer);

  // XP Bar
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

export function updateHud(player, gameState) {
  // HP
  const hpPct = Math.max(0, (player.hp / player.maxHp) * 100);
  hpBar.style.width = `${hpPct}%`;
  hpText.textContent = `${Math.ceil(player.hp)} / ${player.maxHp}`;

  // XP
  const needed = getXpForNextLevel(player.level);
  const xpPct = Math.min(100, (player.xp / needed) * 100);
  xpBar.style.width = `${xpPct}%`;
  levelText.textContent = `Lv ${player.level}`;

  // Timer
  const totalSec = Math.floor(gameState.gameTime);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  timerText.textContent = `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;

  // Kills
  killText.textContent = `Kills: ${player.kills}`;
}
