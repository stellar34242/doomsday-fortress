/** debug 数据持久化（localStorage，模式同 level.ts）：TURRET_DEFS / PROJECTILE_ARTS 全量 JSON。
 *  模块初始化时加载并就地替换注册表内容（splice，保持 import 引用有效，引擎/render 零改动）；
 *  无存储环境（sim/node）解析失败均静默用默认。version 不符 → 丢弃用默认。 */
import { DEFAULT_FORTRESS, FORTRESS_DEFS, MODULE_DEFS, M_PER_CELL, PROJECTILE_ARTS, SHIELD_MODULE_DEFS, TURRET_DEFS, VEHICLE_PLACEHOLDER_COLOR, turretAmmoExchangeRate, turretEnergyCapacity } from './config'
import type { FortressDef, ModuleDef, ProjectileArtDef, TurretDef } from './config'
import { notifyUnitLibraryChanged } from './unitEvents'
import {
  deleteCustomUnitDef, fortressUnitId, listLegacyCustomFortressUnitDefs, playableVehicleDefs, unitTypeConfig,
  type UnitDef,
} from './unit'

export const TURRET_DEFS_KEY = 'td-turret-defs'
const TURRET_DEFS_SCHEMA_KEY = 'td-turret-defs-schema'
const TURRET_DEFS_SCHEMA_VERSION = 17 // v17：新增炮塔弹药汇率，补给恢复量按汇率换算
export const PROJECTILE_ARTS_KEY = 'td-projectile-arts'
const PROJECTILE_ARTS_SCHEMA_KEY = 'td-projectile-arts-schema'
const PROJECTILE_ARTS_SCHEMA_VERSION = 11 // v11：删除自带固定尾焰的旧 missile_s，并迁移为 missile2_s
export const FORTRESS_LIB_KEY = 'td-fortress-lib-v1'
const VERSION = 2 // v2：fireRate 语义 轮/s → s/轮（v1 数据加载时取倒数迁移）

interface Envelope<T> { version: number; data: T[] }

function serialize<T>(data: T[]): string {
  const env: Envelope<T> = { version: VERSION, data }
  return JSON.stringify(env)
}

function parse<T>(json: string): T[] | null {
  try {
    const o = JSON.parse(json) as Envelope<T> | null
    if (!o || !Array.isArray(o.data)) return null
    if (o.version === 1) { // v1 → v2：fireRate 旧语义（轮/s）取倒数；缺失/0 值跳过
      for (const d of o.data as { fireRate?: unknown }[]) {
        if (typeof d.fireRate === 'number' && Number.isFinite(d.fireRate) && d.fireRate > 0) d.fireRate = 1 / d.fireRate
      }
    } else if (o.version !== VERSION) return null
    return o.data
  } catch {
    return null
  }
}

export const serializeTurretDefs = (defs: TurretDef[]): string => serialize(defs.map(migrateBeamTurretSounds))
export const parseTurretDefs = (json: string): TurretDef[] | null => parse(json)
export const serializeProjectileArts = (arts: ProjectileArtDef[]): string => serialize(arts)
export const parseProjectileArts = (json: string): ProjectileArtDef[] | null => parse(json)
// v2.30 模块库（MODULE_DEFS 注册表化，同 TURRET_DEFS 全量 JSON 模式；声明须在 load() 之前避免 TDZ）
export const MODULE_DEFS_KEY = 'td-module-defs'
export const MODULE_DEFS_SCHEMA_KEY = 'td-module-defs-schema'
export const MODULE_DEFS_SCHEMA_VERSION = 9 // v9：模块效果显式选择主控或玩家阵营；旧模块保持玩家阵营共享
export const serializeModuleDefs = (defs: ModuleDef[]): string => serialize(defs)
export const parseModuleDefs = (json: string): ModuleDef[] | null => parse(json)

function storage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null
    return localStorage
  } catch {
    return null
  }
}

// 出厂默认快照（加载替换前留存；resetAll 恢复用）
const FACTORY_TURRETS = JSON.parse(JSON.stringify(TURRET_DEFS)) as TurretDef[]
const FACTORY_AMMO = JSON.parse(JSON.stringify(PROJECTILE_ARTS)) as ProjectileArtDef[]
const FACTORY_MODULES = JSON.parse(JSON.stringify(MODULE_DEFS)) as ModuleDef[]
const FACTORY_MISSILE_INTERCEPT_HP: Readonly<Record<string, number>> = { rocket_std: 20, custom_ammo_1: 12 }

const LEGACY_M_PER_CELL = 25
const LEGACY_METRIC_SCALE = M_PER_CELL / LEGACY_M_PER_CELL
const scaleLegacyMeters = (value: number | undefined) => value === undefined ? undefined : value * LEGACY_METRIC_SCALE

/** 旧存档的米制数值按格数等价迁移：旧米数/25 = 新米数/3.2。 */
export function migrateLegacyTurretMetrics(def: TurretDef): TurretDef {
  const next = structuredClone(def)
  next.rangeMin *= LEGACY_METRIC_SCALE
  next.rangeMax *= LEGACY_METRIC_SCALE
  next.projectileSpeed = scaleLegacyMeters(next.projectileSpeed)
  next.guideDecel = scaleLegacyMeters(next.guideDecel)
  next.missileInitSpeed = scaleLegacyMeters(next.missileInitSpeed)
  next.missileAccel = scaleLegacyMeters(next.missileAccel)
  next.missileMaxSpeed = scaleLegacyMeters(next.missileMaxSpeed)
  next.accuracy = scaleLegacyMeters(next.accuracy)
  next.blastRadius = scaleLegacyMeters(next.blastRadius)
  next.beamWidth = scaleLegacyMeters(next.beamWidth)
  if (next.split?.range !== undefined) next.split.range *= LEGACY_METRIC_SCALE
  if (next.onDestroyBlast) next.onDestroyBlast.radius *= LEGACY_METRIC_SCALE
  return next
}

