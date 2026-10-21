// The page's only module (index.html). DESKTOP ONLY, owner decision 2026-10-19: a phone or tablet is stopped here, before
// sign-in, the title menu or any download, so main.js (native) or boot.js (the bundle, tools/bundle-browser.mjs) and everything
// they import stay on the server. Everything else goes straight on to the game.
import { deviceBlockReason, readDevice, showDeviceGate } from './device-gate.js';

const reason = deviceBlockReason(readDevice());
if (reason) showDeviceGate(document, reason);
else {
  // The launch's session check starts now, alongside loading the game, not after it (src/accounts-client.js uses these answers).
  const ask = path => { const answer = fetch(path, { credentials: 'same-origin', signal: AbortSignal.timeout(8000) }); answer.catch(() => {}); return answer; };
  globalThis.__authPrefetch = { '/api/auth/config': ask('/api/auth/config'), '/api/auth/session': ask('/api/auth/session') };
  await import('./main.js');
}
