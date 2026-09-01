import type { LevelConfig, LevelEventAction, LevelLibraryEntry, LevelUnitPlacement } from './level'

export type LevelEditorLayer = 'base' | 'overlay' | 'terrain' | 'object'
export type LevelTileSource = 'independent' | 'autotile'
export type LevelTileRotation = 0 | 90 | 180 | 270

/** 底图/装饰层的单格数据；Autotile 的 tileIndex 由邻接规则运行时决定。 */
export interface LevelTileCell {
  x: number
  y: number
  source: LevelTileSource
  assetId: string
  tileIndex: number
  flipX: boolean
  rotation: LevelTileRotation
}

/** 底图/装饰层选择工具使用的闭合地格矩形。 */
export interface LevelCellRect {
  x: number
  y: number
  w: number
  h: number
}

/** 关卡尺寸采用零基索引；偶数尺寸时取右下侧的中心格。 */
export function levelCenterCell(cols: number, rows: number): { x: number; y: number } {
  return {
    x: Math.max(0, Math.floor(Math.max(1, cols) / 2)),
    y: Math.max(0, Math.floor(Math.max(1, rows) / 2)),
  }
}

/** 将任意方向的拖拽端点吸附为地图内、包含首尾地格的矩形选择。 */
export function gridCellSelectionRect(startX: number, startY: number, endX: number, endY: number, cols: number, rows: number): LevelCellRect {
  const clampCell = (value: number, size: number) => Math.max(0, Math.min(Math.max(0, size - 1), Math.floor(value)))
  const ax = clampCell(startX, cols); const ay = clampCell(startY, rows)
  const bx = clampCell(endX, cols); const by = clampCell(endY, rows)
  return { x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(bx - ax) + 1, h: Math.abs(by - ay) + 1 }
}

export function tileInsideCellRect(tile: Pick<LevelTileCell, 'x' | 'y'>, rect: LevelCellRect): boolean {
  return tile.x >= rect.x && tile.x < rect.x + rect.w && tile.y >= rect.y && tile.y < rect.y + rect.h
}

/** 清除矩形内当前层图块；不影响另一图层。 */
export function eraseTileCellsInRect(tiles: readonly LevelTileCell[], rect: LevelCellRect): LevelTileCell[] {
  return tiles.filter(tile => !tileInsideCellRect(tile, rect))
}

/** 以当前模板完整覆盖矩形；每格模板由调用方生成，以支持独立图块随机权重。 */
export function fillTileCellsInRect(tiles: readonly LevelTileCell[], rect: LevelCellRect, create: (x: number, y: number) => LevelTileCell): LevelTileCell[] {
  const next = eraseTileCellsInRect(tiles, rect)
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) next.push(create(x, y))
  }
  return next
}

/** 自定义变量统一使用数值；旧布尔值在读取时迁移为 1 / 0。 */
export type LevelVariableType = 'number'
export interface LevelVariableDef {
  id: string
  name: string
  type: LevelVariableType
  initial: number
}

export type LevelConditionOperator = 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte'
export interface LevelVariableCondition {
  kind?: 'variable'
  /** 自定义变量 id，或内置只读变量（如 builtin:fortressHpPercent）。 */
  variableId: string
  operator: LevelConditionOperator
  value: boolean | number
}

export interface LevelUnitStateCondition {
  kind: 'unit'
  unitPlacementId: number
  state: 'dead' | 'alive'
}

export interface LevelObjectStateCondition {
  kind: 'object'
  objectId: number
  state: 'destroyed' | 'intact'
}

export interface LevelObjectValueCondition {
  kind: 'objectState'
  objectId: number
  operator: 'eq' | 'ne'
  state: string
}

export type LevelCondition = LevelVariableCondition | LevelUnitStateCondition | LevelObjectStateCondition | LevelObjectValueCondition

export interface LevelConditionGroup {
  mode: 'all' | 'any'
  conditions: LevelCondition[]
}

export type LevelEventCategory = 'flow' | 'scene' | 'object' | 'region'
export type LevelEventTrigger =
  | { type: 'missionStart' }
  | { type: 'automatic' }
  | { type: 'parallel' }
  | { type: 'regionEnter' | 'regionLeave' | 'regionStay'; cells: string[] }
  | { type: 'interact'; objectId: number }
  | { type: 'objectDestroyed'; objectId: number }
  | { type: 'stageSuccess' | 'stageFailure'; stageId: string }

