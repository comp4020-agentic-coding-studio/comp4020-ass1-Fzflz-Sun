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

export interface Instruments {
  update(state: SimState): void;
}

/** Binds to whichever of the data-testid instrument elements exist under
 * `root` and updates their text/attributes from simulation state every
 * frame. This is the non-visual truth of the page (CLAUDE.md) — the 3D scene
 * never carries information that isn't also here as text. Every field is
 * looked up with a null-checked `querySelector`, never a throwing lookup:
 * the same factory binds equally to a teaching module's minimal 4-field
 * markup (state-label/front-utilisation/rear-utilisation/speed) and the
 * sandbox's full 10-field instrument panel, so no module renders telemetry
 * it doesn't teach (spec/brief.md's "don't repeat every readout every
 * chapter" rule). `root` is always one experiment's own container — every
 * data-testid below is scoped to it, since several experiment instances
 * exist on the one page and a global `document`-wide lookup would collide. */
export function createInstruments(root: ParentNode): Instruments {
  const testid = <T extends HTMLElement>(id: string): T | null => root.querySelector<T>(`[data-testid="${id}"]`);

  const stateLabel = testid<HTMLElement>("state-label");
  const stateExplanation = testid<HTMLElement>("state-explanation");
  const speed = testid<HTMLElement>("speed");
  const pathOffset = testid<HTMLElement>("path-offset");
  const frontUtilisation = testid<HTMLElement>("front-utilisation");
  const rearUtilisation = testid<HTMLElement>("rear-utilisation");
  const longitudinalG = testid<HTMLElement>("longitudinal-g");
  const lateralG = testid<HTMLElement>("lateral-g");
  const steeringValue = testid<HTMLElement>("steering-value");
  const throttleValue = testid<HTMLElement>("throttle-value");
  const frontMeter = testid<HTMLElement>("front-meter");
  const rearMeter = testid<HTMLElement>("rear-meter");
  const ggCanvas = testid<HTMLCanvasElement>("gg-canvas");
  const ggContext = ggCanvas?.getContext("2d") ?? null;

  function drawGG(longitudinal: number, lateral: number): void {
    if (!ggCanvas || !ggContext) return;
    const w = ggCanvas.width;
    const h = ggCanvas.height;
    const cx = w / 2;
    const cy = h / 2;
    const scale = (w / 2 - 8) / 1.5; // 1.5g fills most of the dial

    ggContext.clearRect(0, 0, w, h);
    ggContext.strokeStyle = "rgba(255,255,255,0.18)";
    ggContext.lineWidth = 1;
    for (const g of [0.5, 1.0]) {
      ggContext.beginPath();
      ggContext.arc(cx, cy, g * scale, 0, Math.PI * 2);
      ggContext.stroke();
    }
    ggContext.beginPath();
    ggContext.moveTo(0, cy);
    ggContext.lineTo(w, cy);
    ggContext.moveTo(cx, 0);
    ggContext.lineTo(cx, h);
    ggContext.stroke();

    const dotX = cx + lateral * scale;
    const dotY = cy - longitudinal * scale;
    const overLimit = Math.hypot(lateral, longitudinal) > 1;
    ggContext.fillStyle = overLimit ? "#ff6b57" : "#f2efe8";
    ggContext.beginPath();
    ggContext.arc(dotX, dotY, 4, 0, Math.PI * 2);
    ggContext.fill();
  }

  function update(state: SimState): void {
    // "Ready"/"finished" are lifecycle phases, not handling classifications
    // (see RunPhase in types.ts) — the car sits inert until Run begins a run,
    // and holds its settled final state once the run's fixed duration
    // elapses, so both get their own label instead of reporting a stale
    // "Stable" that would wrongly imply the car is still rolling.
    if (stateLabel) {
      if (state.phase === "ready") {
        stateLabel.textContent = "Ready";
        stateLabel.dataset.state = "ready";
      } else if (state.phase === "finished") {
        stateLabel.textContent = `Finished — ${STATE_LABEL[state.drivingState]}`;
        stateLabel.dataset.state = "finished";
      } else {
        stateLabel.textContent = STATE_LABEL[state.drivingState];
        stateLabel.dataset.state = state.drivingState;
      }
    }
    if (stateExplanation) {
      if (state.phase === "ready") {
        stateExplanation.textContent = "Press Run to enter the corner at a steady speed.";
      } else if (state.phase === "finished") {
        stateExplanation.textContent = `${STATE_EXPLANATION[state.drivingState]} Change a setting and press Run to compare.`;
      } else {
        stateExplanation.textContent = STATE_EXPLANATION[state.drivingState];
      }
    }

    // Bare motion, independent of any handling classification: utilisation
    // percentages and state labels can stay green while the car itself never
    // actually moves or stops (the failure mode bug #6 named) — these are the
    // DOM's ground truth that it did.
    if (speed) speed.textContent = `${Math.hypot(state.vx, state.vy).toFixed(1)} m/s`;
    if (pathOffset) pathOffset.textContent = `${state.pathOffset >= 0 ? "+" : ""}${state.pathOffset.toFixed(2)} m`;

    if (frontUtilisation) frontUtilisation.textContent = formatPercent(state.front.utilisation);
    if (rearUtilisation) rearUtilisation.textContent = formatPercent(state.rear.utilisation);
    if (longitudinalG) longitudinalG.textContent = formatG(state.longitudinalG);
    if (lateralG) lateralG.textContent = formatG(state.lateralG);
    if (steeringValue) steeringValue.textContent = formatPercent(Math.abs(state.steering));
    if (throttleValue) throttleValue.textContent = formatPercent(state.throttle);

    if (frontMeter) {
      frontMeter.style.width = `${Math.min(100, state.front.utilisation * 100)}%`;
      frontMeter.dataset.saturated = String(state.front.saturated);
    }
    if (rearMeter) {
      rearMeter.style.width = `${Math.min(100, state.rear.utilisation * 100)}%`;
      rearMeter.dataset.saturated = String(state.rear.saturated);
    }

    drawGG(state.longitudinalG, state.lateralG);
  }

  return { update };
}
