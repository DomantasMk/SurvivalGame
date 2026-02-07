// models.js — Procedural 3D character models for player and enemies

import * as THREE from "three";

// Low-poly sphere segments for performance
const LO = 6;

// ── Primitive helpers ───────────────────────────────────────────

function _box(parent, w, h, d, color, x, y, z, opts = {}) {
  const g = new THREE.BoxGeometry(w, h, d);
  const m = new THREE.MeshStandardMaterial({
    color,
    roughness: opts.roughness ?? 0.55,
    metalness: opts.metalness ?? 0.15,
    emissive: opts.emissive ?? 0x000000,
    emissiveIntensity: opts.emissiveIntensity ?? 0,
  });
  const mesh = new THREE.Mesh(g, m);
  mesh.position.set(x, y, z);
  if (opts.rx) mesh.rotation.x = opts.rx;
  if (opts.ry) mesh.rotation.y = opts.ry;
  if (opts.rz) mesh.rotation.z = opts.rz;
  mesh.castShadow = true;
  mesh.userData.originalColor = color;
  mesh.userData.flashable = opts.flashable !== false;
  parent.add(mesh);
  return mesh;
}

function _sphere(parent, r, color, x, y, z, opts = {}) {
  const g = new THREE.SphereGeometry(r, opts.seg ?? LO, opts.seg ?? LO);
  const m = new THREE.MeshStandardMaterial({
    color,
    roughness: opts.roughness ?? 0.55,
    metalness: opts.metalness ?? 0.15,
    emissive: opts.emissive ?? 0x000000,
    emissiveIntensity: opts.emissiveIntensity ?? 0,
  });
  const mesh = new THREE.Mesh(g, m);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.userData.originalColor = color;
  mesh.userData.flashable = opts.flashable !== false;
  parent.add(mesh);
  return mesh;
}

function _cone(parent, r, h, seg, color, x, y, z, opts = {}) {
  const g = new THREE.ConeGeometry(r, h, seg);
  const m = new THREE.MeshStandardMaterial({
    color,
    roughness: opts.roughness ?? 0.55,
    metalness: opts.metalness ?? 0.15,
    emissive: opts.emissive ?? 0x000000,
    emissiveIntensity: opts.emissiveIntensity ?? 0,
  });
  const mesh = new THREE.Mesh(g, m);
  mesh.position.set(x, y, z);
  if (opts.rx) mesh.rotation.x = opts.rx;
  if (opts.ry) mesh.rotation.y = opts.ry;
  if (opts.rz) mesh.rotation.z = opts.rz;
  mesh.castShadow = true;
  mesh.userData.originalColor = color;
  mesh.userData.flashable = opts.flashable !== false;
  parent.add(mesh);
  return mesh;
}

function _cyl(parent, rT, rB, h, seg, color, x, y, z, opts = {}) {
  const g = new THREE.CylinderGeometry(rT, rB, h, seg);
  const m = new THREE.MeshStandardMaterial({
    color,
    roughness: opts.roughness ?? 0.55,
    metalness: opts.metalness ?? 0.15,
    emissive: opts.emissive ?? 0x000000,
    emissiveIntensity: opts.emissiveIntensity ?? 0,
  });
  const mesh = new THREE.Mesh(g, m);
  mesh.position.set(x, y, z);
  if (opts.rx) mesh.rotation.x = opts.rx;
  if (opts.ry) mesh.rotation.y = opts.ry;
  if (opts.rz) mesh.rotation.z = opts.rz;
  mesh.castShadow = true;
  mesh.userData.originalColor = color;
  mesh.userData.flashable = opts.flashable !== false;
  parent.add(mesh);
  return mesh;
}

function _pivot(parent, x, y, z) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}

/** Store current rotation as the default (for animation reset) */
function _setDefaults(pivot) {
  pivot.userData.drx = pivot.rotation.x;
  pivot.userData.dry = pivot.rotation.y;
  pivot.userData.drz = pivot.rotation.z;
}

