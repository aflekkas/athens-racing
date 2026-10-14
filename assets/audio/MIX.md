# Athens Street Racers — real-game loudness audit

2026-10-14. This section supersedes the historical offline targets below.

## Current targets and defaults

Normal moving race: **−20 to −18 LUFS integrated**, maximum 3-second loudness **≤ −14 LUFS**, true peak **≤ −3 dBTP**. Menus and loading music aim for **approximately −26 LUFS**. Stopped/idling segments and the closed taxi cabin can be quieter.

Defaults: **master 0.60**, music 0.55, SFX 1.00, engine 0.85, tyres 0.28 (−9.1 dB from 0.80), ambience 0.50, traffic 0.65, UI 0.40. Saved master and tyre levels equal to their old 0.80 defaults migrate once, independently; other preferences and later explicit choices are retained.

## Real-game captures

The actual browser game runs `main.js`, vehicle physics, RivalAI, live traffic/police, camera/listener positioning, per-wheel tyre telemetry, ambience and the real radio track. No OfflineAudioContext or prescribed RPM/slip/Doppler fixtures are used. The non-audio game is pinned to `1fb320c` in a scratch copy so concurrent agents cannot change paired conditions. The after run applies the production Audio methods, source gains and default settings to the same live graph; synth banks, assets, compressor and simulation remain shared.

Headless graphics are suppressed; decorative driver/dashboard/HUD updates are skipped. The production `__sim.step` path advances on the live AudioContext clock. This host can render audio slower than wall time, so each accepted WAV contains about 45 seconds of actual samples; its wall duration is also logged. Capture is lossless native MediaRecorder PCM from a stereo MediaStreamDestination after the compressor, decoded to float WAV at the context’s native 44.1 kHz. Bus meters explicitly upmix to stereo and measure both channels after each bus volume. Bus RMS is audio-time-weighted dBFS, not LUFS; meter sample peaks are not true peaks.

The car/race settings are default: three rivals, standard traffic, radio on, automatic transmission and driving aids. Busy traffic starts in Varkiza at s=7900; camera comparisons use the closed Octavia taxi at s=4400. Police uses the normal three-rival grid plus a real oncoming dispatched unit and an enabled pursuit. Pause/title are reached through the game flow API; loading is an actual switch to Megara.

| Scene | Integrated LUFS before → after | Maximum 3 s LUFS before → after | True peak dBTP before → after | WAV seconds before / after |
|---|---:|---:|---:|---:|
| grid | -17.1 → -19.3 | -11.9 → -16.2 | -1.4 → -4.4 | 45.0 / 44.6 |
| traffic | -16.5 → -17.9 | -13.6 → -16.1 | -2.3 → -4.4 | 45.1 / 45.1 |
| cockpit | -18.2 → -22.6 | -17.0 → -19.5 | -3.4 → -7.2 | 45.0 / 45.0 |
| chase | -16.9 → -21.4 | -15.6 → -19.9 | -2.3 → -7.1 | 45.0 / 45.0 |
| police | -14.7 → -21.4 | -12.8 → -17.4 | -1.5 → -4.3 | 45.0 / 45.0 |
| pause | -22.0 → -25.1 | -20.4 → -23.4 | -9.4 → -12.5 | 45.2 / 45.0 |
| menu | -21.9 → -25.0 | -20.3 → -23.4 | -9.4 → -12.3 | 45.1 / 45.0 |
| loading | -21.9 → -25.1 | -20.3 → -23.4 | -9.0 → -12.0 | 45.2 / 45.1 |

### Stereo bus RMS, moving traffic segment

These are measured before the shared master/calibration/compressor stages. They describe layer balance, not overall output loudness.

| Bus | Before dBFS | After dBFS |
|---|---:|---:|
| engine | -27.1 | -21.9 |
| tyres | -35.2 | -31.3 |
| traffic | -36.2 | -45.1 |
| ambience | -45.4 | -47.5 |
| music | -29.7 | -33.2 |
| ui | silent | silent |

## Causes and corrections

