# Athens world tiles, AWT/1

Status: **Draft v1.3**, generator/runtime interchange contract, 2026-10-15. Schema identifier **`AWT/1`**, integer `tileVersion: 1`. Validator: `src/world-tile-format.js`, `validateWorldTile({metadata, arrays})`; run `node tools/validate-world-tiles.mjs <manifest.json>` on an emitted directory. This document supersedes the scenery, graphics-preset and street-photo requirements in the research plan. Bare OSM road shapes, clean elevation terrain, plain building boxes (at most 40 triangles per building), racing signs/gantries; the base layer has no vegetation or beach props. The owner-authorized optional World detail layer below supersedes the earlier blanket vegetation prohibition. One Lighting Off / Effects Off look. Terrain colour varies with slope, elevation and OSM landuse: dry earth, rock, scrub tones, coastal sand and urban ground. Building colours are white/light plaster, light greys and muted Greek accents; building colours must not reuse beige terrain tones. Scrub is a terrain colour category, never vegetation geometry. Bake these colours offline into the shared palette/normalised vertex-colour attributes; no per-tile textures or runtime style selector.

## Coordinates and ownership

512 m square cells. The measured existing-road spike has 47 Riviera, 5 Megara and 40 Penteli occupied cells at this spacing (research `tile-spike.json`). 256 m would quadruple terrain cell requests and seam work; 512 m needs only 33×33 coarse heights at 16 m spacing and provides 7.37 seconds crossing time at 250 km/h. This is the measured starting choice; changing it requires a new schema.

Athens world projection is equirectangular: `lat0=37.98`, `lon0=23.73`, `mlat=111320`, `mlon=111320*cos(lat0*pi/180)`. `x=(lon-lon0)*mlon`, `z=(lat0-lat)*mlat`, metres, +Y up, +X east, +Z south. Manifest stores these exact constants and vertical datum/source. Heights are metres above the manifest datum; never derive bridge elevation from OSM layer. Existing maps retain their projection in separate world manifests; generator reprojects once when joining them. Logical/game/network/replay coordinates are double world metres. Only rendering coordinates subtract a floating origin.

Cell `(tx,tz)` owns `[512tx,512(tx+1)) × [512tz,512(tz+1))`. Metadata `origin:[512tx,0,512tz]`. All positions in tile tables are local XYZ metres except building corner XZ and global graph IDs. Boundary vertices lie on the closed square for triangulation; an exact boundary contact query selects the half-open owner. Clip triangles at cell boundaries; never partition by centroid. Road ribbons, junction polygons, contacts and fine terrain share the same canonical border vertices. No overlapping contact owners. Crossing buildings belong to their centroid cell; manifest tile `dependencies` names each distinct owner cell whose actual footprint intersects the tile with positive area (not merely its bounding box); omit the tile itself. Duplicate IDs across a tile's rows are forbidden.

Solve elevations and road profiles globally before clipping. Bake with >=64 m halo, or larger than every conformance filter. Ground-level roads constrain terrain; bridges/tunnels preserve separate layers, portal/deck transitions and clearance. Canonical boundary XZ uses a global millimetre lattice; boundary Y is one shared Float32 value, copied bit-for-bit by neighbours. No independent per-tile DEM/conformance pass. Marking station distances are global along the graph edge. Fine terrain boundary must include coarse 16 m samples; transition triangles stitch every intermediate vertex, including LOD changes. Skirts cannot serve as contacts. Road intrusion <=5 mm, road/shoulder step <=0.15 m and shoulder slope <=30 degrees over 6 m remain acceptance gates.

## Container and typed arrays

Each `.bin.gz` is a gzip member containing **the shared** `encodeGeometryPack` container from `src/baked-geometry.js`; consume `decodeGeometryPack` (or its shared asynchronous ASR2 entry point). Do not create another codec. ASR1/ASR2 wire version belongs to that codec, independently of `tileVersion`. Meshopt belongs inside the shared codec. Keep Uint16 terrain XYZ plus Float32 height residual, normalized Int8 normals / Uint8 colour and terrain blend, Uint16 indices and `terrainDecode` from `935cc47` / `src/terrain-layout.js`. Decode/render/contact must reconstruct the same surface. Never quantize away a contact profile. Split render meshes before 65536 vertices. Table integer positions use Uint32 array indexes into the pack's `arrays`; JSON is only descriptors, strings and sparse metadata.

