# Sound audit — 2026-10-20

Baseline: committed prod `acce71011c353e64300ff885fd8f8a26dc774bdb`, isolated worktree. Shared index/source untouched. Owner rules read from committed prod: no music, no SVJ pops, computer only.

## Method and limits

Actual Chromium OfflineAudioContext, stereo 44.1 kHz, seeded random source offsets, default game volumes. Graph updates occur during offline suspension at ~29 Hz (not all queued up front, which would invalidate BranchGate disconnections). Only the device-resume watchdog is bypassed because these suspensions are intentional. Engine clips: idle 0–1.5 s, loaded sweep 1.5–4 s, fixed-RPM low/high load 4–7 s, overrun 7–8 s, idle 8–10 s. Each `before-NAME.ogg` has an unnormalized level, `before-NAME.webp` spectrogram/waveform and caption. Float PCM is measured before lossy encoding; FFmpeg EBU R128 integrated LUFS and true peak, 2048-point Hann FFT centroid/high-band ratio, onset at 0.001 amplitude. Silence is reported by FFmpeg as -70 LUFS and is not a loudness estimate. Short one-shots have gating-sensitive LUFS: compare peak/envelope too.

Ratings are engineering/design judgments from the rendered envelopes/spectra and source, not a claim of owner listening approval. Long ambience repeat suppression is verified in source; 5–10 s clips cannot prove that a 20–60 s recording never repeats. Traffic and multiplayer peers share ExternalEngines; the peer clip uses that actual synthesis/panning path, not network transport. Tow/reset is a silence reference because recovery currently has no dedicated audio event. Handbrake tyre skid is audited separately from its absent mechanical control sound. Shift captures isolate the engine bus with no running voice.

## Before ratings (78 initial cases rendered before production edits)

