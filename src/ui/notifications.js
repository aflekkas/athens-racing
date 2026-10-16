import { NotificationQueue, notificationPlacement, mirrorNoticeBounds, projectedMirrorBounds, drivingArea } from './notification-queue.js';
import { noticeStyle, telltaleMask } from './notice-style.js';

const now=()=>globalThis.performance?.now?.()??Date.now();
export function notificationText(value) {
  if(typeof document==='undefined')return String(value??'').replace(/<[^>]*>/g,'').replace(/\s+/g,' ').trim();
  const t=document.createElement('template');t.innerHTML=String(value??'');return t.content.textContent.replace(/\s+/g,' ').trim();
}
export function raceNotificationsActive(doc=globalThis.document) {
  const body=doc?.body;if(!body)return false;
  const hud=doc.getElementById('hud'),lobby=doc.getElementById('multiplayer');
  return (body.classList.contains('racing')||body.classList.contains('counting'))&&!body.classList.contains('ui-open')&&!body.classList.contains('menu')&&(!lobby||lobby.hidden)&&!doc.querySelector('#loading.open,.modal-scrim')&&(!hud||!hud.hidden&&hud.style.display!=='none');
}
const OBSTACLES=['#accounts-offline','.wheel-hud','#posBox','#mapBox','#dialBox','#limitSign','#evBox.on .objective-card','#evBox.on:not(:has(.objective-card))','#mp-board','#race-settings','#mp-toggle','#sigBox','#touch-controls button','#touch-controls .touch-steer','#routeBox','#lapTiming','#gearboxHud'];
export class NotificationManager {
  constructor(){this.queue=new NotificationQueue();this.cards=new Map();this.nextAt=0;this.dirty=true;}
  post(value){
    let title=notificationText(value.title),text=notificationText(value.text);
    if(!title){const parts=text.split(' · ');title=parts.shift()||'';text=parts.join(' · ');}
    const key=value.id||`${value.slot||'toast'}:${title}:${text}`,before=this.queue.items.get(key);
    const id=this.queue.post({...value,id:key,title,text},now());
    if(before&&this.queue.items.get(id)===before)return id;
    this.dirty=true;this.mount();this.update();return id;
  }

