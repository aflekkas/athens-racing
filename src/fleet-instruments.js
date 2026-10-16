import {drawCockpitLamps} from './cockpit-telltales.js';
function dial(c,x,y,r,value,max,label){
 c.fillStyle='#101519';c.beginPath();c.arc(x,y,r,0,Math.PI*2);c.fill();c.strokeStyle='#9da6ad';c.lineWidth=4;c.stroke();
 c.fillStyle='#e1e6e7';c.font='23px Arial';c.textAlign='center';
 for(let i=0;i<=8;i++){const a=Math.PI*.75+i*Math.PI*1.5/8;c.fillText(Math.round(i*max/8),x+Math.cos(a)*r*.80,y+Math.sin(a)*r*.80+7);}
 const a=Math.PI*.75+Math.min(1,Math.max(0,value/max))*Math.PI*1.5;c.strokeStyle='#ef7055';c.lineWidth=5;c.beginPath();c.moveTo(x,y);c.lineTo(x+Math.cos(a)*r*.68,y+Math.sin(a)*r*.68);c.stroke();c.fillStyle='#c3ccd0';c.font='19px Arial';c.fillText(label,x,y+r*.42);
}
export function drawFleetInstruments(canvas,state,lamps,spec){
 const c=canvas.getContext('2d'),speed=Math.max(0,Math.round(state.kmh||0)),kind=spec.nativeFleet;c.clearRect(0,0,1024,384);c.fillStyle='#0e151b';c.fillRect(0,0,1024,384);c.textAlign='center';
 if(spec.electric){
  c.strokeStyle=kind==='byd_dolphin'?'#65cbbd':'#74aad9';c.lineWidth=6;c.beginPath();c.roundRect(25,20,974,344,30);c.stroke();c.fillStyle='#f0f7f4';c.font='104px Arial';c.fillText(speed,512,216);c.font='28px Arial';c.fillText('km/h',512,261);c.font='37px Arial';c.fillText(state.gearLabel||'D',820,180);c.font='23px Arial';c.fillText('POWER',170,165);c.fillText('68%   284 km',170,208);
 }else if(spec.twoWheeler){
  dial(c,280,185,165,(state.rpm||0)/1000,12,'×1000');c.fillStyle='#dae5de';c.fillRect(520,70,410,240);c.fillStyle='#182824';c.font='112px monospace';c.fillText(speed,700,223);c.font='27px monospace';c.fillText('km/h  '+(state.gearLabel||'N'),720,277);
 }else if(kind==='bus'){
  dial(c,245,192,164,speed,120,'km/h');dial(c,778,192,164,(state.rpm||0)/1000,3,'×1000');c.fillStyle='#b1c9a1';c.font='33px monospace';c.fillText('D '+(state.gearLabel||''),512,181);c.font='22px monospace';c.fillText('AIR  8.0 bar',512,230);
 }else{
  dial(c,228,192,164,(state.rpm||0)/1000,kind==='truck'||kind==='van'?5:8,'×1000');dial(c,799,192,164,speed,kind==='truck'?140:220,'km/h');c.fillStyle=kind==='city'?'#e1d7bb':'#dee9ec';c.font='54px Arial';c.fillText(speed,512,193);c.font='23px Arial';c.fillText('km/h  '+(state.gearLabel||'N'),512,235);c.font='20px Arial';c.fillText(spec.short||'',512,335,190);
 }
 drawCockpitLamps(c,lamps||[],spec.body);
}
