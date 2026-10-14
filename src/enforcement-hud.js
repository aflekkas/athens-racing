import { notifications } from './ui/notifications.js';
// ENFORCEMENT HUD — compact in-game phone-style fine notifications + history,
// and a minimap camera-icon helper. Own DOM and styles; never touches
// src/hud.js or src/police-hud.js. Reads FineLedger entries from
// src/enforcement.js. NOT real SMS/email/payment: a game menu styled like a
// phone notification. Default: a brief toast per fine; the history list stays
// hidden behind its toggle so the HUD stays uncluttered (aids owner).
//
// Minimap hook (for the hud.js owner — 3 lines, NOT applied by this module):
//   import { drawCameraIcons } from './enforcement-hud.js';
//   ... inside drawMini, after the junctions block, same transform:
//   drawCameraIcons(g, route, st.cameras || [], 6.5 / sc);

/** Draw fixed-camera icons on the minimap canvas (call inside drawMini's transform). */
export function drawCameraIcons(g, route, cameras, r = 6) {
  for (const c of cameras || []) {
    let p;
    try { p = route.point(c.s, c.u || 0); } catch { continue; }
    g.save();
    g.translate(p.x, p.z);
    g.rotate(Math.PI / 4);
    g.fillStyle = '#ffb000'; g.strokeStyle = '#000'; g.lineWidth = Math.max(1, r * 0.3);
    const w = r * 0.9;
    g.beginPath(); g.rect(-w / 2, -w / 2, w, w); g.fill(); g.stroke();
    g.restore();
    g.fillStyle = '#000';
    g.beginPath(); g.arc(p.x, p.z, r * 0.22, 0, Math.PI * 2); g.fill();
  }
}

export class FinePhone {
  constructor(){this.entries=[];this.count=0;this.enabled=false;}
  setEnabled(enabled){this.enabled=enabled===true;if(!this.enabled)for(const id of notifications.queue.items.keys())if(id.startsWith('fine:'))notifications.dismiss(id);}
  reset(){this.entries=[];this.count=0;for(const id of notifications.queue.items.keys())if(id.startsWith('fine:'))notifications.dismiss(id);}
  notify(entry){return this.show(entry);}
  show(entry){
    if(!entry)return;this.count++;
    const title=entry.kind==='red'?'RED LIGHT':entry.kind==='capture'?'POLICE STOP':'SPEED CAMERA',seconds=Number(entry.penaltySec)||0;
    const item={...entry,title,penaltySec:seconds};this.entries.push(item);if(this.entries.length>100)this.entries.shift();
    if(this.enabled)notifications.post({id:'fine:'+(entry.id||this.count),title,text:(entry.label?entry.label+' · ':'')+'+'+seconds.toFixed(1)+' S',tone:entry.kind==='red'?'bad':'info',priority:80,ms:3200,staleAfter:10000});
  }
  history(){return this.entries.map(entry=>({...entry}));}
}
