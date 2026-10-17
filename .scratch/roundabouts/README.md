# Psychiko roundabouts: retained evidence

Already landed before this continuation: ea9b229 (OSM roundabouts and drivers), 61833e8 (island contacts), 240f2be/c113cf7 (budgets and simulation adapters), a8b3df6 (geographic road heights).

OSM split loops are stitched and normalized counter-clockwise. Directed entries/exits, circulating priority for traffic and rivals, island/kerb geometry and merged chunks are implemented. Race lines/checkpoints follow the carriageway. Island wheel contacts remain off-road even across overlapping race surfaces, and tow corridors exclude the islands. Source tests cover all five raced junctions, reverse entry/exit arms and shared-map extraction.

Historical fixed-camera overviews:

- [Junction 0](after-psychiko-0.webp)
- [Junction 1](after-psychiko-1.webp)
- [Junction 2](after-psychiko-2.webp)
- [Junction 3](after-psychiko-3.webp)
- [Junction 4](after-psychiko-4.webp)
- [Circulating traffic](traffic-0-180.webp)

Current coverage remains in tools/roundabouts.test.mjs and the full-race traffic harness. Current gate results are in the continuation report. Intermediate frames, debug HTML, raw traces and duplicate budget screenshots were removed; required budget fixtures remain in .scratch/detail-pass. Original artifacts remain in Git history.
