// main.js — Entry point, multiplayer orchestration (host-authoritative)

import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { createPlayer, updatePlayer, resetPlayer } from "./player.js";
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
  updateWeaponVisuals,
  resetWeapons,
  resetAllWeaponVisuals,
  addWeapon,
} from "./weaponManager.js";
import {
  updateProjectiles,
  resetProjectiles,
  createProjectileManager,
  getActiveProjectiles,
} from "./projectiles.js";
import {
  createXpManager,
  updateXpGems,
  resetXpGems,
  setLevelUpCallback,
  getActiveGems,
} from "./xpManager.js";
import { createHud, updateHud } from "./hud.js";
import {
  createUpgradeMenu,
  generateUpgradeChoices,
  showUpgradeMenuUI,
  applyUpgradeChoice,
  hideUpgradeMenu,
  isUpgradeMenuOpen,
} from "./upgradeMenu.js";
import { updateParticles } from "./particles.js";
import { getMovementVector } from "./input.js";
import { connect, send, onMessage, isHost, isGuest } from "./network.js";
import {
  createEnemyModel,
  flashGroup,
  unflashGroup,
  animateEnemyModel,
} from "./models.js";

// ---------- Game State ----------
export const gameState = {
  paused: false,
  gameOver: false,
  gameTime: 0, // seconds elapsed
  totalKills: 0, // shared kill counter
  scene: null,
  world: null,
  camera: null,
  renderer: null,
  role: null, // 'host' or 'guest'
};

const ARENA_SIZE = 100;
const ARENA_HALF = ARENA_SIZE / 2;
const PLAYER_SIZE = 0.5;
const STATE_SEND_INTERVAL = 1; // Send state every frame (60 Hz at 60fps)

// Player references (set during init)
let player1 = null;
let player2 = null;

// Host-side: latest input from the guest player
let _remoteInput = { x: 0, z: 0 };
let _guestConnected = false;
let _sendFrameCounter = 0;
let _pendingP2Choices = null; // upgrade choices waiting for guest pick

// Guest-side: latest state from the host
let _currentHostState = null; // Most recent state from host
let _previousHostState = null; // Previous state for interpolation
let _currentStateTime = 0; // When current state was received
let _previousStateTime = 0; // When previous state was received
let _guestLocalTime = 0; // Local time for smooth animations
const INTERPOLATION_DELAY = 0.01; // Small delay for interpolation (10ms) - reduced for localhost
const _guestEnemyMap = new Map(); // id -> { mesh, anim, typeKey, size, prevPos }
const _guestProjectiles = []; // array of THREE.Mesh
const _guestGems = []; // array of THREE.Mesh

