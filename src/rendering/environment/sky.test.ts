import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { TRACK_PRESETS } from "../../simulation/constants.ts";

/** Regression coverage for the late-run sky-clipping bug: the sky dome/sun
 * disc/clouds are built once at the origin (see sky.ts) but the chase
 * camera legitimately drifts tens of metres off-centre as it sweeps any
 * corner (TRACK_PRESETS radius 40-45m, sweepAngle 90-150 degrees). The fix
 * makes the "sky" group camera-relative (re-anchored to the camera's X/Z
 * every frame — see scene.ts's update()) and derives the camera's far plane
 * from the sky's own real geometry rather than from FOG_FAR_METERS, which
 * has nothing to do with how far the sky extends. These tests exercise the
 * real exported geometry/configuration contracts, not source text. */

function isDirectionalLight(node: THREE.Object3D): node is THREE.DirectionalLight {
  return node instanceof THREE.DirectionalLight;
}

describe("SKY_RENDER_EXTENT_METERS", () => {
  it("is derived from the sky's own real geometry (dome radius, sun disc distance+radius, cloud cluster worst case), not picked independently of it", async () => {
    const { SKY_RENDER_EXTENT_METERS } = await import("./sky.ts");
    const { buildStaticEnvironment } = await import("./index.ts");
    const group = buildStaticEnvironment();

    // Sky dome: SphereGeometry(radius, ...) — every vertex sits at exactly
    // `radius` from the sky group's local origin by construction. Measured
    // directly off the position attribute rather than via
    // `geometry.computeBoundingSphere()`: that method centres its sphere on
    // the *bounding box's* centre, not the local origin, and since this dome
    // is a partial sphere sliced past the equator (thetaLength = PI/1.9),
    // its bounding box is off-centre along Y — inflating the reported
    // radius well past the dome's real 380m and producing a false failure
    // here unrelated to the actual sky geometry.
    const dome = group.getObjectByName("sky-dome") as THREE.Mesh;
    const domePosition = dome.geometry.getAttribute("position") as THREE.BufferAttribute;
    let domeRadius = 0;
    const domeVertex = new THREE.Vector3();
    for (let i = 0; i < domePosition.count; i++) {
      domeVertex.fromBufferAttribute(domePosition, i);
      domeRadius = Math.max(domeRadius, domeVertex.length());
    }
    // Tiny epsilon absorbs float accumulation in the sin/cos vertex
    // positions (observed ~1.6e-5m), not a real gap in sky coverage.
    expect(SKY_RENDER_EXTENT_METERS).toBeGreaterThanOrEqual(domeRadius - 1e-3);

    // Sun disc: a flat circle at a fixed distance from the origin — its
    // furthest point is that distance plus its own radius.
    const disc = group.getObjectByName("sun-disc") as THREE.Mesh;
    disc.geometry.computeBoundingSphere();
    const discFarthestPoint = disc.position.length() + disc.geometry.boundingSphere!.radius;
    expect(SKY_RENDER_EXTENT_METERS).toBeGreaterThanOrEqual(discFarthestPoint);

    // Cloud clusters: each cluster's own children (puffs) may extend beyond
    // the cluster's own anchor position — measure every actual puff's
    // farthest point from the sky's local origin directly from the built
    // geometry, not from the constants that produced it.
    const clouds = group.getObjectByName("clouds") as THREE.Group;
    let farthestCloudPoint = 0;
    for (const cluster of clouds.children) {
      for (const puff of cluster.children) {
        if (!(puff instanceof THREE.Mesh)) continue;
        puff.geometry.computeBoundingSphere();
        const worldOffset = cluster.position.clone().add(puff.position);
        const distance = worldOffset.length() + puff.geometry.boundingSphere!.radius;
        farthestCloudPoint = Math.max(farthestCloudPoint, distance);
      }
    }
    expect(farthestCloudPoint).toBeGreaterThan(0);
    expect(SKY_RENDER_EXTENT_METERS).toBeGreaterThanOrEqual(farthestCloudPoint);
  });
});

