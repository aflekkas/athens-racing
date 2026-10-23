// Independent semantic LP reconstruction and conservative sparse dual bound.
// No SciPy, matrix, trusted solver objective or supplied chord coefficients.
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const hash=b=>createHash('sha256').update(b).digest('hex'), key=(x,z)=>`${x},${z}`;
const finite=n=>typeof n==='number'&&Number.isFinite(n), fail=s=>{throw Error('Terrain LP: '+s);};
export function basis(x,z){
 const ax=Math.floor(x/8)*8,az=Math.floor(z/8)*8,u=(x-ax)/8,v=(z-az)/8;
 return u+v<=1?[[ax,az,1-u-v,-.125,-.125],[ax+8,az,u,.125,0],[ax,az+8,v,0,.125]]:[[ax+8,az+8,u+v-1,.125,.125],[ax,az+8,1-u,-.125,0],[ax+8,az,1-v,0,-.125]];
}
function chordTerms(c){
 if(!finite(c.signedSag)||!['a','b','c'].every(k=>finite(c[k]?.x)&&finite(c[k]?.z)))fail('invalid observation');
 const bend=[c.b.x-(c.a.x+c.c.x)/2,c.b.z-(c.a.z+c.c.z)/2],m=new Map();
 for(const[p,s,bent]of[[c.a,-.5,false],[c.b,1,true],[c.c,-.5,false]])for(const[x,z,w,dx,dz]of basis(p.x,p.z)){const k=key(x,z);m.set(k,(m.get(k)||0)+s*w-(bent?bend[0]*dx+bend[1]*dz:0));}
 return [...m].filter(([,v])=>Math.abs(v)>1e-12);
}
export function terrainLPModel(data,{mode='inner',stage='gradient',gradientCap,facets=16}={}){
 if(data.schema!=='terrain-lp-input-1'||!data.sourceRevision||!['inner','outer'].includes(mode)||!['gradient','correction'].includes(stage)||![8,16,32].includes(facets))fail('input/mode');
 if(stage==='correction'&&(mode!=='inner'||!finite(gradientCap)||gradientCap<=0))fail('verified correction gradient cap required');
 const chords=[...data.chords].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);if(!chords.length||new Set(chords.map(c=>c.id)).size!==chords.length)fail('duplicate/missing chord');
 const terms=chords.map(chordTerms),coordsMap=new Map();for(const ts of terms)for(const[k]of ts){const[x,z]=k.split(',').map(Number);for(let dx=-32;dx<=32;dx+=8)for(let dz=-32;dz<=32;dz+=8)if(dx*dx+dz*dz<=1024)coordsMap.set(key(x+dx,z+dz),[x+dx,z+dz]);}
 const coords=[...coordsMap.values()].sort((a,b)=>a[0]-b[0]||a[1]-b[1]),index=new Map(coords.map((p,i)=>[key(...p),i])),declared=new Map(data.nodes.map(n=>[key(n.x,n.z),n.free]));
 if(declared.size!==data.nodes.length||declared.size!==coords.length||coords.some(p=>typeof declared.get(key(...p))!=='boolean'))fail('support/node declaration mismatch');
 const n=coords.length,g=n,bounds=coords.map(p=>declared.get(key(...p))?[-.75,.75]:[0,0]);bounds.push(stage==='gradient'?[0,null]:[gradientCap,gradientCap]);const objective=Array(n+1).fill(0),absvars=[];if(stage==='gradient')objective[g]=1;
 if(stage==='correction')for(let i=0;i<n;i++)if(declared.get(key(...coords[i]))){const w=data.correctionWeights?.[key(...coords[i])]??1;if(!finite(w)||w<1||w>100)fail('invalid geography weight');absvars.push([i,bounds.length]);bounds.push([0,null]);objective.push(w);}
 const profiles=data.geography?.fixedSamples;if(!profiles?.some(p=>p.kind==='summit')||!profiles.some(p=>p.kind==='profile'))fail('summit/profile constraints required');
 for(const p of profiles)if(!p.id||!p.sourceSHA256||![p.x,p.z,p.sourceY].every(finite))fail('source profile receipt');
 const squaresMap=new Map();for(const[x,z]of coords)for(const[dx,dz]of[[0,0],[-8,0],[0,-8],[-8,-8]])squaresMap.set(key(x+dx,z+dz),[x+dx,z+dz]);const squares=[...squaresMap.values()].sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
 const factor=mode==='inner'?Math.cos(Math.PI/facets):1;
 const triangles=function*(){for(const[x,z]of squares){yield [[x,z,-.125,-.125],[x+8,z,.125,0],[x,z+8,0,.125]];yield [[x+8,z+8,.125,.125],[x,z+8,-.125,0],[x+8,z,0,-.125]];}};
 const rows=function*(){
  for(let j=0;j<chords.length;j++)for(const sign of[1,-1])yield {terms:terms[j].map(([k,v])=>[index.get(k),sign*v]),rhs:.5-sign*chords[j].signedSag};
  for(const tri of triangles())for(let j=0;j<facets;j++){const a=2*Math.PI*j/facets,ts=tri.filter(([x,z])=>index.has(key(x,z))).map(([x,z,dx,dz])=>[index.get(key(x,z)),dx*Math.cos(a)+dz*Math.sin(a)]);yield {terms:[...ts,[g,-factor]],rhs:0};}
  for(const p of profiles)for(const sign of[1,-1])yield {terms:basis(p.x,p.z).filter(([x,z])=>index.has(key(x,z))).map(([x,z,w])=>[index.get(key(x,z)),sign*w]),rhs:0};
  for(const[i,u]of absvars){yield {terms:[[i,1],[u,-1]],rhs:0};yield {terms:[[i,-1],[u,-1]],rhs:0};}
 };
 const rowCount=chords.length*2+squares.length*2*facets+profiles.length*2+absvars.length*2;
 return {chords,terms,coords,index,n,g,bounds,objective,profiles,rows,triangles,rowCount};
}
export function verifyTerrainLPCertificate(data,certificate,{inputSHA256,expectedGradientCap}={}){
 if(certificate.schema!=='terrain-lp-certificate-1'||!inputSHA256||certificate.inputSHA256!==inputSHA256)fail('certificate/source hash mismatch');
 if(certificate.stage==='correction'&&certificate.gradientCap!==expectedGradientCap)fail('secondary cap does not match verified prior');
 const m=terrainLPModel(data,{mode:certificate.mode,stage:certificate.stage,gradientCap:expectedGradientCap,facets:certificate.facets}),v=certificate.values;
 if(!Array.isArray(v)||v.length!==m.bounds.length||!v.every(finite))fail('invalid primal values');
 const dual=new Map();for(const pair of certificate.dual||[]){if(!Array.isArray(pair)||pair.length!==2)fail('dual shape');const[i,y]=pair;if(!Number.isInteger(i)||i<0||i>=m.rowCount||!finite(y)||y>0||dual.has(i))fail('dual row/sign/duplicate');dual.set(i,y);}
 // Accumulate A^T y and b^T y from reconstructed rows; no matrix/coefficient input.
 const q=new Float64Array(v.length),absQ=new Float64Array(v.length),counts=new Uint32Array(v.length),absY=new Float64Array(v.length);let by=0,absBy=0,maxRowViolation=0,r=0,byCount=0;
 for(const row of m.rows()){
  let lhs=0;for(const[i,a]of row.terms)lhs+=a*v[i];maxRowViolation=Math.max(maxRowViolation,lhs-row.rhs);
  const y=dual.get(r++)||0;if(!y)continue;by+=row.rhs*y;absBy+=Math.abs(row.rhs*y);byCount++;for(const[i,a]of row.terms){q[i]+=a*y;absQ[i]+=Math.abs(a*y);counts[i]++;absY[i]+=Math.abs(y);}
 }
 if(r!==m.rowCount)fail('semantic row count');
 // Normalize dual to leave positive slack on every unbounded primal variable.
 // Residual on bounded variables is paid analytically, rather than tolerated.
 const error=i=>8*Number.EPSILON*(counts[i]+2)*(absQ[i]+1)+1e-13*absY[i];
 let ratio=1;for(let i=0;i<v.length;i++)if(m.bounds[i][1]===null){if(!(m.objective[i]>0))fail('unsupported unbounded objective');ratio=Math.max(ratio,(q[i]+error(i))/m.objective[i]);}
 const scale=1/(ratio+1e-10);let lower=by*scale-8*Number.EPSILON*(byCount+2)*(absBy*scale+1),maxStationarity=0,unboundedSafe=true,boundViolation=0;
 for(let i=0;i<v.length;i++){
  const[lo,hi]=m.bounds[i],res=m.objective[i]-q[i]*scale,err=error(i)*scale+8*Number.EPSILON;maxStationarity=Math.max(maxStationarity,Math.abs(res));boundViolation=Math.max(boundViolation,lo-v[i],hi===null?0:v[i]-hi);
  if(hi===null){if(res-err<0)unboundedSafe=false;}else lower+=Math.min((res-err)*lo,(res-err)*hi,(res+err)*lo,(res+err)*hi);
 }
 let norm=0;const at=(x,z)=>v[m.index.get(key(x,z))]||0;for(const tri of m.triangles()){let gx=0,gz=0;for(const[x,z,dx,dz]of tri){gx+=at(x,z)*dx;gz+=at(x,z)*dz;}norm=Math.max(norm,Math.hypot(gx,gz));}
 let sag=0,amp=0,protectedMax=0,profileMax=0;for(let j=0;j<m.chords.length;j++)sag=Math.max(sag,Math.abs(m.chords[j].signedSag+m.terms[j].reduce((s,[k,c])=>s+c*v[m.index.get(k)],0)));
 for(let i=0;i<m.n;i++){amp=Math.max(amp,Math.abs(v[i]));if(m.bounds[i][0]===0&&m.bounds[i][1]===0)protectedMax=Math.max(protectedMax,Math.abs(v[i]));}
 for(const p of m.profiles)profileMax=Math.max(profileMax,Math.abs(basis(p.x,p.z).reduce((s,[x,z,w])=>s+w*at(x,z),0)));
 const objective=m.objective.reduce((s,c,i)=>s+c*v[i],0),dualPassed=unboundedSafe&&finite(lower)&&lower<=objective+1e-7,primalPassed=maxRowViolation<=1e-7&&boundViolation<=1e-8&&sag<=.5+1e-7&&amp<=.75+1e-8&&protectedMax<=1e-10&&profileMax<=1e-8&&norm<=v[m.g]+1e-8;
 return {schema:'terrain-lp-verification-1',inputSHA256,mode:certificate.mode,stage:certificate.stage,primalPassed,dualPassed,objective,conservativeDualBound:lower,dualityGap:objective-lower,dualNormalization:scale,gradientVariable:v[m.g],maxEuclideanGradient:norm,maxSag:sag,maxAdjustment:amp,protectedMaxAdjustment:protectedMax,maxProfileCorrection:profileMax,maxRowViolation,boundViolation,dualResidualBeforeBoundPayment:maxStationarity,emittedCells:0,geographyAccepted:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const[inputPath,certPath,expectedSHA,priorPath]=process.argv.slice(2),raw=await readFile(inputPath);if(hash(raw)!==expectedSHA)fail('pinned observations hash mismatch');const data=JSON.parse(raw),certificate=JSON.parse(await readFile(certPath));let expectedGradientCap;
 if(certificate.stage==='correction'){if(!priorPath)fail('verified prior certificate required');const prior=verifyTerrainLPCertificate(data,JSON.parse(await readFile(priorPath)),{inputSHA256:expectedSHA});if(!prior.primalPassed||!prior.dualPassed||prior.mode!=='inner'||prior.stage!=='gradient'||prior.dualityGap>1e-6)fail('unverified prior optimum');expectedGradientCap=prior.gradientVariable;}
 const report=verifyTerrainLPCertificate(data,certificate,{inputSHA256:expectedSHA,expectedGradientCap});console.log(JSON.stringify(report));if(!report.dualPassed||!report.primalPassed)process.exitCode=1;
}
