// UI-owned presentation over the accounts owner's client APIs and event binders.
import { account, renderAccountCard, bindAccountCard } from '../account.js';
import { friends, renderFriendsCard, bindFriendsCard } from '../friends.js';
import { createAddFriendButton } from './friend-actions.js';
import { formatPlate } from '../plate.js';
import { CARS } from '../cars.js';
import { MAPS } from '../map-catalog.js';
import * as C from './components.js';
export function renderDriver(state = {}) {
  const raw=state.me || account.cached() || { guest:true };
  const stats=raw.stats ? { ...raw.stats, favouriteCar:CARS.find(c=>c.id===raw.stats.favouriteCar)?.short || raw.stats.favouriteCar, best:Object.fromEntries(Object.entries(raw.stats.best || {}).map(([key,time])=>{const [map,event,car]=key.split('|');return [key.includes('|') ? `${MAPS.find(m=>m.id===map)?.name || map} · ${event} · ${CARS.find(c=>c.id===car)?.short || car}` : key,time];})) } : null;
  const me={...raw,stats}, first=!me.username;
  return C.screen({ cls:'scr--social', kick:me.guest?'RACE AS A GUEST OR SIGN IN':'YOUR DRIVER', title:first?'CREATE YOUR DRIVER':'DRIVER PROFILE',
    hints:[['select','SELECT'],['confirm','OK'],['back','BACK']],
    body:`<div class="driver-layout"><aside class="driver-identity panel panel--notch"><div class="driver-emblem">${C.brandMark()}</div><h3>${me.guest?'YOUR NAME.<br/>YOUR PLATE.':C.esc(me.displayName || me.username || 'CHOOSE YOUR NAME')}</h3><div class="driver-plate" aria-label="License plate preview"><span>GR</span><b data-plate-preview>${C.esc(formatPlate(me.username || 'YOUR-NAME'))}</b></div><p>Your username appears on your car and above it in online races.</p>${!me.guest?C.button({label:'FRIENDS & ONLINE DRIVERS',icon:'users-three',act:'friends',variant:'secondary',block:true}):'<p class="note">All cars and tracks are available to guests.</p>'}</aside><div class="driver-profile scroll-y">${renderAccountCard({ ...state,me })}</div></div>` });
}
export function renderSocial(state = {}) {
  const me=account.cached();
  return C.screen({cls:'scr--social',kick:'DRIVERS / PRESENCE',title:'FRIENDS',hints:[['select','SELECT'],['confirm','OK'],['back','BACK']],body:me?.guest||!me?`<div class="social-guest panel"><h3>RACE WITH YOUR FRIENDS</h3><p>Sign in to search for drivers, accept requests and join your friends in public lobbies.</p>${C.button({label:'DRIVER ACCOUNT',icon:'user',act:'account',variant:'primary'})}</div>`:renderFriendsCard({ ...state,snapshot:friends.cache() })});
}
export function mountSocial(menu) {
  const root=menu.root;
  const accountRoot=root.querySelector('[data-account=root]');
  if(accountRoot)bindAccountCard(accountRoot, {onContinue(){menu.show('title');}});
  const friendsRoot=root.querySelector('[data-friends=root]');
  if(friendsRoot)bindFriendsCard(friendsRoot,{onJoin(username){const code=friends.joinableCode(username);if(!code)return C.ui.toast('LOBBY IS NO LONGER JOINABLE',{tone:'bad',icon:'warning'});const mp=window.__multiplayer;mp?.open();mp?.action('join',{code});}});
  const styleButtons=()=>{
    for(const old of root.querySelectorAll('[data-list=recent] button[data-act=request]')){const add=createAddFriendButton(old.dataset.username);if(add)old.replaceWith(add);else old.remove();}
    for(const row of root.querySelectorAll('[data-list=results] .friend-row')){const label=row.querySelector('.friend-acts > span');if(label?.textContent==='BLOCKED'){const button=document.createElement('button');button.type='button';button.dataset.act='unblock';button.dataset.username=row.dataset.username;button.textContent='UNBLOCK';label.replaceWith(button);}}
    root.querySelectorAll('[data-friends] button').forEach(b=>{b.classList.add('mi','btn','btn--secondary','btn--sm');if(b.dataset.act==='join')b.hidden=!friends.joinableCode(b.dataset.username);});
  };styleButtons();
  const mo=new MutationObserver(styleButtons);mo.observe(root,{childList:true,subtree:true});
  root.querySelectorAll('input').forEach(input=>{input.addEventListener('keydown',e=>{if(e.key==='Escape'){input.blur();e.stopPropagation();}});if(input.matches('[data-username]'))input.addEventListener('input',()=>{const preview=root.querySelector('[data-plate-preview]');if(preview)preview.textContent=formatPlate(input.value)||'YOUR-NAME';});});
  return {dispose(){mo.disconnect();}};
}
export async function loadSocial(menu,screen) {
  try {
    if(screen==='account'){await account.get();if(menu.screen==='account')menu.refresh();}
    else if(!account.cached()?.guest){await friends.list();const recent=await friends.recent();if(menu.screen==='friends'){menu.data.recent=recent;menu.refresh();}}
  }catch(err){if(menu.screen===screen){menu.data.error=err.message;menu.refresh();C.ui.toast(err.message,{tone:'bad',icon:'warning'});}}
}
