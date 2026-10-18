# Shared page layouts

Use a named layout exported by `src/ui/components.js`. Screens supply HTML built
from kit components; `src/ui/ui.css` owns page geometry. Escape user text with
`C.esc`. `screen()` remains a compatibility primitive during migration, not an API
for new screens. Templates ignore `body` and `head`: use their named slots.

All templates accept `title`, `kick` (breadcrumb), `back`, `hints`, `foot`, and
`cls` (screen identity/state, not layout overrides). Inner headers have Back,
breadcrumb and title only. No account chip or wall clock. The frame owns safe-area
padding and key hints. Its regions shrink without pushing the footer offscreen.

| Builder | Use | Content regions |
| --- | --- | --- |
| `heroTiles` | Title and RACE | `hero`, `tiles`, optional `intro` |
| `sidebarContent` | Settings, account | `nav`, `content` |
| `browseGrid` | Garage, lobby browser, leaderboards | optional `filters`, `items`; `list: true` for rows |
| `stageInspector` | Car detail, track confirmation | `stage`, `inspector` |
| `mapStage` | Track picker | full-bleed `stage`, floating `card` |
| `sheetList` | Pause, results, information and simple lists | `rows`, optional `aside`, `actions` |

Desktop uses two columns for navigation/viewer layouts, tiles that fill available
height, and a bounded readable sheet. At 860px in portrait navigation becomes a
strip and the inspector a lower sheet. At 560px tiles stack, filters wrap, and the
map card spans the width. Short landscape (500px high or less) retains side-by-side
navigation/viewer regions and independent scrolling. Grid items never exceed the
viewport at 390px. The kit owns `--layout-gap`, `--layout-sheet-width`,
`--layout-rail-width`, and `--layout-card-min`; do not override them in screen CSS.

```js
return C.browseGrid({
  title: 'GARAGE', kick: 'YOUR CARS',
  filters: C.searchField({ name: 'car-search', label: 'Find a car' }),
  items: cars.map(car => C.carCard(car)).join(''),
  hints: [['select', 'SELECT'], ['confirm', 'OPEN'], ['back', 'BACK']],
});
return C.sidebarContent({
  title: 'SETTINGS', kick: 'OPTIONS',
  nav: C.nav({ key: 'category', value: category, options }),
  content: C.panel('DRIVING', controls), hints: [['back', 'BACK']],
});
```

Interaction handlers, focus IDs, selection state and canvas lifecycle stay in the
owning screen. Templates never clone or reinterpret content. Existing selection
animations and surface focus come from components. During rollout migrate one
screen after its current owner lands; compare desktop and phone captures. Preserve
the locked title layout and pause placement with kit-owned variants.

`sheetList({ variant: 'pause', kick, title, status, rows, actions, hints })`
keeps the locked inset sheet header, left docking and full-width phone sheet.
The kit owns its two-column short-landscape rows and backdrop lifecycle. It is a
full screen, not a dialog. The pause screen supplies only option rows and controls.

`sheetList({ variant: 'split', rows, actions, aside })` puts actions after the
summary and supporting panels alongside it. At 860px the body scrolls as one
column; short landscape restores independently scrolling columns.

`sheetList({ variant: 'reading', rows, actions })` centres readable panels at
52rem with their existing scroll boundary; trailing links remain below the panel.
`stageInspector({ variant: 'media', stage, inspector })` contains an image in the
available height with an optional caption underneath.

`sidebarContent({ variant: 'balanced', nav, content })` pairs a profile/navigation
panel with related panels (68rem maximum, stacked at 860px).
`sheetList` also supports `narrow` (34rem form) and `flow` (full-width rows).
The sign-in exception uses `dialog({ fullScreen: true })`; its shell stays in the kit.

`browseGrid({ variant: 'filtered', filters, aside, items, busy })` places tabs below
the title and a filter rail beside ranked results; it stacks below 700px. The kit
owns the live-results region and its busy state.

`stageInspector({ variant: 'overview', stage, inspector, actions })` pairs a compact
track overview with related records. It stacks below 700px and keeps actions in
the shared footer.

`browseGrid({ variant: 'catalog', filters, items })` keeps the garage filter strip
under the title and scrolls it horizontally on phones. `stageInspector` supports
`vehicle` with `stageAttrs` for renderer IDs/labels and a shared specification
panel in `inspector`; the kit owns the full viewer bounds and mobile stacking.

`sidebarContent({ variant: 'rail', nav: C.nav(...), content })` keeps the section
rail beside a scrolling panel. Below 860px the rail becomes a horizontal strip;
short landscape screens restore a compact sidebar. Header, navigation and content
remain separate named regions. The About section uses this same frame.

`mapStage({ variant: 'floating', stage, stageAttrs, nav, card, cardAttrs, cardHint })`
places the map behind the header/footer and a glass card on the right. Portrait
phones below 700px use a bottom sheet; short landscape screens keep a compact
right card. The template owns positioning, safe regions and card scrolling; the
map module owns only canvas drawing, geographic labels, pins and attribution.

Lobby browsers use `browseGrid({variant:'lobby', join, identity, actions, items})`: the
kit places code entry, identity and host action over the list. Track-based setup uses
`stageInspector({variant:'tracks', stage, collection, inspector})`; track cards scroll
horizontally on phones. `variant:'showroom'` takes `caption`, `summary`, `inspector`
and optional `stage` content while owning the persistent 3D mount. Compact rules/forms
use `sheetList({variant:'form', rows})`; multiplayer results reuse `variant:'split'`.

`heroTiles({variant:'choices', tiles})` fills the content height with two artwork
choices, side by side on desktop and stacked on phones.
