import test from 'node:test';
import assert from 'node:assert/strict';
import {WorldRoadGraph} from '../src/world-tile-graph.js';
import {auditConnectivity} from './world-connectivity-audit.mjs';
const edge=(id,from,to,y0=0,y1=0,extra={})=>({id,from,to,points:[[0,y0,0],[100,y1,0]],name:id,flags:0,layer:0,length:100,speedKph:50,surface:'s',lanes:0,...extra});
function graph(edges,turns=[]){
  const g=new WorldRoadGraph();
  for(const e of edges){g.edges.set(e.id,{value:e,refs:1});g.nodes.set(e.from,{value:{id:e.from},refs:1});g.nodes.set(e.to,{value:{id:e.to},refs:1});(g.outgoing.get(e.from)||g.outgoing.set(e.from,new Set()).get(e.from)).add(e.id);}
  for(const t of turns)g.turns.set(JSON.stringify(t),{value:t,refs:1});
  return g;
}
test('a two-way loop is one component and a one-way spur is its own island',()=>{
  const g=graph([edge('ab','a','b'),edge('ba','b','a'),edge('bc','b','c')]);
  const r=auditConnectivity(g,{minorIslandMetres:50});
  assert.equal(r.mainComponent.edges,2);assert.equal(r.otherComponents,1);assert.ok(Math.abs(r.mainComponent.share-2/3)<1e-9);
});
test('turn restrictions split otherwise connected roads and bridges do not feed ground roads',()=>{
  const g=graph([edge('ab','a','b'),edge('ba','b','a'),edge('bc','b','c'),edge('cb','c','b')],[{from:'ab',via:'b',to:'bc',rule:1},{from:'cb',via:'b',to:'ba',rule:1}]);
  assert.equal(auditConnectivity(g,{minorIslandMetres:50}).mainComponent.edges,2,'a->c is forbidden and c->a is forbidden');
  const deck=graph([edge('ab','a','b'),edge('ba','b','a'),edge('bc','b','c',6,6),edge('cb','c','b',6,6)]);
  assert.equal(auditConnectivity(deck,{minorIslandMetres:50}).mainComponent.edges,2,'height jump at the portal is not drivable');
});
