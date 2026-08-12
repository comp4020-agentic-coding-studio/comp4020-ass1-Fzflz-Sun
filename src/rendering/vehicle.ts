import * as THREE from "three";
import { CAR_PARAMS } from "../simulation/constants.ts";
import type { SimState } from "../simulation/index.ts";
import { ASSET_PATHS, getNamedNode, loadAsset, WHEEL_NODE_NAMES } from "./asset-loader.ts";
import { sedanHeadingToWorldRotationY, simToWorld, type WorldXZ } from "./coordinates.ts";
import { FRONT_COLOR, REAR_COLOR, WHEEL_TINT_EMISSIVE_INTENSITY, wheelColor } from "./materials.ts";
import { VEHICLE_SCALE } from "./scene-scale.ts";
import { ROAD_LIFT_METERS } from "./track-geometry.ts";

export interface Vehicle {
  root: THREE.Group;
  update(state: SimState): void;
}

// sedan.glb's own origin sits at ground level under the car (Kenney Car
// Kit convention — the wheel nodes' y=0.3 puts the axle centres above it,
// consistent with a ~0.3m wheel radius resting on the road surface). Reuses
// track-geometry.ts's own ROAD_LIFT_METERS rather than a second,
// independent 0 — the road no longer sits exactly at world Y=0 (see that
// module's comment on why coplanar road/ground triangles z-fight), so the
// car's contact point must track the same constant or it visibly sinks
// fractionally into (or floats above) the road surface.
const GROUND_OFFSET_METERS = ROAD_LIFT_METERS;

interface WheelNodes {
  frontLeft: THREE.Object3D;
  frontRight: THREE.Object3D;
  rearLeft: THREE.Object3D;
  rearRight: THREE.Object3D;
}

/** Clones each mesh descendant's material (never shared with the original
 * loaded scene or any other clone — `asset-loader.ts`'s `loadAsset` only
 * clones the object graph, not materials) and returns the clones so
 * `update()` can tint them by axle utilisation without affecting anything
 * else. Preserves the source material's `map`/`color` completely untouched —
 * same discipline as the body mesh (see the comment above `loadVehicle`) —
 * because the wheel meshes share sedan.glb's one atlas texture too; only
 * `.emissive`/`.emissiveIntensity` are written per frame, additively, never
 * `.color`. */
function collectTintableMaterials(node: THREE.Object3D): THREE.MeshStandardMaterial[] {
  const materials: THREE.MeshStandardMaterial[] = [];
  node.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const source = child.material;
    const base = (Array.isArray(source) ? source[0] : source) as THREE.MeshStandardMaterial;
    const cloned = base.clone();
    child.material = cloned;
    materials.push(cloned);
  });
  return materials;
}

/** Loads sedan.glb once, wires up per-axle tintable wheel materials, and
 * returns a `Vehicle` whose `update(state)` positions/orients it from
 * `SimState` and tints/steers the wheels — everything scene.ts needs to
 * drive the car each frame without reaching into Three.js internals
 * itself. */
