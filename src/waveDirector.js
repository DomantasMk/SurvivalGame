// waveDirector.js — Wave timing, difficulty scaling over time (multiplayer)

import { spawnEnemy, ENEMY_TYPES } from "./enemyManager.js";
import { randomRange } from "./utils.js";
import { gameState } from "./main.js";

let spawnTimer = 0;
let bossTimer = 0;

// Difficulty configuration
const BASE_SPAWN_INTERVAL = 2.0; // seconds between spawn waves
const MIN_SPAWN_INTERVAL = 0.5;
const BASE_ENEMIES_PER_WAVE = 2;
const BOSS_INTERVAL = 360; // 6 minutes

const SPAWN_DISTANCE_MIN = 18;
const SPAWN_DISTANCE_MAX = 25;

export function createWaveDirector() {
  spawnTimer = 0;
  bossTimer = 0;
}

/**
 * Update spawning logic.
 * @param {number} delta
 * @param {Array} players - Array of alive player objects (for spawn positioning)
 */
export function updateWaveDirector(delta, players) {
  const time = gameState.gameTime;

  // --- Compute current difficulty ---
  const difficultyFactor = Math.min(time / 900, 1); // ramp over 15 minutes to max
  const spawnInterval =
    BASE_SPAWN_INTERVAL -
    (BASE_SPAWN_INTERVAL - MIN_SPAWN_INTERVAL) * difficultyFactor;
  // Scale enemy count based on alive player count (1 player = 1x, 2 = 1.6x, ... 5 = 3.4x)
  const alivePlayers = players.filter((p) => p.alive);
  const multiplayerScale = 1 + (alivePlayers.length - 1) * 0.6;
  const enemiesPerWave = Math.floor(
    (BASE_ENEMIES_PER_WAVE + difficultyFactor * 7) * multiplayerScale,
  );

  // --- Spawn timer ---
  spawnTimer -= delta;
  if (spawnTimer <= 0) {
    spawnTimer = spawnInterval;
    _spawnWave(players, enemiesPerWave, time);
  }

  // --- Boss timer ---
  bossTimer += delta;
  if (bossTimer >= BOSS_INTERVAL) {
    bossTimer -= BOSS_INTERVAL;
    _spawnBoss(players);
  }
}

function _spawnWave(players, count, time) {
  // Spawn around a random alive player (or center if none)
  const alivePlayers = players.filter((p) => p.alive);
  const target =
    alivePlayers.length > 0
      ? alivePlayers[Math.floor(Math.random() * alivePlayers.length)]
      : null;
  const px = target ? target.mesh.position.x : 0;
  const pz = target ? target.mesh.position.z : 0;

  for (let i = 0; i < count; i++) {
    const angle = randomRange(0, Math.PI * 2);
    const dist = randomRange(SPAWN_DISTANCE_MIN, SPAWN_DISTANCE_MAX);
    const x = px + Math.cos(angle) * dist;
    const z = pz + Math.sin(angle) * dist;

    // Choose enemy type based on game time
    let type = "bat";
    if (time >= 270) {
      // After 4.5 min: mix of all normal types
      const roll = Math.random();
      if (roll < 0.25) type = "zombie";
      else if (roll < 0.55) type = "skeleton";
      else type = "bat";
    } else if (time >= 90) {
      // After 1.5 min: bats and skeletons
      type = Math.random() < 0.4 ? "skeleton" : "bat";
    }

    // Scale HP with difficulty
    spawnEnemy(type, x, z);
  }
}

function _spawnBoss(players) {
  const alivePlayers = players.filter((p) => p.alive);
  const target =
    alivePlayers.length > 0
      ? alivePlayers[Math.floor(Math.random() * alivePlayers.length)]
      : null;
  const px = target ? target.mesh.position.x : 0;
  const pz = target ? target.mesh.position.z : 0;
  const angle = randomRange(0, Math.PI * 2);
  const dist = SPAWN_DISTANCE_MAX;
  spawnEnemy("boss", px + Math.cos(angle) * dist, pz + Math.sin(angle) * dist);
}

export function resetWaveDirector() {
  spawnTimer = 0;
  bossTimer = 0;
}
