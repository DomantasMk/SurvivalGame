// main.js — Entry point, multiplayer orchestration (host-authoritative, up to 5 players)

import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { createPlayer, updatePlayer, resetPlayer } from "./player.js";
import { updateCamera, resetCamera } from "./camera.js";
import {
  createEnemyManager,
  updateEnemies,
  updateEnemyProjectiles,
  resetEnemies,
  enemies,
  getActiveBoss,
  createBossIndicatorMesh,
  BOSS_ATTACK_CONFIG,
  getActiveEnemyProjectiles,
} from "./enemyManager.js";
import {
  createWaveDirector,
  updateWaveDirector,
  resetWaveDirector,
  getCurrentWave,
  onBossWave,
} from "./waveDirector.js";
import {
  createWeaponManager,
  updateWeapons,
  updateWeaponVisuals,
  resetWeapons,
  resetAllWeaponVisuals,
  addWeapon,
  getActiveVisualStates,
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
import { getMovementVector, consumeKeyPress } from "./input.js";
import {
  connect,
  send,
  onMessage,
  isHost,
  isGuest,
  getPlayerIndex,
} from "./network.js";
import { createSeededRandom } from "./utils.js";
import {
  createEnemyModel,
  flashGroup,
  unflashGroup,
  animateEnemyModel,
} from "./models.js";
import {
  createChestManager,
  updateChests,
  updateBuffVisuals,
  getActiveChests,
  createChestMesh,
  BUFF_INFO,
} from "./chestManager.js";

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
  currentWave: 0,
  bossActive: false,
  bossHp: 0,
  bossMaxHp: 0,
};

const ARENA_SIZE = 100;
const ARENA_HALF = ARENA_SIZE / 2;
const PLAYER_SIZE = 0.5;
const STATE_SEND_INTERVAL = 3; // Send state every 3rd frame (~20 Hz at 60fps, interpolation handles smoothness)

// Player configuration (up to 5)
const COLOR_THEMES = ["blue", "red", "green", "purple", "orange"];
const PLAYER_HEX_COLORS = [
  "#4488ff",
  "#ff4444",
  "#44cc44",
  "#aa44ff",
  "#ff8800",
];

// Dynamic player array (set during init, ordered by _gamePlayerIndices)
const players = [];
let _gamePlayerIndices = []; // frozen when game starts
let _myPlayerArrayIndex = 0; // this client's index in players[]

// Host-side: latest inputs from guest players (keyed by playerIndex)
const _remoteInputs = {};
let _sendFrameCounter = 0;
const _pendingUpgradeChoices = {}; // keyed by playerIndex

// Lobby state
let _lobbyPlayerIndices = [];

// Spectator mode (when local player is dead, camera follows other alive players)
let _spectatingIndex = -1;
let _spectatorHudEl = null;

