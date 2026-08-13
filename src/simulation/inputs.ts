import {
  CROSS_TRACK_GAIN,
  DEFAULT_TRACK_ID,
  HEADING_GAIN,
  THROTTLE_INTENSITY_PRESETS,
  THROTTLE_TIMING_PRESETS,
  TRACK_PRESETS,
} from "./constants.ts";
import { pathOffset, trackCentre } from "./track.ts";
import type { CarParams, ControlInputs, SimState } from "./types.ts";

function rampedTarget(elapsedSinceStart: number, target: number, ratePerSecond: number): number {
  if (elapsedSinceStart <= 0) return 0;
  const magnitude = Math.min(Math.abs(target), ratePerSecond * elapsedSinceStart);
  return Math.sign(target) * magnitude;
}

function clamp(value: number, limit: number): number {
  return Math.max(-limit, Math.min(limit, value));
}

/** Wraps an angle difference into (-pi, pi] — used to turn a raw
 * `target - current` heading subtraction into the shorter signed turn. */
function wrapAngle(radians: number): number {
  return Math.atan2(Math.sin(radians), Math.cos(radians));
}

/** The deterministic, pure replacement for held-input driving: every control
 * value is derived solely from the current `state`, the visitor's two
 * discrete throttle choices carried on it, and the selected track's own
 * calibration — never from wall-clock/held-key state. Same (state, params,
 * dt) always produces the same controls, which is what makes a run
 * bit-for-bit repeatable (see behaviour.test.ts's full-run determinism test).
 *
 * Steering is a closed-loop correction toward the selected track's own
 * reference arc — a deliberate, explicitly-requested exception to this
 * project's original "steering never reacts to the car's actual state" rule
 * (see docs/model-assumptions.md and CLAUDE.md for the full reasoning): it
 * combines the track's calibrated feedforward `autosteerFraction` with a
 * cross-track term (pulls back toward the line when running wide) and a
 * heading term (corrects toward the arc's tangent when the nose has drifted
 * off it, e.g. after a slide) — see CROSS_TRACK_GAIN/HEADING_GAIN,
 * constants.ts. The corrected target is rate-limited from the *previous*
 * actual `state.steering` (not a closed-form function of elapsed time alone,
 * since the target itself now moves every step), at the same
 * steerRampPerSecond rate real held input used to ramp at.
 *
 * Throttle is unchanged: it stays at 0 until the selected timing preset's
 * threshold, then ramps toward the selected intensity preset's fraction at
 * throttleRampPerSecond. Brake is always 0 — braking is out of scope for
 * this discrete-run redesign; step()'s brake handling is untouched because
 * physics.test.ts/behaviour.test.ts still exercise it directly. */
export function controlsForState(state: SimState, params: CarParams, dt: number): ControlInputs {
  const track = TRACK_PRESETS[state.track] ?? TRACK_PRESETS[DEFAULT_TRACK_ID];
  const directionSign = track.direction === "left" ? 1 : -1;

  const feedforward = directionSign * track.autosteerFraction;

  const crossTrackError = pathOffset(state.x, state.y, track);
  const crossTrackCorrection = directionSign * CROSS_TRACK_GAIN * crossTrackError;

  const { cx, cy } = trackCentre(track);
  const tangentHeading = Math.atan2(state.y - cy, state.x - cx) + directionSign * (Math.PI / 2);
  const headingError = wrapAngle(tangentHeading - state.heading);
  const headingCorrection = HEADING_GAIN * headingError;

  const steerTarget = clamp(feedforward + crossTrackCorrection + headingCorrection, 1);
  const maxSteerDelta = params.steerRampPerSecond * dt;
  const steering = state.steering + clamp(steerTarget - state.steering, maxSteerDelta);

  const timing = THROTTLE_TIMING_PRESETS[state.throttleTiming];
  const intensity = THROTTLE_INTENSITY_PRESETS[state.throttleIntensity];
  const elapsedSinceThrottleStart = state.elapsed - timing.thresholdSeconds;
  const throttle = rampedTarget(elapsedSinceThrottleStart, intensity.fraction, params.throttleRampPerSecond);

  return { steering, throttle, brake: 0 };
}

export const NEUTRAL_CONTROLS: ControlInputs = { steering: 0, throttle: 0, brake: 0 };
