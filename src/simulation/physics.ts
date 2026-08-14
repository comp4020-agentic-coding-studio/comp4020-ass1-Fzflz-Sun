import {
  AT_REST_SPEED,
  AUTO_FINISH_GRACE_SECONDS,
  BARRIER_COLLISION_LIMIT_METERS,
  BARRIER_IMPACT_FRICTION_FACTOR,
  BARRIER_RESTITUTION,
  CAR_HALF_WIDTH_METERS,
  CAR_PARAMS,
  DEFAULT_TRACK_ID,
  ENTRY_SPEED,
  LOW_SPEED_FADE_SPEED,
  ROLLING_RESISTANCE_FORCE,
  SAFETY_CAP_SECONDS,
  SURFACE_PRESETS,
  TRACK_PRESETS,
} from "./constants.ts";
import { pathOffset, sweptAngleRate, trackCentre } from "./track.ts";
import type {
  AxleState,
  CarParams,
  ControlInputs,
  DrivetrainId,
  DrivingState,
  SimState,
  SurfaceId,
  ThrottleIntensityId,
  ThrottleTimingId,
  TrackId,
} from "./types.ts";

// The core teaching model: a 3-DOF bicycle model (Fx_f, Fx_r, Fy_f, Fy_r) with
// a linear-tyre lateral demand and a friction-circle clamp per axle —
// documented in docs/model-assumptions.md. Grounded in the same textbook
// bicycle-model + friction-circle approach as Kapania's Stanford thesis on
// tyre force allocation (see spec/brief.md for the link), simplified for a
// one-corner teaching explainer rather than trajectory optimisation.
//
// Sign convention: x forward, y left, heading/yaw CCW-positive. Positive
// steering input = steer left. The one corner bends right (track.ts), so
// "steer right" is the input that follows it.

function driveSplit(drivetrain: DrivetrainId): { front: number; rear: number } {
  switch (drivetrain) {
    case "FWD":
      return { front: 1, rear: 0 };
    case "RWD":
      return { front: 0, rear: 1 };
    case "AWD":
      // Documented teaching split: an even 50/50, not a claim about any real
      // AWD system's actual torque distribution.
      return { front: 0.5, rear: 0.5 };
  }
}

function clampAxle(fxDemand: number, fyDemand: number, limit: number): AxleState {
  const utilisation = limit > 0 ? Math.hypot(fxDemand, fyDemand) / limit : 0;
  const saturated = utilisation > 1;
  const scale = saturated ? 1 / utilisation : 1;
  return {
    fxDemand,
    fyDemand,
    fx: fxDemand * scale,
    fy: fyDemand * scale,
    limit,
    utilisation,
    saturated,
  };
}

function classify(front: AxleState, rear: AxleState): DrivingState {
  if (front.saturated && rear.saturated) return "slide";
  if (front.saturated) return "understeer";
  if (rear.saturated) return "oversteer";
  return "stable";
}

export function createInitialState(
  drivetrain: DrivetrainId = "RWD",
  surface: SurfaceId = "dry",
  throttleIntensity: ThrottleIntensityId = "medium",
  throttleTiming: ThrottleTimingId = "early",
  track: TrackId = DEFAULT_TRACK_ID,
): SimState {
  const zeroAxle: AxleState = {
    fxDemand: 0,
    fyDemand: 0,
    fx: 0,
    fy: 0,
    limit: 0,
    utilisation: 0,
    saturated: false,
  };
  return {
    x: 0,
    y: 0,
    heading: 0,
    vx: 0,
    vy: 0,
    yawRate: 0,
    steering: 0,
    throttle: 0,
    brake: 0,
    front: zeroAxle,
    rear: zeroAxle,
    longitudinalG: 0,
    lateralG: 0,
    pathOffset: 0,
    drivingState: "stable",
    drivetrain,
    surface,
    throttleIntensity,
    throttleTiming,
    track,
    sweptAngle: 0,
    elapsed: 0,
    phase: "ready",
  };
}

/** The explicit "Enter the corner" action: begins a run from the given
 * ready (or finished) state at the documented entry speed and pose,
 * discarding whatever progress a previous run made. Same drivetrain/surface/
 * throttle-intensity/throttle-timing selection, same starting position — the
 * only thing that changes run to run is which of those discrete settings the
 * visitor picked, which is what makes repeat runs a fair comparison. Safe to
 * call directly from "finished" as well as "ready": there is no forced Reset
 * step in between. */
