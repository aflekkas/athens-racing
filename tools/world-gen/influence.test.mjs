import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
test('Athens global influence: overlaps, ties, profile grades and shoulder continuity',()=>{
  const result=spawnSync(process.env.WORLD_GEN_PYTHON||'python3',[fileURLToPath(new URL('./influence_test.py',import.meta.url))],{encoding:'utf8'});
  assert.equal(result.status,0,result.error?.message||result.stderr||result.stdout);
});
