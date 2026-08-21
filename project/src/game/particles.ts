/** 轻量粒子系统（渲染端纯视觉，不进逻辑判定；纯函数可 sim）。
 *  尾焰/爆炸/命中特效的粒子发射与逐帧运动；render.ts 持池按 wall-clock dt step + 绘制。 */
export interface Particle {
  x: number // 世界坐标（格）
  y: number
  vx: number // 速度（格/秒）
  vy: number
  life: number // 剩余寿命（秒）
  maxLife: number
  size: number // 基础尺寸（格）
  color: string
  drag: number // 减速系数（v *= max(0, 1 - drag*dt)）
  grow: number // 尺寸变化率（>0 膨胀 <0 收缩；step 积分 size *= max(0.2, 1+grow·dt)）
  growUntil?: number // v2.21 膨胀截止年龄占比 0–1：年龄/寿命超过该值后尺寸冻结（仅 alpha 随寿命渐隐）——「扩散后逐渐消失」；缺省=全程膨胀/收缩
  colorEnd?: string // 颜色渐变：寿命内 color→colorEnd（缺省 = 仅亮度渐隐）
  fadeIn?: number // 淡入时长（秒，默认 0）
  flicker?: number // alpha 高频抖动幅度（pulse 模板，0.2）
  turb?: number // 湍流强度（烟尘漂移抖动；step 叠加正交噪声速度）
  phase?: number // 噪声相位（seeded，逐粒不同）
  streak?: boolean // v2.15 电焊式拖尾：绘制时沿速度反向拉 0.05s 亮线（散发飞溅粒子）
}

export const PARTICLE_CAP = 400 // 固定上限：超出回收最老粒子

export interface ParticlePool { parts: Particle[] }

export function createPool(): ParticlePool { return { parts: [] } }

/** 渐变量化色 key（着色缓存用）：color→colorEnd 按寿命进度 k(0→1) lerp 后量化到 8 档 hex（确定性） */
export function gradientColorKey(c1: string, c2: string, k: number): string {
  const p = (h: string): [number, number, number] => {
    const n = parseInt(h.replace('#', ''), 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  }
  const t = Math.round(Math.min(1, Math.max(0, k)) * 7) / 7 // 8 档量化
  const a = p(c1)
  const b = p(c2)
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * t))
  return `#${c.map(v => v.toString(16).padStart(2, '0')).join('')}`
}

/** 喷口 glow 亮度闪烁（确定性，有界 0.85–1.15）：高频 sin + 位置相位 */
export function glowFlicker(t: number, phase: number): number {
  return 1 + 0.15 * Math.sin(t * 30 + phase)
}

/** 稳定伪随机（与 render 同款 hash，seeded 发射形态可复现） */
function hash01(n: number): number {
  const x = Math.sin(n * 127.1) * 43758.5453
  return x - Math.floor(x)
}

function push(pool: ParticlePool, p: Particle) {
  if (pool.parts.length >= PARTICLE_CAP) pool.parts.shift() // 最老先出
  pool.parts.push(p)
}

export interface BurstOpts {
  x: number
  y: number
  count: number
  speed: number // 基础初速（格/秒）
  life: number // 基础寿命（秒）
  size: number
  color: string
  drag: number
  seed: number // 事件 id（角度/抖动 seeded 稳定）
  grow?: number
  streak?: boolean // v2.54：爆发粒子拉丝（沿速度反向拉 0.05s 亮线，复用 v2.15 电焊拖尾画法）
  speedJitter?: number // 初速随机幅度 0–1（每粒 ×(1±jitter)，默认 0.5）
  lifeJitter?: number // 寿命随机幅度 0–1（默认 0.4）
  turb?: number // 湍流强度（烟尘用，默认 0）
  dirX?: number // 命中方向单位向量（bias>0 时角度向其收束）
  dirY?: number
  bias?: number // 方向偏置 0–1：0=全周均匀，1=完全沿命中方向锥形爆发
  inheritVx?: number // 速度继承分量（调用方算好：弹速×inherit）
  inheritVy?: number
}