/** 只迁移可明确识别的旧出厂炮口，用户改过任一坐标后都保持原值。 */
export function migrateLegacyTurretArt(def: TurretDef): TurretDef {
  const next = structuredClone(def)
  const barrels = next.art?.barrels
  const isLegacyFactoryMg = next.id === 'mg' && barrels?.length === 2
    && barrels[0].mount[0] === -0.1 && barrels[0].mount[1] === 0.25
    && barrels[1].mount[0] === 0.1 && barrels[1].mount[1] === 0.25
    && barrels[0].muzzle[0] === -0.1 && barrels[0].muzzle[1] === 0.65
    && barrels[1].muzzle[0] === 0.1 && barrels[1].muzzle[1] === 0.65
  if (isLegacyFactoryMg) {
    barrels[0].muzzle[1] = 0.625
    barrels[1].muzzle[1] = 0.625
  }
  return next
}

/** 四个可见层统一为“显式素材或无”；旧缺省/geo 不再触发程序化几何绘制。 */
export function migrateTurretLayerDefaults(def: TurretDef): TurretDef {
  const next = structuredClone(def)
  if (!next.art) return next
  const keys = ['baseAsset', 'turretAsset', 'barrelAsset', 'flashAsset'] as const
  for (const key of keys) {
    if (!next.art[key] || next.art[key] === 'geo') next.art[key] = 'none'
  }
  return next
}

/** 旧开火素材改作连发循环、旧连发结束素材改作新的开火收尾；素材与预设 ID 均保持稳定。 */
export function migrateTurretBurstSounds(def: TurretDef): TurretDef {
  const next = structuredClone(def)
  const sounds = next.sounds as (NonNullable<TurretDef['sounds']> & { burstEnd?: string }) | undefined
  if (sounds?.burstEnd) {
    const oldFire = sounds.fire
    sounds.fire = sounds.burstEnd
    sounds.burstLoop = oldFire ?? sounds.burstEnd
    delete sounds.burstEnd
  }
  return next
}

const RETIRED_CLUSTER_LASER_ID = 'custom-1787847910626-3'

/** 旧射线子模式与指定旧炮塔退役：其余射线炮塔统一迁为持续光束。 */
export function migrateRetiredRayTurret(def: TurretDef): TurretDef | null {
  if (def.id === 'pulse' || def.id === RETIRED_CLUSTER_LASER_ID || def.name === '集束激光炮') return null
  const next = structuredClone(def) as TurretDef & { rayMode?: unknown }
  delete next.rayMode
  if (next.type === 'beam' && next.art?.projectile === 'pulse_std') next.art.projectile = 'ray_std'
  return next
}

/** 射线停火阶段不再播放一次性装填声；持续声由新 continuous 槽控制。 */
export function migrateBeamTurretSounds(def: TurretDef): TurretDef {
  const next = structuredClone(def)
  if (next.type !== 'beam' || !next.sounds) return next
  delete (next.sounds as NonNullable<TurretDef['sounds']> & { reload?: string }).reload
  return next
}

/** 合并旧持续武器的双冷却参数，并清除已废弃的 reload / gpu 字段。 */
export function migrateRetiredTurretFields(def: TurretDef): TurretDef {
  const next = structuredClone(def) as TurretDef & { reload?: unknown; gpu?: unknown }
  if ((next.type === 'beam' || next.type === 'spray') && typeof next.reload === 'number' && Number.isFinite(next.reload)) {
    next.fireRate = Math.max(next.fireRate, next.reload)
  }
  delete next.reload
  delete next.gpu
  return next
}

/** 旧炮塔没有独立容量：按既有消耗项补齐 100；不消耗该资源则保持 0。 */
export function migrateTurretResourceCapacity(def: TurretDef): TurretDef {
  const legacy = def as TurretDef & { ammoPerShot?: unknown }
  const next = structuredClone(def) as TurretDef & { ammoPerShot?: unknown }
  next.ammoCapacity = Number.isFinite(next.ammoCapacity)
    ? Math.max(0, next.ammoCapacity ?? 0)
    : ((typeof legacy.ammoPerShot === 'number' && legacy.ammoPerShot > 0)
      || next.type === 'direct'
      || next.type === 'lob'
      || next.type === 'missile'
      || (next.ammoPerSec ?? 0) > 0) ? 100 : 0
  next.energyCapacity = turretEnergyCapacity(next)
  next.ammoExchangeRate = turretAmmoExchangeRate(next)
  delete next.ammoPerShot
  return next
}

/** 标准脉冲射线弹丸已退役；其即时命中伤害并入唯一保留的射线条目。 */
export function migrateRetiredPulseProjectiles(arts: ProjectileArtDef[]): ProjectileArtDef[] {
  const retired = arts.find(art => art.id === 'pulse_std')
  return arts
    .filter(art => art.id !== 'pulse_std')
    .map(art => art.id === 'ray_std' && (!Number.isFinite(art.damage) || (art.damage ?? 0) <= 0)
      ? { ...art, damage: retired?.damage ?? FACTORY_AMMO.find(factory => factory.id === 'ray_std')?.damage ?? 26 }
      : art)
}

