// Shared compact notices use these semantic icons and severity colours.
// Priority, deduplication and placement belong to notification-queue.js.
import { telltale } from './telltales.js';

const has = (text, re) => re.test(text);
export function noticeStyle(item = {}) {
  const id = String(item.id || ''), title = String(item.title || ''), text = String(item.text || ''), all = `${title} ${text}`.toUpperCase();
  const tone = ['bad','good','warn'].includes(item.tone) ? item.tone : 'info';
  const pick = (kind, icon, lamp = tone) => ({ kind: item.kind || kind, telltale: item.telltale || icon, tone: lamp, label: item.label || LABELS[icon] || '' });
  // explicit adapters by id
  if (id === 'wrong-way') return pick('telltale', 'no-entry', 'bad');
  if (id === 'engine-condition') return pick('telltale', /BODY|DAMAGE|BENT/.test(all) ? 'damage' : /OIL/.test(all) ? 'oil' : 'engine', tone === 'bad' ? 'bad' : 'warn');
  if (id === 'tow') return pick('telltale', 'tow', 'warn');
  if (id === 'traction-control') return /OFF/.test(all) ? pick('telltale', 'esc-off', 'warn') : pick('telltale', 'esc', 'good');
  if (id === 'police-status' || id === 'police-callout') return pick('telltale', 'police', tone === 'good' ? 'good' : tone === 'bad' ? 'bad' : 'warn');
  if (id === 'checkpoint') return pick('hud', 'u-turn', 'bad');
  if (id === 'objective-direction') return pick('hud', 'u-turn', 'warn');
  if (id.startsWith('tip:')) return pick('card', 'tip', 'info');
  if (item.kind || item.telltale) return pick(item.kind || 'telltale', item.telltale || 'info', tone);
  // free-text notices (hud.pop / hud.message / hud.banner / input toasts)
  if (has(all, /\bABS\b/)) return pick('telltale', 'abs', /OFF/.test(all) ? 'warn' : 'good');
  if (has(all, /\b(TC|ESC)\b|TRACTION/)) return /OFF/.test(all) ? pick('telltale', 'esc-off', 'warn') : pick('telltale', 'esc', 'good');
  if (has(all, /POLICE|BUSTED|TAKEDOWN|CAPTURED|LOST THEM|PURSUIT/)) return pick('telltale', 'police', tone === 'good' ? 'good' : 'bad');
  if (has(all, /RED LIGHT|SIGNAL/)) return pick('telltale', 'red-light', tone === 'bad' ? 'bad' : 'warn');
  if (has(all, /SPEED|RADAR/) && !has(all, /\bCAM\b/)) return pick('telltale', 'speed-camera', 'warn');
  if (has(all, /PAVEMENT|PEDESTRIAN/)) return pick('telltale', 'pedestrian', 'bad');
  if (has(all, /CRASH|WRECK|BUMP|PAINT|DAMAGE/)) return pick('telltale', 'damage', tone === 'good' ? 'warn' : tone === 'bad' ? 'bad' : 'warn');
  if (has(all, /TOWED|RESET|TOW\b/)) return pick('telltale', 'tow', 'warn');
  if (has(all, /ENGINE|OVERHEAT|STALL/)) return pick('telltale', 'engine', tone === 'bad' ? 'bad' : 'warn');
  if (has(all, /GEARBOX|MANUAL|AUTOMATIC|\bAUTO\b|SHIFT/)) return pick('telltale', 'gearbox', tone === 'bad' || tone === 'warn' ? tone : 'good');
  if (has(all, /CONTROLLER|GAMEPAD|PAD CONNECTED/)) return pick('card', 'gamepad', tone);
  if (has(all, /MUSIC|♪|NOW PLAYING|RADIO/)) return pick('card', 'music', 'info');
  if (has(all, /\bCAM\b|CAMERA|COCKPIT|CHASE/)) return pick('hud', 'view', 'info');
  if (has(all, /WRONG WAY|TURN BACK|TURN AROUND/)) return pick('hud', 'u-turn', 'bad');
  if (has(all, /CHECKPOINT|SPLIT|FINISH|LAP\b|SESSION|FREE ROAM|QUICK RACE|SPRINT/)) return pick('hud', 'flag', tone);
  if (has(all, /CRASHED|RIVAL|OVERTAKE/)) return pick('telltale', 'driver', 'info');
  // a slot banner without a known cause is a route / district caption
  if (item.slot === 'banner' || (item.priority ?? 0) <= 15) return pick('hud', 'ahead', tone);
  if (item.actions?.length || text.length > 64) return pick('card', 'info', tone);
  return pick('telltale', tone === 'bad' ? 'warning' : tone === 'good' ? 'check' : 'info', tone === 'bad' ? 'bad' : tone === 'good' ? 'good' : 'info');
}
// the infotainment card's app label
const LABELS = { tip: 'DRIVING TIPS', music: 'MEDIA', gamepad: 'CONTROLLER', info: 'VEHICLE INFO' };

// the lamp glyph as a CSS mask (cached): the card keeps its DOM, so adopted nodes stay its first child
const masks = new Map();
export function telltaleMask(name) {
  if (!masks.has(name)) {
    const svg = telltale(name).replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ').replace(/currentColor/g, '#000');
    masks.set(name, `url("data:image/svg+xml,${encodeURIComponent(svg)}")`);
  }
  return masks.get(name);
}
