import { CAR_PARAMS } from "../simulation/constants.ts";

// A single, physics-anchored scale factor used to correct a real mismatch:
// sedan.glb's own modelled wheelbase (front wheel nodes at local z=+0.66,
// rear at z=-0.66, i.e. 1.32 m — see docs/asset-sources.md) does not match
// CAR_PARAMS.wheelbaseHalf (1.3 m, i.e. a 2.6 m wheelbase — see
// simulation/constants.ts). Rendered at its native size, the sedan mesh's
// visible wheelbase would be noticeably shorter than the wheelbase the
// physics actually simulates (front/rear axle trail dots, corner radii,
// maxSteerAngle's turning geometry), which reads as "the car doesn't fit its
// own tracks". VEHICLE_SCALE closes that gap by construction, not by eye.
//
// This is a deliberate, documented deviation from strict real-world sedan
// proportions, not an oversight: scaling every axis uniformly to fix the
// wheelbase also enlarges the body's width/height beyond a realistic sedan
// (the model isn't just "too small", its aspect ratio isn't a 2x real car's
// either). Uniform scale is still the right tool here — a non-uniform
// per-axis stretch would visibly distort the body panels/wheel roundness for
// a cosmetic asset that was never going to be dimensionally accurate anyway.
const SEDAN_RAW_WHEELBASE_METERS = 1.32;

export const VEHICLE_SCALE = (2 * CAR_PARAMS.wheelbaseHalf) / SEDAN_RAW_WHEELBASE_METERS;

// The camera/chase-framing subsystem (scene.ts's CHASE_DISTANCE_METERS,
// CAMERA_HEIGHT_METERS) was tuned by eye against the *previous*, unscaled
// vehicle mesh. Scaling the vehicle by VEHICLE_SCALE without also scaling the
// camera's distance/height by the same factor would shrink the car's
// frame-occupancy fraction (it grew physically bigger but the camera stayed
// where it was) — since camera distance/height and vehicle size enter the
// small-angle frame-occupancy formula (frac ~ vehicleSize / (distance *
// 2*tan(fov/2))) as a ratio, multiplying both the vehicle's linear size and
// the camera's distance/height by the same SCENE_SCALE is an exact geometric
// similarity transform of the vehicle+camera subsystem: it reproduces the
// previously-tuned framing angles/occupancy fraction exactly, not
// approximately. SCENE_SCALE intentionally equals VEHICLE_SCALE (same
// factor, kept as a separate export so scene.ts's intent — "scale the
// camera to match the vehicle" — reads independently of vehicle.ts's own
// "scale the mesh to match the physics" intent, even though today they
// resolve to the same number).
export const SCENE_SCALE = VEHICLE_SCALE;
