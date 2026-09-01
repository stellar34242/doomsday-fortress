import type { LevelPlacedUnitFaction, LevelUnitPlacement } from '../level'
import { runtimeAllyUnitDef, runtimeEnemyUnitDef, unitTypeConfig, type UnitDef } from '../unit'
import type { Ally, Enemy, GameState } from '../engine'
import { createNonCombatNavigator } from './nonCombatNavigation'

const DEG = Math.PI / 180
const TAU = Math.PI * 2

export type PlacementBehaviorHost = Pick<Enemy, 'id' | 'placementId' | 'targetId' | 'x' | 'y' | 'initialHeading' | 'flipX' | 'vehicle' | 'aircraft' | 'bossSizeScale' | 'behaviorHomeX' | 'behaviorHomeY' | 'behaviorTargetX' | 'behaviorTargetY' | 'behaviorWait' | 'behaviorStep' | 'behaviorRouteIndex' | 'behaviorActive' | 'behaviorEngaged' | 'behaviorReturning' | 'behaviorFacingHome' | 'behaviorLostTime' | 'retaliationSide' | 'retaliationId' | 'retaliationUntil' | 'behaviorOverride' | 'behaviorNavGoalKey' | 'behaviorNavTargetCellX' | 'behaviorNavTargetCellY' | 'behaviorNavPathVersion' | 'behaviorNavRefreshWait' | 'behaviorNavStuckTime' | 'behaviorNavLastX' | 'behaviorNavLastY' | 'behaviorNavLastHeading' | 'behaviorNavRepathSerial' | 'behaviorNavUnreachable'>
  & Partial<Pick<Enemy, 'targetKind' | 'mode' | 'hasGoal'>>

export type SightHost = Enemy | Ally

export interface NonCombatBehaviorDependencies {
  level: { cols: number; rows: number; initialUnits: LevelUnitPlacement[] }
  factionsHostile: (a: LevelPlacedUnitFaction, b: LevelPlacedUnitFaction) => boolean
  unitRadiusToward: (unit: UnitDef, dx: number, dy: number) => number
  wrapAngle: (angle: number) => number
  syncUnitVehicleTurrets: (host: Pick<Enemy, 'x' | 'y' | 'flipX' | 'vehicle'>, unit: UnitDef) => void
  fortressCenter: (state: GameState) => { x: number; y: number }
  fortressDistanceToPoint: (state: GameState, x: number, y: number) => number
  eventRandom: (eventId: number, stream?: number) => number
  vehicleObjectClearanceHeight: (config: ReturnType<typeof unitTypeConfig>) => number
  blockerAt: (state: GameState, x: number, y: number, objectClearanceHeight?: number) => { kind: string; id: number } | null
  moveEnemyFree: (state: GameState, enemy: Enemy, vx: number, vy: number, speed: number, dt: number) => void
  moveAllyToward: (state: GameState, ally: Ally, unit: UnitDef, x: number, y: number, speed: number, dt: number) => void
  moveEnemyVehicleToward: (state: GameState, enemy: Enemy, x: number, y: number, dt: number, speedScale?: number) => boolean
  moveToward: (state: GameState, enemy: Enemy, x: number, y: number, dt: number, ignoreBlockers?: boolean) => void
  moveUnitAircraftToward: (host: Enemy | Ally, unit: UnitDef, x: number, y: number, dt: number, speedScale?: number) => boolean
  moveUnitVehicleToward: (state: GameState, host: Enemy | Ally, unit: UnitDef, x: number, y: number, dt: number, speedScale?: number) => boolean
}

/** 跟随行为保持的单位外沿到玩家车体外沿距离（格）。 */
export const UNIT_FOLLOW_GAP = 2
/** 受击后锁定实际攻击者的最短记忆时间；远距离目标会按追入追踪范围所需时间自动延长。 */
export const UNIT_RETALIATION_MEMORY_SECONDS = 5
/** 给转身、加速、绕障和目标移动预留的追赶时间倍率。 */
const UNIT_RETALIATION_CHASE_TIME_FACTOR = 2

export interface UnitRetaliationTarget {
  side: 'fortress' | 'ally' | 'enemy'
  id: number
}

/**
 * 关卡行为控制器只负责战斗外巡逻、跟随、接近、脱战归位与编组视野。
 * 战斗执行仍由引擎提供的移动端口完成，因而迁移本身不改变碰撞或运动学。
 */
