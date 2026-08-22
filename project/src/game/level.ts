// 可变关卡配置：地形/物体/固有建筑/核心位置/建造区/初始炮塔
// 参照 TURRET_DEFS 的可变模式：模块级 LEVEL 单例，战场编辑器直接改写，
// 「应用并重开」时持久化到多关卡库；LEVEL 始终指向当前试玩关卡。
// 注意：防御墙布局（模板墙生成）不在本期编辑范围，始终由 buildTemplateWalls 生成。
import {
  BARREL_HP, BARREL_POSITIONS, BASE_BOTTOM, COLS, CORE, RUINS_BLOCKS, RUINS_HP,
  ROCK_BLOCKS, ROWS, SPAWN_ROWS, TERRAIN, WALL_ROW,
} from './config'
import type { EnemyKind, ObjectKind, TerrainKind } from './config'

const ck = (x: number, y: number) => `${x},${y}`

export interface LevelTerrain {
  kind: TerrainKind
  x: number
  y: number
  w: number
  h: number
  moveModifier: number // 地面移动效果（1 = 无效果）
}

export interface LevelObject {
  kind: ObjectKind
  x: number // 格（矩形左上角）
  y: number
  w: number
  h: number
  hp: number // -1 = 不可破坏
  blockMove: boolean
  blockProjectile: boolean
  height: number // 仅 blockProjectile=true 有意义：挡后方 N 格内目标的导弹
}

export interface LevelBuilding {
  id: number
  name: string
  x: number
  y: number
  w: number
  h: number
  color: string
}

export interface LevelTurret { defId: string; x: number; y: number }
export interface LevelWall { x: number; y: number }
export interface LevelZone { x: number; y: number; w: number; h: number }
export type LevelMode = 'defend' | 'advance'
export const TRIGGER_ENEMY_KINDS: EnemyKind[] = ['walker', 'runner', 'rusher', 'brute', 'flyer']

export interface LevelBossPhase {
  hpPercent: number
  actions: LevelEventAction[]
}

export interface LevelBossSpec {
  kind: EnemyKind
  name: string
  hpScale: number
  sizeScale: number
  phases: LevelBossPhase[]
  defeatActions: LevelEventAction[]
}

/** 通用关卡动作：区域、交互物与 Boss 阶段共同复用同一顺序执行语义。 */
export type LevelEventAction =
  | { type: 'wait'; seconds: number }
  | { type: 'spawn'; enemies: Record<EnemyKind, number>; interval: number }
  | { type: 'boss'; boss: LevelBossSpec }
  | { type: 'message'; text: string; duration: number }
  | { type: 'reward'; gold: number }
  | { type: 'objective'; objective: LevelObjective }
  | { type: 'toggle'; interactableId: number; enabled: boolean }
  | { type: 'complete' }

export type LevelInteractableKind = 'checkpoint' | 'supply' | 'gate' | 'target'
export interface LevelInteractable extends LevelZone {
  id: number
  name: string
  kind: LevelInteractableKind
  enabled: boolean
  once: boolean
  actions: LevelEventAction[]
}

export interface LevelRegionTrigger extends LevelZone {
  id: number
  name: string
  enabled: boolean
  activationLimit: number // 进入触发次数；1=一次性
  cooldown: number // 可重复触发时，两次激活的最短间隔（秒）
  delay: number // 进入区域至首个敌人出现的延迟（秒）
  interval: number // 编队内逐个出现的间隔（秒）
  enemies: Record<EnemyKind, number>
  actions: LevelEventAction[]
}

/** 关卡目标：保卫指定波数，或在连续进攻中生存指定秒数。 */
export type LevelObjective =
  | { type: 'defend'; waves: number; waveWait?: boolean; restTime?: number; overlapTime?: number }
  | { type: 'survive'; duration: number }
  | { type: 'reach' }

export interface LevelConfig {
  version: number // 配置版本：10 起新增通用动作与交互物
  mode: LevelMode // defend=现有波次防守；advance=直接交战并向终点推进
  rows: number // 战场纵深（格，下限 12；默认 72 = 1800m（v1.75：18→72）；旧存档保留原值）
  cols: number // 战场宽度（格，12–36；默认 18 = 450m；旧存档无此字段 → 取 COLS 默认）
  buildCells: string[] // 基地格格集合 "x,y"（场景编辑器铺设）
  groundCells: string[] // 战场地面层格集合 "x,y"（纯视觉，不影响逻辑；RMXP Autotile）
  core: { x: number; y: number } | null // 核心位置（尺寸沿用 CORE.w/h）；null = 已删除（不判负）
  buildings: LevelBuilding[] // 固有建筑
  terrain: LevelTerrain[]
  objects: LevelObject[]
  initialTurrets: LevelTurret[] // 开局免费炮塔
  initialWalls: LevelWall[] // 开局墙体（单格墙段，hp = WALL_HP；默认含原模板墙全部格位）
  objective: LevelObjective // 胜利条件；缺省为守住既有 6 波
  startZone: LevelZone // 玩家堡垒出生区域（堡垒在区域内居中并钳制到地图）
  finishZone: LevelZone // 推进模式终点区域（堡垒中心进入即完成 reach）
  triggers: LevelRegionTrigger[] // 堡垒进入矩形区域时按编队生成伏击敌人
  interactables: LevelInteractable[] // 可进入激活的检查点/补给/闸门/任务目标
}

