// Panels owned by other modules (the multiplayer lobby #multiplayer, the replay / photo bar #replay-controls) get the
// UI kit's custom Select / Slider / Toggle in place of their native controls (components.js autoEnhance) as soon as
// they appear in the document; their own code keeps reading and writing the (now hidden) native elements.
import { autoEnhance, button, esc } from './components.js';
import { savedPaint } from '../vehicle-paint.js';
import { mountCarGrid, transmissionLabel, openCarPicker } from '../car-select.js';

const HOSTS = ['multiplayer', 'replay-controls'];
function scan() { for (const id of HOSTS) { const el = document.getElementById(id); if (el) autoEnhance(el); } }
if (typeof document !== 'undefined') {
  scan();
  const mo = new MutationObserver(() => { scan(); if (HOSTS.every((id) => document.getElementById(id)?.__uiAuto)) mo.disconnect(); });
  mo.observe(document.body, { childList: true });
}

// Keep the account owner's native selects as transport state, and open the same grid used by solo/free roam.
function syncPreview(select) {
  const mp = window.__multiplayer, panel = document.getElementById('multiplayer'); if(!mp || !select || !panel) return;
  let host = select.parentElement.querySelector('.mp-car-preview');
  if(!host){ host = document.createElement('div'); host.className = 'mp-car-preview'; select.parentElement.append(host); }
  if(panel.hidden){ host.__view?.dispose(); host.__view = null; return; }
  const car = mp.cars.find(c => c.id === select.value); if(!car) return; const key = car.id + savedPaint(car);
  if(host.dataset.car === key) { if(!host.__view && !host.querySelector('img')?.src) host.__view = mountCarGrid(host); return; }
  host.__view?.dispose(); host.dataset.car = key; host.innerHTML = `<div class="car-grid"><img data-car-thumb="${car.id}" alt="${esc(car.name)}" /></div><span>${esc(car.short)} · ${car.drive.toUpperCase()} · ${transmissionLabel(car)}</span>`;
  host.__view = mountCarGrid(host);
}
function installPickers() {
  const panel = document.getElementById('multiplayer'); if (!panel) return;
  for (const id of ['mp-car', 'mp-room-car']) {
    const select = document.getElementById(id), existing=panel.querySelector('[data-picker="'+id+'"]'); if (!select) continue;
    if (existing) { syncPreview(select); existing.classList.toggle('off',select.disabled); existing.setAttribute('aria-disabled',String(select.disabled)); continue; }
    const template = document.createElement('template'); template.innerHTML = button({ label:'BROWSE CAR GRID', icon:'car-profile', variant:'secondary', size:'sm', cls:'mp-picker', attrs:{'data-picker':id}, focusable:false });
    const opener=template.content.firstChild; opener.tabIndex=0; select.parentElement.append(opener);
    const open=()=>{
      const mp=window.__multiplayer, menu=window.__flow?.menu;if(!mp||!menu||select.disabled)return;
      const car=mp.cars.findIndex(c=>c.id===select.value);mp.panel.hidden=true;
      openCarPicker({menu,index:Math.max(0,car),allowedCars:id==='mp-room-car'?mp.allowedCars:null,
        onPick(carId){select.value=carId;select.dispatchEvent(new Event('change',{bubbles:true}));mp.panel.hidden=false;mp.hooks.clearInput();},
        onCancel(){mp.panel.hidden=false;mp.hooks.clearInput();}});
    };
    select.addEventListener('change',()=>syncPreview(select)); syncPreview(select);
    opener.addEventListener('click',open);opener.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();e.stopPropagation();open();}});
  }
}
if(typeof document!=='undefined'){
  installPickers();const pickersObserver=new MutationObserver(installPickers);pickersObserver.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['disabled']});
}
