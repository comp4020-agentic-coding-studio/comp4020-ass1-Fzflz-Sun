import * as THREE from "three";
import { BARRIER_KERB_GAP_METERS, TRACK_PRESETS } from "../simulation/constants.ts";
import type { TrackParams } from "../simulation/index.ts";
import { trackCentre } from "../simulation/track.ts";
import { ASSET_PATHS, loadAsset } from "./asset-loader.ts";
import { fitAssetToSpec, type AssetPlacementSpec } from "./asset-fit.ts";
import { localAxisHeadingToWorldRotationY, simToWorld } from "./coordinates.ts";
import { createGroundMaterial, GROUND_COLOR, SKY_HORIZON_COLOR, SKY_TOP_COLOR } from "./materials.ts";
import { arcAngles, KERB_WIDTH_METERS, type Point2D, pointOnArc, ROAD_HALF_WIDTH } from "./track-geometry.ts";

const GROUND_RADIUS_METERS = 400;
const SKY_DOME_RADIUS_METERS = 380;

// Scene-level (not object) properties — scene.ts applies these directly to
// its THREE.Scene, since background/fog have no group a returned Object3D
// could carry.
export const FOG_NEAR_METERS = 40;
export const FOG_FAR_METERS = 220;

// Dusk key light: low and warm, casting the long shadows that sell "dusk"
// rather than "midday overcast". Its shadow frustum is sized once below from
// every TRACK_PRESETS entry's own radius (not the currently-selected track),
// so the static environment (sky/ground/lights) never needs rebuilding when
// the visitor picks a different track before a run starts — only the
// scenery scatter (buildScenery) is track-shaped.
const SUN_COLOR = "#e8ab6e";
const SUN_INTENSITY = 1.6;
const SUN_ELEVATION_RADIANS = 0.32;
const SUN_AZIMUTH_RADIANS = 0.9;
const HEMI_SKY_COLOR = SKY_HORIZON_COLOR;
const HEMI_GROUND_COLOR = GROUND_COLOR;
// Raised from an earlier 0.75, then 0.9, then 1.1 in the same brightening
// pass as AMBIENT_INTENSITY below — a pixel-level measurement (not just eyeballing)
// of the chase-cam's own foreground road/ground, the region closest to camera
// and inside the car's own cast shadow, showed real but still-insufficient gains
// at each step (RGB average ~7,5,3 at the original 0.75/0.45 pairing → ~11,9,6
// at 0.9/0.6 → still only ~11,9,6 out of 255 at 1.1/0.85, i.e. under 5%
// brightness) before landing here. Since the hemisphere light is what carries
// sky-vs-ground colour contrast onto upward-facing surfaces specifically, it
// still matters for the ground/car-roof even once ambient is doing most of the
// shadow-fill work below.
const HEMI_INTENSITY = 1.4;
const AMBIENT_COLOR = "#4a5568";
// Raised from an earlier 0.25, then 0.45, 0.6, 0.85: at a low dusk sun
// elevation, any side of the car (or the road) facing away from the sun — and
// especially the ground inside the car's own cast shadow, the single darkest
// region in the whole frame — got essentially no light at all beyond this
// ambient floor. Verified by a pixel-level average of that exact
// foreground-shadow region across each step (not guessed from hex values):
// 0.25/0.45/0.6 all left it under 3% brightness (RGB ~7,5,3 out of 255); 0.85
// only reached ~11,9,6 — a real but still-too-dark gain. Ambient light (unlike
// the hemisphere light) is uniform and non-directional, so it's the right tool
// for lifting shadow-side detail without also blowing out the sun-facing
// highlights the way more exposure or more sun intensity would — re-verified
// by the same pixel measurement on the sky/sun-facing region that raising this
// further still doesn't clip those areas toward flat white.
const AMBIENT_INTENSITY = 1.4;

const SHADOW_MAP_SIZE = 2048;

const MAX_TRACK_RADIUS_METERS = Math.max(...Object.values(TRACK_PRESETS).map((track) => track.radius));

