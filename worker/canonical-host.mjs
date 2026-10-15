// New document/asset requests and OAuth navigations always use the registered origin.
// Existing API/WebSocket clients remain on their current origin: redirects would
// drop POST bodies/cookies or fail the API's and socket's same-origin checks.
export function canonicalHostRedirect(request) {
  const url = new URL(request.url);
  if (url.hostname !== 'www.athensracing.com') return null;
  const oauthNavigation = ['/api/auth/google/start', '/api/auth/google/callback'].includes(url.pathname);
  if (url.pathname === '/ws' || (url.pathname.startsWith('/api/') && !oauthNavigation)) return null;
  url.protocol = 'https:';
  url.host = 'athensracing.com';
  return Response.redirect(url.href, 301);
}
