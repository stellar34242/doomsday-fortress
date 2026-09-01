import type { FortressDef } from '../config'
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
} from '../unit'
import type { Ally, Enemy, EnemyDamageSource, GameState } from '../engine'
import {
  clearUnitCombatTarget,
  selectUnitCombatTarget,
  setUnitCombatTarget,
  type CombatTargetingDependencies,
  type UnitCombatTarget,
} from './combatTargeting'

export interface AllyCombatAIDependencies extends CombatTargetingDependencies {
  unitForAlly: (state: GameState, ally: Ally) => UnitDef
  finishZone: { x: number; y: number; w: number; h: number }
  damageAlly: (state: GameState, ally: Ally, damage: number) => void
  damageEnemy: (state: GameState, enemy: Enemy, damage: number, sourceTurretId: number | null, source?: EnemyDamageSource) => void
  updateAllyScript: (state: GameState, ally: Ally, unit: UnitDef, combat: UnitCombatStats, dt: number) => boolean
  updateUnitDeployForces: (state: GameState, host: Ally, unit: UnitDef, ai: UnitAI, side: 'ally', dt: number) => boolean
  placementBodyLocks: (host: Ally) => { movement: boolean; rotation: boolean }
  updatePlacementBehavior: (state: GameState, host: Ally, unit: UnitDef, side: 'ally', dt: number, movementLocked?: boolean) => boolean
  engagePlacementGroup: (state: GameState, host: Ally) => void
  unitVehiclePlatform: (unit: UnitDef) => FortressDef | undefined
  updateAllyVehicleTurrets: (state: GameState, ally: Ally, unit: UnitDef, ai: UnitAI, dt: number) => void
  updateArmedAllyVehicleMovement: (state: GameState, ally: Ally, unit: UnitDef, ai: UnitAI, dt: number, movementSuppressed?: boolean) => boolean
  moveAllyToward: (state: GameState, ally: Ally, unit: UnitDef, x: number, y: number, speed: number, dt: number) => void
  moveUnitAircraftToward: (host: Ally, unit: UnitDef, x: number, y: number, dt: number, speedScale?: number) => boolean
  unitFireAtEnemy: (state: GameState, ally: Ally, enemy: Enemy, combat: UnitCombatStats) => void
}

export function unitCombatCanTarget(combat: UnitCombatStats, air: boolean): boolean {
  return air ? (combat.canAir ?? true) : (combat.canGround ?? true)
}

