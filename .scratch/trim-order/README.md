# Trim ordering

One non-mutating `sortTrims` helper in src/car-catalog.js groups generations in garage order, then sorts each by fantasy flag (fantasy last), ascending power, ascending shared performance index and factory hierarchy. Canonical generation/body ID lists are checked against it for every generation. Garage arrows, pips, catalogue member selection, multiplayer room options, allow-list toggles/getter/presets, and class/spec-rule options use the same order.

Fresh cards enter the lowest trim of the default body. Explicit live/detail picks are preserved, as are existing legacy/structured saved trims. The MINI still maps existing saved `mini` to its original S cabrio; a fresh generation card starts at the hardtop Cooper. Body switches retain their engine-level correspondence. Filters and host/event restrictions can narrow the available trims.

Examples: Golf 1.4 TSI → GTD → GTI → R; Z4 20i → 30i → M40i; E36 318i → 325i → M3; SL 400 → 500 → 63 → 65; Jazz 1.3 → 1.5 → Drift Spec. CLE uses the existing 200 → 300 4MATIC → 300 e → 450 4MATIC → AMG 53 entries; 220d is not currently represented and no car was added. Primary power is applied before PI, so CLE 300 e follows 300 despite its lower PI. Equal-output 348 ts has lower PI than tb and precedes it in the cross-body list; the default body remains berlinetta, whose base trim is tb.

The CARS source array, wire IDs and all vehicle specifications remain unchanged. [Comparison](comparison.json) verified all 78 car specifications, cockpit eyes, geometry, transforms, visibility and material properties against prod. Existing mask images were retained/recounted and their source hashes refreshed after equivalence was established. No browser capture was needed.

Focused tests: all 31 generations and body lists; power/PI/hierarchy precedence; fantasy last even at lower power; non-mutation; base/saved/detail choices; arrows/wraparound/restrictions and pips; reverse-input multiplayer list, spec dropdown and allow toggles. No full gates were skipped; exact candidate results are in the completion report.
