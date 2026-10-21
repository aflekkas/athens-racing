# Rival plans in route releases

`tools/build-routes.mjs` computes the exact `RacingLine` geometry and pristine rival speed profiles while compiling each discovered route. `prepare-deploy.mjs` uses that compiler and runs the same release validator. No racing line solve is needed to reset an unmodified rival on a shipped route.

The versioned `rivalPlan` in each immutable compiled route contains little-endian Float64 samples: lateral offset and curvature per direction/body width, common grade and vertical curvature, and speed profiles for every car reachable through the rival driver catalogue. Samples preserve the runtime solver's numbers exactly. Profiles include the exact vehicle planning-state key. Runtime arrays are private copies.

The plan binds the route geometry hash, world-set revision, planner/source fingerprint and plan checksum. The route hash also includes the plan checksum. `checkBuiltRouteRelease` rejects a stale source, geometry/world binding, malformed samples, checksum or route identity before publication. A missing production line/profile fails entry; local development can compute a missing artifact. Existing adaptive planning for changed live weather/damage capabilities still uses the normal vehicle model.

`tools/rival-plan.test.mjs` discovers every route, independently computes its runtime line and profiles, compares all shipped samples exactly, reconstructs line points, and proves pristine reset uses the shipped profile. Release tests reject stale and corrupted plans.

Entry activates the compulsory start/contact pins before countdown. It expands optional interest after the countdown has painted. Native traffic template generation and compaction run in a dedicated module worker with procedural OffscreenCanvas textures; typed geometry and semantic references are restored cooperatively on the render thread. The streamed pool builds one car at a time and pauses while the menu owns the session. Disposing a session cancels its worker and releases partially built models. Legacy traffic construction keeps its existing synchronous path. Streamed traffic does not allocate legacy far-proxy batches, which its owner never uses.

The primary resident benchmark remains the immediate restart following cold countdown readiness. A separate settled restart and countdown activation measurement can supplement that result; neither substitutes for it.