| Sound / clip stem | Rating | LUFS | Peak dBFS | Reason |
|---|---|---:|---:|---|
| birds | good | -52.9 | -40.3 | Appropriate envelope and spectral role; restrained relative to engine. Retain existing character and independent bus controls. |
| cicadas | good | -46.7 | -36.1 | Appropriate envelope and spectral role; restrained relative to engine. Retain existing character and independent bus controls. |
| city | good | -56.6 | -43.0 | Appropriate envelope and spectral role; restrained relative to engine. Retain existing character and independent bus controls. |
| damage-rattle | weak | -67.2 | -54.6 | Maximum rear damage is approximately -67 LUFS through the tyre/cabin bus; feedback is masked. |
| engine-bike | weak | -25.4 | -15.0 | Usable firing-order character; on-load layer reaches full contribution too early (42% load). |
| engine-bus | weak | -22.8 | -12.7 | Usable firing-order character; on-load layer reaches full contribution too early (42% load). |
| engine-city4 | weak | -19 | -11.7 | Usable firing-order character; on-load layer reaches full contribution too early (42% load). |
| engine-comfort4 | good | -22.2 | -10.1 | Distinct recorded family, smooth RPM crossfades and load-sensitive level/filter; SVJ profile suppresses pops. |
| engine-diesel | good | -25 | -10.1 | Distinct recorded family, smooth RPM crossfades and load-sensitive level/filter; SVJ profile suppresses pops. |
| engine-electric | weak | -32 | -21.3 | Usable firing-order character; on-load layer reaches full contribution too early (42% load). |
| engine-fiat4 | good | -22.6 | -11.9 | Distinct recorded family, smooth RPM crossfades and load-sensitive level/filter; SVJ profile suppresses pops. |
| engine-flat6 | good | -19.7 | -8.9 | Distinct recorded family, smooth RPM crossfades and load-sensitive level/filter; SVJ profile suppresses pops. |
| engine-hot4 | good | -20.9 | -8.7 | Distinct recorded family, smooth RPM crossfades and load-sensitive level/filter; SVJ profile suppresses pops. |
| engine-na3 | weak | -19.8 | -11.5 | Usable firing-order character; on-load layer reaches full contribution too early (42% load). |
| engine-na4 | weak | -16.8 | -10.0 | Outlier loudness; procedural load blend saturates at 42% rather than full load. |
| engine-na6 | weak | -15.2 | -11.7 | Outlier loudness; procedural load blend saturates at 42% rather than full load. |
| engine-small4 | good | -21.1 | -10.4 | Distinct recorded family, smooth RPM crossfades and load-sensitive level/filter; SVJ profile suppresses pops. |
| engine-svj | good | -20 | -11.2 | Distinct recorded family, smooth RPM crossfades and load-sensitive level/filter; SVJ profile suppresses pops. |
| engine-turbo3 | weak | -24 | -13.0 | Usable firing-order character; on-load layer reaches full contribution too early (42% load). |
| engine-turbo4 | good | -20.8 | -8.5 | Distinct recorded family, smooth RPM crossfades and load-sensitive level/filter; SVJ profile suppresses pops. |
| engine-turbo5 | weak | -22.4 | -12.4 | Usable firing-order character; on-load layer reaches full contribution too early (42% load). |
| engine-turbo6 | good | -21.4 | -11.1 | Distinct recorded family, smooth RPM crossfades and load-sensitive level/filter; SVJ profile suppresses pops. |
| engine-turbov12 | good | -21.5 | -11.2 | Distinct recorded family, smooth RPM crossfades and load-sensitive level/filter; SVJ profile suppresses pops. |
| engine-turbov6 | weak | -25.2 | -13.8 | Usable firing-order character; on-load layer reaches full contribution too early (42% load). |
| engine-turbov8 | weak | -26.8 | -14.5 | Usable firing-order character; on-load layer reaches full contribution too early (42% load). |
| engine-v10 | weak | -19.1 | -12.1 | Usable firing-order character; on-load layer reaches full contribution too early (42% load). |
| engine-v12 | good | -19.2 | -10.5 | Distinct recorded family, smooth RPM crossfades and load-sensitive level/filter; SVJ profile suppresses pops. |
| engine-v6 | weak | -19.9 | -12.7 | Usable firing-order character; on-load layer reaches full contribution too early (42% load). |
| engine-v8 | weak | -22.1 | -12.2 | Usable firing-order character; on-load layer reaches full contribution too early (42% load). |
| engine-v8flat | weak | -15.4 | -11.9 | Outlier loudness; procedural load blend saturates at 42% rather than full load. |
| engine-v8na | weak | -21.8 | -12.1 | Usable firing-order character; on-load layer reaches full contribution too early (42% load). |
| engine-van | good | -25.5 | -10.5 | Distinct recorded family, smooth RPM crossfades and load-sensitive level/filter; SVJ profile suppresses pops. |
| handbrake-control | bad | -70 | -183.9 | Dedicated control/confirmation effect is missing (silence reference; no API at baseline). |
| horn-bike | good | -36.9 | -27.1 | Appropriate envelope and spectral role; restrained relative to engine. Retain existing character and independent bus controls. |
| horn-bus | good | -30.8 | -21.8 | Appropriate envelope and spectral role; restrained relative to engine. Retain existing character and independent bus controls. |
| horn-car | good | -32.1 | -23.1 | Appropriate envelope and spectral role; restrained relative to engine. Retain existing character and independent bus controls. |
| ignition-reset | good | -20 | -5.1 | Appropriate envelope and spectral role; restrained relative to engine. Retain existing character and independent bus controls. |
| impact-fallback | bad | -31.8 | -15.6 | Recorded impact floor obscures severity; glass/high-frequency attack is exposed. Scrapes retrigger bursts rather than sustain. |
| impact-glass | bad | -28.1 | -12.0 | Recorded impact floor obscures severity; glass/high-frequency attack is exposed. Scrapes retrigger bursts rather than sustain. |
| impact-heavy | bad | -23.8 | -10.1 | Recorded impact floor obscures severity; glass/high-frequency attack is exposed. Scrapes retrigger bursts rather than sustain. |
| impact-light | bad | -34.4 | -20.7 | Recorded impact floor obscures severity; glass/high-frequency attack is exposed. Scrapes retrigger bursts rather than sustain. |
| impact-medium | bad | -30.4 | -15.6 | Recorded impact floor obscures severity; glass/high-frequency attack is exposed. Scrapes retrigger bursts rather than sustain. |
| impact-zero | bad | -35.5 | -21.7 | Recorded impact floor obscures severity; glass/high-frequency attack is exposed. Scrapes retrigger bursts rather than sustain. |
| mix | good | -19 | -7.4 | Appropriate envelope and spectral role; restrained relative to engine. Retain existing character and independent bus controls. |
| mix-low | good | -19 | -6.8 | Appropriate envelope and spectral role; restrained relative to engine. Retain existing character and independent bus controls. |
| mix-stall | good | -19 | -7.4 | Appropriate envelope and spectral role; restrained relative to engine. Retain existing character and independent bus controls. |
| mountain | good | -43.5 | -32.1 | Appropriate envelope and spectral role; restrained relative to engine. Retain existing character and independent bus controls. |
| night | good | -48.6 | -40.0 | Appropriate envelope and spectral role; restrained relative to engine. Retain existing character and independent bus controls. |
| peers | good | -41.8 | -27.2 | Appropriate envelope and spectral role; restrained relative to engine. Retain existing character and independent bus controls. |
| rain-cabin | good | -51.8 | -37.7 | Appropriate envelope and spectral role; restrained relative to engine. Retain existing character and independent bus controls. |
| rain-heavy | good | -45 | -29.4 | Appropriate envelope and spectral role; restrained relative to engine. Retain existing character and independent bus controls. |
| rain-light | good | -58.2 | -39.4 | Appropriate envelope and spectral role; restrained relative to engine. Retain existing character and independent bus controls. |
| roll-asphalt | weak | -58.8 | -45.6 | Rolling body is too far below the engine at road speed. |
| roll-cobbles | bad | -59.2 | -45.8 | No cobble-specific texture: same rolling parameters as asphalt. |
| roll-grass | good | -49 | -38.0 | Appropriate envelope and spectral role; restrained relative to engine. Retain existing character and independent bus controls. |
| roll-gravel | good | -47.2 | -36.1 | Appropriate envelope and spectral role; restrained relative to engine. Retain existing character and independent bus controls. |
| scrape-rail | bad | -45.1 | -30.5 | Recorded impact floor obscures severity; glass/high-frequency attack is exposed. Scrapes retrigger bursts rather than sustain. |
| scrape-wall | bad | -45.1 | -30.5 | Recorded impact floor obscures severity; glass/high-frequency attack is exposed. Scrapes retrigger bursts rather than sustain. |
| sea-rocks | good | -46 | -28.9 | Appropriate envelope and spectral role; restrained relative to engine. Retain existing character and independent bus controls. |
| sea-sand | good | -45.3 | -25.2 | Appropriate envelope and spectral role; restrained relative to engine. Retain existing character and independent bus controls. |
| shift-auto | weak | -64.5 | -41.7 | Thin highpass click: ~70% of spectral energy above 6 kHz, very short and weightless. |
| shift-dct | weak | -64.5 | -41.7 | Thin highpass click: ~70% of spectral energy above 6 kHz, very short and weightless. |
| shift-manual | good | -55.1 | -34.2 | Appropriate envelope and spectral role; restrained relative to engine. Retain existing character and independent bus controls. |
| signals | good | -52.2 | -30.9 | Appropriate envelope and spectral role; restrained relative to engine. Retain existing character and independent bus controls. |
| stress | bad | -10.9 | 0.8 | Float output exceeds full scale: compressor alone does not guarantee a ceiling. |
| tow-reset | bad | -70 | -183.9 | Dedicated control/confirmation effect is missing (silence reference; no API at baseline). |
| traffic | good | -41.8 | -27.2 | Appropriate envelope and spectral role; restrained relative to engine. Retain existing character and independent bus controls. |
| turbo-flutter | good | -16.1 | -12.4 | Appropriate envelope and spectral role; restrained relative to engine. Retain existing character and independent bus controls. |
| turbo-lift | good | -19.5 | -8.5 | Appropriate envelope and spectral role; restrained relative to engine. Retain existing character and independent bus controls. |
| tyre-corner | good | -35.9 | -26.2 | Appropriate envelope and spectral role; restrained relative to engine. Retain existing character and independent bus controls. |
| tyre-handbrake | good | -34.2 | -25.4 | Appropriate envelope and spectral role; restrained relative to engine. Retain existing character and independent bus controls. |
| tyre-lock | good | -31.5 | -22.6 | Appropriate envelope and spectral role; restrained relative to engine. Retain existing character and independent bus controls. |
| ui-countdown | good | -30.5 | -21.5 | Appropriate envelope and spectral role; restrained relative to engine. Retain existing character and independent bus controls. |
| ui-lose | bad | -39.4 | -25.9 | Long pitched fanfare/trombone phrase conflicts with the restrained no-music direction. |
| ui-navigation | good | -47 | -30.7 | Appropriate envelope and spectral role; restrained relative to engine. Retain existing character and independent bus controls. |
| ui-win | bad | -32.3 | -20.4 | Long pitched fanfare/trombone phrase conflicts with the restrained no-music direction. |
| wind-cabin | weak | -57.9 | -46.2 | Too far below engine at road speed; fixed sine gust repeats every 7.7 seconds. |
| wind-open | weak | -49.1 | -35.0 | Too far below engine at road speed; fixed sine gust repeats every 7.7 seconds. |

