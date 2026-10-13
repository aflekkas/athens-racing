# Athens Street Racers — audio mix and ambience

Audit: 2026-10-13. Default settings; 20-second stereo OfflineAudioContext scenes at 32 kHz.
Reference vehicle voice: recorded Z4 turbo-six, steady load 0.5; 2,300 / 3,600 / 5,100 RPM at 50 / 100 / 180 km/h. Cockpit fixtures exercise the closed-cabin `open: false` path; chase uses `open: true`. No radio unless explicitly labelled normal race. Coast proximity 0.7, town 0.3. Maps at idle use 750 RPM. These are reproducible mix fixtures, not driving-physics telemetry or a claim that every car has identical loudness.

The engine/tyre implementation was frozen in the before/after fixtures because a separate sound-design owner was changing it concurrently. No engine, tyre or Doppler synthesis changes belong to this work. The final game smoke test exercises the current shared checkout.

## Targets and defaults

| Layer | Target / rule |
|---|---|
| Player engine | Leading continuous layer; reference steady race approximately −18 to −16 LUFS overall without radio |
| Limit tyres | Clear feedback near the grip limit, several dB below the player engine; tyre synthesis owned separately |
| Traffic / rivals | Distance-filtered/panned secondary layer; near passes can briefly approach player level |
| Dry ambience, at speed | Roughly 18–25 dB below engine in open air; extra cabin filtering may make it quieter |
| Ambience, stopped | More exposed, approximately 12–20 dB below idling engine; Penteli quieter than Riviera |
| Night | No daytime cicadas; quieter crickets, reduced wind/town activity and no daytime birds/tractor |
| Rain | Soft outside rain in open air; quieter low-pass roof/screen drumming and wipers in cabin |
| Police | Noticeable close pass, attenuated with distance; no 2.4 kHz boost |
| UI | Brief, restrained clicks; UI slider default 0.40 (was 0.70, −4.86 dB) |
| Menu | Existing world duck retained at −18 dB; music/UI retain their own controls |
| Peaks | No digital clipping; retain existing dynamics settings and headroom |

Defaults: master 0.80, engine 0.85, tyres 0.80, ambience 0.50, traffic 0.65, UI **0.40**, music 0.55, legacy SFX 1.00. Existing saved user preferences are respected. Ambience balance is fixed at individual source gains while retaining the existing user slider values. Limiter unchanged: threshold −5 dB, knee 6 dB, ratio 8:1, attack 3 ms, release 160 ms; existing calibration gain 2.

## Measured before / after

`I` is EBU R128 integrated loudness; `Smax` is maximum 3-second short-term loudness (after the first 3 seconds); peak is oversampled true peak. Bus stems are post-bus-gain, with master/calibration gain and menu attenuation, before the shared dynamics stage. The browser compressor applies its own makeup gain, so bus LUFS must not be directly compared to the limited overall LUFS. Compare bus-to-bus differences. Effects/reverb bypass the six named buses and were captured separately. Music is silent in fixtures except normal race; UI is exercised in the menu fixture.

| Scene | Overall I before → after (LUFS) | Overall Smax before → after | Peak before → after (dBTP) | Ambience I before → after |
|---|---:|---:|---:|---:|
| cockpit-50 | -17.7 → -18.0 | -16.4 → -16.9 | -5.7 → -8.3 | -31.2 → -46.9 |
| cockpit-100 | -16.6 → -16.7 | -16.1 → -16.2 | -6.4 → -9.8 | -35.6 → -49.6 |
| cockpit-180 | -16.7 → -16.7 | -16.5 → -16.6 | -8.3 → -8.9 | -35.6 → -50.9 |
| chase-50 | -17.6 → -18.0 | -16.4 → -16.9 | -6.5 → -8.4 | -29.9 → -43.1 |
| chase-100 | -16.4 → -16.7 | -15.7 → -16.2 | -5.5 → -9.5 | -30.1 → -45.7 |
| chase-180 | -16.2 → -16.4 | -15.7 → -16.1 | -6.5 → -6.1 | -30.0 → -47.2 |
| traffic | -15.9 → -16.1 | -15.5 → -15.7 | -5.6 → -7.4 | -30.4 → -46.2 |
| rival-pass | -16.4 → -16.6 | -15.7 → -16.1 | -5.5 → -9.1 | -30.0 → -45.7 |
| police-pass | -16.0 → -16.5 | -14.4 → -15.5 | -4.3 → -5.9 | -31.4 → -45.9 |
| crash | -16.3 → -16.6 | -15.6 → -15.8 | -2.8 → -3.7 | -30.1 → -45.8 |
| rain-cockpit | -15.7 → -16.6 | -14.9 → -16.1 | -2.7 → -9.6 | -32.3 → -47.3 |
| rain-chase | -16.1 → -16.6 | -15.6 → -16.1 | -6.2 → -9.1 | -30.3 → -43.3 |
| menu | -34.3 → -34.5 | -33.7 → -34.1 | -19.4 → -21.1 | -48.1 → -63.6 |
| limit | -15.8 → -16.0 | -15.2 → -15.5 | -5.3 → -7.5 | -30.1 → -45.8 |
| normal-race | -14.9 → -15.1 | -14.3 → -14.5 | -4.5 → -4.9 | -30.5 → -46.2 |
| riviera-day | -20.7 → -21.3 | -19.5 → -21.1 | -7.9 → -10.5 | -30.2 → -39.5 |
| riviera-night | -20.9 → -21.3 | -20.6 → -21.2 | -8.7 → -10.7 | -31.9 → -41.9 |
| megara-day | -21.0 → -21.2 | -20.8 → -21.0 | -10.1 → -10.8 | -32.9 → -37.0 |
| megara-night | -21.0 → -21.3 | -20.9 → -21.1 | -10.3 → -10.8 | -33.5 → -39.3 |
| penteli-day | -21.0 → -21.3 | -20.8 → -21.2 | -10.1 → -10.6 | -32.9 → -43.2 |
| penteli-night | -21.0 → -21.3 | -20.9 → -21.2 | -10.3 → -10.8 | -33.5 → -45.3 |

