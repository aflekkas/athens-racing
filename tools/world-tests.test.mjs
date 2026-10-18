// One process shares each expensive deterministic world fixture across suites. Psychiko's terrain scan runs beside it in
// tools/world-tests-psychiko.test.mjs; this process covers every other map (TERRAIN_MAPS is set before the suite loads).
import './world-terrain-maps-main.mjs';
import './baked-world.test.mjs';
import './road-terrain-level.test.mjs';
import './riviera-rails.test.mjs';
