/** v2.55 特效画法共用层：战场渲染（render.ts）与编辑器预览（DebugPanel/ammoFxPreview）共用同一套画法，
 *  杜绝平行实现漂移（v2.54 爆炸升级漏同步预览的事故根源）。
 *  职责划分：画法一律走本模块；驱动层各自保留（战场 = 游戏状态事件 + fxSeen 首见；预览 = fxTick 状态机）。
 *  坐标约定：X/Y 为世界格 → 画布像素的换算函数（战场含视口变换；预览为 ×cell 恒等变换）。 */
import { gradientColorKey, type Particle, type ParticlePool } from './particles'
import { srcImage } from './art'
import { BASE_CELL } from './config'
import { assetImage, findAssetByName } from './assetlib'
import { LEVEL } from './level'
import { ringProgress } from './particles'

// ---- fx 贴图着色缓存（远行星号式软粒子/喷口 glow）：预着色离屏 canvas，按颜色 key 复用 ----
const tintCache = new Map<string, HTMLCanvasElement>()

/** 染色版贴图：填色 + destination-in 乘原图 alpha（particlealpha32 白 RGB/glow32 黑 RGB 均适用）；无 DOM 回退 null */
export function tintedFx(img: HTMLImageElement, colorKey: string, mode: 'mask' | 'multiply' = 'mask'): HTMLCanvasElement | null {
  const key = `${img.src}|${colorKey}|${mode}`
  const hit = tintCache.get(key)
  if (hit) return hit
  if (typeof document === 'undefined') return null
  const cv = document.createElement('canvas')
  cv.width = img.width
  cv.height = img.height
  const c = cv.getContext('2d')
  if (!c) return null
  if (mode === 'multiply') {
    c.drawImage(img, 0, 0)
    c.globalCompositeOperation = 'multiply'
    c.fillStyle = colorKey
    c.fillRect(0, 0, cv.width, cv.height)
    c.globalCompositeOperation = 'destination-in'
    c.drawImage(img, 0, 0)
  } else {
    c.fillStyle = colorKey
    c.fillRect(0, 0, cv.width, cv.height)
    c.globalCompositeOperation = 'destination-in'
    c.drawImage(img, 0, 0)
  }
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

export const WRECKAGE_EFFECT_ASSET_NAME = 'fx_Wreckage'

/** 通用残骸素材固定按 2×2 等分，索引顺序为左上、右上、左下、右下。 */
export function wreckageFrameRect(imgWidth: number, imgHeight: number, frameIndex: number) {
  const sw = Math.max(1, Math.floor(imgWidth / 2))
  const sh = Math.max(1, Math.floor(imgHeight / 2))
  const index = ((Math.floor(frameIndex) % 4) + 4) % 4
  return { sx: index % 2 * sw, sy: Math.floor(index / 2) * sh, sw, sh }
}

/** 粒子池绘制（战场地面层/空中层 + 编辑器预览共用）——贴图化软粒子：particlealpha32 预着色缓存；
 *  烟尘（grow>0）走 smoke32 且不加光；未加载/无 DOM 回退 arc；streak 拉丝 0.09s/0.8r（v2.54）；离屏跳过 */
export function drawParticlePool(ctx: CanvasRenderingContext2D, pool: ParticlePool, X: (x: number) => number, Y: (y: number) => number, cell: number, nowFx: number) {
  const fxP = srcImage('/res/fx/particlealpha32.png')
  const fxSmoke = srcImage('/res/fx/smoke32.png') // v2.6：烟尘粒子专用贴图（grow>0）
  const fxPImg = fxP.status === 'ready' ? fxP.img : undefined
  const fxSmokeImg = fxSmoke.status === 'ready' ? fxSmoke.img : undefined
  const wreckageAsset = findAssetByName(WRECKAGE_EFFECT_ASSET_NAME, 'flash')
  const wreckageEntry = wreckageAsset ? assetImage(wreckageAsset.id) : undefined
  const wreckageImg = wreckageEntry?.status === 'ready' ? wreckageEntry.img : undefined
  for (const pt of pool.parts) {
    if (pt.x < -1 || pt.x > LEVEL.cols + 1 || pt.y < -1 || pt.y > LEVEL.rows + 1) continue
    const k = Math.max(0, pt.life / pt.maxLife) // 1 → 0
    let a = k * (pt.grow > 0 ? 0.5 : 0.9)
    if (pt.fadeIn && pt.fadeIn > 0) a *= Math.min(1, (pt.maxLife - pt.life) / pt.fadeIn) // 淡入段 alpha 缓入
    if (pt.flicker) a *= 1 - pt.flicker + pt.flicker * Math.sin(nowFx * 30 + pt.x * 13) // 高频闪烁（pulse）
    if (a <= 0.01) continue
    const r = Math.max(0.5, pt.size * cell) // 尺寸已由 stepParticles 积分 grow
    ctx.globalCompositeOperation = pt.grow > 0 ? 'source-over' : 'lighter' // 烟尘不加光
    if (pt.shape === 'shieldCrystal') { // 冰晶层：细小、高亮、无描边的锐角薄片
      const pc = particleColor(pt, k, a)
      const variant = Math.floor(((pt.phase ?? 0) / (Math.PI * 2)) * 3) % 3
      ctx.save()
      ctx.translate(X(pt.x), Y(pt.y))
      ctx.rotate(pt.rotation ?? 0)
      ctx.globalCompositeOperation = 'lighter'
      ctx.globalAlpha = pc.alpha * (0.72 + Math.sin(nowFx * 25 + (pt.phase ?? 0)) * 0.16)
      ctx.fillStyle = variant === 0 ? '#F1FFFF' : variant === 1 ? '#C8F7FA' : '#A9EAF0'
      ctx.beginPath()
      if (variant === 0) {
        ctx.moveTo(0, -r); ctx.lineTo(r * 0.22, -r * 0.08); ctx.lineTo(0, r); ctx.lineTo(-r * 0.22, r * 0.08)
      } else if (variant === 1) {
        ctx.moveTo(-r * 0.85, -r * 0.12); ctx.lineTo(r, -r * 0.28); ctx.lineTo(r * 0.42, r * 0.22)
      } else {
        ctx.moveTo(-r * 0.7, -r * 0.28); ctx.lineTo(r * 0.88, 0); ctx.lineTo(-r * 0.55, r * 0.32)
      }
      ctx.closePath(); ctx.fill(); ctx.restore()
      continue
    }
    if (pt.shape === 'shieldShard') { // 主碎片：五类无描边能量薄片；六边形只属于受击波纹
      const pc = particleColor(pt, k, a)
      const variant = Math.floor(((pt.phase ?? 0) / (Math.PI * 2)) * 5) % 5
      const skew = 0.72 + (((pt.phase ?? 0) / (Math.PI * 2)) % 1) * 0.28
      ctx.save()
      ctx.translate(X(pt.x), Y(pt.y))
      ctx.rotate(pt.rotation ?? 0)
      ctx.fillStyle = variant === 0 ? '#B5EEF1' : variant === 3 ? '#5EAEB9' : pc.fill
      ctx.beginPath()
      if (variant === 0) {
        ctx.moveTo(-r * 0.92, -r * 0.28)
        ctx.lineTo(r * 0.86, -r * 0.62 * skew)
        ctx.lineTo(r * 0.18, r * 0.88)
      } else if (variant === 1) {
        ctx.moveTo(-r, -r * 0.18)
        ctx.lineTo(-r * 0.18, -r * 0.72)
        ctx.lineTo(r * 0.94, r * 0.08)
        ctx.lineTo(-r * 0.34, r * 0.68 * skew)
      } else if (variant === 2) {
        ctx.moveTo(-r * 0.88, -r * 0.52 * skew)
        ctx.lineTo(r * 0.72, -r * 0.32)
        ctx.lineTo(r * 0.96, r * 0.26)
        ctx.lineTo(-r * 0.58, r * 0.62)
      } else if (variant === 3) {
        ctx.moveTo(-r, -r * 0.16); ctx.lineTo(r * 0.96, -r * 0.34); ctx.lineTo(r * 0.62, r * 0.24); ctx.lineTo(-r * 0.82, r * 0.3)
      } else {
        ctx.moveTo(-r * 0.66, -r * 0.42); ctx.lineTo(r, -r * 0.08); ctx.lineTo(-r * 0.32, r * 0.74)
      }
      ctx.closePath()
      // 只绘制半透明能量薄片，不画外轮廓线，避免呈现硬质玻璃或六边形瓦片感。
      ctx.globalCompositeOperation = 'lighter'
      const briefCrest = variant === 4 ? Math.max(0, 1 - (1 - k) * 5) * 0.18 : 0
      ctx.globalAlpha = pc.alpha * (0.38 + briefCrest)
      ctx.fill()
      ctx.restore()
      continue
    }
    if (pt.shape === 'debris') { // 单位残骸：不发光的焦黑/锈褐实体碎块，带自转与短暂飞散
      const pc = particleColor(pt, k, a)
      const phaseRatio = ((pt.phase ?? 0) / (Math.PI * 2)) % 1
      const atlasVariant = Math.floor(phaseRatio * 4) % 4
      ctx.save()
      ctx.translate(X(pt.x), Y(pt.y))
      ctx.rotate(pt.rotation ?? 0)
      ctx.globalCompositeOperation = 'source-over'
      ctx.globalAlpha = pc.alpha * 0.92
      if (wreckageImg) {
        const frame = wreckageFrameRect(wreckageImg.width, wreckageImg.height, atlasVariant)
        // 32px 单帧按战场原生比例显示；单位摧毁模板提供固定档位缩放。
        const assetScale = Math.max(0.05, pt.spriteScale ?? 1)
        const drawW = frame.sw * cell / BASE_CELL * assetScale
        const drawH = frame.sh * cell / BASE_CELL * assetScale
        ctx.drawImage(wreckageImg, frame.sx, frame.sy, frame.sw, frame.sh, -drawW / 2, -drawH / 2, drawW, drawH)
        ctx.restore()
        continue
      }
      const variant = Math.floor(phaseRatio * 3) % 3
      ctx.fillStyle = pc.fill
      ctx.strokeStyle = '#171513'
      ctx.lineWidth = Math.max(0.7, r * 0.16)
      ctx.beginPath()
      if (variant === 0) {
        ctx.moveTo(-r, -r * 0.38); ctx.lineTo(r * 0.78, -r * 0.55); ctx.lineTo(r, r * 0.28); ctx.lineTo(-r * 0.65, r * 0.62)
      } else if (variant === 1) {
        ctx.moveTo(-r * 0.72, -r); ctx.lineTo(r * 0.5, -r * 0.54); ctx.lineTo(r * 0.82, r * 0.76); ctx.lineTo(-r * 0.44, r * 0.48)
      } else {
        ctx.moveTo(-r, -r * 0.18); ctx.lineTo(-r * 0.12, -r * 0.74); ctx.lineTo(r, r * 0.12); ctx.lineTo(r * 0.18, r * 0.68)
      }
      ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore()
      continue
    }
    if (pt.streak) { // v2.15 电焊式拖尾（v2.54 加长 0.09s、加粗 0.8r）；速度反向亮线（加法发光，颜色随渐变）
      const sk = pt.colorEnd ? gradientColorKey(pt.color, pt.colorEnd, 1 - k) : pt.color
      const streakTime = pt.streakTime ?? 0.09
      ctx.globalAlpha = a
      ctx.strokeStyle = sk
      ctx.lineWidth = Math.max(1.5, r * 0.8) * (pt.streakWidthScale ?? 1)
      ctx.beginPath()
      ctx.moveTo(X(pt.x - pt.vx * streakTime), Y(pt.y - pt.vy * streakTime))
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
  p: { color: string; rings: number; ringSpeed: number; ringWidth: number; fireball: number; shock: number; flash: number; visualScale?: number },
  el: number,
) {
  if (k >= 1) return
  const rMax = Math.max(4, ex.r * cell * (p.visualScale ?? 1))
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
