import * as THREE from 'three';
import { restoreTerrainLayout } from './terrain-layout.js';
import { TileResources } from './world-tile-stream.js';
import { GL_ARRAY_TYPES, tileGPUPlan, tileRenderVariants } from './world-tile-gpu.js';
/** Each iterator step creates one pre-bounded mesh; worker supplies all bounds. */
export class WorldTileScene {
  constructor(scene,{resources=new TileResources(),renderer=null,uploadChunkBytes=32768,materialFactory=null}={}){
    if(!Number.isSafeInteger(uploadChunkBytes)||uploadChunkBytes<1||uploadChunkBytes>65536)throw new Error('Invalid tile upload chunk budget');
    this.scene=scene;this.resources=resources;this.groups=new Set();this.origin={x:0,z:0};this.renderer=renderer;this.materialFactory=materialFactory;this.uploadChunkBytes=uploadChunkBytes;this.uploadMetrics={calls:0,maxBytes:0,maxCallMs:0,liveBuffers:0};this.disposed=false;this.warmupQueue=Promise.resolve();this.warmups=new Map();this.warmMaterials=new Set();this.warmupMetrics={maxCompileCallMs:0,maxWaitMs:0};
    if(renderer){this.uploadScene=new THREE.Scene();this.uploadCamera=new THREE.PerspectiveCamera(60,1,.1,10);this.uploadTarget=new THREE.WebGLRenderTarget(1,1,{depthBuffer:false,stencilBuffer:false});}
  }
  prewarm(variants){return this.warmVariants(variants).then(()=>{this.startupComplete=true;});}
  warmup(packet){
    const variants=packet.renderVariants||tileRenderVariants(packet);
    if(this.startupComplete&&variants.some(v=>!this.warmups.has(v.key)))throw new Error('Undeclared tile render variant; map fallback required');
    return this.warmVariants(variants);
  }
  warmVariants(variants){
    if(!this.renderer)return Promise.resolve();
    let source=this.scene;while(source.parent)source=source.parent;
    return Promise.all(variants.map(variant=>{
      if(this.warmups.has(variant.key))return this.warmups.get(variant.key);
      const promise=this.warmupQueue.then(()=>this.warmVariant(variant,source));this.warmupQueue=promise.catch(()=>{});this.warmups.set(variant.key,promise);
      promise.catch(()=>{if(this.warmups.get(variant.key)===promise)this.warmups.delete(variant.key);});return promise;
    }));
  }
  async warmVariant(variant,source){
    const renderer=this.renderer,owned=[],start=performance.now();
    try{
      // Both framebuffer/program variants are drawn before the car is controllable.
      // compileAsync alone does not warm a software driver's first draw pipeline.
      for(const useTarget of [true,false]){
        await new Promise(resolve=>requestAnimationFrame(resolve));if(this.disposed)throw new Error('Tile scene disposed during shader preparation');
        const scene=new THREE.Scene();scene.fog=source.fog||null;scene.environment=source.environment||null;scene.environmentIntensity=source.environmentIntensity;source.traverse(o=>{if(o.isLight)scene.add(o.clone());});
        const geometry=new THREE.BufferGeometry();
        for(const[name,a]of Object.entries(variant.attributes)){
          const array=new globalThis[a.type](a.itemSize*3);if(name==='color')array.fill(a.normalized?255:1);
          if(name==='position')array.set(variant.terrain?[0,0,0,1,0,0,0,1,0]:[0,0,-1,1,0,-1,0,1,-1]);
          geometry.setAttribute(name,new THREE.BufferAttribute(array,a.itemSize,a.normalized));
        }
        if(variant.index)geometry.setIndex(new THREE.BufferAttribute(new globalThis[variant.index]([0,1,2]),1));
        const initial=this.materialFactory?.(variant.surface,[1,1,1],!!variant.attributes.color)||new THREE.MeshBasicMaterial({vertexColors:!!variant.attributes.color,side:THREE.FrontSide}),mesh=new THREE.Mesh(geometry,initial);mesh.frustumCulled=false;
        if(variant.terrain){mesh.userData.terrainDecode={version:1,offset:[0,0,-1],scale:[1,1,1]};restoreTerrainLayout(mesh);initial.dispose();}
        mesh.position.z=-1;scene.add(mesh);this.warmMaterials.add(mesh.material);owned.push({scene,geometry,material:mesh.material});
        const target=renderer.getRenderTarget(),face=renderer.getActiveCubeFace(),mip=renderer.getActiveMipmapLevel();
        const at=performance.now();let compilation;try{renderer.setRenderTarget(useTarget?this.uploadTarget:null);compilation=renderer.compileAsync(scene,this.uploadCamera,source);}finally{renderer.setRenderTarget(target,face,mip);}
        this.warmupMetrics.maxCompileCallMs=Math.max(this.warmupMetrics.maxCompileCallMs,performance.now()-at);await compilation;
        await new Promise(resolve=>requestAnimationFrame(resolve));
        this.drawWarmScene(scene,useTarget?this.uploadTarget:null);
      }
      this.warmupMetrics.maxWaitMs=Math.max(this.warmupMetrics.maxWaitMs,performance.now()-start);
    }catch(error){for(const item of owned){item.material.dispose();this.warmMaterials.delete(item.material);}throw error;}
    finally{for(const item of owned){item.geometry.dispose();item.scene.clear();}}
  }
  drawWarmScene(scene,target){
    const r=this.renderer,old=r.getRenderTarget(),face=r.getActiveCubeFace(),mip=r.getActiveMipmapLevel(),viewport=r.getViewport(new THREE.Vector4()),scissor=r.getScissor(new THREE.Vector4()),test=r.getScissorTest(),xr=r.xr.enabled,auto=r.autoClear;
    try{r.xr.enabled=false;r.autoClear=true;r.setRenderTarget(target);r.setViewport(0,0,1,1);r.setScissorTest(false);r.render(scene,this.uploadCamera);}
    finally{r.setRenderTarget(old,face,mip);r.setViewport(viewport);r.setScissor(scissor);r.setScissorTest(test);r.xr.enabled=xr;r.autoClear=auto;}
  }
  dispose(){this.disposed=true;if(this.groups.size)throw new Error('Dispose tile handles before their scene adapter');this.uploadTarget?.dispose();for(const material of this.warmMaterials)material.dispose();this.warmMaterials.clear();this.warmups.clear();}
  prepare(key,packet,origin){
    const root=new THREE.Group(),owned=[],materialKeys=[],gpuBuffers=[],gpuAttributes=new Map(),gl=this.renderer?.getContext();root.name=`tile:${key}`;root.visible=false;
    root.position.set(packet.metadata.origin[0]-origin.x,0,packet.metadata.origin[2]-origin.z);this.groups.add(root);
    const self=this,attributes=new Map();let disposed=false;
    function dispose(){if(disposed)return;disposed=true;root.removeFromParent();for(const g of owned){if(gl&&g.isBufferGeometry){for(const name of Object.keys(g.attributes))g.deleteAttribute(name);g.setIndex(null);}g.dispose();}if(gl)for(const buffer of gpuBuffers){gl.deleteBuffer(buffer);self.uploadMetrics.liveBuffers--;}for(const k of materialKeys)self.resources.release(k);root.clear();self.groups.delete(root);}
    function* steps(){
      if(gl){
        if(!gl.COPY_WRITE_BUFFER)throw new Error('Streaming requires WebGL2 buffer uploads');
        for(const descriptor of (packet.gpuPlan||tileGPUPlan(packet)).buffers){
          const array=packet.arrays[descriptor.array],buffer=gl.createBuffer();if(!buffer)throw new Error('Tile GPU allocation failed');gpuBuffers.push(buffer);self.uploadMetrics.liveBuffers++;
          // WebGL classifies element buffers on their first binding. Bind EBOs
          // once on a private VAO; COPY_WRITE first would classify them as vertex buffers.
          if(descriptor.key.startsWith('index:')){
            const previousVAO=gl.getParameter(gl.VERTEX_ARRAY_BINDING),vao=gl.createVertexArray();
            if(!vao)throw new Error('Tile upload VAO allocation failed');
            try{gl.bindVertexArray(vao);gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,buffer);}
            finally{gl.bindVertexArray(previousVAO);gl.deleteVertexArray(vao);}
          }
          const binding=gl.getParameter(gl.COPY_WRITE_BUFFER_BINDING);let at=performance.now();
          try{gl.bindBuffer(gl.COPY_WRITE_BUFFER,buffer);gl.bufferData(gl.COPY_WRITE_BUFFER,array.byteLength,gl.STATIC_DRAW);}finally{gl.bindBuffer(gl.COPY_WRITE_BUFFER,binding);}
          self.uploadMetrics.maxCallMs=Math.max(self.uploadMetrics.maxCallMs,performance.now()-at);yield;
          for(let offset=0;offset<array.byteLength;offset+=self.uploadChunkBytes){
            const bytes=Math.min(self.uploadChunkBytes,array.byteLength-offset),previous=gl.getParameter(gl.COPY_WRITE_BUFFER_BINDING);at=performance.now();
            try{gl.bindBuffer(gl.COPY_WRITE_BUFFER,buffer);gl.bufferSubData(gl.COPY_WRITE_BUFFER,offset,new Uint8Array(array.buffer,array.byteOffset+offset,bytes));}finally{gl.bindBuffer(gl.COPY_WRITE_BUFFER,previous);}
            self.uploadMetrics.calls++;self.uploadMetrics.maxBytes=Math.max(self.uploadMetrics.maxBytes,bytes);self.uploadMetrics.maxCallMs=Math.max(self.uploadMetrics.maxCallMs,performance.now()-at);yield;
          }
          const type=gl[GL_ARRAY_TYPES[descriptor.type]];if(type==null)throw new Error('Unsupported tile GPU array type');
          const attribute=new THREE.GLBufferAttribute(buffer,type,descriptor.itemSize,array.BYTES_PER_ELEMENT,descriptor.count);attribute.normalized=descriptor.normalized;gpuAttributes.set(descriptor.key,attribute);
        }
      }
      let meshIndex=0;
      for(const m of packet.metadata.meshes){
        const g=new THREE.BufferGeometry();owned.push(g);
        for(const [name,a] of Object.entries(m.attributes)){const key=`${a.array}:${a.itemSize}:${!!a.normalized}`;if(!attributes.has(key))attributes.set(key,new THREE.BufferAttribute(packet.arrays[a.array],a.itemSize,a.normalized));g.setAttribute(name,attributes.get(key));}
        if(m.index!=null){const key=`index:${m.index}`;if(!attributes.has(key))attributes.set(key,new THREE.BufferAttribute(packet.arrays[m.index],1));g.setIndex(attributes.get(key));}
        if(m.drawRange)g.setDrawRange(m.drawRange.start,m.drawRange.count??Infinity);
        if(!m.bounds)throw new Error('Tile worker omitted bounds');
        g.boundingBox=new THREE.Box3(new THREE.Vector3(...m.bounds.box.slice(0,3)),new THREE.Vector3(...m.bounds.box.slice(3)));
        g.boundingSphere=new THREE.Sphere(new THREE.Vector3(...m.bounds.sphere.slice(0,3)),m.bounds.sphere[3]);
        const rgb=packet.metadata.palette[m.material],vertexColors=!!m.attributes.color;
        const mk=`${m.userData?.tileSurface||'basic'}:${rgb.join(',')}:${vertexColors}:${!!m.userData?.terrainDecode}`;
        const material=self.resources.acquire(mk,()=>self.materialFactory?.(m.userData?.tileSurface||'basic',rgb,vertexColors)||new THREE.MeshBasicMaterial({color:new THREE.Color(...rgb),vertexColors,side:THREE.FrontSide}));materialKeys.push(mk);
        const mesh=new THREE.Mesh(g,material);mesh.name=m.name||'';mesh.userData={...m.userData};mesh.renderOrder=m.renderOrder||0;
        if(m.userData?.terrainDecode){
          restoreTerrainLayout(mesh);owned.push(mesh.material);
          const a=m.attributes.position,key=`${a.array}:${a.itemSize}:${!!a.normalized}:terrain:${JSON.stringify(m.userData.terrainDecode)}`;
          if(attributes.has(key))g.setAttribute('position',attributes.get(key));else attributes.set(key,g.attributes.position);
        }
        if(gl){const bindings=(packet.gpuPlan||tileGPUPlan(packet)).meshes[meshIndex];for(const[name,key]of Object.entries(bindings.attributes))g.setAttribute(name,gpuAttributes.get(key));if(bindings.index)g.setIndex(gpuAttributes.get(bindings.index));}
        meshIndex++;root.add(mesh);yield;
      }
    }
    return {steps:steps(),commit(){if(disposed)throw new Error('Disposed tile activation');root.visible=true;self.scene.add(root);root.updateMatrixWorld(true);return {root,dispose};},dispose};
  }
  rebase(origin){this.origin=origin;for(const root of this.groups){const [x,z]=root.name.slice(5).split(',').map(Number);root.position.set(x*512-origin.x,0,z*512-origin.z);root.updateMatrixWorld(true);}}
}
