import { createGripScene } from "./src/rendering/scene.ts";
import {
  CAR_PARAMS,
  createInitialState,
  FIXED_TIMESTEP,
  rampControls,
  step,
  TRACK_PARAMS,
} from "./src/simulation/index.ts";
import type { DrivetrainId, SimState, SurfaceId } from "./src/simulation/index.ts";
import { createHeldControlsTracker } from "./src/ui/controls.ts";
import { createInstruments } from "./src/ui/instruments.ts";

function required<T extends Element>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`main.ts: missing required element ${selector}`);
  return el;
}

const steerLeftButton = required<HTMLElement>('[data-testid="steer-left"]');
const steerRightButton = required<HTMLElement>('[data-testid="steer-right"]');
const throttleButton = required<HTMLElement>('[data-testid="throttle"]');
const brakeButton = required<HTMLElement>('[data-testid="brake"]');
const resetButton = required<HTMLElement>('[data-testid="reset"]');

const drivetrainButtons: Array<[DrivetrainId, HTMLElement]> = [
  ["FWD", required('[data-testid="drivetrain-fwd"]')],
  ["RWD", required('[data-testid="drivetrain-rwd"]')],
  ["AWD", required('[data-testid="drivetrain-awd"]')],
];
const surfaceButtons: Array<[SurfaceId, HTMLElement]> = [
  ["dry", required('[data-testid="surface-dry"]')],
  ["wet", required('[data-testid="surface-wet"]')],
  ["ice", required('[data-testid="surface-ice"]')],
];

let currentDrivetrain: DrivetrainId = "RWD";
let currentSurface: SurfaceId = "dry";
let simState: SimState = createInitialState(currentDrivetrain, currentSurface);

function selectOption<T extends string>(
  buttons: Array<[T, HTMLElement]>,
  value: T,
  apply: (value: T) => void,
): void {
  for (const [id, el] of buttons) el.setAttribute("aria-pressed", String(id === value));
  apply(value);
}

const heldControls = createHeldControlsTracker({
  steerLeft: steerLeftButton,
  steerRight: steerRightButton,
  throttle: throttleButton,
  brake: brakeButton,
});

const instruments = createInstruments();

const canvas = required<HTMLCanvasElement>('[data-testid="scene-canvas"]');
let scene: ReturnType<typeof createGripScene> | null = null;
try {
  scene = createGripScene(canvas, TRACK_PARAMS);
} catch (error) {
  // A canvas-less/WebGL-less browser still gets the full instrument-panel
  // explanation (CLAUDE.md) — the 3D view is a bonus, not the source of truth.
  console.warn("3D scene unavailable, continuing with instrument panel only:", error);
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

resetButton.addEventListener("click", () => {
  simState = createInitialState(currentDrivetrain, currentSurface);
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
    const controls = rampControls(
      { steering: simState.steering, throttle: simState.throttle, brake: simState.brake },
      heldControls.getHeld(),
      FIXED_TIMESTEP,
      CAR_PARAMS,
    );
    simState = step(simState, controls, FIXED_TIMESTEP);
    accumulator -= FIXED_TIMESTEP;
    steps++;
  }
  if (steps === MAX_STEPS_PER_FRAME) accumulator = 0;

  instruments.update(simState);
  scene?.update(simState, reducedMotion);
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
