# Every authored vehicle is playable

The garage now contains 30 generation entries / 69 selectable configurations. All passenger, commercial and bike bodies in the fleet registries are represented, plus the existing detailed player and police bodies. The Corolla, Golf, Octavia taxi and Superb taxi already had player entries; their native fleet identity stays covered by those entries. Native bodies are reused, not copied into replacement geometry. AI grids exclude utility/public-service/electric fleet additions and fantasy builds. Multiplayer and saves continue using the single `CARS` ID catalogue.

## New garage choices

Power is metric kW (multiply by 1.35962 for PS). Dimensions are length × width × height in metres; wheelbase and estimated centre-of-mass height are metres. Masses for commercial vehicles and bikes are representative operating masses, as described below. Police Octavia is an existing configuration newly exposed in the garage.

| Vehicle / trim | kW / Nm | kg | Drive / gearbox | Dimensions | WB / CoM |
|---|---:|---:|---|---|---|
| Toyota Aygo II 1.0 VVT-i | 51 / 95 | 855 | FWD / 5MT | 3.455 × 1.615 × 1.460 | 2.340 / .52 |
| Nissan Qashqai J11 1.2 DIG-T | 85 / 190 | 1318 | FWD / 6MT | 4.377 × 1.806 × 1.590 | 2.646 / .60 |
| Nissan Qashqai J11 1.5 dCi | 81 / 260 | 1385 | FWD / 6MT | same | 2.646 / .60 |
| BYD Dolphin Comfort | 150 / 310 | 1658 | FWD / single speed | 4.290 × 1.770 × 1.570 | 2.700 / .48 |
| BYD Atto 3 Design | 150 / 310 | 1750 | FWD / single speed | 4.455 × 1.875 × 1.615 | 2.720 / .48 |
| Fiat Ducato X290 L2H2 2.3 Multijet 130 | 96 / 320 | 2075 | FWD / 6MT | 5.413 × 2.050 × 2.524 | 3.450 / .82 |
| Fiat Ducato X290 L2H2 2.3 Multijet 150 | 110 / 350 | 2075 | FWD / 6MT | same | 3.450 / .82 |
| Isuzu NPR 75-190 box truck | 140 / 510 | 4200 | RWD / 6MT | 6.400 × 2.300 × 3.100 | 3.815 / 1.02 |
| Mercedes-Benz Citaro O530 OSY | 220 / 1250 | 12000 | RWD / 4AT | 12.000 × 2.550 × 3.100 | 5.845 / 1.12 |
| Honda SH150i delivery scooter | 11 / 13.9 | 220 | RWD / CVT approximation | 2.030 × .740 × 1.150 | 1.340 / .64 |
| Piaggio Beverly 300 HPE | 19 / 26 | 260 | RWD / CVT approximation | 2.125 × .800 × 1.260 | 1.540 / .64 |
| Yamaha Tracer 900 | 84.6 / 87.5 | 285 | RWD / 6MT | 2.160 × .850 × 1.375 | 1.500 / .64 |
| BMW R 1250 RT police adaptation | 100 / 143 | 354 | RWD / 6MT | 2.222 × .990 × 1.460 | 1.485 / .64 |
| Škoda Octavia III 1.5 TSI police | 110 / 250 | 1408 | FWD / 6MT | 4.689 × 1.829 (existing body) | 2.686 / .54 |

## Sources and approximations

