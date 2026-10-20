# Supplemental event audit

The original 78-case audit and long wind check cover the requested engine, road, damage, mix and ambience families. A final call-site review found 41 additional event scenarios. These were rendered from historical prod `acce7101`; the police, near-miss and position-gain captures preceded edits to those methods. Finish/game-over share the already-replaced win/loss effect family. This supplement records that coverage timing explicitly.

Same measurement method as AUDIT.md: actual output level, EBU R128/true peak, spectrum, onset and waveform. Ratings are engineering judgments, not owner audition approval. Unchanged ambience/sirens retain existing low scheduling and voice budgets; intentional siren modulation and wiper cycles are not treated as accidental looping. Café/beach beds remain disabled by existing design.

| Case | Before rating | LUFS | Peak dBFS | Reason |
|---|---|---:|---:|---|
| airbrake | good | -47.2 | -35.8 | Bounded level and onset; fits its brief mechanical/environmental role below the engine. Retain character. |
| cat | good | -28.2 | -17.6 | Brief formant reaction with bounded peak; stylized procedural character, no continuous fatiguing layer. |
| countdown-tick | good | -35.4 | -20.8 | Bounded level and onset; fits its brief mechanical/environmental role below the engine. Retain character. |
| curb | good | -39.4 | -20.7 | Bounded level and onset; fits its brief mechanical/environmental role below the engine. Retain character. |
| distant-dog | good | -60.8 | -41.4 | Quiet, filtered environmental detail; recorded excerpts and long irregular event spacing retained. |
| distant-tractor | good | -53.9 | -38.6 | Quiet, filtered environmental detail; recorded excerpts and long irregular event spacing retained. |
| dog | good | -33.1 | -18.5 | Brief formant reaction with bounded peak; stylized procedural character, no continuous fatiguing layer. |
| exhaust-crackle | good | -56.1 | -34.4 | Bounded level and onset; fits its brief mechanical/environmental role below the engine. Retain character. |
| exhaust-pop | good | -45.9 | -27.7 | Bounded level and onset; fits its brief mechanical/environmental role below the engine. Retain character. |
| gear-clunk | good | -59.0 | -40.1 | Bounded level and onset; fits its brief mechanical/environmental role below the engine. Retain character. |
| gull | good | -51.0 | -38.8 | Quiet, filtered environmental detail; recorded excerpts and long irregular event spacing retained. |
| horn-fallback | good | -53.2 | -37.3 | Bounded level and onset; fits its brief mechanical/environmental role below the engine. Retain character. |
| horn-long | good | -31.9 | -23.2 | Bounded level and onset; fits its brief mechanical/environmental role below the engine. Retain character. |
| horn-taxi | good | -32.3 | -22.9 | Bounded level and onset; fits its brief mechanical/environmental role below the engine. Retain character. |
| moped | good | -49.8 | -34.1 | Bounded level and onset; fits its brief mechanical/environmental role below the engine. Retain character. |
| near-miss | weak | -37.5 | -24.6 | Pitched pluck competes with passing air; retain the air cue alone. |
| nitro | good | -34.5 | -20.2 | Bounded level and onset; fits its brief mechanical/environmental role below the engine. Retain character. |
| object-chairs | good | -43.1 | -26.2 | Bounded level and onset; fits its brief mechanical/environmental role below the engine. Retain character. |
| object-pickup | good | -51.3 | -33.6 | Bounded level and onset; fits its brief mechanical/environmental role below the engine. Retain character. |
| pass-by | good | -51.2 | -35.8 | Bounded level and onset; fits its brief mechanical/environmental role below the engine. Retain character. |
| police-busted | bad | -35.1 | -20.3 | Three-note falling phrase; retain radio and replace phrase with brief result effect. |
| police-evaded | bad | -33.0 | -21.5 | Five-note plucked phrase; retain radio and replace phrase with brief result effect. |
| police-radio | good | -35.4 | -22.7 | Bounded level and onset; fits its brief mechanical/environmental role below the engine. Retain character. |
| position-gain | weak | -36.8 | -23.3 | Two plucked notes for a position change; use the existing brief UI click. |
| rural | good | -56.0 | -43.7 | Quiet, filtered environmental detail; recorded excerpts and long irregular event spacing retained. |
| siren-hilo | good | -44.1 | -38.6 | Band-limited alert with continuous intentional frequency modulation; stays below the player engine at the captured distance. |
| siren-wail | good | -42.4 | -38.7 | Band-limited alert with continuous intentional frequency modulation; stays below the player engine at the captured distance. |
| siren-yelp | good | -33.6 | -29.9 | Band-limited alert with continuous intentional frequency modulation; stays below the player engine at the captured distance. |
| suspension-thump | good | -48.3 | -30.1 | Bounded level and onset; fits its brief mechanical/environmental role below the engine. Retain character. |
| tram-bell | good | -50.4 | -36.4 | Bounded level and onset; fits its brief mechanical/environmental role below the engine. Retain character. |
| ui-down | good | -47.1 | -30.5 | Bounded level and onset; fits its brief mechanical/environmental role below the engine. Retain character. |
| ui-finish | bad | -28.2 | -15.2 | Long note sequence; covered by the second commit result-effect replacement. |
| ui-gameover | bad | -38.8 | -25.2 | Long falling note sequence; covered by the second commit result-effect replacement. |
| voice-opa | good | -26.9 | -15.5 | Brief formant reaction with bounded peak; stylized procedural character, no continuous fatiguing layer. |
| voice-scream | good | -20.9 | -14.1 | Brief formant reaction with bounded peak; stylized procedural character, no continuous fatiguing layer. |
| voice-shout-0 | good | -32.2 | -17.9 | Brief formant reaction with bounded peak; stylized procedural character, no continuous fatiguing layer. |
| voice-shout-1 | good | -30.9 | -17.1 | Brief formant reaction with bounded peak; stylized procedural character, no continuous fatiguing layer. |
| voice-shout-2 | good | -31.3 | -19.1 | Brief formant reaction with bounded peak; stylized procedural character, no continuous fatiguing layer. |
| voice-shout-3 | good | -32.9 | -20.6 | Brief formant reaction with bounded peak; stylized procedural character, no continuous fatiguing layer. |
| voice-shout-4 | good | -33.1 | -19.1 | Brief formant reaction with bounded peak; stylized procedural character, no continuous fatiguing layer. |
| whistle | good | -39.9 | -32.1 | Bounded level and onset; fits its brief mechanical/environmental role below the engine. Retain character. |

