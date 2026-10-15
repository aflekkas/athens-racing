import { installMusicSettings } from '../music-settings.js';
import { icon } from './components.js';
// The in-race SETTINGS button. The lobby screens carry their own settings button (a pushed menu screen, so Back returns).
export function openSettings(menu) {
  const flow=window.__flow;
  if(flow?.openSettings)flow.openSettings();
  else { if(!menu.open)flow?.pause?.();menu.show('settings',{from:menu.screen||'pause',tab:'audio'},true); }
}
export function installSettingsAccess(menu) {
  installMusicSettings(menu);
  let button=document.getElementById('race-settings');
  if(!button){button=document.createElement('button');button.id='race-settings';button.type='button';button.innerHTML=icon('gear-six')+'<span>SETTINGS</span>';document.body.append(button);}
  button.onclick=()=>openSettings(menu);
}
