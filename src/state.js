import * as THREE from 'three'

/* One mutable object shared by the whole scene. Sim values change every frame;
   putting them in React state would re-render 60x/sec for nothing.
   ponytail: plain object instead of a store — nothing here needs subscriptions. */
export const fire = {
  fuel: 0.62,          // 0..1, burns down, logs top it up
  intensity: 0.62,     // smoothed flame strength
  gust: 0,             // 0..1 transient from blowing
  windAngle: 0.7,      // radians
  windStrength: 0.12,  // 0..1 ambient breeze
  wind: new THREE.Vector2(0.12, 0.0),
  emberBurst: 0,       // consumed by the ember system
  smokePuff: 0,
  quality: 1,          // 0 low / 1 med / 2 high
  sound: false,
  paused: false,
  dragging: false,     // suppresses hover cursors while a log is in hand
  litLogs: 0,          // sum of per-log burn strength — drives how big the fire gets

  /** Rough heat field: 1 at the heart of the flame, 0 well away from it. */
  heatAt(p) {
    const r = Math.hypot(p.x, p.z)
    const h = p.y
    if (h < -0.1 || h > 2.4) return 0
    const flameR = 0.42 + 0.28 * this.intensity
    const radial = 1 - THREE.MathUtils.smoothstep(r, flameR * 0.5, flameR * 2.6)
    const vertical = 1 - THREE.MathUtils.smoothstep(h, 0.25, 1.5 + this.intensity)
    return radial * (0.35 + 0.65 * vertical) * (0.25 + 0.9 * this.intensity)
  },
}

/* Live burning logs, keyed by log id. The flame shader turns these into the
   fuel field it burns from, so flames sit on the actual wood instead of on a
   fixed column at the origin. Each entry: { a, b, r, lit } in world space,
   where a/b are the log's end caps. */
export const fireLogs = new Map()

export const WORLD = {
  pitRadius: 0.78,
  coalY: 0.018,
}
