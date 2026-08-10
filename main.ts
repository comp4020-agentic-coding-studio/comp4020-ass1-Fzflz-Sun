import { createGripScene } from "./src/rendering/scene.ts";
import {
  CAR_PARAMS,
  controlsAtElapsed,
  createInitialState,
  DEFAULT_TRACK_ID,
  FIXED_TIMESTEP,
  shouldFinish,
  startRun,
  step,
  TRACK_PRESETS,
} from "./src/simulation/index.ts";
import type {
  DrivetrainId,
  SimState,
  SurfaceId,
  ThrottleIntensityId,
  ThrottleTimingId,
  TrackId,
} from "./src/simulation/index.ts";
import { createInstruments } from "./src/ui/instruments.ts";

function required<T extends Element>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`main.ts: missing required element ${selector}`);
  return el;
}

const startButton = required<HTMLElement>('[data-testid="start-run"]');
const resetButton = required<HTMLElement>('[data-testid="reset"]');

const drivetrainButtons: Array<[DrivetrainId, HTMLButtonElement]> = [
  ["FWD", required('[data-testid="drivetrain-fwd"]')],
  ["RWD", required('[data-testid="drivetrain-rwd"]')],
  ["AWD", required('[data-testid="drivetrain-awd"]')],
];
const surfaceButtons: Array<[SurfaceId, HTMLButtonElement]> = [
  ["dry", required('[data-testid="surface-dry"]')],
  ["wet", required('[data-testid="surface-wet"]')],
  ["ice", required('[data-testid="surface-ice"]')],
];
const throttleIntensityButtons: Array<[ThrottleIntensityId, HTMLButtonElement]> = [
  ["light", required('[data-testid="throttle-intensity-light"]')],
  ["medium", required('[data-testid="throttle-intensity-medium"]')],
  ["full", required('[data-testid="throttle-intensity-full"]')],
];
const throttleTimingButtons: Array<[ThrottleTimingId, HTMLButtonElement]> = [
  ["early", required('[data-testid="throttle-timing-early"]')],
  ["mid", required('[data-testid="throttle-timing-mid"]')],
  ["late", required('[data-testid="throttle-timing-late"]')],
];
const trackButtons: Array<[TrackId, HTMLButtonElement]> = [
  ["sweep-left", required('[data-testid="track-sweep-left"]')],
  ["sweep-right", required('[data-testid="track-sweep-right"]')],
  ["hairpin-left", required('[data-testid="track-hairpin-left"]')],
  ["hairpin-right", required('[data-testid="track-hairpin-right"]')],
];

let currentDrivetrain: DrivetrainId = "RWD";
let currentSurface: SurfaceId = "dry";
let currentThrottleIntensity: ThrottleIntensityId = "medium";
let currentThrottleTiming: ThrottleTimingId = "early";
let currentTrack: TrackId = DEFAULT_TRACK_ID;
let simState: SimState = createInitialState(
  currentDrivetrain,
  currentSurface,
  currentThrottleIntensity,
  currentThrottleTiming,
  currentTrack,
);

function selectOption<T extends string>(
  buttons: Array<[T, HTMLButtonElement]>,
  value: T,
  apply: (value: T) => void,
): void {
  for (const [id, el] of buttons) el.setAttribute("aria-pressed", String(id === value));
  apply(value);
}

// Discrete pre-run settings are only editable while a run isn't in
// progress — mid-run they must stay fixed for the comparison to be fair.
// Both "ready" and "finished" leave them enabled, so a visitor can change a
// setting and press Run again without a forced Reset in between.
function updateSettingButtonsDisabled(): void {
  const disabled = simState.phase === "running";
  for (const [, el] of [
    ...drivetrainButtons,
    ...surfaceButtons,
    ...throttleIntensityButtons,
    ...throttleTimingButtons,
    ...trackButtons,
  ]) {
    el.disabled = disabled;
  }
}

const instruments = createInstruments();

