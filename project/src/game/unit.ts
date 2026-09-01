import {
  ALLY_DEFS, BASE_CELL, DEFAULT_FORTRESS, ENEMY_DEFS, ENEMY_SPRITE, FORTRESS_DEFS, M_PER_CELL, PROJECTILE_ARTS, VEHICLE_PLACEHOLDER_COLOR, m2c,
  type AllyDef, type AllyKind, type EnemyDef, type EnemyKind, type FortressArmor, type FortressDef, type ProjectileArtDef, type UnitDestructionEffect,
} from './config'
import { normalizeEventActions, type LevelBossPhase, type LevelEventAction } from './level'
import { notifyUnitLibraryChanged, unitLibraryRevision } from './unitEvents'
import {
  DEFAULT_UNIT_AI,
  normalizeUnitAI,
  type AIAttackProfile,
  type UnitAI,
  type UnitAISpecial,
  type UnitDeployDirection,
  type UnitTargetKind,
} from './ai/schema'

export {
  DEFAULT_UNIT_AI,
  SIEGE_TARGETS,
  aiRangeDecision,
  computeAIStandingRange,
  normalizeUnitAI,
  targetingAllowsTarget,
  type AIAttackProfile,
  type AIPreferredTarget,
  type AIPositioningProfile,
  type AIMovementProfile,
  type AIRamAvailability,
  type AIRangeDecision,
  type AIStandingRange,
  type AIWeaponRange,
  type AISpecialProfile,
  type AITargetingProfile,
  type UnitAI,
  type UnitAISpecial,
  type UnitDeployDirection,
  type UnitTargetKind,
} from './ai/schema'

/** 单位编辑器第一阶段数据协议；现有各注册表先通过兼容适配器映射进统一单位库。 */
export const UNIT_SCHEMA_VERSION = 5

export type UnitType = 'vehicle' | 'rotorcraft' | 'fixedWingAircraft' | 'building'

/** 单位通用数值；AI 协议位于 game/ai/schema。 */
export interface UnitCommonStats {
  hp: number
  speed: number
  /** 作为敌对单位被击毁时发放的基础资源。 */
  reward?: number
  /** 索敌视野半径（格）；载具由载具基础参数配置，其他旧单位缺省 8 格。 */
  vision?: number
  /** 接战后的目标追踪半径（格）；不得小于索敌视野，旧单位缺省为索敌视野的 1.5 倍。 */
  trackingVision?: number
  /** 旧版圆形碰撞半径（格）；未设置椭圆参数时同时作为横、纵半径。 */
  size: number
  /** 椭圆碰撞横半径（格）。 */
  collisionRadiusX?: number
  /** 椭圆碰撞纵半径（格）。 */
  collisionRadiusY?: number
  air: boolean
}

export interface UnitVisual {
  /** 素材库「单位主体」引用；为空时使用与阵营无关的类型几何占位。 */
  bodyAsset?: string
  /** 战场显示宽高（格）；贴图自身中心始终对齐单位几何中心。 */
  width: number
  height: number
  /** 按素材单帧的原始像素尺寸显示（以 BASE_CELL 对应 100% 战场缩放）。 */
  nativeSize?: boolean
  /** 素材中心相对单位原点的横向偏移（素材像素）。 */
  offsetX?: number
  /** 素材中心相对单位原点的纵向偏移（素材像素）。 */
  offsetY?: number
  /** 开火点相对单位原点的横向偏移（素材像素，正数向右）。 */
  muzzleOffsetX?: number
  /** 开火点相对单位原点的纵向偏移（素材像素，正数向下）。 */
  muzzleOffsetY?: number
  /** 被摧毁时使用的统一视觉模板；旧数据缺省时按主体尺寸自动选择。 */
  destructionEffect?: UnitDestructionEffect
}

/** 旋翼飞行器动态旋翼；坐标以单位几何中心为原点，使用素材像素口径。 */
export interface RotorDef {
  id: string
  asset: string
  /** 相对载具主体的绘制层级；缺省为上方，兼容旧存档。 */
  layer?: 'above' | 'below'
  /** 单个旋翼，或围绕单位中心线按 |x| 镜像的一对旋翼。 */
  unit?: 'single' | 'pair'
  x: number
  y: number
  /** 旋转速度（度/秒）；负值表示反向旋转。 */
  speed: number
}

/**
 * 将一条旋翼配置展开成实际绘制项。
 * 一对旋翼以单位中心线左右镜像，并使用相反角速度；坐标始终保留素材像素口径。
 */
export function rotorPlacements(rotor: RotorDef): Array<{ x: number; y: number; speed: number }> {
  if (rotor.unit === 'pair') {
    const x = Math.abs(rotor.x)
    return [
      { x: -x, y: rotor.y, speed: rotor.speed },
      { x, y: rotor.y, speed: -rotor.speed },
    ]
  }
  return [{ x: rotor.x, y: rotor.y, speed: rotor.speed }]
}

export type UnitTypeConfig =
  | {
    kind: 'vehicle'
    chassis: 'tracked' | 'wheeled' | 'halfTracked' | 'hovercraft' | 'walker'
    armor: FortressArmor
    accel: number
    turnSpeed: number
    turnRadius: number
    reverseFactor: number
    brakeInertia: number
    trackWidth: number
    turnDrag: number
    wheelbase: number
    steerMax: number
    steerRate: number
    gripMax: number
    hoverDrag: number
    hoverGrip: number
    /** 步行机甲单脚完成 7 帧动作时前进的距离（格）。 */
    walkerStride: number
  }
  | {
    kind: 'rotorcraft'
    /** 可分别配置在主体上方或下方的动态旋翼层；未配置时只显示主体。 */
    rotors?: RotorDef[]
    /** 初始/巡航飞行高度（格）。 */
    altitude: number
    /** 事件指令可设置的最低飞行高度（格）。 */
    minAltitude: number
    /** 事件指令可设置的最高飞行高度（格）。 */
    maxAltitude: number
    /** 垂直升降速度（格/秒）。 */
    climbRate: number
    /** 达到最大移动速度所使用的线性加速度（格/秒²）。 */
    accel: number
    /** 平面内最大转向速度（度/秒）。 */
    turnSpeed: number
  }
  | {
    kind: 'fixedWingAircraft'
    /** 初始/巡航飞行高度（格）。 */
    altitude: number
    /** 事件指令可设置的最低飞行高度（格）。 */
    minAltitude: number
    /** 事件指令可设置的最高飞行高度（格）。 */
    maxAltitude: number
    /** 垂直升降速度（格/秒）。 */
    climbRate: number
    /** 从最低航速加速至最大航速所使用的线性加速度（格/秒²）。 */
    accel: number
    /** 最大横摆角速度（度/秒），实际角速度还会受最小转弯半径限制。 */
    turnSpeed: number
    /** 已在空中的固定翼必须保持的最低前进速度（格/秒）。 */
    minSpeed: number
    /** 固定翼盘旋与转向时允许的最小轨迹半径（格）。 */
    turnRadius: number
  }
  | { kind: 'building'; footprintW: number; footprintH: number; blocksMovement: boolean }

