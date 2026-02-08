# Vampire Survivor Clone — Architecture & Components

This document describes how the game works and what each component is responsible for.

---

## Overview

A **Vampire Survivor–style** survival game: players move in an arena, auto-attack with weapons, collect XP gems to level up, and survive waves of enemies (including periodic boss waves). The game supports **multiplayer** (up to 5 players) with **host-authoritative** simulation: the host runs the full game loop and sends state to guests; guests send input and interpolate received state for smooth visuals.

**Tech stack:** Three.js (rendering), Rapier (physics), WebSocket relay server (multiplayer).

---

## High-Level Flow

1. **Startup:** Rapier and Three.js are initialized; scene, camera, lights, arena, and ground collider are created. Network connects to the WebSocket server; first client becomes **host**, others become **guests**. Player count is fixed when the game starts.
2. **Host:** Every frame the host runs the full simulation: input → players → wave director → enemies → weapons → projectiles → XP gems → chests → particles → physics step → serialize and send state (~20 Hz).
3. **Guests:** Every frame guests send their movement input, receive state packets, buffer them by time, and interpolate entities (players, enemies, projectiles, gems, chests) for smooth display. No simulation runs on guests.
4. **Level-up:** When a player’s XP crosses the threshold, the game pauses for that player and shows the upgrade menu; after a choice is applied (and synced in multiplayer), play resumes.

---

## Entry Point & Orchestration

### `src/main.js`

**Role:** Entry point and multiplayer orchestration.

- **Game state:** `gameState` holds `paused`, `gameOver`, `gameTime`, `totalKills`, `scene`, `world`, `camera`, `renderer`, `role` (host/guest), `currentWave`, `bossActive`, `bossHp`, `bossMaxHp`.
- **Initialization:** Sets up Rapier world, Three.js scene, camera, renderer, lights, ground plane, grid, arena walls, and colliders. Creates HUD, upgrade menu, and all managers (player, enemy, wave, weapon, projectile, XP, chest). Registers network message handlers.
- **Lobby:** Waits for `player_list` from server; when the host starts the game, freezes `_gamePlayerIndices` and spawns one player per index with color theme. Host runs `_animateHost`, guests run `_animateGuest`.
- **Host loop:** Gets local + remote inputs → `updatePlayer` for each → `updateCamera` → `updateWaveDirector` → `updateEnemies` → `updateWeapons` / `updateWeaponVisuals` → `updateProjectiles` → `updateEnemyProjectiles` → `updateXpGems` → `updateChests` / `updateBuffVisuals` → `updateParticles` → `updateHud` → `world.step()` → `_sendGameState()` at fixed interval. Handles level-up (upgrade menu, network sync) and game-over when all players are dead.
- **Guest loop:** Sends input at fixed cadence; on received state, buffers and syncs entity lifecycle (enemies, projectiles, gems, chests, weapon visuals); interpolates player/enemy/projectile/gem positions between two buffered states; updates camera, HUD, and render. No physics or game logic.
- **State sync:** Host serializes players, enemies, projectiles, enemy projectiles, gems (throttled), weapon visuals (throttled), chests, wave, boss, game time, kills, paused, game over. Guests clone state and interpolate with a ~60 ms delay to smooth jitter.
- **Spectator mode:** When the local player is dead, camera and HUD follow another alive player; A/D cycles target. Host and guest both support it.

---

## Core Components

### `src/player.js`

**Role:** Player entity: creation, movement, facing, animation, invincibility.

- **createPlayer(scene, world, config):** Builds player mesh (via `models.createPlayerModel`), kinematic Rapier body + collider, and player object with `hp`, `maxHp`, `speed`, `level`, `xp`, `armor`, `pickupRadius`, `invincibilityTimer`, `alive`, `facingAngle`, `weapons[]`, `buffs` (doubleProjectiles, speedBoost, glowingArmor), spawn config.
- **updatePlayer(playerObj, delta, arenaHalf, inputVec):** Moves mesh and body from input; clamps to arena; updates facing and walking animation; decrements invincibility. Speed is doubled when `buffs.speedBoost > 0`.
- **damagePlayer(playerObj, damage, knockback):** Applies armor reduction, subtracts HP, triggers screen shake and invincibility; sets `alive = false` if HP ≤ 0. Used by enemies and boss.
- **resetPlayer(playerObj):** Puts player back at spawn with full HP and resets animation.

---

### `src/models.js`

**Role:** Procedural 3D models for player and enemies; damage flash; animation helpers.

