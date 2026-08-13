import { describe, expect, it } from "vitest";
import * as constants from "./constants.ts";
import * as physics from "./physics.ts";
import { controlsForState, NEUTRAL_CONTROLS } from "./inputs.ts";
import type {
  ControlInputs,
  DrivetrainId,
  SimState,
  SurfaceId,
  ThrottleIntensityId,
  ThrottleTimingId,
  TrackId,
} from "./types.ts";

// Motion-level behavioural tests written against the CURRENT implementation
// on purpose — see docs/model-assumptions.md and the six known-failure
// writeup this file exists to make un-ignorable. Every assertion here checks
// trajectory/speed/yaw-rate/path-offset/body-slip, never a classification
// label or a bare utilisation percentage (physics.test.ts already covers
// those). Several of these are EXPECTED TO FAIL until the corresponding fix
// lands; that is the point of writing them first.
//
// New capabilities (`phase`, `startRun`, `ENTRY_SPEED`) are read through a
// namespace import so a not-yet-existing export resolves to `undefined`
// instead of crashing the whole file at module-link time — each test then
// fails on its own assertion, which is more informative than one dead suite.

const { createInitialState, step } = physics;
const { FIXED_TIMESTEP, CAR_PARAMS } = constants;

function drive(
  state: SimState,
  controls: ControlInputs,
  steps: number,
  dt: number = FIXED_TIMESTEP,
): SimState {
  let s = state;
  for (let i = 0; i < steps; i++) s = step(s, controls, dt);
  return s;
}

function startedRun(
  drivetrain: DrivetrainId = "RWD",
  surface: SurfaceId = "dry",
  throttleIntensity: ThrottleIntensityId = "medium",
  throttleTiming: ThrottleTimingId = "early",
  track: TrackId = constants.DEFAULT_TRACK_ID,
): SimState {
  const ready = createInitialState(drivetrain, surface, throttleIntensity, throttleTiming, track);
  // Falls back to the ready state itself (vx whatever createInitialState
  // currently sets it to) when startRun doesn't exist yet — keeps the rest
  // of the test runnable instead of throwing before we get useful output.
  return typeof (physics as Record<string, unknown>).startRun === "function"
    ? (physics as unknown as { startRun: (s: SimState) => SimState }).startRun(ready)
    : ready;
}

// Drives a run using the real deterministic autosteer/throttle program
// (controlsForState) instead of hand-built ControlInputs — this is what
// main.ts's frame loop actually calls, so these tests exercise the same
// input-generation path a visitor's run does, not a stand-in for it.
// throttleIntensity/throttleTiming are applied onto `state` here (rather
// than requiring every caller to thread them through startedRun) since
// controlsForState reads them off `state` itself.
function driveAuto(
  state: SimState,
  throttleIntensity: ThrottleIntensityId,
  throttleTiming: ThrottleTimingId,
  steps: number,
  dt: number = FIXED_TIMESTEP,
): SimState {
  let s: SimState = { ...state, throttleIntensity, throttleTiming };
  for (let i = 0; i < steps; i++) {
    const controls = controlsForState(s, CAR_PARAMS, dt);
    s = step(s, controls, dt);
  }
  return s;
}