/** 统一事件：区域与对象引用归属于触发方式，不再存在独立交互物。 */
export interface UnifiedLevelEvent {
  id: number
  name: string
  category: LevelEventCategory
  enabled: boolean
  activationLimit: number
  cooldown: number
  conditions: LevelConditionGroup
  trigger: LevelEventTrigger
  actions: LevelEventAction[]
}

export const emptyConditionGroup = (): LevelConditionGroup => ({ mode: 'all', conditions: [] })

export function regionCellsFromRect(x: number, y: number, w: number, h: number): string[] {
  const cells: string[] = []
  for (let cy = Math.floor(y); cy < Math.ceil(y + h); cy++) {
    for (let cx = Math.floor(x); cx < Math.ceil(x + w); cx++) cells.push(`${cx},${cy}`)
  }
  return cells
}

export function normalizeRegionCells(value: unknown, rows: number, cols: number): string[] {
  if (!Array.isArray(value)) return []
  const unique = new Set<string>()
  for (const item of value.slice(0, 20_000)) {
    const match = String(item).match(/^(-?\d+),(-?\d+)$/)
    if (!match) continue
    const x = Number(match[1]); const y = Number(match[2])
    if (x >= 0 && x < cols && y >= 0 && y < rows) unique.add(`${x},${y}`)
  }
  return [...unique]
}

export function normalizeTileCells(value: unknown, rows: number, cols: number): LevelTileCell[] {
  if (!Array.isArray(value)) return []
  const byCell = new Map<string, LevelTileCell>()
  for (const raw0 of value.slice(0, 20_000)) {
    const raw = (raw0 ?? {}) as Partial<LevelTileCell>
    const x = Math.round(Number(raw.x)); const y = Math.round(Number(raw.y))
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x >= cols || y < 0 || y >= rows) continue
    const rotation = [0, 90, 180, 270].includes(Number(raw.rotation)) ? Number(raw.rotation) as LevelTileRotation : 0
    byCell.set(`${x},${y}`, {
      x, y,
      source: raw.source === 'autotile' ? 'autotile' : 'independent',
      assetId: String(raw.assetId ?? '').slice(0, 240),
      tileIndex: Math.max(0, Math.round(Number(raw.tileIndex) || 0)),
      flipX: raw.flipX === true,
      rotation,
    })
  }
  return [...byCell.values()]
}

export function normalizeVariables(value: unknown): LevelVariableDef[] {
  if (!Array.isArray(value)) return []
  const ids = new Set<string>()
  const out: LevelVariableDef[] = []
  for (const [index, raw0] of value.slice(0, 200).entries()) {
    const raw = (raw0 ?? {}) as Partial<LevelVariableDef>
    let id = String(raw.id ?? `var-${index + 1}`).trim().replace(/[^a-zA-Z0-9:_-]/g, '-').slice(0, 80) || `var-${index + 1}`
    while (ids.has(id)) id = `${id}-${index + 1}`
    ids.add(id)
    const initial = typeof raw.initial === 'boolean' ? (raw.initial ? 1 : 0) : Number(raw.initial) || 0
    out.push({ id, name: String(raw.name ?? id).slice(0, 80), type: 'number', initial })
  }
  return out
}

export type LevelValidationTarget =
  | { kind: 'levelInfo' }
  | { kind: 'mission'; stageId?: string }
  | { kind: 'event'; eventId?: number }
  | { kind: 'unit'; placementId: number; eventId?: number }
  | { kind: 'object'; objectId: number; eventId?: number }

export interface LevelValidationIssue {
  severity: 'error' | 'warning'
  message: string
  /** 保存检查窗口用于返回产生问题的编辑入口；不参与关卡存档。 */
  target: LevelValidationTarget
}

export type LevelUnitFootprintResolver = (unit: LevelUnitPlacement) => { w: number; h: number }

const cellInsideLevel = (x: number, y: number, level: Pick<LevelConfig, 'cols' | 'rows'>) =>
  Number.isFinite(x) && Number.isFinite(y) && x >= 0 && x < level.cols && y >= 0 && y < level.rows

