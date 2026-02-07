// input.js — Keyboard input state (WASD / Arrow keys)

const keys = {};

window.addEventListener("keydown", (e) => {
  keys[e.code] = true;
});

window.addEventListener("keyup", (e) => {
  keys[e.code] = false;
});

const _vec = { x: 0, z: 0 };

/**
 * Returns a normalized {x, z} movement direction based on currently held keys.
 */
export function getMovementVector() {
  _vec.x = 0;
  _vec.z = 0;

  if (keys["KeyW"] || keys["ArrowUp"]) _vec.z -= 1;
  if (keys["KeyS"] || keys["ArrowDown"]) _vec.z += 1;
  if (keys["KeyA"] || keys["ArrowLeft"]) _vec.x -= 1;
  if (keys["KeyD"] || keys["ArrowRight"]) _vec.x += 1;

  // Normalize diagonal movement
  const len = Math.sqrt(_vec.x * _vec.x + _vec.z * _vec.z);
  if (len > 0) {
    _vec.x /= len;
    _vec.z /= len;
  }

  return _vec;
}

export function isKeyDown(code) {
  return !!keys[code];
}
