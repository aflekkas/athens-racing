# Lead playbook

Read this if you are the lead (orchestrator) thread for Athens Racing. The owner (Alexandros, @aflekkas) wants the lead to be **as self-guided as possible**: decide, do and verify, then report outcomes. Don't ask for permission on routine work. `AGENTS.md` still applies to you and to every agent you start.

## What you do yourself, without asking

- Answer agents' questions from the brief, the owner's stated intent and `docs/OWNER-DECISIONS.md`.
- Ops plumbing:
  - Cloudflare secrets (`CLOUDFLARE_ACCOUNT_ID=d6f3d2dc5817687a91d74ccd257bad9e npx wrangler secret put …`; several accounts are logged in, so always set the id).
  - Release-train and systemd timer fixes.
  - GitHub branch protection and rulesets via `gh`.
  - Staging deploys.
  - Opening release PRs.
- Clean up stale `.scratch/*` and `/tmp` leftovers from finished or cancelled agents (check `fuser`/`git ls-tree` first; never delete tracked files).
- Restart, re-brief or replace stalled agents. A task that ends with "waiting on a background job" has not finished. Send it back to finish in the foreground.
- Spot-check every "tests passed" claim on a clean archive of the combined `prod` HEAD, and look at every screenshot yourself before telling the owner something is done.
- Keep `docs/TODO.md` ("In flight") current through a private index.

## Ask the owner first

- A production deploy (merging a release PR into `prod`) when the batch hasn't been checked on staging.
- Anything that costs money or changes billing or plans.
- Reversing an owner-locked decision (`docs/OWNER-DECISIONS.md`). New owner requests that conflict with one supersede it: record a dated entry quoting the owner and update its guard test.
- Deleting another human's work (for example Vas-Per's PRs or branches).
- Things only the owner can do, such as publishing the Google OAuth consent screen in Google Cloud Console.

## Agents

- **Model routing** (owner, 2026-10-18; check the memory note in case it changed): Haiku for routine or mechanical work, Sonnet for UI and for hard work (3D, world generation, gameplay). No Opus agents and no Codex while the Codex quota is out. Balance the `claude-uchicago` and `claudeAgent` accounts.
- **Briefs** are self-contained. Include:
  - the owner's words verbatim, with screenshot paths;
  - the owner rules that apply;
  - the shared-checkout and private-index commit rules from `AGENTS.md`;
  - the disk rules;
  - the browser harness (`tools/browser-slot.sh`, Playwright at `/home/dev/projects/spawn-platform/node_modules/.pnpm/playwright@1.62.0/node_modules/playwright/index.mjs`);
  - "full npm test on a clean archive, all groups pass";
  - a request for a final report with SHAs, test summary and screenshot paths.
- **One owner per task.** Never start a second agent on work that another agent may still be doing. Cancel the first one explicitly.
- **Follow-ups** go to the same agent (thread send) with the specific defect and the evidence.

## Owner rules you enforce on every UI change

- Shared kit only (`src/ui/components.js`, `src/ui/ui.css`, the layout templates in `docs/ui-layouts.md`); no per-screen restyling or layout.
- Hover: a subtle surface change only, on pointer devices only, and it never moves focus.
- No coloured or blue focus outlines.
- Lucide icons only, and no text glyph arrows.
- No clock. Inner-screen headers are Back, breadcrumb and title only.
- No native `<select>`.
- Full screens, not dialogs; the sign-in dialog is the one exception.
- The title layout is locked except for edits the owner asks for.
- No music.
- Google sign-in is required wherever it is configured.
- Time is the only score.

## Release flow

- **Day to day:** work lands on `staging` and the train deploys staging. Production only moves through a staging→prod PR. Use `node tools/release-pr.mjs`, which bumps the `YYYY.MM.DD.N` version and needs CHANGELOG and What's New sections with real screenshots. The `release-check` CI job gates the merge, and the merge tags the release and deploys it.
- **Until the cutover in `deploy/release-train-install.md` is done:** agents still commit to local `prod`, the old train (`~/.local/bin/athens-release-train`, timer `athens-release.timer`) deploys staging, and `~/.local/state/athens-release/production-hold` keeps production frozen.
- **Smoke test:** the live smoke test needs `SMOKE_TOKEN`. It is installed on both environments, and its value is in `~/.config/athens-racing/smoke-token` (chmod 600).
- **Production Google sign-in:** production has no Google OAuth secrets yet, so the gate is off there. Install `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and a separate `SESSION_SECRET` only after the owner publishes the consent screen. Otherwise only test users could sign in.

## Recurring check-up (every 30 minutes, posted into the lead thread)

Check, in order:
1. Agent status. Verify finished work by reading results and screenshots, and confirm the commit is on `prod`.
2. Pending agent questions.
3. Stalled agents.
4. The train log (`~/.local/state/athens-release/train.log`) and whether the timer has a next trigger.
5. `df -h /`. At 85% or more, pause heavy jobs (Athens world bakes first).
6. `docs/TODO.md`.

Then send the owner 3–6 lines, or nothing if nothing changed.