const rectInsideLevel = (x: number, y: number, w: number, h: number, level: Pick<LevelConfig, 'cols' | 'rows'>) =>
  Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(w) && Number.isFinite(h)
  && x >= 0 && y >= 0 && w > 0 && h > 0 && x + w <= level.cols && y + h <= level.rows

/**
 * 保存成功时清理非对象层的越界内容。对象层必须先通过 validateLevelReferences，
 * 因此这里不会移动、裁剪或删除物体、单位、事件及任务区域。
 */
export function pruneVisualLayersOutsideBounds(level: LevelConfig): LevelConfig {
  const next = structuredClone(level)
  next.baseTiles = next.baseTiles.filter(tile => cellInsideLevel(tile.x, tile.y, next))
  next.overlayTiles = next.overlayTiles.filter(tile => cellInsideLevel(tile.x, tile.y, next))
  next.groundCells = next.groundCells.filter(key => {
    const [x, y] = key.split(',').map(Number)
    return cellInsideLevel(x, y, next)
  })
  // 地形是一个完整实例；任意部分越界时删除整个实例，避免静默改变其占格形状。
  next.terrain = next.terrain.filter(item => rectInsideLevel(item.x, item.y, item.w, item.h, next))
  return next
}

/** 保存前的跨引用检查；不修改草稿，错误阻止保存，警告允许用户修正后再保存。 */
export function validateLevelReferences(level: LevelConfig, entry?: Pick<LevelLibraryEntry, 'briefing'>, assetIds: ReadonlySet<string> = new Set(), globalVariableIds: ReadonlySet<string> = new Set(), soundPresetIds: ReadonlySet<string> = new Set(), unitFootprintOf: LevelUnitFootprintResolver = () => ({ w: 1, h: 1 })): LevelValidationIssue[] {
  const issues: LevelValidationIssue[] = []
  const stages = new Set(level.stages.map(stage => stage.id))
  const events = new Set(level.events.map(event => event.id))
  const units = new Set(level.initialUnits.map(unit => unit.id))
  const unitGroups = new Set(level.initialUnits.map(unit => unit.group?.trim()).filter((group): group is string => !!group))
  const objects = new Set(level.objects.map((object, index) => object.id ?? 2000 + index))
  const variables = new Set(level.variables.map(variable => variable.id))
  const add = (severity: LevelValidationIssue['severity'], message: string, target: LevelValidationTarget) => issues.push({ severity, message, target })
  const validAsset = (id: string | undefined) => !id || id.startsWith('/') || id.startsWith('data:') || assetIds.size === 0 || assetIds.has(id)

  for (const [index, object] of level.objects.entries()) {
    const objectId = object.id ?? 2000 + index
    if (!rectInsideLevel(object.x, object.y, object.w, object.h, level)) add('error', `物体 #${objectId} 超出当前关卡尺寸`, { kind: 'object', objectId })
  }
  for (const unit of level.initialUnits) {
    const footprint = unitFootprintOf(unit)
    if (!rectInsideLevel(unit.x - footprint.w / 2, unit.y - footprint.h / 2, footprint.w, footprint.h, level)) add('error', `单位 #${unit.id} 超出当前关卡尺寸`, { kind: 'unit', placementId: unit.id })
    if ((unit.route ?? []).some(point => !cellInsideLevel(Math.floor(point.x), Math.floor(point.y), level))) add('error', `单位 #${unit.id} 的路线节点超出当前关卡尺寸`, { kind: 'unit', placementId: unit.id })
  }
  if (!rectInsideLevel(level.startZone.x, level.startZone.y, level.startZone.w, level.startZone.h, level)) add('error', '玩家起点超出当前关卡尺寸', { kind: 'levelInfo' })
  for (const stage of level.stages) if (stage.objective.type === 'reach') {
    const invalidFinish = (stage.objective.finishCells ?? []).some(key => {
      const [x, y] = key.split(',').map(Number)
      return !cellInsideLevel(x, y, level)
    })
    if (invalidFinish) add('error', `任务阶段“${stage.name}”的终点超出当前关卡尺寸`, { kind: 'mission', stageId: stage.id })
  }
  for (const stage of level.stages) if (stage.objective.type === 'fortressDefense') {
    const { fortressPoint, returnPoint } = stage.objective
    if (!cellInsideLevel(Math.floor(fortressPoint.x), Math.floor(fortressPoint.y), level)) add('error', `任务阶段“${stage.name}”的堡垒位置超出当前关卡尺寸`, { kind: 'mission', stageId: stage.id })
    if (!cellInsideLevel(Math.floor(returnPoint.x), Math.floor(returnPoint.y), level)) add('error', `任务阶段“${stage.name}”的载具返回点超出当前关卡尺寸`, { kind: 'mission', stageId: stage.id })
    if (!stage.objective.fortressDefId) add('error', `任务阶段“${stage.name}”尚未指定堡垒单位`, { kind: 'mission', stageId: stage.id })
  }
  for (const stage of level.stages) if (stage.objective.type === 'defend' || stage.objective.type === 'fortressDefense') {
    const regionIds = new Set<number>()
    if (stage.objective.spawnRegions.length === 0) add('error', `任务阶段“${stage.name}”尚未创建敌人出生区域`, { kind: 'mission', stageId: stage.id })
    for (const region of stage.objective.spawnRegions) {
      if (regionIds.has(region.id)) add('error', `任务阶段“${stage.name}”存在重复的出生区域编号 #${region.id}`, { kind: 'mission', stageId: stage.id })
      regionIds.add(region.id)
      if (region.cells.length === 0) add('error', `任务阶段“${stage.name}”的出生区域 #${region.id} 为空`, { kind: 'mission', stageId: stage.id })
      if (region.cells.some(key => { const [x, y] = key.split(',').map(Number); return !cellInsideLevel(x, y, level) })) add('error', `任务阶段“${stage.name}”的出生区域 #${region.id} 超出当前关卡尺寸`, { kind: 'mission', stageId: stage.id })
    }
    for (const wave of stage.waves) for (const entry of wave.entries) if (entry.spawnRegionId !== undefined && !regionIds.has(entry.spawnRegionId)) add('error', `任务阶段“${stage.name}”的波次“${wave.name}”引用不存在的出生区域 #${entry.spawnRegionId}`, { kind: 'mission', stageId: stage.id })
  }
  for (const event of level.events) if (event.trigger.type === 'regionEnter' || event.trigger.type === 'regionLeave' || event.trigger.type === 'regionStay') {
    const invalidRegion = event.trigger.cells.some(key => {
      const [x, y] = key.split(',').map(Number)
      return !cellInsideLevel(x, y, level)
    })
    if (invalidRegion) add('error', `事件“${event.name || event.id}”的触发区域超出当前关卡尺寸`, { kind: 'event', eventId: event.id })
  }

  const checkConditions = (group: LevelConditionGroup | undefined, owner: string, target: LevelValidationTarget) => {
    for (const condition of group?.conditions ?? []) {
      if ((condition.kind === undefined || condition.kind === 'variable') && !condition.variableId.trim()) add('error', `${owner}存在空变量名`, target)
      else if ((condition.kind === undefined || condition.kind === 'variable') && !condition.variableId.startsWith('builtin:') && !variables.has(condition.variableId) && !globalVariableIds.has(condition.variableId)) add('error', `${owner}引用不存在的变量：${condition.variableId}`, target)
      else if (condition.kind === 'unit' && !units.has(condition.unitPlacementId)) add('error', `${owner}引用不存在的单位：#${condition.unitPlacementId}`, target)
      else if ((condition.kind === 'object' || condition.kind === 'objectState') && !objects.has(condition.objectId)) add('error', `${owner}引用不存在的物体：#${condition.objectId}`, target)
    }
  }
  const checkActions = (actions: LevelEventAction[], owner: string, target: LevelValidationTarget, callerId?: number) => {
    for (const action of actions) {
      if ((action.type === 'levelVariable' || action.type === 'globalVariable') && !action.variableId.trim()) add('error', `${owner}存在空变量名指令`, target)
      else if (action.type === 'levelVariable' && !variables.has(action.variableId)) add('error', `${owner}引用不存在的关卡变量：${action.variableId}`, target)
      else if (action.type === 'globalVariable' && globalVariableIds.size > 0 && !globalVariableIds.has(action.variableId)) add('error', `${owner}引用不存在的全局变量：${action.variableId}`, target)
      else if (action.type === 'stageJump' && !stages.has(action.stageId)) add('error', `${owner}引用不存在的任务阶段：${action.stageId || '空'}`, target)
      else if ((action.type === 'setEventEnabled' || action.type === 'callEvent') && !events.has(action.eventId)) add('error', `${owner}引用不存在的事件：#${action.eventId}`, target)
      else if (action.type === 'setEventEnabled' && callerId === action.eventId) add('warning', `${owner}启用/禁用自身，可能形成循环或永久关闭`, target)
      else if (action.type === 'unit' && action.selector.scope === 'placement' && !units.has(action.selector.placementId)) add('error', `${owner}引用不存在的单位：#${action.selector.placementId}`, target)
      else if (action.type === 'unit' && action.selector.scope === 'group' && !unitGroups.has(action.selector.group)) add('error', `${owner}引用不存在的单位组别：${action.selector.group || '空'}`, target)
      else if (action.type === 'unit' && action.command.kind === 'attack' && typeof action.command.target !== 'string' && action.command.target.type === 'unit' && !units.has(action.command.target.placementId)) add('error', `${owner}攻击目标单位不存在：#${action.command.target.placementId}`, target)
      else if (action.type === 'unit' && action.command.kind === 'attack' && typeof action.command.target !== 'string' && action.command.target.type === 'object' && !objects.has(action.command.target.objectId)) add('error', `${owner}攻击目标物体不存在：#${action.command.target.objectId}`, target)
      else if (action.type === 'setObjectState' && action.objectId !== 'source' && !objects.has(action.objectId)) add('error', `${owner}引用不存在的物体：#${action.objectId}`, target)
      else if (action.type === 'sound' && action.presetId && soundPresetIds.size > 0 && !soundPresetIds.has(action.presetId)) add('error', `${owner}引用已删除或无可用素材的音效预设：${action.presetId}`, target)
      else if (action.type === 'music' && action.mode === 'override' && !validAsset(action.assetId)) add('error', `${owner}引用已删除的 BGM：${action.assetId}`, target)
      else if (action.type === 'functionalArea' && (!action.ammoEnabled || action.ammoPerSec <= 0) && (!action.energyEnabled || action.energyPerSec <= 0) && (!action.repairEnabled || (action.structurePerSec <= 0 && action.armorPerSec <= 0)) && !action.assemblyEnabled) add('warning', `${owner}的功能区域没有启用任何有效功能`, target)
      if (action.type === 'choice') for (const option of action.options) checkActions(option.actions, `${owner} / 选择“${option.text}”`, target, callerId)
      if (action.type === 'boss') {
        for (const phase of action.boss.phases) checkActions(phase.actions, `${owner} / Boss阶段`, target, callerId)
        checkActions(action.boss.defeatActions, `${owner} / Boss击败`, target, callerId)
      }
    }
  }

  const containsFunctionalArea = (actions: LevelEventAction[]): boolean => actions.some(action =>
    action.type === 'functionalArea'
    || action.type === 'choice' && action.options.some(option => containsFunctionalArea(option.actions))
    || action.type === 'boss' && (action.boss.phases.some(phase => containsFunctionalArea(phase.actions)) || containsFunctionalArea(action.boss.defeatActions)))

  if (!stages.has(level.startStageId)) add('error', `起始任务阶段不存在：${level.startStageId || '空'}`, { kind: 'mission' })
  for (const stage of level.stages) {
    for (const [label, transition] of [['成功', stage.success], ['失败', stage.failure]] as const) if (transition.type === 'stage' && !stages.has(transition.stageId)) add('error', `阶段“${stage.name}”${label}去向不存在：${transition.stageId}`, { kind: 'mission', stageId: stage.id })
  }
  for (const event of level.events) {
    const owner = `事件“${event.name || event.id}”`
    const target: LevelValidationTarget = { kind: 'event', eventId: event.id }
    if ((event.trigger.type === 'regionEnter' || event.trigger.type === 'regionLeave' || event.trigger.type === 'regionStay') && event.trigger.cells.length === 0) add('error', `${owner}的触发区域为空`, target)
    if ((event.trigger.type === 'stageSuccess' || event.trigger.type === 'stageFailure') && !stages.has(event.trigger.stageId)) add('error', `${owner}引用不存在的任务阶段：${event.trigger.stageId || '空'}`, target)
    if ((event.trigger.type === 'interact' || event.trigger.type === 'objectDestroyed') && !objects.has(event.trigger.objectId)) add('error', `${owner}引用不存在的物体：#${event.trigger.objectId}`, target)
    if (containsFunctionalArea(event.actions) && event.trigger.type !== 'regionStay') add('warning', `${owner}包含功能区域指令，触发方式应设置为“停留区域”`, target)
    if (event.actions.length === 0) add('warning', `${owner}没有动作`, target)
    checkConditions(event.conditions, owner, target)
    checkActions(event.actions, owner, target, event.id)
  }
  for (const unit of level.initialUnits) for (const event of unit.events ?? []) { const owner = `单位 #${unit.id} 的事件“${event.name}”`; const target: LevelValidationTarget = { kind: 'unit', placementId: unit.id, eventId: event.id }; if (event.actions.length === 0) add('warning', `${owner}没有动作`, target); checkConditions(event.conditions, owner, target); checkActions(event.actions, owner, target) }
  for (const [index, object] of level.objects.entries()) for (const event of object.events ?? []) { const objectId = object.id ?? 2000 + index; const owner = `物体 #${objectId} 的事件“${event.name}”`; const target: LevelValidationTarget = { kind: 'object', objectId, eventId: event.id }; if (event.actions.length === 0) add('warning', `${owner}没有动作`, target); checkConditions(event.conditions, owner, target); checkActions(event.actions, owner, target) }
  if (!validAsset(level.bgm)) add('error', `关卡 BGM 已被删除：${level.bgm}`, { kind: 'levelInfo' })
  if (!validAsset(entry?.briefing?.image)) add('error', `任务贴图已被删除：${entry?.briefing?.image}`, { kind: 'levelInfo' })

  const calledEventIds = (actions: LevelEventAction[]): number[] => actions.flatMap(action => {
    if (action.type === 'callEvent') return [action.eventId]
    if (action.type === 'choice') return action.options.flatMap(option => calledEventIds(option.actions))
    if (action.type === 'boss') return [...action.boss.phases.flatMap(phase => calledEventIds(phase.actions)), ...calledEventIds(action.boss.defeatActions)]
    return []
  })
  const graph = new Map(level.events.map(event => [event.id, calledEventIds(event.actions)]))
  const visiting = new Set<number>(); const visited = new Set<number>()
  const walk = (id: number): boolean => {
    if (visiting.has(id)) return true
    if (visited.has(id)) return false
    visiting.add(id)
    const cyclic = (graph.get(id) ?? []).some(walk)
    visiting.delete(id); visited.add(id)
    return cyclic
  }
  for (const event of level.events) if (walk(event.id)) { add('warning', '调用事件存在循环引用；运行时会在 8 层后阻止递归', { kind: 'event', eventId: event.id }); break }
  return issues
}

