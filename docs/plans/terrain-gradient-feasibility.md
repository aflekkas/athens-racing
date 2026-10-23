# Terrain gradient feasibility: analysis contract

The five-cell LP diagnostic is rejected. At amplitude 0.75 m, support 32 m,
protected corrections zero and gradient 0.06, the conservative 16-facet minmax
objective is 0.504258201875448 m. Even the outer necessary relaxation returns
0.500533198634703 m, above the unchanged owner comfort limit of 0.5 m.
The solver dual gap is 2.22e-16 and stationarity residual 1.43e-16; this is
numerical evidence, pending independently reconstructed sparse dual verification.
It is not geographic, emitted or whole-world acceptance.

## Next objective, without incremental gradient trials

Let delta be the canonical shared 8 m correction lattice and g its gradient
bound. Minimize g subject to each exact affine-bend-corrected observation
`-0.5 <= sourceSag + chordCoefficients * delta <= 0.5`, `abs(delta) <= 0.75`,
zero correction outside 32 m of the observations, and protected nodes fixed.
Keep the exact triangle gradients, not graph-edge grade proxies.

For N equally spaced unit normals, inner constraints are
`normal dot triangleGradient <= g*cos(pi/N)`; outer constraints use `<= g`.
Their optima bracket the necessary true Euclidean gradient. An outer optimum
is a lower bound only; an inner solution still needs independent exact norm
verification. These are experimental design bounds, never changes to owner
comfort, grade, step, shoulder, bridge, contact, portal or protected-zone gates.

After finding a verified feasible gradient, a separate lexicographic stage fixes
that bound and minimizes weighted absolute correction and local differences.
Use explicit auxiliary absolute-value variables. Do not accept the arbitrary
saturated hill corrections of the minmax-only diagnostic. Fix summit corrections
and require measured original-source broad-profile safeguards before this stage;
profile samples are authenticated source geometry, not surveyed geography.
Any new safeguard must be recorded as a constraint and infeasibility reported.
No baseline blur or silent removal of profile constraints is permitted.

## Independent certificate and checks

Export sparse dual multipliers, semantic row IDs, source observation hash, node
bounds and exact facet definitions. A separate JS verifier must reconstruct rows
from observations and triangles, check multiplier signs and stationarity, and
compute a conservative lower bound including residual/error bounds. It must not
trust a claimed objective, matrix, coefficient list or solver status. Save a
compact certificate sufficient to reproduce the bound. Solver-process dual
checks alone are preliminary numerical evidence.

Independently evaluate every chord, exact Euclidean triangle gradient (including
the zero exterior halo), amplitude, protected nodes, support, summit and broad
profiles. Include deliberately corrupted multiplier/value controls. Passing the
proxy authorizes a request for bounded pack allocation, not an automatic pack.
Actual repack must then pass all existing physical/sag/shoulder/portal/seam gates
and source-profile comparisons before any wider experiment.

## Memory and allocation

The historical 678,772-row / 1,718,136-nonzero / 19,470-node LP peaked at
959,492,096 bytes RSS. Its 96,638,336-byte estimate omitted solver overhead and
was wrong. Budget at least 1.2 GB for that exact size before added variables,
facet refinement or certificate storage. Do not rerun that size under a 1 GiB
forecast guard. Prefer a bounded active-row method with complete independent
separation over all finite facets; omitted violated constraints must be added
until none remain. Bound stored observations and solver state; do not retain
all world packets or JS constraint maps. A measured reduced run or a larger
explicit allocation is required before the next solve. No solve, pack or global
scan is authorized by this document.

## Implemented source preflight (no new solve)

`tools/terrain-lp/model.py` now constructs the minimum-gradient inner/outer LP
and exports sparse row-index dual multipliers and actual primal values. It
imports SciPy only after an explicit `--solve` plus headroom/forecast checks.
`tools/terrain-lp/verify.mjs` independently reconstructs all coefficients from
point coordinates, facets, node bounds and profile samples. It ignores supplied
coefficient lists and claimed objectives. Bounded-variable dual residuals are
paid analytically in the conservative lower bound; unbounded-variable dual
slack is normalized with an arithmetic error margin. Negative fixtures cover
source/hash, row/sign/duplicate, gradient, sag, amplitude, support, protected
and profile corruption. This is floating-point verification with conservative
error allowances, not a formal rational arithmetic certificate.

The implemented secondary stage fixes the independently verified inner optimum
and minimizes weighted L1 correction. It refuses an outer/unverified prior or
a prior with a duality gap over 1e-6. It has not been run on real cells. No field
or packing hook is exposed by these analysis tools.

`prepare.mjs` pins the original manifest, atlas and all five compressed source
cells. The prepared 2,987,095-byte input has SHA256
`e85ca0c7de2cdc5f057d3e69828c41b45fea61d5bc03c595525b5e927ceaa281`.
It retains the original 4,202 observations and 19,470 supported nodes, and adds
131 fixed original-source safeguards: the Lycabettus summit and two declared
513 m-wide axes sampled every 8 m (endpoints at -256/+256 m). These are source
preservation constraints, not surveyed geographic evidence. The prepared input
is local-only in the terrain tasktemp; no large input or dependency is committed.

Count-only preflight: 19,471 variables, 679,034 rows, 41,898 gradient triangles,
16 facets and at most 2,756,510 nonzeros. New G coefficients occur in every
facet row, so the updated calibrated forecast is **1,925,232,927 bytes**, above
the prior minmax model and the default 1 GiB allocation. A future bounded grant
must explicitly cover this footprint (or require a smaller active-row version).
Preflight built no sparse matrix and invoked no solver. Input preparation peaked
at 443,117,568 bytes with 22.3 GB available system memory. Disk was 48% used,
76 GB free. All own preflight/test processes exited.

Default diagnostic (source/count only):

```sh
python3 tools/terrain-lp/model.py INPUT --sha256 INPUT_SHA --mode inner
```

A separately allocated solver invocation must use the isolated pinned tasktemp
Python, one worker, an externally recorded child PID and wall-clock timeout,
`--solve`, bounded `--seconds`, and explicitly allocated `--memory-bytes`.
Verification takes `node tools/terrain-lp/verify.mjs INPUT CERTIFICATE INPUT_SHA`.
An outer certificate can have a valid lower bound while failing the actual
Euclidean primal check; that failure must remain visible. No emitted pack,
release/default adoption, full source suite or actual-game proof is claimed by
this source-only implementation.
