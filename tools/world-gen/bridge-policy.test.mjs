import test from 'node:test';import assert from 'node:assert/strict';import{spawnSync}from'node:child_process';import{fileURLToPath}from'node:url';
test('six-metre shoulder exception is limited to literal OSM bridge=yes and connected approaches',()=>{
 const r=spawnSync(process.env.WORLD_GEN_PYTHON||'python3',[fileURLToPath(new URL('./bridge_policy_test.py',import.meta.url))],{encoding:'utf8'});assert.equal(r.status,0,r.error?.message||r.stderr||r.stdout);
});
test('cell-border intersections are globally identical through rounding ties and reversed segments',()=>{
 const r=spawnSync(process.env.WORLD_GEN_PYTHON||'python3',[fileURLToPath(new URL('./border_nodes_test.py',import.meta.url))],{encoding:'utf8'});assert.equal(r.status,0,r.error?.message||r.stderr||r.stdout);
});
