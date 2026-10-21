import {buildRouteGuidanceData} from './route-guidance-data.js';
import { icon } from './ui/components.js';
import { upperName } from './greek-caps.js';
import { notifications } from './ui/notifications.js';
// DOM HUD: position / timing / rival gap, route progress, real-map minimap (OSM coastline,
// buildings, streets, the route), tachometer + speedometer, popups, district banners, countdown and menus.
import { clamp } from './util.js';
import { layoutRacerMarkers } from './racer-marker-layout.js';
import { gearFeedback } from './transmission.js';
import { PAINTS, savedPaint, savePaint } from './vehicle-paint.js';

const $ = (id) => document.getElementById(id);
export const fmtTime = (t) => { if (!isFinite(t)) return '--:--.--'; const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s < 10 ? '0' : ''}${s.toFixed(2)}`; };
const ord = (n) => (n === 1 ? 'ST' : n === 2 ? 'ND' : n === 3 ? 'RD' : 'TH');

// Floating tags belong only to explicitly supplied racers; traffic never enters this collection.
// TODO(UI): shared components may restyle .racer-marker and .tow-prompt without changing their behaviour.
export class RacerMarkers {
  constructor() {
    this.items = new Map(); this.root = document.createElement('div'); this.root.id = 'racer-markers';
    this.root.setAttribute('aria-hidden', 'true'); document.body.append(this.root);
    const style = document.createElement('style'); style.textContent = `
      #racer-markers { position:fixed; inset:0; z-index:22; pointer-events:none; overflow:hidden; }
      .racer-marker { position:absolute; color:var(--racer-color); font:700 13px system-ui; text-align:center; white-space:nowrap; transform-origin:center bottom; }
      .racer-marker .racer-name { display:block; color:white; background:#09131ee0; padding:5px 10px; border:1px solid var(--racer-color); border-radius:5px; box-shadow:0 2px 10px #0008; max-width:180px; overflow:hidden; text-overflow:ellipsis; }
      .racer-marker .racer-chevron { display:block; font-size:24px; line-height:20px; text-shadow:0 2px 5px #000; }
      .racer-marker.ai .racer-name { font-size:11px; padding:3px 7px; border-color:#ffffff50; }
      .racer-marker.edge .racer-name { font-size:11px; padding:3px 6px; }
      .racer-marker.edge .racer-chevron { font-size:22px; }
      .tow-prompt { position:fixed; z-index:65; top:24%; left:50%; transform:translateX(-50%); width:min(440px,calc(100vw - 32px)); box-sizing:border-box; padding:16px 18px; border:1px solid #d9ad44; border-radius:8px; background:#0b1421ee; color:#fff; font:14px system-ui; box-shadow:0 8px 30px #0007; }
      .tow-prompt[hidden] { display:none; }
      .tow-prompt strong { font-size:16px; letter-spacing:.08em; }
      .tow-prompt p { margin:8px 0 12px; color:#ced7e0; }
      .tow-actions { display:flex; gap:8px; flex-wrap:wrap; }
      .tow-actions button { min-height:42px; padding:9px 12px;  border:1px solid #ffffff45; border-radius:5px; background:#223349; color:#fff; font:700 12px system-ui; }
      .tow-actions button:first-child { background:#d9ad44; color:#111; }
      :root[data-ui-focus="navigation"] .tow-actions button:focus-visible { background:#35414b; }
    `; document.head.append(style);
  }
  update(racers) {
    const present = new Set(), markers = [];
    for (const r of racers) {
      if (!Number.isFinite(r.x + r.y + r.distance) || r.distance > 350) continue;
      const offscreen = r.behind || Math.abs(r.x) > 0.92 || Math.abs(r.y) > 0.88;
      if (offscreen && (!r.player || r.distance > 180)) continue;
      present.add(r.id);
      let item = this.items.get(r.id);
      if (!item) {
        const el = document.createElement('div'), name = document.createElement('span'), chevron = document.createElement('span');
        name.className = 'racer-name'; chevron.className = 'racer-chevron'; chevron.textContent = '⌄'; el.append(name, chevron);
        let hash = 0; for (const char of String(r.id)) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
        el.style.setProperty('--racer-color', ['#65dbff', '#ffc46b', '#d49bff', '#7de5aa', '#ff91b0'][hash % 5]);
        this.root.append(el); item = { el, name, chevron }; this.items.set(r.id, item);
      }
      const { el, name, chevron } = item;
      const nm = r.name || 'DRIVER';
      if (item._nm !== nm) { item._nm = nm; name.textContent = nm; item.sizeDirty = true; }
      if (item._pid !== r.id) { item._pid = r.id; el.dataset.playerId = r.id; }
      const cls = 'racer-marker' + (r.player ? '' : ' ai') + (offscreen ? ' edge' : '');
      if (item._cls !== cls) { item._cls = cls; el.className = cls; item.sizeDirty = true; }
      let x = r.x, y = -r.y;
      if (offscreen) {
        if (r.behind) { x = r.viewX; y = -r.viewY; if (Math.abs(x) + Math.abs(y) < 0.01) x = 1; }
        const factor = Math.max(Math.abs(x) / 0.86, Math.abs(y) / 0.76, 0.01); x /= factor; y /= factor;
        if (item._ch !== 'edge') { item._ch = 'edge'; chevron.textContent = '➤'; }
        const rot = `rotate(${Math.atan2(y * innerHeight, x * innerWidth)}rad)`;
        if (item._rot !== rot) { item._rot = rot; chevron.style.transform = rot; }
      } else if (item._ch !== 'main') { item._ch = 'main'; chevron.textContent = '⌄'; chevron.style.transform = ''; item._rot = null; }
      const op = String(Math.round((r.behind ? 0.45 : 1) * clamp((350 - r.distance) / 150, 0, 1) * 100) / 100);
      if (item._op !== op) { item._op = op; el.style.opacity = op; }
      const scale = offscreen ? 0.9 : clamp(1.1 - r.distance / 400, 0.7, 1.05);
      const roundedScale = Math.round(scale * 200) / 200;
      const tr = `translate(-50%, -100%) scale(${roundedScale})`;
      if (item._tr !== tr) { item._tr = tr; el.style.transform = tr; }
      markers.push({ id: r.id, item, x: (x + 1) * innerWidth / 2, y: (y + 1) * innerHeight / 2, scale: roundedScale });
    }
    // Measure only changed labels, after all content writes, then place the whole field together.
    for (const marker of markers) {
      const item = marker.item;
      if (item.sizeDirty) { item.width = item.el.offsetWidth; item.height = item.el.offsetHeight; item.sizeDirty = false; }
      marker.width = item.width * marker.scale; marker.height = item.height * marker.scale;
    }
    for (const marker of layoutRacerMarkers(markers, innerWidth, innerHeight)) {
      const item = marker.item, left = `${marker.x.toFixed(1)}px`, top = `${marker.y.toFixed(1)}px`;
      if (item._left !== left) { item._left = left; item.el.style.left = left; }
      if (item._top !== top) { item._top = top; item.el.style.top = top; }
    }
    for (const [id, item] of this.items) if (!present.has(id)) { item.el.remove(); this.items.delete(id); }
  }
}

export class Hud {
  constructor(map) {
    this.map = map; const { route, data, terrain } = map;
    this.el = {}; for (const id of ['posBox', 'posN', 'posSuf', 'tRace', 'gap', 'rivalName', 'rZone', 'rRoad', 'rToGo', 'rfill', 'rticks', 'rRival', 'rMe', 'mapLabel', 'pops', 'banner', 'count', 'msg', 'menu', 'penRow', 'pen', 'sigBox', 'sigTxt', 'sigD', 'limitSign', 'limitV', 'mKick', 'mTitle', 'mSub', 'mTable', 'cIdx', 'cName', 'cTag', 'cSpecs', 'cStats', 'cBest']) this.el[id] = $(id);
    this.el.limitSign.onanimationend = event => this.finishLimitFlash(event);
    this.el.mapLabel.textContent = map.definition?.name || route.from;
    this.mini = $('minimap'); this.mctx = this.mini.getContext('2d');
    this.tacho = $('tacho'); this.tctx = this.tacho.getContext('2d');
    this.raceLen = route.finish - route.start;
    if(route.isWorldRoute){this.setRoute(route.compiled);this.frame=0;this.lastZone=null;this.lastPos=0;this.rates={tacho:30,map:15,mapBig:30};this._tachoAt=this._mapAt=-1e9;return;}
    // ---- land/sea raster from the terrain grid (10 m per pixel)
    const { GX, GZ, H, C } = terrain;
    const land = this.land = document.createElement('canvas'); land.width = GX; land.height = GZ;
    const lg = land.getContext('2d'); const img = lg.createImageData(GX, GZ);
    for (let i = 0; i < GX * GZ; i++) {
      const h = H[i], c = C[i]; let r, g, b;
      if (c === 7) { r = 22; g = 70; b = 88; }
      else if (h < 0) { const d = clamp(-h / 30, 0, 1); r = 14 - d * 6; g = 44 - d * 18; b = 66 - d * 20; }
      else if (c === 1) { r = 74; g = 68; b = 50; }
      else if (c === 4) { r = 40; g = 44; b = 49; }
      else if (c === 5 || c === 6) { r = 30; g = 44; b = 34; }
      else if (c === 2) { r = 56; g = 54; b = 50; }
      else { const k = clamp(h / 120, 0, 1); r = 36 + k * 12; g = 40 + k * 10; b = 38 + k * 6; }
      img.data[i * 4] = r; img.data[i * 4 + 1] = g; img.data[i * 4 + 2] = b; img.data[i * 4 + 3] = 255;
    }
    lg.putImageData(img, 0, 0);
    // ---- vector layers bucketed into 250 m cells
    const CELL = 250; this.CELL = CELL; this.cells = new Map();
    const put = (x, z, kind, item) => { const k = Math.floor(x / CELL) * 10007 + Math.floor(z / CELL); let c = this.cells.get(k); if (!c) { c = { b: [], r: [], c: [] }; this.cells.set(k, c); } c[kind].push(item); };
    for (const b of data.buildings) { let x = 0, z = 0; const n = b.p.length / 2; for (let i = 0; i < n; i++) { x += b.p[i * 2]; z += b.p[i * 2 + 1]; } put(x / n, z / n, 'b', b.p); }
    const roads = data.roadNetwork ? [...data.sideRoads.filter(r => r.f), ...data.roadNetwork.roads] : data.sideRoads;
    for (const r of roads) { const p = r.p; for (let i = 0; i + 3 < p.length; i += 2) put((p[i] + p[i + 2]) / 2, (p[i + 1] + p[i + 3]) / 2, 'r', [p[i], p[i + 1], p[i + 2], p[i + 3], r.w, r.f]); }
    for (const c of data.coast) for (let i = 0; i + 3 < c.length; i += 2) put(c[i], c[i + 1], 'c', [c[i], c[i + 1], c[i + 2], c[i + 3]]);
    // route polyline (10 m)
    this.rpts = []; for (let s = 0; s <= route.length; s += 10) { const i = Math.round(s / route.step); this.rpts.push(route.X[Math.min(route.N - 1, i)], route.Z[Math.min(route.N - 1, i)]); }
    // ---- route bar ticks
    const ticks = this.el.rticks; let alt = 0;
    for (const m of this.map.marks||data?.marks||[]) {
      const f = (m.s - route.start) / this.raceLen; if (f < 0 || f > 1) continue;
      const t = document.createElement('div'); t.className = 't'; t.style.left = (f * 100) + '%'; ticks.appendChild(t);
      if (['lake', 'limanakia', 'varkiza', 'lomvarda'].includes(m.id)) { const l = document.createElement('div'); l.className = 'l'; l.style.left = (f * 100) + '%'; l.textContent = m.name; if (alt++ % 2 && false) l.style.top = '28px'; ticks.appendChild(l); }
    }
    this.frame = 0; this.lastZone = null; this.lastPos = 0;
    this.rates = { tacho: 30, map: 15, mapBig: 30 }; this._tachoAt = this._mapAt = -1e9; // Hz; setRates() follows the performance class
  }

  setRoute(compiled){this.routeData=compiled?buildRouteGuidanceData(compiled):null;this.worldStreetCache=new Map();}
  drawWorldMinimap(g,W,H,st,zoom=2.2){
    const sc=zoom*W/600,cx=W/2,cy=H*.62;g.setTransform(1,0,0,1,0,0);g.fillStyle='#101b21';g.fillRect(0,0,W,H);g.save();g.translate(cx,cy);g.rotate(st.yaw);g.scale(sc,sc);g.translate(-st.x,-st.z);
    const graph=this.worldRoads?.graph;for(const k of this.worldStreetCache.keys())if(!graph?.owners.has(k))this.worldStreetCache.delete(k);
    for(const [k,owner]of graph?.owners||[]){if(this.worldRoads.stream.tiles.get(k)?.state!=='active')continue;let paths=this.worldStreetCache.get(k);if(!paths){paths=owner.edges.map(id=>graph.edges.get(id)?.value).filter(e=>e&&!(e.flags&8)).map(e=>e.points);this.worldStreetCache.set(k,paths);}g.strokeStyle='#697477';g.lineWidth=2/sc;for(const p of paths){if(!p.some(q=>Math.hypot(q[0]-st.x,q[2]-st.z)<500))continue;g.beginPath();p.forEach((q,i)=>i?g.lineTo(q[0],q[2]):g.moveTo(q[0],q[2]));g.stroke();}}
    if(!st.free)this.routeGuidance?.drawMinimap(g,sc);
    g.restore();if(!st.free)this.routeGuidance?.drawTurnPreview(g,W,H);g.save();g.translate(cx,cy);g.fillStyle='#f5f2e8';g.beginPath();g.moveTo(0,-8);g.lineTo(5,6);g.lineTo(0,3);g.lineTo(-5,6);g.closePath();g.fill();g.restore();
  }

  // ------------------------------------------------------------------ overview (title screen)
  drawOverview(canvas) {
    if(this.map.route.isWorldRoute){this.drawWorldMinimap(canvas.getContext('2d'),canvas.width,canvas.height,{...this.map.route.compiled.startPose,s:0,free:false},.3);return;}
    const g = canvas.getContext('2d'), W = canvas.width, H = canvas.height, { route, data, terrain } = this.map;
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (let i = 0; i < this.rpts.length; i += 2) { x0 = Math.min(x0, this.rpts[i]); x1 = Math.max(x1, this.rpts[i]); z0 = Math.min(z0, this.rpts[i + 1]); z1 = Math.max(z1, this.rpts[i + 1]); }
    const pad = 700; x0 -= pad; x1 += pad; z0 -= pad; z1 += pad;
    const sc = Math.min(W / (x1 - x0), H / (z1 - z0));
    const ox = (W - (x1 - x0) * sc) / 2, oz = (H - (z1 - z0) * sc) / 2;
    g.clearRect(0, 0, W, H);
    g.save();
    g.beginPath(); g.moveTo(30, 0); g.lineTo(W, 0); g.lineTo(W, H - 30); g.lineTo(W - 30, H); g.lineTo(0, H); g.lineTo(0, 30); g.closePath(); g.clip();
    g.translate(ox, oz); g.scale(sc, sc); g.translate(-x0, -z0);
    g.imageSmoothingEnabled = true;
    g.drawImage(this.land, terrain.minX, terrain.minZ, terrain.GX * terrain.T, terrain.GZ * terrain.T);
    g.fillStyle = 'rgba(160,172,186,.35)';
    for (const b of data.buildings) { const p = b.p; g.beginPath(); g.moveTo(p[0], p[1]); for (let i = 2; i < p.length; i += 2) g.lineTo(p[i], p[i + 1]); g.fill(); }
    g.strokeStyle = 'rgba(120,200,255,.55)'; g.lineWidth = 2 / sc;
    for (const c of data.coast) { g.beginPath(); g.moveTo(c[0], c[1]); for (let i = 2; i < c.length; i += 2) g.lineTo(c[i], c[i + 1]); g.stroke(); }
    // route
    const si = Math.round(route.start / 10), fi = Math.round(route.finish / 10);
    g.lineCap = 'round'; g.lineJoin = 'round';
    g.strokeStyle = 'rgba(0,0,0,.6)'; g.lineWidth = 9 / sc; this.pathRange(g, si, fi); g.stroke();
    g.strokeStyle = '#ff3b2f'; g.lineWidth = 5 / sc; this.pathRange(g, si, fi); g.stroke();
    const dot = (s, col, r) => { const p = route.point(s, 0); g.fillStyle = col; g.beginPath(); g.arc(p.x, p.z, r / sc, 0, 7); g.fill(); g.strokeStyle = '#000'; g.lineWidth = 2 / sc; g.stroke(); };
    dot(route.start, '#fff', 7); dot(route.finish, '#ffc21a', 8);
    g.restore();
    // labels
    g.font = '800 15px "Barlow Condensed", sans-serif'; g.textBaseline = 'middle';
    const lab = (s, t, dx, col = '#fff') => { const p = route.point(s, 0); const x = ox + (p.x - x0) * sc, y = oz + (p.z - z0) * sc; g.fillStyle = 'rgba(8,10,14,.85)'; const w = g.measureText(t).width + 14; const lx = dx > 0 ? x + dx : x + dx - w; g.fillRect(lx, y - 11, w, 22); g.fillStyle = col; g.fillText(t, lx + 7, y + 1); };
    const mk = Object.fromEntries(data.marks.map((m) => [m.id, m.s]));
    // the district / sea labels belong to the Riviera map only; other maps (Megara, Penteli) just get start and finish
    const riviera = this.map.id === 'riviera';
    lab(route.start, 'START · ' + upperName(route.from), -14);
    if (riviera) { lab(mk.lake, 'LAKE', 14); lab(mk.limanakia, 'LIMANAKIA', -14); lab(mk.varkiza, 'VARKIZA', 14); }
    lab(route.finish, 'FINISH · ' + upperName(route.to), 14, '#ffc21a');
    g.fillStyle = 'rgba(255,255,255,.55)'; g.font = '700 11px "Barlow Condensed", sans-serif'; if (riviera) g.fillText('SARONIC GULF', 40, H * 0.72);
    g.fillText('MAP DATA © OPENSTREETMAP CONTRIBUTORS', 40, H - 18);
  }
  pathRange(g, i0, i1) { const p = this.rpts; g.beginPath(); g.moveTo(p[i0 * 2], p[i0 * 2 + 1]); for (let i = i0 + 1; i <= i1 && i * 2 < p.length; i++) g.lineTo(p[i * 2], p[i * 2 + 1]); }

  /** the event's start / finish (s0 > s1 for reverse events): route bar, km to go, minimap finish */
  setRange(s0, s1) {
    const { route, data } = this.map;
    this.r0 = s0; this.r1 = s1; this.raceLen = (s1 - s0) || 1;
    const ticks = this.el.rticks; ticks.innerHTML = '';
    for (const m of this.map.marks||data?.marks||[]) {
      const f = (m.s - s0) / this.raceLen; if (f < -1e-3 || f > 1 + 1e-3) continue;
      const t = document.createElement('div'); t.className = 't'; t.style.left = (f * 100) + '%'; ticks.appendChild(t);
      if (f > 0.02 && f < 0.98 || m.id === 'lomvarda' && s1 > s0) { const l = document.createElement('div'); l.className = 'l'; l.style.left = (f * 100) + '%'; l.textContent = m.name; ticks.appendChild(l); }
    }
    this.lastZone = null;
  }

  // ------------------------------------------------------------------ per-frame
  // DOM writes are cached: text and style are only touched when the visible value changes (a textContent or
  // width write every frame costs layout even when the string is identical). The analogue cluster redraws at
  // 30 Hz and the minimap at 15 Hz (30 Hz while expanded): both are low-frequency displays, and a still frame
  // is pixel-identical.
  update(st) {
    const el = this.el, { route } = this.map;
    this.frame++;
    // position + gap
    if (st.pos !== this.lastPos) { this.lastPos = st.pos; el.posN.textContent = st.pos; el.posSuf.textContent = ord(st.pos); el.posBox.classList.toggle('p1', st.pos === 1); }
    const tStr = fmtTime(st.time);
    if (tStr !== this._tRace) { this._tRace = tStr; el.tRace.textContent = tStr; }
    const g = st.gap; // + = we are behind
    const gapStr = !isFinite(g) ? '--' : (g >= 0 ? '+' : '−') + Math.abs(g).toFixed(2), gapCls = g < 0 ? 'ahead' : 'behind';
    if (gapStr !== this._gap) { this._gap = gapStr; el.gap.textContent = gapStr; }
    if (gapCls !== this._gapCls) { this._gapCls = gapCls; el.gap.className = gapCls; }
    // route (quantised to 0.1%: sub-pixel width/left writes never move anything on screen)
    const r0 = this.r0 ?? route.start, rl = this.raceLen;
    const f = clamp((st.s - r0) / rl, 0, 1), fr = clamp((st.rs - r0) / rl, 0, 1); // raceLen is signed for reverse events (setRange)
    const fq = Math.round(f * 1000), frq = Math.round(fr * 1000);
    if (fq !== this._rf) { this._rf = fq; el.rfill.style.width = (fq / 10) + '%'; el.rMe.style.left = (fq / 10) + '%'; }
    if (frq !== this._rr) { this._rr = frq; el.rRival.style.left = (frq / 10) + '%'; }
    if ((this.frame & 7) === 0) {
      const toGo = ((this.r1 ?? route.finish) - st.s) * Math.sign(rl) / (st.unit === 'MPH' ? 1609.344 : 1000);
      const toGoStr = `${Math.max(0, toGo).toFixed(1)} ${st.unit === 'MPH' ? 'MI' : 'KM'} TO FINISH`;
      if (toGoStr !== this._toGo) { this._toGo = toGoStr; el.rToGo.textContent = toGoStr; }
      const z = route.zone(st.s); if (z && z !== this.lastZone) { this.lastZone = z; el.rZone.textContent = z.name; el.mapLabel.textContent = z.name; }
      let rn = route.names[0]?.name || ''; for (const n of route.names) if (st.s >= n.s) rn = n.name;
      rn = upperName(rn).replace(/^LEOF\.? /, '').replace(/ AVENUE$/, ' AVE');
      if (rn !== this._rRoad) { this._rRoad = rn; el.rRoad.textContent = rn; }
    }
    if (st.pen !== this.penShown) { this.penShown = st.pen; el.penRow.classList.toggle('on', st.pen > 0); el.pen.textContent = '+' + st.pen.toFixed(1) + ' S'; }
    this.setLimit(st.limit, st.unit === 'MPH' ? st.kmh * 1.609344 : st.kmh);
    // Both displays redraw on a clock (the performance class sets the rates), not every n-th frame: at 30 fps a frame divisor
    // halved them again.
    const clock = performance.now(), rates = this.rates;
    if (clock - this._tachoAt >= 1000 / rates.tacho - 2) { this._tachoAt = clock; this.drawTacho(st); }
    if (clock - this._mapAt >= 1000 / (this.bigMap ? rates.mapBig : rates.map) - 2) { this._mapAt = clock; this.drawMinimap(this.mctx, this.mini.width, this.mini.height, st, this.bigMap ? 0.35 : 2.2); }
  }
  /** redraw rates (Hz) of the analogue cluster and the minimap: the performance class's HUD budget */
  setRates({ tacho = 30, map = 15, mapBig = 30 } = {}) { this.rates = { tacho, map, mapBig }; }
  /** M: the minimap grows into a wide-area map (about 0.8 km around you) so the other drivers are in view */
  toggleBigMap(on = !this.bigMap) {
    this.bigMap = on; this.mini.width = this.mini.height = on ? 640 : 300;
    this.mini.parentElement?.classList.toggle('is-big', on); return on;
  }

  drawMinimap(g, W, H, st, zoom = 2.2, nav = false) {
    if(this.map.route.isWorldRoute)return this.drawWorldMinimap(g,W,H,st,zoom);
    const { route, data } = this.map;
    const cx = W / 2, cy = H * (nav ? 0.62 : 0.6);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#081420'; g.fillRect(0, 0, W, H);
    const fx = -Math.sin(st.yaw), fz = -Math.cos(st.yaw);
    const rot = -Math.PI / 2 - Math.atan2(fz, fx);
    const sc = zoom * W / 300 * 0.5; // px per metre
    g.save();
    g.translate(cx, cy); g.rotate(rot); g.scale(sc, sc); g.translate(-st.x, -st.z);
    const t = this.map.terrain;
    g.imageSmoothingEnabled = true;
    g.drawImage(this.land, t.minX, t.minZ, t.GX * t.T, t.GZ * t.T);
    const R = (Math.hypot(W, H) / sc) * 0.6, C = this.CELL;
    const c0x = Math.floor((st.x - R) / C), c1x = Math.floor((st.x + R) / C), c0z = Math.floor((st.z - R) / C), c1z = Math.floor((st.z + R) / C);
    const cells = [];
    for (let i = c0x; i <= c1x; i++) for (let j = c0z; j <= c1z; j++) { const c = this.cells.get(i * 10007 + j); if (c) cells.push(c); }
    // streets
    g.lineCap = 'round';
    g.strokeStyle = 'rgba(96,108,122,.9)';
    for (const c of cells) for (const r of c.r) { if (r[5]) continue; g.lineWidth = Math.max(r[4], 2.5 / sc); g.beginPath(); g.moveTo(r[0], r[1]); g.lineTo(r[2], r[3]); g.stroke(); }
    // buildings
    g.fillStyle = 'rgba(128,140,154,.55)';
    for (const c of cells) for (const p of c.b) { g.beginPath(); g.moveTo(p[0], p[1]); for (let i = 2; i < p.length; i += 2) g.lineTo(p[i], p[i + 1]); g.fill(); }
    // coastline
    g.strokeStyle = 'rgba(110,200,255,.85)'; g.lineWidth = 1.6 / sc;
    for (const c of cells) for (const s of c.c) { g.beginPath(); g.moveTo(s[0], s[1]); g.lineTo(s[2], s[3]); g.stroke(); }
    // route: done (dim) + ahead (bright)
    // The route is drawn in the direction of travel: behind the car dim, ahead of it bright, whichever way the event runs
    // (reverse events count s downwards) and on whichever lap of a circuit (s is unwrapped there).
    const sw = route.closed ? route.wrap(st.s) : st.s, rev = this.r1 != null && this.r1 < this.r0, N = this.rpts.length / 2 - 1;
    const lo = Math.floor((sw - R) / 10), hi = Math.ceil((sw + R) / 10), ic = Math.round(sw / 10);
    // index ranges as pieces of the polyline; a circuit continues past its seam
    const stroke = (a, b) => {
      for (const k of route.closed ? [-1, 0, 1] : [0]) { const x = Math.max(0, a - k * N), y = Math.min(N, b - k * N); if (x <= y) { this.pathRange(g, x, y); g.stroke(); } }
    };
    const end = route.closed ? Infinity : rev ? Math.round(this.r1 / 10) : Math.round(route.finish / 10);
    g.lineJoin = 'round';
    // Free roam shows only the map and its streets (owner decision 2026-10-18): no route line, no finish, no signals or traffic dots.
    if (!st.free) {
      g.strokeStyle = 'rgba(0,0,0,.55)'; g.lineWidth = 16 / sc + 6; stroke(lo, hi);
      g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 9 / sc + 3; if (rev) stroke(ic, hi); else stroke(lo, ic);
      g.strokeStyle = '#ff3b2f'; g.lineWidth = 9 / sc + 3; if (rev) stroke(Math.max(lo, end), ic); else stroke(ic, Math.min(hi, end));
    }
    // finish
    const sFin = this.r1 ?? route.finish;
    if (!st.free && !st.objectiveMode && Math.abs(sFin - st.s) < R) {
      const p = route.point(sFin, 0); g.fillStyle = '#ffc21a'; g.beginPath(); g.arc(p.x, p.z, 9 / sc, 0, 7); g.fill(); g.strokeStyle = '#000'; g.lineWidth = 3 / sc; g.stroke();
    }
    // Driving missions show the actual pickup/dropoff instead of a race finish.
    if (st.objectiveTarget) {
      const p = st.objectiveTarget; g.fillStyle = p.phase === 'dropoff' ? '#62e9bf' : '#ffd34d';
      g.beginPath(); g.arc(p.x, p.z, 9 / sc, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#000'; g.lineWidth = 3 / sc; g.stroke();
    }
    // traffic lights
    if (st.junctions && !st.free) for (const j of st.junctions) {
      if (Math.abs(j.s - st.s) > R) continue;
      g.fillStyle = j.main === 'R' ? '#ff2a14' : j.main === 'A' ? '#ffb000' : '#22ff74'; g.strokeStyle = '#000'; g.lineWidth = 2.5 / sc;
      g.beginPath(); g.arc(j.x, j.z, 6.5 / sc, 0, 7); g.fill(); g.stroke();
    }
    // traffic dots
    if (st.traffic && !st.free) { g.fillStyle = 'rgba(255,255,255,.75)'; for (const c of st.traffic) { if (!c.active || c.cop || Math.abs(c.s - st.s) > R) continue; const p = route.point(c.s, c.u); g.fillRect(p.x - 2.2 / sc * 1.2, p.z - 2.2 / sc * 1.2, 4.4 / sc * 1.2, 4.4 / sc * 1.2); } }
    // police: bigger dots, flashing blue / red while their lights are on (src/police.js)
    if (st.traffic) for (const c of st.traffic) {
      if (!c.active || !c.cop || Math.abs(c.s - st.s) > R * 1.4) continue;
      const p = route.point(c.s, c.u), lit = c.cop.siren || c.cop.block, on = ((performance.now() / 160) | 0) % 2;
      g.fillStyle = lit ? (on ? '#2f7bff' : '#ff3340') : '#7fa8ff'; g.beginPath(); g.arc(p.x, p.z, 4.2 / sc * 1.2, 0, Math.PI * 2); g.fill();
    }
    // rival
    g.fillStyle = '#29d8ff'; g.strokeStyle = '#001018'; g.lineWidth = 3 / sc;
    // The spare rival is parked out of the way when nobody races (free roam, solo drives): no marker for it.
    const marked = st.remotes || (st.rx == null ? [] : [{ x: st.rx, z: st.rz }]);
    for (const p of marked) { g.beginPath(); g.arc(p.x, p.z, 8 / sc, 0, 7); g.fill(); g.stroke(); }
    g.restore();
    // player arrow
    g.save(); g.translate(cx, cy);
    g.fillStyle = '#fff'; g.strokeStyle = '#ff3b2f'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(0, -13); g.lineTo(9, 10); g.lineTo(0, 5); g.lineTo(-9, 10); g.closePath(); g.fill(); g.stroke();
    g.restore();
    // north marker on the rim (the map turns with the car)
    if (!nav) {
      const nx = Math.sin(rot), nz = -Math.cos(rot), rr = Math.min(cx, cy) - 16;
      g.fillStyle = 'rgba(8,10,14,.85)'; g.beginPath(); g.arc(cx + nx * rr, cy + nz * rr, 10, 0, 7); g.fill();
      g.fillStyle = '#ff3b2f'; g.font = '800 14px "Barlow Condensed", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('N', cx + nx * rr, cy + nz * rr + 1);
    }
    // rival off-map pointer
    if (st.rx == null && !st.remotes) return;
    const dx = st.rx - st.x, dz = st.rz - st.z;
    const px = (dx * Math.cos(rot) - dz * Math.sin(rot)) * sc, pz = (dx * Math.sin(rot) + dz * Math.cos(rot)) * sc;
    if (Math.abs(px) > cx - 10 || Math.abs(pz) > cy - 10 || pz > H - cy - 10) {
      const k = Math.min((cx - 14) / Math.abs(px || 1), (pz < 0 ? cy - 14 : H - cy - 14) / Math.abs(pz || 1));
      g.fillStyle = '#29d8ff'; g.beginPath(); g.arc(cx + px * k, cy + pz * k, 6, 0, 7); g.fill();
    }
  }

  /**
   * The analogue cluster. The dial face, the dim segments and the numbers depend only on the redline, so they are drawn
   * once into an offscreen layer; a frame draws that layer, the lit segments (one stroke per colour, not one per segment),
   * the gear box and the speed. Nothing is drawn when no visible value changed (the cluster key), which at a steady speed is
   * most frames. This was the single most expensive function of the sim step (about 7% of its CPU on a weak laptop).
   */
  tachoBase(W, H, cx, cy, R, max, red) {
    const key = `${W}x${H}|${max}|${red}|${this.fontsReady()}`;
    if (this._tachoBaseKey === key) return this._tachoBase;
    const layer = this._tachoBase || (this._tachoBase = document.createElement('canvas'));
    layer.width = W; layer.height = H; this._tachoBaseKey = key;
    const g = layer.getContext('2d'), a0 = Math.PI * 0.75, a1 = Math.PI * 2.25, span = a1 - a0, N = 46, redK = red / max;
    const grd = g.createRadialGradient(cx, cy, R * 0.2, cx, cy, R * 1.05);
    grd.addColorStop(0, 'rgba(14,17,22,.92)'); grd.addColorStop(0.85, 'rgba(8,10,14,.9)'); grd.addColorStop(1, 'rgba(8,10,14,0)');
    g.fillStyle = grd; g.beginPath(); g.arc(cx, cy, R * 1.05, 0, 7); g.fill();
    for (let i = 0; i < N; i++) {
      const f = i / N, a = a0 + span * f, b = a0 + span * (f + 0.8 / N);
      g.strokeStyle = f >= redK ? 'rgba(255,59,47,.25)' : 'rgba(255,255,255,.1)'; g.lineWidth = f >= redK ? 20 : 16;
      g.beginPath(); g.arc(cx, cy, R - 10, a, b); g.stroke();
    }
    g.fillStyle = 'rgba(255,255,255,.75)'; g.font = 'italic 800 19px "Barlow Condensed", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (let k = 0; k <= max / 1000; k++) { const a = a0 + span * (k * 1000 / max); g.fillText(String(k), cx + Math.cos(a) * (R - 38), cy + Math.sin(a) * (R - 38)); }
    return layer;
  }
  fontsReady() { return this._fonts ||= document.fonts?.check?.('800 19px "Barlow Condensed"') !== false; }
  drawTacho(st) {
    const g = this.tctx, W = this.tacho.width, H = this.tacho.height, cx = W / 2, cy = H / 2 + 4, R = W * 0.43;
    const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25, span = a1 - a0;
    const red = st.redline, max = Math.ceil(red * 1.08 / 1000) * 1000;
    const N = 46, kr = clamp(st.rpm / max, 0, 1), redK = red / max;
    const now = performance.now(), blink = st.rpm > red * 0.97 && Math.sin(now * 0.04) > 0;
    const cue = gearFeedback(st).upshift && Math.sin(now * 0.03) > 0, hot = st.shiftFlash > 0 || cue;
    let litN = 0; while (litN < N && litN / N < kr) litN++;
    const nitro = st.nitrous === true ? Math.round(clamp(st.nitro, 0, 1) * 200) : -1;
    const key = `${W}x${H}|${max}|${red}|${litN}|${blink}|${Math.round(st.kmh)}|${st.unit}|${st.damageLabel}|${nitro}|${!!st.nitroOn}|${hot}|${st.gearLabel}|${!!st.esc}|${!!st.tc}|${!!st.abs}|${!!st.aidsOff}|${!!st.manual}|${this.fontsReady()}`;
    if (key === this._tachoKey) return;
    this._tachoKey = key;
    g.clearRect(0, 0, W, H);
    g.drawImage(this.tachoBase(W, H, cx, cy, R, max, red), 0, 0);
    // lit segments: one path and one stroke per colour / width
    const lit = { white: [], amber: [], red: [] };
    for (let i = 0; i < litN; i++) { const f = i / N; (blink || f >= redK ? lit.red : f > redK - 0.12 ? lit.amber : lit.white).push(i); }
    for (const [name, col] of [['white', '#ffffff'], ['amber', '#ffc21a'], ['red', '#ff3b2f']]) {
      const list = lit[name]; if (!list.length) continue;
      g.strokeStyle = col; g.lineWidth = 16; g.beginPath();
      let wide = false;
      for (const i of list) {
        const f = i / N; if (f >= redK) { if (!wide) { g.stroke(); g.beginPath(); g.lineWidth = 20; wide = true; } }
        const a = a0 + span * f, b = a0 + span * (f + 0.8 / N);
        g.moveTo(cx + Math.cos(a) * (R - 10), cy + Math.sin(a) * (R - 10)); g.arc(cx, cy, R - 10, a, b);
      }
      g.stroke();
    }
    g.textAlign = 'center'; g.textBaseline = 'middle';
    if (st.nitrous === true) {
    // nitro arc in the bottom gap
    const n0 = Math.PI * 0.32, n1 = Math.PI * 0.68;
    g.lineWidth = 9; g.strokeStyle = 'rgba(41,216,255,.18)'; g.beginPath(); g.arc(cx, cy, R - 10, n1, n0, true); g.stroke();
    g.strokeStyle = st.nitroOn ? '#bff4ff' : '#29d8ff'; g.beginPath(); g.arc(cx, cy, R - 10, n1, n1 - (n1 - n0) * clamp(st.nitro, 0, 1), true); g.stroke();
    g.fillStyle = '#29d8ff'; g.font = '800 13px "Barlow Condensed", sans-serif'; g.fillText('NITRO', cx, cy + R - 30);
    }
    // speed
    g.fillStyle = '#fff'; g.font = 'italic 900 116px "Barlow Condensed", sans-serif'; g.textAlign = 'center';
    g.fillText(String(Math.round(st.kmh)), cx - 4, cy + 18);
    g.fillStyle = '#8f99a6'; g.font = '800 17px "Barlow Condensed", sans-serif'; g.fillText(st.unit || 'KM/H', cx, cy + 82);
    if (st.damageLabel) { g.fillStyle = '#ffb34a'; g.font = '800 13px sans-serif'; g.fillText(st.damageLabel, cx, cy + 57); }
    // gear box
    const gx = cx, gy = cy - 86;
    // the cluster is the only gear display: a manual-car upshift cue blinks the badge amber like a shift light
    g.fillStyle = hot ? '#ffc21a' : '#ff3b2f';
    g.beginPath(); g.moveTo(gx - 26, gy - 24); g.lineTo(gx + 34, gy - 24); g.lineTo(gx + 26, gy + 24); g.lineTo(gx - 34, gy + 24); g.closePath(); g.fill();
    g.fillStyle = hot ? '#07090c' : '#fff'; g.font = 'italic 900 44px "Barlow Condensed", sans-serif'; g.fillText(st.gearLabel, gx, gy + 3);
    // driver-aid lamps
    g.font = '800 15px "Barlow Condensed", sans-serif';
    for (const [txt, on, x, y] of [['ESC', st.esc, gx - 58, gy - 10], ['TC', st.tc, gx - 62, gy + 13], ['ABS', st.abs, gx + 62, gy + 13]]) { const off = st.aidsOff && txt !== 'ABS'; g.font = `${off ? '800 12px' : '800 15px'} "Barlow Condensed", sans-serif`; g.fillStyle = off || on ? '#ffb000' : 'rgba(255,255,255,.13)'; g.fillText(off ? txt + ' OFF' : txt, x, y); }
    // transmission mode (L toggles): MAN lights amber, AUTO stays dim beside the gear badge
    g.font = '800 18px "Barlow Condensed", sans-serif'; g.fillStyle = st.manual ? '#ffb000' : 'rgba(255,255,255,.72)'; g.fillText(st.manual ? 'MAN' : 'AUTO', gx + 62, gy - 10);
  }

  /** speed-limit sign: limit = {v, src} (km/h) or null; kmh = the car's speed in km/h. Over the limit the sign takes
   *  data-over for the held halo and data-flashing for a complete four-flash burst (style.css).
   *  Speed hunting around the hysteresis threshold must not cancel/restart an in-flight burst.
   *  Hysteresis (on above v + 3, off at v + 1 or below) keeps it from flickering at the threshold; the DOM is only
   *  touched when the limit or the over state changes. */
  setLimit(limit, kmh = 0) {
    const el = this.el;
    if (!el.limitSign || !el.limitV) return;
    const key = limit ? `${limit.v}|${limit.src || ''}` : '';
    if (key !== this.limitKey) {
      this.limitKey = key;
      el.limitSign.hidden = !limit;
      if (limit) {
        el.limitV.textContent = String(limit.v);
        if (limit.src) el.limitSign.dataset.src = limit.src; else delete el.limitSign.dataset.src;
      }
    }
    const over = !!limit && (this.limitOver ? kmh > limit.v + 1 : kmh > limit.v + 3);
    if (over !== !!this.limitOver) {
      this.limitOver = over; el.limitSign.toggleAttribute('data-over', over);
      if (over && !el.limitSign.hasAttribute('data-flashing') && !globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches) el.limitSign.setAttribute('data-flashing', '');
    }
    if (!limit) el.limitSign.removeAttribute('data-flashing');
  }
  finishLimitFlash(event) {
    if (event.animationName === 'limitFlash') this.el.limitSign.removeAttribute('data-flashing');
  }
  /** next traffic light widget: info = {main, d, wait} or null */
  signal(info) {
    const el = this.el;
    const key = info ? `${info.main}|${Math.round(info.d / 5)}|${info.wait ? 1 : 0}|${info.close ? 1 : 0}|${info.nitrous ? 1 : 0}` : '';
    if (key === this.sigKey) return; this.sigKey = key;
    if (!info) { el.sigBox.className = ''; return; }
    el.sigBox.className = 'on ' + info.main + (info.close ? ' close' : '');
    el.sigTxt.textContent = info.wait ? (info.nitrous ? 'WAIT · NITRO CHARGING' : 'WAIT') : info.main === 'R' ? (info.d < 60 ? 'STOP!' : 'RED LIGHT') : info.main === 'A' ? 'AMBER' : 'GREEN';
    el.sigD.textContent = info.d > 3 ? `SIGNAL ${Math.round(info.d / 5) * 5} M` : 'STOP LINE';
  }

  // ------------------------------------------------------------------ messages
  pop(cls, text, sub = '', rot = 0) {
    const tone=cls.includes('bad')?'bad':cls.includes('good')?'good':'info';
    notifications.post({title:text,text:sub,tone,priority:tone==='bad'?65:30,ms:2400,staleAfter:7000});
  }
  banner(title, sub) { notifications.post({title,text:sub,priority:15,ms:2600,staleAfter:6000}); }
  count(text, go = false) {
    const c = this.el.count; c.textContent = text; c.className = ''; void c.offsetWidth; c.className = go ? 'go' : 'tick';
  }
  message(html, dur = 2.5) { notifications.toast(html,{ms:dur*1000,priority:40}); }
  // ------------------------------------------------------------------ menu
  showMenu(mode, info) {
    const el = this.el; el.menu.className = mode + (info.win === true ? ' win' : info.win === false ? ' lose' : '');
    el.mKick.textContent = info.kick; el.mTitle.textContent = info.title; el.mSub.innerHTML = info.sub || '';
    el.mTable.innerHTML = (info.rows || []).map(([k, v, nb]) => `<div><span>${k}</span><b class="${nb ? 'nb' : ''}">${v}</b></div>`).join('');
    document.body.classList.add('menu');
  }
  hideMenu() { document.body.classList.remove('menu'); }
  showCar(cars, idx, best) {
    const el = this.el, c = cars[idx];
    el.cIdx.textContent = `${idx + 1}/${cars.length}`;
    el.cName.textContent = c.name; el.cName.classList.remove('flip'); void el.cName.offsetWidth; el.cName.classList.add('flip');
    el.cTag.textContent = c.tag.toUpperCase();
    el.cSpecs.innerHTML = `<div><span>POWER</span><b>${Math.round(c.power * 1.341)} HP</b></div><div><span>TOP SPEED</span><b>${c.vmax}</b></div><div><span>WEIGHT</span><b>${c.mass} KG</b></div><div class="wide"><span>LAYOUT</span><b>${c.drive.toUpperCase()} · ${{ turbo3: 'TURBO I3', na4: 'TWIN-CAM I4', turbo4: 'TURBO I4', turbo5: 'TURBO I5', turbo6: 'TURBO I6', flat6: 'FLAT-SIX', v12: 'V12', diesel: 'TURBO DIESEL' }[c.engine] || ''} · ${c.gears.length}-SPEED</b></div>`;
    el.cStats.innerHTML = [['SPEED', c.stats.speed], ['ACCEL', c.stats.accel], ['HANDLING', c.stats.handling], ['DRIFT', c.stats.drift]].map(([k, v]) => `<div class="stat">${k}<div class="bar"><i style="width:${Math.round(v * 100)}%"></i></div></div>`).join('');
    el.cBest.textContent = best ? `PERSONAL BEST  ${fmtTime(best)}` : 'NO TIME SET YET';
    this.showPaint(c);
  }
  showPaint(spec) {
    if(!this.paintPanel){
      this.paintPanel=document.createElement('div');this.paintPanel.id='carPaint';
      this.paintPanel.style.cssText='margin:12px 0;display:flex;gap:7px;align-items:center;flex-wrap:wrap;pointer-events:auto';
      this.el.cBest.before(this.paintPanel);
      // Garage hotkeys must not consume arrows/space inside colour controls.
      this.paintPanel.addEventListener('keydown',e=>{if(e.key==='Escape'){e.target.blur?.();return;}e.stopPropagation();});
      this.paintPanel.addEventListener('keyup',e=>e.stopPropagation());
    }
    const panel=this.paintPanel;panel.replaceChildren();
    const caption=document.createElement('span');caption.textContent='PAINT';caption.style.cssText='font-size:11px;letter-spacing:.15em;margin-right:5px';panel.append(caption);
    const name=document.createElement('span');name.style.cssText='flex-basis:100%;font-size:11px;color:#a6b8c4';
    const picker=document.createElement('input');picker.type='color';picker.value=savedPaint(spec);picker.setAttribute('aria-label','Custom paint colour');picker.title='Custom paint colour';picker.style.cssText='width:33px;height:28px;padding:0;border:1px solid #78858d;background:transparent;';
    const buttons=[];
    const refresh=color=>{picker.value=color;name.textContent=PAINTS[spec.id]?.find(p=>p[1]===color)?.[0]||'Custom '+color.toUpperCase();for(const [b,hex]of buttons){const on=hex===color;b.setAttribute('aria-pressed',String(on));b.innerHTML=on?icon('check', 'ico--paint-check'):'';b.style.color='#fff';b.style.textShadow='0 1px 3px #000';}};
    const apply=color=>{if(savePaint(spec.id,color)){refresh(color.toLowerCase());this.onPaint?.(spec.id,color);}};
    for(const [label,color]of PAINTS[spec.id]||[]){const b=document.createElement('button');b.type='button';b.title=label;b.setAttribute('aria-label',label);b.style.cssText=`width:26px;height:26px;min-width:26px;padding:0;border:1px solid #87939d;border-radius:50%;background:${color};`;b.onclick=()=>{apply(color);b.blur();};buttons.push([b,color]);panel.append(b);}
    picker.addEventListener('input',()=>apply(picker.value));picker.addEventListener('change',()=>picker.blur());panel.append(picker,name);refresh(savedPaint(spec));
  }
}
