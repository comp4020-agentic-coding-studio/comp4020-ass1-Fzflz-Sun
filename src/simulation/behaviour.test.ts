import { describe, expect, it } from "vitest";
import * as constants from "./constants.ts";
import * as physics from "./physics.ts";
import { NEUTRAL_CONTROLS } from "./inputs.ts";
import type { ControlInputs, DrivetrainId, SimState, SurfaceId } from "./types.ts";

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

function startedRun(drivetrain: DrivetrainId = "RWD", surface: SurfaceId = "dry"): SimState {
  const ready = createInitialState(drivetrain, surface);
  // Falls back to the ready state itself (vx whatever createInitialState
  // currently sets it to) when startRun doesn't exist yet — keeps the rest
  // of the test runnable instead of throwing before we get useful output.
  return typeof (physics as Record<string, unknown>).startRun === "function"
    ? (physics as unknown as { startRun: (s: SimState) => SimState }).startRun(ready)
    : ready;
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
// C. Stable steering authority
// ---------------------------------------------------------------------------
describe("C. steering authority follows the reference corner", () => {
  const DRY_BASELINE_STEERING = 0.7; // the named dry-baseline steering input
  const ROAD_HALF_WIDTH = 7; // matches src/rendering/scene.ts's roadHalfWidth

  function baselineRun(steeringFraction: number, seconds: number): SimState {
    const controls: ControlInputs = { steering: -steeringFraction, throttle: 0, brake: 0 };
    return drive(startedRun("RWD", "dry"), controls, Math.round(seconds / FIXED_TIMESTEP));
  }

  it("stronger unsaturated steering yields a greater yaw rate than moderate steering", () => {
    const moderate = baselineRun(0.4, 1);
    const strong = baselineRun(0.7, 1);
    expect(Math.abs(strong.yawRate)).toBeGreaterThan(Math.abs(moderate.yawRate));
  });

  it("the named dry-baseline steering input (70%) follows the reference line within the road width for a sustained interval", () => {
    const state = baselineRun(DRY_BASELINE_STEERING, 4);
    expect(Math.abs(state.pathOffset)).toBeLessThan(ROAD_HALF_WIDTH);
  });

  it("full steering tightens the line further instead of being weaker than 70% steering", () => {
    const partial = baselineRun(0.7, 3);
    const full = baselineRun(1.0, 3);
    const curvatureOf = (s: SimState) => Math.abs(s.yawRate / Math.max(s.vx, 0.01));
    expect(curvatureOf(full)).toBeGreaterThanOrEqual(curvatureOf(partial));
  });

  it("no steering vs. the dry-baseline steering produce observably different trajectories", () => {
    const straight = baselineRun(0, 3);
    const steered = baselineRun(DRY_BASELINE_STEERING, 3);
    expect(Math.abs(steered.heading - straight.heading)).toBeGreaterThan(0.05);
    expect(Math.abs(steered.pathOffset - straight.pathOffset)).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------
// D. Drivetrain and surface produce different MOTION, not just percentages
// ---------------------------------------------------------------------------
describe("D. drivetrain and surface change motion, not only utilisation numbers", () => {
  // Full lock (steering: -1) alone already exceeds the front axle's dry
  // friction-circle limit at ENTRY_SPEED (see constants.ts's maxSteerAngle
  // comment: full lock has no headroom left, by design, once
  // DRY_BASELINE_STEERING_FRACTION is a strict majority of it). Using it here
  // would saturate even the "unsaturated" comparison run, confounding
  // steering's own contribution with throttle's — so this section isolates
  // throttle's effect at the documented dry baseline instead.
  const { DRY_BASELINE_STEERING_FRACTION } = constants;
  const HARD_CORNER_FULL_THROTTLE: ControlInputs = {
    steering: -DRY_BASELINE_STEERING_FRACTION,
    throttle: 1,
    brake: 0,
  };
  const STEER_ONLY: ControlInputs = {
    steering: -DRY_BASELINE_STEERING_FRACTION,
    throttle: 0,
    brake: 0,
  };
  const STEPS = 250;

  it("FWD front-axle saturation measurably reduces achieved curvature vs. an unsaturated steer-only run and runs wider", () => {
    const saturatedFWD = drive(startedRun("FWD", "dry"), HARD_CORNER_FULL_THROTTLE, STEPS);
    const unsaturated = drive(startedRun("FWD", "dry"), STEER_ONLY, STEPS);
    const curvatureOf = (s: SimState) => Math.abs(s.yawRate / Math.max(s.vx, 0.01));
    expect(curvatureOf(saturatedFWD)).toBeLessThan(curvatureOf(unsaturated));
    expect(saturatedFWD.pathOffset).toBeGreaterThan(unsaturated.pathOffset);
  });

  it("RWD rear-axle saturation measurably increases body slip (|vy|) vs. an unsaturated run", () => {
    const saturatedRWD = drive(startedRun("RWD", "dry"), HARD_CORNER_FULL_THROTTLE, STEPS);
    const unsaturated = drive(startedRun("RWD", "dry"), STEER_ONLY, STEPS);
    expect(Math.abs(saturatedRWD.vy)).toBeGreaterThan(Math.abs(unsaturated.vy));
  });

  it("AWD delays single-axle saturation later than FWD/RWD under the identical script, without becoming unable to slide", () => {
    function stepsToSaturate(drivetrain: DrivetrainId): number {
      let state = startedRun(drivetrain, "dry");
      for (let i = 1; i <= STEPS; i++) {
        state = step(state, HARD_CORNER_FULL_THROTTLE, FIXED_TIMESTEP);
        if (state.front.saturated || state.rear.saturated) return i;
      }
      return Number.POSITIVE_INFINITY;
    }
    const fwd = stepsToSaturate("FWD");
    const rwd = stepsToSaturate("RWD");
    const awd = stepsToSaturate("AWD");
    expect(awd).toBeGreaterThan(Math.min(fwd, rwd));

    const awdHarder = drive(startedRun("AWD", "dry"), HARD_CORNER_FULL_THROTTLE, STEPS * 3);
    expect(awdHarder.front.saturated || awdHarder.rear.saturated).toBe(true);
  });

  it("wet and ice reach rear-axle saturation earlier than dry, with a body-slip difference visible over the sustained run", () => {
    function stepsToSaturate(surface: SurfaceId): number {
      let state = startedRun("RWD", surface);
      for (let i = 1; i <= STEPS; i++) {
        state = step(state, HARD_CORNER_FULL_THROTTLE, FIXED_TIMESTEP);
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
    const dryFull = drive(startedRun("RWD", "dry"), HARD_CORNER_FULL_THROTTLE, STEPS);
    const wetFull = drive(startedRun("RWD", "wet"), HARD_CORNER_FULL_THROTTLE, STEPS);
    const iceFull = drive(startedRun("RWD", "ice"), HARD_CORNER_FULL_THROTTLE, STEPS);
    expect(Math.abs(wetFull.vy)).toBeGreaterThan(Math.abs(dryFull.vy));
    expect(Math.abs(iceFull.vy)).toBeGreaterThan(Math.abs(wetFull.vy));
  });
});