export interface LevelLibraryEntry {
  id: string
  name: string
  level: LevelConfig
  nextId?: string | null
  reward?: number
}

export interface LevelLibrary {
  version: 1
  activeId: string
  levels: LevelLibraryEntry[]
}

export const ROWS_MIN = 12 // 战场纵深下限（300m 一屏）；上限不限（v1.41）
export const COLS_MIN = 20 // 战场宽度下限（500m 一屏，不小于视口宽）；上限不限（v1.41）
export const OBJECTIVE_WAVES_MIN = 1
export const OBJECTIVE_WAVES_MAX = 99
export const DEFEND_REST_TIME_DEFAULT = 60
export const DEFEND_OVERLAP_TIME_DEFAULT = 5
export const DEFEND_TIME_MAX = 3600
export const SURVIVE_SECONDS_MIN = 10
export const SURVIVE_SECONDS_MAX = 3600
const CANON_ROWS = 28 // 模板基准纵深（旧布局坐标系）

/** 旧存档/手改 JSON 的目标归一化，确保运行时只接收有限且有界的数值。 */
export function normalizeObjective(value: unknown, mode: LevelMode = 'defend'): LevelObjective {
  const o = value as Partial<LevelObjective> | null
  if (mode === 'advance') return { type: 'reach' }
  if (o?.type === 'survive') {
    const raw = Number((o as { duration?: unknown }).duration)
    return {
      type: 'survive',
      duration: Math.max(SURVIVE_SECONDS_MIN, Math.min(SURVIVE_SECONDS_MAX, Number.isFinite(raw) ? Math.round(raw) : 180)),
    }
  }
  const raw = Number((o as { waves?: unknown } | null)?.waves)
  const defend = o as { waveWait?: unknown; restTime?: unknown; overlapTime?: unknown } | null
  const restRaw = Number(defend?.restTime)
  const overlapRaw = Number(defend?.overlapTime)
  return {
    type: 'defend',
    waves: Math.max(OBJECTIVE_WAVES_MIN, Math.min(OBJECTIVE_WAVES_MAX, Number.isFinite(raw) ? Math.round(raw) : 6)),
    waveWait: typeof defend?.waveWait === 'boolean' ? defend.waveWait : true,
    restTime: Math.max(0, Math.min(DEFEND_TIME_MAX, Number.isFinite(restRaw) ? restRaw : DEFEND_REST_TIME_DEFAULT)),
    overlapTime: Math.max(0, Math.min(DEFEND_TIME_MAX, Number.isFinite(overlapRaw) ? overlapRaw : DEFEND_OVERLAP_TIME_DEFAULT)),
  }
}

export function normalizeLevelMode(value: unknown): LevelMode {
  return value === 'advance' ? 'advance' : 'defend'
}

/** 区域归一化：至少 1×1，且完整落在地图范围内。 */
export function normalizeZone(value: unknown, fallback: LevelZone, rows: number, cols: number): LevelZone {
  const z = value as Partial<LevelZone> | null
  const finite = (v: unknown, d: number) => typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : d
  const x = Math.max(0, Math.min(cols - 1, finite(z?.x, fallback.x)))
  const y = Math.max(0, Math.min(rows - 1, finite(z?.y, fallback.y)))
  const w = Math.max(1, Math.min(cols - x, finite(z?.w, fallback.w)))
  const h = Math.max(1, Math.min(rows - y, finite(z?.h, fallback.h)))
  return { x, y, w, h }
}

export function defaultStartZone(rows: number, cols: number): LevelZone {
  const w = Math.min(6, cols)
  return { x: Math.floor((cols - w) / 2), y: Math.max(0, rows - 5), w, h: Math.min(4, rows) }
}

export function defaultFinishZone(rows: number, cols: number): LevelZone {
  return { x: 0, y: 0, w: cols, h: Math.min(6, rows) }
}

export function emptyTriggerEnemies(): Record<EnemyKind, number> {
  return { walker: 0, runner: 0, rusher: 0, brute: 0, flyer: 0 }
}

function normalizeEnemies(value: unknown): Record<EnemyKind, number> {
  const enemies = emptyTriggerEnemies()
  const raw = value as Partial<Record<EnemyKind, unknown>> | null
  for (const kind of TRIGGER_ENEMY_KINDS) {
    const n = Number(raw?.[kind])
    enemies[kind] = Math.max(0, Math.min(99, Number.isFinite(n) ? Math.round(n) : 0))
  }
  return enemies
}