Each case has `extra-before-NAME.ogg` and `extra-after-NAME.ogg`, with matching `.webp` spectrogram/waveforms and one-line `.txt` captions. Full spectral/onset values are in `extra-before-metrics.json` and `extra-after-metrics.json`.

Reproduce with `SOUND_BASE_REF=acce7101 bash tools/browser-slot.sh node .scratch/sound-design-2026-10-20/supplement-render.mjs extra-before TEMP_RAW_DIR` and omit SOUND_BASE_REF for extra-after; use analyze.mjs with the corresponding prefix.

## Supplemental after measurements

| Case | Before LUFS | After LUFS | Before peak | After peak |
|---|---:|---:|---:|---:|
| airbrake | -47.2 | -49.5 | -35.8 | -38.2 |
| cat | -28.2 | -28.1 | -17.6 | -17.5 |
| countdown-tick | -35.4 | -35.4 | -20.8 | -20.7 |
| curb | -39.4 | -39.8 | -20.7 | -22.1 |
| distant-dog | -60.8 | -61.8 | -41.4 | -41.3 |
| distant-tractor | -53.9 | -55.6 | -38.6 | -41.4 |
| dog | -33.1 | -33.1 | -18.5 | -18.4 |
| exhaust-crackle | -56.1 | -54.5 | -34.4 | -31.2 |
| exhaust-pop | -45.9 | -45.5 | -27.7 | -26.7 |
| gear-clunk | -59.0 | -59.0 | -40.1 | -40.2 |
| gull | -51.0 | -39.6 | -38.8 | -22.6 |
| horn-fallback | -53.2 | -54.5 | -37.3 | -38.4 |
| horn-long | -31.9 | -31.7 | -23.2 | -23.2 |
| horn-taxi | -32.3 | -33.0 | -22.9 | -23.4 |
| moped | -49.8 | -50.0 | -34.1 | -35.8 |
| near-miss | -37.5 | -44.8 | -24.6 | -27.3 |
| nitro | -34.5 | -34.5 | -20.2 | -20.1 |
| object-chairs | -43.1 | -42.9 | -26.2 | -26.3 |
| object-pickup | -51.3 | -52.4 | -33.6 | -30.5 |
| pass-by | -51.2 | -51.1 | -35.8 | -35.0 |
| police-busted | -35.1 | -34.2 | -20.3 | -20.4 |
| police-evaded | -33.0 | -36.3 | -21.5 | -25.1 |
| police-radio | -35.4 | -34.5 | -22.7 | -22.7 |
| position-gain | -36.8 | -47.0 | -23.3 | -30.6 |
| rural | -56.0 | -54.7 | -43.7 | -41.3 |
| siren-hilo | -44.1 | -44.1 | -38.6 | -38.7 |
| siren-wail | -42.4 | -42.4 | -38.7 | -38.7 |
| siren-yelp | -33.6 | -33.6 | -29.9 | -29.8 |
| suspension-thump | -48.3 | -48.1 | -30.1 | -31.8 |
| tram-bell | -50.4 | -51.8 | -36.4 | -36.4 |
| ui-down | -47.1 | -47.1 | -30.5 | -30.4 |
| ui-finish | -28.2 | -48.2 | -15.2 | -31.9 |
| ui-gameover | -38.8 | -49.4 | -25.2 | -31.4 |
| voice-opa | -26.9 | -28.7 | -15.5 | -16.8 |
| voice-scream | -20.9 | -21.3 | -14.1 | -14.3 |
| voice-shout-0 | -32.2 | -32.1 | -17.9 | -17.8 |
| voice-shout-1 | -30.9 | -30.8 | -17.1 | -17.0 |
| voice-shout-2 | -31.3 | -31.2 | -19.1 | -19.0 |
| voice-shout-3 | -32.9 | -32.9 | -20.6 | -20.5 |
| voice-shout-4 | -33.1 | -33.0 | -19.1 | -19.1 |
| whistle | -39.9 | -40.2 | -32.1 | -32.5 |
