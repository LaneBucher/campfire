import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { fire, fireLogs, WORLD } from './state'
import { smokeTexture, sparkTexture } from './procedural'

/* ============================ shared GLSL noise ============================ */
const NOISE = /* glsl */ `
float hash13(vec3 p){
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
float vnoise(vec3 x){
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash13(i + vec3(0,0,0)), hash13(i + vec3(1,0,0)), f.x),
                 mix(hash13(i + vec3(0,1,0)), hash13(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash13(i + vec3(0,0,1)), hash13(i + vec3(1,0,1)), f.x),
                 mix(hash13(i + vec3(0,1,1)), hash13(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p){
  float a = 0.5, s = 0.0;
  for (int i = 0; i < OCTAVES; i++){
    s += a * vnoise(p);
    p = p * 2.07 + vec3(11.3, 7.7, 3.1);
    a *= 0.5;
  }
  return s;
}
`

/* ========================= volumetric raymarched flame ===================== */
const flameVert = /* glsl */ `
uniform mat4 uInvModel;
varying vec3 vOrigin;
varying vec3 vDir;
void main(){
  vOrigin = (uInvModel * vec4(cameraPosition, 1.0)).xyz;
  vDir = position - vOrigin;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const flameFrag = /* glsl */ `
precision highp float;
uniform float uTime, uIntensity, uWindX, uWindZ, uBright, uFlicker;
uniform float uDecay, uCoal, uCoalR, uThick;
uniform vec4 uLogA[MAXLOGS];   // xyz = one end cap (box-local), w = log radius
uniform vec4 uLogB[MAXLOGS];   // xyz = other end cap, w = how alight it is
uniform int uLogCount;
uniform sampler2D uDepth;
uniform vec2 uRes;
uniform float uNear, uFar;
uniform mat4 uViewModel;
varying vec3 vOrigin;
varying vec3 vDir;
${NOISE}

vec2 hitBox(vec3 orig, vec3 dir){
  const vec3 bmin = vec3(-0.5);
  const vec3 bmax = vec3(0.5);
  vec3 inv = 1.0 / dir;
  vec3 t0v = (bmin - orig) * inv;
  vec3 t1v = (bmax - orig) * inv;
  vec3 tmin = min(t0v, t1v), tmax = max(t0v, t1v);
  return vec2(max(tmin.x, max(tmin.y, tmin.z)), min(tmax.x, min(tmax.y, tmax.z)));
}

/* How much burnable gas is at this point. Every lit log emits a sheath that
   hugs its surface and a plume that climbs off it, so the flames sit on the
   wood and lick along it. The ember bed adds a low source of its own, which is
   all that is left once the wood is gone. */
float fuelAt(vec3 p, out float src){
  float h = max(p.y + 0.5, 0.0);
  vec2 shear = vec2(uWindX, uWindZ) * pow(h, 1.7);
  vec2 xz = p.xz - shear;
  float f = 0.0;
  float top = 0.0;

  float Rc = uCoalR * (1.0 + h * 1.3);
  f += uCoal * (1.0 - smoothstep(Rc * 0.25, Rc, length(xz))) * exp(-h * (uDecay + 2.4));

  for (int i = 0; i < MAXLOGS; i++){
    if (i >= uLogCount) break;
    float lit = uLogB[i].w;
    vec3 a = uLogA[i].xyz;
    vec3 b = uLogB[i].xyz;
    float rad = uLogA[i].w;
    // nearest point on the log's axis, measured in plan view
    vec2 ab = b.xz - a.xz;
    float t = clamp(dot(xz - a.xz, ab) / max(dot(ab, ab), 1e-5), 0.0, 1.0);
    float dy = p.y - mix(a.y, b.y, t);
    // flames wrap the sides and climb, but nothing burns underneath a log
    if (dy < -rad * 1.3) continue;
    float up = max(dy, 0.0);
    float dh = length(xz - (a.xz + ab * t));
    // a sheath hugging the bark, opening out into a plume as it climbs
    float R = rad * 2.4 + up * 0.85;
    float g = lit * (1.0 - smoothstep(R * 0.3, R, dh)) * exp(-up * uDecay);
    f += g;
    top = max(top, g);
  }
  src = top;
  // Overlapping logs should feed each other, not stack into a solid block, so
  // saturate the sum instead of letting it run away.
  return 1.35 * (1.0 - exp(-f));
}