// Every AssetPlacementSpec below states a real-world target size in metres,
// never a bare multiplier — see asset-fit.ts's own doc comment for why:
// Kenney's packs are not unit-consistent with each other (confirmed by
// direct GLB inspection, see docs/asset-sources.md), so "scale 1" on a
// barrier and "scale 1" on a light post mean completely different things.
// `targetAxis`/`localForwardAxis` are each asset's own confirmed properties
// (also documented in docs/asset-sources.md), not assumptions.

// barrierWhite.glb: raw size (X,Y,Z) = [0.25, 0.1312, 0.123] — its long axis
// is local +X (confirmed by direct inspection, not the sedan-only +Z the
// bug this replaces assumed). Targeting height (Y), not length: a fixed,
// plausible guardrail height (real roadside barriers run ~0.7-1m) is a more
// stable target than length, and BARRIER_GAP_METERS below derives the
// actual placement spacing from whatever length that height target implies
// — never the other way around.
const BARRIER_TARGET_HEIGHT_METERS = 0.9;
export const BARRIER_SPEC: AssetPlacementSpec = { targetAxis: "y", targetMeters: BARRIER_TARGET_HEIGHT_METERS, localForwardAxis: "+x" };
// Small real gap between consecutive segments (not touching, not 56x its
// own length apart as the old fixed-14m/0.25m-long combination produced) —
// reads as a continuous guardrail with visible seams, not scattered dots.
// Exported so tests can derive the exact expected placement interval from
// a mocked asset's own fitted size, rather than duplicating this number.
export const BARRIER_GAP_METERS = 0.15;
// Only used if the real asset fails to load (network failure) and its true
// fitted length can't be measured — a rough guess in the right ballpark so
// spacing degrades gracefully rather than throwing.
const BARRIER_FALLBACK_SIZE = new THREE.Vector3(1.7, BARRIER_TARGET_HEIGHT_METERS, 0.84);

// lightPostModern.glb: raw size (X,Y,Z) = [0.0491, 0.7813, 0.1776]. Its
// lamp-arm cantilevers along local +Z (confirmed by height-band vertex
// centroid analysis, not the filename or a guess — see
// docs/asset-sources.md): the top band's cluster sits at local z in
// [-0.660,-0.490] vs. the base band's [-0.668,-0.632], i.e. the arm extends
// specifically along +Z while X stays centred). Only `rotation.y` is ever
// applied to this asset (see placeInstance/localAxisHeadingToWorldRotationY
// below) — the post's own Y axis is never touched, so it can never tip
// away from vertical no matter which way the arm is made to point.
const POST_TARGET_HEIGHT_METERS = 4.5;
export const POST_SPEC: AssetPlacementSpec = { targetAxis: "y", targetMeters: POST_TARGET_HEIGHT_METERS, localForwardAxis: "+z" };
const POST_KERB_GAP_METERS = 2.2;
// Posts are thin poles, not something with a "length" to butt end-to-end
// like the barrier — spacing is instead a documented multiple of the
// fitted height (real light-post spacing commonly runs several times the
// pole's own height). This ratio was chosen so it reproduces close to the
// previous hand-picked 28m interval once fed the real fitted height
// (4.5m * 6 = 27m) — a sanity check that the derived number lands in the
// same ballpark a human already found reasonable, not a coincidence to rely
// on if POST_TARGET_HEIGHT_METERS ever changes. Exported for the same
// testability reason as BARRIER_GAP_METERS above.
export const POST_SPACING_TO_HEIGHT_RATIO = 6;
const POST_FALLBACK_SIZE = new THREE.Vector3(0.28, POST_TARGET_HEIGHT_METERS, 1.02);