## Priority

1. Impact severity, continuous contact, bounded mix ceiling and softer upper spectrum.
2. Progressive engine load and family balance; rolling/wind texture; understated mechanical feedback and non-musical result sounds.

Existing slow-frame protections stay: k-rate filters, branch gating, 30 Hz world updates, 20/32 one-shot limits plus critical reserve, 3/6 detailed external voices, four/six squeal modes and short/full reverb. No added recordings. Lasting damage/repair rules are unchanged.

## Fix 1: impact/contact and output mix

- Zero severity is silent; all impact layers scale with severity. Gentle contacts lose the bright fixed sample-gain floor, while major hits keep the bass body. Glass and metal are filtered; procedural fallback uses the same energy scale.
- Sustained scrapes reuse one long noise buffer/source with body and material resonances, smoothly extend the envelope and stop automatically after contact ends. Physics scrapeDv now drives this texture, with guardrail material retained; traffic body contact uses the metal resonance. No damage calculations changed.
- Output compressor plus a smooth bounded ceiling and -3 dB high shelf at 4.5 kHz. Calibration offsets compressor makeup gain. Original volume sliders and menu duck remain.
- Evidence: impacts-*.ogg, matching waveforms/spectrograms and impacts-metrics.json; comparison images posted to /home/dev/data/agent-feed/sound-design/impacts-*.webp with captions. Stress true peak: -1.7 dBFS (before +0.8 dBFS sample peak). Wall scrape: one source instead of 116 burst voices.

