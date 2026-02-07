// enemyManager.js — Enemy spawning, pooling, AI (move toward nearest player)

import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { damagePlayer } from "./player.js";
import { spawnXpGem } from "./xpManager.js";
import { gameState } from "./main.js";
import { spawnDeathParticles } from "./particles.js";
import { screenShake } from "./camera.js";
import { distXZ } from "./utils.js";
import {
  createEnemyModel,
  flashGroup,
  unflashGroup,
  resetAnimParts,
  animateEnemyModel,
} from "./models.js";

let scene, world;

// All active enemies
export const enemies = [];

// Type-specific object pools for reuse
const pools = {};

// Sequential ID counter for multiplayer state sync
let _nextEnemyId = 0;

// Enemy type definitions
export const ENEMY_TYPES = {
  bat: {
    name: "Bat",
    color: 0xff4466,
    size: 0.3,
    hp: 24,
    speed: 3.5,
    damage: 4,
    xpValue: 1,
  },
  skeleton: {
    name: "Skeleton",
    color: 0xccccaa,
    size: 0.4,
    hp: 50,
    speed: 2.5,
    damage: 7,
    xpValue: 3,
  },
  zombie: {
    name: "Zombie",
    color: 0x66aa66,
    size: 0.5,
    hp: 90,
    speed: 1.5,
    damage: 12,
    xpValue: 6,
  },
  imp: {
    name: "Imp",
    color: 0xcc44ff,
    size: 0.35,
    hp: 18,
    speed: 2.8,
    damage: 3,
    xpValue: 2,
    ranged: true,
    stopDistance: 7, // stop and shoot when within this range
    shootCooldown: 2.0,
    projectileSpeed: 8,
    projectileDamage: 6,
    projectileColor: 0xdd55ff,
  },
  boss: {
    name: "Boss",
    color: 0xaa00ff,
    size: 1.2,
    hp: 5000,
    speed: 2.0,
    damage: 20,
    xpValue: 100,
  },
};

// Boss attack configuration (charge-up attacks with visible indicators)
export const BOSS_ATTACK_CONFIG = {
  cone: {
    chargeDuration: 1.5,
    range: 6,
    angle: Math.PI / 2, // 90 degrees
    baseDamage: 30,
    color: 0xff2222,
  },
  rangedCircle: {
    chargeDuration: 2.0,
    targetRange: 15,
    radius: 3.5,
    baseDamage: 35,
    color: 0xff4400,
  },
  stomp: {
    chargeDuration: 1.0,
    radius: 5,
    baseDamage: 25,
    color: 0xff0066,
  },
};

const MAX_ENEMIES = 600;
const DAMAGE_COOLDOWN = 1.2; // seconds between enemy hits on player
const KNOCKBACK_FORCE = 4;

// Accumulated time for animation
let _enemyTime = 0;

export function createEnemyManager(s, w) {
  scene = s;
  world = w;
}

/**
 * Spawn a single enemy of the given type at position (x, z).
 */
export function spawnEnemy(type, x, z) {
  if (enemies.length >= MAX_ENEMIES) return null;

  const def = ENEMY_TYPES[type];
  if (!def) return null;

  let enemy;
  if (!pools[type]) pools[type] = [];

  if (pools[type].length > 0) {
    enemy = pools[type].pop();
    _resetEnemy(enemy, def, x, z);
  } else {
    enemy = _createEnemy(def, type, x, z);
  }

  enemies.push(enemy);
  enemy.mesh.visible = true;
  return enemy;
}

