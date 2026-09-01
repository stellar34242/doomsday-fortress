// 可变关卡配置：地形/物体/固有建筑/核心位置/建造区/初始炮塔
// 参照 TURRET_DEFS 的可变模式：模块级 LEVEL 单例，战场编辑器直接改写，
// 「应用并重开」时持久化到多关卡库；LEVEL 始终指向当前试玩关卡。
// 注意：防御墙布局（模板墙生成）不在本期编辑范围，始终由 buildTemplateWalls 生成。
import {
  BARREL_HP, BARREL_POSITIONS, BASE_BOTTOM, COLS, CORE, RUINS_BLOCKS, RUINS_HP,
  ROCK_BLOCKS, ROWS, SPAWN_ROWS, TERRAIN, WALL_ROW,
} from './config'
import type { EnemyKind, ObjectKind, TerrainKind } from './config'
import {
  emptyConditionGroup, normalizeConditionGroup, normalizeRegionCells, normalizeTileCells, normalizeUnifiedEvents, normalizeVariables,
  regionCellsFromRect,
} from './levelEditor'
import type { LevelConditionGroup, LevelTileCell, LevelVariableDef, UnifiedLevelEvent } from './levelEditor'
import { gameParameters } from './gameParameters'

const ck = (x: number, y: number) => `${x},${y}`

export interface LevelTerrain {
  id?: number
  kind: TerrainKind
  /** 可复用地形定义；旧关卡缺失时按 kind 回退。 */
  defId?: string
  x: number
  y: number
  w: number
  h: number
  moveModifier: number // 地面移动效果（1 = 无效果）
}

export interface LevelObject {
  id?: number
  kind: ObjectKind
  /** 可复用物体定义；kind 仅用于兼容旧关卡和无贴图回退外观。 */
  defId?: string
  x: number // 格（矩形左上角）
  y: number
  w: number
  h: number
  hp: number // -1 = 不可破坏
  blockMove: boolean
  blockProjectile: boolean
  height: number // 0–3 离散高度；仅 blockProjectile=true 时参与弹道、掩体与爆炸减伤
  renderLayer?: 1 | 2 | 3 | 4 | 5
  flipX?: boolean
  rotation?: 0 | 90 | 180 | 270
  state?: string
  /** 由物体类型的默认事件模板复制而来；关卡内每个实例独立保存。 */
  events?: LevelObjectEvent[]
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

/** @deprecated v17 起不再支持独立初始炮塔；仅用于读取旧存档后丢弃。 */
export interface LevelTurret { defId: string; x: number; y: number }
export interface LevelWall { x: number; y: number }
export interface LevelZone { x: number; y: number; w: number; h: number }
export type LevelPlacedUnitFaction = 'player' | 'ally' | 'enemy' | 'neutral' | 'neutralHostile'
export type LevelPlacedUnitController = 'player' | 'ai' | 'script' | 'static'
export type LevelUnitEventTrigger = 'interact' | 'destroyed' | 'contact'
export interface LevelLocalEvent {
  id: number
  name: string
  trigger: LevelUnitEventTrigger
  activationLimit: number
  cooldown: number
  conditions: LevelConditionGroup
  actions: LevelEventAction[]
}
export type LevelUnitEvent = LevelLocalEvent
export type LevelObjectEvent = LevelLocalEvent
/** 关卡开局单位实例；x/y 是单位几何中心，unitDefId 是唯一运行时定义来源。 */
export interface LevelUnitPlacement {
  id: number
  unitDefId: string
  faction: LevelPlacedUnitFaction
  controller: LevelPlacedUnitController
  /** 关卡实例编组；同组且非敌对的单位共享视野，任一成员攻击或受击时共同接战。 */
  group?: string
  x: number
  y: number
  /** 实例贴图水平镜像；只改变该关卡实例，不修改单位模板。 */
  flipX?: boolean
  /** 实例初始朝向；0 = 车头/正面朝上，按顺时针角度旋转。 */
  rotation?: 0 | 90 | 180 | 270
  /** 保留炮塔 AI 的实例级车体锁定；用于固定炮台底座。 */
  lockMovement?: boolean
  lockRotation?: boolean
  renderLayer?: 1 | 2 | 3 | 4 | 5
  /** 停留不归位；坚守、随机、路线、接近在脱战后先返回初始位置；跟随恢复跟随玩家。 */
  behavior?: 'static' | 'guard' | 'random' | 'route' | 'approach' | 'follow'
  /** 随机移动半径、接近行为的玩家触发半径，或跟随行为的保持距离，单位为格。 */
  behaviorRange?: number
  /** 随机移动重新选点、或路线完成一圈后的等待时间，单位为秒。 */
  behaviorInterval?: number
  /** 行为移动速度占单位模板最大速度的百分比。 */
  behaviorSpeedPercent?: number
  route?: { x: number; y: number }[]
  events?: LevelUnitEvent[]
}
export type LevelMode = 'defend' | 'advance'
export const TRIGGER_ENEMY_KINDS: EnemyKind[] = ['walker', 'runner', 'rusher', 'brute', 'flyer']
export type LevelUnitCounts = Record<string, number>

export interface LevelBossPhase {
  hpPercent: number
  actions: LevelEventAction[]
}

export interface LevelBossSpec {
  kind: EnemyKind
  /** 统一单位库引用；kind 仅作为旧存档和几何回退。 */
  unitDefId?: string
  name: string
  hpScale: number
  sizeScale: number
  phases: LevelBossPhase[]
  defeatActions: LevelEventAction[]
}

export type LevelUnitSelector =
  | { scope: 'source' }
  | { scope: 'placement'; placementId: number }
  | { scope: 'group'; group: string }
  | { scope: 'unitDef'; unitDefId: string }
  | { scope: 'allEnemies' }
  | { scope: 'allAllies' }

export type LevelUnitAttackTarget =
  | { type: 'player' }
  | { type: 'unit'; placementId: number }
  | { type: 'object'; objectId: number }
  | { type: 'sourceObject' }
  /** 旧关卡兼容；新版编辑器不再创建“最近敌对”目标。 */
  | 'nearestHostile'

export type LevelPlacedUnitBehavior = NonNullable<LevelUnitPlacement['behavior']>

export type LevelUnitCommand =
  | { kind: 'move'; x: number; y: number; speed: number; wait: boolean }
  | { kind: 'altitude'; altitude: number; wait: boolean }
  | { kind: 'hold'; seconds: number; wait: boolean }
  | { kind: 'attack'; target: LevelUnitAttackTarget; seconds: number; wait: boolean }
  | { kind: 'ai'; mode: 'pause' | 'restore' | 'replace'; preferredTarget?: string; positioning?: string; movement?: string }
  | { kind: 'behavior'; behavior: LevelPlacedUnitBehavior | 'restore'; range: number; interval: number; speedPercent: number }
  | { kind: 'faction'; faction: LevelPlacedUnitFaction }
  | { kind: 'remove' }

/** 通用关卡动作：区域、交互物与 Boss 阶段共同复用同一顺序执行语义。 */
export type LevelEventAction =
  | { type: 'wait'; seconds: number }
  | { type: 'spawn'; enemies: Record<EnemyKind, number>; units?: LevelUnitCounts; interval: number }
  | { type: 'boss'; boss: LevelBossSpec }
  | { type: 'message'; text: string; duration: number }
  | { type: 'dialogue'; speaker: string; text: string; duration: number; wait: boolean }
  | { type: 'text'; text: string; duration: number; position: 'top' | 'center' | 'bottom'; wait: boolean }
  | { type: 'camera'; x: number; y: number; duration: number; hold: number; wait: boolean; returnToOrigin: boolean }
  | { type: 'choice'; prompt: string; options: Array<{ text: string; actions: LevelEventAction[] }> }
  | { type: 'assembly' }
  | { type: 'sound'; presetId: string }
  | { type: 'music'; assetId: string; mode: 'override' | 'restore' }
  | { type: 'reward'; gold: number }
  | { type: 'levelVariable'; operation: 'set' | 'add'; variableId: string; value: number }
  | { type: 'globalVariable'; operation: 'set' | 'add'; variableId: string; value: number }
  | { type: 'setEventEnabled'; eventId: number; enabled: boolean }
  | { type: 'callEvent'; eventId: number }
  | { type: 'setObjectState'; objectId: number | 'source'; state: string }
  | { type: 'supply'; gold: number; ammo: number; energy: number }
  | {
    type: 'functionalArea'
    ammoEnabled: boolean
    ammoPerSec: number
    energyEnabled: boolean
    energyPerSec: number
    repairEnabled: boolean
    structurePerSec: number
    armorPerSec: number
    assemblyEnabled: boolean
  }
  | { type: 'stageJump'; stageId: string }
  | { type: 'taskResult'; target: 'primary' | 'secondary1' | 'secondary2'; state: 'complete' | 'failed' }
  | { type: 'unit'; selector: LevelUnitSelector; command: LevelUnitCommand }

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
  units?: LevelUnitCounts
  actions: LevelEventAction[]
}

export interface LevelWaveEntry {
  id: string
  unitDefId: string
  count: number
  /** 本编队开始前额外等待。 */
  delay: number
  /** 本编队单位之间的出场间隔。 */
  interval: number
  /** 省略时，每个单位从当前阶段的出生区域中随机选择。 */
  spawnRegionId?: number
}

export interface LevelWave {
  id: string
  name: string
  /** 本波生成敌人的攻击伤害倍率；1 为正常伤害。 */
  enemyDamageMultiplier: number
  entries: LevelWaveEntry[]
}

/** v17 及更早关卡使用的边缘出生方向，仅用于旧数据迁移。 */
export type LevelSpawnDirection = 'top' | 'right' | 'bottom' | 'left'

/** 防守阶段可自由绘制的敌人出生区域；id 是阶段内稳定编号。 */
export interface LevelSpawnRegion {
  id: number
  cells: string[]
}

export interface LevelPoint {
  x: number
  y: number
}

export type LevelStageTransition =
  | { type: 'stage'; stageId: string }
  | { type: 'win' }
  | { type: 'lose' }

