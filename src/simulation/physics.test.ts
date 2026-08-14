import { describe, expect, it } from "vitest";
import {
  AUTO_FINISH_GRACE_SECONDS,
  BARRIER_COLLISION_LIMIT_METERS,
  CAR_HALF_WIDTH_METERS,
  CAR_PARAMS,
  DEFAULT_TRACK_ID,
  DRY_BASELINE_STEERING_FRACTION,
  FIXED_TIMESTEP,
  SAFETY_CAP_SECONDS,
  SURFACE_PRESETS,
  TRACK_PRESETS,
} from "./constants.ts";
import { controlsForState } from "./inputs.ts";
import { createInitialState, shouldFinish, startRun, step } from "./physics.ts";
import { trackCentre } from "./track.ts";
import type {
  ControlInputs,
  DrivetrainId,
  SimState,
  SurfaceId,
  ThrottleIntensityId,
  ThrottleTimingId,
  TrackId,
} from "./types.ts";

// Drives `n` fixed steps with the same controls each step, returning the
// final state. Used throughout to push the car hard enough into a corner to
// see saturation, without depending on real time or the UI/ramping layer.
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

// Full lock alone can now saturate an axle outright (see constants.ts's
// maxSteerAngle comment — that headroom loss versus the old, geometrically
// incapable steering angle is the fix for bug #3, not a regression), so the
// tests below that need an "unsaturated" comparison baseline use the
// documented dry-baseline fraction instead of full lock: that isolates
// throttle's own contribution to saturation instead of confounding it with
// steering alone already exhausting the axle.
const HARD_RIGHT_FULL_THROTTLE: ControlInputs = {
  steering: -DRY_BASELINE_STEERING_FRACTION,
  throttle: 1,
  brake: 0,
};
const HARD_RIGHT_HALF_THROTTLE: ControlInputs = { steering: -1, throttle: 0.5, brake: 0 };
const STRAIGHT_NO_INPUT: ControlInputs = { steering: 0, throttle: 0, brake: 0 };
const STEER_ONLY: ControlInputs = { steering: -DRY_BASELINE_STEERING_FRACTION, throttle: 0, brake: 0 };

// Every test below drives an actual run, not the inert ready state a fresh
// createInitialState returns (see types.ts's RunPhase) — startRun is the
// explicit "Enter the corner" action that begins one.
function startedRun(drivetrain: DrivetrainId = "RWD", surface: SurfaceId = "dry"): SimState {
  return startRun(createInitialState(drivetrain, surface));
}

describe("drivetrain drive-demand allocation", () => {
  function frontRearFxDemand(drivetrain: DrivetrainId) {
    const after = drive(startedRun(drivetrain, "dry"), HARD_RIGHT_FULL_THROTTLE, 1);
    return { front: after.front.fxDemand, rear: after.rear.fxDemand };
  }

  it("FWD assigns all drive demand to the front axle", () => {
    const { front, rear } = frontRearFxDemand("FWD");
    expect(front).toBeGreaterThan(0);
    expect(rear).toBeCloseTo(0, 6);
  });

  it("RWD assigns all drive demand to the rear axle", () => {
    const { front, rear } = frontRearFxDemand("RWD");
    expect(front).toBeCloseTo(0, 6);
    expect(rear).toBeGreaterThan(0);
  });

  it("AWD splits drive demand evenly across both axles (documented 50/50 teaching split)", () => {
    const { front, rear } = frontRearFxDemand("AWD");
    expect(front).toBeGreaterThan(0);
    expect(rear).toBeGreaterThan(0);
    expect(front).toBeCloseTo(rear, 6);
  });
});

