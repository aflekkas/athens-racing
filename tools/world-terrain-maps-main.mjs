// Evaluated before tools/road-terrain-level.test.mjs inside tools/world-tests.test.mjs: every playable map except Psychiko,
// whose terrain scan runs in its own process (tools/world-tests-psychiko.test.mjs) so the two halves run side by side.
import { getPlayableMaps } from '../src/enabled-maps.js';
import { MAPS } from '../src/map-catalog.js';
process.env.TERRAIN_MAPS = getPlayableMaps(MAPS).map(map => map.id).filter(id => id !== 'psychiko').join(',');
