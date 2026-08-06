import {
  DRY_BASELINE_STEERING_FRACTION,
  THROTTLE_INTENSITY_PRESETS,
  THROTTLE_TIMING_PRESETS,
} from "./constants.ts";
import type { CarParams, ControlInputs, ThrottleIntensityId, ThrottleTimingId } from "./types.ts";

function rampedTarget(elapsedSinceStart: number, target: number, ratePerSecond: number): number {
  if (elapsedSinceStart <= 0) return 0;
  const magnitude = Math.min(Math.abs(target), ratePerSecond * elapsedSinceStart);
  return Math.sign(target) * magnitude;
}

/** The deterministic, pure replacement for held-input driving: every control
 * value is derived solely from how far into the run `elapsed` is and the
 * visitor's two discrete pre-run choices — never from any previous control
 * value or wall-clock/held-key state. Same (elapsed, throttleIntensity,
 * throttleTiming) always produces the same controls, which is what makes a
 * run bit-for-bit repeatable.
 *
 * Steering is a fixed autosteer program: it ramps toward the documented dry
 * baseline (DRY_BASELINE_STEERING_FRACTION, calibrated against the corner's
 * own geometry — see constants.ts) from the moment a run starts, at the same
 * steerRampPerSecond rate real held input used to ramp at. The visitor never
 * adjusts it — removing steering as a variable is what turns drivetrain/
 * surface/throttle into a controlled comparison instead of also measuring
 * visitor steering skill.
 *
 * Throttle stays at 0 until the selected timing preset's threshold, then
 * ramps toward the selected intensity preset's fraction at
 * throttleRampPerSecond. Brake is always 0 — braking is out of scope for
 * this discrete-run redesign; step()'s brake handling is untouched because
 * physics.test.ts/behaviour.test.ts still exercise it directly. */
export function controlsAtElapsed(
  elapsed: number,
  throttleIntensity: ThrottleIntensityId,
  throttleTiming: ThrottleTimingId,
  params: CarParams,
): ControlInputs {
  // steer right — the one corner bends right (track.ts); DRY_BASELINE_STEERING_FRACTION
  // is calibrated against the corner's own geometry (constants.ts).
  const steerTarget = -DRY_BASELINE_STEERING_FRACTION;
  const steering = rampedTarget(elapsed, steerTarget, params.steerRampPerSecond);

  const timing = THROTTLE_TIMING_PRESETS[throttleTiming];
  const intensity = THROTTLE_INTENSITY_PRESETS[throttleIntensity];
  const elapsedSinceThrottleStart = elapsed - timing.thresholdSeconds;
  const throttle = rampedTarget(elapsedSinceThrottleStart, intensity.fraction, params.throttleRampPerSecond);

  return { steering, throttle, brake: 0 };
}

export const NEUTRAL_CONTROLS: ControlInputs = { steering: 0, throttle: 0, brake: 0 };