## Fix 2: engine balance, road feel and mechanical feedback

- Procedural on/off-load blend now spans the full load range instead of saturating at 42%. Existing intake and recorded-engine load filtering remain. Flat-plane V8, NA inline-six and NA inline-four gain trims bring their scripted drive near -20 LUFS without replacing their voices.
- Asphalt gains a low rolling body; cobbles/pavers gain a rougher rolling filter and speed-linked, slightly irregular rumble from the existing wheel voices. Gravel and grass retain their distinct noise textures; no new squeal on soft ground.
- Wind uses overlapping random excerpts and irregular gain targets instead of a fixed sine swell. High-speed wind remains behind the engine, with cabin/open-camera separation. A supplemental 45-second before render reads historical prod source through the capture server; this explicitly checks beyond the original recording loop.
- DCT/automatic shifts have a filtered actuator click and short low engagement body. Manual mechanics are retained. Damaged exhaust gains an audible but restrained metallic rattle on the engine bus, rate-limited in audio time; no repair or damage-rule changes. Rattle evidence isolates the layer by disconnecting intake/turbo/whine branches.
- Handbrake adds a cabin-only control-edge detent, never repeated while held. Successful tow/reset adds a brief confirmation, with no engine restart. Win/loss/finish/game-over fanfares become two short non-musical UI transients.
- Music remains absent and the SVJ profile still has zero pops. No downloaded/bundled audio is added.