// ---------- Initialization ----------

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
      const geo = decorGeo[Math.floor(Math.random() * decorGeo.length)];
      const rock = new THREE.Mesh(geo, decorMat);
      rock.position.set(x, 0.2, z);
      rock.rotation.set(Math.random(), Math.random(), Math.random());
      rock.castShadow = true;
      rock.receiveShadow = true;
      scene.add(rock);
    } else {
      const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.15, 0.2, 1.2, 6),
        treeMat,
      );
      trunk.position.set(x, 0.6, z);
      trunk.castShadow = true;
      scene.add(trunk);

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

  // --- Player point light ---
  const playerLight = new THREE.PointLight(0x4488ff, 0.8, 12);
  playerLight.position.set(0, 3, 0);
  scene.add(playerLight);

  // --- Hide loading screen, show lobby ---
  _hideLoadingScreen();
  const role = await _showLobby();
  gameState.role = role;

  // --- Wait for both players ---
  if (isHost()) {
    _setLobbyStatus("Waiting for Player 2 to join...");
    await _waitForGuest();
    _setLobbyStatus("Player 2 connected! Starting game...");
    await _delay(500);
  } else {
    _setLobbyStatus("Connected as Guest! Waiting for host to start...");
    await _waitForGameStart();
  }

  // --- Hide lobby ---
  _hideLobby();

  // --- Create both players ---
  player1 = createPlayer(scene, world, {
    spawnX: -2,
    spawnZ: 0,
    colorTheme: "blue",
  });
  player2 = createPlayer(scene, world, {
    spawnX: 2,
    spawnZ: 0,
    colorTheme: "red",
  });

  // --- Initialize game systems (host only for simulation, both for rendering) ---
  if (isHost()) {
    createEnemyManager(scene, world);
    createProjectileManager(scene, world);
    createWeaponManager();
    createXpManager(scene);
    createWaveDirector();

    // Both players start with Magic Wand
    addWeapon(player1, "magicWand");
    addWeapon(player2, "magicWand");

    // Set up level-up callback
    setLevelUpCallback(_onPlayerLevelUp);
  }

  // Both host and guest need HUD and upgrade menu
  createHud();
  createUpgradeMenu();

  // --- Setup network message handlers ---
  _setupNetworkHandlers();

  // --- Host signals game start ---
  if (isHost()) {
    send({ type: "game_start" });
  }

  // --- Handle Window Resize ---
  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // --- Shadow light + player light follows local player ---
  function updateLights() {
    const localPlayer = isHost() ? player1 : player2;
    if (!localPlayer || !localPlayer.mesh) return;
    directionalLight.position.set(
      localPlayer.mesh.position.x + 5,
      15,
      localPlayer.mesh.position.z + 7,
    );
    directionalLight.target.position.copy(localPlayer.mesh.position);
    directionalLight.target.updateMatrixWorld();
    playerLight.position.set(
      localPlayer.mesh.position.x,
      3,
      localPlayer.mesh.position.z,
    );
  }

  // --- Fade out controls hint ---
  setTimeout(() => {
    const hint = document.getElementById("controls-hint");
    if (hint) hint.style.opacity = "0";
  }, 8000);

  // --- Start game loop ---
  const clock = new THREE.Clock();

  if (isHost()) {
    _animateHost(clock, scene, camera, renderer, world, updateLights);
  } else {
    _animateGuest(clock, scene, camera, renderer, updateLights);
  }
}

// ---------- Host Game Loop ----------

function _animateHost(clock, scene, camera, renderer, world, updateLights) {
  // Use performance.now() for manual timing so we don't depend on THREE.Clock
  // across setTimeout ticks (THREE.Clock works, but explicit timing is clearer).
  let _lastTime = performance.now();

  function loop() {
    // IMPORTANT: Use setTimeout instead of requestAnimationFrame.
    // RAF is paused entirely when a tab is in the background, which would
    // freeze the host simulation and stop state updates to the guest.
    // setTimeout is throttled to ~1 s in background tabs but still fires.
    // Reduced delay for higher update frequency: 8ms = ~120fps, 4ms = ~250fps
    setTimeout(loop, 8); // Increased from 16ms to 8ms for ~120 Hz updates

    const now = performance.now();
    const rawDelta = (now - _lastTime) / 1000;
    _lastTime = now;

    // Allow a bigger time step when the tab is hidden so the simulation can
    // partially catch up (background setTimeout fires only ~once per second).
    const delta = Math.min(rawDelta, document.hidden ? 0.1 : 0.05);

    if (gameState.paused || gameState.gameOver) {
      if (!document.hidden) renderer.render(scene, camera);
      return;
    }

    gameState.gameTime += delta;

    // --- Get inputs ---
    const localInput = getMovementVector(); // Player 1 (host)
    const remoteInput = _remoteInput; // Player 2 (guest)

    // --- Update players ---
    updatePlayer(player1, delta, ARENA_HALF, localInput);
    updatePlayer(player2, delta, ARENA_HALF, remoteInput);

    // --- Camera follows player 1 (host's player) ---
    if (!document.hidden) {
      updateCamera(camera, player1.mesh, delta);
      updateLights();
    }

    // --- Game systems ---
    const allPlayers = [player1, player2];

    updateWaveDirector(delta, allPlayers);
    updateEnemies(delta, allPlayers);
    updateWeapons(delta, player1, enemies);
    updateWeapons(delta, player2, enemies);
    updateWeaponVisuals(delta, enemies);
    updateProjectiles(delta, enemies);
    updateXpGems(delta, allPlayers);
    updateParticles(delta);

    if (!document.hidden) {
      updateHud(player1, player1, player2, gameState);
    }

    // Step the physics world
    world.step();

    // Only render when the tab is visible (save GPU while in background)
    if (!document.hidden) {
      renderer.render(scene, camera);
    }

    // --- Send state to guest (always, even when hidden) ---
    _sendFrameCounter++;
    if (_sendFrameCounter % STATE_SEND_INTERVAL === 0) {
      _sendGameState();
    }

    // --- Check game over (both players dead) ---
    if (!player1.alive && !player2.alive && !gameState.gameOver) {
      gameState.gameOver = true;
      _showGameOver();
      send({ type: "game_over" });
    }
  }

  loop();
}