export async function loadVehicle(): Promise<Vehicle> {
  const root = await loadAsset(ASSET_PATHS.vehicle);
  root.name = "vehicle";
  // sedan.glb's own modelled wheelbase (1.32 m) is smaller than
  // CAR_PARAMS.wheelbaseHalf's simulated one (2.6 m) — see scene-scale.ts
  // for the full derivation. Scaling the whole root (not just the body
  // mesh) keeps the wheel nodes' local offsets proportionally correct, so
  // the visible contact points still line up with axleWorldPoints() below.
  root.scale.setScalar(VEHICLE_SCALE);
  root.traverse((node) => {
    if (node instanceof THREE.Mesh) {
      node.castShadow = true;
      node.receiveShadow = true;
    }
  });

  // The `body` mesh keeps whatever material GLTFLoader gave it — sedan.glb
  // has exactly one material (the shared `colormap` atlas: see
  // docs/asset-sources.md), and body/glass/lights are only visually distinct
  // because they sample different UV regions of that one texture. This used
  // to be overwritten here with a flat, textureless MeshStandardMaterial —
  // a real regression, not a texture-load failure — which replaced the
  // atlas `map` with nothing, collapsing body, glass, and lights into one
  // flat colour. Never repeat that: a glTF material must never be replaced
  // wholesale without preserving its source `map`/UV semantics (see
  // CLAUDE.md).
  const wheelNodes: WheelNodes = {
    frontLeft: getNamedNode(root, WHEEL_NODE_NAMES.frontLeft),
    frontRight: getNamedNode(root, WHEEL_NODE_NAMES.frontRight),
    rearLeft: getNamedNode(root, WHEEL_NODE_NAMES.rearLeft),
    rearRight: getNamedNode(root, WHEEL_NODE_NAMES.rearRight),
  };

  const frontMaterials = [...collectTintableMaterials(wheelNodes.frontLeft), ...collectTintableMaterials(wheelNodes.frontRight)];
  const rearMaterials = [...collectTintableMaterials(wheelNodes.rearLeft), ...collectTintableMaterials(wheelNodes.rearRight)];

  function update(state: SimState): void {
    const world = simToWorld(state.x, state.y);
    root.position.set(world.x, GROUND_OFFSET_METERS, world.z);
    root.rotation.y = sedanHeadingToWorldRotationY(state.heading);

    // Both front wheel nodes steer by the same angle — the sim models one
    // front-axle steer angle, not independent per-wheel Ackermann, so there
    // is nothing to differ between them. `rotation.y = frontSteerAngle`
    // directly (no offset, unlike the root's heading -> rotation.y mapping):
    // verified by hand that the model's local +X axis (a wheel node's own
    // rest frame, local forward = +Z) maps, once the root's own heading
    // rotation is applied, to exactly the sim's body-frame "left" direction
    // — the same direction positive `state.steering` already means (see
    // ControlInputs' doc comment in simulation/types.ts) — so the sim's sign
    // convention and the local rotation's sign convention agree with no
    // extra flip needed.
    const frontSteerAngle = state.steering * CAR_PARAMS.maxSteerAngle;
    wheelNodes.frontLeft.rotation.y = frontSteerAngle;
    wheelNodes.frontRight.rotation.y = frontSteerAngle;

    // `.emissive`, not `.color`: the wheel meshes sample the same shared
    // atlas texture as the body (see the comment above `loadVehicle`), so
    // overwriting `.color` here would multiply that atlas map by the tint
    // and flatten the tyre/rim's own texture detail into one uniform colour
    // — confirmed by a real screenshot comparison, not assumed (see
    // materials.ts's `WHEEL_TINT_EMISSIVE_INTENSITY` comment). Emissive adds
    // the axle-colour/danger accent on top of the untouched base map
    // instead.
    const frontTint = wheelColor(FRONT_COLOR, state.front.utilisation, state.front.saturated);
    const rearTint = wheelColor(REAR_COLOR, state.rear.utilisation, state.rear.saturated);
    for (const material of frontMaterials) {
      material.emissive.copy(frontTint);
      material.emissiveIntensity = WHEEL_TINT_EMISSIVE_INTENSITY;
    }
    for (const material of rearMaterials) {
      material.emissive.copy(rearTint);
      material.emissiveIntensity = WHEEL_TINT_EMISSIVE_INTENSITY;
    }
  }

  return { root, update };
}

/** World-space front/rear axle contact points for the given state — ported
 * from the previous 2D scene.ts's `recordTrail` (same
 * `state.x ± cos(heading)*wheelbaseHalf` geometry), now converted through
 * `coordinates.ts` instead of fed straight into a 2D projection. Exposed as
 * a free function (not a `Vehicle` method) since it's pure and
 * state-derived only — scene.ts's trail logic needs it whether or not the
 * vehicle asset has finished loading yet. */
export function axleWorldPoints(state: SimState): { front: WorldXZ; rear: WorldXZ } {
  const forwardX = Math.cos(state.heading);
  const forwardY = Math.sin(state.heading);
  const front = simToWorld(state.x + forwardX * CAR_PARAMS.wheelbaseHalf, state.y + forwardY * CAR_PARAMS.wheelbaseHalf);
  const rear = simToWorld(state.x - forwardX * CAR_PARAMS.wheelbaseHalf, state.y - forwardY * CAR_PARAMS.wheelbaseHalf);
  return { front, rear };
}
