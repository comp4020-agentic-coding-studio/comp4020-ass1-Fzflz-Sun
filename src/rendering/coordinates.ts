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

// heading -> rotation.y for a mesh whose local forward axis is +Z (verified
// empirically for `sedan.glb`, not assumed: its wheel nodes sit at local
// z=+0.66 for the front pair and z=-0.66 for the rear pair — see
// docs/asset-sources.md). `Matrix4.makeRotationY(rotation.y)` maps a local
// point (lx, ly, lz) to world (lx*cos(rotation.y) + lz*sin(rotation.y), ly,
// -lx*sin(rotation.y) + lz*cos(rotation.y)); requiring the model's local
// forward (0,0,1) to map to world-forward (cos heading, 0, -sin heading)
// (matching `simToWorld`'s z = -y above, applied to a unit step along
// heading) gives sin(rotation.y) = cos(heading) and cos(rotation.y) =
// -sin(heading), i.e. rotation.y = heading + PI/2.
//
// This offset is specific to this model's forward axis, not a general fact
// about the sim's heading convention — a different vehicle asset with a
// different local forward axis (e.g. -Z, or +X) needs this re-derived, not
// reused, the same discipline CLAUDE.md's asset-provenance rule requires for
// any new 3D asset (inspect the scene graph, don't guess).
export function headingToWorldRotationY(heading: number): number {
  return heading + Math.PI / 2;
}
