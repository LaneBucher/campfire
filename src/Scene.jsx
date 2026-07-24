import { useMemo, useRef, useState, useCallback, useEffect } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Physics, RigidBody, CuboidCollider } from '@react-three/rapier'
import { Stars, OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { fire, WORLD } from './state'
import Fire from './Fire'
import { barkTextures, groundTextures, stoneTextures, logGeometry, stoneGeometry } from './procedural'
import { crackle, hiss } from './audio'

/* =============================== global sim =============================== */
function FireSim() {
  useFrame((s, dtRaw) => {
    if (fire.paused) return
    const dt = Math.min(dtRaw, 0.05)
    // fuel burns down on its own; logs in the flame top it back up (see Log)
    fire.fuel = THREE.MathUtils.clamp(fire.fuel - dt * 0.022 * (0.4 + fire.intensity), 0, 1)
    const target = Math.pow(fire.fuel, 0.75)
    fire.intensity += (target - fire.intensity) * (1 - Math.pow(0.25, dt))
    fire.gust *= Math.pow(0.12, dt)
    // ambient breeze wanders instead of blowing dead straight
    const t = s.clock.elapsedTime
    const wander = Math.sin(t * 0.23) * 0.5 + Math.sin(t * 0.07 + 1.7) * 0.5
    const ang = fire.windAngle + wander * 0.45
    const str = fire.windStrength * (0.7 + 0.5 * Math.sin(t * 0.41 + 2.2))
    fire.wind.set(Math.cos(ang) * str, Math.sin(ang) * str)
  })
  return null
}

/* Orbiting is a drag, not a click — track how far the pointer travelled so a
   camera spin doesn't also drop a log on the ground. */
const clickTrack = { x: 0, y: 0, moved: false }
if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', (e) => {
    clickTrack.x = e.clientX
    clickTrack.y = e.clientY
    clickTrack.moved = false
  })
  window.addEventListener('pointermove', (e) => {
    if (Math.hypot(e.clientX - clickTrack.x, e.clientY - clickTrack.y) > 6) clickTrack.moved = true
  })
}

/* ============================== ground + world ============================= */
function Ground({ onPlace }) {
  const { map, normalMap } = useMemo(() => groundTextures(), [])
  return (
    <RigidBody type="fixed" colliders={false} friction={1}>
      <CuboidCollider args={[40, 0.5, 40]} position={[0, -0.5, 0]} />
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow
        name="ground"
        onClick={(e) => {
          if (clickTrack.moved) return
          const r = Math.hypot(e.point.x, e.point.z)
          if (r > 6) return
          e.stopPropagation()
          onPlace(e.point)
        }}
      >
        <circleGeometry args={[60, 64]} />
        <meshStandardMaterial
          map={map}
          normalMap={normalMap}
          normalScale={[1.1, 1.1]}
          roughness={0.97}
          metalness={0}
          color="#8d7860"
        />
      </mesh>
      {/* scorched ring of ash around the pit */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.004, 0]} raycast={() => null}>
        <ringGeometry args={[WORLD.pitRadius * 0.5, WORLD.pitRadius * 1.9, 48]} />
        <meshStandardMaterial color="#221c18" roughness={1} transparent opacity={0.85} />
      </mesh>
    </RigidBody>
  )
}

function FireRing() {
  const { map, normalMap } = useMemo(() => stoneTextures(), [])
  const stones = useMemo(() => {
    const out = []
    const N = 11
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2 + Math.random() * 0.13
      const r = WORLD.pitRadius * (1.02 + Math.random() * 0.1)
      const s = 0.17 + Math.random() * 0.09
      out.push({
        pos: [Math.cos(a) * r, s * 0.42, Math.sin(a) * r],
        rot: [Math.random() * 0.5 - 0.25, Math.random() * Math.PI * 2, Math.random() * 0.5 - 0.25],
        s,
        seed: i + 1,
      })
    }
    return out
  }, [])
  return (
    <group>
      {stones.map((st, i) => (
        <RigidBody key={i} type="fixed" colliders="hull" position={st.pos} rotation={st.rot}>
          <mesh geometry={stoneGeometry(st.s, st.seed)} castShadow receiveShadow>
            <meshStandardMaterial map={map} normalMap={normalMap} normalScale={[1.4, 1.4]} roughness={0.92} color="#9a958f" />
          </mesh>
        </RigidBody>
      ))}
    </group>
  )
}

