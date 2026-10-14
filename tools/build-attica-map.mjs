// Stylised regional overview: real route positions and detailed Riviera coastline from local OSM map data.
// Regional land outline and relief are deliberately schematic. Coordinates stay in longitude/latitude.
import { readFileSync, writeFileSync } from 'node:fs';
const root = new URL('../', import.meta.url);
const project = (lat, lon) => [(lon - 23.15) * 1100, (38.23 - lat) * 1400];
const point = ([lat, lon]) => project(lat, lon).map(x => x.toFixed(1)).join(',');
const path = points => points.map((p, i) => (i ? 'L' : 'M') + point(p)).join(' ');
const outline = [[38.23,23.15],[38.23,24.08],[38.07,24.04],[37.99,24.03],[37.88,24.07],[37.75,24.03],[37.65,24.02],[37.65,23.96],[37.72,23.91],[37.76,23.85],[37.80,23.81],[37.81,23.77],[37.87,23.75],[37.92,23.70],[37.94,23.64],[37.98,23.61],[38.02,23.54],[38.04,23.44],[38.01,23.35],[37.96,23.27],[37.97,23.15]];
let detail = '', routes = '';
const pins = {};
for (const [id, file, color] of [['riviera','data/map.json','#ff594b'],['megara','data/maps/megara/map.json','#ffc35e'],['penteli','data/maps/penteli/map.json','#73dbc2']]) {
 const d = JSON.parse(readFileSync(new URL(file, root))), p = d.proj;
 const convert = (x,z) => [p.lat0-z/p.mlat, p.lon0+x/p.mlon];
 for(const coast of d.coast || []) { const pts=[]; for(let i=0;i<coast.length;i+=8) pts.push(convert(coast[i],coast[i+1])); if(pts.length>1)detail += `<path d="${path(pts)}"/>`; }
 const pts=[];for(let i=0;i<d.route.x.length;i+=Math.max(1,Math.floor(d.route.x.length/180))) pts.push(convert(d.route.x[i],d.route.z[i]));
 routes += `<path d="${path(pts)}" fill="none" stroke="${color}" stroke-width="4" stroke-linecap="round"/>`;
 const middle=Math.floor(d.route.x.length/2);pins[id]=project(...convert(d.route.x[middle],d.route.z[middle]));
}
const label=(lat,lon,text,cls='place')=>{const [x,y]=project(lat,lon);return `<text class="${cls}" x="${x}" y="${y}">${text}</text>`;};
const island = [[38.00,23.49],[37.98,23.55],[37.93,23.57],[37.91,23.53],[37.94,23.43],[37.97,23.42],[38.00,23.49]];
const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1040 840"><desc>OpenStreetMap-derived race routes and detailed Riviera coastline. Regional outline, Salamina and mountain contours are schematic. Map data © OpenStreetMap contributors, ODbL.</desc><defs><pattern id="grid" width="52" height="52" patternUnits="userSpaceOnUse"><path d="M52 0H0V52" fill="none" stroke="#304754" stroke-width="1"/></pattern></defs><style>text{font:700 18px sans-serif;fill:#a6bac1;letter-spacing:3px}.water{fill:#7292a4;font-size:22px}.relief{fill:#4e695e;font-size:14px}.place{fill:#c6d4d4}</style><rect width="1040" height="840" fill="#102938"/><rect width="1040" height="840" fill="url(#grid)" opacity=".4"/><path d="${path(outline)}Z" fill="#24332f" stroke="#76938d" stroke-width="2"/><path d="${path(island)}Z" fill="#24332f" stroke="#76938d" stroke-width="2"/><g fill="none" stroke="#455a4c" stroke-width="2" opacity=".6">${[0,16,32,48].map(i=>`<path d="M${640+i} ${110+i}q140 -90 170 20q30 95 -70 105q-80 10 -100 -125Z"/><path d="M${595+i} ${305+i}q110 -55 115 100q-20 130 -85 150q-45 -135 -30 -250Z"/>`).join('')}</g><g fill="none" stroke="#a8b5a7" stroke-width="4" opacity=".32"><path d="${path([[38.04,23.27],[38.05,23.48],[38.00,23.73],[37.94,23.74],[37.87,23.76],[37.81,23.80]])}"/><path d="${path([[37.94,23.74],[38.05,23.80],[38.08,23.90],[37.99,24.02]])}"/></g><g fill="none" stroke="#a6c5c2" stroke-width="1.5">${detail}</g>${routes}${label(37.91,23.46,'SARONIC GULF','water')}${label(37.99,23.70,'ATHENS')}${label(38.17,23.76,'PARNITHA','relief')}${label(38.12,23.92,'PENTELI','relief')}${label(37.95,23.87,'HYMETTUS','relief')}${label(38.035,23.33,'MEGARA')}${label(37.85,23.86,'RIVIERA')}${label(37.955,23.48,'SALAMINA','relief')}</svg>`;
writeFileSync(new URL('assets/maps/attica.svg',root),svg);
writeFileSync(new URL('src/attica-map-data.js',root),'// Projected from the route coordinates by tools/build-attica-map.mjs.\nexport const TRACK_PINS = '+JSON.stringify(pins)+';\n');
