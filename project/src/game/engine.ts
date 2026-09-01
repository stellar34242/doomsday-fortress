// 废土防线 · 纯逻辑引擎
// 实现《战场空间设计文档》（网格/墙段/建造/寻路/目标优先级）与
// 《炮塔系统属性文档 v1.1》（5 类武器、属性计算规则）。
// 不依赖 DOM，可被 esbuild 打包后在 node 中做无头模拟。
import {
  AMMO, CORE, FLASH_DURATION, OVERHEAT_RESUME,
  DEFAULT_FORTRESS, ENERGY, M_PER_CELL,
  BOUNTY_MULT, MODULE_DEFS, PREP_TIME, SPAWN_ROWS, START_GOLD,
  PROJECTILE_ARTS, SPECIAL_MULT, TURRET_DEFS, WALL_BUILD_COST, WALL_HP,
  levelScale, m2c, missileVerticalLaunchActive, projectileDrivenTurret, resolveUnitDestructionEffect, turretAmmoCapacity, turretAmmoExchangeRate, turretEnergyCapacity, turretFireSoundRole, upgradeCost, verticalLaunchDuration, waveHpScale, TURN_COAST_TAU, BASE_CELL } from './config'
import type { AllyKind, BattleObject, DirectProjectileSubtype, EnemyKind, FixedBuilding, FortressArmor, FortressDef, Hardpoint, ModuleDef, ProjectileArtDef, ResourceTagKey, SpecialBoost, TrackDef, TurretDef, TurretFireSoundRole, UnitDestructionEffect, WheelDef } from './config'
import { getSelectedFortressId } from './persist'
import { gameParameters } from './gameParameters'
import { normalizeCombatVehicleLoadout, normalizeCombatVehicleLoadoutForDef, normalizeVehicleLoadout, selectedVehicleLoadout, vehicleLoadoutAssemblyPoints } from './loadout'
import type { VehicleLoadoutPreset } from './loadout'
import { DEFEND_OVERLAP_TIME_DEFAULT, DEFEND_REST_TIME_DEFAULT, LEVEL, LEVEL_LIBRARY, canPlaceBaseCell, getWallInfo, globalVariableValues, invalidateWallInfo, isBaseCell, isInnerCell, levelSpawnUnitCounts, loadLevelProgress, objectiveFinishCells, saveGlobalVariableValues } from './level'
import type { LevelBossPhase, LevelEventAction, LevelObjective, LevelPlacedUnitFaction, LevelTaskStage, LevelTerrain, LevelUnitCommand, LevelUnitEvent, LevelUnitPlacement, LevelUnitSelector, LevelZone } from './level'
import { conditionMatches } from './levelEditor'
import type { LevelCondition, UnifiedLevelEvent } from './levelEditor'
import { objectTypeById } from './worlddef'
import type { ObjectTypeEvent } from './worlddef'
import { isAutotileAsset } from './assetlib'
import { fortressBodyMaskSegmentEntry } from './fortressBodyMask'
import { bodyCollisionCells, convexPolygonIntersectsRect, pointInConvexPolygon, transformBodyCollision } from './fortressCollision'
import { geometryCenter, rectGeometryCenter } from './geometry'
import { createNonCombatBehaviorAI } from './ai/nonCombatBehavior'
export { UNIT_FOLLOW_GAP, UNIT_RETALIATION_MEMORY_SECONDS } from './ai/nonCombatBehavior'
import { pointRectDistance } from './ai/targetSelection'
export { selectSiegeTarget, type SiegeTarget } from './ai/targetSelection'
import { hardpointArcMid } from './ai/turretGeometry'
export { HARDPOINT_BODY_AIM_MARGIN, clampToHardpointArc, constrainedHardpointBodyHeading, hardpointArcContains, hardpointArcMid } from './ai/turretGeometry'
import {
  createTurretAI,
  isInterceptableMissileTarget,
  type MountedTurretTarget,
  type PlayerTurretTarget,
} from './ai/turretAI'
import {
  MISSILE_WEAVE_FREQ,
  MISSILE_WEAVE_MAX_ANGLE,
  createMissileRetargetAI,
  retargetPlayerMissile as retargetMissile,
  steerGuidedMissile,
  unitMissileTargetPoint,
} from './ai/missileAI'
export { MISSILE_RETARGET_MARGIN, MISSILE_WEAVE_FREQ, MISSILE_WEAVE_MAX_ANGLE } from './ai/missileAI'
import { createAllyCombatAI } from './ai/allyCombatAI'
import { createEnemyCombatAI } from './ai/enemyCombatAI'
import { createVehicleCombatAI } from './ai/vehicleCombatAI'
import { createDeploymentAI, type UnitDeployHost } from './ai/deploymentAI'
import type { UnitCombatTarget } from './ai/combatTargeting'
import { aiOverrideFromCommand } from './ai/schema'
import {
  allyKindForUnit, allyUnitId, enemyKindForUnit, enemyUnitId, fortressUnitId,
  normalizeUnitAI, playableVehicleDefs, resolvedUnitCombat, runtimeAllyUnitDef, runtimeEnemyUnitDef, unitAttackProfile, unitDefById,
  unitAltitude, unitCollisionRadii, unitFootprint, unitTypeConfig, type UnitAI, type UnitCombatStats, type UnitDef, type UnitDeployDirection, type UnitTargetKind,
} from './unit'

// ---------- 基础类型 ----------
export type Phase = 'prep' | 'combat' | 'won' | 'lost'
export interface Cell { x: number; y: number }

/** 阵营关系的唯一入口；中立敌对与玩家、友方、敌方互为敌对，同类之间不互相攻击。 */
export function factionsHostile(a: LevelPlacedUnitFaction, b: LevelPlacedUnitFaction): boolean {
  if (a === b || a === 'neutral' || b === 'neutral') return false
  if (a === 'neutralHostile' || b === 'neutralHostile') return true
  return (a === 'enemy') !== (b === 'enemy')
}

/** 共享视野阵营口径：玩家与友方属于同一视野队伍；其他阵营只与自身共享。 */
export function factionsShareVision(a: LevelPlacedUnitFaction, b: LevelPlacedUnitFaction): boolean {
  if ((a === 'player' || a === 'ally') && (b === 'player' || b === 'ally')) return true
  return a === b && a !== 'neutral'
}

export interface BattleVisionSource { x: number; y: number; faction: LevelPlacedUnitFaction; entityId: number }

/** 当前客户端玩家队伍的全部视野源；多人模式可沿用同一入口按观察者阵营生成队伍并集。 */
export function playerTeamVisionSources(s: GameState): BattleVisionSource[] {
  const sources: BattleVisionSource[] = []
  // 摧毁演出期间继续保留主控视野，让玩家能够看完整个死亡过程；进入失败结算后停止贡献。
  if (s.phase !== 'lost' && (s.fortress.hp > 0 || s.fortress.dyingT >= 0)) {
    const center = fortressCenter(s)
    sources.push({ x: center.x, y: center.y, faction: 'player', entityId: 0 })
  }
  for (const ally of s.allies) {
    const faction = ally.faction ?? 'ally'
    if (ally.hp > 0 && factionsShareVision('player', faction)) {
      sources.push({ x: ally.x, y: ally.y, faction, entityId: ally.id })
    }
  }
  return sources
}

export function playerTeamVisionRadiusCells(): number {
  return gameParameters().playerVisionMeters / M_PER_CELL
}

/** 两层战场视野的唯一逻辑判定；padding 用于让大型实体在边缘相交时提前显现。 */
export function playerTeamCanSeePoint(s: GameState, x: number, y: number, padding = 0): boolean {
  if (!gameParameters().battleVisionEnabled) return true
  const radius = playerTeamVisionRadiusCells() + Math.max(0, padding)
  const radiusSq = radius * radius
  return playerTeamVisionSources(s).some(source => {
    const dx = x - source.x
    const dy = y - source.y
    return dx * dx + dy * dy <= radiusSq
  })
}

function unitRadiusToward(def: UnitDef, dx: number, dy: number): number {
  const radii = unitCollisionRadii(def)
  const distance = Math.hypot(dx, dy)
  if (distance < 1e-9) return Math.max(radii.x, radii.y)
  const ux = dx / distance
  const uy = dy / distance
  return Math.hypot(radii.x * ux, radii.y * uy)
}

function pointInsideUnitEllipse(px: number, py: number, cx: number, cy: number, def: UnitDef, padding = 0): boolean {
  const radii = unitCollisionRadii(def)
  const nx = (px - cx) / (radii.x + padding)
  const ny = (py - cy) / (radii.y + padding)
  return nx * nx + ny * ny <= 1
}

/** 线段进入凸多边形（可按世界单位向外扩张 padding）的首个参数。 */
function segmentConvexPolygonEntry(
  x1: number, y1: number, x2: number, y2: number,
  polygon: readonly { x: number; y: number }[], padding = 0,
): number | null {
  if (polygon.length < 3) return null
  let signedArea2 = 0
  for (let index = 0; index < polygon.length; index++) {
    const a = polygon[index], b = polygon[(index + 1) % polygon.length]
    signedArea2 += a.x * b.y - a.y * b.x
  }
  const orientation = signedArea2 >= 0 ? 1 : -1
  let enter = 0, exit = 1
  const dx = x2 - x1, dy = y2 - y1
  for (let index = 0; index < polygon.length; index++) {
    const a = polygon[index], b = polygon[(index + 1) % polygon.length]
    const edgeX = b.x - a.x, edgeY = b.y - a.y
    const edgeLength = Math.max(1e-9, Math.hypot(edgeX, edgeY))
    const atStart = orientation * (edgeX * (y1 - a.y) - edgeY * (x1 - a.x)) + padding * edgeLength
    const delta = orientation * (edgeX * dy - edgeY * dx)
    if (Math.abs(delta) < 1e-12) {
      if (atStart < 0) return null
      continue
    }
    const boundaryT = -atStart / delta
    if (delta > 0) enter = Math.max(enter, boundaryT)
    else exit = Math.min(exit, boundaryT)
    if (enter > exit) return null
  }
  return enter >= 0 && enter <= 1 ? enter : null
}

function unitBodyPolygon(
  host: { x: number; y: number; vehicle?: UnitVehicleRuntime; bossSizeScale?: number }, def: UnitDef,
): { x: number; y: number }[] | null {
  const platform = unitVehiclePlatform(def)
  const points = platform?.bodyCollision?.points
  if (!points || points.length < 3) return null
  return transformBodyCollision(points, host.x, host.y, host.vehicle?.heading ?? 0, host.bossSizeScale ?? 1)
}

/** 单位编辑器约定的实体形状：地面单位统一使用随主体旋转的矩形。 */
export function pointInsideUnitShape(
  px: number, py: number, host: { x: number; y: number; vehicle?: UnitVehicleRuntime; bossSizeScale?: number }, def: UnitDef, padding = 0,
): boolean {
  const polygon = unitBodyPolygon(host, def)
  if (polygon) return segmentConvexPolygonEntry(px, py, px, py, polygon, padding) !== null
  if (def.type !== 'vehicle') return pointInsideUnitEllipse(px, py, host.x, host.y, def, padding)
  const visual = def.visual ?? { width: def.stats.size * 2, height: def.stats.size * 2 }
  const scale = host.bossSizeScale ?? 1
  const c = Math.cos(host.vehicle?.heading ?? 0), sn = Math.sin(host.vehicle?.heading ?? 0)
  const dx = px - host.x, dy = py - host.y
  const lx = dx * c + dy * sn, ly = -dx * sn + dy * c
  return Math.abs(lx) <= visual.width * scale / 2 + padding && Math.abs(ly) <= visual.height * scale / 2 + padding
}

/** 世界线段进入单位主体的首个参数 t；与受击点、单位碰撞共用同一类型形状规则。 */
export function segmentUnitShapeEntry(
  x1: number, y1: number, x2: number, y2: number,
  host: { x: number; y: number; vehicle?: UnitVehicleRuntime; bossSizeScale?: number }, def: UnitDef, padding = 0,
): number | null {
  const scale = host.bossSizeScale ?? 1
  const polygon = unitBodyPolygon(host, def)
  if (polygon) return segmentConvexPolygonEntry(x1, y1, x2, y2, polygon, padding)
  if (def.type === 'vehicle') {
    const visual = def.visual ?? { width: def.stats.size * 2, height: def.stats.size * 2 }
    const c = Math.cos(host.vehicle?.heading ?? 0), sn = Math.sin(host.vehicle?.heading ?? 0)
    const local = (x: number, y: number) => {
      const dx = x - host.x, dy = y - host.y
      return { x: dx * c + dy * sn, y: -dx * sn + dy * c }
    }
    const a = local(x1, y1), b = local(x2, y2)
    const hx = visual.width * scale / 2 + padding, hy = visual.height * scale / 2 + padding
    let enter = 0, exit = 1
    for (const [origin, delta, half] of [[a.x, b.x - a.x, hx], [a.y, b.y - a.y, hy]] as const) {
      if (Math.abs(delta) < 1e-9) { if (Math.abs(origin) > half) return null; continue }
      let lo = (-half - origin) / delta, hi = (half - origin) / delta
      if (lo > hi) [lo, hi] = [hi, lo]
      enter = Math.max(enter, lo); exit = Math.min(exit, hi)
      if (enter > exit) return null
    }
    return enter >= 0 && enter <= 1 ? enter : null
  }
  const radii = unitCollisionRadii(def)
  const rx = radii.x * scale + padding, ry = radii.y * scale + padding
  const ax = (x1 - host.x) / rx, ay = (y1 - host.y) / ry
  const dx = (x2 - x1) / rx, dy = (y2 - y1) / ry
  const qa = dx * dx + dy * dy, qb = 2 * (ax * dx + ay * dy), qc = ax * ax + ay * ay - 1
  if (qc <= 0) return 0
  if (qa < 1e-12) return null
  const disc = qb * qb - 4 * qa * qc
  if (disc < 0) return null
  const t = (-qb - Math.sqrt(disc)) / (2 * qa)
  return t >= 0 && t <= 1 ? t : null
}

/**
 * 将任意攻击坐标投影到单位主体贴图轮廓；载具优先使用由透明边缘生成的 bodyCollision，
 * 历史载具回退旋转矩形，其他单位回退椭圆。inset 用于让特效中心稍微进入贴图，避免只贴在外缘。
 */
export function unitBodySurfacePoint(
  host: { x: number; y: number; vehicle?: UnitVehicleRuntime; bossSizeScale?: number }, def: UnitDef,
  sourceX: number, sourceY: number, incomingDx = 0, incomingDy = -1, inset = 0,
): { x: number; y: number } {
  let outwardX = sourceX - host.x, outwardY = sourceY - host.y
  if (Math.hypot(outwardX, outwardY) < 1e-6) {
    outwardX = -incomingDx
    outwardY = -incomingDy
  }
  const outwardLength = Math.max(1e-6, Math.hypot(outwardX, outwardY))
  const ux = outwardX / outwardLength, uy = outwardY / outwardLength
  const polygon = unitBodyPolygon(host, def)
  if (polygon) {
    const far = Math.max(1, ...polygon.map(point => Math.hypot(point.x - host.x, point.y - host.y))) * 3 + 1
    const outsideX = host.x + ux * far, outsideY = host.y + uy * far
    const entry = segmentConvexPolygonEntry(outsideX, outsideY, host.x, host.y, polygon)
    if (entry !== null) {
      const surfaceX = outsideX + (host.x - outsideX) * entry
      const surfaceY = outsideY + (host.y - outsideY) * entry
      return { x: surfaceX - ux * Math.max(0, inset), y: surfaceY - uy * Math.max(0, inset) }
    }
  }
  const scale = host.bossSizeScale ?? 1
  if (def.type === 'vehicle' || host.vehicle) {
    const visual = def.visual ?? { width: def.stats.size * 2, height: def.stats.size * 2 }
    const heading = host.vehicle?.heading ?? 0
    const c = Math.cos(heading), sn = Math.sin(heading)
    const localX = ux * c + uy * sn, localY = -ux * sn + uy * c
    const radiusX = Math.max(0.01, visual.width * scale / 2)
    const radiusY = Math.max(0.01, visual.height * scale / 2)
    const surfaceScale = 1 / Math.max(Math.abs(localX) / radiusX, Math.abs(localY) / radiusY, 1e-6)
    const hitLocalX = localX * Math.max(0, surfaceScale - inset)
    const hitLocalY = localY * Math.max(0, surfaceScale - inset)
    return { x: host.x + hitLocalX * c - hitLocalY * sn, y: host.y + hitLocalX * sn + hitLocalY * c }
  }
  const radii = unitCollisionRadii(def)
  const denom = Math.max(1e-6, Math.hypot(ux / radii.x, uy / radii.y))
  const distance = Math.max(0, 1 / denom - inset)
  return { x: host.x + ux * distance, y: host.y + uy * distance }
}

/**
 * 将编辑器中以素材像素保存的局部开火点，按单位朝向换算为战场格坐标。
 * 单位贴图原始正朝向为屏幕下方；传入 heading 则沿用引擎 0=上、顺时针为正的 bearing 口径。
 */
function unitMuzzleOrigin(def: UnitDef, x: number, y: number, heading: number): { x: number; y: number } {
  const localX = (def.visual?.muzzleOffsetX ?? 0) / BASE_CELL
  const localY = (def.visual?.muzzleOffsetY ?? 0) / BASE_CELL
  const spriteRotation = heading - Math.PI
  const cosine = Math.cos(spriteRotation)
  const sine = Math.sin(spriteRotation)
  return {
    x: x + localX * cosine - localY * sine,
    y: y + localX * sine + localY * cosine,
  }
}
export type WallState = 'intact' | 'damaged' | 'destroyed'

// 墙体只有一种：基地防御墙与玩家自建墙同属性（WALL_HP）、同行为
export interface WallSeg {
  id: number
  cells: Cell[]
  hp: number
  maxHp: number
  state: WallState
  /** LEVEL.initialWalls 来源（场景编辑模式下由 draft 层接管渲染） */
  fromLevel?: boolean
  /** 孤立格(33)：端头型为 undefined/false（算墙可连接），true = 独立块（不影响邻居选块） */
  isolated?: boolean
}

export interface Turret {
  id: number
  defId: string
  x: number // 占格左上角
  y: number
  w: number
  h: number
  level: number
  hp: number
  maxHp: number
  /** 玩家炮塔独立资源池；旧运行时缺省时按当前炮塔定义补满。非玩家炮塔由统一 ops 保持无限。 */
  ammo?: number
  energy?: number
  /** 玩家炮塔自动开火开关；旧运行时缺省视为开启。非玩家炮塔不读取该字段。 */
  autoFire?: boolean
  angle: number // 弧度；0 = 朝 -Y（战场上方），顺时针为正
  cooldown: number
  burstLeft: number
  rackLeft: number // 导弹挂载显示：待发弹余量（仅导弹塔参与；满挂=burst，逐发/齐射扣减，新一轮复挂）
  rackAnim: number // 复挂渐显剩余时长（普通导弹同时推入，垂发导弹原位渐显；初始 0 不播）
  rackTimer: number // 逐枚复挂计时（打空后启动：X=fireRate/(burst+1) 秒/枚；轮中/满挂停计）
  burstTimer: number
  chargeLeft: number // 充能剩余（秒，>0 = 充能前摇中；v2.15 (-CHARGE_LAST_HOLD,0) = 末帧滞留；均不射击）
  firing: boolean
  /** 轮流发射模式当前炮管下标（跨轮轮转不重置） */
  barrelIdx: number
  /** 连发过程已经播放过循环音效；若战斗条件中断，需补开火音效完成收尾。 */
  burstSoundStarted?: boolean
  fromLevel?: boolean
  firingLeft: number
  tickTimer: number
  targetId: number | null
  /** 当前锁定的导弹池；未设置表示 targetId 指向普通实体。 */
  targetMissilePool?: MissilePool
  /** v2.35 光束起射时刻（s.time）：起射后光束以 BEAM_ON_SPEED 从炮口伸展到全长；停火清除 */
  beamOnAt?: number
  /** 挂载的堡垒炮位 id（移动堡垒：世界坐标每 tick 由 syncTurretMounts 同步；无值 = 地面炮塔，仅兼容旧逻辑/测试） */
  hardpointId?: string
  /** 来自模板预装；仅用于保留来源与防止免费预装炮塔产生拆卸返款。 */
  builtIn?: boolean
  /** 显式锁定的预装武器：不能拆除或替换。 */
  locked?: boolean
}

function fullTurretResources(def: TurretDef): Pick<Turret, 'ammo' | 'energy'> {
  return { ammo: turretAmmoCapacity(def), energy: turretEnergyCapacity(def) }
}

export function playerTurretResourceCaps(def: TurretDef, bonuses?: Pick<ModuleBonuses, 'ammoCap' | 'energyCap'>): { ammoCap: number; energyCap: number } {
  return {
    ammoCap: Math.max(0, turretAmmoCapacity(def) + Math.max(0, bonuses?.ammoCap ?? 0)),
    energyCap: Math.max(0, turretEnergyCapacity(def) + Math.max(0, bonuses?.energyCap ?? 0)),
  }
}

function syncPlayerTurretResources(turret: Turret, def: TurretDef, bonuses?: Pick<ModuleBonuses, 'ammoCap' | 'energyCap'>): void {
  const { ammoCap, energyCap } = playerTurretResourceCaps(def, bonuses)
  turret.ammo = Number.isFinite(turret.ammo) ? Math.max(0, Math.min(ammoCap, turret.ammo ?? 0)) : ammoCap
  turret.energy = Number.isFinite(turret.energy) ? Math.max(0, Math.min(energyCap, turret.energy ?? 0)) : energyCap
}

/** 正数代表外部补给，按炮塔汇率换算；负数代表直接扣除，保持事件填写的绝对值。 */
function changePlayerTurretAmmo(turret: Turret, def: TurretDef, amount: number, bonuses?: Pick<ModuleBonuses, 'ammoCap' | 'energyCap'>): void {
  const converted = amount > 0 ? amount * turretAmmoExchangeRate(def) : amount
  turret.ammo = Math.max(0, Math.min(playerTurretResourceCaps(def, bonuses).ammoCap, (turret.ammo ?? 0) + converted))
}

export interface BurnDot { damage: number; interval: number; timer: number; left: number }

/** 阵营无关的载具运行组件；任何战斗单位只要挂载该组件，就使用同一套运动、装甲和炮位规则。 */
export interface UnitVehicleRuntime {
  heading: number
  vx: number
  vy: number
  steerAngle: number
  turnW: number
  /** 阵营无关的车载武器热量；非玩家单位仍可无限使用弹药/电量，但必须正常产热与过热。 */
  heat: number
  overheated: boolean
  heatCap: number
  heatDissipation: number
  shield?: number
  maxShield?: number
  shieldBroken?: boolean
  shieldLastHitAt?: number
  /** 履带/轮胎滚动相位，与玩家堡垒使用相同的视觉驱动数据。 */
  trackPhase: number[]
  /** 步行机甲步态相位（格）；实际位移与原地转向共同推进。 */
  walkPhase?: number
  /** 停步收势时前进到的下一处落脚相位；到位后再短暂淡入待机帧。 */
  walkSettleTarget?: number
  /** 收势落脚后向待机帧过渡的进度 0..1。 */
  walkSettleBlend?: number
  /** 本 tick 已推进步态的游戏时间；防止行为切换时重复积分，并允许统一补做停步收势。 */
  walkAnimationAt?: number
  armor: FortressArmor
  maxArmor: FortressArmor
  lastCollisionAt?: number
  /** 撞击路径诊断只属于运行时；不会回写单位模板。 */
  ramTargetKey?: string
  ramLastDistance?: number
  ramBlockedTime?: number
  ramRetryAt?: number
  /** 敌方载具炮位生成的预装炮塔；与玩家炮塔池隔离，避免共享资源、热量与建造状态。 */
  turrets?: Turret[]
  destroyedFx?: boolean
}

/** 飞行器运行组件；所有阵营共用同一套平面转向与加速数据。 */
export interface UnitAircraftRuntime {
  heading: number
  vx: number
  vy: number
  /** 当前实际高度（格）；由模板初始高度创建，并逐帧接近 targetAltitude。 */
  altitude: number
  /** 事件或脚本请求的目标高度（格），始终钳制在单位模板的高度范围内。 */
  targetAltitude: number
  /** 当前垂直速度（格/秒），仅供表现、调试与后续起降扩展使用。 */
  verticalSpeed: number
  /** 固定翼在没有新的移动目标时围绕该点持续盘旋；旋翼类型不使用。 */
  holdX?: number
  holdY?: number
  /** 固定翼盘旋方向：1=顺时针，-1=逆时针。 */
  orbitDirection?: 1 | -1
  /** 结构归零后的纯表现坠毁状态；击杀、任务和奖励仍在结构归零时结算。 */
  crash?: UnitAircraftCrashRuntime
}

export interface UnitAircraftCrashRuntime {
  kind: 'rotorcraft' | 'fixedWingAircraft'
  /** 坠毁开始时的游戏时间，用于让旋翼减速动画保持连续。 */
  startedAt: number
  elapsed: number
  duration: number
  startAltitude: number
  /** 1=顺时针，-1=逆时针；由单位 ID 确定性生成。 */
  spinDirection: 1 | -1
  /** 旋翼失速后持续偏出的世界方向；坠毁开始时随机确定，期间不再跳变。 */
  driftHeading?: number
  impacted?: boolean
}

/** 旧名称保留为兼容导出，运行时已不再限定敌方。 */
export type EnemyVehicleRuntime = UnitVehicleRuntime

export interface Enemy {
  id: number
  kind: EnemyKind
  unitDefId?: string // 统一单位库引用；可选兼容旧快照/测试构造
  /** 关卡编辑器初始单位实例 ID；用于摧毁目标等任务稳定追踪。 */
  placementId?: number
  /** 关卡实例编组；同组非敌对单位共享视野，任一成员攻击或受击时共同接战。 */
  group?: string
  controller?: 'player' | 'ai' | 'script' | 'static'
  faction?: 'enemy' | 'neutralHostile'
  /** 防守波次赋予的攻击伤害倍率；旧快照及非波次敌人缺省为 1。 */
  damageMultiplier?: number
  x: number // 连续坐标（格）
  y: number
  /** 关卡实例的静止初始朝向；移动或攻击后由运行时朝向接管。 */
  initialHeading?: number
  /** 关卡实例贴图水平镜像。 */
  flipX?: boolean
  hp: number
  maxHp: number
  mode: 'move' | 'attack'
  targetKind: UnitTargetKind | null
  targetId: number | null
  /** 主目标实体池；单位 ID 在友方/敌方池之间可能重复，因此不能只保存 targetId。 */
  combatTargetSide?: 'fortress' | 'ally' | 'enemy'
  goalX: number
  goalY: number
  hasGoal: boolean
  pathVersion: number
  attackedBy: { turretId: number; time: number }[]
  dots: BurnDot[]
  hitFlash: number
  hitFxLastAt?: number
  attackCooldown?: number // 远程实弹攻击冷却；可选以兼容旧测试/存档构造
  bossName?: string
  bossSizeScale?: number
  bossPhases?: LevelBossPhase[]
  bossDefeatActions?: LevelEventAction[]
  bossPhaseDone?: number[]
  bossBarColor?: string
  aiOverride?: UnitAI | null
  scriptPaused?: boolean
  script?: UnitScriptRuntime
  /** 自爆已结算；避免抵达引爆后在死亡清理阶段再次爆炸。 */
  kamikazeResolved?: boolean
  /** 主动抵达目标引爆不计作玩家击杀，也不发放赏金。 */
  kamikazeArrival?: boolean
  /** 最近一次被移动堡垒碾压的时刻；接触冷却避免每帧重复结算。 */
  rammedAt?: number
  /** 敌方载具运行时：朝向、真实速度与独立四向装甲。 */
  vehicle?: UnitVehicleRuntime
  /** 飞行器的阵营无关运动与动态高度状态。 */
  aircraft?: UnitAircraftRuntime
  coverObjectId?: number
  coverX?: number
  coverY?: number
  coverHidden?: boolean
  coverAttackLeft?: number
  deathLeft?: number
  behaviorHomeX?: number
  behaviorHomeY?: number
  behaviorTargetX?: number
  behaviorTargetY?: number
  behaviorWait?: number
  behaviorStep?: number
  behaviorRouteIndex?: number
  behaviorActive?: boolean
  /** 已经进入战斗；目标离开追踪视野后会解除，并按关卡行为决定是否归位。 */
  behaviorEngaged?: boolean
  /** 脱战后正在返回关卡实例原位；归位期间不会重新索敌。 */
  behaviorReturning?: boolean
  /** 坚守归位完成后恢复关卡实例的初始朝向；供无独立运动组件的单位渲染使用。 */
  behaviorFacingHome?: boolean
  /** 接战后暂未获得目标的宽限计时，供受击编组在下一帧完成索敌。 */
  behaviorLostTime?: number
  /** 受击后共享给编组的反击目标；记忆期内该目标不受视野/追踪视野过滤。 */
  retaliationSide?: 'fortress' | 'ally' | 'enemy'
  retaliationId?: number
  retaliationUntil?: number
  behaviorOverride?: UnitBehaviorRuntimeOverride
  /** 非战斗地格导航运行态；路径本体由同目标距离场缓存共享，不随单位重复保存。 */
  behaviorNavGoalKey?: string
  behaviorNavTargetCellX?: number
  behaviorNavTargetCellY?: number
  behaviorNavPathVersion?: number
  behaviorNavRefreshWait?: number
  behaviorNavStuckTime?: number
  behaviorNavLastX?: number
  behaviorNavLastY?: number
  behaviorNavLastHeading?: number
  behaviorNavRepathSerial?: number
  behaviorNavUnreachable?: boolean
  /** “投送兵力”单次运行进度；单位被摧毁时随宿主一并消失。 */
  deployForces?: UnitDeployForcesRuntime
}

export type ProjKind = 'bullet' | 'shell' | 'missile'
export interface Projectile {
  id: number
  kind: ProjKind
  defId: string
  level: number
  x: number
  y: number
  px: number
  py: number
  heading: number
  damage: number
  traveled: number // m
  maxTravel: number // m
  shooter: number // 发射炮塔 id（用于敌人反击归属）
  hitIds: number[] // 直射已命中敌人（穿透去重）
  /** 发射点高度与抵达目标高度所需的水平飞行距离（米）。 */
  sourceAltitude?: number
  /** 发射时锁定的目标高度；用于直射/射线越障与穿透目标的垂直命中资格。 */
  targetAltitude?: number
  altitudeTravelM?: number
  // 抛射
  t: number
  flightTime: number
  sx: number
  sy: number
  tx: number
  ty: number
  // 导弹
  speed: number
  turnRate: number
  guided: boolean
  targetId: number | null
  lockX: number
  lockY: number
  lostLock: boolean
  prevDist: number // 制导导弹上一帧与目标距离（近炸引信）
  flightLeft?: number // 导弹：剩余飞行时间（秒，发射时 = def.missileFlightTime；未配置不设）
  fading?: number // 导弹：飞行时间耗尽后的淡出倒计时（停止制导、惯性直飞、不再命中）
  weavePhase: number // 导弹：飞行曲线（weave）摆动相位（发射时随机）
  guideDelayLeft?: number // v1.94 延迟制导：剩余制导延迟（秒；>0 期间沿发射航向=炮塔方向直飞、不追踪不触锁定点爆炸，归零自动开制导）
  tgtPX?: number // v2.20 前置量追踪：上一 tick 目标位置 x（Enemy 无速度字段，按弹采样位移/dt 估算目标速度）
  tgtPY?: number // v2.20 前置量追踪：上一 tick 目标位置 y
  splitDone?: boolean // v2.20 集束分裂：子弹标记（防止二次分裂；母弹分裂后移除）
  igniteAtT?: number // v2.23 点火时刻弹龄（秒；= 出生时的制导延迟，无延迟=0；集束子弹=分裂时刻弹龄）——点火大力喷射/烟尾「持续」窗口的计时基准
  /** 导弹拦截使用的独立运行时耐久；惰性初始化以兼容旧快照。 */
  interceptHp?: number
  intercepted?: boolean
}

/** 敌方直线实弹：与玩家弹丸分池；兼容移动堡垒及攻城静态目标。 */
export interface EnemyProjectile {
  id: number
  shooterId: number
  x: number
  y: number
  px: number
  py: number
  heading: number
  speed: number // 米/秒
  damage: number
  penetration: number
  /** 单位编辑器选择的弹丸素材；为空时继续使用程序化小弹头。 */
  assetRef?: string
  /** 寻找掩体单位起身射击时，仅忽略自己当前绑定的那一个掩体。 */
  ignoreObjectId?: number
  traveled: number // 米
  maxTravel: number // 米
  targetKind?: Extract<UnitTargetKind, 'fortress' | 'coreBuilding' | 'fixedBuilding' | 'wall' | 'combatUnit'>
  /** combatUnit 的实体池；敌方射击友军、友军射击敌人共用同一条可视弹道。 */
  targetSide?: 'ally' | 'enemy'
  /** 发射阵营只决定伤害对象，不再决定弹丸库、美术或飞行参数。 */
  sourceSide?: 'ally' | 'enemy'
  sourceFaction?: LevelPlacedUnitFaction
  targetId?: number
  targetX?: number
  targetY?: number
  sourceAltitude?: number
  /** 发射时锁定的目标高度；所有阵营共用同一空地命中规则。 */
  targetAltitude?: number
  altitudeTravelM?: number
  impactX?: number // 首次进入主体后预定的内部命中点；让弹丸继续飞入一定深度
  impactY?: number
  /** 敌方载具炮塔复用的完整弹种；缺省视为旧直线实弹。 */
  kind?: ProjKind
  defId?: string
  ammoId?: string
  armorPen?: number
  armorDamage?: number
  blastRadius?: number
  blastEffect?: TurretDef['blastEffect']
  t?: number
  flightTime?: number
  sx?: number
  sy?: number
  tx?: number
  ty?: number
  guided?: boolean
  turnRate?: number
  flightLeft?: number
  missileAccel?: number
  missileMaxSpeed?: number
  missileTurnMax?: number
  missileTurnAccel?: number
  guideDelayLeft?: number
  guideDecel?: number
  willGuide?: boolean
  burnTime?: number
  missileCurve?: number
  weavePhase?: number
  /** 制导前置量：上一逻辑帧目标位置；与玩家炮塔导弹共用同一转向口径。 */
  tgtPX?: number
  tgtPY?: number
  /** 发动机点火弹龄；用于所有阵营统一计算点火强化与烟尾持续时间。 */
  igniteAtT?: number
  moveHeading?: number
  split?: ProjectileArtDef['split']
  splitDone?: boolean
  /** 新生成弹丸首个可见帧停留在开火点，避免生成当帧推进后看起来从枪口前方凭空出现。 */
  pendingFirstFrame?: boolean
  hitIds?: number[]
  pierceCount?: number
  pierceDecay?: number
  /** 导弹拦截使用的独立运行时耐久；惰性初始化以兼容旧快照。 */
  interceptHp?: number
  intercepted?: boolean
}

export type MissilePool = 'player' | 'unit'

/** 炮塔索敌与弹道碰撞共用的轻量导弹目标，不把两套历史弹丸池泄漏到调用方。 */
export interface InterceptableMissileTarget {
  targetType: 'missile'
  pool: MissilePool
  id: number
  x: number
  y: number
  vx: number
  vy: number
  altitude: number
  faction: LevelPlacedUnitFaction
  hp: number
  maxHp: number
  ammoId?: string
}

/** 当前程序化敌方实弹的战场显示直径（格）；落地坑与主体弹孔共用此口径。 */
export const ENEMY_PROJECTILE_VISUAL_SIZE = 0.07
/** 无贴图普通几何实弹的战场显示直径（格，基准 5px / BASE_CELL）。 */
export const GEOMETRIC_BULLET_VISUAL_SIZE = 5 / BASE_CELL

/** 导弹飞行时间耗尽后的淡出时长（秒） */
export const MISSILE_FADE = 0.5
/** 导弹拦截的确定性逻辑半径（格）；素材尺寸尚未进入逻辑配置时使用统一小目标口径。 */
export const MISSILE_INTERCEPT_RADIUS = 0.18
/** 光束持续发射期间转向速度系数（0.5 = 减半） */
export const BEAM_TURN_FACTOR = 0.5
export const CHARGE_LAST_HOLD = 0.05 // v2.15 充能末帧滞留（秒，v2.16 0.1→0.05）：最后一帧亮起后再过 0.05s 起射（不计入 chargeTime）
/** 光束停火消退动画时长（秒）：宽度收窄 + 渐隐 */
export const BEAM_FADE = 0.25
/** 导弹飞行曲线（weave）：摆动频率（Hz）与 curve=100 时的最大航向偏置角（度）。
 * 航向偏置 = (curve/100)×MAX_ANGLE×cos(2πft+phase) 叠加在基础航向上——位置横向偏移自然往复变号。
 * 注：weave 为气动摆动，不占用转向机构角速度（制导转向本身仍受 missileTurnMax 约束）。 */

export interface ShellArcVisual {
  progress: number
  /** 弹体相对地面轨迹的垂直高度（格）。 */
  altitude: number
  /** 透视强调倍率；只影响弹体表现，不改变碰撞与爆炸半径。 */
  bodyScale: number
  shadowScale: number
  shadowOpacity: number
  /** 最后 35% 飞行时间显示的落点提示进度。 */
  landingProgress: number
}

/**
 * 抛射弹丸的唯一视觉弧线：水平落点仍由 sx/sy → tx/ty 线性推进，
 * 仅把飞行距离映射为更高的抛物线与透视大小，确保视觉落点和逻辑爆炸点完全一致。
 */
export function shellArcVisual(t: number, sx: number, sy: number, tx: number, ty: number): ShellArcVisual {
  const progress = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0))
  const distance = Math.hypot(tx - sx, ty - sy)
  const peakAltitude = Math.max(0.8, Math.min(4, 0.65 + distance * 0.24))
  const altitude = 4 * progress * (1 - progress) * peakAltitude
  const shadowScale = Math.max(0.3, 1 - altitude * 0.16)
  return {
    progress,
    altitude,
    bodyScale: 1 + Math.min(0.3, altitude * 0.08),
    shadowScale,
    shadowOpacity: 0.12 + shadowScale * 0.16,
    landingProgress: Math.max(0, Math.min(1, (progress - 0.65) / 0.35)),
  }
}

/** 导弹可视航向（含 weave 摆动偏置）：与 updateMissile 位移公式同源——渲染贴图/喷口跟随蛇形转向 */
export function missileVisHeading(p: Projectile, def: TurretDef): number {
  const curve = def.missileCurve ?? 0
  if (curve <= 0) return p.heading
  const delayCurveScale = missileCurveAmplitudeScale(p.guideDelayLeft)
  return wrapAngle(p.heading + Math.cos(TAU * MISSILE_WEAVE_FREQ * p.t + p.weavePhase) * (curve / 100) * MISSILE_WEAVE_MAX_ANGLE * DEG * delayCurveScale)
}

/** 出膛偏角填写总随机区间：20 表示每发在 -10°～+10° 内确定性取样。 */
export function missileEjectOffsetDeg(range: number | undefined, projectileId: number): number {
  return (eventRandom(projectileId, 97) - 0.5) * Math.abs(range ?? 0)
}

/** 制导延迟期间蛇形曲线幅度提高 30%；延迟结束立即恢复设定幅度。 */
export function missileCurveAmplitudeScale(guideDelayLeft: number | undefined): number {
  return (guideDelayLeft ?? 0) > 0 ? 2 : 1
}

export interface BurnZone { id: number; x: number; y: number; r: number; damage: number; interval: number; timer: number; left: number }
export interface ExplosionFx {
  id: number
  x: number
  y: number
  r: number
  ttl: number
  max?: number
  ammoId?: string
  projectileSize?: number
  hx?: number
  hy?: number
  hspeed?: number
  /** unitDeath 为所有阵营共用的单位摧毁表现；groundImpact 只生成落地坑。 */
  kind?: 'unitDeath' | 'groundImpact'
  /** 默认生成地面弹坑；空中拦截等非地面爆炸可显式关闭。 */
  leavesCrater?: boolean
  deathEffect?: UnitDestructionEffect
  /** 摧毁主体的朝向与外接尺寸，供残骸和剧烈多重爆炸定位。 */
  heading?: number
  bodyWidth?: number
  bodyHeight?: number
}

/** 玩家单位死亡仍等待演出完成再结算失败，但不再运行堡垒专属爆炸与 AOE。 */
export const PLAYER_DEATH_SETTLE_T = 2.2
/** 非爆炸命中特效事件（§3A.5.4：实弹/点射命中点 impact 帧条；无素材时无特效=现状） */
export interface ImpactFx { id: number; x: number; y: number; altitude?: number; ttl: number; max: number; ammoId?: string; hx?: number; hy?: number }
export interface Tracer { id: number; x1: number; y1: number; x2: number; y2: number; ttl: number; pulse?: boolean; defId?: string } // v2.7：pulse 曳光带 defId → 渲染端按光束美术配置绘制
export interface FloatText { id: number; x: number; y: number; text: string; ttl: number; visualKind?: 'penetration' | 'ricochet' | 'ramming' }

/** 炮口事件（规范 §5.2/§5.3：后坐/火光的表现层载体；纯数据可 structuredClone，渲染端按渲染帧时间推进动画） */
export interface MuzzleEvent {
  id: number
  turretId: number
  barrelIdx: number // 击发炮管（齐射每管一条；轮流仅当前管）
  x: number // 炮口世界坐标（格）
  y: number
  /** 发射源高度（格）；空中载具炮口火光需与主体、炮塔及弹丸使用同一视觉高度。 */
  sourceAltitude?: number
  angle: number // 击发时刻炮口方向（不跟随旋转）
  ttl: number // 剩余存活（= FLASH_DURATION 固定 0.2s，v1.45 硬编码）
  max: number
}

/** 光束停火消退记录（纯数据可 structuredClone）：命中点固定，源头向目标收束，同时宽度收窄 + 渐隐 */
export interface BeamFade {
  id: number
  defId: string // v2.7：消退段复用该炮塔的光束美术配置（贴图/颜色）
  x: number // 起点（炮口点，与光束起点一致）
  y: number
  angle: number // 停火时刻角度（不跟随后续转向）
  len: number // 停火时刻波束长度（格）
  width?: number // v2.50：初始宽幅（m，def.beamWidth；undefined = 未配置，消退段贴图保持原生高度）
  mode?: 'shrink' | 'transfer' // 缺省 shrink，兼容旧运行态
  ttl: number
  max: number
}

/** 要塞内部模块实例：摆放在 fortressDef.interior 格阵内（rot=1 旋转 90°）；无耐久、不可被摧毁，仅可拆除 */
export interface ModuleInst { id: number; defId: string; x: number; y: number; rot: 0 | 1; timer: number } // timer = 生产倒计时

/** 友军单位（生产模块产出）：地面单位参与统一实体碰撞；air=true 地面敌人无法攻击 */
export interface Ally {
  id: number
  kind: AllyKind
  unitDefId?: string // 统一单位库引用；可选兼容旧快照/测试构造
  faction?: 'player' | 'ally' | 'neutral'
  controller?: 'player' | 'ai' | 'script' | 'static'
  producerId: number // 产出它的模块 id（用于模块存活上限统计）
  x: number // 连续坐标（格）
  y: number
  initialHeading?: number
  flipX?: boolean
  hp: number
  maxHp: number
  cooldown: number // 攻击间隔倒计时
  targetId: number | null
  /** 主目标实体池；与敌方单位共用同一索敌协议。 */
  combatTargetSide?: 'fortress' | 'ally' | 'enemy'
  hitFlash: number
  /** 与敌方载具完全相同的阵营无关载具运行组件。 */
  vehicle?: UnitVehicleRuntime
  /** 飞行器的阵营无关运动与动态高度状态。 */
  aircraft?: UnitAircraftRuntime
  hitFxLastAt?: number
  dots?: BurnDot[]
  placementId?: number
  /** 关卡实例编组；同组非敌对单位共享视野，任一成员攻击或受击时共同接战。 */
  group?: string
  aiOverride?: UnitAI | null
  scriptPaused?: boolean
  script?: UnitScriptRuntime
  deathLeft?: number
  behaviorHomeX?: number
  behaviorHomeY?: number
  behaviorTargetX?: number
  behaviorTargetY?: number
  behaviorWait?: number
  behaviorStep?: number
  behaviorRouteIndex?: number
  behaviorActive?: boolean
  /** 已经进入战斗；目标离开追踪视野后会解除，并按关卡行为决定是否归位。 */
  behaviorEngaged?: boolean
  /** 脱战后正在返回关卡实例原位；归位期间不会重新索敌。 */
  behaviorReturning?: boolean
  /** 坚守归位完成后恢复关卡实例的初始朝向；供无独立运动组件的单位渲染使用。 */
  behaviorFacingHome?: boolean
  /** 接战后暂未获得目标的宽限计时，供受击编组在下一帧完成索敌。 */
  behaviorLostTime?: number
  /** 受击后共享给编组的反击目标；记忆期内该目标不受视野/追踪视野过滤。 */
  retaliationSide?: 'fortress' | 'ally' | 'enemy'
  retaliationId?: number
  retaliationUntil?: number
  behaviorOverride?: UnitBehaviorRuntimeOverride
  /** 非战斗地格导航运行态；路径本体由同目标距离场缓存共享，不随单位重复保存。 */
  behaviorNavGoalKey?: string
  behaviorNavTargetCellX?: number
  behaviorNavTargetCellY?: number
  behaviorNavPathVersion?: number
  behaviorNavRefreshWait?: number
  behaviorNavStuckTime?: number
  behaviorNavLastX?: number
  behaviorNavLastY?: number
  behaviorNavLastHeading?: number
  behaviorNavRepathSerial?: number
  behaviorNavUnreachable?: boolean
  /** “投送兵力”单次运行进度；单位被摧毁时随宿主一并消失。 */
  deployForces?: UnitDeployForcesRuntime
}

export interface UnitDeployForcesRuntime {
  spawned: number
  cooldown: number
  complete: boolean
}

export interface UnitBehaviorRuntimeOverride {
  behavior: NonNullable<LevelUnitPlacement['behavior']>
  range: number
  interval: number
  speedPercent: number
}

export interface UnitScriptRuntime {
  key: string
  command: LevelUnitCommand
  left: number
  done: boolean
}

export interface TriggerRuntime {
  id: number
  inside: boolean
  activations: number
  cooldown: number
}

export interface AmbushSpawn {
  triggerId: number
  kind: EnemyKind
  unitDefId?: string
  left: number
  x: number
  y: number
}

export interface EventSequenceRuntime {
  id: number
  sourceId: number
  zone: LevelZone
  actions: LevelEventAction[]
  index: number
  waitLeft: number
  actionStarted?: boolean
  unitTargetIds?: string[]
  /** 触发该序列的真实运行时实体；不再把事件运行时 ID 误当成单位 ID。 */
  sourceUnitId?: number
  sourceObjectId?: number
  /** 不规则区域保留精确格集合，刷怪不会落入包围盒空洞。 */
  regionCells?: string[]
  /** 用于默认防重入：同一事件上一次动作序列结束前不再启动。 */
  eventRuntimeId?: number
  /** “调用事件”生成的子序列；父序列等待子序列完成后继续。 */
  waitingChildSequenceId?: number
  /** 防止事件互相调用或调用自身形成无限递归。 */
  callDepth?: number
}

export interface FunctionalAreaRuntime {
  eventId: number
  cells: string[]
  ammoEnabled: boolean
  ammoPerSec: number
  energyEnabled: boolean
  energyPerSec: number
  repairEnabled: boolean
  structurePerSec: number
  armorPerSec: number
  assemblyEnabled: boolean
}

export interface LevelServiceZone {
  eventId: number
  name: string
  cells: string[]
  service: 'assembly' | 'functional'
  active: boolean
  ammoEnabled?: boolean
  ammoPerSec?: number
  energyEnabled?: boolean
  energyPerSec?: number
  repairEnabled?: boolean
  structurePerSec?: number
  armorPerSec?: number
  assemblyEnabled?: boolean
}

export interface FortressSupplyStatus {
  inside: boolean
  ammo: boolean
  energy: boolean
  ammoPerSec: number
  energyPerSec: number
  repair: boolean
  structurePerSec: number
  armorPerSec: number
  assembly: boolean
}

export interface PlayerUnitTurretResourceDetail {
  turretId: number
  name: string
  ammo: number
  ammoCap: number
  energy: number
  energyCap: number
}

export interface PlayerUnitResourceDetails {
  unitId: number | null
  unitName: string
  x: number
  y: number
  turrets: PlayerUnitTurretResourceDetail[]
  missingAmmo: boolean
  missingEnergy: boolean
  supplyAmmo: boolean
  supplyEnergy: boolean
  supplyRepair: boolean
  ammoProgress: number
  energyProgress: number
  repairProgress: number
}

export interface FortressDefenseSnapshot {
  fortressDefId: string
  fortress: GameState['fortress']
  mountedTurrets: Turret[]
  modules: ModuleInst[]
}

export interface EventDebugEntry {
  id: number
  time: number
  eventId?: number
  eventName: string
  status: 'triggered' | 'running' | 'waiting' | 'completed' | 'blocked'
  detail: string
}

export interface InteractableRuntime { id: number; inside: boolean; activations: number; enabled: boolean }
export interface UnifiedEventRuntime {
  id: number; inside: boolean; activations: number; cooldown: number; enabled: boolean
  /** 由“调用事件”直接执行的次数；不消耗事件自身的触发次数上限。 */
  callActivations?: number
  conditionPassed?: boolean
  lastBlockReason?: string
}
export interface LevelNotice { id: number; text: string; left: number }
export interface CinematicDialogue { id: number; speaker: string; text: string; left: number; max: number }
export interface CinematicText { id: number; text: string; position: 'top' | 'center' | 'bottom'; left: number; max: number }
export interface CinematicCamera { id: number; x: number; y: number; startedAt: number; duration: number; hold: number; returnToOrigin: boolean }
export interface EventChoicePrompt { id: number; sequenceId: number; actionIndex: number; prompt: string; options: string[]; selectedIndex?: number }
export interface EventAssemblyPrompt { id: number; sequenceId: number; actionIndex: number }
export interface ShieldHitFx { id: number; x: number; y: number; ttl: number; max: number; broken: boolean; /** 缺省表示主控，数值表示玩家阵营单位。 */ unitId?: number }
export type FortressDamageMarkKind = 'bullet' | 'scorch' | 'scratch'
/** 主体层永久战损贴花：坐标为堡垒局部格，角度由事件 id 的黄金角稳定派生。 */
export interface FortressDamageMark { id: number; kind: FortressDamageMarkKind; x: number; y: number; size: number; angle: number; ammoId?: string; projectileSize?: number }
/** 阵营无关的单位受击事件：玩家载具、友军和敌军共用同一套命中/跳弹渲染。 */
export interface UnitHitFx {
  id: number; x: number; y: number; ttl: number; max: number
  /** 命中点相对地面的实时高度（格）；飞行单位受击表现据此叠加到主体。 */
  altitude?: number
  penetrated: boolean; ricochet: boolean
  normalDx: number; normalDy: number
  ricochetDx: number; ricochetDy: number
  ammoId?: string; projectileSize?: number
  visualKind?: 'ramming'
}
export interface AudioSignal { id: number; kind: 'vehicleCollision' | 'crush' | 'objectDestroy' | 'objectInteract' | 'unitFire' | 'turretFire' | 'unitDeath' | 'walkerStep' | 'cue' | 'music'; defId?: string; sourceId?: number; cueId?: string; soundRole?: TurretFireSoundRole; musicMode?: 'override' | 'restore'; intensity?: number; x?: number; y?: number; left: number }

export interface GameState {
  /** 单次战斗运行标识；供不进入存档的跨帧缓存区分不同关卡实例。 */
  navigationSessionId?: number
  phase: Phase
  time: number
  gold: number
  ammo: number
  energy: number
  wave: number
  prepLeft: number
  /** 波次不等待时，从本波最后一名敌人登场到下波开始的倒计时；null=尚未开始。 */
  nextWaveLeft: number | null
  /** 当前目标累计交战时间（仅 combat 推进；生存目标据此判胜）。 */
  objectiveElapsed: number
  objective: LevelObjective
  /** 当前任务流程节点；成功/失败可继续进入另一节点，而非立即结束整关。 */
  activeStageId: string
  /** 已击毁的关卡初始敌方实例；尸体演出结束移除后仍可判定摧毁目标。 */
  defeatedUnitPlacementIds: number[]
  /** 移动堡垒：连续坐标（格）左上角 + 船体耐久（取代旧核心血量；归零判负） */
  fortress: { x: number; y: number; hp: number; maxHp: number; armor: FortressArmor; maxArmor: FortressArmor; shield: number; maxShield: number; shieldBroken: boolean; shieldLastHitAt: number; hitFlash: number; damageMarks: FortressDamageMark[]; damageMarkLastAt: number; damageFxLastAt: number; heat: number; overheated: boolean; heading: number; vx: number; vy: number; leanX: number; leanY: number; leanRbT: number; leanRbX: number; leanRbY: number; leanVX: number; leanVY: number; turnW: number; trackPhase: number[]; walkPhase?: number; walkSettleTarget?: number; walkSettleBlend?: number; walkAnimationAt?: number; steerAngle: number; dyingT: number } // armor/maxArmor=四向当前/上限；护盾由模块动态提供；damageMarks=主体局部永久战损；heading=船头朝向（0=朝上，顺时针为正）
  fortressDefId: string
  /** 移动输入（UI 直接写入 gameRef.current.moveDir；tick 消费并随状态克隆延续） */
  moveDir: { x: number; y: number }
  /** 推进幅度 0..1（摇杆模拟量：速度上限 = 最大速度 × moveMag；键盘恒 1） */
  moveMag: number
  /** 转向输入：-1 左转（Q），+1 右转（E），0 不转 */
  turnDir: number
  /** 摇杆目标朝向（弧度，0=朝上顺时针为正；null=无摇杆转向指令）。摇杆推出时由 UI 写入，引擎按转向速率追踪，到位即停 */
  desiredHeading: number | null
  /** 倒退模式（摇杆推向水平以下）：沿船头反方向行驶，最大速度/加速度 × 倒退系数，不改变朝向 */
  reverse: boolean
  /** 堡垒中心所在格（跨格时 pathVersion++ 触发全场重寻路） */
  fortCellX: number
  fortCellY: number
  walls: WallSeg[]
  turrets: Turret[]
  modules: ModuleInst[] // 要塞内部模块（背包式摆放；提供资源回复/上限/散热加成）
  allies: Ally[] // 生产模块产出的友军单位
  core: FixedBuilding | null // 关卡独立核心建筑；与移动堡垒严格分离
  buildings: FixedBuilding[]
  objects: BattleObject[]
  enemies: Enemy[]
  projectiles: Projectile[]
  enemyProjectiles: EnemyProjectile[]
  burnZones: BurnZone[]
  explosions: ExplosionFx[]
  tracers: Tracer[]
  muzzles: MuzzleEvent[] // 炮口事件（后坐/火光表现层驱动）
  beamFades: BeamFade[] // 光束停火消退动画
  impacts: ImpactFx[] // 非爆炸命中特效（§3A）
  shieldHits: ShieldHitFx[] // 护盾受击涟漪/破盾事件
  unitHits: UnitHitFx[] // 所有阵营单位共用的受击火花/跳弹事件（护盾完全吸收时不生成）
  /** 纯表现音频信号；不参与伤害、物理或确定性模拟。 */
  audioSignals?: AudioSignal[]
  floats: FloatText[]
  spawnQueue: { kind: EnemyKind; unitDefId?: string; delay: number; spawnRegionId?: number; damageMultiplier?: number }[]
  spawnTimer: number
  triggerStates: TriggerRuntime[]
  ambushQueue: AmbushSpawn[]
  eventQueue: EventSequenceRuntime[]
  /** 由事件“功能区域”指令注册；同一区域可组合补弹、充能、修理与整备。 */
  functionalAreas: FunctionalAreaRuntime[]
  /** 堡垒防御阶段临时隐藏的玩家载具数据；退出阶段时原样恢复（朝向重置）。 */
  fortressDefenseSnapshot?: FortressDefenseSnapshot
  eventDebugLog: EventDebugEntry[]
  interactableStates: InteractableRuntime[]
  unifiedEventStates: UnifiedEventRuntime[]
  levelVariables: Record<string, boolean | number>
  /** 所有关卡共用；事件动作修改后即时写入玩家进度存档。 */
  globalVariables: Record<string, boolean | number>
  /** 次要目标只能由关卡事件动作显式完成；任务开始时统一重置。 */
  secondaryObjectivesCompleted: [boolean, boolean]
  objectStates: Record<number, string>
  notices: LevelNotice[]
  /** 事件动作驱动的剧情演出状态；仅负责画面表现，不改变战斗确定性。 */
  cinematicDialogue?: CinematicDialogue
  cinematicText?: CinematicText
  cinematicCamera?: CinematicCamera
  eventChoice?: EventChoicePrompt
  eventAssembly?: EventAssemblyPrompt
  kills: number
  pathVersion: number // 结构变化即 +1，触发敌人重寻路
  nextId: number
}

// ---------- 角度工具 ----------
const TAU = Math.PI * 2
const DEG = Math.PI / 180
export function wrapAngle(a: number): number {
  let r = a % TAU
  if (r > Math.PI) r -= TAU
  if (r < -Math.PI) r += TAU
  return r
}
/** 指向角：0 = -Y（屏幕上方），顺时针为正 */
export function bearing(dx: number, dy: number): number {
  return Math.atan2(dx, -dy)
}
export function dirX(a: number): number { return Math.sin(a) }
export function dirY(a: number): number { return -Math.cos(a) }

/** 事件 id 派生的确定性随机数。同一状态与输入必得同一结果，不依赖进程级 Math.random。 */
export function eventRandom(eventId: number, stream = 0): number {
  let x = (eventId ^ Math.imul(stream + 1, 0x9e3779b9)) >>> 0
  x ^= x >>> 16
  x = Math.imul(x, 0x7feb352d)
  x ^= x >>> 15
  x = Math.imul(x, 0x846ca68b)
  x ^= x >>> 16
  return (x >>> 0) / 4294967296
}

export function defOf(defId: string): TurretDef {
  const d = TURRET_DEFS.find(d => d.id === defId)
  if (!d) throw new Error(`unknown turret def ${defId}`)
  return projectileDrivenTurret(d)
}

export function turretCenter(t: Turret): { x: number; y: number } {
  return { x: t.x + t.w / 2, y: t.y + t.h / 2 }
}

function playerMissileAmmo(p: Projectile): ProjectileArtDef | undefined {
  const turret = TURRET_DEFS.find(item => item.id === p.defId)
  return turret?.art?.projectile ? PROJECTILE_ARTS.find(item => item.id === turret.art?.projectile) : undefined
}

function unitMissileAmmo(p: EnemyProjectile): ProjectileArtDef | undefined {
  return p.ammoId ? PROJECTILE_ARTS.find(item => item.id === p.ammoId) : undefined
}

function missileInterceptMaxHp(ammo: ProjectileArtDef | undefined): number {
  return Math.max(1, ammo?.interceptHp ?? 1)
}

function missileVelocity(p: Pick<Projectile | EnemyProjectile, 'x' | 'y' | 'px' | 'py' | 'speed' | 'heading'> & { moveHeading?: number }): { vx: number; vy: number } {
  const sampleDt = Math.max(1 / 120, lastDt || 1 / 60)
  const sampledX = (p.x - p.px) / sampleDt
  const sampledY = (p.y - p.py) / sampleDt
  if (Math.hypot(sampledX, sampledY) > 1e-5) return { vx: sampledX, vy: sampledY }
  const heading = p.moveHeading ?? p.heading
  return { vx: dirX(heading) * m2c(p.speed), vy: dirY(heading) * m2c(p.speed) }
}

/** 返回指定阵营可以合法拦截的全部导弹；玩家、友军、敌军与中立敌对共用此入口。 */
export function interceptableMissileTargets(s: GameState, observerFaction: LevelPlacedUnitFaction): InterceptableMissileTarget[] {
  const targets: InterceptableMissileTarget[] = []
  for (const p of s.projectiles) {
    if (p.kind !== 'missile' || p.intercepted || p.fading !== undefined || !factionsHostile(observerFaction, 'player')) continue
    const ammo = playerMissileAmmo(p)
    if (ammo?.interceptable === false) continue
    const maxHp = missileInterceptMaxHp(ammo)
    p.interceptHp ??= maxHp
    const velocity = missileVelocity(p)
    targets.push({ targetType: 'missile', pool: 'player', id: p.id, x: p.x, y: p.y, ...velocity, altitude: projectileAltitudeAtTravel(p, p.traveled), faction: 'player', hp: p.interceptHp, maxHp, ammoId: ammo?.id })
  }
  for (const p of s.enemyProjectiles) {
    if (p.kind !== 'missile' || p.intercepted) continue
    const faction = p.sourceFaction ?? ((p.sourceSide ?? 'enemy') === 'ally' ? 'ally' : 'enemy')
    if (!factionsHostile(observerFaction, faction)) continue
    const ammo = unitMissileAmmo(p)
    if (ammo?.interceptable === false) continue
    const maxHp = missileInterceptMaxHp(ammo)
    p.interceptHp ??= maxHp
    const velocity = missileVelocity(p)
    targets.push({ targetType: 'missile', pool: 'unit', id: p.id, x: p.x, y: p.y, ...velocity, altitude: projectileAltitudeAtTravel(p, p.traveled), faction, hp: p.interceptHp, maxHp, ammoId: ammo?.id })
  }
  return targets
}

function liveInterceptableMissile(s: GameState, pool: MissilePool, id: number): Projectile | EnemyProjectile | undefined {
  return pool === 'player'
    ? s.projectiles.find(item => item.id === id && item.kind === 'missile' && !item.intercepted)
    : s.enemyProjectiles.find(item => item.id === id && item.kind === 'missile' && !item.intercepted)
}

/** 命中仅削减拦截耐久；归零时创建视觉空爆并标记移除，绝不调用原弹头爆炸伤害。 */
export function applyMissileInterceptionDamage(s: GameState, pool: MissilePool, id: number, damage: number): boolean {
  const missile = liveInterceptableMissile(s, pool, id)
  if (!missile) return false
  const ammo = pool === 'player' ? playerMissileAmmo(missile as Projectile) : unitMissileAmmo(missile as EnemyProjectile)
  if (ammo?.interceptable === false) return false
  missile.interceptHp ??= missileInterceptMaxHp(ammo)
  missile.interceptHp = Math.max(0, missile.interceptHp - Math.max(0, damage))
  if (missile.interceptHp > 0) {
    if (ammo?.id) addImpact(s, missile.x, missile.y, ammo.id, 0, 0, projectileAltitudeAtTravel(missile, missile.traveled))
    return false
  }
  missile.intercepted = true
  s.explosions.push({
    id: s.nextId++, x: missile.x, y: missile.y, r: 0.35, ttl: 0.24, max: 0.24,
    ammoId: ammo?.id, leavesCrater: false,
  })
  return true
}

/** 世界线段进入圆形导弹碰撞体的首个参数 t；用于高速弹丸的连续碰撞。 */
export function segmentCircleEntry(x1: number, y1: number, x2: number, y2: number, cx: number, cy: number, radius: number): number | null {
  const dx = x2 - x1, dy = y2 - y1
  const ox = x1 - cx, oy = y1 - cy
  const a = dx * dx + dy * dy
  const c = ox * ox + oy * oy - radius * radius
  if (c <= 0) return 0
  if (a < 1e-12) return null
  const b = 2 * (ox * dx + oy * dy)
  const disc = b * b - 4 * a * c
  if (disc < 0) return null
  const t = (-b - Math.sqrt(disc)) / (2 * a)
  return t >= 0 && t <= 1 ? t : null
}

function interceptMissileAlongSegment(
  s: GameState, sourceFaction: LevelPlacedUnitFaction,
  x1: number, y1: number, x2: number, y2: number, damage: number,
  altitudeAt: (t: number) => number,
): boolean {
  let best: { target: InterceptableMissileTarget; t: number } | undefined
  for (const target of interceptableMissileTargets(s, sourceFaction)) {
    const t = segmentCircleEntry(x1, y1, x2, y2, target.x, target.y, MISSILE_INTERCEPT_RADIUS)
    if (t === null || Math.abs(altitudeAt(t) - target.altitude) > 0.55) continue
    if (!best || t < best.t) best = { target, t }
  }
  if (!best) return false
  applyMissileInterceptionDamage(s, best.target.pool, best.target.id, damage)
  return true
}

function interceptLeadPoint(origin: { x: number; y: number }, target: InterceptableMissileTarget, projectileSpeedMps: number): { x: number; y: number } {
  const speed = Math.max(0.01, m2c(projectileSpeedMps))
  const rx = target.x - origin.x, ry = target.y - origin.y
  const a = target.vx * target.vx + target.vy * target.vy - speed * speed
  const b = 2 * (rx * target.vx + ry * target.vy)
  const c = rx * rx + ry * ry
  let time = Math.hypot(rx, ry) / speed
  if (Math.abs(a) < 1e-9) {
    if (Math.abs(b) > 1e-9) time = -c / b
  } else {
    const disc = b * b - 4 * a * c
    if (disc >= 0) {
      const root = Math.sqrt(disc)
      const candidates = [(-b - root) / (2 * a), (-b + root) / (2 * a)].filter(value => value > 0)
      if (candidates.length > 0) time = Math.min(...candidates)
    }
  }
  time = Math.max(0, Math.min(2, time))
  return { x: target.x + target.vx * time, y: target.y + target.vy * time }
}

// ---------- 初始状态（防御墙由基地格派生：syncDerivedWalls） ----------

function levelStage(id: string): LevelTaskStage {
  return LEVEL.stages.find(stage => stage.id === id) ?? LEVEL.stages[0]
}

function waveDefenseObjective(objective: LevelObjective): objective is Extract<LevelObjective, { type: 'defend' | 'fortressDefense' }> {
  return objective.type === 'defend' || objective.type === 'fortressDefense'
}

/** 防御类任务当前可见的“下一波”倒计时；UI 直接读取引擎状态，不自行计时。 */
export function defenseWaveCountdown(s: Pick<GameState, 'objective' | 'phase' | 'wave' | 'prepLeft' | 'nextWaveLeft'>): number | null {
  if (!waveDefenseObjective(s.objective) || s.wave > s.objective.waves) return null
  if (s.phase === 'prep') return Math.max(0, s.prepLeft)
  if (s.phase === 'combat' && s.objective.waveWait === false && s.nextWaveLeft !== null && s.wave < s.objective.waves) {
    return Math.max(0, s.nextWaveLeft)
  }
  return null
}

function stageWaveQueue(stage: LevelTaskStage, waveIndex: number): GameState['spawnQueue'] {
  const wave = stage.waves[waveIndex]
  if (!wave) return []
  const damageMultiplier = normalizeEnemyDamageMultiplier(wave.enemyDamageMultiplier)
  const queue: GameState['spawnQueue'] = []
  for (const entry of wave.entries) {
    const unit = unitDefById(entry.unitDefId)
    if (!unit) continue
    for (let i = 0; i < entry.count; i++) queue.push({
      kind: enemyKindForUnit(unit),
      unitDefId: unit.id,
      delay: i === 0 ? entry.delay : entry.interval,
      spawnRegionId: entry.spawnRegionId,
      damageMultiplier,
    })
  }
  return queue
}

/** 防守波次出生点：指定区域固定取该区域，未指定时按事件种子随机选非空区域与区域格。 */
export function defenseWaveSpawnPoint(objective: LevelObjective, spawnRegionId: number | undefined, eventId: number): { x: number; y: number; regionId?: number } {
  const regions = waveDefenseObjective(objective) ? objective.spawnRegions.filter(region => region.cells.length > 0) : []
  const requested = spawnRegionId === undefined ? undefined : regions.find(region => region.id === spawnRegionId)
  const region = requested ?? regions[Math.floor(eventRandom(eventId, 1) * regions.length)]
  const cellKey = region?.cells[Math.floor(eventRandom(eventId, 2) * region.cells.length)]
  const [cellX, cellY] = cellKey?.split(',').map(Number) ?? [Math.floor(1 + eventRandom(eventId, 0) * Math.max(1, LEVEL.cols - 2)), 0]
  return {
    x: Number.isFinite(cellX) ? cellX + 0.5 : LEVEL.cols / 2,
    y: Number.isFinite(cellY) ? cellY + 0.5 : 0.5,
    ...(region ? { regionId: region.id } : {}),
  }
}

function objectiveStartsInCombat(objective: LevelObjective): boolean {
  return !waveDefenseObjective(objective) || objective.waveWait === false
}

let nextNavigationSessionId = 1

export function initialState(loadoutOverride?: VehicleLoadoutPreset): GameState {
  // 出战堡垒：堡垒编辑器「设为出战」的选择（localStorage），缺省内置标准型
  const normalizedOverride = loadoutOverride ? normalizeVehicleLoadout(loadoutOverride) : null
  const requestedFortressId = normalizedOverride?.fortressDefId ?? getSelectedFortressId()
  const fdef = playableVehicleDefs().find(f => f.id === requestedFortressId) ?? DEFAULT_FORTRESS
  const selectedPreset = normalizedOverride ?? selectedVehicleLoadout()
  const loadout = selectedPreset?.fortressDefId === fdef.id ? selectedPreset : null
  const initialStage = levelStage(LEVEL.startStageId)
  const initialObjective = initialStage.objective
  // 所有任务类型共用关卡起点：玩家战车的几何中心与起点区域中心对齐。
  // 旧逻辑仅让推进/护送读取 startZone，防守等任务会被硬编码到底部居中，导致编辑器起点失效。
  const spawnX = Math.max(0, Math.min(LEVEL.cols - fdef.w, LEVEL.startZone.x + (LEVEL.startZone.w - fdef.w) / 2))
  const spawnY = Math.max(0, Math.min(LEVEL.rows - fdef.h, LEVEL.startZone.y + (LEVEL.startZone.h - fdef.h) / 2))
  // 从可变关卡配置 LEVEL 构建（战场编辑器可改；墙布局固定由 buildTemplateWalls 生成）
  const initialArmor: FortressArmor = { front: fdef.armor?.front ?? 0, rear: fdef.armor?.rear ?? 0, left: fdef.armor?.left ?? 0, right: fdef.armor?.right ?? 0 }
  const startsInCombat = objectiveStartsInCombat(initialObjective)
  const s: GameState = {
    navigationSessionId: nextNavigationSessionId++,
    phase: startsInCombat ? 'combat' : 'prep',
    time: 0,
    gold: START_GOLD,
    ammo: AMMO.start,
    energy: ENERGY.start,
    wave: 1,
    prepLeft: startsInCombat ? 0 : waveDefenseObjective(initialObjective) ? (initialObjective.restTime ?? DEFEND_REST_TIME_DEFAULT) : PREP_TIME,
    nextWaveLeft: null,
    objectiveElapsed: 0,
    objective: structuredClone(initialObjective),
    activeStageId: initialStage.id,
    defeatedUnitPlacementIds: [],
    fortress: {
      x: spawnX,
      y: spawnY,
      hp: fdef.hp,
      maxHp: fdef.hp,
      armor: structuredClone(initialArmor), maxArmor: structuredClone(initialArmor),
      shield: 0, maxShield: 0, shieldBroken: false, shieldLastHitAt: -1e9,
      hitFlash: 0, damageMarks: [], damageMarkLastAt: -1e9, damageFxLastAt: -1e9,
      heat: 0, overheated: false,
      heading: 0, // 初始船头朝上
      vx: 0, vy: 0, // 初始静止
      leanX: 0, leanY: 0, leanRbT: -1, leanRbX: 0, leanRbY: 0, leanVX: 0, leanVY: 0, // 刹停前倾位移初始为零；回弹未激活（v1.91）；角速度零（v1.92）
      trackPhase: [], // 履带相位初始为零（首个移动 tick 按 def.tracks 数量对齐）
      walkPhase: 0, // 步行机甲首帧从静止姿态开始
      turnW: 0, // 转向角速度初始为零（v1.56 松手过渡）
      steerAngle: 0, // v2.51 轮式底盘：当前前轮转角（rad，左负右正）
      dyingT: -1, // 玩家单位摧毁后的结算延时：-1=存活
    },
    fortressDefId: fdef.id,
    moveDir: { x: 0, y: 0 },
    moveMag: 1,
    turnDir: 0,
    desiredHeading: null,
    reverse: false,
    fortCellX: Math.floor(spawnX + fdef.w / 2),
    fortCellY: Math.floor(spawnY + fdef.h / 2),
    walls: [], // 玩家侧墙体退役（移动堡垒无墙圈）；墙系统保留供未来敌方要塞使用
    turrets: [],
    modules: [], // 由当前整备预设注入；仍可在允许装配的任务阶段内调整
    allies: [],
    core: LEVEL.core ? { id: -1000, name: '核心建筑', x: LEVEL.core.x, y: LEVEL.core.y, w: CORE.w, h: CORE.h, hp: CORE.hp, maxHp: CORE.hp, color: '#C8B568' } : null,
    buildings: [], // 玩家侧固定建筑退役（保留类型供未来敌方要塞使用）
    objects: LEVEL.objects.map((o, i): BattleObject => ({ ...o, id: o.id ?? 2000 + i, maxHp: o.hp })),
    enemies: [],
    projectiles: [],
    enemyProjectiles: [],
    burnZones: [],
    explosions: [],
    tracers: [],
    muzzles: [],
    beamFades: [],
    impacts: [],
    shieldHits: [],
    unitHits: [],
    floats: [],
    spawnQueue: startsInCombat && waveDefenseObjective(initialObjective) ? stageWaveQueue(initialStage, 0) : [],
    spawnTimer: startsInCombat && waveDefenseObjective(initialObjective) ? 0.5 + (stageWaveQueue(initialStage, 0)[0]?.delay ?? 0) : 0,
    triggerStates: LEVEL.triggers.map(t => ({ id: t.id, inside: false, activations: 0, cooldown: 0 })),
    ambushQueue: [],
    eventQueue: [],
    functionalAreas: [],
    eventDebugLog: [],
    interactableStates: LEVEL.interactables.map(t => ({ id: t.id, inside: false, activations: 0, enabled: t.enabled })),
    unifiedEventStates: LEVEL.events.map(event => ({ id: event.id, inside: false, activations: 0, cooldown: 0, enabled: event.enabled })),
    levelVariables: Object.fromEntries(LEVEL.variables.map(variable => [variable.id, variable.initial])),
    globalVariables: globalVariableValues(LEVEL_LIBRARY.globalVariables, loadLevelProgress().globalVariables),
    secondaryObjectivesCompleted: [false, false],
    objectStates: Object.fromEntries(LEVEL.objects.filter(object => object.id !== undefined).map(object => [object.id!, object.state ?? 'default'])),
    notices: [],
    cinematicDialogue: undefined,
    cinematicText: undefined,
    cinematicCamera: undefined,
    eventChoice: undefined,
    eventAssembly: undefined,
    kills: 0,
    pathVersion: 0,
    nextId: 1,
  }
  // 整备预设中的模块作为出战装备免费生成，并立即同步结构、护盾和生产计时。
  for (const presetModule of loadout?.modules ?? []) {
    const def = MODULE_DEFS.find(item => item.id === presetModule.defId)
    if (!def) continue
    const module: ModuleInst = {
      id: s.nextId++, defId: def.id, x: presetModule.x, y: presetModule.y, rot: presetModule.rot,
      timer: def.produce?.interval ?? 0,
    }
    s.modules.push(module)
    if (def.produce) module.timer = def.produce.interval / moduleSpecialMult(s, module, 'produce')
  }
  if (s.modules.length > 0) {
    s.fortress.maxHp = fortressMaxHp(s)
    s.fortress.hp = s.fortress.maxHp
    syncShieldCapacity(s)
  }

  // 模板固有炮塔不可拆除；整备预设炮塔装入普通炮位并复用同一套战斗逻辑。
  const localCenter = fortressLocalCenter(fdef)
  for (const hp of fdef.hardpoints) {
    const presetTurretId = !hp.builtIn
      ? loadout?.turrets.find(item => item.hardpointId === hp.id)?.turretDefId
      : undefined
    const turretDefId = hp.builtIn ?? presetTurretId
    if (!turretDefId) continue
    const def = TURRET_DEFS.find(d => d.id === turretDefId)
    if (!def) {
      console.warn(`[fortress] 预装武器定义不存在：${turretDefId}，已跳过`)
      continue
    }
    if (def.mount !== hp.size || (hp.types && !hp.types.includes(def.type))) {
      console.warn(`[fortress] 炮位 ${hp.id} 与预装炮塔 ${def.name} 的尺寸或类别不兼容，已跳过`)
      continue
    }
    s.turrets.push({
      id: s.nextId++, defId: def.id,
      x: s.fortress.x + fdef.w / 2 + hp.x - localCenter.x - def.w / 2,
      y: s.fortress.y + fdef.h / 2 + hp.y - localCenter.y - def.h / 2, // heading=0 时按有效车体中心锚定
      w: def.w, h: def.h, level: 1,
      hp: def.hp, maxHp: def.hp,
      ...fullTurretResources(def),
      angle: wrapAngle(s.fortress.heading + (hp.fixed !== undefined ? hp.fixed * DEG : hp.arc ? hardpointArcMid(hp.arc) : 0)),
      cooldown: 0, burstLeft: 0, burstTimer: 0,
      rackLeft: def.type === 'missile' ? Math.max(1, def.burst ?? 1) : 0,
      rackAnim: 0,
      rackTimer: 0,
      chargeLeft: 0, firing: false, firingLeft: 0, tickTimer: 0,
      targetId: null, barrelIdx: 0,
      hardpointId: hp.id, builtIn: !!hp.builtIn, locked: !!hp.builtIn && hp.lockedTurret === true,
    })
  }
  // 关卡实例拥有阵营与控制器；同一单位模板可被放成玩家、友方、敌方或中立。
  for (const placed of LEVEL.initialUnits) {
    const unit = unitDefById(placed.unitDefId)
    if (!unit) continue
    const initialHeading = (placed.rotation ?? 0) * DEG
    const placedVehicleDef = unitVehiclePlatform(unit)
    if (placed.faction === 'enemy' || placed.faction === 'neutralHostile') {
      const enemy = spawnEnemyAt(s, enemyKindForUnit(unit), placed.x, placed.y, unit.id)
      enemy.faction = placed.faction
      enemy.controller = placed.controller
      enemy.placementId = placed.id
      enemy.group = placed.group
      enemy.initialHeading = initialHeading
      enemy.flipX = placed.flipX
      if (enemy.aircraft) enemy.aircraft.heading = initialHeading
      if (enemy.vehicle) {
        enemy.vehicle.heading = initialHeading
        for (const turret of enemy.vehicle.turrets ?? []) {
          const source = placedVehicleDef?.hardpoints.find(item => item.id === turret.hardpointId)
          const hp = source && placedVehicleDef ? effectiveUnitHardpoint(enemy, placedVehicleDef, source) : undefined
          turret.angle = wrapAngle(initialHeading + (hp?.fixed !== undefined ? hp.fixed * DEG : hp?.arc ? hardpointArcMid(hp.arc) : 0))
        }
        syncUnitVehicleTurrets(enemy, unit)
      }
      enemy.behaviorHomeX = placed.x
      enemy.behaviorHomeY = placed.y
      enemy.behaviorWait = 0
      continue
    }
    const kind = allyKindForUnit(unit)
    const ally: Ally = {
      id: s.nextId++, kind, unitDefId: unit.id, faction: placed.faction, controller: placed.controller, producerId: 0,
      placementId: placed.id,
      group: placed.group,
      x: placed.x, y: placed.y, hp: unit.stats.hp, maxHp: unit.stats.hp,
      initialHeading, flipX: placed.flipX,
      cooldown: 0, targetId: null, hitFlash: 0,
      vehicle: createUnitVehicleRuntime(unit, initialHeading),
      aircraft: createUnitAircraftRuntime(unit, initialHeading),
      behaviorHomeX: placed.x, behaviorHomeY: placed.y, behaviorWait: 0,
    }
    s.allies.push(ally)
    ensureUnitVehicleTurrets(s, ally, unit)
  }
  if (initialObjective.type === 'fortressDefense') enterFortressDefenseStage(s, initialObjective)
  return s
}

function fortressRuntimeAt(def: FortressDef, centerX: number, centerY: number): GameState['fortress'] {
  const x = Math.max(0, Math.min(LEVEL.cols - def.w, centerX - def.w / 2))
  const y = Math.max(0, Math.min(LEVEL.rows - def.h, centerY - def.h / 2))
  const armor: FortressArmor = {
    front: def.armor?.front ?? 0, rear: def.armor?.rear ?? 0,
    left: def.armor?.left ?? 0, right: def.armor?.right ?? 0,
  }
  return {
    x, y, hp: def.hp, maxHp: def.hp, armor: structuredClone(armor), maxArmor: structuredClone(armor),
    shield: 0, maxShield: 0, shieldBroken: false, shieldLastHitAt: -1e9,
    hitFlash: 0, damageMarks: [], damageMarkLastAt: -1e9, damageFxLastAt: -1e9,
    heat: 0, overheated: false, heading: 0, vx: 0, vy: 0,
    leanX: 0, leanY: 0, leanRbT: -1, leanRbX: 0, leanRbY: 0, leanVX: 0, leanVY: 0,
    turnW: 0, trackPhase: [], walkPhase: 0, steerAngle: 0, dyingT: -1,
  }
}

function addFortressBuiltInTurrets(s: GameState, def: FortressDef): void {
  const localCenter = fortressLocalCenter(def)
  for (const hp of def.hardpoints) {
    if (!hp.builtIn) continue
    const turretDef = TURRET_DEFS.find(item => item.id === hp.builtIn)
    if (!turretDef || turretDef.mount !== hp.size || (hp.types && !hp.types.includes(turretDef.type))) continue
    s.turrets.push({
      id: s.nextId++, defId: turretDef.id,
      x: s.fortress.x + def.w / 2 + hp.x - localCenter.x - turretDef.w / 2,
      y: s.fortress.y + def.h / 2 + hp.y - localCenter.y - turretDef.h / 2,
      w: turretDef.w, h: turretDef.h, level: 1, hp: turretDef.hp, maxHp: turretDef.hp,
      ...fullTurretResources(turretDef),
      angle: wrapAngle(hp.fixed !== undefined ? hp.fixed * DEG : hp.arc ? hardpointArcMid(hp.arc) : 0),
      cooldown: 0, burstLeft: 0, burstTimer: 0,
      rackLeft: turretDef.type === 'missile' ? Math.max(1, turretDef.burst ?? 1) : 0,
      rackAnim: 0, rackTimer: 0, chargeLeft: 0, firing: false, firingLeft: 0, tickTimer: 0,
      targetId: null, barrelIdx: 0, hardpointId: hp.id, builtIn: true, locked: hp.lockedTurret === true,
    })
  }
}

/** 进入堡垒防御阶段：保存玩家当前载具，切换到关卡指定且不可移动的堡垒。 */
function enterFortressDefenseStage(s: GameState, objective: Extract<LevelObjective, { type: 'fortressDefense' }>): void {
  if (s.fortressDefenseSnapshot) return
  const requested = playableVehicleDefs().find(def => def.id === objective.fortressDefId) ?? fortressDef(s)
  s.fortressDefenseSnapshot = {
    fortressDefId: s.fortressDefId,
    fortress: structuredClone(s.fortress),
    mountedTurrets: structuredClone(s.turrets.filter(turret => !!turret.hardpointId)),
    modules: structuredClone(s.modules),
  }
  s.turrets = s.turrets.filter(turret => !turret.hardpointId)
  s.modules = []
  s.fortressDefId = requested.id
  s.fortress = fortressRuntimeAt(requested, objective.fortressPoint.x, objective.fortressPoint.y)
  s.fortCellX = Math.floor(s.fortress.x + requested.w / 2)
  s.fortCellY = Math.floor(s.fortress.y + requested.h / 2)
  s.moveDir = { x: 0, y: 0 }; s.moveMag = 0; s.turnDir = 0; s.desiredHeading = null; s.reverse = false
  addFortressBuiltInTurrets(s, requested)
  syncShieldCapacity(s)
  s.notices.push({ id: s.nextId++, text: `接管堡垒：${requested.name}`, left: 4 })
}

/** 离开堡垒阶段：完好的堡垒转为友方单位，固定炮塔留场，玩家载具在返回点恢复。 */
function exitFortressDefenseStage(s: GameState, objective: Extract<LevelObjective, { type: 'fortressDefense' }>): void {
  const snapshot = s.fortressDefenseSnapshot
  if (!snapshot) return
  const defenseDef = fortressDef(s)
  const center = fortressCenter(s)
  if (s.fortress.hp > 0) {
    const unit = unitDefById(defenseDef.unitId ?? fortressUnitId(defenseDef.id))
    if (unit) {
      const ally: Ally = {
        id: s.nextId++, kind: allyKindForUnit(unit), unitDefId: unit.id, faction: 'ally', controller: 'ai', producerId: 0,
        x: center.x, y: center.y, hp: s.fortress.hp, maxHp: s.fortress.maxHp, initialHeading: 0,
        cooldown: 0, targetId: null, hitFlash: 0,
        vehicle: createUnitVehicleRuntime(unit, 0), aircraft: createUnitAircraftRuntime(unit, 0),
        behaviorHomeX: center.x, behaviorHomeY: center.y, behaviorWait: 0,
      }
      if (ally.vehicle) ally.vehicle.turrets = structuredClone(s.turrets.filter(turret => !!turret.hardpointId))
      s.allies.push(ally)
      syncUnitVehicleTurrets(ally, unit)
    }
  }
  const retainedGroundTurrets = s.turrets.filter(turret => !turret.hardpointId)
  s.fortressDefId = snapshot.fortressDefId
  s.fortress = structuredClone(snapshot.fortress)
  s.fortress.heading = 0
  s.fortress.vx = 0; s.fortress.vy = 0; s.fortress.turnW = 0; s.fortress.dyingT = -1
  const restoredDef = fortressDef(s)
  s.fortress.x = Math.max(0, Math.min(LEVEL.cols - restoredDef.w, objective.returnPoint.x - restoredDef.w / 2))
  s.fortress.y = Math.max(0, Math.min(LEVEL.rows - restoredDef.h, objective.returnPoint.y - restoredDef.h / 2))
  s.modules = structuredClone(snapshot.modules)
  s.turrets = [...retainedGroundTurrets, ...structuredClone(snapshot.mountedTurrets)]
  s.fortCellX = Math.floor(s.fortress.x + restoredDef.w / 2)
  s.fortCellY = Math.floor(s.fortress.y + restoredDef.h / 2)
  s.moveDir = { x: 0, y: 0 }; s.moveMag = 1; s.turnDir = 0; s.desiredHeading = null; s.reverse = false
  s.fortressDefenseSnapshot = undefined
  syncTurretMounts(s)
  syncShieldCapacity(s)
  s.notices.push({ id: s.nextId++, text: '玩家载具已返回战场', left: 4 })
}

// ---------- 移动堡垒（挂点/移动/挂载炮塔） ----------

export function fortressDef(s: GameState): FortressDef {
  return playableVehicleDefs().find(f => f.id === s.fortressDefId) ?? DEFAULT_FORTRESS
}

// ---- 自由网格形状：shape = 局部格坐标列表 "x,y"（须 4-连通，允许镂空）；缺省 = w×h 满矩形 ----
const shapeSetCache = new WeakMap<FortressDef, Set<string>>()

/** 堡垒形状格集合（局部坐标 "x,y"；带 WeakMap 缓存，编辑器 draft 每次新对象自动重算） */
export function fortressShapeSet(d: FortressDef): Set<string> {
  let set = shapeSetCache.get(d)
  if (set) return set
  if (d.bodyCollision?.points.length) {
    set = bodyCollisionCells(d)
    shapeSetCache.set(d, set)
    return set
  }
  set = new Set<string>()
  if (d.shape !== undefined) {
    for (const k of d.shape) set.add(k)
  } else {
    for (let x = 0; x < d.w; x++) for (let y = 0; y < d.h; y++) set.add(`${x},${y}`)
  }
  shapeSetCache.set(d, set)
  return set
}

/** 内部模块空间格集合（局部坐标 "x,y"；interiorCells 自由格阵优先，缺省 = cols×rows 满矩形；WeakMap 缓存） */
const interiorSetCache = new WeakMap<FortressDef, Set<string>>()
export function fortressInteriorSet(d: FortressDef): Set<string> {
  let set = interiorSetCache.get(d)
  if (set) return set
  set = new Set<string>()
  if (d.interiorCells !== undefined) {
    for (const k of d.interiorCells) set.add(k)
  } else {
    for (let x = 0; x < d.interior.cols; x++) for (let y = 0; y < d.interior.rows; y++) set.add(`${x},${y}`)
  }
  interiorSetCache.set(d, set)
  return set
}

/** 虚拟内部空间在车体局部坐标中的左上角；始终以单位几何原点居中，不依赖外部形状。 */
export function fortressInteriorOrigin(d: FortressDef): { x: number; y: number } {
  const center = fortressLocalCenter(d)
  return { x: center.x - d.interior.cols / 2, y: center.y - d.interior.rows / 2 }
}

/** 堡垒定义校验（编辑器保存/导入闸）：返回错误列表，空数组 = 通过 */
export function validateFortressDef(d: FortressDef): string[] {
  const errs: string[] = []
  if (d.destructionEffect !== undefined && !['small', 'medium', 'large', 'violent'].includes(d.destructionEffect)) errs.push('摧毁效果模板非法')
  if (!Number.isFinite(d.hp) || d.hp <= 0) errs.push('耐久必须是大于 0 的有限数值')
  if (d.vision !== undefined && (!Number.isFinite(d.vision) || d.vision < 0 || d.vision > 200)) errs.push('视野需在 0~640 米')
  if (d.trackingVision !== undefined && (!Number.isFinite(d.trackingVision) || d.trackingVision < (d.vision ?? 8) || d.trackingVision > 300)) errs.push('追踪视野需在索敌视野至 960 米之间')
  if (d.ramWeight !== undefined && !['light', 'medium', 'heavy'].includes(d.ramWeight)) errs.push('重量级别仅支持 light / medium / heavy')
  if (d.armor && Object.entries(d.armor).some(([, v]) => !Number.isFinite(v) || v < 0 || v > 10000)) errs.push('四向装甲需在 0~10000')
  if (d.paint && !/^#[0-9a-f]{6}$/i.test(d.paint.base)) errs.push('涂装主体色须为 #RRGGBB')
  if (d.paint?.accent && !/^#[0-9a-f]{6}$/i.test(d.paint.accent)) errs.push('涂装强调色须为 #RRGGBB')
  if (d.paint?.turret && !/^#[0-9a-f]{6}$/i.test(d.paint.turret)) errs.push('涂装炮塔色须为 #RRGGBB')
  for (const decal of d.decals ?? []) {
    if (!decal.asset) errs.push(`徽记 ${decal.id} 缺少素材`)
    if (![decal.x, decal.y, decal.size, decal.angle ?? 0].every(Number.isFinite) || decal.size <= 0) errs.push(`徽记 ${decal.id} 坐标/尺寸/角度非法`)
    if (decal.x < 0 || decal.x > d.w || decal.y < 0 || decal.y > d.h) errs.push(`徽记 ${decal.id} 锚点超出载具素材范围`)
  }
  if (!Number.isFinite(d.speed) || d.speed < 0) errs.push('移动速度必须是大于等于 0 的有限数值')
  if (!(d.turnSpeed >= 15 && d.turnSpeed <= 240)) errs.push('转向速度需在 15~240 度/s')
  const chassis = d.chassis ?? 'tracked'
  if (chassis !== 'hovercraft' && chassis !== 'walker' && d.turnRadius !== undefined && !(d.turnRadius >= 0 && d.turnRadius <= 20)) errs.push('转向半径需在 0~64 米（0=按底盘物理）')
  // v2.51 底盘参数校验
  if (d.chassis !== undefined && !['tracked', 'wheeled', 'halfTracked', 'hovercraft', 'walker'].includes(d.chassis)) errs.push('底盘类型仅支持 tracked(履带)/wheeled(轮式)/halfTracked(半履带)/hovercraft(气垫)/walker(步行机甲)')
  if (d.chassis === 'halfTracked' && (!(d.tracks?.length) || !(d.wheels?.length))) errs.push('半履带载具必须同时配置履带和前轮')
  if ((chassis === 'tracked' || chassis === 'halfTracked') && d.trackWidth !== undefined && !(d.trackWidth > 0 && d.trackWidth <= 20)) errs.push('履带间距需在 0~64 米')
  if ((chassis === 'tracked' || chassis === 'halfTracked') && d.turnDrag !== undefined && !(d.turnDrag >= 0 && d.turnDrag <= 0.9)) errs.push('转向阻力需在 0~0.9')
  if ((chassis === 'wheeled' || chassis === 'halfTracked') && d.wheelbase !== undefined && !(d.wheelbase > 0 && d.wheelbase <= 30)) errs.push('轴距需在 0~96 米')
  if ((chassis === 'wheeled' || chassis === 'halfTracked') && d.steerMax !== undefined && !(d.steerMax > 0 && d.steerMax <= 80)) errs.push('最大前轮转角需在 0~80°')
  if ((chassis === 'wheeled' || chassis === 'halfTracked') && d.steerRate !== undefined && !(d.steerRate > 0 && d.steerRate <= 720)) errs.push('方向盘转速需在 0~720°/s')
  if ((chassis === 'wheeled' || chassis === 'halfTracked') && d.gripMax !== undefined && !(d.gripMax > 0 && d.gripMax <= 100)) errs.push('横向附着上限需在 0~100 m/s²')
  if (chassis === 'hovercraft' && d.hoverDrag !== undefined && !(d.hoverDrag >= 0.05 && d.hoverDrag <= 5)) errs.push('气垫滑行阻力需在 0.05~5 /s')
  if (chassis === 'hovercraft' && d.hoverGrip !== undefined && !(d.hoverGrip >= 0 && d.hoverGrip <= 10)) errs.push('气垫横向稳定需在 0~10 /s')
  const legacyWalkerFrameDuration = d.walkerFrameDuration
    ?? (d.walkerFps !== undefined && d.walkerFps > 0 ? 1 / d.walkerFps : undefined)
  const effectiveWalkerStride = d.walkerStride
    ?? (legacyWalkerFrameDuration !== undefined ? Math.max(0.01, d.speed) * legacyWalkerFrameDuration * 7 : undefined)
  if (chassis === 'walker' && !(effectiveWalkerStride !== undefined && effectiveWalkerStride >= 0.05 && effectiveWalkerStride <= 20)) errs.push('步行机甲步幅需在 0.16~64 米')
  if (d.walkerBodyOffsetX !== undefined && (!Number.isFinite(d.walkerBodyOffsetX) || Math.abs(d.walkerBodyOffsetX) > 512)) errs.push('步行机甲主体 X 坐标修正需在 -512~512 px')
  if (d.walkerBodyOffsetY !== undefined && (!Number.isFinite(d.walkerBodyOffsetY) || Math.abs(d.walkerBodyOffsetY) > 512)) errs.push('步行机甲主体 Y 坐标修正需在 -512~512 px')
  for (const w of chassis === 'walker' ? [] : d.wheels ?? []) {
    if (![w.x, w.y].every(Number.isFinite)) errs.push(`轮胎 ${w.id} 坐标须为数值`)
    if (w.unit !== undefined && w.unit !== 'single' && w.unit !== 'pair') errs.push(`轮胎 ${w.id} 单位仅支持 single(个)/pair(对)`)
    if (w.frames !== undefined && (!Number.isInteger(w.frames) || w.frames < 1 || w.frames > 64)) errs.push(`轮胎 ${w.id} 帧数需为 1~64 的整数`)
  }
  if (d.reverseFactor !== undefined && !(d.reverseFactor >= 0 && d.reverseFactor <= 1)) errs.push('倒退系数需在 0~1（如 0.8 = 倒退极速/加速度为前进的 80%）')
  if (d.brakeInertia !== undefined && !(d.brakeInertia >= 1 && d.brakeInertia <= 10)) errs.push('刹停惯性需在 1~10（1=3×加速度急停，5=同加速度，10=1/5 加速度滑行）')
  if (chassis !== 'walker' && d.pitchGain !== undefined && !(d.pitchGain >= 0 && d.pitchGain <= 10)) errs.push('车身俯仰需在 0~10（0=关闭俯仰效果）')
  if (chassis !== 'walker' && d.leanCap !== undefined && !(d.leanCap >= 1 && d.leanCap <= 8)) errs.push('俯仰位移需在 1~8 px（目标倾角上限；缺省 4）') // v1.93
  if (chassis !== 'walker' && d.tracks) for (const t of d.tracks) { // v1.85 履带参数校验
    if (![t.x1, t.y1, t.x2, t.y2].every(Number.isFinite)) errs.push(`履带 ${t.id} 轮心坐标须为数值`)
    if (!(t.radius > 0 && t.radius <= 2)) errs.push(`履带 ${t.id} 轮半径需在 0~6.4 米`)
    if (!(Number.isFinite(t.overlapPx ?? 2) && (t.overlapPx ?? 2) >= 0 && (t.overlapPx ?? 2) <= 30)) errs.push(`履带 ${t.id} 重叠需在 0~30 pix`)
    if (Math.hypot(t.x2 - t.x1, t.y2 - t.y1) <= 0.01) errs.push(`履带 ${t.id} 前后轮心不能重合`)
    if (!t.tile) errs.push(`履带 ${t.id} 缺少瓦片素材`)
  }
  if (!(d.accel >= 0.5 && d.accel <= 20)) errs.push('加速度需在 1.6~64 米/秒²')
  if (!(d.heatCap >= 50 && d.heatCap <= 2000)) errs.push('热量上限需在 50~2000')
  if (!(d.heatDissipation >= 1 && d.heatDissipation <= 100)) errs.push('自然散热需在 1~100 点/s')
  if (!(Number.isInteger(d.interior.cols) && Number.isInteger(d.interior.rows) && d.interior.cols >= 1 && d.interior.rows >= 1 && d.interior.cols <= 30 && d.interior.rows <= 30)) {
    errs.push('虚拟内部空间列数/行数需为 1~30 的整数')
  }
  if (d.bodyCollision) {
    if (!d.bodyCollision.source || !Number.isInteger(d.bodyCollision.widthPx) || !Number.isInteger(d.bodyCollision.heightPx)
      || d.bodyCollision.widthPx <= 0 || d.bodyCollision.heightPx <= 0 || d.bodyCollision.points.length < 3
      || d.bodyCollision.points.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y))) {
      errs.push('载具碰撞轮廓数据非法，请重新选择载具素材生成')
    }
  }
  // 炮位类型限制：全不勾 = 不支持任何炮塔（保存前须修复）
  for (const hp of d.hardpoints) {
    if (hp.types && hp.types.length === 0) errs.push(`炮位 ${hp.id} 类型限制全不勾：不支持任何炮塔`)
    if (hp.zLevel !== undefined && !Number.isFinite(hp.zLevel)) errs.push(`炮位 ${hp.id} 层级须为数值`) // v1.82
    if (hp.fixed !== undefined && !(Number.isFinite(hp.fixed) && hp.fixed >= -180 && hp.fixed <= 180)) errs.push(`炮位 ${hp.id} 固定视角需在 -180~180°（上方 0°，逆负顺正）`) // v1.98
    if (hp.builtIn) {
      const turret = TURRET_DEFS.find(def => def.id === hp.builtIn)
      if (!turret) errs.push(`炮位 ${hp.id} 预装炮塔不存在`)
      else {
        if (turret.mount !== hp.size) errs.push(`炮位 ${hp.id} 的预装炮塔尺寸与炮位尺寸不匹配`)
        if (hp.types && !hp.types.includes(turret.type)) errs.push(`炮位 ${hp.id} 的预装炮塔类别不在允许范围内`)
      }
    }
  }
  if (d.bodyCollision) {
    // 新协议：w/h 只是由载具素材轮廓推导的内部范围，不再与旧 shape 互相校验。
    if (!(Number.isFinite(d.w) && Number.isFinite(d.h) && d.w > 0 && d.h > 0)) errs.push('载具素材范围数据非法，请重新选择载具素材生成')
  } else {
    // 旧协议兼容：只有尚未生成主体碰撞轮廓的历史载具才读取 shape。
    const raw = d.shape ?? []
    const cells: [number, number][] = []
    let coordBad = false
    for (const k of raw) {
      const [x, y] = k.split(',').map(Number)
      if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0) { coordBad = true; break }
      cells.push([x, y])
    }
    if (!d.shape) {
      // 缺省满矩形 w×h（旧载具兼容回退）：内部模块空间已独立，不再受此外框限制。
      if (!(Number.isInteger(d.w) && Number.isInteger(d.h) && d.w >= 1 && d.h >= 1 && d.w <= 30 && d.h <= 18)) errs.push('旧载具范围 w/h 非法（1~30 / 1~18 整数）')
      for (const hp of d.hardpoints) {
        if (!(hp.x >= 0 && hp.x < d.w && hp.y >= 0 && hp.y < d.h)) errs.push(`炮位 ${hp.id} 不在旧载具范围内`)
      }
    } else if (raw.length === 0) errs.push('旧形状网格为空：至少铺设 1 格')
    else if (coordBad) errs.push('旧形状格坐标非法')
    else {
      const seen = new Set<string>()
      let maxX = 0
      let maxY = 0
      let dup = false
      for (const [x, y] of cells) {
        if (seen.has(`${x},${y}`)) { dup = true; break }
        seen.add(`${x},${y}`)
        maxX = Math.max(maxX, x)
        maxY = Math.max(maxY, y)
      }
      if (dup) errs.push('旧形状格坐标重复')
      else {
        if (maxX + 1 !== d.w || maxY + 1 !== d.h) errs.push(`旧载具范围应为 ${maxX + 1}×${maxY + 1}（当前 ${d.w}×${d.h}）`)
        // 4-连通：历史实心格须连通成整体（镂空空格不计）。
        const q: [number, number][] = [cells[0]]
        const vis = new Set<string>([`${cells[0][0]},${cells[0][1]}`])
        while (q.length) {
          const [cx, cy] = q.pop()!
          for (const [nx, ny] of [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]] as [number, number][]) {
            const kk = `${nx},${ny}`
            if (seen.has(kk) && !vis.has(kk)) { vis.add(kk); q.push([nx, ny]) }
          }
        }
        if (vis.size !== cells.length) errs.push(`旧形状网格未连通成整体（${vis.size}/${cells.length} 格可达）`)
      }
    }
  }
  // 炮位：新定义须落在主体轮廓内；旧定义继续按形状格校验。
  if (d.bodyCollision?.points.length) {
    const center = fortressLocalCenter(d)
    for (const hp of d.hardpoints) {
      if (!pointInConvexPolygon({ x: hp.x - center.x, y: hp.y - center.y }, d.bodyCollision.points)) errs.push(`炮位 ${hp.id} 不在主体轮廓内`)
    }
  } else if (d.shape) {
    for (const hp of d.hardpoints) {
      if (!fortressShapeSet(d).has(`${Math.floor(hp.x)},${Math.floor(hp.y)}`)) errs.push(`炮位 ${hp.id} 不在形状网格内`)
    }
  }
  // 自由内部格只受自身虚拟画布约束，不再要求落在主体或旧 shape 中。
  const interiorSeen = new Set<string>()
  for (const key of d.interiorCells ?? []) {
    const [x, y] = key.split(',').map(Number)
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= d.interior.cols || y >= d.interior.rows) {
      errs.push(`内部空间 (${key}) 超出虚拟网格`)
      break
    }
    if (interiorSeen.has(key)) { errs.push(`内部空间 (${key}) 重复配置`); break }
    interiorSeen.add(key)
  }
  // 特殊格：须在内部空间格集合内且不重复
  const spSeen = new Set<string>()
  const iSet = fortressInteriorSet(d)
  for (const c of d.interiorSpecials ?? []) {
    if (!iSet.has(`${c.x},${c.y}`)) errs.push(`特殊格 (${c.x},${c.y}) 超出内部空间`)
    const kk = `${c.x},${c.y}`
    if (spSeen.has(kk)) errs.push(`特殊格 (${c.x},${c.y}) 重复配置`)
    spSeen.add(kk)
  }
  // 特效点须位于载具素材范围内；旧载具仍以兼容范围判断。
  const fxSeen = new Set<string>()
  for (const fx of d.effects ?? []) {
    if (!(fx.x >= 0 && fx.x <= d.w && fx.y >= 0 && fx.y <= d.h)) errs.push(`特效点 ${fx.id} 超出载具素材范围`)
    if (fxSeen.has(fx.id)) errs.push(`特效点 id ${fx.id} 重复`)
    fxSeen.add(fx.id)
    // v2.40 粒子化参数范围（缺省走 kind 默认，配置才校验）
    if (fx.rate !== undefined && (!(fx.rate > 0) || fx.rate > 120)) errs.push(`特效点 ${fx.id} rate 须为 0~120 粒/s`)
    if (fx.life !== undefined && (!(fx.life > 0) || fx.life > 10)) errs.push(`特效点 ${fx.id} life 须为 0~10 秒`)
    if (fx.size !== undefined && (!(fx.size > 0) || fx.size > 2)) errs.push(`特效点 ${fx.id} size 须为 0~2 格`)
    if (fx.inherit !== undefined && (fx.inherit < 0 || fx.inherit > 1)) errs.push(`特效点 ${fx.id} inherit 须为 0~1`)
  }
  return errs
}

/** 堡垒占地矩形（连续坐标，单位格） */
export function fortressRect(s: GameState): { x: number; y: number; w: number; h: number } {
  const d = fortressDef(s)
  return { x: s.fortress.x, y: s.fortress.y, w: d.w, h: d.h }
}

export function fortressCenter(s: GameState): { x: number; y: number } {
  return rectGeometryCenter(fortressRect(s))
}

/**
 * 单位编辑器使用的局部几何中心。
 * 显式自由形状可能在 w×h 中带有左/上空白边距；此时原点、贴图中心和
 * 炮位相对坐标必须以实际占格包围盒为准，而不是含空白的外框中心。
 */
export function fortressLocalCenter(def: Pick<FortressDef, 'w' | 'h' | 'shape' | 'bodyCollision'>): { x: number; y: number } {
  if (def.bodyCollision?.points.length) return geometryCenter(def.w, def.h)
  if (def.shape && def.shape.length > 0) {
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const key of def.shape) {
      const [x, y] = key.split(',').map(Number)
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
    if (Number.isFinite(minX) && Number.isFinite(minY)) {
      return { x: (minX + maxX + 1) / 2, y: (minY + maxY + 1) / 2 }
    }
  }
  return geometryCenter(def.w, def.h)
}

/**
 * 堡垒有效形状的世界原点。
 * fortress.x/y 仍表示完整外框左上角；当 shape 在外框内带空白边距时，
 * 将有效形状中心平移到外框几何中心，使碰撞、占格与美术使用同一锚点。
 */
export function fortressShapeOrigin(
  def: Pick<FortressDef, 'w' | 'h' | 'shape' | 'bodyCollision'>,
  outerX: number,
  outerY: number,
): { x: number; y: number } {
  const localCenter = fortressLocalCenter(def)
  return {
    x: outerX + def.w / 2 - localCenter.x,
    y: outerY + def.h / 2 - localCenter.y,
  }
}

/** 推进目标：堡垒中心进入任一终点格即完成；区域可不规则且可由多块组成。 */
export function fortressReachedFinish(s: GameState): boolean {
  if (s.objective.type !== 'reach') return false
  const c = fortressCenter(s)
  return objectiveFinishCells(s.objective, LEVEL.finishZone, LEVEL.rows, LEVEL.cols).includes(`${Math.floor(c.x)},${Math.floor(c.y)}`)
}

/** 船体血量上限 = 堡垒基础 + 模块加成 */
export function fortressMaxHp(s: GameState): number {
  return fortressDef(s).hp + moduleBonuses(s).hpBoostPool
}

/** 移动速度 格/s = 堡垒基础 + 模块加成（下限 0.2） */
export function fortressSpeed(s: GameState): number {
  return Math.max(0.2, fortressDef(s).speed + moduleBonuses(s).speedBoostPool)
}

/** 转向速度 度/s = 堡垒基础 + 模块加成（下限 10） */
export function fortressTurnSpeed(s: GameState): number {
  return Math.max(10, fortressDef(s).turnSpeed + moduleBonuses(s).turnBoostPool)
}

/** 最小转弯半径（格，缺省 0 = 原地转向）；>0 时转向 = 绕外侧圆心弧线行驶，转弯带动前行 */
export function fortressTurnRadius(s: GameState): number {
  return Math.max(0, fortressDef(s).turnRadius ?? 0)
}

/** 可旋转轮胎的视觉偏角：优先使用配置的弧线半径，否则由实际曲率 ω/v 反推；不转弯时归零。 */
export function wheelVisualSteerAngle(s: GameState, fd: FortressDef = fortressDef(s)): number {
  const f = s.fortress
  if (Math.abs(f.turnW) < 1e-6) return 0
  const vLon = f.vx * dirX(f.heading) + f.vy * dirY(f.heading)
  const configuredRadius = Math.max(0, fd.turnRadius ?? 0)
  if (configuredRadius <= 0 && Math.abs(vLon) < 1e-6) return 0
  const radius = configuredRadius > 0 ? configuredRadius : Math.abs(vLon / f.turnW)
  const curvatureSign = Math.abs(vLon) > 1e-6 ? Math.sign(f.turnW / vLon) : Math.sign(f.turnW) * (s.reverse ? -1 : 1)
  const wheelbase = Math.max(0.5, fd.wheelbase ?? fd.h * 0.6)
  const maxAngle = Math.max(1, Math.min(80, fd.steerMax ?? 35)) * Math.PI / 180
  return Math.max(-maxAngle, Math.min(maxAngle, Math.atan(wheelbase / Math.max(1e-6, radius)) * curvatureSign))
}

/** 落印/滚动相位列（统一数据源）：履带（左定义列 + 右镜像列）在前，轮胎按“个/对”展开在后。
 *  相位推进公式统一：dphase = (纵向速度 − turnW × 横向偏移) × dt（倒退/差速/原地转向天然正确） */
/** 落印列坐标始终已展开到单位几何原点；mirror 只标识该列是右侧镜像副本，不再触发坐标二次镜像。 */
export interface MarkColumn { x1: number; y1: number; x2: number; y2: number; mirror: boolean; kind: 'track' | 'wheel'; tile: string; overlapPx: number; steered?: boolean; spriteMirror?: boolean; frames?: number }
export interface WheelPlacement { x: number; y: number; mirror: boolean }
/** 履带/轮胎坐标归一到单位几何原点：+x 向右、+y 朝车头。
 * 旧存档没有 runningGearCoordinateSpace，仍可在迁移前被正确解析。 */
export function runningGearPoint(fd: FortressDef, x: number, y: number): { x: number; y: number } {
  if (fd.runningGearCoordinateSpace === 'centered') return { x, y }
  const center = fortressLocalCenter(fd)
  return { x: x - center.x, y: center.y - y }
}

/** 轮胎放置展开：返回值始终是几何原点坐标；旧配置缺省为单个；pair 自动按物理左右排序。
 *  素材约定为左轮原图（贴图左侧朝车外、右侧朝车内），右轮始终水平反置。 */
export function wheelPlacements(fd: FortressDef, wheel: WheelDef): WheelPlacement[] {
  const point = runningGearPoint(fd, wheel.x, wheel.y)
  const one = { ...point, mirror: false }
  if (wheel.unit !== 'pair') return [one]
  const lateral = Math.abs(point.x)
  return [{ x: -lateral, y: point.y, mirror: false }, { x: lateral, y: point.y, mirror: true }]
}
/** 横向帧条帧数。内置吉普轮胎曾以单图发布，旧配置未存 frames 时自动迁移为当前 4 帧。 */
export function wheelFrameCount(wheel: Pick<WheelDef, 'sprite' | 'frames'>): number {
  const fallback = wheel.sprite === 'builtin:vehicle/jeep/wheel' || wheel.sprite === '/res/vehicles/jeep_wheel.png' ? 4 : 1
  const count = wheel.frames ?? fallback
  return Number.isFinite(count) ? Math.max(1, Math.min(64, Math.floor(count))) : fallback
}
/** 按轮胎真实位移选择横向帧条帧；负相位反向滚动，一周后无缝回到首帧。 */
export function wheelRollFrame(phase: number, frameCount: number, frameHeightPx: number): number {
  const count = Math.max(1, Math.floor(frameCount))
  if (count <= 1) return 0
  const circumference = Math.max(1, frameHeightPx) / BASE_CELL * Math.PI
  const raw = Math.floor(phase / circumference * count)
  return ((raw % count) + count) % count
}
export function fortressMarkColumns(fd: FortressDef): MarkColumn[] {
  const cols: MarkColumn[] = []
  for (const t of fd.tracks ?? []) {
    const p1 = runningGearPoint(fd, t.x1, t.y1)
    const p2 = runningGearPoint(fd, t.x2, t.y2)
    cols.push({ x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, mirror: false, kind: 'track', tile: t.tile, overlapPx: t.overlapPx, spriteMirror: false, frames: 1 })
    cols.push({ x1: -p1.x, y1: p1.y, x2: -p2.x, y2: p2.y, mirror: true, kind: 'track', tile: t.tile, overlapPx: t.overlapPx, spriteMirror: true, frames: 1 })
  }
  for (const w of fd.wheels ?? []) { // 轮胎 = 退化列（段长 0，落印取轮心点）；pair 展开为左右两列
    for (const p of wheelPlacements(fd, w)) cols.push({ x1: p.x, y1: p.y, x2: p.x, y2: p.y, mirror: p.mirror, kind: 'wheel', tile: w.sprite ?? 'builtin:library/track01', overlapPx: 0, steered: w.steered, spriteMirror: p.mirror, frames: wheelFrameCount(w) })
  }
  return cols
}

/** 倒退系数（缺省 0.8，钳制 0~1）：倒退最大速度/加速度 = 前进 × 系数 */
export function fortressReverseFactor(s: GameState): number {
  return Math.max(0, Math.min(1, fortressDef(s).reverseFactor ?? 0.8))
}

/** 刹停惯性（1~10，缺省 5）→ 减速度倍率：1 = 3×加速度（急停），5 = 1×（与加速度相同），10 = 1/5×（长滑行） */
export function brakeDecelMult(d: FortressDef): number {
  const i = Math.max(1, Math.min(10, d.brakeInertia ?? 5))
  return i <= 5 ? 3 - (i - 1) / 2 : 1 - (i - 5) * 0.16
}

// ---- v1.85 履带瓦片循环：纯函数排布计算（sim 可测；render 逐枚 drawImage） ----
export interface TrackTilePlacement { x: number; y: number; scaleY: number; alpha: number } // 与传入 TrackDef 相同的坐标空间；scaleY=长度轴压缩；alpha=翻滚渐暗
/** 履带瓦片排布：直线段全尺寸；头尾轮半径区间为透视缩短翻滚区（位置 R·sinθ 投影、长度 ×cosθ、渐暗 1−0.45sinθ、端点消失）。
 *  phase（格，引擎按真实位移累加）>0 = 前进 → 可见履带纹理向船头滚动；<0 = 倒退反滚。步长 = tileLen − overlap。
 *  v1.89：翻滚区改弧长参数化（s 沿真实履带路径，四分之一圆弧长 = R·π/2）——旧线性 θ 参数化在直线↔翻滚交界处
 *  把投影间距拉大 π/2 倍而瓦片仍近全尺寸，头尾轮处出现明显缝隙；弧长参数化后全程等间距，重叠量全程保持。 */
export function trackPlacements(t: TrackDef, phase: number, tileLen: number): TrackTilePlacement[] { // v1.87：tileLen = 瓦片原图高（格，=图高px/BASE_CELL），由调用方从素材读取
  const step = Math.max(0.01, tileLen - (t.overlapPx ?? 2) / BASE_CELL)
  const dx = t.x2 - t.x1, dy = t.y2 - t.y1
  const Lc = Math.hypot(dx, dy)
  if (Lc <= 0.01 || t.radius <= 0 || tileLen <= 0) return []
  const ux = dx / Lc, uy = dy / Lc // 船头 → 船尾方向
  const R = t.radius
  const arc89 = R * Math.PI / 2 // v1.89：四分之一轮缘弧长（格），翻滚区路径范围 = [-arc, Lc+arc]
  // 引擎相位正值代表载具前进；贴图路径的 s 正方向却是船头→船尾，
  // 因此渲染偏移必须取反，才能让画面中的履带滚动与前进/后退方向一致。
  const off = (((-phase) % step) + step) % step // [0, step)
  const out: TrackTilePlacement[] = []
  for (let s = -arc89 + off; s <= Lc + arc89; s += step) { // v1.89：s = 沿履带路径的弧长坐标（等间距 step）
    let x: number, y: number, scaleY = 1, alpha = 1
    if (s < 0) { // 前翻滚区：瓦片从船头轮下翻出（θ: 90°→0，θ = 弧长/R）
      const th = -s / R
      const d = -R * Math.sin(th)
      x = t.x1 + ux * d; y = t.y1 + uy * d
      scaleY = Math.cos(th); alpha = 1 - 0.45 * Math.sin(th)
    } else if (s > Lc) { // 后翻滚区：瓦片向船尾轮下翻没（θ: 0→90°，θ = 弧长/R）
      const th = Math.min((s - Lc) / R, Math.PI / 2)
      const d = Lc + R * Math.sin(th)
      x = t.x1 + ux * d; y = t.y1 + uy * d
      scaleY = Math.cos(th); alpha = 1 - 0.45 * Math.sin(th)
    } else { // 直线段
      x = t.x1 + ux * s; y = t.y1 + uy * s
    }
    if (scaleY < 0.05) continue // 端点压成线 = 翻到底面，不画
    out.push({ x, y, scaleY, alpha })
  }
  return out
}

/** 可直接用于预览/战场渲染的履带排布，输出统一为几何原点坐标。 */
export function centeredTrackPlacements(fd: FortressDef, t: TrackDef, phase: number, tileLen: number): TrackTilePlacement[] {
  return trackPlacements(t, phase, tileLen).map(placement => ({
    ...placement,
    ...runningGearPoint(fd, placement.x, placement.y),
  }))
}

/** 堡垒局部坐标（相对左上角，格）→ 世界坐标（绕底座中心按 heading 旋转） */
export function fortressLocalToWorld(s: GameState, lx: number, ly: number): { x: number; y: number } {
  const d = fortressDef(s)
  const c = fortressCenter(s)
  const localCenter = fortressLocalCenter(d)
  const ox = lx - localCenter.x
  const oy = ly - localCenter.y
  const cosA = Math.cos(s.fortress.heading)
  const sinA = Math.sin(s.fortress.heading)
  return { x: c.x + ox * cosA - oy * sinA, y: c.y + ox * sinA + oy * cosA }
}

/** 世界坐标 → 堡垒局部坐标（相对左上角，格；旋转逆变换） */
export function worldToFortressLocal(s: GameState, wx: number, wy: number): { x: number; y: number } {
  const d = fortressDef(s)
  const c = fortressCenter(s)
  const localCenter = fortressLocalCenter(d)
  const dx = wx - c.x
  const dy = wy - c.y
  const cosA = Math.cos(s.fortress.heading)
  const sinA = Math.sin(s.fortress.heading)
  return { x: dx * cosA + dy * sinA + localCenter.x, y: -dx * sinA + dy * cosA + localCenter.y }
}

/** 世界坐标 → 独立虚拟内部网格坐标。 */
export function worldToFortressInteriorLocal(s: GameState, wx: number, wy: number): { x: number; y: number } {
  const def = fortressDef(s)
  const local = worldToFortressLocal(s, wx, wy)
  const origin = fortressInteriorOrigin(def)
  return { x: local.x - origin.x, y: local.y - origin.y }
}

/** 炮位世界坐标（随堡垒 heading 旋转） */
export function hardpointWorldPos(s: GameState, hp: Hardpoint): { x: number; y: number } {
  return fortressLocalToWorld(s, hp.x, hp.y)
}

/** 堡垒形状格覆盖的整数格（自由网格逐格映射；寻路目标格 / blockerAt 判定共用） */
export function fortressCells(s: GameState): Cell[] {
  const d = fortressDef(s)
  if (d.bodyCollision?.points.length) {
    const center = fortressCenter(s)
    const polygon = transformBodyCollision(d.bodyCollision.points, center.x, center.y, s.fortress.heading)
    const minX = Math.max(0, Math.floor(Math.min(...polygon.map(point => point.x))))
    const maxX = Math.min(LEVEL.cols - 1, Math.floor(Math.max(...polygon.map(point => point.x))))
    const minY = Math.max(0, Math.floor(Math.min(...polygon.map(point => point.y))))
    const maxY = Math.min(LEVEL.rows - 1, Math.floor(Math.max(...polygon.map(point => point.y))))
    const cells: Cell[] = []
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      if (convexPolygonIntersectsRect(polygon, x, y, 1, 1)) cells.push({ x, y })
    }
    return cells
  }
  const origin = fortressShapeOrigin(d, s.fortress.x, s.fortress.y)
  const cells: Cell[] = []
  for (const k of fortressShapeSet(d)) {
    const [cx, cy] = k.split(',')
    const x = Math.floor(origin.x + Number(cx))
    const y = Math.floor(origin.y + Number(cy))
    if (x >= 0 && x < LEVEL.cols && y >= 0 && y < LEVEL.rows) cells.push({ x, y })
  }
  return cells
}

export function hardpointOf(s: GameState, id: string): Hardpoint | undefined {
  return fortressDef(s).hardpoints.find(h => h.id === id)
}

/** 挂载炮塔世界坐标跟随堡垒（每 tick 同步；索敌/弹道/渲染经 turretCenter 无需改动） */
export function syncTurretMounts(s: GameState) {
  for (const t of s.turrets) {
    if (!t.hardpointId) continue
    const hp = hardpointOf(s, t.hardpointId)
    if (!hp) continue
    const p = hardpointWorldPos(s, hp)
    t.x = p.x - t.w / 2
    t.y = p.y - t.h / 2
  }
}

/** 挂炮校验：炮位存在/尺寸匹配/类型兼容/未被占用/资源足够。隐藏炮塔素材不影响装配。 */
export function canMountTurret(s: GameState, defId: string, hardpointId: string): { ok: boolean; reason?: string } {
  const def = TURRET_DEFS.find(d => d.id === defId)
  if (!def) return { ok: false, reason: '未知炮塔' }
  const hp = hardpointOf(s, hardpointId)
  if (!hp) return { ok: false, reason: '炮位不存在' }
  if (def.mount !== hp.size) return { ok: false, reason: `需要 ${hp.size} 尺寸炮位` }
  if (hp.types && !hp.types.includes(def.type)) return { ok: false, reason: '炮位不兼容该炮塔类型' }
  if (s.turrets.some(t => t.hardpointId === hardpointId)) return { ok: false, reason: '炮位已占用' }
  if (s.gold < def.cost) return { ok: false, reason: '资源不足' }
  return { ok: true }
}

/** 玩家载具几何中心是否位于关卡起点区域；大载具无需把完整外框塞进起点小框。 */
export function fortressInStartZone(s: GameState, zone: LevelZone = LEVEL.startZone): boolean {
  const rect = fortressRect(s)
  const centerX = rect.x + rect.w / 2
  const centerY = rect.y + rect.h / 2
  return centerX >= zone.x && centerX < zone.x + zone.w
    && centerY >= zone.y && centerY < zone.y + zone.h
}

/** 返回关卡中可见的功能区域；不规则区域沿用事件触发格集合。 */
export function levelServiceZones(s: GameState): LevelServiceZone[] {
  const zones: LevelServiceZone[] = []
  for (const event of LEVEL.events) {
    if (event.trigger.type !== 'regionStay' || event.trigger.cells.length === 0) continue
    const runtime = s.unifiedEventStates.find(item => item.id === event.id)
    if (!event.enabled || runtime?.enabled === false) continue
    const active = runtimeConditionGroupMatches(s, event.conditions)
    for (const action of event.actions) {
      if (action.type === 'assembly') {
        zones.push({ eventId: event.id, name: event.name, cells: event.trigger.cells, service: 'assembly', active })
      } else if (action.type === 'functionalArea') {
        zones.push({
          eventId: event.id, name: event.name, cells: event.trigger.cells, service: 'functional', active,
          ammoEnabled: action.ammoEnabled, ammoPerSec: action.ammoPerSec,
          energyEnabled: action.energyEnabled, energyPerSec: action.energyPerSec,
          repairEnabled: action.repairEnabled, structurePerSec: action.structurePerSec, armorPerSec: action.armorPerSec,
          assemblyEnabled: action.assemblyEnabled,
        })
      }
    }
  }
  return zones
}

function fortressCenterCellKey(s: GameState): string {
  const center = fortressCenter(s)
  return `${Math.floor(center.x)},${Math.floor(center.y)}`
}

/** 玩家是否位于一个当前可用的整备区。 */
export function fortressInAssemblyZone(s: GameState): boolean {
  const centerKey = fortressCenterCellKey(s)
  return levelServiceZones(s).some(zone => zone.active && zone.cells.includes(centerKey)
    && (zone.service === 'assembly' || (zone.service === 'functional' && zone.assemblyEnabled)))
}

/** 玩家当前所在功能区域的合并状态；重叠区域的补给、充能与修理效率相加。 */
export function fortressSupplyStatus(s: GameState): FortressSupplyStatus {
  const centerKey = fortressCenterCellKey(s)
  const status: FortressSupplyStatus = { inside: false, ammo: false, energy: false, ammoPerSec: 0, energyPerSec: 0, repair: false, structurePerSec: 0, armorPerSec: 0, assembly: false }
  for (const zone of (s.functionalAreas ??= [])) {
    const eventRuntime = s.unifiedEventStates.find(event => event.id === zone.eventId)
    if (eventRuntime && (!eventRuntime.enabled || eventRuntime.conditionPassed === false)) continue
    if (!zone.cells.includes(centerKey)) continue
    const suppliesAmmo = zone.ammoEnabled && zone.ammoPerSec > 0
    const suppliesEnergy = zone.energyEnabled && zone.energyPerSec > 0
    const repairs = zone.repairEnabled && (zone.structurePerSec > 0 || zone.armorPerSec > 0)
    if (!suppliesAmmo && !suppliesEnergy && !repairs && !zone.assemblyEnabled) continue
    status.inside = true
    if (suppliesAmmo) { status.ammo = true; status.ammoPerSec += zone.ammoPerSec }
    if (suppliesEnergy) { status.energy = true; status.energyPerSec += zone.energyPerSec }
    if (repairs) { status.repair = true; status.structurePerSec += zone.structurePerSec; status.armorPerSec += zone.armorPerSec }
    if (zone.assemblyEnabled) status.assembly = true
  }
  return status
}

/** 主控或玩家阵营单位的炮塔资源与补给进度；战场提示、触摸详情和补给 HUD 共用。 */
export function playerUnitResourceDetails(s: GameState, unitId: number | null): PlayerUnitResourceDetails | null {
  const ally = unitId === null ? null : s.allies.find(item => item.id === unitId && item.faction === 'player' && item.hp > 0)
  if (unitId !== null && !ally) return null
  const turrets = ally ? ally.vehicle?.turrets ?? [] : s.turrets
  const bonuses = ally ? moduleBonuses(s, 'playerFaction') : moduleBonuses(s)
  const rows = turrets.map(turret => {
    const def = defOf(turret.defId)
    const caps = playerTurretResourceCaps(def, bonuses)
    return {
      turretId: turret.id,
      name: def.name,
      ammo: Math.max(0, turret.ammo ?? caps.ammoCap),
      ammoCap: caps.ammoCap,
      energy: Math.max(0, turret.energy ?? caps.energyCap),
      energyCap: caps.energyCap,
    }
  })
  const sumRatio = (key: 'ammo' | 'energy') => {
    const capKey = `${key}Cap` as const
    const totalCap = rows.reduce((sum, row) => sum + row[capKey], 0)
    return totalCap > 0 ? Math.max(0, Math.min(1, rows.reduce((sum, row) => sum + row[key], 0) / totalCap)) : 1
  }
  const center = ally ? { x: ally.x, y: ally.y } : fortressCenter(s)
  const cellKey = `${Math.floor(center.x)},${Math.floor(center.y)}`
  let supplyAmmo = false, supplyEnergy = false, supplyRepair = false
  for (const zone of s.functionalAreas ?? []) {
    const runtime = s.unifiedEventStates.find(event => event.id === zone.eventId)
    if ((runtime && (!runtime.enabled || runtime.conditionPassed === false)) || !zone.cells.includes(cellKey)) continue
    supplyAmmo ||= zone.ammoEnabled && zone.ammoPerSec > 0
    supplyEnergy ||= zone.energyEnabled && zone.energyPerSec > 0
    supplyRepair ||= zone.repairEnabled && (zone.structurePerSec > 0 || zone.armorPerSec > 0)
  }
  const hp = ally?.hp ?? s.fortress.hp
  const maxHp = ally?.maxHp ?? s.fortress.maxHp
  const armor = ally?.vehicle?.armor ?? s.fortress.armor
  const maxArmor = ally?.vehicle?.maxArmor ?? s.fortress.maxArmor
  const armorCurrent = armor.front + armor.rear + armor.left + armor.right
  const armorMax = maxArmor.front + maxArmor.rear + maxArmor.left + maxArmor.right
  return {
    unitId,
    unitName: ally ? runtimeAllyUnitDef(ally.unitDefId, ally.kind).name : fortressDef(s).name,
    ...center,
    turrets: rows,
    missingAmmo: rows.some(row => row.ammoCap > 0 && row.ammo < 1),
    missingEnergy: rows.some((row, index) => {
      if (row.energyCap <= 0) return false
      const def = defOf(turrets[index].defId)
      const need = Math.max(def.energyPerShot ?? 0, (def.type === 'beam' || def.type === 'spray') ? (def.energyPerSec ?? 0) * 0.1 : 0)
      return row.energy + 1e-9 < Math.max(Number.EPSILON, need)
    }),
    supplyAmmo: supplyAmmo && rows.some(row => row.ammoCap > 0 && row.ammo < row.ammoCap - 1e-6),
    supplyEnergy: supplyEnergy && rows.some(row => row.energyCap > 0 && row.energy < row.energyCap - 1e-6),
    supplyRepair: supplyRepair && (hp < maxHp - 1e-6 || armorCurrent < armorMax - 1e-6),
    ammoProgress: sumRatio('ammo'),
    energyProgress: sumRatio('energy'),
    repairProgress: maxHp + armorMax > 0 ? Math.max(0, Math.min(1, (hp + armorCurrent) / (maxHp + armorMax))) : 1,
  }
}

/** 载具装配统一权限：备战期、事件装配，或交战中位于整备区。
 *  没有配置整备区的旧关卡继续把起点区域作为兼容整备区。 */
export function fortressAssemblyAllowed(s: GameState): boolean {
  if (s.objective.type === 'fortressDefense') return s.phase === 'prep'
  const hasConfiguredAssemblyZone = levelServiceZones(s).some(zone => zone.service === 'assembly' || (zone.service === 'functional' && zone.assemblyEnabled))
  return s.phase === 'prep'
    || s.eventAssembly !== undefined
    || (s.phase === 'combat' && (hasConfiguredAssemblyZone ? fortressInAssemblyZone(s) : fortressInStartZone(s)))
}

export function mountTurret(s: GameState, defId: string, hardpointId: string): GameState {
  if (!fortressAssemblyAllowed(s)) return s
  if (!canMountTurret(s, defId, hardpointId).ok) return s
  const def = defOf(defId)
  const hp = hardpointOf(s, hardpointId)!
  const n = clone(s)
  n.gold -= def.cost
  n.turrets.push({
    id: n.nextId++, defId,
    x: hardpointWorldPos(n, hp).x - def.w / 2, y: hardpointWorldPos(n, hp).y - def.h / 2,
    w: def.w, h: def.h, level: 1,
    hp: def.hp, maxHp: def.hp, ...fullTurretResources(def), angle: wrapAngle(n.fortress.heading + (hp.fixed !== undefined ? hp.fixed * DEG : hp.arc ? hardpointArcMid(hp.arc) : 0)), cooldown: 0, burstLeft: 0, burstTimer: 0, // v1.99：挂载初始朝向按炮位视角——全视角=0° / 指定视角=视界中心 / 固定视角=固定角（旋转速度为 0 的炮塔也能一步到位）
    rackLeft: def.type === 'missile' ? Math.max(1, def.burst ?? 1) : 0,
    rackAnim: 0,
    rackTimer: 0,
    chargeLeft: 0, firing: false, firingLeft: 0, tickTimer: 0,
    targetId: null, barrelIdx: 0,
    hardpointId,
  })
  return n
}

/** 卸下炮塔（统一装配权限内返半价；内置武器不可拆）。 */
export function unmountTurret(s: GameState, turretId: number): GameState {
  if (!fortressAssemblyAllowed(s)) return s
  const t = s.turrets.find(t => t.id === turretId)
  if (!t || t.locked) return s
  const n = clone(s)
  if (!t.builtIn) n.gold += Math.floor(defOf(t.defId).cost / 2)
  n.turrets = n.turrets.filter(x => x.id !== turretId)
  return n
}

/**
 * 战斗整备一次性应用当前战车的完整装备草稿。
 * 所有可见炮位（含模板预装）都由草稿接管；同定义装备尽量保留运行状态，避免仅打开整备就刷新冷却。
 */
function turretLoadoutResourceDelta(current: readonly Turret[], next: Readonly<VehicleLoadoutPreset['turrets']>): number {
  const before = new Map(current.flatMap(turret => turret.hardpointId ? [[turret.hardpointId, turret] as const] : []))
  const after = new Map(next.map(item => [item.hardpointId, item.turretDefId] as const))
  let delta = 0
  for (const hardpointId of new Set([...before.keys(), ...after.keys()])) {
    const oldTurret = before.get(hardpointId)
    const newDefId = after.get(hardpointId)
    if (oldTurret?.defId === newDefId) continue
    if (oldTurret && !oldTurret.builtIn) delta -= Math.floor(defOf(oldTurret.defId).cost / 2)
    if (newDefId) delta += defOf(newDefId).cost
  }
  return delta
}

function moduleLoadoutResourceDelta(current: readonly ModuleInst[], next: Readonly<VehicleLoadoutPreset['modules']>): number {
  const keyOf = (item: Pick<ModuleInst, 'defId' | 'x' | 'y' | 'rot'>) => `${item.defId}:${item.x}:${item.y}:${item.rot}`
  const before = new Map(current.map(item => [keyOf(item), item] as const))
  const after = new Map(next.map(item => [keyOf(item), item] as const))
  let delta = 0
  for (const [key, module] of before) if (!after.has(key)) delta -= Math.floor(moduleDefOf(module.defId).cost / 2)
  for (const [key, module] of after) if (!before.has(key)) delta += moduleDefOf(module.defId).cost
  return delta
}

/** 当前主控单位应用整备草稿所需的关卡资源；负数表示拆卸返还多于新建消耗。 */
export function combatLoadoutChangeCost(s: GameState, preset: VehicleLoadoutPreset, assemblyPointLimit?: number): number | null {
  if (preset.fortressDefId !== s.fortressDefId) return null
  const normalized = normalizeCombatVehicleLoadout(preset)
  if (!normalized || normalized.turrets.length !== preset.turrets.length || normalized.modules.length !== preset.modules.length) return null
  for (const hp of fortressDef(s).hardpoints) {
    if (!hp.lockedTurret || !hp.builtIn) continue
    if (normalized.turrets.find(item => item.hardpointId === hp.id)?.turretDefId !== hp.builtIn) return null
  }
  if (assemblyPointLimit !== undefined && vehicleLoadoutAssemblyPoints(normalized) > Math.max(0, Math.round(assemblyPointLimit))) return null
  return turretLoadoutResourceDelta(s.turrets.filter(turret => turret.hardpointId), normalized.turrets)
    + moduleLoadoutResourceDelta(s.modules, normalized.modules)
}

export function applyCombatLoadout(
  s: GameState,
  preset: VehicleLoadoutPreset,
  assemblyPointLimit: number | undefined = LEVEL.assemblyPointLimit,
  chargeResources = false,
): GameState {
  if (preset.fortressDefId !== s.fortressDefId) return s
  const normalized = normalizeCombatVehicleLoadout(preset)
  if (!normalized || normalized.turrets.length !== preset.turrets.length || normalized.modules.length !== preset.modules.length) return s
  for (const hp of fortressDef(s).hardpoints) {
    if (!hp.lockedTurret || !hp.builtIn) continue
    if (normalized.turrets.find(item => item.hardpointId === hp.id)?.turretDefId !== hp.builtIn) return s
  }
  if (assemblyPointLimit !== undefined && vehicleLoadoutAssemblyPoints(normalized) > Math.max(0, Math.round(assemblyPointLimit))) return s
  const resourceDelta = chargeResources
    ? turretLoadoutResourceDelta(s.turrets.filter(turret => turret.hardpointId), normalized.turrets) + moduleLoadoutResourceDelta(s.modules, normalized.modules)
    : 0
  if (chargeResources && resourceDelta > s.gold) return s

  const n = clone(s)
  if (chargeResources) n.gold = Math.max(0, n.gold - resourceDelta)
  const previousHp = n.fortress.hp
  const mountedBefore = new Map(n.turrets.filter(turret => turret.hardpointId).map(turret => [turret.hardpointId!, turret]))
  const retainedGroundTurrets = n.turrets.filter(turret => !turret.hardpointId)
  const mounted: Turret[] = []
  for (const assignment of normalized.turrets) {
    const hp = hardpointOf(n, assignment.hardpointId)
    const def = TURRET_DEFS.find(item => item.id === assignment.turretDefId)
    if (!hp || !def) return s
    const existing = mountedBefore.get(hp.id)
    if (existing?.defId === def.id) {
      mounted.push({ ...existing, locked: hp.lockedTurret === true && hp.builtIn === def.id })
      continue
    }
    const point = hardpointWorldPos(n, hp)
    mounted.push({
      id: n.nextId++, defId: def.id,
      x: point.x - def.w / 2, y: point.y - def.h / 2,
      w: def.w, h: def.h, level: 1,
      hp: def.hp, maxHp: def.hp,
      ...fullTurretResources(def),
      angle: wrapAngle(n.fortress.heading + (hp.fixed !== undefined ? hp.fixed * DEG : hp.arc ? hardpointArcMid(hp.arc) : 0)),
      cooldown: 0, burstLeft: 0, burstTimer: 0,
      rackLeft: def.type === 'missile' ? Math.max(1, def.burst ?? 1) : 0,
      rackAnim: 0, rackTimer: 0,
      chargeLeft: 0, firing: false, firingLeft: 0, tickTimer: 0,
      targetId: null, barrelIdx: 0,
      hardpointId: hp.id, builtIn: false, locked: false,
    })
  }
  n.turrets = [...retainedGroundTurrets, ...mounted]

  const previousModules = new Map(n.modules.map(module => [`${module.defId}:${module.x}:${module.y}:${module.rot}`, module]))
  n.modules = normalized.modules.map(module => {
    const key = `${module.defId}:${module.x}:${module.y}:${module.rot}`
    const existing = previousModules.get(key)
    if (existing) return existing
    const def = moduleDefOf(module.defId)
    const instance: ModuleInst = { id: n.nextId++, ...module, timer: def.produce?.interval ?? 0 }
    if (def.produce) instance.timer = def.produce.interval / moduleSpecialMult(n, instance, 'produce')
    return instance
  })
  n.fortress.maxHp = fortressMaxHp(n)
  n.fortress.hp = Math.min(previousHp, n.fortress.maxHp)
  syncShieldCapacity(n)
  const caps = resourceCaps(n)
  n.ammo = Math.min(n.ammo, caps.ammoCap)
  n.energy = Math.min(n.energy, caps.energyCap)
  syncTurretMounts(n)
  return n
}

function playerUnitAssemblyTarget(s: GameState, allyId: number): { ally: Ally; unit: UnitDef; platform: FortressDef } | null {
  if (s.objective.type !== 'fortressDefense' || s.phase !== 'prep') return null
  const ally = s.allies.find(item => item.id === allyId && item.hp > 0 && item.faction === 'player')
  if (!ally?.vehicle) return null
  const unit = runtimeAllyUnitDef(ally.unitDefId, ally.kind)
  const platform = unitVehiclePlatform(unit)
  return platform ? { ally, unit, platform } : null
}

/** 波次准备阶段，点选玩家阵营单位主体即可把它作为炮塔整备目标。 */
export function playerUnitAssemblyTargetAt(s: GameState, x: number, y: number): number | null {
  if (s.objective.type !== 'fortressDefense' || s.phase !== 'prep') return null
  for (const ally of [...s.allies].reverse()) {
    if (ally.hp <= 0 || ally.faction !== 'player' || !ally.vehicle) continue
    const unit = runtimeAllyUnitDef(ally.unitDefId, ally.kind)
    if (!unitVehiclePlatform(unit) || !pointInsideUnitShape(x, y, ally, unit)) continue
    return ally.id
  }
  return null
}

/** 关卡玩家单位当前炮位快照；模块始终留空，由主控单位统一提供。 */
export function playerUnitCombatLoadout(s: GameState, allyId: number): VehicleLoadoutPreset | null {
  const target = playerUnitAssemblyTarget(s, allyId)
  if (!target) return null
  return {
    id: `combat-unit-${allyId}`,
    name: `${target.unit.name}·炮塔整备`,
    fortressDefId: target.platform.id,
    turrets: (target.ally.vehicle?.turrets ?? []).flatMap(turret => turret.hardpointId ? [{ hardpointId: turret.hardpointId, turretDefId: turret.defId }] : []),
    modules: [],
  }
}

function normalizedPlayerUnitCombatLoadout(
  s: GameState, allyId: number, preset: VehicleLoadoutPreset,
): { ally: Ally; unit: UnitDef; platform: FortressDef; preset: VehicleLoadoutPreset } | null {
  const target = playerUnitAssemblyTarget(s, allyId)
  if (!target || preset.fortressDefId !== target.platform.id || preset.modules.length > 0) return null
  const normalized = normalizeCombatVehicleLoadoutForDef(preset, target.platform)
  if (!normalized || normalized.turrets.length !== preset.turrets.length || normalized.modules.length !== 0) return null
  for (const hp of target.platform.hardpoints) {
    if (!hp.lockedTurret || !hp.builtIn) continue
    if (normalized.turrets.find(item => item.hardpointId === hp.id)?.turretDefId !== hp.builtIn) return null
  }
  return { ...target, preset: normalized }
}

/** 次级玩家单位整备的资源差额；它们没有独立模块装配分。 */
export function playerUnitLoadoutChangeCost(s: GameState, allyId: number, preset: VehicleLoadoutPreset): number | null {
  const target = normalizedPlayerUnitCombatLoadout(s, allyId, preset)
  if (!target) return null
  return turretLoadoutResourceDelta(target.ally.vehicle?.turrets ?? [], target.preset.turrets)
}

/** 将炮塔草稿应用到关卡玩家单位；预装炮塔默认可替换，只有显式 lockedTurret 才不可更改。 */
export function applyPlayerUnitCombatLoadout(s: GameState, allyId: number, preset: VehicleLoadoutPreset): GameState {
  const validated = normalizedPlayerUnitCombatLoadout(s, allyId, preset)
  if (!validated) return s
  const resourceDelta = turretLoadoutResourceDelta(validated.ally.vehicle?.turrets ?? [], validated.preset.turrets)
  if (resourceDelta > s.gold) return s
  const n = clone(s)
  const ally = n.allies.find(item => item.id === allyId)
  if (!ally?.vehicle) return s
  const unit = runtimeAllyUnitDef(ally.unitDefId, ally.kind)
  const platform = unitVehiclePlatform(unit)
  if (!platform) return s
  n.gold = Math.max(0, n.gold - resourceDelta)
  const before = new Map((ally.vehicle.turrets ?? []).flatMap(turret => turret.hardpointId ? [[turret.hardpointId, turret] as const] : []))
  ally.vehicle.turrets = validated.preset.turrets.map(assignment => {
    const sourceHp = platform.hardpoints.find(item => item.id === assignment.hardpointId)!
    const hp = effectiveUnitHardpoint(ally, platform, sourceHp)
    const def = defOf(assignment.turretDefId)
    const existing = before.get(hp.id)
    if (existing?.defId === def.id) return { ...existing, locked: sourceHp.lockedTurret === true && sourceHp.builtIn === def.id }
    return {
      id: n.nextId++, defId: def.id,
      x: ally.x - def.w / 2, y: ally.y - def.h / 2,
      w: def.w, h: def.h, level: 1,
      hp: def.hp, maxHp: def.hp, ...fullTurretResources(def),
      angle: wrapAngle(ally.vehicle!.heading + (hp.fixed !== undefined ? hp.fixed * DEG : hp.arc ? hardpointArcMid(hp.arc) : 0)),
      cooldown: 0, burstLeft: 0, burstTimer: 0,
      rackLeft: def.type === 'missile' ? Math.max(1, def.burst ?? 1) : 0,
      rackAnim: 0, rackTimer: 0, chargeLeft: 0,
      firing: false, firingLeft: 0, tickTimer: 0,
      targetId: null, barrelIdx: 0,
      hardpointId: hp.id,
      builtIn: false,
      locked: false,
    }
  })
  syncUnitVehicleTurrets(ally, unit)
  return n
}

/** 堡垒单轴位移：边界钳制（包围盒）+ 形状格逐格碰撞（撞停该轴，另一轴可继续 = 贴墙滑动；镂空格可越过障碍） */
function moveFortressAxis(s: GameState, dx: number, dy: number) {
  if (dx === 0 && dy === 0) return
  const d = fortressDef(s)
  const shape = fortressShapeSet(d)
  const hits = (nx: number, ny: number, ox: number, ow: number, oy: number, oh: number): boolean => {
    if (d.bodyCollision?.points.length) {
      const polygon = transformBodyCollision(d.bodyCollision.points, nx + d.w / 2, ny + d.h / 2, s.fortress.heading)
      return convexPolygonIntersectsRect(polygon, ox, oy, ow, oh)
    }
    const origin = fortressShapeOrigin(d, nx, ny)
    for (const k of shape) {
      const [cxs, cys] = k.split(',')
      const cx = origin.x + Number(cxs)
      const cy = origin.y + Number(cys)
      if (cx < ox + ow && cx + 1 > ox && cy < oy + oh && cy + 1 > oy) return true
    }
    return false
  }
  // 位移按不超过 0.2 格的步长连续检测，避免低帧率或高速移动一帧越过薄墙/物体。
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 0.2))
  const sx = dx / steps, sy = dy / steps
  for (let step = 0; step < steps; step++) {
    const nx = Math.max(0, Math.min(LEVEL.cols - d.w, s.fortress.x + sx))
    const ny = Math.max(0, Math.min(LEVEL.rows - d.h, s.fortress.y + sy))
    for (const o of s.objects) {
      if (!o.blockMove) continue
      if ((d.chassis === 'hovercraft' || d.chassis === 'walker') && heightLevel(o.height) <= 1) continue
      if (hits(nx, ny, o.x, o.w, o.y, o.h)) return
    }
    for (const w of s.walls) {
      if (w.state === 'destroyed') continue
      for (const c of w.cells) if (hits(nx, ny, c.x, 1, c.y, 1)) return
    }
    if (s.core && s.core.hp > 0 && hits(nx, ny, s.core.x, s.core.w, s.core.y, s.core.h)) return
    for (const b of s.buildings) if (hits(nx, ny, b.x, b.w, b.y, b.h)) return
    for (const ally of s.allies) {
      const footprint = unitFootprint(runtimeAllyUnitDef(ally.unitDefId, ally.kind))
      if (footprint.blocksMovement && hits(nx, ny, ally.x - footprint.w / 2, footprint.w, ally.y - footprint.h / 2, footprint.h)) return
    }
    s.fortress.x = nx
    s.fortress.y = ny
  }
}

export type FortressRamWeight = 'light' | 'medium' | 'heavy'
export const RAM_MIN_SPEED = 2
export const RAM_HIT_COOLDOWN = 0.45
export const RAM_DAMAGE_PER_SPEED = 10
export const VEHICLE_COLLISION_MIN_SPEED = 3
export const VEHICLE_COLLISION_COOLDOWN = 0.8
export const VEHICLE_COLLISION_DAMAGE_PER_SPEED = 5

/** 未显式配置重量时按实际形状占格数推导，异型/镂空载具不会按包围盒虚增重量。 */
export function fortressRamWeight(def: FortressDef): FortressRamWeight {
  if (def.ramWeight) return def.ramWeight
  const cells = fortressShapeSet(def).size
  return cells <= 12 ? 'light' : cells <= 30 ? 'medium' : 'heavy'
}

export function fortressRamWeightFactor(def: FortressDef): number {
  const weight = fortressRamWeight(def)
  return weight === 'light' ? 0.8 : weight === 'heavy' ? 1.3 : 1
}

interface VehicleCollisionSpec {
  w: number
  h: number
  points?: NonNullable<FortressDef['bodyCollision']>['points']
  armor: FortressArmor
  weight: FortressRamWeight
}

/** 地面载具与飞行载具共用的平台定义入口。 */
export function unitVehiclePlatform(unit: UnitDef): FortressDef | undefined {
  return unit.legacy?.registry === 'fortress' ? unit.legacy.def : unit.vehiclePlatform
}

function vehicleCollisionSpec(unit: UnitDef): VehicleCollisionSpec | null {
  const platform = unitVehiclePlatform(unit)
  if (platform) {
    const def = platform
    return {
      w: def.w,
      h: def.h,
      points: def.bodyCollision?.points,
      armor: structuredClone(def.armor ?? { front: 0, rear: 0, left: 0, right: 0 }),
      weight: fortressRamWeight(def),
    }
  }
  if (unit.type !== 'vehicle') return null
  const radii = unitCollisionRadii(unit)
  const w = Math.max(0.2, unit.visual?.width ?? radii.x * 2)
  const h = Math.max(0.2, unit.visual?.height ?? radii.y * 2)
  const config = unitTypeConfig(unit)
  const armor = config?.kind === 'vehicle' ? structuredClone(config.armor) : { front: 0, rear: 0, left: 0, right: 0 }
  const area = w * h
  return { w, h, armor, weight: area <= 12 ? 'light' : area <= 30 ? 'medium' : 'heavy' }
}

function ramWeightFactor(weight: FortressRamWeight): number {
  return weight === 'light' ? 0.8 : weight === 'heavy' ? 1.3 : 1
}

// ---------- 战斗空间索引（第二阶段性能优化） ----------

const UNIT_SPATIAL_BUCKET_SIZE = 4

interface SpatialUnitRef {
  side: 'enemy' | 'ally'
  id: number
  order: number
  x: number
  y: number
  radius: number
  enemy?: Enemy
  ally?: Ally
  queryStamp: number
}

interface UnitSpatialIndex {
  state: GameState
  buckets: Map<number, SpatialUnitRef[]>
  enemies: SpatialUnitRef[]
  allies: SpatialUnitRef[]
}

interface SpatialFrameCounters {
  queries: number
  candidates: number
  collisionPairs: number
  collisionBruteForcePairs: number
}

let activeUnitSpatialIndex: UnitSpatialIndex | null = null
let spatialQueryStamp = 0
let spatialFrameCounters: SpatialFrameCounters = { queries: 0, candidates: 0, collisionPairs: 0, collisionBruteForcePairs: 0 }

function spatialBucketKey(cellX: number, cellY: number): number {
  return ((cellX & 0xffff) << 16) | (cellY & 0xffff)
}

function unitBroadPhaseRadius(unit: UnitDef, scale = 1): number {
  // 宽阶段只需要几何外接圆，不读取/克隆装甲数据。
  const platform = unitVehiclePlatform(unit)
  if (platform?.bodyCollision?.points?.length) return Math.max(...platform.bodyCollision.points.map(point => Math.hypot(point.x, point.y))) * scale
  if (platform) return Math.hypot(platform.w, platform.h) * scale / 2
  if (unit.type === 'vehicle') {
    const radii = unitCollisionRadii(unit)
    const width = Math.max(0.2, unit.visual?.width ?? radii.x * 2)
    const height = Math.max(0.2, unit.visual?.height ?? radii.y * 2)
    return Math.hypot(width, height) * scale / 2
  }
  const radii = unitCollisionRadii(unit)
  return Math.max(radii.x, radii.y) * scale
}

function addSpatialRef(index: UnitSpatialIndex, ref: SpatialUnitRef): void {
  const minX = Math.floor((ref.x - ref.radius) / UNIT_SPATIAL_BUCKET_SIZE)
  const maxX = Math.floor((ref.x + ref.radius) / UNIT_SPATIAL_BUCKET_SIZE)
  const minY = Math.floor((ref.y - ref.radius) / UNIT_SPATIAL_BUCKET_SIZE)
  const maxY = Math.floor((ref.y + ref.radius) / UNIT_SPATIAL_BUCKET_SIZE)
  for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
    const key = spatialBucketKey(x, y)
    const bucket = index.buckets.get(key)
    if (bucket) bucket.push(ref)
    else index.buckets.set(key, [ref])
  }
}

/** 当前帧共享索引；单位完成位移/碰撞后显式重建，避免查询到旧坐标。 */
function rebuildUnitSpatialIndex(s: GameState): UnitSpatialIndex {
  const index: UnitSpatialIndex = { state: s, buckets: new Map(), enemies: [], allies: [] }
  for (let order = 0; order < s.enemies.length; order++) {
    const enemy = s.enemies[order]
    if (enemy.hp <= 0) continue
    const unit = runtimeEnemyUnitDef(enemy.unitDefId, enemy.kind)
    const ref: SpatialUnitRef = {
      side: 'enemy', id: enemy.id, order, x: enemy.x, y: enemy.y,
      radius: unitBroadPhaseRadius(unit, enemy.bossSizeScale ?? 1), enemy, queryStamp: 0,
    }
    index.enemies.push(ref)
    addSpatialRef(index, ref)
  }
  for (let order = 0; order < s.allies.length; order++) {
    const ally = s.allies[order]
    if (ally.hp <= 0) continue
    const unit = runtimeAllyUnitDef(ally.unitDefId, ally.kind)
    const ref: SpatialUnitRef = {
      side: 'ally', id: ally.id, order, x: ally.x, y: ally.y,
      radius: unitBroadPhaseRadius(unit), ally, queryStamp: 0,
    }
    index.allies.push(ref)
    addSpatialRef(index, ref)
  }
  activeUnitSpatialIndex = index
  return index
}

function unitSpatialIndex(s: GameState): UnitSpatialIndex {
  return activeUnitSpatialIndex?.state === s ? activeUnitSpatialIndex : rebuildUnitSpatialIndex(s)
}

/**
 * 返回与矩形宽阶段相交的单位候选；结果保持原数组顺序，确保距离并列时的旧索敌口径不变。
 * 大范围查询直接使用顺序数组，避免用极大射程枚举无意义的空桶。
 */
function querySpatialUnits(
  s: GameState, minX: number, minY: number, maxX: number, maxY: number, side: 'enemy' | 'ally',
): SpatialUnitRef[] {
  const index = unitSpatialIndex(s)
  spatialFrameCounters.queries++
  const all = side === 'enemy' ? index.enemies : index.allies
  const minCellX = Math.floor(minX / UNIT_SPATIAL_BUCKET_SIZE)
  const maxCellX = Math.floor(maxX / UNIT_SPATIAL_BUCKET_SIZE)
  const minCellY = Math.floor(minY / UNIT_SPATIAL_BUCKET_SIZE)
  const maxCellY = Math.floor(maxY / UNIT_SPATIAL_BUCKET_SIZE)
  const cellCount = Math.max(0, maxCellX - minCellX + 1) * Math.max(0, maxCellY - minCellY + 1)
  if (!Number.isFinite(cellCount) || cellCount > Math.max(64, index.buckets.size * 2)) {
    spatialFrameCounters.candidates += all.length
    return all
  }
  const stamp = ++spatialQueryStamp
  const result: SpatialUnitRef[] = []
  for (let cellY = minCellY; cellY <= maxCellY; cellY++) for (let cellX = minCellX; cellX <= maxCellX; cellX++) {
    const bucket = index.buckets.get(spatialBucketKey(cellX, cellY))
    if (!bucket) continue
    for (const ref of bucket) {
      if (ref.side !== side || ref.queryStamp === stamp) continue
      ref.queryStamp = stamp
      if (ref.x + ref.radius < minX || ref.x - ref.radius > maxX || ref.y + ref.radius < minY || ref.y - ref.radius > maxY) continue
      result.push(ref)
    }
  }
  result.sort((a, b) => a.order - b.order)
  spatialFrameCounters.candidates += result.length
  return result
}

export interface EnginePerformanceSnapshot {
  sampleEvery: number
  samples: number
  totalMs: number
  totalMaxMs: number
  allyAiMs: number
  enemyAiMs: number
  collisionMs: number
  targetingWeaponsMs: number
  projectileMs: number
  eventMs: number
  enemies: number
  allies: number
  projectiles: number
  spatialQueries: number
  spatialCandidates: number
  collisionPairs: number
  collisionBruteForcePairs: number
}

type EnginePerfPart = 'allyAiMs' | 'enemyAiMs' | 'collisionMs' | 'targetingWeaponsMs' | 'projectileMs' | 'eventMs'
const ENGINE_PERF_SAMPLE_EVERY = 10
const enginePerf: EnginePerformanceSnapshot = {
  sampleEvery: ENGINE_PERF_SAMPLE_EVERY, samples: 0, totalMs: 0, totalMaxMs: 0,
  allyAiMs: 0, enemyAiMs: 0, collisionMs: 0, targetingWeaponsMs: 0, projectileMs: 0, eventMs: 0,
  enemies: 0, allies: 0, projectiles: 0, spatialQueries: 0, spatialCandidates: 0,
  collisionPairs: 0, collisionBruteForcePairs: 0,
}
let enginePerfTickCounter = 0
let enginePerfSampleActive = false
let enginePerfFrameStartedAt = 0
let enginePerfWork: Record<EnginePerfPart, number> = {
  allyAiMs: 0, enemyAiMs: 0, collisionMs: 0, targetingWeaponsMs: 0, projectileMs: 0, eventMs: 0,
}

function enginePerfNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

function beginEnginePerfFrame(): void {
  enginePerfSampleActive = ++enginePerfTickCounter % ENGINE_PERF_SAMPLE_EVERY === 0
  if (!enginePerfSampleActive) return
  enginePerfFrameStartedAt = enginePerfNow()
  enginePerfWork = { allyAiMs: 0, enemyAiMs: 0, collisionMs: 0, targetingWeaponsMs: 0, projectileMs: 0, eventMs: 0 }
}

function beginEnginePerfPart(): number {
  return enginePerfSampleActive ? enginePerfNow() : 0
}

function endEnginePerfPart(part: EnginePerfPart, startedAt: number): void {
  if (enginePerfSampleActive) enginePerfWork[part] += enginePerfNow() - startedAt
}

function finishEnginePerfFrame(s: GameState): void {
  if (!enginePerfSampleActive) return
  const total = enginePerfNow() - enginePerfFrameStartedAt
  const smooth = (previous: number, current: number) => enginePerf.samples === 0 ? current : previous * 0.85 + current * 0.15
  enginePerf.totalMs = smooth(enginePerf.totalMs, total)
  enginePerf.totalMaxMs = Math.max(enginePerf.totalMaxMs, total)
  for (const part of Object.keys(enginePerfWork) as EnginePerfPart[]) enginePerf[part] = smooth(enginePerf[part], enginePerfWork[part])
  enginePerf.enemies = s.enemies.length
  enginePerf.allies = s.allies.length
  enginePerf.projectiles = s.projectiles.length + s.enemyProjectiles.length
  enginePerf.spatialQueries = spatialFrameCounters.queries
  enginePerf.spatialCandidates = spatialFrameCounters.candidates
  enginePerf.collisionPairs = spatialFrameCounters.collisionPairs
  enginePerf.collisionBruteForcePairs = spatialFrameCounters.collisionBruteForcePairs
  enginePerf.samples++
  enginePerfSampleActive = false
}

/** 调试面板与浏览器性能探针读取；返回副本，避免外部改写采样器。 */
export function enginePerformanceSnapshot(): EnginePerformanceSnapshot {
  return { ...enginePerf }
}

function ellipseOverlapsRect(cx: number, cy: number, rx: number, ry: number, x: number, y: number, w: number, h: number): boolean {
  const qx = Math.max(x, Math.min(x + w, cx))
  const qy = Math.max(y, Math.min(y + h, cy))
  const nx = (cx - qx) / Math.max(1e-6, rx)
  const ny = (cy - qy) / Math.max(1e-6, ry)
  return nx * nx + ny * ny <= 1
}

function enemyOverlapsFortressShape(s: GameState, e: Enemy, unit: UnitDef): boolean {
  if (fortressDef(s).bodyCollision?.points.length) {
    return groundUnitFortressOverlap(s, e.x, e.y, unit, 1) !== null
  }
  const radii = unitCollisionRadii(unit)
  const def = fortressDef(s)
  const origin = fortressShapeOrigin(def, s.fortress.x, s.fortress.y)
  for (const key of fortressShapeSet(def)) {
    const [lx, ly] = key.split(',').map(Number)
    if (ellipseOverlapsRect(e.x, e.y, radii.x, radii.y, origin.x + lx, origin.y + ly, 1, 1)) return true
  }
  return false
}

/** 沿载具实际移动方向推出地面单位；大型单位按碰撞半径连续衰减，超大型单位只受伤不位移。 */
function pushRammedEnemy(s: GameState, e: Enemy, unit: UnitDef, ux: number, uy: number, speed: number): void {
  const radii = unitCollisionRadii(unit)
  const size = Math.max(radii.x, radii.y)
  const sizeFactor = Math.max(0, Math.min(1, (0.9 - size) / 0.6))
  const distance = (0.35 + Math.min(0.75, speed * 0.12)) * sizeFactor
  if (distance <= 0) return
  const startX = e.x, startY = e.y
  const stride = 0.08
  for (let traveled = stride; traveled <= distance + 1e-6; traveled += stride) {
    const x = startX + ux * traveled
    const y = startY + uy * traveled
    if (x - radii.x < 0 || x + radii.x > LEVEL.cols || y - radii.y < 0 || y + radii.y > LEVEL.rows) break
    const blocker = blockerAt(s, Math.floor(x), Math.floor(y))
    if (blocker && blocker.kind !== 'fortress') break
    e.x = x
    e.y = y
  }
  e.hasGoal = false
  e.pathVersion = -1
}

/**
 * 移动堡垒碾压：只处理地面敌方单位；伤害 = 实际速度 × 重量系数 × 基准伤害。
 * vx/vy 必须是本 tick 的真实位移速度，撞墙空转不会造成碾压。
 */
export function applyFortressRamming(s: GameState, vx: number, vy: number): number {
  const speed = Math.hypot(vx, vy)
  if (speed < RAM_MIN_SPEED || s.fortress.dyingT >= 0) return 0
  const ux = vx / speed, uy = vy / speed
  const damage = speed * RAM_DAMAGE_PER_SPEED * fortressRamWeightFactor(fortressDef(s))
  let hits = 0
  for (const e of s.enemies) {
    if (e.hp <= 0) continue
    const unit = runtimeEnemyUnitDef(e.unitDefId, e.kind)
    if (unit.stats.air || unit.type === 'vehicle' || !enemyOverlapsFortressShape(s, e, unit)) continue
    if (s.time - (e.rammedAt ?? -Infinity) < RAM_HIT_COOLDOWN) continue
    e.rammedAt = s.time
    damageEnemy(s, e, damage, null, {
      x: fortressCenter(s).x, y: fortressCenter(s).y, attackerSide: 'fortress', attackerId: 0, visualKind: 'ramming',
    })
    pushRammedEnemy(s, e, unit, ux, uy, speed)
    addFloat(s, e.x, e.y, `碾压 -${Math.round(damage)}`, 'ramming')
    hits++
  }
  if (hits > 0) { const center = fortressCenter(s); (s.audioSignals ??= []).push({ id: s.nextId++, kind: 'crush', intensity: Math.min(1.5, 0.75 + speed * 0.1), x: center.x, y: center.y, left: 0.25 }) }
  return hits
}

interface CollisionRect { x: number; y: number; w: number; h: number; heading: number; points?: NonNullable<FortressDef['bodyCollision']>['points']; scale?: number }

function collisionPolygon(body: CollisionRect): { x: number; y: number }[] {
  if (body.points?.length) return transformBodyCollision(body.points, body.x, body.y, body.heading, body.scale ?? 1)
  const points = [
    { x: -body.w / 2, y: -body.h / 2 }, { x: body.w / 2, y: -body.h / 2 },
    { x: body.w / 2, y: body.h / 2 }, { x: -body.w / 2, y: body.h / 2 },
  ]
  return transformBodyCollision(points, body.x, body.y, body.heading)
}

/** 凸多边形 SAT；没有主体轮廓的旧载具自动退回旋转矩形。法线由 a 指向 b。 */
function vehicleRectOverlap(a: CollisionRect, b: CollisionRect): { nx: number; ny: number; depth: number } | null {
  const polygonA = collisionPolygon(a)
  const polygonB = collisionPolygon(b)
  const axes: { x: number; y: number }[] = []
  for (const polygon of [polygonA, polygonB]) for (let index = 0; index < polygon.length; index++) {
    const start = polygon[index]
    const end = polygon[(index + 1) % polygon.length]
    const edgeX = end.x - start.x, edgeY = end.y - start.y
    const length = Math.hypot(edgeX, edgeY)
    if (length > 1e-8) axes.push({ x: -edgeY / length, y: edgeX / length })
  }
  const dx = b.x - a.x, dy = b.y - a.y
  let bestDepth = Infinity, bestX = 0, bestY = 0
  for (const axis of axes) {
    const projectionA = polygonA.map(point => point.x * axis.x + point.y * axis.y)
    const projectionB = polygonB.map(point => point.x * axis.x + point.y * axis.y)
    const depth = Math.min(Math.max(...projectionA), Math.max(...projectionB)) - Math.max(Math.min(...projectionA), Math.min(...projectionB))
    if (depth <= 0) return null
    if (depth < bestDepth) {
      const sign = dx * axis.x + dy * axis.y < 0 ? -1 : 1
      bestDepth = depth
      bestX = axis.x * sign
      bestY = axis.y * sign
    }
  }
  return { nx: bestX, ny: bestY, depth: bestDepth }
}

/** 非载具地面单位（椭圆）与玩家旋转车体的接触法线及穿透深度。 */
function groundUnitFortressOverlap(s: GameState, x: number, y: number, unit: UnitDef, scale = 1): { nx: number; ny: number; depth: number } | null {
  const body = fortressDef(s).bodyCollision
  if (body?.points.length) {
    const radii = unitCollisionRadii(unit)
    const ellipse = Array.from({ length: 16 }, (_, index) => {
      const angle = index / 16 * Math.PI * 2
      return { x: Math.cos(angle) * radii.x * scale, y: Math.sin(angle) * radii.y * scale }
    })
    const center = fortressCenter(s)
    return vehicleRectOverlap(
      { x: center.x, y: center.y, w: fortressDef(s).w, h: fortressDef(s).h, heading: s.fortress.heading, points: body.points },
      { x, y, w: radii.x * 2 * scale, h: radii.y * 2 * scale, heading: 0, points: ellipse },
    )
  }
  const fortress = fortressRect(s)
  const cx = fortress.x + fortress.w / 2, cy = fortress.y + fortress.h / 2
  const c = Math.cos(s.fortress.heading), sn = Math.sin(s.fortress.heading)
  const dx = x - cx, dy = y - cy
  const localX = dx * c + dy * sn
  const localY = dx * -sn + dy * c
  const halfW = fortress.w / 2, halfH = fortress.h / 2
  const closestX = Math.max(-halfW, Math.min(halfW, localX))
  const closestY = Math.max(-halfH, Math.min(halfH, localY))
  const outsideX = localX - closestX, outsideY = localY - closestY
  const outsideDistance = Math.hypot(outsideX, outsideY)
  const radii = unitCollisionRadii(unit)
  const support = (nx: number, ny: number) => Math.hypot(radii.x * nx, radii.y * ny) * scale
  if (outsideDistance > 1e-7) {
    const localNx = outsideX / outsideDistance, localNy = outsideY / outsideDistance
    const nx = localNx * c - localNy * sn
    const ny = localNx * sn + localNy * c
    const depth = support(nx, ny) - outsideDistance
    return depth > 0 ? { nx, ny, depth } : null
  }
  // 单位中心位于车体内部时，沿最近车体边推出。
  const faceX = halfW - Math.abs(localX), faceY = halfH - Math.abs(localY)
  const localNx = faceX <= faceY ? (localX < 0 ? -1 : 1) : 0
  const localNy = faceX <= faceY ? 0 : (localY < 0 ? -1 : 1)
  const nx = localNx * c - localNy * sn
  const ny = localNx * sn + localNy * c
  return { nx, ny, depth: Math.min(faceX, faceY) + support(nx, ny) }
}

/** 玩家堡垒与所有地面单位的实体接触；载具冲撞按相对速度结算，同阵营仅分离。 */
export function applyFortressVehicleCollisions(s: GameState, playerVx: number, playerVy: number): number {
  if (s.fortress.dyingT >= 0) return 0
  const playerDef = fortressDef(s)
  let playerCenter = fortressCenter(s)
  const playerWeight = fortressRamWeightFactor(playerDef)
  const playerStartX = s.fortress.x, playerStartY = s.fortress.y
  let hits = 0
  for (const e of s.enemies) {
    if (e.hp <= 0 || !e.vehicle) continue
    const unit = runtimeEnemyUnitDef(e.unitDefId, e.kind)
    if (unit.stats.air) continue
    const spec = vehicleCollisionSpec(unit)
    if (!spec) continue
    const bossScale = e.bossSizeScale ?? 1
    const overlap = vehicleRectOverlap(
      { x: playerCenter.x, y: playerCenter.y, w: playerDef.w, h: playerDef.h, heading: s.fortress.heading, points: playerDef.bodyCollision?.points },
      { x: e.x, y: e.y, w: spec.w * bossScale, h: spec.h * bossScale, heading: e.vehicle.heading, points: spec.points, scale: bossScale },
    )
    if (!overlap) continue

    const enemyWeight = ramWeightFactor(spec.weight)
    const totalWeight = playerWeight + enemyWeight
    const separation = overlap.depth + 0.025
    moveFortressAxis(s, -overlap.nx * separation * enemyWeight / totalWeight, -overlap.ny * separation * enemyWeight / totalWeight)
    e.x = Math.max(spec.w * bossScale / 2, Math.min(LEVEL.cols - spec.w * bossScale / 2, e.x + overlap.nx * separation * playerWeight / totalWeight))
    e.y = Math.max(spec.h * bossScale / 2, Math.min(LEVEL.rows - spec.h * bossScale / 2, e.y + overlap.ny * separation * playerWeight / totalWeight))
    e.hasGoal = false
    e.pathVersion = -1
    playerCenter = fortressCenter(s)

    if (s.phase !== 'combat') continue
    const relativeSpeed = Math.hypot(playerVx - e.vehicle.vx, playerVy - e.vehicle.vy)
    if (relativeSpeed < VEHICLE_COLLISION_MIN_SPEED || s.time - (e.vehicle.lastCollisionAt ?? -Infinity) < VEHICLE_COLLISION_COOLDOWN) continue
    e.vehicle.lastCollisionAt = s.time
    const baseDamage = relativeSpeed * VEHICLE_COLLISION_DAMAGE_PER_SPEED
    const enemyDamage = baseDamage * playerWeight / enemyWeight
    const playerDamage = baseDamage * enemyWeight / playerWeight
    const beforeHp = e.hp
    damageEnemy(s, e, enemyDamage, null, {
      x: playerCenter.x, y: playerCenter.y, attackerSide: 'fortress', attackerId: 0,
      armorPen: 0.45, armorDamage: enemyDamage * 0.35, visualKind: 'ramming',
    })
    const dealt = Math.max(0, beforeHp - e.hp)
    const received = damageFortress(s, playerDamage, {
      x: e.x, y: e.y, kind: 'melee', armorPen: 0.45, armorDamage: playerDamage * 0.35, visualKind: 'ramming',
    }).structureDamage
    s.fortress.vx *= 0.45 + 0.35 * playerWeight / totalWeight
    s.fortress.vy *= 0.45 + 0.35 * playerWeight / totalWeight
    e.vehicle.vx *= 0.3
    e.vehicle.vy *= 0.3
    addFloat(s, e.x, e.y, `冲撞 -${Math.round(dealt)}`, 'ramming')
    ;(s.audioSignals ??= []).push({ id: s.nextId++, kind: 'vehicleCollision', intensity: Math.min(2, relativeSpeed / VEHICLE_COLLISION_MIN_SPEED), x: e.x, y: e.y, left: 0.25 })
    if (received > 0) addFloat(s, playerCenter.x, playerCenter.y, `受撞 -${Math.round(received)}`, 'ramming')
    hits++
  }
  // 友军载具与玩家堡垒同样使用旋转矩形和重量分离；同阵营接触不造成冲撞伤害。
  for (const ally of s.allies) {
    if (ally.hp <= 0 || !ally.vehicle) continue
    const unit = runtimeAllyUnitDef(ally.unitDefId, ally.kind)
    if (unit.stats.air) continue
    const spec = vehicleCollisionSpec(unit)
    if (!spec) continue
    const overlap = vehicleRectOverlap(
      { x: playerCenter.x, y: playerCenter.y, w: playerDef.w, h: playerDef.h, heading: s.fortress.heading, points: playerDef.bodyCollision?.points },
      { x: ally.x, y: ally.y, w: spec.w, h: spec.h, heading: ally.vehicle.heading, points: spec.points },
    )
    if (!overlap) continue
    const allyWeight = ramWeightFactor(spec.weight)
    const totalWeight = playerWeight + allyWeight
    const separation = overlap.depth + 0.025
    moveFortressAxis(s, -overlap.nx * separation * allyWeight / totalWeight, -overlap.ny * separation * allyWeight / totalWeight)
    ally.x = Math.max(spec.w / 2, Math.min(LEVEL.cols - spec.w / 2, ally.x + overlap.nx * separation * playerWeight / totalWeight))
    ally.y = Math.max(spec.h / 2, Math.min(LEVEL.rows - spec.h / 2, ally.y + overlap.ny * separation * playerWeight / totalWeight))
    s.fortress.vx *= 0.45 + 0.35 * playerWeight / totalWeight
    s.fortress.vy *= 0.45 + 0.35 * playerWeight / totalWeight
    // 同阵营接触允许沿玩家车体边缘滑动，只削减继续挤向玩家的法向速度。
    dampVehicleClosingVelocity(ally.vehicle, overlap.nx, overlap.ny, -1)
    playerCenter = fortressCenter(s)
  }
  const playerInverseMass = (playerDef.bodyLocked || s.objective.type === 'fortressDefense') ? 0 : 1 / Math.max(1, playerDef.w * playerDef.h)
  const separateGroundUnit = (host: Enemy | Ally, unit: UnitDef, scale: number, immovable: boolean) => {
    if (unit.stats.air || unit.type === 'vehicle') return
    const overlap = groundUnitFortressOverlap(s, host.x, host.y, unit, scale)
    if (!overlap) return
    const unitInverseMass = groundUnitInverseMass(unit, immovable)
    const totalInverseMass = playerInverseMass + unitInverseMass
    if (totalInverseMass <= 0) return
    const correction = overlap.depth + 0.025
    const playerMove = correction * playerInverseMass / totalInverseMass
    const unitMove = correction * unitInverseMass / totalInverseMass
    moveFortressAxis(s, -overlap.nx * playerMove, -overlap.ny * playerMove)
    const moved = moveGroundUnitWithBlockers(s, unit, host.x, host.y, overlap.nx * unitMove, overlap.ny * unitMove, null, scale, host.id)
    host.x = moved.x
    host.y = moved.y
    if ('hasGoal' in host) { host.hasGoal = false; host.pathVersion = -1 }
    playerCenter = fortressCenter(s)
  }
  for (const enemy of s.enemies) if (enemy.hp > 0) {
    const unit = runtimeEnemyUnitDef(enemy.unitDefId, enemy.kind)
    separateGroundUnit(enemy, unit, enemy.bossSizeScale ?? 1, (enemy.controller ?? 'ai') === 'static' || unit.bodyLocked === true || placementBodyLocks(enemy).movement)
  }
  for (const ally of s.allies) if (ally.hp > 0) {
    const unit = runtimeAllyUnitDef(ally.unitDefId, ally.kind)
    separateGroundUnit(ally, unit, 1, (ally.controller ?? 'ai') === 'static' || unit.bodyLocked === true || placementBodyLocks(ally).movement)
  }
  if (s.objective.type === 'fortressDefense' || fortressDef(s).bodyLocked) {
    s.fortress.x = playerStartX; s.fortress.y = playerStartY; s.fortress.vx = 0; s.fortress.vy = 0
  }
  if (s.fortress.x !== playerStartX || s.fortress.y !== playerStartY) {
    syncTurretMounts(s)
    const center = fortressCenter(s)
    const cellX = Math.floor(center.x), cellY = Math.floor(center.y)
    if (cellX !== s.fortCellX || cellY !== s.fortCellY) {
      s.fortCellX = cellX
      s.fortCellY = cellY
      s.pathVersion++
    }
  }
  // 碰撞分离会直接改写非玩家单位的主体坐标；炮塔必须在同一帧跟随宿主，
  // 否则友军被堡垒推开时会出现“车体移动、炮塔留在原地”的视觉脱节。
  syncAllUnitVehicleTurrets(s)
  return hits
}

interface GroundUnitCollisionBody {
  id: number
  x: number
  y: number
  def: UnitDef
  heading: number | null
  scale: number
  inverseMass: number
  enemy?: Enemy
  ally?: Ally
}

/** 单位碰撞在指定世界方向上的支撑半径：载具使用旋转矩形，其他单位使用编辑器碰撞椭圆。 */
function groundUnitSupport(body: GroundUnitCollisionBody, ux: number, uy: number): number {
  const spec = body.heading !== null ? vehicleCollisionSpec(body.def) : null
  if (spec && body.heading !== null) {
    if (spec.points?.length) {
      const c = Math.cos(body.heading), sn = Math.sin(body.heading)
      const localX = ux * c + uy * sn
      const localY = ux * -sn + uy * c
      return Math.max(...spec.points.map(point => point.x * localX + point.y * localY)) * body.scale
    }
    const c = Math.cos(body.heading), sn = Math.sin(body.heading)
    const alongX = Math.abs(ux * c + uy * sn)
    const alongY = Math.abs(ux * -sn + uy * c)
    return (alongX * spec.w + alongY * spec.h) * body.scale / 2
  }
  const radii = unitCollisionRadii(body.def)
  return Math.hypot(radii.x * ux, radii.y * uy) * body.scale
}

function groundUnitInverseMass(def: UnitDef, immovable: boolean): number {
  if (immovable || def.type === 'building') return 0
  const spec = vehicleCollisionSpec(def)
  if (spec) return 1 / Math.max(1, spec.w * spec.h)
  const radii = unitCollisionRadii(def)
  return 1 / Math.max(0.3, Math.PI * radii.x * radii.y)
}

/**
 * 碰撞只削减继续挤向另一单位的法向速度，切向速度完整保留。
 * towardSign=1 表示法线指向目标，-1 表示法线背向目标。
 */
function dampVehicleClosingVelocity(vehicle: UnitVehicleRuntime, nx: number, ny: number, towardSign: 1 | -1, retain = 0.55): void {
  const normalSpeed = vehicle.vx * nx + vehicle.vy * ny
  if (normalSpeed * towardSign <= 0) return
  const removed = normalSpeed * (1 - retain)
  vehicle.vx -= nx * removed
  vehicle.vy -= ny * removed
}

/** 两台载具只按相对接近速度产生分离冲量；同速并排或同速跟车不会被减速。 */
function dampVehiclePairClosingVelocity(
  a: UnitVehicleRuntime, b: UnitVehicleRuntime, nx: number, ny: number,
  inverseMassA: number, inverseMassB: number, retain = 0.55,
): void {
  const closingSpeed = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny
  if (closingSpeed <= 0) return
  const totalInverseMass = inverseMassA + inverseMassB
  if (totalInverseMass <= 0) return
  const impulse = closingSpeed * (1 - retain) / totalInverseMass
  a.vx -= nx * impulse * inverseMassA
  a.vy -= ny * impulse * inverseMassA
  b.vx += nx * impulse * inverseMassB
  b.vy += ny * impulse * inverseMassB
}

/** 宽阶段仅生成可能相交的单位对，并按旧版 i→j 顺序排序后交给精确碰撞。 */
function collisionCandidatePairs(bodies: GroundUnitCollisionBody[]): number[] {
  const buckets = new Map<number, number[]>()
  for (let index = 0; index < bodies.length; index++) {
    const body = bodies[index]
    const radius = unitBroadPhaseRadius(body.def, body.scale) + 0.02
    const minX = Math.floor((body.x - radius) / UNIT_SPATIAL_BUCKET_SIZE)
    const maxX = Math.floor((body.x + radius) / UNIT_SPATIAL_BUCKET_SIZE)
    const minY = Math.floor((body.y - radius) / UNIT_SPATIAL_BUCKET_SIZE)
    const maxY = Math.floor((body.y + radius) / UNIT_SPATIAL_BUCKET_SIZE)
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const key = spatialBucketKey(x, y)
      const bucket = buckets.get(key)
      if (bucket) bucket.push(index)
      else buckets.set(key, [index])
    }
  }
  const encoded = new Set<number>()
  const width = bodies.length
  for (const bucket of buckets.values()) {
    for (let a = 0; a < bucket.length; a++) for (let b = a + 1; b < bucket.length; b++) {
      const i = Math.min(bucket[a], bucket[b])
      const j = Math.max(bucket[a], bucket[b])
      encoded.add(i * width + j)
    }
  }
  const result = [...encoded]
  result.sort((a, b) => a - b)
  return result
}

/**
 * 地面单位统一实体分离：敌人、友军和载具均不能占据同一空间；空中单位不参与。
 * 多轮松弛可稳定解开同一出生点的大量单位，同时按质量让大型载具更难被小单位推开。
 */
export function resolveUnitCollisions(s: GameState, iterations = 4): number {
  const perfStartedAt = beginEnginePerfPart()
  const bodies: GroundUnitCollisionBody[] = []
  for (const enemy of s.enemies) {
    if (enemy.hp <= 0) continue
    const def = runtimeEnemyUnitDef(enemy.unitDefId, enemy.kind)
    if (def.stats.air) continue
    const immovable = (enemy.controller ?? 'ai') === 'static' || def.bodyLocked === true || placementBodyLocks(enemy).movement
    bodies.push({
      id: enemy.id, x: enemy.x, y: enemy.y, def,
      heading: enemy.vehicle?.heading ?? null,
      scale: enemy.bossSizeScale ?? 1,
      inverseMass: groundUnitInverseMass(def, immovable), enemy,
    })
  }
  for (const ally of s.allies) {
    if (ally.hp <= 0) continue
    const def = runtimeAllyUnitDef(ally.unitDefId, ally.kind)
    if (def.stats.air) continue
    const immovable = (ally.controller ?? 'ai') === 'static' || def.bodyLocked === true || placementBodyLocks(ally).movement
    bodies.push({
      id: ally.id, x: ally.x, y: ally.y, def,
      heading: ally.vehicle?.heading ?? null, scale: 1,
      inverseMass: groundUnitInverseMass(def, immovable), ally,
    })
  }
  const touched = new Set<string>()
  const passes = Math.max(1, Math.min(8, Math.round(iterations)))
  for (let pass = 0; pass < passes; pass++) {
    let adjusted = false
    const candidatePairs = collisionCandidatePairs(bodies)
    if (pass === 0) {
      spatialFrameCounters.collisionPairs += candidatePairs.length
      spatialFrameCounters.collisionBruteForcePairs += bodies.length * Math.max(0, bodies.length - 1) / 2
    }
    for (const encodedPair of candidatePairs) {
      const i = Math.floor(encodedPair / bodies.length)
      const j = encodedPair % bodies.length
      const a = bodies[i], b = bodies[j]
      const totalInverseMass = a.inverseMass + b.inverseMass
      const dx = b.x - a.x, dy = b.y - a.y
      const distance = Math.hypot(dx, dy)
      let nx: number, ny: number
      if (distance < 1e-7) {
        // 完全同点时按实体 id 给出确定性方向，避免随机抖动或永远无法分开。
        const angle = ((a.id * 73856093 + b.id * 19349663) >>> 0) / 0xffffffff * Math.PI * 2
        nx = Math.cos(angle); ny = Math.sin(angle)
      } else {
        nx = dx / distance; ny = dy / distance
      }
      const minimumDistance = groundUnitSupport(a, nx, ny) + groundUnitSupport(b, -nx, -ny) + 0.015
      const penetration = minimumDistance - distance
      if (penetration <= 0) continue
      // 敌对载具之间与玩家冲撞使用同一速度/重量/装甲口径；同阵营只做实体分离。
      if (s.phase === 'combat' && pass === 0 && a.heading !== null && b.heading !== null && !!a.enemy !== !!b.enemy) {
        const av = a.enemy?.vehicle ?? a.ally?.vehicle
        const bv = b.enemy?.vehicle ?? b.ally?.vehicle
        if (av && bv) {
          const relativeSpeed = Math.hypot(av.vx - bv.vx, av.vy - bv.vy)
          const ready = relativeSpeed >= VEHICLE_COLLISION_MIN_SPEED
            && s.time - (av.lastCollisionAt ?? -Infinity) >= VEHICLE_COLLISION_COOLDOWN
            && s.time - (bv.lastCollisionAt ?? -Infinity) >= VEHICLE_COLLISION_COOLDOWN
          if (ready) {
            av.lastCollisionAt = s.time; bv.lastCollisionAt = s.time
            const aw = ramWeightFactor(vehicleCollisionSpec(a.def)?.weight ?? 'medium')
            const bw = ramWeightFactor(vehicleCollisionSpec(b.def)?.weight ?? 'medium')
            const baseDamage = relativeSpeed * VEHICLE_COLLISION_DAMAGE_PER_SPEED
            const damageA = baseDamage * bw / aw, damageB = baseDamage * aw / bw
            const sourceA: EnemyDamageSource = {
              x: b.x, y: b.y, attackerSide: b.enemy ? 'enemy' : 'ally', attackerId: b.id,
              armorPen: 0.45, armorDamage: damageA * 0.35, visualKind: 'ramming',
            }
            const sourceB: EnemyDamageSource = {
              x: a.x, y: a.y, attackerSide: a.enemy ? 'enemy' : 'ally', attackerId: a.id,
              armorPen: 0.45, armorDamage: damageB * 0.35, visualKind: 'ramming',
            }
            if (a.enemy) damageEnemy(s, a.enemy, damageA, null, sourceA); else if (a.ally) damageAlly(s, a.ally, damageA, sourceA)
            if (b.enemy) damageEnemy(s, b.enemy, damageB, null, sourceB); else if (b.ally) damageAlly(s, b.ally, damageB, sourceB)
            ;(s.audioSignals ??= []).push({ id: s.nextId++, kind: 'vehicleCollision', intensity: Math.min(2, relativeSpeed / VEHICLE_COLLISION_MIN_SPEED), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, left: 0.25 })
          }
        }
      }
      touched.add(`${Math.min(a.id, b.id)}:${Math.max(a.id, b.id)}`)
      const correction = Math.min(penetration, Math.max(0.08, minimumDistance * 0.65))
      // 两个静止控制器若因旧关卡数据或同点生成而重叠，也必须解开；
      // 保留较早实例的位置，仅把较晚实例推出去，之后静止行为仍不会主动移动。
      const moveA = totalInverseMass > 0 ? correction * a.inverseMass / totalInverseMass : 0
      const moveB = totalInverseMass > 0 ? correction * b.inverseMass / totalInverseMass : correction
      a.x -= nx * moveA; a.y -= ny * moveA
      b.x += nx * moveB; b.y += ny * moveB
      // 保留顶部出生缓冲带，避免单位一生成就被强制瞬移到场内。
      a.x = Math.max(0.05, Math.min(LEVEL.cols - 0.05, a.x)); a.y = Math.max(-0.5, Math.min(LEVEL.rows - 0.05, a.y))
      b.x = Math.max(0.05, Math.min(LEVEL.cols - 0.05, b.x)); b.y = Math.max(-0.5, Math.min(LEVEL.rows - 0.05, b.y))
      adjusted = true
      // 多轮分离只在首轮处理一次速度；重复乘系数会让贴行载具速度指数衰减。
      // 法线由 a 指向 b：a 仅在朝 +n 挤压时减速，b 仅在朝 -n 挤压时减速。
      if (pass === 0) {
        const av = a.enemy?.vehicle ?? a.ally?.vehicle
        const bv = b.enemy?.vehicle ?? b.ally?.vehicle
        if (av && bv) dampVehiclePairClosingVelocity(av, bv, nx, ny, a.inverseMass, b.inverseMass)
        else if (av) dampVehicleClosingVelocity(av, nx, ny, 1)
        else if (bv) dampVehicleClosingVelocity(bv, nx, ny, -1)
        if (a.enemy?.vehicle) a.enemy.hasGoal = false
        if (b.enemy?.vehicle) b.enemy.hasGoal = false
      }
    }
    if (!adjusted) break
  }
  for (const body of bodies) {
    if (body.enemy) { body.enemy.x = body.x; body.enemy.y = body.y }
    if (body.ally) { body.ally.x = body.x; body.ally.y = body.y }
  }
  // 单位间挤压、敌对载具冲撞和同点出生分离都会绕过常规移动函数。
  syncAllUnitVehicleTurrets(s)
  endEnginePerfPart('collisionMs', perfStartedAt)
  return touched.size
}

// ---------- 格子占用 / 阻挡查询 ----------
export type BlockerKind = 'terrain' | 'object' | 'wall' | 'turret' | 'coreBuilding' | 'fixedBuilding' | 'combatUnit' | 'fortress'
export interface Blocker { kind: BlockerKind; id: number } // terrain id = TERRAIN 下标

export function terrainAt(x: number, y: number): LevelTerrain | null {
  for (const b of LEVEL.terrain) {
    if (x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h) return b
  }
  return null
}

/** 单位层向下被阻挡的查询（战场文档 §3 阻挡总则） */
export function blockerAt(s: GameState, x: number, y: number, objectClearanceHeight = 0): Blocker | null {
  if (x < 0 || x >= LEVEL.cols || y < 0 || y >= LEVEL.rows) return null
  // 地形永不挡移动；物体按矩形占格判定（hp=-1 的物体同样挡移动）
  for (const o of s.objects) {
    if (o.blockMove && (objectClearanceHeight <= 0 || heightLevel(o.height) > objectClearanceHeight) && x >= o.x && x < o.x + o.w && y >= o.y && y < o.y + o.h) return { kind: 'object', id: o.id }
  }
  for (const w of s.walls) {
    if (w.state === 'destroyed') continue
    if (w.cells.some(c => c.x === x && c.y === y)) return { kind: 'wall', id: w.id }
  }
  if (s.core && s.core.hp > 0 && x >= s.core.x && x < s.core.x + s.core.w && y >= s.core.y && y < s.core.y + s.core.h) return { kind: 'coreBuilding', id: s.core.id }
  for (const b of s.buildings) {
    if (x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h) return { kind: 'fixedBuilding', id: b.id }
  }
  for (const ally of s.allies) {
    if (ally.hp <= 0) continue
    const footprint = unitFootprint(runtimeAllyUnitDef(ally.unitDefId, ally.kind))
    if (!footprint.blocksMovement) continue
    const left = ally.x - footprint.w / 2, top = ally.y - footprint.h / 2
    if (x + 0.5 >= left && x + 0.5 < left + footprint.w && y + 0.5 >= top && y + 0.5 < top + footprint.h) return { kind: 'combatUnit', id: ally.id }
  }
  // 移动堡垒：形状占地格即敌人终点目标；与关卡核心建筑 coreBuilding 明确分离。
  const fd = fortressDef(s)
  if (fd.bodyCollision?.points.length) {
    const local = worldToFortressLocal(s, x + 0.5, y + 0.5)
    const center = fortressLocalCenter(fd)
    if (pointInConvexPolygon({ x: local.x - center.x, y: local.y - center.y }, fd.bodyCollision.points)) return { kind: 'fortress', id: 0 }
  }
  const origin = fortressShapeOrigin(fd, s.fortress.x, s.fortress.y)
  const lx = x - Math.floor(origin.x)
  const ly = y - Math.floor(origin.y)
  if (!fd.bodyCollision && lx >= 0 && lx < fd.w && ly >= 0 && ly < fd.h && fortressShapeSet(fd).has(`${lx},${ly}`)) return { kind: 'fortress', id: 0 }
  return null
}

const UNIT_MOVE_SWEEP_STEP = 0.18

function unitMovementBounds(def: UnitDef, heading: number | null, scale: number): { rx: number; ry: number; vehicle: VehicleCollisionSpec | null } {
  const vehicle = heading !== null ? vehicleCollisionSpec(def) : null
  if (vehicle && heading !== null) {
    const c = Math.abs(Math.cos(heading)), sn = Math.abs(Math.sin(heading))
    return {
      rx: (vehicle.w * c + vehicle.h * sn) * scale / 2,
      ry: (vehicle.w * sn + vehicle.h * c) * scale / 2,
      vehicle,
    }
  }
  const radii = unitCollisionRadii(def)
  return { rx: radii.x * scale, ry: radii.y * scale, vehicle: null }
}

/** 能跨越低矮场景物体的地面底盘共用同一高度规则。 */
function vehicleObjectClearanceHeight(config: ReturnType<typeof unitTypeConfig>): number {
  return config?.kind === 'vehicle' && (config.chassis === 'hovercraft' || config.chassis === 'walker') ? 1 : 0
}

/** 地面单位与静态场景实体的精确占格检测；玩家堡垒由统一实体碰撞单独处理。 */
function unitWorldBlockedAt(
  s: GameState, def: UnitDef, x: number, y: number,
  heading: number | null, scale: number, selfId?: number,
): boolean {
  if (def.stats.air) return false
  const bounds = unitMovementBounds(def, heading, scale)
  const x0 = Math.floor(x - bounds.rx), x1 = Math.floor(x + bounds.rx - 1e-7)
  const y0 = Math.floor(y - bounds.ry), y1 = Math.floor(y + bounds.ry - 1e-7)
  for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
    if (cx < 0 || cx >= LEVEL.cols || cy < 0 || cy >= LEVEL.rows) continue
    const blocker = blockerAt(s, cx, cy, vehicleObjectClearanceHeight(unitTypeConfig(def)))
    if (!blocker || blocker.kind === 'fortress' || (blocker.kind === 'combatUnit' && blocker.id === selfId)) continue
    if (bounds.vehicle && heading !== null) {
      if (vehicleRectOverlap(
        { x, y, w: bounds.vehicle.w * scale, h: bounds.vehicle.h * scale, heading, points: bounds.vehicle.points, scale },
        { x: cx + 0.5, y: cy + 0.5, w: 1, h: 1, heading: 0 },
      )) return true
    } else if (ellipseOverlapsRect(x, y, bounds.rx, bounds.ry, cx, cy, 1, 1)) return true
  }
  return false
}

/**
 * 地面单位连续位移：按小步长逐轴检测墙体、建筑及勾选“阻挡移动”的物体，允许贴墙滑动。
 * 空中单位保持直线穿越地面障碍；玩家堡垒由实体分离器处理，避免阻挡与冲撞规则相互抢占。
 */
export function moveGroundUnitWithBlockers(
  s: GameState, def: UnitDef, x: number, y: number, dx: number, dy: number,
  heading: number | null = null, scale = 1, selfId?: number,
): { x: number; y: number; blockedX: boolean; blockedY: boolean } {
  if (def.stats.air) return {
    x: x + dx,
    y: y + dy,
    blockedX: false, blockedY: false,
  }
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / UNIT_MOVE_SWEEP_STEP))
  const sx = dx / steps, sy = dy / steps
  let nx = x, ny = y, blockedX = false, blockedY = false
  for (let step = 0; step < steps; step++) {
    if (sx !== 0 && !unitWorldBlockedAt(s, def, nx + sx, ny, heading, scale, selfId)) nx += sx
    else if (sx !== 0) blockedX = true
    if (sy !== 0 && !unitWorldBlockedAt(s, def, nx, ny + sy, heading, scale, selfId)) ny += sy
    else if (sy !== 0) blockedY = true
  }
  return {
    x: Math.max(0.05, Math.min(LEVEL.cols - 0.05, nx)),
    y: Math.max(-0.5, Math.min(LEVEL.rows - 0.05, ny)),
    blockedX, blockedY,
  }
}

type EnvironmentShot =
  | { kind: 'direct'; subtype: DirectProjectileSubtype; altitude?: number }
  | { kind: 'ray' | 'spray' | 'missile'; altitude?: number }

function heightLevel(value: number): 0 | 1 | 2 | 3 {
  return Math.max(0, Math.min(3, Math.round(Number(value) || 0))) as 0 | 1 | 2 | 3
}

type ProjectileHeightPath = { sourceAltitude?: number; targetAltitude?: number; altitudeTravelM?: number }

/** 直射弹在水平航程上的实际高度；到达瞄准距离后保持目标高度继续飞行。 */
export function projectileAltitudeAtTravel(path: ProjectileHeightPath, traveledM: number): number {
  const source = Math.max(0, path.sourceAltitude ?? 0)
  const target = Math.max(0, path.targetAltitude ?? source)
  const distance = Math.max(1e-6, path.altitudeTravelM ?? 0)
  const progress = Math.max(0, Math.min(1, traveledM / distance))
  return source + (target - source) * progress
}

/** 高度与弹道的唯一规则入口：高度1只挡普通子弹；高度2、3挡所有直射/射线/喷射；导弹继续使用越障距离规则。 */
export function objectBlocksEnvironmentShot(object: Pick<BattleObject, 'blockProjectile' | 'height'>, shot: EnvironmentShot): boolean {
  if (!object.blockProjectile) return false
  const height = heightLevel(object.height)
  if (height === 0) return false
  // 飞向高空目标的弹道可越过低矮遮蔽物；未提供高度时保持旧存档的地面弹道规则。
  if (shot.altitude !== undefined && shot.altitude > height + 0.05) return false
  if (shot.kind === 'missile') return true
  if (shot.kind === 'direct') return height >= 2 || (height === 1 && shot.subtype === 'bullet')
  return height >= 2
}

/** 弹道阻挡查询：首个符合当前弹道高度规则的场景物体（地形永不挡弹道）。 */
function projectileBlockerAt(s: GameState, x: number, y: number, shot: EnvironmentShot): BattleObject | null {
  for (const o of s.objects) {
    if (!objectBlocksEnvironmentShot(o, shot)) continue
    if (x >= o.x && x < o.x + o.w && y >= o.y && y < o.y + o.h) return o
  }
  return null
}

// ---------- 寻路（Dijkstra 距离场，结构格带高惩罚 => 必须清除的障碍） ----------
const STRUCT_PENALTY = 200

// v1.55 性能包：① 障碍格一次性栅格化（原每邻居 blockerAt 全表扫描 objects/walls.cells/buildings）
// ② 二叉堆 Dijkstra（原 O(n²) 线性扫最小值）③ 按 pathVersion 缓存（原每 tick 无条件重算；
// 障碍/结构/堡垒跨格变化均已递增 pathVersion，缓存与之同生命周期；structuredClone 会携带该普通数据字段）
interface PathFieldCache { v: number; dist: number[] }

export function computePathField(s: GameState, objectClearanceHeight = 0): number[] {
  const holder = s as GameState & { __pf?: PathFieldCache; __pfHover?: PathFieldCache }
  const cacheKey = objectClearanceHeight >= 1 ? '__pfHover' : '__pf'
  const cached = holder[cacheKey]
  if (cached && cached.v === s.pathVersion) return cached.dist

  const W = LEVEL.cols, H = LEVEL.rows
  const idx = (x: number, y: number) => y * W + x
  // 障碍栅格：0=空 1=堡垒占地(终点,无惩罚) 2=可破坏障碍(墙/建筑/hp>0物体,+惩罚) 3=硬障碍(hp<0物体,不可通过)
  const grid = new Uint8Array(W * H)
  for (const c of fortressCells(s)) grid[idx(c.x, c.y)] = 1
  if (s.core && s.core.hp > 0) {
    for (let y = s.core.y; y < s.core.y + s.core.h; y++) for (let x = s.core.x; x < s.core.x + s.core.w; x++)
      if (x >= 0 && x < W && y >= 0 && y < H) grid[idx(x, y)] = 2
  }
  for (const b of s.buildings) {
    for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++)
      if (x >= 0 && x < W && y >= 0 && y < H) grid[idx(x, y)] = 2
  }
  for (const ally of s.allies) {
    if (ally.hp <= 0) continue
    const footprint = unitFootprint(runtimeAllyUnitDef(ally.unitDefId, ally.kind))
    if (!footprint.blocksMovement) continue
    const left = ally.x - footprint.w / 2, top = ally.y - footprint.h / 2
    for (let y = Math.floor(top); y < Math.ceil(top + footprint.h); y++) for (let x = Math.floor(left); x < Math.ceil(left + footprint.w); x++)
      if (x >= 0 && x < W && y >= 0 && y < H) grid[idx(x, y)] = 2
  }
  for (const w of s.walls) {
    if (w.state === 'destroyed') continue
    for (const c of w.cells) if (c.x >= 0 && c.x < W && c.y >= 0 && c.y < H && grid[idx(c.x, c.y)] !== 3) grid[idx(c.x, c.y)] = 2
  }
  for (const o of s.objects) {
    if (!o.blockMove) continue
    if (objectClearanceHeight > 0 && heightLevel(o.height) <= objectClearanceHeight) continue
    const code = o.hp < 0 ? 3 : 2
    for (let y = o.y; y < o.y + o.h; y++) for (let x = o.x; x < o.x + o.w; x++)
      if (x >= 0 && x < W && y >= 0 && y < H && (code === 3 || grid[idx(x, y)] !== 3)) grid[idx(x, y)] = code
  }

  const dist = new Array<number>(W * H).fill(Infinity)
  // 二叉堆 [dist, cellIdx]
  const heap: number[] = []
  const hPush = (d: number, i: number) => {
    heap.push(d, i)
    let c = heap.length / 2 - 1
    while (c > 0) {
      const p = (c - 1) >> 1
      if (heap[p * 2] <= heap[c * 2]) break
      for (const k of [0, 1]) { const t = heap[p * 2 + k]; heap[p * 2 + k] = heap[c * 2 + k]; heap[c * 2 + k] = t }
      c = p
    }
  }
  const hPop = (): number => { // 返回 cellIdx
    const top = heap[1]
    const ld = heap[heap.length - 2], li = heap[heap.length - 1]
    heap.length -= 2
    if (heap.length > 0) {
      heap[0] = ld; heap[1] = li
      let p = 0
      for (;;) {
        let m = p
        const l = p * 2 + 1, r = p * 2 + 2
        if (l * 2 < heap.length && heap[l * 2] < heap[m * 2]) m = l
        if (r * 2 < heap.length && heap[r * 2] < heap[m * 2]) m = r
        if (m === p) break
        for (const k of [0, 1]) { const t = heap[p * 2 + k]; heap[p * 2 + k] = heap[m * 2 + k]; heap[m * 2 + k] = t }
        p = m
      }
    }
    return top
  }
  for (const c of fortressCells(s)) { const i = idx(c.x, c.y); dist[i] = 0; hPush(0, i) } // 堡垒占地格 = 敌人终点目标
  while (heap.length > 0) {
    const bd = heap[0]
    const bi = hPop()
    if (bd > dist[bi]) continue // 堆中陈旧项
    const bx = bi % W
    const by = Math.floor(bi / W)
    const nb: [number, number][] = [[bx + 1, by], [bx - 1, by], [bx, by + 1], [bx, by - 1]]
    for (const [nx, ny] of nb) {
      if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue
      const ni = idx(nx, ny)
      const g = grid[ni]
      if (g === 3) continue // hp=-1 挡路物体：硬障碍，不可清除
      const step = g === 2 ? 1 + STRUCT_PENALTY : 1 // 可破坏障碍：必经则清除；堡垒格(1)无惩罚
      if (bd + step < dist[ni]) { dist[ni] = bd + step; hPush(dist[ni], ni) }
    }
  }
  holder[cacheKey] = { v: s.pathVersion, dist }
  return dist
}

/** 闭合校验：从出生带是否存在直达堡垒的路径（历史校验入口；移动堡垒下恒有路径，保留供编辑器/测试） */
export function validateTemplateClosed(s: GameState): boolean {
  const fr = fortressRect(s)
  const fx0 = Math.floor(fr.x)
  const fx1 = Math.floor(fr.x + fr.w - 1e-6)
  const fy0 = Math.floor(fr.y)
  const fy1 = Math.floor(fr.y + fr.h - 1e-6)
  const pass = (x: number, y: number) => blockerAt(s, x, y) === null
  const seen = new Array<boolean>(LEVEL.cols * LEVEL.rows).fill(false)
  const q: [number, number][] = []
  for (let x = 0; x < LEVEL.cols; x++) {
    for (let y = 0; y < SPAWN_ROWS; y++) {
      if (pass(x, y)) { seen[y * LEVEL.cols + x] = true; q.push([x, y]) }
    }
  }
  while (q.length) {
    const [cx, cy] = q.pop()!
    const nb: [number, number][] = [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]]
    for (const [nx, ny] of nb) {
      // 抵达堡垒邻接格即视为可直达堡垒
      if (nx >= fx0 && nx <= fx1 && ny >= fy0 && ny <= fy1) return false
      if (nx < 0 || nx >= LEVEL.cols || ny < 0 || ny >= LEVEL.rows) continue
      const i = ny * LEVEL.cols + nx
      if (seen[i] || !pass(nx, ny)) continue
      seen[i] = true
      q.push([nx, ny])
    }
  }
  return true
}

// ---------- 玩家操作 ----------
export function cellBuildableForTurret(s: GameState, x: number, y: number): boolean {
  // 防御设施只能建在基地里侧格（基地格且非墙段）；墙段格不可建造
  if (!isInnerCell(x, y)) return false
  return blockerAt(s, x, y) === null
}

export function placeTurret(s: GameState, defId: string, x: number, y: number): GameState {
  if (s.phase !== 'prep') return s
  // 堡垒防御不再支持独立固定炮塔槽位；固定火力点统一由关卡玩家单位的炮位承载。
  if (s.objective.type === 'fortressDefense') return s
  const def = defOf(defId)
  if (s.gold < def.cost) return s
  const placeX = x, placeY = y
  for (let dx = 0; dx < def.w; dx++)
    for (let dy = 0; dy < def.h; dy++)
      if (!cellBuildableForTurret(s, x + dx, y + dy)) return s
  const t: Turret = {
    id: s.nextId, defId, x: placeX, y: placeY, w: def.w, h: def.h, level: 1,
    hp: def.hp, maxHp: def.hp, ...fullTurretResources(def), angle: 0, cooldown: 0, burstLeft: 0, burstTimer: 0,
      rackLeft: def.type === 'missile' ? Math.max(1, def.burst ?? 1) : 0, // 导弹塔初始满挂
      rackAnim: 0, // 初始放置不播复挂动画
      rackTimer: 0,
    chargeLeft: 0, firing: false, firingLeft: 0, tickTimer: 0,
    targetId: null, barrelIdx: 0,
  }
  const n = clone(s)
  n.gold -= def.cost
  n.turrets.push(t)
  n.pathVersion++ // 新建建筑改变通行 => 重寻路
  n.nextId++
  return n
}

/** 派生防御墙同步：目标墙段集合 = 基地格中 4 邻含非基地格的格子。
 *  已有墙 HP 按键保留；新增墙段满 HP；不再是墙段（变里侧/变非基地）移除墙；缺口格仍为墙段保持缺口（hp=0 可通行） */
export function syncDerivedWalls(s: GameState) {
  invalidateWallInfo() // 基地格变化 → 失效并重建 level 墙信息缓存
  const info = getWallInfo()
  const target = info.walls
  const kept = new Map<string, WallSeg>()
  let changed = false
  for (const w of s.walls) {
    const k = w.cells.length === 1 ? `${w.cells[0].x},${w.cells[0].y}` : null
    if (k && target.has(k)) {
      kept.set(k, w) // 仍在集合：保留（含缺口态 hp=0）
    } else {
      changed = true // 变里侧/变非基地：移除（含清除缺口）
    }
  }
  for (const k of target) {
    if (!kept.has(k)) {
      const [x, y] = k.split(',').map(Number)
      kept.set(k, { id: s.nextId++, cells: [{ x, y }], hp: WALL_HP, maxHp: WALL_HP, state: 'intact', fromLevel: true, isolated: info.isolated.has(k) })
      changed = true // 新增墙段满 HP
    }
  }
  if (changed) {
    s.walls = [...target].map(k => kept.get(k)!)
    s.pathVersion++ // 墙集合变化 → 重寻路
  }
}

/** 基地格扩建（防御墙派生，墙本身不可建造）：校验 → 铺设 → 墙重算 */
export function placeBaseCellAt(s: GameState, x: number, y: number): GameState {
  const chk = canPlaceBaseCell(x, y)
  if (!chk.ok || s.gold < WALL_BUILD_COST || s.phase !== 'prep') return s
  if (!LEVEL.buildCells.includes(`${x},${y}`)) LEVEL.buildCells.push(`${x},${y}`)
  const ns = clone(s)
  ns.gold -= WALL_BUILD_COST
  syncDerivedWalls(ns)
  return ns
}

/** 拆除：炮塔（返半价）→ 基地格（其上有炮塔禁止；连带墙经 syncDerivedWalls 重算） */
// ---------- 要塞内部模块（背包式摆放；无耐久、敌人不可达；遵守统一载具装配权限） ----------

export function moduleDefOf(defId: string): ModuleDef {
  const d = MODULE_DEFS.find(x => x.id === defId)
  if (!d) throw new Error(`未知模块: ${defId}`)
  return d
}

/** 模块占格尺寸（rot=1 旋转 90°，宽高互换；异型模块为包围盒尺寸） */
export function moduleFoot(def: ModuleDef, rot: 0 | 1): { w: number; h: number } {
  return rot ? { w: def.h, h: def.w } : { w: def.w, h: def.h }
}

/** v2.31 模块占格单元（未旋转局部坐标；shape 缺省 = w×h 全满矩形；越界格自动忽略） */
export function moduleBaseCells(def: ModuleDef): { x: number; y: number }[] {
  if (def.shape && def.shape.length > 0) {
    const cells: { x: number; y: number }[] = []
    for (const k of def.shape) {
      const [x, y] = k.split(',').map(Number)
      if (Number.isInteger(x) && Number.isInteger(y) && x >= 0 && x < def.w && y >= 0 && y < def.h) cells.push({ x, y })
    }
    if (cells.length > 0) return cells
  }
  const cells: { x: number; y: number }[] = []
  for (let x = 0; x < def.w; x++) for (let y = 0; y < def.h; y++) cells.push({ x, y })
  return cells
}

/** v2.31 模块占格单元（按 rot 旋转后；rot=1 绕 w×h 包围盒转 90°：(x,y)→(h-1-y, x)） */
export function moduleCells(def: ModuleDef, rot: 0 | 1): { x: number; y: number }[] {
  const base = moduleBaseCells(def)
  if (rot === 0) return base
  return base.map(c => ({ x: def.h - 1 - c.y, y: c.x }))
}

/** 模块实例占格全集（"x,y" 世界局部格阵坐标） */
function moduleInstCellSet(m: ModuleInst): Set<string> {
  const set = new Set<string>()
  for (const c of moduleCells(moduleDefOf(m.defId), m.rot)) set.add(`${m.x + c.x},${m.y + c.y}`)
  return set
}

/** 模块放置校验：内部格阵界内 + 不与其他模块重叠（v2.31 逐格） + 资源足够（不查资源余额时传 skipGold） */
export function canPlaceModule(s: GameState, defId: string, x: number, y: number, rot: 0 | 1): { ok: boolean; reason?: string } {
  const def = moduleDefOf(defId)
  const role = s.objective.type === 'fortressDefense' ? 'fortress' : 'vehicle'
  if (def.allowedUnitTypes && !def.allowedUnitTypes.includes(role)) return { ok: false, reason: `${def.name}不可安装在${role === 'fortress' ? '堡垒' : '载具'}上` }
  if (def.maxCount !== undefined && s.modules.filter(m => m.defId === defId).length >= def.maxCount) {
    return { ok: false, reason: `${def.name}装配上限 ${def.maxCount}` }
  }
  const cells = moduleCells(def, rot)
  const iSet = fortressInteriorSet(fortressDef(s)) // 内部自由格阵：模块每格都须落在内部格内
  if (x < 0 || y < 0) return { ok: false, reason: '超出内部空间' }
  for (const c of cells) {
    if (!iSet.has(`${x + c.x},${y + c.y}`)) return { ok: false, reason: '超出内部空间' }
  }
  const mine = new Set(cells.map(c => `${x + c.x},${y + c.y}`))
  for (const m of s.modules) {
    const occ = moduleInstCellSet(m)
    for (const k of mine) if (occ.has(k)) return { ok: false, reason: '与其他模块重叠' }
  }
  if (s.gold < def.cost) return { ok: false, reason: '资源不足' }
  return { ok: true }
}

/** 建造模块：在统一装配权限内扣资源并放入内部格阵。 */
export function buildModule(s: GameState, defId: string, x: number, y: number, rot: 0 | 1): GameState {
  if (!fortressAssemblyAllowed(s)) return s
  if (!canPlaceModule(s, defId, x, y, rot).ok) return s
  const n = clone(s)
  const def = moduleDefOf(defId)
  n.gold -= def.cost
  n.modules.push({ id: n.nextId++, defId, x, y, rot, timer: def.produce?.interval ?? 0 })
  const m = n.modules[n.modules.length - 1]
  if (def.produce) m.timer = def.produce.interval / moduleSpecialMult(n, m, 'produce') // 生产特殊格：间隔 ÷1.5
  n.fortress.maxHp = fortressMaxHp(n)
  syncShieldCapacity(n)
  return n
}

/** 拆除模块：在统一装配权限内返半价。 */
export function demolishModule(s: GameState, moduleId: number): GameState {
  if (!fortressAssemblyAllowed(s)) return s
  const m = s.modules.find(x => x.id === moduleId)
  if (!m) return s
  const n = clone(s)
  n.gold += Math.floor(moduleDefOf(m.defId).cost / 2)
  n.modules = n.modules.filter(x => x.id !== moduleId)
  n.fortress.maxHp = fortressMaxHp(n)
  n.fortress.hp = Math.min(n.fortress.hp, n.fortress.maxHp)
  syncShieldCapacity(n)
  return n
}

export interface ModuleBonuses {
  energyRegen: number // 电力回复加成（点/s）
  energyCap: number // 储电上限加成
  ammoRegen: number // 弹药回复加成（发/s）
  ammoCap: number // 弹药储存上限加成
  coolingPool: number // 散热功率池（点/s），全额叠加到堡垒散热速率
  repairPool: number // 修复功率池（hp/s），均摊到每座受损炮塔
  rangeBoostPool: number // 射程增益池（比例），均摊到每座炮塔
  hpBoostPool: number // 船体血量上限加成池
  speedBoostPool: number // 移动速度加成池（格/s，可为负）
  turnBoostPool: number // 转向速度加成池（度/s，可为负）
  shieldGeneratorCount: number // 护盾发生器数量（具体上限由各模块定义的 maxCount 决定）
  shieldMaxPool: number // 护盾容量池
  shieldRegenPool: number // 护盾回复池（点/s）
  shieldEnergyPerPoint: number // 每回复 1 点护盾耗电
}

/** 模块特殊格倍率：模块占格覆盖对应类别的特殊格 → SPECIAL_MULT（否则 1）；生产类用于间隔除算 */
export function moduleSpecialMult(s: GameState, m: ModuleInst, boost: SpecialBoost): number {
  const sp = fortressDef(s).interiorSpecials
  if (!sp || sp.length === 0) return 1
  const occ = moduleInstCellSet(m) // v2.31 逐格判定（异型模块空洞不覆盖特殊格）
  for (const c of sp) {
    if (c.boost !== boost) continue
    if (occ.has(`${c.x},${c.y}`)) return SPECIAL_MULT
  }
  return 1
}

/** 汇总全部内部模块的加成（覆盖特殊格的模块对应属性 ×SPECIAL_MULT） */
export function moduleBonuses(s: GameState, target: 'controller' | 'playerFaction' = 'controller'): ModuleBonuses {
  const b: ModuleBonuses = { energyRegen: 0, energyCap: 0, ammoRegen: 0, ammoCap: 0, coolingPool: 0, repairPool: 0, rangeBoostPool: 0, hpBoostPool: 0, speedBoostPool: 0, turnBoostPool: 0, shieldGeneratorCount: 0, shieldMaxPool: 0, shieldRegenPool: 0, shieldEnergyPerPoint: 0 }
  for (const m of s.modules) {
    const d = moduleDefOf(m.defId)
    if (target === 'playerFaction' && (d.effectTarget ?? 'playerFaction') !== 'playerFaction') continue
    const mt = (boost: SpecialBoost) => moduleSpecialMult(s, m, boost)
    b.energyRegen += (d.energyRegen ?? 0) * mt('energy')
    b.energyCap += (d.energyCap ?? 0) * mt('energy')
    b.ammoRegen += (d.ammoRegen ?? 0) * mt('ammo')
    b.ammoCap += (d.ammoCap ?? 0) * mt('ammo')
    b.coolingPool += (d.cooling ?? 0) * mt('cooling')
    b.repairPool += (d.repair ?? 0) * mt('repair')
    b.rangeBoostPool += (d.rangeBoost ?? 0) * mt('range')
    b.hpBoostPool += (d.hpBoost ?? 0) * mt('hp')
    b.speedBoostPool += (d.speedBoost ?? 0) * mt('speed')
    b.turnBoostPool += (d.turnBoost ?? 0) * mt('turn')
    b.shieldMaxPool += Math.max(0, d.shieldMax ?? 0)
    b.shieldRegenPool += Math.max(0, d.shieldRegen ?? 0)
    if (d.shieldGenerator) {
      b.shieldGeneratorCount++
      b.shieldEnergyPerPoint = Math.max(b.shieldEnergyPerPoint, Math.max(0, d.shieldEnergyPerPoint ?? 0.5))
    }
  }
  return b
}

export interface ShieldStats { enabled: boolean; max: number; regen: number; energyPerPoint: number }
function shieldStatsFromBonuses(b: ModuleBonuses): ShieldStats {
  const enabled = b.shieldGeneratorCount > 0 && b.shieldMaxPool > 0
  return { enabled, max: enabled ? b.shieldMaxPool : 0, regen: enabled ? b.shieldRegenPool : 0, energyPerPoint: enabled ? b.shieldEnergyPerPoint : 0 }
}
/** 护盾模块汇总：没有发生器时，容量/回复增效模块不单独生效。 */
export function shieldStats(s: GameState): ShieldStats {
  return shieldStatsFromBonuses(moduleBonuses(s))
}

function syncPlayerAllyShield(s: GameState, ally: Ally, bonuses: ModuleBonuses, dt: number): void {
  const vehicle = ally.vehicle
  if (!vehicle) return
  const stats = shieldStatsFromBonuses(bonuses)
  const oldMax = Math.max(0, vehicle.maxShield ?? 0)
  vehicle.maxShield = stats.max
  vehicle.shieldLastHitAt ??= -1e9
  if (!stats.enabled) { vehicle.shield = 0; vehicle.shieldBroken = false; return }
  if (oldMax <= 0) vehicle.shield = stats.max
  else if (stats.max > oldMax) vehicle.shield = Math.min(stats.max, (vehicle.shield ?? 0) + stats.max - oldMax)
  else vehicle.shield = Math.min(stats.max, vehicle.shield ?? stats.max)
  if ((vehicle.shield ?? 0) >= stats.max || stats.regen <= 0) return
  if (vehicle.shieldBroken) {
    if (s.time - (vehicle.shieldLastHitAt ?? -1e9) < 10) return
    vehicle.shieldBroken = false
  }
  const wanted = Math.min(stats.max - (vehicle.shield ?? 0), stats.regen * dt)
  const possible = stats.energyPerPoint > 0 ? Math.min(wanted, s.energy / stats.energyPerPoint) : wanted
  if (possible <= 0) return
  vehicle.shield = (vehicle.shield ?? 0) + possible
  s.energy = Math.max(0, s.energy - possible * stats.energyPerPoint)
}

function playerFactionEffectiveUnit(s: GameState, ally: Ally): UnitDef {
  const base = runtimeAllyUnitDef(ally.unitDefId, ally.kind)
  if (ally.faction !== 'player') return base
  const bonuses = moduleBonuses(s, 'playerFaction')
  if (bonuses.speedBoostPool === 0 && bonuses.turnBoostPool === 0) return base
  const unit = structuredClone(base)
  unit.stats.speed = Math.max(0, unit.stats.speed + bonuses.speedBoostPool)
  if (unit.legacy?.registry === 'fortress') {
    unit.legacy.def = structuredClone(unit.legacy.def)
    unit.legacy.def.speed = unit.stats.speed
    unit.legacy.def.turnSpeed = Math.max(0, unit.legacy.def.turnSpeed + bonuses.turnBoostPool)
  }
  if (unit.vehiclePlatform) {
    unit.vehiclePlatform = structuredClone(unit.vehiclePlatform)
    unit.vehiclePlatform.speed = unit.stats.speed
    unit.vehiclePlatform.turnSpeed = Math.max(0, unit.vehiclePlatform.turnSpeed + bonuses.turnBoostPool)
  }
  if (unit.typeConfig?.kind === 'vehicle' || unit.typeConfig?.kind === 'rotorcraft' || unit.typeConfig?.kind === 'fixedWingAircraft') {
    unit.typeConfig = { ...unit.typeConfig, turnSpeed: Math.max(0, unit.typeConfig.turnSpeed + bonuses.turnBoostPool) }
  }
  return unit
}

/** 同步模块变化后的动态护盾上限；首次装上发生器及新增容量均补足新增部分。 */
function syncShieldCapacity(s: GameState): ShieldStats {
  const stats = shieldStats(s)
  const oldMax = s.fortress.maxShield
  s.fortress.maxShield = stats.max
  if (!stats.enabled) {
    s.fortress.shield = 0
    s.fortress.shieldBroken = false
    return stats
  }
  if (oldMax <= 0) {
    s.fortress.shield = stats.max
    s.fortress.shieldBroken = false
  } else if (stats.max > oldMax) {
    s.fortress.shield = Math.min(stats.max, s.fortress.shield + stats.max - oldMax)
  } else {
    s.fortress.shield = Math.min(stats.max, s.fortress.shield)
  }
  return stats
}

/** 护盾回复：未破时持续回复；破盾后须 10s 未受攻击。满盾不耗电，电量不足按可用电量部分回复。 */
function updateShield(s: GameState, dt: number): void {
  const stats = syncShieldCapacity(s)
  const f = s.fortress
  if (!stats.enabled || f.shield >= f.maxShield || stats.regen <= 0) return
  if (f.shieldBroken) {
    if (s.time - f.shieldLastHitAt < 10) return
    f.shieldBroken = false
  }
  const wanted = Math.min(f.maxShield - f.shield, stats.regen * dt)
  const possible = stats.energyPerPoint > 0 ? Math.min(wanted, s.energy / stats.energyPerPoint) : wanted
  if (possible <= 0) return
  f.shield += possible
  s.energy = Math.max(0, s.energy - possible * stats.energyPerPoint)
}

/** 资源动态上限 = 基础 cap + 模块加成（UI 与 tick 共用） */
export function resourceCaps(s: GameState): { ammoCap: number; energyCap: number } {
  const b = moduleBonuses(s)
  return { ammoCap: AMMO.cap + b.ammoCap, energyCap: ENERGY.cap + b.energyCap }
}

export interface HeatCurvePoint { time: number; heat: number; overheated: boolean }
/** 炮塔编辑器只读热曲线：按单座炮塔持续射击的平均产热，复用实战过热/50%迟滞口径。 */
export function simulateTurretHeat(def: TurretDef, fortress: FortressDef, seconds = 20, dt = 0.1): HeatCurvePoint[] {
  const cap = Math.max(1, fortress.heatCap)
  const barrels = Math.max(1, Math.floor(def.barrels ?? 1))
  const shotsPerRound = Math.max(1, Math.floor(def.burst ?? 1)) * ((def.barrelMode ?? 'salvo') === 'salvo' ? barrels : 1)
  const heatPerSecond = (def.heatPerShot ?? 0) * shotsPerRound / Math.max(0.05, def.fireRate || 1)
  let heat = 0, overheated = false
  const out: HeatCurvePoint[] = [{ time: 0, heat, overheated }]
  const steps = Math.ceil(seconds / dt)
  for (let i = 1; i <= steps; i++) {
    heat = Math.max(0, heat - fortress.heatDissipation * dt)
    if (overheated && heat <= cap * OVERHEAT_RESUME) overheated = false
    if (!overheated) heat = Math.min(cap, heat + heatPerSecond * dt)
    if (heat >= cap) overheated = true
    out.push({ time: Math.min(seconds, i * dt), heat, overheated })
  }
  return out
}

/** 模块规划参考：忽略当前装配，只计算模块在目标堡垒内部自由格阵中的可放起点数量。 */
export function modulePlanningFits(fortress: FortressDef, module: ModuleDef): { normal: number; rotated: number } {
  const inside = fortressInteriorSet(fortress)
  const count = (rot: 0 | 1) => {
    const cells = moduleCells(module, rot)
    const foot = moduleFoot(module, rot)
    let n = 0
    for (let y = 0; y <= fortress.interior.rows - foot.h; y++) for (let x = 0; x <= fortress.interior.cols - foot.w; x++) {
      if (cells.every(c => inside.has(`${x + c.x},${y + c.y}`))) n++
    }
    return n
  }
  return { normal: count(0), rotated: count(1) }
}

/** 玩家战车散热速率（点/s）= 游戏参数自然散热 + 散热器功率池（全额直连，不按炮塔数摊薄） */
export function fortressCooling(s: GameState): number {
  return gameParameters().naturalHeatDissipation + moduleBonuses(s).coolingPool
}

/** 开火产热汇聚到堡垒热量池：攒满上限即过热（全炮塔停火） */
export function addFortressHeat(s: GameState, amount: number): void {
  if (amount <= 0) return
  const cap = fortressDef(s).heatCap
  s.fortress.heat = Math.min(cap, s.fortress.heat + amount)
  if (s.fortress.heat >= cap) s.fortress.overheated = true
}

/** 堡垒散热推进：自然散热+散热器持续生效（含射击/过热中）；过热迟滞解除（降至上限×OVERHEAT_RESUME） */
function coolFortress(s: GameState, dt: number): void {
  const f = s.fortress
  if (f.heat > 0) f.heat = Math.max(0, f.heat - fortressCooling(s) * dt)
  if (f.overheated && f.heat <= fortressDef(s).heatCap * OVERHEAT_RESUME) f.overheated = false
}

/** 火控雷达摊薄：每座炮塔射程增益比例 = 增益池 / 炮塔数（无炮塔为 0） */
export function turretRangeBonus(s: GameState): number {
  if (s.turrets.length === 0) return 0
  return moduleBonuses(s).rangeBoostPool / s.turrets.length
}

// ---------- 友军单位（生产模块产出；地面实体统一碰撞；空中单位地面敌人无法攻击） ----------

/** 出征点：堡垒上方（迎敌侧）中点外侧，跟随堡垒移动 */
export function allySpawnPoint(s: GameState): { x: number; y: number } {
  const d = fortressDef(s)
  return { x: s.fortress.x + d.w / 2, y: Math.max(SPAWN_ROWS + 0.5, s.fortress.y - 0.6) }
}

/** 生产模块倒计时 + 维修站修复 + 友军单位推进（备战/交战都生效；tick 每帧调用） */
function updateModulesAndAllies(s: GameState, dt: number) {
  const mb = moduleBonuses(s)
  const shared = moduleBonuses(s, 'playerFaction')
  // 关卡中的玩家单位不装独立模块，只继承明确配置为“玩家阵营”的结构增益。
  for (const ally of s.allies) {
    if (ally.faction !== 'player') continue
    const unit = runtimeAllyUnitDef(ally.unitDefId, ally.kind)
    const nextMax = Math.max(1, unit.stats.hp + shared.hpBoostPool)
    if (nextMax > ally.maxHp) ally.hp += nextMax - ally.maxHp
    ally.maxHp = nextMax
    ally.hp = Math.min(ally.hp, ally.maxHp)
    syncPlayerAllyShield(s, ally, shared, dt)
  }
  // 维修站：主控专用功率只修主控；玩家阵营功率在主控和玩家单位间统一均摊。
  const applyRepairPool = (repairPool: number, includePlayerAllies: boolean) => {
    if (repairPool <= 0) return
    const playerAllies = includePlayerAllies ? s.allies.filter(ally => ally.faction === 'player' && ally.hp > 0) : []
    const damaged = [
      ...s.turrets.filter(t => t.hp < t.maxHp),
      ...playerAllies.flatMap(ally => (ally.vehicle?.turrets ?? []).filter(turret => turret.hp < turret.maxHp)),
    ]
    const sides = (['front', 'rear', 'left', 'right'] as FortressArmorSide[]).filter(side => s.fortress.armor[side] < s.fortress.maxArmor[side])
    const allySides = playerAllies.flatMap(ally => ally.vehicle
      ? (['front', 'rear', 'left', 'right'] as FortressArmorSide[]).flatMap(side => ally.vehicle!.armor[side] < ally.vehicle!.maxArmor[side] ? [{ ally, side }] : [])
      : [])
    const structureDamaged = s.fortress.hp < s.fortress.maxHp
    const damagedAllies = playerAllies.filter(ally => ally.hp < ally.maxHp)
    const consumers = damaged.length + sides.length + allySides.length + damagedAllies.length + (structureDamaged ? 1 : 0)
    if (consumers > 0) {
      const per = (repairPool / consumers) * dt
      for (const t of damaged) t.hp = Math.min(t.maxHp, t.hp + per)
      for (const side of sides) s.fortress.armor[side] = Math.min(s.fortress.maxArmor[side], s.fortress.armor[side] + per)
      for (const { ally, side } of allySides) ally.vehicle!.armor[side] = Math.min(ally.vehicle!.maxArmor[side], ally.vehicle!.armor[side] + per)
      for (const ally of damagedAllies) ally.hp = Math.min(ally.maxHp, ally.hp + per)
      if (structureDamaged) s.fortress.hp = Math.min(s.fortress.maxHp, s.fortress.hp + per)
    }
  }
  applyRepairPool(Math.max(0, mb.repairPool - shared.repairPool), false)
  applyRepairPool(shared.repairPool, true)
  // 生产模块：倒计时产出友军（受本模块存活上限约束）
  for (const m of s.modules) {
    const d = moduleDefOf(m.defId)
    if (!d.produce) continue
    m.timer -= dt
    if (m.timer > 0) continue
    const alive = s.allies.filter(a => a.producerId === m.id).length
    if (alive >= d.produce.cap) { m.timer = 0.5; continue } // 满员：稍后复查
    m.timer = d.produce.interval / moduleSpecialMult(s, m, 'produce') // 生产特殊格：间隔 ÷1.5
    const configured = runtimeAllyUnitDef(d.produce.unitDefId, d.produce.kind)
    const kind = allyKindForUnit(configured)
    const p = allySpawnPoint(s)
    const ally: Ally = {
      id: s.nextId++, kind, unitDefId: configured.id || allyUnitId(kind), faction: 'ally', producerId: m.id,
      x: p.x, y: p.y, hp: configured.stats.hp, maxHp: configured.stats.hp,
      cooldown: 0, targetId: null, hitFlash: 0,
      vehicle: createUnitVehicleRuntime(configured, 0),
      aircraft: createUnitAircraftRuntime(configured, 0),
    }
    s.allies.push(ally)
    ensureUnitVehicleTurrets(s, ally, configured)
    if (unitFootprint(configured).blocksMovement) s.pathVersion++
  }
  // 友军推进：全图索敌巡航，进射程攻击；阵亡清理
  for (const a of s.allies) if (a.hp > 0) {
    const beforeX = a.x, beforeY = a.y, beforeAircraftHeading = a.aircraft?.heading, beforeVehicleHeading = a.vehicle?.heading
    const unit = runtimeAllyUnitDef(a.unitDefId, a.kind)
    updateAlly(s, a, dt)
    if (a.hp > 0) {
      continueFixedWingFlightIfIdle(a, unit, beforeX, beforeY, beforeAircraftHeading, dt)
      enforcePlacementBodyLocks(a, unit, { x: beforeX, y: beforeY, vehicleHeading: beforeVehicleHeading, aircraftHeading: beforeAircraftHeading })
      settleWalkerAnimationIfIdle(s, a, unit, dt)
    }
  }
  let removedBlockingUnit = false
  for (const a of s.allies) if (a.hp <= 0) {
    const unit = runtimeAllyUnitDef(a.unitDefId, a.kind)
    if (a.deathLeft === undefined) {
      const crashing = beginUnitAircraftCrash(a, unit, s.time)
      a.deathLeft = crashing ? a.aircraft!.crash!.duration : a.vehicle ? 1.1 : 0.65
      if (a.placementId !== undefined && !s.defeatedUnitPlacementIds.includes(a.placementId)) s.defeatedUnitPlacementIds.push(a.placementId)
      if (a.vehicle) {
        a.vehicle.destroyedFx = true
        for (const turret of a.vehicle.turrets ?? []) { turret.firing = false; turret.burstLeft = 0; turret.targetId = null }
      }
      if (!crashing) {
        emitUnitDestruction(s, a, unit)
        if (!unitVehiclePlatform(unit)) addFloat(s, a.x, a.y, `${unit.name}阵亡`)
      }
      if (unitFootprint(unit).blocksMovement) removedBlockingUnit = true
    } else if (a.aircraft?.crash) {
      if (advanceUnitAircraftCrash(a, unit, dt)) {
        emitUnitAircraftCrashImpact(s, a, unit)
        a.deathLeft = 0
      } else a.deathLeft = Math.max(0.001, a.aircraft.crash.duration - a.aircraft.crash.elapsed)
    } else a.deathLeft -= dt
  }
  s.allies = s.allies.filter(a => a.hp > 0 || (a.deathLeft ?? 0) > 0)
  if (removedBlockingUnit) s.pathVersion++
}

function moveAllyToward(s: GameState, a: Ally, unit: UnitDef, tx: number, ty: number, speed: number, dt: number): void {
  const dx = tx - a.x, dy = ty - a.y, distance = Math.hypot(dx, dy)
  if (distance < 1e-6) return
  const baseSpeed = Math.max(0.01, unit.stats.speed)
  if (moveUnitAircraftToward(a, unit, tx, ty, dt, speed / baseSpeed)) return
  if (moveUnitVehicleToward(s, a, unit, tx, ty, dt, speed / baseSpeed)) return
  const step = Math.min(distance, speed * terrainSpeedMod(a.x, a.y) * dt)
  const moved = moveGroundUnitWithBlockers(s, unit, a.x, a.y, dx / distance * step, dy / distance * step, null, 1, a.id)
  a.x = moved.x
  a.y = moved.y
}

const {
  placementBodyLocks,
  enforcePlacementBodyLocks,
  unitCanSeePoint,
  engagePlacementGroup,
  updatePlacementBehavior,
  unitArrivalTolerance,
  nonCombatNavigationStats: readNonCombatNavigationStats,
} = createNonCombatBehaviorAI({
  level: LEVEL,
  factionsHostile,
  unitRadiusToward,
  wrapAngle,
  syncUnitVehicleTurrets,
  fortressCenter,
  fortressDistanceToPoint,
  eventRandom,
  vehicleObjectClearanceHeight,
  blockerAt,
  moveEnemyFree,
  moveAllyToward,
  moveEnemyVehicleToward,
  moveToward,
  moveUnitAircraftToward,
  moveUnitVehicleToward,
})

/** DEBUG/回归用只读统计；不参与战斗判定。 */
export function nonCombatNavigationStats() {
  return readNonCombatNavigationStats()
}
const { updateAlly } = createAllyCombatAI({
  unitForAlly: playerFactionEffectiveUnit,
  finishZone: LEVEL.finishZone,
  damageAlly,
  damageEnemy,
  updateAllyScript,
  updateUnitDeployForces: (...args) => updateUnitDeployForces(...args),
  placementBodyLocks,
  updatePlacementBehavior,
  unitCanSeePoint,
  factionsHostile,
  fortressCenter,
  fortressDistanceToPoint,
  currentUnitAltitude,
  turretDefById: defOf,
  engagePlacementGroup,
  unitVehiclePlatform,
  updateAllyVehicleTurrets,
  updateArmedAllyVehicleMovement: (...args) => updateArmedAllyVehicleMovement(...args),
  unitRadiusToward,
  moveAllyToward,
  moveUnitAircraftToward,
  unitFireAtEnemy,
})

export function demolishAt(s: GameState, x: number, y: number): GameState {

  if (!fortressAssemblyAllowed(s)) return s
  const t = s.turrets.find(t => x >= t.x && x < t.x + t.w && y >= t.y && y < t.y + t.h)
  if (t) return unmountTurret(s, t.id) // 炮塔优先：卸下返半价（内置武器不可拆，unmountTurret 内拦截）
  const n = clone(s)
  if (isBaseCell(x, y)) { // 基地格拆除（编辑器遗留路径）：连带墙经 syncDerivedWalls 重算
    const i = LEVEL.buildCells.indexOf(`${x},${y}`)
    if (i >= 0) LEVEL.buildCells.splice(i, 1)
    n.gold += Math.floor(WALL_BUILD_COST / 2)
    syncDerivedWalls(n)
    return n
  }
  return n
}

export const WALL_REPAIR_FULL_COST = 60
export function wallRepairCost(w: WallSeg): number {
  if (w.state === 'destroyed' || w.hp >= w.maxHp) return 0
  return Math.max(5, Math.ceil((1 - w.hp / w.maxHp) * WALL_REPAIR_FULL_COST * (w.maxHp / WALL_HP)))
}

/** 受损墙段修复：仅恢复 hp，不影响已开放入口（destroyed 不可修复，只能在原格位重建封堵） */
export function repairWall(s: GameState, wallId: number): GameState {
  if (s.phase !== 'prep') return s
  const w = s.walls.find(w => w.id === wallId)
  if (!w) return s
  const cost = wallRepairCost(w)
  if (cost <= 0 || s.gold < cost) return s
  const n = clone(s)
  const nw = n.walls.find(w => w.id === wallId)!
  nw.hp = nw.maxHp
  nw.state = 'intact'
  n.gold -= cost
  return n
}

export function upgradeTurret(s: GameState, turretId: number): GameState {
  if (!fortressAssemblyAllowed(s)) return s
  const t = s.turrets.find(t => t.id === turretId)
  if (!t || t.level >= 3) return s
  const cost = upgradeCost(defOf(t.defId), t.level)
  if (s.gold < cost) return s
  const n = clone(s)
  n.turrets.find(t => t.id === turretId)!.level++
  n.gold -= cost
  return n
}

/** 战斗 HUD 控制玩家炮塔是否自动索敌开火；旧存档缺省为开启。 */
export function setTurretAutoFire(s: GameState, turretId: number, enabled: boolean): GameState {
  const turret = s.turrets.find(item => item.id === turretId)
  if (!turret || (turret.autoFire !== false) === enabled) return s
  const next = clone(s)
  next.turrets.find(item => item.id === turretId)!.autoFire = enabled
  return next
}

export function startWave(s: GameState, bonus: number): GameState {
  if (s.phase !== 'prep') return s
  const n = clone(s)
  n.phase = 'combat'
  n.gold += bonus
  n.prepLeft = 0
  n.nextWaveLeft = null
  n.spawnQueue = waveDefenseObjective(n.objective) ? stageWaveQueue(levelStage(n.activeStageId), n.wave - 1) : []
  n.spawnTimer = 0.5 + (n.spawnQueue[0]?.delay ?? 0)
  return n
}

function activateTaskStage(s: GameState, next: LevelTaskStage, notice: string, preserveResultPulse?: 'success' | 'failure'): void {
  const previousObjective = s.objective
  const sameFortressLoop = previousObjective.type === 'fortressDefense' && next.objective.type === 'fortressDefense' && next.id === s.activeStageId
  if (previousObjective.type === 'fortressDefense' && !sameFortressLoop) exitFortressDefenseStage(s, previousObjective)
  // 普通重入清掉旧结果；同阶段自循环保留刚产生的结果脉冲，让对应事件能在下一 tick 消费。
  if (preserveResultPulse !== 'success') s.levelVariables[`builtin:stageSuccess:${next.id}`] = false
  if (preserveResultPulse !== 'failure') s.levelVariables[`builtin:stageFailure:${next.id}`] = false
  for (const event of LEVEL.events) {
    if ((event.trigger.type === 'stageSuccess' || event.trigger.type === 'stageFailure') && event.trigger.stageId === next.id) {
      const runtime = s.unifiedEventStates.find(item => item.id === event.id)
      if (runtime) runtime.inside = false
    }
  }
  s.activeStageId = next.id
  s.objective = structuredClone(next.objective)
  s.objectiveElapsed = 0
  s.wave = 1
  s.nextWaveLeft = null
  s.spawnQueue = []
  s.spawnTimer = 0
  const combat = objectiveStartsInCombat(next.objective)
  s.phase = combat ? 'combat' : 'prep'
  s.prepLeft = combat ? 0 : waveDefenseObjective(next.objective) ? (next.objective.restTime ?? DEFEND_REST_TIME_DEFAULT) : PREP_TIME
  if (next.objective.type === 'fortressDefense' && !sameFortressLoop) enterFortressDefenseStage(s, next.objective)
  if (combat && waveDefenseObjective(next.objective)) {
    s.spawnQueue = stageWaveQueue(next, 0)
    s.spawnTimer = 0.5 + (s.spawnQueue[0]?.delay ?? 0)
  }
  s.notices.push({ id: s.nextId++, text: `${notice}：${next.name}`, left: 4 })
}

function transitionTaskStage(s: GameState, result: 'success' | 'failure'): void {
  const current = levelStage(s.activeStageId)
  s.levelVariables[`builtin:stage${result === 'success' ? 'Success' : 'Failure'}:${current.id}`] = true
  const transition = result === 'success' ? current.success : current.failure
  if (transition.type === 'win') {
    if (current.objective.type === 'fortressDefense') exitFortressDefenseStage(s, current.objective)
    s.levelVariables['builtin:primaryObjectiveCompleted'] = true; s.phase = 'won'; return
  }
  if (transition.type === 'lose') { s.phase = 'lost'; return }
  const next = LEVEL.stages.find(stage => stage.id === transition.stageId)
  if (!next) {
    if (result === 'success') s.levelVariables['builtin:primaryObjectiveCompleted'] = true
    s.phase = result === 'success' ? 'won' : 'lost'
    return
  }
  activateTaskStage(s, next, result === 'success' ? '任务推进' : '任务转折', next.id === current.id ? result : undefined)
}

function escortAlly(s: GameState): Ally | null {
  if (s.objective.type !== 'escort') return null
  const placementId = s.objective.unitPlacementId
  return s.allies.find(ally => ally.placementId === placementId && ally.hp > 0) ?? null
}

export interface DestroyObjectiveProgress {
  total: number
  destroyed: number
  remaining: number
  hp: number
  maxHp: number
}

/** 摧毁目标进度：以关卡初始单位实例 ID 为稳定引用，死亡演出结束后仍保留完成记录。 */
export function destroyObjectiveProgress(s: GameState): DestroyObjectiveProgress {
  if (s.objective.type !== 'destroy') return { total: 0, destroyed: 0, remaining: 0, hp: 0, maxHp: 0 }
  const ids = [...new Set(s.objective.unitPlacementIds)]
  const defeated = new Set(s.defeatedUnitPlacementIds)
  let destroyed = 0, hp = 0, maxHp = 0
  for (const placementId of ids) {
    const enemy = s.enemies.find(item => item.placementId === placementId)
    if (defeated.has(placementId) || (enemy && enemy.hp <= 0)) destroyed++
    if (enemy && enemy.hp > 0) { hp += enemy.hp; maxHp += enemy.maxHp }
  }
  return { total: ids.length, destroyed, remaining: Math.max(0, ids.length - destroyed), hp, maxHp }
}

function unitInsideZone(unit: { x: number; y: number }, zone: LevelZone): boolean {
  return unit.x >= zone.x && unit.x <= zone.x + zone.w && unit.y >= zone.y && unit.y <= zone.y + zone.h
}

// ---------- 内部工具 ----------
function clone(s: GameState): GameState {
  return structuredClone(s)
}

function createUnitVehicleRuntime(unit: UnitDef, heading: number): UnitVehicleRuntime | undefined {
  const spec = vehicleCollisionSpec(unit)
  if (!spec) return undefined
  const fortress = unitVehiclePlatform(unit)
  return {
    heading, vx: 0, vy: 0, steerAngle: 0, turnW: 0, walkPhase: 0,
    heat: 0, overheated: false,
    heatCap: Math.max(1, fortress?.heatCap ?? 100), heatDissipation: Math.max(0, fortress?.heatDissipation ?? 10),
    trackPhase: [],
    armor: structuredClone(spec.armor), maxArmor: structuredClone(spec.armor), turrets: [],
  }
}

function createUnitAircraftRuntime(unit: UnitDef, heading: number): UnitAircraftRuntime | undefined {
  const config = unitTypeConfig(unit)
  if (config?.kind === 'rotorcraft') return { heading, vx: 0, vy: 0, altitude: config.altitude, targetAltitude: config.altitude, verticalSpeed: 0 }
  if (config?.kind === 'fixedWingAircraft') {
    const speed = Math.min(Math.max(0.01, config.minSpeed), Math.max(0.01, unit.stats.speed))
    return { heading, vx: dirX(heading) * speed, vy: dirY(heading) * speed, altitude: config.altitude, targetAltitude: config.altitude, verticalSpeed: 0, orbitDirection: 1 }
  }
  return undefined
}

type AircraftHost = { aircraft?: UnitAircraftRuntime }

type MovableAircraftHost = AircraftHost & {
  id?: number
  x: number
  y: number
  initialHeading?: number
  bossSizeScale?: number
  vehicle?: UnitVehicleRuntime
}

/** 读取运行时实际高度；旧快照没有新字段时无损回落到单位模板高度。 */
export function currentUnitAltitude(host: AircraftHost, unit: UnitDef): number {
  const fallback = unitAltitude(unit)
  return Number.isFinite(host.aircraft?.altitude) ? Math.max(0, host.aircraft!.altitude) : fallback
}

/** 设置飞行器目标高度；非飞行单位返回 false，超范围数值按模板上下限钳制。 */
export function setUnitAircraftTargetAltitude(host: AircraftHost, unit: UnitDef, requested: number): boolean {
  const config = unitTypeConfig(unit)
  if (!host.aircraft || host.aircraft.crash || (config?.kind !== 'rotorcraft' && config?.kind !== 'fixedWingAircraft') || !Number.isFinite(requested)) return false
  host.aircraft.altitude = currentUnitAltitude(host, unit)
  host.aircraft.targetAltitude = Math.max(config.minAltitude, Math.min(config.maxAltitude, requested))
  host.aircraft.verticalSpeed ??= 0
  return true
}

/** 动态高度求解：水平运动与升降互不覆盖，所有阵营使用同一套运行组件。 */
export function updateUnitAircraftAltitude(host: AircraftHost, unit: UnitDef, dt: number): void {
  const config = unitTypeConfig(unit)
  if (!host.aircraft || host.aircraft.crash || (config?.kind !== 'rotorcraft' && config?.kind !== 'fixedWingAircraft') || dt <= 0) return
  const current = currentUnitAltitude(host, unit)
  const requested = Number.isFinite(host.aircraft.targetAltitude) ? host.aircraft.targetAltitude : config.altitude
  const target = Math.max(config.minAltitude, Math.min(config.maxAltitude, requested))
  const next = approachNumber(current, target, Math.max(0.01, config.climbRate) * dt)
  host.aircraft.altitude = next
  host.aircraft.targetAltitude = target
  host.aircraft.verticalSpeed = (next - current) / dt
}

/**
 * 创建统一飞行坠毁状态。此时只停止飞行战斗，不播放主爆炸；主爆炸延迟到高度归零。
 * 返回 false 表示该单位不是可进入坠毁状态的飞行器。
 */
export function beginUnitAircraftCrash(host: MovableAircraftHost, unit: UnitDef, now: number): boolean {
  const config = unitTypeConfig(unit)
  if (config?.kind !== 'rotorcraft' && config?.kind !== 'fixedWingAircraft') return false
  if (!host.aircraft) {
    const heading = host.vehicle?.heading ?? host.initialHeading ?? 0
    host.aircraft = createUnitAircraftRuntime(unit, heading)
  }
  const aircraft = host.aircraft
  if (!aircraft) return false
  if (aircraft.crash) return true
  const altitude = currentUnitAltitude(host, unit)
  const descentRate = Math.max(0.55, config.climbRate * (config.kind === 'rotorcraft' ? 0.8 : 1.05))
  const minimumDuration = config.kind === 'rotorcraft' ? 1.35 : 1.15
  const duration = altitude <= 0.05 ? 0.12 : Math.max(minimumDuration, Math.min(3.4, altitude / descentRate))
  aircraft.crash = {
    kind: config.kind,
    startedAt: now,
    elapsed: 0,
    duration,
    startAltitude: altitude,
    spinDirection: eventRandom(host.id ?? 0, 604) < 0.5 ? -1 : 1,
    driftHeading: config.kind === 'rotorcraft' ? eventRandom(host.id ?? 0, 605) * Math.PI * 2 : undefined,
  }
  aircraft.targetAltitude = 0
  aircraft.verticalSpeed = 0
  aircraft.holdX = undefined
  aircraft.holdY = undefined
  if (host.vehicle) {
    host.vehicle.vx = aircraft.vx
    host.vehicle.vy = aircraft.vy
    for (const turret of host.vehicle.turrets ?? []) {
      turret.firing = false
      turret.burstLeft = 0
      turret.targetId = null
    }
  }
  return true
}

/** 统一坠毁进度；供轨迹、音频和测试共用，避免各层衰减口径漂移。 */
export function unitAircraftCrashProgress(crash: Pick<UnitAircraftCrashRuntime, 'elapsed' | 'duration'>): number {
  return Math.max(0, Math.min(1, crash.elapsed / Math.max(0.001, crash.duration)))
}

/** 旋翼移动循环音随坠毁进度平滑降至 0；固定翼不由本规则改音量。 */
export function unitAircraftMovementAudioGain(crash: UnitAircraftCrashRuntime | undefined): number {
  if (!crash || crash.kind !== 'rotorcraft') return 1
  return Math.pow(1 - unitAircraftCrashProgress(crash), 1.25)
}

/** 旋翼移动音量曲线：静止保留 10%，达到极速的 80% 时达到满音量。 */
export const ROTORCRAFT_AUDIO_MIN_GAIN = 0.1
export const ROTORCRAFT_AUDIO_FULL_SPEED_RATIO = 0.8

export function rotorcraftMovementAudioGain(
  speed: number,
  maxSpeed: number,
  crash?: UnitAircraftCrashRuntime,
): number {
  // 坠毁是独立音频阶段：无论坠毁瞬间的移动速度是多少，都从满音量开始衰减。
  if (crash?.kind === 'rotorcraft') return unitAircraftMovementAudioGain(crash)
  const fullSpeed = Math.max(0.001, maxSpeed * ROTORCRAFT_AUDIO_FULL_SPEED_RATIO)
  const speedRatio = Math.max(0, Math.min(1, speed / fullSpeed))
  const normalGain = ROTORCRAFT_AUDIO_MIN_GAIN + (1 - ROTORCRAFT_AUDIO_MIN_GAIN) * speedRatio
  return normalGain
}

/**
 * 推进飞行坠毁轨迹。旋翼机失去升力后自转螺旋下降；固定翼保留前进速度并弧线俯冲。
 * 返回 true 表示已经触地，本帧应播放地面主爆炸并移除单位。
 */
export function advanceUnitAircraftCrash(host: MovableAircraftHost, unit: UnitDef, dt: number): boolean {
  const aircraft = host.aircraft
  const crash = aircraft?.crash
  const config = unitTypeConfig(unit)
  if (!aircraft || !crash || (config?.kind !== 'rotorcraft' && config?.kind !== 'fixedWingAircraft')) return false
  if (crash.impacted) return true
  if (dt <= 0) return false
  const previousAltitude = aircraft.altitude
  const remaining = Math.max(0, crash.duration - crash.elapsed)
  const step = Math.min(dt, remaining)
  crash.elapsed = Math.min(crash.duration, crash.elapsed + dt)
  const progress = unitAircraftCrashProgress(crash)
  const speedBefore = Math.hypot(aircraft.vx, aircraft.vy)

  if (crash.kind === 'rotorcraft') {
    // 旋翼失速后：随机方向持续偏出；自转与下坠均随进度明显加快。
    const spinRate = 1.9 + Math.pow(progress, 1.35) * 6.4
    aircraft.heading = wrapAngle(aircraft.heading + crash.spinDirection * spinRate * step)
    const decay = Math.exp(-0.9 * step)
    const swirlHeading = aircraft.heading + crash.spinDirection * Math.PI / 2
    const driftHeading = crash.driftHeading ?? aircraft.heading
    const driftAccel = 0.46 + progress * 0.88
    const swirlAccel = 0.3 + progress * 0.12
    aircraft.vx = aircraft.vx * decay + (dirX(driftHeading) * driftAccel + dirX(swirlHeading) * swirlAccel) * step
    aircraft.vy = aircraft.vy * decay + (dirY(driftHeading) * driftAccel + dirY(swirlHeading) * swirlAccel) * step
  } else {
    if (config.kind !== 'fixedWingAircraft') return false
    // 固定翼保持最低前进惯性；随下坠逐渐加深转弯，形成大半径弧线俯冲而非原地旋转。
    const targetSpeed = Math.max(config.minSpeed * 0.78, unit.stats.speed * 0.46, 0.35)
    const speed = approachNumber(speedBefore, targetSpeed, Math.max(0.1, config.accel * 0.42) * step)
    const radiusTurnRate = speed / Math.max(0.5, config.turnRadius * 1.15)
    const configuredTurnRate = Math.max(0.1, config.turnSpeed) * DEG * 0.72
    const turnRate = Math.min(configuredTurnRate, radiusTurnRate) * (0.58 + progress * 0.72)
    aircraft.heading = wrapAngle(aircraft.heading + crash.spinDirection * turnRate * step)
    aircraft.vx = dirX(aircraft.heading) * speed
    aircraft.vy = dirY(aircraft.heading) * speed
  }

  // 飞行器的坠毁轨迹也允许越过战场边界；边界外只是不再显示地面场景，不应截断惯性和螺旋下坠。
  host.x += aircraft.vx * step
  host.y += aircraft.vy * step
  const altitudeExponent = crash.kind === 'rotorcraft' ? 1.68 : 1.38
  const altitude = crash.startAltitude * (1 - Math.pow(progress, altitudeExponent))
  aircraft.altitude = Math.max(0, altitude)
  aircraft.targetAltitude = 0
  aircraft.verticalSpeed = step > 0 ? (aircraft.altitude - previousAltitude) / step : 0
  if (host.vehicle) {
    host.vehicle.heading = aircraft.heading
    host.vehicle.vx = aircraft.vx
    host.vehicle.vy = aircraft.vy
  }
  if (progress < 1) return false
  aircraft.altitude = 0
  aircraft.verticalSpeed = 0
  aircraft.vx = 0
  aircraft.vy = 0
  if (host.vehicle) { host.vehicle.vx = 0; host.vehicle.vy = 0 }
  crash.impacted = true
  return true
}

const UNIT_DESTRUCTION_DURATION: Record<UnitDestructionEffect, number> = {
  small: 1.35,
  medium: 1.75,
  large: 2.25,
  violent: 3.1,
}

type UnitDestructionHost = {
  x: number
  y: number
  vehicle?: Pick<UnitVehicleRuntime, 'heading'>
  aircraft?: Pick<UnitAircraftRuntime, 'heading'>
  bossSizeScale?: number
}

/**
 * 所有阵营、玩家及飞行单位共用的摧毁入口。只创建表现与死亡音频，
 * 不附带 AOE；自爆单位自身的战斗伤害继续由自爆结算独立处理。
 */
function emitUnitDestruction(
  s: GameState,
  host: UnitDestructionHost,
  unit: UnitDef | undefined,
  platformOverride?: FortressDef,
): void {
  const platform = platformOverride ?? (unit ? unitVehiclePlatform(unit) : undefined)
  const scale = host.bossSizeScale ?? 1
  const width = Math.max(0.2, (platform?.w ?? unit?.visual?.width ?? (unit?.stats.size ?? 0.5) * 2) * scale)
  const height = Math.max(0.2, (platform?.h ?? unit?.visual?.height ?? (unit?.stats.size ?? 0.5) * 2) * scale)
  const preset = resolveUnitDestructionEffect(platform?.destructionEffect ?? unit?.visual?.destructionEffect, width, height)
  const duration = UNIT_DESTRUCTION_DURATION[preset]
  const radiusScale = preset === 'small' ? 0.42 : preset === 'medium' ? 0.55 : preset === 'large' ? 0.7 : 0.9
  ;(s.audioSignals ??= []).push({ id: s.nextId++, kind: 'unitDeath', defId: unit?.id ?? platform?.unitId, x: host.x, y: host.y, left: 0.4 })
  s.explosions.push({
    id: s.nextId++, x: host.x, y: host.y,
    r: Math.max(0.34, Math.max(width, height) * radiusScale),
    ttl: duration, max: duration, kind: 'unitDeath', deathEffect: preset,
    heading: host.vehicle?.heading ?? host.aircraft?.heading ?? 0,
    bodyWidth: width, bodyHeight: height,
  })
}

/** 飞行单位触地后的统一收尾；不额外产生 AOE 或重复结算击杀。 */
function emitUnitAircraftCrashImpact(s: GameState, host: MovableAircraftHost, unit: UnitDef): void {
  emitUnitDestruction(s, host, unit)
  if (!unitVehiclePlatform(unit)) addFloat(s, host.x, host.y, `${unit.name}阵亡`)
}

function normalizeEnemyDamageMultiplier(value: unknown): number {
  const multiplier = Number(value)
  return Number.isFinite(multiplier) ? Math.max(0, Math.min(100, multiplier)) : 1
}

function enemyAttackDamageMultiplier(enemy: Pick<Enemy, 'damageMultiplier'> | undefined): number {
  return normalizeEnemyDamageMultiplier(enemy?.damageMultiplier)
}

function scaledEnemyBlastEffect(effect: TurretDef['blastEffect'], multiplier: number): TurretDef['blastEffect'] {
  if (!effect || multiplier === 1) return effect
  return {
    ...effect,
    damage: effect.damage * multiplier,
    burn: effect.burn ? { ...effect.burn, damage: effect.burn.damage * multiplier } : undefined,
  }
}

function spawnEnemyAt(s: GameState, kind: EnemyKind, x: number, y: number, unitDefId = enemyUnitId(kind), damageMultiplier = 1): Enemy {
  const unit = runtimeEnemyUnitDef(unitDefId, kind)
  const interval = unit.combat?.interval ?? 1
  const enemyId = s.nextId++
  const hp = Math.round(unit.stats.hp * waveHpScale(s.wave))
  const enemy: Enemy = {
    id: enemyId, kind, unitDefId: unit.id, damageMultiplier: normalizeEnemyDamageMultiplier(damageMultiplier),
    x: Math.max(0.1, Math.min(LEVEL.cols - 0.1, x)),
    y: Math.max(-0.5, Math.min(LEVEL.rows - 0.1, y)),
    hp, maxHp: hp, mode: 'move', targetKind: null, targetId: null,
    goalX: x, goalY: y, hasGoal: false, pathVersion: -1,
    attackedBy: [], dots: [], hitFlash: 0,
    attackCooldown: eventRandom(enemyId, 97) * interval,
  }
  enemy.vehicle = createUnitVehicleRuntime(unit, Math.PI)
  enemy.aircraft = createUnitAircraftRuntime(unit, Math.PI)
  ensureUnitVehicleTurrets(s, enemy, unit)
  if (unit.boss?.enabled) {
    enemy.maxHp = Math.round(enemy.maxHp * (unit.boss.hpScale ?? 1))
    enemy.hp = enemy.maxHp
    enemy.bossName = unit.boss.displayName || unit.name
    enemy.bossSizeScale = unit.boss.sizeScale ?? 1
    enemy.bossBarColor = unit.boss.barColor ?? '#B3392E'
    enemy.bossPhases = structuredClone(unit.boss.phases ?? [])
    enemy.bossDefeatActions = structuredClone(unit.boss.defeatActions ?? [])
    enemy.bossPhaseDone = []
  }
  s.enemies.push(enemy)
  return enemy
}

function unitSpawnOverlapsExisting(s: GameState, def: UnitDef, x: number, y: number, heading: number): boolean {
  if (def.stats.air) return false
  const candidate: GroundUnitCollisionBody = {
    id: -1, x, y, def, heading: def.type === 'vehicle' ? heading : null,
    scale: 1, inverseMass: 1,
  }
  const overlaps = (other: GroundUnitCollisionBody): boolean => {
    const dx = other.x - x, dy = other.y - y
    const distance = Math.hypot(dx, dy)
    const angle = distance > 1e-7 ? { x: dx / distance, y: dy / distance } : { x: 1, y: 0 }
    return distance < groundUnitSupport(candidate, angle.x, angle.y) + groundUnitSupport(other, -angle.x, -angle.y) + 0.05
  }
  for (const enemy of s.enemies) {
    if (enemy.hp <= 0) continue
    const otherDef = runtimeEnemyUnitDef(enemy.unitDefId, enemy.kind)
    if (otherDef.stats.air) continue
    if (overlaps({ id: enemy.id, x: enemy.x, y: enemy.y, def: otherDef, heading: enemy.vehicle?.heading ?? null, scale: enemy.bossSizeScale ?? 1, inverseMass: 1 })) return true
  }
  for (const ally of s.allies) {
    if (ally.hp <= 0) continue
    const otherDef = runtimeAllyUnitDef(ally.unitDefId, ally.kind)
    if (otherDef.stats.air) continue
    if (overlaps({ id: ally.id, x: ally.x, y: ally.y, def: otherDef, heading: ally.vehicle?.heading ?? null, scale: 1, inverseMass: 1 })) return true
  }
  return false
}

/** 从指定车身方向向外逐环寻找合法生成点；该侧无空位时返回 null，由运行态按间隔重试。 */
function unitDeploySpawnPoint(s: GameState, host: UnitDeployHost, hostDef: UnitDef, def: UnitDef, direction: UnitDeployDirection): { x: number; y: number } | null {
  const heading = host.vehicle?.heading ?? host.initialHeading ?? 0
  const hostBody: GroundUnitCollisionBody = { id: host.id, x: host.x, y: host.y, def: hostDef, heading: host.vehicle?.heading ?? null, scale: 'bossSizeScale' in host ? host.bossSizeScale ?? 1 : 1, inverseMass: 1 }
  const spawnBody: GroundUnitCollisionBody = { id: -1, x: 0, y: 0, def, heading: def.type === 'vehicle' ? heading : null, scale: 1, inverseMass: 1 }
  const bounds = unitMovementBounds(def, spawnBody.heading, 1)
  const frontAngle = Math.atan2(dirY(heading), dirX(heading))
  const baseAngle = frontAngle + (direction === 'rear' ? Math.PI : direction === 'left' ? -Math.PI / 2 : direction === 'right' ? Math.PI / 2 : 0)
  const angleOffsets = [0, 15, -15, 30, -30, 45, -45].map(value => value * DEG)
  for (let ring = 0; ring < 8; ring++) for (const offset of angleOffsets) {
    const angle = baseAngle + offset
    const ux = Math.cos(angle), uy = Math.sin(angle)
    const baseRadius = groundUnitSupport(hostBody, ux, uy) + groundUnitSupport(spawnBody, -ux, -uy) + 0.12
    const radius = baseRadius + ring * Math.max(0.45, Math.min(1.5, baseRadius * 0.45))
    const x = host.x + ux * radius, y = host.y + uy * radius
    if (x - bounds.rx < 0 || x + bounds.rx > LEVEL.cols || y - bounds.ry < 0 || y + bounds.ry > LEVEL.rows) continue
    if (!def.stats.air && unitWorldBlockedAt(s, def, x, y, spawnBody.heading, 1)) continue
    if (unitSpawnOverlapsExisting(s, def, x, y, heading)) continue
    return { x, y }
  }
  return null
}

function spawnDeployedUnit(s: GameState, source: UnitDeployHost, sourceDef: UnitDef, unit: UnitDef, direction: UnitDeployDirection): Enemy | Ally | null {
  const faction: LevelPlacedUnitFaction = source.faction ?? ('mode' in source ? 'enemy' : 'ally')
  const point = unitDeploySpawnPoint(s, source, sourceDef, unit, direction)
  if (!point) return null
  const heading = source.vehicle?.heading ?? 0
  if (faction === 'enemy' || faction === 'neutralHostile') {
    const enemy = spawnEnemyAt(s, enemyKindForUnit(unit), point.x, point.y, unit.id)
    enemy.faction = faction
    enemy.controller = 'ai'
    enemy.behaviorHomeX = point.x
    enemy.behaviorHomeY = point.y
    if (enemy.vehicle) {
      enemy.vehicle.heading = heading
      syncUnitVehicleTurrets(enemy, unit)
    }
    if (unitFootprint(unit).blocksMovement) s.pathVersion++
    return enemy
  }
  const kind = allyKindForUnit(unit)
  const ally: Ally = {
    id: s.nextId++, kind, unitDefId: unit.id, faction, controller: 'ai', producerId: 0,
    x: point.x, y: point.y, hp: unit.stats.hp, maxHp: unit.stats.hp,
    cooldown: 0, targetId: null, hitFlash: 0,
    vehicle: createUnitVehicleRuntime(unit, heading),
    aircraft: createUnitAircraftRuntime(unit, heading),
    behaviorHomeX: point.x, behaviorHomeY: point.y, behaviorWait: 0,
  }
  s.allies.push(ally)
  ensureUnitVehicleTurrets(s, ally, unit)
  if (unitFootprint(unit).blocksMovement) s.pathVersion++
  return ally
}

const { updateUnitDeployForces } = createDeploymentAI({
  factionsHostile,
  unitCanSeePoint,
  unitRadiusToward,
  fortressCenter,
  fortressDistanceToPoint,
  currentUnitAltitude,
  turretDefById: defOf,
  spawnDeployedUnit,
  moveEnemyVehicleToward,
  moveToward,
  moveAllyToward,
  moveUnitVehicleToward,
})

/** 旧存档没有 enemy.vehicle.turrets；进入运行时后按单位模板补齐一次。 */
type VehicleUnitHost = Pick<Enemy, 'id' | 'x' | 'y' | 'vehicle' | 'faction' | 'flipX'> | Pick<Ally, 'id' | 'x' | 'y' | 'vehicle' | 'faction' | 'flipX'>

/** 镜像实例的炮位位置、固定角和射界必须一起镜像，避免视觉与攻击逻辑分离。 */
function effectiveUnitHardpoint(host: Pick<VehicleUnitHost, 'flipX'>, vehicle: FortressDef, hp: Hardpoint): Hardpoint {
  if (!host.flipX) return hp
  return {
    ...hp,
    x: vehicle.w - hp.x,
    fixed: hp.fixed === undefined ? undefined : -hp.fixed,
    arc: hp.arc ? { start: -hp.arc.end, end: -hp.arc.start } : undefined,
  }
}

export function ensureUnitVehicleTurrets(s: GameState, host: VehicleUnitHost, unit: UnitDef): Turret[] {
  const vehicle = host.vehicle
  if (!vehicle) return []
  if (vehicle.turrets === undefined) vehicle.turrets = []
  if (vehicle.turrets.length > 0) return vehicle.turrets
  const vehicleDef = unitVehiclePlatform(unit)
  if (!vehicleDef) return vehicle.turrets
  for (const sourceHp of vehicleDef.hardpoints) {
    if (!sourceHp.builtIn) continue
    const hp = effectiveUnitHardpoint(host, vehicleDef, sourceHp)
    const def = TURRET_DEFS.find(item => item.id === hp.builtIn)
    if (!def || def.mount !== hp.size || (hp.types && !hp.types.includes(def.type))) continue
    vehicle.turrets.push({
      id: s.nextId++, defId: def.id,
      x: host.x - def.w / 2, y: host.y - def.h / 2,
      w: def.w, h: def.h, level: 1,
      hp: def.hp, maxHp: def.hp,
      angle: wrapAngle(vehicle.heading + (hp.fixed !== undefined ? hp.fixed * DEG : hp.arc ? hardpointArcMid(hp.arc) : 0)),
      cooldown: 0, burstLeft: 0, burstTimer: 0,
      rackLeft: def.type === 'missile' ? Math.max(1, def.burst ?? 1) : 0,
      rackAnim: 0, rackTimer: 0, chargeLeft: 0,
      firing: false, firingLeft: 0, tickTimer: 0,
      targetId: null, barrelIdx: 0,
      hardpointId: hp.id, builtIn: true, locked: hp.lockedTurret === true,
    })
  }
  syncUnitVehicleTurrets(host, unit)
  return vehicle.turrets
}

function ensureEnemyVehicleTurrets(s: GameState, enemy: Enemy, unit = runtimeEnemyUnitDef(enemy.unitDefId, enemy.kind)): Turret[] {
  return ensureUnitVehicleTurrets(s, enemy, unit)
}

/** 炮位局部几何中心随敌方载具的世界位置和朝向同步。 */
function syncUnitVehicleTurrets(host: Pick<VehicleUnitHost, 'x' | 'y' | 'vehicle' | 'flipX'>, unit: UnitDef): void {
  const def = unitVehiclePlatform(unit)
  if (!host.vehicle?.turrets || !def) return
  const localCenter = fortressLocalCenter(def)
  const c = Math.cos(host.vehicle.heading), sn = Math.sin(host.vehicle.heading)
  for (const turret of host.vehicle.turrets) {
    const sourceHp = def.hardpoints.find(item => item.id === turret.hardpointId)
    if (!sourceHp) continue
    const hp = effectiveUnitHardpoint(host, def, sourceHp)
    const ox = hp.x - localCenter.x, oy = hp.y - localCenter.y
    const wx = host.x + ox * c - oy * sn
    const wy = host.y + ox * sn + oy * c
    turret.x = wx - turret.w / 2
    turret.y = wy - turret.h / 2
  }
}

function syncEnemyVehicleTurrets(enemy: Enemy, unit = runtimeEnemyUnitDef(enemy.unitDefId, enemy.kind)): void {
  syncUnitVehicleTurrets(enemy, unit)
}

/**
 * 将所有阵营的车载炮塔重新锚定到载具炮位。
 * 用于碰撞分离等会批量直接改写单位坐标的流程，确保阵营不再产生表现差异。
 */
export function syncAllUnitVehicleTurrets(s: GameState): void {
  for (const enemy of s.enemies) {
    if (enemy.vehicle) syncUnitVehicleTurrets(enemy, runtimeEnemyUnitDef(enemy.unitDefId, enemy.kind))
  }
  for (const ally of s.allies) {
    if (ally.vehicle) syncUnitVehicleTurrets(ally, runtimeAllyUnitDef(ally.unitDefId, ally.kind))
  }
}

function spawnEnemyUnitAt(s: GameState, unitDefId: string, x: number, y: number): Enemy | null {
  const unit = unitDefById(unitDefId)
  if (!unit) return null
  return spawnEnemyAt(s, enemyKindForUnit(unit), x, y, unit.id)
}

function zoneSpawnPoint(z: LevelZone, seed: number): { x: number; y: number } {
  const side = Math.floor(eventRandom(seed, 0) * 4)
  const px = z.x + 0.35 + eventRandom(seed, 1) * Math.max(0.1, z.w - 0.7)
  const py = z.y + 0.35 + eventRandom(seed, 2) * Math.max(0.1, z.h - 0.7)
  if (side === 0) return { x: px, y: z.y + 0.15 }
  if (side === 1) return { x: z.x + z.w - 0.15, y: py }
  if (side === 2) return { x: px, y: z.y + z.h - 0.15 }
  return { x: z.x + 0.15, y: py }
}

interface EventSourceContext {
  sourceUnitId?: number
  sourceObjectId?: number
  regionCells?: string[]
  eventRuntimeId?: number
}

function eventSpawnPoint(seq: EventSequenceRuntime, seed: number): { x: number; y: number } {
  const cells = seq.regionCells
  if (!cells?.length) return zoneSpawnPoint(seq.zone, seed)
  const key = cells[Math.floor(eventRandom(seed, 0) * cells.length) % cells.length]
  const [x, y] = key.split(',').map(Number)
  return { x: x + 0.15 + eventRandom(seed, 1) * 0.7, y: y + 0.15 + eventRandom(seed, 2) * 0.7 }
}

function pushEventDebug(s: GameState, entry: Omit<EventDebugEntry, 'id' | 'time'>): void {
  const log = (s.eventDebugLog ??= [])
  log.push({ id: (log[log.length - 1]?.id ?? 0) + 1, time: s.time, ...entry })
  if (s.eventDebugLog.length > 80) s.eventDebugLog.splice(0, s.eventDebugLog.length - 80)
}

function eventDebugName(eventId: number | undefined): string {
  return eventId === undefined || eventId <= 0 ? '局部事件' : LEVEL.events.find(event => event.id === eventId)?.name ?? `事件 ${eventId}`
}

function queueEvent(s: GameState, sourceId: number, zone: LevelZone, actions: LevelEventAction[], context: EventSourceContext & { callDepth?: number } = {}): number | undefined {
  if (actions.length === 0) return undefined
  const id = s.nextId++
  s.eventQueue.push({ id, sourceId, zone: { ...zone }, actions: structuredClone(actions), index: 0, waitLeft: 0, ...context })
  return id
}

type ScriptEntity = { side: 'enemy'; value: Enemy } | { side: 'ally'; value: Ally }

function resolveScriptEntities(s: GameState, selector: LevelUnitSelector, sourceUnitId?: number): ScriptEntity[] {
  if (selector.scope === 'source') {
    if (sourceUnitId === undefined) return []
    const enemy = s.enemies.find(unit => unit.id === sourceUnitId)
    if (enemy) return [{ side: 'enemy', value: enemy }]
    const ally = s.allies.find(unit => unit.id === sourceUnitId)
    return ally ? [{ side: 'ally', value: ally }] : []
  }
  if (selector.scope === 'placement') {
    const enemy = s.enemies.find(unit => unit.placementId === selector.placementId)
    if (enemy) return [{ side: 'enemy', value: enemy }]
    const ally = s.allies.find(unit => unit.placementId === selector.placementId)
    return ally ? [{ side: 'ally', value: ally }] : []
  }
  if (selector.scope === 'group') return [
    ...s.enemies.filter(unit => unit.group === selector.group).map(value => ({ side: 'enemy' as const, value })),
    ...s.allies.filter(unit => unit.group === selector.group).map(value => ({ side: 'ally' as const, value })),
  ]
  if (selector.scope === 'allEnemies') return s.enemies.map(value => ({ side: 'enemy' as const, value }))
  if (selector.scope === 'allAllies') return s.allies.map(value => ({ side: 'ally' as const, value }))
  return [
    ...s.enemies.filter(unit => unit.unitDefId === selector.unitDefId).map(value => ({ side: 'enemy' as const, value })),
    ...s.allies.filter(unit => unit.unitDefId === selector.unitDefId).map(value => ({ side: 'ally' as const, value })),
  ]
}

function scriptEntityKey(entity: ScriptEntity): string { return `${entity.side}:${entity.value.id}` }

function scriptEntityByKey(s: GameState, key: string): ScriptEntity | null {
  const [side, idText] = key.split(':')
  const id = Number(idText)
  if (side === 'enemy') {
    const value = s.enemies.find(unit => unit.id === id)
    return value ? { side, value } : null
  }
  const value = s.allies.find(unit => unit.id === id)
  return value ? { side: 'ally', value } : null
}

function resetSwitchedUnitCombat(unit: Enemy | Ally): void {
  unit.targetId = null
  unit.script = undefined
  unit.behaviorEngaged = false
  unit.behaviorReturning = false
  unit.behaviorLostTime = 0
  unit.retaliationSide = undefined
  unit.retaliationId = undefined
  unit.retaliationUntil = undefined
  if ('targetKind' in unit) unit.targetKind = null
  if ('mode' in unit) unit.mode = 'move'
  if ('hasGoal' in unit) unit.hasGoal = false
  for (const turret of unit.vehicle?.turrets ?? []) {
    turret.targetId = null
    turret.firing = false
    turret.firingLeft = 0
    turret.chargeLeft = 0
    turret.burstLeft = 0
    turret.burstTimer = 0
    turret.tickTimer = 0
  }
}

function runtimeUnitFaction(unit: Enemy | Ally): LevelPlacedUnitFaction {
  return unit.faction ?? ('mode' in unit ? 'enemy' : 'ally')
}

/** 阵营跨越敌对边界时迁移运行时池；保留生命、位置、载具、炮塔与关卡实例身份。 */
function switchScriptEntityFaction(s: GameState, entity: ScriptEntity, faction: LevelPlacedUnitFaction): void {
  const toEnemyPool = faction === 'enemy' || faction === 'neutralHostile'
  resetSwitchedUnitCombat(entity.value)
  if (entity.side === 'enemy' && toEnemyPool) {
    entity.value.faction = faction
  } else if (entity.side === 'ally' && !toEnemyPool) {
    entity.value.faction = faction
  } else if (entity.side === 'enemy') {
    const source = entity.value
    const unit = runtimeEnemyUnitDef(source.unitDefId, source.kind)
    const moved: Ally = {
      ...source,
      kind: allyKindForUnit(unit),
      faction: faction as 'player' | 'ally' | 'neutral',
      producerId: 0,
      cooldown: source.attackCooldown ?? 0,
      targetId: null,
    }
    s.enemies = s.enemies.filter(item => item.id !== source.id)
    s.allies.push(moved)
  } else {
    const source = entity.value
    const unit = runtimeAllyUnitDef(source.unitDefId, source.kind)
    const moved: Enemy = {
      ...source,
      kind: enemyKindForUnit(unit),
      faction: faction as 'enemy' | 'neutralHostile',
      mode: 'move',
      targetKind: null,
      targetId: null,
      goalX: source.x,
      goalY: source.y,
      hasGoal: false,
      pathVersion: -1,
      attackedBy: [],
      dots: source.dots ?? [],
      attackCooldown: source.cooldown,
    }
    s.allies = s.allies.filter(item => item.id !== source.id)
    s.enemies.push(moved)
  }

  const changedId = entity.value.id
  const changedFaction = faction
  for (const unit of [...s.enemies, ...s.allies]) {
    const noLongerHostile = !factionsHostile(runtimeUnitFaction(unit), changedFaction)
    if (unit.targetId === changedId && noLongerHostile) resetSwitchedUnitCombat(unit)
    for (const turret of unit.vehicle?.turrets ?? []) if (turret.targetId === changedId && noLongerHostile) {
      turret.targetId = null
      turret.firing = false
      turret.firingLeft = 0
    }
  }
  if (!factionsHostile('player', changedFaction)) for (const turret of s.turrets) if (turret.targetId === changedId) {
    turret.targetId = null
    turret.firing = false
    turret.firingLeft = 0
  }
}

/** 返回目标物体所属的 Autotile 四方向连通组；普通物体只返回自身。 */
function connectedObjectStateIds(objectId: number): number[] {
  const entries = LEVEL.objects.map((object, index) => ({ ...object, id: object.id ?? 2000 + index }))
  const target = entries.find(object => object.id === objectId)
  if (!target) return [objectId]
  const def = objectTypeById(target.defId)
  if (!def || !isAutotileAsset(def.asset)) return [objectId]
  const ids: number[] = []
  const pending = [target]
  const remaining = new Map(entries
    .filter(object => object.defId === target.defId && (object.renderLayer ?? 3) === (target.renderLayer ?? 3))
    .map(object => [object.id, object]))
  remaining.delete(target.id)
  while (pending.length > 0) {
    const current = pending.shift()!
    ids.push(current.id)
    for (const candidate of remaining.values()) {
      if (Math.abs(candidate.x - current.x) + Math.abs(candidate.y - current.y) !== 1) continue
      remaining.delete(candidate.id)
      pending.push(candidate)
    }
  }
  return ids
}

function beginUnitCommand(s: GameState, seq: EventSequenceRuntime, action: Extract<LevelEventAction, { type: 'unit' }>): void {
  // sourceUnitId 是新版真实来源；sourceId 仅保留旧存档/测试直接构造序列的兼容。
  const entities = resolveScriptEntities(s, action.selector, seq.sourceUnitId ?? (seq.sourceId > 0 ? seq.sourceId : undefined))
  seq.unitTargetIds = entities.map(scriptEntityKey)
  const key = `${seq.id}:${seq.index}`
  for (const entity of entities) {
    const unit = entity.side === 'enemy'
      ? runtimeEnemyUnitDef(entity.value.unitDefId, entity.value.kind)
      : runtimeAllyUnitDef(entity.value.unitDefId, entity.value.kind)
    if (action.command.kind === 'faction') {
      switchScriptEntityFaction(s, entity, action.command.faction)
    } else if (action.command.kind === 'ai') {
      if (action.command.mode === 'pause') entity.value.scriptPaused = true
      else if (action.command.mode === 'restore') { entity.value.scriptPaused = false; entity.value.aiOverride = undefined }
      else { entity.value.scriptPaused = false; entity.value.aiOverride = aiOverrideFromCommand(action.command, unit.ai) }
    } else if (action.command.kind === 'behavior') {
      entity.value.behaviorOverride = action.command.behavior === 'restore' ? undefined : {
        behavior: action.command.behavior,
        range: action.command.range,
        interval: action.command.interval,
        speedPercent: action.command.speedPercent,
      }
      entity.value.behaviorHomeX = undefined
      entity.value.behaviorHomeY = undefined
      entity.value.behaviorTargetX = undefined
      entity.value.behaviorTargetY = undefined
      entity.value.behaviorWait = 0
      entity.value.behaviorStep = 0
      entity.value.behaviorRouteIndex = 0
      entity.value.behaviorActive = false
      entity.value.behaviorEngaged = false
      entity.value.behaviorReturning = false
      entity.value.behaviorLostTime = 0
      entity.value.retaliationSide = undefined
      entity.value.retaliationId = undefined
      entity.value.retaliationUntil = undefined
      entity.value.targetId = null
      if (entity.side === 'enemy') {
        entity.value.targetKind = null
        entity.value.mode = 'move'
        entity.value.hasGoal = false
      }
    } else if (action.command.kind === 'remove') {
      entity.value.hp = 0
    } else if (action.command.kind === 'altitude') {
      if (!setUnitAircraftTargetAltitude(entity.value, unit, action.command.altitude)) continue
      if (action.command.wait) entity.value.script = {
        key, command: structuredClone(action.command), left: 0, done: false,
      }
    } else {
      const command = structuredClone(action.command)
      if (command.kind === 'attack' && typeof command.target === 'object' && command.target.type === 'sourceObject') {
        if (seq.sourceObjectId === undefined) continue
        command.target = { type: 'object', objectId: seq.sourceObjectId }
      }
      entity.value.script = {
        key, command,
        left: action.command.kind === 'hold' || action.command.kind === 'attack' ? action.command.seconds : 0,
        done: false,
      }
    }
  }
}

function unitCommandComplete(s: GameState, seq: EventSequenceRuntime): boolean {
  return (seq.unitTargetIds ?? []).every(key => {
    const entity = scriptEntityByKey(s, key)
    return !entity || !entity.value.script || entity.value.script.done
  })
}

/** 提交事件“选择”指令的玩家选择；后续动作会在下一逻辑帧插入当前事件序列。 */
export function resolveEventChoice(s: GameState, promptId: number, optionIndex: number): GameState {
  if (!s.eventChoice || s.eventChoice.id !== promptId || optionIndex < 0 || optionIndex >= s.eventChoice.options.length) return s
  const n = clone(s)
  if (n.eventChoice?.id === promptId) n.eventChoice.selectedIndex = optionIndex
  return n
}

/** 关闭由事件指令打开的装配界面，让该事件继续执行。 */
export function completeEventAssembly(s: GameState, promptId: number): GameState {
  if (!s.eventAssembly || s.eventAssembly.id !== promptId) return s
  const n = clone(s)
  n.eventAssembly = undefined
  return n
}

function executeEventAction(s: GameState, seq: EventSequenceRuntime, action: LevelEventAction): boolean {
  if (action.type === 'wait') {
    if (seq.waitLeft <= 0) seq.waitLeft = action.seconds
    return seq.waitLeft <= 0
  }
  if (action.type === 'spawn') {
    let order = 0
    for (const [unitDefId, count] of Object.entries(levelSpawnUnitCounts(action))) for (let i = 0; i < count; i++) {
      const unit = unitDefById(unitDefId)
      if (!unit) continue
      const p = eventSpawnPoint(seq, seq.id * 1000003 + order)
      s.ambushQueue.push({ triggerId: seq.sourceId, kind: enemyKindForUnit(unit), unitDefId, left: order * action.interval, x: p.x, y: p.y })
      order++
    }
  } else if (action.type === 'boss') {
    const p = eventSpawnPoint(seq, seq.id * 1000003 + seq.index)
    const e = spawnEnemyUnitAt(s, action.boss.unitDefId ?? enemyUnitId(action.boss.kind), p.x, p.y)
      ?? spawnEnemyAt(s, action.boss.kind, p.x, p.y)
    const baseUnit = runtimeEnemyUnitDef(e.unitDefId, e.kind)
    e.maxHp = Math.round(baseUnit.stats.hp * waveHpScale(s.wave) * action.boss.hpScale)
    e.hp = e.maxHp
    e.bossName = action.boss.name
    e.bossSizeScale = action.boss.sizeScale
    e.bossBarColor = baseUnit.boss?.barColor ?? '#B3392E'
    e.bossPhases = structuredClone(action.boss.phases)
    e.bossDefeatActions = structuredClone(action.boss.defeatActions)
    e.bossPhaseDone = []
    s.notices.push({ id: s.nextId++, text: `Boss 出现：${action.boss.name}`, left: 4 })
  } else if (action.type === 'message') {
    if (action.text) s.notices.push({ id: s.nextId++, text: action.text, left: action.duration })
  } else if (action.type === 'dialogue') {
    if (!seq.actionStarted) {
      s.cinematicDialogue = { id: s.nextId++, speaker: action.speaker, text: action.text, left: action.duration, max: action.duration }
      seq.actionStarted = true
      if (action.wait) { seq.waitLeft = action.duration; return false }
    }
  } else if (action.type === 'text') {
    if (!seq.actionStarted) {
      s.cinematicText = { id: s.nextId++, text: action.text, position: action.position, left: action.duration, max: action.duration }
      seq.actionStarted = true
      if (action.wait) { seq.waitLeft = action.duration; return false }
    }
  } else if (action.type === 'camera') {
    if (!seq.actionStarted) {
      s.cinematicCamera = { id: s.nextId++, x: action.x, y: action.y, startedAt: s.time, duration: action.duration, hold: action.hold, returnToOrigin: action.returnToOrigin }
      seq.actionStarted = true
      const totalDuration = action.duration + action.hold + (action.returnToOrigin ? action.duration : 0)
      if (action.wait && totalDuration > 0) { seq.waitLeft = totalDuration; return false }
    }
  } else if (action.type === 'choice') {
    if (!seq.actionStarted) {
      if (s.eventChoice && (s.eventChoice.sequenceId !== seq.id || s.eventChoice.actionIndex !== seq.index)) return false
      s.eventChoice = { id: s.nextId++, sequenceId: seq.id, actionIndex: seq.index, prompt: action.prompt, options: action.options.map(option => option.text) }
      seq.actionStarted = true
      return false
    }
    const prompt = s.eventChoice
    if (!prompt || prompt.sequenceId !== seq.id || prompt.actionIndex !== seq.index || prompt.selectedIndex === undefined) return false
    const selected = action.options[prompt.selectedIndex]
    if (selected?.actions.length) seq.actions.splice(seq.index + 1, 0, ...structuredClone(selected.actions))
    s.eventChoice = undefined
  } else if (action.type === 'assembly') {
    if (!seq.actionStarted) {
      if (s.eventAssembly && (s.eventAssembly.sequenceId !== seq.id || s.eventAssembly.actionIndex !== seq.index)) return false
      s.eventAssembly = { id: s.nextId++, sequenceId: seq.id, actionIndex: seq.index }
      seq.actionStarted = true
      return false
    }
    if (s.eventAssembly?.sequenceId === seq.id && s.eventAssembly.actionIndex === seq.index) return false
  } else if (action.type === 'sound') {
    if (action.presetId) (s.audioSignals ??= []).push({ id: s.nextId++, kind: 'cue', cueId: action.presetId, left: 0.3 })
  } else if (action.type === 'music') {
    (s.audioSignals ??= []).push({ id: s.nextId++, kind: 'music', cueId: action.assetId, musicMode: action.mode, left: 0.3 })
  } else if (action.type === 'reward') {
    s.gold += action.gold
    addFloat(s, s.fortress.x, s.fortress.y, `奖励 +${action.gold}`)
  } else if (action.type === 'levelVariable') {
    s.levelVariables[action.variableId] = action.operation === 'add' ? Number(s.levelVariables[action.variableId] ?? 0) + action.value : action.value
  } else if (action.type === 'globalVariable') {
    s.globalVariables[action.variableId] = action.operation === 'add' ? Number(s.globalVariables[action.variableId] ?? 0) + action.value : action.value
    saveGlobalVariableValues(s.globalVariables)
  } else if (action.type === 'setEventEnabled') {
    const runtime = s.unifiedEventStates.find(event => event.id === action.eventId)
    if (runtime) runtime.enabled = action.enabled
  } else if (action.type === 'callEvent') {
    const called = LEVEL.events.find(event => event.id === action.eventId)
    if (!called || called.actions.length === 0) return true
    if (!seq.actionStarted) {
      const depth = seq.callDepth ?? 0
      if (depth >= 8) {
        pushEventDebug(s, { eventId: action.eventId, eventName: called.name, status: 'blocked', detail: '调用深度超过 8 层，已阻止递归' })
        return true
      }
      seq.waitingChildSequenceId = queueEvent(s, seq.sourceId, seq.zone, called.actions, {
        sourceUnitId: seq.sourceUnitId,
        sourceObjectId: seq.sourceObjectId,
        regionCells: seq.regionCells,
        eventRuntimeId: called.id,
        callDepth: depth + 1,
      })
      const calledRuntime = s.unifiedEventStates.find(event => event.id === called.id)
      if (calledRuntime) calledRuntime.callActivations = (calledRuntime.callActivations ?? 0) + 1
      seq.actionStarted = true
      pushEventDebug(s, { eventId: called.id, eventName: called.name, status: 'triggered', detail: `由${eventDebugName(seq.eventRuntimeId)}调用` })
      return seq.waitingChildSequenceId === undefined
    }
    if (seq.waitingChildSequenceId !== undefined && s.eventQueue.some(child => child.id === seq.waitingChildSequenceId)) return false
    seq.waitingChildSequenceId = undefined
  } else if (action.type === 'setObjectState') {
    const targetObjectId = action.objectId === 'source' ? seq.sourceObjectId : action.objectId
    if (targetObjectId === undefined) return true
    let pathingChanged = false
    for (const objectId of connectedObjectStateIds(targetObjectId)) {
      s.objectStates[objectId] = action.state
      const object = s.objects.find(item => item.id === objectId)
      if (object && action.state === 'open') {
        if (object.blockMove || object.blockProjectile) pathingChanged = true
        object.blockMove = false
        object.blockProjectile = false
      }
    }
    if (pathingChanged) s.pathVersion++
  } else if (action.type === 'supply') {
    s.gold = Math.max(0, s.gold + action.gold)
    const bonuses = moduleBonuses(s)
    s.ammo = Math.max(0, Math.min(AMMO.cap + bonuses.ammoCap, s.ammo + action.ammo))
    s.energy = Math.max(0, Math.min(ENERGY.cap + bonuses.energyCap, s.energy + action.energy))
    for (const turret of s.turrets) {
      const def = defOf(turret.defId)
      syncPlayerTurretResources(turret, def, bonuses)
      changePlayerTurretAmmo(turret, def, action.ammo, bonuses)
      turret.energy = Math.max(0, Math.min(playerTurretResourceCaps(def, bonuses).energyCap, (turret.energy ?? 0) + action.energy))
    }
    const sharedBonuses = moduleBonuses(s, 'playerFaction')
    for (const ally of s.allies) {
      if (ally.faction !== 'player') continue
      for (const turret of ally.vehicle?.turrets ?? []) {
        const def = defOf(turret.defId)
        syncPlayerTurretResources(turret, def, sharedBonuses)
        changePlayerTurretAmmo(turret, def, action.ammo, sharedBonuses)
        turret.energy = Math.max(0, Math.min(playerTurretResourceCaps(def, sharedBonuses).energyCap, (turret.energy ?? 0) + action.energy))
      }
    }
  } else if (action.type === 'functionalArea') {
    const eventId = seq.eventRuntimeId ?? seq.sourceId
    const cells = [...new Set(seq.regionCells ?? [])]
    if (cells.length > 0) {
      const next: FunctionalAreaRuntime = {
        eventId, cells,
        ammoEnabled: action.ammoEnabled, ammoPerSec: action.ammoPerSec,
        energyEnabled: action.energyEnabled, energyPerSec: action.energyPerSec,
        repairEnabled: action.repairEnabled, structurePerSec: action.structurePerSec, armorPerSec: action.armorPerSec,
        assemblyEnabled: action.assemblyEnabled,
      }
      const areas = (s.functionalAreas ??= [])
      const existing = areas.findIndex(zone => zone.eventId === eventId)
      if (existing >= 0) areas[existing] = next
      else areas.push(next)
    }
  } else if (action.type === 'stageJump') {
    const next = LEVEL.stages.find(stage => stage.id === action.stageId)
    if (next) activateTaskStage(s, next, '任务阶段跳转')
  } else if (action.type === 'taskResult') {
    if (action.target === 'secondary1') s.secondaryObjectivesCompleted[0] = true
    else if (action.target === 'secondary2') s.secondaryObjectivesCompleted[1] = true
    else {
      if (action.state === 'complete') s.levelVariables['builtin:primaryObjectiveCompleted'] = true
      s.phase = action.state === 'failed' ? 'lost' : 'won'
    }
  } else if (action.type === 'unit') {
    if (!seq.actionStarted) {
      beginUnitCommand(s, seq, action)
      seq.actionStarted = true
    }
    const waits = (action.command.kind === 'move' || action.command.kind === 'altitude' || action.command.kind === 'hold' || action.command.kind === 'attack') && action.command.wait
    return !waits || unitCommandComplete(s, seq)
  }
  return true
}

function updateEventQueue(s: GameState, dt: number) {
  for (const seq of s.eventQueue) {
    if (seq.waitLeft > 0) {
      seq.waitLeft = Math.max(0, seq.waitLeft - dt)
      if (seq.waitLeft > 1e-9) continue
      seq.waitLeft = 0
      seq.index++
      seq.actionStarted = false
      seq.unitTargetIds = undefined
      seq.waitingChildSequenceId = undefined
    }
    let guard = 0
    while (seq.index < seq.actions.length && guard++ < 50) {
      if (!executeEventAction(s, seq, seq.actions[seq.index])) break
      seq.index++
      seq.actionStarted = false
      seq.unitTargetIds = undefined
      seq.waitingChildSequenceId = undefined
      if (s.phase === 'won' || s.phase === 'lost') break
    }
  }
  const completed = s.eventQueue.filter(q => q.index >= q.actions.length)
  for (const seq of completed) pushEventDebug(s, { eventId: seq.eventRuntimeId && seq.eventRuntimeId > 0 ? seq.eventRuntimeId : undefined, eventName: eventDebugName(seq.eventRuntimeId && seq.eventRuntimeId > 0 ? seq.eventRuntimeId : undefined), status: 'completed', detail: '动作序列执行完成' })
  s.eventQueue = s.eventQueue.filter(q => q.index < q.actions.length)
}

function updateInteractables(s: GameState) {
  const c = fortressCenter(s)
  for (const item of LEVEL.interactables) {
    let rt = s.interactableStates.find(v => v.id === item.id)
    if (!rt) { rt = { id: item.id, inside: false, activations: 0, enabled: item.enabled }; s.interactableStates.push(rt) }
    const inside = c.x >= item.x && c.x <= item.x + item.w && c.y >= item.y && c.y <= item.y + item.h
    if (rt.enabled && inside && !rt.inside && (!item.once || rt.activations === 0)) {
      rt.activations++
      queueEvent(s, -item.id, item, item.actions)
      s.notices.push({ id: s.nextId++, text: `${item.name} 已激活`, left: 2.5 })
    }
    rt.inside = inside
  }
}

function unifiedEventZone(cells: string[]): LevelZone {
  if (cells.length === 0) return { x: 0, y: 0, w: 1, h: 1 }
  const points = cells.map(key => key.split(',').map(Number))
  const xs = points.map(point => point[0]); const ys = points.map(point => point[1])
  const x = Math.min(...xs); const y = Math.min(...ys)
  return { x, y, w: Math.max(...xs) - x + 1, h: Math.max(...ys) - y + 1 }
}

function levelVariableValue(s: GameState, id: string): boolean | number {
  if (id === 'builtin:missionWon') return s.phase === 'won'
  if (id === 'builtin:fortressHpPercent') return s.fortress.maxHp > 0 ? s.fortress.hp / s.fortress.maxHp * 100 : 0
  if (id === 'builtin:enemyVehicleAlive') return s.enemies.filter(enemy => !!enemy.vehicle).length
  if (id === 'builtin:kills') return s.kills
  if (id === 'builtin:wave') return s.wave
  if (id === 'builtin:time') return s.time
  if (id.startsWith('global:')) return s.globalVariables[id] ?? false
  return s.levelVariables[id] ?? false
}

function runtimeEntityConditionMatches(s: GameState, condition: LevelCondition): boolean {
    if (condition.kind === 'unit') {
      const entity = placedUnitEntity(s, condition.unitPlacementId)
      const alive = !!entity && entity.hp > 0 && !s.defeatedUnitPlacementIds.includes(condition.unitPlacementId)
      return condition.state === 'alive' ? alive : !alive
    }
    if (condition.kind === 'objectState') {
      const matches = (s.objectStates[condition.objectId] ?? 'default') === condition.state
      return condition.operator === 'ne' ? !matches : matches
    }
    if (condition.kind === 'object') {
      const intact = s.objects.some(object => object.id === condition.objectId)
      return condition.state === 'intact' ? intact : !intact
    }
    return false
}

export function runtimeConditionGroupMatches(s: GameState, conditions: UnifiedLevelEvent['conditions'] | undefined): boolean {
  return conditionMatches(conditions ?? { mode: 'all', conditions: [] }, id => levelVariableValue(s, id), condition => runtimeEntityConditionMatches(s, condition))
}

/** 目标状态只由任务结果事件或任务阶段写入；关卡简报不参与自动判定。 */
export function secondaryObjectiveStatuses(s: GameState): [boolean, boolean] {
  return [...s.secondaryObjectivesCompleted]
}

export function primaryObjectiveStatus(s: GameState): boolean {
  return s.levelVariables['builtin:primaryObjectiveCompleted'] === true
}

/** 次要目标可即时追踪，但只有整关胜利时才作为最终完成结果进入结算。 */
export function settlementObjectiveStatuses(s: GameState): [boolean, boolean, boolean] {
  const won = s.phase === 'won'
  return [won && primaryObjectiveStatus(s), won && s.secondaryObjectivesCompleted[0], won && s.secondaryObjectivesCompleted[1]]
}

/** v17 统一事件：区域使用任意格集合，触发方式与单位/物体/变量条件分开判定。 */
function updateUnifiedEvents(s: GameState, dt: number): void {
  const center = fortressCenter(s)
  const centerKey = `${Math.floor(center.x)},${Math.floor(center.y)}`
  for (const event of LEVEL.events) {
    const trigger = event.trigger
    let runtime = s.unifiedEventStates.find(item => item.id === event.id)
    if (!runtime) {
      runtime = { id: event.id, inside: false, activations: 0, cooldown: 0, enabled: event.enabled }
      s.unifiedEventStates.push(runtime)
    }
    runtime.cooldown = Math.max(0, runtime.cooldown - dt)
    const previousBlockReason = runtime.lastBlockReason
    const allowed = runtime.enabled && runtimeConditionGroupMatches(s, event.conditions)
    runtime.conditionPassed = allowed
    runtime.lastBlockReason = !runtime.enabled ? '事件已禁用' : !allowed ? '触发条件未满足' : undefined
    const regionCells = trigger.type === 'regionEnter' || trigger.type === 'regionLeave' || trigger.type === 'regionStay' ? trigger.cells : []
    const inside = regionCells.includes(centerKey)
    let fired = false
    if (allowed) {
      if (trigger.type === 'missionStart' || trigger.type === 'automatic') fired = runtime.activations === 0
      else if (trigger.type === 'parallel') fired = runtime.cooldown <= 0
      else if (trigger.type === 'regionEnter') fired = inside && !runtime.inside
      else if (trigger.type === 'regionLeave') fired = !inside && runtime.inside
      else if (trigger.type === 'regionStay') fired = inside && runtime.cooldown <= 0
      else if (trigger.type === 'objectDestroyed') fired = !s.objects.some(object => object.id === trigger.objectId) && !runtime.inside
      else if (trigger.type === 'stageSuccess') fired = s.levelVariables[`builtin:stageSuccess:${trigger.stageId}`] === true && !runtime.inside
      else if (trigger.type === 'stageFailure') fired = s.levelVariables[`builtin:stageFailure:${trigger.stageId}`] === true && !runtime.inside
    }
    const underLimit = event.activationLimit === 0 || runtime.activations < event.activationLimit
    const running = s.eventQueue.some(sequence => sequence.eventRuntimeId === runtime!.id)
    const blockedByReentry = (trigger.type === 'parallel' || trigger.type === 'regionStay') && running
    if (fired && !underLimit) runtime.lastBlockReason = '已达到触发次数上限'
    else if (fired && blockedByReentry) runtime.lastBlockReason = '上一动作序列尚未完成'
    else if (fired && runtime.cooldown > 0) runtime.lastBlockReason = `冷却中 ${runtime.cooldown.toFixed(1)}s`
    if (fired && underLimit && runtime.cooldown <= 0 && !blockedByReentry) {
      runtime.activations++
      runtime.cooldown = event.cooldown
      queueEvent(s, -10_000 - event.id, unifiedEventZone(regionCells), event.actions, { regionCells, eventRuntimeId: runtime.id })
      pushEventDebug(s, { eventId: event.id, eventName: event.name, status: 'triggered', detail: `条件通过 · 第 ${runtime.activations} 次触发` })
    } else if (fired && (!underLimit || blockedByReentry || runtime.cooldown > 0) && runtime.lastBlockReason !== previousBlockReason) {
      pushEventDebug(s, { eventId: event.id, eventName: event.name, status: 'blocked', detail: runtime.lastBlockReason ?? '本次触发被阻止' })
    }
    runtime.inside = trigger.type === 'objectDestroyed'
      ? !s.objects.some(object => object.id === trigger.objectId)
      : trigger.type === 'stageSuccess'
        ? s.levelVariables[`builtin:stageSuccess:${trigger.stageId}`] === true
        : trigger.type === 'stageFailure'
          ? s.levelVariables[`builtin:stageFailure:${trigger.stageId}`] === true
          : inside
  }
}

/** 功能区域统一处理玩家炮塔补给、载具修理；整备权限由 fortressAssemblyAllowed 查询。 */
export function updateFunctionalAreas(s: GameState, dt: number): void {
  const areas = (s.functionalAreas ??= [])
  if (dt <= 0 || areas.length === 0) return
  const centerKey = fortressCenterCellKey(s)
  const controllerBonuses = moduleBonuses(s)
  const sharedBonuses = moduleBonuses(s, 'playerFaction')
  for (const zone of areas) {
    const eventRuntime = s.unifiedEventStates.find(event => event.id === zone.eventId)
    if (eventRuntime && !eventRuntime.enabled) continue
    if (zone.cells.includes(centerKey)) {
      for (const turret of s.turrets) {
        const def = defOf(turret.defId)
        syncPlayerTurretResources(turret, def, controllerBonuses)
        if (zone.ammoEnabled && zone.ammoPerSec > 0) changePlayerTurretAmmo(turret, def, zone.ammoPerSec * dt, controllerBonuses)
        if (zone.energyEnabled && zone.energyPerSec > 0) turret.energy = Math.min(playerTurretResourceCaps(def, controllerBonuses).energyCap, (turret.energy ?? 0) + zone.energyPerSec * dt)
      }
      if (zone.repairEnabled) {
        if (zone.structurePerSec > 0) s.fortress.hp = Math.min(s.fortress.maxHp, s.fortress.hp + zone.structurePerSec * dt)
        if (zone.armorPerSec > 0) for (const side of ['front', 'rear', 'left', 'right'] as const) {
          s.fortress.armor[side] = Math.min(s.fortress.maxArmor[side], s.fortress.armor[side] + zone.armorPerSec * dt)
        }
      }
    }
    // 同一功能区域也服务位于其中的玩家单位；其炮塔资源和主控炮塔使用相同口径。
    for (const ally of s.allies) {
      if (ally.faction !== 'player' || ally.hp <= 0 || !zone.cells.includes(`${Math.floor(ally.x)},${Math.floor(ally.y)}`)) continue
      for (const turret of ally.vehicle?.turrets ?? []) {
        const def = defOf(turret.defId)
        syncPlayerTurretResources(turret, def, sharedBonuses)
        if (zone.ammoEnabled && zone.ammoPerSec > 0) changePlayerTurretAmmo(turret, def, zone.ammoPerSec * dt, sharedBonuses)
        if (zone.energyEnabled && zone.energyPerSec > 0) turret.energy = Math.min(playerTurretResourceCaps(def, sharedBonuses).energyCap, (turret.energy ?? 0) + zone.energyPerSec * dt)
      }
      if (zone.repairEnabled) {
        if (zone.structurePerSec > 0) ally.hp = Math.min(ally.maxHp, ally.hp + zone.structurePerSec * dt)
        if (ally.vehicle && zone.armorPerSec > 0) for (const side of ['front', 'rear', 'left', 'right'] as const) {
          ally.vehicle.armor[side] = Math.min(ally.vehicle.maxArmor[side], ally.vehicle.armor[side] + zone.armorPerSec * dt)
        }
      }
    }
  }
}

const OBJECT_EVENT_RUNTIME_BASE = 1_000_000_000
function objectEventRuntimeId(objectId: number, eventId: number): number {
  return -(OBJECT_EVENT_RUNTIME_BASE + Math.max(0, objectId) * 1_000 + Math.max(0, eventId))
}

/** 新关卡读取实例事件；旧关卡缺少实例字段时以物体类型模板兼容迁移。 */
function objectEvents(object: BattleObject): ObjectTypeEvent[] {
  const placed = LEVEL.objects.find((item, index) => (item.id ?? 2000 + index) === object.id)
  return placed?.events ?? objectTypeById(object.defId)?.events ?? []
}

function objectEventRuntime(s: GameState, object: BattleObject, event: ObjectTypeEvent): UnifiedEventRuntime {
  const id = objectEventRuntimeId(object.id, event.id)
  let runtime = s.unifiedEventStates.find(item => item.id === id)
  if (!runtime) {
    runtime = { id, inside: false, activations: 0, cooldown: 0, enabled: true }
    s.unifiedEventStates.push(runtime)
  }
  return runtime
}

function activateObjectEvent(s: GameState, object: BattleObject, event: ObjectTypeEvent): boolean {
  const runtime = objectEventRuntime(s, object, event)
  const underLimit = event.activationLimit === 0 || runtime.activations < event.activationLimit
  if (!runtime.enabled || runtime.cooldown > 0 || !underLimit || !runtimeConditionGroupMatches(s, event.conditions)) return false
  runtime.activations++
  runtime.cooldown = event.cooldown
  queueEvent(s, runtime.id, { x: object.x, y: object.y, w: object.w, h: object.h }, event.actions, { sourceObjectId: object.id, eventRuntimeId: runtime.id })
  return true
}

const UNIT_EVENT_RUNTIME_BASE = 2_000_000_000
function unitEventRuntimeId(placementId: number, eventId: number): number {
  return -(UNIT_EVENT_RUNTIME_BASE + Math.max(0, placementId) * 1_000 + Math.max(0, eventId))
}

function placedUnitEntity(s: GameState, placementId: number): Ally | Enemy | undefined {
  return s.allies.find(unit => unit.placementId === placementId) ?? s.enemies.find(unit => unit.placementId === placementId)
}

function placedUnitRect(placed: LevelUnitPlacement, entity: Ally | Enemy): LevelZone {
  const def = unitDefById(placed.unitDefId)
  const footprint = def ? unitFootprint(def) : { w: 1, h: 1 }
  return { x: entity.x - footprint.w / 2, y: entity.y - footprint.h / 2, w: footprint.w, h: footprint.h }
}

function unitEventRuntime(s: GameState, placed: LevelUnitPlacement, event: LevelUnitEvent): UnifiedEventRuntime {
  const id = unitEventRuntimeId(placed.id, event.id)
  let runtime = s.unifiedEventStates.find(item => item.id === id)
  if (!runtime) {
    runtime = { id, inside: false, activations: 0, cooldown: 0, enabled: true }
    s.unifiedEventStates.push(runtime)
  }
  return runtime
}

function activateUnitEvent(s: GameState, placed: LevelUnitPlacement, event: LevelUnitEvent, entity: Ally | Enemy): boolean {
  const runtime = unitEventRuntime(s, placed, event)
  const underLimit = event.activationLimit === 0 || runtime.activations < event.activationLimit
  if (!runtime.enabled || runtime.cooldown > 0 || !underLimit || !runtimeConditionGroupMatches(s, event.conditions)) return false
  runtime.activations++
  runtime.cooldown = event.cooldown
  queueEvent(s, runtime.id, placedUnitRect(placed, entity), event.actions, { sourceUnitId: entity.id, eventRuntimeId: runtime.id })
  return true
}

function rectsTouch(a: LevelZone, b: LevelZone): boolean {
  return a.x <= b.x + b.w && a.x + a.w >= b.x && a.y <= b.y + b.h && a.y + a.h >= b.y
}

/** “气泡按钮”交互距离（格）：按玩家载具与目标外轮廓之间的最短距离计算。 */
export const BUBBLE_INTERACTION_RANGE = 3

function rectGapDistance(a: LevelZone, b: LevelZone): number {
  const dx = Math.max(0, a.x - (b.x + b.w), b.x - (a.x + a.w))
  const dy = Math.max(0, a.y - (b.y + b.h), b.y - (a.y + a.h))
  return Math.hypot(dx, dy)
}

function eventCanActivate(s: GameState, runtime: UnifiedEventRuntime | undefined, activationLimit: number, conditions: UnifiedLevelEvent['conditions'] | undefined): boolean {
  if (!runtime) return runtimeConditionGroupMatches(s, conditions)
  return runtime.enabled && runtime.cooldown <= 0 && (activationLimit === 0 || runtime.activations < activationLimit) && runtimeConditionGroupMatches(s, conditions)
}

function objectInteractableNow(s: GameState, object: BattleObject): boolean {
  if (rectGapDistance(fortressRect(s), object) > BUBBLE_INTERACTION_RANGE) return false
  return objectEvents(object).some(event =>
    event.trigger === 'interact'
    && eventCanActivate(s, s.unifiedEventStates.find(item => item.id === objectEventRuntimeId(object.id, event.id)), event.activationLimit, event.conditions))
}

function unitInteractableNow(s: GameState, placed: LevelUnitPlacement, entity: Ally | Enemy): boolean {
  if (entity.hp <= 0 || rectGapDistance(fortressRect(s), placedUnitRect(placed, entity)) > BUBBLE_INTERACTION_RANGE) return false
  return (placed.events ?? []).some(event =>
    event.trigger === 'interact'
    && eventCanActivate(s, s.unifiedEventStates.find(item => item.id === unitEventRuntimeId(placed.id, event.id)), event.activationLimit, event.conditions))
}

export interface InteractionBubble {
  kind: 'object' | 'unit'
  id: number
  /** 气泡尾尖的世界坐标。 */
  x: number
  y: number
}

/** 当前玩家可点击的“气泡按钮”目标；渲染与点击共用同一套距离、次数和冷却判定。 */
export function interactionBubbles(s: GameState): InteractionBubble[] {
  const bubbles: InteractionBubble[] = []
  for (const object of s.objects) {
    if (!objectInteractableNow(s, object)) continue
    bubbles.push({ kind: 'object', id: object.id, x: object.x + object.w / 2, y: object.y })
  }
  for (const placed of LEVEL.initialUnits) {
    const entity = placedUnitEntity(s, placed.id)
    if (!entity || !unitInteractableNow(s, placed, entity)) continue
    const rect = placedUnitRect(placed, entity)
    bubbles.push({ kind: 'unit', id: placed.id, x: entity.x, y: rect.y })
  }
  return bubbles
}

/** 初始单位实例事件：摧毁与接触均以关卡实例 ID 定位，不受阵营差异影响。 */
function updateUnitEvents(s: GameState): void {
  const aliveUnits: { entity: Ally | Enemy; placed: LevelUnitPlacement }[] = []
  for (const placed of LEVEL.initialUnits) {
    const entity = placedUnitEntity(s, placed.id)
    if (entity && entity.hp > 0) aliveUnits.push({ entity, placed })
  }
  const fortress = fortressRect(s)
  for (const placed of LEVEL.initialUnits) {
    const entity = placedUnitEntity(s, placed.id)
    if (!entity) continue
    const ownRect = placedUnitRect(placed, entity)
    for (const event of placed.events ?? []) {
      const runtime = unitEventRuntime(s, placed, event)
      if (event.trigger === 'destroyed') {
        const destroyed = entity.hp <= 0 || s.defeatedUnitPlacementIds.includes(placed.id)
        if (destroyed && !runtime.inside) activateUnitEvent(s, placed, event, entity)
        runtime.inside = destroyed
      } else if (event.trigger === 'contact') {
        const touchesFortress = placed.faction !== 'player' && rectsTouch(ownRect, fortress)
        const touching = touchesFortress || aliveUnits.some(other => other.placed.id !== placed.id && rectsTouch(ownRect, placedUnitRect(other.placed, other.entity)))
        if (touching && !runtime.inside) activateUnitEvent(s, placed, event, entity)
        runtime.inside = touching
      }
    }
  }
}

/** 玩家点选场景中的初始单位时触发其“气泡按钮”事件。 */
export function interactWithUnitAt(s: GameState, x: number, y: number): boolean {
  for (const placed of [...LEVEL.initialUnits].reverse()) {
    const entity = placedUnitEntity(s, placed.id)
    if (!entity || entity.hp <= 0) continue
    const rect = placedUnitRect(placed, entity)
    if (x < rect.x || x >= rect.x + rect.w || y < rect.y || y >= rect.y + rect.h) continue
    if (!unitInteractableNow(s, placed, entity)) return false
    let activated = false
    for (const event of placed.events ?? []) if (event.trigger === 'interact' && activateUnitEvent(s, placed, event, entity)) activated = true
    return activated
  }
  return false
}

/** 物体自身的接触事件：矩形边缘相接也视作接触，因此被碰撞阻挡时仍可触发。 */
function updateObjectEvents(s: GameState, dt: number): void {
  for (const runtime of s.unifiedEventStates) if (runtime.id <= -OBJECT_EVENT_RUNTIME_BASE) runtime.cooldown = Math.max(0, runtime.cooldown - dt)
  const fortress = fortressRect(s)
  for (const object of s.objects) {
    const events = objectEvents(object)
    const touching = fortress.x <= object.x + object.w && fortress.x + fortress.w >= object.x
      && fortress.y <= object.y + object.h && fortress.y + fortress.h >= object.y
    for (const event of events) {
      if (event.trigger !== 'contact') continue
      const runtime = objectEventRuntime(s, object, event)
      if (touching && !runtime.inside) activateObjectEvent(s, object, event)
      runtime.inside = touching
    }
  }
}

/** 玩家点选场景对象时触发该物体定义中的“气泡按钮”事件。 */
export function interactWithObjectAt(s: GameState, x: number, y: number): boolean {
  const object = s.objects.find(item => x >= item.x && x < item.x + item.w && y >= item.y && y < item.y + item.h)
  if (!object || !objectInteractableNow(s, object)) return false
  let activated = false
  for (const event of objectEvents(object)) if (event.trigger === 'interact' && activateObjectEvent(s, object, event)) activated = true
  if (activated) (s.audioSignals ??= []).push({ id: s.nextId++, kind: 'objectInteract', defId: object.defId, x: object.x + object.w / 2, y: object.y + object.h / 2, left: 0.3 })
  return activated
}

/** 区域伏击：只在“区域外→区域内”沿触发；重复触发须先离开并满足冷却。 */
function updateRegionTriggers(s: GameState, dt: number) {
  const c = fortressCenter(s)
  for (const t of LEVEL.triggers) {
    let rt = s.triggerStates.find(v => v.id === t.id)
    if (!rt) {
      rt = { id: t.id, inside: false, activations: 0, cooldown: 0 }
      s.triggerStates.push(rt)
    }
    rt.cooldown = Math.max(0, rt.cooldown - dt)
    const inside = c.x >= t.x && c.x <= t.x + t.w && c.y >= t.y && c.y <= t.y + t.h
    if (t.enabled && inside && !rt.inside && rt.cooldown <= 0 && rt.activations < t.activationLimit) {
      rt.activations++
      rt.cooldown = t.cooldown
      if (t.actions?.length) queueEvent(s, t.id, t, t.actions)
      else {
        let order = 0
        for (const [unitDefId, count] of Object.entries(levelSpawnUnitCounts(t))) for (let i = 0; i < count; i++) {
          const unit = unitDefById(unitDefId)
          if (!unit) continue
          const p = zoneSpawnPoint(t, t.id * 1000003 + rt.activations * 1009 + order)
          s.ambushQueue.push({ triggerId: t.id, kind: enemyKindForUnit(unit), unitDefId, left: t.delay + order * t.interval, x: p.x, y: p.y })
          order++
        }
      }
    }
    rt.inside = inside
  }
}

function wallStateOf(w: WallSeg): WallState {
  if (w.hp <= 0) return 'destroyed'
  return w.hp < w.maxHp ? 'damaged' : 'intact'
}

function distToFortress(s: GameState, e: { x: number; y: number }): number {
  const fc = fortressCenter(s)
  return Math.hypot(e.x - fc.x, e.y - fc.y)
}

// ================= 伤害与效果结算 =================

function addFloat(s: GameState, x: number, y: number, text: string, visualKind?: FloatText['visualKind']) {
  s.floats.push({ id: s.nextId++, x, y, text, ttl: 0.8, visualKind })
}

function armorSideName(side: FortressArmorSide): string {
  return side === 'front' ? '前' : side === 'rear' ? '后' : side === 'left' ? '左' : '右'
}

/** 装甲命中飘字的唯一口径：跳弹、击穿和格挡互斥，避免同一发叠出多条提示。 */
function addArmorHitFloat(
  s: GameState, x: number, y: number, side: FortressArmorSide,
  armorBefore: number, structureDamage: number, ricochet: boolean,
): void {
  if (ricochet) {
    addFloat(s, x, y, '跳弹', 'ricochet')
    return
  }
  if (structureDamage > 0) {
    addFloat(s, x, y, armorBefore > 0 ? '击穿' : `-${Math.round(structureDamage)}`, armorBefore > 0 ? 'penetration' : undefined)
    return
  }
  addFloat(s, x, y, `${armorSideName(side)}装甲格挡`)
}

function addImpact(s: GameState, x: number, y: number, ammoId: string | undefined, hx?: number, hy?: number, altitude = 0): void {
  const configuredDuration = ammoId ? PROJECTILE_ARTS.find(item => item.id === ammoId)?.impact?.duration : undefined
  const duration = Math.min(5, Math.max(0.01, configuredDuration ?? 0.15))
  s.impacts.push({ id: s.nextId++, x, y, altitude, ttl: duration, max: duration, ammoId, hx, hy })
}

export type FortressArmorSide = keyof FortressArmor
export interface FortressDamageSource {
  x: number
  y: number
  kind: 'melee' | 'projectile' | 'aoe'
  armorPen?: number
  armorDamage?: number
  penetration?: number // 概率穿深值：小于当前装甲时以 penetration/armor 判定；失败则跳弹且不伤结构
  ammoId?: string // 弹丸美术条目；主体弹孔按其贴图显示尺寸计算
  projectileSize?: number // 无贴图弹丸显示直径（格）；主体弹孔直径 = 该值 × 0.5
  incomingDx?: number // 弹丸进入命中点时的世界方向；跳弹反射必须使用真实入射方向
  incomingDy?: number
  duration?: number // 持续伤害按秒给攻击强度，duration=本 tick 秒数
  visualKind?: 'ramming' // 调试显示分类；不参与伤害结算
}
export interface FortressDamageResult {
  side: FortressArmorSide
  blocked: boolean
  shieldDamage: number
  shieldBroken: boolean
  structureDamage: number
  armorDamage: number
  ricochet: boolean
}

export const FORTRESS_DAMAGE_MARK_CAP = 60
/** 载具结构阶段视觉已启用：低于 50% 整车变暗，低于 25% 追加尺寸分级深色烟。 */
export const UNIT_BODY_DAMAGE_VISUALS_ENABLED = true
/** 弹孔、焦痕、擦痕及裂纹仍保持关闭，等待主体贴花视觉重新设计。 */
export const UNIT_BODY_DECALS_ENABLED = false

type UnitHitVisualSource = {
  incomingDx?: number
  incomingDy?: number
  ammoId?: string
  projectileSize?: number
  visualKind?: 'ramming'
}

/** 所有阵营单位唯一的受击视觉事件入口；反射、口径与命中面法线均在这里收口。 */
function addUnitHitFx(
  s: GameState, x: number, y: number, normalX: number, normalY: number,
  source: UnitHitVisualSource, penetrated: boolean, ricochet: boolean,
  fallbackIncomingX: number, fallbackIncomingY: number, altitude = 0,
): void {
  const normalLength = Math.max(1e-6, Math.hypot(normalX, normalY))
  const nx = normalX / normalLength, ny = normalY / normalLength
  const suppliedIncomingLength = Math.hypot(source.incomingDx ?? 0, source.incomingDy ?? 0)
  const incomingX0 = suppliedIncomingLength > 1e-6 ? (source.incomingDx ?? 0) : fallbackIncomingX
  const incomingY0 = suppliedIncomingLength > 1e-6 ? (source.incomingDy ?? 0) : fallbackIncomingY
  const incomingLength = Math.max(1e-6, Math.hypot(incomingX0, incomingY0))
  const incomingX = incomingX0 / incomingLength, incomingY = incomingY0 / incomingLength
  const dot = incomingX * nx + incomingY * ny
  let reflectedX = incomingX - 2 * dot * nx
  let reflectedY = incomingY - 2 * dot * ny
  const reflectedLength = Math.max(1e-6, Math.hypot(reflectedX, reflectedY))
  reflectedX /= reflectedLength; reflectedY /= reflectedLength
  s.unitHits.push({
    id: s.nextId++, x, y, altitude,
    ttl: ricochet ? 0.16 : 0.18, max: ricochet ? 0.16 : 0.18,
    penetrated, ricochet, normalDx: nx, normalDy: ny,
    ricochetDx: reflectedX, ricochetDy: reflectedY,
    ammoId: source.ammoId, projectileSize: source.projectileSize,
    visualKind: source.visualKind,
  })
}

/** 英雄连式穿深概率：穿深达到装甲即必穿，否则按比例，最低保留 5% 幸运穿透。 */
export function fortressPenetrationChance(penetration: number, armor: number): number {
  if (armor <= 0) return 1
  return Math.max(0.05, Math.min(1, Math.max(0, penetration) / armor))
}

type ArmorHitSource = Pick<EnemyDamageSource, 'penetration' | 'armorPen' | 'armorDamage'>

/** 所有阵营载具唯一的装甲结算公式；护盾等单位专属外层在调用前处理。 */
function resolveArmorHit(armorValue: number, rawDamage: number, source: ArmorHitSource, randomValue: number): {
  structureDamage: number; armorDamage: number; ricochet: boolean
} {
  const armor = Math.max(0, armorValue)
  const raw = Math.max(0, rawDamage)
  if (armor <= 0) return { structureDamage: raw, armorDamage: 0, ricochet: false }
  if (source.penetration !== undefined) {
    const ricochet = randomValue >= fortressPenetrationChance(source.penetration, armor)
    return ricochet
      ? { structureDamage: 0, armorDamage: 0, ricochet: true }
      : {
          structureDamage: raw,
          armorDamage: Math.min(armor, Math.max(0, source.armorDamage ?? raw * (source.armorPen ?? 0))),
          ricochet: false,
        }
  }
  const pen = Math.max(0, Math.min(1, source.armorPen ?? 0))
  if (pen > 0) return {
    structureDamage: raw * pen + Math.max(0, raw * (1 - pen) - armor),
    armorDamage: Math.min(armor, Math.max(0, source.armorDamage ?? raw * pen)),
    ricochet: false,
  }
  return { structureDamage: raw >= armor ? raw - armor : 0, armorDamage: 0, ricochet: false }
}

/** 世界命中点 → 载具局部格；越出车体的攻击源投影到载具边缘，保证贴花落在车上。 */
export function fortressDamageLocalPoint(s: GameState, x: number, y: number): { x: number; y: number } {
  const r = fortressRect(s)
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2
  const dx = x - cx, dy = y - cy
  const c = Math.cos(s.fortress.heading), sn = Math.sin(s.fortress.heading)
  const lx = dx * c + dy * sn + r.w / 2
  const ly = -dx * sn + dy * c + r.h / 2
  const inset = Math.min(0.08, r.w / 4, r.h / 4)
  return {
    x: Math.max(inset, Math.min(r.w - inset, lx)),
    y: Math.max(inset, Math.min(r.h - inset, ly)),
  }
}

function recordFortressBodyHit(s: GameState, source: FortressDamageSource, penetrated: boolean, ricochet = false): void {
  const continuous = source.duration !== undefined && source.duration < 0.25
  const local = fortressDamageLocalPoint(s, source.x, source.y)
  if (!continuous || s.time - s.fortress.damageMarkLastAt >= 0.14) {
    const id = s.nextId++
    const kind: FortressDamageMarkKind = penetrated
      ? source.kind === 'aoe' ? 'scorch' : source.kind === 'projectile' ? 'bullet' : 'scratch'
      : 'scratch'
    if (UNIT_BODY_DECALS_ENABLED) {
      // mark.size 是绘制半径：弹孔直径 = 弹丸显示直径 ×0.5，因此半径 = 弹丸直径 ×0.25。
      const baseSize = kind === 'scorch' ? 0.46 : kind === 'scratch' ? 0.32 : (source.projectileSize ?? GEOMETRIC_BULLET_VISUAL_SIZE) * 0.25
      s.fortress.damageMarks.push({
        id, kind, x: local.x, y: local.y,
        size: kind === 'bullet' ? baseSize : baseSize * (0.85 + eventRandom(id, 74) * 0.3),
        angle: (id * 137.50776405003785) % 360,
        ammoId: kind === 'bullet' ? source.ammoId : undefined,
        projectileSize: kind === 'bullet' ? source.projectileSize : undefined,
      })
      if (s.fortress.damageMarks.length > FORTRESS_DAMAGE_MARK_CAP) {
        s.fortress.damageMarks.splice(0, s.fortress.damageMarks.length - FORTRESS_DAMAGE_MARK_CAP)
      }
      s.fortress.damageMarkLastAt = s.time
    }
  }
  if (!continuous || s.time - s.fortress.damageFxLastAt >= 0.08) {
    const r = fortressRect(s)
    const dx = local.x - r.w / 2, dy = local.y - r.h / 2
    const c = Math.cos(s.fortress.heading), sn = Math.sin(s.fortress.heading)
    const wx = r.x + r.w / 2 + dx * c - dy * sn
    const wy = r.y + r.h / 2 + dx * sn + dy * c
    const hitSide = fortressArmorSideAt(s, wx, wy)
    const normal = armorSideWorldNormal(s.fortress.heading, hitSide)
    addUnitHitFx(s, wx, wy, normal.x, normal.y, source, penetrated, ricochet, wx - source.x, wy - source.y)
    s.fortress.damageFxLastAt = s.time
  }
}

/** 世界命中点映射到堡垒四向受击面；角部按矩形归一化对角线裁决。 */
export function fortressArmorSideAt(s: GameState, x: number, y: number): FortressArmorSide {
  const r = fortressRect(s)
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2
  const dx = x - cx, dy = y - cy
  const c = Math.cos(s.fortress.heading), sn = Math.sin(s.fortress.heading)
  const lx = dx * c + dy * sn
  const ly = -dx * sn + dy * c
  const nx = lx / Math.max(0.01, r.w / 2)
  const ny = ly / Math.max(0.01, r.h / 2)
  if (Math.abs(nx) > Math.abs(ny)) return nx < 0 ? 'left' : 'right'
  return ny < 0 ? 'front' : 'rear'
}

/** 将装甲反馈浮字放到对应受击面的外侧，避免覆盖主体贴图。 */
function armorSideOutsidePoint(
  cx: number, cy: number, heading: number, width: number, height: number, side: FortressArmorSide, margin = 0.65,
): { x: number; y: number } {
  const lx = side === 'left' ? -(width / 2 + margin) : side === 'right' ? width / 2 + margin : 0
  const ly = side === 'front' ? -(height / 2 + margin) : side === 'rear' ? height / 2 + margin : 0
  const c = Math.cos(heading), sn = Math.sin(heading)
  return { x: cx + lx * c - ly * sn, y: cy + lx * sn + ly * c }
}

/** 四向装甲面的世界空间外法线；用于按真实装甲平面计算镜面反射。 */
function armorSideWorldNormal(heading: number, side: FortressArmorSide): { x: number; y: number } {
  const c = Math.cos(heading), sn = Math.sin(heading)
  if (side === 'left') return { x: -c, y: -sn }
  if (side === 'right') return { x: c, y: sn }
  if (side === 'front') return { x: sn, y: -c }
  return { x: -sn, y: c }
}

/** 堡垒唯一承伤入口：受击面装甲阈值 → 穿甲直伤/削甲 → 结构值。 */
export function damageFortress(s: GameState, rawDamage: number, source: FortressDamageSource): FortressDamageResult {
  const side = fortressArmorSideAt(s, source.x, source.y)
  const duration = Math.max(0, source.duration ?? 1)
  const raw = Math.max(0, rawDamage)
  const actualRaw = raw * duration
  let shieldDamage = 0
  let shieldBroken = false
  if (actualRaw > 0) s.fortress.shieldLastHitAt = s.time
  let remainingActual = actualRaw
  // 命中发生时只要护盾仍有值，本次攻击就先与护盾碰撞：不触发跳弹，也不继承穿深、穿甲比例或削甲。
  // 即使同一发击破护盾，溢出部分也只按普通装甲阈值结算；后续破盾状态下的攻击才恢复穿甲规则。
  const shieldWasActive = remainingActual > 0 && s.fortress.maxShield > 0 && s.fortress.shield > 0
  if (shieldWasActive) {
    shieldDamage = Math.min(s.fortress.shield, remainingActual)
    s.fortress.shield = Math.max(0, s.fortress.shield - shieldDamage)
    remainingActual -= shieldDamage
    shieldBroken = s.fortress.shield <= 0
    if (shieldBroken) s.fortress.shieldBroken = true
    s.shieldHits.push({ id: s.nextId++, x: source.x, y: source.y, ttl: shieldBroken ? 0.8 : 0.45, max: shieldBroken ? 0.8 : 0.45, broken: shieldBroken })
  }
  if (remainingActual <= 0 || duration <= 0) return { side, blocked: true, shieldDamage, shieldBroken, structureDamage: 0, armorDamage: 0, ricochet: false }
  const remainingRaw = remainingActual / duration
  const armor = Math.max(0, s.fortress.armor?.[side] ?? 0)
  const armorSource: ArmorHitSource = shieldWasActive ? {} : source
  const resolved = resolveArmorHit(armor, remainingRaw, armorSource, eventRandom(s.nextId, 91))
  const structureDamage = resolved.structureDamage * duration
  const armorDamage = Math.min(armor, resolved.armorDamage * duration)
  const ricochet = resolved.ricochet
  if (armorDamage > 0) s.fortress.armor[side] = Math.max(0, armor - armorDamage)
  s.fortress.hp = Math.max(0, s.fortress.hp - structureDamage)
  recordFortressBodyHit(s, source, structureDamage > 0, ricochet)
  if (source.kind === 'projectile' && !shieldWasActive) {
    const body = fortressRect(s)
    const point = armorSideOutsidePoint(body.x + body.w / 2, body.y + body.h / 2, s.fortress.heading, body.w, body.h, side)
    addArmorHitFloat(s, point.x, point.y, side, armor, structureDamage, ricochet)
  }
  return { side, blocked: structureDamage <= 0, shieldDamage, shieldBroken, structureDamage, armorDamage, ricochet }
}

export interface EnemyDamageSource {
  x: number
  y: number
  /** 造成伤害的战斗实体；用于受击反击和编组共享，不参与伤害数值结算。 */
  attackerSide?: 'fortress' | 'ally' | 'enemy'
  attackerId?: number
  penetration?: number
  armorPen?: number
  armorDamage?: number
  ammoId?: string
  projectileSize?: number // 无贴图时的弹丸显示直径；跳弹宽度/距离按该口径缩放
  incomingDx?: number
  incomingDy?: number
  visualKind?: 'ramming' // 调试显示分类；不参与伤害结算
}

type UnitAttackerRef = Pick<EnemyDamageSource, 'attackerSide' | 'attackerId'>

function sourceAttacker(source: EnemyDamageSource | undefined, fallback?: { side: 'fortress' | 'ally' | 'enemy'; id: number }) {
  if (source?.attackerSide !== undefined && source.attackerId !== undefined) {
    return { side: source.attackerSide, id: source.attackerId }
  }
  return fallback
}

function mountedTurretAttacker(s: GameState, turretId: number, side: 'ally' | 'enemy'): UnitAttackerRef {
  const units = side === 'enemy' ? s.enemies : s.allies
  const owner = units.find(unit => unit.vehicle?.turrets?.some(turret => turret.id === turretId))
  return owner ? { attackerSide: side, attackerId: owner.id } : {}
}

function unitArmorSideAt(e: { x: number; y: number; vehicle?: UnitVehicleRuntime }, unit: UnitDef, sourceX: number, sourceY: number): FortressArmorSide {
  const heading = e.vehicle?.heading ?? 0
  const dx = sourceX - e.x, dy = sourceY - e.y
  const c = Math.cos(heading), sn = Math.sin(heading)
  const lx = dx * c + dy * sn, ly = -dx * sn + dy * c
  const visual = unit.visual ?? { width: unit.stats.size * 2, height: unit.stats.size * 2 }
  const nx = lx / Math.max(0.01, visual.width / 2), ny = ly / Math.max(0.01, visual.height / 2)
  if (Math.abs(nx) > Math.abs(ny)) return nx < 0 ? 'left' : 'right'
  return ny < 0 ? 'front' : 'rear'
}

export function enemyVehicleArmorSideAt(e: Enemy, sourceX: number, sourceY: number): FortressArmorSide {
  return unitArmorSideAt(e, runtimeEnemyUnitDef(e.unitDefId, e.kind), sourceX, sourceY)
}

/** 所有单位共用同一组世界受击事件，统一火花与跳弹飞行表现；单位本体不发光、不泛白。 */
type DamageableUnitHost = { id: number; x: number; y: number; hp: number; hitFlash: number; hitFxLastAt?: number; bossSizeScale?: number; vehicle?: UnitVehicleRuntime; aircraft?: UnitAircraftRuntime }

function recordUnitHitFx(s: GameState, e: DamageableUnitHost, unit: UnitDef, source: EnemyDamageSource, penetrated: boolean, ricochet: boolean, side?: FortressArmorSide): void {
  if (s.time - (e.hitFxLastAt ?? -1e9) < 0.08) return
  // 受击火花和弹丸命中模板共用主体表面点。新载具按素材透明边缘生成的凸轮廓投影，
  // 历史定义才回退矩形/椭圆；向内缩约 1px，避免侧击特效中心落在贴图外。
  const hit = unitBodySurfacePoint(e, unit, source.x, source.y, source.incomingDx, source.incomingDy, 1 / BASE_CELL)
  const hitX = hit.x, hitY = hit.y
  const heading = e.vehicle?.heading ?? 0
  const c = Math.cos(heading), sn = Math.sin(heading)
  const localHitX = (hitX - e.x) * c + (hitY - e.y) * sn
  const localHitY = -(hitX - e.x) * sn + (hitY - e.y) * c
  const visual = unit.visual ?? { width: unit.stats.size * 2, height: unit.stats.size * 2 }
  const scale = e.bossSizeScale ?? 1
  const bodyRadiusX = Math.max(0.01, visual.width * scale / 2)
  const bodyRadiusY = Math.max(0.01, visual.height * scale / 2)
  const normal = e.vehicle && side
    ? armorSideWorldNormal(e.vehicle.heading, side)
    : (() => {
        let localNormalX: number, localNormalY: number
        if (Math.abs(localHitX) / bodyRadiusX >= Math.abs(localHitY) / bodyRadiusY) {
          localNormalX = Math.sign(localHitX) || 1; localNormalY = 0
        } else {
          localNormalX = 0; localNormalY = Math.sign(localHitY) || 1
        }
        const worldNormalX = localNormalX * c - localNormalY * sn
        const worldNormalY = localNormalX * sn + localNormalY * c
        const length = Math.max(1e-6, Math.hypot(worldNormalX, worldNormalY))
        return { x: worldNormalX / length, y: worldNormalY / length }
      })()
  addUnitHitFx(s, hitX, hitY, normal.x, normal.y, source, penetrated, ricochet, e.x - source.x, e.y - source.y, currentUnitAltitude(e, unit))
  e.hitFxLastAt = s.time
}

type CombatDamageHost = DamageableUnitHost & { vehicle?: UnitVehicleRuntime }

/** 敌军与友军普通单位唯一的承伤入口；阵营只影响目标选择，不影响伤害公式和受击表现。 */
function damageCombatUnit(s: GameState, host: CombatDamageHost, unit: UnitDef, raw: number, source?: EnemyDamageSource): number {
  let structureDamage = Math.max(0, raw)
  if (host.vehicle && source) {
    const side = unitArmorSideAt(host, unit, source.x, source.y)
    const armor = Math.max(0, host.vehicle.armor[side] ?? 0)
    const resolved = resolveArmorHit(armor, raw, source, eventRandom(s.nextId, 131))
    structureDamage = resolved.structureDamage
    host.vehicle.armor[side] = Math.max(0, armor - resolved.armorDamage)
    recordUnitHitFx(s, host, unit, source, structureDamage > 0, resolved.ricochet, side)
    const visual = unit.visual ?? { width: unit.stats.size * 2, height: unit.stats.size * 2 }
    const point = armorSideOutsidePoint(host.x, host.y, host.vehicle.heading, visual.width, visual.height, side)
    if (source.visualKind === 'ramming') {
      addFloat(s, point.x, point.y, structureDamage <= 0 ? `${armorSideName(side)}装甲格挡` : `-${Math.round(structureDamage)}`, 'ramming')
    } else addArmorHitFloat(s, point.x, point.y, side, armor, structureDamage, resolved.ricochet)
  } else if (source) {
    recordUnitHitFx(s, host, unit, source, structureDamage > 0, false)
  }
  host.hp -= structureDamage
  return structureDamage
}

export function damageEnemy(s: GameState, e: Enemy, raw: number, srcTurretId: number | null, source?: EnemyDamageSource) {
  if (raw > 0) engagePlacementGroup(s, e, sourceAttacker(source, srcTurretId != null ? { side: 'fortress', id: 0 } : undefined))
  damageCombatUnit(s, e, runtimeEnemyUnitDef(e.unitDefId, e.kind), raw, source)
  if (srcTurretId != null) {
    e.attackedBy = e.attackedBy.filter(a => a.turretId !== srcTurretId)
    e.attackedBy.push({ turretId: srcTurretId, time: s.time })
  }
}

/** 阵营无关的普通单位承伤入口；友军、玩家方普通单位与敌军使用相同载具装甲和跳弹规则。 */
export function damageAlly(s: GameState, a: Ally, raw: number, source?: EnemyDamageSource): void {
  if (raw > 0) engagePlacementGroup(s, a, sourceAttacker(source))
  const shieldActive = raw > 0 && a.faction === 'player' && (a.vehicle?.maxShield ?? 0) > 0 && (a.vehicle?.shield ?? 0) > 0
  if (!shieldActive) { damageCombatUnit(s, a, runtimeAllyUnitDef(a.unitDefId, a.kind), raw, source); return }
  const vehicle = a.vehicle!
  vehicle.shieldLastHitAt = s.time
  const absorbed = Math.min(vehicle.shield ?? 0, raw)
  vehicle.shield = Math.max(0, (vehicle.shield ?? 0) - absorbed)
  const broken = (vehicle.shield ?? 0) <= 0
  if (broken) vehicle.shieldBroken = true
  s.shieldHits.push({ id: s.nextId++, x: source?.x ?? a.x, y: source?.y ?? a.y, ttl: broken ? 0.8 : 0.45, max: broken ? 0.8 : 0.45, broken, unitId: a.id })
  const remaining = raw - absorbed
  if (remaining > 0) damageCombatUnit(s, a, runtimeAllyUnitDef(a.unitDefId, a.kind), remaining, source ? { ...source, penetration: undefined, armorPen: undefined, armorDamage: undefined } : undefined)
}

function applyBurn(e: Enemy, burn: { damage: number; interval: number; duration: number }) {
  e.dots.push({ damage: burn.damage, interval: burn.interval, timer: burn.interval, left: burn.duration })
}

function applyBurnAlly(a: Ally, burn: { damage: number; interval: number; duration: number }) {
  ;(a.dots ??= []).push({ damage: burn.damage, interval: burn.interval, timer: burn.interval, left: burn.duration })
}

export const EXPLOSION_COVER_REDUCTION = [0, 0.3, 0.6, 0.8] as const

/** 爆炸遮蔽取路径上最高的挡弹道物体，不叠加：高度0/1/2/3分别减伤0%/30%/60%/80%。 */
function explosionCoverMultiplier(s: GameState, x1: number, y1: number, x2: number, y2: number): number {
  const d = Math.hypot(x2 - x1, y2 - y1)
  if (d < 1e-6) return 1
  let highest: 0 | 1 | 2 | 3 = 0
  for (let l = 0.5; l < d; l += 0.2) {
    const px = x1 + (x2 - x1) / d * l
    const py = y1 + (y2 - y1) / d * l
    for (const object of s.objects) {
      if (!object.blockProjectile || px < object.x || px >= object.x + object.w || py < object.y || py >= object.y + object.h) continue
      highest = Math.max(highest, heightLevel(object.height)) as 0 | 1 | 2 | 3
    }
  }
  return 1 - EXPLOSION_COVER_REDUCTION[highest]
}

function applyExplosionDamage(
  s: GameState, sourceSide: 'ally' | 'enemy', x: number, y: number, radius: number, damage: number,
  effect?: { burn?: { damage: number; interval: number; duration: number } }, armor?: Pick<EnemyDamageSource, 'armorPen' | 'armorDamage' | 'penetration'>,
  sourceFaction: LevelPlacedUnitFaction = sourceSide === 'ally' ? 'player' : 'enemy',
  attacker?: UnitAttackerRef,
): void {
  const hitSource: EnemyDamageSource = { x, y, ...armor, ...attacker }
  for (const enemy of s.enemies) {
      if (enemy.hp <= 0 || !factionsHostile(sourceFaction, enemy.faction ?? 'enemy')) continue
      const unit = runtimeEnemyUnitDef(enemy.unitDefId, enemy.kind)
      if (Math.hypot(enemy.x - x, enemy.y - y) > radius + unitRadiusToward(unit, enemy.x - x, enemy.y - y)) continue
      const multiplier = explosionCoverMultiplier(s, x, y, enemy.x, enemy.y)
      damageEnemy(s, enemy, damage * multiplier, null, hitSource)
      if (effect?.burn) applyBurn(enemy, { ...effect.burn, damage: effect.burn.damage * multiplier })
  }
  if (factionsHostile(sourceFaction, 'player')) {
    const center = fortressCenter(s)
    if (fortressDistanceToPoint(s, x, y) <= radius) {
      damageFortress(s, damage * explosionCoverMultiplier(s, x, y, center.x, center.y), { ...hitSource, kind: 'aoe' })
    }
    for (const ally of s.allies) {
      if (ally.hp <= 0 || !factionsHostile(sourceFaction, ally.faction ?? 'ally')) continue
      const unit = runtimeAllyUnitDef(ally.unitDefId, ally.kind)
      if (Math.hypot(ally.x - x, ally.y - y) > radius + unitRadiusToward(unit, ally.x - x, ally.y - y)) continue
      const multiplier = explosionCoverMultiplier(s, x, y, ally.x, ally.y)
      damageAlly(s, ally, damage * multiplier, hitSource)
      if (effect?.burn) applyBurnAlly(ally, { ...effect.burn, damage: effect.burn.damage * multiplier })
    }
    if (s.core && s.core.hp > 0 && pointRectDistance(x, y, s.core.x, s.core.y, s.core.w, s.core.h) <= radius) damageCore(s, damage * explosionCoverMultiplier(s, x, y, s.core.x + s.core.w / 2, s.core.y + s.core.h / 2))
    for (const building of [...s.buildings]) if (pointRectDistance(x, y, building.x, building.y, building.w, building.h) <= radius) damageBuilding(s, building, damage * explosionCoverMultiplier(s, x, y, building.x + building.w / 2, building.y + building.h / 2))
    for (const wall of [...s.walls]) if (wall.state !== 'destroyed') {
      const hitCell = wall.cells.find(cell => Math.hypot(cell.x + 0.5 - x, cell.y + 0.5 - y) <= radius)
      if (hitCell) damageWall(s, wall, damage * explosionCoverMultiplier(s, x, y, hitCell.x + 0.5, hitCell.y + 0.5))
    }
  }
  for (const object of [...s.objects]) {
    // 物体本身可能就是爆心命中的遮挡物，不能用它遮挡自己。
    if (pointRectDistance(x, y, object.x, object.y, object.w, object.h) <= radius) damageObject(s, object, damage)
  }
}

/** 爆炸：范围内敌人受伤 + 爆炸效果；波及油桶（物体不分敌我）；不伤己方墙段（防误伤） */
function explode(s: GameState, x: number, y: number, radiusM: number, damage: number,
  effect: { damage: number; burn?: { damage: number; interval: number; duration: number } } | undefined,
  srcTurretId: number | null, lvl: number, ammoId?: string, hx?: number, hy?: number, hspeed?: number) {
  const rC = m2c(radiusM)
  s.explosions.push({ id: s.nextId++, x, y, r: rC, ttl: 0.35, ammoId, hx, hy, hspeed })
  // “爆炸”和“命中”是弹丸库中两套可独立配置的表现；爆心同时也是本发弹丸的实际命中点。
  // 未配置 impact 的条目虽然会留下短寿命事件，但渲染层会按既有规则直接忽略。
  addImpact(s, x, y, ammoId, hx, hy)
  const scale = levelScale(lvl)
  applyExplosionDamage(s, 'ally', x, y, rC, (damage + (effect?.damage ?? 0)) * scale, effect, undefined, 'player',
    srcTurretId != null ? { attackerSide: 'fortress', attackerId: 0 } : undefined)
}

function damageObject(s: GameState, o: BattleObject, dmg: number) {
  if (o.hp < 0) return // hp=-1：不可破坏，永不扣耐久
  o.hp -= dmg
  if (o.hp > 0) return
  // 破坏流程（§8.2）：移除、恢复通行、触发 on_destroy；挡路物体摧毁触发重寻路
  s.objects = s.objects.filter(x => x.id !== o.id)
  ;(s.audioSignals ??= []).push({ id: s.nextId++, kind: 'objectDestroy', defId: o.defId, x: o.x + o.w / 2, y: o.y + o.h / 2, left: 0.4 })
  for (const event of objectEvents(o)) if (event.trigger === 'destroyed') activateObjectEvent(s, o, event)
  if (o.blockMove) s.pathVersion++
}

function damageWall(s: GameState, w: WallSeg, dmg: number) {
  if (w.state === 'destroyed') return
  w.hp -= dmg
  const st = wallStateOf(w)
  if (st === 'destroyed') {
    // §4.2：移除阻挡 + 登记入口（cells 可通行）+ 触发全场重寻路
    w.hp = 0
    w.state = 'destroyed'
    s.pathVersion++
  } else {
    w.state = st
  }
}

function damageTurret(s: GameState, t: Turret, dmg: number) {
  t.hp -= dmg
  if (t.hp > 0) return
  // §6.9：移除、格位释放；填写了毁坏效果的在毁坏位置触发
  const def = defOf(t.defId)
  const c = turretCenter(t)
  s.turrets = s.turrets.filter(x => x.id !== t.id)
  s.pathVersion++
  if (def.onDestroyBlast) {
    explode(s, c.x, c.y, def.onDestroyBlast.radius, def.onDestroyBlast.damage, def.onDestroyBlast, null, t.level)
  }
  addFloat(s, c.x, c.y, '炮塔损毁')
}

function damageBuilding(s: GameState, b: FixedBuilding, dmg: number) {
  b.hp -= dmg
  if (b.hp > 0) return
  // §5.3：固有建筑被毁，同一帧释放占格
  s.buildings = s.buildings.filter(x => x.id !== b.id)
  s.pathVersion++
  addFloat(s, b.x + b.w / 2, b.y, '建筑被毁')
}

function damageCore(s: GameState, dmg: number) {
  const core = s.core
  if (!core || core.hp <= 0) return
  core.hp = Math.max(0, core.hp - dmg)
  if (core.hp > 0) return
  s.pathVersion++
  addFloat(s, core.x + core.w / 2, core.y, '核心被毁')
  s.notices.push({ id: s.nextId++, text: '核心建筑已被摧毁', left: 4 })
}

/** 对目标实体结算敌人攻击，返回目标是否仍有效 */
function enemyDealDamage(s: GameState, e: Enemy, dmg: number, duration = 1, contactRequired = true): boolean {
  // 近战/持续接触攻击同样属于主动攻击：攻击者所在编组立即共同进入接战。
  engagePlacementGroup(s, e)
  dmg *= enemyAttackDamageMultiplier(e)
  switch (e.targetKind) {
    case 'wall': {
      const w = s.walls.find(w => w.id === e.targetId)
      if (!w || w.state === 'destroyed') return false
      damageWall(s, w, dmg)
      return (w.state as WallState) !== 'destroyed'
    }
    case 'turret': {
      const t = s.turrets.find(t => t.id === e.targetId)
      if (!t) return false
      damageTurret(s, t, dmg)
      return s.turrets.some(x => x.id === e.targetId)
    }
    case 'fixedBuilding': {
      const b = s.buildings.find(b => b.id === e.targetId)
      if (!b) return false
      damageBuilding(s, b, dmg)
      return s.buildings.some(x => x.id === e.targetId)
    }
    case 'coreBuilding': {
      const core = s.core
      if (!core || core.id !== e.targetId || core.hp <= 0) return false
      damageCore(s, dmg)
      return core.hp > 0
    }
    case 'object': {
      const o = s.objects.find(o => o.id === e.targetId)
      if (!o || o.hp < 0) return false // 不可破坏物体不是有效攻击目标
      damageObject(s, o, dmg)
      return s.objects.some(x => x.id === e.targetId)
    }
    case 'fortress': {
      // 攻击船体：堡垒已移动脱离接触 => 目标失效，重新追击
      const r = fortressRect(s)
      if (contactRequired && (e.x < r.x - 0.7 || e.x > r.x + r.w + 0.7 || e.y < r.y - 0.7 || e.y > r.y + r.h + 0.7)) return false
      const combat = resolvedUnitCombat(runtimeEnemyUnitDef(e.unitDefId, e.kind))
      damageFortress(s, dmg, {
        x: e.x, y: e.y, kind: contactRequired ? 'melee' : 'projectile', duration,
        penetration: contactRequired ? undefined : combat.penetration,
        ammoId: contactRequired ? undefined : combat.projectileId,
      })
      return s.fortress.hp > 0
    }
    case 'combatUnit': {
      const combat = resolvedUnitCombat(runtimeEnemyUnitDef(e.unitDefId, e.kind))
      const rangedSource = contactRequired ? {} : {
        penetration: combat.penetration,
        ammoId: combat.projectileId,
      }
      if (e.combatTargetSide === 'enemy') {
        const target = s.enemies.find(x => x.id === e.targetId && x !== e)
        if (!target || target.hp <= 0) return false
        const footprint = unitFootprint(runtimeEnemyUnitDef(target.unitDefId, target.kind))
        if (contactRequired && pointRectDistance(e.x, e.y, target.x - footprint.w / 2, target.y - footprint.h / 2, footprint.w, footprint.h) > 1.0) return false
        damageEnemy(s, target, dmg, null, {
          x: e.x, y: e.y, attackerSide: 'enemy', attackerId: e.id, ...rangedSource,
          incomingDx: target.x - e.x, incomingDy: target.y - e.y,
        })
        return target.hp > 0
      }
      const target = s.allies.find(x => x.id === e.targetId)
      if (!target || target.hp <= 0) return false
      const footprint = unitFootprint(runtimeAllyUnitDef(target.unitDefId, target.kind))
      if (contactRequired && pointRectDistance(e.x, e.y, target.x - footprint.w / 2, target.y - footprint.h / 2, footprint.w, footprint.h) > 1.0) return false
      damageAlly(s, target, dmg, {
        x: e.x, y: e.y, attackerSide: 'enemy', attackerId: e.id, ...rangedSource,
        incomingDx: target.x - e.x, incomingDy: target.y - e.y,
      })
      return target.hp > 0
    }
  }
  return false
}

// ================= 敌人行为（§6） =================

function terrainSpeedMod(x: number, y: number): number {
  const t = terrainAt(Math.floor(x), Math.floor(y))
  if (!t) return 1
  return t.moveModifier // 地形只有地面效果（如减速），不挡移动/弹道；每实例可调
}

function setAttackFromBlocker(s: GameState, e: Enemy, bl: Blocker) {
  if (bl.kind === 'terrain') return // 地形不可攻击（新口径下地形不挡路，理论上不会选到）
  if (bl.kind === 'object') {
    const o = s.objects.find(o => o.id === bl.id)
    if (o && o.hp < 0) return // hp=-1 物体不可破坏：不进入攻击，保持移动重寻路
  }
  e.mode = 'attack'
  e.targetKind = bl.kind as Enemy['targetKind']
  e.targetId = bl.id
}

function approachNumber(current: number, target: number, maxDelta: number): number {
  const delta = target - current
  return Math.abs(delta) <= maxDelta ? target : current + Math.sign(delta) * maxDelta
}

function vehicleBrakeMultiplier(inertia: number): number {
  const value = Math.max(1, Math.min(10, inertia))
  return value <= 5 ? 3 - (value - 1) / 2 : 1 - (value - 5) * 0.16
}

/**
 * 气垫底盘的局部惯性积分。推进只改变车头纵向速度；横向速度按稳定率缓慢衰减，
 * 因此车身转向后原速度方向不会瞬间跟随，形成可控甩尾。无推进时滑行阻力会让两轴最终停稳。
 */
export function hoverVelocityStep(
  vx: number, vy: number, heading: number, targetForwardSpeed: number,
  acceleration: number, drag: number, grip: number, dt: number,
): { vx: number; vy: number } {
  if (dt <= 0) return { vx, vy }
  const forwardX = dirX(heading), forwardY = dirY(heading)
  const rightX = forwardY, rightY = -forwardX
  let forwardSpeed = vx * forwardX + vy * forwardY
  let lateralSpeed = vx * rightX + vy * rightY
  if (Math.abs(targetForwardSpeed) > 1e-6) {
    forwardSpeed = approachNumber(forwardSpeed, targetForwardSpeed, Math.max(0.01, acceleration) * dt)
  } else {
    forwardSpeed *= Math.exp(-Math.max(0.05, drag) * dt)
  }
  lateralSpeed *= Math.exp(-(Math.max(0, grip) + (Math.abs(targetForwardSpeed) <= 1e-6 ? Math.max(0.05, drag) : 0)) * dt)
  if (Math.abs(forwardSpeed) < 0.005) forwardSpeed = 0
  if (Math.abs(lateralSpeed) < 0.005) lateralSpeed = 0
  return {
    vx: forwardX * forwardSpeed + rightX * lateralSpeed,
    vy: forwardY * forwardSpeed + rightY * lateralSpeed,
  }
}

/**
 * 步行机甲共用运动积分：先朝期望方向原地/低速转身，夹角收窄后再行走。
 * 速度始终贴合机体朝向，不产生轮式转弯半径或气垫横向漂移。
 */
export function walkerMotionStep(
  vx: number, vy: number, heading: number, desiredHeading: number, requestedSpeed: number,
  acceleration: number, brakeInertia: number, turnSpeedDeg: number, dt: number,
): { vx: number; vy: number; heading: number; turnW: number; speed: number } {
  if (dt <= 0) return { vx, vy, heading, turnW: 0, speed: Math.hypot(vx, vy) }
  const headingDiff = wrapAngle(desiredHeading - heading)
  const maxTurn = Math.max(0, turnSpeedDeg) * DEG * dt
  const headingDelta = Math.max(-maxTurn, Math.min(maxTurn, headingDiff))
  const nextHeading = wrapAngle(heading + headingDelta)
  // 超过 60° 时先转身；进入角度窗口后平滑提速，避免斜向指令让机体横移。
  const alignment = Math.abs(headingDiff) >= Math.PI / 3 ? 0 : Math.max(0, Math.cos(headingDiff))
  const targetSpeed = Math.max(0, requestedSpeed) * alignment
  const currentSpeed = Math.hypot(vx, vy)
  const braking = targetSpeed < currentSpeed
  const maxDelta = Math.max(0.01, acceleration) * (braking ? vehicleBrakeMultiplier(brakeInertia) : 1) * dt
  const speed = approachNumber(currentSpeed, targetSpeed, maxDelta)
  return {
    vx: dirX(nextHeading) * speed,
    vy: dirY(nextHeading) * speed,
    heading: nextHeading,
    turnW: headingDelta / dt,
    speed,
  }
}

type WalkerAnimationRuntime = Pick<UnitVehicleRuntime, 'walkPhase' | 'walkSettleTarget' | 'walkSettleBlend'>

export interface WalkerAnimationAdvance {
  /** 每项是刚刚落地的半步序号；奇偶值用于左右脚交替。 */
  footfalls: number[]
  turningInPlace: boolean
}

/**
 * 统一推进机甲步态：平移按真实位移，转身按角位移换算为低速步幅；
 * 松开输入或受阻时先补完当前半步，再以 0.1 秒淡入待机帧。
 */
export function advanceWalkerAnimation(
  runtime: WalkerAnimationRuntime,
  walkerStride: number,
  actualDistance: number,
  headingDelta: number,
  dt: number,
): WalkerAnimationAdvance {
  const stride = Math.max(0.05, Math.min(20, walkerStride))
  const phase = Math.max(0, runtime.walkPhase ?? 0)
  // 原地转 90° 对应一组 7 帧半步；移动和转向同时发生时取较大项，避免叠加后步频过快。
  const turnDistance = Math.abs(headingDelta) * (2 * stride / Math.PI)
  const locomotionDistance = Math.max(Math.max(0, actualDistance), turnDistance)
  const turningInPlace = actualDistance <= 1e-5 && turnDistance > 1e-5
  const footfalls: number[] = []
  const collectFootfalls = (from: number, to: number) => {
    const first = Math.floor((from + 1e-8) / stride) + 1
    const last = Math.floor((to + 1e-8) / stride)
    for (let step = first; step <= last && footfalls.length < 4; step++) footfalls.push(step)
  }

  if (locomotionDistance > 1e-5) {
    const next = phase + locomotionDistance
    collectFootfalls(phase, next)
    runtime.walkPhase = next
    runtime.walkSettleTarget = undefined
    runtime.walkSettleBlend = undefined
    return { footfalls, turningInPlace }
  }

  if (phase <= 1e-8) {
    runtime.walkPhase = 0
    runtime.walkSettleTarget = undefined
    runtime.walkSettleBlend = undefined
    return { footfalls, turningInPlace: false }
  }

  let target = runtime.walkSettleTarget
  if (target === undefined || target + 1e-8 < phase) {
    // 每 7 帧是一组单脚动作；停下后只补完当前这一组，最长不会多播超过半个完整循环。
    target = Math.ceil(phase / stride - 1e-7) * stride
    runtime.walkSettleTarget = Math.max(phase, target)
    runtime.walkSettleBlend = undefined
  }
  target = runtime.walkSettleTarget ?? phase
  if (phase + 1e-8 < target) {
    const next = Math.min(target, phase + stride / 0.14 * Math.max(0, dt))
    collectFootfalls(phase, next)
    runtime.walkPhase = next
    if (next + 1e-8 >= target) runtime.walkSettleBlend = 0
    return { footfalls, turningInPlace: false }
  }

  const blend = Math.min(1, (runtime.walkSettleBlend ?? 0) + Math.max(0, dt) / 0.1)
  runtime.walkSettleBlend = blend
  if (blend >= 1) {
    runtime.walkPhase = 0
    runtime.walkSettleTarget = undefined
    runtime.walkSettleBlend = undefined
  }
  return { footfalls, turningInPlace: false }
}

function emitWalkerFootfalls(
  s: GameState,
  defId: string,
  centerX: number,
  centerY: number,
  heading: number,
  platform: FortressDef,
  footfalls: readonly number[],
  turningInPlace: boolean,
): void {
  if (footfalls.length === 0) return
  const co = Math.cos(heading), si = Math.sin(heading)
  const intensity = Math.max(0.5, Math.min(1.35, Math.sqrt(Math.max(0.1, platform.w * platform.h)) / 2.8)) * (turningInPlace ? 0.72 : 1)
  for (const step of footfalls) {
    const side = step % 2 === 0 ? -1 : 1
    const localX = side * platform.w * 0.22
    const localY = platform.h * 0.18
    ;(s.audioSignals ??= []).push({
      id: s.nextId++, kind: 'walkerStep', defId,
      x: centerX + localX * co - localY * si,
      y: centerY + localX * si + localY * co,
      intensity, left: 0.3,
    })
  }
}

function settleWalkerAnimationIfIdle(
  s: GameState,
  host: MovableVehicleHost,
  unit: UnitDef,
  dt: number,
): void {
  const config = unitTypeConfig(unit)
  const platform = unitVehiclePlatform(unit)
  if (!host.vehicle || config?.kind !== 'vehicle' || config.chassis !== 'walker' || !platform) return
  if (host.vehicle.walkAnimationAt === s.time) return
  const animation = advanceWalkerAnimation(host.vehicle, config.walkerStride, 0, 0, dt)
  host.vehicle.walkAnimationAt = s.time
  emitWalkerFootfalls(s, unit.id, host.x, host.y, host.vehicle.heading, platform, animation.footfalls, animation.turningInPlace)
}

/**
 * 阵营无关载具运动求解：履带/轮式/半履带、气垫和步行机甲使用各自运动学。
 * 返回 false 表示该单位不是载具，调用方继续使用普通单位坐标移动。
 */
type MovableVehicleHost = { id?: number; x: number; y: number; vehicle?: UnitVehicleRuntime; bossSizeScale?: number }

/**
 * 飞行器运动：忽略地面地形倍率、地面阻挡和战场边界；高度由独立运行状态推进。
 * 越过边界后继续完整模拟转向、环绕、索敌和返场，避免坐标钳制与向外速度互相抵消形成“贴边卡住”。
 * 旋翼允许减速至悬停；固定翼始终保持最低航速，抵达目标后转入盘旋。
 */
export function moveUnitAircraftToward(
  e: MovableAircraftHost, unit: UnitDef, tx: number, ty: number, dt: number, speedScale = 1, facingHeading?: number,
): boolean {
  if (!e.aircraft || dt <= 0) return false
  const config = unitTypeConfig(unit)
  if (config?.kind !== 'rotorcraft' && config?.kind !== 'fixedWingAircraft') return false
  const dx = tx - e.x, dy = ty - e.y
  const distance = Math.hypot(dx, dy)
  const currentSpeed = Math.hypot(e.aircraft.vx, e.aircraft.vy)

  if (config.kind === 'fixedWingAircraft') {
    if (speedScale > 0 || distance > 1e-5 || e.aircraft.holdX === undefined || e.aircraft.holdY === undefined) {
      e.aircraft.holdX = tx
      e.aircraft.holdY = ty
    }
    const centerX = e.aircraft.holdX ?? tx, centerY = e.aircraft.holdY ?? ty
    const centerDx = centerX - e.x, centerDy = centerY - e.y
    const centerDistance = Math.hypot(centerDx, centerDy)
    const orbitRadius = Math.max(0.25, config.turnRadius, unit.stats.size * 2)
    e.aircraft.orbitDirection ??= ((e.id ?? 0) % 2 === 0 ? 1 : -1)
    let desiredHeading = e.aircraft.heading
    if (centerDistance > orbitRadius * 1.25) desiredHeading = Math.atan2(centerDx, -centerDy)
    else if (centerDistance > 1e-6) {
      const toCenter = Math.atan2(centerDx, -centerDy)
      const radialError = Math.max(-0.65, Math.min(0.65, (centerDistance - orbitRadius) / orbitRadius * 0.8))
      desiredHeading = wrapAngle(toCenter + e.aircraft.orbitDirection * (Math.PI / 2 - radialError))
    }
    const unitMaxSpeed = Math.max(0.01, unit.stats.speed)
    const minSpeed = Math.min(unitMaxSpeed, Math.max(0.01, config.minSpeed))
    const targetSpeed = Math.max(minSpeed, unitMaxSpeed * Math.max(0, Math.min(1, speedScale)))
    const speed = approachNumber(currentSpeed, targetSpeed, Math.max(0.01, config.accel) * dt)
    const radiusTurnRate = Math.max(minSpeed, speed) / Math.max(0.1, config.turnRadius)
    const maxTurn = Math.min(Math.max(0.1, config.turnSpeed) * DEG, radiusTurnRate) * dt
    const headingDelta = wrapAngle(desiredHeading - e.aircraft.heading)
    e.aircraft.heading = wrapAngle(e.aircraft.heading + Math.max(-maxTurn, Math.min(maxTurn, headingDelta)))
    e.aircraft.vx = dirX(e.aircraft.heading) * speed
    e.aircraft.vy = dirY(e.aircraft.heading) * speed
    e.x += e.aircraft.vx * dt
    e.y += e.aircraft.vy * dt
    if (e.vehicle) {
      e.vehicle.heading = e.aircraft.heading
      e.vehicle.vx = e.aircraft.vx
      e.vehicle.vy = e.aircraft.vy
    }
    return true
  }

  const movementHeading = distance > 1e-6 ? Math.atan2(dx, -dy) : e.aircraft.heading
  const desiredHeading = facingHeading === undefined ? movementHeading : wrapAngle(facingHeading)
  const maxTurn = Math.max(0.1, config.turnSpeed) * DEG * dt
  const headingDelta = wrapAngle(desiredHeading - e.aircraft.heading)
  e.aircraft.heading = wrapAngle(e.aircraft.heading + Math.max(-maxTurn, Math.min(maxTurn, headingDelta)))

  const acceleration = Math.max(0.01, config.accel)
  const maxSpeed = Math.max(0, unit.stats.speed * Math.max(0, speedScale))
  const stoppingSpeed = distance > 0 ? Math.sqrt(2 * acceleration * distance) : 0
  const targetSpeed = Math.min(maxSpeed, stoppingSpeed)
  let speed = approachNumber(currentSpeed, targetSpeed, acceleration * dt)
  if (distance <= 0.03 && speed <= acceleration * dt + 1e-6) {
    e.x = tx
    e.y = ty
    speed = 0
  }
  // 普通飞行仍沿机头推进；受限炮位环绕时，旋翼机允许沿切线侧飞并独立保持机头朝向。
  const velocityHeading = facingHeading === undefined ? e.aircraft.heading : movementHeading
  e.aircraft.vx = dirX(velocityHeading) * speed
  e.aircraft.vy = dirY(velocityHeading) * speed
  e.x += e.aircraft.vx * dt
  e.y += e.aircraft.vy * dt
  if (e.vehicle) {
    e.vehicle.heading = e.aircraft.heading
    e.vehicle.vx = e.aircraft.vx
    e.vehicle.vy = e.aircraft.vy
  }
  return true
}

/** 固定翼本帧未被行为/AI移动时继续围绕最后目标盘旋，避免“静止”分支把飞机冻结在空中。 */
function continueFixedWingFlightIfIdle(
  e: MovableAircraftHost, unit: UnitDef, beforeX: number, beforeY: number, beforeHeading: number | undefined, dt: number,
): void {
  const config = unitTypeConfig(unit)
  if (!e.aircraft || config?.kind !== 'fixedWingAircraft') return
  const moved = Math.hypot(e.x - beforeX, e.y - beforeY) > 1e-7
  const turned = beforeHeading !== undefined && Math.abs(wrapAngle(e.aircraft.heading - beforeHeading)) > 1e-7
  if (moved || turned) return
  moveUnitAircraftToward(e, unit, e.aircraft.holdX ?? e.x, e.aircraft.holdY ?? e.y, dt, 0)
}

export function moveUnitVehicleToward(
  s: GameState, e: MovableVehicleHost, unit: UnitDef, tx: number, ty: number, dt: number, speedScale = 1,
): boolean {
  if (!e.vehicle || dt <= 0) return false
  e.vehicle.trackPhase ??= []
  const config = unitTypeConfig(unit)
  if (config?.kind !== 'vehicle') return false
  const dx = tx - e.x, dy = ty - e.y
  const distance = Math.hypot(dx, dy)
  const hovercraft = config.chassis === 'hovercraft'
  const walker = config.chassis === 'walker'
  const walkerStartHeading = e.vehicle.heading
  if (distance < 1e-5 && !hovercraft && !walker) {
    e.vehicle.vx = 0
    e.vehicle.vy = 0
    e.vehicle.turnW = 0
    return true
  }

  const maxSpeed = Math.max(0, unit.stats.speed * (hovercraft ? 1 : terrainSpeedMod(e.x, e.y)) * Math.max(0, speedScale))
  const desiredHeading = distance > 1e-5 ? Math.atan2(dx, -dy) : e.vehicle.heading
  const headingDiff = wrapAngle(desiredHeading - e.vehicle.heading)
  const forwardX = dirX(e.vehicle.heading), forwardY = dirY(e.vehicle.heading)
  let speed = e.vehicle.vx * forwardX + e.vehicle.vy * forwardY
  let targetSpeed = maxSpeed
  const turnSpeedCap = Math.max(0, config.turnSpeed) * DEG

  if (hovercraft) {
    const maxTurn = turnSpeedCap * dt
    const deltaHeading = Math.max(-maxTurn, Math.min(maxTurn, headingDiff))
    e.vehicle.turnW = dt > 0 ? deltaHeading / dt : 0
    e.vehicle.heading = wrapAngle(e.vehicle.heading + deltaHeading)
    const aligned = Math.max(0, Math.cos(headingDiff))
    targetSpeed = distance <= 0.05 ? 0 : maxSpeed * aligned * Math.min(1, distance / 1.5)
    const velocity = hoverVelocityStep(
      e.vehicle.vx, e.vehicle.vy, e.vehicle.heading, targetSpeed,
      config.accel, config.hoverDrag, config.hoverGrip, dt,
    )
    e.vehicle.vx = velocity.vx
    e.vehicle.vy = velocity.vy
    speed = e.vehicle.vx * dirX(e.vehicle.heading) + e.vehicle.vy * dirY(e.vehicle.heading)
  } else if (walker) {
    const requestedSpeed = distance <= 0.05 ? 0 : maxSpeed * Math.min(1, distance / 0.75)
    const motion = walkerMotionStep(
      e.vehicle.vx, e.vehicle.vy, e.vehicle.heading, desiredHeading, requestedSpeed,
      config.accel, config.brakeInertia, config.turnSpeed, dt,
    )
    e.vehicle.vx = motion.vx
    e.vehicle.vy = motion.vy
    e.vehicle.heading = motion.heading
    e.vehicle.turnW = motion.turnW
    speed = motion.speed
  } else if (config.chassis === 'wheeled' || config.chassis === 'halfTracked') {
    const steerMax = Math.max(1, config.steerMax) * DEG
    const reversing = Math.abs(headingDiff) > Math.PI * 0.75
    const steeringError = reversing
      ? -wrapAngle(desiredHeading - wrapAngle(e.vehicle.heading + Math.PI))
      : headingDiff
    const steerTarget = Math.max(-steerMax, Math.min(steerMax, steeringError))
    e.vehicle.steerAngle = approachNumber(e.vehicle.steerAngle, steerTarget, Math.max(1, config.steerRate) * DEG * dt)
    const wheelbase = Math.max(0.2, config.wheelbase)
    const grip = m2c(Math.max(0.1, config.gripMax))
    const gripTanLimit = grip * wheelbase / Math.max(speed * speed, 0.25)
    const radiusTanLimit = config.turnRadius > 0 ? wheelbase / Math.max(0.1, config.turnRadius) : Infinity
    const tanLimit = Math.min(gripTanLimit, radiusTanLimit)
    const tangent = Math.max(-tanLimit, Math.min(tanLimit, Math.tan(e.vehicle.steerAngle)))
    let turnW = speed * tangent / wheelbase
    if (config.chassis === 'halfTracked') {
      // 半履带：前轮自行车模型给出基础横摆，后履带差速在低速时提供更强辅助；
      // 高速仍保留少量差速，使前轮与后履带始终响应同一转向意图。
      const speedRatio = maxSpeed > 1e-6 ? Math.min(1, Math.abs(speed) / maxSpeed) : 0
      const driveSign = reversing ? -1 : 1
      const turnIntent = Math.sign(Math.tan(steerTarget)) * driveSign
      const pivotCap = (2 * Math.max(0.1, maxSpeed)) / Math.max(0.2, config.trackWidth)
      turnW += turnIntent * pivotCap * (0.35 + 0.65 * (1 - speedRatio))
      if (config.turnRadius > 0) {
        const arcCap = Math.max(Math.abs(speed), maxSpeed * 0.25) / Math.max(0.1, config.turnRadius)
        turnW = Math.max(-arcCap, Math.min(arcCap, turnW))
      }
    }
    if (turnSpeedCap > 0) turnW = Math.max(-turnSpeedCap, Math.min(turnSpeedCap, turnW))
    e.vehicle.turnW = turnW
    e.vehicle.heading = wrapAngle(e.vehicle.heading + turnW * dt)
    // 轮式载具必须保持一定前进量才能转向；大角度转弯时主动降速而非横移或原地旋转。
    const alignment = Math.max(0, Math.cos(steeringError))
    targetSpeed *= (reversing ? -Math.max(0, Math.min(1, config.reverseFactor)) : 1) * (0.2 + alignment * 0.8)
    if (config.chassis === 'halfTracked' && Math.abs(headingDiff) > 0.05) {
      targetSpeed *= 1 - Math.max(0, Math.min(0.9, config.turnDrag))
    }
  } else {
    const pivotCap = (2 * Math.max(0.1, maxSpeed)) / Math.max(0.2, config.trackWidth)
    let turnCap = turnSpeedCap > 0 ? Math.min(turnSpeedCap, pivotCap) : pivotCap
    if (config.turnRadius > 0) {
      const arcCap = Math.max(Math.abs(speed), maxSpeed * 0.25) / Math.max(0.1, config.turnRadius)
      turnCap = Math.min(turnCap, arcCap)
    }
    const deltaHeading = Math.max(-turnCap * dt, Math.min(turnCap * dt, headingDiff))
    e.vehicle.turnW = deltaHeading / dt
    e.vehicle.heading = wrapAngle(e.vehicle.heading + deltaHeading)
    const alignment = Math.max(0, Math.cos(headingDiff))
    targetSpeed *= alignment
    if (Math.abs(headingDiff) > 0.05) targetSpeed *= 1 - Math.max(0, Math.min(0.9, config.turnDrag))
  }

  if (!hovercraft && !walker) {
    if (distance < Math.max(0.25, Math.abs(speed) * 0.35)) targetSpeed *= Math.max(0.15, distance / Math.max(0.25, Math.abs(speed) * 0.35))
    const braking = Math.abs(targetSpeed) < Math.abs(speed)
    const reverseAccel = targetSpeed < 0 ? Math.max(0, Math.min(1, config.reverseFactor)) : 1
    const accel = Math.max(0.01, config.accel) * reverseAccel * (braking ? vehicleBrakeMultiplier(config.brakeInertia) : 1)
    speed = approachNumber(speed, targetSpeed, accel * dt)
    e.vehicle.vx = dirX(e.vehicle.heading) * speed
    e.vehicle.vy = dirY(e.vehicle.heading) * speed
  }
  const platform = unitVehiclePlatform(unit)
  if (platform && !unit.stats.air) {
    const columns = fortressMarkColumns(platform)
    if (e.vehicle.trackPhase.length !== columns.length) e.vehicle.trackPhase = Array.from({ length: columns.length }, (_, index) => e.vehicle!.trackPhase[index] ?? 0)
    for (let index = 0; index < columns.length; index++) {
      const lateral = (columns[index].x1 + columns[index].x2) / 2
      e.vehicle.trackPhase[index] += (speed - e.vehicle.turnW * lateral) * dt
    }
  }

  const bossScale = e.bossSizeScale ?? 1
  const startX = e.x, startY = e.y
  const moved = moveGroundUnitWithBlockers(s, unit, e.x, e.y, e.vehicle.vx * dt, e.vehicle.vy * dt, e.vehicle.heading, bossScale, e.id)
  const spec = vehicleCollisionSpec(unit)
  const bounds = spec ? unitMovementBounds(unit, e.vehicle.heading, bossScale) : null
  e.x = bounds ? Math.max(bounds.rx, Math.min(LEVEL.cols - bounds.rx, moved.x)) : moved.x
  e.y = bounds ? Math.max(bounds.ry, Math.min(LEVEL.rows - bounds.ry, moved.y)) : moved.y
  if (walker) {
    const actualDistance = Math.hypot(e.x - startX, e.y - startY)
    const animation = advanceWalkerAnimation(
      e.vehicle, config.walkerStride, actualDistance,
      wrapAngle(e.vehicle.heading - walkerStartHeading), dt,
    )
    e.vehicle.walkAnimationAt = s.time
    if (platform) emitWalkerFootfalls(s, unit.id, e.x, e.y, e.vehicle.heading, platform, animation.footfalls, animation.turningInPlace)
  }
  // 以实际位移回写速度；单轴受阻时保留另一轴的贴墙滑动，不把整车速度瞬间清零。
  e.vehicle.vx = (e.x - startX) / dt
  e.vehicle.vy = (e.y - startY) / dt
  // 常规 AI/行为移动完成后立即更新挂载点，消除车体与炮塔之间的一帧延迟。
  syncUnitVehicleTurrets(e, unit)
  return true
}

export function moveEnemyVehicleToward(
  s: GameState, e: Enemy, tx: number, ty: number, dt: number, speedScale = 1,
): boolean {
  return moveUnitVehicleToward(s, e, runtimeEnemyUnitDef(e.unitDefId, e.kind), tx, ty, dt, speedScale)
}

/** 依距离场选择下一步格；结构格 => 攻击；§6.3 就近原则 */
function followPath(s: GameState, e: Enemy, dist: number[], dt: number) {
  const cx = Math.min(LEVEL.cols - 1, Math.max(0, Math.floor(e.x)))
  const cy = Math.min(LEVEL.rows - 1, Math.max(0, Math.floor(e.y)))
  const unit = runtimeEnemyUnitDef(e.unitDefId, e.kind)
  const vehicleConfig = unitTypeConfig(unit)
  const objectClearanceHeight = vehicleObjectClearanceHeight(vehicleConfig)
  const goalTolerance = e.vehicle ? 0.35 : 0.08
  const need = !e.hasGoal || e.pathVersion !== s.pathVersion ||
    (Math.abs(e.x - e.goalX) < goalTolerance && Math.abs(e.y - e.goalY) < goalTolerance)
  if (need) {
    e.pathVersion = s.pathVersion
    let best = dist[cy * LEVEL.cols + cx]
    let bx = cx
    let by = cy + 1 // 默认向下
    const nb: [number, number][] = [[cx, cy + 1], [cx + 1, cy], [cx - 1, cy], [cx, cy - 1]]
    // 步行机甲使用八方向寻路。任一侧正交格有阻挡时禁止切角，避免从墙角或物体夹缝穿过。
    if (vehicleConfig?.kind === 'vehicle' && vehicleConfig.chassis === 'walker') {
      const diagonals: [number, number][] = [[cx + 1, cy + 1], [cx - 1, cy + 1], [cx + 1, cy - 1], [cx - 1, cy - 1]]
      for (const [nx, ny] of diagonals) {
        if (nx < 0 || nx >= LEVEL.cols || ny < 0 || ny >= LEVEL.rows) continue
        if (blockerAt(s, nx, cy, objectClearanceHeight) || blockerAt(s, cx, ny, objectClearanceHeight)) continue
        nb.push([nx, ny])
      }
    }
    for (const [nx, ny] of nb) {
      if (nx < 0 || nx >= LEVEL.cols || ny < 0 || ny >= LEVEL.rows) continue
      const d = dist[ny * LEVEL.cols + nx]
      if (d < best) { best = d; bx = nx; by = ny }
    }
    if (!isFinite(best)) { bx = cx; by = Math.min(LEVEL.rows - 1, cy + 1) }
    const bl = blockerAt(s, bx, by, objectClearanceHeight)
    if (bl && bl.kind !== 'fortress') {
      // 下一步是必须清除的障碍（墙/炮塔/建筑/物体）
      setAttackFromBlocker(s, e, bl)
      e.hasGoal = false
      return
    }
    if (bl && bl.kind === 'fortress') {
      e.mode = 'attack'
      e.targetKind = 'fortress'
      e.targetId = 0
      e.hasGoal = false
      return
    }
    e.goalX = bx + 0.5
    e.goalY = by + 0.5
    e.hasGoal = true
  }
  const spd = unit.stats.speed * terrainSpeedMod(e.x, e.y)
  const dx = e.goalX - e.x
  const dy = e.goalY - e.y
  const d = Math.hypot(dx, dy)
  if (d > 1e-6) {
    if (moveEnemyVehicleToward(s, e, e.goalX, e.goalY, dt)) return
    const step = Math.min(d, spd * dt)
    const moved = moveGroundUnitWithBlockers(s, unit, e.x, e.y, dx / d * step, dy / d * step, null, e.bossSizeScale ?? 1, e.id)
    e.x = moved.x
    e.y = moved.y
  }
}

function moveToward(s: GameState, e: Enemy, tx: number, ty: number, dt: number, ignoreBlockers = false) {
  const unit = runtimeEnemyUnitDef(e.unitDefId, e.kind)
  const vehicleConfig = unitTypeConfig(unit)
  const objectClearanceHeight = vehicleObjectClearanceHeight(vehicleConfig)
  if (moveUnitAircraftToward(e, unit, tx, ty, dt)) return
  // 检查前方格是否被结构阻挡（通往目标路径上的障碍优先清除）
  const dx = tx - e.x
  const dy = ty - e.y
  const d = Math.hypot(dx, dy)
  if (d < 1e-6) return
  const aheadX = Math.floor(e.x + (dx / d) * 0.45)
  const aheadY = Math.floor(e.y + (dy / d) * 0.45)
  if (!ignoreBlockers && (aheadX !== Math.floor(e.x) || aheadY !== Math.floor(e.y))) {
    const bl = blockerAt(s, aheadX, aheadY, objectClearanceHeight)
    if (bl) {
      if (bl.kind === 'fortress') { e.mode = 'attack'; e.targetKind = 'fortress'; e.targetId = 0 }
      else setAttackFromBlocker(s, e, bl)
      return
    }
  }
  const spd = unit.stats.speed * terrainSpeedMod(e.x, e.y)
  if (moveEnemyVehicleToward(s, e, tx, ty, dt)) return
  const step = Math.min(d, spd * dt)
  if (ignoreBlockers && unit.stats.air) {
    e.x += (dx / d) * step
    e.y += (dy / d) * step
  } else {
    const moved = moveGroundUnitWithBlockers(s, unit, e.x, e.y, dx / d * step, dy / d * step, null, e.bossSizeScale ?? 1, e.id)
    e.x = moved.x
    e.y = moved.y
  }
}

/** 点到旋转堡垒矩形的最短距离（格），供远程敌人决定停车射击。 */
export function fortressDistanceToPoint(s: GameState, x: number, y: number): number {
  const r = fortressRect(s)
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2
  const dx = x - cx, dy = y - cy
  const c = Math.cos(s.fortress.heading), sn = Math.sin(s.fortress.heading)
  const lx = dx * c + dy * sn, ly = -dx * sn + dy * c
  const ox = Math.max(0, Math.abs(lx) - r.w / 2)
  const oy = Math.max(0, Math.abs(ly) - r.h / 2)
  return Math.hypot(ox, oy)
}

function moveEnemyFree(s: GameState, e: Enemy, vx: number, vy: number, speed: number, dt: number): void {
  const d = Math.hypot(vx, vy)
  if (d < 1e-6) return
  const unit = runtimeEnemyUnitDef(e.unitDefId, e.kind)
  const unitSpeed = Math.max(0.01, unit.stats.speed)
  if (moveUnitAircraftToward(e, unit, e.x + vx, e.y + vy, dt, speed / unitSpeed)) return
  if (moveEnemyVehicleToward(s, e, e.x + vx, e.y + vy, dt, speed / unitSpeed)) return
  const moved = moveGroundUnitWithBlockers(s, unit, e.x, e.y, (vx / d) * speed * dt, (vy / d) * speed * dt, null, e.bossSizeScale ?? 1, e.id)
  e.x = moved.x
  e.y = moved.y
}

function enemyFireAt(
  s: GameState, e: Enemy, combat: UnitCombatStats,
  target: { kind: Extract<UnitTargetKind, 'fortress' | 'coreBuilding' | 'fixedBuilding' | 'wall' | 'combatUnit'>; id: number; x: number; y: number; side?: 'ally' | 'enemy' },
): void {
  engagePlacementGroup(s, e)
  const tx = target.x, ty = target.y
  const targetEntity = target.kind === 'combatUnit'
    ? target.side === 'enemy' ? s.enemies.find(item => item.id === target.id) : s.allies.find(item => item.id === target.id)
    : undefined
  const targetUnit = targetEntity
    ? 'mode' in targetEntity ? runtimeEnemyUnitDef(targetEntity.unitDefId, targetEntity.kind) : runtimeAllyUnitDef(targetEntity.unitDefId, targetEntity.kind)
    : undefined
  const targetAltitude = targetEntity && targetUnit ? currentUnitAltitude(targetEntity, targetUnit) : 0
  const unit = runtimeEnemyUnitDef(e.unitDefId, e.kind)
  const sourceAltitude = currentUnitAltitude(e, unit)
  const bodyHeading = bearing(tx - e.x, ty - e.y)
  const muzzle = unitMuzzleOrigin(unit, e.x, e.y, bodyHeading)
  const ammo = combat.projectileId ? PROJECTILE_ARTS.find(item => item.id === combat.projectileId) : undefined
  const kind: ProjKind = ammo?.kind === 'shell' ? 'shell' : ammo?.kind === 'missile' ? 'missile' : 'bullet'
  const guideDelay = kind === 'missile' && ammo?.guided ? Math.max(0, ammo.guideDelay ?? 0) : 0
  const projectileId = s.nextId++
  const targetHeading = bearing(tx - muzzle.x, ty - muzzle.y)
  const heading = kind === 'missile' && guideDelay > 0
    ? wrapAngle(bodyHeading + missileEjectOffsetDeg(ammo?.ejectAngle, projectileId) * DEG)
    : targetHeading
  const distanceM = Math.hypot(tx - muzzle.x, ty - muzzle.y) * M_PER_CELL
  const speed = kind === 'missile' ? Math.max(0, ammo?.missileInitSpeed ?? combat.projectileSpeed) : Math.max(1, combat.projectileSpeed)
  const damageMultiplier = enemyAttackDamageMultiplier(e)
  ;(s.audioSignals ??= []).push({ id: s.nextId++, kind: 'unitFire', defId: unit.id, x: muzzle.x, y: muzzle.y, left: 0.25 })
  s.enemyProjectiles.push({
    id: projectileId, shooterId: e.id,
    x: muzzle.x, y: muzzle.y, px: muzzle.x, py: muzzle.y, heading,
    pendingFirstFrame: true,
    speed, damage: combat.damage * damageMultiplier, penetration: combat.penetration,
    assetRef: ammo?.projectileAsset,
    ammoId: combat.projectileId, kind,
    armorPen: ammo?.armorPen, armorDamage: ammo?.armorDamage,
    blastRadius: ammo?.blastRadius, blastEffect: scaledEnemyBlastEffect(ammo?.blastEffect, damageMultiplier),
    t: 0, flightTime: kind === 'shell' ? Math.max(0.3, distanceM / Math.max(1, combat.projectileSpeed)) : undefined,
    sx: muzzle.x, sy: muzzle.y, tx, ty,
    guided: kind === 'missile' && !!ammo?.guided && !(ammo?.guideDelay && ammo.guideDelay > 0),
    willGuide: kind === 'missile' && !!ammo?.guided,
    guideDelayLeft: guideDelay > 0 ? guideDelay : undefined,
    guideDecel: ammo?.guideDecel, burnTime: ammo?.burnTime, missileCurve: ammo?.missileCurve,
    weavePhase: eventRandom(projectileId, 2) * TAU, split: ammo?.split,
    flightLeft: kind === 'missile' ? ammo?.missileFlightTime : undefined,
    missileAccel: ammo?.missileAccel, missileMaxSpeed: ammo?.missileMaxSpeed,
    missileTurnMax: ammo?.missileTurnMax, missileTurnAccel: ammo?.missileTurnAccel,
    turnRate: 0, tgtPX: kind === 'missile' && ammo?.guided ? tx : undefined, tgtPY: kind === 'missile' && ammo?.guided ? ty : undefined,
    igniteAtT: kind === 'missile' ? guideDelay : undefined,
    ignoreObjectId: e.coverObjectId,
    traveled: 0, maxTravel: combat.range * M_PER_CELL * 1.25,
    targetKind: target.kind, targetId: target.id, targetX: tx, targetY: ty,
    sourceAltitude, targetAltitude, altitudeTravelM: distanceM,
    targetSide: target.side, sourceSide: 'enemy', sourceFaction: e.faction ?? 'enemy',
  })
}

type EnemyMountedTurretTarget = MountedTurretTarget

const {
  aimMountedTurret: aimEnemyMountedTurret,
  aimPlayerTurret: aim,
  playerAimRestAngle: aimRestAngle,
} = createTurretAI({
  turretCenter,
  interceptableMissileTargets,
  factionsHostile,
  unitCanSeePoint,
  fortressCenter,
  querySpatialUnits,
  currentUnitAltitude,
  interceptLeadPoint,
  bearing,
  wrapAngle,
  distToFortress,
  turretRangeBonus,
  hardpointOf,
  getLastDt: () => lastDt,
})
function fireEnemyMountedTurretShot(
  s: GameState, turret: Turret, def: TurretDef, target: EnemyMountedTurretTarget, barrelIdx: number, muzzle = muzzlePos(turret, def, barrelIdx), ownerSide: 'ally' | 'enemy' = 'enemy',
): void {
  const ammo = PROJECTILE_ARTS.find(item => item.id === def.art?.projectile)
  const offset = accuracyOffset(s.nextId, def.accuracy ?? 0)
  const missileTarget = target.targetType === 'missile' && target.pool !== undefined
  const targetPoint = missileTarget && def.type === 'direct'
    ? interceptLeadPoint(muzzle, target as InterceptableMissileTarget, def.projectileSpeed ?? 25.6)
    : target
  const tx = targetPoint.x + offset.dx, ty = targetPoint.y + offset.dy
  const projectileId = s.nextId++
  const targetHeading = bearing(tx - muzzle.x, ty - muzzle.y)
  const guideDelay = def.type === 'missile' && def.guided ? Math.max(0, def.guideDelay ?? 0) : 0
  const heading = def.type === 'missile' && guideDelay > 0
    ? wrapAngle(turret.angle + missileEjectOffsetDeg(def.ejectAngle, projectileId) * DEG)
    : targetHeading
  const sourceFaction: LevelPlacedUnitFaction = ownerSide === 'enemy'
    ? s.enemies.find(enemy => enemy.vehicle?.turrets?.some(item => item.id === turret.id))?.faction ?? 'enemy'
    : s.allies.find(ally => ally.vehicle?.turrets?.some(item => item.id === turret.id))?.faction ?? 'ally'
  const owner = ownerSide === 'enemy'
    ? s.enemies.find(enemy => enemy.vehicle?.turrets?.some(item => item.id === turret.id))
    : s.allies.find(ally => ally.vehicle?.turrets?.some(item => item.id === turret.id))
  const damageMultiplier = ownerSide === 'enemy' ? enemyAttackDamageMultiplier(owner as Enemy | undefined) : 1
  if (owner) engagePlacementGroup(s, owner)
  const ownerUnit = owner
    ? 'mode' in owner ? runtimeEnemyUnitDef(owner.unitDefId, owner.kind) : runtimeAllyUnitDef(owner.unitDefId, owner.kind)
    : undefined
  const sourceAltitude = owner && ownerUnit ? currentUnitAltitude(owner, ownerUnit) : 0
  const kind: ProjKind = def.type === 'lob' ? 'shell' : def.type === 'missile' ? 'missile' : 'bullet'
  const distanceM = Math.hypot(tx - muzzle.x, ty - muzzle.y) * M_PER_CELL
  s.enemyProjectiles.push({
    id: projectileId, shooterId: turret.id,
    x: muzzle.x, y: muzzle.y, px: muzzle.x, py: muzzle.y, heading,
    pendingFirstFrame: true,
    speed: kind === 'missile' ? Math.max(0, def.missileInitSpeed ?? 0) : Math.max(1, def.projectileSpeed ?? 32),
    damage: Math.max(0, def.damage) * damageMultiplier,
    penetration: Math.max(0, ammo?.penetration ?? 0),
    assetRef: ammo?.projectileAsset,
    traveled: 0, maxTravel: def.rangeMax * 1.25,
    targetKind: missileTarget ? undefined : target.kind as EnemyProjectile['targetKind'], targetId: missileTarget ? undefined : target.id, targetX: tx, targetY: ty,
    sourceAltitude, targetAltitude: target.altitude, altitudeTravelM: distanceM,
    targetSide: target.side, sourceSide: ownerSide, sourceFaction,
    kind, defId: def.id, ammoId: def.art?.projectile,
    hitIds: [], pierceCount: def.pierce?.count ?? 0, pierceDecay: def.pierce?.decay ?? 0,
    armorPen: def.armorPen, armorDamage: def.armorDamage,
    blastRadius: def.blastRadius, blastEffect: scaledEnemyBlastEffect(def.blastEffect, damageMultiplier),
    t: 0, flightTime: Math.max(0.3, distanceM / Math.max(1, def.projectileSpeed ?? 7.68)),
    sx: muzzle.x, sy: muzzle.y, tx, ty,
    guided: kind === 'missile' && !!def.guided && !(def.guideDelay && def.guideDelay > 0),
    willGuide: kind === 'missile' && !!def.guided,
    guideDelayLeft: guideDelay > 0 ? guideDelay : undefined,
    guideDecel: def.guideDecel, burnTime: def.burnTime, missileCurve: def.missileCurve,
    weavePhase: eventRandom(projectileId, 2) * TAU, split: def.split,
    turnRate: 0,
    flightLeft: kind === 'missile' ? def.missileFlightTime : undefined,
    missileAccel: def.missileAccel, missileMaxSpeed: def.missileMaxSpeed,
    missileTurnMax: def.missileTurnMax, missileTurnAccel: def.missileTurnAccel,
    tgtPX: kind === 'missile' && def.guided ? tx : undefined, tgtPY: kind === 'missile' && def.guided ? ty : undefined,
    igniteAtT: kind === 'missile' ? guideDelay : undefined,
  })
  turret.targetId = target.id
  turret.targetMissilePool = missileTarget ? target.pool : undefined
}

function updateEnemyMountedTurret(s: GameState, host: Enemy | Ally, turret: Turret, hp: Hardpoint, ai: UnitAI, dt: number, ownerSide: 'ally' | 'enemy' = 'enemy'): void {
  const wasFiring = turret.firing
  const playerOwned = ownerSide === 'ally' && (host as Ally).faction === 'player'
  const runtimeDef = defOf(turret.defId)
  const playerBonuses = playerOwned ? moduleBonuses(s, 'playerFaction') : undefined
  if (playerOwned) syncPlayerTurretResources(turret, runtimeDef, playerBonuses)
  const effectiveDef = (def: TurretDef): TurretDef => {
    if (!playerOwned) return def
    const playerTurretCount = s.turrets.length + s.allies.reduce((sum, ally) => sum + (ally.faction === 'player' ? ally.vehicle?.turrets?.length ?? 0 : 0), 0)
    const bonus = playerTurretCount > 0 ? (playerBonuses?.rangeBoostPool ?? 0) / playerTurretCount : 0
    return bonus === 0 ? def : { ...def, rangeMin: def.rangeMin * (1 + bonus), rangeMax: def.rangeMax * (1 + bonus) }
  }
  const resourceBlocked = (def: TurretDef): boolean => {
    if (!playerOwned || !def.tags?.some(tag => tag.kind === 'resource')) return false
    for (const tag of def.tags) {
      if (tag.kind !== 'resource') continue
      let value = 0
      if (tag.res === 'ammo') { const cap = playerTurretResourceCaps(def, playerBonuses).ammoCap; value = cap > 0 ? (turret.ammo ?? cap) / cap * 100 : 100 }
      else if (tag.res === 'energy') { const cap = playerTurretResourceCaps(def, playerBonuses).energyCap; value = cap > 0 ? (turret.energy ?? cap) / cap * 100 : 100 }
      else if (tag.res === 'heat') { const cap = Math.max(1, host.vehicle?.heatCap ?? 100); value = (host.vehicle?.heat ?? 0) / cap * 100 }
      else value = host.maxHp > 0 ? host.hp / host.maxHp * 100 : 100
      if (tag.op === 'lt' ? value < tag.value : value > tag.value) return true
    }
    return false
  }
  const ops: TurretStateOps<EnemyMountedTurretTarget> = {
    blocked: def => !!host.vehicle?.overheated || resourceBlocked(def),
    aim: def => aimEnemyMountedTurret(s, host, turret, hp, ai, effectiveDef(def), dt, ownerSide),
    hasAmmo: amount => !playerOwned || (turret.ammo ?? 0) + 1e-9 >= amount,
    spendAmmo: amount => { if (playerOwned) turret.ammo = Math.max(0, (turret.ammo ?? 0) - amount) },
    hasEnergy: amount => !playerOwned || (turret.energy ?? 0) + 1e-9 >= amount,
    spendEnergy: amount => { if (playerOwned) turret.energy = Math.max(0, (turret.energy ?? 0) - amount) },
    addHeat: amount => {
      if (!host.vehicle) return
      const cap = Math.max(1, host.vehicle.heatCap ?? 100)
      host.vehicle.heat = Math.min(cap, (host.vehicle.heat ?? 0) + amount)
      if (host.vehicle.heat >= cap) host.vehicle.overheated = true
    },
    overheated: () => !!host.vehicle?.overheated,
    fire: (def, target, _step, muzzle, barrelIdx) => fireEnemyMountedTurretShot(s, turret, effectiveDef(def), target, barrelIdx, muzzle, ownerSide),
    continuousTick: def => { const effective = effectiveDef(def); if (effective.type === 'beam') enemyBeamTick(s, turret, effective, ownerSide, ai); else enemySprayTick(s, turret, effective, ai, ownerSide) },
    beamReady: def => { const effective = effectiveDef(def); return turret.beamOnAt === undefined || beamLength(s, turret, effective) >= beamMarch(s, turret, effective).len - 1e-9 },
  }
  updateTurretBody(s, turret, dt, ops)
  const def = defOf(turret.defId)
  // 光束/喷射不会经过单发弹丸入口，因此在持续攻击真正开始时唤醒同组成员。
  if (!wasFiring && turret.firing) engagePlacementGroup(s, host)
  if (!wasFiring && turret.firing && def.type === 'beam') turret.beamOnAt = s.time
  if (wasFiring && !turret.firing && def.type === 'beam') {
    const c = muzzlePos(turret, def, 0)
    s.beamFades.push({ id: s.nextId++, defId: turret.defId, x: c.x, y: c.y, angle: turret.angle, len: beamLength(s, turret, def), width: def.beamWidth, mode: def.beamFadeMode ?? 'shrink', ttl: BEAM_FADE, max: BEAM_FADE })
    turret.beamOnAt = undefined
  }
}

/** 非玩家载具与玩家堡垒使用相同的散热/恢复阈值；弹药和电量仍由各自 ops 决定。 */
export function coolUnitVehicleHeat(host: VehicleUnitHost, unit: UnitDef, dt: number): void {
  const def = unitVehiclePlatform(unit)
  if (!host.vehicle || !def) return
  const vehicle = host.vehicle
  vehicle.heat ??= 0
  vehicle.overheated ??= false
  vehicle.heatCap = Math.max(1, def.heatCap)
  vehicle.heatDissipation = Math.max(0, def.heatDissipation)
  vehicle.trackPhase ??= []
  vehicle.heat = Math.max(0, vehicle.heat - vehicle.heatDissipation * dt)
  if (vehicle.overheated && vehicle.heat <= vehicle.heatCap * OVERHEAT_RESUME) vehicle.overheated = false
}

function updateEnemyVehicleTurrets(s: GameState, enemy: Enemy, dt: number): void {
  if (!enemy.vehicle || enemy.hp <= 0 || (enemy.controller ?? 'ai') !== 'ai') return
  const unit = runtimeEnemyUnitDef(enemy.unitDefId, enemy.kind)
  coolUnitVehicleHeat(enemy, unit, dt)
  const ai = enemy.aiOverride || unit.ai ? normalizeUnitAI(enemy.aiOverride ?? unit.ai) : undefined
  const platform = unitVehiclePlatform(unit)
  if (!ai || !platform) return
  const turrets = ensureEnemyVehicleTurrets(s, enemy, unit)
  syncEnemyVehicleTurrets(enemy, unit)
  for (const turret of turrets) {
    const sourceHp = platform.hardpoints.find(item => item.id === turret.hardpointId)
    if (sourceHp) updateEnemyMountedTurret(s, enemy, turret, effectiveUnitHardpoint(enemy, platform, sourceHp), ai, dt)
  }
}

function updateAllyVehicleTurrets(s: GameState, ally: Ally, unit: UnitDef, ai: UnitAI, dt: number): void {
  const platform = unitVehiclePlatform(unit)
  if (!ally.vehicle || ally.hp <= 0 || (ally.controller ?? 'ai') !== 'ai' || !platform) return
  coolUnitVehicleHeat(ally, unit, dt)
  const turrets = ensureUnitVehicleTurrets(s, ally, unit)
  if (ally.faction === 'player') {
    const bonuses = moduleBonuses(s, 'playerFaction')
    ally.vehicle.heat = Math.max(0, ally.vehicle.heat - bonuses.coolingPool * dt)
    for (const turret of turrets) {
      const def = defOf(turret.defId)
      syncPlayerTurretResources(turret, def, bonuses)
      if (bonuses.ammoRegen > 0) changePlayerTurretAmmo(turret, def, bonuses.ammoRegen * dt, bonuses)
      if (bonuses.energyRegen > 0) turret.energy = Math.min(playerTurretResourceCaps(def, bonuses).energyCap, (turret.energy ?? 0) + bonuses.energyRegen * dt)
    }
  }
  syncUnitVehicleTurrets(ally, unit)
  for (const turret of turrets) {
    const sourceHp = platform.hardpoints.find(item => item.id === turret.hardpointId)
    if (sourceHp) updateEnemyMountedTurret(s, ally, turret, effectiveUnitHardpoint(ally, platform, sourceHp), ai, dt, 'ally')
  }
}

/**
 * 撞击使用直达车道检查：只采样目标外沿之前的地格，目标本体不会被误判成阻挡物。
 * 失败后由 vehicleCombatAI 的运行时迟滞定时重检，避免每帧做重复路径判断。
 */
function ramPathReachable(s: GameState, host: Enemy | Ally, unit: UnitDef, target: UnitCombatTarget): boolean {
  if (!host.vehicle || unit.stats.air || target.air) return false
  const dx = target.x - host.x, dy = target.y - host.y
  const distance = Math.hypot(dx, dy)
  if (distance <= 0.7) return true
  const clearance = vehicleObjectClearanceHeight(unitTypeConfig(unit))
  const travel = Math.max(0, distance - 0.65)
  const steps = Math.max(1, Math.ceil(travel / 0.35))
  for (let index = 1; index <= steps; index++) {
    const ratio = Math.min(1, index / steps) * travel / distance
    const x = Math.floor(host.x + dx * ratio)
    const y = Math.floor(host.y + dy * ratio)
    const blocker = blockerAt(s, x, y, clearance)
    if (!blocker) continue
    if (target.kind === 'fortress' && blocker.kind === 'fortress') continue
    return false
  }
  return true
}

const {
  updateArmedAllyVehicleMovement,
  updateArmedEnemyVehicleMovement,
} = createVehicleCombatAI({
  factionsHostile,
  unitCanSeePoint,
  fortressCenter,
  fortressDistanceToPoint,
  unitRadiusToward,
  currentUnitAltitude,
  unitVehiclePlatform,
  effectiveUnitHardpoint,
  turretCenter,
  bearing,
  wrapAngle,
  dirX,
  dirY,
  moveUnitAircraftToward,
  moveUnitVehicleToward,
  approachNumber,
  vehicleBrakeMultiplier,
  syncUnitVehicleTurrets,
  turretDefById: defOf,
  ensureUnitVehicleTurrets,
  ensureEnemyVehicleTurrets,
  syncEnemyVehicleTurrets,
  moveAllyToward,
  moveToward,
  vehicleObjectClearanceHeight,
  computePathField,
  followPath,
  ramPathReachable,
})

function damageEnemyTurretTarget(
  s: GameState, target: Pick<EnemyMountedTurretTarget, 'kind' | 'id' | 'side' | 'x' | 'y'>, damage: number,
  source: EnemyDamageSource,
): void {
  if (target.kind === 'fortress') {
    damageFortress(s, damage, {
      x: source.x, y: source.y, kind: 'projectile', penetration: source.penetration,
      armorPen: source.armorPen, armorDamage: source.armorDamage,
      ammoId: source.ammoId, projectileSize: source.projectileSize ?? ENEMY_PROJECTILE_VISUAL_SIZE,
      incomingDx: source.incomingDx, incomingDy: source.incomingDy,
    })
  } else if (target.kind === 'combatUnit') {
    if (target.side === 'enemy') {
      const enemy = s.enemies.find(item => item.id === target.id)
      if (enemy) damageEnemy(s, enemy, damage, null, source)
    } else {
      const ally = s.allies.find(item => item.id === target.id)
      if (ally) damageAlly(s, ally, damage, source)
    }
  } else if (target.kind === 'coreBuilding') {
    damageCore(s, damage)
  } else if (target.kind === 'fixedBuilding') {
    const building = s.buildings.find(item => item.id === target.id)
    if (building) damageBuilding(s, building, damage)
  } else if (target.kind === 'wall') {
    const wall = s.walls.find(item => item.id === target.id)
    if (wall) damageWall(s, wall, damage)
  }
}

function forEachEnemyTurretHostile(s: GameState, turret: Turret, _ai: UnitAI, visit: (target: EnemyMountedTurretTarget) => void, ownerSide: 'ally' | 'enemy' = 'enemy'): void {
  const add = (target: Omit<EnemyMountedTurretTarget, 'distanceM'>) => visit({ ...target, distanceM: 0 })
  const ownerEnemy = ownerSide === 'enemy' ? s.enemies.find(item => item.vehicle?.turrets?.some(value => value.id === turret.id)) : undefined
  const ownerAlly = ownerSide === 'ally' ? s.allies.find(item => item.vehicle?.turrets?.some(value => value.id === turret.id)) : undefined
  const ownerFaction: LevelPlacedUnitFaction = ownerEnemy?.faction ?? ownerAlly?.faction ?? (ownerSide === 'enemy' ? 'enemy' : 'ally')
  if (factionsHostile(ownerFaction, 'player') && s.fortress.hp > 0 && s.fortress.dyingT < 0) {
    const p = fortressCenter(s); add({ kind: 'fortress', id: 0, x: p.x, y: p.y, air: false, altitude: 0 })
  }
  for (const ally of s.allies) {
    const faction = ally.faction ?? 'ally'
    if (ally === ownerAlly || ally.hp <= 0 || !factionsHostile(ownerFaction, faction)) continue
    const unit = runtimeAllyUnitDef(ally.unitDefId, ally.kind)
    add({ kind: 'combatUnit', id: ally.id, x: ally.x, y: ally.y, side: 'ally', air: unit.stats.air, altitude: currentUnitAltitude(ally, unit) })
  }
  for (const enemy of s.enemies) {
    const faction = enemy.faction ?? 'enemy'
    if (enemy === ownerEnemy || enemy.hp <= 0 || faction === 'neutralHostile' || !factionsHostile(ownerFaction, faction)) continue
    const unit = runtimeEnemyUnitDef(enemy.unitDefId, enemy.kind)
    add({ kind: 'combatUnit', id: enemy.id, x: enemy.x, y: enemy.y, side: 'enemy', air: unit.stats.air, altitude: currentUnitAltitude(enemy, unit) })
  }
}

function enemyBeamTick(s: GameState, turret: Turret, def: TurretDef, ownerSide: 'ally' | 'enemy' = 'enemy', ownerAi?: UnitAI): void {
  const enemyOwner = ownerSide === 'enemy' ? s.enemies.find(item => item.vehicle?.turrets?.some(value => value.id === turret.id)) : undefined
  const allyOwner = ownerSide === 'ally' ? s.allies.find(item => item.vehicle?.turrets?.some(value => value.id === turret.id)) : undefined
  const owner = enemyOwner ?? allyOwner
  const unit = enemyOwner
    ? runtimeEnemyUnitDef(enemyOwner.unitDefId, enemyOwner.kind)
    : allyOwner ? runtimeAllyUnitDef(allyOwner.unitDefId, allyOwner.kind) : undefined
  const ai = ownerAi ?? (owner ? owner.aiOverride ?? unit?.ai : undefined)
  if (!ai) return
  const c = muzzlePos(turret, def, 0), march = beamMarch(s, turret, def), len = beamLength(s, turret, def)
  const endX = c.x + dirX(turret.angle) * len, endY = c.y + dirY(turret.angle) * len
  const halfW = m2c(def.beamWidth ?? 0.256) / 2
  const damageMultiplier = ownerSide === 'enemy' ? enemyAttackDamageMultiplier(enemyOwner) : 1
  const damage = (def.dot?.damage ?? def.damage) * levelScale(turret.level) * damageMultiplier
  const ammo = PROJECTILE_ARTS.find(item => item.id === def.art?.projectile)
  const targetAltitude = turretRuntimeTargetAltitude(s, turret)
  forEachEnemyTurretHostile(s, turret, ai, target => {
    if (target.air ? !def.canAir : !def.canGround) return
    if (Math.abs(target.altitude - targetAltitude) > 0.55) return
    if (!beamSegmentHitsTarget(s, target, c.x, c.y, endX, endY, halfW)) return
    damageEnemyTurretTarget(s, target, damage, {
      x: c.x, y: c.y, penetration: ammo?.penetration, armorPen: def.armorPen, armorDamage: def.armorDamage,
      incomingDx: dirX(turret.angle), incomingDy: dirY(turret.angle),
      ammoId: def.art?.projectile, projectileSize: ENEMY_PROJECTILE_VISUAL_SIZE,
      ...mountedTurretAttacker(s, turret.id, ownerSide),
    })
  }, ownerSide)
  if (def.canInterceptMissile && !def.tags?.some(tag => tag.kind === 'exclude' && tag.key === 'missile')) {
    const ownerFaction = turretRuntimeFaction(s, turret)
    for (const missile of interceptableMissileTargets(s, ownerFaction)) {
      const dx = missile.x - c.x, dy = missile.y - c.y
      const along = dx * dirX(turret.angle) + dy * dirY(turret.angle)
      const perp = Math.abs(dx * -dirY(turret.angle) + dy * dirX(turret.angle))
      if (along < 0 || along > len || perp > halfW + MISSILE_INTERCEPT_RADIUS) continue
      if (Math.abs(missile.altitude - targetAltitude) > 0.55) continue
      applyMissileInterceptionDamage(s, missile.pool, missile.id, damage)
    }
  }
  if (len >= march.len - 1e-9 && march.blocker) damageObject(s, march.blocker, damage)
  if (def.art?.projectile) addImpact(s, c.x + dirX(turret.angle) * len, c.y + dirY(turret.angle) * len, def.art.projectile, dirX(turret.angle), dirY(turret.angle), targetAltitude)
}

function enemySprayTick(s: GameState, turret: Turret, def: TurretDef, ai: UnitAI, ownerSide: 'ally' | 'enemy' = 'enemy'): void {
  const c = turretCenter(turret), range = m2c(def.rangeMax), halfAngle = (def.sprayAngle ?? 60) * DEG / 2
  const sourceAltitude = turretRuntimeSourceAltitude(s, turret)
  const owner = ownerSide === 'enemy'
    ? s.enemies.find(item => item.vehicle?.turrets?.some(value => value.id === turret.id))
    : undefined
  const damageMultiplier = ownerSide === 'enemy' ? enemyAttackDamageMultiplier(owner) : 1
  const damage = (def.dot?.damage ?? def.damage) * levelScale(turret.level) * damageMultiplier
  const ammo = PROJECTILE_ARTS.find(item => item.id === def.art?.projectile)
  forEachEnemyTurretHostile(s, turret, ai, target => {
    if (target.air ? !def.canAir : !def.canGround) return
    const dx = target.x - c.x, dy = target.y - c.y, distance = Math.hypot(dx, dy)
    if (distance > range + 0.35 || Math.abs(wrapAngle(bearing(dx, dy) - turret.angle)) > halfAngle) return
    for (let l = 0.2; l < distance; l += 0.2) {
      const altitude = sourceAltitude + (target.altitude - sourceAltitude) * Math.max(0, Math.min(1, l / distance))
      if (projectileBlockerAt(s, Math.floor(c.x + dx / distance * l), Math.floor(c.y + dy / distance * l), { kind: 'spray', altitude })) return
    }
    damageEnemyTurretTarget(s, target, damage, {
      x: c.x, y: c.y, penetration: ammo?.penetration, armorPen: def.armorPen, armorDamage: def.armorDamage,
      incomingDx: dx, incomingDy: dy, ammoId: def.art?.projectile, projectileSize: ENEMY_PROJECTILE_VISUAL_SIZE,
      ...mountedTurretAttacker(s, turret.id, ownerSide),
    })
  }, ownerSide)
  for (const object of s.objects) {
    if (!object.blockProjectile || object.hp <= 0) continue
    const dx = object.x + object.w / 2 - c.x, dy = object.y + object.h / 2 - c.y
    if (Math.hypot(dx, dy) <= range + Math.max(object.w, object.h) / 2 && Math.abs(wrapAngle(bearing(dx, dy) - turret.angle)) <= halfAngle) damageObject(s, object, damage)
  }
}

function unitFireAtEnemy(s: GameState, ally: Ally, target: Enemy, combat: UnitCombatStats): void {
  engagePlacementGroup(s, ally)
  const unit = runtimeAllyUnitDef(ally.unitDefId, ally.kind)
  const bodyHeading = bearing(target.x - ally.x, target.y - ally.y)
  const muzzle = unitMuzzleOrigin(unit, ally.x, ally.y, bodyHeading)
  const ammo = combat.projectileId ? PROJECTILE_ARTS.find(item => item.id === combat.projectileId) : undefined
  const kind: ProjKind = ammo?.kind === 'shell' ? 'shell' : ammo?.kind === 'missile' ? 'missile' : 'bullet'
  const guideDelay = kind === 'missile' && ammo?.guided ? Math.max(0, ammo.guideDelay ?? 0) : 0
  const projectileId = s.nextId++
  const targetHeading = bearing(target.x - muzzle.x, target.y - muzzle.y)
  const heading = kind === 'missile' && guideDelay > 0
    ? wrapAngle(bodyHeading + missileEjectOffsetDeg(ammo?.ejectAngle, projectileId) * DEG)
    : targetHeading
  const distanceM = Math.hypot(target.x - muzzle.x, target.y - muzzle.y) * M_PER_CELL
  const speed = kind === 'missile' ? Math.max(0, ammo?.missileInitSpeed ?? combat.projectileSpeed) : Math.max(1, combat.projectileSpeed)
  const targetAltitude = currentUnitAltitude(target, runtimeEnemyUnitDef(target.unitDefId, target.kind))
  const sourceAltitude = currentUnitAltitude(ally, unit)
  ;(s.audioSignals ??= []).push({ id: s.nextId++, kind: 'unitFire', defId: unit.id, x: muzzle.x, y: muzzle.y, left: 0.25 })
  s.enemyProjectiles.push({
    id: projectileId, shooterId: ally.id,
    x: muzzle.x, y: muzzle.y, px: muzzle.x, py: muzzle.y, heading,
    pendingFirstFrame: true,
    speed, damage: combat.damage, penetration: combat.penetration,
    assetRef: ammo?.projectileAsset,
    ammoId: combat.projectileId, kind,
    armorPen: ammo?.armorPen, armorDamage: ammo?.armorDamage,
    blastRadius: ammo?.blastRadius, blastEffect: ammo?.blastEffect,
    t: 0, flightTime: kind === 'shell' ? Math.max(0.3, distanceM / Math.max(1, combat.projectileSpeed)) : undefined,
    sx: muzzle.x, sy: muzzle.y, tx: target.x, ty: target.y,
    guided: kind === 'missile' && !!ammo?.guided && !(ammo?.guideDelay && ammo.guideDelay > 0),
    willGuide: kind === 'missile' && !!ammo?.guided,
    guideDelayLeft: guideDelay > 0 ? guideDelay : undefined,
    guideDecel: ammo?.guideDecel, burnTime: ammo?.burnTime, missileCurve: ammo?.missileCurve,
    weavePhase: eventRandom(projectileId, 2) * TAU, split: ammo?.split,
    flightLeft: kind === 'missile' ? ammo?.missileFlightTime : undefined,
    missileAccel: ammo?.missileAccel, missileMaxSpeed: ammo?.missileMaxSpeed,
    missileTurnMax: ammo?.missileTurnMax, missileTurnAccel: ammo?.missileTurnAccel,
    turnRate: 0, tgtPX: kind === 'missile' && ammo?.guided ? target.x : undefined, tgtPY: kind === 'missile' && ammo?.guided ? target.y : undefined,
    igniteAtT: kind === 'missile' ? guideDelay : undefined,
    traveled: 0, maxTravel: combat.range * M_PER_CELL * 1.25,
    targetKind: 'combatUnit', targetSide: 'enemy', sourceSide: 'ally', targetId: target.id, targetX: target.x, targetY: target.y,
    sourceAltitude, targetAltitude, altitudeTravelM: distanceM,
  })
}

function stepScriptMove(entity: { x: number; y: number }, x: number, y: number, speed: number, dt: number): boolean {
  const dx = x - entity.x, dy = y - entity.y
  const distance = Math.hypot(dx, dy)
  if (distance <= 0.03) { entity.x = x; entity.y = y; return true }
  const step = Math.min(distance, speed * dt)
  entity.x += dx / distance * step
  entity.y += dy / distance * step
  return step >= distance - 1e-6
}

function updateTimedScript(script: UnitScriptRuntime, dt: number): boolean {
  script.left = Math.max(0, script.left - dt)
  if (script.left <= 0) { script.done = true; return true }
  return false
}

type ScriptAttackTarget = {
  kind: 'fortress' | 'combatUnit' | 'object'
  side?: 'enemy' | 'ally'
  id: number
  x: number
  y: number
  distance: number
}

function resolveScriptAttackTarget(
  s: GameState,
  source: { id: number; x: number; y: number },
  sourceFaction: LevelPlacedUnitFaction,
  targetSpec: Extract<LevelUnitCommand, { kind: 'attack' }>['target'],
): ScriptAttackTarget | null {
  if (targetSpec !== 'nearestHostile' && targetSpec.type === 'player') {
    if (s.fortress.hp <= 0 || s.fortress.dyingT >= 0) return null
    const center = fortressCenter(s)
    return { kind: 'fortress', id: 0, x: center.x, y: center.y, distance: fortressDistanceToPoint(s, source.x, source.y) }
  }
  if (targetSpec !== 'nearestHostile' && targetSpec.type === 'unit') {
    const enemy = s.enemies.find(unit => unit.placementId === targetSpec.placementId && unit.hp > 0)
    if (enemy) return { kind: 'combatUnit', side: 'enemy', id: enemy.id, x: enemy.x, y: enemy.y, distance: Math.hypot(enemy.x - source.x, enemy.y - source.y) }
    const ally = s.allies.find(unit => unit.placementId === targetSpec.placementId && unit.hp > 0)
    return ally ? { kind: 'combatUnit', side: 'ally', id: ally.id, x: ally.x, y: ally.y, distance: Math.hypot(ally.x - source.x, ally.y - source.y) } : null
  }
  if (targetSpec !== 'nearestHostile' && targetSpec.type === 'object') {
    let best: BattleObject | null = null
    let distance = Infinity
    for (const objectId of connectedObjectStateIds(targetSpec.objectId)) {
      const object = s.objects.find(item => item.id === objectId && item.hp !== 0)
      if (!object) continue
      const current = pointRectDistance(source.x, source.y, object.x, object.y, object.w, object.h)
      if (current < distance) { best = object; distance = current }
    }
    return best ? { kind: 'object', id: best.id, x: best.x + best.w / 2, y: best.y + best.h / 2, distance } : null
  }
  let best: Ally | Enemy | null = null
  let side: 'ally' | 'enemy' = 'ally'
  let distance = Infinity
  for (const ally of s.allies) {
    if (ally.hp <= 0 || ally.id === source.id || !factionsHostile(sourceFaction, ally.faction ?? 'ally')) continue
    const current = Math.hypot(ally.x - source.x, ally.y - source.y)
    if (current < distance) { distance = current; best = ally; side = 'ally' }
  }
  for (const enemy of s.enemies) {
    if (enemy.hp <= 0 || enemy.id === source.id || !factionsHostile(sourceFaction, enemy.faction ?? 'enemy')) continue
    const current = Math.hypot(enemy.x - source.x, enemy.y - source.y)
    if (current < distance) { distance = current; best = enemy; side = 'enemy' }
  }
  return best ? { kind: 'combatUnit', side, id: best.id, x: best.x, y: best.y, distance } : null
}

function updateEnemyScript(s: GameState, e: Enemy, unit: ReturnType<typeof runtimeEnemyUnitDef>, combat: UnitCombatStats, dt: number): boolean {
  const script = e.script
  if (!script || script.done) return false
  const command = script.command
  if (command.kind === 'move') {
    const tx = Math.max(0, Math.min(LEVEL.cols, command.x)), ty = Math.max(0, Math.min(LEVEL.rows, command.y))
    const speedScale = command.speed / Math.max(0.01, unit.stats.speed)
    if (!moveUnitAircraftToward(e, unit, tx, ty, dt, speedScale)
      && !moveUnitVehicleToward(s, e, unit, tx, ty, dt, speedScale)) stepScriptMove(e, tx, ty, command.speed, dt)
    script.done = Math.hypot(tx - e.x, ty - e.y) <= unitArrivalTolerance(unit, 0.03)
    syncUnitVehicleTurrets(e, unit)
    e.mode = 'move'; e.hasGoal = false
    return !script.done
  }
  if (command.kind === 'altitude') {
    script.done = Math.abs(currentUnitAltitude(e, unit) - e.aircraft!.targetAltitude) <= 1e-4
    return !script.done
  }
  if (command.kind === 'hold') return !updateTimedScript(script, dt)
  if (command.kind !== 'attack') return false
  if (updateTimedScript(script, dt)) return false

  const sourceFaction = e.faction ?? 'enemy'
  const target = resolveScriptAttackTarget(s, e, sourceFaction, command.target)
  if (!target) { script.done = true; return false }
  const range = Math.max(unitAttackProfile(unit) === 'melee' ? 0.8 : 0, combat.range)
  if (target.distance > range) {
    moveToward(s, e, target.x, target.y, dt, unit.stats.air)
    return true
  }
  if (unitTypeConfig(unit)?.kind === 'fixedWingAircraft') moveUnitAircraftToward(e, unit, target.x, target.y, dt, 0)
  e.mode = 'attack'; e.targetKind = target.kind === 'object' ? null : target.kind; e.targetId = target.id
  e.combatTargetSide = target.kind === 'fortress' ? 'fortress' : target.kind === 'combatUnit' ? target.side : undefined
  e.hasGoal = false
  e.attackCooldown = (e.attackCooldown ?? 0) - dt
  if (e.attackCooldown <= 0) {
    engagePlacementGroup(s, e)
    const damage = combat.damage * enemyAttackDamageMultiplier(e)
    if (combat.profile === 'projectile' && target.kind === 'fortress') enemyFireAt(s, e, combat, { kind: target.kind, id: target.id, x: target.x, y: target.y })
    else if (target.kind === 'fortress') damageFortress(s, damage, { x: e.x, y: e.y, kind: 'melee' })
    else if (target.kind === 'object') {
      const object = s.objects.find(value => value.id === target.id)
      if (object) damageObject(s, object, damage)
    }
    else {
      if (target.side === 'enemy') {
        const enemy = s.enemies.find(value => value.id === target!.id)
        if (enemy) damageEnemy(s, enemy, damage, null, { x: e.x, y: e.y, attackerSide: 'enemy', attackerId: e.id })
      } else {
        const ally = s.allies.find(value => value.id === target!.id)
        if (ally) damageAlly(s, ally, damage, { x: e.x, y: e.y, attackerSide: 'enemy', attackerId: e.id })
      }
    }
    e.attackCooldown = combat.interval
  }
  return true
}

function updateAllyScript(s: GameState, ally: Ally, unit: ReturnType<typeof runtimeAllyUnitDef>, combat: UnitCombatStats, dt: number): boolean {
  const script = ally.script
  if (!script || script.done) return false
  const command = script.command
  if (command.kind === 'move') {
    const tx = Math.max(0, Math.min(LEVEL.cols, command.x)), ty = Math.max(0, Math.min(LEVEL.rows, command.y))
    const speedScale = command.speed / Math.max(0.01, unit.stats.speed)
    if (!moveUnitAircraftToward(ally, unit, tx, ty, dt, speedScale)
      && !moveUnitVehicleToward(s, ally, unit, tx, ty, dt, speedScale)) stepScriptMove(ally, tx, ty, command.speed, dt)
    script.done = Math.hypot(tx - ally.x, ty - ally.y) <= unitArrivalTolerance(unit, 0.03)
    syncUnitVehicleTurrets(ally, unit)
    ally.targetId = null
    return !script.done
  }
  if (command.kind === 'altitude') {
    script.done = Math.abs(currentUnitAltitude(ally, unit) - ally.aircraft!.targetAltitude) <= 1e-4
    ally.targetId = null
    return !script.done
  }
  if (command.kind === 'hold') { ally.targetId = null; return !updateTimedScript(script, dt) }
  if (command.kind !== 'attack') return false
  if (updateTimedScript(script, dt)) return false

  const sourceFaction = ally.faction ?? 'ally'
  const target = resolveScriptAttackTarget(s, ally, sourceFaction, command.target)
  if (target) {
    ally.targetId = target.kind === 'combatUnit' ? target.id : null
    if (target.distance > combat.range) {
      moveAllyToward(s, ally, unit, target.x, target.y, unit.stats.speed, dt)
      syncUnitVehicleTurrets(ally, unit)
      return true
    }
    if (unitTypeConfig(unit)?.kind === 'fixedWingAircraft') moveUnitAircraftToward(ally, unit, target.x, target.y, dt, 0)
    ally.cooldown -= dt
    if (ally.cooldown <= 0) {
      ally.cooldown = combat.interval
      engagePlacementGroup(s, ally)
      if (target.kind === 'fortress') damageFortress(s, combat.damage, { x: ally.x, y: ally.y, kind: 'melee' })
      else if (target.kind === 'object') {
        const object = s.objects.find(value => value.id === target.id)
        if (object) damageObject(s, object, combat.damage)
      } else if (target.side === 'enemy') {
        const enemy = s.enemies.find(value => value.id === target.id)
        if (enemy) damageEnemy(s, enemy, combat.damage, null, { x: ally.x, y: ally.y, attackerSide: 'ally', attackerId: ally.id })
      } else {
        const other = s.allies.find(value => value.id === target.id)
        if (other) damageAlly(s, other, combat.damage, { x: ally.x, y: ally.y, attackerSide: 'ally', attackerId: ally.id })
      }
    }
    return true
  }
  script.done = true
  return false
}

/** 敌方自爆范围伤害：波及所有玩家设施、移动堡垒、友方/中立单位与可破坏物体，但不伤同阵营敌人。 */
function enemyKamikazeBlast(s: GameState, e: Enemy, combat: UnitCombatStats, damageScale: number): void {
  engagePlacementGroup(s, e)
  const radius = Math.max(0.05, combat.kamikaze?.radius ?? 1.5)
  const damage = Math.max(0, combat.damage * damageScale * enemyAttackDamageMultiplier(e))
  s.explosions.push({ id: s.nextId++, x: e.x, y: e.y, r: radius, ttl: 0.45, max: 0.45 })
  addFloat(s, e.x, e.y, damageScale < 1 ? '半额自爆' : '自爆')
  if (damage <= 0) return

  if (fortressDistanceToPoint(s, e.x, e.y) <= radius) {
    damageFortress(s, damage, { x: e.x, y: e.y, kind: 'aoe' })
  }
  const core = s.core
  if (core && core.hp > 0 && pointRectDistance(e.x, e.y, core.x, core.y, core.w, core.h) <= radius) damageCore(s, damage)
  for (const building of [...s.buildings]) {
    if (pointRectDistance(e.x, e.y, building.x, building.y, building.w, building.h) <= radius) damageBuilding(s, building, damage)
  }
  for (const wall of [...s.walls]) {
    if (wall.state !== 'destroyed' && wall.cells.some(cell => pointRectDistance(e.x, e.y, cell.x, cell.y, 1, 1) <= radius)) damageWall(s, wall, damage)
  }
  for (const turret of [...s.turrets]) {
    if (pointRectDistance(e.x, e.y, turret.x, turret.y, turret.w, turret.h) <= radius) damageTurret(s, turret, damage)
  }
  for (const ally of s.allies) {
    const unit = runtimeAllyUnitDef(ally.unitDefId, ally.kind)
    if (ally.hp > 0 && Math.hypot(ally.x - e.x, ally.y - e.y) <= radius + unitRadiusToward(unit, ally.x - e.x, ally.y - e.y)) {
      damageAlly(s, ally, damage, { x: e.x, y: e.y, armorPen: 1 })
    }
  }
  for (const object of [...s.objects]) {
    if (object.hp >= 0 && pointRectDistance(e.x, e.y, object.x, object.y, object.w, object.h) <= radius) damageObject(s, object, damage)
  }
}

function resolveEnemyKamikaze(s: GameState, e: Enemy, combat: UnitCombatStats, damageScale: number, arrival: boolean): void {
  if (e.kamikazeResolved) return
  e.kamikazeResolved = true
  e.kamikazeArrival = arrival
  e.hp = 0
  if (damageScale > 0) enemyKamikazeBlast(s, e, combat, damageScale)
}

const { updateEnemy } = createEnemyCombatAI({
  factionsHostile,
  unitCanSeePoint,
  fortressCenter,
  fortressDistanceToPoint,
  unitRadiusToward,
  currentUnitAltitude,
  turretDefById: defOf,
  moveEnemyFree,
  moveToward,
  moveUnitAircraftToward,
  enemyDealDamage,
  enemyFireAt,
  resolveEnemyKamikaze,
  updateEnemyScript,
  updateUnitDeployForces,
  placementBodyLocks,
  updatePlacementBehavior,
  updateArmedEnemyVehicleMovement,
  vehicleObjectClearanceHeight,
  computePathField,
  followPath,
})

// ================= 炮塔行为（炮塔文档 §4–§6） =================

// v2.22：人员/最少人员参数已删除——炮塔不再需要人员运转，原 §6.1 人员减益（crewFactor）移除，效率系数恒 1

// lastDt：aim/旋转步长使用的本帧 dt（updateTurrets 入口设置）
let lastDt = 0.1

function accuracyOffset(eventId: number, radiusM: number): { dx: number; dy: number } {
  // §6.3：以瞄准点为圆心、精度值为半径随机取命中点
  if (radiusM <= 0) return { dx: 0, dy: 0 }
  const a = eventRandom(eventId, 0) * TAU
  const r = Math.sqrt(eventRandom(eventId, 1)) * m2c(radiusM)
  return { dx: Math.cos(a) * r, dy: Math.sin(a) * r }
}

/** art 配置坐标（相对炮塔原点，炮口朝上基准系：x 向右为正、y 向上=沿炮口方向为正，单位格）→ 世界坐标（随 t.angle 旋转）。
 * 炮塔原点永远是运行时几何中心；art.anchor 只描述炮身贴图相对原点的轴心位置，
 * 不得再改变炮位、索敌或弹丸出生点。 */
export function artPoint(t: Turret, def: TurretDef, pt: readonly [number, number]): { x: number; y: number } {
  void def
  const { x: ax, y: ay } = turretCenter(t)
  const dx = dirX(t.angle)
  const dy = dirY(t.angle)
  const px = -dy // 面向炮口时的右手边（屏幕顺时针 90°）
  const py = dx
  return { x: ax + px * pt[0] + dx * pt[1], y: ay + py * pt[0] + dy * pt[1] }
}

/** 炮塔渲染层级键（按升序绘制，靠后者叠在上）：尺寸按 S/M/L 排序，
 *  同尺寸按挂载炮位 zLevel（缺省 1，越大越高）；地面炮塔 zLevel 视为 1。
 *  配合稳定排序：同键保持放置先后顺序。 */
export function turretRenderKey(s: GameState, t: Turret): [number, number] {
  const model = defOf(t.defId).mount
  const rank = model === 'L' ? 2 : model === 'M' ? 1 : 0
  const z = t.hardpointId != null ? (hardpointOf(s, t.hardpointId)?.zLevel ?? 1) : 1
  return [rank, z]
}

const artMismatchWarned = new Set<string>()

/** 炮管口位置：逻辑炮管数是唯一数量来源；art.barrels 只覆盖对应序号的美术坐标。 */
/** 有效挂点表始终与逻辑炮管数等长；多余美术项忽略，缺少项自动生成。 */
export function artMounts(t: Turret, def: TurretDef): { mount: [number, number]; muzzle: [number, number]; recoil: number }[] {
  const cfg = def.art?.barrels
  const uni = def.art?.recoil // v1.58 统一后坐：全管共用，优先于遗留逐管 recoil
  const n = Math.max(1, Math.floor(def.barrels ?? 1))
  const spread = t.w * 0.6
  return Array.from({ length: n }, (_, i) => {
    const configured = cfg?.[i]
    if (configured) return { mount: configured.mount, muzzle: configured.muzzle, recoil: uni ?? configured.recoil ?? 0.1 }
    const lat = n <= 1 ? 0 : (i - (n - 1) / 2) * (spread / (n - 1))
    return { mount: [lat, 0] as [number, number], muzzle: [lat, 0.35] as [number, number], recoil: uni ?? 0.1 }
  })
}

export const RACK_RELOAD_ANIM = 0.25 // 复挂渐显时长（秒）；普通导弹同期推入，垂发导弹保持原位
const RACK_SLOT_SPACING = 0.34 * 0.48 // 挂载弹逐枚向后间距（格；= 弹宽×1.2 同 render 规则）

/** 挂载弹世界坐标（引擎/渲染共享，消除两套公式漂移）：挂点 + rack.dx/dy 偏移 + slot 向后间距，随炮塔旋转 */
export function rackMissilePos(t: Turret, def: TurretDef, barrelIdx: number, slot: number): { x: number; y: number } {
  const mounts = artMounts(t, def)
  const b = mounts[barrelIdx % mounts.length]
  const dx = def.art?.rack?.dx ?? 0
  const dy = def.art?.rack?.dy ?? 0.12
  return artPoint(t, def, [b.mount[0] + dx, b.mount[1] + dy - slot * RACK_SLOT_SPACING])
}

/** 挂载显示：每管待发弹数（rackLeft 均分；轮流模式从 barrelIdx 侧开始扣余数——当前管优先消耗先空） */
export function rackCounts(t: Turret, def: TurretDef, nBar: number): number[] {
  const per = Math.floor(t.rackLeft / nBar)
  const extra = t.rackLeft % nBar
  const start = (def.barrelMode ?? 'salvo') === 'sequential' ? t.barrelIdx : 0
  return Array.from({ length: nBar }, (_, bi) => per + (((bi - start) % nBar + nBar) % nBar < extra ? 1 : 0))
}

export function muzzlePos(t: Turret, def: TurretDef, barrelIdx: number): { x: number; y: number } {
  const n = Math.max(1, Math.floor(def.barrels ?? 1))
  const artBarrels = def.art?.barrels
  if (artBarrels && artBarrels.length !== n && !artMismatchWarned.has(def.id)) {
    artMismatchWarned.add(def.id)
    console.warn(`[art] 炮塔 ${def.id} 挂点表数量(${artBarrels.length})与逻辑炮管数(${n})不一致：多余项忽略，缺少项自动生成`)
  }
  const mounts = artMounts(t, def)
  const normalizedIndex = ((barrelIdx % mounts.length) + mounts.length) % mounts.length
  return artPoint(t, def, mounts[normalizedIndex].muzzle)
}

function fireGunShot(s: GameState, t: Turret, def: TurretDef, target: PlayerTurretTarget, dt: number, muzzle?: { x: number; y: number }) {
  const c = muzzle ?? turretCenter(t)
  const lvl = t.level
  const scale = levelScale(lvl)
  const missileTarget = isInterceptableMissileTarget(target)
  const targetAltitude = missileTarget ? target.altitude : currentUnitAltitude(target, runtimeEnemyUnitDef(target.unitDefId, target.kind))
  const targetPoint = missileTarget && def.type === 'direct' ? interceptLeadPoint(c, target, def.projectileSpeed ?? 25.6) : target
  const targetDistanceM = Math.hypot(targetPoint.x - c.x, targetPoint.y - c.y) * M_PER_CELL
  if (def.type === 'direct') {
    const off = accuracyOffset(s.nextId, def.accuracy ?? 0)
    const ax = targetPoint.x + off.dx
    const ay = targetPoint.y + off.dy
    const h = bearing(ax - c.x, ay - c.y)
    // v1.79：开火（tick 步骤4）先于弹道推进（步骤5），同 tick 内弹丸会被立刻前移 v·dt——
    // 弹速越快首帧离炮口越远（51.2m/s × 0.1s = 1.6格）。出生点沿弹道反向预偏一个 tick 行程，
    // 首帧渲染恰好位于炮口；traveled 负初始化保持射程口径（traveled>maxTravel 消亡点）不变。
    const stepM = (def.projectileSpeed ?? 25.6) * dt
    const bx = c.x - dirX(h) * m2c(stepM)
    const by = c.y - dirY(h) * m2c(stepM)
    s.projectiles.push({
      id: s.nextId++, kind: 'bullet', defId: t.defId, level: lvl,
      x: bx, y: by, px: bx, py: by, heading: h,
      damage: def.damage * scale, traveled: -stepM, maxTravel: def.rangeMax + M_PER_CELL,
      shooter: t.id, hitIds: [],
      sourceAltitude: 0, targetAltitude, altitudeTravelM: targetDistanceM,
      t: 0, flightTime: 0, sx: 0, sy: 0, tx: 0, ty: 0,
      speed: 0, turnRate: 0, guided: false, targetId: null, lockX: 0, lockY: 0, lostLock: false, prevDist: -1,
      weavePhase: 0,
    })
    // 直射弹丸不推发射曳光线：弹丸尾迹由 render 按弹丸美术配置绘制（v2.46：无尾焰配置=无尾迹），
    // 发射瞬间到目标点的整条直线会造成"先拉一条直线再出子弹"的视觉 bug
  } else if (missileTarget) {
    return
  } else if (def.type === 'lob') {
    const off = accuracyOffset(s.nextId, def.accuracy ?? 0)
    const tx = target.x + off.dx
    const ty = target.y + off.dy
    const distM = Math.hypot(tx - c.x, ty - c.y) * M_PER_CELL
    s.projectiles.push({
      id: s.nextId++, kind: 'shell', defId: t.defId, level: lvl,
      x: c.x, y: c.y, px: c.x, py: c.y, heading: 0,
      damage: def.damage * scale, traveled: 0, maxTravel: 0,
      shooter: t.id, hitIds: [],
      t: 0, flightTime: Math.max(0.3, distM / (def.projectileSpeed ?? 7.68)),
      sx: c.x, sy: c.y, tx, ty,
      speed: 0, turnRate: 0, guided: false, targetId: null, lockX: 0, lockY: 0, lostLock: false, prevDist: -1,
      weavePhase: 0,
    })
  } else if (def.type === 'missile') {
    let guided = !!def.guided
    const off = guided ? { dx: 0, dy: 0 } : accuracyOffset(s.nextId, def.accuracy ?? 0)
    // §6.4：非制导发射瞬间锁定落点坐标，之后不再修正
    let lockX = target.x + off.dx
    let lockY = target.y + off.dy
    // 发射时检查：炮口→目标线段穿过阻挡弹道物体，且目标刚好在物体后面（格距 ≤1）
    // => 导弹被物体阻挡，直飞物体位置爆炸并结算物体耐久；否则完全越过物体（飞行途中无碰撞）
    const blockAt = missileBlockPoint(s, c.x, c.y, lockX, lockY, 0, targetAltitude)
    if (blockAt) {
      lockX = blockAt.x
      lockY = blockAt.y
      guided = false // 退化为直飞撞击点
    }
    // v1.94 延迟制导：guided + guideDelay>0 → 发射航向取炮塔方向（t.angle），延迟期内直飞不追踪
    const delay94 = guided ? Math.max(0, Math.min(2, def.guideDelay ?? 0)) : 0
    const missileId = s.nextId++
    // 出膛偏角是总随机区间：例如 20° 表示每发在炮塔方向 -10°～+10° 内确定性取样。
    let h = delay94 > 0 ? wrapAngle(t.angle + missileEjectOffsetDeg(def.ejectAngle, missileId) * DEG) : bearing(lockX - c.x, lockY - c.y)
    let speed0 = Math.max(0, def.missileInitSpeed ?? 0)
    // v2.33 载体速度继承：堡垒挂载炮塔（hardpointId）发射的导弹，出生速度向量 += 堡垒移动速度（格/s→m/s），
    // 合成后折回 航向+标量初速（点火制导后仍完全自驱动，与现状一致；地面炮塔不继承）
    if (t.hardpointId) {
      const fvx = s.fortress.vx * M_PER_CELL
      const fvy = s.fortress.vy * M_PER_CELL
      if (fvx !== 0 || fvy !== 0) {
        const vx = dirX(h) * speed0 + fvx
        const vy = dirY(h) * speed0 + fvy
        const v0 = Math.hypot(vx, vy)
        if (v0 > 1e-6) { speed0 = v0; h = bearing(vx, vy) } // 抵消归零时保持原航向
      }
    }
    s.projectiles.push({
      id: missileId, kind: 'missile', defId: t.defId, level: lvl,
      x: c.x, y: c.y, px: c.x, py: c.y, heading: h,
      damage: def.damage * scale, traveled: 0, maxTravel: def.rangeMax * 1.3,
      shooter: t.id, hitIds: [],
      sourceAltitude: 0, targetAltitude, altitudeTravelM: targetDistanceM,
      t: 0, flightTime: 0, sx: c.x, sy: c.y, tx: 0, ty: 0,
      speed: speed0, turnRate: 0, guided: delay94 > 0 ? false : guided, targetId: guided ? target.id : null, // v1.96：出生初速度（缺省 0）；v2.33：挂载弹含载体速度合成
      lockX, lockY, lostLock: false, prevDist: -1,
      flightLeft: def.missileFlightTime, // 未配置则为 undefined（不限飞行时间）
      weavePhase: eventRandom(missileId, 2) * TAU, // 曲线摆动相位（按事件 id 确定性派生）
      guideDelayLeft: delay94 > 0 ? delay94 : undefined, // v1.94：仅延迟制导弹携带
      tgtPX: guided ? target.x : undefined, tgtPY: guided ? target.y : undefined, // v2.20 前置量追踪：速度采样基线
      igniteAtT: delay94, // v2.23：点火时刻弹龄（无延迟=0=出生即点火）
    })
  }
}

/** 导弹阻挡判定：炮口→目标线段上首个阻挡弹道物体，且目标格紧邻该物体（沿线格距 ≤1）时返回撞击点 */
function missileBlockPoint(s: GameState, x1: number, y1: number, x2: number, y2: number, sourceAltitude = 0, targetAltitude = 0): { x: number; y: number } | null {
  const d = Math.hypot(x2 - x1, y2 - y1)
  if (d < 1e-6) return null
  const tx = Math.floor(x2)
  const ty = Math.floor(y2)
  for (let l = 0.2; l < d; l += 0.2) {
    const px = x1 + (x2 - x1) / d * l
    const py = y1 + (y2 - y1) / d * l
    const altitude = sourceAltitude + (targetAltitude - sourceAltitude) * Math.max(0, Math.min(1, l / d))
    const o = projectileBlockerAt(s, Math.floor(px), Math.floor(py), { kind: 'missile', altitude })
    if (!o) continue
    // 目标刚好在物体后面：目标格与物体矩形沿线的格距 ≤ 物体高度 height
    const gdx = Math.max(o.x - tx, 0, tx - (o.x + o.w - 1))
    const gdy = Math.max(o.y - ty, 0, ty - (o.y + o.h - 1))
    if (Math.hypot(gdx, gdy) <= heightLevel(o.height)) return { x: px, y: py }
    // 目标远离该物体：越过它继续检查（导弹一般可越过阻挡弹道的物体）
  }
  return null
}

/** 光束推进：矩形在首个阻挡弹道物体格截断，返回长度与截断物体（§7.2 新口径：仅物体挡弹道） */
function turretRuntimeTargetAltitude(s: GameState, turret: Turret): number {
  if (turret.targetId == null) return 0
  if (turret.targetMissilePool) {
    const target = interceptableMissileTargets(s, turretRuntimeFaction(s, turret)).find(item => item.pool === turret.targetMissilePool && item.id === turret.targetId)
    return target?.altitude ?? 0
  }
  const enemy = s.enemies.find(item => item.id === turret.targetId && item.hp > 0)
  if (enemy) return currentUnitAltitude(enemy, runtimeEnemyUnitDef(enemy.unitDefId, enemy.kind))
  const ally = s.allies.find(item => item.id === turret.targetId && item.hp > 0)
  return ally ? currentUnitAltitude(ally, runtimeAllyUnitDef(ally.unitDefId, ally.kind)) : 0
}

function turretRuntimeFaction(s: GameState, turret: Turret): LevelPlacedUnitFaction {
  const enemy = s.enemies.find(item => item.vehicle?.turrets?.some(value => value.id === turret.id))
  if (enemy) return enemy.faction ?? 'enemy'
  const ally = s.allies.find(item => item.vehicle?.turrets?.some(value => value.id === turret.id))
  return ally?.faction ?? 'player'
}

function turretRuntimeSourceAltitude(s: GameState, turret: Turret): number {
  const enemy = s.enemies.find(item => item.vehicle?.turrets?.some(value => value.id === turret.id))
  if (enemy) return currentUnitAltitude(enemy, runtimeEnemyUnitDef(enemy.unitDefId, enemy.kind))
  const ally = s.allies.find(item => item.vehicle?.turrets?.some(value => value.id === turret.id))
  return ally ? currentUnitAltitude(ally, runtimeAllyUnitDef(ally.unitDefId, ally.kind)) : 0
}

function segmentAabbEntry(
  x1: number, y1: number, x2: number, y2: number,
  minX: number, minY: number, maxX: number, maxY: number,
  padding = 0,
): number | null {
  let enter = 0, exit = 1
  for (const [origin, delta, lo, hi] of [
    [x1, x2 - x1, minX - padding, maxX + padding],
    [y1, y2 - y1, minY - padding, maxY + padding],
  ] as const) {
    if (Math.abs(delta) < 1e-9) {
      if (origin < lo || origin > hi) return null
      continue
    }
    let near = (lo - origin) / delta, far = (hi - origin) / delta
    if (near > far) [near, far] = [far, near]
    enter = Math.max(enter, near)
    exit = Math.min(exit, far)
    if (enter > exit) return null
  }
  return enter >= 0 && enter <= 1 ? enter : null
}

interface BeamUnitTarget {
  host: Enemy | Ally
  def: UnitDef
}

/** 按阵营解析炮塔当前锁定的战斗单位；避免敌我数组中同号实例造成串目标。 */
function turretRuntimeTargetUnit(s: GameState, turret: Turret): BeamUnitTarget | null {
  if (turret.targetId == null || turret.targetMissilePool) return null
  const ownerFaction = turretRuntimeFaction(s, turret)
  const candidates: BeamUnitTarget[] = []
  for (const enemy of s.enemies) {
    if (enemy.id !== turret.targetId || enemy.hp <= 0 || !factionsHostile(ownerFaction, enemy.faction ?? 'enemy')) continue
    candidates.push({ host: enemy, def: runtimeEnemyUnitDef(enemy.unitDefId, enemy.kind) })
  }
  for (const ally of s.allies) {
    if (ally.id !== turret.targetId || ally.hp <= 0 || !factionsHostile(ownerFaction, ally.faction ?? 'ally')) continue
    candidates.push({ host: ally, def: runtimeAllyUnitDef(ally.unitDefId, ally.kind) })
  }
  if (candidates.length <= 1) return candidates[0] ?? null
  const c = muzzlePos(turret, defOf(turret.defId), 0)
  return candidates.reduce((best, candidate) => {
    const score = Math.abs(wrapAngle(bearing(candidate.host.x - c.x, candidate.host.y - c.y) - turret.angle))
    const bestScore = Math.abs(wrapAngle(bearing(best.host.x - c.x, best.host.y - c.y) - turret.angle))
    return score < bestScore ? candidate : best
  })
}

/** 当前锁定目标与射线的首次相交长度；单位使用实际主体形状，建筑使用实体矩形。 */
function beamTargetEntryLength(s: GameState, turret: Turret, x: number, y: number, maxLen: number): number | null {
  if (turret.targetId == null) return null
  const endX = x + dirX(turret.angle) * maxLen
  const endY = y + dirY(turret.angle) * maxLen
  if (turret.targetMissilePool) {
    const missile = interceptableMissileTargets(s, turretRuntimeFaction(s, turret))
      .find(item => item.pool === turret.targetMissilePool && item.id === turret.targetId)
    if (!missile) return null
    const entry = segmentCircleEntry(x, y, endX, endY, missile.x, missile.y, MISSILE_INTERCEPT_RADIUS)
    return entry === null ? null : maxLen * entry
  }
  const unit = turretRuntimeTargetUnit(s, turret)
  if (unit) {
    const entry = segmentUnitShapeEntry(x, y, endX, endY, unit.host, unit.def)
    return entry === null ? null : maxLen * entry
  }
  const ownerFaction = turretRuntimeFaction(s, turret)
  if (turret.targetId === 0 && factionsHostile(ownerFaction, 'player') && s.fortress.hp > 0 && s.fortress.dyingT < 0) {
    const hit = enemyProjectileFortressHit(s, x, y, endX, endY)
    return hit ? Math.hypot(hit.x - x, hit.y - y) : null
  }
  if (s.core?.id === turret.targetId && s.core.hp > 0) {
    const entry = segmentAabbEntry(x, y, endX, endY, s.core.x, s.core.y, s.core.x + s.core.w, s.core.y + s.core.h)
    return entry === null ? null : maxLen * entry
  }
  const building = s.buildings.find(item => item.id === turret.targetId && item.hp > 0)
  if (building) {
    const entry = segmentAabbEntry(x, y, endX, endY, building.x, building.y, building.x + building.w, building.y + building.h)
    return entry === null ? null : maxLen * entry
  }
  const wall = s.walls.find(item => item.id === turret.targetId && item.hp > 0 && item.state !== 'destroyed')
  const cell = wall?.cells[0]
  if (cell) {
    const entry = segmentAabbEntry(x, y, endX, endY, cell.x, cell.y, cell.x + 1, cell.y + 1)
    return entry === null ? null : maxLen * entry
  }
  return null
}

/** 射线段是否真正进入目标实体；宽幅作为主体外扩，而不是仅用目标中心近似。 */
function beamSegmentHitsTarget(
  s: GameState, target: Pick<EnemyMountedTurretTarget, 'kind' | 'id' | 'side'>,
  x1: number, y1: number, x2: number, y2: number, padding: number,
): boolean {
  if (target.kind === 'combatUnit') {
    if (target.side === 'enemy') {
      const enemy = s.enemies.find(item => item.id === target.id && item.hp > 0)
      return !!enemy && segmentUnitShapeEntry(x1, y1, x2, y2, enemy, runtimeEnemyUnitDef(enemy.unitDefId, enemy.kind), padding) !== null
    }
    const ally = s.allies.find(item => item.id === target.id && item.hp > 0)
    return !!ally && segmentUnitShapeEntry(x1, y1, x2, y2, ally, runtimeAllyUnitDef(ally.unitDefId, ally.kind), padding) !== null
  }
  if (target.kind === 'fortress') return enemyProjectileFortressHit(s, x1, y1, x2, y2) !== null
  if (target.kind === 'coreBuilding') {
    const core = s.core
    return !!core && core.id === target.id && core.hp > 0
      && segmentAabbEntry(x1, y1, x2, y2, core.x, core.y, core.x + core.w, core.y + core.h, padding) !== null
  }
  if (target.kind === 'fixedBuilding') {
    const building = s.buildings.find(item => item.id === target.id && item.hp > 0)
    return !!building && segmentAabbEntry(x1, y1, x2, y2, building.x, building.y, building.x + building.w, building.y + building.h, padding) !== null
  }
  if (target.kind === 'wall') {
    const wall = s.walls.find(item => item.id === target.id && item.hp > 0 && item.state !== 'destroyed')
    const cell = wall?.cells[0]
    return !!cell && segmentAabbEntry(x1, y1, x2, y2, cell.x, cell.y, cell.x + 1, cell.y + 1, padding) !== null
  }
  return false
}

export function beamMarch(s: GameState, t: Turret, def: TurretDef): { len: number; blocker: BattleObject | null } {
  // 渲染、阻挡、伤害与命中特效统一从 0 号炮口出发，避免炮塔中心与炮口偏移造成端点错位。
  const c = muzzlePos(t, def, 0)
  const sourceAltitude = turretRuntimeSourceAltitude(s, t)
  const targetAltitude = turretRuntimeTargetAltitude(s, t)
  const missileTarget = t.targetId == null || !t.targetMissilePool
    ? undefined
    : interceptableMissileTargets(s, turretRuntimeFaction(s, t)).find(item => item.pool === t.targetMissilePool && item.id === t.targetId)
  const targetEntity = missileTarget ?? (t.targetId == null ? undefined : s.enemies.find(item => item.id === t.targetId) ?? s.allies.find(item => item.id === t.targetId))
  const targetDistance = targetEntity ? Math.max(1e-6, Math.hypot(targetEntity.x - c.x, targetEntity.y - c.y)) : m2c(def.rangeMax)
  const rangeC = m2c(def.rangeMax)
  // 锁定实体时射线只延伸到实际主体轮廓，不再穿过目标继续画到最大射程。
  const targetEntry = beamTargetEntryLength(s, t, c.x, c.y, rangeC)
  // 仅向主体内推进一个不可见的小量，消除浮点边界使伤害线段恰好停在轮廓外的问题。
  const maxC = Math.min(rangeC, targetEntry === null ? rangeC : targetEntry + 1e-4)
  const stepLen = 0.2
  let len = 0
  while (len < maxC) {
    len = Math.min(maxC, len + stepLen)
    const x = Math.floor(c.x + dirX(t.angle) * len)
    const y = Math.floor(c.y + dirY(t.angle) * len)
    if (x < 0 || x >= LEVEL.cols || y < 0 || y >= LEVEL.rows) break
    const progress = Math.max(0, Math.min(1, len / targetDistance))
    const altitude = sourceAltitude + (targetAltitude - sourceAltitude) * progress
    const o = projectileBlockerAt(s, x, y, { kind: 'ray', altitude })
    if (o) return { len: Math.max(0, len - stepLen), blocker: o }
  }
  return { len: Math.max(0, len), blocker: null }
}

/** 射线矩形端点长度（格）：被阻挡弹道的物体截断 */
export const BEAM_ON_SPEED = 307.2 // 光束起射伸展速度（m/s；保持旧版 96 格/s 的视觉与伤害伸展速度）

/** 光束当前长度（格）：beamMarch 截断全长 × 起射伸展 ramp（beamOnAt 起按 BEAM_ON_SPEED 伸展，到位后恒=全长） */
export function beamLength(s: GameState, t: Turret, def: TurretDef): number {
  const full = beamMarch(s, t, def).len
  if (t.beamOnAt === undefined) return full
  return Math.min(full, m2c((s.time - t.beamOnAt) * BEAM_ON_SPEED))
}

function beamTick(s: GameState, t: Turret, def: TurretDef) {
  const c = muzzlePos(t, def, 0)
  const march = beamMarch(s, t, def)
  const len = beamLength(s, t, def) // v2.35：伤害范围随起射伸展 ramp（伸展未到的区段不结算）
  const blocker = len >= march.len - 1e-9 ? march.blocker : null // 伸展未触及截断物体时不结算其耐久
  const halfW = m2c(def.beamWidth ?? 0.256) / 2
  const dot = def.dot!
  const scale = levelScale(t.level)
  const ammo = PROJECTILE_ARTS.find(item => item.id === def.art?.projectile)
  const targetAltitude = turretRuntimeTargetAltitude(s, t)
  const endX = c.x + dirX(t.angle) * len, endY = c.y + dirY(t.angle) * len
  for (const e of s.enemies) {
    const unit = runtimeEnemyUnitDef(e.unitDefId, e.kind)
    if (Math.abs(currentUnitAltitude(e, unit) - targetAltitude) > 0.55) continue
    if (segmentUnitShapeEntry(c.x, c.y, endX, endY, e, unit, halfW) !== null) {
      damageEnemy(s, e, dot.damage * scale, t.id, {
        x: c.x, y: c.y, penetration: ammo?.penetration, armorPen: def.armorPen, armorDamage: def.armorDamage,
        ammoId: def.art?.projectile, projectileSize: GEOMETRIC_BULLET_VISUAL_SIZE,
        incomingDx: dirX(t.angle), incomingDy: dirY(t.angle),
      })
    }
  }
  if (def.canInterceptMissile && !def.tags?.some(tag => tag.kind === 'exclude' && tag.key === 'missile')) {
    for (const missile of interceptableMissileTargets(s, 'player')) {
      const dx = missile.x - c.x, dy = missile.y - c.y
      const along = dx * dirX(t.angle) + dy * dirY(t.angle)
      const perp = Math.abs(dx * -dirY(t.angle) + dy * dirX(t.angle))
      if (along < 0 || along > len || perp > halfW + MISSILE_INTERCEPT_RADIUS) continue
      if (Math.abs(missile.altitude - targetAltitude) > 0.55) continue
      applyMissileInterceptionDamage(s, missile.pool, missile.id, dot.damage * scale)
    }
  }
  // 每个伤害 tick 同时对截断光束的物体扣耐久（hp=-1 物体在 damageObject 内豁免）
  if (blocker) damageObject(s, blocker, dot.damage * scale)
  // v2.7：光束 DoT 端点命中特效（与点射共用弹丸库 ray 条目 impact 参数；无配置不产生事件=现状）
  if (def.art?.projectile) {
    addImpact(s, c.x + dirX(t.angle) * len, c.y + dirY(t.angle) * len, def.art.projectile, dirX(t.angle), dirY(t.angle), targetAltitude)
  }
}

function sprayTick(s: GameState, t: Turret, def: TurretDef) {
  const c = turretCenter(t)
  const rC = m2c(def.rangeMax)
  const halfA = (def.sprayAngle ?? 60) * DEG / 2
  const dot = def.dot!
  const scale = levelScale(t.level)
  const ammo = PROJECTILE_ARTS.find(item => item.id === def.art?.projectile)
  for (const e of s.enemies) {
    if (runtimeEnemyUnitDef(e.unitDefId, e.kind).stats.air && !def.canAir) continue
    const dx = e.x - c.x
    const dy = e.y - c.y
    const dE = Math.hypot(dx, dy)
    const unit = runtimeEnemyUnitDef(e.unitDefId, e.kind)
    const altitude = currentUnitAltitude(e, unit)
    if (dE > rC + unitRadiusToward(unit, dx, dy)) continue
    if (Math.abs(wrapAngle(bearing(dx, dy) - t.angle)) > halfA) continue
    // 喷射在首个阻挡弹道物体格截断：物体后方的敌人不被命中
    let shielded = false
    for (let l = 0.2; l < dE; l += 0.2) {
      const rayAltitude = altitude * Math.max(0, Math.min(1, l / dE))
      if (projectileBlockerAt(s, Math.floor(c.x + dx / dE * l), Math.floor(c.y + dy / dE * l), { kind: 'spray', altitude: rayAltitude })) {
        shielded = true
        break
      }
    }
    if (!shielded) damageEnemy(s, e, dot.damage * scale, t.id, {
      x: c.x, y: c.y, penetration: ammo?.penetration, armorPen: def.armorPen, armorDamage: def.armorDamage,
      ammoId: def.art?.projectile, projectileSize: GEOMETRIC_BULLET_VISUAL_SIZE,
      incomingDx: dx, incomingDy: dy,
    })
  }
  // 扇形内阻挡弹道的物体按 tick 扣耐久（hp=-1 豁免）
  for (const o of s.objects) {
    if (!o.blockProjectile || o.hp <= 0) continue
    const odx = o.x + o.w / 2 - c.x
    const ody = o.y + o.h / 2 - c.y
    if (Math.hypot(odx, ody) > rC + Math.max(o.w, o.h) / 2) continue
    if (Math.abs(wrapAngle(bearing(odx, ody) - t.angle)) <= halfA) damageObject(s, o, dot.damage * scale)
  }
}

/** 炮塔 tick 包装：热量已汇聚到堡垒（coolFortress 统一散热）；此处仅保留光束停火消退表现 */
function updateTurret(s: GameState, t: Turret, dt: number) {
  const def = defOf(t.defId)
  const wasFiring = t.firing // 持续型（光束/喷射）射击中
  if (t.autoFire === false) {
    // 关闭自动开火后解除锁定，并按炮塔原转速回到炮位初始相对朝向。
    // 挂载炮塔的“原始朝向”随当前车头旋转；地面炮塔则恒为世界上方。
    t.targetId = null
    t.targetMissilePool = undefined
    const rest = aimRestAngle(s, t)
    const diff = wrapAngle(rest - t.angle)
    const rotateStep = Math.max(0, def.rotateSpeed) * DEG * dt
    t.angle = rotateStep > 0
      ? wrapAngle(t.angle + Math.sign(diff) * Math.min(Math.abs(diff), rotateStep))
      : rest
  }
  updateTurretBody(s, t, dt)
  // v2.35 光束起射伸展（firing 转换沿 false→true 记起射时刻）：点射不触发
  if (!wasFiring && t.firing && def.type === 'beam') t.beamOnAt = s.time
  // 光束停火消退（firing 转换沿 true→false 推一次）：覆盖持续结束/目标丢失/资源中断/过热；点射与未起射不触发
  if (wasFiring && !t.firing && def.type === 'beam') {
    const c = muzzlePos(t, def, 0) // 与光束起点同规则
    s.beamFades.push({
      id: s.nextId++, defId: t.defId, x: c.x, y: c.y, angle: t.angle,
      len: beamLength(s, t, def), width: def.beamWidth, mode: def.beamFadeMode ?? 'shrink', // v2.50：不再 ?? 8——保留 undefined 以区分"未配置宽幅"（消退段贴图原生高度）
      ttl: BEAM_FADE, max: BEAM_FADE,
    })
    t.beamOnAt = undefined // v2.35：停火清除起射锚点（消退段长度已快照）
  }
}


/** v2.49 资源标签门控（硬开关）：任一 resource 标签条件成立 → 禁止开火。阈值均为占上限百分比 0-100 */
function resourceHold(s: GameState, turret: Turret, def: TurretDef): boolean {
  if (!def.tags?.some(tg => tg.kind === 'resource')) return false
  const caps = playerTurretResourceCaps(def, moduleBonuses(s))
  const pct = (k: ResourceTagKey): number => {
    switch (k) {
      case 'ammo': { const cap = caps.ammoCap; return cap > 0 ? (turret.ammo ?? cap) / cap * 100 : 100 }
      case 'energy': { const cap = caps.energyCap; return cap > 0 ? (turret.energy ?? cap) / cap * 100 : 100 }
      case 'heat': { const cap = fortressDef(s).heatCap; return cap > 0 ? s.fortress.heat / cap * 100 : 0 }
      case 'defense': return s.fortress.maxHp > 0 ? s.fortress.hp / s.fortress.maxHp * 100 : 100
    }
  }
  for (const tg of def.tags) {
    if (tg.kind !== 'resource') continue
    const v = pct(tg.res)
    if (tg.op === 'lt' ? v < tg.value : v > tg.value) return true
  }
  return false
}

interface TurretStateOps<TTarget> {
  blocked(def: TurretDef): boolean
  aim(def: TurretDef): { target: TTarget | null; canFire: boolean }
  hasAmmo(amount: number): boolean
  spendAmmo(amount: number): void
  hasEnergy(amount: number): boolean
  spendEnergy(amount: number): void
  addHeat(amount: number): void
  overheated(): boolean
  fire(def: TurretDef, target: TTarget, dt: number, muzzle: { x: number; y: number }, barrelIdx: number): void
  continuousTick(def: TurretDef): void
  beamReady(def: TurretDef): boolean
}

function playerTurretOps(s: GameState, t: Turret): TurretStateOps<PlayerTurretTarget> {
  const def = defOf(t.defId)
  syncPlayerTurretResources(t, def, moduleBonuses(s))
  return {
    blocked: definition => t.autoFire === false || s.fortress.overheated || resourceHold(s, t, definition),
    aim: def => aim(s, t, def, 1),
    hasAmmo: amount => (t.ammo ?? 0) + 1e-9 >= amount,
    spendAmmo: amount => { t.ammo = Math.max(0, (t.ammo ?? 0) - amount) },
    hasEnergy: amount => (t.energy ?? 0) + 1e-9 >= amount,
    spendEnergy: amount => { t.energy = Math.max(0, (t.energy ?? 0) - amount) },
    addHeat: amount => addFortressHeat(s, amount),
    overheated: () => s.fortress.overheated,
    fire: (def, target, dt, muzzle) => fireGunShot(s, t, def, target, dt, muzzle),
    continuousTick: def => { if (def.type === 'beam') beamTick(s, t, def); else sprayTick(s, t, def) },
    beamReady: def => t.beamOnAt === undefined || beamLength(s, t, def) >= beamMarch(s, t, def).len - 1e-9,
  }
}

/** 双方炮塔共用的充能、持续射击、连发、多炮管、装填和冷却状态机。 */
function updateTurretBody<TTarget>(s: GameState, t: Turret, dt: number, ops: TurretStateOps<TTarget> = playerTurretOps(s, t) as TurretStateOps<TTarget>) {
  const def = defOf(t.defId)
  const emitTurretFireSound = (soundRole: TurretFireSoundRole, x = t.x + t.w / 2, y = t.y + t.h / 2) => {
    ;(s.audioSignals ??= []).push({ id: s.nextId++, kind: 'turretFire', defId: def.id, sourceId: t.id, soundRole, x, y, left: 0.25 })
  }
  const closeInterruptedBurstSound = () => {
    if (!t.burstSoundStarted) return
    t.burstSoundStarted = false
    emitTurretFireSound('fire')
  }
  if (t.rackAnim > 0) t.rackAnim = Math.max(0, t.rackAnim - dt) // 复挂渐显推入动画衰减（无条件的每 tick）
  // 导弹逐枚渐进复挂：一轮打空（burstLeft→0）后计时，每隔 X=fireRate/(burst+1) 秒 rackLeft+1 至满挂；
  // 轮中（burstLeft>0，含中断暂停）/满挂不复挂；复挂与索敌无关
  if (def.type === 'missile') {
    const full = Math.max(1, def.burst ?? 1)
    if (t.rackLeft > full) t.rackLeft = full // burst 动态改小 clamp
    if (t.burstLeft > 0 || t.rackLeft >= full) {
      t.rackTimer = 0
    } else {
      const x = def.fireRate / (full + 1)
      if (t.rackTimer <= 0) t.rackTimer = x // 打空后启动计时
      else {
        t.rackTimer -= dt
        if (t.rackTimer <= 0) {
          t.rackLeft++
          t.rackAnim = RACK_RELOAD_ANIM // 逐枚复挂动画（仅最新枚，具体位移规则由 render 按弹丸类型决定）
          t.rackTimer = t.rackLeft < full ? x : 0
        }
      }
    }
  }
  const factor = 1 // v2.22：人员机制删除后效率系数恒 1（原 crewFactor：人员缺失降低转速/射速）

  if (ops.blocked(def)) { closeInterruptedBurstSound(); t.firing = false; t.burstLeft = 0; t.chargeLeft = 0; return }

  // 射线维持电量（§4.5 / §6.8）：中断则停止运作
  if (def.type === 'beam' && t.firing && def.energyPerSec) {
    const need = def.energyPerSec * dt
    if (!ops.hasEnergy(need)) { ops.spendEnergy(need); t.firing = false; return }
    ops.spendEnergy(need)
  }

  t.cooldown -= dt
  // 光束持续发射期间转向速度削减 50%（BEAM_TURN_FACTOR）
  const beamFiring = def.type === 'beam' && t.firing
  const { target, canFire } = ops.aim(beamFiring ? { ...def, rotateSpeed: def.rotateSpeed * BEAM_TURN_FACTOR } : def)

  // 充能前摇（Starsector chargeup）：每次开火周期（实弹每轮 / 持续型每次 attackDuration）起射前先充能 chargeTime 秒
  if (def.chargeTime && def.chargeTime > 0) {
    const sustained = def.type === 'spray' || def.type === 'beam'
    // v2.15：充能最后一帧不算在充能时间内——chargeLeft 计到 0 后进入 0.1s 末帧滞留（负值段），滞留结束才起射
    if (t.chargeLeft !== 0) { // >0 充能中；(-CHARGE_LAST_HOLD, 0) 末帧滞留
      if (!target || !canFire) t.chargeLeft = 0 // 目标丢失/移出射程射界 → 取消充能，重新索敌后重新充能
      else {
        t.chargeLeft -= dt // 充能期间不射击、不涨热、不耗弹药/电量（包装层视为"不射击"可自然散热）
        if (t.chargeLeft <= -CHARGE_LAST_HOLD) t.chargeLeft = 0 // 滞留结束当 tick 起正常开火
        else { if (t.chargeLeft === 0) t.chargeLeft = -1e-9; return } // 充能中/末帧滞留（恰落 0 须转入滞留段，否则下 tick 被当作空闲态）
      }
    } else if (target && canFire && t.cooldown <= 0 && (sustained ? !t.firing : t.burstLeft <= 0)) {
      t.chargeLeft = def.chargeTime // 新一轮起射前进入充能（轮内连发/齐射/轮流不重复充能）
      return
    }
  }

  // 持续型武器（光束/喷射）状态机（§6.6）
  if (def.type === 'spray' || def.type === 'beam') {
    // 持续型武器状态机（§6.6）
    if (t.firing) {
      // 资源中断立即停射（§6.8）
      if (def.type === 'spray' && def.ammoPerSec) {
        const need = def.ammoPerSec * dt
        if (!ops.hasAmmo(need)) { ops.spendAmmo(need); t.firing = false; t.cooldown = def.fireRate; return }
        ops.spendAmmo(need)
      }
      t.tickTimer -= dt
      if (t.tickTimer <= 0) {
        // v2.35：光束起射伸展期间 DoT 计时器不消费——否则首帧 len=0 空打后白等一整个 DoT 间隔，
        // 伤害会被拖到伸展完成后 0.5s。待光束伸展到全长（或抵达阻挡物）当帧立刻结算首次伤害。
        if (def.type === 'beam') {
          if (!ops.beamReady(def)) {
            t.tickTimer = 0 // 伸展中：不消费，下一帧再检测
          } else {
            ops.continuousTick(def)
            t.tickTimer += def.dot!.interval
          }
        } else {
          ops.continuousTick(def)
          t.tickTimer += def.dot!.interval
        }
      }
      t.firingLeft -= dt
      if (t.firingLeft <= 0) {
        t.firing = false
        t.cooldown = def.fireRate / factor // fireRate 语义 = 本轮/本次持续攻击结束后的装填时间
      }
      return
    }
    if (!target || !canFire || t.cooldown > 0) return
    // 开火预检资源
    if (def.type === 'beam' && def.energyPerShot && !ops.hasEnergy(def.energyPerShot)) return
    if (def.type === 'spray' && def.ammoPerSec && !ops.hasAmmo(Number.EPSILON)) return
    if (def.type === 'beam' && def.energyPerShot) ops.spendEnergy(def.energyPerShot)
    t.firing = true
    t.firingLeft = def.attackDuration ?? 1
    t.tickTimer = 0
    const soundMuzzle = muzzlePos(t, def, 0)
    emitTurretFireSound('fire', soundMuzzle.x, soundMuzzle.y)
    return
  }

  // 实弹类：轮 + 连发（§6.7）
  if (t.burstLeft > 0) {
    t.burstTimer -= dt
    if (t.burstTimer > 0) return
    if (!target || !canFire) { closeInterruptedBurstSound(); t.burstLeft = 0; return }
    // 多联炮管：齐射 = 每次击发全部炮管各射 1 枚（弹药/热量/电量按实际弹丸数结算）；
    // 轮流 = 每击发 1 枚，从 barrelIdx 炮管射出并轮转（连发间隔 = 相邻两管发射间隔，跨轮不重置）
    const nBarrels = Math.max(1, Math.floor(def.barrels ?? 1))
    const bMode = def.barrelMode ?? 'salvo'
    const shots = nBarrels > 1 && bMode === 'salvo' ? nBarrels : 1
    const rackBefore = def.type === 'missile' ? rackCounts(t, def, nBarrels) : null // 发射前分配（slot 取该管当前枚数-1，与展示消耗一致）
    const ammoNeed = shots
    if (!ops.hasAmmo(ammoNeed)) { closeInterruptedBurstSound(); t.burstLeft = 0; return }
    ops.spendAmmo(ammoNeed)
    let soundX = t.x + t.w / 2
    let soundY = t.y + t.h / 2
    for (let i = 0; i < shots; i++) {
      const bi = bMode === 'sequential' ? t.barrelIdx : i
      // 方案1：导弹出生点 = 挂载位（待发弹视觉位置）；实弹/抛射仍炮口点
      const mp = def.type === 'missile'
        ? rackMissilePos(t, def, bi, Math.max(0, (rackBefore?.[bi] ?? 1) - 1))
        : muzzlePos(t, def, bi)
      if (i === 0) { soundX = mp.x; soundY = mp.y }
      ops.fire(def, target, dt, mp, bi)
      // 炮口事件：后坐/火光表现层驱动（齐射每管一条、轮流仅当前管；不跟随旋转）
      const fd = FLASH_DURATION // 火光总时长硬编码 0.2s（v1.45：2 帧 × 0.1s）
      s.muzzles.push({
        id: s.nextId++, turretId: t.id, barrelIdx: bi,
        x: mp.x, y: mp.y, sourceAltitude: turretRuntimeSourceAltitude(s, t),
        angle: t.angle, ttl: fd, max: fd,
      })
      if (bMode === 'sequential') t.barrelIdx = (t.barrelIdx + 1) % nBarrels
    }
    const burstCount = Math.max(1, Math.floor(def.burst ?? 1))
    const shotIndex = Math.max(0, burstCount - Math.max(1, Math.floor(t.burstLeft)))
    ops.addHeat((def.heatPerShot ?? 0) * shots)
    const interruptedByOverheat = ops.overheated()
    const soundRole = interruptedByOverheat ? 'fire' : turretFireSoundRole(def, shotIndex)
    emitTurretFireSound(soundRole, soundX, soundY) // 齐射整轮只发一个音频事件
    t.burstSoundStarted = soundRole === 'burstLoop'
    if (def.type === 'missile') t.rackLeft = Math.max(0, t.rackLeft - shots) // 挂载消耗：轮流-1/齐射-N
    t.burstLeft--
    // 保留超过计时终点的帧内余量，使非整帧间隔（如 0.15s）长期仍严格按预设节奏，
    // 不会因每次击发都丢弃余量而逐发变慢。首发不继承“等待起射”的帧间余量。
    t.burstTimer = Math.max(0, def.burstInterval ?? 0) + (shotIndex > 0 ? Math.min(0, t.burstTimer) : 0)
    if (interruptedByOverheat) { t.burstLeft = 0; t.cooldown = 0; return }
    if (t.burstLeft === 0) t.cooldown = def.fireRate / factor // 本轮结束后进入装填
    return
  }
  if (!target || !canFire || t.cooldown > 0) return
  const ammoNeed = 1
  if (!ops.hasAmmo(ammoNeed)) return
  t.burstSoundStarted = false
  t.burstLeft = Math.max(1, Math.floor(def.burst ?? 1))
  t.burstTimer = 0
}

// ================= 弹道更新 =================

/** 世界线段与旋转后的主体贴图 alpha 首次交点；底座、履带和轮胎不阻挡弹丸。 */
export function enemyProjectileFortressHit(s: GameState, x1: number, y1: number, x2: number, y2: number, depth = 0): { x: number; y: number } | null {
  const r = fortressRect(s)
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2
  const c = Math.cos(s.fortress.heading), sn = Math.sin(s.fortress.heading)
  const local = (x: number, y: number) => {
    const dx = x - cx, dy = y - cy
    return { x: dx * c + dy * sn, y: -dx * sn + dy * c }
  }
  const a = local(x1, y1), b = local(x2, y2)
  const def = fortressDef(s)
  const t = fortressBodyMaskSegmentEntry(
    def.spriteBody, r.w, r.h,
    a.x + r.w / 2, a.y + r.h / 2,
    b.x + r.w / 2, b.y + r.h / 2,
    depth,
    def.chassis === 'walker' ? (def.walkerBodyOffsetX ?? 0) / BASE_CELL : 0,
    def.chassis === 'walker' ? (def.walkerBodyOffsetY ?? 0) / BASE_CELL : 0,
  )
  if (t === null) return null
  return { x: x1 + (x2 - x1) * t, y: y1 + (y2 - y1) * t }
}

const enemyProjectileTargetPoint = (state: GameState, projectile: EnemyProjectile) =>
  unitMissileTargetPoint(state, projectile, fortressCenter)

const { retargetUnitMissile } = createMissileRetargetAI({
  factionsHostile,
  turretDefById: defOf,
})

function enemyProjectileAttacker(s: GameState, projectile: EnemyProjectile): UnitAttackerRef {
  const side = projectile.sourceSide ?? 'enemy'
  const units = side === 'enemy' ? s.enemies : s.allies
  const owner = units.find(unit => unit.id === projectile.shooterId)
    ?? units.find(unit => unit.vehicle?.turrets?.some(turret => turret.id === projectile.shooterId))
  return owner ? { attackerSide: side, attackerId: owner.id } : {}
}

function enemyExplode(s: GameState, p: EnemyProjectile, x: number, y: number, radiusM: number): void {
  const radius = m2c(radiusM)
  const damage = p.damage + (p.blastEffect?.damage ?? 0)
  s.explosions.push({ id: s.nextId++, x, y, r: radius, ttl: 0.35, max: 0.35, ammoId: p.ammoId })
  addImpact(s, x, y, p.ammoId, dirX(p.heading), dirY(p.heading), projectileAltitudeAtTravel(p, p.traveled))
  applyExplosionDamage(s, p.sourceSide ?? 'enemy', x, y, radius, damage, p.blastEffect, {
    armorPen: p.armorPen, armorDamage: p.armorDamage, penetration: p.penetration,
  }, p.sourceFaction, enemyProjectileAttacker(s, p))
}

function enemyProjectileImpact(s: GameState, p: EnemyProjectile, x: number, y: number): void {
  if ((p.blastRadius ?? 0) > 0 || p.kind === 'shell' || p.kind === 'missile') {
    enemyExplode(s, p, x, y, p.blastRadius ?? (p.kind === 'shell' ? 1.92 : 1.28))
    return
  }
  if (!p.targetKind || p.targetId === undefined) return
  damageEnemyTurretTarget(s, {
    kind: p.targetKind, id: p.targetId, x, y, side: p.targetSide,
  }, p.damage, {
    x, y, penetration: p.penetration, armorPen: p.armorPen, armorDamage: p.armorDamage,
    incomingDx: dirX(p.heading), incomingDy: dirY(p.heading),
    ammoId: p.ammoId, projectileSize: ENEMY_PROJECTILE_VISUAL_SIZE,
    ...enemyProjectileAttacker(s, p),
  })
  addImpact(s, x, y, p.ammoId, dirX(p.heading), dirY(p.heading), projectileAltitudeAtTravel(p, p.traveled))
  s.explosions.push({ id: s.nextId++, x, y, r: 0.2, ttl: 0.12, max: 0.12, kind: 'groundImpact', ammoId: p.ammoId, projectileSize: ENEMY_PROJECTILE_VISUAL_SIZE })
}

function updateEnemyShellProjectile(s: GameState, p: EnemyProjectile, dt: number): boolean {
  const flight = Math.max(0.01, p.flightTime ?? 0.3)
  p.t = (p.t ?? 0) + dt / flight
  p.px = p.x; p.py = p.y
  p.x = (p.sx ?? p.x) + ((p.tx ?? p.targetX ?? p.x) - (p.sx ?? p.x)) * Math.min(1, p.t)
  p.y = (p.sy ?? p.y) + ((p.ty ?? p.targetY ?? p.y) - (p.sy ?? p.y)) * Math.min(1, p.t)
  if (p.t < 1) return true
  enemyProjectileImpact(s, p, p.x, p.y)
  return false
}

const unitProjectileSplitQueue: EnemyProjectile[] = []

/**
 * 返回本逻辑帧真正属于“离架后飞行”的时间。
 * 垂发转向期仍会推进制导、转向、加速、燃烧和位移，但不消耗正式飞行寿命。
 */
function missilePostLaunchDt(ammo: ProjectileArtDef | undefined, previousAge: number, nextAge: number): number {
  const launchDuration = ammo?.kind === 'missile' && ammo.verticalLaunch?.enabled === true
    ? verticalLaunchDuration(ammo)
    : 0
  return Math.max(0, nextAge - launchDuration) - Math.max(0, previousAge - launchDuration)
}

function splitUnitMissile(s: GameState, p: EnemyProjectile): boolean {
  const split = p.split
  if (!split || p.splitDone || split.count <= 1) return false
  const count = Math.max(2, Math.floor(split.count)), spread = Math.max(0, split.spread) * DEG
  for (let index = 0; index < count; index++) {
    const offset = count === 1 ? 0 : -spread / 2 + spread * index / (count - 1)
    unitProjectileSplitQueue.push({
      ...structuredClone(p), id: s.nextId++, damage: p.damage / count,
      heading: wrapAngle(p.heading + offset), moveHeading: undefined,
      split: undefined, splitDone: true, weavePhase: (p.weavePhase ?? 0) + offset,
      interceptHp: undefined, intercepted: false,
    })
  }
  return true
}

function updateEnemyMissileProjectile(s: GameState, p: EnemyProjectile, dt: number): boolean {
  const def = p.defId ? defOf(p.defId) : undefined
  const verticalAmmo = p.ammoId ? PROJECTILE_ARTS.find(item => item.id === p.ammoId) : undefined
  const previousAge = p.t ?? 0
  p.t = previousAge + dt
  const flightDt = missilePostLaunchDt(verticalAmmo, previousAge, p.t)
  let target = enemyProjectileTargetPoint(s, p)
  if (p.targetKind === 'combatUnit' && p.targetId !== undefined) {
    const targetHost = p.targetSide === 'enemy'
      ? s.enemies.find(item => item.id === p.targetId && item.hp > 0)
      : s.allies.find(item => item.id === p.targetId && item.hp > 0)
    if (targetHost) {
      const targetUnit = p.targetSide === 'enemy'
        ? runtimeEnemyUnitDef((targetHost as Enemy).unitDefId, (targetHost as Enemy).kind)
        : runtimeAllyUnitDef((targetHost as Ally).unitDefId, (targetHost as Ally).kind)
      p.targetAltitude = currentUnitAltitude(targetHost, targetUnit)
    }
  }
  const delayedAtFrameStart = p.guideDelayLeft !== undefined && p.guideDelayLeft > 0
  if (delayedAtFrameStart) {
    p.guideDelayLeft! -= dt
    if ((p.guideDecel ?? 0) > 0) p.speed = Math.max(0, p.speed - (p.guideDecel ?? 0) * dt)
    if (p.guideDelayLeft! <= 0) p.guided = !!p.willGuide
  }
  if (!target && p.guided) {
    target = retargetUnitMissile(s, p)
    if (target) { p.tgtPX = target.x; p.tgtPY = target.y }
  }
  const burning = p.burnTime === undefined || (p.t ?? 0) < p.burnTime
  if (p.split && !p.splitDone) {
    const shouldSplit = p.split.at === 'burnout'
      ? p.burnTime !== undefined && (p.t ?? 0) >= p.burnTime
      : !!target && Math.hypot(target.x - p.x, target.y - p.y) * M_PER_CELL <= (p.split.range ?? M_PER_CELL)
    if (shouldSplit && splitUnitMissile(s, p)) return false
  }
  if (target && p.guided) {
    steerGuidedMissile(p, target, dt, p.missileTurnMax ?? def?.missileTurnMax ?? 120, p.missileTurnAccel ?? def?.missileTurnAccel ?? 240)
    p.targetX = target.x; p.targetY = target.y
  }
  const maxSpeed = Math.max(1, p.missileMaxSpeed ?? def?.missileMaxSpeed ?? 100)
  if (burning && !(delayedAtFrameStart && (p.guideDecel ?? 0) > 0)) {
    p.speed = Math.min(maxSpeed, p.speed + Math.max(0, p.missileAccel ?? def?.missileAccel ?? 40) * dt)
  }
  const curve = Math.max(0, p.missileCurve ?? def?.missileCurve ?? 0)
  const delayCurveScale = missileCurveAmplitudeScale(p.guideDelayLeft)
  p.moveHeading = wrapAngle(p.heading + Math.cos(TAU * MISSILE_WEAVE_FREQ * (p.t ?? 0) + (p.weavePhase ?? 0)) * (curve / 100) * MISSILE_WEAVE_MAX_ANGLE * DEG * delayCurveScale)
  p.px = p.x; p.py = p.y
  if (p.flightLeft !== undefined) {
    p.flightLeft -= flightDt
    if (p.flightLeft <= 0) return false
  }
  // 垂发转向动画期间也要按当前航向推进；只有飞行寿命仍从转向结束后开始扣减。
  const stepM = p.speed * dt
  p.x += dirX(p.moveHeading) * m2c(stepM); p.y += dirY(p.moveHeading) * m2c(stepM); p.traveled += stepM
  // 转向阶段视为离地过程，不参与平面命中；结束后沿本帧轨迹恢复现有碰撞规则。
  if (missileVerticalLaunchActive(verticalAmmo, p.t ?? 0)) return true
  const aimPoint = target ?? (p.targetX !== undefined && p.targetY !== undefined ? { x: p.targetX, y: p.targetY } : null)
  let reachedTarget = !!aimPoint && Math.hypot(aimPoint.x - p.x, aimPoint.y - p.y) <= Math.max(0.25, m2c(stepM))
  if (p.targetKind === 'combatUnit') {
    const missileAltitude = projectileAltitudeAtTravel(p, p.traveled)
    if (p.targetSide === 'enemy') {
      const enemy = s.enemies.find(item => item.id === p.targetId && item.hp > 0)
      if (enemy) {
        const unit = runtimeEnemyUnitDef(enemy.unitDefId, enemy.kind)
        reachedTarget = Math.abs(currentUnitAltitude(enemy, unit) - missileAltitude) <= 0.55
          && pointInsideUnitShape(p.x, p.y, enemy, unit, Math.max(0.08, m2c(stepM)))
      }
    } else {
      const ally = s.allies.find(item => item.id === p.targetId && item.hp > 0)
      if (ally) {
        const unit = runtimeAllyUnitDef(ally.unitDefId, ally.kind)
        reachedTarget = Math.abs(currentUnitAltitude(ally, unit) - missileAltitude) <= 0.55
          && pointInsideUnitShape(p.x, p.y, ally, unit, Math.max(0.08, m2c(stepM)))
      }
    }
  }
  if (reachedTarget) {
    enemyProjectileImpact(s, p, p.x, p.y)
    return false
  }
  // 飞行单位允许在战场外继续交战；弹丸按自身射程/寿命结束，不再因越过地图边界被提前删除。
  return p.traveled < p.maxTravel
}

/** 非玩家/友军单位实弹与玩家实弹共用的“沿线先碰到谁就命中谁”规则。 */
function resolveUnitProjectileLineHits(s: GameState, p: EnemyProjectile): boolean {
  const hits: Array<{ id: number; side: 'ally' | 'enemy'; t: number; x: number; y: number; altitude: number }> = []
  const sourceFaction = p.sourceFaction ?? ((p.sourceSide ?? 'enemy') === 'ally' ? 'player' : 'enemy')
  const minX = Math.min(p.px, p.x) - 0.06, minY = Math.min(p.py, p.y) - 0.06
  const maxX = Math.max(p.px, p.x) + 0.06, maxY = Math.max(p.py, p.y) + 0.06
  for (const ref of querySpatialUnits(s, minX, minY, maxX, maxY, 'enemy')) {
    const enemy = ref.enemy!
    if (enemy.hp <= 0 || !factionsHostile(sourceFaction, enemy.faction ?? 'enemy')) continue
    const unit = runtimeEnemyUnitDef(enemy.unitDefId, enemy.kind)
    const t = segmentUnitShapeEntry(p.px, p.py, p.x, p.y, enemy, unit, 0.06)
    const segmentM = Math.hypot(p.x - p.px, p.y - p.py) * M_PER_CELL
    const hitAltitude = t === null ? 0 : projectileAltitudeAtTravel(p, p.traveled - segmentM + segmentM * t)
    if (t !== null && Math.abs(currentUnitAltitude(enemy, unit) - hitAltitude) > 0.55) continue
    if (t !== null) {
      const rawX = p.px + (p.x - p.px) * t, rawY = p.py + (p.y - p.py) * t
      const surface = unitBodySurfacePoint(enemy, unit, rawX, rawY, dirX(p.heading), dirY(p.heading), 1 / BASE_CELL)
      hits.push({ id: enemy.id, side: 'enemy', t, x: surface.x, y: surface.y, altitude: currentUnitAltitude(enemy, unit) })
    }
  }
  for (const ref of querySpatialUnits(s, minX, minY, maxX, maxY, 'ally')) {
    const ally = ref.ally!
    if (ally.hp <= 0 || !factionsHostile(sourceFaction, ally.faction ?? 'ally')) continue
    const unit = runtimeAllyUnitDef(ally.unitDefId, ally.kind)
    const t = segmentUnitShapeEntry(p.px, p.py, p.x, p.y, ally, unit, 0.06)
    const segmentM = Math.hypot(p.x - p.px, p.y - p.py) * M_PER_CELL
    const hitAltitude = t === null ? 0 : projectileAltitudeAtTravel(p, p.traveled - segmentM + segmentM * t)
    if (t !== null && Math.abs(currentUnitAltitude(ally, unit) - hitAltitude) > 0.55) continue
    if (t !== null) {
      const rawX = p.px + (p.x - p.px) * t, rawY = p.py + (p.y - p.py) * t
      const surface = unitBodySurfacePoint(ally, unit, rawX, rawY, dirX(p.heading), dirY(p.heading), 1 / BASE_CELL)
      hits.push({ id: ally.id, side: 'ally', t, x: surface.x, y: surface.y, altitude: currentUnitAltitude(ally, unit) })
    }
  }
  const seen = (p.hitIds ??= [])
  const fresh = hits.filter(hit => !seen.includes(hit.id)).sort((a, b) => a.t - b.t)
  const maxTargets = 1 + Math.max(0, p.pierceCount ?? 0)
  const room = Math.max(0, maxTargets - seen.length)
  for (const hit of fresh.slice(0, room)) {
    const scale = Math.pow(1 - Math.max(0, Math.min(1, p.pierceDecay ?? 0)), seen.length)
    if ((p.blastRadius ?? 0) > 0) {
      enemyExplode(s, p, hit.x, hit.y, p.blastRadius!)
      seen.push(hit.id)
      return true
    }
    damageEnemyTurretTarget(s, { kind: 'combatUnit', id: hit.id, side: hit.side, x: hit.x, y: hit.y }, p.damage * scale, {
      x: hit.x, y: hit.y, penetration: p.penetration, armorPen: p.armorPen, armorDamage: p.armorDamage,
      incomingDx: dirX(p.heading), incomingDy: dirY(p.heading), ammoId: p.ammoId, projectileSize: ENEMY_PROJECTILE_VISUAL_SIZE,
      ...enemyProjectileAttacker(s, p),
    })
    addImpact(s, hit.x, hit.y, p.ammoId, dirX(p.heading), dirY(p.heading), hit.altitude)
    seen.push(hit.id)
  }
  return seen.length >= maxTargets
}

function updateEnemyProjectile(s: GameState, p: EnemyProjectile, dt: number): boolean {
  if (p.intercepted) return false
  if (p.pendingFirstFrame) {
    p.pendingFirstFrame = false
    p.px = p.x
    p.py = p.y
    return true
  }
  if (p.kind === 'shell') return updateEnemyShellProjectile(s, p, dt)
  if (p.kind === 'missile') return updateEnemyMissileProjectile(s, p, dt)
  const stepM = p.speed * dt
  p.px = p.x; p.py = p.y
  p.x += dirX(p.heading) * m2c(stepM)
  p.y += dirY(p.heading) * m2c(stepM)
  p.traveled += stepM
  const firingDef = p.defId ? defOf(p.defId) : undefined
  if (firingDef?.canInterceptMissile) {
    const sourceFaction = p.sourceFaction ?? ((p.sourceSide ?? 'enemy') === 'ally' ? 'ally' : 'enemy')
    const startTravel = p.traveled - stepM
    if (interceptMissileAlongSegment(s, sourceFaction, p.px, p.py, p.x, p.y, p.damage, t => projectileAltitudeAtTravel(p, startTravel + stepM * t))) return false
  }
  if (resolveUnitProjectileLineHits(s, p)) return false
  if (p.targetKind && p.targetKind !== 'fortress') {
    const targetAlive = p.targetKind === 'coreBuilding'
      ? !!s.core && s.core.id === p.targetId && s.core.hp > 0
      : p.targetKind === 'fixedBuilding'
      ? s.buildings.some(b => b.id === p.targetId && b.hp > 0)
      : p.targetKind === 'wall'
        ? s.walls.some(w => w.id === p.targetId && w.state !== 'destroyed' && w.hp > 0)
        : p.targetKind === 'combatUnit'
          ? p.targetSide === 'enemy'
            ? s.enemies.some(e => e.id === p.targetId && e.hp > 0)
            : s.allies.some(a => a.id === p.targetId && a.hp > 0)
          : false
    if (!targetAlive || p.targetX === undefined || p.targetY === undefined) return false
    if (p.targetKind === 'combatUnit' && p.targetId !== undefined && (p.hitIds ?? []).includes(p.targetId)) {
      return p.traveled < p.maxTravel
    }
    let liveUnit: Enemy | Ally | undefined
    let liveUnitDef: UnitDef | undefined
    if (p.targetKind === 'combatUnit') {
      if (p.targetSide === 'enemy') {
        liveUnit = s.enemies.find(e => e.id === p.targetId)
        if (liveUnit) liveUnitDef = runtimeEnemyUnitDef((liveUnit as Enemy).unitDefId, (liveUnit as Enemy).kind)
      } else {
        liveUnit = s.allies.find(a => a.id === p.targetId)
        if (liveUnit) liveUnitDef = runtimeAllyUnitDef((liveUnit as Ally).unitDefId, (liveUnit as Ally).kind)
      }
      if (liveUnit) { p.targetX = liveUnit.x; p.targetY = liveUnit.y }
    }
    const vx = p.x - p.px, vy = p.y - p.py
    const len2 = vx * vx + vy * vy
    const centerT = len2 > 0 ? Math.max(0, Math.min(1, ((p.targetX - p.px) * vx + (p.targetY - p.py) * vy) / len2)) : 0
    const heightMatches = liveUnit && liveUnitDef
      ? Math.abs(currentUnitAltitude(liveUnit, liveUnitDef) - projectileAltitudeAtTravel(p, p.traveled)) <= 0.55
      : false
    const shapeT = liveUnit && liveUnitDef && heightMatches ? segmentUnitShapeEntry(p.px, p.py, p.x, p.y, liveUnit, liveUnitDef, 0.06) : null
    const t = shapeT ?? centerT
    const qx = p.px + vx * t, qy = p.py + vy * t
    const reached = shapeT !== null || (!liveUnit && Math.hypot(p.targetX - qx, p.targetY - qy) <= 0.35)
    if (reached) {
      enemyProjectileImpact(s, p, qx, qy)
      return false
    }
    return p.traveled < p.maxTravel
  }
  let hit: { x: number; y: number } | null = null
  if (p.impactX !== undefined && p.impactY !== undefined) {
    // 预定点与直线弹道共线；跨过该点的本帧才结算，让弹头在主体上可见地继续深入。
    const hx = dirX(p.heading), hy = dirY(p.heading)
    const before = (p.px - p.impactX) * hx + (p.py - p.impactY) * hy
    const after = (p.x - p.impactX) * hx + (p.y - p.impactY) * hy
    if (before <= 0 && after >= 0) {
      // 堡垒可能在穿入期间移动；目标点仍属于当前主体时才命中，否则重新寻交点。
      hit = enemyProjectileFortressHit(s, p.impactX, p.impactY, p.impactX, p.impactY)
      if (!hit) { p.impactX = undefined; p.impactY = undefined }
    }
  } else {
    const entry = enemyProjectileFortressHit(s, p.px, p.py, p.x, p.y)
    if (entry) {
      const depth = 0.18 + eventRandom(p.id, 118) * 0.52
      const probe = Math.hypot(fortressRect(s).w, fortressRect(s).h) * 2
      const target = enemyProjectileFortressHit(
        s, entry.x, entry.y,
        entry.x + dirX(p.heading) * probe, entry.y + dirY(p.heading) * probe,
        depth,
      ) ?? entry
      p.impactX = target.x; p.impactY = target.y
      const hx = dirX(p.heading), hy = dirY(p.heading)
      const after = (p.x - target.x) * hx + (p.y - target.y) * hy
      if (after >= 0) hit = target
    }
  }
  if (hit) {
    if ((p.blastRadius ?? 0) > 0) {
      enemyExplode(s, p, hit.x, hit.y, p.blastRadius!)
      return false
    }
    damageFortress(s, p.damage, {
      x: hit.x, y: hit.y, kind: 'projectile', penetration: p.penetration,
      armorPen: p.armorPen, armorDamage: p.armorDamage, ammoId: p.ammoId, projectileSize: ENEMY_PROJECTILE_VISUAL_SIZE,
      incomingDx: dirX(p.heading), incomingDy: dirY(p.heading),
    })
    addImpact(s, hit.x, hit.y, p.ammoId, dirX(p.heading), dirY(p.heading), projectileAltitudeAtTravel(p, p.traveled))
    return false
  }
  const cx = Math.floor(p.x), cy = Math.floor(p.y)
  if (p.traveled >= p.maxTravel) return false
  if (cx < 0 || cx >= LEVEL.cols || cy < 0 || cy >= LEVEL.rows) return true
  const directSubtype = PROJECTILE_ARTS.find(item => item.id === p.ammoId)?.directSubtype ?? 'bullet'
  const block = projectileBlockerAt(s, cx, cy, { kind: 'direct', subtype: directSubtype, altitude: projectileAltitudeAtTravel(p, p.traveled) })
  if (block && block.id !== p.ignoreObjectId) {
    damageObject(s, block, p.damage)
    addImpact(s, p.x, p.y, p.ammoId, dirX(p.heading), dirY(p.heading), projectileAltitudeAtTravel(p, p.traveled))
    s.explosions.push({ id: s.nextId++, x: p.x, y: p.y, r: 0.2, ttl: 0.12, max: 0.12, kind: 'groundImpact', ammoId: p.ammoId, projectileSize: ENEMY_PROJECTILE_VISUAL_SIZE })
    return false
  }
  return true
}

function updateBullet(s: GameState, p: Projectile, dt: number): boolean {
  const def = defOf(p.defId)
  const stepM = (def.projectileSpeed ?? 25.6) * dt
  p.px = p.x
  p.py = p.y
  p.x += dirX(p.heading) * m2c(stepM)
  p.y += dirY(p.heading) * m2c(stepM)
  p.traveled += stepM
  if (def.canInterceptMissile) {
    const startTravel = p.traveled - stepM
    if (interceptMissileAlongSegment(s, 'player', p.px, p.py, p.x, p.y, p.damage, t => projectileAltitudeAtTravel(p, startTravel + stepM * t))) return false
  }
  // 地形截断弹道（§7.2）
  const cx = Math.floor(p.x)
  const cy = Math.floor(p.y)
  const inBounds = cx >= 0 && cx < LEVEL.cols && cy >= 0 && cy < LEVEL.rows
  const directSubtype = PROJECTILE_ARTS.find(item => item.id === def.art?.projectile)?.directSubtype ?? 'bullet'
  const blockObj = inBounds ? projectileBlockerAt(s, cx, cy, { kind: 'direct', subtype: directSubtype, altitude: projectileAltitudeAtTravel(p, p.traveled) }) : null
  if (blockObj) {
    // 命中阻挡弹道的物体：扣其耐久（hp>0 才扣，归零摧毁），弹丸消失不穿透
    // v2.47：配置爆炸（blastRadius>0）的直射弹命中物体同样触发爆炸（波及由 explode 结算，含物体摧毁）
    if (def.blastRadius !== undefined && def.blastRadius > 0) {
      explode(s, p.x, p.y, def.blastRadius, 0, def.blastEffect, p.shooter, p.level, def.art?.projectile)
    } else {
      addImpact(s, p.x, p.y, def.art?.projectile, dirX(p.heading), dirY(p.heading), projectileAltitudeAtTravel(p, p.traveled))
      s.explosions.push({
        id: s.nextId++, x: p.x, y: p.y, r: 0.2, ttl: 0.15, max: 0.15,
        kind: 'groundImpact', ammoId: def.art?.projectile, projectileSize: GEOMETRIC_BULLET_VISUAL_SIZE,
      })
    }
    damageObject(s, blockObj, p.damage)
    return false
  }
  // 命中：线段-目标判定，穿透按距离排序（§6.5）
  const hits: { e: Enemy; along: number; qx: number; qy: number }[] = []
  const minX = Math.min(p.px, p.x) - 0.06, minY = Math.min(p.py, p.y) - 0.06
  const maxX = Math.max(p.px, p.x) + 0.06, maxY = Math.max(p.py, p.y) + 0.06
  for (const ref of querySpatialUnits(s, minX, minY, maxX, maxY, 'enemy')) {
    const e = ref.enemy!
    if (e.hp <= 0) continue
    const unit = runtimeEnemyUnitDef(e.unitDefId, e.kind)
    if (unit.stats.air && !def.canAir) continue
    const vx = p.x - p.px
    const vy = p.y - p.py
    const tt = segmentUnitShapeEntry(p.px, p.py, p.x, p.y, e, unit, 0.06)
    const hitTravel = p.traveled - stepM + stepM * (tt ?? 0)
    if (tt !== null && Math.abs(currentUnitAltitude(e, unit) - projectileAltitudeAtTravel(p, hitTravel)) > 0.55) continue
    if (tt !== null) {
      const rawX = p.px + vx * tt, rawY = p.py + vy * tt
      const surface = unitBodySurfacePoint(e, unit, rawX, rawY, dirX(p.heading), dirY(p.heading), 1 / BASE_CELL)
      hits.push({ e, along: tt, qx: surface.x, qy: surface.y })
    }
  }
  const fresh = hits.filter(h => !p.hitIds.includes(h.e.id))
  if (fresh.length > 0) {
    fresh.sort((a, b) => a.along - b.along)
    const maxTargets = 1 + (def.pierce?.count ?? 0) // §6.5：最多作用 1+穿透数量 个目标
    const decay = def.pierce?.decay ?? 0
    const room = maxTargets - p.hitIds.length
    for (let i = 0; i < Math.min(room, fresh.length); i++) {
      // 第 1 个目标 100%，每穿透 1 个后续伤害 ×(1-衰减幅度)
      const scale = Math.pow(1 - decay, p.hitIds.length)
      const ammo = PROJECTILE_ARTS.find(item => item.id === def.art?.projectile)
      damageEnemy(s, fresh[i].e, p.damage * scale, p.shooter, {
        x: fresh[i].qx, y: fresh[i].qy, penetration: ammo?.penetration, armorPen: def.armorPen, armorDamage: def.armorDamage,
        ammoId: def.art?.projectile, projectileSize: GEOMETRIC_BULLET_VISUAL_SIZE,
        incomingDx: dirX(p.heading), incomingDy: dirY(p.heading),
      })
      if (!(def.blastRadius !== undefined && def.blastRadius > 0)) {
        const hitUnit = runtimeEnemyUnitDef(fresh[i].e.unitDefId, fresh[i].e.kind)
        addImpact(s, fresh[i].qx, fresh[i].qy, def.art?.projectile, dirX(p.heading), dirY(p.heading), currentUnitAltitude(fresh[i].e, hitUnit))
      }
      p.hitIds.push(fresh[i].e.id)
      // v2.47 实弹爆炸：blastRadius>0 时命中点触发爆炸——直击目标吃 直击+爆炸，波及目标吃爆炸；
      // 伤害基底 0（直击已按穿透衰减结算），爆炸附加/燃烧由 blastEffect 提供；遮挡豁免/物体波及与榴弹同 explode 口径
      if (def.blastRadius !== undefined && def.blastRadius > 0) {
        explode(s, fresh[i].e.x, fresh[i].e.y, def.blastRadius, 0, def.blastEffect, p.shooter, p.level, def.art?.projectile,
          dirX(p.heading), dirY(p.heading), m2c(def.projectileSpeed ?? 25.6))
      }
    }
    if (p.hitIds.length >= maxTargets) return false
  }
  if (p.traveled >= p.maxTravel) {
    // 战场内耗尽射程才留下地面弹坑；场外只结束弹丸，避免在黑色场外累计不可见地表效果。
    if (inBounds) s.explosions.push({ id: s.nextId++, x: p.x, y: p.y, r: 0.2, ttl: 0.12, max: 0.12, kind: 'groundImpact', ammoId: def.art?.projectile, projectileSize: GEOMETRIC_BULLET_VISUAL_SIZE })
    return false
  }
  return true
}

function updateShell(s: GameState, p: Projectile, dt: number): boolean {
  p.t += dt / p.flightTime
  p.px = p.x
  p.py = p.y
  p.x = p.sx + (p.tx - p.sx) * Math.min(1, p.t)
  p.y = p.sy + (p.ty - p.sy) * Math.min(1, p.t)
  if (p.t >= 1) {
    const def = defOf(p.defId)
    // §3A 门控：炮塔未配置爆炸（blastRadius 缺失/≤0）时不走弹丸库爆炸帧图（程序化圈维持）
    const flyLen = Math.hypot(p.tx - p.sx, p.ty - p.sy) || 1 // 命中方向=起点→落点（方向偏置/速度继承）
    explode(s, p.tx, p.ty, def.blastRadius ?? 1.92, p.damage, def.blastEffect, p.shooter, p.level,
      def.blastRadius !== undefined && def.blastRadius > 0 ? def.art?.projectile : undefined,
      (p.tx - p.sx) / flyLen, (p.ty - p.sy) / flyLen, m2c(p.speed))
    return false
  }
  return true
}

/** v2.20 集束分裂子弹待入队缓冲：updateMissile 在 projectiles.filter 迭代期间触发分裂，
 *  直接 push 进 s.projectiles 会因 filter 缓存原长度而丢失——先入队，filter 结束后由 tick  drain 入数组 */
const splitSpawnQueue: Projectile[] = []

/** 所有玩家侧导弹共用的集束触发；在垂发转向阶段也会按燃尽/距离参数生效。 */
function splitPlayerMissile(s: GameState, p: Projectile, def: TurretDef, target: Enemy | undefined): boolean {
  const split = def.split
  if (!split || p.splitDone || split.count < 2) return false
  const trigger = split.at === 'burnout'
    ? def.burnTime !== undefined && p.t >= def.burnTime
    : !!(p.guided && target && !p.lostLock)
      && Math.hypot(target.x - p.x, target.y - p.y) * M_PER_CELL <= (split.range ?? M_PER_CELL)
  if (!trigger) return false
  for (let index = 0; index < split.count; index++) {
    const offset = (index / (split.count - 1) - 0.5) * split.spread * DEG
    splitSpawnQueue.push({
      id: s.nextId++, kind: 'missile', defId: p.defId, level: p.level,
      x: p.x, y: p.y, px: p.x, py: p.y, heading: wrapAngle(p.heading + offset),
      damage: p.damage / split.count, traveled: p.traveled, maxTravel: p.maxTravel,
      shooter: p.shooter, hitIds: [],
      t: p.t, flightTime: 0, sx: p.sx, sy: p.sy, tx: 0, ty: 0,
      speed: p.speed, turnRate: 0, guided: p.guided, targetId: p.targetId,
      lockX: p.lockX, lockY: p.lockY, lostLock: p.lostLock, prevDist: -1,
      flightLeft: p.flightLeft,
      weavePhase: p.weavePhase + offset,
      splitDone: true,
      tgtPX: p.tgtPX, tgtPY: p.tgtPY,
      igniteAtT: p.t,
    })
  }
  addImpact(s, p.x, p.y, def.art?.projectile, dirX(p.heading), dirY(p.heading), projectileAltitudeAtTravel(p, p.traveled))
  return true
}

function updateMissile(s: GameState, p: Projectile, dt: number): boolean {
  if (p.intercepted) return false
  const def = defOf(p.defId)
  // 淡出阶段：停止制导、惯性直飞、不再命中/爆炸，淡出结束移除
  if (p.fading !== undefined) {
    p.fading -= dt
    p.px = p.x
    p.py = p.y
    p.x += dirX(p.heading) * m2c(p.speed * dt)
    p.y += dirY(p.heading) * m2c(p.speed * dt)
    return p.fading > 0
  }
  const verticalAmmo = def.art?.projectile ? PROJECTILE_ARTS.find(item => item.id === def.art?.projectile) : undefined
  const previousAge = p.t
  p.t += dt // 弹龄覆盖垂发转向期；燃烧、制导与转向均从发射时开始推进。
  const flightDt = missilePostLaunchDt(verticalAmmo, previousAge, p.t)
  // 延迟制导也在垂发转向期内倒计时；归零后可在离架前就开始跟踪目标方向。
  const delayedAtFrameStart = p.guideDelayLeft !== undefined && p.guideDelayLeft > 0
  if (delayedAtFrameStart) {
    p.guideDelayLeft! -= dt
    if (p.guideDelayLeft! <= 0) p.guided = true
  }
  // 导弹速度：v1.96 延迟期内若配置延迟减速度则减速（下限 0），否则加速度爬升；v1.96 起仅在上限以下才加速（兼容初速度 > 极速）
  // v2.20 燃烧时间：burnTime 期内正常加速，燃尽后惯性滑行（不再加速；渲染侧同步熄灭尾焰/喷口焰）
  const burning20 = def.burnTime === undefined || p.t < def.burnTime
  const decel96 = delayedAtFrameStart ? Math.max(0, def.guideDecel ?? 0) : 0
  if (decel96 > 0) p.speed = Math.max(0, p.speed - decel96 * dt)
  else if (burning20) {
    const vmax96 = def.missileMaxSpeed ?? 100
    if (p.speed < vmax96) p.speed = Math.min(vmax96, p.speed + (def.missileAccel ?? 40) * dt)
  }
  let target = p.targetId != null ? s.enemies.find(e => e.id === p.targetId && e.hp > 0) : undefined

  // 制导导弹目标已被消灭/不存在：重选新目标（优先飞行时间内可达者）
  if (p.guided && !target && !p.lostLock) {
    const nt = retargetMissile(s, p, def)
    if (nt) {
      p.targetId = nt.id
      p.lockX = nt.x
      p.lockY = nt.y
      p.prevDist = -1 // 近炸引信基线重置
      p.tgtPX = nt.x // v2.20：前置量速度采样基线同步重置（避免换目标瞬间速度尖峰）
      p.tgtPY = nt.y
      p.targetAltitude = currentUnitAltitude(nt, runtimeEnemyUnitDef(nt.unitDefId, nt.kind))
      target = nt
    }
  }

  if (p.guided && target && !p.lostLock) {
    p.targetAltitude = currentUnitAltitude(target, runtimeEnemyUnitDef(target.unitDefId, target.kind))
    steerGuidedMissile(p, target, dt, def.missileTurnMax ?? 120, def.missileTurnAccel ?? 240)
  }
  // 飞行曲线（weave）：基础航向（制导追踪/非制导锁定航向）上叠加余弦航向偏置——
  // 往复摆动非单边扭转，missileCurve 越大摆幅越大；不改变制导/锁定/命中/过期判定（按弹体实际位置结算）
  const curve = def.missileCurve ?? 0
  let moveHeading = p.heading
  if (curve > 0) { // v2.20：p.t 已改为全程计时（上方统一推进），此处不再重复累加
    const delayCurveScale = missileCurveAmplitudeScale(p.guideDelayLeft)
    moveHeading = wrapAngle(p.heading + Math.cos(TAU * MISSILE_WEAVE_FREQ * p.t + p.weavePhase) * (curve / 100) * MISSILE_WEAVE_MAX_ANGLE * DEG * delayCurveScale)
  }
  if (splitPlayerMissile(s, p, def, target)) return false
  p.px = p.x
  p.py = p.y
  // 飞行时间仅从离开发射阶段后开始扣减。
  if (p.flightLeft !== undefined) {
    p.flightLeft -= flightDt
    if (p.flightLeft <= 0) {
      p.fading = MISSILE_FADE
      p.guided = false
      p.targetId = null
      return true
    }
  }
  // 垂发转向动画期间也按当前航向和速度推进，避免贴图只旋转却钉在发射点。
  const movementDt = dt
  p.x += dirX(moveHeading) * m2c(p.speed * movementDt)
  p.y += dirY(moveHeading) * m2c(p.speed * movementDt)
  p.traveled += p.speed * movementDt
  // 转向阶段视为离地过程，不参与平面命中；结束后恢复原有碰撞、近炸和射程判断。
  if (missileVerticalLaunchActive(verticalAmmo, p.t)) return true

  const doExplode = (x: number, y: number) => {
    // §3A 门控：同上，未配置爆炸不传 ammoId；命中方向/速率随事件（方向偏置/速度继承）
    explode(s, x, y, def.blastRadius ?? 2.56, p.damage, def.blastEffect, p.shooter, p.level,
      def.blastRadius !== undefined && def.blastRadius > 0 ? def.art?.projectile : undefined,
      dirX(moveHeading), dirY(moveHeading), m2c(p.speed))
  }
  // 命中判定
  if (p.guided && target && !p.lostLock) {
    const dNow = Math.hypot(target.x - p.x, target.y - p.y)
    const targetUnit = runtimeEnemyUnitDef(target.unitDefId, target.kind)
    const heightMatches = Math.abs(currentUnitAltitude(target, targetUnit) - projectileAltitudeAtTravel(p, p.traveled)) <= 0.55
    // 直接命中，或近炸引信：通过最近点（距离由减转增）且仍在近炸半径内
    const proximity = p.prevDist >= 0 && dNow > p.prevDist && dNow <= m2c(def.blastRadius ?? 2.304) + 0.6
    if (heightMatches && (pointInsideUnitShape(p.x, p.y, target, targetUnit, 0.45) || proximity)) {
      doExplode(target.x, target.y)
      return false
    }
    p.prevDist = dNow
  } else if (!p.guided) {
    // v2.20 沿途撞击：非制导（含延迟制导直飞期）飞行中撞上敌人即在敌处爆炸（远行星号式；锁定点/射程终点爆炸保留）
    const missileAltitude = projectileAltitudeAtTravel(p, p.traveled)
    const hitU20 = querySpatialUnits(s, p.x - 0.45, p.y - 0.45, p.x + 0.45, p.y + 0.45, 'enemy').find(ref => {
      const e = ref.enemy!
      if (e.hp <= 0) return false
      const unit = runtimeEnemyUnitDef(e.unitDefId, e.kind)
      return Math.abs(currentUnitAltitude(e, unit) - missileAltitude) <= 0.55
        && pointInsideUnitShape(p.x, p.y, e, unit, 0.45)
    })?.enemy
    if (hitU20) {
      doExplode(hitU20.x, hitU20.y)
      return false
    }
    if (!(p.guideDelayLeft !== undefined && p.guideDelayLeft > 0)) { // v1.94：延迟期内不触发锁定点爆炸
      // 非制导：飞向锁定落点并触发爆炸（目标移动不改变落点）
      if (Math.hypot(p.lockX - p.x, p.lockY - p.y) <= Math.max(0.2, m2c(p.speed * flightDt))) {
        doExplode(p.lockX, p.lockY)
        return false
      }
    }
  }
  // 射程终点 => 就地爆炸（§6.4.3 脱靶后行为默认口径）；飞出战场不再提前删除。
  // 导弹飞行途中不与阻挡弹道的物体碰撞（越过物体；目标在物体正后方的情况在发射时处理）
  if (p.traveled >= p.maxTravel) { doExplode(p.x, p.y); return false }
  return true
}

// ================= 主循环 =================

/** 玩家也是普通载具单位：进入同一摧毁表现，仅保留延迟结算失败的通用等待。 */
function beginPlayerUnitDestruction(s: GameState): void {
  if (s.fortress.hp > 0 || s.fortress.dyingT >= 0) return
  s.fortress.dyingT = 0
  const platform = fortressDef(s)
  const unit = unitDefById(platform.unitId ?? fortressUnitId(platform.id))
  const center = fortressCenter(s)
  emitUnitDestruction(s, {
    x: center.x,
    y: center.y,
    vehicle: { heading: s.fortress.heading },
  }, unit, platform)
  for (const turret of s.turrets) {
    turret.firing = false
    turret.burstLeft = 0
    turret.targetId = null
  }
}

function advancePlayerUnitDeath(s: GameState, dt: number): void {
  s.fortress.dyingT += dt
  if (s.fortress.dyingT >= PLAYER_DEATH_SETTLE_T) {
    if (s.objective.type === 'fortressDefense') transitionTaskStage(s, 'failure')
    else s.phase = 'lost'
  }
}

export function isTerminalPhase(phase: GameState['phase']): boolean {
  return phase === 'won' || phase === 'lost'
}

export function tick(prev: GameState, dt: number): GameState {
  const s = clone(prev)
  activeUnitSpatialIndex = null
  spatialFrameCounters = { queries: 0, candidates: 0, collisionPairs: 0, collisionBruteForcePairs: 0 }
  beginEnginePerfFrame()
  lastDt = dt
  s.time += dt
  if (prev.phase === 'combat') s.objectiveElapsed += dt
  // 视觉效果衰减
  s.tracers = s.tracers.filter(tr => (tr.ttl -= dt) > 0)
  s.muzzles = s.muzzles.filter(m => (m.ttl -= dt) > 0)
  s.beamFades = s.beamFades.filter(b => (b.ttl -= dt) > 0)
  s.impacts = s.impacts.filter(m => (m.ttl -= dt) > 0) // 命中事件 ttl 衰减（此前缺失：事件永存导致粒子每帧重复发射）
  s.shieldHits = s.shieldHits.filter(m => (m.ttl -= dt) > 0)
  s.unitHits = s.unitHits.filter(m => (m.ttl -= dt) > 0)
  s.explosions = s.explosions.filter(ex => (ex.ttl -= dt) > 0)
  s.floats = s.floats.filter(f => (f.ttl -= dt) > 0)
  s.notices = s.notices.filter(n => (n.left -= dt) > 0)
  if (s.cinematicDialogue && (s.cinematicDialogue.left -= dt) <= 0) s.cinematicDialogue = undefined
  if (s.cinematicText && (s.cinematicText.left -= dt) <= 0) s.cinematicText = undefined
  if (s.cinematicCamera) {
    const cameraDuration = s.cinematicCamera.duration + s.cinematicCamera.hold + (s.cinematicCamera.returnToOrigin ? s.cinematicCamera.duration : 0)
    if (s.time + 1e-9 >= s.cinematicCamera.startedAt + cameraDuration) s.cinematicCamera = undefined
  }
  if (s.audioSignals) s.audioSignals = s.audioSignals.filter(signal => (signal.left -= dt) > 0)
  s.fortress.hitFlash = Math.max(0, s.fortress.hitFlash - dt)
  // 动态飞行高度独立于战斗阶段与平面 AI；事件在备战期改变高度也会正常执行。
  for (const enemy of s.enemies) updateUnitAircraftAltitude(enemy, runtimeEnemyUnitDef(enemy.unitDefId, enemy.kind), dt)
  for (const ally of s.allies) updateUnitAircraftAltitude(ally, runtimeAllyUnitDef(ally.unitDefId, ally.kind), dt)

  // v2.53 毁灭序列中：冻结操控输入（堡垒已毁，只推进演出；运动求解器照常运行 → 惯性滑停）
  if (s.fortress.dyingT >= 0) { s.moveDir.x = 0; s.moveDir.y = 0; s.desiredHeading = null; s.reverse = false; s.turnDir = 0 }
  const playerBodyLocked = fortressDef(s).bodyLocked === true || s.objective.type === 'fortressDefense'
  if (playerBodyLocked) {
    s.moveDir.x = 0; s.moveDir.y = 0; s.moveMag = 0; s.desiredHeading = null; s.reverse = false; s.turnDir = 0
    s.fortress.vx = 0; s.fortress.vy = 0; s.fortress.turnW = 0
  }

  // 资源回复（内部模块提供回复/上限加成）
  const mb = moduleBonuses(s)
  s.ammo = Math.min(AMMO.cap + mb.ammoCap, s.ammo + (AMMO.regen + mb.ammoRegen) * dt)
  s.energy = Math.min(ENERGY.cap + mb.energyCap, s.energy + (ENERGY.regen + mb.energyRegen) * dt)
  // 玩家炮塔使用各自独立资源池。基础状态不自动恢复；只有当前玩家单位安装的恢复模块参与回复。
  for (const turret of s.turrets) {
    const def = defOf(turret.defId)
    syncPlayerTurretResources(turret, def, mb)
    if (mb.ammoRegen > 0) changePlayerTurretAmmo(turret, def, mb.ammoRegen * dt, mb)
    if (mb.energyRegen > 0) turret.energy = Math.min(playerTurretResourceCaps(def, mb).energyCap, (turret.energy ?? 0) + mb.energyRegen * dt)
  }
  updateShield(s, dt)
  const ramStartX = s.fortress.x
  const ramStartY = s.fortress.y

  // 堡垒机动（备战/交战均可）：加速度驱动速度向量 → 轴分离位移；移动不改变朝向（平移）
  // 转向速率 = turnSpeed × （当前速度/最大速度）；仅 A/D 显式转向（v1.61，原 Q/E）
  if (s.phase === 'prep' || s.phase === 'combat') {
    const f = s.fortress
    const d = fortressDef(s)
    const fc = fortressCenter(s)
    const maxSpd = fortressSpeed(s) // 最大速度（含模块加成；地形减速只影响目标速度，不影响比率分母）
    const chassis51 = d.chassis ?? 'tracked'
    const walker51 = chassis51 === 'walker'
    const terrainMod51 = chassis51 === 'hovercraft' ? 1 : terrainSpeedMod(fc.x, fc.y)
    // 目标速度向量 = 输入方向 × 最大速度（地形调制）
    const turnR = fortressTurnRadius(s) // 最小转弯半径（格）
    const rf = fortressReverseFactor(s) // 倒退系数（速度/加速度同比例）
    const steerDiff = s.desiredHeading != null ? wrapAngle(s.desiredHeading - f.heading) : 0 // 摇杆目标朝向差
    const steering = s.desiredHeading != null && Math.abs(steerDiff) > 3 * DEG // 摇杆转向中（倒退时追踪船尾朝向；到位即停，防抖动阈值 3°——目标角差 ≤3° 视为已到位，过滤摇杆微抖）
    // v1.64 滑行转向（演进 v1.63 静止门控）：A/D 单独按下（无任何油门输入：无移动指令、非倒退、
    // 无摇杆/受控朝向）时不做弧线驱动——不注入新速度，堡垒凭惯性继续滑行减速；
    // 转向走 speedRatio 比率门控（见 turnRate）：转速随当前速度衰减，速度降到 0 转向也归 0。
    // 即：松开 W/S 后按 A/D 仍可转向，但越来越慢直到停转（方向盘语义：静止单独按 A/D 无效）
    const throttle = s.moveDir.x !== 0 || s.moveDir.y !== 0 || s.reverse || steering || s.desiredHeading != null
    const coastTurn = s.turnDir !== 0 && !throttle
    const arcTurn = chassis51 !== 'hovercraft' && !walker51 && turnR > 0 && (s.turnDir !== 0 || steering) && !coastTurn // 弧线转向中：覆盖平移输入，转弯带动前行、本体随转
    // 弧线转向角速度（rad/s）：ω ≤ 转向速度，且 ω ≤ 最大速度/R——弧速不超速度上限、路径半径 ≥ R（最小转弯半径的真正约束）
    const arcW = arcTurn ? Math.min(fortressTurnSpeed(s) * DEG, (maxSpd * terrainMod51) / turnR) * (s.reverse ? rf : 1) : 0
    let tx = 0
    let ty = 0
    if (arcTurn) {
      // 弧线行驶：目标速度 = 朝向前方 × ω·R（倒退取反 = 船尾先行倒弧）；v 与 ω 同比例 → 路径半径恒为 R、速度不超上限
      const sgn = s.reverse ? -1 : 1
      tx = sgn * dirX(f.heading) * arcW * turnR
      ty = sgn * dirY(f.heading) * arcW * turnR
    } else if (s.reverse) {
      // 倒退（摇杆水平以下）：沿船头反方向，最大速度 = 前进 × 倒退系数
      const spd = maxSpd * rf * Math.max(0, Math.min(1, s.moveMag)) * terrainMod51
      tx = -dirX(f.heading) * spd
      ty = -dirY(f.heading) * spd
    } else if (s.moveDir.x !== 0 || s.moveDir.y !== 0) {
      const len = Math.hypot(s.moveDir.x, s.moveDir.y) || 1
      const mag = Math.max(0, Math.min(1, s.moveMag)) // 摇杆模拟量：推进幅度 → 速度上限
      const spd = maxSpd * mag * terrainMod51
      tx = (s.moveDir.x / len) * spd
      ty = (s.moveDir.y / len) * spd
    }
    // v2.51 履带转向阻力（turnDrag，缺省 0）：转向输入期间目标速度 ×(1−turnDrag)——滑移转向功耗
    if (!arcTurn && (chassis51 === 'tracked' || chassis51 === 'halfTracked')) {
      const td51 = Math.max(0, Math.min(0.9, d.turnDrag ?? 0))
      if (td51 > 0 && (s.turnDir !== 0 || steering)) { tx *= 1 - td51; ty *= 1 - td51 }
    }
    // 趋近目标速度：加速用加速度；刹停（速度变化量与当前速度反向）用减速度 = 加速度 × 刹停惯性倍率
    const pvx = f.vx, pvy = f.vy // 俯仰用：本 tick 更新前的速度
    const walkerStartHeading = f.heading
    if (chassis51 === 'hovercraft') {
      const targetForward = tx * dirX(f.heading) + ty * dirY(f.heading)
      const velocity = hoverVelocityStep(f.vx, f.vy, f.heading, targetForward, d.accel, d.hoverDrag ?? 0.35, d.hoverGrip ?? 0.8, dt)
      f.vx = velocity.vx
      f.vy = velocity.vy
    } else if (walker51) {
      const hasMoveInput = s.moveDir.x !== 0 || s.moveDir.y !== 0 || s.reverse
      const desiredWalkerHeading = s.reverse
        ? wrapAngle(f.heading + Math.PI)
        : hasMoveInput
          ? (s.desiredHeading ?? Math.atan2(s.moveDir.x, -s.moveDir.y))
          : s.turnDir !== 0
            ? wrapAngle(f.heading + Math.sign(s.turnDir) * fortressTurnSpeed(s) * DEG * dt)
            : f.heading
      const requestedWalkerSpeed = hasMoveInput
        ? maxSpd * Math.max(0, Math.min(1, s.moveMag)) * terrainMod51 * (s.reverse ? rf : 1)
        : 0
      const motion = walkerMotionStep(
        f.vx, f.vy, f.heading, desiredWalkerHeading, requestedWalkerSpeed,
        d.accel, d.brakeInertia ?? 5, fortressTurnSpeed(s), dt,
      )
      f.vx = motion.vx
      f.vy = motion.vy
      f.heading = motion.heading
      f.turnW = motion.turnW
      const walkerHeadingDelta = wrapAngle(f.heading - walkerStartHeading)
      if (walkerHeadingDelta !== 0) {
        for (const turret of s.turrets) if (turret.hardpointId) turret.angle = wrapAngle(turret.angle + walkerHeadingDelta)
        syncTurretMounts(s)
      }
    } else {
      const dvx = tx - f.vx
      const dvy = ty - f.vy
      const dv = Math.hypot(dvx, dvy)
      const braking = dv > 0 && (f.vx * dvx + f.vy * dvy) < 0 // 正在减速（含松摇杆/换挡/倒退刹停）——仅用于减速度物理
      const maxDv = d.accel * (braking ? brakeDecelMult(d) : 1) * (s.reverse ? rf : 1) * dt // 倒退时加/减速度同样 × 倒退系数
      if (dv > 0) {
        if (dv <= maxDv) { f.vx = tx; f.vy = ty } else { f.vx += (dvx / dv) * maxDv; f.vy += (dvy / dv) * maxDv }
      }
    }
    // 车身俯仰/侧倾（纯视觉，v1.43 重定义为汽车悬挂拟真）：偏移 = 本 tick 实际加速度的反向映射——
    // 启动/加速 → 朝船尾后倾；减速/刹停 → 朝船头前倾；倒退天然镜像（倒车加速前倾、
    // 倒车刹停后倾）；弧线转向的向心加速度 → 向弯道外侧侧倾（幅度 ×0.4，v1.84 由 0.6 下调）。仅响应操控引起的加减速
    // （碰撞截断不计入）。强度 pitchGain 0~10（缺省 4，0=关闭）；目标上限 ±leanCap px（v1.93 可调 1~8，缺省 4）；弹簧-阻尼趋近（v1.92）
    // v1.90：匀速巡航（实际加速度进死区）→ 保持当前倾角不归位；v1.91：停稳 → 欠阻尼回弹（反向过冲后归位）；gain=0 仍强制回正
    if (walker51) {
      // 机甲的姿态起伏完全由 2×7 步态动画表现，不叠加汽车悬挂俯仰。
      f.leanX = 0; f.leanY = 0; f.leanVX = 0; f.leanVY = 0; f.leanRbT = -1
    } else {
      const gain = Math.max(0, Math.min(10, d.pitchGain ?? 4))
      const k = gain * 0.5 // px per (格/s²)
      const leanCap = Math.max(1, Math.min(8, d.leanCap ?? 4)) // v1.93：俯仰位移上限 px，堡垒参数可调（缺省 4）
      const ax = (f.vx - pvx) / dt // 实际生效加速度（经加速度上限/地形/倒退系数约束后的真实 Δv/Δt）
      const ay = (f.vy - pvy) / dt
      const hx = dirX(f.heading) // 船头纵轴
      const hy = dirY(f.heading)
      const aLon = ax * hx + ay * hy // 纵向投影 → 俯仰
      const aLat = ax * -hy + ay * hx // 横向投影 → 侧倾
      const dead = 0.05 // 死区防数值抖动
      const inDead91 = Math.abs(aLon) < dead && Math.abs(aLat) < dead // 实际加速度≈0（匀速/停稳）
      const stopped91 = tx === 0 && ty === 0 && f.vx === 0 && f.vy === 0 // 本 tick 处于静止无输入（含刹停截断到 0 的瞬间）
      if (gain === 0) f.leanRbT = -1 // v1.91：关闭俯仰时取消回弹（走强制回正）
      // v1.91 停稳惯性回弹：停稳瞬间若带着保持的倾角（>0.3px）→ 以此为初值做欠阻尼回摆
      // lean(t) = L0·e^(−ζωt)·(cos ωd t + ζω/ωd·sin ωd t)，ζ=0.3、T=0.35s：
      // 反向过冲峰值 ≈ 0.37×L0（满刹 L0=4px → ≈1.5px，用户要求 1-2px），0.8s 衰减归位
      if (gain > 0 && f.leanRbT >= 0) { // 回弹进行中
        if (!inDead91 && !stopped91) {
          f.leanRbT = -1 // 新加速度 → 打断回弹，下方正常路径从当前值趋近新目标
        } else {
          f.leanRbT += dt
          const wd91 = (Math.PI * 2) / 0.35, z91 = 0.3, w91 = wd91 / Math.sqrt(1 - z91 * z91)
          const c91 = Math.exp(-z91 * w91 * f.leanRbT) * (Math.cos(wd91 * f.leanRbT) + (z91 * w91 / wd91) * Math.sin(wd91 * f.leanRbT))
          f.leanX = f.leanRbX * c91
          f.leanY = f.leanRbY * c91
          if (f.leanRbT >= 0.8) { f.leanX = 0; f.leanY = 0; f.leanRbT = -1 } // 衰减殆尽 → 归位
        }
      }
      if (f.leanRbT < 0) {
        if (gain > 0 && stopped91 && Math.hypot(f.leanX, f.leanY) > 0.3) {
          f.leanRbT = 0; f.leanRbX = f.leanX; f.leanRbY = f.leanY; f.leanVX = 0; f.leanVY = 0 // 启动回弹：c(0)=1，本 tick 倾角不变；角速度清零（v1.92）
        } else {
          // v1.90：巡航（a≈0 但仍在行驶）冻结保持不归位；再次出现真实加速度时按新目标趋近
          const coast90 = gain > 0 && inDead91
          if (coast90) { f.leanVX = 0; f.leanVY = 0 } // v1.92：冻结即停动
          if (!coast90) {
            const lon = Math.abs(aLon) < dead ? 0 : aLon
            const lat = Math.abs(aLat) < dead ? 0 : aLat
            let ltX = (-hx * lon + hy * lat * 0.4) * k // 偏移 = 加速度反向（侧倾 = 向心加速度反向 → 弯道外侧；v1.84 系数 0.6→0.4）
            let ltY = (-hy * lon - hx * lat * 0.4) * k
            const lm = Math.hypot(ltX, ltY)
            if (lm > leanCap) { ltX *= leanCap / lm; ltY *= leanCap / lm }
            if (gain === 0) { ltX = 0; ltY = 0 }
            // v1.92 弹簧-阻尼二阶趋近（悬挂拟真，取代定速趋近）：lean'' = ωn²(lt−lean) − 2ζωn·lean'
            // ωn=2π×1.2Hz（车身俯仰固有频率量级，稳定约0.5s）；ζ=0.5（阶跃过冲 16%：急加速冲过目标再回落）
            // 效果：俯仰峰值速率 ∝ 目标幅度 ∝ |实际加速度|——轻踩缓倾、地板油猛仰，且起步不再瞬间顶满
            const wn92 = Math.PI * 2 * 1.2, z92 = 0.5
            f.leanVX += (wn92 * wn92 * (ltX - f.leanX) - 2 * z92 * wn92 * f.leanVX) * dt
            f.leanVY += (wn92 * wn92 * (ltY - f.leanY) - 2 * z92 * wn92 * f.leanVY) * dt
            f.leanX += f.leanVX * dt
            f.leanY += f.leanVY * dt
            const lm92 = Math.hypot(f.leanX, f.leanY) // 软上限 = leanCap + 1px 过冲余量（v1.93 随参数缩放）
            const softCap92 = leanCap + 1
            if (lm92 > softCap92) { f.leanX *= softCap92 / lm92; f.leanY *= softCap92 / lm92; f.leanVX *= softCap92 / lm92; f.leanVY *= softCap92 / lm92 }
            if (ltX === 0 && Math.abs(f.leanX) < 0.02 && Math.abs(f.leanVX) < 0.05) { f.leanX = 0; f.leanVX = 0 } // 静止吸附防浮点残尘
            if (ltY === 0 && Math.abs(f.leanY) < 0.02 && Math.abs(f.leanVY) < 0.05) { f.leanY = 0; f.leanVY = 0 }
          }
        }
      }
    }
    // 履带/轮滚动相位（v1.85 履带；v2.51 统一为落印列含轮子）：本 tick 真实纵向速度 × dt 累加；转向差速 = v_i = vLon − turnW×横向偏移
    // （右转为正 turnW → 右侧为内侧变慢；倒退 vLon<0 自然反滚；原地转向 vLon=0 时两侧一正一反）
    // def 只存左履带，右侧绕几何原点 x=0 镜像；轮胎 unit=pair 同样展开为左右两列（fortressMarkColumns）
    const cols51 = fortressMarkColumns(d)
    if (cols51.length > 0) {
      if (f.trackPhase.length !== cols51.length) f.trackPhase = Array.from({ length: cols51.length }, (_, i) => f.trackPhase[i] ?? 0)
      const vLon85 = f.vx * dirX(f.heading) + f.vy * dirY(f.heading) // 纵向速度分量（格/s，倒退为负）
      for (let k = 0; k < cols51.length; k++) {
        const c51 = cols51[k]
        const sx51 = (c51.x1 + c51.x2) / 2 // 横向偏移（格，几何原点右侧为正）
        f.trackPhase[k] += (vLon85 - f.turnW * sx51) * dt
      }
    }
    // 位移（轴分离碰撞 = 贴墙滑动；跨格触发全场重寻路）
    const walkerStartX = s.fortress.x, walkerStartY = s.fortress.y
    if (f.vx !== 0 || f.vy !== 0) {
      const totalDx = f.vx * dt, totalDy = f.vy * dt
      const moveSteps = Math.max(1, Math.ceil(Math.max(Math.abs(totalDx), Math.abs(totalDy)) / 0.18))
      const stepDt = dt / moveSteps
      for (let moveStep = 0; moveStep < moveSteps; moveStep++) {
        const beforeX = s.fortress.x, beforeY = s.fortress.y
        moveFortressAxis(s, totalDx / moveSteps, 0)
        moveFortressAxis(s, 0, totalDy / moveSteps)
        const actualVx = stepDt > 0 ? (s.fortress.x - beforeX) / stepDt : 0
        const actualVy = stepDt > 0 ? (s.fortress.y - beforeY) / stepDt : 0
        if (s.phase === 'combat') applyFortressRamming(s, actualVx, actualVy)
        applyFortressVehicleCollisions(s, actualVx, actualVy)
      }
      syncTurretMounts(s)
      const nfc = fortressCenter(s)
      const ncx = Math.floor(nfc.x)
      const ncy = Math.floor(nfc.y)
      if (ncx !== s.fortCellX || ncy !== s.fortCellY) {
        s.fortCellX = ncx
        s.fortCellY = ncy
        s.pathVersion++ // 堡垒跨格 → 敌人重寻路
      }
    }
    if (walker51) {
      const actualDistance = Math.hypot(s.fortress.x - walkerStartX, s.fortress.y - walkerStartY)
      const animation = advanceWalkerAnimation(
        f, d.walkerStride ?? 1, actualDistance,
        wrapAngle(f.heading - walkerStartHeading), dt,
      )
      f.walkAnimationAt = s.time
      const center = fortressCenter(s)
      emitWalkerFootfalls(s, s.fortressDefId, center.x, center.y, f.heading, d, animation.footfalls, animation.turningInPlace)
    }
    // 转向：仅 A/D 显式转向（移动不再改变朝向；v1.61，原 Q/E）
    // arcTurn（turnRadius>0 且有油门/受控）：全速转向——转弯本身带动前行，堡垒绕外侧圆心走弧、本体随转（v2.51 起为两底盘通用覆盖）
    // v2.51 底盘物理（turnRadius=0/未配置时）：履带=差速枢轴转（转速不再乘速度比率，静止可原地转；上限=min(turnSpeed, 2×极速/履带间距)）；
    // 轮式=前轮角模型（δ 经方向盘转速积分，ω=v·tanδ/轴距；静止无转向能力；倒退 v<0 自动反向=车尾语义）
    let dH = 0
    if (walker51) {
      // 步行机甲的转向已与速度一起由 walkerMotionStep 积分，避免再次应用车辆转向。
      dH = 0
    } else if (chassis51 === 'hovercraft') {
      const turnRate = fortressTurnSpeed(s) * DEG
      if (steering) {
        dH = Math.max(-turnRate * dt, Math.min(turnRate * dt, steerDiff))
        f.turnW = dH / dt
      } else if (s.turnDir !== 0) {
        f.turnW = Math.sign(s.turnDir) * turnRate
        dH = f.turnW * dt
      } else if (s.desiredHeading == null && f.turnW !== 0) {
        const decayed = f.turnW * Math.exp(-dt / TURN_COAST_TAU)
        f.turnW = Math.abs(decayed) < 0.2 * DEG ? 0 : decayed
        dH = f.turnW * dt
      } else f.turnW = 0
    } else if (!arcTurn && (chassis51 === 'wheeled' || chassis51 === 'halfTracked')) {
      // 轮式前轮转向；半履带在此基础上叠加后履带差速辅助。
      const L51 = Math.max(0.5, d.wheelbase ?? d.h * 0.6)
      const steerMax51 = (d.steerMax ?? 35) * DEG
      const steerRate51 = (d.steerRate ?? 120) * DEG
      let steerTgt = 0 // 无输入自动回正
      if (steering) steerTgt = Math.max(-steerMax51, Math.min(steerMax51, steerDiff)) // 摇杆：朝向差直接映射前轮角
      else if (s.turnDir !== 0) steerTgt = Math.sign(s.turnDir) * steerMax51 // A/D：打满
      const dDel = steerTgt - f.steerAngle
      const maxDDel = steerRate51 * dt
      f.steerAngle += Math.max(-maxDDel, Math.min(maxDDel, dDel))
      const vLonW = f.vx * dirX(f.heading) + f.vy * dirY(f.heading) // 纵向速度（倒退为负）
      // 横向附着上限：v²/R ≤ gripMax → tanδ_eff ≤ grip·L/v²（v<0.5 格/s 后不再收紧；运动学不漂移，漂移另版）
      const gripW = m2c(d.gripMax ?? 1.024)
      const tanMaxW = gripW * L51 / Math.max(vLonW * vLonW, 0.25)
      const tanW = Math.max(-tanMaxW, Math.min(tanMaxW, Math.tan(f.steerAngle)))
      let omW = vLonW * tanW / L51
      if (chassis51 === 'halfTracked') {
        const speedRatioH = maxSpd > 1e-6 ? Math.min(1, Math.abs(vLonW) / maxSpd) : 0
        const intendedDrive = Math.sign(vLonW || (s.reverse ? -1 : 1))
        const turnIntentH = Math.sign(Math.tan(steerTgt)) * intendedDrive
        const pivotCapH = (2 * maxSpd) / Math.max(0.5, d.trackWidth ?? d.w)
        omW += turnIntentH * pivotCapH * (0.35 + 0.65 * (1 - speedRatioH))
      }
      const omCapW = fortressTurnSpeed(s) * DEG // turnSpeed 仍为可选横摆角速度上限
      if (omCapW > 0) omW = Math.max(-omCapW, Math.min(omCapW, omW))
      dH = omW * dt
      f.turnW = omW
    } else if (arcTurn || chassis51 === 'tracked') {
      // 履带差速（含 arcTurn 覆盖）：枢轴上限推导 = 2×极速/履带间距；turnSpeed 封顶
      const pivotCap = (2 * maxSpd / Math.max(0.5, d.trackWidth ?? d.w)) / DEG
      const turnRate = arcTurn ? arcW / DEG : Math.min(fortressTurnSpeed(s), pivotCap) * (s.reverse ? rf : 1) // 弧线：受半径约束的角速度；履带：差速枢轴（无速度比率——原地可转）；倒退 × 倒退系数
    if (steering) {
      // 摇杆转向：按转向速率追踪摇杆推出方向（到位即停、不超调）
      const maxDH = turnRate * DEG * dt
      dH = Math.max(-maxDH, Math.min(maxDH, steerDiff))
      f.turnW = dH / dt // v1.56：记录当前转向角速度（松手过渡的种子值）
    } else if (s.turnDir !== 0) {
      // v1.63：倒退时转向以车尾为准——A 使车尾朝左（船头向右，heading+）、D 使车尾朝右（heading−），
      // 与摇杆倒车「船尾追踪摇杆」及真车倒车方向盘语义一致。
      // v1.64：滑行（无油门）时 speedRatio 门控使转速随速度衰减至 0，无需额外门控。
      // v1.66：翻转依据「实际纵向速度方向」而非仅倒退输入标志——松开后退键后堡垒仍在向后滑行时
      // 保持车尾语义（A 继续车尾朝左/heading+、D 继续车尾朝右/heading−），转向方向不突变，随减速平滑停转。
      // 仅在滑行（coastTurn，无任何油门/移动指令）时按速度方向判定；有移动指令时以 reverse 标志为准
      // （自由移动指令与船头轴向无关，不适用车尾语义）
      const vAlong = f.vx * dirX(f.heading) + f.vy * dirY(f.heading) // 纵向速度投影（>0 前行，<0 倒行）
      const revFlip = (s.reverse || (coastTurn && vAlong < 0)) ? -1 : 1
      dH = Math.sign(s.turnDir) * turnRate * DEG * dt * revFlip
      f.turnW = dH / dt
    } else if (s.desiredHeading == null) {
      // v1.56 松手转向过渡：转向输入解除（摇杆松手/回死区、A/D 松开）后角速度不瞬间归零，
      // 按时间常数 TURN_COAST_TAU 指数衰减——船头继续按衰减中的角速度惯性摆动，低于 0.2°/s 归零
      if (f.turnW !== 0) {
        const decayed = f.turnW * Math.exp(-dt / TURN_COAST_TAU)
        f.turnW = Math.abs(decayed) < 0.2 * DEG ? 0 : decayed
        dH = f.turnW * dt
      }
    } else {
      f.turnW = 0 // 摇杆在位但已到位（3° 死区）：不计入过渡
    }
    }
    if (dH !== 0) {
      f.heading = wrapAngle(f.heading + dH)
      for (const t of s.turrets) if (t.hardpointId) t.angle = wrapAngle(t.angle + dH)
      syncTurretMounts(s)
    }
  }

  // #19 载具碾压：以本 tick 真实位移计算，撞墙空转或只原地转向不会伤害单位。
  const playerActualVx = dt > 0 ? (s.fortress.x - ramStartX) / dt : 0
  const playerActualVy = dt > 0 ? (s.fortress.y - ramStartY) / dt : 0
  if (s.phase === 'combat' && dt > 0) applyFortressRamming(s, playerActualVx, playerActualVy)

  // 生产模块产出 + 维修站修复 + 友军单位推进（备战/交战都生效）
  rebuildUnitSpatialIndex(s)
  const allyAiPerfStartedAt = beginEnginePerfPart()
  updateModulesAndAllies(s, dt)
  endEnginePerfPart('allyAiMs', allyAiPerfStartedAt)
  const eventPerfStartedAt = beginEnginePerfPart()
  updateUnifiedEvents(s, dt)
  updateObjectEvents(s, dt)
  updateUnitEvents(s)
  updateEventQueue(s, dt)
  updateFunctionalAreas(s, dt)
  endEnginePerfPart('eventMs', eventPerfStartedAt)

  // 备战阶段同样保持玩家、友军和已放置地面单位的实体分离；只分离，不结算敌对冲撞伤害。
  if (s.phase === 'prep') {
    resolveUnitCollisions(s)
    applyFortressVehicleCollisions(s, playerActualVx, playerActualVy)
    rebuildUnitSpatialIndex(s)
  }
  if (s.phase === 'prep') {
    // 波次结束收尾：已发射投射物继续飞行直至命中/出界/过期（不出怪、炮塔不开火）
    const projectilePerfStartedAt = beginEnginePerfPart()
    s.projectiles = s.projectiles.filter(p => {
      if (p.kind === 'bullet') return updateBullet(s, p, dt)
      if (p.kind === 'shell') return updateShell(s, p, dt)
      return updateMissile(s, p, dt)
    })
    s.enemyProjectiles = s.enemyProjectiles.filter(p => updateEnemyProjectile(s, p, dt))
    s.projectiles = s.projectiles.filter(p => !p.intercepted)
    s.enemyProjectiles = s.enemyProjectiles.filter(p => !p.intercepted)
    if (unitProjectileSplitQueue.length > 0) { s.enemyProjectiles.push(...unitProjectileSplitQueue); unitProjectileSplitQueue.length = 0 }
    if (splitSpawnQueue.length > 0) { s.projectiles.push(...splitSpawnQueue); splitSpawnQueue.length = 0 } // v2.20 集束子弹入队
    endEnginePerfPart('projectileMs', projectilePerfStartedAt)
    coolFortress(s, dt) // 备战阶段堡垒散热继续生效
    s.prepLeft = Math.max(0, s.prepLeft - dt)
    if (s.prepLeft <= 0) {
      const started = startWave(s, 0)
      finishEnginePerfFrame(started)
      return started
    }
    finishEnginePerfFrame(s)
    return s
  }
  if (s.phase !== 'combat') { finishEnginePerfFrame(s); return s }

  // 防守任务关闭“波次等待”时：上一波最后一名敌人上场后，按接踵时间自动排入下一波。
  if (waveDefenseObjective(s.objective) && s.objective.waveWait === false && s.nextWaveLeft !== null) {
    s.nextWaveLeft = Math.max(0, s.nextWaveLeft - dt)
    if (s.nextWaveLeft <= 0 && s.wave < s.objective.waves) {
      s.wave++
      s.spawnQueue = stageWaveQueue(levelStage(s.activeStageId), s.wave - 1)
      s.spawnTimer = s.spawnQueue[0]?.delay ?? 0
      s.nextWaveLeft = null
    }
  }

  // 1) 出怪
  updateRegionTriggers(s, dt)
  updateInteractables(s)
  if ((s.phase as Phase) !== 'combat') { finishEnginePerfFrame(s); return s }
  if (s.ambushQueue.length > 0) {
    const pending: AmbushSpawn[] = []
    for (const a of s.ambushQueue) {
      a.left -= dt
      if (a.left <= 0) spawnEnemyAt(s, a.kind, a.x, a.y, a.unitDefId ?? enemyUnitId(a.kind))
      else pending.push(a)
    }
    s.ambushQueue = pending
  }
  if (s.spawnQueue.length > 0) {
    s.spawnTimer -= dt
    if (s.spawnTimer <= 0) {
      const item = s.spawnQueue.shift()!
      const point = defenseWaveSpawnPoint(s.objective, item.spawnRegionId, s.nextId)
      spawnEnemyAt(s, item.kind, point.x, point.y, item.unitDefId ?? enemyUnitId(item.kind), item.damageMultiplier)
      s.spawnTimer = s.spawnQueue[0]?.delay ?? 0
      if (s.spawnQueue.length === 0 && waveDefenseObjective(s.objective) && s.objective.waveWait === false && s.wave < s.objective.waves) {
        s.nextWaveLeft = s.objective.overlapTime ?? DEFEND_OVERLAP_TIME_DEFAULT
      }
    }
  }

  // 2) 距离场（结构变化时重算 => 全场重寻路）
  const dist = computePathField(s)

  // 3) 敌人行动（船体归零 => v2.53 进入毁灭序列，不再同帧判负；演出推进见步骤 9）
  rebuildUnitSpatialIndex(s)
  const enemyAiPerfStartedAt = beginEnginePerfPart()
  for (const e of s.enemies) {
    if (e.hp > 0) {
      const oldX = e.x, oldY = e.y, oldAircraftHeading = e.aircraft?.heading, oldVehicleHeading = e.vehicle?.heading
      const unit = runtimeEnemyUnitDef(e.unitDefId, e.kind)
      updateEnemy(s, e, dist, dt)
      if (e.hp > 0) {
        continueFixedWingFlightIfIdle(e, unit, oldX, oldY, oldAircraftHeading, dt)
        enforcePlacementBodyLocks(e, unit, { x: oldX, y: oldY, vehicleHeading: oldVehicleHeading, aircraftHeading: oldAircraftHeading })
        settleWalkerAnimationIfIdle(s, e, unit, dt)
      }
      if (e.vehicle && dt > 0) {
        e.vehicle.vx = (e.x - oldX) / dt
        e.vehicle.vy = (e.y - oldY) / dt
        const vehicleConfig = unitTypeConfig(unit)
        // 气垫和旋翼机的车身朝向都可能与位移方向分离；只有普通地面底盘才由实际位移回填朝向。
        if (vehicleConfig?.kind === 'vehicle' && vehicleConfig.chassis !== 'hovercraft') {
          if (Math.hypot(e.vehicle.vx, e.vehicle.vy) > 1e-4) e.vehicle.heading = Math.atan2(e.vehicle.vx, -e.vehicle.vy)
        }
      }
    }
    beginPlayerUnitDestruction(s)
  }
  endEnginePerfPart('enemyAiMs', enemyAiPerfStartedAt)
  resolveUnitCollisions(s)
  applyFortressVehicleCollisions(s, playerActualVx, playerActualVy)
  rebuildUnitSpatialIndex(s)
  const targetingPerfStartedAt = beginEnginePerfPart()
  for (const enemy of s.enemies) updateEnemyVehicleTurrets(s, enemy, dt)

  // 4) 炮塔索敌与开火（敌方载具炮塔已在上方独立更新；玩家炮塔产热汇聚堡垒）
  if (s.fortress.dyingT < 0) for (const t of [...s.turrets]) updateTurret(s, t, dt)
  coolFortress(s, dt)
  endEnginePerfPart('targetingWeaponsMs', targetingPerfStartedAt)

  // 5) 弹道推进
  const projectilePerfStartedAt = beginEnginePerfPart()
  s.projectiles = s.projectiles.filter(p => {
    if (p.kind === 'bullet') return updateBullet(s, p, dt)
    if (p.kind === 'shell') return updateShell(s, p, dt)
    return updateMissile(s, p, dt)
  })
  s.enemyProjectiles = s.enemyProjectiles.filter(p => updateEnemyProjectile(s, p, dt))
  s.projectiles = s.projectiles.filter(p => !p.intercepted)
  s.enemyProjectiles = s.enemyProjectiles.filter(p => !p.intercepted)
  if (unitProjectileSplitQueue.length > 0) { s.enemyProjectiles.push(...unitProjectileSplitQueue); unitProjectileSplitQueue.length = 0 }
  if (splitSpawnQueue.length > 0) { s.projectiles.push(...splitSpawnQueue); splitSpawnQueue.length = 0 } // v2.20 集束子弹入队
  endEnginePerfPart('projectileMs', projectilePerfStartedAt)

  // 6) 燃烧区域（只结算敌人，§8.3）
  for (const z of s.burnZones) {
    z.timer -= dt
    z.left -= dt
    if (z.timer <= 0) {
      z.timer += z.interval
      for (const e of s.enemies) {
        if (Math.hypot(e.x - z.x, e.y - z.y) <= z.r) damageEnemy(s, e, z.damage, null)
      }
    }
  }
  s.burnZones = s.burnZones.filter(z => z.left > 0)

  // 7) 敌人持续伤害 dot
  for (const e of s.enemies) {
    for (const d of e.dots) {
      d.timer -= dt
      d.left -= dt
      if (d.timer <= 0) { d.timer += d.interval; damageEnemy(s, e, d.damage, null) }
    }
    e.dots = e.dots.filter(d => d.left > 0)
    if (e.bossPhases && e.hp > 0) {
      const done = e.bossPhaseDone ?? (e.bossPhaseDone = [])
      e.bossPhases.forEach((phase, index) => {
        if (!done.includes(index) && e.hp / e.maxHp * 100 <= phase.hpPercent) {
          done.push(index)
          queueEvent(s, e.id, { x: e.x - 1, y: e.y - 1, w: 2, h: 2 }, phase.actions, { sourceUnitId: e.id })
          s.notices.push({ id: s.nextId++, text: `${e.bossName ?? 'Boss'} 进入阶段 ${index + 2}`, left: 3 })
        }
      })
    }
  }

  // 本帧弹道或持续伤害刚造成的单位摧毁，必须在死亡清理与任务结算前触发实例事件。
  updateUnitEvents(s)

  // 8) 击杀结算
  const alive: Enemy[] = []
  for (const e of s.enemies) {
    if (e.hp <= 0) {
      const unit = runtimeEnemyUnitDef(e.unitDefId, e.kind)
      if (e.deathLeft !== undefined) {
        if (e.aircraft?.crash) {
          if (advanceUnitAircraftCrash(e, unit, dt)) {
            emitUnitAircraftCrashImpact(s, e, unit)
            e.deathLeft = 0
          } else {
            e.deathLeft = Math.max(0.001, e.aircraft.crash.duration - e.aircraft.crash.elapsed)
            alive.push(e)
          }
        } else {
          e.deathLeft -= dt
          if (e.deathLeft > 0) alive.push(e)
        }
        continue
      }
      const crashing = beginUnitAircraftCrash(e, unit, s.time)
      e.deathLeft = crashing ? e.aircraft!.crash!.duration : e.vehicle ? 1.1 : 0.65
      if (e.placementId !== undefined && !s.defeatedUnitPlacementIds.includes(e.placementId)) s.defeatedUnitPlacementIds.push(e.placementId)
      if (!crashing) emitUnitDestruction(s, e, unit)
      const combat = unit.combat
      if (e.vehicle) {
        if (!e.vehicle.destroyedFx) {
          e.vehicle.destroyedFx = true
          for (const turret of e.vehicle.turrets ?? []) { turret.firing = false; turret.burstLeft = 0; turret.targetId = null }
        }
      } else if (!crashing) addFloat(s, e.x, e.y, `${unit.name}阵亡`)
      if (unitAttackProfile(unit) === 'kamikaze' && combat && !e.kamikazeResolved) {
        const mode = combat.kamikaze?.destroyedMode ?? 'none'
        resolveEnemyKamikaze(s, e, combat, mode === 'full' ? 1 : mode === 'half' ? 0.5 : 0, false)
      }
      if (!e.kamikazeArrival) {
        const bounty = Math.round(Math.max(0, unit.stats.reward ?? 0) * BOUNTY_MULT)
        s.gold += bounty
        s.kills++
        addFloat(s, e.x, e.y, `+${bounty}`)
        if (e.bossName) {
          queueEvent(s, e.id, { x: e.x - 1, y: e.y - 1, w: 2, h: 2 }, e.bossDefeatActions ?? [], { sourceUnitId: e.id })
          s.notices.push({ id: s.nextId++, text: `${e.bossName} 已被击败`, left: 4 })
        }
      }
      alive.push(e)
    } else {
      alive.push(e)
    }
  }
  s.enemies = alive
  finishEnginePerfFrame(s)

  // 9) 阶段判定（船体归零 → v2.53 毁灭序列；演出期间不判胜、不推进波次，演出毕判负）
  if (s.objective.type === 'defend') {
    const target = s.objective.protectTarget
    const protectionFailed = target === 'core'
      ? !s.core || s.core.hp <= 0
      : typeof target === 'object' && target.type === 'object'
        ? !s.objects.some(object => target.objectIds.includes(object.id) && object.hp !== 0)
        : typeof target === 'object' && target.type === 'unit'
          ? s.defeatedUnitPlacementIds.includes(target.unitPlacementId)
            || ![...s.allies, ...s.enemies].some(unit => unit.placementId === target.unitPlacementId && unit.hp > 0)
          : false
    if (protectionFailed) {
      transitionTaskStage(s, 'failure')
      return s
    }
  }
  beginPlayerUnitDestruction(s)
  if (s.fortress.dyingT >= 0) { advancePlayerUnitDeath(s, dt); return s }
  updateEventQueue(s, 0)
  if ((s.phase as Phase) !== 'combat') return s
  if (s.objective.type === 'reach' && fortressReachedFinish(s)) {
    transitionTaskStage(s, 'success')
    return s
  }
  if (s.objective.type === 'survive' && s.objectiveElapsed >= s.objective.duration) {
    transitionTaskStage(s, 'success')
    return s
  }
  if (s.objective.type === 'destroy') {
    const progress = destroyObjectiveProgress(s)
    if (progress.total > 0 && progress.remaining === 0) {
      transitionTaskStage(s, 'success')
      return s
    }
  }
  if (s.objective.type === 'escort') {
    const escorted = escortAlly(s)
    if (!escorted) { transitionTaskStage(s, 'failure'); return s }
    if (unitInsideZone(escorted, LEVEL.finishZone)) { transitionTaskStage(s, 'success'); return s }
  }
  if (s.spawnQueue.length === 0 && s.ambushQueue.length === 0 && s.eventQueue.length === 0 && s.enemies.length === 0) {
    if (waveDefenseObjective(s.objective) && s.wave >= s.objective.waves) { transitionTaskStage(s, 'success'); return s }
    if (waveDefenseObjective(s.objective) && s.objective.waveWait === false) return s
    if (waveDefenseObjective(s.objective)) {
      s.phase = 'prep'
      s.wave++
      s.prepLeft = s.objective.restTime ?? DEFEND_REST_TIME_DEFAULT
    }
  }
  return s
}
