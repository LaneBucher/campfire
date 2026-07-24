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
  through a fuel field, integrating emission against absorption so the near side occludes
  the far side. It outputs premultiplied alpha, so a dense flame genuinely hides what is
  behind it rather than glowing through it.
- **The fuel field is built from the logs themselves.** Every log that is alight is handed
  to the shader as a segment; each one emits a sheath hugging its bark and a plume that
  climbs off it, so flames sit on the wood and lick along it. Contributions saturate rather
  than sum, so overlapping logs feed one fire instead of stacking into a solid block. The
  ember bed is a source of its own — and with the wood burned away it is the only one left,
  which is why an empty pit reduces to a low flicker over the coals.
- **Occlusion** — a depth prepass renders the opaque scene to a depth texture each frame,
  and the raymarch stops where the volume passes behind stones, logs, or the roasting stick,
  with a few centimetres of softening so the flame meets them without a hard cut-out edge.
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

The **Quality** setting trades raymarch steps (36 / 56 / 80) and noise octaves for speed.