function _createEnemy(def, typeKey, x, z) {
  // Build type-specific detailed model
  const { group, anim } = createEnemyModel(typeKey, def.size);
  group.position.set(x, def.size * 0.75, z);
  scene.add(group);

  // Rapier dynamic body
  const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(x, def.size * 0.75, z)
    .lockRotations()
    .setLinearDamping(5.0);
  const body = world.createRigidBody(bodyDesc);
  const colliderDesc = RAPIER.ColliderDesc.cuboid(
    def.size / 2,
    def.size * 0.75,
    def.size / 2,
  ).setMass(1.0);
  const collider = world.createCollider(colliderDesc, body);

  const enemy = {
    id: _nextEnemyId++,
    mesh: group,
    body,
    collider,
    hp: def.hp,
    maxHp: def.hp,
    speed: def.speed,
    damage: def.damage,
    xpValue: def.xpValue,
    type: def.name,
    typeKey,
    size: def.size,
    damageCooldown: 0,
    alive: true,
    flashTimer: 0,
    originalColor: def.color,
    anim,
    animTimeOffset: Math.random() * 100,
  };

  // Ranged enemy properties
  if (def.ranged) {
    enemy.isRanged = true;
    enemy.stopDistance = def.stopDistance;
    enemy.shootCooldown = def.shootCooldown;
    enemy.shootTimer = def.shootCooldown * (0.5 + Math.random() * 0.5); // stagger first shots
    enemy.projectileSpeed = def.projectileSpeed;
    enemy.projectileDamage = def.projectileDamage;
    enemy.projectileColor = def.projectileColor;
  }

  // Boss-specific properties for attack AI
  if (typeKey === "boss") {
    enemy.isBoss = true;
    enemy.bossState = "idle"; // idle | charging | attacking
    enemy.bossAttackType = null; // cone | rangedCircle | stomp
    enemy.bossChargeTimer = 0;
    enemy.bossChargeDuration = 0;
    enemy.bossAttackCooldown = 3; // initial delay before first attack
    enemy.bossAttackTimer = 0;
    enemy.bossIndicator = null; // THREE.Mesh for attack warning zone
    enemy.bossAttackTarget = null; // {x, z} for ranged circle
    enemy.bossWaveLevel = 1;
  }

  return enemy;
}

function _resetEnemy(enemy, def, x, z) {
  enemy.id = _nextEnemyId++;
  enemy.hp = def.hp;
  enemy.maxHp = def.hp;
  enemy.speed = def.speed;
  enemy.damage = def.damage;
  enemy.xpValue = def.xpValue;
  enemy.type = def.name;
  enemy.size = def.size;
  enemy.damageCooldown = 0;
  enemy.alive = true;
  enemy.flashTimer = 0;
  enemy.originalColor = def.color;
  enemy.animTimeOffset = Math.random() * 100;

  // Reset mesh
  enemy.mesh.scale.setScalar(1);
  unflashGroup(enemy.mesh);
  enemy.mesh.position.set(x, def.size * 0.75, z);
  enemy.mesh.rotation.set(0, 0, 0);

  // Reset animation poses
  resetAnimParts(enemy.anim);

  // Reset physics body
  enemy.body.setTranslation({ x, y: def.size * 0.75, z }, true);
  enemy.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  enemy.body.setEnabled(true);

  // Reset ranged properties
  if (def.ranged) {
    enemy.isRanged = true;
    enemy.stopDistance = def.stopDistance;
    enemy.shootCooldown = def.shootCooldown;
    enemy.shootTimer = def.shootCooldown * (0.5 + Math.random() * 0.5);
    enemy.projectileSpeed = def.projectileSpeed;
    enemy.projectileDamage = def.projectileDamage;
    enemy.projectileColor = def.projectileColor;
  }

  // Reset boss properties
  if (enemy.isBoss) {
    _cleanupBossIndicator(enemy);
    enemy.bossState = "idle";
    enemy.bossAttackType = null;
    enemy.bossChargeTimer = 0;
    enemy.bossChargeDuration = 0;
    enemy.bossAttackCooldown = 3;
    enemy.bossAttackTimer = 0;
    enemy.bossAttackTarget = null;
    enemy.bossWaveLevel = 1;
  }
}

const _dir = new THREE.Vector3();

/**
 * Update all enemies: AI targeting, movement, contact damage.
 * @param {number} delta
 * @param {Array} players - Array of player objects (alive or dead)
 */