// Guest-side: latest state from the host (buffered for smooth interpolation)
let _currentHostState = null;
let _previousHostState = null;
let _currentStateTime = 0;
let _previousStateTime = 0;
let _guestLocalTime = 0;
let _guestStateDirty = false; // true when a new state arrived but hasn't been blended yet
const INTERPOLATION_DELAY = 0.01;
const _guestEnemyMap = new Map();
const _guestProjectileMap = new Map();
const _guestEnemyProjectileMap = new Map();
const _guestGemMap = new Map();
const _guestWeaponVisualMap = new Map();
const _guestChestMap = new Map();

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
  directionalLight.shadow.mapSize.width = 1024;
  directionalLight.shadow.mapSize.height = 1024;
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

  // --- Lobby waiting phase (player list + start/wait) ---
  let worldSeed;
  let gamePlayerIndices;

  if (isHost()) {
    const result = await _showLobbyWaitingHost();
    worldSeed = result.seed;
    gamePlayerIndices = result.playerIndices;
  } else {
    const result = await _showLobbyWaitingGuest();
    worldSeed = result.seed;
    gamePlayerIndices = result.playerIndices;
  }

  _gamePlayerIndices = gamePlayerIndices;
  _myPlayerArrayIndex = _gamePlayerIndices.indexOf(getPlayerIndex());
  if (_myPlayerArrayIndex < 0) _myPlayerArrayIndex = 0;

  // --- Generate arena decorations using shared seed ---
  _generateDecorations(scene, worldSeed);

  // --- Hide lobby ---
  _hideLobby();

  // --- Create players in a circle ---
  const numPlayers = _gamePlayerIndices.length;
  const spawnRadius = numPlayers === 1 ? 0 : 3;
  for (let i = 0; i < numPlayers; i++) {
    const angle = (i / numPlayers) * Math.PI * 2 - Math.PI / 2;
    const spawnX = numPlayers === 1 ? 0 : Math.cos(angle) * spawnRadius;
    const spawnZ = numPlayers === 1 ? 0 : Math.sin(angle) * spawnRadius;
    const colorTheme = COLOR_THEMES[i % COLOR_THEMES.length];
    const p = createPlayer(scene, world, { spawnX, spawnZ, colorTheme });
    players.push(p);
  }

  // Initialize remote inputs for each guest player
  for (const pi of _gamePlayerIndices) {
    if (pi !== getPlayerIndex()) {
      _remoteInputs[pi] = { x: 0, z: 0 };
    }
  }

  // --- Initialize game systems (host only for simulation, both for rendering) ---
  if (isHost()) {
    createEnemyManager(scene, world);
    createProjectileManager(scene, world);
    createWeaponManager();
    createXpManager(scene);
    createWaveDirector();
    createChestManager(scene);

    // Register boss wave announcement
    onBossWave((waveNumber) => {
      _showBossWaveAnnouncement(waveNumber);
      send({ type: "boss_wave", wave: waveNumber });
    });

    // All players start with Magic Wand
    for (const p of players) {
      addWeapon(p, "magicWand");
    }

    // Set up level-up callback
    setLevelUpCallback(_onPlayerLevelUp);
  }

  // Both host and guest need HUD and upgrade menu
  createHud(numPlayers, PLAYER_HEX_COLORS);
  createUpgradeMenu();

  // --- Setup network message handlers ---
  _setupNetworkHandlers();

  // --- Handle Window Resize ---
  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // --- Shadow light + player light follows local player ---
  function updateLights() {
    const targetIdx = _getCameraTargetIndex();
    const localPlayer = players[targetIdx];
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

// ---------- Spectator Mode ----------

function _getAlivePlayers() {
  const alive = [];
  for (let i = 0; i < players.length; i++) {
    if (players[i].alive) alive.push(i);
  }
  return alive;
}

/** Returns which player index the camera should follow. */
function _getCameraTargetIndex() {
  const localPlayer = players[_myPlayerArrayIndex];
  if (localPlayer && localPlayer.alive) {
    _spectatingIndex = -1;
    return _myPlayerArrayIndex;
  }

  const alive = _getAlivePlayers();
  if (alive.length === 0) return _myPlayerArrayIndex;

  // If not yet spectating or current target died, pick first alive
  if (
    _spectatingIndex < 0 ||
    !players[_spectatingIndex] ||
    !players[_spectatingIndex].alive
  ) {
    _spectatingIndex = alive[0];
  }

  return _spectatingIndex;
}

/** Handle A/D key presses to cycle spectator target when dead. */
function _handleSpectatorInput() {
  // Always consume A/D presses to prevent stale state buildup
  const pressedA = consumeKeyPress("KeyA") || consumeKeyPress("ArrowLeft");
  const pressedD = consumeKeyPress("KeyD") || consumeKeyPress("ArrowRight");

  const localPlayer = players[_myPlayerArrayIndex];
  if (!localPlayer || localPlayer.alive) {
    if (_spectatorHudEl) _spectatorHudEl.style.display = "none";
    return;
  }

  const alive = _getAlivePlayers();
  if (alive.length === 0) {
    _updateSpectatorHud();
    return;
  }

  // Ensure we have a valid spectating target
  _getCameraTargetIndex();

  if (pressedA) {
    const currentIdx = alive.indexOf(_spectatingIndex);
    const newIdx = currentIdx <= 0 ? alive.length - 1 : currentIdx - 1;
    _spectatingIndex = alive[newIdx];
  }
  if (pressedD) {
    const currentIdx = alive.indexOf(_spectatingIndex);
    const newIdx = currentIdx >= alive.length - 1 ? 0 : currentIdx + 1;
    _spectatingIndex = alive[newIdx];
  }

  _updateSpectatorHud();
}

function _createSpectatorHud() {
  _spectatorHudEl = document.createElement("div");
  _spectatorHudEl.style.cssText = `
    position: fixed; top: 60px; left: 50%; transform: translateX(-50%);
    background: rgba(0,0,0,0.7); color: #fff; padding: 10px 24px;
    border-radius: 8px; font-family: 'Segoe UI', sans-serif;
    font-size: 16px; z-index: 500; display: none;
    border: 1px solid rgba(255,255,255,0.2);
    text-align: center; pointer-events: none;
  `;
  document.body.appendChild(_spectatorHudEl);
}

function _updateSpectatorHud() {
  if (!_spectatorHudEl) _createSpectatorHud();

  if (_spectatingIndex < 0 || _spectatingIndex >= players.length) {
    _spectatorHudEl.style.display = "none";
    return;
  }

  const color = PLAYER_HEX_COLORS[_spectatingIndex % PLAYER_HEX_COLORS.length];
  _spectatorHudEl.innerHTML = `
    <span style="color: #aaa;">Spectating</span>
    <span style="color: ${color}; font-weight: bold;">Player ${_spectatingIndex + 1}</span>
    <br><span style="color: #666; font-size: 13px;">A / D to switch</span>
  `;
  _spectatorHudEl.style.display = "block";
}

// ---------- Host Game Loop ----------

function _animateHost(clock, scene, camera, renderer, world, updateLights) {
  let _lastTime = performance.now();

  function loop() {
    requestAnimationFrame(loop);

    const now = performance.now();
    const rawDelta = (now - _lastTime) / 1000;
    _lastTime = now;

    const delta = Math.min(rawDelta, document.hidden ? 0.1 : 0.05);

    if (gameState.paused || gameState.gameOver) {
      if (!document.hidden) renderer.render(scene, camera);
      return;
    }

    gameState.gameTime += delta;

    // --- Get inputs and update all players ---
    const localInput = getMovementVector();
    for (let i = 0; i < players.length; i++) {
      const pi = _gamePlayerIndices[i];
      const input =
        pi === getPlayerIndex()
          ? localInput
          : _remoteInputs[pi] || { x: 0, z: 0 };
      updatePlayer(players[i], delta, ARENA_HALF, input);
    }

    // --- Camera follows host's player (or spectated player if dead) ---
    _handleSpectatorInput();
    if (!document.hidden) {
      const cameraTargetIdx = _getCameraTargetIndex();
      updateCamera(camera, players[cameraTargetIdx].mesh, delta);
      updateLights();
    }

    // --- Game systems ---
    updateWaveDirector(delta, players);
    updateEnemies(delta, players);

    // Update boss state in gameState for HUD
    const activeBoss = getActiveBoss();
    gameState.bossActive = !!activeBoss;
    gameState.bossHp = activeBoss ? activeBoss.hp : 0;
    gameState.bossMaxHp = activeBoss ? activeBoss.maxHp : 0;
    gameState.currentWave = getCurrentWave();

    for (const p of players) {
      updateWeapons(delta, p, enemies);
    }
    updateWeaponVisuals(delta, enemies);
    updateProjectiles(delta, enemies);
    updateEnemyProjectiles(delta, players);
    updateXpGems(delta, players);

    // --- Chests & Buffs ---
    const chestPickups = updateChests(delta, players, gameState.gameTime);
    updateBuffVisuals(players, gameState.gameTime);
    for (const pickup of chestPickups) {
      _showBuffPickup(pickup.playerIndex, pickup.buffType);
      send({
        type: "buff_pickup",
        pi: pickup.playerIndex,
        bt: pickup.buffType,
      });
    }

    updateParticles(delta);

    if (!document.hidden) {
      const hudTargetIdx = _getCameraTargetIndex();
      updateHud(players[hudTargetIdx], players, gameState);
    }

    // Step the physics world
    world.step();

    // Only render when the tab is visible
    if (!document.hidden) {
      renderer.render(scene, camera);
    }

    // --- Send state to guests (always, even when hidden) ---
    _sendFrameCounter++;
    if (_sendFrameCounter % STATE_SEND_INTERVAL === 0) {
      _sendGameState();
    }

    // --- Check game over (ALL players dead) ---
    const allDead = players.every((p) => !p.alive);
    if (allDead && !gameState.gameOver) {
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
  const INPUT_SEND_INTERVAL = 1;

  function loop() {
    requestAnimationFrame(loop);

    const delta = Math.min(clock.getDelta(), 0.05);
    _guestLocalTime += delta;

    // --- Send local input to host ---
    _inputSendCounter++;
    if (_inputSendCounter % INPUT_SEND_INTERVAL === 0) {
      const localInput = getMovementVector();
      send({
        type: "input",
        pi: getPlayerIndex(),
        mx: localInput.x,
        mz: localInput.z,
      });
    }

    // --- Apply state updates with smooth interpolation ---
    if (_currentHostState) {
      if (!_previousHostState) {
        // First state ever — snap everything to it
        _applyHostState(_currentHostState, scene, 1.0);
        _previousHostState = _deepCloneState(_currentHostState);
        _previousStateTime = _currentStateTime;
        _guestStateDirty = false;
      } else {
        // When a new state just arrived, sync entities (create/remove meshes)
        // and update non-positional state. Positions will be interpolated below.
        if (_guestStateDirty) {
          // Sync entity lifecycle (creates new, removes old) — positions get overwritten by interpolation
          _syncGuestEnemies(_currentHostState.en, scene, 1.0);
          _syncGuestProjectiles(_currentHostState.pr, scene, 1.0);
          if (_currentHostState.ep) {
            _syncGuestEnemyProjectiles(_currentHostState.ep, scene);
          }
          _syncGuestGems(_currentHostState.gm, scene, 1.0);
          if (_currentHostState.wv) {
            _syncGuestWeaponVisuals(_currentHostState.wv, scene);
          }
          if (_currentHostState.ch) {
            _syncGuestChests(_currentHostState.ch, scene);
          }
          // Apply game-state scalars
          gameState.gameTime = _currentHostState.gt;
          gameState.totalKills = _currentHostState.tk;
          gameState.gameOver = _currentHostState.go;
          gameState.currentWave = _currentHostState.cw;
          gameState.bossActive = _currentHostState.ba;
          gameState.bossHp = _currentHostState.bh;
          gameState.bossMaxHp = _currentHostState.bmh;
          if (_currentHostState.go) _showGameOver();
          _guestStateDirty = false;
        }

        // Smoothly interpolate positions every frame
        if (_currentStateTime > _previousStateTime) {
          const elapsed = performance.now() - _currentStateTime;
          const interval = _currentStateTime - _previousStateTime;
          const t = Math.min(Math.max(elapsed / interval, 0), 1);

          // Interpolate player positions (main source of camera stutter)
          for (let i = 0; i < players.length; i++) {
            if (
              _previousHostState.pl &&
              _previousHostState.pl[i] &&
              _currentHostState.pl &&
              _currentHostState.pl[i]
            ) {
              _interpolatePlayerState(
                players[i],
                _previousHostState.pl[i],
                _currentHostState.pl[i],
                t,
              );
            }
          }

          // Interpolate enemy, projectile, and gem positions
          _interpolateGuestEnemies(
            _previousHostState.en,
            _currentHostState.en,
            scene,
            t,
          );
          _interpolateGuestProjectiles(
            _previousHostState.pr,
            _currentHostState.pr,
            scene,
            t,
          );
          if (_previousHostState.ep && _currentHostState.ep) {
            _interpolateGuestEnemyProjectiles(
              _previousHostState.ep,
              _currentHostState.ep,
              scene,
              t,
            );
          }
          _interpolateGuestGems(
            _previousHostState.gm,
            _currentHostState.gm,
            scene,
            t,
          );
        }
      }
    }

    // --- Continuously animate enemies, gems, chests, and buff visuals ---
    _animateGuestEnemies(_guestLocalTime);
    _animateGuestGems(delta);
    _animateGuestChests(gameState.gameTime);
    updateBuffVisuals(players, gameState.gameTime);

    // --- Camera follows local player (or spectated player if dead) ---
    _handleSpectatorInput();
    const cameraTargetIdx = _getCameraTargetIndex();
    if (cameraTargetIdx >= 0 && players[cameraTargetIdx]) {
      updateCamera(camera, players[cameraTargetIdx].mesh, delta);
    }
    updateLights();

    // --- Update HUD ---
    const guestHudTargetIdx = _getCameraTargetIndex();
    updateHud(players[guestHudTargetIdx], players, gameState);

    renderer.render(scene, camera);
  }

  loop();
}

// ---------- State Serialization (Host -> Guests) ----------

function _sendGameState() {
  const state = {
    type: "state",
    gt: gameState.gameTime,
    tk: gameState.totalKills,
    go: gameState.gameOver,
    pa: gameState.paused,
    pl: players.map((p) => _serializePlayer(p)),
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
      ...(e.isBoss
        ? {
            bs: e.bossState,
            bat: e.bossAttackType,
            bcp:
              e.bossChargeDuration > 0
                ? 1 - e.bossChargeTimer / e.bossChargeDuration
                : 0,
            btx: e.bossAttackTarget ? e.bossAttackTarget.x : 0,
            btz: e.bossAttackTarget ? e.bossAttackTarget.z : 0,
          }
        : {}),
    })),
    pr: getActiveProjectiles().map((p) => ({
      id: p.id,
      x: p.mesh.position.x,
      z: p.mesh.position.z,
    })),
    ep: getActiveEnemyProjectiles().map((p) => ({
      id: p.id,
      x: p.mesh.position.x,
      z: p.mesh.position.z,
      c: p.mesh.material.color.getHex(),
    })),
    gm: getActiveGems().map((g) => ({
      id: g.id,
      x: g.mesh.position.x,
      y: g.mesh.position.y,
      z: g.mesh.position.z,
    })),
    wv: getActiveVisualStates(players),
    ch: getActiveChests().map((c) => ({
      id: c.id,
      x: c.mesh.position.x,
      y: c.mesh.position.y,
      z: c.mesh.position.z,
      bt: c.buffType,
    })),
    cw: gameState.currentWave,
    ba: gameState.bossActive,
    bh: gameState.bossHp,
    bmh: gameState.bossMaxHp,
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
    bf: p.buffs
      ? {
          dp: p.buffs.doubleProjectiles,
          sb: p.buffs.speedBoost,
          ga: p.buffs.glowingArmor,
        }
      : null,
  };
}