/* stones + fallen branches scattered around the clearing, for depth */
function Scatter() {
  const stoneTex = useMemo(() => stoneTextures(), [])
  const bark = useMemo(() => barkTextures(), [])
  const items = useMemo(() => {
    const rocks = []
    const sticks = []
    for (let i = 0; i < 30; i++) {
      const a = Math.random() * Math.PI * 2
      const r = 1.5 + Math.random() * 8
      const s = 0.07 + Math.random() * 0.22
      rocks.push({ p: [Math.cos(a) * r, s * 0.3, Math.sin(a) * r], s, seed: 100 + i, ry: Math.random() * 3 })
    }
    for (let i = 0; i < 16; i++) {
      const a = Math.random() * Math.PI * 2
      const r = 1.6 + Math.random() * 6
      sticks.push({
        p: [Math.cos(a) * r, 0.05, Math.sin(a) * r],
        ry: Math.random() * Math.PI,
        len: 0.5 + Math.random() * 0.9,
        rad: 0.035 + Math.random() * 0.03,
        seed: 200 + i,
      })
    }
    return { rocks, sticks }
  }, [])
  return (
    <group>
      {items.rocks.map((r, i) => (
        <mesh key={i} geometry={stoneGeometry(r.s, r.seed)} position={r.p} rotation={[0, r.ry, 0]} castShadow receiveShadow>
          <meshStandardMaterial map={stoneTex.map} normalMap={stoneTex.normalMap} roughness={0.95} color="#8b8781" />
        </mesh>
      ))}
      {/* a couple of felled trunks to sit on — gives the fire a sense of scale */}
      {[
        { p: [1.85, 0.17, 0.5], ry: -0.35 },
        { p: [-1.2, 0.17, -1.6], ry: 1.15 },
      ].map((b, i) => (
        <mesh
          key={`bench${i}`}
          geometry={logGeometry(2.1, 0.17, 900 + i)}
          position={b.p}
          rotation={[0, b.ry, 0]}
          castShadow
          receiveShadow
        >
          <meshStandardMaterial map={bark.map} normalMap={bark.normalMap} roughness={0.95} color="#6b5843" />
        </mesh>
      ))}
      {items.sticks.map((s, i) => (
        <mesh
          key={i}
          geometry={logGeometry(s.len, s.rad, s.seed)}
          position={s.p}
          rotation={[0, s.ry, 0]}
          castShadow
          receiveShadow
        >
          <meshStandardMaterial map={bark.map} normalMap={bark.normalMap} roughness={0.95} color="#7a6650" />
        </mesh>
      ))}
    </group>
  )
}

function Forest() {
  const trunks = useRef()
  const canopy = useRef()
  const count = 70
  const data = useMemo(() => {
    const out = []
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + Math.random() * 0.6
      const r = 13 + Math.random() * 24
      const h = 4.5 + Math.random() * 7
      out.push({ x: Math.cos(a) * r, z: Math.sin(a) * r, h, w: 1.0 + Math.random() * 0.9, ry: Math.random() * 3 })
    }
    return out
  }, [])
  useEffect(() => {
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const sc = new THREE.Vector3()
    data.forEach((d, i) => {
      q.setFromEuler(new THREE.Euler(0, d.ry, 0))
      m.compose(new THREE.Vector3(d.x, d.h * 0.18, d.z), q, sc.set(d.w * 0.16, d.h * 0.36, d.w * 0.16))
      trunks.current.setMatrixAt(i, m)
      m.compose(new THREE.Vector3(d.x, d.h * 0.55, d.z), q, sc.set(d.w, d.h, d.w))
      canopy.current.setMatrixAt(i, m)
    })
    trunks.current.instanceMatrix.needsUpdate = true
    canopy.current.instanceMatrix.needsUpdate = true
  }, [data])
  return (
    <group>
      <instancedMesh ref={trunks} args={[undefined, undefined, count]} castShadow raycast={() => null}>
        <cylinderGeometry args={[0.7, 1, 1, 6]} />
        <meshStandardMaterial color="#241c15" roughness={1} />
      </instancedMesh>
      <instancedMesh ref={canopy} args={[undefined, undefined, count]} castShadow raycast={() => null}>
        <coneGeometry args={[1, 1, 7]} />
        <meshStandardMaterial color="#131c14" roughness={1} />
      </instancedMesh>
    </group>
  )
}

/* ================================== logs ================================== */
// only one log can be dragged at a time, so one scratch plane is enough
const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
const dragHit = new THREE.Vector3()