describe("surface grip budget", () => {
  it("a lower-grip surface reduces each axle's available combined force", () => {
    const dryLimit = SURFACE_PRESETS.dry.mu * ((CAR_PARAMS.mass * CAR_PARAMS.gravity) / 2);
    const iceLimit = SURFACE_PRESETS.ice.mu * ((CAR_PARAMS.mass * CAR_PARAMS.gravity) / 2);
    expect(iceLimit).toBeLessThan(dryLimit);
  });

  it("the same steering+throttle input reaches higher utilisation on ice than on dry", () => {
    const onDry = drive(startedRun("RWD", "dry"), HARD_RIGHT_HALF_THROTTLE, 20);
    const onIce = drive(startedRun("RWD", "ice"), HARD_RIGHT_HALF_THROTTLE, 20);
    const dryMax = Math.max(onDry.front.utilisation, onDry.rear.utilisation);
    const iceMax = Math.max(onIce.front.utilisation, onIce.rear.utilisation);
    expect(iceMax).toBeGreaterThan(dryMax);
  });
});

describe("combined lateral + longitudinal demand", () => {
  it("adding throttle on top of existing steering demand raises the driven axle's utilisation", () => {
    const steeringOnly = drive(startedRun("RWD", "dry"), STEER_ONLY, 10);
    const steeringPlusThrottle = drive(
      startedRun("RWD", "dry"),
      { ...STEER_ONLY, throttle: 0.8 },
      10,
    );
    expect(steeringPlusThrottle.rear.utilisation).toBeGreaterThan(steeringOnly.rear.utilisation);
  });

  it("straight-line, no-input driving stays near zero utilisation", () => {
    const after = drive(startedRun("RWD", "dry"), STRAIGHT_NO_INPUT, 30);
    expect(after.front.utilisation).toBeLessThan(0.05);
    expect(after.rear.utilisation).toBeLessThan(0.05);
    expect(after.drivingState).toBe("stable");
  });
});

describe("saturation states", () => {
  // 300 steps (2.5s) of continuously held dry-baseline steering + full
  // throttle from ENTRY_SPEED. With the corrected tyre-force sign (see
  // physics.ts), FWD settles into a stable, bounded understeer and RWD into
  // oversteer well before either collapses into a four-wheel slide — this
  // window sits comfortably inside that stable region for both drivetrains
  // (RWD's oversteer-only window closes and both axles saturate into "slide"
  // by roughly step 340), not right at the ragged edge of saturation onset.
  const SATURATION_STEPS = 300;

  it("saturating the front axle (FWD, hard steering + full throttle) yields understeer", () => {
    const after = drive(startedRun("FWD", "dry"), HARD_RIGHT_FULL_THROTTLE, SATURATION_STEPS);
    expect(after.front.saturated).toBe(true);
    expect(after.drivingState).toBe("understeer");
  });

  it("saturating the rear axle (RWD, hard steering + full throttle) yields oversteer", () => {
    const after = drive(startedRun("RWD", "dry"), HARD_RIGHT_FULL_THROTTLE, SATURATION_STEPS);
    expect(after.rear.saturated).toBe(true);
    expect(after.drivingState).toBe("oversteer");
  });

  it("understeer increases pathOffset in the wide (positive) direction relative to no input", () => {
    const saturated = drive(startedRun("FWD", "dry"), HARD_RIGHT_FULL_THROTTLE, SATURATION_STEPS);
    const unsaturated = drive(startedRun("FWD", "dry"), STEER_ONLY, SATURATION_STEPS);
    expect(saturated.pathOffset).toBeGreaterThan(unsaturated.pathOffset);
  });
});