- **createPlayerModel(colorTheme):** Builds a low-poly “vampire hunter” (body, head, cape, etc.) with theme color; returns `{ group, anim }` for attachment and animation.
- **createEnemyModel(typeKey, size):** Builds type-specific enemy (bat, skeleton, zombie, imp, boss) with appropriate shapes and colors; returns `{ group, anim }`.
- **flashGroup / unflashGroup:** Traverse a group and set mesh colors to white (flash) or restore `userData.originalColor` (unflash). Used for damage feedback.
- **animatePlayerModel(anim, isMoving, time):** Drives walk/idle animation on the player’s `anim` parts.
- **animateEnemyModel(anim, typeKey, time, isMoving, ...):** Drives enemy animation (e.g. bat flap, boss attacks).
- **resetAnimParts(anim):** Restores stored default rotations on anim pivots (e.g. on respawn or pool reuse).

---

### `src/input.js`

**Role:** Keyboard input for movement and discrete actions.

- **getMovementVector():** Returns normalized `{ x, z }` from WASD / Arrow keys (no diagonal overflow).
- **isKeyDown(code):** True while key is held.
- **consumeKeyPress(code):** True once per key press, consumed on read (e.g. for spectator A/D).

---

### `src/camera.js`

**Role:** Top-down follow camera and screen shake.

- **updateCamera(camera, playerMesh, delta):** Moves camera toward `playerMesh.position + offset` with exponential smoothing; clamps per-frame movement to limit speed (reduces network jitter); applies screen shake when active; smooths lookAt target.
- **screenShake(intensity, duration):** Called from damage/impacts to trigger shake.
- **resetCamera():** Clears lookAt state for restart.

---

## Enemies & Waves

### `src/enemyManager.js`

**Role:** Enemy spawning, pooling, AI, damage, death, boss behavior, enemy projectiles.

- **ENEMY_TYPES:** Defines bat, skeleton, zombie, imp (ranged), boss (HP, speed, damage, xpValue, and for imp: stopDistance, shootCooldown, projectileSpeed, etc.).
- **BOSS_ATTACK_CONFIG:** Cone, rangedCircle, stomp attacks (charge duration, range, damage, color).
- **createEnemyManager(scene, world):** Stores scene/world for spawning.
- **spawnEnemy(type, x, z):** Gets or creates enemy from type pool; adds to `enemies` array; assigns sequential `id` for sync.
- **updateEnemies(delta, players):** For each enemy: AI (move toward nearest player; imps stop and shoot; boss runs charge-up attacks), collision vs players (damage + knockback with cooldown), flash on damage, death (spawn XP gem, particles, remove/pool). Steps enemy projectiles (spawn from imps/boss, move, hit players).
- **damageEnemy(enemy, amount):** Reduces HP; flash; on death: spawn XP, particles, screen shake, remove from list and pool.
- **getActiveBoss(), getActiveEnemyProjectiles():** Used by main and for serialization.
- **createBossIndicatorMesh(), etc.:** Boss attack telegraphs (cone, circle, stomp) in the scene.

---

### `src/waveDirector.js`

**Role:** Wave timing, difficulty scaling, spawn positions, boss waves.

- **createWaveDirector():** Resets spawn timer and wave number.
- **getCurrentWave():** Current wave index (derived from time).
- **onBossWave(callback):** Called when a boss wave starts (e.g. for UI).
- **updateWaveDirector(delta, players):** Advances wave by `gameTime` (e.g. 30 s per wave). Every 5th wave spawns a boss via `_spawnBossWave` and invokes callback. Spawn interval and enemy count scale with time (difficulty) and alive player count (multiplayer scale). Spawns regular waves at safe positions (min distance from all alive players) using `spawnEnemy` from enemyManager.

---

## Weapons & Projectiles

### `src/weaponManager.js`

**Role:** Per-player weapon set, cooldowns, and firing logic for all weapon types.

- **WEAPON_DEFS:** Registry of weapon definitions (magicWand, whip, garlic, holyWater); each has `name`, `description`, `getStats(level)` (damage, cooldown, area, etc.), `maxLevel`.
- **addWeapon(playerObj, weaponId):** Adds weapon to `playerObj.weapons` or levels it up if already present (max 6 slots).
- **levelUpWeapon(playerObj, weaponId):** Increments level up to def.maxLevel.
- **updateWeapons(delta, playerObj, enemiesList):** For each weapon, decrements cooldown; when ready, calls internal fire (magic wand, whip, garlic, holy water). Each fire uses `getStats(weapon.level)` and may call `fireProjectile` (projectiles.js) or spawn melee/area visuals.
- **updateWeaponVisuals(delta, enemiesList):** Updates active melee/area visuals (whip arcs, garlic auras, holy water pools); holy water ticks damage on enemies in radius; removes expired visuals.
- **getActiveVisualStates(players):** Returns serializable weapon visual state for host→guest sync.