// ── Flash helpers (for damage flash on groups) ──────────────────

export function flashGroup(group) {
  group.traverse((child) => {
    if (child.isMesh && child.userData.flashable) {
      child.material.color.setHex(0xffffff);
    }
  });
}

export function unflashGroup(group) {
  group.traverse((child) => {
    if (
      child.isMesh &&
      child.userData.flashable &&
      child.userData.originalColor !== undefined
    ) {
      child.material.color.setHex(child.userData.originalColor);
    }
  });
}

/** Reset all anim pivot rotations to their stored defaults */
export function resetAnimParts(anim) {
  if (!anim) return;
  for (const key of Object.keys(anim)) {
    const part = anim[key];
    if (part && part.isObject3D) {
      part.rotation.x = part.userData.drx ?? 0;
      part.rotation.y = part.userData.dry ?? 0;
      part.rotation.z = part.userData.drz ?? 0;
    }
  }
}

// ── Player Model (Vampire Hunter) ──────────────────────────────

export function createPlayerModel(colorTheme = "blue") {
  const group = new THREE.Group();

  const SKIN = 0xffcc99;
  const EYES = 0x222244;
  const BELT_COL = 0x885533;

  // Color theme for Player 1 (blue) vs Player 2 (red)
  let OUTFIT, DARK, SCARF;
  if (colorTheme === "red") {
    OUTFIT = 0xff4444;
    DARK = 0xcc2222;
    SCARF = 0x4488ff;
  } else {
    OUTFIT = 0x4488ff;
    DARK = 0x2255cc;
    SCARF = 0xcc3333;
  }

  // Head
  _sphere(group, 0.11, SKIN, 0, 0.28, 0);
  // Eyes
  _sphere(group, 0.025, EYES, -0.045, 0.31, 0.085, { flashable: false });
  _sphere(group, 0.025, EYES, 0.045, 0.31, 0.085, { flashable: false });

  // Wizard hat
  _cyl(group, 0.16, 0.17, 0.025, 8, DARK, 0, 0.385, 0); // brim
  _cone(group, 0.09, 0.25, 6, DARK, 0, 0.535, 0); // pointed top

  // Scarf
  _box(group, 0.16, 0.04, 0.17, SCARF, 0, 0.18, 0);

  // Torso
  _box(group, 0.22, 0.22, 0.14, OUTFIT, 0, 0.04, 0);

  // Belt
  _box(group, 0.24, 0.03, 0.15, BELT_COL, 0, -0.08, 0);
  // Belt buckle
  _box(group, 0.04, 0.03, 0.02, 0xddaa44, 0, -0.08, 0.08, { metalness: 0.6 });

  // Cape (behind torso)
  const cape = _box(group, 0.2, 0.32, 0.025, DARK, 0, 0.02, -0.095);

  // Arms (with pivots for walk animation)
  const leftArmPivot = _pivot(group, -0.155, 0.12, 0);
  _box(leftArmPivot, 0.07, 0.2, 0.07, OUTFIT, 0, -0.1, 0);
  _sphere(leftArmPivot, 0.035, SKIN, 0, -0.22, 0); // hand
  _setDefaults(leftArmPivot);

  const rightArmPivot = _pivot(group, 0.155, 0.12, 0);
  _box(rightArmPivot, 0.07, 0.2, 0.07, OUTFIT, 0, -0.1, 0);
  _sphere(rightArmPivot, 0.035, SKIN, 0, -0.22, 0);
  _setDefaults(rightArmPivot);

  // Legs (with pivots for walk animation)
  const leftLegPivot = _pivot(group, -0.06, -0.1, 0);
  _box(leftLegPivot, 0.08, 0.2, 0.08, DARK, 0, -0.11, 0);
  _box(leftLegPivot, 0.09, 0.06, 0.11, BELT_COL, 0, -0.24, 0.01); // boot
  _setDefaults(leftLegPivot);

  const rightLegPivot = _pivot(group, 0.06, -0.1, 0);
  _box(rightLegPivot, 0.08, 0.2, 0.08, DARK, 0, -0.11, 0);
  _box(rightLegPivot, 0.09, 0.06, 0.11, BELT_COL, 0, -0.24, 0.01);
  _setDefaults(rightLegPivot);

  return {
    group,
    anim: { leftArmPivot, rightArmPivot, leftLegPivot, rightLegPivot, cape },
  };
}

