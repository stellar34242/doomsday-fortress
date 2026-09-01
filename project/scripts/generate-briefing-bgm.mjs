import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const sampleRate = 32_000
const bpm = 80
const beat = 60 / bpm
const bars = 16
const barLength = beat * 4
const duration = bars * barLength
const frames = Math.round(sampleRate * duration)
const outPath = resolve(dirname(fileURLToPath(import.meta.url)), '../public/res/audio/briefing_eve_loop.wav')
const left = new Float32Array(frames)
const right = new Float32Array(frames)
const TAU = Math.PI * 2

let seed = 0x51f15e
const random = () => {
  seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0
  return seed / 0x1_0000_0000
}
const midi = note => 440 * 2 ** ((note - 69) / 12)
const smooth = value => value * value * (3 - 2 * value)

function addTone(start, length, note, gain, pan, voice, attack = 0.02, release = 0.12) {
  const startFrame = Math.max(0, Math.round(start * sampleRate))
  const endFrame = Math.min(frames, Math.round((start + length) * sampleRate))
  const frequency = midi(note)
  const leftGain = Math.sqrt((1 - pan) * 0.5) * gain
  const rightGain = Math.sqrt((1 + pan) * 0.5) * gain
  const phase = random() * TAU
  for (let frame = startFrame; frame < endFrame; frame++) {
    const age = frame / sampleRate - start
    const remaining = start + length - frame / sampleRate
    const env = smooth(Math.min(1, age / attack)) * smooth(Math.min(1, remaining / release))
    const x = TAU * frequency * age + phase
    let sample
    if (voice === 'strings') {
      sample = (Math.sin(x) + 0.34 * Math.sin(x * 2 + 0.3) + 0.16 * Math.sin(x * 3 + 0.8) + 0.07 * Math.sin(x * 4 + 1.4)) * 0.64
    } else if (voice === 'pulse') {
      sample = (Math.sin(x) + 0.24 * Math.sin(x * 2) + 0.10 * Math.sin(x * 4)) * Math.exp(-age * 3.2)
    } else if (voice === 'brass') {
      sample = Math.tanh((Math.sin(x) + 0.38 * Math.sin(x * 2) + 0.22 * Math.sin(x * 3)) * 1.3) * 0.72
    } else {
      sample = Math.sin(x) + 0.18 * Math.sin(x * 2 + 0.2)
    }
    left[frame] += sample * env * leftGain
    right[frame] += sample * env * rightGain
  }
}

function addTaiko(start, gain, pan = 0) {
  const startFrame = Math.round(start * sampleRate)
  const endFrame = Math.min(frames, startFrame + Math.round(0.7 * sampleRate))
  for (let frame = startFrame; frame < endFrame; frame++) {
    const age = (frame - startFrame) / sampleRate
    const phase = TAU * (62 * age - 19 * age * age)
    const hit = (Math.sin(phase) + 0.34 * Math.sin(phase * 0.51)) * Math.exp(-age * 7.2) * gain
    left[frame] += hit * Math.sqrt((1 - pan) * 0.5)
    right[frame] += hit * Math.sqrt((1 + pan) * 0.5)
  }
}

function addMetal(start, gain, pan) {
  const startFrame = Math.round(start * sampleRate)
  const endFrame = Math.min(frames, startFrame + Math.round(0.18 * sampleRate))
  const phases = [random() * TAU, random() * TAU, random() * TAU]
  for (let frame = startFrame; frame < endFrame; frame++) {
    const age = (frame - startFrame) / sampleRate
    const sample = (Math.sin(TAU * 1320 * age + phases[0]) + 0.55 * Math.sin(TAU * 1877 * age + phases[1]) + 0.3 * Math.sin(TAU * 2411 * age + phases[2])) * Math.exp(-age * 25) * gain
    left[frame] += sample * Math.sqrt((1 - pan) * 0.5)
    right[frame] += sample * Math.sqrt((1 + pan) * 0.5)
  }
}

// Dm – Bb – F – C: four passes form a complete cinematic preparation cue.
const harmony = [
  { pad: [50, 53, 57, 62], bass: 38, pulse: [62, 69, 65, 69, 62, 69, 74, 69] },
  { pad: [46, 50, 53, 58], bass: 34, pulse: [58, 65, 62, 65, 58, 65, 70, 65] },
  { pad: [48, 53, 57, 60], bass: 41, pulse: [60, 65, 69, 65, 60, 65, 72, 65] },
  { pad: [48, 52, 55, 60], bass: 36, pulse: [60, 67, 64, 67, 60, 67, 72, 67] },
]

