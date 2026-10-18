import { providers, session, json } from '../worker/accounts.mjs';
// OAuth absent is the explicit local/test mode. Missing DB/secrets with OAuth present fails closed.
export const authRequired = env => providers(env).includes('google');
export const protectedPath = path => path === '/ws' || path.startsWith('/api/') && !path.startsWith('/api/auth/');
export async function authorizeGame(request, env) {
  if (!authRequired(env)) return { identity: null };
  try {
    const s = await session(request, env);
    if (!s) return { response: json({ error: 'Sign in with Google to continue.' }, 401) };
    return { identity: { userId: s.user_id, name: s.display_name, expires: s.expires, sessionToken: s.token } };
  } catch { return { response: json({ error: 'Sign-in is temporarily unavailable. Please retry.' }, 503) }; }
}
export const accountResult = (result, identity) => identity ? { ...result, driverId: identity.userId, name: identity.name } : result;
// Validate long-lived transports too; logout/deletion/expiry cannot keep an existing socket usable.
export async function identityActive(identity, env) {
  if (!authRequired(env)) return true;
  if (!identity || identity.expires <= Date.now() || !env.ACCOUNTS) return false;
  return !!await env.ACCOUNTS.prepare('SELECT token FROM sessions WHERE token=? AND user_id=? AND expires>?').bind(identity.sessionToken, identity.userId, Date.now()).first();
}
