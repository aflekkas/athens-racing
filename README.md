# Paraliaki Racing

A 3D browser racing game down the Athens Riviera: from the Glyfada seafront on Poseidonos Avenue, past Voula, Kavouri, Vouliagmeni and Astir, along the coast road to Limanakia. Race a rival through Athens traffic in a red Mini Cooper Cabrio (or four other cars).

Built with Three.js. No build step.

## Play

```sh
python3 -m http.server 8000
```

Open http://localhost:8000. The race starts on its own; sound starts on your first keypress.

| Key | Action |
|---|---|
| W / ↑ | Accelerate |
| S / ↓ | Brake / reverse |
| A D / ← → | Steer |
| Space | Handbrake |
| Shift | Nitro |
| C | Cockpit / chase camera |
| 1–5, G | Change car / garage |
| R / Enter | Restart |
| M | Music |

## Data and credits

- Road network, coastline, buildings and points of interest: © OpenStreetMap contributors (ODbL), in `data/`.
- Elevation: EU-DEM v1.1 via OpenTopoData.
- Textures: Poly Haven (CC0), in `assets/tex/`.

The scripts in `tools/` rebuild the map data, terrain and textures.
