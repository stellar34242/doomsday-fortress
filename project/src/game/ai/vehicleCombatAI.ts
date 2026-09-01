import { M_PER_CELL, type FortressDef, type Hardpoint, type TurretDef } from '../config'
import {
  aiRangeDecision,
  computeAIStandingRange,
  unitTypeConfig,
  type AIRamAvailability,
  type UnitAI,
  type UnitDef,
} from '../unit'
import type { Ally, Enemy, GameState, Turret } from '../engine'
import {
  clearUnitCombatTarget,
  selectUnitCombatTarget,
  setUnitCombatTarget,
  targetMatchesWeapon,
  turretRangesForTarget,
  type CombatTargetingDependencies,
  type UnitCombatTarget,
} from './combatTargeting'
import { constrainedHardpointBodyHeading } from './turretGeometry'

const DEG = Math.PI / 180

interface ArmedVehicleEngagement {
  target: UnitCombatTarget
  turret: Turret
  def: TurretDef
  decision: ReturnType<typeof aiRangeDecision>
}

/** 只有地面单位可以借用敌方向堡垒推进时的地面距离场。单位类型是空中属性的权威来源。 */
export function unitUsesGroundApproachPath(unit: UnitDef): boolean {
  const kind = unitTypeConfig(unit)?.kind
  return kind !== 'rotorcraft' && kind !== 'fixedWingAircraft' && !unit.stats.air
}

export interface VehicleCombatAIDependencies extends CombatTargetingDependencies {
  unitVehiclePlatform: (unit: UnitDef) => FortressDef | undefined
  effectiveUnitHardpoint: (host: Enemy | Ally, vehicle: FortressDef, hardpoint: Hardpoint) => Hardpoint
  turretCenter: (turret: Turret) => { x: number; y: number }
  bearing: (dx: number, dy: number) => number
  wrapAngle: (angle: number) => number
  dirX: (angle: number) => number
  dirY: (angle: number) => number
  moveUnitAircraftToward: (host: Enemy | Ally, unit: UnitDef, x: number, y: number, dt: number, speedScale?: number, facingHeading?: number) => boolean
  moveUnitVehicleToward: (state: GameState, host: Enemy | Ally, unit: UnitDef, x: number, y: number, dt: number, speedScale?: number) => boolean
  approachNumber: (current: number, target: number, maxDelta: number) => number
  vehicleBrakeMultiplier: (inertia: number) => number
  syncUnitVehicleTurrets: (host: Enemy | Ally, unit: UnitDef) => void
  turretDefById: (id: string) => TurretDef
  ensureUnitVehicleTurrets: (state: GameState, host: Ally, unit: UnitDef) => Turret[]
  ensureEnemyVehicleTurrets: (state: GameState, host: Enemy, unit: UnitDef) => Turret[]
  syncEnemyVehicleTurrets: (enemy: Enemy, unit: UnitDef) => void
  moveAllyToward: (state: GameState, ally: Ally, unit: UnitDef, x: number, y: number, speed: number, dt: number) => void
  moveToward: (state: GameState, enemy: Enemy, x: number, y: number, dt: number, ignoreBlockers?: boolean) => void
  vehicleObjectClearanceHeight: (config: ReturnType<typeof unitTypeConfig>) => number
  computePathField: (state: GameState, objectClearanceHeight?: number) => number[]
  followPath: (state: GameState, enemy: Enemy, distanceField: number[], dt: number) => void
  /** 撞击只走当前直达车道；车道被结构封住时进入短暂重检，期间按停止处理。 */
  ramPathReachable: (state: GameState, host: Enemy | Ally, unit: UnitDef, target: UnitCombatTarget) => boolean
}

