import { describe, expect, it } from "vitest";
import { type Camera, horizonScreenY, project, type Viewport } from "./projection.ts";

// A camera sitting at the world origin, facing +x (yaw 0), tilted down slightly,
// looking over flat ground (z=0 everywhere, matching the physics model). Not
// the app's tuned chase-camera constants — this is a plain, arbitrary pinhole
// camera used to pin down the projection *geometry* in isolation, the same way
// camera.test.ts exercises `approach` with arbitrary numbers rather than the
// app's actual time constants.
const camera: Camera = { x: 0, y: 0, yaw: 0, height: 1.5, pitch: 0.25, focalLength: 800 };
const viewport: Viewport = { width: 1000, height: 600 };

describe("project (ground-plane pinhole projection)", () => {
  it("projects a point straight ahead to horizontal centre and marks it visible", () => {
    const point = project(20, 0, camera, viewport);
    expect(point.visible).toBe(true);
    expect(point.screenX).toBeCloseTo(viewport.width / 2, 5);
  });

  it("does not mark a point behind the camera as visible", () => {
    const point = project(-50, 0, camera, viewport);
    expect(point.visible).toBe(false);
  });

  it("shrinks a farther point and moves it closer to the horizon than a nearer one", () => {
    const near = project(20, 0, camera, viewport);
    const far = project(200, 0, camera, viewport);
    expect(far.visible).toBe(true);
    expect(far.scale).toBeLessThan(near.scale);
    const horizon = horizonScreenY(camera, viewport);
    expect(Math.abs(far.screenY - horizon)).toBeLessThan(Math.abs(near.screenY - horizon));
  });

  it("flips which side of the screen a point projects to when its lateral sign flips", () => {
    // At yaw 0, +worldY is directly leftward of the camera's facing direction
    // (matching physics.ts's body-frame convention: +y is left of +x/forward).
    const left = project(20, 5, camera, viewport);
    const right = project(20, -5, camera, viewport);
    expect(left.visible).toBe(true);
    expect(right.visible).toBe(true);
    expect(left.screenX).toBeLessThan(viewport.width / 2);
    expect(right.screenX).toBeGreaterThan(viewport.width / 2);
  });
});
