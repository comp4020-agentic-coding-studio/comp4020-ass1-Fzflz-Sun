import * as THREE from "three";
import type { TrackParams } from "../../simulation/index.ts";
import { trackCentre } from "../../simulation/track.ts";
import { type Point2D, pointOnArc } from "../track-geometry.ts";
import { DISTANT_ASSETS } from "./asset-catalog.ts";
import { placeInstance } from "./placement.ts";
import { pickWeighted } from "./scatter-utils.ts";

// 80-180m horizon band — comfortably inside FOG_FAR_METERS (220, see
// environment/index.ts) so distant scenery is dimmed by fog, not fully
// hidden by it. Deliberately full-circle around the track's own centre, like
// midground, since this is a horizon silhouette rather than trackside
// dressing.
const DISTANT_MIN_RADIUS_METERS = 80;
const DISTANT_MAX_RADIUS_METERS = 180;

// The horizon is populated by angular sector, only filling a fraction of
// them, rather than as a uniform ring — a solid ring around the whole
// circle reads as an obviously artificial "wall", where gaps read as a real,
// irregular horizon line. Sectors are chosen deterministically from the
// scenery rng (highest-scored sectors win), not by any wall-clock or
// frame-dependent randomness.
const DISTANT_SECTOR_COUNT = 12;
const DISTANT_SECTOR_FILL_FRACTION = 0.6;

const DISTANT_CLUSTER_MIN_SIZE = 2;
const DISTANT_CLUSTER_MAX_SIZE = 4;
const DISTANT_RADIAL_JITTER_METERS = 12;
const DISTANT_SCALE_JITTER_FRACTION = 0.2;

/** Deterministically picks which of `DISTANT_SECTOR_COUNT` angular sectors
 * (evenly dividing the full circle) are populated this build — scoring every
 * sector with one `rng()` draw and keeping the highest-scored fraction, so
 * the same (track, seed) pair always yields the same gap pattern. */
function pickFilledSectors(rng: () => number, fillCount: number): number[] {
  const scored = Array.from({ length: DISTANT_SECTOR_COUNT }, (_, sector) => ({ sector, score: rng() }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, fillCount).map((entry) => entry.sector);
}

/** Low-poly distant horizon scenery (trees/rocks/cliff silhouettes), placed
 * as clustered stands within a subset of angular sectors around the track's
 * full circle — never cast shadows (too far, too small on screen to matter,
 * and this is one of the largest instance counts of the four layers), and
 * always uses `castsShadow: false` per each catalog entry regardless. */
export function scatterDistantScenery(group: THREE.Group, track: TrackParams, rng: () => number, clusterCount: number): Promise<THREE.Vector3 | null>[] {
  const { cx, cy } = trackCentre(track);
  const centre: Point2D = { x: cx, y: cy };
  const sectorAngle = (Math.PI * 2) / DISTANT_SECTOR_COUNT;
  const fillCount = Math.max(1, Math.round(DISTANT_SECTOR_COUNT * DISTANT_SECTOR_FILL_FRACTION));
  const filledSectors = pickFilledSectors(rng, fillCount);

  const promises: Promise<THREE.Vector3 | null>[] = [];
  for (let c = 0; c < clusterCount; c++) {
    const sector = filledSectors[c % filledSectors.length];
    const clusterAngle = sector * sectorAngle + rng() * sectorAngle;
    const clusterRadius = DISTANT_MIN_RADIUS_METERS + rng() * (DISTANT_MAX_RADIUS_METERS - DISTANT_MIN_RADIUS_METERS);
    const instanceCount = DISTANT_CLUSTER_MIN_SIZE + Math.floor(rng() * (DISTANT_CLUSTER_MAX_SIZE - DISTANT_CLUSTER_MIN_SIZE + 1));

    for (let i = 0; i < instanceCount; i++) {
      const angleJitter = (rng() * 2 - 1) * (sectorAngle * 0.3);
      const radialJitter = (rng() * 2 - 1) * DISTANT_RADIAL_JITTER_METERS;
      const radius = THREE.MathUtils.clamp(clusterRadius + radialJitter, DISTANT_MIN_RADIUS_METERS, DISTANT_MAX_RADIUS_METERS);
      const position = pointOnArc(centre, radius, clusterAngle + angleJitter);

      const asset = pickWeighted(rng, DISTANT_ASSETS);
      const headingSim = rng() * Math.PI * 2;
      const jitter = 1 + (rng() * 2 - 1) * DISTANT_SCALE_JITTER_FRACTION;
      const jitteredSpec = { ...asset.spec, targetMeters: asset.spec.targetMeters * jitter };
      promises.push(placeInstance(group, asset.url, jitteredSpec, position, headingSim, asset.pack, asset.castsShadow));
    }
  }
  return promises;
}
