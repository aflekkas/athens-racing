# Cockpit beams, 928 pitch and ground patch (2026-10-18)

Owner report from staging 7d6e589f: bent cockpit beams, 928 tilted, shadow under the car.

- `928-game-psychiko/`: real game, Palaio Psychiko start (Nikiforou Lytra, the owner's spot). before-* = prod 06bd01ca, after-* = fix.
  Before: tail floats ~19 cm, front tyres 18 cm below the road, dark parallelogram under the car, bent A-pillars.
- `928-fixture/`: standalone renders (tools/car-frame-sheets.mjs) of the 928 at rest on flat ground, cockpit / side / three-quarter.
- `contact-sheets/`: every player configuration after the fix, cockpit view and exterior side view (12 per sheet).
- `pillar-top-error-*.txt`: per configuration, distance (m) of the cockpit pillar top from the windscreen glass top corner and its inboard lean.
