# Riviera current-candidate compile receipt (metadata proof only)

The single-route compile used exact source `f1e05e1d9b06123685c7b2d2ebea80e2a5a36624`
and original authenticated world80055. It passed geometry and rival-plan checks;
this does **not** prove native Quick loading, ground readiness or driving.

- [Receipt and source/proof pins](riviera-f1e05-receipt.json)
- [Exact reproducer](compile-riviera-f1e05.mjs), SHA256
  `5e2aac45526f1b1fcf1c3a0ccff52e54ce667643934883c4e5f581f89910a4ab`
- [Proposed bounded browser diagnostic](../game/next-diagnostic-plan.json), not run.

The actual immutable1,638,114-byte artifact stays in the original task directory:
`/tmp/athens-kifissia.O7Mn/built/riviera-coast.d10498cd7f9a288433e28c3c125469017dccf8846cd6611c44f92a52925aa04f.json`.
Its SHA256 is `0b7f26ace7eb84960438640b0e76e9bbd8709655244b320954661867b70f4771`.
It is a legitimate **local current candidate**, not the released722e artifact.
No1.6MB duplicate is committed. The original is retained for the UI/native Quick
preflight. Parent and UI received the exact path/tuple/grid0 after FULLEND.

Reproduction requires a separately authorized CPU slot and the exact pinned
source worktree; it fails if that worktree HEAD/working bytes change. It uses
existing immutable manifest/query proofs only, with no network, cells, archive
or source/app changes. Outputs use exclusive creation or exact-body comparison;
a differing existing output fails. The pin-named receipt is also immutable and
contains timings, so do not overwrite it on a later run. A future source/world
freeze needs a newly reviewed pin/receipt, never relabeling the old route hash.

```sh
NODE_OPTIONS=--max-old-space-size=512 /usr/bin/time -v \
  timeout --signal=TERM --kill-after=2s 88s \
  node .scratch/riviera-source-audit/compile/compile-riviera-f1e05.mjs
```

Observed: exit0, wall7.88s, maximumRSS198972KiB; all proof/source checks passed.
The compiler emitted grid0 directly; it was not inferred from authored start.
The native browser preflight and final combined-world all-route compile remain
pending. No browser/server was launched for this receipt. No full suite was run.
Codex gpt-6.1-sol used Node/Three.js and the repository compiler/rival validators.
