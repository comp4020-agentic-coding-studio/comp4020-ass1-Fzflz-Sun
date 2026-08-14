import type {
  CarParams,
  SurfacePreset,
  ThrottleIntensityId,
  ThrottleIntensityPreset,
  ThrottleTimingId,
  ThrottleTimingPreset,
  TrackId,
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
  // literal wheel angle: it is calibrated together with each TRACK_PRESETS
  // entry's radius, wheelbaseHalf and ENTRY_SPEED as one scenario, not a
  // standalone tuning knob — every track preset's own autosteerFraction is
  // derived from this same fixed value via
  // atan(wheelbase/radius)/maxSteerAngle (see TRACK_PRESETS below and
  // docs/model-assumptions.md), left UNCHANGED across all four presets so
  // none of the hand-built saturation fixtures in physics.test.ts (which
  // apply steering as a raw fraction of this angle directly, without going
  // through a track) shift underneath them. A 2.6 m wheelbase following the
  // default 45 m-radius sweep needs roughly atan(2.6/45) ≈ 0.058 rad of
  // kinematic steer angle just to match the road's curvature;
  // DRY_BASELINE_STEERING_FRACTION of this value lands close to that
  // requirement, so the documented dry baseline (~70% steering) tracks the
  // reference line, full lock tightens the line further, and there is still
  // headroom below full lock before the front axle's lateral capacity is
  // exhausted. The previous value (0.045 rad) was geometrically incapable of
  // reaching the required curvature at any steering fraction — the corner
  // was always run wide regardless of input, which is exactly the bug this
  // recalibration fixes.
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

// Fraction of maxSteerAngle that is this teaching model's "documented dry
// baseline" cornering input — the default "sweep-right" track's
// autosteerFraction below reproduces this exact value, and physics.test.ts's
// hand-built ControlInputs fixtures (HARD_RIGHT_FULL_THROTTLE, STEER_ONLY)
// still reference this constant directly, bypassing track calibration
// entirely since they call step()/drive() without going through
// controlsForState. Calibrated together with the default track's radius,
// wheelbaseHalf and ENTRY_SPEED (see maxSteerAngle's comment above) to track
// the reference line on a dry surface.
export const DRY_BASELINE_STEERING_FRACTION = 0.7;

// Closed-loop steering correction gains (inputs.ts's controlsForState). The
// steering law is feedforward (DRY_BASELINE_STEERING_FRACTION-style
// autosteerFraction, unchanged) plus a cross-track term (this gain times
// pathOffset) plus a heading term (this gain times heading error) — a
// deliberate, user-directed exception to "steering never reacts to the car's
// actual state" (see docs/model-assumptions.md and CLAUDE.md). Units: /m and
// /rad respectively, since the sum is a steering fraction in [-1, 1] like
// autosteerFraction. Starting values only — hand-tune while driving so the
// correction visibly helps the car track the line without fully masking the
// understeer/oversteer/slide saturation states the rest of this model exists
// to teach (too high a gain corrects saturation away instead of showing it).
export const CROSS_TRACK_GAIN = 0.08; // per metre of pathOffset
export const HEADING_GAIN = 1.5; // per radian of heading error

// Default track when a run/test doesn't pick one explicitly — reproduces the
// original single-track prototype's exact geometry and autosteer target
// (radius 45m, DRY_BASELINE_STEERING_FRACTION), so nothing that predates the
// track picker changes behaviour.
export const DEFAULT_TRACK_ID: TrackId = "sweep-right";

// Four discrete track/corner presets, same Record-of-documented-presets
// discipline as SURFACE_PRESETS/THROTTLE_INTENSITY_PRESETS. Left/right of the
// same sharpness are exact mirror images (only `direction` differs) — the
// friction/physics model has no direction-dependent asymmetry, so mirroring
// never needs separately-tuned physics (see track.ts).
//
// Each preset's `autosteerFraction` is calibrated the same way the original
// single track's DRY_BASELINE_STEERING_FRACTION was: a 2.6m wheelbase
// (2 * CAR_PARAMS.wheelbaseHalf) needs atan(wheelbase/radius) rad of
// kinematic steer angle to match this track's own curvature, expressed as a
// fraction of maxSteerAngle=0.08. maxSteerAngle itself is left unchanged
// across every preset (see its comment above), so a tighter track is
// expressed entirely as "more of the same fixed steering budget", not a
// different steering ceiling per track.
//
// `sweepAngle` is what makes a track a finite, deliberately completed
// segment (see shouldFinish, physics.ts) instead of the old unbounded arc —
// sized, together with radius, so the documented ENTRY_SPEED brings the car
// to the end of the arc in a legible few seconds (expectedTraversalSeconds
// is the coasting estimate used for that sizing, not the finish trigger
// itself).
export const TRACK_PRESETS: Record<TrackId, TrackParams> = {
  "sweep-right": {
    id: "sweep-right",
    label: "Sweep (right)",
    radius: 45,
    direction: "right",
    sweepAngle: Math.PI / 2, // 90°
    autosteerFraction: DRY_BASELINE_STEERING_FRACTION,
    expectedTraversalSeconds: 5.9,
  },
  "sweep-left": {
    id: "sweep-left",
    label: "Sweep (left)",
    radius: 45,
    direction: "left",
    sweepAngle: Math.PI / 2,
    autosteerFraction: DRY_BASELINE_STEERING_FRACTION,
    expectedTraversalSeconds: 5.9,
  },
  "hairpin-right": {
    id: "hairpin-right",
    label: "Hairpin (right)",
    // Tighter than the sweep — atan(2.6/40) ≈ 0.0649 rad, i.e. ≈81% of
    // maxSteerAngle just to hold this line, versus the sweep's ≈70%. At
    // identical drivetrain/surface/throttle settings this leaves noticeably
    // less front-axle headroom before saturation: v²/r lateral demand is
    // ~12.5% higher than the sweep at the same speed, on top of a steering
    // input that alone already uses more of the fixed steering budget.
    radius: 40,
    direction: "right",
    sweepAngle: (5 * Math.PI) / 6, // 150° — reads as a tight, sustained U-turn
    autosteerFraction: 0.81,
    expectedTraversalSeconds: 8.7,
  },
  "hairpin-left": {
    id: "hairpin-left",
    label: "Hairpin (left)",
    radius: 40,
    direction: "left",
    sweepAngle: (5 * Math.PI) / 6,
    autosteerFraction: 0.81,
    expectedTraversalSeconds: 8.7,
  },
};

// Road/kerb/barrier geometry, in metres, relative to each TRACK_PRESETS
// entry's own radius. Lives here (not src/rendering/track-geometry.ts) so
// physics.ts's outer-track collision boundary below and the renderer's road/
// kerb/barrier placement (track-geometry.ts, environment.ts) share one
// source of truth instead of two independently-drifting copies — simulation
// never imports from rendering, so this has to be the shared side.
export const ROAD_HALF_WIDTH = 7; // m, matches the previous 2D scene's road width
export const KERB_WIDTH_METERS = 1.2;
// Gap between the outer kerb edge and the barrier's own centreline
// (environment.ts's barrierRadius placement formula) — purely a rendering
// spacing choice, but the collision boundary below needs it too.
export const BARRIER_KERB_GAP_METERS = 0.6;

// sedan.glb's own raw half-width along its local X axis, measured directly
// (vehicle.ts's DEV-only bbox diagnostic: fitted half-width came back as
// 1.4772727...m at the current VEHICLE_SCALE, i.e. exactly 0.75m before that
// scale is applied) — kept in sync BY HAND with scene-scale.ts's
// VEHICLE_SCALE derivation (same discipline as BARRIER_HALF_THICKNESS_METERS
// below; physics must not depend on an asynchronously-loaded glTF's measured
// size, so this can't just import scene-scale.ts). The `1.32` below is
// SEDAN_RAW_WHEELBASE_METERS (scene-scale.ts) — duplicated here for the same
// reason. Previously a hand-picked "real-world half-width" of 0.9m that did
// not match the actual rendered car (which is ~1.48m half-width once scaled
// up to this model's 2.6m wheelbase): that mismatch let the car's visible
// mesh poke past the barrier's inner face even while the physics-level
// collision boundary looked satisfied — a real, reported bug, not a
// hypothetical one.
const SEDAN_RAW_HALF_WIDTH_METERS = 0.75;
export const CAR_HALF_WIDTH_METERS = SEDAN_RAW_HALF_WIDTH_METERS * ((2 * CAR_PARAMS.wheelbaseHalf) / 1.32);

// Half of the barrier asset's own fitted thickness (its local Z axis) —
// must stay in sync BY HAND with BARRIER_FALLBACK_SIZE.z (currently 0.84) in
// src/rendering/environment.ts. The real fitted size is only known
// asynchronously once that asset's glTF loads, but step() below must stay
// synchronous, so this is a plain documented constant rather than an import
// from the renderer (same "kept in sync by comment" discipline as
// FRONT_COLOR/REAR_COLOR between main.css and materials.ts). Cross-checked
// directly against environment.ts's own DEV diagnostic this figure is meant
// to track: the barrier's actual fitted Z came back as 0.84375m (half
// 0.421875m) — within 2mm of this constant, i.e. not the source of any
// reported clipping (see CAR_HALF_WIDTH_METERS above, which was).
export const BARRIER_HALF_THICKNESS_METERS = 0.42;

// The pathOffset (see track.ts) of the barrier's inner, collision-relevant
// face — i.e. how far beyond a track's own `radius` the barrier's solid
// surface actually sits. physics.ts's step() clamps the car so that
// `pathOffset + CAR_HALF_WIDTH_METERS` never exceeds this, which keeps the
// car's own body from passing through the barrier's visible model without
// needing simulation to know anything about Three.js meshes.
export const BARRIER_COLLISION_LIMIT_METERS =
  ROAD_HALF_WIDTH + KERB_WIDTH_METERS + BARRIER_KERB_GAP_METERS - BARRIER_HALF_THICKNESS_METERS;

// Outer-barrier collision *response* (see step(), physics.ts): a genuine
// reaction-force rebound, not merely "stop dead at the wall". On impact the
// car bounces back off the collision normal at this fraction of its impact
// (normal) speed, and its along-the-wall "scrape" speed is bled off by an
// amount that scales with the current surface's own grip
// (SURFACE_PRESETS[state.surface].mu) — a grippier (dry) surface bites and
// sheds more of that sliding speed on impact than an icy one, same
// friction-is-relative spirit as the rest of this model. Both starting
// values, same "hand-tune while driving" status as CROSS_TRACK_GAIN/
// HEADING_GAIN above — and a deliberate, user-directed departure from a
// pure inelastic "zero the outward velocity" clamp, which is what this used
// to be.
export const BARRIER_RESTITUTION = 0.35; // fraction of impact normal-speed that rebounds back off the wall
export const BARRIER_IMPACT_FRICTION_FACTOR = 0.5; // scales how much of the along-wall scrape speed mu sheds on impact

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

// Seconds — a generous backstop duration that force-finishes a run
// regardless of position, so a pathological settings combination (e.g. a
// stalled car on ice that never reaches the end of its track's swept arc)
// can't leave a run stuck in "running" forever. This is a safety net, NOT
// the primary finish trigger: `shouldFinish` (physics.ts) normally finishes
// a run once `SimState.sweptAngle` reaches the selected track's
// `sweepAngle` — see each TRACK_PRESETS entry's `expectedTraversalSeconds`
// for the actual, much-shorter, expected wall-clock length of a run. Sized
// comfortably above the slowest realistic traversal (hairpin,
// ~8.7s expected) so it is never the thing a normal run hits.
export const SAFETY_CAP_SECONDS = 20;

// Seconds of slack allowed above a track's own `expectedTraversalSeconds`
// (its no-slip ideal transit time around the arc at ENTRY_SPEED) before
// `shouldFinish` (physics.ts) force-finishes the run even though it hasn't
// reached the end of the track's geometry. This is the practical backstop
// for a car that has run wide, bounced off the barrier, or otherwise
// stopped making real progress toward the finish — much tighter and more
// responsive per-track than the flat `SAFETY_CAP_SECONDS` above, which
// stays in place only as a final, track-independent backstop (comfortably
// larger than `expectedTraversalSeconds + AUTO_FINISH_GRACE_SECONDS` for
// every preset, so it should never actually be the thing that fires).
export const AUTO_FINISH_GRACE_SECONDS = 0;

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
// lateral headroom. Calibrated together with every TRACK_PRESETS entry's
// `expectedTraversalSeconds` and throttleRampPerSecond above: "late" still
// leaves at least ~1.5s of runway — more than the ~0.83s full-throttle ramp
// — before even the shortest track (the sweep, ~5.9s) finishes, so the
// contrast is visible on every preset, not just the longer hairpin.
export const THROTTLE_TIMING_PRESETS: Record<ThrottleTimingId, ThrottleTimingPreset> = {
  early: { id: "early", label: "Early", thresholdSeconds: 0 },
  mid: { id: "mid", label: "Mid", thresholdSeconds: 2.5 },
  late: { id: "late", label: "Late", thresholdSeconds: 4.5 },
};
