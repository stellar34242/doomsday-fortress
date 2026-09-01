import {
  aiRangeDecision,
  computeAIStandingRange,
  normalizeUnitAI,
  resolvedUnitCombat,
  runtimeEnemyUnitDef,
  unitTypeConfig,
  type UnitAI,
  type UnitCombatStats,
  type UnitDef,
  type UnitTargetKind,
} from '../unit'
import type { Enemy, GameState } from '../engine'
import type { LevelPlacedUnitFaction } from '../level'
import {
  clearUnitCombatTarget,
  selectUnitCombatTarget,
  setUnitCombatTarget,
  type CombatTargetingDependencies,
  type UnitCombatTarget,
} from './combatTargeting'

type EnemyFireTarget = {
  kind: Extract<UnitTargetKind, 'fortress' | 'combatUnit'>
  id: number
  x: number
  y: number
  side?: 'ally' | 'enemy'
}

export interface EnemyCombatAIDependencies extends CombatTargetingDependencies {
  factionsHostile: (a: LevelPlacedUnitFaction, b: LevelPlacedUnitFaction) => boolean
  moveEnemyFree: (state: GameState, enemy: Enemy, vx: number, vy: number, speed: number, dt: number) => void
  moveToward: (state: GameState, enemy: Enemy, x: number, y: number, dt: number, ignoreBlockers?: boolean) => void
  moveUnitAircraftToward: (enemy: Enemy, unit: UnitDef, x: number, y: number, dt: number, speedScale?: number) => boolean
  enemyDealDamage: (state: GameState, enemy: Enemy, damage: number, duration?: number, contactRequired?: boolean) => boolean
  enemyFireAt: (state: GameState, enemy: Enemy, combat: UnitCombatStats, target: EnemyFireTarget) => void
  resolveEnemyKamikaze: (state: GameState, enemy: Enemy, combat: UnitCombatStats, damageScale: number, arrival: boolean) => void
  updateEnemyScript: (state: GameState, enemy: Enemy, unit: UnitDef, combat: UnitCombatStats, dt: number) => boolean
  updateUnitDeployForces: (state: GameState, host: Enemy, unit: UnitDef, ai: UnitAI, side: 'enemy', dt: number) => boolean
  placementBodyLocks: (enemy: Enemy) => { movement: boolean; rotation: boolean }
  updatePlacementBehavior: (state: GameState, enemy: Enemy, unit: UnitDef, side: 'enemy', dt: number, movementLocked?: boolean) => boolean
  updateArmedEnemyVehicleMovement: (state: GameState, enemy: Enemy, unit: UnitDef, ai: UnitAI, distanceField: number[], dt: number, movementSuppressed?: boolean) => boolean
  vehicleObjectClearanceHeight: (config: ReturnType<typeof unitTypeConfig>) => number
  computePathField: (state: GameState, objectClearanceHeight?: number) => number[]
  followPath: (state: GameState, enemy: Enemy, distanceField: number[], dt: number) => void
}

