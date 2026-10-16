import{test}from'node:test';import assert from'node:assert/strict';import{mkdtemp,readFile,writeFile,rm}from'node:fs/promises';import{tmpdir}from'node:os';import{resolve}from'node:path';import{createHash}from'node:crypto';
import{stageWorldArtifact}from'./world-artifacts.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
async function fixture(){const root=await mkdtemp(resolve(tmpdir(),'awt-artifact-')),body=Buffer.from('tile-Atile-B'),name=`region-${hash(body).slice(0,16)}.awt`,entry=(offset)=>({url:`./${name}`,sha256:hash(body.subarray(offset,offset+6)),bytes:6,decodedBytes:100,triangles:0,dependencies:[],range:{offset,length:6}}),m={tileVersion:1,tileMetres:512,world:'athens',revision:'test',projection:{lat0:37.98,lon0:23.73,mlat:111320,mlon:87700},spawn:{cell:[0,0],anchor:'spawn:0'},tiles:{'0,0':entry(0),'1,0':entry(6)}};await writeFile(resolve(root,name),body);const path=resolve(root,'world.json');await writeFile(path,JSON.stringify(m));return{root,path,m,name,body};}
test('external packed worlds stage one immutable bundle and a hashed manifest without Git blobs',async()=>{
 const f=await fixture(),out=await mkdtemp(resolve(tmpdir(),'awt-release-'));
 try{const result=await stageWorldArtifact(f.path,out);assert.equal(result.tiles,2);assert.equal(result.files,2);assert.equal(result.tileBytes,12);assert.match(result.manifest,/data\/worlds\/athens\/[a-f0-9]{16}\/world.json$/);const path=resolve(out,result.manifest);assert.deepEqual(await readFile(path),await readFile(f.path));assert.deepEqual(await readFile(resolve(path,'../',f.name)),f.body);assert.equal((await stageWorldArtifact(f.path,out)).manifest,result.manifest);}finally{await rm(f.root,{recursive:true,force:true});await rm(out,{recursive:true,force:true});}
});
test('publication rejects corrupted range members and content-hash names before copying',async()=>{
 const f=await fixture(),out=await mkdtemp(resolve(tmpdir(),'awt-release-'));
 try{f.m.tiles['1,0'].sha256='0'.repeat(64);await writeFile(f.path,JSON.stringify(f.m));await assert.rejects(stageWorldArtifact(f.path,out),/tile integrity/);await assert.rejects(readFile(resolve(out,'data/worlds/athens/world.json')));await writeFile(resolve(f.root,f.name),Buffer.from('tile-Xtile-B'));await assert.rejects(stageWorldArtifact(f.path,out),/content hashed/);}finally{await rm(f.root,{recursive:true,force:true});await rm(out,{recursive:true,force:true});}
});
test('external publication rejects assets outside the artifact directory',async()=>{
 const f=await fixture(),out=await mkdtemp(resolve(tmpdir(),'awt-release-'));
 try{f.m.tiles['0,0'].url='../world.json';await writeFile(f.path,JSON.stringify(f.m));await assert.rejects(stageWorldArtifact(f.path,out));}finally{await rm(f.root,{recursive:true,force:true});await rm(out,{recursive:true,force:true});}
});

test('public release staging rejects explicitly private or incomplete manifests',async()=>{
 const f=await fixture(),out=await mkdtemp(resolve(tmpdir(),'awt-release-'));
 try{for(const flags of [{developmentOnly:true},{releaseReady:false}]){await writeFile(f.path,JSON.stringify({...f.m,...flags}));await assert.rejects(stageWorldArtifact(f.path,out),/Development-only/);}}finally{await rm(f.root,{recursive:true,force:true});await rm(out,{recursive:true,force:true});}
});
