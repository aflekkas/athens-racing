# Multiplayer deployments and disconnect investigations

`GameArena` uses Cloudflare's WebSocket Hibernation API. Ordinary hibernation
retains sockets. A running-instance replacement can close every socket without
an application close frame, appearing as 1006 at the clients.

Cloudflare documents that enabling `wrangler tail` or dashboard logs requires a
software update, which can replace a Durable Object. Opening or refreshing log
sessions during a race is therefore an intervention, not passive observation.
See [Cloudflare's known issues](https://developers.cloudflare.com/durable-objects/platform/known-issues/)
and [WebSocket lifecycle](https://developers.cloudflare.com/durable-objects/best-practices/websockets/).
Do not infer an application exception from simultaneous 1006 closes alone.

For a clean deployment proof:

1. Finish deployments and close live-tail/dashboard-log sessions before testing.
   Allow pending platform updates to settle (the Wrangler default deferred code
   update deadline is five minutes, in addition to global propagation). Run a
   separate warm-up and keep log-session configuration unchanged throughout
   the proof. Wrangler can reconnect its tail session; after closing the CLI,
   confirm the Worker tails API lists no remaining sessions before calling a
   run unobserved. Do not count failures during propagation as a completed proof.
2. Run twenty sequential full races without retrying failed rounds. Alternate
   Riviera and Penteli, retain each exit code and full log, and record the
   deployed version. For example:
   `node tools/multiplayer-smoke-stress.mjs https://STAGING --rounds=20`
3. Use `/health` for the arena instance ID and connection counts. A new instance
   after an idle period can be ordinary hibernation; a new instance accompanied
   by all sockets closing indicates replacement. Health contains no tokens.
4. Distinguish arena replacement from an individual transport reset. A 1006
   with an unchanged arena instance is insufficient evidence of a DO failure;
   a control Worker socket that bypasses GameArena can isolate this distinction.
5. If a tail is necessary, open it before a separate reproduction run, allow its
   update to settle, and retain its lifecycle notices as well as event logs.
   WebSocket logs can be delayed until connections close. Entry-point failures
   log phase, instance ID and the original stack and continue to throw.

Recovery uses existing session tokens and a fresh ninety-second reservation
when restoration discovers a previously connected socket is absent. One shared
arena snapshot is durably checkpointed at most every two seconds of telemetry;
transitions and finishes save immediately. The snapshot stores accepted course
cursors and reconstructs immutable gates from the catalogue. No telemetry means
no periodic checkpoint writes. A replacement can roll position back by up to
one checkpoint interval; it must not expire a long-running racer immediately.
