import * as THREE from "three";
import { TRACK_PRESETS } from "../../simulation/constants.ts";
import { trackCentre } from "../../simulation/track.ts";
import { createGroundMaterial, GROUND_COLOR } from "../materials.ts";
import { arcAngles, KERB_WIDTH_METERS, ROAD_HALF_WIDTH } from "../track-geometry.ts";
import { valueNoise2D } from "./scatter-utils.ts";

export const GROUND_RADIUS_METERS = 400;

// Radial/angular subdivision fine enough for per-vertex colour/height
// variation to read as organic mottling rather than banding — `RingGeometry`
// (not `CircleGeometry`, the previous shape) is what gives radial
// subdivision (`phiSegments`) at all; `CircleGeometry` only has one ring of
// internal vertices, which can't carry any noise pattern across the ground's
// interior.
const GROUND_THETA_SEGMENTS = 64;
const GROUND_PHI_SEGMENTS = 40;
// A hairline non-zero inner radius avoids a degenerate single-point centre
// vertex fan, which can produce a visible pinch in vertex-colour and normal
// interpolation right at the origin.
const GROUND_INNER_RADIUS_METERS = 0.01;

const GROUND_NOISE_SEED = 4177;
// Fine, low-amplitude mottling applied everywhere (on- and off-road alike) —
// a subtle darker/lighter variation so the ground never reads as one
// perfectly flat, untextured colour, without being strong enough to look
// like a deliberate patch.
const BASE_NOISE_SCALE = 0.09;
const BASE_VARIATION_STRENGTH = 0.12;

// Off-road patch colouring: three deterministic bands over one noise value,
// standing in for "grass/flower/bush patches" via vertex colour rather than
// scattered 1x1 GLB ground-tile props (mini-forest's own `patch-grass`/
// `patch-dirt` tiles are flat 1-unit squares that would tile visibly at
// GROUND_RADIUS_METERS scale — a deliberate judgment call documented in the
// completion report, not an oversight).
const PATCH_NOISE_SCALE = 0.035;
const GRASS_PATCH_THRESHOLD = 0.55;
const BUSH_PATCH_THRESHOLD = 0.75;
const FLOWER_PATCH_THRESHOLD = 0.88;
const GRASS_PATCH_COLOR = "#4f7a44";
const BUSH_PATCH_COLOR = "#33482f";
const FLOWER_PATCH_COLOR = "#7a5a68";
const PATCH_BLEND_STRENGTH = 0.55;

// Optional low mounds — sparser than colour patches (higher threshold),
// amplitude-limited, and (like patches) only ever placed where
// `isNearAnyTrackRoad` is false, so they can never rise up across any
// track's own corridor.
const MOUND_NOISE_SCALE = 0.02;
const MOUND_THRESHOLD = 0.82;
const MOUND_MAX_HEIGHT_METERS = 0.6;

// Extra clearance beyond the kerb/barrier line itself before ground
// decoration (colour patch or mound) may appear — decoration must stay
// clear of the barrier's own footprint, not just the road surface.
const GROUND_DECORATION_MARGIN_METERS = 2.5;
const GROUND_DECORATION_ANGLE_MARGIN_RADIANS = 0.35;

/** True if (simX, simY) falls within any `TRACK_PRESETS` entry's own road
 * corridor (kerb + barrier + margin, angularly bounded by that track's own
 * arc + margin) — checked against every preset, not just the currently
 * selected one, because the ground is built once inside
 * `buildStaticEnvironment` and never rebuilt on track switch. Ground
 * decoration must therefore stay clear of all four tracks' corridors
 * simultaneously, or switching tracks could reveal a colour patch or mound
 * sitting on what is now an active road. */
export function isNearAnyTrackRoad(simX: number, simY: number): boolean {
  const radialMargin = ROAD_HALF_WIDTH + KERB_WIDTH_METERS + GROUND_DECORATION_MARGIN_METERS;
  for (const track of Object.values(TRACK_PRESETS)) {
    const { cx, cy } = trackCentre(track);
    const dx = simX - cx;
    const dy = simY - cy;
    const r = Math.hypot(dx, dy);
    if (r < track.radius - radialMargin || r > track.radius + radialMargin) continue;

    const theta = Math.atan2(dy, dx);
    const { start, end } = arcAngles(track);
    const lo = Math.min(start, end) - GROUND_DECORATION_ANGLE_MARGIN_RADIANS;
    const hi = Math.max(start, end) + GROUND_DECORATION_ANGLE_MARGIN_RADIANS;
    const twoPi = Math.PI * 2;
    const normalized = lo + (((theta - lo) % twoPi) + twoPi) % twoPi;
    if (normalized <= hi) return true;
  }
  return false;
}

