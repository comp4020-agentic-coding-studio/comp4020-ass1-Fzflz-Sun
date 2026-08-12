import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { TRACK_PRESETS } from "../simulation/constants.ts";
import type { TrackParams } from "../simulation/index.ts";
import {
  arcAngles,
  buildTrackGeometry,
  FINISH_LIFT_METERS,
  KERB_LIFT_METERS,
  pointOnArc,
  REFERENCE_LIFT_METERS,
  ROAD_LIFT_METERS,
  sampleArcAngles,
} from "./track-geometry.ts";

function track(overrides: Partial<TrackParams>): TrackParams {
  return {
    radius: 45,
    direction: "right",
    sweepAngle: Math.PI / 2,
    autosteerFraction: 0.7,
    expectedTraversalSeconds: 5.9,
    ...overrides,
  } as TrackParams;
}

describe("arcAngles", () => {
  it("starts a right track at +pi/2 and sweeps clockwise (decreasing angle)", () => {
    const { start, end } = arcAngles(track({ direction: "right", sweepAngle: Math.PI / 2 }));
    expect(start).toBeCloseTo(Math.PI / 2, 10);
    expect(end).toBeCloseTo(0, 10);
  });

  it("starts a left track at -pi/2 and sweeps counterclockwise (increasing angle)", () => {
    const { start, end } = arcAngles(track({ direction: "left", sweepAngle: Math.PI / 2 }));
    expect(start).toBeCloseTo(-Math.PI / 2, 10);
    expect(end).toBeCloseTo(0, 10);
  });

  it("mirrors left/right of the same sweepAngle around 0", () => {
    const right = arcAngles(track({ direction: "right", sweepAngle: (5 * Math.PI) / 6 }));
    const left = arcAngles(track({ direction: "left", sweepAngle: (5 * Math.PI) / 6 }));
    expect(right.start).toBeCloseTo(-left.start, 10);
    expect(right.end).toBeCloseTo(-left.end, 10);
  });
});

describe("pointOnArc", () => {
  it("places angle 0 directly along +x from the centre", () => {
    const point = pointOnArc({ x: 1, y: 2 }, 10, 0);
    expect(point.x).toBeCloseTo(11, 10);
    expect(point.y).toBeCloseTo(2, 10);
  });

  it("places angle pi/2 directly along +y from the centre", () => {
    const point = pointOnArc({ x: 0, y: 0 }, 5, Math.PI / 2);
    expect(point.x).toBeCloseTo(0, 10);
    expect(point.y).toBeCloseTo(5, 10);
  });
});

describe("sampleArcAngles", () => {
  it("starts and ends exactly on the track's own arcAngles", () => {
    const t = track({ direction: "right", sweepAngle: Math.PI / 2, radius: 45 });
    const { start, end } = arcAngles(t);
    const angles = sampleArcAngles(t, 4);
    expect(angles[0]).toBeCloseTo(start, 10);
    expect(angles[angles.length - 1]).toBeCloseTo(end, 10);
  });

  it("spaces samples evenly", () => {
    const angles = sampleArcAngles(track({ direction: "left", sweepAngle: (5 * Math.PI) / 6, radius: 40 }), 4);
    const step = angles[1] - angles[0];
    for (let i = 1; i < angles.length; i++) {
      expect(angles[i] - angles[i - 1]).toBeCloseTo(step, 10);
    }
  });

  it("produces at least two samples even for a tiny sweep", () => {
    const angles = sampleArcAngles(track({ sweepAngle: 0.001, radius: 45 }), 4);
    expect(angles.length).toBeGreaterThanOrEqual(2);
  });
});

// Regression coverage for a real bug: simToWorld's worldZ = -simY is a
// reflection, which flips triangle winding for one track direction relative
// to the other. buildSegmentGeometry used to assume one fixed vertex order
// was always correct (verified only "by hand for a segment running along
// +worldX"), which made every right-turn track's road/kerb/reference-line
// backface-cull invisible from the default chase camera while every
// left-turn track looked fine. These tests derive each triangle's real
// geometric normal from its actual world-space vertex positions via a cross
// product — deliberately not reading the hand-written `normal` buffer
// attribute, since that attribute and the true winding-derived normal can
// disagree (GPU backface culling follows winding order, not the normal
// attribute) and a bug in exactly that disagreement is what this covers.
describe("buildTrackGeometry winding", () => {
  function triangleNormalY(position: THREE.BufferAttribute, triangleIndex: number): number {
    const i = triangleIndex * 3;
    const p0 = new THREE.Vector3().fromBufferAttribute(position, i);
    const p1 = new THREE.Vector3().fromBufferAttribute(position, i + 1);
    const p2 = new THREE.Vector3().fromBufferAttribute(position, i + 2);
    const normal = new THREE.Vector3().subVectors(p1, p0).cross(new THREE.Vector3().subVectors(p2, p0));
    return normal.y;
  }

  it.each(Object.values(TRACK_PRESETS))(
    "every road/kerb/reference-line/finish-marker triangle in track $id faces world +Y by real winding",
    (trackParams) => {
      const group = buildTrackGeometry(trackParams);
      let triangleCount = 0;
      group.traverse((node) => {
        if (!(node instanceof THREE.Mesh)) return;
        const position = node.geometry.getAttribute("position") as THREE.BufferAttribute;
        const triangles = position.count / 3;
        for (let t = 0; t < triangles; t++) {
          expect(triangleNormalY(position, t)).toBeGreaterThan(0);
          triangleCount++;
        }
      });
      // Sanity check that this test actually walked real geometry, not an
      // empty group that would trivially "pass" with zero assertions.
      expect(triangleCount).toBeGreaterThan(0);
    },
  );
});

describe("track layer heights", () => {
  it("keeps road, kerb, reference-line, and finish-marker at distinct, strictly ascending heights, with the road never coplanar with the ground (world Y=0)", () => {
    expect(ROAD_LIFT_METERS).toBeGreaterThan(0);
    expect(KERB_LIFT_METERS).toBeGreaterThan(ROAD_LIFT_METERS);
    expect(REFERENCE_LIFT_METERS).toBeGreaterThan(KERB_LIFT_METERS);
    expect(FINISH_LIFT_METERS).toBeGreaterThan(REFERENCE_LIFT_METERS);
  });
});
