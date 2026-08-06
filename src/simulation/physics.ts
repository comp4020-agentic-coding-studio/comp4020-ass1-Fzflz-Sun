import { CAR_PARAMS, INITIAL_SPEED, SURFACE_PRESETS, TRACK_PARAMS } from "./constants.ts";
import { pathOffset } from "./track.ts";
import type {
  AxleState,
  CarParams,
  ControlInputs,
  DrivetrainId,
  DrivingState,
  SimState,
  SurfaceId,
  TrackParams,
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
    vx: INITIAL_SPEED,
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
    elapsed: 0,
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
  track: TrackParams = TRACK_PARAMS,
): SimState {
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
  const fyFrontDemand = params.corneringStiffnessFront * alphaFront;
  const fyRearDemand = params.corneringStiffnessRear * alphaRear;

  const driveForce = controls.throttle * params.maxEngineForce;
  const brakeForce = state.vx > params.minSpeedForSlip ? controls.brake * params.maxBrakeForce : 0;
  const split = driveSplit(state.drivetrain);

  const fxFrontDemand = driveForce * split.front - brakeForce * params.brakeFrontShare;
  const fxRearDemand = driveForce * split.rear - brakeForce * (1 - params.brakeFrontShare);

  const mu = SURFACE_PRESETS[state.surface]?.mu ?? SURFACE_PRESETS.dry.mu;
  const normalLoadPerAxle = (params.mass * params.gravity) / 2; // symmetric static split
  const axleLimit = mu * normalLoadPerAxle;

  const front = clampAxle(fxFrontDemand, fyFrontDemand, axleLimit);
  const rear = clampAxle(fxRearDemand, fyRearDemand, axleLimit);

  const fxTotal = front.fx + rear.fx;
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
  const vx = rawVx * speedScale;
  const vy = rawVy * speedScale;
  const yawRate = state.yawRate + yawRateDot * dt;
  const heading = state.heading + yawRate * dt;

  const x = state.x + (vx * Math.cos(heading) - vy * Math.sin(heading)) * dt;
  const y = state.y + (vx * Math.sin(heading) + vy * Math.cos(heading)) * dt;

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
    elapsed: state.elapsed + dt,
  };
}