// ---------- State Cloning (for interpolation) ----------

function _deepCloneState(state) {
  // Manual clone avoids expensive JSON.parse/stringify overhead
  const clone = {
    type: state.type,
    gt: state.gt,
    tk: state.tk,
    go: state.go,
    pa: state.pa,
    cw: state.cw,
    ba: state.ba,
    bh: state.bh,
    bmh: state.bmh,
  };

  // Clone player states
  if (state.pl) {
    clone.pl = new Array(state.pl.length);
    for (let i = 0; i < state.pl.length; i++) {
      const p = state.pl[i];
      clone.pl[i] = {
        x: p.x,
        z: p.z,
        fa: p.fa,
        hp: p.hp,
        mhp: p.mhp,
        xp: p.xp,
        lv: p.lv,
        al: p.al,
        inv: p.inv,
        bf: p.bf ? { dp: p.bf.dp, sb: p.bf.sb, ga: p.bf.ga } : null,
      };
    }
  }

  // Clone enemy states
  if (state.en) {
    clone.en = new Array(state.en.length);
    for (let i = 0; i < state.en.length; i++) {
      const e = state.en[i];
      clone.en[i] = {
        id: e.id,
        x: e.x,
        z: e.z,
        y: e.y,
        tk: e.tk,
        tn: e.tn,
        sz: e.sz,
        hp: e.hp,
        mhp: e.mhp,
        ry: e.ry,
        fl: e.fl,
      };
      if (e.bs !== undefined) {
        clone.en[i].bs = e.bs;
        clone.en[i].bat = e.bat;
        clone.en[i].bcp = e.bcp;
        clone.en[i].btx = e.btx;
        clone.en[i].btz = e.btz;
      }
    }
  }

  // Clone projectile states
  if (state.pr) {
    clone.pr = new Array(state.pr.length);
    for (let i = 0; i < state.pr.length; i++) {
      clone.pr[i] = { id: state.pr[i].id, x: state.pr[i].x, z: state.pr[i].z };
    }
  }

  // Clone gem states
  if (state.gm) {
    clone.gm = new Array(state.gm.length);
    for (let i = 0; i < state.gm.length; i++) {
      clone.gm[i] = {
        id: state.gm[i].id,
        x: state.gm[i].x,
        y: state.gm[i].y,
        z: state.gm[i].z,
      };
    }
  }

  // Clone enemy projectile states
  if (state.ep) {
    clone.ep = new Array(state.ep.length);
    for (let i = 0; i < state.ep.length; i++) {
      clone.ep[i] = {
        id: state.ep[i].id,
        x: state.ep[i].x,
        z: state.ep[i].z,
        c: state.ep[i].c,
      };
    }
  }

  // Clone chest states
  if (state.ch) {
    clone.ch = new Array(state.ch.length);
    for (let i = 0; i < state.ch.length; i++) {
      const c = state.ch[i];
      clone.ch[i] = { id: c.id, x: c.x, y: c.y, z: c.z, bt: c.bt };
    }
  }

  // Clone weapon visual states
  if (state.wv) {
    clone.wv = new Array(state.wv.length);
    for (let i = 0; i < state.wv.length; i++) {
      const v = state.wv[i];
      clone.wv[i] = {
        id: v.id,
        t: v.t,
        x: v.x,
        y: v.y,
        z: v.z,
        rz: v.rz,
        a: v.a,
        op: v.op,
        oi: v.oi,
      };
    }
  }

  return clone;
}