## Final measurements

Each entry links the before and after clip by its shared stem; images use the same names with .webp. All clips retain the game output level.

| Case | Before LUFS | After LUFS | Before peak | After peak |
|---|---:|---:|---:|---:|
| birds | -52.9 | -60.4 | -40.3 | -49.1 |
| cicadas | -46.7 | -48.6 | -36.1 | -37.6 |
| city | -56.6 | -57.4 | -43.0 | -43.3 |
| damage-rattle | -67.2 | -54.1 | -54.6 | -30.9 |
| engine-bike | -25.4 | -25.3 | -15.0 | -15.5 |
| engine-bus | -22.8 | -23.6 | -12.7 | -13.1 |
| engine-city4 | -19 | -18.7 | -11.7 | -12.0 |
| engine-comfort4 | -22.2 | -22.4 | -10.1 | -9.8 |
| engine-diesel | -25 | -25.2 | -10.1 | -9.7 |
| engine-electric | -32 | -32.5 | -21.3 | -21.5 |
| engine-fiat4 | -22.6 | -22.7 | -11.9 | -11.8 |
| engine-flat6 | -19.7 | -19.5 | -8.9 | -9.4 |
| engine-hot4 | -20.9 | -21.2 | -8.7 | -8.5 |
| engine-na3 | -19.8 | -19.6 | -11.5 | -11.6 |
| engine-na4 | -16.8 | -20 | -10.0 | -13.1 |
| engine-na6 | -15.2 | -20.7 | -11.7 | -16.3 |
| engine-small4 | -21.1 | -21.2 | -10.4 | -10.3 |
| engine-svj | -20 | -19.9 | -11.2 | -11.0 |
| engine-turbo3 | -24 | -24 | -13.0 | -13.3 |
| engine-turbo4 | -20.8 | -20.8 | -8.5 | -8.4 |
| engine-turbo5 | -22.4 | -22.6 | -12.4 | -12.6 |
| engine-turbo6 | -21.4 | -22.4 | -11.1 | -10.5 |
| engine-turbov12 | -21.5 | -21.5 | -11.2 | -11.4 |
| engine-turbov6 | -25.2 | -25.4 | -13.8 | -13.7 |
| engine-turbov8 | -26.8 | -27.2 | -14.5 | -14.7 |
| engine-v10 | -19.1 | -20 | -12.1 | -13.8 |
| engine-v12 | -19.2 | -19.1 | -10.5 | -10.3 |
| engine-v6 | -19.9 | -20.3 | -12.7 | -13.3 |
| engine-v8 | -22.1 | -22.8 | -12.2 | -13.2 |
| engine-v8flat | -15.4 | -19.7 | -11.9 | -15.7 |
| engine-v8na | -21.8 | -22.5 | -12.1 | -12.8 |
| engine-van | -25.5 | -25.7 | -10.5 | -10.2 |
| handbrake-control | -70 | -56.6 | -183.9 | -37.1 |
| horn-bike | -36.9 | -38.6 | -27.1 | -28.4 |
| horn-bus | -30.8 | -30.9 | -21.8 | -21.8 |
| horn-car | -32.1 | -32.5 | -23.1 | -23.3 |
| ignition-reset | -20 | -21 | -5.1 | -6.1 |
| impact-fallback | -31.8 | -29.5 | -15.6 | -13.5 |
| impact-glass | -28.1 | -31.6 | -12.0 | -12.2 |
| impact-heavy | -23.8 | -28 | -10.1 | -9.4 |
| impact-light | -34.4 | -47 | -20.7 | -31.0 |
| impact-medium | -30.4 | -35.8 | -15.6 | -19.7 |
| impact-zero | -35.5 | -70 | -21.7 | -120.0 |
| mix | -19 | -19 | -7.4 | -7.1 |
| mix-low | -19 | -19 | -6.8 | -7.2 |
| mix-stall | -19 | -19 | -7.4 | -7.1 |
| mountain | -43.5 | -44.7 | -32.1 | -33.9 |
| night | -48.6 | -49.7 | -40.0 | -41.3 |
| peers | -41.8 | -43.1 | -27.2 | -29.0 |
| rain-cabin | -51.8 | -50.4 | -37.7 | -32.7 |
| rain-heavy | -45 | -46 | -29.4 | -32.8 |
| rain-light | -58.2 | -58.4 | -39.4 | -40.7 |
| roll-asphalt | -58.8 | -49.6 | -45.6 | -36.7 |
| roll-cobbles | -59.2 | -42.1 | -45.8 | -32.2 |
| roll-grass | -49 | -47.1 | -38.0 | -35.4 |
| roll-gravel | -47.2 | -46.2 | -36.1 | -34.6 |
| scrape-rail | -45.1 | -27.4 | -30.5 | -16.2 |
| scrape-wall | -45.1 | -27.5 | -30.5 | -16.3 |
| sea-rocks | -46 | -48.9 | -28.9 | -33.7 |
| sea-sand | -45.3 | -45.5 | -25.2 | -25.5 |
| shift-auto | -64.5 | -58.5 | -41.7 | -37.6 |
| shift-dct | -64.5 | -58.5 | -41.7 | -37.6 |
| shift-manual | -55.1 | -54.9 | -34.2 | -33.6 |
| signals | -52.2 | -52.2 | -30.9 | -30.9 |
| stress | -10.9 | -11.4 | 0.8 | -1.7 |
| tow-reset | -70 | -54.2 | -183.9 | -35.8 |
| traffic | -41.8 | -43.1 | -27.2 | -29.0 |
| turbo-flutter | -16.1 | -16.4 | -12.4 | -12.6 |
| turbo-lift | -19.5 | -19.5 | -8.5 | -8.4 |
| tyre-corner | -35.9 | -36 | -26.2 | -26.4 |
| tyre-handbrake | -34.2 | -34.5 | -25.4 | -26.1 |
| tyre-lock | -31.5 | -31.9 | -22.6 | -22.8 |
| ui-countdown | -30.5 | -30.6 | -21.5 | -21.5 |
| ui-lose | -39.4 | -49.4 | -25.9 | -31.4 |
| ui-navigation | -47 | -47 | -30.7 | -30.6 |
| ui-win | -32.3 | -48.2 | -20.4 | -31.9 |
| wind-cabin | -57.9 | -44.1 | -46.2 | -32.3 |
| wind-long | -48.4 | -38.6 | -32.8 | -25.4 |
| wind-open | -49.1 | -38.7 | -35.0 | -26.0 |

