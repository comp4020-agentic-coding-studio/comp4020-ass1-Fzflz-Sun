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
| `sedan.glb` | `public/assets/vehicle/sedan.glb` | Kenney (kenney_car-kit) | https://kenney.nl/assets/car-kit | 2026-08-10 | CC0 1.0 | Used as-is, no re-export. ~2032 triangles. Four independently addressable wheel nodes confirmed by inspecting node translations: `wheel-front-left` (0.3, 0.3, 0.66), `wheel-front-right` (-0.3, 0.3, 0.66), `wheel-back-left` (0.3, 0.3, -0.66), `wheel-back-right` (-0.3, 0.3, -0.66) — front wheels at local `z = +0.66` confirms the model's local forward axis is **+Z**. The `body` mesh's own material (the shared `colormap` atlas below) is overridden at load time in `vehicle.ts` with a flat warm-ivory `MeshStandardMaterial` (`materials.ts`'s `createBodyMaterial`) — the sedan's baked-in factory red-orange paint clashed with the dusk palette, and `body`/window glass share one mesh/material with no separable region, so a full flat-colour override was the only way to hit the specified body colour. Wheel nodes keep the atlas texture; only `body` is overridden. |
| `Textures/colormap.png` | `public/assets/vehicle/Textures/colormap.png` | Kenney (kenney_car-kit) | https://kenney.nl/assets/car-kit | 2026-08-10 | CC0 1.0 | The GLB's one material references this 512×512 atlas by an external relative URI (`Textures/colormap.png`, confirmed by parsing the GLB's embedded glTF JSON `images` array) rather than embedding it — this path must be preserved next to `sedan.glb` or `GLTFLoader` fails to resolve the texture. |

## Track props

| Original filename | Local path | Provider | Source | Downloaded | Licence | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `barrierWhite.glb` | `public/assets/track/barrierWhite.glb` | Kenney (kenney_racing-kit) | https://kenney.nl/assets/racing-kit | 2026-08-10 | CC0 1.0 | 28 triangles, one flat `baseColorFactor` material, no embedded texture. Used as a guardrail/barrier. |
| `lightPostModern.glb` | `public/assets/track/lightPostModern.glb` | Kenney (kenney_racing-kit) | https://kenney.nl/assets/racing-kit | 2026-08-10 | CC0 1.0 | 198 triangles, two flat-colour materials, no texture. Used as the reflective roadside post. |
| `pylon.glb` | `public/assets/track/pylon.glb` | Kenney (kenney_racing-kit) | https://kenney.nl/assets/racing-kit | 2026-08-10 | CC0 1.0 | 108 triangles, one flat orange material, no texture. Used as the cone/track marker. |

## Nature props

| Original filename | Local path | Provider | Source | Downloaded | Licence | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `tree_default.glb` | `public/assets/nature/tree_default.glb` | Kenney (kenney_nature-kit) | https://kenney.nl/assets/nature-kit | 2026-08-10 | CC0 1.0 | 114 triangles, flat-colour materials, no texture. |
| `tree_pineRoundA.glb` | `public/assets/nature/tree_pineRoundA.glb` | Kenney (kenney_nature-kit) | https://kenney.nl/assets/nature-kit | 2026-08-10 | CC0 1.0 | 204 triangles, flat-colour materials, no texture. |
| `tree_detailed.glb` | `public/assets/nature/tree_detailed.glb` | Kenney (kenney_nature-kit) | https://kenney.nl/assets/nature-kit | 2026-08-10 | CC0 1.0 | 402 triangles, flat-colour materials, no texture. |
| `rock_largeA.glb` | `public/assets/nature/rock_largeA.glb` | Kenney (kenney_nature-kit) | https://kenney.nl/assets/nature-kit | 2026-08-10 | CC0 1.0 | 80 triangles, flat-colour material, no texture. |
| `rock_smallA.glb` | `public/assets/nature/rock_smallA.glb` | Kenney (kenney_nature-kit) | https://kenney.nl/assets/nature-kit | 2026-08-10 | CC0 1.0 | 16 triangles, flat-colour material, no texture. |

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
