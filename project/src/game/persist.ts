/** debug 数据持久化（localStorage，模式同 level.ts）：TURRET_DEFS / PROJECTILE_ARTS 全量 JSON。
 *  模块初始化时加载并就地替换注册表内容（splice，保持 import 引用有效，引擎/render 零改动）；
 *  无存储环境（sim/node）解析失败均静默用默认。version 不符 → 丢弃用默认。 */
import { applyMountFoot, DEFAULT_FORTRESS, FORTRESS_DEFS, MODULE_DEFS, PROJECTILE_ARTS, SHIELD_MODULE_DEFS, TURRET_DEFS } from './config'
import type { FortressDef, ModuleDef, ProjectileArtDef, TurretDef } from './config'

export const TURRET_DEFS_KEY = 'td-turret-defs'
export const PROJECTILE_ARTS_KEY = 'td-projectile-arts'
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

export const serializeTurretDefs = (defs: TurretDef[]): string => serialize(defs)
export const parseTurretDefs = (json: string): TurretDef[] | null => parse(json)
export const serializeProjectileArts = (arts: ProjectileArtDef[]): string => serialize(arts)
export const parseProjectileArts = (json: string): ProjectileArtDef[] | null => parse(json)
// v2.30 模块库（MODULE_DEFS 注册表化，同 TURRET_DEFS 全量 JSON 模式；声明须在 load() 之前避免 TDZ）
export const MODULE_DEFS_KEY = 'td-module-defs'
export const MODULE_DEFS_SCHEMA_KEY = 'td-module-defs-schema'
export const MODULE_DEFS_SCHEMA_VERSION = 6 // v6：通用模块数量上限，并清理旧发生器硬编码描述
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
        defs.forEach(applyMountFoot) // v1.76：占格随型号归一化
        TURRET_DEFS.splice(0, TURRET_DEFS.length, ...defs)
        if (migrated) st.setItem(TURRET_DEFS_KEY, serializeTurretDefs(defs))
      }
    }
    const aj = st.getItem(PROJECTILE_ARTS_KEY)
    if (aj) {
      const arts = parseProjectileArts(aj)
      if (arts) PROJECTILE_ARTS.splice(0, PROJECTILE_ARTS.length, ...arts)
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
  try { st.setItem(TURRET_DEFS_KEY, serializeTurretDefs(TURRET_DEFS)) } catch { /* 无存储环境静默 */ }
}

export function saveProjectileArts() {
  const st = storage()
  if (!st) return
  try { st.setItem(PROJECTILE_ARTS_KEY, serializeProjectileArts(PROJECTILE_ARTS)) } catch { /* 静默 */ }
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
  factory.forEach(applyMountFoot) // v1.76：占格随型号归一化
  TURRET_DEFS.splice(0, TURRET_DEFS.length, ...factory)
  PROJECTILE_ARTS.splice(0, PROJECTILE_ARTS.length, ...JSON.parse(JSON.stringify(FACTORY_AMMO)) as ProjectileArtDef[])
  MODULE_DEFS.splice(0, MODULE_DEFS.length, ...JSON.parse(JSON.stringify(FACTORY_MODULES)) as ModuleDef[]) // v2.30 模块库一并回出厂
  const st = storage()
  if (!st) return
  try {
    st.removeItem(TURRET_DEFS_KEY)
    st.removeItem(PROJECTILE_ARTS_KEY)
    st.removeItem(MODULE_DEFS_KEY)
    st.removeItem(MODULE_DEFS_SCHEMA_KEY)
  } catch { /* 静默 */ }
}


// ================= 堡垒类型库（自定义堡垒 + 出战选择；内置堡垒只读，不持久化内置条目） =================

export interface FortressLibData { version: number; customs: FortressDef[]; selectedId: string }

const FORTRESS_LIB_VERSION = 1
/** 出厂内置堡垒快照（合并覆盖前留存；删除内置覆盖 = 恢复出厂） */
const FACTORY_FORTRESSES = JSON.parse(JSON.stringify(FORTRESS_DEFS)) as FortressDef[]
let customFortresses: FortressDef[] = []
let selectedFortressId: string = DEFAULT_FORTRESS.id

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
    if (!o || o.version !== FORTRESS_LIB_VERSION || !Array.isArray(o.customs)) return
    customFortresses = o.customs.filter(c => c && typeof c.id === 'string') as FortressDef[]
    if (typeof o.selectedId === 'string') selectedFortressId = o.selectedId
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
  selectedFortressId = FORTRESS_DEFS.some(f => f.id === id) ? id : DEFAULT_FORTRESS.id
  saveFortressLib()
}

/** upsert 堡垒（内置 id 也允许 = 直接改内置；返回 false 仅当定义非法） */
export function saveCustomFortress(def: FortressDef): boolean {
  if (!def || typeof def.id !== 'string') return false
  const i = customFortresses.findIndex(c => c.id === def.id)
  if (i >= 0) customFortresses.splice(i, 1, def)
  else customFortresses.push(def)
  mergeCustomFortresses()
  saveFortressLib()
  return true
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
  return true
}

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
    const i = customFortresses.findIndex(x => x.id === c.id)
    if (i >= 0) customFortresses.splice(i, 1, c) // 同 id 覆盖：口令=配置搬运，导入方数据为准
    else customFortresses.push(c)
  }
  mergeCustomFortresses() // 先并入注册表，再校验收录的出战 id（否则新导入的自定义堡垒永远选不中）
  if (typeof o.selectedId === 'string' && FORTRESS_DEFS.some(f => f.id === o.selectedId)) selectedFortressId = o.selectedId
  saveFortressLib()
}