// ---------- State Deserialization (Guest receives Host state) ----------

function _applyHostState(state, scene, interpolationFactor) {
  gameState.gameTime = state.gt;
  gameState.totalKills = state.tk;
  gameState.gameOver = state.go;
  gameState.currentWave = state.cw ?? gameState.currentWave;
  gameState.bossActive = state.ba ?? false;
  gameState.bossHp = state.bh ?? 0;
  gameState.bossMaxHp = state.bmh ?? 0;

  // Update all players
  for (let i = 0; i < players.length && i < state.pl.length; i++) {
    _applyPlayerState(players[i], state.pl[i], interpolationFactor);
  }

  // Sync enemy meshes
  _syncGuestEnemies(state.en, scene, interpolationFactor);

  // Sync projectile meshes
  _syncGuestProjectiles(state.pr, scene, interpolationFactor);

  // Sync enemy projectile meshes
  if (state.ep) {
    _syncGuestEnemyProjectiles(state.ep, scene);
  }

  // Sync gem meshes
  _syncGuestGems(state.gm, scene, interpolationFactor);

  // Sync weapon visuals (whip arcs, garlic auras, holy water pools)
  if (state.wv) {
    _syncGuestWeaponVisuals(state.wv, scene);
  }

  // Sync chests
  if (state.ch) {
    _syncGuestChests(state.ch, scene);
  }

  // Check game over
  if (state.go && !gameState.gameOver) {
    gameState.gameOver = true;
    _showGameOver();
  }
}

// Interpolate between two states
function _interpolateHostState(prevState, currState, scene, t) {
  gameState.gameTime = currState.gt;
  gameState.totalKills = currState.tk;
  gameState.gameOver = currState.go;

  for (let i = 0; i < players.length; i++) {
    if (prevState.pl && prevState.pl[i] && currState.pl && currState.pl[i]) {
      _interpolatePlayerState(players[i], prevState.pl[i], currState.pl[i], t);
    }
  }

  _interpolateGuestEnemies(prevState.en, currState.en, scene, t);
  _interpolateGuestProjectiles(prevState.pr, currState.pr, scene, t);
  if (prevState.ep && currState.ep) {
    _interpolateGuestEnemyProjectiles(prevState.ep, currState.ep, scene, t);
  }
  _interpolateGuestGems(prevState.gm, currState.gm, scene, t);
}

function _applyPlayerState(playerObj, s, interpolationFactor) {
  playerObj.mesh.position.x = s.x;
  playerObj.mesh.position.z = s.z;
  playerObj.mesh.rotation.y = s.fa;
  playerObj.facingAngle = s.fa;
  playerObj.hp = s.hp;
  playerObj.maxHp = s.mhp;
  playerObj.xp = s.xp;
  playerObj.level = s.lv;
  playerObj.alive = s.al;

  // Apply buff timers from host
  if (s.bf) {
    if (!playerObj.buffs) {
      playerObj.buffs = {
        doubleProjectiles: 0,
        speedBoost: 0,
        glowingArmor: 0,
      };
    }
    playerObj.buffs.doubleProjectiles = s.bf.dp || 0;
    playerObj.buffs.speedBoost = s.bf.sb || 0;
    playerObj.buffs.glowingArmor = s.bf.ga || 0;
  }

  if (!s.al) {
    // Dead: rotate to lie on the ground
    playerObj.mesh.rotation.x = -Math.PI / 2;
    playerObj.mesh.position.y = 0.15;
    playerObj.mesh.visible = true;
  } else {
    playerObj.mesh.rotation.x = 0;
    playerObj.mesh.position.y = PLAYER_SIZE * 0.9;
    if (s.inv) {
      playerObj.mesh.visible = Math.floor(performance.now() / 100) % 2 === 0;
    } else {
      playerObj.mesh.visible = true;
    }
  }
}

function _interpolatePlayerState(playerObj, prevS, currS, t) {
  playerObj.mesh.position.x = prevS.x + (currS.x - prevS.x) * t;
  playerObj.mesh.position.z = prevS.z + (currS.z - prevS.z) * t;

  let rotDiff = currS.fa - prevS.fa;
  if (rotDiff > Math.PI) rotDiff -= Math.PI * 2;
  if (rotDiff < -Math.PI) rotDiff += Math.PI * 2;
  playerObj.mesh.rotation.y = prevS.fa + rotDiff * t;

  playerObj.facingAngle = currS.fa;
  playerObj.hp = currS.hp;
  playerObj.maxHp = currS.mhp;
  playerObj.xp = currS.xp;
  playerObj.level = currS.lv;
  playerObj.alive = currS.al;

  // Apply buff timers from current state
  if (currS.bf) {
    if (!playerObj.buffs) {
      playerObj.buffs = {
        doubleProjectiles: 0,
        speedBoost: 0,
        glowingArmor: 0,
      };
    }
    playerObj.buffs.doubleProjectiles = currS.bf.dp || 0;
    playerObj.buffs.speedBoost = currS.bf.sb || 0;
    playerObj.buffs.glowingArmor = currS.bf.ga || 0;
  }

  if (!currS.al) {
    // Dead: rotate to lie on the ground
    playerObj.mesh.rotation.x = -Math.PI / 2;
    playerObj.mesh.position.y = 0.15;
    playerObj.mesh.visible = true;
  } else {
    playerObj.mesh.rotation.x = 0;
    playerObj.mesh.position.y = PLAYER_SIZE * 0.9;
    if (currS.inv) {
      playerObj.mesh.visible = Math.floor(performance.now() / 100) % 2 === 0;
    } else {
      playerObj.mesh.visible = true;
    }
  }
}