/** 载具车体只负责主目标、站位和把受限炮位送入射界；各炮塔仍独立瞄准和开火。 */
export function createVehicleCombatAI(deps: VehicleCombatAIDependencies) {
  function stopVehicle(state: GameState, host: Enemy | Ally, unit: UnitDef, dt: number, target?: UnitCombatTarget): void {
    const config = unitTypeConfig(unit)
    if (config?.kind === 'fixedWingAircraft') deps.moveUnitAircraftToward(host, unit, target?.x ?? host.x, target?.y ?? host.y, dt, 0)
    else if (!deps.moveUnitAircraftToward(host, unit, host.x, host.y, dt, 0)) deps.moveUnitVehicleToward(state, host, unit, host.x, host.y, dt, 0)
  }

  function assistConstrainedHardpointAim(
    state: GameState,
    host: Enemy | Ally,
    unit: UnitDef,
    engagement: ArmedVehicleEngagement,
    dt: number,
  ): boolean {
    // 射程外的接近/后退优先完成站位；进入距离带后才让受限炮位独占车体朝向。
    // 环绕单位若炮位暂时离开射界，也先转动车体重新建立射界，之后再恢复环绕。
    if ((engagement.decision !== 'hold' && engagement.decision !== 'orbit') || !host.vehicle) return false
    const platform = deps.unitVehiclePlatform(unit)
    const sourceHardpoint = platform?.hardpoints.find(item => item.id === engagement.turret.hardpointId)
    if (!platform || !sourceHardpoint) return false
    const hardpoint = deps.effectiveUnitHardpoint(host, platform, sourceHardpoint)
    const center = deps.turretCenter(engagement.turret)
    const targetBearing = deps.bearing(engagement.target.x - center.x, engagement.target.y - center.y)
    const desiredHeading = constrainedHardpointBodyHeading(host.vehicle.heading, targetBearing, hardpoint, engagement.def.aimCone)
    const config = unitTypeConfig(unit)
    const constrained = hardpoint.fixed !== undefined || hardpoint.arc !== undefined
    if (engagement.decision === 'orbit' && config?.kind === 'rotorcraft' && constrained) {
      // 旋翼机可以侧飞：环绕位移沿目标切线，机头则独立维持受限炮位的合法射界。
      // 若仍把机头朝向绑定到切线，固定前向炮位会在“转向目标/恢复环绕”之间逐帧振荡。
      const dx = engagement.target.x - host.x, dy = engagement.target.y - host.y
      const side = host.id % 2 === 0 ? 1 : -1
      const facingHeading = hardpoint.fixed !== undefined
        ? deps.wrapAngle(targetBearing - hardpoint.fixed * DEG)
        : desiredHeading ?? host.aircraft?.heading ?? host.vehicle.heading
      deps.moveUnitAircraftToward(host, unit, host.x - dy * side, host.y + dx * side, dt, 0.62, facingHeading)
      deps.syncUnitVehicleTurrets(host, unit)
      return true
    }
    if (desiredHeading === null) return false

    const aimX = host.x + deps.dirX(desiredHeading) * 2
    const aimY = host.y + deps.dirY(desiredHeading) * 2
    if (config?.kind === 'rotorcraft') deps.moveUnitAircraftToward(host, unit, aimX, aimY, dt, 0)
    else if (config?.kind === 'fixedWingAircraft') deps.moveUnitAircraftToward(host, unit, engagement.target.x, engagement.target.y, dt, 0)
    else if (config?.kind === 'vehicle' && (config.chassis === 'wheeled' || config.chassis === 'halfTracked')) {
      deps.moveUnitVehicleToward(state, host, unit, aimX, aimY, dt, 0.18)
    } else if (config?.kind === 'vehicle' && config.chassis === 'walker') {
      // 机甲原地校准炮位也必须走统一运动/步态求解器，否则只会旋转静态首帧。
      deps.moveUnitVehicleToward(state, host, unit, aimX, aimY, dt, 0)
    } else if (config?.kind === 'vehicle') {
      const maxTurn = Math.max(0.1, config.turnSpeed) * DEG * dt
      const difference = deps.wrapAngle(desiredHeading - host.vehicle.heading)
      const delta = Math.max(-maxTurn, Math.min(maxTurn, difference))
      host.vehicle.heading = deps.wrapAngle(host.vehicle.heading + delta)
      host.vehicle.turnW = dt > 0 ? delta / dt : 0
      const speed = deps.approachNumber(Math.hypot(host.vehicle.vx, host.vehicle.vy), 0, Math.max(0.01, config.accel) * deps.vehicleBrakeMultiplier(config.brakeInertia) * dt)
      host.vehicle.vx = deps.dirX(host.vehicle.heading) * speed
      host.vehicle.vy = deps.dirY(host.vehicle.heading) * speed
    } else return false
    deps.syncUnitVehicleTurrets(host, unit)
    return true
  }

  function ramAvailability(state: GameState, host: Enemy | Ally, unit: UnitDef, target: UnitCombatTarget, dt: number): AIRamAvailability {
    if (!host.vehicle || unit.stats.air || target.air) return 'ineligible'
    const runtime = host.vehicle
    const key = `${target.side}:${target.id}`
    if (runtime.ramTargetKey !== key) {
      runtime.ramTargetKey = key
      runtime.ramLastDistance = undefined
      runtime.ramBlockedTime = 0
      runtime.ramRetryAt = undefined
    }
    if ((runtime.ramRetryAt ?? 0) > state.time) return 'unreachable'
    if (!deps.ramPathReachable(state, host, unit, target)) {
      runtime.ramRetryAt = state.time + 0.75
      runtime.ramBlockedTime = 0
      return 'unreachable'
    }
    const desired = deps.bearing(target.x - host.x, target.y - host.y)
    const aligned = Math.abs(deps.wrapAngle(desired - runtime.heading)) <= 35 * DEG
    const progress = runtime.ramLastDistance === undefined ? Infinity : runtime.ramLastDistance - target.distance
    runtime.ramBlockedTime = aligned && progress < 0.005 ? (runtime.ramBlockedTime ?? 0) + dt : 0
    runtime.ramLastDistance = target.distance
    if ((runtime.ramBlockedTime ?? 0) >= 0.8) {
      runtime.ramRetryAt = state.time + 0.75
      runtime.ramBlockedTime = 0
      return 'unreachable'
    }
    return 'available'
  }

  function moveForDecision(
    state: GameState,
    host: Enemy | Ally,
    unit: UnitDef,
    target: UnitCombatTarget,
    decision: ReturnType<typeof aiRangeDecision>,
    ownerSide: 'ally' | 'enemy',
    distanceField: number[] | undefined,
    dt: number,
  ): void {
    const move = (x: number, y: number, scale = 1) => {
      if (ownerSide === 'ally') deps.moveAllyToward(state, host as Ally, unit, x, y, unit.stats.speed * scale, dt)
      else deps.moveToward(state, host as Enemy, x, y, dt, unit.stats.air)
    }
    const dx = target.x - host.x, dy = target.y - host.y
    if (decision === 'approach' && ownerSide === 'enemy' && target.side === 'fortress' && distanceField && unitUsesGroundApproachPath(unit)) {
      const navigation = deps.vehicleObjectClearanceHeight(unitTypeConfig(unit)) > 0 ? deps.computePathField(state, 1) : distanceField
      deps.followPath(state, host as Enemy, navigation, dt)
    } else if (decision === 'approach' || decision === 'ram') move(target.x, target.y)
    else if (decision === 'retreat') move(host.x - dx, host.y - dy)
    else if (decision === 'orbit') {
      const side = host.id % 2 === 0 ? 1 : -1
      move(host.x - dy * side, host.y + dx * side, 0.62)
    } else stopVehicle(state, host, unit, dt, target)
  }

  function updateVehicleMovement(
    state: GameState,
    host: Enemy | Ally,
    unit: UnitDef,
    ai: UnitAI,
    ownerSide: 'ally' | 'enemy',
    turrets: Turret[],
    distanceField: number[] | undefined,
    dt: number,
    movementSuppressed = false,
  ): boolean {
    if (!host.vehicle || !deps.unitVehiclePlatform(unit) || (turrets.length === 0 && ai.movement !== 'ram')) return false
    deps.syncUnitVehicleTurrets(host, unit)
    const target = selectUnitCombatTarget(state, host, unit, ai, deps, { ownerSide, turrets })
    if (!target) {
      clearUnitCombatTarget(host)
      // 关卡放置行为或脚本已在本帧接管车体时，只扫描目标，不再写入一次制动位移。
      // 否则同一帧的两次载具积分会把合成速度反馈到下一帧，形成指数加速。
      if (!movementSuppressed) {
        stopVehicle(state, host, unit, dt)
        if ('mode' in host) { host.mode = 'move'; host.hasGoal = false }
      }
      return true
    }
    setUnitCombatTarget(host, target)
    // 保留本帧发现的目标，让下一帧 updatePlacementBehavior 切换到接战状态；
    // 本帧车体仍严格归当前关卡行为所有，炮塔瞄准/开火不受这一移动锁影响。
    if (movementSuppressed) return true
    const ranges = turretRangesForTarget(turrets, target, deps.turretDefById)
    const standing = computeAIStandingRange(ranges, ai.positioning)
    const availability = ai.movement === 'ram' ? ramAvailability(state, host, unit, target, dt) : 'available'
    const matchingTurrets = turrets.filter(item => item.hp > 0 && targetMatchesWeapon(deps.turretDefById(item.defId), target))
    // 炮塔索敌使用“炮位中心 → 目标中心”的实际距离；车体站位必须采用同一口径。
    // 若仍使用主体外沿净距离，载具会提前约一个车身半径停车，炮塔则因尚未进入射程而永远不开火。
    const weaponDistanceM = matchingTurrets.length > 0
      ? Math.min(...matchingTurrets.map(item => {
          const center = deps.turretCenter(item)
          return Math.hypot(target.x - center.x, target.y - center.y) * M_PER_CELL
        }))
      : target.centerDistance * M_PER_CELL
    const decision = aiRangeDecision(weaponDistanceM, standing, ai.movement, availability)
    const turret = matchingTurrets[0]
    const engagement = turret ? { target, turret, def: deps.turretDefById(turret.defId), decision } : null
    if (!engagement || !assistConstrainedHardpointAim(state, host, unit, engagement, dt)) {
      moveForDecision(state, host, unit, target, decision, ownerSide, distanceField, dt)
    }
    if ('mode' in host) {
      host.mode = decision === 'approach' || decision === 'ram' ? 'move' : 'attack'
      host.hasGoal = false
    }
    return true
  }

  function updateArmedAllyVehicleMovement(state: GameState, ally: Ally, unit: UnitDef, ai: UnitAI, dt: number, movementSuppressed = false): boolean {
    const turrets = ally.vehicle ? deps.ensureUnitVehicleTurrets(state, ally, unit) : []
    return updateVehicleMovement(state, ally, unit, ai, 'ally', turrets, undefined, dt, movementSuppressed)
  }

  function updateArmedEnemyVehicleMovement(state: GameState, enemy: Enemy, unit: UnitDef, ai: UnitAI, distanceField: number[], dt: number, movementSuppressed = false): boolean {
    const turrets = enemy.vehicle ? deps.ensureEnemyVehicleTurrets(state, enemy, unit) : []
    if (enemy.vehicle) deps.syncEnemyVehicleTurrets(enemy, unit)
    return updateVehicleMovement(state, enemy, unit, ai, 'enemy', turrets, distanceField, dt, movementSuppressed)
  }

  return { updateArmedAllyVehicleMovement, updateArmedEnemyVehicleMovement }
}
