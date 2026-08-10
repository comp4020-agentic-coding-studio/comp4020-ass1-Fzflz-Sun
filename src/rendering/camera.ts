// Pure, DOM-free chase-camera easing math — deliberately separated from
// scene.ts (which owns the canvas transform) so the convergence bound quoted
// in CLAUDE.md's camera rule is a checkable unit-test claim, not just a felt
// property of watching the canvas.

function wrapAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

// Exponential-decay convergence toward `target`: after `t` seconds the
// remaining gap is `exp(-t / timeConstantSeconds)` of the original — after
// three time constants that's ~5% of the original gap left. This is the bound
// scene.ts and CLAUDE.md quote for how fast the chase camera catches up to a
// step change in its target. Frame-rate independent: the same total elapsed
// time converges to the same value regardless of how it was split across
// (variable-length) frames.
export function approach(current: number, target: number, dt: number, timeConstantSeconds: number): number {
  const alpha = 1 - Math.exp(-Math.max(dt, 0) / timeConstantSeconds);
  return current + (target - current) * alpha;
}

// Same convergence as `approach`, but for an angle (radians): moves across
// whichever side of the +/-pi seam is the shorter way around, so e.g.
// approaching from 179 degrees to -179 degrees eases across a 2-degree gap
// instead of spinning the long way around (358 degrees).
export function approachAngle(current: number, target: number, dt: number, timeConstantSeconds: number): number {
  const delta = wrapAngle(target - current);
  const alpha = 1 - Math.exp(-Math.max(dt, 0) / timeConstantSeconds);
  return current + delta * alpha;
}

export interface CameraPose {
  x: number;
  y: number;
  rotation: number;
}

// Seconds. Position and rotation share this time constant so the camera pans
// and yaws in sync rather than one visibly lagging the other. After 3x this
// (~150ms) the eased value is within ~5% of a step change in the target (see
// `approach`'s doc comment) — fast enough that a saturating axle's yaw
// divergence (which plays out over hundreds of milliseconds within a
// multi-second run, not a single frame) is never masked by the lag, slow
// enough to turn ordinary per-frame jitter into a stable, cinematic follow
// instead of a rigid instant-snap. This depends on the track presets'
// `expectedTraversalSeconds` (constants.ts) staying in the 5-9s range — a
// much shorter run would need a tighter time constant for the same "never
// masks saturation" guarantee to hold.
export const CAMERA_POSITION_TIME_CONSTANT_SECONDS = 0.05;
export const CAMERA_ROTATION_TIME_CONSTANT_SECONDS = 0.05;

// Advances the chase camera's eased position/rotation one frame toward
// `target`. When `easing` is false (reduced motion, not currently running, or
// a fresh run just teleported the car back to its track's start) this snaps
// directly to `target` instead — panning smoothly across a teleport would
// misrepresent an instantaneous event as continuous motion.
export function nextCameraPose(current: CameraPose, target: CameraPose, dt: number, easing: boolean): CameraPose {
  if (!easing) return { ...target };
  return {
    x: approach(current.x, target.x, dt, CAMERA_POSITION_TIME_CONSTANT_SECONDS),
    y: approach(current.y, target.y, dt, CAMERA_POSITION_TIME_CONSTANT_SECONDS),
    rotation: approachAngle(current.rotation, target.rotation, dt, CAMERA_ROTATION_TIME_CONSTANT_SECONDS),
  };
}

// Seconds. Deliberately slower than the position/rotation catch-up above —
// this is the one-off "run-start settle" flourish (a slightly pulled-back
// zoom that eases into the normal chase distance over the first ~450ms of a
// run), not a per-frame correction, so it can afford to be more leisurely
// without masking anything: nothing has had time to saturate in the first
// 450ms of any track preset's multi-second traversal.
export const CAMERA_ZOOM_SETTLE_TIME_CONSTANT_SECONDS = 0.15;

// Zoom factor (multiplies scene.ts's METERS_TO_PIXELS) the camera starts a
// fresh run at, before easing to 1 — a small pulled-back "settle" so a run's
// first frame doesn't look pixel-identical to a paused one, without being a
// distracting zoom effect.
export const RUN_START_ZOOM_FACTOR = 0.92;
