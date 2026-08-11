import { describe, expect, it } from "vitest";
import { headingToWorldRotationY, simToWorld } from "./coordinates.ts";

describe("simToWorld", () => {
  it("maps sim x to world x unchanged", () => {
    expect(simToWorld(5, 0).x).toBe(5);
  });

  it("negates sim y into world z", () => {
    expect(simToWorld(0, 3).z).toBe(-3);
    expect(simToWorld(0, -3).z).toBe(3);
  });
});

describe("headingToWorldRotationY", () => {
  // Ground-truth check against Three.js's own rotation-matrix convention
  // (Matrix4.makeRotationY), applied by hand rather than importing three —
  // this keeps the derivation in coordinates.ts independently checkable: a
  // local +Z forward vector (0,0,1) rotated by `rotation.y` maps to world
  // (sin(rotation.y), 0, cos(rotation.y)).
  function rotateLocalForwardZ(rotationY: number): { x: number; z: number } {
    return { x: Math.sin(rotationY), z: Math.cos(rotationY) };
  }

  it.each([0, Math.PI / 4, Math.PI / 2, Math.PI, -Math.PI / 3, 2.4])(
    "rotates the model's local +Z forward to match simToWorld's forward direction for heading %f",
    (heading) => {
      const rotationY = headingToWorldRotationY(heading);
      const rotated = rotateLocalForwardZ(rotationY);
      // simToWorld's forward direction for this heading: a unit step along
      // (cos heading, sin heading) in sim space maps to world (cos heading,
      // -sin heading) via simToWorld's x-unchanged/z-negated rule.
      expect(rotated.x).toBeCloseTo(Math.cos(heading), 10);
      expect(rotated.z).toBeCloseTo(-Math.sin(heading), 10);
    },
  );

  it("is a pure function of heading with no hidden state", () => {
    expect(headingToWorldRotationY(1.2)).toBe(headingToWorldRotationY(1.2));
  });
});
