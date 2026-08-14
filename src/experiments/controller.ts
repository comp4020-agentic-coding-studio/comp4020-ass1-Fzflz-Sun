import { createGripScene, type GripScene } from "../rendering/scene.ts";
import {
  CAR_PARAMS,
  controlsForState,
  createInitialState,
  FIXED_TIMESTEP,
  shouldFinish,
  startRun,
  step,
  type DrivetrainId,
  type SimState,
  type SurfaceId,
  type ThrottleIntensityId,
  type ThrottleTimingId,
  type TrackId,
} from "../simulation/index.ts";
import { createInstruments } from "../ui/instruments.ts";

export interface ExperimentSettings {
  drivetrain: DrivetrainId;
  surface: SurfaceId;
  throttleIntensity: ThrottleIntensityId;
  throttleTiming: ThrottleTimingId;
  track: TrackId;
}

type SettingKey = keyof ExperimentSettings;

// How this experiment's own setting pickers are wired to `ExperimentSettings`.
// "buttons" covers a teaching module's single option-button group
// (spec/brief.md: exactly one variable, exposed as buttons). "select" covers
// one of the sandbox's mad-libs `<select>` elements, a straight 1:1 mapping.
// "track-select-pair" is the sandbox's one exception: TrackId is a single
// "<shape>-<direction>" string, but the mad-libs sentence exposes shape
// (sweep/hairpin) in the main sentence and direction inside the Advanced
// setup disclosure as two separate selects — this composes them back into
// one TrackId on either one's change.
export type SettingSource =
  | { kind: "buttons"; key: SettingKey; options: Array<{ value: string; testid: string }> }
  | { kind: "select"; key: SettingKey; testid: string }
  | { kind: "track-select-pair"; shapeTestid: string; directionTestid: string };

export interface ExperimentControllerOptions {
  root: HTMLElement;
  initialSettings: ExperimentSettings;
  settings: SettingSource[];
  onFinish?: (state: SimState) => string | void;
}

export interface ExperimentController {
  destroy(): void;
}

const MAX_STEPS_PER_FRAME = 8;
// How long an experiment stays mounted (scene alive, GPU resources held)
// after scrolling out of the near-viewport margin before it's torn down —
// long enough that ordinary scroll jitter right at the edge doesn't thrash
// mount/unmount, short enough that scrolling through all six experiments
// never keeps more than a couple of WebGL contexts alive at once.
const UNMOUNT_DELAY_MS = 4000;

function trackIdFor(shape: string, direction: string): TrackId {
  return `${shape}-${direction}` as TrackId;
}

/** Builds one independent, isolated experiment instance: its own `SimState`,
 * fixed-timestep accumulator loop, `GripScene`, and setting-picker wiring,
 * all scoped to `root`'s own DOM subtree — generalizes what used to be
 * `main.ts`'s single set of module-level globals into a factory callable
 * once per teaching module and once for the sandbox, sharing the one
 * validated physics core (`src/simulation/`) and rendering factory
 * (`createGripScene`) with no duplicated logic. Every experiment sits
 * motionless in "ready" until its own Run is pressed (no real-time driving
 * input is reintroduced here), and pauses/releases its WebGL context while
 * scrolled out of view via `IntersectionObserver`, so scrolling through all
 * six never keeps six scenes rendering at 60fps in the background. */
