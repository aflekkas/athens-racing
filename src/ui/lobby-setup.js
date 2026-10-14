// UI presentation only. Multiplayer owns config validation, lifecycle and transport.
import { autoEnhance, esc } from './components.js';
import { TIMES, WEATHERS, TRAFFIC_LEVELS } from '../race-setup.js';
import { configFromLobby, describeMode } from '../mp-setup.js';
const MODES = [['sprint','QUICK RACE'],['timetrial','TIME TRIAL'],['pursuit','PURSUIT'],['free','FREE ROAM'],['taxi','TAXI'],['getaway','GETAWAY DRIVER']];
const options=(list,value)=>list.map(([id,label])=>`<option value="${id}"${String(id)===String(value)?' selected':''}>${esc(label)}</option>`).join('');
function renderLobbySetup() {
  const mp=window.__multiplayer,room=document.getElementById('mp-room');if(!mp?.panel||!room||mp.panel.hidden)return;
  const browser=mp.panel.querySelector('#mp-browser');let draft=browser?.querySelector('[data-setup-draft]');
  if(browser&&mp.pendingDraft&&!mp.lobby){if(!draft){draft=document.createElement('p');draft.dataset.setupDraft='';draft.className='mp-session-summary';browser.prepend(draft);}const text=describeMode(mp.pendingDraft.mode)+' · YOUR SELECTED SESSION SETTINGS';if(draft.textContent!==text)draft.textContent=text;}else draft?.remove();
  if(!mp.lobby)return;
  let section=room.querySelector('[data-lobby-setup]');if(!section){section=document.createElement('section');section.dataset.lobbySetup='';section.className='mp-session-settings';const anchor=room.querySelector('[data-car-rules]')||room.querySelector('#mp-car-toggles');if(anchor)anchor.before(section);else room.append(section);}
  const lobby=mp.lobby,config=mp.getLobbyConfig?.()||configFromLobby(lobby),host=lobby.host===mp.id,editable=host&&lobby.status==='waiting';
  const cars=room.querySelector('#mp-car-toggles');
  if(cars){let fold=room.querySelector('[data-car-rules]');if(!fold){fold=document.createElement('details');fold.dataset.carRules='';fold.className='mp-settings-advanced';const summary=document.createElement('summary');summary.textContent='ALLOWED CAR FILTERS';fold.append(summary);cars.before(fold);fold.append(cars);}const hide=!host||lobby.status!=='waiting';if(fold.hidden!==hide)fold.hidden=hide;}
  const focused=document.activeElement,focusKey=section.contains(focused)?focused.closest('[data-config],label')?.querySelector('[data-config]')?.dataset.config:null;
  const key=JSON.stringify([config,lobby.mode,lobby.status,host,typeof mp.setLobbyConfig]);if(section.dataset.value===key)return;section.dataset.value=key;
  const mode=lobby.mode||'sprint',objective=['taxi','getaway'].includes(mode);
  section.innerHTML=`<h3>${esc(describeMode(mode))} · MULTIPLAYER</h3><p class="mp-session-summary">${esc(TIMES.find(([id])=>id===config.time)?.[1]||config.time)} · ${esc(WEATHERS.find(([id])=>id===config.weather)?.[1]||config.weather)} · POLICE & LAWS ${config.police?'ON':'OFF'}${!objective&&config.reverse?' · REVERSE':''}${objective?' · 5:00 SESSION':''}</p>`;
  if(editable&&typeof mp.setLobbyConfig==='function'){
    section.innerHTML+=`<div class="mp-settings-primary"><label>MODE<select data-mode>${options(MODES,mode)}</select></label><label>TIME OF DAY<select data-config="time">${options(TIMES,config.time)}</select></label><label class="mp-toggle-field"><input type="checkbox" data-config="police"${config.police?' checked':''}>POLICE & LAWS</label></div><details class="mp-settings-advanced"><summary>ADVANCED SESSION OPTIONS</summary><div class="mp-settings-primary"><label>AI RIVALS<input type="number" min="0" max="11" step="1" data-config="rivals" value="${config.rivals}"></label><label>TRAFFIC<select data-config="traffic">${options(TRAFFIC_LEVELS.map(([,v,label])=>[v,label]),config.traffic)}</select></label><label>WEATHER<select data-config="weather">${options(WEATHERS,config.weather)}</select></label>${!objective&&!['free','pursuit'].includes(mode)?`<label class="mp-toggle-field"><input type="checkbox" data-config="reverse"${config.reverse?' checked':''}>REVERSE ROUTE</label>`:''}</div></details>`;
    const modeSelect=section.querySelector('[data-mode]');if(modeSelect)modeSelect.onchange=e=>mp.setLobbyConfig({mode:e.target.value});
    for(const el of section.querySelectorAll('[data-config]'))el.onchange=()=>mp.setLobbyConfig({[el.dataset.config]:el.type==='checkbox'?el.checked:el.type==='number'||el.dataset.config==='traffic'?Number(el.value):el.value});
    autoEnhance(section);if(focusKey){const el=section.querySelector('[data-config="'+focusKey+'"]');(el?.nextElementSibling?.matches('.select')?el.nextElementSibling:el)?.focus({preventScroll:true});}
  }

}
// Coalesce observer bursts to one render per frame. A removed/partial panel is routine during race transitions.
let syncing=false, scheduled=false, lastError;
export function syncLobbySetup() {
  if(syncing)return;
  syncing=true;
  try { renderLobbySetup();lastError=null; }
  catch(error) { const message=error?.message||String(error);if(lastError!==message){lastError=message;console.warn('Lobby UI update skipped:',message);} }
  finally { syncing=false; }
}
if(typeof document!=='undefined'&&document.body){
  const observer=new MutationObserver(()=>{
    if(scheduled)return;scheduled=true;
    requestAnimationFrame(()=>{scheduled=false;syncLobbySetup();});
  });
  observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden']});
  syncLobbySetup();
}
// Main routes named controller actions here while the native lobby dialog is open.
export function lobbyAction(name) {
  const mp=window.__multiplayer;if(!mp?.panel||mp.panel.hidden)return false;
  if(name==='back'||name==='pause'){mp.close();return true;}
  const items=[...mp.panel.querySelectorAll('summary,button:not(:disabled),input:not(.ui-native):not(:disabled),[tabindex="0"]')].filter(el=>!el.closest('[hidden]')&&!el.classList.contains('off')&&el.getClientRects().length);
  const current=document.activeElement,index=items.indexOf(current);
  if(['up','down','left','right'].includes(name)){const dir=['up','left'].includes(name)?-1:1;items[(Math.max(0,index)+dir+items.length)%items.length]?.focus({preventScroll:false});return true;}
  if(name==='confirm'){if(index<0)items[0]?.focus();else if(current.matches('button,summary,[role=button]'))current.click();else if(current.matches('.select,.switch'))current.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',bubbles:true,cancelable:true}));return true;}
  return true;
}
if(typeof window!=='undefined')window.__lobbyUiAction=lobbyAction;
