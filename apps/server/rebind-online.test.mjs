import test from 'node:test';
import assert from 'node:assert/strict';
import {assertMetadataOnlyWorld,rebindRecoveryBytes,rebindRecoveryRoot} from './rebind-online.mjs';
import {sha256} from '../../src/route-definition.js';
const keys=['-64,-2','-63,-2','-64,-1','-63,-1','-65,-1'];
const world=()=>({revision:'a'.repeat(64),regions:[{id:'megara',manifestUrl:'old',manifestSha256:'old',sourceRevision:'old',elevation:1}],tiles:Object.fromEntries(keys.map((k,i)=>[k,{sha256:String(i).repeat(64),decodedBytes:100,bytes:50,source:{revision:'packet'}}])),projection:{scale:1}});
test('budget-only rebind accepts exactly five original resident budgets and rejects source/geometry/order drift',()=>{
 const a=world(),b=structuredClone(a),original=structuredClone(a);b.revision='b'.repeat(64);for(const k of keys){original.tiles[k].decodedBytes=200;b.tiles[k].residentBytes=200;}b.regions[0].manifestUrl='next';b.regions[0].manifestSha256='next';b.regions[0].sourceRevision='next';
 assert.deepEqual(assertMetadataOnlyWorld(a,b,original),keys);
 for(const mutate of [x=>x.tiles[keys[0]].sha256='f'.repeat(64),x=>x.tiles[keys[0]].source.revision='other',x=>x.tiles[keys[0]].residentBytes=201,x=>x.projection.scale=2,x=>delete x.tiles[keys[0]],x=>x.regions[0].elevation=2]){const bad=structuredClone(b);mutate(bad);assert.throws(()=>assertMetadataOnlyWorld(a,bad,original),/Metadata rebind/);}
});
test('sidecar rebinding changes only world identity and reauthenticates all original records',async()=>{
 const revision='a'.repeat(64),next='b'.repeat(64),body={schemaVersion:1,worldId:'athens',projectionId:'athens-v1',worldSetRevision:revision,sourceHashes:[['0,0','c'.repeat(64)]],edges:[{id:'edge',from:'a',to:'b',layer:0,flags:1,surface:'road',points:[[0,0,0],[0,0,100]]}],anchors:[{edgeId:'edge',offsetM:50,x:0,y:0,z:50,yaw:-Math.PI,layer:0,surfaceId:'road',leftM:4,rightM:4,halfWidth:1,halfLength:2,footprints:[{halfWidth:1,halfLength:2}]}]};
 const options={expectedHash:await sha256(body),oldRevision:revision,newRevision:next},result=await rebindRecoveryBytes(Buffer.from(JSON.stringify(body)),options),changed=JSON.parse(result.bytes);assert.equal(changed.worldSetRevision,next);changed.worldSetRevision=revision;assert.deepEqual(changed,body);assert.equal(result.anchors,1);assert.notEqual(result.hash,options.expectedHash);
 await assert.rejects(rebindRecoveryBytes(Buffer.from(JSON.stringify({...body,anchors:[]})),options));
 await assert.rejects(rebindRecoveryBytes(Buffer.from(JSON.stringify(body)),{...options,oldRevision:next}));
 await assert.rejects(rebindRecoveryBytes(Buffer.from(JSON.stringify(body)),{...options,sourceHashes:new Map([['0,0','d'.repeat(64)]]),cell:'0,0'}),/source drift/);
 await assert.rejects(rebindRecoveryBytes(Buffer.from(JSON.stringify(body)),{...options,sourceHashes:new Map(body.sourceHashes),cell:'1,0'}),/source drift/);
});

test('compact recovery root rebinding explicitly encodes expanded descriptors as schema1',()=>{const source='c'.repeat(64),part='d'.repeat(64),root={schemaVersion:2,worldId:'athens',projectionId:'athens-v1',worldSetRevision:'a'.repeat(64),cells:{},footprints:[{halfWidth:1,halfLength:2}]};const next=rebindRecoveryRoot(root,{'0,0':{sourceHash:source,parts:[part]}},'b'.repeat(64));assert.equal(next.schemaVersion,2);assert.equal(typeof next.cells['0,0'],'string');});
