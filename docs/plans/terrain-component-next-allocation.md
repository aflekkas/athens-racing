# Proposed next component diagnostics: no allocation implied

The completed single Syntagma INNER finite-facet LP is independently verified:
G0.06135472339608899, conservative inner-model dual0.06135472331172854,
gap8.436e-11, true maximum Euclidean gradient0.0613547233960891. Its 3,275 values
and16 nonzero full-semantic dual rows are retained in the 114,239-byte certificate
SHA256915062513c75851e76dfa73bdddfa0731c17c2d7d0a50ef031120ef46ccaca82.
This is a feasible exact-norm **upper bound** for one component, not an exact
Euclidean minimum or a whole-field result. The design bound0.06 remains open.

Exact source is isolated commit e4b7bf2ea6a6f71f21806480f19591c87de083a4 under
`/tmp/athens-terrain.uKVC/syntagma-component-e4b`. Source/tool hashes are in
`syntagma-e4b-pin.json`. Input remains the single pinned3MB file with SHA256
e85ca0c7de2cdc5f057d3e69828c41b45fea61d5bc03c595525b5e927ceaa281; tool receipt
SHA256048b493756127e3b5083601738b24838f1c5aa6519d9e3bed4d8e24269fa158d.
No cell or atlas copy is needed. The actual Syntagma run used one solver thread,
OMP/BLAS1, explicit IPM/presolveON,29 IPM+2951 crossover iterations. Presolve
reduced111134rows/395308nonzeros to87648/325441 (3275columns unchanged).
Process-reported peak262799360B is below376758786B forecast. Keep the conservative
forecast and RSS1GiB guard; this one measurement does not cap other components.
Available memory stayed>=21.9GB. Disk49%/75GB before and after. All owned processes
are closed. Node's sequential verifier had11 internal runtime helper threads,
not11 JS workers; report the distinction without claiming single OS-thread Node.

## Common controls for either future grant

Require explicit CPU-owner handoff and new allocation. Reauthenticate exact
source files, input and tool receipt; >=6GiB available immediately before each
phase, then monitor available memory and RSS of recorded direct owned children.
OMP_NUM_THREADS/OPENBLAS_NUM_THREADS/MKL_NUM_THREADS=1; solver thread1. External
deadline plus shorter internal total deadline, and own Popen handles only for
termination. Output<=10MB, tasktemp only. No live checkout edits while running.
Maintain owner sag0.5, amplitude0.75, support32, protected nodes and all131 fixed
original-source samples. No fields, pack, defaults, secondary or publication.

The following are exact argv descriptions, not commands being executed now.
Let `P=/tmp/athens-terrain.uKVC/scipy-venv/bin/python`,
`S=/tmp/athens-terrain.uKVC/syntagma-component-e4b`,
`I=/tmp/athens-terrain.uKVC/min-gradient-input.json`, and `H` the full e85c hash.
Pass each as a structured subprocess argument, not a shell expansion.

## A: outer necessary relaxation, <=60s total

```text
P S/tools/terrain-lp/components.py I --sha256 H --mode outer
  --component=-32,608 --solve --method highs-ipm --seconds 40
  --memory-bytes 1073741824 --output TASK/syntagma-outer-result.json
node --max-old-space-size=512 S/tools/terrain-lp/components.mjs
  I TASK/syntagma-outer-result.json H
```

Counts remain3274delta nodes/3275variables/111134rows/395308nonzeros and forecast
376758786B; only finite-facet G coefficients change from cos(pi/16) to1. The outer
LP contains the exact Euclidean feasible set, so a verified outer dual lower
bound is necessary for that exact model. It is not a physical feasible field.
Even if solver status is optimal, independently reconstruct every full semantic
component row/dual and retain exact Euclidean norm, sag, amplitude and profile
residuals. Do not suppress an exact norm greater than outer G.

Verifier CLI exit0 requires both `primalPassed` (including exact Euclidean norm)
and `dualPassed`. For an OUTER certificate, exit1 with a valid JSON report,
`dualPassed=true`, tiny dual gap, and passed finite-facet/bound/profile/sag checks
may still establish a relaxation lower bound while `primalPassed=false` because
of the norm. The supervisor must distinguish this from malformed output,
identity/row exceptions, nonfinite values, guard failure or invalid dual, all of
which stop and reject the diagnostic. It must label the result **outer necessary
relaxation**, never relabel it physical feasible or turn off the norm check.
No secondary or additional solve follows automatically.

