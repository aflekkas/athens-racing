import { gearFeedback } from './transmission.js';

// UI owner: restyle #gearboxHud, .gearbox-gear, .gearbox-mode, .gearbox-revs,
// .gearbox-upshift and [data-band]/[data-limiter]. Keep these DOM hooks and semantics.
export class GearboxHud {
  constructor(parent) {
    const el = this.element = document.createElement('div'); el.id = 'gearboxHud';
    el.innerHTML = '<span class="gearbox-mode">AUTO</span><strong class="gearbox-gear" aria-label="Current gear">1</strong><div class="gearbox-revs" role="meter" aria-label="Engine revs" aria-valuemin="0" aria-valuemax="100"><i></i></div><span class="gearbox-upshift" hidden>UPSHIFT ↑</span>';
    parent.append(el);
    this.mode = el.querySelector('.gearbox-mode'); this.gear = el.querySelector('.gearbox-gear');
    this.revs = el.querySelector('.gearbox-revs'); this.fill = this.revs.firstElementChild;
    this.cue = el.querySelector('.gearbox-upshift');
    const style = document.createElement('style'); style.textContent = `
      #gearboxHud { position:absolute; left:-64px; bottom:34px; width:92px; padding:8px; border:1px solid #ffffff45; border-radius:6px; background:#0c121be8; color:white; text-align:center; font:700 11px system-ui; pointer-events:none; }
      .gearbox-mode { display:block; letter-spacing:.08em; }
      .gearbox-gear { display:block; font-size:48px; line-height:1.05; }
      .gearbox-revs { height:6px; margin:7px 0; background:#ffffff20; border-radius:3px; overflow:hidden; }
      .gearbox-revs i { display:block; height:100%; background:#6de19c; }
      #gearboxHud[data-band="yellow"] .gearbox-revs i { background:#ffd064; }
      #gearboxHud[data-band="red"] .gearbox-revs i { background:#ff655e; }
      #gearboxHud[data-limiter="true"] .gearbox-revs { animation:gearbox-limit .16s steps(2,end) infinite; }
      .gearbox-upshift { display:block; color:#ffd064; font-size:10px; white-space:nowrap; }
      .gearbox-upshift[hidden] { display:none; }
      @keyframes gearbox-limit { to { opacity:.25; } }
      @media (prefers-reduced-motion:reduce) { #gearboxHud[data-limiter="true"] .gearbox-revs { animation:none; box-shadow:0 0 8px #ff655e; } }
    `; document.head.append(style);
  }
  update(st) {
    const f = gearFeedback(st);
    this.gear.textContent = st.gearLabel || 'N'; this.mode.textContent = st.manual ? 'MANUAL' : 'AUTO';
    this.element.dataset.transmission = st.transmission || 'both';
    this.mode.title = st.transmission === 'manual' ? 'Manual only' : st.manual ? 'Press M for auto' : 'E / Q switches to manual';
    this.element.dataset.band = f.band; this.element.dataset.limiter = String(f.limiter);
    this.fill.style.width = `${f.rev * 100}%`; this.revs.setAttribute('aria-valuenow', Math.round(f.rev * 100));
    this.cue.hidden = !f.upshift;
  }
}
