# Baked building depth

Owner constraints: `OWNER-DECISIONS.md`. Plain blocks, no facade details, vegetation, new lights, reflection views or screen-space effects.

`src/baked-realism.js` exports `bakeBlockShade(batch, start, base, top, key?)`. It modifies the existing linear RGB colours of a `GeoBatch` after `add()` and before `build()`. Save `batch.count` before adding each block and pass that as `start`. Positions and normals must already be in world space; `base` and `top` are world Y bounds. Call once per newly appended block. Do not apply to an already shaded batch.

Roofs retain their palette colour. Vertical faces retain 65–85% of it according to a fixed south-west key; bottom vertices receive a further 16% darkening, interpolated over the existing wall triangles. This is a broad modelling cue, not physically accurate ambient occlusion or a narrow contact shadow. No extra vertices, colour attributes, textures, materials, draw calls or frame callbacks. Existing building materials and their day/night response are unchanged.

The default key is a normalized horizontal day-sun direction (azimuth 205 degrees). It deliberately stays fixed through the clock cycle: no runtime rebake or animated shadow. An offline Athens tile generator can pass its own normalized `{x,z}` key consistently for the whole tile set. Serialize the resulting colour buffer with the existing position/normal buffers. Do not bake again when restoring the tile. `buildBuildings()` uses this helper for Riviera, Penteli, Megara and Psychiko.

Chosen scope: face shading and base darkening. Existing cars already have contact blobs. Extra decals, street furniture, additive cards and motion effects are deferred: they add geometry, overdraw or view changes and need separate visual justification. Windows remain forbidden by the owner's plain-building decision.

Verification: `node --test tools/baked-realism.test.mjs`; `node tools/realism-benchmark.mjs`; `tools/browser-slot.sh node tools/realism-browser.mjs`. The benchmark requires `.scratch/realism/before-buildings.js`, extracted from the baseline commit, and measures paired alternating whole-building builds after warmup. Screenshot capture loads the baseline building source, builds candidate colour buffers with the same terrain height sampler, asserts exact position/normal equality, and swaps only the colour buffers in one frozen scene for each pair. This prevents actors from moving between before/after. Camera poses and full-scene renderer counters are recorded in `.scratch/realism/paired-report.json`. GPU timing on SwiftShader is not a performance claim.

## Rain overlays

`src/rain-overlays.js` shares a deterministic 128×128 RGBA DataTexture (64 KiB, no mipmaps): red holds sparse streaks, green a soft mist card, blue a puddle mask, alpha a foam ring. `createRain()` draws two scrolling camera-space planes in one instanced call (four triangles). Depth testing lets nearby cockpit geometry occlude the rain. The layers are at 3 and 9 metres; they are intentionally a screen-covering weather cue, with no individual droplet simulation or world collision. The camera can rotate without rebuilding anything.

`SprayCards.begin()/add()/update()` fills a fixed pool of 18 cards, two rear-wheel wakes for at most nine nearby moving cars. Wakes are anchored to the cars and have no particle lifetimes, velocity integration or allocation pool. Dry/stopped cars submit no cards. All cards batch into one draw. `WaterSplash` uses one expanding mist billboard plus one expanding foam decal for water-entry feedback (four triangles, two calls), retaining the multiplayer reset interface.

Road materials sample the blue channel in world XZ, darkening wet asphalt and isolated puddle patches. This adds no decal meshes/draw calls and no animated ripple normals, reduced roughness or reflection passes. The texture is shared across maps and materials; Athens tiles should use the same world-space UV scale (`worldXZ * 0.035`) so tile boundaries match. This is a visual mask only: `wet-grip.js` continues to control accumulation, drying and tyre grip. Existing road-light hooks and the cockpit agent's single windscreen overlay are preserved.

The atlas is a module-lifetime shared resource, not owned by individual weather scenes. Weather geometries/materials are disposed on map changes; do not dispose the shared atlas from a map's teardown. Guard: `tools/rain-overlays.test.mjs`. CPU benchmark: `tools/rain-benchmark.mjs` (baseline helper source extracted from the recorded parent SHA). No GPU timing claims on SwiftShader.