function _syncGuestEnemies(enemyStates, scene, interpolationFactor) {
  const activeIds = new Set();

  for (const es of enemyStates) {
    activeIds.add(es.id);

    let entry = _guestEnemyMap.get(es.id);
    if (!entry) {
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

    entry.mesh.position.set(es.x, es.y, es.z);
    entry.mesh.rotation.y = es.ry;
    entry.mesh.visible = true;

    if (es.fl > 0) {
      flashGroup(entry.mesh);
    } else {
      unflashGroup(entry.mesh);
    }

    // Boss indicator sync (guest side)
    if (es.tk === "boss") {
      _syncGuestBossIndicator(entry, es, scene);
    }
  }

  for (const [id, entry] of _guestEnemyMap) {
    if (!activeIds.has(id)) {
      entry.mesh.visible = false;
      scene.remove(entry.mesh);
      _removeGuestBossIndicator(entry, scene);
      _guestEnemyMap.delete(id);
    }
  }
}

function _interpolateGuestEnemies(prevEnemyStates, currEnemyStates, scene, t) {
  const activeIds = new Set();
  const prevEnemyMap = new Map();

  for (const es of prevEnemyStates) {
    prevEnemyMap.set(es.id, es);
  }

  for (const es of currEnemyStates) {
    activeIds.add(es.id);
    const entry = _guestEnemyMap.get(es.id);
    if (!entry) continue;

    const prevEs = prevEnemyMap.get(es.id);
    if (!prevEs) {
      entry.mesh.position.set(es.x, es.y, es.z);
      entry.mesh.rotation.y = es.ry;
    } else {
      entry.mesh.position.x = prevEs.x + (es.x - prevEs.x) * t;
      entry.mesh.position.y = prevEs.y + (es.y - prevEs.y) * t;
      entry.mesh.position.z = prevEs.z + (es.z - prevEs.z) * t;

      let rotDiff = es.ry - prevEs.ry;
      if (rotDiff > Math.PI) rotDiff -= Math.PI * 2;
      if (rotDiff < -Math.PI) rotDiff += Math.PI * 2;
      entry.mesh.rotation.y = prevEs.ry + rotDiff * t;
    }

    entry.mesh.visible = true;

    if (es.fl > 0) {
      flashGroup(entry.mesh);
    } else {
      unflashGroup(entry.mesh);
    }
  }

  for (const [id, entry] of _guestEnemyMap) {
    if (!activeIds.has(id)) {
      entry.mesh.visible = false;
    }
  }
}

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
  const activeIds = new Set();

  for (const ps of projStates) {
    activeIds.add(ps.id);

    let entry = _guestProjectileMap.get(ps.id);
    if (!entry) {
      const geo = new THREE.SphereGeometry(0.15, 6, 6);
      const mat = new THREE.MeshBasicMaterial({ color: 0x44ccff });
      const mesh = new THREE.Mesh(geo, mat);
      scene.add(mesh);
      entry = { mesh };
      _guestProjectileMap.set(ps.id, entry);
    }

    entry.mesh.position.set(ps.x, 0.8, ps.z);
    entry.mesh.visible = true;
  }

  for (const [id, entry] of _guestProjectileMap) {
    if (!activeIds.has(id)) {
      entry.mesh.visible = false;
      scene.remove(entry.mesh);
      if (entry.mesh.geometry) entry.mesh.geometry.dispose();
      if (entry.mesh.material) entry.mesh.material.dispose();
      _guestProjectileMap.delete(id);
    }
  }
}

function _interpolateGuestProjectiles(
  prevProjStates,
  currProjStates,
  scene,
  t,
) {
  // Build a lookup map for previous state by ID
  const prevMap = new Map();
  for (const ps of prevProjStates) {
    prevMap.set(ps.id, ps);
  }

  for (const currP of currProjStates) {
    const entry = _guestProjectileMap.get(currP.id);
    if (!entry) continue;

    const prevP = prevMap.get(currP.id);
    if (!prevP) {
      entry.mesh.position.set(currP.x, 0.8, currP.z);
    } else {
      entry.mesh.position.x = prevP.x + (currP.x - prevP.x) * t;
      entry.mesh.position.z = prevP.z + (currP.z - prevP.z) * t;
      entry.mesh.position.y = 0.8;
    }
  }
}

function _syncGuestEnemyProjectiles(projStates, scene) {
  const activeIds = new Set();

  for (const ps of projStates) {
    activeIds.add(ps.id);

    let entry = _guestEnemyProjectileMap.get(ps.id);
    if (!entry) {
      const geo = new THREE.SphereGeometry(0.12, 6, 6);
      const mat = new THREE.MeshBasicMaterial({
        color: ps.c || 0xdd55ff,
        transparent: true,
        opacity: 1,
      });
      const mesh = new THREE.Mesh(geo, mat);
      scene.add(mesh);
      entry = { mesh };
      _guestEnemyProjectileMap.set(ps.id, entry);
    }

    entry.mesh.position.set(ps.x, 0.8, ps.z);
    entry.mesh.material.color.setHex(ps.c || 0xdd55ff);
    entry.mesh.visible = true;
  }

  for (const [id, entry] of _guestEnemyProjectileMap) {
    if (!activeIds.has(id)) {
      entry.mesh.visible = false;
      scene.remove(entry.mesh);
      if (entry.mesh.geometry) entry.mesh.geometry.dispose();
      if (entry.mesh.material) entry.mesh.material.dispose();
      _guestEnemyProjectileMap.delete(id);
    }
  }
}

function _interpolateGuestEnemyProjectiles(
  prevProjStates,
  currProjStates,
  scene,
  t,
) {
  // Build a lookup map for previous state by ID
  const prevMap = new Map();
  for (const ps of prevProjStates) {
    prevMap.set(ps.id, ps);
  }

  for (const currP of currProjStates) {
    const entry = _guestEnemyProjectileMap.get(currP.id);
    if (!entry) continue;

    const prevP = prevMap.get(currP.id);
    if (!prevP) {
      entry.mesh.position.set(currP.x, 0.8, currP.z);
    } else {
      entry.mesh.position.x = prevP.x + (currP.x - prevP.x) * t;
      entry.mesh.position.z = prevP.z + (currP.z - prevP.z) * t;
      entry.mesh.position.y = 0.8;
    }
  }
}

function _syncGuestGems(gemStates, scene, interpolationFactor) {
  const activeIds = new Set();

  for (const gs of gemStates) {
    activeIds.add(gs.id);

    let entry = _guestGemMap.get(gs.id);
    if (!entry) {
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
      entry = { mesh };
      _guestGemMap.set(gs.id, entry);
    }

    entry.mesh.position.set(gs.x, gs.y, gs.z);
    entry.mesh.visible = true;
  }

  for (const [id, entry] of _guestGemMap) {
    if (!activeIds.has(id)) {
      entry.mesh.visible = false;
      scene.remove(entry.mesh);
      if (entry.mesh.geometry) entry.mesh.geometry.dispose();
      if (entry.mesh.material) entry.mesh.material.dispose();
      _guestGemMap.delete(id);
    }
  }
}

function _interpolateGuestGems(prevGemStates, currGemStates, scene, t) {
  // Build a lookup map for previous state by ID
  const prevMap = new Map();
  for (const gs of prevGemStates) {
    prevMap.set(gs.id, gs);
  }

  for (const currG of currGemStates) {
    const entry = _guestGemMap.get(currG.id);
    if (!entry) continue;

    const prevG = prevMap.get(currG.id);
    if (!prevG) {
      entry.mesh.position.set(currG.x, currG.y, currG.z);
    } else {
      entry.mesh.position.x = prevG.x + (currG.x - prevG.x) * t;
      entry.mesh.position.y = prevG.y + (currG.y - prevG.y) * t;
      entry.mesh.position.z = prevG.z + (currG.z - prevG.z) * t;
    }
  }
}

