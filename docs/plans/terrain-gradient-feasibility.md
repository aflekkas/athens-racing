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
