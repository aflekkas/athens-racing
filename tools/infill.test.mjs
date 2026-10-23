// Source-backed eligibility and scale for offline generated building infill.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const python = process.env.WORLD_GEN_PYTHON || 'python3';
const ready = spawnSync(python, ['-c', 'import shapely; from shapely import constrained_delaunay_triangles']).status === 0;
test('infill keeps dense source character and excludes unsupported bodies; roof heights retain provenance', {
  skip: !ready && `world-gen Shapely is not installed for ${python} (set WORLD_GEN_PYTHON to the world-gen venv)`,
}, () => {
  const result = spawnSync(python, [fileURLToPath(new URL('./world-gen/infill_test.py', import.meta.url))], {encoding: 'utf8'});
  assert.equal(result.status, 0, result.error?.message || result.stderr || result.stdout);
});
