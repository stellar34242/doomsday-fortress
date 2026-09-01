import {
  AMMO, ENERGY, FORTRESS_DEFS, MODULE_DEFS, M_PER_CELL, SPECIAL_MULT, TURRET_DEFS,
  moduleAssemblyPoints, turretAssemblyPoints,
} from './config'
import type { FortressDef, ModuleDef, SpecialBoost } from './config'
import { playableVehicleDefs } from './unit'
import { gameParameters } from './gameParameters'

export interface VehicleLoadoutTurret {
  hardpointId: string
  turretDefId: string
}

export interface VehicleLoadoutModule {
  defId: string
  x: number
  y: number
  rot: 0 | 1
}

export interface VehicleLoadoutPreset {
  id: string
  name: string
  fortressDefId: string
  turrets: VehicleLoadoutTurret[]
  modules: VehicleLoadoutModule[]
}

export interface VehicleLoadoutStats {
  structure: number
  shield: number
  armor: number
  speed: number
  turnSpeed: number
  firepower: number
  energyCap: number
  ammoCap: number
  cooling: number
}

const LOADOUT_STORAGE_KEY = 'td-vehicle-loadouts-v1'
const SELECTED_LOADOUT_KEY = 'td-selected-vehicle-loadout-v1'
const LOADOUT_SCHEMA_VERSION = 1
const MAX_PRESETS = 100

function storage(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage } catch { return null }
}

function safeId(value: unknown, fallback: string): string {
  const cleaned = String(value ?? '').trim().replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 64)
  return cleaned || fallback
}

export function fortressInteriorCells(def: FortressDef): Set<string> {
  if (def.interiorCells !== undefined) return new Set(def.interiorCells)
  const cells = new Set<string>()
  for (let x = 0; x < def.interior.cols; x++) for (let y = 0; y < def.interior.rows; y++) cells.add(`${x},${y}`)
  return cells
}

export function loadoutModuleCells(def: ModuleDef, rot: 0 | 1): Array<{ x: number; y: number }> {
  const source = def.shape?.length
    ? def.shape.flatMap(key => {
        const [x, y] = key.split(',').map(Number)
        return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && x < def.w && y >= 0 && y < def.h ? [{ x, y }] : []
      })
    : Array.from({ length: def.w * def.h }, (_, index) => ({ x: index % def.w, y: Math.floor(index / def.w) }))
  return rot === 0 ? source : source.map(cell => ({ x: def.h - 1 - cell.y, y: cell.x }))
}

function occupiedModuleCells(modules: readonly VehicleLoadoutModule[]): Set<string> {
  const occupied = new Set<string>()
  for (const module of modules) {
    const def = MODULE_DEFS.find(item => item.id === module.defId)
    if (!def) continue
    for (const cell of loadoutModuleCells(def, module.rot)) occupied.add(`${module.x + cell.x},${module.y + cell.y}`)
  }
  return occupied
}

export function canPlaceLoadoutModule(
  fortress: FortressDef,
  modules: readonly VehicleLoadoutModule[],
  moduleDefId: string,
  x: number,
  y: number,
  rot: 0 | 1,
): { ok: boolean; reason?: string } {
  const def = MODULE_DEFS.find(item => item.id === moduleDefId)
  if (!def) return { ok: false, reason: '模块不存在' }
  if (def.maxCount !== undefined && modules.filter(item => item.defId === moduleDefId).length >= def.maxCount) return { ok: false, reason: `装配上限 ${def.maxCount}` }
  const interior = fortressInteriorCells(fortress)
  const occupied = occupiedModuleCells(modules)
  for (const cell of loadoutModuleCells(def, rot)) {
    const key = `${x + cell.x},${y + cell.y}`
    if (!interior.has(key)) return { ok: false, reason: '内部空间不足' }
    if (occupied.has(key)) return { ok: false, reason: '与其他模块重叠' }
  }
  return { ok: true }
}

export function firstLoadoutModulePlacement(
  fortress: FortressDef,
  modules: readonly VehicleLoadoutModule[],
  moduleDefId: string,
): VehicleLoadoutModule | null {
  for (const rot of [0, 1] as const) {
    for (let y = 0; y < fortress.interior.rows; y++) for (let x = 0; x < fortress.interior.cols; x++) {
      if (canPlaceLoadoutModule(fortress, modules, moduleDefId, x, y, rot).ok) return { defId: moduleDefId, x, y, rot }
    }
  }
  return null
}

export function normalizeVehicleLoadout(raw: unknown, index = 0): VehicleLoadoutPreset | null {
  return normalizeLoadout(raw, index, false)
}

/** 战斗中整备时，所有可见炮位（包括模板预装炮位）都由草稿显式接管。 */
export function normalizeCombatVehicleLoadout(raw: unknown, index = 0): VehicleLoadoutPreset | null {
  return normalizeLoadout(raw, index, true)
}

