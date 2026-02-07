// projectiles.js — Projectile lifecycle (spawn, move, collision, despawn)

import * as THREE from "three";
import { damageEnemy } from "./enemyManager.js";
import { distXZ } from "./utils.js";

let scene, world;

// Active projectiles
const projectiles = [];

// Object pool
const pool = [];

const HIT_RADIUS = 0.6; // collision radius for projectile vs enemy

export function createProjectileManager(s, w) {
  scene = s;
  world = w;
}

/**
 * Fire a projectile.
 * opts: { x, z, dirX, dirZ, speed, damage, lifetime, pierce, color, size }
 */
export function fireProjectile(opts) {
  let proj;
  if (pool.length > 0) {
    proj = pool.pop();
    _resetProjectile(proj, opts);
  } else {
    proj = _createProjectile(opts);
  }
  projectiles.push(proj);
  proj.mesh.visible = true;
  return proj;
}

function _createProjectile(opts) {
  const geometry = new THREE.SphereGeometry(opts.size || 0.15, 6, 6);
  const material = new THREE.MeshBasicMaterial({
    color: opts.color || 0x44ccff,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(opts.x, 0.8, opts.z);
  scene.add(mesh);

  return {
    mesh,
    dirX: opts.dirX,
    dirZ: opts.dirZ,
    speed: opts.speed,
    damage: opts.damage,
    lifetime: opts.lifetime,
    pierce: opts.pierce || 0,
    pierced: 0,
    hitSet: new Set(),
    size: opts.size || 0.15,
  };
}

function _resetProjectile(proj, opts) {
  proj.mesh.position.set(opts.x, 0.8, opts.z);
  proj.mesh.material.color.setHex(opts.color || 0x44ccff);
  proj.dirX = opts.dirX;
  proj.dirZ = opts.dirZ;
  proj.speed = opts.speed;
  proj.damage = opts.damage;
  proj.lifetime = opts.lifetime;
  proj.pierce = opts.pierce || 0;
  proj.pierced = 0;
  proj.hitSet.clear();
}

export function updateProjectiles(delta, enemiesList) {
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i];

    // Move
    p.mesh.position.x += p.dirX * p.speed * delta;
    p.mesh.position.z += p.dirZ * p.speed * delta;

    // Lifetime
    p.lifetime -= delta;
    if (p.lifetime <= 0) {
      _removeProjectile(i);
      continue;
    }

    // Collision with enemies
    let removed = false;
    for (const e of enemiesList) {
      if (!e.alive) continue;
      if (p.hitSet.has(e)) continue;

      const d = distXZ(p.mesh.position, e.mesh.position);
      if (d < HIT_RADIUS + e.size * 0.5) {
        damageEnemy(e, p.damage);
        p.hitSet.add(e);
        p.pierced++;

        if (p.pierced > p.pierce) {
          _removeProjectile(i);
          removed = true;
          break;
        }
      }
    }
  }
}

function _removeProjectile(index) {
  const p = projectiles[index];
  p.mesh.visible = false;
  pool.push(p);
  projectiles.splice(index, 1);
}

/**
 * Get the active projectiles array (for state serialization).
 */
export function getActiveProjectiles() {
  return projectiles;
}

export function resetProjectiles() {
  for (const p of projectiles) {
    p.mesh.visible = false;
    pool.push(p);
  }
  projectiles.length = 0;
}
