import * as THREE from "three";
import type { TrackParams } from "../simulation/index.ts";
import { trackCentre } from "../simulation/track.ts";
import { simToWorld } from "./coordinates.ts";
import { createFinishMarkerMaterial, createKerbMaterial, createReferenceLineMaterial, createRoadMaterial } from "./materials.ts";

// Sim-space (x, y) point on the ground plane, before the coordinates.ts
// world mapping is applied — kept distinct from coordinates.ts's WorldXZ so
// a caller can never accidentally feed a post-mapped point back into
// pointOnArc/trackCentre.
export interface Point2D {
  x: number;
  y: number;
}

// Exported so environment.ts can place trackside scenery relative to the
// same road edges this module draws, instead of duplicating (and risking
// drifting from) these numbers.
export const ROAD_HALF_WIDTH = 7; // m, matches the previous 2D scene's road width
export const KERB_WIDTH_METERS = 1.2;
const REFERENCE_LINE_HALF_WIDTH = 0.15;
const FINISH_MARKER_DEPTH_METERS = 1.5;

// Now that the whole arc is built once as static geometry (not a sliding
// per-frame draw window sampled on a world-fixed grid, as the old 2D
// scene.ts needed to avoid banding flicker — see CLAUDE.md), the sample
// spacing is purely a visual-fidelity knob: how closely the ribbon follows
// the true arc vs. a polygon approximation. It also sets the kerb/reference
// dash period.
const ARC_SAMPLE_STEP_METERS = 4;

// Small upward offsets (metres) so kerb/reference/finish geometry never
// shares an exact y with the road plane beneath it — coplanar triangles
// z-fight unpredictably depending on floating-point rounding and viewing
// angle, so each layer gets its own thin slice of headroom instead.
const ROAD_LIFT_METERS = 0;
const KERB_LIFT_METERS = 0.01;
const REFERENCE_LIFT_METERS = 0.02;
const FINISH_LIFT_METERS = 0.03;

/** The car's starting angle (relative to a track's centre of curvature) and
 * the angle it sweeps toward as the run progresses — see `sweptAngleRate`
 * (track.ts), ported unchanged from the previous 2D scene.ts. Every track
 * starts the car at world (0, 0) heading +x, so a "right" track's centre
 * sits below the start point (angle +pi/2 from the start point) and a
 * "left" track's centre sits above it (angle -pi/2); sweeping toward the
 * track's own `sweepAngle` moves that angle clockwise for "right" and
 * counterclockwise for "left" — mirrored, per track.ts's direction
 * convention. */
export function arcAngles(track: TrackParams): { start: number; end: number } {
  const start = track.direction === "left" ? -Math.PI / 2 : Math.PI / 2;
  const end = track.direction === "left" ? start + track.sweepAngle : start - track.sweepAngle;
  return { start, end };
}

export function pointOnArc(centre: Point2D, radius: number, angle: number): Point2D {
  return { x: centre.x + radius * Math.cos(angle), y: centre.y + radius * Math.sin(angle) };
}

/** Evenly spaced angles from a track's `start` to its `end` (inclusive of
 * both), roughly `stepMeters` apart along the arc — evenly dividing into a
 * whole number of steps rather than a fixed-size stride with a short final
 * step, since (unlike the old sliding draw window) this only ever runs once
 * per track to build static geometry, so exact evenness costs nothing and
 * guarantees the sampled arc always reaches its true endpoints. */
export function sampleArcAngles(track: TrackParams, stepMeters: number): number[] {
  const { start, end } = arcAngles(track);
  const dTheta = stepMeters / track.radius;
  const steps = Math.max(1, Math.round(track.sweepAngle / dTheta));
  const angles: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    angles.push(start + (end - start) * t);
  }
  return angles;
}

interface Edge {
  inner: Point2D;
  outer: Point2D;
}

/** One ribbon segment between two sampled edges as six non-indexed
 * vertices (two triangles) — deliberately not shared/indexed with its
 * neighbours, so kerb/reference-dash meshes (built from alternating
 * segments only) can have a hard colour boundary at every segment edge
 * without a shared vertex forcing a colour blend across it. Winding
 * (innerA, outerA, outerB) then (innerA, outerB, innerB) is chosen so the
 * geometric normal from that winding already points +Y — verified by hand
 * for a segment running along +worldX: cross((outerA-innerA), (outerB-innerA))
 * = (0, +, 0) — matching the explicit (0,1,0) normal attribute set below,
 * so the two never disagree about which side is "up". */
function buildSegmentGeometry(a: Edge, b: Edge, liftY: number): THREE.BufferGeometry {
  const innerA = simToWorld(a.inner.x, a.inner.y);
  const outerA = simToWorld(a.outer.x, a.outer.y);
  const innerB = simToWorld(b.inner.x, b.inner.y);
  const outerB = simToWorld(b.outer.x, b.outer.y);

  // biome-ignore format: one 3D point per line reads clearer here than prettier's wrap
  const positions = new Float32Array([
    innerA.x, liftY, innerA.z,
    outerA.x, liftY, outerA.z,
    outerB.x, liftY, outerB.z,
    innerA.x, liftY, innerA.z,
    outerB.x, liftY, outerB.z,
    innerB.x, liftY, innerB.z,
  ]);
  const normals = new Float32Array(18);
  for (let i = 1; i < 18; i += 3) normals[i] = 1;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  return geometry;
}

/** Concatenates same-shaped non-indexed BufferGeometries (position + normal
 * only — everything this module builds) into one, so a whole ribbon or a
 * filtered subset of it (alternating kerb bands, dashed reference line)
 * becomes a single draw call instead of one mesh per short segment. */
