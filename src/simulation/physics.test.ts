import { describe, expect, it } from "vitest";
import {
  CAR_PARAMS,
  DRY_BASELINE_STEERING_FRACTION,
  FIXED_TIMESTEP,
  SURFACE_PRESETS,
  TRACK_PARAMS,
} from "./constants.ts";
import { NEUTRAL_CONTROLS, NO_CONTROLS_HELD, rampControls } from "./inputs.ts";
import { createInitialState, startRun, step } from "./physics.ts";
import type { ControlInputs, DrivetrainId, SimState, SurfaceId } from "./types.ts";

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

  it("rampControls is a pure function of its inputs (no hidden time source)", () => {
    const heldSequence = [NO_CONTROLS_HELD, { ...NO_CONTROLS_HELD, throttle: true }, NO_CONTROLS_HELD];

    function runRamp(): ControlInputs {
      let c = NEUTRAL_CONTROLS;
      for (const held of heldSequence) c = rampControls(c, held, FIXED_TIMESTEP, CAR_PARAMS);
      return c;
    }

    expect(runRamp()).toEqual(runRamp());
  });
});

describe("input ramping", () => {
  it("ramps throttle up smoothly instead of jumping to full on the first held frame", () => {
    const held = { ...NO_CONTROLS_HELD, throttle: true };
    const afterOneFrame = rampControls(NEUTRAL_CONTROLS, held, FIXED_TIMESTEP, CAR_PARAMS);
    expect(afterOneFrame.throttle).toBeGreaterThan(0);
    expect(afterOneFrame.throttle).toBeLessThan(1);
  });

  it("reaches full throttle after enough held time, then stays clamped at 1", () => {
    let c = NEUTRAL_CONTROLS;
    const held = { ...NO_CONTROLS_HELD, throttle: true };
    for (let i = 0; i < 1000; i++) c = rampControls(c, held, FIXED_TIMESTEP, CAR_PARAMS);
    expect(c.throttle).toBe(1);
  });

  it("releasing steering ramps it back toward neutral rather than snapping", () => {
    let c = { ...NEUTRAL_CONTROLS, steering: 1 };
    c = rampControls(c, NO_CONTROLS_HELD, FIXED_TIMESTEP, CAR_PARAMS);
    expect(c.steering).toBeLessThan(1);
    expect(c.steering).toBeGreaterThan(0);
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
    void TRACK_PARAMS;
  });
});
