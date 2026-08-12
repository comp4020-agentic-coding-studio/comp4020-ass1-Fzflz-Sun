import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { TRACK_PRESETS } from "../simulation/constants.ts";
import type { TrackParams } from "../simulation/index.ts";
import { trackCentre } from "../simulation/track.ts";

// asset-loader.ts's real loadAsset() hits the network via GLTFLoader — not
// something vitest/jsdom can do. Mocking it here lets this test simulate
// exactly the failure mode requirement IV is about: one decorative prop's
// GLB 404s or otherwise fails to load. Before the fix, environment.ts's
// placeInstance() awaited loadAsset() with no catch, so one rejection
// propagated through scatterField/scatterTrackFurniture's Promise.all and
// rejected buildScenery's own promise wholesale — a single missing rock
// would have broken every other prop's placement too.
//
// Each mocked asset returns a real (if trivial) box mesh, not a bare empty
// THREE.Group — fitAssetToSpec() needs a non-degenerate bbox to measure and
// scale from (an empty group has no size along any axis, which
// fitAssetToSpec correctly rejects — see asset-fit.test.ts's own "throws on
// zero size" case), and this file's placement/spacing/orientation tests all
// depend on the fitted size actually reflecting each mock's chosen raw
// dimensions.
vi.mock("./asset-loader.ts", () => ({
  ASSET_PATHS: {
    vehicle: "mock://vehicle.glb",
    barrier: "mock://barrier.glb",
    post: "mock://post.glb",
    pylon: "mock://pylon.glb",
    treeDefault: "mock://tree-default.glb",
    treePine: "mock://tree-pine.glb",
    treeDetailed: "mock://tree-detailed.glb",
    rockLarge: "mock://rock-large.glb",
    rockSmall: "mock://rock-small.glb",
  },
  async loadAsset(url: string): Promise<THREE.Group> {
    if (url === "mock://rock-large.glb") throw new Error("simulated 404");
    const root = new THREE.Group();
    // A distinctly non-cubic raw box (3m long along X, 0.9m tall, 1m deep)
    // for the barrier specifically, so its fitted length (used to derive
    // barrier spacing) is easy to reason about and unmistakably different
    // from a cube's. Every other mock uses a plain 1x1x1 cube — fine, since
    // those tests only care about height-fitting and orientation, not
    // length-derived spacing.
    const size: [number, number, number] = url === "mock://barrier.glb" ? [3, 0.9, 1] : [1, 1, 1];
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), new THREE.MeshStandardMaterial());
    root.add(mesh);
    return root;
  },
}));

/** Ground-truth rotation helper, matching THREE.Matrix4.makeRotationY's own
 * convention exactly (see coordinates.ts's derivation comment) — used here
 * to independently recompute a placed wrapper's actual world-space forward
 * direction from its `rotation.y`, without importing anything from
 * coordinates.ts itself. */
function rotateLocalXZ(rotationY: number, lx: number, lz: number): { x: number; z: number } {
  const cos = Math.cos(rotationY);
  const sin = Math.sin(rotationY);
  return { x: lx * cos + lz * sin, z: -lx * sin + lz * cos };
}

function childrenNamed(group: THREE.Group, name: string): THREE.Object3D[] {
  return group.children.filter((child) => child.name === name);
}

/** Recovers the arc angle (theta) a world-space point sits at, relative to
 * the track's own centre of curvature — the inverse of track-geometry.ts's
 * `pointOnArc`, reconstructed independently here (not imported) so this
 * test verifies the actual placed geometry, not just that environment.ts
 * calls the same helper it's tested against. */
function thetaOf(track: TrackParams, worldX: number, worldZ: number): number {
  const { cx, cy } = trackCentre(track);
  const simX = worldX;
  const simY = -worldZ;
  return Math.atan2(simY - cy, simX - cx);
}

