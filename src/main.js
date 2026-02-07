// main.js — Entry point, game loop, orchestration

import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { createPlayer, updatePlayer, player, resetPlayer } from "./player.js";
import { updateCamera } from "./camera.js";
import {
  createEnemyManager,
  updateEnemies,
  resetEnemies,
  enemies,
} from "./enemyManager.js";
import {
  createWaveDirector,
  updateWaveDirector,
  resetWaveDirector,
} from "./waveDirector.js";
import {
  createWeaponManager,
  updateWeapons,
  resetWeapons,
  equippedWeapons,
  addWeapon,
} from "./weaponManager.js";
import {
  updateProjectiles,
  resetProjectiles,
  createProjectileManager,
} from "./projectiles.js";
import { createXpManager, updateXpGems, resetXpGems } from "./xpManager.js";
import { createHud, updateHud } from "./hud.js";
import {
  createUpgradeMenu,
  showUpgradeMenu,
  isUpgradeMenuOpen,
} from "./upgradeMenu.js";
import { updateParticles } from "./particles.js";

// ---------- Game State ----------
export const gameState = {
  paused: false,
  gameOver: false,
  gameTime: 0, // seconds elapsed
  scene: null,
  world: null,
  camera: null,
  renderer: null,
};

const ARENA_SIZE = 100;
const ARENA_HALF = ARENA_SIZE / 2;

