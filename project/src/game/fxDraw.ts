/** v2.55 特效画法共用层：战场渲染（render.ts）与编辑器预览（DebugPanel/ammoFxPreview）共用同一套画法，
 *  杜绝平行实现漂移（v2.54 爆炸升级漏同步预览的事故根源）。
 *  职责划分：画法一律走本模块；驱动层各自保留（战场 = 游戏状态事件 + fxSeen 首见；预览 = fxTick 状态机）。
 *  坐标约定：X/Y 为世界格 → 画布像素的换算函数（战场含视口变换；预览为 ×cell 恒等变换）。 */
import { gradientColorKey, type Particle, type ParticlePool } from './particles'
import { srcImage } from './art'
import { LEVEL } from './level'
import { ringProgress } from './particles'

// ---- fx 贴图着色缓存（远行星号式软粒子/喷口 glow）：预着色离屏 canvas，按颜色 key 复用 ----
const tintCache = new Map<string, HTMLCanvasElement>()

/** 染色版贴图：填色 + destination-in 乘原图 alpha（particlealpha32 白 RGB/glow32 黑 RGB 均适用）；无 DOM 回退 null */
export function tintedFx(img: HTMLImageElement, colorKey: string): HTMLCanvasElement | null {
  const key = `${img.src}|${colorKey}`
  const hit = tintCache.get(key)
  if (hit) return hit
  if (typeof document === 'undefined') return null
  const cv = document.createElement('canvas')
  cv.width = img.width
  cv.height = img.height
  const c = cv.getContext('2d')
  if (!c) return null
  c.fillStyle = colorKey
  c.fillRect(0, 0, cv.width, cv.height)
  c.globalCompositeOperation = 'destination-in' // 保留原图 alpha 遮罩
  c.drawImage(img, 0, 0)
  tintCache.set(key, cv)
  return cv
}

