import { CAR_PARAMS, DEFAULT_TRACK_ID, TRACK_PRESETS } from "../simulation/constants.ts";
import type { SimState, TrackParams } from "../simulation/index.ts";
import { trackCentre } from "../simulation/track.ts";
import {
  CAMERA_ZOOM_SETTLE_TIME_CONSTANT_SECONDS,
  type CameraPose,
  RUN_START_ZOOM_FACTOR,
  approach,
  nextCameraPose,
} from "./camera.ts";
import { drawCar, FRONT_COLOR, REAR_COLOR, wheelColor } from "./car.ts";
import { type Camera, horizonScreenY, project, type ProjectedPoint, type Viewport } from "./projection.ts";

// This chase-camera scenario is calibrated as one set of numbers, the same
// discipline CLAUDE.md requires for `maxSteerAngle`/`TRACK_PRESETS`: change
// one of these and the framing/legibility claims below may no longer hold.
//
// CAMERA_HEIGHT_METERS/CAMERA_PITCH_RADIANS/CHASE_DISTANCE_METERS together
// fix the vantage: a camera mounted above and just behind the car, angled
// down at it — high and close enough that the car reads clearly, low and far
// enough back that the road ahead still dominates the frame rather than the
// car filling it. FOCAL_LENGTH_TO_VIEWPORT_HEIGHT_RATIO is expressed as a
// ratio of the *viewport's* height, not a raw pixel count, so the field of
// view (and therefore the framing) stays the same across the 1920x1080 and
// 390x844 marking viewports instead of one of them ending up a fisheye or a
// pinhole. With these numbers, `horizonScreenY` (projection.ts) lands at
// roughly 24% down from the top — mostly road/ground, a strip of sky above.
const CAMERA_HEIGHT_METERS = 2.2;
const CAMERA_PITCH_RADIANS = 0.22;
const CHASE_DISTANCE_METERS = 6;
const FOCAL_LENGTH_TO_VIEWPORT_HEIGHT_RATIO = 1.15;

// Metres. Bounded draw distance: how far ahead of the camera the road is
// sampled and drawn, plus a small margin behind it so the road doesn't pop
// into existence right at the camera's own position. Calibrated together
// with TRACK_PRESETS (constants.ts): both hairpin presets sweep further than
// this at once, so — exactly like the previous (orthographic) chase-camera
// pass's zoom, and for the same reason — the corner's far side is never all
// visible in a single frame. That is intentional, matching a real chase
// camera; don't "fix" it by raising this until the whole corner fits.
const ROAD_DRAW_DISTANCE_METERS = 70;
const ROAD_BEHIND_MARGIN_METERS = 10;
// Metres per sample/band along the arc. Also sets the banding/dash period
// used as the road's only motion cue (see `drawRoad`) — anchored to a
// world-fixed grid from the track's own start, not to the sliding draw
// window, so the same physical stretch of road is always the same band
// colour from one frame to the next and the pattern reads as scrolling
// toward the camera rather than flickering.
const ROAD_SAMPLE_STEP_METERS = 4;
const ROAD_HALF_WIDTH = 7; // m, matches the old orthographic scene's road width
const KERB_WIDTH_METERS = 1.2;

const MAX_DEVICE_PIXEL_RATIO = 2;
const TRAIL_MAX_POINTS = 40;
const TRAIL_DOT_RADIUS_METERS = 0.16;

const SKY_COLOR = "#12151a";
const GROUND_COLOR = "#20241f"; // off-road grass, distinct from the road surface
const ROAD_COLOR = "#2c3038";
const ROAD_COLOR_ALT = "#333844";
const KERB_COLOR_A = "#c94f3f";
const KERB_COLOR_B = "#dfdccf";
const REFERENCE_LINE_COLOR = "#dfdccf";
const FINISH_MARKER_COLOR = "#f2efe8";

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

interface WorldPoint {
  x: number;
  y: number;
}

/** The car's starting angle (relative to a track's centre of curvature) and
 * the angle it sweeps toward as the run progresses — see `sweptAngleRate`
 * (track.ts), worked out geometrically here so the road can be sampled as a
 * trimmed, finite arc instead of a full circle. Every track starts the car
 * at world (0, 0) heading +x, so a "right" track's centre sits below the
 * start point (angle +pi/2 from the start point) and a "left" track's centre
 * sits above it (angle -pi/2); sweeping toward the track's own `sweepAngle`
 * moves that angle clockwise for "right" and counterclockwise for "left" —
 * mirrored, per track.ts's direction convention. */
