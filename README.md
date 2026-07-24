# Campfire

An interactive 3D campfire in the browser. Volumetric flames, drifting smoke, rigid-body
logs you can pick up and throw on the fire, and a marshmallow you can ruin.

```bash
npm install
npm run dev
```

## Controls

| Action | How |
| --- | --- |
| Orbit / zoom | drag · scroll |
| Pick up & throw a log | drag it — release to let physics take over |
| Drop a new log | click the ground, or **Add log** / <kbd>L</kbd> |
| Poke the fire | click the flames, or <kbd>K</kbd> |
| Blow on the coals | hold <kbd>Space</kbd> |
| Roast a marshmallow | <kbd>M</kbd>, then move the mouse to hold it over the flame |
| Pause | <kbd>P</kbd> |

Logs char, glow, and burn away. The fire consumes fuel as it goes — let it run down and
it dies, so keep feeding it.

## How it works

- **Flame** — a raymarched volume (`src/Fire.jsx`). A box mesh whose fragment shader steps
  through an FBM noise field shaped into a flame profile, integrating emission against
  absorption so the near side occludes the far side. There is a noise-independent density
  floor near the fuel bed that decays with height: the base always burns, while the tips
  are eroded by turbulence into separate tongues.
- **Coals** — a displaced plane with ridged noise for the fissures between embers, each
  pulsing at its own rate.
- **Smoke** — instanced camera-facing billboards, born at the flame tip, curling as they
  rise and expanding as they dissipate.
- **Embers** — CPU-simulated points: buoyancy that fades as they cool, then gravity wins.
- **Physics** — Rapier via `@react-three/rapier`. Logs are convex hulls; dragging switches
  a body to kinematic and back to dynamic on release, carrying the throw velocity.
- **Textures and geometry are generated at runtime** (`src/procedural.js`) — bark, ground,
  stone, smoke puffs, and the knobbly log/stone meshes. No image assets.
- **Audio** is synthesised with WebAudio (`src/audio.js`) — filtered brown noise for the
  roar, scheduled bandpass pops for crackles. No sound files.

Tone mapping runs once, in the post-processing composer after bloom, with the renderer
left linear — that is what lets the flame roll off to yellow instead of clipping to white.

The **Quality** setting trades raymarch steps (28 / 48 / 72) and noise octaves for speed.
