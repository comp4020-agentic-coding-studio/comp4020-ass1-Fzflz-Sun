import * as THREE from "three";
import type { SimState, TrackParams } from "../simulation/index.ts";
import { trackCentre } from "../simulation/track.ts";
import { createCarMesh, FRONT_COLOR, REAR_COLOR, updateAxleMarker } from "./car.ts";

// Maps the simulation's 2D (x forward, y left) plane onto Three.js's XZ
// ground plane. Derivation (see docs/model-assumptions.md-adjacent commit
// notes): with the car body's local -Z axis built as "front" (car.ts),
// rotation.y = heading - PI/2 makes the mesh's forward direction match the
// simulation's (cos(heading), -sin(heading)) world-frame forward vector.
function simToWorld(x: number, y: number): { x: number; z: number } {
  return { x, z: -y };
}

function headingToWorldRotationY(heading: number): number {
  return heading - Math.PI / 2;
}

export interface GripScene {
  update(state: SimState, reducedMotion: boolean): void;
  resize(): void;
  dispose(): void;
}

/** Builds the chase-camera 3D scene: ground, the one corner's road + kerbs,
 * a reference line, and the car. Pure primitive geometry only. Returns null
 * semantics are the caller's job — this throws if WebGL is unavailable, and
 * main.ts catches that so a canvas-less browser still gets the full
 * instrument-panel explanation (CLAUDE.md: DOM state is the non-visual
 * truth, WebGL is not required for the interaction to be legible). */
export function createGripScene(canvas: HTMLCanvasElement, track: TrackParams): GripScene {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1d22);
  scene.fog = new THREE.Fog(0x1a1d22, 40, 160);

  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 500);

  scene.add(new THREE.HemisphereLight(0xbfd4de, 0x14151a, 0.9));
  const sun = new THREE.DirectionalLight(0xffffff, 0.8);
  sun.position.set(30, 40, 10);
  scene.add(sun);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(500, 500),
    new THREE.MeshStandardMaterial({ color: 0x22262d, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  const centre = trackCentre(track);
  const centreWorld = simToWorld(centre.cx, centre.cy);
  const roadHalfWidth = 7;

  const road = new THREE.Mesh(
    new THREE.RingGeometry(track.radius - roadHalfWidth, track.radius + roadHalfWidth, 96),
    new THREE.MeshStandardMaterial({ color: 0x2c3038, roughness: 0.95 }),
  );
  road.rotation.x = -Math.PI / 2;
  road.position.set(centreWorld.x, 0.01, centreWorld.z);
  scene.add(road);

  const kerbMaterial = new THREE.MeshStandardMaterial({ color: 0x3a3f49, roughness: 0.9 });
  const outerKerb = new THREE.Mesh(
    new THREE.RingGeometry(track.radius + roadHalfWidth, track.radius + roadHalfWidth + 0.6, 96),
    kerbMaterial,
  );
  outerKerb.rotation.x = -Math.PI / 2;
  outerKerb.position.set(centreWorld.x, 0.015, centreWorld.z);
  scene.add(outerKerb);

  const innerKerb = new THREE.Mesh(
    new THREE.RingGeometry(track.radius - roadHalfWidth - 0.6, track.radius - roadHalfWidth, 96),
    kerbMaterial,
  );
  innerKerb.rotation.x = -Math.PI / 2;
  innerKerb.position.set(centreWorld.x, 0.015, centreWorld.z);
  scene.add(innerKerb);

  const referenceLine = new THREE.Mesh(
    new THREE.TorusGeometry(track.radius, 0.08, 8, 128),
    new THREE.MeshStandardMaterial({ color: 0xdfdccf, roughness: 0.5 }),
  );
  referenceLine.rotation.x = Math.PI / 2;
  referenceLine.position.set(centreWorld.x, 0.03, centreWorld.z);
  scene.add(referenceLine);

  const car = createCarMesh();
  scene.add(car.group);

  const cameraTarget = new THREE.Vector3();
  const cameraPosTarget = new THREE.Vector3();
  let cameraInitialised = false;

  function layout(state: SimState, alpha: number): void {
    const worldPos = simToWorld(state.x, state.y);
    car.group.position.set(worldPos.x, 0, worldPos.z);
    car.group.rotation.y = headingToWorldRotationY(state.heading);

    updateAxleMarker(car.frontMarker, FRONT_COLOR, state.front.utilisation, state.front.saturated);
    updateAxleMarker(car.rearMarker, REAR_COLOR, state.rear.utilisation, state.rear.saturated);

    const forward = new THREE.Vector3(Math.cos(state.heading), 0, -Math.sin(state.heading));
    cameraPosTarget
      .copy(forward)
      .multiplyScalar(-9)
      .add(new THREE.Vector3(worldPos.x, 4.2, worldPos.z));
    cameraTarget.set(worldPos.x, 0.8, worldPos.z).addScaledVector(forward, 6);

    if (!cameraInitialised) {
      camera.position.copy(cameraPosTarget);
      cameraInitialised = true;
    } else {
      camera.position.lerp(cameraPosTarget, alpha);
    }
    camera.lookAt(cameraTarget);
  }

  function update(state: SimState, reducedMotion: boolean): void {
    // Reduced-motion visitors get the same camera framing without the
    // trailing lag/easing (CLAUDE.md, spec/brief.md edge cases).
    layout(state, reducedMotion ? 1 : 0.12);
    renderer.render(scene, camera);
  }

  function resize(): void {
    const width = Math.max(1, canvas.clientWidth);
    const height = Math.max(1, canvas.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  resize();

  function dispose(): void {
    renderer.dispose();
  }

  return { update, resize, dispose };
}
