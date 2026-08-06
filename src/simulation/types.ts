// Pure domain types for the grip-budget simulation. No DOM, no Three.js —
// see CLAUDE.md's "GRIP IS A BUDGET" rules.

export type DrivetrainId = "FWD" | "RWD" | "AWD";
export type SurfaceId = "dry" | "wet" | "ice";
export type DrivingState = "stable" | "understeer" | "oversteer" | "slide";
/** Experiment lifecycle, separate from `DrivingState`'s handling
 * classification: "ready" is the inert state on load/Reset (stationary,
 * indefinitely, until the visitor explicitly starts a run); "running" is a
 * started run over which handling can be observed; "finished" is reached
 * once the run's fixed duration (`RUN_DURATION_SECONDS`) elapses, and holds
 * the settled final state until Run is pressed again. */
export type RunPhase = "ready" | "running" | "finished";

/** Discrete throttle-intensity setting, chosen before a run and held fixed
 * for its whole duration — see `THROTTLE_INTENSITY_PRESETS` (constants.ts). */
export type ThrottleIntensityId = "light" | "medium" | "full";

/** Discrete throttle-timing setting: when during the run throttle begins to
 * ramp in — see `THROTTLE_TIMING_PRESETS` (constants.ts). */
export type ThrottleTimingId = "early" | "mid" | "late";

/** The analog driving inputs for one simulation step: steering in [-1, 1]
 * (positive = left), throttle and brake in [0, 1]. Produced by
 * `controlsAtElapsed` as a pure function of elapsed run time and the
 * visitor's discrete settings — there is no held/real-time input. */
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
  /** Corner radius, metres. Positive; the corner always bends the same way
   * (see track.ts for the sign convention). */
  radius: number;
}
