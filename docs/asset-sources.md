# 3D asset sources

Every binary asset under `public/assets/` is a curated subset of three
Kenney.nl packs, all released under CC0 1.0 (public domain — attribution
appreciated but not required; licence text is copied into each asset folder
anyway). Nothing else — no other model, texture, or font — is used by the
3D renderer.

Each `.glb` was inspected directly (its embedded glTF JSON parsed from the
binary chunk) before being retained, to confirm scene-graph structure —
node names, mesh names, material setup, triangle counts — rather than
assuming anything from the filename.

## Vehicle

| Original filename | Local path | Provider | Source | Downloaded | Licence | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `sedan.glb` | `public/assets/vehicle/sedan.glb` | Kenney (kenney_car-kit) | https://kenney.nl/assets/car-kit | 2026-08-10 | CC0 1.0 | Used as-is, no re-export. ~2032 triangles. Four independently addressable wheel nodes confirmed by inspecting node translations: `wheel-front-left` (0.3, 0.3, 0.66), `wheel-front-right` (-0.3, 0.3, 0.66), `wheel-back-left` (0.3, 0.3, -0.66), `wheel-back-right` (-0.3, 0.3, -0.66) — front wheels at local `z = +0.66` confirms the model's local forward axis is **+Z**. Raw wheelbase (front-to-rear wheel translation along Z) = 1.32m. Scale is anchored to the simulation's own physics, not picked by eye: `VEHICLE_SCALE = (2 * CAR_PARAMS.wheelbaseHalf) / 1.32 ≈ 1.97` (`src/rendering/scene-scale.ts`), so the rendered car's wheelbase matches the wheelbase the physics model itself already assumes. This deliberately does not preserve strict real-world sedan proportions (a wheelbaseHalf of 1.3m implies a car visibly wider than a real sedan) — a documented tradeoff in favour of a physically-consistent scale reference over absolute realism. `SCENE_SCALE` (== `VEHICLE_SCALE`) also multiplies `CHASE_DISTANCE_METERS`/`CAMERA_HEIGHT_METERS` in `scene.ts` by the same factor, a similarity transform that keeps the car occupying the same fraction of the frame regardless of `VEHICLE_SCALE`'s value (small-angle argument: angle subtended ≈ size/distance, invariant under equal scaling of both) — camera pitch and FOV are angles, not lengths, so they are deliberately left unscaled. The whole model shares **one** material (`colormap`, the atlas below) — `body`, glass, and lights are only visually distinct because they sample different UV regions of it, not because they have separate materials. `vehicle.ts` keeps every mesh's original glTF material — `map`/`color` untouched — for exactly this reason: overwriting it with a flat colour, as an earlier version of this renderer briefly did, destroys the atlas and collapses body/glass/lights into one flat hue. The factory red-orange body colour visible in the chase scene comes straight from the atlas, not from any override. Axle-utilisation tinting on the wheel meshes is applied via `.emissive`/`.emissiveIntensity` (additive, on top of the untouched map) rather than `.color` (multiplicative, which would flatten the tyre/rim texture the same way) — see `materials.ts`'s `WHEEL_TINT_EMISSIVE_INTENSITY` comment. |
| `Textures/colormap.png` | `public/assets/vehicle/Textures/colormap.png` | Kenney (kenney_car-kit) | https://kenney.nl/assets/car-kit | 2026-08-10 | CC0 1.0 | The GLB's one material references this 512×512 atlas by an external relative URI (`Textures/colormap.png`, confirmed by parsing the GLB's embedded glTF JSON `images` array) rather than embedding it — this path must be preserved next to `sedan.glb` or `GLTFLoader` fails to resolve the texture. |

## Track props

Kenney's own packs are not unit-consistent with each other or with the
vehicle kit — "scale 1" means a different real size in each — so every prop
below is placed via an explicit `AssetPlacementSpec` (`src/rendering/
environment.ts`), not a bare scale multiplier: a real-world target size in
metres along a named axis, plus the model's own confirmed local forward
axis. `fitAssetToSpec` (`src/rendering/asset-fit.ts`) measures the model's
raw bounding box, scales it so the target axis hits the target size,
re-centres it horizontally, and anchors it to the ground — a loader promise
resolving is not the same claim as "correctly sized, centred, and oriented",
and every row below was confirmed against the fitted, placed geometry in an
actual screenshot, not just a resolved load.