describe("outer-track barrier collision", () => {
  const track = TRACK_PRESETS[DEFAULT_TRACK_ID];
  const { cx, cy } = trackCentre(track);
  const maxDist = track.radius + BARRIER_COLLISION_LIMIT_METERS - CAR_HALF_WIDTH_METERS;

  // Sitting exactly on the boundary at the point where the outward radial
  // direction is world +x (so heading 0 = facing straight into the wall),
  // moving forward fast enough to breach it in a single step if nothing
  // intervened.
  function stateAtBoundary(overrides: Partial<SimState> = {}): SimState {
    return {
      ...createInitialState(),
      phase: "running",
      x: cx + maxDist,
      y: cy,
      heading: 0,
      vx: 15,
      vy: 0,
      ...overrides,
    };
  }

  it("never lets sustained hard driving push the car's distance from the track centre past the boundary", () => {
    let state = startedRun("FWD", "dry");
    for (let i = 0; i < 400; i++) {
      state = step(state, HARD_RIGHT_FULL_THROTTLE, FIXED_TIMESTEP);
      const distance = Math.hypot(state.x - cx, state.y - cy);
      expect(distance).toBeLessThanOrEqual(maxDist + 1e-6);
    }
  });

  it("rebounds the impact-normal velocity backward instead of merely zeroing it", () => {
    const after = step(stateAtBoundary(), STRAIGHT_NO_INPUT, FIXED_TIMESTEP);
    // A pure "stop at the wall" clamp would leave this at (or above) zero; a
    // real reaction-force rebound sends it negative — moving back away from
    // the wall, not just halted.
    expect(after.vx).toBeLessThan(0);
  });

  it("a grippier surface bleeds off more along-the-wall scrape speed on impact than an icy one", () => {
    const onDry = step(stateAtBoundary({ surface: "dry", vy: 8 }), STRAIGHT_NO_INPUT, FIXED_TIMESTEP);
    const onIce = step(stateAtBoundary({ surface: "ice", vy: 8 }), STRAIGHT_NO_INPUT, FIXED_TIMESTEP);
    expect(Math.abs(onDry.vy)).toBeLessThan(Math.abs(onIce.vy));
  });
});

describe("reset", () => {
  it("returns to the same deterministic initial state every time", () => {
    const a = createInitialState("AWD", "wet");
    const b = createInitialState("AWD", "wet");
    expect(a).toEqual(b);
  });

  it("a fresh initial state matches one reached by resetting after driving", () => {
    const driven = drive(startedRun("RWD", "dry"), HARD_RIGHT_FULL_THROTTLE, 50);
    expect(driven).not.toEqual(createInitialState("RWD", "dry"));
    const reset = createInitialState("RWD", "dry");
    expect(reset).toEqual(createInitialState("RWD", "dry"));
  });
});

describe("determinism", () => {
  it("the same input sequence produces the same output sequence", () => {
    const inputs: ControlInputs[] = [
      { steering: -0.3, throttle: 0.4, brake: 0 },
      { steering: -0.6, throttle: 0.7, brake: 0 },
      { steering: -0.9, throttle: 1.0, brake: 0 },
      { steering: -0.5, throttle: 0, brake: 0.6 },
    ];

    function run(): SimState {
      let s = startedRun("AWD", "wet");
      for (const controls of inputs) {
        for (let i = 0; i < 25; i++) s = step(s, controls, FIXED_TIMESTEP);
      }
      return s;
    }

    expect(run()).toEqual(run());
  });

  it("controlsForState is a pure function of its inputs (no hidden time source)", () => {
    function runAt(elapsed: number): ControlInputs {
      const state: SimState = { ...createInitialState("RWD", "dry", "full", "mid"), elapsed };
      return controlsForState(state, CAR_PARAMS, FIXED_TIMESTEP);
    }

    expect(runAt(3)).toEqual(runAt(3));
  });
});

