// weaponManager.js — Auto-fire weapon system, per-player weapon sets

import * as THREE from "three";
import { magicWand } from "./weapons/magicWand.js";
import { whip } from "./weapons/whip.js";
import { garlic } from "./weapons/garlic.js";
import { holyWater } from "./weapons/holyWater.js";
import { fireProjectile } from "./projectiles.js";
import { damageEnemy, enemies } from "./enemyManager.js";
import { distXZ } from "./utils.js";
import { gameState } from "./main.js";

// Registry of all weapon definitions
export const WEAPON_DEFS = {
  magicWand,
  whip,
  garlic,
  holyWater,
};

const MAX_WEAPON_SLOTS = 6;

// Temporary visuals for melee/area weapons (shared across all players)
const _activeVisuals = [];
let _visualIdCounter = 0;

export function createWeaponManager() {
  // No module-level state needed anymore
}

/**
 * Add a weapon to a player's weapon set, or level it up if already equipped.
 */
export function addWeapon(playerObj, weaponId) {
  if (playerObj.weapons.length >= MAX_WEAPON_SLOTS) return false;
  if (!WEAPON_DEFS[weaponId]) return false;

  // Check if already equipped
  const existing = playerObj.weapons.find((w) => w.id === weaponId);
  if (existing) {
    // Level up instead
    return levelUpWeapon(playerObj, weaponId);
  }

  playerObj.weapons.push({
    id: weaponId,
    level: 1,
    cooldownTimer: 0,
  });
  return true;
}

/**
 * Level up a specific weapon for a player.
 */
export function levelUpWeapon(playerObj, weaponId) {
  const weapon = playerObj.weapons.find((w) => w.id === weaponId);
  if (!weapon) return false;
  const def = WEAPON_DEFS[weaponId];
  if (weapon.level >= def.maxLevel) return false;
  weapon.level++;
  return true;
}

/**
 * Update and fire weapons for a single player.
 */
export function updateWeapons(delta, playerObj, enemiesList) {
  if (!playerObj.alive) return;

  for (const weapon of playerObj.weapons) {
    weapon.cooldownTimer -= delta;
    if (weapon.cooldownTimer <= 0) {
      _fireWeapon(weapon, playerObj, enemiesList);
    }
  }
}

/**
 * Update active weapon visuals (melee arcs, auras, pools).
 * Call once per frame, not per player.
 */
export function updateWeaponVisuals(delta, enemiesList) {
  for (let i = _activeVisuals.length - 1; i >= 0; i--) {
    const v = _activeVisuals[i];
    v.timer -= delta;

    // For holy water pools, tick damage
    if (v.type === "holyWater" && v.damageTimer !== undefined) {
      v.damageTimer -= delta;
      if (v.damageTimer <= 0) {
        v.damageTimer = 0.5; // damage tick rate
        const stats = v.stats;
        for (const e of enemiesList) {
          if (!e.alive) continue;
          const d = distXZ(v.mesh.position, e.mesh.position);
          if (d < stats.area) {
            damageEnemy(e, stats.damage * 0.5);
          }
        }
      }
    }

    if (v.timer <= 0) {
      gameState.scene.remove(v.mesh);
      if (v.mesh.geometry) v.mesh.geometry.dispose();
      if (v.mesh.material) v.mesh.material.dispose();
      // Swap-and-pop: O(1) removal
      const last = _activeVisuals[_activeVisuals.length - 1];
      _activeVisuals[i] = last;
      _activeVisuals.pop();
    } else {
      // Fade out
      if (v.mesh.material.opacity !== undefined) {
        v.mesh.material.opacity = Math.min(1, v.timer * 3);
      }
      // Garlic aura follows the owner player
      if (v.type === "garlic" && v.owner) {
        v.mesh.position.x = v.owner.mesh.position.x;
        v.mesh.position.z = v.owner.mesh.position.z;
      }
    }
  }
}

