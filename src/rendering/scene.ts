import { CAR_PARAMS } from "../simulation/constants.ts";
import type { SimState, TrackParams } from "../simulation/index.ts";
import { trackCentre } from "../simulation/track.ts";
import { drawCar, FRONT_COLOR, REAR_COLOR, wheelColor } from "./car.ts";

// Metres-to-pixels scale for the 2D bird's-eye view. A translate-only,
// north-up camera (no rotation) follows the car's position every frame —
// unlike the old 3D chase camera, this makes slip (body heading vs. actual
// travel direction) directly visible without needing to track travel-heading
// separately (CLAUDE.md's camera rule, now automatically satisfied: nothing
// here reads state.heading for the *camera*, only for the car sprite).
const METERS_TO_PIXELS = 10;
const ROAD_HALF_WIDTH = 7; // m, matches the old 3D scene's road width
const MAX_DEVICE_PIXEL_RATIO = 2;
const TRAIL_MAX_POINTS = 40;

const BACKGROUND_COLOR = "#1a1d22"; // matches --color-bg
const ROAD_COLOR = "#2c3038";
const KERB_COLOR = "#3a3f49";
const REFERENCE_LINE_COLOR = "#dfdccf";

export interface GripScene {
  update(state: SimState, reducedMotion: boolean): void;
  resize(): void;
  dispose(): void;
}

interface TrailPoint {
  x: number;
  y: number;
  color: string;
}

/** Builds the 2D bird's-eye scene: the one corner's road + kerbs, a
 * reference line, a short saturated-wheel trail, and the car. Replaces the
 * old Three.js chase-camera renderer — same exported shape (`update`/
 * `resize`/`dispose`) so main.ts's call sites are unaffected. Throws if a 2D
 * context is unavailable; main.ts catches that so a canvas-less browser
 * still gets the full instrument-panel explanation (CLAUDE.md: DOM state is
 * the non-visual truth, the canvas is not required for the interaction to be
 * legible). */
export function createGripScene(canvas: HTMLCanvasElement, track: TrackParams): GripScene {
  const context = canvas.getContext("2d");
  if (!context) throw new Error("2D canvas context unavailable");
  // Re-bound with an explicit non-null type: TS's null-narrowing above only
  // covers direct references in this scope, not the nested closures below.
  const ctx: CanvasRenderingContext2D = context;

  const centre = trackCentre(track);
  let trail: TrailPoint[] = [];
  let lastElapsed = 0;

  function resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DEVICE_PIXEL_RATIO);
    const width = Math.max(1, canvas.clientWidth);
    const height = Math.max(1, canvas.clientHeight);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }

  function drawRoad(): void {
    ctx.fillStyle = ROAD_COLOR;
    ctx.beginPath();
    ctx.arc(centre.cx, centre.cy, track.radius + ROAD_HALF_WIDTH, 0, Math.PI * 2);
    ctx.arc(centre.cx, centre.cy, track.radius - ROAD_HALF_WIDTH, 0, Math.PI * 2, true);
    ctx.fill("evenodd");

    ctx.strokeStyle = KERB_COLOR;
    ctx.lineWidth = 0.3;
    ctx.beginPath();
    ctx.arc(centre.cx, centre.cy, track.radius + ROAD_HALF_WIDTH, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(centre.cx, centre.cy, track.radius - ROAD_HALF_WIDTH, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = REFERENCE_LINE_COLOR;
    ctx.lineWidth = 0.15;
    ctx.setLineDash([1.2, 1.2]);
    ctx.beginPath();
    ctx.arc(centre.cx, centre.cy, track.radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function drawTrail(reducedMotion: boolean): void {
    for (let i = 0; i < trail.length; i++) {
      const point = trail[i];
      const age = trail.length - i;
      const opacity = reducedMotion ? 0.5 : Math.max(0, 1 - age / TRAIL_MAX_POINTS);
      ctx.globalAlpha = opacity;
      ctx.fillStyle = point.color;
      ctx.beginPath();
      ctx.arc(point.x, point.y, 0.12, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  /** Cheap, non-photorealistic evidence of *where* an axle spent its
   * saturated moments: a capped trail of dots dropped at that axle's world
   * position whenever `state.front.saturated`/`state.rear.saturated` is
   * true. Cleared whenever `state.elapsed` goes backwards — the only signal
   * that distinguishes "still running" from "a fresh run just started"
   * (Reset returns elapsed to 0 with phase "ready"; pressing Run from
   * "finished" also resets elapsed to 0, with no separate flag needed). */
  function recordTrail(state: SimState): void {
    if (state.elapsed < lastElapsed) trail = [];
    lastElapsed = state.elapsed;

    if (state.phase !== "running") return;

    const forwardX = Math.cos(state.heading);
    const forwardY = Math.sin(state.heading);
    if (state.front.saturated) {
      trail.push({
        x: state.x + forwardX * CAR_PARAMS.wheelbaseHalf,
        y: state.y + forwardY * CAR_PARAMS.wheelbaseHalf,
        color: wheelColor(FRONT_COLOR, state.front.utilisation, true),
      });
    }
    if (state.rear.saturated) {
      trail.push({
        x: state.x - forwardX * CAR_PARAMS.wheelbaseHalf,
        y: state.y - forwardY * CAR_PARAMS.wheelbaseHalf,
        color: wheelColor(REAR_COLOR, state.rear.utilisation, true),
      });
    }
    if (trail.length > TRAIL_MAX_POINTS) trail = trail.slice(trail.length - TRAIL_MAX_POINTS);
  }

  function update(state: SimState, reducedMotion: boolean): void {
    recordTrail(state);

    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DEVICE_PIXEL_RATIO);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = BACKGROUND_COLOR;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const cssWidth = canvas.width / dpr;
    const cssHeight = canvas.height / dpr;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.save();
    ctx.translate(cssWidth / 2, cssHeight / 2);
    // +y-up, matching physics.ts's own world-frame convention (heading
    // CCW-positive from +x) — after this, ctx.rotate(heading) below behaves
    // exactly like the sim's heading with no extra sign flips.
    ctx.scale(METERS_TO_PIXELS, -METERS_TO_PIXELS);
    ctx.translate(-state.x, -state.y);

    drawRoad();
    drawTrail(reducedMotion);

    ctx.save();
    ctx.translate(state.x, state.y);
    ctx.rotate(state.heading);
    const frontSteerAngle = state.steering * CAR_PARAMS.maxSteerAngle;
    drawCar(
      ctx,
      CAR_PARAMS.wheelbaseHalf,
      frontSteerAngle,
      wheelColor(FRONT_COLOR, state.front.utilisation, state.front.saturated),
      wheelColor(REAR_COLOR, state.rear.utilisation, state.rear.saturated),
    );
    ctx.restore();

    ctx.restore();
  }

  function dispose(): void {
    // No WebGL context / GPU resources to release for a 2D canvas.
  }

  resize();

  return { update, resize, dispose };
}