/** 友方、玩家阵营 AI 与敌方共用同一目标/站位/移动协议；任务脚本仍可在更外层接管。 */
export function createAllyCombatAI(deps: AllyCombatAIDependencies) {
  function applyMovement(state: GameState, ally: Ally, unit: UnitDef, target: UnitCombatTarget, ai: UnitAI, combat: UnitCombatStats, dt: number): void {
    const standing = computeAIStandingRange(combat.range > 0 ? [{ min: 0, max: combat.range }] : [], ai.positioning)
    const decision = unit.type === 'building' ? 'hold' : aiRangeDecision(target.distance, standing, ai.movement, ai.movement === 'ram' ? 'ineligible' : 'available')
    const dx = target.x - ally.x, dy = target.y - ally.y
    if (decision === 'approach') deps.moveAllyToward(state, ally, unit, target.x, target.y, unit.stats.speed, dt)
    else if (decision === 'retreat') deps.moveAllyToward(state, ally, unit, ally.x - dx, ally.y - dy, unit.stats.speed, dt)
    else if (decision === 'orbit') {
      const side = ally.id % 2 === 0 ? 1 : -1
      deps.moveAllyToward(state, ally, unit, ally.x - dy * side, ally.y + dx * side, unit.stats.speed * 0.62, dt)
    } else if (unitTypeConfig(unit)?.kind === 'fixedWingAircraft') deps.moveUnitAircraftToward(ally, unit, target.x, target.y, dt, 0)
    else deps.moveUnitAircraftToward(ally, unit, ally.x, ally.y, dt, 0)
  }

  function updateEscort(state: GameState, ally: Ally, unit: UnitDef, combat: UnitCombatStats, dt: number): boolean {
    if (state.objective.type !== 'escort' || ally.placementId !== state.objective.unitPlacementId) return false
    let threat: Enemy | null = null
    let threatDistance = Infinity
    for (const enemy of state.enemies) {
      if (enemy.hp <= 0 || enemy.faction === 'neutralHostile' || !deps.unitCanSeePoint(state, ally, enemy.x, enemy.y, { side: 'enemy', id: enemy.id })) continue
      const enemyUnit = runtimeEnemyUnitDef(enemy.unitDefId, enemy.kind)
      if (!unitCombatCanTarget(combat, enemyUnit.stats.air)) continue
      const dx = enemy.x - ally.x, dy = enemy.y - ally.y
      const distance = Math.max(0, Math.hypot(dx, dy)
        - deps.unitRadiusToward(unit, dx, dy)
        - deps.unitRadiusToward(enemyUnit, -dx, -dy))
      if (distance <= combat.range && distance < threatDistance) { threat = enemy; threatDistance = distance }
    }
    if (threat && ['projectile', 'hitscan', 'melee'].includes(combat.profile ?? 'none')) {
      ally.targetId = threat.id
      ally.combatTargetSide = 'enemy'
      if (combat.profile === 'melee') {
        deps.engagePlacementGroup(state, ally)
        deps.damageEnemy(state, threat, (combat.damage / Math.max(0.01, combat.interval)) * dt, null, {
          x: ally.x, y: ally.y, attackerSide: 'ally', attackerId: ally.id,
        })
        return true
      }
      ally.cooldown -= dt
      if (ally.cooldown <= 0) {
        ally.cooldown = combat.interval
        deps.engagePlacementGroup(state, ally)
        if (combat.profile === 'projectile') deps.unitFireAtEnemy(state, ally, threat, combat)
        else deps.damageEnemy(state, threat, combat.damage, null, {
          x: ally.x, y: ally.y, attackerSide: 'ally', attackerId: ally.id,
          penetration: combat.penetration, ammoId: combat.projectileId,
          incomingDx: threat.x - ally.x, incomingDy: threat.y - ally.y,
        })
      }
    } else {
      clearUnitCombatTarget(ally)
      const targetX = deps.finishZone.x + deps.finishZone.w / 2
      const targetY = deps.finishZone.y + deps.finishZone.h / 2
      if (Math.hypot(targetX - ally.x, targetY - ally.y) > 0.05) deps.moveAllyToward(state, ally, unit, targetX, targetY, unit.stats.speed, dt)
    }
    return true
  }

  function updateAlly(state: GameState, ally: Ally, dt: number): void {
    const unit = deps.unitForAlly(state, ally)
    const baseAi = ally.aiOverride || unit.ai ? normalizeUnitAI(ally.aiOverride ?? unit.ai) : undefined
    const combat = resolvedUnitCombat(unit)
    ally.hitFlash = Math.max(0, ally.hitFlash - dt)
    if (ally.dots?.length) {
      for (const dot of ally.dots) {
        dot.left -= dt
        dot.timer -= dt
        if (dot.timer <= 0) { dot.timer += dot.interval; deps.damageAlly(state, ally, dot.damage) }
      }
      ally.dots = ally.dots.filter(dot => dot.left > 0)
      if (ally.hp <= 0) return
    }
    if (deps.updateAllyScript(state, ally, unit, combat, dt)) return
    if (ally.scriptPaused || (ally.controller ?? 'ai') !== 'ai') { clearUnitCombatTarget(ally); return }
    if (baseAi && deps.updateUnitDeployForces(state, ally, unit, baseAi, 'ally', dt)) return
    const placementLocks = deps.placementBodyLocks(ally)
    const bodyLocks = unit.bodyLocked ? { movement: true, rotation: true } : placementLocks
    const behaviorControlled = deps.updatePlacementBehavior(state, ally, unit, 'ally', dt, bodyLocks.movement)
    const movementControlled = bodyLocks.movement || behaviorControlled
    const movementSuppressed = movementControlled || bodyLocks.rotation
    const ai = baseAi
    if (ally.faction === 'neutral' || !ai) { clearUnitCombatTarget(ally); return }
    if (!movementSuppressed && updateEscort(state, ally, unit, combat, dt)) return
    if (ally.vehicle && deps.unitVehiclePlatform(unit)) {
      deps.updateAllyVehicleTurrets(state, ally, unit, ai, dt)
      if (deps.updateArmedAllyVehicleMovement(state, ally, unit, ai, dt, movementSuppressed)) return
    }
    const target = selectUnitCombatTarget(state, ally, unit, ai, deps, { ownerSide: 'ally', combat })
    if (!target || target.side !== 'enemy') { clearUnitCombatTarget(ally); return }
    setUnitCombatTarget(ally, target)
    if (!movementSuppressed) applyMovement(state, ally, unit, target, ai, combat, dt)
    if (target.distance > combat.range || !['projectile', 'hitscan', 'melee'].includes(combat.profile ?? 'none')) return
    const enemy = state.enemies.find(item => item.id === target.id && item.hp > 0)
    if (!enemy) return
    if (combat.profile === 'melee') {
      deps.engagePlacementGroup(state, ally)
      deps.damageEnemy(state, enemy, (combat.damage / Math.max(0.01, combat.interval)) * dt, null, {
        x: ally.x, y: ally.y, attackerSide: 'ally', attackerId: ally.id,
      })
      return
    }
    ally.cooldown -= dt
    if (ally.cooldown <= 0) {
      ally.cooldown = combat.interval
      deps.engagePlacementGroup(state, ally)
      if (combat.profile === 'projectile') deps.unitFireAtEnemy(state, ally, enemy, combat)
      else deps.damageEnemy(state, enemy, combat.damage, null, {
        x: ally.x, y: ally.y, attackerSide: 'ally', attackerId: ally.id,
        penetration: combat.penetration, ammoId: combat.projectileId,
        incomingDx: enemy.x - ally.x, incomingDy: enemy.y - ally.y,
      })
    }
  }

  return { updateAlly }
}