// ── Bat Model ──────────────────────────────────────────────────

export function createBatModel(s) {
  const group = new THREE.Group();

  const BODY = 0xcc2244;
  const HEAD = 0xff4466;
  const WING = 0x661133;
  const EYE = 0xffff44;

  // Body
  _sphere(group, s * 0.3, BODY, 0, -s * 0.05, 0);

  // Head
  _sphere(group, s * 0.25, HEAD, 0, s * 0.3, 0);

  // Ears
  _cone(group, s * 0.07, s * 0.18, 4, HEAD, -s * 0.12, s * 0.5, 0);
  _cone(group, s * 0.07, s * 0.18, 4, HEAD, s * 0.12, s * 0.5, 0);

  // Eyes (glowing yellow)
  _sphere(group, s * 0.05, EYE, -s * 0.1, s * 0.35, s * 0.18, {
    flashable: false,
    emissive: 0xffff00,
    emissiveIntensity: 0.5,
  });
  _sphere(group, s * 0.05, EYE, s * 0.1, s * 0.35, s * 0.18, {
    flashable: false,
    emissive: 0xffff00,
    emissiveIntensity: 0.5,
  });

  // Fangs
  _cone(group, s * 0.02, s * 0.06, 3, 0xffffff, -s * 0.04, s * 0.18, s * 0.18, {
    rx: Math.PI,
  });
  _cone(group, s * 0.02, s * 0.06, 3, 0xffffff, s * 0.04, s * 0.18, s * 0.18, {
    rx: Math.PI,
  });

  // Wings (with pivots for flapping)
  const leftWingPivot = _pivot(group, -s * 0.22, 0, 0);
  _box(leftWingPivot, s * 0.5, s * 0.03, s * 0.38, WING, -s * 0.25, 0, 0);
  _setDefaults(leftWingPivot);

  const rightWingPivot = _pivot(group, s * 0.22, 0, 0);
  _box(rightWingPivot, s * 0.5, s * 0.03, s * 0.38, WING, s * 0.25, 0, 0);
  _setDefaults(rightWingPivot);

  return {
    group,
    anim: { leftWingPivot, rightWingPivot },
  };
}

// ── Skeleton Model ─────────────────────────────────────────────

