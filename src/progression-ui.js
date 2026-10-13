// PROGRESSION UI: view helpers over src/progression.js for the menus (HTML strings that src/menu.js splices in), the
// garage block (#carProg, a sibling right after the paint panel in #menu .mright) and the level-up toast.
// Importing this module in the browser attaches the economy to the events hooks (one listener set, ever).
//   titleStrip()            level / XP bar / credits for the title screen
//   sortByTier(list)        event defs in career order; tierHead(list, i) a ladder header before row i (or '')
//   rowClass(id) rowBadge(id)   'locked' + a class-limit / lock chip for an event row
//   detail(id)              tier, unlock requirement, class limit and your car's PI for the detail pane
//   resultsBlock(res)       credits / XP breakdown + LEVEL UP callout for the results screen
//   setCar(spec)            the garage pick the menus judge eligibility with (main.js applyDriving)
//   garage(spec, { onChange })   (re)render the garage block for this car
import * as PROG from './progression.js';
import { events } from './events.js';
import { CARS } from './cars.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const n = (v) => Math.round(v).toLocaleString('en-US');
const DR = (v) => `${n(v)} <small>DR</small>`;
const carName = (id) => CARS.find((c) => c.id === id)?.short || id.toUpperCase();
let CUR = null; // the car spec the player is in (untuned)
export function setCar(spec) { CUR = spec; }
const cur = () => CUR || CARS[0];

// ------------------------------------------------------------------ title
export function titleStrip() {
  const p = PROG.getProfile(), L = PROG.levelInfo(p.xp);
  return `<div class="pg-strip"><div class="pg-lvl"><span>LEVEL</span><b>${L.level}</b></div>
    <div class="pg-xp"><div class="pg-bar"><i style="width:${Math.round(L.frac * 100)}%"></i></div><span>${L.need ? `${n(L.into)} / ${n(L.need)} XP` : 'MAX LEVEL'}</span></div>
    <div class="pg-cr">${DR(p.credits)}</div></div>`;
}

// ------------------------------------------------------------------ event list
const ORDER = () => new Map(PROG.ladderView().flatMap((t, ti) => t.events.map((id, k) => [id, ti * 100 + k])));
export function sortByTier(list) { const o = ORDER(); return list.slice().sort((a, b) => (o.get(a.id) ?? 999) - (o.get(b.id) ?? 999)); }
/** a ladder header before row i when the tier changes */
export function tierHead(list, i) {
  const t = PROG.tierOf(list[i]?.id), prev = i > 0 ? PROG.tierOf(list[i - 1].id) : null;
  if (!t || (prev && prev.id === t.id)) return '';
  const v = PROG.ladderView().find((x) => x.id === t.id), total = v.events.length;
  const req = v.unlocked ? `${v.medals.n} / ${total} MEDALS` : `🔒 ${Math.max(0, v.need - v.have)} MORE ${esc(v.from)} MEDAL${v.need - v.have === 1 ? '' : 'S'}`;
  return `<div class="pg-tier ${v.unlocked ? '' : 'locked'}"><b>${esc(v.name)}</b><span>${esc(v.blurb)}</span><em>${req}</em></div>`;
}
export function rowClass(id) { return PROG.eventInfo(id, cur()).locked ? 'locked' : ''; }
export function rowBadge(id) {
  const i = PROG.eventInfo(id, cur());
  const lim = i.restrict ? `<i class="pg-chip ${i.gate.code === 'class' ? 'bad' : ''}">${esc(i.restrictLabel)}</i>` : '';
  const lock = i.locked && i.gate.code !== 'class' ? `<i class="pg-chip lock">${i.gate.code === 'tier' ? 'LOCKED' : 'CAR LOCKED'}</i>` : '';
  return lim + lock;
}
export function classBadge(cls, pi) { return `<span class="pg-pi c-${cls}"><b>${cls}</b>${pi}</span>`; }
export function detail(id) {
  const spec = cur(), i = PROG.eventInfo(id, spec);
  const rows = [];
  if (i.tier) rows.push(['CAREER', esc(i.tier.name)]);
  if (i.restrict) rows.push(['CLASS LIMIT', esc(i.restrictLabel)]);
  rows.push(['YOUR CAR', `${esc(spec.short || spec.name)} ${classBadge(i.cls, i.pi)}`]);
  return `<div class="pg-detail">${rows.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('')}</div>${i.locked ? `<div class="pg-lockmsg">🔒 ${esc(i.gate.reason)}</div>` : ''}`;
}