// pylon.glb: raw size (X,Y,Z) = [0.12, 0.132, 0.12] — a near-square
// footprint (a cone/marker, not a directional object), so its
// `localForwardAxis` is nominal only; nothing in this file ever checks a
// pylon's orientation against a target direction the way the barrier/post
// are.
const PYLON_TARGET_HEIGHT_METERS = 0.7;
export const PYLON_SPEC: AssetPlacementSpec = { targetAxis: "y", targetMeters: PYLON_TARGET_HEIGHT_METERS, localForwardAxis: "+x" };
// Resolves pylon.glb's previous contradictory state — declared in
// ASSET_PATHS and documented, but never actually placed by any scatter
// function. Used sparingly (a two-marker "gate" at each end of the track,
// not scattered throughout) as an early, unambiguous scale-reference object
// near the run's start/end, on the inner kerb where it can't be confused
// with the outer barrier/post line.
const PYLON_INNER_GAP_METERS = 1.0;
const PYLON_PAIR_SPACING_METERS = 1.5;

const TREE_DEFAULT_SPEC: AssetPlacementSpec = { targetAxis: "y", targetMeters: 5.5, localForwardAxis: "+z" };
const TREE_PINE_SPEC: AssetPlacementSpec = { targetAxis: "y", targetMeters: 6.5, localForwardAxis: "+z" };
const TREE_DETAILED_SPEC: AssetPlacementSpec = { targetAxis: "y", targetMeters: 5.0, localForwardAxis: "+z" };
const ROCK_LARGE_SPEC: AssetPlacementSpec = { targetAxis: "y", targetMeters: 0.7, localForwardAxis: "+z" };
const ROCK_SMALL_SPEC: AssetPlacementSpec = { targetAxis: "y", targetMeters: 0.35, localForwardAxis: "+z" };

const FIELD_PROP_COUNT = 22;
const FIELD_MIN_OFFSET_METERS = 6;
const FIELD_MAX_OFFSET_METERS = 45;
const FIELD_ANGLE_MARGIN_RADIANS = 0.35;
// Field props get random full-circle yaw (see scatterField below), so a
// small per-instance size jitter on top of each type's own target reads as
// natural variation rather than a uniform army of identical clones — but
// it is only ever a modifier on a real per-type target, never a substitute
// for one (the flat 0.85-1.35 multiplier this replaces was a substitute:
// it made every field prop, tree or rock alike, share one meaningless
// scale range with no relationship to either's actual size).
const FIELD_SCALE_JITTER_FRACTION = 0.1;

const FIELD_ASSETS = [
  { url: ASSET_PATHS.treeDefault, weight: 3, spec: TREE_DEFAULT_SPEC },
  { url: ASSET_PATHS.treePine, weight: 3, spec: TREE_PINE_SPEC },
  { url: ASSET_PATHS.treeDetailed, weight: 2, spec: TREE_DETAILED_SPEC },
  { url: ASSET_PATHS.rockLarge, weight: 1, spec: ROCK_LARGE_SPEC },
  { url: ASSET_PATHS.rockSmall, weight: 2, spec: ROCK_SMALL_SPEC },
] as const;

/** Tiny deterministic PRNG (mulberry32) — CLAUDE.md's "no Math.random() per
 * frame" simulation rule doesn't bind this purely-cosmetic rendering layer,
 * but the same discipline still applies here for a better reason: scenery
 * is scattered once per track selection, not every frame, so it must not
 * reshuffle itself on the next `update()` call. Seeding from the track's
 * own params (not a frame count or wall-clock time) means the same track
 * always gets the same scenery layout. */
function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedForTrack(track: TrackParams): number {
  const directionBit = track.direction === "left" ? 1 : 0;
  return Math.round(track.radius * 1000 + track.sweepAngle * 10000) ^ directionBit;
}

function pickWeighted(rng: () => number): (typeof FIELD_ASSETS)[number] {
  const totalWeight = FIELD_ASSETS.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = rng() * totalWeight;
  for (const entry of FIELD_ASSETS) {
    roll -= entry.weight;
    if (roll <= 0) return entry;
  }
  return FIELD_ASSETS[FIELD_ASSETS.length - 1];
}