export function defaultUnitTypeConfig(type: UnitType): UnitTypeConfig | undefined {
  if (type === 'vehicle') return {
    kind: 'vehicle', chassis: 'tracked', armor: { front: 0, rear: 0, left: 0, right: 0 },
    accel: 3, turnSpeed: 25, turnRadius: 0, reverseFactor: 0.8, brakeInertia: 5,
    trackWidth: 1, turnDrag: 0, wheelbase: 1, steerMax: 35, steerRate: 120, gripMax: 1.024,
    hoverDrag: 0.35, hoverGrip: 0.8, walkerStride: 1,
  }
  if (type === 'rotorcraft') return { kind: 'rotorcraft', rotors: [], altitude: 0.8, minAltitude: 0.2, maxAltitude: 3, climbRate: 1, accel: 4, turnSpeed: 180 }
  if (type === 'fixedWingAircraft') return { kind: 'fixedWingAircraft', altitude: 1.2, minAltitude: 0.5, maxAltitude: 4, climbRate: 0.75, accel: 3, turnSpeed: 90, minSpeed: 1, turnRadius: 2.5 }
  if (type === 'building') return { kind: 'building', footprintW: 1, footprintH: 1, blocksMovement: true }
  return undefined
}

export function unitTypeConfig(def: UnitDef): UnitTypeConfig | undefined {
  const fallback = defaultUnitTypeConfig(def.type)
  if (fallback?.kind === 'vehicle' && def.legacy?.registry === 'fortress') {
    fallback.chassis = def.legacy.def.chassis ?? 'tracked'
    fallback.armor = structuredClone(def.legacy.def.armor ?? fallback.armor)
    fallback.accel = def.legacy.def.accel
    fallback.turnSpeed = def.legacy.def.turnSpeed
    fallback.turnRadius = def.legacy.def.turnRadius ?? fallback.turnRadius
    fallback.reverseFactor = def.legacy.def.reverseFactor ?? fallback.reverseFactor
    fallback.brakeInertia = def.legacy.def.brakeInertia ?? fallback.brakeInertia
    fallback.trackWidth = def.legacy.def.trackWidth ?? fallback.trackWidth
    fallback.turnDrag = def.legacy.def.turnDrag ?? fallback.turnDrag
    fallback.wheelbase = def.legacy.def.wheelbase ?? fallback.wheelbase
    fallback.steerMax = def.legacy.def.steerMax ?? fallback.steerMax
    fallback.steerRate = def.legacy.def.steerRate ?? fallback.steerRate
    fallback.gripMax = def.legacy.def.gripMax ?? fallback.gripMax
    fallback.hoverDrag = def.legacy.def.hoverDrag ?? fallback.hoverDrag
    fallback.hoverGrip = def.legacy.def.hoverGrip ?? fallback.hoverGrip
    fallback.walkerStride = def.legacy.def.walkerStride
      ?? Math.max(0.05, def.stats.speed * 7 * (def.legacy.def.walkerFrameDuration
        ?? (def.legacy.def.walkerFps && def.legacy.def.walkerFps > 0 ? 1 / def.legacy.def.walkerFps : 0.125)))
    // 完整载具以 FortressDef 为唯一底盘来源；忽略旧单位覆盖中可能残留的 typeConfig 副本。
    return fallback
  }
  return fallback && def.typeConfig?.kind === fallback.kind ? def.typeConfig : fallback
}

/** 载具底盘的公开编辑器语义；旧存档缺省仍按履带载具读取。 */
export type VehicleChassis = 'tracked' | 'wheeled' | 'halfTracked' | 'hovercraft' | 'walker'

export function vehicleChassisName(chassis: VehicleChassis): string {
  return chassis === 'wheeled' ? '轮式载具' : chassis === 'halfTracked' ? '半履带载具' : chassis === 'hovercraft' ? '气垫载具' : chassis === 'walker' ? '步行机甲' : '履带载具'
}

export interface UnitCombatStats {
  /** 攻击行为归攻击参数管理，不再属于组合式 AI。 */
  profile?: AIAttackProfile
  /** 攻击距离（格）。 */
  range: number
  /** @deprecated v19 以前的旧 AI 射程比例；仅用于读取旧存档，运行时由 ai.positioning 决定。 */
  preferredRangeRatio?: number
  /** @deprecated v19 以前的旧 AI 射程容差；仅用于读取旧存档，运行时由 ai.positioning 决定。 */
  rangeTolerance?: number
  interval: number
  /** 是否允许把空中单位作为攻击目标；旧数据缺省为允许。 */
  canAir?: boolean
  /** 是否允许把地面单位、建筑或玩家战车作为攻击目标；旧数据缺省为允许。 */
  canGround?: boolean
  /** 完整弹丸库引用；伤害、弹速、穿深、爆炸等都从该条目读取。 */
  projectileId?: string
  /** 旧单位兼容字段；新编辑器不再写入。 */
  damage: number
  projectileSpeed: number
  penetration: number
  projectileAsset?: string
  kamikaze?: {
    /** 爆炸半径（格）；抵达目标时始终造成完整 damage。 */
    radius: number
    /** 被外部伤害击毁时：不爆、50% 伤害或 100% 伤害；半径保持不变。 */
    destroyedMode: 'none' | 'half' | 'full'
  }
}

export type LegacyUnitSource =
  | { registry: 'fortress'; id: string; def: FortressDef }
  | { registry: 'enemy'; id: EnemyKind; def: EnemyDef; spriteGroup: string }
  | { registry: 'ally'; id: AllyKind; def: AllyDef }

/** Boss 是普通单位的可选扩展，不是独立 unitType。 */
export interface UnitBossExtension {
  enabled: boolean
  displayName?: string
  hpScale?: number
  sizeScale?: number
  barColor?: string
  phases?: LevelBossPhase[]
  defeatActions?: LevelEventAction[]
}

export interface UnitDef {
  id: string
  name: string
  /** 空值继承单位类型全局声音；'none' 静音；其他值引用声音预设。 */
  sounds?: { movement?: string; fire?: string }
  type: UnitType
  targetClasses: UnitTargetKind[]
  stats: UnitCommonStats
  visual?: UnitVisual
  combat?: UnitCombatStats
  ai?: UnitAI
  /** 锁定单位平移和主体转向；炮塔逻辑不受影响。 */
  bodyLocked?: boolean
  /** 与 type 对应的差异参数；载具继续使用堡垒专属协议。 */
  typeConfig?: UnitTypeConfig
  /** 飞行器也复用载具的外观、矩形碰撞、炮位、特效点与热管理面板；飞行专属参数仍由 typeConfig 驱动运行时。 */
  vehiclePlatform?: FortressDef
  boss?: UnitBossExtension
  /** 由旧注册表适配的内置单位携带；单位编辑器新建单位无需伪造旧来源。 */
  legacy?: LegacyUnitSource
}

export function fortressUnitId(id: string): string { return `fortress:${id}` }
export function enemyUnitId(kind: EnemyKind): string { return `enemy:${kind}` }
export function allyUnitId(kind: AllyKind): string { return `ally:${kind}` }

function fortressUnit(def: FortressDef): UnitDef {
  return {
    id: def.unitId ?? fortressUnitId(def.id), name: def.name, type: 'vehicle', sounds: def.sounds,
    targetClasses: structuredClone(def.unitTargetClasses ?? ['fortress', 'combatUnit']),
    stats: { hp: def.hp, speed: def.speed, reward: def.unitReward ?? 40, vision: def.vision ?? 8, trackingVision: def.trackingVision ?? (def.vision ?? 8) * 1.5, size: Math.max(def.w, def.h) / 2, air: false },
    visual: { width: def.w, height: def.h, destructionEffect: def.destructionEffect },
    combat: structuredClone(def.unitCombat ?? { profile: 'none', range: 0, interval: 1, damage: 0, projectileSpeed: 0, penetration: 0 }),
    ai: normalizeUnitAI(def.unitAI ?? DEFAULT_UNIT_AI),
    boss: def.unitBoss ? structuredClone(def.unitBoss) : undefined,
    bodyLocked: def.bodyLocked === true || undefined,
    legacy: { registry: 'fortress', id: def.id, def },
  }
}

