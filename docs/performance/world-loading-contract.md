# World loading progress and recovery

`loadBakedWorldData(map, progress)` calls `progress(text, fraction, detail)`.
`main.js` forwards all three arguments to `loading.progress`. Existing two-argument
builder milestones remain supported. The fraction is a route-art milestone;
it is not a measured percentage of total time or work.

The download detail contains:

- `mapId`: the map being loaded; discard updates for a different visible map.
- `phase`: `download`, `inflate`, `decode`, `generate`, `failed`, or `ready`.
- `source`: `download`, `generated-cache`, or `worker`.
- `loadedBytes`: unique compressed bytes currently retained, including partial files.
- `totalBytes`: compressed size from packaging or response headers; `null` when unknown.
- `elapsedMs`: time since this map-buffer operation started, including paused recovery.
- `asset`: diagnostic URL or pack kind, never player-facing copy.

Download reports are throttled to about 150 ms, except completion. Only positive,
known `totalBytes` permits a determinate download fill. Elapsed time cannot advance
that fill. Corrupt bytes are discarded, so retained-byte counts can decrease after
integrity failure. No overall completion percentage is inferred. A generated cache
read emits `source: generated-cache`, no byte total, then `ready` after validation.

`failed` adds `error: {code, message, retryable}`, `retry()`, and optional
`fallback()`. Codes are `offline`, `network`, `timeout`, `http`, `storage`,
`invalid`, or `generate`; raw messages are diagnostics only. Timeout means no
headers/body bytes for 30 seconds on an active request, not total transfer time.
UI can independently announce no-byte progress after eight seconds.

The original load promise remains pending while failure is shown. Each recovery
callback is a one-shot choice and returns immediately; the next progress detail
drives the resumed UI. Retry preserves completed verified parts and partial bodies.
Fallback explicitly selects worker generation; a network error never starts it
automatically. Retry after generation failure returns to downloads. Navigation
back to the menu unloads the document and cancels its operation. The worker emits
real stages `map`, `terrain`, `roads`, `buffers` with `step: 0..3`, `steps: 4`.
Those stages do not imply equal duration; worker completion is a separate buffer
message, bounded by its existing 120-second watchdog.

`ready` means terrain/road buffers validated, not that all scenery, textures or
shaders finished. Legacy map-world/main milestones continue the loading UI.
Opus UI commits `6ada01e` + `6dc6452` consume this contract; the transport commit
does not include their markup/CSS or change geometry/contact builders.
