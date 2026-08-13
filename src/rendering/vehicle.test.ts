import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";

// asset-loader.ts's real loadAsset() runs GLTFLoader.loadAsync() over the
// network — not something vitest/jsdom can do (no WebGL, no real fetch of a
// local .glb). Mocking it lets this test assert the one thing that matters
// for the regression it covers: whatever material a loaded glTF node
// arrives with is what the `body` mesh keeps, without needing a real asset
// load. The fake scene graph mirrors sedan.glb's real shape (one shared
// atlas-textured material, four named wheel nodes, a `body` node) closely
// enough for loadVehicle()'s own logic to exercise identically.
vi.mock("./asset-loader.ts", () => {
  const WHEEL_NODE_NAMES = {
    frontLeft: "wheel-front-left",
    frontRight: "wheel-front-right",
    rearLeft: "wheel-back-left",
    rearRight: "wheel-back-right",
  };

  return {
    ASSET_PATHS: { vehicle: "mock://sedan.glb" },
    WHEEL_NODE_NAMES,
    getNamedNode(root: THREE.Object3D, name: string): THREE.Object3D {
      const node = root.getObjectByName(name);
      if (!node) throw new Error(`asset is missing expected node "${name}"`);
      return node;
    },
    async loadAsset(): Promise<THREE.Group> {
      const root = new THREE.Group();
      const atlas = new THREE.Texture();
      const sharedMaterial = new THREE.MeshStandardMaterial({ map: atlas, color: 0xffffff, name: "colormap" });

      const body = new THREE.Mesh(new THREE.BoxGeometry(), sharedMaterial.clone());
      body.name = "body";
      root.add(body);

      for (const name of Object.values(WHEEL_NODE_NAMES)) {
        const wheel = new THREE.Mesh(new THREE.BoxGeometry(), sharedMaterial.clone());
        wheel.name = name;
        root.add(wheel);
      }

      return root;
    },
  };
});

describe("loadVehicle", () => {
  it("keeps the body mesh's original glTF material — including its texture map — instead of overwriting it with a flat, textureless colour", async () => {
    const { loadVehicle } = await import("./vehicle.ts");
    const vehicle = await loadVehicle();

    const body = vehicle.root.getObjectByName("body");
    expect(body).toBeInstanceOf(THREE.Mesh);
    const material = (body as THREE.Mesh).material as THREE.MeshStandardMaterial;

    expect(material).toBeInstanceOf(THREE.MeshStandardMaterial);
    expect(material.map).not.toBeNull();
    expect(material.name).toBe("colormap");
  });

  it("tints a saturated axle's wheels via emissive only, leaving the shared atlas map and base colour untouched", async () => {
    const { loadVehicle } = await import("./vehicle.ts");
    const { createInitialState } = await import("../simulation/index.ts");
    const { FRONT_COLOR, wheelColor, WHEEL_TINT_EMISSIVE_INTENSITY } = await import("./materials.ts");

    const vehicle = await loadVehicle();
    const state = createInitialState();
    state.front = { fxDemand: 0, fyDemand: 0, fx: 0, fy: 0, limit: 0, utilisation: 1.5, saturated: true };
    vehicle.update(state);

    const wheel = vehicle.root.getObjectByName("wheel-front-left");
    expect(wheel).toBeInstanceOf(THREE.Mesh);
    const material = (wheel as THREE.Mesh).material as THREE.MeshStandardMaterial;

    // The atlas map/base colour must survive untouched — tinting must never
    // overwrite `.color`, which would multiply the shared texture and flatten
    // the tyre/rim detail into one uniform colour (see materials.ts).
    expect(material.map).not.toBeNull();
    expect(material.color.getHex()).toBe(0xffffff);

    const expectedTint = wheelColor(FRONT_COLOR, state.front.utilisation, state.front.saturated);
    expect(material.emissive.getHex()).toBe(expectedTint.getHex());
    expect(material.emissiveIntensity).toBe(WHEEL_TINT_EMISSIVE_INTENSITY);
  });

  it("scales the whole root by VEHICLE_SCALE so the model's wheelbase matches the physics-simulated one", async () => {
    const { loadVehicle } = await import("./vehicle.ts");
    const { VEHICLE_SCALE } = await import("./scene-scale.ts");

    const vehicle = await loadVehicle();

    expect(vehicle.root.scale.x).toBeCloseTo(VEHICLE_SCALE, 10);
    expect(vehicle.root.scale.y).toBeCloseTo(VEHICLE_SCALE, 10);
    expect(vehicle.root.scale.z).toBeCloseTo(VEHICLE_SCALE, 10);
    // VEHICLE_SCALE is derived from a real mismatch (sedan.glb's 1.32m vs
    // CAR_PARAMS' 2.6m wheelbase), not an arbitrary cosmetic tweak — assert
    // it's meaningfully greater than 1, not just "some finite number", so a
    // future refactor that accidentally hardcodes 1 fails this test.
    expect(VEHICLE_SCALE).toBeGreaterThan(1.5);
  });

  it("orients the root from state.heading via the shared sedan heading formula, not a bare copy", async () => {
    const { loadVehicle } = await import("./vehicle.ts");
    const { createInitialState } = await import("../simulation/index.ts");
    const { sedanHeadingToWorldRotationY } = await import("./coordinates.ts");

    const vehicle = await loadVehicle();
    const state = createInitialState();

    for (const heading of [0, Math.PI / 2, -Math.PI / 2, 1.23456]) {
      state.heading = heading;
      vehicle.update(state);
      expect(vehicle.root.rotation.y).toBeCloseTo(sedanHeadingToWorldRotationY(heading), 10);
    }
  });
});
