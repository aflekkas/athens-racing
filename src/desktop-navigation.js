// Only the preload capability enables desktop controls; URL parameters cannot.
export const desktopAvailable = (scope = globalThis) => ['session', 'host', 'join', 'solo'].every(name => typeof scope.athensDesktop?.[name] === 'function');
export function desktopLaunchURL(href, mode) {
  if (!['solo', 'host', 'join'].includes(mode)) throw Error('Unknown local session mode');
  const url = new URL(href); url.search = ''; url.hash = '';
  url.searchParams.set(mode === 'solo' ? 'desktopSolo' : 'desktopLan', mode === 'solo' ? '1' : mode);
  return url.href;
}
export function takeDesktopLaunch(location, history) {
  const url = new URL(location.href), lan = url.searchParams.get('desktopLan');
  const mode = url.searchParams.has('desktopSolo') ? 'solo' : ['host', 'join'].includes(lan) ? lan : null;
  if (mode) { url.searchParams.delete('desktopSolo'); url.searchParams.delete('desktopLan'); history.replaceState(null, '', url); }
  return mode;
}

// Explicitly changing hosts ends the old session. Ordinary reload/reconnect does
// not call this, so the existing reconnect reservation remains available.
export function clearDesktopSession(storage) {
  try { storage ??= globalThis.sessionStorage; storage?.removeItem('paraliaki.session'); storage?.removeItem('paraliaki.route-session'); } catch {}
}

// Hosting is idempotent while already hosting; retain that lobby's resume token.
// Solo and Join explicitly leave the prior session in the native runtime.
export const desktopTransitionEndsSession = (previous, operation) => operation !== 'host' || previous?.mode !== 'host';

// A desktop invite names the player's LAN server, never this client's loopback
// facade. Joined players share the upstream host, not their own interface.
export function desktopInvite(session, lobby) {
  const code = typeof lobby?.code === 'string' ? lobby.code.toUpperCase() : '';
  if (!['host', 'join'].includes(session?.mode) || !/^[A-Z0-9]{6}$/.test(code)) return null;
  const choices = session.mode === 'join' ? [session.address] : [...(session.addresses || []), session.address];
  const addresses = [...new Set(choices.flatMap(value => {
    if (typeof value !== 'string') return [];
    try {
      const url = new URL(value.includes('://') ? value : 'http://' + value), host = url.hostname.replace(/^\[|\]$/g, '');
      const privateHost = /^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|169\.254\.)/.test(host) || /^(?:f[cd]|fe[89ab])/i.test(host);
      return url.protocol === 'http:' && privateHost && url.port && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash ? [url.host] : [];
    } catch { return []; }
  }))];
  if (!addresses.length) return null;
  return { addresses, code, text: `Athens Racing LAN · Host: ${addresses.join(' or ')} · Lobby: ${code} · Open LAN MULTIPLAYER, enter a host address, choose JOIN LAN GAME, then join lobby ${code}. Both computers need this game installed and the same local network.` };
}
