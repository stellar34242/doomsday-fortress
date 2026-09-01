import { isAutotileAsset } from './assetlib'
import { normalizeEventActions } from './level'
import type { LevelObjectEvent } from './level'
import { emptyConditionGroup, normalizeConditionGroup } from './levelEditor'

export interface TerrainTypeDef {
  id: string
  name: string
  asset?: string
  color: string
  defaultW: number
  defaultH: number
  effect?: 'none' | 'moveModifier'
  moveModifier: number
}

export interface ObjectTypeDef {
  id: string
  name: string
  /** 空值继承全局物体声音；'none' 静音；其他值引用声音预设。 */
  sounds?: { destroy?: string; interact?: string }
  asset?: string
  color: string
  defaultW: number
  defaultH: number
  hp: number
  blockMove: boolean
  blockProjectile: boolean
  height: number
  renderLayer: 1 | 2 | 3 | 4 | 5
  /** 该物体实例可用的局部状态；default 恒为安全初始状态。 */
  states: string[]
  events: ObjectTypeEvent[]
}

export type ObjectEventTrigger = LevelObjectEvent['trigger']
export type ObjectTypeEvent = LevelObjectEvent

interface WorldTypeLibraryData {
  version: 1
  terrain: TerrainTypeDef[]
  objects: ObjectTypeDef[]
}

export interface WorldTypeLibrarySnapshot {
  terrain: TerrainTypeDef[]
  objects: ObjectTypeDef[]
}

const STORAGE_KEY = 'td-world-type-library'

const BUILTIN_TERRAIN: TerrainTypeDef[] = [
  { id: 'terrain:puddle', name: '水坑', color: '#FFFFFF', defaultW: 1, defaultH: 1, effect: 'moveModifier', moveModifier: 0.5 },
]

const BUILTIN_OBJECTS: ObjectTypeDef[] = [
  { id: 'object:barrel', name: '油桶', color: '#5387C8', defaultW: 1, defaultH: 1, hp: 30, blockMove: true, blockProjectile: false, height: 1, renderLayer: 3, states: ['default'], events: [] },
  { id: 'object:ruins', name: '废墟', color: '#5387C8', defaultW: 2, defaultH: 2, hp: 150, blockMove: true, blockProjectile: true, height: 1, renderLayer: 3, states: ['default'], events: [] },
  { id: 'object:rock', name: '岩石', color: '#5387C8', defaultW: 2, defaultH: 2, hp: 0, blockMove: true, blockProjectile: false, height: 1, renderLayer: 3, states: ['default'], events: [] },
]

let customTerrain: TerrainTypeDef[] = []
let customObjects: ObjectTypeDef[] = []
let persistFailed = false

const finite = (value: unknown, fallback: number) => Number.isFinite(Number(value)) ? Number(value) : fallback
const size = (value: unknown, fallback = 1) => Math.max(1, Math.min(64, Math.round(finite(value, fallback))))
const text = (value: unknown, fallback: string, max = 60) => String(value ?? fallback).trim().slice(0, max) || fallback

export function normalizeTerrainType(raw: Partial<TerrainTypeDef>): TerrainTypeDef {
  const moveModifier = Math.max(0.05, Math.min(3, finite(raw.moveModifier, 1)))
  return {
    id: text(raw.id, 'terrain:custom', 80),
    name: text(raw.name, '新地形'),
    asset: typeof raw.asset === 'string' && raw.asset ? raw.asset : undefined,
    color: '#FFFFFF',
    defaultW: 1,
    defaultH: 1,
    effect: raw.effect === 'moveModifier' || (raw.effect === undefined && moveModifier !== 1) ? 'moveModifier' : 'none',
    moveModifier,
  }
}

export function normalizeObjectType(raw: Partial<ObjectTypeDef>): ObjectTypeDef {
  const asset = typeof raw.asset === 'string' && raw.asset ? raw.asset : undefined
  const autotile = isAutotileAsset(asset)
  const eventIds = new Set<number>()
  const states = ['default', ...(Array.isArray(raw.states) ? raw.states : [])]
    .map(value => String(value).trim().slice(0, 40))
    .filter(Boolean)
    .filter((value, index, values) => values.indexOf(value) === index)
    .slice(0, 30)
  const events = Array.isArray(raw.events) ? raw.events.slice(0, 50).map((rawEvent, index): ObjectTypeEvent => {
    const source = (rawEvent ?? {}) as Partial<ObjectTypeEvent>
    let id = Math.max(1, Math.round(Number(source.id) || index + 1))
    while (eventIds.has(id)) id++
    eventIds.add(id)
    return {
      id,
      name: text(source.name, `事件 ${id}`, 80),
      trigger: source.trigger === 'destroyed' || source.trigger === 'contact' ? source.trigger : 'interact',
      activationLimit: Math.max(0, Math.min(999, Math.round(Number(source.activationLimit) || 1))),
      cooldown: Math.max(0, Math.min(3600, Number(source.cooldown) || 0)),
      conditions: source.conditions ? normalizeConditionGroup(source.conditions) : emptyConditionGroup(),
      actions: normalizeEventActions(source.actions),
    }
  }) : []
  return {
    id: text(raw.id, 'object:custom', 80),
    name: text(raw.name, '新物体'),
    sounds: raw.sounds && typeof raw.sounds === 'object' ? {
      destroy: typeof raw.sounds.destroy === 'string' ? raw.sounds.destroy : undefined,
      interact: typeof raw.sounds.interact === 'string' ? raw.sounds.interact : undefined,
    } : undefined,
    asset,
    color: '#5387C8',
    defaultW: autotile ? 1 : size(raw.defaultW),
    defaultH: autotile ? 1 : size(raw.defaultH),
    hp: Math.max(0, Math.min(999999, Math.round(finite(raw.hp, 0)))),
    blockMove: raw.blockMove === true,
    blockProjectile: raw.blockProjectile === true,
    height: Math.max(0, Math.min(3, Math.round(finite(raw.height, 0)))),
    renderLayer: [1, 2, 3, 4, 5].includes(Number(raw.renderLayer)) ? Number(raw.renderLayer) as 1 | 2 | 3 | 4 | 5 : 3,
    states,
    events,
  }
}

