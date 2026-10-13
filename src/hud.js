// DOM HUD: position / timing / rival gap, route progress, style combos, real-map minimap (OSM coastline,
// buildings, streets, the route), tachometer + speedometer, popups, district banners, countdown and menus.
import { clamp } from './util.js';
import { PAINTS, savedPaint, savePaint } from './vehicle-paint.js';

const $ = (id) => document.getElementById(id);
export const fmtTime = (t) => { if (!isFinite(t)) return '--:--.--'; const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s < 10 ? '0' : ''}${s.toFixed(2)}`; };
const ord = (n) => (n === 1 ? 'ST' : n === 2 ? 'ND' : n === 3 ? 'RD' : 'TH');

export class Hud {
  constructor(map) {
    this.map = map; const { route, data, terrain } = map;
    this.el = {}; for (const id of ['posBox', 'posN', 'posSuf', 'tRace', 'gap', 'rivalName', 'rZone', 'rRoad', 'rToGo', 'rfill', 'rticks', 'rRival', 'rMe', 'style', 'combo', 'mapLabel', 'pops', 'banner', 'count', 'msg', 'menu', 'penRow', 'pen', 'sigBox', 'sigTxt', 'sigD', 'mKick', 'mTitle', 'mSub', 'mTable', 'cIdx', 'cName', 'cTag', 'cSpecs', 'cStats', 'cBest']) this.el[id] = $(id);
    this.mini = $('minimap'); this.mctx = this.mini.getContext('2d');
    this.tacho = $('tacho'); this.tctx = this.tacho.getContext('2d');
    this.raceLen = route.finish - route.start;
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
    for (const r of data.sideRoads) { const p = r.p; for (let i = 0; i + 3 < p.length; i += 2) put((p[i] + p[i + 2]) / 2, (p[i + 1] + p[i + 3]) / 2, 'r', [p[i], p[i + 1], p[i + 2], p[i + 3], r.w, r.f]); }
    for (const c of data.coast) for (let i = 0; i + 3 < c.length; i += 2) put(c[i], c[i + 1], 'c', [c[i], c[i + 1], c[i + 2], c[i + 3]]);
    // route polyline (10 m)
    this.rpts = []; for (let s = 0; s <= route.length; s += 10) { const i = Math.round(s / route.step); this.rpts.push(route.X[Math.min(route.N - 1, i)], route.Z[Math.min(route.N - 1, i)]); }
    // ---- route bar ticks
    const ticks = this.el.rticks; let alt = 0;
    for (const m of data.marks) {
      const f = (m.s - route.start) / this.raceLen; if (f < 0 || f > 1) continue;
      const t = document.createElement('div'); t.className = 't'; t.style.left = (f * 100) + '%'; ticks.appendChild(t);
      if (['lake', 'limanakia', 'varkiza', 'lomvarda'].includes(m.id)) { const l = document.createElement('div'); l.className = 'l'; l.style.left = (f * 100) + '%'; l.textContent = m.name; if (alt++ % 2 && false) l.style.top = '28px'; ticks.appendChild(l); }
    }
    this.frame = 0; this.lastZone = null; this.lastPos = 0;
    this.styleShown = 0;
  }

  // ------------------------------------------------------------------ overview (title screen)
  drawOverview(canvas) {
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
    lab(route.start, 'START · ' + route.from.toUpperCase(), -14); lab(mk.lake, 'LAKE', 14); lab(mk.limanakia, 'LIMANAKIA', -14); lab(mk.varkiza, 'VARKIZA', 14); lab(route.finish, 'FINISH · ' + route.to.toUpperCase(), 14, '#ffc21a');
    g.fillStyle = 'rgba(255,255,255,.55)'; g.font = '700 11px "Barlow Condensed", sans-serif'; g.fillText('SARONIC GULF', 40, H * 0.72);
    g.fillText('MAP DATA © OPENSTREETMAP CONTRIBUTORS', 40, H - 18);
  }
  pathRange(g, i0, i1) { const p = this.rpts; g.beginPath(); g.moveTo(p[i0 * 2], p[i0 * 2 + 1]); for (let i = i0 + 1; i <= i1 && i * 2 < p.length; i++) g.lineTo(p[i * 2], p[i * 2 + 1]); }

  /** the event's start / finish (s0 > s1 for reverse events): route bar, km to go, minimap finish */
  setRange(s0, s1) {
    const { route, data } = this.map;
    this.r0 = s0; this.r1 = s1; this.raceLen = (s1 - s0) || 1;
    const ticks = this.el.rticks; ticks.innerHTML = '';
    for (const m of data.marks) {
      const f = (m.s - s0) / this.raceLen; if (f < -1e-3 || f > 1 + 1e-3) continue;
      const t = document.createElement('div'); t.className = 't'; t.style.left = (f * 100) + '%'; ticks.appendChild(t);
      if (f > 0.02 && f < 0.98 || m.id === 'lomvarda' && s1 > s0) { const l = document.createElement('div'); l.className = 'l'; l.style.left = (f * 100) + '%'; l.textContent = m.name; ticks.appendChild(l); }
    }
    this.lastZone = null;
  }

  // ------------------------------------------------------------------ per-frame
  update(st) {
    const el = this.el, { route } = this.map;
    this.frame++;
    // position + gap
    if (st.pos !== this.lastPos) { this.lastPos = st.pos; el.posN.textContent = st.pos; el.posSuf.textContent = ord(st.pos); el.posBox.classList.toggle('p1', st.pos === 1); }
    el.tRace.textContent = fmtTime(st.time);
    const g = st.gap; // + = we are behind
    el.gap.textContent = !isFinite(g) ? '--' : (g >= 0 ? '+' : '−') + Math.abs(g).toFixed(2);
    el.gap.className = g < 0 ? 'ahead' : 'behind';
    // route
    const r0 = this.r0 ?? route.start, rl = this.raceLen;
    const f = clamp((st.s - r0) / rl, 0, 1), fr = clamp((st.rs - r0) / rl, 0, 1); // raceLen is signed for reverse events (setRange)
    el.rfill.style.width = (f * 100) + '%'; el.rMe.style.left = (f * 100) + '%'; el.rRival.style.left = (fr * 100) + '%';
    if ((this.frame & 7) === 0) {
      const toGo = ((this.r1 ?? route.finish) - st.s) * Math.sign(rl) / (st.unit === 'MPH' ? 1609.344 : 1000);
      el.rToGo.textContent = `${Math.max(0, toGo).toFixed(1)} ${st.unit === 'MPH' ? 'MI' : 'KM'} TO FINISH`;
      const z = route.zone(st.s); if (z && z !== this.lastZone) { this.lastZone = z; el.rZone.textContent = z.name; el.mapLabel.textContent = z.name; }
      let rn = route.names[0]?.name || ''; for (const n of route.names) if (st.s >= n.s) rn = n.name; el.rRoad.textContent = rn.toUpperCase().replace(/^LEOF\.? /, '').replace(/ AVENUE$/, ' AVE');
    }
    // style
    if (Math.abs(st.style - this.styleShown) > 0.5) { this.styleShown += (st.style - this.styleShown) * 0.2; if (Math.abs(st.style - this.styleShown) < 2) this.styleShown = st.style; el.style.textContent = Math.round(this.styleShown).toLocaleString('en-US'); }
    if (st.combo > 1) { el.combo.textContent = `COMBO ×${st.combo}`; el.combo.classList.add('on'); } else el.combo.classList.remove('on');
    if (st.pen !== this.penShown) { this.penShown = st.pen; el.penRow.classList.toggle('on', st.pen > 0); el.pen.textContent = '+' + st.pen.toFixed(1) + ' S'; }
    this.drawTacho(st);
    if ((this.frame & 1) === 0) this.drawMinimap(this.mctx, this.mini.width, this.mini.height, st, 2.2);
  }

  drawMinimap(g, W, H, st, zoom = 2.2, nav = false) {
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
    const i0 = Math.max(0, Math.floor((st.s - R) / 10)), i1 = Math.min(this.rpts.length / 2 - 1, Math.ceil((st.s + R) / 10));
    const ic = Math.round(st.s / 10), fi = Math.round(route.finish / 10);
    g.lineJoin = 'round';
    g.strokeStyle = 'rgba(0,0,0,.55)'; g.lineWidth = 16 / sc + 6; this.pathRange(g, i0, i1); g.stroke();
    g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 9 / sc + 3; this.pathRange(g, i0, Math.min(ic, i1)); g.stroke();
    g.strokeStyle = '#ff3b2f'; g.lineWidth = 9 / sc + 3; this.pathRange(g, Math.max(i0, ic), Math.min(i1, fi)); g.stroke();
    // finish
    const sFin = this.r1 ?? route.finish;
    if (Math.abs(sFin - st.s) < R) {
      const p = route.point(sFin, 0); g.fillStyle = '#ffc21a'; g.beginPath(); g.arc(p.x, p.z, 9 / sc, 0, 7); g.fill(); g.strokeStyle = '#000'; g.lineWidth = 3 / sc; g.stroke();
    }
    // traffic lights
    if (st.junctions) for (const j of st.junctions) {
      if (Math.abs(j.s - st.s) > R) continue;
      g.fillStyle = j.main === 'R' ? '#ff2a14' : j.main === 'A' ? '#ffb000' : '#22ff74'; g.strokeStyle = '#000'; g.lineWidth = 2.5 / sc;
      g.beginPath(); g.arc(j.x, j.z, 6.5 / sc, 0, 7); g.fill(); g.stroke();
    }
    // traffic dots
    if (st.traffic) { g.fillStyle = 'rgba(255,255,255,.75)'; for (const c of st.traffic) { if (!c.active || c.cop || Math.abs(c.s - st.s) > R) continue; const p = route.point(c.s, c.u); g.fillRect(p.x - 2.2 / sc * 1.2, p.z - 2.2 / sc * 1.2, 4.4 / sc * 1.2, 4.4 / sc * 1.2); } }
    // police: bigger dots, flashing blue / red while their lights are on (src/police.js)
    if (st.traffic) for (const c of st.traffic) {
      if (!c.active || !c.cop || Math.abs(c.s - st.s) > R * 1.4) continue;
      const p = route.point(c.s, c.u), lit = c.cop.siren || c.cop.block, on = ((performance.now() / 160) | 0) % 2;
      g.fillStyle = lit ? (on ? '#2f7bff' : '#ff3340') : '#7fa8ff'; g.beginPath(); g.arc(p.x, p.z, 4.2 / sc * 1.2, 0, Math.PI * 2); g.fill();
    }
    // rival
    g.fillStyle = '#29d8ff'; g.strokeStyle = '#001018'; g.lineWidth = 3 / sc;
    for (const p of st.remotes || [{ x: st.rx, z: st.rz }]) { g.beginPath(); g.arc(p.x, p.z, 8 / sc, 0, 7); g.fill(); g.stroke(); }
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
    const dx = st.rx - st.x, dz = st.rz - st.z;
    const px = (dx * Math.cos(rot) - dz * Math.sin(rot)) * sc, pz = (dx * Math.sin(rot) + dz * Math.cos(rot)) * sc;
    if (Math.abs(px) > cx - 10 || Math.abs(pz) > cy - 10 || pz > H - cy - 10) {
      const k = Math.min((cx - 14) / Math.abs(px || 1), (pz < 0 ? cy - 14 : H - cy - 14) / Math.abs(pz || 1));
      g.fillStyle = '#29d8ff'; g.beginPath(); g.arc(cx + px * k, cy + pz * k, 6, 0, 7); g.fill();
    }
  }

  drawTacho(st) {
    const g = this.tctx, W = this.tacho.width, H = this.tacho.height, cx = W / 2, cy = H / 2 + 4, R = W * 0.43;
    g.clearRect(0, 0, W, H);
    const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25, span = a1 - a0;
    const red = st.redline, max = Math.ceil(red * 1.08 / 1000) * 1000;
    // dial face
    const grd = g.createRadialGradient(cx, cy, R * 0.2, cx, cy, R * 1.05);
    grd.addColorStop(0, 'rgba(14,17,22,.92)'); grd.addColorStop(0.85, 'rgba(8,10,14,.9)'); grd.addColorStop(1, 'rgba(8,10,14,0)');
    g.fillStyle = grd; g.beginPath(); g.arc(cx, cy, R * 1.05, 0, 7); g.fill();
    // segments
    const N = 46, kr = clamp(st.rpm / max, 0, 1), redK = red / max;
    for (let i = 0; i < N; i++) {
      const f = i / N, a = a0 + span * f, b = a0 + span * (f + 0.8 / N);
      const lit = f < kr;
      let col = f >= redK ? (lit ? '#ff3b2f' : 'rgba(255,59,47,.25)') : (lit ? (f > redK - 0.12 ? '#ffc21a' : '#ffffff') : 'rgba(255,255,255,.1)');
      if (lit && st.rpm > red * 0.97 && Math.sin(performance.now() * 0.04) > 0) col = '#ff3b2f';
      g.strokeStyle = col; g.lineWidth = f >= redK ? 20 : 16;
      g.beginPath(); g.arc(cx, cy, R - 10, a, b); g.stroke();
    }
    // numbers
    g.fillStyle = 'rgba(255,255,255,.75)'; g.font = 'italic 800 19px "Barlow Condensed", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (let k = 0; k <= max / 1000; k++) { const a = a0 + span * (k * 1000 / max); g.fillText(String(k), cx + Math.cos(a) * (R - 38), cy + Math.sin(a) * (R - 38)); }
    // nitro arc in the bottom gap
    const n0 = Math.PI * 0.32, n1 = Math.PI * 0.68;
    g.lineWidth = 9; g.strokeStyle = 'rgba(41,216,255,.18)'; g.beginPath(); g.arc(cx, cy, R - 10, n1, n0, true); g.stroke();
    g.strokeStyle = st.nitroOn ? '#bff4ff' : '#29d8ff'; g.beginPath(); g.arc(cx, cy, R - 10, n1, n1 - (n1 - n0) * clamp(st.nitro, 0, 1), true); g.stroke();
    g.fillStyle = '#29d8ff'; g.font = '800 13px "Barlow Condensed", sans-serif'; g.fillText('NITRO', cx, cy + R - 30);
    // speed
    g.fillStyle = '#fff'; g.font = 'italic 900 116px "Barlow Condensed", sans-serif'; g.textAlign = 'center';
    g.fillText(String(Math.round(st.kmh)), cx - 4, cy + 18);
    g.fillStyle = '#8f99a6'; g.font = '800 17px "Barlow Condensed", sans-serif'; g.fillText(st.unit || 'KM/H', cx, cy + 82);
    if (st.damageLabel) { g.fillStyle = '#ffb34a'; g.font = '800 13px sans-serif'; g.fillText(st.damageLabel, cx, cy + 57); }
    // gear box
    const gx = cx, gy = cy - 86;
    g.fillStyle = st.shiftFlash > 0 ? '#ffc21a' : '#ff3b2f';
    g.beginPath(); g.moveTo(gx - 26, gy - 24); g.lineTo(gx + 34, gy - 24); g.lineTo(gx + 26, gy + 24); g.lineTo(gx - 34, gy + 24); g.closePath(); g.fill();
    g.fillStyle = st.shiftFlash > 0 ? '#07090c' : '#fff'; g.font = 'italic 900 44px "Barlow Condensed", sans-serif'; g.fillText(st.gearLabel, gx, gy + 3);
    // driver-aid lamps
    g.font = '800 15px "Barlow Condensed", sans-serif';
    for (const [txt, on, x, y] of [['ESC', st.esc, gx - 58, gy - 10], ['TC', st.tc, gx - 62, gy + 13], ['ABS', st.abs, gx + 62, gy + 2]]) { g.fillStyle = on ? '#ffb000' : 'rgba(255,255,255,.13)'; g.fillText(txt, x, y); }
    if (st.draft > 0.2) { g.fillStyle = '#29d8ff'; g.font = '800 14px "Barlow Condensed", sans-serif'; g.fillText('SLIPSTREAM', cx, cy + 108); }
  }

  /** next traffic light widget: info = {main, d, wait} or null */
  signal(info) {
    const el = this.el;
    const key = info ? `${info.main}|${Math.round(info.d / 5)}|${info.wait ? 1 : 0}|${info.close ? 1 : 0}` : '';
    if (key === this.sigKey) return; this.sigKey = key;
    if (!info) { el.sigBox.className = ''; return; }
    el.sigBox.className = 'on ' + info.main + (info.close ? ' close' : '');
    el.sigTxt.textContent = info.wait ? 'WAIT · NITRO CHARGING' : info.main === 'R' ? (info.d < 60 ? 'STOP!' : 'RED LIGHT') : info.main === 'A' ? 'AMBER' : 'GREEN';
    el.sigD.textContent = info.d > 3 ? `SIGNAL ${Math.round(info.d / 5) * 5} M` : 'STOP LINE';
  }
  flashCam() { const f = document.getElementById('camflash'); f.classList.remove('on'); void f.offsetWidth; f.classList.add('on'); }

  // ------------------------------------------------------------------ messages
  pop(cls, text, sub = '', rot = 0) {
    const d = document.createElement('div'); d.className = 'pop ' + cls;
    d.innerHTML = `${text}${sub ? `<small>${sub}</small>` : ''}`;
    if (rot) d.style.rotate = rot + 'deg';
    this.el.pops.appendChild(d);
    setTimeout(() => d.remove(), 1400);
  }
  banner(title, sub) {
    const b = this.el.banner; b.querySelector('.b1').textContent = title; b.querySelector('.b2').textContent = sub;
    b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
  }
  count(text, go = false) {
    const c = this.el.count; c.textContent = text; c.className = ''; void c.offsetWidth; c.className = go ? 'go' : 'tick';
  }
  message(html, dur = 2.5) {
    const m = this.el.msg; m.innerHTML = html; m.classList.add('on');
    clearTimeout(this._mt); this._mt = setTimeout(() => m.classList.remove('on'), dur * 1000);
  }
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
    el.cSpecs.innerHTML = `<div><span>POWER</span><b>${Math.round(c.power * 1.341)} HP</b></div><div><span>TOP SPEED</span><b>${c.vmax}</b></div><div><span>WEIGHT</span><b>${c.mass} KG</b></div><div class="wide"><span>LAYOUT</span><b>${c.drive.toUpperCase()} · ${{ turbo3: 'TURBO I3', na4: 'TWIN-CAM I4', turbo4: 'TURBO I4', turbo5: 'TURBO I5', turbo6: 'TURBO I6', flat6: 'FLAT-SIX', v12: 'V12', diesel: 'TURBO DIESEL' }[c.engine] || ''} · ${c.gears.length}-SPEED ${c.transmission === 'manual' ? 'MANUAL' : 'AUTO'}</b></div>`;
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
    const picker=document.createElement('input');picker.type='color';picker.value=savedPaint(spec);picker.setAttribute('aria-label','Custom paint colour');picker.title='Custom paint colour';picker.style.cssText='width:33px;height:28px;padding:0;border:1px solid #78858d;background:transparent;cursor:pointer';
    const buttons=[];
    const refresh=color=>{picker.value=color;name.textContent=PAINTS[spec.id]?.find(p=>p[1]===color)?.[0]||'Custom '+color.toUpperCase();for(const [b,hex]of buttons){const on=hex===color;b.setAttribute('aria-pressed',String(on));b.style.outline=on?'2px solid #edf4ff':'none';b.style.outlineOffset='2px';}};
    const apply=color=>{if(savePaint(spec.id,color)){refresh(color.toLowerCase());this.onPaint?.(spec.id,color);}};
    for(const [label,color]of PAINTS[spec.id]||[]){const b=document.createElement('button');b.type='button';b.title=label;b.setAttribute('aria-label',label);b.style.cssText=`width:26px;height:26px;min-width:26px;padding:0;border:1px solid #87939d;border-radius:50%;background:${color};cursor:pointer`;b.onclick=()=>{apply(color);b.blur();};buttons.push([b,color]);panel.append(b);}
    picker.addEventListener('input',()=>apply(picker.value));picker.addEventListener('change',()=>picker.blur());panel.append(picker,name);refresh(savedPaint(spec));
  }
}