// ------------------------------------------------------------------ results
export function resultsBlock(res) {
  if (!res) return '';
  const a = PROG.awardFor(res);
  if (!a) return `<div class="r-block pg-res"><h3>CAREER</h3><div class="pg-none">${res.valid === false ? 'NO PAYOUT · NOT A CLEAN RUN' : 'NO PAYOUT'}</div></div>`;
  const L = PROG.levelInfo(PROG.getProfile().xp);
  const rows = a.award.lines.map((l) => `<tr><td>${esc(l.label)}</td><td class="${l.credits < 0 ? 'bad' : 'good'}">${l.credits ? (l.credits < 0 ? '−' : '+') + n(Math.abs(l.credits)) : ''}</td><td class="xp">${l.xp ? '+' + n(l.xp) : ''}</td></tr>`).join('');
  const lu = a.levelUps.length ? `<div class="pg-levelup"><em>LEVEL UP</em><b>${a.levelUps[a.levelUps.length - 1].level}</b><span>${a.levelUps.map((r) => `+${n(r.credits)} DR${r.unlocks.length ? ' · ' + r.unlocks.map((c) => esc(carName(c)) + ' UNLOCKED').join(' · ') : ''}`).join('<br>')}</span></div>` : '';
  return `<div class="r-block pg-res"><h3>CAREER PAYOUT</h3>${lu}<table class="r-splits"><tr class="hd"><td></td><td>DR</td><td>XP</td></tr>${rows}
    <tr class="tot"><td>TOTAL</td><td>+${n(a.award.credits)}</td><td>+${n(a.award.xp)}</td></tr></table>
    <div class="pg-after"><span>LEVEL ${L.level}</span><div class="pg-bar"><i style="width:${Math.round(L.frac * 100)}%"></i></div><span>${DR(PROG.getProfile().credits)}</span></div></div>`;
}