function arcAngles(track: TrackParams): { start: number; end: number } {
  const start = track.direction === "left" ? -Math.PI / 2 : Math.PI / 2;
  const end = track.direction === "left" ? start + track.sweepAngle : start - track.sweepAngle;
  return { start, end };
}

function pointOnArc(centre: WorldPoint, radius: number, angle: number): WorldPoint {
  return { x: centre.x + radius * Math.cos(angle), y: centre.y + radius * Math.sin(angle) };
}

/** Builds the pseudo-3D chase-camera scene: a hand-rolled perspective
 * projection over the flat ground plane (the classic Out Run/Pole Position
 * technique — see `projection.ts`), not an orthographic top-down transform.
 * Two earlier passes (rotate the camera to travel heading, then anchor it
 * low and zoom in) tuned an orthographic `ctx.translate -> ctx.scale ->
 * ctx.rotate` transform and still read as a radar/map view — that was not a
 * tuning failure, it was structural: an orthographic projection has no
 * horizon and nothing shrinks with distance, so no amount of retuning it
 * produces a behind-and-above chase-camera look. This scene instead computes
 * every drawn point's screen position numerically via `project()`, using a
 * camera that chases from behind the car (position/yaw eased via
 * `nextCameraPose`, reused unchanged from the previous pass — see
 * CLAUDE.md's camera rule) and draws the car itself as a screen-space
 * billboard rotated by slip angle, not a projected 3D chassis. Throws if a
 * 2D context is unavailable; main.ts catches that so a canvas-less browser
 * still gets the full instrument-panel explanation (CLAUDE.md: DOM state is
 * the non-visual truth, the canvas is not required for the interaction to be
 * legible). */
