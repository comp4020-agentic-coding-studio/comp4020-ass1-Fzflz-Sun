/** Per-layer instance counts for one build of `buildScenery` — replaces the
 * old single `FIELD_PROP_COUNT = 22` now that scenery is four distinct
 * layers rather than one uniform scatter. `landmarks` stays fixed between
 * the full and mobile profiles: landmarks are the semantic payoff (grandstand/
 * pits/gantry/billboard/flag), not filler, so density reduction targets
 * foliage instance counts only, per the "reduce density, not layering"
 * instruction this plan follows. */
export interface SceneryDensity {
  tracksideClusters: number;
  midgroundClusters: number;
  landmarks: number;
  distantClusters: number;
}

export const SCENERY_DENSITY: SceneryDensity = { tracksideClusters: 14, midgroundClusters: 10, landmarks: 5, distantClusters: 9 };
export const SCENERY_DENSITY_MOBILE: SceneryDensity = { tracksideClusters: 9, midgroundClusters: 6, landmarks: 5, distantClusters: 5 };

// A single width breakpoint, matching neither marking viewport exactly
// (1920 desktop / 390 phone) but sitting between them — same convention as
// `controller.ts`'s `prefers-reduced-motion` check: a `matchMedia` query read
// once at scene-build time, not polled per frame.
const MOBILE_MAX_WIDTH_PX = 768;

export function isMobileViewport(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia(`(max-width: ${MOBILE_MAX_WIDTH_PX}px)`).matches;
}

export function currentSceneryDensity(): SceneryDensity {
  return isMobileViewport() ? SCENERY_DENSITY_MOBILE : SCENERY_DENSITY;
}
