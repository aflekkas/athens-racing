# Vehicle model construction and reference notes

Playable: MINI Cooper S Cabrio F57 (B48, FWD), BMW Z4 M40i G29 (B58, RWD), Škoda Octavia IV liftback 2.0 TDI DSG taxi (FWD). Traffic adds the BYD Dolphin, BYD Atto 3 and Škoda Superb taxi, with several paint choices. The older generic traffic types and low-detail parked rows remain deliberately lightweight.

The models are original procedural meshes in `src/vehicle-models.js`, measured in metres, pointing towards -Z. No downloaded car meshes or manufacturer photographs are shipped as textures. Images were inspected as design references only. They are reference-proportioned game models, not manufacturer CAD or scans.

## Visual reference sources

- [MINI Convertible F57 press information](https://www.press.bmwgroup.com/united-kingdom/article/attachment/T0256464EN_GB/353152): convertible proportions and drivetrain.
- [MINI Cooper S Cabrio interior photograph](https://www.motorbox.com/auto/auto-viste-e-provate/auto-day-by-day/mini-cooper-s-cabrio-2021-prova-prezzi-opinioni-foto): circular central display, vent arrangement, toggles, console and steering controls.
- [BMW Z4 model introduction and gallery](https://www.press.bmwgroup.com/usa/article/detail/T0285141EN_US/the-new-bmw-z4): G29 body, lamps, cockpit, wheels and exhaust arrangement.
- [BMW Z4 interior photograph](https://de.motor1.com/news/266490/bmw-z4-2019-technische-daten/): digital cockpit, raised central display, vent and console layout, cognac upholstery.
- [Škoda Octavia IV interior press kit](https://www.skoda-storyboard.com/en/press-kits/skoda-octavia-press-kit-2/interior-new-design-improves-ergonomics-and-appearance/): two-spoke wheel, floating central display, layered dashboard and door trim.
- [BYD Dolphin](https://www.byd.com/uk/electric-cars/dolphin.html) and [Atto 3](https://prod.byd.com/eu/electric-cars/atto3): proportions, closed EV nose and lamp treatment. EV models have no exhaust outlets.

## Construction and animation

Each wheel has an independent steering pivot and spin group. Brake discs spin; calipers remain on the pivot. Player animation reads the four physics corner velocities (FL/FR/RL/RR) and shows unequal wheelspin, reversing and lockup. Positive physics steering turns right; the Three.js pivot rotates in the opposite sign. Visual Ackermann increases the inner wheel angle. The tyre physics still uses a common axle steering angle.

The shell uses a single side-surface function for body shape, panel seams and wheel-arch lips. End caps match the side cross-sections; door shoulders bridge the outer skin to the window sill. Roof, pillars and glass share perimeter endpoints. Decorative strips are projected back onto the shell rather than positioned at an unrelated fixed width.

Traffic geometry is cached by model. Each vehicle receives its own paint, brake-light material, and sequential fictional Greek-style registration; front and rear match. Damage clones geometry on first impact so one crashed car cannot deform every car sharing its model. `setDamage(zone, amount)` accepts absolute 0–1 values; setting all zones to zero restores the original geometry. Damage follows a shared displacement field across body and trim to retain their joins.

The model studio at `/tools/models.html` (on a development static server) provides orbit views, cabin views, wheel rolling, steering, brake lights, damage and GLB export. Exported wheels retain their transform hierarchy for use in Blender or other modelling tools. Runtime shader-only upholstery details are not baked into the GLB.

The physics review and regression suite are documented in `tools/physics-review.md`. These are simplified real-time dynamics, not a tyre or crash simulator validated against instrumented vehicle tests.

## Six-car catalogue expansion (October 2026)

The playable catalogue also includes `carrera` (2012 Porsche 911 Carrera 991.1, 3.4-litre flat-six, RWD, 7MT), `gr_yaris` (2024 European Toyota GR Yaris, 1.6-litre turbo triple, AWD, 6MT) and `gtv` (Alfa Romeo 2000 GT Veloce, Bertone/105, twin-cam four, RWD, 5MT). Manual ratios are vehicle data; the game's default automatic controller still operates these transmissions.

| Car | Power / torque anchors | Mass | Length × width × height | Wheelbase | Tyres |
| --- | --- | --- | --- | --- | --- |
| Carrera | 257 kW at 7,400 rpm / 390 Nm at 5,600 | 1,380 kg | 4.491 × 1.808 × 1.303 m | 2.450 m | 235/40 ZR19 front, 285/30 ZR19 rear |
| GR Yaris | 206 kW at 6,500 rpm / 390 Nm at 3,250–4,600 | 1,280 kg | 3.995 × 1.805 × 1.455 m | 2.560 m | 225/40 ZR18 |
| 2000 GTV | 97 kW at 5,500 rpm / 182 Nm at 4,200 (net-output approximation) | 1,040 kg | 4.100 × 1.580 × 1.328 m | 2.350 m | 165 HR14 |

Sources and modelling assumptions:

- [Porsche's 2012 991 specification sheet](https://newsroom.porsche.com/dam/jcr%3A6918184a-6bbe-44f3-bf4e-3f8a331dbd46/2012_911_991_Specs.pdf.PDF) provides engine peaks, 7MT ratios, 3.44 final drive, dimensions, kerb mass, tyres and 7,800 rpm limit. The game uses a 39:61 static split as a 991-family approximation; the base Carrera was not separately corner-weighed. Rear damage reduces engine power; frontal damage affects the radiator, consistent with the rear engine and front cooling circuit.
- [Toyota's 2024 EU press kit](https://newsroom.toyota.eu/new-toyota-gr-yaris-dpl-press-kit/) and [2024 technical specification](https://www.toyota-media.at/assets/174985?download=true) provide engine peaks, 7,200 rpm limit, mass, dimensions, tyres and the two final-drive sets. The six game ratios are the overall gear × final-drive products, with `final:1`. The 60:40 static weight split is an estimate, separate from torque distribution.
- The GR Yaris base `awdRear:0.47` represents Gravel's 53:47 front/rear torque split. The 2024 Track mode varies between 60:40 and 30:70. The physics owner's default `awdDrift:0.7` is a slide assist approximating Track's rear-biased end, **not a factory Sport mode** or a complete GR-FOUR controller simulation.
- [Alfa Romeo's 1973 European 2000 GTV/Spider brochure, archived scan](https://www.alfa-service.com/downloads/salesbrochures/1973%202000%20GTV%20%26%20Spider%20Sales%20Brochure%20-%20European.pdf) supplies the 1,040 kg kerb mass, 165 HR14 tyres and principal dimensions. [FIA homologation 5440](https://historicdb.fia.com/sites/default/files/car_attachment/1600894202/homologation_form_number_5440_group_1.pdf) supplies the 2.35 m wheelbase, 4.10 × 1.58 × 1.328 m dimensions, 5-speed ratios and 4.10 final drive. The brochure/FIA engine figures are **SAE gross** (150 hp / 21.1 kgm), not DIN net. The game's 97 kW / 182 Nm net anchors are an approximation and should not be attributed to those gross-output figures. The 54:46 weight distribution, CdA and suspension/tyre coefficients are tuning estimates. These are the least certain of the new specifications.
- Torque curves are piecewise interpolations through the rated torque/power anchors, **not measured full dyno traces**. Off-peak torque, drag area, effective rolling radius, tyre friction, suspension frequency/damping and shift time remain game-model estimates. Regression envelopes detect broken dynamics, not proof of matching a real vehicle's instrumented performance.

The three new bodies now have dedicated longitudinal shoulder/width profiles. Carrera has a low bonnet, raised wings, narrow waist, rear haunches, inset wing lamps and fastback glasshouse. GR Yaris has a tall three-door cabin, dropped rear roof, steep hatch and spoiler. GTV has a separate boot deck, bonnet lip and slim painted pillars. Closed roofs are opaque sheet surfaces with inner lining and solid A/B/C supports; glazing is confined to the openings. Headlamp lenses and trim are projected onto their supporting panels. Crash deformation uses a smooth low-frequency displacement field shared by the body and attached trim.

## Paint, audio and police variants

`src/vehicle-paint.js` exposes `setPaint(model,color)` and the per-car palettes. The garage and studio store choices under `paraliaki.paint.<carId>` and apply them immediately to that model's body and cabin paint accents. Invalid stored values fall back to the catalogue colour. Colours are approximate screen swatches; they are not measured manufacturer paint samples. Matte finishes adjust clearcoat/roughness. Multiplayer paint replication is not implemented by this module.

Palette references: [MINI F57 launch finishes](https://www.press.bmwgroup.com/india/article/detail/T0368228EN/unlimited-open-air-excitement%3A-the-all-new-mini-convertible-launched-in-india?language=en), [BMW Z4 launch finishes](https://www.press.bmwgroup.com/india/article/detail/T0294284EN/unfold%3A-the-all-new-bmw-z4-roadster-launched-in-india), [Škoda Octavia 2020 colours](https://cdn.skoda-storyboard.com/2020/03/OCTAVIA_EN_Body_colours.pdf), [Porsche 2012 brochure](https://xr793.com/wp-content/uploads/2020/06/2012-Porsche-911.pdf), [Toyota 2024 press pack](https://media.toyota.co.uk/wp-content/uploads/sites/5/pdf/240621-GR-Yaris-Press-Pack-2.pdf), and the period Alfa Campionario Colori chart. Regional choices are combined. Taxi yellow is an additional fleet finish, and GR Yaris Matt Stealth Grey is explicitly labelled as the Ogier special-edition finish. Alfa shades are period references rather than a claim that all eight were offered in every model year and market.

The audio owner supplied synthesized flat6, turbo3 and na4 voices for the three additions. These do not have dedicated recorded startup banks. The original three retain their recorded banks and documented substitutes.

`police` and `police_moto` are explicit-spawn traffic types with `w:0`. The former uses a separate civil Octavia template with blue/white Hellenic Police livery; the latter is an original touring motorcycle with dark uniform, white helmet and panniers. `setStrobe(on,t)` changes two per-instance emissive materials in a left/right double-flash pattern without adding lights. Both retain damage, unique fictional registrations, independent wheel steering/spin transforms and parked support. The motorcycle is a visual approximation, not a licensed BMW mesh. Livery reference photographs: [Octavia patrol side markings](https://www.carandmotor.gr/nea/ta-peripolika-tis-ellinikis-astynomias-sto-olympo) and [police car/motorcycle pairing](https://www.skai.gr/news/greece/elas-oi-6-vasikoi-pylones-gia-tin-astynomia-tou-mellontos).

Original-three visual follow-up (review only, not part of this rework): MINI needs more upright compact wing/bonnet geometry and fuller arch transitions; Z4 needs a more sculpted long bonnet, stronger rear haunches and distinct side vent/door surfacing; Octavia needs wider solid C-pillars and a better defined liftback/roof shoulder. Their dimensions, animated wheels, interior and damage hooks remain in place.

## Complete road fleet (October 2026)

Every `TRAFFIC_TYPES` entry now routes through `traffic-fleet.js`; parked cars use the same model family. The former generic hatch/sedan/SUV/bus box meshes are no longer used for traffic. The fleet is independently authored procedural geometry, not downloaded manufacturer CAD. These are reference-based interpretations: body dimensions are sourced, while small body radii, cabin fittings and some trim are approximations.

| Traffic id | Model represented | Length × width, metres |
| --- | --- | --- |
| city | Toyota Aygo II | 3.455 × 1.615 |
| hatch | Volkswagen Golf VII | 4.255 × 1.799 |
| sedan | Toyota Corolla E210 sedan | 4.630 × 1.780 |
| suv | Nissan Qashqai J11 | 4.377 × 1.806 |
| taxi | Škoda Octavia IV liftback | 4.689 × 1.829 |
| taxi_superb | Škoda Superb III liftback | 4.861 × 1.864 |
| byd_dolphin | BYD Dolphin, European body | 4.290 × 1.770 |
| byd_atto3 | BYD Atto 3 | 4.455 × 1.875 |
| van | Fiat Ducato L2H2 | 5.413 × 2.050 |
| truck | Isuzu NPR with delivery box | 6.400 × 2.300 |
| bus | Mercedes-Benz Citaro O530, OSY livery | 12.000 × 2.550 |
| delivery | Honda SH150i with insulated food box | 2.030 × 0.740 |
| scooter | Piaggio Beverly 300 | 2.125 × 0.800 |
| moto | Yamaha Tracer 900 | 2.160 × 0.850 |
| police | Octavia patrol livery | 4.689 × 1.829 |
| police_moto | BMW R 1250 RT touring police interpretation | 2.222 × 0.990 |

Passenger specification references: [Aygo II](https://newsroom.toyota.eu/2019-2014-toyota-geneva-motor-show-new-aygo---specifications/), [Golf VII](https://www.volkswagen-newsroom.com/en/the-new-golf-das-auto-international-driving-presentation-2797/the-new-golf-overview-quick-facts-2854), [Corolla](https://media.toyota.co.uk/wp-content/uploads/sites/5/pdf/220111M-Corolla-Tech-Spec.pdf), [Qashqai](https://www.nissan-cdn.net/content/dam/Nissan/za/brochures/QASHQAI.pdf), [Octavia](https://cdn.skoda-storyboard.com/2019/12/Nova-Skoda_Octavia_technickeudaje.pdf), [Superb](https://cdn.skoda-storyboard.com/2016/05/150303-%C5%A0KODA-at-the-Geneva-Motor-Show-2015-Press-Kit_.pdf), [Dolphin](https://www.byd.com/content/dam/byd-site/eu/product/dolphin/BYD%20DOLPHIN%20EN%20V3.pdf), [Atto 3](https://www.byd.com/content/dam/byd-site/en-be/product/atto3/BYD%20ATTO%203.pdf).

Commercial references: [Citaro specifications](https://www.mercedes-benz-bus.com/int/en/models/citaro/facts-citaro.pdf), [actual OSY bus photograph](https://mesametaforas.gr/busgallery/displayimage.php?album=6153&pid=22739), [Ducato](https://www.fiatprofessional.com.sg/content/dam/cross-regional/asean/fiat/common/ducato/series7/Ducato-S7-BG-v2.pdf), [Isuzu N-series chassis](https://isuzucv.com/pdfs/2025N-SeriesGas_specs.pdf). The NPR cargo box is a plausible bodybuilder configuration; its overall box dimensions are an authored approximation, not an Isuzu factory body specification. The bus has a separate panoramic windscreen, saloon glazing, painted supports, three right-side doors, open wheel arches, mounted mirrors, visible seats/handrails, OSY blue/yellow markings and destination displays.

Two-wheel references: [Honda SH150i](https://hondanews.eu/eu/en/motorcycles/media/pressreleases/34935/sh150i-press-pack), [Beverly 300](https://wlassets.piaggio.com/wlassets/piaggio/master/tech_spec/Beverly/2021/EN_NewBeverly_300/original/EN_NewBeverly_300.pdf), [Tracer 900](https://cdn2.yamaha-motor.eu/prod/product-assets/2019/MT09TR/Factsheets/2019-MT09TR_bg-BG.pdf), [BMW RT](https://www.bmw-motorrad.ie/en/models/tour/r1250rt/technicaldata.html). Beverly height is estimated from photographs; police RT markings are a game adaptation rather than a claim of a particular Greek fleet purchase. Bike catalogue heights exclude the rider. Width conventions on motorcycle source sheets include handlebars/mirrors, unlike passenger-car body widths.

Fleet geometry is built once per model/detail variant and shared until impact. Each moving vehicle has independent paint, lamps, fictional registration, wheel steering/spin transforms and damage state. Near bodies preserve named bumpers, mirrors, doors and lenses for the separate damage system. Far shells remove cabin fittings and use fewer wheel segments; hysteresis switches near detail on below 55 m and off above 65 m. There are no additional real lights for strobes. Parked registrations share a texture atlas. Parked cars are grouped spatially into merged low-detail cells; detailed cells are created on approach and their geometry is released after leaving. Static parked collision/damage behaviour remains owned by the traffic collision system; batching does not introduce individual crash simulation for those static rows.

The studio lists every playable and traffic variant separately (the traffic taxi is `traffic:taxi`), with near/far/parked controls. `runTrafficFleetChecks()` covers all sixteen traffic types, material/geometry isolation, wheel hierarchy, damage restoration, dimensions and parked detail transitions. `tools/traffic-benchmark.html` constructs the full 74-vehicle pool plus 772 parked vehicles and measures completed WebGL frames with `gl.finish()`. This is a controlled traffic-rendering stress scene, not a claim about the complete world's frame rate on consumer hardware.

Validation artifacts are in `.scratch/traffic-models/`: three studio angles per type, two contact sheets, the interactive gallery, and an actual Riviera game capture. The on-road close-up deliberately arranges five existing traffic vehicles for inspection; `in-game-proof.json` identifies that fixture. The browser reported no page errors. Geometry checks also enforce 20,000 visible triangles near and 3,000 far, broken lamps remaining dark after LOD/light changes, and hidden crash internals staying out of parked batches.

The paired SwiftShader stress measurement (960 × 600, 74 moving-pool vehicles and 772 parked) changed median completed-frame time from 107.5 to 62.8 ms, draw calls from 3,999 to 1,931, triangles from 5,763,370 to 2,291,898, and textures from 1,104 to 88. These are software-renderer measurements on a shared VPS; absolute timings vary with other workloads. A separate twelve-switch test disposed/rebuilt/compiled all six player models twice, including six switches without intermediate draws, and rendered successfully without context loss. It does not reproduce the complete multiplayer/post-processing environment.

Suspension rendering now consumes each physics corner's `zu` displacement in FL/FR/RL/RR order. Wheel steering pivots retain a fixed rest height; root-mounted wheels use `restY + zu`. The body-mounted fallback removes the actual body's heave, pitch and roll contribution at that wheel. Steering, spin, fixed calipers, damage camber and wheel LOD children continue to use the same pivot hierarchy. Player and rival models share this animation path. Vehicle checks exercise independent travel, repeated updates, body-transform compensation and reset on all six cars.

Following the handling review, the Z4 ride frequency is 1.75 Hz, the taxi/GTV roll-gradient targets are 4.8 degrees/g, and the GR Yaris target is 2.8 degrees/g. The taxi understeer input is 3.5 degrees/g, matching the handling review's target (measured 3.57 degrees/g in the bench). These are simulation tuning targets rather than manufacturer-certified spring measurements. GTV rear grip stays at 1.06: lowering it to 1.03 changed the measured 0–100 from 8.38 to only 8.42 seconds while the handling owner's stability sweep found a worse full-lock balance. The remaining acceleration discrepancy is recorded rather than hidden by altering its sourced gearing or peak torque.

## Models v3: ten playable cars and seated mirrors

Four detailed traffic shells now also have player builds. They keep their exterior proportions, fascia, glazing, plates and (for the patrol car) police markings; the player build supplies the full cockpit, driver seat, animated player wheels/calipers, separate signals/reverse lamps, detachable panels and damage lattice. Factory paint menus contain six choices per addition. `CARS` remains the source of truth for selection, rivals, replay and the server/Worker catalogue generated by `tools/prepare-deploy.mjs`; multiplayer/replay tests explicitly cover the new identifiers.

| New id | Engine | Mass | Power / torque | Driven wheels / transmission | Wheelbase / dimensions (m) |
| --- | --- | --- | --- | --- | --- |
| golf | Golf VII 1.4 TSI ACT | 1270 kg | 103 kW / 250 Nm | FWD, 6MT, final 3.647 | 2.637 / 4.255 × 1.799 × 1.452 |
| corolla | Corolla E210 1.6 Valvematic | 1280 kg | 97 kW / 159 Nm | FWD, 6MT, final 4.214 | 2.700 / 4.630 × 1.780 × 1.435 |
| superb | Superb III 2.0 TSI | 1505 kg | 162 kW / 350 Nm | FWD, 6DSG; overall ratios encode split final drives | 2.841 / 4.861 × 1.864 × 1.468 |
| police_octavia | Octavia IV 1.5 TSI, police adaptation | 1408 kg | 110 kW / 250 Nm | FWD, 6MT, final 3.647 | 2.686 / 4.689 × 1.829 × 1.470 |

Manufacturer references are beside each entry in `src/cars.js`: [Volkswagen Golf powertrain](https://www.volkswagen-newsroom.com/en/the-new-golf-powertrain-structure-engines-and-gearboxes-2835), [Toyota Corolla saloon](https://media.toyota.co.uk/toyota-reveals-the-all-new-corolla-saloon/), [Škoda Superb technical data](https://www.skoda-storyboard.com/en/press-kits/skoda-superb-press-kit/technical-data/), and [Octavia technical data](https://cdn.skoda-storyboard.com/2019/12/Nova-Skoda_Octavia_technickeudaje.pdf). Kerb masses represent particular trims rather than every market. The patrol version adds an authored 70 kg equipment allowance and does not claim to reproduce a particular Hellenic Police engine procurement. Intermediate torque anchors, suspension, weight distribution and tyre coefficients are game calibration estimates, constrained by the sourced peaks and the physics review. Existing cars' physics parameters were not edited by this models pass.

`src/vehicle-mirrors.js` samples the nearest **actual body triangles**, in body-local metres, to seat each stalk root. Passenger mirrors join the door/A-pillar metal; Citaro, Ducato and NPR retain their larger housings; delivery/Beverly/Tracer/police RT stalks join the handlebars. MINI, Z4, Octavia taxi, Carrera, GR Yaris, GTV and all four additions use the same attachment mechanism. Carrera door mounts and GTV stalk positions clear their respective glazing seals from the driver eye. Every near, road-distance, far and parked build retains its own face/housing/stalk assembly. Low-LOD cloning must never reparent the original near reflective face.

Damage deforms the housing with the body lattice and rebuilds the stalk between the deformed metal and housing. Detached mirrors disappear with their damage part; repair restores the assembly. `runMirrorChecks()` measures cylinder cap vertices against support triangles and housing bounds, with a 0.005 m limit. Its 656 checks exercise all ten player cars and sixteen traffic families, multiple LODs, parked/detail variants, paint changes, damage and repair. A deliberately displaced stalk verifies the check can fail.

Cockpit mirrors are independent views, not crops of a shared camera. The interior face is 250 × 70 mm, with a physical frame/stem at the windscreen header. Door optics and their housings face the driver. Three rearward cameras sit at the actual glass positions: interior 384 × 108 with 28° horizontal FOV, sides 256 × 112 with 20° horizontal FOV. UVs reverse X. Views update every other frame on medium/high graphics, omit the player's own cabin, and include world cars. Low graphics allocates no mirror targets and skips reflection draws. Targets are disposed on car changes. The cockpit FOV fits the real mirror locations while retaining any wider user choice; this deliberately provides a wide forward view in narrow cabins. `runCockpitMirrorChecks()` samples nine sightlines per face and checks separate targets, camera origins, UV reversal, update cadence, low-quality behavior and render-state restoration.

The Z4 G29 rear surface now has a raised trailing boot edge, a shallow deck crown, tighter quarter-to-tail corners, slim L-shaped rear lamps and wraparound guides. The boot profile is retained in distant detail. Reference: [BMW G29 press kit](https://www.press.bmwgroup.com/global/article/attachment/T0284770EN/442424).

Review artifacts live in `.scratch/models-v3/`: `z4-rear-before.png` / `z4-rear-after.png`; `player-<id>-mirror-<side>-<level>.png` and `traffic-<id>-mirror-<side>-<level>.png`; four additions' `front`, `rear`, `interior` and real-game `chase` views; `mirrors-fp/<id>.png` for driver-eye reflection inspection. The on-road mirror fixture places real rival models behind the player on the loaded Riviera route, freezes physics for inspection, and renders the normal game/cockpit paths. Geometry, test and capture logs accompany the images. Screenshots are validation artifacts, not shipped textures.
