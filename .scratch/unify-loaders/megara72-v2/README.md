# Megara 72-cell recovery proof — local fixture only

## Summary (for the reviewer)

The complete authenticated 72-cell Megara fixture passed actual route compilation, the eight-slot full-garage grid proof, strict recovery surveying, and the production text/byte sidecar admission. All 72 cells are present: four have sidecars containing 3,898 anchors; 68 have explicit authenticated empty markers.

**Acceptance is false. Online activation is false. Final-world rebinding is pending.** This receipt does not approve a deployment or close the overall loader/multiplayer task.

## Proof and how I tested it

This is offline artifact evidence. No new game screenshots, browser, Worker, R2 population, network activity, full test suite or archive was run for this reduction. Earlier game captures in the parent folder do not prove this recovery dataset or online parity.

The allocated offline job used integrated source `7949401225d46c633e237e0fcf08520886c3792a`; its server modules exactly match `5475d6a50baa9566e73e3818d855fe3082f3b808`. The job exited **0** within its 295-second timeout (300-second terminal hard limit). PID/exit-file timestamps span about **26.95 seconds**, including input hashing and IO; this is neither game cold-load timing nor measured CPU time.

| Recorded check | Result |
|---|---|
| Actual compile against authenticated cells | Route and geometry hashes unchanged |
| Full-garage eight-slot grid | Passed; all eight distinct poses proved |
| Full owner-cell survey | 72/72 completed; no failed owner omitted |
| Root key/source-hash binding | Exact 72/72 match, including all 68 empty entries |
| Nonempty sidecar admission | 4/4 canonical packed text and 4/4 original-byte admissions passed |
| Saved dense cell lossless roundtrip | 2,834 anchors, 100 edges, 1,926 points, 4,570 certificates preserved |
| Neighborhood enumeration | 72 centers, 550 memberships: 42×9, 26×6, 4×4 |

The 68 empty entries mean **no eligible public graph edge IDs in the authenticated owner packet**, with private edges excluded. The pinned builder aborts if any road-bearing owner has zero certified anchors. These entries are not missing artifacts, rejected surveys or fallback classifications.

## How to inspect it (2 minutes)

1. Read [receipt.json](receipt.json) for source/module/artifact SHA-256 values, counts, immutable identities, admission accounting and known limits.
2. Read [coverage.json](coverage.json) for every cell's world/root source hash and empty/sidecar classification. Read [neighborhoods.json](neighborhoods.json) for every exact membership list and ranked wire/anchor totals.
3. The preserved [reproduce.mjs](reproduce.mjs) is the exact executed wrapper, SHA-256 `7b26a574adf4939e35ce3666d905ce623ac8820f0b72014b9c63f1da0af9ea51`. **Do not rerun it without a new resource grant and a fresh output plan.** It requires the pinned temporary source/cache layout and intentionally fails if its immutable output directory already exists.

## Risk and rollback

- **Risk:** interpreting this bounded local fixture as final Athens coverage, real Worker memory capacity or browser multiplayer proof. Its authenticated world revision differs from the pending final world.
- **Rollback:** revert this evidence-only commit. It changes no runtime, authored geometry, flags, guards, catalogue, world cells or deployment configuration.

<details>
<summary><b>How it was done</b></summary>

### Scope, identities and source lineage

All complete hashes live in `receipt.json`. Short identifiers below are labels only:

- World: `dbba5e…8291d0`; exact raw world file SHA: `47718e…ccb2e`.
- Source-bound Megara regional manifest: `e5d178…28935a`; 67 original packets plus five derived packets.
- Actual compiled route: `f0de0761…bb06b`; geometry/proof hash: `c98600b1…61a6`.
- Eight-slot grid: `909c994a…0ca69`.
- Recovery root: `483cafbb…0ed3`.

The prior metadata-only repair changed 186 surface words across five packets. Its physical/contact/barrier/building array byte audit remains pinned and unchanged. This later job hash-verified packet inputs and did not rerun repair, rebake geometry, add runtime aliases, widen tolerances, omit certificates or omit road-bearing cells.

### Admission accounting and limits

Four sidecars total **1,347,341 bytes**; with the root, **1,355,664 bytes**. The largest sidecar is **895,383 bytes**, below the unchanged 2 MiB wire cap.

The dense cell's production accounting is:

| Input path | Authentication | Expansion | Scanner decoded estimate |
|---|---:|---:|---:|
| Canonical packed text | 8,392,420 B | 8,601,166 B | 12,013,000 B |
| Original packed bytes | 9,287,803 B | 9,496,549 B | 12,013,000 B |

The admission limit remains **12,582,912 bytes**. These are conservative algorithmic accounting figures, **not V8 heap, Node RSS, Worker resident memory or enforcement measurements**.

The worst wire-sized 3×3 is centered on `-64,-1`: nine authenticated existing cells, four nonempty sidecars, 1,347,341 wire bytes and 3,898 anchors. The compact-cache and two leased-context limits remain unchanged. This fixture's four nonempty cells do not prove eviction behavior, complete leased-set capacity, whole-world capacity or production 128 MiB enforcement.

### Files and tools

- `README.md`: human-readable scope, checks and limits.
- `receipt.json`: reduced exact receipt, artifact hashes, source/module pins, prior audit lineage and text/byte accounting.
- `coverage.json`: complete 72-cell root/world identity and classification record.
- `neighborhoods.json`: complete reduced 72-neighborhood membership/ranking record; no geometry or raw anchor dump.
- `reproduce.mjs`: exact historical source wrapper, retained for reproducibility; not executed by this documentation change.

Implementation, original run and reduction: **Codex gpt-6.1-sol**. Tools: Git source exports/private index, Node offline builders and production admission functions, Python metadata/hash reduction. No image generation or third-party media.

### Checks for this evidence-only change

Metadata-only reduction compared root/world cell keys and source hashes, checked all four existing packed artifact SHA-256 values, checked 72 coverage rows/68 empties/4 sidecars/3,898 anchors, and checked 72 neighborhoods/550 memberships and dense-cell preserved counts. The wrapper was syntax-checked only. No admission or survey was repeated.

Required combined-candidate clean gates, actual Worker/DO heap and recovery exercise, genuine two-client driving/traffic/tow/reconnect proof, physical 74-car/256-cone capture, final-world rebinding and controlled playable cold-load ≤8 seconds remain pending. Source-review approvals are scoped and do not replace these proofs.

### Preservation and cleanup

Raw original cache, five derived packets, immutable sidecar outputs and the isolated Worker snapshot remain untouched in `/tmp/athens-loaders.OfMh` for the pending Worker work. No binaries, source cells, raw sidecar geometry or 1 MB catalogue are duplicated here. No persistent runtime, browser or heavy process was started by this reduction. Disk stayed **49%** (70 GB used / 145 GB).

### Proposed parent PROBLEMS entry

> Megara local recovery fixture: source-bound graph-surface metadata repair plus lossless packed V2 sidecars now pass a full authenticated 72-cell survey, actual compile/eight-slot grid, exact root coverage and production text/byte admission (4 sidecars, 68 empty owners, 3,898 anchors). Acceptance/online remain false. Final-world rebinding, real Worker memory/context checks, two-client gameplay, physical actor payload and combined gates remain open; do not mark the overall migration complete.

`docs/PROBLEMS.md` and `CHANGELOG.md` are intentionally left to the parent consolidator.

</details>
