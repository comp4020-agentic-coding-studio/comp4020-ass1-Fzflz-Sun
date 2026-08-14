import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

// Turns spec/brief.md's progressive-explorable structure into a structural
// check of the *shipped markup*. jsdom here does not execute the module
// script, so this only proves the semantic hooks each module depends on are
// present in dist/index.html — the live behaviour (Ready until Run, rising
// utilisation, saturation flipping the state label, one module's settings
// never touching another's) is a real-browser concern and is asserted in
// e2e/viewport.spec.ts instead.
const distPath = resolve("dist/index.html");
const doc = new JSDOM(readFileSync(distPath, "utf8")).window.document;

// Comparison order matches spec/brief.md's five teaching modules, each one
// variable, everything else fixed. `pickers` is that module's ONE editable
// setting's testids — the module must expose exactly these and no other
// setting testid, per CLAUDE.md's "one variable per teaching module" rule.
const MODULES = [
  { testid: "module-1", pickers: ["track-sweep-right", "track-hairpin-right"] },
  { testid: "module-2", pickers: ["surface-dry", "surface-wet", "surface-ice"] },
  {
    testid: "module-3",
    pickers: ["throttle-intensity-light", "throttle-intensity-medium", "throttle-intensity-full"],
  },
  { testid: "module-4", pickers: ["drivetrain-fwd", "drivetrain-rwd", "drivetrain-awd"] },
  { testid: "module-5", pickers: ["throttle-timing-early", "throttle-timing-mid", "throttle-timing-late"] },
] as const;

// The minimal telemetry every teaching module needs to make its own
// single-variable conclusion legible (state + which axle + real motion),
// deliberately short of the sandbox's full instrument panel — repeating every
// technical readout (G-forces, steering/throttle %, path offset) in every
// chapter is explicitly excluded by spec/brief.md's teaching-signal rules.
const MODULE_TELEMETRY = ["state-label", "front-utilisation", "rear-utilisation", "speed"];
const MODULE_RUN_CONTROLS = ["start-run", "reset"];
const ALL_SETTING_PREFIXES = ["drivetrain-", "surface-", "throttle-intensity-", "throttle-timing-", "track-"];

function container(testid: string): Element {
  const el = doc.querySelector(`[data-testid="${testid}"]`);
  if (!el) throw new Error(`No [data-testid="${testid}"] container in dist/index.html`);
  return el;
}

