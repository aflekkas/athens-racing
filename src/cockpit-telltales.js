// Cockpit lamps share the HUD's ISO-style artwork; rasterise each symbol once.
import { telltale } from './ui/telltales.js';
import { ENGINE_HOT_C } from './driving-feedback-model.js';
const RED = '#ff453a', AMBER = '#ffb21a', GREEN = '#46e878', BLUE = '#429cff';
const stroke = 'fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"';
const symbols = {
  handbrake: `<circle ${stroke} cx="12" cy="12" r="6.5"/><path ${stroke} d="M4 6a10 10 0 0 0 0 12M20 6a10 10 0 0 1 0 12M10 16V8h3a2.5 2.5 0 0 1 0 5h-3"/>`,
  temperature: `<path ${stroke} d="M10 15V5a2 2 0 0 1 4 0v10a4 4 0 1 1-4 0M14 6h3M14 10h3M2 22q2-2 4 0t4 0t4 0t4 0t4 0"/>`,
  tyre: `<path ${stroke} d="M6 4C1 10 2 16 5 20h14c3-4 4-10-1-16M5 20v-2M9 20v-2M15 20v-2M19 20v-2M12 7v7M12 17v.1"/>`,
  seatbelt: `<circle fill="currentColor" cx="12" cy="4" r="2.5"/><path ${stroke} d="M8 20v-7l1-5h6l1 5v7M5 9l14 8M18 7L7 17M8 14h8"/>`,
  low: `<path ${stroke} d="M13 5v14c10 0 10-14 0-14zM3 10l6-3M3 15l6-3M3 20l6-3"/>`,
  high: `<path ${stroke} d="M13 5v14c10 0 10-14 0-14zM2 6h7M2 10h7M2 14h7M2 18h7"/>`,
  left: '<path fill="currentColor" d="M2 12l9-8v5h11v6H11v5z"/>',
  right: '<path fill="currentColor" d="M22 12l-9-8v5H2v6h11v5z"/>',
};
export class CockpitLamps {
  constructor() { this.elapsed = 10; this.tcHold = this.absHold = 0; }
  update(dt, st) {
    if (st.ignition && !this.ignition) this.elapsed = this.tcHold = this.absHold = 0;
    this.ignition = !!st.ignition;
    this.elapsed += Math.max(0, dt);
    const v = st.vehicle || {}, check = this.elapsed < 1, flash = this.elapsed % .5 < .25;
    this.tcHold = v.tcOn || v.escOn ? .35 : Math.max(0, this.tcHold - dt);
    this.absHold = v.absOn ? .25 : Math.max(0, this.absHold - dt);
    const health = v.engHealth ?? 1, stopped = v.engineStalled || v.drivetrainBroken;
    const severe = health < .4 || stopped, engine = health < .9 || v.engineFailureReason || v.coolantTemp >= ENGINE_HOT_C;
    // Oil pressure isn't simulated: a stopped/severely damaged engine is the low-pressure proxy.
    return [
      ['engine', check || engine || severe ? severe ? RED : AMBER : null],
      ['esc', check || this.tcHold > 0 && flash ? AMBER : null],
      ['esc-off', check || st.aidsOff ? AMBER : null],
      ['abs', check || this.absHold > 0 ? AMBER : null],
      ['handbrake', check || st.handbrake ? RED : null],
      ['oil', check || severe ? RED : null],
      ['temperature', check || v.coolantTemp >= ENGINE_HOT_C ? RED : null],
      ['tyre', check || v.cornerDamage?.some(d => d >= .15) ? AMBER : null],
      ['seatbelt', check || this.elapsed < 4 ? RED : null],
      ['low', check || st.lowBeam && !st.highBeam ? GREEN : null],
      ['high', check || st.highBeam ? BLUE : null],
      ['left', check || (st.hazards || st.indicator === 'left') && flash ? GREEN : null],
      ['right', check || (st.hazards || st.indicator === 'right') && flash ? GREEN : null],
    ];
  }
}
const images = new Map();
export let lampArtVersion = 0;
function lampImage(name, colour) {
  const key = name + colour;
  if (!images.has(key)) {
    const svg = symbols[name] ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${symbols[name]}</svg>` : telltale(name).replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ');
    const img = new Image(); img.onload = () => { lampArtVersion++; };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg.replaceAll('currentColor', colour));
    images.set(key, img);
  }
  return images.get(key);
}
// Layout coordinates are centres in the 1024 × 384 instrument artwork.
// Place symbols in the quiet inner shoulders of the faces, below the rim's
// projected upper edge, rather than in a strip across ticks and numerals.
export function cockpitLampLayout(style) {
  if(style==='pov')return Array.from({length:13},(_,i)=>[52+i*76,155]);
  const arc=(x,y,r,angles)=>angles.map(a=>[x+Math.cos(a*Math.PI/180)*r,y+Math.sin(a*Math.PI/180)*r]);
  if(style==='gtv')return [...arc(273,195,80,[190,220,250,290,320]),...arc(749,195,80,[190,220,250,290,320]),[749,220],[237,222],[310,222]];
  if(['taxi','superb','police_octavia','octavia','panda','jazz','ibiza','golf','e36','corolla','cla','cle','gla','gla45'].includes(style))return [...arc(228,192,86,[190,218,246,274,302]),...arc(799,192,86,[190,218,246,274,302]),[840,224],[460,110],[564,110]];
  if(style==='carrera')return [...arc(298,203,64,[195,230,270,310]),...arc(741,203,64,[195,230,270,310]),[104,190],[927,185],[927,215],[475,192],[569,192]];
  if(style==='mini'||style==='mini_jcw')return [...arc(244,194,76,[190,225,260,295,330]),...arc(788,194,72,[190,225,260,295,330]),[788,228],[470,112],[588,112]];
  if((style==='huracan'||style==='aventador'))return [...arc(165,330,65,[180,215,250,285,320]),...arc(840,190,65,[0,36,72,108,144,180]),[465,188],[555,188]];
  if(style==='gr_yaris')return [...arc(165,300,65,[180,215,250,285,320]),...arc(840,238,65,[0,36,72,108,144,180]),[465,188],[555,188]];
  if(style==='yaris')return [...arc(260,210,80,[160,190,220,250,280]),...arc(760,210,80,[160,190,220,250,280]),[803,239],[452,105],[570,105]];
  return [...arc(242,205,84,[180,210,240,270,300]),...arc(785,205,84,[180,210,240,270,300]),[785,290],[466,189],[558,189]];
}
export function drawCockpitLamps(g, lamps, style) {
  const positions=cockpitLampLayout(style),size=style==='pov'?44:25;
  for (let i=0;i<lamps.length;i++) {
    const [name,colour]=lamps[i];
    if(!colour)continue; // An extinguished bulb is invisible, not a blue icon.
    const img=lampImage(name,colour),[x,y]=positions[i];
    if(img.complete&&img.naturalWidth)g.drawImage(img,x-size/2,y-size/2,size,size);
  }
}