export function createGripScene(canvas: HTMLCanvasElement): GripScene {
  const context = canvas.getContext("2d");
  if (!context) throw new Error("2D canvas context unavailable");
  // Re-bound with an explicit non-null type: TS's null-narrowing above only
  // covers direct references in this scope, not the nested closures below.
  const ctx: CanvasRenderingContext2D = context;

  let trail: TrailPoint[] = [];
  let lastElapsed = 0;
  // The camera's actual (eased) pose, vs. state.x/y/heading which is always
  // the car's true physics pose — the car billboard's anchor point is
  // projected from the true pose every frame, only the camera itself lags.
  // `rotation` here is the camera's world-frame *yaw* (see projection.ts's
  // Camera.yaw), not a screen-rotation angle the way the orthographic
  // scene's `cameraRotation` was — see the module doc comment above. The
  // initial value matches the very first frame's target for a stationary car
  // at the origin heading 0 (worldTravelHeading 0, so the camera sits
  // CHASE_DISTANCE_METERS behind the origin along +x, yaw 0), so there's no
  // pop on initial render.
  let cameraPose: CameraPose = { x: -CHASE_DISTANCE_METERS, y: 0, rotation: 0 };
  let zoomFactor = 1;
  let lastFrameTimestamp: number | null = null;

  function resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DEVICE_PIXEL_RATIO);
    const width = Math.max(1, canvas.clientWidth);
    const height = Math.max(1, canvas.clientHeight);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }

  /** Fills a screen-space polygon (already-projected points) if every corner
   * is visible — with a bounded draw distance and near-plane cutoff, a
   * segment straddling the edge of visibility is rare enough that skipping
   * it outright (rather than clipping it) reads as nothing worse than the
   * road fading in a touch further out than the nominal draw distance. */
  function fillProjectedQuad(points: ProjectedPoint[], color: string): void {
    if (!points.every((p) => p.visible)) return;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(points[0].screenX, points[0].screenY);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].screenX, points[i].screenY);
    ctx.closePath();
    ctx.fill();
  }

  /** Draws the road as a sequence of projected, banded quads sampled along
   * the track's arc — the classic Out Run technique adapted from scanlines
   * to explicit polygons. Sampled on a world-fixed grid of `k` indices
   * (`theta_k = start + directionSign * k * ROAD_SAMPLE_STEP_METERS /
   * radius`), not on indices relative to the current draw window, so a given
   * physical stretch of road is always the same band regardless of where the
   * camera currently is — the banding scrolls toward the viewer as a motion
   * cue instead of flickering as the window recomputes each frame. */
  function drawRoad(track: TrackParams, state: SimState, camera: Camera, viewport: Viewport): void {
    const { cx, cy } = trackCentre(track);
    const centre: WorldPoint = { x: cx, y: cy };
    const { start, end } = arcAngles(track);
    const directionSign = track.direction === "left" ? 1 : -1;
    const dTheta = ROAD_SAMPLE_STEP_METERS / track.radius;

    // Where the car currently is along the arc, in the same signed-progress
    // terms `sweptAngleRate` (track.ts) already integrates — reusing
    // `state.sweptAngle` avoids re-deriving "how far around the corner" via
    // trigonometry on the car's position.
    const carRawAngle = start + directionSign * state.sweptAngle;
    const carProgress = directionSign * (carRawAngle - start); // === state.sweptAngle

    const behindMarginAngle = ROAD_BEHIND_MARGIN_METERS / track.radius;
    const aheadAngle = ROAD_DRAW_DISTANCE_METERS / track.radius;
    const progressFrom = Math.max(0, carProgress - behindMarginAngle);
    const progressTo = Math.min(track.sweepAngle, carProgress + aheadAngle);

    const kMin = Math.floor(progressFrom / dTheta);
    const kMax = Math.ceil(progressTo / dTheta);

    function angleAt(k: number): number {
      return start + directionSign * k * dTheta;
    }

    function projectAt(radius: number, k: number): ProjectedPoint {
      const point = pointOnArc(centre, radius, angleAt(k));
      return project(point.x, point.y, camera, viewport);
    }

    for (let k = kMin; k < kMax; k++) {
      const bandColor = k % 2 === 0 ? ROAD_COLOR : ROAD_COLOR_ALT;
      const kerbColor = k % 2 === 0 ? KERB_COLOR_A : KERB_COLOR_B;

      const innerA = projectAt(track.radius - ROAD_HALF_WIDTH, k);
      const innerB = projectAt(track.radius - ROAD_HALF_WIDTH, k + 1);
      const outerA = projectAt(track.radius + ROAD_HALF_WIDTH, k);
      const outerB = projectAt(track.radius + ROAD_HALF_WIDTH, k + 1);
      fillProjectedQuad([innerA, outerA, outerB, innerB], bandColor);

      const kerbInnerA = projectAt(track.radius - ROAD_HALF_WIDTH - KERB_WIDTH_METERS, k);
      const kerbInnerB = projectAt(track.radius - ROAD_HALF_WIDTH - KERB_WIDTH_METERS, k + 1);
      fillProjectedQuad([kerbInnerA, innerA, innerB, kerbInnerB], kerbColor);

      const kerbOuterA = projectAt(track.radius + ROAD_HALF_WIDTH + KERB_WIDTH_METERS, k);
      const kerbOuterB = projectAt(track.radius + ROAD_HALF_WIDTH + KERB_WIDTH_METERS, k + 1);
      fillProjectedQuad([outerA, kerbOuterA, kerbOuterB, outerB], kerbColor);

      if (k % 2 === 0) {
        const refInnerA = projectAt(track.radius - 0.15, k);
        const refInnerB = projectAt(track.radius - 0.15, k + 1);
        const refOuterA = projectAt(track.radius + 0.15, k);
        const refOuterB = projectAt(track.radius + 0.15, k + 1);
        fillProjectedQuad([refInnerA, refOuterA, refOuterB, refInnerB], REFERENCE_LINE_COLOR);
      }
    }

    // Finish marker: a solid bar across the road + kerb width at the exact
    // angle the track's swept arc ends — the visual promise that this run
    // has somewhere finite to reach, not an open-ended corner (CLAUDE.md).
    // Projected like every other road feature, so it recedes/disappears with
    // distance and behind-camera the same way; `fillProjectedQuad` already
    // no-ops when any corner isn't visible.
    const finishInner = project(
      pointOnArc(centre, track.radius - ROAD_HALF_WIDTH - KERB_WIDTH_METERS, end).x,
      pointOnArc(centre, track.radius - ROAD_HALF_WIDTH - KERB_WIDTH_METERS, end).y,
      camera,
      viewport,
    );
    const finishOuter = project(
      pointOnArc(centre, track.radius + ROAD_HALF_WIDTH + KERB_WIDTH_METERS, end).x,
      pointOnArc(centre, track.radius + ROAD_HALF_WIDTH + KERB_WIDTH_METERS, end).y,
      camera,
      viewport,
    );
    const finishBackAngle = end - directionSign * (ROAD_SAMPLE_STEP_METERS / track.radius) * 0.4;
    const finishInnerBack = project(
      pointOnArc(centre, track.radius - ROAD_HALF_WIDTH - KERB_WIDTH_METERS, finishBackAngle).x,
      pointOnArc(centre, track.radius - ROAD_HALF_WIDTH - KERB_WIDTH_METERS, finishBackAngle).y,
      camera,
      viewport,
    );
    const finishOuterBack = project(
      pointOnArc(centre, track.radius + ROAD_HALF_WIDTH + KERB_WIDTH_METERS, finishBackAngle).x,
      pointOnArc(centre, track.radius + ROAD_HALF_WIDTH + KERB_WIDTH_METERS, finishBackAngle).y,
      camera,
      viewport,
    );
    fillProjectedQuad([finishInnerBack, finishOuterBack, finishOuter, finishInner], FINISH_MARKER_COLOR);
  }

  function drawTrail(camera: Camera, viewport: Viewport, reducedMotion: boolean): void {
    // A point exactly CHASE_DISTANCE_METERS ahead of the camera (i.e. right
    // where the car itself normally sits) is the self-consistent "full
    // opacity" reference scale — trail dots at roughly that distance or
    // nearer draw at full strength, farther ones fade further on top of the
    // existing age-based fade, rather than needing a second, hand-picked
    // reference constant.
    const fullOpacityScale = camera.focalLength / CHASE_DISTANCE_METERS;
    for (let i = 0; i < trail.length; i++) {
      const point = trail[i];
      const age = trail.length - i;
      const ageOpacity = reducedMotion ? 0.5 : Math.max(0, 1 - age / TRAIL_MAX_POINTS);
      const projected = project(point.x, point.y, camera, viewport);
      if (!projected.visible) continue;
      const distanceOpacity = Math.min(1, projected.scale / fullOpacityScale);
      ctx.globalAlpha = ageOpacity * distanceOpacity;
      ctx.fillStyle = point.color;
      ctx.beginPath();
      ctx.arc(projected.screenX, projected.screenY, TRAIL_DOT_RADIUS_METERS * projected.scale, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  /** Cheap, non-photorealistic evidence of *where* an axle spent its
   * saturated moments: a capped trail of dots dropped at that axle's world
   * position whenever `state.front.saturated`/`state.rear.saturated` is
   * true. `isFreshStart` (the only signal that distinguishes "still
   * running" from "a fresh run just started" — Reset returns elapsed to 0
   * with phase "ready"; pressing Run from "finished" also resets elapsed to
   * 0) clears the previous run's trail; the camera pose reset below reuses
   * the same signal. */
  function recordTrail(state: SimState, isFreshStart: boolean): void {
    if (isFreshStart) trail = [];

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
    const track = TRACK_PRESETS[state.track] ?? TRACK_PRESETS[DEFAULT_TRACK_ID];
    const isFreshStart = state.elapsed < lastElapsed;
    lastElapsed = state.elapsed;
    recordTrail(state, isFreshStart);

    // Frame-rate-independent dt for the camera easing below — this is purely
    // cosmetic (camera pose only), so using wall-clock time here does not
    // violate CLAUDE.md's "simulation core stays deterministic" rule; that
    // rule binds src/simulation/, not this rendering layer. `update` can
    // also be called synchronously (main.ts's renderImmediately, e.g. from a
    // settings click) rather than only once per rAF, so a huge or negative
    // gap since the last call is clamped rather than trusted.
    const now = performance.now();
    const dt = lastFrameTimestamp === null ? 0 : Math.min(0.1, Math.max(0, (now - lastFrameTimestamp) / 1000));
    lastFrameTimestamp = now;

    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DEVICE_PIXEL_RATIO);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const cssWidth = canvas.width / dpr;
    const cssHeight = canvas.height / dpr;
    const viewport: Viewport = { width: cssWidth, height: cssHeight };

    // Camera target: chases from directly behind the car along its current
    // *travel* heading (world-frame velocity direction, not body heading —
    // see CLAUDE.md's camera rule), at a fixed distance/height. Yaw tracks
    // travel heading directly (no `pi/2 -` offset the way the old
    // screen-rotation target needed — this is a world-frame camera facing
    // angle now, not a canvas rotation). Straight-line, no-slip driving
    // therefore keeps the car centred with its nose pointing straight up the
    // road; the instant an axle saturates and body heading diverges from
    // travel direction, the car billboard itself visibly rotates by the slip
    // angle (see the car-drawing block below) while the road/camera framing
    // stays stable — that rotation, not a yawing frame, is now the
    // legibility signal this whole redesign exists to preserve.
    const worldTravelHeading = state.heading + Math.atan2(state.vy, state.vx);
    const targetX = state.x - CHASE_DISTANCE_METERS * Math.cos(worldTravelHeading);
    const targetY = state.y - CHASE_DISTANCE_METERS * Math.sin(worldTravelHeading);

    // Ease the camera's position/yaw toward that target, except: not under
    // reducedMotion (snap every frame, same as drawTrail's opacity branch),
    // not outside an active run (a stationary car has nothing to smooth
    // over), and not on the exact frame a fresh run teleports the car back
    // to its track's start (panning smoothly across a teleport would
    // misrepresent an instantaneous event as continuous motion — see
    // nextCameraPose's doc comment in camera.ts). `nextCameraPose` itself is
    // reused completely unchanged from the previous pass; only what's fed in
    // as the target has changed.
    const poseEasingEnabled = !reducedMotion && state.phase === "running" && !isFreshStart;
    cameraPose = nextCameraPose(cameraPose, { x: targetX, y: targetY, rotation: worldTravelHeading }, dt, poseEasingEnabled);

    // Run-start zoom "settle": a deliberate flourish, not a bug fix (see
    // camera.ts's RUN_START_ZOOM_FACTOR doc comment) — pull back slightly
    // (a shorter focal length) the instant a fresh run starts, then ease in
    // to the normal focal length. Disabled under reducedMotion, matching
    // every other eased effect here.
    if (reducedMotion) {
      zoomFactor = 1;
    } else if (isFreshStart && state.phase === "running") {
      zoomFactor = RUN_START_ZOOM_FACTOR;
    } else {
      zoomFactor = approach(zoomFactor, 1, dt, CAMERA_ZOOM_SETTLE_TIME_CONSTANT_SECONDS);
    }

    const camera: Camera = {
      x: cameraPose.x,
      y: cameraPose.y,
      yaw: cameraPose.rotation,
      height: CAMERA_HEIGHT_METERS,
      pitch: CAMERA_PITCH_RADIANS,
      focalLength: cssHeight * FOCAL_LENGTH_TO_VIEWPORT_HEIGHT_RATIO * zoomFactor,
    };

    // Sky/ground split at the horizon — not a second, independently-tuned
    // constant: `horizonScreenY` falls out of the exact same
    // pitch/focalLength/viewport math `project` uses for every other point
    // (see projection.ts), so it always lines up with where the road itself
    // vanishes.
    const horizon = horizonScreenY(camera, viewport);
    ctx.fillStyle = SKY_COLOR;
    ctx.fillRect(0, 0, cssWidth, Math.max(0, horizon));
    ctx.fillStyle = GROUND_COLOR;
    ctx.fillRect(0, Math.max(0, horizon), cssWidth, cssHeight - Math.max(0, horizon));

    drawRoad(track, state, camera, viewport);
    drawTrail(camera, viewport, reducedMotion);

    // The car is a screen-space billboard (CLAUDE.md's camera rule): its
    // anchor point is the car's true world position run through the same
    // `project()` as everything else — so camera lag during a hard slide
    // honestly nudges its screen position, exactly like a real chase camera
    // would show — but the sprite itself is flat 2D art, not projected 3D
    // geometry. Its rotation is the slip angle (`state.heading -
    // worldTravelHeading`): zero during normal no-slip driving (nose stays
    // pointing straight up the screen, matching the camera's own travel-
    // heading-aligned yaw), growing the instant an axle saturates — this
    // replaces "the frame yaws" as the core legibility signal, since the
    // frame itself is now deliberately stable (a real chase camera doesn't
    // yaw with every wiggle of the car it's following).
    const carAnchor = project(state.x, state.y, camera, viewport);
    if (carAnchor.visible) {
      const slipAngle = state.heading - worldTravelHeading;
      ctx.save();
      ctx.translate(carAnchor.screenX, carAnchor.screenY);
      ctx.rotate(-slipAngle);
      ctx.scale(carAnchor.scale, carAnchor.scale);
      const frontSteerAngle = state.steering * CAR_PARAMS.maxSteerAngle;
      drawCar(
        ctx,
        frontSteerAngle,
        wheelColor(FRONT_COLOR, state.front.utilisation, state.front.saturated),
        wheelColor(REAR_COLOR, state.rear.utilisation, state.rear.saturated),
      );
      ctx.restore();
    }
  }

  function dispose(): void {
    // No WebGL context / GPU resources to release for a 2D canvas.
  }

  resize();

  return { update, resize, dispose };
}
