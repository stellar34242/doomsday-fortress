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

/** 爆炸半径映射为视觉坑径；落地实弹使用固定小坑，堡垒主爆自然得到最大坑。 */
export function craterRadius(ex: Pick<ExplosionFx, 'r' | 'kind'>): number {
  if (ex.kind === 'groundImpact') return 0.2
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
): void {
  for (let i = craters.length - 1; i >= 0; i--) {
    if (now - craters[i].born > CRATER_LIFE) craters.splice(i, 1)
  }

  const live = new Set<number>()
  for (const ex of explosions) {
    live.add(ex.id)
    if (seen.has(ex.id)) continue
    seen.add(ex.id)
    craters.push({ x: ex.x, y: ex.y, r: craterRadius(ex), born: now, seed: ex.id })
  }
  for (const id of [...seen]) if (!live.has(id)) seen.delete(id)

  if (craters.length > CRATER_CAP) craters.splice(0, craters.length - CRATER_CAP)
}
