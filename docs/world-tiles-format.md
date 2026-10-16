# Athens world tiles, AWT/1

Status: **Draft v1.2**, generator/runtime interchange contract, 2026-10-15. Schema identifier **`AWT/1`**, integer `tileVersion: 1`. Validator: `src/world-tile-format.js`, `validateWorldTile({metadata, arrays})`; run `node tools/validate-world-tiles.mjs <manifest.json>` on an emitted directory. This document supersedes the scenery, graphics-preset and street-photo requirements in the research plan. Bare OSM road shapes, clean elevation terrain, plain building boxes (at most 40 triangles per building), racing signs/gantries; no vegetation or beach props. One Lighting Off / Effects Off look. Terrain colour varies with slope, elevation and OSM landuse: dry earth, rock, scrub tones, coastal sand and urban ground. Building colours are white/light plaster, light greys and muted Greek accents; building colours must not reuse beige terrain tones. Scrub is a terrain colour category, never vegetation geometry. Bake these colours offline into the shared palette/normalised vertex-colour attributes; no per-tile textures or runtime style selector.

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

Every table is required, using a zero-length array for absent features. IDs in rows reference `ids`; index zero means unknown/none only where explicitly allowed. IDs are stable world-wide strings, retaining full 64-bit OSM IDs. Node/edge references are **world ID indexes**, resolved through each tile's ID dictionary, not array row numbers; dictionary order may differ between tiles. Portals repeat node IDs/positions exactly. Strings are UTF-8 JSON, zero is the empty string. Attribute/table arrays may alias a shared underlying buffer; count unique buffers once for residency. All arrays are little-endian on wire through the codec.

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

Render only the fine mesh near roads; coarse heights may remain metadata/contact fallback without a second overlapping rendered mesh. Render meshes are accelerators of these canonical surfaces, using the shared packGroup descriptors and terrain layout. They must cover all rendered roads, terrain, boxes and signs. A tile may split meshes by material and bounded activation job; each mesh <=16384 triangles and <=65535 vertices. Offline validator checks structural tables; generator must additionally validate polygon winding, triangle area, grade separation, actual rendered/contact equivalence and shared-edge equality. `validateTileSeam(a,b)` checks canonical boundary vertices for exact equal heights; run for every adjacent emitted pair, both terrain and contacts. Seam validation does not substitute for manifold/topology checks.

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

Absent → loading → ready → active → retiring → disposed. Fetch/decompress/decode/build contact indexes in workers with bounded inflight jobs and reservations. Use revision + request generation to drop stale transfers. Only bounded mesh-object creation and scene attachment happen on main thread, <=2 ms/frame; a single unbounded synchronous callback cannot meet that promise. Account compressed/transient buffers, retained backing buffers, CPU contacts/graph, GPU bytes and shared assets with references. Evict unpinned LRU detail before contacts; preserve 20% headroom. Keep spawn, last-safe and pending tow cells pinned; never step physics into an unready cell. Teleports await target neighbourhood before moving actors, then release old pins. Failures retain safe contacts and expose retry; never whole-map-generate as fallback.

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

Implementation note (2026-10-15): GPU residency counts BufferAttribute allocation identities, including the index role and terrain-decode wrapper, rather than just typed-array backing storage. Matching attributes and indices within a tile share wrappers; CPU backing allocations remain deduplicated separately. GPU staging/warm-up is experimental and is not yet accepted against the 50 ms activation gate.


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
