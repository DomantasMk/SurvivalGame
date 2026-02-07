// particles.js — Simple death particle effects

import * as THREE from "three";
import { gameState } from "./main.js";

const particles = [];
const pool = [];
const PARTICLES_PER_DEATH = 6;
const PARTICLE_SPEED = 5;
const PARTICLE_LIFETIME = 0.4;
const PARTICLE_SIZE = 0.12;

// Shared geometry
let sharedGeo = null;

function getGeometry() {
  if (!sharedGeo) {
    sharedGeo = new THREE.BoxGeometry(
      PARTICLE_SIZE,
      PARTICLE_SIZE,
      PARTICLE_SIZE,
    );
  }
  return sharedGeo;
}

/**
 * Spawn death particles at a position with a given color.
 */
export function spawnDeathParticles(x, y, z, color) {
  const scene = gameState.scene;
  if (!scene) return;

  for (let i = 0; i < PARTICLES_PER_DEATH; i++) {
    let p;
    if (pool.length > 0) {
      p = pool.pop();
      p.mesh.material.color.setHex(color);
      p.mesh.position.set(x, y, z);
      p.mesh.visible = true;
    } else {
      const mat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 1,
      });
      const mesh = new THREE.Mesh(getGeometry(), mat);
      mesh.position.set(x, y, z);
      scene.add(mesh);
      p = { mesh };
    }

    // Random direction
    const angle = Math.random() * Math.PI * 2;
    const speed = PARTICLE_SPEED * (0.5 + Math.random() * 0.5);
    p.vx = Math.cos(angle) * speed;
    p.vy = 2 + Math.random() * 3;
    p.vz = Math.sin(angle) * speed;
    p.lifetime = PARTICLE_LIFETIME;
    p.maxLifetime = PARTICLE_LIFETIME;

    particles.push(p);
  }
}

/**
 * Update all active particles.
 */
export function updateParticles(delta) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.lifetime -= delta;

    if (p.lifetime <= 0) {
      p.mesh.visible = false;
      pool.push(p);
      particles.splice(i, 1);
      continue;
    }

    // Move
    p.mesh.position.x += p.vx * delta;
    p.mesh.position.y += p.vy * delta;
    p.mesh.position.z += p.vz * delta;
    p.vy -= 12 * delta; // gravity

    // Fade out
    const t = p.lifetime / p.maxLifetime;
    p.mesh.material.opacity = t;
    p.mesh.scale.setScalar(t);
  }
}
