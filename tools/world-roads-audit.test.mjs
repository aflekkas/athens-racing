import test from 'node:test';import assert from 'node:assert/strict';
import {auditRoadSections,ROAD_CLASSES} from './world-roads-audit.mjs';
const schema=['class','width','lanes','sidewalkLeft','sidewalkRight','surface','oneway'];
const tile=(roads,meshes=[{material:1,userData:{tileSurface:'asphalt'}},{material:8,userData:{tileSurface:'paving'}},{material:9,userData:{}}])=>({ids:['',...Object.keys(roads).map(id=>'surface:'+id)],meshes,roadSections:{schema,roads}});
test('a consistent cell passes and reports its distinct widths',()=>{
  const r=auditRoadSections(tile({a:['residential',6,2,1.8,1.8,'asphalt',0],b:['residential',6,2,1.8,0,'asphalt',0],c:['primary',10.5,3,2.5,2.5,'asphalt',1],d:['service',3.2,1,0,0,'asphalt',1]}));
  assert.equal(r.passed,true,JSON.stringify(r.problems));assert.equal(r.roads,4);assert.equal(r.sidewalkRoads,3);assert.deepEqual(r.distinctWidthsPerClassAndLanes['residential/2/false'],[6]);
});
test('a width outside the class band, a bad sidewalk or an unknown class fails',()=>{
  for(const [name,row] of Object.entries({narrow:['residential',3,2,1.8,1.8,'asphalt',0],wide:['service',9,2,0,0,'asphalt',0],sidewalk:['primary',7,2,.4,2.5,'asphalt',0],klass:['cycleway',4,1,0,0,'asphalt',0],lanes:['primary',7,0,0,0,'asphalt',0],surface:['primary',7,2,0,0,'lava',0]})){
    assert.equal(auditRoadSections(tile({[name]:row})).passed,false,name);
  }
});
test('sidewalk roads need paving and kerb meshes; missing section metadata fails',()=>{
  assert.equal(auditRoadSections(tile({a:['residential',6,2,1.8,1.8,'asphalt',0]},[{material:1,userData:{tileSurface:'asphalt'}}])).passed,false);
  assert.equal(auditRoadSections({ids:[''],meshes:[]}).passed,false);
  assert.equal(auditRoadSections(tile({a:['service',3.2,1,0,0,'asphalt',1]},[{material:1,userData:{tileSurface:'asphalt'}}])).passed,true,'no sidewalks, none required');
});
test('the exported class table covers every highway class the section model knows',()=>{
  for(const k of ['motorway','trunk','primary','secondary','tertiary','unclassified','residential','living_street','service','road','primary_link'])assert.ok(ROAD_CLASSES[k],k);
  for(const v of Object.values(ROAD_CLASSES))assert.ok(v.minWidth<v.maxWidth&&v.laneWidth*v.lanesOneWay<=v.maxWidth);
});
