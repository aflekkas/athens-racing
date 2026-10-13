# Player model construction and validation

The player pass is isolated from the traffic builders. `player-original-surfaces.js` owns F57 MINI, G29 Z4 and Octavia IV coachwork; `player-sports-surfaces.js` owns 991.1 Carrera, 2024 GR Yaris and 105-series 2000 GTV detail; `player-vehicle-details.js` owns player wheels, signals, paint, named parts and distance LODs. `vehicle-models.js` assembles these only for the six player IDs. Original procedural meshes use metres with the nose towards -Z.

## References

The source photos and exact view maps are local review evidence, never game textures: `.scratch/player-cars/reference/<car>/{front,rear,side,interior}.jpg`. Source URLs are in `original-sources.json`, `sports-sources.json` and each car's source metadata. References include:

- [MINI F57 Convertible press material](https://www.press.bmwgroup.com/united-kingdom/article/attachment/T0256464EN_GB/353152).
- [BMW G29 wheel and tyre specification](https://www.bmw.com/content/dam/bmw/marketAU/common/images/BMW_Z4_Specification_Guide_G29.pdf.asset.1646282785621.pdf): staggered 19-inch 800M double spokes, 255/35 and 275/35 tyres.
- [Porsche 991 launch photography](https://www.ausmotive.com/images2011/Porsche-991-911-01.jpg).
- [Toyota GR Yaris 2024 press kit](https://media.toyota.co.uk/the-new-toyota-gr-yaris/).
- [Alfaholics 2000 GTV steel-wheel centre cap](https://www.alfaholics.com/parts/105-series/wheels-and-hubcaps/2000-gtv-berlina-spider-wheel-hub-cap/).

These are reference-proportioned procedural game models, not licensed scans or manufacturer CAD. Reference photographs may show optional wheels, paint, trim or roof positions; the game has its own consistent stock configuration.

## Runtime contracts

- Preserve `root -> wheel.pivot -> wheel.spin`. `wheel.caliper` remains a sibling of spin under the pivot. Wheel radius, axle offset, steering and per-corner speed hooks remain unchanged.
- Close meshes are batched within individual part groups. The exact damage IDs are `bumper_f`, `bumper_r`, `bonnet`, `boot`, `door_lf/rf` (plus `door_lr/rr` for Octavia), `mirror_l/r`, `light_fl/fr/rl/rr`, and `glass_windscreen`. Actual door skin is partitioned so a detached door includes painted sheet metal. Lamp trim travels with its optical group. Front and rear end caps are clipped at y=0.48 m; the upper sheet metal stays in the permanent structure while only the lower bumper cover detaches. Interior door liners/cards carry damageInterior and damageSide tags.
- `setIndicators('left'|'right'|'hazard'|'off')` controls independent amber channels. Reverse lamps follow negative motion through the existing model animation call. Brake/running-light and night-light hooks remain compatible.
- Each player has a `THREE.LOD` under body and under each wheel spin. At 15 m (8% hysteresis), the actual painted shell and glass replace fine trim and cockpit furniture. At 65 m (12% hysteresis), a cheap dimensioned silhouette replaces that road detail. LOD hierarchy is complete before the damage system captures meshes. Camera-driven LOD works for rivals and multiplayer without their controllers needing a new update hook.
- Paint uses clearcoat plus distance-filtered procedural roughness flakes, with no added texture download. Factory matte paint selection still controls roughness and clearcoat.
- The cockpit initially shows a neutral horizon in uninitialized render-target mirrors. `setMirrorReady()` switches to the real rear-view render after it has been populated. Low graphics updates the shared 512×144 rear-view target every ninth frame; standard graphics every third frame. The player's own exterior is excluded from that pass to avoid seat/driver occlusion. Door mirrors crop opposite sides of the same rear view; they are not independent ray-traced views.

## Validation

Run `npm test`, `node --import ./tools/physics-test/register.mjs tools/physics-test/regress.mjs`, and the browser exports in `vehicle-checks.js` (including `runPlayerBudgetChecks`) and `player-vehicle-checks.js` from the vehicle studio. The player checks cover populated part groups, real door skin, signal independence, LOD switching/reduction, and wheel hierarchy.

Visual evidence is in `.scratch/player-cars/comparison/` (four real-photo/model comparisons per car), `.scratch/player-cars/interior/`, and `.scratch/player-cars/game/` (chase and cockpit views). Browser automation must run through `tools/browser-slot.sh`; close its browser in `finally`. Use a fresh browser context or disable caching when reviewing ES module edits; a cached module can otherwise make a new page display old geometry.

### Geometry budget gate

The complete model including cockpit must remain below 80,000 triangles at 5 m, 20,000 at 20 m, and 3,000 at 100 m. Count visible meshes after updating every LOD. Current complete hero totals are 52,446–74,871; road detail 12,438–19,880; far 800–912. Static meshes merge per material within damage and motion boundaries: hero 124–144 draws, road 21–22, far 14–17. Independent breakable groups prevent merging the entire hero into a handful of draws.

The procedural body surfaces and cabin furniture remain simplified compared with photographs, especially complex fascia transitions and dashboard sculpting. Do not describe these as manufacturer-CAD fidelity.
