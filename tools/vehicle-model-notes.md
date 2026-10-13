# Vehicle model construction and reference notes

Playable: MINI Cooper S Cabrio F57 (B48, FWD), BMW Z4 M40i G29 (B58, RWD), Škoda Octavia IV liftback 2.0 TDI DSG taxi (FWD). Traffic adds the BYD Dolphin, BYD Atto 3 and Škoda Superb taxi, with several paint choices. The older generic traffic types and low-detail parked rows remain deliberately lightweight.

The models are original procedural meshes in `src/vehicle-models.js`, measured in metres, pointing towards -Z. No downloaded car meshes or manufacturer photographs are shipped as textures. Images were inspected as design references only. They are reference-proportioned game models, not manufacturer CAD or scans.

## Visual reference sources

- [MINI Convertible F57 press information](https://www.press.bmwgroup.com/united-kingdom/article/attachment/T0256464EN_GB/353152): convertible proportions and drivetrain.
- [MINI Cooper S Cabrio interior photograph](https://www.motorbox.com/auto/auto-viste-e-provate/auto-day-by-day/mini-cooper-s-cabrio-2021-prova-prezzi-opinioni-foto): circular central display, vent arrangement, toggles, console and steering controls.
- [BMW Z4 model introduction and gallery](https://www.press.bmwgroup.com/usa/article/detail/T0285141EN_US/the-new-bmw-z4): G29 body, lamps, cockpit, wheels and exhaust arrangement.
- [BMW Z4 interior photograph](https://de.motor1.com/news/266490/bmw-z4-2019-technische-daten/): digital cockpit, raised central display, vent and console layout, cognac upholstery.
- [Škoda Octavia IV interior press kit](https://www.skoda-storyboard.com/en/press-kits/skoda-octavia-press-kit-2/interior-new-design-improves-ergonomics-and-appearance/): two-spoke wheel, floating central display, layered dashboard and door trim.
- [BYD Dolphin](https://www.byd.com/uk/electric-cars/dolphin.html) and [Atto 3](https://prod.byd.com/eu/electric-cars/atto3): proportions, closed EV nose and lamp treatment. EV models have no exhaust outlets.

## Construction and animation

Each wheel has an independent steering pivot and spin group. Brake discs spin; calipers remain on the pivot. Player animation reads the four physics corner velocities (FL/FR/RL/RR) and shows unequal wheelspin, reversing and lockup. Positive physics steering turns right; the Three.js pivot rotates in the opposite sign. Visual Ackermann increases the inner wheel angle. The tyre physics still uses a common axle steering angle.

The shell uses a single side-surface function for body shape, panel seams and wheel-arch lips. End caps match the side cross-sections; door shoulders bridge the outer skin to the window sill. Roof, pillars and glass share perimeter endpoints. Decorative strips are projected back onto the shell rather than positioned at an unrelated fixed width.

Traffic geometry is cached by model. Each vehicle receives its own paint, brake-light material, and sequential fictional Greek-style registration; front and rear match. Damage clones geometry on first impact so one crashed car cannot deform every car sharing its model. `setDamage(zone, amount)` accepts absolute 0–1 values; setting all zones to zero restores the original geometry. Damage follows a shared displacement field across body and trim to retain their joins.

The model studio at `/tools/models.html` (on a development static server) provides orbit views, cabin views, wheel rolling, steering, brake lights, damage and GLB export. Exported wheels retain their transform hierarchy for use in Blender or other modelling tools. Runtime shader-only upholstery details are not baked into the GLB.

The physics review and regression suite are documented in `tools/physics-review.md`. These are simplified real-time dynamics, not a tyre or crash simulator validated against instrumented vehicle tests.
