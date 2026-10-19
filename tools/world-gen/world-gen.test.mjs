// The generator's own unit tests (projection, quantisation, turn compilation incl. via-way chains, markings, surfaces).
import test from 'node:test';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
const python=process.env.WORLD_GEN_PYTHON||'python3';
const ready=spawnSync(python,['-c','import shapely,numpy,osmium']).status===0;
test('world-gen unit tests (test.py)',{skip:!ready&&'shapely/numpy/osmium are not installed for '+python+' (set WORLD_GEN_PYTHON to the world-gen venv)'},()=>{
  const r=spawnSync(python,[fileURLToPath(new URL('./test.py',import.meta.url))],{encoding:'utf8'});assert.equal(r.status,0,r.error?.message||r.stderr||r.stdout);
});
