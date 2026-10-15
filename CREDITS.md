# Credits

The source for the team and AI lines of the in-game Credits screen (Settings > About > Credits, also on the title screen).
`tools/release-data.mjs` builds the rest of that screen at deploy time from the credits and licence files under `assets/`,
the "Data and credits" list in `README.md`, the fonts in `index.html` and the dependencies in `package.json`.
A new `CREDITS*` / `LICENSE*` file anywhere in the repo is picked up automatically (`tools/release-data.test.mjs` fails otherwise).

## Team

<!-- Name | GitHub handle | role | other names used in git commits (optional, separated by ;) -->
- Alexandros Lekkas | aflekkas | Creator and maintainer | Alex Flekkas
- Vassilis Perrotis | Vas-Per | Contributor

## AI

Built with help from AI coding agents.
