# Proposed one-cell mutation assembler

Ownership proposal: new `tools/world-gen/mutate-cell.mjs` and focused
`tools/world-gen/mutate-cell.test.mjs` only. No edits to the packer, constituent
mutation helpers, runtime, generator defaults, manifest composer or regional
repair. Parent/greenery can own these new files after agreeing this contract;
terrain has not started their implementation.

## Proposed API

`await mutateOriginalCell({compressedBytes, entry, source, derived, stages,
protectedSources, releaseScope})` returns one of:

- `{kind:'preserved', compressedBytes, entry, audit}`: exact original bytes and
  entry, no derived identity and no spool; or
- `{kind:'mutated', spool, audit, assertPacked}`: one NDJSON-compatible input
  object and an `assertPacked({entry,decoded,packet,...gates})` callback for
  ordinary `packTiles.onTile`. No ready/playable manifest or acceptance flag.

`source` is the pinned original `{world,revision,cell}`. `derived` contains the
new actual packet `{world,revision}` plus the predeclared assembly recipe hash.
`stages` has named infill, terrain, paint, guards and scenery inputs, never
arbitrary mutator callbacks. Each stage records exact code/input hashes.
`releaseScope` pins the complete requested cell set and approved terrain proof;
per-cell calls cannot evade a global guard by pretending the set has size one.
No current rejected field is an allowed terrain input.

The helper consumes only supplied bytes and explicit reviewed local source
paths. It does not fetch, discover caches, scan the world, write files, compose
manifests or upload. A caller awaits one cell at a time, packs it, retains only
compact audit/seam signatures, then releases decoded arrays before reading the
next cell. Changed-cell output is streamed to an ordinary single-cell packer
invocation; no mixed-identity original batch.

## Exact ordered integration

1. Verify entry compressed length/SHA, source identity and cell, then bounded
   decompression using `entry.decodedBytes`; reject invalid header/format before
   using `decodePinnedSourceCell(bytes,entry,source)` from `repair-infill.mjs`.
   Independently require `entry.source` to agree. Seal
   `prepareBridgeGuardRepair({compressedBytes,entry,...source},recipes)` against
   these ORIGINAL bytes, before any mutation. Recipes come from
   `readBridgeGuardRecipe({compiledBytes,sourcePlanBytes})`.
2. If the exact pinned native preservation registry applies, or sealed proof
   mode is `preserve-authored`, validate preservation and return original bytes
   and entry. Skip infill, terrain, paint, guards, scenery, identity and packing.
   The three native guard proofs can be consumed by
   `rebuildBridgeGuards(originalPack,proof)` to require `preserveOriginal:true`.
   All 225 Penteli and 72 Megara physical sources remain protected by policy;
   the separate approved Megara graph repair is composed as its own overlay.
3. Apply fresh original-only
   `applyReviewedInfillRepair(pack,plan,{reviewedPlanSha256,sourcePath,
   sourceCellSha256:entry.sha256})`. Record canonical plan digest separately
   from raw plan-file digest and original compressed SHA. The helper checks
   original decoded fingerprint, source/receipt and code hashes. Historical
   corrected overlays are not inputs to this original-only stage.
4. Optional terrain: validate the scope and exact field/source/report binding
   through `requireTerrainAcceptance` before applying
   `refineTerrainRelief(pack,field)`. Prototype limits are not release approval:
   this release assembler additionally requires accepted geographic/profile,
   protected-zone and comfort evidence. Until that exists, omit terrain or
   reject it. Keep structural protected cells unchanged.
5. Run `conformMarkingSurfaces(pack)` after any accepted terrain operation.
   Then `rebuildBridgeGuards(pack,originalProof)`. Add its `triangleDelta` to
   `metadata.budgets.triangles` exactly once. Guard preconditions remain strict:
   if a prior stage changes its sealed physical/rail/beam/guard fingerprint,
   abort. No silent reseal, proof substitution or compatible-looking geometry.
6. Scenery: snapshot the IMMEDIATE corrected pack, then call
   `applySceneryVegetation(pack,scenery,{blocked,occupied})` with final physical
   tables and final crown/building/road/all-layer/Vas/plaza/forecourt/furniture/
   parking exclusions. Hash logical tables, ID mapping, physical meshes,
   collision/barrier/building/parking data before and immediately after.
   Additionally compare every pre-existing array byte and metadata field,
   permitting only the documented worldDetail vegetation index/row changes and
   private appended vegetation arrays. Reject aliases into physical arrays or
   undeclared changes. Prepared obstacle hashes alone are insufficient for
   raw wire packets. Run `assertVegetationClearance` again on the actual packed
   final packet. Keep the existing count/crown/budget limits.
7. Only now stamp the actual packet world/revision and immutable lineage:
   original source identity+SHA, immediate stage input fingerprints, ordered
   stage code/data hashes and reports. Preserve original dependencies. No
   descriptor-only identity repair or copying old descriptors onto new bytes.
   Serialize using the same wire shape as `repairedSpool(pack)`, retaining
   dependencies rather than its empty default.
8. Caller passes this ONE spool through ordinary
   `packTiles(Readable.from([JSON.stringify(spool)+'\n']),output,{onTile})`.
   `assertPacked` checks actual identity/source lineage, authoritative physical
   invariants, vegetation clearance and repaired-building removal via
   `auditRepairedPacket` against the final corrected wire pack. Ordinary packer
   owns SHA/bytes/resident/transient/triangles and all physical/bridge/road/bore
   gates. It is never monkey-patched. Cross-cell exact seams/contact seams,
   graph portals and 2x2/global budgets are a separate streaming final pass.

## Fail-closed tests required before use

Corrupt original SHA/size/identity/header; stale or wrong infill plan/code;
protected native cell with any requested mutation; guard proof replay or
physical/rail change; current rejected/global prototype field; terrain scope
substitution; scenery alias into a contact array; parking/building/ID drift;
incorrect triangle delta; premature identity; mixed identities; failed ordinary
packer gate; actual packed clearance failure. Positive tests include one-cell
ordered mutation with immediate scenery invariance, unchanged-source exact
preservation, and a bounded async source that proves only one packet is live.

The Megara 67-original/5-derived descriptor is authenticated separately through
`composeExtension(...,{preservePacketSources:true,regionalManifest})`; this
assembler does not retag, reinterpret or repack those 72 cells.
