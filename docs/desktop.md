# Offline desktop edition

The desktop edition is being built to run offline and host LAN games on a player's computer. It follows Cogenly's separation of Electron lifecycle, bundled server, browser client, and shared contracts. Existing hosted deployment remains available during verification.

## Build and launch

Reproducible source gates require Linux x64 with Node 22.23.3 and OpenSSL 3.5.8. Desktop build tools require Node 22 or newer and internet access to install development dependencies and export the world once. Players receive Electron, its Node runtime, the game, fonts, audio, maps, and world objects in the installer; they do not install Node.

```sh
npm ci
npm run desktop:export-world
npm run desktop:repair-world
npm run desktop:prepare-online
npm run desktop:prepare
npm run desktop:start
```

The export is a local copy of the published immutable world and compiled routes. Its manifest records source release and hashes. A guarded repair derives `.desktop/world-release-repaired` from the preserved original `.desktop/world-release`: five Megara graph cells gain their missing emitted-surface ownership. It preserves every geometry byte, the original cell resident-memory budgets, and all six route/rival numeric arrays, rebinds identities, and verifies provenance by replaying the exact repair against the original source. The published revision `80055f…` becomes derived revision `0ac5bf70f50c1d69e74abf25a96d808e119194f0681954b656de07682c4ac2db`. Invalid cached repairs fail closed. Certification and game preparation both select the same verified derived source when present. Certifying that immutable world copy builds and validates eight-player starting grids and complete recovery coverage once in a separate `.desktop/online-release` overlay, cryptographically tied to the imported world inventory. Preparing the browser bundle verifies that certified copy before replacing the prior build; incremental game rebuilds reuse the proofs. Runtime must never fall back to staging, Google Fonts, a CDN, OAuth, R2, or an update server. Keep a verified world export available to rebuild after hosting is retired.

```sh
npm run desktop:pack     # unpacked application for local verification
npm run desktop:dist     # platform installer; no publishing
npm run test:desktop
bash tools/browser-slot.sh node tools/check-desktop.mjs
bash tools/browser-slot.sh node tools/check-desktop-lan.mjs
```

Installers target macOS DMG, Windows NSIS and Linux AppImage. Producing an artifact is distinct from verifying installation on that operating system. Signing is a distribution concern and is not required for runtime connectivity.

## Local profiles and LAN

The renderer has a persistent local origin, default `http://127.0.0.1:17833`. Settings and personal records stay in Electron's local profile; server records live under the application's user-data `saves` directory. Uninstall/reinstall must retain that directory unless the player explicitly deletes it. A port conflict fails visibly instead of silently selecting another origin and making saves appear lost.

Solo binds only to loopback. Hosting explicitly opens a second listener for players on the local network. Joining uses the host's private IP address and displayed port. The renderer keeps reading its own installed assets and reaches the host through a local API/WebSocket gateway. Closing the host ends its session. There is no central lobby directory, account, matchmaking service, relay or required update server.

LAN game releases must match. The complete multiplayer world needs validated starting-grid and recovery artifacts; an online-disabled published route cannot be made safe merely by flipping its flag. The build must preserve those checks and report missing proofs.

For isolated automated verification, main-process environment variables `ASR_DESKTOP_USER_DATA`, `ASR_DESKTOP_PORT`, and `ASR_GAME_ROOT` select a test profile, fixed test port, and built game root. They are not exposed as renderer-controlled settings.

## Release verification

Do not shut down hosting until all required checks pass on the exact candidate:

- Clean-archive unit/world/physics gates and browser import/syntax checks.
- Cold installed launch without internet or prior caches; garage, settings, audio, every race destination and restart persistence.
- Two installed clients: host/join, ready/start, driving, finish, reconnection, host shutdown, and return to solo.
- Full world object inventory and hashes; drive across region boundaries locally.
- Native installer and firewall behavior on each supported platform.

Evidence and exact pass/fail counts belong in the task report. An installer or lobby screenshot alone does not establish a working offline game or LAN race.
