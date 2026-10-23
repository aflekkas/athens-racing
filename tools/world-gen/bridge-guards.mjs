// Offline only: authenticate before refinement; rebuild after terrain/paint and
// before packTiles. Identity and authoritative budget changes belong to caller's
// final pack stage. Never changes contacts, beams, fascia or collision rails.
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {readFileSync} from 'node:fs';
import {decodeTilePack} from '../../src/world-tile-codec.js';
import {TILE_TABLES,TILE_COMPACT_TABLES,validateWorldTile} from '../../src/world-tile-format.js';
const authored=JSON.parse(readFileSync(new URL('./areas/authored-guard-preservation.json',import.meta.url),'utf8'));
const recipes=new WeakMap(),proofs=new WeakMap(),EPS=1e-6;
const hash=v=>createHash('sha256').update(v).digest('hex');
const canonical=v=>JSON.stringify(sort(v));
function sort(v){return Array.isArray(v)?v.map(sort):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sort(v[k])])):v;}
const bytes=a=>Buffer.from(a.buffer,a.byteOffset,a.byteLength);
const fail=s=>{throw Error('Bridge guard repair: '+s);};
const equal=(a,b)=>canonical(a)===canonical(b);
const guardMeshes=p=>p.metadata.meshes.filter(m=>m.userData?.bridgeGuard);
function physicalHash(p){
 const h=createHash('sha256');h.update(canonical({ids:p.metadata.ids,strings:p.metadata.strings,origin:p.metadata.origin,terrain:p.metadata.terrain}));
 for(const name of [...Object.keys(TILE_TABLES),...Object.keys(TILE_COMPACT_TABLES)])if(p.metadata.tables[name]!=null){const a=p.arrays[p.metadata.tables[name]];h.update(name+':'+a.constructor.name+':');h.update(bytes(a));}
 return h.digest('hex');
}
export function bridgeGuardSourceFingerprint(p){return hash(canonical({structures:p.metadata.structures,rails:p.metadata.rails,palette:p.metadata.palette,meshes:guardMeshes(p).map(m=>{
 const {attributes,index,...rest}=m;return {...rest,attributes:Object.fromEntries(Object.entries(attributes).map(([k,a])=>{const v=p.arrays[a.array];return[k,{...a,array:undefined,type:v.constructor.name,hash:hash(bytes(v))}];})),index:{type:p.arrays[index].constructor.name,hash:hash(bytes(p.arrays[index]))}};
})}));}
function wholeHash(p){const h=createHash('sha256');h.update(canonical(p.metadata));for(const a of p.arrays){h.update(a.constructor.name+':');h.update(bytes(a));}return h.digest('hex');}
/** Compile with compile-bridge-guards.py; accompany it with the ORIGINAL plan bytes. */
export function readBridgeGuardRecipe({compiledBytes,sourcePlanBytes}){
 const recipe=JSON.parse(Buffer.from(compiledBytes).toString()),plan=JSON.parse(Buffer.from(sourcePlanBytes).toString());
 if(typeof recipe.sourceWorld!=='string'||!recipe.sourceWorld||recipe.version!==1||recipe.kind!=='osm-bridge-guard-posts'||recipe.sourcePlanSha256!==hash(sourcePlanBytes)||recipe.area!==plan.area||!Array.isArray(recipe.components)||!Array.isArray(recipe.groups))fail('source plan/recipe provenance mismatch');
 const groups=[...plan.groups].sort((a,b)=>a.id.localeCompare(b.id)).map(g=>({id:g.id,bridgeSources:g.bridgeSources,upper:g.upper}));
 // Python sorts IDs by code point, which localeCompare does not guarantee.
 groups.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
 if(!equal(groups,recipe.groups))fail('recipe group provenance mismatch');
 for(const component of recipe.components){if(!Array.isArray(component)||!component.length)fail('empty plan component');for(const ring of component)if(!Array.isArray(ring)||ring.length<3||ring.some(p=>!Array.isArray(p)||p.length!==2||p.some(v=>!Number.isFinite(v))))fail('invalid plan ring');}
 const token=Object.freeze({sourcePlanSha256:recipe.sourcePlanSha256,area:recipe.area,recipeHash:hash(canonical(recipe))});recipes.set(token,recipe);return token;
}
function onSegment(x,z,a,b){const dx=b[0]-a[0],dz=b[1]-a[1],l2=dx*dx+dz*dz;if(l2<1e-18)return false;const f=((x-a[0])*dx+(z-a[1])*dz)/l2;return f>=-1e-9&&f<=1+1e-9&&Math.abs((x-a[0])*dz-(z-a[1])*dx)/Math.sqrt(l2)<=EPS;}
function ownsRail(r,ring,origin){const a=[r[0]+origin[0],r[2]+origin[2]],b=[r[3]+origin[0],r[5]+origin[2]];return ring.some((p,i)=>{const q=ring[(i+1)%ring.length];return onSegment(...a,p,q)&&onSegment(...b,p,q);});}
function matchPlan(p,tokens){
 const m=p.metadata,matches=[];
 for(const token of tokens){const recipe=recipes.get(token);if(!recipe)fail('unsealed source recipe');if(recipe.sourceWorld!==m.world)continue;const byid=new Map(recipe.groups.map(g=>[g.id,g]));
  if(!(m.structures||[]).every(s=>{const g=byid.get(s.id);return s.kind==='osm-bridge-guarded'&&g&&s.layer===1&&s.roads.every(r=>g.upper.includes(r))&&s.bridgeSources.every(r=>g.bridgeSources.includes(r));}))continue;
  const rings=recipe.components.flat(),selected=new Set();let supported=true;
  for(const r of m.rails){const owners=[];for(let i=0;i<rings.length;i++)if(ownsRail(r,rings[i],m.origin))owners.push(i);if(owners.length!==1){supported=false;break;}selected.add(owners[0]);}
  if(!supported)continue;
  const complete=[...selected].map(i=>rings[i]).sort((a,b)=>canonical(a)<canonical(b)?-1:1),geometryHash=hash(canonical(complete));
  matches.push({token,rings:complete,geometryHash});
 }
 const domains=new Map();for(const match of matches){if(!domains.has(match.geometryHash))domains.set(match.geometryHash,[]);domains.get(match.geometryHash).push(match);}
 if(domains.size!==1)fail('complete source-plan matches '+domains.size+' (unknown/ambiguous plan)');
 const aliases=[...domains.values()][0];return {rings:aliases[0].rings,geometryHash:aliases[0].geometryHash,aliases:aliases.map(a=>a.token)};
}
function layout(p){
 const m=p.metadata,rails=m.rails,all=guardMeshes(p),guards=all.filter(v=>v.material===15);
 if(!guards.length||all.some(v=>![12,15].includes(v.material)))fail('unknown guard material/layout');
 const first=guards[0],position=first.attributes.position?.array,index=first.index;
 if(guards.some(v=>v.attributes.position?.array!==position||v.index!==index||Object.keys(v.attributes).join(',')!=='position'||v.userData?.terrainDecode||v.bounds))fail('multiple guard buffer domains/layouts');
 const pos=p.arrays[position],ix=p.arrays[index];if(!(pos instanceof Float32Array)||![Uint16Array,Uint32Array].includes(ix.constructor)||pos.length!==rails.length*48||ix.length!==rails.length*48)fail('unknown original beam/post layout');
 const ranges=guards.map(v=>v.drawRange||{start:0,count:ix.length}).sort((a,b)=>a.start-b.start);let at=0;for(const r of ranges){if(r.start!==at||r.count%3)fail('guard draw chunk gap/overlap');at+=r.count;}if(at!==ix.length)fail('incomplete guard draw chunks');
 for(let r=0;r<rails.length;r++){for(let k=0;k<48;k++){const v=ix[r*48+k]-r*16;if(v<0||v>=16||(k<18?v>=8:v<8))fail('unknown original beam/post index ownership');}}
 for(const other of m.meshes)if(!guards.includes(other)&&(other.index===index||Object.values(other.attributes).some(a=>a.array===position||a.array===index)))fail('guard buffers are shared outside guard domain');
 if(Object.values(m.tables).some(i=>i===position||i===index))fail('guard buffers alias physical tables');
 for(const group of Object.values(m.extensions?.worldDetail||{}))if(group&&typeof group==='object'&&Object.values(group).some(i=>i===position||i===index))fail('guard buffers alias world detail');
 return {guards,position,index,pos,ix};
}
/** Sealed source proof. compressedBytes must be the immutable ORIGINAL cell. */
export async function prepareBridgeGuardRepair({compressedBytes,entry,world,revision,cell},sourceRecipes){
 if(!entry||compressedBytes.byteLength!==entry.bytes||hash(compressedBytes)!==entry.sha256)fail('original compressed authentication failed');
 const raw=gunzipSync(compressedBytes,{maxOutputLength:entry.decodedBytes}),size=raw.readUInt32LE(4);if(size>raw.length-12)fail('source metadata header');const m=JSON.parse(raw.subarray(12,12+size));
 if(m.world!==world||m.revision!==revision||!equal(m.cell,cell))fail('original source identity mismatch');
 if(entry.source&&(entry.source.world!==world||entry.source.revision!==revision))fail('entry source identity mismatch');
 if(!['athens-east-development','penteli','megara'].includes(world)&&!sourceRecipes.some(t=>recipes.get(t)?.sourceWorld===world))fail('unknown source world');
 const preserve=authored.cells.find(v=>v.world===world&&v.revision===revision&&equal(v.cell,cell)&&v.sha256===entry.sha256);
 if(preserve){
  const p=await decodeTilePack(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength),entry.decodedBytes);validateWorldTile(p);
  const ids=[...new Set((m.structures||[]).flatMap(s=>s.bridgeSources))].sort((a,b)=>a-b);
  if(!equal(ids,preserve.bridgeSources)||bridgeGuardSourceFingerprint(p)!==preserve.guardFingerprint)fail('authored source guard binding changed');
  const token=Object.freeze({kind:'sealed-bridge-guard-proof',mode:'preserve-authored',sourceSha256:entry.sha256});proofs.set(token,{authored:true,used:false,sourceSha256:entry.sha256,identity:{world,revision,cell},wholeHash:wholeHash(p)});return token;
 }
 const token=Object.freeze({kind:'sealed-bridge-guard-proof',mode:m.rails?.length?'repair':'no-guards',sourceSha256:entry.sha256});
 if(!(m.rails?.length)){if(guardMeshes({metadata:m}).length)fail('unlisted guard mesh without rails');proofs.set(token,{noop:true,used:false,sourceSha256:entry.sha256,identity:{world,revision,cell},noopSignature:canonical({structures:m.structures,rails:m.rails,meshes:guardMeshes({metadata:m})})});return token;}
 if(!m.structures?.length||!m.rails?.length)fail('guard geometry without supported source structures');
 const p=await decodeTilePack(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength),entry.decodedBytes);validateWorldTile(p);const l=layout(p),match=matchPlan(p,sourceRecipes);
 const state={used:false,sourceSha256:entry.sha256,identity:{world,revision,cell},physicalHash:physicalHash(p),guardHash:bridgeGuardSourceFingerprint(p),match,postsBefore:m.rails.length,guardMeshesBefore:l.guards.length,trianglesBefore:l.ix.length/3,arrayBytesBefore:l.pos.byteLength+l.ix.byteLength};proofs.set(token,state);return token;
}
function* stations(rings,origin){
 const [ox,,oz]=origin;for(const ring of rings){let station=0;for(let i=0;i<ring.length;i++){
  const a=ring[i],b=ring[(i+1)%ring.length],length=Math.hypot(b[0]-a[0],b[1]-a[1]);if(length<1e-9)continue;
  if(Math.max(a[0],b[0])>=ox&&Math.min(a[0],b[0])<=ox+512&&Math.max(a[1],b[1])>=oz&&Math.min(a[1],b[1])<=oz+512){
   for(let at=Math.ceil((station-1e-8)/4)*4;at<station+length-1e-8;at+=4){const f=Math.max(0,Math.min(1,(at-station)/length));let x=a[0]+(b[0]-a[0])*f,z=a[1]+(b[1]-a[1])*f;
    for(const border of [ox,ox+512])if(Math.abs(x-border)<1e-8)x=border;for(const border of [oz,oz+512])if(Math.abs(z-border)<1e-8)z=border;
    if(x>=ox&&x<ox+512&&z>=oz&&z<oz+512)yield[x-ox,z-oz];
   }
  }station+=length;
 }}
}
function post(P,I,r,at){
 const dx=r[3]-r[0],dz=r[5]-r[2],length=Math.hypot(dx,dz),lo=Math.max(0,at-.06),hi=Math.min(length,at+.06);if(hi-lo<1e-6)return;
 const ax=r[0]+dx*lo/length,az=r[2]+dz*lo/length,bx=r[0]+dx*hi/length,bz=r[2]+dz*hi/length,ya=r[1]+(r[4]-r[1])*lo/length,yb=r[1]+(r[4]-r[1])*hi/length,rx=-dz/length*.06,rz=dx/length*.06,start=P.length/3;
 for(const y of [.1,.65])for(const [x,z,h]of [[ax-rx,az-rz,ya],[ax+rx,az+rz,ya],[bx+rx,bz+rz,yb],[bx-rx,bz-rz,yb]])P.push(x,h+y,z);
 const c=[0,0,0];for(let i=0;i<8;i++)for(let k=0;k<3;k++)c[k]+=P[(start+i)*3+k]/8;
 for(const q of [[0,3,7,4],[1,2,6,5],[4,5,6,7],[0,1,5,4],[3,2,6,7]]){
  let v=q.map(i=>start+i);const p=v.map(i=>P.slice(i*3,i*3+3)),a=p[0],b=p[1],d=p[2],n=[(b[1]-a[1])*(d[2]-a[2])-(b[2]-a[2])*(d[1]-a[1]),(b[2]-a[2])*(d[0]-a[0])-(b[0]-a[0])*(d[2]-a[2]),(b[0]-a[0])*(d[1]-a[1])-(b[1]-a[1])*(d[0]-a[0])],mid=[0,1,2].map(k=>p.reduce((s,a)=>s+a[k]/4,0)-c[k]);
  if(n.reduce((s,x,k)=>s+x*mid[k],0)<0)v=v.reverse();I.push(v[0],v[1],v[2],v[0],v[2],v[3]);
 }
}
/** Metadata-only planning report, NEVER a repair authorization/proof. */
export function planBridgeGuardRepair(metadata,sourceRecipes,sourceSha256=null){
 const m=metadata,guards=guardMeshes({metadata:m}).filter(v=>v.material===15);
 const native=authored.cells.find(v=>v.world===m.world&&v.revision===m.revision&&equal(v.cell,m.cell));if(native&&sourceSha256!==native.sha256)fail('authored metadata source SHA mismatch');if(native)return {required:false,preserveOriginal:true,expectedSourceSha256:native.sha256,reason:'explicit authored source preservation',postsBefore:null,postsAfter:null,guardMeshesBefore:guardMeshes({metadata:m}).length,guardMeshesAfter:guardMeshes({metadata:m}).length,triangleDelta:0,arrayBytesDelta:0,recipeHash:null};
 if(!m.rails?.length){if(guardMeshes({metadata:m}).length)fail('unlisted guard mesh without rails');return {required:false,postsBefore:0,postsAfter:0,guardMeshesBefore:0,guardMeshesAfter:0,triangleDelta:0,arrayBytesDelta:0,recipeHash:null};}
 const match=matchPlan({metadata:m},sourceRecipes),p=m.views[guards[0]?.attributes.position.array],ix=m.views[guards[0]?.index];
 if(!p||!ix||p.type!=='Float32Array'||!['Uint16Array','Uint32Array'].includes(ix.type)||p.length!==m.rails.length*48||ix.length!==m.rails.length*48)fail('metadata has unknown original guard layout');
 let postsAfter=0;for(const [x,z]of stations(match.rings,m.origin))for(const r of m.rails){const dx=r[3]-r[0],dz=r[5]-r[2],length=Math.hypot(dx,dz),f=((x-r[0])*dx+(z-r[2])*dz)/(length*length);if(f< -1e-8||f>1+1e-8||Math.abs((x-r[0])*dz-(z-r[2])*dx)/length>1e-7)continue;postsAfter++;break;}
 const width=ix.type==='Uint16Array'?2:4,trianglesAfter=m.rails.length*6+postsAfter*10,trianglesBefore=ix.length/3,arrayBytesBefore=p.length*4+ix.length*width,arrayBytesAfter=(m.rails.length+postsAfter)*24*4+trianglesAfter*3*width;
 return {required:true,postsBefore:m.rails.length,postsAfter,guardMeshesBefore:guards.length,guardMeshesAfter:Math.ceil(trianglesAfter/16000),trianglesBefore,trianglesAfter,triangleDelta:trianglesAfter-trianglesBefore,arrayBytesBefore,arrayBytesAfter,arrayBytesDelta:arrayBytesAfter-arrayBytesBefore,recipeHash:match.geometryHash,sourcePlans:match.aliases.map(a=>({...a}))};
}
/** Mutates dedicated guard buffers only. Apply report.triangleDelta at PACK stage. */
export function rebuildBridgeGuards(pack,proof){
 const s=proofs.get(proof);if(!s||s.used)fail('missing/consumed sealed original proof');const m=pack.metadata;if(m.world!==s.identity.world||m.revision!==s.identity.revision||!equal(m.cell,s.identity.cell))fail('identity changed before guard repair');
 if(s.authored){if(wholeHash(pack)!==s.wholeHash)fail('authored source changed; must preserve original bytes');s.used=true;return Object.freeze({changed:false,preserveOriginal:true,sourceSha256:s.sourceSha256,triangleDelta:0,arrayBytesDelta:0,recipeHash:null,reason:'explicit authored source preservation'});}
 if(s.noop){if(canonical({structures:m.structures,rails:m.rails,meshes:guardMeshes(pack)})!==s.noopSignature)fail('guard data changed after no-op proof');s.used=true;return Object.freeze({changed:false,triangleDelta:0,arrayBytesDelta:0,postsBefore:0,postsAfter:0,guardMeshesBefore:0,guardMeshesAfter:0,recipeHash:null,sourceSha256:s.sourceSha256});}
 if(physicalHash(pack)!==s.physicalHash||bridgeGuardSourceFingerprint(pack)!==s.guardHash)fail('physical support/rail/beam/guard changed; original source reproof required');
 const l=layout(pack),P=[],I=[];for(let r=0;r<m.rails.length;r++){for(let k=0;k<24;k++)P.push(l.pos[r*48+k]);for(let k=0;k<18;k++)I.push(l.ix[r*48+k]-r*8);}
 let postsAfter=0;for(const [x,z]of stations(s.match.rings,m.origin))for(const r of m.rails){const dx=r[3]-r[0],dz=r[5]-r[2],length=Math.hypot(dx,dz),f=((x-r[0])*dx+(z-r[2])*dz)/(length*length);if(f< -1e-8||f>1+1e-8||Math.abs((x-r[0])*dz-(z-r[2])*dx)/length>1e-7)continue;post(P,I,r,Math.max(0,Math.min(length,f*length)));postsAfter++;break;}
 const pos=Float32Array.from(P),ix=new l.ix.constructor(I);if(I.some((v,i)=>ix[i]!==v)||P.length>l.pos.length)fail('guard resource/index budget increased');
 const meshes=[];for(let start=0;start<ix.length;start+=16000*3)meshes.push({...l.guards[0],attributes:{position:{...l.guards[0].attributes.position,array:l.position}},index:l.index,drawRange:{start,count:Math.min(16000*3,ix.length-start)}});
 const next=[];let added=false;for(const v of m.meshes){if(l.guards.includes(v)){if(!added){next.push(...meshes);added=true;}}else next.push(v);}
 pack.arrays[l.position]=pos;pack.arrays[l.index]=ix;m.meshes=next;s.used=true;
 return Object.freeze({changed:true,sourceSha256:s.sourceSha256,recipeHash:s.match.geometryHash,sourcePlans:s.match.aliases.map(a=>({...a})),postsBefore:s.postsBefore,postsAfter,guardMeshesBefore:s.guardMeshesBefore,guardMeshesAfter:meshes.length,trianglesBefore:s.trianglesBefore,trianglesAfter:ix.length/3,triangleDelta:ix.length/3-s.trianglesBefore,arrayBytesBefore:s.arrayBytesBefore,arrayBytesAfter:pos.byteLength+ix.byteLength,arrayBytesDelta:pos.byteLength+ix.byteLength-s.arrayBytesBefore});
}
