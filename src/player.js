// player.js — Player entity (mesh, physics body, HP, speed, invincibility frames)

import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { getMovementVector } from "./input.js";
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

export const player = {
  mesh: null,
  body: null,
  collider: null,

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
  anim: null,
};

// Accumulated time for animation
let _animTime = 0;

export function createPlayer(scene, world) {
  // --- Mesh (detailed character model) ---
  const { group, anim } = createPlayerModel();
  player.mesh = group;
  player.anim = anim;
  group.position.set(0, PLAYER_SIZE * 0.9, 0);
  scene.add(group);

  // --- Rapier kinematic rigid body ---
  const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
    0,
    PLAYER_SIZE * 0.9,
    0,
  );
  player.body = world.createRigidBody(bodyDesc);

  const colliderDesc = RAPIER.ColliderDesc.cuboid(
    PLAYER_SIZE / 2,
    PLAYER_SIZE * 0.9,
    PLAYER_SIZE / 2,
  );
  player.collider = world.createCollider(colliderDesc, player.body);

  return player;
}

const _moveVec = new THREE.Vector3();

export function updatePlayer(delta, arenaHalf) {
  if (!player.alive) return;

  _animTime += delta;

  // --- Movement ---
  const input = getMovementVector();
  _moveVec.set(
    input.x * player.speed * delta,
    0,
    input.z * player.speed * delta,
  );

  const pos = player.mesh.position;
  pos.x += _moveVec.x;
  pos.z += _moveVec.z;

  // Clamp to arena bounds
  pos.x = clamp(pos.x, -arenaHalf, arenaHalf);
  pos.z = clamp(pos.z, -arenaHalf, arenaHalf);

  // Sync physics body
  player.body.setNextKinematicTranslation({
    x: pos.x,
    y: PLAYER_SIZE * 0.9,
    z: pos.z,
  });

  // --- Facing direction ---
  const isMoving = Math.abs(input.x) > 0.01 || Math.abs(input.z) > 0.01;
  if (isMoving) {
    player.facingAngle = Math.atan2(input.x, input.z);
    player.mesh.rotation.y = player.facingAngle;
  }

  // --- Walking animation ---
  animatePlayerModel(player.anim, isMoving, _animTime);

  // --- Invincibility timer ---
  if (player.invincibilityTimer > 0) {
    player.invincibilityTimer -= delta;
    // Flash effect: toggle visibility
    player.mesh.visible = Math.floor(player.invincibilityTimer * 10) % 2 === 0;
  } else {
    player.mesh.visible = true;
  }
}

/**
 * Deal damage to the player. Respects invincibility and armor.
 */
export function damagePlayer(amount) {
  if (!player.alive) return;
  if (player.invincibilityTimer > 0) return;

  const effectiveDamage = Math.max(1, amount - player.armor);
  player.hp -= effectiveDamage;
  player.invincibilityTimer = INVINCIBILITY_DURATION;
  screenShake(0.4, 0.15);

  if (player.hp <= 0) {
    player.hp = 0;
    player.alive = false;
  }
}

/**
 * Reset player to initial state (for restart).
 */
export function resetPlayer() {
  player.hp = 150;
  player.maxHp = 150;
  player.speed = BASE_SPEED;
  player.level = 1;
  player.xp = 0;
  player.armor = 0;
  player.pickupRadius = 3.5;
  player.invincibilityTimer = 0;
  player.alive = true;
  player.kills = 0;
  player.facingAngle = 0;
  _animTime = 0;
  if (player.mesh) {
    player.mesh.position.set(0, PLAYER_SIZE * 0.9, 0);
    player.mesh.rotation.set(0, 0, 0);
    player.mesh.visible = true;
    resetAnimParts(player.anim);
  }
  if (player.body) {
    player.body.setNextKinematicTranslation({
      x: 0,
      y: PLAYER_SIZE * 0.9,
      z: 0,
    });
  }
}
