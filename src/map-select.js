// MAP SELECT: one card per map (src/map-catalog.js) on a rail that fits the screen, or scrolls sideways with arrows,
// edge fades and dots when it does not. Choosing a map loads it behind the full-screen loading screen (src/ui/loading.js).
import { MAPS } from './map-catalog.js';
import { getPlayableMaps, isMapEnabled } from './enabled-maps.js';
import { TRACK_PINS } from './attica-map-data.js';
import { fmtDist } from './settings.js';
import * as C from './ui/components.js';

const { esc, icon } = C;
function style() {
  if (document.getElementById('map-select-style')) return;
  const link = document.createElement('link'); link.id = 'map-select-style'; link.rel = 'stylesheet'; link.href = new URL('./map-select.css', import.meta.url).href; document.head.append(link);
}
const KIND = (m) => m.type === 'circuit' ? ['CIRCUIT', 'arrows-clockwise'] : m.id === 'penteli' ? ['HILL CLIMB', 'mountains'] : ['POINT TO POINT', 'path'];
function preview(map) {
  const [kind, ic] = KIND(map);
  return `<img src="${map.preview}" alt="${esc(map.name)} route outline"/><div class="map-preview__info"><div class="label map-selected-label">SELECTED TRACK</div>${C.badge(kind, '', ic)}<h3>${esc(map.name)}</h3><p>${esc(map.subtitle)}</p><b>${fmtDist(map.length)}${map.type === 'circuit' ? ' / LAP' : ''}</b>${C.button({ label: 'SELECT TRACK', icon: 'flag-checkered', variant: 'primary', attrs: { 'data-map-id': map.id } })}</div>`;
}
export function renderMapSelect(selectedId = 'riviera', mode) {
  style(); const selectable = getPlayableMaps(MAPS); const selected = selectable.find(m => m.id === selectedId) || selectable[0];
  return C.screen({ cls: 'scr--maps', kick: mode === 'taxi' ? 'TAXI / 5 MINUTES' : mode === 'getaway' ? 'GETAWAY DRIVER / 5 MINUTES' : mode === 'free' ? 'FREE ROAM' : mode === 'quick' ? 'QUICK RACE' : mode === 'tt' ? 'TIME TRIAL' : 'EVENTS', title: 'ATTICA / CHOOSE YOUR TRACK',
    hints: [['select', 'TRACK'], ['confirm', 'SELECT'], ['back', 'BACK']],
    body: `<div class="attica-layout"><div class="attica-map" aria-label="Map of Attica with playable race locations"><div class="attica-layer"><img class="attica-art" src="assets/maps/attica.svg" alt="Stylised Attica coastline, Athens, Saronic Gulf, Hymettus and Penteli mountains" draggable="false"/>
      ${selectable.map((m,i) => { const [x,y] = TRACK_PINS[m.id]; return `<div class="mi track-pin ${m.id === selected.id ? 'selected' : ''}" role="button" aria-label="${m.name}" data-map-id="${m.id}" style="left:${x/1040*100}%;top:${y/840*100}%;--pin:${m.id === 'penteli' ? '#73dbc2' : '#ff594b'}" ${m.id === selected.id ? 'data-default' : ''}>${icon(KIND(m)[1])}<span>${m.name}</span></div>`; }).join('')}</div>
      <div class="map-tools">${C.button({ label: '+', act: 'mapZoomIn', title: 'Zoom in', size: 'sm' })}${C.button({ label: '−', act: 'mapZoomOut', title: 'Zoom out', size: 'sm' })}${C.button({ label: 'RESET', act: 'mapReset', size: 'sm' })}</div><div class="attica-caption">DRAG TO PAN · SCROLL / PINCH TO ZOOM<br/><small>OSM CONTRIBUTORS · REGIONAL OUTLINE SCHEMATIC</small></div><div class="map-north">N ↑</div></div>
      <aside class="map-preview panel" aria-live="polite">${preview(selected)}</aside></div>` });
}
export function mountMapSelect(root) {
  const map = root.querySelector('.attica-map'), layer = root.querySelector('.attica-layer'), card = root.querySelector('.map-preview'); if (!map) return;
  let scale = 1, x = 0, y = 0, drag, pinching, pinchDistance, disposed = false;
  const pointers = new Map();
  const sync = () => { x = Math.max(-map.clientWidth*(scale-1)/2,Math.min(map.clientWidth*(scale-1)/2,x)); y = Math.max(-map.clientHeight*(scale-1)/2,Math.min(map.clientHeight*(scale-1)/2,y)); layer.style.transform = `translate(${x}px,${y}px) scale(${scale})`; };
  const zoom = delta => { scale = Math.max(1,Math.min(3.5,scale+delta)); sync(); };
  const show = id => { const m = MAPS.find(m=>m.id===id); if(!m || card.dataset.map === id)return; card.dataset.map=id; card.innerHTML=preview(m); root.querySelectorAll('.track-pin').forEach(p=>p.classList.toggle('selected',p.dataset.mapId===id)); };
  const hover = e => { const id=e.target.closest('[data-map-id]')?.dataset.mapId;if(id)show(id); };
  root.addEventListener('pointerover',hover);
  const wheel = e => { e.preventDefault();zoom(e.deltaY>0?-.15:.15); };
  map.addEventListener('wheel',wheel,{passive:false});
  const down=e=>{ if(e.target.closest('.mi'))return; map.setPointerCapture(e.pointerId);pointers.set(e.pointerId,[e.clientX,e.clientY]);drag=[e.clientX,e.clientY];map.classList.add('dragging'); };
  const move=e=>{ if(!pointers.has(e.pointerId))return; pointers.set(e.pointerId,[e.clientX,e.clientY]); if(pointers.size>1){ const [a,b]=[...pointers.values()],d=Math.hypot(a[0]-b[0],a[1]-b[1]);if(pinchDistance)zoom((d-pinchDistance)/180);pinchDistance=d;pinching=true;return; } if(!pinching&&drag){x+=e.clientX-drag[0];y+=e.clientY-drag[1];sync();}drag=[e.clientX,e.clientY]; };
  const up=e=>{ pointers.delete(e.pointerId);drag=null;if(!pointers.size){map.classList.remove('dragging');pinchDistance=null;pinching=false;} };
  map.addEventListener('pointerdown',down);map.addEventListener('pointermove',move);map.addEventListener('pointerup',up);map.addEventListener('pointercancel',up);
  const resize=new ResizeObserver(sync);resize.observe(map);
  return { preview:show, action(name){if(name==='mapZoomIn')zoom(.3);else if(name==='mapZoomOut')zoom(-.3);else if(name==='mapReset'){scale=1;x=y=0;sync();}}, dispose(){if(disposed)return;disposed=true;resize.disconnect();root.removeEventListener('pointerover',hover);} };
}
export async function selectMap(menu, id, confirmed = false) {
  if (menu.mapLoading || !isMapEnabled(id)) return;
  if(!confirmed){menu.show('mapConfirm',{...menu.data,mapId:id},true);return;}
  menu.mapLoading = true;
  try {
    await (menu.h.switchMap || window.__flow.switchMap)(id);
    menu.filter = menu.data.filter || menu.filter || 'all';
    if (['taxi', 'getaway'].includes(menu.data.mode)) menu.show('setup', { eventId: menu.data.mode + ':' + id, mode: menu.data.mode }, true);
    else if (menu.data.mode === 'free') menu.show('setup', { eventId: 'free:' + id, mode: 'free' }, true);
    else if (menu.data.mode === 'quick') menu.show('setup', { eventId: 'quick', mode: 'quick' }, true);
    else menu.show('events', { mapId: id }, true);
  } catch (error) { C.ui.toast('COULD NOT LOAD THIS MAP', { icon: 'warning', tone: 'bad' }); console.error(error); }
  finally { menu.mapLoading = false; }
}

export function renderMapConfirm(id) {
  const map=MAPS.find(m=>m.id===id&&isMapEnabled(m.id));if(!map)return '';
  return C.screen({cls:'scr--map-confirm',kick:'SELECTED TRACK · CONFIRM BEFORE LOADING',title:map.name,hints:[['confirm','LOAD TRACK'],['back','CHOOSE ANOTHER']],body:`<div class="map-confirm"><img src="${map.preview}" alt="${esc(map.name)} route"/><section class="panel"><h2>${esc(map.subtitle)}</h2><p>${fmtDist(map.length)} · ${KIND(map)[0]}</p>${C.button({label:'LOAD '+map.name,icon:'flag-checkered',variant:'primary',size:'lg',act:'mapLoad',attrs:{'data-default':''},block:true})}${C.button({label:'CHOOSE ANOTHER TRACK',act:'back',variant:'ghost',block:true})}</section></div>`});
}
