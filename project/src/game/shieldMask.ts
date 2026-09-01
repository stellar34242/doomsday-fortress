export interface ShieldMaskPoint { x: number; y: number }

export interface ShieldMaskContour {
  points: ShieldMaskPoint[]
  perimeter: number
}

/** 将二值 Alpha 遮罩向外扩张，形成与载具外观保持小间距的贴身护盾。 */
export function dilateShieldMask(source: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  const out = new Uint8Array(Math.max(0, width * height))
  if (width <= 0 || height <= 0 || source.length < width * height) return out
  const r = Math.max(0, Math.round(radius))
  if (r === 0) {
    for (let i = 0; i < out.length; i++) out[i] = source[i] > 0 ? 1 : 0
    return out
  }
  const offsets: { x: number; y: number }[] = []
  for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) {
    if (x * x + y * y <= r * r) offsets.push({ x, y })
  }
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (source[y * width + x] === 0) continue
    for (const offset of offsets) {
      const px = x + offset.x, py = y + offset.y
      if (px >= 0 && px < width && py >= 0 && py < height) out[py * width + px] = 1
    }
  }
  return out
}

function contourArea(points: ShieldMaskPoint[]): number {
  let area = 0
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length]
    area += a.x * b.y - b.x * a.y
  }
  return area / 2
}

function contourPerimeter(points: ShieldMaskPoint[]): number {
  let length = 0
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length]
    length += Math.hypot(b.x - a.x, b.y - a.y)
  }
  return length
}

interface Edge { sx: number; sy: number; ex: number; ey: number }

/**
 * 从二值遮罩提取所有外轮廓。透明孔洞会被填入护盾，断开的履带/轮胎则各自保留外轮廓。
 * offsetX/offsetY 将遮罩像素坐标转换为以载具几何中心为原点的局部坐标。
 */
export function traceShieldMaskContours(
  mask: Uint8Array, width: number, height: number, offsetX = 0, offsetY = 0, minArea = 4,
): ShieldMaskContour[] {
  if (width <= 0 || height <= 0 || mask.length < width * height) return []
  const inside = (x: number, y: number) => x >= 0 && x < width && y >= 0 && y < height && mask[y * width + x] > 0
  const edges: Edge[] = []
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (!inside(x, y)) continue
    if (!inside(x, y - 1)) edges.push({ sx: x, sy: y, ex: x + 1, ey: y })
    if (!inside(x + 1, y)) edges.push({ sx: x + 1, sy: y, ex: x + 1, ey: y + 1 })
    if (!inside(x, y + 1)) edges.push({ sx: x + 1, sy: y + 1, ex: x, ey: y + 1 })
    if (!inside(x - 1, y)) edges.push({ sx: x, sy: y + 1, ex: x, ey: y })
  }
  const byStart = new Map<string, number[]>()
  for (let i = 0; i < edges.length; i++) {
    const edge = edges[i]
    const key = `${edge.sx},${edge.sy}`
    const bucket = byStart.get(key)
    if (bucket) bucket.push(i)
    else byStart.set(key, [i])
  }
  const used = new Uint8Array(edges.length)
  const contours: ShieldMaskContour[] = []
  for (let seed = 0; seed < edges.length; seed++) {
    if (used[seed]) continue
    const first = edges[seed]
    const points: ShieldMaskPoint[] = [{ x: first.sx + offsetX, y: first.sy + offsetY }]
    used[seed] = 1
    let ex = first.ex, ey = first.ey
    let guard = 0
    while ((ex !== first.sx || ey !== first.sy) && guard++ <= edges.length) {
      points.push({ x: ex + offsetX, y: ey + offsetY })
      const candidates = byStart.get(`${ex},${ey}`) ?? []
      const nextIndex = candidates.find(index => !used[index])
      if (nextIndex === undefined) break
      used[nextIndex] = 1
      ex = edges[nextIndex].ex
      ey = edges[nextIndex].ey
    }
    if (ex !== first.sx || ey !== first.sy || points.length < 4) continue
    const area = contourArea(points)
    // 屏幕坐标 y 向下，按上述有向边生成的外轮廓面积为正，透明孔洞为负。
    if (area < minArea) continue
    contours.push({ points, perimeter: contourPerimeter(points) })
  }
  return contours.sort((a, b) => b.perimeter - a.perimeter)
}

/** 按近似等距重新采样轮廓，避免逐像素描边造成过高绘制开销。 */
export function resampleShieldContour(contour: ShieldMaskContour, spacing: number): ShieldMaskPoint[] {
  const points = contour.points
  if (points.length < 2 || contour.perimeter <= 0) return [...points]
  const count = Math.max(4, Math.ceil(contour.perimeter / Math.max(1, spacing)))
  const step = contour.perimeter / count
  const out: ShieldMaskPoint[] = []
  let edgeIndex = 0
  let edgeStartDistance = 0
  let a = points[0], b = points[1]
  let edgeLength = Math.hypot(b.x - a.x, b.y - a.y)
  for (let i = 0; i < count; i++) {
    const target = i * step
    while (edgeIndex < points.length - 1 && target > edgeStartDistance + edgeLength) {
      edgeStartDistance += edgeLength
      edgeIndex++
      a = points[edgeIndex]
      b = points[(edgeIndex + 1) % points.length]
      edgeLength = Math.hypot(b.x - a.x, b.y - a.y)
    }
    const local = edgeLength > 0 ? Math.max(0, Math.min(1, (target - edgeStartDistance) / edgeLength)) : 0
    out.push({ x: a.x + (b.x - a.x) * local, y: a.y + (b.y - a.y) * local })
  }
  return out
}

/** 在贴身轮廓内部生成交错采样点，供破盾碎片均匀覆盖整个载具。 */
export function sampleShieldMaskInterior(
  mask: Uint8Array, width: number, height: number, offsetX: number, offsetY: number, spacing: number,
): ShieldMaskPoint[] {
  if (width <= 0 || height <= 0 || mask.length < width * height || !(spacing > 0)) return []
  const stepY = spacing * Math.sqrt(3) / 2
  const rows = Math.max(1, Math.ceil(height / stepY))
  const cols = Math.max(1, Math.ceil(width / spacing))
  const out: ShieldMaskPoint[] = []
  for (let row = 0; row <= rows; row++) {
    const py = Math.min(height - 1, Math.floor(row * stepY))
    const stagger = row % 2 ? spacing / 2 : 0
    for (let col = -1; col <= cols; col++) {
      const px = Math.floor(col * spacing + stagger)
      if (px < 0 || px >= width || mask[py * width + px] === 0) continue
      out.push({ x: offsetX + px + 0.5, y: offsetY + py + 0.5 })
    }
  }
  return out
}
