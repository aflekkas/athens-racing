# ATHENS RACING release notes

What changed in ATHENS RACING, newest first. This file is shown to players in the game (Settings > About > What's new), so write for them:
short, plain bullets, no file names, no commit hashes, no internal jargon. Say what you can now see, hear or do.

Each release is `## YYYY.MM.DD.N`: the date, then a counter for that day (`.1` is the first release of the day, `.2` the next).
The newest section is the version `tools/prepare-deploy.mjs` stamps into the build. `deploy/README.md` explains the release step.

## Unreleased

- Drive the Aventador SVJ with a screaming V12, hard ISR shifts and switchable exhaust flames and crackles.
  ![The green Aventador SVJ in the garage with its exhaust pops switch](assets/changelog/2026.10.15.3/svj-garage.webp "A V12, a huge wing, and hot exhausts.")
- Garage trim changes keep drag rotation working, and slow touch drags rotate your car.
  ![The garage after changing trims and rotating the car](assets/changelog/2026.10.15.3/garage-rotation.webp "Rotate your car after choosing another trim.")
- Scooter riders return correctly when traffic recovers after a crash.

- Welcome to ATHENS RACING: a new name and bold A-and-red-slash logo. Your saved progress stays with you.
  ![The ATHENS RACING title screen](assets/changelog/2026.10.15.3/athens-racing-title.webp "ATHENS RACING. Real roads. Nothing but time.")

- Release notes now include photos you can open full screen.
  ![The release notes screen with photos, captions and player-facing changes](assets/changelog/2026.10.15.3/release-gallery.webp "Browse release photos and open them full screen.")

<!-- Add bullets here as work lands. The automatic release train cuts a version from this section, e.g.
## 2026.10.16.1 — 2026-10-16
and adds a fresh empty "## Unreleased" above it. -->

<!-- Through a15a9ed. -->
## 2026.10.15.3 — 2026-10-15

![Volkswagen Golf R with its engine trim choices in the garage](assets/changelog/2026.10.15.3/golf-trims.webp "Choose an engine trim in the garage.")

- Cars now come in generations with engine trims. Pick your engine trim in the garage; your earlier car choice carries over.
- Dashboard warning lights react to what your car is doing, with a check of the lights when you start the engine.
- The speed-limit sign is bigger and flashes red when you are over the limit.
  ![A coastal race with rivals ahead and a flashing 50 km/h speed-limit sign](assets/changelog/2026.10.15.3/race-hud.webp "The race HUD keeps the speed limit in view.")
- A cleaner track map of Attica: only motorways, softer relief, and labels that never overlap.
- Choosing a track takes you straight to race setup, with a single confirm.
- Screens now change with a short, calm fade. Lit cards and focus rings are no longer clipped at the edges.
- Free roam setup is called Session setup, and phone layouts fit the setup summary properly.
- Replays and the photo editor are gone. Best-lap ghosts, finish photos and result cards remain.

<!-- Through 4bc8d91. -->
## 2026.10.15.2 — 2026-10-15

![Riviera rivals ahead from the cockpit with the rear-view mirror visible](assets/changelog/2026.10.15.2/rivals.webp "Keep your rivals in sight from the cockpit.")

- Rivals overtake traffic more decisively and no longer sit beside parked cars or cut across oncoming cars.
- AI rivals are capped at two by default, solo and online, and distant rivals are cheaper to draw for smoother frame rates.
- The online lobby, car and results screens match the rest of the menus, with your car shown live in the middle.
- Tabs, the settings list and option pills slide one highlight between choices.

<!-- Through a7012d7. -->
## 2026.10.15.1 — 2026-10-15

![A red Mini Cooper convertible in the garage with paint and driving statistics](assets/changelog/2026.10.15.1/garage.webp "Pick a car and its paint before heading out.")

- Police now work in online races: everyone sees the same units. The host picks Off, Relaxed, Normal or Tough, and Can Be Busted.
- Police escalate gradually, and far fewer units spawn. There are no more fines anywhere.
- Graphics presets run Potato to Ultra, with separate Lighting, Effects, Resolution, Frame rate and Draw distance controls that apply live.
- Mirrors work at every quality level, with a rear-view strip in the chase camera and a Mirrors on/off switch.
- Megara Circuit is back in solo and online, with tyre stacks that react to hits.
- Nights are brighter and moonlit, with stars, a moon, the glow of Athens and readable headlights.
- AI rivals really race: they overtake, defend and use your slipstream.
- Traffic and pedestrians are thinner, and civilians no longer stand in the road.
- Online races reconnect after a brief drop without stopping you, and traffic, cones and crash damage match for every driver.
- Results appear at the finish line, personal bests are saved per exact setup, and you can share a result card.
- The garage is slimmed to fourteen cars grouped as City, Hot Hatch, Sports, Super and Classic.
- The menus start faster: maps load only when you pick a session. Join, Host and the lobby are redrawn, and all dropdowns share one style.
- M opens a big minimap and L switches the gearbox mode. The gear is shown once, on the speedometer.

<!-- Through f767ff6. -->
## 2026.10.14.1 — 2026-10-14

![A bus beside palm trees and the sea at the Riviera race start](assets/changelog/2026.10.14.1/riviera.webp "The Riviera seafront, with its palm-lined road.")

- Choose Quick Race or Free Roam, then play solo or join or host an online lobby.
- Your driver name is saved in this browser, with no accounts or sign-in.
- Graphics quality and resolution can be changed live in Settings.
- Pick the Athens track map drawn from the real coastline and terrain, and race on Penteli as well as the Riviera coast.
- Play your own music files or a visible YouTube player; the music is off until you turn it on.
- The race HUD and every menu share one glassy in-car look.
- Greek road signs, sparse village life and roadside details make the streets feel local.
