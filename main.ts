import { createExperimentController } from "./src/experiments/controller.ts";
import type { ExperimentSettings, SettingSource } from "./src/experiments/controller.ts";
import {
  module1Conclusion,
  module2Conclusion,
  module3Conclusion,
  module4Conclusion,
  module5Conclusion,
  sandboxConclusion,
} from "./src/experiments/conclusions.ts";

// Builds one independent createExperimentController instance per teaching
// module plus one for the sandbox — replacing the old single set of
// module-level globals (see git history). Every module fixes every setting
// except the one it teaches; the sandbox is the only instance that exposes
// all five (spec/brief.md).

function requiredRoot(testid: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-testid="${testid}"]`);
  if (!el) throw new Error(`main.ts: missing [data-testid="${testid}"] container`);
  return el;
}

// Scroll-progress vignette on the intro: a dependency-free scroll listener
// sets --intro-shadow (0..1) on #intro_container as the visitor scrolls
// through its pinned intro, cueing that the first module is about to cover
// it (src/styles/main.css's #intro::after reads this variable). Under
// reduced motion this is a single static partial shadow, never re-evaluated
// per frame, rather than a live scroll-driven animation.
const introContainer = document.querySelector<HTMLElement>("#intro_container");
if (introContainer) {
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reducedMotion) {
    introContainer.style.setProperty("--intro-shadow", "0.35");
  } else {
    let ticking = false;
    const updateShadow = (): void => {
      ticking = false;
      const maxScroll = Math.max(1, introContainer.offsetHeight - window.innerHeight);
      const progress = Math.min(1, Math.max(0, window.scrollY / maxScroll));
      introContainer.style.setProperty("--intro-shadow", String(progress));
    };
    updateShadow();
    window.addEventListener(
      "scroll",
      () => {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(updateShadow);
      },
      { passive: true },
    );
    window.addEventListener("resize", updateShadow);
  }
}

const BASE_SETTINGS: ExperimentSettings = {
  drivetrain: "RWD",
  surface: "dry",
  throttleIntensity: "medium",
  throttleTiming: "early",
  track: "sweep-right",
};

createExperimentController({
  root: requiredRoot("module-1"),
  initialSettings: { ...BASE_SETTINGS },
  settings: [
    {
      kind: "buttons",
      key: "track",
      options: [
        { value: "sweep-right", testid: "track-sweep-right" },
        { value: "hairpin-right", testid: "track-hairpin-right" },
      ],
    },
  ] satisfies SettingSource[],
  onFinish: module1Conclusion,
});

createExperimentController({
  root: requiredRoot("module-2"),
  initialSettings: { ...BASE_SETTINGS, throttleIntensity: "full" },
  settings: [
    {
      kind: "buttons",
      key: "surface",
      options: [
        { value: "dry", testid: "surface-dry" },
        { value: "wet", testid: "surface-wet" },
        { value: "ice", testid: "surface-ice" },
      ],
    },
  ] satisfies SettingSource[],
  onFinish: module2Conclusion,
});

createExperimentController({
  root: requiredRoot("module-3"),
  initialSettings: { ...BASE_SETTINGS },
  settings: [
    {
      kind: "buttons",
      key: "throttleIntensity",
      options: [
        { value: "light", testid: "throttle-intensity-light" },
        { value: "medium", testid: "throttle-intensity-medium" },
        { value: "full", testid: "throttle-intensity-full" },
      ],
    },
  ] satisfies SettingSource[],
  onFinish: module3Conclusion,
});

createExperimentController({
  root: requiredRoot("module-4"),
  initialSettings: { ...BASE_SETTINGS, throttleIntensity: "full" },
  settings: [
    {
      kind: "buttons",
      key: "drivetrain",
      options: [
        { value: "FWD", testid: "drivetrain-fwd" },
        { value: "RWD", testid: "drivetrain-rwd" },
        { value: "AWD", testid: "drivetrain-awd" },
      ],
    },
  ] satisfies SettingSource[],
  onFinish: module4Conclusion,
});

createExperimentController({
  root: requiredRoot("module-5"),
  initialSettings: { ...BASE_SETTINGS, throttleIntensity: "full" },
  settings: [
    {
      kind: "buttons",
      key: "throttleTiming",
      options: [
        { value: "early", testid: "throttle-timing-early" },
        { value: "mid", testid: "throttle-timing-mid" },
        { value: "late", testid: "throttle-timing-late" },
      ],
    },
  ] satisfies SettingSource[],
  onFinish: module5Conclusion,
});

createExperimentController({
  root: requiredRoot("sandbox"),
  initialSettings: { ...BASE_SETTINGS },
  settings: [
    { kind: "select", key: "drivetrain", testid: "drivetrain-select" },
    { kind: "select", key: "surface", testid: "surface-select" },
    { kind: "select", key: "throttleIntensity", testid: "throttle-intensity-select" },
    { kind: "select", key: "throttleTiming", testid: "throttle-timing-select" },
    { kind: "track-select-pair", shapeTestid: "track-shape-select", directionTestid: "track-direction-select" },
  ] satisfies SettingSource[],
  onFinish: sandboxConclusion,
});

// The sandbox's own primary button relabels itself after first use
// (spec/brief.md's "Run experiment" -> "Run again") — a presentational detail
// the shared controller doesn't need to know about, so it's applied here as a
// second, independent click listener on the same button rather than plumbed
// through ExperimentControllerOptions.
const sandboxStartButton = requiredRoot("sandbox").querySelector<HTMLButtonElement>('[data-testid="start-run"]');
sandboxStartButton?.addEventListener(
  "click",
  () => {
    sandboxStartButton.textContent = "Run again";
  },
  { once: true },
);
