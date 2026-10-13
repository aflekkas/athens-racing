// POLICE HUD: heat stars and the pursuit meter (BUSTED fills red from the left, EVADING fills green), top centre
// under the route bar. Its own DOM and styles (src/hud.js keeps the minimap cop dots). Reads the live `pursuit`
// status from src/police.js.
import { pursuit } from './police.js';

const CSS = `
#police-hud{position:fixed;left:50%;top:64px;transform:translateX(-50%);z-index:30;pointer-events:none;display:none;flex-direction:column;align-items:center;gap:4px;
  font:800 13px/1 system-ui,-apple-system,'Segoe UI',sans-serif;letter-spacing:.14em;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,.7)}
body.racing #police-hud.on{display:flex}
#police-hud .stars{font-size:22px;letter-spacing:.08em}
#police-hud .stars i{font-style:normal;color:rgba(255,255,255,.22)}
#police-hud .stars i.lit{color:#ffcf3a;text-shadow:0 0 8px rgba(255,190,40,.8),0 1px 2px rgba(0,0,0,.8)}
#police-hud .lbl{padding:3px 10px;border-radius:3px;background:rgba(10,20,50,.72)}
#police-hud.pursuit .lbl{animation:ph-flash .5s steps(2) infinite}
@keyframes ph-flash{0%{background:rgba(30,90,255,.85)}100%{background:rgba(230,30,40,.85)}}
#police-hud .meter{position:relative;width:260px;height:8px;border-radius:4px;background:rgba(0,0,0,.45);overflow:hidden;box-shadow:0 0 0 1px rgba(255,255,255,.18) inset}
#police-hud .meter b{position:absolute;top:0;bottom:0;left:0;width:0;background:linear-gradient(90deg,#ff3b3b,#ff8a3b)}
#police-hud .meter s{position:absolute;top:0;bottom:0;right:0;width:0;background:linear-gradient(270deg,#2fe07a,#9bf0b8);text-decoration:none}
#police-hud .sub{font-size:11px;opacity:.85}
#police-hud .big{position:fixed;left:50%;top:38%;transform:translate(-50%,-50%) scale(.6);opacity:0;font-size:64px;letter-spacing:.12em;transition:transform .25s,opacity .25s;white-space:nowrap}
#police-hud .big.show{opacity:1;transform:translate(-50%,-50%) scale(1)}
#police-hud .big.busted{color:#ff4b4b}#police-hud .big.evaded{color:#46f08c}
#police-hud .big small{display:block;font-size:18px;text-align:center;margin-top:8px;color:#fff}
`;

export class PoliceHud {
  constructor() {
    if (typeof document === 'undefined') return;
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    const el = this.el = document.createElement('div'); el.id = 'police-hud';
    el.innerHTML = `<div class="stars">${'<i>★</i>'.repeat(5)}</div><div class="lbl">PURSUIT</div><div class="meter"><b></b><s></s></div><div class="sub"></div><div class="big"></div>`;
    document.body.appendChild(el);
    this.stars = [...el.querySelectorAll('.stars i')]; this.lbl = el.querySelector('.lbl'); this.bust = el.querySelector('.meter b');
    this.evade = el.querySelector('.meter s'); this.sub = el.querySelector('.sub'); this.big = el.querySelector('.big');
    this.bigT = 0; this.last = '';
  }
  /** a full-screen BUSTED / EVADED call-out */
  shout(kind, text, sub = '') {
    if (!this.el) return;
    this.big.className = 'big ' + kind; this.big.innerHTML = `${text}${sub ? `<small>${sub}</small>` : ''}`;
    void this.big.offsetWidth; this.big.classList.add('show'); this.bigT = 2.6; this.el.classList.add('on');
  }
  update(dt) {
    if (!this.el) return;
    const p = pursuit;
    if (this.bigT > 0 && (this.bigT -= dt) <= 0) this.big.classList.remove('show');
    const show = p.enabled && (p.state === 'pursuit' || p.state === 'cooldown' || p.heat > 0.01);
    this.el.classList.toggle('on', show || this.bigT > 0);
    if (!show) return;
    this.el.classList.toggle('pursuit', p.state === 'pursuit');
    const key = `${p.level}|${p.state}|${p.units}|${p.takedowns}`;
    if (key !== this.last) {
      this.last = key;
      this.stars.forEach((s, i) => s.classList.toggle('lit', i < p.level));
      this.lbl.textContent = p.state === 'pursuit' ? 'PURSUIT' : p.state === 'cooldown' ? 'COOLDOWN · LOSE THEM' : 'WANTED';
    }
    this.bust.style.width = Math.round(p.bustMeter * 100) + '%';
    this.evade.style.width = Math.round((p.state === 'cooldown' ? p.evadeMeter : 0) * 100) + '%';
    this.sub.textContent = p.state === 'idle' ? '' : `UNITS ${p.units} · TAKEDOWNS ${p.takedowns} · BOUNTY ${p.bounty.toLocaleString('en-US')}`;
  }
}
