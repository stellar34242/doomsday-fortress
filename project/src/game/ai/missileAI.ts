import { M_PER_CELL, type TurretDef } from '../config'
import { runtimeEnemyUnitDef } from '../unit'
import type { Enemy, EnemyProjectile, GameState, Projectile } from '../engine'
import type { LevelPlacedUnitFaction } from '../level'

const DEG = Math.PI / 180

function wrapAngle(angle: number): number {
  while (angle > Math.PI) angle -= Math.PI * 2
  while (angle < -Math.PI) angle += Math.PI * 2
  return angle
}

function bearing(dx: number, dy: number): number { return Math.atan2(dx, -dy) }

export const MISSILE_RETARGET_MARGIN = 0.9
export const MISSILE_WEAVE_FREQ = 0.8
export const MISSILE_WEAVE_MAX_ANGLE = 90

export type MissileSteeringRuntime = {
  x: number
  y: number
  heading: number
  speed: number
  guided?: boolean
  turnRate?: number
  tgtPX?: number
  tgtPY?: number
}

/** 玩家、友方与敌方导弹共用的前置量制导和转向加速度。 */
export function steerGuidedMissile(
  missile: MissileSteeringRuntime,
  target: { x: number; y: number } | null | undefined,
  dt: number,
  turnMaxDeg: number,
  turnAccelDeg: number,
): void {
  if (!missile.guided || !target || dt <= 0) return
  let aimX = target.x
  let aimY = target.y
  if (missile.tgtPX !== undefined && missile.tgtPY !== undefined) {
    const vx = (target.x - missile.tgtPX) / dt
    const vy = (target.y - missile.tgtPY) / dt
    const timeToHit = Math.min(2, Math.hypot(target.x - missile.x, target.y - missile.y) * M_PER_CELL / Math.max(missile.speed, 1))
    aimX += vx * timeToHit
    aimY += vy * timeToHit
  }
  missile.tgtPX = target.x
  missile.tgtPY = target.y
  const maxTurnRate = Math.max(0, turnMaxDeg) * DEG
  missile.turnRate = Math.min(maxTurnRate, Math.max(0, missile.turnRate ?? 0) + Math.max(0, turnAccelDeg) * DEG * dt)
  const delta = wrapAngle(bearing(aimX - missile.x, aimY - missile.y) - missile.heading)
  const turn = Math.min(Math.abs(delta), missile.turnRate * dt)
  missile.heading = wrapAngle(missile.heading + Math.sign(delta) * turn)
}

export function unitMissileTargetPoint(
  state: GameState,
  missile: EnemyProjectile,
  fortressCenter: (state: GameState) => { x: number; y: number },
): { x: number; y: number } | null {
  if (missile.targetKind === 'fortress') {
    return state.fortress.hp > 0 ? fortressCenter(state) : null
  }
  if (missile.targetKind === 'combatUnit') {
    if (missile.targetSide === 'enemy') {
      const enemy = state.enemies.find(item => item.id === missile.targetId && item.hp > 0)
      return enemy ? { x: enemy.x, y: enemy.y } : null
    }
    const ally = state.allies.find(item => item.id === missile.targetId && item.hp > 0)
    return ally ? { x: ally.x, y: ally.y } : null
  }
  if (missile.targetKind === 'coreBuilding') return state.core && state.core.id === missile.targetId && state.core.hp > 0
    ? { x: state.core.x + state.core.w / 2, y: state.core.y + state.core.h / 2 }
    : null
  if (missile.targetKind === 'fixedBuilding') {
    const building = state.buildings.find(item => item.id === missile.targetId && item.hp > 0)
    return building ? { x: building.x + building.w / 2, y: building.y + building.h / 2 } : null
  }
  if (missile.targetKind === 'wall') {
    const cell = state.walls.find(item => item.id === missile.targetId && item.state !== 'destroyed')?.cells[0]
    return cell ? { x: cell.x + 0.5, y: cell.y + 0.5 } : null
  }
  return null
}

export interface MissileRetargetDependencies {
  factionsHostile: (a: LevelPlacedUnitFaction, b: LevelPlacedUnitFaction) => boolean
  turretDefById: (id: string) => TurretDef
}

export function createMissileRetargetAI(deps: MissileRetargetDependencies) {
  function retargetUnitMissile(state: GameState, missile: EnemyProjectile): { x: number; y: number } | null {
    if (missile.targetKind !== 'combatUnit') return null
    const sourceFaction = missile.sourceFaction ?? ((missile.sourceSide ?? 'enemy') === 'ally' ? 'player' : 'enemy')
    const maxSpeed = Math.max(1, missile.missileMaxSpeed ?? (missile.defId ? deps.turretDefById(missile.defId).missileMaxSpeed : undefined) ?? missile.speed)
    const reachableM = missile.flightLeft === undefined ? Infinity : Math.max(0, missile.flightLeft) * maxSpeed * MISSILE_RETARGET_MARGIN
    const candidates: Array<{ id: number; side: 'ally' | 'enemy'; x: number; y: number; distanceM: number }> = []
    const consider = (id: number, side: 'ally' | 'enemy', faction: LevelPlacedUnitFaction, x: number, y: number) => {
      if (!deps.factionsHostile(sourceFaction, faction)) return
      const distanceM = Math.hypot(x - missile.x, y - missile.y) * M_PER_CELL
      if (distanceM > reachableM) return
      candidates.push({ id, side, x, y, distanceM })
    }
    for (const enemy of state.enemies) if (enemy.hp > 0) consider(enemy.id, 'enemy', enemy.faction ?? 'enemy', enemy.x, enemy.y)
    for (const ally of state.allies) if (ally.hp > 0) consider(ally.id, 'ally', ally.faction ?? 'ally', ally.x, ally.y)
    let best = candidates[0]
    for (let index = 1; index < candidates.length; index++) if (candidates[index].distanceM < best.distanceM) best = candidates[index]
    if (!best) return null
    missile.targetId = best.id
    missile.targetSide = best.side
    missile.targetX = best.x
    missile.targetY = best.y
    return { x: best.x, y: best.y }
  }

  return { retargetUnitMissile }
}

/** 玩家制导导弹丢失目标后的原有重选口径。 */
export function retargetPlayerMissile(state: GameState, missile: Projectile, def: TurretDef): Enemy | null {
  const candidates = state.enemies.filter(enemy => {
    if (enemy.hp <= 0) return false
    const air = runtimeEnemyUnitDef(enemy.unitDefId, enemy.kind).stats.air
    if (air && !def.canAir) return false
    if (!air && !def.canGround) return false
    return true
  })
  if (candidates.length === 0) return null
  const maxSpeed = (def.missileMaxSpeed ?? 0) || missile.speed || 1
  const reachable = missile.flightLeft === undefined
    ? candidates
    : candidates.filter(enemy => Math.hypot(enemy.x - missile.x, enemy.y - missile.y) * M_PER_CELL / maxSpeed <= missile.flightLeft! * MISSILE_RETARGET_MARGIN)
  const pool = reachable.length > 0 ? reachable : candidates
  let best = pool[0]
  let bestDistance = Infinity
  for (const enemy of pool) {
    const distance = Math.hypot(enemy.x - missile.x, enemy.y - missile.y)
    if (distance < bestDistance) { bestDistance = distance; best = enemy }
  }
  return best
}
