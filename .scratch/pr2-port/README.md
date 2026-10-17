# Classic car port — PR #2

Ported [Vas-Per’s PR #2](https://github.com/aflekkas/athens-racing/pull/2), source 611dd612ac78008cde357983ca90926f0fe4347d, onto prod e077007. Author: Vassilis Perrotis. The complete 14-commit contributor DAG, including merge commits, is replayed with original authors and dates, followed by the current-schema integration. Integration: Codex; original contributor history also credits Claude Opus 5.5.

Four generations, 12 trims: R231 SL 400/500/63/65; W168 A 160/A 190; Ferrari 348 tb/ts/Spider; Porsche 928 S4/GT/GTS. Ferrari bodies are real closed, targa and Spider meshes. The R231 uses its open roadster body; its folding hardtop is not animated. 928 lamps remain articulated after merging and damage repair.

Gearbox mode remains the player’s choice; physical shift hardware is specified separately. Every trim has explicit powertrain fields, period gearbox hardware, tyre dimensions, engine audio and automatic performance-index classification. SL 63 uses the MCT wet starting clutch; the other SLs have torque converters. NA V8s have zero turbo spool. Ferrari retains its dogleg gate. W168 has period analogue instruments, R231 COMAND-era instruments, Ferrari analogue Veglia-style instruments and 928 its analogue Porsche cluster. New badges share the existing compressed atlas and never replace a shared material’s texture.

Geometry: exterior 2260–2643 triangles, interior at most 1636; LOD1 at most 504, LOD2 at most 224, wheels 74 each. Existing 70 vehicles have identical mesh geometry, transforms, material properties and visibility compared with prod; see [comparison](unchanged-models.json). Retained their rendered mask fixtures and captured all 12 new cockpits through the documented tools/browser-slot.sh + tools/pov-camera-mask.mjs workflow. Tests recount all 82 PNG masks and require current source hashes; PNG files are required lossless test fixtures, not screenshot evidence. No driving-view geometry guard was weakened. Window-opening percentages remain advisory, as on prod.

[Exterior contact sheet](exteriors.webp) · [Cockpit contact sheet](cockpits.webp).

The existing .scratch/pr2-review folder had 12 screenshots but no written Muse findings. It was left untouched.

[Original-to-ported commit map](commit-map.json). Legacy contributor diagnostic scripts are superseded by the current catalogue, cockpit, physics and budget gates.

## Specification references and calibration

- [Mercedes A 160 manufacturer archive](https://mercedes-benz-publicarchive.com/marsClassic/en/instance/ko/A-160-2001---2004-production-in-Brazil-for-South-America-until-2005.xhtml?oid=194914949)
- [A 190 manufacturer engine and sport gearbox data](https://mercedes-benz-publicarchive.com/marsClassic/en/instance/ko/A-190-1999---2001.xhtml?oid=194914943)
- [SL 400 manufacturer launch](https://media.mercedes-benz.be/nieuwe-mercedes-benz-sl-400-efficiente-biturbokracht/)
- [SL 500 manufacturer launch](https://media.mercedes-benz.fr/nouveau-roadster-mercedes-benz-sl-leger-athletique-luxueux/)
- [SL 63 manufacturer launch](https://media.mercedes-benz.be/fr/la-nouvelle-sl-63-amg/)
- [SL 65 manufacturer launch](https://media.mercedes-benz.pl/moc-bez-wysiku/)
- [Ferrari 348 tb](https://www.ferrari.com/en-EN/auto/348-tb), [ts](https://www.ferrari.com/en-EN/auto/348-ts), [Spider](https://www.ferrari.com/en-EN/auto/348-spider): contributor specification references; Ferrari pages blocked automated reading, so no bypass was used.
- [Porsche manufacturer historical outputs](https://newsroom.porsche.com/en/2026/history/porsche-transaxle-models-history-42008.html)
- [Porsche GTS owner manual, transmission table](https://www.manualslib.de/manual/248463/Porsche-928-Gts.html?page=105)
- [Manufacturer S4 press-kit text](https://www.no-speedlimit.it/Porsche_Werkfoto_1987_USA_928_S4.html)
- [Porsche approved tyres](https://static.nhtsa.gov/odi/tsbs/2021/MC-10199877-0001.pdf)

Power/torque peaks, gear counts and quoted road performance are specifications. Intermediate torque-curve points, flywheel inertia, free-rev response, simulated tyre grip, aero area, suspension and assist strengths are game calibration rather than manufacturer measurements. Masses use road-ready/DIN convention (SL EC values less 75 kg); Ferrari dry weights are not mixed into running masses. Performance classes come from the current shared index, never hand-assigned legacy ranks.
