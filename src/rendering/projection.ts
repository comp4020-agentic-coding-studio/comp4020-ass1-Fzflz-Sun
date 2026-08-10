// Pure, DOM-free hand-rolled pinhole camera over the ground plane (z=0
// everywhere, matching physics.ts's flat-ground model — no true 3D geometry,
// no Three.js/WebGL). This replaces the orthographic translate/scale/rotate
// transform the 2D scene used to use, which is *structurally* incapable of a
// behind-and-above, low-angle chase-camera look no matter how its parameters
// are tuned: an orthographic top-down projection has no notion of a horizon
// or of things shrinking with distance, so two rounds of tuning it (rotate
// to travel heading, then anchor low + zoom in) still read as a radar/map
// view. A perspective projection — the classic Out Run/Pole Position
// technique — is the actual fix; see CLAUDE.md's camera rule.
//
// The camera itself (position, yaw, height, pitch, focal length) is
// app-specific and lives in scene.ts, calibrated as one scenario the same
// way TRACK_PRESETS/maxSteerAngle are; this module only knows the generic
// math of turning a world (x, y) point on the ground plane into a screen
// position, given any such camera.

/** A pinhole camera positioned on/above the ground plane. `x`/`y` are its
 * world-frame position (metres, same plane the car drives on); `height` is
 * how far above that plane the camera sits (metres); `yaw` is which way it
 * faces in the world (radians, CCW-positive from +x — the same convention
 * `SimState.heading` uses, so a camera aimed at `worldTravelHeading` needs no
 * extra sign flip); `pitch` is how far it tilts *down* from looking along the
 * horizontal (radians, positive = looking down at the ground, matching a real
 * chase camera mounted above and behind, angled down at the car); `focalLength`
 * controls zoom (pixels — larger narrows the field of view and magnifies
 * everything). */
export interface Camera {
  x: number;
  y: number;
  yaw: number;
  height: number;
  pitch: number;
  focalLength: number;
}

/** The drawing surface's size in the same pixel units as `focalLength`
 * (CSS pixels — the caller applies device-pixel-ratio scaling separately). */
export interface Viewport {
  width: number;
  height: number;
}

export interface ProjectedPoint {
  screenX: number;
  screenY: number;
  /** Pixels per metre at this point's depth — how large a 1m object would
   * draw here. Shrinks with distance, exactly like a real lens. */
  scale: number;
  /** False once a point is at or behind the camera's near plane — the caller
   * must not draw it (naively projecting a point at/behind the camera
   * divides by a near-zero or negative depth and produces nonsense screen
   * coordinates that can wrap to the opposite side of the frame). */
  visible: boolean;
}

// Metres. Points closer to the camera than this along its optical axis are
// not visible — guards the perspective divide below from a near-zero or
// negative depth, the same purpose `minSpeedForSlip` serves for physics.ts's
// atan2 slip-angle denominator (constants.ts): a numerical floor, not a
// claim about real lens optics.
const NEAR_PLANE_METERS = 0.5;

/** Projects a world-frame ground point (`worldX`, `worldY`, implicitly at
 * z=0) through `camera` onto `viewport`'s screen space.
 *
 * The pipeline (translate -> yaw-rotate -> pitch-rotate -> perspective
 * divide):
 * 1. Translate the point into camera-relative world coordinates.
 * 2. Yaw-rotate into the camera's forward/lateral frame — identical to how
 *    physics.ts converts a world-frame vector into the car's body frame via
 *    `heading` (forward = +x-aligned, lateral = +y-aligned/left), just using
 *    the camera's `yaw` instead of the car's `heading`.
 * 3. Pitch-rotate the (forward, vertical) pair into the camera's own
 *    optical-axis frame, where `depth` is distance along where the camera is
 *    actually looking and `camVert` is offset from that axis (ground points
 *    are `camera.height` below the camera, so this is what actually produces
 *    a horizon: see `horizonScreenY`).
 * 4. Perspective-divide by `depth` to get screen position and scale — the
 *    one step an orthographic projection (the old `ctx.scale` transform)
 *    fundamentally cannot do, which is *why* that projection could never
 *    produce a chase-camera look no matter how it was tuned. */
export function project(worldX: number, worldY: number, camera: Camera, viewport: Viewport): ProjectedPoint {
  const dx = worldX - camera.x;
  const dy = worldY - camera.y;

  const forward = dx * Math.cos(camera.yaw) + dy * Math.sin(camera.yaw);
  const lateral = -dx * Math.sin(camera.yaw) + dy * Math.cos(camera.yaw);

  // The ground is `camera.height` below the camera everywhere (flat-ground
  // model), so the vertical offset from camera to point, before pitch, is
  // always exactly -camera.height.
  const depth = forward * Math.cos(camera.pitch) + camera.height * Math.sin(camera.pitch);
  const camVert = forward * Math.sin(camera.pitch) - camera.height * Math.cos(camera.pitch);

  const visible = depth > NEAR_PLANE_METERS;
  const scale = visible ? camera.focalLength / depth : 0;

  // Screen X: lateral+ is left of the camera's facing direction (matching
  // the body-frame convention above), and screen X grows rightward, so a
  // left-of-camera point sits left of centre — hence the minus sign.
  const screenX = viewport.width / 2 - lateral * scale;
  // Screen Y: camVert+ is above the camera's optical axis, and screen Y
  // grows downward, so an above-axis point sits higher on screen (smaller
  // Y) — hence the minus sign here too.
  const screenY = viewport.height / 2 - camVert * scale;

  return { screenX, screenY, scale, visible };
}

/** The screen Y a ground point projects to in the limit of infinite
 * distance — i.e. the vanishing line for the ground plane. This is not a
 * second, independently-tuned constant: it falls out of the exact same
 * pitch/focalLength/viewport math `project` uses (as `forward` -> infinity,
 * `camVert / depth` -> `tan(camera.pitch)`), so raising the camera's pitch
 * or focal length moves the horizon consistently with everything else on
 * screen instead of needing to be kept in sync by hand. */
export function horizonScreenY(camera: Camera, viewport: Viewport): number {
  return viewport.height / 2 - camera.focalLength * Math.tan(camera.pitch);
}