export function createSkeletonModel(s) {
  const group = new THREE.Group();

  const BONE = 0xddd8cc;
  const DARK = 0x332211;

  // Skull
  _sphere(group, s * 0.22, BONE, 0, s * 0.53, 0);

  // Eye sockets (faint red glow)
  _sphere(group, s * 0.06, DARK, -s * 0.08, s * 0.56, s * 0.16, {
    flashable: false,
    emissive: 0xff0000,
    emissiveIntensity: 0.3,
  });
  _sphere(group, s * 0.06, DARK, s * 0.08, s * 0.56, s * 0.16, {
    flashable: false,
    emissive: 0xff0000,
    emissiveIntensity: 0.3,
  });

  // Jaw
  _box(group, s * 0.14, s * 0.06, s * 0.1, BONE, 0, s * 0.38, s * 0.04);

  // Spine
  _box(group, s * 0.06, s * 0.5, s * 0.06, BONE, 0, s * 0.05, 0);

  // Ribs (3 pairs)
  for (let i = 0; i < 3; i++) {
    const ry = s * (0.22 - i * 0.1);
    _box(group, s * 0.3, s * 0.03, s * 0.15, BONE, 0, ry, 0);
  }

  // Pelvis
  _box(group, s * 0.22, s * 0.06, s * 0.12, BONE, 0, s * -0.15, 0);

  // Arms (slightly outstretched)
  const leftArmPivot = _pivot(group, -s * 0.2, s * 0.22, 0);
  leftArmPivot.rotation.z = 0.3;
  _box(leftArmPivot, s * 0.05, s * 0.35, s * 0.05, BONE, 0, -s * 0.18, 0);
  _sphere(leftArmPivot, s * 0.04, BONE, 0, -s * 0.38, 0); // bony hand
  _setDefaults(leftArmPivot);

  const rightArmPivot = _pivot(group, s * 0.2, s * 0.22, 0);
  rightArmPivot.rotation.z = -0.3;
  _box(rightArmPivot, s * 0.05, s * 0.35, s * 0.05, BONE, 0, -s * 0.18, 0);
  _sphere(rightArmPivot, s * 0.04, BONE, 0, -s * 0.38, 0);
  _setDefaults(rightArmPivot);

  // Legs
  const leftLegPivot = _pivot(group, -s * 0.08, -s * 0.18, 0);
  _box(leftLegPivot, s * 0.06, s * 0.35, s * 0.06, BONE, 0, -s * 0.18, 0);
  _box(
    leftLegPivot,
    s * 0.08,
    s * 0.04,
    s * 0.12,
    BONE,
    0,
    -s * 0.38,
    s * 0.02,
  ); // foot
  _setDefaults(leftLegPivot);

  const rightLegPivot = _pivot(group, s * 0.08, -s * 0.18, 0);
  _box(rightLegPivot, s * 0.06, s * 0.35, s * 0.06, BONE, 0, -s * 0.18, 0);
  _box(
    rightLegPivot,
    s * 0.08,
    s * 0.04,
    s * 0.12,
    BONE,
    0,
    -s * 0.38,
    s * 0.02,
  );
  _setDefaults(rightLegPivot);

  return {
    group,
    anim: { leftArmPivot, rightArmPivot, leftLegPivot, rightLegPivot },
  };
}

// ── Zombie Model ───────────────────────────────────────────────

