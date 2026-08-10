// Axle colours match the CSS palette exactly (CLAUDE.md: fixed everywhere).
export const FRONT_COLOR = "#4fd3e6";
export const REAR_COLOR = "#d99a4e";
export const DANGER_COLOR = "#ff6b57";
const BODY_COLOR = "#e8e4da";
const CABIN_COLOR = "#2a2e35";
const TAIL_COLOR = "#1c1f24";
const SHADOW_COLOR = "rgba(0, 0, 0, 0.35)";
// A single dark outline colour/width applied to every drawn shape (wheels,
// body, cabin, nose) — the same "one consistent stroke language" scene.ts
// uses for road/kerb/reference-line/finish-marker, just at the car's much
// smaller scale (proportioned against BODY_WIDTH the way scene.ts's kerb
// width is proportioned against ROAD_HALF_WIDTH) so shapes read as one
// deliberately-drawn object instead of flat, edgeless fills.
const OUTLINE_COLOR = "#14161a";
const OUTLINE_WIDTH = 0.07;

// This is a screen-space billboard, not a projected 3D chassis (CLAUDE.md's
// camera rule) — these are decorative local-unit proportions, not metres
// tied to CAR_PARAMS. Drawn in canvas's native +y-down orientation with NO
// extra flip: local -y (up/toward the top of the sprite) reads as "away from
// the viewer" (the car's front, which recedes into the screen from a
// rear-3/4 chase vantage), local +y (down) reads as "toward the viewer" (the
// rear, nearest and largest). The front is drawn narrower than the rear
// (REAR_HALF_WIDTH > FRONT_HALF_WIDTH) purely as a cheap perspective cue —
// the same "closer = bigger" idea the projected road/trail already use, just
// faked locally since this single sprite has no real depth of its own.
const REAR_Y = 1.6;
const FRONT_Y = -1.6;
const REAR_HALF_WIDTH = 0.95;
const FRONT_HALF_WIDTH = 0.62;
const CABIN_TOP_Y = -1.35;
const CABIN_BOTTOM_Y = 0.35;
const CABIN_HALF_WIDTH_TOP = 0.42;
const CABIN_HALF_WIDTH_BOTTOM = 0.58;
const REAR_WHEEL_Y = 1.15;
const FRONT_WHEEL_Y = -1.05;
const REAR_WHEEL_LENGTH = 0.62;
const REAR_WHEEL_WIDTH = 0.36;
const FRONT_WHEEL_LENGTH = 0.4;
const FRONT_WHEEL_WIDTH = 0.24;

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
  ctx.strokeStyle = OUTLINE_COLOR;
  ctx.lineWidth = OUTLINE_WIDTH;
  ctx.stroke();
}

function fillQuad(
  ctx: CanvasRenderingContext2D,
  points: ReadonlyArray<readonly [number, number]>,
  outline: boolean,
): void {
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
  ctx.closePath();
  ctx.fill();
  if (outline) {
    ctx.strokeStyle = OUTLINE_COLOR;
    ctx.lineWidth = OUTLINE_WIDTH;
    ctx.stroke();
  }
}

/** A soft dark ellipse under the car's footprint — the cheapest possible
 * depth cue: with no lighting in this flat billboard, the car would
 * otherwise look like it's pasted onto the road rather than resting on it.
 * Drawn first (so the body/wheels layer over its edges) and with no outline
 * of its own — a crisp-edged shadow reads as a drawn shape, not a soft
 * contact cue. Sits toward the rear half, matching where a rear-3/4 view's
 * ground contact reads as nearest the camera. */
