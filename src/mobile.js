// Device policy stays independent of rendering and works with Safari's limited navigator.
export const mobileDevice = (ua = globalThis.navigator?.userAgent || '') => /Android|iPhone|iPad|Mobile/i.test(ua);

// In landscape beta becomes the lateral axis; gamma is the phone's pitch.
export function tiltAxis({ beta, gamma }, angle = 0) {
  if (!Number.isFinite(beta) || !Number.isFinite(gamma)) return null;
  const radians = angle * Math.PI / 180;
  return Math.max(-1, Math.min(1, (gamma * Math.cos(radians) + beta * Math.sin(radians)) / 30));
}

export async function requestTiltPermission(target = globalThis) {
  const event = target.DeviceOrientationEvent;
  if (!event) return false;
  // Invoke before the first await: iOS requires the originating tap's activation.
  try { return !event.requestPermission || await event.requestPermission() === 'granted'; }
  catch { return false; }
}

export async function enterDrivingScreen(doc = document, screen = globalThis.screen) {
  try {
    if (doc.fullscreenElement) { await doc.exitFullscreen?.(); return; }
    await doc.documentElement.requestFullscreen?.();
    await screen?.orientation?.lock?.('landscape');
  } catch { /* Safari has no element fullscreen/orientation lock: the rotate hint remains. */ }
}
