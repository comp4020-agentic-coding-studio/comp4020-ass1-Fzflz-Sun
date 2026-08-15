# 3D asset sources

Every binary asset under `src/rendering/assets/` is a curated subset of three
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
| `sedan.glb` | `src/rendering/assets/vehicle/sedan.glb` | Kenney (kenney_car-kit) | https://kenney.nl/assets/car-kit | 2026-08-10 | CC0 1.0 | Used as-is, no re-export. ~2032 triangles. Four independently addressable wheel nodes confirmed by inspecting node translations: `wheel-front-left` (0.3, 0.3, 0.66), `wheel-front-right` (-0.3, 0.3, 0.66), `wheel-back-left` (0.3, 0.3, -0.66), `wheel-back-right` (-0.3, 0.3, -0.66) — front wheels at local `z = +0.66` confirms the model's local forward axis is **+Z**. Raw wheelbase (front-to-rear wheel translation along Z) = 1.32m. Scale is anchored to the simulation's own physics, not picked by eye: `VEHICLE_SCALE = (2 * CAR_PARAMS.wheelbaseHalf) / 1.32 ≈ 1.97` (`src/rendering/scene-scale.ts`), so the rendered car's wheelbase matches the wheelbase the physics model itself already assumes. This deliberately does not preserve strict real-world sedan proportions (a wheelbaseHalf of 1.3m implies a car visibly wider than a real sedan) — a documented tradeoff in favour of a physically-consistent scale reference over absolute realism. `SCENE_SCALE` (== `VEHICLE_SCALE`) also multiplies `CHASE_DISTANCE_METERS`/`CAMERA_HEIGHT_METERS` in `scene.ts` by the same factor, a similarity transform that keeps the car occupying the same fraction of the frame regardless of `VEHICLE_SCALE`'s value (small-angle argument: angle subtended ≈ size/distance, invariant under equal scaling of both) — camera pitch and FOV are angles, not lengths, so they are deliberately left unscaled. The whole model shares **one** material (`colormap`, the atlas below) — `body`, glass, and lights are only visually distinct because they sample different UV regions of it, not because they have separate materials. `vehicle.ts` keeps every mesh's original glTF material — `map`/`color` untouched — for exactly this reason: overwriting it with a flat colour, as an earlier version of this renderer briefly did, destroys the atlas and collapses body/glass/lights into one flat hue. The factory red-orange body colour visible in the chase scene comes straight from the atlas, not from any override. Axle-utilisation tinting on the wheel meshes is applied via `.emissive`/`.emissiveIntensity` (additive, on top of the untouched map) rather than `.color` (multiplicative, which would flatten the tyre/rim texture the same way) — see `materials.ts`'s `WHEEL_TINT_EMISSIVE_INTENSITY` comment. |
| `Textures/colormap.png` | `src/rendering/assets/vehicle/Textures/colormap.png` | Kenney (kenney_car-kit) | https://kenney.nl/assets/car-kit | 2026-08-10 | CC0 1.0 | The GLB's one material references this 512×512 atlas by an external relative URI (`Textures/colormap.png`, confirmed by parsing the GLB's embedded glTF JSON `images` array) rather than embedding it — this path must be preserved next to `sedan.glb` or `GLTFLoader` fails to resolve the texture. |

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
| `barrierWhite.glb` | `src/rendering/assets/track/barrierWhite.glb` | Kenney (kenney_racing-kit) | https://kenney.nl/assets/racing-kit | 2026-08-10 | CC0 1.0 | `[0.25, 0.1312, 0.123]` | height (Y) → 0.9m | **+X** (its long axis — confirmed by direct inspection; earlier code wrongly assumed the sedan's own +Z heading formula applied to every prop, which put the barrier ~90° off the road's tangent) | "track-tangent": rotated to `theta + direction*(π/2)` at its own arc position, so the fitted +X edge lines up with the kerb it runs alongside | Yes — continuous run along the outer kerb, spacing = fitted length + 0.15m gap (previously a fixed 14m interval regardless of the asset's ~0.25m raw length, which is why it rendered as scattered dots instead of a guardrail) | 28 triangles, one flat `baseColorFactor` material, no embedded texture. |
| `lightPostModern.glb` | `src/rendering/assets/track/lightPostModern.glb` | Kenney (kenney_racing-kit) | https://kenney.nl/assets/racing-kit | 2026-08-10 | CC0 1.0 | `[0.0491, 0.7813, 0.1776]` | height (Y) → 4.5m | **+Z** (its lamp-arm axis — confirmed by height-band vertex-centroid analysis: the top band's cluster sits at local z in `[-0.660,-0.490]` vs. the base band's `[-0.668,-0.632]`, i.e. the arm cantilevers along +Z while X stays centred) | "face-road": rotated so the fitted +Z arm points from the post toward the track's own centre of curvature (`atan2` toward centre, not the road tangent) — only `rotation.y` is ever touched, so the pole itself can never tip off vertical | Yes — continuous run along the outer kerb, spacing = fitted height × 6 (chosen so it reproduces close to the previous hand-picked ~28m interval once fed the real fitted height, 4.5 × 6 = 27m) | 198 triangles, two flat-colour materials, no texture. |
| `pylon.glb` | `src/rendering/assets/track/pylon.glb` | Kenney (kenney_racing-kit) | https://kenney.nl/assets/racing-kit | 2026-08-10 | CC0 1.0 | `[0.12, 0.132, 0.12]` | height (Y) → 0.7m | nominal only — near-square footprint (a cone/marker, not a directional object); orientation is never checked against a target direction | "symmetric" (tangent heading reused for placement math, but cosmetically irrelevant given the near-square footprint) | Yes, as of this pass — previously declared in `ASSET_PATHS` and documented but never actually placed by any scatter function, a contradictory state. Now placed as a small fixed 4-marker "gate" (2 per end) on the inner kerb near the track's own start/end angles, as an early, unambiguous scale reference within the first few metres of a run — deliberately sparing, not scattered throughout | 108 triangles, one flat orange material, no texture. |
| `fenceCurved.glb` | `src/rendering/assets/track/fenceCurved.glb` | Kenney (kenney_racing-kit) | https://kenney.nl/assets/racing-kit | 2026-08-15 | CC0 1.0 | `[1.0, 0.81, 0.32]` | height (Y) → 0.9m (same target as `barrierWhite`, an alternative fence style at the same real-world guardrail height) | **+X** (its long axis, same convention as `barrierWhite`) | "track-tangent", identical placement formula to `barrierWhite`. Its arc-bulge direction (which way the curve's convex face points) came back symmetric under column-profile analysis (`col[x]` mean-z values mirror across the panel's centre) — no reliable one-way signal, so the curve is treated as cosmetically direction-agnostic or, harder | Yes — midground layer, an occasional visual break from straight barrier runs, not part of the primary continuous guardrail | 932 verts, one `noExport`-named mesh, flat-colour material, no texture. Baked node offset `(-0.35, -0.01, -0.65)`, same as every other racing-kit prop below. |