Required metadata:

```
{ tileVersion:1, world:"athens", revision:"<source/build sha256>",
  cell:[tx,tz], origin:[tx*512,0,tz*512],
  tables:{ <names below>: <array index> },
  strings:["", ...], ids:["", "osm:way:123", ...],
  meshes:[ /* shared packGroup mesh descriptors; material is palette index */ ],
  palette:[[r,g,b],...], // linear RGB in [0,1], <=256 entries
  terrain:{ coarseSize:33, spacing:16 },
  budgets:{ triangles:<integer>, buildingTriangles:<integer <=40 per building> } }
```

Every table is required, using a zero-length array for absent features. IDs in rows reference `ids`; index zero means unknown/none only where explicitly allowed. IDs are stable world-wide strings, retaining full 64-bit OSM IDs. Node/edge references are **world ID indexes**, resolved through each tile's ID dictionary, not array row numbers; dictionary order may differ between tiles. Portals repeat node IDs/positions exactly. Strings are UTF-8 JSON, zero is the empty string. Attribute/table arrays may alias a shared underlying buffer; count unique buffers once for residency. All arrays are little-endian on wire through the codec. When using the existing ASR1 byte-plane encoder hints, copying every array (including Uint8 colours) releases the raw decompression container after decode; mixing copied arrays with a byte view can retain both allocations. Compare unshuffled and all-plane gzip output offline. Keep this choice inside the shared codec API, and measure unique backing-buffer residency.

| Table | Type / stride | Fields, in order |
|---|---|---|
| `nodes` | Uint32 / 2 | nodeId, positionIndex |
| `nodePositions` | Float32 / 3 | local x,y,z |
| `edges` | Uint32 / 10 | edgeId, fromNodeId, toNodeId, firstPoint, pointCount, nameString, laneCount, speedKph, flags, surfaceId |
| `edgePoints` | Float32 / 3 | local x,y,z; directed order |
| `edgeLayers` | Int8 / 1 | OSM layer for each edge; ordering only |
| `turns` | Uint32 / 4 | fromEdgeId, viaNodeId, toEdgeId, rule (0 allowed connector, 1 prohibited, 2 only) |
| `ribbons` | Uint32 / 5 | surfaceId, edgeId, firstVertex, vertexCount, materialIndex |
| `ribbonVertices` | Float32 / 5 | local x,y,z, globalStationMetres, signedLateralMetres; triangle-list spans, vertexCount divisible by 3 |
| `junctions` | Uint32 / 5 | surfaceId, nodeId, firstVertex, vertexCount, materialIndex |
| `junctionVertices` | Float32 / 3 | local x,y,z; simple polygon in clockwise XZ order |
| `markings` | Float32 / 7 | edgeIdIndex, stationStart, stationEnd, lateral, width, dashLength, gapLength |
| `contactPositions` | Float32 / 3 | local x,y,z; exact surface, not lowered decorative asphalt |
| `contactTriangles` | Uint32 / 5 | vertexA, vertexB, vertexC, surfaceId, flags |
| `contactLayers` | Int8 / 1 | layer per contact triangle |
| `coarseHeights` | Float32 / 1 | exactly 1089 heights, row-major Z then X; includes both edges |
| `finePositions` | Float32 / 3 | adaptive road-conformed terrain x,y,z, 1–4 m near road |
| `fineTriangles` | Uint32 / 3 | vertexA, vertexB, vertexC; same diagonal/contact surface as rendered terrain |
| `buildings` | Uint32 / 4 | buildingId, firstCorner, cornerCount (4–14), colourIndex |
| `buildingCorners` | Float32 / 2 | local x,z, clockwise simple footprint, concave allowed; split multipart outlines into stable part IDs |
| `buildingHeights` | Float32 / 2 | baseY,height per building; height >0; walls + triangulated roof, no hidden bottom: triangles=3*cornerCount-2 <=40 |
| `signs` | Uint32 / 4 | signId, positionIndex, kind (0 speed,1 direction,2 gantry), textString |
| `signTransforms` | Float32 / 5 | local x,y,z,yawRadians,widthMetres; one transform per sign |
| `anchors` | Uint32 / 5 | anchorId, positionIndex, edgeId, kind (0 spawn,1 tow,2 race,3 parking), nameString |
| `anchorTransforms` | Float32 / 4 | local x,y,z,yawRadians; one transform per anchor |

