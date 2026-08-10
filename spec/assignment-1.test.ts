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

  describe("run controls (the trigger side of the interaction)", () => {
    required("start-run", "the visitor must be able to explicitly begin a run rather than one auto-launching");
    required("reset", "the visitor must be able to repeat the same corner from the same start");
  });

  describe("experiment settings (discrete pre-run choices, not real-time input)", () => {
    required("drivetrain-fwd", "FWD must be selectable");
    required("drivetrain-rwd", "RWD must be selectable");
    required("drivetrain-awd", "AWD must be selectable");
    required("surface-dry", "the high-grip preset must be selectable");
    required("surface-wet", "the medium-grip preset must be selectable");
    required("surface-ice", "the low-grip preset must be selectable");
    required("throttle-intensity-light", "the light throttle intensity must be selectable");
    required("throttle-intensity-medium", "the medium throttle intensity must be selectable");
    required("throttle-intensity-full", "the full throttle intensity must be selectable");
    required("throttle-timing-early", "the early throttle timing must be selectable");
    required("throttle-timing-mid", "the mid throttle timing must be selectable");
    required("throttle-timing-late", "the late throttle timing must be selectable");
    required("track-sweep-left", "the gentle left sweep must be selectable");
    required("track-sweep-right", "the gentle right sweep must be selectable");
    required("track-hairpin-left", "the tight left hairpin must be selectable");
    required("track-hairpin-right", "the tight right hairpin must be selectable");
  });

  describe("semantic state (the target side of the interaction, and non-visual truth)", () => {
    required("state-label", "ready/stable/understeer/oversteer/slide/finished must be readable as text, not just colour");
    required("state-explanation", "the plain-language explanation of the current state must exist");
    required("front-utilisation", "front-axle grip usage must be readable as a number, not just a gauge");
    required("rear-utilisation", "rear-axle grip usage must be readable as a number, not just a gauge");
    required("longitudinal-g", "longitudinal G must be exposed as text");
    required("lateral-g", "lateral G must be exposed as text");
    required("steering-value", "the current autosteer telemetry must be exposed as text");
    required("throttle-value", "the current throttle telemetry must be exposed as text");
    required("speed", "actual motion (not just utilisation percentages) must be readable as text");
    required(
      "path-offset",
      "the car's real trajectory error against the reference line must be readable as text",
    );
  });

  it("all setting pickers and run controls are real buttons, so Enter/Space and touch both work", () => {
    const testids = [
      "start-run",
      "reset",
      "drivetrain-fwd",
      "drivetrain-rwd",
      "drivetrain-awd",
      "surface-dry",
      "surface-wet",
      "surface-ice",
      "throttle-intensity-light",
      "throttle-intensity-medium",
      "throttle-intensity-full",
      "throttle-timing-early",
      "throttle-timing-mid",
      "throttle-timing-late",
      "track-sweep-left",
      "track-sweep-right",
      "track-hairpin-left",
      "track-hairpin-right",
    ];
    for (const testid of testids) {
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