float density(vec3 p, out float hot){
  hot = 0.0;
  float src;
  float f = fuelAt(p, src);
  if (f < 0.02) return 0.0;
  // noise stretched vertically and advected upward -> licking tongues, not blobs
  vec3 q = vec3(p.xz * 4.0, p.y * 1.6 - uTime * 1.95);
  float n1 = fbm(q);
  float n2 = fbm(q * 2.6 + vec3(19.0, 7.0, -uTime * 1.15));
  // value-noise fbm clusters around 0.5 — stretch it out or the flame comes
  // out as one smooth teardrop instead of separate tongues
  float turb = smoothstep(0.30, 0.72, n1 * 0.6 + n2 * 0.4);
  // the noise has to be able to drive this negative, otherwise the plume never
  // breaks into separate tongues
  float d = f * (0.40 + 1.70 * turb) * uFlicker - 0.60;
  // a wide ramp on purpose: if d saturates at 1 through the whole interior the
  // flame renders as one flat slab of a single colour
  d = smoothstep(0.0, 0.62, d);
  // hottest right against the fuel, cooling as it rises away
  hot = d * (0.38 + 0.72 * min(f, 1.6)) * (1.0 - clamp((p.y + 0.5) * 0.40, 0.0, 0.58));
  return d;
}

vec3 fireColor(float t){
  t = clamp(t, 0.0, 1.0);
  vec3 c = mix(vec3(0.30, 0.010, 0.0005), vec3(0.95, 0.09, 0.004), smoothstep(0.0, 0.30, t));
  c = mix(c, vec3(1.0, 0.32, 0.022), smoothstep(0.26, 0.58, t));
  c = mix(c, vec3(1.0, 0.52, 0.07), smoothstep(0.55, 0.82, t));
  // never ramp to white here — let ACES desaturate the hottest cores instead
  c = mix(c, vec3(1.0, 0.74, 0.26), smoothstep(0.82, 1.0, t));
  return c;
}