/** Builds a smooth top-to-horizon gradient dome via vertex colours on a
 * large inward-facing sphere — a full physical sky shader is out of scope
 * for a "closed low-poly test track" backdrop, and a flat single-colour
 * background would read as an empty void rather than dusk. `scene.background`
 * is left untouched by this dome (only fog needs a background colour to
 * fade toward); the dome itself is what's actually visible past the fog. */
function buildSkyDome(): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(SKY_DOME_RADIUS_METERS, 24, 16, 0, Math.PI * 2, 0, Math.PI / 1.9);
  const top = new THREE.Color(SKY_TOP_COLOR);
  const horizon = new THREE.Color(SKY_HORIZON_COLOR);
  const position = geometry.getAttribute("position") as THREE.BufferAttribute;
  const colors = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    const y = position.getY(i) / SKY_DOME_RADIUS_METERS; // -~0.1..1, since the dome is a capped upper hemisphere
    const t = THREE.MathUtils.clamp(1 - y, 0, 1);
    const color = horizon.clone().lerp(top, 1 - t);
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const material = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false });
  const dome = new THREE.Mesh(geometry, material);
  dome.name = "sky-dome";
  return dome;
}

function buildGround(): THREE.Mesh {
  const geometry = new THREE.CircleGeometry(GROUND_RADIUS_METERS, 48);
  geometry.rotateX(-Math.PI / 2);
  const ground = new THREE.Mesh(geometry, createGroundMaterial());
  ground.name = "ground";
  ground.receiveShadow = true;
  return ground;
}

/** Sized once from the widest `TRACK_PRESETS` radius (not the
 * currently-selected track), so this light rig never needs rebuilding when
 * the visitor switches tracks — only `buildScenery` is track-shaped. */
function buildLights(): THREE.Object3D[] {
  const shadowExtent = MAX_TRACK_RADIUS_METERS + ROAD_HALF_WIDTH + KERB_WIDTH_METERS + 30;

  const sun = new THREE.DirectionalLight(SUN_COLOR, SUN_INTENSITY);
  const sunDistance = 120;
  sun.position.set(
    Math.cos(SUN_AZIMUTH_RADIANS) * sunDistance,
    Math.sin(SUN_ELEVATION_RADIANS) * sunDistance,
    Math.sin(SUN_AZIMUTH_RADIANS) * sunDistance,
  );
  sun.castShadow = true;
  sun.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = sunDistance + shadowExtent;
  sun.shadow.camera.left = -shadowExtent;
  sun.shadow.camera.right = shadowExtent;
  sun.shadow.camera.top = shadowExtent;
  sun.shadow.camera.bottom = -shadowExtent;
  sun.shadow.bias = -0.0015;

  const hemisphere = new THREE.HemisphereLight(HEMI_SKY_COLOR, HEMI_GROUND_COLOR, HEMI_INTENSITY);
  const ambient = new THREE.AmbientLight(AMBIENT_COLOR, AMBIENT_INTENSITY);

  return [sun, sun.target, hemisphere, ambient];
}

/** Sky dome, ground plane, and the dusk light rig — everything about the
 * backdrop that does not depend on which track is currently selected. Built
 * once per scene lifetime; `scene.ts` adds this group and never rebuilds or
 * disposes it until the whole scene is torn down. */
export function buildStaticEnvironment(): THREE.Group {
  const group = new THREE.Group();
  group.name = "environment-static";
  group.add(buildSkyDome());
  group.add(buildGround());
  for (const light of buildLights()) group.add(light);
  return group;
}

function enableShadows(root: THREE.Object3D): void {
  root.traverse((node) => {
    if (node instanceof THREE.Mesh) {
      node.castShadow = true;
      node.receiveShadow = true;
    }
  });
}

