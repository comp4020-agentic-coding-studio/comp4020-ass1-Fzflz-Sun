// Pure domain types for the grip-budget simulation. No DOM, no Three.js —
// see CLAUDE.md's "GRIP IS A BUDGET" rules.

export type DrivetrainId = "FWD" | "RWD" | "AWD";
export type SurfaceId = "dry" | "wet" | "ice";
export type DrivingState = "stable" | "understeer" | "oversteer" | "slide";
/** Experiment lifecycle, separate from `DrivingState`'s handling
 * classification: "ready" is the inert state on load/Reset (stationary,
 * indefinitely, until the visitor explicitly starts a run); "running" is a
 * started run over which handling can be observed; "finished" is reached
 * once the car reaches the end of its selected track's swept arc, or — as a
 * backstop if it hasn't, e.g. it ran wide or got stuck on the barrier — once
 * it overruns the track's own no-slip ideal transit time by more than
 * `AUTO_FINISH_GRACE_SECONDS`, or, as a final absolute backstop,
 * `SAFETY_CAP_SECONDS` elapses (see `shouldFinish` in physics.ts), and holds
 * the settled final state until Run is pressed again. */
export type RunPhase = "ready" | "running" | "finished";

/** Discrete track/corner preset, chosen before a run and held fixed for its
 * whole duration — see `TRACK_PRESETS` (constants.ts). Sweep presets are a
 * broad, gentle corner; hairpin presets are a tighter, longer-swept corner
 * that demands more lateral force at the same speed — the second, free
 * demonstration of the shared grip-budget idea (identical drivetrain/
 * surface/throttle settings saturate sooner on a hairpin than on a sweep). */
export type TrackId = "sweep-left" | "sweep-right" | "hairpin-left" | "hairpin-right";

/** Discrete throttle-intensity setting, chosen before a run and held fixed
 * for its whole duration — see `THROTTLE_INTENSITY_PRESETS` (constants.ts). */
export type ThrottleIntensityId = "light" | "medium" | "full";

/** Discrete throttle-timing setting: when during the run throttle begins to
 * ramp in — see `THROTTLE_TIMING_PRESETS` (constants.ts). */
export type ThrottleTimingId = "early" | "mid" | "late";

/** The analog driving inputs for one simulation step: steering in [-1, 1]
 * (positive = left), throttle and brake in [0, 1]. Produced by
 * `controlsForState` as a pure function of the current simulation state and
 * the visitor's discrete settings — there is no held/real-time input. */
export interface ControlInputs {
  steering: number;
  throttle: number;
  brake: number;
}

/** One axle's grip-budget accounting for the current step. `fxDemand`/
 * `fyDemand` are what the driver's inputs ask for before any clamping;
 * `fx`/`fy` are what the tyres can actually deliver once clamped to the
 * friction circle. `utilisation` is computed from the *demand*, so it can
 * read above 1 — that overage is exactly what "saturated" means. */
export interface AxleState {
  fxDemand: number;
  fyDemand: number;
  fx: number;
  fy: number;
  limit: number;
  utilisation: number;
  saturated: boolean;
}

export interface SimState {
  /** World-frame position and heading (radians, CCW-positive from +x). */
  x: number;
  y: number;
  heading: number;
  /** Body-frame velocity: vx forward, vy leftward. */
  vx: number;
  vy: number;
  /** Yaw rate, radians/sec, CCW-positive. */
  yawRate: number;
  /** The control values applied on the most recent step — telemetry of the
   * current run's deterministic playback, not a setting a visitor changes
   * directly. */
  steering: number;
  throttle: number;
  brake: number;
  front: AxleState;
  rear: AxleState;
  /** Specific force felt in the body frame, in g. */
  longitudinalG: number;
  lateralG: number;
  /** Signed distance (m) from the reference arc: positive = running wide
   * (outside the corner), negative = tucked in toward the apex. */
  pathOffset: number;
  drivingState: DrivingState;
  drivetrain: DrivetrainId;
  surface: SurfaceId;
  /** Discrete pre-run settings — chosen before pressing Run, fixed for the
   * whole run, unaffected by `step()`. */
  throttleIntensity: ThrottleIntensityId;
  throttleTiming: ThrottleTimingId;
  /** Which track/corner preset this run uses — see `TrackId`/`TRACK_PRESETS`. */
  track: TrackId;
  /** Accumulated signed swept angle (radians) around the track's centre of
   * curvature since `startRun`, always increasing in magnitude in the
   * direction the corner bends. Compared against the selected track's
   * `sweepAngle` to decide when a run reaches `"finished"` — see
   * `shouldFinish` in physics.ts. Distinct from `heading`/`pathOffset`: this
   * tracks progress *around the corner*, not the car's own orientation or
   * lateral error. */
  sweptAngle: number;
  /** Simulated seconds since the last reset — never wall-clock time. */
  elapsed: number;
  /** See `RunPhase`. While "ready", `step` is a no-op: the car sits at rest
   * indefinitely until `startRun` begins a run. */
  phase: RunPhase;
}

