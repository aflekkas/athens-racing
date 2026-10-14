// UI-only engine condition and per-shift feedback. Physics owns every threshold and outcome.
import { ui, icon, esc } from './ui/components.js';
import { damageFeedback } from './driving-feedback-model.js';
let root, lastVehicle, lastSerial;
const reasons={bounds:'NO GEAR IN THAT DIRECTION',cooldown:'SHIFT IN PROGRESS · WAIT',mode:'SHIFT UNAVAILABLE IN THIS GEARBOX MODE',reverse:'SHIFT UNAVAILABLE IN REVERSE',overrev_protection:'SHIFT REJECTED · WOULD EXCEED REDLINE'};
export function updateEngineHud(vehicle,{visible=true,spectating=false,towLabel='TOW',repairAvailable=false,towCost='5 seconds',onRepair}={}) {
  if(!root){const parent=document.getElementById('dialBox');if(!parent)return;root=document.createElement('aside');root.id='engineHud';root.setAttribute('role','status');parent.append(root);}
  const temp=Number(vehicle?.coolantTemp),feedback=damageFeedback(vehicle,{spectating,towLabel,repairAvailable,towCost}),health=feedback.health??1;
  root.hidden=!visible||!feedback.visible;
  root.repairHandler=visible&&!spectating&&repairAvailable?onRepair:null;
  const detail=feedback.visible?`${feedback.cause} · ${feedback.effect}${Number.isFinite(temp)?' · '+Math.round(temp)+'°C':''}`:'';
  const clickable=typeof root.repairHandler==='function',text=feedback.title+'|'+detail+'|'+feedback.repairAction+'|'+clickable;
  if(root.dataset.value!==text){root.dataset.value=text;root.innerHTML=feedback.visible?icon('warning')+`<span><b>${esc(feedback.title)}</b><small>${esc(detail)}</small>${clickable?'<button type="button"':'<span'} class="engine-repair">${esc(feedback.repairAction)}${clickable?'</button>':'</span>'}</span><i style="--health:${health}"></i>`:'';root.dataset.tone=feedback.tone||'warn';const button=root.querySelector('button');if(button)button.onclick=()=>root.repairHandler?.();}
  if(vehicle!==lastVehicle){lastVehicle=vehicle;lastSerial=undefined;}
  const f=vehicle?.shiftFeedback;if(!f||f.serial===lastSerial)return;lastSerial=f.serial;
  if(!visible)return;
  if(f.accepted&&f.unsafe)ui.toast(`MECHANICAL OVER-REV${Number.isFinite(f.predictedRpm)?' · '+Math.round(f.predictedRpm).toLocaleString()+' RPM':''}`,{icon:'warning',tone:'bad',ms:3500});
  else if(!f.accepted)ui.toast(reasons[f.reason]||`SHIFT REJECTED · ${String(f.reason||'UNAVAILABLE').replace(/[_-]/g,' ').toUpperCase()}`,{icon:'warning',tone:'bad',ms:2000});
}