// ------------------------------------------------------------------ garage
let garageSpec = null, garageOpts = {}, garageMsg = '';
export function garage(spec, opts = {}) {
  garageSpec = spec; garageOpts = opts;
  if (typeof document === 'undefined') return;
  let el = document.getElementById('carProg');
  if (!el) {
    el = document.createElement('div'); el.id = 'carProg';
    const anchor = document.getElementById('carPaint'), best = document.getElementById('cBest');
    if (anchor) anchor.after(el); else if (best) best.before(el); else return;
    el.addEventListener('keydown', (e) => e.stopPropagation());
    el.addEventListener('click', onGarageClick);
  } else if (document.getElementById('carPaint') && el.previousElementSibling?.id !== 'carPaint') document.getElementById('carPaint').after(el);
  renderGarage(el);
}
function renderGarage(el) {
  const spec = garageSpec; if (!spec) return;
  const c = PROG.carInfo(spec), p = PROG.getProfile(), L = PROG.levelInfo(p.xp);
  const head = `<div class="pg-ghead">${classBadge(c.cls, c.pi)}${c.pi !== c.stockPi ? `<span class="pg-stock">STOCK ${c.stockCls} ${c.stockPi}</span>` : ''}<span class="pg-gcr">LV ${L.level} · ${DR(p.credits)}</span></div>`;
  let body;
  if (!c.owned) {
    const can = p.credits >= c.price;
    body = `<div class="pg-locked"><div><b>🔒 LOCKED</b><span>${c.price ? `${DR(c.price)} · ` : ''}OR REACH LEVEL ${c.unlockLevel}</span><small>TEST DRIVE IN QUICK RACE ONLY</small></div>
      ${c.price ? `<button type="button" class="pg-btn ${can ? '' : 'off'}" data-pg="buycar">BUY</button>` : ''}</div>`;
  } else {
    body = `<div class="pg-ups">${PROG.UPGRADE_KEYS.map((k) => {
      const U = PROG.UPGRADES[k], b = c.bought[k], f = c.fitted[k];
      const pips = [0, 1, 2, 3].map((s) => `<i class="pip ${s === 0 ? 'stock' : ''} ${s <= f ? 'on' : ''} ${s > b ? 'nb' : ''}" data-pg="fit" data-cat="${k}" data-st="${s}" title="${s === 0 ? 'Stock' : 'Stage ' + s}${s > b ? ' (not bought)' : ''}"></i>`).join('');
      const next = b < PROG.MAX_STAGE ? PROG.upgradeCost(spec.id, k, b + 1) : 0;
      return `<div class="pg-up" title="${esc(U.desc)}"><span>${U.label}</span><div class="pips">${pips}</div>${next ? `<button type="button" class="pg-btn sm ${p.credits >= next ? '' : 'off'}" data-pg="buy" data-cat="${k}">${n(next)}</button>` : '<em>MAX</em>'}</div>`;
    }).join('')}</div>`;
  }
  el.innerHTML = head + body + `<div class="pg-msg">${esc(garageMsg)}</div>`;
}
function onGarageClick(e) {
  const t = e.target.closest('[data-pg]'); if (!t || !garageSpec) return;
  e.preventDefault(); e.stopPropagation();
  const id = garageSpec.id, cat = t.dataset.cat;
  let r = null;
  if (t.dataset.pg === 'buycar') { r = PROG.buyCar(id); garageMsg = r.ok ? `${carName(id)} IS YOURS · −${n(r.spent)} DR` : r.reason; }
  else if (t.dataset.pg === 'buy') { r = PROG.buyUpgrade(id, cat); garageMsg = r.ok ? `${PROG.UPGRADES[cat].label} STAGE ${r.stage} FITTED · −${n(r.spent)} DR` : r.reason; }
  else if (t.dataset.pg === 'fit') { const s = +t.dataset.st; if (s <= PROG.bought(id)[cat]) { r = PROG.fitUpgrade(id, cat, s); garageMsg = r.ok ? `${PROG.UPGRADES[cat].label}: ${s ? 'STAGE ' + s : 'STOCK'}` : r.reason; } else garageMsg = 'BUY THE STAGE FIRST'; }
  if (r?.ok) garageOpts.onChange?.(id);
  garage(garageSpec, garageOpts);
}

// ------------------------------------------------------------------ toasts (level up)
let toastEl = null, toastT = 0;
function toast(html, cls = '') {
  if (typeof document === 'undefined') return;
  if (!toastEl) { toastEl = document.createElement('div'); toastEl.id = 'pgToast'; document.body.append(toastEl); }
  toastEl.className = 'show ' + cls; toastEl.innerHTML = html;
  clearTimeout(toastT); toastT = setTimeout(() => { toastEl.className = ''; }, 4200);
}
/** a short notice over the menus (e.g. why an event can't start) */
export function notice(text) { toast(`<span class="warn">🔒 ${esc(text)}</span>`, 'note'); }
if (typeof window !== 'undefined') {
  PROG.attach(events);
  PROG.onProgress((e) => {
    if (e.kind === 'levelup') toast(`<em>LEVEL UP</em><b>${e.level}</b><span>+${n(e.credits)} DR${e.unlocks.length ? ' · ' + e.unlocks.map((c) => esc(carName(c)) + ' UNLOCKED').join(' · ') : ''}</span>`, 'lvl');
    if (garageSpec && document.body.classList.contains('menu') && document.getElementById('carProg')) renderGarage(document.getElementById('carProg'));
  });
}
