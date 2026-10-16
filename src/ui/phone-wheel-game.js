import { notifications } from './notifications.js';
import * as C from './components.js';
import qrcode from '../vendor/qrcode.js';
import { input } from '../input.js';
import { WheelLink } from '../phone-wheel-link.js';
let session, starting;
function style() {
  if (document.querySelector('#phone-wheel-css')) return;
  const css = document.createElement('link'); css.id = 'phone-wheel-css'; css.rel = 'stylesheet'; css.href = new URL('./phone-wheel.css', import.meta.url).href; document.head.append(css);
}
function update(status) {
  if (!session) return;
  const wasPaired=session.status?.paired;
  session.status = status;
  if(status.paired!==wasPaired)notifications.post({id:'phone-wheel-link',title:status.paired?'PHONE WHEEL CONNECTED':'PHONE WHEEL DISCONNECTED',text:status.paired?'Steering and pedals ready':'Use keyboard or gamepad',tone:status.paired?'good':'warn',priority:status.paired?35:75,ms:4000});
  const text = `${status.state} · ${status.transport} · ${status.latency === null ? '—' : status.latency.toFixed(1)} ms`;
  for (const output of document.querySelectorAll('[data-wheel-status]')) output.textContent = text;
  session.hud.textContent = `PHONE WHEEL · ${text}`;
  session.hud.hidden = true; // Connection transitions use the shared lane; live latency stays in the pairing screen.
  if (!status.paired) input.phoneWheel.reset();
}
export async function openPhoneWheel(menu) {
  style();
  if (!session?.link || session.link.ws.readyState > 1) {
    if (starting) return;
    starting = true;
    try {
      session?.link.close(); session?.hud.remove(); input.phoneWheel.reset();
      const response = await fetch('/api/wheel', { method:'POST', cache:'no-store' });
      if (!response.ok) throw new Error('Could not create a wheel code. Try again.');
      const room = await response.json(), hud = document.createElement('output'); hud.className = 'wheel-hud'; hud.hidden = true; document.body.append(hud);
      session = { ...room, hud, status:{state:'Waiting for phone',transport:'WebSocket',latency:null,paired:false} };
      const active = session;
      session.link = new WheelLink({ ...room, role:'game', onData: data => { if (session === active) input.phoneButton(data.button,data.down); }, onPacket: packet => { if (session !== active) return; if (packet) input.phoneWheel.receive(packet); else input.phoneWheel.reset(); }, onStatus: status => { if (session === active) update(status); } });
      input.phoneWheelFeedback = ms => session?.link.send({haptic:ms});
    } catch (error) { C.ui.toast(error.message, {tone:'bad'}); return; }
    finally { starting = false; }
  }
  menu.show('phoneWheel', {}, true);
}
export function renderPhoneWheel() {
  if (!session) return '';
  const url = new URL('/wheel', location.href); url.searchParams.set('c',session.code);
  const qr = qrcode(0,'M'); qr.addData(url.href); qr.make();
  return C.screen({title:'USE PHONE AS WHEEL',kick:'CONTROLS',body:`<div class="wheel-pair"><div class="wheel-qr" aria-label="Scan to pair your phone">${qr.createSvgTag({cellSize:4,margin:4,scalable:true})}</div><div><p>Scan with your phone camera, or open the address below and enter this code.</p><p class="wheel-pair-code">${C.esc(session.code)}</p><p><a href="${C.esc(url.href)}" target="_blank" rel="noopener">${C.esc(url.origin)}/wheel?c=${session.code}</a></p><p>Code expires in five minutes. One phone per session. Hold your phone in landscape and tap to allow motion.</p><output data-wheel-status aria-live="polite">${C.esc(session.status.state)} · ${session.status.transport} · ${session.status.latency === null ? '—' : session.status.latency.toFixed(1)} ms</output><p>${C.button({label:'UNPAIR',act:'phoneWheelUnpair',variant:'ghost'})}</p></div></div>`,foot:C.button({label:'BACK',act:'back'})});
}
export function unpairPhoneWheel() { session?.link.close(); session?.hud.remove(); session = null; input.phoneWheel.reset(); input.phoneWheelFeedback = null; }
