# Vegetation clearance and streaming

`src/vegetation-clearance.js` is the footprint contract for the importer, runtime
dressing and release audit. It tests an enclosing circle against emitted drivable
contact triangles, including compact contacts, all layers, shoulders and lay-bys.
Classic contact flags are column 4; the surface ID in column 3 is not a flag.
Shrub envelopes include 1.5 m clearance and tree envelopes include 3 m. Envelopes
cover both the near model and camera-facing far LOD, including leaning pines.
An entire exclusion circle must stay inside its owning 512 m cell, so unloaded
neighbouring cells cannot introduce an unseen road intersection.

All runtime-derived trees pass the same filter after parked cars and their
colliders have been derived. When baked coastal trees are removed, their original
occupancy rows remain placement-only data for that derivation. They are never
rendered. This keeps road geometry, rail collisions and parked-car placement
unchanged. The regional forest mask certifies the exact jittered billboard
positions used by the renderer. Psychiko's retained trees use certified seeds.

Vegetation stays opaque and instanced. LOD selection stays opaque at every
distance. Newly arriving instances alone fade in over 1.2 seconds. The shader
retains the analytic impostor silhouettes. Psychiko's merged tree cells retain
their existing distance fade and also fade on arrival. No extra texture or render
pass is introduced. World detail Off hides these layers.

## Scenery-only release

Run `tools/rebake-world-vegetation.mjs <authenticated-world-set-url> <output>`.
It reads every region for the clearance audit, streams two cells at a time and
retains only changed compressed cells. Decode-transient reservations are refreshed
from the final encoded and decoded sizes. Penteli's cells also authenticate the new
regional forest mask. It waits whenever shared disk usage reaches 83%, including
before individual writes. Never delete the shared world cache to make room.

The report authenticates source code and proves every physical table is unchanged
before and after encoding. Changed cells also retain identical derived collider
indexes. Consequently the existing asphalt, grade, step, seam, contact and bridge
geometry proofs still describe the exact same surfaces. Run tow acceptance again
with the current gameplay code.

Run `tools/rebudget-vegetation-region.mjs <output>` to remeasure the changed
Penteli packets, retaining 64 KiB per cell above their complete CPU/GPU/index
accounting instead of charging for removed vegetation. Then run
`tools/verify-vegetation-release.mjs <output>` to verify every new immutable
object, source hashes and the composed 2×2 reservation including all regional
background assets. At least 4 MiB of the 64 MiB budget must remain free. The world
must remain below 2 GiB, and staging inventory plus new objects below 5 GB.

`tools/rebind-vegetation-route-proofs.mjs <output>` can rebind existing route
proofs only after this complete physical-equivalence receipt. Route geometry and
queries are unchanged; new compiled artifact identities follow the new world.
Complete browser/tow/repository gates, publish immutable objects to
`athens-racing-world-staging`, and only then update the Worker manifest and picker
metadata. The release train handles deployment after the reviewed CAS commit.

`tools/vegetation-capture.mjs <base-url> <feed> <phase> [candidate-output]` captures
matched Mercedes CLA cockpit views at Penteli village and hairpin. The optional
candidate path uses local sources, changed cells and compiled routes over the
authenticated existing assets, without a second checkout or local server.
Non-before captures also check late-arrival state and World detail Off. Always
run it through `tools/browser-slot.sh`.

If finalization is interrupted after all regional manifests are written,
`tools/recover-vegetation-publication.mjs <source-url> <output>` independently
rechecks every source/output cell, collider index and retained regional vegetation
mask before reconstructing publication receipts. It reuses the compressed cells.

## October 21 release acceptance

All 1,748 cells pass: 1,451 basin (including Riviera and Psychiko), 225 Penteli,
and 72 Megara. 734 basin cells and 225 Penteli cells changed; Megara required no
cell rewrite. Retained masks certify 116,500 regional forest trees and 8,687
Psychiko trees. Every road/contact/rail table and derived obstacle index matches
the original release. All six compiled route geometry hashes are unchanged.

The composed worst 2×2 is 59.454 MiB, leaving 4.546 MiB, including all
regional assets. The world is 455104241 bytes. Streamed tow acceptance
passes 30/30 cases with no missing contacts, falls, launches or load failures.
Matched cockpit images and machine-readable receipts are in
`/home/dev/data/agent-feed/penteli/clearance-*`.
