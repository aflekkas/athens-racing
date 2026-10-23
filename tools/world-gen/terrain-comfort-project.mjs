// Experimental bounded correction of real road-chord observations on the
// ORIGINAL geographic field. No isotropic hill blur, invented profiles or
// alternate physical/contact acceptance. A solved linear proxy still requires
// actual repack, unchanged comfort/grade/step guards and geographic proof.
import {terrainComfortChords} from '../world-terrain-smoothness.mjs';
import {tileTables} from '../../src/world-tile-format.js';
const S=8,key=(x,z)=>x+','+z;
export function terrainNodeBasis(x,z){
 const ax=Math.floor(x/S)*S,az=Math.floor(z/S)*S,u=(x-ax)/S,v=(z-az)/S;
 return u+v<=1?[{key:key(ax,az),x:ax,z:az,w:1-u-v,dx:-1/S,dz:-1/S},{key:key(ax+S,az),x:ax+S,z:az,w:u,dx:1/S,dz:0},{key:key(ax,az+S),x:ax,z:az+S,w:v,dx:0,dz:1/S}]:[{key:key(ax+S,az+S),x:ax+S,z:az+S,w:u+v-1,dx:1/S,dz:1/S},{key:key(ax,az+S),x:ax,z:az+S,w:1-u,dx:-1/S,dz:0},{key:key(ax+S,az),x:ax+S,z:az,w:1-v,dx:0,dz:-1/S}];
}
export function terrainChordTerms({a,b,c}){
 const terms=new Map(),bendX=b.x-(a.x+c.x)/2,bendZ=b.z-(a.z+c.z)/2;
 const add=(p,scale,gradient=false)=>{for(const term of terrainNodeBasis(p.x,p.z)){const value=term.w*scale-(gradient?bendX*term.dx+bendZ*term.dz:0),old=terms.get(term.key);if(old)old.coefficient+=value;else terms.set(term.key,{...term,coefficient:value});}};
 add(a,-.5);add(b,1,true);add(c,-.5);return [...terms.values()].filter(t=>Math.abs(t.coefficient)>1e-12);
}
export function terrainProjectionChords(pack,options={}){
 const [ox,,oz]=pack.metadata.origin,m=pack.metadata,t=tileTables(pack);
 return [...terrainComfortChords(t,options)].map(chord=>{const world=p=>({...p,x:p.x+ox,z:p.z+oz});const c={...chord,a:world(chord.a),b:world(chord.b),c:world(chord.c)};return {...c,id:m.cell.join(',')+':'+m.ids[t.edges[chord.edge*10]]+':'+chord.station,terms:terrainChordTerms(c)};});
}
export function solveTerrainComfort(chords,{allowed=()=>true,maxAdjustment=.75,maxGradient=.05,targetSag=.45,maxSupportMetres=32,maxIterations=120}={}){
 if(!(Number.isFinite(maxSupportMetres)&&maxSupportMetres>=0&&maxSupportMetres<=64&&Number.isFinite(maxAdjustment)&&maxAdjustment>0&&Number.isFinite(maxGradient)&&maxGradient>0&&targetSag>0&&targetSag<=.5)||!Number.isInteger(maxIterations)||maxIterations<1)throw Error('Invalid bounded comfort projection limits');
 const constraints=chords.map(c=>({...c,terms:c.terms||terrainChordTerms(c)})).sort((a,b)=>a.id.localeCompare(b.id)),nodes=new Map();
 const seeds=new Set(constraints.flatMap(c=>c.terms.map(t=>t.key)));
 const withinSupport=(x,z)=>{const r=Math.ceil(maxSupportMetres/S);for(let dx=-r;dx<=r;dx++)for(let dz=-r;dz<=r;dz++)if(Math.hypot(dx*S,dz*S)<=maxSupportMetres+1e-10&&seeds.has(key(x+dx*S,z+dz*S)))return true;return false;};
 const node=term=>{let n=nodes.get(term.key);if(!n){n={key:term.key,x:term.x,z:term.z,value:0,free:withinSupport(term.x,term.z)&&!!allowed(term.x,term.z)};nodes.set(term.key,n);}return n;};
 for(const c of constraints)for(const term of c.terms)node(term);
 const value=c=>c.signedSag+c.terms.reduce((v,t)=>v+t.coefficient*nodes.get(t.key).value,0);
 let iterations=0,maximum=Infinity;
 for(;iterations<maxIterations;iterations++){
  for(const c of constraints){const residual=value(c);if(Math.abs(residual)<=targetSag)continue;const denominator=c.terms.reduce((v,t)=>v+(nodes.get(t.key).free?t.coefficient*t.coefficient:0),0);if(!denominator)continue;const step=(Math.sign(residual)*targetSag-residual)/denominator;
   for(const t of c.terms){const n=nodes.get(t.key);if(n.free)n.value=Math.max(-maxAdjustment,Math.min(maxAdjustment,n.value+step*t.coefficient));}
  }
  // Bound correction gradients, including the zero field outside the support.
  // Project the exact two-dimensional triangle gradient onto its bounded disk.
  // New neighbours are added only when a bound is violated; protected ones
  // remain fixed. This spreads a small correction instead of creating spikes.
  for(let pass=0;pass<3;pass++){
   const triangles=new Map();for(const n of nodes.values())for(const[dx,dz]of [[0,0],[-S,0],[0,-S],[-S,-S]]){const x=n.x+dx,z=n.z+dz;triangles.set(key(x,z),[x,z]);}
   for(const[x,z]of triangles.values())for(const upper of [false,true]){
    const ts=terrainNodeBasis(x+(upper?.75:.25)*S,z+(upper?.75:.25)*S),ns=ts.map(t=>nodes.get(t.key)),g=ts.reduce((v,t,i)=>[v[0]+t.dx*(ns[i]?.value||0),v[1]+t.dz*(ns[i]?.value||0)],[0,0]);
    if(Math.hypot(...g)<=maxGradient+1e-12)continue;
    const live=ts.map(t=>node(t)),free=live.map(n=>n.free),aa=ts.reduce((m,t,i)=>free[i]?[m[0]+t.dx*t.dx,m[1]+t.dx*t.dz,m[2]+t.dz*t.dz]:m,[0,0,0]);
    if(!aa[0]&&!aa[2])continue;
    const projected=l=>{const a=1+l*aa[0],b=l*aa[1],d=1+l*aa[2],det=a*d-b*b;return [(d*g[0]-b*g[1])/det,(a*g[1]-b*g[0])/det];};
    let hi=1;while(hi<1e12&&Math.hypot(...projected(hi))>maxGradient)hi*=2;
    let lo=0;for(let j=0;j<48;j++){const mid=(lo+hi)/2;if(Math.hypot(...projected(mid))>maxGradient)lo=mid;else hi=mid;}
    const q=projected(hi);for(let i=0;i<ts.length;i++)if(free[i])live[i].value=Math.max(-maxAdjustment,Math.min(maxAdjustment,live[i].value-hi*(ts[i].dx*q[0]+ts[i].dz*q[1])));
   }
  }
  maximum=constraints.reduce((v,c)=>Math.max(v,Math.abs(value(c))),0);if(maximum<=targetSag+1e-7)break;
 }
 let adjustment=0,gradient=0;for(const n of nodes.values()){adjustment=Math.max(adjustment,Math.abs(n.value));const at=(dx,dz)=>(nodes.get(key(n.x+dx,n.z+dz))?.value||0)-n.value;gradient=Math.max(gradient,Math.hypot(at(S,0),at(0,S))/S,Math.hypot(at(-S,0),at(0,-S))/S);}
 const values=Object.fromEntries([...nodes.values()].filter(n=>Math.abs(n.value)>1e-12).sort((a,b)=>a.key.localeCompare(b.key)).map(n=>[n.key,n.value]));
 const report={schema:1,status:'linear proxy only; emitted/geographic acceptance required',passed:!!constraints.length&&maximum<=targetSag+1e-6&&adjustment<=maxAdjustment+1e-10&&gradient<=maxGradient+1e-6,constraints:constraints.length,changedNodes:Object.keys(values).length,iterations:Math.min(iterations+1,maxIterations),maxPredictedSag:maximum,targetSag,ownerSagLimit:.5,maxAdjustment:adjustment,adjustmentLimit:maxAdjustment,maxGradient:gradient,gradientLimit:maxGradient,supportLimitMetres:maxSupportMetres,failures:constraints.filter(c=>Math.abs(value(c))>targetSag+1e-6).slice(0,20).map(c=>({id:c.id,before:c.signedSag,after:value(c)}))};
 return {values,report,sample:(x,z)=>terrainNodeBasis(x,z).reduce((v,t)=>v+t.w*(values[t.key]||0),0)};
}
