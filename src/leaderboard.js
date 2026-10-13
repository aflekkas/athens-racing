// Small shared client for solo event hooks and menu/online leaderboard views.
const newId = () => [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('');
function driverId() {
  try { let id = localStorage.getItem('paraliaki.driverId'); if (!id) { id = newId(); localStorage.setItem('paraliaki.driverId', id); } return id; }
  catch { return fallbackId; }
}
const fallbackId = newId();
export { driverId };
export async function getLeaderboard(filters = {}) {
  filters = { mapId: globalThis.window?.__flow?.mapId || 'riviera', ...filters };
  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) if (v !== undefined && v !== null) query.set(k, String(v));
  const response = await fetch('/api/leaderboard?' + query);
  if (!response.ok) throw new Error('Leaderboard unavailable.');
  return response.json();
}
export async function submitResult(result) {
  if (!result?.valid || !Number.isFinite(result.time)) return { saved: false };
  try {
    const response = await fetch('/api/leaderboard', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mapId: result.mapId || globalThis.window?.__flow?.mapId || 'riviera', eventId: result.eventId, car: result.car, time: result.time, valid: true, driverId: driverId(), name: localStorage.getItem('paraliaki.driver') || 'DRIVER' }) });
    if (!response.ok) return { saved: false, error: (await response.json()).error };
    return response.json();
  } catch { return { saved: false, error: 'Leaderboard unavailable.' }; }
}
