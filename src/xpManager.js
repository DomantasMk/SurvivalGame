// xpManager.js — XP gems, collection radius, level thresholds (multi-player)

import * as THREE from "three";
import { distXZ } from "./utils.js";
import { gameState } from "./main.js";

let scene;

// Active XP gems
const gems = [];
const pool = [];

// Unique ID counter for network sync
let _nextGemId = 1;

// Callback for level-up events (set by main.js)
let _levelUpCallback = null;

// XP thresholds per level (exponential curve)
function xpForLevel(level) {
  return Math.floor(8 + level * 5 + level * level * 1.2);
}

// Gem size tiers
const GEM_TIERS = [
  { maxValue: 2, color: 0x44aaff, size: 0.15 }, // blue (small)
  { maxValue: 5, color: 0x44ff44, size: 0.2 }, // green (medium)
  { maxValue: 20, color: 0xffcc00, size: 0.25 }, // gold (large)
  { maxValue: Infinity, color: 0xff44ff, size: 0.35 }, // purple (boss)
];

const COLLECT_SPEED = 18;
const GEM_Y = 0.3;

export function createXpManager(s) {
  scene = s;
}

/**
 * Set the callback for when a player levels up.
 * Called with (playerObj) as argument.
 */
export function setLevelUpCallback(cb) {
  _levelUpCallback = cb;
}

/**
 * Spawn an XP gem at (x, z) with a given value.
 */
export function spawnXpGem(x, z, value) {
  const tier =
    GEM_TIERS.find((t) => value <= t.maxValue) ||
    GEM_TIERS[GEM_TIERS.length - 1];

  let gem;
  if (pool.length > 0) {
    gem = pool.pop();
    _resetGem(gem, x, z, value, tier);
  } else {
    gem = _createGem(x, z, value, tier);
  }

  gems.push(gem);
  gem.mesh.visible = true;
}

function _createGem(x, z, value, tier) {
  const geometry = new THREE.OctahedronGeometry(tier.size, 0);
  const material = new THREE.MeshStandardMaterial({
    color: tier.color,
    emissive: tier.color,
    emissiveIntensity: 0.5,
    roughness: 0.3,
    metalness: 0.8,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, GEM_Y, z);
  mesh.castShadow = false;
  scene.add(mesh);

  return {
    id: _nextGemId++,
    mesh,
    value,
    attracting: false,
    attractTarget: null, // which player is attracting this gem
    bobPhase: Math.random() * Math.PI * 2,
  };
}

function _resetGem(gem, x, z, value, tier) {
  gem.id = _nextGemId++;
  gem.value = value;
  gem.attracting = false;
  gem.attractTarget = null;
  gem.bobPhase = Math.random() * Math.PI * 2;
  gem.mesh.position.set(x, GEM_Y, z);
  gem.mesh.material.color.setHex(tier.color);
  gem.mesh.material.emissive.setHex(tier.color);
  gem.mesh.scale.setScalar(tier.size / 0.15); // normalize to base size
}

const _dir = new THREE.Vector3();

/**
 * Update XP gems: bob animation, attract to nearest player, collect.
 * @param {number} delta
 * @param {Array} players - Array of alive player objects
 */
export function updateXpGems(delta, players) {
  const alivePlayers = players.filter((p) => p.alive);

  for (let i = gems.length - 1; i >= 0; i--) {
    const gem = gems[i];

    // Bob animation
    gem.bobPhase += delta * 3;
    gem.mesh.position.y = GEM_Y + Math.sin(gem.bobPhase) * 0.1;
    gem.mesh.rotation.y += delta * 2;

    // Find nearest alive player within pickup radius
    let nearestPlayer = null;
    let nearestDist = Infinity;
    for (const p of alivePlayers) {
      const d = distXZ(gem.mesh.position, p.mesh.position);
      if (d < p.pickupRadius && d < nearestDist) {
        nearestDist = d;
        nearestPlayer = p;
      }
    }

    // Start attracting toward nearest player in range
    if (nearestPlayer) {
      gem.attracting = true;
      gem.attractTarget = nearestPlayer;
    }

    if (gem.attracting && gem.attractTarget) {
      const target = gem.attractTarget;
      const px = target.mesh.position.x;
      const pz = target.mesh.position.z;

      // Fly toward target player
      _dir.set(px - gem.mesh.position.x, 0, pz - gem.mesh.position.z);
      const len = _dir.length();
      if (len > 0.01) {
        _dir.normalize().multiplyScalar(COLLECT_SPEED * delta);
        gem.mesh.position.x += _dir.x;
        gem.mesh.position.z += _dir.z;
      }

      // Collect when very close
      if (len < 0.5) {
        _collectGem(i, target);
        continue;
      }
    }
  }
}

function _collectGem(index, playerObj) {
  const gem = gems[index];

  // Add XP to the collecting player
  playerObj.xp += gem.value;

  // Check level up
  const needed = xpForLevel(playerObj.level);
  if (playerObj.xp >= needed) {
    playerObj.xp -= needed;
    playerObj.level++;
    // Notify via callback (main.js handles showing upgrade menu or network)
    if (_levelUpCallback) _levelUpCallback(playerObj);
  }

  // Return to pool
  gem.mesh.visible = false;
  pool.push(gem);
  gems.splice(index, 1);
}

export function getXpForNextLevel(level) {
  return xpForLevel(level);
}

/**
 * Get the active gems array (for state serialization).
 */
export function getActiveGems() {
  return gems;
}

export function resetXpGems() {
  for (const g of gems) {
    g.mesh.visible = false;
    pool.push(g);
  }
  gems.length = 0;
}
