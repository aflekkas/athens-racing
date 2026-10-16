# Side-street asphalt verification

Before: production source at 492f14e. After: the two road fixes in this change.
Native game-canvas PNGs, 960×600, fixed side-street camera positions, low preset.
The same road sample is used on each map. All eight images were visually inspected.

The OSM network did bind the asphalt albedo, but reduced it to a narrow grey
multiplier and omitted the normal scan; its aggregate and repairs were nearly
invisible. The shared world-space scan now retains contrast and normal detail,
with a cheap dark edge. The legacy Riviera strips use the same asphalt function.
No per-road texture allocations or marking meshes were added. Network mesh counts
before/after: Riviera 90/90, Penteli 70/70, Psychiko 73/73, Megara 9/9.
Psychiko's route corrections alter its triangle count, not its road draw count.

The base road treatment is independent of the optional realism detail layer;
no graphics preset, draw distance, or owner-locked scenery setting was changed.
Capture: `bash tools/browser-slot.sh node tools/road-fixes-capture.mjs after`.
For before captures use `before` and set ROAD_REPOSITORY to a checkout containing
492f14e (or override ROAD_BASELINE). The baseline road shader and Psychiko map are
served from that commit without checking out or changing the shared worktree.
