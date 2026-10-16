// Transitional three-map adapter. This intentionally retains legacy map/DEM metadata and scenery.
// It is not the Athens generator's final tile-only map loader.
import * as THREE from 'three';
import { WorldTileStream, TileWorkerPool } from './world-tile-stream.js';
import { WorldTileScene } from './world-tile-scene.js';
import { terrainMaterial } from './terrain.js';
import { roadNetworkMaterial } from './road-network.js';
export { legacyTilesEnabled } from './world-tile-flag.js';
export async function loadLegacyTileWorld(map,network,scene,{renderer=null}={}){
  const descriptor=map.data.worldTiles,url=new URL(descriptor.manifest,location.href),response=await fetch(url);
  if(!response.ok)throw new Error(`Tile manifest HTTP ${response.status}`);
  const manifest=await response.json();
  // A failed seam validation must never become a drivable experiment.
  if(manifest.migration?.seamFailures)throw new Error(`Tile migration has ${manifest.migration.seamFailures} invalid seams`);
  const root=new THREE.Group();root.name='streamed-surfaces';scene.add(root);
  const originUniform={value:new THREE.Vector2()};
  const materialFactory=(kind,rgb,vertexColors)=>{
    if(kind!=='terrain'&&kind!=='network')return new THREE.MeshBasicMaterial({color:new THREE.Color(...rgb),vertexColors});
    const material=kind==='terrain'?terrainMaterial({farmland:map.id==='megara'}):roadNetworkMaterial(),compile=material.onBeforeCompile,key=material.customProgramCacheKey();
    material.onBeforeCompile=(shader,r)=>{compile.call(material,shader,r);shader.uniforms.awtOrigin=originUniform;shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nuniform vec2 awtOrigin;')
      .replace('vWP = (modelMatrix * vec4(transformed,1.0)).xyz;','vWP = (modelMatrix * vec4(transformed,1.0)).xyz + vec3(awtOrigin.x,0.,awtOrigin.y);')
      .replace('nWorld=(modelMatrix*vec4(position,1.)).xz;','nWorld=(modelMatrix*vec4(position,1.)).xz + awtOrigin;');};
    material.customProgramCacheKey=()=>key+':awt-origin-v1';return material;
  };
  const adapter=new WorldTileScene(root,{renderer,materialFactory}),pool=new TileWorkerPool({url:new URL(descriptor.worker||'./src/world-tile-worker.js',location.href)});
  const stream=new WorldTileStream(manifest,{baseURL:url.href,load:(job,signal)=>pool.load(job,signal),adapter,safetyRing:map.id==='megara'?0:1,capBytes:(map.id==='megara'?8:96)*1024*1024,transientBytes:64*1024*1024});
  const rebase=adapter.rebase.bind(adapter);adapter.rebase=origin=>{originUniform.value.set(origin.x,origin.z);root.position.set(origin.x,0,origin.z);rebase(origin);};
  const oldRefined=map.terrain.refinedHeight,oldMeshHeight=network.meshHeight;
  const terrainHeight=(x,z)=>stream.contact(x,z,{requiredFlags:2})?.y??map.terrain.height(x,z);
  map.terrain.refinedHeight=terrainHeight;
  network.meshHeight=(x,z)=>stream.contact(x,z,{referenceY:oldMeshHeight.call(network,x,z)??network.baseHeight(x,z),requiredFlags:1})?.y??null;
  // Use global source heights for route grading, not a second full conformed-grid allocation.
  const start=map.route.point(map.route.start,0);
  try{
    if(!manifest.renderVariants?.length)throw new Error('Tile manifest lacks startup render layouts');
    await adapter.prewarm(manifest.renderVariants);
    stream.update({x:start.x,z:start.z});
    await stream.teleport(start,()=>{},{});
  }catch(error){stream.dispose();pool.dispose();adapter.dispose();root.removeFromParent();map.terrain.refinedHeight=oldRefined;network.meshHeight=oldMeshHeight;throw error;}
  return {stream,group:root,heightC:terrainHeight,
    update(vehicle,actors=[]){
      const yaw=vehicle.yaw||0,vx=-Math.sin(yaw)*(vehicle.vLong||0)+Math.cos(yaw)*(vehicle.vLat||0),vz=-Math.cos(yaw)*(vehicle.vLong||0)-Math.sin(yaw)*(vehicle.vLat||0);
      const interest=actors.filter(v=>v&&Number.isFinite(v.x)&&Number.isFinite(v.z)).map(v=>({x:v.x,z:v.z}));
      const contacts=[];
      for(const actor of [vehicle,...actors].filter(a=>a&&Number.isFinite(a.x)&&Number.isFinite(a.z))){const pad=(actor.halfL||3)+Math.abs(actor.vLong||0)/30+2;for(const dx of [-pad,pad])for(const dz of [-pad,pad])contacts.push({x:actor.x+dx,z:actor.z+dz});}
      stream.update({x:vehicle.x,z:vehicle.z,vx,vz,interest,contacts});stream.activateFrame();
    },
    contactReady(vehicle,dt){
      const pad=(vehicle.halfL||3)+Math.abs(vehicle.vLong||0)*dt+2;
      return [[-pad,-pad],[-pad,pad],[pad,-pad],[pad,pad]].every(([dx,dz])=>stream.readyAt(vehicle.x+dx,vehicle.z+dz));
    },
    renderOrigin(camera,draw){
      const origin=stream.origin,renderScene=scene.parent||scene,px=renderScene.position.x,pz=renderScene.position.z,cx=camera.position.x,cz=camera.position.z;
      renderScene.position.x-=origin.x;renderScene.position.z-=origin.z;camera.position.x-=origin.x;camera.position.z-=origin.z;
      try{renderScene.updateMatrixWorld(true);camera.updateMatrixWorld(true);return draw();}
      finally{renderScene.position.x=px;renderScene.position.z=pz;camera.position.x=cx;camera.position.z=cz;renderScene.updateMatrixWorld(true);camera.updateMatrixWorld(true);}
    },
    dispose(){stream.dispose();pool.dispose();adapter.dispose();root.removeFromParent();map.terrain.refinedHeight=oldRefined;network.meshHeight=oldMeshHeight;},
  };
}
