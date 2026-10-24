# Athens Racing static download site

Separate candidate from the desktop application. Original design remains at `.scratch/desktop-landing-design/` (Claude Opus 5.5); integration by Codex gpt-6.1-sol. Publish only `public/`. Its sibling isolated Wrangler config defines a static-assets service with no game bindings, cron, routes or deployment hook. Nothing was published and existing Cloudflare services remain unchanged.

Run `node apps/landing/check.mjs` for local integrity/download-gate checks. Serve `public/` with a static HTTP server for review. The host should honor `_headers`; HTML also carries a restrictive meta CSP. No build step, external scripts/fonts, analytics, storage, fetches, audio or service worker. Attribution links and future GitHub downloads are user-initiated navigation.

`public/release.js` is the only release configuration. Keep all URLs null until the exact final artifact is publicly available, hash-checked and installed/tested on its target OS. Each enabled card requires a nonempty version, exact HTTPS `github.com/aflekkas/athens-racing/releases/download/<tag>/<file>` URL with no credentials/query/fragment,64hex SHA-256, positive integer bytes and explicit `nativeVerified:true`. Supply truthful platform-specific installNote, including unsigned/notarized status as appropriate. No browser feature can independently prove a native test; this flag is filled only from the release receipt. Linux remains hidden until verified. There are no preview query switches or example public links. Do not replace hosted game until parent confidence/cutover gates pass.

## Asset sources

- `public/assets/*-800.webp` and `*-1600.webp`: own-game JPEGs `.scratch/desktop-check/source-after/`, same basenames. Six route captures cropped to the road scene (left0,top220,width2880,height890); LAN capture retained whole. Sharp resized/encoded quality78; source images preserved. Sources visually inspected. Screens represent testing snapshots, not final-release verification.
- `public/assets/icon.svg`: existing `assets/icon.svg` Athens Racing mark.
- `public/assets/icons-LICENSE.txt`: existing Lucide ISC notice, applies to inline icon strokes retained from prototype.
- `public/fonts/`: five unmodified existing Barlow TTFs, SIL OFL1.1 with complete OFL/source credits copied from `apps/game/fonts/`. Full TTFs deliberately retained without unverified font-subsetting toolchain.

`manifest.json` records every static file/hash for this separate candidate. Regenerate it after editing assets or release configuration. Desktop final archive must exclude this namespace until explicitly reviewed for that scope. Browser responsiveness, keyboard, motion and network receipts are recorded separately after the shared browser slot is available. No install links are promised before native QA.

## Sharing and branding

Canonical and Open Graph URL use the intended production origin `https://athensracing.com/`. Open Graph/Twitter metadata describes desktop offline solo/LAN, with truthful unavailable downloads. `public/assets/athens-racing-share.jpg` is a1200x630 branded image composed by `make-share.mjs` from the locally cropped own-game Riviera WebP, existing OFL Barlow fonts and original game icon; no new AI imagery or third-party screenshots. `apple-touch-icon.png` is180x180 from the same game SVG mark. Metadata adds no automatic external requests. No ratings, fake release URLs or download structured data. The share image is intentionally a site image, not a verified release screenshot or installer availability promise.