export function createNonCombatBehaviorAI(deps: NonCombatBehaviorDependencies) {
  const {
    level, factionsHostile, unitRadiusToward, wrapAngle, syncUnitVehicleTurrets,
    fortressCenter, fortressDistanceToPoint, eventRandom, vehicleObjectClearanceHeight,
    blockerAt, moveEnemyFree, moveAllyToward, moveEnemyVehicleToward, moveToward,
    moveUnitAircraftToward, moveUnitVehicleToward,
  } = deps
  const navigator = createNonCombatNavigator({ level, unitRadiusToward, vehicleObjectClearanceHeight, blockerAt })

  function placementBodyLocks(host: Pick<Enemy, 'placementId'> | Pick<Ally, 'placementId'>): { movement: boolean; rotation: boolean } {
    const placed = host.placementId === undefined ? undefined : level.initialUnits.find(item => item.id === host.placementId)
    return { movement: placed?.lockMovement === true, rotation: placed?.lockRotation === true }
  }

  /** 实例锁定只冻结车体，炮塔继续使用自己的角度、索敌与开火状态。 */
  function enforcePlacementBodyLocks(
    host: Enemy | Ally,
    unit: UnitDef,
    before: { x: number; y: number; vehicleHeading?: number; aircraftHeading?: number },
  ): void {
    const legacyLocks = placementBodyLocks(host)
    const locked = unit.bodyLocked === true || legacyLocks.movement || legacyLocks.rotation
    const locks = { movement: locked, rotation: locked }
    if (locks.movement) {
      host.x = before.x
      host.y = before.y
      if (host.vehicle) { host.vehicle.vx = 0; host.vehicle.vy = 0; host.vehicle.steerAngle = 0; host.vehicle.turnW = 0 }
      if (host.aircraft) { host.aircraft.vx = 0; host.aircraft.vy = 0 }
    }
    if (locks.rotation) {
      const heading = wrapAngle(host.initialHeading ?? before.vehicleHeading ?? before.aircraftHeading ?? 0)
      if (host.vehicle) { host.vehicle.heading = heading; host.vehicle.steerAngle = 0; host.vehicle.turnW = 0 }
      if (host.aircraft) host.aircraft.heading = heading
    }
    if ((locks.movement || locks.rotation) && host.vehicle) syncUnitVehicleTurrets(host, unit)
  }

  function engagePlacementBehavior(host: PlacementBehaviorHost): void {
    if (host.behaviorEngaged && !host.behaviorReturning) return
    host.behaviorEngaged = true
    host.behaviorReturning = false
    host.behaviorFacingHome = false
    host.behaviorLostTime = 0
    host.behaviorTargetX = undefined
    host.behaviorTargetY = undefined
    host.behaviorWait = 0
    host.behaviorActive = false
    navigator.reset(host)
  }

  function sightHostFaction(host: SightHost): LevelPlacedUnitFaction {
    return host.faction ?? ('mode' in host ? 'enemy' : 'ally')
  }

  function sightHostUnit(host: SightHost): UnitDef {
    return 'mode' in host
      ? runtimeEnemyUnitDef(host.unitDefId, host.kind)
      : runtimeAllyUnitDef(host.unitDefId, host.kind)
  }

  function sightRange(host: SightHost): number {
    return Math.max(0, sightHostUnit(host).stats.vision ?? 8)
  }

  function trackingRange(host: SightHost): number {
    const unit = sightHostUnit(host)
    const vision = Math.max(0, unit.stats.vision ?? 8)
    return Math.max(vision, unit.stats.trackingVision ?? vision * 1.5)
  }

  function alliedGroupMember(a: SightHost, b: SightHost): boolean {
    return !!a.group && a.group === b.group && !factionsHostile(sightHostFaction(a), sightHostFaction(b))
  }

  function placementGroupMembers(state: GameState, host: SightHost): SightHost[] {
    if (!host.group) return [host]
    const members: SightHost[] = []
    for (const member of state.enemies) if (member.hp > 0 && alliedGroupMember(host, member)) members.push(member)
    for (const member of state.allies) if (member.hp > 0 && alliedGroupMember(host, member)) members.push(member)
    return members.length > 0 ? members : [host]
  }

  function targetFaction(state: GameState, target: UnitRetaliationTarget): LevelPlacedUnitFaction | undefined {
    if (target.side === 'fortress') return state.fortress.hp > 0 && state.fortress.dyingT < 0 ? 'player' : undefined
    if (target.side === 'ally') {
      const ally = state.allies.find(item => item.id === target.id && item.hp > 0)
      return ally ? ally.faction ?? 'ally' : undefined
    }
    const enemy = state.enemies.find(item => item.id === target.id && item.hp > 0)
    return enemy ? enemy.faction ?? 'enemy' : undefined
  }

  function validRetaliationTarget(state: GameState, host: SightHost, target: UnitRetaliationTarget): boolean {
    const faction = targetFaction(state, target)
    return faction !== undefined && factionsHostile(sightHostFaction(host), faction)
  }

  function retaliationTargetPoint(state: GameState, target: UnitRetaliationTarget): { x: number; y: number } | null {
    if (target.side === 'fortress') return state.fortress.hp > 0 && state.fortress.dyingT < 0 ? fortressCenter(state) : null
    if (target.side === 'ally') {
      const ally = state.allies.find(item => item.id === target.id && item.hp > 0)
      return ally ? { x: ally.x, y: ally.y } : null
    }
    const enemy = state.enemies.find(item => item.id === target.id && item.hp > 0)
    return enemy ? { x: enemy.x, y: enemy.y } : null
  }

  function retaliationMemorySeconds(state: GameState, host: SightHost, target: UnitRetaliationTarget): number {
    const point = retaliationTargetPoint(state, target)
    if (!point) return UNIT_RETALIATION_MEMORY_SECONDS
    const unit = sightHostUnit(host)
    const dx = point.x - host.x, dy = point.y - host.y
    const edgeDistance = Math.max(0, Math.hypot(dx, dy) - unitRadiusToward(unit, dx, dy))
    const chaseDistance = Math.max(0, edgeDistance - trackingRange(host))
    const speed = Math.max(0, unit.stats.speed)
    if (chaseDistance <= 0 || speed <= 1e-6) return UNIT_RETALIATION_MEMORY_SECONDS
    return UNIT_RETALIATION_MEMORY_SECONDS + chaseDistance / speed * UNIT_RETALIATION_CHASE_TIME_FACTOR
  }

  function retaliationMatches(state: GameState, host: SightHost, target: UnitRetaliationTarget | undefined): boolean {
    if (!target) return false
    for (const member of placementGroupMembers(state, host)) {
      if ((member.retaliationUntil ?? -Infinity) <= state.time) continue
      if (member.retaliationSide !== target.side || member.retaliationId !== target.id) continue
      if (validRetaliationTarget(state, host, target)) return true
    }
    return false
  }

  function unitCanSeePoint(
    state: GameState,
    host: SightHost,
    x: number,
    y: number,
    target?: UnitRetaliationTarget,
  ): boolean {
    if (host.placementId === undefined) return true
    if (retaliationMatches(state, host, target)) return true
    if (host.behaviorReturning) return false
    const visibleFrom = (member: SightHost) => {
      if (member.hp <= 0) return false
      const dx = x - member.x, dy = y - member.y
      const edgeDistance = Math.max(0, Math.hypot(dx, dy) - unitRadiusToward(sightHostUnit(member), dx, dy))
      return edgeDistance <= (member.behaviorEngaged ? trackingRange(member) : sightRange(member))
    }
    if (visibleFrom(host)) return true
    if (!host.group) return false
    for (const member of state.enemies) if (member.id !== host.id && alliedGroupMember(host, member) && visibleFrom(member)) return true
    for (const member of state.allies) if (member.id !== host.id && alliedGroupMember(host, member) && visibleFrom(member)) return true
    return false
  }

  function engagePlacementGroup(state: GameState, host: SightHost, attacker?: UnitRetaliationTarget): void {
    const members = placementGroupMembers(state, host)
    const retaliation = attacker && validRetaliationTarget(state, host, attacker) ? attacker : undefined
    for (const member of members) {
      engagePlacementBehavior(member)
      if (!retaliation) continue
      member.retaliationSide = retaliation.side
      member.retaliationId = retaliation.id
      member.retaliationUntil = state.time + retaliationMemorySeconds(state, member, retaliation)
      member.targetId = retaliation.id
      member.combatTargetSide = retaliation.side
      if ('targetKind' in member) member.targetKind = retaliation.side === 'fortress' ? 'fortress' : 'combatUnit'
    }
  }

  function placementCombatTarget(state: GameState, host: PlacementBehaviorHost): ({ x: number; y: number } & Partial<UnitRetaliationTarget>) | null {
    if (host.targetId == null) return null
    const targetSide = (host as PlacementBehaviorHost & { combatTargetSide?: 'fortress' | 'ally' | 'enemy' }).combatTargetSide
    if (host.targetKind === 'fortress' || targetSide === 'fortress') return state.fortress.hp > 0 ? { ...fortressCenter(state), side: 'fortress', id: 0 } : null
    const enemy = targetSide === 'ally' ? undefined : state.enemies.find(item => item.id === host.targetId && item.hp > 0)
    if (enemy) return { x: enemy.x, y: enemy.y, side: 'enemy', id: enemy.id }
    const ally = targetSide === 'enemy' ? undefined : state.allies.find(item => item.id === host.targetId && item.hp > 0)
    if (ally) return { x: ally.x, y: ally.y, side: 'ally', id: ally.id }
    if (host.targetKind === 'coreBuilding' && state.core?.id === host.targetId && state.core.hp > 0) {
      return { x: state.core.x + state.core.w / 2, y: state.core.y + state.core.h / 2 }
    }
    if (host.targetKind === 'fixedBuilding') {
      const building = state.buildings.find(item => item.id === host.targetId && item.hp > 0)
      if (building) return { x: building.x + building.w / 2, y: building.y + building.h / 2 }
    }
    if (host.targetKind === 'turret') {
      const turret = state.turrets.find(item => item.id === host.targetId && item.hp > 0)
      if (turret) return { x: turret.x + turret.w / 2, y: turret.y + turret.h / 2 }
    }
    if (host.targetKind === 'wall') {
      const cell = state.walls.find(item => item.id === host.targetId && item.state !== 'destroyed')?.cells[0]
      if (cell) return { x: cell.x + 0.5, y: cell.y + 0.5 }
    }
    if (host.targetKind === 'object') {
      const object = state.objects.find(item => item.id === host.targetId && item.hp !== 0)
      if (object) return { x: object.x + object.w / 2, y: object.y + object.h / 2 }
    }
    return null
  }

  function placementGroupHasVisibleCombatTarget(state: GameState, host: SightHost): boolean {
    for (const member of placementGroupMembers(state, host)) {
      const target = placementCombatTarget(state, member)
      const retaliationTarget = target?.side !== undefined && target.id !== undefined ? { side: target.side, id: target.id } : undefined
      if (target && unitCanSeePoint(state, host, target.x, target.y, retaliationTarget)) return true
    }
    return false
  }

  function resetPlacementGroupLostTime(state: GameState, host: SightHost): void {
    for (const member of placementGroupMembers(state, host)) member.behaviorLostTime = 0
  }

  function behaviorReturnsHome(behavior: NonNullable<LevelUnitPlacement['behavior']>): boolean {
    return behavior === 'guard' || behavior === 'random' || behavior === 'route' || behavior === 'approach'
  }

  function clearPlacementCombatTarget(host: PlacementBehaviorHost): void {
    host.targetId = null
    ;(host as PlacementBehaviorHost & { combatTargetSide?: 'fortress' | 'ally' | 'enemy' }).combatTargetSide = undefined
    if (host.targetKind !== undefined) host.targetKind = null
    if (host.mode !== undefined) host.mode = 'move'
    if (host.hasGoal !== undefined) host.hasGoal = false
  }

  function clearRetaliation(host: PlacementBehaviorHost): void {
    host.retaliationSide = undefined
    host.retaliationId = undefined
    host.retaliationUntil = undefined
  }

  function disengagePlacementBehavior(host: PlacementBehaviorHost, behavior: NonNullable<LevelUnitPlacement['behavior']>): void {
    host.behaviorEngaged = false
    host.behaviorLostTime = 0
    host.behaviorReturning = behaviorReturnsHome(behavior)
    host.behaviorFacingHome = false
    host.behaviorTargetX = undefined
    host.behaviorTargetY = undefined
    host.behaviorWait = 0
    host.behaviorActive = false
    navigator.reset(host)
    clearPlacementCombatTarget(host)
    clearRetaliation(host)
    if (behavior === 'static') {
      host.behaviorHomeX = host.x
      host.behaviorHomeY = host.y
    }
  }

  function placementBehaviorOf(host: PlacementBehaviorHost): NonNullable<LevelUnitPlacement['behavior']> | undefined {
    const placed = host.placementId === undefined ? undefined : level.initialUnits.find(item => item.id === host.placementId)
    return (host.behaviorOverride ?? placed)?.behavior
  }

  function disengagePlacementGroup(state: GameState, host: SightHost): void {
    for (const member of placementGroupMembers(state, host)) {
      const behavior = placementBehaviorOf(member)
      if (behavior) disengagePlacementBehavior(member, behavior)
      else {
        member.behaviorEngaged = false
        member.behaviorLostTime = 0
        clearPlacementCombatTarget(member)
        clearRetaliation(member)
      }
    }
  }

  function stopPlacementBehavior(host: PlacementBehaviorHost, unit: UnitDef, anchorX = host.x, anchorY = host.y): void {
    if (host.vehicle) {
      host.vehicle.vx = 0
      host.vehicle.vy = 0
      host.vehicle.turnW = 0
    }
    if (host.aircraft) {
      const config = unitTypeConfig(unit)
      if (config?.kind === 'fixedWingAircraft') {
        host.aircraft.holdX = anchorX
        host.aircraft.holdY = anchorY
      } else {
        host.aircraft.vx = 0
        host.aircraft.vy = 0
      }
    }
  }

  function restorePlacementHomeHeading(host: PlacementBehaviorHost, unit: UnitDef, placed: LevelUnitPlacement | undefined): void {
    const heading = wrapAngle(host.initialHeading ?? (placed?.rotation ?? 0) * DEG)
    const fixedWing = unitTypeConfig(unit)?.kind === 'fixedWingAircraft'
    host.initialHeading = heading
    host.behaviorFacingHome = !fixedWing
    if (host.vehicle && !fixedWing) {
      host.vehicle.heading = heading
      host.vehicle.vx = 0
      host.vehicle.vy = 0
      host.vehicle.steerAngle = 0
      host.vehicle.turnW = 0
      syncUnitVehicleTurrets(host, unit)
    }
    if (host.aircraft && !fixedWing) {
      host.aircraft.heading = heading
      host.aircraft.vx = 0
      host.aircraft.vy = 0
    }
  }

  function unitArrivalTolerance(unit: UnitDef, baseTolerance: number): number {
    const config = unitTypeConfig(unit)
    return config?.kind === 'fixedWingAircraft'
      ? Math.max(baseTolerance, config.turnRadius * 1.25)
      : baseTolerance
  }

  function updatePlacementBehavior(
    state: GameState,
    host: PlacementBehaviorHost,
    unit: UnitDef,
    side: 'ally' | 'enemy',
    dt: number,
    movementLocked = false,
  ): boolean {
    const placed = host.placementId === undefined ? undefined : level.initialUnits.find(item => item.id === host.placementId)
    const config = host.behaviorOverride ?? placed
    if (!config?.behavior) return false
    const behavior = config.behavior
    if (behavior !== 'guard') host.behaviorFacingHome = false
    const speed = Math.max(0, unit.stats.speed * Math.max(0, Math.min(100, 'speedPercent' in config ? config.speedPercent : config.behaviorSpeedPercent ?? 100)) / 100)
    const moveDirect = (x: number, y: number) => {
      if (side === 'enemy') moveEnemyFree(state, host as Enemy, x - host.x, y - host.y, speed, dt)
      else moveAllyToward(state, host as Ally, unit, x, y, speed, dt)
    }
    const move = (x: number, y: number, goalKey: string) => {
      const waypoint = navigator.waypoint(state, host, unit, x, y, goalKey, dt, speed)
      if (!waypoint) {
        stopPlacementBehavior(host, unit, host.x, host.y)
        return false
      }
      moveDirect(waypoint.x, waypoint.y)
      return true
    }
    host.behaviorHomeX ??= placed?.x ?? host.x
    host.behaviorHomeY ??= placed?.y ?? host.y

    const combatTarget = placementCombatTarget(state, host)
    const retaliationTarget = combatTarget?.side !== undefined && combatTarget.id !== undefined
      ? { side: combatTarget.side, id: combatTarget.id }
      : undefined
    if (combatTarget && unitCanSeePoint(state, host as SightHost, combatTarget.x, combatTarget.y, retaliationTarget)) {
      engagePlacementBehavior(host)
      resetPlacementGroupLostTime(state, host as SightHost)
    } else if (host.behaviorEngaged) {
      if (placementGroupHasVisibleCombatTarget(state, host as SightHost)) resetPlacementGroupLostTime(state, host as SightHost)
      else {
        host.behaviorLostTime = (host.behaviorLostTime ?? 0) + dt
        if (host.behaviorLostTime >= 0.25) disengagePlacementGroup(state, host as SightHost)
      }
    }
    if (host.behaviorEngaged) return false

    // “锁定单位”只禁止主体平移/转向，不得跳过放置实例的接战状态机。
    // 否则固定火力单位开火后会永久停留在 trackingVision 状态，且失去目标后无法统一脱战。
    if (movementLocked) {
      stopPlacementBehavior(host, unit, host.x, host.y)
      navigator.reset(host)
      return true
    }

    const tolerance = unitArrivalTolerance(unit, Math.max(0.08, speed * dt * 1.2))
    if (host.behaviorReturning) {
      const homeDistance = Math.hypot(host.behaviorHomeX - host.x, host.behaviorHomeY - host.y)
      if (homeDistance <= tolerance || speed <= 0) {
        host.behaviorReturning = false
        host.behaviorRouteIndex = 0
        host.behaviorStep = 0
        host.behaviorWait = 0
        stopPlacementBehavior(host, unit, host.behaviorHomeX, host.behaviorHomeY)
        navigator.reset(host)
        if (behavior === 'guard') restorePlacementHomeHeading(host, unit, placed)
      } else move(host.behaviorHomeX, host.behaviorHomeY, 'return-home')
      return true
    }

    if (behavior === 'static' || behavior === 'guard' || speed <= 0) {
      stopPlacementBehavior(host, unit, behavior === 'static' ? host.x : host.behaviorHomeX, behavior === 'static' ? host.y : host.behaviorHomeY)
      navigator.reset(host)
      return true
    }

    host.behaviorWait = Math.max(0, (host.behaviorWait ?? 0) - dt)
    if (behavior === 'random') {
      const targetDistance = host.behaviorTargetX === undefined || host.behaviorTargetY === undefined
        ? 0 : Math.hypot(host.behaviorTargetX - host.x, host.behaviorTargetY - host.y)
      if (targetDistance <= tolerance) {
        host.behaviorTargetX = undefined
        host.behaviorTargetY = undefined
        navigator.reset(host)
        if (targetDistance > 0) host.behaviorWait = 'interval' in config ? config.interval : config.behaviorInterval ?? 3
      }
      if (host.behaviorTargetX === undefined && host.behaviorWait <= 0) {
        const range = Math.max(0, 'range' in config ? config.range : config.behaviorRange ?? 6)
        const step = host.behaviorStep ?? 0
        for (let attempt = 0; attempt < 8; attempt++) {
          const stream = step * 17 + attempt * 2
          const angle = eventRandom(placed?.id ?? host.id, stream) * TAU
          const distance = range * (0.2 + eventRandom(placed?.id ?? host.id, stream + 1) * 0.3)
          const x = Math.max(0.5, Math.min(level.cols - 0.5, host.behaviorHomeX + Math.cos(angle) * distance))
          const y = Math.max(0.5, Math.min(level.rows - 0.5, host.behaviorHomeY + Math.sin(angle) * distance))
          if (navigator.isReachable(state, host, unit, host.x, host.y, x, y)) { host.behaviorTargetX = x; host.behaviorTargetY = y; break }
        }
        host.behaviorStep = step + 1
        if (host.behaviorTargetX === undefined) host.behaviorWait = 'interval' in config ? config.interval : config.behaviorInterval ?? 3
      }
      if (host.behaviorTargetX !== undefined && host.behaviorTargetY !== undefined) move(host.behaviorTargetX, host.behaviorTargetY, `random:${host.behaviorStep ?? 0}`)
      else { stopPlacementBehavior(host, unit); navigator.reset(host) }
      return true
    }

    if (behavior === 'route') {
      const route = placed?.route ?? []
      if (route.length === 0 || host.behaviorWait > 0) { stopPlacementBehavior(host, unit, host.behaviorHomeX, host.behaviorHomeY); navigator.reset(host); return true }
      host.behaviorRouteIndex = Math.max(0, Math.min(route.length - 1, host.behaviorRouteIndex ?? 0))
      const target = route[host.behaviorRouteIndex]
      if (Math.hypot(target.x - host.x, target.y - host.y) <= tolerance) {
        if (host.behaviorRouteIndex >= route.length - 1) {
          host.behaviorRouteIndex = 0
          host.behaviorWait = 'interval' in config ? config.interval : config.behaviorInterval ?? 1
        } else host.behaviorRouteIndex++
        stopPlacementBehavior(host, unit, target.x, target.y)
        navigator.reset(host)
      } else move(target.x, target.y, `route:${host.behaviorRouteIndex}`)
      return true
    }

    if (behavior === 'follow') {
      const player = fortressCenter(state)
      const distance = fortressDistanceToPoint(state, host.x, host.y)
      const unitRadius = unitRadiusToward(unit, player.x - host.x, player.y - host.y)
      const followGap = Math.max(0, 'range' in config ? config.range : config.behaviorRange ?? UNIT_FOLLOW_GAP)
      if (distance - unitRadius > followGap + tolerance) move(player.x, player.y, 'follow-player')
      else { stopPlacementBehavior(host, unit, player.x, player.y); navigator.reset(host) }
      return true
    }

    const triggerRange = Math.max(0, 'range' in config ? config.range : config.behaviorRange ?? 8)
    const player = fortressCenter(state)
    const distance = fortressDistanceToPoint(state, host.x, host.y)
    if (!host.behaviorActive && distance <= triggerRange) host.behaviorActive = true
    if (host.behaviorActive) {
      const contactDistance = unitRadiusToward(unit, player.x - host.x, player.y - host.y)
      if (distance <= contactDistance + 0.03) {
        host.behaviorActive = false
        stopPlacementBehavior(host, unit, player.x, player.y)
        navigator.reset(host)
      } else move(player.x, player.y, 'approach-player')
    } else { stopPlacementBehavior(host, unit, host.behaviorHomeX, host.behaviorHomeY); navigator.reset(host) }
    return true
  }

  function updateAllyFollowPlayer(state: GameState, ally: Ally, unit: UnitDef, dt: number): void {
    const player = fortressCenter(state)
    const dx = player.x - ally.x, dy = player.y - ally.y
    const gap = Math.max(0, fortressDistanceToPoint(state, ally.x, ally.y) - unitRadiusToward(unit, dx, dy))
    if (gap > UNIT_FOLLOW_GAP + 0.05) {
      const speed = Math.min(unit.stats.speed, (gap - UNIT_FOLLOW_GAP) / Math.max(dt, 1e-6))
      moveAllyToward(state, ally, unit, player.x, player.y, speed, dt)
    } else if (!moveUnitAircraftToward(ally, unit, ally.x, ally.y, dt, 0) && ally.vehicle) moveUnitVehicleToward(state, ally, unit, ally.x, ally.y, dt, 0)
  }

  function updateEnemyFollowPlayer(state: GameState, enemy: Enemy, unit: UnitDef, dt: number): void {
    const player = fortressCenter(state)
    const dx = player.x - enemy.x, dy = player.y - enemy.y
    const gap = Math.max(0, fortressDistanceToPoint(state, enemy.x, enemy.y) - unitRadiusToward(unit, dx, dy))
    enemy.mode = 'move'
    enemy.hasGoal = false
    if (gap > UNIT_FOLLOW_GAP + 0.05) {
      const speedScale = Math.min(1, (gap - UNIT_FOLLOW_GAP) / Math.max(dt * unit.stats.speed, 1e-6))
      if (!moveEnemyVehicleToward(state, enemy, player.x, player.y, dt, speedScale)) moveToward(state, enemy, player.x, player.y, dt, unit.stats.air)
    } else if (!moveUnitAircraftToward(enemy, unit, enemy.x, enemy.y, dt, 0) && enemy.vehicle) moveUnitVehicleToward(state, enemy, unit, enemy.x, enemy.y, dt, 0)
  }

  return {
    placementBodyLocks,
    enforcePlacementBodyLocks,
    unitCanSeePoint,
    engagePlacementGroup,
    updatePlacementBehavior,
    unitArrivalTolerance,
    updateAllyFollowPlayer,
    updateEnemyFollowPlayer,
    nonCombatNavigationStats: navigator.stats,
  }
}