## Reproduce

Run the repository browser-slot wrapper with `node .scratch/sound-design-2026-10-20/render.mjs PREFIX TEMP_RAW_DIR [CASE_REGEX]`; then `node .scratch/sound-design-2026-10-20/analyze.mjs PREFIX TEMP_RAW_DIR`. Set SOUND_BASE_REF=acce7101 to serve baseline source from git without touching the checkout. Playwright uses the existing repository-documented shared install. FFmpeg encodes Ogg and WebP; no downloaded analysis dependencies. The runner closes its server/browser in finally. The after snapshot includes 79 cases (78 short scenes and one 45-second wind scene).

The first commit is 2e530290. Full npm test on its exact staged tree: 260 files, 2332 passes, 12 existing default-suite skips, 0 failures; standalone physics 1323 passes, browser imports and syntax passed. The second commit is validated by the full suite and release-fast gates before landing; see final validation report and thread summary for its SHA/results. Offline timing is not a certification of any particular laptop; structural low-cost budgets remain in place.

Audio-module bundle measurement (esbuild bundled/minified ESM, gzip): baseline 75,291 / 26,087 bytes; final values in bundle-growth.json. Evidence is excluded from the game asset bundle. No new runtime audio assets.

## Additional event coverage

See [SUPPLEMENT.md](SUPPLEMENT.md) for 41 further event scenarios, including police radio/sirens, suspension/kerb sounds, pedestrian reactions, horns, rural details and remaining UI call sites. Combined coverage is 120 before/after scenarios. A third focused change removes the remaining police/near-miss/position plucked phrases; radio timing and passing-air cues remain. Final validation and commit IDs are recorded in the owner feed report.