function concatGeometries(geometries: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let vertexCount = 0;
  for (const geometry of geometries) vertexCount += geometry.getAttribute("position").count;

  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  let offset = 0;
  for (const geometry of geometries) {
    const position = geometry.getAttribute("position") as THREE.BufferAttribute;
    const normal = geometry.getAttribute("normal") as THREE.BufferAttribute;
    positions.set(position.array as Float32Array, offset * 3);
    normals.set(normal.array as Float32Array, offset * 3);
    offset += position.count;
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  merged.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  return merged;
}

function buildRibbonGeometry(edges: Edge[], liftY: number): THREE.BufferGeometry {
  const segments: THREE.BufferGeometry[] = [];
  for (let i = 0; i < edges.length - 1; i++) segments.push(buildSegmentGeometry(edges[i], edges[i + 1], liftY));
  return concatGeometries(segments);
}

/** Every other segment, so the result reads as an alternating band (kerb) —
 * `light` selects which parity this mesh covers; call twice (true/false)
 * with the matching pair of `createKerbMaterial` colours to get the full
 * banded strip as two meshes. */
function buildAlternatingMesh(edges: Edge[], liftY: number, light: boolean): THREE.Mesh {
  const segments: THREE.BufferGeometry[] = [];
  for (let i = 0; i < edges.length - 1; i++) {
    if ((i % 2 === 0) !== light) continue;
    segments.push(buildSegmentGeometry(edges[i], edges[i + 1], liftY));
  }
  return new THREE.Mesh(concatGeometries(segments), createKerbMaterial(light));
}

/** Only even-indexed segments, so the reference line reads as a dashed
 * centreline rather than a solid one — the same cadence the old 2D scene's
 * `k % 2 === 0` band-drawing used, now an actual gap instead of a colour
 * alternation since there's no more per-frame redraw to alternate. */
function buildDashedMesh(edges: Edge[], liftY: number): THREE.Mesh {
  const segments: THREE.BufferGeometry[] = [];
  for (let i = 0; i < edges.length - 1; i++) {
    if (i % 2 !== 0) continue;
    segments.push(buildSegmentGeometry(edges[i], edges[i + 1], liftY));
  }
  return new THREE.Mesh(concatGeometries(segments), createReferenceLineMaterial());
}

/** Builds the full static track geometry (road, banded kerbs on both edges,
 * a dashed reference line, and a finish-marker bar at the track's swept
 * end) as one THREE.Group, positioned via `coordinates.ts`'s sim-to-world
 * mapping. Built once per track selection, not resampled per frame — unlike
 * the old 2D scene, real frustum culling + fog (environment.ts) handle
 * draw-distance now, so there is no bounded draw window to keep in sync. */
export function buildTrackGeometry(track: TrackParams): THREE.Group {
  const { cx, cy } = trackCentre(track);
  const centre: Point2D = { x: cx, y: cy };
  const angles = sampleArcAngles(track, ARC_SAMPLE_STEP_METERS);

  const roadEdges: Edge[] = angles.map((angle) => ({
    inner: pointOnArc(centre, track.radius - ROAD_HALF_WIDTH, angle),
    outer: pointOnArc(centre, track.radius + ROAD_HALF_WIDTH, angle),
  }));
  const kerbInnerEdges: Edge[] = angles.map((angle) => ({
    inner: pointOnArc(centre, track.radius - ROAD_HALF_WIDTH - KERB_WIDTH_METERS, angle),
    outer: pointOnArc(centre, track.radius - ROAD_HALF_WIDTH, angle),
  }));
  const kerbOuterEdges: Edge[] = angles.map((angle) => ({
    inner: pointOnArc(centre, track.radius + ROAD_HALF_WIDTH, angle),
    outer: pointOnArc(centre, track.radius + ROAD_HALF_WIDTH + KERB_WIDTH_METERS, angle),
  }));
  const referenceEdges: Edge[] = angles.map((angle) => ({
    inner: pointOnArc(centre, track.radius - REFERENCE_LINE_HALF_WIDTH, angle),
    outer: pointOnArc(centre, track.radius + REFERENCE_LINE_HALF_WIDTH, angle),
  }));

  const group = new THREE.Group();
  group.name = "track";

  const road = new THREE.Mesh(buildRibbonGeometry(roadEdges, ROAD_LIFT_METERS), createRoadMaterial());
  road.receiveShadow = true;
  group.add(road);

  group.add(buildAlternatingMesh(kerbInnerEdges, KERB_LIFT_METERS, true));
  group.add(buildAlternatingMesh(kerbInnerEdges, KERB_LIFT_METERS, false));
  group.add(buildAlternatingMesh(kerbOuterEdges, KERB_LIFT_METERS, true));
  group.add(buildAlternatingMesh(kerbOuterEdges, KERB_LIFT_METERS, false));

  group.add(buildDashedMesh(referenceEdges, REFERENCE_LIFT_METERS));

  const { end } = arcAngles(track);
  const direction = track.direction === "left" ? 1 : -1;
  const finishBackAngle = end - direction * (FINISH_MARKER_DEPTH_METERS / track.radius);
  const finishOuterRadius = track.radius + ROAD_HALF_WIDTH + KERB_WIDTH_METERS;
  const finishInnerRadius = track.radius - ROAD_HALF_WIDTH - KERB_WIDTH_METERS;
  const finishMarker = new THREE.Mesh(
    buildSegmentGeometry(
      { inner: pointOnArc(centre, finishInnerRadius, finishBackAngle), outer: pointOnArc(centre, finishOuterRadius, finishBackAngle) },
      { inner: pointOnArc(centre, finishInnerRadius, end), outer: pointOnArc(centre, finishOuterRadius, end) },
      FINISH_LIFT_METERS,
    ),
    createFinishMarkerMaterial(),
  );
  group.add(finishMarker);

  return group;
}
