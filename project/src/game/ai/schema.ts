/** 运行时仍会使用的实体分类；单位战斗 AI 只主动选择 fortress / combatUnit。 */
export type UnitTargetKind =
  | 'fortress'
  | 'coreBuilding'
  | 'fixedBuilding'
  | 'wall'
  | 'turret'
  | 'combatUnit'
  | 'object'

/** 首选目标是排序偏好，不会绕过敌对关系、视野、空地能力或武器合法性。 */
export type AIPreferredTarget = 'playerControlled' | 'playerFaction' | 'allHostile'
/** 站位只从当前目标可用武器的有效射程自动推导，不保存手填距离。 */
export type AIPositioningProfile = 'longestRange' | 'optimalRange' | 'shortestRange'
/** 单位进入战斗后的平移方式；车体转向与炮塔瞄准仍由各自系统处理。 */
export type AIMovementProfile = 'orbit' | 'keepFar' | 'closeIn' | 'stop' | 'ram'
/** 攻击形式属于战斗参数，不属于三段式单位 AI；此类型保留在同一协议文件便于共享。 */
export type AIAttackProfile = 'none' | 'melee' | 'projectile' | 'hitscan' | 'kamikaze' | 'scripted'
export type AISpecialProfile = 'none' | 'deployForces'
export type UnitDeployDirection = 'front' | 'rear' | 'left' | 'right'

export type UnitAISpecial =
  | { profile: 'none' }
  | {
    /** 抵达目标几何外沿后，从运输单位指定方向生成所选单位。 */
    profile: 'deployForces'
    unitDefId: string
    count: number
    interval: number
    direction: UnitDeployDirection
  }

/** 战斗单位唯一的模板 AI：打谁、站多远、怎么移动。 */
export interface UnitAI {
  preferredTarget: AIPreferredTarget
  positioning: AIPositioningProfile
  movement: AIMovementProfile
  /** 投送等单位能力继续随单位保存，但不参与三段式目标/站位/移动仲裁。 */
  special?: UnitAISpecial
}

export const DEFAULT_UNIT_AI: Readonly<UnitAI> = {
  preferredTarget: 'allHostile',
  positioning: 'optimalRange',
  movement: 'stop',
  special: { profile: 'none' },
}

/** 旧静态目标分类只保留存档、低层伤害与未来敌方要塞兼容，不在新版 AI 编辑器中显示。 */
export const SIEGE_TARGETS: readonly UnitTargetKind[] = ['coreBuilding', 'fixedBuilding', 'wall']

/** 仅供旧存档和迁移测试读取；新版运行时与编辑器不得再按该类型分支。 */
export type AITargetingProfile = 'fortress' | 'closestHostile' | 'siege' | 'antiVehicle' | 'scripted' | 'none'
export interface LegacyAITargeting { profile: AITargetingProfile; allowedTargets?: UnitTargetKind[] }
export function targetingAllowsTarget(targeting: LegacyAITargeting, target: UnitTargetKind): boolean {
  if (targeting.profile === 'none' || targeting.profile === 'scripted') return false
  if (targeting.profile === 'fortress') return target === 'fortress'
  if (targeting.profile === 'siege') return (targeting.allowedTargets ?? SIEGE_TARGETS).includes(target)
  return target === 'fortress' || target === 'combatUnit'
}

export interface AIWeaponRange {
  min: number
  max: number
}

export interface AIStandingRange {
  min: number
  max: number
  desired: number
  /** 最优射程用于说明当前最多有多少件武器可同时覆盖。 */
  overlap: number
}

export type AIRangeDecision = 'approach' | 'hold' | 'retreat' | 'orbit' | 'ram'
export type AIRamAvailability = 'available' | 'ineligible' | 'unreachable'

const validRange = (range: AIWeaponRange): AIWeaponRange | null => {
  const min = Math.max(0, Number(range.min))
  const max = Math.max(0, Number(range.max))
  return Number.isFinite(min) && Number.isFinite(max) && max > min ? { min, max } : null
}

/**
 * 从可攻击当前目标的武器区间推导单位站位（输入输出使用同一距离单位）。
 * 最远/最近的 ±10% 按参考射程的百分点计算：85% => 75%~95%，50% => 40%~60%。
 */
