import * as THREE from "three";
import { DEFAULT_TRACK_ID, TRACK_PRESETS } from "../simulation/constants.ts";
import type { SimState, TrackId } from "../simulation/index.ts";
import {
  approach,
  CAMERA_ZOOM_SETTLE_TIME_CONSTANT_SECONDS,
  type CameraPose,
  nextCameraPose,
  RUN_START_ZOOM_FACTOR,
} from "./camera.ts";
import { simToWorld } from "./coordinates.ts";
import { buildScenery, buildStaticEnvironment, FOG_FAR_METERS, FOG_NEAR_METERS } from "./environment.ts";
import { FRONT_COLOR, REAR_COLOR, SKY_HORIZON_COLOR, wheelColor } from "./materials.ts";
import { SCENE_SCALE } from "./scene-scale.ts";
import { buildTrackGeometry } from "./track-geometry.ts";
import { axleWorldPoints, loadVehicle, type Vehicle } from "./vehicle.ts";

// This chase-camera scenario is calibrated as one set of numbers, the same
// discipline CLAUDE.md requires for `maxSteerAngle`/`TRACK_PRESETS`: change
// one of these and the framing/legibility claims below may no longer hold.
// CAMERA_HEIGHT_METERS/CAMERA_PITCH_RADIANS/CHASE_DISTANCE_METERS fix the
// vantage — a camera mounted above and just behind the car, angled down at
// it. CAMERA_VERTICAL_FOV_DEGREES is derived from the previous 2D renderer's
// FOCAL_LENGTH_TO_VIEWPORT_HEIGHT_RATIO (1.15): a pinhole camera's focal
// length f and vertical FOV are related by tan(fov/2) = viewportHeight /
// (2f); expressing the ratio as viewportHeight/f = 1/1.15 gives fov =
// 2*atan(1/(2*1.15)) directly, so `PerspectiveCamera.fov` (Three.js's own
// vertical-FOV-in-degrees convention, aspect-independent) reproduces the same
// framing the old renderer tuned, without needing a viewport-height-relative
// focal length at all — Three.js's projection matrix already handles that.
//
// CAMERA_HEIGHT_METERS and CHASE_DISTANCE_METERS below are each a *base*
// figure multiplied by SCENE_SCALE (see scene-scale.ts) — not a coincidence
// of naming, a deliberate similarity transform: scaling the camera's own
// eye height and follow distance by the same factor the vehicle itself was
// scaled by keeps the car occupying the same fraction of the frame it did
// before that fix (a small-angle argument: the angle subtended by an object
// of size s at distance d is ~s/d, which is scale-invariant under s->k*s,
// d->k*d). Pitch and FOV are angles, not lengths, so they need no such
// scaling — verified by the same small-angle argument, and by an actual
// screenshot comparison (see PROCESS.md-adjacent verification) rather than
// assumed from the algebra alone.
const CAMERA_HEIGHT_METERS = 2.2 * SCENE_SCALE;
const CAMERA_PITCH_RADIANS = 0.22;
const CHASE_DISTANCE_METERS = 6 * SCENE_SCALE;
const FOCAL_LENGTH_TO_VIEWPORT_HEIGHT_RATIO = 1.15;
const CAMERA_VERTICAL_FOV_RADIANS = 2 * Math.atan(1 / (2 * FOCAL_LENGTH_TO_VIEWPORT_HEIGHT_RATIO));
const CAMERA_NEAR_METERS = 0.1;
const CAMERA_FAR_METERS = FOG_FAR_METERS + 40; // a little past where fog has already fully hidden everything

const MAX_DEVICE_PIXEL_RATIO = 2;
const TRAIL_MAX_POINTS = 40;
// Deliberately NOT scaled by SCENE_SCALE, unlike the vehicle/camera figures
// above. recordTrail() pushes a new dot every update() call an axle stays
// saturated — at typical run speeds that's roughly 0.2m between consecutive
// dots — and every pooled dot sits at the same world Y (TRAIL_LIFT_METERS),
// unsorted, alpha-blended. Scaling this radius up by ~2x once made
// consecutive dots overlap ~3x instead of ~1.5x, which visibly banded into a
// solid "stacked rings" column under grazing chase-camera angles instead of
// a legible skid mark — worse than the mismatch-vs-wheel-size this scaling
// was meant to avoid. Confirmed by screenshot comparison, not algebra alone.
const TRAIL_DOT_RADIUS_METERS = 0.16;
const TRAIL_LIFT_METERS = 0.05;

export interface GripScene {
  update(state: SimState, reducedMotion: boolean): void;
  resize(): void;
  dispose(): void;
}

interface TrailPoint {
  x: number;
  z: number;
  color: THREE.Color;
}

