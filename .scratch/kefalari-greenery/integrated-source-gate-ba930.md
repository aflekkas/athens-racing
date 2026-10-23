# Integrated source checkpoint gate: PASS

Frozen commit `ba930a1fae696987f002415bd7165de08f64b7ab`, tree `9753b91d82782b6bd0bcc6b8d91b9c131b5170fb`.

All four required commands passed sequentially on one clean archive. This validates the integrated source checkpoint; final world, terrain release and production acceptance remain separate.

| Check | Result | Time |
|---|---|---|
| `npm test` | 323/323 files; 3140 tests, 3133 pass, 7 skip, zero failures/flaky/retries | 639.885 s |
| `node --import ./tools/physics-test/register.mjs tools/physics-test/regress.mjs` | 1323 pass, zero fail | 187.441 s |
| `node tools/check-browser-imports.mjs` | 366 modules pass | 1.036 s |
| `node tools/check-syntax.mjs` | 478 modules pass | 21.636 s |

The mandatory garage test passed 7/7, including real Chromium/SwiftShader checks at 1280×844 and 960×844 CSS pixels (device scale factor 2). It checked card containment, brand selection, viewer framing and equal spec tiles. Its browser and embedded server closed through awaited `finally` cleanup before the file passed. No new screenshot or driving proof is claimed by this gate receipt.

To review in two minutes, open [the JSON receipt](integrated-source-gate-ba930.json), verify the four exit codes and counts, then inspect the exact logs listed there. This evidence-only commit has no runtime impact; rollback removes these two receipt files.

<details>
<summary><b>How it was done</b></summary>

Codex gpt-6.1-sol ran the repository gates through Cogenly owned terminals. One `git archive` of the frozen SHA was used without agent edits. The normal npm runner used two workers and its standard isolated-retry policy; no retry was needed. All four commands completed, with no restart or assertion bypass. Total archive-plus-gate elapsed time was 859.412 seconds.

Files added: this Markdown summary and its sibling JSON containing complete commands, environment, source checks, log SHA/byte pins, durations, skip reasons and limits. No production documentation, tracker, changelog or source was changed.

Exact environment:

```text
ASR_TEST_JOBS=2
BROWSER_SLOTS=1
BROWSER_SLOT_WAIT=180
WORLD_GEN_PYTHON=/tmp/athens-highway.GIu3/venv/bin/python
PYTHONDONTWRITEBYTECODE=1
TMPDIR=/tmp/athens-greenery.98Rc
CHROME_BIN=/home/dev/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome
PLAYWRIGHT_MODULE=/home/dev/.cogenly/worktrees/athens-racing/t3-d44ea933/node_modules/playwright/index.mjs
ASR_TEST_VERBOSE=1
ASR_TEST_FLAKY_LOG=/tmp/athens-greenery.98Rc/gate-ba930-flaky.jsonl
```

The flaky log was not created because no file failed. Shared dependencies matched all 44 applicable lock entries by installed version and integrity; 51 unsupported optional platform packages were correctly absent. Lock SHA256: `4c6ccf17d01774f8db1c7c924cb2438637691345d400f1b3adc9c73857c1d5e6`. Python 3.12.3 used existing Shapely 2.2.0, NumPy 2.5.4, Rasterio 1.4.3 and Osmium 4.3.1. No environment was installed or mutated. Chromium resolved to the existing loaders-owned Chromium 1248 executable.

Seven deliberate skips:

1. Penteli complete generated/baked-world equality: nightly full-map generation.
2. Psychiko complete generated/baked-world equality: nightly full-map generation.
3. Megara complete rendered-road/shoulder scan: nightly full-map scan.
4. Penteli complete rendered-road/shoulder scan: nightly full-map scan.
5. Human git authors in credits: clean archive contains no `.git` history.
6. Athens actual-cell conformance: `ATHENS_WORLD_SPOOL` was unset.
7. Live Worker multiplayer/identity integration: `ASR_TEST_BASE` was unset.

The parent independently checked ten archived source files against frozen git. This agent also compared archived assembler source, its test, package lock and test manifest with exact frozen git blobs; both owned assembler files matched the working source too. Exact SHA values are in the JSON.

Owned terminal `agent-ce41ccf3-5584-4976-b2ee-a07f7897f02d`, launch PID 1278875, exited 0. At FULLEND there were no running owned terminals, browser/server jobs or heavy subprocesses. CPU was explicitly released to the parent's next watcher job. The actual two-cell assembler plan remains metadata-only and unexecuted.

Retained logs: `/tmp/athens-greenery.98Rc/gate-ba930-{npm,physics,imports,syntax,controller}.log`. Prior exact `92e67986` logs, shared dependencies and source caches remain for final regression records. The parent authorized removing only the owned `candidate-ba930` archive (840 MiB) after this durable receipt commit and exact source check. Disk was 70G used / 75G available / 49% before, and 71G used / 74G available / 49% after the gates, before authorized archive cleanup.

No final-world admission, geography fidelity, terrain bake, global/2×2 budget acceptance, deployment or production claim follows from these source gates.

</details>
