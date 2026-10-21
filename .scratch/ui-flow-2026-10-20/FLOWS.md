# Launch to doing the thing: steps before and after (2026-10-20)

Owner: "fewer clicks to get anywhere". I measured each path in a real browser, signed in through the stub Google: a fresh load, the title, then key presses until the goal. `flows.mjs` and `flows.json` are the walk. `flows-before.webp` and `flows-after.webp` show one row of screens per path. The before run is prod `7e15b516`; the after run is this tree. Mouse clicks are counted from the same screens.

## The table

| Goal | Keys before | Keys after | Clicks before | Clicks after | What changed |
|---|---|---|---|---|---|
| Quick Race | **12**: Enter ×4, ↓ ×5 to CHOOSE CAR, Enter ×3 | **6**: Enter ×6 | 7 | 6 | Race setup opens on CHOOSE CAR. The car picker opens on your car, ready to race. |
| Quick Race on the track you raced last (here Penteli) | **14**: Track select always opened on Riviera (+2 →) | **6** | 8 | 6 | Track select opens on the last track you raced. |
| Free Roam, first time | 4: Enter, →, Enter, DRIVE | 4 | 3 | 3 | — |
| Free Roam again, same place | 4 or more: the RACE screen opened on Quick Race, and the map forgot your spot | **3**: Enter, Enter, DRIVE | 3 + finding your spot again | **3** | RACE focuses the card you played last. The picker reopens on the last place you started. |
| Free Roam on the Athens map (`?map=athens`) | 4 or more, as above | **3** | 3+ | 3 | Same, remembered per world. |
| Host a lobby | 5: →, ↑, Enter, Enter, Enter | 5 | 3 | 3 | — (the title layout is locked) |
| Join a listed lobby | 5: →, ↑, Enter, ↓, Enter | 5 | 2 | 2 | Not changed. With a code, you type the code. |
| Garage: change car | 4: G, a car, Enter (details), Enter (SELECT CAR) | 4 | 3 | 3 | — |
| Settings | 3: →, →, Enter | 3 | 1 | 1 | — |
| Leaderboards (inside Quick Race) | 5: Enter ×3, ←, Enter | 5 | 4 | 4 | — (locked: they live on the track confirmation) |
| Results: race again | **3**: RETRY opened the car picker, then the car, then RACE | **1**: RACE AGAIN (the default) | 3 | **1** | RACE AGAIN restarts the same event with the same car. |
| Results: another car | 4: RETRY, a car, Enter, RACE | 4: CHANGE CAR, a car, Enter, RACE | 3 | 3 | CHANGE CAR is its own button and opens the garage grid. |

The "Results: race again" row is from the browser too (`results-race-again.webp`): one Enter on the results goes straight back to the start line, with no car screen.

## What I did not change (locked), as proposals for the owner

1. **A one-press "continue" on the title.** The best single cut would be a quiet CONTINUE · QUICK RACE · PENTELI · MINI line on the title, which takes 6 presses to 1. The title composition is locked (PLAY hero, MULTIPLAYER, GARAGE, SETTINGS), so I left it.
2. **Track confirmation after Track select.** It repeats the track you just chose, but it is where the owner put the personal best, the top times and LEADERBOARD (2026-10-17). Proposal: make SELECT TRACK go straight to race setup, and put the times and LEADERBOARD on race setup's summary panel. That is −1 press on every Quick Race.
3. **Multiplayer from the title takes two arrow presses** (→ then ↑), because MULTIPLAYER sits above GARAGE and SETTINGS. A key shortcut like G for the garage (M for multiplayer) would make it one press without touching the layout. It is a small owner call, since G was the owner's.
4. **Arrows in the car view.** ← → could move between cars in the car's detail view now that trims are gone. That would make "another car" from the results 3 presses instead of 4.