for (let bar = 0; bar < bars; bar++) {
  const chord = harmony[bar % 4]
  const start = bar * barLength
  const intensity = bar < 4 ? 0.72 : bar < 12 ? 0.9 : 1
  chord.pad.forEach((note, index) => {
    addTone(start, barLength, note, 0.055 * intensity, [-0.6, -0.2, 0.25, 0.62][index], 'strings', 0.34, 0.42)
    addTone(start, barLength, note + 12, 0.018 * intensity, [0.48, 0.15, -0.18, -0.5][index], 'strings', 0.45, 0.5)
  })
  addTone(start, beat * 1.85, chord.bass, 0.13 * intensity, -0.08, 'brass', 0.08, 0.34)
  addTone(start + beat * 2, beat * 1.75, chord.bass, 0.105 * intensity, 0.08, 'brass', 0.06, 0.28)
  chord.pulse.forEach((note, step) => addTone(start + step * beat / 2, beat * 0.43, note, 0.038 * intensity, step % 2 === 0 ? -0.28 : 0.28, 'pulse', 0.008, 0.09))
  addTaiko(start, 0.21 * intensity, -0.12)
  addTaiko(start + beat * 2.5, 0.135 * intensity, 0.15)
  addMetal(start + beat * 1.5, 0.018 * intensity, bar % 2 === 0 ? -0.55 : 0.55)
  addMetal(start + beat * 3.5, 0.014 * intensity, bar % 2 === 0 ? 0.5 : -0.5)
}

// The theme enters after the four-bar intro, builds, then resolves before looping.
const melody = [
  [4, 0, 1.5, 74], [4, 1.5, .5, 77], [4, 2, 1, 81], [4, 3, 1, 79],
  [5, 0, 1, 70], [5, 1, 1, 74], [5, 2, 1.5, 77], [5, 3.5, .5, 76],
  [6, 0, 1.5, 77], [6, 1.5, .5, 81], [6, 2, 1, 84], [6, 3, 1, 81],
  [7, 0, 1, 79], [7, 1, 1, 76], [7, 2, 2, 74],
  [8, 0, 1, 69], [8, 1, 1, 74], [8, 2, 1, 77], [8, 3, 1, 81],
  [9, 0, 1.5, 82], [9, 1.5, .5, 81], [9, 2, 1, 77], [9, 3, 1, 74],
  [10, 0, 1, 72], [10, 1, 1, 77], [10, 2, 1, 81], [10, 3, 1, 84],
  [11, 0, 1, 83], [11, 1, 1, 79], [11, 2, 2, 76],
  [12, 0, 1, 74], [12, 1, 1, 77], [12, 2, 2, 81],
  [13, 0, 1, 82], [13, 1, 1, 81], [13, 2, 1, 77], [13, 3, 1, 74],
  [14, 0, 1, 77], [14, 1, 1, 81], [14, 2, 1, 84], [14, 3, 1, 81],
  [15, 0, 1, 79], [15, 1, 1, 76], [15, 2, 1.5, 74], [15, 3.5, .5, 69],
]
for (const [bar, offset, length, note] of melody) {
  addTone(bar * barLength + offset * beat, length * beat, note, bar >= 12 ? 0.075 : 0.064, 0.08, 'lead', 0.045, 0.16)
  addTone(bar * barLength + offset * beat, length * beat, note - 12, bar >= 12 ? 0.022 : 0.016, -0.18, 'strings', 0.08, 0.2)
}

// Circular reflections add depth without breaking the loop boundary.
const dryLeft = left.slice()
const dryRight = right.slice()
for (const [delaySeconds, gain, cross] of [[0.19, 0.11, 0.18], [0.37, 0.065, 0.32], [0.61, 0.035, 0.42]]) {
  const delay = Math.round(delaySeconds * sampleRate)
  for (let frame = 0; frame < frames; frame++) {
    const source = (frame - delay + frames) % frames
    left[frame] += (dryLeft[source] * (1 - cross) + dryRight[source] * cross) * gain
    right[frame] += (dryRight[source] * (1 - cross) + dryLeft[source] * cross) * gain
  }
}

let peak = 0
for (let frame = 0; frame < frames; frame++) peak = Math.max(peak, Math.abs(left[frame]), Math.abs(right[frame]))
const master = 0.82 / Math.max(0.82, peak)
const dataBytes = frames * 4
const wav = Buffer.alloc(44 + dataBytes)
wav.write('RIFF', 0); wav.writeUInt32LE(36 + dataBytes, 4); wav.write('WAVE', 8); wav.write('fmt ', 12)
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22); wav.writeUInt32LE(sampleRate, 24)
wav.writeUInt32LE(sampleRate * 4, 28); wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(dataBytes, 40)
for (let frame = 0; frame < frames; frame++) {
  wav.writeInt16LE(Math.round(Math.max(-1, Math.min(1, left[frame] * master)) * 32767), 44 + frame * 4)
  wav.writeInt16LE(Math.round(Math.max(-1, Math.min(1, right[frame] * master)) * 32767), 46 + frame * 4)
}
mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, wav)
console.log(`Generated ${outPath}`)
console.log(`${duration.toFixed(1)} s, ${bpm} BPM, D minor, stereo ${sampleRate} Hz, peak -1.7 dBFS, ${(wav.length / 1024 / 1024).toFixed(2)} MiB`)