export function normalizeEventActions(value: unknown, depth = 0): LevelEventAction[] {
  if (!Array.isArray(value) || depth > 2) return []
  const out: LevelEventAction[] = []
  for (const raw0 of value.slice(0, 40)) {
    const raw = raw0 as Record<string, unknown>
    if (raw.type === 'wait') out.push({ type: 'wait', seconds: Math.max(0, Math.min(300, Number(raw.seconds) || 0)) })
    else if (raw.type === 'spawn') out.push({ type: 'spawn', enemies: normalizeEnemies(raw.enemies), interval: Math.max(0, Math.min(60, Number(raw.interval) || 0)) })
    else if (raw.type === 'message') out.push({ type: 'message', text: String(raw.text ?? '').slice(0, 120), duration: Math.max(0.5, Math.min(15, Number(raw.duration) || 3)) })
    else if (raw.type === 'reward') out.push({ type: 'reward', gold: Math.max(0, Math.min(99999, Math.round(Number(raw.gold) || 0))) })
    else if (raw.type === 'objective') {
      const objective = (raw.objective as Partial<LevelObjective> | null)?.type === 'reach' ? { type: 'reach' as const } : normalizeObjective(raw.objective)
      out.push({ type: 'objective', objective })
    }
    else if (raw.type === 'toggle') out.push({ type: 'toggle', interactableId: Math.max(1, Math.round(Number(raw.interactableId) || 1)), enabled: raw.enabled !== false })
    else if (raw.type === 'complete') out.push({ type: 'complete' })
    else if (raw.type === 'boss') {
      const b = (raw.boss ?? {}) as Record<string, unknown>
      const kind = TRIGGER_ENEMY_KINDS.includes(b.kind as EnemyKind) ? b.kind as EnemyKind : 'brute'
      const phases = Array.isArray(b.phases) ? b.phases.slice(0, 5).map(p0 => {
        const p = p0 as Record<string, unknown>
        return { hpPercent: Math.max(1, Math.min(99, Number(p.hpPercent) || 50)), actions: normalizeEventActions(p.actions, depth + 1) }
      }).sort((a, b2) => b2.hpPercent - a.hpPercent) : []
      out.push({ type: 'boss', boss: {
        kind, name: String(b.name ?? '荒原巨兽').slice(0, 40),
        hpScale: Math.max(1, Math.min(100, Number(b.hpScale) || 8)),
        sizeScale: Math.max(1, Math.min(4, Number(b.sizeScale) || 1.8)),
        phases, defeatActions: normalizeEventActions(b.defeatActions, depth + 1),
      } })
    }
  }
  return out
}

export function normalizeTriggers(value: unknown, rows: number, cols: number): LevelRegionTrigger[] {
  if (!Array.isArray(value)) return []
  const used = new Set<number>()
  return value.slice(0, 100).map((raw, index) => {
    const t = raw as Partial<LevelRegionTrigger>
    let id = Number.isFinite(t.id) ? Math.max(1, Math.round(t.id!)) : index + 1
    while (used.has(id)) id++
    used.add(id)
    const zone = normalizeZone(t, { x: 1, y: Math.max(0, rows - 12), w: Math.min(8, cols - 1), h: Math.min(6, rows) }, rows, cols)
    const enemies = normalizeEnemies(t.enemies)
    const legacyActions: LevelEventAction[] = [
      ...(Number(t.delay) > 0 ? [{ type: 'wait' as const, seconds: Number(t.delay) }] : []),
      { type: 'spawn', enemies, interval: Math.max(0, Math.min(60, Number(t.interval) || 0.35)) },
    ]
    return {
      id,
      name: typeof t.name === 'string' && t.name.trim() ? t.name.slice(0, 40) : `伏击区 ${id}`,
      enabled: t.enabled !== false,
      activationLimit: Math.max(1, Math.min(99, Number.isFinite(t.activationLimit) ? Math.round(t.activationLimit!) : 1)),
      cooldown: Math.max(0, Math.min(3600, Number.isFinite(t.cooldown) ? t.cooldown! : 10)),
      delay: Math.max(0, Math.min(300, Number.isFinite(t.delay) ? t.delay! : 0.5)),
      interval: Math.max(0, Math.min(60, Number.isFinite(t.interval) ? t.interval! : 0.35)),
      enemies,
      actions: normalizeEventActions(t.actions).length > 0 ? normalizeEventActions(t.actions) : legacyActions,
      ...zone,
    }
  })
}

export function normalizeInteractables(value: unknown, rows: number, cols: number): LevelInteractable[] {
  if (!Array.isArray(value)) return []
  const used = new Set<number>()
  return value.slice(0, 100).map((raw0, index) => {
    const raw = raw0 as Partial<LevelInteractable>
    let id = Number.isFinite(raw.id) ? Math.max(1, Math.round(raw.id!)) : index + 1
    while (used.has(id)) id++
    used.add(id)
    const kind: LevelInteractableKind = ['checkpoint', 'supply', 'gate', 'target'].includes(String(raw.kind)) ? raw.kind! : 'checkpoint'
    return {
      id, kind, name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.slice(0, 40) : `交互物 ${id}`,
      enabled: raw.enabled !== false, once: raw.once !== false,
      actions: normalizeEventActions(raw.actions),
      ...normalizeZone(raw, { x: Math.floor(cols / 2), y: Math.floor(rows / 2), w: 2, h: 2 }, rows, cols),
    }
  })
}

