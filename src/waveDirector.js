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

// Arena bounds (must match ARENA_HALF in main.js)
const ARENA_HALF = 50;

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

/**
 * Check if a spawn position is far enough from all alive players.
 * @returns {boolean} true if the position is safe to spawn at
 */
function _isSafeSpawn(x, z, alivePlayers, minDist) {
  for (const p of alivePlayers) {
    const dx = p.mesh.position.x - x;
    const dz = p.mesh.position.z - z;
    if (dx * dx + dz * dz < minDist * minDist) return false;
  }
  return true;
}

/**
 * Generate a spawn position around (px, pz) that is safe from all alive players.
 * Retries up to MAX_RETRIES times; falls back to last attempted position.
 */
const MAX_SPAWN_RETRIES = 8;

function _safeSpawnPosition(px, pz, alivePlayers, minDist, maxDist) {
  for (let attempt = 0; attempt < MAX_SPAWN_RETRIES; attempt++) {
    const angle = randomRange(0, Math.PI * 2);
    const dist = randomRange(minDist, maxDist);
    const x = Math.max(
      -ARENA_HALF,
      Math.min(ARENA_HALF, px + Math.cos(angle) * dist),
    );
    const z = Math.max(
      -ARENA_HALF,
      Math.min(ARENA_HALF, pz + Math.sin(angle) * dist),
    );
    if (_isSafeSpawn(x, z, alivePlayers, SPAWN_DISTANCE_MIN)) return { x, z };
  }
  // Fallback: spawn at max distance in a random direction from center
  const angle = randomRange(0, Math.PI * 2);
  return {
    x: Math.max(
      -ARENA_HALF,
      Math.min(ARENA_HALF, px + Math.cos(angle) * maxDist),
    ),
    z: Math.max(
      -ARENA_HALF,
      Math.min(ARENA_HALF, pz + Math.sin(angle) * maxDist),
    ),
  };
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
    const { x, z } = _safeSpawnPosition(
      px,
      pz,
      alivePlayers,
      SPAWN_DISTANCE_MIN,
      SPAWN_DISTANCE_MAX,
    );

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
  const { x: bx, z: bz } = _safeSpawnPosition(
    px,
    pz,
    alivePlayers,
    SPAWN_DISTANCE_MAX,
    SPAWN_DISTANCE_MAX + 5,
  );
  spawnEnemy("boss", bx, bz);
}

export function resetWaveDirector() {
  spawnTimer = 0;
  bossTimer = 0;
}
