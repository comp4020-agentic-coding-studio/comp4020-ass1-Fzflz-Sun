import type { CarParams, SurfacePreset, TrackParams } from "./types.ts";

// Every number here is a documented teaching-model assumption, not a claim
// about a real vehicle. See docs/model-assumptions.md — keep the two in
// sync (CLAUDE.md).

/** Fixed simulation timestep, seconds. The renderer/UI may draw at any frame
 * rate; the physics always advances in steps of this size (accumulator
 * pattern in the caller), so results never depend on display refresh rate. */
export const FIXED_TIMESTEP = 1 / 120;

export const CAR_PARAMS: CarParams = {
  mass: 1200, // kg, roughly a compact car
  wheelbaseHalf: 1.3, // m; 2.6 m wheelbase split evenly front/rear
  yawInertia: 1900, // kg·m^2, typical order of magnitude for this mass/length
  gravity: 9.81,
  // N, full throttle drive force at the wheels. Tuned so full throttle alone
  // (no steering) sits well under the dry-surface axle limit — it's the
  // combination with cornering demand on the same axle that should tip a
  // saturation, not throttle by itself.
  maxEngineForce: 4200,
  maxBrakeForce: 9000, // N, full brake force at the wheels
  brakeFrontShare: 0.6, // fixed 60/40 front/rear brake bias — illustrative, not universal
  corneringStiffnessFront: 80000, // N/rad, linear tyre model, symmetric front/rear by default
  corneringStiffnessRear: 80000,
  // rad (~3.4°) "full steering lock" in this teaching model. This is not a
  // literal wheel angle: it is tuned so full-lock cornering alone consumes
  // most, but not all, of the dry-surface grip budget (leaving headroom for
  // drivetrain drive force to be the thing that tips an axle over), while
  // clearly saturating on the lower-grip surfaces. A larger angle demands
  // more lateral force than either axle's friction limit can supply the
  // instant it's applied, saturating both axles at once regardless of
  // drivetrain — collapsing the understeer/oversteer distinction into
  // "slide" for every scenario, which is what a first tuning pass at 0.5 rad
  // did.
  maxSteerAngle: 0.045,
  steerRampPerSecond: 2.5, // full lock reached in ~0.4s of held input
  throttleRampPerSecond: 1.2, // full throttle reached in ~0.83s of held input
  brakeRampPerSecond: 3.0, // full brake reached in ~0.33s of held input
  // m/s; the linear slip-angle model's effective stiffness scales as 1/vx, so
  // flooring vx too low here makes the fixed-step integration numerically
  // stiff (visible as an unstable spin blowing up within a few frames) well
  // before it's physically meaningful. 3 m/s keeps a comfortable stability
  // margin at FIXED_TIMESTEP without materially changing behaviour at the
  // cruising speeds this corner uses.
  minSpeedForSlip: 3,
  maxSpeed: 40, // m/s safety cap, well above anything this corner needs
};

export const TRACK_PARAMS: TrackParams = {
  radius: 45, // m — one broad, gentle corner
};

/** Illustrative relative grip presets. Real grip depends on tyre compound,
 * surface, temperature, water depth, ice thickness, load and setup — these
 * three numbers are a teaching ordering (high/medium/low), not measurements. */
export const SURFACE_PRESETS: Record<string, SurfacePreset> = {
  dry: { id: "dry", label: "Dry", mu: 1.0 },
  wet: { id: "wet", label: "Wet", mu: 0.7 },
  ice: { id: "ice", label: "Ice", mu: 0.3 },
};

export const INITIAL_SPEED = 15; // m/s (~54 km/h) — the car enters the corner already rolling