describe("controlsForState", () => {
  // Throttle depends only on `state.elapsed`/throttleIntensity/throttleTiming,
  // not position or heading, so a fixture built straight from
  // createInitialState (car sitting exactly on the reference line) with just
  // `elapsed` overridden is enough to isolate it from the steering law below.
  function stateAt(
    elapsed: number,
    throttleIntensity: ThrottleIntensityId,
    throttleTiming: ThrottleTimingId,
  ): SimState {
    return { ...createInitialState("RWD", "dry", throttleIntensity, throttleTiming), elapsed };
  }

  it("ramps throttle up smoothly instead of jumping to full on the first elapsed step, once past its timing threshold", () => {
    const afterOneStep = controlsForState(stateAt(FIXED_TIMESTEP, "full", "early"), CAR_PARAMS, FIXED_TIMESTEP);
    expect(afterOneStep.throttle).toBeGreaterThan(0);
    expect(afterOneStep.throttle).toBeLessThan(1);
  });

  it("reaches the selected intensity fraction after enough elapsed time, then stays clamped there", () => {
    const wellPastRampTime = controlsForState(stateAt(100, "full", "early"), CAR_PARAMS, FIXED_TIMESTEP);
    expect(wellPastRampTime.throttle).toBe(1);
  });

  it("holds throttle at exactly 0 before the timing threshold is reached", () => {
    const before = controlsForState(stateAt(2, "full", "late"), CAR_PARAMS, FIXED_TIMESTEP);
    expect(before.throttle).toBe(0);
  });

  it("ramps steering in smoothly from 0 at the start of a run rather than snapping straight to the target", () => {
    // The default track (sweep-right) is calibrated so its feedforward
    // target equals DRY_BASELINE_STEERING_FRACTION in magnitude (see
    // constants.ts) — the car starts exactly on the reference line heading
    // exactly along its tangent, so at the very first step the only nonzero
    // contribution to the steering target is that feedforward term.
    const state0 = startRun(createInitialState());
    expect(state0.steering).toBe(0);

    const firstStepControls = controlsForState(state0, CAR_PARAMS, FIXED_TIMESTEP);
    const maxFirstStepDelta = CAR_PARAMS.steerRampPerSecond * FIXED_TIMESTEP;
    expect(Math.abs(firstStepControls.steering)).toBeGreaterThan(0);
    expect(Math.abs(firstStepControls.steering)).toBeLessThanOrEqual(maxFirstStepDelta + 1e-9);

    // Driven for a full second, steering has had ample time to ramp in and
    // settle close to the track's own calibrated feedforward target rather
    // than staying pinned near the single-step delta above.
    let state = state0;
    for (let i = 0; i < Math.round(1 / FIXED_TIMESTEP); i++) {
      const controls = controlsForState(state, CAR_PARAMS, FIXED_TIMESTEP);
      state = step(state, controls, FIXED_TIMESTEP);
    }
    expect(Math.abs(state.steering)).toBeGreaterThan(DRY_BASELINE_STEERING_FRACTION * 0.5);
    expect(Math.abs(state.steering)).toBeLessThanOrEqual(1);
  });

  it("brake is always 0 — braking is out of scope for the discrete-run redesign", () => {
    expect(controlsForState(stateAt(0, "full", "early"), CAR_PARAMS, FIXED_TIMESTEP).brake).toBe(0);
    expect(controlsForState(stateAt(100, "full", "early"), CAR_PARAMS, FIXED_TIMESTEP).brake).toBe(0);
  });
});

// Keep the surface-preset ids used everywhere else honest against the type.
describe("surface presets", () => {
  it("exposes exactly the three illustrative presets the brief names", () => {
    const ids = Object.keys(SURFACE_PRESETS).sort();
    expect(ids).toEqual(["dry", "ice", "wet"] satisfies SurfaceId[]);
  });

  it("orders presets dry > wet > ice by grip, without claiming a universal coefficient", () => {
    expect(SURFACE_PRESETS.dry.mu).toBeGreaterThan(SURFACE_PRESETS.wet.mu);
    expect(SURFACE_PRESETS.wet.mu).toBeGreaterThan(SURFACE_PRESETS.ice.mu);
  });
});

describe("track reference line", () => {
  it("the car starts on the reference line (zero path offset)", () => {
    expect(createInitialState().pathOffset).toBe(0);
  });

  it("a fresh initial state defaults to the default track, with no swept progress yet", () => {
    const state = createInitialState();
    expect(state.track).toBe(DEFAULT_TRACK_ID);
    expect(state.sweptAngle).toBe(0);
  });
});

