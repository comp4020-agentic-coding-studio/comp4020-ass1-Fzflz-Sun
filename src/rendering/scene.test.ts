import { describe, expect, it } from "vitest";

/** Regression coverage for the late-run sky-clipping bug: CAMERA_FAR_METERS
 * used to be derived purely from FOG_FAR_METERS (`FOG_FAR_METERS + 40` =
 * 260m), far short of the sky dome (380m radius), sun disc (340m distance),
 * and cloud layer (up to ~300m distance + 150m height) built once at the
 * world origin. Since the sky is now camera-relative (re-anchored to the
 * camera's X/Z every frame — see scene.ts's update() and sky.ts's
 * skyAnchorPosition), the camera-to-sky distance is always exactly
 * SKY_RENDER_EXTENT_METERS regardless of where the camera has travelled to,
 * so the far plane only needs to clear that one figure, not fog distance. */
describe("CAMERA_FAR_METERS", () => {
  it("exceeds the sky's own maximum rendering extent (with a safety margin), not just the fog distance", async () => {
    const { CAMERA_FAR_METERS } = await import("./scene.ts");
    const { SKY_RENDER_EXTENT_METERS } = await import("./environment/sky.ts");

    expect(CAMERA_FAR_METERS).toBeGreaterThan(SKY_RENDER_EXTENT_METERS);
  });

  it("still exceeds the fog far distance (fog must finish hiding world geometry well inside the far plane)", async () => {
    const { CAMERA_FAR_METERS } = await import("./scene.ts");
    const { FOG_FAR_METERS } = await import("./environment/index.ts");

    expect(CAMERA_FAR_METERS).toBeGreaterThan(FOG_FAR_METERS);
  });
});
