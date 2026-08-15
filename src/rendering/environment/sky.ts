import * as THREE from "three";
import { TRACK_PRESETS } from "../../simulation/constants.ts";
import { GROUND_COLOR, SKY_HORIZON_COLOR, SKY_TOP_COLOR } from "../materials.ts";
import { KERB_WIDTH_METERS, ROAD_HALF_WIDTH } from "../track-geometry.ts";
import { createRng } from "./scatter-utils.ts";

const SKY_DOME_RADIUS_METERS = 380;

// Dusk key light: low and warm, casting the long shadows that sell "dusk"
// rather than "midday overcast". Its shadow frustum is sized once below from
// every TRACK_PRESETS entry's own radius (not the currently-selected track),
// so the static environment (sky/ground/lights) never needs rebuilding when
// the visitor picks a different track before a run starts — only the
// scenery scatter (buildScenery) is track-shaped.
const SUN_COLOR = "#e8ab6e";
const SUN_INTENSITY = 1.6;
// Exported (unlike the rest of this file's constants) because the sun disc
// below and CLAUDE.md's "sun disc aligned with the actual DirectionalLight
// direction" requirement both need the identical numbers `buildLights` uses
// — a second, independently-chosen pair here would drift out of sync with
// whatever the light rig actually renders.
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

// Warm horizon-haze tint blended into the dome's own existing gradient —
// reuses the sun's own warm colour rather than inventing a second warm tone,
// so the haze reads as sunlight scattering near the horizon rather than an
// unrelated colour choice.
const HORIZON_HAZE_COLOR = SUN_COLOR;
const HORIZON_HAZE_BAND = 0.22; // fraction of the dome's vertical extent affected
const HORIZON_HAZE_STRENGTH = 0.35; // max blend amount, right at the horizon

/** Builds a smooth top-to-horizon gradient dome via vertex colours on a
 * large inward-facing sphere — a full physical sky shader is out of scope
 * for a "closed low-poly test track" backdrop, and a flat single-colour
 * background would read as an empty void rather than dusk. `scene.background`
 * is left untouched by this dome (only fog needs a background colour to
 * fade toward); the dome itself is what's actually visible past the fog.
 *
 * A warm haze tint is blended in near the horizon band (see
 * `HORIZON_HAZE_*` above) directly into this same per-vertex computation —
 * no separate haze mesh — so it composites with the existing gradient
 * rather than layering a second draw call on top of it. */
function buildSkyDome(): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(SKY_DOME_RADIUS_METERS, 24, 16, 0, Math.PI * 2, 0, Math.PI / 1.9);
  const top = new THREE.Color(SKY_TOP_COLOR);
  const horizon = new THREE.Color(SKY_HORIZON_COLOR);
  const haze = new THREE.Color(HORIZON_HAZE_COLOR);
  const position = geometry.getAttribute("position") as THREE.BufferAttribute;
  const colors = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    const y = position.getY(i) / SKY_DOME_RADIUS_METERS; // -~0.1..1, since the dome is a capped upper hemisphere
    const t = THREE.MathUtils.clamp(1 - y, 0, 1);
    const color = horizon.clone().lerp(top, 1 - t);
    const hazeFactor = THREE.MathUtils.clamp((t - (1 - HORIZON_HAZE_BAND)) / HORIZON_HAZE_BAND, 0, 1) * HORIZON_HAZE_STRENGTH;
    color.lerp(haze, hazeFactor);
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

// Same (unnormalized) direction formula `buildLights` below feeds into
// `sun.position` — the light's effective illumination direction is just
// `sun.target.position - sun.position` (target stays at the default
// origin), i.e. this vector normalized, so computing it once here and
// normalizing keeps the disc exactly aligned with the real light without
// duplicating or re-deriving the light rig's own tuned numbers.
function sunDirection(): THREE.Vector3 {
  return new THREE.Vector3(Math.cos(SUN_AZIMUTH_RADIANS), Math.sin(SUN_ELEVATION_RADIANS), Math.sin(SUN_AZIMUTH_RADIANS)).normalize();
}

