import { describe, expect, it } from "vitest";
import { CAR_HALF_WIDTH_METERS } from "../simulation/constants.ts";
import { VEHICLE_SCALE } from "./scene-scale.ts";

// Regression guard for the exact bug fixed earlier: CAR_HALF_WIDTH_METERS
// (simulation/constants.ts) and VEHICLE_SCALE (this file) are hand-kept in
// sync via comments, by construction, rather than one importing the other
// (simulation must never import from rendering). Nothing enforced that they
// actually stayed in sync — this is the closest a test can get without
// importing across that boundary: re-deriving CAR_HALF_WIDTH_METERS's own
// documented formula (SEDAN_RAW_HALF_WIDTH_METERS * VEHICLE_SCALE, where
// SEDAN_RAW_HALF_WIDTH_METERS = 0.75m is the sedan's raw local-X half-width,
// duplicated by comment in both files) and comparing against the real
// exported constant.
describe("CAR_HALF_WIDTH_METERS / VEHICLE_SCALE", () => {
  const SEDAN_RAW_HALF_WIDTH_METERS = 0.75;

  it("stays derived from VEHICLE_SCALE at the documented raw half-width", () => {
    expect(CAR_HALF_WIDTH_METERS).toBeCloseTo(SEDAN_RAW_HALF_WIDTH_METERS * VEHICLE_SCALE, 6);
  });

  it("VEHICLE_SCALE stays in the sane enlargement range this derivation assumes", () => {
    expect(VEHICLE_SCALE).toBeGreaterThan(1.5);
  });
});
