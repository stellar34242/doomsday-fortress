import type { TurretDef } from '../config'
import type { Ally, Enemy, GameState, Turret } from '../engine'
import type { LevelPlacedUnitFaction } from '../level'
import {
  resolvedUnitCombat,
  runtimeAllyUnitDef,
  runtimeEnemyUnitDef,
  type AIWeaponRange,
  type UnitAI,
  type UnitCombatStats,
  type UnitDef,
} from '../unit'

export type CombatTargetSide = 'fortress' | 'ally' | 'enemy'

/** 单位 AI 与炮塔 AI 共享的唯一战斗目标描述。 */
export interface UnitCombatTarget {
  kind: 'fortress' | 'combatUnit'
  side: CombatTargetSide
  id: number
  x: number
  y: number
  air: boolean
  altitude: number
  faction: LevelPlacedUnitFaction
  /** 主体外沿到目标外沿的净距离（格）。 */
  distance: number
  centerDistance: number
  preference: number
}

export type CombatUnitHost = Enemy | Ally

export interface CombatTargetingDependencies {
  factionsHostile: (a: LevelPlacedUnitFaction, b: LevelPlacedUnitFaction) => boolean
  unitCanSeePoint: (state: GameState, host: CombatUnitHost, x: number, y: number, target?: Pick<UnitCombatTarget, 'side' | 'id'>) => boolean
  fortressCenter: (state: GameState) => { x: number; y: number }
  fortressDistanceToPoint: (state: GameState, x: number, y: number) => number
  unitRadiusToward: (unit: UnitDef, dx: number, dy: number) => number
  currentUnitAltitude: (host: { aircraft?: Enemy['aircraft'] }, unit: UnitDef) => number
  turretDefById: (id: string) => TurretDef
}

export interface CombatTargetOptions {
  ownerSide: 'ally' | 'enemy'
  turrets?: readonly Turret[]
  combat?: UnitCombatStats
  /** 投送等能力可在宿主本身没有武器时仍选择合法目标。 */
  allowUnarmed?: boolean
}

function factionOf(host: CombatUnitHost, ownerSide: 'ally' | 'enemy'): LevelPlacedUnitFaction {
  return host.faction ?? (ownerSide === 'enemy' ? 'enemy' : 'ally')
}

function turretCanTarget(def: TurretDef, air: boolean): boolean {
  if (air ? !def.canAir : !def.canGround) return false
  return !def.tags?.some(tag => tag.kind === 'exclude' && tag.key === (air ? 'air' : 'ground'))
}

function targetPreference(ai: UnitAI, side: CombatTargetSide, faction: LevelPlacedUnitFaction): number {
  if (ai.preferredTarget === 'allHostile') return 0
  if (ai.preferredTarget === 'playerControlled') return side === 'fortress' ? 0 : 1
  return side === 'fortress' || faction === 'player' ? 0 : 1
}

export function targetMatchesWeapon(def: TurretDef, target: Pick<UnitCombatTarget, 'air'>): boolean {
  return turretCanTarget(def, target.air)
}

/** 当前目标可用的炮塔射程区间，统一使用米。 */
export function turretRangesForTarget(
  turrets: readonly Turret[],
  target: Pick<UnitCombatTarget, 'air'>,
  turretDefById: (id: string) => TurretDef,
): AIWeaponRange[] {
  const result: AIWeaponRange[] = []
  for (const turret of turrets) {
    if (turret.hp <= 0) continue
    const def = turretDefById(turret.defId)
    if (targetMatchesWeapon(def, target) && def.rangeMax > def.rangeMin) result.push({ min: def.rangeMin, max: def.rangeMax })
  }
  return result
}

/**
 * 战斗单位唯一索敌入口。首选目标只改变排序；敌对、视野、空地能力与武器合法性始终先过滤。
 * “所有敌对”明确排除中立敌对作为主动目标，但中立敌对自身仍可攻击其他合法阵营。
 */