const canvas = required<HTMLCanvasElement>('[data-testid="scene-canvas"]');
let scene: ReturnType<typeof createGripScene> | null = null;
try {
  scene = createGripScene(canvas);
} catch (error) {
  // A canvas-less browser still gets the full instrument-panel explanation
  // (CLAUDE.md) — the 2D view is a bonus, not the source of truth.
  console.warn("2D scene unavailable, continuing with instrument panel only:", error);
}

const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
let reducedMotion = reducedMotionQuery.matches;
reducedMotionQuery.addEventListener("change", (event) => {
  reducedMotion = event.matches;
});

// Applies a new sim state to the DOM/scene immediately, rather than waiting
// for the next requestAnimationFrame tick — otherwise a click handler that
// resets state can race the next paint, occasionally leaving stale numbers
// on screen for a frame (a real flake caught in e2e on the phone viewport).
function renderImmediately(): void {
  instruments.update(simState);
  scene?.update(simState, reducedMotion);
  updateSettingButtonsDisabled();
}

for (const [id, el] of drivetrainButtons) {
  el.addEventListener("click", () => {
    currentDrivetrain = id;
    simState = { ...simState, drivetrain: id };
    selectOption(drivetrainButtons, id, () => {});
    renderImmediately();
  });
}
for (const [id, el] of surfaceButtons) {
  el.addEventListener("click", () => {
    currentSurface = id;
    simState = { ...simState, surface: id };
    selectOption(surfaceButtons, id, () => {});
    renderImmediately();
  });
}
for (const [id, el] of throttleIntensityButtons) {
  el.addEventListener("click", () => {
    currentThrottleIntensity = id;
    simState = { ...simState, throttleIntensity: id };
    selectOption(throttleIntensityButtons, id, () => {});
    renderImmediately();
  });
}
for (const [id, el] of throttleTimingButtons) {
  el.addEventListener("click", () => {
    currentThrottleTiming = id;
    simState = { ...simState, throttleTiming: id };
    selectOption(throttleTimingButtons, id, () => {});
    renderImmediately();
  });
}
for (const [id, el] of trackButtons) {
  el.addEventListener("click", () => {
    currentTrack = id;
    simState = { ...simState, track: id };
    selectOption(trackButtons, id, () => {});
    renderImmediately();
  });
}

startButton.addEventListener("click", () => {
  // Safe from "ready" or "finished" alike — no forced Reset in between.
  simState = startRun(simState);
  accumulator = 0;
  renderImmediately();
});

resetButton.addEventListener("click", () => {
  simState = createInitialState(
    currentDrivetrain,
    currentSurface,
    currentThrottleIntensity,
    currentThrottleTiming,
    currentTrack,
  );
  accumulator = 0;
  renderImmediately();
});

window.addEventListener("resize", () => scene?.resize());

const MAX_STEPS_PER_FRAME = 8; // caps the catch-up if a tab was backgrounded
let accumulator = 0;
let lastTime: number | null = null;

function frame(time: number): void {
  if (lastTime === null) lastTime = time;
  const dt = Math.min(0.25, (time - lastTime) / 1000);
  lastTime = time;
  accumulator += dt;

  let steps = 0;
  while (accumulator >= FIXED_TIMESTEP && steps < MAX_STEPS_PER_FRAME) {
    const controls = controlsAtElapsed(
      simState.elapsed,
      simState.throttleIntensity,
      simState.throttleTiming,
      CAR_PARAMS,
      TRACK_PRESETS[simState.track],
    );
    simState = step(simState, controls, FIXED_TIMESTEP);
    if (simState.phase === "running" && shouldFinish(simState)) {
      simState = { ...simState, phase: "finished" };
    }
    accumulator -= FIXED_TIMESTEP;
    steps++;
  }
  if (steps === MAX_STEPS_PER_FRAME) accumulator = 0;

  instruments.update(simState);
  scene?.update(simState, reducedMotion);
  updateSettingButtonsDisabled();
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