// ---------- Guest Game Loop ----------

function _animateGuest(clock, scene, camera, renderer, updateLights) {
  let _inputSendCounter = 0;
  const INPUT_SEND_INTERVAL = 1; // Send input every frame for responsiveness

  function loop() {
    requestAnimationFrame(loop);

    const delta = Math.min(clock.getDelta(), 0.05);
    _guestLocalTime += delta;
    const now = performance.now();

    // --- Send local input to host (throttled) ---
    _inputSendCounter++;
    if (_inputSendCounter % INPUT_SEND_INTERVAL === 0) {
      const localInput = getMovementVector();
      send({ type: "input", mx: localInput.x, mz: localInput.z });
    }

    // --- Handle new state from host ---
    // (State is stored in _handleGuestMessage, we just process it here)

    // --- Apply state updates (fallback if state arrived between frames) ---
    // States are applied immediately when received, but we also check here
    // in case a state arrived but wasn't applied yet
    if (_currentHostState && !_previousHostState) {
      // First state, make sure it's applied
      _applyHostState(_currentHostState, scene, 1.0);
      _previousHostState = _deepCloneState(_currentHostState);
      _previousStateTime = _currentStateTime;
    }

    // --- Continuously animate enemies (smooth animation between state updates) ---
    _animateGuestEnemies(_guestLocalTime);

    // --- Continuously animate gems (rotation) ---
    _animateGuestGems(delta);

    // --- Camera follows player 2 (guest's player) ---
    updateCamera(camera, player2.mesh, delta);
    updateLights();

    // --- Update HUD ---
    updateHud(player2, player1, player2, gameState);

    renderer.render(scene, camera);
  }

  loop();
}

// ---------- State Serialization (Host -> Guest) ----------

function _sendGameState() {
  const state = {
    type: "state",
    gt: gameState.gameTime,
    tk: gameState.totalKills,
    go: gameState.gameOver,
    pa: gameState.paused,
    p1: _serializePlayer(player1),
    p2: _serializePlayer(player2),
    en: enemies.map((e) => ({
      id: e.id,
      x: e.mesh.position.x,
      z: e.mesh.position.z,
      y: e.mesh.position.y,
      tk: e.typeKey,
      tn: e.type,
      sz: e.size,
      hp: e.hp,
      mhp: e.maxHp,
      ry: e.mesh.rotation.y,
      fl: e.flashTimer,
    })),
    pr: getActiveProjectiles().map((p) => ({
      x: p.mesh.position.x,
      z: p.mesh.position.z,
    })),
    gm: getActiveGems().map((g) => ({
      x: g.mesh.position.x,
      y: g.mesh.position.y,
      z: g.mesh.position.z,
    })),
  };
  send(state);
}

function _serializePlayer(p) {
  return {
    x: p.mesh.position.x,
    z: p.mesh.position.z,
    fa: p.facingAngle,
    hp: p.hp,
    mhp: p.maxHp,
    xp: p.xp,
    lv: p.level,
    al: p.alive,
    inv: p.invincibilityTimer > 0,
  };
}

// ---------- State Cloning (for interpolation) ----------

function _deepCloneState(state) {
  // Deep clone the state object to prevent reference issues
  // Using JSON parse/stringify for simplicity and correctness
  // This is fast enough for localhost with ~60 updates/sec
  return JSON.parse(JSON.stringify(state));
}

// ---------- State Deserialization (Guest receives Host state) ----------

function _applyHostState(state, scene, interpolationFactor) {
  // Update game state (non-interpolated values)
  gameState.gameTime = state.gt;
  gameState.totalKills = state.tk;
  gameState.gameOver = state.go;

  // Update player states
  _applyPlayerState(player1, state.p1, interpolationFactor);
  _applyPlayerState(player2, state.p2, interpolationFactor);

  // Sync enemy meshes
  _syncGuestEnemies(state.en, scene, interpolationFactor);

  // Sync projectile meshes
  _syncGuestProjectiles(state.pr, scene, interpolationFactor);

  // Sync gem meshes
  _syncGuestGems(state.gm, scene, interpolationFactor);

  // Check game over
  if (state.go && !gameState.gameOver) {
    gameState.gameOver = true;
    _showGameOver();
  }
}

