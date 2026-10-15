# Trim catalogue conventions

Garage `CAR_MODELS` groups a generation family; each `trims` member names an executable `CARS` physics spec and multiplayer wire ID. Retaining existing IDs is intentional. `migrateCarSelection` upgrades string IDs to `{entry,trim}` without losing an old engine selection. The compatibility `paraliaki.car` string remains authoritative; the garage also writes `paraliaki.car.selection`.

The available trim set is curated, not every engine sold worldwide. Round 2 combines F56/F57 under MINI with independent body/engine controls, and replaces the earlier CLA C178 with the requested C118. CLE C236 and GLA H247 remain distinct models. All existing wire IDs remain valid.

New CLE specifications use ICE rated kW/Nm (48 V transient assist is not added to continuous engine power), DIN mass excluding the 75 kg EU driver/luggage allowance. Existing CLE 300 stays at its sourced 1805 kg calibration; year/equipment change published weights. CLE 200 / 450 / AMG 53 use representative 1715 / 1870 / 1925 kg DIN masses. 9G gear ratios use the existing C236 set; AMG final drive is 3.07. These ratios, off-peak engine curves, grip and suspension are simulation approximations, not claimed factory telemetry.

Manufacturer sources:

- Mercedes C236 launch technical data (200, 300 and 450): https://media.mercedes-benz.pl/wyrzezbiony-przez-pozadanie---nowy-mercedes-benz-cle/
- Mercedes C236 technical sheet: https://nd-mediagallery2-public-production.s3.amazonaws.com/215df8a0a2f426ec8e82796a0eaca795/techdata_cle_c236_806_056.pdf
- AMG CLE 53 launch: https://media.mercedes-benz.com/article/32cdd73f-bd34-446c-ab21-3d8860b91b7b
- BMW E36 M3 history (European S50, 236 kW, six-speed): https://www.press.bmwgroup.com/belux/article/attachment/T0260495FR/360217
- Existing individual cars retain the citations next to their specs in `src/cars.js`.

Appearance uses representative factory/sport-package cues rather than promising every wheel or cosmetic item is standard in every market: wheel diameter/spokes, coloured fixed calipers, ride height, trim lettering, rear lip, AMG grille and quad round outlets. Body surfaces and cabin are shared. E36 M3 uses twin left outlets, M front splitter and rear diffuser. The CLE AMG skin approximates the wide-body car with the existing parameterised arches.

## Round 2 specification ledger

Power kW; torque Nm; representative DIN/road mass kg; time seconds. Every row identifies the simulated gearbox; all curves away from the rated anchors, final drives/ratios unless explicitly cited in round 1, axle splits, tyre grip, suspension and aero are approximations. DIN weights exclude a 75 kg driver allowance. Equipment/market/year alter mass. Huracán adds 120 kg to manufacturer dry weights for fluids/equipment. No battery/e-CVT model exists, so Corolla uses the real E210 1.5/1.6 manual petrol engines, not an invented hybrid gearbox.