describe("intro: no full sandbox on the first screen", () => {
  it("ships #intro_container > #intro with a local background iframe and overlay copy", () => {
    const introContainer = doc.querySelector("#intro_container");
    expect(introContainer, "#intro_container must exist").toBeTruthy();
    const intro = doc.querySelector("#intro");
    expect(intro, "#intro must exist").toBeTruthy();
    expect(introContainer?.contains(intro ?? null)).toBe(true);

    const iframe = doc.querySelector<HTMLIFrameElement>("#intro_background");
    expect(iframe, "#intro_background iframe must exist").toBeTruthy();
    expect(intro?.contains(iframe ?? null)).toBe(true);

    const copy = doc.querySelector(".intro-copy");
    expect(copy, ".intro-copy must exist").toBeTruthy();
    expect(intro?.contains(copy ?? null)).toBe(true);
  });

  it("the iframe points at a local, relative page — never root-absolute or third-party", () => {
    const iframe = doc.querySelector<HTMLIFrameElement>("#intro_background");
    const src = iframe?.getAttribute("src") ?? "";
    expect(src.startsWith("/")).toBe(false);
    expect(/^https?:\/\//.test(src)).toBe(false);
    expect(src).toBe("./play/intro/intro.html");
  });

  it("does not expose any teaching-module or sandbox setting picker before the first module", () => {
    const introContainer = container("intro_container");
    for (const prefix of ALL_SETTING_PREFIXES) {
      const leaked = Array.from(introContainer.querySelectorAll("[data-testid]")).filter((el) =>
        (el.getAttribute("data-testid") ?? "").startsWith(prefix),
      );
      expect(leaked.length, `#intro_container leaked a "${prefix}*" setting picker`).toBe(0);
    }
  });
});

describe.each(MODULES)("teaching module $testid", ({ testid, pickers }) => {
  it("exists exactly once as a .story-module", () => {
    const matches = doc.querySelectorAll(`[data-testid="${testid}"]`);
    expect(matches.length, `expected exactly one [data-testid="${testid}"]`).toBe(1);
    expect(matches[0].classList.contains("story-module")).toBe(true);
  });

  it("has independent Run/Reset controls as real buttons", () => {
    const el = container(testid);
    for (const id of MODULE_RUN_CONTROLS) {
      const control = el.querySelector(`[data-testid="${id}"]`);
      expect(control, `${testid} missing [data-testid="${id}"]`).toBeTruthy();
      expect(control?.tagName, `${testid}'s ${id} must be a <button>`).toBe("BUTTON");
    }
  });

  it("has its own minimal telemetry and a live-updating result region", () => {
    const el = container(testid);
    for (const id of MODULE_TELEMETRY) {
      expect(el.querySelector(`[data-testid="${id}"]`), `${testid} missing [data-testid="${id}"]`).toBeTruthy();
    }
    const result = el.querySelector('[data-testid="module-result"]');
    expect(result, `${testid} missing [data-testid="module-result"]`).toBeTruthy();
    expect(result?.getAttribute("aria-live")).toBe("polite");
  });

  it("exposes exactly the one variable it teaches, as buttons, and no other setting picker", () => {
    const el = container(testid);
    for (const id of pickers) {
      const picker = el.querySelector(`[data-testid="${id}"]`);
      expect(picker, `${testid} missing its own [data-testid="${id}"]`).toBeTruthy();
      expect(picker?.tagName, `${testid}'s ${id} must be a <button>`).toBe("BUTTON");
    }

    const settingTestids = Array.from(el.querySelectorAll("[data-testid]"))
      .map((node) => node.getAttribute("data-testid") ?? "")
      .filter((id) => ALL_SETTING_PREFIXES.some((prefix) => id.startsWith(prefix)));
    expect(new Set(settingTestids), `${testid} exposed extra settings: ${settingTestids.join(", ")}`).toEqual(
      new Set(pickers),
    );
  });

  it("has an own canvas and overlay, never shared with another module", () => {
    const el = container(testid);
    expect(el.querySelector('[data-testid="scene-canvas"]')).toBeTruthy();
    expect(el.querySelector(".module-overlay")).toBeTruthy();
  });
});

describe("modules appear in conceptual order, followed by the sandbox", () => {
  it("module-1..5 and sandbox are in document order", () => {
    const ids = ["module-1", "module-2", "module-3", "module-4", "module-5", "sandbox"];
    const nodes = ids.map(container);
    const DOCUMENT_POSITION_FOLLOWING = 4;
    for (let i = 1; i < nodes.length; i++) {
      const relation = nodes[i - 1].compareDocumentPosition(nodes[i]);
      expect(
        Boolean(relation & DOCUMENT_POSITION_FOLLOWING),
        `${ids[i]} must come after ${ids[i - 1]}`,
      ).toBe(true);
    }
  });
});

describe("sandbox: the only place full experimentation lives", () => {
  const SENTENCE_SELECTS = [
    "drivetrain-select",
    "surface-select",
    "throttle-intensity-select",
    "throttle-timing-select",
    "track-shape-select",
  ];
  const TELEMETRY = [
    "state-label",
    "state-explanation",
    "speed",
    "path-offset",
    "front-utilisation",
    "rear-utilisation",
    "longitudinal-g",
    "lateral-g",
    "steering-value",
    "throttle-value",
  ];

  it("exists exactly once, with its own Run/Reset buttons", () => {
    expect(doc.querySelectorAll('[data-testid="sandbox"]').length).toBe(1);
    const el = container("sandbox");
    for (const id of MODULE_RUN_CONTROLS) {
      const control = el.querySelector(`[data-testid="${id}"]`);
      expect(control, `sandbox missing [data-testid="${id}"]`).toBeTruthy();
      expect(control?.tagName).toBe("BUTTON");
    }
  });

  it("exposes every core variable as a <select> in the mad-libs sentence", () => {
    const el = container("sandbox");
    for (const id of SENTENCE_SELECTS) {
      const select = el.querySelector(`[data-testid="${id}"]`);
      expect(select, `sandbox missing [data-testid="${id}"]`).toBeTruthy();
      expect(select?.tagName, `sandbox's ${id} must be a <select>`).toBe("SELECT");
    }
  });

  it("tucks track direction inside an Advanced setup disclosure", () => {
    const el = container("sandbox");
    const advanced = el.querySelector('[data-testid="advanced-setup"]');
    expect(advanced, "sandbox missing [data-testid=\"advanced-setup\"]").toBeTruthy();
    expect(advanced?.tagName).toBe("DETAILS");
    const direction = advanced?.querySelector('[data-testid="track-direction-select"]');
    expect(direction, "advanced-setup missing [data-testid=\"track-direction-select\"]").toBeTruthy();
    expect(direction?.tagName).toBe("SELECT");
  });

  it("wraps the full instrument panel inside a collapsible Telemetry disclosure", () => {
    const el = container("sandbox");
    const telemetry = el.querySelector('[data-testid="telemetry"]');
    expect(telemetry, "sandbox missing [data-testid=\"telemetry\"]").toBeTruthy();
    expect(telemetry?.tagName).toBe("DETAILS");
    for (const id of TELEMETRY) {
      expect(telemetry?.querySelector(`[data-testid="${id}"]`), `telemetry missing [data-testid="${id}"]`).toBeTruthy();
    }
  });

  it("names the model as a simplified teaching model, not driving instruction", () => {
    const disclosures = doc.querySelectorAll('[data-testid="model-assumptions"]');
    expect(disclosures.length, 'exactly one [data-testid="model-assumptions"] must ship').toBe(1);
  });
});

describe("no duplicate structural data-testids", () => {
  it("each module container and the sandbox container is unique", () => {
    for (const { testid } of MODULES) {
      expect(doc.querySelectorAll(`[data-testid="${testid}"]`).length).toBe(1);
    }
    expect(doc.querySelectorAll('[data-testid="sandbox"]').length).toBe(1);
  });
});
