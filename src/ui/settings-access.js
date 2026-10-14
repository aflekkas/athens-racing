import { icon } from './components.js';
export function openSettings(menu, fromLobby = false) {
  const flow=window.__flow,mp=window.__multiplayer;
  if(fromLobby&&mp?.panel)mp.panel.hidden=true;
  if(flow?.openSettings)flow.openSettings();
  else { if(!menu.open)flow?.pause?.();if(mp?.panel&&!mp.panel.hidden)mp.panel.hidden=true;menu.show('settings',{from:menu.screen||'pause',tab:'audio'},true); }
  if(fromLobby)menu.data.returnLobby=true;
}
export function installSettingsAccess(menu) {
  let button=document.getElementById('race-settings');
  if(!button){button=document.createElement('button');button.id='race-settings';button.type='button';button.innerHTML=icon('gear-six')+'<span>SETTINGS</span>';document.body.append(button);}
  button.onclick=()=>openSettings(menu);
  const install=()=>{const heading=document.querySelector('#multiplayer .mp-heading');if(!heading||heading.querySelector('[data-open-settings]'))return;const b=document.createElement('button');b.type='button';b.dataset.openSettings='';b.innerHTML=icon('gear-six')+'SETTINGS';b.onclick=()=>openSettings(menu,true);heading.insertBefore(b,heading.lastElementChild);};
  install();const observer=new MutationObserver(install);observer.observe(document.body,{childList:true});
}
