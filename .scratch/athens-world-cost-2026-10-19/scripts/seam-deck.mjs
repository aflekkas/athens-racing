import {readFileSync} from 'node:fs';
const rows=readFileSync(process.argv[2],'utf8').trim().split('\n').map(l=>JSON.parse(l));
const cellname=process.argv[3],axis=Number(process.argv[4]),val=Number(process.argv[5]),x0=Number(process.argv[6]);
const T=rows.find(r=>r.metadata.cell.join()===cellname),t=T.tables,m=T.metadata;
const P=t.contactPositions,compactGround=t.fineSurface?.length||0;
console.log('deck rows',t.contactTriangles.length/5,'ground',compactGround);
for(let i=0;i<t.contactTriangles.length;i+=5){
 const v=[0,1,2].map(j=>t.contactTriangles[i+j]);
 const pts=v.map(k=>[P[k*3]+m.origin[0],P[k*3+1],P[k*3+2]+m.origin[2]]);
 if(pts.some(p=>Math.abs(p[0]-x0)<2)&&pts.some(p=>p[2]===val))console.log('row',i/5,'layer',t.contactLayers[i/5],'flags',t.contactTriangles[i+4],JSON.stringify(pts.map(p=>p.map(x=>+x.toFixed(4)))));
}
