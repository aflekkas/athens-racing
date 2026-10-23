// Actual-game material proof, run only after a coordinated browser-slot grant.
// Two sequential invocations (before/after) must pin the same world and cases.
// No source substitutions: sourceRoot must already contain the committed build.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {registerHooks} from 'node:module';
import {chromium} from 'playwright';
const required=name=>{assert.ok(process.env[name],`${name} is required`);return process.env[name];};
const root=resolve(required('TERRAIN_ROOT')),commit=required('TERRAIN_COMMIT');
const temp=resolve(required('TERRAIN_TEMP')),out=resolve(required('TERRAIN_OUT'));
const phase=required('TERRAIN_PHASE');assert.ok(['before','after'].includes(phase));
const manifestHash=required('TERRAIN_MANIFEST_SHA256'),worldRevision=required('TERRAIN_WORLD_REVISION');
const cases=JSON.parse(await fs.readFile(required('TERRAIN_CASES'),'utf8'));
assert.ok(Array.isArray(cases)&&cases.length>0&&cases.length<=4);
for(const c of cases){assert.ok(c.id&&c.camera?.position?.length===3&&c.camera?.lookAt?.length===3&&c.spawn?.length===2&&c.pickPixels?.length);}
const hash=b=>createHash('sha256').update(b).digest('hex');
const report={status:'preparing',phase,sourceRoot:root,sourceCommit:commit,sourceInjection:false,worldRevision,manifestHash,casesHash:hash(JSON.stringify(cases)),sources:{},errors:[],consoleErrors:[],runs:[],limits:['static native camera/material proof, not surveyed terrain or driving performance','CPU packet-triangle picks exclude separate instanced vegetation; visible selected terrain must also be inspected in the fresh image']};
// Verify every runtime module against Git objects before a server/browser exists.
const tree=execFileSync('git',['ls-tree','-rz',commit,'src','index.html'],{cwd:root}).toString().split('\0').filter(Boolean).map(s=>{const [header,path]=s.split('\t');return{oid:header.split(' ')[2],path};}).filter(x=>x.path==='index.html'||x.path.endsWith('.js'));
const blobs=execFileSync('git',['cat-file','--batch'],{cwd:root,input:tree.map(x=>x.oid).join('\n')+'\n',maxBuffer:32*1024*1024});
let cursor=0;
for(const entry of tree){const end=blobs.indexOf(10,cursor),size=Number(blobs.subarray(cursor,end).toString().split(' ')[2]),body=blobs.subarray(end+1,end+1+size);cursor=end+size+2;const actual=await fs.readFile(resolve(root,entry.path));assert.ok(body.equals(actual),'Working source differs from pinned commit: '+entry.path);report.sources[entry.path]=hash(body);}
const sharedWs=import.meta.resolve('ws');registerHooks({resolve(name,context,next){return name==='ws'?{url:sharedWs,shortCircuit:true}:next(name,context);}});
const {start}=await import(pathToFileURL(required('TERRAIN_PROXY_HELPER')).href);
let app,browser;
await fs.mkdir(out,{recursive:true});
const save=()=>fs.writeFile(resolve(out,`${phase}.json`),JSON.stringify(report,null,2));
const deadlineMs=Number(process.env.TERRAIN_DEADLINE_MS||240000);assert.ok(deadlineMs>0&&deadlineMs<=300000);
const deadline=setTimeout(()=>{report.deadlineExceeded=true;void browser?.close();},deadlineMs);deadline.unref();
try{
 app=await start({root,tmp:temp,releaseDir:null});
 for(const path of ['/','/src/athens-materials.js','/data/athens/manifest.json']){const response=await fetch(app.base+path,{signal:AbortSignal.timeout(15000)});assert.equal(response.status,200,'HTTP preflight '+path);const bytes=Buffer.from(await response.arrayBuffer());if(path.endsWith('manifest.json')){assert.equal(hash(bytes),manifestHash,'Exact world manifest pin');report.worldManifest=JSON.parse(bytes);assert.equal(report.worldManifest.revision,worldRevision);}console.log('HTTP_READY',path,bytes.length);}
 if(process.env.TERRAIN_PREFLIGHT==='1'){report.status='preflight-passed';}
 else{
  browser=await chromium.launch({headless:true,executablePath:required('PLAYWRIGHT_EXECUTABLE_PATH'),args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});report.browserVersion=browser.version();
  for(const quality of (process.env.TERRAIN_CLASSES||'low,high').split(','))for(const view of cases){
   const run={quality,case:view.id,camera:view.camera,frames:[]};report.runs.push(run);
   const page=await browser.newPage({viewport:{width:1280,height:800},deviceScaleFactor:1});page.setDefaultTimeout(60000);
   page.on('pageerror',e=>report.errors.push(String(e.stack||e)));
   page.on('console',m=>{if(m.type()==='error'){report.consoleErrors.push(m.text());if(/WebGLProgram|Shader Error|GL_INVALID/.test(m.text()))report.errors.push(m.text());}});
   await page.route('https://cdn.jsdelivr.net/npm/three@0.170.0/**',async route=>route.fulfill({body:await fs.readFile(resolve(import.meta.dirname,'../node_modules/three',route.request().url().split('three@0.170.0/')[1])),contentType:'text/javascript'}));
   await page.addInitScript(quality=>{const raf=requestAnimationFrame;window.requestAnimationFrame=cb=>['frame','tick'].includes(cb.name)?0:raf(cb);localStorage.setItem('paraliaki.settings',JSON.stringify({perfClass:quality,renderScale:1,dynamicResolution:false,worldDetail:true,master:0}));},quality);
   await page.goto(app.base+`/?simhook&map=athens&spawn=${view.spawn.join(',')}&car=mini_jcw&cam=chase&fixedres&notraffic`,{waitUntil:'domcontentloaded'});
   await page.waitForFunction(()=>window.__athens?.player?.veh);
   await page.evaluate(view=>{const a=__athens;a.menu.close?.();a.setPaused(false);a.setCameraHook((camera,v,o)=>{camera.position.set(view.camera.position[0]-o.x,view.camera.position[1],view.camera.position[2]-o.z);camera.lookAt(view.camera.lookAt[0]-o.x,view.camera.lookAt[1],view.camera.lookAt[2]-o.z);camera.fov=view.camera.fov||64.0107664;camera.updateProjectionMatrix();});a.step(1/240,{throttle:0,brake:0,steer:0,handbrake:false});a.render(1/60);},view);
   run.runtime=await page.evaluate(()=>({world:__athens.stream.manifest.world,revision:__athens.stream.manifest.revision,active:[...__athens.stream.tiles].filter(([,t])=>t.state==='active').map(([key,t])=>({key,sha256:__athens.stream.entry(key).sha256,metadataRevision:t.packet.metadata.revision}))}));
   assert.equal(run.runtime.revision,worldRevision);
   // Pick actual CPU packet triangles: positions include exactly the production
   // integer decode and Y residual. No render geometry or contact data is edited.
   run.picks=await page.evaluate(async pixels=>{
    const T=await import('three'),a=__athens,ray=new T.Ray(),cam=a.camera,origin=a.stream.origin;
    const picks=[];
    for(const [px,py]of pixels){ray.origin.copy(cam.position).add(new T.Vector3(origin.x,0,origin.z));ray.direction.set(px/1280*2-1,1-py/800*2,.5).unproject(cam).sub(cam.position).normalize();let nearest=null;
     const A=new T.Vector3(),B=new T.Vector3(),C=new T.Vector3(),hit=new T.Vector3();
     for(const [key,tile]of a.stream.tiles){if(tile.state!=='active')continue;const packet=tile.packet;
      for(const mesh of packet.metadata.meshes){const pa=mesh.attributes.position,position=packet.arrays[pa.array],decode=mesh.userData?.terrainDecode,residual=mesh.attributes.aHeightResidual?packet.arrays[mesh.attributes.aHeightResidual.array]:null,index=mesh.index==null?null:packet.arrays[mesh.index],start=mesh.drawRange?.start||0,count=mesh.drawRange?.count??(index?.length||position.length/3);
       const point=(i,v)=>{for(let axis=0;axis<3;axis++){let value=position[i*pa.itemSize+axis];if(decode){value=Math.fround(decode.offset[axis]+value*decode.scale[axis]);if(axis===1)value=Math.fround(value+residual[i]);}v.setComponent(axis,value+packet.metadata.origin[axis]);}return v;};
       for(let k=start;k<Math.min(start+count,index?.length||position.length/3);k+=3){const indices=[index?index[k]:k,index?index[k+1]:k+1,index?index[k+2]:k+2];point(indices[0],A);point(indices[1],B);point(indices[2],C);if(!ray.intersectTriangle(A,B,C,true,hit))continue;const distance=ray.origin.distanceTo(hit);if(nearest&&distance>=nearest.distance)continue;const surface=mesh.userData?.tileSurface||'basic',attr=mesh.attributes.aCoastColor||mesh.attributes.aRock,values=attr&&packet.arrays[attr.array],channel=mesh.attributes.aCoastColor?3:0;const alpha=values?indices.reduce((sum,i)=>sum+values[i*attr.itemSize+channel]/(attr.normalized?255:1),0)/3:0;nearest={pixel:[px,py],key,surface,name:mesh.name,distance,worldPoint:hit.toArray(),limestoneVertexMean:alpha,triangle:k/3};}
      }
     }picks.push(nearest);
    }return picks;
   },view.pickPixels);
   assert.ok(run.picks.some(p=>p&&['coastalGround','coastalUrban','coastalDetail'].includes(p.surface)&&p.limestoneVertexMean>.8),'An actual picked limestone triangle is required');
   for(const detail of [true,false]){
    const data=await page.evaluate(async detail=>{const{setSetting}=await import('/src/settings.js');const a=__athens,r=a.renderer;setSetting('worldDetail',detail);a.render(0);await r.compileAsync(a.scene,a.camera);a.render(0);const jpeg=r.domElement.toDataURL('image/jpeg',.9).split(',')[1],gl=r.getContext();const resources={memory:{...r.info.memory},programs:r.info.programs.length,materials:new Set(),geometries:new Set(),textures:new Set()};a.scene.traverse(o=>{if(o.geometry)resources.geometries.add(o.geometry);for(const m of [].concat(o.material||[])){resources.materials.add(m);for(const t of Object.values(m))if(t?.isTexture)resources.textures.add(t);}});r.info.autoReset=false;const samples=[];for(let i=0;i<3;i++){r.info.reset();gl.finish();const start=performance.now();a.render(0);gl.finish();samples.push({ms:performance.now()-start,calls:r.info.render.calls,triangles:r.info.render.triangles});}r.info.autoReset=true;return{jpeg,samples,resources:{...resources,materials:resources.materials.size,geometries:resources.geometries.size,textures:resources.textures.size},unrunnable:r.info.programs.filter(p=>p.diagnostics?.runnable===false).map(p=>p.diagnostics),camera:{position:a.camera.position.toArray(),quaternion:a.camera.quaternion.toArray(),origin:{...a.stream.origin}}};},detail);
    assert.deepEqual(data.unrunnable,[],'All full GPU shader programs must compile');const bytes=Buffer.from(data.jpeg,'base64');delete data.jpeg;assert.ok(bytes.length>20000,'Fresh nonempty game frame');const name=`${phase}-${quality}-${view.id}-${detail?'on':'off'}.jpg`;await fs.writeFile(resolve(out,name),bytes);run.frames.push({detail,file:name,sha256:hash(bytes),...data});console.log('PHOTO',resolve(out,name));await save();
   }
   assert.deepEqual(report.errors,[]);await page.close();
  }
  // Fail if a concurrent change made the served runtime differ from the pin.
  for(const [path,sha]of Object.entries(report.sources))assert.equal(hash(await fs.readFile(resolve(root,path))),sha,'Source changed during proof: '+path);
  if(phase==='after'){
   const before=JSON.parse(await fs.readFile(resolve(out,'before.json'),'utf8'));
   for(const key of ['casesHash','worldRevision','manifestHash'])assert.equal(report[key],before[key],'Matched proof '+key);
   assert.equal(before.status,'passed','A fresh completed baseline is required');
   assert.equal(report.runs.length,before.runs.length);
   for(let i=0;i<report.runs.length;i++){
    const a=report.runs[i],b=before.runs[i];
    assert.equal(a.case,b.case);assert.equal(a.quality,b.quality);
    assert.deepEqual(a.runtime.active,b.runtime.active,'Exact admitted cells/identities must match for budgets');
    for(let j=0;j<a.frames.length;j++){
     const af=a.frames[j],bf=b.frames[j];
     assert.deepEqual(af.camera,bf.camera,'Matched camera/origin');
     for(const key of ['materials','geometries','textures'])assert.equal(af.resources[key],bf.resources[key],'No new '+key);
     for(const key of ['calls','triangles'])assert.equal(af.samples[0][key],bf.samples[0][key],'No new rendered '+key);
    }
   }
   report.comparison='matched cases, world, admitted cells, cameras and resource/draw counts; frame samples descriptive only';
  }
  report.status='passed';
 }
}catch(error){report.status='failed';report.failure=String(error.stack||error);throw error;}
finally{clearTimeout(deadline);await browser?.close();await app?.close();await save();}