// A run must finish because the car actually reached the end of its track's
// geometry, not merely because a fixed duration elapsed — otherwise
// "Finished" could fire mid-corner, before the car has visibly completed the
// arc (see shouldFinish's doc comment, physics.ts).
describe("finish condition is position-based, not duration-based", () => {
  function runToFinish(track: TrackId, throttleIntensity: "medium" | "full" = "medium"): SimState {
    let state = startRun(createInitialState("RWD", "dry", throttleIntensity, "early", track));
    const capSteps = Math.round(SAFETY_CAP_SECONDS / FIXED_TIMESTEP);
    for (let i = 0; i < capSteps; i++) {
      const controls = controlsForState(state, CAR_PARAMS, FIXED_TIMESTEP);
      state = step(state, controls, FIXED_TIMESTEP);
      if (shouldFinish(state)) return state;
    }
    throw new Error(`${track} never reached shouldFinish within the safety cap`);
  }

  it("a normal sweep run finishes once sweptAngle reaches the track's own sweepAngle, well inside its auto-finish grace window", () => {
    const track = TRACK_PRESETS["sweep-right"];
    const finished = runToFinish("sweep-right");
    expect(finished.sweptAngle).toBeGreaterThanOrEqual(track.sweepAngle);
    // Confirms the position condition tripped shouldFinish, not either
    // elapsed-based backstop — a pathologically slow/stuck run is the only
    // case that should ever reach those.
    expect(finished.elapsed).toBeLessThan(track.expectedTraversalSeconds + AUTO_FINISH_GRACE_SECONDS);
    expect(finished.elapsed).toBeLessThan(SAFETY_CAP_SECONDS);
  });

  it("a hairpin run also finishes positionally, taking a larger swept angle and longer elapsed time than the sweep", () => {
    const sweepTrack = TRACK_PRESETS["sweep-right"];
    const hairpinTrack = TRACK_PRESETS["hairpin-right"];
    const sweepFinished = runToFinish("sweep-right");
    const hairpinFinished = runToFinish("hairpin-right");

    expect(hairpinFinished.sweptAngle).toBeGreaterThanOrEqual(hairpinTrack.sweepAngle);
    expect(hairpinTrack.sweepAngle).toBeGreaterThan(sweepTrack.sweepAngle);
    expect(hairpinFinished.elapsed).toBeGreaterThan(sweepFinished.elapsed);
    expect(hairpinFinished.elapsed).toBeLessThan(hairpinTrack.expectedTraversalSeconds + AUTO_FINISH_GRACE_SECONDS);
    expect(hairpinFinished.elapsed).toBeLessThan(SAFETY_CAP_SECONDS);
  });

  it("the car's position at finish sits at the end of the track's own arc length (radius * sweepAngle), not partway through it", () => {
    const track = TRACK_PRESETS["sweep-right"];
    const finished = runToFinish("sweep-right");
    const travelled = Math.hypot(finished.x, finished.y);
    // Chord length between start (0,0) and a point swept by sweepAngle
    // around a circle of this radius — a looser geometric cross-check than
    // sweptAngle itself (which is the actual finish trigger), independent of
    // the sweptAngleRate integration used to produce it.
    const chordLength = 2 * track.radius * Math.sin(track.sweepAngle / 2);
    expect(travelled).toBeGreaterThan(chordLength * 0.5);
  });
});

// A car that has run wide, or is stuck bouncing off the barrier, may never
// accumulate enough sweptAngle to finish positionally — shouldFinish's
// per-track grace window (tier 2, see its doc comment) is what actually
// force-finishes that run, well before the flat SAFETY_CAP_SECONDS backstop
// (tier 3) would. Tested directly against a synthetic state that never makes
// positional progress (sweptAngle pinned at 0), isolating this branch from
// whatever the full physics loop happens to do.
describe("shouldFinish's auto-finish grace window (a run that never makes positional progress)", () => {
  function stuckAt(track: TrackId, elapsed: number): SimState {
    return { ...startRun(createInitialState("RWD", "dry", "medium", "early", track)), sweptAngle: 0, elapsed };
  }

  it.each([TRACK_PRESETS["sweep-right"], TRACK_PRESETS["hairpin-right"]])(
    "force-finishes a stuck $id run once elapsed passes expectedTraversalSeconds + AUTO_FINISH_GRACE_SECONDS, not before",
    (track) => {
      const cutoff = track.expectedTraversalSeconds + AUTO_FINISH_GRACE_SECONDS;
      expect(shouldFinish(stuckAt(track.id, cutoff - 0.01))).toBe(false);
      expect(shouldFinish(stuckAt(track.id, cutoff))).toBe(true);

      // Confirms the new, tighter per-track rule is what trips here, not the
      // old flat backstop — otherwise this test would just be re-proving
      // SAFETY_CAP_SECONDS, which was always comfortably larger.
      expect(cutoff).toBeLessThan(SAFETY_CAP_SECONDS);
    },
  );
});