Edge flags bits: 0 one-way (every edge is directed; two-way roads emit reverse edges), 1 bridge, 2 tunnel, 3 restricted, 4 primary race route. Contact flags bits: 0 drivable asphalt, 1 terrain, 2 shoulder, 3 barrier. `surfaceId` is a world ID dictionary index. Unknown lane/speed is 0; routing must apply manifest defaults explicitly. Reverse edges share physical surface IDs but never duplicate contact triangles. Lane count describes travel direction; explicit lane-specific turn restrictions use separately identified lane edges. Layer arrays align with rows. Markings' edge ID indexes must be exactly representable as Float32 (<2^24); other ID fields use Uint32. On clipped edges, endpoints are stable portal nodes, edge IDs use `osm:way:<id>:<segment>:<direction>:<cell>`; `ids` also retains original way IDs. No fabricated connectivity at planar crossings with different layers.

Render only the fine mesh near roads; coarse heights may remain metadata/contact fallback without a second overlapping rendered mesh. Render meshes are accelerators of these canonical surfaces, using the shared packGroup descriptors and terrain layout. They must cover all rendered roads, terrain, boxes and signs. A tile may split meshes by material and bounded activation job; each activation draw <=16384 triangles. A tile-wide shared attribute table may contain up to 524288 vertices; use Uint32 indices above 65535. A draw references at most 49152 vertices. Sharing the exact canonical Float32 contact positions is allowed when it costs less than a separate quantized render table; quantized rendering uses the existing terrain layout and residual, never a second codec. Offline validator checks structural tables; generator must additionally validate polygon winding, triangle area, grade separation, actual rendered/contact equivalence and shared-edge equality. `validateTileSeam(a,b)` checks canonical boundary vertices for exact equal heights; run for every adjacent emitted pair, both terrain and contacts. Seam validation does not substitute for manifold/topology checks.

## Manifest, deployment and caching

```
{ tileVersion:1, world:"athens", revision:"<sha256>", tileMetres:512,
  projection:{lat0:37.98,lon0:23.73,mlat:111320,mlon:<computed>},
  elevation:{datum:"...",source:"...",sha256:"..."},
  defaults:{speedKph:50}, palette:[[...]],
  spawn:{cell:[0,0],anchor:"spawn:..."},
  tiles:{ "0,0":{url:"./0-0-<sha256>.bin.gz",sha256:"<64 hex>",
    bytes:<compressed>,decodedBytes:<upper bound including indexes and render buffers>,
    dependencies:[],triangles:<integer>} } }
```

URLs resolve relative to manifest, not document. Hash is SHA-256 of compressed bytes and verified before decompression. Unknown schema/revision fails closed. Limits: <=25 MiB/file, <=20000 deployed files including immutable copies; enforce after final release packaging. Current recorded full deployment census is 1336 files / 182780523 bytes, largest 19689560 bytes (`research/athens-open-world/deploy-inventory.json`); rerun for each release. Three-map spike adds at most 92 road cells plus terrain cells. Whole-Attica research has 10664 occupied 512 m cells: with immutable duplicates, individually published tiles alone would exceed 20000. Bundle **when measured inventory requires it**: <=24 MiB region files containing independent gzip tile members; optional entry `range:{offset,length}` names that member. Verify entry hash on exactly that range, require 206 and matching Content-Range; a 200 response must not silently allocate a region. Never gzip a whole range bundle again. Index stays JSON, versioned and content hashed. R2 is unnecessary until measured packed files exceed the static allowance.

Existing release-cache publishes content-addressed immutable copies and the service worker caches `/data/` only on demand. Individual tile files use that path unchanged. Range members need a separate content-hash cache key; Cache Storage cannot store 206 responses: cache validated member bytes as synthetic 200 under `/_tile/<sha256>`. Never intercept unrelated audio ranges or eagerly download all region bundles on install. Range support must be proven against staging before switching packed regions on.