## Landmark props

Racing-kit structures (grandstands, pits, start/finish gantry, billboard,
finish flag) — every one of the 8 files below shares the same pack-wide
baked mesh-node translation offset confirmed for `barrierWhite`/
`lightPostModern`/`pylon` above, `(-0.35, -0.01, -0.65)`; `fitAssetToSpec`
re-centres/ground-anchors around it exactly as it already does for those
three, so the offset needed no new handling. Orientation for each was
confirmed by decoding the GLB's real float32 `POSITION` buffer (not just
accessor min/max) and analysing height-band centroid drift (grandstands:
which side the tiered seating steps down toward) or door-gap density-grid
scanning (pits/billboard: which face has a wall-opening vs. a solid wall) —
never inferred from filename.

| Original filename | Local path | Provider | Source | Downloaded | Licence | Raw bbox (X,Y,Z, metres) | Target | Confirmed local forward axis | Orientation semantics | Used? | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `grandStandCovered.glb` | `src/rendering/assets/track/grandStandCovered.glb` | Kenney (kenney_racing-kit) | https://kenney.nl/assets/racing-kit | 2026-08-15 | CC0 1.0 | `[1.0, 1.1864, 1.02]` | height (Y) → 5.5m | **+Z** — column-profile along Z shows seating height stepping down monotonically from a tall back wall (mean y≈0.90 near z≈-1.5) to a low open front row (mean y≈0.37 near z≈-0.83) before a roof-canopy edge spikes back up right at z≈-0.63; the open/low side (where spectators look out) faces +Z | "face-track": placed near the track's apex, rotated so its confirmed +Z faces the road, same `localAxisHeadingToWorldRotationY` helper as every other directional prop | Yes — the primary grandstand landmark on straight/sweep presets | 1560 verts, one mesh, flat-colour materials, no texture. |
| `grandStandRound.glb` | `src/rendering/assets/track/grandStandRound.glb` | Kenney (kenney_racing-kit) | https://kenney.nl/assets/racing-kit | 2026-08-15 | CC0 1.0 | `[1.6366, 0.8963, 1.6366]` | height (Y) → 4.2m | approximate **+Z** only — this is a curved corner-wrap variant (near-square XZ footprint, no single flat back wall): height-band centroids show the tall corner sits at local (x≈+1.29, z≈-1.65) and the low/open corner at (x≈-0.35, z≈-0.01), i.e. the true open face bisects a diagonal, not a cardinal axis. `localAxisHeadingToWorldRotationY` only supports cardinal axes, so +Z is used as a documented approximation — acceptable here because this variant is reserved for hairpin corners specifically, where the placement tolerance is looser than the primary grandstand | "face-track" (approximate) | Yes — hairpin-left/hairpin-right presets only, in place of `grandStandCovered` | 7008 verts, flat-colour materials, no texture. |
| `grandStandCoveredRound.glb` | `src/rendering/assets/track/grandStandCoveredRound.glb` | Kenney (kenney_racing-kit) | https://kenney.nl/assets/racing-kit | 2026-08-15 | CC0 1.0 | `[1.6366, 1.1864, 1.6366]` | height (Y) → 5.5m | approximate **+Z** — same corner-wrap geometry and same diagonal-vs-cardinal caveat as `grandStandRound` above, with a roof added (matches `grandStandCovered`'s height) | "face-track" (approximate) | Reserved for hairpin corners; not currently instantiated separately from `grandStandRound` (one round grandstand per hairpin track was judged sufficient for the 3–6 landmark budget) — kept documented and copied in case a future pass wants the covered corner variant instead | 11425 verts, flat-colour materials, no texture. |
| `pitsGarage.glb` | `src/rendering/assets/track/pitsGarage.glb` | Kenney (kenney_racing-kit) | https://kenney.nl/assets/racing-kit | 2026-08-15 | CC0 1.0 | `[1.0, 0.70, 1.09]` | height (Y) → 3.2m | **+Z** — door-gap density-grid scan: the z-max face has a sparse door-frame pattern (verts only at grid edges, large empty block in the middle — an opening) while the z-min face is a near-solid blank wall | "face-track": part of the grouped pit cluster, all three units given the same +Z facing toward the road | Yes — pit cluster (with `pitsOffice`/`pitsGarageCorner`) near track start | 616 verts, `noExport`-named mesh, flat-colour, no texture. |
| `pitsGarageCorner.glb` | `src/rendering/assets/track/pitsGarageCorner.glb` | Kenney (kenney_racing-kit) | https://kenney.nl/assets/racing-kit | 2026-08-15 | CC0 1.0 | `[1.05, 0.70, 1.0]` | height (Y) → 3.2m (same as `pitsGarage`, same building type) | **+Z** — same door-gap signature on the z-max face as `pitsGarage`; the x-max face is fully dense/solid (a side wall, not a second door) | "face-track" | Yes — pit cluster corner unit | 830 verts, flat-colour, no texture. |
| `pitsOffice.glb` | `src/rendering/assets/track/pitsOffice.glb` | Kenney (kenney_racing-kit) | https://kenney.nl/assets/racing-kit | 2026-08-15 | CC0 1.0 | `[1.0, 0.51, 1.04]` | height (Y) → 2.6m (single-storey, shorter than the garage units) | **+Z** — same door/window-gap pattern on the z-max face, blank z-min face | "face-track" | Yes — pit cluster office unit | 552 verts, `noExport`-named mesh, flat-colour, no texture. |
| `overheadRound.glb` | `src/rendering/assets/track/overheadRound.glb` | Kenney (kenney_racing-kit) | https://kenney.nl/assets/racing-kit | 2026-08-15 | CC0 1.0 | `[1.8669, 0.9334, 0.33]` | span (X) → 9.0m (wide enough to clear the road+kerb; verified against `ROAD_HALF_WIDTH`/`KERB_WIDTH_METERS` at placement time, not hardcoded) | nominal only — column-profile along X confirms a genuine arch shape (low at both edges ≈0.23–0.31, peaking at centre ≈0.72–0.75), but the front/back half-split (198 vs. 156 verts) is close enough to balanced that no reliable one-way facing signal exists, matching `pylon.glb`'s existing "nominal only" precedent | "gantry": straddles the road at a fixed angle (start/finish line), no directional check applied | Yes — one start/finish gantry per track | 354 verts, flat-colour, no texture. |
| `billboardLow.glb` | `src/rendering/assets/track/billboardLow.glb` | Kenney (kenney_racing-kit) | https://kenney.nl/assets/racing-kit | 2026-08-15 | CC0 1.0 | `[1.0, 0.69, 0.4762]` | height (Y) → 3.2m | **+Z** — z-histogram is cleanly bimodal: a support-strut cluster sits at the z-min end (208 verts) and the flat sign panel at the z-max end (528 verts); the panel's readable face is the one pointing away from its own support structure, i.e. +Z | "face-camera": rotated to face the oncoming/chase-camera direction at its placement angle | Yes — one roadside billboard | 736 verts, `noExport`-named mesh, flat-colour, no texture. |
| `flagCheckers.glb` | `src/rendering/assets/track/flagCheckers.glb` | Kenney (kenney_racing-kit) | https://kenney.nl/assets/racing-kit | 2026-08-15 | CC0 1.0 | combined (both mesh nodes) `[0.357, 1.25, 0.685]` | height (Y) → 3.0m | nominal only — this file has **two** mesh nodes with genuinely different baked translations (pole: `(0, 0, -0.000395)`; cloth: `(-0.35, -0.01, -0.65)`, the shared pack-wide offset), confirmed by inspecting each node's own transform rather than assuming one shared offset applies to both. This does *not* need special-case handling: `loadAsset`/`fitAssetToSpec` already treat the whole loaded root as one rigid group and fit its combined bounding box, exactly like the sedan's four independently-transformed wheel nodes are handled today — no per-node repositioning logic was added. The cloth billows diagonally (toward -X,-Z) rather than along a single cardinal axis, so, like `pylon.glb`, orientation is nominal only | "symmetric" (placed once at the finish marker, no facing check) | Yes — one checkered flag at the finish marker | Node 0 `flagCheckers` (cloth, 100 verts) + node 1 `Group` (pole, 528 verts). |

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
| `tree_default.glb` | `src/rendering/assets/nature/tree_default.glb` | Kenney (kenney_nature-kit) | https://kenney.nl/assets/nature-kit | 2026-08-10 | CC0 1.0 | 5.5m | Yes — weight 3 of 11 in the field-scatter pool, ±10% size jitter per instance | 114 triangles, flat-colour materials, no texture. |
| `tree_pineRoundA.glb` | `src/rendering/assets/nature/tree_pineRoundA.glb` | Kenney (kenney_nature-kit) | https://kenney.nl/assets/nature-kit | 2026-08-10 | CC0 1.0 | 6.5m | Yes — weight 3 of 11, ±10% jitter | 204 triangles, flat-colour materials, no texture. |
| `tree_detailed.glb` | `src/rendering/assets/nature/tree_detailed.glb` | Kenney (kenney_nature-kit) | https://kenney.nl/assets/nature-kit | 2026-08-10 | CC0 1.0 | 5.0m | Yes — weight 2 of 11, ±10% jitter | 402 triangles, flat-colour materials, no texture. |
| `rock_largeA.glb` | `src/rendering/assets/nature/rock_largeA.glb` | Kenney (kenney_nature-kit) | https://kenney.nl/assets/nature-kit | 2026-08-10 | CC0 1.0 | 0.7m | Yes — weight 1 of 11, ±10% jitter | 80 triangles, flat-colour material, no texture. |
| `rock_smallA.glb` | `src/rendering/assets/nature/rock_smallA.glb` | Kenney (kenney_nature-kit) | https://kenney.nl/assets/nature-kit | 2026-08-10 | CC0 1.0 | 0.35m | Yes — weight 2 of 11, ±10% jitter | 16 triangles, flat-colour material, no texture. |