/** Loads, fits (see asset-fit.ts), positions, and orients one scattered prop
 * instance, swallowing a load failure rather than letting it propagate:
 * this is decorative trackside scenery, not the road or the vehicle, so one
 * barrier/tree/rock's GLB failing to load (a 404, a network hiccup) must
 * not take down the rest of the scatter batch via `Promise.all` — every
 * async asset load needs its own explicit error path, not a shared
 * fail-everything one. Logged via `console.error` so a real failure is
 * still visible in the browser console (checkable, per CLAUDE.md's
 * asset-provenance discipline) instead of silently vanishing.
 *
 * `headingSim` and `spec.localForwardAxis` together decide `rotation.y` via
 * `localAxisHeadingToWorldRotationY` — never the sedan-specific
 * `sedanHeadingToWorldRotationY`, which would silently apply the wrong
 * offset to any prop whose local forward axis isn't +Z (exactly the bug
 * this replaces: every prop used to get the sedan's own +Z-forward formula
 * regardless of its own confirmed axis). Returns the fitted world size so
 * callers that need it for spacing (barrier/post) can use it; `null` on a
 * load failure. */
async function placeInstance(target: THREE.Object3D, url: string, spec: AssetPlacementSpec, position: Point2D, headingSim: number): Promise<THREE.Vector3 | null> {
  let root: THREE.Group;
  try {
    root = await loadAsset(url);
  } catch (error) {
    console.error(`failed to load scenery asset "${url}"`, error);
    return null;
  }
  const { wrapper, size } = fitAssetToSpec(root, spec);
  const world = simToWorld(position.x, position.y);
  wrapper.position.set(world.x, 0, world.z);
  wrapper.rotation.y = localAxisHeadingToWorldRotationY(headingSim, spec.localForwardAxis);
  // Tagged by source filename (not the full url) so both a browser's scene
  // inspector and tests can tell scattered instances apart by asset type —
  // purely a debugging/testability aid, nothing here reads it back.
  wrapper.name = url.slice(url.lastIndexOf("/") + 1);
  enableShadows(wrapper);
  target.add(wrapper);
  if (import.meta.env.DEV && url.includes("barrier")) {
    let meshCount = 0;
    wrapper.traverse((node) => {
      if (node instanceof THREE.Mesh) meshCount++;
    });
    console.debug(
      "[diag] barrier instance",
      JSON.stringify({
        meshCount,
        fittedSize: size.toArray(),
        worldPosition: wrapper.position.toArray(),
        worldRotationY: wrapper.rotation.y,
      }),
    );
  }
  return size;
}

/** Measures the fitted world size a given (url, spec) pair produces, without
 * adding anything to the scene — used to derive placement spacing (barrier
 * segment interval, post interval) from the asset's *actual* fitted
 * footprint instead of a second, independently-guessed number that could
 * silently drift out of sync with `spec.targetMeters`. Falls back to a
 * rough hand-picked estimate (only reachable on a real load failure) so a
 * network hiccup degrades spacing gracefully instead of throwing. */
async function measureFittedSize(url: string, spec: AssetPlacementSpec, fallback: THREE.Vector3): Promise<THREE.Vector3> {
  try {
    const root = await loadAsset(url);
    return fitAssetToSpec(root, spec).size;
  } catch (error) {
    console.error(`failed to measure scenery asset "${url}" for placement spacing; using a fallback size`, error);
    return fallback;
  }
}

/** Sparse trackside furniture (barriers, posts) anchored to the outer kerb,
 * spaced at a real interval derived from each asset's own fitted footprint
 * (see `measureFittedSize`/`BARRIER_GAP_METERS`/`POST_SPACING_TO_HEIGHT_RATIO`
 * above) — not a fixed metre interval chosen independently of how long or
 * tall the fitted model actually turned out to be.
 *
 * Orientation differs per asset because their local axes and roles differ:
 * - Barrier: its confirmed long axis (local +X) is aligned to the arc's own
 *   tangent direction, so consecutive segments read as one running fence
 *   alongside the road rather than a row of objects facing an arbitrary
 *   direction.
 * - Light post: only its lamp-arm axis (local +Z) is given a heading, aimed
 *   from the post's own position toward the track's centre of curvature —
 *   i.e. radially inward, illuminating the road — rather than reusing the
 *   barrier's tangent heading (the previous bug: every prop got the same
 *   tangent-derived heading regardless of what direction actually made
 *   sense for it). Because only `rotation.y` is ever touched, the post
 *   itself can never tip away from vertical. */
