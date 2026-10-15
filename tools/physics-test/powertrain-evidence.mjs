// Reproduce with: node --import ./tools/physics-test/register.mjs tools/physics-test/powertrain-evidence.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Vehicle } from '../../src/physics.js';
import { catalogue, flatRoute } from './powertrain.mjs';
const cars = catalogue(), output = resolve(process.env.POWERTRAIN_OUT || '.scratch/powertrain');
mkdirSync(output, { recursive: true });
const cases = ['cle200','carrera','carrera_pdk_comparison','golf_gti','taxi','e36_m3','cle300e'];
const summary = [], traces = [];
const pedal = { throttle:1,brake:0,steer:0 };
for (const id of cases) {
  const comparison = id === 'carrera_pdk_comparison';
  const spec = comparison ? { ...cars.find(c=>c.id==='carrera'),
    mass:1400, shiftT:.10, gearbox:'DCT', powertrain: { ...cars.find(c=>c.id==='carrera').powertrain, gearboxType:'dct',shiftTime:.10,revMatch:true },
    gears:[3.91,2.29,1.65,1.30,1.08,.88,.62], zeroTo100:4.6,vmax:287 } : cars.find(c=>c.id===id);
  const v = new Vehicle(spec,flatRoute), samples = [], shifts = [];
  let t100 = null, eventSerial = 0, peakRpm = 0;
  for (let frame = 0; frame < 120*60; frame++) {
    v.update(1/60,pedal); const time=(frame+1)/60;
    if (t100 === null && v.kmh >= 100) t100=time;
    peakRpm=Math.max(peakRpm,v.rpm);
    if (time <= 25) samples.push([time,v.rpm,v.gear,v.pendingGear,v.kmh,v.engineThrottle,v.load,v.boost,+v.limiter,+v.converterLocked]);
    for (const event of v.powertrainEvents) if (event.serial > eventSerial) { shifts.push({...event});eventSerial=event.serial; }
  }
  const result={id,comparison,gearboxType:v.powertrain.gearboxType,t100,reference100:spec.zeroTo100,
    topKmh:v.kmh,referenceTop:spec.vmax,peakRpm,shiftTime:v.powertrain.shiftTime,events:shifts};
  summary.push(result); traces.push({id,samples,pt:v.powertrain});
  writeFileSync(`${output}/${id}.csv`,'time_s,rpm,gear,pending_gear,speed_kmh,throttle,load,boost,limiter,converter_locked\n'+samples.map(row=>row.map(n=>Number(n.toFixed(5))).join(',')).join('\n')+'\n');
  console.log(`${id}: 0–100 ${t100.toFixed(2)} / ${spec.zeroTo100}s; top ${v.kmh.toFixed(1)} / ${spec.vmax}km/h; ${v.powertrain.gearboxType} ${(v.powertrain.shiftTime*1000).toFixed(0)}ms`);
}
writeFileSync(`${output}/summary.json`,JSON.stringify(summary,null,2)+'\n');
// A self-contained SVG chart for offline inspection; CSV remains the numerical evidence.
const width=1200,panel=230,height=60+traces.length*panel,colors=['#41d4fa','#ffcd58','#c28bff','#70dd9c','#fb9b67','#ff7db5','#b0d2ff'];
let svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#121923"/><g font-family="sans-serif" fill="#e8edf3"><text x="75" y="30" font-size="22">Full-throttle RPM through gears · stock tyres, dry flat road · 240 Hz physics</text>`;
traces.forEach(({id,samples,pt},i)=>{
 const left=75,top=70+i*panel,w=1060,h=160,x=t=>left+t/25*w,y=r=>top+h-r/9000*h;
 svg+=`<text x="75" y="${top-10}" font-size="16">${id} · ${pt.gearboxType} · ${Math.round(pt.shiftTime*1000)} ms</text>`;
 for(let r=0;r<=9000;r+=3000)svg+=`<path d="M${left} ${y(r)}h${w}" stroke="#344151"/><text x="20" y="${y(r)+5}" font-size="12">${r}</text>`;
 for(let t=0;t<=25;t+=5)svg+=`<text x="${x(t)}" y="${top+h+20}" font-size="12">${t}s</text>`;
 svg+=`<path d="M${left} ${y(pt.redlineRpm)}h${w}" stroke="#dd5962" stroke-dasharray="5 5"/><polyline fill="none" stroke="${colors[i]}" stroke-width="2" points="${samples.map(s=>`${x(s[0]).toFixed(1)},${y(s[1]).toFixed(1)}`).join(' ')}"/>`;
 let last=0;for(const s of samples)if(s[2]!==last){svg+=`<text x="${x(s[0])+4}" y="${Math.max(top+15,y(s[1])-8)}" font-size="12">G${s[2]}</text>`;last=s[2];}
});
svg+='</g></svg>';writeFileSync(`${output}/rpm-through-gears.svg`,svg);