/** 仅修复短暂 v7 迁移曾把旧连发结束直接放入 burstLoop 的本地数据。 */
function repairV7TurretBurstSounds(def: TurretDef): TurretDef {
  const next = structuredClone(def)
  if (next.sounds?.fire && next.sounds.burstLoop) {
    const oldFire = next.sounds.fire
    next.sounds.fire = next.sounds.burstLoop
    next.sounds.burstLoop = oldFire
  }
  return next
}

/**
 * 短暂版本曾把编辑器中的“0px 轴心”直接保存成归一化 [0,0]，战斗侧因此把炮塔
 * 向左上平移半个旧美术范围。新口径的 0px 表示几何中心，统一迁回 [0.5,0.5]。
 */
export function migrateLegacyZeroTurretAnchor(def: TurretDef): TurretDef {
  const next = structuredClone(def)
  if (next.art?.anchor?.[0] === 0 && next.art.anchor[1] === 0) next.art.anchor = [0.5, 0.5]
  return next
}

/** 弹丸库与炮塔库共用同一米制迁移比例，视觉粒子格参数不参与换算。 */
export function migrateLegacyProjectileMetrics(def: ProjectileArtDef): ProjectileArtDef {
  const next = structuredClone(def)
  next.speed = scaleLegacyMeters(next.speed)
  next.blastRadius = scaleLegacyMeters(next.blastRadius)
  next.guideDecel = scaleLegacyMeters(next.guideDecel)
  next.missileInitSpeed = scaleLegacyMeters(next.missileInitSpeed)
  next.missileAccel = scaleLegacyMeters(next.missileAccel)
  next.missileMaxSpeed = scaleLegacyMeters(next.missileMaxSpeed)
  if (next.split?.range !== undefined) next.split.range *= LEGACY_METRIC_SCALE
  return next
}

/** 为旧导弹条目补齐拦截配置；出厂条目沿用新版默认，自定义导弹采用可拦截、1 点耐久。 */
export function migrateProjectileInterception(def: ProjectileArtDef, factory?: ProjectileArtDef, preferFactoryDefaults = false): ProjectileArtDef {
  const next = { ...(factory ?? {}), ...structuredClone(def) } as ProjectileArtDef
  if (next.kind === 'missile') {
    if (preferFactoryDefaults && factory) {
      next.interceptable = factory.interceptable ?? true
      next.interceptHp = FACTORY_MISSILE_INTERCEPT_HP[factory.id] ?? factory.interceptHp ?? 1
    } else {
      next.interceptable ??= true
      next.interceptHp ??= factory?.interceptHp ?? 1
    }
  }
  return next
}

/** 旧垂发独立转向贴图迁入统一 projectileAsset，并清除废弃字段。 */
export function migrateVerticalLaunchProjectileAsset(def: ProjectileArtDef): ProjectileArtDef {
  const next = structuredClone(def)
  const legacy = next.verticalLaunch as (NonNullable<ProjectileArtDef['verticalLaunch']> & { asset?: string }) | undefined
  if (legacy?.asset) next.projectileAsset = legacy.asset
  if (legacy) delete legacy.asset
  return next
}

/** 旧 upload-1 是自带固定尾焰的 missile_s；素材退役后统一改用无固定尾焰的现行导弹弹体。 */
export function migrateRetiredStandardMissileAsset(def: ProjectileArtDef): ProjectileArtDef {
  const next = structuredClone(def)
  if (next.projectileAsset === 'upload-1') next.projectileAsset = 'builtin:library/missile2_s'
  return next
}

/** 保留用户自定义模块，仅为旧模块库补入新版本增加的出厂模块。 */
export function migrateModuleDefs(defs: ModuleDef[], fromVersion: number): ModuleDef[] {
  const next = JSON.parse(JSON.stringify(defs)) as ModuleDef[]
  if (fromVersion < 4) {
    for (const factory of SHIELD_MODULE_DEFS) {
      if (!next.some(d => d.id === factory.id)) next.push(JSON.parse(JSON.stringify(factory)) as ModuleDef)
    }
  }
  if (fromVersion < 6) {
    const generator = next.find(d => d.id === 'shield_generator')
    if (generator) {
      if (generator.maxCount === undefined) generator.maxCount = 1
      if (generator.desc === '护盾上限 300 · 回复 12/s · 回复每点耗电 0.35（限装一台）') {
        generator.desc = '护盾上限 300 · 回复 12/s · 回复每点耗电 0.35'
      }
    }
  }
  if (fromVersion < 7) {
    for (const module of next) if (module.produce && !module.produce.unitDefId) module.produce.unitDefId = `ally:${module.produce.kind}`
  }
  if (fromVersion < 8) {
    for (const module of next) {
      if (!module.produce) continue
      if (module.produce.unitDefId === 'ally:soldier' || module.produce.unitDefId === 'ally:plane') {
        module.produce.kind = 'plane'
        module.produce.unitDefId = 'unit:uav'
      } else if (module.produce.unitDefId === 'ally:tank') {
        module.produce.kind = 'tank'
        module.produce.unitDefId = 'fortress:standard'
      }
    }
  }
  for (const module of next) {
    if (module.effectTarget !== 'controller' && module.effectTarget !== 'playerFaction') module.effectTarget = 'playerFaction'
  }
  return next
}