async function scatterTrackFurniture(group: THREE.Group, track: TrackParams): Promise<void> {
  const { cx, cy } = trackCentre(track);
  const centre: Point2D = { x: cx, y: cy };
  const { start, end } = arcAngles(track);
  const direction = track.direction === "left" ? 1 : -1;

  const [barrierSize, postSize] = await Promise.all([
    measureFittedSize(ASSET_PATHS.barrier, BARRIER_SPEC, BARRIER_FALLBACK_SIZE),
    measureFittedSize(ASSET_PATHS.post, POST_SPEC, POST_FALLBACK_SIZE),
  ]);

  const barrierRadius = track.radius + ROAD_HALF_WIDTH + KERB_WIDTH_METERS + BARRIER_KERB_GAP_METERS;
  const postRadius = track.radius + ROAD_HALF_WIDTH + KERB_WIDTH_METERS + POST_KERB_GAP_METERS;

  const barrierSpacingMeters = barrierSize.x + BARRIER_GAP_METERS;
  const postSpacingMeters = postSize.y * POST_SPACING_TO_HEIGHT_RATIO;
  const barrierStep = barrierSpacingMeters / track.radius;
  const postStep = postSpacingMeters / track.radius;

  const promises: Promise<THREE.Vector3 | null>[] = [];

  for (let theta = start; direction > 0 ? theta <= end : theta >= end; theta += direction * barrierStep) {
    // Tangent heading: derivative of (cx + r*cos(theta), cy + r*sin(theta))
    // with respect to signed progress is (-sin, cos) scaled by `direction`;
    // its heading angle is theta + direction*(pi/2) — see coordinates.ts's
    // own derivation-by-comment convention for why this is spelled out
    // rather than left as a bare formula.
    const tangentHeadingSim = theta + direction * (Math.PI / 2);
    promises.push(placeInstance(group, ASSET_PATHS.barrier, BARRIER_SPEC, pointOnArc(centre, barrierRadius, theta), tangentHeadingSim));
  }
  for (let theta = start; direction > 0 ? theta <= end : theta >= end; theta += direction * postStep) {
    const postPosition = pointOnArc(centre, postRadius, theta);
    // Heading from the post's own position toward the arc's centre of
    // curvature, in sim space — fed through localAxisHeadingToWorldRotationY
    // with the post's confirmed "+z" lamp-arm axis, this makes the arm point
    // radially inward at the road, matching how a real roadside light angles
    // its head over the carriageway rather than out into the field.
    const towardCentreHeadingSim = Math.atan2(centre.y - postPosition.y, centre.x - postPosition.x);
    promises.push(placeInstance(group, ASSET_PATHS.post, POST_SPEC, postPosition, towardCentreHeadingSim));
  }

  await Promise.all(promises);
}

/** A small, fixed "gate" of pylon markers at each end of the track, on the
 * inner kerb — resolves pylon.glb's previous contradictory state (declared
 * in ASSET_PATHS, documented, but never placed by anything). Two per end
 * rather than scattered throughout: enough to read as a deliberate marker,
 * not so many that a rotationally-near-symmetric cone shape becomes visual
 * noise. Placed at the track's own `start`/`end` angles, which coincide
 * with (or sit immediately next to) the run's actual start position (see
 * arcAngles' doc comment: every track starts the car at world (0,0)) — an
 * unambiguous, always-early scale-reference object. */
