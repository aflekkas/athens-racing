# Psychiko recognition — implementation E

Work in progress, baseline `c4df524e`. Local commits only, headless Chromium.

The lap survey contains 165 stations (45 m spacing plus named junctions), each captured in both directions. All 330 panes were reviewed on the seven [survey sheets](survey-01.webp); station positions, panorama dates, offsets and source links are in [stations.json](references/stations.json). Imagery is reference only and never read by map builders.

Reduced street character observations are in `tools/maps/psychiko/raw/lap-survey.json`. Landmark implementation, performance and gate results follow in subsequent commits.
