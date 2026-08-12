import { describe, expect, it } from "vitest";
import { localAxisHeadingToWorldRotationY, sedanHeadingToWorldRotationY, simToWorld, type LocalAxis } from "./coordinates.ts";

describe("simToWorld", () => {
  it("maps sim x to world x unchanged", () => {
    expect(simToWorld(5, 0).x).toBe(5);
  });

  it("negates sim y into world z", () => {
    expect(simToWorld(0, 3).z).toBe(-3);
    expect(simToWorld(0, -3).z).toBe(3);
  });
});

// Ground-truth check against Three.js's own rotation-matrix convention
// (Matrix4.makeRotationY), applied by hand rather than importing three —
// this keeps the derivation in coordinates.ts independently checkable: a
// local point (lx, 0, lz) rotated by `rotation.y` maps to world
// (lx*cos(rotationY) + lz*sin(rotationY), 0, -lx*sin(rotationY) +
// lz*cos(rotationY)).
function rotateLocalXZ(rotationY: number, lx: number, lz: number): { x: number; z: number } {
  return {
    x: lx * Math.cos(rotationY) + lz * Math.sin(rotationY),
    z: -lx * Math.sin(rotationY) + lz * Math.cos(rotationY),
  };
}

const LOCAL_FORWARD: Record<LocalAxis, { lx: number; lz: number }> = {
  "+x": { lx: 1, lz: 0 },
  "-x": { lx: -1, lz: 0 },
  "+z": { lx: 0, lz: 1 },
  "-z": { lx: 0, lz: -1 },
};

describe("localAxisHeadingToWorldRotationY", () => {
  const headings = [0, Math.PI / 4, Math.PI / 2, Math.PI, -Math.PI / 3, 2.4];
  const axes: LocalAxis[] = ["+x", "-x", "+z", "-z"];

  it.each(axes.flatMap((axis) => headings.map((heading) => [axis, heading] as const)))(
    "rotates a model's local %s forward to match simToWorld's forward direction for heading %f",
    (axis, heading) => {
      const rotationY = localAxisHeadingToWorldRotationY(heading, axis);
      const { lx, lz } = LOCAL_FORWARD[axis];
      const rotated = rotateLocalXZ(rotationY, lx, lz);
      // simToWorld's forward direction for this heading: a unit step along
      // (cos heading, sin heading) in sim space maps to world (cos heading,
      // -sin heading) via simToWorld's x-unchanged/z-negated rule.
      expect(rotated.x).toBeCloseTo(Math.cos(heading), 10);
      expect(rotated.z).toBeCloseTo(-Math.sin(heading), 10);
    },
  );

  it("is a pure function of its inputs with no hidden state", () => {
    expect(localAxisHeadingToWorldRotationY(1.2, "+x")).toBe(localAxisHeadingToWorldRotationY(1.2, "+x"));
  });

  it("differs per local axis for the same heading", () => {
    const heading = 0.7;
    const values = axes.map((axis) => localAxisHeadingToWorldRotationY(heading, axis));
    expect(new Set(values.map((v) => Math.round(v * 1e9))).size).toBe(4);
  });
});

describe("sedanHeadingToWorldRotationY", () => {
  it("matches localAxisHeadingToWorldRotationY for the +z axis (sedan.glb's confirmed local forward)", () => {
    for (const heading of [0, Math.PI / 4, Math.PI / 2, Math.PI, -Math.PI / 3, 2.4]) {
      expect(sedanHeadingToWorldRotationY(heading)).toBeCloseTo(localAxisHeadingToWorldRotationY(heading, "+z"), 12);
    }
  });
});
