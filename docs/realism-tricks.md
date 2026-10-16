# Baked building depth

Owner constraints: `OWNER-DECISIONS.md`. OSM base with optional near detail layers within budgets. All added shading is baked/unlit; no new lights, reflection views or screen-space effects.

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

## Sign mounting

`signFaceOffset(postDepth, thickness = .02)` places a panel's front beyond the
whole post, its panel thickness, and a 5 mm mounting gap. The face normal is
local +Z. Offset along the rotated normal for world-space instances. Keep
collider centres at the original post. One-way direction boards face their
own carriageway; reverse approaches use their separately authored records.
`twoSidedSignGeometry(width, height, postDepth)` joins two outward-facing,
readable panels into one draw call for event banners. Do not use DoubleSide
text or a negative scale to create the reverse face. Reset all Euler axes
when turning a cloned face (a cloned quaternion can use a different Euler
representation). Megara's cantilever and lettering use the road frame;
vehicle heading is not a sign-panel rotation.

The actual-geometry guard is `tools/sign-mount.test.mjs`, covering mapped
sign instances on Riviera, Penteli, Megara and Psychiko, fixed and event
arches, roadside parking/stop models and Psychiko roadworks. Existing
13,510 cockpit spawn/grid raycasts remain green after the Megara correction.
Focused before/after views and resource counts: `.scratch/detail-pass/signs/`.

## OSM detail layers (owner, 2026-10-16)

The base remains the mapped road/elevation/footprint world. `WorldDetail` adds
nearby decoration through two bounded instanced draws: at most 240 shaded
boxes and 96 tree cards. It indexes source records in 80 m cells, visits the
near rings only, and reuses the same GPU buffers. Refresh occurs after 12 m of
camera movement; idle calls return immediately. Props end at 160 m; trees use
boxes below 135 m and cards out to 240 m. Facade atlas detail fades over
160–240 m on the existing ≤40-triangle building shells. No real lights,
shadows, reflections or post passes are added.

`World detail` is a saved boolean, default true. `worldDetailEnabled` is the
shared terrain/facade uniform. The live controller hides its entire group and
releases facade/tree maps when disabled, restoring them when enabled. Off
retains existing roads, signs, terrain colour and plain footprint boxes.

### Generator/AWT contract

Building records may carry `facadeStyle` (integer 0–7) and `detailSeed`
(unsigned 32-bit integer). Styles in order: plaster, balconies, shutters,
awnings, shops, offices, masonry, industrial. Default style follows building
type; absent seeds use FNV-1a over UTF-8 `way/<OSM id>` (or the producer's
`relation/<OSM id>`). `src/world-detail-policy.js` is browser-independent and
shared with offline tooling. Preserve base geometry budgets.

Optional `vegetation` records are `{x,z,seed,kind,height?,source}` in the
producer's existing coordinate frame; `kind` is broadleaf, conifer or palm,
height in metres. Point trees retain `node/<id>` provenance; tree rows and
area fills identify their source way plus a deterministic sample suffix.
Legacy bundled area polygons lacking feature IDs explicitly use
`osm-area/<map>/<landuse>/<polygon hash>` rather than inventing OSM IDs.
`tools/build-detail-records.mjs` derives current-map records from cached OSM
nodes, rows and landuse polygons, then excludes roadway and footprint
intersections at runtime. No network fetch is needed.

`WorldDetail` is exported from `src/world-detail.js`. For an existing map, its controller is available as `world.group.getObjectByName("world-detail-layers").worldDetailController`.

For streaming tiles, call `detail.addRecords(tileKey, records)` on activation
and `detail.removeTile(tileKey)` on eviction. Runtime decoration records use
`kind:'tree'` plus `treeKind`, world `x,y,z`, `seed`, `height`; roof records use
`kind:'roof'`, `style`, `width`, `depth` and roof-top `y`. Transform tile-local
coordinates to world coordinates before registering. Re-registering a tile
replaces its records; eviction removes ownership without allocating new
meshes. The renderer's instance caps apply across all resident tiles.

Psychiko placement uses its cached OSM tree nodes, tree rows, gardens/parks
and the original garden-version source data; road layout, roadworks and
race/lap definitions remain unchanged.

Facade vertex contract: `aFacade` is a float vec4 of `(bayU, floorV, style,
roofFlag)`. Bay width is 5.5 m, floor height 3.1 m; roofFlag=1 leaves the
roof flat-coloured. `facadeCoordinates(geometry,{style,base,cx,cz})` produces
it for an individual shell before batching; offline packing can emit the
same values directly. Preserve this attribute while merging. Use
`attachFacadeAtlas(material, sharedAtlas)` and `createFacadeAtlas()` once per
map/resource owner. Do not allocate an atlas per building or per tile.

The canonical AWT wire extension is specified in `docs/world-tiles-format.md`: building `facadeStyle` Uint8 and `detailSeed` Uint32 (no `roofPropSeed` alias); vegetation `positionHeight` Float32 stride 4, `kind` Uint8 (0 broadleaf, 1 conifer, 2 palm), and `seed` Uint32. All five arrays are present when the extension is enabled. Split building parts retain the original feature seed. Zero tree height selects the current 5.5 m default.