async function init() {
  // Initialize Rapier physics
  await RAPIER.init();

  const gravity = { x: 0.0, y: -9.81, z: 0.0 };
  const world = new RAPIER.World(gravity);
  gameState.world = world;

  // --- Three.js Setup ---
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1a2e);
  scene.fog = new THREE.Fog(0x1a1a2e, 40, 65);
  gameState.scene = scene;

  const camera = new THREE.PerspectiveCamera(
    60,
    window.innerWidth / window.innerHeight,
    0.1,
    1000,
  );
  camera.position.set(0, 22, 14);
  camera.lookAt(0, 0, 0);
  gameState.camera = camera;

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.body.appendChild(renderer.domElement);
  gameState.renderer = renderer;

  // --- Lighting ---
  const ambientLight = new THREE.AmbientLight(0x404060, 0.6);
  scene.add(ambientLight);

  const directionalLight = new THREE.DirectionalLight(0xffffff, 1.2);
  directionalLight.position.set(5, 15, 7);
  directionalLight.castShadow = true;
  directionalLight.shadow.mapSize.width = 2048;
  directionalLight.shadow.mapSize.height = 2048;
  directionalLight.shadow.camera.near = 0.5;
  directionalLight.shadow.camera.far = 60;
  directionalLight.shadow.camera.left = -30;
  directionalLight.shadow.camera.right = 30;
  directionalLight.shadow.camera.top = 30;
  directionalLight.shadow.camera.bottom = -30;
  scene.add(directionalLight);
  scene.add(directionalLight.target);

  // --- Ground Plane ---
  const planeGeometry = new THREE.PlaneGeometry(ARENA_SIZE, ARENA_SIZE);
  const planeMaterial = new THREE.MeshStandardMaterial({
    color: 0x2d6a4f,
    roughness: 0.8,
    metalness: 0.2,
  });
  const planeMesh = new THREE.Mesh(planeGeometry, planeMaterial);
  planeMesh.rotation.x = -Math.PI / 2;
  planeMesh.receiveShadow = true;
  scene.add(planeMesh);

  // --- Grid Helper ---
  const gridHelper = new THREE.GridHelper(
    ARENA_SIZE,
    ARENA_SIZE / 2,
    0x1b4332,
    0x1b4332,
  );
  gridHelper.position.y = 0.01;
  scene.add(gridHelper);

  // --- Arena Decorations (rocks, dead trees) ---
  const decorGeo = [
    new THREE.DodecahedronGeometry(0.4, 0),
    new THREE.DodecahedronGeometry(0.6, 0),
    new THREE.DodecahedronGeometry(0.3, 0),
  ];
  const decorMat = new THREE.MeshStandardMaterial({
    color: 0x3a3a3a,
    roughness: 0.9,
    metalness: 0.1,
  });
  const treeMat = new THREE.MeshStandardMaterial({
    color: 0x2a1a0a,
    roughness: 0.8,
    metalness: 0.1,
  });

  for (let i = 0; i < 60; i++) {
    const x = (Math.random() - 0.5) * ARENA_SIZE * 0.9;
    const z = (Math.random() - 0.5) * ARENA_SIZE * 0.9;

    if (Math.random() < 0.6) {
      // Rock
      const geo = decorGeo[Math.floor(Math.random() * decorGeo.length)];
      const rock = new THREE.Mesh(geo, decorMat);
      rock.position.set(x, 0.2, z);
      rock.rotation.set(Math.random(), Math.random(), Math.random());
      rock.castShadow = true;
      rock.receiveShadow = true;
      scene.add(rock);
    } else {
      // Dead tree stump
      const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.15, 0.2, 1.2, 6),
        treeMat,
      );
      trunk.position.set(x, 0.6, z);
      trunk.castShadow = true;
      scene.add(trunk);

      // Small branches
      for (let b = 0; b < 2; b++) {
        const branch = new THREE.Mesh(
          new THREE.CylinderGeometry(0.04, 0.06, 0.5, 4),
          treeMat,
        );
        branch.position.set(0, 0.2 + b * 0.3, 0);
        branch.rotation.z = (Math.random() - 0.5) * 1.2;
        trunk.add(branch);
      }
    }
  }

  // --- Ground Collider (Rapier) ---
  const groundColliderDesc = RAPIER.ColliderDesc.cuboid(
    ARENA_HALF,
    0.1,
    ARENA_HALF,
  );
  groundColliderDesc.setTranslation(0, -0.1, 0);
  world.createCollider(groundColliderDesc);

  // --- Arena boundary (subtle wall markers) ---
  const boundaryMat = new THREE.MeshStandardMaterial({
    color: 0x442244,
    transparent: true,
    opacity: 0.4,
    roughness: 0.5,
  });
  const wallHeight = 0.5;
  const walls = [
    {
      pos: [0, wallHeight / 2, -ARENA_HALF],
      scale: [ARENA_SIZE, wallHeight, 0.2],
    },
    {
      pos: [0, wallHeight / 2, ARENA_HALF],
      scale: [ARENA_SIZE, wallHeight, 0.2],
    },
    {
      pos: [-ARENA_HALF, wallHeight / 2, 0],
      scale: [0.2, wallHeight, ARENA_SIZE],
    },
    {
      pos: [ARENA_HALF, wallHeight / 2, 0],
      scale: [0.2, wallHeight, ARENA_SIZE],
    },
  ];
  for (const w of walls) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), boundaryMat);
    mesh.position.set(...w.pos);
    mesh.scale.set(...w.scale);
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  // --- Player point light (follows player) ---
  const playerLight = new THREE.PointLight(0x4488ff, 0.8, 12);
  playerLight.position.set(0, 3, 0);
  scene.add(playerLight);

  // --- Initialize Game Systems ---
  createPlayer(scene, world);
  createEnemyManager(scene, world);
  createProjectileManager(scene, world);
  createWeaponManager();
  createXpManager(scene);
  createWaveDirector();
  createHud();
  createUpgradeMenu();

  // Start with the Magic Wand weapon
  addWeapon("magicWand");

  // --- Handle Window Resize ---
  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // --- Shadow light + player light follows player ---
  function updateLights() {
    directionalLight.position.set(
      player.mesh.position.x + 5,
      15,
      player.mesh.position.z + 7,
    );
    directionalLight.target.position.copy(player.mesh.position);
    directionalLight.target.updateMatrixWorld();

    playerLight.position.set(player.mesh.position.x, 3, player.mesh.position.z);
  }

  // --- Animation Loop ---
  const clock = new THREE.Clock();

  function animate() {
    requestAnimationFrame(animate);

    const delta = Math.min(clock.getDelta(), 0.05); // Cap delta to avoid spiral of death

    if (gameState.paused || gameState.gameOver) {
      renderer.render(scene, camera);
      return;
    }

    gameState.gameTime += delta;

    // Update all systems
    updatePlayer(delta, ARENA_HALF);
    updateCamera(camera, player.mesh, delta);
    updateLights();
    updateWaveDirector(delta, player, scene, world);
    updateEnemies(delta, player);
    updateWeapons(delta, player, enemies);
    updateProjectiles(delta, enemies);
    updateXpGems(delta, player);
    updateParticles(delta);
    updateHud(player, gameState);

    // Step the physics world
    world.step();

    renderer.render(scene, camera);

    // Check game over
    if (!player.alive && !gameState.gameOver) {
      gameState.gameOver = true;
      showGameOver();
    }
  }

  animate();
}

// --- Game Over Screen ---
function showGameOver() {
  const overlay = document.createElement("div");
  overlay.id = "game-over-overlay";
  overlay.innerHTML = `
    <div style="
      position: fixed; inset: 0;
      background: rgba(0,0,0,0.85);
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      z-index: 1000; color: #fff; font-family: 'Segoe UI', sans-serif;
    ">
      <h1 style="font-size: 64px; color: #ff4444; margin-bottom: 20px; text-shadow: 0 0 20px #ff0000;">GAME OVER</h1>
      <div style="font-size: 22px; margin-bottom: 8px;">Time Survived: <strong>${formatTime(gameState.gameTime)}</strong></div>
      <div style="font-size: 22px; margin-bottom: 8px;">Enemies Killed: <strong>${player.kills}</strong></div>
      <div style="font-size: 22px; margin-bottom: 24px;">Level Reached: <strong>${player.level}</strong></div>
      <button id="restart-btn" style="
        padding: 14px 48px; font-size: 22px; cursor: pointer;
        background: #ff4444; border: none; color: #fff; border-radius: 8px;
        font-weight: bold; transition: background 0.2s;
      ">RESTART</button>
    </div>
  `;
  document.body.appendChild(overlay);
  document.getElementById("restart-btn").addEventListener("click", () => {
    location.reload();
  });
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

init();
