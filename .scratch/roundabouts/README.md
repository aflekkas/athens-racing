# Psychiko roundabout verification

Baseline: 492f14e. `before-psychiko-0..4.png` and `after-psychiko-0..4.png`
show the five raced junctions at identical native-canvas top-down camera poses.
`debug-0..4.png` (and self-contained HTML sources) compare the old course,
corrected course, directed OSM loop, island and legal reverse-traffic arms.

The old course explicitly permitted reverse one-way travel. It followed the
clockwise side of several roundabouts and used outward one-way slips as entries.
The live network extractor also discarded junction=roundabout and implicit
one-way tags. Traffic treated the whole circuit as an ordinary two-way strip;
markings could draw a two-way centre line on the one-way circle. There was no
explicit island in the contact/recovery model.

The frozen-OSM builder now stitches split ways, normalizes complete loops CCW,
retains directed edges and chooses legal junction entry/exit paths. The authored
race course follows the CCW carriageway. Its updated length is 6377.35 m; the
catalogue, marks, closures, terrain and track geometry version follow that source.
Closed-race permissions on ordinary streets remain separate from roundabout rules.

Traffic follows a world-space circulating path. Reverse-course traffic uses
OSM-directed incoming/outgoing arms rather than reversing the race slips. Its
actual position is projected into the shared traffic/collision model. Circulating
cars have priority at entry; rivals use the same yield policy. The island has a
raised top and outward-facing 14 cm kerbs merged into the existing road chunks.
Ground contact calls the island grass, and the tow corridor excludes it.
Roundabouts have no two-way centre markings. Gameplay road/island geometry is
independent of the optional realism detail toggle and graphics presets.

`traffic-N-*.png` are fixed-camera free-roam traffic sequences; both approach
directions circulate CCW. `traffic-N.json` records the sampled positions and
island-violation counts. Staged test cars are held active while ambient spawning is frozen. Indices map to OSM loops:
0=25053533, 1=25053095, 2=25053106, 3=634346640, 4=470144907.
All before/after side-road images, roundabout overviews and debug diagrams were
visually inspected. Browser work used tools/browser-slot.sh.

Shared-source audit: Riviera and Penteli use the same corrected extractor, which
now keeps implicit one-way tags even on partially clipped roundabout ways. None
of their selected runtime corridors, or Megara's surrounding network, contains a
complete roundabout loop. The separate AWT generator already infers roundabout
one-way direction in tools/world-gen/model.py and has a regression for it.

Focused tests cover split/closed/geometry-only OSM rings, one-way graph edges,
source course direction, legal reverse entry/exit arms, racing lines/checkpoints
outside every island, island ground/corridor contact, CCW traffic integration,
yielding and release, merged road/island draw geometry, shared-world snapshots and authority handoff.

Reproduce captures with:
`BROWSER_SLOTS=1 bash tools/browser-slot.sh node tools/road-fixes-capture.mjs after`
`BROWSER_SLOTS=1 bash tools/browser-slot.sh node tools/roundabout-traffic-capture.mjs after`
`BROWSER_SLOTS=1 bash tools/browser-slot.sh node tools/roundabout-debug.mjs`
Set ROAD_REPOSITORY when running from an archive without .git; the debug/before
runners read baseline 492f14e through git show without changing a checkout.
