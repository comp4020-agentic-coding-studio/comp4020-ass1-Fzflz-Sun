import * as THREE from "three";
import { type AssetPlacementSpec } from "../asset-fit.ts";
import { type AssetPack, ASSET_PATHS } from "../asset-loader.ts";

// Every AssetPlacementSpec below states a real-world target size in metres,
// never a bare multiplier — see asset-fit.ts's own doc comment for why:
// Kenney's packs are not unit-consistent with each other (confirmed by
// direct GLB inspection, see docs/asset-sources.md), so "scale 1" on a
// barrier and "scale 1" on a light post mean completely different things.
// `targetAxis`/`localForwardAxis` are each asset's own confirmed properties
// (documented in docs/asset-sources.md), not assumptions.

export type SceneryRole = "trackside" | "midground" | "landmark" | "distant";

/** One typed catalog entry per environment asset — replaces the previous
 * scattered per-spec constants with a single documented table each layer
 * builder reads from. `weight` only matters for assets consumed through a
 * weighted pool (`pickWeighted`); hand-placed landmarks ignore it. */
export interface EnvironmentAssetDefinition {
  id: string;
  url: string;
  pack: AssetPack;
  spec: AssetPlacementSpec;
  role: SceneryRole;
  weight: number;
  castsShadow: boolean;
}

// --- Trackside furniture (existing barrier/post/pylon, unchanged) ---------

// barrierWhite.glb: raw size (X,Y,Z) = [0.25, 0.1312, 0.123] — its long axis
// is local +X (confirmed by direct inspection). Targeting height (Y), not
// length: a fixed, plausible guardrail height is a more stable target than
// length, and BARRIER_GAP_METERS below derives the actual placement spacing
// from whatever length that height target implies — never the other way
// around.
const BARRIER_TARGET_HEIGHT_METERS = 0.9;
export const BARRIER_SPEC: AssetPlacementSpec = { targetAxis: "y", targetMeters: BARRIER_TARGET_HEIGHT_METERS, localForwardAxis: "+x" };
export const BARRIER_GAP_METERS = 0.15;
export const BARRIER_FALLBACK_SIZE = new THREE.Vector3(1.7, BARRIER_TARGET_HEIGHT_METERS, 0.84);

// lightPostModern.glb: raw size (X,Y,Z) = [0.0491, 0.7813, 0.1776]. Its
// lamp-arm cantilevers along local +Z (confirmed by height-band vertex
// centroid analysis — see docs/asset-sources.md).
const POST_TARGET_HEIGHT_METERS = 4.5;
export const POST_SPEC: AssetPlacementSpec = { targetAxis: "y", targetMeters: POST_TARGET_HEIGHT_METERS, localForwardAxis: "+z" };
export const POST_SPACING_TO_HEIGHT_RATIO = 6;
export const POST_FALLBACK_SIZE = new THREE.Vector3(0.28, POST_TARGET_HEIGHT_METERS, 1.02);

// pylon.glb: raw size (X,Y,Z) = [0.12, 0.132, 0.12] — a near-square
// footprint, so its `localForwardAxis` is nominal only.
const PYLON_TARGET_HEIGHT_METERS = 0.7;
export const PYLON_SPEC: AssetPlacementSpec = { targetAxis: "y", targetMeters: PYLON_TARGET_HEIGHT_METERS, localForwardAxis: "+x" };

// fenceCurved.glb: raw size (X,Y,Z) = [1.0, 0.81, 0.32] — same height target
// as the barrier (an alternative guardrail style), long axis local +X.
// Placed sparingly as an occasional break from the continuous barrier run
// (docs/asset-sources.md), not with derived spacing of its own.
export const FENCE_SPEC: AssetPlacementSpec = { targetAxis: "y", targetMeters: BARRIER_TARGET_HEIGHT_METERS, localForwardAxis: "+x" };

// --- Trackside vegetation (2-15m clustered ground-cover) -------------------