interface TrailSlot {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
}

/** Removes every child from `group` and disposes only the geometries this
 * module itself procedurally created for track/scenery groups — never the
 * shared, `asset-loader.ts`-cached glTF geometries a scattered prop or the
 * vehicle references, since those are shared by reference across every
 * clone and other live scenes/instances may still need them. Materials,
 * unlike geometry, are already per-clone (`asset-loader.ts` clones the
 * object graph but not materials; `vehicle.ts`'s wheel materials are
 * explicitly re-cloned on top of that) so they're always safe to dispose
 * here. */
function disposeGroup(group: THREE.Group, disposeGeometries: boolean): void {
  group.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    if (disposeGeometries) node.geometry.dispose();
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    for (const material of materials) material.dispose();
  });
  group.clear();
}

/** Builds the 3D rear-chase scene: a real `THREE.Scene`/`WebGLRenderer`/
 * `PerspectiveCamera`, a procedural track ribbon rebuilt whenever the
 * selected track changes, one genuine 3D vehicle, and dusk lighting/scenery
 * from `environment.ts`. Throws if a WebGL context is unavailable (jsdom
 * under Vitest, or a browser with WebGL disabled); `main.ts` already catches
 * that so a canvas-less browser still gets the full instrument-panel
 * explanation (CLAUDE.md: DOM state is the non-visual truth, the canvas is
 * not required for the interaction to be legible). The road/kerb/reference/
 * finish geometry is synchronous, procedural `BufferGeometry` (see
 * `track-geometry.ts`) — it appears on the very first `update()` call
 * regardless of track direction, with no network round-trip to wait on. The
 * vehicle and each track's scattered scenery are the only asynchronous
 * parts: they load in the background and join the scene the moment they
 * resolve (`loadVehicle().then(...)`, `buildScenery(track).then(...)`
 * below), each with its own `.catch()` so a failed decorative asset load
 * never breaks the road, the other asset, or the rest of the scene. */