| ID | Trim | kW | Nm | kg | Drive | Gears | 0–100 |
|---|---|---:|---:|---:|---|---:|---:|
| panda | PANDA 169 | 44 | 102 | 860 | fwd | 5 | 14 |
| panda_11 | 1.1 | 40 | 88 | 840 | fwd | 5 | 15 |
| panda_100hp | 100HP | 74 | 131 | 975 | fwd | 6 | 9.5 |
| yaris | YARIS XP10 | 50 | 90 | 850 | fwd | 5 | 13.6 |
| yaris_13 | 1.3 VVT-i | 63 | 124 | 900 | fwd | 5 | 12.1 |
| yaris_ts | 1.5 T SPORT | 78 | 145 | 950 | fwd | 5 | 9 |
| ibiza | IBIZA 6K | 44 | 107 | 935 | fwd | 5 | 15.7 |
| ibiza_cupra | 1.8 20VT CUPRA | 115 | 210 | 1119 | fwd | 5 | 7.9 |
| golf | GOLF TSI | 103 | 250 | 1270 | fwd | 6 | 8.4 |
| golf_gti | GTI | 162 | 350 | 1276 | fwd | 6 | 6.5 |
| golf_gtd | GTD | 135 | 380 | 1302 | fwd | 6 | 7.5 |
| golf_r | R 4MOTION | 221 | 380 | 1401 | awd | 6 | 4.9 |
| mini | MINI | 141 | 280 | 1320 | fwd | 6 | 7.2 |
| mini_cabrio_cooper | COOPER CABRIO | 100 | 220 | 1205 | fwd | 6 | 8.8 |
| mini_jcw | MINI JCW | 170 | 320 | 1205 | fwd | 6 | 6.3 |
| mini_cooper | COOPER | 100 | 220 | 1085 | fwd | 6 | 7.9 |
| mini_s | COOPER S | 141 | 280 | 1160 | fwd | 6 | 6.8 |
| corolla | COROLLA | 97 | 159 | 1280 | fwd | 6 | 9.7 |
| corolla_15 | 1.5 DYNAMIC FORCE | 92 | 153 | 1210 | fwd | 6 | 12.1 |
| taxi | OCTAVIA | 110 | 360 | 1460 | fwd | 7 | 8.6 |
| octavia_16tdi | 1.6 TDI TAXI | 81 | 250 | 1230 | fwd | 5 | 10.6 |
| octavia_rs | 2.0 TSI RS | 162 | 350 | 1350 | fwd | 6 | 6.8 |
| superb | SUPERB TSI | 162 | 350 | 1505 | fwd | 6 | 7 |
| superb_15 | 1.5 TSI | 110 | 250 | 1380 | fwd | 6 | 8.7 |
| superb_4x4 | 2.0 TSI 4x4 | 206 | 350 | 1540 | awd | 6 | 5.8 |
| cla | 200 | 120 | 250 | 1335 | fwd | 7 | 8.2 |
| cla250 | 250 4MATIC | 165 | 350 | 1430 | awd | 7 | 6.3 |
| cla35 | 35 4MATIC | 225 | 400 | 1495 | awd | 7 | 4.9 |
| cla45s | 45 S 4MATIC+ | 310 | 500 | 1600 | awd | 8 | 4 |
| gla | GLA 200 | 120 | 250 | 1485 | fwd | 7 | 8.7 |
| gla250 | 250 4MATIC | 165 | 350 | 1535 | awd | 8 | 6.7 |
| gla45 | GLA 45 S | 310 | 500 | 1765 | awd | 8 | 4.3 |
| z4 | Z4 M40i | 250 | 500 | 1610 | rwd | 8 | 4.5 |
| z4_20i | sDrive20i | 145 | 320 | 1405 | rwd | 8 | 6.6 |
| z4_30i | sDrive30i | 190 | 400 | 1415 | rwd | 8 | 5.4 |
| carrera | 911 CARRERA | 257 | 390 | 1380 | rwd | 7 | 4.8 |
| carrera_s | CARRERA S | 294 | 440 | 1395 | rwd | 7 | 4.5 |
| carrera_gts | CARRERA GTS | 316 | 440 | 1425 | rwd | 7 | 4.4 |
| huracan | HURACÁN EVO | 470 | 600 | 1542 | awd | 7 | 2.9 |
| huracan_rwd | EVO RWD | 449 | 560 | 1509 | rwd | 7 | 3.3 |
| gtv | 2000 GTV | 97 | 182 | 1040 | rwd | 5 | 8.9 |
| gtv1750 | 1750 GTV | 87 | 186 | 1038 | rwd | 5 | 9.5 |
| e36 | 325i E36 | 141 | 245 | 1330 | rwd | 5 | 8 |
| e36_318i | 318i | 85 | 168 | 1190 | rwd | 5 | 11.3 |
| e36_m3 | M3 E36 | 236 | 350 | 1460 | rwd | 6 | 5.5 |
| cle200 | CLE 200 | 150 | 320 | 1715 | rwd | 9 | 7.9 |
| cle | CLE 300 | 190 | 400 | 1805 | awd | 9 | 6.2 |
| cle450 | CLE 450 | 280 | 500 | 1870 | awd | 9 | 4.4 |
| cle53 | AMG CLE 53 | 330 | 560 | 1925 | awd | 9 | 4.2 |
| gr_yaris | GR YARIS | 206 | 390 | 1280 | awd | 6 | 5.5 |

