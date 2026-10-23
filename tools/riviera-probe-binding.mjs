// Source-only diagnostic bridge. No GL calls, renderer changes or source writes.
import * as THREE from 'three';
import {tileGPUPlan} from '../src/world-tile-gpu.js';
import {wrapProbeMesh} from './riviera-probe-geometry.mjs';
const shaPattern = /^[a-f0-9]{64}$/;
const enums = {Float32Array:5126,Uint8Array:5121,Uint8ClampedArray:5121,Int8Array:5120,Uint16Array:5123,Int16Array:5122,Uint32Array:5125,Int32Array:5124};
const json = x => JSON.stringify(x);
const equal = (a,b,label) => {if(json(a)!==json(b))throw Error(label+' mismatch');};
const bytes = a => new Uint8Array(a.buffer,a.byteOffset,a.byteLength);
const hash = async a => [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes(a)))].map(x=>x.toString(16).padStart(2,'0')).join('');
const arrayLayout = a => ({type:a.constructor.name,byteOffset:a.byteOffset,byteLength:a.byteLength,length:a.length});
const glLayout = a => ({type:a.type,itemSize:a.itemSize,elementSize:a.elementSize,count:a.count,normalized:!!a.normalized,version:a.version});
const materialReceipt = material => (Array.isArray(material)?material:[material]).map(m=>({uuid:m.uuid,type:m.type,name:m.name,side:m.side,visible:m.visible,version:m.version,transparent:m.transparent,opacity:m.opacity,depthTest:m.depthTest,depthWrite:m.depthWrite}));
function assertMatrixFresh(mesh){const expected=new THREE.Matrix4().compose(mesh.position,mesh.quaternion,mesh.scale);if(mesh.parent)expected.premultiply(mesh.parent.matrixWorld);if(mesh.matrixWorld.elements.some((v,i)=>!Number.isFinite(v)||Math.abs(v-expected.elements[i])>1e-6))throw Error('stale/nonfinite rendered matrix');}
function meshState(mesh){return {matrixWorld:mesh.matrixWorld.toArray(),layers:mesh.layers.mask,visible:mesh.visible,material:materialReceipt(mesh.material),groups:mesh.geometry.groups.map(g=>({...g})),drawRange:{start:mesh.geometry.drawRange.start,count:mesh.geometry.drawRange.count===Infinity?'Infinity':mesh.geometry.drawRange.count},userData:mesh.userData};}

