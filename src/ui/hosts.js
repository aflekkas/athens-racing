// Panels owned by other modules (the multiplayer lobby #multiplayer, the replay / photo bar #replay-controls) get the
// UI kit's custom Select / Slider / Toggle in place of their native controls (components.js autoEnhance) as soon as
// they appear in the document; their own code keeps reading and writing the (now hidden) native elements.
import './lobby-setup.js';
import './checkpoint-banner.js';
import { syncHostControls } from './host-controls.js';
import { autoEnhance, button, esc } from './components.js';
import { CARS } from '../cars.js';
import { openCarPicker } from '../car-select.js';
import { carCategory, classLabel } from '../car-catalog.js';

const HOSTS = ['multiplayer', 'replay-controls'];
function scan() { for (const id of HOSTS) { const el = document.getElementById(id); if (el) autoEnhance(el); } }
if (typeof document !== 'undefined' && document.body) {
  scan();
  const mo = new MutationObserver(() => { scan(); if (HOSTS.every((id) => document.getElementById(id)?.__uiAuto)) mo.disconnect(); });
  mo.observe(document.body, { childList: true });
}

// The lobby room shows the chosen car in one compact row; CHANGE opens the same garage as solo play (host car rules
// apply). The native #mp-room-car select remains transport state. Joining or hosting never asks for a car.
export function syncGarage(select) {
  const mp=window.__multiplayer,panel=mp?.panel,context=select?.closest('#mp-room');if(!panel||!context)return;
  const native=select.closest('label');if(native&&!native.hidden)native.hidden=true;
  let host=context.querySelector('[data-garage="'+select.id+'"]');
  if(!host){host=document.createElement('section');host.className='mp-garage';host.dataset.garage=select.id;const anchor=context.querySelector('#mp-room-help');if(anchor)anchor.after(host);else context.append(host);
    host.addEventListener('click',e=>{if(!e.target.closest('[data-change-car]')||!mp.canChangeCar)return;const menu=window.__flow?.menu;if(!menu)return;mp.setCarPickerOpen(true);panel.hidden=true;
      const close=()=>{mp.setCarPickerOpen(false);panel.hidden=false;mp.hooks?.clearInput?.();};
      openCarPicker({menu,index:Math.max(0,CARS.findIndex(c=>c.id===select.value)),allowedCars:mp.allowedCars,
        onPick(id){if(mp.changeCar(id)===false)return false;select.value=id;close();return true;},onCancel:close});});
    select.addEventListener('change',()=>syncGarage(select));
  }
  const car=CARS.find(c=>c.id===select.value)||CARS[0],key=JSON.stringify([car.id,mp.canChangeCar]);
  if(host.dataset.value===key)return;host.dataset.value=key;
  host.innerHTML='<div class="mp-car-row"><span class="mp-car-row__label">YOUR CAR</span><b>'+esc(car.name)+'</b><small>'+esc(classLabel(carCategory(car)))+' · '+Math.round(car.power*1.341)+' HP · '+esc(car.drive.toUpperCase())+'</small></div>'+
    button({label:'CHANGE CAR',icon:'car-profile',size:'sm',variant:'ghost',disabled:!mp.canChangeCar,title:mp.canChangeCar?null:'CAR CHANGES ARE AVAILABLE IN THE LOBBY',attrs:{'data-change-car':'',tabindex:'0'}});
}
let scheduled=false;
export function installPickers(){syncHostControls();const panel=document.getElementById('multiplayer');if(!panel)return;const select=document.getElementById('mp-room-car');if(select)syncGarage(select);}
if(typeof document!=='undefined'&&document.body){installPickers();const observer=new MutationObserver(()=>{if(scheduled)return;scheduled=true;requestAnimationFrame(()=>{scheduled=false;installPickers();});});observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['disabled','hidden']});}