- Separate rival and traffic pools could place up to sixteen engine voices in the mix. A shared distance-sorted budget keeps the nearest six at foreground detail and attenuates the remainder by 14.9 dB, in addition to their distance rolloff. Traffic selection sorts its own input defensively.
- Traffic/rivals could exceed the player engine. The external bus changes from 0.60 to 0.32; rival source levels multiply by 0.65, and traffic per-source output changes from 0.90 to 0.70. Sirens and horns share the reduced external bus while retaining their spatial cues.
- Wind’s quadratic speed rise reached 0.60. Its coefficient and ceiling now fall by a factor of three (9.5 dB); cabin whistle is also reduced. Tyre synthesis remains intact.
- Player engine source gain changes from 0.55 to 0.75. Combined with the master/calibration reduction, the default player engine remains about 2.3 dB quieter while keeping feedback clear above surrounding vehicles.
- The fixed 2× calibration plus compressor makeup lifted the entire mix. Calibration changes to 1.50, and first-run master to 0.60. Compressor threshold/knee/ratio/attack/release stay −5 dB / 6 dB / 8:1 / 3 ms / 160 ms. Source and bus balance supply the headroom.
- Race radio source level changes from 0.50 to 0.35; menu source level is separately 0.62, with the existing −18 dB world duck. Music toggles use the current mode’s level.
- Recorded grains already normalize coherent body amplitude and texture power. Doppler engines and sirens already have distance rolloff; neither required synthesis or distance changes. Existing ambience is subordinate and its assets/gains are retained.

## Evidence and verification

Accepted captures: `.scratch/audio-loudness/before-live-*-mix.wav` and `after-live-*-mix.wav`; matching `.webm` lossless source containers, per-scene telemetry JSON, per-scene loudness text and before/after spectrogram PNGs are retained. `loudness.json` combines integrated/short-term/true-peak and bus/voice telemetry; `bus-levels.json` retains bus measurements. Reproduce with `serve.mjs`, `paired-run.mjs`, `decode.py`, `measure.py` and `report.py` in that directory. Earlier `before-grid`, `before-native-*` and partial worklet recordings are diagnostic attempts, not the accepted paired measurements.

Browser console errors: zero. All accepted captures are duration-checked. Audio preference migration and shared voice-budget tests pass. The 8 audio/preference tests pass (`audio-tests-verified.log`). Earlier shared-checkout runs passed npm test (91 tests) and the tool/physics suite (112 tests). Later concurrent changes introduced unrelated physics, handling, multiplayer and account test failures; latest evidence is in `npm-test-last.log` and `tools-tests-verified.log`. Those owners’ code and fixtures are not modified by this audio work. No audio asset or `.orig` file is changed or committed.

---

# Historical offline ambience audit

The following is retained for source provenance and past ambience work; its defaults, targets and fixture loudness tables are superseded by the real-game audit above.
# Athens Street Racers — audio mix and ambience

Audit and lead-review correction: 2026-10-13. Default settings; 20-second stereo OfflineAudioContext scenes at 32 kHz.
Reference vehicle voice: recorded Z4 turbo-six, steady load 0.5; 2,300 / 3,600 / 5,100 RPM at 50 / 100 / 180 km/h. Cockpit fixtures exercise the closed-cabin `open: false` path; chase uses `open: true`. No radio unless explicitly labelled normal race. Coast proximity 0.7, town 0.3. Maps at idle use 750 RPM. These are reproducible mix fixtures, not driving-physics telemetry or a claim that every car has identical loudness.

The engine/tyre implementation was frozen in the before/after fixtures because a separate sound-design owner was changing it concurrently. No engine, tyre or Doppler synthesis changes belong to this work. The original full-game smoke test exercised the then-current shared checkout; the review rerenders isolate this ambience revision.

## Targets and defaults

