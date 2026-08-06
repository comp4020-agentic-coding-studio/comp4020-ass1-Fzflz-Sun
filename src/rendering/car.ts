// Axle colours match the CSS palette exactly (CLAUDE.md: fixed everywhere).
export const FRONT_COLOR = "#4fd3e6";
export const REAR_COLOR = "#d99a4e";
export const DANGER_COLOR = "#ff6b57";
const BODY_COLOR = "#e8e4da";
const CABIN_COLOR = "#2a2e35";

// Metres. Roughly matches the old 3D body's proportions.
const BODY_LENGTH = 4.2;
const BODY_WIDTH = 1.8;
const WHEEL_LENGTH = 0.7;
const WHEEL_WIDTH = 0.42;
const CORNER_RADIUS = 0.25;

function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/** Lerps `base` toward the shared danger accent as an axle saturates, so
 * saturation is visible on the car itself, not just the sidebar meters —
 * same rule the old 3D marker used (`t` grows past saturation onset rather
 * than snapping instantly). */
export function wheelColor(base: string, utilisation: number, saturated: boolean): string {
  const t = saturated ? Math.min(1, (utilisation - 1) * 2 + 0.4) : 0;
  if (t <= 0) return base;
  const [br, bg, bb] = hexToRgb(base);
  const [dr, dg, db] = hexToRgb(DANGER_COLOR);
  const r = Math.round(br + (dr - br) * t);
  const g = Math.round(bg + (dg - bg) * t);
  const b = Math.round(bb + (db - bb) * t);
  return `rgb(${r}, ${g}, ${b})`;
}

function fillRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
  ctx.fill();
}

function drawWheel(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, color: string): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = color;
  fillRoundedRect(ctx, -WHEEL_LENGTH / 2, -WHEEL_WIDTH / 2, WHEEL_LENGTH, WHEEL_WIDTH, 0.06);
  ctx.restore();
}

/** Draws the car in its own local metre-space: the caller (scene.ts) has
 * already translated/rotated the canvas context to the car's world position
 * and heading, so this only needs local offsets — local +x is forward,
 * local +y is left, matching `SimState`'s body-frame convention exactly (no
 * separate axis remap, unlike the old 3D renderer's XZ-plane mapping). Four
 * wheels are always visible and switch to the danger accent the instant
 * their axle saturates; `frontSteerAngle` additionally turns the front
 * wheels visually so steering is legible before the body has visibly
 * yawed. */
export function drawCar(
  ctx: CanvasRenderingContext2D,
  wheelbaseHalf: number,
  frontSteerAngle: number,
  frontColor: string,
  rearColor: string,
): void {
  const trackHalfWidth = BODY_WIDTH / 2;

  drawWheel(ctx, wheelbaseHalf, trackHalfWidth, frontSteerAngle, frontColor);
  drawWheel(ctx, wheelbaseHalf, -trackHalfWidth, frontSteerAngle, frontColor);
  drawWheel(ctx, -wheelbaseHalf, trackHalfWidth, 0, rearColor);
  drawWheel(ctx, -wheelbaseHalf, -trackHalfWidth, 0, rearColor);

  ctx.fillStyle = BODY_COLOR;
  fillRoundedRect(ctx, -BODY_LENGTH / 2, -BODY_WIDTH / 2, BODY_LENGTH, BODY_WIDTH, CORNER_RADIUS);

  ctx.fillStyle = CABIN_COLOR;
  fillRoundedRect(ctx, -BODY_LENGTH * 0.15, -BODY_WIDTH * 0.34, BODY_LENGTH * 0.55, BODY_WIDTH * 0.68, 0.15);

  // A small nose marker so forward-vs-backward is legible even at a glance.
  ctx.fillStyle = CABIN_COLOR;
  ctx.beginPath();
  ctx.moveTo(BODY_LENGTH / 2, 0);
  ctx.lineTo(BODY_LENGTH / 2 - 0.4, 0.22);
  ctx.lineTo(BODY_LENGTH / 2 - 0.4, -0.22);
  ctx.closePath();
  ctx.fill();
}
