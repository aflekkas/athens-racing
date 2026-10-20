# Handover to the bake agent: Athens beauty pass

Updated per step. Nothing here is baked or published by the beauty agent.

## Step 1 (landmarks, mountain ring): no rebake needed
Runtime only, plus a static `assets/athens/horizon.bin` that ships with the app. The hidden boxes of replaced landmarks use building ids already in the cells. `tools/world-gen/landmarks.py` and `horizon.py` are stand-alone generators (landmarks.py needs the cache's `attica.osm.pbf` and `clean.sqlite`; horizon.py the DEM tiles) and are not part of a bake.