void main(){
  vec3 rd = normalize(vDir);
  vec2 b = hitBox(vOrigin, rd);
  if (b.x > b.y) discard;
  b.x = max(b.x, 0.0);

  // View-space depth of the nearest solid surface on this pixel. Without it the
  // volume draws straight over the stones and logs standing in front of it.
  float dz = texture2D(uDepth, gl_FragCoord.xy / uRes).x;
  float sceneVZ = (uNear * uFar) / ((uFar - uNear) * dz - uFar);

  float dt = (b.y - b.x) / float(STEPS);
  // interleaved gradient noise: dithers away the step banding without the
  // salt-and-pepper a pure random offset leaves behind
  float jit = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  vec3 p = vOrigin + rd * (b.x + dt * jit);
  float vz = (uViewModel * vec4(p, 1.0)).z;
  float vzStep = (uViewModel * vec4(rd * dt, 0.0)).z;

  vec3 acc = vec3(0.0);
  float tau = 0.0;                       // optical depth so far
  for (int i = 0; i < STEPS; i++){
    float gap = vz - sceneVZ;            // >0 while the sample is still in front
    if (gap < 0.0) break;
    float hot;
    float d = density(p, hot) * uIntensity;
    if (d > 0.002){
      // soften the last few centimetres so the flame meets wood and stone
      // without a hard cut-out edge
      float soft = smoothstep(0.0, 0.03, gap);
      float em = d * dt * uBright * 6.0 * soft;
      // flame is optically thick: the near side hides the far side, which is
      // what stops the core turning into one flat washed-out disc
      acc += fireColor(hot) * em * exp(-tau);
      tau += d * dt * uThick * soft;
      if (tau > 6.0) break;
    }
    p += rd * dt;
    vz += vzStep;
  }
  // premultiplied alpha: a dense flame hides what is behind it instead of
  // glowing straight through it
  gl_FragColor = vec4(acc, 1.0 - exp(-tau));
}
`

/* world size of the flame volume, and where its base sits */
const BOX = [2.0, 1.9, 2.0]
const BASE_Y = 0.02

const MAX_LOGS = 6
const CENTER_Y = BASE_Y + BOX[1] / 2

function Flame({ quality }) {
  const mesh = useRef()
  const inv = useMemo(() => new THREE.Matrix4(), [])
  const { gl, scene, camera, size } = useThree()

  // Depth of the opaque scene, so the raymarch can stop at stones and logs.
  const depthRT = useMemo(() => {
    const depthTexture = new THREE.DepthTexture(1, 1)
    depthTexture.type = THREE.UnsignedIntType
    depthTexture.minFilter = THREE.NearestFilter
    depthTexture.magFilter = THREE.NearestFilter
    return new THREE.WebGLRenderTarget(1, 1, {
      depthTexture,
      depthBuffer: true,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
    })
  }, [])
  useEffect(() => () => depthRT.dispose(), [depthRT])

  const material = useMemo(() => {
    const steps = [36, 56, 80][quality]
    const oct = [3, 4, 4][quality]
    return new THREE.ShaderMaterial({
      vertexShader: flameVert,
      fragmentShader:
        `#define STEPS ${steps}\n#define OCTAVES ${oct}\n#define MAXLOGS ${MAX_LOGS}\n` + flameFrag,
      uniforms: {
        uTime: { value: 0 },
        uIntensity: { value: 1 },
        uWindX: { value: 0 },
        uWindZ: { value: 0 },
        uBright: { value: 0.9 },
        uFlicker: { value: 1 },
        uDecay: { value: 3.2 },
        uCoal: { value: 0.5 },
        uCoalR: { value: 0.3 },
        uThick: { value: 9 },
        uLogA: { value: Array.from({ length: MAX_LOGS }, () => new THREE.Vector4()) },
        uLogB: { value: Array.from({ length: MAX_LOGS }, () => new THREE.Vector4()) },
        uLogCount: { value: 0 },
        uInvModel: { value: new THREE.Matrix4() },
        uViewModel: { value: new THREE.Matrix4() },
        uDepth: { value: null },
        uRes: { value: new THREE.Vector2(1, 1) },
        uNear: { value: 0.05 },
        uFar: { value: 200 },
      },
      transparent: true,
      depthWrite: false,
      // depth is handled per sample against uDepth, not by the box's own faces
      depthTest: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendEquation: THREE.AddEquation,
      side: THREE.FrontSide,
      toneMapped: false,
    })
  }, [quality])

  // scratch, reused every frame
  const scratch = useMemo(
    () => ({ a: new THREE.Vector3(), b: new THREE.Vector3(), list: [] }),
    []
  )

  useFrame((s) => {
    const m = mesh.current
    if (!m) return
    const dpr = gl.getPixelRatio()
    const w = Math.max(1, Math.floor(size.width * dpr))
    const h = Math.max(1, Math.floor(size.height * dpr))
    if (depthRT.width !== w || depthRT.height !== h) depthRT.setSize(w, h)
    // hide the volume for the prepass, or it pays for itself twice
    m.visible = false
    const prev = gl.getRenderTarget()
    const prevShadow = gl.shadowMap.autoUpdate
    gl.shadowMap.autoUpdate = false // the real pass already refreshed them
    gl.setRenderTarget(depthRT)
    gl.render(scene, camera)
    gl.setRenderTarget(prev)
    gl.shadowMap.autoUpdate = prevShadow
    m.visible = true
    const u = material.uniforms
    u.uDepth.value = depthRT.depthTexture
    u.uRes.value.set(w, h)
    u.uNear.value = camera.near
    u.uFar.value = camera.far
  }, -2)

  useFrame((s) => {
    const u = material.uniforms
    const t = s.clock.elapsedTime
    if (!fire.paused) u.uTime.value = t
    const I = fire.intensity
    // flicker: two slow waves plus a faster tremor, so it never looks periodic
    // keep this gentle: it scales the whole density field at once, so a big
    // swing makes the entire fire vanish rather than flicker
    const fl =
      0.95 +
      0.05 * Math.sin(t * 3.1) +
      0.035 * Math.sin(t * 7.3 + 1.3) +
      0.025 * Math.sin(t * 17.7 + 0.6)
    u.uFlicker.value = fl + fire.gust * 0.35
    u.uIntensity.value = 0.75 + I * 0.45 + fire.gust * 0.35
    u.uBright.value = 0.30 + I * 0.12
    u.uThick.value = 9 + I * 4
    // plumes climb higher the harder it is burning
    u.uDecay.value = 8.8 - I * 2.6 - fire.gust * 0.7
    // with no wood left this is the whole fire: a low flicker over the embers
    u.uCoal.value = 0.44 + 0.48 * fire.fuel
    u.uCoalR.value = 0.24 + 0.06 * I
    // shear is in local box units — anything much past 0.4 tips the flame
    // straight out through the side of its own volume
    const gustPush = fire.gust * 0.35
    u.uWindX.value = fire.wind.x * 0.45 + gustPush * Math.cos(fire.windAngle)
    u.uWindZ.value = fire.wind.y * 0.45 + gustPush * Math.sin(fire.windAngle)

    // hand the shader the logs that are actually alight, brightest first
    const list = scratch.list
    list.length = 0
    for (const l of fireLogs.values()) list.push(l)
    if (list.length > MAX_LOGS) {
      list.sort((x, y) => y.lit - x.lit)
      list.length = MAX_LOGS
    }
    for (let i = 0; i < list.length; i++) {
      const l = list[i]
      // A log carried out of the pit keeps burning for a moment; fade its flame
      // before it reaches the wall of the volume so it never clips flat.
      const edge = Math.max(
        Math.abs((l.a.x + l.b.x) * 0.5) / (BOX[0] * 0.5),
        Math.abs((l.a.z + l.b.z) * 0.5) / (BOX[2] * 0.5)
      )
      const fade = 1 - THREE.MathUtils.smoothstep(edge, 0.5, 0.88)
      // world -> box-local: the volume is axis aligned, so this is just a scale
      u.uLogA.value[i].set(
        l.a.x / BOX[0],
        (l.a.y - CENTER_Y) / BOX[1],
        l.a.z / BOX[2],
        Math.max(l.r / BOX[0], 0.01)
      )
      u.uLogB.value[i].set(
        l.b.x / BOX[0],
        (l.b.y - CENTER_Y) / BOX[1],
        l.b.z / BOX[2],
        l.lit * fade
      )
    }
    u.uLogCount.value = list.length

    const m = mesh.current
    if (!m) return
    inv.copy(m.matrixWorld).invert()
    u.uInvModel.value.copy(inv)
    u.uViewModel.value.copy(s.camera.matrixWorldInverse).multiply(m.matrixWorld)
    // front faces vanish once the camera is inside the box — flip to back faces
    const c = s.camera.position
    const inside =
      Math.abs(c.x) < BOX[0] / 2 &&
      Math.abs(c.z) < BOX[2] / 2 &&
      c.y > BASE_Y &&
      c.y < BASE_Y + BOX[1]
    const want = inside ? THREE.BackSide : THREE.FrontSide
    if (material.side !== want) material.side = want
  })

  return (
    <mesh
      ref={mesh}
      position={[0, BASE_Y + BOX[1] / 2, 0]}
      scale={BOX}
      renderOrder={5}
      raycast={() => null}
    >
      <boxGeometry args={[1, 1, 1]} />
      <primitive object={material} attach="material" />
    </mesh>
  )
}

