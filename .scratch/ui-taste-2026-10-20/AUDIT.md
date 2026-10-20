# UI taste pass: audit (2026-10-20)

Before-shots: `.scratch/ui-taste-2026-10-20/before/<screen>/<screen>-{1280x800,960x700}.png`. These were captured from a clean
archive of `prod` @ 1925f9d3, signed in through the stub Google (`server/accounts-stub.mjs`), using `capture.mjs` in this folder.

## What is actually wrong

The kit is in better shape than "AI slop" suggests. Its surfaces are calm and flat, it has one font family and one primary pill. The slop sits on top of the kit, in **copy and in decoration that each screen added**:

1. **Every box gets a label.** Panels get a spaced-caps title plus a decorative icon ("YOUR TRACK", "YOUR RACE", "FILTER TIMES", "COMPARE TIMES", "LOBBY", "SESSION", "PROFILE"). Stat captions get icons. Most of these titles restate the screen title or the obvious contents.
2. **Shouting microcopy.** Settings notes are long ALL-CAPS condensed lines joined by middots, for example "HOW SHARP THE PICTURE IS · LOWER IS BLURRIER BUT FASTER · NOW 80% OF YOUR SCREEN · …". Race setup notes, lobby hints and garage card subtitles do the same. They are the loudest thing on screen and the least important.
3. **Kickers that aren't breadcrumbs.** "CHOOSE YOUR MODE", "LIVE RACING / 2–8 DRIVERS", "GARAGE · 31 / 31 CARS", "YOUR DRIVER ACCOUNT", "QUICK RACE / YOUR TRACK". The locked style calls for a breadcrumb, which is the parent's name and nothing else.
4. **Competing accents.** Ice is used for toggles, sliders, the "QUICK RACE" kicker, P1, the arrow in the route line and lobby car specs. Coral is used for track length, "POINT TO POINT" and "SPAWN SPOT". Gold is used for the result time, the HOST chip and medals. Green and amber are used for filled status chips. That makes five hues on some screens.
5. **Chips as decoration.** The lobby shows ATH123 / ATHENS RIVIERA / QUICK RACE / YOU / HOST / TRIM · COOPER S / CONNECTED · … The browser shows ONLINE · GR-4821 / OPEN / RACING / FULL. What's New has a THIS VERSION pill, and loading has a TIP pill.
6. **Duplicated information.** Track confirm shows "EVENT: QUICK RACE" under a QUICK RACE breadcrumb. The setup summary shows "QUICK RACE / YOUR RACE" under RACE SETUP. The spawn card shows "PLACE 2 / 26" and "SPAWN SPOT" above the place name. Sign-in shows the kicker "ATHENS RACING" above "SIGN IN TO ATHENS RACING". The gate puts the "ATHENS RACING" logo above "ATHENS RACING IS MADE FOR COMPUTERS".
7. **Boxes in boxes.** The car spec card puts six bordered stat tiles inside a bordered panel. The leaderboard empty state is two panels. Lobby driver rows are boxes inside a panel.

## Design direction

- **Type: five roles and nothing else.**
  - **Display:** the screen title, light, spaced caps, `--t-3xl`. Locked.
  - **Heading:** a name inside a screen (track, car, lobby), light caps, `--t-2xl`.
  - **Label:** a control label or a row title, sans, 500–600, caps.
  - **Body:** sentence case, `--t-md`.
  - **Caption:** condensed spaced caps, `--t-xs`. Used only for breadcrumbs, column heads, stat captions and key hints.
  - Explanations are always sentence-case body or `--t-sm` in `--c-text-3`, never caps.
- **Spacing:** the existing 4-pt tokens. Panel padding is `--s-5` and the gap between regions is `--layout-gap`. Rows inside a surface are unboxed and separated by one hairline. A caption sits `--s-2` above the thing it labels.
- **Colour:** neutral blue-grey type on piano black. The **one accent is ice**, and it marks state only: a selected or on control, progress, the live "you" row. The **primary action is the lit white pill**, one per screen. Coral is the map's route ink and the brand mark, never text. Gold is the medal, nothing else. Green, amber and red are true status only, shown as a dot or plain text, not a filled pill.
- **Panels and borders:** use a panel only to lift interactive content off a busy backdrop (the map, 3D) or to separate two real groups. Never put a panel around a single sentence, and never nest a box inside a box. Panel titles carry no icon, and are left out when the panel's content is self-evident.
- **Copy:** short and human, sentence case. Say it once. Don't caption the obvious ("CAR", "YOUR CAR", "SPAWN SPOT", "DRAG TO ROTATE" stays, because it is the only affordance hint).

