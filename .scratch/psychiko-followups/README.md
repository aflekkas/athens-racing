# Psychiko frontage and closure follow-ups

Final parent: `22ea3635b2c11cdc287a3bb075c49a3fb09ddff8` (AWT owner dependencies).
Final code: `bcef41a74560ca391402e63165d3273406802bd4`. Full six-gate tested code: `5fc6b7430ae19e3d51102e245304e784bee6697a` on parent `bb2333e16bae99d2d3fe69fdd18faeada4f0682a`.

## Building positions

The shared box renderer does not translate the footprints or apply a setback. The problem was the offline Psychiko generator: it omitted the whole building when any source corner was within 8 m of the race centreline. That erased legitimate close-frontage homes, leaving large empty plots in front of the surviving houses.

The generator now uses the street's actual half-carriageway width plus 5 cm of clearance. It restores 34 OSM footprints, bringing the total from 3,507 to 3,541. Every previously present building record is unchanged. One genuine overlap with the preserved drawn race carriageway, OSM way 423850532, remains excluded; no footprint is pushed away from the road to hide that overlap. Every restored source polygon clears the race carriageway, with a minimum clearance of 0.945 m (`restored-clearances.json`). The race route, road network, all 92 closures, lap setup and terrain bytes are unchanged (`provenance.json`). Furniture is regenerated against the restored footprints to avoid placing lamps inside the newly present buildings.

`tools/psychiko-frontage-audit.mjs` independently projects the frozen OSM nodes and compares them with the actual rendered, transformed building mesh. Roof-triangle area centroids detect translation, scale and placement errors; boundary-to-road distances detect a changed frontage setback. Tests allow at most 0.10 m for either difference. The results are in `frontages-after.json`:

| Street | OSM way | Centroid error | Nearest-edge error | Source distance from rendered kerb |
|---|---:|---:|---:|---:|
| Sismanoglou | 423843655 | 0.0035 m | 0.00015 m | 3.48 m |
| Bizaniou | 307559043 | 0.0298 m | 0.00041 m | 2.66 m |
| Davaki | 308022552 | 0.0015 m | 0.00014 m | 4.22 m |

Live OSM API checks match the frozen source node IDs and coordinates exactly. Downloaded responses are in `osm-live/`; URLs, source versions and comparisons are in `provenance.json`:

- [Sismanoglou source footprint](https://api.openstreetmap.org/api/0.6/way/423843655/full.json)
- [Bizaniou source footprint](https://api.openstreetmap.org/api/0.6/way/307559043/full.json)
- [Davaki source footprint](https://api.openstreetmap.org/api/0.6/way/308022552/full.json)

The wider frozen extract has 17 wall ways, with the closest about 460 m from the course; it provides no front-garden wall geometry along these audited streets (`source-walls.json`). No invented wall positions, trees, facade changes or new decorative scenery are introduced. The separate realism work can proceed through the shared builders.

## Matched pictures

All eight native game-canvas PNGs and the release WebP were opened and inspected. Each before/after pair uses the same source camera coordinates, 65° FOV, 1.8 m street-level eye height and clear afternoon conditions, with the same terrain/road buffers. The only map-data difference is the frontage restoration. No image content was retouched. The WebP is a format export of the Sismanoglou after PNG.

- Sismanoglou: [before](before-sismanoglou.png), [after](after-sismanoglou.png).
- Bizaniou: [before](before-bizaniou.png), [after](after-bizaniou.png).
- Davaki: [before](before-davaki.png), [after](after-davaki.png).
- Roadworks at the same exit: [race closures](after-race-closures.png), [free roam open](after-free-open.png).

## Closures

The existing race-only behavior is retained and now explicitly owner-locked in `docs/OWNER-DECISIONS.md`: **Road closures only in races, never in free roam.** The new test uses the real free-roam and authored race definitions, checks repeated transitions, preserves ordinary props, and verifies the closure visibility and entire collider list. The existing all-92-exit visual/physics and real-vehicle crossing tests remain active.

The browser run called the real `prepareEvent` flow: races show 92 colliders and visible barriers; free roam shows zero closure colliders and hidden barriers. `browser-report.json` records both and no page exceptions.

## Validation

The focused world/geometry tests and release-note checks passed. Final six-gate logs and exit markers are under `gates/`, run detached on a clean archive of the tested code with symlinked node_modules. Only unrelated historical screenshot directories were omitted for disk space; required POV mask fixtures were retained. Wrangler is a staging dry-run, with no remote deployment or GitHub writes.

The final evidence commit adds only this directory. Source, tests and the credited release picture are in the tested code commit. No shared working-tree or index changes were made.

The code was rebased over the concurrent offline generator landing. Game source/assets/data/server/worker trees are identical to the inspected capture revision, so the matched screenshots remain representative. All six gates passed on that combined revision.

The final rebase includes only the concurrent AWT owner-dependency validation/streaming change, its tests and documentation/evidence. Psychiko uses the classic baked terrain/road path, not an AWT manifest. Its renderer, map data, physics, route and races are unchanged from the full-gate revision and matched captures. Per the lead's concurrent-landing policy, final affected checks cover owner guards, Psychiko, AWT format/stream/scene/packing, syntax, imports and events. Full six-gate logs remain in `gates/`; final affected-check logs are in `fast-checks/`. The release train runs full gates on the combined head before deployment.

All six gates passed with exit 0 on 5fc6b7430ae19e3d51102e245304e784bee6697a (parent bb2333e16bae99d2d3fe69fdd18faeada4f0682a): npm test, physics regression, events, syntax, browser imports and staging Wrangler dry-run. Physics regression: 1,142 passed, zero failed; Psychiko recovery: 328 samples, zero invalid. Psychiko rival races completed cleanly and its full road/terrain conformance scan passed. Final rebased checks passed: 85 affected tests, zero failed, one expected skip; syntax, imports and events all zero. See provenance.json for the final tested code and parent.