## Vegetation & ground-cover props

Added to give the trackside/midground layers real variety beyond the
original 3 tree + 2 rock species. Same discipline as the original Nature
props table (real-world height target per asset, random full-circle yaw,
`localForwardAxis` nominal throughout — none of these are directional), but
using the fuller schema below since two entries (`log`/`log_large`) target a
length axis rather than height.

| Original filename | Local path | Provider | Source | Downloaded | Licence | Raw bbox (X,Y,Z, metres) | Target | Layer | Used? | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `grass.glb` | `src/rendering/assets/nature/grass.glb` | Kenney (kenney_nature-kit) | https://kenney.nl/assets/nature-kit | 2026-08-15 | CC0 1.0 | `[0.381, 0.254, 0.392]` | height (Y) → 0.35m | Trackside | Yes — clustered ground-cover, rendered via `InstancedMesh` | Flat-colour, no texture. |
| `grass_large.glb` | `src/rendering/assets/nature/grass_large.glb` | Kenney (kenney_nature-kit) | https://kenney.nl/assets/nature-kit | 2026-08-15 | CC0 1.0 | `[0.409, 0.254, 0.408]` | height (Y) → 0.45m | Trackside | Yes — `InstancedMesh` | Flat-colour, no texture. |
| `grass_leafs.glb` | `src/rendering/assets/nature/grass_leafs.glb` | Kenney (kenney_nature-kit) | https://kenney.nl/assets/nature-kit | 2026-08-15 | CC0 1.0 | `[0.234, 0.1425, 0.257]` | height (Y) → 0.25m | Trackside | Yes — `InstancedMesh` | Flat-colour, no texture. |
| `flower_purpleA.glb` | `src/rendering/assets/nature/flower_purpleA.glb` | Kenney (kenney_nature-kit) | https://kenney.nl/assets/nature-kit | 2026-08-15 | CC0 1.0 | `[0.159, 0.2425, 0.181]` | height (Y) → 0.3m | Trackside | Yes — `InstancedMesh` | Two flat-colour materials (stem/petals), no texture. |
| `flower_redA.glb` | `src/rendering/assets/nature/flower_redA.glb` | Kenney (kenney_nature-kit) | https://kenney.nl/assets/nature-kit | 2026-08-15 | CC0 1.0 | `[0.159, 0.2925, 0.181]` | height (Y) → 0.35m | Trackside | Yes — `InstancedMesh` | Two flat-colour materials, no texture. |
| `flower_yellowA.glb` | `src/rendering/assets/nature/flower_yellowA.glb` | Kenney (kenney_nature-kit) | https://kenney.nl/assets/nature-kit | 2026-08-15 | CC0 1.0 | `[0.159, 0.1925, 0.181]` | height (Y) → 0.25m | Trackside | Yes — `InstancedMesh` | Two flat-colour materials, no texture. |
| `plant_bush.glb` | `src/rendering/assets/nature/plant_bush.glb` | Kenney (kenney_nature-kit) | https://kenney.nl/assets/nature-kit | 2026-08-15 | CC0 1.0 | `[0.396, 0.2444, 0.396]` | height (Y) → 0.5m | Trackside | Yes | Flat-colour, no texture. |
| `plant_bushSmall.glb` | `src/rendering/assets/nature/plant_bushSmall.glb` | Kenney (kenney_nature-kit) | https://kenney.nl/assets/nature-kit | 2026-08-15 | CC0 1.0 | `[0.383, 0.2073, 0.336]` | height (Y) → 0.35m | Trackside | Yes | Flat-colour, no texture. |
| `tree_fat.glb` | `src/rendering/assets/nature/tree_fat.glb` | Kenney (kenney_nature-kit) | https://kenney.nl/assets/nature-kit | 2026-08-15 | CC0 1.0 | `[0.755, 1.1504, 0.654]` | height (Y) → 5.0m | Midground | Yes — 4th tree species in the scatter pool | Two flat-colour materials (trunk/foliage), no texture. |
| `tree_cone.glb` | `src/rendering/assets/nature/tree_cone.glb` | Kenney (kenney_nature-kit) | https://kenney.nl/assets/nature-kit | 2026-08-15 | CC0 1.0 | `[0.530, 1.4303, 0.530]` | height (Y) → 7.0m | Midground | Yes — 5th tree species, tallest/narrowest | Two flat-colour materials, no texture. |
| `plant_bushDetailed.glb` | `src/rendering/assets/nature/plant_bushDetailed.glb` | Kenney (kenney_nature-kit) | https://kenney.nl/assets/nature-kit | 2026-08-15 | CC0 1.0 | `[0.603, 0.3604, 0.603]` | height (Y) → 1.1m | Midground | Yes | Flat-colour, no texture. |
| `plant_bushLarge.glb` | `src/rendering/assets/nature/plant_bushLarge.glb` | Kenney (kenney_nature-kit) | https://kenney.nl/assets/nature-kit | 2026-08-15 | CC0 1.0 | `[0.374, 0.2429, 0.336]` | height (Y) → 1.0m | Midground | Yes | Flat-colour, no texture. |
| `rock_tallA.glb` | `src/rendering/assets/nature/rock_tallA.glb` | Kenney (kenney_nature-kit) | https://kenney.nl/assets/nature-kit | 2026-08-15 | CC0 1.0 | `[0.983, 0.996, 0.683]` | height (Y) → 2.2m | Midground | Yes — vertical accent rock, skip the geometry-duplicate `stone_largeA` | Three flat-colour materials, no texture. |
| `log.glb` | `src/rendering/assets/nature/log.glb` | Kenney (kenney_nature-kit) | https://kenney.nl/assets/nature-kit | 2026-08-15 | CC0 1.0 | `[0.234, 0.173, 0.71]` | length (Z, its long axis) → 1.8m | Midground | Yes | Two flat-colour materials, no texture. |
| `log_large.glb` | `src/rendering/assets/nature/log_large.glb` | Kenney (kenney_nature-kit) | https://kenney.nl/assets/nature-kit | 2026-08-15 | CC0 1.0 | `[1.0, 0.417, 0.549]` | length (X, its long axis) → 2.5m | Midground | Yes | Two flat-colour materials, no texture. |
| `stump_old.glb` | `src/rendering/assets/nature/stump_old.glb` | Kenney (kenney_nature-kit) | https://kenney.nl/assets/nature-kit | 2026-08-15 | CC0 1.0 | `[0.357, 0.2665, 0.371]` | height (Y) → 0.6m | Midground | Yes | Flat-colour, no texture. |
| `stump_round.glb` | `src/rendering/assets/nature/stump_round.glb` | Kenney (kenney_nature-kit) | https://kenney.nl/assets/nature-kit | 2026-08-15 | CC0 1.0 | `[0.321, 0.2065, 0.371]` | height (Y) → 0.45m | Midground | Yes | Two flat-colour materials, no texture. |

