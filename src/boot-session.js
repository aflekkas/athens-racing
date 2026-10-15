// Direct solo URLs wait for a saved online session to identify its lobby before choosing a world.
// A token can also belong to an idle menu session: that must not suppress the requested solo race.
export function waitForBootSession(client, timeoutMs = 8000) {
  if (!client.token || client.connected || client.active) return Promise.resolve();
  return new Promise(resolve => {
    const socket = client.ws;
    const done = () => {
      clearTimeout(timer);
      for (const type of ['message', 'error', 'close']) socket?.removeEventListener(type, check);
      resolve();
    };
    const check = event => { if (client.connected || client.active || event?.type !== 'message') done(); };
    const timer = setTimeout(done, timeoutMs); // offline solo URLs remain usable
    for (const type of ['message', 'error', 'close']) socket?.addEventListener(type, check);
  });
}
