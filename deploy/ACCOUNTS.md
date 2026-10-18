# Google player accounts: owner setup

Google is the only sign-in provider. The Worker reads exactly three secrets: **GOOGLE_CLIENT_ID**, **GOOGLE_CLIENT_SECRET**, and **SESSION_SECRET**. All three are required to enable accounts. SESSION_SECRET keys HMACs for server-side session identifiers and browser-bound OAuth challenges; generate at least 32 random bytes, separately for staging and production. Rotating it signs everyone out and invalidates pending sign-ins. Never commit or log secret values.

Without complete Google configuration, the game keeps the existing guest flow, with optional sign-in marked coming soon. It does not show an offline banner merely because accounts are unconfigured. When configured auth is unavailable, offline play preserves local progress. `?guest=1` remains available for tests/smoke checks.

## 1. Google Cloud client

Create a project in Google Cloud and configure Google Auth Platform branding/consent:

- App name: ATHENS RACING.
- Audience: External; add test users while in Testing, then publish the consent screen when ready.
- Set the owner's support/contact address, homepage `https://athensracing.com`, privacy page `https://athensracing.com/?privacy=1`, and authorized domain `athensracing.com`.
- Requested scopes are only `openid` and `profile`. The app stores the Google account ID, not a Google access token or email address.
- Create an OAuth client of type **Web application**.

Authorized redirect URIs, exactly:

```text
https://athensracing.com/api/auth/google/callback
https://staging.athensracing.com/api/auth/google/callback
```

Authorized JavaScript origins:

```text
https://athensracing.com
https://staging.athensracing.com
```

The implementation uses authorization code + PKCE, browser-bound state and nonce. It verifies Google ID token signatures using Google's public signing keys, issuer, audience, expiry and nonce. See [Google's web-server OAuth guide](https://developers.google.com/identity/protocols/oauth2/web-server) and [OpenID Connect guide](https://developers.google.com/identity/openid-connect/openid-connect).

## 2. Worker secrets

The lead/owner supplies values through interactive prompts. The implementation agent has not created any Worker secrets. Generate a different random SESSION_SECRET of at least 32 bytes for each environment, using a password manager. Set it before the Google credentials so configuration becomes active only when ready.

```sh
npx wrangler secret put SESSION_SECRET --env staging
npx wrangler secret put GOOGLE_CLIENT_ID --env staging
npx wrangler secret put GOOGLE_CLIENT_SECRET --env staging

npx wrangler secret put SESSION_SECRET --env production
npx wrangler secret put GOOGLE_CLIENT_ID --env production
npx wrangler secret put GOOGLE_CLIENT_SECRET --env production
```

Use separate Google clients for each environment if desired; register each client's corresponding redirect URI/origin. For local auth testing, register a localhost callback with a development Google client and use an ignored `.dev.vars` containing the same three names. For normal local play no credentials are needed.

## 3. D1: already created and migrated

Cloudflare account **d6f3d2dc5817687a91d74ccd257bad9e only**:

- Production `athens-racing-accounts`: `965f63b7-a248-415e-ba11-f5f4c15d8c79`.
- Staging `athens-racing-accounts-staging`: `5e3d1170-f253-4de6-bff4-8b8f2c0027f4`.

Migration `0001_accounts.sql` has been applied remotely to both databases, using:

```sh
npx wrangler d1 migrations apply ACCOUNTS --env staging --remote
npx wrangler d1 migrations apply ACCOUNTS --env production --remote
```

These commands are safe to repeat. The release train does not run migrations: apply future migrations before dependent code lands. Confirm the account ID with `npx wrangler whoami`; the repository configuration pins that account. Back up before future schema changes. Use `--local` in place of `--remote` to initialize local development. Default environment bindings deliberately use staging, not production.

## 4. Release checks and privacy

The release train deploys passing `prod` commits to staging and production. This task has not invoked a manual Worker deploy. After secrets are configured on staging, verify a real Google login/callback, profile creation, session cookie flags, two-browser friendship/invite flow, export, deletion and logout before enabling production secrets. Use the free Cloudflare/Google tiers; no paid service is required.

Before activating public accounts, put the real controller name/contact in the privacy page in `src/ui/account-screen.js`. The page is linked from sign-in at `/?privacy=1`. Review retention and Cloudflare/Google processor terms with the owner. Export and deletion are in Account; deletion removes identities, sessions, friends and invites. Device progress remains for offline play and can be cleared in browser settings. Cloudflare's platform backup retention still applies; handle erasure requests when restoring backups.

## Operation

Auth routes: `/api/auth/config`, `/api/auth/session`, `/api/auth/google/start`, `/api/auth/google/callback`, `/api/auth/logout`. Account routes: `/api/account/profile`, `/migrate`, `/friends`, `/invites`, `/presence` (WebSocket), `/export`, `/delete`.

Authenticated mutations require the exact same Origin and `X-CSRF-Token` from the session route. Session cookies are HttpOnly, Secure, SameSite=Lax, with a 30-day expiry; logout revokes the server row. OAuth challenges are one-use and expire after 10 minutes. Login starts are rate-limited. Nightly cleanup deletes expired sessions, challenges, rate limits and invitations. DO migration `v2-accounts` adds FriendsPresence alongside GameArena. Existing race/leaderboard data are unchanged.

Presence uses one heartbeat every 25 seconds and pushes updates only to accepted friends; stale status expires after 65 seconds. Host ownership is verified against the existing multiplayer token before an invite is created. Invites expire in 2 minutes and live lobbies are checked before display and acceptance. Accept uses the existing join-by-code path. Account gating is not an anti-cheat boundary for legacy multiplayer APIs.

First sign-in migrates a snapshot of local settings, bindings, PBs, event records, car selection and saved paint/customization. Local progress is never deleted or overwritten. On another browser, saved keys restore only when absent; refresh loads startup preferences. Subsequent cloud progress sync and account-owned leaderboard attribution are outside this initial migration. Ghost replay blobs stay on-device.
