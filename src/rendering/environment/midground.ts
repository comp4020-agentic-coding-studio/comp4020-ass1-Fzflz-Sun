import * as THREE from "three";
import type { TrackParams } from "../../simulation/index.ts";
import { trackCentre } from "../../simulation/track.ts";
import { arcAngles, KERB_WIDTH_METERS, type Point2D, pointOnArc, ROAD_HALF_WIDTH } from "../track-geometry.ts";
import { MIDGROUND_ASSETS } from "./asset-catalog.ts";
import { placeInstance } from "./placement.ts";
import { pickWeighted } from "./scatter-utils.ts";

// Midground band: 15-60m beyond the kerb+barrier line — trees, larger
// bushes, rocks, logs/stumps, and an occasional fence variant. Wider and
// looser clusters than the trackside layer (bigger assets, meant to read as
// a loose treeline/rock-scatter rather than tufts of ground-cover), still
// full-circle around the track (not confined to the racing arc's angular
// span the way trackside furniture is) so the corner reads as sitting
// inside a real landscape rather than only having scenery along the road
// itself.
const MIDGROUND_MIN_OFFSET_METERS = 15;
const MIDGROUND_MAX_OFFSET_METERS = 60;
const MIDGROUND_CLUSTER_MIN_SIZE = 2;
const MIDGROUND_CLUSTER_MAX_SIZE = 4;
const MIDGROUND_CLUSTER_RADIAL_SPREAD_METERS = 8;
const MIDGROUND_CLUSTER_ANGULAR_SPREAD_METERS = 6;
const MIDGROUND_SCALE_JITTER_FRACTION = 0.2;

/** Clustered midground scenery (15-60m band) scattered around the *entire*
 * circle at the track's own radius, not just alongside its racing arc — a
 * corner only occupies part of the circle `trackCentre`/`arcAngles` describe,
 * and the landscape around it should not stop exactly where the tarmac does.
 * Every instance's radial offset is independently clamped into the band
 * (same discipline as `trackside.ts`'s vegetation scatter), so nothing can
 * ever land inside the track's own kerb/barrier margin regardless of which
 * side of the circle a cluster lands on. */
export function scatterMidground(group: THREE.Group, track: TrackParams, rng: () => number, clusterCount: number): Promise<THREE.Vector3 | null>[] {
  const { cx, cy } = trackCentre(track);
  const centre: Point2D = { x: cx, y: cy };
  const { start } = arcAngles(track);
  const promises: Promise<THREE.Vector3 | null>[] = [];

  for (let c = 0; c < clusterCount; c++) {
    // Full-circle placement, independent of the racing arc's own span —
    // deliberately offset from `start` by an rng-driven full turn so the
    // deterministic sequence still differs cluster to cluster rather than
    // retracing the same angle.
    const clusterAngle = start + rng() * Math.PI * 2;
    const clusterOffset = MIDGROUND_MIN_OFFSET_METERS + rng() * (MIDGROUND_MAX_OFFSET_METERS - MIDGROUND_MIN_OFFSET_METERS);
    const instanceCount = MIDGROUND_CLUSTER_MIN_SIZE + Math.floor(rng() * (MIDGROUND_CLUSTER_MAX_SIZE - MIDGROUND_CLUSTER_MIN_SIZE + 1));

    for (let i = 0; i < instanceCount; i++) {
      const radialJitter = (rng() * 2 - 1) * MIDGROUND_CLUSTER_RADIAL_SPREAD_METERS;
      const offset = THREE.MathUtils.clamp(clusterOffset + radialJitter, MIDGROUND_MIN_OFFSET_METERS, MIDGROUND_MAX_OFFSET_METERS);
      const angleJitter = (rng() * 2 - 1) * (MIDGROUND_CLUSTER_ANGULAR_SPREAD_METERS / track.radius);
      const instanceRadius = track.radius + ROAD_HALF_WIDTH + KERB_WIDTH_METERS + offset;
      const position = pointOnArc(centre, instanceRadius, clusterAngle + angleJitter);

      const asset = pickWeighted(rng, MIDGROUND_ASSETS);
      const headingSim = rng() * Math.PI * 2;
      const jitter = 1 + (rng() * 2 - 1) * MIDGROUND_SCALE_JITTER_FRACTION;
      const jitteredSpec = { ...asset.spec, targetMeters: asset.spec.targetMeters * jitter };
      promises.push(placeInstance(group, asset.url, jitteredSpec, position, headingSim, asset.pack, asset.castsShadow));
    }
  }
  return promises;
}