function load() {
  const st = storage()
  if (!st) return
  try {
    const tj = st.getItem(TURRET_DEFS_KEY)
    if (tj) {
      const migrated = tj.includes('"version":1') // v1 旧语义数据 → 迁移后回写 version 2
      const defs = parseTurretDefs(tj)
      if (defs) {
        const schema = Number(st.getItem(TURRET_DEFS_SCHEMA_KEY) ?? 0)
        const upgradedBase = schema < TURRET_DEFS_SCHEMA_VERSION ? defs.map(def => {
          const factory = FACTORY_TURRETS.find(item => item.id === def.id)
          const artUpgraded = factory?.art ? { ...def, art: { ...factory.art, ...def.art, projectile: factory.art.projectile ?? def.art?.projectile } } : def
          const metricUpgraded = schema < 5 ? migrateLegacyTurretMetrics(artUpgraded) : artUpgraded
          const artMigrated = schema < 6 ? migrateLegacyTurretArt(metricUpgraded) : metricUpgraded
          const soundMigrated = schema < 7 ? migrateTurretBurstSounds(artMigrated) : artMigrated
          const burstRepaired = schema === 7 ? repairV7TurretBurstSounds(soundMigrated) : soundMigrated
          return schema < 9 ? migrateLegacyZeroTurretAnchor(burstRepaired) : burstRepaired
        }) : defs
        const upgraded = upgradedBase.map(migrateRetiredRayTurret).filter((def): def is TurretDef => def !== null)
          .map(migrateBeamTurretSounds)
          .map(migrateRetiredTurretFields)
          .map(migrateTurretLayerDefaults)
          .map(migrateTurretResourceCapacity)
        TURRET_DEFS.splice(0, TURRET_DEFS.length, ...upgraded)
        if (migrated || schema < TURRET_DEFS_SCHEMA_VERSION) {
          st.setItem(TURRET_DEFS_KEY, serializeTurretDefs(upgraded))
          st.setItem(TURRET_DEFS_SCHEMA_KEY, String(TURRET_DEFS_SCHEMA_VERSION))
        }
      }
    }
    const aj = st.getItem(PROJECTILE_ARTS_KEY)
    if (aj) {
      const arts = parseProjectileArts(aj)
      if (arts) {
        const schema = Number(st.getItem(PROJECTILE_ARTS_SCHEMA_KEY) ?? 0)
        const missingFactoryEntries = FACTORY_AMMO.filter(factory => !arts.some(art => art.id === factory.id))
        const missingCombatData = arts.some(art => {
          const factory = FACTORY_AMMO.find(item => item.id === art.id)
          return factory?.damage !== undefined && art.damage === undefined
        })
        const missingInterceptionData = arts.some(art => art.kind === 'missile' && (art.interceptable === undefined || art.interceptHp === undefined))
        const needsMigration = schema < PROJECTILE_ARTS_SCHEMA_VERSION || missingFactoryEntries.length > 0 || missingCombatData || missingInterceptionData
        const migratedBase = needsMigration
          ? [
              ...arts.map(art => {
                const metricUpgraded = schema < 4 ? migrateLegacyProjectileMetrics(art) : art
                const factory = FACTORY_AMMO.find(candidate => candidate.id === art.id)
                const interceptionUpgraded = migrateProjectileInterception(metricUpgraded, factory, schema < 7)
                const verticalLaunchUpgraded = schema < 8 ? migrateVerticalLaunchProjectileAsset(interceptionUpgraded) : interceptionUpgraded
                return migrateRetiredStandardMissileAsset(verticalLaunchUpgraded)
              }),
              ...missingFactoryEntries,
            ]
          : arts
        const migrated = migrateRetiredPulseProjectiles(migratedBase)
        PROJECTILE_ARTS.splice(0, PROJECTILE_ARTS.length, ...migrated)
        if (needsMigration) {
          st.setItem(PROJECTILE_ARTS_KEY, serializeProjectileArts(migrated))
          st.setItem(PROJECTILE_ARTS_SCHEMA_KEY, String(PROJECTILE_ARTS_SCHEMA_VERSION))
        }
      }
    }
    const mj = st.getItem(MODULE_DEFS_KEY) // v2.30 模块库
    if (mj) {
      const mods = parseModuleDefs(mj)
      if (mods) {
        const schema = Number(st.getItem(MODULE_DEFS_SCHEMA_KEY) ?? 0)
        const migrated = migrateModuleDefs(mods, schema)
        MODULE_DEFS.splice(0, MODULE_DEFS.length, ...migrated)
        if (schema < MODULE_DEFS_SCHEMA_VERSION) {
          st.setItem(MODULE_DEFS_KEY, serializeModuleDefs(migrated))
          st.setItem(MODULE_DEFS_SCHEMA_KEY, String(MODULE_DEFS_SCHEMA_VERSION))
        }
      }
    }
  } catch { /* 静默用默认 */ }
}
load() // 模块初始化即加载（import persist 的模块求值时完成）

export function saveTurretDefs() {
  const st = storage()
  if (!st) return
  try { st.setItem(TURRET_DEFS_KEY, serializeTurretDefs(TURRET_DEFS)); st.setItem(TURRET_DEFS_SCHEMA_KEY, String(TURRET_DEFS_SCHEMA_VERSION)) } catch { /* 无存储环境静默 */ }
}

export function saveProjectileArts() {
  const st = storage()
  if (!st) return
  try {
    st.setItem(PROJECTILE_ARTS_KEY, serializeProjectileArts(PROJECTILE_ARTS))
    st.setItem(PROJECTILE_ARTS_SCHEMA_KEY, String(PROJECTILE_ARTS_SCHEMA_VERSION))
  } catch { /* 静默 */ }
}

