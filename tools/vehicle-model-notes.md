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
