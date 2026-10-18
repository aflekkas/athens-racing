# Google sign-in policy (2026-10-17)

Google is the only account provider. When GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are configured, the client waits for configuration and a valid session before exposing menus or running gameplay. Missing account storage/session secrets fail closed. There is no guest URL, offline button, Esc/B, close or backdrop dismissal. Privacy and terms open separately. The light Google button inherits the shared game button font, caps and spacing.

OAuth uses a same-tab redirect (including iOS Safari; no popup dependency). Callback cancellation or failure returns to the dialog with a retry message. Network loss blocks play with connection guidance. Sessions revalidate on focus, visibility, every 30 seconds and on account API authorization failure. Multiplayer messages recheck the account session, including existing sockets after logout/deletion/expiry.

Worker routes and the arena require a session for gameplay APIs and multiplayer. Solo and multiplayer leaderboard identities come from the session, never request-supplied names. Health and auth/configuration remain public. Account routes keep their session and CSRF checks.

With no OAuth client configuration, `/api/auth/config` explicitly returns `required: false` and local development/test gameplay retains its existing behavior. The Node server accepts `accountEnv` for account bindings/test stubs and otherwise uses process.env; OAuth configured without account bindings rejects gameplay. Local personal bests remain on the device and the existing one-time account migration imports them; they are not partitioned by account on a shared device.
