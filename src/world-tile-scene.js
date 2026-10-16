import * as THREE from 'three';
import { restoreTerrainLayout } from './terrain-layout.js';
import { TileResources } from './world-tile-stream.js';
/** Each iterator step creates one pre-bounded mesh; worker supplies all bounds. */
export class WorldTileScene {
  constructor(scene,{resources=new TileResources()}={}){this.scene=scene;this.resources=resources;this.groups=new Set();this.origin={x:0,z:0};}
  prepare(key,packet,origin){
    const root=new THREE.Group(),owned=[],materialKeys=[];root.name=`tile:${key}`;root.visible=false;
    root.position.set(packet.metadata.origin[0]-origin.x,0,packet.metadata.origin[2]-origin.z);this.groups.add(root);
    const self=this,attributes=new Map();let disposed=false;
    function dispose(){if(disposed)return;disposed=true;root.removeFromParent();for(const g of owned)g.dispose();for(const k of materialKeys)self.resources.release(k);root.clear();self.groups.delete(root);}
    function* steps(){
      for(const m of packet.metadata.meshes){
        const g=new THREE.BufferGeometry();owned.push(g);
        for(const [name,a] of Object.entries(m.attributes)){const key=`${a.array}:${a.itemSize}:${!!a.normalized}`;if(!attributes.has(key))attributes.set(key,new THREE.BufferAttribute(packet.arrays[a.array],a.itemSize,a.normalized));g.setAttribute(name,attributes.get(key));}
        if(m.index!=null){const key=`index:${m.index}`;if(!attributes.has(key))attributes.set(key,new THREE.BufferAttribute(packet.arrays[m.index],1));g.setIndex(attributes.get(key));}
        if(m.drawRange)g.setDrawRange(m.drawRange.start,m.drawRange.count??Infinity);
        if(!m.bounds)throw new Error('Tile worker omitted bounds');
        g.boundingBox=new THREE.Box3(new THREE.Vector3(...m.bounds.box.slice(0,3)),new THREE.Vector3(...m.bounds.box.slice(3)));
        g.boundingSphere=new THREE.Sphere(new THREE.Vector3(...m.bounds.sphere.slice(0,3)),m.bounds.sphere[3]);
        const rgb=packet.metadata.palette[m.material],vertexColors=!!m.attributes.color;
        const mk=`${rgb.join(',')}:${vertexColors}:${!!m.userData?.terrainDecode}`;
        const material=self.resources.acquire(mk,()=>new THREE.MeshBasicMaterial({color:new THREE.Color(...rgb),vertexColors,side:THREE.FrontSide}));materialKeys.push(mk);
        const mesh=new THREE.Mesh(g,material);mesh.name=m.name||'';mesh.userData={...m.userData};mesh.renderOrder=m.renderOrder||0;
        if(m.userData?.terrainDecode){
          restoreTerrainLayout(mesh);owned.push(mesh.material);
          const a=m.attributes.position,key=`${a.array}:${a.itemSize}:${!!a.normalized}:terrain:${JSON.stringify(m.userData.terrainDecode)}`;
          if(attributes.has(key))g.setAttribute('position',attributes.get(key));else attributes.set(key,g.attributes.position);
        }
        root.add(mesh);yield;
      }
    }
    return {steps:steps(),commit(){if(disposed)throw new Error('Disposed tile activation');root.visible=true;self.scene.add(root);root.updateMatrixWorld(true);return {root,dispose};},dispose};
  }
  rebase(origin){this.origin=origin;for(const root of this.groups){const [x,z]=root.name.slice(5).split(',').map(Number);root.position.set(x*512-origin.x,0,z*512-origin.z);root.updateMatrixWorld(true);}}
}
