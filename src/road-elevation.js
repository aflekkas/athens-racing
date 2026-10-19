// A shoulder cannot join two folded/adjacent pieces of road with incompatible
// heights. Resolve only those local DEM conflicts on the physical carriageway
// axes (including mapped tunnel bores), then ease cuts along the race profile.
export function conformRoadElevations(route) {
 const {Y,N,step,B}=route,bins=new Map(),pairs=[],cell=16,original=Y.slice();
 // Psychiko's lap and its ground come from one measured height field, so nearby legs (a junction corner)
 // already share real ground: allow that hillside slope between them instead of a 2.5% DEM-mismatch bound.
 const slope=route.streetCircuit?.15:.025;
 for(let i=0;i<N;i++)for(const u of [-route.edge(i*step),0,route.edge(i*step)]){
  const p=route.point(i*step,u),q={x:p.x,z:p.z,i,u},cx=Math.floor(p.x/cell),cz=Math.floor(p.z/cell);
  for(let x=cx-1;x<=cx+1;x++)for(let z=cz-1;z<=cz+1;z++)for(const a of bins.get(`${x},${z}`)||[]){
   if(a.i===i)continue;const d=Math.hypot(a.x-q.x,a.z-q.z);const along=route.closed?Math.min(Math.abs(a.i-i),N-1-Math.abs(a.i-i))*step:Math.abs(a.i-i)*step;
   const centre=Math.hypot(route.X[a.i]-route.X[i],route.Z[a.i]-route.Z[i]);
   // Edges within two metres can overlap in a tight junction: keep their levels within 1 cm.
   // Farther apart they retain the measured hillside slope.
   if(d<16&&(centre<along*.8||d<along*.4))pairs.push([a,q,route.streetCircuit?Math.min(d*slope,.01+Math.max(0,d-2)*slope):d*slope]);
  }
  const key=`${cx},${cz}`;if(!bins.has(key))bins.set(key,[]);bins.get(key).push(q);
 }
 for(let pass=0;pass<24;pass++){
  let changed=0;
  for(const[a,b,limit]of pairs){let ay=Y[a.i]+a.u*B[a.i],by=Y[b.i]+b.u*B[b.i];if(Math.abs(ay-by)<=limit+.001)continue;
   // Bank is inferred, not surveyed. Remove it where folded pavement makes
   // it impossible to construct a continuous, driveable ground surface.
   B[a.i]=B[b.i]=0;ay=Y[a.i];by=Y[b.i];
   if(ay>by+limit){changed=Math.max(changed,ay-by-limit);Y[a.i]=by+limit;}else if(by>ay+limit){changed=Math.max(changed,by-ay-limit);Y[b.i]=ay+limit;}
  }
  for(let i=1;i<N;i++)Y[i]=Math.min(Y[i],Y[i-1]+.14*step);
  for(let i=N-2;i>=0;i--)Y[i]=Math.min(Y[i],Y[i+1]+.14*step);
  if(route.closed)Y[0]=Y[N-1]=Math.min(Y[0],Y[N-1]);
  if(changed<.001)break;
 }
 for(let i=0;i<N;i++){
  const a=route.closed?(i-1+N-1)%(N-1):Math.max(0,i-1),b=route.closed?(i+1)%(N-1):Math.min(N-1,i+1);
  route.GR[i]=(Y[b]-Y[a])/((route.closed?2:b-a)*step);
 }
 route.terrainLevelAdjustment=Math.max(...original.map((y,i)=>y-Y[i]));
}
