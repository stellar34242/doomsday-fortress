import { M_PER_CELL, type Hardpoint, type TurretDef, type TurretTag } from '../config'
import { runtimeAllyUnitDef, runtimeEnemyUnitDef, unitCollisionRadii, type UnitAI, type UnitDef } from '../unit'
import type {
  Ally,
  Enemy,
  EnemyProjectile,
  GameState,
  InterceptableMissileTarget,
  MissilePool,
  Turret,
} from '../engine'
import type { LevelPlacedUnitFaction } from '../level'
import { clampToHardpointArc, hardpointArcContains, hardpointArcMid } from './turretGeometry'

const DEG = Math.PI / 180

export interface MountedTurretTarget {
  kind: NonNullable<EnemyProjectile['targetKind']> | 'missile'
  targetType?: 'missile'
  pool?: MissilePool
  id: number
  x: number
  y: number
  side?: 'ally' | 'enemy'
  air: boolean
  altitude: number
  distanceM: number
  vx?: number
  vy?: number
  faction?: LevelPlacedUnitFaction
  hp?: number
  maxHp?: number
  ammoId?: string
}

export type PlayerTurretTarget = Enemy | InterceptableMissileTarget
export interface TurretAimResult { target: PlayerTurretTarget | null; desired: number; canFire: boolean }

export function isInterceptableMissileTarget(
  target: PlayerTurretTarget | MountedTurretTarget,
): target is InterceptableMissileTarget {
  return 'targetType' in target && target.targetType === 'missile'
}

interface SpatialUnitCandidate {
  enemy?: Enemy
  ally?: Ally
}

type TurretOwner = Pick<Enemy | Ally, 'x' | 'y' | 'vehicle'>

export interface TurretAIDependencies {
  turretCenter: (turret: Turret) => { x: number; y: number }
  interceptableMissileTargets: (state: GameState, faction: LevelPlacedUnitFaction) => InterceptableMissileTarget[]
  factionsHostile: (a: LevelPlacedUnitFaction, b: LevelPlacedUnitFaction) => boolean
  unitCanSeePoint: (state: GameState, host: Enemy | Ally, x: number, y: number, target?: { side: 'fortress' | 'ally' | 'enemy'; id: number }) => boolean
  fortressCenter: (state: GameState) => { x: number; y: number }
  querySpatialUnits: (state: GameState, minX: number, minY: number, maxX: number, maxY: number, side: 'enemy' | 'ally') => SpatialUnitCandidate[]
  currentUnitAltitude: (host: { aircraft?: Enemy['aircraft'] }, unit: UnitDef) => number
  interceptLeadPoint: (origin: { x: number; y: number }, target: InterceptableMissileTarget, projectileSpeedMps: number) => { x: number; y: number }
  bearing: (dx: number, dy: number) => number
  wrapAngle: (angle: number) => number
  distToFortress: (state: GameState, enemy: Enemy) => number
  turretRangeBonus: (state: GameState) => number
  hardpointOf: (state: GameState, id: string) => Hardpoint | undefined
  getLastDt: () => number
}