| Layer | Target / rule |
|---|---|
| Player engine | Leading continuous layer; reference steady race approximately −18 to −16 LUFS overall without radio |
| Limit tyres | Clear feedback near the grip limit, several dB below the player engine; tyre synthesis owned separately |
| Traffic / rivals | Distance-filtered/panned secondary layer; near passes can briefly approach player level |
| Dry ambience, at speed | 18–25 dB below the stereo player-engine bus in open air, aiming for 22–25 dB; cabin filtering is additional |
| Ambience, stopped | 12–20 dB below the stereo idling-engine bus in open air, day and night |
| Night | No daytime cicadas; quieter crickets, reduced wind/town activity and no daytime birds/tractor |
| Rain | Soft outside rain in open air; quieter low-pass roof/screen drumming and wipers in cabin |
| Police | Noticeable close pass, attenuated with distance; no 2.4 kHz boost |
| UI | Brief, restrained clicks; UI slider default 0.40 (was 0.70, −4.86 dB) |
| Menu | Existing world duck retained at −18 dB; music/UI retain their own controls |
| Peaks | No digital clipping; retain existing dynamics settings and headroom |

Defaults: master 0.80, engine 0.85, tyres 0.80, ambience 0.50, traffic 0.65, UI **0.40**, music 0.55, legacy SFX 1.00. Existing saved user preferences are respected. Ambience balance is fixed at individual source gains while retaining the existing user slider values. Limiter unchanged: threshold −5 dB, knee 6 dB, ratio 8:1, attack 3 ms, release 160 ms; existing calibration gain 2.

## Corrected review measurements

**Capture correction:** the first audit split mono buses into two channels without explicitly upmixing them. The engine stem therefore had a silent right channel, understating its loudness by approximately 3 dB relative to its actual stereo contribution. The original engine/ambience gap table was too optimistic. The revised capture explicitly upmixes each tap to stereo, matching the game, and also records the complete pre-limiter mix. Limiter makeup adds approximately 1.4 dB in these steady fixtures—not the full engine-stem/overall difference implied by the earlier report.

The tables below supersede the original measurements. **Before** is the previous ambience implementation (`11990a9`); **after** is the lead-review revision. Both were re-rendered with the corrected stereo taps, identical seeded excerpts and the same frozen engine/tyre synthesis. Decoded assets attach in sorted order so parallel downloads cannot change random excerpt selection. Each fixture is 20 seconds at 32 kHz. I is integrated LUFS; Smax is maximum 3-second loudness after the first three seconds; peak is dBTP.

Engine, ambience and complete pre-limiter mix share the same measurement point and master/calibration scale. The engine-minus-ambience column is the target comparison. Overall loudness below is post-limiter and is labelled separately. These are representative exposed-map fixtures, not an ambience floor overriding coastline distance or geographic silence.

| Scene | Engine I | Ambience I before → after | Engine − ambience before → after (dB) | Complete pre-limiter I after | Ambience Smax after | Ambience peak after |
|---|---:|---:|---:|---:|---:|---:|
| cockpit-50 | -19.5 | -48.7 → -44.6 | 29.2 → 25.1 | -19.4 | -41.1 | -20.8 |
| cockpit-100 | -18.2 | -51.4 → -44.9 | 33.2 → 26.7 | -18.1 | -41.4 | -21.0 |
| cockpit-180 | -18.3 | -52.7 → -45.0 | 34.4 → 26.7 | -18.2 | -41.4 | -21.1 |
| chase-50 | -19.5 | -43.7 → -42.3 | 24.2 → 22.8 | -19.4 | -40.7 | -22.4 |
| chase-100 | -18.2 | -46.4 → -42.6 | 28.2 → 24.4 | -18.1 | -41.0 | -22.7 |
| chase-180 | -18.3 | -47.8 → -42.7 | 29.5 → 24.4 | -17.8 | -41.0 | -22.7 |
| riviera-day | -22.8 | -40.2 → -39.8 | 17.4 → 17.0 | -22.7 | -38.2 | -19.9 |
| riviera-night | -22.8 | -42.9 → -42.3 | 20.1 → 19.5 | -22.8 | -39.6 | -19.7 |
| megara-day | -22.8 | -38.6 → -40.3 | 15.8 → 17.5 | -22.8 | -37.3 | -27.0 |
| megara-night | -22.8 | -40.4 → -41.3 | 17.6 → 18.5 | -22.8 | -39.3 | -30.1 |
| penteli-day | -22.8 | -41.1 → -37.8 | 18.3 → 15.0 | -22.7 | -35.9 | -23.7 |
| penteli-night | -22.8 | -43.7 → -41.0 | 20.9 → 18.2 | -22.8 | -39.2 | -26.7 |
| megara-50 | -19.5 | -42.1 → -42.8 | 22.6 → 23.3 | -19.4 | -39.8 | -29.4 |
| megara-100 | -18.2 | -44.8 → -43.1 | 26.6 → 24.9 | -18.1 | -40.1 | -29.9 |
| megara-180 | -18.3 | -46.2 → -43.2 | 27.9 → 24.9 | -17.8 | -40.2 | -29.9 |
| penteli-50 | -19.5 | -44.5 → -41.6 | 25.0 → 22.1 | -19.4 | -39.7 | -27.5 |
| penteli-100 | -18.2 | -47.3 → -42.0 | 29.1 → 23.8 | -18.1 | -40.1 | -28.2 |
| penteli-180 | -18.3 | -48.6 → -42.2 | 30.3 → 23.9 | -17.8 | -40.3 | -28.3 |

