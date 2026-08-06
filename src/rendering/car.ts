import * as THREE from "three";

// Axle colours match the CSS palette exactly (CLAUDE.md: fixed everywhere).
const FRONT_COLOR = 0x4fd3e6;
const REAR_COLOR = 0xd99a4e;
const DANGER_COLOR = 0xff6b57;
const BODY_COLOR = 0xe8e4da;

export interface CarMesh {
  group: THREE.Group;
  frontMarker: THREE.Mesh;
  rearMarker: THREE.Mesh;
}

/** Builds the car from primitive Three.js geometry only (no imported
 * models/textures — CLAUDE.md). The body's local -Z is "front"; callers
 * orient the group with rotation.y = heading - PI/2 (see scene.ts). */
export function createCarMesh(): CarMesh {
  const group = new THREE.Group();

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(1.8, 0.9, 4.2),
    new THREE.MeshStandardMaterial({ color: BODY_COLOR, roughness: 0.6 }),
  );
  body.position.y = 0.55;
  group.add(body);

  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(1.3, 0.55, 1.8),
    new THREE.MeshStandardMaterial({ color: 0x2a2e35, roughness: 0.4 }),
  );
  cabin.position.set(0, 1.05, -0.2);
  group.add(cabin);

  const frontMarker = new THREE.Mesh(
    new THREE.BoxGeometry(1.9, 0.25, 0.35),
    new THREE.MeshStandardMaterial({ color: FRONT_COLOR, emissive: 0x000000 }),
  );
  frontMarker.position.set(0, 0.35, -1.9);
  group.add(frontMarker);

  const rearMarker = new THREE.Mesh(
    new THREE.BoxGeometry(1.9, 0.25, 0.35),
    new THREE.MeshStandardMaterial({ color: REAR_COLOR, emissive: 0x000000 }),
  );
  rearMarker.position.set(0, 0.35, 1.9);
  group.add(rearMarker);

  return { group, frontMarker, rearMarker };
}

/** Colours an axle marker toward the shared danger accent as it saturates,
 * so saturation is visible on the 3D car itself, not just the sidebar. */
export function updateAxleMarker(marker: THREE.Mesh, baseColor: number, utilisation: number, saturated: boolean): void {
  const material = marker.material as THREE.MeshStandardMaterial;
  const t = saturated ? Math.min(1, (utilisation - 1) * 2 + 0.4) : 0;
  const base = new THREE.Color(baseColor);
  const danger = new THREE.Color(DANGER_COLOR);
  material.color.copy(base).lerp(danger, t);
  material.emissive.copy(danger).multiplyScalar(t * 0.5);
}

export { DANGER_COLOR, FRONT_COLOR, REAR_COLOR };
