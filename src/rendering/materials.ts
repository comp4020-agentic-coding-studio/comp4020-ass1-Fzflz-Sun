import * as THREE from "three";

// Shared dusk palette. FRONT_COLOR/REAR_COLOR/DANGER_COLOR must stay
// pixel-identical to main.css's --color-front/--color-rear/--color-danger
// (CLAUDE.md: axle colours are fixed everywhere) — kept in sync by this
// comment, the same convention the previous 2D renderer's car.ts used.
// Every other constant here is new for the 3D scene and has no CSS
// counterpart (nothing in the DOM currently draws sky/ground/road colour).
export const FRONT_COLOR = "#4fd3e6";
export const REAR_COLOR = "#d99a4e";
export const DANGER_COLOR = "#ff6b57";

export const SKY_TOP_COLOR = "#0c0f18";
export const SKY_HORIZON_COLOR = "#5b6472";
// GROUND_COLOR/ROAD_COLOR lightened from #232a24/#2c3038, then #2b332c/
// #343a44, then #333d35/#404652, in the same brightening pass as
// environment.ts's light-intensity constants — a pixel-level measurement of
// the chase-cam's darkest region (the foreground road/ground inside the
// car's own cast shadow) showed each of those still under 5% brightness, so
// this pass lightens the base albedo itself rather than relying on
// light-intensity/exposure alone to lift a very dark starting colour.
// Verified by the same measurement that the road/kerb boundary and the
// ground/road boundary both stay clearly distinguishable at dusk, not
// washed toward one flat tone.
export const GROUND_COLOR = "#3d4a3f";
export const ROAD_COLOR = "#4c5360"; // charcoal — deliberately never pure black
export const KERB_LIGHT_COLOR = "#dfdccf"; // off-white
export const KERB_DARK_COLOR = "#5b6270"; // muted slate — replaces the old red/white racing-kerb banding
export const REFERENCE_LINE_COLOR = "#dfdccf";
export const FINISH_MARKER_COLOR = "#f2efe8";

function hexToThreeColor(hex: string): THREE.Color {
  return new THREE.Color(hex);
}

/** Lerps `base` toward the shared danger accent as an axle saturates —
 * ported from the previous renderer's car.ts `wheelColor` (same `t` curve:
 * grows past saturation onset rather than snapping instantly), now producing
 * a THREE.Color for a material assignment instead of a CSS colour string.
 * Callers apply this via `.emissive`, not `.color` — see
 * `WHEEL_TINT_EMISSIVE_INTENSITY` below for why. */
export function wheelColor(base: string, utilisation: number, saturated: boolean): THREE.Color {
  const t = saturated ? Math.min(1, (utilisation - 1) * 2 + 0.4) : 0;
  const color = hexToThreeColor(base);
  if (t <= 0) return color;
  return color.lerp(hexToThreeColor(DANGER_COLOR), t);
}

// Wheel axle-utilisation tinting (vehicle.ts) is applied via
// `.emissive.copy(wheelColor(...))` at this intensity, never via
// `.color.copy(...)` — confirmed by a side-by-side screenshot comparison
// (both loading the real wheel mesh/atlas texture under identical lighting)
// that `.color.copy()` multiplies the wheel's shared atlas texture by the
// tint, which for a fully-saturated accent colour crushes the tyre/rim's own
// texture detail into a flat, low-variance disc (measured std ≈ 11/31/41 per
// channel) — the "toy-like" look this constant's approach avoids.
// `.emissive` instead adds the accent additively on top of the untouched
// base map, keeping far more of the atlas's own tonal structure visible
// (std ≈ 37/42/46 in the same comparison) while still giving the axle-colour
// legend CLAUDE.md requires ("axle colours fixed and consistent everywhere
// they appear"). Intensity is deliberately well under 1: strong enough to
// read as a colour cast at normal viewing distance, not so strong it washes
// the wheel out to near-white.
export const WHEEL_TINT_EMISSIVE_INTENSITY = 0.45;

export function createRoadMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: ROAD_COLOR, roughness: 0.95, metalness: 0 });
}

export function createKerbMaterial(light: boolean): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: light ? KERB_LIGHT_COLOR : KERB_DARK_COLOR,
    roughness: 0.9,
    metalness: 0,
  });
}

export function createReferenceLineMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: REFERENCE_LINE_COLOR, roughness: 0.9, metalness: 0 });
}

export function createFinishMarkerMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: FINISH_MARKER_COLOR, roughness: 0.9, metalness: 0 });
}

export function createGroundMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: GROUND_COLOR, roughness: 1, metalness: 0 });
}
