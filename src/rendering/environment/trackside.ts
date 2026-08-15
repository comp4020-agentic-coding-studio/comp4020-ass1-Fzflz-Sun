import * as THREE from "three";
import { BARRIER_KERB_GAP_METERS } from "../../simulation/constants.ts";
import type { TrackParams } from "../../simulation/index.ts";
import { trackCentre } from "../../simulation/track.ts";
import { ASSET_PATHS } from "../asset-loader.ts";
import { arcAngles, KERB_WIDTH_METERS, type Point2D, pointOnArc, ROAD_HALF_WIDTH } from "../track-geometry.ts";
import {
  BARRIER_FALLBACK_SIZE,
  BARRIER_GAP_METERS,
  BARRIER_SPEC,
  FENCE_SPEC,
  POST_FALLBACK_SIZE,
  POST_SPACING_TO_HEIGHT_RATIO,
  POST_SPEC,
  PYLON_SPEC,
  TRACKSIDE_VEGETATION,
} from "./asset-catalog.ts";
import { measureFittedSize, placeInstance } from "./placement.ts";
import { pickWeighted } from "./scatter-utils.ts";

const POST_KERB_GAP_METERS = 2.2;
const PYLON_INNER_GAP_METERS = 1.0;
const PYLON_PAIR_SPACING_METERS = 1.5;

// Fence accents sit just outside the continuous barrier line — a second,
// occasional guardrail style, not a replacement for it (the barrier's own
// spacing/loop below is untouched). Two per track (start + end) reads as a
// deliberate visual break; scattering them along the whole arc would just
// look like a second, redundant barrier.
const FENCE_ACCENT_OFFSET_METERS = 1.0;
const FENCE_ACCENT_ANGLE_JITTER_FRACTION = 0.15;

// Trackside vegetation band: 2-15m beyond the kerb+barrier line, clustered
// (not uniformly scattered) so it reads as tufts of ground-cover rather than
// an evenly-spaced grid. Every instance's *radial* offset is independently
// clamped into this band (never just world-space x/y jitter around a
// cluster centre), so a cluster anchored near the band's 2m inner edge can
// never jitter an instance back onto the road — see the loop below.
const TRACKSIDE_MIN_OFFSET_METERS = 2;
const TRACKSIDE_MAX_OFFSET_METERS = 15;
const TRACKSIDE_ANGLE_MARGIN_RADIANS = 0.35;
const TRACKSIDE_CLUSTER_MIN_SIZE = 3;
const TRACKSIDE_CLUSTER_MAX_SIZE = 5;
const TRACKSIDE_CLUSTER_RADIAL_SPREAD_METERS = 3;
const TRACKSIDE_CLUSTER_ANGULAR_SPREAD_METERS = 2.5;
const TRACKSIDE_SCALE_JITTER_FRACTION = 0.15;

/** Sparse trackside furniture (barriers, posts) anchored to the outer kerb,
 * spaced at a real interval derived from each asset's own fitted footprint
 * — unchanged from the original single-file `environment.ts` (see
 * `docs/asset-sources.md`), just re-homed here and re-pointed at the pack-
 * aware `placeInstance`/`measureFittedSize` and the typed catalog specs. */
export async function scatterTrackFurniture(group: THREE.Group, track: TrackParams): Promise<void> {
  const { cx, cy } = trackCentre(track);
  const centre: Point2D = { x: cx, y: cy };
  const { start, end } = arcAngles(track);
  const direction = track.direction === "left" ? 1 : -1;

  const [barrierSize, postSize] = await Promise.all([
    measureFittedSize(ASSET_PATHS.barrier, BARRIER_SPEC, BARRIER_FALLBACK_SIZE),
    measureFittedSize(ASSET_PATHS.post, POST_SPEC, POST_FALLBACK_SIZE),
  ]);

  const barrierRadius = track.radius + ROAD_HALF_WIDTH + KERB_WIDTH_METERS + BARRIER_KERB_GAP_METERS;
  const postRadius = track.radius + ROAD_HALF_WIDTH + KERB_WIDTH_METERS + POST_KERB_GAP_METERS;

  const barrierSpacingMeters = barrierSize.x + BARRIER_GAP_METERS;
  const postSpacingMeters = postSize.y * POST_SPACING_TO_HEIGHT_RATIO;
  const barrierStep = barrierSpacingMeters / track.radius;
  const postStep = postSpacingMeters / track.radius;

  const promises: Promise<THREE.Vector3 | null>[] = [];

  for (let theta = start; direction > 0 ? theta <= end : theta >= end; theta += direction * barrierStep) {
    const tangentHeadingSim = theta + direction * (Math.PI / 2);
    promises.push(placeInstance(group, ASSET_PATHS.barrier, BARRIER_SPEC, pointOnArc(centre, barrierRadius, theta), tangentHeadingSim));
  }
  for (let theta = start; direction > 0 ? theta <= end : theta >= end; theta += direction * postStep) {
    const postPosition = pointOnArc(centre, postRadius, theta);
    const towardCentreHeadingSim = Math.atan2(centre.y - postPosition.y, centre.x - postPosition.x);
    promises.push(placeInstance(group, ASSET_PATHS.post, POST_SPEC, postPosition, towardCentreHeadingSim));
  }

  await Promise.all(promises);
}

/** A small, fixed "gate" of pylon markers at each end of the track, on the
 * inner kerb — unchanged from the original `environment.ts`. */
