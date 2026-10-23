# Pinned crossover API source audit

Source read and fake validation only. No SciPy/HiGHS import, model construction or solve ran. No dependency mutation/download. Frozen e4b/input e85/tool048b and historical certificates unchanged.

## Installed evidence

All paths below are relative to `/tmp/athens-terrain.uKVC/scipy-venv/lib/python3.12/site-packages/scipy/optimize/`.

- `_linprog_highs.py` SHA32999bba42521a001d08bd9a1a02ca663b8b7eb93b6f799f37438e062484c89a lines286–289 explicitly warns about unrecognized SciPy options and forwards them verbatim; line342 merges them. Thus `run_crossover` is not a named public linprog option, but is intentionally forwarded, not silently ignored. Exact expected warning must be recorded and narrowly matched, never blanket-suppressed.
- `_highspy/_highs_options.cpython-312-x86_64-linux-gnu.so` SHA116ed72be9accceafcdeb58d5d02308e5023b9bc98118303a79d3bc24fe171d6 contains option name `run_crossover` and record text `Run IPM crossover: "off", "choose" or "on"`. This is installed embedded documentation, not proof a call has accepted an option.
- `_highspy/_core.cpython-312-x86_64-linux-gnu.so` SHA33fb5a6a86b8fb914b26e69f8f046274b0b043d202511109365d3fde180c540d exposes `run_crossover`; this is not a runtime probe.
- `_highspy/_highs_wrapper.py` SHAc15a943a0985bf716d84b93719d0b2f572e698373655ab0258614b4b2ab67303 lines143–181 queries option type, rejects unknown names and invalid values with warning, and only sets valid values; lines306–338 check string options through the installed manager. Only presolve/parallel convert bool to string. Candidate must be `"off"`, never False.
- Same wrapper lines245–259 returns no LP result unless overall status is Optimal. An interior log labelled optimal during timed-out crossover does not qualify. Lines262–285 export col_value and row_dual after Optimal status. Bound marginals at265–273 depend on basis.col_status, so no-crossover export may be unusable without a basis; cannot assume lower/upper marginals valid or even indexing safe. No patches to installed wrapper are proposed.
- Existing independent verifier `tools/terrain-lp/verify.mjs` lines54–61 analytically pays bounded-variable dual residuals from declared bounds; it does not consume SciPy lower/upper marginals. This preserves a path to a rigorous row-dual certificate if actual exports pass, but does not excuse missing/malformed primal or row duals.

## Fake-only checks

Eight checks execute pinned check_option AST with a fake manager: strings on/off/choose accepted; bool False/True, integer0, invalid string, misspelled name rejected. These validate branching only. They do not verify installed option types/defaults or solve/export behavior. Source and JSON receipt retained alongside this report.

## Proposed next bounded tiny test allocation (not run)

External total <=10 seconds, one worker/OMP/BLAS/MKL1, no real component matrix. First query installed option type/default, validate on/off/choose and invalid values without solving; use actual option-manager/check_option return codes. Require string type, successful off round-trip, no unexpected warnings. Record the precise SciPy forwarding warning separately from any lower-level invalid-option warning; abort on the latter.

Then compare explicit crossover on/off with highs-ipm, fixed presolve and unchanged feasibility tolerances on tiny fixtures: (1) nonzero lower/upper bounds with both active, fixed variable, and nonzero row dual; (2) redundant duplicate/scaled rows and flat objective face to expose degeneracy; (3) existing synthetic terrain fixture with fixed source profile, amplitude and gradient/sag rows. Each solver <=1 second and stop first timeout/nonoptimal/export error. If presolve eliminates every IPM row, that case does not prove no-crossover IPM export; record inconclusive and do not infer success.

For each result require optimal status, finite correctly sized primal/row/bound marginals, zero crossover iterations for off, independently reconstructed original rows/bounds, primal objective, dual sign/stationarity/complementarity and conservative lower bound/gap. Evaluate all semantic terrain rows/Euclidean norm/source profiles with unchanged JS verifier on terrain fixture; bound/degenerate cases use an independent tiny full-row checker and known analytic optima. Include corrupted row-dual and bound/primal negative controls. Inconsistent basis-derived bound marginals must be reported, not repaired by guessing or ignored in the API claim.

Only a separate new grant can run these tiny tests. Passing them would support a narrowly pinned analysis option, not authorize actual remaining components. Any real retry requires separate source pin/controller receipt and parent grant; reuse saved three+Syntagma certificates with fresh independent verification. No secondary until all seven verified. No field, pack, adoption or geography claim.
