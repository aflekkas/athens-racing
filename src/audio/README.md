# Vehicle audio

`audio.js` retains the mix, tyres, world effects and public API. Voice/music
ownership is unchanged. Vehicle audio is split into:

- `engine-profiles.js`: cached, audio-only trim/layout selection and gearbox sound
  type. Explicit powertrain gearbox metadata takes precedence over legacy IDs.
- `engine-synth.js`: four RPM × two load fallback layers and firing-order models.
  These are approximations, not recordings of the named cars.
- `../engine-recordings.js`: licensed sample selection, shared decode cache,
  prepared phase-coherent granular beds and logarithmic RPM crossfades. The
  existing recordings lack separate load/coast takes, so recorded off-load uses
  gain/EQ; fallback banks have separately rendered load/coast pulses. Samples are
  never relabelled as exact recordings of other trims.
- `engine-lifecycle.js`: starter/catch/flare/settle, shutdown/stall and mechanical
  shift events. Cabin manual shifts have lever detent, pedal/bearing movement and
  release. Up/down shifts differ, faster shifts are stronger, and each event has
  slight pitch variation. DCT/auto use a paddle click. Chase mechanical level is
  0.045 of cockpit level. Grinding requires explicit `shiftGrind`/`gearGrind`.
- `engine-spatial.js`: six nearest detailed engines plus two single-loop far
  voices, pooled across AI, multiplayer, traffic and police. Each owns panning,
  distance low-pass and attenuation. Doppler uses radial closing velocity in m/s,
  `343/(343-vr)`, bounded to 0.72–1.4 and slew-limited against network teleports.
  Close high-speed approach/recede crossings trigger a rate-limited whoosh.

## Telemetry and lifecycle

The existing `rpm`, signed `load`, `boost`, `gear`, `limiter` and `shift` inputs
remain supported. `shiftStart`/`shiftEnd` accept pulses or changing event serials;
`shiftDirection`, `shiftDuration`, `gearboxType`, `manual`, `cockpit`, `stalled`,
`engineRunning`, `shiftGrind` and `gearGrind` supply richer behavior when present.
Missing grind information produces no grinding. `requestIgnition()` handles
race restart and car selection; `engineOff()` handles quit even if the render
loop then stops. Pause/menu ducking alone does not stall the engine. Recovery
from an explicit stall starts it again. No audio event mutates vehicle physics.

Turbo profiles get spool/air/lift-off; sport profiles allow restrained overrun
pops. DCT cuts crack under load; torque-converter cuts stay smooth; manual shifts
have a longer clutch interruption. The existing independent engine/traffic/
tyres/voice/music sliders and master compressor remain in place. Cabin filtering
reduces exhaust brightness and brings the intake layer forward.

## Cost and bounds

Selection uses fixed arrays, O(8 × candidates), without sorting/copying telemetry.
Recorded RPM weights and spatial state are reused. The steady-state **engine**
update allocates no arrays/objects; voice assignment, asset preparation and
one-shot events can allocate. Existing non-engine audio/telemetry still allocates.
There are eight external routing slots. A detailed fallback has eight loops +
one limiter oscillator; a recorded voice has 3–4 loops + one oscillator; far LOD
has exactly one loop and no limiter/shaper. Retirement stops/disconnects nodes
in audio time after 0.3 s; each slot permits at most one replacement per 0.4 s.
Thus at most two generations per slot overlap during fades. Nearest-rank LOD
changes settle within that 0.4 s window. Idle retired slots stop their sources.
Sample banks are shared per AudioContext and sound profile; granular preparation
happens once per decoded take, not during steady-state frame updates.

## Licences and substitutions

No new downloaded assets. MINI loops and substitute petrol starter: CC0,
TheLittleCrow / sound_catcher99. Diesel idle/start: **CC BY 3.0, Loffy**, with the
existing crop/filter/mono/loop transformations. BMW M4 I6 and running diesel
substitutes: the existing **Sonniss GDC bundle licence**, game use only, not an
asset-library redistribution licence. Full provenance and source URLs remain in
[credits](../../assets/audio/engines/CREDITS.txt) and
[sources](../../assets/audio/engines/sources.json). New mechanical effects are
original procedural synthesis. V6/V8 profiles exist for future catalogue entries;
no current trim is falsely mapped to a V engine based only on cylinder count.

## Profiles by car

