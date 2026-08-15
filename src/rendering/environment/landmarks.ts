import * as THREE from "three";
import type { TrackParams } from "../../simulation/index.ts";
import { trackCentre } from "../../simulation/track.ts";
import { arcAngles, KERB_WIDTH_METERS, type Point2D, pointOnArc, ROAD_HALF_WIDTH } from "../track-geometry.ts";
import { BILLBOARD, DISTANT_VAN, FLAG, GANTRY, GRANDSTAND_COVERED, GRANDSTAND_ROUND, PITS_GARAGE, PITS_GARAGE_CORNER, PITS_OFFICE } from "./asset-catalog.ts";
import { placeInstance } from "./placement.ts";

// Every landmark sits at (or beyond) this clearance past the kerb+barrier
// line, same "clear the barrier's own footprint" discipline as
// `ground.ts`'s decoration margin — landmarks are large, hand-placed set
// pieces, not part of the trackside/midground scatter, so they get their own
// constant rather than reusing either layer's band.
const LANDMARK_KERB_GAP_METERS = 20;

// Where along the arc each landmark sits, expressed as a fraction of the
// swept angle from `start` toward `end` (0 = start, 1 = end) — keeps every
// landmark's angular position correctly mirrored for both "left" and
// "right" (and both "sweep"/"hairpin") presets automatically, since `start`/
// `end`/`direction` already encode the mirroring (`arcAngles`, `track.ts`).
const GRANDSTAND_ARC_FRACTION = 0.5; // apex of the corner
const BILLBOARD_ARC_FRACTION = 0.2;
const PITS_ARC_FRACTION = 0.08; // just past the start, near the gantry

const PITS_BUILDING_SPACING_METERS = 7;
const DISTANT_VAN_OFFSET_METERS = 10; // beyond the pits cluster's own radius

function towardCentreHeading(position: Point2D, centre: Point2D): number {
  return Math.atan2(centre.y - position.y, centre.x - position.x);
}

/** The five hand-placed landmark set-pieces (grandstand, pit cluster, start/
 * finish gantry, billboard, checkered flag) for one track — semantically
 * positioned, not scattered: a grandstand/billboard faces the track (its
 * readable/spectator side toward the centre of curvature), the gantry spans
 * the road itself at the start line, and the flag sits at the finish line
 * tangent to the track's direction of travel. All five stay within the plan's
 * 3-6-per-track landmark count (the pit cluster's three buildings count as
 * one conceptual landmark, grouped tightly rather than scattered), and the
 * grandstand variant switches for hairpin tracks (`GRANDSTAND_ROUND`'s
 * footprint reads as track-facing at a tight apex; the plain covered
 * grandstand does not). */
export function buildLandmarks(group: THREE.Group, track: TrackParams): Promise<THREE.Vector3 | null>[] {
  const { cx, cy } = trackCentre(track);
  const centre: Point2D = { x: cx, y: cy };
  const { start, end } = arcAngles(track);
  const direction = track.direction === "left" ? 1 : -1;
  const sweep = end - start;
  const landmarkRadius = track.radius + ROAD_HALF_WIDTH + KERB_WIDTH_METERS + LANDMARK_KERB_GAP_METERS;

  const promises: Promise<THREE.Vector3 | null>[] = [];

  // 1. Grandstand — at the corner's apex, facing the track.
  const grandstandDef = track.id.startsWith("hairpin") ? GRANDSTAND_ROUND : GRANDSTAND_COVERED;
  const grandstandAngle = start + sweep * GRANDSTAND_ARC_FRACTION;
  const grandstandPosition = pointOnArc(centre, landmarkRadius, grandstandAngle);
  promises.push(
    placeInstance(group, grandstandDef.url, grandstandDef.spec, grandstandPosition, towardCentreHeading(grandstandPosition, centre), grandstandDef.pack, grandstandDef.castsShadow),
  );

  // 2. Pit cluster — three buildings grouped near the start of the corner,
  // all facing the track, treated as one conceptual landmark.
  const pitsBaseAngle = start + sweep * PITS_ARC_FRACTION;
  const pitsBasePosition = pointOnArc(centre, landmarkRadius, pitsBaseAngle);
  const pitsHeading = towardCentreHeading(pitsBasePosition, centre);
  const pitsBuildings = [PITS_GARAGE, PITS_OFFICE, PITS_GARAGE_CORNER];
  pitsBuildings.forEach((def, index) => {
    const tangentOffset = (index - (pitsBuildings.length - 1) / 2) * PITS_BUILDING_SPACING_METERS;
    const buildingAngle = pitsBaseAngle + direction * (tangentOffset / track.radius);
    const position = pointOnArc(centre, landmarkRadius, buildingAngle);
    promises.push(placeInstance(group, def.url, def.spec, position, pitsHeading, def.pack, def.castsShadow));
  });

  // 3. Start/finish gantry — spans the road itself at the start line. Its
  // fitted long (X) axis must run *radially* (across the road, inner edge
  // to outer edge), not tangent like the barrier: a barrier is a guardrail
  // that runs parallel to the road, but a gantry is an overhead arch the
  // car drives *under*, perpendicular to the direction of travel. Using the
  // barrier's tangent-heading formula here was a real bug — it rotated the
  // gantry's 9m span to point down the track instead of across it, so the
  // car started the run driving straight into the arch's side, filling the
  // frame like a wall instead of passing under it.
  const gantryPosition = pointOnArc(centre, track.radius, start);
  const gantryHeadingSim = towardCentreHeading(gantryPosition, centre);
  promises.push(placeInstance(group, GANTRY.url, GANTRY.spec, gantryPosition, gantryHeadingSim, GANTRY.pack, GANTRY.castsShadow));

  // 4. Billboard — readable (+z) face aimed toward the track centre so it
  // reads correctly as the car passes.
  const billboardAngle = start + sweep * BILLBOARD_ARC_FRACTION;
  const billboardPosition = pointOnArc(centre, landmarkRadius, billboardAngle);
  promises.push(
    placeInstance(group, BILLBOARD.url, BILLBOARD.spec, billboardPosition, towardCentreHeading(billboardPosition, centre), BILLBOARD.pack, BILLBOARD.castsShadow),
  );

  // 5. Checkered flag — at the finish line, tangent to the direction of
  // travel, same convention as the barrier/gantry tangent heading.
  const flagRadius = track.radius + ROAD_HALF_WIDTH + KERB_WIDTH_METERS;
  const flagPosition = pointOnArc(centre, flagRadius, end);
  const flagHeadingSim = end + direction * (Math.PI / 2);
  promises.push(placeInstance(group, FLAG.url, FLAG.spec, flagPosition, flagHeadingSim, FLAG.pack, FLAG.castsShadow));

  // A distant parked vehicle near the pit cluster — not one of the five
  // conceptual landmarks, but semantically anchored to the pits rather than
  // scattered by distant.ts's angular-sector logic.
  const vanRadius = landmarkRadius + DISTANT_VAN_OFFSET_METERS;
  const vanPosition = pointOnArc(centre, vanRadius, pitsBaseAngle);
  promises.push(placeInstance(group, DISTANT_VAN.url, DISTANT_VAN.spec, vanPosition, towardCentreHeading(vanPosition, centre), DISTANT_VAN.pack, DISTANT_VAN.castsShadow));

  return promises;
}
