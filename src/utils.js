// utils.js — Shared helpers (object pooling, random range, etc.)

/**
 * Returns a random float between min (inclusive) and max (exclusive).
 */
export function randomRange(min, max) {
  return Math.random() * (max - min) + min;
}

/**
 * Returns a random integer between min (inclusive) and max (inclusive).
 */
export function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Picks a random element from an array.
 */
export function randomPick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Clamp a value between min and max.
 */
export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Simple generic object pool.
 */
export class ObjectPool {
  constructor(factory, reset, initialSize = 0) {
    this._factory = factory;
    this._reset = reset;
    this._pool = [];
    for (let i = 0; i < initialSize; i++) {
      this._pool.push(this._factory());
    }
  }

  get() {
    if (this._pool.length > 0) {
      const obj = this._pool.pop();
      this._reset(obj);
      return obj;
    }
    return this._factory();
  }

  release(obj) {
    this._pool.push(obj);
  }

  get availableCount() {
    return this._pool.length;
  }
}

/**
 * Distance between two objects with x,z positions (ignoring y).
 */
export function distXZ(a, b) {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}

/**
 * Shuffle an array in-place (Fisher-Yates).
 */
export function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