export function normalizeConditionGroup(value: unknown): LevelConditionGroup {
  const raw = (value ?? {}) as Partial<LevelConditionGroup>
  const conditions: LevelCondition[] = []
  const source = (raw as { conditions?: unknown }).conditions
  for (const item of (Array.isArray(source) ? source : []).slice(0, 50)) {
    const condition = (item ?? {}) as Record<string, unknown>
    if (condition.kind === 'unit') {
      conditions.push({
        kind: 'unit',
        unitPlacementId: Math.max(1, Math.round(Number(condition.unitPlacementId) || 1)),
        state: condition.state === 'dead' ? 'dead' : 'alive',
      })
      continue
    }
    if (condition.kind === 'object') {
      conditions.push({
        kind: 'object',
        objectId: Math.max(1, Math.round(Number(condition.objectId) || 1)),
        state: condition.state === 'destroyed' ? 'destroyed' : 'intact',
      })
      continue
    }
    if (condition.kind === 'objectState') {
      conditions.push({
        kind: 'objectState',
        objectId: Math.max(1, Math.round(Number(condition.objectId) || 1)),
        operator: condition.operator === 'ne' ? 'ne' : 'eq',
        state: String(condition.state ?? 'default').trim().slice(0, 40) || 'default',
      })
      continue
    }
    const variableId = String(condition.variableId ?? '').slice(0, 120)
    if (!variableId) continue
    const operator: LevelConditionOperator = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte'].includes(String(condition.operator)) ? condition.operator as LevelConditionOperator : 'eq'
    const value = typeof condition.value === 'boolean'
      ? variableId.startsWith('builtin:') ? condition.value : condition.value ? 1 : 0
      : Number(condition.value) || 0
    conditions.push({ kind: 'variable', variableId, operator, value })
  }
  return { mode: raw.mode === 'any' ? 'any' : 'all', conditions }
}

