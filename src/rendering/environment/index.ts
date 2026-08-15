import * as THREE from "three";
import type { TrackParams } from "../../simulation/index.ts";
import { currentSceneryDensity } from "./density.ts";
import { scatterDistantScenery } from "./distant.ts";
import { buildGround } from "./ground.ts";
import { buildLandmarks } from "./landmarks.ts";
import { scatterMidground } from "./midground.ts";
import { createRng, seedForTrack } from "./scatter-utils.ts";
import { buildLights, buildSky } from "./sky.ts";
import { scatterFenceAccents, scatterPylonMarkers, scatterTrackFurniture, scatterTracksideVegetation } from "./trackside.ts";

// Scene-level (not object) properties — scene.ts applies these directly to
// its THREE.Scene, since background/fog have no group a returned Object3D
// could carry. Unchanged from the original single-file environment.ts.
export const FOG_NEAR_METERS = 40;
export const FOG_FAR_METERS = 220;

// Re-exported so scene.ts (the only consumer) reaches the camera-relative
// sky's public surface through this one module, same as everything else it
// imports from environment/ — not through sky.ts directly.
export { skyAnchorPosition, SKY_RENDER_EXTENT_METERS } from "./sky.ts";

/** Sky, ground plane, and the dusk light rig — everything about the backdrop
 * that does not depend on which track is currently selected. Built once per
 * scene lifetime; `scene.ts` adds this group and never rebuilds or disposes
 * it until the whole scene is torn down. Lights are added directly to this
 * group (not nested under the sky subgroup) — unchanged from the original
 * `buildStaticEnvironment` layout. */
export function buildStaticEnvironment(): THREE.Group {
  const group = new THREE.Group();
  group.name = "environment-static";
  group.add(buildSky());
  group.add(buildGround());
  for (const light of buildLights()) group.add(light);
  return group;
}

/** Deterministic four-layer scenery (trackside furniture/vegetation,
 * midground, landmarks, distant horizon) for the given track, as a group
 * that resolves once every scattered/placed asset has settled.
 * Track-shaped (unlike `buildStaticEnvironment`), so `scene.ts` rebuilds and
 * swaps this group in whenever the visitor picks a different track —
 * disposing the previous one's cloned instances first. One shared RNG
 * (seeded only from the track, never mobile-density) feeds every layer so
 * switching between mobile/desktop density reduces *how many* instances a
 * layer places without reshuffling the deterministic sequence those
 * instances are drawn from. */
export async function buildScenery(track: TrackParams): Promise<THREE.Group> {
  const group = new THREE.Group();
  group.name = "scenery";
  const rng = createRng(seedForTrack(track));
  const density = currentSceneryDensity();

  await Promise.all([
    scatterTrackFurniture(group, track),
    ...scatterPylonMarkers(group, track),
    ...scatterFenceAccents(group, track, rng),
    ...scatterTracksideVegetation(group, track, rng, density.tracksideClusters),
    ...scatterMidground(group, track, rng, density.midgroundClusters),
    ...buildLandmarks(group, track),
    ...scatterDistantScenery(group, track, rng, density.distantClusters),
  ]);

  return group;
}
