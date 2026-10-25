// The renderer can reach only the local facade. The Node server owns LAN traffic.
export function trustedURL(value, origin, { socket = false } = {}) {
  try {
    const url = new URL(value), local = new URL(origin);
    if (url.username || url.password) return false;
    if (socket && url.protocol === 'ws:') url.protocol = 'http:';
    return url.origin === local.origin && url.protocol === 'http:';
  } catch { return false; }
}

export function rendererRequestAllowed(value, origin) {
  if (trustedURL(value, origin, { socket: true })) return true;
  // Three.js workers are constructed from local, generated blob URLs.
  if (value.startsWith('blob:')) return trustedURL(value.slice(5), origin);
  return value.startsWith('data:');
}

export function assertTrustedSender(event, window, origin) {
  if (!window || window.isDestroyed() || event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame ||
      !trustedURL(event.senderFrame?.url, origin)) {
    throw new Error('Desktop command rejected: untrusted sender.');
  }
}

export function assertJoinAddress(address) {
  if (typeof address !== 'string' || address.length < 1 || address.length > 255 || address.trim() !== address) {
    throw new Error('Enter the host address shown by the hosting player.');
  }
}

// Mouse look and normal fullscreen are game controls, scoped to its main frame.
export function gamePermissionAllowed(permission, requestingURL, origin, isMainFrame) {
  return isMainFrame === true && ['pointerLock', 'fullscreen'].includes(permission) && trustedURL(requestingURL, origin);
}

// Results are rendered locally as a 1200×900 PNG. This does not grant general
// downloads: only the live game's main frame may request this bounded blob.
export const RESULT_DOWNLOAD_MAX_BYTES = 8 * 1024 * 1024;
export function trustedResultDownload(item, contents, frame, window, origin) {
  try {
    if (!window || window.isDestroyed() || contents !== window.webContents ||
        frame !== window.webContents.mainFrame || !trustedURL(frame?.url, origin) ||
        item.getInitiatorOrigin() !== origin || item.hasUserGesture() !== true ||
        item.getFilename() !== 'athens-racing-result.png' || item.getMimeType() !== 'image/png') return false;
    const url = item.getURL(), chain = item.getURLChain(), bytes = item.getTotalBytes();
    return typeof url === 'string' && url.startsWith('blob:') && trustedURL(url.slice(5), origin) &&
      Array.isArray(chain) && chain.length === 1 && chain[0] === url &&
      Number.isSafeInteger(bytes) && bytes > 0 && bytes <= RESULT_DOWNLOAD_MAX_BYTES;
  } catch { return false; }
}
