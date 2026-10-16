// Sample the final indexed triangles outside the refined road grid. Transition
// faces need their actual vertices: a four-corner DEM cell cannot represent a
// stitched boundary. Keep references to the compact render buffers, not another
// Float32 position surface.
export function coarseTerrainSampler(terrain, group) {
  const positions=[],indices=[],meshIds=[],offsets=[],lists=new Map(),step=terrain.T*4;
  const width=Math.ceil((terrain.GX-1)/4),depth=Math.ceil((terrain.GZ-1)/4);
  group.traverse(mesh=>{
    if(!mesh.isMesh||mesh.userData.terrainRefinement)return;
    const p=mesh.geometry.attributes.position,index=mesh.geometry.userData.terrainLodSource||mesh.geometry.index.array;
    const meshId=positions.length;positions.push(p);indices.push(index);
    const count=mesh.userData.terrainLod?.[0].count??index.length;
    for(let k=0;k<count;k+=3){
      const a=index[k],b=index[k+1],c=index[k+2],ax=p.getX(a),az=p.getZ(a),bx=p.getX(b),bz=p.getZ(b),cx=p.getX(c),cz=p.getZ(c);
      const id=meshIds.length;meshIds.push(meshId);offsets.push(k);
      const x0=Math.max(0,Math.floor((Math.min(ax,bx,cx)-terrain.minX)/step)),x1=Math.min(width-1,Math.floor((Math.max(ax,bx,cx)-terrain.minX)/step));
      const z0=Math.max(0,Math.floor((Math.min(az,bz,cz)-terrain.minZ)/step)),z1=Math.min(depth-1,Math.floor((Math.max(az,bz,cz)-terrain.minZ)/step));
      for(let z=z0;z<=z1;z++)for(let x=x0;x<=x1;x++){const key=z*width+x;let list=lists.get(key);if(!list)lists.set(key,list=[]);list.push(id);}
    }
  });
  const bins=new Map();let bytes=meshIds.length*8;
  for(const [key,list]of lists){const ids=new Uint32Array(list);bins.set(key,ids);bytes+=ids.byteLength;}
  const sample=triangleSampler(terrain.minX,terrain.minZ,step,width,depth,positions,indices,new Uint32Array(meshIds),new Uint32Array(offsets),bins);
  sample.cells=bins.size;sample.bytes=bytes;return sample;
}
// Separate factory prevents retention of build-time JS arrays and bin lists.
function triangleSampler(minX,minZ,step,width,depth,positions,indices,meshIds,offsets,bins){
  return (x,z)=>{
    const i=Math.floor((x-minX)/step),j=Math.floor((z-minZ)/step);if(i<0||j<0||i>=width||j>=depth)return null;
    const list=bins.get(j*width+i);if(!list)return null;let height=-Infinity;
    for(let n=0;n<list.length;n++){
      const id=list[n],mesh=meshIds[id],p=positions[mesh],ix=indices[mesh],k=offsets[id],a=ix[k],b=ix[k+1],c=ix[k+2];
      const ax=p.getX(a),az=p.getZ(a),bx=p.getX(b),bz=p.getZ(b),cx=p.getX(c),cz=p.getZ(c),det=(bz-cz)*(ax-cx)+(cx-bx)*(az-cz);
      if(Math.abs(det)<1e-12)continue;
      const u=((bz-cz)*(x-cx)+(cx-bx)*(z-cz))/det,v=((cz-az)*(x-cx)+(ax-cx)*(z-cz))/det;
      if(u>=-1e-8&&v>=-1e-8&&u+v<=1+1e-8)height=Math.max(height,u*p.getY(a)+v*p.getY(b)+(1-u-v)*p.getY(c));
    }
    return height===-Infinity?null:height;
  };
}