// Interpolate between two states
function _interpolateHostState(prevState, currState, scene, t) {
  // Update game state (non-interpolated, use current state)
  gameState.gameTime = currState.gt;
  gameState.totalKills = currState.tk;
  gameState.gameOver = currState.go;

  // Interpolate player states between previous and current
  _interpolatePlayerState(player1, prevState.p1, currState.p1, t);
  _interpolatePlayerState(player2, prevState.p2, currState.p2, t);

  // Interpolate enemy positions
  _interpolateGuestEnemies(prevState.en, currState.en, scene, t);

  // Interpolate projectile positions
  _interpolateGuestProjectiles(prevState.pr, currState.pr, scene, t);

  // Interpolate gem positions
  _interpolateGuestGems(prevState.gm, currState.gm, scene, t);
}

function _applyPlayerState(playerObj, s, interpolationFactor) {
  // Apply state directly (interpolation happens separately in _interpolatePlayerState)
  playerObj.mesh.position.x = s.x;
  playerObj.mesh.position.z = s.z;
  playerObj.mesh.position.y = PLAYER_SIZE * 0.9;
  playerObj.mesh.rotation.y = s.fa;
  playerObj.facingAngle = s.fa;
  playerObj.hp = s.hp;
  playerObj.maxHp = s.mhp;
  playerObj.xp = s.xp;
  playerObj.level = s.lv;
  playerObj.alive = s.al;

  // Handle visibility (alive, invincibility flash, dead)
  if (!s.al) {
    playerObj.mesh.visible = true; // Show dead player body
  } else if (s.inv) {
    // Flash using time-based toggle
    playerObj.mesh.visible = Math.floor(performance.now() / 100) % 2 === 0;
  } else {
    playerObj.mesh.visible = true;
  }
}

function _interpolatePlayerState(playerObj, prevS, currS, t) {
  // Interpolate position between previous and current state
  playerObj.mesh.position.x = prevS.x + (currS.x - prevS.x) * t;
  playerObj.mesh.position.z = prevS.z + (currS.z - prevS.z) * t;

  // Interpolate rotation (handle wrap-around)
  let rotDiff = currS.fa - prevS.fa;
  if (rotDiff > Math.PI) rotDiff -= Math.PI * 2;
  if (rotDiff < -Math.PI) rotDiff += Math.PI * 2;
  playerObj.mesh.rotation.y = prevS.fa + rotDiff * t;

  playerObj.mesh.position.y = PLAYER_SIZE * 0.9;
  playerObj.facingAngle = currS.fa; // Use current state for non-interpolated values
  playerObj.hp = currS.hp;
  playerObj.maxHp = currS.mhp;
  playerObj.xp = currS.xp;
  playerObj.level = currS.lv;
  playerObj.alive = currS.al;

  // Handle visibility
  if (!currS.al) {
    playerObj.mesh.visible = true;
  } else if (currS.inv) {
    playerObj.mesh.visible = Math.floor(performance.now() / 100) % 2 === 0;
  } else {
    playerObj.mesh.visible = true;
  }
}

function _syncGuestEnemies(enemyStates, scene, interpolationFactor) {
  const activeIds = new Set();

  for (const es of enemyStates) {
    activeIds.add(es.id);

    let entry = _guestEnemyMap.get(es.id);
    if (!entry) {
      // Create new enemy visual
      const { group, anim } = createEnemyModel(es.tk, es.sz);
      scene.add(group);
      entry = {
        mesh: group,
        anim,
        typeKey: es.tk,
        typeName: es.tn,
        size: es.sz,
        animOffset: Math.random() * 100,
      };
      _guestEnemyMap.set(es.id, entry);
    }

    // Apply position directly (interpolation happens separately in _interpolateGuestEnemies)
    entry.mesh.position.set(es.x, es.y, es.z);
    entry.mesh.rotation.y = es.ry;
    entry.mesh.visible = true;

    // Flash effect
    if (es.fl > 0) {
      flashGroup(entry.mesh);
    } else {
      unflashGroup(entry.mesh);
    }
  }

  // Remove enemies that no longer exist
  for (const [id, entry] of _guestEnemyMap) {
    if (!activeIds.has(id)) {
      entry.mesh.visible = false;
      scene.remove(entry.mesh);
      _guestEnemyMap.delete(id);
    }
  }
}

