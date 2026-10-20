// Draw calls, triangles and texture memory in a dense centre cell, World detail On and Off.
// node measure.mjs APP CELLSDIR OUT.json   (APP = a game tree, CELLSDIR = a local bake's cells directory)
import {writeFile} from 'node:fs/promises';import {startServer,launch,counters} from './lib.mjs';
const [app,r2,out]=process.argv.slice(2),c=counters(),{server,port}=await startServer({app,r2,c});const {browser,page}=await launch();
const spots={syntagma:[421,501],parliament:[521,531]};const result={};
try{
  await page.goto(`http://127.0.0.1:${port}/?map=athens`,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__athens,null,{timeout:600000});
  for(const [name,[x,z]] of Object.entries(spots)){
    await page.evaluate(async([x,z])=>{const A=window.__athens;const near=()=>[...A.roads.anchors({validate:true})].sort((a,b)=>Math.hypot(a.x-x,a.z-z)-Math.hypot(b.x-x,b.z-z))[0];let a=near();
      for(let i=0;i<4&&(!a||Math.hypot(a.x-x,a.z-z)>60);i++){await A.stream.teleport({x,z},()=>{});await new Promise(r=>setTimeout(r,4000));a=near();}
      await A.goto(a.id,a.x,a.z);A.setPaused(true);},[x,z]);
    // wait until the stream has settled (the resident bytes unchanged for eight seconds), so every run sees the same cells
    {let last=-1,stable=0;for(let i=0;i<60&&stable<4;i++){await page.waitForTimeout(2000);const v=await page.evaluate(()=>window.__athens.inventory().tileJS);stable=v===last?stable+1:0;last=v;}}
    for(const detail of [true,false]){
      result[`${name}-${detail?'on':'off'}`]=await page.evaluate(async detail=>{
        const {setSetting}=await import('/src/settings.js');setSetting('worldDetail',detail);await new Promise(r=>setTimeout(r,400));
        const A=window.__athens,i=A.renderer.info;i.autoReset=false;const frames=[];let calls=0,tris=0;
        for(let k=0;k<30;k++){i.reset();const t=performance.now();A.render(.016);frames.push(performance.now()-t);calls=i.render.calls;tris=i.render.triangles;}
        i.autoReset=true;frames.sort((a,b)=>a-b);const inv=A.inventory();
        return {calls,triangles:tris,textures:i.memory.textures,geometries:i.memory.geometries,medianRenderCallMs:+frames[15].toFixed(1),gpuBytes:inv.gpu,tileGPU:inv.tileGPU,tileJS:inv.tileJS,props:A.props?.stats||null,landmarks:A.landmarks?.stats||null,horizon:A.horizon?.stats||null};
      },detail);
      console.log(name,detail?'on':'off',JSON.stringify(result[`${name}-${detail?'on':'off'}`]));
    }
  }
}catch(e){result.failure=e.stack;console.log(e.stack);}finally{await browser.close();server.close();await writeFile(out,JSON.stringify(result,null,1));}