export function selectUnitCombatTarget(
  state: GameState,
  host: CombatUnitHost,
  unit: UnitDef,
  ai: UnitAI,
  deps: CombatTargetingDependencies,
  options: CombatTargetOptions,
): UnitCombatTarget | null {
  const ownerFaction = factionOf(host, options.ownerSide)
  const combat = options.combat ?? resolvedUnitCombat(unit)
  const turrets = options.turrets ?? []
  const sourceScale = 'bossSizeScale' in host ? host.bossSizeScale ?? 1 : 1
  const candidates: UnitCombatTarget[] = []
  const canAttack = (air: boolean): boolean => {
    if (turrets.some(turret => turret.hp > 0 && turretCanTarget(deps.turretDefById(turret.defId), air))) return true
    if (combat.profile !== 'none' && combat.profile !== 'scripted') return air ? (combat.canAir ?? true) : (combat.canGround ?? true)
    if (ai.movement === 'ram' && !!host.vehicle && !unit.stats.air && !air) return true
    return options.allowUnarmed === true
  }
  const visible = (x: number, y: number, side: CombatTargetSide, id: number) => deps.unitCanSeePoint(state, host, x, y, { side, id })
  const addUnit = (candidate: CombatUnitHost, candidateUnit: UnitDef, side: 'ally' | 'enemy', faction: LevelPlacedUnitFaction) => {
    if (candidate === host || candidate.hp <= 0 || faction === 'neutralHostile' || !deps.factionsHostile(ownerFaction, faction)) return
    if (!canAttack(candidateUnit.stats.air) || !visible(candidate.x, candidate.y, side, candidate.id)) return
    const dx = candidate.x - host.x, dy = candidate.y - host.y
    const centerDistance = Math.hypot(dx, dy)
    const targetScale = 'bossSizeScale' in candidate ? candidate.bossSizeScale ?? 1 : 1
    const distance = Math.max(0, centerDistance
      - deps.unitRadiusToward(unit, dx, dy) * sourceScale
      - deps.unitRadiusToward(candidateUnit, -dx, -dy) * targetScale)
    candidates.push({
      kind: 'combatUnit', side, id: candidate.id, x: candidate.x, y: candidate.y,
      air: candidateUnit.stats.air, altitude: deps.currentUnitAltitude(candidate, candidateUnit), faction,
      distance, centerDistance, preference: targetPreference(ai, side, faction),
    })
  }

  if (state.fortress.hp > 0 && state.fortress.dyingT < 0 && deps.factionsHostile(ownerFaction, 'player') && canAttack(false)) {
    const point = deps.fortressCenter(state)
    if (visible(point.x, point.y, 'fortress', 0)) {
      const dx = point.x - host.x, dy = point.y - host.y
      const centerDistance = Math.hypot(dx, dy)
      candidates.push({
        kind: 'fortress', side: 'fortress', id: 0, x: point.x, y: point.y, air: false, altitude: 0, faction: 'player',
        distance: Math.max(0, deps.fortressDistanceToPoint(state, host.x, host.y) - deps.unitRadiusToward(unit, dx, dy) * sourceScale),
        centerDistance, preference: targetPreference(ai, 'fortress', 'player'),
      })
    }
  }
  for (const candidate of state.allies) addUnit(candidate, runtimeAllyUnitDef(candidate.unitDefId, candidate.kind), 'ally', candidate.faction ?? 'ally')
  for (const candidate of state.enemies) addUnit(candidate, runtimeEnemyUnitDef(candidate.unitDefId, candidate.kind), 'enemy', candidate.faction ?? 'enemy')
  if (candidates.length === 0) return null
  candidates.sort((a, b) => a.preference - b.preference || a.distance - b.distance || a.side.localeCompare(b.side) || a.id - b.id)
  const best = candidates[0]
  const previousSide = host.combatTargetSide
  const previousId = host.targetId
  const previous = candidates.find(candidate => candidate.side === previousSide && candidate.id === previousId)
  if (previous && previous.preference === best.preference && previous.distance <= best.distance * 1.12 + 0.05) return previous
  return best
}

export function setUnitCombatTarget(host: CombatUnitHost, target: UnitCombatTarget | null): void {
  host.targetId = target?.id ?? null
  host.combatTargetSide = target?.side
  if ('targetKind' in host) host.targetKind = target?.kind ?? null
}

export function clearUnitCombatTarget(host: CombatUnitHost): void {
  host.targetId = null
  host.combatTargetSide = undefined
  if ('targetKind' in host) host.targetKind = null
}
