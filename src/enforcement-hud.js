// ENFORCEMENT HUD — compact in-game phone-style fine notifications + history,
// and a minimap camera-icon helper. Own DOM and styles; never touches
// src/hud.js or src/police-hud.js. Reads FineLedger entries from
// src/enforcement.js. NOT real SMS/email/payment: a game menu styled like a
// phone notification. Default: a brief toast per fine; the history list stays
// hidden behind its toggle so the HUD stays uncluttered (aids owner).
//
// Minimap hook (for the hud.js owner — 3 lines, NOT applied by this module):
//   import { drawCameraIcons } from './enforcement-hud.js';
//   ... inside drawMini, after the junctions block, same transform:
//   drawCameraIcons(g, route, st.cameras || [], 6.5 / sc);

const CSS = `
#fine-phone{position:fixed;right:14px;bottom:120px;z-index:32;pointer-events:none;display:flex;flex-direction:column;gap:6px;align-items:flex-end}
.fine-toast{pointer-events:auto;display:flex;gap:8px;align-items:center;max-width:280px;background:rgba(10,14,20,.92);border:1px solid rgba(255,255,255,.14);border-left:4px solid #ffb000;border-radius:10px;padding:8px 10px;color:#fff;font:600 13px/1.35 system-ui,sans-serif;box-shadow:0 4px 14px rgba(0,0,0,.5);animation:fine-in .25s ease-out}
.fine-toast.red{border-left-color:#ff3b2f}.fine-toast.capture{border-left-color:#2f7bff}
.fine-toast b{display:block;font-size:12px;letter-spacing:.08em;color:#ffb000}
.fine-toast.red b{color:#ff6b5e}.fine-toast.capture b{color:#7fa8ff}
.fine-toast small{color:#aeb6c2}
@keyframes fine-in{from{transform:translateX(20px);opacity:0}to{transform:none;opacity:1}}
#fine-hist{pointer-events:auto;width:280px;max-height:220px;overflow:auto;display:none;background:rgba(10,14,20,.94);border:1px solid rgba(255,255,255,.14);border-radius:10px;padding:8px 10px;color:#fff;font:600 12px/1.5 system-ui,sans-serif}
#fine-hist.open{display:block}
#fine-hist h4{margin:0 0 4px;font-size:11px;letter-spacing:.12em;color:#8f99a6}
#fine-hist .row{display:flex;justify-content:space-between;border-top:1px solid rgba(255,255,255,.08);padding:3px 0}
#fine-hist .row span:last-child{color:#ffb000}
#fine-histBtn{pointer-events:auto;background:rgba(10,14,20,.85);border:1px solid rgba(255,255,255,.16);border-radius:8px;color:#cfd6df;font:700 11px/1 system-ui,sans-serif;letter-spacing:.1em;padding:7px 10px;cursor:pointer}
body.racing #fine-phone{display:flex}#fine-phone{display:none}
`;

/** Draw fixed-camera icons on the minimap canvas (call inside drawMini's transform). */
export function drawCameraIcons(g, route, cameras, r = 6) {
  for (const c of cameras || []) {
    let p;
    try { p = route.point(c.s, c.u || 0); } catch { continue; }
    g.save();
    g.translate(p.x, p.z);
    g.rotate(Math.PI / 4);
    g.fillStyle = '#ffb000'; g.strokeStyle = '#000'; g.lineWidth = Math.max(1, r * 0.3);
    const w = r * 0.9;
    g.beginPath(); g.rect(-w / 2, -w / 2, w, w); g.fill(); g.stroke();
    g.restore();
    g.fillStyle = '#000';
    g.beginPath(); g.arc(p.x, p.z, r * 0.22, 0, Math.PI * 2); g.fill();
  }
}

export class FinePhone {
  constructor() {
    if (typeof document === 'undefined') return;
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    const el = this.el = document.createElement('div'); el.id = 'fine-phone';
    el.innerHTML = `<div id="fine-hist"><h4>FINES · GAME TIME ONLY</h4><div class="rows"></div></div><button id="fine-histBtn" type="button">FINES · 0</button>`;
    document.body.appendChild(el);
    this.rows = el.querySelector('#fine-hist .rows');
    this.btn = el.querySelector('#fine-histBtn');
    this.hist = el.querySelector('#fine-hist');
    this.btn.addEventListener('click', () => this.hist.classList.toggle('open'));
    this.count = 0;
  }
  reset() {
    this.count = 0;
    if (!this.el) return;
    this.rows.innerHTML = ''; this.hist.classList.remove('open');
    this.btn.textContent = 'FINES · 0';
  }
  /** show a phone-style toast for a ledger entry { kind, label, penaltySec, site } */
  notify(entry) {
    if (!this.el || !entry) return;
    this.count++;
    this.btn.textContent = `FINES · ${this.count}`;
    const cls = entry.kind === 'red' ? 'red' : entry.kind === 'capture' ? 'capture' : '';
    const d = document.createElement('div');
    d.className = `fine-toast ${cls}`.trim();
    const title = entry.kind === 'red' ? 'RED LIGHT' : entry.kind === 'capture' ? 'POLICE STOP' : 'SPEED CAMERA';
    d.innerHTML = `<div><b>${title}</b>${entry.label}<br><small>+${entry.penaltySec.toFixed(1)} S · game time, not a real fine</small></div>`;
    this.el.insertBefore(d, this.hist);
    setTimeout(() => d.remove(), 3200);
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = `<span>${title} · ${entry.label}</span><span>+${entry.penaltySec.toFixed(1)}s</span>`;
    this.rows.appendChild(row);
  }
}