describe("skyAnchorPosition", () => {
  it("follows the camera's X/Z exactly, leaving Y at 0", async () => {
    const { skyAnchorPosition } = await import("./sky.ts");

    expect(skyAnchorPosition(0, 0)).toEqual({ x: 0, y: 0, z: 0 });
    expect(skyAnchorPosition(123.4, -56.7)).toEqual({ x: 123.4, y: 0, z: -56.7 });
    expect(skyAnchorPosition(-300, 220)).toEqual({ x: -300, y: 0, z: 220 });
  });
});

describe("camera-relative sky keeps the sun disc aligned with the light direction at any camera position", () => {
  it.each([
    { x: 0, z: 0 },
    { x: 120, z: -45 },
    { x: -38, z: 62 },
    { x: -300, z: 220 },
  ])("camera at (%o)", async (cameraPosition) => {
    const { skyAnchorPosition } = await import("./sky.ts");
    const { buildStaticEnvironment } = await import("./index.ts");
    const group = buildStaticEnvironment();

    const sky = group.getObjectByName("sky") as THREE.Group;
    const disc = group.getObjectByName("sun-disc") as THREE.Mesh;
    const [sun] = group.children.filter(isDirectionalLight);

    // Reproduce exactly what scene.ts's update() does every frame: move
    // only the "sky" group to track the camera's X/Z. The directional light
    // is a sibling of "sky" inside the same environment-static group, so it
    // is deliberately left untouched here — it must stay world-space.
    const anchor = skyAnchorPosition(cameraPosition.x, cameraPosition.z);
    sky.position.set(anchor.x, anchor.y, anchor.z);
    sky.updateMatrixWorld(true);

    const discWorldPosition = new THREE.Vector3();
    disc.getWorldPosition(discWorldPosition);
    const cameraToDisc = discWorldPosition.clone().sub(new THREE.Vector3(cameraPosition.x, 0, cameraPosition.z)).normalize();
    const lightDirection = sun.position.clone().normalize();

    expect(cameraToDisc.dot(lightDirection)).toBeCloseTo(1, 5);
  });

  it("leaves the directional light and ground untouched by the sky's own translation (world-space environment is not coupled to the camera-relative sky)", async () => {
    const { skyAnchorPosition } = await import("./sky.ts");
    const { buildStaticEnvironment } = await import("./index.ts");
    const group = buildStaticEnvironment();

    const sky = group.getObjectByName("sky") as THREE.Group;
    const ground = group.getObjectByName("ground") as THREE.Mesh;
    const [sun] = group.children.filter(isDirectionalLight);

    const sunPositionBefore = sun.position.clone();
    const groundPositionBefore = ground.position.clone();

    const anchor = skyAnchorPosition(250, -175);
    sky.position.set(anchor.x, anchor.y, anchor.z);

    expect(sun.position.equals(sunPositionBefore)).toBe(true);
    expect(ground.position.equals(groundPositionBefore)).toBe(true);
  });
});

describe("sky configuration is independent of track selection", () => {
  it("buildSky/buildStaticEnvironment take no track parameter, so no track (or direction) can influence the sky's construction", async () => {
    const { buildSky } = await import("./sky.ts");
    const { buildStaticEnvironment } = await import("./index.ts");

    expect(buildSky.length).toBe(0);
    expect(buildStaticEnvironment.length).toBe(0);
  });

  it.each(Object.keys(TRACK_PRESETS))(
    "produces an identical sky (dome/sun/cloud) layout across independent builds regardless of the currently-selected track (checked while %s would be selected)",
    async () => {
      const { buildStaticEnvironment } = await import("./index.ts");

      const snapshotSky = (group: THREE.Group) => {
        const sky = group.getObjectByName("sky") as THREE.Group;
        const parts: string[] = [];
        sky.traverse((node) => {
          parts.push(`${node.name}|${node.position.x.toFixed(5)},${node.position.y.toFixed(5)},${node.position.z.toFixed(5)}`);
        });
        return parts;
      };

      // buildStaticEnvironment has no track input at all (asserted above),
      // so this is the same call made twice — the point is to demonstrate
      // the resulting sky layout is stable/deterministic and not silently
      // reading some ambient "currently selected track" global.
      const first = snapshotSky(buildStaticEnvironment());
      const second = snapshotSky(buildStaticEnvironment());
      expect(second).toEqual(first);
    },
  );
});
