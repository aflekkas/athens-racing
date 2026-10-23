// The page's only module (index.html). DESKTOP ONLY, owner decision 2026-10-19: a phone or tablet is stopped here, before
// sign-in, the title menu or any download, so main.js (native) or boot.js (the bundle, tools/bundle-browser.mjs) and everything
// they import stay on the server. Everything else goes straight on to the game.
import { deviceBlockReason, readDevice, showDeviceGate } from './device-gate.js';


// Keep the entry dependency-free apart from the desktop gate. Resolve small JSON snapshots,
// not live Responses: the game may finish importing after the request deadline.
export function prefetchAuthJSON(path, { fetcher = fetch, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const controller = new AbortController(), limit = path === '/api/auth/config' ? 16384 : 262144;
  let reader, timer;
  const cancel = (body, error) => { try { body?.cancel(error)?.catch(() => {}); } catch {} };
  const release = () => { try { reader?.releaseLock(); } catch {} };
  const deadline = new Promise((_, reject) => {
    timer = setTimer(() => {
      const error = new DOMException('Sign-in request timed out.', 'TimeoutError');
      reject(error); controller.abort(error); cancel(reader, error); release();
    }, 8000);
  });
  const complete = (async () => {
    const response = await fetcher(path, { credentials: 'same-origin', signal: controller.signal });
    if (controller.signal.aborted) { cancel(response.body, controller.signal.reason); throw controller.signal.reason; }
    try {
      if (Number(response.headers.get('content-length')) > limit) {
        throw new RangeError('Sign-in response is too large.');
      }
      reader = response.body?.getReader();
      const decoder = new TextDecoder('utf-8', { fatal: true });
      let bytes = 0, text = '';
      if (reader) while (true) {
        const { done, value } = await reader.read();
        controller.signal.throwIfAborted();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > limit) throw new RangeError('Sign-in response is too large.');
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
      return { status: response.status, ok: response.ok, body: JSON.parse(text) };
    } catch (error) { cancel(reader || response.body, error); throw error; }
    finally { release(); }
  })();
  const answer = Promise.race([complete, deadline]).finally(() => clearTimer(timer));
  // Entry starts both requests even when a local providers[] config will not use the session.
  // Retain rejection for its one consumer, without an unhandled-rejection window.
  answer.catch(() => {});
  return answer;
}

const reason = deviceBlockReason(readDevice());
if (reason) showDeviceGate(document, reason);
else {
  // The launch's session check starts now, alongside loading the game, not after it (src/accounts-client.js uses these answers).
  globalThis.__authPrefetch = { '/api/auth/config': prefetchAuthJSON('/api/auth/config'), '/api/auth/session': prefetchAuthJSON('/api/auth/session') };
  globalThis.__routeEntryPrefetch=import('./route-entry-prefetch.js').then(m=>m.prefetchDirectRace(new URLSearchParams(location.search))).catch(()=>null);
  await import('./main.js');
}