Planning target, **not measured output**: 0.25–1 MiB compressed/km² for simple terrain/boxes/roads, <=32 MiB resident CPU+GPU initial neighbourhood, <=6 MiB startup map bytes. Offline generator reports actual bytes/km² using covered tile area (including sparse cells), per-feature triangles, maxima and source hashes. No textures per tile. For 100/1000/10000 monthly players at 10 MiB tile downloads/player, transfer is 0.98/9.77/97.66 GiB. Static-assets delivery is $0 for those three scenarios under the published free/unlimited static-request pricing, excluding existing multiplayer/account costs and any paid plan ([Cloudflare billing](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/), checked 2026-10-15). Request handling must route immutable assets directly to ASSETS rather than count every tile against Worker dynamic-request quota. No R2 charge is budgeted. Repeat-visit service-worker cache hits reduce transfer further; they are not assumed in the figures.

## Runtime and release gates

Absent → loading → preparing → ready → active → retiring → disposed. Fetch/decompress/decode/build contact indexes in workers with bounded inflight jobs and reservations. Use revision + request generation to drop stale transfers. Precompute geometry descriptors and bounds in workers. On the main thread, allocate GPU buffers and upload at most 32 KiB per iterator step, build bounded mesh objects, then attach atomically, target <=4 ms/frame; a single unbounded synchronous callback cannot meet that promise. Warm declared render/program variants and their first draw at map start, before control; reject undeclared variants during play. Reserve two decoded byte budgets plus compressed bytes per inflight decode, covering the decompression container and decoded copies. Account compressed/transient buffers, retained backing buffers, CPU contacts/graph, GPU bytes and shared assets with references. Evict unpinned LRU detail before contacts; preserve 20% headroom. Keep spawn, last-safe and pending tow cells pinned; never step physics into an unready cell. Teleports await target neighbourhood before moving actors, then release old pins. Generated-city failures retain safe contacts and expose retry; never generate an entire city as fallback. The existing three-map migration may automatically restore its legacy map on startup failure, without a settings change.

Safety ring around player, cosmetic outer rings and >=1 km velocity lookahead at 250 km/h; increase by measured p95 fetch/decode latency plus five seconds. Budget admission precedes allocation. Atomic render/contact activation, canonical seam geometry and neighbour-aware LOD ensure crack-free contact/render. Origin rebase in 512 m increments beyond 2048 m render displacement; logical routes, multiplayer/replay coordinates and hashes stay in global metres. Rebase camera, visible objects, particles and physics adapters atomically in a frame, including pending worker results. Distant Athens coordinates remain double until subtraction.

Feature flag remains opt-in until ALL three existing-map integrations and acceptance gates pass: Riviera/Penteli >=50% startup transfer and >=40% resident map-data reduction; Megara <=10% regression; ten cold and ten warm time-to-control starts per map; no decode/activation main task >50 ms; twenty real minutes high-speed/reversal/teleport with zero missing-contact frames and memory plateau within 5%; existing race/traffic/rival/tow/police/multiplayer/replay/terrain/physics gates. Menu boot allocates no worlds. A scheduler unit test or offline partition benchmark alone does not meet these gates.


Generator handoff: the original Riviera route-start coordinate is a connection
reference, not a generated-world spawn. Its Athens projection is approximately
`[4563.66367,18641.59686]`, cell `[8,36]`, between carriageways. The generator's
road-match evidence identifies public one-way layer-0 `osm:way:459160388`
(Ποσειδώνος, 6.4 m width), with centre projection
`[4559.38514,18642.95518]`, 4.49 m from that nominal point. The opposite
carriageway is `osm:way:459160393`. Require the generator's lane/contact-validated
anchor with the emitted manifest before using it as a spawn; neither approximate
point above is approved for placement. Evidence is the generator's
`.scratch/athens-world/riviera-road-match.json`.


Generated-world entry must use `WorldTileStream.spawn(move, {halfWidth,
halfLength})` with the actual vehicle footprint. It resolves the emitted spawn
anchor (kind 0 spawn or kind 1 tow) only after activation, checks its public directed edge and matching
physical surface/layer, and requires contact below the complete footprint.
A cell centre or nearby graph projection is not an approved fallback. Anchor
yaw follows the vehicle convention: forward is `[-sin(yaw), -cos(yaw)]` in XZ.
The legacy three-map adapter keeps its existing route placement while migration
is gated; that placement is not an approved generated-city anchor.

