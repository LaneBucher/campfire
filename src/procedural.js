import * as THREE from 'three'

/* ---------- tiny seeded value-noise fbm (CPU, for canvas textures) ---------- */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function makeNoise(seed = 1) {
  const rnd = mulberry32(seed)
  const P = new Uint8Array(512)
  const perm = new Uint8Array(256)
  for (let i = 0; i < 256; i++) perm[i] = i
  for (let i = 255; i > 0; i--) {
    const j = (rnd() * (i + 1)) | 0
    const t = perm[i]; perm[i] = perm[j]; perm[j] = t
  }
  for (let i = 0; i < 512; i++) P[i] = perm[i & 255]
  const grad = (h, x, y) => {
    const u = h & 1 ? x : -x
    const v = h & 2 ? y : -y
    return u + v
  }
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10)
  const lerp = (a, b, t) => a + (b - a) * t

  // periodic 2D value/perlin-ish noise so textures tile seamlessly
  return function noise2(x, y, period = 256) {
    const wrap = (v) => ((v % period) + period) % period
    const X0 = Math.floor(x), Y0 = Math.floor(y)
    const xf = x - X0, yf = y - Y0
    const xi = wrap(X0) & 255, yi = wrap(Y0) & 255
    const xi1 = wrap(X0 + 1) & 255, yi1 = wrap(Y0 + 1) & 255
    const u = fade(xf), v = fade(yf)
    const aa = P[P[xi] + yi], ba = P[P[xi1] + yi]
    const ab = P[P[xi] + yi1], bb = P[P[xi1] + yi1]
    const x1 = lerp(grad(aa, xf, yf), grad(ba, xf - 1, yf), u)
    const x2 = lerp(grad(ab, xf, yf - 1), grad(bb, xf - 1, yf - 1), u)
    return lerp(x1, x2, v) * 0.5 + 0.5
  }
}

function fbm2(noise, x, y, oct = 5, period = 256, lac = 2, gain = 0.5) {
  let a = 0.5, f = 1, sum = 0, norm = 0
  for (let i = 0; i < oct; i++) {
    sum += a * noise(x * f, y * f, period * f)
    norm += a
    f *= lac; a *= gain
  }
  return sum / norm
}

const canvas2d = (size) => {
  const c = document.createElement('canvas')
  c.width = c.height = size
  return [c, c.getContext('2d')]
}

const finish = (canvas, repeat = 1, srgb = true) => {
  const t = new THREE.CanvasTexture(canvas)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(repeat, repeat)
  t.anisotropy = 8
  if (srgb) t.colorSpace = THREE.SRGBColorSpace
  t.needsUpdate = true
  return t
}

/* build a normal map out of a height function sampled on a grid */
function normalFromHeight(size, heightAt, strength = 2.4) {
  const [c, ctx] = canvas2d(size)
  const img = ctx.createImageData(size, size)
  const h = new Float32Array(size * size)
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) h[y * size + x] = heightAt(x, y)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const l = h[y * size + ((x - 1 + size) % size)]
      const r = h[y * size + ((x + 1) % size)]
      const u = h[((y - 1 + size) % size) * size + x]
      const d = h[((y + 1) % size) * size + x]
      let nx = (l - r) * strength, ny = (u - d) * strength, nz = 1
      const len = Math.hypot(nx, ny, nz)
      nx /= len; ny /= len; const nzz = nz / len
      const i = (y * size + x) * 4
      img.data[i] = (nx * 0.5 + 0.5) * 255
      img.data[i + 1] = (ny * 0.5 + 0.5) * 255
      img.data[i + 2] = (nzz * 0.5 + 0.5) * 255
      img.data[i + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  return c
}

/* ---------------------------------- bark ---------------------------------- */
let _bark = null
export function barkTextures() {
  if (_bark) return _bark
  const S = 512
  const n = makeNoise(7)
  // ridged vertical fibres + knots
  const height = (x, y) => {
    const u = x / S * 8, v = y / S * 2.4
    let ridge = fbm2(n, u * 1.2, v * 9.0, 4, 256)
    ridge = Math.abs(ridge * 2 - 1)
    ridge = Math.pow(1 - ridge, 2.2)
    const coarse = fbm2(n, u * 0.7, v * 1.8, 4, 256)
    const cracks = Math.pow(fbm2(n, u * 3.1 + 11, v * 14, 3, 256), 3.0)
    return ridge * 0.65 + coarse * 0.3 - cracks * 0.35
  }
  const [c, ctx] = canvas2d(S)
  const img = ctx.createImageData(S, S)
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const hgt = THREE.MathUtils.clamp(height(x, y), 0, 1)
      const tone = 0.35 + hgt * 0.75
      const moss = Math.max(0, fbm2(n, x / S * 5 + 30, y / S * 5, 3, 256) - 0.62) * 2.6
      let r = 96 * tone, g = 72 * tone, b = 54 * tone
      r = r * (1 - moss) + 62 * moss
      g = g * (1 - moss) + 78 * moss
      b = b * (1 - moss) + 44 * moss
      const i = (y * S + x) * 4
      img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  _bark = {
    map: finish(c, 1),
    normalMap: finish(normalFromHeight(S, (x, y) => height(x, y), 3.0), 1, false),
  }
  return _bark
}

