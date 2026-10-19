# ATHENS RACING release notes

What changed in ATHENS RACING, newest first. This file is shown to players in the game (Settings > About > What's new), so write for them:
short, plain bullets, no file names, no commit hashes, no internal jargon. Say what you can now see, hear or do.

Each release is `## YYYY.MM.DD.N`: the date, then a counter for that day (`.1` is the first release of the day, `.2` the next).
The newest section is the version `tools/prepare-deploy.mjs` stamps into the build. `deploy/README.md` explains the release step.

## Unreleased

- Porsche 911: round headlamps, a lower bonnet and a rear light bar with PORSCHE lettering.

- Cars: model lettering and the A-Class star now sit on the bodywork instead of floating by the tail lights, and door mirrors are mounted lower and sturdier.

- Multiplayer: other drivers' tyre smoke, burnouts and skid marks are now visible, and so are your own online. Sparks and dust show too.

- Multiplayer lobby: CHANGE CAR / TRIM is its own button under your car, says it opens the garage, and explains when your car is locked.

- Multiplayer: a driver the lobby shows as "loading" now reports in again every few seconds, so nobody gets stuck on loading.

- Signing out in another tab now returns you to the sign-in screen instead of showing "game updated, reload".

- Multiplayer: towing with T or R can no longer leave the screen black. A refused tow answers at once and the screen always comes back.

- Multiplayer: if you are away longer than the 90-second reservation, you are taken back to the menu with a clear message instead of a "reconnecting" loop that never ends.

- Multiplayer: after you retire, the mouse cursor stays visible so you can pick which driver to watch.

- Multiplayer lobby: the driver list names the whole car ("FIAT PANDA · 1.1") instead of only the trim.

- Towing and reset put you back on the road nearest to where you are, facing the way you were heading. In a race a tow never counts as progress.

- Frame rate limit: NO LIMIT now draws at your screen's full refresh rate everywhere, including the online car showroom that stayed at 30. The overlay shows your limit.

- Phones and tablets get a small card on the title screen to add ATHENS RACING to your home screen. Android installs in one tap, iPhone shows the steps.
  ![Title screen on a phone with a slim card showing the two Add to Home Screen steps](assets/changelog/2026.10.16.1/home-screen-prompt.webp "The card sits under the tiles, never over the race.")

- Credits and What's new are full pages you can scroll with keys, gamepad, wheel or touch. Credits are grouped by kind, and release pictures sit inline.
  ![Credits page with the team, map data and elevation attribution in a centred column](assets/changelog/2026.10.16.1/about-pages.webp "Credits read as one clear page, with every attribution fully visible.")

- Trims run from base to top model throughout the garage and online car lists, with fantasy builds last and saved choices kept.

- The garage now offers cars and larger vehicles only. Saved motorcycle choices switch to the MINI; traffic bikes still share the road.

- Drive the Mercedes SL and A-Class, Ferrari 348 and Porsche 928, with 12 trims, period cockpits and distinct engine sounds.
- Choose the 348 coupe, targa or Spider, and watch the 928’s headlamps rise at night.

- Crests and hard collisions can launch, spin or roll your car. If you stop on the roof or side, recovery becomes available after a short wait.
- Side streets share detailed asphalt. Psychiko’s roundabouts have islands and kerbs; traffic goes counter-clockwise and gives way on entry.

- Tow and reset get you moving sooner. Race positions follow the course you have actually driven.
- Psychiko starts in reverse with more room behind the gantry and separate records for the new direction.

- Loading stays busy while the track unpacks and builds. Pausing a download stops its connection; Retry continues from the saved parts.

- Riviera keeps downloading on slow connections. After a dropped connection, retry with completed parts kept, or choose to build the track on your device.
  ![Riviera downloading with measured bytes and four loading steps](assets/changelog/2026.10.16.1/riviera-download-retry.webp "See the actual download size, with a way back to the menu.")

- Sit in each car’s own cockpit again: its dashboard, instruments, vents and steering wheel, with a slightly higher seat for a clear view of the road.
  ![Restored 911 dashboard and five instruments from the raised driver seat](assets/changelog/2026.10.16.1/authored-interiors.webp "Each car’s own interior, with the road in view.")

- Greek-style facades, rooftop details, street furniture and OpenStreetMap trees bring the roads to life. World detail in Graphics turns them off; your choice is saved.
  ![Psychiko with World detail off and on](assets/changelog/2026.10.16.1/world-detail.webp "Choose the detail you want, without changing the lighting look.")

- Sign poles sit behind their panels, so speed limits and directions stay readable. Start banners face the road correctly.
  ![Speed and direction signs with their posts behind the lettering](assets/changelog/2026.10.16.1/sign-mounts.webp "Clear signs on every road.")

- Psychiko’s close-set building fronts are back in their real positions. Roadworks guide races and leave every street open in free roam.
  ![Restored close-frontage homes along Sismanoglou in Psychiko](assets/changelog/2026.10.16.1/psychiko-frontages.webp "Real fronts, with room for their gardens.")

- Sharper handling: cars hold their line when you brake into a corner or swing through an S-bend, instead of ploughing or spinning. Brakes stay steerable.
  ![A Huracán trail-braking through a tight Megara hairpin](assets/changelog/2026.10.16.1/sharper-handling.webp "Brake late, turn in, keep your line.")

- Every menu now shares one clean look, taken from the pause menu: the same panels, rows, buttons, lists and selection outline on every screen.
  ![The garage with search and filters in one row and a full grid of cars](assets/changelog/2026.10.16.1/one-component-set.webp "One look everywhere. More cars in view.")
- The garage shows more cars at once, with search and filters in one row at the top.
- Sign in from a small window over the title screen, with the Google button. You can always play offline instead.
  ![The sign-in window over the dimmed title screen](assets/changelog/2026.10.16.1/sign-in.webp "Continue with Google, or play offline.")
- Your account lists your friends first and shows who is online. Friend requests and lobby invites share one Activity list, and your plate looks like a real plate.
- Race notices now sit small in the top-left corner, clear of the road ahead, the mirrors and the minimap. A police pursuit shows as a small badge.
  ![A police pursuit badge and a short tow notice in the top-left corner of the cockpit view](assets/changelog/2026.10.16.1/race-notices.webp "Notices out of your way.")
- The tyre grip panel is gone.
- Rain uses scrolling texture layers, matte wet-road patches and small tyre-wake cards; water splashes use textured mist and foam.
  ![Day rain before and after the inexpensive texture overlays](assets/changelog/2026.10.16.1/rain-overlays.webp "Day rain in chase and cockpit views before and after the overlay change.")

- Free roam starts clear of the START gantry; race grids sit farther back so posts do not block the cockpit view.
  ![Riviera MINI cockpit before and after moving the free-roam spawn](assets/changelog/2026.10.16.1/gantry-clearance.webp "The red START post is clear of the new free-roam starting view.")

- Cockpits regain body frames, connected dashboards and branded steering wheels. Mounted wipers clear small, subtle rain drops.
  ![SVJ cockpit and rainy 911 before and after](assets/changelog/2026.10.16.1/cockpit-structure.webp "A visible cabin and steering wheel, with a clear view of the road.")

- Building blocks have brighter roofs, shaded sides and darker bases, adding depth without extra scenery.
  ![Baked shading gives Riviera building blocks more depth](assets/changelog/2026.10.16.1/baked-building-depth.webp "Simple building shapes with shaded sides and grounded bases.")

- Race two laps of Psychiko or explore its streets in free roam, with race-only roadworks. Map by Vassilis Perrotis (Vas-Per).
  ![Vas-Per’s Psychiko streets with simple footprint buildings](assets/changelog/2026.10.16.1/psychiko.webp "Psychiko by Vas-Per.")
- Psychiko uses our simple building and terrain style. Vas-Per’s full garden version is saved under the psychiko-garden-original tag.

- Removed the phone-as-steering-wheel controller.

- One graphics look for everyone: the clean, fast Lighting Off and Effects Off picture. Presets are gone, and the chase camera no longer shows a rear-view mirror.
  ![The chase camera on the Riviera with the one graphics look and no rear-view strip](assets/changelog/2026.10.15.4/one-graphics-look.webp "One clean look, and a clear view over the car.")

- Cockpit views put the road first, with compact readable instruments, no hands, and per-car seat height and position controls.

  ![A clear Riviera cockpit view with a compact instrument band](assets/changelog/2026.10.15.3/pov-camera.webp "More road in view. Your seat position, saved for each car.")

- Drive blocky cars, buses, trucks and bikes with simpler shapes, dark exterior windows and clear, hands-free cockpit views.
  ![Blocky MINI, SVJ, Athens bus and motorcycle](assets/changelog/2026.10.15.4/lowpoly-vehicles.webp "Familiar silhouettes, fewer polygons, and an open view of the road.")

- Race notices are smaller and clearer. Related warnings combine, tow actions work with touch and controllers, and alerts stay clear of the driving instruments.
  ![One compact engine warning with a working tow and repair action](assets/changelog/2026.10.15.3/compact-race-notices.webp "One warning. One recovery action.")

- Hills regain subtle earth, scrub and rock colours, while bright plaster and muted accent colours make building blocks stand out.
  ![Varied earth colours and contrasting Riviera building blocks](assets/changelog/2026.10.15.4/world-colour.webp "Subtle landscape texture, distinct building colours.")

- The Citaro bus and delivery vehicles now settle smoothly after bumps and turns, with steadier suspension for scooters and motorbikes.
  ![The Citaro bus driving along the Riviera](assets/changelog/2026.10.15.3/bus-suspension.webp "A softer, controlled ride for the heavy fleet.")

- Known terrain issue: some distant slopes still show small sky-coloured gaps; a terrain fix is being tracked separately.
  <!-- Pre-existing in 935cc47 per terrain-owner review. Evidence: .scratch/simplify-world/after-penteli-mid-afternoon.png; .scratch/simplify-world/after-riviera-owner-candidate-afternoon.png. -->

- Race through a cleaner Athens: open mountain slopes, simple building blocks and blocky roadside objects, without trees or beach furniture.
  ![Simplified Riviera road, hills and building blocks](assets/changelog/2026.10.15.4/simple-world.webp "Clear roads, open hills and simple shapes.")

- Turn dynamic resolution on or off in Video settings; the road can adapt under load while the HUD stays sharp.
  ![Dynamic resolution enabled in the Video settings](assets/changelog/2026.10.15.3/dynamic-resolution.webp "The picture adapts. Your HUD stays sharp.")

- The title screen returns to the large Play card and four menu cards, with the logo on the left. It fits smaller screens while keeping account access and version links.
  ![The restored Athens Racing title with its five menu cards](assets/changelog/2026.10.15.3/title-night-restored.webp "The night design returns.")

- Use your phone as a steering wheel: scan a code, tilt to steer, and use touch pedals in solo or online races.
  ![Phone steering wheel with throttle and brake pedals, calibration and gear buttons](assets/changelog/2026.10.15.4/phone-wheel.webp "Tilt your phone to steer and slide up the pedals for more throttle or brake.")

- SVJ exhaust pops now throw flickering blue-white and orange jets, with crisp red rear lights.
  ![Directional SVJ exhaust jets during an upshift](assets/changelog/2026.10.15.3/svj-flames-v2.webp "A sharp ISR bang and two hot jets.")
- Steel guardrails protect steep coastal bends on the Riviera, with openings for side roads and beach paths.
  ![Steel guardrails beside a coastal bend on the Riviera](assets/changelog/2026.10.15.3/riviera-rails.webp "Coastal bends gain guardrails while beach access stays open.")

- Browse cars in their saved paint, set up your next race and tune your graphics in a new racing front end.
  ![The redesigned Garage with car thumbnails and lime selection](assets/changelog/2026.10.15.3/garage-racing-ui.webp "Your collection. Your next drive.")

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
- The race HUD and every menu share one glassy in-car look.
- Greek road signs, sparse village life and roadside details make the streets feel local.
