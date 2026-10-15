// Deployment identity is injected into index.html by prepare-deploy, never inferred from the URL.
export function environmentBadge(environment, version = 'dev') {
  if (environment === 'production') return '';
  return `${environment === 'dev' || !environment ? 'DEV' : 'STAGING'} · ${version}`;
}
export function buildBadge() {
  const meta = name => typeof document === 'undefined' ? null : document.querySelector(`meta[name="${name}"]`)?.content;
  return environmentBadge(meta('asr-environment') || 'dev', meta('asr-version') || 'dev');
}
