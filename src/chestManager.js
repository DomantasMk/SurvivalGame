// chestManager.js — Chest spawning, buff management, and visual effects

import * as THREE from "three";
import { distXZ } from "./utils.js";
import { spawnDeathParticles } from "./particles.js";

// ── Configuration ──────────────────────────────────────────────

const PICKUP_RADIUS = 1.8;
const BUFF_DURATION = 60; // seconds
const SPAWN_INTERVAL_MIN = 15;
const SPAWN_INTERVAL_MAX = 25;
const MAX_CHESTS = 5;
const ARENA_SPAWN_RANGE = 40; // spawn within ±40 of center

export const BUFF_TYPES = ["doubleProjectiles", "speedBoost", "glowingArmor"];

export const BUFF_INFO = {
  doubleProjectiles: { name: "Double Shot", color: "#aa66ff", hex: 0xaa66ff },
  speedBoost: { name: "Speed Boost", color: "#44ccff", hex: 0x44ccff },
  glowingArmor: { name: "Glowing Armor", color: "#ffcc00", hex: 0xffcc00 },
};

const CHEST_COLORS = {
  doubleProjectiles: { main: 0xaa44ff, glow: 0xcc66ff },
  speedBoost: { main: 0x44aaff, glow: 0x66ccff },
  glowingArmor: { main: 0xffaa00, glow: 0xffcc44 },
};

// ── State ──────────────────────────────────────────────────────

let _scene = null;
const _chests = [];
let _nextChestId = 0;
let _spawnTimer = 10; // first chest after 10 seconds

// Buff visual meshes per player (WeakMap avoids memory leaks)
const _buffVisuals = new WeakMap();

// ── Public API ─────────────────────────────────────────────────

export function createChestManager(s) {
  _scene = s;
  _spawnTimer = 10;
  _chests.length = 0;
  _nextChestId = 0;
}

/**
 * Host-only: update chests — spawn, animate, detect pickups, tick buff timers.
 * @param {number} delta
 * @param {Array} players
 * @param {number} gameTime
 * @returns {Array} pickup events [{ playerIndex, buffType }]
 */
export function updateChests(delta, players, gameTime) {
  const pickups = [];

  // --- Spawn new chests periodically ---
  _spawnTimer -= delta;
  if (_spawnTimer <= 0 && _chests.length < MAX_CHESTS) {
    _spawnTimer =
      SPAWN_INTERVAL_MIN +
      Math.random() * (SPAWN_INTERVAL_MAX - SPAWN_INTERVAL_MIN);
    _spawnChest();
  }

  // --- Animate (float + rotate) ---
  for (const ch of _chests) {
    ch.mesh.rotation.y += delta * 1.2;
    ch.mesh.position.y = 0.8 + Math.sin(gameTime * 2.5 + ch.id * 1.7) * 0.2;
    if (ch.glowMesh) {
      ch.glowMesh.material.opacity =
        0.12 + Math.sin(gameTime * 3 + ch.id) * 0.06;
    }
    if (ch.beaconMesh) {
      ch.beaconMesh.material.opacity =
        0.08 + Math.sin(gameTime * 2 + ch.id * 0.5) * 0.04;
    }
  }

  // --- Pickup detection ---
  const alive = players.filter((p) => p.alive);
  for (let i = _chests.length - 1; i >= 0; i--) {
    const ch = _chests[i];
    for (const p of alive) {
      if (distXZ(ch.mesh.position, p.mesh.position) < PICKUP_RADIUS) {
        // Apply buff to the player
        _applyBuff(p, ch.buffType);

        // Pickup particle burst
        const col = CHEST_COLORS[ch.buffType];
        for (let k = 0; k < 3; k++) {
          spawnDeathParticles(
            ch.mesh.position.x + (Math.random() - 0.5),
            ch.mesh.position.y,
            ch.mesh.position.z + (Math.random() - 0.5),
            col.main,
          );
        }

        pickups.push({
          playerIndex: players.indexOf(p),
          buffType: ch.buffType,
        });
        _destroyChest(i);
        break;
      }
    }
  }

  // --- Tick buff timers for all players ---
  for (const p of players) {
    if (!p.buffs) continue;
    for (const key of BUFF_TYPES) {
      if (p.buffs[key] > 0) {
        p.buffs[key] = Math.max(0, p.buffs[key] - delta);
      }
    }
  }

  return pickups;
}

