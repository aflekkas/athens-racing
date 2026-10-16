# Barrier ground-contact regression

Baseline: fe3ef4f09aa8e655e07ae0ce07c010791a912b12.
Actual production Ground._hit, 150 km/h, 45 degrees, no driver input.

- Before: max root height 3.497 m (CoM 3.947 m), airtime 4.967 s;
  rebound rises 1.692, 2.925, 0.109, 0.252, 0.062 m;
  persistent rest 5.817 s after first touchdown.
- After: max root height 2.884 m (CoM 3.334 m), airtime 1.583 s;
  rebound peak CoM 0.491 m from contact minimum 0.452 m (rise 0.039 m);
  first touchdown 1.246 s, persistent rest 4.100 s (2.854 s after touchdown).
- All 516 hull-contact substeps have non-increasing total energy (maximum
  floating point difference +1.2e-10 J, tolerance 1e-6 J).
- Crest remains 1.578 m / 1.333 s with stable suspension landing.
  Bus reaches 90.01 degrees and rests on its side; 911 reaches 11.89 degrees
  and recovers. Parked/gravity/suspension/anti-tunnelling tests pass.

Three added regression tests fail on the baseline (rebound, energy, settling)
and pass after the fix: contact-baseline-tests.log and contact-fixed-tests.log.
Rest means speed/vy/spin <0.2 continuously to the end of the 8 s trace.
Height fields in the original logs are root height; new cy fields are true CoM.

Evidence: before.json, after.json, barrier-00.png through barrier-07.png,
barrier-sequence.png, barrier.gif, barrier-browser-frames.json.
The contact sheet was opened and inspected: initial launch/tumble, descending
hull contact, small final wheel rebound, scraping, then rest; no repeated high
bounces. The controlled asphalt pad is wide enough to show the entire slide.

## Clean archive gates and baseline exception

Source candidate: `e2f2c010ba6c78a895415285f45c3f2db31a5220`; clean archive parent: `c113cf75195020f0adb052758d92377757151440`.

Physics regress: **1146 passed, 0 failed**. Events, syntax, browser imports and staging Worker dry-run passed. npm test: damage, unit and physics groups passed; the world group had exactly one failing test.

Failing test in BOTH the candidate npm suite and clean unmodified parent:

`psychiko: rendered terrain clears every road and both six-metre shoulders remain drivable`

Error prefix (large source metadata omitted; complete error lines match byte for byte):

```text
terrain above road by 0.029907237601690895 m at {"road":31486943,"k":3,"u":-3,"source":...}
```

Raw full error lines: contact-npm-test.log and contact-baseline-terrain.log. No other failing test names. The user authorized committing with this known baseline failure; the roundabout agent owns it and the release train remains blocked until prod is green. No push or deployment was performed (Wrangler dry-run only).
