import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { EffectComposer, Bloom, Vignette, ToneMapping, SMAA } from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'
import * as THREE from 'three'
import Scene from './Scene'
import { fire } from './state'
import { audioOn, setLevel, whoosh, crackle } from './audio'

/* Pushes sim values into the DOM directly — a fuel bar does not need React. */
function HudSync({ fuelRef, flameRef }) {
  useFrame(() => {
    if (fuelRef.current) fuelRef.current.style.width = `${Math.round(fire.fuel * 100)}%`
    if (flameRef.current) flameRef.current.style.setProperty('--i', fire.intensity.toFixed(3))
    setLevel(fire.intensity)
  })
  return null
}

const TOAST_LABEL = (b, burning) => {
  if (burning) return ['ON FIRE — blow it out!', 'burning']
  if (b < 0.22) return ['Raw', '']
  if (b < 0.5) return ['Warming up', '']
  if (b < 0.6) return ['Nearly there', '']
  if (b < 0.92) return ['Golden — perfect', 'perfect']
  if (b < 1.08) return ['Very toasty', '']
  return ['Charcoal. Bold choice.', 'burnt']
}

export default function App() {
  const logsRef = useRef(null)
  const fuelRef = useRef(null)
  const flameRef = useRef(null)
  const [mallow, setMallow] = useState(false)
  const [toast, setToast] = useState([0, false])
  const [sound, setSound] = useState(false)
  const [quality, setQuality] = useState(1)
  const [wind, setWind] = useState(0.12)
  const [windDir, setWindDir] = useState(0.7)
  const [hint, setHint] = useState(true)
  const [paused, setPaused] = useState(false)
  const blowing = useRef(false)

  useEffect(() => { fire.windStrength = wind }, [wind])
  useEffect(() => { fire.windAngle = windDir }, [windDir])
  useEffect(() => { fire.paused = paused }, [paused])

  const onToast = useCallback((b, burning) => {
    setToast((prev) => (Math.abs(prev[0] - b) > 0.02 || prev[1] !== burning ? [b, burning] : prev))
  }, [])

  const startBlow = useCallback(() => {
    if (blowing.current) return
    blowing.current = true
    whoosh(1.1)
    const step = () => {
      if (!blowing.current) return
      fire.gust = Math.min(1, fire.gust + 0.13)
      fire.emberBurst += 3
      fire.fuel = Math.min(1, fire.fuel + 0.004) // air feeds the coals
      requestAnimationFrame(step)
    }
    step()
  }, [])
  const stopBlow = useCallback(() => { blowing.current = false }, [])

  const addLog = useCallback(() => logsRef.current?.add(), [])
  const poke = useCallback(() => {
    fire.emberBurst += 55
    fire.gust = Math.min(1, fire.gust + 0.5)
    fire.smokePuff = 1
    crackle(1)
  }, [])

  useEffect(() => {
    const down = (e) => {
      if (e.repeat) return
      const k = e.key.toLowerCase()
      if (k === ' ' || k === 'b') { e.preventDefault(); startBlow(); setHint(false) }
      else if (k === 'l') { addLog(); setHint(false) }
      else if (k === 'm') { setMallow((v) => !v); setHint(false) }
      else if (k === 'p') setPaused((v) => !v)
      else if (k === 'k') poke()
    }
    const up = (e) => { if (e.key === ' ' || e.key.toLowerCase() === 'b') stopBlow() }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', stopBlow)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', stopBlow)
    }
  }, [startBlow, stopBlow, addLog, poke])

  useEffect(() => { audioOn(sound); fire.sound = sound }, [sound])
  useEffect(() => { fire.quality = quality }, [quality])

  const [toastVal, burning] = toast
  const [toastText, toastClass] = TOAST_LABEL(toastVal, burning)

  return (
    <div className="app" ref={flameRef}>
      <Canvas
        shadows
        dpr={[1, quality === 2 ? 2 : 1.5]}
        gl={{ antialias: false, powerPreference: 'high-performance', stencil: false }}
        camera={{ position: [2.05, 1.15, 2.45], fov: 46, near: 0.05, far: 200 }}
        // tone mapping happens once, in the composer, after bloom — leaving the
        // renderer linear is what lets the flame roll off instead of clipping white
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.NoToneMapping
        }}
      >
        <Suspense fallback={null}>
          <Scene logsRef={logsRef} mallowActive={mallow} onToast={onToast} quality={quality} />
          <HudSync fuelRef={fuelRef} flameRef={flameRef} />
          <EffectComposer disableNormalPass multisampling={0}>
            <Bloom
              mipmapBlur
              intensity={0.85}
              luminanceThreshold={0.5}
              luminanceSmoothing={0.28}
              radius={0.72}
            />
            <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
            <Vignette offset={0.28} darkness={0.85} />
            {quality > 0 && <SMAA />}
          </EffectComposer>
        </Suspense>
      </Canvas>

      <header className="hud top">
        <h1>Campfire</h1>
        <p>drag to orbit · scroll to zoom</p>
      </header>

      <div className="hud fuel">
        <span className="label">Fuel</span>
        <div className="bar"><i ref={fuelRef} /></div>
        <span className="sub">logs burn down — feed it</span>
      </div>

      {mallow && (
        <div className={`hud toast ${toastClass}`}>
          <div className="toastbar">
            <i style={{ width: `${Math.min(100, toastVal * 62)}%` }} />
            <span className="perfect" />
          </div>
          <strong>{toastText}</strong>
          <em>move the mouse to hold it over the flame</em>
        </div>
      )}

      <div className="hud controls">
        <button onClick={addLog} title="L">🪵 Add log</button>
        <button
          onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); startBlow() }}
          onPointerUp={stopBlow}
          onPointerCancel={stopBlow}
          title="hold Space"
        >
          💨 Blow
        </button>
        <button onClick={poke} title="K">🔥 Poke</button>
        <button className={mallow ? 'on' : ''} onClick={() => setMallow((v) => !v)} title="M">
          🍡 Marshmallow
        </button>
        <button className={sound ? 'on' : ''} onClick={() => setSound((v) => !v)}>
          {sound ? '🔊' : '🔇'} Sound
        </button>
      </div>

      <div className="hud settings">
        <label>
          <span>Wind {Math.round(wind * 100)}%</span>
          <input type="range" min="0" max="0.65" step="0.01" value={wind} onChange={(e) => setWind(+e.target.value)} />
        </label>
        <label>
          <span>Direction</span>
          <input type="range" min="0" max="6.28" step="0.01" value={windDir} onChange={(e) => setWindDir(+e.target.value)} />
        </label>
        <label className="row">
          <span>Quality</span>
          <select value={quality} onChange={(e) => setQuality(+e.target.value)}>
            <option value={0}>Low</option>
            <option value={1}>Medium</option>
            <option value={2}>High</option>
          </select>
        </label>
        <button className="ghost" onClick={() => setPaused((v) => !v)}>{paused ? '▶ Resume' : '⏸ Pause'}</button>
      </div>

      {hint && (
        <div className="hud hintcard" onClick={() => setHint(false)}>
          <b>Grab a log and throw it on the fire.</b>
          <span>Drag logs · click the flames to poke · hold <kbd>Space</kbd> to blow · <kbd>M</kbd> for a marshmallow</span>
          <button>got it</button>
        </div>
      )}
    </div>
  )
}
