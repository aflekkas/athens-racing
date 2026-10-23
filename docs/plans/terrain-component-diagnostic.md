# Exact component terrain LP: source stage

This analysis stage changes no world cell, runtime policy, generator hash,
terrain default, physical tolerance or release acceptance. The exact556
monolithic minimum-gradient runs timed out; they established no result.

## Implemented algebra and certificates

`tools/terrain-lp/components.py` builds the free-variable connectivity graph from
all chord, triangle and fixed source-profile constraints. Fixed delta variables
are constants; G is the only shared variable. Components are named by their
lowest canonical global lattice coordinate. Their variables retain full-model
indices, and every local solver dual row is remapped to its stable full-model
semantic row ordinal, bound to input hash/mode/stage/facet count. Fixed-only
contradictions are reported and block component solving. Other fixed-only rows
are removed only when implied by fixed-zero delta and G>=0.

`components.mjs` independently reconstructs membership and rows from point
geometry. It rejects altered membership, unknown IDs, mixed models, incomplete
or duplicate bundles, and foreign full-row duals. Single-component reports are
explicitly partial. A complete bundle assembles every component's field at
`G=max(component G)`, then replays the existing full-row verifier, including
true Euclidean triangle norms, all comfort observations, amplitude, protected
nodes and declared summit/profile constraints. The strongest component dual is
a valid full-model gradient lower bound; duals are never summed for a shared
minimum-G objective. At a separately verified fixed common G, L1 objectives and
component duals do add. The complete assembled sparse certificate is checked
again by the full-model verifier.

The correction-stage executable requires a complete independently verified
inner optimum bundle with duality gap<=1e-6 before solving any secondary cell
component. Pure model constructors are declarative; they cannot authorize a
solve, pack or publication. Existing owner sag0.5/amplitude0.75/support32 and
protected/source-profile constraints are unchanged.

## Tests and tiny solver checks

22 focused tests (12 existing +10 component tests) pass with zero skips. They
include the analytically known two-isolated-spike maximum, fixed-only
infeasibility, altered/omitted membership, bad full dual IDs, complete omitted-row
and Euclidean verification, Python/JS remap parity, and additive fixed-G L1.
The ordinary suite requires no SciPy dependency.

Separately, the isolated pinned SciPy environment solved only the tiny synthetic
two-spike fixture, each component having two local variables. Both explicit
`highs-ds` and `highs-ipm`, with presolve on and off, produced independently
verified complete bundles: minimum G0.09011997775086848, exact maximum Euclidean
gradient0.08838834764831845 and conservative dual gap9.14e-12. Presolve-on cases
eliminated the tiny problems (0iterations); presolve-off simplex took3/4 and IPM
7/6iterations. These check interfaces/certificate mapping, not real-data solver
performance or a reason to increase a runtime grant. No real component solve
has run in this source stage.

## Count-only original five-cell preflight

Input remains SHA256 e85ca0c7de2cdc5f057d3e69828c41b45fea61d5bc03c595525b5e927ceaa281.
It has 4,202 observations and 131 fixed source safeguards. Python and independent
JS agree exactly on all seven component IDs, member/row counts and nonzero counts.
14,388 fixed-only rows are redundant; no fixed-only contradiction was found.
Neither implementation allocates the original full sparse matrix.

| Component ID | Free delta nodes | Rows | Nonzeros | Forecast bytes |
|---|---:|---:|---:|---:|
| -32,608 | 3274 | 111134 | 395308 | 376758786 |
| -32,960 | 196 | 7208 | 23800 | 234881024 |
| 992,-488 | 1958 | 68412 | 240584 | 268694698 |
| 1200,-72 | 973 | 33698 | 120358 | 234881024 |
| 2016,12856 | 4444 | 150460 | 541548 | 478897383 |
| 4576,-3504 | 4488 | 153256 | 544324 | 480836228 |
| 7136,-10680 | 4079 | 140478 | 495284 | 446585156 |

Each forecast includes96MiB for original source model and typed remapping in
addition to the calibrated solver estimate. The largest is480,836,228B; this is
a forecast pending real component measurement, not an RSS guarantee. Independent
JS partition preflight peaked at142,032,896B. No original sparse matrix, real
component solve, packing or all-world decode occurred.

## Next bounded diagnostic proposal (not a grant)

Start with Syntagma component `-32,608`, one explicit method with presolve/iteration
logs, bounded solver time and independent full-row component verification. Use
recorded owned PID, external deadline, one OMP/BLAS worker, >=6GiB available
memory and an RSS guard justified by this forecast. An IPM trial is a deliberate
method diagnostic against the prior implicit simplex path; tiny tests do not
predict which real method is faster. Do not automatically continue to other
components, secondary L1, emitted packing or global work. A real partial result
remains partial until all seven components and the complete assembled field are
verified. Even that would establish a source LP result, not geographic/physical
or publication acceptance.

Default count-only CLI:

```sh
python3 tools/terrain-lp/components.py INPUT --sha256 INPUT_SHA
```

Only a specific later allocation authorizes `--solve --component=-32,608` plus
explicit time/memory/method flags. The source CLI defaults to no solver.
