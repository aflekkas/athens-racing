// Panels owned by other modules (the multiplayer lobby #multiplayer, the replay / photo bar #replay-controls) get the
// UI kit's custom Select / Slider / Toggle in place of their native controls (components.js autoEnhance) as soon as
// they appear in the document; their own code keeps reading and writing the (now hidden) native elements.
import './lobby-setup.js';
import { autoEnhance, button, esc } from './components.js';
import { CARS } from '../cars.js';
import { mountCarGrid, renderCarSelect, openCarPicker } from '../car-select.js';

const HOSTS = ['multiplayer', 'replay-controls'];
function scan() { for (const id of HOSTS) { const el = document.getElementById(id); if (el) autoEnhance(el); } }
if (typeof document !== 'undefined' && document.body) {
  scan();
  const mo = new MutationObserver(() => { scan(); if (HOSTS.every((id) => document.getElementById(id)?.__uiAuto)) mo.disconnect(); });
  mo.observe(document.body, { childList: true });
}

// Native selects remain transport state; players use the identical solo catalogue by default.
export function syncGarage(select) {
  const mp=window.__multiplayer,panel=mp?.panel,context=select?.closest('#mp-browser,#mp-room');if(!panel||!context)return;
  const native=select.closest('label');if(native&&!native.hidden)native.hidden=true;
  let host=context.querySelector('[data-garage="'+select.id+'"]');
  if(!host){host=document.createElement('section');host.className='mp-garage';host.dataset.garage=select.id;host.filters={};const anchor=select.id==='mp-room-car'?context.querySelector('#mp-room-help'):context.querySelector('#mp-list');if(anchor)anchor.after(host);else context.append(host);
    const open=card=>{if(card.classList.contains('off')||!mp.canChangeCar)return;const menu=window.__flow?.menu;if(!menu)return;mp.setCarPickerOpen(true);panel.hidden=true;
      const close=()=>{mp.setCarPickerOpen(false);panel.hidden=false;mp.hooks?.clearInput?.();};
      openCarPicker({menu,index:+card.dataset.carIndex,detail:true,allowedCars:select.id==='mp-room-car'?mp.allowedCars:null,
        onPick(id){if(mp.changeCar(id)===false)return false;select.value=id;close();return true;},onCancel:close});};
    host.addEventListener('click',e=>{const card=e.target.closest('.car-card');if(card)open(card);});
    host.addEventListener('keydown',e=>{const card=e.target.closest('.car-card');if(card&&(e.key==='Enter'||e.key===' ')){e.preventDefault();e.stopPropagation();open(card);}});
    host.addEventListener('input',e=>{if(!e.target.matches('[data-car-search]'))return;const pos=e.target.selectionStart;host.filters.search=e.target.value;host.dataset.value='';syncGarage(select);const field=host.querySelector('[data-car-search]');field.focus();field.setSelectionRange?.(pos,pos);});
    host.addEventListener('ui:change',e=>{if(e.detail.el.dataset.scope!=='catalog')return;host.filters[e.detail.key]=e.detail.value;host.dataset.value='';syncGarage(select);});
    select.addEventListener('change',()=>syncGarage(select));
  }
  if(panel.hidden||context.hidden){host.__view?.dispose();host.__view=null;return;}
  const index=Math.max(0,CARS.findIndex(c=>c.id===select.value)),allowed=select.id==='mp-room-car'?mp.allowedCars:null,key=JSON.stringify([select.value,mp.canChangeCar,allowed,host.filters]);
  if(host.dataset.value===key){if(!host.__view)host.__view=mountCarGrid(host);return;}
  host.__view?.dispose();host.dataset.value=key;host.innerHTML='<h3 class="mp-garage-title">THE GARAGE <span>'+esc(CARS[index].short)+' SELECTED</span></h3>'+renderCarSelect({index,garage:true,embedded:true,allowedCars:allowed,filters:host.filters});
  for(const card of host.querySelectorAll('.car-card')){card.tabIndex=card.classList.contains('off')||!mp.canChangeCar?-1:0;if(!mp.canChangeCar){card.classList.add('off');card.setAttribute('aria-disabled','true');card.title='CAR CHANGES ARE AVAILABLE IN THE LOBBY';}}
  autoEnhance(host);host.__view=mountCarGrid(host);
}
let scheduled=false;
export function installPickers(){const panel=document.getElementById('multiplayer');if(!panel)return;for(const id of ['mp-car','mp-room-car']){const select=document.getElementById(id);if(select)syncGarage(select);}}
if(typeof document!=='undefined'&&document.body){installPickers();const observer=new MutationObserver(()=>{if(scheduled)return;scheduled=true;requestAnimationFrame(()=>{scheduled=false;installPickers();});});observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['disabled','hidden']});}
