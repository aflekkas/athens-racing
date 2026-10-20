# Powertrain rules and sound contract — 2026-10-15

All 56 catalogue entries carry a literal `powertrain` object in `src/cars.js`. `idle`, `redline`, `shiftT` and `gearbox` agree with it. Server capability scans and deployment tools may continue parsing the literal CARS array; no browser-only enrichment changes catalogue membership or equipment. `Vehicle.setSpec` calls the same pure resolver for live cars and headless benches. The scalar parameters are explicit; future missing entries fail both npm test and regress.

## Evidence and parameter provenance

Power, peak torque, factory ratios, mass, 0–100 and top speed remain the trims agent's catalogue anchors. The references below ground the engine families and representative equipment. Idle RPM, effective inertia, free-rev governors, spool constants, engine-braking coefficients and exact shift durations are **simulation estimates**, not manufacturer measurements. They follow the declared bounds below; this is an approximation rather than a measured ECU calibration for every individual engine.

- [Porsche 2012 991 specifications](https://newsroom.porsche.com/dam/jcr%3A6918184a-6bbe-44f3-bf4e-3f8a331dbd46/2012_911_991_Specs.pdf.PDF): NA 3.4/3.8, 7800 RPM redline, seven-speed manual and optional PDK, all gear/final-drive ratios. The selectable Carrera trims remain manuals. Evidence adds an explicitly labelled optional PDK comparison with its real 1.65 third and 0.62 seventh, 1400 kg including PDK's roughly 20 kg mass increment; its comparison references are 4.6 s / 287 km/h.
- [Volkswagen 2013 Golf GTI powertrain](https://www.volkswagen-newsroom.com/de/der-neue-golf-gti-internationale-pressevorstellung-2976): 162 kW, 350 Nm plateau 1500–4400 RPM, power 4500–6200, 6.5 s / 246 km/h; six-speed manual standard and DSG optional. This catalogue GTI is manual, Golf R is DSG. Its added plateau ends at 4400 RPM; sparse peak-power anchors remain intact.
- [Mercedes CLE technical data](https://www.mercedes-benz.com.hk/en/passengercars/models/coupe/cle/overview.html) and [Mercedes launch information](https://medya.mercedes-benz.com.tr/mercedes-benzin-tutkuyla-sekillendirilen-tamamen-yeni-modeli-cle-coupe-turkiyede/): CLE 200 320 Nm, CLE 300 400 Nm and 9G-TRONIC. [AMG CLE manufacturer release](https://media.mbusa.com/news/the-new-mercedes-amg-cle-coupe) specifies SPEEDSHIFT TCT 9G; TCT remains a torque-converter automatic here. It is not the MCT wet-start-clutch gearbox.
- [BMW Group Classic E36 M3 3.2](https://www.bmwgroup-classic.com/en/models/bmw-classics/product-description-page.ad-1518-1.bmw-m3-coupe-e36-321-hp.html): European S50B32, 236 kW at 7400 RPM. Its 7600 redline / 7700 fuel cut are a conservative model envelope, distinct from the US engine and from the E46's higher rev range.
- [Lamborghini Huracán EVO](https://www.lamborghini.com/en-en/models/huracan/huracan-EVO): NA V10 470 kW at 8000 RPM, 2.9 s and over 325 km/h. Both EVO variants use LDF dual clutch, including the RWD trim whose old generic tag said manual; literal `gearbox: "DCT"` and the powertrain object are authoritative. 8500 redline / 8600 cut are the model envelope.
- [Škoda technical data](https://cdn.skoda-storyboard.com/2025/06/TD-Octavia-en_3066a520.pdf): family reference for 2.0 TDI 110 kW / 360 Nm and seven-speed DSG. This is later-generation documentation, used for diesel shape/equipment context rather than claiming its gearing is the catalogue 5E taxi's. Taxi ratios and performance stay the existing 5E catalogue values. Diesel redlines use 4800 and fuel cut 4950; full-throttle upshifts happen around 4320 RPM.

## Estimation rules

- Idle 750–900 RPM by catalogue engine family. Redline 6000–7000 for ordinary NA, 6000–7100 for ordinary turbo petrol, 4500–5000 for diesel. Explicit sports exceptions: GR Yaris and AMG M139 7200; S50B32 7600; 991 NA flat-six 7800–7900; V10 8500. These exceptions are individually checked, not a blanket high-rev allowance for turbo engines. Fuel cut is 100–150 RPM above redline.
- Torque uses absolute catalogue Nm/RPM anchors, capped by quoted power. NA remains peaked, with no boost or synthetic turbo lag. Missing NA3/NA6/V10 types no longer fall through to the turbo4 engine. Turbo/diesel sparse curves receive continuous piecewise-linear plateau anchors. Plateau starts: modern turbo4 1500 (GLA 1620), MINI 1250, turbo6 1600, old Ibiza 1.8T 1950, TDI 1750, GR triple 3250 and M139 5000. Ends are bounded by `0.98 * Pmax / Tpeak`, 4500 petrol / 3000 diesel, with sourced GTI 4400 and M139 5250 exceptions. These are family estimates where no full manufacturer map is available; they do not add peak power or torque.
- Effective crank/flywheel inertia is 0.16–0.40 kg m²: small NA light flywheel 0.16–0.20; ordinary petrol 0.20–0.30; diesel/heavy six 0.30–0.38; sports NA 0.20–0.27. PHEV combined rotating-equipment estimate 0.40. Torque minus RPM-dependent friction divided by inertia controls clutch-open acceleration, also bounded by the table's conservative ECU/free-rev response. Heavy diesels 2600–3000 RPM/s; ordinary engines 3200–5800; light sports 6500–8500. Locked engine inertia remains reflected through ratio² into the existing implicit axle solver. Shaft-imposed RPM is not artificially rate-clamped: wheelspin or a mechanical money shift can exceed no-load rise limits.
- Spool entries are seconds at `turbo: 1`, multiplied by the trim's legacy turbo response factor. Decay is 35% of spool time. Modern petrol 0.35–0.48 s, old 1.8T 0.65, TDI 0.60–0.70; boost depends on pedal and engine speed. Overrun closes the torque request and releases boost. NA uses zero spool time and zero boost.
- Braking coefficient multiplies peak torque by `0.2 + 1.1 * (rpm/redline)^1.5`, with throttle lift blending and drivetrain direction. It is disconnected when the clutch is open. Limiter cut also exposes friction so a held gear can decelerate and refire. This produces negative sound load on overrun without injecting body/yaw forces.
- CLE 48 V transient assistance remains metadata; continuous ICE outputs are unchanged. CLE 300 e preserves the charged blended catalogue curve with zero boost lag. It is **not** a battery/SOC, motor torque split, electric-only, regeneration or battery-depletion model. Engine sound RPM still represents its running ICE approximation, not an EV motor.

The concurrent GK Jazz 1.3/1.5 Dynamic additions use the same NA4/manual rules (0.19 kg m², 4500 RPM/s, 360 ms). Their factory output/ratio references are in [the trim notes](../car-trims-notes.md). The fantasy turbo RWD Drift Spec was removed on 2026-10-20 (docs/OWNER-DECISIONS.md). Both road Jazzes retain their literal trim data.

## Gearboxes and driver policy

Equipment and player Auto/Manual preference are independent. Auto can operate a manual chassis with a simulated driver; Manual on a DCT or converter box still has that box's shift speed and overrev protection.

| Equipment | Shift envelope | Torque during shift | Low speed / downshift |
| --- | --- | --- | --- |
| Torque converter, including 9G and ZF8 | 250–400 ms | 60%, ratio handover eased over duration | Slip and up to 1.8x stall multiplication fade with turbine/pump speed; brake-released forward creep; unlock below 9 m/s, lock above 13 m/s; unlock during shift. Rev match enabled. |
| DSG / PDK / LDF / Mercedes DCT | 80–150 ms | 94%, progressive ratio handover | Small launch clutch slip; no converter creep. Crisp downshift matching through shift completion. |
| Manual | 300–500 ms | Zero while clutch open | Player button starts the shift; `input.clutch > .5` extends disengagement; `vehicle.revMatch = true` opts into a downshift blip. Default false. Unsafe downshifts can cause existing mechanical damage. |

Converter creep is suppressed by braking and fades by 2.2 m/s. Its reverse selection remains the game's brake-to-reverse policy. The 1.8 stall multiplier is a generic converter estimate; `(1 + .8 * (1 - turbine/pump ratio)) * turbine/pump ratio <= 1`, so multiplication cannot create shaft power. Converter slip is an algebraic hydrodynamic approximation, not a fluid/thermal solver. Clutch bite/launch RPM remains a game-driver approximation, rather than a full clutch pedal travel map. The unchanged tyre/suspension/damage integrators receive only crank torque and reflected inertia.

Light throttle shifts at 34% of redline for converter autos, 38% DCT, 43% manual simulated driver. Load/grade raises this; WOT shifts at 97.5%, or 90% for diesel's useful power band. Lower shift thresholds and a projected-lower-gear 10% margin plus 450 ms post-shift dwell prevent hunting during cruise. Heavy braking inhibits cruise upshifts and raises the downshift threshold toward 72% redline and admits a lower gear up to 88% redline, preserving engine braking and corner-exit gear selection without the cruise ceiling. WOT kicks down below 55% redline when the lower gear fits the safe power band. No CVT or single-speed EV is in the catalogue; neither is fabricated.

Fuel cut has a 55 ms minimum hold and 180 RPM diesel / 220 RPM petrol re-enable gap. It cuts combustion rather than clamping RPM, so no-load and in-gear limiter use actually oscillates. Mechanical overspeed remains possible on physical manuals, independently of the electronic fuel limiter. DCT/automatic paddles reject unsafe target RPM even in Manual preference.

## Sound/animation API

Existing scalar fields (`rpm`, `load`, `engineThrottle`, `boost`, `gear`, `limiter`, `shiftEvent`, `gearChangeEvent`) stay available. Read `vehicle.powertrainSignals` each audio/render frame:

```js
{
  rpm, redline, limiterRpm,
  throttle,             // [0,1] pedal after reverse mapping
  load,                 // [-1,1] delivered crank load, negative on engine braking
  boost,                // [0,1] spool state, not a pressure in bar
  gear,                 // 1-based forward; -1 reverse
  gearboxType,          // 'manual' | 'automatic' | 'dct' (legacy fixtures: 'legacy')
  shifting, limiter, overrun,
  converterSlip,        // RPM difference; 0 while locked / no converter
  converterLocked,
  events                // newest 32 events, consume by serial; read-only to consumers
}
```

Events have monotonic `serial` (never rewound by reset), simulation `time` in seconds since reset, `type` (`shift-start`, `shift-end`, `limiter-hit`) and `gearboxType`. Shift events also carry `from`, `to`, `direction` (+1/-1), `duration`, `manual` (player policy), `phase` and the gearChangeEvent fields. Limiter events carry `rpm`, `gear`. Persistent `shiftStartEvent`, `shiftEndEvent`, `limiterEvent` expose the latest instance. The ring survives render frames; reset empties it and clears these latest pointers. `gearChangeEvent` retains its exact prior shape for cockpit compatibility. A shift ring event's serial is independent of that legacy animation serial. No overrun event is necessary; it is a continuous boolean and negative load.

## Verification and reproduction

`manual.test.mjs` imports `powertrain.test.mjs`, so the existing npm test command runs the validation and dynamic behaviour tests. The regression executable also checks all 56 parameter sets, plus all catalogue performance/safety checks and seven representative 120-second flat-road pulls with 0–100 within 12% and top speed within 3%. Synthetic chassis without a powertrain object retain their exact frozen automatic trajectory; it was not regenerated. Engine-abuse tests now wait for each physical shift duration, and use a physical manual GTD to test diesel money-shift damage rather than forcing an impossible DSG downshift.

```sh
npm test
node --import ./tools/physics-test/register.mjs tools/physics-test/regress.mjs
node tools/check-browser-imports.mjs
node --import ./tools/physics-test/register.mjs tools/physics-test/powertrain-evidence.mjs
```

Evidence goes in `.scratch/powertrain/`: individual CSVs (25-second 60 Hz traces over 240 Hz physics), `summary.json` with 120-second top speeds and serialised shifts, and `rpm-through-gears.svg`. Gates are rerun on a clean `/tmp` archive of the committed HEAD; their logs and tested SHAs are kept with evidence. The PDK comparison is a test-only equipment configuration, not a silently changed selectable manual trim.

Handling fixtures now hold a useful manually selected physical gear near 60% redline after four seconds of rolling preparation, so cruise shift timing does not contaminate turn-in comparisons. The 0.88 g gate permits 0.001 g numerical tolerance. The low-output 97 kW classic retains a 0.88 g powered-corner floor; powerful RWD sports cars retain the 0.90 g floor and mandatory rear power-slip/TC checks. Every chassis still has the same anti-spin, grip, rotation and drift-latch checks. The MINI handbrake fixture keeps its 80 km/h entry and 1.5-second lever pulse, and observes nine seconds instead of eight for the heavier flywheel/launch response. Neither change injects forces or lowers the 360-degree completion gate. The diagnostic clutch-open state with a shift timer and no pending gear remains torque-free.

## Complete literal parameter table

Units: RPM; inertia kg m²; free rise RPM/s; spool/shift seconds. `brake` is the dimensionless coefficient above. `plateau` is absolute RPM; NA = catalogue peaked curve; blended = PHEV catalogue curve. Shift gear counts and ratios remain literal catalogue data.

| Trim ID | Engine | Idle | Redline | Fuel cut | Inertia | Free rise | Spool | Brake | Gearbox | Shift ms | Torque plateau |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: | --- |
| mini | turbo4 | 850 | 6800 | 6900 | 0.23 | 4800 | 0.38 | 0.16 | manual | 340 | 1250–4500 |
| z4 | turbo6 | 750 | 7000 | 7100 | 0.32 | 5500 | 0.36 | 0.14 | automatic | 280 | 1600–4500 |
| taxi | diesel | 800 | 4800 | 4950 | 0.38 | 2800 | 0.65 | 0.18 | dct | 140 | 1750–2859 |
| carrera | flat6 | 800 | 7800 | 7900 | 0.2 | 7500 | 0 | 0.15 | manual | 340 | NA |
| gr_yaris | turbo3 | 850 | 7200 | 7300 | 0.2 | 6500 | 0.42 | 0.16 | manual | 320 | 3250–4500 |
| gtv | na4 | 850 | 6500 | 6600 | 0.2 | 4200 | 0 | 0.14 | manual | 440 | NA |
| golf | turbo4 | 800 | 6500 | 6600 | 0.24 | 4500 | 0.35 | 0.16 | manual | 380 | 1500–3856 |
| corolla | na4 | 800 | 6800 | 6900 | 0.2 | 4800 | 0 | 0.16 | manual | 380 | NA |
| superb | turbo4 | 800 | 6500 | 6600 | 0.27 | 4400 | 0.4 | 0.16 | dct | 140 | 1500–4332 |
| police_octavia | turbo4 | 800 | 6500 | 6600 | 0.24 | 4500 | 0.35 | 0.16 | manual | 380 | 1500–4118 |
| mini_jcw | turbo4 | 850 | 6800 | 6900 | 0.22 | 5500 | 0.38 | 0.16 | manual | 320 | 1250–4500 |
| cle | turbo4 | 750 | 6500 | 6600 | 0.3 | 4200 | 0.42 | 0.16 | automatic | 340 | 1500–4445 |
| gla | turbo4 | 800 | 6500 | 6600 | 0.25 | 4200 | 0.4 | 0.17 | dct | 150 | 1620–4492 |
| gla45 | turbo4 | 850 | 7200 | 7300 | 0.25 | 6500 | 0.48 | 0.16 | dct | 100 | 5000–5250 |
| cla | turbo4 | 750 | 6500 | 6600 | 0.25 | 4200 | 0.4 | 0.17 | dct | 150 | 1500–4492 |
| huracan | v10 | 900 | 8500 | 8600 | 0.27 | 8500 | 0 | 0.15 | dct | 90 | NA |
| ibiza | na4 | 850 | 6200 | 6300 | 0.2 | 3300 | 0 | 0.15 | manual | 440 | NA |
| panda | na4 | 850 | 6200 | 6300 | 0.18 | 3400 | 0 | 0.15 | manual | 440 | NA |
| yaris | na4 | 850 | 6500 | 6600 | 0.16 | 4200 | 0 | 0.15 | manual | 400 | NA |
| e36 | na6 | 750 | 6500 | 6600 | 0.3 | 4200 | 0 | 0.16 | manual | 420 | NA |
| cle200 | turbo4 | 750 | 6500 | 6600 | 0.29 | 4000 | 0.42 | 0.16 | automatic | 360 | 1500–4387 |
| cle450 | turbo6 | 750 | 6500 | 6600 | 0.37 | 5000 | 0.4 | 0.15 | automatic | 300 | 1600–4500 |
| cle53 | turbo6 | 750 | 6500 | 6600 | 0.35 | 5500 | 0.42 | 0.16 | automatic | 250 | 1600–4500 |
| e36_m3 | na6 | 750 | 7600 | 7700 | 0.24 | 6800 | 0 | 0.16 | manual | 340 | NA |
| panda_11 | na4 | 850 | 6000 | 6100 | 0.18 | 3200 | 0 | 0.15 | manual | 440 | NA |
| panda_100hp | na4 | 850 | 6800 | 6900 | 0.18 | 5000 | 0 | 0.16 | manual | 360 | NA |
| yaris_13 | na4 | 850 | 6800 | 6900 | 0.18 | 4600 | 0 | 0.15 | manual | 400 | NA |
| yaris_ts | na4 | 850 | 6800 | 6900 | 0.18 | 5200 | 0 | 0.16 | manual | 360 | NA |
| ibiza_cupra | turbo4 | 850 | 6800 | 6900 | 0.24 | 4800 | 0.65 | 0.16 | manual | 380 | 1950–4500 |
| golf_gti | turbo4 | 800 | 6800 | 6900 | 0.25 | 5200 | 0.38 | 0.16 | manual | 340 | 1500–4400 |
| golf_gtd | diesel | 800 | 4800 | 4950 | 0.38 | 3000 | 0.6 | 0.18 | manual | 400 | 1750–3000 |
| golf_r | turbo4 | 800 | 6800 | 6900 | 0.25 | 5800 | 0.4 | 0.16 | dct | 110 | 1500–4500 |
| mini_cooper | turbo3 | 850 | 6500 | 6600 | 0.19 | 4800 | 0.38 | 0.16 | manual | 360 | 1250–4254 |
| mini_s | turbo4 | 850 | 6800 | 6900 | 0.23 | 5000 | 0.38 | 0.16 | manual | 340 | 1250–4500 |
| mini_cabrio_cooper | turbo3 | 850 | 6500 | 6600 | 0.19 | 4800 | 0.38 | 0.16 | manual | 360 | 1250–4254 |
| corolla_15 | na3 | 800 | 7000 | 7100 | 0.18 | 5200 | 0 | 0.15 | manual | 380 | NA |
| octavia_16tdi | diesel | 800 | 4800 | 4950 | 0.36 | 2600 | 0.7 | 0.18 | manual | 420 | 1750–3000 |
| octavia_rs | turbo4 | 800 | 6800 | 6900 | 0.25 | 5200 | 0.4 | 0.16 | manual | 340 | 1500–4332 |
| superb_15 | turbo4 | 800 | 6500 | 6600 | 0.24 | 4300 | 0.38 | 0.16 | manual | 400 | 1500–4118 |
| superb_4x4 | turbo4 | 800 | 6800 | 6900 | 0.27 | 5500 | 0.42 | 0.16 | dct | 120 | 1500–4500 |
| cla250 | turbo4 | 750 | 6500 | 6600 | 0.27 | 5000 | 0.4 | 0.17 | dct | 130 | 1500–4412 |
| cla35 | turbo4 | 750 | 6800 | 6900 | 0.26 | 5800 | 0.42 | 0.16 | dct | 110 | 1500–4500 |
| cla45s | turbo4 | 750 | 7200 | 7300 | 0.25 | 6500 | 0.48 | 0.16 | dct | 100 | 5000–5250 |
| gla250 | turbo4 | 800 | 6500 | 6600 | 0.27 | 4800 | 0.4 | 0.17 | dct | 140 | 1500–4412 |
| z4_20i | turbo4 | 750 | 6500 | 6600 | 0.26 | 4300 | 0.38 | 0.15 | automatic | 300 | 1500–4240 |
| z4_30i | turbo4 | 750 | 6500 | 6600 | 0.27 | 5000 | 0.38 | 0.15 | automatic | 280 | 1500–4445 |
| carrera_s | flat6 | 800 | 7800 | 7900 | 0.21 | 7800 | 0 | 0.15 | manual | 320 | NA |
| carrera_gts | flat6 | 800 | 7900 | 8000 | 0.21 | 8000 | 0 | 0.15 | manual | 320 | NA |
| huracan_rwd | v10 | 900 | 8500 | 8600 | 0.27 | 8500 | 0 | 0.15 | dct | 100 | NA |
| gtv1750 | na4 | 850 | 6500 | 6600 | 0.2 | 4200 | 0 | 0.14 | manual | 440 | NA |
| e36_318i | na4 | 750 | 6200 | 6300 | 0.23 | 3600 | 0 | 0.16 | manual | 420 | NA |
| mini_cabrio_jcw | turbo4 | 850 | 6800 | 6900 | 0.22 | 5500 | 0.38 | 0.16 | manual | 320 | 1250–4500 |
| cle300e | turbo4 | 750 | 6500 | 6600 | 0.4 | 4200 | 0 | 0.16 | automatic | 360 | blended |
| jazz | na4 | 750 | 6800 | 6900 | 0.19 | 4500 | 0 | 0.15 | manual | 360 | NA |
| jazz_dynamic | na4 | 750 | 6800 | 6900 | 0.19 | 4500 | 0 | 0.15 | manual | 360 | NA |

## SVJ single-clutch AMT

`aventador_svj` adds `amt` (literal gearbox `AMT`): 180 ms zero-torque
single-clutch ISR interruption, automated rev matching, no converter,
protected paddle downshifts. This intentionally differs from the Huracán's
90 ms LDF DCT with 94% shift torque. V12 receives explicit 8000–8700 RPM
validation bounds and an NA base engine. See `../svj-notes.md` for the mass,
launch-control, ALA and rear-steer approximation boundaries. The persistent
`powertrainSignals` view now reuses one object; consumers must copy it if
retaining a historical snapshot.
