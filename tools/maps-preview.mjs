// Rebuild menu route previews from the same projected map geometry used at runtime.
import fs from 'node:fs';
import { MAPS } from '../src/map-catalog.js';
for(const def of MAPS){
 const m=JSON.parse(fs.readFileSync(def.dataUrl)), r=m.route;
 const minX=Math.min(...r.x),maxX=Math.max(...r.x),minZ=Math.min(...r.z),maxZ=Math.max(...r.z);
 const scale=Math.min(640/(maxX-minX),340/(maxZ-minZ)), cx=(maxX+minX)/2,cz=(maxZ+minZ)/2;
 const xy=(x,z)=>`${(400+(x-cx)*scale).toFixed(1)},${(240+(z-cz)*scale).toFixed(1)}`;
 const line=r.x.filter((_,i)=>i%4===0).map((x,j)=>xy(x,r.z[j*4])).join(' ');
 const land=def.id==='riviera'?'#1c3d45':def.id==='megara'?'#3c4230':'#2b3f31';
 const roads=m.sideRoads.map(a=>`<polyline points="${Array.from({length:a.p.length/2},(_,i)=>xy(a.p[i*2],a.p[i*2+1])).join(' ')}" fill="none" stroke="#e7d5ac" stroke-opacity=".10" stroke-width="1"/>`).join('');
 const buildings=m.buildings.map(a=>`<polygon points="${Array.from({length:a.p.length/2},(_,i)=>xy(a.p[i*2],a.p[i*2+1])).join(' ')}" fill="#bfc3ac" fill-opacity=".10"/>`).join('');
 const coast=m.coast.map(p=>`<polyline points="${Array.from({length:p.length/2},(_,i)=>xy(p[i*2],p[i*2+1])).join(' ')}" fill="none" stroke="#43c4c1" stroke-opacity=".55" stroke-width="2"/>`).join('');
 const s=Math.round(r.start/r.step), start=xy(r.x[s],r.z[s]).split(',');
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="480" viewBox="0 0 800 480"><defs><radialGradient id="g"><stop stop-color="${land}"/><stop offset="1" stop-color="#111a20"/></radialGradient></defs><rect width="800" height="480" fill="url(#g)"/><path d="M0 80H800M0 160H800M0 240H800M0 320H800M0 400H800M80 0V480M160 0V480M240 0V480M320 0V480M400 0V480M480 0V480M560 0V480M640 0V480M720 0V480" stroke="#fff" opacity=".035"/>${roads}${buildings}${coast}<polyline points="${line}" fill="none" stroke="#000" stroke-width="14" stroke-linejoin="round"/><polyline points="${line}" fill="none" stroke="#efeee8" stroke-width="7" stroke-linejoin="round"/><polyline points="${line}" fill="none" stroke="#f45143" stroke-width="3" stroke-linejoin="round"/><circle cx="${start[0]}" cy="${start[1]}" r="7" fill="#fff" stroke="#f45143" stroke-width="3"/><text x="32" y="42" font-family="sans-serif" font-size="12" letter-spacing="3" fill="#aab9b7">${def.type==='circuit'?'CIRCUIT LAYOUT':'ROUTE MAP'}</text><path d="M750 54V23L742 36M750 23L758 36" fill="none" stroke="#aab9b7" stroke-width="2"/><text x="746" y="75" font-family="sans-serif" font-size="12" fill="#aab9b7">N</text></svg>`;
 fs.writeFileSync(`assets/maps/${def.id}.svg`,svg);
}