/** 阵营无关的车载炮塔感知、候选评分与炮位瞄准。 */
export function createTurretAI(deps: TurretAIDependencies) {
  const {
    turretCenter, interceptableMissileTargets, factionsHostile, unitCanSeePoint,
    fortressCenter, querySpatialUnits, currentUnitAltitude, interceptLeadPoint, bearing, wrapAngle,
    distToFortress, turretRangeBonus, hardpointOf, getLastDt,
  } = deps

  function mountedTurretTarget(
    state: GameState,
    turret: Turret,
    def: TurretDef,
    ai: UnitAI,
    ownerSide: 'ally' | 'enemy' = 'enemy',
  ): MountedTurretTarget | null {
    const center = turretCenter(turret)
    const ownerEnemy = ownerSide === 'enemy' ? state.enemies.find(enemy => enemy.vehicle?.turrets?.some(item => item.id === turret.id)) : undefined
    const ownerAlly = ownerSide === 'ally' ? state.allies.find(ally => ally.vehicle?.turrets?.some(item => item.id === turret.id)) : undefined
    const ownerFaction: LevelPlacedUnitFaction = ownerEnemy?.faction ?? ownerAlly?.faction ?? (ownerSide === 'enemy' ? 'enemy' : 'ally')
    let best: MountedTurretTarget | null = null
    let bestScore = Infinity
    const preferredTier = (candidate: Omit<MountedTurretTarget, 'distanceM'>): number => {
      if (candidate.targetType === 'missile') return def.tags?.some(tag => tag.kind === 'prefer' && tag.key === 'missile') ? 0 : 3
      const side = candidate.kind === 'fortress' ? 'fortress' : candidate.side
      const primary = (ownerEnemy ?? ownerAlly)?.combatTargetSide === side && (ownerEnemy ?? ownerAlly)?.targetId === candidate.id
      if (primary) return 0
      if (ai.preferredTarget === 'allHostile') return 1
      if (ai.preferredTarget === 'playerControlled') return side === 'fortress' ? 1 : 2
      return side === 'fortress' || candidate.faction === 'player' ? 1 : 2
    }
    const consider = (candidate: Omit<MountedTurretTarget, 'distanceM'>) => {
      const missile = candidate.targetType === 'missile'
      if (missile) {
        if (!def.canInterceptMissile || (def.type !== 'direct' && def.type !== 'beam')) return
        if (def.tags?.some(tag => tag.kind === 'exclude' && tag.key === 'missile')) return
      } else {
        if (candidate.air ? !def.canAir : !def.canGround) return
        const owner = ownerEnemy ?? ownerAlly
        const targetSide = candidate.kind === 'fortress' ? 'fortress' : candidate.side
        if (owner && targetSide && !unitCanSeePoint(state, owner, candidate.x, candidate.y, { side: targetSide, id: candidate.id })) return
      }
      const distanceM = Math.hypot(candidate.x - center.x, candidate.y - center.y) * M_PER_CELL
      if (distanceM < def.rangeMin || distanceM > def.rangeMax) return
      const score = preferredTier(candidate) * 1_000_000 + distanceM
      if (!best || score < bestScore) { best = { ...candidate, distanceM }; bestScore = score }
    }
    if (def.canInterceptMissile && (def.type === 'direct' || def.type === 'beam')) {
      for (const missile of interceptableMissileTargets(state, ownerFaction)) consider({ ...missile, kind: 'missile', air: true })
    }
    if (factionsHostile(ownerFaction, 'player') && state.fortress.hp > 0 && state.fortress.dyingT < 0) {
      const point = fortressCenter(state)
      consider({ kind: 'fortress', id: 0, x: point.x, y: point.y, air: false, altitude: 0, faction: 'player' })
    }
    const rangeCells = def.rangeMax / M_PER_CELL
    for (const ref of querySpatialUnits(state, center.x - rangeCells, center.y - rangeCells, center.x + rangeCells, center.y + rangeCells, 'ally')) {
      const ally = ref.ally!
      const faction = ally.faction ?? 'ally'
      if (ally === ownerAlly || ally.hp <= 0 || !factionsHostile(ownerFaction, faction)) continue
      const unit = runtimeAllyUnitDef(ally.unitDefId, ally.kind)
      consider({ kind: 'combatUnit', id: ally.id, x: ally.x, y: ally.y, side: 'ally', air: unit.stats.air, altitude: currentUnitAltitude(ally, unit), faction })
    }
    for (const ref of querySpatialUnits(state, center.x - rangeCells, center.y - rangeCells, center.x + rangeCells, center.y + rangeCells, 'enemy')) {
      const enemy = ref.enemy!
      const faction = enemy.faction ?? 'enemy'
      if (enemy === ownerEnemy || enemy.hp <= 0 || faction === 'neutralHostile' || !factionsHostile(ownerFaction, faction)) continue
      const unit = runtimeEnemyUnitDef(enemy.unitDefId, enemy.kind)
      consider({ kind: 'combatUnit', id: enemy.id, x: enemy.x, y: enemy.y, side: 'enemy', air: unit.stats.air, altitude: currentUnitAltitude(enemy, unit), faction })
    }
    return best
  }

  function aimMountedTurret(
    state: GameState,
    host: TurretOwner,
    turret: Turret,
    hardpoint: Hardpoint,
    ai: UnitAI,
    def: TurretDef,
    dt: number,
    ownerSide: 'ally' | 'enemy' = 'enemy',
  ): { target: MountedTurretTarget | null; canFire: boolean } {
    const target = mountedTurretTarget(state, turret, def, ai, ownerSide)
    const base = host.vehicle?.heading ?? 0
    const rest = wrapAngle(base + (hardpoint.fixed !== undefined ? hardpoint.fixed * DEG : hardpoint.arc ? hardpointArcMid(hardpoint.arc) : 0))
    if (!target) {
      turret.targetId = null
      turret.targetMissilePool = undefined
      const difference = wrapAngle(rest - turret.angle)
      const step = Math.min(Math.abs(difference), Math.max(0, def.rotateSpeed) * DEG * dt)
      turret.angle = wrapAngle(turret.angle + Math.sign(difference) * step)
      return { target: null, canFire: false }
    }
    const center = turretCenter(turret)
    const targetPoint = target.targetType === 'missile' && def.type === 'direct'
      ? interceptLeadPoint(center, target as InterceptableMissileTarget, def.projectileSpeed ?? 25.6)
      : target
    const bearingToTarget = bearing(targetPoint.x - center.x, targetPoint.y - center.y)
    turret.targetId = target.id
    turret.targetMissilePool = target.targetType === 'missile' ? target.pool : undefined
    let desired = bearingToTarget
    let inArc = true
    if (hardpoint.fixed !== undefined) desired = wrapAngle(base + hardpoint.fixed * DEG)
    else if (hardpoint.arc) {
      const relative = wrapAngle(bearingToTarget - base)
      inArc = hardpointArcContains(hardpoint.arc, relative)
      desired = wrapAngle(base + clampToHardpointArc(hardpoint.arc, relative))
    }
    const difference = wrapAngle(desired - turret.angle)
    const step = Math.min(Math.abs(difference), Math.max(0, def.rotateSpeed) * DEG * dt)
    turret.angle = wrapAngle(turret.angle + Math.sign(difference) * step)
    const cone = Math.max(4, def.aimCone / 2) * DEG
    const canFire = inArc && Math.abs(wrapAngle(bearingToTarget - turret.angle)) <= cone + 1e-9
    return { target, canFire }
  }

  function playerAimBase(state: GameState, turret: Turret): number {
    return turret.hardpointId ? state.fortress.heading : 0
  }

  function playerAimRestAngle(state: GameState, turret: Turret): number {
    const base = playerAimBase(state, turret)
    const hardpoint = turret.hardpointId ? hardpointOf(state, turret.hardpointId) : undefined
    if (hardpoint?.fixed !== undefined) return wrapAngle(base + hardpoint.fixed * DEG)
    if (hardpoint?.arc) return wrapAngle(base + hardpointArcMid(hardpoint.arc))
    return base
  }

  function playerTargetScore(state: GameState, center: { x: number; y: number }, enemy: Enemy, def: TurretDef): number {
    const unit = runtimeEnemyUnitDef(enemy.unitDefId, enemy.kind)
    const air = unit.stats.air
    const size = Math.max(unitCollisionRadii(unit).x, unitCollisionRadii(unit).y) * (enemy.bossSizeScale ?? 1)
    const prefers = def.tags?.filter((tag): tag is Extract<TurretTag, { kind: 'prefer' }> => tag.kind === 'prefer')
    const nearTurret = prefers?.some(preference => preference.key === 'nearTurret')
    let score = nearTurret ? Math.hypot(enemy.x - center.x, enemy.y - center.y) : distToFortress(state, enemy)
    if (!prefers?.some(preference => preference.key === 'air' || preference.key === 'ground') && air) score *= 0.5
    if (prefers) {
      for (const preference of prefers) {
        switch (preference.key) {
          case 'air': if (air) score *= 0.5; break
          case 'ground': if (!air) score *= 0.5; break
          case 'hpMax': score *= 1 / (1 + enemy.hp / 100); break
          case 'hpMin': score *= 1 + enemy.hp / 100; break
          case 'sizeBig': score *= 1 / (1 + size / 0.35); break
          case 'sizeSmall': score *= 1 + size / 0.35; break
        }
      }
    }
    return score
  }

  function aimPlayerTurret(state: GameState, turret: Turret, def: TurretDef, factor: number): TurretAimResult {
    const center = turretCenter(turret)
    const minRange = def.rangeMin
    const maxRange = def.rangeMax * (1 + turretRangeBonus(state))
    const excludes = def.tags?.filter((tag): tag is Extract<TurretTag, { kind: 'exclude' }> => tag.kind === 'exclude')
    let best: PlayerTurretTarget | null = null
    let bestScore = Infinity
    const rangeCells = maxRange / M_PER_CELL
    for (const ref of querySpatialUnits(state, center.x - rangeCells, center.y - rangeCells, center.x + rangeCells, center.y + rangeCells, 'enemy')) {
      const enemy = ref.enemy!
      if (enemy.hp <= 0) continue
      // 玩家直接控制的载具只受炮塔射程限制，不受单位视野限制。
      const air = runtimeEnemyUnitDef(enemy.unitDefId, enemy.kind).stats.air
      if (air ? !def.canAir : !def.canGround) continue
      if (excludes) {
        if (air && excludes.some(tag => tag.key === 'air')) continue
        if (!air && excludes.some(tag => tag.key === 'ground')) continue
      }
      const distanceM = Math.hypot(enemy.x - center.x, enemy.y - center.y) * M_PER_CELL
      if (distanceM < minRange || distanceM > maxRange) continue
      const score = playerTargetScore(state, center, enemy, def)
      if (score < bestScore) { bestScore = score; best = enemy }
    }
    const supportsInterception = def.canInterceptMissile === true && (def.type === 'direct' || def.type === 'beam')
    if (supportsInterception && !excludes?.some(tag => tag.key === 'missile')) {
      const prefersMissiles = def.tags?.some(tag => tag.kind === 'prefer' && tag.key === 'missile') ?? false
      const prefersNearTurret = def.tags?.some(tag => tag.kind === 'prefer' && tag.key === 'nearTurret') ?? false
      const fortress = fortressCenter(state)
      for (const missile of interceptableMissileTargets(state, 'player')) {
        const distanceM = Math.hypot(missile.x - center.x, missile.y - center.y) * M_PER_CELL
        if (distanceM < minRange || distanceM > maxRange) continue
        let score = prefersNearTurret
          ? Math.hypot(missile.x - center.x, missile.y - center.y)
          : Math.hypot(missile.x - fortress.x, missile.y - fortress.y)
        if (prefersMissiles) score *= 0.2
        if (score < bestScore) { bestScore = score; best = missile }
      }
    }
    if (!best) {
      const rest = playerAimRestAngle(state, turret)
      const rotation = def.rotateSpeed * factor * DEG
      const difference = wrapAngle(rest - turret.angle)
      const step = Math.min(Math.abs(difference), rotation * getLastDt())
      turret.angle = wrapAngle(turret.angle + Math.sign(difference) * step)
      turret.targetId = null
      turret.targetMissilePool = undefined
      return { target: null, desired: rest, canFire: false }
    }
    const aimPoint = isInterceptableMissileTarget(best) && def.type === 'direct'
      ? interceptLeadPoint(center, best, def.projectileSpeed ?? 25.6)
      : best
    const targetBearing = bearing(aimPoint.x - center.x, aimPoint.y - center.y)
    turret.targetId = best.id
    turret.targetMissilePool = isInterceptableMissileTarget(best) ? best.pool : undefined
    const base = playerAimBase(state, turret)
    const hardpoint = turret.hardpointId ? hardpointOf(state, turret.hardpointId) : undefined
    const cone = Math.max((def.aimCone / 2) * DEG, 4 * DEG)
    let clampedRelative: number
    let inArc: boolean
    if (hardpoint?.fixed !== undefined) {
      clampedRelative = hardpoint.fixed * DEG
      inArc = true
    } else if (hardpoint?.arc) {
      inArc = hardpointArcContains(hardpoint.arc, wrapAngle(targetBearing - base))
      clampedRelative = clampToHardpointArc(hardpoint.arc, wrapAngle(targetBearing - base))
    } else {
      clampedRelative = wrapAngle(targetBearing - base)
      inArc = true
    }
    const clamped = wrapAngle(base + clampedRelative)
    const rotation = def.rotateSpeed * factor * DEG
    const difference = wrapAngle(clamped - turret.angle)
    if (Math.abs(difference) > cone) {
      const step = Math.min(Math.abs(difference) - cone, rotation * getLastDt())
      turret.angle = wrapAngle(turret.angle + Math.sign(difference) * step)
    }
    const aligned = Math.abs(wrapAngle(targetBearing - turret.angle)) <= cone + 1e-9
    return { target: best, desired: targetBearing, canFire: inArc && aligned }
  }

  return { mountedTurretTarget, aimMountedTurret, aimPlayerTurret, playerAimRestAngle }
}