export function startRun(state: SimState): SimState {
  return {
    ...createInitialState(
      state.drivetrain,
      state.surface,
      state.throttleIntensity,
      state.throttleTiming,
      state.track,
    ),
    phase: "running",
    vx: ENTRY_SPEED,
  };
}

/** Advances the simulation by exactly one fixed timestep. Pure function: the
 * same (state, controls, dt) always produces the same result — no
 * randomness, no wall-clock reads. */
export function step(
  state: SimState,
  controls: ControlInputs,
  dt: number,
  params: CarParams = CAR_PARAMS,
): SimState {
  // The experiment's inert phase: nothing moves until the driver explicitly
  // starts a run (startRun above), so page load and Reset both leave the car
  // stationary indefinitely rather than launching it on their own.
  if (state.phase !== "running") return state;

  // Looked up from state.track rather than taken as a parameter — same
  // pattern as SURFACE_PRESETS[state.surface] below — so every caller
  // automatically drives the track the visitor actually picked.
  const track = TRACK_PRESETS[state.track] ?? TRACK_PRESETS[DEFAULT_TRACK_ID];

  const delta = controls.steering * params.maxSteerAngle;
  const vxSafe = Math.max(state.vx, params.minSpeedForSlip);

  const rawAlphaFront = delta - Math.atan2(state.vy + params.wheelbaseHalf * state.yawRate, vxSafe);
  const rawAlphaRear = -Math.atan2(state.vy - params.wheelbaseHalf * state.yawRate, vxSafe);
  const alphaLimit = 1.2; // rad, defensive clamp against atan2 blow-up at very low speed
  const alphaFront = Math.max(-alphaLimit, Math.min(alphaLimit, rawAlphaFront));
  const alphaRear = Math.max(-alphaLimit, Math.min(alphaLimit, rawAlphaRear));

  // Fy = +C*alpha here (not the more commonly-quoted -C*alpha) because alpha
  // above is defined as (steer angle) - (velocity angle), the negative of
  // the SAE slip angle convention; with that sign of alpha, the force that
  // actually opposes the tyre's lateral slip velocity is positive C*alpha.
  // Getting this backwards doesn't just mirror the turn: it flips a
  // restoring force into a destabilising one, so any sustained cornering
  // diverges into a spin within a few hundred ms regardless of tuning (see
  // docs/model-assumptions.md).
  //
  // lateralForceFade uses the car's *actual* vx (never vxSafe, the floored
  // value above that only protects the atan2 denominator): below
  // LOW_SPEED_FADE_SPEED it scales lateral tyre force toward zero, so
  // steering a stationary or near-stationary car can't manufacture cornering
  // force out of nothing.
  const lateralForceFade = Math.max(0, Math.min(1, Math.abs(state.vx) / LOW_SPEED_FADE_SPEED));
  const fyFrontDemand = params.corneringStiffnessFront * alphaFront * lateralForceFade;
  const fyRearDemand = params.corneringStiffnessRear * alphaRear * lateralForceFade;

  const driveForce = controls.throttle * params.maxEngineForce;
  // Braking always opposes motion, all the way to zero — minSpeedForSlip is
  // reserved strictly for the atan2 floor above and must never gate whether
  // the brake works.
  const brakeForce = controls.brake * params.maxBrakeForce;
  const split = driveSplit(state.drivetrain);

  const fxFrontDemand = driveForce * split.front - brakeForce * params.brakeFrontShare;
  const fxRearDemand = driveForce * split.rear - brakeForce * (1 - params.brakeFrontShare);

  const mu = SURFACE_PRESETS[state.surface]?.mu ?? SURFACE_PRESETS.dry.mu;
  const normalLoadPerAxle = (params.mass * params.gravity) / 2; // symmetric static split
  const axleLimit = mu * normalLoadPerAxle;

  const front = clampAxle(fxFrontDemand, fyFrontDemand, axleLimit);
  const rear = clampAxle(fxRearDemand, fyRearDemand, axleLimit);

  // A modest, constant rolling resistance opposing whatever direction the
  // car is currently travelling — independent of the brake pedal and of the
  // tyres' friction-circle budget, so a coasting car (no throttle, no brake)
  // still bleeds off speed instead of cruising forever at a constant value.
  const rollingResistance =
    Math.abs(state.vx) > AT_REST_SPEED ? -Math.sign(state.vx) * ROLLING_RESISTANCE_FORCE : 0;

  const fxTotal = front.fx + rear.fx + rollingResistance;
  const fyTotal = front.fy + rear.fy;
  const yawMoment = params.wheelbaseHalf * front.fy - params.wheelbaseHalf * rear.fy;

  const vxDot = fxTotal / params.mass + state.vy * state.yawRate;
  const vyDot = fyTotal / params.mass - state.vx * state.yawRate;
  const yawRateDot = yawMoment / params.yawInertia;

  // vx is only capped for the top-speed safety limit, never floored at zero:
  // a spun-out car's body-frame forward velocity can legitimately go negative
  // (nose pointing away from the direction of travel). Flooring it at 0 would
  // silently delete the `-vx * yawRate` restoring term below, leaving vy with
  // nothing to bound it — that produced an unbounded sideways runaway under
  // sustained hard input (see docs/model-assumptions.md).
  const rawVx = Math.max(-params.maxSpeed, Math.min(params.maxSpeed, state.vx + vxDot * dt));
  const rawVy = state.vy + vyDot * dt;

  // Total speed is still capped as a hard safety net: the linear tyre model
  // is only valid near normal driving slip angles, and this keeps sustained,
  // extreme, unrealistic inputs (full opposite lock held for seconds) from
  // diverging to unbounded numbers instead of settling into a bounded slide.
  const rawSpeed = Math.hypot(rawVx, rawVy);
  const speedScale = rawSpeed > params.maxSpeed ? params.maxSpeed / rawSpeed : 1;
  let vx = rawVx * speedScale;
  let vy = rawVy * speedScale;
  let yawRate = state.yawRate + yawRateDot * dt;

  // Kinematic blend at rest: with no drive force requested, brake and rolling
  // resistance may only ever slow the car toward zero, never through it —
  // fxTotal's sign is fixed by the *pedal* input, not by the car's current
  // direction of travel, so without this clamp a single oversized timestep
  // (or the very next one, since state.vx stays at exactly 0) would apply
  // that same force again and accelerate the car backwards. Comparing signs
  // rather than testing against a speed threshold makes this correct
  // regardless of the timestep size or how close to zero vx already is: a
  // sign flip (or already being parked at zero) always means "hold at rest",
  // not "keep integrating". Steering while parked (this branch, no brake
  // needed) and braking down to a stop (this branch, once the sign flips)
  // both land here — that's why it also zeroes yawRate/vy: a car that isn't
  // rolling can't be yawed or slid sideways by steering alone (see
  // lateralForceFade above, which already keeps this the common case rather
  // than the exception).
  const noDriveForce = controls.throttle === 0;
  const alreadyAtRest = noDriveForce && state.vx === 0;
  const crossedThroughRest = noDriveForce && state.vx !== 0 && Math.sign(vx) !== Math.sign(state.vx);
  if (alreadyAtRest || crossedThroughRest) {
    vx = 0;
    vy = 0;
    yawRate = 0;
  }

  const heading = state.heading + yawRate * dt;

  let vxWorld = vx * Math.cos(heading) - vy * Math.sin(heading);
  let vyWorld = vx * Math.sin(heading) + vy * Math.cos(heading);
  let x = state.x + vxWorld * dt;
  let y = state.y + vyWorld * dt;

  // Outer-track barrier: a real physical boundary, not merely a rendered
  // barrier model (see environment.ts) — the barrier's own placement never
  // moves, but the car's body can no longer pass through it. Expressed as a
  // radial limit on distance from the track's own centre of curvature rather
  // than literal 3D box collision, since both the road and the barrier are
  // already defined relative to the same arc (see BARRIER_COLLISION_LIMIT_METERS,
  // constants.ts) — this keeps physics free of any Three.js/mesh awareness.
  // Position is clamped radially onto the boundary (never allowed to
  // penetrate), and the response is a genuine reaction-force rebound, not a
  // "stop dead at the wall" clamp: a stationary obstacle pushes back. The
  // outward-radial (impact-normal) component of velocity reverses at
  // BARRIER_RESTITUTION of its impact speed, and the along-the-wall
  // (tangential, "scrape") component is bled off by an amount that scales
  // with the current surface's own grip (mu, computed above) — a grippier
  // surface sheds more of that sliding speed on contact than an icy one.
  const { cx, cy } = trackCentre(track);
  const distanceFromCentre = Math.hypot(x - cx, y - cy);
  const maxDistanceFromCentre = track.radius + BARRIER_COLLISION_LIMIT_METERS - CAR_HALF_WIDTH_METERS;
  if (distanceFromCentre > maxDistanceFromCentre) {
    const radialX = (x - cx) / distanceFromCentre;
    const radialY = (y - cy) / distanceFromCentre;
    x = cx + radialX * maxDistanceFromCentre;
    y = cy + radialY * maxDistanceFromCentre;
    const outwardRadialSpeed = vxWorld * radialX + vyWorld * radialY;
    if (outwardRadialSpeed > 0) {
      const tangentialX = vxWorld - outwardRadialSpeed * radialX;
      const tangentialY = vyWorld - outwardRadialSpeed * radialY;
      const reboundSpeed = outwardRadialSpeed * BARRIER_RESTITUTION;
      const tangentialRetained = Math.max(0, 1 - mu * BARRIER_IMPACT_FRICTION_FACTOR);
      vxWorld = -radialX * reboundSpeed + tangentialX * tangentialRetained;
      vyWorld = -radialY * reboundSpeed + tangentialY * tangentialRetained;
      // Re-derive body-frame vx/vy from the corrected world velocity (inverse
      // of the rotation above) so SimState.vx/vy stay consistent with the
      // car's actual, now-bounded world motion.
      vx = vxWorld * Math.cos(heading) + vyWorld * Math.sin(heading);
      vy = -vxWorld * Math.sin(heading) + vyWorld * Math.cos(heading);
    }
  }

  // Progress around this track's own corner (see sweptAngleRate, track.ts),
  // integrated from the car's pre-step position — used by shouldFinish below
  // to decide when the run has reached the end of its track's swept arc,
  // rather than an open-ended geometry the car could coast through forever.
  const sweptAngle =
    state.sweptAngle + sweptAngleRate(state.x, state.y, vxWorld, vyWorld, track) * dt;

  return {
    ...state,
    x,
    y,
    heading,
    vx,
    vy,
    yawRate,
    steering: controls.steering,
    throttle: controls.throttle,
    brake: controls.brake,
    front,
    rear,
    longitudinalG: fxTotal / params.mass / params.gravity,
    lateralG: fyTotal / params.mass / params.gravity,
    pathOffset: pathOffset(x, y, track),
    drivingState: classify(front, rear),
    sweptAngle,
    elapsed: state.elapsed + dt,
  };
}