## B: remaining six INNER, <=180s total

Retain the authentic completed Syntagma certificate above; solve only these six
with the same source/input, modeinner, explicit highs-ipm/presolveON, each
`--seconds 20` and RSS1GiB, under the single total deadline:

| ID | Delta nodes | Rows | Nonzeros | Forecast bytes |
|---|---:|---:|---:|---:|
| -32,960 | 196 | 7208 | 23800 | 234881024 |
| 992,-488 | 1958 | 68412 | 240584 | 268694698 |
| 1200,-72 | 973 | 33698 | 120358 | 234881024 |
| 2016,12856 | 4444 | 150460 | 541548 | 478897383 |
| 4576,-3504 | 4488 | 153256 | 544324 | 480836228 |
| 7136,-10680 | 4079 | 140478 | 495284 | 446585156 |

```text
P S/tools/terrain-lp/components.py I --sha256 H --mode inner
  --component=EXACT_ID --solve --method highs-ipm --seconds 20
  --memory-bytes 1073741824 --output TASK/component-EXACT_ID.json
node --max-old-space-size=512 S/tools/terrain-lp/components.mjs I RESULT H
```

Run sequentially and stop at the FIRST timeout, missing primal/certificate,
nonoptimal status, verification exception/rejection, nonfinite result, invalid
dual, memory/output guard or total deadline. If the remaining total cannot cover
the next bounded solve plus verification, stop; do not start it speculatively.
Reserve time for final full-model verification. No other mode or component,
retry, or larger time limit is implicit. A partial batch remains partial.

Only after all seven independently pass (with component dual gaps<=1e-6), write
a compact `terrain-lp-decomposition-1` bundle containing the exact certificates,
inputSHA256, modeinner, stagegradient and facets16. Authenticate the saved
Syntagma certificate SHA before including it. Then invoke the same independent
components.mjs CLI with that bundle. It rebuilds membership and ALL full rows,
assembles at max component G, validates true Euclidean gradients, owner sag,
amplitude/protected/profile constraints and the strongest full-semantic dual.
Require `fullPrimalPassed`, `fullDualPassed`, `optimumVerified`, and a tiny full
dual gap. Failure or deadline leaves no accepted complete field. Even a complete
source LP pass is not geographic, emitted physical/shoulder/portal or release
acceptance. Secondary L1 requires a separate later grant and this verified
complete inner optimum, not a partially successful batch.

## Completed allocation A: necessary lower bound, primal rejection retained

The exact frozen e4b/inpute85c/tool048b outer Syntagma diagnostic completed in
14.271s, all owned processes exited. Solver IPM/presolveON was optimal in29 IPM
and2925 crossover iterations. The independently reconstructed sparse dual gives
a conservative necessary gradient lower bound **0.06017580950586256** for this
original-baseline linear source model (outer objective0.060175809590095795,
dual gap8.423e-11). Finite-facet maximum row violation7.22e-16, source sag
0.5000000000000007, amplitude0.75 and fixed-profile correction0 are recorded
floating-point residuals, not changes to any owner tolerance.

The independent verifier returned **exit1 / primalPassed=false**. Actual maximum
Euclidean gradient0.06135472339608911 exceeds outer G0.060175809590095795.
This rejection remains visible in the receipt. Outer dual validity establishes
only a necessary bound; the outer candidate is not accepted as a physical
feasible field. The earlier inner exact-norm feasible upper bound remains
0.0613547233960891. Neither bound is an exact disk optimum, whole-five-cell,
geographic, emitted physical/shoulder/portal or publication result. The lower
bound exceeds experimental design G0.06 under the source model's unchanged
sag0.5/amplitude0.75/support32/protected131-sample constraints; it authorizes no
new gradient/default or field adoption.

Source artifacts are `syntagma-outer-diagnostic.json`, `syntagma-outer-certificate.json`
(SHA2569e850aad8fbeb063723cdd2157da6a4885201d94ce68178afefc3e4b33b9d82b),
solver text and exact supervisor in the task evidence directory. Output125647B
is below10MB. Maximum monitored solver RSS261853184B and verifier155377664B
were below1GiB; minimum available21.845GB exceeded6GiB. Solver used one thread;
Node used one sequential JS task with11 observed internal runtime helper threads.
Disk49%/75GB before and after. No guard trip, retry, other component, secondary,
pack, default, global matrix or adoption occurred. Remaining-six plan B still
requires its own allocation.
