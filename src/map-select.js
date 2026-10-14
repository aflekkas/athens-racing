// Geographic track selector: offline OSM/DEM base with georeferenced route overlays.
import { MAPS } from './map-catalog.js';
import { getPlayableMaps, isMapEnabled } from './enabled-maps.js';
import { MAP_VIEW, TRACK_ROUTES } from './attica-map-data.js';
import { fmtDist } from './settings.js';
import * as C from './ui/components.js';

const { esc, icon } = C;
const playable = () => getPlayableMaps(MAPS).filter(m => TRACK_ROUTES[m.id]);
const color = id => id === 'penteli' ? '#71d5c1' : '#ff7868';
function style() {
  if (document.getElementById('map-select-style')) return;
  const link = document.createElement('link'); link.id = 'map-select-style'; link.rel = 'stylesheet'; link.href = new URL('./map-select.css', import.meta.url).href; document.head.append(link);
}
const KIND = m => m.type === 'circuit' ? ['CIRCUIT', 'arrows-clockwise'] : m.id === 'penteli' ? ['HILL CLIMB', 'mountains'] : ['POINT TO POINT', 'path'];
function preview(map) {
  const [kind, ic] = KIND(map);
  return `<div class="map-preview__route"><img src="${map.preview}" alt="${esc(map.name)} route outline"/><span>${icon(ic)} ${kind}</span></div><div class="map-preview__info"><div class="label map-selected-label">SELECTED TRACK</div><h3>${esc(map.name)}</h3><p>${esc(map.subtitle)}</p><div class="map-track-distance"><small>ROUTE LENGTH</small><b>${fmtDist(map.length)}${map.type === 'circuit' ? ' / LAP' : ''}</b></div><button type="button" class="mi btn btn--primary" data-confirm-track data-map-id="${map.id}">${icon('flag-checkered')}<span>SELECT TRACK</span>${icon('caret-right')}</button></div>`;
}
export function renderMapSelect(selectedId = 'riviera', mode) {
  style(); const selectable = playable(), selected = selectable.find(m => m.id === selectedId) || selectable[0];
  const { width, height } = MAP_VIEW;
  return C.screen({ cls: 'scr--maps', kick: mode === 'free' ? 'FREE ROAM' : 'QUICK RACE', title: 'ATTICA / CHOOSE YOUR TRACK',
    hints: [['leftright', 'TRACK'], ['confirm', 'SELECT'], ['back', 'BACK']],
    body: `<div class="attica-layout"><div class="attica-map" aria-label="Greater Athens: Riviera coast to Dionysos"><div class="attica-layer"><img class="attica-art" src="assets/maps/attica.svg" alt="OpenStreetMap coastline and roads of greater Athens, with DEM relief of Parnitha, Hymettus and Penteli" draggable="false"/><svg class="attica-routes" viewBox="0 0 ${width} ${height}" aria-hidden="true">${selectable.map(m => { const r = TRACK_ROUTES[m.id]; return `<g class="track-route ${m.id === selected.id ? 'active' : ''}" data-route-id="${m.id}" style="--route:${color(m.id)}"><path class="route-casing" d="${r.path}"/><path class="route-line" d="${r.path}"/><path class="route-trace" pathLength="100" d="${r.path}"/></g>`; }).join('')}</svg>
      ${selectable.map((m,i) => { const [x,y] = TRACK_ROUTES[m.id].pin; return `<button type="button" class="mi track-pin ${m.id === selected.id ? 'selected active' : ''}" aria-label="Preview ${esc(m.name)}" aria-pressed="${m.id === selected.id}" data-map-id="${m.id}" style="left:${x/width*100}%;top:${y/height*100}%;--pin:${color(m.id)}" ${m.id === selected.id ? 'data-default' : ''}><i class="track-pin__pulse"></i><i class="track-pin__dot">${i+1}</i><span>${m.name}</span></button>`; }).join('')}</div>
      <div class="map-region"><span class="map-status-dot"></span> ATTICA <small>37.98° N / 23.73° E</small></div><div class="map-north" aria-label="North is up">N <span>↑</span></div><div class="map-scale" aria-label="Map scale"><span></span><small>5 km</small></div>
      <div class="map-tools">${C.button({ label: '+', act: 'mapZoomIn', title: 'Zoom in', size: 'sm' })}${C.button({ label: '−', act: 'mapZoomOut', title: 'Zoom out', size: 'sm' })}${C.button({ label: 'RESET', act: 'mapReset', size: 'sm' })}</div><div class="attica-caption"><span>DRAG TO PAN · SCROLL / PINCH TO ZOOM</span><small><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors / ODbL</a> · <a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md" target="_blank" rel="noopener">EU-funded Copernicus EU-DEM</a></small></div></div>
      <aside class="map-preview panel" data-map="${selected.id}" style="--track:${color(selected.id)}"><nav class="map-track-nav" aria-label="Browse tracks"><button type="button" class="mi map-track-arrow" data-act="mapPrev" aria-label="Previous track">${icon('caret-left')}</button><div><small>TRACK</small><b class="map-track-count">${selectable.indexOf(selected)+1} <span>/ ${selectable.length}</span></b></div><button type="button" class="mi map-track-arrow" data-act="mapNext" aria-label="Next track">${icon('caret-right')}</button></nav><div class="map-preview-content" aria-live="polite">${preview(selected)}</div><div class="map-cycle-hint">← / → · LB / RB · SWIPE TO BROWSE</div></aside></div>` });
}
export function mountMapSelect(root) {
  const map = root.querySelector('.attica-map'), layer = root.querySelector('.attica-layer'), card = root.querySelector('.map-preview');
  if (!map) return;
  const selectable = playable(), events = new AbortController(), { signal } = events;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  let selected = card.dataset.map, active = selected, scale = 1, x = 0, y = 0, width = 0, height = 0, drag, pinchDistance, pinching = false, swipe, frame = 0;
  const pointers = new Map();
  const scaleBar = map.querySelector('.map-scale');
  const sync = () => {
    const maxX = Math.max(map.clientWidth * (scale - 1) / 2, (width * scale - map.clientWidth) / 2);
    const maxY = Math.max(map.clientHeight * (scale - 1) / 2, (height * scale - map.clientHeight) / 2);
    x = Math.max(-maxX, Math.min(maxX, x)); y = Math.max(-maxY, Math.min(maxY, y));
    layer.style.transform = `translate(calc(-50% + ${x}px),calc(-50% + ${y}px)) scale(${scale})`;
    scaleBar.querySelector('span').style.width = `${5000 / MAP_VIEW.metersPerUnit / MAP_VIEW.width * width * scale}px`;
  };
  const animate = (nextScale, nextX, nextY) => {
    cancelAnimationFrame(frame);
    // Keep both race routes clear of the attribution strip during automatic focus.
    const contentHeight = map.clientHeight - 70, pad = 12;
    const minRouteY = Math.min(...selectable.map(m => TRACK_ROUTES[m.id].bounds[1])) / MAP_VIEW.height;
    const maxRouteY = Math.max(...selectable.map(m => TRACK_ROUTES[m.id].bounds[3])) / MAP_VIEW.height;
    const top = (contentHeight - height * nextScale) / 2;
    if (height) nextY = Math.max(pad - top - minRouteY * height * nextScale, Math.min(contentHeight - pad - top - maxRouteY * height * nextScale, nextY));
    const start = performance.now(), from = [scale,x,y];
    const tick = now => { const t = reduced.matches ? 1 : Math.min(1,(now-start)/650), ease = 1-Math.pow(1-t,3); [scale,x,y] = from.map((v,i) => v+([nextScale,nextX,nextY][i]-v)*ease); sync(); if(t<1)frame=requestAnimationFrame(tick); };
    frame = requestAnimationFrame(tick);
  };
  const highlight = (id, camera = true) => {
    if (!TRACK_ROUTES[id]) return;
    const changed = active !== id; active = id;
    root.querySelectorAll('[data-route-id]').forEach(el => el.classList.toggle('active', el.dataset.routeId === id));
    root.querySelectorAll('.track-pin').forEach(el => el.classList.toggle('active', el.dataset.mapId === id));
    if (camera && changed) { const [px,py] = TRACK_ROUTES[id].pin; animate(1.08, (.5-px/MAP_VIEW.width)*width*.22, (.5-py/MAP_VIEW.height)*height*.22); }
  };
  const show = id => {
    const m = selectable.find(m => m.id === id); if(!m) return;
    if(selected !== id) {
      const hadFocus = card.querySelector('[data-confirm-track]') === document.activeElement;
      selected = id; card.dataset.map = id; card.style.setProperty('--track',color(id));
      card.querySelector('.map-preview-content').innerHTML = preview(m);
      card.querySelector('.map-track-count').innerHTML = `${selectable.indexOf(m)+1} <span>/ ${selectable.length}</span>`;
      root.querySelectorAll('.track-pin').forEach(el => { el.classList.toggle('selected',el.dataset.mapId === id); el.setAttribute('aria-pressed',String(el.dataset.mapId === id)); });
      if(hadFocus)card.querySelector('[data-confirm-track]').focus({preventScroll:true});
    }
    highlight(id);
  };
  const cycle = delta => { const index = selectable.findIndex(m => m.id === selected); show(selectable[(index+delta+selectable.length)%selectable.length].id); card.querySelector('[data-confirm-track]').focus({preventScroll:true}); };
  const zoom = delta => { cancelAnimationFrame(frame); scale=Math.max(1,Math.min(3.5,scale+delta));sync(); };
  root.addEventListener('pointerover',e => { const pin=e.target.closest('.track-pin'); if(pin && e.pointerType!=='touch')highlight(pin.dataset.mapId); },{signal});
  map.addEventListener('pointerleave',() => highlight(selected),{signal});
  map.addEventListener('pointermove',e => { if(!pointers.size && (e.movementX || e.movementY) && !e.target.closest('.track-pin'))highlight(selected); },{signal});
  // Keep the menu's spatial pointer focus from turning hover into an accidental selection.
  root.addEventListener('pointermove',e => { if(e.target.closest('.track-pin'))e.stopPropagation(); },{capture:true,signal});
  root.addEventListener('focusin',e => { const pin=e.target.closest('.track-pin');if(pin)show(pin.dataset.mapId); },{signal});
  root.addEventListener('click',e => { const pin=e.target.closest('.track-pin');if(pin){e.stopPropagation();show(pin.dataset.mapId);} },{capture:true,signal});
  root.addEventListener('keydown',e => { if(e.target.closest('input,textarea,select,[contenteditable]'))return; if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();e.stopPropagation();if(!e.repeat)cycle(e.key==='ArrowRight'?1:-1);} },{capture:true,signal});
  map.addEventListener('wheel',e => {e.preventDefault();zoom(e.deltaY>0?-.15:.15);},{passive:false,signal});
  map.addEventListener('pointerdown',e => { if(e.target.closest('.mi,a'))return;cancelAnimationFrame(frame);map.setPointerCapture(e.pointerId);pointers.set(e.pointerId,[e.clientX,e.clientY]);drag=[e.clientX,e.clientY];map.classList.add('dragging'); },{signal});
  map.addEventListener('pointermove',e => {
    if(!pointers.has(e.pointerId))return;pointers.set(e.pointerId,[e.clientX,e.clientY]);
    if(pointers.size>1){const [a,b]=[...pointers.values()],d=Math.hypot(a[0]-b[0],a[1]-b[1]);if(pinchDistance)zoom((d-pinchDistance)/180);pinchDistance=d;pinching=true;return;}
    if(!pinching&&drag){x+=e.clientX-drag[0];y+=e.clientY-drag[1];sync();}drag=[e.clientX,e.clientY];
  },{signal});
  const up=e=>{pointers.delete(e.pointerId);drag=null;if(!pointers.size){map.classList.remove('dragging');pinchDistance=null;pinching=false;}};
  map.addEventListener('pointerup',up,{signal});map.addEventListener('pointercancel',up,{signal});
  card.addEventListener('pointerdown',e=>{if(e.pointerType==='touch'){swipe=[e.clientX,e.clientY,e.pointerId];}},{signal});
  card.addEventListener('pointerup',e=>{if(!swipe||swipe[2]!==e.pointerId)return;const dx=e.clientX-swipe[0],dy=e.clientY-swipe[1];swipe=null;if(Math.abs(dx)>45&&Math.abs(dx)>Math.abs(dy)*1.4)cycle(dx<0?1:-1);},{signal});
  card.addEventListener('pointercancel',()=>{swipe=null;},{signal});
  const resize = new ResizeObserver(() => {const contentHeight=Math.max(1,map.clientHeight-70);width=Math.min(map.clientWidth,contentHeight*MAP_VIEW.width/MAP_VIEW.height);height=width*MAP_VIEW.height/MAP_VIEW.width;layer.style.top=`${contentHeight/2}px`;layer.style.width=`${width}px`;layer.style.height=`${height}px`;sync();});resize.observe(map);
  return { preview:show, action(name){
    if(['left','shiftDown','mapPrev'].includes(name)){cycle(-1);return true;}
    if(['right','shiftUp','mapNext'].includes(name)){cycle(1);return true;}
    if(name==='mapZoomIn')zoom(.3);else if(name==='mapZoomOut')zoom(-.3);else if(name==='mapReset'){animate(1,0,0);}else return false;
    return true;
  }, dispose(){events.abort();resize.disconnect();cancelAnimationFrame(frame);} };
}
export async function selectMap(menu, id, confirmed = false) {
  if (menu.mapLoading || !isMapEnabled(id)) return;
  if(!confirmed){menu.show('mapConfirm',{...menu.data,mapId:id},true);return;}
  menu.mapLoading = true;
  try {
    await (menu.h.switchMap || window.__flow.switchMap)(id);
    menu.filter = menu.data.filter || menu.filter || 'all';
    if (menu.data.mode === 'free') menu.show('setup', { eventId: 'free:' + id, mode: 'free' }, true);
    else menu.show('setup', { eventId: 'quick', mode: 'quick' }, true);
  } catch (error) { C.ui.toast('COULD NOT LOAD THIS MAP', { icon: 'warning', tone: 'bad' }); console.error(error); }
  finally { menu.mapLoading = false; }
}

export function renderMapConfirm(id) {
  const map=MAPS.find(m=>m.id===id&&isMapEnabled(m.id));if(!map)return '';
  return C.screen({cls:'scr--map-confirm',kick:'SELECTED TRACK · CONFIRM BEFORE LOADING',title:map.name,hints:[['confirm','LOAD TRACK'],['back','CHOOSE ANOTHER']],body:`<div class="map-confirm"><img src="${map.preview}" alt="${esc(map.name)} route"/><section class="panel"><h2>${esc(map.subtitle)}</h2><p>${fmtDist(map.length)} · ${KIND(map)[0]}</p>${C.button({label:'LOAD '+map.name,icon:'flag-checkered',variant:'primary',size:'lg',act:'mapLoad',attrs:{'data-default':''},block:true})}${C.button({label:'CHOOSE ANOTHER TRACK',act:'back',variant:'ghost',block:true})}</section></div>`});
}