function enemyUnit(kind: EnemyKind, def: EnemyDef): UnitDef {
  return {
    id: enemyUnitId(kind), name: def.name, type: def.air ? 'rotorcraft' : 'vehicle',
    targetClasses: ['combatUnit'],
    stats: { hp: def.hp, speed: def.speed, reward: def.bounty, vision: 8, trackingVision: 12, size: def.size, air: def.air },
    combat: { profile: 'projectile', range: def.attackRange, preferredRangeRatio: 1, rangeTolerance: 0.05, interval: def.attackInterval, projectileId: 'bullet_std', damage: def.projectileDamage, projectileSpeed: def.projectileSpeed, penetration: def.penetration },
    // 当前五类敌人保持测试期远程实弹行为；后续在单位编辑器中逐项改为可编辑组合。
    ai: { preferredTarget: 'playerControlled', positioning: def.air ? 'shortestRange' : 'longestRange', movement: def.air ? 'closeIn' : 'stop' },
    legacy: { registry: 'enemy', id: kind, def, spriteGroup: ENEMY_SPRITE[kind] },
  }
}

function allyUnit(kind: AllyKind, def: AllyDef): UnitDef {
  const type: UnitType = def.air ? 'rotorcraft' : 'vehicle'
  return {
    id: allyUnitId(kind), name: def.name, type, targetClasses: ['combatUnit'],
    stats: { hp: def.hp, speed: def.speed, reward: 0, vision: 8, trackingVision: 12, size: def.size, air: def.air },
    combat: { profile: 'hitscan', range: m2c(def.range), preferredRangeRatio: 1, rangeTolerance: 0.08, interval: def.interval, projectileId: 'ray_std', damage: def.damage, projectileSpeed: 0, penetration: 0 },
    ai: { preferredTarget: 'allHostile', positioning: 'longestRange', movement: 'stop' },
    legacy: { registry: 'ally', id: kind, def },
  }
}

/** 战斗循环的快速适配入口，避免每帧为了一个旧单位重建完整单位库。 */
export function enemyUnitDef(kind: EnemyKind): UnitDef {
  const compatibleKind: EnemyKind = kind && kind in ENEMY_DEFS ? kind : 'walker'
  return customUnitDefs.find(def => def.id === enemyUnitId(compatibleKind)) ?? enemyUnit(compatibleKind, ENEMY_DEFS[compatibleKind])
}
export function allyUnitDef(kind: AllyKind): UnitDef {
  return customUnitDefs.find(def => def.id === allyUnitId(kind)) ?? allyUnit(kind, ALLY_DEFS[kind])
}

/** 运行时实体优先按稳定 unitDefId 解析；旧快照没有引用时回退 kind 适配器。 */
export function runtimeEnemyUnitDef(unitDefId: string | undefined, kind: EnemyKind): UnitDef {
  return (unitDefId ? unitDefById(unitDefId) : undefined) ?? enemyUnitDef(kind)
}

export function runtimeAllyUnitDef(unitDefId: string | undefined, kind: AllyKind): UnitDef {
  return (unitDefId ? unitDefById(unitDefId) : undefined) ?? allyUnitDef(kind)
}

/** 自定义单位仍借用一个旧实体 kind 作为几何/颜色回退；逻辑数值始终来自 unitDefId。 */
export function enemyKindForUnit(def: UnitDef): EnemyKind {
  if (def.legacy?.registry === 'enemy') return def.legacy.id
  if (def.stats.air || def.type === 'rotorcraft' || def.type === 'fixedWingAircraft') return 'flyer'
  if (def.type === 'vehicle' || def.type === 'building') return 'brute'
  return 'walker'
}

export function allyKindForUnit(def: UnitDef): AllyKind {
  if (def.legacy?.registry === 'ally') return def.legacy.id
  if (def.stats.air || def.type === 'rotorcraft' || def.type === 'fixedWingAircraft') return 'plane'
  if (def.type === 'vehicle') return 'tank'
  return 'soldier'
}

function builtinUnitLibrary(): UnitDef[] {
  const rotorcraft: UnitDef = {
    id: 'unit:uav', name: '无人飞行器', type: 'rotorcraft',
    targetClasses: ['combatUnit'], stats: { hp: 120, speed: 3, reward: 18, vision: 8, trackingVision: 12, size: 0.45, air: true },
    visual: { width: 1.2, height: 1.2, offsetX: 0, offsetY: 0, muzzleOffsetX: 0, muzzleOffsetY: -12 },
    typeConfig: { kind: 'rotorcraft', altitude: 0.8, minAltitude: 0.2, maxAltitude: 3, climbRate: 1, accel: 4, turnSpeed: 180 },
    combat: { profile: 'projectile', range: 8, preferredRangeRatio: 0.9, rangeTolerance: 0.08, interval: 1.2, projectileId: 'bullet_std', damage: 5, projectileSpeed: 51.2, penetration: 3 },
    ai: { preferredTarget: 'allHostile', positioning: 'shortestRange', movement: 'closeIn', special: { profile: 'none' } },
  }
  // 旧版错误快照不得遮住真正的内置单位；编辑器主动转换并带显式标记的载具则允许覆盖。
  const reservedNonVehicleIds = new Set([rotorcraft.id])
  const fortresses = FORTRESS_DEFS
    .filter(def => !reservedNonVehicleIds.has(def.unitId ?? fortressUnitId(def.id)) || def.explicitUnitTypeOverride === true)
    .map(fortressUnit)
  const result = [...fortresses]
  if (!result.some(unit => unit.id === rotorcraft.id)) result.push(rotorcraft)
  return result
}

// persist.ts 会在其后把自定义载具并入 FORTRESS_DEFS；先冻结真正的出厂单位 ID，避免自定义载具被误标成“内置”。
const FACTORY_UNIT_IDS = new Set(builtinUnitLibrary().map(def => def.id))

export interface UnitLibraryData { version: number; customs: UnitDef[] }

const UNIT_LIBRARY_VERSION = 19 // v19：战斗 AI 收口为首选目标、站位与移动，旧组合字段自动迁移
const UNIT_LIBRARY_KEY = 'td-unit-library'
let customUnitDefs: UnitDef[] = []
let unitLibraryPersistFailed = false

function unitStorage(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage } catch { return null }
}

function loadCustomUnitDefs(): void {
  const st = unitStorage()
  if (!st) return
  try {
    const parsed = JSON.parse(st.getItem(UNIT_LIBRARY_KEY) ?? 'null') as UnitLibraryData | null
    if (!parsed || ![1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, UNIT_LIBRARY_VERSION].includes(parsed.version) || !Array.isArray(parsed.customs)) return
    // #25：旧敌人/友军/临时自定义模板退役；堡垒定义由独立堡垒库保留。
    // v9 首次执行可逆的飞行器类型迁移；v8 自定义单位必须保留，不能沿用旧版整库清空策略。
    customUnitDefs = parsed.version < 8 ? [] : parsed.customs
      .filter(def => !['infantry', 'creature'].includes(String(def.type)))
      .map(def => migrateLegacyUnitMetrics(def, parsed.version))
      .map(def => normalizeKamikazeConfig(def))
      .filter(def => def && typeof def.id === 'string' && validateUnitDef(def).length === 0)
    if (parsed.version < UNIT_LIBRARY_VERSION) persistCustomUnitDefs()
  } catch { /* 坏数据静默回落内置单位 */ }
}

function persistCustomUnitDefs(): void {
  const st = unitStorage()
  if (!st) { unitLibraryPersistFailed = true; return }
  try {
    st.setItem(UNIT_LIBRARY_KEY, JSON.stringify({ version: UNIT_LIBRARY_VERSION, customs: customUnitDefs } satisfies UnitLibraryData))
    unitLibraryPersistFailed = false
  } catch { unitLibraryPersistFailed = true }
}