Full per-bus I/Smedian/Smax/true-peak logs, all 20-second clips and source snapshots: `.scratch/audio-mix/`. `render.mjs`, `measure.py` and the final `reparse.py` pass reproduce the measurements; `serve.py` serves the browser fixture/capture endpoint on port 8027. `long.mjs` renders three-minute stationary ambience per map. `world-audition.mp3` and `audition-index.json` provide a normalized source audition in file order. Audition normalization is for review only, never the game mix.

## Reference bus measurements

These are calibrated **pre-limiter stems**, not isolated normalized assets. Silence is excluded from the table; the full report contains all buses in all scenes.

| Bus / fixture | I before → after (LUFS) | Smax before → after (LUFS) | True peak before → after (dBTP) |
|---|---:|---:|---:|
| Engine, chase 100 | -21.2 → -21.2 | -20.7 → -20.7 | -11.6 → -11.6 |
| Tyres at limit | -25.6 → -25.7 | -25.1 → -25.3 | -15.2 → -14.7 |
| Ambience, chase 100 | -30.1 → -45.7 | -25.6 → -44.3 | -12.1 → -26.8 |
| Traffic, three vehicles | -27.1 → -27.1 | -27.1 → -26.9 | -16.5 → -15.9 |
| Rival passing | -37.4 → -37.4 | -34.8 → -34.8 | -24.0 → -24.0 |
| Police pass (traffic + siren) | -25.1 → -29.3 | -20.1 → -24.4 | -9.2 → -12.6 |
| Rain cockpit, tyre spray | -24.6 → -34.3 | -22.5 → -34.1 | -7.2 → -25.4 |
| UI click, menu | -38.6 → -43.5 | -47.4 → -52.2 | -22.3 → -27.2 |
| Music, normal race | -23.2 → -23.2 | -21.9 → -21.9 | -11.3 → -11.3 |

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

- Initial `npm test`: 67 passing tests, no failures. Final shared-checkout rerun: 66 pass / 1 failure in `tools/physics-test/manual.test.mjs:27` (frozen automatic trajectory at frame 59) while another owner had uncommitted `src/physics.js` changes. The same three manual tests pass against an isolated copy of committed HEAD (`committed-manual-test.log`). No physics files were changed by this work.
- `node --import ./tools/physics-test/register.mjs --test tools/*.test.mjs tools/events-test.mjs tools/maps-test.mjs tools/maps-resource-test.mjs tools/police-test.mjs tools/rivals-test.mjs tools/traffic-test.mjs`: Initial run: 84 passing tests. Final shared-checkout run: 85 passing tests, no failures (another test was added concurrently).
- Headless Chromium game smoke: Riviera → Megara → Penteli, all 37 audio assets available, rain/night transitions and **zero console/page errors** on every map (`browser-smoke.json`).
- `.scratch/audio-mix/checks.mjs`: coastline falloff/direction, inland silence, live map changes, speed masking, night/rain wildlife suppression and sparse-event cadence.
- Browser offline routing check: with all other buses muted, cabin rain/wipers remain audible (peak 0.0416); setting ambience to zero produces **exactly silent output** after the smoothing tail.
- Spectral review includes source files and before/after ambience/traffic stems. Three-minute renders check beyond the short excerpts and include sparse rural events.
- **Listening limitation:** this execution harness rejects audio input (`audio content omitted because you do not support audio input`). Rendered audition files are supplied, but no subjective listening sign-off is claimed. Loudness/spectral review does not substitute for listening on speakers/headphones.

## Spectral findings

The source sheets show the original insect band around 5–7 kHz, strong foreground voices in the café/beach recordings, and regular wiper strokes. In the scene comparisons the insect band is reduced, the foreground café/beach events disappear, cabin rain loses its bright hiss, and the siren harmonic ridge around 2–3 kHz is less prominent. Wiper cadence remains deliberately periodic; engine firing/tyre resonances are outside this ambience change.

The first 180-second Megara render exposed repeated whole-gust envelopes at roughly 25-second intervals. The follow-up changes only later farmland-wind excerpts to 10–21 seconds with randomized offsets and 3-second overlaps. Its first excerpt, and therefore the 20-second measurements above, are unchanged. The broad 24.7-second envelope-correlation peak drops from 0.43 to below the strongest remaining long-lag peak (0.22 at 40 seconds); the fixed-looking rise/fall sequence is absent in the refined spectrogram/RMS plot. Original and refined long renders/plots are retained under `.scratch/audio-mix/pre-refinement-*` and `long-*`.

Implementation commit: `288caf6`; wind refinement `11990a9`. No engine/tyre/Doppler synthesis or unrelated vehicle, camera, UI or gameplay changes were included.
