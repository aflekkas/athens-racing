# Aventador SVJ LP770-4

Factory reference: https://www.lamborghini.com/en-en/models/aventador/aventador-svj
6.5 L naturally aspirated V12, 770 PS (566.35 kW) at 8500 rpm,
720 Nm at 6750 rpm, 1525 kg dry, 2.8 s 0–100, over 350 km/h.
The catalogue uses estimated 1675 kg running mass including fluids/driver;
it does not mislabel the factory dry weight as the running mass.

New generation `aventador_svj`, body `aventador`, seven-speed `AMT` / `amt`.
ISR is modeled as an automated single clutch: zero shift torque, 180 ms
interruption, rev matching and unsafe-downshift protection. This is a
conservative game shift envelope, not Lamborghini's quoted minimum actuator
time. Huracán LDF retains 90 ms and 94% torque continuity. Launch control
holds 78% of redline at full pedal; the 240 Hz tyre model still limits force.
Intermediate torque samples, inertia, operating mass, drag area, suspension,
launch setpoint and grip are simulation estimates. Rear steer moves actual
rear contact-patch frames from counterphase below 43 km/h to in-phase above
108 km/h. ALA is a simplified two-state downforce coefficient: 45% on full
throttle straights, full under braking/cornering. It does not simulate separate
left/right aero-vectoring ducts. Dimensions: 4.943 × 2.098 × 1.136 m, WB 2.70 m.

The procedural mesh is original: independent wedge stations, scissor-door
seams, side intake, flying buttresses, louvred V12 deck, Y lamps, three rear
Ypsilon signatures per side, fixed carbon wing, diffuser and hexagonal high
central exhausts. Cabin uses shared fittings and a live SVJ digital cluster;
logos use the shared brand badge atlas. No downloaded model or audio samples.

Exhaust pops, flames, the shared flash light, the pop audio and the per-car toggle were
removed by owner decision (2026-10-20, docs/OWNER-DECISIONS.md). The SVJ keeps its normal
V12 engine sound.

Evidence and gate logs: `.scratch/svj/`.

The limited-production SVJ is a player/rival car (civilian traffic weight 0),
so ambient commuter pool probabilities remain unchanged.

SVJ rear Y signatures use saturated red emissive geometry without the generic weather tail halos.
