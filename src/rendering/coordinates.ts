// Pure, DOM/Three.js-free sim-world -> Three.js-world coordinate mapping —
// separated out (same reasoning as camera.ts) so the mapping is a checkable
// unit-test claim rather than something only visible by looking at the
// canvas. The sim's world frame (physics.ts/track.ts): (x, y) on a flat
// ground plane, heading is a CCW-positive angle from +x, body-forward =
// (cos heading, sin heading). Three.js's world frame here: ground plane is
// (worldX, worldZ) with +worldY up, camera/scene built with the common
// right-handed "Z toward viewer" convention.
//
// worldX = simX, worldZ = -simY: flips the sim's mathematical
// (CCW-from-+x, y-left-of-x) handedness onto Three.js's ground plane without
// mirroring the scene left/right when viewed from behind the car (a +simY
// "left" turn reads as a +worldX-relative left turn from a chase camera
// behind +worldZ).

export interface WorldXZ {
  x: number;
  z: number;
}

export function simToWorld(x: number, y: number): WorldXZ {
  return { x, z: -y };
}

// A model's own local "forward" axis is a property of that specific mesh —
// confirmed by inspecting its scene graph (node names/translations), never
// guessed from a filename — and different Kenney packs disagree on which
// axis that is. sedan.glb's forward is +Z (wheel nodes at local z=+0.66
// front / z=-0.66 rear); the Racing Kit's barrier/light-post assets are not
// modelled nose-first along +Z at all (barrierWhite.glb's long axis is
// local +X; lightPostModern.glb's lamp arm cantilevers along local +Z from a
// post whose own "up" is the axis that must NOT be rotated away from
// world-Y). heading-to-rotation.y must be derived per local axis, not
// reused wholesale from whatever the vehicle happens to use — see
// CLAUDE.md's asset-provenance rule.
export type LocalAxis = "+x" | "-x" | "+z" | "-z";

// Derivation, generalised from the sedan-specific version this replaces:
// `Matrix4.makeRotationY(rotationY)` maps a local point (lx, ly, lz) to world
// (lx*cos(rotationY) + lz*sin(rotationY), ly, -lx*sin(rotationY) +
// lz*cos(rotationY)). Requiring a model's local forward axis to map to the
// world-forward direction for sim heading `h` — (cos h, 0, -sin h), matching
// `simToWorld`'s z = -y applied to a unit step along heading — and solving
// for `rotationY` per candidate local axis:
//   +Z (lx=0, lz=1): sin(rotationY) = cos(h), cos(rotationY) = -sin(h)
//                     => rotationY = h + PI/2
//   +X (lx=1, lz=0): cos(rotationY) = cos(h), sin(rotationY) = sin(h)
//                     => rotationY = h
//   -Z (lx=0, lz=-1): rotationY = h - PI/2 (negate the +Z case's offset)
//   -X (lx=-1, lz=0): rotationY = h + PI (negate the +X case's offset)
// i.e. a fixed per-axis offset added to the sim heading, independent of h.
const LOCAL_AXIS_ROTATION_OFFSET: Record<LocalAxis, number> = {
  "+x": 0,
  "+z": Math.PI / 2,
  "-x": Math.PI,
  "-z": -Math.PI / 2,
};

/** heading -> `rotation.y` for a mesh whose local forward axis is `localAxis`
 * (confirmed by inspecting that asset's scene graph — see
 * docs/asset-sources.md — not assumed). Use this, not a hardcoded offset,
 * for every prop placed by world heading; `sedanHeadingToWorldRotationY`
 * below is just this function's `"+z"` case, kept as a named export because
 * vehicle.ts's call site reads better naming the model it's for. */
export function localAxisHeadingToWorldRotationY(heading: number, localAxis: LocalAxis): number {
  return heading + LOCAL_AXIS_ROTATION_OFFSET[localAxis];
}

/** heading -> `rotation.y` for a mesh whose local forward axis is +Z —
 * verified empirically for `sedan.glb`, not assumed: its wheel nodes sit at
 * local z=+0.66 for the front pair and z=-0.66 for the rear pair (see
 * docs/asset-sources.md). This offset is specific to this model's forward
 * axis, not a general fact about the sim's heading convention — any other
 * asset (including a future vehicle swap) must call
 * `localAxisHeadingToWorldRotationY` with its own confirmed local axis
 * rather than reusing this function, the same discipline CLAUDE.md's
 * asset-provenance rule requires for any new 3D asset. */
export function sedanHeadingToWorldRotationY(heading: number): number {
  return localAxisHeadingToWorldRotationY(heading, "+z");
}