/** 模板墙格位（按纵深底部锚定）：顶边 rows-10 全宽 + 两侧 + 底边 */
export function templateWallCells(rows: number = LEVEL.rows, cols: number = LEVEL.cols): LevelWall[] {
  const top = rows - 10 // 基准布局 WALL_ROW=18 在 28 格中 → 底部锚定后 = rows-10
  const cells: LevelWall[] = []
  for (let x = 0; x < cols; x++) cells.push({ x, y: top }) // 顶边
  for (let y = top + 1; y < rows; y++) { // 两侧（顶边角格已在上面）
    cells.push({ x: 0, y })
    cells.push({ x: cols - 1, y })
  }
  for (let x = 1; x <= cols - 2; x++) cells.push({ x, y: rows - 1 }) // 底边（角格已在两侧）
  return cells
}

/** 纵深变更的底部锚定迁移：所有 y 坐标平移 (newRows - oldRows)，出界元素丢弃（以战场下沿为锚） */
export function reanchorRows(lv: LevelConfig, newRows: number): void {
  const rows = Number.isFinite(newRows) ? Math.max(ROWS_MIN, Math.round(newRows)) : ROWS_MIN // 上限不限：仅保留下限与有限性
  const dy = rows - lv.rows
  if (dy === 0) { lv.rows = rows; return }
  const inY = (y: number) => y >= 0 && y < rows
  lv.buildCells = lv.buildCells
    .map(k => { const [x, y] = k.split(',').map(Number); return { x, y: y + dy } })
    .filter(c => inY(c.y))
    .map(c => `${c.x},${c.y}`)
  lv.groundCells = lv.groundCells
    .map(k => { const [x, y] = k.split(',').map(Number); return { x, y: y + dy } })
    .filter(c => inY(c.y))
    .map(c => `${c.x},${c.y}`)
  lv.initialWalls = lv.initialWalls.map(w => ({ x: w.x, y: w.y + dy })).filter(w => inY(w.y))
  lv.objects = lv.objects.map(o => ({ ...o, y: o.y + dy })).filter(o => o.y + o.h > 0 && o.y < rows)
  lv.terrain = lv.terrain.map(t => ({ ...t, y: t.y + dy })).filter(t => t.y + t.h > 0 && t.y < rows)
  lv.buildings = lv.buildings.map(b => ({ ...b, y: b.y + dy })).filter(b => b.y + b.h > 0 && b.y < rows)
  lv.initialTurrets = lv.initialTurrets.map(t => ({ ...t, y: t.y + dy })).filter(t => inY(t.y))
  lv.triggers = lv.triggers
    .map(t => ({ ...t, y: t.y + dy }))
    .filter(t => t.y + t.h > 0 && t.y < rows)
    .map(t => ({ ...t, ...normalizeZone(t, t, rows, lv.cols) }))
  lv.interactables = lv.interactables
    .map(t => ({ ...t, y: t.y + dy }))
    .filter(t => t.y + t.h > 0 && t.y < rows)
    .map(t => ({ ...t, ...normalizeZone(t, t, rows, lv.cols) }))
  lv.startZone = normalizeZone({ ...lv.startZone, y: lv.startZone.y + dy }, defaultStartZone(rows, lv.cols), rows, lv.cols)
  lv.finishZone = normalizeZone({ ...lv.finishZone, y: lv.finishZone.y + dy }, defaultFinishZone(rows, lv.cols), rows, lv.cols)
  if (lv.core) {
    lv.core = { x: lv.core.x, y: lv.core.y + dy }
    if (!inY(lv.core.y)) lv.core = null
  }
  lv.rows = rows
}

/** 宽度变更的左侧锚定迁移：x 坐标不变，x ≥ newCols 的元素丢弃，部分出界的矩形收缩宽度 */
export function reanchorCols(lv: LevelConfig, newCols: number): void {
  const cols = Number.isFinite(newCols) ? Math.max(COLS_MIN, Math.round(newCols)) : COLS_MIN // 上限不限：仅保留下限与有限性
  if (cols === lv.cols) return
  const inX = (x: number) => x >= 0 && x < cols
  const shrink = <T extends { x: number; w: number }>(arr: T[]): T[] =>
    arr.filter(o => inX(o.x)).map(o => (o.x + o.w > cols ? { ...o, w: cols - o.x } : o))
  lv.buildCells = lv.buildCells
    .map(k => k.split(',').map(Number))
    .filter(([x]) => inX(x))
    .map(([x, y]) => `${x},${y}`)
  lv.groundCells = lv.groundCells
    .map(k => k.split(',').map(Number))
    .filter(([x]) => inX(x))
    .map(([x, y]) => `${x},${y}`)
  lv.initialWalls = lv.initialWalls.filter(w => inX(w.x))
  lv.initialTurrets = lv.initialTurrets.filter(t => inX(t.x))
  lv.triggers = lv.triggers
    .filter(t => t.x < cols && t.x + t.w > 0)
    .map(t => ({ ...t, ...normalizeZone(t, t, lv.rows, cols) }))
  lv.interactables = lv.interactables
    .filter(t => t.x < cols && t.x + t.w > 0)
    .map(t => ({ ...t, ...normalizeZone(t, t, lv.rows, cols) }))
  lv.startZone = normalizeZone(lv.startZone, defaultStartZone(lv.rows, cols), lv.rows, cols)
  lv.finishZone = normalizeZone(lv.finishZone, defaultFinishZone(lv.rows, cols), lv.rows, cols)
  lv.objects = shrink(lv.objects)
  lv.terrain = shrink(lv.terrain)
  lv.buildings = shrink(lv.buildings)
  if (lv.core && !inX(lv.core.x)) lv.core = null
  lv.cols = cols
}

