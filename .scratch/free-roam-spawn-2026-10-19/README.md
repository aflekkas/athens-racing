# Free roam spawn picker (owner decision 2026-10-19)

"free roam should have no tracks, it should be more of like i just pick where to be spawned" (docs/OWNER-DECISIONS.md).
Headless Chrome (SwiftShader) on a private server, reduced motion on, at 1280×800 and a narrow desktop window, 960×700.
`capture.mjs` produced every file (`SIZES` / `SCENES` pick what runs); the `report-*.json` files hold the measured placement.

| File | What it shows |
| --- | --- |
| picker-{1280x800,960x700}.webp | The spawn picker: the full-page Attica map, named pins, Vouliagmeni chosen, the floating panel (place, car, DRIVE) |
| picker-overview-{…}.webp | Scrolled out to every region: one group of pins per map (Megara, Riviera, Psychiko, Penteli) |
| road-click-{…}.webp | A click on a named Varkiza street: the marker snaps to the road, the panel names it |
| no-road-{…}.webp | A click on open water: the short "NO ROAD HERE" note, the choice stays |
| in-car-riviera-{…}.webp | DRIVE from Vouliagmeni: in the cockpit on the road, no route, start/finish or race HUD |
| in-car-psychiko-{…}.webp | DRIVE from Kifisias Avenue (Psychiko map): same, on a street |

Placement (`report-960x700.json`, measured in the page against the map's own roads, independent of the planner): both spawns
`roadDistance` 0 m, on the tarmac, car height equal to the road height, `mode` "free", route HUD hidden.
The Riviera pose at 1280×800 was captured in a first run whose report was lost to a harness error on the next step; the code is the same.