function _interpolateGuestEnemies(prevEnemyStates, currEnemyStates, scene, t) {
  const activeIds = new Set();
  const prevEnemyMap = new Map();

  // Build map of previous enemy states
  for (const es of prevEnemyStates) {
    prevEnemyMap.set(es.id, es);
  }

  for (const es of currEnemyStates) {
    activeIds.add(es.id);
    const entry = _guestEnemyMap.get(es.id);
    if (!entry) continue;

    const prevEs = prevEnemyMap.get(es.id);
    if (!prevEs) {
      // New enemy, use current position
      entry.mesh.position.set(es.x, es.y, es.z);
      entry.mesh.rotation.y = es.ry;
    } else {
      // Interpolate position between previous and current
      entry.mesh.position.x = prevEs.x + (es.x - prevEs.x) * t;
      entry.mesh.position.y = prevEs.y + (es.y - prevEs.y) * t;
      entry.mesh.position.z = prevEs.z + (es.z - prevEs.z) * t;

      // Interpolate rotation
      let rotDiff = es.ry - prevEs.ry;
      if (rotDiff > Math.PI) rotDiff -= Math.PI * 2;
      if (rotDiff < -Math.PI) rotDiff += Math.PI * 2;
      entry.mesh.rotation.y = prevEs.ry + rotDiff * t;
    }

    entry.mesh.visible = true;

    // Flash effect (use current state)
    if (es.fl > 0) {
      flashGroup(entry.mesh);
    } else {
      unflashGroup(entry.mesh);
    }
  }

  // Hide enemies that no longer exist
  for (const [id, entry] of _guestEnemyMap) {
    if (!activeIds.has(id)) {
      entry.mesh.visible = false;
    }
  }
}

// Continuously animate guest enemies (called every frame)
function _animateGuestEnemies(localTime) {
  for (const [id, entry] of _guestEnemyMap) {
    if (entry.mesh.visible) {
      animateEnemyModel(
        entry.typeName,
        entry.anim,
        localTime + entry.animOffset,
      );
    }
  }
}

function _syncGuestProjectiles(projStates, scene, interpolationFactor) {
  // Grow pool if needed
  while (_guestProjectiles.length < projStates.length) {
    const geo = new THREE.SphereGeometry(0.15, 6, 6);
    const mat = new THREE.MeshBasicMaterial({ color: 0x44ccff });
    const mesh = new THREE.Mesh(geo, mat);
    scene.add(mesh);
    _guestProjectiles.push(mesh);
  }

  // Apply positions directly (interpolation happens separately)
  for (let i = 0; i < projStates.length; i++) {
    _guestProjectiles[i].position.set(projStates[i].x, 0.8, projStates[i].z);
    _guestProjectiles[i].visible = true;
  }

  // Hide extra
  for (let i = projStates.length; i < _guestProjectiles.length; i++) {
    _guestProjectiles[i].visible = false;
  }
}

function _interpolateGuestProjectiles(
  prevProjStates,
  currProjStates,
  scene,
  t,
) {
  const maxLen = Math.min(currProjStates.length, _guestProjectiles.length);
  for (let i = 0; i < maxLen; i++) {
    const proj = _guestProjectiles[i];
    const prevP = i < prevProjStates.length ? prevProjStates[i] : null;
    const currP = currProjStates[i];

    if (!prevP) {
      // New projectile, use current position
      proj.position.set(currP.x, 0.8, currP.z);
    } else {
      // Interpolate between previous and current
      proj.position.x = prevP.x + (currP.x - prevP.x) * t;
      proj.position.z = prevP.z + (currP.z - prevP.z) * t;
      proj.position.y = 0.8;
    }
  }
}

