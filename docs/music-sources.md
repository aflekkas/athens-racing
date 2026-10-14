# Music sources for Athens Street Racers

Checked against current official documentation on **2026-10-14**. The practical default is **Music: Off**; let players explicitly select their own files or a visible YouTube video, and retain the original tracks only as optional Built-in radio.

## YouTube: visible video, not an audio radio extraction

The [IFrame Player API](https://developers.google.com/youtube/iframe_api_reference) accepts an embeddable live video ID or playlist. No Data API key or registered Google app is needed just to embed a known public URL. Stream availability, region/age restrictions and whether embedding is enabled remain controlled by YouTube/channel owners. A channel `/live` landing URL needs a current video ID; this implementation accepts `/live/VIDEO_ID`, watch, short-link, embed and playlist URLs.

YouTube’s [Developer Policies III.I.7–9](https://developers.google.com/youtube/terms/developer-policies) prohibit separating audio/video, promoting them separately and background players. Do not hide the video, crop it into an audio-only widget, cover controls/branding/ads or keep playing on a hidden page/tab. The [minimum functionality rules](https://developers.google.com/youtube/terms/required-minimum-functionality) also cover player identity/referrer and presentation. Send an ordinary origin referrer; do not use a `no-referrer` embedding policy (error 153 can result).

Minimum player viewport: **200 × 200 CSS px** with enough room for all controls; YouTube recommends **480 × 270** for 16:9. A HUD corner is potentially acceptable if the full player remains visible, unobscured and large enough; that is an interpretation of the general embedding rules, not a game-specific approval. This release conservatively uses **menu-only**, full-width 270px-high native controls, pauses if scrolled away/hidden and destroys the player when leaving Sound settings. It does not resume automatically on return.

[Player parameters](https://developers.google.com/youtube/player_parameters) support playlist IDs and `autoplay=0`. Use an explicit Load action then the native Play gesture. [Browser autoplay policy](https://developer.chrome.com/blog/autoplay/) can block audible autoplay even with an API request; a forced-muted autoplay workaround is not the desired music experience. IFrame volume uses master × music because cross-origin video cannot enter the game’s WebAudio bus. It is not ducked to gameplay and does not play while driving.

## Player-owned files: useful immediately

The [File API](https://developer.mozilla.org/en-US/docs/Web/API/File_API/Using_files_from_web_applications) supports `<input type=file multiple>`; folder picking has a `webkitdirectory` fallback. Blob URLs feed a media element connected through [createMediaElementSource](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/createMediaElementSource) into the existing music bus. No streaming-service app or licence agreement is required for this mechanism; users still need lawful rights to their own files. Files are not uploaded or shared. Codec support depends on the browser; errors are surfaced without skipping forever.

[File System Access](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access) provides Chromium secure-context file/folder handles selected by a user gesture. Handles can be structured-cloned into IndexedDB across visits, but read permission may need to be requested again. Store handles, not audio bytes; provide Restore and Forget actions. Other browsers use session-only selected File objects; localStorage cannot reopen them. Directory imports are bounded to 500 tracks. Shuffle, next/previous, play/pause and existing music volume apply. Local files follow action ducking/cabin filtering and are reduced by approximately 6 dB in menus relative to racing to follow MIX.md’s quieter menu target; arbitrary user masters cannot be guaranteed to meet absolute LUFS targets without analysis.

## Internet radio and SoundCloud

Greek examples: ERT **Kosmos**, **Deftero Programma**, and **ERA Sport**, available through the official [ERT εcho live portal](https://www.ertecho.gr/). HTTPS direct endpoints probed on this date:

- `https://radiostreaming.ert.gr/ert-kosmos`
- `https://radiostreaming.ert.gr/ert-deftero`
- `https://radiostreaming.ert.gr/ert-erasport`

All three returned HTTP 200, `audio/mpeg`, `Access-Control-Allow-Origin: *`, and audio bytes; exact probe headers are in `.scratch/music/radio-probes.json`. ERT itself publishes the ERA Sport endpoint in its [press office](https://press.ert.gr/athlitika/i-eraspor-giortazei-ta-27-chronia-apo-tin-idrysi-tis-3-ma-oy-1993-3-ma-oy-2020/). The [En Lefko official player](https://www.enlefko.fm/player/) is another listening option, but no stable direct URL was confirmed from the accessible official content.

Public stream access and CORS are **not** a licence to integrate/rebroadcast music into a game. Obtain station/rightsholder permission and clarify territory/attribution before shipping presets. CORS is required for WebAudio processing; ordinary cross-origin audio playback may work while WebAudio outputs silence without it. Use anonymous CORS, not credentials with wildcard CORS. HTTP streams can be blocked as mixed content from HTTPS. Avoid Worker proxying: it would not solve rights and would burden the Free plan. No station presets are shipped.

The [SoundCloud Widget API](https://developers.soundcloud.com/docs/api/html5-widget) embeds public tracks/playlists without a custom API client ID and supports play/pause, skip and volume via postMessage. Private/deleted/geoblocked or embed-disabled content can fail; browser autoplay still applies. Its cross-origin iframe cannot be wired into our music bus. Preserve attribution/links and player behaviour; the [SoundCloud terms](https://soundcloud.com/terms-of-use) restrict repurposing widgets into a competing streaming service. Custom streams/API credentials are a separate integration, not something to scrape from widgets. No SoundCloud integration is shipped in this task.

## Delivered scope and owner action

Settings → Sound → MUSIC SOURCE: Off (fresh default), Your music files, YouTube stream/playlist URL (visible menu-only), optional Built-in radio. **J mute, N next; L gearbox mode, M big map.** Existing rebinding protections remain in src/input.js. There is no streaming-service account integration.