Region bundles are emitted with `node tools/pack-world-tiles.mjs <world.json>
<empty-output-directory>`. The tool preserves each compressed tile and SHA-256,
orders cells spatially, caps bundles at 24 MiB, and writes a Range index in the
new `world.json`. Deploy the output directory, without the individual source
tiles. `validate-world-tiles.mjs` reads only the selected range and retains four
edge hashes per tile. Immutable range caching stores only requested slices,
keyed by bundle content hash plus byte interval, and reconstructs a 206 response;
cache quota denial still permits the validated network response.


### Building owners: bounded one-hop requests (AWT/1 clarification, 2026-10-16)

`dependencies` contains only direct building-owner cells. For each independently
requested base cell B, the complete required set is `{B} ∪ dependencies(B)`.
Loading an owner from this set does **not** recursively request its dependencies.
An owner becomes a base only when independently selected by a player/actor ring,
velocity prefetch, contact footprint, spawn pin or tow/teleport target. Union the
sets for all such base requests; deduplicate tile allocations. A chain of 218
owner references therefore requests two cells from a single-cell base, not 218.

Admission priorities, reference-counted pins, readiness and teleport completion
all use exactly this one-hop set. B is ready once B and each direct owner are
active, even if an owner’s own owner is absent. Cyclic owner references are legal
and do not imply recursive readiness. Release a base pin’s complete set together;
shared owners remain pinned until the last referencing base releases them.
Byte caps still apply; insufficient capacity leaves the base explicitly unready,
without expanding the set or inventing contact.

Each tile contains its own complete clipped terrain, contact and graph segments.
Do not encode surface, terrain, graph or routing reachability as owner
dependencies. Further graph exploration requests spatial cells explicitly. The
manifest validator rejects missing, duplicate and self owner references; the
generator additionally proves positive-area footprint intersection and that
every intersecting external owner is listed. No tile wire-layout change is
needed. This clarification supersedes recursive traversal in the draft runtime.


### Optional World detail extension, version 1 (2026-10-16)

AWT/1 keeps the bare road/terrain/building core. The subsequently authorized
World detail On/Off layer uses optional `metadata.extensions.worldDetail`.
The runtime/schema owner owns this contract and validator; the offline generator
owns extraction and emission; the realism renderer owns facade/roof/vegetation
meshes, their budgets and the single World detail toggle. Older consumers may
ignore the extension and still render/drive the complete core. Do not encode
required surfaces or routing information in this extension.

```js
extensions: {worldDetail: {
  version: 1,
  buildings: {facadeStyle: <array index>, detailSeed: <array index>},
  vegetation: {positionHeight: <array index>, kind: <array index>, seed: <array index>}
}}
```

All five arrays are required when the extension is present; empty arrays represent
an absent feature. Building `facadeStyle` is Uint8, one value 0–7 per core building
row. Building `detailSeed` is Uint32, one seed per core building row. Derive it
using FNV-1a over the UTF-8 original source key (`way/123` or `relation/123`),
with initial value 2166136261, XOR each byte then multiply by 16777619 modulo
2^32. Split building parts retain their parent's seed. `worldDetailSeed(sourceId)`
in the validator module implements this exact operation, including non-ASCII
bytes. The canonical wire name is `detailSeed`; do not emit `roofPropSeed`.
An intermediate importer accepting both aliases must reject unequal values.
The renderer derives roof props from `detailSeed`; there is no second roof seed.

Vegetation `positionHeight` is Float32 stride 4: `[localX, baseY, localZ, height]`,
metres. XZ belongs to the half-open cell `[0,512)`; baseY is the generator's
conformed terrain height in the manifest vertical datum. Height is positive when
known, or exactly zero when source height is absent (the renderer's shared,
versioned species/seed defaults determine height). Do not encode absence as NaN.
Vegetation `kind` is Uint8 stride 1: 0 broadleaf, 1 conifer, 2 palm. Vegetation
`seed` is Uint32 stride 1; both arrays have one element per position row. Derive
source-backed seeds from stable UTF-8 OSM source IDs; generated row/area instances
include a deterministic source-relative ordinal in the key. Never use unseeded
randomness or tile emission order. No vegetation owner dependencies: emit each
instance once in its position's half-open cell.