function _syncGuestGems(gemStates, scene, interpolationFactor) {
  // Grow pool if needed
  while (_guestGems.length < gemStates.length) {
    const geo = new THREE.OctahedronGeometry(0.15, 0);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x44aaff,
      emissive: 0x44aaff,
      emissiveIntensity: 0.5,
      roughness: 0.3,
      metalness: 0.8,
    });
    const mesh = new THREE.Mesh(geo, mat);
    scene.add(mesh);
    _guestGems.push(mesh);
  }

  // Apply positions directly (interpolation happens separately)
  for (let i = 0; i < gemStates.length; i++) {
    const g = gemStates[i];
    _guestGems[i].position.set(g.x, g.y, g.z);
    _guestGems[i].visible = true;
  }

  // Hide extra
  for (let i = gemStates.length; i < _guestGems.length; i++) {
    _guestGems[i].visible = false;
  }
}

function _interpolateGuestGems(prevGemStates, currGemStates, scene, t) {
  const maxLen = Math.min(currGemStates.length, _guestGems.length);
  for (let i = 0; i < maxLen; i++) {
    const gem = _guestGems[i];
    const prevG = i < prevGemStates.length ? prevGemStates[i] : null;
    const currG = currGemStates[i];

    if (!prevG) {
      // New gem, use current position
      gem.position.set(currG.x, currG.y, currG.z);
    } else {
      // Interpolate between previous and current
      gem.position.x = prevG.x + (currG.x - prevG.x) * t;
      gem.position.y = prevG.y + (currG.y - prevG.y) * t;
      gem.position.z = prevG.z + (currG.z - prevG.z) * t;
    }
  }
}

// Continuously animate guest gems (called every frame)
function _animateGuestGems(delta) {
  for (const gem of _guestGems) {
    if (gem.visible) {
      gem.rotation.y += delta * 2; // Smooth rotation
    }
  }
}

// ---------- Network Message Handlers ----------

function _setupNetworkHandlers() {
  onMessage((msg) => {
    if (isHost()) {
      _handleHostMessage(msg);
    } else {
      _handleGuestMessage(msg);
    }
  });
}

function _handleHostMessage(msg) {
  switch (msg.type) {
    case "input":
      // Guest sends their movement input
      _remoteInput.x = msg.mx || 0;
      _remoteInput.z = msg.mz || 0;
      break;

    case "upgrade_pick":
      // Guest picked an upgrade for player 2
      if (
        _pendingP2Choices &&
        msg.index >= 0 &&
        msg.index < _pendingP2Choices.length
      ) {
        applyUpgradeChoice(_pendingP2Choices[msg.index], player2);
        _pendingP2Choices = null;
        gameState.paused = false;
        send({ type: "upgrade_done" });
      }
      break;
  }
}

function _handleGuestMessage(msg) {
  switch (msg.type) {
    case "state":
      // Store state and apply immediately for responsiveness
      const now = performance.now();
      if (_currentHostState) {
        _previousHostState = _deepCloneState(_currentHostState);
        _previousStateTime = _currentStateTime;
      }
      _currentHostState = _deepCloneState(msg);
      _currentStateTime = now;

      // Apply state immediately when received (don't wait for next frame)
      // This reduces perceived lag
      if (gameState.scene) {
        _applyHostState(_currentHostState, gameState.scene, 1.0);
      }
      break;

    case "upgrade_show":
      // Host says player 2 leveled up, show choices
      gameState.paused = true;
      showUpgradeMenuUI(msg.choices, "Player 2", (index) => {
        send({ type: "upgrade_pick", index });
        hideUpgradeMenu();
      });
      break;

    case "upgrade_done":
      // Host confirmed the upgrade was applied
      hideUpgradeMenu();
      break;

    case "game_over":
      gameState.gameOver = true;
      _showGameOver();
      break;
  }
}

// ---------- Level-Up Callback (Host Only) ----------

function _onPlayerLevelUp(playerObj) {
  if (playerObj === player1) {
    // Host's own player leveled up — show menu locally
    const choices = generateUpgradeChoices(playerObj);
    showUpgradeMenuUI(choices, "Player 1", (index) => {
      applyUpgradeChoice(choices[index], player1);
      hideUpgradeMenu();
    });
  } else if (playerObj === player2) {
    // Guest's player leveled up — send choices to guest
    const choices = generateUpgradeChoices(playerObj);
    _pendingP2Choices = choices;

    // Send serializable choices to guest
    send({
      type: "upgrade_show",
      choices: choices.map((c) => ({
        type: c.type,
        id: c.id,
        name: c.name,
        description: c.description,
      })),
    });

    gameState.paused = true;
  }
}

// ---------- Lobby UI ----------