/** 敌方与中立敌对单位使用和友方相同的战斗决策；阵营仅影响敌对关系，不改变运动或武器规则。 */
export function createEnemyCombatAI(deps: EnemyCombatAIDependencies) {
  function applyMovement(state: GameState, enemy: Enemy, unit: UnitDef, target: UnitCombatTarget, ai: UnitAI, combat: UnitCombatStats, distanceField: number[], dt: number) {
    const standing = computeAIStandingRange(combat.range > 0 ? [{ min: 0, max: combat.range }] : [], ai.positioning)
    const decision = unit.type === 'building' ? 'hold' : aiRangeDecision(target.distance, standing, ai.movement, ai.movement === 'ram' ? 'ineligible' : 'available')
    const dx = target.x - enemy.x, dy = target.y - enemy.y
    if (decision === 'approach' && target.side === 'fortress' && !unit.stats.air) {
      const navigation = deps.vehicleObjectClearanceHeight(unitTypeConfig(unit)) > 0 ? deps.computePathField(state, 1) : distanceField
      deps.followPath(state, enemy, navigation, dt)
    } else if (decision === 'approach') deps.moveToward(state, enemy, target.x, target.y, dt, unit.stats.air)
    else if (decision === 'retreat') deps.moveEnemyFree(state, enemy, -dx, -dy, unit.stats.speed, dt)
    else if (decision === 'orbit') {
      const side = enemy.id % 2 === 0 ? 1 : -1
      deps.moveEnemyFree(state, enemy, -dy * side, dx * side, unit.stats.speed * 0.62, dt)
    } else if (unitTypeConfig(unit)?.kind === 'fixedWingAircraft') deps.moveUnitAircraftToward(enemy, unit, target.x, target.y, dt, 0)
    else deps.moveUnitAircraftToward(enemy, unit, enemy.x, enemy.y, dt, 0)
    return decision
  }

  function fireTarget(target: UnitCombatTarget): EnemyFireTarget {
    return { kind: target.kind, id: target.id, x: target.x, y: target.y, side: target.side === 'fortress' ? undefined : target.side }
  }

  function updateEnemy(state: GameState, enemy: Enemy, distanceField: number[], dt: number): void {
    if (enemy.hp <= 0) return
    const unit = runtimeEnemyUnitDef(enemy.unitDefId, enemy.kind)
    const baseAi = enemy.aiOverride || unit.ai ? normalizeUnitAI(enemy.aiOverride ?? unit.ai) : undefined
    const combat = resolvedUnitCombat(unit)
    enemy.hitFlash = Math.max(0, enemy.hitFlash - dt)
    if (deps.updateEnemyScript(state, enemy, unit, combat, dt)) return
    if (enemy.scriptPaused || (enemy.controller ?? 'ai') !== 'ai') { clearUnitCombatTarget(enemy); return }
    if (baseAi && deps.updateUnitDeployForces(state, enemy, unit, baseAi, 'enemy', dt)) return
    const placementLocks = deps.placementBodyLocks(enemy)
    const bodyLocks = unit.bodyLocked ? { movement: true, rotation: true } : placementLocks
    const behaviorControlled = deps.updatePlacementBehavior(state, enemy, unit, 'enemy', dt, bodyLocks.movement)
    const movementControlled = bodyLocks.movement || behaviorControlled
    const movementSuppressed = movementControlled || bodyLocks.rotation
    const ai = baseAi
    if (!ai) { clearUnitCombatTarget(enemy); return }
    if (deps.updateArmedEnemyVehicleMovement(state, enemy, unit, ai, distanceField, dt, movementSuppressed)) return

    const target = selectUnitCombatTarget(state, enemy, unit, ai, deps, { ownerSide: 'enemy', combat })
    if (!target) {
      clearUnitCombatTarget(enemy)
      if (movementSuppressed) return
      enemy.mode = 'move'
      enemy.hasGoal = false
      // 无放置实例的波次单位沿用关卡主路径，直到共享视野获得合法目标。
      if (!movementControlled && enemy.placementId === undefined && !unit.stats.air) {
        const navigation = deps.vehicleObjectClearanceHeight(unitTypeConfig(unit)) > 0 ? deps.computePathField(state, 1) : distanceField
        deps.followPath(state, enemy, navigation, dt)
      }
      return
    }
    setUnitCombatTarget(enemy, target)
    enemy.hasGoal = false
    const decision = movementSuppressed ? 'hold' : applyMovement(state, enemy, unit, target, ai, combat, distanceField, dt)
    enemy.mode = decision === 'approach' ? 'move' : 'attack'

    if (combat.profile === 'kamikaze') {
      if (target.distance <= Math.max(0, combat.range)) deps.resolveEnemyKamikaze(state, enemy, combat, 1, true)
      return
    }
    if (target.distance > combat.range) return
    if (combat.profile === 'projectile') {
      enemy.attackCooldown = (enemy.attackCooldown ?? 0) - dt
      if (enemy.attackCooldown <= 0) {
        deps.enemyFireAt(state, enemy, combat, fireTarget(target))
        enemy.attackCooldown += combat.interval
        if (enemy.attackCooldown <= 0) enemy.attackCooldown = combat.interval
      }
      return
    }
    if (combat.profile === 'hitscan') {
      enemy.attackCooldown = (enemy.attackCooldown ?? 0) - dt
      if (enemy.attackCooldown <= 0) {
        if (!deps.enemyDealDamage(state, enemy, combat.damage, 1, false)) clearUnitCombatTarget(enemy)
        enemy.attackCooldown += combat.interval
        if (enemy.attackCooldown <= 0) enemy.attackCooldown = combat.interval
      }
      return
    }
    if (combat.profile === 'melee') {
      const damage = (combat.damage / Math.max(0.01, combat.interval)) * dt
      if (!deps.enemyDealDamage(state, enemy, damage, dt, true)) clearUnitCombatTarget(enemy)
    }
  }

  return { updateEnemy }
}