loadCustomUnitDefs()

let unitLibraryCacheRevision = -1
let unitLibraryCacheFortressLength = -1
let unitLibraryCacheFortressTail: FortressDef | undefined
let unitLibraryCache: UnitDef[] = []
let unitLibraryByIdCache = new Map<string, UnitDef>()
const legacyRuntimeUnitCache = new Map<string, UnitDef>()

function rebuildUnitLibraryCache(): void {
  const result = builtinUnitLibrary()
  for (const custom of customUnitDefs) {
    const index = result.findIndex(def => def.id === custom.id)
    if (index >= 0) result.splice(index, 1, custom)
    else result.push(custom)
  }
  unitLibraryCache = result
  unitLibraryByIdCache = new Map(result.map(def => [def.id, def]))
  unitLibraryCacheRevision = unitLibraryRevision()
  unitLibraryCacheFortressLength = FORTRESS_DEFS.length
  unitLibraryCacheFortressTail = FORTRESS_DEFS.at(-1)
}

/** 动态读取统一单位库；仅在单位/载具定义实际变化时重建，而不是在每个实体、每个渲染帧重复组装。 */
export function unitLibrary(): UnitDef[] {
  if (
    unitLibraryCacheRevision !== unitLibraryRevision()
    || unitLibraryCacheFortressLength !== FORTRESS_DEFS.length
    || unitLibraryCacheFortressTail !== FORTRESS_DEFS.at(-1)
  ) rebuildUnitLibraryCache()
  return unitLibraryCache
}

let playableVehicleCacheUnits: UnitDef[] | null = null
let playableVehicleCacheFortressLength = -1
let playableVehicleCacheFortressTail: FortressDef | undefined
let playableVehicleCache: FortressDef[] = []

/**
 * 所有可由玩家整备并出战的平台共用此入口。
 * 地面载具直接引用堡垒库；旋翼/固定翼从统一单位库的载具平台实时投影，
 * 从而不再为了出战额外保存一份容易过期的飞行器定义。
 */
export function playableVehicleDefs(): FortressDef[] {
  const units = unitLibrary()
  if (
    playableVehicleCacheUnits === units
    && playableVehicleCacheFortressLength === FORTRESS_DEFS.length
    && playableVehicleCacheFortressTail === FORTRESS_DEFS.at(-1)
  ) return playableVehicleCache
  const result = [...FORTRESS_DEFS]
  const usedIds = new Set(result.map(def => def.id))
  for (const unit of units) {
    if (unit.type !== 'rotorcraft' && unit.type !== 'fixedWingAircraft') continue
    const config = unitTypeConfig(unit)
    const width = Math.max(0.25, unit.visual?.width ?? unit.stats.size * 2)
    const height = Math.max(0.25, unit.visual?.height ?? unit.stats.size * 2)
    const source = unit.vehiclePlatform ? structuredClone(unit.vehiclePlatform) : structuredClone(DEFAULT_FORTRESS)
    source.id = unit.vehiclePlatform?.id || `unit-platform:${unit.id}`
    if (usedIds.has(source.id)) continue
    source.unitId = unit.id
    source.explicitUnitTypeOverride = true
    source.platformType = unit.type
    source.chassis = 'hovercraft'
    source.name = unit.name
    source.w = width
    source.h = height
    source.shape = unit.vehiclePlatform?.shape ?? Array.from({ length: Math.ceil(width) * Math.ceil(height) }, (_, index) => `${index % Math.ceil(width)},${Math.floor(index / Math.ceil(width))}`)
    source.spriteBody = unit.visual?.bodyAsset ?? source.spriteBody
    source.destructionEffect = unit.visual?.destructionEffect ?? source.destructionEffect
    source.hp = unit.stats.hp
    source.speed = unit.stats.speed
    source.vision = unit.stats.vision ?? source.vision ?? 8
    source.trackingVision = unit.stats.trackingVision ?? source.trackingVision ?? source.vision * 1.5
    source.unitReward = unit.stats.reward ?? source.unitReward ?? 40
    source.unitTargetClasses = structuredClone(unit.targetClasses)
    source.unitCombat = unit.combat ? structuredClone(unit.combat) : undefined
    source.unitAI = unit.ai ? structuredClone(unit.ai) : undefined
    source.unitBoss = unit.boss ? structuredClone(unit.boss) : undefined
    source.bodyLocked = unit.bodyLocked === true || undefined
    source.sounds = unit.sounds ? { movement: unit.sounds.movement } : undefined
    source.color = VEHICLE_PLACEHOLDER_COLOR
    source.tracks = undefined
    source.wheels = undefined
    if (config?.kind === 'rotorcraft') {
      source.rotors = structuredClone(config.rotors ?? source.rotors ?? [])
      source.altitude = config.altitude
      source.minAltitude = config.minAltitude
      source.maxAltitude = config.maxAltitude
      source.climbRate = config.climbRate
      source.accel = config.accel
      source.turnSpeed = config.turnSpeed
      source.minFlightSpeed = undefined
      source.flightTurnRadius = undefined
    } else if (config?.kind === 'fixedWingAircraft') {
      source.rotors = undefined
      source.altitude = config.altitude
      source.minAltitude = config.minAltitude
      source.maxAltitude = config.maxAltitude
      source.climbRate = config.climbRate
      source.accel = config.accel
      source.turnSpeed = config.turnSpeed
      source.minFlightSpeed = config.minSpeed
      source.flightTurnRadius = config.turnRadius
    }
    usedIds.add(source.id)
    result.push(source)
  }
  playableVehicleCacheUnits = units
  playableVehicleCacheFortressLength = FORTRESS_DEFS.length
  playableVehicleCacheFortressTail = FORTRESS_DEFS.at(-1)
  playableVehicleCache = result
  return playableVehicleCache
}

export function listCustomUnitDefs(): UnitDef[] { return customUnitDefs }
/** 旧版曾把完整载具写入单位库；启动迁移读取后应立即移除。 */
export function listLegacyCustomFortressUnitDefs(): UnitDef[] {
  return customUnitDefs.filter(def => def.type === 'vehicle')
}
export function isBuiltinUnitId(id: string): boolean { return FACTORY_UNIT_IDS.has(id) }
export function isBuiltinUnitOverridden(id: string): boolean {
  return isBuiltinUnitId(id) && customUnitDefs.some(def => def.id === id)
}
export function unitLibraryPersistHasFailed(): boolean { return unitLibraryPersistFailed }

export function saveCustomUnitDef(def: UnitDef): boolean {
  // 完整载具只允许写入 FortressDef；否则旧快照会覆盖载具库的最新物理/外观参数。
  if (def.type === 'vehicle') return false
  const copy = stripUnitDeathSound(normalizeKamikazeConfig(def))
  if (validateUnitDef(copy).length > 0) return false
  const index = customUnitDefs.findIndex(item => item.id === copy.id)
  if (index >= 0) customUnitDefs.splice(index, 1, copy)
  else customUnitDefs.push(copy)
  persistCustomUnitDefs()
  notifyUnitLibraryChanged({ id: copy.id, operation: 'save' })
  return true
}

/** 自定义单位直接删除；同 ID 内置覆盖删除后自动显露内置定义。 */
export function deleteCustomUnitDef(id: string): boolean {
  const index = customUnitDefs.findIndex(def => def.id === id)
  if (index < 0) return false
  customUnitDefs.splice(index, 1)
  persistCustomUnitDefs()
  notifyUnitLibraryChanged({ id, operation: 'delete' })
  return true
}

