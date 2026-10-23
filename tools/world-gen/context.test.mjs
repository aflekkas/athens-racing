// Source-only context/experimental structures; no browser, bake or release activation.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import './context-surfaces.test.mjs';
const python=process.env.WORLD_GEN_PYTHON||'python3';
const available=spawnSync(python,['-c','import shapely,osmium']).status===0;
for(const name of ['structure_context_test.py','experimental_structures_test.py']){
 test(name,{skip:!available&&'pinned world-gen Python dependencies unavailable'},()=>{
  const r=spawnSync(python,[fileURLToPath(new URL('./'+name,import.meta.url))],{encoding:'utf8'});
  assert.equal(r.status,0,r.error?.message||r.stderr||r.stdout);
 });
}
