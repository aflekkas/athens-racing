# Engine realism baseline — 2026-10-20

Baseline: a80d34bdd6fd59c7ba353e218914f7f209674932. All 31 catalogue cars captured before production edits.

## Method and limits

21-second stereo OfflineAudioContext at 44.1 kHz through the actual game master bus, default engine 85%, other buses muted, exterior listening. No normalization. Seeded random; updates at actual render-quantum suspensions (~29 Hz). Idle 0–3 s; slow full-load pull/limiter 3–11; high-rpm lift 11–14; part-throttle cruise 14–18; driver/rev-matched downshift blip 18–21. The blip trajectory is a diagnostic input, not proof that every manual car auto-blips.

Per-phase EBU R128 integrated loudness/true peak, FFT centroid, 80–800 Hz energy, >6 kHz energy and adjacent-sample step are in before-metrics.json. Short phase LUFS is comparative, not a programme loudness target. EV baseline clips intentionally contain silence and the render log records the construction failure, not a successfully rendered motor.

Ratings combine source/graph inspection and measured acoustic defects against real layout and published manufacturer sound descriptions. They are engineering judgments, not a claim of a human listening panel or exact-model five-phase recordings. Real-model references and licensed substitute provenance are in docs/audio-sources.md.

## Car by car

| Car | Before | Reference target / missing character | Pull LUFS / peak dBFS |
|---|---|---|---|
| MERCEDES-AMG SL 65 (`sl65`) | bad | V12 biturbo: deep, dense growl with smooth upper harmonics. NA Aventador substitute is too bright; no turbo-muffled low-mid body; abrupt lift. | -17.4 / -7.81 |
| MERCEDES-BENZ A 190 (`a190`) | weak | M166 NA I4: subdued four-cylinder buzz. Same resonant synthetic tone as the Alfa; excessive sport overrun setting. | -17.7 / -9.54 |
| PORSCHE 928 GTS (`p928`) | bad | 5.4 cross-plane V8: uneven bank rumble, smooth loaded growl. Thin periodic pulse tone, insufficient uneven-bank texture and intake body. | -19.6 / -9.09 |
| FERRARI 348 SPIDER (`f348_spider`) | bad | 3.4 flat-plane V8: dry idle, metallic rising scream. Quiet, hollow synthetic tone; lacks real mechanical texture and upper harmonics. | -19.1 / -13.42 |
| TOYOTA AYGO II 1.0 VVT-i (`aygo`) | bad | 1.0 NA I3: light, buzzy uneven beat. Too bass-heavy/loud for a small city car; short cyclic texture. | -15.9 / -8.71 |
| NISSAN QASHQAI J11 1.2 DIG-T (`qashqai`) | weak | 1.2 DIG-T I4: muffled four-cylinder with restrained turbo hiss. Focus RS substitute; nearly identical to police Octavia; weak load contrast. | -19.8 / -6.31 |
| BYD DOLPHIN COMFORT (`dolphin`) | bad | Permanent-magnet motor: quiet stopped, rotor/inverter whine moving. Voice creation throws RangeError at idle=0: missing all five phases. | -70.0 / -180.0 |
| BYD ATTO 3 DESIGN (`atto3`) | bad | Permanent-magnet motor: restrained whine, gentle regeneration tone. Voice creation throws RangeError at idle=0: missing all five phases. | -70.0 / -180.0 |
| FIAT DUCATO L2H2 2.3 MULTIJET 150 (`van_150`) | weak | 2.3 Multijet I4 diesel: clatter, low exhaust and turbo. Car-diesel substitute lacks van body; petrol blow-off on lift is inappropriate. | -21.9 / -8.1 |
| ISUZU NPR 75-190 BOX TRUCK (`truck`) | bad | 5.2 4HK1 I4 diesel: slow heavy firing/clatter. Incorrect six-cylinder bus profile; synthetic low drone; petrol blow-off. | -19.8 / -9.33 |
| MERCEDES-BENZ CITARO O530 · ΟΣΥ (`bus`) | bad | O530 inline-six diesel: deep even pulses and clatter. Very short repetitive low drone; limited clatter/load contrast. | -18.2 / -10.03 |
| ŠKODA OCTAVIA POLICE (`police_octavia`) | weak | TSI I4: modest four-cylinder body and turbo. Numerically identical to Qashqai; excessive hot-hatch ancestry. | -19.8 / -6.31 |
| FIAT PANDA · 100HP (`panda_100hp`) | bad | 1.4 FIRE NA I4: fizzy intake, modest rasp. Turbo Abarth exhaust substitute; insufficient naturally aspirated induction character. | -19.6 / -9.68 |
| HONDA JAZZ 1.5 i-VTEC DYNAMIC (`jazz_dynamic`) | weak | 1.5 i-VTEC NA I4: light buzz becoming induction snarl. Same generic Alfa/A190 bank; upper-register intake does not open up. | -17.0 / -9.55 |
| TOYOTA YARIS · 1.5 T SPORT (`yaris_ts`) | weak | 1.5 1NZ NA I4: light coarse buzz at high rpm. Generic city4; too much low body; no distinct intake resonance. | -16.3 / -8.59 |
| SEAT IBIZA · 1.8 20VT CUPRA (`ibiza_cupra`) | weak | 1.8 20VT I4: rounded low-mid note and recirculation hiss. Small Abarth substitute over-stretched above 3238 rpm; excessive crackle tendency. | -18.1 / -8.2 |
| VOLKSWAGEN GOLF · R 4MOTION (`golf_r`) | weak | EA888 turbo I4: gruff loaded note, brief DSG cut, restrained burble. Same Focus recording as AMGs; lift events sparse and attack too hard. | -18.0 / -6.25 |
| MINI JOHN COOPER WORKS (`mini_jcw`) | weak | B48 turbo I4: gruff note, intake growl, short overrun cluster. Existing real MINI texture useful; load adds loudness more than growl; uniform pops. | -16.3 / -5.29 |
| TOYOTA GR YARIS (`gr_yaris`) | bad | G16E turbo I3: low 1.5-order beat, intake roar, recirculation whoosh. Too smooth/repetitive, bass-heavy; lacks rough loaded texture. | -13.4 / -6.62 |
| MERCEDES-AMG GLA 45 S (`gla45`) | weak | M139 turbo I4: hard-edged four-cylinder snarl. Same Focus bank as Golf; no trim-specific growl/overrun shaping. | -17.6 / -5.9 |
| TOYOTA COROLLA 1.6 (`corolla`) | weak | 1.6 NA I4: restrained mechanical buzz. Generic city4 synthetic tone; same timbre as Yaris despite different engine. | -16.8 / -8.58 |
| ŠKODA OCTAVIA · 2.0 TSI RS (`octavia_rs`) | weak | EA888 turbo I4: rounded gruff midrange. Same Focus bank as Golf; load/cruise distinction mostly amplitude. | -18.0 / -6.25 |
| ŠKODA SUPERB · 2.0 TSI 4x4 (`superb_4x4`) | weak | EA888 turbo I4: quiet insulated low-mid note. Focus character remains; same comfort profile as Qashqai/police. | -19.2 / -7.37 |
| MERCEDES-AMG CLA · 45 S 4MATIC+ (`cla45s`) | weak | M139 turbo I4: sharp rasp and controlled overrun. Same voice as GLA/Golf; downshift cut hides blip. | -18.2 / -6.01 |
| MERCEDES-AMG CLE 53 4MATIC+ (`cle53`) | weak | M256 turbo inline-six: smooth dense snarl. BMW M4 substitute; identical profile to Z4; not enough low-mid load. | -18.0 / -8.79 |
| BMW Z4 M40i (`z4`) | weak | B58 turbo inline-six: smooth rise into growl, short burble. M4 S55 substitute; little intake/exhaust separation and weak lift cluster. | -17.8 / -9.59 |
| PORSCHE 911 · CARRERA GTS (`carrera_gts`) | bad | 991.1 3.8 NA flat-six: rasp becoming metallic howl. 1972 ST substitute heavily filtered; upper bank stretched beyond 2x; restrained intake. | -16.1 / -8.0 |
| LAMBORGHINI AVENTADOR SVJ (`aventador_svj`) | weak | 6.5 NA V12: complex shriek; owner requires NO pops. Real Aventador texture exists; repetitive high loop/pitch stretch; smooth load only. Preserve zero pops. | -16.5 / -8.42 |
| LAMBORGHINI HURACÁN EVO (`huracan`) | bad | 5.2 NA V10: strong fifth-order shriek with bank texture. Small pure harmonic loop sounds like a tone; lacks upper-register texture and throaty idle; evenly spaced firing misses the 5.2's 54°/90° intervals. | -17.4 / -10.02 |
| ALFA ROMEO 2000 GTV (`gtv`) | bad | 2.0 twin-cam NA I4: open carburettor bark and metallic exhaust. Generic na4 shared with commuters; no separate induction bark. | -17.4 / -9.41 |
| BMW M3 3.2 E36 (`e36_m3`) | bad | S50B32 NA inline-six: smooth rising metallic snarl. Too quiet and pure; synthetic idle; insufficient intake character at load. | -21.7 / -14.63 |

## Common failures

- Synthetic loops last only 6 loaded / 14 unloaded engine cycles; high-rpm texture repeats rapidly.
- Most recorded voices have one low-pass and a gain change for load; combustion/exhaust and induction are not separated enough.
- Overrun uses sparse identical short pops; no sustained irregular low burble. Stock commuters inherit pops they should not have.
- Downshifts receive the same volume cut as upshifts, hiding the rev-matched rise supplied by physics.
- Square-wave limiter modulation boosts half the cycle instead of only cutting combustion.
- Diesel lift-off uses a petrol blow-off hiss. EV construction divides by zero.
- No baseline render clips: peaks stay below full scale. Improving realism must preserve that headroom.
