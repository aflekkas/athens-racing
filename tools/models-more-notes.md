# Additional selectable Greek-road cars

All geometry is original procedural work in `src/player-road-cars.js`; photographs are reference-only, stored with their URLs in `.scratch/models-more/refs/sources.json`. No reference photograph is used as a game texture. Power is in kW in the catalogue (PS/CV in the display names); torque is Nm, dimensions metres, mass kg. Full torque curves, static axle loads, tyre friction, ride/damping frequencies and shift timing are simulation estimates unless stated otherwise.

## MINI John Cooper Works F56 (`mini_jcw`)

2015 European six-speed manual hatchback, **170 kW / 231 PS, 320 Nm**, 1205 kg DIN, FWD, 246 km/h. Dimensions 3.874 × 1.727 × 1.414 m, wheelbase 2.495 m, 205/45 R17 tyres. BMW's [March 2015 specification sheet](https://www.press.bmwgroup.com/global/article/attachment/T0210262EN/303092) supplies the dimensions, mass, output, 3.824 final drive, all six manual ratios, tyres and 0.71 m² CdA. [Launch press kit](https://www.press.bmwgroup.com/global/article/detail/T0197651EN/the-new-mini-john-cooper-works?language=en) and [interior press image](https://www.press.bmwgroup.com/global/photo/detail/P90182009/mini-john-cooper-works-05/2015?language=en) support the closed roof, round light modules, bigger brake intakes, centre exhaust, spoiler, round centre console and toggles. [F56 JCW reference photograph](https://commons.wikimedia.org/wiki/File:Mini_F56_JCW_IMG_0927.jpg).

The model uses the existing four-corner steering/spin/suspension hierarchy, player cabin and driver integration, seated live mirror cameras, independent lamp materials, Greek plates, per-instance paint, deformable/detachable damage parts and near/medium/far LODs. `playerDetail:true` opts additional catalogue vehicles into this pipeline. Both multiplayer backends derive their accepted IDs from CARS: the server reads the source, the Worker consumes `tools/prepare-deploy.mjs`'s generated `.deploy/catalogue.json`.

## Lamborghini Huracán EVO AWD (`huracan`)

