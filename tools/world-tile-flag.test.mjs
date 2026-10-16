import{test}from'node:test';import assert from'node:assert/strict';import{legacyTilesEnabled}from'../src/world-tile-flag.js';
test('streaming default has a URL kill switch and per-instance automatic fallback',()=>{
 const previous=globalThis.location,map={data:{worldTiles:{default:true}}};try{
  globalThis.location={search:''};assert.equal(legacyTilesEnabled(map),true);
  for(const search of['?streaming=0','?nobake','?noroadnetwork']){globalThis.location={search};assert.equal(legacyTilesEnabled(map),false);}
  globalThis.location={search:'?streaming=1'};map.streamingFailed=true;assert.equal(legacyTilesEnabled(map),false);assert.equal(legacyTilesEnabled({data:{}}),false);
  delete map.streamingFailed;map.data.worldTiles.default=false;globalThis.location={search:''};assert.equal(legacyTilesEnabled(map),false);globalThis.location={search:'?streaming=1'};assert.equal(legacyTilesEnabled(map),true);
 }finally{if(previous===undefined)delete globalThis.location;else globalThis.location=previous;}
});
