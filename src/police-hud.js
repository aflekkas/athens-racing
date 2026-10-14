// POLICE HUD (kept minimal): heat stars and a one-word state (PURSUIT / COOLDOWN / WANTED), top centre
// under the route bar. Its own DOM and styles (src/hud.js keeps the minimap cop dots). Reads the live `pursuit`
// status from src/police.js.
import { pursuit } from './police.js';
import { icon } from './ui/components.js';

const CSS = `
#police-hud{position:fixed;left:50%;top:150px;transform:translateX(-50%);z-index:30;pointer-events:none;display:none;flex-direction:column;align-items:center;gap:4px;
  font:800 13px/1 'Barlow Condensed',system-ui,sans-serif;letter-spacing:.18em;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,.7)}
body.racing #police-hud.on{display:flex}
#police-hud .stars{display:flex;gap:3px;font-size:22px}
#police-hud .stars i{display:flex;color:rgba(255,255,255,.22)}#police-hud .stars .ico{width:22px;height:22px;filter:drop-shadow(0 1px 2px rgba(0,0,0,.8))}
#police-hud .stars i.lit{color:#ffcf3a}#police-hud .stars i.lit .ico{filter:drop-shadow(0 0 6px rgba(255,190,40,.8))}
#police-hud .lbl{padding:4px 12px;border-radius:3px;background:rgba(10,20,50,.72)}
#police-hud.pursuit .lbl{animation:ph-flash .5s steps(2) infinite}
@keyframes ph-flash{0%{background:rgba(30,90,255,.85)}100%{background:rgba(230,30,40,.85)}}
#police-big{position:fixed;z-index:31;pointer-events:none;font:italic 900 64px/1 'Barlow Condensed',system-ui,sans-serif;color:#fff;text-shadow:0 2px 8px rgba(0,0,0,.7);left:50%;top:38%;transform:translate(-50%,-50%) scale(.6);opacity:0;font-size:64px;letter-spacing:.12em;transition:transform .25s,opacity .25s;white-space:nowrap}
#police-big.show{opacity:1;transform:translate(-50%,-50%) scale(1)}
#police-big.busted{color:#ff4b4b}#police-big.evaded{color:#46f08c}
#police-big small{display:block;font-size:18px;text-align:center;margin-top:8px;color:#fff}
`;

export class PoliceHud {
  constructor() {
    if (typeof document === 'undefined') return;
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    const el = this.el = document.createElement('div'); el.id = 'police-hud';
    el.innerHTML = `<div class="stars">${`<i>${icon('star')}</i>`.repeat(5)}</div><div class="lbl">PURSUIT</div>`;
    document.body.appendChild(el);
    // the call-out lives outside the (transformed) widget so it centres on the screen
    const big = document.createElement('div'); big.id = 'police-big'; document.body.appendChild(big);
    this.stars = [...el.querySelectorAll('.stars i')]; this.lbl = el.querySelector('.lbl'); this.big = big;
    this.bigT = 0; this.last = '';
  }
  /** a full-screen BUSTED / EVADED call-out */
  shout(kind, text, sub = '') {
    if (!this.el) return;
    this.big.className = kind; this.big.innerHTML = `${text}${sub ? `<small>${sub}</small>` : ''}`;
    void this.big.offsetWidth; this.big.classList.add('show'); this.bigT = 2.6;
  }
  update(dt) {
    if (!this.el) return;
    const p = pursuit;
    if (this.bigT > 0 && (this.bigT -= dt) <= 0) this.big.classList.remove('show');
    const show = p.enabled && (p.state === 'pursuit' || p.state === 'cooldown' || p.heat > 0.01);
    this.el.classList.toggle('on', show);
    if (!show) return;
    this.el.classList.toggle('pursuit', p.state === 'pursuit');
    const key = `${p.level}|${p.state}|${Math.round(p.heat * 100)}`;
    if (key !== this.last) {
      this.last = key;
      this.stars.forEach((s, i) => s.classList.toggle('lit', i < p.level));
      this.lbl.textContent = p.state === 'pursuit' ? 'PURSUIT' : p.state === 'cooldown' ? 'COOLDOWN' : p.state === 'warning' ? 'PULL OVER · STOP SAFELY' : `OBSERVED ${Math.round(p.heat * 100)}%`;
    }
  }
}
