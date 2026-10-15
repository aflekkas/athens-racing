# Player accounts: owner setup

The implementation creates no secrets and does not deploy. The following databases have already been created **only in Cloudflare account `d6f3d2dc5817687a91d74ccd257bad9e`**:

- Production `athens-racing-accounts`: `965f63b7-a248-415e-ba11-f5f4c15d8c79`
- Staging `athens-racing-accounts-staging`: `5e3d1170-f253-4de6-bff4-8b8f2c0027f4`

Bindings and SQL migrations are committed. No remote migrations have been applied. Use the free tiers; no paid plan is required. Check each provider's free quota before opening public registration.

1. Run `npx wrangler whoami` and verify the account ID above. From a clean reviewed checkout run:
   ```sh
   npx wrangler d1 migrations apply ACCOUNTS --env staging --remote
   npx wrangler d1 migrations apply ACCOUNTS --env production --remote
   ```
   Back up D1 before subsequent migrations. `--local` instead of `--remote` initializes local development. Default environment deliberately binds the staging database, never production.
2. Create a [Google Cloud project and web OAuth client](https://developers.google.com/identity/protocols/oauth2/web-server). Configure Google Auth Platform branding/consent: app name Athens Street Racers, owner support email, homepage `https://athensracing.com`, privacy URL `https://athensracing.com/?privacy=1`, authorized domain `athensracing.com`, audience External. Use only `openid` and `profile`; email is not requested. Add test users while the app is in Testing; publish the consent screen when ready. Create a **Web application** client with these exact authorized redirect URIs:
   ```text
   https://athensracing.com/api/auth/google/callback
   https://staging.athensracing.com/api/auth/google/callback
   ```
   Authorized JavaScript origins (if requested): `https://athensracing.com` and `https://staging.athensracing.com`. Copy client ID and secret into Worker secrets below. Separate OAuth clients for staging/production are recommended; register each environment's URI with its own client. No wildcard redirects.
3. In the [Discord Developer Portal](https://discord.com/developers/applications), create an application named Athens Street Racers. Under OAuth2, add redirects:
   ```text
   https://athensracing.com/api/auth/discord/callback
   https://staging.athensracing.com/api/auth/discord/callback
   ```
   Copy OAuth2 client ID/secret. Only `identify` is used; no bot, guild or email permissions are needed. Separate staging applications can use just their own redirect URI. See [Discord OAuth2](https://discord.com/developers/docs/topics/oauth2).
4. Create a [Resend](https://resend.com/docs/dashboard/domains/introduction) free account. Add `athensracing.com` as a sending domain. In Cloudflare → the same zone → DNS, copy the **exact names and values Resend displays**: DKIM TXT (`resend._domainkey` or the selector Resend supplies), sending return-path MX (`send`, target supplied by Resend), and SPF TXT for that return-path (`send`, value supplied by Resend). These vary by selected region; do not guess or copy example values. Keep mail records DNS-only; don't create a second SPF TXT at an existing name (merge authorized senders). Add the recommended DMARC TXT at `_dmarc` after checking any existing policy. Wait for Resend's Verified status. Create a sending API key scoped to this domain. Default From is `Athens Racing <accounts@athensracing.com>`; optionally configure a nonsecret `EMAIL_FROM` variable with another address on the verified domain. No inbound mailbox is needed to send codes.
5. Set secrets through Wrangler's interactive prompts. Never put values in config, command history, Git, logs or screenshots. Generate a different high-entropy SESSION_SECRET per environment using a password manager (at least 32 random bytes).
   ```sh
   npx wrangler secret put SESSION_SECRET --env staging
   npx wrangler secret put GOOGLE_CLIENT_ID --env staging
   npx wrangler secret put GOOGLE_CLIENT_SECRET --env staging
   npx wrangler secret put DISCORD_CLIENT_ID --env staging
   npx wrangler secret put DISCORD_CLIENT_SECRET --env staging
   # Optional on staging: leaving Resend absent enables visible development codes.
   npx wrangler secret put RESEND_API_KEY --env staging

   npx wrangler secret put SESSION_SECRET --env production
   npx wrangler secret put GOOGLE_CLIENT_ID --env production
   npx wrangler secret put GOOGLE_CLIENT_SECRET --env production
   npx wrangler secret put DISCORD_CLIENT_ID --env production
   npx wrangler secret put DISCORD_CLIENT_SECRET --env production
   npx wrangler secret put RESEND_API_KEY --env production
   ```
   Omit both secrets for any unwanted OAuth provider: the sign-in page hides it. Email is hidden in production without Resend. Missing SESSION_SECRET or D1 causes an offline fallback, not a broken game. For local development, use an ignored `.dev.vars` with a throwaway SESSION_SECRET and run `npx wrangler dev`; do not commit it. Development codes appear only for exact localhost/127.0.0.1/staging.athensracing.com hosts, never on production or workers.dev previews.
6. Before public release, replace the privacy page's owner-contact instruction with the real controller name/contact in `src/ui/account-screen.js`; review retention and provider processor terms with the owner. Privacy is linked from sign-in at `/?privacy=1`. Export and deletion are in Account. Account deletion removes identity, sessions, friends and invites; local progress is retained intentionally and can be cleared in browser settings. No advertising identifiers are collected. D1's platform backup retention still applies; do not restore deleted accounts from backups without handling erasure records.
7. The lead deploys staging, verifies real Google/Discord callbacks, email delivery, cookie flags, two-browser friend/invite flow, and the nightly expiration cleanup. Then the lead deploys production using the normal release process. This task has not deployed either environment. DO migration `v2-accounts` adds FriendsPresence alongside GameArena; daily cron deletes expired sessions, challenges, invites and rate limits. Existing race and leaderboard data are untouched.

## Operation and limits

Auth routes are `/api/auth/config`, `/session`, `/email/request`, `/email/verify`, `/{google|discord}/{start|callback}`, `/logout`. Account routes are `/api/account/profile`, `/migrate`, `/friends`, `/invites`, `/presence` (WebSocket), `/export`, `/delete`. All mutation routes require the same Origin; authenticated mutations also require `X-CSRF-Token` from `/api/auth/session`. Session cookies are HttpOnly, Secure, SameSite=Lax with a 30-day expiry; logout deletes the server session. Email codes and OAuth challenges expire in 10 minutes and are one-use; attempts are limited. OAuth identity is keyed by provider subject, never merged based on an unverified email.

Presence sends one heartbeat per 25 seconds per connected account and pushes accepted-friend updates; disconnect expires after 65 seconds. Hosts are verified against the arena's existing multiplayer session token before invitations are created. Invitations expire after 2 minutes and are checked against the live arena both when displayed and accepted. Accept uses the existing multiplayer join-by-code path. `?guest=1` bypasses the browser account gate for existing smoke tests. Auth outages and offline mode keep device progress playable; this is not an anti-cheat access-control boundary for legacy multiplayer APIs.

First sign-in stores a one-time snapshot of local settings, input bindings, personal bests, event records, car selection and paint/customization. Existing local progress is never cleared or overwritten. On a different browser, saved keys restore only when absent; refresh loads preferences read during startup. Subsequent progress cloud-sync and account-linked leaderboard ownership are outside this initial migration. Audio uploads and ghost replay blobs stay on-device.
