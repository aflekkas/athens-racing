// Offline route preview; street context and outline are both from the shipped bundle.
import fs from 'node:fs';
const data=JSON.parse(fs.readFileSync(new URL('../../../data/maps/psychiko/map.json',import.meta.url)));
const r=data.route,minX=Math.min(...r.x),maxX=Math.max(...r.x),minZ=Math.min(...r.z),maxZ=Math.max(...r.z),scale=Math.min(620/(maxX-minX),340/(maxZ-minZ));
const xy=(x,z)=>[400+(x-(minX+maxX)/2)*scale,250+(z-(minZ+maxZ)/2)*scale],points=p=>p.map(([x,z])=>xy(x,z).map(v=>v.toFixed(1)).join(',')).join(' ');
const route=points(r.x.filter((_,i)=>i%4===0).map((x,j)=>[x,r.z[j*4]]));
const [x,z]=xy(r.x[0],r.z[0]);
const streets=data.roadNetwork.roads.map(q=>`<polyline points="${points(q.p.filter((_,i)=>i%2===0).map((x,j)=>[x,q.p[j*2+1]]))}" fill="none" stroke="#d0d9b8" stroke-opacity=".11" stroke-width="1"/>`).join('');
const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="480" viewBox="0 0 800 480"><defs><radialGradient id="g"><stop stop-color="#294439"/><stop offset="1" stop-color="#101c22"/></radialGradient></defs><rect width="800" height="480" fill="url(#g)"/>${streets}<polyline points="${route}" fill="none" stroke="#d7cf83" stroke-width="4" stroke-linejoin="round"/><circle cx="${x}" cy="${z}" r="7" fill="#fff"/><text x="30" y="39" fill="#fff" font-family="sans-serif" font-size="22">PSYCHIKO FAROS CIRCUIT</text><text x="30" y="67" fill="#d7cf83" font-family="sans-serif" font-size="14">PALAIO PSYCHIKO · ${(data.length/1000).toFixed(3)} KM / LAP</text><text x="30" y="455" fill="#9cabaa" font-family="sans-serif" font-size="11">Map data © OpenStreetMap contributors / ODbL · Real public-road centreline</text></svg>`;
fs.writeFileSync(new URL('../../../assets/maps/psychiko.svg',import.meta.url),svg);
