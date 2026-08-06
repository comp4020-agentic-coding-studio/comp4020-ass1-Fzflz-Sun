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
  // rad (~4.3°) "full steering lock" in this teaching model. This is not a
  // literal wheel angle: it is calibrated together with TRACK_PARAMS.radius,
  // wheelbaseHalf and ENTRY_SPEED as one scenario, not a standalone tuning
  // knob. A 2.6 m wheelbase following a 45 m-radius corner needs roughly
  // atan(2.6/45) ≈ 0.058 rad of kinematic steer angle just to match the
  // road's curvature; DRY_BASELINE_STEERING_FRACTION (physics.ts) of this
  // value is calibrated to land close to that requirement, so the documented
  // dry baseline (~70% steering) tracks the reference line, full lock tightens
  // the line further, and there is still headroom below full lock before the
  // front axle's lateral capacity is exhausted. The previous value (0.045 rad)
  // was geometrically incapable of reaching the required curvature at any
  // steering fraction — the corner would always be run wide regardless of
  // input, which is exactly the bug this recalibration fixes.
  maxSteerAngle: 0.08,
  steerRampPerSecond: 2.5, // full lock reached in ~0.4s of held input
  throttleRampPerSecond: 1.2, // full throttle reached in ~0.83s of held input
  brakeRampPerSecond: 3.0, // full brake reached in ~0.33s of held input
  // m/s; protects only the atan2 slip-angle denominator from blowing up
  // numerically at very low speed (see the alphaFront/alphaRear computation
  // in physics.ts). Must never be used to gate whether braking force is
  // applied — braking, rolling resistance and the low-speed lateral-force
  // fade all use the car's *actual* vx, never this floored value.
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

// m/s (~43 km/h) — the speed a run starts at once the driver presses "Enter
// the corner" (physics.ts's startRun). Calibrated together with the track
// radius and maxSteerAngle above: fast enough that the corner is a real
// driving problem, slow enough that the dry baseline's required lateral
// force stays under each axle's friction-circle limit (so steering alone
// doesn't saturate an axle before throttle or a low-grip surface does).
export const ENTRY_SPEED = 12;

// N — a modest constant rolling-resistance force, always opposing the car's
// current direction of travel while it's moving, independent of the brake
// pedal and of minSpeedForSlip. Without this, a coasting car (zero throttle,
// zero brake) never decelerates at all: vxDot has no term that opposes motion
// unless the driver brakes, so releasing every pedal left the car cruising
// forever at whatever speed it last reached.
export const ROLLING_RESISTANCE_FORCE = 400;

// m/s — below this forward speed, lateral tyre force is scaled down toward
// zero (physics.ts's lateralForceFade), independent of minSpeedForSlip. Fixes
// steering-while-stationary producing phantom lateral force: at vx = 0, the
// slip-angle floor (minSpeedForSlip) still leaves alpha equal to the raw
// steer angle, which without this fade would create real cornering force on
// a car that isn't rolling.
export const LOW_SPEED_FADE_SPEED = 1.0;

// m/s — once |vx| drops under this while braking with no throttle applied,
// the integration snaps vx (and vy, yawRate) to exactly zero instead of
// asymptotically approaching it. A real brake can hold a stopped car at
// exactly zero; the alternative (pure force integration) only ever
// approaches zero in the limit and can overshoot into reverse in one large
// timestep, which is what the un-clamped version of this fix would do.
export const AT_REST_SPEED = 0.05;

// Fraction of maxSteerAngle that is this teaching model's "documented dry
// baseline" corning input — the one input used by the red behavioural tests
// (src/simulation/behaviour.test.ts) and referenced in spec/brief.md as the
// steering effort that should track the reference line on a dry surface at
// ENTRY_SPEED, with full lock available to tighten the line further beyond
// it. Not a UI default — the driver can still steer anywhere in [-1, 1].
export const DRY_BASELINE_STEERING_FRACTION = 0.7;