export function hexRgb(c: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{6})$/i.exec(c)
  if (!m) return null
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** #RRGGBB + alpha → rgba() 字符串（非法 hex 回退白色） */
export function hexA(hex: string, a: number): string {
  const rgb = hexRgb(hex) ?? [255, 255, 255]
  return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`
}

/** #RRGGBB + alpha → rgba()（非 hex 原样返回，alpha 由调用方处理） */
export function fadeColor(c: string, a: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(c)
  if (!m) return c
  const n = parseInt(m[1], 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}

/** 粒子颜色：color→colorEnd 寿命线性插值（hex lerp）；任一非 hex 回退原色 + globalAlpha 亮度渐隐 */
function particleColor(pt: Particle, k: number, a: number): { fill: string; alpha: number } {
  const c1 = hexRgb(pt.color)
  const c2 = pt.colorEnd ? hexRgb(pt.colorEnd) : null
  if (c1 && c2) {
    const t = 1 - k
    const c = c1.map((v, i) => Math.round(v + (c2[i] - v) * t))
    return { fill: `rgba(${c[0]},${c[1]},${c[2]},${a})`, alpha: 1 }
  }
  return { fill: pt.color, alpha: a }
}

/** 粒子池绘制（战场地面层/空中层 + 编辑器预览共用）——贴图化软粒子：particlealpha32 预着色缓存；
 *  烟尘（grow>0）走 smoke32 且不加光；未加载/无 DOM 回退 arc；streak 拉丝 0.09s/0.8r（v2.54）；离屏跳过 */
export function drawParticlePool(ctx: CanvasRenderingContext2D, pool: ParticlePool, X: (x: number) => number, Y: (y: number) => number, cell: number, nowFx: number) {
  const fxP = srcImage('/res/fx/particlealpha32.png')
  const fxSmoke = srcImage('/res/fx/smoke32.png') // v2.6：烟尘粒子专用贴图（grow>0）
  const fxPImg = fxP.status === 'ready' ? fxP.img : undefined
  const fxSmokeImg = fxSmoke.status === 'ready' ? fxSmoke.img : undefined
  for (const pt of pool.parts) {
    if (pt.x < -1 || pt.x > LEVEL.cols + 1 || pt.y < -1 || pt.y > LEVEL.rows + 1) continue
    const k = Math.max(0, pt.life / pt.maxLife) // 1 → 0
    let a = k * (pt.grow > 0 ? 0.5 : 0.9)
    if (pt.fadeIn && pt.fadeIn > 0) a *= Math.min(1, (pt.maxLife - pt.life) / pt.fadeIn) // 淡入段 alpha 缓入
    if (pt.flicker) a *= 1 - pt.flicker + pt.flicker * Math.sin(nowFx * 30 + pt.x * 13) // 高频闪烁（pulse）
    if (a <= 0.01) continue
    const r = Math.max(0.5, pt.size * cell) // 尺寸已由 stepParticles 积分 grow
    ctx.globalCompositeOperation = pt.grow > 0 ? 'source-over' : 'lighter' // 烟尘不加光
    if (pt.streak) { // v2.15 电焊式拖尾（v2.54 加长 0.09s、加粗 0.8r）；速度反向亮线（加法发光，颜色随渐变）
      const sk = pt.colorEnd ? gradientColorKey(pt.color, pt.colorEnd, 1 - k) : pt.color
      ctx.globalAlpha = a
      ctx.strokeStyle = sk
      ctx.lineWidth = Math.max(1.5, r * 0.8)
      ctx.beginPath()
      ctx.moveTo(X(pt.x - pt.vx * 0.09), Y(pt.y - pt.vy * 0.09))
      ctx.lineTo(X(pt.x), Y(pt.y))
      ctx.stroke()
    }
    const fxTex = pt.grow > 0 ? fxSmokeImg : fxPImg // v2.6：烟尘走 smoke32，其余走 particlealpha32
    if (fxTex) { // 贴图绘制：软圆/烟团（远行星号式柔和粒子），渐变量化 8 档查着色缓存
      const key = pt.colorEnd ? gradientColorKey(pt.color, pt.colorEnd, 1 - k) : pt.color.toLowerCase()
      const tint = hexRgb(key) ? tintedFx(fxTex, key) : null
      if (tint) {
        ctx.globalAlpha = a
        ctx.drawImage(tint, X(pt.x) - r, Y(pt.y) - r, r * 2, r * 2) // 贴图 = size×2（软边溢出自然）
        continue
      }
    }
    const pc = particleColor(pt, k, a) // 回退 arc 圆点
    ctx.globalAlpha = pc.alpha
    ctx.fillStyle = pc.fill
    ctx.beginPath()
    ctx.arc(X(pt.x), Y(pt.y), r, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalCompositeOperation = 'source-over'
  ctx.globalAlpha = 1
}

/** v2.54 爆炸矢量层统一画法（战场/预览共用，全层加法发光）：
 *  瞬时照明（flash>0，0.15s 衰减）→ 火球（fireball>0，径向渐变，快膨胀幂衰减）→ 冲击环（shock>0 软边羽化带 / =0 细描边）。
 *  k = 特效进度 0..1；el = 距爆发秒数（照明窗口用）；r = 爆炸半径（格） */
export function drawExplosionLayers(
  ctx: CanvasRenderingContext2D, X: (x: number) => number, Y: (y: number) => number, cell: number,
  ex: { x: number; y: number; r: number }, k: number,
  p: { color: string; rings: number; ringSpeed: number; ringWidth: number; fireball: number; shock: number; flash: number },
  el: number,
) {
  if (k >= 1) return
  const rMax = Math.max(4, ex.r * cell)
  const cx = X(ex.x)
  const cy = Y(ex.y)
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  if (p.flash > 0 && el < 0.15) { // 瞬时照明：大半径低透明光晕（照亮战场的打光层）
    const fa = p.flash * (1 - el / 0.15)
    const fr = rMax * 2.5
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, fr)
    g.addColorStop(0, fadeColor('#FFF6E0', fa * 0.5))
    g.addColorStop(0.4, fadeColor(p.color, fa * 0.25))
    g.addColorStop(1, fadeColor(p.color, 0))
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(cx, cy, fr, 0, Math.PI * 2)
    ctx.fill()
  }
  if (p.fireball > 0) { // 火球：白核→特效色→透明
    const fbK = Math.min(1, k * 2.2)
    const fbR = rMax * p.fireball * (0.35 + 0.65 * fbK)
    const fbA = Math.pow(1 - k, 1.4)
    if (fbR > 0.5 && fbA > 0.01) {
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, fbR)
      g.addColorStop(0, fadeColor('#FFFFFF', fbA * 0.95))
      g.addColorStop(0.35, fadeColor(p.color, fbA * 0.8))
      g.addColorStop(1, fadeColor(p.color, 0))
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(cx, cy, fbR, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  for (let i = 0; i < p.rings; i++) { // 多层冲击环：相位错开（进度 = k×ringSpeed - i/rings）
    const rp = ringProgress(k, p.ringSpeed, i, p.rings)
    if (rp <= 0) continue
    const rp1 = Math.min(1, rp)
    const rk = rMax * (0.3 + 0.7 * rp1)
    const alpha = (1 - rp1) * 0.55
    if (alpha <= 0 || rk <= 0.5) continue
    if (p.shock > 0) { // 软边：径向渐变环带（lineWidth 覆盖羽化带）
      const band = Math.max(1.5, p.ringWidth * 2.5 * p.shock)
      const g = ctx.createRadialGradient(cx, cy, Math.max(0, rk - band), cx, cy, rk + band)
      g.addColorStop(0, fadeColor(p.color, 0))
      g.addColorStop(0.5, fadeColor(p.color, alpha))
      g.addColorStop(1, fadeColor(p.color, 0))
      ctx.strokeStyle = g
      ctx.lineWidth = band * 2
    } else {
      ctx.strokeStyle = fadeColor(p.color, alpha)
      ctx.lineWidth = p.ringWidth
    }
    ctx.beginPath()
    ctx.arc(cx, cy, rk, 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.restore()
}

/** 命中中心亮点一闪（战场/预览共用）：白点收缩渐隐。k = 特效进度 0..1 */
export function drawImpactFlash(ctx: CanvasRenderingContext2D, X: (x: number) => number, Y: (y: number) => number, x: number, y: number, k: number) {
  ctx.fillStyle = fadeColor('#FFFFFF', (1 - k) * 0.9)
  ctx.beginPath()
  ctx.arc(X(x), Y(y), Math.max(0.5, 2.5 * (1 - k)), 0, Math.PI * 2)
  ctx.fill()
}
