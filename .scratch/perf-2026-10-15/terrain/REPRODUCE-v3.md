# Terrain revision 3 measurements

Use one archive with the implementation source and symlink node_modules. No optional codec flag is required.

```sh
python3 .scratch/perf-2026-10-15/terrain/prepare-baseline.py
g++ -shared -fPIC -O2 -I/usr/include/node .scratch/perf-2026-10-15/terrain/thread-clock.cc -o /tmp/terrain-thread-clock.node
mkdir -p /tmp/terrain-lod3-final-packs
```

For each `megara`, `riviera`, `penteli` (substitute MAP):

```sh
node --expose-gc .scratch/perf-2026-10-15/terrain/final-before-measure.mjs MAP before-MAP.json
TERRAIN_PACK_DIR=/tmp/terrain-lod3-final-packs node --expose-gc .scratch/perf-2026-10-15/terrain/lod3-measure.mjs MAP after-MAP.json
node --expose-gc .scratch/perf-2026-10-15/terrain/lod3-selector.mjs MAP selector-MAP.json /tmp/terrain-lod3-final-packs/MAP.pack
```

Browser harnesses use the repository's shared browser slot workflow and local Playwright/Chromium installation. Run one job at a time. Fixed camera coordinates are in the JSON evidence; all-map camera captures use `final-view.html`, and the full-scene wedge views use `wedge-view.html`.

```sh
bash tools/browser-slot.sh node .scratch/perf-2026-10-15/terrain/final-wedge-capture.mjs
bash tools/browser-slot.sh node .scratch/perf-2026-10-15/terrain/final-capture.mjs
```

The capture script's input/output paths match this VPS evidence location. It reads `before-82-MAP.json` only for the unchanged camera coordinates; the baseline source served is exactly `8940394`, not the older source. Baseline material code is shared with the implementation. The map-generation and selection scripts measure CPU counters; browser timings are only diagnostic under SwiftShader.