export function createZombieModel(s) {
  const group = new THREE.Group();

  const SKIN = 0x558844;
  const DARK_SKIN = 0x446633;
  const CLOTH = 0x555544;
  const EYE = 0xff2222;

  // Head (tilted forward — hunched posture)
  const headGroup = _pivot(group, 0, s * 0.45, s * 0.06);
  headGroup.rotation.x = 0.3;
  _sphere(headGroup, s * 0.2, SKIN, 0, 0, 0);
  // One glowing red eye
  _sphere(headGroup, s * 0.05, EYE, -s * 0.08, s * 0.04, s * 0.15, {
    flashable: false,
    emissive: 0xff0000,
    emissiveIntensity: 0.4,
  });
  // Other eye: dark empty socket
  _sphere(headGroup, s * 0.04, 0x222222, s * 0.08, s * 0.04, s * 0.15, {
    flashable: false,
  });
  // Open mouth
  _box(
    headGroup,
    s * 0.08,
    s * 0.04,
    s * 0.05,
    0x331111,
    0,
    -s * 0.1,
    s * 0.14,
    { flashable: false },
  );
  _setDefaults(headGroup);

  // Torso (slightly hunched forward)
  _box(group, s * 0.38, s * 0.35, s * 0.25, CLOTH, 0, s * 0.12, 0, {
    rx: 0.15,
  });

  // Tattered cloth detail
  _box(group, s * 0.4, s * 0.04, s * 0.26, DARK_SKIN, 0, s * -0.04, 0);

  // Arms (reaching forward — classic zombie pose)
  const leftArmPivot = _pivot(group, -s * 0.24, s * 0.2, 0);
  leftArmPivot.rotation.x = -0.8;
  leftArmPivot.rotation.z = 0.15;
  _box(leftArmPivot, s * 0.1, s * 0.35, s * 0.1, SKIN, 0, -s * 0.18, 0);
  _sphere(leftArmPivot, s * 0.05, DARK_SKIN, 0, -s * 0.38, 0);
  _setDefaults(leftArmPivot);

  const rightArmPivot = _pivot(group, s * 0.24, s * 0.2, 0);
  rightArmPivot.rotation.x = -0.6;
  rightArmPivot.rotation.z = -0.15;
  _box(rightArmPivot, s * 0.1, s * 0.35, s * 0.1, SKIN, 0, -s * 0.18, 0);
  _sphere(rightArmPivot, s * 0.05, DARK_SKIN, 0, -s * 0.38, 0);
  _setDefaults(rightArmPivot);

  // Legs
  const leftLegPivot = _pivot(group, -s * 0.1, -s * 0.1, 0);
  _box(leftLegPivot, s * 0.12, s * 0.35, s * 0.12, CLOTH, 0, -s * 0.18, 0);
  _box(
    leftLegPivot,
    s * 0.13,
    s * 0.05,
    s * 0.16,
    0x443322,
    0,
    -s * 0.38,
    s * 0.02,
  );
  _setDefaults(leftLegPivot);

  const rightLegPivot = _pivot(group, s * 0.1, -s * 0.1, 0);
  _box(rightLegPivot, s * 0.12, s * 0.35, s * 0.12, CLOTH, 0, -s * 0.18, 0);
  _box(
    rightLegPivot,
    s * 0.13,
    s * 0.05,
    s * 0.16,
    0x443322,
    0,
    -s * 0.38,
    s * 0.02,
  );
  _setDefaults(rightLegPivot);

  return {
    group,
    anim: {
      leftArmPivot,
      rightArmPivot,
      leftLegPivot,
      rightLegPivot,
      headGroup,
    },
  };
}

// ── Boss Model (Vampire Lord) ──────────────────────────────────

