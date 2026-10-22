# Agent rules for this repo

Many agents work in this checkout at once, on a shared 145 GB VPS. Worktrees, temp copies and evidence folders have filled the disk before and crashed everything. Follow these rules on every task.

## Disk hygiene (required)

- **Check first:** run `df -h /` before anything that writes more than ~1 GB (clean archives, bakes, browser captures, downloads). At 85% or above, don't start heavy work. Clean up your own leftovers first, and tell the lead if the disk is still high.
- **One temp dir per task:** create it with `mktemp -d /tmp/athens-<task>.XXXX`. Put every clean `git archive`, log, render and copy inside it, and delete it when you finish. Never leave stray `/tmp/<name>` dirs or `*.log` files.
- **Worktrees:** reuse an existing worktree for the same branch rather than creating another. When its branch has landed on `prod` or been abandoned, run `git worktree remove <path>` (not `rm -rf`), then `git worktree prune`. Never leave more than one worktree per task.
- **Evidence (`.scratch/<task>/`):** keep only what the final report links to, usually a few screenshots or contact sheets and a README. Delete intermediate frames, duplicate captures, videos and raw dumps. Prefer `.webp`/`.jpg` over `.png` for screenshots.
- **Caches and downloads:** remove raw OSM/DEM/model downloads once a reduced copy exists. Never keep more than one copy of a large artifact.
- **Processes:** stop every dev server, wrangler instance and headless browser you started. Use one browser job at a time via `tools/browser-slot.sh`. Never `pkill` broad patterns; stop only your own PIDs.
- **Killing processes:** only ever signal a PID you started yourself and recorded at launch (for example `$!` saved to a file). Never kill by name, pattern or a PID you looked up afterwards, and never signal `systemd`, `systemd --user`, the release train, wrangler or browser-slot processes you didn't start. On 2026-10-18 an agent's `kill -INT` hit `systemd --user` and silently stopped the release train for 15 hours.
- **Others' work:** never delete another agent's or the user's worktree, `.scratch/<task>` or temp dir. Ask the lead instead.
- **Final report:** list what you cleaned up, plus anything large you left on purpose (path and size), and `df -h /` before and after.

## Third-party media (required)

- Never commit third-party or copyrighted media: Street View, Google Maps or Google Earth captures, web images, photos, downloaded images, map-service tiles, or audio/video without a recorded licence.
- Put such material in `.reference/` (git-ignored, local-only; only `.reference/README.md` is tracked). See `.reference/README.md`.
- Committed audio or images need their source and licence recorded (`docs/audio-sources.md` already exists for audio).
- Evidence screenshots of our own game are fine in `.scratch/`.

## Git

- Never touch the shared index or working tree of the main checkout. The shared working tree is stale.
- Commit with a private index:
  1. `export GIT_INDEX_FILE=$(mktemp); git read-tree prod`
  2. Add only your own files.
  3. Check `git diff --cached --stat prod`.
  4. `git commit-tree -p prod`.
  5. `git update-ref refs/heads/prod <new> <old>`. Retry on a race.
- `main` is a symref to `prod`. Contributor PRs target `staging` (see CONTRIBUTING.md).
- Never push or deploy. The release train (`athens-release` systemd timer) tests `prod` and deploys staging, then production.

## Gates

Run these on a clean `git archive` of your exact candidate, inside your temp dir:

- `npm test`
- `node --import ./tools/physics-test/register.mjs tools/physics-test/regress.mjs`
- `node tools/check-browser-imports.mjs`
- `node tools/check-syntax.mjs`

All must pass.

## Pull requests and reports (required)

- **Template:** use `.github/pull_request_template.md` for every PR, and the same structure for your final report when you land work directly. See CONTRIBUTING.md rule 6.
- **Top half, for a human reviewer:** short and plain. A summary, **a video, GIF or screenshot of the change working in the game** (before and after for visual changes), 2-minute try-it steps, and the risk and rollback.
- **Bottom half, in the collapsed "How it was done" section:** the full detail. Root cause and approach, **which tools and AI models did which part** (name the exact model, e.g. "Claude Opus 5.5", "Codex gpt-6.1-sol", or "by hand"), every file changed and why, exact test commands with their pass/fail counts, how the proof was captured, performance, and known limits.
- No visual proof means not done. Our own game captures only; third-party media never goes in git or in a PR.
- Update `docs/PROBLEMS.md` in the same change: move what you fixed to Fixed, and add anything new you found.