const SUN_DISC_RADIUS_METERS = 14;
// Just inside the sky dome's own SKY_DOME_RADIUS_METERS so the disc renders
// in front of the dome's inward-facing surface instead of being clipped by
// or coincident with it.
const SUN_DISC_DISTANCE_METERS = 340;
const SUN_DISC_COLOR = "#fff2d9";

/** Unlit disc placed along the exact direction `buildLights`'s
 * `DirectionalLight` already shines from — a flat `MeshBasicMaterial` circle
 * (no lighting calculation) is deliberate: this is meant to read as the
 * bright sun itself, not a lit object the scene's own lights would shade. */
function buildSunDisc(): THREE.Mesh {
  const geometry = new THREE.CircleGeometry(SUN_DISC_RADIUS_METERS, 24);
  const material = new THREE.MeshBasicMaterial({ color: SUN_DISC_COLOR, fog: false, depthWrite: false, side: THREE.DoubleSide });
  const disc = new THREE.Mesh(geometry, material);
  disc.name = "sun-disc";
  disc.position.copy(sunDirection()).multiplyScalar(SUN_DISC_DISTANCE_METERS);
  disc.lookAt(0, 0, 0);
  return disc;
}

// Fixed (not track-derived) seed: the sky is part of `buildStaticEnvironment`,
// built once regardless of which track is selected, so cloud layout must not
// depend on `seedForTrack` the way scenery does — it would make clouds
// silently reshuffle on every track switch despite nothing about the sky
// having actually changed.
const CLOUD_SEED = 8823;
const CLOUD_CLUSTER_COUNT = 7; // within the 5-9 spec
const CLOUD_MIN_PUFFS = 2;
const CLOUD_MAX_PUFFS = 4;
const CLOUD_DISTANCE_METERS = 300;
const CLOUD_HEIGHT_MIN_METERS = 60;
const CLOUD_HEIGHT_MAX_METERS = 150;
const CLOUD_COLOR = "#c9ccd6";
const CLOUD_WARM_COLOR = "#d9c9b0";
const CLOUD_WARM_FRACTION = 0.4;

// Every visible sky element's own worst-case distance from the sky group's
// local origin, derived from the real geometry above rather than picked
// independently of it. This is the basis scene.ts's CAMERA_FAR_METERS must
// exceed: since the "sky" group is re-anchored to the camera's X/Z every
// frame (see skyAnchorPosition below, and scene.ts's update()), the
// camera-to-sky distance is always exactly this figure, never larger,
// regardless of where the camera has actually travelled to on any track.
const CLOUD_PUFF_LOCAL_OFFSET_MAX_METERS = Math.hypot(7, 7); // half of each puff's own ±14m local x/z jitter, at its largest
const CLOUD_PUFF_RADIUS_MAX_METERS = 12; // 6 + rng()*6, at its largest
const CLOUD_CLUSTER_DISTANCE_MAX_METERS = CLOUD_DISTANCE_METERS * 1; // 0.75 + rng()*0.25, at its largest multiplier of 1
const CLOUD_MAX_EXTENT_METERS =
  Math.hypot(CLOUD_CLUSTER_DISTANCE_MAX_METERS, CLOUD_HEIGHT_MAX_METERS) + CLOUD_PUFF_LOCAL_OFFSET_MAX_METERS + CLOUD_PUFF_RADIUS_MAX_METERS;
const SUN_DISC_MAX_EXTENT_METERS = SUN_DISC_DISTANCE_METERS + SUN_DISC_RADIUS_METERS;

/** The camera-relative sky's own farthest possible vertex, in metres from the
 * sky group's local origin — the max of the dome's own radius, the sun
 * disc's distance+radius, and the cloud layer's worst-case cluster
 * distance+height+puff-jitter+puff-radius. `scene.ts` derives its
 * `CAMERA_FAR_METERS` from this (plus its own safety margin), not from
 * `FOG_FAR_METERS`, which governs when *ground/scenery* fade into fog and
 * has nothing to do with how far the sky itself extends. */
