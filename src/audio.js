/* Synthesised campfire — no audio files. Brown-noise roar + random crackles.
   ponytail: WebAudio primitives beat shipping megabytes of samples. */
let ctx = null
let master = null
let roarGain = null
let noiseBuf = null
let started = false
let crackleTimer = null
let level = 0.6

function noiseBuffer(c) {
  if (noiseBuf) return noiseBuf
  const len = c.sampleRate * 2
  const b = c.createBuffer(1, len, c.sampleRate)
  const d = b.getChannelData(0)
  let last = 0
  for (let i = 0; i < len; i++) {
    const white = Math.random() * 2 - 1
    last = (last + 0.02 * white) / 1.02 // brown-ish noise: heavier low end
    d[i] = last * 3.2
  }
  noiseBuf = b
  return b
}

export function audioOn(on) {
  if (on && !ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)()
    master = ctx.createGain()
    master.gain.value = 0
    master.connect(ctx.destination)

    const src = ctx.createBufferSource()
    src.buffer = noiseBuffer(ctx)
    src.loop = true
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 620
    const hp = ctx.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.value = 60
    roarGain = ctx.createGain()
    roarGain.gain.value = 0.35
    src.connect(hp).connect(lp).connect(roarGain).connect(master)
    src.start()

    // wandering resonance so the roar never sits still
    const lfo = ctx.createOscillator()
    const lfoGain = ctx.createGain()
    lfo.frequency.value = 0.13
    lfoGain.gain.value = 220
    lfo.connect(lfoGain).connect(lp.frequency)
    lfo.start()

    started = true
    scheduleCrackles()
  }
  if (!ctx) return
  ctx.resume?.()
  master.gain.setTargetAtTime(on ? 0.5 : 0, ctx.currentTime, 0.25)
  if (!on && crackleTimer) { clearTimeout(crackleTimer); crackleTimer = null }
  else if (on && !crackleTimer) scheduleCrackles()
}

export function setLevel(v) {
  level = v
  if (roarGain && ctx) roarGain.gain.setTargetAtTime(0.14 + v * 0.42, ctx.currentTime, 0.4)
}

function scheduleCrackles() {
  if (!started) return
  crackleTimer = setTimeout(() => {
    if (Math.random() < 0.55 + level * 0.4) crackle(0.35 + Math.random() * 0.5)
    scheduleCrackles()
  }, 90 + Math.random() * 520 * (1.4 - level))
}

/* short filtered pop — the snap of a resin pocket letting go */
export function crackle(amount = 0.5) {
  if (!ctx || master.gain.value < 0.01) return
  const t = ctx.currentTime
  const src = ctx.createBufferSource()
  src.buffer = noiseBuffer(ctx)
  src.playbackRate.value = 0.8 + Math.random() * 1.6
  const bp = ctx.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.value = 900 + Math.random() * 2600
  bp.Q.value = 1.4 + Math.random() * 5
  const g = ctx.createGain()
  const peak = 0.12 + amount * 0.55
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(peak, t + 0.004)
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05 + Math.random() * 0.14)
  src.connect(bp).connect(g).connect(master)
  src.start(t, Math.random() * 1.5)
  src.stop(t + 0.4)
}

/* wet sizzle — new log, or a marshmallow catching */
export function hiss() {
  if (!ctx || master.gain.value < 0.01) return
  const t = ctx.currentTime
  const src = ctx.createBufferSource()
  src.buffer = noiseBuffer(ctx)
  src.playbackRate.value = 2.4
  const bp = ctx.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.setValueAtTime(2600, t)
  bp.frequency.exponentialRampToValueAtTime(900, t + 0.9)
  bp.Q.value = 0.9
  const g = ctx.createGain()
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(0.3, t + 0.05)
  g.gain.exponentialRampToValueAtTime(0.0001, t + 1.0)
  src.connect(bp).connect(g).connect(master)
  src.start(t)
  src.stop(t + 1.1)
}

/* breath of air across the coals */
export function whoosh(dur = 0.7) {
  if (!ctx || master.gain.value < 0.01) return
  const t = ctx.currentTime
  const src = ctx.createBufferSource()
  src.buffer = noiseBuffer(ctx)
  src.playbackRate.value = 1.6
  const bp = ctx.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.setValueAtTime(400, t)
  bp.frequency.linearRampToValueAtTime(1500, t + dur * 0.6)
  bp.Q.value = 0.7
  const g = ctx.createGain()
  g.gain.setValueAtTime(0.0001, t)
  g.gain.linearRampToValueAtTime(0.35, t + dur * 0.35)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  src.connect(bp).connect(g).connect(master)
  src.start(t)
  src.stop(t + dur + 0.1)
}