/** Flat (physics-relevant) ground plane — same footprint/radius as before,
 * rebuilt on `RingGeometry` (not `CircleGeometry`) purely for its radial
 * subdivision, with a per-vertex colour computed once at build time from a
 * deterministic 2D value-noise field (never a per-frame shader, never
 * `Math.random()` — CLAUDE.md's determinism discipline applied to cosmetic
 * geometry the same as scatter placement is). Physics never reads this
 * mesh — the simulation's own flat ground stays untouched in
 * `src/simulation/` — so raising a handful of vertices for mounds here has
 * no effect on collision/driving behaviour.
 *
 * Before the geometry's own `rotateX(-Math.PI / 2)` call, `RingGeometry`'s
 * native (pre-rotation) local X/Y plane already corresponds 1:1 to
 * (simX, simY) — the same convention `coordinates.ts`'s `simToWorld` uses —
 * and pre-rotation local Z becomes world Y (height) once rotated. Every
 * per-vertex computation below therefore reads/writes the position
 * attribute *before* the rotation call, using its raw x/y as sim-space
 * coordinates directly. */
export function buildGround(): THREE.Mesh {
  const geometry = new THREE.RingGeometry(GROUND_INNER_RADIUS_METERS, GROUND_RADIUS_METERS, GROUND_THETA_SEGMENTS, GROUND_PHI_SEGMENTS);
  const position = geometry.getAttribute("position") as THREE.BufferAttribute;
  const colors = new Float32Array(position.count * 3);
  const base = new THREE.Color(GROUND_COLOR);
  const grass = new THREE.Color(GRASS_PATCH_COLOR);
  const bush = new THREE.Color(BUSH_PATCH_COLOR);
  const flower = new THREE.Color(FLOWER_PATCH_COLOR);

  for (let i = 0; i < position.count; i++) {
    const simX = position.getX(i);
    const simY = position.getY(i);
    const nearRoad = isNearAnyTrackRoad(simX, simY);

    const color = base.clone();
    const baseVariation = (valueNoise2D(simX * BASE_NOISE_SCALE, simY * BASE_NOISE_SCALE, GROUND_NOISE_SEED) - 0.5) * 2;
    color.offsetHSL(0, 0, baseVariation * BASE_VARIATION_STRENGTH * 0.5);

    let moundHeight = 0;
    if (!nearRoad) {
      const patchNoise = valueNoise2D(simX * PATCH_NOISE_SCALE, simY * PATCH_NOISE_SCALE, GROUND_NOISE_SEED + 1);
      if (patchNoise >= FLOWER_PATCH_THRESHOLD) {
        color.lerp(flower, PATCH_BLEND_STRENGTH * 0.6);
      } else if (patchNoise >= BUSH_PATCH_THRESHOLD) {
        color.lerp(bush, PATCH_BLEND_STRENGTH);
      } else if (patchNoise >= GRASS_PATCH_THRESHOLD) {
        color.lerp(grass, PATCH_BLEND_STRENGTH);
      }

      const moundNoise = valueNoise2D(simX * MOUND_NOISE_SCALE, simY * MOUND_NOISE_SCALE, GROUND_NOISE_SEED + 2);
      if (moundNoise > MOUND_THRESHOLD) {
        moundHeight = ((moundNoise - MOUND_THRESHOLD) / (1 - MOUND_THRESHOLD)) * MOUND_MAX_HEIGHT_METERS;
      }
    }

    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
    position.setZ(i, moundHeight);
  }

  position.needsUpdate = true;
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.rotateX(-Math.PI / 2);
  geometry.computeVertexNormals();

  const ground = new THREE.Mesh(geometry, createGroundMaterial());
  ground.name = "ground";
  ground.receiveShadow = true;
  return ground;
}