export function updateEnemies(delta, players) {
  _enemyTime += delta;

  // Filter to alive players for targeting
  const alivePlayers = players.filter((p) => p.alive);

  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];

    if (!e.alive) {
      _killEnemy(i);
      continue;
    }

    // --- Find nearest alive player ---
    let nearestPlayer = null;
    let nearestDist = Infinity;
    const ep = e.body.translation();
    for (const p of alivePlayers) {
      const dx = p.mesh.position.x - ep.x;
      const dz = p.mesh.position.z - ep.z;
      const d = dx * dx + dz * dz; // Use squared distance for comparison
      if (d < nearestDist) {
        nearestDist = d;
        nearestPlayer = p;
      }
    }
    nearestDist = Math.sqrt(nearestDist); // Convert to real distance for later use

    if (!nearestPlayer) continue; // No alive players

    // --- AI: move toward nearest player ---
    const pp = nearestPlayer.mesh.position;

    _dir.set(pp.x - ep.x, 0, pp.z - ep.z);
    const dist = nearestDist;

    // Boss: stop during charge/attack, slow during cooldown
    if (
      e.isBoss &&
      (e.bossState === "charging" || e.bossState === "attacking")
    ) {
      e.body.setLinvel({ x: 0, y: e.body.linvel().y, z: 0 }, true);
    } else if (e.isRanged && dist < e.stopDistance) {
      // Ranged enemies stop when within shooting range
      e.body.setLinvel({ x: 0, y: e.body.linvel().y, z: 0 }, true);
    } else if (dist > 0.1) {
      const speedMult = e.isBoss && e.bossState === "cooldown" ? 0.5 : 1;
      _dir.normalize().multiplyScalar(e.speed * speedMult);
      e.body.setLinvel({ x: _dir.x, y: e.body.linvel().y, z: _dir.z }, true);
    }

    // Sync mesh to physics
    const t = e.body.translation();
    e.mesh.position.set(t.x, t.y, t.z);

    // Face toward the nearest player
    if (dist > 0.5) {
      e.mesh.rotation.y = Math.atan2(pp.x - t.x, pp.z - t.z);
    }

    // --- Bat bob (flying) ---
    if (e.type === "Bat") {
      e.mesh.position.y +=
        Math.sin((_enemyTime + e.animTimeOffset) * 6) * e.size * 0.15;
    }

    // --- Imp hover (magical float) ---
    if (e.type === "Imp") {
      e.mesh.position.y +=
        Math.sin((_enemyTime + e.animTimeOffset) * 4) * e.size * 0.1;
    }

    // --- Animate model ---
    animateEnemyModel(e.type, e.anim, _enemyTime + e.animTimeOffset);

    // --- Boss AI (charged attacks with visible indicators) ---
    if (e.isBoss) {
      _updateBossAI(e, delta, nearestPlayer, nearestDist, alivePlayers);
    }

    // --- Ranged AI: shoot projectiles at nearest player ---
    if (e.isRanged && dist < e.stopDistance + 3) {
      e.shootTimer -= delta;
      if (e.shootTimer <= 0) {
        e.shootTimer = e.shootCooldown;
        _fireEnemyProjectile(e, nearestPlayer);
      }
    }

    // --- Contact damage to any nearby player ---
    e.damageCooldown -= delta;
    if (e.damageCooldown <= 0) {
      for (const p of alivePlayers) {
        const dx = p.mesh.position.x - e.mesh.position.x;
        const dz = p.mesh.position.z - e.mesh.position.z;
        const pd = Math.sqrt(dx * dx + dz * dz);
        if (pd < e.size / 2 + 0.5) {
          damagePlayer(p, e.damage);
          e.damageCooldown = DAMAGE_COOLDOWN;

          // Knockback the hit player slightly
          const len = pd > 0.01 ? pd : 1;
          const kbx = (dx / len) * KNOCKBACK_FORCE * 0.3;
          const kbz = (dz / len) * KNOCKBACK_FORCE * 0.3;
          p.mesh.position.x += kbx;
          p.mesh.position.z += kbz;
          break; // Only damage one player per cooldown cycle
        }
      }
    }

    // --- Damage flash ---
    if (e.flashTimer > 0) {
      e.flashTimer -= delta;
      flashGroup(e.mesh);
    } else {
      unflashGroup(e.mesh);
    }
  }
}

function _killEnemy(index) {
  const e = enemies[index];
  const pos = e.mesh.position;

  // Cleanup boss indicator if any
  if (e.isBoss) {
    _cleanupBossIndicator(e);
  }

  // Death particles (bigger burst for bosses)
  if (e.isBoss) {
    for (let i = 0; i < 5; i++) {
      spawnDeathParticles(
        pos.x + (Math.random() - 0.5) * 2,
        pos.y + Math.random(),
        pos.z + (Math.random() - 0.5) * 2,
        e.originalColor,
      );
    }
    screenShake(1.0, 0.3);
  } else {
    spawnDeathParticles(pos.x, pos.y, pos.z, e.originalColor);
  }

  // Drop XP gem
  spawnXpGem(pos.x, pos.z, e.xpValue);

  // Increment shared kill counter
  gameState.totalKills++;

  // Return to type-specific pool
  e.mesh.visible = false;
  e.body.setEnabled(false);
  e.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  if (!pools[e.typeKey]) pools[e.typeKey] = [];
  pools[e.typeKey].push(e);
  // Swap-and-pop: O(1) removal instead of O(n) splice
  const last = enemies[enemies.length - 1];
  enemies[index] = last;
  enemies.pop();
}