/** 矩形行区展开为格集合 */
function expandRows(top: number, bottom: number): string[] {
  const cells: string[] = []
  for (let y = top; y <= bottom; y++)
    for (let x = 0; x < COLS; x++) cells.push(`${x},${y}`)
  return cells
}

/** 默认关卡 = 移动堡垒战场（18×ROWS 空地，坐标直接按 config 布设，不做底部锚定）。
 *  玩家侧基地格/核心/固有建筑/初始墙全部退役（保留类型供未来敌方要塞关卡使用） */
export function defaultLevel(rows: number = ROWS, cols: number = COLS): LevelConfig {
  const lv: LevelConfig = {
    version: 10,
    mode: 'defend',
    rows,
    cols,
    buildCells: [], // 玩家侧基地格退役（移动堡垒无地面建造区）
    groundCells: [], // 战场地面层默认空（纯视觉笔刷层）
    core: null, // 核心建筑退役（胜负 = 船体耐久）
    buildings: [], // 固有建筑退役
    terrain: TERRAIN.map(t => ({
      kind: t.kind, x: t.x, y: t.y, w: t.w, h: t.h, moveModifier: 0.5,
    })),
    objects: [
      ...BARREL_POSITIONS.map(([x, y]): LevelObject => ({
        kind: 'barrel', x, y, w: 1, h: 1, hp: BARREL_HP,
        blockMove: true, blockProjectile: false, height: 1,
      })),
      ...RUINS_BLOCKS.map((b): LevelObject => ({
        kind: 'ruins', ...b, hp: RUINS_HP, blockMove: true, blockProjectile: true, height: 1,
      })),
      ...ROCK_BLOCKS.map((b): LevelObject => ({
        kind: 'rock', ...b, hp: -1, blockMove: true, blockProjectile: false, height: 1,
      })),
    ],
    initialTurrets: [],
    initialWalls: [],
    objective: { type: 'defend', waves: 6, waveWait: true, restTime: DEFEND_REST_TIME_DEFAULT, overlapTime: DEFEND_OVERLAP_TIME_DEFAULT },
    startZone: defaultStartZone(rows, cols),
    finishZone: defaultFinishZone(rows, cols),
    triggers: [],
    interactables: [],
  }
  return lv
}

const STORAGE_KEY = 'td-level-config-v7' // 单关卡旧存档；多关卡库首次加载时自动迁移
const LIBRARY_STORAGE_KEY = 'td-level-library-v1'

function storageGet(): string | null {
  try { return globalThis.localStorage?.getItem(STORAGE_KEY) ?? null } catch { return null }
}

function libraryStorageGet(): string | null {
  try { return globalThis.localStorage?.getItem(LIBRARY_STORAGE_KEY) ?? null } catch { return null }
}

/** 解析（含旧格式迁移：buildTop/buildBottom => buildCells；version<2 并入模板墙格；v4 补 groundCells） */
export function parseLevel(raw: string | null): LevelConfig {
  if (!raw) return defaultLevel() // 移动堡垒默认关卡：无基地格/核心/墙
  try {
    const parsed = JSON.parse(raw) as Partial<LevelConfig> & { buildTop?: number; buildBottom?: number }
    const base = defaultLevel()
    const merged = { ...base, ...parsed }
    const mRows = typeof parsed.rows === 'number' && Number.isFinite(parsed.rows) ? parsed.rows : CANON_ROWS
    merged.rows = Math.max(ROWS_MIN, Math.round(mRows)) // 旧配置无 rows → 28 保留行为；上限不限（仅保留下限）
    const mCols = typeof parsed.cols === 'number' && Number.isFinite(parsed.cols) ? parsed.cols : COLS
    merged.cols = Math.max(COLS_MIN, Math.round(mCols)) // 旧配置无 cols → COLS 默认；上限不限（仅保留下限）
    if (!Array.isArray(parsed.buildCells)) {
      // 旧格式：按原语义（buildTop–buildBottom 行全宽）迁移
      const top = typeof parsed.buildTop === 'number' ? parsed.buildTop : WALL_ROW
      const bottom = typeof parsed.buildBottom === 'number' ? parsed.buildBottom : BASE_BOTTOM
      merged.buildCells = expandRows(top, bottom)
    }
    if (typeof parsed.version !== 'number' || parsed.version < 2) {
      // 老存档：模板墙格并入 initialWalls（去重）；version 2 起尊重用户删除（含删光）
      const user = Array.isArray(parsed.initialWalls) ? parsed.initialWalls : []
      const seen = new Set<string>()
      merged.initialWalls = [...templateWallCells(merged.rows), ...user].filter(w => {
        const k = `${w.x},${w.y}`
        if (seen.has(k)) return false
        seen.add(k)
        return true
      })
    } else if (!Array.isArray(parsed.initialWalls)) {
      merged.initialWalls = []
    }
    if (!Array.isArray(parsed.groundCells)) merged.groundCells = [] // v4 新增：旧存档无战场地面层
    merged.mode = normalizeLevelMode(parsed.mode)
    merged.objective = normalizeObjective(parsed.objective, merged.mode)
    merged.startZone = normalizeZone(parsed.startZone, defaultStartZone(merged.rows, merged.cols), merged.rows, merged.cols)
    merged.finishZone = normalizeZone(parsed.finishZone, defaultFinishZone(merged.rows, merged.cols), merged.rows, merged.cols)
    merged.triggers = normalizeTriggers(parsed.triggers, merged.rows, merged.cols)
    merged.interactables = normalizeInteractables(parsed.interactables, merged.rows, merged.cols)
    merged.version = 10 // v10：通用事件动作、交互物、Boss 与关卡链
    delete (merged as Record<string, unknown>).buildTop
    delete (merged as Record<string, unknown>).buildBottom
    if (typeof parsed.version !== 'number' || parsed.version < 3) {
      // 旧存档迁移：模板墙格并入 buildCells 形成基地格全集；v3 起尊重用户编辑结果（含拆除墙格），不再回补
      merged.buildCells = mergeBaseCells(merged.buildCells, merged.rows)
    }
    return merged
  } catch { /* 数据损坏则回退默认 */
    return defaultLevel()
  }
}