These arrays are part of the shared ASR container and byte-residency accounting.
Keep core `meshes` independently complete: optional detail meshes are generated
by the renderer and are not baked invisibly into required core meshes. The
existing core triangle count remains the exact sum of core mesh triangles;
renderer-owned detail budgets/counts must be reported separately. Extension
version/type/stride/count/range validation runs in `validateWorldTile` before
activation. Unknown `worldDetail.version` fails closed.


Runtime worker and bounded validators dispatch ASR1/ASR2 through
`src/world-tile-codec.js:decodeTilePack(buffer, decodedBytes)`. It checks declared
decoded allocation sizes against the tile reservation before delegating to the
shared `decodeGeometryPack` or asynchronous `decodeMeshoptPack`; it contains no
codec implementation. The container magic selects the shared codec independently
of AWT/1, so no manifest codec toggle or alternate geometry layout is required.


Detail authorization does not by itself change numeric triangle ceilings. The
renderer must include extra building geometry in the <=40-triangle building
budget unless the owner explicitly revises that budget. Visual feature tests and
the World detail setting belong to the realism renderer, not to seed validation.

Measured migration coverage at the current source snapshot (2026-10-16):
Riviera 37,790,852 bytes / 138 occupied cells = 1,044,642 bytes/km²; Penteli
23,053,892 / 240 = 366,432 bytes/km²; Megara 1,544,807 / 64 = 92,078 bytes/km².
These use occupied cell area, including sparse/coastal portions, and are not
whole-city density estimates. The generator's single styled Glyfada probe is
1,380,077 bytes per 512 m cell, approximately 5,264,576 bytes/km²; extrapolating
that dense sample to all 10,664 occupied Attica cells would be 14.72 GB. It is a
capacity scenario, not an emitted playable world. At <=24 MiB per packed file
this needs at least 585 bundles (spatial boundaries add overhead), far below
20,000 files even with immutable copies and the current game. Actual inventory
and bundle output remain deployment gates; these figures do not justify R2.


### Private runtime checkpoint (2026-10-16)

No player entry point imports or enables this runtime. Existing map loading,
service worker and Workers routing remain unchanged. The offline legacy conversion helper is inert. The unlanded build patch
uses `ASR_WORLD_TILES=1` and emits descriptors with `default:false`; that build
hook is not active in this checkpoint.
`?streaming=0` remains the planned kill switch in the unlanded player adapter;
`?streaming=1` alone does not activate anything on prod at this checkpoint.

Run the private localhost viewer explicitly:

```sh
node tools/world-development.mjs .scratch/athens-world/development-world/glyfada/manifest.json 8795
```

It binds 127.0.0.1 and requires `developmentOnly:true, releaseReady:false`.
Only listed artifact files are exposed. The viewer uses the shared tile worker,
scene adapter, road graph, generated contact spawn, GPS and validated tow. Its
traffic vehicles are adapter probes; this is not native driving acceptance.
The generator preserves the bounded fixture in `.scratch/athens-world/development-world/glyfada/`; it remains outside the static deploy. Larger source artifacts stay external to Git. The
standalone release-staging helper rejects development/incomplete manifests.

Ribbon lateral is measured relative to its referenced directed edge: for a
unit tangent `(tx,tz)`, positive lateral points right `(-tz,tx)`. Reversing the
reference edge reverses the lateral sign. Station follows that reference.
Physical width must be station-local, never directional lane count or a maximum
width for the whole physical surface. `WorldTileRoads.width` intersects the
canonical road contact triangles in nearby CSR cells by surface/layer, so
clipped neighbours, reverse directions and local narrowing retain their actual
physical boundaries. Ambiguous or incomplete sections reject traffic placement.

Seam identity and equal render/contact vertices do not establish drivability:
the two-cell fixture has known steep micro-triangles pending a continuous height
field fix from the generator. Keep driving acceptance blocked until that fix
and physical grade/conformance audits pass.

Range bundles remain experimental: this checkout's local Wrangler asset server
returned HTTP 200/full-file for Range, while the tile loader requires 206. The
current file count permits individual immutable files; do not activate packed
publication without an end-to-end hosting test. No R2 dependency is introduced.
