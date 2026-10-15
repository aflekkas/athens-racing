# Accounts implementation evidence

The screenshot harness is `tools/accounts-browser.mjs`, run through the shared `tools/browser-slot.sh`. Screens use the real Menu, Account module and all game UI styles. Google OAuth, account responses, friend identities and invitations are fixtures; screenshots do not imply real provider credentials were configured. No real Google request is made by account tests or the browser harness.

Required screenshots at both 1280 × 900 and 390 × 844:

- `sign-in-{1280,390}.png`: configured Google sign-in, full-screen sign-in, privacy and offline entry.
- `name-pick-{1280,390}.png`: first-account display name and plate selection.
- `account-friends-{1280,390}.png`: profile, accepted friend ELENI online/in-race on Riviera, pending request, invitation inbox (scrollable on phones).
- `incoming-invite-{1280,390}.png`: real shared toast UI over Account.

These are UI-only captures; no three.js world or rendering preset runs, and no map geometry or draw calls were added. Riviera appears as the friend's fixture presence map. `browser-report.json` records no page errors or horizontal overflow, plus checks for offline degradation, guest bypass, privacy navigation and preserving unsaved profile inputs during a refresh.

`focused.log` is the no-network account suite with SQLite-backed D1 semantics and real WebCrypto signatures. It checks login rate limits, CSRF, expiry/revocation, deletion/export, Google state/browser binding/PKCE/nonce/signature and SESSION_SECRET rotation, friendship transitions/blocking, presence fan-out, live/expired invites, real core lobby joining, migration idempotence and offline behavior.

Full repository gates are captured from the clean archive commit named in `validation.json`; each `.exit` file is the process exit code. Remote D1 databases and the initial schema migration are complete in the authorized account for staging and production. Provider registration, Worker secret creation and the release train remain under the lead/owner. No manual Worker deploy was invoked.