export function saveModuleDefs() {
  const st = storage()
  if (!st) return
  try {
    st.setItem(MODULE_DEFS_KEY, serializeModuleDefs(MODULE_DEFS))
    st.setItem(MODULE_DEFS_SCHEMA_KEY, String(MODULE_DEFS_SCHEMA_VERSION))
  } catch { /* 静默 */ }
}

/** v2.30 仅模块库回出厂（就地替换 + 清 key；不影响炮塔/弹丸库） */
export function resetModuleDefsToFactory() {
  MODULE_DEFS.splice(0, MODULE_DEFS.length, ...JSON.parse(JSON.stringify(FACTORY_MODULES)) as ModuleDef[])
  const st = storage()
  if (!st) return
  try {
    st.removeItem(MODULE_DEFS_KEY)
    st.removeItem(MODULE_DEFS_SCHEMA_KEY)
  } catch { /* 静默 */ }
}

/** 所有 debug 编辑（bump）后调用 */
export function saveAll() {
  saveTurretDefs()
  saveProjectileArts()
  saveModuleDefs()
}

/** 重置：内置+自定义全清回出厂（就地替换），并清除两个存储 key（刷新不再出现） */
export function resetPersistedToDefaults() {
  const factory = JSON.parse(JSON.stringify(FACTORY_TURRETS)) as TurretDef[]
  TURRET_DEFS.splice(0, TURRET_DEFS.length, ...factory)
  PROJECTILE_ARTS.splice(0, PROJECTILE_ARTS.length, ...JSON.parse(JSON.stringify(FACTORY_AMMO)) as ProjectileArtDef[])
  MODULE_DEFS.splice(0, MODULE_DEFS.length, ...JSON.parse(JSON.stringify(FACTORY_MODULES)) as ModuleDef[]) // v2.30 模块库一并回出厂
  const st = storage()
  if (!st) return
  try {
    st.removeItem(TURRET_DEFS_KEY)
    st.removeItem(TURRET_DEFS_SCHEMA_KEY)
    st.removeItem(PROJECTILE_ARTS_KEY)
    st.removeItem(PROJECTILE_ARTS_SCHEMA_KEY)
    st.removeItem(MODULE_DEFS_KEY)
    st.removeItem(MODULE_DEFS_SCHEMA_KEY)
  } catch { /* 静默 */ }
}


// ================= 堡垒类型库（自定义堡垒 + 出战选择；内置堡垒只读，不持久化内置条目） =================

export interface FortressLibData { version: number; customs: FortressDef[]; selectedId: string }

const FORTRESS_LIB_VERSION = 10 // v10：删除载具单位级死亡音效，统一使用全局单位毁灭音效
/** 堡垒库版本连续向前兼容；避免手写白名单在升版时遗漏中间版本。 */
export function isSupportedFortressLibVersion(version: unknown): version is number {
  return typeof version === 'number' && Number.isInteger(version) && version >= 1 && version <= FORTRESS_LIB_VERSION
}
/** 出厂内置堡垒快照（合并覆盖前留存；删除内置覆盖 = 恢复出厂） */
const FACTORY_FORTRESSES = JSON.parse(JSON.stringify(FORTRESS_DEFS)) as FortressDef[]
let customFortresses: FortressDef[] = []
let selectedFortressId: string = DEFAULT_FORTRESS.id