### Complete post-limiter output

| Scene | Overall I before → after | Overall Smax before → after | True peak before → after |
|---|---:|---:|---:|
| cockpit-50 | -18.0 → -18.0 | -16.9 → -16.9 | -8.4 → -8.4 |
| cockpit-100 | -16.7 → -16.7 | -16.2 → -16.2 | -9.9 → -9.5 |
| cockpit-180 | -16.7 → -16.7 | -16.6 → -16.6 | -9.2 → -9.2 |
| chase-50 | -18.0 → -18.0 | -16.9 → -16.9 | -8.3 → -8.3 |
| chase-100 | -16.7 → -16.6 | -16.1 → -16.1 | -9.6 → -9.4 |
| chase-180 | -16.4 → -16.4 | -16.2 → -16.2 | -7.1 → -7.1 |
| traffic | -16.1 → -16.1 | -15.7 → -15.7 | -6.9 → -6.9 |
| rival-pass | -16.6 → -16.6 | -16.1 → -16.1 | -8.9 → -8.8 |
| police-pass | -16.5 → -16.5 | -15.5 → -15.5 | -5.9 → -5.9 |
| crash | -16.6 → -16.6 | -15.7 → -15.7 | -2.4 → -2.3 |
| rain-cockpit | -16.6 → -16.6 | -16.1 → -16.1 | -9.3 → -9.3 |
| rain-chase | -16.6 → -16.6 | -16.0 → -16.0 | -9.1 → -9.1 |
| menu | -34.5 → -34.5 | -34.1 → -34.1 | -21.7 → -21.7 |
| limit | -16.0 → -16.0 | -15.5 → -15.5 | -7.3 → -7.3 |
| normal-race | -15.1 → -15.1 | -14.5 → -14.5 | -4.5 → -4.5 |
| riviera-day | -21.3 → -21.3 | -21.2 → -21.2 | -10.5 → -10.4 |
| riviera-night | -21.3 → -21.3 | -21.2 → -21.2 | -10.7 → -10.6 |
| megara-day | -21.3 → -21.3 | -21.1 → -21.1 | -10.7 → -10.8 |
| megara-night | -21.3 → -21.3 | -21.2 → -21.2 | -10.9 → -10.9 |
| penteli-day | -21.3 → -21.2 | -21.2 → -21.1 | -11.0 → -10.9 |
| penteli-night | -21.3 → -21.3 | -21.2 → -21.2 | -11.0 → -11.0 |
| megara-50 | -18.0 → -18.0 | -16.9 → -16.9 | -8.3 → -8.3 |
| megara-100 | -16.6 → -16.6 | -16.1 → -16.1 | -9.6 → -9.6 |
| megara-180 | -16.4 → -16.4 | -16.2 → -16.1 | -7.0 → -7.0 |
| penteli-50 | -18.0 → -18.0 | -16.9 → -16.9 | -8.3 → -8.3 |
| penteli-100 | -16.7 → -16.6 | -16.1 → -16.1 | -9.4 → -9.1 |
| penteli-180 | -16.4 → -16.4 | -16.2 → -16.2 | -7.1 → -7.2 |