function _hideLoadingScreen() {
  const ls = document.getElementById("loading-screen");
  if (ls) {
    ls.style.opacity = "0";
    setTimeout(() => ls.remove(), 500);
  }
}

let _lobbyOverlay = null;
let _lobbyStatusEl = null;

function _showLobby() {
  return new Promise((resolve) => {
    _lobbyOverlay = document.createElement("div");
    _lobbyOverlay.id = "lobby-overlay";
    _lobbyOverlay.style.cssText = `
      position: fixed; inset: 0;
      background: #1a1a2e;
      display: flex; flex-direction: column;
      align-items: center; justify-content: center;
      z-index: 2000;
      font-family: 'Segoe UI', Tahoma, sans-serif;
    `;

    _lobbyOverlay.innerHTML = `
      <h1 style="font-size: 48px; color: #ff4444; text-shadow: 0 0 30px #ff000088; margin-bottom: 10px; letter-spacing: 3px;">
        VAMPIRE SURVIVOR
      </h1>
      <h2 style="font-size: 24px; color: #ffcc00; margin-bottom: 30px; text-shadow: 0 0 10px #ffcc0066;">
        MULTIPLAYER
      </h2>
      <div id="lobby-buttons" style="display: flex; gap: 20px; margin-bottom: 24px;">
        <button id="host-btn" style="
          padding: 16px 40px; font-size: 20px; cursor: pointer;
          background: #4488ff; border: none; color: #fff; border-radius: 8px;
          font-weight: bold; transition: background 0.2s; font-family: inherit;
        ">HOST GAME</button>
        <button id="join-btn" style="
          padding: 16px 40px; font-size: 20px; cursor: pointer;
          background: #ff4444; border: none; color: #fff; border-radius: 8px;
          font-weight: bold; transition: background 0.2s; font-family: inherit;
        ">JOIN GAME</button>
      </div>
      <div id="ip-input-area" style="display: none; margin-bottom: 24px; text-align: center;">
        <label style="color: #aaa; font-size: 14px; display: block; margin-bottom: 8px;">
          Enter host's IP address:
        </label>
        <div style="display: flex; gap: 10px; align-items: center; justify-content: center;">
          <input id="ip-input" type="text" placeholder="e.g. 192.168.1.100" value="" style="
            padding: 12px 16px; font-size: 18px; width: 260px;
            background: #2a2a3e; border: 2px solid #555; color: #fff; border-radius: 8px;
            font-family: 'Courier New', monospace; text-align: center; outline: none;
            transition: border-color 0.2s;
          " />
          <button id="connect-btn" style="
            padding: 12px 28px; font-size: 18px; cursor: pointer;
            background: #ff4444; border: none; color: #fff; border-radius: 8px;
            font-weight: bold; transition: background 0.2s; font-family: inherit;
          ">CONNECT</button>
        </div>
      </div>
      <p id="lobby-status" style="color: #888; font-size: 16px; min-height: 24px;"></p>
      <p style="color: #555; font-size: 13px; margin-top: 20px;">
        Run <code style="background: #333; padding: 2px 6px; border-radius: 4px; color: #aaa;">npm run server</code>
        in a terminal first
      </p>
    `;

    document.body.appendChild(_lobbyOverlay);
    _lobbyStatusEl = _lobbyOverlay.querySelector("#lobby-status");

    const hostBtn = _lobbyOverlay.querySelector("#host-btn");
    const joinBtn = _lobbyOverlay.querySelector("#join-btn");
    const ipInputArea = _lobbyOverlay.querySelector("#ip-input-area");
    const ipInput = _lobbyOverlay.querySelector("#ip-input");
    const connectBtn = _lobbyOverlay.querySelector("#connect-btn");

    hostBtn.addEventListener("mouseenter", () => {
      hostBtn.style.background = "#5599ff";
    });
    hostBtn.addEventListener("mouseleave", () => {
      hostBtn.style.background = "#4488ff";
    });
    joinBtn.addEventListener("mouseenter", () => {
      joinBtn.style.background = "#ff5555";
    });
    joinBtn.addEventListener("mouseleave", () => {
      joinBtn.style.background = "#ff4444";
    });
    connectBtn.addEventListener("mouseenter", () => {
      connectBtn.style.background = "#ff5555";
    });
    connectBtn.addEventListener("mouseleave", () => {
      connectBtn.style.background = "#ff4444";
    });
    ipInput.addEventListener("focus", () => {
      ipInput.style.borderColor = "#ff4444";
    });
    ipInput.addEventListener("blur", () => {
      ipInput.style.borderColor = "#555";
    });

    // Helper to attempt connection with a given IP
    const doConnect = async (hostIp) => {
      hostBtn.disabled = true;
      joinBtn.disabled = true;
      hostBtn.style.opacity = "0.5";
      joinBtn.style.opacity = "0.5";
      connectBtn.disabled = true;
      connectBtn.style.opacity = "0.5";
      ipInput.disabled = true;
      _setLobbyStatus(`Connecting to ${hostIp || "localhost"}...`);

      try {
        const role = await connect(hostIp || undefined);
        _setLobbyStatus(
          role === "host"
            ? "Connected as Host (Player 1)"
            : "Connected as Guest (Player 2)",
        );
        // Hide buttons and IP input
        const btns = _lobbyOverlay.querySelector("#lobby-buttons");
        if (btns) btns.style.display = "none";
        ipInputArea.style.display = "none";
        resolve(role);
      } catch (err) {
        _setLobbyStatus(
          "Failed to connect. Make sure the server is running on the host.",
        );
        hostBtn.disabled = false;
        joinBtn.disabled = false;
        hostBtn.style.opacity = "1";
        joinBtn.style.opacity = "1";
        connectBtn.disabled = false;
        connectBtn.style.opacity = "1";
        ipInput.disabled = false;
      }
    };

    // HOST: connect to localhost (this machine is the server)
    hostBtn.addEventListener("click", () => doConnect(null));

    // JOIN: show IP input field
    joinBtn.addEventListener("click", () => {
      ipInputArea.style.display = "block";
      ipInput.focus();
      _setLobbyStatus("Enter the host's IP address and press CONNECT.");
    });

    // CONNECT button (in IP input area)
    connectBtn.addEventListener("click", () => {
      const ip = ipInput.value.trim();
      if (!ip) {
        _setLobbyStatus("Please enter an IP address.");
        ipInput.focus();
        return;
      }
      doConnect(ip);
    });

    // Also allow pressing Enter in the IP input
    ipInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        connectBtn.click();
      }
    });
  });
}

