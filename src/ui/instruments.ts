import type { DrivingState, SimState } from "../simulation/index.ts";

const STATE_LABEL: Record<DrivingState, string> = {
  stable: "Stable",
  understeer: "Understeer",
  oversteer: "Oversteer",
  slide: "Four-wheel slide",
};

// Plain-language explanations, no vehicle-dynamics jargon (spec/brief.md:
// the audience knows turning/speeding/braking, not slip angles).
const STATE_EXPLANATION: Record<DrivingState, string> = {
  stable: "Both axles have grip in reserve. Nothing has saturated yet.",
  understeer:
    "The front axle has spent its whole grip budget. The car runs wide instead of turning as sharply as the wheel asks.",
  oversteer:
    "The rear axle has spent its whole grip budget. The back end is rotating faster than the front is turning.",
  slide:
    "Both axles have spent their grip budget. Steering and throttle have little effect until grip returns.",
};

function formatPercent(utilisation: number): string {
  return `${Math.round(utilisation * 100)}%`;
}

function formatG(g: number): string {
  return `${g.toFixed(2)} g`;
}

// Ratios reported by IntersectionObserver can land a hair under 1 (e.g.
// 0.9999997) from sub-pixel rounding even when the target is visually fully
// in view, so "fully visible" is treated as "at or above" this tolerance
// rather than requiring an exact 1 — see MDN's IntersectionObserver
// precision notes.
const FULLY_VISIBLE_RATIO = 0.999;

/** Watches the key-info group (State/Motion/Axle/G-G) against .sidebar's own
 * scroll viewport — not the page viewport, since .sidebar is the only
 * scrolling region — and toggles `data-expanded` on .control-bar so its CSS
 * transition (main.css) can grow/collapse the mirrored quick-reference row.
 * A no-op if this page doesn't render that markup (e.g. missing key-info,
 * control-bar, or .sidebar) or lacks IntersectionObserver entirely. */
function observeKeyInfoVisibility(root: ParentNode): void {
  if (typeof IntersectionObserver === "undefined") return;

  const sidebar = root.querySelector(".sidebar");
  const keyInfo = root.querySelector('[data-testid="key-info"]');
  const controlBar = root.querySelector<HTMLElement>('[data-testid="control-bar"]');
  if (!keyInfo || !controlBar || !sidebar) return;

  const observer = new IntersectionObserver(
    ([entry]) => {
      controlBar.dataset.expanded = String(entry.intersectionRatio < FULLY_VISIBLE_RATIO);
    },
    { root: sidebar, threshold: [0, FULLY_VISIBLE_RATIO, 1] },
  );
  observer.observe(keyInfo);
}

export interface Instruments {
  update(state: SimState): void;
}

/** Binds once to the page's data-testid instrument elements and updates
 * their text/attributes from simulation state every frame. This is the
 * non-visual truth of the page (CLAUDE.md) — the 2D scene never carries
 * information that isn't also here as text. */
