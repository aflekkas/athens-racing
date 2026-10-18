// Psychiko's rendered-terrain scan is the longest single test, so it gets its own process (its own world fixture) and runs
// beside tools/world-tests.test.mjs, which covers every other map.
import './world-terrain-maps-psychiko.mjs';
import './road-terrain-level.test.mjs';