### Reference buses, correctly upmixed stereo

| Bus / fixture | I before → after | Smax before → after | True peak before → after |
|---|---:|---:|---:|
| Engine, chase 100 | -18.2 → -18.2 | -17.7 → -17.7 | -11.6 → -11.6 |
| Tyres at limit | -25.7 → -25.7 | -25.2 → -25.2 | -15.3 → -15.3 |
| Ambience, chase 100 | -46.4 → -42.6 | -45.1 → -41.0 | -27.5 → -22.7 |
| Three traffic vehicles | -27.1 → -27.1 | -27.0 → -27.0 | -15.4 → -15.4 |
| Rival pass | -37.4 → -37.4 | -34.8 → -34.8 | -24.0 → -24.0 |
| Police pass | -29.2 → -29.2 | -24.4 → -24.4 | -11.3 → -11.3 |
| Rain cockpit tyre spray | -34.4 → -34.4 | -34.1 → -34.1 | -25.2 → -25.2 |
| Menu UI click | -43.5 → -43.5 | -52.2 → -52.2 | -27.2 → -27.2 |
| Music | -23.2 → -23.2 | -21.9 → -21.9 | -11.3 → -11.3 |

Full corrected logs and all 54 multibus renders: `.scratch/audio-mix/final-*` and `prior-*`; machine-readable comparison: `revision-loudness.json`. Reproduction uses `final-render.mjs`, `revision-measure.py` and `revision-doc.py`, served by `serve.py` on port 8027. Older `before-*` / `after-*` files remain historical artifacts with the original mono-tap limitation. `review-*` / `revision-*` experiments are superseded by `prior-*` / `final-*`.

## Changes from lead review

- Sea wash gains: sand 0.34 → 0.40, rock 0.30 → 0.35. Coast distance, shore-side pan and inland silence remain intact.
- Speed attenuation now approaches a 0.72 gain floor on Riviera/Megara and 0.60 on the pine-wind bed. The transition starts at lower speed, retaining environmental detail at 100–180 km/h without lifting the stationary coastal bed indiscriminately.
- Closed-cabin world layers receive +2 dB before the existing 2.2 kHz low-pass filter. The cabin remains quieter/darker than chase; rain/wiper routing is unchanged.
- Megara wind 0.30 → 0.24; Penteli pine wind 0.25 → 0.37. These corrections keep the stereo idle/night gaps inside 12–20 dB; the separate Penteli speed-retention setting keeps its moving bed at the quiet end.
- No bus defaults, limiter settings, engine, tyre or Doppler synthesis changed in this revision.

## Layer behaviour and provenance

- **Riviera:** existing Greek sea wash (`sea-sand`, Profispiesser) and rocky Mediterranean waves (`sea-rocks`, uniuniversal). The existing route coastline distance (30–300 m rolloff) and camera-relative shore pan drive these layers. No surf on the inland maps. Athens traffic (`city`, Jedo) becomes a low-pass, quiet inland town murmur; route urban zones supply Vouliagmeni/Varkiza exposure. Day cicadas (Jedo), sparse gull excerpts (Soojay, 35–85 s between opportunities), occasional birds. All original sources are CC0 and listed in `world/CREDITS.txt` / `world/sources.json`.
- **Megara:** soft farmland wind (florianreichelt, CC0), occasional sparrows (JKata, CC0), and very sparse distant dog barks (andersmmg, CC-BY 4.0) or tractor excerpts (Lentusss, CC0). Rural events begin after 65–135 s, then wait 80–180 s; no tractor at night or in rain. Day insects are subdued. Wind is diffuse; one-shots have stable random pan and distance filtering.
- **Penteli:** wind in pine trees (kangaroovindaloo, CC-BY 4.0), sparse sparrows, much less daytime insect activity; half the lowland cricket level. Wind slowly shifts within a narrow stereo field. Rural/town/surf beds are absent.
- **Night:** existing crickets (hdfreema, CC0) replace daytime cicadas entirely. Dawn/sunset crossfade activity; rain suppresses wildlife by up to 95%.
- **Rain:** reuse existing light rain (soundrecorder7), heavy rain (chrscrwfrd18), interior roof/screen rain (pulswelle) and wipers (jc144940), all CC0. Roof rain/wipers now route to the **ambience** bus, with dedicated 1.8/2.4 kHz low-pass filters and reduced gains. They bypass the outside cabin filter but retain ambience volume, master volume and menu duck. Wet tyre spray remains on the tyre bus, at half its old gain.