export function createBossModel(s) {
  const group = new THREE.Group();

  const BODY = 0x6600aa;
  const DARK = 0x440077;
  const SKIN = 0x9966cc;
  const HORN = 0x443333;
  const EYE = 0xff0000;
  const GOLD = 0xddaa33;
  const CAPE_COL = 0x220044;

  // Head
  _sphere(group, s * 0.2, SKIN, 0, s * 0.5, 0);

  // Horns
  _cone(group, s * 0.05, s * 0.22, 5, HORN, -s * 0.12, s * 0.65, 0, {
    rz: 0.3,
  });
  _cone(group, s * 0.05, s * 0.22, 5, HORN, s * 0.12, s * 0.65, 0, {
    rz: -0.3,
  });

  // Crown / circlet
  _cyl(group, s * 0.18, s * 0.18, s * 0.04, 6, GOLD, 0, s * 0.58, 0, {
    metalness: 0.7,
  });

  // Eyes (glowing red)
  _sphere(group, s * 0.05, EYE, -s * 0.08, s * 0.53, s * 0.15, {
    flashable: false,
    emissive: 0xff0000,
    emissiveIntensity: 0.8,
  });
  _sphere(group, s * 0.05, EYE, s * 0.08, s * 0.53, s * 0.15, {
    flashable: false,
    emissive: 0xff0000,
    emissiveIntensity: 0.8,
  });

  // Fangs
  _cone(group, s * 0.02, s * 0.07, 3, 0xffffff, -s * 0.04, s * 0.4, s * 0.14, {
    rx: Math.PI,
  });
  _cone(group, s * 0.02, s * 0.07, 3, 0xffffff, s * 0.04, s * 0.4, s * 0.14, {
    rx: Math.PI,
  });

  // Torso
  _box(group, s * 0.45, s * 0.4, s * 0.3, BODY, 0, s * 0.15, 0);

  // Shoulder pads
  _sphere(group, s * 0.1, DARK, -s * 0.28, s * 0.32, 0);
  _sphere(group, s * 0.1, DARK, s * 0.28, s * 0.32, 0);
  // Spikes on shoulders
  _cone(group, s * 0.03, s * 0.12, 4, HORN, -s * 0.28, s * 0.42, 0);
  _cone(group, s * 0.03, s * 0.12, 4, HORN, s * 0.28, s * 0.42, 0);

  // Belt
  _box(group, s * 0.47, s * 0.04, s * 0.31, GOLD, 0, s * -0.02, 0, {
    metalness: 0.6,
  });
  // Belt gem
  _sphere(group, s * 0.035, EYE, 0, s * -0.02, s * 0.16, {
    emissive: 0xff0000,
    emissiveIntensity: 0.5,
  });

  // Cape
  const cape = _box(
    group,
    s * 0.52,
    s * 0.65,
    s * 0.03,
    CAPE_COL,
    0,
    s * 0.05,
    -s * 0.17,
  );

  // Arms
  const leftArmPivot = _pivot(group, -s * 0.3, s * 0.22, 0);
  leftArmPivot.rotation.z = 0.2;
  _box(leftArmPivot, s * 0.12, s * 0.38, s * 0.12, BODY, 0, -s * 0.2, 0);
  _sphere(leftArmPivot, s * 0.07, SKIN, 0, -s * 0.42, 0); // fist
  // Claws
  for (let i = -1; i <= 1; i++) {
    _cone(
      leftArmPivot,
      s * 0.015,
      s * 0.06,
      3,
      0xdddddd,
      s * i * 0.025,
      -s * 0.48,
      s * 0.02,
      { rx: 0.3 },
    );
  }
  _setDefaults(leftArmPivot);

  const rightArmPivot = _pivot(group, s * 0.3, s * 0.22, 0);
  rightArmPivot.rotation.z = -0.2;
  _box(rightArmPivot, s * 0.12, s * 0.38, s * 0.12, BODY, 0, -s * 0.2, 0);
  _sphere(rightArmPivot, s * 0.07, SKIN, 0, -s * 0.42, 0);
  for (let i = -1; i <= 1; i++) {
    _cone(
      rightArmPivot,
      s * 0.015,
      s * 0.06,
      3,
      0xdddddd,
      s * i * 0.025,
      -s * 0.48,
      s * 0.02,
      { rx: 0.3 },
    );
  }
  _setDefaults(rightArmPivot);

  // Legs
  const leftLegPivot = _pivot(group, -s * 0.12, -s * 0.08, 0);
  _box(leftLegPivot, s * 0.14, s * 0.38, s * 0.14, DARK, 0, -s * 0.2, 0);
  _box(
    leftLegPivot,
    s * 0.16,
    s * 0.06,
    s * 0.2,
    0x332222,
    0,
    -s * 0.42,
    s * 0.02,
  );
  _setDefaults(leftLegPivot);

  const rightLegPivot = _pivot(group, s * 0.12, -s * 0.08, 0);
  _box(rightLegPivot, s * 0.14, s * 0.38, s * 0.14, DARK, 0, -s * 0.2, 0);
  _box(
    rightLegPivot,
    s * 0.16,
    s * 0.06,
    s * 0.2,
    0x332222,
    0,
    -s * 0.42,
    s * 0.02,
  );
  _setDefaults(rightLegPivot);

  return {
    group,
    anim: { leftArmPivot, rightArmPivot, leftLegPivot, rightLegPivot, cape },
  };
}

// ── Dispatcher ─────────────────────────────────────────────────

export function createEnemyModel(typeKey, size) {
  switch (typeKey) {
    case "bat":
      return createBatModel(size);
    case "skeleton":
      return createSkeletonModel(size);
    case "zombie":
      return createZombieModel(size);
    case "boss":
      return createBossModel(size);
    default:
      return createSkeletonModel(size);
  }
}

