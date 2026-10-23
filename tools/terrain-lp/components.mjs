// Rebuild component membership and full semantic rows independently of Python.
// Component certificates are diagnostic; only a complete verified bundle can
// establish the shared-G maximum and a full-model primal/dual bound.
import{terrainLPModel,verifyTerrainLPCertificate,basis}from'./verify.mjs';
import{readFile}from'node:fs/promises';import{createHash}from'node:crypto';import{pathToFileURL}from'node:url';
const key=(x,z)=>`${x},${z}`,bad=s=>{throw Error('Terrain LP components: '+s);};
export function partitionTerrainLP(data,options={}){
 if(data.chords?.length>5000||data.nodes?.length>50000||data.source?.cells?.length>5)bad('bounded five-cell analysis only');
 const m=terrainLPModel(data,options),parent=new Map();for(let i=0;i<m.n;i++)if(m.bounds[i][0]<0)parent.set(i,i);
 const find=i=>{while(parent.get(i)!==i){parent.set(i,parent.get(parent.get(i)));i=parent.get(i);}return i;};
 const join=items=>{const ids=items.filter(i=>parent.has(i));if(ids.length){const a=find(ids[0]);for(const i of ids.slice(1))parent.set(find(i),a);}};
 for(const ts of m.terms)join(ts.filter(([,a])=>Math.abs(a)>1e-14).map(([k])=>m.index.get(k)));
 for(const tri of m.triangles())join(tri.map(([x,z])=>m.index.get(key(x,z))));
 for(const p of m.profiles)join(basis(p.x,p.z).filter(([,,w])=>Math.abs(w)>1e-14).map(([x,z])=>m.index.get(key(x,z))));
 const grouped=new Map();for(const i of parent.keys()){const r=find(i);if(!grouped.has(r))grouped.set(r,[]);grouped.get(r).push(i);}
 const groups=[...grouped.values()].map(ids=>ids.sort((a,b)=>a-b)).sort((a,b)=>a[0]-b[0]),owner=new Map(),components=groups.map((nodes,k)=>{for(const i of nodes)owner.set(i,k);return{id:key(...m.coords[nodes[0]]),nodes,globalVariables:[...nodes,m.g],rows:[],nonzeros:0};});
 if(options.stage==='correction'){let u=m.n+1;for(let i=0;i<m.n;i++)if(parent.has(i)){const k=owner.get(i);owner.set(u,k);components[k].globalVariables.push(u++);}}
 const rowOwners=new Int32Array(m.rowCount);rowOwners.fill(-1);const fixedOnlyInfeasible=[];let redundant=0,r=0;
 for(const row of m.rows()){
  const owners=new Set(row.terms.filter(([i,a])=>Math.abs(a)>1e-14&&owner.has(i)).map(([i])=>owner.get(i)));
  if(owners.size>1)bad('membership crosses full semantic row');
  if(!owners.size){const gc=row.terms.reduce((s,[i,a])=>s+(i===m.g?a:0),0);if(gc===0&&row.rhs<0)fixedOnlyInfeasible.push({fullRow:r,rhs:row.rhs});else if(gc<=0&&row.rhs>=0)redundant++;else bad('unsupported shared-gradient-only constraint');}
  else{const k=[...owners][0];rowOwners[r]=k;components[k].rows.push(r);components[k].nonzeros+=row.terms.filter(([i,a])=>Math.abs(a)>1e-14&&(owner.has(i)||i===m.g)).length;}
  r++;
 }
 if(r!==m.rowCount)bad('row reconstruction count');
 return{model:m,components,owner,rowOwners,fixedOnlyInfeasible,redundant};
}
function validateComponent(plan,certificate,{inputSHA256,expectedGradientCap}={}){
 if(!['inner','outer'].includes(certificate.mode)||!['gradient','correction'].includes(certificate.stage)||![8,16,32].includes(certificate.facets))bad('component model binding');
 if(certificate.schema!=='terrain-lp-component-1'||certificate.partitionVersion!==1||certificate.inputSHA256!==inputSHA256||certificate.fullRowCount!==plan.model.rowCount)bad('component source/schema binding');
 const k=plan.components.findIndex(c=>c.id===certificate.componentId);if(k<0)bad('unknown component ID');const component=plan.components[k],ids=certificate.globalVariables;
 if(JSON.stringify(ids)!==JSON.stringify(component.globalVariables))bad('component membership/variable remap mismatch');
 if(!Array.isArray(certificate.values)||certificate.values.length!==ids.length||!certificate.values.every(Number.isFinite))bad('component primal shape');
 const values=Array(plan.model.bounds.length).fill(0);for(let j=0;j<ids.length;j++)values[ids[j]]=certificate.values[j];
 const seen=new Set();for(const pair of certificate.dual||[]){if(!Array.isArray(pair)||pair.length!==2)bad('component dual shape');const[r,y]=pair;if(!Number.isInteger(r)||r<0||r>=plan.model.rowCount||plan.rowOwners[r]!==k||seen.has(r)||!Number.isFinite(y)||y>0)bad('component dual full-row/membership/sign mismatch');seen.add(r);}
 const expanded={...certificate,schema:'terrain-lp-certificate-1',values};
 // Full-model verifier checks every full semantic row and computes a valid
 // component dual lower bound for the whole LP. Other-component primal rows
 // are deliberately not accepted here; complete bundle validation below is mandatory.
 const full=verifyTerrainLPCertificate(plan.data,expanded,{inputSHA256,expectedGradientCap});
 let maxRow=0,r=0,maxSag=0;for(const row of plan.model.rows()){if(plan.rowOwners[r]===k){const lhs=row.terms.reduce((s,[i,a])=>s+a*values[i],0);maxRow=Math.max(maxRow,lhs-row.rhs);if(r<2*plan.model.chords.length)maxSag=Math.max(maxSag,.5+lhs-row.rhs);}r++;}
 const primalPassed=maxRow<=1e-7&&maxSag<=.5+1e-7&&full.boundViolation<=1e-8&&full.maxAdjustment<=.75+1e-8&&full.protectedMaxAdjustment<=1e-10&&full.maxProfileCorrection<=1e-8&&full.maxEuclideanGradient<=full.gradientVariable+1e-8;
 return{componentId:component.id,mode:certificate.mode,stage:certificate.stage,primalPassed,dualPassed:full.dualPassed,objective:full.objective,conservativeDualBound:full.conservativeDualBound,dualityGap:full.dualityGap,gradientVariable:full.gradientVariable,maxEuclideanGradient:full.maxEuclideanGradient,maxSag,maxAdjustment:full.maxAdjustment,maxProfileCorrection:full.maxProfileCorrection,maxRowViolation:maxRow,values,dual:certificate.dual};
}
export function verifyTerrainLPComponent(data,certificate,options={}){
 const plan=partitionTerrainLP(data,{mode:certificate.mode,stage:certificate.stage,facets:certificate.facets,gradientCap:options.expectedGradientCap});plan.data=data;if(plan.fixedOnlyInfeasible.length)bad('fixed-only infeasible full row');
 const{values,dual,...report}=validateComponent(plan,certificate,options);return{...report,completeModelVerified:false,emittedCells:0};
}
export function verifyTerrainLPDecomposition(data,bundle,{inputSHA256,expectedGradientCap}={}){
 if(!['inner','outer'].includes(bundle.mode)||!['gradient','correction'].includes(bundle.stage)||![8,16,32].includes(bundle.facets))bad('bundle model binding');
 if(bundle.schema!=='terrain-lp-decomposition-1'||bundle.inputSHA256!==inputSHA256||!inputSHA256||!Array.isArray(bundle.components))bad('bundle/source binding');
 const plan=partitionTerrainLP(data,{mode:bundle.mode,stage:bundle.stage,facets:bundle.facets,gradientCap:expectedGradientCap});plan.data=data;
 if(plan.fixedOnlyInfeasible.length)bad('fixed-only infeasible full row');
 if(bundle.components.length!==plan.components.length||new Set(bundle.components.map(c=>c.componentId)).size!==plan.components.length)bad('incomplete or duplicate component membership');
 const reports=bundle.components.map(c=>{if(c.mode!==bundle.mode||c.stage!==bundle.stage||c.facets!==bundle.facets)bad('mixed component model');return validateComponent(plan,c,{inputSHA256,expectedGradientCap});});
 const values=Array(plan.model.bounds.length).fill(0);let gradient=0;for(const report of reports){const component=plan.components.find(c=>c.id===report.componentId);for(const i of component.globalVariables)if(i!==plan.model.g)values[i]=report.values[i];gradient=Math.max(gradient,report.gradientVariable);}
 values[plan.model.g]=bundle.stage==='correction'?expectedGradientCap:gradient;
 let dual=[];if(bundle.stage==='gradient'&&reports.length)dual=reports.reduce((a,b)=>a.conservativeDualBound>=b.conservativeDualBound?a:b).dual;else if(bundle.stage==='correction')dual=reports.flatMap(r=>r.dual);
 const fullCertificate={schema:'terrain-lp-certificate-1',inputSHA256,mode:bundle.mode,stage:bundle.stage,facets:bundle.facets,gradientCap:expectedGradientCap,values,dual},full=verifyTerrainLPCertificate(data,fullCertificate,{inputSHA256,expectedGradientCap});
 const componentLower=bundle.stage==='correction'?reports.reduce((s,r)=>s+r.conservativeDualBound,0):Math.max(0,...reports.map(r=>r.conservativeDualBound));
 return{schema:'terrain-lp-decomposition-verification-1',inputSHA256,mode:bundle.mode,stage:bundle.stage,fullPrimalPassed:full.primalPassed&&reports.every(r=>r.primalPassed),fullDualPassed:full.dualPassed&&reports.every(r=>r.dualPassed),gradientVariable:full.gradientVariable,maxEuclideanGradient:full.maxEuclideanGradient,maxSag:full.maxSag,maxAdjustment:full.maxAdjustment,maxProfileCorrection:full.maxProfileCorrection,objective:full.objective,conservativeDualBound:full.conservativeDualBound,dualityGap:full.dualityGap,optimumVerified:full.primalPassed&&full.dualPassed&&reports.every(r=>r.primalPassed&&r.dualPassed)&&full.dualityGap<=1e-6,componentLowerBound:componentLower,components:reports.map(({values,dual,...r})=>r),fullCertificate,emittedCells:0,geographyAccepted:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const[input,certificatePath,expectedSHA,priorPath]=process.argv.slice(2),raw=await readFile(input);if(createHash('sha256').update(raw).digest('hex')!==expectedSHA)bad('pinned input hash');const data=JSON.parse(raw),certificate=JSON.parse(await readFile(certificatePath));let expectedGradientCap;
 if(certificate.stage==='correction'){if(!priorPath)bad('verified prior optimum required');const prior=verifyTerrainLPDecomposition(data,JSON.parse(await readFile(priorPath)),{inputSHA256:expectedSHA});if(prior.mode!=='inner'||prior.stage!=='gradient'||!prior.fullPrimalPassed||!prior.fullDualPassed||prior.dualityGap>1e-6)bad('unverified prior optimum');expectedGradientCap=prior.gradientVariable;}
 const report=certificate.schema==='terrain-lp-component-1'?verifyTerrainLPComponent(data,certificate,{inputSHA256:expectedSHA,expectedGradientCap}):verifyTerrainLPDecomposition(data,certificate,{inputSHA256:expectedSHA,expectedGradientCap});console.log(JSON.stringify(report));if(!(report.fullPrimalPassed??report.primalPassed)||!(report.fullDualPassed??report.dualPassed))process.exitCode=1;
}
