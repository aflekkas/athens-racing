# Standalone legal pages — 2026-10-15

The Worker serves `/privacy` and `/terms` before account/API/asset handling. Both are listed in `assets.run_worker_first`, including slash and `.html` redirects. The `www` host redirects these routes to `athensracing.com`. No build asset allowlist change is required: legal HTML and inline CSS are compiled into the Worker rather than copied to the asset bucket. `server/index.mjs` uses the same response handler for local development. The sitemap adds both canonical URLs; existing Worker sitemap rewriting supplies staging-host URLs.

Screenshots at 1280×900 and 390×844 cover the privacy/terms pages, sign-in links, account privacy summary, About and Credits links. Full-page legal screenshots are intentionally taller than the viewport. `tools/privacy-browser.mjs` runs through `tools/browser-slot.sh`; assertions cover a single document request, no scripts, no horizontal overflow, menu links, and opening the standalone privacy document through menu activation. The screenshots were visually inspected.

## Collection findings and limits

- Current Google scopes are `openid profile`, **not** `openid email profile`. The policy documents the implemented scopes. Only provider + `sub` are stored; email/name/picture are not stored. This task does not expand Google data access.
- Account progress is a one-time allowlisted import, not continuous cloud synchronization.
- Account export/deletion do not include the separate leaderboard database, active multiplayer records or local browser storage. The policy directs leaderboard requests to the contact email and explains browser clearing.
- IP handling is operational but not solely in-memory: leaderboard IP limits and reconnect state use Durable Object storage. OAuth IP hashes have expiry and daily cleanup; leaderboard old IP rows are removed on subsequent submissions. No fixed provider log/backup retention or specific international transfer safeguards are established in the code; none are invented here.
- No game analytics tracker was found. Optional YouTube playback explicitly connects to Google/YouTube and has its own cookie/privacy practices.
- The minimum-age rule is published, but code does not verify date of birth. Account routes and consent do not implement a separate age-verification flow.
- No automatic inactive-account deletion or timed leaderboard expiry exists.

Content audit: `worker/accounts.mjs`, `worker/google-token.mjs`, `worker/presence.mjs`, `worker/account-arena.mjs`, `worker/index.mjs`, `worker/leaderboard.mjs`, `migrations/*.sql`, `src/accounts-client.js`, `src/account-progress.js`, `src/leaderboard.js`, `server/leaderboard*.mjs`, `server/index.mjs`, `server/core.mjs`, storage/music/service-worker modules. GDPR rights/legal-basis wording checked against the EU guide linked in the document. Controller/contact and effective date were supplied in the task.

Release validation is run against an isolated `git archive` of the candidate commit. Gate logs and exit markers are saved alongside this report after completion. No push or deploy is performed by this task; the existing release train owns publication.