## Round 2 sources and body policy

Round 2 supersedes the earlier body grouping: MINI is now one F56/F57 family entry with three engines and two bodies. `mini` is still the Cooper S Convertible wire ID; `mini_jcw` is still the JCW Hardtop. Selection records retain the executable `trim` ID and add `body` for this entry. F57 Cooper / Cooper S / JCW use 1205 / 1320 / 1310 kg representative road masses (the S preserves its prior calibration). The roof is permanently open on the F57 preset, closed on F56. Z4 is roadster only. The existing 911 model has no cabriolet cabin/roof preset, so this round does not advertise an unsupported 911 body option. Huracán offers EVO and EVO RWD; STO is omitted because its roof scoop, clamshell and large aero assembly need a distinct model.

Primary specification references, consulted 2026-10-15:

- Panda 169 1.1/1.2: [Fiat 2003 UK launch](https://www.media.stellantis.com/uk-en/fiat/press/new-fiat-panda-in-uk), and the 169 handbook linked above. [Panda 100HP launch](https://www.media.stellantis.com/uk-en/fiat/press/elle-of-a-panda): 74 kW, 131 Nm, six-speed manual, 9.5 s, 185 km/h. The model retains the shared 169 shell with sport wheels, lowered stance, spoiler and bumper extensions.
- Yaris XP10: [Toyota first-generation technical pack](https://media.toyota.co.uk/wp-content/uploads/sites/5/pdf/Gen1-Yaris-archive-press-pack.pdf) and [T Sport pack](https://media.toyota.co.uk/wp-content/uploads/sites/5/pdf/Gen1-Yaris-T-Sport-archive-press-pack.pdf). Early 1.3 is 63 kW/124 Nm; T Sport is 78 kW/145 Nm, 9.0 s. These remain XP10, not later XP90 engines. Body panels are shared five-door approximations across engines.
- Ibiza 6K/6K2: [SEAT historic Ibiza Cupra](https://seat.media-corner.ch/press/seat-ibiza-25-jahre-erfolgsgeschichte). The 1.8 20VT is the 156 PS facelift-era Cupra, not the later 6L Cupra. The 6K shell is shared; door count and facelift-specific lamp shapes are approximations, not a separate Cupra body claim. Original 1.4 CLX keeps the only aftermarket nitrous bottle.
- Golf VII: [GTI history](https://www.volkswagen-newsroom.com/en/the-new-golf-gti-international-media-drive-6282/golf-gti-history-6287), [GTD launch technical data](https://www.volkswagen-newsroom.com/en/the-new-golf-gtd-international-press-presentation-2807), [R launch](https://www.volkswagen-newsroom.com/en/the-new-golf-r-2432). Launch GTI 220 PS manual, GTD 184 PS manual, R 300 PS DSG/4MOTION. R's 4.9 s is DSG; manual versions have a different time. Wheel designs, grille stripe, spoiler and diffuser are representative sport-package cues.
- MINI: [F56 launch](https://www.press.bmwgroup.com/portugal/article/attachment/T0164863PT/246787), [F56 JCW specifications](https://www.press.bmwgroup.com/global/article/detail/T0210262EN/specifications-of-the-mini-john-cooper-works-valid-from-march-2015), [F57 launch](https://www.press.bmwgroup.com/united-kingdom/article/detail/T0240023EN_GB/the-new-mini-convertible), [F57 technical sheet](https://www.press.bmwgroup.com/canada/article/attachment/T0261914EN/377464). Six-speed manuals, including 6.6 s JCW Convertible; these are not the later seven-speed automatic variants.
- Corolla E210 saloon: [Toyota 1.6 launch](https://media.toyota.co.uk/toyota-reveals-the-all-new-corolla-saloon/), [Toyota regional 1.5 brochure](https://toyota.com.mk/content/modelspdfs/615-corolla-sedan-mk-2.pdf?t=1616622510), [Toyota MY24 1.5 technical sheet](https://pdf.sites.toyota.sk/cennik_corolla_sedan_active_comfort.pdf). 92 kW/153 Nm three-cylinder M15A-FKS, six-speed manual, 12.1 s. Model covers the generation's different model years.
- Octavia III 5E: [2015 RS specifications](https://www.skoda-storyboard.com/en/press-releases/skoda-octavia-rs-now-wheel-drive-six-speed-dsg-2/). RS is the pre-facelift 220 PS six-speed petrol manual (not the 2017 230 PS or IV's 245 PS). The existing 4.689 m taxi shell and wheelbase are III, so the garage label is corrected from IV. 1.6 TDI is the 110 PS five-speed taxi; the old 2.0 TDI DSG taxi stays available. Taxi lighting/livery remains on diesel taxi variants; RS has neither roof sign nor taxi paint.
- Superb III: [manufacturer petrol technical table](https://cdn.skoda-storyboard.com/2016/05/TD-SUPERB-en-1.pdf). 1.5 TSI 150 PS manual and 2.0 TSI 280 PS 4x4 DSG, alongside the old 220 PS DSG. 1.5 appeared later within this generation.
- CLA C118: [2019 launch engine table](https://media.mercedes-benz.pl/dostawy-mercedesa-cla-coupe-rozpoczna-sie-w-maju-2019-roku/), [C118 press kit](https://media.mercedes-benz.com/press-kit/99b405e9-7909-40e2-9f51-7dd2e062800c), [AMG 45 S launch](https://media.mercedes-benz.com/article/1ac09d7e-dc4a-452a-8a16-8e14f370582a). CLA 200 seven-speed DCT 8.2 s; 250 4MATIC seven-speed DCT; 35 seven-speed DCT; 45 S eight-speed DCT. The `cla` ID now represents the requested 2019 C118 200 rather than the prior 2025 hybrid. Dimensions and LED signatures are corrected; panel contours are shared procedural approximations. AMG 35 uses two outlets; 45 S uses four and the vertical grille. No electric boost is counted.
- GLA H247: existing 200 and 45 S sources remain; the added 250 is the 225 PS/350 Nm eight-speed DCT 4MATIC, 6.7 s. [Mercedes GLA launch](https://media.mercedes-benz.nl/de-nieuwe-mercedes-benz-gla---meer-karakter-meer-ruimte-meer-veiligheid/).
- Z4 G29: [BMW 2018 launch](https://www.press.bmwgroup.com/global/article/detail/T0284770EN/the-new-bmw-z4?language=en). European 197/258/340 PS, eight-speed automatic; 20i/30i are four-cylinder, M40i six-cylinder. Base masses 1405/1415 kg are DIN (EU figures minus 75 kg), while the existing M40i keeps its 1610 kg calibration.
- 911 991.1: [Porsche 2014 GTS launch](https://newsroom.porsche.com/en/products/the-new-porsche-911-carrera-gts-models-10756.html). Naturally aspirated Carrera / S / GTS, seven-speed manual throughout: 4.8 / 4.5 / 4.4 s, not the PDK Sport Chrono 4.0 s. GTS wider rear body is represented by physics width, wheels and trim parts; the procedural shell retains the common Carrera surface.
- Huracán: [EVO RWD manufacturer specification](https://www.lamborghini.com/en-en/history/huracan-evo-rwd), [RWD design/output description](https://www.lamborghini.com/en-en/news/huracan-evo-rwd-new-features). 449 kW/560 Nm RWD versus 470 kW/600 Nm AWD; same seven-speed LDF family. Dry mass plus 120 kg road equipment convention as above.
- Alfa 105: [Alfa Romeo historical collection](https://www.museoalfaromeo.com/en-us/collezione/Pages/Collezione.aspx). 1750 118 PS/186 Nm and 2000 132 PS/182 Nm use period European quoted outputs, with representative road masses and period 0–100 estimates. Historical gross/net measurement conventions vary; do not compare those figures as modern homologation results. Five-speed manual/RWD, shared Bertone shell.
- E36: [BMW Classic 318i](https://www.bmwgroup-classic.com/en/history/historic-modeloverview-bmw.html), plus existing 325i/M3 sources. 318i represents the M43 115 PS/168 Nm sedan, five-speed manual/RWD; equipment-dependent mass is representative.

All added gearboxes have the real gear count/type and driven axle arrangement; exact gear and final-drive values not individually provided by these sources are effective family-level estimates. New trim torque curves are interpolated from rated Nm and kW anchors, not measured dyno traces. Cosmetic sport packages do not imply that every wheel, caliper colour or spoiler was standard in all markets. Bodykit extensions use the existing parameterised geometry; they do not reproduce bespoke wide-body panels.

Additional body row: `mini_cabrio_jcw` — JCW Convertible, 170 kW / 320 Nm, 1310 kg, FWD, six-speed manual, 6.6 s. All six MINI variants carry `bodyStyle` and `trimLabel` metadata; catalogue bodies map those to the original or new executable IDs.

Visual QA follow-up: F56 Cooper removes JCW intake/bonnet stripes, hood scoop, red grille bar and roof spoiler; Cooper S keeps its scoop/spoiler, while JCW retains the full cues. M3 keeps its paired left exhaust. MINI body and trim controls sit side by side using scoped spacing on the shared segmented component.

## CLE hybrid update and live trim browser

C236 really offers **CLE 300 e EQ Hybrid**, introduced in 2024. This is the rear-wheel-drive plug-in coupé, not the E 300 e saloon or an invented electrified AMG. Factory system output is **230 kW / 550 Nm**, from a 150 kW / 320 Nm M254 petrol engine and a 95 kW / 440 Nm electric motor; the component maxima must not simply be summed. It uses 9G-TRONIC, reaches 100 km/h in **6.3 s**, and is rated at 236 km/h. The 2175 kg EU mass includes a 75 kg allowance; the new executable `cle300e` uses **2100 kg DIN** consistently with the other new CLE variants. Its battery specification is **19.53 kWh**, with electric driving up to 140 km/h. Body/wheels/badge distinguish it from CLE 200; the common C236 shell remains shared.

Sources (manufacturer documents):

- Mercedes-Benz 23 October 2024 CLE 300 e press event: https://media.mercedes-benz.com/press-kit/f85fb260-67fb-4e4e-87a7-48899af1f817
- Mercedes-Benz CLE price/specification table, including the ICE/electric/system columns and 6.3 s: https://retail.mercedes-benz.hr/files/cjenici/Mercedes_cjenik_CLE.pdf
- Mercedes-Benz September 2024 UK brochure, technical-data and weight footnotes: https://6656052.fs1.hubspotusercontent-na1.net/hubfs/6656052/2024%20Brochures/CLE%20Coupe%20%26%20Cab%20Sept%202024.pdf
- Mercedes-Benz German price list (19.53 kWh battery): https://www.kunzmann.de/tiny/Marken/Mercedes_Benz/CLE/Mercedes-Benz-Preisliste-CLE-Coupe-C236.pdf
- Mercedes-Benz launch confirmation that the original CLE engines are all 48V mild hybrids: https://media.mercedes-benz.com/press-kit/00b85fd6-987c-455f-970a-1f06c891a79e/article/cf98d759-fce5-4cbb-8854-29331cb50a54
- AMG CLE 53 integrated starter-generator specification, 17 kW / 205 Nm transient: https://media.mercedes-benz.be/de/das-mercedes-amg-cle-coupe-neuer-einstieg-in-das-performance-coupe-segment/

**Simulation boundary:** physics currently consumes one crankshaft torque curve and one rated power, without a separate electric motor, battery state, regeneration or boost-duration channel. `cle300e` therefore uses an explicitly labelled charged blended curve, with low-rpm electric fill and the real combined rating; setting its turbo time multiplier to zero avoids making the electric contribution wait for ICE spool. It does not simulate depletion, pure EV driving or a selectable electric boost button. The existing CLE 200/300/450/53 get `hybrid.type:'mhev'` metadata and clear 48V trim descriptions. Their 17 kW / 205 Nm ISG values are recorded as **transient motor maxima**, not added to the continuous engine power/torque: the factory does not publish a simple combined system rating for those mild hybrids. Existing continuous torque anchors stay intact. Further dynamic electric assistance belongs in the powertrain agent's model, not an improvised nitrous mechanism.

Trim UX now has previous/next arrows, a trim name with power/0–100/driven wheels and position pips above the live car. MINI's Body segment sits beside the name. A/D, controller LB/RB and horizontal touch swipe share the same body-specific, host/event-filtered sequence. Model changes preserve the canvas, environment and turntable angle; the stats and heading morph in place. Mouse dragging still rotates freely. Controls use shared buttons/segments with scoped flat styling, no glow, bounce or native select. The generation catalogue remains separate; no grid of trim choices is introduced.

## Round 2 follow-up: Honda Jazz GK (European 2015–2020)

City entry, five-door hardtop only: **1.3 i-VTEC 6MT**, **1.5 i-VTEC Dynamic 6MT**, and **Drift Spec · Fantasy**. Honda's [2018 European press kit](https://hondanews.eu/eu/en/cars/media/pressreleases/125013/2018-jazz-dynamic-15-litre-i-vtec) supplies 75 kW/123 Nm at 6000/5000 rpm and 96 kW/155 Nm at 6600/4600 rpm, plus the distinct six-speed ratios and common 4.625 final drive. The [2018 Slovak Honda brochure](https://www.fr.honda.be/content/dam/local/slovakia/cars/katalogy/SK_Jazz_katalog_2018.pdf) supplies 11.2–11.5 s / 8.7 s to 100, 190 km/h, dimensions, tyres and EU mass ranges. We use 1070 / 1101 kg DIN (minimum EU 1145 / 1176 kg minus 75 kg driver). The 2015–2020 generation spans the facelift; Dynamic uses its later engine and fascia treatment on the shared GK shell. CVTs were real options; neither is represented as a fictitious fixed-ratio automatic because this simulator currently has no continuously variable transmission.

The original procedural shell uses the GK's short bonnet, long windscreen, tall cabin, five-door creases, chrome grille wing and vertical tail lamps. Dynamic gains 16-inch wheels, bumper extensions and a roof lip. Chassis tuning, inertias, rev-rise rates, intermediate torque-curve samples and shift times are simulator approximations; the real output anchors and ratios are retained in literal trim data and the new powertrain schema. No engine or gearbox implementation was changed.

**Jazz Drift Spec is expressly a fantasy build, not a Honda factory trim.** Its 149 kW (200 hp), 240 Nm turbo four, 1120 kg mass, six-speed RWD conversion, fully locked differential, wide 215-section wheels, lowered suspension, large supported rear wing and loud single outlet are gameplay estimates. Powertrain uses a light .16 kg·m² flywheel, 7000 rpm redline, .30 s manual shift, .30 s spool and a 3000–5500 rpm torque plateau. Its sporty turbo-four audio uses the existing performance exhaust profile. It is not selected for ambient traffic. The build remains an ordinary catalogue wire ID, so allowed-car filtering and server discovery need no special exception.

Jazz drift validation: the checked-in deterministic driver enters at 70 km/h with a 0.35 s handbrake pull and then uses constant 70% throttle plus sideslip/yaw countersteering. With the catalogue's default TC/ESC settings, it sustains 17–34° sideslip for 7.85 s, above 57 km/h, without modifying vehicle state after entry. Normal aided power rotation peaks at 9.3°, with no drift latch. The same build also passes power-over, lift-feint and opposite-direction transition checks in the wider drift bench. The regression uses fixed controller constants, rather than searching for passing inputs each run.
