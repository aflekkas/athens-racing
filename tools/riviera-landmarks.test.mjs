import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {RIVIERA_TUNNELS} from '../src/maps/riviera-tunnels.js';
const {elements}=JSON.parse(fs.readFileSync(new URL('../data/raw/roads.json',import.meta.url)));
const {proj}=JSON.parse(fs.readFileSync(new URL('../data/map.json',import.meta.url)));
test('Loumbarda portal geometry matches the two actual OSM road tunnels beyond Varkiza',()=>{
  assert.equal(RIVIERA_TUNNELS.length,2);
  for(const bore of RIVIERA_TUNNELS){const way=elements.find(w=>w.id===bore.sourceWayId);assert.equal(way.tags.tunnel,'yes');assert.equal(way.tags.lanes,'2');assert.equal(way.tags.highway,'primary');assert.equal(bore.axis.length,way.geometry.length);
    for(const [x,z] of bore.axis)assert.ok(way.geometry.some(p=>Math.hypot((p.lon-proj.lon0)*proj.mlon-x,-(p.lat-proj.lat0)*proj.mlat-z)<.0001));
    assert.ok(bore.portalS[0]>9400&&bore.portalS[1]<9520,'must not put this tunnel at Limanakia');
    assert.ok(bore.transitionS[0]<bore.portalS[0]&&bore.transitionS[1]>bore.portalS[1]);
  }
});
