// waveDirector.js — Wave timing, difficulty scaling over time

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

export function updateWaveDirector(delta, player) {
  const time = gameState.gameTime;

  // --- Compute current difficulty ---
  const difficultyFactor = Math.min(time / 900, 1); // ramp over 15 minutes to max
  const spawnInterval =
    BASE_SPAWN_INTERVAL -
    (BASE_SPAWN_INTERVAL - MIN_SPAWN_INTERVAL) * difficultyFactor;
  const enemiesPerWave = Math.floor(
    BASE_ENEMIES_PER_WAVE + difficultyFactor * 7,
  );

  // --- Spawn timer ---
  spawnTimer -= delta;
  if (spawnTimer <= 0) {
    spawnTimer = spawnInterval;
    _spawnWave(player, enemiesPerWave, time);
  }

  // --- Boss timer ---
  bossTimer += delta;
  if (bossTimer >= BOSS_INTERVAL) {
    bossTimer -= BOSS_INTERVAL;
    _spawnBoss(player);
  }
}

function _spawnWave(player, count, time) {
  const px = player.mesh.position.x;
  const pz = player.mesh.position.z;

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

function _spawnBoss(player) {
  const px = player.mesh.position.x;
  const pz = player.mesh.position.z;
  const angle = randomRange(0, Math.PI * 2);
  const dist = SPAWN_DISTANCE_MAX;
  spawnEnemy("boss", px + Math.cos(angle) * dist, pz + Math.sin(angle) * dist);
}

export function resetWaveDirector() {
  spawnTimer = 0;
  bossTimer = 0;
}
