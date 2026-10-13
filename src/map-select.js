// MAP SELECT: one card per map (src/map-catalog.js) on a rail that fits the screen, or scrolls sideways with arrows,
// edge fades and dots when it does not. Choosing a map loads it behind the full-screen loading screen (src/ui/loading.js).
import { MAPS } from './map-catalog.js';
import { fmtDist } from './settings.js';
import * as C from './ui/components.js';

const { esc, icon } = C;
function style() {
  if (document.getElementById('map-select-style')) return;
  const link = document.createElement('link'); link.id = 'map-select-style'; link.rel = 'stylesheet'; link.href = new URL('./map-select.css', import.meta.url).href; document.head.append(link);
}
const KIND = (m) => m.type === 'circuit' ? ['CIRCUIT', 'arrows-clockwise'] : m.id === 'penteli' ? ['HILL CLIMB', 'mountains'] : ['POINT TO POINT', 'path'];
export function renderMapSelect(selectedId = 'riviera', mode) {
  style();
  const cards = MAPS.map((map) => {
    const [kind, ic] = KIND(map);
    return C.card({ cls: 'map-card', selected: map.id === selectedId, attrs: { 'data-map-id': map.id, 'aria-label': map.name, ...(map.id === selectedId ? { 'data-default': '' } : {}) },
      media: `<img src="${map.preview}" alt="${esc(map.name)} route map" draggable="false"/>`, badge: C.badge(kind, 'dark', ic),
      title: esc(map.name), text: esc(map.subtitle),
      foot: `<b class="map-card__len tnum">${icon('path')}${fmtDist(map.length)}${map.type === 'circuit' ? ' / LAP' : ''}</b>${map.id === selectedId ? C.badge('LOADED', 'cyan', 'check') : ''}` });
  }).join('');
  return C.screen({ cls: 'scr--maps', kick: mode === 'quick' ? 'QUICK RACE' : mode === 'tt' ? 'TIME TRIAL' : 'EVENTS', title: 'CHOOSE YOUR MAP', hints: [['leftright', 'SELECT'], ['confirm', 'CONTINUE'], ['back', 'BACK']],
    body: `<div class="map-rail-wrap"><div class="map-rail scroll-x">${cards}</div>
      <div class="map-nav"><span class="map-nav__btn" data-rail="-1" role="button" aria-label="Previous maps">${icon('caret-left')}</span><span class="map-dots">${MAPS.map(() => '<i></i>').join('')}</span><span class="map-nav__btn" data-rail="1" role="button" aria-label="More maps">${icon('caret-right')}</span></div></div>` });
}
/** after render: overflow affordance (fades, arrows, dots) for the rail */
export function mountMapSelect(root) {
  const wrap = root.querySelector('.map-rail-wrap'), rail = wrap?.querySelector('.map-rail'); if (!rail) return;
  const cards = [...rail.children], dots = [...wrap.querySelectorAll('.map-dots i')];
  const sync = () => {
    const over = rail.scrollWidth > rail.clientWidth + 2;
    wrap.classList.toggle('overflow', over);
    wrap.classList.toggle('at-start', rail.scrollLeft <= 2); wrap.classList.toggle('at-end', rail.scrollLeft + rail.clientWidth >= rail.scrollWidth - 2);
    const r = rail.getBoundingClientRect();
    cards.forEach((c, i) => { const b = c.getBoundingClientRect(); dots[i]?.classList.toggle('on', b.left >= r.left - 4 && b.right <= r.right + 4); });
  };
  rail.addEventListener('scroll', sync, { passive: true });
  new ResizeObserver(sync).observe(rail);
  wrap.querySelector('.map-nav').addEventListener('click', (e) => {
    const b = e.target.closest('[data-rail]'); if (!b) return;
    e.stopPropagation(); rail.scrollBy({ left: +b.dataset.rail * rail.clientWidth * 0.8, behavior: 'smooth' });
  });
  requestAnimationFrame(sync);
}
export async function selectMap(menu, id) {
  if (menu.mapLoading) return;
  menu.mapLoading = true;
  try {
    await (menu.h.switchMap || window.__flow.switchMap)(id);
    menu.filter = menu.data.filter || menu.filter || 'all';
    if (menu.data.mode === 'quick') menu.show('setup', { eventId: 'quick', mode: 'quick' }, true);
    else menu.show('events', { mapId: id }, true);
  } catch (error) { C.ui.toast('COULD NOT LOAD THIS MAP', { icon: 'warning', tone: 'bad' }); console.error(error); }
  finally { menu.mapLoading = false; }
}
