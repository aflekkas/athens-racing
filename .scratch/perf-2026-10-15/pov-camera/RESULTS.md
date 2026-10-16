# POV visibility measurement

These are deterministic vehicle-only WebGL counts from the exact source hashes in `.scratch/pov-camera/mask-source-hashes.json`. Both columns render the same final low-poly candidate: before restores the legacy camera/exterior visibility and wheel; after uses the derived eye and hides the own exterior/wheel. This isolates the camera policy from the separately owned vehicle simplification. It is not a historical production-commit comparison and makes no frame-rate claim. Integration lineage: `237fe895dcebd83caa1d3f0ba1fea704f615564c` on `9e5e85f`, then `44df9b9` on `5c72f29` with the simplified world. The final source hashes additionally include the optional bike LED-material guard and the exact `8940394` suspension catalogue. All 70 masks and colour fixtures were rerendered; all 280 PNGs remained byte-identical. Intended landing parent is `239defc` (TODO-only after `8940394`). The integration owner records the final production SHA after combined gates and evidence.

Tradeoff selected by the owner: the own bonnet, roof, wheel wells and steering rim disappear in first person; mirrors, compact instruments and wipers remain. Exterior cameras restore the body. This trades interior framing for road visibility; it does not change the world or other vehicles.

| Config | Draw calls before → after | Triangles before → after | Clear view before → after |
|---|---:|---:|---:|
| mini | 65 → 14 | 2962 → 350 | 52.09% → 87.81% |
| z4 | 62 → 14 | 2366 → 350 | 47.48% → 85.87% |
| taxi | 64 → 15 | 2668 → 348 | 44.43% → 87.59% |
| carrera | 71 → 14 | 2538 → 382 | 40.34% → 87.23% |
| gr_yaris | 62 → 14 | 2969 → 334 | 45.50% → 88.32% |
| gtv | 73 → 16 | 3683 → 430 | 47.54% → 87.05% |
| golf | 59 → 14 | 2404 → 334 | 44.50% → 88.88% |
| corolla | 59 → 14 | 2306 → 334 | 44.77% → 88.39% |
| superb | 60 → 14 | 2650 → 334 | 42.13% → 89.67% |
| police_octavia | 68 → 14 | 2814 → 334 | 43.06% → 88.84% |
| mini_jcw | 61 → 14 | 2372 → 350 | 40.34% → 88.93% |
| cle | 55 → 14 | 3310 → 334 | 38.71% → 87.65% |
| gla | 59 → 14 | 2206 → 334 | 44.57% → 89.60% |
| gla45 | 57 → 14 | 2514 → 334 | 40.58% → 87.79% |
| cla | 57 → 14 | 3336 → 334 | 36.35% → 89.80% |
| aventador_svj | 45 → 14 | 1416 → 334 | 43.23% → 87.89% |
| huracan | 48 → 14 | 2114 → 334 | 30.69% → 86.48% |
| ibiza | 55 → 14 | 1864 → 334 | 49.39% → 88.75% |
| panda | 47 → 14 | 1804 → 334 | 53.34% → 87.27% |
| yaris | 50 → 14 | 1816 → 334 | 48.17% → 88.87% |
| e36 | 53 → 14 | 2064 → 414 | 44.83% → 89.60% |
| cle200 | 55 → 14 | 3310 → 334 | 38.71% → 87.65% |
| cle450 | 55 → 14 | 3330 → 334 | 38.71% → 87.65% |
| cle53 | 53 → 14 | 2342 → 334 | 38.35% → 87.76% |
| e36_m3 | 53 → 14 | 2108 → 414 | 44.70% → 89.60% |
| panda_11 | 47 → 14 | 1804 → 334 | 53.34% → 87.27% |
| panda_100hp | 45 → 14 | 1848 → 334 | 52.56% → 87.27% |
| yaris_13 | 50 → 14 | 1816 → 334 | 48.17% → 88.87% |
| yaris_ts | 50 → 14 | 1860 → 334 | 48.17% → 88.87% |
| ibiza_cupra | 55 → 14 | 1908 → 334 | 48.97% → 88.75% |
| golf_gti | 60 → 14 | 2448 → 334 | 43.75% → 88.88% |
| golf_gtd | 59 → 14 | 2448 → 334 | 43.75% → 88.88% |
| golf_r | 59 → 14 | 2448 → 334 | 43.75% → 88.88% |
| mini_cooper | 59 → 14 | 2260 → 350 | 40.93% → 88.93% |
| mini_s | 60 → 14 | 2328 → 350 | 40.34% → 88.93% |
| mini_cabrio_cooper | 65 → 14 | 2962 → 350 | 52.09% → 87.81% |
| corolla_15 | 59 → 14 | 2306 → 334 | 44.77% → 88.39% |
| octavia_16tdi | 62 → 15 | 2788 → 348 | 44.43% → 87.59% |
| octavia_rs | 59 → 14 | 2790 → 334 | 44.04% → 87.79% |
| superb_15 | 60 → 14 | 2650 → 334 | 42.13% → 89.67% |
| superb_4x4 | 60 → 14 | 2694 → 334 | 41.44% → 89.67% |
| cla250 | 57 → 14 | 3336 → 334 | 36.35% → 89.80% |
| cla35 | 57 → 14 | 3380 → 334 | 36.40% → 89.80% |
| cla45s | 55 → 14 | 2420 → 334 | 36.51% → 89.80% |
| gla250 | 59 → 14 | 2206 → 334 | 44.57% → 89.60% |
| z4_20i | 62 → 14 | 2322 → 350 | 48.04% → 86.17% |
| z4_30i | 62 → 14 | 2322 → 350 | 48.04% → 86.17% |
| carrera_s | 71 → 14 | 2622 → 382 | 40.19% → 87.23% |
| carrera_gts | 71 → 14 | 2622 → 382 | 40.19% → 87.23% |
| huracan_rwd | 48 → 14 | 2094 → 334 | 30.69% → 86.48% |
| gtv1750 | 71 → 15 | 3619 → 414 | 46.88% → 86.16% |
| e36_318i | 53 → 14 | 2064 → 414 | 44.83% → 89.60% |
| mini_cabrio_jcw | 65 → 14 | 3006 → 350 | 52.09% → 87.81% |
| cle300e | 55 → 14 | 3318 → 334 | 38.71% → 87.65% |
| jazz | 51 → 15 | 1872 → 350 | 47.80% → 88.61% |
| jazz_dynamic | 52 → 15 | 1904 → 350 | 47.80% → 88.61% |
| jazz_drift | 52 → 15 | 1960 → 350 | 47.78% → 88.61% |
| aygo | 91 → 8 | 1334 → 112 | 55.41% → 89.41% |
| qashqai | 91 → 8 | 1292 → 112 | 48.79% → 89.21% |
| qashqai_dci | 91 → 8 | 1292 → 112 | 48.79% → 89.21% |
| dolphin | 92 → 8 | 1332 → 112 | 45.77% → 89.29% |
| atto3 | 88 → 8 | 1260 → 112 | 48.24% → 88.96% |
| van | 39 → 6 | 656 → 48 | 76.27% → 89.27% |
| van_150 | 39 → 6 | 656 → 48 | 76.27% → 89.27% |
| truck | 34 → 8 | 458 → 112 | 47.71% → 85.60% |
| bus | 36 → 8 | 768 → 112 | 75.26% → 86.66% |
| delivery | 17 → 10 | 322 → 180 | 94.79% → 97.10% |
| scooter | 17 → 10 | 322 → 180 | 95.19% → 97.07% |
| moto | 15 → 10 | 266 → 180 | 95.77% → 96.63% |
| police_moto | 24 → 10 | 366 → 180 | 91.59% → 96.44% |

All 70 default views pass the 80% owner threshold. Before/after fixture contact sheets are `.scratch/pov-camera/fixture-contact-*.webp`; real Riviera pairs and contact sheets are recorded separately in the same evidence directory. Timing is deliberately omitted because this VPS uses SwiftShader.
