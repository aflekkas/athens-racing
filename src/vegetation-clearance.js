// One footprint contract for placement, streamed derivation and the bake gate.
// Radii enclose BOTH LODs, including pine lean and camera-facing crowns.
export const VEGETATION_CLEARANCE_VERSION = 1;
export const TREE_BASE_HEIGHT = Object.freeze([4.3, 8, 9, 8.5, 1.7]);
export function speciesOfBakeRow(kind, seed) {
  const r = seed % 10;
  return kind === 2 ? (r < 4 ? 1 : r < 6 ? 2 : r < 8 ? 0 : 4) : (r < 5 ? 0 : r < 7 ? 1 : r === 7 ? 2 : r === 8 ? 3 : 0);
}
export function streetTreeHeight(species, variant, mountain = false) {
  return TREE_BASE_HEIGHT[species] * (mountain && species === 1 ? 1.1 + variant * .07 : species === 0 ? .72 + variant * .06 : .85 + variant * .04);
}
export function vegetationRadius(species, height, coastal = false) {
  const scale = height / TREE_BASE_HEIGHT[species];
  return [1.8, coastal ? 7.8 : 6, 1.2, 3, 2.5][species] * scale + (species === 4 ? 1.5 : 3);
}
export function circleIntersectsTriangle(x, z, radius, a, b, c) {
  const cross = (p, q) => (x - q[0]) * (p[1] - q[1]) - (p[0] - q[0]) * (z - q[1]);
  const d = [cross(a,b), cross(b,c), cross(c,a)];
  const area = (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  if (Math.abs(area) > 1e-10 && !(d.some(v=>v<0) && d.some(v=>v>0))) return true;
  for (const [p,q] of [[a,b],[b,c],[c,a]]) {
    const dx=q[0]-p[0], dz=q[1]-p[1], length=dx*dx+dz*dz;
    const u=length ? Math.max(0,Math.min(1,((x-p[0])*dx+(z-p[1])*dz)/length)) : 0;
    if ((x-p[0]-u*dx)**2+(z-p[1]-u*dz)**2 <= radius*radius+1e-8) return true;
  }
  return false;
}
/** Includes classic AND compact contacts, every road layer, and full shoulders.
 * Classic flags are column 4 (column 3 is a surface ID, not a flag).
 * Keeping the entire exclusion disc inside its owning cell proves clearance
 * against neighbour contacts without depending on their streaming state. */
export function vegetationContactIndex(t) {
  const grid=new Map(), step=16;
  const add=(P,a,b,c)=>{
    const tri=[a,b,c].map(i=>[P[i*3],P[i*3+2]]);
    for(let x=Math.floor(Math.min(...tri.map(p=>p[0]))/step);x<=Math.floor(Math.max(...tri.map(p=>p[0]))/step);x++)
      for(let z=Math.floor(Math.min(...tri.map(p=>p[1]))/step);z<=Math.floor(Math.max(...tri.map(p=>p[1]))/step);z++){
        const key=x+','+z;if(!grid.has(key))grid.set(key,[]);grid.get(key).push(tri);
      }
  };
  const C=t.contactTriangles||[];
  for(let i=0;i<C.length;i+=5)if(C[i+4]&1)add(t.contactPositions,C[i],C[i+1],C[i+2]);
  const F=t.fineFlags||[],T=t.fineTriangles||[];
  for(let i=0;i<F.length;i++)if(F[i]&1)add(t.finePositions,T[i*3],T[i*3+1],T[i*3+2]);
  return {
    intersects(x,z,radius){
      if(![x,z,radius].every(Number.isFinite)||radius<0)throw Error('Invalid vegetation footprint');
      const seen=new Set();
      for(let gx=Math.floor((x-radius)/step);gx<=Math.floor((x+radius)/step);gx++)for(let gz=Math.floor((z-radius)/step);gz<=Math.floor((z+radius)/step);gz++)
        for(const tri of grid.get(gx+','+gz)||[])if(!seen.has(tri)){seen.add(tri);if(circleIntersectsTriangle(x,z,radius,...tri))return true;}
      return false;
    },
    clear(x,z,radius){return x>radius&&z>radius&&x<512-radius&&z<512-radius&&!this.intersects(x,z,radius);},
  };
}
export function filterStreetVegetation(rows, index, {mountain=false, coastalStart=Infinity}={}) {
  const out=[];let coastalCount=0;
  for(let i=0;i<rows.length;i+=5){const code=rows[i+4]|0,species=code>>3,variant=code&7,coastal=mountain||i/5>=coastalStart;
    if(index.clear(rows[i],rows[i+2],vegetationRadius(species,streetTreeHeight(species,variant,mountain),coastal))){out.push(...rows.slice(i,i+5));if(coastal)coastalCount++;}
  }
  return {rows:new Float32Array(out),coastalCount};
}
/** Used after derivation as well as before serialization. No physical table edits. */
export function clearPacketVegetation(pack,t) {
  const ext=pack.metadata.extensions?.worldDetail;if(!ext)return {removed:0,kept:0};
  const index=vegetationContactIndex(t);let removed=0,kept=0;
  if(ext.streetTrees!=null){const old=pack.arrays[ext.streetTrees],result=filterStreetVegetation(old,index,{mountain:ext.penteli===true,coastalStart:old.length/5-(ext.coastalTreeCount||0)});
    pack.arrays[ext.streetTrees]=result.rows;ext.coastalTreeCount=result.coastalCount;removed+=(old.length-result.rows.length)/5;kept+=result.rows.length/5;
  }
  if(ext.vegetation){const v=ext.vegetation,p=pack.arrays[v.positionHeight],k=pack.arrays[v.kind],s=pack.arrays[v.seed],keep=[];
    for(let i=0;i<k.length;i++){const species=speciesOfBakeRow(k[i],s[i]),height=Math.min(10,Math.max(3,p[i*4+3]));if(index.clear(p[i*4],p[i*4+2],vegetationRadius(species,height)))keep.push(i);}
    for(const [key,stride]of [['positionHeight',4],['kind',1],['seed',1]]){const a=pack.arrays[v[key]];pack.arrays[v[key]]=new a.constructor(keep.flatMap(i=>Array.from(a.slice(i*stride,(i+1)*stride))));}
    removed+=k.length-keep.length;kept+=keep.length;
  }
  return {removed,kept};
}

// Psychiko templates have unit-height crowns; .66 encloses every species,
// including pine asymmetry/jitter and its maximum 1.25 width multiplier.
export const psychikoVegetationRadius=(species,height,projectionScale=1)=>.66*height*projectionScale+(species===5?1.5:3);
