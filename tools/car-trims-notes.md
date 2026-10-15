# Trim catalogue conventions

Garage `CAR_MODELS` groups a generation and body style; each `trims` member names an executable `CARS` physics spec and multiplayer wire ID. Retaining existing IDs is intentional. `migrateCarSelection` upgrades string IDs to `{entry,trim}` without losing an old engine selection. The compatibility `paraliaki.car` string remains authoritative; the garage also writes `paraliaki.car.selection`.

The available trim set is curated, not every engine sold worldwide. F56 JCW hardtop and F57 Cooper S convertible are different bodies, and CLA C178, CLE C236 and GLA H247 are different generations/models. Only the two H247 GLA engines share a garage card. The E36 325i and European M3 3.2 share a card.

New CLE specifications use ICE rated kW/Nm (48 V transient assist is not added to continuous engine power), DIN mass excluding the 75 kg EU driver/luggage allowance. Existing CLE 300 stays at its sourced 1805 kg calibration; year/equipment change published weights. CLE 200 / 450 / AMG 53 use representative 1715 / 1870 / 1925 kg DIN masses. 9G gear ratios use the existing C236 set; AMG final drive is 3.07. These ratios, off-peak engine curves, grip and suspension are simulation approximations, not claimed factory telemetry.

Manufacturer sources:

- Mercedes C236 launch technical data (200, 300 and 450): https://media.mercedes-benz.pl/wyrzezbiony-przez-pozadanie---nowy-mercedes-benz-cle/
- Mercedes C236 technical sheet: https://nd-mediagallery2-public-production.s3.amazonaws.com/215df8a0a2f426ec8e82796a0eaca795/techdata_cle_c236_806_056.pdf
- AMG CLE 53 launch: https://media.mercedes-benz.com/article/32cdd73f-bd34-446c-ab21-3d8860b91b7b
- BMW E36 M3 history (European S50, 236 kW, six-speed): https://www.press.bmwgroup.com/belux/article/attachment/T0260495FR/360217
- Existing individual cars retain the citations next to their specs in `src/cars.js`.

Appearance uses representative factory/sport-package cues rather than promising every wheel or cosmetic item is standard in every market: wheel diameter/spokes, coloured fixed calipers, ride height, trim lettering, rear lip, AMG grille and quad round outlets. Body surfaces and cabin are shared. E36 M3 uses twin left outlets, M front splitter and rear diffuser. The CLE AMG skin approximates the wide-body car with the existing parameterised arches.
