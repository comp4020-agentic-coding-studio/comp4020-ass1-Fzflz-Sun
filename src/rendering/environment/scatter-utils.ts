import type { TrackParams } from "../../simulation/index.ts";

/** Tiny deterministic PRNG (mulberry32) — CLAUDE.md's "no Math.random() per
 * frame" simulation rule doesn't bind this purely-cosmetic rendering layer,
 * but the same discipline still applies here for a better reason: scenery
 * is scattered once per track selection, not every frame, so it must not
 * reshuffle itself on the next `update()` call. Seeding from the track's
 * own params (not a frame count or wall-clock time) means the same track
 * always gets the same scenery layout. */
export function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedForTrack(track: TrackParams): number {
  const directionBit = track.direction === "left" ? 1 : 0;
  return Math.round(track.radius * 1000 + track.sweepAngle * 10000) ^ directionBit;
}

/** Deterministic hash-based 2D value noise (bilinear interpolation between
 * hashed grid-corner values, smoothstepped) — used for ground vertex-colour
 * variation and cloud/mound placement. Pure function of (x, y, seed): no
 * `Math.random()`, no wall-clock input, so the same coordinates always
 * produce the same value across reloads/runs (CLAUDE.md's determinism
 * rule, applied to cosmetic geometry the same way `createRng` above applies
 * it to scatter placement). */
export function valueNoise2D(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const smooth = (t: number) => t * t * (3 - 2 * t);
  const u = smooth(xf);
  const v = smooth(yf);
  const hash = (hx: number, hy: number) => {
    const s = Math.sin(hx * 127.1 + hy * 311.7 + seed * 0.017) * 43758.5453;
    return s - Math.floor(s);
  };
  const a = hash(xi, yi);
  const b = hash(xi + 1, yi);
  const c = hash(xi, yi + 1);
  const d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Picks one weighted entry from a pool — generalised from the original
 * single-purpose `FIELD_ASSETS` picker so every scatter layer (trackside,
 * midground, distant) can reuse the same selection logic over its own pool
 * shape, rather than each layer reimplementing weighted choice. */
export function pickWeighted<T extends { weight: number }>(rng: () => number, pool: readonly T[]): T {
  const totalWeight = pool.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = rng() * totalWeight;
  for (const entry of pool) {
    roll -= entry.weight;
    if (roll <= 0) return entry;
  }
  return pool[pool.length - 1];
}