| Original filename | Local path | Provider | Source | Downloaded | Licence | Raw bbox (X,Y,Z, metres) | Target | Confirmed local forward axis | Orientation semantics | Used? | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `barrierWhite.glb` | `public/assets/track/barrierWhite.glb` | Kenney (kenney_racing-kit) | https://kenney.nl/assets/racing-kit | 2026-08-10 | CC0 1.0 | `[0.25, 0.1312, 0.123]` | height (Y) → 0.9m | **+X** (its long axis — confirmed by direct inspection; earlier code wrongly assumed the sedan's own +Z heading formula applied to every prop, which put the barrier ~90° off the road's tangent) | "track-tangent": rotated to `theta + direction*(π/2)` at its own arc position, so the fitted +X edge lines up with the kerb it runs alongside | Yes — continuous run along the outer kerb, spacing = fitted length + 0.15m gap (previously a fixed 14m interval regardless of the asset's ~0.25m raw length, which is why it rendered as scattered dots instead of a guardrail) | 28 triangles, one flat `baseColorFactor` material, no embedded texture. |
| `lightPostModern.glb` | `public/assets/track/lightPostModern.glb` | Kenney (kenney_racing-kit) | https://kenney.nl/assets/racing-kit | 2026-08-10 | CC0 1.0 | `[0.0491, 0.7813, 0.1776]` | height (Y) → 4.5m | **+Z** (its lamp-arm axis — confirmed by height-band vertex-centroid analysis: the top band's cluster sits at local z in `[-0.660,-0.490]` vs. the base band's `[-0.668,-0.632]`, i.e. the arm cantilevers along +Z while X stays centred) | "face-road": rotated so the fitted +Z arm points from the post toward the track's own centre of curvature (`atan2` toward centre, not the road tangent) — only `rotation.y` is ever touched, so the pole itself can never tip off vertical | Yes — continuous run along the outer kerb, spacing = fitted height × 6 (chosen so it reproduces close to the previous hand-picked ~28m interval once fed the real fitted height, 4.5 × 6 = 27m) | 198 triangles, two flat-colour materials, no texture. |
| `pylon.glb` | `public/assets/track/pylon.glb` | Kenney (kenney_racing-kit) | https://kenney.nl/assets/racing-kit | 2026-08-10 | CC0 1.0 | `[0.12, 0.132, 0.12]` | height (Y) → 0.7m | nominal only — near-square footprint (a cone/marker, not a directional object); orientation is never checked against a target direction | "symmetric" (tangent heading reused for placement math, but cosmetically irrelevant given the near-square footprint) | Yes, as of this pass — previously declared in `ASSET_PATHS` and documented but never actually placed by any scatter function, a contradictory state. Now placed as a small fixed 4-marker "gate" (2 per end) on the inner kerb near the track's own start/end angles, as an early, unambiguous scale reference within the first few metres of a run — deliberately sparing, not scattered throughout | 108 triangles, one flat orange material, no texture. |

## Nature props

Trees and rocks get a random full-circle yaw (`scatterField` in
`environment.ts`) rather than a directional orientation check, so their
`localForwardAxis` is nominal — but each still gets its own real-world
height target rather than sharing one flat multiplier with every other
field prop (the previous 0.85–1.35 scale range applied identically to a
tree and a rock had no relationship to either's actual size, and made small
rocks read as scaled-up "potted plants" or vice versa).

| Original filename | Local path | Provider | Source | Downloaded | Licence | Target height (Y) | Used? | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `tree_default.glb` | `public/assets/nature/tree_default.glb` | Kenney (kenney_nature-kit) | https://kenney.nl/assets/nature-kit | 2026-08-10 | CC0 1.0 | 5.5m | Yes — weight 3 of 11 in the field-scatter pool, ±10% size jitter per instance | 114 triangles, flat-colour materials, no texture. |
| `tree_pineRoundA.glb` | `public/assets/nature/tree_pineRoundA.glb` | Kenney (kenney_nature-kit) | https://kenney.nl/assets/nature-kit | 2026-08-10 | CC0 1.0 | 6.5m | Yes — weight 3 of 11, ±10% jitter | 204 triangles, flat-colour materials, no texture. |
| `tree_detailed.glb` | `public/assets/nature/tree_detailed.glb` | Kenney (kenney_nature-kit) | https://kenney.nl/assets/nature-kit | 2026-08-10 | CC0 1.0 | 5.0m | Yes — weight 2 of 11, ±10% jitter | 402 triangles, flat-colour materials, no texture. |
| `rock_largeA.glb` | `public/assets/nature/rock_largeA.glb` | Kenney (kenney_nature-kit) | https://kenney.nl/assets/nature-kit | 2026-08-10 | CC0 1.0 | 0.7m | Yes — weight 1 of 11, ±10% jitter | 80 triangles, flat-colour material, no texture. |
| `rock_smallA.glb` | `public/assets/nature/rock_smallA.glb` | Kenney (kenney_nature-kit) | https://kenney.nl/assets/nature-kit | 2026-08-10 | CC0 1.0 | 0.35m | Yes — weight 2 of 11, ±10% jitter | 16 triangles, flat-colour material, no texture. |

## Conversion notes

None of these files were re-exported or edited. Each pack ships a "GLTF
format" (or, for the car kit, "GLB format") folder containing binary `.glb`
files directly — despite the folder name, `kenney_racing-kit`'s and
`kenney_nature-kit`'s "GLTF format" folders contain single-file binary GLBs,
not `.gltf` + separate `.bin`/textures, confirmed by parsing each file's
12-byte glTF binary header. These were copied byte-for-byte into
`public/assets/`.

Each subfolder (`vehicle/`, `track/`, `nature/`) also contains a copy of
that pack's `License.txt`, even though CC0 does not require attribution.