export interface SurfacePreset {
  id: SurfaceId;
  label: string;
  /** Illustrative relative grip coefficient. Not a claim about any real
   * tyre/surface/temperature combination — see docs/model-assumptions.md. */
  mu: number;
}

export interface ThrottleIntensityPreset {
  id: ThrottleIntensityId;
  label: string;
  /** Fraction of `maxEngineForce` this intensity ramps toward. */
  fraction: number;
}

export interface ThrottleTimingPreset {
  id: ThrottleTimingId;
  label: string;
  /** Elapsed run time (seconds) at which throttle begins ramping toward the
   * selected intensity. Before this, throttle is exactly 0. */
  thresholdSeconds: number;
}

export interface CarParams {
  mass: number;
  /** Distance from CG to front axle and to rear axle (equal — symmetric
   * static load in this first version). */
  wheelbaseHalf: number;
  yawInertia: number;
  gravity: number;
  maxEngineForce: number;
  maxBrakeForce: number;
  /** Fraction of brake force sent to the front axle; documented, fixed. */
  brakeFrontShare: number;
  corneringStiffnessFront: number;
  corneringStiffnessRear: number;
  maxSteerAngle: number;
  steerRampPerSecond: number;
  throttleRampPerSecond: number;
  brakeRampPerSecond: number;
  minSpeedForSlip: number;
  maxSpeed: number;
}

export interface TrackParams {
  id: TrackId;
  label: string;
  /** Corner radius, metres. Always positive — `direction` says which way it
   * bends (see track.ts for the sign convention). */
  radius: number;
  /** Which way the corner bends. Left/right presets of the same sharpness
   * are exact mirror images: the friction/physics model has no
   * direction-dependent asymmetry, so mirroring is purely this sign flip on
   * `trackCentre`/`referenceCurvature`/the autosteer target, never
   * separately-tuned physics. */
  direction: "left" | "right";
  /** Total angle (radians) the track sweeps through from entry to the
   * finish line — what makes the track a finite, deliberately completed
   * segment rather than an open-ended arc. A run reaches `"finished"` once
   * `SimState.sweptAngle` reaches this value (see `shouldFinish`,
   * physics.ts). */
  sweepAngle: number;
  /** Fraction of `maxSteerAngle` the fixed autosteer program targets for
   * this track — calibrated so the car's kinematic steer angle matches this
   * track's own curvature at `ENTRY_SPEED`, the same
   * `atan(wheelbase/radius)/maxSteerAngle` discipline used for the original
   * single-track `DRY_BASELINE_STEERING_FRACTION` (see
   * docs/model-assumptions.md). Signed by `direction` in `inputs.ts`, not
   * here. */
  autosteerFraction: number;
  /** Documented estimate of how long a coasting (no-throttle), no-slip
   * traversal of this track takes at roughly `ENTRY_SPEED` — originally for
   * calibration reasoning only (docs/model-assumptions.md), and still
   * primarily that: the normal "finished" trigger stays position-based
   * (`sweptAngle` reaching `sweepAngle`). It is now also read at runtime by
   * `shouldFinish` (physics.ts) as the baseline for a tighter backstop —
   * `expectedTraversalSeconds + AUTO_FINISH_GRACE_SECONDS` — that
   * force-finishes a run which has run wide or stalled and stopped making
   * real position-based progress, well before the flat `SAFETY_CAP_SECONDS`
   * would. */
  expectedTraversalSeconds: number;
  /** Optional constant grade angle (radians, positive = uphill). When
   * present, `step()` (physics.ts) adds a single
   * `-mass * gravity * sin(gradeAngle)` term to the longitudinal force
   * balance — uphill opposes engine force, downhill adds to it. Normal
   * force and lateral grip capacity are left exactly as-is: this is
   * deliberately the smallest possible slope model, not suspension or
   * weight transfer (see CLAUDE.md). */
  gradeAngle?: number;
}