/** Whether a "running" state should transition to "finished" — checked by
 * the caller's frame loop (main.ts) after each step, never inside step()
 * itself (step() only ever advances physics; lifecycle transitions stay the
 * caller's responsibility, same as the "running" phase gate above). Three
 * tiers, each looser than the last:
 * 1. Position-based (normal case): true once the car's accumulated
 *    `sweptAngle` reaches the selected track's `sweepAngle` — it has reached
 *    the end of the track's geometry.
 * 2. `elapsed >= track.expectedTraversalSeconds + AUTO_FINISH_GRACE_SECONDS`:
 *    the practical backstop. `expectedTraversalSeconds` is the track's own
 *    no-slip ideal transit time at ENTRY_SPEED, so a run still going this
 *    many seconds past that has demonstrably stopped making real progress
 *    (run wide, stuck bouncing off the barrier, etc.) — force-finish rather
 *    than let it wander indefinitely.
 * 3. `elapsed >= SAFETY_CAP_SECONDS`: an absolute, track-independent final
 *    backstop, kept only in case a future preset's `expectedTraversalSeconds`
 *    is ever miscalibrated; comfortably larger than tier 2 for every current
 *    preset, so it should never actually be the condition that trips. */
export function shouldFinish(state: SimState): boolean {
  const track = TRACK_PRESETS[state.track] ?? TRACK_PRESETS[DEFAULT_TRACK_ID];
  return (
    state.sweptAngle >= track.sweepAngle ||
    state.elapsed >= track.expectedTraversalSeconds + AUTO_FINISH_GRACE_SECONDS ||
    state.elapsed >= SAFETY_CAP_SECONDS
  );
}
