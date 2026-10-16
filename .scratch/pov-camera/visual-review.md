# Visual review

Reviewed all 70 fixture before/after pairs across 18 sheets. After the late exterior-furniture removal, re-reviewed all nine sheets with changed baseline frames; every after-mask remained byte-identical. Reviewed all 32 controlled Riviera before/after pairs across eight final sheets, plus full-size MINI, Carrera, SVJ, Superb, truck, bus and bike frames. The road remains clear above a compact instrument strip. No hands/arms, roof/wheel-well intrusion or near-camera clipping appears in accepted after frames. Interior/driver-side passenger-car mirrors remain visible; the passenger-side mirror uses look-around. Native fleet mirrors retain existing static materials.

Settings: personally reviewed both adjusted and reset screenshots. Shared sliders show +8 cm height / -8 cm position, persist under the current config, and reset to zero. Browser assertions are in seat-controls.json; separate unit coverage checks clamping, per-config isolation, reload and reset.

The world fixture holds the Riviera start position/heading for every car and both phases. Lighting and weather are matched within each pair; the running world's conditions change across cars, so brightness/rain are not identical across the entire sheet. The ID mask measures opaque vehicle furniture, not transparent weather effects or world objects. Colour frames are 1024×640 game-canvas captures; vehicle ID masks are 1280×800 at the same 16:10 aspect. HTML HUD is excluded from this vehicle-occlusion audit. The captured world base is intentionally older than the combined world release; the integration owner separately captured the new-world smoke without changing these audited vehicle/camera files.

## Superb anomaly

The first Superb world pair showed a large black quadrilateral around the mirror, absent from the isolated model colour and mask. A fresh same-source before/after pair was clear and personally reviewed by both camera and integration owners. Renderer autoClear, autoClearColor and autoClearDepth were true. Full-scene raycasts through the original block region during the repeat hit distant nature at roughly 68 m, then scenery/sky; no nearby player or rival surface. The first anomalous frames and the repeat ray-probe log are preserved in review-artifacts. The cause is unconfirmed; no runtime workaround or geometry change was made on this evidence alone. The integration owner additionally completed an independent Superb day/night/chase capture on `44df9b9`, exit 0 with no JavaScript errors. Both cockpit frames were personally inspected by both owners and are clear. Their source evidence is `.scratch/lowpoly-vehicles/integrated-superb/after-cockpit-race.png` and `after-cockpit-night.png` in the shared repository; copies accompany this bundle under review-artifacts.

## Riviera review coverage

| Config | Before clear % | After clear % | Visual review |
|---|---:|---:|---|
| mini | 52.09 | 87.81 | inspected |
| z4 | 47.48 | 85.87 | inspected |
| taxi | 44.43 | 87.59 | inspected |
| carrera | 40.34 | 87.23 | inspected |
| gr_yaris | 45.50 | 88.32 | inspected |
| gtv | 47.54 | 87.05 | inspected |
| golf | 44.50 | 88.88 | inspected |
| corolla | 44.77 | 88.39 | inspected |
| superb | 42.13 | 89.67 | inspected |
| police_octavia | 43.06 | 88.84 | inspected |
| mini_jcw | 40.33 | 88.93 | inspected |
| cle | 38.71 | 87.65 | inspected |
| gla | 44.57 | 89.60 | inspected |
| cla | 36.35 | 89.80 | inspected |
| aventador_svj | 43.23 | 87.89 | inspected |
| huracan | 30.69 | 86.48 | inspected |
| ibiza | 49.39 | 88.75 | inspected |
| panda | 53.34 | 87.27 | inspected |
| yaris | 48.17 | 88.87 | inspected |
| e36 | 44.82 | 89.60 | inspected |
| jazz | 47.79 | 88.61 | inspected |
| aygo | 55.41 | 89.41 | inspected |
| qashqai | 48.78 | 89.21 | inspected |
| dolphin | 45.78 | 89.29 | inspected |
| atto3 | 48.24 | 88.96 | inspected |
| van | 76.27 | 89.27 | inspected |
| truck | 47.71 | 85.60 | inspected |
| bus | 75.26 | 86.66 | inspected |
| delivery | 94.78 | 97.10 | inspected |
| scooter | 95.18 | 97.07 | inspected |
| moto | 95.77 | 96.63 | inspected |
| police_moto | 91.59 | 96.44 | inspected |
