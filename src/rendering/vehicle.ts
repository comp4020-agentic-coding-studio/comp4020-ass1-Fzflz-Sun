import * as THREE from "three";
import { CAR_PARAMS } from "../simulation/constants.ts";
import type { SimState } from "../simulation/index.ts";
import { ASSET_PATHS, getNamedNode, loadAsset, WHEEL_NODE_NAMES } from "./asset-loader.ts";
import { headingToWorldRotationY, simToWorld, type WorldXZ } from "./coordinates.ts";
import { createBodyMaterial, FRONT_COLOR, REAR_COLOR, wheelColor } from "./materials.ts";

export interface Vehicle {
  root: THREE.Group;
  update(state: SimState): void;
}

// sedan.glb's own origin sits at ground level under the car (Kenney Car
// Kit convention — the wheel nodes' y=0.3 puts the axle centres above it,
// consistent with a ~0.3m wheel radius resting on y=0). Kept as a named,
// adjustable constant rather than a bare 0 so a future asset swap that
// doesn't share this convention has one obvious place to correct it (see
// docs/asset-sources.md's asset-provenance discipline — verify, don't
// assume, if this ever needs to become non-zero).
const GROUND_OFFSET_METERS = 0;

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
 * else. Preserves whatever roughness/metalness/map the source material
 * already carries; only `.color` is overwritten per frame. */
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
  root.traverse((node) => {
    if (node instanceof THREE.Mesh) {
      node.castShadow = true;
      node.receiveShadow = true;
    }
  });

  const bodyNode = getNamedNode(root, "body");
  if (bodyNode instanceof THREE.Mesh) bodyNode.material = createBodyMaterial();

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
    root.rotation.y = headingToWorldRotationY(state.heading);

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

    const frontTint = wheelColor(FRONT_COLOR, state.front.utilisation, state.front.saturated);
    const rearTint = wheelColor(REAR_COLOR, state.rear.utilisation, state.rear.saturated);
    for (const material of frontMaterials) material.color.copy(frontTint);
    for (const material of rearMaterials) material.color.copy(rearTint);
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
