import type { TrackParams } from "./types.ts";

// The corner: a constant-radius arc. The car always starts at the world
// origin heading along +x. Which way it bends is `track.direction`: a
// "right" track's centre of curvature sits at (0, -radius) — the vector
// from the start point to the centre points to the right of the initial
// heading (y is leftward), the correct centripetal direction for a
// right-hand turn — and a "left" track mirrors this exactly, centre at
// (0, +radius). Left/right presets of the same sharpness share every other
// number (radius, sweepAngle, autosteerFraction magnitude); only this sign
// differs, so mirroring never needs separately-tuned physics.
export function trackCentre(track: TrackParams): { cx: number; cy: number } {
  const sign = track.direction === "left" ? 1 : -1;
  return { cx: 0, cy: sign * track.radius };
}

/** Signed lateral distance (m) from the reference arc: positive = outside
 * the corner (running wide, the understeer direction), negative = inside
 * the corner (tucked toward the apex, the oversteer direction). Sign
 * convention is the same for either `direction` — "outside" always means
 * farther from the centre of curvature. */
export function pathOffset(x: number, y: number, track: TrackParams): number {
  const { cx, cy } = trackCentre(track);
  const distanceFromCentre = Math.hypot(x - cx, y - cy);
  return distanceFromCentre - track.radius;
}

/** Curvature of the reference line, signed to match the yaw-rate convention
 * used in physics.ts (positive = left turn). A "right" track bends right,
 * so this is negative; "left" mirrors it to positive. */
export function referenceCurvature(track: TrackParams): number {
  const sign = track.direction === "left" ? 1 : -1;
  return sign / track.radius;
}

/** Instantaneous rate (rad/s) at which the car is sweeping around the
 * track's centre of curvature, signed so it is positive for forward
 * progress in the track's own bend direction — the rate `SimState.sweptAngle`
 * (physics.ts) integrates every step to know how far around the corner the
 * car has come. `x`/`y` are the car's position *before* this step's
 * integration and `vxWorld`/`vyWorld` its world-frame velocity, matching the
 * explicit-Euler discipline `step()` uses for every other derivative.
 *
 * Derivation: for position vector r = (x - cx, y - cy) relative to the
 * centre, the standard CCW angular rate of r is
 * (r.x * vWorld.y - r.y * vWorld.x) / |r|^2. That rate is positive for a
 * "left" track's intended direction of travel and negative for "right"'s, so
 * flipping sign by `direction` turns it into "positive = making forward
 * progress around this specific corner", which is what a finish condition
 * comparing against a positive `sweepAngle` needs. */
export function sweptAngleRate(
  x: number,
  y: number,
  vxWorld: number,
  vyWorld: number,
  track: TrackParams,
): number {
  const { cx, cy } = trackCentre(track);
  const rx = x - cx;
  const ry = y - cy;
  const distanceSquared = rx * rx + ry * ry;
  if (distanceSquared === 0) return 0;
  const ccwRate = (rx * vyWorld - ry * vxWorld) / distanceSquared;
  const directionSign = track.direction === "left" ? 1 : -1;
  return directionSign * ccwRate;
}
