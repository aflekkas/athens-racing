# Handover to the bake agent: Athens beauty pass

Updated per step. Nothing here is baked or published by the beauty agent.

## Step 1 (landmarks, mountain ring): no rebake needed
Runtime only, plus a static `assets/athens/horizon.bin` that ships with the app. The hidden boxes of replaced landmarks use building ids already in the cells. `tools/world-gen/landmarks.py` and `horizon.py` are stand-alone generators (landmarks.py needs the cache's `attica.osm.pbf` and `clean.sqlite`; horizon.py the DEM tiles) and are not part of a bake.

## Step 2 (facades, roofs, rooftop kit, paved squares): no rebake needed
Everything is derived at run time from the cells already published; a cell baked before this still shows it. The only new static files are `assets/athens/plazas.json` (54 KB) and the earlier `horizon.bin`, both shipped with the app. A later bake could make this cheaper (store `roofShape` and a facade style per building: `worldDetail.buildings.roofShape` / `facadeStyle` are already read when present) but nothing requires it.

## Step 3 (trees, denser rooftop kit, all of Syntagma paved): no rebake needed
Street trees and the rooftop kit are derived from each cell's road graph and buildings when the cell is read, so published cells need nothing. `assets/athens/plazas.json` was extracted again (569 outlines); it ships with the app. If a bake ever stored per-cell tree rows, `worldDetail.vegetation` (positionHeight, kind, seed) is already drawn with the new species models. Note for later: with World detail Off the old box trees are gone for good (they never drew in Off anyway).

## Step 4 (contact shadows under props, aerial perspective): no rebake needed
Run-time only; nothing in the cells is read or written.
