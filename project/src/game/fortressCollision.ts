import { BASE_CELL } from './config'
import type { FortressBodyCollision, FortressBodyCollisionPoint, FortressDef } from './config'

const ALPHA_THRESHOLD = 16

function cross(o: FortressBodyCollisionPoint, a: FortressBodyCollisionPoint, b: FortressBodyCollisionPoint): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
}

/** 单调链凸包；用于把贴图像素边缘压缩成稳定、便于 SAT 的物理轮廓。 */
export function convexHull(points: readonly FortressBodyCollisionPoint[]): FortressBodyCollisionPoint[] {
  const sorted = [...points]
    .filter(point => Number.isFinite(point.x) && Number.isFinite(point.y))
    .sort((a, b) => a.x - b.x || a.y - b.y)
  const unique = sorted.filter((point, index) => index === 0 || point.x !== sorted[index - 1].x || point.y !== sorted[index - 1].y)
  if (unique.length <= 2) return unique
  const lower: FortressBodyCollisionPoint[] = []
  for (const point of unique) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) lower.pop()
    lower.push(point)
  }
  const upper: FortressBodyCollisionPoint[] = []
  for (let index = unique.length - 1; index >= 0; index--) {
    const point = unique[index]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) upper.pop()
    upper.push(point)
  }
  lower.pop()
  upper.pop()
  return [...lower, ...upper]
}

/**
 * 从 RGBA 透明通道生成主体碰撞轮廓。每一像素行只采集左右边缘，再做凸包，
 * 因此结果既跟随主体图像边缘，也不会把数万像素写入载具配置。
 */
export function bodyCollisionFromPixels(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  source: string,
): FortressBodyCollision | undefined {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || data.length < width * height * 4) return undefined
  const boundary: FortressBodyCollisionPoint[] = []
  for (let y = 0; y < height; y++) {
    let left = width
    let right = -1
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] < ALPHA_THRESHOLD) continue
      left = Math.min(left, x)
      right = Math.max(right, x)
    }
    if (right < left) continue
    boundary.push({ x: left, y }, { x: right + 1, y }, { x: left, y: y + 1 }, { x: right + 1, y: y + 1 })
  }
  const hullPx = convexHull(boundary)
  if (hullPx.length < 3) return undefined
  const points = hullPx.map(point => ({
    x: Math.round(((point.x - width / 2) / BASE_CELL) * 10_000) / 10_000,
    y: Math.round(((point.y - height / 2) / BASE_CELL) * 10_000) / 10_000,
  }))
  return { source, widthPx: width, heightPx: height, points }
}

export function pointInConvexPolygon(point: FortressBodyCollisionPoint, polygon: readonly FortressBodyCollisionPoint[]): boolean {
  if (polygon.length < 3) return false
  let sign = 0
  for (let index = 0; index < polygon.length; index++) {
    const a = polygon[index]
    const b = polygon[(index + 1) % polygon.length]
    const value = cross(a, b, point)
    if (Math.abs(value) <= 1e-8) continue
    const current = Math.sign(value)
    if (sign !== 0 && current !== sign) return false
    sign = current
  }
  return true
}

function pointInRect(point: FortressBodyCollisionPoint, x: number, y: number, w: number, h: number): boolean {
  return point.x >= x && point.x <= x + w && point.y >= y && point.y <= y + h
}

function segmentsIntersect(a: FortressBodyCollisionPoint, b: FortressBodyCollisionPoint, c: FortressBodyCollisionPoint, d: FortressBodyCollisionPoint): boolean {
  const epsilon = 1e-8
  const abC = cross(a, b, c)
  const abD = cross(a, b, d)
  const cdA = cross(c, d, a)
  const cdB = cross(c, d, b)
  const onSegment = (p: FortressBodyCollisionPoint, q: FortressBodyCollisionPoint, r: FortressBodyCollisionPoint) => (
    q.x >= Math.min(p.x, r.x) - epsilon && q.x <= Math.max(p.x, r.x) + epsilon
    && q.y >= Math.min(p.y, r.y) - epsilon && q.y <= Math.max(p.y, r.y) + epsilon
  )
  if (Math.abs(abC) <= epsilon && onSegment(a, c, b)) return true
  if (Math.abs(abD) <= epsilon && onSegment(a, d, b)) return true
  if (Math.abs(cdA) <= epsilon && onSegment(c, a, d)) return true
  if (Math.abs(cdB) <= epsilon && onSegment(c, b, d)) return true
  return Math.sign(abC) !== Math.sign(abD) && Math.sign(cdA) !== Math.sign(cdB)
}

/** 凸轮廓与轴对齐矩形相交，用于把连续轮廓映射成寻路/墙体碰撞格。 */
export function convexPolygonIntersectsRect(
  polygon: readonly FortressBodyCollisionPoint[],
  x: number,
  y: number,
  w: number,
  h: number,
): boolean {
  if (polygon.some(point => pointInRect(point, x, y, w, h))) return true
  const corners = [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }]
  if (corners.some(point => pointInConvexPolygon(point, polygon))) return true
  for (let pi = 0; pi < polygon.length; pi++) {
    const a = polygon[pi]
    const b = polygon[(pi + 1) % polygon.length]
    for (let ri = 0; ri < corners.length; ri++) {
      if (segmentsIntersect(a, b, corners[ri], corners[(ri + 1) % corners.length])) return true
    }
  }
  return false
}

/** 主体轮廓映射到旧局部格坐标，供格寻路和旧系统兼容使用。 */
export function bodyCollisionCells(def: Pick<FortressDef, 'w' | 'h' | 'bodyCollision'>): Set<string> {
  const result = new Set<string>()
  const outline = def.bodyCollision?.points
  if (!outline || outline.length < 3) return result
  const local = outline.map(point => ({ x: point.x + def.w / 2, y: point.y + def.h / 2 }))
  for (let y = 0; y < def.h; y++) for (let x = 0; x < def.w; x++) {
    if (convexPolygonIntersectsRect(local, x, y, 1, 1)) result.add(`${x},${y}`)
  }
  return result
}

/** 把中心相对轮廓变换到世界坐标。 */
export function transformBodyCollision(
  points: readonly FortressBodyCollisionPoint[],
  centerX: number,
  centerY: number,
  heading: number,
  scale = 1,
): FortressBodyCollisionPoint[] {
  const cos = Math.cos(heading)
  const sin = Math.sin(heading)
  return points.map(point => ({
    x: centerX + (point.x * cos - point.y * sin) * scale,
    y: centerY + (point.x * sin + point.y * cos) * scale,
  }))
}
