import * as THREE from 'three';

// Find open grid edges before quantization. Sorted numeric pairs avoid a Map
// entry for every interior edge of the multi-million-triangle road mesh.
export function terrainBoundaryEdges(geometry, step, source = 0) {
  const p=geometry.attributes.position,index=geometry.index.array,count=p.count;
  const keys=new Float64Array(index.length);
  for(let k=0;k<index.length;k+=3)for(let j=0;j<3;j++){
    const a=index[k+j],b=index[k+(j+1)%3];keys[k+j]=Math.min(a,b)*count+Math.max(a,b);
  }
  keys.sort();const edges=[];
  for(let i=0;i<keys.length;){let end=i+1;while(end<keys.length&&keys[end]===keys[i])end++;
    if(end-i===1){const a=Math.floor(keys[i]/count),b=keys[i]-a*count;
      const ax=p.getX(a),az=p.getZ(a),bx=p.getX(b),bz=p.getZ(b);
      if(ax===bx||az===bz){const axis=ax===bx?2:0,lo=axis===2?az:ax,hi=axis===2?bz:bx;
        edges.push({source,step,a:lo<hi?a:b,b:lo<hi?b:a,axis,line:axis===2?ax:az,lo:Math.min(lo,hi),hi:Math.max(lo,hi)});
      }
    }i=end;
  }
  return edges;
}
export function terrainBoundaryPairs(entries) {
  const lines=new Map();
  for(let source=0;source<entries.length;source++){
    const {geometry,step,boundary}=entries[source],p=geometry.attributes.position;
    const edges=boundary?boundary.map(([a,b])=>{const ax=p.getX(a),az=p.getZ(a),bx=p.getX(b),bz=p.getZ(b),axis=ax===bx?2:0,lo=axis===2?az:ax,hi=axis===2?bz:bx;return {source,step,a:lo<hi?a:b,b:lo<hi?b:a,axis,line:axis===2?ax:az,lo:Math.min(lo,hi),hi:Math.max(lo,hi)};}):terrainBoundaryEdges(geometry,step,source);
    for(const e of edges){
      const key=e.axis+':'+e.line;let line=lines.get(key);if(!line)lines.set(key,line=[]);line.push(e);
    }
  }
  const pairs=[];
  for(const edges of lines.values()){
    edges.sort((a,b)=>a.lo-b.lo);
    for(let i=0;i<edges.length;i++)for(let j=i+1;j<edges.length&&edges[j].lo<edges[i].hi;j++){
      const a=edges[i],b=edges[j];if(a.source===b.source||a.step===b.step)continue;
      pairs.push(a.step>b.step?[a,b]:[b,a]);
    }
  }
  return pairs;
}

