import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

// Turns spec/brief.md's "core interaction, stated testably" into a structural
// check of the *shipped markup*. jsdom here does not execute the module
// script, so this only proves the semantic hooks the interaction depends on
// are present in dist/index.html — the live behaviour (holding throttle while
// steering raises utilisation, saturation flips the state label, drivetrain
// and surface changes take effect) is a real-browser concern and is asserted
// in e2e/viewport.spec.ts instead.
describe("core interaction (assignment-1 spec #4): grip-budget markup contract", () => {
  const distPath = resolve("dist/index.html");
  const doc = new JSDOM(readFileSync(distPath, "utf8")).window.document;

  const required = (testid: string, why: string) => {
    it(`ships [data-testid="${testid}"]`, () => {
      expect(
        doc.querySelector(`[data-testid="${testid}"]`),
        `No [data-testid="${testid}"] in dist/index.html — ${why}`,
      ).toBeTruthy();
    });
  };

  describe("driving controls (the trigger side of the interaction)", () => {
    required("throttle", "the visitor must be able to add longitudinal demand");
    required("brake", "the visitor must be able to shed speed/add longitudinal demand");
    required("steer-left", "the visitor must be able to add lateral demand one way");
    required("steer-right", "the visitor must be able to add lateral demand the other way");
    required("reset", "the visitor must be able to repeat the same corner from the same start");
  });

  describe("experiment settings (change which axle spends the budget)", () => {
    required("drivetrain-fwd", "FWD must be selectable");
    required("drivetrain-rwd", "RWD must be selectable");
    required("drivetrain-awd", "AWD must be selectable");
    required("surface-dry", "the high-grip preset must be selectable");
    required("surface-wet", "the medium-grip preset must be selectable");
    required("surface-ice", "the low-grip preset must be selectable");
  });

  describe("semantic state (the target side of the interaction, and non-visual truth)", () => {
    required("state-label", "stable/understeer/oversteer/slide must be readable as text, not just colour");
    required("state-explanation", "the plain-language explanation of the current state must exist");
    required("front-utilisation", "front-axle grip usage must be readable as a number, not just a gauge");
    required("rear-utilisation", "rear-axle grip usage must be readable as a number, not just a gauge");
    required("longitudinal-g", "longitudinal G must be exposed as text");
    required("lateral-g", "lateral G must be exposed as text");
    required("steering-value", "the current steering input must be exposed as text");
    required("throttle-value", "the current throttle input must be exposed as text");
    required("brake-value", "the current brake input must be exposed as text");
  });

  it("all driving controls are real buttons, so Enter/Space and touch both work", () => {
    for (const testid of ["throttle", "brake", "steer-left", "steer-right", "reset"]) {
      const el = doc.querySelector(`[data-testid="${testid}"]`);
      expect(el?.tagName, `[data-testid="${testid}"] should be a <button>`).toBe("BUTTON");
    }
  });

  it("names the model as a simplified teaching model, not driving instruction", () => {
    const disclosure = doc.querySelector('[data-testid="model-assumptions"]');
    expect(
      disclosure,
      'No [data-testid="model-assumptions"] — the "About this model" disclosure must ship in the markup',
    ).toBeTruthy();
  });
});
