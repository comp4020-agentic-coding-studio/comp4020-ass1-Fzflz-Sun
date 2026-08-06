import type { TrackParams } from "./types.ts";

// The one corner: a constant-radius arc. The car starts at the world origin
// heading along +x; the corner bends to the right (clockwise seen from
// above), so its centre of curvature sits at (0, -radius) — the vector from
// the start point to the centre, (0, -radius), points to the right of the
// initial heading, which is the correct centripetal direction for a
// right-hand turn. "Steer right" is therefore the input that follows this
// corner; "steer left" pulls away from it. Either way, steering spends
// lateral grip — which direction the road bends is not the point.
export function trackCentre(track: TrackParams): { cx: number; cy: number } {
  return { cx: 0, cy: -track.radius };
}

/** Signed lateral distance (m) from the reference arc: positive = outside
 * the corner (running wide, the understeer direction), negative = inside
 * the corner (tucked toward the apex, the oversteer direction). */
export function pathOffset(x: number, y: number, track: TrackParams): number {
  const { cx, cy } = trackCentre(track);
  const distanceFromCentre = Math.hypot(x - cx, y - cy);
  return distanceFromCentre - track.radius;
}

/** Curvature of the reference line, signed to match the yaw-rate convention
 * used in physics.ts (positive = left turn). The corner bends right, so this
 * is negative. */
export function referenceCurvature(track: TrackParams): number {
  return -1 / track.radius;
}