/** 爆发发射（爆炸火花/烟尘、命中碎屑）：方向向外全周随机；速度/寿命 jitter 均 seeded 确定性 */
export function spawnBurst(pool: ParticlePool, o: BurstOpts) {
  const sj = o.speedJitter ?? 0.5
  const lj = o.lifeJitter ?? 0.4
  const bias = Math.min(1, Math.max(0, o.bias ?? 0))
  const hasDir = bias > 0 && o.dirX !== undefined && o.dirY !== undefined
  const dirAng = hasDir ? Math.atan2(o.dirY!, o.dirX!) : 0
  for (let i = 0; i < o.count; i++) {
    const randAng = hash01(o.seed * 31 + i * 7) * Math.PI * 2
    const ang = hasDir ? dirAng + (randAng - dirAng) * (1 - bias) : randAng // bias 越大越向命中方向收束
    const spd = o.speed * (1 + (hash01(o.seed * 13 + i) * 2 - 1) * sj)
    const life = o.life * (1 + (hash01(o.seed * 7 + i * 3) * 2 - 1) * lj)
    push(pool, {
      x: o.x, y: o.y,
      vx: Math.cos(ang) * spd + (o.inheritVx ?? 0), // 速度继承：沿弹道方向甩出
      vy: Math.sin(ang) * spd + (o.inheritVy ?? 0),
      life, maxLife: life,
      size: o.size, color: o.color, drag: o.drag, grow: o.grow ?? 0,
      streak: o.streak, // v2.54 透传
      turb: o.turb ?? 0, phase: hash01(o.seed * 5 + i * 11) * Math.PI * 2,
    })
  }
}

export interface TrailSpawnOpts {
  vx: number // 粒子初速（弹速×inherit + 反向余速 + 散开）
  vy: number
  life: number
  size: number
  color: string
  drag: number
  grow?: number
  growUntil?: number // v2.21 膨胀截止年龄占比（见 Particle.growUntil）
  colorEnd?: string
  fadeIn?: number
  flicker?: number
  streak?: boolean // v2.15 电焊式拖尾（散发飞溅）
}

/** 尾焰单粒发射 */
export function spawnTrail(pool: ParticlePool, x: number, y: number, o: TrailSpawnOpts) {
  push(pool, {
    x, y, vx: o.vx, vy: o.vy, life: o.life, maxLife: o.life, size: o.size, color: o.color,
    drag: o.drag, grow: o.grow ?? 0, growUntil: o.growUntil, colorEnd: o.colorEnd, fadeIn: o.fadeIn, flicker: o.flicker, streak: o.streak,
  })
}

/** 冲击环相位（纯函数）：第 i 层进度 = k×ringSpeed - i/rings（>0 才画、绘制时截断到 1）；rings=1/ringSpeed=1 即单环 */
export function ringProgress(k: number, ringSpeed: number, i: number, rings: number): number {
  return k * ringSpeed - i / rings
}

/** 逐帧运动：位置积分 + drag 减速 + 寿命衰减 + 过期回收 */
export function stepParticles(pool: ParticlePool, dt: number) {
  const parts = pool.parts
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i]
    p.x += p.vx * dt
    p.y += p.vy * dt
    const f = Math.max(0, 1 - p.drag * dt)
    p.vx *= f
    p.vy *= f
    // 尺寸变化积分（膨胀/收缩）；v2.21 growUntil：年龄占比超过阈值后冻结尺寸（此后仅 alpha 渐隐）
    if (p.grow !== 0 && (p.growUntil === undefined || (p.maxLife - p.life) / p.maxLife < p.growUntil)) p.size = Math.max(0.01, p.size * (1 + p.grow * dt))
    if (p.turb && p.turb > 0) { // 湍流：正交噪声漂移（频率/相位逐粒不同，有界 ±turb·2 格/s²）
      const age = p.maxLife - p.life
      p.vx += Math.sin(age * 8 + (p.phase ?? 0)) * p.turb * dt * 2
      p.vy += Math.cos(age * 6.3 + (p.phase ?? 0) * 1.7) * p.turb * dt * 2
    }
    p.life -= dt
    if (p.life <= 0) parts.splice(i, 1)
  }
}