  toast(text,options={}){return this.post({text,...options});}
  banner(id,title,text='',options={}){return this.post({id,title,text,slot:'banner',priority:80,...options});}
  adopt(id,node,options={}){return this.post({id,node,...options});}
  dismiss(id){if(!this.queue.items.has(id)&&!this.queue.aliases.has(id))return;this.queue.dismiss(id,now());this.dirty=true;this.update();}
  clear(){this.queue.clear();this.dirty=true;this.update();}
  mount(){
    if(this.root||typeof document==='undefined'||!document.body)return;
    const css=document.createElement('link');css.rel='stylesheet';css.href=new URL('./notifications.css',import.meta.url).href;document.head.append(css);
    this.root=document.createElement('section');this.root.id='notification-lane';this.root.hidden=true;this.root.setAttribute('aria-label','Race notifications');this.root.setAttribute('aria-live','polite');document.body.append(this.root);
    window.addEventListener('resize',()=>{this.dirty=true;this.update();});
    // Only visibility containers are observed; changing race clocks does not schedule layouts.
    const watch=el=>{if(!el||el.__notificationWatch)return;el.__notificationWatch=true;new MutationObserver(()=>{this.dirty=true;this.update();}).observe(el,{attributes:true,attributeFilter:['class','hidden']});};
    watch(document.body);const containers=()=>{watch(document.getElementById('multiplayer'));watch(document.getElementById('loading'));};containers();new MutationObserver(()=>{containers();this.dirty=true;this.update();}).observe(document.body,{childList:true});
    this.timer=setInterval(()=>this.update(),100);
  }
  card(item){
    let card=this.cards.get(item.id);
    if(!card){card=document.createElement('article');card.className='race-notice';card.dataset.notificationId=item.id;card.setAttribute('role',item.slot==='banner'?'alert':'status');this.cards.set(item.id,card);}
    const signature=item.signature+'|'+(item.node?'node':'text'),look=noticeStyle(item);
    if(card.dataset.signature!==signature||(item.node&&card.firstElementChild!==item.node)){card.dataset.signature=signature;card.replaceChildren();if(item.node)card.append(item.node);else{if(look.kind==='card'&&look.label){const label=document.createElement('small');label.className='notice-label';label.textContent=look.label;card.append(label);}if(item.title){const title=document.createElement('b');title.textContent=item.title;card.append(title);}if(item.text){const text=document.createElement('span');text.textContent=item.text;card.append(text);}if(item.actions?.length){const row=document.createElement('div');row.className='notice-actions';for(const[index,action]of item.actions.entries()){const button=document.createElement('button');button.type='button';button.textContent=action.label;button.onclick=()=>{const current=this.queue.items.get(item.id)?.actions?.[index];this.dismiss(item.id);current?.run?.();};row.append(button);}card.append(row);}}}
    // Semantic severity and inline icon use one shared compact surface.
    // A persistent state (police pursuit level) is a small HUD badge: the kit chip, not a card.
    const cls=item.slot==='badge'?`chip chip--hud ${item.tone==='bad'?'chip--bad':item.tone==='good'?'chip--good':item.tone==='warn'?'chip--warn':''}`:'race-notice';if(card.className!==cls)card.className=cls;
    card.dataset.slot=item.slot;card.dataset.tone=item.tone||'info';card.dataset.kind=look.kind;card.dataset.lamp=look.tone;card.dataset.telltale=look.telltale;
    if(look.label)card.dataset.label=look.label;else delete card.dataset.label;card.style?.setProperty('--telltale',telltaleMask(look.telltale));return card;
  }
  update(){
    if(!this.root)return;
    const time=now(),active=raceNotificationsActive(),changed=active!==this.active;this.active=active;
    if(!this.dirty&&!changed&&time<this.nextAt)return;this.nextAt=time+100;this.dirty=false;
    const items=this.queue.candidates(time,active);
    if(!active||!items.length){this.root.hidden=true;this.queue.commitVisible([]);return;}
    for(const[id,card]of this.cards)if(!this.queue.items.has(id)){card.remove();this.cards.delete(id);}
    this.root.hidden=false;this.root.style.visibility='hidden';
    const cards=items.map(n=>this.card(n));if(cards.length!==this.root.children.length||cards.some((card,i)=>this.root.children[i]!==card))this.root.replaceChildren(...cards);for(const card of cards)if(card.hidden)card.hidden=false;
    // The lane is the corner column when the screen has room for it, else the slim top-edge strip (notification-queue.js).
    const margin=innerWidth<700?10:28,column=Math.min(300,drivingArea(innerWidth,innerHeight).left-margin-8),width=column>=200?column:Math.min(360,innerWidth-2*margin);this.root.style.width=width+'px';
    const visible=el=>el.getClientRects().length&&getComputedStyle(el).display!=='none'&&getComputedStyle(el).visibility!=='hidden';
    const mirrorView=this.mirrorView?.();
    // The real projected mirror glass whenever the camera is known (none in chase: owner-locked, no chase mirror); the
    // fleet-wide cockpit reservation only when it is not.
    const cockpit=document.body.dataset.cameraView==='cockpit';
    this.mirrorBounds=mirrorView?.camera?projectedMirrorBounds(mirrorView.mirrors,mirrorView.camera,innerWidth,innerHeight):cockpit?[mirrorNoticeBounds(innerWidth,innerHeight,'cockpit')]:[];
    const obstacles=[...this.mirrorBounds,...[...document.querySelectorAll(OBSTACLES.join(','))].filter(visible).map(el=>el.getBoundingClientRect())];
    const layout=notificationPlacement({width:innerWidth,height:innerHeight,margin,laneWidth:width,obstacles,heights:cards.map(c=>c.getBoundingClientRect().height),badges:items.flatMap((n,i)=>n.slot==='badge'?[i]:[])});
    this.root.dataset.mode=layout.mode;if(layout.width&&layout.width!==width)this.root.style.width=layout.width+'px';
    cards.forEach((card,i)=>card.hidden=!layout.shown.includes(i));this.root.style.left=layout.left+'px';this.root.style.top=layout.top+'px';this.root.style.visibility='';this.root.hidden=!layout.shown.length;
    this.queue.commitVisible(layout.shown.map(i=>items[i].id));
  }
  // D-pad down focuses a real notice action; A confirms only after focus, so handbrake never tows by accident.
  action(name,{gamepad=false}={}) {
    if(!gamepad||!this.active||!this.root||this.root.hidden)return false;
    const buttons=[...this.root.querySelectorAll('.race-notice:not([hidden]) button')],at=buttons.indexOf(document.activeElement);
    if(!buttons.length)return false;
    if(name==='down'||at>=0&&name==='up'){
      const step=name==='up'?-1:1;buttons[at<0?0:(at+step+buttons.length)%buttons.length].focus({preventScroll:true});return true;
    }
    if(at>=0&&name==='confirm'){buttons[at].click();return true;}
    if(at>=0&&name==='back'){buttons[at].blur();return true;}
    return false;
  }
  menuFeedback(text,{tone='info',ms=3500}={}){
    if(typeof document==='undefined')return;this.mount();
    const panel=document.querySelector('#ui .scr__head')||document.querySelector('#ui .scr');
    if(!panel)return this.toast(text,{tone});
    let row=panel.querySelector('[data-menu-feedback]');if(!row){row=document.createElement('p');row.dataset.menuFeedback='';row.dataset.uiKeep='';row.className='menu-feedback';row.setAttribute('role','status');panel.append(row);} // ui-keep: an in-place menu refresh leaves it up
    row.textContent=notificationText(text);row.dataset.tone=tone;clearTimeout(row.timer);row.timer=setTimeout(()=>row.remove(),ms);return row;
  }
}
export const notifications=new NotificationManager();
if(typeof window!=='undefined'){window.__notifications=notifications;}