/** 关卡目标：每个任务阶段拥有自己的目标与参数。 */
export type LevelObjective =
  | { type: 'defend'; waves: number; waveWait?: boolean; restTime?: number; overlapTime?: number; spawnRegions: LevelSpawnRegion[]; /** @deprecated 仅供并行迁移期间读取旧关卡。 */ spawnDirections?: LevelSpawnDirection[]; protectTarget?: 'fortress' | 'core' | { type: 'object'; objectIds: number[] } | { type: 'unit'; unitPlacementId: number } }
  | {
    type: 'fortressDefense'
    waves: number
    waveWait?: boolean
    restTime?: number
    overlapTime?: number
    spawnRegions: LevelSpawnRegion[]
    /** @deprecated 仅供并行迁移期间读取旧关卡。 */
    spawnDirections?: LevelSpawnDirection[]
    /** 临时接管的堡垒单位模板；为空时沿用玩家当前载具。 */
    fortressDefId: string
    /** 堡垒几何中心；由关卡任务页设置。 */
    fortressPoint: LevelPoint
    /** 阶段结束后玩家载具恢复的几何中心。 */
    returnPoint: LevelPoint
  }
  | { type: 'survive'; duration: number }
  | { type: 'reach'; finishCells?: string[]; /** 旧关卡矩形终点兼容字段。 */ finishZone?: LevelZone }
  | { type: 'escort'; unitPlacementId: number }
  | { type: 'destroy'; unitPlacementIds: number[] }

export interface LevelTaskStage {
  id: string
  name: string
  objective: LevelObjective
  /** 仅防守阶段使用；顺序即波次顺序。 */
  waves: LevelWave[]
  success: LevelStageTransition
  failure: LevelStageTransition
}

export interface LevelConfig {
  version: number // 配置版本：18 起防守阶段使用编号出生区域
  bgm?: string // 关卡背景音乐素材引用或路径
  /** 本场战斗允许装备的炮塔与模块装配分总上限。 */
  assemblyPointLimit: number
  mode: LevelMode // defend=现有波次防守；advance=直接交战并向终点推进
  rows: number // 战场纵深（格，下限 12；默认 72 = 1800m（v1.75：18→72）；旧存档保留原值）
  cols: number // 战场宽度（格，12–36；默认 18 = 450m；旧存档无此字段 → 取 COLS 默认）
  buildCells: string[] // 基地格格集合 "x,y"（场景编辑器铺设）
  groundCells: string[] // 战场地面层格集合 "x,y"（纯视觉，不影响逻辑；RMXP Autotile）
  baseTiles: LevelTileCell[] // v17：底图层，独立图块/Autotile 共用单格协议
  overlayTiles: LevelTileCell[] // v17：装饰层，旧 groundCells 自动迁移到这里
  core: { x: number; y: number } | null // 核心位置（尺寸沿用 CORE.w/h）；null = 已删除（不判负）
  buildings: LevelBuilding[] // 固有建筑
  terrain: LevelTerrain[]
  objects: LevelObject[]
  initialTurrets: LevelTurret[] // 开局免费炮塔
  initialUnits: LevelUnitPlacement[] // 开局友军与中立单位（几何中心坐标）
  initialWalls: LevelWall[] // 开局墙体（单格墙段，hp = WALL_HP；默认含原模板墙全部格位）
  objective: LevelObjective // 胜利条件；缺省为守住既有 6 波
  /** 任务流程：阶段可按成功/失败结果连接到下一阶段或最终结局。 */
  stages: LevelTaskStage[]
  startStageId: string
  startZone: LevelZone // 玩家堡垒出生区域（堡垒在区域内居中并钳制到地图）
  finishZone: LevelZone // 推进模式终点区域（堡垒中心进入即完成 reach）
  triggers: LevelRegionTrigger[] // 堡垒进入矩形区域时按编队生成伏击敌人
  interactables: LevelInteractable[] // 可进入激活的检查点/补给/闸门/任务目标
  variables: LevelVariableDef[]
  events: UnifiedLevelEvent[]
}

export interface LevelLibraryEntry {
  id: string
  name: string
  level: LevelConfig
  nextId?: string | null
  reward?: number
  /** 首次完成本关时永久解锁的装备；重复通关不会重复发放。 */
  unlockRewards?: EquipmentUnlockRef[]
  /** 进关前任务简报；旧关卡缺失时由 missionBriefingOf 自动补默认内容。 */
  briefing?: LevelMissionBriefing
  /** 本关允许选择的玩家载具 ID；缺省表示允许当前载具库中的全部载具。 */
  deployableFortressIds?: string[]
}

/** 每关最多提供三个备选出战车辆；旧关卡未配置时使用当前车辆库的前三项。 */
export const MAX_DEPLOYABLE_FORTRESSES = 3
export function deployableFortressIdsOf(entry: Pick<LevelLibraryEntry, 'deployableFortressIds'> | undefined, availableIds: readonly string[]): string[] {
  const available = new Set(availableIds)
  const configured = entry?.deployableFortressIds
    ? Array.from(new Set(entry.deployableFortressIds.filter(id => available.has(id))))
    : []
  return (configured.length > 0 ? configured : availableIds).slice(0, MAX_DEPLOYABLE_FORTRESSES)
}

export type EquipmentKind = 'fortress' | 'turret' | 'module' | 'paint' | 'emblem'
export interface EquipmentUnlockRef {
  kind: EquipmentKind
  id: string
}

export interface AchievementShopItem {
  /** 商品自身稳定 ID，用于解锁来源追踪；不可随显示名称变化。 */
  id: string
  name: string
  description: string
  medalCost: number
  reward: EquipmentUnlockRef
}

/**
 * #27 成就商店首批商品目录。
 * 目录只负责永久解锁，不替代战斗中的资源造价；同一装备仍可由关卡奖励提前解锁。
 */
export const ACHIEVEMENT_SHOP_ITEMS: readonly AchievementShopItem[] = [
  { id: 'shop:hunter', name: '猎手制导导弹', description: '解锁可追踪空地目标的猎手导弹炮塔。', medalCost: 2, reward: { kind: 'turret', id: 'hunter' } },
  { id: 'shop:beam', name: '磁轨光束塔', description: '解锁持续输出的磁轨光束炮塔。', medalCost: 3, reward: { kind: 'turret', id: 'beam' } },
  { id: 'shop:spray', name: '烈焰喷射塔', description: '解锁近距离扇形持续灼烧炮塔。', medalCost: 2, reward: { kind: 'turret', id: 'spray' } },
  { id: 'shop:shield-amplifier', name: '护盾增效器', description: '解锁提高护盾回复速度的内部模块。', medalCost: 1, reward: { kind: 'module', id: 'shield_amplifier' } },
  { id: 'shop:tank-factory', name: '坦克制造模块', description: '解锁可持续生产友方坦克的内部模块。', medalCost: 2, reward: { kind: 'module', id: 'tank_factory' } },
  { id: 'shop:airfield', name: '无人机模块', description: '解锁可持续生产空中友军的内部模块。', medalCost: 3, reward: { kind: 'module', id: 'airfield' } },
]

const ACHIEVEMENT_SHOP_LOCKED_EQUIPMENT_IDS = new Set(ACHIEVEMENT_SHOP_ITEMS.map(item => `${item.reward.kind}:${item.reward.id}`))

export type EquipmentUnlockSource = 'level' | 'shop' | 'starter'
export interface EquipmentUnlockRecord {
  equipmentId: string
  source: EquipmentUnlockSource
  sourceId?: string
}

export interface LevelMissionBriefing {
  /** 任务情报图：支持 public 路径、素材库引用解析后的路径或 data URL。 */
  image?: string
  introduction: string
  primaryObjective: string
  secondaryObjectives: [string, string]
}

export interface LevelLibrary {
  version: 1
  activeId: string
  /** 所有关卡共用的变量定义；当前值存放在玩家进度存档中。 */
  globalVariables: LevelVariableDef[]
  levels: LevelLibraryEntry[]
}

function objectiveBriefingText(objective: LevelObjective): string {
  if (objective.type === 'survive') return `坚持生存 ${objective.duration} 秒`
  if (objective.type === 'reach') return '抵达任务终点'
  if (objective.type === 'escort') return '护送指定单位抵达终点'
  if (objective.type === 'destroy') return '摧毁全部指定目标'
  if (objective.type === 'fortressDefense') return `接管堡垒并抵挡全部 ${objective.waves} 波进攻`
  if (objective.protectTarget === 'core') return '守住核心建筑'
  if (typeof objective.protectTarget === 'object') return objective.protectTarget.type === 'object' ? '保护指定物体' : '保护指定单位'
  return `抵挡全部 ${objective.waves} 波进攻`
}

export function defaultMissionBriefing(level: LevelConfig): LevelMissionBriefing {
  const start = level.stages.find(stage => stage.id === level.startStageId) ?? level.stages[0]
  return {
    image: 'builtin:mission/briefing_default',
    introduction: '敌军正在向防线推进。坚守阵地，并确保主要任务目标顺利完成。',
    primaryObjective: objectiveBriefingText(start?.objective ?? level.objective),
    secondaryObjectives: ['结构值保持在 50% 以上', '摧毁全部敌方载具'],
  }
}