export function unitLibraryForExport(): UnitLibraryData {
  return { version: UNIT_LIBRARY_VERSION, customs: structuredClone(customUnitDefs) }
}

export function importUnitLibrary(data: UnitLibraryData | undefined): void {
  if (!data || !Array.isArray(data.customs)) return
  for (const raw of data.customs) {
    if (['infantry', 'creature'].includes(String(raw.type))) continue
    const def = normalizeKamikazeConfig(migrateLegacyUnitMetrics(raw, data.version))
    if (!def || validateUnitDef(def).length > 0) continue
    const index = customUnitDefs.findIndex(item => item.id === def.id)
    if (index >= 0) customUnitDefs.splice(index, 1, def)
    else customUnitDefs.push(def)
  }
  persistCustomUnitDefs()
  notifyUnitLibraryChanged({ operation: 'import' })
}

function migrateLegacyUnitMetrics(raw: UnitDef, version: number): UnitDef {
  const next = structuredClone(raw)
  stripUnitDeathSound(next)
  if (version < 13) {
    const scale = M_PER_CELL / 25
    if (next.combat?.projectileSpeed !== undefined) next.combat.projectileSpeed *= scale
    if (next.typeConfig?.kind === 'vehicle') next.typeConfig.gripMax *= scale
  }
  if (version < 16) {
    // 旋翼坐标从定义之初就是素材像素；旧载具通用输入框却误做了 pixelsToCells，
    // 因而 v15 及更早实际保存的是目标像素值 / BASE_CELL。升级时恢复真实像素值。
    const restoreRotorPixels = (rotors: RotorDef[] | undefined) => {
      for (const rotor of rotors ?? []) {
        rotor.x = Math.round(rotor.x * BASE_CELL * 10000) / 10000
        rotor.y = Math.round(rotor.y * BASE_CELL * 10000) / 10000
      }
    }
    if (next.typeConfig?.kind === 'rotorcraft') restoreRotorPixels(next.typeConfig.rotors)
    restoreRotorPixels(next.vehiclePlatform?.rotors)
  }
  if (version < 17) {
    const defaultRotorLayers = (rotors: RotorDef[] | undefined) => {
      for (const rotor of rotors ?? []) rotor.layer = 'above'
    }
    if (next.typeConfig?.kind === 'rotorcraft') defaultRotorLayers(next.typeConfig.rotors)
    defaultRotorLayers(next.vehiclePlatform?.rotors)
  }
  return next
}

/** v18：单位编辑器不再保存死亡音效；旧字段只在迁移入口读取后清除。 */
function stripUnitDeathSound<T extends UnitDef>(def: T): T {
  if (def.sounds) {
    delete (def.sounds as typeof def.sounds & { death?: string }).death
    if (!def.sounds.movement && !def.sounds.fire) delete def.sounds
  }
  return def
}

export function unitDefById(id: string): UnitDef | undefined {
  unitLibrary()
  const current = unitLibraryByIdCache.get(id)
  if (current) return current
  const cachedLegacy = legacyRuntimeUnitCache.get(id)
  if (cachedLegacy) return cachedLegacy
  if (id.startsWith('enemy:')) {
    const kind = id.slice(6) as EnemyKind
    if (kind in ENEMY_DEFS) {
      const resolved = enemyUnit(kind, ENEMY_DEFS[kind])
      legacyRuntimeUnitCache.set(id, resolved)
      return resolved
    }
  }
  if (id.startsWith('ally:')) {
    const kind = id.slice(5) as AllyKind
    if (kind in ALLY_DEFS) {
      const resolved = allyUnit(kind, ALLY_DEFS[kind])
      legacyRuntimeUnitCache.set(id, resolved)
      return resolved
    }
  }
  return undefined
}

export function unitAttackProfile(def: UnitDef): AIAttackProfile {
  const legacyAttack = (def.ai as unknown as { attack?: { profile?: AIAttackProfile } } | undefined)?.attack?.profile
  return def.combat?.profile ?? legacyAttack ?? 'none'
}

export function unitProjectile(def: UnitDef): ProjectileArtDef | undefined {
  return PROJECTILE_ARTS.find(item => item.id === def.combat?.projectileId)
}

/** 实弹与即时命中完全由弹丸库供给战斗数值；旧字段仅保留在存档结构中，不参与运行时结算。 */
export function resolvedUnitCombat(def: UnitDef): UnitCombatStats & { damage: number; projectileSpeed: number; penetration: number; projectileAsset?: string } {
  const combat = def.combat ?? { profile: 'none', range: 0, interval: 1, damage: 0, projectileSpeed: 0, penetration: 0 }
  const projectile = unitProjectile(def)
  const projectileDriven = unitAttackProfile(def) === 'projectile' || unitAttackProfile(def) === 'hitscan'
  return {
    ...combat,
    // 实弹与即时命中都必须绑定当前弹丸库条目；旧 combat 数值只供近战、自爆和脚本攻击使用。
    profile: projectileDriven && !projectile ? 'none' : unitAttackProfile(def),
    damage: projectileDriven ? projectile?.damage ?? 0 : combat.damage ?? 0,
    projectileSpeed: projectileDriven ? projectile?.speed ?? 0 : 0,
    penetration: projectileDriven ? projectile?.penetration ?? 0 : 0,
    projectileAsset: projectileDriven ? projectile?.projectileAsset : undefined,
  }
}

