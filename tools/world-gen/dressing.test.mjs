// Ground classes (appearance.py), the park and facade lookups and the shore-foam strip (tile_detail.py).
import test from 'node:test';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
const python=process.env.WORLD_GEN_PYTHON||'python3',shapely=spawnSync(python,['-c','import shapely']).status===0;
test('ground classes, park and facade lookups, shore foam',{skip:!shapely&&'shapely is not installed for '+python+' (set WORLD_GEN_PYTHON to the world-gen venv)'},()=>{
  const r=spawnSync(python,[fileURLToPath(new URL('./dressing_test.py',import.meta.url))],{encoding:'utf8',cwd:fileURLToPath(new URL('.',import.meta.url))});assert.equal(r.status,0,r.error?.message||r.stderr||r.stdout);
});