/** color 保留在存档结构中兼容旧数据，但载具占位色不再允许按单位配置。 */
function normalizeFortress(def: FortressDef): FortressDef {
  const next: FortressDef = structuredClone(def)
  next.bodyLocked = next.bodyLocked === true || undefined
  if (next.sounds) {
    delete (next.sounds as typeof next.sounds & { death?: string }).death
    if (!next.sounds.movement) delete next.sounds
  }
  // 旧数据若只有底座素材则迁为载具素材；同时存在时以旧主体为准。底座层此后不再保存或渲染。
  if (!next.spriteBody && next.spriteBase && next.spriteBase !== 'none') next.spriteBody = next.spriteBase
  delete next.spriteBase
  next.color = VEHICLE_PLACEHOLDER_COLOR
  // 炮塔定义退役后同步解除旧载具中的预装引用，避免留下无法渲染/无法卸下的空槽位。
  for (const hardpoint of next.hardpoints) {
    if (hardpoint.hideTurretArt === undefined && hardpoint.hidden) hardpoint.hideTurretArt = true
    delete hardpoint.hidden
    if (hardpoint.builtIn && !TURRET_DEFS.some(turret => turret.id === hardpoint.builtIn)) delete hardpoint.builtIn
    if (!hardpoint.builtIn) delete hardpoint.lockedTurret
    else hardpoint.lockedTurret = hardpoint.lockedTurret === true || undefined
  }
  next.vision = Math.max(0, Math.min(200, Number.isFinite(next.vision) ? next.vision! : 8))
  next.trackingVision = Math.max(next.vision, Math.min(300, Number.isFinite(next.trackingVision) ? next.trackingVision! : next.vision * 1.5))
  if (next.chassis === 'hovercraft') {
    next.hoverDrag = Number.isFinite(next.hoverDrag) ? next.hoverDrag : 0.35
    next.hoverGrip = Number.isFinite(next.hoverGrip) ? next.hoverGrip : 0.8
    // 气垫载具没有履带或轮胎运行组件；切换类型后清理旧底盘遗留美术与落印。
    delete next.tracks
    delete next.wheels
  }
  if (next.chassis === 'walker') {
    // 旧双层定义把下半身序列提升为新的唯一主体素材；旧静态上半身不再单独绘制。
    if (next.walkerLowerAsset) {
      next.spriteBody = next.walkerLowerAsset
      delete next.bodyCollision
    }
    next.walkerBodyOffsetX = Number.isFinite(next.walkerBodyOffsetX)
      ? next.walkerBodyOffsetX
      : Number.isFinite(next.walkerLowerOffsetX) ? next.walkerLowerOffsetX : 0
    next.walkerBodyOffsetY = Number.isFinite(next.walkerBodyOffsetY)
      ? next.walkerBodyOffsetY
      : Number.isFinite(next.walkerLowerOffsetY) ? next.walkerLowerOffsetY : 0
    const legacyDuration = Number.isFinite(next.walkerFrameDuration)
      ? next.walkerFrameDuration!
      : Number.isFinite(next.walkerFps) && next.walkerFps! > 0 ? 1 / next.walkerFps! : 0.125
    // 旧逻辑在满速下每 7 帧完成一次单脚动作，因此 stride = 极速 × 单帧时长 × 7。
    next.walkerStride = Math.max(0.05, Math.min(20, Number.isFinite(next.walkerStride)
      ? next.walkerStride!
      : Math.max(0.01, next.speed) * legacyDuration * 7))
    const walkerCollisionPrefix = next.spriteBody ? `${next.spriteBody}#walker:2x7:` : ''
    if (next.bodyCollision && (!walkerCollisionPrefix || typeof next.bodyCollision.source !== 'string' || !next.bodyCollision.source.startsWith(walkerCollisionPrefix))) delete next.bodyCollision
    delete next.walkerLowerAsset
    delete next.walkerLowerOffsetX
    delete next.walkerLowerOffsetY
    delete next.walkerFrames
    delete next.walkerFps
    delete next.walkerFrameDuration
    delete next.tracks
    delete next.wheels
    // 机甲不使用履带、轮式、气垫运动学或汽车悬挂俯仰；只保留通用加速、转向、倒退和刹停参数。
    delete next.turnRadius
    delete next.trackWidth
    delete next.turnDrag
    delete next.wheelbase
    delete next.steerMax
    delete next.steerRate
    delete next.gripMax
    delete next.hoverDrag
    delete next.hoverGrip
    delete next.pitchGain
    delete next.leanCap
  } else {
    delete next.walkerStride
    delete next.walkerFrameDuration
    delete next.walkerBodyOffsetX
    delete next.walkerBodyOffsetY
    delete next.walkerLowerAsset
    delete next.walkerLowerOffsetX
    delete next.walkerLowerOffsetY
    delete next.walkerFrames
    delete next.walkerFps
  }

  if (next.runningGearCoordinateSpace !== 'centered') {
    // 旧存档：履带/轮胎以局部外框左上角为 (0,0)，x 向右、y 向下。
    // 新协议：实际占格包围盒几何中心为 (0,0)，x 向右、y 向车头。
    let centerX = next.w / 2
    let centerY = next.h / 2
    if (next.shape && next.shape.length > 0) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
      for (const key of next.shape) {
        const [x, y] = key.split(',').map(Number)
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue
        minX = Math.min(minX, x); minY = Math.min(minY, y)
        maxX = Math.max(maxX, x); maxY = Math.max(maxY, y)
      }
      if (Number.isFinite(minX) && Number.isFinite(minY)) {
        centerX = (minX + maxX + 1) / 2
        centerY = (minY + maxY + 1) / 2
      }
    }
    next.tracks = next.tracks?.map(track => ({
      ...track,
      x1: track.x1 - centerX,
      y1: centerY - track.y1,
      x2: track.x2 - centerX,
      y2: centerY - track.y2,
    }))
    next.wheels = next.wheels?.map(wheel => ({ ...wheel, x: wheel.x - centerX, y: centerY - wheel.y }))
    next.runningGearCoordinateSpace = 'centered'
  }

  // 新载具的外部形状完全由主体贴图生成的碰撞轮廓决定。
  // shape 只用于没有轮廓的历史载具回退，二者同时存在时清除旧 shape，
  // 避免旧格子外框覆盖当前素材尺寸并触发错误校验。
  if (next.bodyCollision) delete next.shape

  // 擦掉顶部/左侧整行后，旧编辑器会留下从 y=2 等位置开始的空白坐标原点。
  // 将实际形状和所有局部锚点一起回收到 (0,0)；居中坐标制的履带/轮胎无需移动。
  if (next.shape && next.shape.length > 0) {
    const coords = next.shape.map(key => key.split(',').map(Number) as [number, number])
    if (coords.every(([x, y]) => Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0)) {
      const minX = Math.min(...coords.map(([x]) => x))
      const minY = Math.min(...coords.map(([, y]) => y))
      const maxX = Math.max(...coords.map(([x]) => x))
      const maxY = Math.max(...coords.map(([, y]) => y))
      const shiftKey = (key: string) => {
        const [x, y] = key.split(',').map(Number)
        return `${x - minX},${y - minY}`
      }
      if (minX !== 0 || minY !== 0) {
        next.shape = next.shape.map(shiftKey)
        // 新轮廓协议下内部空间拥有独立原点；仅旧底格定义继续随 shape 一次性迁移。
        if (!next.bodyCollision) {
          next.interiorCells = next.interiorCells?.map(shiftKey)
          next.interiorSpecials = next.interiorSpecials?.map(cell => ({ ...cell, x: cell.x - minX, y: cell.y - minY }))
        }
        next.hardpoints = next.hardpoints.map(hardpoint => ({ ...hardpoint, x: hardpoint.x - minX, y: hardpoint.y - minY }))
        next.effects = next.effects?.map(effect => ({ ...effect, x: effect.x - minX, y: effect.y - minY }))
        next.decals = next.decals?.map(decal => ({ ...decal, x: decal.x - minX, y: decal.y - minY }))
      }
      next.w = maxX - minX + 1
      next.h = maxY - minY + 1
    }
  }
  return next
}