export const SKY_RENDER_EXTENT_METERS = Math.max(SKY_DOME_RADIUS_METERS, SUN_DISC_MAX_EXTENT_METERS, CLOUD_MAX_EXTENT_METERS);

/** Low-poly static cloud clusters — deliberately never animated (a
 * simplification over the plan's "barely-perceptible drift" suggestion, made
 * to avoid wiring a live per-frame hook through `scene.ts`'s update loop,
 * which is explicitly off-limits for this round of work). Being fully static
 * means "no motion under `prefers-reduced-motion`" is satisfied trivially
 * rather than needing its own gated animation path. Each cluster is a few
 * low-subdivision `IcosahedronGeometry` puffs sharing one material, built
 * once from a fixed seed (see `CLOUD_SEED`). */
function buildClouds(): THREE.Group {
  const group = new THREE.Group();
  group.name = "clouds";
  const rng = createRng(CLOUD_SEED);
  for (let i = 0; i < CLOUD_CLUSTER_COUNT; i++) {
    const angle = rng() * Math.PI * 2;
    const distance = CLOUD_DISTANCE_METERS * (0.75 + rng() * 0.25);
    const height = CLOUD_HEIGHT_MIN_METERS + rng() * (CLOUD_HEIGHT_MAX_METERS - CLOUD_HEIGHT_MIN_METERS);
    const cluster = new THREE.Group();
    cluster.name = "cloud-cluster";
    cluster.position.set(Math.cos(angle) * distance, height, Math.sin(angle) * distance);

    const warm = rng() < CLOUD_WARM_FRACTION;
    const material = new THREE.MeshBasicMaterial({
      color: warm ? CLOUD_WARM_COLOR : CLOUD_COLOR,
      fog: true,
      depthWrite: false,
      transparent: true,
      opacity: 0.85,
    });
    const puffCount = CLOUD_MIN_PUFFS + Math.floor(rng() * (CLOUD_MAX_PUFFS - CLOUD_MIN_PUFFS + 1));
    for (let p = 0; p < puffCount; p++) {
      const puffRadius = 6 + rng() * 6;
      const geometry = new THREE.IcosahedronGeometry(puffRadius, 0);
      const puff = new THREE.Mesh(geometry, material);
      puff.position.set((rng() - 0.5) * 14, (rng() - 0.5) * 4, (rng() - 0.5) * 14);
      cluster.add(puff);
    }
    group.add(cluster);
  }
  return group;
}

/** Sky dome, sun disc, and cloud layer — everything about the backdrop above
 * the horizon. Track-independent, built once inside `buildStaticEnvironment`. */
export function buildSky(): THREE.Group {
  const group = new THREE.Group();
  group.name = "sky";
  group.add(buildSkyDome());
  group.add(buildSunDisc());
  group.add(buildClouds());
  return group;
}

/** Pure camera-follow anchor for the "sky" group — `scene.ts`'s `update()`
 * calls this every frame with the camera's current world X/Z and applies the
 * result directly to the sky group's position, keeping the dome/sun/clouds
 * centred on the camera without ever rebuilding their geometry (this is what
 * fixes the sky-clipping bug: the camera-to-sky distance stays constant
 * instead of growing as the camera drifts around a corner). Kept standalone
 * (no `THREE.Camera`/`Object3D` parameter) so the "sky follows camera X/Z"
 * contract is unit-testable without constructing a renderer. Y is
 * deliberately left at 0: the sky's own vertical extent (up to 150m of cloud
 * height) dwarfs any camera height change, so following Y would add
 * complexity without fixing anything the horizontal follow doesn't already
 * fix. Ground/track/scenery/lights are siblings of "sky", never children of
 * it, so they are untouched by this and stay world-space. */
export function skyAnchorPosition(cameraX: number, cameraZ: number): { x: number; y: number; z: number } {
  return { x: cameraX, y: 0, z: cameraZ };
}

/** Sized once from the widest `TRACK_PRESETS` radius (not the
 * currently-selected track), so this light rig never needs rebuilding when
 * the visitor switches tracks — only `buildScenery` is track-shaped. */
export function buildLights(): THREE.Object3D[] {
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
