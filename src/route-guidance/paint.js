import * as THREE from 'three';
import {GuidanceChunks} from './route.js';

// Original procedural alpha atlas: left = chevron, right = timing stripe.
export function guidanceAtlas() {
  const width=128,height=64,data=new Uint8Array(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const px=((x%64)+.5)/32-1,py=(y+.5)/32-1;
    const d=Math.abs(py-(.5-Math.abs(px)*.8));
    const alpha=x>=64?1:Math.max(0,Math.min(1,(.20-d)/.055,(.96-Math.abs(px))/.12));
    const i=(y*width+x)*4;data[i]=data[i+1]=data[i+2]=255;data[i+3]=Math.round(alpha*255);
  }
  const texture=new THREE.DataTexture(data,width,height);texture.needsUpdate=true;
  texture.magFilter=THREE.LinearFilter;texture.minFilter=THREE.LinearFilter;
  return texture;
}

/** Internal paint pool; the public §7 API is src/route-guidance.js. */
export class RoutePaint {
  constructor(scene,polyline,{contact,maxInstances=128,closed=false,timing=null}={}){
    this.chunks=new GuidanceChunks(polyline,{maxInstances:Math.min(128,maxInstances),closed});
    this.contact=contact;this.timing=timing;this.prepared=new Map();this.progress=0;
    this.version=-1;this.lastS=Infinity;this.stats={instances:0,rebuilds:0};
    const geometry=new THREE.PlaneGeometry(1,1);geometry.rotateX(-Math.PI/2);
    this.meta=new THREE.InstancedBufferAttribute(new Float32Array(this.chunks.maxInstances*2),2).setUsage(THREE.DynamicDrawUsage);
    this.heights=new THREE.InstancedBufferAttribute(new Float32Array(this.chunks.maxInstances*4),4).setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('guidanceMeta',this.meta);geometry.setAttribute('cornerY',this.heights);
    this.atlas=guidanceAtlas();this.uniform={value:0};this.preview={value:80};
    this.material=new THREE.MeshBasicMaterial({color:'#d1dbc7',map:this.atlas,opacity:.36,transparent:true,depthTest:true,depthWrite:false,
      polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1});
    this.material.onBeforeCompile=shader=>{
      shader.uniforms.guidanceProgress=this.uniform;shader.uniforms.guidancePreview=this.preview;
      shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>
        attribute vec2 guidanceMeta;attribute vec4 cornerY;varying vec2 vGuidanceMeta;`)
        .replace('#include <begin_vertex>',`#include <begin_vertex>
        vGuidanceMeta=guidanceMeta;
        transformed.y=mix(mix(cornerY.x,cornerY.y,uv.x),mix(cornerY.z,cornerY.w,uv.x),uv.y)+.035;`)
        .replace('#include <uv_vertex>',`#include <uv_vertex>
        vMapUv.x=vMapUv.x*.5+(guidanceMeta.x>1.5?.5:0.);`);
      shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
        uniform float guidanceProgress;uniform float guidancePreview;varying vec2 vGuidanceMeta;`)
        .replace('#include <map_fragment>',`#include <map_fragment>
        float distance=vGuidanceMeta.y-guidanceProgress;
        float fade=vGuidanceMeta.x>1.5?1.:clamp((guidancePreview-distance)/24.,0.,1.)*clamp((distance+8.)/8.,0.,1.);
        diffuseColor.a*=fade;if(diffuseColor.a<.005)discard;`);
    };
    this.material.customProgramCacheKey=()=> 'route-guidance-v1';
    this.mesh=new THREE.InstancedMesh(geometry,this.material,this.chunks.maxInstances);
    this.mesh.name='route-guidance';this.mesh.frustumCulled=false;this.mesh.count=0;this.mesh.visible=false;this.mesh.renderOrder=2;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);scene.add(this.mesh);this.matrix=new THREE.Matrix4();
  }
  setDecisions(points){this.chunks.setDecisions(points,this.timing);this.prepared.clear();}
  addCell(key){this.chunks.addCell(key);this.prepared.clear();}
  removeCell(key){this.chunks.removeCell(key);this.prepared.clear();}
  hide(){this.mesh.visible=false;this.mesh.count=0;this.stats.instances=0;this.version=-1;}
  update(progress,origin={x:0,z:0}){
    this.progress=progress;this.uniform.value=progress;this.mesh.position.set(-origin.x,0,-origin.z);
    if(this.version===this.chunks.version&&Math.abs(progress-this.lastS)<6)return;
    this.version=this.chunks.version;this.lastS=progress;this.stats.rebuilds++;let count=0;
    for(const r of this.chunks.visible(progress)){
      let prepared=this.prepared.get(r.id);
      if(!prepared){
        let width=r.width,x=r.x,z=r.z;
        if(r.kind===2){
          if(Number.isFinite(r.leftM)&&Number.isFinite(r.rightM)){
            const across=(r.rightM-r.leftM)/2;x-=r.tz*across;z+=r.tx*across;
          }else if(this.contact){
            let half=.5;for(;half<8;half+=.5)if(!this.contact(x-r.tz*half,z+r.tx*half,r.y,r.layer)||!this.contact(x+r.tz*half,z-r.tx*half,r.y,r.layer))break;
            width=Math.max(.5,(half-.5)*2);
          }
        }else if(Number.isFinite(r.leftM)&&Number.isFinite(r.rightM)){
          width=Math.min(width,2*Math.min(r.leftM,r.rightM));
          // Clear the chase car's silhouette, while keeping every corner inside
          // the supplied road width. Narrow lanes retain centred paint.
          const offset=Math.max(0,Math.min(1.8,r.rightM-width/2-.25));
          x-=r.tz*offset;z+=r.tx*offset;
        }
        if(width<=0)continue;
        const heights=[];
        for(const forward of [-.5,.5])for(const side of [-.5,.5]){
          const px=x-r.tz*side*width+r.tx*forward*r.length,pz=z+r.tx*side*width+r.tz*forward*r.length;
          const c=this.contact?.(px,pz,r.y,r.layer,r.cell);
          // Missing/unloaded physical contacts never get paint.
          if(!c||!Number.isFinite(c.y)){heights.length=0;break;}heights.push(c.y);
        }
        if(heights.length!==4)continue;
        prepared={width,heights,x,z};this.prepared.set(r.id,prepared);
      }
      const {width,heights,x,z}=prepared;
      this.matrix.set(-r.tz*width,0,-r.tx*r.length,x, 0,1,0,0, r.tx*width,0,-r.tz*r.length,z, 0,0,0,1);
      this.mesh.setMatrixAt(count,this.matrix);this.meta.setXY(count,r.kind,r.decisionS);this.heights.setXYZW(count,...heights);count++;
    }
    this.mesh.count=count;this.mesh.visible=count>0;this.stats.instances=count;
    this.mesh.instanceMatrix.needsUpdate=true;this.meta.needsUpdate=true;this.heights.needsUpdate=true;
  }
  dispose(){this.prepared.clear();this.chunks.dispose();this.mesh.removeFromParent();this.mesh.dispose();this.mesh.geometry.dispose();this.material.dispose();this.atlas.dispose();}
}
