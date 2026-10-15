# Round one — review before rollout

Baseline: `694a9cf` (includes `272efb8`, the Athens Racing rename, and Opus's `9b5760d` screen flattening). Only Garage catalogue, Race setup and Settings / Graphics opt into the new shared racing appearance. Car detail, other settings tabs and every other route wait for lead/user review.

- `before/` and `after/`: actual in-game screens at 1280×720 and 390×844, Low graphics. Three matching pairs per width; the after set also includes the open custom listbox.
- `contact-sheet.png`: all six before/after comparisons.
- `garage-thumbnails.png`: all 31 current garage entries, including bikes, bus, convertibles and Aventador.
- `garage-thumbnails.json`: paint/cache keys, encoded image bytes and renderer counters. The full queue used one renderer, peaking at 333 geometries / 9 textures. This is on-demand Garage work.
- `before-validation.json` / `after-validation.json`: zero map worlds, zero map data requests, zero thumbnail module/image requests at title boot; no native selects, horizontal overflow or browser errors. Actual keyboard preset changes and touch opening a car detail route passed.
- `gates/`: detached full test suite, physics regression, events, syntax, browser imports and staging dry-run exit markers/logs, run on a private clean archive.

Shared builders preserve their existing input contracts. `C.screen({appearance:'racing'})` is the explicit review switch. Listboxes inherit the appearance from their anchor, and tabs/segments retain their animated indicator. Garage imports the thumbnail queue only when opened; visible cars render in saved paint, then reuse a bounded memory/disk WebP cache keyed by build, car and paint. Leaving during compilation defers disposal until the draw has settled.

Visual review: these are clearly different layouts and controls, with bold italic titles, lime choices/actions, the Greek road sign and next-road/current-car strip. The thumbnails show the game's stylised geometry; the route heroes use actual route artwork rather than photography. No wider rollout is included.

All six required gates exited 0 on clean archive `818b2ad215362d7bc5777fc833514bd160034f16`. The final commit adds only the review spec, screenshots and validation evidence to that validated source snapshot.
