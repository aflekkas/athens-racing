# Vehicle audio review evidence

Rendered in the T3 collaborative Chromium browser using the production WebAudio
modules and `OfflineAudioContext`, stereo PCM16, 44.1 kHz. These are game-mix
review demonstrations, not reusable asset-library releases.

- `mini-startup-rev-shifts.wav`: CC0 recorded turbo I4 starter, idle flare,
  acceleration, limiter, manual lever/clutch, lift/overrun and shutdown.
- `taxi-startup-rev-shifts.wav`: attributed diesel I4 starter/running substitutes.
- `e36_m3-startup-rev-shifts.wav`: NA I6 fallback, starter/catch, manual up/down
  lever and clutch movement, high revs and shutdown.
- `huracan-startup-rev-shifts.wav`: NA V10 fallback, starter/catch, DCT shifting.
- `doppler-passby.wav`: 35 m/s pass at 5 m lateral separation, manually computed
  Doppler and camera-relative stereo pan. No built-in WebAudio Doppler.
- `rival-pack.wav`: four contrasting independently profiled engines passing in
  sequence, with separate distance/air-absorption/pitch controls.
- `manual-mechanics-cockpit.wav` / `manual-mechanics-chase.wav`: isolated up,
  down and fast manual shifts, including lever detent and pedal/bearing release.
  No grind is simulated because the current physics has no failed-clutch signal.

Levels are in `capture-levels.json`. No clipped samples; highest capture peak
is -4.1 dBFS. Four startup/rev sequences are within 3.1 dB whole-clip RMS. The
isolated chase mechanical capture is approximately 24.5 dB quieter in whole-clip
RMS (short randomized events and PCM16 quantization affect the exact difference).

## Performance measurement

`cpu.json` records three alternating before/after runs of the complete audio
manager, 239 scheduled updates and 4 seconds of offline stereo audio per run,
with eight rival and eight traffic candidates. Baseline: `bb20050b03d85e4fa18711c50f53589e2c4c938c`.
Median JS update scheduling: **1.244 ms before → 0.918 ms after**. Median offline
render wall time: **8.115 s before → 5.993 s after**. This shared environment was
heavily contended; these are measured wall-time cost proxies, not isolated audio
thread CPU percentages or a real-time performance guarantee. Preserve all runs,
including the after run that was slower, rather than claiming uniform speedup.
Preparation/decode time is excluded from the update loop measurement. The new
engine loop removes steady-state temporary weight arrays and nearest-list sorts.

## Reproduce

From a clean isolated checkout, copy the two baseline modules from the commit
above into `src/audio-baseline.js` and `src/engine-recordings-baseline.js`; change
only the former's relative recordings import to `./engine-recordings-baseline.js`.
Run `python3 tools/vehicle-audio-server.py`, visit
`http://localhost:8767/tools/vehicle-audio-capture.html`, then call `runEvidence()`
in the browser developer console. The local receiver writes the WAV/JSON files
here. `runBenchmarks()` reruns only timing. Baseline modules are deliberately not
committed to the production import graph. The fixture advances a JS getter for
offline `currentTime` so one-shot start/stop times match scheduled frames.

## Licence

No new source audio was downloaded. MINI source and substitute petrol ignition:
CC0 (TheLittleCrow / sound_catcher99). Diesel idle/start: **Loffy, CC BY 3.0**,
[original](https://freesound.org/people/Loffy/sounds/89948/),
[licence](https://creativecommons.org/licenses/by/3.0/); cropped, filtered,
converted to mono and looped as documented in the asset credits. BMW I6 and
running diesel: existing Sonniss GDC game-use licence, not a sound-library
redistribution licence. Starter fallback, mechanical shifts, pops and whoosh are
original procedural synthesis. See `assets/audio/engines/CREDITS.txt` and
`sources.json` for exact source attribution, transformations and licence URLs.

Every trim's profile is listed in `src/audio/README.md`. Voice code is unchanged.
