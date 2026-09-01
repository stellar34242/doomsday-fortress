import type { ExplosionFx } from './engine'

export interface Crater {
  x: number
  y: number
  r: number
  born: number
  seed: number
}

export const CRATER_CAP = 120
export const CRATER_LIFE = 45
export const CRATER_FADE = 15

/** 爆炸半径映射为视觉坑径；非爆炸落地坑直径 = 弹丸贴图/几何显示直径。 */
export function craterRadius(ex: Pick<ExplosionFx, 'r' | 'kind' | 'projectileSize'>, visualProjectileSize?: number): number {
  if (ex.kind === 'groundImpact') return Math.max(0.005, (visualProjectileSize ?? ex.projectileSize ?? 0.4) / 2)
  return Math.max(0.24, Math.min(2.8, ex.r * 0.75))
}

/** 寿命前 30 秒恒定，最后 15 秒线性渐隐。 */
export function craterOpacity(age: number): number {
  return Math.max(0, Math.min(1, (CRATER_LIFE - age) / CRATER_FADE))
}

/** 渲染层逐帧调用：事件首见落坑、过期清理、FIFO 容量限制。 */
export function updateCraters(
  craters: Crater[],
  seen: Set<number>,
  explosions: readonly ExplosionFx[],
  now: number,
  projectileVisualSize?: (ex: ExplosionFx) => number | undefined,
): void {
  for (let i = craters.length - 1; i >= 0; i--) {
    if (now - craters[i].born > CRATER_LIFE) craters.splice(i, 1)
  }

  const live = new Set<number>()
  for (const ex of explosions) {
    live.add(ex.id)
    if (seen.has(ex.id)) continue
    seen.add(ex.id)
    if (ex.leavesCrater === false) continue
    craters.push({ x: ex.x, y: ex.y, r: craterRadius(ex, projectileVisualSize?.(ex)), born: now, seed: ex.id })
  }
  for (const id of [...seen]) if (!live.has(id)) seen.delete(id)

  if (craters.length > CRATER_CAP) craters.splice(0, craters.length - CRATER_CAP)
}
