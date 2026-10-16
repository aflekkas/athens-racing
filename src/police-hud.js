// Police owns pursuit state; all visual notices share the notification manager.
import { pursuit } from './police.js';
import { notifications } from './ui/notifications.js';
export class PoliceHud {
  shout(kind,text,sub='') {notifications.banner('police-callout',text,sub,{priority:kind==='busted'?98:85,tone:kind==='busted'?'bad':'good',ms:3200});}
  update(dt) {
    const p=pursuit,show=p.enabled&&(p.state==='pursuit'||p.state==='cooldown'||p.heat>.01);
    if(!show){notifications.dismiss('police-status');return;}
    // A persistent state, so a small HUD badge beside the timer, never a card in the driver's view (owner, 2026-10-16).
    const title=p.state==='pursuit'?'PURSUIT':p.state==='cooldown'?'COOLDOWN':p.state==='warning'?'PULL OVER':'POLICE';
    const detail=p.state==='warning'?'SLOW DOWN':p.level>0?'★'.repeat(p.level)+'☆'.repeat(5-p.level):Math.round(p.heat*100)+'%';
    notifications.post({id:'police-status',slot:'badge',title,text:detail,priority:70,tone:p.state==='pursuit'||p.state==='warning'?'bad':'info',persistent:true});
  }
}