export function scatterPylonMarkers(group: THREE.Group, track: TrackParams): Promise<THREE.Vector3 | null>[] {
  const { cx, cy } = trackCentre(track);
  const centre: Point2D = { x: cx, y: cy };
  const { start, end } = arcAngles(track);
  const direction = track.direction === "left" ? 1 : -1;
  const innerRadius = Math.max(1, track.radius - ROAD_HALF_WIDTH - KERB_WIDTH_METERS - PYLON_INNER_GAP_METERS);
  const pairStep = PYLON_PAIR_SPACING_METERS / track.radius;

  const anchors = [
    { theta: start, headingSim: start + direction * (Math.PI / 2) },
    { theta: start + direction * pairStep, headingSim: start + direction * (Math.PI / 2) },
    { theta: end - direction * pairStep, headingSim: end + direction * (Math.PI / 2) },
    { theta: end, headingSim: end + direction * (Math.PI / 2) },
  ];

  return anchors.map(({ theta, headingSim }) => placeInstance(group, ASSET_PATHS.pylon, PYLON_SPEC, pointOnArc(centre, innerRadius, theta), headingSim));
}

/** Two standalone fence-style accents (one near each end of the track),
 * tangent-aligned like the barrier loop above but at a slightly larger
 * radius and using the racing-kit's alternative `fenceCurved.glb` — an
 * occasional visual break from one continuous barrier style, not a second
 * spaced-out barrier run of its own. */
export function scatterFenceAccents(group: THREE.Group, track: TrackParams, rng: () => number): Promise<THREE.Vector3 | null>[] {
  const { cx, cy } = trackCentre(track);
  const centre: Point2D = { x: cx, y: cy };
  const { start, end } = arcAngles(track);
  const direction = track.direction === "left" ? 1 : -1;
  const fenceRadius = track.radius + ROAD_HALF_WIDTH + KERB_WIDTH_METERS + BARRIER_KERB_GAP_METERS + FENCE_ACCENT_OFFSET_METERS;

  const anchors = [start, end];
  return anchors.map((theta) => {
    const angleJitter = (rng() * 2 - 1) * (FENCE_ACCENT_ANGLE_JITTER_FRACTION / track.radius);
    const jitteredTheta = theta + angleJitter;
    const tangentHeadingSim = jitteredTheta + direction * (Math.PI / 2);
    return placeInstance(group, ASSET_PATHS.fenceCurved, FENCE_SPEC, pointOnArc(centre, fenceRadius, jitteredTheta), tangentHeadingSim);
  });
}

/** Clustered grass/flower/bush ground-cover in the 2-15m band beyond the
 * kerb+barrier line — `clusterCount` clusters, each a handful of instances
 * (`TRACKSIDE_CLUSTER_MIN_SIZE`-`TRACKSIDE_CLUSTER_MAX_SIZE`) jittered
 * around a shared anchor point, replacing the old single-layer uniform
 * `scatterField`. Every instance's own radial offset is independently
 * clamped into the trackside band (not just a cluster-centre jitter in
 * world x/y), so nothing in a cluster can ever land on the road even when
 * the cluster itself is anchored near the band's inner edge. */
export function scatterTracksideVegetation(group: THREE.Group, track: TrackParams, rng: () => number, clusterCount: number): Promise<THREE.Vector3 | null>[] {
  const { cx, cy } = trackCentre(track);
  const centre: Point2D = { x: cx, y: cy };
  const { start, end } = arcAngles(track);
  const angleMin = Math.min(start, end) - TRACKSIDE_ANGLE_MARGIN_RADIANS;
  const angleMax = Math.max(start, end) + TRACKSIDE_ANGLE_MARGIN_RADIANS;

  const promises: Promise<THREE.Vector3 | null>[] = [];
  for (let c = 0; c < clusterCount; c++) {
    const clusterAngle = angleMin + rng() * (angleMax - angleMin);
    const side = rng() < 0.5 ? -1 : 1;
    const clusterOffset = TRACKSIDE_MIN_OFFSET_METERS + rng() * (TRACKSIDE_MAX_OFFSET_METERS - TRACKSIDE_MIN_OFFSET_METERS);
    const instanceCount = TRACKSIDE_CLUSTER_MIN_SIZE + Math.floor(rng() * (TRACKSIDE_CLUSTER_MAX_SIZE - TRACKSIDE_CLUSTER_MIN_SIZE + 1));

    for (let i = 0; i < instanceCount; i++) {
      const radialJitter = (rng() * 2 - 1) * TRACKSIDE_CLUSTER_RADIAL_SPREAD_METERS;
      const offset = THREE.MathUtils.clamp(clusterOffset + radialJitter, TRACKSIDE_MIN_OFFSET_METERS, TRACKSIDE_MAX_OFFSET_METERS);
      const angleJitter = (rng() * 2 - 1) * (TRACKSIDE_CLUSTER_ANGULAR_SPREAD_METERS / track.radius);
      const instanceRadius = track.radius + side * (ROAD_HALF_WIDTH + KERB_WIDTH_METERS + offset);
      const position = pointOnArc(centre, Math.max(1, instanceRadius), clusterAngle + angleJitter);

      const asset = pickWeighted(rng, TRACKSIDE_VEGETATION);
      const headingSim = rng() * Math.PI * 2;
      const jitter = 1 + (rng() * 2 - 1) * TRACKSIDE_SCALE_JITTER_FRACTION;
      const jitteredSpec = { ...asset.spec, targetMeters: asset.spec.targetMeters * jitter };
      promises.push(placeInstance(group, asset.url, jitteredSpec, position, headingSim, asset.pack, asset.castsShadow));
    }
  }
  return promises;
}
