import { personalBestLabel } from './personal-bests.js';
const format = t => t == null ? 'DNF' : `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}`;
// The source is captured synchronously just after a real renderer frame, before
// WebGL's drawing buffer is discarded. It never substitutes artwork for the car.
export function captureResultFrame(source) {
  const copy = document.createElement('canvas'); copy.width = source.width; copy.height = source.height;
  copy.getContext('2d').drawImage(source, 0, 0); return copy;
}
export async function renderResultCard({ screenshot, mapName, routeName, carName, time, position, field, pb, date = new Date().toISOString(), url = 'athens-street-racers.com' }) {
  if (!screenshot?.width) throw new Error('Finish photo is not ready. Try again.');
  const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 900;
  const c = canvas.getContext('2d'); c.fillStyle = '#080e15'; c.fillRect(0, 0, 1200, 900);
  const h = 560, scale = Math.max(1200 / screenshot.width, h / screenshot.height);
  c.drawImage(screenshot, (1200 - screenshot.width * scale) / 2, (h - screenshot.height * scale) / 2, screenshot.width * scale, screenshot.height * scale);
  const g = c.createLinearGradient(0, 330, 0, 585); g.addColorStop(0, 'rgba(8,14,21,0)'); g.addColorStop(1, '#080e15'); c.fillStyle = g; c.fillRect(0, 330, 1200, 260);
  c.fillStyle = '#55e1db'; c.fillRect(48, 580, 5, 210);
  const text = (value, x, y, size, color = '#f2f6fa', max = 1080) => { c.fillStyle = color; c.font = `600 ${size}px sans-serif`; c.fillText(String(value), x, y, max); };
  text('ATHENS / STREET RACERS', 48, 58, 23); text(mapName || 'ATHENS', 76, 600, 34);
  text(routeName || 'QUICK RACE', 76, 638, 22, '#9baebd'); text(carName || '', 76, 678, 24);
  text(format(time), 70, 775, 88); text(position ? `P${position} / ${field || position}` : 'FINISH', 925, 767, 40, '#55e1db', 230);
  if (personalBestLabel(pb)) text(personalBestLabel(pb), 76, 826, 24, '#55e1db');
  text(new Date(date).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }), 48, 875, 18, '#9baebd');
  text(url, 630, 875, 18, '#9baebd', 520);
  const blob = await new Promise((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('Could not create result image.')), 'image/png'));
  return { canvas, blob };
}
export async function shareResultCard(data) {
  const { blob } = await renderResultCard(data), file = new File([blob], 'athens-street-racers-result.png', { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] }) && navigator.share) {
    try { await navigator.share({ files: [file], title: 'Athens Street Racers', text: `${data.mapName} · ${format(data.time)}` }); return 'SHARED'; }
    catch (e) { if (e.name === 'AbortError') return 'SHARE CANCELLED'; }
  }
  const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = file.name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
  return 'RESULT IMAGE DOWNLOADED';
}