/** 对旧存档、手改数据和编辑中间态提供稳定的三目标任务简报。 */
export function missionBriefingOf(entry: Pick<LevelLibraryEntry, 'level' | 'briefing'>): LevelMissionBriefing {
  const fallback = defaultMissionBriefing(entry.level)
  const raw = entry.briefing
  const secondary = Array.isArray(raw?.secondaryObjectives) ? raw.secondaryObjectives : fallback.secondaryObjectives
  return {
    image: typeof raw?.image === 'string' && raw.image.trim()
      ? (raw.image.trim() === '/res/mission/briefing_default.svg' ? 'builtin:mission/briefing_default' : raw.image.trim())
      : fallback.image,
    introduction: typeof raw?.introduction === 'string' && raw.introduction.trim() ? raw.introduction.trim().slice(0, 500) : fallback.introduction,
    primaryObjective: typeof raw?.primaryObjective === 'string' && raw.primaryObjective.trim() ? raw.primaryObjective.trim().slice(0, 120) : fallback.primaryObjective,
    secondaryObjectives: [
      typeof secondary[0] === 'string' && secondary[0].trim() ? secondary[0].trim().slice(0, 120) : fallback.secondaryObjectives[0],
      typeof secondary[1] === 'string' && secondary[1].trim() ? secondary[1].trim().slice(0, 120) : fallback.secondaryObjectives[1],
    ],
  }
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

/** 将旧版边缘方向转换成一格宽的编号出生区域；角格只归属于一个区域。 */
export function defaultSpawnRegions(rows: number, cols: number, directions: LevelSpawnDirection[] = ['top']): LevelSpawnRegion[] {
  const claimed = new Set<string>()
  return directions.map((direction, index) => {
    const candidates: string[] = []
    if (direction === 'top' || direction === 'bottom') {
      const y = direction === 'top' ? 0 : rows - 1
      for (let x = 0; x < cols; x++) candidates.push(`${x},${y}`)
    } else {
      const x = direction === 'left' ? 0 : cols - 1
      for (let y = 0; y < rows; y++) candidates.push(`${x},${y}`)
    }
    const cells = candidates.filter(key => !claimed.has(key))
    cells.forEach(key => claimed.add(key))
    return { id: index + 1, cells }
  }).filter(region => region.cells.length > 0)
}

function normalizeSpawnRegions(value: unknown, rows: number, cols: number, legacyDirections: LevelSpawnDirection[]): LevelSpawnRegion[] {
  if (!Array.isArray(value)) return defaultSpawnRegions(rows, cols, legacyDirections)
  const regions: LevelSpawnRegion[] = []
  const used = new Set<number>()
  const claimed = new Set<string>()
  for (const item of value.slice(0, 99)) {
    const raw = item as Partial<LevelSpawnRegion> | null
    let id = Math.max(1, Math.min(999, Math.round(Number(raw?.id) || regions.length + 1)))
    while (used.has(id)) id++
    used.add(id)
    const cells = normalizeRegionCells(raw?.cells, rows, cols).filter(key => !claimed.has(key))
    cells.forEach(key => claimed.add(key))
    regions.push({ id, cells })
  }
  return regions
}

/** 旧存档/手改 JSON 的目标归一化，确保运行时只接收有限且有界的数值。 */
export function normalizeObjective(value: unknown, mode: LevelMode = 'defend', rows: number = ROWS, cols: number = COLS): LevelObjective {
  const o = value as Partial<LevelObjective> | null
  if (o?.type === 'escort') return { type: 'escort', unitPlacementId: Math.max(1, Math.round(Number((o as { unitPlacementId?: unknown }).unitPlacementId) || 1)) }
  if (o?.type === 'destroy') {
    const rawIds = (o as { unitPlacementIds?: unknown }).unitPlacementIds
    const ids = Array.isArray(rawIds)
      ? [...new Set(rawIds.map(Number).filter(Number.isFinite).map(id => Math.max(1, Math.round(id))))].slice(0, 100)
      : []
    return { type: 'destroy', unitPlacementIds: ids }
  }
  if (mode === 'advance' || o?.type === 'reach') {
    const reach = o as { finishCells?: unknown; finishZone?: Partial<LevelZone> } | null
    if (Array.isArray(reach?.finishCells)) {
      const finishCells = [...new Set(reach.finishCells.slice(0, 20_000).map(String).filter(key => /^-?\d+,-?\d+$/.test(key)))]
      return { type: 'reach', finishCells }
    }
    const zone = reach?.finishZone
    return zone ? { type: 'reach', finishCells: regionCellsFromRect(Number(zone.x) || 0, Number(zone.y) || 0, Math.max(1, Number(zone.w) || 1), Math.max(1, Number(zone.h) || 1)) } : { type: 'reach' }
  }
  if (o?.type === 'survive') {
    const raw = Number((o as { duration?: unknown }).duration)
    return {
      type: 'survive',
      duration: Math.max(SURVIVE_SECONDS_MIN, Math.min(SURVIVE_SECONDS_MAX, Number.isFinite(raw) ? Math.round(raw) : 180)),
    }
  }
  const raw = Number((o as { waves?: unknown } | null)?.waves)
  const defend = o as { waveWait?: unknown; restTime?: unknown; overlapTime?: unknown; protectTarget?: unknown; spawnDirections?: unknown; spawnRegions?: unknown; fortressDefId?: unknown; fortressPoint?: unknown; returnPoint?: unknown } | null
  const restRaw = Number(defend?.restTime)
  const overlapRaw = Number(defend?.overlapTime)
  const rawProtectTarget = defend?.protectTarget
  const rawSpawnDirections = defend?.spawnDirections
  const hasSpawnDirections = Array.isArray(rawSpawnDirections)
  const spawnDirections: LevelSpawnDirection[] = hasSpawnDirections
    ? [...new Set(rawSpawnDirections.filter((item: unknown): item is LevelSpawnDirection => item === 'top' || item === 'right' || item === 'bottom' || item === 'left'))]
    : ['top' as const]
  const legacyDirections = o?.type === 'fortressDefense' && !hasSpawnDirections ? ['top', 'right', 'bottom', 'left'] as LevelSpawnDirection[] : spawnDirections
  const spawnRegions = normalizeSpawnRegions(defend?.spawnRegions, rows, cols, legacyDirections)
  const point = (input: unknown, fallback: LevelPoint): LevelPoint => {
    const rawPoint = input as Partial<LevelPoint> | null
    const x = Number(rawPoint?.x), y = Number(rawPoint?.y)
    return { x: Number.isFinite(x) ? x : fallback.x, y: Number.isFinite(y) ? y : fallback.y }
  }
  const waveBase = {
    waves: Math.max(OBJECTIVE_WAVES_MIN, Math.min(OBJECTIVE_WAVES_MAX, Number.isFinite(raw) ? Math.round(raw) : 6)),
    waveWait: typeof defend?.waveWait === 'boolean' ? defend.waveWait : true,
    restTime: Math.max(0, Math.min(DEFEND_TIME_MAX, Number.isFinite(restRaw) ? restRaw : DEFEND_REST_TIME_DEFAULT)),
    overlapTime: Math.max(0, Math.min(DEFEND_TIME_MAX, Number.isFinite(overlapRaw) ? overlapRaw : DEFEND_OVERLAP_TIME_DEFAULT)),
    spawnRegions,
  }
  if (o?.type === 'fortressDefense') return {
    type: 'fortressDefense',
    ...waveBase,
    fortressDefId: typeof defend?.fortressDefId === 'string' ? defend.fortressDefId.slice(0, 120) : '',
    fortressPoint: point(defend?.fortressPoint, { x: 10, y: 10 }),
    returnPoint: point(defend?.returnPoint, { x: 10, y: 10 }),
  }
  const protectTarget = rawProtectTarget && typeof rawProtectTarget === 'object'
    ? (rawProtectTarget as { type?: unknown }).type === 'object'
      ? { type: 'object' as const, objectIds: [...new Set((Array.isArray((rawProtectTarget as { objectIds?: unknown }).objectIds) ? (rawProtectTarget as { objectIds: unknown[] }).objectIds : [(rawProtectTarget as { objectId?: unknown }).objectId]).map(value => Math.max(1, Math.round(Number(value) || 1))))] }
      : (rawProtectTarget as { type?: unknown }).type === 'unit'
        ? { type: 'unit' as const, unitPlacementId: Math.max(1, Math.round(Number((rawProtectTarget as { unitPlacementId?: unknown }).unitPlacementId) || 1)) }
        : undefined
    : rawProtectTarget === 'core' ? 'core' as const : rawProtectTarget === 'fortress' ? 'fortress' as const : undefined
  return {
    type: 'defend',
    ...waveBase,
    protectTarget,
  }
}

function defaultWave(index: number): LevelWave {
  return {
    id: `wave-${index + 1}`,
    name: `第 ${index + 1} 波`,
    enemyDamageMultiplier: 1,
    entries: [],
  }
}

function isRemovedOrganicUnitId(id: string): boolean {
  return id === 'unit:infantry' || id === 'unit:creature'
    || ['enemy:walker', 'enemy:runner', 'enemy:rusher', 'enemy:brute', 'ally:soldier'].includes(id)
}

export function defaultStage(objective: LevelObjective = { type: 'defend', waves: 6, waveWait: true, restTime: DEFEND_REST_TIME_DEFAULT, overlapTime: DEFEND_OVERLAP_TIME_DEFAULT, spawnRegions: defaultSpawnRegions(ROWS, COLS), protectTarget: 'fortress' }): LevelTaskStage {
  const waves = objective.type === 'defend' || objective.type === 'fortressDefense' ? Array.from({ length: objective.waves }, (_, i) => defaultWave(i)) : []
  return { id: 'stage-1', name: objective.type === 'fortressDefense' ? '堡垒防御阶段' : objective.type === 'defend' ? '防守阶段' : objective.type === 'reach' ? '推进阶段' : objective.type === 'escort' ? '护送阶段' : objective.type === 'destroy' ? '歼灭阶段' : '生存阶段', objective: structuredClone(objective), waves, success: { type: 'win' }, failure: { type: 'lose' } }
}

function normalizeTransition(value: unknown): LevelStageTransition {
  const raw = value as Partial<LevelStageTransition> | null
  if (raw?.type === 'stage' && typeof (raw as { stageId?: unknown }).stageId === 'string') return { type: 'stage', stageId: String((raw as { stageId: string }).stageId).slice(0, 64) }
  return raw?.type === 'win' ? { type: 'win' } : { type: 'lose' }
}

function normalizeWaves(value: unknown, count: number): LevelWave[] {
  if (!Array.isArray(value)) return Array.from({ length: count }, (_, i) => defaultWave(i))
  const waves: LevelWave[] = []
  for (let wi = 0; wi < Math.min(99, value.length); wi++) {
    const raw = value[wi] as Partial<LevelWave>
    const entries: LevelWaveEntry[] = []
    if (Array.isArray(raw.entries)) for (let ei = 0; ei < Math.min(40, raw.entries.length); ei++) {
      const entry = raw.entries[ei] as Partial<LevelWaveEntry>
      const unitDefId = typeof entry.unitDefId === 'string' ? entry.unitDefId.trim().slice(0, 120) : ''
      if (!unitDefId || isRemovedOrganicUnitId(unitDefId)) continue
      entries.push({
        id: typeof entry.id === 'string' && entry.id.trim() ? entry.id.slice(0, 64) : `entry-${wi + 1}-${ei + 1}`,
        unitDefId,
        count: Math.max(1, Math.min(999, Math.round(Number(entry.count) || 1))),
        delay: Math.max(0, Math.min(3600, Number(entry.delay) || 0)),
        interval: Math.max(0, Math.min(60, Number(entry.interval) || 0)),
        ...(Number.isFinite(Number(entry.spawnRegionId)) && Number(entry.spawnRegionId) > 0 ? { spawnRegionId: Math.round(Number(entry.spawnRegionId)) } : {}),
      })
    }
    const damageMultiplier = Number(raw.enemyDamageMultiplier)
    waves.push({
      id: typeof raw.id === 'string' && raw.id.trim() ? raw.id.slice(0, 64) : `wave-${wi + 1}`,
      name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.slice(0, 40) : `第 ${wi + 1} 波`,
      enemyDamageMultiplier: Number.isFinite(damageMultiplier) ? Math.max(0, Math.min(100, damageMultiplier)) : 1,
      entries,
    })
  }
  while (waves.length < count) waves.push(defaultWave(waves.length))
  return waves.slice(0, count)
}

export function normalizeStages(value: unknown, legacyObjective: LevelObjective, rows: number = ROWS, cols: number = COLS): LevelTaskStage[] {
  if (!Array.isArray(value) || value.length === 0) return [defaultStage(legacyObjective)]
  const stages: LevelTaskStage[] = []
  const used = new Set<string>()
  for (let i = 0; i < Math.min(50, value.length); i++) {
    const raw = value[i] as Partial<LevelTaskStage>
    let id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim().slice(0, 64) : `stage-${i + 1}`
    while (used.has(id)) id = `${id}-${i + 1}`
    used.add(id)
    const objective = normalizeObjective(raw.objective, (raw.objective as { type?: unknown } | undefined)?.type === 'reach' ? 'advance' : 'defend', rows, cols)
    const waves = objective.type === 'defend' || objective.type === 'fortressDefense' ? normalizeWaves(raw.waves, objective.waves) : []
    stages.push({ id, name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.slice(0, 40) : `任务阶段 ${i + 1}`, objective, waves, success: normalizeTransition(raw.success), failure: normalizeTransition(raw.failure) })
  }
  const ids = new Set(stages.map(stage => stage.id))
  for (const stage of stages) {
    if (stage.success.type === 'stage' && !ids.has(stage.success.stageId)) stage.success = { type: 'win' }
    if (stage.failure.type === 'stage' && !ids.has(stage.failure.stageId)) stage.failure = { type: 'lose' }
  }
  return stages
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

/** 抵达任务的实际终点格。新数据使用格集合，旧矩形与全局终点仅作兼容回退。 */
export function objectiveFinishCells(objective: Extract<LevelObjective, { type: 'reach' }>, fallback: LevelZone, rows: number, cols: number): string[] {
  if (Array.isArray(objective.finishCells)) return normalizeRegionCells(objective.finishCells, rows, cols)
  const zone = objective.finishZone ?? fallback
  return normalizeRegionCells(regionCellsFromRect(zone.x, zone.y, zone.w, zone.h), rows, cols)
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

/** 旧 enemies 枚举映射为稳定单位 ID；新自定义 ID 原样保留。 */
export function legacyEnemyUnitCounts(enemies: Record<EnemyKind, number>): LevelUnitCounts {
  const flyers = Math.max(0, Math.min(99, Math.round(enemies.flyer || 0)))
  return flyers > 0 ? { 'enemy:flyer': flyers } : {}
}

function normalizeUnitCounts(value: unknown, enemies: Record<EnemyKind, number>): LevelUnitCounts {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
  if (!raw) return legacyEnemyUnitCounts(enemies)
  const units: LevelUnitCounts = {}
  for (const [id, value0] of Object.entries(raw).slice(0, 100)) {
    if (!id.trim()) continue
    const n = Number(value0)
    const count = Math.max(0, Math.min(99, Number.isFinite(n) ? Math.round(n) : 0))
    if (count > 0) {
      const migratedId = id.slice(0, 120)
      if (isRemovedOrganicUnitId(migratedId)) continue
      units[migratedId] = Math.min(99, (units[migratedId] ?? 0) + count)
    }
  }
  return units
}

export function levelSpawnUnitCounts(value: { enemies: Record<EnemyKind, number>; units?: LevelUnitCounts }): LevelUnitCounts {
  return value.units ?? legacyEnemyUnitCounts(value.enemies)
}

export function normalizeEventActions(value: unknown, depth = 0): LevelEventAction[] {
  if (!Array.isArray(value) || depth > 2) return []
  const out: LevelEventAction[] = []
  for (const raw0 of value.slice(0, 40)) {
    const raw = raw0 as Record<string, unknown>
    if (raw.type === 'wait') out.push({ type: 'wait', seconds: Math.max(0, Math.min(300, Number(raw.seconds) || 0)) })
    else if (raw.type === 'spawn') {
      const enemies = normalizeEnemies(raw.enemies)
      out.push({ type: 'spawn', enemies, units: normalizeUnitCounts(raw.units, enemies), interval: Math.max(0, Math.min(60, Number(raw.interval) || 0)) })
    }
    else if (raw.type === 'message') out.push({ type: 'message', text: String(raw.text ?? '').slice(0, 120), duration: Math.max(0.5, Math.min(15, Number(raw.duration) || 3)) })
    else if (raw.type === 'dialogue') out.push({
      type: 'dialogue', speaker: String(raw.speaker ?? '').slice(0, 40), text: String(raw.text ?? '').slice(0, 500),
      duration: Math.max(0.5, Math.min(60, Number(raw.duration) || 3)), wait: raw.wait !== false,
    })
    else if (raw.type === 'text') out.push({
      type: 'text', text: String(raw.text ?? '').slice(0, 500), duration: Math.max(0.5, Math.min(60, Number(raw.duration) || 3)),
      position: raw.position === 'top' || raw.position === 'bottom' ? raw.position : 'center', wait: raw.wait !== false,
    })
    else if (raw.type === 'camera') out.push({
      type: 'camera', x: Math.max(0, Math.min(200, Number(raw.x) || 0)), y: Math.max(0, Math.min(500, Number(raw.y) || 0)),
      duration: Math.max(0, Math.min(30, Number(raw.duration) || 0)), hold: Math.max(0, Math.min(60, Number(raw.hold) || 0)), wait: raw.wait !== false,
      returnToOrigin: raw.returnToOrigin === true,
    })
    else if (raw.type === 'choice') {
      const options = Array.isArray(raw.options) ? raw.options.slice(0, 8).map(option0 => {
        const option = option0 as Record<string, unknown>
        return { text: String(option.text ?? '选项').slice(0, 80), actions: normalizeEventActions(option.actions, depth + 1) }
      }) : []
      out.push({ type: 'choice', prompt: String(raw.prompt ?? '请选择').slice(0, 160), options: options.length > 0 ? options : [{ text: '继续', actions: [] }] })
    }
    else if (raw.type === 'assembly') out.push({ type: 'assembly' })
    else if (raw.type === 'sound') out.push({ type: 'sound', presetId: String(raw.presetId ?? '').slice(0, 120) })
    else if (raw.type === 'music') out.push({ type: 'music', assetId: String(raw.assetId ?? '').slice(0, 120), mode: raw.mode === 'restore' ? 'restore' : 'override' })
    else if (raw.type === 'reward') out.push({ type: 'reward', gold: Math.max(0, Math.min(99999, Math.round(Number(raw.gold) || 0))) })
    else if (raw.type === 'levelVariable' || raw.type === 'setVariable' || raw.type === 'addVariable') out.push({ type: 'levelVariable', operation: raw.type === 'addVariable' || raw.operation === 'add' ? 'add' : 'set', variableId: String(raw.variableId ?? '').slice(0, 80), value: typeof raw.value === 'boolean' ? (raw.value ? 1 : 0) : Number(raw.value) || 0 })
    else if (raw.type === 'globalVariable' || raw.type === 'setGlobalVariable' || raw.type === 'addGlobalVariable') out.push({ type: 'globalVariable', operation: raw.type === 'addGlobalVariable' || raw.operation === 'add' ? 'add' : 'set', variableId: String(raw.variableId ?? '').slice(0, 80), value: typeof raw.value === 'boolean' ? (raw.value ? 1 : 0) : Number(raw.value) || 0 })
    else if (raw.type === 'setEventEnabled') out.push({ type: 'setEventEnabled', eventId: Math.max(1, Math.round(Number(raw.eventId) || 1)), enabled: raw.enabled !== false })
    else if (raw.type === 'callEvent') out.push({ type: 'callEvent', eventId: Math.max(1, Math.round(Number(raw.eventId) || 1)) })
    else if (raw.type === 'setObjectState') out.push({ type: 'setObjectState', objectId: raw.objectId === 'source' ? 'source' : Math.max(1, Math.round(Number(raw.objectId) || 1)), state: String(raw.state ?? 'default').slice(0, 80) })
    else if (raw.type === 'supply') out.push({ type: 'supply', gold: Math.max(-99999, Math.min(99999, Math.round(Number(raw.gold) || 0))), ammo: Math.max(-99999, Math.min(99999, Number(raw.ammo) || 0)), energy: Math.max(-99999, Math.min(99999, Number(raw.energy) || 0)) })
    else if (raw.type === 'functionalArea' || raw.type === 'supplyZone') out.push({
      type: 'functionalArea',
      ammoEnabled: raw.ammoEnabled !== false,
      ammoPerSec: Math.max(0, Math.min(1000, Number(raw.ammoPerSec) || 0)),
      energyEnabled: raw.energyEnabled !== false,
      energyPerSec: Math.max(0, Math.min(1000, Number(raw.energyPerSec) || 0)),
      repairEnabled: raw.repairEnabled === true,
      structurePerSec: Math.max(0, Math.min(1000, Number(raw.structurePerSec) || 0)),
      armorPerSec: Math.max(0, Math.min(1000, Number(raw.armorPerSec) || 0)),
      assemblyEnabled: raw.assemblyEnabled === true,
    })
    else if (raw.type === 'stageJump') out.push({ type: 'stageJump', stageId: String(raw.stageId ?? '').slice(0, 80) })
    else if (raw.type === 'taskResult') {
      const target = raw.target === 'secondary1' || raw.target === 'secondary2' ? raw.target : 'primary'
      out.push({ type: 'taskResult', target, state: target === 'primary' && raw.state === 'failed' ? 'failed' : 'complete' })
    }
    else if (raw.type === 'missionResult') out.push({ type: 'taskResult', target: 'primary', state: raw.result === 'lose' ? 'failed' : 'complete' })
    else if (raw.type === 'completeSecondary1') out.push({ type: 'taskResult', target: 'secondary1', state: 'complete' })
    else if (raw.type === 'completeSecondary2') out.push({ type: 'taskResult', target: 'secondary2', state: 'complete' })
    else if (raw.type === 'unit') {
      const selectorRaw = (raw.selector ?? {}) as Record<string, unknown>
      const scope = ['source', 'placement', 'group', 'unitDef', 'allEnemies', 'allAllies'].includes(String(selectorRaw.scope)) ? String(selectorRaw.scope) : 'source'
      const selector: LevelUnitSelector = scope === 'unitDef'
        ? { scope, unitDefId: String(selectorRaw.unitDefId ?? '').slice(0, 120) }
        : scope === 'group'
          ? { scope, group: String(selectorRaw.group ?? '').trim().slice(0, 40) }
        : scope === 'placement'
          ? { scope, placementId: Math.max(1, Math.round(Number(selectorRaw.placementId) || 1)) }
          : { scope: scope as 'source' | 'allEnemies' | 'allAllies' }
      const commandRaw = (raw.command ?? {}) as Record<string, unknown>
      const kind = String(commandRaw.kind)
      let command: LevelUnitCommand
      if (kind === 'altitude') command = { kind, altitude: Math.max(0, Math.min(10, Number(commandRaw.altitude) || 0)), wait: commandRaw.wait === true }
      else if (kind === 'hold') command = { kind, seconds: Math.max(0, Math.min(300, Number(commandRaw.seconds) || 0)), wait: commandRaw.wait === true }
      else if (kind === 'attack') {
        const targetRaw = commandRaw.target
        let target: LevelUnitAttackTarget
        if (targetRaw === 'nearestHostile') target = 'nearestHostile'
        else if (targetRaw === 'fortress' || targetRaw === 'coreBuilding') target = { type: 'player' }
        else if (targetRaw && typeof targetRaw === 'object') {
          const record = targetRaw as Record<string, unknown>
          target = record.type === 'sourceObject'
            ? { type: 'sourceObject' }
            : record.type === 'unit'
            ? { type: 'unit', placementId: Math.max(1, Math.round(Number(record.placementId) || 1)) }
            : record.type === 'object'
              ? { type: 'object', objectId: Math.max(1, Math.round(Number(record.objectId) || 1)) }
              : { type: 'player' }
        } else target = { type: 'player' }
        command = { kind, target, seconds: Math.max(0.1, Math.min(300, Number(commandRaw.seconds) || 5)), wait: commandRaw.wait === true }
      }
      else if (kind === 'ai') {
        const preferredTargets = ['playerControlled', 'playerFaction', 'allHostile']
        const positioningProfiles = ['longestRange', 'optimalRange', 'shortestRange']
        const movementProfiles = ['orbit', 'keepFar', 'closeIn', 'stop', 'ram']
        const legacyTargeting = String(commandRaw.targeting ?? '')
        const legacyMovement = String(commandRaw.movement ?? '')
        command = {
        kind, mode: ['pause', 'restore', 'replace'].includes(String(commandRaw.mode)) ? commandRaw.mode as 'pause' | 'restore' | 'replace' : 'restore',
        preferredTarget: preferredTargets.includes(String(commandRaw.preferredTarget))
          ? String(commandRaw.preferredTarget)
          : legacyTargeting ? legacyTargeting === 'fortress' ? 'playerControlled' : 'allHostile' : undefined,
        positioning: positioningProfiles.includes(String(commandRaw.positioning))
          ? String(commandRaw.positioning)
          : legacyMovement === 'rangeEdge' || legacyMovement === 'holdRange' ? 'longestRange'
            : legacyMovement === 'direct' || legacyMovement === 'flyDirect' ? 'shortestRange' : legacyMovement ? 'optimalRange' : undefined,
        movement: movementProfiles.includes(legacyMovement)
          ? legacyMovement
          : legacyMovement === 'rangeEdge' ? 'orbit'
            : legacyMovement === 'direct' || legacyMovement === 'flyDirect' ? 'closeIn' : legacyMovement ? 'stop' : undefined,
        }
      }
      else if (kind === 'remove') command = { kind }
      else if (kind === 'behavior') command = {
        kind,
        behavior: ['static', 'guard', 'random', 'route', 'approach', 'follow', 'restore'].includes(String(commandRaw.behavior)) ? commandRaw.behavior as LevelPlacedUnitBehavior | 'restore' : 'restore',
        range: Math.max(0, Math.min(Math.max(ROWS, COLS), Number(commandRaw.range) || 0)),
        interval: Math.max(0, Math.min(3600, Number(commandRaw.interval) || 0)),
        speedPercent: Math.max(0, Math.min(100, Number(commandRaw.speedPercent) || 0)),
      }
      else if (kind === 'faction') command = {
        kind,
        faction: ['player', 'ally', 'neutral', 'neutralHostile', 'enemy'].includes(String(commandRaw.faction))
          ? commandRaw.faction as LevelPlacedUnitFaction
          : 'ally',
      }
      else command = {
        kind: 'move', x: Math.max(0, Math.min(200, Number(commandRaw.x) || 0)), y: Math.max(0, Math.min(500, Number(commandRaw.y) || 0)),
        speed: Math.max(0.05, Math.min(20, Number(commandRaw.speed) || 1)), wait: commandRaw.wait === true,
      }
      out.push({ type: 'unit', selector, command })
    }
    else if (raw.type === 'complete') out.push({ type: 'taskResult', target: 'primary', state: 'complete' })
    else if (raw.type === 'boss') {
      const b = (raw.boss ?? {}) as Record<string, unknown>
      const kind = TRIGGER_ENEMY_KINDS.includes(b.kind as EnemyKind) ? b.kind as EnemyKind : 'brute'
      const phases = Array.isArray(b.phases) ? b.phases.slice(0, 5).map(p0 => {
        const p = p0 as Record<string, unknown>
        return { hpPercent: Math.max(1, Math.min(99, Number(p.hpPercent) || 50)), actions: normalizeEventActions(p.actions, depth + 1) }
      }).sort((a, b2) => b2.hpPercent - a.hpPercent) : []
      out.push({ type: 'boss', boss: {
        kind, unitDefId: typeof b.unitDefId === 'string' && b.unitDefId.trim() && !isRemovedOrganicUnitId(b.unitDefId) ? b.unitDefId.slice(0, 120) : undefined,
        name: String(b.name ?? '荒原巨兽').slice(0, 40),
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
    const units = normalizeUnitCounts(t.units, enemies)
    const legacyActions: LevelEventAction[] = [
      ...(Number(t.delay) > 0 ? [{ type: 'wait' as const, seconds: Number(t.delay) }] : []),
      { type: 'spawn', enemies, units, interval: Math.max(0, Math.min(60, Number(t.interval) || 0.35)) },
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
      units,
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

export function normalizeInitialUnits(value: unknown, rows: number, cols: number): LevelUnitPlacement[] {
  if (!Array.isArray(value)) return []
  const used = new Set<number>()
  const out: LevelUnitPlacement[] = []
  for (const [index, raw0] of value.slice(0, 200).entries()) {
    const raw = raw0 as Partial<LevelUnitPlacement>
    const rawUnitDefId = typeof raw.unitDefId === 'string' ? raw.unitDefId.trim().slice(0, 120) : ''
    const unitDefId = rawUnitDefId
    if (!unitDefId || isRemovedOrganicUnitId(unitDefId)) continue
    let id = Number.isFinite(raw.id) ? Math.max(1, Math.round(raw.id!)) : index + 1
    while (used.has(id)) id++
    used.add(id)
    const faction: LevelPlacedUnitFaction = ['player', 'ally', 'enemy', 'neutral', 'neutralHostile'].includes(String(raw.faction))
      ? raw.faction as LevelPlacedUnitFaction : 'ally'
    const rawController = (raw as Partial<LevelUnitPlacement>).controller
    const controller: LevelPlacedUnitController = ['player', 'ai', 'script', 'static'].includes(String(rawController))
      ? rawController as LevelPlacedUnitController : faction === 'neutral' ? 'static' : 'ai'
    const rawX = Number(raw.x)
    const rawY = Number(raw.y)
    const x = Math.max(0.5, Math.min(Math.max(0.5, cols - 0.5), Number.isFinite(rawX) ? rawX : cols / 2))
    const y = Math.max(0.5, Math.min(Math.max(0.5, rows - 0.5), Number.isFinite(rawY) ? rawY : rows / 2))
    const flipX = raw.flipX === true
    const rawRotation = Number(raw.rotation)
    const rotation = ([0, 90, 180, 270] as const).includes(rawRotation as 0 | 90 | 180 | 270)
      ? rawRotation as 0 | 90 | 180 | 270 : 0
    const renderLayer = 3 as const
    const group = typeof raw.group === 'string' ? raw.group.trim().slice(0, 40) || undefined : undefined
    const behavior = ['static', 'guard', 'random', 'route', 'approach', 'follow'].includes(String(raw.behavior)) ? raw.behavior as LevelUnitPlacement['behavior'] : controller === 'static' ? 'static' : 'approach'
    const rawBehaviorRange = Number(raw.behaviorRange)
    const rawBehaviorInterval = Number(raw.behaviorInterval)
    const behaviorRange = Math.max(0, Math.min(Math.max(rows, cols), Number.isFinite(rawBehaviorRange) ? rawBehaviorRange : (behavior === 'random' ? 6 : behavior === 'follow' ? 2 : 8)))
    const behaviorInterval = Math.max(0, Math.min(3600, Number.isFinite(rawBehaviorInterval) ? rawBehaviorInterval : (behavior === 'random' ? 3 : 1)))
    const rawSpeedPercent = Number(raw.behaviorSpeedPercent)
    const behaviorSpeedPercent = Math.max(0, Math.min(100, Number.isFinite(rawSpeedPercent) ? rawSpeedPercent : 100))
    const route = Array.isArray(raw.route) ? raw.route.slice(0, 100).map(point => ({
      x: Math.max(0.5, Math.min(Math.max(0.5, cols - 0.5), Number(point.x) || 0.5)),
      y: Math.max(0.5, Math.min(Math.max(0.5, rows - 0.5), Number(point.y) || 0.5)),
    })) : []
    const eventIds = new Set<number>()
    const events: LevelUnitEvent[] = Array.isArray(raw.events) ? raw.events.slice(0, 50).map((rawEvent, eventIndex) => {
      const source = (rawEvent ?? {}) as Partial<LevelUnitEvent>
      let eventId = Math.max(1, Math.round(Number(source.id) || eventIndex + 1))
      while (eventIds.has(eventId)) eventId++
      eventIds.add(eventId)
      const trigger: LevelUnitEventTrigger = ['interact', 'destroyed', 'contact'].includes(String(source.trigger)) ? source.trigger as LevelUnitEventTrigger : 'interact'
      return {
        id: eventId,
        name: String(source.name ?? `事件 ${eventId}`).slice(0, 80),
        trigger,
        activationLimit: Math.max(0, Math.round(Number(source.activationLimit) || 0)),
        cooldown: Math.max(0, Math.min(3600, Number(source.cooldown) || 0)),
        conditions: source.conditions ? normalizeConditionGroup(source.conditions) : emptyConditionGroup(),
        actions: normalizeEventActions(source.actions),
      }
    }) : []
    out.push({
      id, unitDefId, faction, controller, group, x, y, flipX, rotation,
      // vNext：实例锁定已并入单位模板 bodyLocked；旧字段不再继续保存，避免隐藏配置无法在编辑器中解除。
      lockMovement: undefined,
      lockRotation: undefined,
      renderLayer, behavior, behaviorRange, behaviorInterval, behaviorSpeedPercent, route, events,
    })
  }
  return out
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
  lv.baseTiles = lv.baseTiles.map(tile => ({ ...tile, y: tile.y + dy })).filter(tile => inY(tile.y))
  lv.overlayTiles = lv.overlayTiles.map(tile => ({ ...tile, y: tile.y + dy })).filter(tile => inY(tile.y))
  lv.initialWalls = lv.initialWalls.map(w => ({ x: w.x, y: w.y + dy })).filter(w => inY(w.y))
  lv.objects = lv.objects.map(o => ({ ...o, y: o.y + dy })).filter(o => o.y + o.h > 0 && o.y < rows)
  lv.terrain = lv.terrain.map(t => ({ ...t, y: t.y + dy })).filter(t => t.y + t.h > 0 && t.y < rows)
  lv.buildings = lv.buildings.map(b => ({ ...b, y: b.y + dy })).filter(b => b.y + b.h > 0 && b.y < rows)
  lv.initialTurrets = lv.initialTurrets.map(t => ({ ...t, y: t.y + dy })).filter(t => inY(t.y))
  lv.initialUnits = lv.initialUnits
    .map(u => ({ ...u, y: u.y + dy, route: (u.route ?? []).map(point => ({ ...point, y: point.y + dy })).filter(point => point.y >= 0.5 && point.y <= rows - 0.5) }))
    .filter(u => u.y >= 0.5 && u.y <= rows - 0.5)
  lv.triggers = lv.triggers
    .map(t => ({ ...t, y: t.y + dy }))
    .filter(t => t.y + t.h > 0 && t.y < rows)
    .map(t => ({ ...t, ...normalizeZone(t, t, rows, lv.cols) }))
  lv.interactables = lv.interactables
    .map(t => ({ ...t, y: t.y + dy }))
    .filter(t => t.y + t.h > 0 && t.y < rows)
    .map(t => ({ ...t, ...normalizeZone(t, t, rows, lv.cols) }))
  lv.events = lv.events.map(event => event.trigger.type === 'regionEnter' || event.trigger.type === 'regionLeave' || event.trigger.type === 'regionStay'
    ? { ...event, trigger: { ...event.trigger, cells: event.trigger.cells.map(key => { const [x, y] = key.split(',').map(Number); return `${x},${y + dy}` }).filter(key => { const [, y] = key.split(',').map(Number); return inY(y) }) } }
    : event)
  lv.startZone = normalizeZone({ ...lv.startZone, y: lv.startZone.y + dy }, defaultStartZone(rows, lv.cols), rows, lv.cols)
  for (const stage of lv.stages) if (stage.objective.type === 'reach') {
    const cells = objectiveFinishCells(stage.objective, lv.finishZone, lv.rows, lv.cols)
    stage.objective = { type: 'reach', finishCells: cells.map(key => { const [x, y] = key.split(',').map(Number); return `${x},${y + dy}` }).filter(key => { const [, y] = key.split(',').map(Number); return inY(y) }) }
  }
  for (const stage of lv.stages) if (stage.objective.type === 'defend' || stage.objective.type === 'fortressDefense') {
    stage.objective.spawnRegions = stage.objective.spawnRegions.map(region => ({ ...region, cells: region.cells.map(key => { const [x, y] = key.split(',').map(Number); return `${x},${y + dy}` }).filter(key => { const [, y] = key.split(',').map(Number); return inY(y) }) }))
  }
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
  lv.baseTiles = lv.baseTiles.filter(tile => inX(tile.x))
  lv.overlayTiles = lv.overlayTiles.filter(tile => inX(tile.x))
  lv.initialWalls = lv.initialWalls.filter(w => inX(w.x))
  lv.initialTurrets = lv.initialTurrets.filter(t => inX(t.x))
  lv.initialUnits = lv.initialUnits
    .map(u => ({ ...u, route: (u.route ?? []).filter(point => point.x >= 0.5 && point.x <= cols - 0.5) }))
    .filter(u => u.x >= 0.5 && u.x <= cols - 0.5)
  lv.triggers = lv.triggers
    .filter(t => t.x < cols && t.x + t.w > 0)
    .map(t => ({ ...t, ...normalizeZone(t, t, lv.rows, cols) }))
  lv.interactables = lv.interactables
    .filter(t => t.x < cols && t.x + t.w > 0)
    .map(t => ({ ...t, ...normalizeZone(t, t, lv.rows, cols) }))
  lv.events = lv.events.map(event => event.trigger.type === 'regionEnter' || event.trigger.type === 'regionLeave' || event.trigger.type === 'regionStay'
    ? { ...event, trigger: { ...event.trigger, cells: event.trigger.cells.filter(key => { const [x] = key.split(',').map(Number); return inX(x) }) } }
    : event)
  lv.startZone = normalizeZone(lv.startZone, defaultStartZone(lv.rows, cols), lv.rows, cols)
  lv.finishZone = normalizeZone(lv.finishZone, defaultFinishZone(lv.rows, cols), lv.rows, cols)
  for (const stage of lv.stages) if (stage.objective.type === 'reach') stage.objective = { type: 'reach', finishCells: objectiveFinishCells(stage.objective, lv.finishZone, lv.rows, lv.cols).filter(key => { const [x] = key.split(',').map(Number); return inX(x) }) }
  for (const stage of lv.stages) if (stage.objective.type === 'defend' || stage.objective.type === 'fortressDefense') stage.objective.spawnRegions = stage.objective.spawnRegions.map(region => ({ ...region, cells: region.cells.filter(key => { const [x] = key.split(',').map(Number); return inX(x) }) }))
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
  const objective: LevelObjective = { type: 'defend', waves: 6, waveWait: true, restTime: DEFEND_REST_TIME_DEFAULT, overlapTime: DEFEND_OVERLAP_TIME_DEFAULT, spawnRegions: defaultSpawnRegions(rows, cols), protectTarget: 'fortress' }
  const stages = [defaultStage(objective)]
  const lv: LevelConfig = {
    version: 18,
    bgm: '',
    assemblyPointLimit: 30,
    mode: 'defend',
    rows,
    cols,
    buildCells: [], // 玩家侧基地格退役（移动堡垒无地面建造区）
    groundCells: [], // 战场地面层默认空（纯视觉笔刷层）
    baseTiles: [],
    overlayTiles: [],
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
    initialUnits: [],
    initialWalls: [],
    objective,
    stages,
    startStageId: stages[0].id,
    startZone: defaultStartZone(rows, cols),
    finishZone: defaultFinishZone(rows, cols),
    triggers: [],
    interactables: [],
    variables: [],
    events: [],
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
    const assemblyPointLimit = Number(parsed.assemblyPointLimit)
    merged.assemblyPointLimit = Number.isFinite(assemblyPointLimit)
      ? Math.max(0, Math.min(999, Math.round(assemblyPointLimit)))
      : base.assemblyPointLimit
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
    merged.baseTiles = normalizeTileCells(parsed.baseTiles, merged.rows, merged.cols)
    merged.overlayTiles = normalizeTileCells(parsed.overlayTiles, merged.rows, merged.cols)
    if (!Array.isArray(parsed.overlayTiles)) {
      merged.overlayTiles = merged.groundCells.map(key => {
        const [x, y] = key.split(',').map(Number)
        return { x, y, source: 'autotile' as const, assetId: 'builtin:ground/mid', tileIndex: 0, flipX: false, rotation: 0 as const }
      })
    }
    merged.mode = normalizeLevelMode(parsed.mode)
    merged.objective = normalizeObjective(parsed.objective, merged.mode, merged.rows, merged.cols)
    if (merged.objective.type === 'defend' && (parsed.objective as { protectTarget?: unknown } | undefined)?.protectTarget === undefined && merged.core) merged.objective.protectTarget = 'core'
    merged.stages = normalizeStages(parsed.stages, merged.objective, merged.rows, merged.cols)
    merged.startStageId = typeof parsed.startStageId === 'string' && merged.stages.some(stage => stage.id === parsed.startStageId) ? parsed.startStageId : merged.stages[0].id
    const startStage = merged.stages.find(stage => stage.id === merged.startStageId)!
    merged.objective = structuredClone(startStage.objective) // 旧字段继续镜像起始阶段，供旧工具与导出兼容
    merged.mode = startStage.objective.type === 'reach' || startStage.objective.type === 'escort' || startStage.objective.type === 'destroy' ? 'advance' : 'defend'
    merged.startZone = normalizeZone(parsed.startZone, defaultStartZone(merged.rows, merged.cols), merged.rows, merged.cols)
    merged.finishZone = normalizeZone(parsed.finishZone, defaultFinishZone(merged.rows, merged.cols), merged.rows, merged.cols)
    for (const stage of merged.stages) if (stage.objective.type === 'reach') stage.objective = { type: 'reach', finishCells: objectiveFinishCells(stage.objective, merged.finishZone, merged.rows, merged.cols) }
    if (merged.objective.type === 'reach') merged.objective = structuredClone(merged.stages.find(stage => stage.id === merged.startStageId)!.objective)
    const legacyTriggers = normalizeTriggers(parsed.triggers, merged.rows, merged.cols)
    const legacyInteractables = normalizeInteractables(parsed.interactables, merged.rows, merged.cols)
    merged.variables = normalizeVariables(parsed.variables)
    merged.events = normalizeUnifiedEvents(parsed.events, merged.rows, merged.cols, normalizeEventActions)
    if (!Array.isArray(parsed.events)) {
      merged.events = [
        ...legacyTriggers.map(trigger => ({
          id: trigger.id,
          name: trigger.name,
          category: 'region' as const,
          enabled: trigger.enabled,
          activationLimit: trigger.activationLimit,
          cooldown: trigger.cooldown,
          conditions: emptyConditionGroup(),
          trigger: { type: 'regionEnter' as const, cells: regionCellsFromRect(trigger.x, trigger.y, trigger.w, trigger.h) },
          actions: normalizeEventActions(trigger.actions),
        })),
        ...legacyInteractables.map((item, index) => ({
          id: Math.max(1, ...legacyTriggers.map(trigger => trigger.id), 0) + index + 1,
          name: item.name,
          category: 'object' as const,
          enabled: item.enabled,
          activationLimit: item.once ? 1 : 0,
          cooldown: 0,
          conditions: emptyConditionGroup(),
          trigger: { type: 'regionEnter' as const, cells: regionCellsFromRect(item.x, item.y, item.w, item.h) },
          actions: normalizeEventActions(item.actions),
        })),
      ]
    }
    merged.triggers = []
    merged.interactables = []
    merged.objects = (Array.isArray(parsed.objects) ? parsed.objects : base.objects).map(object => ({
      ...object,
      height: Math.max(0, Math.min(3, Math.round(Number(object.height) || 0))),
      events: Array.isArray(object.events) ? object.events.slice(0, 50).map((event, index) => ({
        id: Math.max(1, Math.round(Number(event?.id) || index + 1)),
        name: String(event?.name ?? `事件 ${index + 1}`).slice(0, 80),
        trigger: event?.trigger === 'destroyed' || event?.trigger === 'contact' ? event.trigger : 'interact',
        activationLimit: Math.max(0, Math.min(999, Math.round(Number(event?.activationLimit) || 1))),
        cooldown: Math.max(0, Math.min(3600, Number(event?.cooldown) || 0)),
        conditions: normalizeConditionGroup(event?.conditions),
        actions: normalizeEventActions(event?.actions),
      })) : undefined,
    }))
    // v17 删除独立初始炮塔；旧字段只读后直接丢弃，不再进入编辑器或运行时。
    merged.initialTurrets = []
    merged.initialUnits = normalizeInitialUnits(parsed.initialUnits, merged.rows, merged.cols)
    merged.version = 18
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
  const copy = structuredClone(level)
  return { version: 1, activeId: 'level-1', globalVariables: [], levels: [{ id: 'level-1', name: '关卡 01', level: copy, briefing: defaultMissionBriefing(copy) }] }
}

function normalizeGlobalVariables(value: unknown): LevelVariableDef[] {
  const byId = new Map<string, LevelVariableDef>()
  for (const variable of normalizeVariables(value)) {
    const id = variable.id.startsWith('global:') ? variable.id : `global:${variable.id.replace(/^var:/, '')}`
    if (!byId.has(id)) byId.set(id, { ...variable, id })
  }
  return [...byId.values()]
}

const EQUIPMENT_KINDS = new Set<EquipmentKind>(['fortress', 'turret', 'module', 'paint', 'emblem'])

export function equipmentUnlockId(ref: EquipmentUnlockRef): string {
  return `${ref.kind}:${ref.id.trim()}`
}

export function normalizeEquipmentUnlocks(value: unknown): EquipmentUnlockRef[] {
  if (!Array.isArray(value)) return []
  const byKey = new Map<string, EquipmentUnlockRef>()
  for (const raw of value.slice(0, 200)) {
    if (!raw || typeof raw !== 'object') continue
    const item = raw as Partial<EquipmentUnlockRef>
    if (!EQUIPMENT_KINDS.has(item.kind as EquipmentKind) || typeof item.id !== 'string' || !item.id.trim()) continue
    const ref = { kind: item.kind as EquipmentKind, id: item.id.trim().slice(0, 64) }
    byKey.set(equipmentUnlockId(ref), ref)
  }
  return [...byKey.values()]
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
      const unlockRewards = normalizeEquipmentUnlocks(src.unlockRewards)
      const level = parseLevel(JSON.stringify(src.level ?? {}))
      const briefing = missionBriefingOf({ level, briefing: src.briefing })
      const deployableFortressIds = Array.isArray(src.deployableFortressIds)
        ? Array.from(new Set(src.deployableFortressIds.filter((item): item is string => typeof item === 'string' && !!item.trim()).map(item => item.trim().slice(0, 64)))).slice(0, MAX_DEPLOYABLE_FORTRESSES)
        : undefined
      levels.push({ id, name, level, nextId, reward, unlockRewards, briefing, deployableFortressIds })
    }
    for (const entry of levels) if (entry.nextId === entry.id || !levels.some(x => x.id === entry.nextId)) entry.nextId = null
    const activeId = levels.some(x => x.id === value.activeId) ? value.activeId! : levels[0].id
    return { version: 1, activeId, globalVariables: normalizeGlobalVariables(value.globalVariables), levels }
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
  LEVEL_LIBRARY.globalVariables = normalized.globalVariables
  LEVEL_LIBRARY.levels.splice(0, LEVEL_LIBRARY.levels.length, ...normalized.levels)
  replaceLevel(LEVEL, LEVEL_LIBRARY.levels.find(x => x.id === LEVEL_LIBRARY.activeId)!.level)
  invalidateWallInfo()
  persistLibrary()
}

/** 删除自定义单位时清理所有关卡中的直接定义引用；返回实际移除/修改的引用数量。 */
export function removeUnitDefinitionReferences(library: LevelLibrary, unitDefId: string, fortressId?: string): number {
  let changes = 0
  const cleanActions = (actions: LevelEventAction[]): LevelEventAction[] => {
    const result: LevelEventAction[] = []
    for (const action of actions) {
      if (action.type === 'spawn') {
        const next = structuredClone(action)
        if (next.units && Object.prototype.hasOwnProperty.call(next.units, unitDefId)) {
          delete next.units[unitDefId]
          changes += 1
        }
        result.push(next)
        continue
      }
      if (action.type === 'boss' && action.boss.unitDefId === unitDefId) {
        changes += 1
        continue
      }
      if (action.type === 'unit' && action.selector.scope === 'unitDef' && action.selector.unitDefId === unitDefId) {
        changes += 1
        continue
      }
      if (action.type === 'choice') {
        result.push({ ...action, options: action.options.map(option => ({ ...option, actions: cleanActions(option.actions) })) })
        continue
      }
      result.push(action)
    }
    return result
  }

  for (const entry of library.levels) {
    const level = entry.level
    const removedPlacementIds = new Set(level.initialUnits.filter(unit => unit.unitDefId === unitDefId).map(unit => unit.id))
    if (removedPlacementIds.size > 0) {
      level.initialUnits = level.initialUnits.filter(unit => unit.unitDefId !== unitDefId)
      changes += removedPlacementIds.size
    }
    for (const unit of level.initialUnits) for (const event of unit.events ?? []) event.actions = cleanActions(event.actions)
    for (const object of level.objects) for (const event of object.events ?? []) event.actions = cleanActions(event.actions)
    for (const event of level.events) event.actions = cleanActions(event.actions)
    for (const trigger of level.triggers) {
      if (trigger.units && Object.prototype.hasOwnProperty.call(trigger.units, unitDefId)) {
        delete trigger.units[unitDefId]
        changes += 1
      }
      trigger.actions = cleanActions(trigger.actions)
    }
    for (const interactable of level.interactables) interactable.actions = cleanActions(interactable.actions)
    for (const stage of level.stages) {
      for (const wave of stage.waves) {
        const before = wave.entries.length
        wave.entries = wave.entries.filter(item => item.unitDefId !== unitDefId)
        changes += before - wave.entries.length
      }
    }
    if (fortressId && entry.deployableFortressIds?.includes(fortressId)) {
      entry.deployableFortressIds = entry.deployableFortressIds.filter(id => id !== fortressId)
      if (entry.deployableFortressIds.length === 0) entry.deployableFortressIds = undefined
      changes += 1
    }
  }
  return changes
}

const PROGRESS_STORAGE_KEY = 'td-level-progress-v1'
export type LevelMedalSlot = 'primary' | 'secondary-1' | 'secondary-2'
export interface LevelProgress {
  completedIds: string[]
  totalReward: number
  medalIds: string[]
  /** 永久拥有的装备键（kind:id）。未被任何解锁来源登记的装备默认可用。 */
  unlockedEquipmentIds: string[]
  unlockRecords: EquipmentUnlockRecord[]
  /** 成就商店已消费的勋章数；可用勋章 = 已获得勋章数 - 此值。 */
  spentMedals: number
  /** 跨关卡、跨重启持久化的玩家全局变量当前值。 */
  globalVariables: Record<string, boolean | number>
}

function normalizeGlobalVariableValues(value: unknown): Record<string, boolean | number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const entries = Object.entries(value as Record<string, unknown>).slice(0, 200)
  return Object.fromEntries(entries.flatMap(([rawId, rawValue]) => {
    const id = rawId.startsWith('global:') ? rawId.slice(0, 80) : `global:${rawId.replace(/^var:/, '').slice(0, 73)}`
    return typeof rawValue === 'boolean' ? [[id, rawValue ? 1 : 0]] : typeof rawValue === 'number' && Number.isFinite(rawValue) ? [[id, rawValue]] : []
  }))
}

/** 按全局定义生成本局快照；已有玩家进度优先，缺失时使用定义初始值。 */
export function globalVariableValues(definitions: LevelVariableDef[], saved: Record<string, boolean | number>): Record<string, boolean | number> {
  return Object.fromEntries(definitions.map(variable => {
    const value = saved[variable.id]
    const migrated = typeof value === 'boolean' ? (value ? 1 : 0) : value
    const valid = typeof migrated === 'number' && Number.isFinite(migrated)
    return [variable.id, valid ? migrated : variable.initial]
  }))
}

export function levelMedalId(levelId: string, slot: LevelMedalSlot): string { return `${levelId}:${slot}` }

export function hasLevelMedal(progress: LevelProgress, levelId: string, slot: LevelMedalSlot): boolean {
  // 旧进度没有 medalIds；已通关关卡视为已取得主要目标勋章。
  return progress.medalIds.includes(levelMedalId(levelId, slot)) || (slot === 'primary' && progress.completedIds.includes(levelId))
}

export function earnedMedalCount(progress: LevelProgress): number {
  return new Set([
    ...progress.medalIds,
    ...progress.completedIds.map(levelId => levelMedalId(levelId, 'primary')),
  ]).size
}

export function availableMedalCount(progress: LevelProgress): number {
  return Math.max(0, earnedMedalCount(progress) - Math.max(0, Math.round(progress.spentMedals)))
}

/** 只有出现在关卡奖励或额外锁定目录中的装备需要解锁；其余现有内容保持默认可用。 */
export function isEquipmentUnlocked(progress: LevelProgress, ref: EquipmentUnlockRef, library: LevelLibrary, additionalLockedIds: readonly string[] = []): boolean {
  if (gameParameters().unlockAll) return true
  const key = equipmentUnlockId(ref)
  if (progress.unlockedEquipmentIds.includes(key)) return true
  return !ACHIEVEMENT_SHOP_LOCKED_EQUIPMENT_IDS.has(key)
    && !additionalLockedIds.includes(key)
    && !library.levels.some(entry => entry.unlockRewards?.some(reward => equipmentUnlockId(reward) === key))
}

export function grantEquipmentUnlocks(progress: LevelProgress, rewards: readonly EquipmentUnlockRef[], source: EquipmentUnlockSource, sourceId?: string): LevelProgress {
  const next = normalizeLevelProgress(progress)
  for (const ref of normalizeEquipmentUnlocks(rewards)) {
    const key = equipmentUnlockId(ref)
    if (next.unlockedEquipmentIds.includes(key)) continue
    next.unlockedEquipmentIds.push(key)
    next.unlockRecords.push({ equipmentId: key, source, ...(sourceId ? { sourceId: sourceId.slice(0, 64) } : {}) })
  }
  return next
}

export type EquipmentPurchaseResult =
  | { ok: true; progress: LevelProgress; newlyUnlocked: EquipmentUnlockRef }
  | { ok: false; progress: LevelProgress; reason: 'owned' | 'insufficient-medals' }

/** #27 成就商店复用此入口；本阶段先落地所有权与扣费原子逻辑。 */
export function purchaseEquipment(progress: LevelProgress, ref: EquipmentUnlockRef, medalCost: number, shopItemId = equipmentUnlockId(ref)): EquipmentPurchaseResult {
  const next = normalizeLevelProgress(progress)
  const normalized = normalizeEquipmentUnlocks([ref])[0]
  if (!normalized || gameParameters().unlockAll || next.unlockedEquipmentIds.includes(equipmentUnlockId(normalized))) return { ok: false, progress: next, reason: 'owned' }
  const cost = Math.max(0, Math.round(medalCost))
  if (availableMedalCount(next) < cost) return { ok: false, progress: next, reason: 'insufficient-medals' }
  next.spentMedals += cost
  return { ok: true, progress: grantEquipmentUnlocks(next, [normalized], 'shop', shopItemId), newlyUnlocked: normalized }
}

/** 首关始终可选；后续关卡由前一关完成或显式 nextId 前驱完成解锁。 */
export function isLevelUnlocked(library: LevelLibrary, levelId: string, progress: LevelProgress): boolean {
  const index = library.levels.findIndex(entry => entry.id === levelId)
  if (gameParameters().unlockAll) return index >= 0
  if (index <= 0 || progress.completedIds.includes(levelId) || library.activeId === levelId) return index >= 0
  const previous = library.levels[index - 1]
  return progress.completedIds.includes(previous.id)
    || library.levels.some(entry => entry.nextId === levelId && progress.completedIds.includes(entry.id))
}

function normalizeLevelProgress(raw: Partial<LevelProgress>): LevelProgress {
  const unlockedEquipmentIds = Array.isArray(raw.unlockedEquipmentIds)
    ? [...new Set(raw.unlockedEquipmentIds.filter((item): item is string => typeof item === 'string' && /^(fortress|turret|module|paint|emblem):.+/.test(item)))].slice(0, 1000)
    : []
  const unlockRecords = Array.isArray(raw.unlockRecords) ? raw.unlockRecords.flatMap(record => {
    if (!record || typeof record !== 'object') return []
    const item = record as Partial<EquipmentUnlockRecord>
    if (typeof item.equipmentId !== 'string' || !unlockedEquipmentIds.includes(item.equipmentId)) return []
    if (item.source !== 'level' && item.source !== 'shop' && item.source !== 'starter') return []
    return [{ equipmentId: item.equipmentId, source: item.source, ...(typeof item.sourceId === 'string' && item.sourceId ? { sourceId: item.sourceId.slice(0, 64) } : {}) }]
  }).slice(0, 1000) : []
  return {
    completedIds: Array.isArray(raw.completedIds) ? [...new Set(raw.completedIds.filter(x => typeof x === 'string'))].slice(0, 200) : [],
    totalReward: Math.max(0, Math.round(Number(raw.totalReward) || 0)),
    medalIds: Array.isArray(raw.medalIds) ? [...new Set(raw.medalIds.filter(x => typeof x === 'string'))].slice(0, 600) : [],
    unlockedEquipmentIds,
    unlockRecords,
    spentMedals: Math.max(0, Math.round(Number(raw.spentMedals) || 0)),
    globalVariables: normalizeGlobalVariableValues(raw.globalVariables),
  }
}

export function loadLevelProgress(): LevelProgress {
  try {
    const raw = JSON.parse(globalThis.localStorage?.getItem(PROGRESS_STORAGE_KEY) ?? '{}') as Partial<LevelProgress>
    return normalizeLevelProgress(raw)
  } catch { return normalizeLevelProgress({}) }
}

export function saveLevelProgress(progress: LevelProgress): LevelProgress {
  const normalized = normalizeLevelProgress(progress)
  try { globalThis.localStorage?.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(normalized)) } catch { /* 无存储环境 */ }
  return normalized
}

/** 成就商店持久化入口：购买、勋章扣除与所有权写入在一次调用中完成。 */
export function purchaseEquipmentFromShop(ref: EquipmentUnlockRef, medalCost: number, shopItemId = equipmentUnlockId(ref)): EquipmentPurchaseResult {
  const result = purchaseEquipment(loadLevelProgress(), ref, medalCost, shopItemId)
  if (!result.ok) return result
  const progress = saveLevelProgress(result.progress)
  return { ...result, progress }
}

/** 全局变量动作即时写回玩家进度，确保切关卡、刷新或重新打开游戏后仍可读取。 */
export function saveGlobalVariableValues(values: Record<string, boolean | number>): LevelProgress {
  const progress = loadLevelProgress()
  progress.globalVariables = normalizeGlobalVariableValues(values)
  return saveLevelProgress(progress)
}

/** 纯函数结算：每次胜利都发放关卡奖励；通关记录和各目标勋章只记录一次。 */
export function awardLevelProgress(progress: LevelProgress, levelId: string, reward: number, earnedSlots: LevelMedalSlot[], unlockRewards: readonly EquipmentUnlockRef[] = []): LevelProgress {
  let next = normalizeLevelProgress(progress)
  const firstCompletion = !next.completedIds.includes(levelId)
  if (!next.completedIds.includes(levelId)) {
    next.completedIds.push(levelId)
  }
  next.totalReward += Math.max(0, Math.round(reward))
  const validSlots = new Set<LevelMedalSlot>(['primary', 'secondary-1', 'secondary-2'])
  for (const slot of new Set(earnedSlots)) {
    if (!validSlots.has(slot)) continue
    const medal = levelMedalId(levelId, slot)
    if (!next.medalIds.includes(medal)) next.medalIds.push(medal)
  }
  if (firstCompletion) next = grantEquipmentUnlocks(next, unlockRewards, 'level', levelId)
  return next
}

export function completeActiveLevel(earnedSlots: LevelMedalSlot[] = ['primary']): LevelProgress {
  const entry = LEVEL_LIBRARY.levels.find(x => x.id === LEVEL_LIBRARY.activeId)
  const progress = awardLevelProgress(loadLevelProgress(), LEVEL_LIBRARY.activeId, entry?.reward ?? 0, earnedSlots, entry?.unlockRewards ?? [])
  return saveLevelProgress(progress)
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
  LEVEL_LIBRARY.globalVariables = library.globalVariables
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
  terrainDefId: 'terrain:puddle',
  objectDefId: 'object:barrel',
  obj: {
    barrel: { hp: BARREL_HP, blockMove: true, blockProjectile: false, height: 1 },
    ruins: { hp: RUINS_HP, blockMove: true, blockProjectile: true, height: 1 },
    rock: { hp: -1, blockMove: true, blockProjectile: false, height: 1 },
  } as Record<ObjectKind, { hp: number; blockMove: boolean; blockProjectile: boolean; height: number }>,
  turretDefId: 'mg', // 初始炮塔笔刷默认定义
  building: { name: '新建筑', w: 2, h: 2 }, // 固有建筑笔刷默认尺寸/名称
  selectedBuildingId: null as number | null, // 建筑笔刷：面板中选中的建筑（点地图移动它）
  selectedTriggerId: null as number | null, // 伏击区域笔刷：面板中选中的触发器（点地图移动它）
  selectedInteractableId: null as number | null,
  selectedInitialUnitId: null as number | null,
  unitDefId: '',
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
