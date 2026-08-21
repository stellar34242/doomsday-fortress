// 可变关卡配置：地形/物体/固有建筑/核心位置/建造区/初始炮塔
// 参照 TURRET_DEFS 的可变模式：模块级 LEVEL 单例，战场编辑器直接改写，
// 「应用并重开」时持久化到 localStorage（key: td-level-config）。
// 注意：防御墙布局（模板墙生成）不在本期编辑范围，始终由 buildTemplateWalls 生成。
import {
  BARREL_HP, BARREL_POSITIONS, BASE_BOTTOM, COLS, CORE, RUINS_BLOCKS, RUINS_HP,
  ROCK_BLOCKS, ROWS, SPAWN_ROWS, TERRAIN, WALL_ROW,
} from './config'
import type { ObjectKind, TerrainKind } from './config'

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

export interface LevelConfig {
  version: number // 配置版本：4 起新增战场地面层 groundCells（RMXP Autotile 笔刷）
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
}

export const ROWS_MIN = 12 // 战场纵深下限（300m 一屏）；上限不限（v1.41）
export const COLS_MIN = 20 // 战场宽度下限（500m 一屏，不小于视口宽）；上限不限（v1.41）
const CANON_ROWS = 28 // 模板基准纵深（旧布局坐标系）

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
    version: 6,
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
  }
  return lv
}

const STORAGE_KEY = 'td-level-config-v7' // v7：横版 36×18 空地，旧 18 列存档作废

function storageGet(): string | null {
  try { return globalThis.localStorage?.getItem(STORAGE_KEY) ?? null } catch { return null }
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
    merged.version = 6 // v6：18×36 空地战场（玩家侧基地格/核心/墙退役）
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

/** 建造区格查询（格集合语义） */
export function isBuildCell(x: number, y: number): boolean {
  return LEVEL.buildCells.includes(`${x},${y}`)
}

export const LEVEL: LevelConfig = loadLevel()

/** 持久化当前 LEVEL 到 localStorage */
export function saveLevel() {
  invalidateWallInfo()
  try { globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(LEVEL)) } catch { /* 无存储环境 */ }
}

/** 恢复默认关卡并清除持久化 */
export function resetLevel() {
  invalidateWallInfo()
  const d = defaultLevel()
  for (const k of Object.keys(LEVEL)) delete (LEVEL as unknown as Record<string, unknown>)[k]
  Object.assign(LEVEL, d)
  try { globalThis.localStorage?.removeItem(STORAGE_KEY) } catch { /* 无存储环境 */ }
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