/** 将 AI/Boss 等单位层信息写回载具唯一数据源；物理、外观、炮位仍以现有 FortressDef 为准。 */
function mergeVehicleUnitMetadata(base: FortressDef, unit: UnitDef): FortressDef {
  const next = structuredClone(base)
  next.unitId = unit.id
  next.name = unit.name
  next.sounds = unit.sounds ? structuredClone(unit.sounds) : undefined
  next.unitTargetClasses = structuredClone(unit.targetClasses)
  next.unitReward = unit.stats.reward ?? 40
  next.unitCombat = unit.combat ? structuredClone(unit.combat) : undefined
  next.unitAI = unit.ai ? structuredClone(unit.ai) : undefined
  next.unitBoss = unit.boss ? structuredClone(unit.boss) : undefined
  next.bodyLocked = unit.bodyLocked === true || undefined
  return next
}

/** 仅在旧载具没有任何对应 FortressDef 时使用，把旧快照尽量完整地恢复为新载具定义。 */
function recoverLegacyVehicleFortress(unit: UnitDef): FortressDef {
  const legacy = unit.legacy?.registry === 'fortress' ? unit.legacy : undefined
  const embedded = structuredClone(legacy?.def ?? DEFAULT_FORTRESS)
  const legacyOwnsId = !!legacy && unit.id === (legacy.def.unitId ?? fortressUnitId(legacy.id))
  embedded.id = legacyOwnsId ? legacy.id : `unit-vehicle:${unit.id}`
  embedded.unitId = unit.id
  embedded.name = unit.name
  embedded.hp = unit.stats.hp
  embedded.speed = unit.stats.speed
  if (unit.visual?.bodyAsset) embedded.spriteBody = unit.visual.bodyAsset
  const vehicle = unitTypeConfig(unit)
  if (vehicle?.kind === 'vehicle') {
    embedded.chassis = vehicle.chassis
    embedded.armor = structuredClone(vehicle.armor)
    embedded.accel = vehicle.accel
    embedded.turnSpeed = vehicle.turnSpeed
    embedded.turnRadius = vehicle.turnRadius
    embedded.reverseFactor = vehicle.reverseFactor
    embedded.brakeInertia = vehicle.brakeInertia
    embedded.trackWidth = vehicle.trackWidth
    embedded.turnDrag = vehicle.turnDrag
    embedded.wheelbase = vehicle.wheelbase
    embedded.steerMax = vehicle.steerMax
    embedded.steerRate = vehicle.steerRate
    embedded.gripMax = vehicle.gripMax
    embedded.hoverDrag = vehicle.hoverDrag
    embedded.hoverGrip = vehicle.hoverGrip
    embedded.walkerStride = vehicle.walkerStride
  }
  return mergeVehicleUnitMetadata(embedded, unit)
}

/** 自定义堡垒并入注册表（FORTRESS_DEFS upsert，内置 id 允许覆盖；引擎 fortressDef 查找零改动） */
function mergeCustomFortresses() {
  for (const c of customFortresses) {
    const i = FORTRESS_DEFS.findIndex(f => f.id === c.id)
    if (i >= 0) FORTRESS_DEFS.splice(i, 1, c)
    else FORTRESS_DEFS.push(c)
  }
}

function loadFortressLib() {
  const st = storage()
  if (!st) return
  try {
    const raw = st.getItem(FORTRESS_LIB_KEY)
    if (!raw) return
    const o = JSON.parse(raw) as FortressLibData | null
    if (!o || !isSupportedFortressLibVersion(o.version) || !Array.isArray(o.customs)) return
    const normalized = o.customs
      .filter(c => c && typeof c.id === 'string')
      .map(c => {
        const next = structuredClone(c as FortressDef)
        if (o.version < 2 && next.gripMax !== undefined) next.gripMax *= LEGACY_METRIC_SCALE
        return normalizeFortress(next)
      })
    const migrated = o.version < FORTRESS_LIB_VERSION || JSON.stringify(normalized) !== JSON.stringify(o.customs)
    customFortresses = normalized
    if (typeof o.selectedId === 'string') selectedFortressId = o.selectedId
    if (migrated) saveFortressLib()
  } catch { /* 静默用默认 */ }
}

let fortressLibPersistFailed = false

function saveFortressLib() {
  const st = storage()
  if (!st) { fortressLibPersistFailed = true; return }
  try {
    const env: FortressLibData = { version: FORTRESS_LIB_VERSION, customs: customFortresses, selectedId: selectedFortressId }
    st.setItem(FORTRESS_LIB_KEY, JSON.stringify(env))
    fortressLibPersistFailed = false
  } catch {
    fortressLibPersistFailed = true // 存储空间不足等：改动仅存于内存，刷新后丢失
  }
}

/** 最近一次堡垒库写入是否失败（localStorage 配额满等）；编辑器据此提示「未持久化」 */
export function fortressPersistFailed(): boolean { return fortressLibPersistFailed }

loadFortressLib()
mergeCustomFortresses()

export function listCustomFortresses(): FortressDef[] { return customFortresses }

export function getSelectedFortressId(): string { return selectedFortressId }

/** 设置出战堡垒（initialState 使用；id 不存在时保持内置默认） */
export function setSelectedFortressId(id: string) {
  selectedFortressId = playableVehicleDefs().some(f => f.id === id) ? id : DEFAULT_FORTRESS.id
  saveFortressLib()
}