function _animateGuestGems(delta) {
  for (const [, entry] of _guestGemMap) {
    if (entry.mesh.visible) {
      entry.mesh.rotation.y += delta * 2;
    }
  }
}

// ---------- Guest Chest Sync ----------

function _syncGuestChests(chestStates, scene) {
  const activeIds = new Set();

  for (const cs of chestStates) {
    activeIds.add(cs.id);

    let entry = _guestChestMap.get(cs.id);
    if (!entry) {
      const result = createChestMesh(cs.bt);
      scene.add(result.mesh);
      entry = {
        mesh: result.mesh,
        glowMesh: result.glowMesh,
        beaconMesh: result.beaconMesh,
        buffType: cs.bt,
      };
      _guestChestMap.set(cs.id, entry);
    }

    entry.mesh.position.x = cs.x;
    entry.mesh.position.z = cs.z;
    entry.mesh.visible = true;
  }

  for (const [id, entry] of _guestChestMap) {
    if (!activeIds.has(id)) {
      scene.remove(entry.mesh);
      entry.mesh.traverse((child) => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) child.material.dispose();
      });
      _guestChestMap.delete(id);
    }
  }
}

function _animateGuestChests(gameTime) {
  for (const [id, entry] of _guestChestMap) {
    if (entry.mesh.visible) {
      entry.mesh.rotation.y += 0.02;
      entry.mesh.position.y = 0.8 + Math.sin(gameTime * 2.5 + id * 1.7) * 0.2;
      if (entry.glowMesh) {
        entry.glowMesh.material.opacity =
          0.12 + Math.sin(gameTime * 3 + id) * 0.06;
      }
      if (entry.beaconMesh) {
        entry.beaconMesh.material.opacity =
          0.08 + Math.sin(gameTime * 2 + id * 0.5) * 0.04;
      }
    }
  }
}

// ---------- Guest Boss Indicator Sync ----------

function _syncGuestBossIndicator(entry, es, scene) {
  if (es.bs === "charging" && es.bat) {
    // Create indicator if needed or type changed
    if (!entry.bossIndicator || entry.bossIndicatorType !== es.bat) {
      _removeGuestBossIndicator(entry, scene);
      const mesh = createBossIndicatorMesh(es.bat);
      if (mesh) {
        scene.add(mesh);
        entry.bossIndicator = mesh;
        entry.bossIndicatorType = es.bat;
      }
    }
    // Update indicator position, rotation, opacity
    if (entry.bossIndicator) {
      const progress = es.bcp || 0;
      const pulse = 0.5 + Math.sin(progress * Math.PI * 6) * 0.3;
      const opacity = 0.1 + progress * 0.5 * pulse;

      switch (es.bat) {
        case "cone":
          entry.bossIndicator.position.set(es.x, 0.15, es.z);
          entry.bossIndicator.rotation.z = -es.ry;
          entry.bossIndicator.material.opacity = opacity;
          break;
        case "rangedCircle":
          entry.bossIndicator.position.set(es.btx, 0.15, es.btz);
          entry.bossIndicator.material.opacity = opacity;
          entry.bossIndicator.scale.setScalar(0.3 + progress * 0.7);
          break;
        case "stomp":
          entry.bossIndicator.position.set(es.x, 0.15, es.z);
          entry.bossIndicator.material.opacity = opacity;
          entry.bossIndicator.scale.setScalar(0.3 + progress * 0.7);
          break;
      }
    }
  } else if (es.bs === "attacking" && entry.bossIndicator) {
    // Flash white during attack frame
    entry.bossIndicator.material.opacity = 0.9;
    entry.bossIndicator.material.color.setHex(0xffffff);
  } else {
    _removeGuestBossIndicator(entry, scene);
  }
}

function _removeGuestBossIndicator(entry, scene) {
  if (entry.bossIndicator) {
    scene.remove(entry.bossIndicator);
    if (entry.bossIndicator.geometry) entry.bossIndicator.geometry.dispose();
    if (entry.bossIndicator.material) entry.bossIndicator.material.dispose();
    entry.bossIndicator = null;
    entry.bossIndicatorType = null;
  }
}

// ---------- Guest Weapon Visual Sync ----------

