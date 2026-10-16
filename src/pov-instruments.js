import {drawCockpitLamps} from './cockpit-telltales.js';
// Keep the existing thin physical face. Large numerals and a single RPM bar
// remain legible at its much smaller projected size than full analogue dials.
export function drawPovInstruments(canvas,st,lamps,spec){
 const g=canvas.getContext('2d');g.save();g.scale(canvas.width/1024,canvas.height/192);
 g.clearRect(0,0,1024,192);g.fillStyle='#0a1014';g.fillRect(0,0,1024,192);
 g.fillStyle='#e8f1f3';g.textBaseline='alphabetic';g.textAlign='left';g.font='bold 86px sans-serif';g.fillText(String(Math.max(0,Math.round(st.kmh||0))),20,94);
 g.font='22px sans-serif';g.fillText('km/h',192,90);g.font='bold 72px sans-serif';g.fillText(st.gearLabel||'N',280,91);
 const rpm=Math.max(0,st.rpm||0),limit=st.redline||spec.redline||8000;
 g.fillStyle='#26343b';g.fillRect(390,39,600,20);g.fillStyle=rpm/limit>.9?'#ff685c':'#b5e885';g.fillRect(390,39,600*Math.min(1,rpm/limit),20);
 g.fillStyle='#dce7ea';g.font='28px sans-serif';g.fillText(Math.round(rpm)+' RPM',390,99);g.textAlign='right';g.fillText(spec.short||spec.name,990,99,340);
 drawCockpitLamps(g,lamps||[],'pov');g.restore();
}
