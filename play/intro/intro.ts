import { createGripScene } from "../../src/rendering/scene.ts";
import {
  CAR_PARAMS,
  controlsForState,
  createInitialState,
  FIXED_TIMESTEP,
  shouldFinish,
  startRun,
  step,
} from "../../src/simulation/index.ts";
import type { SimState } from "../../src/simulation/index.ts";

// Scripted, non-interactive loop for the intro hero: the same validated
// physics/rendering core the rest of the site uses, driven automatically
// instead of by a visitor's Run press, on a fixed illustrative preset. This
// file never shares scope/state with any page module — it is its own Vite
// entry, loaded only inside the intro iframe.
const PRESET = {
  drivetrain: "RWD" as const,
  surface: "dry" as const,
  throttleIntensity: "full" as const,
  throttleTiming: "early" as const,
  track: "hairpin-right" as const,
};

function freshRun(): SimState {
  return startRun(createInitialState(PRESET.drivetrain, PRESET.surface, PRESET.throttleIntensity, PRESET.throttleTiming, PRESET.track));
}

const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="intro-canvas"]');
if (!canvas) throw new Error("intro.ts: missing intro canvas");

let scene: ReturnType<typeof createGripScene> | null = null;
try {
  scene = createGripScene(canvas);
} catch (error) {
  console.warn("intro: 3D scene unavailable:", error);
}

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

if (reducedMotion) {
  // Static composition: advance to a fixed representative elapsed time once
  // and stop, rather than animating on a loop. The vehicle glTF loads
  // asynchronously and is only positioned inside `update()` — awaiting
  // `scene.ready()` first (see its doc comment in scene.ts) avoids a race
  // where this single static call lands before the model has loaded, which
  // would render the road with no car on it.
  let state = freshRun();
  const REPRESENTATIVE_ELAPSED_SECONDS = 3;
  while (state.elapsed < REPRESENTATIVE_ELAPSED_SECONDS && !shouldFinish(state)) {
    const controls = controlsForState(state, CAR_PARAMS, FIXED_TIMESTEP);
    state = step(state, controls, FIXED_TIMESTEP);
  }
  await scene?.ready();
  scene?.update(state, true);
} else {
  let state = freshRun();
  window.addEventListener("resize", () => scene?.resize());
  requestAnimationFrame(function frame() {
    const controls = controlsForState(state, CAR_PARAMS, FIXED_TIMESTEP);
    state = step(state, controls, FIXED_TIMESTEP);
    if (shouldFinish(state)) state = freshRun();
    scene?.update(state, false);
    requestAnimationFrame(frame);
  });
}