export function createExperimentController(options: ExperimentControllerOptions): ExperimentController {
  const { root, initialSettings, settings, onFinish } = options;

  function requiredIn<T extends Element>(testid: string): T {
    const el = root.querySelector<T>(`[data-testid="${testid}"]`);
    if (!el) throw new Error(`createExperimentController: missing [data-testid="${testid}"] under root`);
    return el;
  }
  function optionalIn<T extends Element>(testid: string): T | null {
    return root.querySelector<T>(`[data-testid="${testid}"]`);
  }

  const startButton = requiredIn<HTMLButtonElement>("start-run");
  const resetButton = requiredIn<HTMLButtonElement>("reset");
  const canvas = optionalIn<HTMLCanvasElement>("scene-canvas");
  const resultEl = optionalIn<HTMLElement>("module-result");
  const instruments = createInstruments(root);

  const current: ExperimentSettings = { ...initialSettings };
  let state: SimState = createInitialState(
    current.drivetrain,
    current.surface,
    current.throttleIntensity,
    current.throttleTiming,
    current.track,
  );

  let scene: GripScene | null = null;
  let mounted = false;
  let paused = true;
  let accumulator = 0;
  let lastTime: number | null = null;
  let rafHandle: number | null = null;
  let unmountTimer: ReturnType<typeof setTimeout> | null = null;

  const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  let reducedMotion = reducedMotionQuery.matches;
  const onReducedMotionChange = (event: MediaQueryListEvent): void => {
    reducedMotion = event.matches;
  };
  reducedMotionQuery.addEventListener("change", onReducedMotionChange);

  const disableWhileRunning: Array<HTMLButtonElement | HTMLSelectElement> = [];

  function updatePickersDisabled(): void {
    const disabled = state.phase === "running";
    for (const el of disableWhileRunning) el.disabled = disabled;
  }

  function renderImmediately(): void {
    instruments.update(state);
    if (mounted && scene) scene.update(state, reducedMotion);
    updatePickersDisabled();
  }

  function applySetting<K extends SettingKey>(key: K, value: ExperimentSettings[K]): void {
    current[key] = value;
    state = { ...state, [key]: value } as SimState;
  }

  for (const source of settings) {
    if (source.kind === "buttons") {
      const buttons = source.options.map((option) => ({
        value: option.value,
        el: requiredIn<HTMLButtonElement>(option.testid),
      }));
      for (const { el } of buttons) disableWhileRunning.push(el);
      const syncPressed = (value: string): void => {
        for (const { value: v, el } of buttons) el.setAttribute("aria-pressed", String(v === value));
      };
      syncPressed(current[source.key]);
      for (const { value, el } of buttons) {
        el.addEventListener("click", () => {
          applySetting(source.key, value as ExperimentSettings[typeof source.key]);
          syncPressed(value);
          renderImmediately();
        });
      }
    } else if (source.kind === "select") {
      const select = requiredIn<HTMLSelectElement>(source.testid);
      select.value = current[source.key];
      disableWhileRunning.push(select);
      select.addEventListener("change", () => {
        applySetting(source.key, select.value as ExperimentSettings[typeof source.key]);
        renderImmediately();
      });
    } else {
      const [initialShape, initialDirection] = current.track.split("-") as [string, string];
      const shapeSelect = requiredIn<HTMLSelectElement>(source.shapeTestid);
      const directionSelect = requiredIn<HTMLSelectElement>(source.directionTestid);
      shapeSelect.value = initialShape;
      directionSelect.value = initialDirection;
      disableWhileRunning.push(shapeSelect, directionSelect);
      const syncTrack = (): void => {
        applySetting("track", trackIdFor(shapeSelect.value, directionSelect.value));
        renderImmediately();
      };
      shapeSelect.addEventListener("change", syncTrack);
      directionSelect.addEventListener("change", syncTrack);
    }
  }

  function finishIfDone(): void {
    if (state.phase === "running" && shouldFinish(state)) {
      state = { ...state, phase: "finished" };
      if (resultEl) {
        const text = onFinish?.(state);
        if (text) resultEl.textContent = text;
      }
    }
  }

  startButton.addEventListener("click", () => {
    state = startRun(state);
    accumulator = 0;
    lastTime = null;
    if (resultEl) resultEl.textContent = "";
    renderImmediately();
  });

  resetButton.addEventListener("click", () => {
    state = createInitialState(
      current.drivetrain,
      current.surface,
      current.throttleIntensity,
      current.throttleTiming,
      current.track,
    );
    accumulator = 0;
    lastTime = null;
    if (resultEl) resultEl.textContent = "";
    renderImmediately();
  });

  function frame(time: number): void {
    if (paused) {
      rafHandle = null;
      return;
    }
    if (lastTime === null) lastTime = time;
    const dt = Math.min(0.25, (time - lastTime) / 1000);
    lastTime = time;
    accumulator += dt;

    let stepsTaken = 0;
    while (accumulator >= FIXED_TIMESTEP && stepsTaken < MAX_STEPS_PER_FRAME) {
      const controls = controlsForState(state, CAR_PARAMS, FIXED_TIMESTEP);
      state = step(state, controls, FIXED_TIMESTEP);
      finishIfDone();
      accumulator -= FIXED_TIMESTEP;
      stepsTaken++;
    }
    if (stepsTaken === MAX_STEPS_PER_FRAME) accumulator = 0;

    instruments.update(state);
    if (scene) scene.update(state, reducedMotion);
    updatePickersDisabled();
    rafHandle = requestAnimationFrame(frame);
  }

  function mount(): void {
    if (mounted || !canvas) return;
    mounted = true;
    try {
      scene = createGripScene(canvas);
      scene.update(state, reducedMotion);
    } catch (error) {
      console.warn("3D scene unavailable for this experiment, continuing with instruments only:", error);
      scene = null;
    }
  }

  function unmount(): void {
    if (!mounted) return;
    mounted = false;
    scene?.dispose();
    scene = null;
  }

  function pause(): void {
    paused = true;
    lastTime = null;
  }

  function resume(): void {
    if (!paused) return;
    paused = false;
    if (rafHandle === null) rafHandle = requestAnimationFrame(frame);
  }

  function cancelPendingUnmount(): void {
    if (unmountTimer !== null) {
      clearTimeout(unmountTimer);
      unmountTimer = null;
    }
  }

  const onResize = (): void => scene?.resize();
  window.addEventListener("resize", onResize);

  let intersectionObserver: IntersectionObserver | null = null;
  if (typeof IntersectionObserver !== "undefined") {
    intersectionObserver = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          cancelPendingUnmount();
          mount();
          resume();
        } else {
          pause();
          cancelPendingUnmount();
          unmountTimer = setTimeout(unmount, UNMOUNT_DELAY_MS);
        }
      },
      { rootMargin: "50% 0px", threshold: 0 },
    );
    intersectionObserver.observe(root);
  } else {
    // No IntersectionObserver in this environment (e.g. some test runners):
    // fall back to always mounted/running rather than never rendering at all.
    mount();
    resume();
  }

  renderImmediately();

  function destroy(): void {
    cancelPendingUnmount();
    pause();
    unmount();
    intersectionObserver?.disconnect();
    window.removeEventListener("resize", onResize);
    reducedMotionQuery.removeEventListener("change", onReducedMotionChange);
  }

  return { destroy };
}
