// Geographic track selector: offline OSM/DEM base with georeferenced route overlays.
import { MAPS } from './map-catalog.js';
import { getPlayableMaps, isMapEnabled } from './enabled-maps.js';
import { MAP_VIEW, TRACK_ROUTES, MAP_LABELS } from './attica-map-data.js';
import { coverScale, routeBounds, fitTracks, focusTrack, clampCamera } from './map-select-camera.js';
import { fmtDist } from './settings.js';
import * as C from './ui/components.js';
import { getMapPersonalBest } from './personal-bests.js';

const { esc, icon } = C;
const playable = () => getPlayableMaps(MAPS).filter(m => TRACK_ROUTES[m.id]);
const color = id => id === 'penteli' ? '#71d5c1' : id === 'megara' ? '#e4bf70' : id === 'psychiko' ? '#d7cf83' : '#ff7868';
function style() {
  if (document.getElementById('map-select-style')) return;
  const link = document.createElement('link'); link.id = 'map-select-style'; link.rel = 'stylesheet'; link.href = new URL('./map-select.css', import.meta.url).href; document.head.append(link);
}
const KIND = m => m.type === 'circuit' ? ['CIRCUIT', 'arrows-clockwise'] : m.id === 'penteli' ? ['HILL CLIMB', 'mountains'] : ['POINT TO POINT', 'path'];
const lapTime = t => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}`;
function preview(map) {
  const [kind, ic] = KIND(map), pb = getMapPersonalBest(map.id);
  // A best only appears once one exists; an empty record box is noise.
  const best = pb ? `<div class="map-spec map-spec--best"><small>${icon('timer')}BEST</small><b>${lapTime(pb.time)}</b><span>${esc(pb.setup.car)} · ${pb.setup.laps} LAP${pb.setup.laps === 1 ? '' : 'S'}${pb.setup.direction < 0 ? ' · REV' : ''}</span></div>` : '';
  return `<div class="map-preview__route"><img src="${map.preview}" alt="${esc(map.name)} route outline" draggable="false"/></div>
    <div class="map-preview__info"><div class="map-kind">${icon(ic)}${kind}</div><h3>${esc(map.name)}</h3><p>${esc(map.subtitle)}</p>
    <div class="map-specs"><div class="map-spec"><small>LENGTH</small><b>${fmtDist(map.length)}${map.type === 'circuit' ? '<span> / LAP</span>' : ''}</b></div>${best}</div>
    ${C.button({ label: 'SELECT TRACK', icon: 'flag-checkered', iconRight: 'caret-right', variant: 'primary', block: true, attrs: { 'data-confirm-track': '', 'data-map-id': map.id } })}</div>`;
}
const count = (selectable, m) => `${selectable.indexOf(m) + 1} <span>/ ${selectable.length}</span>`;
export function renderMapSelect(selectedId = 'riviera', mode) {
  style(); const selectable = playable(), selected = selectable.find(m => m.id === selectedId) || selectable[0];
  const { width, height } = MAP_VIEW;
  const labels = MAP_LABELS.map((l, i) => `<span class="map-label map-label--${l.k}" data-label="${i}"><i></i><b>${esc(l.t)}${l.s ? `<small>${esc(l.s)}</small>` : ''}</b></span>`).join('');
  const pins = selectable.map((m, i) => `<span role="button" tabindex="-1" class="mi track-pin ${m.id === selected.id ? 'selected active' : ''}" aria-label="Preview ${esc(m.name)}" aria-pressed="${m.id === selected.id}" data-map-id="${m.id}" style="--pin:${color(m.id)}" ${m.id === selected.id ? 'data-default' : ''}><i class="track-pin__pulse"></i><i class="track-pin__dot">${i + 1}</i><span>${m.name}</span></span>`).join('');
  return C.screen({ cls: 'scr--maps', kick: mode === 'free' ? 'FREE ROAM' : 'QUICK RACE', title: 'ATTICA / CHOOSE YOUR TRACK',
    hints: [['leftright', 'TRACK'], ['confirm', 'SELECT'], ['back', 'BACK']],
    body: `<div class="attica-layout"><div class="attica-map"><div class="attica-viewport" aria-label="Attica: Megara Circuit, Riviera coast and Dionysos"><div class="attica-layer"><img class="attica-art" src="assets/maps/attica.svg" alt="OpenStreetMap coastline and motorways of greater Athens, with DEM relief of Parnitha, Hymettus and Penteli" draggable="false"/><svg class="attica-routes" viewBox="0 0 ${width} ${height}" aria-hidden="true">${selectable.map(m => { const r = TRACK_ROUTES[m.id]; return `<g class="track-route ${m.id === selected.id ? 'active' : ''}" data-route-id="${m.id}" style="--route:${color(m.id)}"><path class="route-casing" d="${r.path}"/><path class="route-line" d="${r.path}"/><path class="route-trace" pathLength="100" d="${r.path}"/></g>`; }).join('')}</svg></div>
      <div class="attica-overlay"><div class="attica-labels" aria-hidden="true">${labels}</div>${pins}</div>
      <div class="map-region"><span class="map-status-dot"></span> ATTICA <small>37.98° N / 23.73° E</small></div><div class="map-north" aria-label="North is up">N <span>↑</span></div><div class="map-scale" aria-label="Map scale"><span></span><small>5 km</small></div>
      </div><div class="attica-footer"><div class="attica-caption"><span aria-hidden="true">DRAG TO PAN · SCROLL / PINCH TO ZOOM</span><small><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors / ODbL</a> · <a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md" target="_blank" rel="noopener">EU-funded Copernicus EU-DEM</a></small></div><div class="map-tools">${C.button({ label: 'RESET', icon: 'arrow-counter-clockwise', act: 'mapReset', size: 'sm', title: 'Show all tracks' })}</div></div></div>
      <aside class="map-preview panel" data-map="${selected.id}" style="--track:${color(selected.id)}"><nav class="map-track-nav" aria-label="Browse tracks">${C.button({ icon: 'caret-left', variant: 'ghost', act: 'mapPrev', title: 'Previous track' })}<div><small>TRACK</small><b class="map-track-count">${count(selectable, selected)}</b></div>${C.button({ icon: 'caret-right', variant: 'ghost', act: 'mapNext', title: 'Next track' })}</nav><div class="map-preview-content" aria-live="polite">${preview(selected)}</div><div class="map-cycle-hint" aria-hidden="true">SWIPE TO BROWSE</div></aside></div>` });
}
// Screen rects are [left, top, right, bottom] in viewport pixels.
const hit = (a, b) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
const PLACES = { c: [-.5, -.5, 0, 0], r: [0, -.5, 8, 0], l: [-1, -.5, -8, 0], t: [-.5, -1, 0, -6], b: [-.5, 0, 0, 6] };
const easeInOut = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
export function mountMapSelect(root) {
  const map = root.querySelector('.attica-viewport'), layer = root.querySelector('.attica-layer'), card = root.querySelector('.map-preview'), overlay = root.querySelector('.attica-overlay');
  if (!map) return;
  const selectable = playable(), events = new AbortController(), { signal } = events;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const { width: W, height: H } = MAP_VIEW;
  let selected = card.dataset.map, active = selected, camera, home, baseScale = 1, view, dirty = false, focused = false, drag, pinch, swipe, frame = 0, resizeFrame = 0, motion = null, last = 0;
  const bounds = routeBounds(selectable.map(m => TRACK_ROUTES[m.id]));
  const pointers = new Map();
  const scaleSpan = map.querySelector('.map-scale span');
  const pins = [...overlay.querySelectorAll('.track-pin')].map(el => ({ el, id: el.dataset.mapId, at: TRACK_ROUTES[el.dataset.mapId].pin }));
  const labels = [...overlay.querySelectorAll('.map-label')].map(el => ({ el, ...MAP_LABELS[+el.dataset.label], box: null, place: null, shown: false }));
  let chrome = [];
  // Measured once per layout (sizes are fixed in screen pixels), so camera frames never read layout.
  const measure = () => {
    const vr = map.getBoundingClientRect();
    for (const p of pins) { const r = p.el.getBoundingClientRect(), dot = p.el.querySelector('.track-pin__dot').getBoundingClientRect(); p.w = r.width; p.h = r.height; p.ax = dot.left + dot.width / 2 - r.left; }
    for (const l of labels) { const b = l.el.querySelector('b'); l.box = [b.offsetWidth, b.offsetHeight]; }
    chrome = [...map.querySelectorAll('.map-region,.map-north,.map-scale')].map(el => { const r = el.getBoundingClientRect(); return [r.left - vr.left - 6, r.top - vr.top - 6, r.right - vr.left + 6, r.bottom - vr.top + 6]; });
  };
  const toScreen = (x, y) => [view.width / 2 + camera.x + (x - W / 2) * camera.scale, view.height / 2 + camera.y + (y - H / 2) * camera.scale];
  const worldAt = (cam, px, py) => [W / 2 + (px - cam.x) / cam.scale, H / 2 + (py - cam.y) / cam.scale];
  const cameraFor = (scale, [wx, wy], px = 0, py = 0) => ({ scale, x: px - (wx - W / 2) * scale, y: py - (wy - H / 2) * scale });
  const minScale = () => baseScale, maxScale = () => baseScale * 3.5;
  // Greedy, ranked placement: pins, the selected route and the map chrome are obstacles; a label keeps its side while it still fits.
  const placeLabels = () => {
    const taken = [...chrome];
    for (const p of pins) { const [sx, sy] = toScreen(...p.at); taken.push([sx - p.ax - 4, sy - p.h / 2 - 4, sx - p.ax + p.w + 4, sy + p.h / 2 + 4]); }
    for (const m of selectable) { const b = TRACK_ROUTES[m.id].bounds, [x0, y0] = toScreen(b[0], b[1]), [x1, y1] = toScreen(b[2], b[3]); taken.push([x0 - 5, y0 - 5, x1 + 5, y1 + 5]); }
    for (const l of labels) {
      const [sx, sy] = toScreen(l.x, l.y), [w, h] = l.box, centred = l.k === 'city' || l.k === 'water';
      const order = centred ? ['c'] : [...new Set([l.place || 'r', 'r', 'l', 't', 'b'])];
      let place = null, rect;
      for (const key of order) {
        const [fx, fy, ox, oy] = PLACES[key]; rect = [sx + fx * w + ox, sy + fy * h + oy]; rect.push(rect[0] + w, rect[1] + h);
        const marker = centred ? rect : [sx - 4, sy - 4, sx + 4, sy + 4];
        if (rect[0] < 4 || rect[1] < 4 || rect[2] > view.width - 4 || rect[3] > view.height - 4) continue;
        if (!taken.some(t => hit(t, rect) || hit(t, marker))) { place = key; taken.push([rect[0] - 6, rect[1] - 3, rect[2] + 6, rect[3] + 3], marker); break; }
      }
      if (place) { if (place !== l.place) { l.el.dataset.place = place; l.place = place; } }
      if (!!place !== l.shown) { l.shown = !!place; l.el.classList.toggle('on', l.shown); }
    }
  };
  const sync = () => {
    if (!camera || !view) return;
    camera = clampCamera(camera, view, MAP_VIEW);
    layer.style.transform = `translate(calc(-50% + ${camera.x}px),calc(-50% + ${camera.y}px)) scale(${camera.scale / baseScale})`;
    if (scaleSpan) scaleSpan.style.width = `${5000 / MAP_VIEW.metersPerUnit * camera.scale}px`;
    // Pins and labels live in screen space: constant UI size, positioned from the same camera.
    for (const p of pins) { const [sx, sy] = toScreen(...p.at); p.el.style.transform = `translate(${sx - p.ax}px,${sy - p.h / 2}px)`; }
    for (const l of labels) { const [sx, sy] = toScreen(l.x, l.y); l.el.style.transform = `translate(${sx}px,${sy}px)`; }
    placeLabels();
  };
  // One frame loop drives every camera move, so a new gesture always starts from the camera on screen.
  const run = now => {
    frame = 0; const dt = Math.min(.05, (now - (last || now)) / 1000); last = now;
    if (!motion || !view) return;
    if (motion.type === 'tween') {
      const t = reduced.matches ? 1 : Math.min(1, (now - motion.start) / motion.duration), e = easeInOut(t);
      const scale = Math.exp(Math.log(motion.from.scale) + (Math.log(motion.to.scale) - Math.log(motion.from.scale)) * e);
      camera = cameraFor(scale, [0, 1].map(i => motion.c0[i] + (motion.c1[i] - motion.c0[i]) * e)); if (t >= 1) { camera = { ...motion.to }; motion = null; }
    } else {
      const k = reduced.matches ? 1 : 1 - Math.exp(-dt / .09), log = Math.log(camera.scale) + (motion.log - Math.log(camera.scale)) * k;
      camera = cameraFor(Math.exp(log), motion.world, ...motion.anchor); if (Math.abs(log - motion.log) < 1e-3) { camera = cameraFor(Math.exp(motion.log), motion.world, ...motion.anchor); motion = null; }
    }
    sync(); if (motion) frame = requestAnimationFrame(run);
  };
  const start = () => { if (!frame) { last = 0; frame = requestAnimationFrame(run); } };
  const stop = () => { motion = null; cancelAnimationFrame(frame); frame = 0; };
  const flyTo = target => {
    if (!camera || !view) return;
    const to = clampCamera(target, view, MAP_VIEW), from = { ...camera };
    const c0 = worldAt(from, 0, 0), c1 = worldAt(to, 0, 0), travel = Math.hypot((c1[0] - c0[0]) * to.scale, (c1[1] - c0[1]) * to.scale) + Math.abs(Math.log(to.scale / from.scale)) * 600;
    motion = { type: 'tween', from, to, c0, c1, start: performance.now(), duration: Math.min(900, 420 + travel * .6) }; start();
  };
  const zoomAt = (factor, px, py) => {
    if (!camera || !view) return; dirty = true;
    const anchor = [px - view.width / 2, py - view.height / 2];
    const keep = motion?.type === 'zoom' && Math.hypot(anchor[0] - motion.anchor[0], anchor[1] - motion.anchor[1]) < 3;
    const log = Math.log(Math.max(minScale(), Math.min(maxScale(), Math.exp((keep ? motion.log : Math.log(camera.scale))) * factor)));
    motion = { type: 'zoom', log, anchor, world: keep ? motion.world : worldAt(camera, ...anchor) }; start();
  };
  // Overview until a track is browsed; then the gentle per-track framing.
  const framing = () => focused ? focusTrack(view, MAP_VIEW, bounds, home, TRACK_ROUTES[active].pin) : home;
  const local = e => { const r = map.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const highlight = (id, easeCamera = true) => {
    if (!TRACK_ROUTES[id]) return;
    const changed = active !== id; active = id;
    root.querySelectorAll('[data-route-id]').forEach(el => el.classList.toggle('active', el.dataset.routeId === id));
    pins.forEach(p => p.el.classList.toggle('active', p.id === id));
    if (easeCamera && changed && home && !dirty) { focused = true; flyTo(framing()); }
  };
  const show = id => {
    const m = selectable.find(m => m.id === id); if (!m) return;
    if (selected !== id) {
      const hadFocus = card.querySelector('[data-confirm-track]') === document.activeElement;
      selected = id; card.dataset.map = id; card.style.setProperty('--track', color(id));
      const content = card.querySelector('.map-preview-content'); content.innerHTML = preview(m); content.classList.remove('swap'); void content.offsetWidth; content.classList.add('swap');
      card.querySelector('.map-track-count').innerHTML = count(selectable, m);
      pins.forEach(p => { p.el.classList.toggle('selected', p.id === id); p.el.setAttribute('aria-pressed', String(p.id === id)); });
      if (hadFocus) card.querySelector('[data-confirm-track]').focus({ preventScroll: true });
    }
    // Choosing a track always frames it, even after free zoom/pan.
    dirty = false; highlight(id);
  };
  const cycle = delta => { const index = selectable.findIndex(m => m.id === selected); show(selectable[(index + delta + selectable.length) % selectable.length].id); card.querySelector('[data-confirm-track]').focus({ preventScroll: true }); };
  root.addEventListener('pointerover', e => { const pin = e.target.closest('.track-pin'); if (pin && e.pointerType !== 'touch') highlight(pin.dataset.mapId); }, { signal });
  map.addEventListener('pointerleave', () => highlight(selected), { signal });
  map.addEventListener('pointermove', e => { if (!pointers.size && (e.movementX || e.movementY) && !e.target.closest('.track-pin')) highlight(selected); }, { signal });
  // Keep the menu's spatial pointer focus from turning hover into an accidental selection.
  root.addEventListener('pointermove', e => { if (e.target.closest('.track-pin')) e.stopPropagation(); }, { capture: true, signal });
  root.addEventListener('focusin', e => { const pin = e.target.closest('.track-pin'); if (pin) show(pin.dataset.mapId); }, { signal });
  root.addEventListener('click', e => { const pin = e.target.closest('.track-pin'); if (pin) { e.stopPropagation(); show(pin.dataset.mapId); } }, { capture: true, signal });
  root.addEventListener('keydown', e => { if (e.target.closest('input,textarea,select,[contenteditable]')) return; if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); if (!e.repeat) cycle(e.key === 'ArrowRight' ? 1 : -1); } }, { capture: true, signal });
  map.addEventListener('wheel', e => { e.preventDefault(); const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1); zoomAt(Math.exp(-Math.max(-300, Math.min(300, dy)) * .0016), ...local(e)); }, { passive: false, signal });
  map.addEventListener('pointerdown', e => { if (e.target.closest('.mi,a') || !camera) return; stop(); dirty = true; map.setPointerCapture(e.pointerId); pointers.set(e.pointerId, local(e)); drag = local(e); pinch = null; map.classList.add('dragging'); }, { signal });
  map.addEventListener('pointermove', e => {
    if (!pointers.has(e.pointerId)) return; pointers.set(e.pointerId, local(e));
    if (pointers.size > 1) {
      // Pinch zooms about the fingers' midpoint and pans with it, in one camera update.
      const [a, b] = [...pointers.values()], mid = [(a[0] + b[0]) / 2 - view.width / 2, (a[1] + b[1]) / 2 - view.height / 2], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (pinch) { const scale = Math.max(minScale(), Math.min(maxScale(), camera.scale * d / pinch.d)); camera = cameraFor(scale, worldAt(camera, ...pinch.mid), ...mid); sync(); }
      pinch = { d, mid }; drag = null; return;
    }
    if (drag && !pinch) { const [x, y] = local(e); camera.x += x - drag[0]; camera.y += y - drag[1]; sync(); drag = [x, y]; }
  }, { signal });
  const up = e => { pointers.delete(e.pointerId); if (pointers.size < 2) pinch = null; drag = pointers.size ? [...pointers.values()][0] : null; if (!pointers.size) map.classList.remove('dragging'); };
  map.addEventListener('pointerup', up, { signal }); map.addEventListener('pointercancel', up, { signal });
  card.addEventListener('pointerdown', e => { if (e.pointerType === 'touch') { swipe = [e.clientX, e.clientY, e.pointerId]; } }, { signal });
  card.addEventListener('pointerup', e => { if (!swipe || swipe[2] !== e.pointerId) return; const dx = e.clientX - swipe[0], dy = e.clientY - swipe[1]; swipe = null; if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.4) cycle(dx < 0 ? 1 : -1); }, { signal });
  card.addEventListener('pointercancel', () => { swipe = null; }, { signal });
  // ResizeObserver callbacks run during layout: defer writes to avoid another
  // resize notification in the same delivery cycle (and the global error banner).
  const relayout = () => {
    const rect = map.getBoundingClientRect(), next = { width: rect.width, height: rect.height };
    if (!next.width || !next.height) return;
    const old = view && camera && { centre: worldAt(camera, 0, 0), zoom: camera.scale / home.scale };
    view = next; baseScale = coverScale(view, MAP_VIEW);
    layer.style.width = `${W * baseScale}px`; layer.style.height = `${H * baseScale}px`;
    home = fitTracks(view, MAP_VIEW, bounds); measure();
    // A layout change keeps what the player was looking at instead of snapping back to the overview.
    const target = !old ? home : dirty ? cameraFor(home.scale * old.zoom, old.centre) : framing();
    if (motion?.type === 'tween' && !dirty) { stop(); camera = { ...target }; } else if (!motion) camera = { ...target };
    if (!old) overlay.classList.add('ready');
    sync();
  };
  const resize = new ResizeObserver(() => { cancelAnimationFrame(resizeFrame); resizeFrame = requestAnimationFrame(relayout); }); resize.observe(map);
  document.fonts?.ready.then(() => { if (!signal.aborted && view) { measure(); sync(); } });

  return { preview: show, action(name) {
    if (['left', 'shiftDown', 'mapPrev'].includes(name)) { cycle(-1); return true; }
    if (['right', 'shiftUp', 'mapNext'].includes(name)) { cycle(1); return true; }
    if (name === 'mapZoomIn' || name === 'mapZoomOut') { if (view) zoomAt(name === 'mapZoomIn' ? 1.35 : 1 / 1.35, view.width / 2, view.height / 2); return true; }
    if (name === 'mapReset') { dirty = false; focused = false; if (home) flyTo(home); return true; }
    return false;
  }, dispose() { events.abort(); resize.disconnect(); stop(); cancelAnimationFrame(resizeFrame); } };
}
// Quick Race confirms the track and compares times before race setup.
export async function selectMap(menu, id) {
  if (menu.mapLoading || !isMapEnabled(id)) return;
  menu.mapLoading = true;
  try {
    menu.h.selectMap(id);
    menu.filter = menu.data.filter || menu.filter || 'all';
    if (menu.data.mode === 'free') menu.show('setup', { eventId: 'free:' + id, mode: 'free' }, true);
    else menu.show('mapConfirm', { mapId: id, mode: 'quick' }, true);
  } catch (error) { C.ui.toast('COULD NOT LOAD THIS MAP', { icon: 'warning', tone: 'bad' }); console.error(error); }
  finally { menu.mapLoading = false; }
}