/* --------------------------------- ground --------------------------------- */
let _ground = null
export function groundTextures() {
  if (_ground) return _ground
  const S = 512
  const n = makeNoise(23)
  const height = (x, y) => {
    const u = x / S * 6, v = y / S * 6
    return fbm2(n, u, v, 5, 256) * 0.8 + Math.pow(fbm2(n, u * 6 + 4, v * 6, 3, 256), 2) * 0.4
  }
  const [c, ctx] = canvas2d(S)
  const img = ctx.createImageData(S, S)
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const h = height(x, y)
      const grit = fbm2(n, x / S * 40, y / S * 40, 2, 256)
      const t = THREE.MathUtils.clamp(h * 0.75 + grit * 0.35, 0, 1)
      // damp earth → dry dust, with a few pale pebbles
      let r = 42 + t * 62, g = 33 + t * 48, b = 26 + t * 36
      const pebble = Math.max(0, fbm2(n, x / S * 22 + 9, y / S * 22, 2, 256) - 0.72) * 4
      r += pebble * 70; g += pebble * 66; b += pebble * 58
      const i = (y * S + x) * 4
      img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  _ground = {
    map: finish(c, 14),
    normalMap: (() => { const t = finish(normalFromHeight(S, height, 1.6), 14, false); return t })(),
  }
  return _ground
}

/* ---------------------------------- stone --------------------------------- */
let _stone = null
export function stoneTextures() {
  if (_stone) return _stone
  const S = 256
  const n = makeNoise(91)
  const height = (x, y) => fbm2(n, x / S * 5, y / S * 5, 5, 256)
  const [c, ctx] = canvas2d(S)
  const img = ctx.createImageData(S, S)
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const h = height(x, y)
      const t = 0.45 + h * 0.7
      const i = (y * S + x) * 4
      img.data[i] = 96 * t; img.data[i + 1] = 92 * t; img.data[i + 2] = 88 * t; img.data[i + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  _stone = { map: finish(c, 1), normalMap: finish(normalFromHeight(S, height, 2.2), 1, false) }
  return _stone
}

/* --------------------------- soft smoke puff sprite ------------------------ */
let _smoke = null
export function smokeTexture() {
  if (_smoke) return _smoke
  const S = 256, n = makeNoise(313)
  const [c, ctx] = canvas2d(S)
  const img = ctx.createImageData(S, S)
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = (x / S - 0.5) * 2, dy = (y / S - 0.5) * 2
      const r = Math.hypot(dx, dy)
      let a = Math.pow(Math.max(0, 1 - r), 1.9)
      const puff = fbm2(n, x / S * 4, y / S * 4, 5, 256)
      a *= 0.35 + puff * 1.25
      a = THREE.MathUtils.clamp(a, 0, 1)
      const i = (y * S + x) * 4
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255
      img.data[i + 3] = a * 255
    }
  }
  ctx.putImageData(img, 0, 0)
  const t = new THREE.CanvasTexture(c)
  t.needsUpdate = true
  _smoke = t
  return t
}

/* ----------------------------- glowing dot sprite -------------------------- */
let _spark = null
export function sparkTexture() {
  if (_spark) return _spark
  const S = 64
  const [c, ctx] = canvas2d(S)
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.25, 'rgba(255,210,140,0.85)')
  g.addColorStop(0.6, 'rgba(255,120,30,0.25)')
  g.addColorStop(1, 'rgba(255,80,0,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, S, S)
  const t = new THREE.CanvasTexture(c)
  t.needsUpdate = true
  _spark = t
  return t
}

/* --------------------------- knobbly log geometry -------------------------- */
const geoCache = new Map()
export function logGeometry(length = 0.9, radius = 0.09, seed = 1) {
  const key = `${length.toFixed(3)}|${radius.toFixed(3)}|${seed}`
  if (geoCache.has(key)) return geoCache.get(key)
  const g = new THREE.CylinderGeometry(radius * 0.92, radius, length, 14, 7, false)
  const rnd = mulberry32(seed * 9781)
  const n = makeNoise(seed * 17 + 3)
  const pos = g.attributes.position
  const v = new THREE.Vector3()
  const bend = (rnd() - 0.5) * radius * 2.2
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i)
    const ang = Math.atan2(v.z, v.x)
    const r = Math.hypot(v.x, v.z)
    if (r > 1e-4) {
      const bumps =
        (fbm2(n, (ang / Math.PI + 1) * 3, (v.y / length + 0.5) * 6, 3, 256) - 0.5) * radius * 0.5
      const nr = r + bumps
      v.x = Math.cos(ang) * nr
      v.z = Math.sin(ang) * nr
    }
    // gentle natural bow along the length
    const t = v.y / length
    v.x += bend * (0.25 - t * t) * 2
    pos.setXYZ(i, v.x, v.y, v.z)
  }
  g.computeVertexNormals()
  // lie the log along X so it reads as a felled branch
  g.rotateZ(Math.PI / 2)
  geoCache.set(key, g)
  return g
}

/* --------------------------- lumpy fire-ring stone ------------------------- */
export function stoneGeometry(scale = 1, seed = 1) {
  const key = `stone|${scale.toFixed(2)}|${seed}`
  if (geoCache.has(key)) return geoCache.get(key)
  const g = new THREE.IcosahedronGeometry(scale, 3)
  const n = makeNoise(seed * 31 + 5)
  const pos = g.attributes.position
  const v = new THREE.Vector3()
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i)
    const d = v.clone().normalize()
    const amp =
      fbm2(n, (d.x + 1) * 2.2, (d.y + 1) * 2.2, 4, 256) * 0.34 +
      fbm2(n, (d.z + 1) * 5, (d.y + 1) * 5, 3, 256) * 0.12
    v.multiplyScalar(0.78 + amp)
    v.y *= 0.72 // squat, water-worn
    pos.setXYZ(i, v.x, v.y, v.z)
  }
  g.computeVertexNormals()
  geoCache.set(key, g)
  return g
}

export { makeNoise, fbm2 }
