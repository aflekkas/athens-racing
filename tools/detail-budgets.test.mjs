import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {DETAIL_LIMITS as L} from '../src/world-detail-policy.js';
const root=resolve(import.meta.dirname,'..'),read=p=>readFileSync(resolve(root,p));
test('fixed all-map day/night poses enforce the owner world-detail budgets in both states',()=>{
 const report=JSON.parse(read('.scratch/detail-pass/budgets.json'));
 assert.deepEqual([...new Set(report.rows.map(r=>r.map))].sort(),['megara','penteli','psychiko','riviera']);
 assert.deepEqual(report.browserErrors,[]);
 assert.equal(report.rows.length,20,'Riviera start/mid, Penteli mid, Megara overview, Psychiko mid; day/night, chase/cockpit');
 for(const r of report.rows){
  assert.ok(r.on.calls<=r.before.calls*L.drawRatio,r.name+' draw budget');
  assert.ok(r.on.triangles<=r.before.triangles*L.triangleRatio,r.name+' triangle budget');
  assert.ok(r.on.textureBytes-r.before.textureBytes<=L.textureBytes,r.name+' texture budget');
  assert.ok(r.off.calls<=r.before.calls,r.name+' Off draw calls');
  assert.ok(r.off.triangles<=r.before.triangles,r.name+' Off triangles');
  assert.ok(r.off.textureBytes<=r.before.textureBytes+.01,r.name+' Off texture bytes');
  assert.equal(r.on.shadows,false);assert.equal(r.off.shadows,false);
  for(const phase of ['on','off']){assert.deepEqual(r[phase].camera,r.before.camera,r.name+' fixed camera');assert.deepEqual(r[phase].quaternion,r.before.quaternion,r.name+' fixed direction');}
 }
 for(const [path,sha] of Object.entries(report.sourceHashes))assert.equal(createHash('sha256').update(read(path)).digest('hex'),sha,path+' changed: repeat the fixed-pose budget capture');
});
