# Local Greek TTS evaluation — 2026-10-14

CPU only, one model process at a time, two inference threads. Each process exits
before the next loads; model RAM is released. Timings exclude download/install;
load and five-line inference are separate. Peak RSS includes the Python runtime.
Same five lines, in order: «Ρε μαλάκα!», «Τι κάνεις ρε;», «Πρόσεχε ρε!»,
«Παναγία μου!», «Τράβα δεξιά!». WAVs: `<model>/test-1.wav` … `test-5.wav`.

| Locally rendered model | Model / data licence | Generated-audio terms | Load seconds | Five-line wall / CPU seconds | Peak RSS MiB | Quality / Greek naturalness evidence |
|---|---|---|---:|---:|---:|---|
| eSpeak NG Greek | GPL-3.0 software and built-in voice data | eSpeak author says GPL does not cover speech output; no NC restriction | <0.001 | 0.094 / 0.091 child CPU | 50.1 (harness; child not measured separately) | Formant baseline, predictably mechanical; not selected for game |
| Piper el_GR-rapunzelina-low | MIT repository declaration; voice card's dataset CC0 | No separate output restriction stated; project output contribution CC0 to extent rights exist | 2.562 | 0.427 / 0.839 | 196.3 | Single female neural voice, 16 kHz / low tier; occasional missing combining-phoneme warnings; all five WAVs generated |
| Piper Chreece/el_GR-chreece-high | Apache-2.0 model; author recordings; lessac initialization | No separate output restriction stated; project output contribution CC0 to extent rights exist | 5.800 | 2.665 / 5.317 | 237.5 | Single male neural voice; despite 'high' architecture tier, author explicitly calls recording quality low; all five WAVs generated |
| facebook/mms-tts-ell | CC-BY-NC-4.0 model | No independent permissive output grant found; retain NC handling conservatively; comparison only | 9.991 | 3.381 / 6.499 | 601.4 | Greek-specific VITS, 16 kHz; five WAVs generated; excluded from shipped files by licence |

These are reproducible generation/resource comparisons, **not a blind native-Greek
listening study or a MOS score**. No human ear review was available in this run;
naturalness claims are limited to architecture/model-card information. Listen to
the matching WAVs before replacing actors or approving final Greek pronunciation.
Neutral TTS prosody cannot be claimed to sound like acted angry shouting.

## Candidates screened, not run (no timing/quality result claimed)

| Candidate | Model licence | Output licence/restriction | Reason |
|---|---|---|---|
| Coqui XTTS-v2 | Coqui Public Model License 1.0 | Explicitly noncommercial for both model and outputs, including indirect payment | Supports Greek but unsuitable for unrestricted shipping; no reference-voice cloning needed for this bank |
| Suno Bark | MIT | README permits commercial use of outputs | Greek absent from official supported-language list; large autoregressive CPU workload and unreliable language support for the required short Greek barks |
| Moira GreekTTS-1.5 | Apache-2.0 model declaration | No separate output restriction stated in model card | Newer Greek Orpheus/LoRA candidate; not benchmarked on this shared CPU host |

Several means **four rendered configurations / three synthesis families** here;
XTTS/Bark/Moira were licence/support screening only, and have no comparison WAVs.

## Shipped choice

Rapunzelina plus Chreece: two permissive local Greek neural models with complementary
voices. Four character treatments (male/female × younger/older pitch/rate), not four
independent trained speakers or validated ages. The catalogue contains 90 phrases across pedestrian, driver, near, police, rider. Street-artist lines and their 32 clips have been removed.
All 360 Ogg clips are edge-trimmed, targeted to -20 LUFS / -4 dBTP, mono 24 kHz. Source waveforms retained locally. Runtime downloads just the chosen
clip; cache holds at most 24 decoded clips. Nothing calls an online TTS service.

## Primary sources and licensing distinction

- [Rapunzelina individual model card](https://huggingface.co/rhasspy/piper-voices/blob/main/el/el_GR/rapunzelina/low/MODEL_CARD): CC0 is explicitly the **dataset** licence, not an explicit output licence.
- [Piper voice repository](https://huggingface.co/rhasspy/piper-voices): repository metadata MIT; individual voice details take precedence.
- [Chreece model card](https://huggingface.co/Chreece/el_GR-chreece-high): Apache-2.0 and recording-quality caveat.
- [MMS Greek model card](https://huggingface.co/facebook/mms-tts-ell): CC-BY-NC-4.0. We do not infer a freely shippable output grant from availability of weights.
- [XTTS actual CPML](https://huggingface.co/coqui/XTTS-v2/blob/main/LICENSE.txt): explicitly covers outputs and noncommercial use.
- [Bark README](https://github.com/suno-ai/bark): supported languages, MIT/commercial output statement.
- [Moira GreekTTS-1.5](https://huggingface.co/moiralabs/GreekTTS-1.5): newer model architecture and licence declaration.
- [eSpeak author's output clarification](https://sourceforge.net/p/espeak/discussion/538920/thread/c6944a60/): GPL does not apply to generated sound.

For permissive shipped models, no upstream output-specific restriction was found;
this is distinct from asserting that Apache/MIT/CC0 automatically licenses every
possible model output. CREDITS.txt preserves attribution, and sources.json records
ONNX hashes, output hashes, licences and generation settings.

## Police and impact extension — 2026-10-15

The original 50-phrase evaluation above is retained as historical evidence.
The bank now has 98 phrases / 392 clips: 22 new police cues, six new reactions
in each of driver/pedestrian/near/rider, and two short clean driver tap cues.
Rendered with the same local Rapunzelina and Chreece models, verified against
the recorded ONNX hashes. Police clips use a 420–3200 Hz band, mild tanh
soft clipping and the original -20 LUFS / -4 dBTP normalization after processing.
Regenerate only missing clips with `build_voice.py MODEL --final --new-only`;
all source text, English glosses and clean/explicit tags are in lines.json.
These remain synthetic voices with processed loudspeaker character; acted
shouting or native-listener pronunciation approval is not claimed.