const GRASS_SPEC: AssetPlacementSpec = { targetAxis: "y", targetMeters: 0.35, localForwardAxis: "+z" };
const GRASS_LARGE_SPEC: AssetPlacementSpec = { targetAxis: "y", targetMeters: 0.45, localForwardAxis: "+z" };
const GRASS_LEAFS_SPEC: AssetPlacementSpec = { targetAxis: "y", targetMeters: 0.25, localForwardAxis: "+z" };
const FLOWER_PURPLE_SPEC: AssetPlacementSpec = { targetAxis: "y", targetMeters: 0.3, localForwardAxis: "+z" };
const FLOWER_RED_SPEC: AssetPlacementSpec = { targetAxis: "y", targetMeters: 0.35, localForwardAxis: "+z" };
const FLOWER_YELLOW_SPEC: AssetPlacementSpec = { targetAxis: "y", targetMeters: 0.25, localForwardAxis: "+z" };
const PLANT_BUSH_SPEC: AssetPlacementSpec = { targetAxis: "y", targetMeters: 0.5, localForwardAxis: "+z" };
const PLANT_BUSH_SMALL_SPEC: AssetPlacementSpec = { targetAxis: "y", targetMeters: 0.35, localForwardAxis: "+z" };

export const TRACKSIDE_VEGETATION: readonly EnvironmentAssetDefinition[] = [
  { id: "grass", url: ASSET_PATHS.grass, pack: "flat", spec: GRASS_SPEC, role: "trackside", weight: 4, castsShadow: false },
  { id: "grassLarge", url: ASSET_PATHS.grassLarge, pack: "flat", spec: GRASS_LARGE_SPEC, role: "trackside", weight: 3, castsShadow: false },
  { id: "grassLeafs", url: ASSET_PATHS.grassLeafs, pack: "flat", spec: GRASS_LEAFS_SPEC, role: "trackside", weight: 3, castsShadow: false },
  { id: "flowerPurple", url: ASSET_PATHS.flowerPurple, pack: "flat", spec: FLOWER_PURPLE_SPEC, role: "trackside", weight: 2, castsShadow: false },
  { id: "flowerRed", url: ASSET_PATHS.flowerRed, pack: "flat", spec: FLOWER_RED_SPEC, role: "trackside", weight: 2, castsShadow: false },
  { id: "flowerYellow", url: ASSET_PATHS.flowerYellow, pack: "flat", spec: FLOWER_YELLOW_SPEC, role: "trackside", weight: 2, castsShadow: false },
  { id: "plantBush", url: ASSET_PATHS.plantBush, pack: "flat", spec: PLANT_BUSH_SPEC, role: "trackside", weight: 2, castsShadow: false },
  { id: "plantBushSmall", url: ASSET_PATHS.plantBushSmall, pack: "flat", spec: PLANT_BUSH_SMALL_SPEC, role: "trackside", weight: 2, castsShadow: false },
] as const;

// --- Midground (15-60m trees/rocks/deadwood) -------------------------------

const TREE_DEFAULT_SPEC: AssetPlacementSpec = { targetAxis: "y", targetMeters: 5.5, localForwardAxis: "+z" };
const TREE_PINE_SPEC: AssetPlacementSpec = { targetAxis: "y", targetMeters: 6.5, localForwardAxis: "+z" };
const TREE_DETAILED_SPEC: AssetPlacementSpec = { targetAxis: "y", targetMeters: 5.0, localForwardAxis: "+z" };
const TREE_FAT_SPEC: AssetPlacementSpec = { targetAxis: "y", targetMeters: 5.0, localForwardAxis: "+z" };
const TREE_CONE_SPEC: AssetPlacementSpec = { targetAxis: "y", targetMeters: 7.0, localForwardAxis: "+z" };
const ROCK_LARGE_SPEC: AssetPlacementSpec = { targetAxis: "y", targetMeters: 0.7, localForwardAxis: "+z" };
const ROCK_SMALL_SPEC: AssetPlacementSpec = { targetAxis: "y", targetMeters: 0.35, localForwardAxis: "+z" };
const ROCK_TALL_SPEC: AssetPlacementSpec = { targetAxis: "y", targetMeters: 2.2, localForwardAxis: "+z" };
const PLANT_BUSH_DETAILED_SPEC: AssetPlacementSpec = { targetAxis: "y", targetMeters: 1.1, localForwardAxis: "+z" };
const PLANT_BUSH_LARGE_SPEC: AssetPlacementSpec = { targetAxis: "y", targetMeters: 1.0, localForwardAxis: "+z" };
const LOG_SPEC: AssetPlacementSpec = { targetAxis: "z", targetMeters: 1.8, localForwardAxis: "+z" };
const LOG_LARGE_SPEC: AssetPlacementSpec = { targetAxis: "x", targetMeters: 2.5, localForwardAxis: "+x" };
const STUMP_OLD_SPEC: AssetPlacementSpec = { targetAxis: "y", targetMeters: 0.6, localForwardAxis: "+z" };
const STUMP_ROUND_SPEC: AssetPlacementSpec = { targetAxis: "y", targetMeters: 0.45, localForwardAxis: "+z" };