describe("buildScenery", () => {
  it("resolves even when one scattered asset fails to load, instead of rejecting the whole scatter batch", async () => {
    const track = TRACK_PRESETS["sweep-right"];
    const { buildScenery } = await import("./environment.ts");
    await expect(buildScenery(track)).resolves.toBeInstanceOf(THREE.Group);
  });

  it("still places the assets that did load successfully around a failed one", async () => {
    const track = TRACK_PRESETS["sweep-right"];
    const { buildScenery } = await import("./environment.ts");
    const group = await buildScenery(track);
    expect(group.children.length).toBeGreaterThan(0);
  });

  it("scatters the same layout twice in a row for the same track (deterministic seeding)", async () => {
    const track = TRACK_PRESETS["hairpin-left"];
    const { buildScenery } = await import("./environment.ts");

    const snapshot = (group: THREE.Group) =>
      group.children
        .map((child) => `${child.name}|${child.position.x.toFixed(5)},${child.position.y.toFixed(5)},${child.position.z.toFixed(5)}|${child.rotation.y.toFixed(5)}`)
        .sort();

    const first = await buildScenery(track);
    const second = await buildScenery(track);

    expect(snapshot(second)).toEqual(snapshot(first));
  });

  it("places pylon markers as a small fixed 'gate' at each end of the track, resolving its previously-unused state", async () => {
    const track = TRACK_PRESETS["sweep-right"];
    const { buildScenery } = await import("./environment.ts");
    const group = await buildScenery(track);

    const pylons = childrenNamed(group, "pylon.glb");
    expect(pylons.length).toBe(4);
    // Sparingly used, per-end, as documented — not a handful scattered
    // arbitrarily throughout the whole track.
    expect(pylons.length).toBeLessThan(10);
  });

  it("derives barrier spacing from the asset's own fitted length, not a fixed distance independent of that size", async () => {
    const track = TRACK_PRESETS["sweep-right"];
    const { buildScenery, BARRIER_SPEC, BARRIER_GAP_METERS } = await import("./environment.ts");
    const { fitAssetToSpec } = await import("./asset-fit.ts");
    const { loadAsset } = await import("./asset-loader.ts");

    // Independently re-derive the expected fitted length from the same
    // mocked raw geometry this test's loadAsset mock returns for the
    // barrier, rather than hardcoding a number that would silently drift
    // out of sync with either the mock or BARRIER_SPEC.
    const barrierRoot = await loadAsset("mock://barrier.glb");
    const { size: fittedBarrierSize } = fitAssetToSpec(barrierRoot, BARRIER_SPEC);
    const expectedSpacing = fittedBarrierSize.x + BARRIER_GAP_METERS;

    const group = await buildScenery(track);
    const barriers = childrenNamed(group, "barrier.glb").map((child) => thetaOf(track, child.position.x, child.position.z));
    expect(barriers.length).toBeGreaterThan(2);

    barriers.sort((a, b) => a - b);
    const arcDistances: number[] = [];
    for (let i = 1; i < barriers.length; i++) {
      arcDistances.push(Math.abs(barriers[i] - barriers[i - 1]) * track.radius);
    }
    for (const distance of arcDistances) {
      expect(distance).toBeCloseTo(expectedSpacing, 2);
    }
    // The old, replaced behaviour was a fixed 14m interval regardless of
    // the asset's own size — with this mock's 3m-long barrier, that would
    // have been wildly out of proportion. Guard against a regression back
    // to an interval disconnected from the fitted size.
    expect(expectedSpacing).toBeLessThan(10);
  });

  it.each(Object.entries(TRACK_PRESETS))("aligns barrier segments to the arc's own tangent direction on %s", async (_name, track) => {
    const { buildScenery } = await import("./environment.ts");
    const group = await buildScenery(track);
    const direction = track.direction === "left" ? 1 : -1;

    const barriers = childrenNamed(group, "barrier.glb");
    expect(barriers.length).toBeGreaterThan(0);

    for (const barrier of barriers) {
      const theta = thetaOf(track, barrier.position.x, barrier.position.z);
      const expectedTangentSim = { x: Math.cos(theta + direction * (Math.PI / 2)), y: Math.sin(theta + direction * (Math.PI / 2)) };
      const expectedTangentWorld = { x: expectedTangentSim.x, z: -expectedTangentSim.y };

      // barrier.glb's confirmed long axis is local +X (see environment.ts's
      // BARRIER_SPEC comment) — rotate that axis by the wrapper's own
      // rotation.y and compare against the tangent direction independently
      // recomputed above from the wrapper's recovered position, not from
      // whatever theta the production scatter loop happened to use
      // internally.
      const actualForward = rotateLocalXZ(barrier.rotation.y, 1, 0);
      const dot = actualForward.x * expectedTangentWorld.x + actualForward.z * expectedTangentWorld.z;
      expect(dot).toBeCloseTo(1, 5);
    }
  });

  it.each(Object.entries(TRACK_PRESETS))("aims each light post's arm toward the track's own centre of curvature on %s", async (_name, track) => {
    const { buildScenery } = await import("./environment.ts");
    const group = await buildScenery(track);
    const { cx, cy } = trackCentre(track);

    const posts = childrenNamed(group, "post.glb");
    expect(posts.length).toBeGreaterThan(0);

    for (const post of posts) {
      const simX = post.position.x;
      const simY = -post.position.z;
      const towardCentreSim = { x: cx - simX, y: cy - simY };
      const length = Math.hypot(towardCentreSim.x, towardCentreSim.y);
      const expectedWorld = { x: towardCentreSim.x / length, z: -towardCentreSim.y / length };

      // lightPostModern.glb's confirmed lamp-arm axis is local +Z (see
      // environment.ts's POST_SPEC comment).
      const actualArm = rotateLocalXZ(post.rotation.y, 0, 1);
      const dot = actualArm.x * expectedWorld.x + actualArm.z * expectedWorld.z;
      expect(dot).toBeCloseTo(1, 5);

      // Only rotation.y is ever touched — the post can never tip away from
      // vertical no matter which way its arm points.
      expect(post.rotation.x).toBe(0);
      expect(post.rotation.z).toBe(0);
    }
  });
});
