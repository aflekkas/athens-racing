import {vegetationContactIndex,vegetationRadius,streetTreeHeight,speciesOfBakeRow} from '../src/vegetation-clearance.js';
import {forestCandidates,forestRadius} from '../src/vegetation-forest.js';
export function auditPacketVegetation(pack,t){
  const index=vegetationContactIndex(t),ext=pack.metadata.extensions?.worldDetail,report={checked:0,violations:[]};
  const check=(kind,row,x,z,radius)=>{report.checked++;if(!index.clear(x,z,radius))report.violations.push({kind,row,x,z,radius});};
  if(ext?.streetTrees!=null){const a=pack.arrays[ext.streetTrees];for(let i=0;i<a.length;i+=5){const code=a[i+4]|0,species=code>>3;check('street',i/5,a[i],a[i+2],vegetationRadius(species,streetTreeHeight(species,code&7,ext.penteli===true),ext.penteli===true||i/5>=a.length/5-(ext.coastalTreeCount||0)));}}
  if(ext?.vegetation){const v=ext.vegetation,p=pack.arrays[v.positionHeight],k=pack.arrays[v.kind],s=pack.arrays[v.seed];for(let i=0;i<k.length;i++)check('mapped',i,p[i*4],p[i*4+2],vegetationRadius(speciesOfBakeRow(k[i],s[i]),Math.min(10,Math.max(3,p[i*4+3]))));}
  report.passed=!report.violations.length;return report;
}
export function assertVegetationClearance(pack,t){const report=auditPacketVegetation(pack,t);if(!report.passed)throw Error('Vegetation intersects drivable contact or ownership boundary: '+JSON.stringify(report.violations.slice(0,4)));return report;}
export function forestByCell(asset){const cells=new Map();for(const row of forestCandidates(asset)){const key=Math.floor(row.x/512)+','+Math.floor(row.z/512);if(!cells.has(key))cells.set(key,[]);cells.get(key).push(row);}return cells;}
export function clearForestCell(asset,rows,t,cell){const f=asset.metadata.forest,mask=asset.arrays[f.clearanceArray],index=vegetationContactIndex(t);let kept=0;
  for(const r of rows||[])if(index.clear(r.x-cell[0]*512,r.z-cell[1]*512,forestRadius(r.scale))){mask[r.i]|=1<<r.j;kept++;}return kept;
}
