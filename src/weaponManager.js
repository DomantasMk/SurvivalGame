// weaponManager.js — Auto-fire weapon system, weapon definitions

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

// Currently equipped weapons (array of { id, level, cooldownTimer, visualMesh? })
export const equippedWeapons = [];

const MAX_WEAPON_SLOTS = 6;

// Temporary visuals for melee/area weapons
const _activeVisuals = [];

let scene;

export function createWeaponManager() {
  // Scene ref is obtained from gameState
}

export function addWeapon(weaponId) {
  if (equippedWeapons.length >= MAX_WEAPON_SLOTS) return false;
  if (!WEAPON_DEFS[weaponId]) return false;

  // Check if already equipped
  const existing = equippedWeapons.find((w) => w.id === weaponId);
  if (existing) {
    // Level up instead
    return levelUpWeapon(weaponId);
  }

  equippedWeapons.push({
    id: weaponId,
    level: 1,
    cooldownTimer: 0,
  });
  return true;
}

export function levelUpWeapon(weaponId) {
  const weapon = equippedWeapons.find((w) => w.id === weaponId);
  if (!weapon) return false;
  const def = WEAPON_DEFS[weaponId];
  if (weapon.level >= def.maxLevel) return false;
  weapon.level++;
  return true;
}

export function updateWeapons(delta, player, enemiesList) {
  for (const weapon of equippedWeapons) {
    weapon.cooldownTimer -= delta;
    if (weapon.cooldownTimer <= 0) {
      _fireWeapon(weapon, player, enemiesList);
    }
  }

  // Update active visuals (melee arcs, auras, pools)
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
      _activeVisuals.splice(i, 1);
    } else {
      // Fade out
      if (v.mesh.material.opacity !== undefined) {
        v.mesh.material.opacity = Math.min(1, v.timer * 3);
      }
      // Garlic aura follows player
      if (v.type === "garlic") {
        v.mesh.position.x = player.mesh.position.x;
        v.mesh.position.z = player.mesh.position.z;
      }
    }
  }
}

function _fireWeapon(weapon, player, enemiesList) {
  const def = WEAPON_DEFS[weapon.id];
  const stats = def.getStats(weapon.level);

  // Set default cooldown first; individual handlers can override
  weapon.cooldownTimer = stats.cooldown;

  switch (weapon.id) {
    case "magicWand":
      _fireMagicWand(weapon, stats, player, enemiesList);
      break;
    case "whip":
      _fireWhip(weapon, stats, player, enemiesList);
      break;
    case "garlic":
      _fireGarlic(weapon, stats, player, enemiesList);
      break;
    case "holyWater":
      _fireHolyWater(weapon, stats, player, enemiesList);
      break;
  }
}

// --- Magic Wand: fire projectile(s) toward nearest enemies ---
function _fireMagicWand(weapon, stats, player, enemiesList) {
  if (enemiesList.length === 0) {
    weapon.cooldownTimer = 0.2; // Retry quickly if no enemies
    return;
  }

  // Find nearest enemies
  const sorted = [...enemiesList]
    .filter((e) => e.alive)
    .sort(
      (a, b) =>
        distXZ(a.mesh.position, player.mesh.position) -
        distXZ(b.mesh.position, player.mesh.position),
    );

  const count = stats.projectileCount;
  for (let i = 0; i < count && i < sorted.length; i++) {
    const target = sorted[i];
    const dx = target.mesh.position.x - player.mesh.position.x;
    const dz = target.mesh.position.z - player.mesh.position.z;
    const len = Math.sqrt(dx * dx + dz * dz);
    if (len < 0.01) continue;

    fireProjectile({
      x: player.mesh.position.x,
      z: player.mesh.position.z,
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
function _fireWhip(weapon, stats, player, enemiesList) {
  const px = player.mesh.position.x;
  const pz = player.mesh.position.z;
  const angle = player.facingAngle;
  const area = stats.area;

  // Damage all enemies within area in front of player
  for (const e of enemiesList) {
    if (!e.alive) continue;
    const d = distXZ(player.mesh.position, e.mesh.position);
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
  _activeVisuals.push({ mesh: arcMesh, timer: 0.2, type: "whip" });
}

// --- Garlic: AoE aura around player ---
function _fireGarlic(weapon, stats, player, enemiesList) {
  const px = player.mesh.position.x;
  const pz = player.mesh.position.z;
  const area = stats.area;

  // Damage all enemies within radius
  for (const e of enemiesList) {
    if (!e.alive) continue;
    const d = distXZ(player.mesh.position, e.mesh.position);
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
  _activeVisuals.push({ mesh: ringMesh, timer: 0.3, type: "garlic" });
}

// --- Holy Water: damaging zone on the ground ---
function _fireHolyWater(weapon, stats, player, enemiesList) {
  // Drop at a random nearby position or on densest cluster
  let tx = player.mesh.position.x;
  let tz = player.mesh.position.z;

  // Aim at nearest enemy cluster or random if none
  if (enemiesList.length > 0) {
    const nearest = enemiesList.reduce((best, e) => {
      if (!e.alive) return best;
      const d = distXZ(e.mesh.position, player.mesh.position);
      return d < distXZ(best.mesh.position, player.mesh.position) ? e : best;
    });
    tx = nearest.mesh.position.x;
    tz = nearest.mesh.position.z;
  }

  // Visual: blue glowing circle pool
  const poolGeo = new THREE.CircleGeometry(stats.area, 24);
  const poolMat = new THREE.MeshBasicMaterial({
    color: 0x4488ff,
    transparent: true,
    opacity: 0.6,
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
    mesh: poolMesh,
    timer: stats.duration,
    type: "holyWater",
    stats,
    damageTimer: 0.5,
  });
}

export function resetWeapons() {
  equippedWeapons.length = 0;

  for (const v of _activeVisuals) {
    gameState.scene.remove(v.mesh);
    if (v.mesh.geometry) v.mesh.geometry.dispose();
    if (v.mesh.material) v.mesh.material.dispose();
  }
  _activeVisuals.length = 0;
}