let logId = 0
const makeLog = (pos, opts = {}) => ({
  id: ++logId,
  pos,
  rot: opts.rot ?? [Math.random() * 0.4, Math.random() * Math.PI * 2, Math.random() * 0.4],
  len: opts.len ?? 0.62 + Math.random() * 0.45,
  rad: opts.rad ?? 0.075 + Math.random() * 0.045,
  seed: logId * 13 + 1,
})

function Log({ log, onBurnt, onGrab, dragState }) {
  const body = useRef()
  const mesh = useRef()
  const burn = useRef(0)
  const bark = useMemo(() => barkTextures(), [])
  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        map: bark.map,
        normalMap: bark.normalMap,
        normalScale: new THREE.Vector2(1.5, 1.5),
        roughness: 0.94,
        color: new THREE.Color('#6f5a44'),
        emissive: new THREE.Color('#000000'),
      }),
    [bark]
  )
  const geom = useMemo(() => logGeometry(log.len, log.rad, log.seed), [log])
  const tmp = useMemo(() => new THREE.Vector3(), [])

  useFrame((s, dtRaw) => {
    const b = body.current
    if (!b || fire.paused) return
    const dt = Math.min(dtRaw, 0.05)
    const t = b.translation()
    tmp.set(t.x, t.y, t.z)
    const heat = fire.heatAt(tmp)
    if (heat > 0.12) {
      const rate = dt * heat * 0.055
      burn.current = Math.min(1, burn.current + rate)
      // a burning log gives back more than it takes
      fire.fuel = THREE.MathUtils.clamp(fire.fuel + rate * 1.6, 0, 1)
      if (Math.random() < dt * heat * 3) fire.emberBurst += 1
    }
    const bn = burn.current
    if (bn > 0) {
      // chars to black first; the coal glow only shows up once it is well alight
      material.color.setRGB(
        0.44 * (1 - bn * 0.93),
        0.35 * (1 - bn * 0.95),
        0.27 * (1 - bn * 0.96)
      )
      const g0 = Math.max(0, bn - 0.3) / 0.7
      const glow = Math.pow(g0, 1.7) * 0.42 * (0.65 + 0.35 * Math.sin(s.clock.elapsedTime * 2.6 + log.id))
      material.emissive.setRGB(glow, glow * 0.20, glow * 0.03)
      material.emissiveIntensity = 1
      if (mesh.current) {
        const sc = 1 - bn * 0.42
        mesh.current.scale.setScalar(sc)
      }
      if (bn >= 1) {
        fire.emberBurst += 18
        onBurnt(log.id)
      }
    }
  })

  return (
    <RigidBody
      ref={body}
      position={log.pos}
      rotation={log.rot}
      colliders="hull"
      friction={1.1}
      restitution={0.06}
      linearDamping={0.35}
      angularDamping={0.7}
      canSleep
    >
      <mesh
        ref={mesh}
        geometry={geom}
        material={material}
        castShadow
        receiveShadow
        onPointerDown={(e) => {
          e.stopPropagation()
          if (body.current) onGrab(body.current, log.id)
        }}
        onPointerOver={() => { if (!fire.dragging) document.body.style.cursor = 'grab' }}
        onPointerOut={() => { if (!fire.dragging) document.body.style.cursor = 'auto' }}
      />
    </RigidBody>
  )
}

