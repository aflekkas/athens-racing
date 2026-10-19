# Production client bundles

Local play (`npm start`) uses the import map and native modules in `src/`; no build step is needed.
`node tools/prepare-deploy.mjs` produces the deployment with esbuild, minification, ES2022 modules,
content-hashed entry/chunk names and a bundled, tree-shaken copy of the pinned three.js/addons.
The page's own module is the desktop gate, `src/entry.js` (owner decision 2026-10-19: computer only). It decides with `src/device-gate.js`
and only then `import()`s the game entry (`main.js` natively, `boot.js` in the bundle, rewritten by the bundler), so a phone or tablet downloads
the gate and nothing else. `tools/bundle-browser.mjs` builds both as entry points and counts the dynamic import's chunks as initial, so the
service worker still precaches the menu shell. `tools/owner-locked-desktop-only.test.mjs` guards that.
The game entry paints the ordinary Menu before importing the simulation. The existing silent performance check stays with the actual game renderer, so the GPU determines
the same performance class as native play. The fresh title creates no world and fetches no map data. Garage, account and multiplayer
screens and the three map scenery implementations have dynamic import boundaries.

`ASR_THREE_MODE=cdn` retains the pinned development import map as an operational fallback.
Its module workers remain bundled because document import maps do not apply to workers.
`ASR_CLIENT_BUNDLE=source` restores native source deployment. Neither changes the multiplayer
protocol or the build metadata sent by the client. Auth policy/session initialization remains eager;
the account screen implementation waits until account UI or a required sign-in flow needs it.
Privacy and terms are server-rendered HTML.

External sourcemaps (with sources) are emitted to `.deploy/sourcemaps/src/`, outside public assets.
They contain no publicly linked `sourceMappingURL`. CI uploads that directory together with
`.deploy/browser-metafile.json` as a private release/debug artifact (30-day retention). Do not put it under
`.deploy/assets` or publish it through the static asset binding.

The release manifest lists every published hashed chunk. Its core list follows only static imports
of the menu entry, so the service worker does not fetch lazy worlds, screens or map data at install.
A failed lazy import checks the current network index and reloads once for a newer build;
offline/same-build failures retain their original error. Existing content cache pruning,
navigation release checks and update/reload registration remain
in `src/service-worker.js` and `src/offline-cache.js`.

Checks:

```
node tools/check-browser-imports.mjs
node tools/check-syntax.mjs
node tools/prepare-deploy.mjs
tools/browser-slot.sh node tools/check-bundle.mjs
PORT=8001 node tools/serve-bundle.mjs
node tools/deploy-smoke.mjs http://127.0.0.1:8001 --race
```

The browser check uses the pinned Playwright dev dependency and its installed Chromium.
`PLAYWRIGHT_MODULE` and `CHROME_BIN` override them; the VPS defaults remain supported.
CI runs the check after its staging dry-run build.
It verifies a fresh title (including service worker install) makes zero `/data/` requests and owns
no map, then starts a Quick Race on each map through the real car picker.
The harness advances the real countdown and camera transition before capturing each race. Evidence goes to
`.scratch/bundle-check` (`BUNDLE_EVIDENCE` overrides it).

`tools/measure-bundle.mjs OUTPUT LABEL=ASSETS [...]` interleaves five cold/warm runs per variant.
It records Resource Timing bytes/request counts, time-to-menu, CDP script CPU and V8 parse/compile
trace intervals (merged per thread to avoid counting nested events twice). Service workers are
blocked for that controlled HTTP-cache comparison; the functional browser check covers them.
To rotate builds in one asset tree (and avoid duplicate repository/bake copies), set
`BUNDLE_BEFORE_REF` to the baseline commit and `BUNDLE_REPOSITORY` to its Git repository:

```
BUNDLE_BEFORE_REF=BASELINE_SHA BUNDLE_REPOSITORY=/path/to/repository \
  tools/browser-slot.sh node tools/measure-bundle.mjs /path/to/evidence \
  before-source= before-bundled= after-bundled= after-cdn=
```

This reads baseline source from Git, rebuilds the same asset directory between visits, and restores
working source after each build. Cold and warm navigations share a context; variants/runs use fresh
contexts. The common baked assets and presentation settings are held fixed. Capture all variants on
the same machine/browser. Browser checks and local deploy-smoke use the complete production build.