/** v1/v2 自爆草稿没有专属参数；加载时补安全默认值，避免旧定义失效。 */
export function normalizeKamikazeConfig(raw: UnitDef): UnitDef {
  const legacy = structuredClone(raw) as unknown as {
    type: UnitType | 'aircraft' | 'infantry' | 'creature'
    typeConfig?: UnitTypeConfig | { kind: 'aircraft'; altitude?: number; accel?: number; turnSpeed?: number; shadowScale?: number } | { kind: 'infantry'; animationFps?: number; strideBob?: number } | { kind: 'creature' }
    stats: UnitCommonStats
  }
  // v8 及更早的 aircraft 使用的正是当前可悬停求解器，因此无损迁移为旋翼飞行器。
  if (legacy.type === 'aircraft') {
    const old = legacy.typeConfig?.kind === 'aircraft' ? legacy.typeConfig : undefined
    legacy.type = 'rotorcraft'
    legacy.typeConfig = {
      kind: 'rotorcraft',
      altitude: Number.isFinite(old?.altitude) ? old!.altitude! : 0.8,
      minAltitude: 0.2,
      maxAltitude: 3,
      climbRate: 1,
      accel: Number.isFinite(old?.accel) ? old!.accel! : 4,
      turnSpeed: Number.isFinite(old?.turnSpeed) ? old!.turnSpeed! : 180,
    }
    legacy.stats.air = true
  }
  const def = legacy as UnitDef
  // 类型决定单位是否处于空中；修复旧自定义旋翼/固定翼数据残留 air=false 后误用地面碰撞与寻路的问题。
  def.stats.air = def.type === 'rotorcraft' || def.type === 'fixedWingAircraft'
  const legacyAI = def.ai as unknown as {
    attack?: { profile?: AIAttackProfile }
    movement?: { preferredRangeRatio?: number; rangeTolerance?: number }
    special?: UnitAISpecial
  } | undefined
  def.bodyLocked = def.bodyLocked === true || undefined
  const vision = Number.isFinite(def.stats.vision) ? Math.max(0, Math.min(200, def.stats.vision!)) : 8
  def.stats.vision = vision
  def.stats.trackingVision = Math.max(vision, Math.min(300, Number.isFinite(def.stats.trackingVision) ? def.stats.trackingVision! : vision * 1.5))
  def.stats.reward = Math.max(0, Number.isFinite(def.stats.reward) ? def.stats.reward! : def.stats.air ? 18 : 40)
  // 阵营与控制器只属于关卡中的放置实例。旧模板字段只做兼容读取，不再继续保存。
  delete (def as UnitDef & { faction?: unknown }).faction
  delete (def as UnitDef & { controller?: unknown }).controller
  const legacyMovement = legacyAI?.movement
  if (legacyMovement) {
    if (legacyMovement.preferredRangeRatio !== undefined || legacyMovement.rangeTolerance !== undefined) {
      def.combat ??= { profile: legacyAI?.attack?.profile ?? 'none', range: 0, interval: 1, damage: 0, projectileSpeed: 0, penetration: 0 }
      def.combat.preferredRangeRatio ??= legacyMovement.preferredRangeRatio
      def.combat.rangeTolerance ??= legacyMovement.rangeTolerance
    }
  }
  if (legacyAI) {
    def.ai = normalizeUnitAI(legacyAI)
    const special = def.ai.special as UnitAISpecial | undefined
    if (special?.profile === 'deployForces') {
      const legacySpecial = special as typeof special & { stopDistance?: number; direction?: UnitDeployDirection }
      special.unitDefId = typeof special.unitDefId === 'string' ? special.unitDefId : fortressUnitId(FORTRESS_DEFS[0]?.id ?? 'default')
      special.count = Math.max(1, Math.min(99, Math.round(Number(special.count) || 1)))
      special.interval = Math.max(0.1, Math.min(60, Number(special.interval) || 0.5))
      special.direction = ['front', 'rear', 'left', 'right'].includes(legacySpecial.direction ?? '') ? legacySpecial.direction! : 'rear'
      delete legacySpecial.stopDistance
    } else def.ai.special = { profile: 'none' }
  }
  if (def.combat) {
    def.combat.profile ??= legacyAI?.attack?.profile ?? 'none'
    def.combat.canAir ??= true
    def.combat.canGround ??= true
    if (def.combat.projectileId === 'pulse_std') def.combat.projectileId = 'ray_std'
  }
  if (def.combat && !def.combat.projectileId && def.combat.projectileAsset) def.combat.projectileId = 'bullet_std'
  if (unitAttackProfile(def) === 'kamikaze') {
    const hadKamikazeConfig = !!def.combat?.kamikaze
    def.combat ??= { profile: 'kamikaze', range: 0.5, interval: 1, damage: 100, projectileSpeed: 0, penetration: 0 }
    // v1/v2 曾把 range 当作普通武器射程；只迁移缺少自爆配置的旧草稿，尊重 v3 的自定义引爆距离。
    if (!hadKamikazeConfig) def.combat.range = 0.5
    def.combat.kamikaze ??= { radius: 1.5, destroyedMode: 'none' }
  }
  const defaultConfig = defaultUnitTypeConfig(def.type)
  if (defaultConfig?.kind === 'vehicle') {
    const existing = def.typeConfig?.kind === 'vehicle'
      ? def.typeConfig as typeof def.typeConfig & { walkerFrames?: number; walkerFps?: number; walkerFrameDuration?: number }
      : undefined
    def.typeConfig = {
      ...defaultConfig,
      ...existing,
      armor: { ...defaultConfig.armor, ...(existing?.armor ?? {}) },
      walkerStride: Number.isFinite(existing?.walkerStride) && existing!.walkerStride > 0
        ? existing!.walkerStride
        : Math.max(0.05, def.stats.speed * 7 * (Number.isFinite(existing?.walkerFrameDuration)
          ? existing!.walkerFrameDuration!
          : Number.isFinite(existing?.walkerFps) && existing!.walkerFps! > 0 ? 1 / existing!.walkerFps! : 0.125)),
    }
    delete (def.typeConfig as unknown as { walkerFrames?: number }).walkerFrames
    delete (def.typeConfig as unknown as { walkerFps?: number }).walkerFps
    delete (def.typeConfig as unknown as { walkerFrameDuration?: number }).walkerFrameDuration
  } else if (defaultConfig?.kind === 'rotorcraft') {
    const existing = def.typeConfig?.kind === 'rotorcraft'
      ? def.typeConfig as typeof def.typeConfig & { shadowScale?: number; accel?: number; turnSpeed?: number }
      : undefined
    def.typeConfig = {
      ...defaultConfig,
      rotors: Array.isArray(existing?.rotors) ? existing.rotors.map((rotor, index) => ({
        id: typeof rotor.id === 'string' && rotor.id ? rotor.id : `rotor${index + 1}`,
        asset: typeof rotor.asset === 'string' ? rotor.asset : '',
        layer: rotor.layer === 'below' ? 'below' : 'above',
        unit: rotor.unit === 'pair' ? 'pair' : 'single',
        x: Number.isFinite(rotor.x) ? rotor.x : 0,
        y: Number.isFinite(rotor.y) ? rotor.y : 0,
        speed: Number.isFinite(rotor.speed) ? rotor.speed : 720,
      })) : [],
      altitude: Number.isFinite(existing?.altitude) ? existing!.altitude : defaultConfig.altitude,
      minAltitude: Number.isFinite(existing?.minAltitude) ? existing!.minAltitude : defaultConfig.minAltitude,
      maxAltitude: Number.isFinite(existing?.maxAltitude) ? existing!.maxAltitude : defaultConfig.maxAltitude,
      climbRate: Number.isFinite(existing?.climbRate) ? existing!.climbRate : defaultConfig.climbRate,
      accel: Number.isFinite(existing?.accel) ? existing!.accel! : defaultConfig.accel,
      turnSpeed: Number.isFinite(existing?.turnSpeed) ? existing!.turnSpeed! : defaultConfig.turnSpeed,
    }
  } else if (defaultConfig?.kind === 'fixedWingAircraft') {
    const existing = def.typeConfig?.kind === 'fixedWingAircraft' ? def.typeConfig : undefined
    def.typeConfig = {
      ...defaultConfig,
      ...existing,
      altitude: Number.isFinite(existing?.altitude) ? existing!.altitude : defaultConfig.altitude,
      minAltitude: Number.isFinite(existing?.minAltitude) ? existing!.minAltitude : defaultConfig.minAltitude,
      maxAltitude: Number.isFinite(existing?.maxAltitude) ? existing!.maxAltitude : defaultConfig.maxAltitude,
      climbRate: Number.isFinite(existing?.climbRate) ? existing!.climbRate : defaultConfig.climbRate,
      accel: Number.isFinite(existing?.accel) ? existing!.accel : defaultConfig.accel,
      turnSpeed: Number.isFinite(existing?.turnSpeed) ? existing!.turnSpeed : defaultConfig.turnSpeed,
      minSpeed: Number.isFinite(existing?.minSpeed) ? existing!.minSpeed : defaultConfig.minSpeed,
      turnRadius: Number.isFinite(existing?.turnRadius) ? existing!.turnRadius : defaultConfig.turnRadius,
    }
  } else if (defaultConfig && def.typeConfig?.kind !== defaultConfig.kind) def.typeConfig = defaultConfig
  if (!defaultConfig) delete def.typeConfig
  if (def.boss?.enabled) {
    def.boss.barColor ??= '#B3392E'
    def.boss.phases = (def.boss.phases ?? []).slice(0, 8).map(phase => ({
      hpPercent: Math.max(1, Math.min(99, Number(phase.hpPercent) || 50)),
      actions: normalizeEventActions(phase.actions),
    })).sort((a, b) => b.hpPercent - a.hpPercent)
    def.boss.defeatActions = normalizeEventActions(def.boss.defeatActions)
  }
  return def
}

