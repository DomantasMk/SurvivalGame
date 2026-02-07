// camera.js — Top-down camera that follows the player + screen shake

import * as THREE from "three";

const CAMERA_OFFSET = new THREE.Vector3(0, 7, 10);
const LERP_SPEED = 4.0;

const _targetPos = new THREE.Vector3();

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
 * Smoothly move the camera to follow the player, with screen shake.
 */
export function updateCamera(camera, playerMesh, delta) {
  if (!playerMesh) return;

  _targetPos.copy(playerMesh.position).add(CAMERA_OFFSET);
  camera.position.lerp(_targetPos, 1 - Math.exp(-LERP_SPEED * delta));

  // Apply screen shake
  if (shakeTimer > 0) {
    shakeTimer -= delta;
    const progress = shakeTimer / shakeDuration;
    const currentIntensity = shakeIntensity * progress;
    camera.position.x += (Math.random() - 0.5) * currentIntensity;
    camera.position.y += (Math.random() - 0.5) * currentIntensity * 0.5;
    camera.position.z += (Math.random() - 0.5) * currentIntensity;
  }

  camera.lookAt(
    playerMesh.position.x,
    playerMesh.position.y,
    playerMesh.position.z,
  );
}