function normalizeTrigger(value: unknown, rows: number, cols: number): LevelEventTrigger {
  const raw = (value ?? {}) as Record<string, unknown>
  const type = String(raw.type)
  if (type === 'regionEnter' || type === 'regionLeave' || type === 'regionStay') return { type, cells: normalizeRegionCells(raw.cells, rows, cols) }
  if (type === 'interact' || type === 'objectDestroyed') return { type, objectId: Math.max(1, Math.round(Number(raw.objectId) || 1)) }
  if (type === 'objectState') return { type: 'automatic' }
  if (type === 'stageSuccess' || type === 'stageFailure') return { type, stageId: String(raw.stageId ?? '').slice(0, 80) }
  // 旧“变量满足”触发方式在 normalizeUnifiedEvents 中迁移为“自动 + 变量条件”。
  if (type === 'variable') return { type: 'automatic' }
  if (type === 'parallel') return { type }
  if (type === 'automatic') return { type }
  return { type: 'missionStart' }
}

export function normalizeUnifiedEvents(value: unknown, rows: number, cols: number, normalizeActions: (actions: unknown) => LevelEventAction[]): UnifiedLevelEvent[] {
  if (!Array.isArray(value)) return []
  const ids = new Set<number>()
  return value.slice(0, 500).map((raw0, index) => {
    const raw = (raw0 ?? {}) as Partial<UnifiedLevelEvent>
    let id = Math.max(1, Math.round(Number(raw.id) || index + 1))
    while (ids.has(id)) id++
    ids.add(id)
    const category: LevelEventCategory = ['flow', 'scene', 'object', 'region'].includes(String(raw.category)) ? raw.category as LevelEventCategory : 'scene'
    const triggerRaw = (raw.trigger ?? {}) as Record<string, unknown>
    const conditions = normalizeConditionGroup(raw.conditions)
    if (triggerRaw.type === 'variable') {
      const legacy = normalizeConditionGroup(triggerRaw.conditions)
      conditions.conditions.push(...legacy.conditions)
    }
    if (triggerRaw.type === 'objectState') conditions.conditions.push({
      kind: 'objectState',
      objectId: Math.max(1, Math.round(Number(triggerRaw.objectId) || 1)),
      operator: 'eq',
      state: String(triggerRaw.state ?? 'default').trim().slice(0, 40) || 'default',
    })
    return {
      id,
      name: String(raw.name ?? `事件 ${id}`).slice(0, 80),
      category,
      enabled: raw.enabled !== false,
      activationLimit: Math.max(0, Math.min(999, Math.round(Number(raw.activationLimit) || 1))),
      cooldown: Math.max(0, Math.min(3600, Number(raw.cooldown) || 0)),
      conditions,
      trigger: normalizeTrigger(raw.trigger, rows, cols),
      actions: normalizeActions(raw.actions),
    }
  })
}

export function conditionMatches(
  group: LevelConditionGroup,
  read: (id: string) => boolean | number,
  readEntity?: (condition: LevelUnitStateCondition | LevelObjectStateCondition | LevelObjectValueCondition) => boolean,
): boolean {
  if (group.conditions.length === 0) return true
  const one = (condition: LevelCondition) => {
    if (condition.kind === 'unit' || condition.kind === 'object' || condition.kind === 'objectState') return readEntity?.(condition) ?? false
    const current = read(condition.variableId)
    if (condition.operator === 'eq') return current === condition.value
    if (condition.operator === 'ne') return current !== condition.value
    const a = Number(current); const b = Number(condition.value)
    if (condition.operator === 'gt') return a > b
    if (condition.operator === 'gte') return a >= b
    if (condition.operator === 'lt') return a < b
    return a <= b
  }
  return group.mode === 'any' ? group.conditions.some(one) : group.conditions.every(one)
}
