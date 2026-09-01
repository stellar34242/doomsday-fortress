import { unitDefById, type UnitAI, type UnitDef } from '../unit'
import type { Ally, Enemy, GameState } from '../engine'
import {
  selectUnitCombatTarget,
  setUnitCombatTarget,
  type CombatTargetingDependencies,
} from './combatTargeting'

export type UnitDeployHost = Enemy | Ally

export interface DeploymentAIDependencies extends CombatTargetingDependencies {
  spawnDeployedUnit: (state: GameState, source: UnitDeployHost, sourceDef: UnitDef, unit: UnitDef, direction: 'front' | 'rear' | 'left' | 'right') => Enemy | Ally | null
  moveEnemyVehicleToward: (state: GameState, enemy: Enemy, x: number, y: number, dt: number, speedScale?: number) => boolean
  moveToward: (state: GameState, enemy: Enemy, x: number, y: number, dt: number, ignoreBlockers?: boolean) => void
  moveAllyToward: (state: GameState, ally: Ally, unit: UnitDef, x: number, y: number, speed: number, dt: number) => void
  moveUnitVehicleToward: (state: GameState, host: UnitDeployHost, unit: UnitDef, x: number, y: number, dt: number, speedScale?: number) => boolean
}

/** 投送能力复用战斗单位唯一索敌入口；只跳过“宿主必须有武器”的限制。 */
export function createDeploymentAI(deps: DeploymentAIDependencies) {
  function updateUnitDeployForces(state: GameState, host: UnitDeployHost, unit: UnitDef, ai: UnitAI, side: 'ally' | 'enemy', dt: number): boolean {
    const special = ai.special
    if (special?.profile !== 'deployForces') return false
    const runtime = host.deployForces ??= { spawned: 0, cooldown: 0, complete: false }
    if (runtime.complete) return false
    const deployedDef = unitDefById(special.unitDefId)
    if (!deployedDef || deployedDef.id === unit.id) { runtime.complete = true; return false }
    const target = selectUnitCombatTarget(state, host, unit, ai, deps, { ownerSide: side, allowUnarmed: true })
    if (!target) return false
    setUnitCombatTarget(host, target)
    if ('mode' in host) { host.mode = 'move'; host.hasGoal = false }
    const currentSpeed = host.vehicle ? Math.hypot(host.vehicle.vx, host.vehicle.vy) : 0
    const arrivalTolerance = Math.max(0.05, currentSpeed * dt + 0.05)
    if (target.distance > arrivalTolerance) {
      // 只推进到双方几何外沿，避免运输载具为了抵达目标中心先触发冲撞伤害。
      const maxStep = Math.max(1e-6, unit.stats.speed * dt)
      const speedScale = Math.max(0, Math.min(1, (target.distance - 0.025) / maxStep))
      if (side === 'enemy') {
        const enemy = host as Enemy
        if (!deps.moveEnemyVehicleToward(state, enemy, target.x, target.y, dt, speedScale)) deps.moveToward(state, enemy, target.x, target.y, dt, unit.stats.air)
      } else deps.moveAllyToward(state, host as Ally, unit, target.x, target.y, unit.stats.speed * speedScale, dt)
      return true
    }
    if (host.vehicle) deps.moveUnitVehicleToward(state, host, unit, host.x, host.y, dt, 0)
    runtime.cooldown = Math.max(0, runtime.cooldown - dt)
    if (runtime.cooldown > 0) return true
    if (!deps.spawnDeployedUnit(state, host, unit, deployedDef, special.direction)) {
      runtime.cooldown = special.interval
      return true
    }
    runtime.spawned++
    runtime.cooldown = special.interval
    if (runtime.spawned >= special.count) runtime.complete = true
    return !runtime.complete
  }

  return { updateUnitDeployForces }
}
