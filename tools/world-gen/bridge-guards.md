# Offline bridge guard rebuild

This helper repairs supported OSM bridge post cadence. It does not change bridge topology, contact heights, fascia, beam vertices or collision rails. Unsupported/missing/ambiguous source plans fail closed. The compiler uses the checked-in OSM-derived structure plan (OpenStreetMap contributors, ODbL 1.0); it introduces no wall heights or support locations.

Compile each ORIGINAL source plan using the same pinned Python/Shapely environment as the source bake:

```
python tools/world-gen/compile-bridge-guards.py tools/world-gen/areas/east.structures.json athens-east-development > east.guard-recipe.json
```

The compiler is a trusted local build step. Its output records the raw plan and compiler SHA; `readBridgeGuardRecipe({compiledBytes, sourcePlanBytes})` validates provenance and returns a sealed recipe. Authenticate the original compressed bytes and exact source identity before any refinement:

```
const proof = await prepareBridgeGuardRepair({
  compressedBytes, entry, world: entry.source.world,
  revision: entry.source.revision, cell,
}, recipes);
```

Keep the original source immutable. Refine eligible terrain, conform paint, then call `rebuildBridgeGuards(pack, proof)` BEFORE assigning publication world/revision and before authoritative `packTiles`. Proofs are process-local, sealed and single-use. All original physical tables, rails, guard/fascia buffers and palette must still match; any change requires source reproof. No nearest-road matching occurs. Full source rings determine four-metre stations and half-open cell ownership. Existing beam vertices are copied bit-for-bit.

The result reports source/recipe hashes, posts, guard draw records, guard triangles and array bytes before/after. Apply `triangleDelta` to accounting at the final pack stage; the helper itself never changes budgets or identity. The authoritative packer must recompute hashes and all resident/transient/compressed budgets and enforce existing gates. `planBridgeGuardRepair(metadata, recipes, originalSHA)` is a metadata-only forecast, never repair authorization. Final compressed size is not predicted.

The exact three entries in `areas/authored-guard-preservation.json` are explicit protected Penteli originals. A sealed `preserve-authored` proof binds original compressed SHA, world/revision/cell, source IDs, guard fingerprint and the complete decoded content. Its `preserveOriginal:true` result requires reusing ORIGINAL bytes and manifest entry: skip refinement, identity reassignment and repacking. Native IDs or world names alone never authorize preservation. Parent terrain publication separately preserves all 225 Penteli and 72 Megara authored cells. Unknown source worlds or unlisted authored guards fail closed.

A sealed `no-guards` result is a true no-op for known supported source identities without guard geometry. Protected bridge cells may enter guard-only repair while terrain stays unchanged. New source bakes use `tile_detail.bridge_post_mesh` directly and do not need this legacy-layout rebuild.