/** 关卡中的玩家单位不一定属于可出战车型库，因此战斗整备允许显式传入其载具平台。 */
export function normalizeCombatVehicleLoadoutForDef(raw: unknown, fortress: FortressDef, index = 0): VehicleLoadoutPreset | null {
  return normalizeLoadout(raw, index, true, fortress)
}

function normalizeLoadout(raw: unknown, index: number, replaceBuiltIns: boolean, fortressOverride?: FortressDef): VehicleLoadoutPreset | null {
  if (!raw || typeof raw !== 'object') return null
  const source = raw as Partial<VehicleLoadoutPreset>
  const fortress = fortressOverride?.id === source.fortressDefId
    ? fortressOverride
    : playableVehicleDefs().find(item => item.id === source.fortressDefId)
  if (!fortress) return null
  const turrets: VehicleLoadoutTurret[] = []
  const usedHardpoints = new Set<string>()
  for (const candidate of Array.isArray(source.turrets) ? source.turrets : []) {
    const hardpoint = fortress.hardpoints.find(item => item.id === candidate?.hardpointId && (replaceBuiltIns || !item.builtIn))
    const turret = TURRET_DEFS.find(item => item.id === candidate?.turretDefId)
    if (!hardpoint || !turret || usedHardpoints.has(hardpoint.id)) continue
    if (turret.mount !== hardpoint.size || (hardpoint.types && !hardpoint.types.includes(turret.type))) continue
    usedHardpoints.add(hardpoint.id)
    turrets.push({ hardpointId: hardpoint.id, turretDefId: turret.id })
  }
  const modules: VehicleLoadoutModule[] = []
  for (const candidate of Array.isArray(source.modules) ? source.modules : []) {
    const defId = String(candidate?.defId ?? '')
    const rot = candidate?.rot === 1 ? 1 : 0
    const x = Math.round(Number(candidate?.x))
    const y = Math.round(Number(candidate?.y))
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    if (canPlaceLoadoutModule(fortress, modules, defId, x, y, rot).ok) modules.push({ defId, x, y, rot })
  }
  return {
    id: safeId(source.id, `preset-${fortress.id}-${index + 1}`),
    name: String(source.name ?? fortress.name).trim().slice(0, 32) || fortress.name,
    fortressDefId: fortress.id,
    turrets,
    modules,
  }
}

export function vehicleLoadoutAssemblyPoints(preset: VehicleLoadoutPreset): number {
  const turretPoints = preset.turrets.reduce((sum, item) => {
    const def = TURRET_DEFS.find(candidate => candidate.id === item.turretDefId)
    return sum + (def ? turretAssemblyPoints(def) : 0)
  }, 0)
  const modulePoints = preset.modules.reduce((sum, item) => {
    const def = MODULE_DEFS.find(candidate => candidate.id === item.defId)
    return sum + (def ? moduleAssemblyPoints(def) : 0)
  }, 0)
  return turretPoints + modulePoints
}

function defaultPreset(fortress: FortressDef, index: number): VehicleLoadoutPreset {
  return { id: `preset-${safeId(fortress.id, String(index + 1))}`, name: fortress.name, fortressDefId: fortress.id, turrets: [], modules: [] }
}

export function defaultVehicleLoadouts(): VehicleLoadoutPreset[] {
  return playableVehicleDefs().map(defaultPreset)
}

export function loadVehicleLoadouts(): VehicleLoadoutPreset[] {
  const st = storage()
  if (!st) return defaultVehicleLoadouts()
  try {
    const raw = JSON.parse(st.getItem(LOADOUT_STORAGE_KEY) ?? 'null') as { version?: number; presets?: unknown[] } | null
    const presets = raw?.version === LOADOUT_SCHEMA_VERSION && Array.isArray(raw.presets)
      ? raw.presets.slice(0, MAX_PRESETS).flatMap((item, index) => normalizeVehicleLoadout(item, index) ?? [])
      : []
    const usedIds = new Set<string>()
    const unique = presets.filter(preset => !usedIds.has(preset.id) && usedIds.add(preset.id))
    for (const fortress of playableVehicleDefs()) if (!unique.some(preset => preset.fortressDefId === fortress.id)) unique.push(defaultPreset(fortress, unique.length))
    if (unique.length === 0) unique.push(...defaultVehicleLoadouts())
    return unique.slice(0, MAX_PRESETS)
  } catch { return defaultVehicleLoadouts() }
}

export function saveVehicleLoadouts(presets: readonly VehicleLoadoutPreset[]): boolean {
  const st = storage()
  if (!st) return false
  try {
    const normalized = presets.slice(0, MAX_PRESETS).flatMap((preset, index) => normalizeVehicleLoadout(preset, index) ?? [])
    st.setItem(LOADOUT_STORAGE_KEY, JSON.stringify({ version: LOADOUT_SCHEMA_VERSION, presets: normalized }))
    return true
  } catch { return false }
}

