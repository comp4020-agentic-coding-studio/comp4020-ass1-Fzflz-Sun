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
  // loader's `colormapUrlModifier` below rewrites GLTFLoader's resolved
  // request for that relative URI to this asset's real, depth-safe URL.
  vehicleColormap: new URL("assets/vehicle/Textures/colormap.png", import.meta.url).href,
  barrier: new URL("assets/track/barrierWhite.glb", import.meta.url).href,
  post: new URL("assets/track/lightPostModern.glb", import.meta.url).href,
  pylon: new URL("assets/track/pylon.glb", import.meta.url).href,
  treeDefault: new URL("assets/nature/tree_default.glb", import.meta.url).href,
  treePine: new URL("assets/nature/tree_pineRoundA.glb", import.meta.url).href,
  treeDetailed: new URL("assets/nature/tree_detailed.glb", import.meta.url).href,
  rockLarge: new URL("assets/nature/rock_largeA.glb", import.meta.url).href,
  rockSmall: new URL("assets/nature/rock_smallA.glb", import.meta.url).href,
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

// GLTFLoader resolves sedan.glb's external "Textures/colormap.png" URI by
// concatenating it onto the glb's own resolved directory — see the
// `vehicleColormap` comment above for why that no longer points at a real
// file post-build. A LoadingManager URL modifier intercepts exactly that
// resolved request and redirects it to the texture's real fingerprinted URL,
// with no change needed to the glb's own internal reference.
const manager = new THREE.LoadingManager();
manager.setURLModifier((url) => (url.endsWith("Textures/colormap.png") ? ASSET_PATHS.vehicleColormap : url));
const loader = new GLTFLoader(manager);
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
