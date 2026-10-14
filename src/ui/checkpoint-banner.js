import { notifications } from './notifications.js';
import { events } from '../events.js';

export function showCheckpointStatus(status) {
  if(status?.missed)notifications.banner('checkpoint','MISSED CHECKPOINT','TURN BACK · FOLLOW THE ROUTE',{priority:100,tone:'bad',persistent:true});
  else notifications.dismiss('checkpoint');
}
if(typeof window!=='undefined'){
  window.addEventListener('race-checkpoint',e=>showCheckpointStatus(e.detail));
  events.on('checkpoint',showCheckpointStatus);
  for(const name of ['start','abort','finish'])events.on(name,()=>showCheckpointStatus(null));
}
