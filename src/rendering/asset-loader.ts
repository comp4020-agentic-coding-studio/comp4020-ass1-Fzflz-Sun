import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

// Every path here is a curated, inspected CC0 asset documented in
// docs/asset-sources.md — see that file for provenance, triangle counts,
// and (for the vehicle) the confirmed wheel-node names. These live under
// src/rendering/assets/ (not public/) specifically so they go through
// Vite's own static asset pipeline: a literal `new URL('relative/file.ext',
// import.meta.url)` call is statically recognized by Vite, which copies that
// exact file into the build and rewrites the URL correctly relative to
// wherever the referencing chunk ends up — the same mechanism that already
// gives every HTML entry's auto-injected <script>/<link> tags a correct,
// depth-adjusted path (confirmed by building the nested play/intro/intro.html
// entry: its tags come out as "../../assets/...", not a naive "./assets/...").
// A plain document-relative "./assets/..." string only resolves correctly
// for a page at the site root — it 404s for any page nested deeper, since
// the browser resolves it against the *loading document's* URL, not the
// site root. Each entry below must stay a literal per-file `new URL(...)`
// call (not built from a shared base variable) — Vite's static analysis only
// matches the literal call site, so indirecting through a variable makes it
// silently skip copying the file into the build at all (confirmed: an
// earlier version using a shared `new URL("./assets/", import.meta.url)`
// base produced a build with zero .glb files copied into dist/).
export const ASSET_PATHS = {
  vehicle: new URL("assets/vehicle/sedan.glb", import.meta.url).href,
  // sedan.glb references this texture by an external relative URI
  // (`Textures/colormap.png`, see docs/asset-sources.md) rather than
  // embedding it. Vite fingerprints and flattens both files into the same
  // assets/ directory independently, which breaks that relative reference
  // (the glb no longer sits next to a literal "Textures/" folder) — the
  // vehicle-pack loader's URL modifier below rewrites GLTFLoader's resolved
  // request for that relative URI to this asset's real, depth-safe URL.
  vehicleColormap: new URL("assets/vehicle/Textures/colormap.png", import.meta.url).href,
  // mini-forest's own colormap — confirmed by direct SHA1 comparison to be a
  // genuinely different image from vehicleColormap above (see
  // docs/asset-sources.md's "Load-bearing discovery" note): both packs'
  // GLBs reference the identical relative URI `Textures/colormap.png`, so
  // only a pack-scoped loader (not URL/basename inspection) can tell them
  // apart. See `AssetPack` below.
  miniForestColormap: new URL("assets/distant/Textures/colormap.png", import.meta.url).href,

  barrier: new URL("assets/track/barrierWhite.glb", import.meta.url).href,
  post: new URL("assets/track/lightPostModern.glb", import.meta.url).href,
  pylon: new URL("assets/track/pylon.glb", import.meta.url).href,
  fenceCurved: new URL("assets/track/fenceCurved.glb", import.meta.url).href,

  grandStandCovered: new URL("assets/track/grandStandCovered.glb", import.meta.url).href,
  grandStandRound: new URL("assets/track/grandStandRound.glb", import.meta.url).href,
  grandStandCoveredRound: new URL("assets/track/grandStandCoveredRound.glb", import.meta.url).href,
  pitsGarage: new URL("assets/track/pitsGarage.glb", import.meta.url).href,
  pitsGarageCorner: new URL("assets/track/pitsGarageCorner.glb", import.meta.url).href,
  pitsOffice: new URL("assets/track/pitsOffice.glb", import.meta.url).href,
  overheadRound: new URL("assets/track/overheadRound.glb", import.meta.url).href,
  billboardLow: new URL("assets/track/billboardLow.glb", import.meta.url).href,
  flagCheckers: new URL("assets/track/flagCheckers.glb", import.meta.url).href,

  treeDefault: new URL("assets/nature/tree_default.glb", import.meta.url).href,
  treePine: new URL("assets/nature/tree_pineRoundA.glb", import.meta.url).href,
  treeDetailed: new URL("assets/nature/tree_detailed.glb", import.meta.url).href,
  treeFat: new URL("assets/nature/tree_fat.glb", import.meta.url).href,
  treeCone: new URL("assets/nature/tree_cone.glb", import.meta.url).href,
  rockLarge: new URL("assets/nature/rock_largeA.glb", import.meta.url).href,
  rockSmall: new URL("assets/nature/rock_smallA.glb", import.meta.url).href,
  rockTall: new URL("assets/nature/rock_tallA.glb", import.meta.url).href,
  grass: new URL("assets/nature/grass.glb", import.meta.url).href,
  grassLarge: new URL("assets/nature/grass_large.glb", import.meta.url).href,
  grassLeafs: new URL("assets/nature/grass_leafs.glb", import.meta.url).href,
  flowerPurple: new URL("assets/nature/flower_purpleA.glb", import.meta.url).href,
  flowerRed: new URL("assets/nature/flower_redA.glb", import.meta.url).href,
  flowerYellow: new URL("assets/nature/flower_yellowA.glb", import.meta.url).href,
  plantBush: new URL("assets/nature/plant_bush.glb", import.meta.url).href,
  plantBushSmall: new URL("assets/nature/plant_bushSmall.glb", import.meta.url).href,
  plantBushDetailed: new URL("assets/nature/plant_bushDetailed.glb", import.meta.url).href,
  plantBushLarge: new URL("assets/nature/plant_bushLarge.glb", import.meta.url).href,
  log: new URL("assets/nature/log.glb", import.meta.url).href,
  logLarge: new URL("assets/nature/log_large.glb", import.meta.url).href,
  stumpOld: new URL("assets/nature/stump_old.glb", import.meta.url).href,
  stumpRound: new URL("assets/nature/stump_round.glb", import.meta.url).href,
  cliffLargeRock: new URL("assets/nature/cliff_large_rock.glb", import.meta.url).href,
  cliffTopRock: new URL("assets/nature/cliff_top_rock.glb", import.meta.url).href,

  distantTree: new URL("assets/distant/tree.glb", import.meta.url).href,
  distantTreeHigh: new URL("assets/distant/tree-high.glb", import.meta.url).href,
  distantRocksHigh: new URL("assets/distant/rocks-high.glb", import.meta.url).href,
  distantRocksLow: new URL("assets/distant/rocks-low.glb", import.meta.url).href,
  distantVan: new URL("assets/distant/van.glb", import.meta.url).href,
} as const;

