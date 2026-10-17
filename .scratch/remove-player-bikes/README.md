# Player lineup: motorcycles retired

Removed player IDs `delivery`, `scooter`, `moto` and `police_moto`. They no longer occur in CARS, generation/trim entries, garage categories, player native-fleet builders, player cockpit/instrument/camera branches or the dynamic player physics catalogue. Retired their camera anchors, rendered mask fixtures and bike-only physics validation/stability branches. Car-class and multiplayer lists derive from the reduced catalogue.

Legacy `paraliaki.car` and structured `paraliaki.car.selection` bike choices migrate to the MINI and persist in both formats. Known car trims survive. Native and Worker protocol picks reject bike IDs; Worker hibernation normalizes removed session cars and bike-only host rules before publishing a lobby.

Traffic bikes, police bikes, shared far silhouettes, engine banks, rider ejection and ragdoll code remain. [Exact comparison](comparison.json) found all 78 remaining car specifications, cockpit eyes, mesh geometry/transforms/materials/visibility unchanged, plus all eight traffic-bike near/far variants unchanged. The existing 78 rendered cockpit masks are retained and recounted by the normal guards; source hashes were refreshed after that equivalence check. Two retired mask colour codes are reserved to preserve the fixture encoding, with no bike-specific roles remaining.

Focused tests cover lineup absence, persistent/idempotent save migration, native/Worker rejection and hibernation, and traffic bikes with attached riders at both detail levels. Existing traffic/ragdoll tests remain. No browser/server was needed for this data removal; no visual geometry changed.

The exact landing candidate must pass npm test, standalone physics regressions, browser imports and syntax on a clean git archive. Gate results and the landed SHA are recorded in the external completion report.
