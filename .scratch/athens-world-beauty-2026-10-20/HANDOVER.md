# Handover to the bake agent: Athens beauty pass

Updated per step. Nothing here is baked or published by the beauty agent.

## Step 1 (landmarks, mountain ring): no rebake needed
Runtime only, plus a static `assets/athens/horizon.bin` that ships with the app. The hidden boxes of replaced landmarks use building ids already in the cells. `tools/world-gen/landmarks.py` and `horizon.py` are stand-alone generators (landmarks.py needs the cache's `attica.osm.pbf` and `clean.sqlite`; horizon.py the DEM tiles) and are not part of a bake.

## Step 2 (facades, roofs, rooftop kit, paved squares): no rebake needed
Everything is derived at run time from the cells already published; a cell baked before this still shows it. The only new static files are `assets/athens/plazas.json` (54 KB) and the earlier `horizon.bin`, both shipped with the app. A later bake could make this cheaper (store `roofShape` and a facade style per building: `worldDetail.buildings.roofShape` / `facadeStyle` are already read when present) but nothing requires it.
