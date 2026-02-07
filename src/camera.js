// camera.js — Top-down camera that follows the player + screen shake

import * as THREE from "three";

const CAMERA_OFFSET = new THREE.Vector3(0, 7, 10);
const LERP_SPEED = 4.0;

// Maximum camera movement per second (units/s) — clamps sudden jumps from network jitter
const MAX_CAMERA_SPEED = 50;

const _targetPos = new THREE.Vector3();
const _prevLookAt = new THREE.Vector3();
let _lookAtInitialized = false;

// Screen shake state
let shakeIntensity = 0;
let shakeDuration = 0;
let shakeTimer = 0;

/**
 * Trigger screen shake.
 */
export function screenShake(intensity = 0.3, duration = 0.15) {
  shakeIntensity = intensity;
  shakeDuration = duration;
  shakeTimer = duration;
}

/**
 * Reset camera tracking state (call on game restart).
 */
export function resetCamera() {
  _lookAtInitialized = false;
}

/**
 * Smoothly move the camera to follow the player, with screen shake.
 * Includes a velocity clamp to prevent stutter from network position jitter.
 */
export function updateCamera(camera, playerMesh, delta) {
  if (!playerMesh) return;

  _targetPos.copy(playerMesh.position).add(CAMERA_OFFSET);

  // Compute desired movement
  const dx = _targetPos.x - camera.position.x;
  const dy = _targetPos.y - camera.position.y;
  const dz = _targetPos.z - camera.position.z;

  // Exponential smoothing factor
  const lerpFactor = 1 - Math.exp(-LERP_SPEED * delta);

  let moveX = dx * lerpFactor;
  let moveY = dy * lerpFactor;
  let moveZ = dz * lerpFactor;

  // Clamp the per-frame movement so the camera can never jump faster than MAX_CAMERA_SPEED
  const maxMove = MAX_CAMERA_SPEED * delta;
  const moveDist = Math.sqrt(moveX * moveX + moveY * moveY + moveZ * moveZ);
  if (moveDist > maxMove) {
    const scale = maxMove / moveDist;
    moveX *= scale;
    moveY *= scale;
    moveZ *= scale;
  }

  camera.position.x += moveX;
  camera.position.y += moveY;
  camera.position.z += moveZ;

  // Apply screen shake
  if (shakeTimer > 0) {
    shakeTimer -= delta;
    const progress = shakeTimer / shakeDuration;
    const currentIntensity = shakeIntensity * progress;
    camera.position.x += (Math.random() - 0.5) * currentIntensity;
    camera.position.y += (Math.random() - 0.5) * currentIntensity * 0.5;
    camera.position.z += (Math.random() - 0.5) * currentIntensity;
  }

  // Smooth the lookAt target as well to avoid rotational jitter
  if (!_lookAtInitialized) {
    _prevLookAt.copy(playerMesh.position);
    _lookAtInitialized = true;
  } else {
    _prevLookAt.lerp(playerMesh.position, lerpFactor);
  }
  camera.lookAt(_prevLookAt.x, _prevLookAt.y, _prevLookAt.z);
}