export function loadLevel(): LevelConfig {
  return parseLevel(storageGet())
}

export function defaultLevelLibrary(level: LevelConfig = defaultLevel()): LevelLibrary {
  return { version: 1, activeId: 'level-1', levels: [{ id: 'level-1', name: '关卡 01', level: structuredClone(level) }] }
}

/** 多关卡库解析：库不存在或损坏时把旧单关卡存档迁移为“关卡 01”。 */
export function parseLevelLibrary(raw: string | null, legacyRaw: string | null = null): LevelLibrary {
  if (!raw) return defaultLevelLibrary(parseLevel(legacyRaw))
  try {
    const value = JSON.parse(raw) as Partial<LevelLibrary>
    if (!Array.isArray(value.levels) || value.levels.length === 0) return defaultLevelLibrary(parseLevel(legacyRaw))
    const used = new Set<string>()
    const levels: LevelLibraryEntry[] = []
    for (let i = 0; i < Math.min(50, value.levels.length); i++) {
      const src = value.levels[i] as Partial<LevelLibraryEntry>
      let id = typeof src.id === 'string' && src.id.trim() ? src.id.trim().slice(0, 64) : `level-${i + 1}`
      while (used.has(id)) id = `${id}-${i + 1}`
      used.add(id)
      const name = typeof src.name === 'string' && src.name.trim() ? src.name.trim().slice(0, 40) : `关卡 ${String(i + 1).padStart(2, '0')}`
      const nextId = typeof src.nextId === 'string' && src.nextId.trim() ? src.nextId.trim().slice(0, 64) : null
      const reward = Math.max(0, Math.min(99999, Math.round(Number(src.reward) || 0)))
      levels.push({ id, name, level: parseLevel(JSON.stringify(src.level ?? {})), nextId, reward })
    }
    for (const entry of levels) if (entry.nextId === entry.id || !levels.some(x => x.id === entry.nextId)) entry.nextId = null
    const activeId = levels.some(x => x.id === value.activeId) ? value.activeId! : levels[0].id
    return { version: 1, activeId, levels }
  } catch {
    return defaultLevelLibrary(parseLevel(legacyRaw))
  }
}

export function loadLevelLibrary(): LevelLibrary {
  return parseLevelLibrary(libraryStorageGet(), storageGet())
}

/** 建造区格查询（格集合语义） */
export function isBuildCell(x: number, y: number): boolean {
  return LEVEL.buildCells.includes(`${x},${y}`)
}

export const LEVEL_LIBRARY: LevelLibrary = loadLevelLibrary()
export const LEVEL: LevelConfig = structuredClone(LEVEL_LIBRARY.levels.find(x => x.id === LEVEL_LIBRARY.activeId)?.level ?? defaultLevel())

function replaceLevel(target: LevelConfig, source: LevelConfig) {
  for (const k of Object.keys(target)) delete (target as unknown as Record<string, unknown>)[k]
  Object.assign(target, structuredClone(source))
}

function persistLibrary() {
  try {
    globalThis.localStorage?.setItem(LIBRARY_STORAGE_KEY, JSON.stringify(LEVEL_LIBRARY))
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(LEVEL)) // 保留旧单关卡兼容镜像
  } catch { /* 无存储环境 */ }
}

function syncActiveEntry() {
  const active = LEVEL_LIBRARY.levels.find(x => x.id === LEVEL_LIBRARY.activeId)
  if (active) active.level = structuredClone(LEVEL)
}

