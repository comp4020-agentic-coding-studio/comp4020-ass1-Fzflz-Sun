import * as THREE from "three";
import { type AssetPack, loadAsset } from "../asset-loader.ts";
import { fitAssetToSpec, type AssetPlacementSpec } from "../asset-fit.ts";
import { localAxisHeadingToWorldRotationY, simToWorld } from "../coordinates.ts";
import type { Point2D } from "../track-geometry.ts";

export function enableShadows(root: THREE.Object3D): void {
  root.traverse((node) => {
    if (node instanceof THREE.Mesh) {
      node.castShadow = true;
      node.receiveShadow = true;
    }
  });
}

/** Loads, fits (see asset-fit.ts), positions, and orients one scattered prop
 * instance, swallowing a load failure rather than letting it propagate:
 * this is decorative trackside scenery, not the road or the vehicle, so one
 * barrier/tree/rock's GLB failing to load (a 404, a network hiccup) must
 * not take down the rest of the scatter batch via `Promise.all` — every
 * async asset load needs its own explicit error path, not a shared
 * fail-everything one. Logged via `console.error` so a real failure is
 * still visible in the browser console (checkable, per CLAUDE.md's
 * asset-provenance discipline) instead of silently vanishing.
 *
 * `headingSim` and `spec.localForwardAxis` together decide `rotation.y` via
 * `localAxisHeadingToWorldRotationY` — never the sedan-specific
 * `sedanHeadingToWorldRotationY`, which would silently apply the wrong
 * offset to any prop whose local forward axis isn't +Z (exactly the bug
 * this replaces: every prop used to get the sedan's own +Z-forward formula
 * regardless of its own confirmed axis). `castsShadow` defaults to `true`
 * (existing barrier/post/pylon/field-prop behaviour); the new midground/
 * distant/trackside-vegetation layers pass `false` for anything that
 * shouldn't cast one (see CLAUDE.md's multi-scene performance discipline —
 * only a few near/mid large objects should cast shadows across 7 shared
 * scene instances). Returns the fitted world size so callers that need it
 * for spacing (barrier/post) can use it; `null` on a load failure. */
export async function placeInstance(
  target: THREE.Object3D,
  url: string,
  spec: AssetPlacementSpec,
  position: Point2D,
  headingSim: number,
  pack: AssetPack = "flat",
  castsShadow = true,
): Promise<THREE.Vector3 | null> {
  let root: THREE.Group;
  try {
    root = await loadAsset(url, pack);
  } catch (error) {
    console.error(`failed to load scenery asset "${url}"`, error);
    return null;
  }
  const { wrapper, size } = fitAssetToSpec(root, spec);
  const world = simToWorld(position.x, position.y);
  wrapper.position.set(world.x, 0, world.z);
  wrapper.rotation.y = localAxisHeadingToWorldRotationY(headingSim, spec.localForwardAxis);
  // Tagged by source filename (not the full url) so both a browser's scene
  // inspector and tests can tell scattered instances apart by asset type —
  // purely a debugging/testability aid, nothing here reads it back.
  wrapper.name = url.slice(url.lastIndexOf("/") + 1);
  if (castsShadow) {
    enableShadows(wrapper);
  } else {
    wrapper.traverse((node) => {
      if (node instanceof THREE.Mesh) node.receiveShadow = true;
    });
  }
  target.add(wrapper);
  if (import.meta.env.DEV && url.includes("barrier")) {
    let meshCount = 0;
    wrapper.traverse((node) => {
      if (node instanceof THREE.Mesh) meshCount++;
    });
    console.debug(
      "[diag] barrier instance",
      JSON.stringify({
        meshCount,
        fittedSize: size.toArray(),
        worldPosition: wrapper.position.toArray(),
        worldRotationY: wrapper.rotation.y,
      }),
    );
  }
  return size;
}

/** Measures the fitted world size a given (url, spec) pair produces, without
 * adding anything to the scene — used to derive placement spacing (barrier
 * segment interval, post interval) from the asset's *actual* fitted
 * footprint instead of a second, independently-guessed number that could
 * silently drift out of sync with `spec.targetMeters`. Falls back to a
 * rough hand-picked estimate (only reachable on a real load failure) so a
 * network hiccup degrades spacing gracefully instead of throwing. */
export async function measureFittedSize(url: string, spec: AssetPlacementSpec, fallback: THREE.Vector3, pack: AssetPack = "flat"): Promise<THREE.Vector3> {
  try {
    const root = await loadAsset(url, pack);
    return fitAssetToSpec(root, spec).size;
  } catch (error) {
    console.error(`failed to measure scenery asset "${url}" for placement spacing; using a fallback size`, error);
    return fallback;
  }
}