/* ============================== glowing coal bed =========================== */
const coalVert = /* glsl */ `
uniform float uTime;
varying vec2 vUv;
varying float vBump;
${NOISE}
void main(){
  vUv = uv;
  vec2 c = uv * 2.0 - 1.0;
  float r = length(c);
  // lumpy bed of broken coals rather than a flat decal
  float lump = fbm(vec3(uv * 9.0, 0.0));
  vBump = lump;
  float dome = (1.0 - r * r) * 0.028;
  vec3 pos = position;
  pos.z += dome + lump * 0.03 * smoothstep(1.0, 0.7, r);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`

const coalFrag = /* glsl */ `
precision highp float;
uniform float uTime, uIntensity;
varying vec2 vUv;
varying float vBump;
${NOISE}
void main(){
  vec2 c = vUv * 2.0 - 1.0;
  float r = length(c);
  if (r > 1.0) discard;
  vec3 q = vec3(vUv * 9.0, 0.0);
  float chunk = fbm(q * 0.8);
  // ridged noise gives thin bright fissures between the coals
  float crack = 1.0 - abs(fbm(q * 1.7 + 3.0) * 2.0 - 1.0);
  crack = pow(clamp(crack, 0.0, 1.0), 7.0);
  float pulse = 0.5 + 0.5 * sin(uTime * (0.9 + chunk * 2.4) + chunk * 40.0);
  float hot = max(crack * 1.1, smoothstep(0.66, 0.9, chunk)) * (0.45 + 0.55 * pulse);
  hot *= smoothstep(1.0, 0.28, r);
  hot *= 0.2 + 1.15 * uIntensity;
  // ash crust is nearly black: anything lighter reads as grey paper
  vec3 ash = vec3(0.010, 0.0085, 0.008) * (0.4 + vBump * 1.5);
  vec3 glow = mix(vec3(0.35, 0.022, 0.004), vec3(1.0, 0.28, 0.03), hot);
  glow = mix(glow, vec3(1.4, 0.62, 0.14), smoothstep(0.6, 1.0, hot));
  vec3 col = ash + glow * hot * 1.5;
  gl_FragColor = vec4(col, smoothstep(1.0, 0.80, r));
}
`