export function unitAltitude(def: UnitDef): number {
  const config = unitTypeConfig(def)
  return config?.kind === 'rotorcraft' || config?.kind === 'fixedWingAircraft' ? config.altitude : 0
}

/** 飞行阴影由高度自动推导：高度越高，阴影越小且更淡；不再保存单位级参数。 */
export function unitShadowScale(def: UnitDef, altitude = unitAltitude(def)): number {
  return Math.max(0.55, Math.min(1, 1 - altitude * 0.08))
}

export function unitShadowOpacity(def: UnitDef, altitude = unitAltitude(def)): number {
  return Math.max(0.1, Math.min(0.25, 0.25 - altitude * 0.025))
}

export function unitFootprint(def: UnitDef): { w: number; h: number; blocksMovement: boolean } {
  const config = unitTypeConfig(def)
  return config?.kind === 'building'
    ? { w: config.footprintW, h: config.footprintH, blocksMovement: config.blocksMovement }
    : { w: 1, h: 1, blocksMovement: false }
}

/** 单位实际椭圆碰撞半径；兼容仅保存 size 的旧单位。 */
export function unitCollisionRadii(def: UnitDef): { x: number; y: number } {
  return {
    x: def.stats.collisionRadiusX ?? def.stats.size,
    y: def.stats.collisionRadiusY ?? def.stats.size,
  }
}

