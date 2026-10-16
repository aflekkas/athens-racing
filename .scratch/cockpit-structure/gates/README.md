# Release validation

The clean archived candidate on f525f45 passed all six required gates: detached npm test, physics regression, events, syntax, browser imports and staging deployment dry-run (no deployment). npm test: 1,188 passed, six skipped, zero failures across unit, physics, world and damage groups. Physics regression: 1,142 passed, zero failures. The first test run caught an overlong changelog bullet; its failure log is retained and the shortened bullet passed the full rerun.

Production then advanced through b09b85c (tyre-grip HUD removal) to 87f0d64 (building vertex colours). Neither changes cockpit geometry, vehicle/physics data or the rendered source hashes. A second fresh archive retains both parents and repeats the affected cockpit/owner/vehicle/settings/feedback/building/release checks (151 pass, one archive git-author skip), physics regression, events, syntax and browser imports. See landing-*.exit and logs for exact results. Staging dry-run is the complete prior candidate build; parent build/runtime gates passed independently before their commits.

`tested-trees.json` identifies both candidate trees. The final landing differs from the latest tested runtime only by reports, screenshots and gate logs. All 70 exact-source mask/structure guards remain active. No push or live deployment command was run.
