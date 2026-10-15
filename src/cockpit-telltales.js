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
export function drawCockpitLamps(g, lamps) {
  // Dedicated lower strip, clear of the needles and digital speed on every cluster layout.
  g.fillStyle = '#06090c'; g.beginPath(); g.roundRect(196, 341, 632, 40, 9); g.fill();
  for (let i = 0; i < lamps.length; i++) {
    const [name, colour] = lamps[i], img = lampImage(name, colour || '#20292e');
    if (img.complete && img.naturalWidth) g.drawImage(img, 204 + i * 47, 344, 34, 34);
  }
}