Weapons in **`src/weapons/`** (e.g. `magicWand.js`, `whip.js`, `garlic.js`, `holyWater.js`) define stats and behavior; weaponManager imports them and drives firing and visuals.

---

### `src/projectiles.js`

**Role:** Player projectile lifecycle: spawn, move, collide with enemies, pierce, despawn.

- **createProjectileManager(scene, world):** Stores scene (world reserved for future use).
- **fireProjectile(opts):** Creates or reuses from pool; opts: position, direction, speed, damage, lifetime, pierce, color, size. Pushes to active list and assigns `id` for sync.
- **updateProjectiles(delta, enemiesList):** Moves projectiles; decrements lifetime; checks overlap with enemies (distXZ + radius); calls `damageEnemy`, records hit in `hitSet`, respects pierce count; removes when lifetime ≤ 0 or pierce exceeded.
- **getActiveProjectiles():** For host state serialization.

---

## Progression & Upgrades

### `src/xpManager.js`

**Role:** XP gems (spawn, bob, attract, collect), level thresholds, level-up callback.

- **GEM_TIERS:** Value bands → color and size (e.g. blue small, green, gold, purple boss).
- **getGemTierForValue(value):** Returns tier for visuals (host and guest).
- **createXpManager(scene):** Stores scene.
- **setLevelUpCallback(cb):** Called when a player’s XP crosses the next level threshold; main uses this to pause and show upgrade menu.
- **spawnXpGem(x, z, value):** Creates or reuses gem from pool; adds to list with `id`, `value`, `attracting`, `attractTarget`, bob phase.
- **updateXpGems(delta, players):** Bob and rotate; find nearest alive player within `pickupRadius`; if in range, set attracting and move gem toward that player at COLLECT_SPEED; when overlapping player, add XP, call level-up callback if threshold crossed, remove gem.
- **getXpForNextLevel(level):** XP required for next level (used by HUD).
- **getActiveGems():** For host state serialization.

---

### `src/upgradeMenu.js`

**Role:** Level-up screen: three random choices (new weapon, weapon level-up, passive), apply and sync.

- **PASSIVE_UPGRADES:** maxHp, speed, pickup radius, armor, heal; each has `id`, `name`, `description`, `apply(playerObj)`.
- **createUpgradeMenu():** Builds overlay DOM; hidden by default.
- **generateUpgradeChoices(playerObj):** Builds candidate list (new weapons if slot free, weapon level-ups, passives); shuffles and returns 3 choices.
- **showUpgradeMenuUI(playerObj, choices):** Displays overlay with three buttons; on click, calls `applyUpgradeChoice` and `hideUpgradeMenu`. In multiplayer, host sends choice to server so guests can show same UI or apply same choice.
- **applyUpgradeChoice(playerObj, choice):** Applies `newWeapon` / `levelWeapon` (via weaponManager) or `passive.apply(playerObj)`.
- **isUpgradeMenuOpen():** Used to pause simulation / block input.

---

## HUD & Feedback

### `src/hud.js`

**Role:** HTML overlay for all players’ HP, XP bar, timer, wave, kills, boss bar, buffs.

- **createHud(playerCount, hexColors):** Creates container with timer, wave, kill count; one HP bar per player (P1–P5 with color); XP bar and level for the local/camera target; boss HP bar (hidden when no boss); buff duration indicators.
- **updateHud(playerObj, players, gameState):** Updates all bars and labels from current player and game state (gameTime, currentWave, totalKills, bossHp/bossMaxHp, buffs). Can target “camera” player for XP (e.g. when spectating).

---

### `src/particles.js`

**Role:** Short-lived death/impact particles.

- **spawnDeathParticles(x, y, z, color):** Spawns a small set of boxes with random outward velocity and lifetime; used on enemy death and chest pickup.
- **updateParticles(delta):** Decrements lifetime, moves particles, removes and pools when dead.

---

## Chests & Buffs

### `src/chestManager.js`

**Role:** Chest spawning, pickup detection, buff application, buff timers, buff visuals.

- **BUFF_TYPES / BUFF_INFO:** doubleProjectiles, speedBoost, glowingArmor (name, color for UI and meshes).
- **createChestManager(scene):** Resets spawn timer and chest list.
- **updateChests(delta, players, gameTime):** Spawns chests at random arena positions on a timer (max 5); animates (float, rotate, glow); detects overlap with any alive player; on pickup applies buff (sets `player.buffs[buffType] = BUFF_DURATION`), spawns particles, returns pickup events for host to broadcast; ticks down all players’ buff timers.
- **updateBuffVisuals(players, gameTime):** Creates/updates per-player buff indicator meshes (e.g. rings under feet) based on `player.buffs` and duration.
- **createChestMesh(buffType):** Builds chest + glow/beacon meshes for a buff type.
- **getActiveChests():** For host state serialization.

