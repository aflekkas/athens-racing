// Physical acceptance for AWT contacts. Samples the emitted triangle planes,
// including exposed junction boundaries; never substitutes the generator field.
import {buildTileContactIndex,sampleTileContact} from '../src/world-tile-contact.js';
export const MAX_GRADE=Math.tan(Math.PI/6),MAX_STEP=.15,MAX_PROFILE_GRADE=.45;
// Coastal OSM hillsides and service-road switchbacks reach 42% over a few metres
// (survey of the 127-cell coast). The owner gate is asphalt <=30 degrees (57%),
// checked per triangle; this is only a sanity bound on emitted graph samples.
export function auditWorldSurface(t,{spacing=2,sweepStep=.25,sweepMetres=6,structures=[],ids=[]}={}) {
  const guarded=new Set();
  for(const s of structures){
    if(s.kind!=='osm-bridge-guarded'||s.layer!==1||s.shoulderMetres!==.25||!s.bridgeSources?.length||!s.bridgeSources.every(id=>s.roads?.includes(id)))throw Error('Invalid guarded OSM bridge shoulder exception');
    for(const id of s.roads)guarded.add('surface:'+id);
  }
  const p=t.contactPositions,ix=t.contactTriangles,edges=new Map();
  let maxProfileGrade=0;
  const graph=t.edgePoints||[];
  for(let i=0;i<(t.edges?.length||0);i+=10){
    const start=t.edges[i+3],count=t.edges[i+4];
    for(let j=start+1;j<start+count;j++){const a=(j-1)*3,b=j*3,d=Math.hypot(graph[b]-graph[a],graph[b+2]-graph[a+2]);if(d>1e-6)maxProfileGrade=Math.max(maxProfileGrade,Math.abs(graph[b+1]-graph[a+1])/d);}
  }
  const offenders=new Set(),surfaceRoad=id=>String(ids[id]||'').replace(/^surface:/,'');
  let asphaltTriangles=0,asphaltAbove30=0,maxAsphaltGrade=0,missingContacts=0,samples=0,outsideFixture=0,maxShoulderStep=0,maxShoulderGrade=0,worstShoulder=null,guardedShoulderSamples=0;
  const point=v=>[p[v*3],p[v*3+1],p[v*3+2]];
  for(let i=0;i<ix.length;i+=5){
    const ids=[ix[i],ix[i+1],ix[i+2]],a=point(ids[0]),b=point(ids[1]),c=point(ids[2]),road=!!(ix[i+4]&1);
    const ux=b[0]-a[0],uy=b[1]-a[1],uz=b[2]-a[2],vx=c[0]-a[0],vy=c[1]-a[1],vz=c[2]-a[2];
    const grade=Math.hypot(uy*vz-uz*vy,ux*vy-uy*vx)/Math.abs(uz*vx-ux*vz);
    if(!Number.isFinite(grade))throw Error('Degenerate contact triangle');
    if(road){asphaltTriangles++;maxAsphaltGrade=Math.max(maxAsphaltGrade,grade);if(grade>MAX_GRADE){asphaltAbove30++;offenders.add(surfaceRoad(ix[i+3]));}}
    for(let j=0;j<3;j++){
      const u=ids[j],v=ids[(j+1)%3],key=u<v?`${u},${v}`:`${v},${u}`;
      if(!edges.has(key))edges.set(key,[]);
      edges.get(key).push({u,v,road,surface:ix[i+3],layer:t.contactLayers[i/5],center:[(a[0]+b[0]+c[0])/3,(a[2]+b[2]+c[2])/3]});
    }
  }
  // Disable coarse/fine fallback: those can conceal a missing emitted face.
  const contacts={...t,finePositions:[],fineTriangles:[],coarseHeights:Array(1089).fill(NaN)};
  const index=buildTileContactIndex(contacts);
  for(const faces of edges.values()){
    if(faces.length!==2||faces[0].road===faces[1].road)continue;
    const ground=faces.find(f=>!f.road),a=point(ground.u),b=point(ground.v),dx=b[0]-a[0],dz=b[2]-a[2],length=Math.hypot(dx,dz);
    // Owner exception: only source-verified bridge=yes ways and connected
    // approaches with solid visible guardrails receive the narrow sweep.
    const narrow=ground.layer===1&&guarded.has(ids[faces.find(f=>f.road).surface]);
    const sweep=narrow?.25:sweepMetres;
    let nx=-dz/length,nz=dx/length;
    if(nx*(ground.center[0]-a[0])+nz*(ground.center[1]-a[2])<0){nx=-nx;nz=-nz;}
    const steps=Math.max(1,Math.ceil(length/spacing));
    for(let j=0;j<=steps;j++){
      let previous=null;
      for(let k=0;k<=Math.ceil(sweep/sweepStep);k++){
        const d=Math.min(sweep,k*sweepStep),x=a[0]+dx*j/steps+nx*d,z=a[2]+dz*j/steps+nz*d;
        if(x<0||z<0||x>=512||z>=512){outsideFixture++;previous=null;continue;}
        const hit=sampleTileContact(contacts,index,x,z,{layer:ground.layer});samples++;if(narrow)guardedShoulderSamples++;
        if(!hit||!Number.isFinite(hit.y)){missingContacts++;previous=null;continue;}
        if(previous!==null){const step=Math.abs(hit.y-previous),grade=step/sweepStep;
          maxShoulderStep=Math.max(maxShoulderStep,step);
          if(step>MAX_STEP||grade>MAX_GRADE)offenders.add(surfaceRoad(faces.find(f=>f.road).surface));
          if(grade>maxShoulderGrade){maxShoulderGrade=grade;worstShoulder={x,z,d,nx,nz,previousY:previous,y:hit.y};}
        }
        previous=hit.y;
      }
    }
  }
  const passed=maxProfileGrade<=MAX_PROFILE_GRADE+2e-6&&asphaltAbove30===0&&missingContacts===0&&maxShoulderStep<=MAX_STEP&&maxShoulderGrade<=MAX_GRADE;
  return {passed,maxProfileGrade,asphaltTriangles,asphaltAbove30,maxAsphaltDegrees:Math.atan(maxAsphaltGrade)*180/Math.PI,shoulderSamples:samples,guardedShoulderSamples,outsideFixture,missingContacts,maxShoulderStep,maxShoulderDegrees:Math.atan(maxShoulderGrade)*180/Math.PI,worstShoulder,offenders:[...offenders].filter(Boolean).sort()};
}

// CLI intentionally accepts development NDJSON rather than assuming that
// structurally valid .bin.gz fixtures already passed physical conformance.
if(process.argv[1]===import.meta.filename){
  const {createReadStream}=await import('node:fs');
  const {createInterface}=await import('node:readline');
  const reports=[];
  for(const path of process.argv.slice(2))for await(const line of createInterface({input:createReadStream(path),crlfDelay:Infinity})){
    if(!line.trim())continue;
    const tile=JSON.parse(line),report={cell:tile.metadata.cell,...auditWorldSurface(tile.tables,tile.metadata)};reports.push(report);
  }
  if(!reports.length)throw Error('No surface inputs');
  console.log(JSON.stringify(reports,null,2));process.exitCode=reports.every(r=>r.passed)?0:1;
}
