# Native immutable-world transport check

One live check on root `8652c41c32244bf84d4940d9c9583becc061302e` passed: four root/region metadata requests (839,510 bytes) and one opaque enrichment request (1,908,927 bytes). The enrichment bytes match the exact immutable URL SHA256. Local requests were alias GET 307, root HEAD 200 and enrichment GET 200.

The separate native parent observed its owned child exit/close/EOF at 3,133.69 ms; parent post-work completed at 3,156.37 ms, under the same original 25-second deadline. The foreground tool also exited 0 without timeout or truncation. Both recorded PIDs are absent. Server, handlers, sockets, requests and interrupt observers are closed; received-byte accounting is exact. No cells were requested, no enrichment was parsed, no raw body was persisted and no browser/build ran.

Parsed metadata retains a 2 MiB bound. Opaque enrichment is bounded at 2 MiB per object and 8 MiB cumulative received bytes, including failed reads. The existing transfer, request and queue limits remain unchanged. This is a component transport proof, not memory capacity, full bundle smoke, three-route driving, online admission, world publication or release acceptance. The CI branch has identical adapter/test changes; its entire runtime was not tested by this root-only check.

## Validation and attribution

Codex gpt-6.1-sol implemented the adapter and reviewed/integrated it. Independent source review passes 333 controls, seven prior regression groups, six cleanup boundaries and ten syntax checks. Root integration passes 315 adapter and 18 route-host controls, two syntax checks and diff checks. The native parent/runner source passes 216 pure controls and three syntax checks.

The actor and parent receipts remain provisional on their own. Root independently checked actual tool exit 0, observed child closure, all 26 post-source hashes, exact totals, output hashes and PID absence. The compact receipt links those original files by path, size and SHA256; there is no duplicate downloaded body. Historical failed attempt616 remains unchanged.

Risk/rollback: this evidence-only commit changes no runtime behavior; revert it to remove the proof record. Full exact-archive gates and cell/bundle/game tests remain open. No new full gates were run for this documentation change.
