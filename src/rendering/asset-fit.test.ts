import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { fitAssetToSpec, type AssetPlacementSpec } from "./asset-fit.ts";

/** A synthetic asset with a baked, off-centre node translation — mirrors the
 * real bug this module fixes: Kenney's barrier/post/pylon GLBs all store
 * their single mesh on a node with a fixed non-zero local translation (see
 * docs/asset-sources.md), which a bare scale+position application would
 * amplify into visible drift as the scale factor grows. `offset` lets each
 * test vary how far off-centre (and how far above/below ground) the raw
 * source geometry sits, to prove centring/anchoring is offset-independent. */
function buildOffsetBox(size: [number, number, number], offset: [number, number, number]): THREE.Group {
  const root = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), new THREE.MeshStandardMaterial());
  mesh.position.set(...offset);
  root.add(mesh);
  return root;
}

describe("fitAssetToSpec", () => {
  it("scales the model so its fitted size along targetAxis matches targetMeters", () => {
    const root = buildOffsetBox([0.25, 0.13, 0.12], [0, 0, 0]);
    const spec: AssetPlacementSpec = { targetAxis: "x", targetMeters: 2.5, localForwardAxis: "+x" };

    const { size } = fitAssetToSpec(root, spec);

    expect(size.x).toBeCloseTo(2.5, 6);
    // Uniform scale: the other axes grow by the same factor (10x here),
    // not independently — 0.13 * 10 = 1.3, 0.12 * 10 = 1.2.
    expect(size.y).toBeCloseTo(1.3, 6);
    expect(size.z).toBeCloseTo(1.2, 6);
  });

  it("anchors the wrapper's bbox to Y=0 regardless of the source mesh's own vertical offset", () => {
    const root = buildOffsetBox([1, 1, 1], [0, 5, 0]);
    const spec: AssetPlacementSpec = { targetAxis: "y", targetMeters: 2, localForwardAxis: "+z" };

    const { wrapper } = fitAssetToSpec(root, spec);

    const box = new THREE.Box3().setFromObject(wrapper);
    expect(box.min.y).toBeCloseTo(0, 6);
    expect(box.max.y).toBeCloseTo(2, 6);
  });

  it("horizontally centres the wrapper at the origin even when the source node carries a baked off-centre translation", () => {
    // Mirrors the real Racing Kit offset confirmed by direct GLB inspection
    // (barrier/post/pylon all share local translation (-0.35, -0.01, -0.65)
    // on their one mesh node) — scaled up here to make drift obvious if the
    // centring logic regressed.
    const root = buildOffsetBox([0.25, 0.13, 0.12], [-0.35, -0.01, -0.65]);
    const spec: AssetPlacementSpec = { targetAxis: "x", targetMeters: 2.5, localForwardAxis: "+x" };

    const { wrapper } = fitAssetToSpec(root, spec);

    const box = new THREE.Box3().setFromObject(wrapper);
    const centre = new THREE.Vector3();
    box.getCenter(centre);
    expect(centre.x).toBeCloseTo(0, 6);
    expect(centre.z).toBeCloseTo(0, 6);
  });

  it("centres and anchors identically for two different baked offsets, once fitted to the same spec", () => {
    const specX: AssetPlacementSpec = { targetAxis: "x", targetMeters: 3, localForwardAxis: "+x" };

    const rootA = buildOffsetBox([1, 1, 1], [0, 0, 0]);
    const rootB = buildOffsetBox([1, 1, 1], [10, -20, 30]);

    const fittedA = fitAssetToSpec(rootA, specX);
    const fittedB = fitAssetToSpec(rootB, specX);

    const boxA = new THREE.Box3().setFromObject(fittedA.wrapper);
    const boxB = new THREE.Box3().setFromObject(fittedB.wrapper);
    const centreA = new THREE.Vector3();
    const centreB = new THREE.Vector3();
    boxA.getCenter(centreA);
    boxB.getCenter(centreB);

    expect(centreA.x).toBeCloseTo(centreB.x, 6);
    expect(centreA.z).toBeCloseTo(centreB.z, 6);
    expect(boxA.min.y).toBeCloseTo(boxB.min.y, 6);
  });

  it("never mutates the caller's own reference beyond the passed-in root — geometry/material objects are untouched", () => {
    const root = buildOffsetBox([1, 1, 1], [0, 0, 0]);
    const mesh = root.children[0] as THREE.Mesh;
    const geometry = mesh.geometry;
    const material = mesh.material;

    fitAssetToSpec(root, { targetAxis: "x", targetMeters: 5, localForwardAxis: "+x" });

    expect(mesh.geometry).toBe(geometry);
    expect(mesh.material).toBe(material);
  });

  it("throws rather than silently producing an infinite/NaN scale when the target axis has zero raw size", () => {
    const root = new THREE.Group();
    // No mesh added — Box3().setFromObject on an empty group is degenerate.
    expect(() => fitAssetToSpec(root, { targetAxis: "x", targetMeters: 1, localForwardAxis: "+x" })).toThrow();
  });
});
