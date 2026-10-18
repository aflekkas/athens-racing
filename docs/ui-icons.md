# UI icons

Owner decision, 2026-10-17: Lucide is the only UI icon library. All menu and touch-control icons use `icon()` / `iconEl()` in `src/ui/components.js`, styled in `src/ui/ui.css`. Brand artwork (Google G, manufacturer badges) is unchanged. Vehicle instrument telltales and world road-sign artwork retain their specialized authored graphics.

## Offline source and licence

The used SVGs are copied unchanged from **lucide-static 1.59.0** ([Lucide](https://lucide.dev)). `assets/icons/lucide.json` pins the package, tarball integrity and SHA-256 of each vendored file. `assets/icons/LICENSE` carries the full upstream ISC notice and Feather MIT attribution. No runtime dependency or CDN is used.

To add an icon, download the exact pinned tarball named in `lucide.json`, verify its integrity, copy `package/icons/<name>.svg` unchanged, add its SHA-256 to the manifest, and run `node tools/build-icon-sprite.mjs`. Keep only icons actually used. Use canonical Lucide names, `viewBox="0 0 24 24"`, `fill="none"`, `stroke="currentColor"`, `stroke-width="2"`, and rounded caps/joins. The sprite retains those attributes for external and in-document references.

## Shared labels

Dropdown options support `[value, label, { icon: 'arrow-down' }]`. The shared Select renders the icon in both its selected value and its listbox; the selection check remains separate. Use `iconLabel()` for inline icon labels. The hero option’s START label is component markup with `chevron-right`. Render arrow/check/close affordances through `icon()`, never Unicode glyphs or CSS content. Plain-text bindings and exported route descriptions spell out directions.

## Migration mapping

Unused legacy SVGs were removed. Existing canonical equivalents (camera, car, check, cloud, cloud-rain, copy, crown, flag, gauge, ghost, globe, info, keyboard, link, map-pin, monitor, moon, mouse, pause, play, plus, sliders-horizontal, star, sun, timer, traffic-cone, trash, truck, user, user-plus, users, wrench, x, arrow-left, arrow-right, siren) retain their names.

| Previous icon | Lucide icon |
| --- | --- |
| `arrow-counter-clockwise` | `rotate-ccw` |
| `arrows-clockwise` | `refresh-cw` |
| `arrows-left-right` | `arrow-left-right` |
| `car-profile` | `car` |
| `caret-down` | `chevron-down` |
| `caret-left` | `chevron-left` |
| `caret-right` | `chevron-right` |
| `caret-up` | `chevron-up` |
| `cube` | `box` |
| `device-mobile` | `smartphone` |
| `export` | `share` |
| `flag-checkered` | `flag` |
| `game-controller` | `gamepad-2` |
| `gear-six` | `settings` |
| `hand-tap` | `hand` |
| `lightning` | `zap` |
| `list` | `menu` |
| `lock-simple` | `lock` |
| `magnifying-glass` | `search` |
| `map-trifold` | `map` |
| `mountains` | `mountain` |
| `path` | `route` |
| `police-car` | `siren` |
| `sign-in` | `log-in` |
| `sign-out` | `log-out` |
| `speaker-high` | `volume-2` |
| `speedometer` | `gauge` |
| `steering-wheel` | `circle-gauge` |
| `sun-horizon` | `sunrise` |
| `tire` | `circle-dot` |
| `users-three` | `users` |
| `warning` | `triangle-alert` |

Glyph replacements: sort ↓/↑ → `arrow-down`/`arrow-up`; START › and spectator ‹/› → `chevron-right`/`chevron-left`; READY ✓ → `check`; mobile pause Ⅱ → `pause`; touch steering triangles → `chevron-left`/`chevron-right`. Music icons were already removed.

`npm test` checks source icon references, vendored hashes, sprite equality and the absence of UI arrow/check glyphs.