function drawShadow(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = SHADOW_COLOR;
  ctx.beginPath();
  ctx.ellipse(0, 0.35, REAR_HALF_WIDTH * 1.15, (REAR_Y - FRONT_Y) * 0.46, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawWheel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  length: number,
  width: number,
  angle: number,
  color: string,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = color;
  fillRoundedRect(ctx, -width / 2, -length / 2, width, length, 0.05);
  ctx.restore();
}

/** Draws the car as a screen-space billboard for a rear-3/4 chase vantage —
 * not a projected 3D chassis (CLAUDE.md's camera rule: the chassis itself is
 * never run through `project()`, only the sprite's anchor point is, via
 * `scene.ts`). The rear axle is nearest, largest, and drawn last-behind the
 * body outline; the front axle is farthest, smaller, and narrower, but
 * always at least partially outside the body's silhouette so its colour
 * still reads — both axles must stay legible since either can saturate.
 * `frontSteerAngle` turns the front wheels visually so steering is legible
 * even before the sprite has visibly rotated. The caller (`scene.ts`)
 * handles all positioning/rotation/scaling — this only draws in a fixed
 * local frame centred on the car. */
export function drawCar(
  ctx: CanvasRenderingContext2D,
  frontSteerAngle: number,
  frontColor: string,
  rearColor: string,
): void {
  drawShadow(ctx);

  // Front wheels drawn first (so the body silhouette is what makes them read
  // as "farther/behind" — a full occlusion would hide the saturation colour
  // entirely, which is why FRONT_HALF_WIDTH keeps them peeking out sideways).
  drawWheel(ctx, FRONT_HALF_WIDTH + 0.05, FRONT_WHEEL_Y, FRONT_WHEEL_LENGTH, FRONT_WHEEL_WIDTH, frontSteerAngle, frontColor);
  drawWheel(ctx, -(FRONT_HALF_WIDTH + 0.05), FRONT_WHEEL_Y, FRONT_WHEEL_LENGTH, FRONT_WHEEL_WIDTH, frontSteerAngle, frontColor);

  // Body: a trapezoid, wide at the rear (near) and narrow at the front
  // (far) — the local-space perspective cue described above.
  ctx.fillStyle = BODY_COLOR;
  fillQuad(
    ctx,
    [
      [-REAR_HALF_WIDTH, REAR_Y],
      [REAR_HALF_WIDTH, REAR_Y],
      [FRONT_HALF_WIDTH, FRONT_Y],
      [-FRONT_HALF_WIDTH, FRONT_Y],
    ],
    true,
  );

  // Rear wheels drawn over the body's rear corners — nearest to the viewer,
  // so they sit proud of the silhouette rather than tucked inside it.
  drawWheel(ctx, REAR_HALF_WIDTH - 0.05, REAR_WHEEL_Y, REAR_WHEEL_LENGTH, REAR_WHEEL_WIDTH, 0, rearColor);
  drawWheel(ctx, -(REAR_HALF_WIDTH - 0.05), REAR_WHEEL_Y, REAR_WHEEL_LENGTH, REAR_WHEEL_WIDTH, 0, rearColor);

  // Cabin/roof: nested trapezoid, narrower at the (farther) top than the
  // bottom — the rear deck/trunk stays visible below it, which is what
  // makes this read as a rear-3/4 view rather than a straight-on top-down
  // one.
  ctx.fillStyle = CABIN_COLOR;
  fillQuad(
    ctx,
    [
      [-CABIN_HALF_WIDTH_BOTTOM, CABIN_BOTTOM_Y],
      [CABIN_HALF_WIDTH_BOTTOM, CABIN_BOTTOM_Y],
      [CABIN_HALF_WIDTH_TOP, CABIN_TOP_Y],
      [-CABIN_HALF_WIDTH_TOP, CABIN_TOP_Y],
    ],
    true,
  );

  // A dark tail band across the rear — reads as a bumper/tail-light line,
  // and reinforces which end is "near" without borrowing the axle-colour
  // channel for anything but axle state.
  ctx.fillStyle = TAIL_COLOR;
  ctx.fillRect(-REAR_HALF_WIDTH * 0.85, REAR_Y - 0.22, REAR_HALF_WIDTH * 1.7, 0.16);

  // A small nose marker at the (far, narrow) front so forward-vs-backward
  // stays legible even at a glance, same role the old top-down nose triangle
  // played.
  ctx.fillStyle = CABIN_COLOR;
  ctx.beginPath();
  ctx.moveTo(0, FRONT_Y - 0.3);
  ctx.lineTo(-0.22, FRONT_Y + 0.05);
  ctx.lineTo(0.22, FRONT_Y + 0.05);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = OUTLINE_COLOR;
  ctx.lineWidth = OUTLINE_WIDTH;
  ctx.stroke();
}