Not selected: `tree_palm.glb`/`tree_palmTall.glb` — stylistically inconsistent
with the dusk-racetrack palette (`materials.ts`'s sky/ground colours), flagged
for the user rather than silently included. Not selected: `stone_largeA.glb`
(geometry-identical to `rock_largeA.glb`, already vendored) and
`mini-forest`'s `patch-grass`/`patch-dirt` (flat 1×1 tiles — rejected in
favour of native ground geometry for off-road colour variation, since a
1-unit tile GLB would visibly tile at this scene's scale).

## Distant/horizon props

Populate the 80–180m distance band as a low-poly, no-shadow horizon —
mini-forest for a forest line/rock formations, nature-kit's own flat-colour
cliff blocks stacked as a procedural hill silhouette, and one parked van from
the car kit for scale variety. `cliff_large_rock.glb`/`cliff_top_rock.glb`
are nature-kit files and live in `src/rendering/assets/nature/` alongside the
rest of that pack (flat-colour, no loader override needed) even though their
*role* is the distant layer — only mini-forest's own two files and the van
needed the new `src/rendering/assets/distant/` directory, because mini-forest
is the only file set in this pack that needs its own texture.

**Load-bearing discovery for the asset-loader redesign:** `van.glb`
(car-kit) and `tree.glb`/`tree-high.glb`/`rocks-high.glb`/`rocks-low.glb`
(mini-forest) all live in the same `src/rendering/assets/distant/` directory
*and all reference the same relative URI* `Textures/colormap.png` — but
`van.glb` needs the vehicle kit's colormap (confirmed byte-identical via
SHA1, `08e404fd…`) while the mini-forest files need mini-forest's own,
genuinely different colormap (SHA1 `6dcc240e…`). Same directory, same
relative URI, two different real images required — proof that neither
URL/basename inspection nor a directory-based prefix convention can
disambiguate this; only an explicit `pack` field per asset (dispatching to
its own `THREE.LoadingManager`) resolves it. See `asset-loader.ts`.

