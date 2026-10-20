# Athens beauty pass (2026-10-20)

Owner decision 2026-10-20: the open world must feel like Athens, with detail inside the performance budgets. Locked look unchanged: Lighting OFF, Effects OFF, no shadow maps, no post effects. Everything here is unlit vertex colour, shows only at `?map=athens`, and **World detail Off removes it** (the old building boxes come back).

## Step 1: landmarks and the mountain ring

- **Landmarks** (`src/athens-landmark-models.js`, sites in `src/athens-landmark-data.js` from `tools/world-gen/landmarks.py`, layer in `src/athens-landmarks.js`): the Acropolis with Parthenon, Erechtheion, Propylaia and the Athena Nike bastion; the Parliament; the Zappeion; the Panathenaic Stadium; the Temple of Olympian Zeus; Hadrian's Arch; the chapel on Lycabettus. Each is one non-indexed vertex-colour geometry (about 3,800 triangles for all seven), one draw call, placed at its OSM footprint. Walls are shaded from the same fixed NW sun as the facade shader, so they read as lit without a light.
- **Standing on the ground:** `fitHeight` takes the height from the streamed ground. The Parliament and the Zappeion stand level with the street they face (`fit: 'front'`: median of three rows in front of the entrance) on a paved forecourt and steps; the Olympieion, Hadrian and the chapel stand on the highest ground under them, the stadium on the median. Plinths and skirts are buried, so no base floats; a falling street shows a retaining wall, never an underside.
- **Far landmarks:** one beyond the camera's far plane is drawn at 96 % of it, scaled by the same ratio (a perspective camera cannot tell), with a haze that grows with distance, so the Acropolis stays on the skyline above Plaka.
- **Replaced boxes:** the OSM buildings a model replaces (ids in `LANDMARK_HIDDEN`) stay in their cell as hidden meshes, so Off shows them again. Street monuments and fountains inside a landmark's forecourt are skipped by `AthensProps` while detail is on.
- **Mountain ring** (`src/athens-horizon.js`, data `assets/athens/horizon.bin` from `tools/world-gen/horizon.py`, 78 KB): Hymettus, Penteli, Parnitha and Aigaleo. A coarse max-pooled DEM grid; from the camera every azimuth is ray-walked in three distance bands; each band is an opaque strip at the far plane (like the sky), far band first, near ridges over it, coloured greener near and bluer and lighter far, fading into the fog colour at the foot so there is no bottom edge. It rebuilds every 250 m of driving (about 20 ms).

No cell changes, so nothing has to be rebaked for step 1.
