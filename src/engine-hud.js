// UI-only engine condition and per-shift feedback. Physics owns every threshold and outcome.
import { ui, icon, esc } from './ui/components.js';
let root, lastVehicle, lastSerial;
const clamp=x=>Math.max(0,Math.min(1,Number.isFinite(x)?x:0));
const reasons={bounds:'NO GEAR IN THAT DIRECTION',cooldown:'SHIFT IN PROGRESS · WAIT',mode:'SHIFT UNAVAILABLE IN THIS GEARBOX MODE',reverse:'SHIFT UNAVAILABLE IN REVERSE'};
export function updateEngineHud(vehicle,{visible=true}={}) {
  if(!root){const parent=document.getElementById('dialBox');if(!parent)return;root=document.createElement('aside');root.id='engineHud';root.setAttribute('role','status');parent.append(root);}
  const damage=clamp(vehicle?.engineDamage),temp=Number(vehicle?.coolantTemp),health=Number.isFinite(vehicle?.engHealth)?clamp(vehicle.engHealth):1-damage;
  const failed=!!vehicle?.engineFailureReason,stalled=!!vehicle?.engineStalled;
  root.hidden=!visible||!(damage>.01||health<.99||stalled||failed||temp>=110);
  const status=failed?'ENGINE FAILURE':stalled?'ENGINE STALLED':temp>=110?'ENGINE HOT':'ENGINE CONDITION';
  const detail=failed?esc(String(vehicle.engineFailureReason).replace(/[_-]/g,' ').toUpperCase()):`${Math.round(health*100)}% HEALTH${Number.isFinite(temp)?' · '+Math.round(temp)+'°C':''}`;
  const text=status+'|'+detail;if(root.dataset.value!==text){root.dataset.value=text;root.innerHTML=icon('warning')+`<span><b>${status}</b><small>${detail}</small></span><i style="--health:${health}"></i>`;root.dataset.tone=failed||stalled||health<.3?'bad':'warn';}
  if(vehicle!==lastVehicle){lastVehicle=vehicle;lastSerial=undefined;}
  const f=vehicle?.shiftFeedback;if(!f||f.serial===lastSerial)return;lastSerial=f.serial;
  if(!visible)return;
  if(f.accepted&&f.unsafe)ui.toast(`MECHANICAL OVER-REV${Number.isFinite(f.predictedRpm)?' · '+Math.round(f.predictedRpm).toLocaleString()+' RPM':''}`,{icon:'warning',tone:'bad',ms:3500});
  else if(!f.accepted)ui.toast(reasons[f.reason]||`SHIFT REJECTED · ${String(f.reason||'UNAVAILABLE').replace(/[_-]/g,' ').toUpperCase()}`,{icon:'warning',tone:'bad',ms:2000});
}
