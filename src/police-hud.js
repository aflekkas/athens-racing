// Police owns pursuit state; all visual notices share the notification manager.
import { pursuit } from './police.js';
import { notifications } from './ui/notifications.js';
export class PoliceHud {
  shout(kind,text,sub='') {notifications.banner('police-callout',text,sub,{priority:kind==='busted'?98:85,tone:kind==='busted'?'bad':'good',ms:3200});}
  update(dt) {
    const p=pursuit,show=p.enabled&&(p.state==='pursuit'||p.state==='cooldown'||p.heat>.01);
    if(!show){notifications.dismiss('police-status');return;}
    const title=p.state==='pursuit'?'POLICE PURSUIT':p.state==='cooldown'?'POLICE COOLDOWN':p.state==='warning'?'POLICE · PULL OVER':'POLICE OBSERVING';
    const detail=p.state==='warning'?'Slow down and stop safely':p.level>0?'★'.repeat(p.level)+'☆'.repeat(5-p.level):'Suspicion '+Math.round(p.heat*100)+'%';
    notifications.banner('police-status',title,detail,{priority:70,tone:p.state==='pursuit'?'bad':'info',persistent:true});
  }
}
