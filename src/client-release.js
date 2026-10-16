// A tab can outlive a deployment that removed its not-yet-loaded hashed chunks.
let checking;
const attempted = new Set();
function sessionStorageOrNull() { try { return globalThis.sessionStorage; } catch { return null; } }
export async function reloadIfUpdated({ document = globalThis.document, location = globalThis.location, fetcher = globalThis.fetch, storage = sessionStorageOrNull() } = {}) {
  const build = document?.querySelector('meta[name="asr-build"]')?.content;
  if (!build || !location || !fetcher) return false;
  if (checking) return checking;
  checking = (async () => {
    try {
      // A non-navigation fetch of / bypasses the worker's cached index and the HTTP cache.
      const response = await fetcher(new URL('/', location.href), { cache: 'no-store', credentials: 'same-origin', signal: AbortSignal.timeout(8000) });
      if (!response.ok) return false;
      const next = /<meta name="asr-build" content="([^"]+)"/.exec(await response.text())?.[1];
      if (next === build) return false;
      const key = `asr-chunk-reload:${build}:${next || 'unmanaged'}`;
      if (attempted.has(key)) return false;
      attempted.add(key);
      try { if (Number(storage?.getItem(key)) > Date.now() - 30000) return false; storage?.setItem(key, String(Date.now())); } catch { /* storage may be disabled */ }
      location.reload(); return true;
    } catch { return false; /* offline or an unavailable origin */ }
  })();
  try { return await checking; } finally { checking = null; }
}
export async function importWithUpdate(load, options) {
  try { return await load(); }
  catch (error) {
    if (await reloadIfUpdated(options)) return new Promise(() => {}); // navigation replaces this document
    throw error;
  }
}
