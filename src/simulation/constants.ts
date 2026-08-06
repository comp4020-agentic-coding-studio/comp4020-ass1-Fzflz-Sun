import type {
  CarParams,
  SurfacePreset,
  ThrottleIntensityId,
  ThrottleIntensityPreset,
  ThrottleTimingId,
  ThrottleTimingPreset,
  TrackParams,
} from "./types.ts";

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
// baseline" corning input, and — since the redesign that replaced held
// steering with a fixed autosteer program — the *only* steering input the
// simulation ever produces (controlsAtElapsed, inputs.ts). It is calibrated
// together with TRACK_PARAMS.radius, wheelbaseHalf and ENTRY_SPEED (see
// maxSteerAngle's comment above) to track the reference line on a dry
// surface: the same target every run, ramped in from 0 over
// steerRampPerSecond, never held or adjusted by the visitor.
export const DRY_BASELINE_STEERING_FRACTION = 0.7;

// Seconds — the fixed duration of every run, from startRun to the "finished"
// phase. Calibrated as one scenario together with ENTRY_SPEED, the throttle
// timing thresholds below, and throttleRampPerSecond: long enough that a
// "late" throttle onset still has clear runway (thresholdSeconds + ~0.83s
// full-throttle ramp time) to show a saturation contrast against "early"
// before the run ends, short enough to stay a legible, watchable playback.
export const RUN_DURATION_SECONDS = 6;

// Discrete throttle-intensity choices, each a fixed fraction of
// maxEngineForce the run ramps toward once its timing threshold is reached.
// Same discipline as SURFACE_PRESETS: a documented teaching ordering
// (light/medium/full), not a claim about a real accelerator pedal.
export const THROTTLE_INTENSITY_PRESETS: Record<ThrottleIntensityId, ThrottleIntensityPreset> = {
  light: { id: "light", label: "Light", fraction: 0.4 },
  medium: { id: "medium", label: "Medium", fraction: 0.7 },
  full: { id: "full", label: "Full", fraction: 1.0 },
};

// Discrete throttle-timing choices: the elapsed run time at which throttle
// starts ramping in. This is the demonstrative piece of the redesign —
// lateral demand from cornering is highest right after corner entry (the car
// is still at ENTRY_SPEED) and eases as ROLLING_RESISTANCE_FORCE bleeds
// speed off a coasting car, so the same throttle intensity applied "early"
// stacks on peak lateral demand and saturates sooner than the identical
// intensity applied "late", once the car has coasted down and gained more
// lateral headroom. Calibrated together with RUN_DURATION_SECONDS and
// throttleRampPerSecond above: "late" still leaves ~1.5s of runway — more
// than the ~0.83s full-throttle ramp — for the contrast to be visible before
// the run ends.
export const THROTTLE_TIMING_PRESETS: Record<ThrottleTimingId, ThrottleTimingPreset> = {
  early: { id: "early", label: "Early", thresholdSeconds: 0 },
  mid: { id: "mid", label: "Mid", thresholdSeconds: 2.5 },
  late: { id: "late", label: "Late", thresholdSeconds: 4.5 },
};
