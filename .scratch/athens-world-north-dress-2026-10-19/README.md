# Athens world: dressed north release (2026-10-19)

World `athens-north-development`, dev flag only (`?map=athens`), computer only. Commit 2a78e9c4 plus the doc and staging-pointer commit that follows it.
It is one world of **772 cells** (centre + coast + Piraeus + north, 322 of them north) rebaked with the dressing: ground classes, facade styles, shore foam, traffic signals, street furniture, and derived buildings without a colour attribute.

## Size and memory

| Gate | Result | Limit |
|---|---|---|
| Compressed world | 210,387,829 B = **200.6 MiB** (mean cell 0.27 MB, largest 0.76 MB) | 2 GiB (the stage-2 192 MiB ceiling was lifted by the owner) |
| Largest cell resident | 6.47 MB | |
| Worst 2×2 resident (cell -17,9) | **23.2 MiB** | 64 MiB desktop low-end |
| Worst 3×3 neighbourhood / max transient | 45.1 MiB / 19.6 MiB | |
| Triangles | 24,861,574 | |
| Staging R2 total | 863,149,390 B (2,624 objects, production bucket 0) | 5 GB |
| Staging upload | 773 objects (772 cells + manifest) all present; a re-run of `tools/world-r2.mjs` reports 0 pending | |

## Road gates (`audit-summary.json`)

- Asphalt: 3,411,035 triangles, 0 above 30°, max 27.02°.
- Shoulder sweep: 187,177,972 samples, max step 14.37 cm (≤15 cm), max slope 29.89° (≤30°).
- Missing contacts 0; max profile grade 0.424.
- Bridges: 26,507 edge samples, 0 unguarded; 9,297 clearance samples, 0 blocked, min clearance 4.8 m; 41 cells with decks; 0 unsafe anchors.
- Junctions: 39,549 checked, 0 holes, overlap area 0. Sidewalks: 1,921,992 samples, 0 missing. 12,271 zebras, 170,105 fillets.
- Graph: 100,189 directed edges, 53,190 nodes, 1,523 turn rules, 62,288 tow anchors. Every seam checked (`bake-summary.json`).
- Excluded and reported, not relaxed: 592 roads (191 tunnel, 95 meeting a deck inside its underpass dip, steep streets, short deck approaches).

## Directed reach (`reach.json`, `connectivity-scc-report.json`)

Whole world 5,094.2 km of road, 4,822.4 km enterable from the start edge = **94.7%**. Main strongly connected component 93.3% of directed km.
Districts: Nea Ionia 97.2%, Galatsi 97.9%, Irakleio 86.0%, Psychiko/Filothei 96.8%, Kifisia 97.7%, Marousi 97.1%, Chalandri 94.0%, Agia Paraskevi 87.0%.
Older areas: Piraeus 73.1%, Neo Faliro/Tavros 81.9%, Faliro coast 98.4%, historic centre 96.3%, Kallithea/N. Smyrni 97.4%, Kypseli/Patisia 95.4%, Alimos–Riviera 97.0%.

## 10-minute desktop drive (`measure-dress.json`, 1280x720)

4,320 m driven (628.6 s simulated), 0 holds, 0 missing contacts, 0 failures, 0 errors, 5 reroutes, 3 goals reached. Frame time median 216.7 fps, p95 266.7 (CPU median 14.3 ms).
Stream resident peak 64 MiB (the cap), JS 131 MB, GPU 53.6 MB, 20 tiles. Download: first drive 2.77 MB total (0.58 MB world, 2 cells); the whole run 38.8 MB (93 distinct cells = 36.0 MB, manifest 0.25 MB).
SwiftShader numbers: relative, not device times. `link-drive-dress.json`: the Tavros underpass link into Piraeus, 438 m, 0 holds, 0 missing contacts, 0 errors.

## Screenshots (`shots/`, street level and from above)

`overview-north`, `syntagma-street`, `syntagma-above`, `kypseli-street`, `kifisia-street`, `psychiko-street`, `chalandri-above`, `marousi-above`, `coast-glyfada`, `coast-above`, `piraeus-street`, `tavros-link-street`, `tavros-link-above`.