export function validateUnitDef(def: UnitDef): string[] {
  const errors: string[] = []
  if (!['vehicle', 'rotorcraft', 'fixedWingAircraft', 'building'].includes(String(def.type))) errors.push('单位类型已停用')
  if (!def.id.trim()) errors.push('单位 id 不能为空')
  if (!def.name.trim()) errors.push('单位名称不能为空')
  if (!Number.isFinite(def.stats.hp) || def.stats.hp <= 0) errors.push('单位生命必须是大于 0 的有限数值')
  if (!Number.isFinite(def.stats.speed) || def.stats.speed < 0) errors.push('单位速度必须是大于等于 0 的有限数值')
  const vision = def.stats.vision ?? 8
  if (!Number.isFinite(vision) || vision < 0) errors.push('索敌视野必须是大于等于 0 的有限数值')
  if (def.stats.trackingVision !== undefined && (!Number.isFinite(def.stats.trackingVision) || def.stats.trackingVision < vision || def.stats.trackingVision > 300)) errors.push('追踪视野必须在索敌视野至 960 米之间')
  if (!(def.stats.size > 0)) errors.push('单位尺寸必须大于 0')
  if (def.stats.reward !== undefined && (!Number.isFinite(def.stats.reward) || def.stats.reward < 0)) errors.push('击毁奖励必须是大于等于 0 的有限数值')
  if (def.stats.collisionRadiusX !== undefined && (!Number.isFinite(def.stats.collisionRadiusX) || def.stats.collisionRadiusX <= 0)) errors.push('碰撞横半径必须是大于 0 的有限数值')
  if (def.stats.collisionRadiusY !== undefined && (!Number.isFinite(def.stats.collisionRadiusY) || def.stats.collisionRadiusY <= 0)) errors.push('碰撞纵半径必须是大于 0 的有限数值')
  if (def.visual && (!(def.visual.width > 0) || !(def.visual.height > 0))) errors.push('单位显示宽高必须大于 0')
  if (def.visual?.offsetX !== undefined && !Number.isFinite(def.visual.offsetX)) errors.push('素材中心横向偏移必须是有限数值')
  if (def.visual?.offsetY !== undefined && !Number.isFinite(def.visual.offsetY)) errors.push('素材中心纵向偏移必须是有限数值')
  if (def.visual?.muzzleOffsetX !== undefined && !Number.isFinite(def.visual.muzzleOffsetX)) errors.push('开火点横向偏移必须是有限数值')
  if (def.visual?.muzzleOffsetY !== undefined && !Number.isFinite(def.visual.muzzleOffsetY)) errors.push('开火点纵向偏移必须是有限数值')
  if (def.visual?.destructionEffect !== undefined && !['small', 'medium', 'large', 'violent'].includes(def.visual.destructionEffect)) errors.push('摧毁效果模板非法')
  if (def.combat) {
    if (!(def.combat.range >= 0)) errors.push('攻击距离不能为负数')
    if (!(def.combat.interval > 0)) errors.push('攻击间隔必须大于 0')
    if (def.combat.damage !== undefined && !(def.combat.damage >= 0)) errors.push('攻击伤害不能为负数')
    if (def.combat.projectileSpeed !== undefined && !(def.combat.projectileSpeed >= 0)) errors.push('弹丸速度不能为负数')
    if (def.combat.penetration !== undefined && !(def.combat.penetration >= 0)) errors.push('穿深不能为负数')
    if (def.combat.kamikaze) {
      if (!(def.combat.kamikaze.radius > 0)) errors.push('自爆半径必须大于 0')
      if (!['none', 'half', 'full'].includes(def.combat.kamikaze.destroyedMode)) errors.push('被击毁爆炸档位非法')
    }
  }
  if ((unitAttackProfile(def) === 'projectile' || unitAttackProfile(def) === 'hitscan') && !unitProjectile(def)) errors.push('实弹或即时命中攻击必须选择有效弹丸')
  if (unitAttackProfile(def) === 'kamikaze' && !def.combat?.kamikaze) errors.push('自爆攻击缺少自爆参数')
  if (def.typeConfig && def.typeConfig.kind !== def.type) errors.push('类型专属参数与单位类型不匹配')
  if (def.typeConfig?.kind === 'vehicle') {
    if (!['tracked', 'wheeled', 'halfTracked', 'hovercraft', 'walker'].includes(def.typeConfig.chassis)) errors.push('载具类型仅支持履带载具、轮式载具、半履带载具、气垫载具或步行机甲')
    if (Object.values(def.typeConfig.armor).some(value => !Number.isFinite(value) || value < 0 || value > 10000)) errors.push('载具四向装甲须在 [0, 10000]')
    if (!(def.typeConfig.accel >= 0)) errors.push('载具加速度不能为负数')
    if (!(def.typeConfig.turnSpeed >= 0)) errors.push('载具转向速度不能为负数')
    if (!(def.typeConfig.reverseFactor >= 0 && def.typeConfig.reverseFactor <= 1)) errors.push('载具倒车系数须在 [0, 1]')
    if (!(def.typeConfig.brakeInertia >= 1 && def.typeConfig.brakeInertia <= 10)) errors.push('载具刹停惯性须在 [1, 10]')
    if (def.typeConfig.chassis !== 'hovercraft' && def.typeConfig.chassis !== 'walker' && !(def.typeConfig.turnRadius >= 0)) errors.push('载具转弯半径不能为负数')
    if ((def.typeConfig.chassis === 'tracked' || def.typeConfig.chassis === 'halfTracked') && !(def.typeConfig.trackWidth > 0)) errors.push('履带间距必须大于 0')
    if ((def.typeConfig.chassis === 'tracked' || def.typeConfig.chassis === 'halfTracked') && !(def.typeConfig.turnDrag >= 0 && def.typeConfig.turnDrag <= 0.9)) errors.push('履带转向阻力须在 [0, 0.9]')
    if ((def.typeConfig.chassis === 'wheeled' || def.typeConfig.chassis === 'halfTracked') && !(def.typeConfig.wheelbase > 0)) errors.push('轮式轴距必须大于 0')
    if ((def.typeConfig.chassis === 'wheeled' || def.typeConfig.chassis === 'halfTracked') && !(def.typeConfig.steerMax > 0 && def.typeConfig.steerMax <= 90)) errors.push('最大前轮转角须在 (0, 90]')
    if ((def.typeConfig.chassis === 'wheeled' || def.typeConfig.chassis === 'halfTracked') && !(def.typeConfig.steerRate > 0)) errors.push('方向盘转速必须大于 0')
    if ((def.typeConfig.chassis === 'wheeled' || def.typeConfig.chassis === 'halfTracked') && !(def.typeConfig.gripMax > 0)) errors.push('横向附着上限必须大于 0')
    if (def.typeConfig.chassis === 'hovercraft' && !(def.typeConfig.hoverDrag >= 0.05 && def.typeConfig.hoverDrag <= 5)) errors.push('气垫滑行阻力须在 [0.05, 5]')
    if (def.typeConfig.chassis === 'hovercraft' && !(def.typeConfig.hoverGrip >= 0 && def.typeConfig.hoverGrip <= 10)) errors.push('气垫横向稳定须在 [0, 10]')
    if (def.typeConfig.chassis === 'walker' && !(def.typeConfig.walkerStride >= 0.05 && def.typeConfig.walkerStride <= 20)) errors.push('步行机甲步幅须在 [0.16, 64] 米')
  } else if (def.typeConfig?.kind === 'rotorcraft') {
    if (!(def.typeConfig.altitude >= 0 && def.typeConfig.altitude <= 10)) errors.push('飞行高度须在 [0, 32] 米')
    if (!(def.typeConfig.minAltitude >= 0 && def.typeConfig.minAltitude <= def.typeConfig.altitude)) errors.push('最低飞行高度须在 [0, 初始高度]')
    if (!(def.typeConfig.maxAltitude >= def.typeConfig.altitude && def.typeConfig.maxAltitude <= 10)) errors.push('最高飞行高度须在 [初始高度, 10]')
    if (!(def.typeConfig.climbRate > 0 && def.typeConfig.climbRate <= 10)) errors.push('升降速度须在 (0, 32] 米/秒')
    if (!(def.typeConfig.accel > 0 && def.typeConfig.accel <= 100)) errors.push('飞行加速度须在 (0, 100]')
    if (!(def.typeConfig.turnSpeed > 0 && def.typeConfig.turnSpeed <= 1080)) errors.push('飞行转向速度须在 (0, 1080] 度/秒')
    const rotorIds = new Set<string>()
    for (const rotor of def.typeConfig.rotors ?? []) {
      if (!rotor.id || rotorIds.has(rotor.id)) errors.push('旋翼 ID 不能为空或重复')
      rotorIds.add(rotor.id)
      if (!rotor.asset) errors.push(`旋翼 ${rotor.id || '未命名'} 缺少素材`)
      if (rotor.layer !== undefined && rotor.layer !== 'above' && rotor.layer !== 'below') errors.push(`旋翼 ${rotor.id || '未命名'} 层级仅支持上或下`)
      if (rotor.unit !== undefined && rotor.unit !== 'single' && rotor.unit !== 'pair') errors.push(`旋翼 ${rotor.id || '未命名'} 单位仅支持单个或一对`)
      if (!Number.isFinite(rotor.x) || !Number.isFinite(rotor.y)) errors.push(`旋翼 ${rotor.id || '未命名'} 坐标必须是有限数值`)
      if (!Number.isFinite(rotor.speed) || Math.abs(rotor.speed) > 10000) errors.push(`旋翼 ${rotor.id || '未命名'} 旋转速度须在 [-10000, 10000] 度/秒`)
    }
  } else if (def.typeConfig?.kind === 'fixedWingAircraft') {
    if (!(def.typeConfig.altitude >= 0 && def.typeConfig.altitude <= 10)) errors.push('飞行高度须在 [0, 32] 米')
    if (!(def.typeConfig.minAltitude >= 0 && def.typeConfig.minAltitude <= def.typeConfig.altitude)) errors.push('最低飞行高度须在 [0, 初始高度]')
    if (!(def.typeConfig.maxAltitude >= def.typeConfig.altitude && def.typeConfig.maxAltitude <= 10)) errors.push('最高飞行高度须在 [初始高度, 10]')
    if (!(def.typeConfig.climbRate > 0 && def.typeConfig.climbRate <= 10)) errors.push('升降速度须在 (0, 32] 米/秒')
    if (!(def.typeConfig.accel > 0 && def.typeConfig.accel <= 100)) errors.push('固定翼加速度须在 (0, 100]')
    if (!(def.typeConfig.turnSpeed > 0 && def.typeConfig.turnSpeed <= 1080)) errors.push('固定翼转向速度须在 (0, 1080] 度/秒')
    if (!(def.typeConfig.minSpeed > 0 && def.typeConfig.minSpeed <= def.stats.speed)) errors.push('固定翼最低航速须大于 0 且不超过最大移动速度')
    if (!(def.typeConfig.turnRadius > 0 && def.typeConfig.turnRadius <= 100)) errors.push('固定翼最小转弯半径须在 (0, 320] 米')
  } else if (def.typeConfig?.kind === 'building') {
    if (!Number.isInteger(def.typeConfig.footprintW) || !Number.isInteger(def.typeConfig.footprintH)
      || def.typeConfig.footprintW < 1 || def.typeConfig.footprintW > 12 || def.typeConfig.footprintH < 1 || def.typeConfig.footprintH > 12) errors.push('建筑占格宽高须为 1~12 的整数')
  }
  if (def.boss?.enabled) {
    if (def.boss.barColor && !/^#[0-9a-f]{6}$/i.test(def.boss.barColor)) errors.push('Boss 血条颜色须为 #RRGGBB')
    const phases = def.boss.phases ?? []
    if (phases.length > 8 || phases.some(phase => !(phase.hpPercent >= 1 && phase.hpPercent <= 99))) errors.push('Boss 阶段阈值须在 1%~99%，且最多 8 个阶段')
    if (new Set(phases.map(phase => phase.hpPercent)).size !== phases.length) errors.push('Boss 阶段阈值不能重复')
  }
  if (def.ai && !['playerControlled', 'playerFaction', 'allHostile'].includes(def.ai.preferredTarget)) errors.push('首选目标非法')
  if (def.ai && !['longestRange', 'optimalRange', 'shortestRange'].includes(def.ai.positioning)) errors.push('站位类型非法')
  if (def.ai && !['orbit', 'keepFar', 'closeIn', 'stop', 'ram'].includes(def.ai.movement)) errors.push('移动类型非法')
  if (def.ai?.special?.profile === 'deployForces') {
    if (!def.ai.special.unitDefId.trim()) errors.push('投送单位不能为空')
    if (def.ai.special.unitDefId === def.id) errors.push('投送兵力不能选择当前单位自身')
    if (!Number.isInteger(def.ai.special.count) || def.ai.special.count < 1 || def.ai.special.count > 99) errors.push('投送总数须为 1~99 的整数')
    if (!(def.ai.special.interval >= 0.1 && def.ai.special.interval <= 60)) errors.push('投送间隔须在 0.1~60 秒')
    if (!['front', 'rear', 'left', 'right'].includes(def.ai.special.direction)) errors.push('投送方向非法')
  }
  return errors
}

/** 兼容旧运行时/测试快照中的命名；新状态只写入右侧的新目标类别。 */
export function migrateLegacyTargetKind(kind: string | null | undefined): UnitTargetKind | null {
  if (kind == null) return null
  if (kind === 'core') return 'fortress'
  if (kind === 'building') return 'fixedBuilding'
  if (kind === 'ally') return 'combatUnit'
  return (['fortress', 'coreBuilding', 'fixedBuilding', 'wall', 'turret', 'combatUnit', 'object'] as const).includes(kind as UnitTargetKind)
    ? kind as UnitTargetKind : null
}