// ---------------------------------------------------------------------------
// A. Ready and Reset
// ---------------------------------------------------------------------------
describe("A. ready phase and reset", () => {
  it("a freshly created state starts in an inert ready phase, not already rolling", () => {
    const state = createInitialState();
    expect((state as unknown as { phase?: string }).phase).toBe("ready");
    expect(state.vx).toBe(0);
    expect(state.vy).toBe(0);
    expect(state.yawRate).toBe(0);
  });

  it("stepping the ready state with no input for several seconds leaves the car exactly where it started", () => {
    const state0 = createInitialState();
    const before = { x: state0.x, y: state0.y, heading: state0.heading, vx: state0.vx };
    let state = state0;
    for (let i = 0; i < 600; i++) state = step(state, NEUTRAL_CONTROLS, FIXED_TIMESTEP); // 5s simulated
    expect(state.x).toBe(before.x);
    expect(state.y).toBe(before.y);
    expect(state.heading).toBe(before.heading);
    expect(state.vx).toBe(before.vx);
  });

  it("an explicit start-run action exists and gives the documented entry speed every time", () => {
    const ready = createInitialState("RWD", "dry");
    expect(typeof (physics as Record<string, unknown>).startRun).toBe("function");
    const running = (physics as unknown as { startRun: (s: SimState) => SimState }).startRun(ready);
    expect((running as unknown as { phase?: string }).phase).toBe("running");
    const entrySpeed = (constants as Record<string, unknown>).ENTRY_SPEED;
    expect(typeof entrySpeed).toBe("number");
    expect(running.vx).toBe(entrySpeed);
  });

  it("reset returns to the exact same inert ready state no matter how far a run progressed", () => {
    let running = startedRun("FWD", "wet");
    const HARD: ControlInputs = { steering: -0.8, throttle: 1, brake: 0 };
    for (let i = 0; i < 300; i++) running = step(running, HARD, FIXED_TIMESTEP);

    const reset = createInitialState("FWD", "wet");
    expect(reset).toEqual(createInitialState("FWD", "wet"));
    expect((reset as unknown as { phase?: string }).phase).toBe("ready");
    expect(reset.vx).toBe(0);
    expect(reset.vy).toBe(0);
    expect(reset.yawRate).toBe(0);
    expect(reset.steering).toBe(0);
    expect(reset.throttle).toBe(0);
    expect(reset.brake).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// B. Braking and low-speed behaviour
// ---------------------------------------------------------------------------
describe("B. braking reaches a genuine, held stop", () => {
  it("sustained full braking eventually reaches exactly zero speed and never reverses", () => {
    let state = startedRun("RWD", "dry");
    const BRAKE: ControlInputs = { steering: 0, throttle: 0, brake: 1 };
    let reachedZero = false;
    for (let i = 0; i < 1200; i++) {
      // 10s simulated
      state = step(state, BRAKE, FIXED_TIMESTEP);
      if (state.vx === 0) {
        reachedZero = true;
        break;
      }
      expect(state.vx).toBeGreaterThanOrEqual(0); // never overshoots into reverse
    }
    expect(reachedZero).toBe(true);

    for (let i = 0; i < 120; i++) state = step(state, BRAKE, FIXED_TIMESTEP); // stays at rest
    expect(state.vx).toBe(0);
  });

  it("steering while stationary produces no lateral velocity, yaw rate, or position change", () => {
    const state0: SimState = { ...startedRun("RWD", "dry"), vx: 0, vy: 0, yawRate: 0 };
    const before = { x: state0.x, y: state0.y, heading: state0.heading };
    const STEER_AT_REST: ControlInputs = { steering: -1, throttle: 0, brake: 0 };
    let state = state0;
    for (let i = 0; i < 120; i++) state = step(state, STEER_AT_REST, FIXED_TIMESTEP); // 1s held
    expect(state.vy).toBe(0);
    expect(state.yawRate).toBe(0);
    expect(state.x).toBe(before.x);
    expect(state.y).toBe(before.y);
    expect(state.heading).toBe(before.heading);
  });

  it("minSpeedForSlip protects the slip-angle denominator only — it must never disable braking", () => {
    const state0: SimState = {
      ...startedRun("RWD", "dry"),
      vx: CAR_PARAMS.minSpeedForSlip - 0.5, // just below the numerical floor
    };
    const BRAKE: ControlInputs = { steering: 0, throttle: 0, brake: 1 };
    const before = state0.vx;
    const after = step(state0, BRAKE, FIXED_TIMESTEP);
    expect(after.vx).toBeLessThan(before);
  });
});

// ---------------------------------------------------------------------------
// C. Autosteer authority follows the reference corner
// ---------------------------------------------------------------------------
// Steering is no longer a visitor-adjustable variable — controlsForState
// produces a closed-loop correction toward the track's own reference arc
// (see inputs.ts), rate-limited step to step the same way throttle ramps
// toward its selected intensity. These tests exercise that program directly
// instead of hand-built steering fractions that the visitor can no longer
// choose.
describe("C. autosteer follows the reference corner", () => {
  const ROAD_HALF_WIDTH = 7; // matches src/rendering/scene.ts's ROAD_HALF_WIDTH

  // "late" timing keeps throttle at exactly 0 for the whole interval below
  // (4 s < the 4.5 s late threshold), isolating autosteer's own contribution
  // to the trajectory from any throttle effect.
  function autosteerOnlyRun(seconds: number): SimState {
    return driveAuto(startedRun("RWD", "dry"), "light", "late", Math.round(seconds / FIXED_TIMESTEP));
  }

  it("steering ramps in gradually from 0 at the start of a run rather than snapping straight to the target", () => {
    const state0 = startedRun("RWD", "dry", "medium", "early");
    expect(state0.steering).toBe(0);

    const firstStepControls = controlsForState(state0, CAR_PARAMS, FIXED_TIMESTEP);
    const maxFirstStepDelta = CAR_PARAMS.steerRampPerSecond * FIXED_TIMESTEP;
    // At the very first step the car sits exactly on the reference line
    // heading exactly along its tangent, so the only nonzero contribution to
    // the target is the track's feedforward autosteer fraction — but even
    // that nonzero target must not be applied all at once.
    expect(Math.abs(firstStepControls.steering)).toBeGreaterThan(0);
    expect(Math.abs(firstStepControls.steering)).toBeLessThanOrEqual(maxFirstStepDelta + 1e-9);

    // Driven for a full second, steering should have ramped up well past a
    // single step's worth of change, converging toward the track's own
    // calibrated feedforward target rather than staying pinned near 0.
    const afterOneSecond = driveAuto(state0, "medium", "early", Math.round(1 / FIXED_TIMESTEP));
    expect(Math.abs(afterOneSecond.steering)).toBeGreaterThan(maxFirstStepDelta * 5);
  });

  it("the autosteer program follows the reference line within the road width for a sustained interval", () => {
    const state = autosteerOnlyRun(4);
    expect(Math.abs(state.pathOffset)).toBeLessThan(ROAD_HALF_WIDTH);
  });

  it("autosteer vs. no steering input at all produce observably different trajectories", () => {
    const straightControls: ControlInputs = { steering: 0, throttle: 0, brake: 0 };
    const straight = drive(startedRun("RWD", "dry"), straightControls, Math.round(3 / FIXED_TIMESTEP));
    const steered = autosteerOnlyRun(3);
    expect(Math.abs(steered.heading - straight.heading)).toBeGreaterThan(0.05);
    expect(Math.abs(steered.pathOffset - straight.pathOffset)).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------
// D. Drivetrain and surface produce different MOTION, not just percentages
// ---------------------------------------------------------------------------
describe("D. drivetrain and surface change motion, not only utilisation numbers", () => {
  // "full" intensity + "early" timing throttles in immediately on top of the
  // autosteer program — the hardest combination this UI can produce. Both
  // ramp in (steering reaches full lock in ~0.4s, throttle in ~0.83s), so
  // this needs more settle time than the old instant-full-input version did;
  // 400 steps (~3.33s) leaves ~2.5s of sustained full input after the ramp,
  // comfortably enough to saturate FWD/RWD the way SATURATION_STEPS did in
  // physics.test.ts. "full" + "late" keeps throttle at exactly 0 for the
  // whole window below (well under the 4.5s late threshold), isolating
  // autosteer's own contribution the same way the old hand-built STEER_ONLY
  // constant did before the discrete-run redesign.
  const STEPS = 400;

  function saturatedRun(drivetrain: DrivetrainId, surface: SurfaceId = "dry"): SimState {
    return driveAuto(startedRun(drivetrain, surface), "full", "early", STEPS);
  }
  function unsaturatedRun(drivetrain: DrivetrainId, surface: SurfaceId = "dry"): SimState {
    return driveAuto(startedRun(drivetrain, surface), "full", "late", STEPS);
  }

  it("FWD front-axle saturation measurably reduces achieved curvature vs. an unsaturated autosteer-only run and runs wider", () => {
    const saturatedFWD = saturatedRun("FWD");
    const unsaturated = unsaturatedRun("FWD");
    const curvatureOf = (s: SimState) => Math.abs(s.yawRate / Math.max(s.vx, 0.01));
    expect(curvatureOf(saturatedFWD)).toBeLessThan(curvatureOf(unsaturated));
    expect(saturatedFWD.pathOffset).toBeGreaterThan(unsaturated.pathOffset);
  });

  it("RWD rear-axle saturation measurably increases body slip (|vy|) vs. an unsaturated run", () => {
    const saturatedRWD = saturatedRun("RWD");
    const unsaturated = unsaturatedRun("RWD");
    expect(Math.abs(saturatedRWD.vy)).toBeGreaterThan(Math.abs(unsaturated.vy));
  });

  it("AWD delays single-axle saturation later than FWD/RWD under the identical script, without becoming unable to slide", () => {
    function stepsToSaturate(drivetrain: DrivetrainId): number {
      let state = startedRun(drivetrain, "dry", "full", "early");
      for (let i = 1; i <= STEPS; i++) {
        const controls = controlsForState(state, CAR_PARAMS, FIXED_TIMESTEP);
        state = step(state, controls, FIXED_TIMESTEP);
        if (state.front.saturated || state.rear.saturated) return i;
      }
      return Number.POSITIVE_INFINITY;
    }
    const fwd = stepsToSaturate("FWD");
    const rwd = stepsToSaturate("RWD");
    const awd = stepsToSaturate("AWD");
    expect(awd).toBeGreaterThan(Math.min(fwd, rwd));

    // Checks saturation ever occurred across the run, not just in the final
    // state: with the barrier's reaction-force rebound (physics.ts), a car
    // driven hard enough to reach the outer boundary bounces back and sheds
    // enough speed to regain traction before this loop ends — a real,
    // desired consequence of a physical bounce-back replacing the old
    // "scrape along the wall forever" clamp, not a sign AWD can no longer
    // slide. The saturation this asserts on does still happen (confirmed at
    // step ~400 of this exact script) — it just doesn't necessarily persist
    // to the last step anymore.
    let awdHarder: SimState = { ...startedRun("AWD", "dry"), throttleIntensity: "full", throttleTiming: "early" };
    let everSaturated = false;
    for (let i = 0; i < STEPS * 3; i++) {
      const controls = controlsForState(awdHarder, CAR_PARAMS, FIXED_TIMESTEP);
      awdHarder = step(awdHarder, controls, FIXED_TIMESTEP);
      if (awdHarder.front.saturated || awdHarder.rear.saturated) everSaturated = true;
    }
    expect(everSaturated).toBe(true);
  });

  it("wet and ice reach rear-axle saturation earlier than dry, with a body-slip difference visible over the sustained run", () => {
    function stepsToSaturate(surface: SurfaceId): number {
      let state = startedRun("RWD", surface, "full", "early");
      for (let i = 1; i <= STEPS; i++) {
        const controls = controlsForState(state, CAR_PARAMS, FIXED_TIMESTEP);
        state = step(state, controls, FIXED_TIMESTEP);
        if (state.rear.saturated) return i;
      }
      return Number.POSITIVE_INFINITY;
    }
    const drySteps = stepsToSaturate("dry");
    const wetSteps = stepsToSaturate("wet");
    const iceSteps = stepsToSaturate("ice");
    expect(wetSteps).toBeLessThanOrEqual(drySteps);
    expect(iceSteps).toBeLessThanOrEqual(wetSteps);

    // Body slip is not monotonic step-to-step (vy and yawRate are coupled, so
    // it can overshoot and briefly reverse sign in the first fraction of a
    // second on every surface alike) — comparing a single early sample can
    // land on that transient rather than the surface difference. Over the
    // full sustained run the low-grip surfaces' rear axle cannot deliver the
    // demanded restoring force, and that deficit compounds into unmistakably
    // more body slip by the end of the run.
    const dryFull = saturatedRun("RWD", "dry");
    const wetFull = saturatedRun("RWD", "wet");
    const iceFull = saturatedRun("RWD", "ice");
    expect(Math.abs(wetFull.vy)).toBeGreaterThan(Math.abs(dryFull.vy));
    expect(Math.abs(iceFull.vy)).toBeGreaterThan(Math.abs(wetFull.vy));
  });
});

// ---------------------------------------------------------------------------
// E. Throttle timing changes WHEN saturation happens — the demonstrative
// piece of the discrete-experiment redesign: with drivetrain, surface, and
// intensity all held identical, only the moment throttle engages differs.
// ---------------------------------------------------------------------------
describe("E. throttle timing produces a measurable saturation-timing contrast", () => {
  // A generous upper bound on how long to keep stepping while looking for
  // saturation — SAFETY_CAP_SECONDS (constants.ts) is the run's own backstop
  // duration, so it's also a safe bound for "long enough to find saturation
  // if it's going to happen at all" here.
  const RUN_STEPS = Math.round(constants.SAFETY_CAP_SECONDS / FIXED_TIMESTEP);

  function stepsToRearSaturation(throttleTiming: ThrottleTimingId): number {
    let state = startedRun("RWD", "dry", "full", throttleTiming);
    for (let i = 1; i <= RUN_STEPS; i++) {
      const controls = controlsForState(state, CAR_PARAMS, FIXED_TIMESTEP);
      state = step(state, controls, FIXED_TIMESTEP);
      if (state.rear.saturated) return i;
    }
    return Number.POSITIVE_INFINITY;
  }

  it("identical drivetrain/surface/intensity with an early throttle onset saturates sooner than a late one", () => {
    const early = stepsToRearSaturation("early");
    const late = stepsToRearSaturation("late");
    expect(early).toBeLessThan(late);
  });
});

// ---------------------------------------------------------------------------
// F. A full run is bit-for-bit deterministic — same settings in, same
// trajectory out, every time. This is what makes "change one setting and
// re-run" a fair, repeatable comparison rather than a fresh random sample.
// ---------------------------------------------------------------------------
describe("F. full-run determinism", () => {
  it("the same (drivetrain, surface, intensity, timing) tuple produces identical output every run", () => {
    const RUN_STEPS = Math.round(constants.SAFETY_CAP_SECONDS / FIXED_TIMESTEP);

    function fullRun(): SimState {
      return driveAuto(startedRun("AWD", "wet", "full", "mid"), "full", "mid", RUN_STEPS);
    }

    expect(fullRun()).toEqual(fullRun());
  });
});

// ---------------------------------------------------------------------------
// G. Track choice is a second, independent demonstration of the shared grip
// budget: a tighter corner (hairpin) demands more lateral force at the same
// speed than a gentle sweep, so identical drivetrain/surface/throttle
// settings saturate an axle sooner on the hairpin — no new physics, just a
// smaller radius (and, per its own calibration, a larger autosteerFraction)
// to hold. See spec/brief.md and docs/model-assumptions.md's TRACK_PRESETS
// section for the calibration reasoning.
// ---------------------------------------------------------------------------
describe("G. track choice changes saturation timing — hairpin vs. sweep", () => {
  // Generous bound, same reasoning as section E's RUN_STEPS.
  const CAP_STEPS = Math.round(constants.SAFETY_CAP_SECONDS / FIXED_TIMESTEP);

  function stepsToSaturation(
    track: TrackId,
    throttleIntensity: ThrottleIntensityId,
    drivetrain: DrivetrainId = "RWD",
  ): number {
    let state = startedRun(drivetrain, "dry", throttleIntensity, "early", track);
    for (let i = 1; i <= CAP_STEPS; i++) {
      const controls = controlsForState(state, CAR_PARAMS, FIXED_TIMESTEP);
      state = step(state, controls, FIXED_TIMESTEP);
      if (state.front.saturated || state.rear.saturated) return i;
      if (physics.shouldFinish(state)) break;
    }
    return Number.POSITIVE_INFINITY;
  }

  it("the hairpin reaches axle saturation sooner than the sweep under identical drivetrain/surface/throttle settings", () => {
    const sweepSteps = stepsToSaturation("sweep-right", "medium");
    const hairpinSteps = stepsToSaturation("hairpin-right", "medium");
    expect(hairpinSteps).toBeLessThan(sweepSteps);
  });

  it("left/right hairpins of the same sharpness saturate at the same point (exact mirror images)", () => {
    const leftSteps = stepsToSaturation("hairpin-left", "medium");
    const rightSteps = stepsToSaturation("hairpin-right", "medium");
    expect(leftSteps).toBe(rightSteps);
  });

  it("at a throttle intensity too light for the sweep to saturate at all, the tighter hairpin still does (AWD)", () => {
    // AWD splits drive demand 50/50, leaving more per-axle longitudinal
    // headroom than FWD/RWD — at "medium" that's enough for the sweep to
    // stay unsaturated for the whole run, while the hairpin's extra lateral
    // demand alone tips it over. This is requirement (a)'s literal case: the
    // same discrete intensity setting saturates on the hairpin but not the
    // sweep.
    const sweepSaturates = stepsToSaturation("sweep-right", "medium", "AWD") < Number.POSITIVE_INFINITY;
    const hairpinSaturates = stepsToSaturation("hairpin-right", "medium", "AWD") < Number.POSITIVE_INFINITY;
    expect(sweepSaturates).toBe(false);
    expect(hairpinSaturates).toBe(true);
  });
});