/**
 * Update buff visual effects attached to player meshes.
 * Works for both host and guest (guest applies buff timers from state first).
 */
export function updateBuffVisuals(players, gameTime) {
  for (const p of players) {
    if (!p.buffs || !p.mesh) continue;

    let vis = _buffVisuals.get(p);
    if (!vis) {
      vis = {};
      _buffVisuals.set(p, vis);
    }

    // -- Glowing Armor: golden sphere --
    _toggleVis(p, vis, "glowingArmor", "armorGlow", () => {
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.65, 12, 12),
        new THREE.MeshBasicMaterial({
          color: 0xffcc00,
          transparent: true,
          opacity: 0.2,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      );
      return mesh;
    });
    if (vis.armorGlow) {
      vis.armorGlow.material.opacity = 0.15 + Math.sin(gameTime * 4) * 0.08;
      vis.armorGlow.rotation.y += 0.02;
    }

    // -- Speed Boost: cyan ring at feet --
    _toggleVis(p, vis, "speedBoost", "speedRing", () => {
      const mesh = new THREE.Mesh(
        new THREE.RingGeometry(0.45, 0.6, 16),
        new THREE.MeshBasicMaterial({
          color: 0x44ccff,
          transparent: true,
          opacity: 0.35,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = -0.35;
      return mesh;
    });
    if (vis.speedRing) {
      vis.speedRing.rotation.z += 0.12;
      const s = 1 + Math.sin(gameTime * 6) * 0.15;
      vis.speedRing.scale.setScalar(s);
    }

    // -- Double Projectiles: orbiting purple orbs --
    _toggleVis(p, vis, "doubleProjectiles", "projOrbs", () => {
      const grp = new THREE.Group();
      for (let i = 0; i < 3; i++) {
        grp.add(
          new THREE.Mesh(
            new THREE.SphereGeometry(0.07, 6, 6),
            new THREE.MeshBasicMaterial({
              color: 0xaa66ff,
              transparent: true,
              opacity: 0.7,
            }),
          ),
        );
      }
      grp.position.y = 0.2;
      return grp;
    });
    if (vis.projOrbs) {
      const orbs = vis.projOrbs.children;
      for (let i = 0; i < orbs.length; i++) {
        const a = (i / orbs.length) * Math.PI * 2 + gameTime * 3;
        orbs[i].position.x = Math.cos(a) * 0.45;
        orbs[i].position.z = Math.sin(a) * 0.45;
        orbs[i].position.y = Math.sin(gameTime * 4 + i) * 0.08;
      }
    }
  }
}

/**
 * Build a chest mesh group (exported so guests can create visual meshes).
 * @param {string} buffType
 * @returns {{ mesh: THREE.Group, glowMesh: THREE.Mesh, beaconMesh: THREE.Mesh }}
 */
export function createChestMesh(buffType) {
  return _buildChestModel(buffType);
}

/**
 * Get active chests array (for host state serialization).
 */
export function getActiveChests() {
  return _chests;
}

/**
 * Reset all chests and timers.
 */
export function resetChests() {
  for (const ch of _chests) {
    if (_scene) _scene.remove(ch.mesh);
    _disposeTree(ch.mesh);
  }
  _chests.length = 0;
  _spawnTimer = 10;
  _nextChestId = 0;
}

// ── Internal helpers ───────────────────────────────────────────

function _applyBuff(player, buffType) {
  if (!player.buffs) {
    player.buffs = {
      doubleProjectiles: 0,
      speedBoost: 0,
      glowingArmor: 0,
    };
  }
  player.buffs[buffType] = BUFF_DURATION;
}

function _spawnChest() {
  const x = (Math.random() - 0.5) * ARENA_SPAWN_RANGE * 2;
  const z = (Math.random() - 0.5) * ARENA_SPAWN_RANGE * 2;
  const buffType = BUFF_TYPES[Math.floor(Math.random() * BUFF_TYPES.length)];

  const { mesh, glowMesh, beaconMesh } = _buildChestModel(buffType);
  mesh.position.set(x, 0.8, z);
  _scene.add(mesh);

  _chests.push({
    id: _nextChestId++,
    mesh,
    glowMesh,
    beaconMesh,
    buffType,
  });
}

function _buildChestModel(buffType) {
  const group = new THREE.Group();
  const col = CHEST_COLORS[buffType];

  // Chest base (wooden box)
  const base = new THREE.Mesh(
    new THREE.BoxGeometry(0.6, 0.35, 0.4),
    new THREE.MeshStandardMaterial({
      color: 0x8b4513,
      roughness: 0.7,
      metalness: 0.1,
    }),
  );
  base.castShadow = true;
  group.add(base);

  // Lid
  const lid = new THREE.Mesh(
    new THREE.BoxGeometry(0.64, 0.12, 0.44),
    new THREE.MeshStandardMaterial({
      color: 0x6b3410,
      roughness: 0.7,
      metalness: 0.1,
    }),
  );
  lid.position.y = 0.22;
  lid.castShadow = true;
  group.add(lid);

  // Metal band (colored by buff type)
  const band = new THREE.Mesh(
    new THREE.BoxGeometry(0.65, 0.04, 0.45),
    new THREE.MeshStandardMaterial({
      color: col.main,
      roughness: 0.3,
      metalness: 0.7,
      emissive: col.glow,
      emissiveIntensity: 0.4,
    }),
  );
  band.position.y = 0.16;
  group.add(band);

  // Lock gem (front)
  const lock = new THREE.Mesh(
    new THREE.SphereGeometry(0.06, 6, 6),
    new THREE.MeshStandardMaterial({
      color: col.glow,
      roughness: 0.2,
      metalness: 0.8,
      emissive: col.glow,
      emissiveIntensity: 0.8,
    }),
  );
  lock.position.set(0, 0.08, 0.22);
  group.add(lock);

  // Glow aura (sphere around chest)
  const glowMesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.7, 10, 10),
    new THREE.MeshBasicMaterial({
      color: col.glow,
      transparent: true,
      opacity: 0.12,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  group.add(glowMesh);

  // Beacon pillar (vertical light column, visible from far away)
  const beaconMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(0.15, 0.3, 6, 8),
    new THREE.MeshBasicMaterial({
      color: col.glow,
      transparent: true,
      opacity: 0.08,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  beaconMesh.position.y = 3;
  group.add(beaconMesh);

  return { mesh: group, glowMesh, beaconMesh };
}

function _destroyChest(index) {
  const ch = _chests[index];
  _scene.remove(ch.mesh);
  _disposeTree(ch.mesh);
  // Swap-and-pop removal
  const last = _chests[_chests.length - 1];
  _chests[index] = last;
  _chests.pop();
}

function _toggleVis(player, vis, buffKey, visKey, createFn) {
  if (player.buffs[buffKey] > 0 && !vis[visKey]) {
    const mesh = createFn();
    player.mesh.add(mesh);
    vis[visKey] = mesh;
  } else if (player.buffs[buffKey] <= 0 && vis[visKey]) {
    player.mesh.remove(vis[visKey]);
    _disposeTree(vis[visKey]);
    vis[visKey] = null;
  }
}

function _disposeTree(obj) {
  if (!obj) return;
  if (obj.geometry) obj.geometry.dispose();
  if (obj.material) obj.material.dispose();
  if (obj.children) {
    for (const c of [...obj.children]) _disposeTree(c);
  }
}
