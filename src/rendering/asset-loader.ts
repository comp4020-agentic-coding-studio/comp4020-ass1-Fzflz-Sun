import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

// Every path here is a curated, inspected CC0 asset documented in
// docs/asset-sources.md — see that file for provenance, triangle counts,
// and (for the vehicle) the confirmed wheel-node names. `public/` files are
// served at the site root, so these are plain relative URLs resolved
// against the document, the same convention index.html already uses for
// "./src/styles/main.css"/"./main.ts".
export const ASSET_PATHS = {
  vehicle: "./assets/vehicle/sedan.glb",
  barrier: "./assets/track/barrierWhite.glb",
  post: "./assets/track/lightPostModern.glb",
  pylon: "./assets/track/pylon.glb",
  treeDefault: "./assets/nature/tree_default.glb",
  treePine: "./assets/nature/tree_pineRoundA.glb",
  treeDetailed: "./assets/nature/tree_detailed.glb",
  rockLarge: "./assets/nature/rock_largeA.glb",
  rockSmall: "./assets/nature/rock_smallA.glb",
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

const loader = new GLTFLoader();
const sceneCache = new Map<string, Promise<THREE.Group>>();

function loadSceneOnce(url: string): Promise<THREE.Group> {
  const cached = sceneCache.get(url);
  if (cached) return cached;
  const loaded = loader.loadAsync(url).then((gltf) => gltf.scene);
  sceneCache.set(url, loaded);
  return loaded;
}

/** Loads (and caches) the glTF at `url`, returning a fresh clone each call —
 * geometries/materials are shared by reference across clones (cheap; none of
 * these assets are skinned, so a plain `Object3D.clone(true)` is safe and
 * doesn't need SkeletonUtils), only transforms are independent. This is what
 * lets `environment.ts` scatter many tree/rock/barrier instances from one
 * network fetch each. */
export async function loadAsset(url: string): Promise<THREE.Group> {
  const scene = await loadSceneOnce(url);
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
