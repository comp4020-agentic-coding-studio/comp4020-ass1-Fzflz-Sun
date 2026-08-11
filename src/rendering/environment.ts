import * as THREE from "three";
import { TRACK_PRESETS } from "../simulation/constants.ts";
import type { TrackParams } from "../simulation/index.ts";
import { trackCentre } from "../simulation/track.ts";
import { ASSET_PATHS, loadAsset } from "./asset-loader.ts";
import { headingToWorldRotationY, simToWorld } from "./coordinates.ts";
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
const HEMI_INTENSITY = 0.55;
const AMBIENT_COLOR = "#3a4250";
const AMBIENT_INTENSITY = 0.25;

const SHADOW_MAP_SIZE = 2048;

const MAX_TRACK_RADIUS_METERS = Math.max(...Object.values(TRACK_PRESETS).map((track) => track.radius));

const BARRIER_INTERVAL_METERS = 14;
const POST_INTERVAL_METERS = 28;
const FIELD_PROP_COUNT = 22;
const FIELD_MIN_OFFSET_METERS = 6;
const FIELD_MAX_OFFSET_METERS = 45;
const FIELD_ANGLE_MARGIN_RADIANS = 0.35;

const FIELD_ASSETS = [
  { url: ASSET_PATHS.treeDefault, weight: 3 },
  { url: ASSET_PATHS.treePine, weight: 3 },
  { url: ASSET_PATHS.treeDetailed, weight: 2 },
  { url: ASSET_PATHS.rockLarge, weight: 1 },
  { url: ASSET_PATHS.rockSmall, weight: 2 },
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

async function placeInstance(target: THREE.Object3D, url: string, position: Point2D, headingSim: number, scale: number): Promise<void> {
  const instance = await loadAsset(url);
  const world = simToWorld(position.x, position.y);
  instance.position.set(world.x, 0, world.z);
  instance.rotation.y = headingToWorldRotationY(headingSim);
  instance.scale.setScalar(scale);
  enableShadows(instance);
  target.add(instance);
}

/** Sparse trackside furniture (barriers, posts) anchored to the outer kerb
 * at fixed metre intervals — a real spacing, not "one per sample", so
 * changing the arc's sampling density (track-geometry.ts) doesn't silently
 * change how many barriers appear. Orientation follows the arc's own
 * tangent (see the derivation comment below) so barriers read as running
 * alongside the road rather than facing an arbitrary direction. */
function scatterTrackFurniture(group: THREE.Group, track: TrackParams): Promise<void>[] {
  const { cx, cy } = trackCentre(track);
  const centre: Point2D = { x: cx, y: cy };
  const { start, end } = arcAngles(track);
  const direction = track.direction === "left" ? 1 : -1;
  const barrierRadius = track.radius + ROAD_HALF_WIDTH + KERB_WIDTH_METERS + 0.6;
  const postRadius = track.radius + ROAD_HALF_WIDTH + KERB_WIDTH_METERS + 2.2;

  const promises: Promise<void>[] = [];
  const barrierStep = BARRIER_INTERVAL_METERS / track.radius;
  const postStep = POST_INTERVAL_METERS / track.radius;

  for (let theta = start; direction > 0 ? theta <= end : theta >= end; theta += direction * barrierStep) {
    // Tangent heading: derivative of (cx + r*cos(theta), cy + r*sin(theta))
    // with respect to signed progress is (-sin, cos) scaled by `direction`;
    // its heading angle is theta + direction*(pi/2) — see coordinates.ts's
    // own derivation-by-comment convention for why this is spelled out
    // rather than left as a bare formula.
    const headingSim = theta + direction * (Math.PI / 2);
    promises.push(placeInstance(group, ASSET_PATHS.barrier, pointOnArc(centre, barrierRadius, theta), headingSim, 1));
  }
  for (let theta = start; direction > 0 ? theta <= end : theta >= end; theta += direction * postStep) {
    const headingSim = theta + direction * (Math.PI / 2);
    promises.push(placeInstance(group, ASSET_PATHS.post, pointOnArc(centre, postRadius, theta), headingSim, 1));
  }
  return promises;
}

/** Sparse trees/rocks scattered in the field beyond both kerbs, extending a
 * little past the track's own start/end so the scenery doesn't visibly stop
 * exactly at the corner's ends. Position/type/rotation/scale all come from
 * one seeded RNG per track (see `createRng`), so the same track always
 * looks the same across runs/reloads — required for the scene to be a
 * stable backdrop rather than a random one that redecorates itself. */
function scatterField(group: THREE.Group, track: TrackParams, rng: () => number): Promise<void>[] {
  const { cx, cy } = trackCentre(track);
  const centre: Point2D = { x: cx, y: cy };
  const { start, end } = arcAngles(track);
  const angleMin = Math.min(start, end) - FIELD_ANGLE_MARGIN_RADIANS;
  const angleMax = Math.max(start, end) + FIELD_ANGLE_MARGIN_RADIANS;

  const promises: Promise<void>[] = [];
  for (let i = 0; i < FIELD_PROP_COUNT; i++) {
    const angle = angleMin + rng() * (angleMax - angleMin);
    const side = rng() < 0.5 ? -1 : 1;
    const offset = FIELD_MIN_OFFSET_METERS + rng() * (FIELD_MAX_OFFSET_METERS - FIELD_MIN_OFFSET_METERS);
    const radius = track.radius + side * (ROAD_HALF_WIDTH + KERB_WIDTH_METERS + offset);
    const position = pointOnArc(centre, Math.max(1, radius), angle);
    const headingSim = rng() * Math.PI * 2;
    const scale = 0.85 + rng() * 0.5;
    const asset = pickWeighted(rng);
    promises.push(placeInstance(group, asset.url, position, headingSim, scale));
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
  const promises = [...scatterTrackFurniture(group, track), ...scatterField(group, track, rng)];
  await Promise.all(promises);
  return group;
}
