// Deployment identity is injected into index.html by prepare-deploy, never inferred from the URL.
// A staging build is everything since the last release (CHANGELOG "Unreleased"), so it is named by its commit, not by
// the last release's version: "STAGING · 2026.10.15.3" read as a stale build (owner, 2026-10-20).
export function environmentBadge(environment, version = 'dev', sha = null) {
  if (environment === 'production') return '';
  if (!environment || environment === 'dev') return 'DEV';
  return sha ? `STAGING · ${sha}` : `STAGING · ${version}`;
}
const meta = name => typeof document === 'undefined' ? null : document.querySelector(`meta[name="${name}"]`)?.content;
/** the deployed commit, when prepare-deploy stamped one */
export const buildSha = () => meta('asr-sha') || null;
export function buildBadge() {
  return environmentBadge(meta('asr-environment') || 'dev', meta('asr-version') || 'dev', meta('asr-sha'));
}