export const MIDGROUND_ASSETS: readonly EnvironmentAssetDefinition[] = [
  { id: "treeDefault", url: ASSET_PATHS.treeDefault, pack: "flat", spec: TREE_DEFAULT_SPEC, role: "midground", weight: 3, castsShadow: true },
  { id: "treePine", url: ASSET_PATHS.treePine, pack: "flat", spec: TREE_PINE_SPEC, role: "midground", weight: 3, castsShadow: true },
  { id: "treeDetailed", url: ASSET_PATHS.treeDetailed, pack: "flat", spec: TREE_DETAILED_SPEC, role: "midground", weight: 2, castsShadow: true },
  { id: "treeFat", url: ASSET_PATHS.treeFat, pack: "flat", spec: TREE_FAT_SPEC, role: "midground", weight: 2, castsShadow: true },
  { id: "treeCone", url: ASSET_PATHS.treeCone, pack: "flat", spec: TREE_CONE_SPEC, role: "midground", weight: 2, castsShadow: true },
  { id: "rockLarge", url: ASSET_PATHS.rockLarge, pack: "flat", spec: ROCK_LARGE_SPEC, role: "midground", weight: 1, castsShadow: false },
  { id: "rockSmall", url: ASSET_PATHS.rockSmall, pack: "flat", spec: ROCK_SMALL_SPEC, role: "midground", weight: 2, castsShadow: false },
  { id: "rockTall", url: ASSET_PATHS.rockTall, pack: "flat", spec: ROCK_TALL_SPEC, role: "midground", weight: 1, castsShadow: false },
  { id: "plantBushDetailed", url: ASSET_PATHS.plantBushDetailed, pack: "flat", spec: PLANT_BUSH_DETAILED_SPEC, role: "midground", weight: 2, castsShadow: false },
  { id: "plantBushLarge", url: ASSET_PATHS.plantBushLarge, pack: "flat", spec: PLANT_BUSH_LARGE_SPEC, role: "midground", weight: 2, castsShadow: false },
  { id: "log", url: ASSET_PATHS.log, pack: "flat", spec: LOG_SPEC, role: "midground", weight: 1, castsShadow: false },
  { id: "logLarge", url: ASSET_PATHS.logLarge, pack: "flat", spec: LOG_LARGE_SPEC, role: "midground", weight: 1, castsShadow: false },
  { id: "stumpOld", url: ASSET_PATHS.stumpOld, pack: "flat", spec: STUMP_OLD_SPEC, role: "midground", weight: 1, castsShadow: false },
  { id: "stumpRound", url: ASSET_PATHS.stumpRound, pack: "flat", spec: STUMP_ROUND_SPEC, role: "midground", weight: 1, castsShadow: false },
] as const;

// --- Distant/horizon (80-180m, low-poly, never casts a shadow) ------------

const DISTANT_TREE_SPEC: AssetPlacementSpec = { targetAxis: "y", targetMeters: 9.0, localForwardAxis: "+z" };
const DISTANT_TREE_HIGH_SPEC: AssetPlacementSpec = { targetAxis: "y", targetMeters: 12.0, localForwardAxis: "+z" };
const DISTANT_ROCKS_HIGH_SPEC: AssetPlacementSpec = { targetAxis: "y", targetMeters: 5.0, localForwardAxis: "+z" };
const DISTANT_ROCKS_LOW_SPEC: AssetPlacementSpec = { targetAxis: "y", targetMeters: 3.0, localForwardAxis: "+z" };
const CLIFF_LARGE_ROCK_SPEC: AssetPlacementSpec = { targetAxis: "y", targetMeters: 14.0, localForwardAxis: "+z" };
const CLIFF_TOP_ROCK_SPEC: AssetPlacementSpec = { targetAxis: "y", targetMeters: 9.0, localForwardAxis: "+z" };

