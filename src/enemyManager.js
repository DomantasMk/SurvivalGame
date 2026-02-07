// enemyManager.js — Enemy spawning, pooling, AI (move toward player)

import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { damagePlayer, player } from "./player.js";
import { spawnXpGem } from "./xpManager.js";
import { gameState } from "./main.js";
import { spawnDeathParticles } from "./particles.js";
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

// Enemy type definitions
export const ENEMY_TYPES = {
  bat: {
    name: "Bat",
    color: 0xff4466,
    size: 0.3,
    hp: 12,
    speed: 3.5,
    damage: 4,
    xpValue: 1,
  },
  skeleton: {
    name: "Skeleton",
    color: 0xccccaa,
    size: 0.4,
    hp: 25,
    speed: 2.5,
    damage: 7,
    xpValue: 3,
  },
  zombie: {
    name: "Zombie",
    color: 0x66aa66,
    size: 0.5,
    hp: 45,
    speed: 1.5,
    damage: 12,
    xpValue: 6,
  },
  boss: {
    name: "Boss",
    color: 0xaa00ff,
    size: 1.0,
    hp: 350,
    speed: 1.8,
    damage: 20,
    xpValue: 60,
  },
};

const MAX_ENEMIES = 300;
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

  return {
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
}

function _resetEnemy(enemy, def, x, z) {
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
}

const _dir = new THREE.Vector3();

export function updateEnemies(delta, player) {
  _enemyTime += delta;

  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];

    if (!e.alive) {
      _killEnemy(i);
      continue;
    }

    // --- AI: move toward player ---
    const pp = player.mesh.position;
    const ep = e.body.translation();

    _dir.set(pp.x - ep.x, 0, pp.z - ep.z);
    const dist = _dir.length();

    if (dist > 0.1) {
      _dir.normalize().multiplyScalar(e.speed);
      e.body.setLinvel({ x: _dir.x, y: e.body.linvel().y, z: _dir.z }, true);
    }

    // Sync mesh to physics
    const t = e.body.translation();
    e.mesh.position.set(t.x, t.y, t.z);

    // Face toward the player
    if (dist > 0.5) {
      e.mesh.rotation.y = Math.atan2(pp.x - t.x, pp.z - t.z);
    }

    // --- Bat bob (flying) ---
    if (e.type === "Bat") {
      e.mesh.position.y +=
        Math.sin((_enemyTime + e.animTimeOffset) * 6) * e.size * 0.15;
    }

    // --- Animate model ---
    animateEnemyModel(e.type, e.anim, _enemyTime + e.animTimeOffset);

    // --- Contact damage to player ---
    e.damageCooldown -= delta;
    if (dist < e.size / 2 + 0.5 && e.damageCooldown <= 0) {
      damagePlayer(e.damage);
      e.damageCooldown = DAMAGE_COOLDOWN;

      // Knockback player slightly
      if (player.body) {
        const kb = _dir
          .clone()
          .normalize()
          .multiplyScalar(-KNOCKBACK_FORCE * 0.3);
        player.mesh.position.x += kb.x;
        player.mesh.position.z += kb.z;
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

  // Death particles
  spawnDeathParticles(pos.x, pos.y, pos.z, e.originalColor);

  // Drop XP gem
  spawnXpGem(pos.x, pos.z, e.xpValue);

  // Increment kill counter
  player.kills++;

  // Return to type-specific pool
  e.mesh.visible = false;
  e.body.setEnabled(false);
  e.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  if (!pools[e.typeKey]) pools[e.typeKey] = [];
  pools[e.typeKey].push(e);
  enemies.splice(index, 1);
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
    e.mesh.visible = false;
    e.body.setEnabled(false);
    if (!pools[e.typeKey]) pools[e.typeKey] = [];
    pools[e.typeKey].push(e);
  }
  enemies.length = 0;
  _enemyTime = 0;
}