- [Toyota Aygo 2014 specifications](https://newsroom.toyota.eu/2019-2014-toyota-geneva-motor-show-new-aygo---specifications/) and [manufacturer launch pack](https://newsroom.toyota.eu/download/251986/toyota-geneva-2014-ms-en.pdf): 51 kW, 95 Nm, 855 kg, 14.2 s, five-speed manual and dimensions.
- [Nissan J11 technical brochure](https://www.nissan-cdn.net/content/dam/Nissan/slovenia/Ceniki_tehnicniFEB2017/QASHQAI_maj.pdf): 1.2 DIG-T / 1.5 dCi engine, transmission ratios, mass and dimensions. Trim/equipment changes affect kerb mass; selected values are representative manual FWD versions.
- [BYD Atto 3 specifications](https://www.byd.com/material/byd-site/zm/product/atto3/atto3pdf/BYD%20ATTO%203%20Vehicle%20Specifications.pdf), [BYD Dolphin](https://prod.byd.com/uk/electric-cars/dolphin): 150 kW / 310 Nm, 160 km/h, Comfort/Design 60.4 kWh variants. Manufacturer 0–100 anchors remain 7.0/7.3 s; current simulation yields 8.73/9.25 s. The existing combustion clutch controller cannot reproduce inverter launch control. Effective reduction ratios (7.4/7.8) and 10,000 rpm ceiling calibrate this approximation; these are **not verified BYD hardware ratios**. No battery depletion, regenerative braking or genuine motor controller is simulated. Power, torque, mass and single-speed equipment remain real.
- [Fiat Professional 2014 launch](https://www.media.stellantis.com/uk-en/fiat-professional/press/the-new-fiat-ducato-more-technology-more-efficiency-more-value), [2014 technical/price list](https://www.media.stellantis.com/uploads/uk/UK/2014/FIAT_PROF/PRICES/Fiat_Professional_NEW%20DUCATO%202014_Price_List_APR_2014.pdf): 130/150 Multijet outputs, six-speed gearbox, L2H2 dimensions. 2075 kg is representative fitted/lightly laden operating mass, not a universal brochure kerb mass. Estimated 0–100 values 17.5/15.5 s; regress measures 15.6/14.17 s.
- [Isuzu NPR 75-190 manufacturer sheet](https://www.isuzu.com.au/Media/Isuzu_Files/Spec_Sheets/Current_spec_sheets/NPR%2075-190%20CREW_ARK1350_v02.pdf): 4HK1 140 kW, 510 Nm and six-speed ratios. Authored short box geometry and 4200 kg chassis/body/light-load operating mass are estimates; this is not the crew-cab body in that reference. 110 km/h is the game governor.
- [LANUV technical report, engine/transmission reference](https://www.lanuv.nrw.de/fileadmin/lanuvpubl/3_fachberichte/30019.pdf): OM457 hLA 220 kW / 1250 Nm and Voith DIWA 4-speed 4.9 launch / 1.36 / 1 / .73, final drive 5.771. Report vehicle is articulated; only its shared powertrain family is used. The authored **solo** O530 is 12 m / WB 5.845 m, approximately 12 t in service. [Citaro technical information](https://wikibus.blob.core.windows.net/sources5861/The%20Citaro%20-%20technical%20information.pdf). Game governor 85 km/h; 0–100 is unavailable because it cannot reach 100. No pneumatic brake delay or passenger load changes are simulated.
- [Honda SH150i 2017](https://hondanews.eu/eu/lt/motorcycles/media/pressreleases/83467/2017-honda-sh150i): 11 kW, 13.9 Nm, 137.3 kg wet; game adds 75 kg rider and approximately 8 kg delivery box/load.
- [Piaggio Beverly 300 HPE](https://wlassets.piaggio.com/wlassets/piaggio/master/tech_spec/Beverly/2021/EN_NewBeverly_300/original/EN_NewBeverly_300.pdf): 19 kW / 26 Nm; 185 kg wet plus 75 kg rider.
- [Yamaha Tracer 900 2019](https://cdn2.yamaha-motor.eu/prod/product-assets/2019/MT09TR/Factsheets/2019-MT09TR_bg-BG.pdf): 84.6 kW, 87.5 Nm, 210 kg wet plus 75 kg rider. Effective final ratio includes primary reduction and chain drive.
- [BMW R1250RT technical data](https://www.bmw-motorrad.ie/en/models/tour/r1250rt/technicaldata.html): 100 kW / 143 Nm, 279 kg wet plus 75 kg rider. Existing Greek police paint is a game adaptation, not a claim about actual ΔΙΑΣ procurement.

All CoM heights, drag areas, spring/damper frequencies and brake/grip calibration are engineering estimates; manufacturers do not provide these for this use. Bus/van/truck gentle-corner checks assert every tyre remains loaded, small roll and small sideslip. No physics engine or transmission algorithm was changed. Each added profile has class-appropriate idle, rev limit, inertia, shift timing and torque curve.

Bikes are feasible as **assisted** vehicles using four virtual contact patches with a narrow support footprint; the visual has two wheels, a seated native rider and speed/yaw-based lean. There is no balance/fall simulation. Scooter CVTs use six virtual automatic ratios; they are labelled approximations, not literal six-speed scooters. Bike steering and power are tuned to remain playable under those constraints.

Native fleet cabins supply actual seats and dashboards. A live speed/gear instrument is added at the driver's station, and the camera sits at a measured sensible eye position. Bike view is rider-eye. Native mirrors retain geometry but have no dynamic render-to-texture view. Chase distance and target height scale with body length/height; the bus uses a 12.2 m following distance. Garage framing uses the same body dimensions.

## Verification and evidence

`tools/car-catalog.test.mjs` covers all fleet registry identities, garage inclusion, AI exclusions, finite geometry, wheel counts and cockpit rigs. `tools/physics-test/fleet.mjs` uses production Vehicle for every new fleet trim, braking and speed checks; bus, both vans and truck additionally exercise a gentle turn and tyre loading. `regress.mjs` includes those checks. `tools/play-every-model-browser.mjs` captures the actual garage and bus on Riviera via `tools/browser-slot.sh`. Evidence and clean-archive gate logs are in `.scratch/play-every-model/`.

SVJ follow-up: 31 generation entries, adding the independently authored
Aventador SVJ LP770-4 rather than a Huracán paint variant. The SVJ remains a
normal catalogue/wire ID and is eligible for the Super garage and AI grids.