export const DISTANT_ASSETS: readonly EnvironmentAssetDefinition[] = [
  { id: "distantTree", url: ASSET_PATHS.distantTree, pack: "miniForest", spec: DISTANT_TREE_SPEC, role: "distant", weight: 3, castsShadow: false },
  { id: "distantTreeHigh", url: ASSET_PATHS.distantTreeHigh, pack: "miniForest", spec: DISTANT_TREE_HIGH_SPEC, role: "distant", weight: 2, castsShadow: false },
  { id: "distantRocksHigh", url: ASSET_PATHS.distantRocksHigh, pack: "miniForest", spec: DISTANT_ROCKS_HIGH_SPEC, role: "distant", weight: 1, castsShadow: false },
  { id: "distantRocksLow", url: ASSET_PATHS.distantRocksLow, pack: "miniForest", spec: DISTANT_ROCKS_LOW_SPEC, role: "distant", weight: 1, castsShadow: false },
  { id: "cliffLargeRock", url: ASSET_PATHS.cliffLargeRock, pack: "flat", spec: CLIFF_LARGE_ROCK_SPEC, role: "distant", weight: 1, castsShadow: false },
  { id: "cliffTopRock", url: ASSET_PATHS.cliffTopRock, pack: "flat", spec: CLIFF_TOP_ROCK_SPEC, role: "distant", weight: 1, castsShadow: false },
] as const;

// --- Landmarks (hand-placed, one per semantic role — not pool-picked) -----

const GRANDSTAND_COVERED_SPEC: AssetPlacementSpec = { targetAxis: "y", targetMeters: 5.5, localForwardAxis: "+z" };
const GRANDSTAND_ROUND_SPEC: AssetPlacementSpec = { targetAxis: "y", targetMeters: 4.2, localForwardAxis: "+z" };
const PITS_GARAGE_SPEC: AssetPlacementSpec = { targetAxis: "y", targetMeters: 3.2, localForwardAxis: "+z" };
const PITS_GARAGE_CORNER_SPEC: AssetPlacementSpec = { targetAxis: "y", targetMeters: 3.2, localForwardAxis: "+z" };
const PITS_OFFICE_SPEC: AssetPlacementSpec = { targetAxis: "y", targetMeters: 2.6, localForwardAxis: "+z" };
const GANTRY_SPEC: AssetPlacementSpec = { targetAxis: "x", targetMeters: 9.0, localForwardAxis: "+x" };
const BILLBOARD_SPEC: AssetPlacementSpec = { targetAxis: "y", targetMeters: 3.2, localForwardAxis: "+z" };
const FLAG_SPEC: AssetPlacementSpec = { targetAxis: "y", targetMeters: 3.0, localForwardAxis: "+x" };
const DISTANT_VAN_SPEC: AssetPlacementSpec = { targetAxis: "z", targetMeters: 5.0, localForwardAxis: "+z" };

export const GRANDSTAND_COVERED: EnvironmentAssetDefinition = { id: "grandStandCovered", url: ASSET_PATHS.grandStandCovered, pack: "flat", spec: GRANDSTAND_COVERED_SPEC, role: "landmark", weight: 1, castsShadow: true };
export const GRANDSTAND_ROUND: EnvironmentAssetDefinition = { id: "grandStandRound", url: ASSET_PATHS.grandStandRound, pack: "flat", spec: GRANDSTAND_ROUND_SPEC, role: "landmark", weight: 1, castsShadow: true };
export const PITS_GARAGE: EnvironmentAssetDefinition = { id: "pitsGarage", url: ASSET_PATHS.pitsGarage, pack: "flat", spec: PITS_GARAGE_SPEC, role: "landmark", weight: 1, castsShadow: true };
export const PITS_GARAGE_CORNER: EnvironmentAssetDefinition = { id: "pitsGarageCorner", url: ASSET_PATHS.pitsGarageCorner, pack: "flat", spec: PITS_GARAGE_CORNER_SPEC, role: "landmark", weight: 1, castsShadow: true };
export const PITS_OFFICE: EnvironmentAssetDefinition = { id: "pitsOffice", url: ASSET_PATHS.pitsOffice, pack: "flat", spec: PITS_OFFICE_SPEC, role: "landmark", weight: 1, castsShadow: false };
export const GANTRY: EnvironmentAssetDefinition = { id: "overheadRound", url: ASSET_PATHS.overheadRound, pack: "flat", spec: GANTRY_SPEC, role: "landmark", weight: 1, castsShadow: false };
export const BILLBOARD: EnvironmentAssetDefinition = { id: "billboardLow", url: ASSET_PATHS.billboardLow, pack: "flat", spec: BILLBOARD_SPEC, role: "landmark", weight: 1, castsShadow: false };
export const FLAG: EnvironmentAssetDefinition = { id: "flagCheckers", url: ASSET_PATHS.flagCheckers, pack: "flat", spec: FLAG_SPEC, role: "landmark", weight: 1, castsShadow: false };
export const DISTANT_VAN: EnvironmentAssetDefinition = { id: "van", url: ASSET_PATHS.distantVan, pack: "vehicle", spec: DISTANT_VAN_SPEC, role: "landmark", weight: 1, castsShadow: false };
