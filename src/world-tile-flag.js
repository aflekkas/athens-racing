// Pure gate: no renderer/worker allocation at menu boot. Failures are per map instance.
export function legacyTilesEnabled(map){
 const query=new URLSearchParams(typeof location==='undefined'?'':location.search);
 return !!map?.data?.worldTiles&&!map.streamingFailed&&!query.has('nobake')&&!query.has('noroadnetwork')&&query.get('streaming')!=='0'&&(map.data.worldTiles.default===true||query.get('streaming')==='1'||query.get('worldtiles')==='1');
}