---

## Network & Server

### `src/network.js`

**Role:** Client-side WebSocket connection and message API.

- **connect(hostIp):** Opens WebSocket to `ws://host:3001`; waits for server `role` message (host or guest) and `playerIndex`; resolves or rejects (e.g. timeout).
- **send(msg):** Sends JSON message to server (host→guests or guest→host depending on server routing).
- **onMessage(handler):** Registers handler for incoming messages (state, input, level_up, buff_pickup, game_over, player_list, etc.).
- **isHost() / isGuest() / getPlayerIndex():** Role and index for game logic.

---

### `server.js`

**Role:** WebSocket relay for up to 5 players; first connection = host, rest = guests.

- Listens on port 3001. On connect: assigns `role` and `playerIndex`, sends `{ type: "role", role, playerIndex }`, broadcasts `player_list`.
- Host messages are broadcast to all guests; guest messages are forwarded only to host. On host disconnect, guests get `peer_disconnect`. No game logic; only message relay.

---

## Utilities

### `src/utils.js`

**Role:** Shared helpers.

- **randomRange(min, max)** / **randomInt(min, max)** / **randomPick(arr):** RNG helpers.
- **clamp(value, min, max):** Clamps number.
- **distXZ(a, b):** Horizontal distance between two objects with `.position` (e.g. Three.js Vector3 or mesh).
- **shuffle(arr):** Fisher–Yates shuffle (e.g. for upgrade choices).
- **ObjectPool:** Generic pool (factory + reset) for reusing objects.
- **createSeededRandom(seed):** Seeded RNG (used where deterministic behavior is needed).

---

## Data Flow Summary

| System         | Host                                         | Guest                                           |
| -------------- | -------------------------------------------- | ----------------------------------------------- |
| Input          | Local + `_remoteInputs` from guests          | Sends `{ type: "input", pi, mx, mz }`           |
| Players        | Simulated; positions, HP, XP, level, buffs   | Interpolated from `state.pl`                    |
| Enemies        | Spawned by waveDirector; AI, damage, death   | Synced and interpolated from `state.en`         |
| Projectiles    | Fired by weaponManager; moved, hit detection | Interpolated from `state.pr`                    |
| Enemy proj     | Spawned by enemyManager; hit players         | Interpolated from `state.ep`                    |
| XP gems        | Spawned on kill; attracted, collected        | Synced/interpolated from `state.gm` (throttled) |
| Chests         | Spawned, pickup, buffs                       | Synced from `state.ch`                          |
| Weapon visuals | Created by weaponManager                     | Synced from `state.wv` (throttled)              |
| Level-up       | Host applies choice, sends to guests         | Receives and applies same choice                |
| Game over      | Detected when all dead; broadcast            | Shown when `state.go` received                  |

---

## File Reference

| File                   | Responsibility                                        |
| ---------------------- | ----------------------------------------------------- |
| `src/main.js`          | Init, game state, host/guest loops, state sync, UI    |
| `src/player.js`        | Player create/update/damage/reset                     |
| `src/models.js`        | Player & enemy 3D models, flash, animation            |
| `src/input.js`         | Keyboard movement and consumeKeyPress                 |
| `src/camera.js`        | Follow camera, screen shake                           |
| `src/enemyManager.js`  | Enemies: spawn, pool, AI, damage, death, boss, proj   |
| `src/waveDirector.js`  | Wave timing, difficulty, spawn positions, boss        |
| `src/weaponManager.js` | Weapon add/level, fire, visuals                       |
| `src/weapons/*.js`     | Per-weapon stats (magicWand, whip, garlic, holyWater) |
| `src/projectiles.js`   | Player projectiles: fire, move, hit, pool             |
| `src/xpManager.js`     | XP gems: spawn, attract, collect, level threshold     |
| `src/upgradeMenu.js`   | Level-up UI and passive/weapon apply                  |
| `src/hud.js`           | HP, XP, timer, wave, kills, boss bar, buffs           |
| `src/particles.js`     | Death/impact particles                                |
| `src/chestManager.js`  | Chests, buff apply, buff timers, buff visuals         |
| `src/network.js`       | WebSocket connect, send, onMessage                    |
| `src/utils.js`         | RNG, clamp, distXZ, shuffle, ObjectPool               |
| `server.js`            | WebSocket relay (host/guest, player list)             |

This should give a clear map of how the game works and which file to touch when changing behavior.
