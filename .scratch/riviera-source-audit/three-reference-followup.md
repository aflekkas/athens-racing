# Three Riviera reference observations: scoped follow-up

This receipt covers exactly three inspected panoramas. It makes no inspection
claim for the other six planned positions. No new browser/reference requests,
third-party captures or runtime changes were made for this follow-up.
The inspection date is preserved as2026-10-23; image capture dates are separate.

The unchanged [source metadata](streetview-three.json) contains full-precision
requested and actual coordinates, world XZ, pano IDs, URLs, headings and offsets.
Its SHA256 is `08fa1784dbc205cd30f4f8cc471e1db03a38507d26b801bdc1bdbfba9378b21f`.

## Observations only

### Route station 500m — February 2025

Requested: [37.80845009907049, 23.783559330325804](https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=37.8084501,23.7835593&heading=133.78&pitch=0&fov=90), heading133.77941522131323°.

Actual inspected pano: [37.8084272, 23.7835815](https://www.google.com/maps/@?api=1&map_action=pano&pano=KBCcJcBthVSZMUEvOXBVXg&heading=133.78&pitch=0&fov=90), heading133.78°, `KBCcJcBthVSZMUEvOXBVXg`. Snap distance **3.206581720m**.

- White directional arrows: left-turn indication in left lane and through arrows in adjacent lanes.
- Dashed white lane dividers.
- Low grassy raised median to left; kerbed planted strip to right separates frontage/service lane.
- Bus-stop shelter, parked cars and bollards on right frontage; traffic lights ahead.

### Route station 3000m — March 2026

Requested: [37.80387212083716, 23.797476571328918](https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=37.8038721,23.7974766&heading=29.84&pitch=0&fov=90), heading29.843427007187927°.

Actual inspected pano: [37.8038198, 23.7974806](https://www.google.com/maps/@?api=1&map_action=pano&pano=JUJPy3OJppeb4rjqL6VzgQ&heading=29.84&pitch=0&fov=90), heading29.84°, `JUJPy3OJppeb4rjqL6VzgQ`. Snap distance **5.835073101m**.

- Double continuous white centre lines and dashed same-direction lane divider.
- White edge line; no raised central divider visible in this frame.
- Grassy rocky hillside on left; shrubs and trees at right edge; open water in distance.

### Route station 9000m — April 2026

Requested: [37.81446211595438, 23.831214048397744](https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=37.8144621,23.8312140&heading=101.09&pitch=0&fov=90), heading101.08534482396078°.

Actual inspected pano: [37.814533, 23.8311829](https://www.google.com/maps/@?api=1&map_action=pano&pano=PhwxmbPlrawGmVRQNETblA&heading=101.09&pitch=0&fov=90), heading101.09°, `PhwxmbPlrawGmVRQNETblA`. Snap distance **8.350741533m**.

- Tall exposed rock cutting immediately left.
- White edge line, dashed same-direction divider and double continuous white centre lines.
- Metal roadside guardrail right; sea and scrub-covered land visible.
- Street-light poles and triangular warning signs visible.

At9000m the8.350741533m snap includes a7.218083679m local lateral offset.
The actual side, lane/carriageway and capture-vehicle direction remain
unestablished. This is reference-camera ambiguity, not evidence of a road gap,
misalignment, wrong grade or a required width change. No numeric grade, road
height, rock dimensions, paint size or guardrail clearance is adopted from images.

## Proposed game audits/corrections — not observed fixes

- **500m:** check source-supported turn arrows and shared lane-marking rules;
  compare median/frontage planting, bus-stop and roadside form. Any correction
  must use shared procedural/source data, not place-specific paint or scenery.
- **3000m:** compare continuous centre lines, same-direction dividers and the
  visible absence of a raised centre divider in this frame; inspect rocky/grass
  and shrub/tree roadside form. The tan polygon in our existing game baseline
  remains inherited and unclassified pending a complete rendered-object pick.
- **9000m:** compare exposed-rock form, vegetation and metal roadside guardrail
  materials after resolving camera/carriageway correspondence. Do not infer
  numeric terrain or bridge/road geometry from perspective.

These are proposed audits. This receipt does not establish current generator
policy defects, implementation ownership changes or completed corrections.

## Own-game paired proof still needed

1. Capture a fresh baseline and corrected candidate for each actual inspected
   pano XZ and stated heading/pitch0/horizontalFOV90. Pin source commit, immutable
   world/cell hashes, actual camera matrix, floor-support type/Y and explicitly
   assumed eye height. No surveyed camera height or grade acceptance is implied.
2. Before capture, establish native loading-hidden/fresh-render/ground readiness,
   actual player XYZ and stream.position, applicable active camera-neighbour
   cells and errors. If a camera uses terrain support, label it static only;
   do not present it as a road/lane spawn or driving proof.
3. At500m show arrows/dividers, planted median/frontage and bus-stop context in
   both own-game frames. At3000m show centre/divider/edge paint and roadside
   planting, and retain the tan-polygon diagnostic result or explicit blocker.
   Bind any claimed polygon owner to a complete pixel/triangle/object/contact
   receipt; unsupported foreground must not be skipped into a horizon claim.
4. At9000m establish lane/carriageway correspondence before a geometry claim,
   then pair the actual rock/guardrail/vegetation view. Keep the8m snap ambiguity
   explicit if unresolved. A safe source contact alone does not resolve it.
5. Any resulting physical change additionally needs native driving, barrier,
   AI/tow/rejoin and unchanged-budget/guard checks. Existing static pictures
   and these references do not substitute for that acceptance.

Existing own-game static500/3000/9000 frames are baseline observations from their
recorded older source/world tuples; no corrected paired candidate is accepted
here. The browser slot was already released. No new media files were created.
Codex gpt-6.1-sol prepared this offline text/source receipt.