function _fireWeapon(weapon, playerObj, enemiesList) {
  const def = WEAPON_DEFS[weapon.id];
  const stats = def.getStats(weapon.level);

  // Set default cooldown first; individual handlers can override
  weapon.cooldownTimer = stats.cooldown;

  switch (weapon.id) {
    case "magicWand":
      _fireMagicWand(weapon, stats, playerObj, enemiesList);
      break;
    case "whip":
      _fireWhip(weapon, stats, playerObj, enemiesList);
      break;
    case "garlic":
      _fireGarlic(weapon, stats, playerObj, enemiesList);
      break;
    case "holyWater":
      _fireHolyWater(weapon, stats, playerObj, enemiesList);
      break;
  }
}

// --- Magic Wand: fire projectile(s) toward nearest enemies ---
// Reusable buffer for nearest-enemy search (avoids per-fire allocations)
const _nearestBuf = [];

function _fireMagicWand(weapon, stats, playerObj, enemiesList) {
  if (enemiesList.length === 0) {
    weapon.cooldownTimer = 0.2; // Retry quickly if no enemies
    return;
  }

  // Find N nearest alive enemies without copying/sorting the entire array
  const count = stats.projectileCount;
  _nearestBuf.length = 0;

  const px = playerObj.mesh.position.x;
  const pz = playerObj.mesh.position.z;

  for (let i = 0; i < enemiesList.length; i++) {
    const e = enemiesList[i];
    if (!e.alive) continue;
    const dx = e.mesh.position.x - px;
    const dz = e.mesh.position.z - pz;
    const d2 = dx * dx + dz * dz;

    if (_nearestBuf.length < count) {
      _nearestBuf.push({ e, d2 });
      // Keep the buffer sorted (small N, so insertion is cheap)
      if (
        _nearestBuf.length > 1 &&
        d2 < _nearestBuf[_nearestBuf.length - 2].d2
      ) {
        _nearestBuf.sort((a, b) => a.d2 - b.d2);
      }
    } else if (d2 < _nearestBuf[_nearestBuf.length - 1].d2) {
      _nearestBuf[_nearestBuf.length - 1] = { e, d2 };
      _nearestBuf.sort((a, b) => a.d2 - b.d2);
    }
  }

  for (let i = 0; i < _nearestBuf.length; i++) {
    const target = _nearestBuf[i].e;
    const dx = target.mesh.position.x - px;
    const dz = target.mesh.position.z - pz;
    const len = Math.sqrt(dx * dx + dz * dz);
    if (len < 0.01) continue;

    fireProjectile({
      x: px,
      z: pz,
      dirX: dx / len,
      dirZ: dz / len,
      speed: stats.speed,
      damage: stats.damage,
      lifetime: stats.lifetime,
      pierce: stats.pierce,
      color: stats.color,
      size: stats.size,
    });
  }
}

