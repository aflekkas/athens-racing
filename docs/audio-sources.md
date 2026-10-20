# Engine audio sources and realism notes

Updated 2026-10-20. No music. No SVJ exhaust-pop synthesis.

## Approach

Hybrid: keep useful licensed recordings, add two small V8 family banks, and synthesize the other layouts from pressure pulses plus stochastic valve/exhaust flow. Load controls exhaust body and a separate intake path. No model trained on sound assets. Pure sine rotor orders replace combustion entirely for EVs. These are calibrated game voices, not exact-model field recordings.

Added runtime audio: **449,816 bytes** (eight 16 kHz mono PCM files; verify exact total below). Lazy-loaded through the existing family selector, not bundled at startup. Original source masters are not shipped. The small V8 takes are expanded into phase-coherent 24-second beds in yielding tasks, preserving the existing source count. The player procedural cache and per-context loader cache each retain four entries; active external voices retain their banks separately.

## Source register

Every existing engine source is retained here for attribution. Exact URLs, cuts, reference RPM estimates, output hashes and processing are in `assets/audio/engines/sources.json`; original credits also remain in `assets/audio/engines/CREDITS.txt`. The word substitute is intentional.

| Source / creator | Licence | Used for |
|---|---|---|
| [Car Engine Contact Recording-Mini Cooper S 2019.wav](https://freesound.org/people/TheLittleCrow/sounds/669618/) — TheLittleCrow | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | MINI / some turbo fours (Cooper S substitute for JCW) |
| [Car Engine Contact Recording-Mini Cooper S 2019_Gunning_it.wav](https://freesound.org/people/TheLittleCrow/sounds/669622/) — TheLittleCrow | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | MINI upper register |
| [Car engine start up running and turning off.wav (Fiat Punto Grande)](https://freesound.org/people/sound_catcher99/sounds/425158/) — sound_catcher99 | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | generic petrol ignition |
| [BMW M4 2014 exterior start, idle, blips and steady neutral RPM](https://sonniss.com/gameaudiogdc/) — Pole Position Production | [Sonniss GameAudioGDC](https://sonniss.com/gdc-bundle-license/) | Z4/CLE turbo sixes (S55 substitute for B58/M256) |
| [car_inside_start_idle_diesel_engine.wav (2007 VW Passat)](https://freesound.org/people/Loffy/sounds/89948/) — Loffy | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) | diesel start/idle |
| [Audi A3 8L 1.9 TDI 2000 RPM loop](https://sonniss.com/gameaudiogdc/) — Soundholder | [Sonniss GameAudioGDC](https://sonniss.com/gdc-bundle-license/) | diesel low RPM |
| [Volkswagen Caravelle T5 2.0 TDI 3000 RPM loop](https://sonniss.com/gameaudiogdc/) — Soundholder | [Sonniss GameAudioGDC](https://sonniss.com/gdc-bundle-license/) | diesel upper RPM |
| [Porsche 911 ST 1972 onboard fast drive, engine mic (air-cooled flat-six)](https://sonniss.com/gameaudiogdc/) — Pole Position Production | [Sonniss GameAudioGDC](https://sonniss.com/gdc-bundle-license/) | 911 flat-six (air-cooled ST substitute for water-cooled GTS) |
| [Porsche 997 Cup 2012 onboard start, drive and gearshifts, engine mic (water-cooled flat-six)](https://sonniss.com/gameaudiogdc/) — Pole Position Production | [Sonniss GameAudioGDC](https://sonniss.com/gdc-bundle-license/) | 911 ignition |
| [Lamborghini Aventador 2014 onboard start, drive and ramps, exhaust mic (V12)](https://sonniss.com/gameaudiogdc/) — Pole Position Production | [Sonniss GameAudioGDC](https://sonniss.com/gdc-bundle-license/) | SVJ and SL65 V12 family (SL65 is turbo-muffled by calibration) |
| [Ford Focus RS 2016 onboard drive and ramps, engine mic (2.3 EcoBoost turbo four)](https://sonniss.com/gameaudiogdc/) — Pole Position Production | [Sonniss GameAudioGDC](https://sonniss.com/gdc-bundle-license/) | hot and comfort turbo fours (2.3 EcoBoost substitute) |
| [Fiat Abarth 595 2016 onboard fast drive, exhaust mic (1.4 T-Jet turbo four)](https://sonniss.com/gameaudiogdc/) — Pole Position Production | [Sonniss GameAudioGDC](https://sonniss.com/gdc-bundle-license/) | Ibiza turbo-four (T-Jet substitute; no longer used for Panda) |
| [Pole Position - Ferrari 308 GTB 1985](https://sonniss.com/gameaudiogdc/) — Pole Position Production | [Sonniss GameAudioGDC Bundle License v2.0 (2026-08-27)](https://sonniss.com/gdc-bundle-license/) | 348 Spider (308 GTB flat-plane substitute) |
| [Pole Position - Mercedes AMG C63 2009](https://sonniss.com/gameaudiogdc/) — Pole Position Production | [Sonniss GameAudioGDC Bundle License v2.0 (2026-08-27)](https://sonniss.com/gdc-bundle-license/) | 928 GTS low/mid and V8 ignition (C63 cross-plane substitute) |
| [Soundholder - Porsche Cayenne - 4.8 V8](https://sonniss.com/gameaudiogdc/) — Soundholder | [Sonniss GameAudioGDC Bundle License v2.0 (2026-08-27)](https://sonniss.com/gdc-bundle-license/) | 928 GTS high register (Cayenne cross-plane substitute) |

New Sonniss material was acquired 2026-10-20 under the published v2.0 agreement, effective 2026-08-27. It permits modification and synchronization in games; standalone redistribution as a sound library is excluded. The added files are game assets, and the feed clips are game-mix demonstrations. No exact-model recording or original recording authorship is claimed. CC BY attribution: **Loffy — car_inside_start_idle_diesel_engine.wav**, trimmed, looped, filtered and level-matched; see the linked source and licence above.

## Reference targets

Manufacturer documents verify layouts and intended stock character. Timbre settings are design judgments informed by those descriptions and the available family recordings, not measured transfer functions of all 31 real cars. Individual exhaust options, model years and regional filters change the sound. The audit explicitly distinguishes this from human audition or exact-model source capture.

- [2014 911 GTS: sports exhaust](https://newsroom.porsche.com/es/ppdb/2014/10/mayor-potencia-y-rendimiento-dinmico--los-nuevos-modelos-porsche-911-carrera-gts.html): NA flat-six rasp/howl, not the later turbo GTS.
- [BMW Z4 M40i](https://www.press.bmwgroup.com/united-kingdom/article/detail/T0285137EN_GB/the-all-new-bmw-z4?language=en_GB): turbo inline-six; [BMW E36 M3 history](https://www.press.bmwgroup.com/usa/article/attachment/T0259163EN_US/360979): NA inline-six.
- [AMG SL65](https://media.mercedes-benz.it/la-nuova-mercedes-benz-sl-65-amg-prestazioni-superlative-in-puro-stile-roadster/): biturbo V12. [CLE53](https://media.mbusa.com/news/the-new-mercedes-amg-cle-coupe): M256 inline-six. [CLA45 S](https://www.mbusa.com/content/mb-nafta/en_us/vehicles/class/cla/coupe/type-amg.html): four-cylinder, shared M139 family with GLA45 S. None is a V8.
- [Ferrari 348 Spider](https://www.ferrari.com/en-IL/history/garage/1993/348-spider): 3.4 NA V8. Cross-plane Porsche 928 and flat-plane Ferrari retain distinct firing/bank character.
- [Huracán EVO](https://www.lamborghini.com/en-en/models/huracan/huracan-EVO) and [manufacturer exhaust sound reference](https://www.lamborghini.com/en-en/news/huracan-evo-rwd-spyder-in-details-exhaust-system): NA V10. The [Huracán power-unit press pack](https://preview.thenewsmarket.com/Previews/lamb/DocumentAssets/321603.pdf) specifies alternating 54°/90° firing; the procedural timing now follows that common-pin layout. Aventador source is a real NA V12; owner restriction overrides any reference suggesting SVJ pops.
- [Toyota GR Yaris](https://media.toyota.co.uk/vehicles/gr-yaris/): turbo **three**-cylinder; [Toyota engineering sound discussion](https://global.toyota/pages/global_toyota/mobility/technology/toyota-technical-review/TTR_Vol66_E.pdf) discusses induction, exhaust and bypass sound. Stock burble is restrained.
- [Golf VII R](https://www.volkswagen-newsroom.com/en/the-new-golf-r-2432), [MINI JCW](https://www.press.bmwgroup.com/usa/article/attachment/T0206443EN_US/298231), [Octavia III RS](https://www.skoda-storyboard.com/en/press-releases/rs-two-letters-that-electrify-skoda-fans/): distinct turbo-four calibrations, not a V8 soundtrack. Comfort/police TSI, Superb, Qashqai and older Ibiza get restrained lift-off rather than modern aftermarket crackle tunes.
- [Aygo II](https://media.toyota.co.uk/vehicles/aygo-2014-2022/): NA three-cylinder. [Jazz Dynamic](https://hondanews.eu/be/fr/cars/media/pressreleases/127946/2018-jazz-dynamic-15-litre-i-vtec): 1.5 i-VTEC. [Panda 100HP](https://www.media.stellantis.com/em-en/fiat/press/fiat-panda-hybrid-the-most-democratic-mild-hybrid-on-the-market): 1.4 16-valve. A190, Yaris TS, Corolla and Alfa GTV retain their catalogue NA-four layouts with commuter / sport / open-induction calibrations.
- [Isuzu NPR/N75.190](https://www.isuzutruck.co.uk/products/n75190-chassis-cab/): 5.2 **four**-cylinder diesel. [Ducato 150](https://www.media.stellantis.com/uk-en/fiat-professional/press/the-2014-fiat-ducato-more-technology-more-efficiency-more-value): 2.3 Multijet. [Citaro family](https://www.mercedes-benz-bus.com/int/en/models/citaro-ue.html): inline-six diesel; current brochure is a family reference, not the exact O530 model year.
- [Dolphin](https://www.byd.com/material/byd-site/np/dolphin/brochure.pdf) / [Atto3](https://www.byd.com/material/byd-site/mo/product/24atto3/2024-BYDATTO3brochure.pdf): permanent-magnet motors. Game motor orders are a restrained procedural approximation, not recorded BYD inverter signatures.

## Reproduction and remaining limits

The car-by-car audit, five-phase timeline, before/after metrics and capture scripts are in `.scratch/engine-realism-2026-10-20/`. Owner evidence is `/home/dev/data/agent-feed/sound-design/engines/`: `{id}.webp`, `{id}.txt`, `before-{id}.ogg`, `after-{id}.ogg`. All 31 use the same exterior-camera mix and no normalization.

A complete real-world, same-RPM five-phase recording set for all 31 cars is not available in this task. Several family samples remain substitutes, especially Focus→M139/EA888, M4→B58/M256, ST→991.1 and Aventador→SL65. Further exact-car fidelity needs suitable licensed recordings or owner feedback; the current evidence makes those judgments reviewable. No purchase, music, upload of source masters, push or deployment is part of this change.
