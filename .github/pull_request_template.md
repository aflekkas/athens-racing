<!--
How to write this PR (people and AI agents alike):
- The top half is for a human reviewer: short, plain words, with proof they can see in 30 seconds.
- The bottom half (inside <details>) is the full record: how you did it, which tools and AI models you used,
  every file and why, exact commands and their output. Be as detailed as you like there.
- A PR without a video, GIF or screenshot of the change WORKING in the game is sent back. No exceptions.
-->

## Summary (for the reviewer)
<!-- 1–3 sentences in plain words, written for a player: what's different now? -->

**Fixes / closes:** <!-- #issue, and the item in docs/PROBLEMS.md if there is one -->

## Proof it works (required)
<!--
Drag in a short video or GIF (10–30 s) of the feature working in the real game. Use screenshots if it's static.
Show BEFORE and AFTER from the same spot for anything visual.
Our own game footage only. No Street View, web images or other third-party media.
-->
| Before | After |
|---|---|
|  |  |

Map / area: <!-- e.g. Athens · Glyfada, Penteli hill, Megara -->  ·  Graphics preset: <!-- Potato–Ultra -->  ·  Camera: <!-- chase / cockpit -->  ·  Build/commit tested: <!-- SHA -->

## How to try it (2 minutes)
<!-- Exact steps for the reviewer: menu → event → car → where to drive → what to look for. -->
1.
2.
3.

## Risk
<!-- What could break? Who notices? How do we roll back? One line each. -->
- **Could break:**
- **Rollback:** <!-- e.g. revert this commit; no data/world changes -->

## Checklist
- [ ] Branched from the latest `staging` and targeting `staging`; one feature or fix in this PR
- [ ] Video, GIF or screenshot of it working is attached above (before and after for visual changes)
- [ ] `npm test`, physics regress, events, ghosts, syntax and browser-import checks pass locally (CI will re-run them)
- [ ] Added or updated a test that would have caught this problem
- [ ] Performance noted if I added models, effects or scenery (draw calls and frame time on Low and High)
- [ ] Multiplayer: looks the same for every player, or is hidden online
- [ ] New assets are ours or CC0/CC-BY with credits added
- [ ] No third-party or copyrighted media committed (it goes in `.reference/`, never in the PR); committed audio and images have their source and licence recorded
- [ ] Follows the design rules in CONTRIBUTING.md and doesn't change anything in docs/OWNER-DECISIONS.md
- [ ] Updated `docs/PROBLEMS.md`: moved the item to Fixed, and added anything new I found
- [ ] The "How it was done" section below is filled in

<details>
<summary><b>How it was done (full detail, for agents and deep review)</b></summary>

### Approach
<!-- The root cause you found, how you found it, the options you considered, and why you picked this one. -->

### Tools and AI models used
<!--
Be specific. For example:
- "Claude Opus 5.5 (Claude Code): wrote the route-guidance changes; reviewed by Codex gpt-6.1-sol"
- "Codex gpt-6-astra: generated the chevron mesh"
- "Blender 4.2 for the model, exported glTF"
- "By hand, no AI"
Include any generated assets and the tool or model that made them, plus important prompts or settings if they affect the result.
-->
| Part of the work | Tool / model | Notes |
|---|---|---|
|  |  |  |

### Files changed and why
<!-- One line per file or group: what changed and why. Call out anything surprising. -->
-

### Tests and checks run
<!-- Exact commands plus a short summary of the output (pass/fail counts). Paste failures you fixed along the way. -->
```text
npm test                    →
physics regress             →
check-syntax / imports      →
other (say what)            →
```

### How the proof was captured
<!-- Real browser or headless; GPU or SwiftShader; resolution; local build or staging; any capture script used. -->

### Performance
<!-- Frame time and draw calls before/after on Low and High if anything visual or heavy changed; otherwise "no runtime impact". -->

### Known limits and follow-ups
<!-- What's not done, edge cases you saw, anything you're unsure about. Add new problems to docs/PROBLEMS.md. -->

</details>