export function createVehicleLoadout(fortressDefId: string, presets: readonly VehicleLoadoutPreset[]): VehicleLoadoutPreset | null {
  const fortress = playableVehicleDefs().find(item => item.id === fortressDefId)
  if (!fortress) return null
  const existingIds = new Set(presets.map(item => item.id))
  let serial = 1
  let id = `preset-${safeId(fortress.id, 'vehicle')}-${serial}`
  while (existingIds.has(id)) id = `preset-${safeId(fortress.id, 'vehicle')}-${++serial}`
  const sameVehicleCount = presets.filter(item => item.fortressDefId === fortress.id).length
  return { id, name: `${fortress.name} ${sameVehicleCount + 1}`, fortressDefId: fortress.id, turrets: [], modules: [] }
}

export function getSelectedVehicleLoadoutId(): string {
  const presets = loadVehicleLoadouts()
  const selected = storage()?.getItem(SELECTED_LOADOUT_KEY) ?? ''
  return presets.some(item => item.id === selected) ? selected : (presets[0]?.id ?? '')
}

export function setSelectedVehicleLoadoutId(id: string): void {
  const valid = loadVehicleLoadouts().some(item => item.id === id)
  if (!valid) return
  try { storage()?.setItem(SELECTED_LOADOUT_KEY, id) } catch { /* 无存储环境静默 */ }
}

export function selectedVehicleLoadout(): VehicleLoadoutPreset | null {
  const presets = loadVehicleLoadouts()
  const id = getSelectedVehicleLoadoutId()
  return presets.find(item => item.id === id) ?? presets[0] ?? null
}

function moduleBoost(fortress: FortressDef, module: VehicleLoadoutModule, boost: SpecialBoost): number {
  const specials = fortress.interiorSpecials?.filter(item => item.boost === boost) ?? []
  if (specials.length === 0) return 1
  const def = MODULE_DEFS.find(item => item.id === module.defId)
  if (!def) return 1
  const occupied = new Set(loadoutModuleCells(def, module.rot).map(cell => `${module.x + cell.x},${module.y + cell.y}`))
  return specials.some(item => occupied.has(`${item.x},${item.y}`)) ? SPECIAL_MULT : 1
}

export function vehicleLoadoutStats(preset: VehicleLoadoutPreset, options: { includeBuiltInTurrets?: boolean; vehicleDef?: FortressDef } = {}): VehicleLoadoutStats {
  const fortress = options.vehicleDef?.id === preset.fortressDefId
    ? options.vehicleDef
    : playableVehicleDefs().find(item => item.id === preset.fortressDefId) ?? FORTRESS_DEFS[0]
  const modules = preset.modules.flatMap(instance => {
    const def = MODULE_DEFS.find(item => item.id === instance.defId)
    return def ? [{ instance, def }] : []
  })
  const hpBoost = modules.reduce((sum, item) => sum + (item.def.hpBoost ?? 0) * moduleBoost(fortress, item.instance, 'hp'), 0)
  const speedBoost = modules.reduce((sum, item) => sum + (item.def.speedBoost ?? 0) * moduleBoost(fortress, item.instance, 'speed'), 0)
  const turnBoost = modules.reduce((sum, item) => sum + (item.def.turnBoost ?? 0) * moduleBoost(fortress, item.instance, 'turn'), 0)
  const energyCap = modules.reduce((sum, item) => sum + (item.def.energyCap ?? 0) * moduleBoost(fortress, item.instance, 'energy'), ENERGY.cap)
  const ammoCap = modules.reduce((sum, item) => sum + (item.def.ammoCap ?? 0) * moduleBoost(fortress, item.instance, 'ammo'), AMMO.cap)
  const cooling = modules.reduce((sum, item) => sum + (item.def.cooling ?? 0) * moduleBoost(fortress, item.instance, 'cooling'), gameParameters().naturalHeatDissipation)
  const shieldGenerator = modules.some(item => item.def.shieldGenerator)
  const shield = shieldGenerator ? modules.reduce((sum, item) => sum + Math.max(0, item.def.shieldMax ?? 0), 0) : 0
  const turretIds = [
    ...(options.includeBuiltInTurrets === false ? [] : fortress.hardpoints.flatMap(hardpoint => hardpoint.builtIn ? [hardpoint.builtIn] : [])),
    ...preset.turrets.map(item => item.turretDefId),
  ]
  const firepower = turretIds.reduce((sum, id) => sum + Math.max(0, TURRET_DEFS.find(item => item.id === id)?.damage ?? 0), 0)
  const armor = fortress.armor ?? { front: 0, rear: 0, left: 0, right: 0 }
  return {
    structure: Math.round(fortress.hp + hpBoost),
    shield: Math.round(shield),
    armor: Math.round(armor.front + armor.rear + armor.left + armor.right),
    speed: Math.max(0, (fortress.speed + speedBoost) * M_PER_CELL),
    turnSpeed: Math.max(0, fortress.turnSpeed + turnBoost),
    firepower: Math.round(firepower),
    energyCap: Math.round(energyCap),
    ammoCap: Math.round(ammoCap),
    cooling: Math.max(0, cooling),
  }
}
