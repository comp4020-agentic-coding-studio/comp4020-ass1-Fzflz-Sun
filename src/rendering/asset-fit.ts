import * as THREE from "three";
import type { LocalAxis } from "./coordinates.ts";

/** Which raw-bbox axis to measure and scale from. Kenney's packs are not
 * unit-consistent with each other (see docs/asset-sources.md) — a barrier
 * is sized by its length, a tree or light post by its height — so the spec
 * must say which axis the target applies to, rather than assuming "height"
 * (Y) universally. */
export type TargetAxis = "x" | "y" | "z";

/** A concrete, real-world target size for one asset type — the replacement
 * for the scattered magic-number `scale` values `environment.ts` used to
 * pass around. Every field here is a target the fitted model must hit, not
 * a bare multiplier: `targetMeters` is always metres in world space, never
 * an opaque scale factor, so a future asset swap (different raw size) keeps
 * producing the same visible result without anyone re-deriving a multiplier
 * by eye. */
export interface AssetPlacementSpec {
  /** Which raw (pre-scale) bbox axis `targetMeters` measures. */
  targetAxis: TargetAxis;
  /** Desired real-world size, in metres, along `targetAxis` after fitting. */
  targetMeters: number;
  /** This asset's own confirmed local axis — see docs/asset-sources.md for
   * how each was verified (wheel-node translations, mesh height bands, or
   * bbox-vs-node inspection) — used by callers to derive `rotation.y` via
   * `localAxisHeadingToWorldRotationY`. `fitAssetToSpec` itself does not
   * rotate anything; it only measures/scales/centres/anchors. */
  localForwardAxis: LocalAxis;
}

export interface FittedAsset {
  /** The wrapper `Group` callers should position/rotate — never the raw
   * `root` directly, which already carries its own internal
   * centring/anchoring transform. */
  wrapper: THREE.Group;
  /** The actual fitted size (metres) along each world axis, post-scale —
   * exposed so callers can derive spacing (e.g. barrier interval) from the
   * real fitted footprint instead of a second, independently-guessed
   * number. */
  size: THREE.Vector3;
}

/** Scales `root` so its raw bbox size along `spec.targetAxis` becomes
 * `spec.targetMeters`, then neutralises two failure modes that a bare
 * `root.scale.setScalar()` + `root.position.set()` does not:
 *
 * 1. **Baked source-node offsets** — several Kenney Racing Kit assets
 *    (barrier/post/pylon) store their mesh on a node with a fixed non-zero
 *    local translation (confirmed by direct GLB inspection — see
 *    docs/asset-sources.md); scaling `root` scales that offset too, so the
 *    model visibly drifts away from wherever a caller thinks it placed it.
 *    Wrapping `root` in a `Group` and shifting *root's own* position by
 *    the negative of its post-scale bbox centre (X/Z) neutralises this
 *    regardless of the offset's origin — the caller only ever positions
 *    the wrapper, which is always centred over its own origin.
 * 2. **Non-zero ground contact height** — an asset's local origin is not
 *    guaranteed to sit at its own visual base (again: baked per-asset,
 *    not a convention every pack follows). Shifting root's Y by
 *    `-bbox.min.y` makes the wrapper's own origin the asset's ground
 *    contact point, so placing the wrapper at world Y=0 (plus whatever
 *    ground lift the caller already applies) sits it exactly on the
 *    surface, never floating or sinking.
 *
 * Never mutates shared geometry or material — `root` here is always a
 * fresh `loadAsset()` clone (see asset-loader.ts), so mutating its own
 * `position`/`scale` is scoped to this one instance only. */
export function fitAssetToSpec(root: THREE.Group, spec: AssetPlacementSpec): FittedAsset {
  const rawBox = new THREE.Box3().setFromObject(root);
  const rawSize = new THREE.Vector3();
  rawBox.getSize(rawSize);

  const rawTargetAxisSize = rawSize[spec.targetAxis];
  if (!(rawTargetAxisSize > 0)) {
    throw new Error(`fitAssetToSpec: asset has zero or invalid size along "${spec.targetAxis}" — cannot derive a scale factor`);
  }
  const scale = spec.targetMeters / rawTargetAxisSize;
  root.scale.setScalar(scale);

  const scaledBox = new THREE.Box3().setFromObject(root);
  const centre = new THREE.Vector3();
  scaledBox.getCenter(centre);

  root.position.x -= centre.x;
  root.position.z -= centre.z;
  root.position.y -= scaledBox.min.y;

  const size = new THREE.Vector3();
  scaledBox.getSize(size);

  const wrapper = new THREE.Group();
  wrapper.add(root);

  return { wrapper, size };
}