export function createInstruments(root: ParentNode = document): Instruments {
  const testid = (id: string): HTMLElement => {
    const el = root.querySelector<HTMLElement>(`[data-testid="${id}"]`);
    if (!el) throw new Error(`createInstruments: missing [data-testid="${id}"]`);
    return el;
  };

  const stateLabel = testid("state-label");
  const stateExplanation = testid("state-explanation");
  const speed = testid("speed");
  const pathOffset = testid("path-offset");
  const frontUtilisation = testid("front-utilisation");
  const rearUtilisation = testid("rear-utilisation");
  const longitudinalG = testid("longitudinal-g");
  const lateralG = testid("lateral-g");
  const steeringValue = testid("steering-value");
  const throttleValue = testid("throttle-value");

  const frontMeter = root.querySelector<HTMLElement>("#front-meter");
  const rearMeter = root.querySelector<HTMLElement>("#rear-meter");
  const ggCanvas = root.querySelector<HTMLCanvasElement>("#gg-canvas");
  const ggContext = ggCanvas?.getContext("2d") ?? null;

  // Mirrored copies shown in the sticky quick-reference bar (control-bar)
  // once scrolling pushes the key-info panels out of view — same values and
  // the same visual widgets (meter bars, G-G dial), not just numbers, using
  // distinct data-testids and updated from this same per-frame update()
  // below. Optional: absent on any page that doesn't render the sticky bar
  // markup.
  const stickyStateLabel = root.querySelector<HTMLElement>('[data-testid="sticky-state-label"]');
  const stickySpeed = root.querySelector<HTMLElement>('[data-testid="sticky-speed"]');
  const stickyFrontUtilisation = root.querySelector<HTMLElement>('[data-testid="sticky-front-utilisation"]');
  const stickyRearUtilisation = root.querySelector<HTMLElement>('[data-testid="sticky-rear-utilisation"]');
  const stickyFrontMeter = root.querySelector<HTMLElement>('[data-testid="sticky-front-meter"]');
  const stickyRearMeter = root.querySelector<HTMLElement>('[data-testid="sticky-rear-meter"]');
  const stickyLongitudinalG = root.querySelector<HTMLElement>('[data-testid="sticky-longitudinal-g"]');
  const stickyLateralG = root.querySelector<HTMLElement>('[data-testid="sticky-lateral-g"]');
  const stickyGgCanvas = root.querySelector<HTMLCanvasElement>('[data-testid="sticky-gg-canvas"]');
  const stickyGgContext = stickyGgCanvas?.getContext("2d") ?? null;

  observeKeyInfoVisibility(root);

  function drawGG(
    canvas: HTMLCanvasElement | null,
    context: CanvasRenderingContext2D | null,
    longitudinal: number,
    lateral: number,
  ): void {
    if (!canvas || !context) return;
    const w = canvas.width;
    const h = canvas.height;
    const cx = w / 2;
    const cy = h / 2;
    const scale = (w / 2 - 8) / 1.5; // 1.5g fills most of the dial

    context.clearRect(0, 0, w, h);
    context.strokeStyle = "rgba(255,255,255,0.18)";
    context.lineWidth = 1;
    for (const g of [0.5, 1.0]) {
      context.beginPath();
      context.arc(cx, cy, g * scale, 0, Math.PI * 2);
      context.stroke();
    }
    context.beginPath();
    context.moveTo(0, cy);
    context.lineTo(w, cy);
    context.moveTo(cx, 0);
    context.lineTo(cx, h);
    context.stroke();

    const dotX = cx + lateral * scale;
    const dotY = cy - longitudinal * scale;
    const overLimit = Math.hypot(lateral, longitudinal) > 1;
    context.fillStyle = overLimit ? "#ff6b57" : "#f2efe8";
    context.beginPath();
    context.arc(dotX, dotY, 4, 0, Math.PI * 2);
    context.fill();
  }

  function update(state: SimState): void {
    // "Ready"/"finished" are lifecycle phases, not handling classifications
    // (see RunPhase in types.ts) — the car sits inert until Run begins a run,
    // and holds its settled final state once the run's fixed duration
    // elapses, so both get their own label instead of reporting a stale
    // "Stable" that would wrongly imply the car is still rolling.
    if (state.phase === "ready") {
      stateLabel.textContent = "Ready";
      stateLabel.dataset.state = "ready";
      stateExplanation.textContent = "Press Run to enter the corner at a steady speed.";
    } else if (state.phase === "finished") {
      stateLabel.textContent = `Finished — ${STATE_LABEL[state.drivingState]}`;
      stateLabel.dataset.state = "finished";
      stateExplanation.textContent = `${STATE_EXPLANATION[state.drivingState]} Change a setting and press Run to compare.`;
    } else {
      stateLabel.textContent = STATE_LABEL[state.drivingState];
      stateLabel.dataset.state = state.drivingState;
      stateExplanation.textContent = STATE_EXPLANATION[state.drivingState];
    }

    // Bare motion, independent of any handling classification: utilisation
    // percentages and state labels can stay green while the car itself never
    // actually moves or stops (the failure mode bug #6 named) — these are the
    // DOM's ground truth that it did.
    speed.textContent = `${Math.hypot(state.vx, state.vy).toFixed(1)} m/s`;
    pathOffset.textContent = `${state.pathOffset >= 0 ? "+" : ""}${state.pathOffset.toFixed(2)} m`;

    frontUtilisation.textContent = formatPercent(state.front.utilisation);
    rearUtilisation.textContent = formatPercent(state.rear.utilisation);
    longitudinalG.textContent = formatG(state.longitudinalG);
    lateralG.textContent = formatG(state.lateralG);
    steeringValue.textContent = formatPercent(Math.abs(state.steering));
    throttleValue.textContent = formatPercent(state.throttle);

    if (frontMeter) {
      frontMeter.style.width = `${Math.min(100, state.front.utilisation * 100)}%`;
      frontMeter.dataset.saturated = String(state.front.saturated);
    }
    if (rearMeter) {
      rearMeter.style.width = `${Math.min(100, state.rear.utilisation * 100)}%`;
      rearMeter.dataset.saturated = String(state.rear.saturated);
    }

    drawGG(ggCanvas, ggContext, state.longitudinalG, state.lateralG);
    drawGG(stickyGgCanvas, stickyGgContext, state.longitudinalG, state.lateralG);

    // Mirrors, not independent readings: copying stateLabel's already-computed
    // text/data-state (rather than re-deriving it) keeps the "Ready"/
    // "Finished — X" wording and colour coding identical between the two
    // copies with no duplicated logic.
    if (stickyStateLabel) {
      stickyStateLabel.textContent = stateLabel.textContent;
      stickyStateLabel.dataset.state = stateLabel.dataset.state;
    }
    if (stickySpeed) stickySpeed.textContent = speed.textContent;
    if (stickyFrontUtilisation) stickyFrontUtilisation.textContent = frontUtilisation.textContent;
    if (stickyRearUtilisation) stickyRearUtilisation.textContent = rearUtilisation.textContent;
    if (stickyLongitudinalG) stickyLongitudinalG.textContent = longitudinalG.textContent;
    if (stickyLateralG) stickyLateralG.textContent = lateralG.textContent;
    if (stickyFrontMeter) {
      stickyFrontMeter.style.width = `${Math.min(100, state.front.utilisation * 100)}%`;
      stickyFrontMeter.dataset.saturated = String(state.front.saturated);
    }
    if (stickyRearMeter) {
      stickyRearMeter.style.width = `${Math.min(100, state.rear.utilisation * 100)}%`;
      stickyRearMeter.dataset.saturated = String(state.rear.saturated);
    }
  }

  return { update };
}
