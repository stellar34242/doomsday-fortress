import { targetingAllowsTarget, type LegacyAITargeting, type UnitTargetKind } from './schema'
import type { GameState } from '../engine'

export interface SiegeTarget {
  kind: Extract<UnitTargetKind, 'coreBuilding' | 'fixedBuilding' | 'wall'>
  id: number
  x: number
  y: number
  distance: number
}

export function pointRectDistance(px: number, py: number, x: number, y: number, w: number, h: number): number {
  return Math.hypot(Math.max(0, x - px, px - (x + w)), Math.max(0, y - py, py - (y + h)))
}

/** 攻城索敌严格限制在配置目标内，绝不回退到移动堡垒或战斗单位。 */
export function selectSiegeTarget(
  state: GameState,
  x: number,
  y: number,
  targeting: LegacyAITargeting,
  visible?: (x: number, y: number) => boolean,
): SiegeTarget | null {
  let best: SiegeTarget | null = null
  const consider = (candidate: SiegeTarget) => {
    if (visible && !visible(candidate.x, candidate.y)) return
    if (!best || candidate.distance < best.distance) best = candidate
  }
  if (targetingAllowsTarget(targeting, 'coreBuilding') && state.core && state.core.hp > 0) {
    const core = state.core
    consider({
      kind: 'coreBuilding', id: core.id, x: core.x + core.w / 2, y: core.y + core.h / 2,
      distance: pointRectDistance(x, y, core.x, core.y, core.w, core.h),
    })
  }
  if (targetingAllowsTarget(targeting, 'fixedBuilding')) {
    for (const building of state.buildings) {
      if (building.hp <= 0) continue
      consider({
        kind: 'fixedBuilding', id: building.id, x: building.x + building.w / 2, y: building.y + building.h / 2,
        distance: pointRectDistance(x, y, building.x, building.y, building.w, building.h),
      })
    }
  }
  if (targetingAllowsTarget(targeting, 'wall')) {
    for (const wall of state.walls) {
      if (wall.state === 'destroyed' || wall.hp <= 0) continue
      for (const cell of wall.cells) {
        consider({ kind: 'wall', id: wall.id, x: cell.x + 0.5, y: cell.y + 0.5, distance: pointRectDistance(x, y, cell.x, cell.y, 1, 1) })
      }
    }
  }
  return best
}
