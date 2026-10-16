# Matched Riviera render counters

One main-scene render at the same start pose, FOV 66°, time 8.25 s. These are deterministic draw calls/triangles, not SwiftShader GPU or FPS estimates. Day comparisons keep the same vehicle, pose and FOV. The restored seated eye changes the frustum, so scene-count differences include the resulting visibility changes. Rain sweep was omitted under the lead wrap-up instruction. The world weather code is unchanged by this pass.

| Vehicle | Day calls before → after | Day triangles before → after |
|---|---:|---:|
| mini | 182 → 198 | 625228 → 627334 |
| carrera | 186 → 202 | 625476 → 627114 |
| aventador_svj | 182 → 202 | 625368 → 626998 |
| cle | 186 → 203 | 625428 → 627384 |
| e36 | 187 → 203 | 625520 → 627044 |
| gtv | 189 → 205 | 625536 → 627240 |
| bus | 175 → 180 | 616966 → 617868 |
| delivery | 162 → 168 | 625074 → 625910 |
