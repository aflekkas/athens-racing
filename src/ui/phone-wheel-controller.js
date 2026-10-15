import * as C from './components.js';
import { WheelLink } from '../phone-wheel-link.js';
import { encodeWheel, neutralWheel, WHEEL_BUTTONS } from '../phone-wheel-packet.js';
import { WheelMotion, requestWheelMotion } from '../phone-wheel-motion.js';
const root = document.querySelector('#wheel-controller'), motion = new WheelMotion(), state = neutralWheel();
let link, sequence = 0, started = false, starting = false, generation = 0, wake, timer;
root.innerHTML = `<div class="wheel-phone"><header><span>ATHENS RACING / PHONE WHEEL</span><output id="wheel-status" aria-live="polite">Not connected</output>${C.button({label:'UNPAIR',act:'unpair',size:'sm'})}</header>
<section class="wheel-start"><h1>YOUR PHONE. YOUR WHEEL.</h1><p>Hold your phone in landscape, like a steering wheel. Tap to allow motion, then calibrate with the phone centred.</p><label>PAIRING CODE <input id="wheel-code" maxlength="8" autocomplete="off" autocapitalize="characters" spellcheck="false" aria-label="Pairing code"></label>${C.button({ label:'TAP TO START',act:'start',variant:'primary' })}<p id="wheel-error" role="alert"></p></section>
<section class="wheel-drive" hidden><div class="wheel-pedal wheel-brake" data-pedal="brake" role="button" aria-label="Brake pedal"><b>BRAKE</b><span>SLIDE UP FOR MORE</span><output>0%</output></div>
<div class="wheel-centre"><output id="wheel-steer">0°</output>${C.button({label:'CALIBRATE CENTRE',act:'calibrate',size:'sm'})}${C.slider({key:'fullLock',label:'FULL LOCK',value:90,min:60,max:120,step:5,format:'int'})}<p class="wheel-rotate">Rotate to landscape</p><div class="wheel-aux">${WHEEL_BUTTONS.map((key,i)=>C.button({label:['HANDBRAKE','SHIFT +','SHIFT −','LOOK BACK','CAMERA','PAUSE'][i],act:key,size:'sm',attrs:{'data-wheel-button':key}})).join('')}</div></div>
<div class="wheel-pedal wheel-throttle" data-pedal="throttle" role="button" aria-label="Throttle pedal"><b>THROTTLE</b><span>SLIDE UP FOR MORE</span><output>0%</output></div></section><footer>Keep the game screen in view · Lift fingers to release pedals · Inputs release if the link stops</footer></div>`;
C.bindRoot(root);
for (const button of root.querySelectorAll('[role=button]')) { button.tabIndex = 0; button.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); button.click(); } }); }
const codeInput = root.querySelector('#wheel-code'); codeInput.value = new URL(location.href).searchParams.get('c') || '';
const error = root.querySelector('#wheel-error');
function status(s) { root.querySelector('#wheel-status').textContent = `${s.state} · ${s.transport}${s.latency === null ? ' · — ms' : ` · ${s.latency.toFixed(1)} ms`}`; if (!s.paired && started && /Disconnected|failed/.test(s.state)) stop(); }
function feedback(data) {
  if (!data.haptic) return;
  const ms = Math.max(15, Math.min(250, data.haptic));
  if (!navigator.vibrate?.(ms)) { root.classList.remove('wheel-flash'); void root.offsetWidth; root.classList.add('wheel-flash'); }
}
async function wakeLock() { try { wake = await navigator.wakeLock?.request('screen'); } catch {} }
async function start() {
  if (started || starting) return;
  error.textContent = '';
  const code = codeInput.value.toUpperCase().replace(/\s/g,'');
  if (!/^[A-HJ-NP-Z2-9]{8}$/.test(code)) { error.textContent = 'Enter the eight-character code shown in the game.'; return; }
  starting = true; const active = ++generation; link?.close();
  try {
    // Must run in this user gesture, before any network or fullscreen await (iOS).
    await requestWheelMotion();
    if (active !== generation) return;
    started = true;
    try { await document.documentElement.requestFullscreen?.(); } catch {}
    try { await screen.orientation?.lock?.('landscape'); } catch {}
    await wakeLock();
    if (active !== generation) { wake?.release(); return; }
    root.querySelector('.wheel-start').hidden = true; root.querySelector('.wheel-drive').hidden = false;
    link = new WheelLink({ code, role:'phone', onStatus: value => { if (active === generation) status(value); }, onData: value => { if (active === generation) feedback(value); } });
    timer = setInterval(() => { if (link?.paired) link.send(encodeWheel(state, sequence++)); }, 1000/60);
  } catch (e) { if (active === generation) { started = false; error.textContent = e.message; } }
  finally { starting = false; }
}
function release() { root.dispatchEvent(new Event('wheel:release')); Object.assign(state, neutralWheel()); for (const p of root.querySelectorAll('[data-pedal]')) { p.style.setProperty('--pedal','0%'); p.querySelector('output').textContent = '0%'; } for (const b of root.querySelectorAll('[data-wheel-button]')) b.classList.remove('held'); if (link?.paired) link.send(encodeWheel(state,sequence++)); }
function stop() { generation++; started = false; clearInterval(timer); release(); wake?.release(); root.querySelector('.wheel-start').hidden = false; root.querySelector('.wheel-drive').hidden = true; }
root.addEventListener('click', e => {
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'start') start();
  if (act === 'calibrate') { motion.calibrate(); state.steer = 0; }
  if (act === 'unpair') { link?.close(); stop(); }
});
root.addEventListener('ui:change', e => { if (e.detail.key === 'fullLock') motion.fullLock = +e.detail.value; });
window.addEventListener('deviceorientation', e => {
  if (!started || document.hidden) return;
  state.steer = motion.update(e, screen.orientation?.angle ?? window.orientation ?? 90);
  root.querySelector('#wheel-steer').textContent = `${Math.round(state.steer * motion.fullLock)}°`;
});
for (const element of root.querySelectorAll('[data-pedal], [data-wheel-button]')) {
  let pointer;
  root.addEventListener('wheel:release', () => { pointer = undefined; });
  const move = e => {
    if (e.pointerId !== pointer) return;
    if (element.dataset.pedal) {
      const r = element.getBoundingClientRect(), value = Math.max(0,Math.min(1,(r.bottom - e.clientY)/r.height));
      state[element.dataset.pedal] = value; element.style.setProperty('--pedal', `${value*100}%`); element.querySelector('output').textContent = `${Math.round(value*100)}%`;
    }
  };
  element.addEventListener('pointerdown', e => { if (!started || pointer !== undefined) return; e.preventDefault(); pointer = e.pointerId; element.setPointerCapture(pointer); if (element.dataset.wheelButton) { state[element.dataset.wheelButton] = true; link?.relay({type:'data',data:{button:element.dataset.wheelButton,down:true}}); element.classList.add('held'); } move(e); });
  element.addEventListener('pointermove', move);
  for (const name of ['pointerup','pointercancel','lostpointercapture']) element.addEventListener(name,e=>{ if (e.pointerId !== pointer) return; pointer = undefined; if (element.dataset.wheelButton) link?.relay({type:'data',data:{button:element.dataset.wheelButton,down:false}}); state[element.dataset.pedal || element.dataset.wheelButton] = element.dataset.pedal ? 0 : false; element.classList.remove('held'); if (element.dataset.pedal) {element.style.setProperty('--pedal','0%');element.querySelector('output').textContent='0%';} });
}
window.addEventListener('blur', release);
document.addEventListener('visibilitychange', () => { release(); if (document.hidden) wake?.release(); else if (started) wakeLock(); });
window.addEventListener('pagehide', () => { link?.close(); stop(); });