/** upsert 堡垒（内置 id 也允许 = 直接改内置；返回 false 仅当定义非法） */
export function saveCustomFortress(def: FortressDef): boolean {
  if (!def || typeof def.id !== 'string') return false
  const normalized = normalizeFortress(def)
  const i = customFortresses.findIndex(c => c.id === normalized.id)
  if (i >= 0) customFortresses.splice(i, 1, normalized)
  else customFortresses.push(normalized)
  mergeCustomFortresses()
  saveFortressLib()
  notifyUnitLibraryChanged({ id: normalized.unitId ?? normalized.id, operation: 'save' })
  return true
}

/**
 * 保存统一单位编辑器里的载具 AI/Boss 设置。
 * 不再生成第二份 UnitDef；找不到载具引用时明确失败，绝不回退测试堡垒。
 */
export function saveVehicleUnitDefinition(unit: UnitDef): boolean {
  if (unit.legacy?.registry !== 'fortress') return false
  const fortress = FORTRESS_DEFS.find(item => item.unitId === unit.id)
    ?? FORTRESS_DEFS.find(item => item.id === unit.legacy!.id && unit.id === (item.unitId ?? fortressUnitId(item.id)))
  if (!fortress) return false
  const saved = saveCustomFortress(mergeVehicleUnitMetadata(fortress, unit))
  if (saved) deleteCustomUnitDef(unit.id)
  return saved
}

/** 删除堡垒库条目：纯自定义 = 移除；内置覆盖 = 恢复出厂定义；若其为出战堡垒则回落默认 */
export function deleteCustomFortress(id: string): boolean {
  const i = customFortresses.findIndex(c => c.id === id)
  if (i < 0) return false
  customFortresses.splice(i, 1)
  const factory = FACTORY_FORTRESSES.find(f => f.id === id)
  const ri = FORTRESS_DEFS.findIndex(f => f.id === id)
  if (factory) {
    if (ri >= 0) FORTRESS_DEFS.splice(ri, 1, JSON.parse(JSON.stringify(factory)) as FortressDef) // 内置：恢复出厂
  } else if (ri >= 0) {
    FORTRESS_DEFS.splice(ri, 1)
  }
  if (selectedFortressId === id && !FORTRESS_DEFS.some(f => f.id === id)) selectedFortressId = DEFAULT_FORTRESS.id
  saveFortressLib()
  notifyUnitLibraryChanged({ id: factory?.unitId ?? id, operation: 'delete' })
  return true
}

/** 删除一台自定义载具的两类旧记录；关卡引用由调用方在同一事务中清理。 */
export function deleteCustomVehicleDefinition(fortressId: string, unitId: string): boolean {
  const removedUnitSnapshot = deleteCustomUnitDef(unitId)
  const removedFortress = deleteCustomFortress(fortressId)
  return removedUnitSnapshot || removedFortress
}

/**
 * v2 单一载具数据源迁移：把单位库内遗留的完整载具快照合并回 FortressDef，随后删除快照。
 * 优先使用 unitId 精确匹配当前载具，避免旧 legacy.id 错指 standard 时覆盖测试堡垒。
 */
export function migrateLegacyCustomVehicleUnits(): number {
  let migrated = 0
  for (const unit of [...listLegacyCustomFortressUnitDefs()]) {
    const legacy = unit.legacy?.registry === 'fortress' ? unit.legacy : undefined
    const current = FORTRESS_DEFS.find(item => item.unitId === unit.id)
      ?? (legacy ? FORTRESS_DEFS.find(item => item.id === legacy.id && unit.id === (item.unitId ?? fortressUnitId(item.id))) : undefined)
    const next = current ? mergeVehicleUnitMetadata(current, unit) : recoverLegacyVehicleFortress(unit)
    if (!saveCustomFortress(next)) continue
    deleteCustomUnitDef(unit.id)
    migrated += 1
  }
  return migrated
}

// 必须等堡垒库和上述迁移函数全部就绪后执行；模块加载完成前即可修正现有浏览器旧数据。
migrateLegacyCustomVehicleUnits()

/** 该 id 是否为被覆盖的内置堡垒（编辑器显示「恢复出厂」） */
export function isBuiltinFortressOverridden(id: string): boolean {
  return FACTORY_FORTRESSES.some(f => f.id === id) && customFortresses.some(c => c.id === id)
}

/** 口令导出/导入携带堡垒库（跨设备搬运） */
export function fortressLibForExport(): FortressLibData {
  return { version: FORTRESS_LIB_VERSION, customs: customFortresses, selectedId: selectedFortressId }
}
export function importFortressLib(o: FortressLibData | undefined) {
  if (!o || !Array.isArray(o.customs)) return
  for (const c of o.customs) {
    if (!c || typeof c.id !== 'string') continue
    const normalized = normalizeFortress(c)
    const i = customFortresses.findIndex(x => x.id === normalized.id)
    if (i >= 0) customFortresses.splice(i, 1, normalized) // 同 id 覆盖：口令=配置搬运，导入方数据为准
    else customFortresses.push(normalized)
  }
  mergeCustomFortresses() // 先并入注册表，再校验收录的出战 id（否则新导入的自定义堡垒永远选不中）
  if (typeof o.selectedId === 'string' && playableVehicleDefs().some(f => f.id === o.selectedId)) selectedFortressId = o.selectedId
  saveFortressLib()
  notifyUnitLibraryChanged({ operation: 'import' })
}
