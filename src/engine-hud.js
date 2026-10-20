import { notifications } from './ui/notifications.js';
// UI-only engine condition and per-shift feedback. Physics owns every threshold and outcome.
import { input } from './input.js';
import { icon, esc, kbd } from './ui/components.js';
import { damageFeedback } from './driving-feedback-model.js';
let root, lastVehicle, lastSerial;
const reasons={bounds:'NO GEAR IN THAT DIRECTION',cooldown:'SHIFT IN PROGRESS · WAIT',mode:'SHIFT UNAVAILABLE IN THIS GEARBOX MODE',reverse:'SHIFT UNAVAILABLE IN REVERSE',overrev_protection:'AUTO PROTECTION · LOWER GEAR WOULD OVER-REV'};
export function updateEngineHud(vehicle,{visible=true,spectating=false,towLabel='TOW',repairAvailable=false,towCost='5 seconds',gamepad=false,confirmLabel='A',onRepair}={}) {
  if(!root){const parent=document.getElementById('dialBox');if(!parent)return;root=document.createElement('aside');root.id='engineHud';root.setAttribute('role','status');}
  const temp=Number(vehicle?.coolantTemp),feedback=damageFeedback(vehicle,{spectating,towLabel,repairAvailable,towCost}),health=feedback.health??1;
  const quiet=feedback.visible&&feedback.quiet;
  root.hidden=!visible||!feedback.visible||quiet;
  root.repairHandler=visible&&!spectating&&repairAvailable&&!quiet?onRepair:null;
  const detail=feedback.visible?`${feedback.cause}${['LIMP MODE','CAR IMPAIRED'].includes(feedback.title)?' · '+feedback.effect:''}${feedback.title==='ENGINE HOT'&&Number.isFinite(temp)?' · '+Math.round(temp)+'°C':''}`:'';
  const clickable=typeof root.repairHandler==='function',text=feedback.title+'|'+detail+'|'+feedback.repairAction+'|'+clickable+'|'+towLabel+'|'+gamepad+'|'+confirmLabel+'|'+towCost;
  if(root.dataset.value!==text){root.dataset.value=text;root.innerHTML=feedback.visible?icon('triangle-alert')+`<span><b>${esc(feedback.title)}</b><small>${esc(detail)}</small>${clickable?'<button type="button"':'<span'} class="engine-repair">${clickable?kbd(esc(towLabel.split(' / ')[0]),gamepad)+(gamepad?icon('chevron-right')+kbd(esc(confirmLabel.split(' / ')[0]),true):'')+' <span>'+esc(feedback.repairAction)+'</span>'+(Number(towCost)>0?' <small>+'+esc(towCost)+' s</small>':''):esc(feedback.repairAction)}${clickable?'</button>':'</span>'}</span><i style="--health:${health}"></i>`:'';root.dataset.tone=feedback.tone||'warn';const button=root.querySelector('button');if(button)button.onclick=()=>root.repairHandler?.();}
  if(visible&&feedback.visible&&!quiet)notifications.adopt('engine-condition',root,{slot:vehicle?.engineStalled?'banner':'toast',priority:vehicle?.engineStalled?95:75,persistent:true,title:feedback.title,text:detail,tone:feedback.tone==='bad'?'bad':'info'});
  else notifications.dismiss('engine-condition');
  if(vehicle!==lastVehicle){lastVehicle=vehicle;lastSerial=undefined;}
  const f=vehicle?.shiftFeedback;if(!f||f.serial===lastSerial)return;lastSerial=f.serial;
  if(!visible)return;
  if(f.accepted&&f.unsafe)input.toast(`MECHANICAL OVER-REV${Number.isFinite(f.predictedRpm)?' · '+Math.round(f.predictedRpm).toLocaleString()+' RPM':''}`,{icon:'triangle-alert',tone:'bad',ms:3500});
  else if(!f.accepted)input.toast(reasons[f.reason]||`SHIFT REJECTED · ${String(f.reason||'UNAVAILABLE').replace(/[_-]/g,' ').toUpperCase()}`,{icon:'triangle-alert',tone:'bad',ms:2000});
}
