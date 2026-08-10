import { describe, expect, it } from "vitest";
import {
  approach,
  approachAngle,
  CAMERA_POSITION_TIME_CONSTANT_SECONDS,
  CAMERA_ROTATION_TIME_CONSTANT_SECONDS,
  nextCameraPose,
} from "./camera.ts";

describe("approach (exponential-decay convergence toward a step-change target)", () => {
  it("does not move before any time has passed", () => {
    expect(approach(0, 100, 0, 0.05)).toBe(0);
  });

  it("converges toward the target as time passes, not instantly", () => {
    const afterOneStep = approach(0, 100, 0.016, 0.05);
    expect(afterOneStep).toBeGreaterThan(0);
    expect(afterOneStep).toBeLessThan(100);
  });

  it("is within ~5% of a step-change target after three time constants", () => {
    const tau = 0.05;
    const value = approach(0, 100, 3 * tau, tau);
    expect(value).toBeGreaterThan(94);
    expect(value).toBeLessThan(96);
  });

  it("effectively reaches the target well before a saturation episode could play out", () => {
    // Three time constants at CAMERA_POSITION_TIME_CONSTANT_SECONDS is the
    // bound documented in camera.ts and CLAUDE.md's camera rule — it must
    // stay far shorter than a track preset's multi-second traversal so the
    // lag never masks the moment an axle saturates.
    const settleSeconds = 3 * CAMERA_POSITION_TIME_CONSTANT_SECONDS;
    expect(settleSeconds).toBeLessThan(0.2);
  });
});

describe("approachAngle (same convergence, but takes the shorter way around the +/-pi seam)", () => {
  it("crosses the wrap seam the short way, not the long way around", () => {
    const almostPi = Math.PI - 0.02; // ~179 degrees
    const justPastNegativePi = -Math.PI + 0.02; // ~-179 degrees, 4-degree gap across the seam
    const tau = 0.05;
    const value = approachAngle(almostPi, justPastNegativePi, 3 * tau, tau);
    // A correct short-way wrap lands just past +pi (wrapped back near -pi);
    // the long way around would instead undershoot toward 0.
    expect(Math.abs(value)).toBeGreaterThan(3.0);
  });
});

describe("nextCameraPose (the eased pose the chase camera actually uses)", () => {
  const target = { x: 100, y: -50, rotation: Math.PI / 2 };

  it("snaps directly to the target when easing is disabled (reduced motion, or a fresh-run teleport)", () => {
    const current = { x: 0, y: 0, rotation: 0 };
    const next = nextCameraPose(current, target, 0.016, false);
    expect(next).toEqual(target);
  });

  it("gradually approaches the target when easing is enabled, rather than snapping every frame", () => {
    const current = { x: 0, y: 0, rotation: 0 };
    const next = nextCameraPose(current, target, 0.016, true);
    expect(next.x).toBeGreaterThan(0);
    expect(next.x).toBeLessThan(target.x);
    expect(next.rotation).toBeGreaterThan(0);
    expect(next.rotation).toBeLessThan(target.rotation);
  });

  it("converges rotation within ~5% of a step change after 3x the rotation time constant", () => {
    const current = { x: target.x, y: target.y, rotation: 0 };
    const settleSeconds = 3 * CAMERA_ROTATION_TIME_CONSTANT_SECONDS;
    const next = nextCameraPose(current, target, settleSeconds, true);
    expect(next.rotation).toBeGreaterThan(target.rotation * 0.94);
  });
});
