// 基准：测量交战中 tick() / computePathField() 的开销（node 跑，定位卡顿源）
import { initialState, startWave, tick, computePathField } from '../src/game/engine'
const TICK = 0.1

let s = initialState()
s = startWave(s, 0)

// 推进到交战中期（较多敌人在场），并让堡垒持续移动（模拟 v1.54 高速机动）
s.moveDir = { x: 1, y: 0 }
s.moveMag = 1
s.desiredHeading = Math.PI / 2

// 先跑 30s 让敌人积累
for (let i = 0; i < 300; i++) s = tick(s, TICK)
console.log(`enemies=${s.enemies.length} projectiles=${s.projectiles.length} turrets=${s.turrets.length} phase=${s.phase} pathVersion=${s.pathVersion}`)

// 1) tick 总耗时
const N = 200
let t0 = performance.now()
for (let i = 0; i < N; i++) s = tick(s, TICK)
const tickMs = (performance.now() - t0) / N
console.log(`tick avg = ${tickMs.toFixed(3)} ms`)

// 2) computePathField 单独耗时
t0 = performance.now()
for (let i = 0; i < N; i++) computePathField(s)
console.log(`computePathField avg = ${(performance.now() - t0) / N} ms`)
console.log(`enemies=${s.enemies.length} pathVersion=${s.pathVersion}`)