// ── Animation ──────────────────────────────────────────────────

export function animatePlayerModel(anim, moving, time) {
  if (!anim) return;

  if (moving) {
    const t = time * 8;
    const swing = Math.sin(t) * 0.5;
    anim.leftArmPivot.rotation.x = swing;
    anim.rightArmPivot.rotation.x = -swing;
    anim.leftLegPivot.rotation.x = -swing * 0.7;
    anim.rightLegPivot.rotation.x = swing * 0.7;
    anim.cape.rotation.x = Math.sin(t * 0.7) * 0.15 - 0.05;
  } else {
    // Smoothly return to idle
    anim.leftArmPivot.rotation.x *= 0.85;
    anim.rightArmPivot.rotation.x *= 0.85;
    anim.leftLegPivot.rotation.x *= 0.85;
    anim.rightLegPivot.rotation.x *= 0.85;
    anim.cape.rotation.x = Math.sin(time * 2) * 0.03;
  }
}

export function animateEnemyModel(typeName, anim, time) {
  if (!anim) return;

  switch (typeName) {
    case "Bat": {
      const flap = Math.sin(time * 14) * 0.7;
      anim.leftWingPivot.rotation.z = flap;
      anim.rightWingPivot.rotation.z = -flap;
      break;
    }
    case "Skeleton": {
      const t = time * 6;
      const walk = Math.sin(t) * 0.4;
      const drz_l = anim.leftArmPivot.userData.drz ?? 0;
      const drz_r = anim.rightArmPivot.userData.drz ?? 0;
      anim.leftArmPivot.rotation.x = walk;
      anim.rightArmPivot.rotation.x = -walk;
      anim.leftArmPivot.rotation.z = drz_l + Math.sin(t * 3.7) * 0.05;
      anim.rightArmPivot.rotation.z = drz_r + Math.sin(t * 4.1) * 0.05;
      anim.leftLegPivot.rotation.x = -walk * 0.7;
      anim.rightLegPivot.rotation.x = walk * 0.7;
      break;
    }
    case "Zombie": {
      const t = time * 3;
      const shamble = Math.sin(t) * 0.2;
      const la_drx = anim.leftArmPivot.userData.drx ?? 0;
      const ra_drx = anim.rightArmPivot.userData.drx ?? 0;
      const h_drx = anim.headGroup.userData.drx ?? 0;
      anim.leftArmPivot.rotation.x = la_drx + shamble;
      anim.rightArmPivot.rotation.x = ra_drx - shamble * 0.7;
      anim.leftLegPivot.rotation.x = shamble * 0.5;
      anim.rightLegPivot.rotation.x = -shamble * 0.5;
      anim.headGroup.rotation.x = h_drx + Math.sin(t * 0.7) * 0.08;
      anim.headGroup.rotation.z = Math.sin(t * 0.5) * 0.12;
      break;
    }
    case "Boss": {
      const t = time * 2.5;
      const swing = Math.sin(t) * 0.3;
      const drz_l = anim.leftArmPivot.userData.drz ?? 0;
      const drz_r = anim.rightArmPivot.userData.drz ?? 0;
      anim.leftArmPivot.rotation.x = swing - 0.15;
      anim.rightArmPivot.rotation.x = -swing - 0.15;
      anim.leftArmPivot.rotation.z = drz_l;
      anim.rightArmPivot.rotation.z = drz_r;
      anim.leftLegPivot.rotation.x = -swing * 0.3;
      anim.rightLegPivot.rotation.x = swing * 0.3;
      anim.cape.rotation.x = Math.sin(t * 1.5) * 0.1 - 0.05;
      anim.cape.rotation.y = Math.sin(t * 0.8) * 0.05;
      break;
    }
  }
}