function Logs({ logsRef }) {
  // a loose lean-to: ends poke out of the flame so you can still see wood
  const [logs, setLogs] = useState(() => [
    makeLog([-0.22, 0.12, 0.1], { rot: [0, 0.35, 0], len: 0.95, rad: 0.085 }),
    makeLog([0.2, 0.12, -0.14], { rot: [0, 2.35, 0], len: 0.9, rad: 0.08 }),
    makeLog([0.05, 0.3, 0.24], { rot: [0.22, 1.25, 0.12], len: 0.85, rad: 0.075 }),
    makeLog([-0.1, 0.32, -0.26], { rot: [-0.18, 2.85, 0.15], len: 0.8, rad: 0.07 }),
  ])
  const dragState = useRef(null)
  const onBurnt = useCallback((id) => setLogs((l) => l.filter((x) => x.id !== id)), [])
  const { camera, gl } = useThree()

  const onGrab = useCallback((body, id) => {
    const t = body.translation()
    dragState.current = {
      body,
      id,
      y: Math.max(t.y, 0.42),
      last: new THREE.Vector3(t.x, t.y, t.z),
      vel: new THREE.Vector3(),
      time: performance.now(),
    }
    body.setBodyType(2, true) // KinematicPositionBased
    body.setLinvel({ x: 0, y: 0, z: 0 }, true)
    body.setAngvel({ x: 0, y: 0, z: 0 }, true)
    fire.dragging = true
    if (fire.controls) fire.controls.enabled = false
    document.body.style.cursor = 'grabbing'
  }, [])

  // The drag lives on window rather than on the mesh: r3f pointer capture drops
  // the gesture as soon as the cursor outruns the log it started on.
  useEffect(() => {
    const ndc = new THREE.Vector2()
    const ray = new THREE.Raycaster()

    const onMove = (e) => {
      const d = dragState.current
      if (!d) return
      const r = gl.domElement.getBoundingClientRect()
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
      ray.setFromCamera(ndc, camera)
      dragPlane.constant = -d.y
      if (!ray.ray.intersectPlane(dragPlane, dragHit)) return
      dragHit.x = THREE.MathUtils.clamp(dragHit.x, -12, 12)
      dragHit.z = THREE.MathUtils.clamp(dragHit.z, -12, 12)
      const now = performance.now()
      const dt = Math.max(now - d.time, 8) / 1000
      d.vel.set((dragHit.x - d.last.x) / dt, 0, (dragHit.z - d.last.z) / dt)
      d.last.set(dragHit.x, d.y, dragHit.z)
      d.time = now
      d.body.setNextKinematicTranslation({ x: dragHit.x, y: d.y, z: dragHit.z })
    }

    const onUp = () => {
      const d = dragState.current
      if (!d) return
      dragState.current = null
      fire.dragging = false
      d.body.setBodyType(0, true) // Dynamic
      const c = (v) => THREE.MathUtils.clamp(v, -7, 7)
      d.body.setLinvel({ x: c(d.vel.x * 0.7), y: 0, z: c(d.vel.z * 0.7) }, true)
      d.body.setAngvel({ x: (Math.random() - 0.5) * 4, y: 0, z: (Math.random() - 0.5) * 4 }, true)
      if (fire.controls) fire.controls.enabled = true
      document.body.style.cursor = 'auto'
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [camera, gl])

  // expose an "add log" hook to the UI without dragging React state through props
  useEffect(() => {
    logsRef.current = {
      add(pos) {
        setLogs((l) => [...l.slice(-13), makeLog(pos ?? [(Math.random() - 0.5) * 0.3, 2.2, (Math.random() - 0.5) * 0.3])])
        // fresh fuel makes it flare and throw a shower of sparks
        fire.fuel = Math.min(1, fire.fuel + 0.22)
        fire.emberBurst += 28
        fire.smokePuff = 1
        hiss()
      },
      count: () => logs.length,
    }
  }, [logsRef, logs.length])

  return (
    <group>
      {logs.map((l) => (
        <Log key={l.id} log={l} onBurnt={onBurnt} onGrab={onGrab} dragState={dragState} />
      ))}
    </group>
  )
}

/* ============================ poke / blow target ========================== */
function FireTarget() {
  return (
    <mesh
      position={[0, 0.75, 0]}
      visible={false}
      onPointerOver={() => { if (!fire.dragging) document.body.style.cursor = 'pointer' }}
      onPointerOut={() => { if (!fire.dragging) document.body.style.cursor = 'auto' }}
      onClick={(e) => {
        e.stopPropagation()
        fire.emberBurst += 45
        fire.gust = Math.min(1, fire.gust + 0.55)
        fire.smokePuff = 1
        crackle(1)
      }}
    >
      <cylinderGeometry args={[0.55, 0.7, 1.6, 12]} />
      <meshBasicMaterial />
    </mesh>
  )
}

/* ============================== marshmallow =============================== */
function Marshmallow({ active, onToast }) {
  const group = useRef()
  const mallowMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#f6efdf', roughness: 0.72, emissive: '#000000' }),
    []
  )
  const bark = useMemo(() => barkTextures(), [])
  const toast = useRef(0)
  const onFire = useRef(false)
  const target = useMemo(() => new THREE.Vector3(1.3, 0.8, 0), [])
  const { camera, pointer } = useThree()
  const plane = useMemo(() => new THREE.Plane(), [])
  const ray = useMemo(() => new THREE.Raycaster(), [])
  const hit = useMemo(() => new THREE.Vector3(), [])
  const camDir = useMemo(() => new THREE.Vector3(), [])

  useFrame((s, dtRaw) => {
    if (!active || !group.current) return
    const dt = Math.min(dtRaw, 0.05)
    // vertical plane facing the camera through the fire: up/down = height, left/right = distance
    camera.getWorldDirection(camDir)
    camDir.y = 0
    camDir.normalize()
    plane.setFromNormalAndCoplanarPoint(camDir, new THREE.Vector3(0, 0.7, 0))
    ray.setFromCamera(pointer, camera)
    if (ray.ray.intersectPlane(plane, hit)) {
      hit.y = THREE.MathUtils.clamp(hit.y, 0.18, 2.4)
      target.lerp(hit, 1 - Math.pow(0.0005, dt))
    }
    group.current.position.copy(target)
    group.current.lookAt(camera.position.x, target.y, camera.position.z)

    const heat = fire.heatAt(target)
    if (!fire.paused) {
      if (onFire.current) {
        toast.current = Math.min(1.6, toast.current + dt * 0.55)
        fire.emberBurst += Math.random() < dt * 12 ? 1 : 0
        if (toast.current >= 1.55) onFire.current = false
      } else {
        toast.current = Math.min(1.6, toast.current + heat * dt * 0.09)
        if (toast.current > 1.02 && heat > 0.45 && Math.random() < dt * 2.2) {
          onFire.current = true
          hiss()
        }
      }
    }
    const b = toast.current
    // cream -> golden -> mahogany -> carbon
    const c = mallowMat.color
    if (b < 0.55) c.setRGB(0.96 - b * 0.25, 0.94 - b * 0.35, 0.87 - b * 0.5)
    else if (b < 1.0) {
      const k = (b - 0.55) / 0.45
      c.setRGB(0.82 - k * 0.5, 0.75 - k * 0.55, 0.59 - k * 0.5)
    } else {
      const k = Math.min(1, (b - 1.0) / 0.5)
      c.setRGB(0.32 * (1 - k) + 0.04, 0.2 * (1 - k) + 0.03, 0.09 * (1 - k) + 0.03)
    }
    const glow = onFire.current ? 0.6 + 0.4 * Math.sin(s.clock.elapsedTime * 22) : heat * 0.12
    mallowMat.emissive.setRGB(glow, glow * 0.3, glow * 0.05)
    onToast(b, onFire.current)
  })

  if (!active) return null
  return (
    <group ref={group} raycast={() => null}>
      <mesh geometry={logGeometry(1.5, 0.018, 77)} position={[-0.78, 0, 0]} castShadow>
        <meshStandardMaterial map={bark.map} color="#6a5540" roughness={0.95} />
      </mesh>
      <mesh position={[0.05, 0, 0]} castShadow material={mallowMat}>
        <capsuleGeometry args={[0.048, 0.06, 6, 16]} />
      </mesh>
    </group>
  )
}

/* ================================== scene ================================= */
export default function Scene({ logsRef, mallowActive, onToast, quality }) {
  const { scene } = useThree()
  const controls = useRef()
  useEffect(() => {
    scene.fog = new THREE.FogExp2('#070a12', 0.021)
    return () => { scene.fog = null }
  }, [scene])
  useEffect(() => { fire.controls = controls.current })

  return (
    <>
      <color attach="background" args={['#05070d']} />
      <hemisphereLight intensity={0.30} color="#3f5580" groundColor="#0f0d0a" />
      {/* moonlight: enough to read the clearing without killing the night */}
      <directionalLight position={[-9, 12, -7]} intensity={0.55} color="#93aade" castShadow={false} />
      <Stars radius={90} depth={60} count={4500} factor={3.2} saturation={0} fade speed={0.4} />

      <FireSim />
      <Fire quality={quality} />
      <FireTarget />
      <Marshmallow active={mallowActive} onToast={onToast} />

      <Physics gravity={[0, -9.81, 0]} timeStep="vary">
        <Ground onPlace={(p) => logsRef.current?.add([p.x, 1.7, p.z])} />
        <FireRing />
        <Logs logsRef={logsRef} />
      </Physics>

      <Scatter />
      <Forest />

      <OrbitControls
        ref={controls}
        makeDefault
        enablePan={false}
        enableDamping
        dampingFactor={0.06}
        minDistance={1.6}
        maxDistance={16}
        minPolarAngle={0.15}
        maxPolarAngle={Math.PI / 2 - 0.06}
        target={[0, 0.45, 0]}
      />
    </>
  )
}