/** 导出用快照：先把当前 LEVEL 同步回活动条目，保证库与正在玩的关卡一致。 */
export function levelLibraryForExport(): LevelLibrary {
  syncActiveEntry()
  return structuredClone(LEVEL_LIBRARY)
}

/** 原子替换整个关卡库，并把 LEVEL 切到库的活动关卡。 */
export function saveLevelLibrary(value: LevelLibrary) {
  const normalized = parseLevelLibrary(JSON.stringify(value))
  LEVEL_LIBRARY.version = 1
  LEVEL_LIBRARY.activeId = normalized.activeId
  LEVEL_LIBRARY.levels.splice(0, LEVEL_LIBRARY.levels.length, ...normalized.levels)
  replaceLevel(LEVEL, LEVEL_LIBRARY.levels.find(x => x.id === LEVEL_LIBRARY.activeId)!.level)
  invalidateWallInfo()
  persistLibrary()
}

const PROGRESS_STORAGE_KEY = 'td-level-progress-v1'
export interface LevelProgress { completedIds: string[]; totalReward: number }

export function loadLevelProgress(): LevelProgress {
  try {
    const raw = JSON.parse(globalThis.localStorage?.getItem(PROGRESS_STORAGE_KEY) ?? '{}') as Partial<LevelProgress>
    return {
      completedIds: Array.isArray(raw.completedIds) ? [...new Set(raw.completedIds.filter(x => typeof x === 'string'))].slice(0, 200) : [],
      totalReward: Math.max(0, Math.round(Number(raw.totalReward) || 0)),
    }
  } catch { return { completedIds: [], totalReward: 0 } }
}

export function completeActiveLevel(): LevelProgress {
  const progress = loadLevelProgress()
  if (!progress.completedIds.includes(LEVEL_LIBRARY.activeId)) {
    progress.completedIds.push(LEVEL_LIBRARY.activeId)
    progress.totalReward += LEVEL_LIBRARY.levels.find(x => x.id === LEVEL_LIBRARY.activeId)?.reward ?? 0
    try { globalThis.localStorage?.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(progress)) } catch { /* 无存储环境 */ }
  }
  return progress
}

export function activateLibraryLevel(id: string): boolean {
  const entry = LEVEL_LIBRARY.levels.find(x => x.id === id)
  if (!entry) return false
  syncActiveEntry()
  LEVEL_LIBRARY.activeId = id
  replaceLevel(LEVEL, entry.level)
  invalidateWallInfo()
  persistLibrary()
  return true
}

/** 持久化当前 LEVEL 到 localStorage */
export function saveLevel() {
  invalidateWallInfo()
  syncActiveEntry()
  persistLibrary()
}

/** 恢复默认关卡并清除持久化 */
export function resetLevel() {
  invalidateWallInfo()
  const library = defaultLevelLibrary()
  LEVEL_LIBRARY.activeId = library.activeId
  LEVEL_LIBRARY.levels.splice(0, LEVEL_LIBRARY.levels.length, ...library.levels)
  replaceLevel(LEVEL, library.levels[0].level)
  try {
    globalThis.localStorage?.removeItem(STORAGE_KEY)
    globalThis.localStorage?.removeItem(LIBRARY_STORAGE_KEY)
  } catch { /* 无存储环境 */ }
}

/** 核心矩形（位置随 LEVEL，尺寸沿用 CORE.w/h）；核心被删除时为 null */
export function coreRect(): { x: number; y: number; w: number; h: number } | null {
  if (!LEVEL.core) return null
  return { x: LEVEL.core.x, y: LEVEL.core.y, w: CORE.w, h: CORE.h }
}

// ================= 场景编辑笔刷默认值（Debug 面板可调） =================
export const BRUSH_DEFAULTS = {
  moveModifier: 0.5, // 地形-水坑笔刷默认减速
  obj: {
    barrel: { hp: BARREL_HP, blockMove: true, blockProjectile: false, height: 1 },
    ruins: { hp: RUINS_HP, blockMove: true, blockProjectile: true, height: 1 },
    rock: { hp: -1, blockMove: true, blockProjectile: false, height: 1 },
  } as Record<ObjectKind, { hp: number; blockMove: boolean; blockProjectile: boolean; height: number }>,
  turretDefId: 'mg', // 初始炮塔笔刷默认型号
  building: { name: '新建筑', w: 2, h: 2 }, // 固有建筑笔刷默认尺寸/名称
  selectedBuildingId: null as number | null, // 建筑笔刷：面板中选中的建筑（点地图移动它）
  selectedTriggerId: null as number | null, // 伏击区域笔刷：面板中选中的触发器（点地图移动它）
  selectedInteractableId: null as number | null,
}

// ---------- 基地格体系（战场空间重构：唯一可建造区域；派生防御墙自动成型） ----------

/** 基地格全集迁移：旧配置（templateWallCells 墙格 + buildCells）合并为基地格（幂等去重） */
export function mergeBaseCells(buildCells: string[], rows: number = LEVEL.rows): string[] {
  const seen = new Set(buildCells)
  for (const c of templateWallCells(rows)) seen.add(ck(c.x, c.y))
  return [...seen]
}