| Original filename | Local path | Provider | Source | Downloaded | Licence | Raw bbox (X,Y,Z, metres) | Target | Confirmed local forward axis | Used? | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `tree.glb` | `src/rendering/assets/distant/tree.glb` | Kenney (kenney_mini-forest_1) | https://kenney.nl/assets/mini-forest | 2026-08-15 | CC0 1.0 | `[0.927, 1.684, 0.883]` | height (Y) → 9.0m | nominal (random yaw) | Yes — distant forest-line filler | References its own `Textures/colormap.png` (SHA1 `6dcc240e…`), loaded via the new mini-forest-scoped `THREE.LoadingManager`. |
| `tree-high.glb` | `src/rendering/assets/distant/tree-high.glb` | Kenney (kenney_mini-forest_1) | https://kenney.nl/assets/mini-forest | 2026-08-15 | CC0 1.0 | `[0.927, 2.284, 0.883]` | height (Y) → 12.0m | nominal (random yaw) | Yes — taller distant forest-line filler | Same mini-forest colormap as `tree.glb`. |
| `rocks-high.glb` | `src/rendering/assets/distant/rocks-high.glb` | Kenney (kenney_mini-forest_1) | https://kenney.nl/assets/mini-forest | 2026-08-15 | CC0 1.0 | `[1.0, 1.0, 1.0]` | height (Y) → 5.0m | nominal (random yaw) | Yes — distant rock formation | Same mini-forest colormap. |
| `rocks-low.glb` | `src/rendering/assets/distant/rocks-low.glb` | Kenney (kenney_mini-forest_1) | https://kenney.nl/assets/mini-forest | 2026-08-15 | CC0 1.0 | `[1.0, 0.523, 1.0]` | height (Y) → 3.0m | nominal (random yaw) | Yes — smaller distant rock formation | Same mini-forest colormap. |
| `cliff_large_rock.glb` | `src/rendering/assets/nature/cliff_large_rock.glb` | Kenney (kenney_nature-kit) | https://kenney.nl/assets/nature-kit | 2026-08-15 | CC0 1.0 | `[1.0, 1.0, 0.4185]` | height (Y) → 14.0m | nominal (random yaw) | Yes — base block of the procedural hill/horizon silhouette | Flat-colour, no texture — skip the geometry-duplicate `cliff_large_stone.glb`. |
| `cliff_top_rock.glb` | `src/rendering/assets/nature/cliff_top_rock.glb` | Kenney (kenney_nature-kit) | https://kenney.nl/assets/nature-kit | 2026-08-15 | CC0 1.0 | `[1.0, 1.0, 0.2685]` | height (Y) → 9.0m | nominal (random yaw) | Yes — cap block stacked above `cliff_large_rock` instances | Flat-colour, no texture. |
| `van.glb` | `src/rendering/assets/distant/van.glb` | Kenney (kenney_car-kit) | https://kenney.nl/assets/car-kit | 2026-08-15 | CC0 1.0 | `[1.5, 1.35, 2.75]` | length (Z) → 5.0m | **+Z** — four wheel nodes confirmed by translation, front pair at local `z=+0.76` (identical convention to `sedan.glb`'s own wheel nodes) | Yes — one distant parked vehicle near the pit cluster, for scale variety and visual distinction from the sedan | References `Textures/colormap.png`; confirmed **byte-identical** (SHA1 `08e404fd…`) to the already-vendored vehicle colormap, so it reuses `ASSET_PATHS.vehicleColormap` via the vehicle-scoped `THREE.LoadingManager` — zero new texture file needed. Decorative only; not physics-driven, so it is not scaled by `VEHICLE_SCALE`. |

## Conversion notes

None of these files were re-exported or edited. Each pack ships a "GLTF
format" (or, for the car kit, "GLB format") folder containing binary `.glb`
files directly — despite the folder name, `kenney_racing-kit`'s and
`kenney_nature-kit`'s "GLTF format" folders contain single-file binary GLBs,
not `.gltf` + separate `.bin`/textures, confirmed by parsing each file's
12-byte glTF binary header. These were copied byte-for-byte into
`src/rendering/assets/`.

Each subfolder (`vehicle/`, `track/`, `nature/`) also contains a copy of
that pack's `License.txt`, even though CC0 does not require attribution.