/**
 * Deal damage to an enemy.
 */
export function damageEnemy(enemy, amount) {
  if (!enemy.alive) return;
  enemy.hp -= amount;
  enemy.flashTimer = 0.1;
  if (enemy.hp <= 0) {
    enemy.alive = false;
  }
}

export function resetEnemies() {
  for (const e of enemies) {
    if (e.isBoss) _cleanupBossIndicator(e);
    e.mesh.visible = false;
    e.body.setEnabled(false);
    if (!pools[e.typeKey]) pools[e.typeKey] = [];
    pools[e.typeKey].push(e);
  }
  enemies.length = 0;
  _enemyTime = 0;
}

// ── Boss Attack AI System ──────────────────────────────────────

/**
 * Get the currently active boss enemy, or null if none alive.
 */
export function getActiveBoss() {
  return enemies.find((e) => e.isBoss && e.alive) || null;
}

/**
 * Create a boss attack indicator mesh (used by both host and guest rendering).
 * Caller must add to scene.
 */
export function createBossIndicatorMesh(attackType) {
  const config = BOSS_ATTACK_CONFIG[attackType];
  if (!config) return null;

  let mesh;
  switch (attackType) {
    case "cone": {
      const geo = new THREE.CircleGeometry(
        config.range,
        24,
        -config.angle / 2,
        config.angle,
      );
      const mat = new THREE.MeshBasicMaterial({
        color: config.color,
        transparent: true,
        opacity: 0.15,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.x = -Math.PI / 2;
      break;
    }
    case "rangedCircle": {
      const geo = new THREE.CircleGeometry(config.radius, 24);
      const mat = new THREE.MeshBasicMaterial({
        color: config.color,
        transparent: true,
        opacity: 0.15,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.x = -Math.PI / 2;
      break;
    }
    case "stomp": {
      const geo = new THREE.RingGeometry(0.5, config.radius, 32);
      const mat = new THREE.MeshBasicMaterial({
        color: config.color,
        transparent: true,
        opacity: 0.15,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.x = -Math.PI / 2;
      break;
    }
  }
  return mesh || null;
}

/**
 * Boss AI state machine: idle -> charging (show indicator) -> attacking -> idle
 */
function _updateBossAI(boss, delta, nearestPlayer, nearestDist, alivePlayers) {
  if (!nearestPlayer) return;

  switch (boss.bossState) {
    case "idle": {
      boss.bossAttackCooldown -= delta;
      if (boss.bossAttackCooldown <= 0) {
        // Choose attack based on distance to nearest player
        let attackType;
        if (nearestDist < 5) {
          attackType = Math.random() < 0.5 ? "stomp" : "cone";
        } else if (nearestDist < 8) {
          attackType = Math.random() < 0.7 ? "cone" : "rangedCircle";
        } else {
          attackType = "rangedCircle";
        }
        _startBossCharge(boss, attackType, nearestPlayer);
      }
      break;
    }
    case "charging": {
      boss.bossChargeTimer -= delta;
      _updateBossIndicator(boss);

      if (boss.bossChargeTimer <= 0) {
        _executeBossAttack(boss, alivePlayers);
      }
      break;
    }
    case "attacking": {
      boss.bossAttackTimer -= delta;
      if (boss.bossAttackTimer <= 0) {
        _cleanupBossIndicator(boss);
        boss.bossState = "idle";
        boss.bossAttackCooldown = 2.0 + Math.random() * 2.0;
      }
      break;
    }
  }
}

function _startBossCharge(boss, attackType, target) {
  boss.bossState = "charging";
  boss.bossAttackType = attackType;

  const config = BOSS_ATTACK_CONFIG[attackType];
  boss.bossChargeTimer = config.chargeDuration;
  boss.bossChargeDuration = config.chargeDuration;

  // Store target position for ranged circle (locked at start of charge)
  if (attackType === "rangedCircle") {
    boss.bossAttackTarget = {
      x: target.mesh.position.x,
      z: target.mesh.position.z,
    };
  }

  // Create visual indicator mesh
  const mesh = createBossIndicatorMesh(attackType);
  if (mesh) {
    if (attackType === "rangedCircle" && boss.bossAttackTarget) {
      mesh.position.set(boss.bossAttackTarget.x, 0.15, boss.bossAttackTarget.z);
    } else {
      const pos = boss.body.translation();
      mesh.position.set(pos.x, 0.15, pos.z);
    }
    scene.add(mesh);
    boss.bossIndicator = mesh;
  }
}

function _updateBossIndicator(boss) {
  if (!boss.bossIndicator) return;

  const progress = 1 - boss.bossChargeTimer / boss.bossChargeDuration;
  const pulse = 0.5 + Math.sin(progress * Math.PI * 6) * 0.3;

  switch (boss.bossAttackType) {
    case "cone": {
      // Follow boss position, face toward target
      const pos = boss.body.translation();
      boss.bossIndicator.position.set(pos.x, 0.15, pos.z);
      boss.bossIndicator.rotation.z = -boss.mesh.rotation.y;
      boss.bossIndicator.material.opacity = 0.1 + progress * 0.5 * pulse;
      break;
    }
    case "rangedCircle": {
      // Stay at target position, grow in size
      boss.bossIndicator.material.opacity = 0.1 + progress * 0.5 * pulse;
      const scale = 0.3 + progress * 0.7;
      boss.bossIndicator.scale.setScalar(scale);
      break;
    }
    case "stomp": {
      // Follow boss position, grow in size
      const pos = boss.body.translation();
      boss.bossIndicator.position.set(pos.x, 0.15, pos.z);
      boss.bossIndicator.material.opacity = 0.1 + progress * 0.5 * pulse;
      const scale = 0.3 + progress * 0.7;
      boss.bossIndicator.scale.setScalar(scale);
      break;
    }
  }
}

function _executeBossAttack(boss, alivePlayers) {
  const config = BOSS_ATTACK_CONFIG[boss.bossAttackType];
  const dmgScale = 1 + (boss.bossWaveLevel - 1) * 0.3;
  const damage = Math.floor(config.baseDamage * dmgScale);

  switch (boss.bossAttackType) {
    case "cone": {
      const pos = boss.body.translation();
      const facing = boss.mesh.rotation.y;
      for (const p of alivePlayers) {
        const dx = p.mesh.position.x - pos.x;
        const dz = p.mesh.position.z - pos.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist > config.range) continue;

        const angle = Math.atan2(dx, dz);
        let angleDiff = Math.abs(angle - facing);
        if (angleDiff > Math.PI) angleDiff = Math.PI * 2 - angleDiff;
        if (angleDiff < config.angle / 2) {
          damagePlayer(p, damage);
        }
      }
      screenShake(0.6, 0.2);
      break;
    }
    case "rangedCircle": {
      const tx = boss.bossAttackTarget.x;
      const tz = boss.bossAttackTarget.z;
      for (const p of alivePlayers) {
        const dx = p.mesh.position.x - tx;
        const dz = p.mesh.position.z - tz;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist < config.radius) {
          damagePlayer(p, damage);
        }
      }
      screenShake(0.5, 0.15);
      break;
    }
    case "stomp": {
      const pos = boss.body.translation();
      for (const p of alivePlayers) {
        const dx = p.mesh.position.x - pos.x;
        const dz = p.mesh.position.z - pos.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist < config.radius) {
          damagePlayer(p, damage);
        }
      }
      screenShake(0.8, 0.25);
      break;
    }
  }

  // Flash the indicator white to show attack fired
  if (boss.bossIndicator) {
    boss.bossIndicator.material.opacity = 0.9;
    boss.bossIndicator.material.color.setHex(0xffffff);
  }

  boss.bossState = "attacking";
  boss.bossAttackTimer = 0.3; // brief visual flash before cleanup
}

function _cleanupBossIndicator(boss) {
  if (boss.bossIndicator) {
    scene.remove(boss.bossIndicator);
    if (boss.bossIndicator.geometry) boss.bossIndicator.geometry.dispose();
    if (boss.bossIndicator.material) boss.bossIndicator.material.dispose();
    boss.bossIndicator = null;
  }
}

// ── Enemy Projectile System ────────────────────────────────────

const _enemyProjectiles = [];
const _enemyProjPool = [];
const ENEMY_PROJ_HIT_RADIUS = 0.4;

// Unique ID counter for network sync
let _nextEnemyProjId = 1;

let _sharedProjGeo = null;
function _getProjGeo() {
  if (!_sharedProjGeo) {
    _sharedProjGeo = new THREE.SphereGeometry(0.12, 6, 6);
  }
  return _sharedProjGeo;
}

function _fireEnemyProjectile(enemy, target) {
  const ep = enemy.body.translation();
  const tx = target.mesh.position.x;
  const tz = target.mesh.position.z;
  const dx = tx - ep.x;
  const dz = tz - ep.z;
  const len = Math.sqrt(dx * dx + dz * dz);
  if (len < 0.01) return;

  let proj;
  if (_enemyProjPool.length > 0) {
    proj = _enemyProjPool.pop();
    proj.id = _nextEnemyProjId++;
    proj.mesh.position.set(ep.x, ep.y, ep.z);
    proj.mesh.material.color.setHex(enemy.projectileColor);
    proj.mesh.material.emissive.setHex(enemy.projectileColor);
    proj.mesh.visible = true;
    proj.dirX = dx / len;
    proj.dirZ = dz / len;
    proj.speed = enemy.projectileSpeed;
    proj.damage = enemy.projectileDamage;
    proj.lifetime = 3.0;
  } else {
    const mat = new THREE.MeshBasicMaterial({
      color: enemy.projectileColor,
      transparent: true,
      opacity: 1,
    });
    const mesh = new THREE.Mesh(_getProjGeo(), mat);
    mesh.position.set(ep.x, ep.y, ep.z);
    scene.add(mesh);
    proj = {
      id: _nextEnemyProjId++,
      mesh,
      dirX: dx / len,
      dirZ: dz / len,
      speed: enemy.projectileSpeed,
      damage: enemy.projectileDamage,
      lifetime: 3.0,
    };
  }
  _enemyProjectiles.push(proj);
}

/**
 * Update enemy projectiles: move, check collision with players, despawn.
 * @param {number} delta
 * @param {Array} players - Array of player objects
 */
export function updateEnemyProjectiles(delta, players) {
  const alivePlayers = players.filter((p) => p.alive);

  for (let i = _enemyProjectiles.length - 1; i >= 0; i--) {
    const p = _enemyProjectiles[i];

    // Move
    p.mesh.position.x += p.dirX * p.speed * delta;
    p.mesh.position.z += p.dirZ * p.speed * delta;

    // Lifetime
    p.lifetime -= delta;
    if (p.lifetime <= 0) {
      _removeEnemyProjectile(i);
      continue;
    }

    // Fade when close to expiry
    if (p.lifetime < 0.5) {
      p.mesh.material.opacity = p.lifetime / 0.5;
    }

    // Pulse scale for visual flair
    const pulse = 1 + Math.sin(p.lifetime * 15) * 0.2;
    p.mesh.scale.setScalar(pulse);

    // Collision with alive players
    let hit = false;
    for (const pl of alivePlayers) {
      const d = distXZ(p.mesh.position, pl.mesh.position);
      if (d < ENEMY_PROJ_HIT_RADIUS + 0.3) {
        damagePlayer(pl, p.damage);
        // Spawn a small hit particle effect
        spawnDeathParticles(
          p.mesh.position.x,
          p.mesh.position.y,
          p.mesh.position.z,
          0xdd55ff,
        );
        _removeEnemyProjectile(i);
        hit = true;
        break;
      }
    }
  }
}

function _removeEnemyProjectile(index) {
  const p = _enemyProjectiles[index];
  p.mesh.visible = false;
  p.mesh.scale.setScalar(1);
  p.mesh.material.opacity = 1;
  _enemyProjPool.push(p);
  // Swap-and-pop
  const last = _enemyProjectiles[_enemyProjectiles.length - 1];
  _enemyProjectiles[index] = last;
  _enemyProjectiles.pop();
}

/**
 * Get the active enemy projectiles array (for state serialization).
 */
export function getActiveEnemyProjectiles() {
  return _enemyProjectiles;
}

export function resetEnemyProjectiles() {
  for (const p of _enemyProjectiles) {
    p.mesh.visible = false;
    _enemyProjPool.push(p);
  }
  _enemyProjectiles.length = 0;
}