`mini`, `z4`, `taxi` in the source column refer to the licensed substitute banks
above. City I4s intentionally have no turbo effects or sport exhaust pops.
Catalogue traffic consumes its actual catalogue spec; generic police uses turbo
I4, vans/trucks diesel I4, bus diesel I6 and bikes their separate fallback until the existing CC0 bus/
scooter world loops arrive. Their MP3 loop guard offsets are preserved. Bus running
audio retains the documented TDI substitute used by the previous traffic pool.

| Car / trim | Profile | Source | Gearbox sound |
|---|---|---|---|
| mini | turbo-i4 | mini | manual |
| z4 | turbo-i6 | z4 | auto |
| taxi | diesel-i4 | taxi | dct |
| carrera | na-flat6 | procedural fallback | manual |
| gr_yaris | turbo-i3 | procedural fallback | manual |
| gtv | na-i4 | procedural fallback | manual |
| golf | turbo-i4 | mini | manual |
| corolla | city-i4 | mini | manual |
| superb | turbo-i4 | mini | dct |
| police_octavia | turbo-i4 | mini | manual |
| mini_jcw | turbo-i4-sport | mini | manual |
| cle | turbo-i4 | mini | auto |
| gla | turbo-i4 | mini | dct |
| gla45 | turbo-i4-sport | mini | dct |
| cla | turbo-i4 | mini | dct |
| huracan | na-v10 | procedural fallback | dct |
| ibiza | city-i4 | mini | manual |
| panda | city-i4 | mini | manual |
| yaris | city-i4 | mini | manual |
| e36 | na-i6 | procedural fallback | manual |
| cle200 | turbo-i4 | mini | auto |
| cle450 | turbo-i6 | z4 | auto |
| cle53 | turbo-i6 | z4 | auto |
| e36_m3 | na-i6 | procedural fallback | manual |
| panda_11 | city-i4 | mini | manual |
| panda_100hp | city-i4 | mini | manual |
| yaris_13 | city-i4 | mini | manual |
| yaris_ts | city-i4 | mini | manual |
| ibiza_cupra | turbo-i4-sport | mini | manual |
| golf_gti | turbo-i4-sport | mini | manual |
| golf_gtd | diesel-i4 | taxi | manual |
| golf_r | turbo-i4-sport | mini | dct |
| mini_cooper | turbo-i3 | procedural fallback | manual |
| mini_s | turbo-i4 | mini | manual |
| mini_cabrio_cooper | turbo-i3 | procedural fallback | manual |
| corolla_15 | city-i3 | procedural fallback | manual |
| octavia_16tdi | diesel-i4 | taxi | manual |
| octavia_rs | turbo-i4-sport | mini | manual |
| superb_15 | turbo-i4 | mini | manual |
| superb_4x4 | turbo-i4 | mini | dct |
| cla250 | turbo-i4 | mini | dct |
| cla35 | turbo-i4-sport | mini | dct |
| cla45s | turbo-i4-sport | mini | dct |
| gla250 | turbo-i4 | mini | dct |
| z4_20i | turbo-i4 | mini | auto |
| z4_30i | turbo-i4 | mini | auto |
| carrera_s | na-flat6 | procedural fallback | manual |
| carrera_gts | na-flat6 | procedural fallback | manual |
| huracan_rwd | na-v10 | procedural fallback | dct |
| gtv1750 | na-i4 | procedural fallback | manual |
| e36_318i | na-i4 | procedural fallback | manual |
| mini_cabrio_jcw | turbo-i4-sport | mini | manual |
| cle300e | turbo-i4 | mini | auto |
| jazz | na-i4 | procedural fallback | manual |
| jazz_dynamic | na-i4 | procedural fallback | manual |
| jazz_drift | turbo-i4-sport | mini | manual |

## Verification

`node --test tools/vehicle-audio.test.mjs` covers Doppler math, bounds, shared voice
selection, layouts, sample mapping, allocation-free RPM weights, mechanical
shift edges, camera attenuation and lifecycle transitions. The three repository
gates run in a clean `git archive HEAD` export, never the shared working tree.
See `.scratch/engine-audio/README.md` for offline browser captures and timings.

Powertrain integration verified against `5e782b3`: the bridge reads physical
`pv.powertrain.gearboxType`, durable shift-start/end event serials and `overrun`,
alongside rpm/load/boost/gear/limiter. It reads existing fields directly rather
than allocating the `powertrainSignals` snapshot every frame. No clutch-failure
diagnostic is exposed, so normal gameplay cannot trigger the optional grind.

World-loop attribution: bus idle — bikesnbassboi; scooter idle — lovretta;
scooter running — dif1891. All three are existing CC0 1.0 assets; see
`assets/audio/world/CREDITS.txt` and `sources.json`. No new files downloaded.
