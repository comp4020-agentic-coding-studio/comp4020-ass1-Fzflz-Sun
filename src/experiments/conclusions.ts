import type { SimState } from "../simulation/index.ts";

// One small pure function per teaching module, each turning that run's own
// real final SimState numbers into a sentence — never canned text (see
// spec/brief.md's "conclusions must come from real simulation results"
// rule). Every function only reads state a finished run actually has:
// front/rear utilisation and saturated flags, elapsed time, and the settings
// that produced it. Comparative claims ("hairpin > sweep") are proven at the
// simulation level (src/simulation/behaviour.test.ts, section H) — a single
// finished run's conclusion here only ever describes that one run.

function pct(utilisation: number): string {
  return `${Math.round(utilisation * 100)}%`;
}

function peakUtilisation(state: SimState): number {
  return Math.max(state.front.utilisation, state.rear.utilisation);
}

function saturatedAxleLabel(state: SimState): string {
  if (state.front.saturated && state.rear.saturated) return "both axles";
  if (state.front.saturated) return "the front axle";
  if (state.rear.saturated) return "the rear axle";
  return "neither axle";
}

export function module1Conclusion(state: SimState): string {
  const shape = state.track.startsWith("hairpin") ? "the hairpin" : "the sweep";
  const peak = pct(peakUtilisation(state));
  if (!state.front.saturated && !state.rear.saturated) {
    return `Through ${shape}, peak demand only reached ${peak} of the grip budget — plenty in reserve. Try the tighter corner and compare.`;
  }
  return `Through ${shape}, ${saturatedAxleLabel(state)} spent its whole grip budget (peak demand ${peak}) after ${state.elapsed.toFixed(1)}s. A tighter corner asks for more turning force at the same speed.`;
}

export function module2Conclusion(state: SimState): string {
  const surface = state.surface;
  const peak = pct(peakUtilisation(state));
  if (!state.front.saturated && !state.rear.saturated) {
    return `On ${surface} tarmac, peak demand only reached ${peak} — the same script left grip in reserve here.`;
  }
  return `On ${surface} tarmac, ${saturatedAxleLabel(state)} saturated (peak demand ${peak}) after ${state.elapsed.toFixed(1)}s. Lower grip means the same steering and throttle script asks for a bigger share of a smaller budget.`;
}

export function module3Conclusion(state: SimState): string {
  const intensity = state.throttleIntensity;
  const rear = pct(state.rear.utilisation);
  if (!state.rear.saturated) {
    return `At ${intensity} throttle, the rear axle only reached ${rear} of its grip budget.`;
  }
  return `At ${intensity} throttle, the rear axle spent its whole grip budget (reached ${rear}) after ${state.elapsed.toFixed(1)}s — accelerating harder draws on the same rear grip the corner already needs.`;
}

export function module4Conclusion(state: SimState): string {
  const drivetrain = state.drivetrain;
  if (!state.front.saturated && !state.rear.saturated) {
    return `${drivetrain} kept both axles within their grip budget for this whole run (peak demand ${pct(peakUtilisation(state))}).`;
  }
  const axle = saturatedAxleLabel(state);
  return `${drivetrain} saturated ${axle} first, after ${state.elapsed.toFixed(1)}s. Drivetrain changes which axle also carries the engine's push — it doesn't add or remove grip.`;
}

export function module5Conclusion(state: SimState): string {
  const timing = state.throttleTiming;
  const peak = pct(peakUtilisation(state));
  if (!state.front.saturated && !state.rear.saturated) {
    return `With throttle applied ${timing}, peak combined demand only reached ${peak}.`;
  }
  return `With throttle applied ${timing}, ${saturatedAxleLabel(state)} saturated after ${state.elapsed.toFixed(1)}s (peak demand ${peak}). Adding throttle sooner stacks it on top of cornering demand sooner too.`;
}

export function sandboxConclusion(state: SimState): string {
  const peak = pct(peakUtilisation(state));
  const speed = Math.hypot(state.vx, state.vy).toFixed(1);
  if (!state.front.saturated && !state.rear.saturated) {
    return `${state.drivetrain} / ${state.surface} / ${state.throttleIntensity} throttle / ${state.throttleTiming} / ${state.track}: finished in ${state.elapsed.toFixed(1)}s at ${speed} m/s with grip in reserve (peak demand ${peak}).`;
  }
  return `${state.drivetrain} / ${state.surface} / ${state.throttleIntensity} throttle / ${state.throttleTiming} / ${state.track}: ${saturatedAxleLabel(state)} saturated (peak demand ${peak}) after ${state.elapsed.toFixed(1)}s, finishing at ${speed} m/s.`;
}