2019 EVO AWD coupe, **470 kW / 640 CV at 8000 rpm, 600 Nm at 6500**, seven-speed LDF, rated >325 km/h and 2.9 s to 100. Dimensions 4.520 × 1.933 × 1.165 m, wheelbase 2.620 m. [Lamborghini model specification and design description](https://www.lamborghini.com/en-en/history/huracan-evo) supports the power, performance, AWD, seven-speed DCT, Y-shaped intakes and high-mounted exhausts. Manufacturer dry mass is 1422 kg; **1542 kg in the game is an estimated road-ready mass**, not a factory kerb-weight claim. The gearbox uses estimated effective overall ratios for the Huracán family (split final-drive layout), not independently verified EVO homologation ratios. The 70% rear torque share is a simplified default; there is no full LDVI or rear-steering simulation. Tyres: 245/30 ZR20 front, 305/30 ZR20 rear. Static 43:57 distribution and 0.68 m² CdA are model estimates.

Dedicated low two-seat cabin, portrait console screen, central digital tachometer, side intakes, deck louvres, rear diffuser and raised exhausts distinguish it from the conventional hatchback meshes. The acceleration regression now uses a tolerance around a declared manufacturer 0–100 figure when supplied, retaining the old 3–14 s envelope for existing entries; this accommodates both a 2.9-second supercar and genuinely slow economy cars.

## SEAT Ibiza 6K 1.4 (`ibiza`)

Early five-door 1.4i CLX, **44 kW / 60 PS, 107 Nm**, FWD, five-speed manual, 935 kg representative road mass, 157 km/h. The [1994 SEAT Netherlands brochure, p. 8](https://automobilisto.de/nl/archive/seat/ibiza/1994-nl.pdf) supplies 3.813 × 1.640 × 1.414 m dimensions, 2.440 m wheelbase, 157 km/h and 15.7 s to 100 for the 1.4i. Gear ratios, CdA and the full torque curve are approximations. The [SEAT heritage archive](https://www.seatcocheshistoricos.es/SEATHistoricos/en/1990/ibizacopa.php) documents the 6K generation.

Split grille, upright rectangular lamps, black bumper strips, steel wheels, rear drums, period radio, faded paint finishes and small sill rust patches. This is the **only catalogue entry with `nitrous:true`**; the bottle and valve sit behind the seats. Worn colours reduce clearcoat and increase paint roughness. Standard safety aids are gameplay options, not claims that the original car had ESC.

## Fiat Panda 169 1.2 (`panda`)

2003–2009 five-door **44 kW / 60 PS, 102 Nm**, 860 kg, FWD, five-speed manual, 155 km/h. Dimensions 3.538 × 1.578 × 1.540 m, wheelbase 2.299 m, 155/80 R13 tyres. Primary references: [Fiat owner's handbook, technical specifications](https://aftersales.fiat.com/eLumData/EN/00/169_PANDA/00_169_PANDA_603.81.224_EN_01_07.07_L_LG/00_169_PANDA_603.81.224_EN_01_07.07_L_LG.pdf) and [2003 manufacturer launch](https://www.media.stellantis.com/it-it/fiat/press/nuova-panda). The launch engine is the 60 PS FIRE, not the later 69 PS revision. Five-speed ratios and drag area are simulation approximations.

Tall short body, upright cabin, roof rails, black rub strips, square lamps and tall rear-pillar lamps; pressed wheels and rear drums.

## Toyota Yaris XP10 1.0 (`yaris`)

1999–2002 five-door **50 kW / 68 PS, 90 Nm**, 850 kg representative base mass, FWD, five-speed manual, 155 km/h. Dimensions 3.615 × 1.660 × 1.500 m, wheelbase 2.370 m. Primary references: [Toyota first-generation press archive](https://media.toyota.co.uk/vehicles/yaris-archive-1999/), [1999 launch](https://media.toyota.co.uk/the-new-toyota-yaris/) and [complete first-generation press pack](https://media.toyota.co.uk/wp-content/uploads/sites/5/pdf/Gen1-Yaris-archive-press-pack.pdf). Engine is the original 1SZ-FE; the manual ratios/final drive model that five-speed family. Trim, market and five-door equipment affect actual kerb weight.

Compact rising bonnet, tapered swept lamps, upright hatch and centrally mounted digital speed display. The cockpit keeps the forward view over an empty driver's dash instead of a conventional instrument binnacle.

## BMW E36 325i sedan (`e36`)

Representative 1993 M50TU five-speed sedan, **141 kW / 192 PS, 245 Nm**, 1330 kg, **RWD**, 233 km/h. Dimensions 4.433 × 1.698 × 1.393 m, wheelbase 2.700 m. [BMW Classic's 325i entry](https://www.bmwgroup-classic.com/de/modelle/bmw-klassiker/product-description-page.ad-464-7.bmw-325i-e36.html) confirms the 2494 cc six, output at 5900 rpm and 233 km/h. The road mass, dimensions and gearbox represent common European manual specifications; tyre friction, 25% limited-slip preload, CdA and suspension/aids are simulation choices. The limited-slip differential is an optional/modified-car setup, not standard-equipment attribution.

Long bonnet, short front overhang, four-door three-box body, twin kidneys, four round lamp modules behind rectangular covers, amber corners and period radio. It fills the cheap rear-drive slot and sustains power-oversteer with TC/ESC disabled.

## Catalogue calibration and verification

The 155/80 R13 tyres on the Ibiza, Panda and Yaris use an estimated 170 N/mm vertical stiffness instead of the shared 240 N/mm default. This retains their soft 1.55 Hz suspension and reduces smooth-road load swing to 8.5%, 9.2% and 9.5% respectively. The Huracán road setup uses an estimated 1.9 Hz ride frequency and 0.80 default traction-control strength: the measured roll gradient is 1.59 deg/g against the effective setup's 1.87, and the existing sand reverse-out scenarios pass. These are simulation calibration values, not claimed factory measurements. Power, mass, gearing and the test thresholds are unchanged by this calibration.

The cockpit seats and Huracán mirror stalk positions were checked using the actual driver-eye rays. All six cars pass the natural FOV, open header/horizon and three-mirror visibility tests. MINI bonnet shoulders retain the headlamp shape while its lower centre clears the forward road view. Bumper trim is split at the existing damage boundary so its upper strip stays attached; subdivided number plates follow the rounded fascia without being buried in it.

Reference comparisons and five views per car are in `.scratch/models-more/{id}-comparison.jpg` and `{id}-{front,rear,side,interior,chase}.png`. The chase captures use the running Megara game and its normal snapped chase camera. References with source URLs are in `refs/sources.json`; rejected wrong-generation photographs are marked unused.

Final validation logs in that directory: `npm-test-final.log` (105 passing), `tools-tests-final.log` (118 passing, run with the physics-test loader), `suspension-final.log` (215 passing), `sand-final.log` (all scenarios), `regress-final.log` (108 passing), `drift-all.log` (all 20 cars), and `driver-feel[-power]-final.log`. `final-qa.json` records 200 vehicle checks, 18 new-player budget checks, 144 mirror attachment checks, 210 cockpit optical checks, 140 garage-paint checks, 228 new-player damage/detail checks and 123 traffic checks for the six additions plus Golf. `traction-final.json` compares identical Huracán setups: AWD has zero driven-wheel overspeed in the corner exit, versus measurable spin with FWD/RWD; RWD is faster in that particular exit, so this is a traction comparison rather than a lap-time claim.

Car commits: MINI `0508dd4`, Huracán `a3f3089`, Ibiza `838a2a2`, Panda `91fcee0`, Yaris `b62a409`, E36 `fdd0278`. The MINI's initial catalogue/common-pipeline integration was captured by concurrent shared-index commit `2aa7581`; that history was preserved. Distinct V10/straight-six synthesis is `7305d87`; suspension/sand calibration is `2ccdae2`. No push or deployment was performed.