New recordings are geographic substitutes, not claimed site recordings. Individual source URLs, licence URLs, source/output SHA-256 hashes, excerpt ranges, filters and level matching are in `world/ambience/sources.json` and `world/ambience/CREDITS.txt`. Additional compressed audio: **876,127 bytes** (five mono OGG files), below the approximately 3 MB budget. Existing recordings were reused unchanged.

Long texture layers use randomized 24–37 s excerpts (bounded by available recording length); farmland wind uses shorter 10–21 s excerpts after its first passage to avoid recycling the whole gust envelope. All use ±1.5% playback variation and 3 s equal-power overlaps. They use the game audio clock; late frames schedule one fresh excerpt rather than a backlog. No fixed gust LFO was added. Sparse birds/gulls/rural sounds have independent random timing and excerpt offsets; birds/gulls stop being triggered at higher speeds. Continuous ambience falls smoothly with speed. Old crowded café/beach beds and unmotivated decorative horns/scooters are removed from the ambient scene; real traffic vehicle sounds remain.

Sirens retain the original distance, pan, sweep and Doppler behaviour. Their 2.4 kHz peaking EQ changes from +4 to −2 dB, voice gain 0.32 → 0.23, and startup whoop gain halves.

## Verification and limitations

- Original audit `npm test`: 67 passing tests, no failures. Final shared-checkout rerun: 66 pass / 1 failure in `tools/physics-test/manual.test.mjs:27` (frozen automatic trajectory at frame 59) while another owner had uncommitted `src/physics.js` changes. The same three manual tests pass against an isolated copy of committed HEAD (`committed-manual-test.log`). No physics files were changed by this work.
- `node --import ./tools/physics-test/register.mjs --test tools/*.test.mjs tools/events-test.mjs tools/maps-test.mjs tools/maps-resource-test.mjs tools/police-test.mjs tools/rivals-test.mjs tools/traffic-test.mjs`: Initial run: 84 passing tests. Final shared-checkout run: 85 passing tests, no failures (another test was added concurrently).
- Headless Chromium game smoke: Riviera → Megara → Penteli, all 37 audio assets available, rain/night transitions and **zero console/page errors** on every map (`browser-smoke.json`).
- `.scratch/audio-mix/checks.mjs`: coastline falloff/direction, inland silence, live map changes, speed masking, night/rain wildlife suppression and sparse-event cadence.
- Browser offline routing check: with all other buses muted, cabin rain/wipers remain audible (peak 0.0416); setting ambience to zero produces **exactly silent output** after the smoothing tail.
- Spectral review includes source files and before/after ambience/traffic stems. Three-minute renders check beyond the short excerpts and include sparse rural events.
- **Listening limitation:** this execution harness rejects audio input (`audio content omitted because you do not support audio input`). Rendered audition files are supplied, but no subjective listening sign-off is claimed. Loudness/spectral review does not substitute for listening on speakers/headphones.

## Spectral findings

Lead-review comparison (`revision-spectrograms.png`): the same wave/gust events remain aligned between versions. The revised 100/180 km/h and cabin beds have more broadband detail, while the cabin still rolls off high frequencies. No new narrow tonal ridges, pulse patterns or abrupt joins appear in these excerpts. Texture scheduling is unchanged from the earlier three-minute review.

Original implementation findings follow:

The source sheets show the original insect band around 5–7 kHz, strong foreground voices in the café/beach recordings, and regular wiper strokes. In the scene comparisons the insect band is reduced, the foreground café/beach events disappear, cabin rain loses its bright hiss, and the siren harmonic ridge around 2–3 kHz is less prominent. Wiper cadence remains deliberately periodic; engine firing/tyre resonances are outside this ambience change.

The first 180-second Megara render exposed repeated whole-gust envelopes at roughly 25-second intervals. The follow-up changes only later farmland-wind excerpts to 10–21 seconds with randomized offsets and 3-second overlaps. Its first excerpt was unchanged by that earlier refinement; the corrected review fixtures above additionally use stable attachment ordering. The broad 24.7-second envelope-correlation peak drops from 0.43 to below the strongest remaining long-lag peak (0.22 at 40 seconds); the fixed-looking rise/fall sequence is absent in the refined spectrogram/RMS plot. Original and refined long renders/plots are retained under `.scratch/audio-mix/pre-refinement-*` and `long-*`.

Implementation commit: `288caf6`; wind refinement `11990a9`. No engine/tyre/Doppler synthesis or unrelated vehicle, camera, UI or gameplay changes were included.

Review verification: 85 tool tests pass; 16 ambience routing/behaviour assertions pass. All 27 paired fixtures were re-rendered, and corrected before/after spectrograms were inspected. The unrelated in-progress physics failure was left to its owner as requested; npm test was not rerun for this gain-only correction. The earlier three-map full-game smoke had zero errors; this gain-only revision adds browser offline renders on all three maps without repeating the full-game smoke. Subjective listening remains unverified because this harness cannot receive audio.

## Greek voice reactions — 2026-10-14

Short offline-generated barks now use a separate `voice` bus, default 0.65,
under the same SFX, master, world-menu duck and limiter stages. This addition
was not present in the earlier real-game captures above. Assets target -20 LUFS,
-4 dBTP before Vorbis encoding. One line maximum, at least 2.5 s global gap
plus 12–18 s per-speaker cooldown. Menus/pause cancel active and pending barks.

Equal-power 3D panners follow speaker heads in camera-local coordinates.
Distance gain: `.75 / (1 + (d/9)^1.6)`, multiplied by the squared linear fade
from 30 to 50 m. The panner's own rolloff is disabled to avoid double attenuation.
Existing bounded Doppler is reused; air low-pass falls with distance. Closed
listener cabin: gain ×.55 / 2.2 kHz; closed source car: ×.62 / 2.6 kHz.
Police stop commands represent an open-window call. No text bubbles/subtitles.
Settings: `voice` (0–1), `mildLanguage` (boolean, default false).

Four-second OfflineAudioContext fixtures through the real AudioMix/VoiceReactions:
5 m chase -29.53 LUFS, 25 m -42.38 LUFS, 50 m silent; cockpit -34.22 / -47.12 /
silent. True peak at 5 m chase -17.57 dBTP. These isolated barks are intentionally
subordinate to the continuous engine; this is not a full-race remix measurement.
WAVs, loudness reports and spectrograms: `.scratch/voice/crash-*`.
Reproduce: `tools/browser-slot.sh node tools/voice-browser-test.mjs`, then
`python3 tools/measure_voice.py`. Model provenance: `voice/CREDITS.txt`,
`voice/sources.json`, `voice/MODELS.md`; maintainable scripts: `voice/lines.json`.

## Tyre feedback retune (2026-10-14)

The tyre bus defaults to 0.28, a 9.1 dB reduction. Asphalt roll is halved and scrub begins only above 82% normalized combined peak slip. Cockpit road sound passes through a 1.1 kHz low-pass and 0.65 cabin gain. Squeal enters above 1.14 peak slip, requires over 25 km/h and 20% nominal wheel load, follows excess above 1.10 and releases below 1.06. All squeal paths share a further −7 dB trim and 120/200 ms attack/release time constants. Master, engine, limiter and loudness targets are unchanged. Reproducible fixture and real-game evidence: `.scratch/sound-v3/tyre-retune/`.