export function createGripScene(canvas: HTMLCanvasElement): GripScene {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  // Explicit, not relied-on-default: sedan.glb's colormap.png is an sRGB
  // asset (the GLTF convention every glTF loader assumes for colour
  // textures), so the renderer must decode it back out of sRGB before
  // lighting math and re-encode the final frame into sRGB for display —
  // otherwise the whole scene either double-encodes (washed out, "toy-like"
  // flat colours) or reads linear values as sRGB (crushed near-black
  // shadows). ACESFilmicToneMapping rolls off the sun/hemisphere/ambient
  // rig's highlights instead of hard-clipping them, which is what keeps
  // paint/glass/light accents on the car legible at dusk instead of blowing
  // out or collapsing to flat colour. Exposure tuned against a pixel-level
  // average of a real screenshot's darkest region (the chase-cam foreground
  // road/ground, inside the car's own cast shadow) rather than hex-value
  // reasoning or eyeballing alone: 1.15, then 1.3, then 1.5 each measured
  // under 5% brightness there (RGB ~7,5,3 out of 255 at 1.15, still only
  // ~11,9,6 at 1.5) before landing on 1.9 in the same brightening pass as
  // environment.ts's AMBIENT_INTENSITY/HEMI_INTENSITY. Re-verified by the same
  // measurement on the sky/sun-highlight region that this still doesn't clip
  // toward flat white.
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.9;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SKY_HORIZON_COLOR);
  scene.fog = new THREE.Fog(new THREE.Color(SKY_HORIZON_COLOR), FOG_NEAR_METERS, FOG_FAR_METERS);
  const staticEnvironment = buildStaticEnvironment();
  scene.add(staticEnvironment);

  const camera = new THREE.PerspectiveCamera(
    THREE.MathUtils.radToDeg(CAMERA_VERTICAL_FOV_RADIANS),
    1,
    CAMERA_NEAR_METERS,
    CAMERA_FAR_METERS,
  );

  let trackGroup: THREE.Group | null = null;
  let sceneryGroup: THREE.Group | null = null;
  let currentTrackId: TrackId | null = null;
  // Bumped every time a track rebuild starts; a rebuild's async work checks
  // this before applying its result, so a rapid double track-switch (or a
  // dispose() mid-load) can never have a stale, superseded load clobber a
  // newer one or resurrect geometry into a torn-down scene.
  let rebuildGeneration = 0;

  let vehicle: Vehicle | null = null;
  loadVehicle()
    .then((loaded) => {
      vehicle = loaded;
      scene.add(loaded.root);
    })
    .catch((error: unknown) => {
      console.error("failed to load the vehicle model", error);
    });

  function rebuildTrack(trackId: TrackId): void {
    if (trackId === currentTrackId) return;
    currentTrackId = trackId;
    const generation = ++rebuildGeneration;
    const track = TRACK_PRESETS[trackId] ?? TRACK_PRESETS[DEFAULT_TRACK_ID];

    if (trackGroup) {
      scene.remove(trackGroup);
      disposeGroup(trackGroup, true);
      trackGroup = null;
    }
    trackGroup = buildTrackGeometry(track);
    scene.add(trackGroup);

    buildScenery(track)
      .then((built) => {
        if (generation !== rebuildGeneration) {
          // Superseded by a later track switch (or the scene was disposed)
          // while this scatter was still loading — discard it instead of
          // adding stale scenery on top of whatever's current now.
          disposeGroup(built, false);
          return;
        }
        if (sceneryGroup) {
          scene.remove(sceneryGroup);
          disposeGroup(sceneryGroup, false);
        }
        sceneryGroup = built;
        scene.add(built);
      })
      .catch((error: unknown) => {
        // buildScenery's own placeInstance already swallows a single
        // failed asset load (see environment.ts), so this only fires on
        // something unexpected — still caught here rather than left to
        // reject silently, per the same "every async GLB load has an
        // explicit error path" discipline.
        console.error("failed to build track scenery", error);
      });
  }

  const trailPool: TrailSlot[] = [];
  for (let i = 0; i < TRAIL_MAX_POINTS; i++) {
    const geometry = new THREE.CircleGeometry(TRAIL_DOT_RADIUS_METERS, 12);
    geometry.rotateX(-Math.PI / 2);
    const material = new THREE.MeshBasicMaterial({ color: FRONT_COLOR, transparent: true, opacity: 0 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.visible = false;
    scene.add(mesh);
    trailPool.push({ mesh, material });
  }

  let trail: TrailPoint[] = [];
  let lastElapsed = 0;
  // The camera's actual (eased) pose, vs. state.x/y/heading which is always
  // the car's true physics pose. `rotation` here is the camera's world-frame
  // *yaw* (a sim-space heading angle, same convention as SimState.heading —
  // see below), not a screen-rotation angle. The initial value matches the
  // very first frame's target for a stationary car at the origin heading 0
  // (worldTravelHeading 0, so the camera sits CHASE_DISTANCE_METERS behind
  // the origin along +x, yaw 0), so there's no pop on initial render.
  let cameraPose: CameraPose = { x: -CHASE_DISTANCE_METERS, y: 0, rotation: 0 };
  let zoomFactor = 1;
  let lastFrameTimestamp: number | null = null;

  function resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DEVICE_PIXEL_RATIO);
    const width = Math.max(1, canvas.clientWidth);
    const height = Math.max(1, canvas.clientHeight);
    renderer.setPixelRatio(dpr);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
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

    const { front, rear } = axleWorldPoints(state);
    if (state.front.saturated) {
      trail.push({ x: front.x, z: front.z, color: wheelColor(FRONT_COLOR, state.front.utilisation, true) });
    }
    if (state.rear.saturated) {
      trail.push({ x: rear.x, z: rear.z, color: wheelColor(REAR_COLOR, state.rear.utilisation, true) });
    }
    if (trail.length > TRAIL_MAX_POINTS) trail = trail.slice(trail.length - TRAIL_MAX_POINTS);
  }

  function drawTrail(reducedMotion: boolean): void {
    for (let i = 0; i < trailPool.length; i++) {
      const slot = trailPool[i];
      const point = trail[i];
      if (!point) {
        slot.mesh.visible = false;
        continue;
      }
      slot.mesh.visible = true;
      slot.mesh.position.set(point.x, TRAIL_LIFT_METERS, point.z);
      slot.material.color.copy(point.color);
      const age = trail.length - i;
      slot.material.opacity = reducedMotion ? 0.5 : Math.max(0, 1 - age / TRAIL_MAX_POINTS);
    }
  }

  function update(state: SimState, reducedMotion: boolean): void {
    rebuildTrack(state.track);

    const isFreshStart = state.elapsed < lastElapsed;
    lastElapsed = state.elapsed;
    recordTrail(state, isFreshStart);
    drawTrail(reducedMotion);

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

    // Camera target: chases from directly behind the car along its current
    // *travel* heading (world-frame velocity direction, not body heading —
    // see CLAUDE.md's camera rule), at a fixed distance/height. Straight-
    // line, no-slip driving keeps the car centred with its nose pointing
    // straight up the road; the instant an axle saturates and body heading
    // diverges from travel direction, the chassis itself visibly yaws (a
    // real 3D rotation now, not a screen-space billboard trick) while the
    // road/camera framing stays stable — that rotation is the legibility
    // signal this whole redesign exists to preserve.
    const worldTravelHeading = state.heading + Math.atan2(state.vy, state.vx);
    const targetX = state.x - CHASE_DISTANCE_METERS * Math.cos(worldTravelHeading);
    const targetY = state.y - CHASE_DISTANCE_METERS * Math.sin(worldTravelHeading);

    const poseEasingEnabled = !reducedMotion && state.phase === "running" && !isFreshStart;
    cameraPose = nextCameraPose(cameraPose, { x: targetX, y: targetY, rotation: worldTravelHeading }, dt, poseEasingEnabled);

    // Run-start zoom "settle": a deliberate flourish, not a bug fix (see
    // camera.ts's RUN_START_ZOOM_FACTOR doc comment) — widen the field of
    // view slightly the instant a fresh run starts, then ease back to the
    // normal FOV. A *smaller* zoomFactor means a *wider* FOV here (see the
    // fov-from-zoomFactor derivation below), matching the old renderer's
    // "shorter focal length" pull-back exactly. Disabled under
    // reducedMotion, matching every other eased effect here.
    if (reducedMotion) {
      zoomFactor = 1;
    } else if (isFreshStart && state.phase === "running") {
      zoomFactor = RUN_START_ZOOM_FACTOR;
    } else {
      zoomFactor = approach(zoomFactor, 1, dt, CAMERA_ZOOM_SETTLE_TIME_CONSTANT_SECONDS);
    }

    // tan(fov/2) is inversely proportional to focal length; the old
    // renderer multiplied its focal length by zoomFactor directly, so the
    // equivalent fov satisfies tan(fov/2) = tan(baseFov/2) / zoomFactor.
    const fovRadians = 2 * Math.atan(Math.tan(CAMERA_VERTICAL_FOV_RADIANS / 2) / zoomFactor);
    camera.fov = THREE.MathUtils.radToDeg(fovRadians);
    camera.updateProjectionMatrix();

    const eye = simToWorld(cameraPose.x, cameraPose.y);
    camera.position.set(eye.x, CAMERA_HEIGHT_METERS, eye.z);

    // Look-at target derived directly from the camera's own eased yaw
    // (`cameraPose.rotation`, a sim-space heading — CCW-positive from +x,
    // the exact same convention `SimState.heading` uses) plus a fixed
    // downward pitch, rather than a rotation.y offset the way vehicle.ts's
    // model-specific mapping needs: a look-at target has no "local forward
    // axis" ambiguity to resolve, so composing yaw and pitch directly into a
    // world-space direction vector is both simpler and exactly equivalent.
    // `simToWorld`'s worldZ = -simY means a unit step along sim heading
    // theta maps to world (cos theta, 0, -sin theta); tilting that down by
    // `pitch` scales the horizontal component by cos(pitch) and adds
    // -sin(pitch) to the vertical component.
    const yaw = cameraPose.rotation;
    const forward = new THREE.Vector3(
      Math.cos(yaw) * Math.cos(CAMERA_PITCH_RADIANS),
      -Math.sin(CAMERA_PITCH_RADIANS),
      -Math.sin(yaw) * Math.cos(CAMERA_PITCH_RADIANS),
    );
    camera.lookAt(camera.position.clone().add(forward));

    vehicle?.update(state);

    renderer.render(scene, camera);
  }

  /** Frees every GPU resource this scene created — real work now that
   * rendering is real WebGL, unlike the previous 2D canvas's no-op
   * `dispose()`. `rebuildGeneration++` first so any track-scenery load still
   * in flight discards its result instead of adding stale geometry back into
   * a torn-down scene (see `rebuildTrack`'s doc comment). Shared, cached
   * glTF geometry (the vehicle, and every scattered prop) is deliberately
   * not disposed here — only per-instance materials are, via
   * `disposeGroup`'s `disposeGeometries: false` — since `asset-loader.ts`'s
   * module-level cache may still be serving that same geometry to a future
   * scene in this session. */
  function dispose(): void {
    rebuildGeneration++;

    scene.remove(staticEnvironment);
    disposeGroup(staticEnvironment, true);

    if (trackGroup) {
      scene.remove(trackGroup);
      disposeGroup(trackGroup, true);
      trackGroup = null;
    }
    if (sceneryGroup) {
      scene.remove(sceneryGroup);
      disposeGroup(sceneryGroup, false);
      sceneryGroup = null;
    }
    if (vehicle) {
      scene.remove(vehicle.root);
      disposeGroup(vehicle.root, false);
      vehicle = null;
    }
    for (const slot of trailPool) {
      scene.remove(slot.mesh);
      slot.mesh.geometry.dispose();
      slot.material.dispose();
    }

    renderer.dispose();
  }

  resize();

  return { update, resize, dispose };
}