function _setLobbyStatus(text) {
  if (_lobbyStatusEl) {
    _lobbyStatusEl.textContent = text;
  }
}

function _hideLobby() {
  if (_lobbyOverlay) {
    _lobbyOverlay.style.opacity = "0";
    _lobbyOverlay.style.transition = "opacity 0.5s";
    setTimeout(() => {
      if (_lobbyOverlay && _lobbyOverlay.parentNode) {
        _lobbyOverlay.remove();
      }
    }, 500);
  }
}

function _waitForGuest() {
  return new Promise((resolve) => {
    // Check if guest already joined
    if (_guestConnected) {
      resolve();
      return;
    }
    const handler = (msg) => {
      if (msg.type === "guest_join") {
        _guestConnected = true;
        resolve();
      }
    };
    onMessage(handler);
  });
}

function _waitForGameStart() {
  return new Promise((resolve) => {
    const handler = (msg) => {
      if (msg.type === "game_start") {
        resolve();
      }
    };
    onMessage(handler);
  });
}

function _delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------- Game Over Screen ----------

function _showGameOver() {
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
      <div style="font-size: 22px; margin-bottom: 8px;">Time Survived: <strong>${_formatTime(gameState.gameTime)}</strong></div>
      <div style="font-size: 22px; margin-bottom: 8px;">Enemies Killed: <strong>${gameState.totalKills}</strong></div>
      <div style="font-size: 22px; margin-bottom: 8px;">P1 Level: <strong>${player1 ? player1.level : "?"}</strong> | P2 Level: <strong>${player2 ? player2.level : "?"}</strong></div>
      <button id="restart-btn" style="
        padding: 14px 48px; font-size: 22px; cursor: pointer;
        background: #ff4444; border: none; color: #fff; border-radius: 8px;
        font-weight: bold; transition: background 0.2s; margin-top: 16px;
      ">RESTART</button>
    </div>
  `;
  document.body.appendChild(overlay);
  document.getElementById("restart-btn").addEventListener("click", () => {
    location.reload();
  });
}

function _formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

// ---------- Start ----------

init();
