import type { CarParams, ControlInputs, HeldControls } from "./types.ts";

function rampToward(current: number, target: number, ratePerSecond: number, dt: number): number {
  const maxStep = ratePerSecond * dt;
  if (current < target) return Math.min(target, current + maxStep);
  if (current > target) return Math.max(target, current - maxStep);
  return current;
}

/** Turns held-key/held-button state into smoothly ramped analog controls —
 * "ramp throttle and steering smoothly and linearly while held instead of
 * instantly jumping from 0 to 100%" (spec/brief.md). Releasing a control
 * ramps it back toward neutral at the same rate, so there is never a
 * discontinuous jump in either direction. Pure function: same held-state
 * history and dt sequence always produces the same control sequence. */
export function rampControls(
  current: ControlInputs,
  held: HeldControls,
  dt: number,
  params: CarParams,
): ControlInputs {
  const steerTarget = (held.steerLeft ? 1 : 0) - (held.steerRight ? 1 : 0);
  return {
    steering: rampToward(current.steering, steerTarget, params.steerRampPerSecond, dt),
    throttle: rampToward(current.throttle, held.throttle ? 1 : 0, params.throttleRampPerSecond, dt),
    brake: rampToward(current.brake, held.brake ? 1 : 0, params.brakeRampPerSecond, dt),
  };
}

export const NEUTRAL_CONTROLS: ControlInputs = { steering: 0, throttle: 0, brake: 0 };
export const NO_CONTROLS_HELD: HeldControls = {
  steerLeft: false,
  steerRight: false,
  throttle: false,
  brake: false,
};