// Confirmed by directly parsing sedan.glb's embedded glTF JSON (docs/
// asset-sources.md) — never guessed from convention. Exactly these four
// node names exist, one per independently addressable wheel.
export const WHEEL_NODE_NAMES = {
  frontLeft: "wheel-front-left",
  frontRight: "wheel-front-right",
  rearLeft: "wheel-back-left",
  rearRight: "wheel-back-right",
} as const;

// Which pack an asset belongs to decides which external colormap (if any)
// GLTFLoader must resolve its "Textures/colormap.png" reference to. This
// cannot be decided from the built URL or directory alone: `distantVan`
// (car-kit) and the four `distant*` mini-forest assets above all live in the
// same src/rendering/assets/distant/ directory and reference the identical
// relative URI, yet need two different real images (confirmed distinct by
// SHA1 — docs/asset-sources.md). Racing-kit and nature-kit assets reference
// no external texture at all (100% flat vertex-colour materials, confirmed
// by inspecting every file), so "flat" needs no URL modifier.
export type AssetPack = "flat" | "vehicle" | "miniForest";

function makeLoader(colormapOverride: string | null): GLTFLoader {
  const manager = new THREE.LoadingManager();
  if (colormapOverride) {
    manager.setURLModifier((url) => (url.endsWith("Textures/colormap.png") ? colormapOverride : url));
  }
  return new GLTFLoader(manager);
}

const LOADERS: Record<AssetPack, GLTFLoader> = {
  flat: makeLoader(null),
  vehicle: makeLoader(ASSET_PATHS.vehicleColormap),
  miniForest: makeLoader(ASSET_PATHS.miniForestColormap),
};

// One shared cache keyed by URL regardless of pack — which loader resolved
// a cached entry doesn't matter once the promise has settled, and a URL
// only ever belongs to one pack in practice (ASSET_PATHS never reuses a
// path across two catalog entries).
const sceneCache = new Map<string, Promise<THREE.Group>>();

function loadSceneOnce(url: string, pack: AssetPack): Promise<THREE.Group> {
  const cached = sceneCache.get(url);
  if (cached) return cached;
  const loaded = LOADERS[pack].loadAsync(url).then((gltf) => gltf.scene);
  sceneCache.set(url, loaded);
  return loaded;
}

/** Loads (and caches) the glTF at `url`, returning a fresh clone each call —
 * geometries/materials are shared by reference across clones (cheap; none of
 * these assets are skinned, so a plain `Object3D.clone(true)` is safe and
 * doesn't need SkeletonUtils), only transforms are independent. This is what
 * lets `environment/`'s scatter layers place many tree/rock/barrier/landmark
 * instances from one network fetch each.
 *
 * `pack` defaults to `"flat"` (no external colormap — racing-kit/nature-kit)
 * since it is the majority case; callers loading a vehicle-colormap or
 * mini-forest-colormap asset must pass their pack explicitly. */
export async function loadAsset(url: string, pack: AssetPack = "flat"): Promise<THREE.Group> {
  const scene = await loadSceneOnce(url, pack);
  return scene.clone(true);
}

/** Looks up a named node (e.g. a wheel) on a loaded asset's root, failing
 * loudly rather than silently skipping a wheel if the asset's scene graph
 * ever changes out from under `WHEEL_NODE_NAMES` (CLAUDE.md: never guess
 * node names, and never fail silently on an asset-shape mismatch). */
export function getNamedNode(root: THREE.Object3D, name: string): THREE.Object3D {
  const node = root.getObjectByName(name);
  if (!node) throw new Error(`asset is missing expected node "${name}"`);
  return node;
}