function _syncGuestWeaponVisuals(visualStates, scene) {
  const activeIds = new Set();

  for (const vs of visualStates) {
    activeIds.add(vs.id);

    let entry = _guestWeaponVisualMap.get(vs.id);
    if (!entry) {
      // Create new visual mesh based on type
      let mesh;
      switch (vs.t) {
        case "whip": {
          const geo = new THREE.RingGeometry(
            0.3,
            vs.a,
            16,
            1,
            -Math.PI * 0.5,
            Math.PI,
          );
          const mat = new THREE.MeshBasicMaterial({
            color: 0xffcc44,
            transparent: true,
            opacity: vs.op,
            side: THREE.DoubleSide,
            depthWrite: false,
          });
          mesh = new THREE.Mesh(geo, mat);
          mesh.rotation.x = -Math.PI / 2;
          break;
        }
        case "garlic": {
          const geo = new THREE.RingGeometry(vs.a - 0.3, vs.a, 32);
          const mat = new THREE.MeshBasicMaterial({
            color: 0x88ff88,
            transparent: true,
            opacity: vs.op,
            side: THREE.DoubleSide,
            depthWrite: false,
          });
          mesh = new THREE.Mesh(geo, mat);
          mesh.rotation.x = -Math.PI / 2;
          break;
        }
        case "holyWater": {
          const geo = new THREE.CircleGeometry(vs.a, 24);
          const mat = new THREE.MeshBasicMaterial({
            color: 0x4488ff,
            transparent: true,
            opacity: vs.op,
            side: THREE.DoubleSide,
            depthWrite: false,
          });
          mesh = new THREE.Mesh(geo, mat);
          mesh.rotation.x = -Math.PI / 2;
          break;
        }
      }
      if (mesh) {
        scene.add(mesh);
        entry = { mesh, type: vs.t };
        _guestWeaponVisualMap.set(vs.id, entry);
      }
    }

    if (entry) {
      // Update position, rotation, and opacity
      entry.mesh.position.set(vs.x, vs.y, vs.z);
      entry.mesh.rotation.z = vs.rz;
      entry.mesh.material.opacity = vs.op;
      entry.mesh.visible = true;

      // Garlic follows its owner player on guest side
      if (vs.t === "garlic" && vs.oi >= 0 && vs.oi < players.length) {
        entry.mesh.position.x = players[vs.oi].mesh.position.x;
        entry.mesh.position.z = players[vs.oi].mesh.position.z;
      }
    }
  }

  // Remove visuals no longer active
  for (const [id, entry] of _guestWeaponVisualMap) {
    if (!activeIds.has(id)) {
      scene.remove(entry.mesh);
      if (entry.mesh.geometry) entry.mesh.geometry.dispose();
      if (entry.mesh.material) entry.mesh.material.dispose();
      _guestWeaponVisualMap.delete(id);
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
    case "input": {
      // Guest sends their movement input with playerIndex
      const pi = msg.pi;
      if (_remoteInputs[pi]) {
        _remoteInputs[pi].x = msg.mx || 0;
        _remoteInputs[pi].z = msg.mz || 0;
      }
      break;
    }

    case "upgrade_pick": {
      // Guest picked an upgrade for their player
      const pi = msg.playerIndex;
      const pending = _pendingUpgradeChoices[pi];
      if (pending && msg.index >= 0 && msg.index < pending.length) {
        const arrayIdx = _gamePlayerIndices.indexOf(pi);
        if (arrayIdx >= 0 && arrayIdx < players.length) {
          applyUpgradeChoice(pending[msg.index], players[arrayIdx]);
        }
        delete _pendingUpgradeChoices[pi];
        send({ type: "upgrade_done", playerIndex: pi });
      }
      break;
    }
  }
}

function _handleGuestMessage(msg) {
  switch (msg.type) {
    case "state": {
      const now = performance.now();
      if (_currentHostState) {
        _previousHostState = _deepCloneState(_currentHostState);
        _previousStateTime = _currentStateTime;
      }
      _currentHostState = _deepCloneState(msg);
      _currentStateTime = now;
      _guestStateDirty = true;
      // Don't apply immediately — the guest render loop will interpolate smoothly
      break;
    }

    case "upgrade_show": {
      // Only show if this upgrade is for our player
      if (msg.playerIndex === getPlayerIndex()) {
        const arrayIdx = _gamePlayerIndices.indexOf(msg.playerIndex);
        const playerLabel = `Player ${arrayIdx + 1}`;
        showUpgradeMenuUI(msg.choices, playerLabel, (index) => {
          send({
            type: "upgrade_pick",
            playerIndex: getPlayerIndex(),
            index,
          });
          hideUpgradeMenu();
        });
      }
      break;
    }

    case "upgrade_done": {
      if (msg.playerIndex === getPlayerIndex()) {
        hideUpgradeMenu();
      }
      break;
    }

    case "buff_pickup":
      _showBuffPickup(msg.pi, msg.bt);
      break;

    case "boss_wave":
      _showBossWaveAnnouncement(msg.wave);
      break;

    case "game_over":
      gameState.gameOver = true;
      _showGameOver();
      break;
  }
}

// ---------- Level-Up Callback (Host Only) ----------

function _onPlayerLevelUp(playerObj) {
  const arrayIdx = players.indexOf(playerObj);
  if (arrayIdx < 0) return;

  const pi = _gamePlayerIndices[arrayIdx];
  const playerLabel = `Player ${arrayIdx + 1}`;

  if (pi === getPlayerIndex()) {
    // Host's own player leveled up — show menu locally
    const choices = generateUpgradeChoices(playerObj);
    showUpgradeMenuUI(choices, playerLabel, (index) => {
      applyUpgradeChoice(choices[index], playerObj);
      hideUpgradeMenu();
    });
  } else {
    // Guest's player leveled up — send choices to that guest
    const choices = generateUpgradeChoices(playerObj);
    _pendingUpgradeChoices[pi] = choices;

    // Send serializable choices (broadcast to all guests; only the matching one shows it)
    send({
      type: "upgrade_show",
      playerIndex: pi,
      choices: choices.map((c) => ({
        type: c.type,
        id: c.id,
        name: c.name,
        description: c.description,
      })),
    });
  }
}

// ---------- Seeded Arena Decoration Generation ----------

function _generateDecorations(scene, seed) {
  const rng = createSeededRandom(seed);

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
    const x = (rng() - 0.5) * ARENA_SIZE * 0.9;
    const z = (rng() - 0.5) * ARENA_SIZE * 0.9;

    if (rng() < 0.6) {
      const geo = decorGeo[Math.floor(rng() * decorGeo.length)];
      const rock = new THREE.Mesh(geo, decorMat);
      rock.position.set(x, 0.2, z);
      rock.rotation.set(rng(), rng(), rng());
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
        branch.rotation.z = (rng() - 0.5) * 1.2;
        trunk.add(branch);
      }
    }
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
let _lobbyPlayerListEl = null;
let _lobbyPlayerCountEl = null;

/**
 * Show the lobby overlay with HOST/JOIN buttons.
 * Returns a promise that resolves with the assigned role.
 */
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
      <div id="lobby-player-list-area" style="display: none; margin-bottom: 20px; min-width: 280px;"></div>
      <p id="lobby-status" style="color: #888; font-size: 16px; min-height: 24px;"></p>
      <p id="lobby-server-hint" style="color: #555; font-size: 13px; margin-top: 20px;">
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
        // Hide buttons and IP input
        const btns = _lobbyOverlay.querySelector("#lobby-buttons");
        if (btns) btns.style.display = "none";
        ipInputArea.style.display = "none";
        // Hide server hint
        const hint = _lobbyOverlay.querySelector("#lobby-server-hint");
        if (hint) hint.style.display = "none";
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

    // HOST: connect to localhost
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

/**
 * Show lobby waiting screen for host: player list + START button.
 * Returns a promise resolving with { seed, playerIndices } when START is clicked.
 */
function _showLobbyWaitingHost() {
  return new Promise((resolve) => {
    // Show player list area
    const playerListArea = _lobbyOverlay.querySelector(
      "#lobby-player-list-area",
    );
    playerListArea.style.display = "block";

    // Create player list container
    _lobbyPlayerListEl = document.createElement("div");
    _lobbyPlayerListEl.style.cssText = `
      background: rgba(0,0,0,0.3); border-radius: 10px; padding: 16px;
      border: 1px solid rgba(255,255,255,0.1);
    `;
    playerListArea.appendChild(_lobbyPlayerListEl);

    // Player count
    _lobbyPlayerCountEl = document.createElement("div");
    _lobbyPlayerCountEl.style.cssText = `
      color: #888; font-size: 14px; text-align: center; margin-top: 10px;
    `;
    playerListArea.appendChild(_lobbyPlayerCountEl);

    // START GAME button
    const startBtn = document.createElement("button");
    startBtn.textContent = "START GAME";
    startBtn.style.cssText = `
      padding: 16px 48px; font-size: 22px; cursor: pointer;
      background: #44cc44; border: none; color: #fff; border-radius: 8px;
      font-weight: bold; transition: background 0.2s; font-family: inherit;
      margin-top: 16px; display: block;
    `;
    startBtn.addEventListener("mouseenter", () => {
      startBtn.style.background = "#55dd55";
    });
    startBtn.addEventListener("mouseleave", () => {
      startBtn.style.background = "#44cc44";
    });
    playerListArea.appendChild(startBtn);

    _setLobbyStatus("You are the Host. Start the game when ready.");

    // Register handler for player_list updates
    onMessage((msg) => {
      if (msg.type === "player_list") {
        _lobbyPlayerIndices = msg.players;
        _renderLobbyPlayerList();
      }
    });

    // Render initial list (might be just us)
    _renderLobbyPlayerList();

    startBtn.addEventListener("click", () => {
      const worldSeed = Math.floor(Math.random() * 2147483647);
      const playerIndices = [..._lobbyPlayerIndices].sort((a, b) => a - b);
      send({ type: "game_start", seed: worldSeed, playerIndices });
      startBtn.disabled = true;
      startBtn.style.opacity = "0.5";
      _setLobbyStatus("Starting game...");
      resolve({ seed: worldSeed, playerIndices });
    });
  });
}

/**
 * Show lobby waiting screen for guest: player list + waiting message.
 * Returns a promise resolving with { seed, playerIndices } when game_start is received.
 */
function _showLobbyWaitingGuest() {
  return new Promise((resolve) => {
    // Show player list area
    const playerListArea = _lobbyOverlay.querySelector(
      "#lobby-player-list-area",
    );
    playerListArea.style.display = "block";

    // Create player list container
    _lobbyPlayerListEl = document.createElement("div");
    _lobbyPlayerListEl.style.cssText = `
      background: rgba(0,0,0,0.3); border-radius: 10px; padding: 16px;
      border: 1px solid rgba(255,255,255,0.1);
    `;
    playerListArea.appendChild(_lobbyPlayerListEl);

    // Player count
    _lobbyPlayerCountEl = document.createElement("div");
    _lobbyPlayerCountEl.style.cssText = `
      color: #888; font-size: 14px; text-align: center; margin-top: 10px;
    `;
    playerListArea.appendChild(_lobbyPlayerCountEl);

    _setLobbyStatus("Waiting for host to start the game...");

    // Register handler for player_list updates AND game_start
    onMessage((msg) => {
      if (msg.type === "player_list") {
        _lobbyPlayerIndices = msg.players;
        _renderLobbyPlayerList();
      }
      if (msg.type === "game_start") {
        _setLobbyStatus("Game starting...");
        resolve({ seed: msg.seed, playerIndices: msg.playerIndices });
      }
    });

    // Render initial list
    _renderLobbyPlayerList();
  });
}

/**
 * Re-render the lobby player list from _lobbyPlayerIndices.
 */
function _renderLobbyPlayerList() {
  if (!_lobbyPlayerListEl) return;

  const myIndex = getPlayerIndex();
  const sorted = [..._lobbyPlayerIndices].sort((a, b) => a - b);

  let html = `<div style="font-size: 14px; color: #aaa; margin-bottom: 10px; text-align: center; font-weight: bold; text-transform: uppercase; letter-spacing: 1px;">Players in Lobby</div>`;

  sorted.forEach((pi, i) => {
    const color = PLAYER_HEX_COLORS[i % PLAYER_HEX_COLORS.length];
    const isMe = pi === myIndex;
    const isHostPlayer = pi === sorted[0]; // first connected is host (lowest index)
    let label = `Player ${i + 1}`;
    const tags = [];
    if (isMe) tags.push("You");
    if (isHostPlayer) tags.push("Host");
    if (tags.length > 0) label += ` (${tags.join(" - ")})`;

    html += `
      <div style="display: flex; align-items: center; gap: 10px; padding: 6px 8px; ${isMe ? "background: rgba(255,255,255,0.05); border-radius: 6px;" : ""}">
        <div style="width: 12px; height: 12px; border-radius: 50%; background: ${color}; box-shadow: 0 0 8px ${color}88;"></div>
        <div style="color: ${isMe ? "#fff" : "#ccc"}; font-size: 16px; font-weight: ${isMe ? "bold" : "normal"};">${label}</div>
      </div>
    `;
  });

  _lobbyPlayerListEl.innerHTML = html;

  if (_lobbyPlayerCountEl) {
    _lobbyPlayerCountEl.textContent = `${sorted.length}/5 Players`;
  }
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

function _delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------- Boss Wave Announcement ----------

function _showBossWaveAnnouncement(waveNumber) {
  const bossLevel = Math.floor(waveNumber / 5);

  // Add CSS animation if not already added
  if (!document.getElementById("boss-announce-style")) {
    const style = document.createElement("style");
    style.id = "boss-announce-style";
    style.textContent = `
      @keyframes bossAnnounce {
        0% { opacity: 0; transform: scale(0.5); }
        15% { opacity: 1; transform: scale(1.05); }
        30% { opacity: 1; transform: scale(1); }
        85% { opacity: 1; transform: scale(1); }
        100% { opacity: 0; transform: scale(1.1); }
      }
    `;
    document.head.appendChild(style);
  }

  const el = document.createElement("div");
  el.style.cssText = `
    position: fixed; inset: 0;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    z-index: 800; pointer-events: none;
  `;
  el.innerHTML = `
    <div style="font-size: 56px; font-weight: bold; color: #ff0044;
      text-shadow: 0 0 30px #ff000088, 0 0 60px #ff000044;
      font-family: 'Segoe UI', sans-serif; letter-spacing: 4px;
      animation: bossAnnounce 2.5s ease-out forwards;">
      BOSS WAVE!
    </div>
    <div style="font-size: 24px; color: #ffcc00; margin-top: 8px;
      text-shadow: 0 0 10px #ffcc0066;
      font-family: 'Segoe UI', sans-serif;
      animation: bossAnnounce 2.5s ease-out 0.3s forwards;">
      Wave ${waveNumber} &mdash; Boss Level ${bossLevel}
    </div>
  `;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

// ---------- Buff Pickup Announcement ----------

function _showBuffPickup(playerArrayIndex, buffType) {
  const info = BUFF_INFO[buffType];
  if (!info) return;

  const color = PLAYER_HEX_COLORS[playerArrayIndex % PLAYER_HEX_COLORS.length];

  // Add CSS animation if not already present
  if (!document.getElementById("buff-pickup-style")) {
    const style = document.createElement("style");
    style.id = "buff-pickup-style";
    style.textContent = `
      @keyframes buffPickup {
        0% { opacity: 0; transform: translateX(-50%) translateY(10px); }
        20% { opacity: 1; transform: translateX(-50%) translateY(0); }
        80% { opacity: 1; transform: translateX(-50%) translateY(0); }
        100% { opacity: 0; transform: translateX(-50%) translateY(-20px); }
      }
    `;
    document.head.appendChild(style);
  }

  const el = document.createElement("div");
  el.style.cssText = `
    position: fixed; top: 38%; left: 50%; transform: translateX(-50%);
    z-index: 800; pointer-events: none;
    animation: buffPickup 2s ease-out forwards;
    text-align: center;
  `;
  el.innerHTML = `
    <div style="font-size: 28px; font-weight: bold; color: ${info.color};
      text-shadow: 0 0 15px ${info.color}88, 0 0 30px ${info.color}44;
      font-family: 'Segoe UI', sans-serif; letter-spacing: 2px;">
      ${info.name.toUpperCase()}!
    </div>
    <div style="font-size: 14px; color: ${color}; margin-top: 4px;
      font-family: 'Segoe UI', sans-serif;">
      Player ${playerArrayIndex + 1} &mdash; 60s
    </div>
  `;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2500);
}

// ---------- Game Over Screen ----------

function _showGameOver() {
  const levelsHtml = players
    .map((p, i) => {
      const color = PLAYER_HEX_COLORS[i % PLAYER_HEX_COLORS.length];
      return `<span style="color: ${color};">P${i + 1} Lv ${p.level}</span>`;
    })
    .join(" &nbsp;|&nbsp; ");

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
      <div style="font-size: 22px; margin-bottom: 8px;">${levelsHtml}</div>
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