/** Bind only a currently active native tile handle, packet and exact manifest identity. */
export async function bindActiveTileProbe({stream,key,expected}) {
  if(stream.disposed)throw Error('disposed stream');
  const entry=stream.entry(key),tile=stream.tiles.get(key),packet=tile?.packet,root=tile?.handle?.root;
  if(!entry||tile?.state!=='active'||!packet||!root)throw Error('tile packet/handle not active');
  if(!shaPattern.test(expected?.cellSha256||'')||entry.sha256!==expected.cellSha256)throw Error('cell source SHA mismatch');
  if(stream.manifest.world!==expected.worldId||stream.manifest.revision!==expected.worldSetRevision)throw Error('manifest identity mismatch');
  const world=entry.source?.world||stream.manifest.world,revision=entry.source?.revision||stream.manifest.revision;
  if(world!==expected.sourceWorld||revision!==expected.sourceRevision)throw Error('source world/revision mismatch');
  equal(packet.metadata.cell,key.split(',').map(Number),'packet cell');
  if(packet.metadata.world!==world||packet.metadata.revision!==revision)throw Error('packet world/revision mismatch');
  equal(packet.metadata.origin,[Number(key.split(',')[0])*512,0,Number(key.split(',')[1])*512],'packet origin');
  if(root.name!=='tile:'+key||root.children.length!==packet.metadata.meshes.length)throw Error('render root/mesh sequence mismatch');
  assertMatrixFresh(root);equal(root.position.toArray(),[packet.metadata.origin[0]-stream.origin.x,0,packet.metadata.origin[2]-stream.origin.z],'render root origin transform');
  const recomputed=tileGPUPlan(packet);equal(packet.gpuPlan,recomputed,'GPU upload plan');
  const packetMetadata=json(packet.metadata),planSnapshot=json(packet.gpuPlan),entrySnapshot=json(entry),generation=tile.generation,rootState=json({matrixWorld:root.matrixWorld.toArray(),visible:root.visible});
  const descriptors=new Map(recomputed.buffers.map(d=>[d.key,d])),attributeObjects=new Map(),bufferKeys=new Map(),arrayAudits=new Map(),bound=new Map();
  for(let i=0;i<root.children.length;i++) {
    const mesh=root.children[i],m=packet.metadata.meshes[i],bindings=recomputed.meshes[i],g=mesh.geometry;
    if(!mesh.isMesh||mesh.isInstancedMesh||mesh.isSkinnedMesh||mesh.parent!==root||mesh.name!==(m.name||''))throw Error('render mesh identity unsupported/mismatch');
    assertMatrixFresh(mesh);equal(mesh.userData,m.userData||{},'render mesh userData');
    equal(Object.keys(g.attributes).sort(),Object.keys(bindings.attributes).sort(),'render attribute names');
    equal(g.drawRange,{start:m.drawRange?.start||0,count:m.drawRange?.count??Infinity},'render draw range');
    const attributes={},layouts=[];
    const resolve=(binding,actual,label)=>{
      const d=descriptors.get(binding),a=packet.arrays[d?.array];
      if(!d||!ArrayBuffer.isView(a)||a instanceof DataView||a.constructor.name!==d.type||a.length/d.itemSize!==d.count)throw Error('packet array layout mismatch: '+label);
      if(enums[d.type]==null||!actual?.isGLBufferAttribute||!actual.buffer||actual.type!==enums[d.type]||actual.itemSize!==d.itemSize||actual.elementSize!==a.BYTES_PER_ELEMENT||actual.count!==d.count||!!actual.normalized!==!!d.normalized)throw Error('render GL layout mismatch: '+label);
      if(attributeObjects.has(binding)&&attributeObjects.get(binding)!==actual)throw Error('shared GPU attribute identity mismatch');
      if(bufferKeys.has(actual.buffer)&&bufferKeys.get(actual.buffer)!==binding)throw Error('distinct GPU bindings alias one buffer');
      attributeObjects.set(binding,actual);bufferKeys.set(actual.buffer,binding);
      const layout={binding,packetArray:d.array,...arrayLayout(a),itemSize:d.itemSize,normalized:!!d.normalized,count:d.count,glType:actual.type,glElementSize:actual.elementSize,gpuUploadByteOffset:0};
      layouts.push({label,...layout});
      if(!arrayAudits.has(d.array))arrayAudits.set(d.array,{array:a,layout:arrayLayout(a),sha256:hash(a)});
      return {array:a,itemSize:d.itemSize,normalized:!!d.normalized};
    };
    // Queue hashes once, outside runtime rendering. All mapped views retain byte offsets.
    for(const [name,binding]of Object.entries(bindings.attributes))attributes[name]=resolve(binding,g.attributes[name],name);
    const index=bindings.index?resolve(bindings.index,g.index,'index'):null;
    if(!bindings.index&&g.index)throw Error('unexpected render index');
    if(index&&(!['Uint8Array','Uint16Array','Uint32Array'].includes(index.array.constructor.name)||index.itemSize!==1))throw Error('unsupported element index layout');
    const state=meshState(mesh),attributeSnapshot={...g.attributes},indexSnapshot=g.index;
    const glSnapshots=[...Object.values(g.attributes),...(g.index?[g.index]:[])].map(a=>({attribute:a,buffer:a.buffer,layout:json(glLayout(a))}));
    bound.set(mesh,{i,geometry:g,material:mesh.material,state:json(state),attributeSnapshot,indexSnapshot,glSnapshots,
      cpu:{attributes,index,groups:g.groups.map(group=>({...group})),drawRange:{...g.drawRange},morphAttributes:g.morphAttributes},
      receipt:{meshIndex:i,name:mesh.name,meshUUID:mesh.uuid,geometryUUID:g.uuid,...state,terrainTransform:m.userData?.terrainDecode||null,layouts}});
  }
  const arrayReceipts=[];
  for(const [index,a]of arrayAudits)arrayReceipts.push({packetArray:index,...a.layout,sha256:await a.sha256});
  const assertStable=()=>{
    if(stream.disposed||stream.manifest.world!==expected.worldId||stream.manifest.revision!==expected.worldSetRevision||stream.entry(key)!==entry||json(entry)!==entrySnapshot||stream.tiles.get(key)!==tile||tile.state!=='active'||tile.generation!==generation||tile.packet!==packet||tile.handle?.root!==root)throw Error('stale active packet/handle identity');
    if(json({matrixWorld:root.matrixWorld.toArray(),visible:root.visible})!==rootState)throw Error('stale rendered root state');
    if(json(packet.metadata)!==packetMetadata||json(packet.gpuPlan)!==planSnapshot||root.name!=='tile:'+key||root.children.length!==bound.size)throw Error('stale packet metadata/upload plan');
    for(const [i,a]of arrayAudits)if(packet.arrays[i]!==a.array||json(arrayLayout(a.array))!==json(a.layout))throw Error('stale packet array view');
    for(const [mesh,b]of bound){if(root.children[b.i]!==mesh||mesh.parent!==root||mesh.geometry!==b.geometry||mesh.material!==b.material||mesh.geometry.index!==b.indexSnapshot||json(meshState(mesh))!==b.state)throw Error('stale rendered mesh state');for(const[name,a]of Object.entries(b.attributeSnapshot))if(mesh.geometry.attributes[name]!==a)throw Error('stale rendered attribute identity');for(const a of b.glSnapshots)if(a.attribute.buffer!==a.buffer||json(glLayout(a.attribute))!==a.layout)throw Error('stale rendered GL layout/buffer');}
  };
  assertStable();
  const receipt={schemaVersion:1,key,cellSha256:entry.sha256,worldId:stream.manifest.world,worldSetRevision:stream.manifest.revision,sourceWorld:world,sourceRevision:revision,activeGeneration:generation,
    integrityBasis:'manifest SHA plus native active packet; worker fetch path verifies compressed source SHA before derive/upload; this binding does not read back GPU bytes or independently rehash compressed input',
    rootUUID:root.uuid,rootVisible:root.visible,rootMatrixWorld:root.matrixWorld.toArray(),arrays:arrayReceipts,meshes:[...bound.values()].map(b=>b.receipt)};
  return {receipt,assertStable,
    async assertArrayBytesUnchanged(){assertStable();for(const r of arrayReceipts)if(await hash(packet.arrays[r.packetArray])!==r.sha256)throw Error('packet array content changed');assertStable();},
    wrap(mesh){assertStable();const b=bound.get(mesh);if(!b)throw Error('mesh outside authenticated active tile binding');return wrapProbeMesh(mesh,{geometry:b.cpu});}
  };
}
