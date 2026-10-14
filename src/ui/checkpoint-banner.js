import { events } from '../events.js';

export function showCheckpointStatus(status) {
  const hud=document.getElementById('hud');if(!hud)return;
  let banner=document.getElementById('checkpoint-banner');
  if(!banner){banner=document.createElement('aside');banner.id='checkpoint-banner';banner.setAttribute('role','status');banner.hidden=true;banner.innerHTML='<b>MISSED CHECKPOINT</b><span>TURN BACK · FOLLOW THE ROUTE</span>';hud.append(banner);}
  banner.hidden=!status?.missed;
}
if(typeof window!=='undefined'){
  window.addEventListener('race-checkpoint',e=>showCheckpointStatus(e.detail));
  events.on('checkpoint',showCheckpointStatus);
  for(const name of ['start','abort','finish'])events.on(name,()=>showCheckpointStatus(null));
}