/** 是否基地格（唯一可建造区域；本身无耐久不可摧毁） */
export function isBaseCell(x: number, y: number): boolean {
  return x >= 0 && x < LEVEL.cols && y >= 0 && y < LEVEL.rows && LEVEL.buildCells.includes(ck(x, y))
}

/** 派生墙段：基地格且 4 邻至少一侧为非基地格（边界外视为外部）；墙段格不可建造 */
/** 原始墙段：基地格且有非基地邻居（不含孤立忽略逻辑，供孤立判定使用） */
function isRawWallCell(x: number, y: number, baseSet: Set<string>): boolean {
  return baseSet.has(`${x},${y}`)
    && (!baseSet.has(`${x - 1},${y}`) || !baseSet.has(`${x + 1},${y}`) || !baseSet.has(`${x},${y - 1}`) || !baseSet.has(`${x},${y + 1}`))
}

/** 相邻基地格数量（含墙段，不含自身） */
function nBaseOf(x: number, y: number, baseSet: Set<string>): number {
  return [[-1, 0], [1, 0], [0, -1], [0, 1]].filter(([dx, dy]) => baseSet.has(`${x + dx},${y + dy}`)).length
}

/** 孤立格(33)（修订规则）：是原始墙段，且相邻基地格 ≤1，且唯一的那个邻居不是有效墙
 *  （有效墙 = 原始墙段且相邻基地格 >1）。唯一邻居是有效墙时，该格是端头（算墙、可连接）。 */
function isIsolatedCell(x: number, y: number, baseSet: Set<string>): boolean {
  if (!isRawWallCell(x, y, baseSet)) return false
  const nb = [[-1, 0], [1, 0], [0, -1], [0, 1]].filter(([dx, dy]) => baseSet.has(`${x + dx},${y + dy}`))
  if (nb.length === 0) return true
  if (nb.length > 1) return false
  const [dx, dy] = nb[0]
  return !(isRawWallCell(x + dx, y + dy, baseSet) && nBaseOf(x + dx, y + dy, baseSet) > 1)
}

/** 派生墙信息：walls = 派生墙段集合（孤立格不计入基地邻接），isolated = 孤立格(33)集合 */
export interface WallInfo { walls: Set<string>; isolated: Set<string> }

/** 计算派生墙信息（孤立判定使用原始墙段——有非基地邻居的格） */
export function computeWallInfo(baseCells: string[]): WallInfo {
  const baseSet = new Set(baseCells)
  const rawWalls = new Set<string>()
  for (const k of baseSet) {
    const [x, y] = k.split(',').map(Number)
    if (isRawWallCell(x, y, baseSet)) rawWalls.add(k)
  }
  const isolated = new Set<string>()
  for (const k of rawWalls) {
    const [x, y] = k.split(',').map(Number)
    if (isIsolatedCell(x, y, baseSet)) isolated.add(k)
  }
  // 派生墙段：有(非基地 或 孤立格)邻居
  const walls = new Set<string>()
  for (const k of baseSet) {
    const [x, y] = k.split(',').map(Number)
    if ([[-1, 0], [1, 0], [0, -1], [0, 1]].some(([dx, dy]) => !baseSet.has(`${x + dx},${y + dy}`) || isolated.has(`${x + dx},${y + dy}`))) walls.add(k)
  }
  return { walls, isolated }
}

let wallInfoCache: WallInfo | null = null
/** 读取派生墙信息（带缓存；基地格变更时经 invalidateWallInfo 失效） */
export function getWallInfo(): WallInfo {
  if (!wallInfoCache) wallInfoCache = computeWallInfo(LEVEL.buildCells)
  return wallInfoCache
}
export function invalidateWallInfo(): void { wallInfoCache = null }

/** 墙段：派生墙段集合成员（孤立格不计入基地邻接） */
export function isWallSegment(x: number, y: number): boolean {
  return getWallInfo().walls.has(`${x},${y}`)
}

/** 里侧格：基地格且非墙段（防御设施唯一可建处） */
export function isInnerCell(x: number, y: number): boolean {
  return isBaseCell(x, y) && !isWallSegment(x, y)
}

/** 基地格扩建校验：在战场内、与最近基地格切比雪夫距离 ≤2、不在出生区、不在可破坏物体格（hp≥0） */
export function canPlaceBaseCell(x: number, y: number): { ok: boolean; reason?: string } {
  if (x < 0 || x >= LEVEL.cols || y < 0 || y >= LEVEL.rows) return { ok: false, reason: '超出战场' }
  if (isBaseCell(x, y)) return { ok: false, reason: '已是基地格' }
  if (y < SPAWN_ROWS) return { ok: false, reason: '出生区禁止' }
  if (LEVEL.objects.some(o => o.hp >= 0 && x >= o.x && x < o.x + o.w && y >= o.y && y < o.y + o.h)) {
    return { ok: false, reason: '可破坏物体所在地格' }
  }
  const near = LEVEL.buildCells.some(k => {
    const [bx, by] = k.split(',').map(Number)
    return Math.max(Math.abs(bx - x), Math.abs(by - y)) <= 2
  })
  if (!near) return { ok: false, reason: '距离最近基地格超过 2 格' }
  return { ok: true }
}
