import { describe, expect, it } from "vitest";
import type { TrackParams } from "../simulation/index.ts";
import { arcAngles, pointOnArc, sampleArcAngles } from "./track-geometry.ts";

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
