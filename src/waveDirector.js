// waveDirector.js — Wave timing, difficulty scaling, boss waves every 5th wave (multiplayer)

import { spawnEnemy, ENEMY_TYPES } from "./enemyManager.js";
import { randomRange } from "./utils.js";
import { gameState } from "./main.js";

let spawnTimer = 0;
let currentWave = 0;

// Boss wave announcement callback
let _bossWaveCallback = null;

// Difficulty configuration
const BASE_SPAWN_INTERVAL = 2.0; // seconds between spawn bursts
const MIN_SPAWN_INTERVAL = 0.5;
const BASE_ENEMIES_PER_WAVE = 2;
const WAVE_DURATION = 30; // seconds per wave number increment
const BOSS_WAVE_INTERVAL = 5; // boss every 5 waves (5, 10, 15, ...)

const SPAWN_DISTANCE_MIN = 18;
const SPAWN_DISTANCE_MAX = 25;

// Arena bounds (must match ARENA_HALF in main.js)
const ARENA_HALF = 50;

export function createWaveDirector() {
  spawnTimer = 0;
  currentWave = 0;
}

export function getCurrentWave() {
  return currentWave;
}

export function onBossWave(callback) {
  _bossWaveCallback = callback;
}

/**
 * Update spawning logic.
 * @param {number} delta
 * @param {Array} players - Array of alive player objects (for spawn positioning)
 */
export function updateWaveDirector(delta, players) {
  const time = gameState.gameTime;

  // --- Track wave number ---
  const newWave = Math.floor(time / WAVE_DURATION) + 1;
  if (newWave > currentWave) {
    const prevWave = currentWave;
    currentWave = newWave;

    // Check for boss wave (every 5th wave)
    if (currentWave % BOSS_WAVE_INTERVAL === 0 && currentWave > prevWave) {
      _spawnBossWave(players, currentWave);
      if (_bossWaveCallback) _bossWaveCallback(currentWave);
    }
  }

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
      // After 4.5 min: mix of all normal types including imps
      const roll = Math.random();
      if (roll < 0.2) type = "zombie";
      else if (roll < 0.45) type = "skeleton";
      else if (roll < 0.65) type = "imp";
      else type = "bat";
    } else if (time >= 90) {
      // After 1.5 min: bats, skeletons, and imps
      const roll = Math.random();
      if (roll < 0.3) type = "skeleton";
      else if (roll < 0.5) type = "imp";
      else type = "bat";
    } else {
      // Wave 1+: bats and imps
      type = Math.random() < 0.3 ? "imp" : "bat";
    }

    // Scale HP with difficulty
    spawnEnemy(type, x, z);
  }
}

/**
 * Spawn a boss wave: one boss + minion escort.
 * Boss stats scale with wave level (wave 5 = level 1, wave 10 = level 2, etc.)
 */
function _spawnBossWave(players, waveNumber) {
  const bossLevel = Math.floor(waveNumber / BOSS_WAVE_INTERVAL);
  const alivePlayers = players.filter((p) => p.alive);
  const target =
    alivePlayers.length > 0
      ? alivePlayers[Math.floor(Math.random() * alivePlayers.length)]
      : null;
  const px = target ? target.mesh.position.x : 0;
  const pz = target ? target.mesh.position.z : 0;

  // Spawn boss
  const { x: bx, z: bz } = _safeSpawnPosition(
    px,
    pz,
    alivePlayers,
    SPAWN_DISTANCE_MAX,
    SPAWN_DISTANCE_MAX + 5,
  );
  const boss = spawnEnemy("boss", bx, bz);
  if (boss) {
    // Scale boss HP and damage based on wave level and player count
    const hpMultiplier = 1 + (bossLevel - 1) * 0.5;
    const playerScale = 1 + (alivePlayers.length - 1) * 0.4;
    boss.hp = Math.floor(ENEMY_TYPES.boss.hp * hpMultiplier * playerScale);
    boss.maxHp = boss.hp;
    boss.damage = Math.floor(
      ENEMY_TYPES.boss.damage * (1 + (bossLevel - 1) * 0.3),
    );
    boss.bossWaveLevel = bossLevel;
    boss.xpValue = Math.floor(
      ENEMY_TYPES.boss.xpValue * (1 + (bossLevel - 1) * 0.5),
    );
  }

  // Spawn minion escorts around the boss
  const minionCount = 4 + bossLevel * 2;
  const minionTypes = ["bat", "skeleton", "zombie", "imp"];
  for (let i = 0; i < minionCount; i++) {
    const angle = (i / minionCount) * Math.PI * 2;
    const dist = 3 + Math.random() * 2;
    const mx = Math.max(
      -ARENA_HALF,
      Math.min(ARENA_HALF, bx + Math.cos(angle) * dist),
    );
    const mz = Math.max(
      -ARENA_HALF,
      Math.min(ARENA_HALF, bz + Math.sin(angle) * dist),
    );
    const type = minionTypes[Math.floor(Math.random() * minionTypes.length)];
    spawnEnemy(type, mx, mz);
  }
}

export function resetWaveDirector() {
  spawnTimer = 0;
  currentWave = 0;
}
