# Side-street asphalt: retained evidence

Already landed before this continuation: 7284891. Shared world-space asphalt albedo/normal detail and cheap dark edges cover drivable side roads, merged per chunk. No per-road texture allocations or extra marking meshes were added. The material is independent of optional scenery detail.

Historical fixed-camera before/after samples (baseline 492f14e):

- Riviera: [before](before-riviera.webp), [after](after-riviera.webp)
- Penteli: [before](before-penteli.webp), [after](after-penteli.webp)
- Psychiko: [before](before-psychiko.webp), [after](after-psychiko.webp)
- Megara: [before](before-megara.webp), [after](after-megara.webp)

Coverage: tools/road-asphalt.test.mjs, road network tests and roundabout tests. Current clean-archive gate results are recorded in the continuation report. Original PNGs remain in Git history; only these WebP comparisons are retained here.