Shared-first: the kit change goes in first, so every screen inherits it:
- `panel()` drops panel-title icons.
- `stat()` drops caption icons.
- `.field__note` is the quiet sentence-case caption.
- The `badge`/`chip` tones become a dot plus text for status.
- `.card__text` becomes sentence case.

## Per screen

| Screen | Problems | Fix |
|---|---|---|
| **Title** | Locked composition (pixel-identical rule). Its tagline still says "the Athens Riviera and the Penteli hill climb", but there are four tracks. | No change. The tagline goes to the owner as a proposal (below). |
| **Sign-in** | The kicker "ATHENS RACING" repeats the title. The title "SIGN IN TO ATHENS RACING" is long. The body text has two sentences. | Drop the kicker. Title: "SIGN IN". Body: "Sign in with Google to race. You'll need to be online." |
| **Mode (RACE)** | The kicker "CHOOSE YOUR MODE" isn't a breadcrumb. Icon plates sit over artwork that already says it. The FREE ROAM blurb is two sentences. The CTA pills duplicate the tile action. | Kicker becomes "PLAY", the real parent. Remove the icon plates on feature tiles. Shorter blurbs. The CTA stays (it is the tile's focus affordance) but is quieter. |
| **Track select** | The title "ATTICA / CHOOSE YOUR TRACK" has a slash slogan. The card stacks "TRACK 1 / 4", "POINT TO POINT" in coral, the name, the subtitle, "LENGTH" and "10.3 KM" in coral, and SELECT TRACK, which is three accents' worth of hierarchy. | Title: "CHOOSE A TRACK". Nav count is quiet ("1 of 4"). Type and length sit on one quiet meta line ("Point to point · 10.3 km"), no coral text. The name is the heading. One white primary. |
| **Spawn picker** | "PLACE 2 / 26" and "SPAWN SPOT" kickers. The meta line "ATHENS RIVIERA · The suburb above the marina" is generic copy. The car row reads "YOUR CAR · CHANGE" in caps. The "OR CLICK ANY ROAD ON THE MAP" caps hint has a mouse icon. | Title: "CHOOSE WHERE TO START". The count is quiet. Drop the kind kicker (a road point shows as "Road near …" in the meta line). Meta: the area name only. The car row is the car name plus "Change car". The hint is sentence case, without the icon. |
| **Track confirm** | The breadcrumb "QUICK RACE / YOUR TRACK". A "YOUR TRACK" panel title with an icon. The EVENT stat duplicates the breadcrumb. The "GLOBAL / TOP 3" caps title. A floating footnote. The wide empty right column. | Breadcrumb "QUICK RACE". No panel icons or titles where obvious. Drop the EVENT stat. Records titles: "Your best" / "Top times". Remove the footnote. |
| **Race setup** | The summary panel repeats "QUICK RACE" and "YOUR RACE" under RACE SETUP. The "VOULIAGMENI → LOMVARDA" arrow is in ice. Stat captions have icons. A "DEFAULT" caption sits under the stepper. Police notes are caps sentences. The panel title "YOUR RACE" has an icon. | The summary shows the map, then the route line, then plain stats. Drop the kicker and heading. The arrow is neutral. Notes are sentence case. Remove the inspector title. |
| **Garage** | The breadcrumb "GARAGE · 31 / 31 CARS" duplicates the title. The card subtitle "CITY · 2 TRIMS" is in caps condensed. | Breadcrumb: none (Back covers it). The result count moves into the search placeholder only when filtered. Card subtitle is sentence case ("City · 2 trims"). |
| **Car detail** | A "CAR" kicker above the model name. "TRIM 3 OF THIS CAR". The BODY row sits on a different grid from TRIM. Six bordered, icon-captioned stat tiles inside a bordered panel. The breadcrumb is the class ("HOT HATCH"). | Drop the "CAR" kicker. Drop "3 OF THIS CAR". Stats are unboxed hairline readouts without icons (the kit's `stats`). Breadcrumb: "GARAGE". |
| **Leaderboards** | The "FILTER TIMES" panel title. A "COMPARE TIMES" explanatory panel above a "NO TIMES YET" panel, which is two boxes for one empty state. | Filters panel has no title. One empty state in the results column (kit `emptyState`). The explanation is shortened to one quiet line. |
| **Settings** | ALL-CAPS notes on nearly every row, some of them three clauses long. Group titles have icons. | Notes become sentence case, one clause, quiet. Group titles lose their icons. The sidebar (locked) is unchanged. |
| **Multiplayer browser** | The kicker "LIVE RACING / 2–8 DRIVERS". A filled green "ONLINE · GR-4821" chip. Filled OPEN/RACING/FULL chips. "HOST · ELENI" in caps. | Breadcrumb: none. Status is a dot plus "Online". Row status is a dot plus text. "Hosted by Eleni". |
| **Host setup** | The "SELECTED" badge on the card (the card already shows a selected state). The "LOBBY" panel title. The car row reads "YOUR CAR · CHANGE IT IN THE LOBBY TOO". | Drop the badge in favour of the card's own selected mark. No panel title. Car row: "Change car". The footnote is shortened. |
| **Lobby** | Five chips in the caption. "CONNECTED · FIND A LOBBY OR CREATE YOUR OWN." is the wrong copy inside a lobby. The ice spec line. The ice "OPENS THE GARAGE…" hint. A "TRIM ·" chip. YOU/HOST chips. | The caption meta is a quiet text line: code · track · mode. Status is a dot. The spec line is neutral. Remove the hint. The trim is plain text. "You" and "Host" are quiet text. |
| **Pause** | This is the owner's reference style. The status line uses amber where the spec says "accent". | Kept as is. Proposal below. |
| **Results** | The time is in gold (a third accent). "YOU MINI" inline is cramped. The panel titles have icons. | The time is in white display weight. The kit drops panel icons. |
| **HUD** | Out of scope for chrome. The notices and badges are locked placement. | Unchanged. Captured for the contact sheet. |
| **Loading** | Two kicker lines ("POINT TO POINT • 10.3 KM" and "LOADING TRACK FOR QUICK RACE" in ice). A TIP pill. | One quiet meta line. The tip is plain sentence text, without the pill. |
| **Credits** | Clean already. | Unchanged, apart from the kit. |
| **What's New** | The "THIS VERSION" accent pill. | A quiet "Current" caption. |
| **Phone gate** | The logo, then "ATHENS RACING IS MADE FOR COMPUTERS", which repeats the name. A card around one sentence. A link pill. | Copy: "Made for computers". The body stays. The site is a plain link. |

## Proposals for the owner (locked, not changed)

1. **Title tagline** (locked title, pixel-identical): it reads "Real roads of Attica: the Athens Riviera and the Penteli hill climb." There are four tracks now, and Athens is coming. Suggest "Real roads of Attica." or removing it.
2. **Pause status colour:** the reference spec says "an accent status line", but it renders amber. Suggest ice (the one accent) or plain `--c-text-2`.
3. **Chevrons on immediate actions** (`C.option` spec): RESUME and QUIT carry a "goes somewhere" chevron. Suggest chevrons only on rows that open another screen.
4. **Breadcrumb on every inner screen:** with BACK beside it, a one-word breadcrumb that equals the previous screen title adds little. Suggest allowing screens without one (this pass keeps one wherever a real parent exists).
5. **Gate title** (locked by `tools/owner-locked-desktop-only.test.mjs`): "ATHENS RACING IS MADE FOR COMPUTERS" sits directly under the ATHENS RACING wordmark, so the name appears twice. Suggest "MADE FOR COMPUTERS". This pass changed only the gate's CSS.

## As built (where it differs from the plan above)

- **Mode:** the kicker is removed, not changed to "PLAY". Inside the title flow, Back already says where you came from.
- **Spawn picker:** the owner's click-anywhere decision (c2984a89, the same day) replaced the POI picker, so the spawn-card fixes above were overtaken. This pass added one fix: map tiles paint the coarse stand-in first, so a fast pan never leaves a dark hole.
- **Garage:** the count is gone from the breadcrumb, but it hasn't moved into the search placeholder. Trim UI is untouched, because the car-library-simplify agent is removing trims.
- **Car detail:** specs are a three-column unboxed readout grid (`stats--specs`).
- **Leaderboards:** the breadcrumb is QUICK RACE, not "PURE TIME". The GLOBAL tab is "ALL DRIVERS". Loading, error and empty are each one kit `emptyState`.
- **Results:** gold is gone from the time (kit `stat-tile--hi`). The "YOU MINI" row is unchanged.
- **Phone gate:** CSS only (no card, no icon plate, light title, plain address), because the copy and icons are owner-locked.
- **Title, Credits, HUD, Pause:** unchanged apart from the kit.

## Design direction in five lines

1. Type: five roles (display, heading, label, body, caption). Caps only for titles, labels and captions; every explanation is sentence case.
2. Spacing: 4-pt tokens. Panel padding `--s-5`, region gap `--layout-gap`, and rows inside a surface split by one hairline.
3. Colour: neutral text on piano black. Ice marks state only, the white pill is the one primary action, gold is medals only, and status is a dot.
4. Surfaces: a panel only lifts interactive content off a busy backdrop. No box inside a box, no icon in a panel title, and no title when the content is self-evident.
5. Copy: say it once. No kicker that restates the title, no caption for the obvious, short human sentences.

Contact sheets: `contact-before.webp` and `contact-after.webp` (all screens at 1280×800). Per screen: `<screen>/{before,after}-{1280x800,960x700}.webp`.