function scatterPylonMarkers(group: THREE.Group, track: TrackParams): Promise<THREE.Vector3 | null>[] {
  const { cx, cy } = trackCentre(track);
  const centre: Point2D = { x: cx, y: cy };
  const { start, end } = arcAngles(track);
  const direction = track.direction === "left" ? 1 : -1;
  const innerRadius = Math.max(1, track.radius - ROAD_HALF_WIDTH - KERB_WIDTH_METERS - PYLON_INNER_GAP_METERS);
  const pairStep = PYLON_PAIR_SPACING_METERS / track.radius;

  const anchors = [
    { theta: start, headingSim: start + direction * (Math.PI / 2) },
    { theta: start + direction * pairStep, headingSim: start + direction * (Math.PI / 2) },
    { theta: end - direction * pairStep, headingSim: end + direction * (Math.PI / 2) },
    { theta: end, headingSim: end + direction * (Math.PI / 2) },
  ];

  return anchors.map(({ theta, headingSim }) => placeInstance(group, ASSET_PATHS.pylon, PYLON_SPEC, pointOnArc(centre, innerRadius, theta), headingSim));
}

/** Sparse trees/rocks scattered in the field beyond both kerbs, extending a
 * little past the track's own start/end so the scenery doesn't visibly stop
 * exactly at the corner's ends. Position/type/rotation/size-jitter all come
 * from one seeded RNG per track (see `createRng`), so the same track always
 * looks the same across runs/reloads — required for the scene to be a
 * stable backdrop rather than a random one that redecorates itself.
 *
 * Each instance's size comes from its own type's `AssetPlacementSpec`
 * (`FIELD_ASSETS`), not the single flat 0.85-1.35 multiplier this replaces
 * — that multiplier applied identically to a tree and a rock, so a "large"
 * rock at the top of its old range could end up bigger than a "small" tree
 * at the bottom of its own, which is exactly the "no scale hierarchy"
 * complaint this fixes. A deterministic ±10% jitter is layered on top of
 * each type's own target, for natural-looking variation without losing the
 * per-type hierarchy. Heading is full-circle random — none of these assets
 * are directional the way the barrier/post are, so no local axis needs to
 * be respected for orientation, only for the (irrelevant) parameter
 * `localAxisHeadingToWorldRotationY` still requires. */
function scatterField(group: THREE.Group, track: TrackParams, rng: () => number): Promise<THREE.Vector3 | null>[] {
  const { cx, cy } = trackCentre(track);
  const centre: Point2D = { x: cx, y: cy };
  const { start, end } = arcAngles(track);
  const angleMin = Math.min(start, end) - FIELD_ANGLE_MARGIN_RADIANS;
  const angleMax = Math.max(start, end) + FIELD_ANGLE_MARGIN_RADIANS;

  const promises: Promise<THREE.Vector3 | null>[] = [];
  for (let i = 0; i < FIELD_PROP_COUNT; i++) {
    const angle = angleMin + rng() * (angleMax - angleMin);
    const side = rng() < 0.5 ? -1 : 1;
    const offset = FIELD_MIN_OFFSET_METERS + rng() * (FIELD_MAX_OFFSET_METERS - FIELD_MIN_OFFSET_METERS);
    const radius = track.radius + side * (ROAD_HALF_WIDTH + KERB_WIDTH_METERS + offset);
    const position = pointOnArc(centre, Math.max(1, radius), angle);
    const headingSim = rng() * Math.PI * 2;
    const asset = pickWeighted(rng);
    const jitter = 1 + (rng() * 2 - 1) * FIELD_SCALE_JITTER_FRACTION;
    const jitteredSpec: AssetPlacementSpec = { ...asset.spec, targetMeters: asset.spec.targetMeters * jitter };
    promises.push(placeInstance(group, asset.url, jitteredSpec, position, headingSim));
  }
  return promises;
}

/** Deterministic trackside/field scenery for the given track, as a group
 * that resolves once every scattered asset has loaded. Track-shaped (unlike
 * `buildStaticEnvironment`), so `scene.ts` rebuilds and swaps this group in
 * whenever the visitor picks a different track — disposing the previous
 * one's cloned instances first. */
export async function buildScenery(track: TrackParams): Promise<THREE.Group> {
  const group = new THREE.Group();
  group.name = "scenery";
  const rng = createRng(seedForTrack(track));
  await Promise.all([...scatterField(group, track, rng), ...scatterPylonMarkers(group, track), scatterTrackFurniture(group, track)]);
  return group;
}