// Join different DEM resolutions with the finer boundary, rather than leaving
// a coarse straight edge above/below its neighbouring cut/fill surface. Only
// transition triangles change; the road corridor's final vertices stay exact.
export function stitchTerrainBoundaries(entries) {
  const pairs=terrainBoundaryPairs(entries).sort((a,b)=>a[1].step-b[1].step);
  const splits=entries.map(()=>new Map());
  const height=(e,t)=>{const p=entries[e.source].geometry.attributes.position;return p.getY(e.a)+(p.getY(e.b)-p.getY(e.a))*(t-e.lo)/(e.hi-e.lo);};
  // Apply endpoint corrections from finest to coarsest before interpolating
  // any inserted vertices. Each source geometry shares its corner vertices.
  for(const [coarse,fine]of pairs){
    const p=entries[coarse.source].geometry.attributes.position;
    if(coarse.lo>=fine.lo&&coarse.lo<=fine.hi)p.setY(coarse.a,height(fine,coarse.lo));
    if(coarse.hi>=fine.lo&&coarse.hi<=fine.hi)p.setY(coarse.b,height(fine,coarse.hi));
  }
  for(const [coarse,fine]of pairs){
    const g=entries[coarse.source].geometry,count=g.attributes.position.count;
    const key=Math.min(coarse.a,coarse.b)*count+Math.max(coarse.a,coarse.b);
    let split=splits[coarse.source].get(key);if(!split)splits[coarse.source].set(key,split={edge:coarse,knots:new Map()});
    for(const t of [fine.lo,fine.hi])if(t>coarse.lo&&t<coarse.hi){
      const previous=split.knots.get(t);if(!previous||fine.step<previous.fine.step)split.knots.set(t,{fine,t});
    }
  }
  const transitions=[];let splitTriangles=0;
  for(let source=0;source<entries.length;source++){
    const g=entries[source].geometry,p=g.attributes.position,index=g.index.array,count=p.count,edges=splits[source];
    if(!edges.size)continue; // The finest road surface is unchanged.
    const kept=[],arrays={};for(const name of Object.keys(g.attributes))arrays[name]=[];
    const original=i=>({i,x:p.getX(i),y:p.getY(i),z:p.getZ(i)});
    const emit=v=>{for(const [name,a]of Object.entries(g.attributes))for(let c=0;c<a.itemSize;c++){
      let value=v.i!==undefined?a.getComponent(v.i,c):a.getComponent(v.a,c)*(1-v.f)+a.getComponent(v.b,c)*v.f;
      if(name==='position')value=c===0?v.x:c===1?v.y:v.z;arrays[name].push(value);
    }};
    for(let k=0;k<index.length;k+=3){
      const polygon=[];let changed=false;
      for(let j=0;j<3;j++){
        const a=index[k+j],b=index[k+(j+1)%3];polygon.push(original(a));
        const split=edges.get(Math.min(a,b)*count+Math.max(a,b));if(!split?.knots.size)continue;
        const e=split.edge,forward=a===e.a,knots=[...split.knots.values()].sort((a,b)=>forward?a.t-b.t:b.t-a.t);
        for(const knot of knots){const f=(knot.t-e.lo)/(e.hi-e.lo);polygon.push({a:e.a,b:e.b,f,x:e.axis===0?knot.t:e.line,z:e.axis===2?knot.t:e.line,y:height(knot.fine,knot.t)});}
        changed=true;
      }
      if(!changed){kept.push(index[k],index[k+1],index[k+2]);continue;}
      splitTriangles++;
      // Ear clipping retains every collinear edge sample, including triangles
      // with two subdivided edges. No off-lattice centre vertex is introduced.
      while(polygon.length>3){let clipped=false;
        for(let j=0;j<polygon.length;j++){
          const a=polygon[(j+polygon.length-1)%polygon.length],b=polygon[j],c=polygon[(j+1)%polygon.length];
          const cross=(u,v,w)=>(v.x-u.x)*(w.z-u.z)-(v.z-u.z)*(w.x-u.x);
          if(cross(a,b,c)>=-1e-10)continue;
          let contains=false;for(const v of polygon){if(v===a||v===b||v===c)continue;if(cross(a,b,v)<=1e-10&&cross(b,c,v)<=1e-10&&cross(c,a,v)<=1e-10){contains=true;break;}}
          if(contains)continue;emit(a);emit(b);emit(c);polygon.splice(j,1);clipped=true;break;
        }
        if(!clipped)throw new Error('Invalid terrain transition polygon');
      }
      for(const v of polygon)emit(v);
    }
    g.setIndex(kept);g.computeVertexNormals();
    if(arrays.position.length){const transition=new THREE.BufferGeometry();for(const [name,array]of Object.entries(arrays))transition.setAttribute(name,new THREE.Float32BufferAttribute(array,g.attributes[name].itemSize));
      transition.setIndex(Array.from({length:arrays.position.length/3},(_,i)=>i));transition.computeVertexNormals();transitions.push(transition);
    }
  }
  return {transitions,splitTriangles,pairs:pairs.length};
}

export function mergeTerrainTransitions(geometry, transitions) {
  if(!transitions.length)return geometry;
  const sources=[geometry,...transitions],out=new THREE.BufferGeometry();
  const vertices=sources.reduce((n,g)=>n+g.attributes.position.count,0),indices=sources.reduce((n,g)=>n+g.index.count,0);
  for(const [name,attribute]of Object.entries(geometry.attributes)){
    const array=new Float32Array(vertices*attribute.itemSize);let offset=0;
    for(const g of sources){array.set(g.attributes[name].array,offset);offset+=g.attributes[name].array.length;}
    out.setAttribute(name,new THREE.BufferAttribute(array,attribute.itemSize));
  }
  const index=new Uint32Array(indices);let offset=0,base=0;
  for(const g of sources){for(const v of g.index.array)index[offset++]=base+v;base+=g.attributes.position.count;g.dispose();}
  out.setIndex(new THREE.BufferAttribute(index,1));return out;
}

// The refined region is already a set of complete DEM cells. Derive its outer
// edges directly, rather than sorting millions of interior triangle edges.
export function refinedTerrainBoundary(refined, vertices, width, stride, n) {
  const edges=[];
  const edge=(x,z,dx,dz)=>{for(let k=0;k<n;k++)edges.push([vertices.get((z+k*dz)*stride+x+k*dx),vertices.get((z+(k+1)*dz)*stride+x+(k+1)*dx)]);};
  for(const id of refined){const i=id%width,j=Math.floor(id/width),x=i*n,z=j*n;
    if(i===0||!refined.has(id-1))edge(x,z,0,1);
    if(i===width-2||!refined.has(id+1))edge(x+n,z,0,1);
    if(j===0||!refined.has(id-width))edge(x,z,1,0);
    if(!refined.has(id+width))edge(x,z+n,1,0);
  }
  return edges;
}
