// player.js — Player entity factory (supports multiple player instances)

import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { clamp } from "./utils.js";
import { screenShake } from "./camera.js";
import {
  createPlayerModel,
  animatePlayerModel,
  resetAnimParts,
} from "./models.js";

// Player configuration
const PLAYER_SIZE = 0.5;
const BASE_SPEED = 7;
const INVINCIBILITY_DURATION = 0.8; // seconds

// Per-player animation time tracking
const _animTimes = new WeakMap();

/**
 * Create a new player object with mesh, physics body, and stats.
 * @param {THREE.Scene} scene
 * @param {RAPIER.World} world
 * @param {{ spawnX?: number, spawnZ?: number, colorTheme?: string }} config
 */
export function createPlayer(scene, world, config = {}) {
  const { spawnX = 0, spawnZ = 0, colorTheme = "blue" } = config;

  // --- Mesh (detailed character model with color theme) ---
  const { group, anim } = createPlayerModel(colorTheme);
  group.position.set(spawnX, PLAYER_SIZE * 0.9, spawnZ);
  scene.add(group);

  // --- Rapier kinematic rigid body ---
  const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
    spawnX,
    PLAYER_SIZE * 0.9,
    spawnZ,
  );
  const body = world.createRigidBody(bodyDesc);

  const colliderDesc = RAPIER.ColliderDesc.cuboid(
    PLAYER_SIZE / 2,
    PLAYER_SIZE * 0.9,
    PLAYER_SIZE / 2,
  );
  const collider = world.createCollider(colliderDesc, body);

  const playerObj = {
    mesh: group,
    body,
    collider,

    // Stats
    hp: 150,
    maxHp: 150,
    speed: BASE_SPEED,
    level: 1,
    xp: 0,
    armor: 0,
    pickupRadius: 3.5,

    // State
    invincibilityTimer: 0,
    alive: true,
    kills: 0,

    // Facing direction (for whip etc.)
    facingAngle: 0,

    // Animation references
    anim,

    // Per-player weapon list (managed by weaponManager)
    weapons: [],

    // Config for reset
    colorTheme,
    spawnX,
    spawnZ,
  };

  _animTimes.set(playerObj, 0);

  return playerObj;
}

const _moveVec = new THREE.Vector3();

/**
 * Update a player's position, animation, and invincibility.
 * @param {object} playerObj - The player object
 * @param {number} delta - Frame delta time
 * @param {number} arenaHalf - Half the arena size for clamping
 * @param {{ x: number, z: number }} inputVec - Movement input vector
 */
export function updatePlayer(playerObj, delta, arenaHalf, inputVec) {
  if (!playerObj.alive) return;

  let animTime = _animTimes.get(playerObj) || 0;
  animTime += delta;
  _animTimes.set(playerObj, animTime);

  // --- Movement ---
  _moveVec.set(
    inputVec.x * playerObj.speed * delta,
    0,
    inputVec.z * playerObj.speed * delta,
  );

  const pos = playerObj.mesh.position;
  pos.x += _moveVec.x;
  pos.z += _moveVec.z;

  // Clamp to arena bounds
  pos.x = clamp(pos.x, -arenaHalf, arenaHalf);
  pos.z = clamp(pos.z, -arenaHalf, arenaHalf);

  // Sync physics body
  playerObj.body.setNextKinematicTranslation({
    x: pos.x,
    y: PLAYER_SIZE * 0.9,
    z: pos.z,
  });

  // --- Facing direction ---
  const isMoving = Math.abs(inputVec.x) > 0.01 || Math.abs(inputVec.z) > 0.01;
  if (isMoving) {
    playerObj.facingAngle = Math.atan2(inputVec.x, inputVec.z);
    playerObj.mesh.rotation.y = playerObj.facingAngle;
  }

  // --- Walking animation ---
  animatePlayerModel(playerObj.anim, isMoving, animTime);

  // --- Invincibility timer ---
  if (playerObj.invincibilityTimer > 0) {
    playerObj.invincibilityTimer -= delta;
    // Flash effect: toggle visibility
    playerObj.mesh.visible =
      Math.floor(playerObj.invincibilityTimer * 10) % 2 === 0;
  } else {
    playerObj.mesh.visible = true;
  }
}

/**
 * Deal damage to a player. Respects invincibility and armor.
 */
export function damagePlayer(playerObj, amount) {
  if (!playerObj.alive) return;
  if (playerObj.invincibilityTimer > 0) return;

  const effectiveDamage = Math.max(1, amount - playerObj.armor);
  playerObj.hp -= effectiveDamage;
  playerObj.invincibilityTimer = INVINCIBILITY_DURATION;
  screenShake(0.4, 0.15);

  if (playerObj.hp <= 0) {
    playerObj.hp = 0;
    playerObj.alive = false;
    // Rotate to lie on the ground
    playerObj.mesh.rotation.x = -Math.PI / 2;
    playerObj.mesh.position.y = 0.15;
  }
}

/**
 * Reset a player to initial state (for restart).
 */
export function resetPlayer(playerObj) {
  playerObj.hp = 150;
  playerObj.maxHp = 150;
  playerObj.speed = BASE_SPEED;
  playerObj.level = 1;
  playerObj.xp = 0;
  playerObj.armor = 0;
  playerObj.pickupRadius = 3.5;
  playerObj.invincibilityTimer = 0;
  playerObj.alive = true;
  playerObj.kills = 0;
  playerObj.facingAngle = 0;
  playerObj.weapons = [];
  _animTimes.set(playerObj, 0);
  if (playerObj.mesh) {
    playerObj.mesh.position.set(
      playerObj.spawnX || 0,
      PLAYER_SIZE * 0.9,
      playerObj.spawnZ || 0,
    );
    playerObj.mesh.rotation.set(0, 0, 0);
    playerObj.mesh.visible = true;
    resetAnimParts(playerObj.anim);
  }
  if (playerObj.body) {
    playerObj.body.setNextKinematicTranslation({
      x: playerObj.spawnX || 0,
      y: PLAYER_SIZE * 0.9,
      z: playerObj.spawnZ || 0,
    });
  }
}
