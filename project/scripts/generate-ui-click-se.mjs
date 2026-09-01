import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const sampleRate = 44_100
const duration = 0.18
const frames = Math.round(sampleRate * duration)
const left = new Float32Array(frames)
const right = new Float32Array(frames)
const TAU = Math.PI * 2
let seed = 0x00c11c
let previousNoise = 0

const noise = () => {
  seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0
  const current = seed / 0x8000_0000 - 1
  const highPassed = current - previousNoise * 0.82
  previousNoise = current
  return highPassed
}

for (let frame = 0; frame < frames; frame++) {
  const t = frame / sampleRate
  const press = Math.exp(-t * 48)
  const bodyPhase = TAU * (245 * t - 170 * t * t)
  const body = Math.sin(bodyPhase) * press * 0.52
  const snap = noise() * Math.exp(-t * 105) * 0.28
  const metal = (Math.sin(TAU * 1_860 * t) + 0.42 * Math.sin(TAU * 2_790 * t + 0.4)) * Math.exp(-t * 72) * 0.12

  const returnAge = t - 0.058
  const returnEnv = returnAge >= 0 ? Math.exp(-returnAge * 62) : 0
  const rebound = returnAge >= 0
    ? (Math.sin(TAU * 610 * returnAge) * 0.18 + noise() * 0.06) * returnEnv
    : 0

  const tailFade = Math.min(1, Math.max(0, (duration - t) / 0.018))
  left[frame] = (body + snap + metal + rebound) * tailFade
  right[frame] = (body * 0.96 + snap * 0.82 + metal * 1.08 + rebound * 1.04) * tailFade
}

let peak = 0
for (let frame = 0; frame < frames; frame++) peak = Math.max(peak, Math.abs(left[frame]), Math.abs(right[frame]))
const master = 0.78 / peak
const dataBytes = frames * 4
const wav = Buffer.alloc(44 + dataBytes)
wav.write('RIFF', 0); wav.writeUInt32LE(36 + dataBytes, 4); wav.write('WAVE', 8); wav.write('fmt ', 12)
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22); wav.writeUInt32LE(sampleRate, 24)
wav.writeUInt32LE(sampleRate * 4, 28); wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(dataBytes, 40)
for (let frame = 0; frame < frames; frame++) {
  wav.writeInt16LE(Math.round(left[frame] * master * 32767), 44 + frame * 4)
  wav.writeInt16LE(Math.round(right[frame] * master * 32767), 46 + frame * 4)
}

const outPath = resolve(dirname(fileURLToPath(import.meta.url)), '../public/res/audio/ui_button_click.wav')
mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, wav)
console.log(`Generated ${outPath}`)
console.log(`${duration.toFixed(2)} s, stereo ${sampleRate} Hz, ${(wav.length / 1024).toFixed(1)} KiB`)
