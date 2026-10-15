// Internal arena adapter; the public Worker routes /api/account/* through auth instead.
export function arenaAccountStatus(core, url) {
  const token = url.searchParams.get("token");
  const code = url.searchParams.get("code");
  const client = token ? core.sessions.get(token) : null;
  const lobby = client ? client.lobby : code ? core.lobbies.get(code) : null;
  return {
    live: Boolean(lobby),
    code: lobby?.code,
    map: lobby?.mapId,
    status: lobby?.status,
    host: Boolean(client && lobby?.host === client.id),
  };
}
