import { BASE_CELL } from './config'

export interface FortressBodyAlphaMask {
  width: number
  height: number
  alpha: Uint8Array
}

const masks = new Map<string, FortressBodyAlphaMask>()

/** 纯数据注册入口，供浏览器贴图加载与无头回归共用。 */
export function registerFortressBodyAlpha(ref: string, width: number, height: number, alpha: Uint8Array): void {
  if (!ref || width <= 0 || height <= 0 || alpha.length < width * height) return
  masks.set(ref, { width, height, alpha })
}

/** 从已加载主体图片读取 alpha；同一引用/尺寸只读取一次。 */
export function registerFortressBodyImage(ref: string, img: HTMLImageElement): void {
  if (!ref || typeof document === 'undefined') return
  const old = masks.get(ref)
  if (old && old.width === img.naturalWidth && old.height === img.naturalHeight) return
  try {
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return
    ctx.drawImage(img, 0, 0)
    const rgba = ctx.getImageData(0, 0, canvas.width, canvas.height).data
    const alpha = new Uint8Array(canvas.width * canvas.height)
    for (let i = 0; i < alpha.length; i++) alpha[i] = rgba[i * 4 + 3]
    registerFortressBodyAlpha(ref, canvas.width, canvas.height, alpha)
  } catch {
    // 跨域/不可读图片回退到中央主体矩形；不让素材读取失败阻断战斗。
  }
}

export function clearFortressBodyAlpha(ref?: string): void {
  if (ref) masks.delete(ref)
  else masks.clear()
}

function fallbackEntry(w: number, h: number, x1: number, y1: number, x2: number, y2: number): number | null {
  // 未加载 alpha 时采用中央主体范围；两侧各留约 0.8 格让履带/轮子先被弹丸越过。
  const minX = w * 0.16, maxX = w * 0.84
  const minY = h * 0.02, maxY = h * 0.98
  const dx = x2 - x1, dy = y2 - y1
  let t0 = 0, t1 = 1
  const slab = (p: number, d: number, lo: number, hi: number): boolean => {
    if (Math.abs(d) < 1e-9) return p >= lo && p <= hi
    let a = (lo - p) / d, b = (hi - p) / d
    if (a > b) [a, b] = [b, a]
    t0 = Math.max(t0, a); t1 = Math.min(t1, b)
    return t0 <= t1
  }
  return slab(x1, dx, minX, maxX) && slab(y1, dy, minY, maxY) && t1 >= 0 && t0 <= 1
    ? Math.max(0, Math.min(1, t0)) : null
}

/**
 * 主体局部格线段与贴图 alpha 的首次交点 t（0..1）。贴图按现行规则原尺寸居中：30px=1格。
 * alpha 未就绪时回退中央主体矩形，绝不使用包含履带/轮胎的堡垒外接框。
 */
export function fortressBodyMaskSegmentEntry(
  ref: string | undefined, bodyW: number, bodyH: number,
  x1: number, y1: number, x2: number, y2: number,
): number | null {
  if (!ref) return fallbackEntry(bodyW, bodyH, x1, y1, x2, y2)
  const mask = masks.get(ref)
  if (!mask) return fallbackEntry(bodyW, bodyH, x1, y1, x2, y2)
  const toPxX = (x: number) => (x - bodyW / 2) * BASE_CELL + mask.width / 2
  const toPxY = (y: number) => (y - bodyH / 2) * BASE_CELL + mask.height / 2
  const ax = toPxX(x1), ay = toPxY(y1), bx = toPxX(x2), by = toPxY(y2)
  const dx = bx - ax, dy = by - ay
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) * 2))
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const px = Math.floor(ax + dx * t), py = Math.floor(ay + dy * t)
    if (px < 0 || px >= mask.width || py < 0 || py >= mask.height) continue
    if (mask.alpha[py * mask.width + px] > 16) return t
  }
  return null
}