function storage(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage } catch { return null }
}

function persist(): void {
  const st = storage()
  if (!st) { persistFailed = true; return }
  try {
    st.setItem(STORAGE_KEY, JSON.stringify({ version: 1, terrain: customTerrain, objects: customObjects } satisfies WorldTypeLibraryData))
    persistFailed = false
  } catch { persistFailed = true }
}

function load(): void {
  const st = storage()
  if (!st) return
  try {
    const parsed = JSON.parse(st.getItem(STORAGE_KEY) ?? 'null') as Partial<WorldTypeLibraryData> | null
    if (!parsed || parsed.version !== 1) return
    if (Array.isArray(parsed.terrain)) customTerrain = parsed.terrain.map(normalizeTerrainType)
    if (Array.isArray(parsed.objects)) customObjects = parsed.objects.map(normalizeObjectType)
  } catch { /* 坏数据静默回退内置定义 */ }
}

load()

function merge<T extends { id: string }>(builtins: T[], customs: T[]): T[] {
  const result = structuredClone(builtins)
  for (const custom of customs) {
    const index = result.findIndex(item => item.id === custom.id)
    if (index >= 0) result.splice(index, 1, structuredClone(custom))
    else result.push(structuredClone(custom))
  }
  return result
}

export function terrainTypeLibrary(): TerrainTypeDef[] { return merge(BUILTIN_TERRAIN, customTerrain) }
export function objectTypeLibrary(): ObjectTypeDef[] { return merge(BUILTIN_OBJECTS, customObjects) }
export function terrainTypeById(id: string | undefined): TerrainTypeDef | undefined { return terrainTypeLibrary().find(def => def.id === id) }
export function objectTypeById(id: string | undefined): ObjectTypeDef | undefined { return objectTypeLibrary().find(def => def.id === id) }
export function isBuiltinTerrainType(id: string): boolean { return BUILTIN_TERRAIN.some(def => def.id === id) }
export function isBuiltinObjectType(id: string): boolean { return BUILTIN_OBJECTS.some(def => def.id === id) }
export function isTerrainTypeOverridden(id: string): boolean { return isBuiltinTerrainType(id) && customTerrain.some(def => def.id === id) }
export function isObjectTypeOverridden(id: string): boolean { return isBuiltinObjectType(id) && customObjects.some(def => def.id === id) }
export function worldTypePersistFailed(): boolean { return persistFailed }
export function snapshotWorldTypeLibrary(): WorldTypeLibrarySnapshot {
  return { terrain: structuredClone(customTerrain), objects: structuredClone(customObjects) }
}
export function restoreWorldTypeLibrary(snapshot: WorldTypeLibrarySnapshot): void {
  customTerrain = snapshot.terrain.map(normalizeTerrainType)
  customObjects = snapshot.objects.map(normalizeObjectType)
  persist()
}

export function saveTerrainType(def: TerrainTypeDef): void {
  const next = normalizeTerrainType(def)
  const index = customTerrain.findIndex(item => item.id === next.id)
  if (index >= 0) customTerrain.splice(index, 1, next); else customTerrain.push(next)
  persist()
}

export function saveObjectType(def: ObjectTypeDef): void {
  const next = normalizeObjectType(def)
  const index = customObjects.findIndex(item => item.id === next.id)
  if (index >= 0) customObjects.splice(index, 1, next); else customObjects.push(next)
  persist()
}

export function deleteTerrainType(id: string): boolean {
  const index = customTerrain.findIndex(def => def.id === id)
  if (index < 0) return false
  customTerrain.splice(index, 1); persist(); return true
}

export function deleteObjectType(id: string): boolean {
  const index = customObjects.findIndex(def => def.id === id)
  if (index < 0) return false
  customObjects.splice(index, 1); persist(); return true
}

function nextId(prefix: 'terrain' | 'object', ids: string[]): string {
  let seq = 1
  while (ids.includes(`${prefix}:custom-${seq}`)) seq++
  return `${prefix}:custom-${seq}`
}

export function newTerrainType(): TerrainTypeDef {
  return { id: nextId('terrain', terrainTypeLibrary().map(def => def.id)), name: '新地形', color: '#FFFFFF', defaultW: 1, defaultH: 1, effect: 'none', moveModifier: 1 }
}

export function newObjectType(): ObjectTypeDef {
  return { id: nextId('object', objectTypeLibrary().map(def => def.id)), name: '新物体', color: '#5387C8', defaultW: 1, defaultH: 1, hp: 0, blockMove: false, blockProjectile: false, height: 0, renderLayer: 3, states: ['default'], events: [] }
}
