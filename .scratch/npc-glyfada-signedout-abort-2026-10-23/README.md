## Summary

**FAILED_READINESS during boot; closes nothing.** The real signed-out SQLite setup was present, but the task-local browser observer failed to read an account response body through CDP and immediately aborted. No player/NPC physics, readiness samples or screenshots occurred. No rerun.

## Proof and result

[Exact receipt](report.json) retains whole buildd5f476f84d32365103111b17572804d03d84f5bd, seven proof-helperSHA256s,17runtime/account source hashes, actual account counts, abort trace and cleanup. The allocation prohibited a diagnostic image after abort, so no fresh screenshot exists. Priorf1e05 own-game photo remains separate and is not relabeled as this build.

Native URLrequested: `/?map=athens&spawn=2325,13057&simhook=1&car=corolla&cam=cockpit`, localbase127.0.0.1. Intendednative29High/mirrorHigh was not reached. Browser-slot1ticket297 acquired0s; actual Playwright1.64/Chromium156/SwiftShader1280×800. NavigationBEGIN/END→nativebootBEGIN→ABORT at9260.12ms, zero later commands. Error: `response.json: Protocol error (Network.getResponseBody): No data found for resource with given identifier. Response body is not available for a response that was navigated away from.` This is a proof-observer failure, not a demonstrated game/NPC/road defect.

Actual realhandlerconfig200/providers[]/requiredfalse was recorded. Session body was not verified by the browser observer, so no complete HTTP signed-out contract claim from this attempt. The real migrated query-only in-memory SQLite fixture recorded users0/sessions0/writes0 before and after and closed. No OAuth keys/login/fake sessions/fabricatedHTTP. SESSION_SECRET was random and memory-only; no secret value was logged or stored. HTTP503 guard remained active, no HTTP503 observed.

All7helperpins+4account productpins+13runtimefiles/wholeHEAD were checked before launch. All17source hashes and HEAD matched afterclose. Preflight20tests passed0fail0skip. Cachemisses0, unapprovedexternal0, pageerrors0, one expected font stylesheet aborted locally, actualremoteBytes0. World/ground/contact/path/flow readiness was not reached; cache completeness and native traffic movement remain unproved.

## Cleanup, risk and rollback

Chrome/proxy/HTTPserver/SQLite fullyclosed9815.94ms; terminal exited1; closeErrors[]. Recorded ownedPIDs1310671(node)/1310712(Chrome) were absent afterclose. Disk49%before/after. Two evidence files only; remove this commit to roll back. No product/helper/world/route edit during this run, no release/deploy, no tracker closure. Previous failures and shared dependency/cache originals remain intact. Rawreceipt retained at `/tmp/athens-ui-fixes.Nxho/glyfada-readiness-signedout/report.json`.

<details>
<summary><b>How it was done</b></summary>

Codex gpt-6.1-sol used Cogenly terminal tools, native browser-slot workflow, Playwright/Chromium and NodeSQLite/assert/crypto. Existing accountsDatabase() from server/accounts-stub.mjs supplied actual migratedSQLite only; accountsStub/signIn/mockGoogle were not used. Actual worker/accounts.mjs+server/index.mjs handled requests with explicit minimal fixtureaccountEnv; query_only prevented writes. Cleanup awaited browser and ownedHTTP closure, checked emptycounts and closedSQLite in finally. No remote fallback/download/cachecopy or product changes.

Exact checks: `node --test /tmp/athens-ui-fixes.Nxho/readiness-policy.test.mjs /tmp/athens-ui-fixes.Nxho/signed-out-fixture.test.mjs`20pass0fail0skip immediately before launch. Seven pinned helper sources and four realaccount sources plus13runtimefiles checked. Runtime attemptFAILED_READINESS/CDPbodyobserver with0postabortcommands. No duplicate component fullgate; parent owns combined exact-source gates. No liveMP/authentication-success/production-parity/performance/NPC-flow improvement or Quick readiness claims.

Next proposed source-only correction (not implemented or allocated): observe the existing real account response at the task-local HTTP proxy write/end boundary rather than reading a CDP response body that can disappear across native navigation. Preserve all actual handler bytes/status and fail on actualHTTPerrors; no additional account fetch, mock response, login or503 exemption. A future exact-source readiness retry and both180second nativeflow drives still require separate authorization.

</details>