function Coals() {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: `#define OCTAVES 3\n` + coalVert,
        fragmentShader: `#define OCTAVES 4\n` + coalFrag,
        uniforms: { uTime: { value: 0 }, uIntensity: { value: 1 } },
        transparent: true,
        toneMapped: false,
      }),
    []
  )
  useFrame((s) => {
    if (!fire.paused) material.uniforms.uTime.value = s.clock.elapsedTime
    material.uniforms.uIntensity.value = THREE.MathUtils.clamp(fire.intensity * 1.1 + fire.gust * 0.5, 0, 1.4)
  })
  const R = WORLD.pitRadius * 0.86
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, WORLD.coalY, 0]} raycast={() => null}>
      <planeGeometry args={[R * 2, R * 2, 40, 40]} />
      <primitive object={material} attach="material" />
    </mesh>
  )
}

/* ================================== embers ================================= */
const EMBER_MAX = 420

function Embers() {
  const points = useRef()
  const tex = useMemo(() => sparkTexture(), [])
  const data = useMemo(() => {
    const pos = new Float32Array(EMBER_MAX * 3)
    const vel = new Float32Array(EMBER_MAX * 3)
    const life = new Float32Array(EMBER_MAX)
    const max = new Float32Array(EMBER_MAX)
    const size = new Float32Array(EMBER_MAX)
    const heat = new Float32Array(EMBER_MAX)
    for (let i = 0; i < EMBER_MAX; i++) pos[i * 3 + 1] = -999
    return { pos, vel, life, max, size, heat, cursor: 0 }
  }, [])

  const geom = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(data.pos, 3))
    g.setAttribute('aSize', new THREE.BufferAttribute(data.size, 1))
    g.setAttribute('aHeat', new THREE.BufferAttribute(data.heat, 1))
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 2, 0), 14)
    return g
  }, [data])

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uTex: { value: tex }, uScale: { value: 420 } },
        vertexShader: /* glsl */ `
          attribute float aSize; attribute float aHeat;
          varying float vHeat;
          uniform float uScale;
          void main(){
            vHeat = aHeat;
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            gl_PointSize = aSize * uScale / max(-mv.z, 0.001);
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: /* glsl */ `
          uniform sampler2D uTex; varying float vHeat;
          void main(){
            vec4 t = texture2D(uTex, gl_PointCoord);
            // cooling ember: white-hot -> orange -> dull red
            vec3 c = mix(vec3(0.85, 0.10, 0.01), vec3(1.0, 0.52, 0.10), smoothstep(0.0, 0.55, vHeat));
            c = mix(c, vec3(1.0, 0.94, 0.75), smoothstep(0.7, 1.0, vHeat));
            gl_FragColor = vec4(c * t.rgb, t.a * clamp(vHeat, 0.0, 1.0));
          }`,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    [tex]
  )

  const spawn = (n, burst) => {
    for (let k = 0; k < n; k++) {
      const i = data.cursor
      data.cursor = (data.cursor + 1) % EMBER_MAX
      const a = Math.random() * Math.PI * 2
      const r = Math.random() * WORLD.pitRadius * 0.55
      data.pos[i * 3] = Math.cos(a) * r
      data.pos[i * 3 + 1] = WORLD.coalY + Math.random() * 0.25
      data.pos[i * 3 + 2] = Math.sin(a) * r
      const up = burst ? 2.0 + Math.random() * 2.4 : 0.8 + Math.random() * 1.2
      data.vel[i * 3] = (Math.random() - 0.5) * (burst ? 1.8 : 0.7)
      data.vel[i * 3 + 1] = up
      data.vel[i * 3 + 2] = (Math.random() - 0.5) * (burst ? 1.8 : 0.7)
      data.max[i] = 1.0 + Math.random() * 1.9
      data.life[i] = data.max[i]
      data.size[i] = 0.008 + Math.random() * 0.019
      data.heat[i] = 1
    }
  }

  useFrame((s, dtRaw) => {
    if (fire.paused) return
    const dt = Math.min(dtRaw, 0.05)
    const t = s.clock.elapsedTime
    // steady drizzle of sparks, scaled by how hard it is burning
    const rate = (3 + fire.intensity * 15) * dt
    let n = Math.floor(rate)
    if (Math.random() < rate - n) n++
    if (n) spawn(n, false)
    if (fire.emberBurst > 0) {
      spawn(Math.min(90, Math.floor(fire.emberBurst)), true)
      fire.emberBurst = 0
    }

    const wx = fire.wind.x + fire.gust * 1.9 * Math.cos(fire.windAngle)
    const wz = fire.wind.y + fire.gust * 1.9 * Math.sin(fire.windAngle)
    const { pos, vel, life, max, heat, size } = data
    for (let i = 0; i < EMBER_MAX; i++) {
      if (life[i] <= 0) continue
      life[i] -= dt
      const i3 = i * 3
      const age = 1 - life[i] / max[i]
      if (life[i] <= 0) { pos[i3 + 1] = -999; heat[i] = 0; continue }
      // buoyancy fades as the ember cools, then gravity wins
      const buoy = (1 - age) * (2.1 + fire.intensity * 1.5) - 3.4 * age * age
      const swirl = Math.sin(t * 2.7 + i) * 0.9 + Math.sin(t * 1.3 + i * 2.1) * 0.7
      vel[i3] += (wx * 1.6 + swirl - vel[i3] * 1.7) * dt
      vel[i3 + 1] += (buoy - vel[i3 + 1] * 1.0) * dt
      vel[i3 + 2] += (wz * 1.6 + Math.cos(t * 2.2 + i * 1.7) * 0.9 + Math.sin(t * 3.4 + i) * 0.5 - vel[i3 + 2] * 1.7) * dt
      pos[i3] += vel[i3] * dt
      pos[i3 + 1] += vel[i3 + 1] * dt
      pos[i3 + 2] += vel[i3 + 2] * dt
      if (pos[i3 + 1] < 0.01) { life[i] = 0; pos[i3 + 1] = -999; heat[i] = 0; continue }
      heat[i] = Math.pow(1 - age, 1.7) * (0.7 + 0.3 * Math.sin(t * 20 + i))
      size[i] *= 1 - dt * 0.06
    }
    geom.attributes.position.needsUpdate = true
    geom.attributes.aHeat.needsUpdate = true
    geom.attributes.aSize.needsUpdate = true
    material.uniforms.uScale.value = s.size.height * 0.9
  })

  // after the flame (renderOrder 5), which is now opaque enough to hide them
  return (
    <points
      ref={points}
      geometry={geom}
      material={material}
      frustumCulled={false}
      renderOrder={6}
      raycast={() => null}
    />
  )
}

/* =================================== smoke ================================= */
const SMOKE_MAX = 190

function Smoke() {
  const tex = useMemo(() => smokeTexture(), [])
  const data = useMemo(() => {
    const pos = new Float32Array(SMOKE_MAX * 3)
    const vel = new Float32Array(SMOKE_MAX * 3)
    const attr = new Float32Array(SMOKE_MAX * 4) // size, rot, opacity, seed
    const life = new Float32Array(SMOKE_MAX)
    const max = new Float32Array(SMOKE_MAX)
    const spin = new Float32Array(SMOKE_MAX)
    for (let i = 0; i < SMOKE_MAX; i++) pos[i * 3 + 1] = -999
    return { pos, vel, attr, life, max, spin, cursor: 0 }
  }, [])

  const geom = useMemo(() => {
    const g = new THREE.InstancedBufferGeometry()
    const quad = new THREE.PlaneGeometry(1, 1)
    g.index = quad.index
    g.attributes.position = quad.attributes.position
    g.attributes.uv = quad.attributes.uv
    g.setAttribute('iPos', new THREE.InstancedBufferAttribute(data.pos, 3))
    g.setAttribute('iAttr', new THREE.InstancedBufferAttribute(data.attr, 4))
    g.instanceCount = SMOKE_MAX
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 4, 0), 20)
    return g
  }, [data])

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uTex: { value: tex },
          uIntensity: { value: 1 },
          uFogColor: { value: new THREE.Color('#0a0c12') },
        },
        vertexShader: /* glsl */ `
          attribute vec3 iPos; attribute vec4 iAttr;
          varying vec2 vUv; varying float vOpacity; varying float vHeight; varying float vSeed;
          void main(){
            vUv = uv; vOpacity = iAttr.z; vHeight = iPos.y; vSeed = iAttr.w;
            float s = iAttr.x, rot = iAttr.y;
            vec2 p = position.xy * s;
            p = vec2(p.x * cos(rot) - p.y * sin(rot), p.x * sin(rot) + p.y * cos(rot));
            vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
            vec3 up     = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
            vec3 world = iPos + right * p.x + up * p.y;
            gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          uniform sampler2D uTex; uniform float uIntensity; uniform vec3 uFogColor;
          varying vec2 vUv; varying float vOpacity; varying float vHeight; varying float vSeed;
          void main(){
            vec4 t = texture2D(uTex, vUv);
            float a = t.a * vOpacity;
            if (a < 0.004) discard;
            // low smoke catches a little firelight; higher up it is just cold grey
            float lit = exp(-max(vHeight - 0.9, 0.0) * 1.6) * uIntensity;
            vec3 warm = vec3(1.0, 0.42, 0.12) * lit * 0.16;
            vec3 cold = mix(vec3(0.020, 0.021, 0.025), vec3(0.085, 0.088, 0.10), 0.3 + vSeed * 0.5);
            vec3 col = cold + warm;
            col = mix(col, uFogColor, clamp(vHeight * 0.05, 0.0, 0.7));
            gl_FragColor = vec4(col, a);
          }`,
        transparent: true,
        depthWrite: false,
        blending: THREE.NormalBlending,
        toneMapped: false,
      }),
    [tex]
  )

  useFrame((s, dtRaw) => {
    if (fire.paused) return
    const dt = Math.min(dtRaw, 0.05)
    const t = s.clock.elapsedTime
    const { pos, vel, attr, life, max, spin } = data

    const rate = (2.2 + fire.intensity * 7 + fire.gust * 10) * dt
    let n = Math.floor(rate)
    if (Math.random() < rate - n) n++
    for (let k = 0; k < n + (fire.smokePuff > 0 ? 8 : 0); k++) {
      const i = data.cursor
      data.cursor = (data.cursor + 1) % SMOKE_MAX
      const a = Math.random() * Math.PI * 2
      const r = Math.random() * 0.2
      pos[i * 3] = Math.cos(a) * r
      // born above the flame tip — below that the gas is still burning, not smoking
      pos[i * 3 + 1] = 0.95 + fire.intensity * 0.85 + Math.random() * 0.4
      pos[i * 3 + 2] = Math.sin(a) * r
      vel[i * 3] = (Math.random() - 0.5) * 0.25
      vel[i * 3 + 1] = 0.9 + Math.random() * 0.8 + fire.intensity * 0.7
      vel[i * 3 + 2] = (Math.random() - 0.5) * 0.25
      max[i] = 6 + Math.random() * 6
      life[i] = max[i]
      attr[i * 4] = 0.16 + Math.random() * 0.16
      attr[i * 4 + 1] = Math.random() * Math.PI * 2
      attr[i * 4 + 2] = 0
      attr[i * 4 + 3] = Math.random()
      spin[i] = (Math.random() - 0.5) * 0.55
    }
    fire.smokePuff = 0

    const wx = fire.wind.x + fire.gust * 2.2 * Math.cos(fire.windAngle)
    const wz = fire.wind.y + fire.gust * 2.2 * Math.sin(fire.windAngle)
    for (let i = 0; i < SMOKE_MAX; i++) {
      if (life[i] <= 0) continue
      life[i] -= dt
      const i3 = i * 3, i4 = i * 4
      if (life[i] <= 0) { pos[i3 + 1] = -999; attr[i4 + 2] = 0; continue }
      const age = 1 - life[i] / max[i]
      // hot column rises fast then the plume goes slack and the wind takes it
      const rise = THREE.MathUtils.lerp(1.5 + fire.intensity, 0.22, Math.min(1, age * 1.8))
      const curl = Math.sin(pos[i3 + 1] * 1.3 + t * 0.7 + i) * 0.35
      const curl2 = Math.cos(pos[i3 + 1] * 1.1 - t * 0.55 + i * 1.7) * 0.35
      vel[i3] += (wx * (0.6 + age * 2.2) + curl - vel[i3] * 1.4) * dt
      vel[i3 + 1] += (rise - vel[i3 + 1] * 1.4) * dt
      vel[i3 + 2] += (wz * (0.6 + age * 2.2) + curl2 - vel[i3 + 2] * 1.4) * dt
      pos[i3] += vel[i3] * dt
      pos[i3 + 1] += vel[i3 + 1] * dt
      pos[i3 + 2] += vel[i3 + 2] * dt
      attr[i4] += dt * (0.20 + age * 0.42)            // puffs expand as they dissipate
      attr[i4 + 1] += spin[i] * dt
      const fadeIn = THREE.MathUtils.smoothstep(age, 0.0, 0.14)
      const fadeOut = 1 - THREE.MathUtils.smoothstep(age, 0.35, 1.0)
      attr[i4 + 2] = fadeIn * fadeOut * (0.05 + fire.intensity * 0.07)
    }
    geom.attributes.iPos.needsUpdate = true
    geom.attributes.iAttr.needsUpdate = true
    material.uniforms.uIntensity.value = fire.intensity
  })

  return <mesh geometry={geom} material={material} frustumCulled={false} renderOrder={4} raycast={() => null} />
}

/* ================================ firelight =============================== */
function FireLight() {
  const main = useRef()
  const fill = useRef()
  useFrame((s, dt) => {
    const t = s.clock.elapsedTime
    const I = fire.intensity
    // layered incommensurate frequencies read as a real flame, not a sine wave
    const flicker =
      0.78 +
      0.12 * Math.sin(t * 6.1) +
      0.07 * Math.sin(t * 11.7 + 2.1) +
      0.06 * Math.sin(t * 23.3 + 0.8) +
      0.05 * Math.sin(t * 3.1 + 4.2)
    const power = (0.35 + I * 1.5 + fire.gust * 1.2) * flicker
    if (main.current) {
      // keep this modest: wood sitting 30cm from the light blows straight out,
      // and logs inside the fire should read as dark shapes behind the flame
      main.current.intensity = THREE.MathUtils.lerp(main.current.intensity, power * 1.15, 1 - Math.pow(0.001, dt))
      main.current.position.set(
        Math.sin(t * 4.3) * 0.06,
        0.55 + I * 0.35 + Math.sin(t * 5.7) * 0.05,
        Math.cos(t * 3.9) * 0.06
      )
      main.current.color.setRGB(1.0, 0.52 + I * 0.1, 0.20 + I * 0.06)
    }
    if (fill.current) fill.current.intensity = power * 0.9
  })
  return (
    <>
      <pointLight
        ref={main}
        castShadow
        distance={26}
        // a fire is a volume, not a point: inverse-square makes anything sitting
        // in the pit blow out long before the clearing is lit at all
        decay={1.5}
        intensity={6}
        shadow-mapSize={[1024, 1024]}
        shadow-bias={-0.0015}
        shadow-normalBias={0.02}
      />
      <pointLight ref={fill} position={[0, 1.6, 0]} distance={12} decay={1.5} color="#ff7a2a" intensity={2} />
    </>
  )
}

export default function Fire({ quality }) {
  return (
    <group>
      <Coals />
      <Flame quality={quality} />
      <Embers />
      <Smoke />
      <FireLight />
    </group>
  )
}