// --- Whip: instant arc damage in front of player ---
function _fireWhip(weapon, stats, playerObj, enemiesList) {
  const px = playerObj.mesh.position.x;
  const pz = playerObj.mesh.position.z;
  const angle = playerObj.facingAngle;
  const area = stats.area;

  // Damage all enemies within area in front of player
  for (const e of enemiesList) {
    if (!e.alive) continue;
    const d = distXZ(playerObj.mesh.position, e.mesh.position);
    if (d > area) continue;

    // Check if enemy is roughly in front of player (180 degree arc)
    const dx = e.mesh.position.x - px;
    const dz = e.mesh.position.z - pz;
    const enemyAngle = Math.atan2(dx, dz);
    let angleDiff = Math.abs(enemyAngle - angle);
    if (angleDiff > Math.PI) angleDiff = Math.PI * 2 - angleDiff;
    if (angleDiff < Math.PI * 0.6) {
      damageEnemy(e, stats.damage);
    }
  }

  // Visual: arc mesh
  const arcGeo = new THREE.RingGeometry(
    0.3,
    area,
    16,
    1,
    -Math.PI * 0.5,
    Math.PI,
  );
  const arcMat = new THREE.MeshBasicMaterial({
    color: 0xffcc44,
    transparent: true,
    opacity: 0.7,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const arcMesh = new THREE.Mesh(arcGeo, arcMat);
  arcMesh.rotation.x = -Math.PI / 2;
  arcMesh.rotation.z = -angle;
  arcMesh.position.set(px, 0.5, pz);
  gameState.scene.add(arcMesh);
  _activeVisuals.push({
    id: _visualIdCounter++,
    mesh: arcMesh,
    timer: 0.2,
    type: "whip",
    area,
  });
}

// --- Garlic: AoE aura around player ---
function _fireGarlic(weapon, stats, playerObj, enemiesList) {
  const px = playerObj.mesh.position.x;
  const pz = playerObj.mesh.position.z;
  const area = stats.area;

  // Damage all enemies within radius
  for (const e of enemiesList) {
    if (!e.alive) continue;
    const d = distXZ(playerObj.mesh.position, e.mesh.position);
    if (d < area) {
      damageEnemy(e, stats.damage);
    }
  }

  // Visual: expanding ring
  const ringGeo = new THREE.RingGeometry(area - 0.3, area, 32);
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0x88ff88,
    transparent: true,
    opacity: 0.5,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const ringMesh = new THREE.Mesh(ringGeo, ringMat);
  ringMesh.rotation.x = -Math.PI / 2;
  ringMesh.position.set(px, 0.3, pz);
  gameState.scene.add(ringMesh);
  _activeVisuals.push({
    id: _visualIdCounter++,
    mesh: ringMesh,
    timer: 0.3,
    type: "garlic",
    area,
    owner: playerObj,
  });
}

// --- Holy Water: damaging zone on the ground ---
function _fireHolyWater(weapon, stats, playerObj, enemiesList) {
  // Drop at a random nearby position or on densest cluster
  let tx = playerObj.mesh.position.x;
  let tz = playerObj.mesh.position.z;

  // Aim at nearest enemy cluster or random if none
  if (enemiesList.length > 0) {
    const nearest = enemiesList.reduce((best, e) => {
      if (!e.alive) return best;
      const d = distXZ(e.mesh.position, playerObj.mesh.position);
      return d < distXZ(best.mesh.position, playerObj.mesh.position) ? e : best;
    });
    tx = nearest.mesh.position.x;
    tz = nearest.mesh.position.z;
  }

  // Visual: blue glowing circle pool
  const poolGeo = new THREE.CircleGeometry(stats.area, 24);
  const poolMat = new THREE.MeshBasicMaterial({
    color: 0x4488ff,
    transparent: true,
    opacity: 0.4,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const poolMesh = new THREE.Mesh(poolGeo, poolMat);
  poolMesh.rotation.x = -Math.PI / 2;
  poolMesh.position.set(tx, 0.1, tz);
  gameState.scene.add(poolMesh);

  // Initial burst damage
  for (const e of enemiesList) {
    if (!e.alive) continue;
    const d = distXZ({ x: tx, z: tz }, e.mesh.position);
    if (d < stats.area) {
      damageEnemy(e, stats.damage);
    }
  }

  _activeVisuals.push({
    id: _visualIdCounter++,
    mesh: poolMesh,
    timer: stats.duration,
    type: "holyWater",
    area: stats.area,
    stats,
    damageTimer: 0.5,
  });
}

/**
 * Return serializable state for all active weapon visuals (for network sync).
 * @param {Array} playersList — the players array, used to resolve owner indices for garlic.
 */
export function getActiveVisualStates(playersList) {
  return _activeVisuals.map((v) => ({
    id: v.id,
    t: v.type,
    x: v.mesh.position.x,
    y: v.mesh.position.y,
    z: v.mesh.position.z,
    rz: v.mesh.rotation.z,
    a: v.area || 0,
    op: v.mesh.material.opacity !== undefined ? v.mesh.material.opacity : 1,
    oi: v.owner ? playersList.indexOf(v.owner) : -1,
  }));
}

export function resetWeapons(playerObj) {
  if (playerObj) {
    playerObj.weapons.length = 0;
  }
}

export function resetAllWeaponVisuals() {
  for (const v of _activeVisuals) {
    gameState.scene.remove(v.mesh);
    if (v.mesh.geometry) v.mesh.geometry.dispose();
    if (v.mesh.material) v.mesh.material.dispose();
  }
  _activeVisuals.length = 0;
}