export function computeAIStandingRange(ranges: readonly AIWeaponRange[], profile: AIPositioningProfile): AIStandingRange {
  const usable = ranges.map(validRange).filter((range): range is AIWeaponRange => range !== null)
  if (usable.length === 0) return { min: 0, max: 0, desired: 0, overlap: 0 }

  if (profile === 'longestRange') {
    const reference = [...usable].sort((a, b) => b.max - a.max || a.min - b.min)[0]
    const min = Math.min(reference.max, Math.max(reference.min, reference.max * 0.75))
    const max = Math.min(reference.max, Math.max(min, reference.max * 0.95))
    return { min, max, desired: Math.min(max, Math.max(min, reference.max * 0.85)), overlap: 1 }
  }

  if (profile === 'shortestRange') {
    const reference = [...usable].sort((a, b) => a.max - b.max || a.min - b.min)[0]
    const min = Math.min(reference.max, Math.max(reference.min, reference.max * 0.4))
    const max = Math.min(reference.max, Math.max(min, reference.max * 0.6))
    return { min, max, desired: Math.min(max, Math.max(min, reference.max * 0.5)), overlap: 1 }
  }

  const points = [...new Set(usable.flatMap(range => [range.min, range.max]))].sort((a, b) => a - b)
  let best = { min: usable[0].min, max: usable[0].max, overlap: 1 }
  for (let index = 0; index < points.length - 1; index++) {
    const min = points[index]
    const max = points[index + 1]
    if (max <= min) continue
    const midpoint = (min + max) / 2
    const overlap = usable.reduce((count, range) => count + (midpoint >= range.min && midpoint <= range.max ? 1 : 0), 0)
    const width = max - min
    const bestWidth = best.max - best.min
    if (overlap > best.overlap
      || (overlap === best.overlap && width > bestWidth + 1e-9)
      || (overlap === best.overlap && Math.abs(width - bestWidth) <= 1e-9 && max > best.max)) {
      best = { min, max, overlap }
    }
  }
  return { ...best, desired: (best.min + best.max) / 2 }
}

/** 将当前净距离转换成移动意图；撞击失败时严格回退为“停止”。 */
export function aiRangeDecision(
  distance: number,
  standing: AIStandingRange,
  movement: AIMovementProfile,
  ramAvailability: AIRamAvailability = 'available',
): AIRangeDecision {
  const value = Math.max(0, distance)
  if (movement === 'ram') {
    if (ramAvailability === 'available') return 'ram'
    if (ramAvailability === 'unreachable') return 'hold'
    movement = 'stop'
  }
  if (value < standing.min - 1e-6) return 'retreat'
  if (value > standing.max + 1e-6) return 'approach'
  if (movement === 'orbit') return 'orbit'
  const edgeTolerance = Math.max(0.01, (standing.max - standing.min) * 0.12)
  if (movement === 'keepFar' && value < standing.max - edgeTolerance) return 'retreat'
  if (movement === 'closeIn' && value > standing.min + edgeTolerance) return 'approach'
  return 'hold'
}

type LegacyAI = {
  preferredTarget?: unknown
  positioning?: unknown
  movement?: unknown
  targeting?: { profile?: unknown }
  attack?: { profile?: unknown }
  special?: UnitAISpecial
}

const preferredTargets: readonly AIPreferredTarget[] = ['playerControlled', 'playerFaction', 'allHostile']
const positioningProfiles: readonly AIPositioningProfile[] = ['longestRange', 'optimalRange', 'shortestRange']
const movementProfiles: readonly AIMovementProfile[] = ['orbit', 'keepFar', 'closeIn', 'stop', 'ram']

/** 读取自定义单位和旧事件时一次性转换旧“索敌/移动/攻击”协议。 */
export function normalizeUnitAI(raw: unknown): UnitAI {
  const legacy = raw && typeof raw === 'object' ? raw as LegacyAI : {}
  const legacyTarget = String(legacy.targeting?.profile ?? '')
  const legacyMovement = typeof legacy.movement === 'object' && legacy.movement
    ? String((legacy.movement as { profile?: unknown }).profile ?? '')
    : String(legacy.movement ?? '')
  const preferredTarget = preferredTargets.includes(legacy.preferredTarget as AIPreferredTarget)
    ? legacy.preferredTarget as AIPreferredTarget
    : legacyTarget === 'fortress' ? 'playerControlled' : 'allHostile'
  const positioning = positioningProfiles.includes(legacy.positioning as AIPositioningProfile)
    ? legacy.positioning as AIPositioningProfile
    : legacyMovement === 'rangeEdge' || legacyMovement === 'holdRange'
      ? 'longestRange'
      : legacyMovement === 'direct' || legacyMovement === 'flyDirect'
        ? 'shortestRange'
        : 'optimalRange'
  const movement = movementProfiles.includes(legacyMovement as AIMovementProfile)
    ? legacyMovement as AIMovementProfile
    : legacyMovement === 'rangeEdge' ? 'orbit'
      : legacyMovement === 'direct' || legacyMovement === 'flyDirect' ? 'closeIn'
        : 'stop'
  return {
    preferredTarget,
    positioning,
    movement,
    special: legacy.special ?? { profile: 'none' },
  }
}

/** 关卡事件的 AI 覆盖只转换配置，不直接执行战斗行为。 */
export function aiOverrideFromCommand(
  command: { mode: 'pause' | 'restore' | 'replace'; preferredTarget?: string; positioning?: string; movement?: string },
  fallback: UnitAI | undefined,
): UnitAI | null {
  if (command.mode !== 'replace') return null
  const base = fallback ?? DEFAULT_UNIT_AI
  return normalizeUnitAI({
    preferredTarget: command.preferredTarget ?? base.preferredTarget,
    positioning: command.positioning ?? base.positioning,
    movement: command.movement ?? base.movement,
    special: base.special,
  })
}
