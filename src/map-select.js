import { MAPS } from './map-catalog.js';
import { fmtDist } from './settings.js';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function style() {
  if (document.getElementById('map-select-style')) return;
  const link = document.createElement('link'); link.id='map-select-style'; link.rel='stylesheet'; link.href=new URL('./map-select.css',import.meta.url).href; document.head.append(link);
}
export function renderMapSelect(selectedId = 'riviera') {
  style();
  return `<div class="map-select-wrap"><div class="kick">CHOOSE YOUR MAP</div><h2>WHERE WILL YOU RACE?</h2><div class="map-cards">${MAPS.map(map => `<div class="mi map-card ${map.id === selectedId ? 'selected' : ''}" role="button" aria-label="${esc(map.name)}" data-act="map" data-map-id="${map.id}"><img src="${map.preview}" alt="${esc(map.name)} track preview"/><div class="map-card-info"><span>${map.type === 'circuit' ? 'CLOSED CIRCUIT' : 'POINT TO POINT'}</span><h3>${esc(map.name)}</h3><p>${esc(map.subtitle)}</p><b>${fmtDist(map.length)}${map.type === 'circuit' ? ' / LAP' : ''}</b></div></div>`).join('')}</div><p class="map-loading" aria-live="polite"></p><div class="mi small" data-act="back">◀ BACK</div></div><div class="ui-keys"><span><i>↑ ↓</i> SELECT</span><span><i>ENTER</i> CONTINUE</span><span><i>ESC</i> BACK</span></div>`;
}
export async function selectMap(menu, id) {
  if (menu.mapLoading) return;
  menu.mapLoading=true;
  const notice=menu.root.querySelector('.map-loading');
  if(notice)notice.textContent='LOADING MAP…';
  try {
    await (menu.h.switchMap || window.__flow.switchMap)(id);
    menu.filter=menu.data.filter || menu.filter || 'all';
    menu.show('events',{mapId:id},true);
  } catch(error) { if(notice)notice.textContent='Could not load this map. '+error.message; console.error(error); }
  finally {menu.mapLoading=false;}
}
