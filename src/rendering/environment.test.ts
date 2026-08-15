import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { TRACK_PRESETS } from "../simulation/constants.ts";
import type { TrackParams } from "../simulation/index.ts";
import { trackCentre } from "../simulation/track.ts";
import { arcAngles, KERB_WIDTH_METERS, ROAD_HALF_WIDTH } from "./track-geometry.ts";

// asset-loader.ts's real loadAsset() hits the network via GLTFLoader — not
// something vitest/jsdom can do. Mocking it here lets this test simulate
// exactly the failure mode requirement IV is about: one decorative prop's
// GLB 404s or otherwise fails to load. Before the original fix,
// environment.ts's placeInstance() awaited loadAsset() with no catch, so one
// rejection propagated through scatterField/scatterTrackFurniture's
// Promise.all and rejected buildScenery's own promise wholesale — a single
// missing rock would have broken every other prop's placement too.
//
// This mock covers every ASSET_PATHS key the split environment/ modules
// reference (trackside furniture+vegetation, midground, landmarks, distant),
// not just the original barrier/post/pylon/tree/rock set — the pack-aware
// loadAsset(url, pack) signature is mocked with a `pack` parameter too, even
// though every mock here ignores it (real pack-specific colormap resolution
// happens inside the real asset-loader.ts, which is the exact thing this
// mock replaces).
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
    vehicle: "mock://sedan.glb",
    vehicleColormap: "mock://vehicle-colormap.png",
    miniForestColormap: "mock://mini-forest-colormap.png",

    barrier: "mock://barrierWhite.glb",
    post: "mock://lightPostModern.glb",
    pylon: "mock://pylon.glb",
    fenceCurved: "mock://fenceCurved.glb",

    grandStandCovered: "mock://grandStandCovered.glb",
    grandStandRound: "mock://grandStandRound.glb",
    grandStandCoveredRound: "mock://grandStandCoveredRound.glb",
    pitsGarage: "mock://pitsGarage.glb",
    pitsGarageCorner: "mock://pitsGarageCorner.glb",
    pitsOffice: "mock://pitsOffice.glb",
    overheadRound: "mock://overheadRound.glb",
    billboardLow: "mock://billboardLow.glb",
    flagCheckers: "mock://flagCheckers.glb",

    treeDefault: "mock://tree_default.glb",
    treePine: "mock://tree_pineRoundA.glb",
    treeDetailed: "mock://tree_detailed.glb",
    treeFat: "mock://tree_fat.glb",
    treeCone: "mock://tree_cone.glb",
    rockLarge: "mock://rock_largeA.glb",
    rockSmall: "mock://rock_smallA.glb",
    rockTall: "mock://rock_tallA.glb",
    grass: "mock://grass.glb",
    grassLarge: "mock://grass_large.glb",
    grassLeafs: "mock://grass_leafs.glb",
    flowerPurple: "mock://flower_purpleA.glb",
    flowerRed: "mock://flower_redA.glb",
    flowerYellow: "mock://flower_yellowA.glb",
    plantBush: "mock://plant_bush.glb",
    plantBushSmall: "mock://plant_bushSmall.glb",
    plantBushDetailed: "mock://plant_bushDetailed.glb",
    plantBushLarge: "mock://plant_bushLarge.glb",
    log: "mock://log.glb",
    logLarge: "mock://log_large.glb",
    stumpOld: "mock://stump_old.glb",
    stumpRound: "mock://stump_round.glb",
    cliffLargeRock: "mock://cliff_large_rock.glb",
    cliffTopRock: "mock://cliff_top_rock.glb",

    distantTree: "mock://tree.glb",
    distantTreeHigh: "mock://tree-high.glb",
    distantRocksHigh: "mock://rocks-high.glb",
    distantRocksLow: "mock://rocks-low.glb",
    distantVan: "mock://van.glb",
  },
  async loadAsset(url: string, _pack?: string): Promise<THREE.Group> {
    if (url === "mock://rock_largeA.glb") throw new Error("simulated 404");
    const root = new THREE.Group();
    // A distinctly non-cubic raw box (3m long along X, 0.9m tall, 1m deep)
    // for the barrier specifically, so its fitted length (used to derive
    // barrier spacing) is easy to reason about and unmistakably different
    // from a cube's. Every other mock uses a plain 1x1x1 cube — fine, since
    // those tests only care about height-fitting and orientation, not
    // length-derived spacing.
    const size: [number, number, number] = url === "mock://barrierWhite.glb" ? [3, 0.9, 1] : [1, 1, 1];
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
 * test verifies the actual placed geometry, not just that the environment
 * modules call the same helper they're tested against. */
function thetaOf(track: TrackParams, worldX: number, worldZ: number): number {
  const { cx, cy } = trackCentre(track);
  const simX = worldX;
  const simY = -worldZ;
  return Math.atan2(simY - cy, simX - cx);
}

/** Recovers the radial distance from the track's own centre of curvature to
 * a world-space point — used by every exclusion-zone/distance-band test
 * below to check a placed instance's own layer band, independent of
 * whichever internal formula the scatter layer used to compute it. */
function radialDistanceFromCentre(track: TrackParams, worldX: number, worldZ: number): number {
  const { cx, cy } = trackCentre(track);
  const simX = worldX;
  const simY = -worldZ;
  return Math.hypot(simX - cx, simY - cy);
}

/** Unit world-space vector from a world-space point toward the track's own
 * centre of curvature — shared by every landmark orientation test that
 * checks a "faces the track" placement (grandstand/pits/billboard/van). */
function towardCentreWorldUnit(track: TrackParams, worldX: number, worldZ: number): { x: number; z: number } {
  const { cx, cy } = trackCentre(track);
  const simX = worldX;
  const simY = -worldZ;
  const towardCentreSim = { x: cx - simX, y: cy - simY };
  const length = Math.hypot(towardCentreSim.x, towardCentreSim.y);
  return { x: towardCentreSim.x / length, z: -towardCentreSim.y / length };
}

/** Unit world-space tangent vector at arc angle `theta`, in the track's own
 * direction of travel — shared by every "runs alongside the road" test
 * (barrier, fence, flag). The gantry is deliberately excluded: it spans
 * *across* the road (radially), not alongside it — see
 * `towardCentreWorldUnit`, used by its own orientation test below. */
function tangentWorldUnit(theta: number, direction: number): { x: number; z: number } {
  const tangentSim = { x: Math.cos(theta + direction * (Math.PI / 2)), y: Math.sin(theta + direction * (Math.PI / 2)) };
  return { x: tangentSim.x, z: -tangentSim.y };
}

const TRACKSIDE_VEGETATION_NAMES = [
  "grass.glb",
  "grass_large.glb",
  "grass_leafs.glb",
  "flower_purpleA.glb",
  "flower_redA.glb",
  "flower_yellowA.glb",
  "plant_bush.glb",
  "plant_bushSmall.glb",
];

const MIDGROUND_NAMES = [
  "tree_default.glb",
  "tree_pineRoundA.glb",
  "tree_detailed.glb",
  "tree_fat.glb",
  "tree_cone.glb",
  "rock_largeA.glb",
  "rock_smallA.glb",
  "rock_tallA.glb",
  "plant_bushDetailed.glb",
  "plant_bushLarge.glb",
  "log.glb",
  "log_large.glb",
  "stump_old.glb",
  "stump_round.glb",
];

const DISTANT_NAMES = ["tree.glb", "tree-high.glb", "rocks-high.glb", "rocks-low.glb", "cliff_large_rock.glb", "cliff_top_rock.glb"];

// Documented layer bands from the plan (trackside 2-15m, midground 15-60m
// beyond the kerb+barrier line; distant 80-180m from the track's own centre)
// — asserted here as the public contract each layer must honour, not by
// reaching into each layer module's own private band constants.
const TRACKSIDE_MIN_OFFSET_METERS = 2;
const TRACKSIDE_MAX_OFFSET_METERS = 15;
const MIDGROUND_MIN_OFFSET_METERS = 15;
const MIDGROUND_MAX_OFFSET_METERS = 60;
const DISTANT_MIN_RADIUS_METERS = 80;
const DISTANT_MAX_RADIUS_METERS = 180;
const BAND_EPSILON = 1e-3;

describe("buildScenery", () => {
  it("resolves even when one scattered asset fails to load, instead of rejecting the whole scatter batch", async () => {
    const track = TRACK_PRESETS["sweep-right"];
    const { buildScenery } = await import("./environment/index.ts");
    await expect(buildScenery(track)).resolves.toBeInstanceOf(THREE.Group);
  });

  it("still places the assets that did load successfully around a failed one", async () => {
    const track = TRACK_PRESETS["sweep-right"];
    const { buildScenery } = await import("./environment/index.ts");
    const group = await buildScenery(track);
    expect(group.children.length).toBeGreaterThan(0);
  });

  it("scatters the same layout twice in a row for the same track (deterministic seeding)", async () => {
    const track = TRACK_PRESETS["hairpin-left"];
    const { buildScenery } = await import("./environment/index.ts");

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
    const { buildScenery } = await import("./environment/index.ts");
    const group = await buildScenery(track);

    const pylons = childrenNamed(group, "pylon.glb");
    expect(pylons.length).toBe(4);
    // Sparingly used, per-end, as documented — not a handful scattered
    // arbitrarily throughout the whole track.
    expect(pylons.length).toBeLessThan(10);
  });

  it("derives barrier spacing from the asset's own fitted length, not a fixed distance independent of that size", async () => {
    const track = TRACK_PRESETS["sweep-right"];
    const { buildScenery } = await import("./environment/index.ts");
    const { BARRIER_SPEC, BARRIER_GAP_METERS } = await import("./environment/asset-catalog.ts");
    const { fitAssetToSpec } = await import("./asset-fit.ts");
    const { loadAsset } = await import("./asset-loader.ts");

    // Independently re-derive the expected fitted length from the same
    // mocked raw geometry this test's loadAsset mock returns for the
    // barrier, rather than hardcoding a number that would silently drift
    // out of sync with either the mock or BARRIER_SPEC.
    const barrierRoot = await loadAsset("mock://barrierWhite.glb");
    const { size: fittedBarrierSize } = fitAssetToSpec(barrierRoot, BARRIER_SPEC);
    const expectedSpacing = fittedBarrierSize.x + BARRIER_GAP_METERS;

    const group = await buildScenery(track);
    const barriers = childrenNamed(group, "barrierWhite.glb").map((child) => thetaOf(track, child.position.x, child.position.z));
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
    const { buildScenery } = await import("./environment/index.ts");
    const group = await buildScenery(track);
    const direction = track.direction === "left" ? 1 : -1;

    const barriers = childrenNamed(group, "barrierWhite.glb");
    expect(barriers.length).toBeGreaterThan(0);

    for (const barrier of barriers) {
      const theta = thetaOf(track, barrier.position.x, barrier.position.z);
      const expectedTangentWorld = tangentWorldUnit(theta, direction);

      // barrierWhite.glb's confirmed long axis is local +X (see
      // asset-catalog.ts's BARRIER_SPEC comment) — rotate that axis by the
      // wrapper's own rotation.y and compare against the tangent direction
      // independently recomputed above from the wrapper's recovered
      // position, not from whatever theta the production scatter loop
      // happened to use internally.
      const actualForward = rotateLocalXZ(barrier.rotation.y, 1, 0);
      const dot = actualForward.x * expectedTangentWorld.x + actualForward.z * expectedTangentWorld.z;
      expect(dot).toBeCloseTo(1, 5);
    }
  });

  it.each(Object.entries(TRACK_PRESETS))("aims each light post's arm toward the track's own centre of curvature on %s", async (_name, track) => {
    const { buildScenery } = await import("./environment/index.ts");
    const group = await buildScenery(track);

    const posts = childrenNamed(group, "lightPostModern.glb");
    expect(posts.length).toBeGreaterThan(0);

    for (const post of posts) {
      const expectedWorld = towardCentreWorldUnit(track, post.position.x, post.position.z);

      // lightPostModern.glb's confirmed lamp-arm axis is local +Z (see
      // asset-catalog.ts's POST_SPEC comment).
      const actualArm = rotateLocalXZ(post.rotation.y, 0, 1);
      const dot = actualArm.x * expectedWorld.x + actualArm.z * expectedWorld.z;
      expect(dot).toBeCloseTo(1, 5);

      // Only rotation.y is ever touched — the post can never tip away from
      // vertical no matter which way its arm points.
      expect(post.rotation.x).toBe(0);
      expect(post.rotation.z).toBe(0);
    }
  });

  it.each(Object.entries(TRACK_PRESETS))("places two tangent-aligned fence accents (one per end) on %s", async (_name, track) => {
    const { buildScenery } = await import("./environment/index.ts");
    const group = await buildScenery(track);
    const direction = track.direction === "left" ? 1 : -1;

    const fences = childrenNamed(group, "fenceCurved.glb");
    expect(fences.length).toBe(2);

    for (const fence of fences) {
      const theta = thetaOf(track, fence.position.x, fence.position.z);
      const expectedTangentWorld = tangentWorldUnit(theta, direction);
      const actualForward = rotateLocalXZ(fence.rotation.y, 1, 0);
      const dot = actualForward.x * expectedTangentWorld.x + actualForward.z * expectedTangentWorld.z;
      expect(dot).toBeCloseTo(1, 5);
    }
  });

  it.each(Object.entries(TRACK_PRESETS))("keeps trackside vegetation within its 2-15m off-road band on %s", async (_name, track) => {
    const { buildScenery } = await import("./environment/index.ts");
    const group = await buildScenery(track);

    const instances = group.children.filter((child) => TRACKSIDE_VEGETATION_NAMES.includes(child.name));
    expect(instances.length).toBeGreaterThan(0);

    for (const instance of instances) {
      const radial = radialDistanceFromCentre(track, instance.position.x, instance.position.z);
      const band = Math.abs(radial - track.radius) - (ROAD_HALF_WIDTH + KERB_WIDTH_METERS);
      expect(band).toBeGreaterThanOrEqual(TRACKSIDE_MIN_OFFSET_METERS - BAND_EPSILON);
      expect(band).toBeLessThanOrEqual(TRACKSIDE_MAX_OFFSET_METERS + BAND_EPSILON);
      // y=0 anchoring: every placed instance sits on the ground plane, no
      // matter which layer scattered it.
      expect(instance.position.y).toBe(0);
    }
  });

  it.each(Object.entries(TRACK_PRESETS))("keeps midground scenery within its 15-60m off-road band on %s", async (_name, track) => {
    const { buildScenery } = await import("./environment/index.ts");
    const group = await buildScenery(track);

    const instances = group.children.filter((child) => MIDGROUND_NAMES.includes(child.name));
    expect(instances.length).toBeGreaterThan(0);

    for (const instance of instances) {
      const radial = radialDistanceFromCentre(track, instance.position.x, instance.position.z);
      const band = radial - track.radius - (ROAD_HALF_WIDTH + KERB_WIDTH_METERS);
      expect(band).toBeGreaterThanOrEqual(MIDGROUND_MIN_OFFSET_METERS - BAND_EPSILON);
      expect(band).toBeLessThanOrEqual(MIDGROUND_MAX_OFFSET_METERS + BAND_EPSILON);
      expect(instance.position.y).toBe(0);
    }
  });

  it.each(Object.entries(TRACK_PRESETS))("keeps distant horizon scenery within its 80-180m radius band on %s", async (_name, track) => {
    const { buildScenery } = await import("./environment/index.ts");
    const group = await buildScenery(track);

    const instances = group.children.filter((child) => DISTANT_NAMES.includes(child.name));
    expect(instances.length).toBeGreaterThan(0);

    for (const instance of instances) {
      const radial = radialDistanceFromCentre(track, instance.position.x, instance.position.z);
      expect(radial).toBeGreaterThanOrEqual(DISTANT_MIN_RADIUS_METERS - BAND_EPSILON);
      expect(radial).toBeLessThanOrEqual(DISTANT_MAX_RADIUS_METERS + BAND_EPSILON);
      expect(instance.position.y).toBe(0);
    }
  });
});

// Landmarks are hand-placed, semantic set-pieces (grandstand/pits/gantry/
// billboard/flag/distant van) rather than pool-scattered like the other
// three layers — their own describe block since "correctly oriented" means
// something different per landmark (faces the track vs. spans the road vs.
// tangent to the finish line) rather than one shared band check.
describe("landmarks", () => {
  it.each(Object.entries(TRACK_PRESETS))("places the hairpin-appropriate grandstand variant facing the track on %s", async (_name, track) => {
    const { buildScenery } = await import("./environment/index.ts");
    const group = await buildScenery(track);

    const expectedName = track.id.startsWith("hairpin") ? "grandStandRound.glb" : "grandStandCovered.glb";
    const otherName = expectedName === "grandStandRound.glb" ? "grandStandCovered.glb" : "grandStandRound.glb";

    const grandstands = childrenNamed(group, expectedName);
    expect(grandstands.length).toBe(1);
    expect(childrenNamed(group, otherName).length).toBe(0);

    const [grandstand] = grandstands;
    const expectedWorld = towardCentreWorldUnit(track, grandstand.position.x, grandstand.position.z);
    // GRANDSTAND_*_SPEC's confirmed forward axis is local +Z.
    const actualForward = rotateLocalXZ(grandstand.rotation.y, 0, 1);
    const dot = actualForward.x * expectedWorld.x + actualForward.z * expectedWorld.z;
    expect(dot).toBeCloseTo(1, 5);
  });

  it.each(Object.entries(TRACK_PRESETS))("groups the three pit buildings with one shared, track-facing orientation on %s", async (_name, track) => {
    const { buildScenery } = await import("./environment/index.ts");
    const group = await buildScenery(track);

    const [garage] = childrenNamed(group, "pitsGarage.glb");
    const [office] = childrenNamed(group, "pitsOffice.glb");
    const [corner] = childrenNamed(group, "pitsGarageCorner.glb");
    expect(garage).toBeTruthy();
    expect(office).toBeTruthy();
    expect(corner).toBeTruthy();

    // All three buildings share one heading (grouped as a single
    // conceptual landmark) — checked as exact equality since they're all
    // placed with the identical computed headingSim value.
    expect(garage.rotation.y).toBeCloseTo(office.rotation.y, 10);
    expect(corner.rotation.y).toBeCloseTo(office.rotation.y, 10);

    // pitsOffice sits at the pit cluster's own base anchor with zero
    // tangential offset (the middle of three evenly-spaced buildings), so
    // its own actual position is the exact point the shared heading was
    // computed to face away from — the other two buildings are offset
    // tangentially and would only approximately satisfy this dot check.
    const expectedWorld = towardCentreWorldUnit(track, office.position.x, office.position.z);
    const actualForward = rotateLocalXZ(office.rotation.y, 0, 1);
    const dot = actualForward.x * expectedWorld.x + actualForward.z * expectedWorld.z;
    expect(dot).toBeCloseTo(1, 5);
  });

  it.each(Object.entries(TRACK_PRESETS))("spans the start line with a radially-aligned gantry on %s", async (_name, track) => {
    const { buildScenery } = await import("./environment/index.ts");
    const group = await buildScenery(track);

    const [gantry] = childrenNamed(group, "overheadRound.glb");
    expect(gantry).toBeTruthy();

    const radial = radialDistanceFromCentre(track, gantry.position.x, gantry.position.z);
    expect(radial).toBeCloseTo(track.radius, 3);

    // The gantry's fitted long (X) axis must run *across* the road (radially,
    // toward the centre of curvature), not alongside it like the barrier —
    // an overhead arch the car drives under, not a guardrail. A previous
    // version reused the barrier's tangent-heading formula here, which
    // rotated the gantry's 9m span to point down the track instead of across
    // it, putting the car's own start point inside the arch's side wall.
    const expectedRadialWorld = towardCentreWorldUnit(track, gantry.position.x, gantry.position.z);
    // GANTRY_SPEC's confirmed forward axis is local +X.
    const actualForward = rotateLocalXZ(gantry.rotation.y, 1, 0);
    const dot = actualForward.x * expectedRadialWorld.x + actualForward.z * expectedRadialWorld.z;
    expect(dot).toBeCloseTo(1, 5);
  });

  it.each(Object.entries(TRACK_PRESETS))("places a track-facing billboard on %s", async (_name, track) => {
    const { buildScenery } = await import("./environment/index.ts");
    const group = await buildScenery(track);

    const [billboard] = childrenNamed(group, "billboardLow.glb");
    expect(billboard).toBeTruthy();

    const expectedWorld = towardCentreWorldUnit(track, billboard.position.x, billboard.position.z);
    // BILLBOARD_SPEC's confirmed forward axis is local +Z.
    const actualForward = rotateLocalXZ(billboard.rotation.y, 0, 1);
    const dot = actualForward.x * expectedWorld.x + actualForward.z * expectedWorld.z;
    expect(dot).toBeCloseTo(1, 5);
  });

  it.each(Object.entries(TRACK_PRESETS))("plants a tangent-aligned checkered flag at the finish line on %s", async (_name, track) => {
    const { buildScenery } = await import("./environment/index.ts");
    const group = await buildScenery(track);
    const { end } = arcAngles(track);
    const direction = track.direction === "left" ? 1 : -1;

    const [flag] = childrenNamed(group, "flagCheckers.glb");
    expect(flag).toBeTruthy();

    const radial = radialDistanceFromCentre(track, flag.position.x, flag.position.z);
    expect(radial).toBeCloseTo(track.radius + ROAD_HALF_WIDTH + KERB_WIDTH_METERS, 3);

    const expectedTangentWorld = tangentWorldUnit(end, direction);
    // FLAG_SPEC's confirmed forward axis is local +X.
    const actualForward = rotateLocalXZ(flag.rotation.y, 1, 0);
    const dot = actualForward.x * expectedTangentWorld.x + actualForward.z * expectedTangentWorld.z;
    expect(dot).toBeCloseTo(1, 5);
  });

  it.each(Object.entries(TRACK_PRESETS))("places exactly one distant van near the pit cluster, facing the track, on %s", async (_name, track) => {
    const { buildScenery } = await import("./environment/index.ts");
    const group = await buildScenery(track);

    const vans = childrenNamed(group, "van.glb");
    expect(vans.length).toBe(1);

    const [van] = vans;
    const expectedWorld = towardCentreWorldUnit(track, van.position.x, van.position.z);
    // DISTANT_VAN_SPEC's confirmed forward axis is local +Z.
    const actualForward = rotateLocalXZ(van.rotation.y, 0, 1);
    const dot = actualForward.x * expectedWorld.x + actualForward.z * expectedWorld.z;
    expect(dot).toBeCloseTo(1, 5);
  });
});

/** placeInstance's own load-failure isolation, tested directly rather than
 * relying on a weighted-pool pick landing on a failing asset by chance —
 * MIDGROUND_ASSETS' rockLarge entry (mocked to throw above) may or may not
 * be drawn by the deterministic RNG for any given track/seed, so a
 * buildScenery-level-only test would be a flaky proxy for this behaviour.
 * Calling placeInstance directly with a known-throwing URL exercises the
 * exact isolation path deterministically. */
describe("placeInstance load-failure isolation", () => {
  it("returns null instead of throwing when the underlying asset load rejects", async () => {
    const { placeInstance } = await import("./environment/placement.ts");
    // ROCK_LARGE_SPEC isn't exported directly; MIDGROUND_ASSETS carries the
    // real spec this test needs without adding a test-only export.
    const { MIDGROUND_ASSETS } = await import("./environment/asset-catalog.ts");
    const rockLargeSpec = MIDGROUND_ASSETS.find((asset) => asset.id === "rockLarge")!.spec;

    const group = new THREE.Group();
    const result = await placeInstance(group, "mock://rock_largeA.glb", rockLargeSpec, { x: 0, y: 0 }, 0);
    expect(result).toBeNull();
    expect(group.children.length).toBe(0);
  });
});

describe("catalog coverage", () => {
  it("every trackside/midground/distant pool entry resolves to a known ASSET_PATHS URL", async () => {
    const { ASSET_PATHS } = await import("./asset-loader.ts");
    const { TRACKSIDE_VEGETATION, MIDGROUND_ASSETS, DISTANT_ASSETS } = await import("./environment/asset-catalog.ts");
    const knownUrls = new Set(Object.values(ASSET_PATHS));

    for (const pool of [TRACKSIDE_VEGETATION, MIDGROUND_ASSETS, DISTANT_ASSETS]) {
      expect(pool.length).toBeGreaterThan(0);
      for (const entry of pool) {
        expect(knownUrls.has(entry.url)).toBe(true);
      }
    }

    // Plan-mandated variety per layer (trackside ground-cover, midground
    // trees/rocks/deadwood, distant low-poly horizon) — a pool collapsing
    // back to just a couple of entries would be a real regression even if
    // every entry it did have still resolved correctly.
    expect(TRACKSIDE_VEGETATION.length).toBeGreaterThanOrEqual(6);
    expect(MIDGROUND_ASSETS.length).toBeGreaterThanOrEqual(10);
    expect(DISTANT_ASSETS.length).toBeGreaterThanOrEqual(4);
  });
});

// buildStaticEnvironment is synchronous and has no async asset load to wait
// on (sky dome, sun disc, clouds, ground plane, and lights are all
// procedural/built-in), unlike buildScenery above — this is exactly what
// makes the 3D stage visible on first paint, before Run is pressed and
// before any vehicle/scenery asset resolves (main.ts renders every frame
// regardless of run phase). These tests assert that everything the
// first-painted frame needs is present the instant this function returns,
// with no `await` required.
describe("buildStaticEnvironment", () => {
  it("synchronously returns a group containing a visible sky dome and ground mesh", async () => {
    const { buildStaticEnvironment } = await import("./environment/index.ts");
    const group = buildStaticEnvironment();

    const dome = group.getObjectByName("sky-dome");
    expect(dome).toBeInstanceOf(THREE.Mesh);

    const ground = group.getObjectByName("ground");
    expect(ground).toBeInstanceOf(THREE.Mesh);
    expect((ground as THREE.Mesh).receiveShadow).toBe(true);
  });

  it("includes the full dusk light rig — sun (with its target), hemisphere, and ambient — with no light disabled by omission", async () => {
    const { buildStaticEnvironment } = await import("./environment/index.ts");
    const group = buildStaticEnvironment();

    const sunLights = group.children.filter((child): child is THREE.DirectionalLight => child instanceof THREE.DirectionalLight);
    expect(sunLights.length).toBe(1);
    const [sun] = sunLights;
    expect(sun.castShadow).toBe(true);
    // The sun's target must be part of the same returned group, not left
    // dangling — a DirectionalLight with no reachable target defaults to
    // aiming at the world origin, which happens to be close to correct here
    // only by coincidence of where the track starts; asserting the real
    // target object is present rules out relying on that coincidence.
    expect(group.children).toContain(sun.target);

    const hemisphereLights = group.children.filter((child) => child instanceof THREE.HemisphereLight);
    expect(hemisphereLights.length).toBe(1);

    const ambientLights = group.children.filter((child) => child instanceof THREE.AmbientLight);
    expect(ambientLights.length).toBe(1);
  });

  it("aligns the procedural sun disc with the actual DirectionalLight's own direction", async () => {
    const { buildStaticEnvironment } = await import("./environment/index.ts");
    const group = buildStaticEnvironment();

    const disc = group.getObjectByName("sun-disc");
    expect(disc).toBeInstanceOf(THREE.Mesh);
    const [sun] = group.children.filter((child): child is THREE.DirectionalLight => child instanceof THREE.DirectionalLight);

    const discDirection = (disc as THREE.Mesh).position.clone().normalize();
    const sunDirection = sun.position.clone().normalize();
    expect(discDirection.dot(sunDirection)).toBeCloseTo(1, 5);
  });

  it("includes 5-9 low-poly static cloud clusters, laid out identically across independent builds (fixed seed, not track-derived)", async () => {
    const { buildStaticEnvironment } = await import("./environment/index.ts");
    const first = buildStaticEnvironment().getObjectByName("clouds") as THREE.Group;
    const second = buildStaticEnvironment().getObjectByName("clouds") as THREE.Group;

    expect(first).toBeInstanceOf(THREE.Group);
    expect(first.children.length).toBeGreaterThanOrEqual(5);
    expect(first.children.length).toBeLessThanOrEqual(9);
    expect(second.children.length).toBe(first.children.length);

    for (let i = 0; i < first.children.length; i++) {
      expect(first.children[i].name).toBe("cloud-cluster");
      expect(second.children[i].position.x).toBeCloseTo(first.children[i].position.x, 10);
      expect(second.children[i].position.y).toBeCloseTo(first.children[i].position.y, 10);
      expect(second.children[i].position.z).toBeCloseTo(first.children[i].position.z, 10);
    }
  });
});

// Ground-cover/mound placement is pure geometry (no GLB load), so this
// suite exercises it directly rather than through buildScenery/
// buildStaticEnvironment — every TRACK_PRESETS entry's own road corridor
// must stay decoration-free, not just the currently-selected one, since the
// ground is built once and never rebuilt on track switch.
describe("ground", () => {
  it("flags points on any track's own road corridor as near-road, regardless of which track is currently selected", async () => {
    const { isNearAnyTrackRoad } = await import("./environment/ground.ts");
    const { pointOnArc } = await import("./track-geometry.ts");

    for (const track of Object.values(TRACK_PRESETS)) {
      const { cx, cy } = trackCentre(track);
      const { start, end } = arcAngles(track);
      const midTheta = (start + end) / 2;
      const onRoad = pointOnArc({ x: cx, y: cy }, track.radius, midTheta);
      expect(isNearAnyTrackRoad(onRoad.x, onRoad.y)).toBe(true);
    }
  });

  it("flags a point far from every track's corridor as not near any road", async () => {
    const { isNearAnyTrackRoad } = await import("./environment/ground.ts");
    expect(isNearAnyTrackRoad(1000, 1000)).toBe(false);
  });

  it("never raises a mound on ground vertices that fall within any track's road corridor", async () => {
    const { buildGround, isNearAnyTrackRoad } = await import("./environment/ground.ts");
    const ground = buildGround();
    const position = ground.geometry.getAttribute("position") as THREE.BufferAttribute;

    // buildGround() writes mound height into each vertex's pre-rotation Z,
    // using its pre-rotation X/Y directly as sim-space (simX, simY) — see
    // ground.ts's own comment on this convention. `geometry.rotateX(-PI/2)`
    // then bakes a rotation into the position attribute in place: for this
    // angle, (x, y, z) -> (x, z, -y). So *after* that rotation (already
    // applied by the time buildGround() returns), getX(i) is still simX
    // unchanged, getY(i) is the mound height that was written to Z before
    // rotating, and getZ(i) is -simY.
    let checkedAnyOnRoadVertex = false;
    for (let i = 0; i < position.count; i++) {
      const simX = position.getX(i);
      const worldY = position.getY(i);
      const simY = -position.getZ(i);
      if (isNearAnyTrackRoad(simX, simY)) {
        checkedAnyOnRoadVertex = true;
        // buildGround() writes an exact 0 before rotateX bakes the rotation
        // matrix into the attribute, which reintroduces float noise on the
        // order of 1e-16 — toBeCloseTo tolerates that without weakening the
        // actual invariant (a mound, when present, is at least centimetres
        // tall per MOUND_MAX_HEIGHT_METERS).
        expect(worldY).toBeCloseTo(0, 10);
      }
    }
    expect(checkedAnyOnRoadVertex).toBe(true);
  });
});
