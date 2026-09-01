import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import {
  Bomb, Bug, Coins, Crosshair, Flame, Rocket,
  Trash2, Zap,
} from 'lucide-react'
import SoundAssetSelect from '@/components/SoundAssetSelect'
import ValidatedNumberInput from '@/components/ValidatedNumberInput'
import PerformanceMonitor from '@/components/game/PerformanceMonitor'
import { MissionImageSelect, TileAssetPicker } from '@/components/level-editor/LevelAssetPickers'
import { EventEditorModal, HeightTipLabel } from '@/components/level-editor/LevelEditorPrimitives'
import { audioManager } from '@/game/audio'
import { audioProjectConfig, BEAM_CONTINUOUS_AUDIO_DELAY, isCueLoopActive, MECH_FOOTSTEP_PRESET_ID, playCue, prewarmSoundPresets, resolveCue, resolveMovementCue, setCueLoopVolume, startCueLoop, stopCueLoop } from '@/game/audioConfig'
import type { GlobalCueSlot } from '@/game/audioConfig'
import {
  MODULE_DEFS, PROJECTILE_ARTS, SPAWN_ROWS,
  BASE_CELL, M_PER_CELL, TURRET_DEFS, VIEW_COLS, VIEW_ROWS, upgradeCost,
} from '@/game/config'
import type { FortressDef, ModuleDef, TurretDef } from '@/game/config'
import { ASSET_REPLACED_EVENT, BRIEFING_BGM_ASSET_ID, filterAssets, findAssetByName, getAsset, isAutotileAsset, listAssets, weightedIndependentTileIndex } from '@/game/assetlib'
import {
  applyCombatLoadout, applyPlayerUnitCombatLoadout, BEAM_FADE, buildModule, canPlaceModule, combatLoadoutChangeCost, completeEventAssembly, defenseWaveCountdown, defOf, demolishAt, demolishModule, dirX, dirY,
  currentUnitAltitude, enginePerformanceSnapshot, fortressAssemblyAllowed, fortressDef, fortressInAssemblyZone, fortressLocalCenter, fortressRect, fortressSupplyStatus, hardpointWorldPos, initialState, interactWithObjectAt, interactWithUnitAt, isTerminalPhase, moduleCells, moduleDefOf, moduleFoot, mountTurret,
  moduleBonuses, playerTeamCanSeePoint, playerTurretResourceCaps, playerUnitAssemblyTargetAt, playerUnitCombatLoadout, playerUnitLoadoutChangeCost, playerUnitResourceDetails, pointInsideUnitShape, primaryObjectiveStatus, resolveEventChoice, rotorcraftMovementAudioGain, settlementObjectiveStatuses, setTurretAutoFire, tick, upgradeTurret, fortressInteriorSet, worldToFortressInteriorLocal,
} from '@/game/engine'
import type { GameState, Turret, UnitAircraftRuntime, UnitVehicleRuntime } from '@/game/engine'
import { activateLibraryLevel, BRUSH_DEFAULTS, completeActiveLevel, defaultLevel, defaultMissionBriefing, defaultSpawnRegions, defaultStage, deployableFortressIdsOf, emptyTriggerEnemies, equipmentUnlockId, hasLevelMedal, invalidateWallInfo, isEquipmentUnlocked, isLevelUnlocked, legacyEnemyUnitCounts, LEVEL, LEVEL_LIBRARY, levelLibraryForExport, loadLevelProgress, missionBriefingOf, objectiveFinishCells, saveLevelLibrary } from '@/game/level'
import type { EquipmentUnlockRef, LevelConfig, LevelEventAction, LevelLibrary, LevelMedalSlot, LevelObject, LevelObjectEvent, LevelPlacedUnitFaction, LevelStageTransition, LevelTaskStage, LevelTerrain, LevelUnitCommand, LevelUnitEvent, LevelUnitPlacement } from '@/game/level'
import { getSelectedFortressId, setSelectedFortressId } from '@/game/persist'
import { getSelectedVehicleLoadoutId, loadVehicleLoadouts, setSelectedVehicleLoadoutId } from '@/game/loadout'
import type { VehicleLoadoutPreset } from '@/game/loadout'
import { displayConfig, resolveDisplayViewport } from '@/game/displayConfig'
import { gameParameters } from '@/game/gameParameters'
import type { PerformanceMonitorOptions } from '@/game/gameParameters'
import { createPerformanceMonitorAccumulator, publishPerformanceMonitor, recordPerformanceFrame, resetPerformanceMonitorSnapshot } from '@/game/performanceMonitor'
import { clampViewX, clampViewY, draw, prewarmTurretRenderAssets, prewarmUnitRenderAssets, prewarmVehicleRenderAssets, unboundedCenteredView } from '@/game/render'
import type { UiHints } from '@/game/render'
import { enemyKindForUnit, enemyUnitId, fortressUnitId, playableVehicleDefs, runtimeEnemyUnitDef, unitCollisionRadii, unitDefById, unitFootprint, unitLibrary } from '@/game/unit'
import type { AIMovementProfile, AIPreferredTarget, AIPositioningProfile, UnitDef, UnitType } from '@/game/unit'
import { UNIT_LIBRARY_CHANGED_EVENT } from '@/game/unitEvents'
import {
  deleteObjectType, deleteTerrainType, isBuiltinObjectType, isBuiltinTerrainType,
  isObjectTypeOverridden, isTerrainTypeOverridden, newObjectType, newTerrainType,
  objectTypeById, objectTypeLibrary, restoreWorldTypeLibrary, saveObjectType, saveTerrainType, snapshotWorldTypeLibrary,
  terrainTypeById, terrainTypeLibrary, worldTypePersistFailed,
} from '@/game/worlddef'
import type { ObjectTypeDef, ObjectTypeEvent, TerrainTypeDef, WorldTypeLibrarySnapshot } from '@/game/worlddef'
import { emptyConditionGroup, eraseTileCellsInRect, fillTileCellsInRect, gridCellSelectionRect, levelCenterCell, pruneVisualLayersOutsideBounds, validateLevelReferences } from '@/game/levelEditor'
import type { LevelCellRect, LevelCondition, LevelConditionGroup, LevelEditorLayer, LevelTileCell, LevelValidationIssue, LevelVariableDef, UnifiedLevelEvent } from '@/game/levelEditor'

const loadDebugPanel = () => import('@/components/DebugPanel')
const loadEventMonitor = () => import('@/components/game/EventMonitor')
const DebugPanel = lazy(loadDebugPanel)
const EventMonitor = lazy(loadEventMonitor)
const MissionBriefing = lazy(() => import('@/components/MissionBriefing'))
const VehicleIndexPreview = lazy(() => import('@/components/MissionBriefing').then(module => ({ default: module.VehiclePreview })))
const MissionSettlement = lazy(() => import('@/components/MissionSettlement'))
const PreparationScreen = lazy(() => import('@/components/PreparationScreen'))

function formatResourceAmount(value: number): string {
  if (!Number.isFinite(value)) return '0'
  if (Number.isInteger(value)) return String(value)
  return value.toFixed(2).replace(/\.?0+$/, '')
}

function formatWaveCountdownTime(seconds: number): string {
  return String(Math.max(0, Math.ceil(Number.isFinite(seconds) ? seconds : 0)))
}

function combatUiAssetSrc(name: string): string | undefined {
  const exact = findAssetByName(name, 'ui')?.src
  if (exact) return exact
  // 结构标志需求名为 sigh_hp；兼容实际上传时容易沿用的 sign_hp，避免只因一字母差异回退。
  return name === 'sigh_hp' ? findAssetByName('sign_hp', 'ui')?.src : undefined
}

function CombatHudSign({ asset, label, fallback }: { asset: string; label: string; fallback: string }) {
  const src = combatUiAssetSrc(asset)
  return <span role="img" aria-label={label} className="combat-hud-sign flex shrink-0 items-center justify-center">
    {src
      ? <img src={src} alt="" draggable={false} className="pointer-events-none h-full w-full select-none object-contain" />
      : <span aria-hidden="true" className="font-comic text-[10px] font-black text-white [text-shadow:1px_1px_0_#1A1A18]">{fallback}</span>}
  </span>
}

function CombatHudHorizontalMeter({
  label, value, max, backgroundAsset, rateAsset, fallbackColor, compact = false,
}: {
  label: string
  value: number
  max: number
  backgroundAsset: string
  rateAsset: string
  fallbackColor: string
  compact?: boolean
}) {
  const percent = Math.max(0, Math.min(100, max > 0 ? value / max * 100 : 0))
  const background = combatUiAssetSrc(backgroundAsset)
  const rate = combatUiAssetSrc(rateAsset)
  return <div
    role="meter"
    aria-label={label}
    aria-valuemin={0}
    aria-valuemax={max}
    aria-valuenow={Math.max(0, value)}
    title={`${label} ${Math.ceil(value)}/${Math.ceil(max)}`}
    className={`combat-hud-horizontal-meter relative overflow-hidden ${compact ? 'is-compact' : ''}`}
  >
    {background
      ? <img src={background} alt="" draggable={false} className="pointer-events-none absolute inset-0 h-full w-full select-none object-fill" />
      : <span className="absolute inset-0 bg-black/35" />}
    {rate
      ? <img src={rate} alt="" draggable={false} className="pointer-events-none absolute inset-0 h-full w-full select-none object-fill" style={{ clipPath: `inset(0 ${100 - percent}% 0 0)` }} />
      : <span className="absolute inset-y-0 left-0" style={{ width: `${percent}%`, backgroundColor: fallbackColor }} />}
    {!compact ? <span className="absolute inset-0 flex items-center justify-center px-2 font-comic text-[clamp(10px,1.15vw,15px)] font-black italic text-white [text-shadow:-1px_-1px_0_#1A1A18,1px_-1px_0_#1A1A18,-1px_1px_0_#1A1A18,1px_1px_0_#1A1A18]">
      {Math.ceil(value)}/{Math.ceil(max)}
    </span> : null}
  </div>
}

function CombatHudVerticalMeter({ label, percent }: { label: string; percent: number }) {
  const bounded = Math.max(0, Math.min(100, percent))
  const background = combatUiAssetSrc('ammo_bg')
  const rate = combatUiAssetSrc('ammo_rate')
  return <div className="combat-hud-ammo-column flex shrink-0 flex-col items-center" title={`${label} ${Math.round(bounded)}%`}>
    <span className="combat-hud-ammo-percent font-comic font-black italic text-white [text-shadow:-1px_-1px_0_#1A1A18,1px_-1px_0_#1A1A18,-1px_1px_0_#1A1A18,1px_1px_0_#1A1A18]">{Math.round(bounded)}%</span>
    <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={bounded} className="combat-hud-ammo-meter relative overflow-hidden">
      {background
        ? <img src={background} alt="" draggable={false} className="pointer-events-none absolute inset-0 h-full w-full select-none object-fill" />
        : <span className="absolute inset-0 bg-black/40" />}
      {rate
        ? <img src={rate} alt="" draggable={false} className="pointer-events-none absolute inset-0 h-full w-full select-none object-fill" style={{ clipPath: `inset(${100 - bounded}% 0 0 0)` }} />
        : <span className="absolute inset-x-0 bottom-0 bg-[#F1D21A]" style={{ height: `${bounded}%` }} />}
    </div>
  </div>
}

function combatLoadoutOf(game: GameState): VehicleLoadoutPreset {
  return {
    id: `combat-${game.fortressDefId}`,
    name: `${fortressDef(game).name}·本场整备`,
    fortressDefId: game.fortressDefId,
    turrets: game.turrets.flatMap(turret => turret.hardpointId ? [{ hardpointId: turret.hardpointId, turretDefId: turret.defId }] : []),
    modules: game.modules.map(module => ({ defId: module.defId, x: module.x, y: module.y, rot: module.rot })),
  }
}

/** 光束循环声只在实际发射阶段存活；充能、末帧滞留和消退段都不属于播放态。 */
let combatAudioDefinitionSignature = ''
let combatAudioTurretsById = new Map<string, TurretDef>()
let combatAudioProjectilesById = new Map<string, (typeof PROJECTILE_ARTS)[number]>()

/** 编辑器会原地更新运行时定义数组；稳定签名变化时才重建索引。 */
function combatAudioDefinitions() {
  const signature = `${TURRET_DEFS.map(item => item.id).join('\u0001')}\u0002${PROJECTILE_ARTS.map(item => item.id).join('\u0001')}`
  if (signature !== combatAudioDefinitionSignature) {
    combatAudioDefinitionSignature = signature
    combatAudioTurretsById = new Map(TURRET_DEFS.map(item => [item.id, item]))
    combatAudioProjectilesById = new Map(PROJECTILE_ARTS.map(item => [item.id, item]))
  }
  return { turretsById: combatAudioTurretsById, projectilesById: combatAudioProjectilesById }
}

function latestAudioEventId(current: number, events: readonly { id: number }[]): number {
  let latest = current
  for (const event of events) if (event.id > latest) latest = event.id
  return latest
}

function activeBeamAudioLoopKeys(state: GameState, turretsById = combatAudioDefinitions().turretsById): Set<string> {
  const keys = new Set<string>()
  const turrets = [
    ...state.turrets,
    ...state.enemies.flatMap(enemy => enemy.vehicle?.turrets ?? []),
    ...state.allies.flatMap(ally => ally.vehicle?.turrets ?? []),
  ]
  for (const turret of turrets) {
    const def = turretsById.get(turret.defId)
    if (def?.type === 'beam' && turret.firing && turret.chargeLeft === 0) keys.add(`beam:${turret.id}`)
  }
  return keys
}

/** 任务介绍阶段预热本关会直接用到的单位、炮塔、弹丸与声音缓存。 */
function prewarmCombatResources(state: GameState): void {
  const unitIds = new Set<string>()
  for (const placed of LEVEL.initialUnits) unitIds.add(placed.unitDefId)
  for (const stage of LEVEL.stages) for (const wave of stage.waves) for (const entry of wave.entries) unitIds.add(entry.unitDefId)
  for (const trigger of LEVEL.triggers) for (const unitDefId of Object.keys(trigger.units ?? {})) unitIds.add(unitDefId)
  for (const enemy of state.enemies) if (enemy.unitDefId) unitIds.add(enemy.unitDefId)
  for (const ally of state.allies) if (ally.unitDefId) unitIds.add(ally.unitDefId)

  const units = [...unitIds].map(unitDefById).filter((unit): unit is UnitDef => !!unit)
  const turretIds = new Set(state.turrets.map(turret => turret.defId))
  for (const enemy of state.enemies) for (const turret of enemy.vehicle?.turrets ?? []) turretIds.add(turret.defId)
  for (const ally of state.allies) for (const turret of ally.vehicle?.turrets ?? []) turretIds.add(turret.defId)
  const playerVehicle = fortressDef(state)
  for (const hardpoint of playerVehicle.hardpoints) if (hardpoint.builtIn) turretIds.add(hardpoint.builtIn)
  for (const unit of units) {
    prewarmUnitRenderAssets(unit)
    const vehicle = unit.legacy?.registry === 'fortress' ? unit.legacy.def : unit.vehiclePlatform
    for (const hardpoint of vehicle?.hardpoints ?? []) if (hardpoint.builtIn) turretIds.add(hardpoint.builtIn)
  }
  prewarmVehicleRenderAssets(playerVehicle)
  const { turretsById, projectilesById } = combatAudioDefinitions()
  const turrets = [...turretIds].map(id => turretsById.get(id)).filter((turret): turret is TurretDef => !!turret)
  for (const turret of turrets) prewarmTurretRenderAssets(turret)

  const presetIds = new Set<string | undefined>(Object.values(audioProjectConfig().cues))
  presetIds.add(MECH_FOOTSTEP_PRESET_ID)
  for (const value of Object.values(playerVehicle.sounds ?? {})) presetIds.add(value)
  for (const unit of units) for (const value of Object.values(unit.sounds ?? {})) presetIds.add(value)
  for (const turret of turrets) {
    for (const value of Object.values(turret.sounds ?? {})) presetIds.add(value)
    const projectile = projectilesById.get(turret.art?.projectile ?? '')
    for (const value of Object.values(projectile?.sounds ?? {})) presetIds.add(value)
  }
  void prewarmSoundPresets(presetIds, [LEVEL.bgm])
}

function DeferredOverlay({ label }: { label: string }) {
  return (
    <div className="absolute inset-0 z-[100] flex items-center justify-center bg-[#D8CFB8] font-comic text-sm font-black">
      {label}
    </div>
  )
}

function equipmentRewardOptions(): { ref: EquipmentUnlockRef; name: string }[] {
  return [
    ...playableVehicleDefs().map(def => ({ ref: { kind: 'fortress' as const, id: def.id }, name: def.name })),
    ...TURRET_DEFS.map(def => ({ ref: { kind: 'turret' as const, id: def.id }, name: def.name })),
    ...MODULE_DEFS.map(def => ({ ref: { kind: 'module' as const, id: def.id }, name: def.name })),
    ...filterAssets('decal').map(asset => ({ ref: { kind: 'emblem' as const, id: asset.id }, name: asset.name })),
  ]
}

function availableMissionFortresses(entry: LevelLibrary['levels'][number] | undefined, progress: ReturnType<typeof loadLevelProgress>) {
  const vehicles = playableVehicleDefs()
  const allowed = deployableFortressIdsOf(entry, vehicles.map(def => def.id))
  return vehicles.filter(def => allowed.includes(def.id) && isEquipmentUnlocked(progress, { kind: 'fortress', id: def.id }, LEVEL_LIBRARY))
}

function loadoutEquipmentUnlocked(preset: VehicleLoadoutPreset, progress: ReturnType<typeof loadLevelProgress>) {
  return preset.turrets.every(item => isEquipmentUnlocked(progress, { kind: 'turret', id: item.turretDefId }, LEVEL_LIBRARY))
    && preset.modules.every(item => isEquipmentUnlocked(progress, { kind: 'module', id: item.defId }, LEVEL_LIBRARY))
}

function availableMissionLoadouts(entry: LevelLibrary['levels'][number] | undefined, progress: ReturnType<typeof loadLevelProgress>) {
  const availableFortressIds = new Set(availableMissionFortresses(entry, progress).map(def => def.id))
  return loadVehicleLoadouts().filter(preset => availableFortressIds.has(preset.fortressDefId) && loadoutEquipmentUnlocked(preset, progress))
}

const MAX_COMBAT_FRAME_DT = 0.05 // 页面卡顿/恢复时单次最多推进 50ms，避免物理穿透与计时跳跃
const MIN_COMBAT_FRAME_DT = 1 / 120 // 高刷屏最多按 120Hz 推进，累积真实经过时间而非固定逻辑帧
const REACT_COMBAT_UPDATE_INTERVAL = 1 / 30 // Canvas/逻辑保持高频；HUD 最多 30Hz，避免整棵 GamePreview 随 120Hz 重渲染
const AUDIO_LOOP_SYNC_INTERVAL_MS = 100 // 循环声维护读取 gameRef，10Hz 足够连续且不再跟随整棵 React 战斗树刷新
/** 履带与轮式载具的移动循环声统一使用同一段渐入渐出时间。 */
const VEHICLE_MOVE_FADE_TIME = 0.35
// One Euro 参数：α=1/(1+τ/dt), τ=1/(2πf)。基础截止频率滤手抖（小幅低速），β 按角速度自适应放开截止（快速甩动不迟钝）
const OE_MIN_CUTOFF = 1.2 // Hz：静止/慢速时的截止频率
const OE_BETA = 1.0 // 速率自适应系数：截止 += β×|角速度|(rad/s)
const OE_D_CUTOFF = 1.0 // Hz：导数通道截止频率
const FILTER_SNAP = (1.5 * Math.PI) / 180 // 滤波后微吸正阈值 1.5°（EMA 只能逼近不能到达，补足「回正=严格直行」）

function playerCenteredCamera(state: GameState, cell: number, canvasW: number, canvasH: number) {
  const player = fortressRect(state)
  return unboundedCenteredView(player.x + player.w / 2, player.y + player.h / 2, cell, canvasW, canvasH)
}

/** 堡垒防御整备的手动镜头边界；战场小于视口时仍允许在两侧黑边之间拖动。 */
function clampBattlePreparationView(position: number, worldCells: number, cell: number, canvasSize: number): number {
  const edge = worldCells - canvasSize / cell
  return Math.max(Math.min(0, edge), Math.min(Math.max(0, edge), position))
}

type Mode =
  | { kind: 'none' }
  | { kind: 'turret'; defId: string } // 挂炮模式：点堡垒上匹配的空闲炮位挂载
  | { kind: 'demolish' }

const TYPE_ICON: Record<string, typeof Crosshair> = {
  direct: Crosshair,
  lob: Bomb,
  missile: Rocket,
  beam: Zap,
  spray: Flame,
}

function cardIcon(def: TurretDef) {
  return TYPE_ICON[def.type] ?? Crosshair
}

function previewLevel(level: LevelConfig) {
  for (const k of Object.keys(LEVEL)) delete (LEVEL as unknown as Record<string, unknown>)[k]
  Object.assign(LEVEL, structuredClone(level))
  invalidateWallInfo()
}

function nextLibraryLevelId(library: LevelLibrary): string {
  const used = new Set(library.levels.map(x => x.id))
  let n = 1
  while (used.has(`level-${n}`)) n++
  return `level-${n}`
}

type Brush =
  | 'puddle' | 'barrel' | 'ruins' | 'rock' | 'buildzone' | 'ground' | 'baseTile' | 'overlayTile' | 'fill'
  | 'start' | 'finish' | 'spawnRegion' | 'spawnRegionErase' | 'trigger' | 'route' | 'unit' | 'eraser' | 'move'

/** 连续铺设型笔刷（按住拖动）；其余为单击放置 */
const PAINT_BRUSHES = new Set<Brush>(['puddle', 'barrel', 'ruins', 'rock', 'buildzone', 'ground', 'baseTile', 'overlayTile', 'finish', 'spawnRegion', 'spawnRegionErase', 'trigger', 'eraser'])

/** 移动笔刷取出的元素（已从 draft 删除，幽灵跟随指针，放下/取消时回插） */
type Picked = (
  | { kind: 'terrain'; w: number; h: number; idx: number; data: LevelTerrain }
  | { kind: 'object'; w: number; h: number; idx: number; data: LevelObject }
  | { kind: 'unit'; w: number; h: number; idx: number; data: LevelUnitPlacement }
) & { ghostOrigin?: 'move' | 'paste' }

/** 多对象连续黏贴幽灵；anchor 是复制组左上包围盒坐标。 */
interface PickedGroup {
  items: Picked[]
  anchorX: number
  anchorY: number
  ghostOrigin: 'paste'
}

/** 任务页中可直接在战场画布拖拽的堡垒防御空间配置。 */
type FortressEditorPlacementTarget =
  | { stageId: string; kind: 'fortress' }
  | { stageId: string; kind: 'return' }

interface EditorPointerGesture {
  startX: number
  startY: number
  startViewX: number
  startViewY: number
  moved: boolean
  painting: boolean
  panOnly: boolean
  historyRecorded: boolean
  /** 指针来源用于区分移动端摇杆与 PC 鼠标拖动。 */
  pointerType: string
  lastPaintKey?: string
  selectionCandidate?: Picked
  ghostStarted?: boolean
  holdTimer?: number
  /** 选择工具从空白处拖动时绘制多选框。 */
  marqueeStart?: { x: number; y: number }
  /** 任务页堡垒与返回点的直接拖拽。 */
  fortressPlacement?: { target: FortressEditorPlacementTarget; offsetX: number; offsetY: number }
}

interface LevelEditState {
  draft: LevelConfig
  levelId: string
  library: LevelLibrary
  playLevel: LevelConfig
  brush: Brush
  picked: Picked | null
  /** 两个及以上对象复制后使用的整组黏贴幽灵。 */
  pickedGroup?: PickedGroup | null
  /** 仅选中并定位检查器；实体仍留在 draft 中，不等同于移动幽灵。 */
  selected?: Picked | null
  /** 框选结果。点击列表只改变 focused selected，不会丢失整组选择。 */
  selectedGroup?: Picked[]
}

function placedUnitFootprint(unit: LevelUnitPlacement): { w: number; h: number; blocksMovement?: boolean } {
  const def = unitDefById(unit.unitDefId)
  const foot = def ? unitFootprint(def) : { w: 1, h: 1 }
  return unit.rotation === 90 || unit.rotation === 270
    ? { ...foot, w: foot.h, h: foot.w }
    : foot
}

interface EditorHistorySnapshot {
  library: LevelLibrary
  levelId: string
  worldTypes: WorldTypeLibrarySnapshot
}

type EditorInspectorTab = 'tiles' | 'terrain' | 'object' | 'units' | 'events' | 'mission'
const EDITOR_TAB_NAME: Record<EditorInspectorTab, string> = { tiles: '图块', terrain: '地形', object: '物体', units: '单位', events: '事件', mission: '任务' }


const UNIT_TYPE_NAME: Record<UnitType, string> = {
  vehicle: '载具', rotorcraft: '旋翼飞行器', fixedWingAircraft: '固定翼飞行器', building: '建筑',
}

const EVENT_BUILTIN_CONDITIONS = [
  { id: 'builtin:missionWon', label: '任务胜利', operator: 'eq', value: true },
  { id: 'builtin:fortressHpPercent', label: '玩家战车结构值', operator: 'gte', value: 50 },
  { id: 'builtin:enemyVehicleAlive', label: '敌方载具存活数', operator: 'eq', value: 0 },
  { id: 'builtin:kills', label: '击杀数', operator: 'gte', value: 1 },
  { id: 'builtin:wave', label: '当前波次', operator: 'gte', value: 1 },
  { id: 'builtin:time', label: '任务时间', operator: 'gte', value: 60 },
] as const

function objectStateOptions(object: LevelObject | undefined, current?: string): string[] {
  const values = [object?.state, ...(objectTypeById(object?.defId)?.states ?? ['default']), current]
    .map(value => String(value ?? '').trim())
    .filter(Boolean)
  return [...new Set(values.length > 0 ? values : ['default'])]
}

interface PlacedObjectGroup {
  ids: number[]
  objects: Array<LevelObject & { id: number }>
  name: string
  autotile: boolean
}

/** Autotile 物体按同定义、同显示层级的四方向连通区域视作一个对象。 */
function groupPlacedObjects(objects: LevelObject[]): PlacedObjectGroup[] {
  const entries = objects.map((object, index) => ({ ...object, id: object.id ?? 2000 + index }))
  const remaining = new Set(entries.map(entry => entry.id))
  const groups: PlacedObjectGroup[] = []
  for (const entry of entries) {
    if (!remaining.delete(entry.id)) continue
    const def = objectTypeById(entry.defId)
    const autotile = !!def && isAutotileAsset(def.asset)
    const members = [entry]
    if (autotile) {
      for (let cursor = 0; cursor < members.length; cursor++) {
        const current = members[cursor]
        for (const candidate of entries) {
          if (!remaining.has(candidate.id) || candidate.defId !== entry.defId || (candidate.renderLayer ?? 3) !== (entry.renderLayer ?? 3)) continue
          if (Math.abs(candidate.x - current.x) + Math.abs(candidate.y - current.y) !== 1) continue
          remaining.delete(candidate.id)
          members.push(candidate)
        }
      }
    }
    groups.push({ ids: members.map(member => member.id), objects: members, name: def?.name ?? entry.kind, autotile })
  }
  return groups
}

function objectGroupLabel(group: PlacedObjectGroup): string {
  return `${group.name} #${group.ids[0]}${group.autotile && group.ids.length > 1 ? `（连续 ${group.ids.length} 格）` : ''}`
}

function EventConditionEditor({ conditions, level, globalVariables, onChange, ariaPrefix = '', conditionTitle = '触发条件' }: {
  conditions: LevelConditionGroup
  level: Pick<LevelConfig, 'initialUnits' | 'objects' | 'variables'>
  globalVariables: LevelVariableDef[]
  onChange: (conditions: LevelConditionGroup) => void
  ariaPrefix?: string
  conditionTitle?: string
}) {
  const placedObjects = level.objects.filter(object => object.id !== undefined) as Array<LevelObject & { id: number }>
  const placedObjectGroups = groupPlacedObjects(placedObjects)
  const label = (name: string) => `${ariaPrefix}${name}`
  const createCondition = (kind: string): LevelCondition => {
    if (kind === 'unit') return { kind: 'unit', unitPlacementId: level.initialUnits[0]?.id ?? 1, state: 'alive' }
    if (kind === 'object') return { kind: 'object', objectId: placedObjects[0]?.id ?? 1, state: 'intact' }
    if (kind === 'objectState') { const object = placedObjectGroups[0]?.objects[0]; return { kind: 'objectState', objectId: object?.id ?? 1, operator: 'eq', state: objectStateOptions(object)[0] } }
    if (kind === 'globalVariable') { const variable = globalVariables[0]; return { kind: 'variable', variableId: variable?.id ?? '', operator: 'eq', value: 0 } }
    if (kind === 'variable') { const variable = level.variables[0]; return { kind: 'variable', variableId: variable?.id ?? '', operator: 'eq', value: 0 } }
    const builtin = EVENT_BUILTIN_CONDITIONS.find(option => option.id === kind) ?? EVENT_BUILTIN_CONDITIONS[0]
    return { kind: 'variable', variableId: builtin.id, operator: builtin.operator, value: builtin.value }
  }
  const replaceAt = (index: number, condition: LevelCondition) => onChange({ ...conditions, conditions: conditions.conditions.map((item, itemIndex) => itemIndex === index ? condition : item) })
  return <div className="border border-black/25 p-1 space-y-1">
    <div className="flex items-center gap-1"><span className="text-[8px] font-black">{conditionTitle}</span>{conditions.conditions.length > 1 && <select aria-label={label('条件组合方式')} className="ml-auto px-1 border border-black bg-[#EFEBD8] text-[8px]" value={conditions.mode} onChange={event => onChange({ ...conditions, mode: event.target.value === 'any' ? 'any' : 'all' })}><option value="all">全部满足</option><option value="any">任一满足</option></select>}<button type="button" className={`${conditions.conditions.length > 1 ? '' : 'ml-auto '}comic-btn px-1 py-0 text-[8px]`} onClick={() => onChange({ ...conditions, conditions: [...conditions.conditions, createCondition('unit')] })}>＋条件</button></div>
    {conditions.conditions.length === 0 ? <div className="text-[8px] font-bold text-black/40">暂无条件</div> : conditions.conditions.map((condition, index) => {
      const builtin = condition.kind !== 'unit' && condition.kind !== 'object' && condition.kind !== 'objectState' ? EVENT_BUILTIN_CONDITIONS.find(item => item.id === condition.variableId) : undefined
      const kind = condition.kind === 'unit' ? 'unit' : condition.kind === 'object' ? 'object' : condition.kind === 'objectState' ? 'objectState' : builtin?.id ?? (condition.variableId.startsWith('global:') ? 'globalVariable' : 'variable')
      const variableCondition = condition.kind !== 'unit' && condition.kind !== 'object' && condition.kind !== 'objectState' ? condition : createCondition('variable') as Extract<LevelCondition, { kind?: 'variable' }>
      return <div key={index} className="border border-black/20 bg-[#EFEBD8]/35 p-1 space-y-1">
        <div className="flex gap-1"><span className="w-4 text-center text-[8px] font-black">{index + 1}</span><select aria-label={label(`条件${index + 1}类型`)} className="flex-1 min-w-0 px-1 border border-black bg-[#EFEBD8] text-[8px]" value={kind} onChange={event => replaceAt(index, createCondition(event.target.value))}><option value="unit">单位存亡</option><option value="object">物体存亡</option><option value="objectState">物体状态</option>{EVENT_BUILTIN_CONDITIONS.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}<option value="variable">关卡变量</option><option value="globalVariable">全局变量</option></select><button type="button" aria-label={label(`删除条件${index + 1}`)} className="comic-btn px-1 py-0 text-[8px]" onClick={() => onChange({ ...conditions, conditions: conditions.conditions.filter((_, itemIndex) => itemIndex !== index) })}>×</button></div>
        {condition.kind === 'unit' && <div className="grid grid-cols-[1fr_72px] gap-1"><select className="min-w-0 px-1 text-[8px] border border-black bg-[#EFEBD8]" value={condition.unitPlacementId} onChange={event => replaceAt(index, { ...condition, unitPlacementId: Number(event.target.value) })}>{level.initialUnits.length === 0 ? <option value={1}>暂无单位</option> : level.initialUnits.map(unit => <option key={unit.id} value={unit.id}>{unitDefById(unit.unitDefId)?.name ?? unit.unitDefId} #{unit.id}</option>)}</select><select className="px-1 text-[8px] border border-black bg-[#EFEBD8]" value={condition.state} onChange={event => replaceAt(index, { ...condition, state: event.target.value as 'dead' | 'alive' })}><option value="dead">死亡</option><option value="alive">存活</option></select></div>}
        {condition.kind === 'object' && <div className="grid grid-cols-[1fr_72px] gap-1"><select className="min-w-0 px-1 text-[8px] border border-black bg-[#EFEBD8]" value={condition.objectId} onChange={event => replaceAt(index, { ...condition, objectId: Number(event.target.value) })}>{placedObjects.length === 0 ? <option value={1}>暂无物体</option> : placedObjects.map(object => <option key={object.id} value={object.id}>{objectTypeById(object.defId)?.name ?? object.kind} #{object.id}</option>)}</select><select className="px-1 text-[8px] border border-black bg-[#EFEBD8]" value={condition.state} onChange={event => replaceAt(index, { ...condition, state: event.target.value as 'destroyed' | 'intact' })}><option value="destroyed">摧毁</option><option value="intact">未摧毁</option></select></div>}
        {condition.kind === 'objectState' && (() => { const group = placedObjectGroups.find(item => item.ids.includes(condition.objectId)); const object = group?.objects[0] ?? placedObjects.find(item => item.id === condition.objectId); return <div className="grid grid-cols-[1fr_52px_1fr] gap-1"><select className="min-w-0 px-1 text-[8px] border border-black bg-[#EFEBD8]" value={group?.ids[0] ?? condition.objectId} onChange={event => { const objectId = Number(event.target.value); const nextObject = placedObjectGroups.find(item => item.ids[0] === objectId)?.objects[0]; replaceAt(index, { ...condition, objectId, state: objectStateOptions(nextObject)[0] }) }}>{placedObjectGroups.length === 0 ? <option value={condition.objectId}>暂无物体</option> : <>{!group && <option value={condition.objectId}>目标物体已删除 #{condition.objectId}</option>}{placedObjectGroups.map(item => <option key={item.ids.join(',')} value={item.ids[0]}>{objectGroupLabel(item)}</option>)}</>}</select><select className="px-1 text-[8px] border border-black bg-[#EFEBD8]" value={condition.operator} onChange={event => replaceAt(index, { ...condition, operator: event.target.value === 'ne' ? 'ne' : 'eq' })}><option value="eq">等于</option><option value="ne">不等于</option></select><select className="min-w-0 px-1 text-[8px] border border-black bg-[#EFEBD8]" value={condition.state} onChange={event => replaceAt(index, { ...condition, state: event.target.value })}>{objectStateOptions(object, condition.state).map(state => <option key={state}>{state}</option>)}</select></div> })()}
        {condition.kind !== 'unit' && condition.kind !== 'object' && condition.kind !== 'objectState' && (() => { const selectable = kind === 'variable' || kind === 'globalVariable'; const custom = kind === 'globalVariable' ? globalVariables : level.variables; const customVariable = selectable; return <div className={`grid gap-1 ${selectable ? 'grid-cols-[1fr_58px_64px]' : 'grid-cols-[58px_64px]'}`}>{selectable && <select className="min-w-0 px-1 text-[8px] border border-black bg-[#EFEBD8]" value={variableCondition.variableId} onChange={event => replaceAt(index, { ...variableCondition, variableId: event.target.value, value: 0 })}>{custom.length === 0 ? <option value="">暂无变量</option> : custom.map(variable => <option key={variable.id} value={variable.id}>{variable.name}</option>)}</select>}<select className="px-1 text-[8px] border border-black bg-[#EFEBD8]" value={variableCondition.operator} onChange={event => replaceAt(index, { ...variableCondition, operator: event.target.value as typeof variableCondition.operator })}><option value="eq">等于</option><option value="ne">不等于</option><option value="gt">大于</option><option value="gte">不小于</option><option value="lt">小于</option><option value="lte">不大于</option></select>{!customVariable && typeof variableCondition.value === 'boolean' ? <select className="px-1 text-[8px] border border-black bg-[#EFEBD8]" value={variableCondition.value ? 'true' : 'false'} onChange={event => replaceAt(index, { ...variableCondition, value: event.target.value === 'true' })}><option value="true">是</option><option value="false">否</option></select> : <ValidatedNumberInput className="min-w-0 px-1 text-[8px] border border-black bg-[#EFEBD8]" value={Number(variableCondition.value)} onChange={event => replaceAt(index, { ...variableCondition, value: Number(event.target.value) || 0 })} />}</div> })()}
      </div>
    })}
  </div>
}

function MissionGoalTextEditor({ label, text, onTextChange }: {
  label: string
  text: string
  onTextChange: (text: string) => void
}) {
  return <div className="border border-black/25 p-1">
    <label className="block text-[8px] font-black">{label}<input aria-label={`${label}说明`} className="w-full px-1 py-0.5 text-[8px] border border-black bg-[#EFEBD8]" value={text} onChange={event => onTextChange(event.target.value.slice(0, 120))} /></label>
  </div>
}

function unitIndexAsset(def: UnitDef) {
  const ref = def.visual?.bodyAsset ?? (def.legacy?.registry === 'fortress' ? def.legacy.def.spriteBody : undefined)
  return ref ? { ref, asset: getAsset(ref), src: getAsset(ref)?.src ?? ref } : null
}

function unitVehiclePlatform(def: UnitDef): FortressDef | null {
  if (def.vehiclePlatform) return def.vehiclePlatform
  return def.legacy?.registry === 'fortress' ? def.legacy.def : null
}

/**
 * 关卡编辑器的单位索引只负责缩放；图像内容与单位编辑器的外观预览保持同一口径。
 * 载具/飞行平台复用完整组合预览，普通单位则显示单位编辑器默认的移动帧。
 */
function LevelUnitIndexPreview({ unit }: { unit: UnitDef }) {
  const platform = unitVehiclePlatform(unit)
  const visual = unitIndexAsset(unit)
  if (platform) {
    const fallback = visual
      ? <img src={visual.src} alt="" className="h-full w-full object-contain [image-rendering:pixelated]" />
      : <span className="flex h-full w-full items-center justify-center text-[7px] font-black text-black/45">{UNIT_TYPE_NAME[unit.type].slice(0, 1)}</span>
    return <Suspense fallback={fallback}><VehicleIndexPreview def={platform} /></Suspense>
  }
  if (!visual) return <span className="flex h-full w-full items-center justify-center text-[7px] font-black text-black/45">{UNIT_TYPE_NAME[unit.type].slice(0, 1)}</span>
  const sheet = visual.asset?.spriteSheet
  if (!sheet) return <img src={visual.src} alt="" className="h-full w-full object-contain [image-rendering:pixelated]" />
  const frameIndex = sheet.stateFrames.walk ?? 0
  const frameCount = Math.max(1, ...Object.values(sheet.stateFrames).map(frame => frame + 1))
  const scale = Math.min(30 / sheet.frameWidth, 44 / sheet.frameHeight)
  return <img src={visual.src} alt="" className="absolute top-1/2 max-w-none [image-rendering:pixelated]" style={{ left: `calc(50% - ${(frameIndex + 0.5) * sheet.frameWidth * scale}px)`, width: sheet.frameWidth * frameCount * scale, height: sheet.frameHeight * scale, transform: 'translateY(-50%)' }} />
}

type ActionKind = LevelEventAction['type']
type MoveCommand = Extract<LevelUnitCommand, { kind: 'move' }>
type AltitudeCommand = Extract<LevelUnitCommand, { kind: 'altitude' }>
type HoldCommand = Extract<LevelUnitCommand, { kind: 'hold' }>
type AttackCommand = Extract<LevelUnitCommand, { kind: 'attack' }>
type AICommand = Extract<LevelUnitCommand, { kind: 'ai' }>
type BehaviorCommand = Extract<LevelUnitCommand, { kind: 'behavior' }>
type FactionCommand = Extract<LevelUnitCommand, { kind: 'faction' }>
type UnitCommandKind = LevelUnitCommand['kind']
const patchMoveCommand = (command: LevelUnitCommand, next: Partial<MoveCommand>): MoveCommand => ({ ...(command.kind === 'move' ? command : { kind: 'move' as const, x: 0, y: 0, speed: 1, wait: true }), ...next })
const patchAltitudeCommand = (command: LevelUnitCommand, next: Partial<AltitudeCommand>): AltitudeCommand => ({ ...(command.kind === 'altitude' ? command : { kind: 'altitude' as const, altitude: 1, wait: true }), ...next })
const patchHoldCommand = (command: LevelUnitCommand, next: Partial<HoldCommand>): HoldCommand => ({ ...(command.kind === 'hold' ? command : { kind: 'hold' as const, seconds: 1, wait: true }), ...next })
const patchAttackCommand = (command: LevelUnitCommand, next: Partial<AttackCommand>): AttackCommand => ({ ...(command.kind === 'attack' ? command : { kind: 'attack' as const, target: { type: 'player' as const }, seconds: 1, wait: true }), ...next })
const patchAICommand = (command: LevelUnitCommand, next: Partial<AICommand>): AICommand => ({ ...(command.kind === 'ai' ? command : { kind: 'ai' as const, mode: 'restore' as const }), ...next })
const AI_TARGET_OPTIONS: Array<[AIPreferredTarget, string]> = [['playerControlled', '玩家主控单位'], ['playerFaction', '玩家阵营'], ['allHostile', '所有敌对（不含中立敌对）']]
const AI_POSITION_OPTIONS: Array<[AIPositioningProfile, string]> = [['longestRange', '最远射程'], ['optimalRange', '最优射程'], ['shortestRange', '最近射程']]
const AI_MOVEMENT_OPTIONS: Array<[AIMovementProfile, string]> = [['orbit', '环绕'], ['keepFar', '远离'], ['closeIn', '抵近'], ['stop', '停止'], ['ram', '撞击']]
const patchBehaviorCommand = (command: LevelUnitCommand, next: Partial<BehaviorCommand>): BehaviorCommand => ({ ...(command.kind === 'behavior' ? command : { kind: 'behavior' as const, behavior: 'restore' as const, range: 0, interval: 0, speedPercent: 100 }), ...next })
const patchFactionCommand = (command: LevelUnitCommand, next: Partial<FactionCommand>): FactionCommand => ({ ...(command.kind === 'faction' ? command : { kind: 'faction' as const, faction: 'ally' as const }), ...next })
const UNIT_COMMAND_NAMES: Record<UnitCommandKind, string> = { move: '移动单位', altitude: '飞行高度', hold: '单位停留', attack: '单位攻击', ai: 'AI 控制', remove: '移除单位', behavior: '变更行为', faction: '切换阵营' }
const ACTION_NAMES: Record<ActionKind, string> = {
  dialogue: '对话', text: '画面文本', wait: '等待', camera: '镜头转移', choice: '选择', assembly: '装配', unit: '单位指令',
  spawn: '刷出敌群', boss: 'Boss', message: '任务提示', sound: '播放音效', music: '切换 BGM', reward: '资源奖励',
  levelVariable: '关卡变量', globalVariable: '全局变量', setEventEnabled: '启用/禁用事件',
  callEvent: '调用事件',
  setObjectState: '物体状态', supply: '增减补给', functionalArea: '功能区域', stageJump: '任务阶段跳转', taskResult: '任务结果',
}

function actionDisplayName(action: LevelEventAction): string {
  return action.type === 'unit' ? UNIT_COMMAND_NAMES[action.command.kind] : ACTION_NAMES[action.type]
}

type EventSourceKind = 'none' | 'unit' | 'object'

function defaultUnitAction(kind: UnitCommandKind, level?: LevelConfig, sourceKind: EventSourceKind = 'none'): Extract<LevelEventAction, { type: 'unit' }> {
  const selector = sourceKind === 'unit'
    ? { scope: 'source' as const }
    : level?.initialUnits[0] ? { scope: 'placement' as const, placementId: level.initialUnits[0].id } : { scope: 'allEnemies' as const }
  if (kind === 'move') return { type: 'unit', selector, command: { kind, x: 10, y: 10, speed: 2, wait: true } }
  if (kind === 'altitude') return { type: 'unit', selector, command: { kind, altitude: 1, wait: true } }
  if (kind === 'hold') return { type: 'unit', selector, command: { kind, seconds: 1, wait: true } }
  if (kind === 'attack') return { type: 'unit', selector, command: { kind, target: { type: 'player' }, seconds: 3, wait: true } }
  if (kind === 'ai') return { type: 'unit', selector, command: { kind, mode: 'pause' } }
  if (kind === 'behavior') return { type: 'unit', selector, command: { kind, behavior: 'restore', range: 0, interval: 0, speedPercent: 100 } }
  if (kind === 'faction') return { type: 'unit', selector: level?.initialUnits[0] ? { scope: 'placement', placementId: level.initialUnits[0].id } : { scope: 'group', group: '' }, command: { kind, faction: 'ally' } }
  return { type: 'unit', selector, command: { kind: 'remove' } }
}

function defaultAction(type: ActionKind, level?: LevelConfig, sourceKind: EventSourceKind = 'none'): LevelEventAction {
  if (type === 'wait') return { type, seconds: 1 }
  if (type === 'dialogue') return { type, speaker: '通讯', text: '输入对话内容', duration: 3, wait: true }
  if (type === 'text') return { type, text: '输入画面文本', duration: 3, position: 'center', wait: true }
  if (type === 'camera') return { type, x: Math.round((level?.cols ?? 20) / 2), y: Math.round((level?.rows ?? 20) / 2), duration: 1, hold: 1, wait: true, returnToOrigin: false }
  if (type === 'choice') return { type, prompt: '请选择', options: [{ text: '选项 1', actions: [] }, { text: '选项 2', actions: [] }] }
  if (type === 'assembly') return { type }
  if (type === 'spawn') { const enemies = emptyTriggerEnemies(); enemies.walker = 4; return { type, enemies, units: legacyEnemyUnitCounts(enemies), interval: 0.35 } }
  if (type === 'boss') return { type, boss: { kind: 'brute', unitDefId: unitLibrary()[0]?.id ?? '', name: '荒原巨兽', hpScale: 8, sizeScale: 1.8, phases: [{ hpPercent: 50, actions: [{ type: 'message', text: 'Boss 进入狂暴阶段！', duration: 3 }] }], defeatActions: [] } }
  if (type === 'message') return { type, text: '新的任务已更新', duration: 3 }
  if (type === 'sound') return { type, presetId: '' }
  if (type === 'music') return { type, assetId: '', mode: 'override' }
  if (type === 'reward') return { type, gold: 100 }
  if (type === 'levelVariable') return { type, operation: 'set', variableId: '', value: 0 }
  if (type === 'globalVariable') return { type, operation: 'set', variableId: '', value: 0 }
  if (type === 'setEventEnabled') return { type, eventId: level?.events[0]?.id ?? 1, enabled: true }
  if (type === 'callEvent') return { type, eventId: level?.events[0]?.id ?? 1 }
  if (type === 'setObjectState') {
    if (sourceKind === 'object') return { type, objectId: 'source', state: 'default' }
    const object = level?.objects.find(item => item.id !== undefined)
    return { type, objectId: object?.id ?? 1, state: objectStateOptions(object)[0] }
  }
  if (type === 'supply') return { type, gold: 0, ammo: 20, energy: 20 }
  if (type === 'functionalArea') return { type, ammoEnabled: true, ammoPerSec: 10, energyEnabled: true, energyPerSec: 10, repairEnabled: false, structurePerSec: 10, armorPerSec: 10, assemblyEnabled: false }
  if (type === 'stageJump') return { type, stageId: level?.stages[0]?.id ?? '' }
  if (type === 'taskResult') return { type, target: 'primary', state: 'complete' }
  if (type === 'unit') return defaultUnitAction('move', level, sourceKind)
  return { type: 'wait', seconds: 1 }
}

function syncLegacyStageFields(level: LevelConfig): void {
  const start = level.stages.find(stage => stage.id === level.startStageId) ?? level.stages[0]
  if (!start) return
  level.startStageId = start.id
  level.objective = structuredClone(start.objective)
  level.mode = start.objective.type === 'reach' || start.objective.type === 'escort' || start.objective.type === 'destroy' ? 'advance' : 'defend'
}

function transitionValue(transition: LevelStageTransition): string {
  return transition.type === 'stage' ? `stage:${transition.stageId}` : transition.type
}

function transitionFromValue(value: string): LevelStageTransition {
  return value.startsWith('stage:') ? { type: 'stage', stageId: value.slice(6) } : value === 'win' ? { type: 'win' } : { type: 'lose' }
}

function StageFlowEditor({ level, selectedStageId, selectedWaveId, selectedSpawnRegionId, placementTarget, onPlacementTarget, onSelectStage, onSelectWave, onSelectSpawnRegion, onSetFinish, onDrawSpawnRegion, update }: {
  level: LevelConfig
  selectedStageId: string
  selectedWaveId: string
  selectedSpawnRegionId: number | null
  placementTarget: FortressEditorPlacementTarget | null
  onPlacementTarget: (target: FortressEditorPlacementTarget | null) => void
  onSelectStage: (id: string) => void
  onSelectWave: (id: string) => void
  onSelectSpawnRegion: (id: number | null) => void
  onSetFinish: () => void
  onDrawSpawnRegion: (erase: boolean) => void
  update: (fn: (draft: LevelConfig) => void) => void
}) {
  const stage = level.stages.find(item => item.id === selectedStageId) ?? level.stages.find(item => item.id === level.startStageId) ?? level.stages[0]
  if (!stage) return null
  const wave = stage.waves.find(item => item.id === selectedWaveId) ?? stage.waves[0]
  const enemyUnits = unitLibrary()
  const escortUnits = level.initialUnits.filter(unit => unit.faction !== 'enemy' && unit.faction !== 'neutral')
  const destroyUnits = level.initialUnits.filter(unit => unit.faction === 'enemy')
  const placedObjectGroups = (() => {
    const entries = level.objects.map((object, index) => ({ object, id: object.id ?? 2000 + index }))
    const remaining = new Set(entries.map(entry => entry.id))
    const groups: { ids: number[]; name: string; autotile: boolean }[] = []
    for (const entry of entries) {
      if (!remaining.delete(entry.id)) continue
      const def = objectTypeById(entry.object.defId)
      const autotile = !!def && isAutotileAsset(def.asset)
      const members = [entry]
      if (autotile) {
        for (let cursor = 0; cursor < members.length; cursor++) {
          const current = members[cursor]
          for (const candidate of entries) {
            if (!remaining.has(candidate.id) || candidate.object.defId !== entry.object.defId || (candidate.object.renderLayer ?? 3) !== (entry.object.renderLayer ?? 3)) continue
            if (Math.abs(candidate.object.x - current.object.x) + Math.abs(candidate.object.y - current.object.y) !== 1) continue
            remaining.delete(candidate.id); members.push(candidate)
          }
        }
      }
      groups.push({ ids: members.map(member => member.id), name: def?.name ?? entry.object.kind, autotile })
    }
    return groups
  })()
  const protectTarget = stage.objective.type === 'defend' && typeof stage.objective.protectTarget === 'object' ? stage.objective.protectTarget : null
  const patchStage = (fn: (next: LevelTaskStage, draft: LevelConfig) => void) => update(draft => {
    const next = draft.stages.find(item => item.id === stage.id)
    if (!next) return
    fn(next, draft)
    if (draft.startStageId === next.id) syncLegacyStageFields(draft)
  })
  const transitionSelect = (label: string, value: LevelStageTransition, set: (next: LevelStageTransition) => void) => <label className="text-[8px] font-bold">{label}<select className="w-full px-1 py-0.5 border border-black bg-[#EFEBD8]" value={transitionValue(value)} onChange={event => set(transitionFromValue(event.target.value))}><option value="win">整关胜利</option><option value="lose">整关失败</option>{level.stages.filter(item => item.id !== stage.id).map(item => <option key={item.id} value={`stage:${item.id}`}>进入：{item.name}</option>)}</select></label>
  return <div className="space-y-1.5">
    <div className="flex items-center gap-1"><span className="text-[9px] font-black text-black/45">任务阶段</span><span className="text-[8px] text-black/35">{level.stages.length}/50</span><button type="button" className="ml-auto comic-btn px-1.5 py-0 text-[8px]" onClick={() => update(draft => {
      let index = draft.stages.length + 1
      let id = `stage-${index}`
      while (draft.stages.some(item => item.id === id)) id = `stage-${++index}`
      const target = placedObjectGroups[0]
        ? { type: 'object' as const, objectIds: placedObjectGroups[0].ids }
        : draft.initialUnits[0] ? { type: 'unit' as const, unitPlacementId: draft.initialUnits[0].id } : undefined
      const next = defaultStage({ type: 'defend', waves: 1, waveWait: true, restTime: 10, overlapTime: 5, spawnRegions: defaultSpawnRegions(draft.rows, draft.cols), protectTarget: target })
      next.id = id; next.name = `任务阶段 ${index}`; next.waves[0].id = `${id}-wave-1`; next.waves[0].entries[0].id = `${id}-entry-1`
      draft.stages.push(next)
      onSelectStage(id); onSelectWave(next.waves[0].id); onSelectSpawnRegion(next.objective.type === 'defend' || next.objective.type === 'fortressDefense' ? next.objective.spawnRegions[0]?.id ?? null : null)
    })}>＋ 阶段</button></div>
    <div className="max-h-24 overflow-y-auto space-y-0.5">{level.stages.map((item, index) => <button key={item.id} type="button" className={`w-full px-1 py-0.5 border text-left flex items-center gap-1 ${item.id === stage.id ? 'border-[#B3392E] bg-[#B3392E]/10' : 'border-black/25'}`} onClick={() => { onSelectStage(item.id); onSelectWave(item.waves[0]?.id ?? '') }}><span className="text-[8px] font-black truncate">{index + 1}. {item.name}</span>{level.startStageId === item.id ? <span className="ml-auto text-[7px] border border-black px-1 bg-[#D9A441]">起始</span> : <span className="ml-auto text-[7px] text-black/40">{{ defend: '防守', fortressDefense: '堡垒防御', survive: '生存', reach: '抵达', escort: '护送', destroy: '摧毁' }[item.objective.type]}</span>}</button>)}</div>
    <div className="border-t border-black/25 pt-1 space-y-1">
      <div className="flex gap-1"><input aria-label="阶段名称" className="flex-1 min-w-0 px-1 py-0.5 text-[9px] border border-black bg-[#EFEBD8]" value={stage.name} onChange={event => patchStage(next => { next.name = event.target.value })} /><button type="button" className="comic-btn px-1 py-0 text-[7px]" disabled={level.startStageId === stage.id} onClick={() => update(draft => { draft.startStageId = stage.id; syncLegacyStageFields(draft) })}>设为起始</button><button type="button" className="comic-btn px-1 py-0 text-[7px]" disabled={level.stages.length <= 1} onClick={() => update(draft => {
        draft.stages = draft.stages.filter(item => item.id !== stage.id)
        for (const item of draft.stages) {
          if (item.success.type === 'stage' && item.success.stageId === stage.id) item.success = { type: 'win' }
          if (item.failure.type === 'stage' && item.failure.stageId === stage.id) item.failure = { type: 'lose' }
        }
        if (draft.startStageId === stage.id) draft.startStageId = draft.stages[0].id
        syncLegacyStageFields(draft); onSelectStage(draft.startStageId); onSelectWave(draft.stages[0].waves[0]?.id ?? '')
      })}>删除</button></div>
      <label className="text-[8px] font-bold">阶段类型<select aria-label="阶段类型" className="w-full px-1 py-0.5 border-2 border-black bg-[#EFEBD8]" value={stage.objective.type} onChange={event => patchStage((next, draft) => {
        const type = event.target.value
        if (type === 'survive') { next.objective = { type, duration: 180 }; next.waves = [] }
        else if (type === 'reach') { next.objective = { type, finishCells: [`${Math.floor(draft.finishZone.x)},${Math.floor(draft.finishZone.y)}`] }; next.waves = [] }
        else if (type === 'escort') { next.objective = { type, unitPlacementId: escortUnits[0]?.id ?? 1 }; next.waves = [] }
        else if (type === 'destroy') { next.objective = { type, unitPlacementIds: destroyUnits[0] ? [destroyUnits[0].id] : [] }; next.waves = [] }
        else if (type === 'fortressDefense') {
          const center = { x: draft.startZone.x + draft.startZone.w / 2, y: draft.startZone.y + draft.startZone.h / 2 }
          const replacement = defaultStage({ type, waves: 1, waveWait: true, restTime: 10, overlapTime: 5, spawnRegions: defaultSpawnRegions(draft.rows, draft.cols, ['top', 'right', 'bottom', 'left']), fortressDefId: playableVehicleDefs()[0]?.id ?? '', fortressPoint: center, returnPoint: center })
          next.objective = replacement.objective; next.waves = replacement.waves.map(item => ({ ...item, id: `${next.id}-wave-1`, entries: item.entries.map(entry => ({ ...entry, id: `${next.id}-entry-1` })) }))
        }
        else { const target = placedObjectGroups[0] ? { type: 'object' as const, objectIds: placedObjectGroups[0].ids } : draft.initialUnits[0] ? { type: 'unit' as const, unitPlacementId: draft.initialUnits[0].id } : undefined; const replacement = defaultStage({ type: 'defend', waves: 1, waveWait: true, restTime: 10, overlapTime: 5, spawnRegions: defaultSpawnRegions(draft.rows, draft.cols), protectTarget: target }); next.objective = replacement.objective; next.waves = replacement.waves.map(item => ({ ...item, id: `${next.id}-wave-1`, entries: item.entries.map(entry => ({ ...entry, id: `${next.id}-entry-1` })) })) }
        if (draft.startStageId === next.id) syncLegacyStageFields(draft)
        onSelectWave(next.waves[0]?.id ?? '')
        onSelectSpawnRegion(next.objective.type === 'defend' || next.objective.type === 'fortressDefense' ? next.objective.spawnRegions[0]?.id ?? null : null)
      })}><option value="defend">防守</option><option value="fortressDefense">堡垒防御</option><option value="survive">生存</option><option value="reach">抵达终点</option><option value="escort">护送单位</option><option value="destroy">摧毁目标</option></select></label>
      {stage.objective.type === 'survive' && <label className="text-[8px] font-bold">生存时间（秒）<ValidatedNumberInput min={10} max={3600} className="w-full px-1 border border-black bg-[#EFEBD8]" value={stage.objective.duration} onChange={event => patchStage(next => { if (next.objective.type === 'survive') next.objective.duration = Math.max(10, Number(event.target.value) || 10) })} /></label>}
      {stage.objective.type === 'reach' && <div className="flex items-center gap-1 border border-black/25 p-1"><span className="text-[8px] font-bold">终点区域：{objectiveFinishCells(stage.objective, level.finishZone, level.rows, level.cols).length} 格</span><button type="button" className="ml-auto comic-btn px-1.5 py-0 text-[8px]" onClick={onSetFinish}>铺设</button><button type="button" className="comic-btn px-1.5 py-0 text-[8px]" onClick={() => patchStage(next => { if (next.objective.type === 'reach') next.objective = { type: 'reach', finishCells: [] } })}>清空</button></div>}
      {stage.objective.type === 'escort' && <label className="text-[8px] font-bold">护送目标<select className="w-full px-1 border border-black bg-[#EFEBD8]" value={stage.objective.unitPlacementId} onChange={event => patchStage(next => { if (next.objective.type === 'escort') next.objective.unitPlacementId = Number(event.target.value) })}>{escortUnits.length === 0 ? <option value={1}>请先放置友方初始单位</option> : escortUnits.map(placed => <option key={placed.id} value={placed.id}>{unitDefById(placed.unitDefId)?.name ?? placed.unitDefId} #{placed.id}</option>)}</select></label>}
      {stage.objective.type === 'destroy' && <div className="border border-black/30 p-1 space-y-0.5"><div className="text-[8px] font-black">必须摧毁的敌方实例</div>{destroyUnits.length === 0 ? <div className="text-[7px] font-bold text-[#B3392E]">请先在场景中放置敌方单位</div> : destroyUnits.map(placed => <label key={placed.id} className="flex items-center gap-1 text-[8px] font-bold"><input type="checkbox" checked={stage.objective.type === 'destroy' && stage.objective.unitPlacementIds.includes(placed.id)} onChange={event => patchStage(next => { if (next.objective.type !== 'destroy') return; next.objective.unitPlacementIds = event.target.checked ? [...new Set([...next.objective.unitPlacementIds, placed.id])] : next.objective.unitPlacementIds.filter(id => id !== placed.id) })} /><span className="truncate">{unitDefById(placed.unitDefId)?.name ?? placed.unitDefId} #{placed.id}</span></label>)}</div>}
      {(stage.objective.type === 'defend' || stage.objective.type === 'fortressDefense') && <>
        {stage.objective.type === 'defend' && <div className="grid grid-cols-2 gap-1"><label className="text-[8px] font-bold">保护目标类型<select aria-label="保护目标类型" className="w-full px-1 border border-black bg-[#EFEBD8]" value={protectTarget?.type ?? ''} onChange={event => patchStage(next => { if (next.objective.type !== 'defend') return; next.objective.protectTarget = event.target.value === 'object' ? (placedObjectGroups[0] ? { type: 'object', objectIds: placedObjectGroups[0].ids } : undefined) : event.target.value === 'unit' ? (level.initialUnits[0] ? { type: 'unit', unitPlacementId: level.initialUnits[0].id } : undefined) : undefined })}><option value="">请选择</option><option value="object">物体</option><option value="unit">单位</option></select></label><label className="text-[8px] font-bold">具体目标<select aria-label="防守具体保护目标" className="w-full px-1 border border-black bg-[#EFEBD8]" disabled={!protectTarget} value={protectTarget?.type === 'object' ? protectTarget.objectIds.join(',') : protectTarget?.type === 'unit' ? protectTarget.unitPlacementId : ''} onChange={event => patchStage(next => { if (next.objective.type !== 'defend' || typeof next.objective.protectTarget !== 'object') return; if (next.objective.protectTarget.type === 'object') next.objective.protectTarget = { type: 'object', objectIds: event.target.value.split(',').map(Number).filter(Number.isFinite) }; else next.objective.protectTarget = { type: 'unit', unitPlacementId: Math.max(1, Math.round(Number(event.target.value) || 1)) } })}>{!protectTarget ? <option value="">请先选择类型</option> : protectTarget.type === 'object' ? placedObjectGroups.length === 0 ? <option value="">当前没有已放置物体</option> : placedObjectGroups.map(group => <option key={group.ids.join(',')} value={group.ids.join(',')}>{group.name} #{group.ids[0]}{group.autotile && group.ids.length > 1 ? `（连续 ${group.ids.length} 格）` : ''}</option>) : level.initialUnits.length === 0 ? <option value="">当前没有已放置单位</option> : level.initialUnits.map(unit => <option key={unit.id} value={unit.id}>{unitDefById(unit.unitDefId)?.name ?? unit.unitDefId} #{unit.id}</option>)}</select></label></div>}
        {stage.objective.type === 'fortressDefense' && <div className="border border-black/30 p-1 space-y-1">
          <label className="text-[8px] font-bold">堡垒单位<select className="w-full px-1 border border-black bg-[#EFEBD8]" value={stage.objective.fortressDefId} onChange={event => patchStage(next => { if (next.objective.type === 'fortressDefense') next.objective.fortressDefId = event.target.value })}>{playableVehicleDefs().map(def => <option key={def.id} value={def.id}>{def.name}</option>)}</select></label>
          <div className="grid grid-cols-2 gap-1">
            {([['堡垒位置', 'fortressPoint', 'fortress'], ['返回位置', 'returnPoint', 'return']] as const).map(([label, point, kind]) => {
              const active = placementTarget?.stageId === stage.id && placementTarget.kind === kind
              return <div key={point} className={`border p-0.5 ${active ? 'border-[#B3392E] bg-[#B3392E]/10' : 'border-black/25'}`}>
                <div className="flex items-center gap-1"><span className="text-[7px] font-black">{label}</span><button type="button" aria-pressed={active} className={`ml-auto comic-btn px-1 py-0 text-[7px] ${active ? 'bg-[#B3392E] text-[#EFEBD8]' : ''}`} onClick={() => onPlacementTarget(active ? null : { stageId: stage.id, kind })}>画布拖拽</button></div>
                <div className="grid grid-cols-2 gap-0.5">{(['x', 'y'] as const).map(axis => <label key={axis} className="text-[7px] font-bold">{axis.toUpperCase()}<ValidatedNumberInput min={0} max={axis === 'x' ? level.cols : level.rows} step={0.5} className="w-full px-0.5 border border-black bg-[#EFEBD8]" value={stage.objective.type === 'fortressDefense' ? stage.objective[point][axis] : 0} onChange={event => patchStage(next => { if (next.objective.type === 'fortressDefense') next.objective[point][axis] = Math.max(0, Number(event.target.value) || 0) })} /></label>)}</div>
              </div>
            })}
          </div>
          <div className="text-[7px] font-bold text-black/50">画布会显示堡垒与返回位置；固定火力点请在对象层放置玩家单位，并锁定其移动和车体转向。</div>
          <div className="text-[7px] font-bold text-black/50">玩家单位的炮位只在波次准备阶段开放整备，安装后的炮塔随单位永久留场。</div>
          <div className="text-[7px] font-bold text-black/50">进入阶段时隐藏玩家载具；离开后载具在返回点恢复，存活堡垒转为友方单位。</div>
        </div>}
        <div className="border border-black/25 p-1 space-y-1">
          <div className="flex items-center gap-1"><span className="text-[8px] font-black">敌人出生区域</span><button type="button" className="ml-auto comic-btn px-1 py-0 text-[7px]" onClick={() => patchStage(next => {
            if (next.objective.type !== 'defend' && next.objective.type !== 'fortressDefense') return
            const id = Math.max(0, ...next.objective.spawnRegions.map(region => region.id)) + 1
            next.objective.spawnRegions.push({ id, cells: [] }); onSelectSpawnRegion(id)
          })}>＋ 区域</button></div>
          <div className="flex flex-wrap gap-0.5">{stage.objective.spawnRegions.map(region => <button key={region.id} type="button" className={`px-1 py-0.5 border text-[7px] font-black ${selectedSpawnRegionId === region.id ? 'border-[#B3392E] bg-[#B3392E]/10' : 'border-black/25'}`} onClick={() => onSelectSpawnRegion(region.id)}>区域 {region.id} · {region.cells.length}格</button>)}</div>
          {stage.objective.spawnRegions.length === 0 && <div className="text-[7px] font-bold text-[#B3392E]">请先新建出生区域</div>}
          {selectedSpawnRegionId !== null && stage.objective.spawnRegions.some(region => region.id === selectedSpawnRegionId) && <div className="flex gap-1"><button type="button" className="comic-btn px-1 py-0 text-[7px]" onClick={() => onDrawSpawnRegion(false)}>绘制</button><button type="button" className="comic-btn px-1 py-0 text-[7px]" onClick={() => onDrawSpawnRegion(true)}>擦除</button><button type="button" className="comic-btn px-1 py-0 text-[7px]" onClick={() => patchStage(next => { if (next.objective.type === 'defend' || next.objective.type === 'fortressDefense') { const region = next.objective.spawnRegions.find(item => item.id === selectedSpawnRegionId); if (region) region.cells = [] } })}>清空</button><button type="button" className="ml-auto comic-btn px-1 py-0 text-[7px]" onClick={() => patchStage(next => {
            if (next.objective.type !== 'defend' && next.objective.type !== 'fortressDefense') return
            next.objective.spawnRegions = next.objective.spawnRegions.filter(region => region.id !== selectedSpawnRegionId)
            for (const item of next.waves) for (const entry of item.entries) if (entry.spawnRegionId === selectedSpawnRegionId) entry.spawnRegionId = undefined
            onSelectSpawnRegion(next.objective.spawnRegions[0]?.id ?? null)
          })}>删除</button></div>}
          <div className="text-[7px] font-bold text-black/45">区域可绘制成任意形状；同一格只归属一个出生区域。</div>
        </div>
        <label className="text-[8px] font-bold">波次等待<select className="w-full px-1 border border-black bg-[#EFEBD8]" value={(stage.objective.waveWait ?? true) ? 'yes' : 'no'} onChange={event => patchStage(next => { if (next.objective.type === 'defend' || next.objective.type === 'fortressDefense') next.objective.waveWait = event.target.value === 'yes' })}><option value="yes">清场后下一波</option><option value="no">按接踵时间</option></select></label>
        <div className="grid grid-cols-2 gap-1"><label className="text-[8px] font-bold">休整（秒）<ValidatedNumberInput min={0} className="w-full px-1 border border-black bg-[#EFEBD8]" value={stage.objective.restTime ?? 60} onChange={event => patchStage(next => { if (next.objective.type === 'defend' || next.objective.type === 'fortressDefense') next.objective.restTime = Math.max(0, Number(event.target.value) || 0) })} /></label><label className="text-[8px] font-bold">接踵（秒）<ValidatedNumberInput min={0} className="w-full px-1 border border-black bg-[#EFEBD8]" value={stage.objective.overlapTime ?? 5} onChange={event => patchStage(next => { if (next.objective.type === 'defend' || next.objective.type === 'fortressDefense') next.objective.overlapTime = Math.max(0, Number(event.target.value) || 0) })} /></label></div>
        <div className="flex items-center gap-1"><span className="text-[8px] font-black text-black/45">波次敌人</span><button type="button" className="ml-auto comic-btn px-1 py-0 text-[7px]" onClick={() => patchStage(next => {
          const index = next.waves.length + 1, id = `${next.id}-wave-${Date.now() % 100000}`
          next.waves.push({ id, name: `第 ${index} 波`, enemyDamageMultiplier: 1, entries: [{ id: `${id}-entry-1`, unitDefId: enemyUnits[0]?.id ?? '', count: 1, delay: 0, interval: 1 }] })
          if (next.objective.type === 'defend' || next.objective.type === 'fortressDefense') next.objective.waves = next.waves.length
          onSelectWave(id)
        })}>＋ 波次</button></div>
        <div className="flex flex-wrap gap-0.5">{stage.waves.map((item, index) => <button key={item.id} type="button" className={`px-1 py-0.5 border text-[7px] font-black ${wave?.id === item.id ? 'border-[#B3392E] bg-[#B3392E]/10' : 'border-black/25'}`} onClick={() => onSelectWave(item.id)}>{index + 1}</button>)}</div>
        {wave && <div className="border border-black/30 p-1 space-y-1"><div className="flex gap-1"><input className="flex-1 min-w-0 px-1 text-[8px] border border-black bg-[#EFEBD8]" value={wave.name} onChange={event => patchStage(next => { const current = next.waves.find(item => item.id === wave.id); if (current) current.name = event.target.value })} /><button type="button" className="comic-btn px-1 py-0 text-[7px]" disabled={stage.waves.length <= 1} onClick={() => patchStage(next => { next.waves = next.waves.filter(item => item.id !== wave.id); if (next.objective.type === 'defend' || next.objective.type === 'fortressDefense') next.objective.waves = next.waves.length; onSelectWave(next.waves[0]?.id ?? '') })}>删波</button><button type="button" className="comic-btn px-1 py-0 text-[7px]" onClick={() => patchStage(next => { const current = next.waves.find(item => item.id === wave.id); if (current) current.entries.push({ id: `${current.id}-entry-${Date.now() % 100000}`, unitDefId: enemyUnits[0]?.id ?? '', count: 1, delay: 0, interval: 1 }) })}>＋敌人</button></div>
          <label className="flex items-center gap-1 text-[7px] font-bold" title="本波生成敌人的全部攻击伤害倍率。1 为正常伤害，1.5 为 1.5 倍伤害。"><span>敌人强度系数</span><ValidatedNumberInput min={0} max={100} step={0.1} className="ml-auto w-20 px-1 border border-black bg-[#EFEBD8]" value={wave.enemyDamageMultiplier} onChange={event => patchStage(next => { const current = next.waves.find(item => item.id === wave.id); if (current) current.enemyDamageMultiplier = Math.max(0, Math.min(100, Number(event.target.value) || 0)) })} /></label>
          <div className="text-[7px] font-bold text-black/45">影响本波敌人及其弹丸造成的伤害；1 = 正常，1.5 = 150%。</div>
          {wave.entries.length === 0 && <div className="text-[7px] text-black/40">本波没有敌人</div>}
          {wave.entries.map(entry => <div key={entry.id} className="grid grid-cols-[minmax(70px,1fr)_62px_36px_36px_36px_18px] gap-0.5 items-end">
            <label className="text-[7px] font-bold">单位<select className="w-full min-w-0 px-0.5 border border-black bg-[#EFEBD8]" value={entry.unitDefId} onChange={event => patchStage(next => { const current = next.waves.find(item => item.id === wave.id)?.entries.find(item => item.id === entry.id); if (current) current.unitDefId = event.target.value })}>{enemyUnits.map(unit => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></label>
            <label className="text-[7px] font-bold">出生区域<select className="w-full min-w-0 px-0.5 border border-black bg-[#EFEBD8]" value={entry.spawnRegionId ?? ''} onChange={event => patchStage(next => { const current = next.waves.find(item => item.id === wave.id)?.entries.find(item => item.id === entry.id); if (current) current.spawnRegionId = event.target.value ? Number(event.target.value) : undefined })}><option value="">随机</option>{stage.objective.type === 'defend' || stage.objective.type === 'fortressDefense' ? stage.objective.spawnRegions.map(region => <option key={region.id} value={region.id}>区域 {region.id}</option>) : null}</select></label>
            {([['数量', 'count'], ['延迟', 'delay'], ['间隔', 'interval']] as const).map(([label, key]) => <label key={key} className="text-[7px] font-bold">{label}<ValidatedNumberInput min={key === 'count' ? 1 : 0} step={key === 'count' ? 1 : 0.1} className="w-full px-0.5 border border-black bg-[#EFEBD8]" value={entry[key]} onChange={event => patchStage(next => { const current = next.waves.find(item => item.id === wave.id)?.entries.find(item => item.id === entry.id); if (current) current[key] = key === 'count' ? Math.max(1, Math.round(Number(event.target.value) || 1)) : Math.max(0, Number(event.target.value) || 0) })} /></label>)}
            <button type="button" className="comic-btn h-[19px] px-0 text-[8px]" onClick={() => patchStage(next => { const current = next.waves.find(item => item.id === wave.id); if (current) current.entries = current.entries.filter(item => item.id !== entry.id) })}>×</button>
          </div>)}
        </div>}
      </>}
      <div className="grid grid-cols-2 gap-1">{transitionSelect('成功后', stage.success, next => patchStage(item => { item.success = next }))}{transitionSelect('失败后', stage.failure, next => patchStage(item => { item.failure = next }))}</div>
      <div className="text-[7px] font-bold text-black/40">防守任务中，所选物体或单位被摧毁时进入失败分支；玩家载具彻底摧毁仍会结束任务。</div>
    </div>
  </div>
}

function VariableNameInput({ variableId, variables, variableType, onCommit, label = '关卡变量' }: {
  variableId: string
  variables: LevelVariableDef[]
  variableType: LevelVariableDef['type']
  onCommit: (name: string, type: LevelVariableDef['type']) => string
  label?: string
}) {
  const displayName = variables.find(variable => variable.id === variableId)?.name ?? variableId
  const [name, setName] = useState(displayName)
  const commit = () => {
    const nextId = onCommit(name, variableType)
    setName(variables.find(variable => variable.id === nextId)?.name ?? name.trim())
    return nextId
  }
  return <input
    aria-label={`${label}名`}
    placeholder={`输入${label}名（自动创建）`}
    className="px-1 text-[9px] border border-black bg-[#EFEBD8]"
    value={name}
    onChange={event => {
      const typed = event.target.value
      if (!typed || (event.nativeEvent as InputEvent).isComposing) { setName(typed); return }
      const match = variables.find(variable => variable.name.length > typed.length && variable.name.toLocaleLowerCase().startsWith(typed.toLocaleLowerCase()))
      if (!match) { setName(typed); return }
      const input = event.currentTarget
      setName(match.name)
      window.requestAnimationFrame(() => input.setSelectionRange(typed.length, match.name.length))
    }}
    onBlur={commit}
    onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur() }}
  />
}

function ensureActionVariableDefinitions(levelVariables: LevelVariableDef[], globalVariables: LevelVariableDef[], actions: LevelEventAction[]): void {
  const visit = (items: LevelEventAction[]) => {
    for (const action of items) {
      if ((action.type === 'levelVariable' || action.type === 'globalVariable') && action.variableId) {
        const global = action.type === 'globalVariable'
        const variables = global ? globalVariables : levelVariables
        if (!variables.some(variable => variable.id === action.variableId)) {
          const type: LevelVariableDef['type'] = 'number'
          const name = action.variableId.replace(/^(var|global):/, '')
          variables.push({ id: action.variableId, name, type, initial: 0 })
        }
      } else if (action.type === 'boss') {
        for (const phase of action.boss.phases) visit(phase.actions)
        visit(action.boss.defeatActions)
      } else if (action.type === 'choice') {
        for (const option of action.options) visit(option.actions)
      }
    }
  }
  visit(actions)
}

function LevelSoundAssetSelect({ value, onChange, label }: { value?: string; onChange: (value?: string) => void; label: string }) {
  return <SoundAssetSelect ariaLabel={label} channel="environment" value={value} onChange={onChange} />
}

function ActionEditor({ actions, onChange, level, variables = [], globalVariables = [], onEnsureVariable, onEnsureGlobalVariable, depth = 0, showCommandPalette = false, sourceKind = 'none' }: {
  actions: LevelEventAction[]
  onChange: (next: LevelEventAction[]) => void
  level?: LevelConfig
  variables?: LevelVariableDef[]
  globalVariables?: LevelVariableDef[]
  onEnsureVariable?: (name: string, type: LevelVariableDef['type']) => string
  onEnsureGlobalVariable?: (name: string, type: LevelVariableDef['type']) => string
  depth?: number
  showCommandPalette?: boolean
  sourceKind?: EventSourceKind
}) {
  const [openActions, setOpenActions] = useState<Set<number>>(() => new Set([0]))
  const enemyUnits = unitLibrary()
  const commandUnits = unitLibrary()
  const placedUnits = level?.initialUnits ?? []
  const placedUnitGroups = [...new Set(placedUnits.map(unit => unit.group?.trim()).filter((group): group is string => !!group))].sort((a, b) => a.localeCompare(b, 'zh-CN'))
  const selectableEvents = level?.events ?? []
  const selectableObjects = (level?.objects ?? []).filter((object): object is LevelObject & { id: number } => object.id !== undefined)
  const selectableObjectGroups = groupPlacedObjects(selectableObjects)
  const patchAt = (index: number, action: LevelEventAction) => onChange(actions.map((a, i) => i === index ? action : a))
  const appendAction = (type: ActionKind) => {
    const nextIndex = actions.length
    onChange([...actions, defaultAction(type, level, sourceKind)])
    setOpenActions(current => new Set([...current, nextIndex]))
  }
  const appendUnitAction = (kind: UnitCommandKind) => {
    const nextIndex = actions.length
    onChange([...actions, defaultUnitAction(kind, level, sourceKind)])
    setOpenActions(current => new Set([...current, nextIndex]))
  }
  const move = (index: number, delta: -1 | 1) => {
    const next = [...actions]
    const to = index + delta
    if (to < 0 || to >= next.length) return
    ;[next[index], next[to]] = [next[to], next[index]]
    onChange(next)
  }
  return <div className="space-y-1">
    {actions.map((action, index) => <details key={`${action.type}-${index}`} open={openActions.has(index)} className="group border border-black/25 bg-black/[0.03] p-1">
      <summary onClick={event => { event.preventDefault(); setOpenActions(current => { const next = new Set(current); if (next.has(index)) next.delete(index); else next.add(index); return next }) }} className="cursor-pointer select-none text-[9px] font-black list-none flex items-center gap-1">
        <span>{index + 1}. {actionDisplayName(action)}</span>
        <button type="button" aria-label="动作上移" disabled={index === 0} className="comic-btn px-1 py-0 text-[8px] disabled:cursor-not-allowed disabled:opacity-35" onClick={event => { event.stopPropagation(); move(index, -1) }}>↑</button>
        <button type="button" aria-label="动作下移" disabled={index === actions.length - 1} className="comic-btn px-1 py-0 text-[8px] disabled:cursor-not-allowed disabled:opacity-35" onClick={event => { event.stopPropagation(); move(index, 1) }}>↓</button>
        <button type="button" aria-label="删除动作" className="comic-btn ml-auto px-1 py-0 text-[8px]" onClick={event => { event.stopPropagation(); onChange(actions.filter((_, i) => i !== index)) }}>删</button>
      </summary>
      {action.type === 'wait' && <label className="flex items-center gap-1 text-[8px] font-bold">秒<ValidatedNumberInput min={0} step={0.1} className="w-16 px-1 border border-black bg-[#EFEBD8]" value={action.seconds} onChange={e => patchAt(index, { ...action, seconds: Math.max(0, Number(e.target.value) || 0) })} /></label>}
      {action.type === 'dialogue' && <div className="space-y-1">
        <label className="flex items-center gap-1 text-[8px] font-bold"><span className="w-12 shrink-0">角色</span><input aria-label="对话角色" className="min-w-0 flex-1 px-1 text-[9px] border border-black bg-[#EFEBD8]" value={action.speaker} placeholder="角色名" onChange={e => patchAt(index, { ...action, speaker: e.target.value })} /></label>
        <label className="flex items-start gap-1 text-[8px] font-bold"><span className="w-12 shrink-0 pt-0.5">内容</span><textarea aria-label="对话内容" rows={2} className="min-w-0 flex-1 resize-y px-1 text-[9px] border border-black bg-[#EFEBD8]" value={action.text} onChange={e => patchAt(index, { ...action, text: e.target.value })} /></label>
        <div className="flex items-center gap-2"><label className="text-[8px] font-bold">显示秒数<ValidatedNumberInput aria-label="对话显示秒数" min={0.5} step={0.5} className="ml-1 w-16 px-1 border border-black bg-[#EFEBD8]" value={action.duration} onChange={e => patchAt(index, { ...action, duration: Math.max(0.5, Number(e.target.value) || 0.5) })} /></label><label className="text-[8px] font-bold"><input type="checkbox" checked={action.wait} onChange={e => patchAt(index, { ...action, wait: e.target.checked })} /> 等待对话结束</label></div>
      </div>}
      {action.type === 'text' && <div className="space-y-1">
        <label className="flex items-start gap-1 text-[8px] font-bold"><span className="w-12 shrink-0 pt-0.5">内容</span><textarea aria-label="画面文本内容" rows={2} className="min-w-0 flex-1 resize-y px-1 text-[9px] border border-black bg-[#EFEBD8]" value={action.text} onChange={e => patchAt(index, { ...action, text: e.target.value })} /></label>
        <div className="grid grid-cols-3 gap-1"><label className="text-[8px] font-bold">位置<select aria-label="画面文本位置" className="px-1 text-[9px] border border-black bg-[#EFEBD8]" value={action.position} onChange={e => patchAt(index, { ...action, position: e.target.value as 'top' | 'center' | 'bottom' })}><option value="top">上方</option><option value="center">中央</option><option value="bottom">下方</option></select></label><label className="text-[8px] font-bold">显示秒数<ValidatedNumberInput aria-label="画面文本显示秒数" min={0.5} step={0.5} className="w-full px-1 border border-black bg-[#EFEBD8]" value={action.duration} onChange={e => patchAt(index, { ...action, duration: Math.max(0.5, Number(e.target.value) || 0.5) })} /></label><label className="self-end text-[8px] font-bold"><input type="checkbox" checked={action.wait} onChange={e => patchAt(index, { ...action, wait: e.target.checked })} /> 等待结束</label></div>
      </div>}
      {action.type === 'camera' && <div className="grid grid-cols-6 gap-1">
        <label className="text-[8px] font-bold">目标 X<ValidatedNumberInput aria-label="镜头目标X" min={0} max={level?.cols ?? 200} step={0.5} className="w-full px-1 border border-black bg-[#EFEBD8]" value={action.x} onChange={e => patchAt(index, { ...action, x: Math.max(0, Number(e.target.value) || 0) })} /></label><label className="text-[8px] font-bold">目标 Y<ValidatedNumberInput aria-label="镜头目标Y" min={0} max={level?.rows ?? 500} step={0.5} className="w-full px-1 border border-black bg-[#EFEBD8]" value={action.y} onChange={e => patchAt(index, { ...action, y: Math.max(0, Number(e.target.value) || 0) })} /></label><label className="text-[8px] font-bold">移动秒数<ValidatedNumberInput aria-label="镜头移动秒数" min={0} step={0.1} className="w-full px-1 border border-black bg-[#EFEBD8]" value={action.duration} onChange={e => patchAt(index, { ...action, duration: Math.max(0, Number(e.target.value) || 0) })} /></label><label className="text-[8px] font-bold">停留秒数<ValidatedNumberInput aria-label="镜头停留秒数" min={0} step={0.1} className="w-full px-1 border border-black bg-[#EFEBD8]" value={action.hold} onChange={e => patchAt(index, { ...action, hold: Math.max(0, Number(e.target.value) || 0) })} /></label><label className="self-end text-[8px] font-bold"><input aria-label="镜头停留后返回" type="checkbox" checked={action.returnToOrigin} onChange={e => patchAt(index, { ...action, returnToOrigin: e.target.checked })} /> 返回</label><label className="self-end text-[8px] font-bold"><input type="checkbox" checked={action.wait} onChange={e => patchAt(index, { ...action, wait: e.target.checked })} /> 等待完成</label>
      </div>}
      {action.type === 'choice' && <div className="space-y-1">
        <label className="flex items-center gap-1 text-[8px] font-bold"><span className="w-12 shrink-0">提示</span><input aria-label="选择提示文字" className="min-w-0 flex-1 px-1 text-[9px] border border-black bg-[#EFEBD8]" value={action.prompt} onChange={e => patchAt(index, { ...action, prompt: e.target.value })} /></label>
        {action.options.map((option, optionIndex) => <div key={optionIndex} className="border-l-2 border-[#B3392E] pl-1 space-y-1"><div className="flex items-center gap-1"><span className="text-[8px] font-black">选项 {optionIndex + 1}</span><input aria-label={`选择项 ${optionIndex + 1}`} className="min-w-0 flex-1 px-1 text-[9px] border border-black bg-[#EFEBD8]" value={option.text} onChange={e => patchAt(index, { ...action, options: action.options.map((item, itemIndex) => itemIndex === optionIndex ? { ...item, text: e.target.value } : item) })} /><button type="button" aria-label={`删除选择项 ${optionIndex + 1}`} disabled={action.options.length <= 1} className="comic-btn px-1 py-0 text-[8px] disabled:opacity-35" onClick={() => patchAt(index, { ...action, options: action.options.filter((_, itemIndex) => itemIndex !== optionIndex) })}>×</button></div>{depth < 2 && <ActionEditor depth={depth + 1} sourceKind={sourceKind} actions={option.actions} level={level} variables={variables} globalVariables={globalVariables} onEnsureVariable={onEnsureVariable} onEnsureGlobalVariable={onEnsureGlobalVariable} onChange={next => patchAt(index, { ...action, options: action.options.map((item, itemIndex) => itemIndex === optionIndex ? { ...item, actions: next } : item) })} />}</div>)}
        <button type="button" disabled={action.options.length >= 8} className="comic-btn px-1 py-0 text-[8px] disabled:opacity-35" onClick={() => patchAt(index, { ...action, options: [...action.options, { text: `选项 ${action.options.length + 1}`, actions: [] }] })}>＋选项</button>
      </div>}
      {action.type === 'assembly' && <div className="text-[8px] font-bold text-black/55">打开炮塔与模组装配界面；玩家完成装配后，事件继续执行。</div>}
      {action.type === 'message' && <div className="grid grid-cols-2 gap-1"><label className="text-[8px] font-bold">提示文字<input aria-label="提示文字" className="min-w-0 px-1 text-[9px] border border-black bg-[#EFEBD8]" value={action.text} onChange={e => patchAt(index, { ...action, text: e.target.value })} /></label><label className="text-[8px] font-bold">显示秒数<ValidatedNumberInput aria-label="提示秒数" min={0.5} step={0.5} className="px-1 text-[9px] border border-black bg-[#EFEBD8]" value={action.duration} onChange={e => patchAt(index, { ...action, duration: Math.max(0.5, Number(e.target.value) || 0.5) })} /></label></div>}
      {action.type === 'sound' && <LevelSoundAssetSelect label="播放音效" value={action.presetId} onChange={value => patchAt(index, { ...action, presetId: value ?? '' })} />}
      {action.type === 'music' && <div className="grid grid-cols-2 gap-1"><select aria-label="BGM操作" className="px-1 text-[9px] border border-black bg-[#EFEBD8]" value={action.mode} onChange={e => patchAt(index, { ...action, mode: e.target.value === 'restore' ? 'restore' : 'override' })}><option value="override">临时切换</option><option value="restore">恢复关卡 BGM</option></select><select aria-label="临时BGM" disabled={action.mode === 'restore'} className="min-w-0 px-1 text-[9px] border border-black bg-[#EFEBD8] disabled:opacity-40" value={action.assetId} onChange={e => patchAt(index, { ...action, assetId: e.target.value })}><option value="">无</option>{filterAssets('bgm').map(asset => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</select></div>}
      {action.type === 'reward' && <label className="flex items-center gap-1 text-[8px] font-bold">资源<ValidatedNumberInput min={0} className="w-20 px-1 border border-black bg-[#EFEBD8]" value={action.gold} onChange={e => patchAt(index, { ...action, gold: Math.max(0, Math.round(Number(e.target.value) || 0)) })} /></label>}
      {action.type === 'spawn' && <div><div className="grid grid-cols-2 gap-1">{enemyUnits.map(unit => <label key={unit.id} className="text-[8px] font-bold">{unit.name}<ValidatedNumberInput aria-label={`${unit.name}数量`} min={0} className="w-full px-1 border border-black bg-[#EFEBD8]" value={(action.units ?? legacyEnemyUnitCounts(action.enemies))[unit.id] ?? 0} onChange={e => patchAt(index, { ...action, units: { ...(action.units ?? legacyEnemyUnitCounts(action.enemies)), [unit.id]: Math.max(0, Math.round(Number(e.target.value) || 0)) } })} /></label>)}</div><label className="text-[8px] font-bold">间隔<ValidatedNumberInput min={0} step={0.05} className="ml-1 w-14 px-1 border border-black bg-[#EFEBD8]" value={action.interval} onChange={e => patchAt(index, { ...action, interval: Math.max(0, Number(e.target.value) || 0) })} /></label></div>}
      {action.type === 'levelVariable' && <div className="grid grid-cols-[70px_minmax(0,1fr)_90px] gap-1"><select aria-label="关卡变量操作" className="px-1 text-[9px] border border-black bg-[#EFEBD8]" value={action.operation} onChange={e => patchAt(index, { ...action, operation: e.target.value === 'add' ? 'add' : 'set' })}><option value="set">设置</option><option value="add">增减</option></select><VariableNameInput key={`${action.variableId}:${variables.find(variable => variable.id === action.variableId)?.name ?? ''}`} variableId={action.variableId} variables={variables} variableType="number" onCommit={(name, type) => { const variableId = onEnsureVariable?.(name, type) ?? name.trim(); patchAt(index, { ...action, variableId }); return variableId }} /><ValidatedNumberInput aria-label="关卡变量数值" className="px-1 text-[9px] border border-black bg-[#EFEBD8]" value={action.value} onChange={e => patchAt(index, { ...action, value: Number(e.target.value) || 0 })} /></div>}
      {action.type === 'globalVariable' && <div className="grid grid-cols-[70px_minmax(0,1fr)_90px] gap-1"><select aria-label="全局变量操作" className="px-1 text-[9px] border border-black bg-[#EFEBD8]" value={action.operation} onChange={e => patchAt(index, { ...action, operation: e.target.value === 'add' ? 'add' : 'set' })}><option value="set">设置</option><option value="add">增减</option></select><VariableNameInput label="全局变量" key={`${action.variableId}:${globalVariables.find(variable => variable.id === action.variableId)?.name ?? ''}`} variableId={action.variableId} variables={globalVariables} variableType="number" onCommit={(name, type) => { const variableId = onEnsureGlobalVariable?.(name, type) ?? name.trim(); patchAt(index, { ...action, variableId }); return variableId }} /><ValidatedNumberInput aria-label="全局变量数值" className="px-1 text-[9px] border border-black bg-[#EFEBD8]" value={action.value} onChange={e => patchAt(index, { ...action, value: Number(e.target.value) || 0 })} /></div>}
      {action.type === 'setEventEnabled' && <div className="grid grid-cols-2 gap-1"><select aria-label="目标事件" className="min-w-0 px-1 text-[9px] border border-black bg-[#EFEBD8]" value={action.eventId} disabled={selectableEvents.length === 0} onChange={e => patchAt(index, { ...action, eventId: Number(e.target.value) })}>{selectableEvents.length === 0 ? <option value={action.eventId}>暂无已创建事件</option> : <>{!selectableEvents.some(event => event.id === action.eventId) && <option value={action.eventId}>目标事件已删除 #{action.eventId}</option>}{selectableEvents.map(event => <option key={event.id} value={event.id}>{event.name || '未命名事件'} #{event.id}</option>)}</>}</select><select aria-label="事件启用状态" className="px-1 text-[9px] border border-black bg-[#EFEBD8]" value={action.enabled ? 'on' : 'off'} onChange={e => patchAt(index, { ...action, enabled: e.target.value === 'on' })}><option value="on">启用</option><option value="off">禁用</option></select></div>}
      {action.type === 'callEvent' && <select aria-label="调用目标事件" className="w-full min-w-0 px-1 text-[9px] border border-black bg-[#EFEBD8]" value={action.eventId} disabled={selectableEvents.length === 0} onChange={e => patchAt(index, { ...action, eventId: Number(e.target.value) })}>{selectableEvents.length === 0 ? <option value={action.eventId}>暂无已创建事件</option> : <>{!selectableEvents.some(event => event.id === action.eventId) && <option value={action.eventId}>目标事件已删除 #{action.eventId}</option>}{selectableEvents.map(event => <option key={event.id} value={event.id}>{event.name || '未命名事件'} #{event.id}</option>)}</>}</select>}
      {action.type === 'setObjectState' ? (() => { const sourceObject = action.objectId === 'source'; const group = sourceObject ? undefined : selectableObjectGroups.find(item => item.ids.includes(typeof action.objectId === 'number' ? action.objectId : -1)); const object = group?.objects[0] ?? (sourceObject ? undefined : selectableObjects.find(item => item.id === (typeof action.objectId === 'number' ? action.objectId : -1))); const states = objectStateOptions(object, action.state); return <div className="grid grid-cols-2 gap-1"><select aria-label="目标物体" className="min-w-0 px-1 text-[9px] border border-black bg-[#EFEBD8]" value={sourceObject ? 'source' : group?.ids[0] ?? action.objectId} disabled={selectableObjectGroups.length === 0 && sourceKind !== 'object'} onChange={e => { if (e.target.value === 'source') { patchAt(index, { ...action, objectId: 'source' }); return } const objectId = Number(e.target.value); const nextObject = selectableObjectGroups.find(item => item.ids[0] === objectId)?.objects[0]; patchAt(index, { ...action, objectId, state: objectStateOptions(nextObject)[0] }) }}>{sourceKind === 'object' && <option value="source">事件来源物体</option>}{selectableObjectGroups.length === 0 && sourceKind !== 'object' ? <option value={String(action.objectId)}>暂无已放置物体</option> : <>{!sourceObject && !group && <option value={String(action.objectId)}>目标物体已删除 #{action.objectId}</option>}{selectableObjectGroups.map(item => <option key={item.ids.join(',')} value={item.ids[0]}>{objectGroupLabel(item)}</option>)}</>}</select><select aria-label="物体状态" className="min-w-0 px-1 text-[9px] border border-black bg-[#EFEBD8]" value={action.state} onChange={e => patchAt(index, { ...action, state: e.target.value })}>{states.map(state => <option key={state} value={state}>{state}</option>)}</select></div> })() : null}
      {action.type === 'supply' && <div className="grid grid-cols-3 gap-1"><label className="text-[8px] font-bold">资源<ValidatedNumberInput aria-label="补给资源增减值" className="w-full px-1 border border-black bg-[#EFEBD8]" value={action.gold} onChange={e => patchAt(index, { ...action, gold: Number(e.target.value) || 0 })} /></label><label className="text-[8px] font-bold">弹药<ValidatedNumberInput aria-label="补给弹药增减值" className="w-full px-1 border border-black bg-[#EFEBD8]" value={action.ammo} onChange={e => patchAt(index, { ...action, ammo: Number(e.target.value) || 0 })} /></label><label className="text-[8px] font-bold">能量<ValidatedNumberInput aria-label="补给能量增减值" className="w-full px-1 border border-black bg-[#EFEBD8]" value={action.energy} onChange={e => patchAt(index, { ...action, energy: Number(e.target.value) || 0 })} /></label></div>}
      {action.type === 'functionalArea' && <div className="grid grid-cols-2 gap-1">
        <label className="flex items-end gap-1 text-[8px] font-bold"><input aria-label="功能区域补充弹药" type="checkbox" checked={action.ammoEnabled} onChange={e => patchAt(index, { ...action, ammoEnabled: e.target.checked })} /><span className="min-w-0 flex-1">补充弹药（发/s）<ValidatedNumberInput aria-label="功能区域弹药效率" disabled={!action.ammoEnabled} min={0} max={1000} step={1} className="w-full px-1 border border-black bg-[#EFEBD8] disabled:opacity-40" value={action.ammoPerSec} onChange={e => patchAt(index, { ...action, ammoPerSec: Math.max(0, Math.min(1000, Number(e.target.value) || 0)) })} /></span></label>
        <label className="flex items-end gap-1 text-[8px] font-bold"><input aria-label="功能区域充能" type="checkbox" checked={action.energyEnabled} onChange={e => patchAt(index, { ...action, energyEnabled: e.target.checked })} /><span className="min-w-0 flex-1">充能（点/s）<ValidatedNumberInput aria-label="功能区域充能效率" disabled={!action.energyEnabled} min={0} max={1000} step={1} className="w-full px-1 border border-black bg-[#EFEBD8] disabled:opacity-40" value={action.energyPerSec} onChange={e => patchAt(index, { ...action, energyPerSec: Math.max(0, Math.min(1000, Number(e.target.value) || 0)) })} /></span></label>
        <label className="col-span-2 flex items-start gap-1 text-[8px] font-bold"><input aria-label="功能区域修理" type="checkbox" checked={action.repairEnabled} onChange={e => patchAt(index, { ...action, repairEnabled: e.target.checked })} /><span className="grid flex-1 grid-cols-2 gap-1"><span>结构修理（点/s）<ValidatedNumberInput aria-label="功能区域结构修理效率" disabled={!action.repairEnabled} min={0} max={1000} step={1} className="w-full px-1 border border-black bg-[#EFEBD8] disabled:opacity-40" value={action.structurePerSec} onChange={e => patchAt(index, { ...action, structurePerSec: Math.max(0, Math.min(1000, Number(e.target.value) || 0)) })} /></span><span>装甲修理（每面点/s）<ValidatedNumberInput aria-label="功能区域装甲修理效率" disabled={!action.repairEnabled} min={0} max={1000} step={1} className="w-full px-1 border border-black bg-[#EFEBD8] disabled:opacity-40" value={action.armorPerSec} onChange={e => patchAt(index, { ...action, armorPerSec: Math.max(0, Math.min(1000, Number(e.target.value) || 0)) })} /></span></span></label>
        <label className="col-span-2 flex items-center gap-1 text-[8px] font-bold"><input aria-label="功能区域整备" type="checkbox" checked={action.assemblyEnabled} onChange={e => patchAt(index, { ...action, assemblyEnabled: e.target.checked })} />整备（允许更换炮塔、模块）</label>
        <div className="col-span-2 text-[8px] font-bold text-black/50">可同时勾选多个功能；区域形状沿用当前事件的“停留区域”。</div>
      </div>}
      {action.type === 'stageJump' && <select aria-label="跳转任务阶段" className="w-full px-1 text-[9px] border border-black bg-[#EFEBD8]" value={action.stageId} disabled={!level?.stages.length} onChange={e => patchAt(index, { ...action, stageId: e.target.value })}>{!level?.stages.length ? <option value="">暂无任务阶段</option> : level.stages.map((stage, stageIndex) => <option key={stage.id} value={stage.id}>{stageIndex + 1}. {stage.name}</option>)}</select>}
      {action.type === 'taskResult' && <div className="grid grid-cols-2 gap-1"><select aria-label="任务结果目标" className="px-1 text-[9px] border border-black bg-[#EFEBD8]" value={action.target} onChange={e => { const target = e.target.value as 'primary' | 'secondary1' | 'secondary2'; patchAt(index, { ...action, target, state: target === 'primary' ? action.state : 'complete' }) }}><option value="primary">主要目标</option><option value="secondary1">次要目标 1</option><option value="secondary2">次要目标 2</option></select><select aria-label="任务目标状态" className="px-1 text-[9px] border border-black bg-[#EFEBD8]" value={action.target === 'primary' ? action.state : 'complete'} disabled={action.target !== 'primary'} onChange={e => patchAt(index, { ...action, state: e.target.value === 'failed' ? 'failed' : 'complete' })}><option value="complete">完成</option>{action.target === 'primary' && <option value="failed">失败</option>}</select></div>}
      {action.type === 'unit' && <div className="space-y-1">
        <label className="text-[8px] font-bold">{action.command.kind === 'faction' ? '切换范围' : '执行单位'}<select aria-label="指令目标" className="min-w-0 px-1 text-[9px] border border-black bg-[#EFEBD8]" value={action.command.kind === 'faction' && action.selector.scope !== 'placement' && action.selector.scope !== 'group' ? 'placement' : action.selector.scope} onChange={e => { const scope = e.target.value; const selector = scope === 'placement' ? { scope: 'placement' as const, placementId: placedUnits[0]?.id ?? 1 } : scope === 'group' ? { scope: 'group' as const, group: placedUnitGroups[0] ?? '' } : scope === 'unitDef' ? { scope: 'unitDef' as const, unitDefId: commandUnits[0]?.id ?? '' } : { scope: scope as 'source' | 'allEnemies' | 'allAllies' }; patchAt(index, { ...action, selector }) }}>{action.command.kind === 'faction' ? <><option value="placement">指定单位</option><option value="group">指定组别</option></> : <>{sourceKind === 'unit' && <option value="source">事件来源单位</option>}<option value="placement">关卡单位实例</option><option value="unitDef">指定单位定义</option><option value="allEnemies">全部敌人</option><option value="allAllies">全部友军</option></>}</select></label>
        {action.selector.scope === 'placement' && <select aria-label="指令单位实例" className="w-full px-1 text-[9px] border border-black bg-[#EFEBD8]" value={action.selector.placementId} disabled={placedUnits.length === 0} onChange={e => patchAt(index, { ...action, selector: { scope: 'placement', placementId: Number(e.target.value) } })}>{placedUnits.length === 0 ? <option value={action.selector.placementId}>暂无已放置单位</option> : placedUnits.map(unit => <option key={unit.id} value={unit.id}>{unitDefById(unit.unitDefId)?.name ?? unit.unitDefId} #{unit.id}</option>)}</select>}
        {action.selector.scope === 'group' && <select aria-label="指令单位组别" className="w-full px-1 text-[9px] border border-black bg-[#EFEBD8]" value={action.selector.group} disabled={placedUnitGroups.length === 0} onChange={e => patchAt(index, { ...action, selector: { scope: 'group', group: e.target.value } })}>{placedUnitGroups.length === 0 ? <option value={action.selector.group}>暂无已编组单位</option> : <>{!placedUnitGroups.includes(action.selector.group) && <option value={action.selector.group}>{action.selector.group || '组别已移除'}</option>}{placedUnitGroups.map(group => <option key={group} value={group}>{group}</option>)}</>}</select>}
        {action.selector.scope === 'unitDef' && <select aria-label="指令单位定义" className="w-full px-1 text-[9px] border border-black bg-[#EFEBD8]" value={action.selector.unitDefId} onChange={e => patchAt(index, { ...action, selector: { scope: 'unitDef', unitDefId: e.target.value } })}>{commandUnits.map(unit => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select>}
        {action.command.kind === 'move' && <div className="grid grid-cols-4 gap-1"><label className="text-[8px] font-bold">X<ValidatedNumberInput aria-label="移动目标X" className="w-full px-1 border border-black bg-[#EFEBD8]" value={action.command.x} onChange={e => patchAt(index, { ...action, command: patchMoveCommand(action.command, { x: Number(e.target.value) || 0 }) })} /></label><label className="text-[8px] font-bold">Y<ValidatedNumberInput aria-label="移动目标Y" className="w-full px-1 border border-black bg-[#EFEBD8]" value={action.command.y} onChange={e => patchAt(index, { ...action, command: patchMoveCommand(action.command, { y: Number(e.target.value) || 0 }) })} /></label><label className="text-[8px] font-bold">速度<ValidatedNumberInput aria-label="移动速度" min={0.1} step={0.1} className="w-full px-1 border border-black bg-[#EFEBD8]" value={action.command.speed} onChange={e => patchAt(index, { ...action, command: patchMoveCommand(action.command, { speed: Math.max(0.1, Number(e.target.value) || 0.1) }) })} /></label><label className="self-end text-[8px] font-bold"><input type="checkbox" checked={action.command.wait} onChange={e => patchAt(index, { ...action, command: patchMoveCommand(action.command, { wait: e.target.checked }) })} /> 等待完成</label></div>}
        {action.command.kind === 'altitude' && <div className="flex items-center gap-2"><label className="text-[8px] font-bold">目标高度（格）<ValidatedNumberInput aria-label="飞行目标高度" min={0} max={10} step={0.1} className="ml-1 w-20 px-1 border border-black bg-[#EFEBD8]" value={action.command.altitude} onChange={e => patchAt(index, { ...action, command: patchAltitudeCommand(action.command, { altitude: Number(e.target.value) || 0 }) })} /></label><label className="text-[8px] font-bold"><input type="checkbox" checked={action.command.wait} onChange={e => patchAt(index, { ...action, command: patchAltitudeCommand(action.command, { wait: e.target.checked }) })} /> 等待到达</label></div>}
        {action.command.kind === 'hold' && <div className="flex gap-2"><label className="text-[8px] font-bold">秒<ValidatedNumberInput aria-label="停留秒数" min={0} step={0.1} className="ml-1 w-16 px-1 border border-black bg-[#EFEBD8]" value={action.command.seconds} onChange={e => patchAt(index, { ...action, command: patchHoldCommand(action.command, { seconds: Math.max(0, Number(e.target.value) || 0) }) })} /></label><label className="text-[8px] font-bold"><input type="checkbox" checked={action.command.wait} onChange={e => patchAt(index, { ...action, command: patchHoldCommand(action.command, { wait: e.target.checked }) })} /> 等待完成</label></div>}
        {action.command.kind === 'attack' && (() => { const command = action.command; const targetType = command.target === 'nearestHostile' ? 'player' : command.target.type; return <div className="space-y-1"><div className="grid grid-cols-2 gap-1"><label className="text-[8px] font-bold">攻击目标<select aria-label="攻击目标类型" className="min-w-0 px-1 text-[9px] border border-black bg-[#EFEBD8]" value={targetType} onChange={e => { const type = e.target.value; const target = type === 'sourceObject' ? { type: 'sourceObject' as const } : type === 'unit' ? { type: 'unit' as const, placementId: placedUnits[0]?.id ?? 1 } : type === 'object' ? { type: 'object' as const, objectId: selectableObjectGroups[0]?.ids[0] ?? 1 } : { type: 'player' as const }; patchAt(index, { ...action, command: patchAttackCommand(command, { target }) }) }}><option value="player">玩家</option>{sourceKind === 'object' && <option value="sourceObject">事件来源物体</option>}<option value="unit">指定单位</option><option value="object">指定物体</option></select></label>{targetType === 'unit' && command.target !== 'nearestHostile' && command.target.type === 'unit' ? <label className="text-[8px] font-bold">具体单位<select aria-label="攻击指定单位" className="min-w-0 px-1 text-[9px] border border-black bg-[#EFEBD8]" value={command.target.placementId} onChange={e => patchAt(index, { ...action, command: patchAttackCommand(command, { target: { type: 'unit', placementId: Number(e.target.value) } }) })}>{placedUnits.length === 0 ? <option value={1}>暂无单位</option> : placedUnits.map(unit => <option key={unit.id} value={unit.id}>{unitDefById(unit.unitDefId)?.name ?? unit.unitDefId} #{unit.id}</option>)}</select></label> : null}{targetType === 'object' && command.target !== 'nearestHostile' && command.target.type === 'object' ? <label className="text-[8px] font-bold">具体物体<select aria-label="攻击指定物体" className="min-w-0 px-1 text-[9px] border border-black bg-[#EFEBD8]" value={selectableObjectGroups.find(group => group.ids.includes(command.target !== 'nearestHostile' && command.target.type === 'object' ? command.target.objectId : -1))?.ids[0] ?? command.target.objectId} onChange={e => patchAt(index, { ...action, command: patchAttackCommand(command, { target: { type: 'object', objectId: Number(e.target.value) } }) })}>{selectableObjectGroups.length === 0 ? <option value={1}>暂无物体</option> : selectableObjectGroups.map(group => <option key={group.ids.join(',')} value={group.ids[0]}>{objectGroupLabel(group)}</option>)}</select></label> : null}</div><div className="flex gap-2"><label className="text-[8px] font-bold">秒<ValidatedNumberInput aria-label="攻击秒数" min={0.1} step={0.1} className="w-16 px-1 border border-black bg-[#EFEBD8]" value={command.seconds} onChange={e => patchAt(index, { ...action, command: patchAttackCommand(command, { seconds: Math.max(0.1, Number(e.target.value) || 0.1) }) })} /></label><label className="text-[8px] font-bold"><input type="checkbox" checked={command.wait} onChange={e => patchAt(index, { ...action, command: patchAttackCommand(command, { wait: e.target.checked }) })} /> 等待完成</label></div></div> })()}
        {action.command.kind === 'ai' && <div className="space-y-1"><select aria-label="AI控制方式" className="w-full px-1 text-[9px] border border-black bg-[#EFEBD8]" value={action.command.mode} onChange={e => patchAt(index, { ...action, command: e.target.value === 'replace' ? { kind: 'ai', mode: 'replace', preferredTarget: 'allHostile', positioning: 'optimalRange', movement: 'stop' } : { kind: 'ai', mode: e.target.value as 'pause' | 'restore' } })}><option value="pause">暂停 AI</option><option value="restore">恢复原 AI</option><option value="replace">替换 AI</option></select>{action.command.mode === 'replace' && <div className="grid grid-cols-3 gap-1"><select aria-label="替换首选目标" className="min-w-0 px-1 text-[8px] border border-black bg-[#EFEBD8]" value={action.command.preferredTarget ?? 'allHostile'} onChange={e => patchAt(index, { ...action, command: patchAICommand(action.command, { preferredTarget: e.target.value }) })}>{AI_TARGET_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><select aria-label="替换站位" className="min-w-0 px-1 text-[8px] border border-black bg-[#EFEBD8]" value={action.command.positioning ?? 'optimalRange'} onChange={e => patchAt(index, { ...action, command: patchAICommand(action.command, { positioning: e.target.value }) })}>{AI_POSITION_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><select aria-label="替换移动" className="min-w-0 px-1 text-[8px] border border-black bg-[#EFEBD8]" value={action.command.movement ?? 'stop'} onChange={e => patchAt(index, { ...action, command: patchAICommand(action.command, { movement: e.target.value }) })}>{AI_MOVEMENT_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>}</div>}
        {action.command.kind === 'behavior' && <div className="space-y-1"><label className="text-[8px] font-bold">行为<select aria-label="变更单位行为" className="min-w-0 px-1 text-[9px] border border-black bg-[#EFEBD8]" value={action.command.behavior} onChange={e => patchAt(index, { ...action, command: patchBehaviorCommand(action.command, { behavior: e.target.value as BehaviorCommand['behavior'], range: e.target.value === 'random' ? 6 : e.target.value === 'approach' ? 8 : e.target.value === 'follow' ? 2 : 0, interval: e.target.value === 'random' ? 3 : e.target.value === 'route' ? 1 : 0 }) })}><option value="restore">恢复初始行为</option><option value="static">停留</option><option value="guard">坚守</option><option value="random">随机</option><option value="route">路线</option><option value="approach">接近</option><option value="follow">跟随</option></select></label>{action.command.behavior !== 'restore' && action.command.behavior !== 'static' ? <div className="grid grid-cols-3 gap-1">{action.command.behavior !== 'route' && action.command.behavior !== 'guard' ? <label className="text-[8px] font-bold">{action.command.behavior === 'random' ? '移动范围' : action.command.behavior === 'approach' ? '触发范围' : '跟随距离'}<ValidatedNumberInput aria-label="行为范围" min={0} step={0.5} className="min-w-0 px-1 border border-black bg-[#EFEBD8]" value={action.command.range} onChange={e => patchAt(index, { ...action, command: patchBehaviorCommand(action.command, { range: Math.max(0, Number(e.target.value) || 0) }) })} /></label> : null}{(action.command.behavior === 'random' || action.command.behavior === 'route') ? <label className="text-[8px] font-bold">移动间隔<ValidatedNumberInput aria-label="行为移动间隔" min={0} step={0.1} className="min-w-0 px-1 border border-black bg-[#EFEBD8]" value={action.command.interval} onChange={e => patchAt(index, { ...action, command: patchBehaviorCommand(action.command, { interval: Math.max(0, Number(e.target.value) || 0) }) })} /></label> : null}<label className="text-[8px] font-bold">速度（%）<ValidatedNumberInput aria-label="行为移动速度" min={0} max={100} className="min-w-0 px-1 border border-black bg-[#EFEBD8]" value={action.command.speedPercent} onChange={e => patchAt(index, { ...action, command: patchBehaviorCommand(action.command, { speedPercent: Math.max(0, Math.min(100, Number(e.target.value) || 0)) }) })} /></label></div> : null}</div>}
        {action.command.kind === 'faction' && <label className="text-[8px] font-bold">目标阵营<select aria-label="切换后的阵营" className="w-full px-1 text-[9px] border border-black bg-[#EFEBD8]" value={action.command.faction} onChange={e => patchAt(index, { ...action, command: patchFactionCommand(action.command, { faction: e.target.value as LevelPlacedUnitFaction }) })}><option value="player">玩家</option><option value="ally">友方</option><option value="neutral">中立</option><option value="neutralHostile">中立敌对</option><option value="enemy">敌方</option></select></label>}
      </div>}
      {action.type === 'boss' && <div className="space-y-1">
        <div className="grid grid-cols-2 gap-1"><input aria-label="Boss名称" className="px-1 text-[9px] border border-black bg-[#EFEBD8]" value={action.boss.name} onChange={e => patchAt(index, { ...action, boss: { ...action.boss, name: e.target.value } })} /><select aria-label="Boss单位" className="px-1 text-[9px] border border-black bg-[#EFEBD8]" value={action.boss.unitDefId ?? enemyUnitId(action.boss.kind)} onChange={e => { const unit = unitDefById(e.target.value); if (unit) patchAt(index, { ...action, boss: { ...action.boss, unitDefId: unit.id, kind: enemyKindForUnit(unit) } }) }}>{enemyUnits.map(unit => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></div>
        <div className="grid grid-cols-2 gap-1"><label className="text-[8px] font-bold">生命倍率<ValidatedNumberInput min={1} step={0.5} className="w-full px-1 border border-black bg-[#EFEBD8]" value={action.boss.hpScale} onChange={e => patchAt(index, { ...action, boss: { ...action.boss, hpScale: Math.max(1, Number(e.target.value) || 1) } })} /></label><label className="text-[8px] font-bold">体型倍率<ValidatedNumberInput min={1} step={0.1} className="w-full px-1 border border-black bg-[#EFEBD8]" value={action.boss.sizeScale} onChange={e => patchAt(index, { ...action, boss: { ...action.boss, sizeScale: Math.max(1, Number(e.target.value) || 1) } })} /></label></div>
        {depth < 2 && action.boss.phases.map((phase, pi) => <div key={pi} className="border-l-2 border-[#B3392E] pl-1"><div className="flex items-center gap-1 text-[8px] font-black">生命降至<ValidatedNumberInput min={1} max={99} className="w-12 px-1 border border-black bg-[#EFEBD8]" value={phase.hpPercent} onChange={e => { const phases = action.boss.phases.map((p, i) => i === pi ? { ...p, hpPercent: Math.max(1, Math.min(99, Number(e.target.value) || 50)) } : p); patchAt(index, { ...action, boss: { ...action.boss, phases } }) }} />%<button type="button" className="ml-auto comic-btn px-1 py-0" onClick={() => patchAt(index, { ...action, boss: { ...action.boss, phases: action.boss.phases.filter((_, i) => i !== pi) } })}>删阶段</button></div><ActionEditor depth={depth + 1} sourceKind="unit" actions={phase.actions} level={level} variables={variables} globalVariables={globalVariables} onEnsureVariable={onEnsureVariable} onEnsureGlobalVariable={onEnsureGlobalVariable} onChange={next => { const phases = action.boss.phases.map((p, i) => i === pi ? { ...p, actions: next } : p); patchAt(index, { ...action, boss: { ...action.boss, phases } }) }} /></div>)}
        <button type="button" className="comic-btn px-1 py-0 text-[8px]" onClick={() => patchAt(index, { ...action, boss: { ...action.boss, phases: [...action.boss.phases, { hpPercent: 50, actions: [] }] } })}>＋阶段</button>
        {depth < 2 && <div className="border-l-2 border-black/40 pl-1"><div className="text-[8px] font-black">击败后</div><ActionEditor depth={depth + 1} sourceKind="unit" actions={action.boss.defeatActions} level={level} variables={variables} globalVariables={globalVariables} onEnsureVariable={onEnsureVariable} onEnsureGlobalVariable={onEnsureGlobalVariable} onChange={next => patchAt(index, { ...action, boss: { ...action.boss, defeatActions: next } })} /></div>}
      </div>}
    </details>)}
    {showCommandPalette ? <aside aria-label="指令列表" className="absolute bottom-0 right-0 top-[38px] z-10 w-[190px] overflow-y-auto border-l-2 border-black bg-[#C9C29F] p-2 max-[640px]:static max-[640px]:mt-2 max-[640px]:w-full max-[640px]:border-l-0 max-[640px]:border-t-2">
      <div className="sticky top-0 mb-1 border-b border-black/35 bg-[#C9C29F] pb-1 font-comic text-[11px] font-black">指令列表</div>
      <div className="mb-1 text-[8px] font-black text-black/50">演出</div>
      <div className="grid grid-cols-2 gap-1">{(['dialogue', 'text', 'wait', 'camera'] as ActionKind[]).map(type => <button key={type} type="button" className="comic-btn min-w-0 px-1 py-1 text-left text-[8px] font-black leading-tight" onClick={() => appendAction(type)}>＋ {ACTION_NAMES[type]}</button>)}</div>
      <div className="mb-1 mt-2 text-[8px] font-black text-black/50">界面</div>
      <div className="grid grid-cols-2 gap-1">{(['choice', 'assembly'] as ActionKind[]).map(type => <button key={type} type="button" className="comic-btn min-w-0 px-1 py-1 text-left text-[8px] font-black leading-tight" onClick={() => appendAction(type)}>＋ {ACTION_NAMES[type]}</button>)}</div>
      <div className="mb-1 mt-2 text-[8px] font-black text-black/50">单位</div>
      <div className="grid grid-cols-2 gap-1">{(['move', 'altitude', 'hold', 'attack', 'ai', 'remove', 'behavior', 'faction'] as UnitCommandKind[]).map(kind => <button key={kind} type="button" className="comic-btn min-w-0 px-1 py-1 text-left text-[8px] font-black leading-tight" onClick={() => appendUnitAction(kind)}>＋ {UNIT_COMMAND_NAMES[kind]}</button>)}</div>
      <div className="mb-1 mt-2 text-[8px] font-black text-black/50">游戏与逻辑</div>
      <div className="grid grid-cols-2 gap-1">{(Object.keys(ACTION_NAMES) as ActionKind[]).filter(type => !(['dialogue', 'text', 'wait', 'camera', 'choice', 'assembly', 'unit'] as ActionKind[]).includes(type)).map(type => <button key={type} type="button" className="comic-btn min-w-0 px-1 py-1 text-left text-[8px] font-black leading-tight" onClick={() => appendAction(type)}>＋ {ACTION_NAMES[type]}</button>)}</div>
    </aside> : <select aria-label="新增动作" className="w-full px-1 py-0.5 text-[9px] font-comic border border-black bg-[#EFEBD8]" value="" onChange={e => { if (!e.target.value) return; if (e.target.value.startsWith('unit:')) appendUnitAction(e.target.value.slice(5) as UnitCommandKind); else appendAction(e.target.value as ActionKind) }}><option value="">＋ 添加动作…</option><optgroup label="演出">{(['dialogue', 'text', 'wait', 'camera'] as ActionKind[]).map(k => <option key={k} value={k}>{ACTION_NAMES[k]}</option>)}</optgroup><optgroup label="界面">{(['choice', 'assembly'] as ActionKind[]).map(k => <option key={k} value={k}>{ACTION_NAMES[k]}</option>)}</optgroup><optgroup label="单位">{(['move', 'altitude', 'hold', 'attack', 'ai', 'remove', 'behavior', 'faction'] as UnitCommandKind[]).map(kind => <option key={kind} value={`unit:${kind}`}>{UNIT_COMMAND_NAMES[kind]}</option>)}</optgroup><optgroup label="游戏与逻辑">{(Object.keys(ACTION_NAMES) as ActionKind[]).filter(type => !(['dialogue', 'text', 'wait', 'camera', 'choice', 'assembly', 'unit'] as ActionKind[]).includes(type)).map(k => <option key={k} value={k}>{ACTION_NAMES[k]}</option>)}</optgroup></select>}
  </div>
}

/** 角度最短路径插值（环绕 ±π） */
function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2)
  if (d > Math.PI) d -= Math.PI * 2
  if (d < -Math.PI) d += Math.PI * 2
  return a + d * t
}

/**
 * 渲染插值视图：逻辑 10Hz 固定步长，渲染帧在 prev/cur 两个逻辑状态间插值。
 * 战斗单位/弹道按 id 配对 lerp x/y，所有阵营炮塔共用位置与角度插值；载具额外插值朝向与嵌套炮塔。
 * 不 mutate cur state（map 新对象）。
 */
// v1.55：插值查找表按 prev 状态身份缓存（prev 每 tick 才变，避免每帧重复重建 Map）
let _interpPrev: GameState | null = null
let _interpMaps: {
  enemies: Map<number, GameState['enemies'][number]>
  allies: Map<number, GameState['allies'][number]>
  projectiles: Map<number, GameState['projectiles'][number]>
  enemyProjectiles: Map<number, GameState['enemyProjectiles'][number]>
  turrets: Map<number, GameState['turrets'][number]>
} | null = null

function interpolateTurret(prev: Turret, cur: Turret, alpha: number): Turret {
  return {
    ...cur,
    angle: lerpAngle(prev.angle, cur.angle, alpha),
    x: prev.x + (cur.x - prev.x) * alpha,
    y: prev.y + (cur.y - prev.y) * alpha,
  }
}

type VehicleHost = { x: number; y: number; vehicle?: UnitVehicleRuntime; aircraft?: UnitAircraftRuntime }

/** 敌我阵营无关的载具渲染插值：车体与挂载炮塔必须处于同一个逻辑帧进度。 */
function interpolateVehicleHost<T extends VehicleHost>(prev: T, cur: T, alpha: number): T {
  let base = {
    ...cur,
    x: prev.x + (cur.x - prev.x) * alpha,
    y: prev.y + (cur.y - prev.y) * alpha,
  }
  if (prev.aircraft && cur.aircraft) base = {
    ...base,
    aircraft: {
      ...cur.aircraft,
      heading: lerpAngle(prev.aircraft.heading, cur.aircraft.heading, alpha),
      vx: prev.aircraft.vx + (cur.aircraft.vx - prev.aircraft.vx) * alpha,
      vy: prev.aircraft.vy + (cur.aircraft.vy - prev.aircraft.vy) * alpha,
      altitude: (prev.aircraft.altitude ?? cur.aircraft.altitude) + (cur.aircraft.altitude - (prev.aircraft.altitude ?? cur.aircraft.altitude)) * alpha,
      verticalSpeed: (prev.aircraft.verticalSpeed ?? 0) + ((cur.aircraft.verticalSpeed ?? 0) - (prev.aircraft.verticalSpeed ?? 0)) * alpha,
    },
  }
  if (!prev.vehicle || !cur.vehicle) return base
  const prevTurrets = new Map((prev.vehicle.turrets ?? []).map(turret => [turret.id, turret]))
  return {
    ...base,
    vehicle: {
      ...cur.vehicle,
      heading: lerpAngle(prev.vehicle.heading, cur.vehicle.heading, alpha),
      steerAngle: lerpAngle(prev.vehicle.steerAngle, cur.vehicle.steerAngle, alpha),
      turnW: prev.vehicle.turnW + (cur.vehicle.turnW - prev.vehicle.turnW) * alpha,
      vx: prev.vehicle.vx + (cur.vehicle.vx - prev.vehicle.vx) * alpha,
      vy: prev.vehicle.vy + (cur.vehicle.vy - prev.vehicle.vy) * alpha,
      trackPhase: (cur.vehicle.trackPhase ?? []).map((value, index) => {
        const previous = prev.vehicle!.trackPhase?.[index]
        return previous === undefined ? value : previous + (value - previous) * alpha
      }),
      turrets: cur.vehicle.turrets?.map(turret => {
        const previous = prevTurrets.get(turret.id)
        return previous ? interpolateTurret(previous, turret, alpha) : turret
      }),
    },
  }
}

function interpolate(prev: GameState | null, cur: GameState, alpha: number): GameState {
  if (!prev || alpha >= 1) return cur
  if (prev !== _interpPrev || !_interpMaps) {
    _interpPrev = prev
    _interpMaps = {
      enemies: new Map(prev.enemies.map(e => [e.id, e])),
      allies: new Map(prev.allies.map(a => [a.id, a])),
      projectiles: new Map(prev.projectiles.map(p => [p.id, p])),
      enemyProjectiles: new Map(prev.enemyProjectiles.map(p => [p.id, p])),
      turrets: new Map(prev.turrets.map(t => [t.id, t])),
    }
  }
  const prevEnemies = _interpMaps.enemies
  const enemies = cur.enemies.map(e => {
    const p = prevEnemies.get(e.id)
    if (!p) return e // 新出现不插值
    return interpolateVehicleHost(p, e, alpha)
  })
  const prevAllies = _interpMaps.allies
  const allies = cur.allies.map(a => {
    const p = prevAllies.get(a.id)
    if (!p) return a
    return interpolateVehicleHost(p, a, alpha)
  })
  const prevProj = _interpMaps.projectiles
  const projectiles = cur.projectiles.map(pj => {
    const p = prevProj.get(pj.id)
    if (!p) return pj
    return { ...pj, x: p.x + (pj.x - p.x) * alpha, y: p.y + (pj.y - p.y) * alpha }
  })
  const prevEnemyProj = _interpMaps.enemyProjectiles
  const enemyProjectiles = cur.enemyProjectiles.map(pj => {
    const p = prevEnemyProj.get(pj.id)
    if (!p) return pj
    return { ...pj, x: p.x + (pj.x - p.x) * alpha, y: p.y + (pj.y - p.y) * alpha }
  })
  const prevTurrets = _interpMaps.turrets
  const turrets = cur.turrets.map(t => {
    const p = prevTurrets.get(t.id)
    if (!p) return t
    return interpolateTurret(p, t, alpha)
  })
  const fortress = {
    ...cur.fortress,
    x: prev.fortress.x + (cur.fortress.x - prev.fortress.x) * alpha,
    y: prev.fortress.y + (cur.fortress.y - prev.fortress.y) * alpha,
    heading: lerpAngle(prev.fortress.heading, cur.fortress.heading, alpha),
    // v1.88：履带相位随 rAF 插值——10Hz 逻辑帧下满速每 tick 恰好整 3 个瓦片步进，
    // 落点重合产生"静止"错觉（频闪混叠）；插值后每帧约 0.1 格平滑滚动。仅视觉，物理不变。
    trackPhase: cur.fortress.trackPhase.map((v, i) => {
      const pv = prev.fortress.trackPhase[i]
      return pv === undefined ? v : pv + (v - pv) * alpha
    }),
  }
  return { ...cur, time: prev.time + (cur.time - prev.time) * alpha, enemies, allies, projectiles, enemyProjectiles, turrets, fortress }
}
// v1.88：e2e 钩子——无头环境 rAF 会被冻结，直接对纯函数做确定性断言
if (typeof window !== 'undefined') { (window as unknown as { __tdInterp?: typeof interpolate }).__tdInterp = interpolate }

type LevelWorldKind = 'terrain' | 'object'

/** 关卡实例事件编辑器：类型事件只作为新实例模板，之后各实例独立修改。 */
function LevelObjectInstanceEvents({ object, level, globalVariables, focusedEventId, onEnsureVariable, onEnsureGlobalVariable, onPatch }: {
  object: LevelObject
  level: LevelConfig
  globalVariables: LevelVariableDef[]
  focusedEventId?: number
  onEnsureVariable: (name: string, type: LevelVariableDef['type']) => string
  onEnsureGlobalVariable: (name: string, type: LevelVariableDef['type']) => string
  onPatch: (change: (events: LevelObjectEvent[]) => LevelObjectEvent[]) => void
}) {
  const initialFocusedEventId = focusedEventId !== undefined && (object.events ?? objectTypeById(object.defId)?.events ?? []).some(event => event.id === focusedEventId) ? focusedEventId : null
  const [selectedId, setSelectedId] = useState<number | null>(initialFocusedEventId)
  const events = object.events ?? objectTypeById(object.defId)?.events ?? []
  const selected = events.find(event => event.id === selectedId)
  const patchSelected = (change: (event: LevelObjectEvent) => LevelObjectEvent) => onPatch(items => items.map(item => item.id === selectedId ? change(item) : item))
  return <div className="border-t border-black/25 pt-1 space-y-1">
    <div className="flex items-center gap-1"><span className="text-[8px] font-black">实例事件</span><span className="text-[7px] text-black/40">{events.length}</span><button type="button" className="ml-auto comic-btn px-1 py-0 text-[8px]" onClick={() => { const id = Math.max(0, ...events.map(item => item.id)) + 1; onPatch(items => [...items, { id, name: `事件 ${id}`, trigger: 'interact', activationLimit: 1, cooldown: 0, conditions: emptyConditionGroup(), actions: [] }]); setSelectedId(id) }}>＋事件</button></div>
    <div className="space-y-0.5">{events.length === 0 ? <div className="text-[8px] text-black/40">暂无实例事件</div> : events.map(event => <button key={event.id} type="button" className="w-full border border-black/25 px-1 py-0.5 text-left text-[8px] font-bold" onClick={() => setSelectedId(event.id)}>{event.name}<span className="float-right text-black/40">{{ interact: '气泡按钮', destroyed: '物体摧毁', contact: '接触物体' }[event.trigger]}</span></button>)}</div>
    {selected ? <EventEditorModal title={`编辑物体实例事件 · ${selected.name}`} onClose={() => setSelectedId(null)}>
      <div className="flex items-center gap-1"><input aria-label="物体实例事件名称" className="flex-1 min-w-0 px-1 border border-black bg-[#EFEBD8] text-[10px]" value={selected.name} onChange={event => patchSelected(item => ({ ...item, name: event.target.value }))} /><button type="button" className="comic-btn px-2 py-0.5 text-[9px]" onClick={() => { onPatch(items => items.filter(item => item.id !== selected.id)); setSelectedId(null) }}>删除</button></div>
      <div className="grid grid-cols-2 gap-1"><label className="text-[8px] font-black">次数（0=无限）<ValidatedNumberInput min={0} className="w-full px-1 border border-black bg-[#EFEBD8]" value={selected.activationLimit} onChange={event => patchSelected(item => ({ ...item, activationLimit: Math.max(0, Math.round(Number(event.target.value) || 0)) }))} /></label><label className="text-[8px] font-black">冷却（秒）<ValidatedNumberInput min={0} step={0.1} className="w-full px-1 border border-black bg-[#EFEBD8]" value={selected.cooldown} onChange={event => patchSelected(item => ({ ...item, cooldown: Math.max(0, Number(event.target.value) || 0) }))} /></label></div>
      <div className="border border-black/25 p-1"><label className="flex items-center gap-1 text-[8px] font-black"><span className="w-14">触发方式</span><select aria-label="物体实例事件触发方式" className="flex-1 min-w-0 px-1 border border-black bg-[#EFEBD8]" value={selected.trigger} onChange={event => patchSelected(item => ({ ...item, trigger: event.target.value as LevelObjectEvent['trigger'] }))}><option value="interact">气泡按钮</option><option value="destroyed">物体摧毁</option><option value="contact">接触物体（包括碰撞）</option></select></label></div>
      <EventConditionEditor ariaPrefix="物体实例事件" conditions={selected.conditions} level={level} globalVariables={globalVariables} onChange={conditions => patchSelected(item => ({ ...item, conditions }))} />
      <ActionEditor showCommandPalette sourceKind="object" actions={selected.actions} level={level} variables={level.variables} globalVariables={globalVariables} onEnsureVariable={onEnsureVariable} onEnsureGlobalVariable={onEnsureGlobalVariable} onChange={actions => patchSelected(item => ({ ...item, actions }))} />
    </EventEditorModal> : null}
  </div>
}

/** 关卡编辑器内的地形/物体类型管理与放置入口。 */
function LevelWorldTypePanel({ kind, selectedDefinitionId, onSelectedDefinitionId, onPlace, level, globalVariables, onEnsureGlobalVariable, onBeforePersist }: { kind: LevelWorldKind; selectedDefinitionId: string; onSelectedDefinitionId: (id: string) => void; onPlace: (id: string) => void; level: LevelConfig; globalVariables: LevelVariableDef[]; onEnsureGlobalVariable: (name: string, type: LevelVariableDef['type']) => string; onBeforePersist: () => void }) {
  const isTerrain = kind === 'terrain'
  const initialTerrain = terrainTypeById(selectedDefinitionId) ?? terrainTypeLibrary()[0] ?? newTerrainType()
  const initialObject = objectTypeById(selectedDefinitionId) ?? objectTypeLibrary()[0] ?? newObjectType()
  const [selectedId, setSelectedId] = useState(isTerrain ? initialTerrain.id : initialObject.id)
  const [terrainDraft, setTerrainDraft] = useState<TerrainTypeDef>(() => structuredClone(initialTerrain))
  const [objectDraft, setObjectDraft] = useState<ObjectTypeDef>(() => structuredClone(initialObject))
  const [selectedObjectEventId, setSelectedObjectEventId] = useState<number | null>(null)
  const [message, setMessage] = useState('')
  const [, setRevision] = useState(0)
  const definitions = isTerrain ? terrainTypeLibrary() : objectTypeLibrary()
  const draft = isTerrain ? terrainDraft : objectDraft
  const builtin = isTerrain ? isBuiltinTerrainType(selectedId) : isBuiltinObjectType(selectedId)
  const overridden = isTerrain ? isTerrainTypeOverridden(selectedId) : isObjectTypeOverridden(selectedId)
  const assets = isTerrain
    ? filterAssets('tile').filter(asset => asset.tileSheet?.kind === 'autotileStatic' || asset.tileSheet?.kind === 'autotileAnimated')
    : filterAssets('worldObject')

  const selectDefinition = (id: string) => {
    setSelectedId(id); setMessage('')
    if (isTerrain) {
      const next = terrainTypeById(id)
      if (next) { onSelectedDefinitionId(id); setTerrainDraft(structuredClone(next)); onPlace(id) }
    } else {
      const next = objectTypeById(id)
      if (next) { onSelectedDefinitionId(id); setObjectDraft(structuredClone(next)); setSelectedObjectEventId(null); onPlace(id) }
    }
  }
  const createDefinition = () => {
    onBeforePersist()
    if (isTerrain) {
      const next = newTerrainType(); saveTerrainType(next); onSelectedDefinitionId(next.id)
      setSelectedId(next.id); setTerrainDraft(next)
    } else {
      const next = newObjectType(); saveObjectType(next); onSelectedDefinitionId(next.id)
      setSelectedId(next.id); setObjectDraft(next); setSelectedObjectEventId(null); onPlace(next.id)
    }
    setRevision(value => value + 1); setMessage(isTerrain ? '已新建类型，请编辑后保存' : '已新建类型，修改将自动保存')
  }
  const saveDefinition = () => {
    onBeforePersist()
    if (isTerrain) saveTerrainType(terrainDraft); else saveObjectType(objectDraft)
    setRevision(value => value + 1)
    setMessage(worldTypePersistFailed() ? '保存失败：浏览器存储不可用或空间不足' : '已保存 ✓')
  }
  const removeOrRestore = () => {
    onBeforePersist()
    if (isTerrain) {
      deleteTerrainType(selectedId)
      const next = terrainTypeLibrary()[0] ?? newTerrainType(); onSelectedDefinitionId(next.id)
      setSelectedId(next.id); setTerrainDraft(structuredClone(next))
    } else {
      deleteObjectType(selectedId)
      const next = objectTypeLibrary()[0] ?? newObjectType(); onSelectedDefinitionId(next.id)
      setSelectedId(next.id); setObjectDraft(structuredClone(next)); setSelectedObjectEventId(null); onPlace(next.id)
    }
    setRevision(value => value + 1); setMessage(builtin ? '已恢复内置定义' : '已删除类型')
  }

  // 物体定义采用自动保存；内容未变化时不写入，避免仅打开内置物体就生成覆盖记录。
  useEffect(() => {
    if (isTerrain) return
    const persisted = objectTypeById(objectDraft.id)
    if (JSON.stringify(persisted) === JSON.stringify(objectDraft)) return
    const timer = window.setTimeout(() => {
      onBeforePersist()
      saveObjectType(objectDraft)
      setRevision(value => value + 1)
      setMessage(worldTypePersistFailed() ? '自动保存失败：浏览器存储不可用或空间不足' : '已自动保存 ✓')
    }, 180)
    return () => window.clearTimeout(timer)
  }, [isTerrain, objectDraft, onBeforePersist])

  const expandedEditor = <div className="border-t-2 border-black/30 bg-[#D2CCA9] p-2 space-y-2">
    {!isTerrain ? <div className="flex items-center gap-1">
      <span className="text-[7px] font-bold text-black/40">{builtin ? overridden ? '内置覆盖' : '内置定义' : '自定义定义'}</span>
    </div> : null}
    <div className="grid grid-cols-[64px_1fr] gap-x-1 gap-y-1 items-center">
      <div className="col-span-2 grid grid-cols-2 gap-2">
        <label className="flex items-center gap-1 text-[8px] font-black"><span className="shrink-0">名称</span><input aria-label={`${isTerrain ? '地形' : '物体'}名称`} className="flex-1 min-w-0 px-1 border border-black bg-[#EFEBD8] text-[9px]" value={draft.name} onChange={event => isTerrain ? setTerrainDraft(value => ({ ...value, name: event.target.value })) : setObjectDraft(value => ({ ...value, name: event.target.value }))} /></label>
        <label className="flex items-center gap-1 text-[8px] font-black"><span className="shrink-0">贴图</span><select aria-label={`${isTerrain ? '地形' : '物体'}贴图`} className="flex-1 min-w-0 px-1 border border-black bg-[#EFEBD8] text-[9px]" value={draft.asset ?? ''} onChange={event => isTerrain ? setTerrainDraft(value => ({ ...value, asset: event.target.value || undefined })) : setObjectDraft(value => { const asset = event.target.value || undefined; return { ...value, asset, defaultW: isAutotileAsset(asset) ? 1 : value.defaultW, defaultH: isAutotileAsset(asset) ? 1 : value.defaultH } })}><option value="">{isTerrain ? '无（白色）' : '无（程序化）'}</option>{assets.map(asset => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</select></label>
      </div>
      {!isTerrain ? <div className="col-span-2 grid grid-cols-2 gap-2">
        <label className="flex items-center gap-1 text-[8px] font-black"><span className="shrink-0">占格</span>{isAutotileAsset(objectDraft.asset) ? <span className="font-bold">1 × 1（Autotile 固定）</span> : <span className="flex min-w-0 flex-1 items-center gap-1"><ValidatedNumberInput aria-label="占格宽度" min={1} max={64} className="min-w-0 flex-1 px-1 border border-black bg-[#EFEBD8] text-[9px]" value={objectDraft.defaultW} onChange={event => setObjectDraft(value => ({ ...value, defaultW: Math.max(1, Number(event.target.value) || 1) }))} /><span>×</span><ValidatedNumberInput aria-label="占格高度" min={1} max={64} className="min-w-0 flex-1 px-1 border border-black bg-[#EFEBD8] text-[9px]" value={objectDraft.defaultH} onChange={event => setObjectDraft(value => ({ ...value, defaultH: Math.max(1, Number(event.target.value) || 1) }))} /></span>}</label>
        <label className="flex items-center gap-1 text-[8px] font-black"><span className="shrink-0">层级</span><select aria-label="物体显示层级" className="min-w-0 flex-1 px-1 border border-black bg-[#EFEBD8] text-[9px]" value={objectDraft.renderLayer} onChange={event => setObjectDraft(value => ({ ...value, renderLayer: Number(event.target.value) as 1 | 2 | 3 | 4 | 5 }))}>{[1, 2, 3, 4, 5].map(layer => <option key={layer} value={layer}>{layer}</option>)}</select></label>
      </div> : null}
      {isTerrain ? <><label className="text-[8px] font-black">地形效果</label><select aria-label="地形效果" className="min-w-0 px-1 border border-black bg-[#EFEBD8] text-[9px]" value={terrainDraft.effect ?? (terrainDraft.moveModifier !== 1 ? 'moveModifier' : 'none')} onChange={event => setTerrainDraft(value => ({ ...value, effect: event.target.value as 'none' | 'moveModifier', moveModifier: event.target.value === 'moveModifier' ? value.moveModifier : 1 }))}><option value="none">无效果</option><option value="moveModifier">移动倍率</option></select>{(terrainDraft.effect ?? (terrainDraft.moveModifier !== 1 ? 'moveModifier' : 'none')) === 'moveModifier' ? <><label className="text-[8px] font-black">移动倍率</label><ValidatedNumberInput aria-label="移动倍率" min={0.05} max={3} step={0.05} className="w-20 px-1 border border-black bg-[#EFEBD8] text-[9px]" value={terrainDraft.moveModifier} onChange={event => setTerrainDraft(value => ({ ...value, moveModifier: Number(event.target.value) || 1 }))} /></> : null}</> : <>
        <div className="col-span-2 grid grid-cols-2 gap-2">
          <label className="flex items-center gap-1 text-[8px] font-black"><span className="shrink-0">耐久</span><ValidatedNumberInput aria-label="物体耐久" min={0} className="min-w-0 flex-1 px-1 border border-black bg-[#EFEBD8] text-[9px]" value={objectDraft.hp} onChange={event => setObjectDraft(value => ({ ...value, hp: Math.max(0, Number(event.target.value) || 0) }))} /></label>
          <label className="flex items-center gap-1 text-[8px] font-black"><HeightTipLabel /><ValidatedNumberInput aria-label="物体高度" min={0} max={3} step={1} className="min-w-0 flex-1 px-1 border border-black bg-[#EFEBD8] text-[9px]" value={objectDraft.height} onChange={event => setObjectDraft(value => ({ ...value, height: Math.max(0, Math.min(3, Math.round(Number(event.target.value) || 0))) }))} /></label>
        </div>
        <span className="text-[8px] font-black">碰撞</span><div className="flex flex-wrap gap-x-2"><label className="text-[8px] font-bold"><input type="checkbox" checked={objectDraft.blockMove} onChange={event => setObjectDraft(value => ({ ...value, blockMove: event.target.checked }))} /> 挡移动</label><label className="text-[8px] font-bold"><input type="checkbox" checked={objectDraft.blockProjectile} onChange={event => setObjectDraft(value => ({ ...value, blockProjectile: event.target.checked }))} /> 挡弹道</label></div>
        <details className="col-span-2 border border-black/25 p-1"><summary className="cursor-pointer text-[8px] font-black">声音覆盖（可选）</summary><div className="mt-1 grid grid-cols-1 gap-1">{([['destroy', '摧毁'], ['interact', '交互']] as const).map(([key, label]) => <label key={key} className="flex items-center gap-1 text-[8px] font-black"><span className="w-8 shrink-0">{label}</span><LevelSoundAssetSelect label={`物体${label}音效`} value={objectDraft.sounds?.[key]} onChange={next => setObjectDraft(value => ({ ...value, sounds: { ...(value.sounds ?? {}), [key]: next } }))} /></label>)}</div></details>
        <div className="col-span-2 border border-black/25 p-1 space-y-1"><div className="flex items-center gap-1"><span className="text-[8px] font-black">状态列表</span><span className="text-[7px] text-black/40">供条件判断与设置动作共用</span><button type="button" className="ml-auto comic-btn px-1 py-0 text-[8px]" disabled={objectDraft.states.length >= 30} onClick={() => setObjectDraft(value => { let index = value.states.length; let state = `state-${index}`; while (value.states.includes(state)) state = `state-${++index}`; return { ...value, states: [...value.states, state] } })}>＋状态</button></div><div className="grid grid-cols-2 gap-1">{objectDraft.states.map((state, index) => <div key={`${state}-${index}`} className="flex items-center gap-1"><input aria-label={`物体状态 ${index + 1}`} className="min-w-0 flex-1 px-1 border border-black bg-[#EFEBD8] text-[8px]" value={state} readOnly={index === 0} onChange={event => setObjectDraft(value => ({ ...value, states: value.states.map((item, itemIndex) => itemIndex === index ? event.target.value : item) }))} />{index === 0 ? <span className="text-[7px] text-black/40">默认</span> : <button type="button" aria-label={`删除物体状态 ${state}`} className="comic-btn px-1 py-0 text-[8px]" onClick={() => setObjectDraft(value => ({ ...value, states: value.states.filter((_, itemIndex) => itemIndex !== index) }))}>×</button>}</div>)}</div></div>
      </>}
    </div>
    {!isTerrain ? <div className="border-t border-black/30 pt-1 space-y-1">
      <div className="flex items-center gap-1"><span className="text-[9px] font-black">默认事件模板</span><span className="text-[8px] text-black/40">{(objectDraft.events ?? []).length}</span><button type="button" className="ml-auto comic-btn px-1.5 py-0 text-[9px]" onClick={() => { const events = objectDraft.events ?? []; const id = Math.max(0, ...events.map(item => item.id)) + 1; setObjectDraft(value => ({ ...value, events: [...(value.events ?? []), { id, name: `事件 ${id}`, trigger: 'interact', activationLimit: 1, cooldown: 0, conditions: emptyConditionGroup(), actions: [] }] })); setSelectedObjectEventId(id) }}>＋新增</button></div>
      <div className="space-y-0.5 max-h-28 overflow-y-auto">{(objectDraft.events ?? []).length === 0 ? <div className="text-[8px] font-bold text-black/40">暂无事件</div> : (objectDraft.events ?? []).map(objectEvent => <button key={objectEvent.id} type="button" className={`w-full px-1 py-0.5 border text-left flex gap-1 ${selectedObjectEventId === objectEvent.id ? 'border-[#B3392E] bg-[#B3392E]/10' : 'border-black/25'}`} onClick={() => setSelectedObjectEventId(objectEvent.id)}><span className="w-2 h-2 mt-0.5 border border-black bg-[#3E7D46]" /><span className="text-[9px] font-black truncate">{objectEvent.name}</span><span className="ml-auto text-[7px] text-black/45">{{ interact: '气泡按钮', destroyed: '物体摧毁', contact: '接触物体' }[objectEvent.trigger]}</span></button>)}</div>
      {(() => {
        const objectEvent = (objectDraft.events ?? []).find(item => item.id === selectedObjectEventId)
        if (!objectEvent) return null
        const patchObjectEvent = (change: (event: ObjectTypeEvent) => ObjectTypeEvent) => setObjectDraft(value => ({ ...value, events: (value.events ?? []).map(item => item.id === objectEvent.id ? change(item) : item) }))
        return <EventEditorModal title={`编辑物体事件 · ${objectEvent.name}`} onClose={() => setSelectedObjectEventId(null)}>
          <div className="flex items-center gap-1"><input aria-label="物体事件名称" className="flex-1 min-w-0 px-1 border border-black bg-[#EFEBD8] text-[10px]" value={objectEvent.name} onChange={event => patchObjectEvent(item => ({ ...item, name: event.target.value }))} /><button type="button" className="comic-btn px-2 py-0.5 text-[9px]" onClick={() => { setObjectDraft(value => ({ ...value, events: (value.events ?? []).filter(item => item.id !== objectEvent.id) })); setSelectedObjectEventId(null) }}>删除</button></div>
          <div className="grid grid-cols-2 gap-1"><label className="text-[8px] font-black">次数（0=无限）<ValidatedNumberInput min={0} className="w-full px-1 border border-black bg-[#EFEBD8]" value={objectEvent.activationLimit} onChange={event => patchObjectEvent(item => ({ ...item, activationLimit: Math.max(0, Math.round(Number(event.target.value) || 0)) }))} /></label><label className="text-[8px] font-black">冷却（秒）<ValidatedNumberInput min={0} step={0.1} className="w-full px-1 border border-black bg-[#EFEBD8]" value={objectEvent.cooldown} onChange={event => patchObjectEvent(item => ({ ...item, cooldown: Math.max(0, Number(event.target.value) || 0) }))} /></label></div>
          <div className="border border-black/25 p-1"><label className="flex items-center gap-1 text-[8px] font-black"><span className="w-14">触发方式</span><select aria-label="物体事件触发方式" className="flex-1 min-w-0 px-1 border border-black bg-[#EFEBD8]" value={objectEvent.trigger} onChange={event => patchObjectEvent(item => ({ ...item, trigger: event.target.value as ObjectTypeEvent['trigger'] }))}><option value="interact">气泡按钮</option><option value="destroyed">物体摧毁</option><option value="contact">接触物体（包括碰撞）</option></select></label></div>
          <EventConditionEditor ariaPrefix="物体事件" conditions={objectEvent.conditions ?? emptyConditionGroup()} level={level} globalVariables={globalVariables} onChange={conditions => patchObjectEvent(item => ({ ...item, conditions }))} />
          <ActionEditor showCommandPalette sourceKind="object" actions={objectEvent.actions} level={level} variables={level.variables} globalVariables={globalVariables} onEnsureGlobalVariable={onEnsureGlobalVariable} onChange={actions => { ensureActionVariableDefinitions(level.variables, globalVariables, actions); patchObjectEvent(item => ({ ...item, actions })) }} />
        </EventEditorModal>
      })()}
    </div> : null}
    <div className="flex items-center gap-1 border-t border-black/25 pt-1">
      {(!builtin || (!isTerrain && overridden)) && <button type="button" className="comic-btn px-2 py-0.5 text-[8px]" onClick={removeOrRestore}>{builtin ? '恢复内置' : '删除'}</button>}
      {isTerrain ? <button type="button" className="ml-auto comic-btn px-2 py-0.5 text-[8px]" onClick={saveDefinition}>保存</button> : null}
    </div>
    {message && <div className={`text-[8px] font-black ${message.includes('失败') ? 'text-[#B3392E]' : 'text-[#2E7D4F]'}`}>{message}</div>}
  </div>

  return <div className="space-y-1">
    <button type="button" className="absolute top-1 right-2 z-10 px-1.5 py-0 text-[8px] comic-btn font-black bg-[#D9A441]" onClick={createDefinition}>＋ 新建{isTerrain ? '地形' : '物体'}</button>
    <div className="space-y-1" role="list" aria-label={`${isTerrain ? '地形' : '物体'}类型列表`}>
      {definitions.map(def => {
        const selected = def.id === selectedId
        const asset = def.asset ? getAsset(def.asset) : undefined
        const terrainTileKind = isTerrain ? asset?.tileSheet?.kind : undefined
        const terrainTilePreview = isTerrain && asset && (terrainTileKind === 'autotileStatic' || terrainTileKind === 'autotileAnimated')
        return <div key={def.id} role="listitem" className={`border-2 ${!isTerrain && selected ? 'border-[#B3392E]' : 'border-black/30'}`}>
          <button type="button" aria-expanded={selected} className={`w-full p-1 text-left flex items-center gap-1.5 ${selected ? 'bg-[#B3392E]/10' : 'bg-[#D2CCA9]'}`} onClick={() => selectDefinition(def.id)}>
            {isTerrain ? <span aria-hidden="true" className={`w-8 h-8 shrink-0 overflow-hidden border bg-white bg-no-repeat [image-rendering:pixelated] ${terrainTileKind === 'autotileAnimated' ? 'autotile-index-animated' : ''} ${selected ? 'border-2 border-[#B3392E]' : 'border-black/35'}`} style={terrainTilePreview ? { backgroundImage: `url(${asset.src})`, backgroundSize: terrainTileKind === 'autotileAnimated' ? '384px 128px' : '96px 128px', backgroundPosition: '-64px 0' } : undefined} /> : <span className="w-7 h-7 shrink-0 border-2 border-black flex items-center justify-center overflow-hidden" style={{ backgroundColor: def.color }}>{asset ? <img src={asset.src} alt="" className="w-full h-full object-contain" /> : null}</span>}
            <span className="min-w-0 flex-1"><span className="block text-[9px] font-black truncate">{def.name}</span></span>
            {!isTerrain ? <span className="text-[8px] font-black text-black/45">{def.defaultW}×{def.defaultH}</span> : null}
            <span className="text-[10px] font-black">{selected ? '−' : '＋'}</span>
          </button>
          {selected ? expandedEditor : null}
        </div>
      })}
    </div>
  </div>
}

export default function GamePreview() {
  const [game, setGameState] = useState<GameState>(initialState)
  const [mode, setMode] = useState<Mode>({ kind: 'none' })
  const [selTurret, setSelTurret] = useState<number | null>(null)
  const [selectedEnemyUnitId, setSelectedEnemyUnitId] = useState<number | null>(null)
  const [viewY, setViewY] = useState(LEVEL.rows - VIEW_ROWS) // 场景编辑模式手动卷动（游玩模式相机跟随堡垒）
  const [viewX, setViewX] = useState(0)
  const initialZoom = displayConfig().defaultZoom
  const camRef = useRef(playerCenteredCamera(game, BASE_CELL * initialZoom, VIEW_COLS * BASE_CELL, VIEW_ROWS * BASE_CELL)) // 首帧即以玩家为中心；后续由 rAF 相机跟随更新
  const cinematicCameraRef = useRef<{ id: number; fromX: number; fromY: number } | null>(null)
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null)
  const [showDebug, setShowDebug] = useState(false)
  const [showEventMonitor, setShowEventMonitor] = useState(false)
  const [performanceOptions, setPerformanceOptions] = useState<PerformanceMonitorOptions>(() => ({ ...gameParameters().performanceMonitor }))
  const [performanceMonitorCollapsed, setPerformanceMonitorCollapsed] = useState(false)
  const [combatInfoCollapsed, setCombatInfoCollapsed] = useState(false)
  const performanceOptionsRef = useRef(performanceOptions)
  useEffect(() => { performanceOptionsRef.current = performanceOptions }, [performanceOptions])
  useEffect(() => {
    const changed = () => setPerformanceOptions({ ...gameParameters().performanceMonitor })
    window.addEventListener('td-game-parameters-changed', changed)
    return () => window.removeEventListener('td-game-parameters-changed', changed)
  }, [])
  const debugRef = useRef(showDebug) // 主循环读取：DEBUG 打开期间冻结整局模拟
  useEffect(() => { debugRef.current = showDebug }, [showDebug])
  // #18：进关前任务介绍界面；打开期间冻结战斗 tick，选择仅在“开始任务”时正式应用。
  const [missionOpen, setMissionOpen] = useState(true)
  const missionOpenRef = useRef(true)
  const [combatPreparationOpen, setCombatPreparationOpen] = useState(false)
  const [combatPreparationUnitId, setCombatPreparationUnitId] = useState<number | null>(null)
  const [resourceDetailsTarget, setResourceDetailsTarget] = useState<'main' | number | null>(null)
  const combatPreparationOpenRef = useRef(false)
  const [missionLevelId, setMissionLevelId] = useState(LEVEL_LIBRARY.activeId)
  const [missionLoadoutId, setMissionLoadoutId] = useState(() => {
    const entry = LEVEL_LIBRARY.levels.find(item => item.id === LEVEL_LIBRARY.activeId)
    const available = availableMissionLoadouts(entry, loadLevelProgress())
    const persistedId = getSelectedVehicleLoadoutId()
    return available.some(preset => preset.id === persistedId) ? persistedId : (available[0]?.id ?? '')
  })
  const [missionFortressId, setMissionFortressId] = useState(() => {
    const entry = LEVEL_LIBRARY.levels.find(item => item.id === LEVEL_LIBRARY.activeId)
    const available = availableMissionLoadouts(entry, loadLevelProgress())
    const persistedLoadoutId = getSelectedVehicleLoadoutId()
    const selected = available.find(preset => preset.id === persistedLoadoutId) ?? available[0]
    if (selected) return selected.fortressDefId
    const persistedId = getSelectedFortressId()
    const fortresses = availableMissionFortresses(entry, loadLevelProgress())
    return fortresses.some(def => def.id === persistedId) ? persistedId : (fortresses[0]?.id ?? '')
  })
  const [missionProgress, setMissionProgress] = useState(loadLevelProgress)
  const [settlementNewMedals, setSettlementNewMedals] = useState<LevelMedalSlot[]>([])
  const [settlementNewReward, setSettlementNewReward] = useState(0)
  const [settlementNewUnlocks, setSettlementNewUnlocks] = useState<EquipmentUnlockRef[]>([])
  const [audioConfigRevision, setAudioConfigRevision] = useState(0)
  useEffect(() => {
    const changed = () => setAudioConfigRevision(value => value + 1)
    window.addEventListener('td-audio-config-changed', changed)
    return () => window.removeEventListener('td-audio-config-changed', changed)
  }, [])
  useEffect(() => { missionOpenRef.current = missionOpen }, [missionOpen])
  useEffect(() => { combatPreparationOpenRef.current = combatPreparationOpen }, [combatPreparationOpen])
  useEffect(() => {
    const config = audioProjectConfig()
    const music = missionOpen
      ? (config.bgm.missionSelect || BRIEFING_BGM_ASSET_ID)
      : game.phase === 'won' ? config.bgm.victory
        : game.phase === 'lost' ? config.bgm.defeat
          : LEVEL.bgm
    if (music) void audioManager.playMusic(music, { loop: true, fadeIn: 0.25, owner: 'scene' })
    else audioManager.stopMusic({ fadeOut: 0.2, owner: 'scene' })
    return () => audioManager.stopMusic({ fadeOut: 0.12, owner: 'scene' })
  }, [missionOpen, game.phase, audioConfigRevision])
  const [size, setSize] = useState(() => ({ cell: BASE_CELL * displayConfig().defaultZoom, w: VIEW_COLS * BASE_CELL, h: VIEW_ROWS * BASE_CELL }))
  const [canvasFit, setCanvasFit] = useState({ w: VIEW_COLS * BASE_CELL, h: VIEW_ROWS * BASE_CELL })
  const [canvasDisplayScale, setCanvasDisplayScale] = useState(1)
  const [zoomIndicator, setZoomIndicator] = useState<number | null>(null)
  const zoomIndicatorTimerRef = useRef<number | null>(null)
  const zoomRef = useRef(displayConfig().defaultZoom) // 场景缩放：默认/最小/最大值读取游戏参数
  // 全局空间基准：BASE_CELL=32px=1单元格=3.2m；竖版视口宽高对调 12×20
  const portraitRef = useRef(false) // 竖版 = 容器高>宽
  const pinchRef = useRef<{ d0: number; z0: number; midX: number; midY: number; viewX: number; viewY: number } | null>(null) // 双指平移+捏合
  const ptrsRef = useRef<Map<number, { x: number; y: number }>>(new Map())
  // 场景编辑模式：draft 草稿 + 当前笔刷 + 移动笔刷取出的元素；编辑期间本局暂停
  const [edit, setEdit] = useState<LevelEditState | null>(null)
  const [editorInspectorTab, setEditorInspectorTab] = useState<EditorInspectorTab>('tiles')
  const [editorLayer, setEditorLayer] = useState<LevelEditorLayer>('base')
  const [editorTerrainDefId, setEditorTerrainDefId] = useState(() => BRUSH_DEFAULTS.terrainDefId)
  const [editorObjectDefId, setEditorObjectDefId] = useState(() => BRUSH_DEFAULTS.objectDefId)
  const [editorUnitDefId, setEditorUnitDefId] = useState(() => BRUSH_DEFAULTS.unitDefId)
  const [editorSelectedInitialUnitId, setEditorSelectedInitialUnitId] = useState<number | null>(null)
  const [editorSelectedTriggerId, setEditorSelectedTriggerId] = useState<number | null>(null)
  const [editorUnitTypeFilter, setEditorUnitTypeFilter] = useState<UnitType | 'all'>('all')
  const [editorPlacementFaction, setEditorPlacementFaction] = useState<LevelPlacedUnitFaction>('ally')
  const [editorUnitFactionFilter, setEditorUnitFactionFilter] = useState<LevelPlacedUnitFaction | 'all'>('all')
  const [editorUnitGroupFilter, setEditorUnitGroupFilter] = useState<'all' | 'ungrouped' | string>('all')
  const [, refreshUnitEditorContent] = useState(0)
  useEffect(() => {
    const refresh = () => {
      const units = unitLibrary()
      setEditorUnitDefId(current => units.some(unit => unit.id === current) ? current : (units[0]?.id ?? current))
      refreshUnitEditorContent(value => value + 1)
    }
    window.addEventListener(UNIT_LIBRARY_CHANGED_EVENT, refresh)
    window.addEventListener(ASSET_REPLACED_EVENT, refresh)
    return () => {
      window.removeEventListener(UNIT_LIBRARY_CHANGED_EVENT, refresh)
      window.removeEventListener(ASSET_REPLACED_EVENT, refresh)
    }
  }, [])
  const [editorLeftTab, setEditorLeftTab] = useState<'levels' | 'settings'>('levels')
  const [editorShowGrid, setEditorShowGrid] = useState(true)
  const [editorShowHeight, setEditorShowHeight] = useState(false)
  const [editorSnap, setEditorSnap] = useState(true)
  const [editorSelectedEventId, setEditorSelectedEventId] = useState<number | null>(null)
  const [editorEditingEventId, setEditorEditingEventId] = useState<number | null>(null)
  const [editorSelectedUnitEvent, setEditorSelectedUnitEvent] = useState<{ placementId: number; eventId: number } | null>(null)
  const [editorFocusedObjectEvent, setEditorFocusedObjectEvent] = useState<{ objectId: number; eventId: number } | null>(null)
  const [editorSelectedTile, setEditorSelectedTile] = useState<{ layer: 'base' | 'overlay'; x: number; y: number } | null>(null)
  const [editorTileSelection, setEditorTileSelection] = useState<({ layer: 'base' | 'overlay' } & LevelCellRect) | null>(null)
  const [editorTileTemplate, setEditorTileTemplate] = useState<Omit<LevelTileCell, 'x' | 'y'>>({ source: 'autotile', assetId: 'builtin:ground/mid', tileIndex: 0, flipX: false, rotation: 0 })
  const editorClipboardRef = useRef<Picked[] | null>(null)
  const editorMarqueeRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null)
  const [editorLevelQuery, setEditorLevelQuery] = useState('')
  const [editorStageId, setEditorStageId] = useState('')
  const [editorWaveId, setEditorWaveId] = useState('')
  const [editorSpawnRegionId, setEditorSpawnRegionId] = useState<number | null>(null)
  const [editorFortressPlacementTarget, setEditorFortressPlacementTarget] = useState<FortressEditorPlacementTarget | null>(null)
  const [editUndo, setEditUndo] = useState<EditorHistorySnapshot[]>([])
  const [editRedo, setEditRedo] = useState<EditorHistorySnapshot[]>([])
  const [editorHistoryRevision, setEditorHistoryRevision] = useState(0)
  const [editorValidationIssues, setEditorValidationIssues] = useState<LevelValidationIssue[]>([])
  const [editorSavedSnapshot, setEditorSavedSnapshot] = useState('')
  // 要塞内部建造模式（原地建造：隐藏主体只露底座；权限由备战/事件装配/交战中起点区域统一决定）
  const [interior, setInterior] = useState(false)
  const [interiorSel, setInteriorSel] = useState<string | null>(null) // 选中待摆放模块
  const [interiorRot, setInteriorRot] = useState<0 | 1>(0)
  const [interiorDemo, setInteriorDemo] = useState(false) // 拆除模块模式
  const [hoverInterior, setHoverInterior] = useState<{ x: number; y: number } | null>(null)
  // v1.53 右缘悬浮列表面板：炮塔 / 模块；打开期间摇杆禁用。模块面板 = 内部空间模式（隐藏主体与已装炮塔贴图）
  const [panel, setPanel] = useState<null | 'turret' | 'module'>(null)
  const eventAssemblyOpenedRef = useRef<number | null>(null)
  const eventAssemblyId = game.eventAssembly?.id
  useEffect(() => {
    if (eventAssemblyId === undefined || eventAssemblyOpenedRef.current === eventAssemblyId) return
    eventAssemblyOpenedRef.current = eventAssemblyId
    setPanel('turret')
    setInterior(false)
    setInteriorSel(null)
    setInteriorDemo(false)
    setMode({ kind: 'none' })
    setSelTurret(null)
  }, [eventAssemblyId])

  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const dragRef = useRef<EditorPointerGesture | null>(null)
  // 触屏虚拟摇杆：游玩模式按住画布拖动即移动堡垒（点按仍是挂炮/拆除/选中）
  const joyRef = useRef<{ id: number; mode: 'fwd' | 'rev' | null; fAngle: number | null; fDeriv: number; fTime: number } | null>(null) // mode：受控锁定的行驶模式；fAngle/fDeriv/fTime：One Euro 滤波状态
  const [joy, setJoy] = useState<{ x: number; y: number; dx: number; dy: number; rev: boolean } | null>(null)
  const editRef = useRef(edit)
  useEffect(() => {
    editRef.current = edit // 主循环读取最新编辑状态（暂停 tick）
  }, [edit])
  const activeEditorFortressPlacementTarget = edit
    && editorInspectorTab === 'mission'
    && edit.draft.stages.find(item => item.id === editorStageId)?.objective.type === 'fortressDefense'
    ? editorFortressPlacementTarget
    : null

  // gameRef 必须在每次 tick 后先于 React 渲染同步，否则恰好发生在 setGame 与 effect 之间的 keyup
  // 会修改旧状态，随后又被仍带移动输入的新状态覆盖，表现为偶发“松开 W 后持续前进”。
  const gameRef = useRef(game)
  /**
   * gameRef 是战斗中的权威快照；React state 只负责 HUD/弹窗展示。
   * 所有界面操作也先写入权威快照，避免 HUD 限频后用较旧的 React state 覆盖新一帧逻辑。
   */
  const setGame = useCallback((update: GameState | ((current: GameState) => GameState)) => {
    const current = gameRef.current
    const next = typeof update === 'function' ? update(current) : update
    gameRef.current = next
    setGameState(next)
  }, [])
  const completedRunRef = useRef(false)
  const objectiveAudioRef = useRef<[boolean, boolean, boolean]>([
    primaryObjectiveStatus(game),
    game.secondaryObjectivesCompleted[0],
    game.secondaryObjectivesCompleted[1],
  ])
  useEffect(() => {
    if (game.phase !== 'won') {
      completedRunRef.current = false
      return
    }
    if (completedRunRef.current) return
    completedRunRef.current = true
    const before = loadLevelProgress()
    const snapshot = gameRef.current
    const earnedSlots: LevelMedalSlot[] = []
    if (primaryObjectiveStatus(snapshot)) earnedSlots.push('primary')
    if (snapshot.secondaryObjectivesCompleted[0]) earnedSlots.push('secondary-1')
    if (snapshot.secondaryObjectivesCompleted[1]) earnedSlots.push('secondary-2')
    setSettlementNewMedals(earnedSlots.filter(slot => !hasLevelMedal(before, LEVEL_LIBRARY.activeId, slot)))
    const after = completeActiveLevel(earnedSlots)
    setSettlementNewReward(Math.max(0, after.totalReward - before.totalReward))
    const entry = LEVEL_LIBRARY.levels.find(item => item.id === LEVEL_LIBRARY.activeId)
    setSettlementNewUnlocks((entry?.unlockRewards ?? []).filter(ref => !before.unlockedEquipmentIds.includes(equipmentUnlockId(ref)) && after.unlockedEquipmentIds.includes(equipmentUnlockId(ref))))
    setMissionProgress(after)
  }, [game.phase])
  useEffect(() => {
    const current: [boolean, boolean, boolean] = [primaryObjectiveStatus(game), game.secondaryObjectivesCompleted[0], game.secondaryObjectivesCompleted[1]]
    if (!missionOpen && !edit && current.some((done, index) => done && !objectiveAudioRef.current[index])) void playCue(resolveCue(undefined, 'taskComplete'))
    objectiveAudioRef.current = current
  }, [game, missionOpen, edit])
  useEffect(() => {
    if (settlementNewReward > 0) void playCue(resolveCue(undefined, 'reward'))
  }, [settlementNewReward])
  // 常规载具使用坦克式键位；步行机甲使用屏幕方向八向输入，并由机体平滑转向移动方向。
  // 写入 gameRef.current，tick 每帧消费并随克隆延续。
  const keysRef = useRef<Set<string>>(new Set())
  // 键位 → 操控状态（keydown/keyup/摇杆释放共用）
  const applyKeys = useCallback(() => {
    const k = keysRef.current
    const g = gameRef.current
    const fwd = k.has('w') || k.has('arrowup')
    const back = k.has('s') || k.has('arrowdown')
    const left = k.has('a') || k.has('arrowleft')
    const right = k.has('d') || k.has('arrowright')
    if (fortressDef(g).chassis === 'walker') {
      g.moveDir.x = (right ? 1 : 0) - (left ? 1 : 0)
      g.moveDir.y = (back ? 1 : 0) - (fwd ? 1 : 0)
      g.turnDir = 0
      g.reverse = false
      g.moveMag = 1
      g.desiredHeading = g.moveDir.x !== 0 || g.moveDir.y !== 0 ? Math.atan2(g.moveDir.x, -g.moveDir.y) : null
      return
    }
    g.turnDir = (right ? 1 : 0) - (left ? 1 : 0) // A/← 左转、D/→ 右转
    if (fwd && !back) { // 沿当前朝向正前方（前进方向每 tick 跟随船头刷新，见主循环）
      g.moveDir.x = dirX(g.fortress.heading)
      g.moveDir.y = dirY(g.fortress.heading)
      g.reverse = false
    } else if (back && !fwd) { // 沿正后方倒退（倒退系数生效）
      g.moveDir.x = 0
      g.moveDir.y = 0
      g.reverse = true
    } else {
      g.moveDir.x = 0
      g.moveDir.y = 0
      g.reverse = false
    }
    g.moveMag = 1 // 键盘恒全速
    g.desiredHeading = null // 键盘操控优先：清除摇杆朝向指令
  }, [])
  const releaseJoystick = useCallback((pointerId?: number) => {
    if (pointerId !== undefined && joyRef.current?.id !== pointerId) return
    joyRef.current = null
    setJoy(null)
    applyKeys() // PC 键盘仍按住时立即恢复键盘控制，否则清空全部移动输入
  }, [applyKeys])
  const releaseAllMovement = useCallback(() => {
    if (dragRef.current?.holdTimer) window.clearTimeout(dragRef.current.holdTimer)
    dragRef.current = null
    pinchRef.current = null
    ptrsRef.current.clear()
    keysRef.current.clear()
    joyRef.current = null
    setJoy(null)
    applyKeys()
  }, [applyKeys])
  const toggleDebug = useCallback(() => {
    releaseAllMovement()
    setShowDebug(current => {
      const next = !current
      debugRef.current = next
      return next
    })
  }, [releaseAllMovement])
  const closeDebug = useCallback(() => {
    debugRef.current = false
    setShowDebug(false)
  }, [])
  useEffect(() => {
    const MOVE_KEYS = ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'] // v1.61：q/e 移除
    const update = applyKeys
    const down = (ev: KeyboardEvent) => {
      const key = ev.key.toLowerCase()
      if (!MOVE_KEYS.includes(key)) return
      if (missionOpenRef.current || combatPreparationOpenRef.current || editRef.current || debugRef.current) return // 覆盖界面打开时不驱动堡垒
      const target = ev.target as HTMLElement | null
      if (target?.matches('input, textarea, select, [contenteditable="true"]')) return
      ev.preventDefault()
      keysRef.current.add(key)
      update()
    }
    const up = (ev: KeyboardEvent) => {
      const key = ev.key.toLowerCase()
      if (!MOVE_KEYS.includes(key)) return
      keysRef.current.delete(key)
      update()
    }
    // 切换窗口/标签页时浏览器可能不会再派发 keyup；必须主动释放，避免 W/A/S/D 卡住。
    const release = () => releaseAllMovement()
    const releaseWhenHidden = () => { if (document.hidden) release() }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', release)
    window.addEventListener('pagehide', release)
    window.addEventListener('orientationchange', release)
    document.addEventListener('visibilitychange', releaseWhenHidden)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', release)
      window.removeEventListener('pagehide', release)
      window.removeEventListener('orientationchange', release)
      document.removeEventListener('visibilitychange', releaseWhenHidden)
    }
  }, [applyKeys, releaseAllMovement])

  // 任意会遮挡或接管战场的界面出现时强制释放触摸摇杆，避免手指被弹窗截走后持续移动。
  useEffect(() => {
    if (missionOpen || combatPreparationOpen || edit || showDebug || panel !== null || game.eventChoice || game.eventAssembly
      || game.phase === 'won' || game.phase === 'lost') releaseJoystick()
  }, [combatPreparationOpen, edit, game.eventAssembly, game.eventChoice, game.phase, missionOpen, panel, releaseJoystick, showDebug])

  // 内部建造模式快捷键：R 旋转模块；ESC 取消选择/退出
  useEffect(() => {
    if (!interior) return
    const onKey = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase()
      if ((e.target as HTMLElement | null)?.tagName === 'INPUT') return
      if (key === 'r') { if (interiorSel) setInteriorRot(r => (r ? 0 : 1)) }
      else if (key === 'escape') {
        if (interiorSel || interiorDemo) { setInteriorSel(null); setInteriorDemo(false) }
        else setInterior(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [interior, interiorSel, interiorDemo])

  // 调试探针：暴露最新游戏状态（无头测试用）
  useEffect(() => {
    (window as unknown as Record<string, unknown>).__game = game
  }, [game])
  // v1.53 调试探针：暴露 UI 面板状态（无头测试用）
  useEffect(() => {
    (window as unknown as Record<string, unknown>).__ui = { panel, mode: mode.kind, interior, touchJoystick: !!joy, combatPreparationOpen, camRef }
  }, [combatPreparationOpen, panel, mode, interior, joy])

  // 性能探针（诊断卡顿用）：draw/tick 耗时的指数均值与峰值
  const perfRef = useRef({ drawMs: 0, drawMax: 0, tickMs: 0, tickMax: 0, engine: enginePerformanceSnapshot() })
  const performanceAccumulatorRef = useRef(createPerformanceMonitorAccumulator())
  useEffect(() => {
    performanceAccumulatorRef.current = createPerformanceMonitorAccumulator()
    resetPerformanceMonitorSnapshot()
  }, [performanceOptions.enabled])
  useEffect(() => {
    (window as unknown as Record<string, unknown>).__perf = perfRef.current
  }, [])

  // 音频只消费战斗已经产生的表现事件，不进入伤害、物理或确定性模拟。
  const audioSeenRef = useRef({ impact: 0, explosion: 0, shield: 0, unitHit: 0, notice: 0, signal: 0 })
  const audioLoopKeysRef = useRef(new Map<string, string>())
  const audioLoopFadeOutRef = useRef(new Map<string, number>())
  // 射线起射先播放一次开火声；token 存在期间禁止持续循环声提前接入。
  const beamIntroTokenRef = useRef(new Map<string, number>())
  const nextBeamIntroTokenRef = useRef(1)
  const previousUnitPositionsRef = useRef(new Map<string, { x: number; y: number }>())
  const previousTurretAudioRef = useRef(new Map<number, { charge: number }>())
  const previousOverheatRef = useRef(new Map<string, boolean>())
  const previousShieldOnlineRef = useRef(false)
  const stopAllCombatAudioLoops = useCallback(() => {
    for (const key of audioLoopKeysRef.current.keys()) stopCueLoop(key, audioLoopFadeOutRef.current.get(key) ?? 0)
    audioLoopKeysRef.current.clear()
    audioLoopFadeOutRef.current.clear()
    beamIntroTokenRef.current.clear()
  }, [])
  useEffect(() => {
    stopAllCombatAudioLoops()
  }, [audioConfigRevision, stopAllCombatAudioLoops])
  useEffect(() => {
    if (missionOpen || combatPreparationOpen || edit || showDebug) stopAllCombatAudioLoops()
  }, [combatPreparationOpen, edit, missionOpen, showDebug, stopAllCombatAudioLoops])
  useEffect(() => {
    if (missionOpen || combatPreparationOpen) prewarmCombatResources(gameRef.current)
  }, [audioConfigRevision, combatPreparationOpen, game.fortressDefId, missionOpen])
  useEffect(() => {
    if (missionOpen || combatPreparationOpen || edit || showDebug) {
      return
    }
    const { turretsById, projectilesById } = combatAudioDefinitions()
    const seen = audioSeenRef.current
    const listenerRect = fortressRect(game)
    const listener = { x: listenerRect.x + listenerRect.w / 2, y: listenerRect.y + listenerRect.h / 2 }
    const distanceTo = (x: number | undefined, y: number | undefined) => x === undefined || y === undefined ? undefined : Math.hypot(x - listener.x, y - listener.y)
    const shieldOnline = game.fortress.maxShield > 0 && game.fortress.shield > 0
    if (shieldOnline && !previousShieldOnlineRef.current) void playCue(resolveCue(undefined, 'shieldSpawn'), { distance: 0 })
    previousShieldOnlineRef.current = shieldOnline
    for (const event of game.impacts) if (event.id > seen.impact) {
      const ammo = projectilesById.get(event.ammoId ?? '')
      void playCue(resolveCue(ammo?.sounds?.impact), { distance: distanceTo(event.x, event.y) })
    }
    for (const event of game.explosions) if (event.id > seen.explosion) {
      const ammo = projectilesById.get(event.ammoId ?? '')
      // 单位摧毁音效由带单位定义的 audioSignal 播放，避免爆炸事件重复叠播一次全局死亡音效。
      if (event.kind !== 'unitDeath') void playCue(resolveCue(ammo?.sounds?.explosion), { volumeScale: Math.max(0.35, Math.min(1.5, event.r)), distance: distanceTo(event.x, event.y) })
    }
    for (const event of game.shieldHits) if (event.id > seen.shield) void playCue(resolveCue(undefined, event.broken ? 'shieldBreak' : 'shieldHit'), { distance: distanceTo(event.x, event.y) })
    for (const event of game.unitHits) if (event.id > seen.unitHit) {
      const ammo = projectilesById.get(event.ammoId ?? '')
      void playCue(resolveCue(event.ricochet ? ammo?.sounds?.ricochet : ammo?.sounds?.impact), { distance: distanceTo(event.x, event.y) })
    }
    for (const event of game.notices) if (event.id > seen.notice) void playCue(resolveCue(undefined, 'taskNotice'))
    for (const signal of game.audioSignals ?? []) if (signal.id > seen.signal) {
      if (signal.kind === 'music') {
        const music = signal.musicMode === 'restore' ? LEVEL.bgm : signal.cueId
        if (music) void audioManager.playMusic(music, { loop: true, fadeIn: 0.2, owner: 'scene' })
        else audioManager.stopMusic({ fadeOut: 0.2, owner: 'scene' })
        continue
      }
      const objectSounds = signal.defId ? objectTypeById(signal.defId)?.sounds : undefined
      const unitSounds = signal.defId ? unitDefById(signal.defId)?.sounds : undefined
      const turretSounds = signal.kind === 'turretFire' && signal.defId ? defOf(signal.defId).sounds : undefined
      const presetId = signal.kind === 'cue' ? signal.cueId
        : signal.kind === 'unitFire' ? resolveCue(unitSounds?.fire)
        : signal.kind === 'turretFire' ? resolveCue(signal.soundRole === 'burstLoop' ? turretSounds?.burstLoop ?? turretSounds?.fire : turretSounds?.fire)
        : signal.kind === 'unitDeath' ? resolveCue(undefined, 'unitDeath')
        : signal.kind === 'walkerStep' ? MECH_FOOTSTEP_PRESET_ID
        : signal.kind === 'crush' ? resolveCue(undefined, 'crush')
        : signal.kind === 'vehicleCollision' ? resolveCue(undefined, 'vehicleCollision')
        : signal.kind === 'objectDestroy' ? resolveCue(objectSounds?.destroy)
            : resolveCue(objectSounds?.interact, 'objectInteract')
      const intensity = signal.intensity ?? 1
      const turretDef = signal.kind === 'turretFire' && signal.defId ? turretsById.get(signal.defId) : undefined
      if (turretDef?.type === 'beam' && signal.soundRole === 'fire' && signal.sourceId !== undefined) {
        const loopKey = `beam:${signal.sourceId}`
        const token = nextBeamIntroTokenRef.current++
        beamIntroTokenRef.current.set(loopKey, token)
        const continuousCue = resolveCue(turretDef.sounds?.continuous ?? projectilesById.get(turretDef.art?.projectile ?? '')?.sounds?.continuous)
        const finishOpening = () => {
          if (beamIntroTokenRef.current.get(loopKey) !== token) return
          beamIntroTokenRef.current.delete(loopKey)
          if (!continuousCue || !activeBeamAudioLoopKeys(gameRef.current).has(loopKey)) return
          audioLoopKeysRef.current.set(loopKey, continuousCue)
          audioLoopFadeOutRef.current.set(loopKey, BEAM_FADE)
          void startCueLoop(loopKey, continuousCue, 1, distanceTo(signal.x, signal.y)).then(started => {
            if (!started && audioLoopKeysRef.current.get(loopKey) === continuousCue) {
              audioLoopKeysRef.current.delete(loopKey)
              audioLoopFadeOutRef.current.delete(loopKey)
            }
          })
        }
        void playCue(presetId, { volumeScale: intensity, distance: distanceTo(signal.x, signal.y) })
          .then(() => window.setTimeout(finishOpening, BEAM_CONTINUOUS_AUDIO_DELAY * 1000))
        continue
      }
      void playCue(presetId, { volumeScale: intensity, pitchScale: signal.kind === 'vehicleCollision' ? 0.88 + Math.min(2, intensity) * 0.1 : 1, distance: distanceTo(signal.x, signal.y) })
    }
    seen.impact = latestAudioEventId(seen.impact, game.impacts)
    seen.explosion = latestAudioEventId(seen.explosion, game.explosions)
    seen.shield = latestAudioEventId(seen.shield, game.shieldHits)
    seen.unitHit = latestAudioEventId(seen.unitHit, game.unitHits)
    seen.notice = latestAudioEventId(seen.notice, game.notices)
    seen.signal = latestAudioEventId(seen.signal, game.audioSignals ?? [])
  }, [audioConfigRevision, combatPreparationOpen, game, missionOpen, showDebug, edit])

  // 重型循环声维护独立读取命令式战斗快照；不再随 30Hz React HUD 状态发布重复扫描。
  useEffect(() => {
    if (missionOpen || combatPreparationOpen || edit || showDebug) return
    const syncLoops = () => {
      const game = gameRef.current
      const { turretsById, projectilesById } = combatAudioDefinitions()
      const listenerRect = fortressRect(game)
      const listener = { x: listenerRect.x + listenerRect.w / 2, y: listenerRect.y + listenerRect.h / 2 }
      const distanceTo = (x: number | undefined, y: number | undefined) => x === undefined || y === undefined ? undefined : Math.hypot(x - listener.x, y - listener.y)
      const desiredLoops = new Map<string, string>()
    const desiredLoopDistances = new Map<string, number | undefined>()
    const desiredLoopVolumes = new Map<string, number>()
    const desiredLoopFadeIns = new Map<string, number>()
    const desiredLoopFadeOuts = new Map<string, number>()
    const allTurrets = [
      ...game.turrets,
      ...game.enemies.flatMap(enemy => enemy.vehicle?.turrets ?? []),
      ...game.allies.flatMap(ally => ally.vehicle?.turrets ?? []),
    ]
    const activeBeamLoops = activeBeamAudioLoopKeys(game)
    const nextTurretAudio = new Map<number, { charge: number }>()
    for (const turret of allTurrets) {
      const before = previousTurretAudioRef.current.get(turret.id)
      const def = turretsById.get(turret.defId)
      if (def?.type === 'beam' && before && turret.chargeLeft > 0 && before.charge <= 0) void playCue(resolveCue(def.sounds?.charge))
      // 持续声只跟随已经射出的光束；充能与末帧滞留阶段即使状态数据异常也绝不启动。
      if (activeBeamLoops.has(`beam:${turret.id}`) && !beamIntroTokenRef.current.has(`beam:${turret.id}`) && def?.type === 'beam') {
        const ammo = projectilesById.get(def.art?.projectile ?? '')
        const cue = resolveCue(def.sounds?.continuous ?? ammo?.sounds?.continuous)
        if (cue) {
          const loopKey = `beam:${turret.id}`
          desiredLoops.set(loopKey, cue)
          desiredLoopDistances.set(loopKey, distanceTo(turret.x + turret.w / 2, turret.y + turret.h / 2))
          desiredLoopFadeOuts.set(loopKey, BEAM_FADE)
        }
      }
      nextTurretAudio.set(turret.id, { charge: turret.chargeLeft })
    }
    previousTurretAudioRef.current = nextTurretAudio
    const overheatStates = new Map<string, { overheated: boolean; cue?: string }>()
    overheatStates.set('player', { overheated: game.fortress.overheated, cue: game.turrets.map(turret => turretsById.get(turret.defId)?.sounds?.overheat).find(Boolean) })
    for (const enemy of game.enemies) if (enemy.vehicle) overheatStates.set(`enemy:${enemy.id}`, { overheated: enemy.vehicle.overheated, cue: enemy.vehicle.turrets?.map(turret => turretsById.get(turret.defId)?.sounds?.overheat).find(Boolean) })
    for (const ally of game.allies) if (ally.vehicle) overheatStates.set(`ally:${ally.id}`, { overheated: ally.vehicle.overheated, cue: ally.vehicle.turrets?.map(turret => turretsById.get(turret.defId)?.sounds?.overheat).find(Boolean) })
    for (const [key, state] of overheatStates) if (state.overheated && !previousOverheatRef.current.get(key)) void playCue(resolveCue(state.cue))
    previousOverheatRef.current = new Map([...overheatStates].map(([key, state]) => [key, state.overheated]))
    const playerDef = fortressDef(game)
    const vehicleAudioEnabled = !isTerminalPhase(game.phase)
    const playerSpeed = Math.hypot(game.fortress.vx, game.fortress.vy)
    const playerMoving = playerSpeed > 0.08
    const playerRotorcraft = playerDef.platformType === 'rotorcraft'
    if (vehicleAudioEnabled && game.fortress.hp > 0 && game.fortress.dyingT < 0) {
      const cue = resolveMovementCue(playerMoving || playerRotorcraft ? playerDef.sounds?.movement : undefined)
      if (cue) desiredLoops.set('move:player', cue)
      desiredLoopDistances.set('move:player', 0)
      if (playerRotorcraft) desiredLoopVolumes.set('move:player', rotorcraftMovementAudioGain(playerSpeed, playerDef.speed))
      if (playerMoving && !playerRotorcraft) {
        desiredLoopFadeIns.set('move:player', VEHICLE_MOVE_FADE_TIME)
        desiredLoopFadeOuts.set('move:player', VEHICLE_MOVE_FADE_TIME)
      }
    }
    const currentPositions = new Map<string, { x: number; y: number }>()
    const addUnitMovement = (key: string, unit: UnitDef | undefined, x: number, y: number, alive: boolean, vehicleSpeed?: number, aircraft?: UnitAircraftRuntime) => {
      currentPositions.set(key, { x, y })
      const rotorCrash = unit?.type === 'rotorcraft' && aircraft?.crash?.kind === 'rotorcraft' && !aircraft.crash.impacted ? aircraft.crash : undefined
      if (!unit || (!alive && !rotorCrash) || !vehicleAudioEnabled) return
      const before = previousUnitPositionsRef.current.get(key)
      const moving = !!rotorCrash || (vehicleSpeed !== undefined ? vehicleSpeed > 0.08 : !!before && Math.hypot(x - before.x, y - before.y) > 0.015)
      const type = unit.typeConfig?.kind === 'vehicle' ? unit.typeConfig.chassis : unit.type
      const rotorcraft = type === 'rotorcraft'
      const cue = resolveMovementCue(moving || rotorcraft ? unit.sounds?.movement : undefined)
      if (!cue) return
      const loopKey = `move:${key}`
      desiredLoops.set(loopKey, cue)
      desiredLoopDistances.set(loopKey, distanceTo(x, y))
      const actualSpeed = aircraft ? Math.hypot(aircraft.vx, aircraft.vy) : vehicleSpeed ?? 0
      desiredLoopVolumes.set(loopKey, rotorcraft ? rotorcraftMovementAudioGain(actualSpeed, unit.stats.speed, rotorCrash) : 1)
      if (moving && !rotorcraft && type !== 'fixedWingAircraft') {
        desiredLoopFadeIns.set(loopKey, VEHICLE_MOVE_FADE_TIME)
        desiredLoopFadeOuts.set(loopKey, VEHICLE_MOVE_FADE_TIME)
      }
    }
    for (const enemy of game.enemies) addUnitMovement(`enemy:${enemy.id}`, unitDefById(enemy.unitDefId ?? enemyUnitId(enemy.kind)), enemy.x, enemy.y, enemy.hp > 0, enemy.vehicle ? Math.hypot(enemy.vehicle.vx, enemy.vehicle.vy) : undefined, enemy.aircraft)
    for (const ally of game.allies) addUnitMovement(`ally:${ally.id}`, unitDefById(ally.unitDefId ?? ''), ally.x, ally.y, ally.hp > 0, ally.vehicle ? Math.hypot(ally.vehicle.vx, ally.vehicle.vy) : undefined, ally.aircraft)
    previousUnitPositionsRef.current = currentPositions
    for (const [key, cue] of desiredLoops) if (cue && (audioLoopKeysRef.current.get(key) !== cue || !isCueLoopActive(key, cue))) {
      stopCueLoop(key, audioLoopFadeOutRef.current.get(key) ?? 0)
      audioLoopKeysRef.current.set(key, cue)
      audioLoopFadeOutRef.current.set(key, desiredLoopFadeOuts.get(key) ?? 0)
      void startCueLoop(key, cue, desiredLoopVolumes.get(key) ?? 1, desiredLoopDistances.get(key), desiredLoopFadeIns.get(key) ?? 0).then(started => {
        if (!started && audioLoopKeysRef.current.get(key) === cue) {
          audioLoopKeysRef.current.delete(key)
          audioLoopFadeOutRef.current.delete(key)
        }
      })
    }
    for (const [key, cue] of desiredLoops) setCueLoopVolume(key, cue, desiredLoopVolumes.get(key) ?? 1, desiredLoopDistances.get(key), 0.06)
    for (const key of [...audioLoopKeysRef.current.keys()]) if (!desiredLoops.get(key)) {
      stopCueLoop(key, audioLoopFadeOutRef.current.get(key) ?? 0)
      audioLoopKeysRef.current.delete(key)
      audioLoopFadeOutRef.current.delete(key)
    }

    const flightProjectiles = [...game.projectiles.map(projectile => ({ key: `player:${projectile.id}`, x: projectile.x, y: projectile.y, ammoId: turretsById.get(projectile.defId)?.art?.projectile })), ...game.enemyProjectiles.map(projectile => ({ key: `unit:${projectile.id}`, x: projectile.x, y: projectile.y, ammoId: projectile.assetRef }))]
    const desiredFlight = new Map<string, string>()
    const desiredFlightDistances = new Map<string, number | undefined>()
    for (const projectile of flightProjectiles) {
      const ammo = projectilesById.get(projectile.ammoId ?? '')
      const cue = resolveCue(ammo?.sounds?.flight)
      if (cue) { const key = `flight:${projectile.key}`; desiredFlight.set(key, cue); desiredFlightDistances.set(key, distanceTo(projectile.x, projectile.y)) }
    }
    for (const [key, cue] of desiredFlight) if (audioLoopKeysRef.current.get(key) !== cue || !isCueLoopActive(key, cue)) { stopCueLoop(key); audioLoopKeysRef.current.set(key, cue); void startCueLoop(key, cue, 1, desiredFlightDistances.get(key)).then(started => { if (!started && audioLoopKeysRef.current.get(key) === cue) audioLoopKeysRef.current.delete(key) }) }
      for (const key of [...audioLoopKeysRef.current.keys()]) if (key.startsWith('flight:') && !desiredFlight.has(key)) { stopCueLoop(key); audioLoopKeysRef.current.delete(key) }
    }
    syncLoops()
    const timer = window.setInterval(syncLoops, AUDIO_LOOP_SYNC_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [audioConfigRevision, combatPreparationOpen, edit, missionOpen, showDebug])
  useEffect(() => () => {
    stopAllCombatAudioLoops()
  }, [stopAllCombatAudioLoops])
  useEffect(() => {
    const click = (event: MouseEvent) => {
      const button = (event.target as Element | null)?.closest<HTMLButtonElement>('button')
      if (!button || button.disabled) return
      const slot = button.dataset.audioCue as GlobalCueSlot | undefined
      void playCue(resolveCue(undefined, slot ?? 'uiClick'))
    }
    window.addEventListener('click', click)
    return () => window.removeEventListener('click', click)
  }, [audioConfigRevision])

  // 主循环：按浏览器实际帧间隔推进。炮塔连发、动画与事件计时直接消费真实秒数，
  // 不再被旧 0.1s 固定逻辑帧向上取整；长帧仍限制到 50ms，避免恢复标签页时瞬间跳跃。
  useEffect(() => {
    let raf = 0
    let previousTime = performance.now()
    let accumulated = 0
    let reactElapsed = 0
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop)
      const elapsed = Math.max(0, (now - previousTime) / 1000)
      previousTime = now
      accumulated = Math.min(MAX_COMBAT_FRAME_DT, accumulated + elapsed)
      if (missionOpenRef.current || combatPreparationOpenRef.current || editRef.current || debugRef.current) { accumulated = 0; return }
      if (accumulated < MIN_COMBAT_FRAME_DT) return
      const dt = accumulated
      accumulated = 0
      reactElapsed += dt
      // 键盘集合是权威输入源：每个逻辑帧重新写入操控状态。即使浏览器调度或 React
      // 提交顺序曾把旧 moveDir 带回 gameRef，最迟也会在本帧被空按键集合清除。
      if (!joyRef.current) applyKeys()
      const g = gameRef.current
      // 结算出现后冻结整局快照，避免用时、击杀与目标状态继续变化。
      if (isTerminalPhase(g.phase)) { accumulated = 0; return }
      const _t0 = performance.now()
      const next = tick(g, dt)
      // Canvas 使用 next 立即绘制光束消退；循环声也在同一逻辑帧进入淡出，
      // 不等待 30Hz React 状态发布，避免视觉已经收缩而声音仍保持满音量。
      const activeBeamLoops = activeBeamAudioLoopKeys(next)
      for (const key of [...audioLoopKeysRef.current.keys()]) {
        if (!key.startsWith('beam:') || activeBeamLoops.has(key)) continue
        stopCueLoop(key, BEAM_FADE)
        audioLoopKeysRef.current.delete(key)
        audioLoopFadeOutRef.current.delete(key)
        beamIntroTokenRef.current.delete(key)
      }
      const _tm = performance.now() - _t0
      const _pf = perfRef.current
      _pf.tickMs = _pf.tickMs * 0.9 + _tm * 0.1
      if (_tm > _pf.tickMax) _pf.tickMax = _tm
      _pf.engine = enginePerformanceSnapshot()
      if (g.phase !== 'combat' && next.phase === 'combat') setMode({ kind: 'none' })
      // 先更新命令式状态，再交给 React 渲染，封闭 keyup/下一帧之间的竞态窗口。
      gameRef.current = next
      // 逻辑和 Canvas 继续按实际刷新率运行；只有 HUD/弹窗树限频到 30Hz。
      // 阶段、选择与装配状态切换需立即发布，避免交互窗口延后一帧出现。
      const urgentUiUpdate = next.phase !== g.phase
        || next.eventChoice?.id !== g.eventChoice?.id
        || next.eventAssembly?.id !== g.eventAssembly?.id
      if (urgentUiUpdate || reactElapsed >= REACT_COMBAT_UPDATE_INTERVAL) {
        reactElapsed = 0
        setGameState(next)
      }
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [applyKeys])

  // 画布尺寸：自适应沿用容器尺寸；固定参考分辨率以逻辑画布完整等比缩放，空余区域保持黑色。
  const applyViewportLayout = useCallback((availableWidth: number, availableHeight: number, editing: boolean, zoom: number) => {
    const inset = editing ? 6 : 0
    const layout = resolveDisplayViewport(displayConfig(), availableWidth - inset, availableHeight - inset, editing)
    portraitRef.current = layout.logicalHeight > layout.logicalWidth
    setSize({ cell: BASE_CELL * zoom, w: layout.logicalWidth, h: layout.logicalHeight })
    setCanvasFit({ w: layout.logicalWidth, h: layout.logicalHeight })
    setCanvasDisplayScale(layout.scale)
  }, [])

  const showZoomIndicator = useCallback((zoom: number) => {
    if (editRef.current) return
    setZoomIndicator(Math.round(zoom * 100))
    if (zoomIndicatorTimerRef.current !== null) window.clearTimeout(zoomIndicatorTimerRef.current)
    zoomIndicatorTimerRef.current = window.setTimeout(() => {
      setZoomIndicator(null)
      zoomIndicatorTimerRef.current = null
    }, 2000)
  }, [])
  useEffect(() => () => {
    if (zoomIndicatorTimerRef.current !== null) window.clearTimeout(zoomIndicatorTimerRef.current)
  }, [])

  const applyZoom = useCallback((z: number, showIndicator = false) => {
    const limits = displayConfig()
    const zoom = Math.max(limits.minZoom, Math.min(limits.maxZoom, z))
    zoomRef.current = zoom
    if (showIndicator) showZoomIndicator(zoom)
    const rect = containerRef.current?.getBoundingClientRect()
    if (rect) {
      applyViewportLayout(rect.width, rect.height, !!editRef.current, zoom)
      return
    }
    const vc = portraitRef.current ? VIEW_ROWS : VIEW_COLS
    const vr = portraitRef.current ? VIEW_COLS : VIEW_ROWS
    applyViewportLayout(BASE_CELL * vc, BASE_CELL * vr, !!editRef.current, zoom)
  }, [applyViewportLayout, showZoomIndicator])
  useEffect(() => {
    const changed = (event: Event) => {
      const key = (event as CustomEvent<{ changed?: string }>).detail?.changed
      applyZoom(key === 'defaultZoom' ? displayConfig().defaultZoom : zoomRef.current)
    }
    window.addEventListener('td-display-config-changed', changed)
    return () => window.removeEventListener('td-display-config-changed', changed)
  }, [applyZoom])
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const rect = el.getBoundingClientRect()
      applyViewportLayout(rect.width, rect.height, !!editRef.current, zoomRef.current)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [applyViewportLayout])

  // 滚轮缩放（画布上；非被动以阻止页面缩放）
  useEffect(() => {
    const cv = canvasRef.current
    if (!cv) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      applyZoom(zoomRef.current * (e.deltaY < 0 ? 1.125 : 1 / 1.125), true)
    }
    cv.addEventListener('wheel', onWheel, { passive: false })
    return () => cv.removeEventListener('wheel', onWheel)
  }, [applyZoom])

  const prep = game.phase === 'prep'
  const nextWaveCountdown = defenseWaveCountdown(game)
  const assemblyAllowed = fortressAssemblyAllowed(game)
  const equipButtonAsset = combatUiAssetSrc('btn_equip')
  const inAssemblyZone = fortressInAssemblyZone(game)
  const supplyStatus = fortressSupplyStatus(game)
  const cell = size.cell
  const activeDisplayConfig = displayConfig()
  const canvasLogicalWidth = canvasFit.w + (edit ? 6 : 0)
  const canvasLogicalHeight = canvasFit.h + (edit ? 6 : 0)

  // ================= 场景编辑：笔刷占格 / 校验 / 铺设 / 移动 =================
  const brushFoot = (draft: LevelConfig, brush: Brush, picked: Picked | null): { w: number; h: number } => {
    if (brush === 'move') return picked ? { w: picked.w, h: picked.h } : { w: 1, h: 1 }
    if (brush === 'puddle') return { w: 1, h: 1 }
    if (brush === 'barrel' || brush === 'ruins' || brush === 'rock') {
      const def = objectTypeById(editorObjectDefId)
      return def ? { w: isAutotileAsset(def.asset) ? 1 : def.defaultW, h: isAutotileAsset(def.asset) ? 1 : def.defaultH } : { w: 1, h: 1 }
    }
    if (brush === 'start') return { w: draft.startZone.w, h: draft.startZone.h }
    if (brush === 'finish' || brush === 'spawnRegion' || brush === 'spawnRegionErase') {
      return { w: 1, h: 1 }
    }
    if (brush === 'trigger' || brush === 'route') return { w: 1, h: 1 }
    if (brush === 'unit') {
      const def = unitDefById(editorUnitDefId)
      return def ? unitFootprint(def) : { w: 1, h: 1 }
    }
    return { w: 1, h: 1 }
  }

  /** 占用冲突：当前物体与单位占据格；旧核心/固定建筑/独立墙体不再属于编辑器对象。 */
  const rectBusy = (draft: LevelConfig, brush: Brush, gx: number, gy: number, w: number, h: number): boolean => {
    const isObj = brush === 'barrel' || brush === 'ruins' || brush === 'rock'
    for (let dx = 0; dx < w; dx++)
      for (let dy = 0; dy < h; dy++) {
        const cx = gx + dx
        const cy = gy + dy
        if (!isObj && draft.objects.some(o => cx >= o.x && cx < o.x + o.w && cy >= o.y && cy < o.y + o.h)) return true
        if (draft.initialUnits.some(unit => {
          const foot = placedUnitFootprint(unit)
          return cx + 0.5 >= unit.x - foot.w / 2 && cx + 0.5 < unit.x + foot.w / 2
            && cy + 0.5 >= unit.y - foot.h / 2 && cy + 0.5 < unit.y + foot.h / 2
        })) return true
      }
    return false
  }

  const brushValidAt = (draft: LevelConfig, brush: Brush, picked: Picked | null, gx: number, gy: number): boolean => {
    if (brush === 'start' || brush === 'finish' || brush === 'spawnRegion' || brush === 'spawnRegionErase' || brush === 'trigger' || brush === 'route') {
      const { w, h } = brushFoot(draft, brush, picked)
      return gx >= 0 && gx + w <= LEVEL.cols && gy >= 0 && gy + h <= LEVEL.rows
    }
    if (brush === 'unit') {
      const { w, h } = brushFoot(draft, brush, picked)
      const def = unitDefById(editorUnitDefId)
      return gx >= 0 && gx + w <= LEVEL.cols && gy >= 0 && gy + h <= LEVEL.rows
        && (!def || !unitFootprint(def).blocksMovement || !rectBusy(draft, brush, gx, gy, w, h))
    }
    if (brush === 'eraser' || brush === 'baseTile' || brush === 'overlayTile' || brush === 'fill') return gx >= 0 && gx < LEVEL.cols && gy >= 0 && gy < LEVEL.rows
    if (brush === 'ground') return gx >= 0 && gx < LEVEL.cols && gy >= 0 && gy < LEVEL.rows // 纯视觉地面层：不与物体/建筑冲突
    if (brush === 'move' && !picked) return false // 未取件时不铺
    const { w, h } = brushFoot(draft, brush, picked)
    if (gx < 0 || gx + w > LEVEL.cols || gy < SPAWN_ROWS || gy + h > LEVEL.rows) return false
    return !rectBusy(draft, brush, gx, gy, w, h)
  }

  /** 移动笔刷：命中检测（优先级：单位 > 物体 > 地形）。 */
  const hitTest = (draft: LevelConfig, gx: number, gy: number): Picked | null => {
    const ui = draft.initialUnits.findIndex(u => {
      const foot = placedUnitFootprint(u)
      return gx + 0.5 >= u.x - foot.w / 2 && gx + 0.5 < u.x + foot.w / 2
        && gy + 0.5 >= u.y - foot.h / 2 && gy + 0.5 < u.y + foot.h / 2
    })
    if (ui >= 0) {
      const placed = draft.initialUnits[ui]
      const foot = placedUnitFootprint(placed)
      return { kind: 'unit', w: foot.w, h: foot.h, idx: ui, data: { ...placed } }
    }
    const oi = draft.objects.findIndex(o => gx >= o.x && gx < o.x + o.w && gy >= o.y && gy < o.y + o.h)
    if (oi >= 0) {
      const o = draft.objects[oi]
      return { kind: 'object', w: o.w, h: o.h, idx: oi, data: { ...o } }
    }
    const ri = draft.terrain.findIndex(t => gx >= t.x && gx < t.x + t.w && gy >= t.y && gy < t.y + t.h)
    if (ri >= 0) {
      const t = draft.terrain[ri]
      return { kind: 'terrain', w: t.w, h: t.h, idx: ri, data: { ...t } }
    }
    return null
  }

  const pickedOrigin = (picked: Picked): { x: number; y: number } => picked.kind === 'unit'
    ? { x: picked.data.x - picked.w / 2, y: picked.data.y - picked.h / 2 }
    : { x: picked.data.x, y: picked.data.y }

  const pickedKey = (picked: Picked): string => picked.kind === 'unit'
    ? `unit:${picked.data.id}`
    : `${picked.kind}:${picked.data.id ?? picked.idx}`

  const resolvePicked = (draft: LevelConfig, picked: Picked): Picked | null => {
    if (picked.kind === 'unit') {
      const idx = draft.initialUnits.findIndex(unit => unit.id === picked.data.id)
      if (idx < 0) return null
      const data = draft.initialUnits[idx]
      const foot = placedUnitFootprint(data)
      return { kind: 'unit', idx, w: foot.w, h: foot.h, data: { ...data } }
    }
    if (picked.kind === 'object') {
      const idx = picked.data.id === undefined ? picked.idx : draft.objects.findIndex(item => item.id === picked.data.id)
      const data = draft.objects[idx]
      return data ? { kind: 'object', idx, w: data.w, h: data.h, data: { ...data } } : null
    }
    const idx = picked.data.id === undefined ? picked.idx : draft.terrain.findIndex(item => item.id === picked.data.id)
    const data = draft.terrain[idx]
    return data ? { kind: 'terrain', idx, w: data.w, h: data.h, data: { ...data } } : null
  }

  const marqueeSelection = (draft: LevelConfig, rect: { x: number; y: number; w: number; h: number }): Picked[] => {
    const intersects = (x: number, y: number, w: number, h: number) => x < rect.x + rect.w && x + w > rect.x && y < rect.y + rect.h && y + h > rect.y
    const objects: Picked[] = draft.objects.flatMap((object, idx) => intersects(object.x, object.y, object.w, object.h)
      ? [{ kind: 'object' as const, idx, w: object.w, h: object.h, data: { ...object } }]
      : [])
    const units: Picked[] = draft.initialUnits.flatMap((unit, idx) => {
      const foot = placedUnitFootprint(unit)
      return intersects(unit.x - foot.w / 2, unit.y - foot.h / 2, foot.w, foot.h)
        ? [{ kind: 'unit' as const, idx, w: foot.w, h: foot.h, data: { ...unit } }]
        : []
    })
    return [...objects, ...units]
  }

  const removePicked = (d: LevelConfig, p: Picked) => {
    if (p.kind === 'terrain') d.terrain.splice(p.idx, 1)
    else if (p.kind === 'object') d.objects.splice(p.idx, 1)
    else d.initialUnits = d.initialUnits.filter(u => u.id !== p.data.id)
  }

  const removePickedMany = (draft: LevelConfig, picks: Picked[]) => {
    const unitIds = new Set(picks.filter((pick): pick is Extract<Picked, { kind: 'unit' }> => pick.kind === 'unit').map(pick => pick.data.id))
    const objectIds = new Set(picks.filter((pick): pick is Extract<Picked, { kind: 'object' }> => pick.kind === 'object' && pick.data.id !== undefined).map(pick => pick.data.id!))
    const objectIndexes = new Set(picks.filter(pick => pick.kind === 'object' && pick.data.id === undefined).map(pick => pick.idx))
    const terrainIds = new Set(picks.filter((pick): pick is Extract<Picked, { kind: 'terrain' }> => pick.kind === 'terrain' && pick.data.id !== undefined).map(pick => pick.data.id!))
    const terrainIndexes = new Set(picks.filter(pick => pick.kind === 'terrain' && pick.data.id === undefined).map(pick => pick.idx))
    draft.initialUnits = draft.initialUnits.filter(unit => !unitIds.has(unit.id))
    draft.objects = draft.objects.filter((object, index) => !(object.id !== undefined ? objectIds.has(object.id) : objectIndexes.has(index)))
    draft.terrain = draft.terrain.filter((terrain, index) => !(terrain.id !== undefined ? terrainIds.has(terrain.id) : terrainIndexes.has(index)))
  }

  const dropPicked = (d: LevelConfig, p: Picked, gx: number, gy: number) => {
    if (p.kind === 'terrain') d.terrain.push({ ...p.data, x: gx, y: gy })
    else if (p.kind === 'object') d.objects.push({ ...p.data, x: gx, y: gy })
    else d.initialUnits.push({ ...p.data, x: gx + p.w / 2, y: gy + p.h / 2 })
  }

  const pasteGroupWithFreshIds = (items: Picked[], draft: LevelConfig): PickedGroup => {
    let nextUnitId = Math.max(0, ...draft.initialUnits.map(unit => unit.id)) + 1
    let nextObjectId = Math.max(0, ...draft.objects.map(object => object.id ?? 0)) + 1
    let nextTerrainId = Math.max(0, ...draft.terrain.map(terrain => terrain.id ?? 0)) + 1
    const copies = structuredClone(items)
    for (const item of copies) {
      item.ghostOrigin = 'paste'
      if (item.kind === 'unit') item.data.id = nextUnitId++
      else if (item.kind === 'object') item.data.id = nextObjectId++
      else item.data.id = nextTerrainId++
    }
    const origins = copies.map(pickedOrigin)
    return {
      items: copies,
      anchorX: Math.min(...origins.map(origin => origin.x)),
      anchorY: Math.min(...origins.map(origin => origin.y)),
      ghostOrigin: 'paste',
    }
  }

  const positionedPasteGroup = (group: PickedGroup, gx: number, gy: number): { item: Picked; x: number; y: number }[] => {
    const dx = gx - group.anchorX
    const dy = gy - group.anchorY
    return group.items.map(item => {
      const origin = pickedOrigin(item)
      return { item, x: origin.x + dx, y: origin.y + dy }
    })
  }

  const pasteGroupValidAt = (draft: LevelConfig, group: PickedGroup, gx: number, gy: number): boolean => positionedPasteGroup(group, gx, gy)
    .every(({ item, x, y }) => brushValidAt(draft, 'move', item, x, y))

  const dropPasteGroup = (draft: LevelConfig, group: PickedGroup, gx: number, gy: number) => {
    for (const { item, x, y } of positionedPasteGroup(group, gx, gy)) dropPicked(draft, item, x, y)
  }

  /** 连续黏贴每次落子后为幽灵模板分配新实例 ID，避免多个副本引用同一对象。 */
  const nextPastePicked = (p: Picked, d: LevelConfig): Picked => {
    const next = structuredClone(p)
    next.ghostOrigin = 'paste'
    if (next.kind === 'unit') next.data.id = Math.max(0, ...d.initialUnits.map(unit => unit.id)) + 1
    else if (next.kind === 'object') next.data.id = Math.max(0, ...d.objects.map(object => object.id ?? 0)) + 1
    else next.data.id = Math.max(0, ...d.terrain.map(terrain => terrain.id ?? 0)) + 1
    return next
  }

  const locateEditorSelection = (picked: Picked | null) => {
    if (!picked) return
    if (picked.kind === 'unit') {
      setEditorSelectedInitialUnitId(picked.data.id)
      setEditorInspectorTab('units')
    } else if (picked.kind === 'terrain') {
      if (picked.data.defId) setEditorTerrainDefId(picked.data.defId)
      setEditorInspectorTab('terrain')
    } else {
      if (picked.kind === 'object' && picked.data.defId) setEditorObjectDefId(picked.data.defId)
      setEditorInspectorTab('object')
    }
  }

  const focusGroupedSelection = (picked: Picked) => {
    const current = editRef.current
    if (!current) return
    const resolved = resolvePicked(current.draft, picked)
    if (!resolved) return
    locateEditorSelection(resolved)
    setEdit({ ...current, selected: resolved })
  }

  const filterGroupedSelection = (kind: 'unit' | 'object') => {
    const current = editRef.current
    if (!current) return
    const selectedGroup = (current.selectedGroup ?? [])
      .filter(item => item.kind === kind)
      .map(item => resolvePicked(current.draft, item))
      .filter((item): item is Picked => item !== null)
    const focused = current.selected && selectedGroup.some(item => pickedKey(item) === pickedKey(current.selected!))
      ? current.selected
      : null
    if (!focused) {
      setEditorSelectedInitialUnitId(null)
      setEditorFocusedObjectEvent(null)
    }
    setEdit({ ...current, selected: focused, selectedGroup })
  }

  /** 选择工具点击：无幽灵时只选中定位；黏贴幽灵时连续放置副本。 */
  const moveClick = (gx: number, gy: number) => {
    const e = editRef.current
    if (!e) return
    if (e.pickedGroup) {
      if (!pasteGroupValidAt(e.draft, e.pickedGroup, gx, gy)) return
      recordEditorHistory(e)
      const draft = structuredClone(e.draft)
      dropPasteGroup(draft, e.pickedGroup, gx, gy)
      const nextGroup = pasteGroupWithFreshIds(e.pickedGroup.items, draft)
      previewLevel(draft)
      setEdit({ ...e, draft, pickedGroup: nextGroup, selected: null, selectedGroup: [] })
    } else if (!e.picked) {
      const selected = hitTest(e.draft, gx, gy)
      locateEditorSelection(selected)
      setEdit(cur => cur ? { ...cur, selected, selectedGroup: [] } : cur)
    } else {
      if (!brushValidAt(e.draft, 'move', e.picked, gx, gy)) return
      setEdit(cur => {
        if (!cur || !cur.picked) return cur
        const continuousPaste = cur.picked.ghostOrigin === 'paste'
        if (continuousPaste) recordEditorHistory(cur)
        const d = structuredClone(cur.draft)
        dropPicked(d, cur.picked, gx, gy)
        if (continuousPaste) {
          previewLevel(d)
          return { ...cur, draft: d, picked: nextPastePicked(cur.picked, d), pickedGroup: null, selected: null, selectedGroup: [] }
        }
        const selected = hitTest(d, gx, gy)
        locateEditorSelection(selected)
        previewLevel(d)
        return { ...cur, draft: d, picked: null, pickedGroup: null, selected, selectedGroup: [] }
      })
    }
  }

  /** 取消移动：放回原地 */
  const cancelMove = () => {
    const cur = editRef.current
    if (!cur) return
    if (cur.pickedGroup) {
      setEdit({ ...cur, pickedGroup: null })
      return
    }
    if (!cur.picked) return
    if (cur.picked.ghostOrigin === 'paste') {
      setEdit({ ...cur, picked: null, pickedGroup: null })
      return
    }
    const d = structuredClone(cur.draft)
    const origin = pickedOrigin(cur.picked)
    dropPicked(d, cur.picked, origin.x, origin.y)
    previewLevel(d)
    const selected = hitTest(d, Math.floor(origin.x), Math.floor(origin.y))
    locateEditorSelection(selected)
    setEdit({ ...cur, draft: d, picked: null, pickedGroup: null, selected, selectedGroup: [] })
  }

  /** 从检查器或场景工具切换笔刷；若正在移动元素，先安全放回原位。 */
  const activateEditorBrush = (brush: Brush) => {
    setEdit(cur => {
      if (!cur) return cur
      if (cur.pickedGroup) return { ...cur, brush, pickedGroup: null }
      if (!cur.picked) return { ...cur, brush }
      if (cur.picked.ghostOrigin === 'paste') return { ...cur, brush, picked: null, pickedGroup: null }
      const draft = structuredClone(cur.draft)
      const origin = pickedOrigin(cur.picked)
      dropPicked(draft, cur.picked, origin.x, origin.y)
      previewLevel(draft)
      return { ...cur, draft, brush, picked: null, pickedGroup: null, selected: hitTest(draft, Math.floor(origin.x), Math.floor(origin.y)), selectedGroup: [] }
    })
  }

  const editorHistorySnapshot = (state: LevelEditState): EditorHistorySnapshot => {
    const library = structuredClone(state.library)
    const entry = library.levels.find(level => level.id === state.levelId)
    if (entry) entry.level = structuredClone(state.draft)
    return { library, levelId: state.levelId, worldTypes: snapshotWorldTypeLibrary() }
  }

  const recordEditorHistory = (state = editRef.current) => {
    if (!state) return
    const snapshot = editorHistorySnapshot(state)
    setEditUndo(history => [...history.slice(-49), snapshot])
    setEditRedo([])
  }

  const updateDraft = (fn: (d: LevelConfig) => void, recordHistory = true): boolean => {
    const e = editRef.current
    if (!e) return false
    const d = structuredClone(e.draft)
    fn(d)
    if (JSON.stringify(d) === JSON.stringify(e.draft)) return false
    if (recordHistory) recordEditorHistory(e)
    previewLevel(d)
    const next = { ...e, draft: d }
    editRef.current = next
    setEdit(next)
    return true
  }

  const patchPlacedUnit = (placementId: number, change: (unit: LevelUnitPlacement) => void) => {
    setEdit(current => {
      if (!current) return current
      const draft = structuredClone(current.draft)
      const unit = draft.initialUnits.find(item => item.id === placementId)
      if (!unit) return current
      change(unit)
      if (JSON.stringify(draft) === JSON.stringify(current.draft)) return current
      const snapshot = editorHistorySnapshot(current)
      setEditUndo(history => [...history.slice(-49), snapshot])
      setEditRedo([])
      previewLevel(draft)
      return { ...current, draft }
    })
  }

  const resolveEditorVariableName = (rawName: string): string => {
    const name = rawName.trim().slice(0, 80)
    if (!name) return ''
    const variables = editRef.current?.draft.variables ?? []
    const existing = variables.find(variable => variable.id === name || variable.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase())
    if (existing) return existing.id
    const id = `var:${name}`
    updateDraft(draft => {
      if (!draft.variables.some(variable => variable.id === id)) draft.variables.push({ id, name, type: 'number', initial: 0 })
    })
    return id
  }

  const resolveEditorGlobalVariableName = (rawName: string): string => {
    const name = rawName.trim().replace(/^global:/, '').slice(0, 73)
    if (!name) return ''
    const current = editRef.current
    if (!current) return `global:${name}`
    const existing = current.library.globalVariables.find(variable => variable.id === name || variable.id === `global:${name}` || variable.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase())
    if (existing) return existing.id
    const library = structuredClone(current.library)
    const id = `global:${name}`
    library.globalVariables.push({ id, name, type: 'number', initial: 0 })
    recordEditorHistory(current)
    const next = { ...current, library }
    editRef.current = next
    setEdit(next)
    return id
  }

  const updateEditorGlobalVariables = (change: (variables: LevelVariableDef[]) => void) => {
    const current = editRef.current
    if (!current) return
    const library = structuredClone(current.library)
    change(library.globalVariables)
    if (JSON.stringify(library.globalVariables) === JSON.stringify(current.library.globalVariables)) return
    recordEditorHistory(current)
    const next = { ...current, library }
    editRef.current = next
    setEdit(next)
  }

  const undoEditorChange = () => {
    const e = editRef.current
    if (e?.picked) {
      cancelMove()
      return
    }
    const previous = editUndo.at(-1)
    if (!e || !previous) return
    setEditUndo(history => history.slice(0, -1))
    setEditRedo(history => [...history.slice(-49), editorHistorySnapshot(e)])
    restoreWorldTypeLibrary(previous.worldTypes)
    const library = structuredClone(previous.library)
    const entry = library.levels.find(level => level.id === previous.levelId) ?? library.levels[0]
    if (!entry) return
    const draft = structuredClone(entry.level)
    previewLevel(draft)
    focusEditorLevel(draft)
    const next = { ...e, library, levelId: entry.id, draft, picked: null, pickedGroup: null, selected: null, selectedGroup: [] }
    editRef.current = next
    setEdit(next)
    setEditorHistoryRevision(value => value + 1)
  }

  const redoEditorChange = () => {
    const e = editRef.current
    if (e?.picked) {
      cancelMove()
      return
    }
    const future = editRedo.at(-1)
    if (!e || !future) return
    setEditRedo(history => history.slice(0, -1))
    setEditUndo(history => [...history.slice(-49), editorHistorySnapshot(e)])
    restoreWorldTypeLibrary(future.worldTypes)
    const library = structuredClone(future.library)
    const entry = library.levels.find(level => level.id === future.levelId) ?? library.levels[0]
    if (!entry) return
    const draft = structuredClone(entry.level)
    previewLevel(draft)
    focusEditorLevel(draft)
    const next = { ...e, library, levelId: entry.id, draft, picked: null, pickedGroup: null, selected: null, selectedGroup: [] }
    editRef.current = next
    setEdit(next)
    setEditorHistoryRevision(value => value + 1)
  }

  const syncOverlayGroundCells = (draft: LevelConfig) => {
    draft.groundCells = draft.overlayTiles
      .filter(tile => tile.assetId === 'builtin:ground/mid' && tile.source === 'autotile')
      .map(tile => `${tile.x},${tile.y}`)
  }

  /** 当前图块模板生成器；底图层独立图块沿用素材的随机填充权重。 */
  const currentTileCell = (layer: 'base' | 'overlay', x: number, y: number): LevelTileCell => {
    let tileIndex = editorTileTemplate.tileIndex
    if (layer === 'base' && editorTileTemplate.source === 'independent') {
      const asset = getAsset(editorTileTemplate.assetId)
      const validTileIndices = asset?.tileSheet?.kind === 'independent'
        ? asset.tileSheet.validTileIndices ?? Array.from({ length: 25 }, (_, index) => index)
        : undefined
      tileIndex = validTileIndices ? weightedIndependentTileIndex(validTileIndices) ?? tileIndex : tileIndex
    }
    return { x, y, ...editorTileTemplate, tileIndex }
  }

  const applyBrushAt = (draft: LevelConfig, brush: Brush, gx: number, gy: number) => {
    const covers = (r: { x: number; y: number; w: number; h: number }) =>
      gx >= r.x && gx < r.x + r.w && gy >= r.y && gy < r.y + r.h
    const overlapsBrush = (r: { x: number; y: number; w: number; h: number }, w: number, h: number) =>
      gx < r.x + r.w && gx + w > r.x && gy < r.y + r.h && gy + h > r.y
    switch (brush) {
      case 'puddle':
        {
          const def = terrainTypeById(editorTerrainDefId) ?? terrainTypeLibrary()[0]
          if (!def) break
          draft.terrain = draft.terrain.filter(t => !overlapsBrush(t, 1, 1))
          draft.terrain.push({ id: Math.max(0, ...draft.terrain.map(item => item.id ?? 0)) + 1, kind: 'puddle', defId: def.id, x: gx, y: gy, w: 1, h: 1, moveModifier: def.effect === 'moveModifier' ? def.moveModifier : 1 })
        }
        break
      case 'barrel':
      case 'ruins':
      case 'rock': {
        const def = objectTypeById(editorObjectDefId) ?? objectTypeLibrary()[0]
        if (!def) break
        const autotile = isAutotileAsset(def.asset)
        const w = autotile ? 1 : def.defaultW
        const h = autotile ? 1 : def.defaultH
        draft.objects = draft.objects.filter(o => !overlapsBrush(o, w, h))
        draft.objects.push({
          id: Math.max(0, ...draft.objects.map(item => item.id ?? 0)) + 1, kind: 'rock', defId: def.id, x: gx, y: gy, w, h,
          hp: def.hp <= 0 ? -1 : def.hp, blockMove: def.blockMove, blockProjectile: def.blockProjectile, height: def.height,
          renderLayer: def.renderLayer, flipX: false, rotation: 0, state: 'default', events: structuredClone(def.events ?? []),
        })
        break
      }
      case 'buildzone':
        if (!draft.buildCells.includes(`${gx},${gy}`)) draft.buildCells.push(`${gx},${gy}`)
        break
      case 'ground':
        if (!draft.groundCells.includes(`${gx},${gy}`)) draft.groundCells.push(`${gx},${gy}`)
        break
      case 'baseTile':
      case 'overlayTile': {
        const target = brush === 'baseTile' ? draft.baseTiles : draft.overlayTiles
        const index = target.findIndex(tile => tile.x === gx && tile.y === gy)
        const next: LevelTileCell = { x: gx, y: gy, ...editorTileTemplate }
        if (index >= 0) target[index] = next
        else target.push(next)
        if (brush === 'overlayTile') syncOverlayGroundCells(draft)
        break
      }
      case 'fill': {
        const target = editorLayer === 'base' ? draft.baseTiles : draft.overlayTiles
        const at = (x: number, y: number) => target.find(tile => tile.x === x && tile.y === y)
        const origin = at(gx, gy)
        const signature = (tile?: LevelTileCell) => tile ? `${tile.source}|${tile.assetId}|${tile.tileIndex}|${tile.flipX}|${tile.rotation}` : 'empty'
        const wanted = signature(origin)
        const queue = [[gx, gy]]; const visited = new Set<string>()
        while (queue.length > 0 && visited.size < draft.cols * draft.rows) {
          const [x, y] = queue.shift()!
          const key = `${x},${y}`
          if (visited.has(key) || x < 0 || x >= draft.cols || y < 0 || y >= draft.rows || signature(at(x, y)) !== wanted) continue
          visited.add(key)
          const index = target.findIndex(tile => tile.x === x && tile.y === y)
          const next = currentTileCell(editorLayer === 'base' ? 'base' : 'overlay', x, y)
          if (index >= 0) target[index] = next; else target.push(next)
          queue.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1])
        }
        if (editorLayer === 'overlay') syncOverlayGroundCells(draft)
        break
      }
      case 'start':
        draft.startZone = { ...draft.startZone, x: gx, y: gy }
        break
      case 'finish':
        {
          const stage = draft.stages.find(item => item.id === editorStageId) ?? draft.stages.find(item => item.id === draft.startStageId) ?? draft.stages[0]
          if (stage?.objective.type === 'reach') {
            const key = `${gx},${gy}`
            const cells = objectiveFinishCells(stage.objective, draft.finishZone, draft.rows, draft.cols)
            if (!cells.includes(key)) cells.push(key)
            stage.objective = { type: 'reach', finishCells: cells }
            if (draft.startStageId === stage.id) syncLegacyStageFields(draft)
          }
        }
        break
      case 'spawnRegion':
      case 'spawnRegionErase': {
        const stage = draft.stages.find(item => item.id === editorStageId) ?? draft.stages.find(item => item.id === draft.startStageId) ?? draft.stages[0]
        if (stage?.objective.type !== 'defend' && stage?.objective.type !== 'fortressDefense') break
        const region = stage.objective.spawnRegions.find(item => item.id === editorSpawnRegionId)
        if (!region) break
        const key = `${gx},${gy}`
        if (brush === 'spawnRegionErase') region.cells = region.cells.filter(cellKey => cellKey !== key)
        else {
          for (const item of stage.objective.spawnRegions) item.cells = item.cells.filter(cellKey => cellKey !== key)
          region.cells.push(key)
        }
        if (draft.startStageId === stage.id) syncLegacyStageFields(draft)
        break
      }
      case 'trigger': {
        const event = draft.events.find(item => item.id === editorSelectedEventId)
        if (event && (event.trigger.type === 'regionEnter' || event.trigger.type === 'regionLeave' || event.trigger.type === 'regionStay')) {
          const key = `${gx},${gy}`
          if (!event.trigger.cells.includes(key)) event.trigger.cells.push(key)
        }
        break
      }
      case 'route': {
        const unit = draft.initialUnits.find(item => item.id === editorSelectedInitialUnitId)
        if (unit) {
          unit.route ??= []
          if (unit.route.length < 100) unit.route.push({ x: gx + 0.5, y: gy + 0.5 })
        }
        break
      }
      case 'unit': {
        const def = unitDefById(editorUnitDefId)
        if (!def) break
        const id = Math.max(0, ...draft.initialUnits.map(u => u.id)) + 1
        const foot = unitFootprint(def)
        draft.initialUnits.push({ id, unitDefId: def.id, faction: editorPlacementFaction, controller: 'ai', x: gx + foot.w / 2, y: gy + foot.h / 2, flipX: false, rotation: 0, renderLayer: 3, behavior: 'approach', behaviorRange: 8, behaviorInterval: 1, behaviorSpeedPercent: 100, route: [] })
        setEditorSelectedInitialUnitId(id)
        break
      }
      case 'eraser':
        if (editorLayer === 'base') draft.baseTiles = draft.baseTiles.filter(tile => tile.x !== gx || tile.y !== gy)
        else if (editorLayer === 'overlay') {
          draft.overlayTiles = draft.overlayTiles.filter(tile => tile.x !== gx || tile.y !== gy)
          syncOverlayGroundCells(draft)
        } else if (editorLayer === 'terrain') draft.terrain = draft.terrain.filter(t => !covers(t))
        else if (editorInspectorTab === 'mission') {
          const stage = draft.stages.find(item => item.id === editorStageId) ?? draft.stages.find(item => item.id === draft.startStageId) ?? draft.stages[0]
          if (stage?.objective.type === 'reach') {
            stage.objective = { type: 'reach', finishCells: objectiveFinishCells(stage.objective, draft.finishZone, draft.rows, draft.cols).filter(key => key !== `${gx},${gy}`) }
            if (draft.startStageId === stage.id) syncLegacyStageFields(draft)
          }
        }
        else {
          draft.objects = draft.objects.filter(o => !covers(o))
          draft.initialUnits = draft.initialUnits.filter(u => {
            const foot = placedUnitFootprint(u)
            return !(gx + 0.5 >= u.x - foot.w / 2 && gx + 0.5 < u.x + foot.w / 2 && gy + 0.5 >= u.y - foot.h / 2 && gy + 0.5 < u.y + foot.h / 2)
          })
          const event = draft.events.find(item => item.id === editorSelectedEventId)
          if (event && (event.trigger.type === 'regionEnter' || event.trigger.type === 'regionLeave' || event.trigger.type === 'regionStay')) event.trigger.cells = event.trigger.cells.filter(key => key !== `${gx},${gy}`)
        }
        break
    }
  }

  /** 选择工具已有地格矩形时，擦除/填充按钮直接对整块执行；无选区时仍切换普通工具。 */
  const applyEditorTileSelection = (operation: 'erase' | 'fill'): boolean => {
    const selection = editorTileSelection
    if (!selection || selection.layer !== editorLayer || (editorLayer !== 'base' && editorLayer !== 'overlay')) return false
    updateDraft(draft => {
      if (selection.layer === 'base') {
        draft.baseTiles = operation === 'erase'
          ? eraseTileCellsInRect(draft.baseTiles, selection)
          : fillTileCellsInRect(draft.baseTiles, selection, (x, y) => currentTileCell('base', x, y))
      } else {
        draft.overlayTiles = operation === 'erase'
          ? eraseTileCellsInRect(draft.overlayTiles, selection)
          : fillTileCellsInRect(draft.overlayTiles, selection, (x, y) => currentTileCell('overlay', x, y))
        syncOverlayGroundCells(draft)
      }
    })
    setEditorSelectedTile(null)
    return true
  }

  const paintAt = (gx: number, gy: number, recordHistory = true): boolean => {
    const e = editRef.current
    if (!e) return false
    if (e.brush === 'move') {
      if (editorLayer === 'base' || editorLayer === 'overlay') {
        const tiles = editorLayer === 'base' ? e.draft.baseTiles : e.draft.overlayTiles
        setEditorTileSelection({ layer: editorLayer, x: gx, y: gy, w: 1, h: 1 })
        setEditorSelectedTile(tiles.some(tile => tile.x === gx && tile.y === gy) ? { layer: editorLayer, x: gx, y: gy } : null)
        return false
      }
      moveClick(gx, gy)
      return false
    }
    if (e.brush === 'unit') {
      const hit = [...e.draft.initialUnits].reverse().find(u => {
        const foot = placedUnitFootprint(u)
        return gx + 0.5 >= u.x - foot.w / 2 && gx + 0.5 < u.x + foot.w / 2
          && gy + 0.5 >= u.y - foot.h / 2 && gy + 0.5 < u.y + foot.h / 2
      })
      if (hit) {
        setEditorSelectedInitialUnitId(hit.id)
        setEdit(cur => cur ? { ...cur } : cur)
        return false
      }
    }
    if (!brushValidAt(e.draft, e.brush, e.picked, gx, gy)) return false
    return updateDraft(d => applyBrushAt(d, e.brush, gx, gy), recordHistory)
  }

  const libraryWithCurrentDraft = (e: LevelEditState): LevelLibrary => {
    const library = structuredClone(e.library)
    const entry = library.levels.find(x => x.id === e.levelId)
    if (entry) entry.level = structuredClone(e.draft)
    return library
  }

  const persistableEditorLibrary = (e: LevelEditState): LevelLibrary => {
    const library = libraryWithCurrentDraft(e)
    library.activeId = e.levelId
    return library
  }

  const focusEditorLevel = (level: LevelConfig) => {
    previewLevel(level)
    setEditorSelectedTile(null)
    setEditorTileSelection(null)
    if (level.mode === 'advance') {
      setViewX(clampViewX(level.startZone.x + level.startZone.w / 2 - (size.w / cell) / 2, cell, size.w))
      setViewY(clampViewY(level.startZone.y + level.startZone.h / 2 - (size.h / cell) / 2, cell, size.h))
    } else {
      setViewX(0)
      setViewY(level.rows - VIEW_ROWS)
    }
    setEditorSelectedTriggerId(level.triggers[0]?.id ?? null)
    setEditorSelectedEventId(level.events[0]?.id ?? null)
    setEditorEditingEventId(null)
    setEditorSelectedInitialUnitId(level.initialUnits[0]?.id ?? null)
  }

  const switchEditorLevel = (levelId: string) => {
    const e = editRef.current
    if (!e || e.levelId === levelId) return
    const library = libraryWithCurrentDraft(e)
    const target = library.levels.find(x => x.id === levelId)
    if (!target) return
    const draft = structuredClone(target.level)
    focusEditorLevel(draft)
    const next = { ...e, library, levelId, draft, brush: draft.mode === 'advance' ? 'start' as const : 'buildzone' as const, picked: null, pickedGroup: null, selected: null, selectedGroup: [] }
    editRef.current = next
    setEdit(next)
  }

  const createEditorLevel = (duplicate: boolean) => {
    const e = editRef.current
    if (!e || e.library.levels.length >= 50) return
    recordEditorHistory(e)
    const library = libraryWithCurrentDraft(e)
    const id = nextLibraryLevelId(library)
    const current = library.levels.find(x => x.id === e.levelId)
    const level = duplicate ? structuredClone(e.draft) : defaultLevel()
    const name = duplicate ? `${current?.name ?? '关卡'} 副本` : `关卡 ${String(library.levels.length + 1).padStart(2, '0')}`
    library.levels.push({
      id,
      name: name.slice(0, 40),
      level,
      briefing: duplicate && current ? structuredClone(missionBriefingOf(current)) : defaultMissionBriefing(level),
      unlockRewards: duplicate && current?.unlockRewards ? structuredClone(current.unlockRewards) : undefined,
      deployableFortressIds: duplicate && current?.deployableFortressIds ? [...current.deployableFortressIds] : undefined,
    })
    focusEditorLevel(level)
    const next = { ...e, library, levelId: id, draft: structuredClone(level), brush: level.mode === 'advance' ? 'start' as const : 'buildzone' as const, picked: null, pickedGroup: null, selected: null, selectedGroup: [] }
    editRef.current = next
    setEdit(next)
  }

  const renameEditorLevel = (name: string) => {
    const e = editRef.current
    if (!e) return
    const library = structuredClone(e.library)
    const entry = library.levels.find(x => x.id === e.levelId)
    if (entry) entry.name = name.slice(0, 40)
    if (JSON.stringify(library) === JSON.stringify(e.library)) return
    recordEditorHistory(e)
    const next = { ...e, library }
    editRef.current = next
    setEdit(next)
  }

  const updateEditorEntry = (fn: (entry: LevelLibrary['levels'][number]) => void) => {
    const e = editRef.current
    if (!e) return
    const library = structuredClone(e.library)
    const entry = library.levels.find(x => x.id === e.levelId)
    if (entry) fn(entry)
    if (JSON.stringify(library) === JSON.stringify(e.library)) return
    recordEditorHistory(e)
    const next = { ...e, library }
    editRef.current = next
    setEdit(next)
  }

  const moveEditorLevel = (dir: -1 | 1) => {
    const e = editRef.current
    if (!e) return
    const library = libraryWithCurrentDraft(e)
    const i = library.levels.findIndex(x => x.id === e.levelId)
    const j = i + dir
    if (i < 0 || j < 0 || j >= library.levels.length) return
    recordEditorHistory(e)
    ;[library.levels[i], library.levels[j]] = [library.levels[j], library.levels[i]]
    const next = { ...e, library }
    editRef.current = next
    setEdit(next)
  }

  const deleteEditorLevel = () => {
    const e = editRef.current
    if (!e || e.library.levels.length <= 1) return
    recordEditorHistory(e)
    const library = libraryWithCurrentDraft(e)
    const i = library.levels.findIndex(x => x.id === e.levelId)
    library.levels.splice(i, 1)
    const next = library.levels[Math.min(i, library.levels.length - 1)]
    if (library.activeId === e.levelId) library.activeId = next.id
    const draft = structuredClone(next.level)
    focusEditorLevel(draft)
    const nextEdit = { ...e, library, levelId: next.id, draft, brush: draft.mode === 'advance' ? 'start' as const : 'buildzone' as const, picked: null, pickedGroup: null, selected: null, selectedGroup: [] }
    editRef.current = nextEdit
    setEdit(nextEdit)
  }

  const cancelEdit = () => {
    const e = editRef.current
    if (!e) return
    previewLevel(e.playLevel)
    setEditUndo([])
    setEditRedo([])
    setEditorSelectedTile(null)
    setEditorTileSelection(null)
    editRef.current = null
    setEdit(null)
  }

  const saveEditorDraft = () => {
    const current = editRef.current
    if (!current) return
    const draftLibrary = persistableEditorLibrary(current)
    const entry = draftLibrary.levels.find(item => item.id === current.levelId)
    const assetIds = new Set(listAssets().map(asset => asset.id))
    const soundPresetIds = new Set(audioProjectConfig().presets.filter(preset => preset.assets.length > 0 && preset.assets.every(asset => assetIds.has(asset.assetId))).map(preset => preset.id))
    const issues = validateLevelReferences(current.draft, entry, assetIds, new Set(draftLibrary.globalVariables.map(variable => variable.id)), soundPresetIds, unit => {
      return placedUnitFootprint(unit)
    })
    setEditorValidationIssues(issues)
    if (issues.some(issue => issue.severity === 'error')) return
    const savedDraft = pruneVisualLayersOutsideBounds(current.draft)
    const library = persistableEditorLibrary({ ...current, draft: savedDraft })
    saveLevelLibrary(library)
    setEditorSavedSnapshot(JSON.stringify(library))
    const next = { ...current, library, draft: structuredClone(savedDraft) }
    editRef.current = next
    setEdit(next)
  }

  const setEditorActiveLayer = (layer: LevelEditorLayer) => {
    setEditorLayer(layer)
    setEditorSelectedTile(null)
    setEditorTileSelection(null)
    setEditorSelectedInitialUnitId(null)
    setEdit(current => current ? { ...current, pickedGroup: null, selected: null, selectedGroup: [] } : current)
    if (layer === 'base') { setEditorInspectorTab('tiles'); setEditorTileTemplate(template => ({ ...template, assetId: template.assetId || 'builtin:ground/base' })); activateEditorBrush('baseTile') }
    else if (layer === 'overlay') { setEditorInspectorTab('tiles'); setEditorTileTemplate(template => ({ ...template, assetId: template.assetId || 'builtin:ground/mid' })); activateEditorBrush('overlayTile') }
    else if (layer === 'terrain') { setEditorInspectorTab('terrain'); activateEditorBrush('puddle') }
    else { setEditorInspectorTab('object'); activateEditorBrush('move') }
  }

  const locateEditorValidationIssue = (issue: LevelValidationIssue) => {
    const current = editRef.current
    if (!current) return
    const target = issue.target
    const focusCell = (x: number, y: number) => {
      setViewX(clampViewX(x - (size.w / cell) / 2, cell, size.w))
      setViewY(clampViewY(y - (size.h / cell) / 2, cell, size.h))
    }
    setEditorValidationIssues([])
    setEditorFocusedObjectEvent(null)
    if (target.kind === 'levelInfo') {
      setEditorLeftTab('settings')
      return
    }
    setEditorLayer('object')
    setEditorSelectedTile(null)
    setEditorTileSelection(null)
    if (target.kind === 'mission') {
      setEditorInspectorTab('mission')
      if (target.stageId && current.draft.stages.some(stage => stage.id === target.stageId)) setEditorStageId(target.stageId)
      setEdit(value => value ? { ...value, brush: 'move', picked: null, pickedGroup: null, selected: null, selectedGroup: [] } : value)
      return
    }
    if (target.kind === 'event') {
      setEditorInspectorTab('events')
      setEditorSelectedEventId(target.eventId ?? null)
      setEditorEditingEventId(target.eventId ?? null)
      setEdit(value => value ? { ...value, brush: 'trigger', picked: null, pickedGroup: null, selected: null, selectedGroup: [] } : value)
      const event = current.draft.events.find(item => item.id === target.eventId)
      if (event?.trigger.type === 'regionEnter' || event?.trigger.type === 'regionLeave' || event?.trigger.type === 'regionStay') {
        const [x, y] = (event.trigger.cells[0] ?? '').split(',').map(Number)
        if (Number.isFinite(x) && Number.isFinite(y)) focusCell(x + 0.5, y + 0.5)
      } else if (event?.trigger.type === 'interact' || event?.trigger.type === 'objectDestroyed') {
        const objectId = event.trigger.objectId
        const object = current.draft.objects.find((item, index) => (item.id ?? 2000 + index) === objectId)
        if (object) focusCell(object.x + object.w / 2, object.y + object.h / 2)
      }
      return
    }
    if (target.kind === 'unit') {
      const index = current.draft.initialUnits.findIndex(unit => unit.id === target.placementId)
      if (index < 0) return
      const unit = current.draft.initialUnits[index]
      const foot = placedUnitFootprint(unit)
      setEditorInspectorTab('units')
      setEditorUnitTypeFilter('all')
      setEditorUnitFactionFilter('all')
      setEditorSelectedInitialUnitId(unit.id)
      setEditorSelectedUnitEvent(target.eventId === undefined ? null : { placementId: unit.id, eventId: target.eventId })
      setEdit(value => value ? { ...value, brush: 'move', picked: null, pickedGroup: null, selected: { kind: 'unit', w: foot.w, h: foot.h, idx: index, data: { ...unit } }, selectedGroup: [] } : value)
      focusCell(unit.x + foot.w / 2, unit.y + foot.h / 2)
      return
    }
    const index = current.draft.objects.findIndex((object, objectIndex) => (object.id ?? 2000 + objectIndex) === target.objectId)
    if (index < 0) return
    const object = current.draft.objects[index]
    setEditorInspectorTab('object')
    if (target.eventId !== undefined) setEditorFocusedObjectEvent({ objectId: target.objectId, eventId: target.eventId })
    setEdit(value => value ? { ...value, brush: 'move', picked: null, pickedGroup: null, selected: { kind: 'object', w: object.w, h: object.h, idx: index, data: { ...object } }, selectedGroup: [] } : value)
    focusCell(object.x + object.w / 2, object.y + object.h / 2)
  }

  const transformEditorSelection = (kind: 'flip' | 'rotate') => {
    const current = editRef.current
    if (!current) return
    if (editorLayer === 'base' || editorLayer === 'overlay') {
      if (!editorSelectedTile) return
      updateDraft(draft => {
        const tiles = editorSelectedTile.layer === 'base' ? draft.baseTiles : draft.overlayTiles
        const tile = tiles.find(item => item.x === editorSelectedTile.x && item.y === editorSelectedTile.y)
        if (!tile || tile.source !== 'independent') return
        if (kind === 'flip') tile.flipX = !tile.flipX
        else tile.rotation = ((tile.rotation + 90) % 360) as LevelTileCell['rotation']
        setEditorTileTemplate({ source: tile.source, assetId: tile.assetId, tileIndex: tile.tileIndex, flipX: tile.flipX, rotation: tile.rotation })
      })
      return
    }
    if (editorLayer !== 'object') return

    const ghost = current.picked && (current.picked.kind === 'object' || current.picked.kind === 'unit')
      ? structuredClone(current.picked) : null
    if (ghost) {
      if (kind === 'flip') ghost.data.flipX = !ghost.data.flipX
      else {
        ghost.data.rotation = (((ghost.data.rotation ?? 0) + 90) % 360) as 0 | 90 | 180 | 270
        if (ghost.kind === 'unit') [ghost.w, ghost.h] = [ghost.h, ghost.w]
      }
      const next = { ...current, picked: ghost }
      editRef.current = next
      setEdit(next)
      return
    }

    const selected = current.selected && (current.selected.kind === 'object' || current.selected.kind === 'unit')
      ? structuredClone(current.selected) : null
    const selectedUnitId = selected?.kind === 'unit' ? selected.data.id : editorInspectorTab === 'units' ? editorSelectedInitialUnitId : null
    if (!selected && selectedUnitId == null) return
    const draft = structuredClone(current.draft)
    if (selected?.kind === 'object') {
      const object = draft.objects.find((item, index) => (item.id ?? 2000 + index) === (selected.data.id ?? 2000 + selected.idx))
      if (!object) return
      if (kind === 'flip') object.flipX = !object.flipX
      else object.rotation = (((object.rotation ?? 0) + 90) % 360) as 0 | 90 | 180 | 270
      selected.data = { ...object }
    } else {
      const unit = draft.initialUnits.find(item => item.id === selectedUnitId)
      if (!unit) return
      if (kind === 'flip') unit.flipX = !unit.flipX
      else unit.rotation = (((unit.rotation ?? 0) + 90) % 360) as 0 | 90 | 180 | 270
      if (selected?.kind === 'unit') {
        const foot = placedUnitFootprint(unit)
        selected.w = foot.w
        selected.h = foot.h
        selected.data = { ...unit }
      }
    }
    recordEditorHistory(current)
    previewLevel(draft)
    const next = { ...current, draft, selected: selected ?? current.selected }
    editRef.current = next
    setEdit(next)
  }

  const editorTransformEnabled = (editorLayer === 'base' || editorLayer === 'overlay')
    ? !!editorSelectedTile
    : editorLayer === 'object' && !!(
      (edit?.picked && (edit.picked.kind === 'object' || edit.picked.kind === 'unit'))
      || (edit?.selected && (edit.selected.kind === 'object' || edit.selected.kind === 'unit'))
      || (editorInspectorTab === 'units' && editorSelectedInitialUnitId != null)
    )

  const copyEditorSelection = () => {
    const current = editRef.current
    if (!current) return
    const group = (current.selectedGroup ?? []).map(item => resolvePicked(current.draft, item)).filter((item): item is Picked => item !== null)
    if (group.length > 0) editorClipboardRef.current = structuredClone(group)
    else if (current.selected) {
      const selected = resolvePicked(current.draft, current.selected)
      if (selected) editorClipboardRef.current = [structuredClone(selected)]
    }
    else if (current.picked && current.picked.ghostOrigin !== 'paste') editorClipboardRef.current = [structuredClone(current.picked)]
  }

  const pasteEditorSelection = () => {
    const current = editRef.current
    const copied = editorClipboardRef.current
    if (!current || !copied || copied.length === 0) return
    if (copied.length > 1) {
      const pickedGroup = pasteGroupWithFreshIds(copied, current.draft)
      setEdit({ ...current, brush: 'move', picked: null, pickedGroup, selected: null, selectedGroup: [] })
      return
    }
    const next = structuredClone(copied[0])
    if (next.kind === 'unit') next.data.id = Math.max(0, ...current.draft.initialUnits.map(unit => unit.id)) + 1
    if (next.kind === 'object') next.data.id = Math.max(0, ...current.draft.objects.map(object => object.id ?? 0)) + 1
    if (next.kind === 'terrain') next.data.id = Math.max(0, ...current.draft.terrain.map(terrain => terrain.id ?? 0)) + 1
    next.ghostOrigin = 'paste'
    setEdit({ ...current, brush: 'move', picked: next, pickedGroup: null, selected: null, selectedGroup: [] })
  }

  const deleteEditorSelection = () => {
    const current = editRef.current
    if (current?.pickedGroup) setEdit({ ...current, pickedGroup: null })
    else if (current?.picked) {
      if (current.picked.ghostOrigin === 'paste') setEdit({ ...current, picked: null })
      else setEdit({ ...current, picked: null, selected: null })
    }
    else if ((current?.selectedGroup?.length ?? 0) > 0) {
      const selected = current!.selectedGroup!
      updateDraft(draft => removePickedMany(draft, selected))
      setEditorSelectedInitialUnitId(null)
      setEdit(cur => cur ? { ...cur, selected: null, selectedGroup: [] } : cur)
    }
    else if (current?.selected) {
      const selected = current.selected
      updateDraft(draft => removePicked(draft, selected))
      if (selected.kind === 'unit' && editorSelectedInitialUnitId === selected.data.id) setEditorSelectedInitialUnitId(null)
      setEdit(cur => cur ? { ...cur, selected: null, selectedGroup: [] } : cur)
    }
    else if (editorTileSelection && (editorLayer === 'base' || editorLayer === 'overlay')) applyEditorTileSelection('erase')
    else if (editorSelectedTile) updateDraft(draft => {
      if (editorSelectedTile.layer === 'base') draft.baseTiles = draft.baseTiles.filter(tile => tile.x !== editorSelectedTile.x || tile.y !== editorSelectedTile.y)
      else draft.overlayTiles = draft.overlayTiles.filter(tile => tile.x !== editorSelectedTile.x || tile.y !== editorSelectedTile.y)
      setEditorSelectedTile(null)
    })
    else if (editorSelectedEventId !== null) updateDraft(draft => {
      draft.events = draft.events.filter(event => event.id !== editorSelectedEventId)
      if (editorEditingEventId === editorSelectedEventId) setEditorEditingEventId(null)
      setEditorSelectedEventId(null)
    })
  }

  useEffect(() => {
    if (!edit) return
    const onEditorKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const typing = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.tagName === 'SELECT'
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); saveEditorDraft(); return }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); if (event.shiftKey) redoEditorChange(); else undoEditorChange(); return }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); redoEditorChange(); return }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c' && !typing) { event.preventDefault(); copyEditorSelection(); return }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v' && !typing) { event.preventDefault(); pasteEditorSelection(); return }
      if (event.key === 'Delete' && !typing) { event.preventDefault(); deleteEditorSelection() }
      if (event.key === 'Escape' && !typing) {
        event.preventDefault()
        if (editRef.current?.picked || editRef.current?.pickedGroup) cancelMove()
        else {
          setEditorSelectedInitialUnitId(null)
          setEditorSelectedTile(null)
          setEditorTileSelection(null)
          setEditorSelectedEventId(null)
          setEdit(current => current ? { ...current, selected: null, selectedGroup: [] } : current)
        }
      }
    }
    window.addEventListener('keydown', onEditorKey)
    return () => window.removeEventListener('keydown', onEditorKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 编辑器命令通过 editRef 读取最新草稿
  }, [edit, editorLayer, editorSelectedTile, editorTileSelection])

  // rAF 渲染输入：每渲染同步最新值（rAF 回调经 ref 读取保证实时）
  const drawInputsRef = useRef({ game, viewX, viewY, hover, mode, selTurret, selectedEnemyUnitId, size, cell, prep, edit, brushFoot, brushValidAt, pasteGroupValidAt, positionedPasteGroup, interior, interiorSel, interiorRot, hoverInterior, panel, editorLayer, editorShowGrid, editorShowHeight, editorSelectedEventId, editorStageId, editorSpawnRegionId, editorFortressPlacementTarget: activeEditorFortressPlacementTarget, editorTileTemplate, editorTileSelection, editorSnap, editorPlacementFaction, editorObjectDefId, editorUnitDefId, editorSelectedTriggerId, editorSelectedInitialUnitId })
  useEffect(() => {
    drawInputsRef.current = { game, viewX, viewY, hover, mode, selTurret, selectedEnemyUnitId, size, cell, prep, edit, brushFoot, brushValidAt, pasteGroupValidAt, positionedPasteGroup, interior, interiorSel, interiorRot, hoverInterior, panel, editorLayer, editorShowGrid, editorShowHeight, editorSelectedEventId, editorStageId, editorSpawnRegionId, editorFortressPlacementTarget: activeEditorFortressPlacementTarget, editorTileTemplate, editorTileSelection, editorSnap, editorPlacementFaction, editorObjectDefId, editorUnitDefId, editorSelectedTriggerId, editorSelectedInitialUnitId }
  })

  // rAF 渲染循环：逻辑已按实际帧间隔推进，直接绘制最新状态，不再进行旧 10Hz 状态插值。
  useEffect(() => {
    let raf = 0
    let previousDrawTime = performance.now()
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop)
      const frameMs = Math.max(0.01, now - previousDrawTime)
      previousDrawTime = now
      const canvas = canvasRef.current
      if (!canvas) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      const a = drawInputsRef.current
      const { viewX: vx, viewY: vy, hover: hov0, mode: md, selTurret: sel, selectedEnemyUnitId: selectedEnemy, size: sz, cell: cl, prep: pp, edit: ed } = a
      // Canvas 直接读取逻辑侧最新快照，不受 30Hz HUD 发布频率限制。
      const cur = gameRef.current
      // 固定参考分辨率本身就是渲染分辨率，不再叠加设备 DPR；自适应仍将 DPR 限制在 2。
      const dpr = displayConfig().resolutionMode === 'fixed' && !ed ? 1 : Math.min(2, window.devicePixelRatio || 1)
      const bufferWidth = Math.max(1, Math.round(sz.w * dpr))
      const bufferHeight = Math.max(1, Math.round(sz.h * dpr))
      if (canvas.width !== bufferWidth || canvas.height !== bufferHeight) {
        canvas.width = bufferWidth
        canvas.height = bufferHeight
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      const view = cur
      // 相机：编辑模式手动卷动；游玩模式跟随堡垒中心（宽战场横向卷动）
      let camX: number
      let camY: number
      if (ed) {
        camX = clampViewX(vx, cl, sz.w)
        camY = clampViewY(vy, cl, sz.h)
      } else if (combatPreparationOpenRef.current) {
        if (view.objective.type === 'fortressDefense') {
          camX = clampBattlePreparationView(vx, LEVEL.cols, cl, sz.w)
          camY = clampBattlePreparationView(vy, LEVEL.rows, cl, sz.h)
        } else {
          // 非堡垒防御整备期间，镜头始终锁定主控单位几何中心。
          const centered = playerCenteredCamera(view, cl, sz.w, sz.h)
          camX = centered.x
          camY = centered.y
        }
      } else if (view.cinematicCamera) {
        const camera = view.cinematicCamera
        if (cinematicCameraRef.current?.id !== camera.id) cinematicCameraRef.current = { id: camera.id, fromX: camRef.current.x, fromY: camRef.current.y }
        const origin = cinematicCameraRef.current
        const elapsed = Math.max(0, view.time - camera.startedAt)
        const target = unboundedCenteredView(camera.x, camera.y, cl, sz.w, sz.h)
        const targetX = target.x
        const targetY = target.y
        if (elapsed < camera.duration) {
          const progress = camera.duration <= 0 ? 1 : Math.max(0, Math.min(1, elapsed / camera.duration))
          const eased = progress * progress * (3 - 2 * progress)
          camX = origin.fromX + (targetX - origin.fromX) * eased
          camY = origin.fromY + (targetY - origin.fromY) * eased
        } else if (camera.returnToOrigin && elapsed > camera.duration + camera.hold) {
          const progress = camera.duration <= 0 ? 1 : Math.max(0, Math.min(1, (elapsed - camera.duration - camera.hold) / camera.duration))
          const eased = progress * progress * (3 - 2 * progress)
          const playerView = playerCenteredCamera(view, cl, sz.w, sz.h)
          camX = targetX + (playerView.x - targetX) * eased
          camY = targetY + (playerView.y - targetY) * eased
        } else {
          camX = targetX
          camY = targetY
        }
      } else {
        cinematicCameraRef.current = null
        // 所有战斗模式统一以玩家战车几何中心跟随；允许视口越出地图，场景外绘制为黑色。
        const centered = playerCenteredCamera(view, cl, sz.w, sz.h)
        camX = centered.x
        camY = centered.y
      }
      camRef.current = { x: camX, y: camY }
      const ghost: UiHints['ghost'] = null
      let wallGhost: UiHints['wallGhost'] = null
      let editOverlay: UiHints['edit']
      if (ed) {
          const freePosition = a.editorLayer === 'object' && !a.editorSnap && ed.brush !== 'trigger' && ed.brush !== 'route' && ed.brush !== 'start' && ed.brush !== 'finish'
        const hov = hov0 ? {
          x: freePosition ? Math.round(hov0.x * 10) / 10 : Math.floor(hov0.x),
          y: freePosition ? Math.round(hov0.y * 10) / 10 : Math.floor(hov0.y),
        } : null
        const groupOrigins = ed.pickedGroup?.items.map(pickedOrigin) ?? []
        const groupW = ed.pickedGroup ? Math.max(...ed.pickedGroup.items.map((item, index) => groupOrigins[index].x + item.w)) - ed.pickedGroup.anchorX : 1
        const groupH = ed.pickedGroup ? Math.max(...ed.pickedGroup.items.map((item, index) => groupOrigins[index].y + item.h)) - ed.pickedGroup.anchorY : 1
        const foot = ed.pickedGroup ? { w: groupW, h: groupH } : a.brushFoot(ed.draft, ed.brush, ed.picked)
        const hoverOk = !!hov && (ed.pickedGroup
          ? a.pasteGroupValidAt(ed.draft, ed.pickedGroup, hov.x, hov.y)
          : a.brushValidAt(ed.draft, ed.brush, ed.picked, hov.x, hov.y))
        const previewTile = hoverOk && (ed.brush === 'baseTile' || ed.brush === 'overlayTile')
          ? { x: hov.x, y: hov.y, ...a.editorTileTemplate }
          : null
        const previewObject = hoverOk && (ed.brush === 'barrel' || ed.brush === 'ruins' || ed.brush === 'rock')
          ? (() => {
            const def = objectTypeById(a.editorObjectDefId) ?? objectTypeLibrary()[0]
            return def ? { kind: 'rock', defId: def.id, x: hov.x, y: hov.y, w: foot.w, h: foot.h, blockProjectile: def.blockProjectile, height: def.height, renderLayer: def.renderLayer, flipX: false, rotation: 0 as const, preview: true } : null
          })()
          : null
        const previewUnit = hoverOk && ed.brush === 'unit'
          ? (() => {
            const def = unitDefById(a.editorUnitDefId)
            if (!def) return null
            return {
              id: -9_900_001, unitDefId: def.id, name: def.name, faction: a.editorPlacementFaction,
              x: hov.x + foot.w / 2, y: hov.y + foot.h / 2,
              size: def.stats.size, width: def.visual?.width ?? def.stats.size * 2,
              height: def.visual?.height ?? def.stats.size * 2, bodyAsset: def.visual?.bodyAsset,
              footprintW: foot.w, footprintH: foot.h, renderLayer: 3 as const, selected: false, preview: true,
            }
          })()
          : null
        const replacePreviewTile = (tiles: LevelTileCell[], layer: 'baseTile' | 'overlayTile') => previewTile && ed.brush === layer
          ? [...tiles.filter(tile => tile.x !== previewTile.x || tile.y !== previewTile.y), previewTile]
          : tiles
        const movingGhost = hoverOk && ed.brush === 'move' && ed.picked && hov ? ed.picked : null
        const ghostX = hov?.x ?? 0, ghostY = hov?.y ?? 0
        const movingGroup = hoverOk && ed.brush === 'move' && ed.pickedGroup && hov
          ? a.positionedPasteGroup(ed.pickedGroup, ghostX, ghostY)
          : []
        const selected = ed.selected
        const selection = selected ? selected.kind === 'unit'
          ? { x: selected.data.x - selected.w / 2, y: selected.data.y - selected.h / 2, w: selected.w, h: selected.h }
          : { x: selected.data.x, y: selected.data.y, w: selected.w, h: selected.h }
          : null
        const groupedSelections = ed.selectedGroup ?? []
        const selections = groupedSelections.length > 0
          ? groupedSelections.map(item => item.kind === 'unit'
            ? { x: item.data.x - item.w / 2, y: item.data.y - item.h / 2, w: item.w, h: item.h }
            : { x: item.data.x, y: item.data.y, w: item.w, h: item.h })
          : selection ? [selection] : []
        const selectedUnitIds = new Set(groupedSelections.filter(item => item.kind === 'unit').map(item => item.data.id))
        const fortressStage = ed.draft.stages.find(item => item.id === a.editorStageId) ?? ed.draft.stages.find(item => item.id === ed.draft.startStageId) ?? ed.draft.stages[0]
        const fortressObjective = fortressStage?.objective.type === 'fortressDefense' ? fortressStage.objective : null
        const fortressPreviewDef = fortressObjective ? playableVehicleDefs().find(def => def.id === fortressObjective.fortressDefId) : undefined
        const fortressPreviewUnit = fortressObjective && fortressPreviewDef ? {
          id: -9_800_001,
          unitDefId: fortressPreviewDef.unitId ?? fortressUnitId(fortressPreviewDef.id),
          name: `堡垒 · ${fortressPreviewDef.name}`,
          faction: 'player' as const,
          x: fortressObjective.fortressPoint.x,
          y: fortressObjective.fortressPoint.y,
          size: Math.max(0.25, Math.min(fortressPreviewDef.w, fortressPreviewDef.h) / 2),
          width: fortressPreviewDef.w,
          height: fortressPreviewDef.h,
          bodyAsset: fortressPreviewDef.spriteBody,
          footprintW: fortressPreviewDef.w,
          footprintH: fortressPreviewDef.h,
          renderLayer: 3 as const,
          selected: a.editorFortressPlacementTarget?.stageId === fortressStage?.id && a.editorFortressPlacementTarget.kind === 'fortress',
        } : null
        editOverlay = {
          cells: ed.draft.buildCells,
          groundCells: ed.draft.groundCells,
          baseTiles: replacePreviewTile(ed.draft.baseTiles, 'baseTile'),
          overlayTiles: replacePreviewTile(ed.draft.overlayTiles, 'overlayTile'),
          terrain: [...ed.draft.terrain, ...(movingGhost?.kind === 'terrain' ? [{ ...movingGhost.data, x: ghostX, y: ghostY, preview: true }] : []), ...movingGroup.flatMap(({ item, x, y }) => item.kind === 'terrain' ? [{ ...item.data, x, y, preview: true }] : [])],
          objects: [...ed.draft.objects, ...(previewObject ? [previewObject] : []), ...(movingGhost?.kind === 'object' ? [{ ...movingGhost.data, x: ghostX, y: ghostY, preview: true }] : []), ...movingGroup.flatMap(({ item, x, y }) => item.kind === 'object' ? [{ ...item.data, x, y, preview: true }] : [])],
          showHeight: a.editorShowHeight,
          centerCell: levelCenterCell(ed.draft.cols, ed.draft.rows),
          startZone: ed.draft.startZone,
          finishCells: (() => { const stage = ed.draft.stages.find(item => item.id === a.editorStageId) ?? ed.draft.stages.find(item => item.id === ed.draft.startStageId) ?? ed.draft.stages[0]; return stage?.objective.type === 'reach' ? objectiveFinishCells(stage.objective, ed.draft.finishZone, ed.draft.rows, ed.draft.cols) : [] })(),
          spawnRegions: fortressStage?.objective.type === 'defend' || fortressStage?.objective.type === 'fortressDefense' ? fortressStage.objective.spawnRegions.map(region => ({ ...region, selected: region.id === a.editorSpawnRegionId })) : [],
          triggers: ed.draft.triggers.map(t => ({ ...t, selected: t.id === a.editorSelectedTriggerId })),
          events: ed.draft.events.flatMap(event => {
            const trigger = event.trigger
            if (trigger.type !== 'regionEnter' && trigger.type !== 'regionLeave' && trigger.type !== 'regionStay') return []
            return [{ id: event.id, name: event.name, cells: trigger.cells, enabled: event.enabled, selected: event.id === a.editorSelectedEventId }]
          }),
          routes: ed.draft.initialUnits.filter(unit => (unit.route?.length ?? 0) > 0).map(unit => ({ unitId: unit.id, points: unit.route ?? [], selected: unit.id === a.editorSelectedInitialUnitId })),
          units: [...ed.draft.initialUnits.flatMap(u => {
            const def = unitDefById(u.unitDefId)
            if (!def) return []
            return [{
              id: u.id, unitDefId: def.id, name: def.name, faction: u.faction, x: u.x, y: u.y,
              size: def.stats.size, width: def.visual?.width ?? def.stats.size * 2,
              height: def.visual?.height ?? def.stats.size * 2, bodyAsset: def.visual?.bodyAsset,
              footprintW: placedUnitFootprint(u).w, footprintH: placedUnitFootprint(u).h,
              flipX: u.flipX, rotation: u.rotation ?? 0, renderLayer: 3 as const,
              selected: u.id === a.editorSelectedInitialUnitId || selectedUnitIds.has(u.id),
            }]
          }), ...(fortressPreviewUnit ? [fortressPreviewUnit] : []), ...(previewUnit ? [previewUnit] : []), ...(movingGhost?.kind === 'unit' ? (() => { const def = unitDefById(movingGhost.data.unitDefId); return def ? [{ id: movingGhost.data.id, unitDefId: def.id, name: def.name, faction: movingGhost.data.faction, x: ghostX + movingGhost.w / 2, y: ghostY + movingGhost.h / 2, size: def.stats.size, width: def.visual?.width ?? def.stats.size * 2, height: def.visual?.height ?? def.stats.size * 2, bodyAsset: def.visual?.bodyAsset, footprintW: movingGhost.w, footprintH: movingGhost.h, flipX: movingGhost.data.flipX, rotation: movingGhost.data.rotation ?? 0, renderLayer: 1 as const, selected: false, preview: true }] : [] })() : []), ...movingGroup.flatMap(({ item, x, y }) => { if (item.kind !== 'unit') return []; const def = unitDefById(item.data.unitDefId); return def ? [{ id: item.data.id, unitDefId: def.id, name: def.name, faction: item.data.faction, x: x + item.w / 2, y: y + item.h / 2, size: def.stats.size, width: def.visual?.width ?? def.stats.size * 2, height: def.visual?.height ?? def.stats.size * 2, bodyAsset: def.visual?.bodyAsset, footprintW: item.w, footprintH: item.h, flipX: item.data.flipX, rotation: item.data.rotation ?? 0, renderLayer: 1 as const, selected: false, preview: true }] : [] })],
          fortressDefense: fortressObjective && fortressStage ? {
            stageId: fortressStage.id,
            fortressPoint: fortressObjective.fortressPoint,
            returnPoint: fortressObjective.returnPoint,
            selectedTarget: a.editorFortressPlacementTarget?.stageId === fortressStage.id ? a.editorFortressPlacementTarget : null,
          } : null,
          selection,
          selections,
          tileSelection: (a.editorLayer === 'base' || a.editorLayer === 'overlay') && a.editorTileSelection?.layer === a.editorLayer
            ? { x: a.editorTileSelection.x, y: a.editorTileSelection.y, w: a.editorTileSelection.w, h: a.editorTileSelection.h }
            : null,
          selectionArea: editorMarqueeRef.current,
          hover: hov && !editorMarqueeRef.current ? { ...hov, w: foot.w, h: foot.h, ok: hoverOk, ghost: !!movingGhost || movingGroup.length > 0 } : null,
        }
      } else if (pp && hov0 && md.kind === 'demolish') {
        // 拆除幽灵：指向堡垒上可卸下的炮塔（内置武器不可拆）
        const gx = Math.floor(hov0.x)
        const gy = Math.floor(hov0.y)
        const target = cur.turrets.some(t => !t.builtIn && hov0.x >= t.x && hov0.x < t.x + t.w && hov0.y >= t.y && hov0.y < t.y + t.h)
        wallGhost = { x: gx, y: gy, ok: target, reason: target ? undefined : '指向炮塔卸下' }
      }
      // 内部建造幽灵：世界坐标 → 堡垒局部格阵（随朝向旋转）
      let interiorGhost: UiHints['interiorGhost'] = null
      if (a.interior && !ed && a.interiorSel && a.hoverInterior) {
        const md2 = moduleDefOf(a.interiorSel)
        const foot2 = moduleFoot(md2, a.interiorRot)
        interiorGhost = {
          x: a.hoverInterior.x, y: a.hoverInterior.y, w: foot2.w, h: foot2.h,
          cells: moduleCells(md2, a.interiorRot), // v2.31 异型逐格幽灵
          ok: pp && canPlaceModule(cur, a.interiorSel, a.hoverInterior.x, a.hoverInterior.y, a.interiorRot).ok,
        }
      }
      const _d0 = performance.now()
      draw(ctx, view, { cell: cl, viewX: camX, viewY: camY, overheated: cur.fortress.overheated }, {
        ghost, wallGhost, selectedTurret: sel, selectedEnemyUnit: selectedEnemy, buildMode: pp && !ed, edit: editOverlay,
        showGrid: ed ? a.editorShowGrid : false,
        mountDefId: pp && !ed && md.kind === 'turret' ? md.defId : null,
        turretPanel: !ed && a.panel === 'turret', // v1.75：炮塔按钮按下（卡片栏展开）时显示炮位槽位圈/字母
        interiorMode: a.interior && !ed,
        interiorGhost,
      }, sz.w, sz.h)
      const _dm = performance.now() - _d0
      const _pd = perfRef.current
      _pd.drawMs = _pd.drawMs * 0.95 + _dm * 0.05
      if (_dm > _pd.drawMax) _pd.drawMax = _dm
      if (performanceOptionsRef.current.enabled && !ed && !missionOpenRef.current && !combatPreparationOpenRef.current && !debugRef.current && !isTerminalPhase(cur.phase)) {
        const snapshot = recordPerformanceFrame(performanceAccumulatorRef.current, {
          frameMs,
          drawMs: _pd.drawMs,
          drawMaxMs: _pd.drawMax,
          tickMs: _pd.tickMs,
          tickMaxMs: _pd.tickMax,
          engine: _pd.engine,
        })
        if (snapshot) publishPerformanceMonitor(snapshot)
      }
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])

  const toCell = (e: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect()
    const effCell = size.cell * (rect.width / size.w) // 缩放感知：可见格数 = VIEW_COLS / zoom
    return {
      x: camRef.current.x + (e.clientX - rect.left) / effCell,
      y: camRef.current.y + (e.clientY - rect.top) / effCell,
    }
  }

  const fortressPlacementPoint = (draft: LevelConfig, target: FortressEditorPlacementTarget): { x: number; y: number } | null => {
    const stage = draft.stages.find(item => item.id === target.stageId)
    if (stage?.objective.type !== 'fortressDefense') return null
    if (target.kind === 'fortress') return stage.objective.fortressPoint
    return stage.objective.returnPoint
  }

  /** 任务页空间配置优先按当前选中项命中；用于解决堡垒、返回点与槽位重叠时的选择歧义。 */
  const fortressPlacementAt = (draft: LevelConfig, cx: number, cy: number): FortressEditorPlacementTarget | null => {
    if (editorInspectorTab !== 'mission') return null
    const stage = draft.stages.find(item => item.id === editorStageId) ?? draft.stages.find(item => item.id === draft.startStageId) ?? draft.stages[0]
    if (stage?.objective.type !== 'fortressDefense') return null
    const objective = stage.objective
    const hit = (target: FortressEditorPlacementTarget): boolean => {
      const point = fortressPlacementPoint(draft, target)
      if (!point) return false
      if (target.kind === 'fortress') {
        const def = playableVehicleDefs().find(item => item.id === objective.fortressDefId)
        const halfW = Math.max(0.5, (def?.w ?? 1) / 2)
        const halfH = Math.max(0.5, (def?.h ?? 1) / 2)
        return Math.abs(cx - point.x) <= halfW && Math.abs(cy - point.y) <= halfH
      }
      return Math.abs(cx - point.x) <= 0.5 && Math.abs(cy - point.y) <= 0.5
    }
    const active = activeEditorFortressPlacementTarget?.stageId === stage.id ? activeEditorFortressPlacementTarget : null
    // 面板已指定目标时，整个画布成为该目标的拖拽面；这样即使多个标识完全重叠，
    // 也能从任意可见位置开始拖拽。再次点击面板按钮可退出该模式。
    if (active) return active
    const returnTarget: FortressEditorPlacementTarget = { stageId: stage.id, kind: 'return' }
    if (hit(returnTarget)) return returnTarget
    const fortressTarget: FortressEditorPlacementTarget = { stageId: stage.id, kind: 'fortress' }
    return hit(fortressTarget) ? fortressTarget : null
  }

  /** 拖拽过程中只更新任务阶段坐标；首次位移由手势层单独记录一次撤销快照。 */
  const moveFortressPlacement = (target: FortressEditorPlacementTarget, pointerX: number, pointerY: number): void => {
    const current = editRef.current
    if (!current) return
    const stage = current.draft.stages.find(item => item.id === target.stageId)
    if (stage?.objective.type !== 'fortressDefense') return
    const fortressObjective = stage.objective
    const def = playableVehicleDefs().find(item => item.id === fortressObjective.fortressDefId)
    const halfW = target.kind === 'fortress' ? Math.max(0.5, (def?.w ?? 1) / 2) : 0.5
    const halfH = target.kind === 'fortress' ? Math.max(0.5, (def?.h ?? 1) / 2) : 0.5
    const snap = (value: number) => editorSnap ? Math.round(value * 2) / 2 : Math.round(value * 10) / 10
    const x = Math.max(halfW, Math.min(current.draft.cols - halfW, snap(pointerX)))
    const y = Math.max(halfH, Math.min(current.draft.rows - halfH, snap(pointerY)))
    updateDraft(draft => {
      const next = draft.stages.find(item => item.id === target.stageId)
      if (next?.objective.type !== 'fortressDefense') return
      if (target.kind === 'fortress') next.objective.fortressPoint = { x, y }
      else next.objective.returnPoint = { x, y }
      if (draft.startStageId === next.id) syncLegacyStageFields(draft)
    }, false)
  }

  /** 命中堡垒炮位：指针世界坐标 0.45 格内的可见炮位（挂炮用；炮位随船体朝向旋转） */
  const hardpointAt = (g: GameState, cx: number, cy: number) => {
    for (const hp of fortressDef(g).hardpoints) {
      const wp = hardpointWorldPos(g, hp)
      if (Math.hypot(cx - wp.x, cy - wp.y) <= 0.45) return hp
    }
    return null
  }

  /** 指针世界坐标 → 内部模块格阵格（随船体旋转逆变换；越界返回 null） */
  const interiorCellAt = (g: GameState, cx: number, cy: number) => {
    const l = worldToFortressInteriorLocal(g, cx, cy)
    const x = Math.floor(l.x)
    const y = Math.floor(l.y)
    if (x < 0 || y < 0) return null
    if (!fortressInteriorSet(fortressDef(g)).has(`${x},${y}`)) return null // 内部自由格阵
    return { x, y }
  }

  const openCombatPreparation = (targetId: number | null = null) => {
    releaseAllMovement()
    setPanel(null)
    setInterior(false)
    setCombatPreparationUnitId(targetId)
    if (gameRef.current.objective.type === 'fortressDefense') {
      setViewX(clampBattlePreparationView(camRef.current.x, LEVEL.cols, cell, size.w))
      setViewY(clampBattlePreparationView(camRef.current.y, LEVEL.rows, cell, size.h))
    }
    setCombatPreparationOpen(true)
  }

  const doClickCell = (cx: number, cy: number) => {
    const gx = Math.floor(cx)
    const gy = Math.floor(cy)
    // 内部建造模式：原地摆放/拆除模块（不切换界面）
    if (interior) {
      const ic = interiorCellAt(game, cx, cy)
      if (!ic) return
      if (interiorDemo) {
        if (!assemblyAllowed) return
        const m = game.modules.find(m => // v2.31 逐格命中（异型模块空洞不可点拆）
          moduleCells(moduleDefOf(m.defId), m.rot).some(c => m.x + c.x === ic.x && m.y + c.y === ic.y))
        if (m) setGame(g => demolishModule(g, m.id))
        return
      }
      if (interiorSel && assemblyAllowed) {
        setGame(g => buildModule(g, interiorSel, ic.x, ic.y, interiorRot))
      }
      return
    }
    if (mode.kind === 'turret') {
      // 炮塔建造工具只处理当前主控单位炮位；地图固定火力点通过玩家单位整备。
      if (!assemblyAllowed) return
      const hp = hardpointAt(game, cx, cy)
      if (hp) setGame(g => mountTurret(g, mode.defId, hp.id))
      return
    }
    if (mode.kind === 'demolish') {
      if (!assemblyAllowed) return
      setGame(g => demolishAt(g, gx, gy)) // 命中炮塔 = 卸下（内置武器引擎内拦截）
      return
    }
    const playerUnitTargetId = playerUnitAssemblyTargetAt(game, cx, cy)
    if (playerUnitTargetId !== null) {
      openCombatPreparation(playerUnitTargetId)
      return
    }
    const selectedEnemy = [...game.enemies].reverse().find(enemy => {
      if (enemy.hp <= 0) return false
      const unit = runtimeEnemyUnitDef(enemy.unitDefId, enemy.kind)
      const collision = unitCollisionRadii(unit)
      const scale = enemy.bossSizeScale ?? 1
      if (!playerTeamCanSeePoint(game, enemy.x, enemy.y, Math.max(collision.x, collision.y) * scale)) return false
      const altitude = currentUnitAltitude(enemy, unit)
      return pointInsideUnitShape(cx, cy, { ...enemy, y: enemy.y - altitude }, unit, 0.12)
    })
    if (interactWithUnitAt(game, cx, cy) || interactWithObjectAt(game, cx, cy)) {
      setGame({ ...game })
      if (selectedEnemy) {
        setSelectedEnemyUnitId(current => current === selectedEnemy.id ? null : selectedEnemy.id)
        setSelTurret(null)
      }
      return
    }
    if (selectedEnemy) {
      setSelectedEnemyUnitId(current => current === selectedEnemy.id ? null : selectedEnemy.id)
      setSelTurret(null)
      return
    }
    // 无工具：点炮塔查看/升级
    const t = game.turrets.find(t => cx >= t.x && cx < t.x + t.w && cy >= t.y && cy < t.y + t.h)
    if (t) {
      setSelTurret(selTurret === t.id ? null : t.id)
      setSelectedEnemyUnitId(null)
      return
    }
    setSelTurret(null)
    setSelectedEnemyUnitId(null)
  }

  const beginSelectionGhost = (gesture: EditorPointerGesture) => {
    if (gesture.ghostStarted || !gesture.selectionCandidate) return
    const current = editRef.current
    if (!current || current.brush !== 'move' || current.picked) return
    const draft = structuredClone(current.draft)
    const picked = structuredClone(gesture.selectionCandidate)
    removePicked(draft, picked)
    picked.ghostOrigin = 'move'
    recordEditorHistory(current)
    previewLevel(draft)
    setEdit({ ...current, draft, picked, pickedGroup: null, selected: null, selectedGroup: [] })
    gesture.ghostStarted = true
  }

  const onPointerDown = (e: React.PointerEvent) => {
    ptrsRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (e.button === 2 && (editRef.current?.picked?.ghostOrigin === 'paste' || editRef.current?.pickedGroup?.ghostOrigin === 'paste')) {
      e.preventDefault()
      ptrsRef.current.delete(e.pointerId)
      cancelMove()
      return
    }
    if (ptrsRef.current.size === 2) {
      // 第二指落下：取消单指手势（摇杆/点击/铺设），进入捏合缩放
      const [p1, p2] = [...ptrsRef.current.values()]
      pinchRef.current = { d0: Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1, z0: zoomRef.current, midX: (p1.x + p2.x) / 2, midY: (p1.y + p2.y) / 2, viewX, viewY }
      if (dragRef.current?.holdTimer) window.clearTimeout(dragRef.current.holdTimer)
      dragRef.current = null
      releaseJoystick()
      return
    }
    if (dragRef.current) return // 单指手势优先，多余触点忽略
    (e.target as HTMLElement).setPointerCapture(e.pointerId)
    if (edit) {
      // 场景编辑：铺设型笔刷即点即铺（可按住拖动连铺）；放置型笔刷松手落子
      const panOnly = e.button === 1
      if (panOnly) e.preventDefault()
      const painting = !panOnly && PAINT_BRUSHES.has(edit.brush)
      const cellAtDown = toCell(e)
      setHover(cellAtDown)
      const fortressPlacement = !panOnly && e.button === 0 ? fortressPlacementAt(edit.draft, cellAtDown.x, cellAtDown.y) : null
      if (fortressPlacement) {
        const point = fortressPlacementPoint(edit.draft, fortressPlacement)
        if (point) {
          setEditorFortressPlacementTarget(fortressPlacement)
          dragRef.current = {
            startX: e.clientX, startY: e.clientY, startViewX: viewX, startViewY: viewY,
            moved: false, painting: false, panOnly: false, historyRecorded: false, pointerType: e.pointerType,
            fortressPlacement: { target: fortressPlacement, offsetX: cellAtDown.x - point.x, offsetY: cellAtDown.y - point.y },
          }
          return
        }
      }
      const tileLayerSelection = editorLayer === 'base' || editorLayer === 'overlay'
      const selectionCandidate = !panOnly && edit.brush === 'move' && !tileLayerSelection && !edit.picked && !edit.pickedGroup
        ? hitTest(edit.draft, Math.floor(cellAtDown.x), Math.floor(cellAtDown.y)) ?? undefined
        : undefined
      const marqueeStart = !panOnly && edit.brush === 'move' && (tileLayerSelection || editorLayer === 'object') && !edit.picked && !edit.pickedGroup && !selectionCandidate
        ? { x: cellAtDown.x, y: cellAtDown.y }
        : undefined
      const gesture: EditorPointerGesture = { startX: e.clientX, startY: e.clientY, startViewX: viewX, startViewY: viewY, moved: false, painting, panOnly, historyRecorded: false, pointerType: e.pointerType, selectionCandidate, marqueeStart }
      if (selectionCandidate) gesture.holdTimer = window.setTimeout(() => {
        if (dragRef.current === gesture) beginSelectionGhost(gesture)
      }, 180)
      dragRef.current = gesture
      if (painting) {
        const c = toCell(e)
        const gx = Math.floor(c.x), gy = Math.floor(c.y)
        dragRef.current.lastPaintKey = `${gx},${gy}`
        dragRef.current.historyRecorded = paintAt(gx, gy, true)
      }
      return
    }
    // 游玩模式：相机跟随堡垒，拖动仅作点击阈值判定
    dragRef.current = { startX: e.clientX, startY: e.clientY, startViewX: viewX, startViewY: viewY, moved: false, painting: false, panOnly: false, historyRecorded: false, pointerType: e.pointerType }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (ptrsRef.current.has(e.pointerId)) ptrsRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pinchRef.current && ptrsRef.current.size >= 2) {
      const [p1, p2] = [...ptrsRef.current.values()]
      const d = Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1
      applyZoom(pinchRef.current.z0 * (d / pinchRef.current.d0), true)
      const rect = canvasRef.current?.getBoundingClientRect()
      const displayScale = rect ? rect.width / size.w : 1
      const midX = (p1.x + p2.x) / 2; const midY = (p1.y + p2.y) / 2
      const preparationPanning = combatPreparationOpenRef.current && gameRef.current.objective.type === 'fortressDefense'
      const nextViewX = pinchRef.current.viewX - (midX - pinchRef.current.midX) / (size.cell * displayScale)
      const nextViewY = pinchRef.current.viewY - (midY - pinchRef.current.midY) / (size.cell * displayScale)
      setViewX(preparationPanning ? clampBattlePreparationView(nextViewX, LEVEL.cols, cell, size.w) : clampViewX(nextViewX, cell, size.w))
      setViewY(preparationPanning ? clampBattlePreparationView(nextViewY, LEVEL.rows, cell, size.h) : clampViewY(nextViewY, cell, size.h))
      return
    }
    const c = toCell(e)
    setHover(c)
    if (interior) setHoverInterior(interiorCellAt(gameRef.current, c.x, c.y))
    const d = dragRef.current
    if (!d) return
    if (d.painting) {
      if (edit) {
        const gx = Math.floor(c.x), gy = Math.floor(c.y)
        const key = `${gx},${gy}`
        if (d.lastPaintKey === key) return
        d.lastPaintKey = key
        const changed = paintAt(gx, gy, !d.historyRecorded)
        if (changed) d.historyRecorded = true
      }
      return
    }
    const dx = e.clientX - d.startX
    const dy = e.clientY - d.startY
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) d.moved = true
    if (combatPreparationOpenRef.current) {
      if (gameRef.current.objective.type === 'fortressDefense' && d.moved) {
        const rect = canvasRef.current?.getBoundingClientRect()
        const displayScale = rect ? rect.width / size.w : 1
        setViewX(clampBattlePreparationView(d.startViewX - dx / (size.cell * displayScale), LEVEL.cols, cell, size.w))
        setViewY(clampBattlePreparationView(d.startViewY - dy / (size.cell * displayScale), LEVEL.rows, cell, size.h))
      }
      return
    }
    if (edit && d.fortressPlacement) {
      if (d.moved) {
        if (!d.historyRecorded) {
          recordEditorHistory(editRef.current)
          d.historyRecorded = true
        }
        moveFortressPlacement(d.fortressPlacement.target, c.x - d.fortressPlacement.offsetX, c.y - d.fortressPlacement.offsetY)
      }
      return
    }
    if (edit && edit.brush === 'move' && d.marqueeStart) {
      if (d.moved) editorMarqueeRef.current = editorLayer === 'base' || editorLayer === 'overlay'
        ? gridCellSelectionRect(d.marqueeStart.x, d.marqueeStart.y, c.x, c.y, edit.draft.cols, edit.draft.rows)
        : {
            x: Math.min(d.marqueeStart.x, c.x),
            y: Math.min(d.marqueeStart.y, c.y),
            w: Math.max(0.01, Math.abs(c.x - d.marqueeStart.x)),
            h: Math.max(0.01, Math.abs(c.y - d.marqueeStart.y)),
          }
      return
    }
    if (edit && edit.brush === 'move' && d.selectionCandidate) {
      if (d.moved) beginSelectionGhost(d)
      return
    }
    if (edit) { // 场景编辑：双轴拖动查看全战场（游玩模式相机自动跟随）
      const rect = canvasRef.current?.getBoundingClientRect()
      const displayScale = rect ? rect.width / size.w : 1
      setViewX(clampViewX(d.startViewX - dx / (size.cell * displayScale), cell, size.w))
      setViewY(clampViewY(d.startViewY - dy / (size.cell * displayScale), cell, size.h))
    } else if (d.moved && (d.pointerType === 'touch' || d.pointerType === 'pen')) {
      if (panel !== null) return // v1.53：炮塔/模块面板打开期间禁用摇杆（防放置/建造时误动车；d.moved 已置位，松手不会触发点按）
      // 虚拟摇杆（触摸/触控笔）：拖过阈值后按拖动方向持续驱动堡垒；PC 鼠标不进入此分支。
      if (!joyRef.current) joyRef.current = { id: e.pointerId, mode: null, fAngle: null, fDeriv: 0, fTime: 0 }
      if (joyRef.current.id === e.pointerId) {
        const len = Math.hypot(dx, dy)
        let stickForView: number | null = null // v1.48：钳制后的偏角供摇杆头视觉使用
        if (len > 10) { // 10px 死区：过滤手机轻触与手指微抖
          // 摇杆偏角 stick：0=正推（朝船头）=前进（船头领先）；±180°=倒推（朝船尾）=倒退（船尾领先）
          // ——档内摇杆方向 = 堡垒运动方向。模式首推锁定（v1.44 恢复 v1.15 语义；v2.39 扇区重定 ±120°）：
          // 抓住摇杆时首次推出的扇区定档（偏角 ≤120° 前进 / >120° 倒退），锁定期间旋转摇杆不换档
          // （前进档内倒推 = 掉头后船头领先开过去，不会倒车）；松手回未控，下次抓住重新选档。
          // 判定直接看 |偏角|（v1.40 修正：旧式 stick-heading 在船头非 0° 时会误判半球）
          const SECTOR = (Math.PI * 2) / 3 // v2.39：档位扇区边界 120°（前进 ±120° / 倒退正后 ±60°，两扇区在此衔接）
          let stick = Math.atan2(dx / len, -dy / len)
          const walker = fortressDef(gameRef.current).chassis === 'walker'
          if (walker) {
            // 步行机甲不锁前进/倒退档，摇杆完整 360° 都表示屏幕上的期望行走方向。
            joyRef.current.mode = 'fwd'
          } else if (!joyRef.current.mode) {
            joyRef.current.mode = Math.abs(stick) > SECTOR ? 'rev' : 'fwd'
          }
          const mode = joyRef.current.mode
          // 扇区硬门控（v1.48 半球门控演进，v2.39 边界 90°→120°）：锁定档位的对侧扇区「消失」——
          // 前进档仅 ±120° 扇区可达（钳到 ±120° 边界），倒退档仅正后方 ±60° 扇区可达（|偏角|≥120°）；
          // 手指拖入对侧扇区时摇杆吸在边界上（不产生掉头指令），要换向须松开摇杆解除受控后重新抓住定档
          if (!walker) {
            if (mode === 'fwd') {
              if (stick > SECTOR) stick = SECTOR
              else if (stick < -SECTOR) stick = -SECTOR
            } else {
              if (stick >= 0 && stick < SECTOR) stick = SECTOR
              else if (stick < 0 && stick > -SECTOR) stick = -SECTOR
            }
          }
          stickForView = stick // v2.39：视觉用钳制后偏角——防抖只影响指令角，不劫持摇杆头视觉
          // One Euro 滤波：手抖=小幅低速角运动 → 低截止频率强平滑；快速甩动时自动提高截止频率。
          const st = joyRef.current
          const now = e.timeStamp / 1000
          if (st.fAngle === null) {
            st.fAngle = stick
            st.fDeriv = 0
            st.fTime = now
          } else {
            const dtF = Math.max(1e-3, now - st.fTime)
            let diff = stick - st.fAngle
            diff = (((diff + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) - Math.PI
            const aD = 1 / (1 + 1 / (Math.PI * 2 * OE_D_CUTOFF) / dtF)
            st.fDeriv += aD * (diff / dtF - st.fDeriv)
            const cutoff = OE_MIN_CUTOFF + OE_BETA * Math.abs(st.fDeriv)
            st.fAngle += (1 / (1 + 1 / (Math.PI * 2 * cutoff) / dtF)) * diff
            st.fTime = now
          }
          stick = st.fAngle
          const nearFwd = Math.abs(stick)
          const nearRev = Math.PI - Math.abs(stick)
          if (Math.min(nearFwd, nearRev) < FILTER_SNAP) stick = nearRev < nearFwd ? Math.PI : 0
          // 相对方向控制：摇杆方向以堡垒「实时」船头朝向为基准——正推=沿当前船头直行（不转向），
          // 斜推 θ=移动并转向「当前船头 + θ」（v1.39：基准由锁定瞬间锚定改为实时船头——转向中基准随
          // 船体一起转，保持一个偏角 = 持续转向，摇杆回正 = 立即沿当前船头直行，方向盘手感）
          const world = walker ? stick : gameRef.current.fortress.heading + stick
          // 模拟量推进：推出幅度 → 速度上限（满推 48px = 全速）
          const mag = Math.min(1, len / 48)
          gameRef.current.turnDir = 0
          gameRef.current.moveMag = mag
          if (mode === 'rev') {
            // 倒退：沿船头反方向行驶（极速/加速度 × 倒退系数），船尾朝摇杆相对方向（目标船头 = 相对方向 + 180°）
            gameRef.current.reverse = true
            gameRef.current.desiredHeading = world + Math.PI
            gameRef.current.moveDir.x = 0
            gameRef.current.moveDir.y = 0
          } else {
            // 前进：相对方向 = 移动方向 + 堡垒目标朝向（速率追踪，转弯半径>0 时弧线转向）
            gameRef.current.reverse = false
            gameRef.current.moveDir.x = Math.sin(world)
            gameRef.current.moveDir.y = -Math.cos(world)
            gameRef.current.desiredHeading = world
          }
        } else {
          // 死区内：保持已锁定的模式（松手才解除），只清空推进
          gameRef.current.moveDir.x = 0
          gameRef.current.moveDir.y = 0
          gameRef.current.moveMag = 1
          gameRef.current.desiredHeading = null
          gameRef.current.reverse = joyRef.current.mode === 'rev'
        }
        // 摇杆头视觉位置 = 钳制后偏角 × 原始幅度（v1.48：手指在对侧半球时摇杆头吸在 ±90° 边界上）
        const effStick = stickForView ?? Math.atan2(dx / len, -dy / len)
        const ddx = Math.sin(effStick) * len
        const ddy = -Math.cos(effStick) * len
        const cl = len > 34 ? 34 / len : 1 // 手机优先：稍大视觉行程，便于精细控制
        const rect = canvasRef.current?.getBoundingClientRect()
        const displayScale = rect ? rect.width / Math.max(1, size.w) : 1
        setJoy({ x: (d.startX - (rect?.left ?? 0)) / displayScale, y: (d.startY - (rect?.top ?? 0)) / displayScale, dx: ddx * cl / displayScale, dy: ddy * cl / displayScale, rev: joyRef.current.mode === 'rev' })
      }
    }
  }
  const onPointerUp = (e: React.PointerEvent) => {
    ptrsRef.current.delete(e.pointerId)
    if (pinchRef.current && ptrsRef.current.size < 2) pinchRef.current = null
    const d = dragRef.current
    if (d?.holdTimer) window.clearTimeout(d.holdTimer)
    dragRef.current = null
    releaseJoystick(e.pointerId)
    if (d?.fortressPlacement) return
    if (d?.marqueeStart && d.moved) {
      const c = toCell(e)
      const tileLayerSelection = editorLayer === 'base' || editorLayer === 'overlay'
      const rect = tileLayerSelection
        ? gridCellSelectionRect(d.marqueeStart.x, d.marqueeStart.y, c.x, c.y, editRef.current?.draft.cols ?? LEVEL.cols, editRef.current?.draft.rows ?? LEVEL.rows)
        : {
            x: Math.min(d.marqueeStart.x, c.x),
            y: Math.min(d.marqueeStart.y, c.y),
            w: Math.max(0.01, Math.abs(c.x - d.marqueeStart.x)),
            h: Math.max(0.01, Math.abs(c.y - d.marqueeStart.y)),
          }
      editorMarqueeRef.current = null
      const current = editRef.current
      if (current) {
        if (tileLayerSelection) {
          setEditorTileSelection({ layer: editorLayer, ...rect })
          const tiles = editorLayer === 'base' ? current.draft.baseTiles : current.draft.overlayTiles
          setEditorSelectedTile(rect.w === 1 && rect.h === 1 && tiles.some(tile => tile.x === rect.x && tile.y === rect.y)
            ? { layer: editorLayer, x: rect.x, y: rect.y }
            : null)
          setEditorSelectedInitialUnitId(null)
          setEditorFocusedObjectEvent(null)
          setEdit({ ...current, picked: null, pickedGroup: null, selected: null, selectedGroup: [] })
        } else {
          const selectedGroup = marqueeSelection(current.draft, rect)
          setEditorSelectedInitialUnitId(null)
          setEditorFocusedObjectEvent(null)
          setEdit({ ...current, picked: null, pickedGroup: null, selected: null, selectedGroup })
        }
      }
      return
    }
    editorMarqueeRef.current = null
    if (d?.ghostStarted) {
      const c = toCell(e)
      const current = editRef.current
      if (current?.picked) {
        const free = editorLayer === 'object' && !editorSnap
        const gx = free ? Math.round(c.x * 10) / 10 : Math.floor(c.x)
        const gy = free ? Math.round(c.y * 10) / 10 : Math.floor(c.y)
        if (brushValidAt(current.draft, 'move', current.picked, gx, gy)) moveClick(gx, gy)
        else cancelMove()
      }
      return
    }
    if (d && !d.moved && !d.painting && !d.panOnly) {
      const c = toCell(e)
      if (edit) {
        const selecting = edit.brush === 'move' && !edit.picked
        const free = !selecting && editorLayer === 'object' && !editorSnap && edit.brush !== 'trigger' && edit.brush !== 'start' && edit.brush !== 'finish'
        paintAt(free ? Math.round(c.x * 10) / 10 : Math.floor(c.x), free ? Math.round(c.y * 10) / 10 : Math.floor(c.y))
      }
      else doClickCell(c.x, c.y)
    }
  }
  const onPointerCancel = (e: React.PointerEvent) => {
    ptrsRef.current.delete(e.pointerId)
    if (pinchRef.current && ptrsRef.current.size < 2) pinchRef.current = null
    if (dragRef.current?.holdTimer) window.clearTimeout(dragRef.current.holdTimer)
    dragRef.current = null
    editorMarqueeRef.current = null
    releaseJoystick(e.pointerId)
  }

  const onLostPointerCapture = (e: React.PointerEvent) => {
    if (!ptrsRef.current.has(e.pointerId) && joyRef.current?.id !== e.pointerId) return
    ptrsRef.current.delete(e.pointerId)
    if (dragRef.current?.holdTimer) window.clearTimeout(dragRef.current.holdTimer)
    dragRef.current = null
    editorMarqueeRef.current = null
    if (ptrsRef.current.size < 2) pinchRef.current = null
    releaseJoystick(e.pointerId)
  }

  const reset = () => {
    const nextGame = initialState()
    setSettlementNewMedals([])
    setSettlementNewReward(0)
    setSettlementNewUnlocks([])
    camRef.current = playerCenteredCamera(nextGame, size.cell, size.w, size.h)
    setGame(nextGame)
    setMode({ kind: 'none' })
    setSelTurret(null)
    setSelectedEnemyUnitId(null)
    setViewX(0)
    setViewY(LEVEL.rows - VIEW_ROWS)
    setCombatPreparationOpen(false)
    setCombatPreparationUnitId(null)
  }

  const applyCurrentCombatLoadout = (preset: VehicleLoadoutPreset, options?: { keepOpen?: boolean }) => {
    const current = gameRef.current
    const next = combatPreparationUnitId === null
      ? applyCombatLoadout(current, preset, undefined, true)
      : applyPlayerUnitCombatLoadout(current, combatPreparationUnitId, preset)
    if (next === current) return
    releaseAllMovement()
    gameRef.current = next
    setGame(next)
    if (!options?.keepOpen) {
      setCombatPreparationOpen(false)
      setCombatPreparationUnitId(null)
    }
  }

  const openMissionBriefing = (levelId = LEVEL_LIBRARY.activeId) => {
    const nextId = LEVEL_LIBRARY.levels.some(entry => entry.id === levelId) ? levelId : LEVEL_LIBRARY.activeId
    const entry = LEVEL_LIBRARY.levels.find(item => item.id === nextId)
    const progress = loadLevelProgress()
    const available = availableMissionLoadouts(entry, progress)
    const persistedId = getSelectedVehicleLoadoutId()
    const selected = available.find(preset => preset.id === persistedId) ?? available[0]
    setMissionProgress(progress)
    setMissionLevelId(nextId)
    setMissionLoadoutId(selected?.id ?? '')
    setMissionFortressId(selected?.fortressDefId ?? '')
    releaseAllMovement()
    setMissionOpen(true)
  }

  const startSelectedMission = () => {
    if (!isLevelUnlocked(LEVEL_LIBRARY, missionLevelId, missionProgress)) return
    const entry = LEVEL_LIBRARY.levels.find(item => item.id === missionLevelId)
    const vehicles = playableVehicleDefs()
    const allowed = deployableFortressIdsOf(entry, vehicles.map(def => def.id))
    const selectedLoadout = availableMissionLoadouts(entry, missionProgress).find(preset => preset.id === missionLoadoutId)
    const selectedFortress = vehicles.find(def => def.id === missionFortressId)
    if (!selectedLoadout || selectedLoadout.fortressDefId !== missionFortressId || !selectedFortress || !allowed.includes(missionFortressId) || !isEquipmentUnlocked(missionProgress, { kind: 'fortress', id: missionFortressId }, LEVEL_LIBRARY)) return
    if (!activateLibraryLevel(missionLevelId)) return
    setSelectedVehicleLoadoutId(missionLoadoutId)
    setSelectedFortressId(missionFortressId)
    completedRunRef.current = false
    reset()
    setMissionOpen(false)
  }

  const selectedTurret = selTurret != null ? game.turrets.find(t => t.id === selTurret) : undefined
  const combatPreparationAlly = combatPreparationUnitId === null ? null : game.allies.find(ally => ally.id === combatPreparationUnitId) ?? null
  const combatPreparationUnit = combatPreparationAlly ? unitDefById(combatPreparationAlly.unitDefId ?? '') : undefined
  const combatPreparationVehicle = combatPreparationUnit ? unitVehiclePlatform(combatPreparationUnit) : undefined
  const activeCombatPreset = combatPreparationUnitId === null ? combatLoadoutOf(game) : playerUnitCombatLoadout(game, combatPreparationUnitId)
  const controllerModuleBonuses = moduleBonuses(game)
  const resourceIndicatorCamera = combatPreparationOpen && game.objective.type === 'fortressDefense'
    ? {
        x: clampBattlePreparationView(viewX, LEVEL.cols, size.cell, size.w),
        y: clampBattlePreparationView(viewY, LEVEL.rows, size.cell, size.h),
      }
    : playerCenteredCamera(game, size.cell, size.w, size.h)
  const battlePreparationHardpoints = (() => {
    if (!combatPreparationOpen) return []
    const toScreen = (x: number, y: number) => ({
      x: (x - resourceIndicatorCamera.x) * size.cell / Math.max(1, size.w) * canvasFit.w,
      y: (y - resourceIndicatorCamera.y) * size.cell / Math.max(1, size.h) * canvasFit.h,
    })
    const markers: Array<{
      targetId: 'main' | number
      targetName: string
      hardpointId: string
      x: number
      y: number
      size: import('@/game/config').MountSize
      types?: TurretDef['type'][]
      locked: boolean
      installedTurretId?: string
    }> = []
    const mainPlatform = fortressDef(game)
    for (const hardpoint of mainPlatform.hardpoints) {
      const world = hardpointWorldPos(game, hardpoint)
      const screen = toScreen(world.x, world.y)
      markers.push({
        targetId: 'main', targetName: mainPlatform.name, hardpointId: hardpoint.id,
        x: screen.x, y: screen.y, size: hardpoint.size, types: hardpoint.types,
        locked: hardpoint.lockedTurret === true,
        installedTurretId: game.turrets.find(turret => turret.hardpointId === hardpoint.id)?.defId,
      })
    }
    for (const ally of game.allies) {
      if (ally.hp <= 0 || ally.faction !== 'player' || !ally.vehicle || !ally.unitDefId) continue
      const unit = unitDefById(ally.unitDefId)
      const platform = unit ? unitVehiclePlatform(unit) : null
      if (!unit || !platform) continue
      const center = fortressLocalCenter(platform)
      const heading = ally.vehicle.heading
      const c = Math.cos(heading), sn = Math.sin(heading)
      for (const sourceHardpoint of platform.hardpoints) {
        const hardpoint = ally.flipX ? { ...sourceHardpoint, x: platform.w - sourceHardpoint.x } : sourceHardpoint
        const ox = hardpoint.x - center.x, oy = hardpoint.y - center.y
        const screen = toScreen(ally.x + ox * c - oy * sn, ally.y + ox * sn + oy * c)
        markers.push({
          targetId: ally.id, targetName: unit.name, hardpointId: hardpoint.id,
          x: screen.x, y: screen.y, size: hardpoint.size, types: hardpoint.types,
          locked: sourceHardpoint.lockedTurret === true,
          installedTurretId: ally.vehicle.turrets?.find(turret => turret.hardpointId === sourceHardpoint.id)?.defId,
        })
      }
    }
    return markers
  })()
  const battlefieldResourceIndicators = [
    playerUnitResourceDetails(game, null),
    ...game.allies.filter(ally => ally.faction === 'player' && ally.hp > 0).map(ally => playerUnitResourceDetails(game, ally.id)),
  ].filter((detail): detail is NonNullable<typeof detail> => !!detail)
    .filter(detail => detail.missingAmmo || detail.missingEnergy || detail.supplyAmmo || detail.supplyEnergy || detail.supplyRepair)
  const ammoEnergySupplyInProgress = battlefieldResourceIndicators.some(detail => detail.supplyAmmo || detail.supplyEnergy)
  const openedResourceDetails = resourceDetailsTarget === null
    ? null
    : playerUnitResourceDetails(game, resourceDetailsTarget === 'main' ? null : resourceDetailsTarget)
  const settlementEntry = LEVEL_LIBRARY.levels.find(entry => entry.id === LEVEL_LIBRARY.activeId) ?? LEVEL_LIBRARY.levels[0]
  const settlementEntryIndex = LEVEL_LIBRARY.levels.findIndex(entry => entry.id === settlementEntry.id)
  const settlementNext = settlementEntry.nextId
    ? LEVEL_LIBRARY.levels.find(entry => entry.id === settlementEntry.nextId)
    : LEVEL_LIBRARY.levels[settlementEntryIndex + 1]
  const settlementWon = game.phase === 'won'
  const settlementObjectiveResults = settlementObjectiveStatuses(game)
  const editorPointerCoordinate = (() => {
    if (!edit || !hover) return null
    const freePosition = editorLayer === 'object' && !editorSnap
      && edit.brush !== 'trigger' && edit.brush !== 'route' && edit.brush !== 'start' && edit.brush !== 'finish'
    const x = freePosition ? Math.round(hover.x * 10) / 10 : Math.floor(hover.x)
    const y = freePosition ? Math.round(hover.y * 10) / 10 : Math.floor(hover.y)
    if (x < 0 || y < 0 || x >= edit.draft.cols || y >= edit.draft.rows) return null
    return { x, y, freePosition }
  })()

  // v1.53 面板开关：炮塔/模块互斥；再点一次当前按钮关闭并恢复摇杆；模块面板进出内部空间
  const togglePanel = (p: 'turret' | 'module') => {
    releaseJoystick()
    if (panel === p) {
      setPanel(null); setInterior(false); setInteriorSel(null); setInteriorDemo(false); setMode({ kind: 'none' })
    } else {
      setPanel(p)
      if (p === 'module') { setInterior(true); setMode({ kind: 'none' }); setSelTurret(null) }
      else { setInterior(false); setInteriorSel(null); setInteriorDemo(false) }
    }
  }

  return (
    <div className={`relative w-full h-full flex flex-col bg-[#8A8B6D] overflow-hidden select-none ${!edit && !missionOpen ? 'mobile-combat-safe' : ''}`}>
      {missionOpen && (
        <Suspense fallback={<DeferredOverlay label="正在加载关卡任务…" />}>
          <MissionBriefing
            library={LEVEL_LIBRARY}
            progress={missionProgress}
            selectedLevelId={missionLevelId}
            selectedLoadoutId={missionLoadoutId}
            fortresses={playableVehicleDefs()}
            onSelectLevel={setMissionLevelId}
            onSelectLoadout={(presetId, fortressDefId) => { setMissionLoadoutId(presetId); setMissionFortressId(fortressDefId) }}
            onProgressChange={setMissionProgress}
            onBack={() => setMissionOpen(false)}
            onStart={startSelectedMission}
          />
        </Suspense>
      )}

      {/* 虚拟摇杆（触屏移动堡垒）：按住战场拖动出现，松手消失 */}
      {joy && (
        <div aria-label={joy.rev ? '触摸摇杆：倒车' : '触摸摇杆：前进'} className="absolute pointer-events-none z-40" style={{ left: joy.x - 56, top: joy.y - 56, width: 112, height: 112 }}>
          <div className="absolute inset-0 rounded-full border-2 border-black/50 bg-black/20" />
          <div className={`absolute rounded-full border-2 border-black/70 ${joy.rev ? 'bg-[#B3392E]/85' : 'bg-[#E8E4D8]/85'}`}
            style={{ width: 40, height: 40, left: 36 + joy.dx, top: 36 + joy.dy }} />
        </div>
      )}

      {/* 顶部快捷按钮；关卡进度与敌人数量不再占用独立信息窗。 */}
      {!edit && (
      <div className="combat-quick-actions absolute z-30 flex items-stretch justify-end gap-1">
        <button
          type="button"
          aria-label={combatInfoCollapsed ? '展开战车状态' : '收起战车状态'}
          aria-pressed={!combatInfoCollapsed}
          title={combatInfoCollapsed ? '展开战斗信息' : '收起战斗信息'}
          onClick={() => setCombatInfoCollapsed(value => !value)}
          className={`combat-info-toggle comic-btn combat-touch-target px-2 items-center justify-center shrink-0 font-comic text-[10px] font-black ${!combatInfoCollapsed ? 'bg-[#B3392E] text-[#EFEBD8]' : ''}`}
        >状态</button>
        <button
          type="button"
          title="打开关卡任务"
          onClick={() => openMissionBriefing()}
          className="comic-btn combat-touch-target px-2 flex items-center justify-center shrink-0 font-comic text-[10px] font-black"
        >
          任务
        </button>
        <button
          type="button"
          title="事件监视器"
          aria-pressed={showEventMonitor}
          onPointerEnter={() => { void loadEventMonitor() }}
          onFocus={() => { void loadEventMonitor() }}
          onClick={() => setShowEventMonitor(value => !value)}
          className={`comic-btn combat-touch-target px-2 flex items-center justify-center shrink-0 font-comic text-[10px] font-black ${showEventMonitor ? 'bg-[#B3392E] text-[#EFEBD8]' : ''}`}
        >事件</button>
        {performanceOptions.enabled ? <button
          type="button"
          aria-label={performanceMonitorCollapsed ? '展开性能监控' : '收起性能监控'}
          aria-pressed={!performanceMonitorCollapsed}
          title={performanceMonitorCollapsed ? '展开性能监控' : '收起性能监控'}
          onClick={() => setPerformanceMonitorCollapsed(value => !value)}
          className={`comic-btn combat-touch-target px-2 flex items-center justify-center shrink-0 font-comic text-[10px] font-black ${!performanceMonitorCollapsed ? 'bg-[#B3392E] text-[#EFEBD8]' : ''}`}
        >性能</button> : null}
        <button
          type="button"
          title="DEBUG：编辑炮塔参数"
          onPointerEnter={() => { void loadDebugPanel() }}
          onFocus={() => { void loadDebugPanel() }}
          onClick={toggleDebug}
          className={`comic-btn combat-touch-target px-1.5 flex items-center justify-center shrink-0 ${showDebug ? 'bg-[#B3392E] text-[#EFEBD8]' : ''}`}
        >
          <Bug className="w-3.5 h-3.5" />
        </button>
      </div>
      )}

      {!edit && game.notices.length > 0 && <div className="absolute z-30 top-12 left-1/2 -translate-x-1/2 w-[min(80%,420px)] space-y-1 pointer-events-none">{game.notices.slice(-2).map(n => <div key={n.id} className="comic-panel bg-[#1A1A18]/90 text-[#EFEBD8] px-3 py-1 text-center font-comic text-xs">{n.text}</div>)}</div>}
      {!edit && game.cinematicText ? <div aria-live="polite" className={`pointer-events-none absolute left-1/2 z-40 w-[min(82%,620px)] -translate-x-1/2 ${game.cinematicText.position === 'top' ? 'top-[18%]' : game.cinematicText.position === 'bottom' ? 'bottom-[20%]' : 'top-1/2 -translate-y-1/2'}`} style={{ opacity: Math.min(1, game.cinematicText.left / 0.25) }}><div className="border-y-2 border-black bg-[#1A1A18]/85 px-5 py-3 text-center font-comic text-sm font-black text-[#EFEBD8] shadow-[0_3px_0_rgba(0,0,0,0.45)]">{game.cinematicText.text}</div></div> : null}
      {!edit && game.cinematicDialogue ? <div aria-live="polite" className="pointer-events-none absolute bottom-[76px] left-1/2 z-40 w-[min(88%,680px)] -translate-x-1/2" style={{ opacity: Math.min(1, game.cinematicDialogue.left / 0.25) }}><div className="comic-panel bg-[#D2CCA9]/95 px-4 py-2"><div className="mb-1 flex items-center gap-2"><span className="bg-[#B3392E] px-2 py-0.5 font-comic text-[10px] font-black text-[#EFEBD8]">{game.cinematicDialogue.speaker || '通讯'}</span><span className="h-px flex-1 bg-black/35" /></div><div className="whitespace-pre-wrap text-[11px] font-bold leading-relaxed">{game.cinematicDialogue.text}</div></div></div> : null}
      {!edit && game.eventChoice ? <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/45 p-4"><section role="dialog" aria-modal="true" aria-label="事件选择" className="comic-panel w-[min(420px,88vw)] bg-[#D2CCA9] p-3"><h2 className="mb-2 border-b-2 border-black pb-1 font-comic text-[13px] font-black">{game.eventChoice.prompt || '请选择'}</h2><div className="grid gap-1">{game.eventChoice.options.map((option, index) => <button key={index} type="button" className="comic-btn combat-touch-target px-3 py-1.5 text-left text-[10px] font-black" onClick={() => setGame(current => resolveEventChoice(current, game.eventChoice!.id, index))}>{option}</button>)}</div></section></div> : null}
      {!edit && game.eventAssembly ? <div className="absolute right-2 top-12 z-50 flex items-center gap-1 comic-panel bg-[#D2CCA9]/95 px-2 py-1"><span className="text-[9px] font-black">事件装配</span><button type="button" className={`comic-btn combat-touch-target px-2 py-0.5 text-[9px] ${panel === 'turret' ? 'bg-[#B3392E] text-[#EFEBD8]' : ''}`} onClick={() => togglePanel('turret')}>炮塔</button><button type="button" className={`comic-btn combat-touch-target px-2 py-0.5 text-[9px] ${panel === 'module' ? 'bg-[#B3392E] text-[#EFEBD8]' : ''}`} onClick={() => togglePanel('module')}>模组</button><button type="button" className="comic-btn combat-touch-target px-2 py-0.5 text-[9px] bg-[#3E7D46] text-[#EFEBD8]" onClick={() => { const id = game.eventAssembly!.id; releaseJoystick(); setPanel(null); setInterior(false); setInteriorSel(null); setInteriorDemo(false); setMode({ kind: 'none' }); setGame(current => completeEventAssembly(current, id)) }}>完成装配</button></div> : null}
      {!edit && showEventMonitor ? <Suspense fallback={null}><EventMonitor game={game} /></Suspense> : null}
      {!edit ? (() => { const boss = game.enemies.find(enemy => enemy.bossName && playerTeamCanSeePoint(game, enemy.x, enemy.y)); return boss ? <div className="absolute z-20 top-12 left-1/2 -translate-x-1/2 w-[min(70%,360px)] comic-panel px-2 py-1"><div className="flex justify-between text-[9px] font-black"><span>{boss.bossName}</span><span>{Math.ceil(boss.hp)}/{boss.maxHp}</span></div><div className="h-2 border border-black bg-black/30"><div className="h-full" style={{ width: `${Math.max(0, boss.hp / boss.maxHp * 100)}%`, backgroundColor: boss.bossBarColor ?? '#B3392E' }} /></div></div> : null })() : null}

      {/* 中部横版布局：编辑态为关卡库 / 画布 / 属性检查器三栏；竖屏回退为画布 + 双抽屉。 */}
      {edit && editorValidationIssues.length > 0 ? <section aria-label="关卡校验结果" className="absolute left-1/2 top-[112px] z-50 w-[min(560px,82vw)] -translate-x-1/2 comic-panel bg-[#D2CCA9] p-2 text-[9px]"><div className="flex items-center border-b border-black/35 pb-1"><strong className="font-comic text-[11px]">保存检查</strong><span className="ml-auto font-bold">错误 {editorValidationIssues.filter(issue => issue.severity === 'error').length} · 警告 {editorValidationIssues.filter(issue => issue.severity === 'warning').length}</span><button type="button" className="comic-btn ml-2 px-1 py-0" onClick={() => setEditorValidationIssues([])}>×</button></div><div className="mt-1 max-h-40 overflow-auto space-y-0.5">{editorValidationIssues.map((issue, index) => <div key={index} className={`flex items-center gap-2 border-b border-black/10 pb-0.5 last:border-b-0 ${issue.severity === 'error' ? 'font-bold text-[#9E2F28]' : 'font-bold text-[#8A5B12]'}`}><span className="min-w-0 flex-1">{issue.severity === 'error' ? '错误' : '警告'}：{issue.message}</span><button type="button" aria-label={`定位：${issue.message}`} className="comic-btn shrink-0 px-2 py-0 text-[8px] text-[#1A1A18]" onClick={() => locateEditorValidationIssue(issue)}>定位</button></div>)}</div></section> : null}
      <div className={`relative z-10 flex-1 min-h-0 flex flex-row portrait:flex-wrap ${edit ? 'level-editor-flat mx-0 mt-0 mb-0 gap-0 pt-[108px]' : 'm-0 gap-0'}`}>
      {edit && <div className="absolute left-0 right-0 top-[58px] min-h-[50px] comic-panel px-2 py-1 flex flex-wrap content-center items-center gap-1 z-30 [&>button]:grow [&>button]:px-3">
        <span className="font-comic text-[13px] font-black mr-1">工具栏</span>
        <button type="button" className="comic-btn px-2 py-0.5 text-[9px] font-black" onClick={saveEditorDraft}>保存</button>
        <button type="button" aria-label="撤销" title="撤销（Ctrl+Z）" disabled={editUndo.length === 0} className="comic-btn px-2 py-0.5 text-[9px] disabled:opacity-35" onClick={undoEditorChange}>撤销</button>
        <button type="button" aria-label="重做" title="重做（Ctrl+Y）" disabled={editRedo.length === 0} className="comic-btn px-2 py-0.5 text-[9px] disabled:opacity-35" onClick={redoEditorChange}>重做</button>
        <span className="h-5 border-l-2 border-black/35 mx-0.5" />
        {([['base', '底图层'], ['overlay', '装饰层'], ['terrain', '地形层'], ['object', '对象层']] as const).map(([layer, label]) => <button key={layer} type="button" aria-pressed={editorLayer === layer} className={`comic-btn px-2 py-0.5 text-[9px] ${editorLayer === layer ? 'bg-[#B3392E] text-[#EFEBD8] translate-x-px translate-y-px shadow-[1px_1px_0_#1A1A18]' : ''}`} onClick={() => setEditorActiveLayer(layer)}>{label}</button>)}
        <span className="h-5 border-l-2 border-black/35 mx-0.5" />
        <button type="button" aria-pressed={edit.brush === (editorLayer === 'base' ? 'baseTile' : 'overlayTile')} disabled={editorLayer !== 'base' && editorLayer !== 'overlay'} className={`comic-btn px-2 py-0.5 text-[9px] disabled:opacity-35 disabled:cursor-not-allowed ${edit.brush === (editorLayer === 'base' ? 'baseTile' : 'overlayTile') ? 'bg-[#B3392E] text-[#EFEBD8] translate-x-px translate-y-px shadow-[1px_1px_0_#1A1A18]' : ''}`} onClick={() => activateEditorBrush(editorLayer === 'base' ? 'baseTile' : 'overlayTile')}>画笔</button>
        <button type="button" aria-pressed={edit.brush === 'eraser'} disabled={editorLayer !== 'base' && editorLayer !== 'overlay' && editorLayer !== 'terrain' && editorLayer !== 'object'} title={editorTileSelection?.layer === editorLayer ? '擦除当前地格选区' : '切换为擦除工具'} className={`comic-btn px-2 py-0.5 text-[9px] disabled:opacity-35 disabled:cursor-not-allowed ${edit.brush === 'eraser' ? 'bg-[#B3392E] text-[#EFEBD8] translate-x-px translate-y-px shadow-[1px_1px_0_#1A1A18]' : ''}`} onClick={() => { if (!applyEditorTileSelection('erase')) activateEditorBrush('eraser') }}>擦除</button>
        <button type="button" aria-pressed={edit.brush === 'fill'} disabled={editorLayer !== 'base' && editorLayer !== 'overlay'} title={editorTileSelection?.layer === editorLayer ? '用当前图块填满地格选区' : '切换为连通区域填充工具'} className={`comic-btn px-2 py-0.5 text-[9px] disabled:opacity-35 disabled:cursor-not-allowed ${edit.brush === 'fill' ? 'bg-[#B3392E] text-[#EFEBD8] translate-x-px translate-y-px shadow-[1px_1px_0_#1A1A18]' : ''}`} onClick={() => { if (!applyEditorTileSelection('fill')) activateEditorBrush('fill') }}>填充</button>
        <button type="button" disabled={!editorTransformEnabled} className="comic-btn px-2 py-0.5 text-[9px] disabled:opacity-35 disabled:cursor-not-allowed" onClick={() => transformEditorSelection('flip')}>翻转</button>
        <button type="button" disabled={!editorTransformEnabled} className="comic-btn px-2 py-0.5 text-[9px] disabled:opacity-35 disabled:cursor-not-allowed" onClick={() => transformEditorSelection('rotate')}>旋转</button>
        <span className="h-5 border-l-2 border-black/35 mx-0.5" />
        <button type="button" aria-pressed={(editorLayer === 'terrain' && edit.brush === 'puddle') || (editorLayer === 'object' && ['barrel', 'ruins', 'rock', 'unit', 'route'].includes(edit.brush))} disabled={editorLayer !== 'terrain' && editorLayer !== 'object'} className={`comic-btn px-2 py-0.5 text-[9px] disabled:opacity-35 disabled:cursor-not-allowed ${(editorLayer === 'terrain' && edit.brush === 'puddle') || (editorLayer === 'object' && ['barrel', 'ruins', 'rock', 'unit', 'route'].includes(edit.brush)) ? 'bg-[#B3392E] text-[#EFEBD8] translate-x-px translate-y-px shadow-[1px_1px_0_#1A1A18]' : ''}`} onClick={() => activateEditorBrush(editorLayer === 'terrain' ? 'puddle' : 'barrel')}>放置</button>
        <button type="button" aria-pressed={edit.brush === 'move'} disabled={editorLayer !== 'base' && editorLayer !== 'overlay' && editorLayer !== 'terrain' && editorLayer !== 'object'} title={editorLayer === 'base' || editorLayer === 'overlay' ? '拖拽框选当前层地格' : '选择场景实例'} className={`comic-btn px-2 py-0.5 text-[9px] disabled:opacity-35 disabled:cursor-not-allowed ${edit.brush === 'move' ? 'bg-[#B3392E] text-[#EFEBD8] translate-x-px translate-y-px shadow-[1px_1px_0_#1A1A18]' : ''}`} onClick={() => activateEditorBrush('move')}>选择</button>
        <button type="button" disabled={(editorLayer !== 'terrain' && editorLayer !== 'object') || editorInspectorTab === 'events' || editorInspectorTab === 'mission'} className="comic-btn px-2 py-0.5 text-[9px] disabled:opacity-35 disabled:cursor-not-allowed" onClick={copyEditorSelection}>复制</button>
        <button type="button" aria-pressed={edit.picked?.ghostOrigin === 'paste' || edit.pickedGroup?.ghostOrigin === 'paste'} disabled={(editorLayer !== 'terrain' && editorLayer !== 'object') || editorInspectorTab === 'events' || editorInspectorTab === 'mission'} className={`comic-btn px-2 py-0.5 text-[9px] disabled:opacity-35 disabled:cursor-not-allowed ${edit.picked?.ghostOrigin === 'paste' || edit.pickedGroup?.ghostOrigin === 'paste' ? 'bg-[#B3392E] text-[#EFEBD8] translate-x-px translate-y-px shadow-[1px_1px_0_#1A1A18]' : ''}`} onClick={() => pasteEditorSelection()}>黏贴</button>
        <button type="button" aria-pressed={editorSnap} disabled={editorLayer !== 'terrain' && editorLayer !== 'object'} className={`comic-btn px-2 py-0.5 text-[9px] disabled:opacity-35 disabled:cursor-not-allowed ${editorSnap ? 'bg-[#B3392E] text-[#EFEBD8] translate-x-px translate-y-px shadow-[1px_1px_0_#1A1A18]' : ''}`} onClick={() => setEditorSnap(value => !value)}>对齐</button>
        <button type="button" aria-pressed={edit.brush === 'start'} disabled={editorLayer !== 'object'} className={`comic-btn px-2 py-0.5 text-[9px] disabled:opacity-35 disabled:cursor-not-allowed ${edit.brush === 'start' ? 'bg-[#B3392E] text-[#EFEBD8] translate-x-px translate-y-px shadow-[1px_1px_0_#1A1A18]' : ''}`} onClick={() => activateEditorBrush('start')}>起点</button>
        <button type="button" aria-pressed={edit.brush === 'trigger'} disabled={editorLayer !== 'object'} className={`comic-btn px-2 py-0.5 text-[9px] disabled:opacity-35 disabled:cursor-not-allowed ${edit.brush === 'trigger' ? 'bg-[#B3392E] text-[#EFEBD8] translate-x-px translate-y-px shadow-[1px_1px_0_#1A1A18]' : ''}`} onClick={() => { setEditorInspectorTab('events'); activateEditorBrush('trigger') }}>事件</button>
        <span className="h-5 border-l-2 border-black/35 mx-0.5" />
        <button type="button" aria-pressed={editorShowGrid} className={`comic-btn px-2 py-0.5 text-[9px] ${editorShowGrid ? 'bg-[#B3392E] text-[#EFEBD8] translate-x-px translate-y-px shadow-[1px_1px_0_#1A1A18]' : ''}`} onClick={() => setEditorShowGrid(value => !value)}>{editorShowGrid ? '隐藏网格' : '显示网格'}</button>
        <button type="button" aria-pressed={editorShowHeight} title="切换全场物体高度着色" className={`comic-btn px-2 py-0.5 text-[9px] ${editorShowHeight ? 'bg-[#B3392E] text-[#EFEBD8] translate-x-px translate-y-px shadow-[1px_1px_0_#1A1A18]' : ''}`} onClick={() => setEditorShowHeight(value => !value)}>高度</button>
      </div>}
      <div className={`flex-1 min-w-0 min-h-0 flex flex-col ${edit ? 'order-2 portrait:order-1 portrait:w-full portrait:basis-full portrait:min-h-[48%]' : ''}`}>
      {/* 战场画布（镜头跟随堡垒；滚轮/双指缩放） */}
      <div ref={containerRef} className="relative flex-1 min-h-0 flex items-center justify-center overflow-hidden bg-black">
        <div className="relative shrink-0" style={{ width: canvasLogicalWidth * canvasDisplayScale, height: canvasLogicalHeight * canvasDisplayScale }}>
          <div
            className="absolute left-0 top-0 overflow-hidden"
            data-display-mode={edit ? 'adaptive-editor' : activeDisplayConfig.resolutionMode}
            data-reference-resolution={edit || activeDisplayConfig.resolutionMode === 'adaptive' ? undefined : activeDisplayConfig.referenceResolution}
            style={{ width: canvasLogicalWidth, height: canvasLogicalHeight, transform: `scale(${canvasDisplayScale})`, transformOrigin: 'top left' }}
          >
        {!edit && !missionOpen && nextWaveCountdown !== null ? <div
          role="timer"
          aria-label={`下波进攻倒计时 ${formatWaveCountdownTime(nextWaveCountdown)}`}
          className="combat-wave-countdown pointer-events-none absolute z-30 font-comic font-black"
        ><span>下波倒计时</span><time dateTime={`PT${Math.max(0, Math.ceil(nextWaveCountdown))}S`}>{formatWaveCountdownTime(nextWaveCountdown)}</time></div> : null}
        {combatPreparationOpen && !missionOpen && activeCombatPreset ? <Suspense fallback={<DeferredOverlay label="正在加载战车整备…" />}>
          <PreparationScreen
            key={combatPreparationUnitId === null ? 'main-combat-loadout' : `unit-combat-loadout-${combatPreparationUnitId}`}
            library={LEVEL_LIBRARY}
            progress={missionProgress}
            selectedPresetId={activeCombatPreset.id}
            lockedFortressDefId={activeCombatPreset.fortressDefId}
            combatPreset={activeCombatPreset}
            combatVehicleDef={combatPreparationVehicle ?? undefined}
            turretOnly={combatPreparationUnitId !== null}
            combatResourceBudget={game.gold}
            combatResourceCost={preset => combatPreparationUnitId === null
              ? combatLoadoutChangeCost(game, preset)
              : playerUnitLoadoutChangeCost(game, combatPreparationUnitId, preset)}
            battleHardpoints={battlePreparationHardpoints}
            battleTargetId={combatPreparationUnitId ?? 'main'}
            battleOverlay
            onApplyCombat={applyCurrentCombatLoadout}
            onSelectBattleTarget={targetId => setCombatPreparationUnitId(targetId === 'main' ? null : targetId)}
            onSelectPreset={() => {}}
            onClose={() => { releaseAllMovement(); setCombatPreparationOpen(false); setCombatPreparationUnitId(null) }}
          />
        </Suspense> : null}
        {!edit && !missionOpen ? <section aria-label="玩家战车状态" className={`combat-info-stack combat-formal-vitals pointer-events-none absolute z-20 ${combatInfoCollapsed ? 'is-collapsed' : ''}`}>
          <div className="combat-hud-vital-row">
            <CombatHudSign asset="sigh_hp" label="结构值标志" fallback="HP" />
            <CombatHudHorizontalMeter
              label="结构值"
              value={game.fortress.hp}
              max={game.fortress.maxHp}
              backgroundAsset="hp_bg"
              rateAsset="hp_rate"
              fallbackColor="#72C94B"
            />
          </div>
          <div className="combat-hud-vital-row is-compact">
            <CombatHudSign asset="sign_heat" label="热量标志" fallback="热" />
            <CombatHudHorizontalMeter
              label="热量"
              value={game.fortress.heat}
              max={fortressDef(game).heatCap}
              backgroundAsset="heat_bg"
              rateAsset="heat_rate"
              fallbackColor="#D54818"
              compact
            />
          </div>
          <div className="combat-hud-readouts">
            <span className="combat-hud-readout">
              <CombatHudSign asset="sign_speed" label="速度标志" fallback="速" />
              <span>{Math.round(Math.hypot(game.fortress.vx, game.fortress.vy) * M_PER_CELL)}m/s</span>
            </span>
            <span className="combat-hud-readout is-resource">
              <CombatHudSign asset="sign_res" label="资源标志" fallback="资" />
              <span>{Math.floor(game.gold)}</span>
            </span>
          </div>
          {game.fortress.overheated ? <span className="combat-hud-overheated mt-0.5 self-start font-comic text-[9px] font-black text-[#F2D7A0] [text-shadow:1px_1px_0_#1A1A18]">过热停火</span> : null}
        </section> : null}
        {!edit && !missionOpen && !combatPreparationOpen && performanceOptions.enabled && !performanceMonitorCollapsed ? <PerformanceMonitor options={performanceOptions} /> : null}
        {!edit && !missionOpen && zoomIndicator !== null ? <div
          role="status"
          aria-live="polite"
          aria-label={`当前缩放 ${zoomIndicator}%`}
          className="pointer-events-none absolute left-1/2 top-1/2 z-40 -translate-x-1/2 -translate-y-1/2 border-2 border-white/80 bg-black/70 px-4 py-2 font-comic text-[18px] font-black text-white shadow-[2px_2px_0_rgba(0,0,0,0.65)]"
        >{zoomIndicator}%</div> : null}
        {!edit && !missionOpen && !combatPreparationOpen && assemblyAllowed ? <button
          type="button"
          aria-label="打开战车整备"
          aria-pressed={combatPreparationOpen}
          title={game.objective.type === 'fortressDefense' ? '打开主控单位整备；点击场上的玩家单位可调整其炮塔' : '打开战车整备（安装炮塔与模块消耗关卡资源）'}
          onClick={() => openCombatPreparation()}
          className={`combat-preparation-button combat-touch-target absolute z-30 flex items-center justify-center overflow-hidden transition-[filter,transform] ${combatPreparationOpen ? 'is-open' : ''}`}
        >
          {equipButtonAsset
            ? <img src={equipButtonAsset} alt="" draggable={false} className="pointer-events-none h-full w-full select-none object-contain" />
            : <span className="font-comic text-[9px] font-black text-white [text-shadow:1px_1px_0_#1A1A18]">整备</span>}
        </button> : null}
        {!edit && !missionOpen ? <div aria-label="炮塔自动开火" className="combat-turret-controls absolute z-30 flex items-end justify-end gap-4">
          {!ammoEnergySupplyInProgress && (supplyStatus.inside || inAssemblyZone) ? <div className="pointer-events-none absolute bottom-full right-0 mb-1 flex max-w-[min(88vw,360px)] flex-wrap justify-end gap-1">
            {supplyStatus.inside ? <span className="comic-panel bg-[#D8D2B5]/95 px-2 py-1 text-[8px] font-black text-[#3E7D46]">
              功能区域：{[supplyStatus.ammo ? '补充弹药' : '', supplyStatus.energy ? '充能' : '', supplyStatus.repair ? '修理' : '', supplyStatus.assembly ? '整备' : ''].filter(Boolean).join(' / ')}
            </span> : null}
            {inAssemblyZone && !combatPreparationOpen ? <span className="comic-panel bg-[#D8D2B5]/95 px-2 py-1 text-[8px] font-black text-[#8F2F28]">可进行战车整备</span> : null}
          </div> : null}
          {game.turrets.map((turret, index) => {
            const def = defOf(turret.defId)
            const { ammoCap, energyCap } = playerTurretResourceCaps(def, controllerModuleBonuses)
            const usesAmmo = ammoCap > 0
            const cap = usesAmmo ? ammoCap : energyCap
            const current = usesAmmo ? (turret.ammo ?? ammoCap) : (turret.energy ?? energyCap)
            const energyCurrent = turret.energy ?? energyCap
            const percent = cap > 0 ? Math.max(0, Math.min(100, current / cap * 100)) : 100
            const enabled = turret.autoFire !== false
            const resourceName = usesAmmo ? '弹药' : energyCap > 0 ? '能量' : '无限'
            const ammoInsufficient = usesAmmo && current < (def.type === 'spray' ? Number.EPSILON : 1)
            const energyNeed = Math.max(def.energyPerShot ?? 0, def.type === 'beam' ? (def.energyPerSec ?? 0) * 0.1 : 0)
            const energyInsufficient = energyCap > 0 && energyCurrent + 1e-9 < Math.max(Number.EPSILON, energyNeed)
            const resourceBlocked = ammoInsufficient || energyInsufficient
            const blocked = game.fortress.overheated || resourceBlocked
            const statusText = game.fortress.overheated ? '过热' : ammoInsufficient ? '无弹药' : energyInsufficient ? '能量不足' : enabled ? '自动' : '停火'
            const replenishing = (usesAmmo && supplyStatus.ammo && current < cap) || (!usesAmmo && energyCap > 0 && supplyStatus.energy && current < cap)
            const weaponBackground = combatUiAssetSrc('btn_weapon_bg')
            const weaponStateOverlay = combatUiAssetSrc(enabled ? 'btn_weapon_on' : 'btn_weapon_off')
            const iconAsset = def.iconAsset ? getAsset(def.iconAsset) : undefined
            const weaponIcon = iconAsset?.category === 'icon' ? iconAsset.src : undefined
            return <div key={turret.id} className={`combat-turret-item flex shrink-0 items-start ${blocked ? 'is-blocked' : ''} ${replenishing ? 'is-replenishing' : ''}`}>
              <div className="flex min-w-0 flex-col items-center">
                <button
                  type="button"
                  aria-pressed={enabled}
                  aria-label={`${def.name} 自动开火${enabled ? '已开启' : '已关闭'}`}
                  title={`${index + 1}. ${def.name} · ${statusText} · ${resourceName}${cap > 0 ? ` ${Math.ceil(current)}/${cap}` : ''}`}
                  onClick={() => setGame(currentGame => setTurretAutoFire(currentGame, turret.id, !enabled))}
                  className="combat-weapon-toggle combat-touch-target relative shrink-0 overflow-hidden transition-[filter,transform] active:scale-95"
                >
                  {weaponBackground ? <img src={weaponBackground} alt="" draggable={false} className="pointer-events-none absolute inset-0 h-full w-full select-none object-fill" /> : null}
                  {weaponIcon ? <img src={weaponIcon} alt="" draggable={false} className="pointer-events-none absolute inset-[8%] h-[84%] w-[84%] select-none object-contain" /> : null}
                  {weaponStateOverlay ? <img src={weaponStateOverlay} alt="" draggable={false} className="combat-weapon-toggle__state pointer-events-none absolute inset-0 z-10 h-full w-full select-none object-fill" /> : null}
                </button>
                <span className="combat-turret-name mt-1 block max-w-full truncate text-center font-comic font-black text-white [text-shadow:-1px_-1px_0_#1A1A18,1px_-1px_0_#1A1A18,-1px_1px_0_#1A1A18,1px_1px_0_#1A1A18]">{def.name}</span>
              </div>
              <CombatHudVerticalMeter label={`${def.name}${resourceName}存量`} percent={percent} />
            </div>
          })}
        </div> : null}
        <div className={`relative ${edit ? 'box-content border-[3px] border-black' : ''}`} style={{ width: canvasFit.w, height: canvasFit.h }}>
          <canvas
            ref={canvasRef}
            style={{ width: canvasFit.w, height: canvasFit.h, display: 'block', touchAction: 'none', backgroundColor: '#000000' }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
            onLostPointerCapture={onLostPointerCapture}
            onContextMenu={event => {
              event.preventDefault()
              if (editRef.current?.picked?.ghostOrigin === 'paste' || editRef.current?.pickedGroup?.ghostOrigin === 'paste') cancelMove()
            }}
            onPointerLeave={() => setHover(null)}
          />
          {!edit && !missionOpen ? battlefieldResourceIndicators.map(detail => {
            const left = (detail.x - resourceIndicatorCamera.x) * size.cell / Math.max(1, size.w) * canvasFit.w
            const top = (detail.y - resourceIndicatorCamera.y) * size.cell / Math.max(1, size.h) * canvasFit.h - 38
            const target: 'main' | number = detail.unitId === null ? 'main' : detail.unitId
            const supplyingAmmoOrEnergy = detail.supplyAmmo || detail.supplyEnergy
            return <div key={target} aria-label={`${detail.unitName}资源状态`} className="absolute z-30 flex -translate-x-1/2 flex-col items-center gap-0.5" style={{ left, top }} onPointerDown={event => event.stopPropagation()}>
              {!supplyingAmmoOrEnergy ? <button type="button" aria-label={`查看${detail.unitName}弹药和能量`} onClick={() => setResourceDetailsTarget(current => current === target ? null : target)} className="comic-panel combat-touch-target flex min-h-7 min-w-7 items-center justify-center gap-0.5 bg-[#D8D2B5]/95 px-1 text-[#8F2F28]">
                {detail.missingAmmo ? <Bomb className="h-3.5 w-3.5" strokeWidth={3} /> : null}
                {detail.missingEnergy ? <Zap className="h-3.5 w-3.5" strokeWidth={3} /> : null}
                {!detail.missingAmmo && !detail.missingEnergy && !detail.supplyAmmo && !detail.supplyEnergy && detail.supplyRepair ? <span aria-hidden="true" className="text-[12px] font-black leading-none text-[#3E7D46]">＋</span> : null}
              </button> : null}
              {(detail.supplyAmmo || detail.supplyEnergy || detail.supplyRepair) ? <div className="comic-panel w-20 bg-[#D8D2B5]/95 p-0.5">
                {detail.supplyAmmo ? <div className="flex items-center gap-0.5"><Bomb className="h-2.5 w-2.5" /><span className="h-1.5 flex-1 border border-black bg-black/20"><span className="block h-full bg-[#A07840]" style={{ width: `${detail.ammoProgress * 100}%` }} /></span></div> : null}
                {detail.supplyEnergy ? <div className="flex items-center gap-0.5"><Zap className="h-2.5 w-2.5" /><span className="h-1.5 flex-1 border border-black bg-black/20"><span className="block h-full bg-[#5C7E8C]" style={{ width: `${detail.energyProgress * 100}%` }} /></span></div> : null}
                {detail.supplyRepair ? <div className="flex items-center gap-0.5"><span className="w-2.5 text-center text-[8px] font-black">＋</span><span className="h-1.5 flex-1 border border-black bg-black/20"><span className="block h-full bg-[#3E7D46]" style={{ width: `${detail.repairProgress * 100}%` }} /></span></div> : null}
              </div> : null}
            </div>
          }) : null}
          {edit && <div aria-label="鼠标所在格坐标" className="pointer-events-none absolute bottom-1 left-1 z-20 border-2 border-black bg-[#D2CCA9]/95 px-2 py-0.5 font-comic text-[10px] font-black tabular-nums">
            {editorPointerCoordinate
              ? `X: ${editorPointerCoordinate.freePosition ? editorPointerCoordinate.x.toFixed(1) : editorPointerCoordinate.x}  Y: ${editorPointerCoordinate.freePosition ? editorPointerCoordinate.y.toFixed(1) : editorPointerCoordinate.y}`
              : 'X: —  Y: —'}
          </div>}
        </div>

        {!edit && !missionOpen && openedResourceDetails && !openedResourceDetails.supplyAmmo && !openedResourceDetails.supplyEnergy ? <section role="dialog" aria-label={`${openedResourceDetails.unitName}资源详情`} className="comic-panel absolute left-1/2 top-14 z-[80] w-[min(320px,88vw)] -translate-x-1/2 bg-[#D2CCA9]/[0.98] p-2">
          <div className="flex items-center border-b-2 border-black pb-1"><h2 className="flex-1 truncate text-[11px] font-black">{openedResourceDetails.unitName} · 炮塔资源</h2><button type="button" aria-label="关闭资源详情" className="comic-btn h-6 px-2 text-[9px] font-black" onClick={() => setResourceDetailsTarget(null)}>关闭</button></div>
          <div className="mt-1 max-h-40 overflow-y-auto">
            {openedResourceDetails.turrets.length === 0 ? <div className="py-2 text-center text-[9px] font-bold text-black/45">该单位没有炮塔，无弹药或能量消耗。</div> : openedResourceDetails.turrets.map(row => <div key={row.turretId} className="grid grid-cols-[1fr_auto_auto] gap-2 border-b border-black/25 py-1 text-[9px] font-black"><span className="truncate">{row.name}</span><span>弹药 {row.ammoCap > 0 ? `${formatResourceAmount(row.ammo)}/${formatResourceAmount(row.ammoCap)}` : '∞'}</span><span>能量 {row.energyCap > 0 ? `${formatResourceAmount(row.energy)}/${formatResourceAmount(row.energyCap)}` : '∞'}</span></div>)}
          </div>
        </section> : null}


        {/* v1.53 战场右缘悬浮面板：炮塔/模块列表（竖排悬浮覆盖战场右缘，一列排完自动排第二列）；打开期间摇杆禁用 */}
        {!edit && panel !== null && (
          <div className="combat-card-list absolute right-1 top-1 bottom-1 z-40 flex flex-col flex-wrap content-start justify-center gap-1 overflow-hidden">
            <div className="comic-panel grid grid-cols-2 gap-1 p-1">
              <button type="button" aria-pressed={panel === 'turret'} onClick={() => { if (panel !== 'turret') togglePanel('turret') }} className={`comic-btn combat-touch-target px-2 py-0.5 text-[9px] font-black ${panel === 'turret' ? 'bg-[#B3392E] text-[#EFEBD8]' : ''}`}>炮塔</button>
              <button type="button" aria-pressed={panel === 'module'} onClick={() => { if (panel !== 'module') togglePanel('module') }} className={`comic-btn combat-touch-target px-2 py-0.5 text-[9px] font-black ${panel === 'module' ? 'bg-[#B3392E] text-[#EFEBD8]' : ''}`}>模块</button>
            </div>
            {!assemblyAllowed && <div className="comic-panel max-w-28 px-1 py-0.5 text-center text-[8px] font-black leading-tight text-[#B3392E]">驶入起点区域后可配置</div>}
            {panel === 'turret' ? (
              <>
                {TURRET_DEFS.map(def => {
                  const Icon = cardIcon(def)
                  const active = mode.kind === 'turret' && mode.defId === def.id
                  const afford = game.gold >= def.cost
                  const unlocked = isEquipmentUnlocked(missionProgress, { kind: 'turret', id: def.id }, LEVEL_LIBRARY)
                  return (
                    <button
                      key={def.id}
                      type="button"
                      disabled={!assemblyAllowed || !unlocked}
                      title={!unlocked ? '尚未解锁' : !assemblyAllowed ? '驶入起点区域后可配置' : undefined}
                      onClick={() => { setMode(active ? { kind: 'none' } : { kind: 'turret', defId: def.id }); setSelTurret(null) }}
                      className={`comic-panel relative px-0.5 py-1 flex flex-col items-center gap-[2px] transition-transform disabled:opacity-50 ${
                        active ? 'border-[#B3392E] -translate-y-1 shadow-[4px_6px_0_#1A1A18]' : ''
                      } ${!afford && assemblyAllowed ? 'opacity-60' : ''}`}
                    >
                      <div className="w-5 h-5 border-2 border-black flex items-center justify-center" style={{ backgroundColor: def.color }}>
                        <Icon className="w-3 h-3 text-black/70" strokeWidth={2.5} />
                      </div>
                      <span className="text-[9px] font-black leading-none whitespace-nowrap">{unlocked ? '' : '🔒 '}{def.name}</span>
                      {/* 炮位尺寸 + 造价（弹药/电量等战斗消耗不在牌面显示） */}
                      <span className="text-[8px] font-bold leading-none flex items-center gap-[2px]">
                        <span className="px-[2px] border border-black/60 bg-black/10">{def.mount}型</span>
                        <span className="text-[#8a6a1d] flex items-center gap-[1px]"><Coins className="w-[9px] h-[9px]" />{def.cost}</span>
                      </span>
                    </button>
                  )
                })}
                {/* 拆除工具 */}
                <button
                  type="button"
                  disabled={!assemblyAllowed}
                  onClick={() => setMode(mode.kind === 'demolish' ? { kind: 'none' } : { kind: 'demolish' })}
                  className={`comic-panel relative px-1 py-1 flex flex-col items-center gap-[2px] transition-transform disabled:opacity-50 ${
                    mode.kind === 'demolish' ? 'border-[#B3392E] -translate-y-1 shadow-[4px_6px_0_#1A1A18]' : ''
                  }`}
                >
                  <div className="w-5 h-5 border-2 border-black bg-[#8C8078] flex items-center justify-center">
                    <Trash2 className="w-3 h-3 text-black/70" strokeWidth={2.5} />
                  </div>
                  <span className="text-[9px] font-black leading-none whitespace-nowrap">拆除</span>
                  <span className="text-[7px] font-bold text-black/50 leading-none whitespace-nowrap">返还半价</span>
                </button>
              </>
            ) : (
              <>
                {MODULE_DEFS.map((d: ModuleDef) => {
                  const active = interiorSel === d.id
                  const afford = game.gold >= d.cost
                  const unlocked = isEquipmentUnlocked(missionProgress, { kind: 'module', id: d.id }, LEVEL_LIBRARY)
                  return (
                    <button
                      key={d.id}
                      type="button"
                      disabled={!assemblyAllowed || !unlocked}
                      onClick={() => { setInteriorSel(active ? null : d.id); setInteriorDemo(false); setInteriorRot(0) }}
                      title={!unlocked ? '尚未解锁' : !assemblyAllowed ? '驶入起点区域后可配置' : d.desc}
                      className={`comic-panel relative px-0.5 py-1 flex flex-col items-center gap-[2px] transition-transform disabled:opacity-50 ${
                        active ? 'border-[#B3392E] -translate-y-1 shadow-[4px_6px_0_#1A1A18]' : ''
                      } ${!afford && assemblyAllowed ? 'opacity-60' : ''}`}
                    >
                      <div className="w-5 h-5 border-2 border-black flex items-center justify-center overflow-hidden" style={{ backgroundColor: d.color }}>
                        {d.asset && getAsset(d.asset) ? ( // v2.30 模块贴图（素材库模块分类锚定）；缺省 Zap 图标回退
                          <img src={getAsset(d.asset)!.src} alt="" className="w-full h-full object-contain" />
                        ) : (
                          <Zap className="w-3 h-3 text-black/70" strokeWidth={2.5} />
                        )}
                      </div>
                      <span className="text-[9px] font-black leading-none whitespace-nowrap">{unlocked ? '' : '🔒 '}{d.name} {d.w}×{d.h}</span>
                      <span className="text-[8px] font-bold text-[#8a6a1d] leading-none flex items-center gap-[1px]">
                        <Coins className="w-[9px] h-[9px]" />{d.cost}
                      </span>
                    </button>
                  )
                })}
                {/* 模块拆除工具 */}
                <button
                  type="button"
                  disabled={!assemblyAllowed}
                  onClick={() => { setInteriorDemo(d => !d); setInteriorSel(null) }}
                  className={`comic-panel relative px-1 py-1 flex flex-col items-center gap-[2px] transition-transform disabled:opacity-50 ${
                    interiorDemo ? 'border-[#B3392E] -translate-y-1 shadow-[4px_6px_0_#1A1A18]' : ''
                  }`}
                >
                  <div className="w-5 h-5 border-2 border-black bg-[#8C8078] flex items-center justify-center">
                    <Trash2 className="w-3 h-3 text-black/70" strokeWidth={2.5} />
                  </div>
                  <span className="text-[9px] font-black leading-none whitespace-nowrap">拆模块</span>
                  <span className="text-[7px] font-bold text-black/50 leading-none whitespace-nowrap">返还半价</span>
                </button>
                {/* 旋转 */}
                <button
                  type="button"
                  disabled={!interiorSel}
                  onClick={() => setInteriorRot(r => (r ? 0 : 1))}
                  className="comic-panel relative px-1 py-1 flex flex-col items-center gap-[2px] transition-transform disabled:opacity-50"
                >
                  <div className="w-5 h-5 border-2 border-black bg-[#7E8A94] flex items-center justify-center">
                    <Rocket className="w-3 h-3 text-black/70 rotate-90" strokeWidth={2.5} />
                  </div>
                  <span className="text-[9px] font-black leading-none whitespace-nowrap">旋转 R</span>
                  {interiorSel && (
                    <span className="text-[7px] font-bold text-black/50 leading-none whitespace-nowrap">
                      {moduleFoot(moduleDefOf(interiorSel), interiorRot).w}×{moduleFoot(moduleDefOf(interiorSel), interiorRot).h}
                    </span>
                  )}
                </button>
              </>
            )}
          </div>
        )}
          </div>
        </div>
      </div>

      {/* 选中炮塔面板 */}
      {selectedTurret && (
        <div className="relative z-20 mt-1 comic-panel px-2 py-1 flex items-center gap-2">
          {(() => {
            const def = defOf(selectedTurret.defId)
            const maxed = selectedTurret.level >= 3
            const cost = maxed ? 0 : upgradeCost(def, selectedTurret.level)
            return (
              <>
                <div className="min-w-0">
                  <div className="font-comic text-xs leading-tight">
                    {def.name} <span className="text-black/50">Lv.{selectedTurret.level}</span>
                    <span className="text-black/40 text-[10px]"> {def.w}×{def.h}格</span>
                  </div>
                  <div className="text-[10px] text-black/60 leading-tight flex items-center gap-1">
                    {game.fortress.overheated && <span className="text-[#B3392E] font-black">堡垒过热停火中</span>}
                    {selectedTurret.chargeLeft > 0 && <span className="text-[#2E63B8] font-black">充能中</span>}
                  </div>
                </div>
                <div className="ml-auto flex items-center gap-1 shrink-0">
                  {maxed ? (
                    <span className="text-[10px] font-black text-black/50 px-1">已满级</span>
                  ) : (
                    <button
                      type="button"
                      disabled={!assemblyAllowed || game.gold < cost}
                      onClick={() => setGame(g => upgradeTurret(g, selectedTurret.id))}
                      className="comic-btn px-2 py-[2px] text-xs font-comic disabled:opacity-40"
                    >
                      升级 {cost}资源
                    </button>
                  )}
                  {assemblyAllowed && !selectedTurret.builtIn && (
                    <button
                      type="button"
                      onClick={() => { setGame(g => demolishAt(g, selectedTurret.x, selectedTurret.y)); setSelTurret(null) }}
                      className="comic-panel px-1 py-[2px] text-[10px] font-black"
                    >
                      卸下
                    </button>
                  )}
                </div>
              </>
            )
          })()}
        </div>
      )}

      </div>{/* /画布列 */}

      {/* 关卡编辑器：左侧关卡库，中间画布，右侧按选择切换属性。 */}
      {edit && (
      <>
      <aside className="order-1 w-[210px] portrait:w-[49.5%] portrait:order-2 shrink-0 min-h-0 comic-panel overflow-hidden flex flex-col">
        <div className="level-editor-inline-fields px-2 py-1.5 flex-1 min-h-0 flex flex-col">
            <div className="grid grid-cols-2 border-2 border-black mb-1 shrink-0">
              <button type="button" className={`py-1 text-[9px] font-black border-r border-black ${editorLeftTab === 'levels' ? 'bg-[#B3392E] text-[#EFEBD8]' : 'bg-[#D2CCA9]'}`} onClick={() => setEditorLeftTab('levels')}>关卡列表</button>
              <button type="button" className={`py-1 text-[9px] font-black ${editorLeftTab === 'settings' ? 'bg-[#B3392E] text-[#EFEBD8]' : 'bg-[#D2CCA9]'}`} onClick={() => setEditorLeftTab('settings')}>关卡信息</button>
            </div>
            {editorLeftTab === 'levels' ? <>
            <div className="flex items-center gap-1 mb-1">
              <span className="font-comic text-[11px] font-black">关卡列表</span>
              <span className="text-[8px] font-bold text-black/35">{edit.library.levels.length}/50</span>
            </div>
            <div className="flex items-stretch gap-1 mb-1">
              <input aria-label="搜索关卡" placeholder="搜索关卡名称…" value={editorLevelQuery} onChange={e => setEditorLevelQuery(e.target.value)} className="flex-1 min-w-0 px-1 py-0.5 text-[8px] border border-black bg-[#EFEBD8]" />
              <button type="button" aria-label="关卡上移" className="comic-btn w-6 px-0 py-0 text-[9px]" onClick={() => moveEditorLevel(-1)}>↑</button>
              <button type="button" aria-label="关卡下移" className="comic-btn w-6 px-0 py-0 text-[9px]" onClick={() => moveEditorLevel(1)}>↓</button>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto space-y-1">
              {edit.library.levels.map((entry, index) => ({ entry, index })).filter(({ entry }) => entry.name.toLocaleLowerCase().includes(editorLevelQuery.trim().toLocaleLowerCase())).map(({ entry, index }) => {
                const level = entry.id === edit.levelId ? edit.draft : entry.level
                const selected = entry.id === edit.levelId
                return (
                  <button key={entry.id} type="button" className={`w-full px-1.5 py-1 text-left border-2 ${selected ? 'border-[#B3392E] bg-[#B3392E]/10' : 'border-black/25 hover:bg-black/5'}`} onClick={() => switchEditorLevel(entry.id)}>
                    <span className="flex items-center gap-1">
                      <span className="font-comic text-[10px] font-black truncate">{String(index + 1).padStart(2, '0')} · {entry.name}</span>
                    </span>
                    <span className="block text-[8px] font-bold text-black/45">任务 {level.stages.length} 阶段 · {level.cols}×{level.rows} · 伏击 {level.triggers.length}</span>
                  </button>
                )
              })}
            </div>
            <div className="grid grid-cols-3 gap-1 mt-1 px-2">
              <button type="button" className="comic-btn w-full py-1 text-[8px]" onClick={() => createEditorLevel(false)}>＋新建</button>
              <button type="button" className="comic-btn w-full py-1 text-[8px]" onClick={() => createEditorLevel(true)}>复制</button>
              <button type="button" className="comic-btn w-full py-1 text-[8px]" disabled={edit.library.levels.length <= 1} onClick={deleteEditorLevel}>删除</button>
            </div>
            <div className="text-[8px] font-bold text-black/40 mt-1">当前选中关卡将成为试玩关卡。</div>
            </> : <div className="flex-1 min-h-0 overflow-y-auto space-y-1">
              <label className="block text-[8px] font-black">关卡名称<input className="w-full px-1 py-0.5 text-[9px] border border-black bg-[#EFEBD8]" value={edit.library.levels.find(item => item.id === edit.levelId)?.name ?? ''} onChange={event => renameEditorLevel(event.target.value)} /></label>
              <div className="grid grid-cols-2 gap-1"><label className="text-[8px] font-black">战场宽<ValidatedNumberInput aria-label="战场宽" value={edit.draft.cols} min={20} integer onValueCommit={value => updateDraft(draft => { draft.cols = value })} className="w-full px-1 border border-black bg-[#EFEBD8]" /></label><label className="text-[8px] font-black">战场高<ValidatedNumberInput aria-label="战场高" value={edit.draft.rows} min={12} integer onValueCommit={value => updateDraft(draft => { draft.rows = value })} className="w-full px-1 border border-black bg-[#EFEBD8]" /></label></div>
              <label className="block text-[8px] font-black" title="本场战斗中，战车炮塔与模块装配分的合计不得超过此值">装配分上限<ValidatedNumberInput aria-label="装配分上限" value={edit.draft.assemblyPointLimit} min={0} max={999} integer onValueCommit={value => updateDraft(draft => { draft.assemblyPointLimit = value })} className="w-full px-1 border border-black bg-[#EFEBD8]" /></label>
              {(() => { const entry = edit.library.levels.find(item => item.id === edit.levelId); if (!entry) return null; const briefing = missionBriefingOf(entry); const patchBriefing = (next: Partial<typeof briefing>) => updateEditorEntry(current => { current.briefing = { ...missionBriefingOf(current), ...next } }); return <>
                <label className="block text-[8px] font-black">BGM<select aria-label="关卡 BGM" className="w-full px-1 border border-black bg-[#EFEBD8]" value={edit.draft.bgm ?? ''} onChange={event => updateDraft(draft => { draft.bgm = event.target.value })}><option value="">无</option>{filterAssets('bgm').map(asset => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</select></label>
                <label className="block text-[8px] font-black">任务贴图<MissionImageSelect value={briefing.image ?? 'builtin:mission/briefing_default'} onChange={image => patchBriefing({ image })} /></label>
                <label className="block text-[8px] font-black">任务简报<textarea rows={4} className="w-full resize-y px-1 border border-black bg-[#EFEBD8]" value={briefing.introduction} onChange={event => patchBriefing({ introduction: event.target.value.slice(0, 500) })} /></label>
                <MissionGoalTextEditor label="主要目标" text={briefing.primaryObjective} onTextChange={primaryObjective => patchBriefing({ primaryObjective })} />
                {briefing.secondaryObjectives.map((objective, index) => <MissionGoalTextEditor key={index} label={`次要目标 ${index + 1}`} text={objective} onTextChange={text => { const secondaryObjectives: [string, string] = [...briefing.secondaryObjectives]; secondaryObjectives[index] = text; patchBriefing({ secondaryObjectives }) }} />)}
                <div className="border-t border-black/25 pt-1">
                  <div className="mb-0.5 flex items-center text-[8px] font-black"><span>备选出战车辆</span><span className="ml-auto text-black/45">最多 3 辆</span></div>
                  {(() => {
                    const vehicles = playableVehicleDefs()
                    const ids = deployableFortressIdsOf(entry, vehicles.map(item => item.id))
                    const slots = [...ids, '', '', ''].slice(0, 3)
                    return <div className="space-y-1">{slots.map((selectedId, index) => <label key={index} className="flex items-center gap-1 text-[8px] font-bold">
                      <span className="w-9 shrink-0">车辆 {index + 1}</span>
                      <select
                        aria-label={`备选出战车辆 ${index + 1}`}
                        className="min-w-0 flex-1 px-1 py-0.5 border border-black bg-[#EFEBD8]"
                        value={selectedId}
                        onChange={event => updateEditorEntry(current => {
                          const currentIds = deployableFortressIdsOf(current, vehicles.map(item => item.id))
                          const nextSlots = [...currentIds, '', '', ''].slice(0, 3)
                          nextSlots[index] = event.target.value
                          const nextIds = Array.from(new Set(nextSlots.filter(Boolean))).slice(0, 3)
                          current.deployableFortressIds = nextIds.length > 0 ? nextIds : [vehicles[0]?.id].filter((id): id is string => !!id)
                        })}
                      >
                        <option value="" disabled={ids.length <= 1 && !!selectedId}>未选择</option>
                        {vehicles.map(fortress => <option key={fortress.id} value={fortress.id} disabled={fortress.id !== selectedId && ids.includes(fortress.id)}>{fortress.name}</option>)}
                      </select>
                    </label>)}</div>
                  })()}
                </div>
                <div className="border-t border-black/25 pt-1 space-y-1">
                  <div className="text-[8px] font-black">关卡链与奖励</div>
                  <label className="block text-[8px] font-bold">下一关<select aria-label="下一关" className="w-full px-1 border border-black bg-[#EFEBD8]" value={entry.nextId ?? ''} onChange={event => updateEditorEntry(current => { current.nextId = event.target.value || null })}><option value="">无下一关</option>{edit.library.levels.filter(level => level.id !== edit.levelId).map(level => <option key={level.id} value={level.id}>{level.name}</option>)}</select></label>
                  <label className="block text-[8px] font-bold">资源奖励<ValidatedNumberInput aria-label="通关奖励" min={0} className="w-full px-1 border border-black bg-[#EFEBD8]" value={entry.reward ?? 0} onChange={event => updateEditorEntry(current => { current.reward = Math.max(0, Math.round(Number(event.target.value) || 0)) })} /></label>
                  <details className="border border-black/30 bg-[#D8CFB8]">
                    <summary className="cursor-pointer px-1 py-0.5 text-[8px] font-black">装备解锁奖励（{entry.unlockRewards?.length ?? 0}）</summary>
                    <div className="max-h-40 overflow-y-auto border-t border-black/25 p-1 space-y-1">
                      {(['fortress', 'turret', 'module', 'emblem'] as const).map(kind => <div key={kind}>
                        <div className="text-[7px] font-black text-black/50">{kind === 'fortress' ? '战车' : kind === 'turret' ? '炮塔' : kind === 'module' ? '模块' : '徽记'}</div>
                        {equipmentRewardOptions().filter(option => option.ref.kind === kind).map(option => {
                          const checked = entry.unlockRewards?.some(ref => equipmentUnlockId(ref) === equipmentUnlockId(option.ref)) ?? false
                          return <label key={equipmentUnlockId(option.ref)} className="flex items-center gap-1 text-[8px] font-bold"><input type="checkbox" checked={checked} onChange={event => updateEditorEntry(current => {
                            const rewards = current.unlockRewards ?? []
                            current.unlockRewards = event.target.checked
                              ? [...rewards, option.ref]
                              : rewards.filter(ref => equipmentUnlockId(ref) !== equipmentUnlockId(option.ref))
                          })} />{option.name}</label>
                        })}
                      </div>)}
                    </div>
                  </details>
                </div>
              </> })()}
            </div>}
        </div>
      </aside>

      <aside className="relative order-3 w-[330px] portrait:w-[49.5%] portrait:order-3 shrink-0 min-h-0 comic-panel overflow-hidden flex flex-col">
        <div className="px-2 py-1 border-b-2 border-black">
          <div className="font-comic text-[11px] font-black mb-1">{editorLayer === 'base' ? '底图层' : editorLayer === 'overlay' ? '装饰层' : editorLayer === 'terrain' ? '地形层' : '对象层'}</div>
          {editorLayer === 'object' ? <div className="grid grid-cols-4 border-2 border-black">
            {(['object', 'units', 'events', 'mission'] as const).map(tabName => <button key={tabName} type="button" className={`px-1 py-1 text-[8px] font-black border-r last:border-r-0 border-black ${editorInspectorTab === tabName ? 'bg-[#B3392E] text-[#EFEBD8]' : 'bg-[#D2CCA9]'}`} onClick={() => {
              setEditorInspectorTab(tabName)
              if (tabName === 'object') activateEditorBrush('barrel')
              else if (tabName === 'events') activateEditorBrush('trigger')
              else activateEditorBrush('move')
            }}>{EDITOR_TAB_NAME[tabName]}</button>)}
          </div> : null}
        </div>
        <div className="level-editor-inline-fields flex-1 min-h-0 overflow-y-auto p-1">

          {editorLayer === 'object' && (edit.selectedGroup?.length ?? 0) > 0 ? <section aria-label="多选对象列表" className="comic-panel px-2 py-1.5 mb-1 space-y-1">
            <div className="flex items-center gap-1"><span className="text-[9px] font-black">已选对象</span><span className="text-[8px] font-bold text-black/45">{edit.selectedGroup!.length}</span></div>
            <div className="grid grid-cols-2 gap-1">
              <button
                type="button"
                aria-pressed={edit.selectedGroup!.some(item => item.kind === 'unit') && !edit.selectedGroup!.some(item => item.kind === 'object')}
                disabled={!edit.selectedGroup!.some(item => item.kind === 'unit')}
                className={`comic-btn py-0.5 text-[8px] disabled:opacity-35 disabled:cursor-not-allowed ${edit.selectedGroup!.some(item => item.kind === 'unit') && !edit.selectedGroup!.some(item => item.kind === 'object') ? 'bg-[#B3392E] text-[#EFEBD8]' : ''}`}
                onClick={() => filterGroupedSelection('unit')}
              >只选单位</button>
              <button
                type="button"
                aria-pressed={edit.selectedGroup!.some(item => item.kind === 'object') && !edit.selectedGroup!.some(item => item.kind === 'unit')}
                disabled={!edit.selectedGroup!.some(item => item.kind === 'object')}
                className={`comic-btn py-0.5 text-[8px] disabled:opacity-35 disabled:cursor-not-allowed ${edit.selectedGroup!.some(item => item.kind === 'object') && !edit.selectedGroup!.some(item => item.kind === 'unit') ? 'bg-[#B3392E] text-[#EFEBD8]' : ''}`}
                onClick={() => filterGroupedSelection('object')}
              >只选物体</button>
            </div>
            {edit.selectedGroup!.every(item => item.kind === 'unit') ? (() => {
              const selectedIds = new Set(edit.selectedGroup!.map(item => item.data.id))
              const selectedUnits = edit.draft.initialUnits.filter(unit => selectedIds.has(unit.id))
              if (selectedUnits.length === 0) return null
              const firstFaction = selectedUnits[0].faction
              const commonFaction = selectedUnits.every(unit => unit.faction === firstFaction) ? firstFaction : ''
              const firstGroup = selectedUnits[0].group ?? ''
              const commonGroup = selectedUnits.every(unit => (unit.group ?? '') === firstGroup) ? firstGroup : ''
              const mixedGroup = !selectedUnits.every(unit => (unit.group ?? '') === firstGroup)
              const firstBehavior = selectedUnits[0].behavior ?? 'approach'
              const commonBehavior = selectedUnits.every(unit => (unit.behavior ?? 'approach') === firstBehavior) ? firstBehavior : ''
              const patchSelectedUnits = (change: (unit: LevelUnitPlacement) => void) => updateDraft(draft => {
                for (const unit of draft.initialUnits) if (selectedIds.has(unit.id)) change(unit)
              })
              return <div className="border border-black/30 bg-[#D2CCA9] p-1 space-y-1" aria-label="批量设置单位">
                <div className="flex items-center gap-1"><span className="text-[8px] font-black">统一设置单位</span><span className="ml-auto text-[7px] font-bold text-black/40">{selectedUnits.length} 个</span></div>
                <div className="grid grid-cols-3 gap-1">
                  <label className="text-[8px] font-bold">阵营<select aria-label="批量设置单位阵营" className="w-full min-w-0 px-1 border border-black bg-[#EFEBD8]" value={commonFaction} onChange={event => patchSelectedUnits(unit => { unit.faction = event.target.value as LevelPlacedUnitFaction })}>{commonFaction === '' ? <option value="" disabled>多种（选择后统一）</option> : null}<option value="player">玩家</option><option value="ally">友方</option><option value="neutral">中立</option><option value="neutralHostile">中立敌对</option><option value="enemy">敌方</option></select></label>
                  <label className="text-[8px] font-bold">组别<input aria-label="批量设置单位组别" maxLength={40} placeholder={mixedGroup ? '多种（输入后统一）' : '未编组'} className="w-full min-w-0 px-1 border border-black bg-[#EFEBD8]" value={commonGroup} onChange={event => { const group = event.target.value.trimStart().slice(0, 40); patchSelectedUnits(unit => { unit.group = group || undefined }) }} /></label>
                  <label className="text-[8px] font-bold">行为<select aria-label="批量设置单位行为" className="w-full min-w-0 px-1 border border-black bg-[#EFEBD8]" value={commonBehavior} onChange={event => patchSelectedUnits(unit => {
                    const behavior = event.target.value as NonNullable<LevelUnitPlacement['behavior']>
                    unit.behavior = behavior
                    unit.behaviorSpeedPercent ??= 100
                    if (behavior === 'random') { unit.behaviorRange = 6; unit.behaviorInterval ??= 3 }
                    else if (behavior === 'route') { unit.behaviorInterval ??= 1; unit.route ??= [] }
                    else if (behavior === 'approach') unit.behaviorRange = 8
                    else if (behavior === 'follow') unit.behaviorRange = 2
                  })}>{commonBehavior === '' ? <option value="" disabled>多种（选择后统一）</option> : null}<option value="static">停留</option><option value="guard">坚守</option><option value="random">随机</option><option value="route">路线</option><option value="approach">接近</option><option value="follow">跟随</option></select></label>
                </div>
              </div>
            })() : null}
            <div className="max-h-36 overflow-y-auto space-y-0.5">{edit.selectedGroup!.map(item => {
              const active = !!edit.selected && pickedKey(edit.selected) === pickedKey(item)
              const name = item.kind === 'unit'
                ? (unitDefById(item.data.unitDefId)?.name ?? `单位 ${item.data.id}`)
                : item.kind === 'object'
                  ? (objectTypeById(item.data.defId)?.name ?? item.data.kind ?? `物体 ${item.data.id ?? item.idx + 1}`)
                  : `地形 ${item.data.id ?? item.idx + 1}`
              const origin = pickedOrigin(item)
              return <button key={pickedKey(item)} type="button" aria-pressed={active} className={`w-full px-1.5 py-1 border text-left flex items-center gap-1 ${active ? 'border-[#B3392E] bg-[#B3392E]/10' : 'border-black/25 bg-[#EFEBD8]'}`} onClick={() => focusGroupedSelection(item)}>
                <span className={`shrink-0 px-1 py-px text-[7px] font-black text-[#EFEBD8] ${item.kind === 'unit' ? 'bg-[#3E7D46]' : 'bg-[#8A5B12]'}`}>{item.kind === 'unit' ? '单位' : '物体'}</span>
                <span className="min-w-0 flex-1 truncate text-[9px] font-black">{name}</span>
                <span className="shrink-0 text-[7px] font-bold text-black/40">{origin.x.toFixed(1)},{origin.y.toFixed(1)}</span>
              </button>
            })}</div>
          </section> : null}

          {editorInspectorTab === 'tiles' && <div className="space-y-1 mb-1">
            <TileAssetPicker kind="independent" template={editorTileTemplate} onSelect={setEditorTileTemplate} />
            <TileAssetPicker kind="autotileStatic" template={editorTileTemplate} onSelect={setEditorTileTemplate} />
            <TileAssetPicker kind="autotileAnimated" template={editorTileTemplate} onSelect={setEditorTileTemplate} />
          </div>}

          {editorInspectorTab === 'terrain' && <LevelWorldTypePanel key={`terrain-${editorHistoryRevision}`} kind="terrain" selectedDefinitionId={editorTerrainDefId} onSelectedDefinitionId={setEditorTerrainDefId} level={edit.draft} globalVariables={edit.library.globalVariables} onEnsureGlobalVariable={resolveEditorGlobalVariableName} onBeforePersist={() => recordEditorHistory()} onPlace={() => activateEditorBrush('puddle')} />}

          {editorInspectorTab === 'object' && edit.selected?.kind === 'object' ? (() => {
            const selected = edit.selected
            const object = edit.draft.objects[selected.idx]
            if (!object) return null
            const patchObject = (change: (item: LevelObject) => void) => updateDraft(draft => { const item = draft.objects.find(candidate => candidate.id !== undefined && candidate.id === object.id) ?? draft.objects[selected.idx]; if (item) change(item) })
            const focusedEventId = editorFocusedObjectEvent?.objectId === (object.id ?? 2000 + selected.idx) ? editorFocusedObjectEvent.eventId : undefined
            return <div className="comic-panel px-2 py-1.5 mb-1 space-y-1"><div className="text-[9px] font-black">选中物体实例</div><div className="grid grid-cols-2 gap-1"><label className="text-[8px] font-bold">显示层级<select className="w-full px-1 border border-black bg-[#EFEBD8]" value={object.renderLayer ?? 3} onChange={event => patchObject(item => { item.renderLayer = Math.max(1, Math.min(5, Number(event.target.value) || 3)) as 1 | 2 | 3 | 4 | 5 })}>{[1, 2, 3, 4, 5].map(layer => <option key={layer} value={layer}>{layer}</option>)}</select></label><label className="text-[8px] font-bold">状态<select aria-label="物体实例状态" className="w-full px-1 border border-black bg-[#EFEBD8]" value={object.state ?? 'default'} onChange={event => patchObject(item => { item.state = event.target.value })}>{objectStateOptions(object, object.state).map(state => <option key={state} value={state}>{state}</option>)}</select></label></div><div className="flex gap-1"><button type="button" className="comic-btn flex-1 py-0 text-[8px]" onClick={() => patchObject(item => { item.flipX = !item.flipX })}>左右翻转</button><button type="button" className="comic-btn flex-1 py-0 text-[8px]" onClick={() => patchObject(item => { item.rotation = (((item.rotation ?? 0) + 90) % 360) as 0 | 90 | 180 | 270 })}>顺时旋转</button></div><LevelObjectInstanceEvents key={`${object.id ?? 2000 + selected.idx}:${focusedEventId ?? 'none'}`} object={object} level={edit.draft} globalVariables={edit.library.globalVariables} focusedEventId={focusedEventId} onEnsureVariable={resolveEditorVariableName} onEnsureGlobalVariable={resolveEditorGlobalVariableName} onPatch={change => patchObject(item => { item.events = change(item.events ?? objectTypeById(item.defId)?.events ?? []) })} /></div>
          })() : null}

          {editorInspectorTab === 'object' && <><LevelWorldTypePanel key={`object-${editorHistoryRevision}`} kind="object" selectedDefinitionId={editorObjectDefId} onSelectedDefinitionId={setEditorObjectDefId} level={edit.draft} globalVariables={edit.library.globalVariables} onEnsureGlobalVariable={resolveEditorGlobalVariableName} onBeforePersist={() => recordEditorHistory()} onPlace={() => activateEditorBrush('barrel')} />{edit.picked?.kind === 'object' ? <div className="comic-panel px-2 py-1.5 mb-1 space-y-1"><div className="text-[9px] font-black">选中物体实例</div><div className="grid grid-cols-2 gap-1"><label className="text-[8px] font-bold">显示层级<select className="w-full px-1 border border-black bg-[#EFEBD8]" value={edit.picked.data.renderLayer ?? 3} onChange={event => setEdit(current => current?.picked?.kind === 'object' ? { ...current, picked: { ...current.picked, data: { ...current.picked.data, renderLayer: Math.max(1, Math.min(5, Number(event.target.value) || 3)) as 1 | 2 | 3 | 4 | 5 } } } : current)}>{[1, 2, 3, 4, 5].map(layer => <option key={layer} value={layer}>{layer}</option>)}</select></label><label className="text-[8px] font-bold">状态<select aria-label="待放回物体状态" className="w-full px-1 border border-black bg-[#EFEBD8]" value={edit.picked.data.state ?? 'default'} onChange={event => setEdit(current => current?.picked?.kind === 'object' ? { ...current, picked: { ...current.picked, data: { ...current.picked.data, state: event.target.value } } } : current)}>{objectStateOptions(edit.picked.data, edit.picked.data.state).map(state => <option key={state} value={state}>{state}</option>)}</select></label></div><div className="flex gap-1"><button type="button" className="comic-btn flex-1 py-0 text-[8px]" onClick={() => setEdit(current => current?.picked?.kind === 'object' ? { ...current, picked: { ...current.picked, data: { ...current.picked.data, flipX: !current.picked.data.flipX } } } : current)}>左右翻转</button><button type="button" className="comic-btn flex-1 py-0 text-[8px]" onClick={() => setEdit(current => current?.picked?.kind === 'object' ? { ...current, picked: { ...current.picked, data: { ...current.picked.data, rotation: (((current.picked.data.rotation ?? 0) + 90) % 360) as 0 | 90 | 180 | 270 } } } : current)}>顺时旋转</button></div><div className="text-[8px] text-black/45">{edit.picked.ghostOrigin === 'paste' ? '点击画布可连续放置副本；右键或 Esc 取消黏贴。' : '在画布目标位置点击以放回；'}全局顺序为层级 ＞ Y ＞ X，同键时单位显示在物体上方。</div></div> : null}</>}

          {editorInspectorTab === 'units' && (() => {
            const units = unitLibrary()
            const filteredUnits = editorUnitTypeFilter === 'all' ? units : units.filter(unit => unit.type === editorUnitTypeFilter)
            const unitGroups = [...new Set(edit.draft.initialUnits.map(unit => unit.group?.trim()).filter((group): group is string => !!group))].sort((a, b) => a.localeCompare(b, 'zh-CN'))
            const filteredPlacedUnits = edit.draft.initialUnits.filter(unit => (editorUnitFactionFilter === 'all' || unit.faction === editorUnitFactionFilter)
              && (editorUnitGroupFilter === 'all' || (editorUnitGroupFilter === 'ungrouped' ? !unit.group?.trim() : unit.group === editorUnitGroupFilter)))
            return <>
            <div className="comic-panel px-2 py-1.5 mb-1 space-y-1">
              <div className="flex items-center gap-1">
                <label className="flex flex-1 min-w-0 items-center gap-1 text-[8px] font-black"><span className="shrink-0">单位类型</span>
                  <select aria-label="单位类型筛选" className="flex-1 min-w-0 px-1 py-0.5 text-[9px] font-comic border border-black bg-[#EFEBD8]" value={editorUnitTypeFilter} onChange={event => setEditorUnitTypeFilter(event.target.value as UnitType | 'all')}>
                    <option value="all">全部类型</option>
                    {(Object.keys(UNIT_TYPE_NAME) as UnitType[]).map(type => <option key={type} value={type}>{UNIT_TYPE_NAME[type]}</option>)}
                  </select>
                </label>
              </div>
              <label className="flex items-center gap-1 text-[8px] font-black"><span className="shrink-0">放置阵营</span><select aria-label="放置单位阵营" className="flex-1 min-w-0 px-1 py-0.5 text-[9px] font-comic border border-black bg-[#EFEBD8]" value={editorPlacementFaction} onChange={event => setEditorPlacementFaction(event.target.value as LevelPlacedUnitFaction)}><option value="player">玩家</option><option value="ally">友方</option><option value="enemy">敌方</option><option value="neutral">中立</option><option value="neutralHostile">中立敌对</option></select></label>
              <div className="flex items-center gap-1 border-t border-black/20 pt-1"><span className="text-[9px] font-black text-black/45">已放置单位</span><span className="text-[8px] font-bold text-black/35">{edit.draft.initialUnits.length}/200</span></div>
              <div className="flex flex-wrap gap-1 min-h-16 max-h-36 overflow-y-auto border border-black/25 bg-[#D2CCA9] p-1" aria-label="单位索引图">
                {filteredUnits.length === 0 ? <div className="w-full self-center text-center text-[8px] font-bold text-black/40">该类型暂无单位</div> : filteredUnits.map(unit => {
                  const active = editorUnitDefId === unit.id && edit.brush === 'unit'
                  return <button key={unit.id} type="button" aria-label={`选择单位：${unit.name}`} aria-pressed={active} title={`${unit.name} · ${UNIT_TYPE_NAME[unit.type]}`} className={`w-8 h-16 shrink-0 overflow-hidden border-2 flex flex-col bg-[#EFEBD8] ${active ? 'border-[#B3392E] shadow-[1px_1px_0_#1A1A18]' : 'border-black/35'}`} onClick={() => { setEditorUnitDefId(unit.id); setEdit(current => current ? { ...current, brush: 'unit', picked: null } : current) }}>
                    <span className="relative flex w-full h-11 shrink-0 overflow-hidden bg-white/55">
                      <LevelUnitIndexPreview unit={unit} />
                    </span>
                    <span className="h-5 px-px flex items-center justify-center text-[6px] leading-[7px] font-black break-all overflow-hidden">{unit.name}</span>
                  </button>
                })}
              </div>
            </div>
            <div className="comic-panel px-2 py-1.5 mb-1 space-y-1">
                <div className="grid grid-cols-2 gap-1"><label className="flex items-center gap-1 text-[8px] font-black"><span className="shrink-0">单位阵营</span><select aria-label="初始单位阵营筛选" className="flex-1 min-w-0 px-1 py-0.5 text-[9px] font-comic border border-black bg-[#EFEBD8]" value={editorUnitFactionFilter} onChange={event => setEditorUnitFactionFilter(event.target.value as LevelPlacedUnitFaction | 'all')}><option value="all">全部阵营</option><option value="player">玩家</option><option value="ally">友方</option><option value="enemy">敌方</option><option value="neutral">中立</option><option value="neutralHostile">中立敌对</option></select></label><label className="flex items-center gap-1 text-[8px] font-black"><span className="shrink-0">组别</span><select aria-label="初始单位组别筛选" className="flex-1 min-w-0 px-1 py-0.5 text-[9px] font-comic border border-black bg-[#EFEBD8]" value={editorUnitGroupFilter} onChange={event => setEditorUnitGroupFilter(event.target.value)}><option value="all">全部组别</option><option value="ungrouped">未编组</option>{editorUnitGroupFilter !== 'all' && editorUnitGroupFilter !== 'ungrouped' && !unitGroups.includes(editorUnitGroupFilter) ? <option value={editorUnitGroupFilter}>{editorUnitGroupFilter}（已移除）</option> : null}{unitGroups.map(group => <option key={group} value={group}>{group}</option>)}</select></label></div>
                <div className="max-h-72 overflow-y-auto space-y-0.5">
                  {filteredPlacedUnits.length === 0 ? <div className="text-[8px] font-bold text-black/40">{edit.draft.initialUnits.length === 0 ? '暂无初始单位' : '当前阵营与组别筛选下暂无单位'}</div> : null}
                  {filteredPlacedUnits.map(placed => {
                    const def = unitDefById(placed.unitDefId)
                    const active = placed.id === editorSelectedInitialUnitId
                    const patchPlaced = (change: (unit: LevelUnitPlacement) => void) => patchPlacedUnit(placed.id, change)
                    const selectedUnitEventId = editorSelectedUnitEvent?.placementId === placed.id ? editorSelectedUnitEvent.eventId : null
                    const selectedUnitEvent = (placed.events ?? []).find(item => item.id === selectedUnitEventId)
                    const addUnitEvent = () => { const events = placed.events ?? []; const id = Math.max(0, ...events.map(item => item.id)) + 1; patchPlaced(unit => { unit.events = [...(unit.events ?? []), { id, name: `事件 ${id}`, trigger: 'interact', activationLimit: 1, cooldown: 0, conditions: emptyConditionGroup(), actions: [] }] }); setEditorSelectedUnitEvent({ placementId: placed.id, eventId: id }) }
                    return <div key={placed.id} className={`border ${active ? 'border-[#3E7D46] bg-[#3E7D46]/10' : 'border-black/25'}`}>
                      <button type="button" aria-expanded={active} className="w-full px-1 py-0.5 text-left flex items-center gap-1" onClick={() => { setEditorSelectedInitialUnitId(active ? null : placed.id); setEditorSelectedUnitEvent(null); setEdit(cur => cur ? { ...cur, brush: 'unit' } : cur) }}>
                        <span className="text-[9px] font-black truncate">{{ player: '玩家', ally: '友方', enemy: '敌方', neutral: '中立', neutralHostile: '中立敌对' }[placed.faction]} · {def?.name ?? placed.unitDefId}</span>
                        <span className="ml-auto text-[8px] font-black">{active ? '−' : '＋'}</span>
                      </button>
                      {active ? <div className="border-t border-black/20 p-1 space-y-1">
                        <div className="grid grid-cols-3 gap-1 items-end">
                          <label className="text-[8px] font-bold">阵营<select aria-label="初始单位阵营" className="w-full px-1 border border-black bg-[#EFEBD8]" value={placed.faction} onChange={event => patchPlaced(unit => { unit.faction = event.target.value as typeof unit.faction })}><option value="player">玩家</option><option value="ally">友方</option><option value="neutral">中立</option><option value="neutralHostile">中立敌对</option><option value="enemy">敌方</option></select></label>
                          <label className="text-[8px] font-bold">组别<input aria-label="初始单位编组" maxLength={40} placeholder="未编组" className="w-full px-1 border border-black bg-[#EFEBD8]" value={placed.group ?? ''} onChange={event => patchPlaced(unit => { unit.group = event.target.value.trimStart().slice(0, 40) || undefined })} /></label>
                          <label className="text-[8px] font-bold">行为<select aria-label="初始单位行为" className="w-full px-1 border border-black bg-[#EFEBD8]" value={placed.behavior ?? 'approach'} onChange={event => patchPlaced(unit => { const behavior = event.target.value as NonNullable<typeof unit.behavior>; unit.behavior = behavior; unit.behaviorSpeedPercent ??= 100; if (behavior === 'random') { unit.behaviorRange = 6; unit.behaviorInterval ??= 3 } else if (behavior === 'route') { unit.behaviorInterval ??= 1; unit.route ??= [] } else if (behavior === 'approach') unit.behaviorRange = 8; else if (behavior === 'follow') unit.behaviorRange = 2 })}><option value="static">停留</option><option value="guard">坚守</option><option value="random">随机</option><option value="route">路线</option><option value="approach">接近</option><option value="follow">跟随</option></select></label>
                        </div>
                        <div className="grid grid-cols-2 gap-1 border border-black/25 p-1">
                        </div>
                        {(placed.behavior ?? 'approach') === 'static' ? <div className="px-1 py-0.5 border border-black/20 text-[8px] font-bold text-black/50">停留在当前位置；接战移动后不会返回原位。</div> : null}
                        {placed.behavior === 'guard' ? <div className="grid grid-cols-[1fr_90px] gap-1 border border-black/25 p-1 items-center"><span className="text-[8px] font-bold text-black/50">结束战斗后返回关卡放置位置。</span><label className="text-[8px] font-bold">归位速度（%）<ValidatedNumberInput aria-label="坚守归位速度" min={0} max={100} className="w-full px-1 border border-black bg-[#EFEBD8]" value={placed.behaviorSpeedPercent ?? 100} onChange={event => patchPlaced(unit => { unit.behaviorSpeedPercent = Math.max(0, Math.min(100, Number(event.target.value) || 0)) })} /></label></div> : null}
                        {placed.behavior === 'random' ? <div className="grid grid-cols-3 gap-1 border border-black/25 p-1">
                          <label className="text-[8px] font-bold">范围（格）<ValidatedNumberInput aria-label="随机移动范围" min={0} step={0.5} className="w-full px-1 border border-black bg-[#EFEBD8]" value={placed.behaviorRange ?? 6} onChange={event => patchPlaced(unit => { unit.behaviorRange = Math.max(0, Number(event.target.value) || 0) })} /></label>
                          <label className="text-[8px] font-bold">间隔（秒）<ValidatedNumberInput aria-label="随机移动间隔" min={0} step={0.1} className="w-full px-1 border border-black bg-[#EFEBD8]" value={placed.behaviorInterval ?? 3} onChange={event => patchPlaced(unit => { unit.behaviorInterval = Math.max(0, Number(event.target.value) || 0) })} /></label>
                          <label className="text-[8px] font-bold">速度（%）<ValidatedNumberInput aria-label="随机移动速度" min={0} max={100} className="w-full px-1 border border-black bg-[#EFEBD8]" value={placed.behaviorSpeedPercent ?? 100} onChange={event => patchPlaced(unit => { unit.behaviorSpeedPercent = Math.max(0, Math.min(100, Number(event.target.value) || 0)) })} /></label>
                        </div> : null}
                        {placed.behavior === 'route' ? <div className="border border-black/25 p-1 space-y-1">
                          <div className="grid grid-cols-2 gap-1"><label className="text-[8px] font-bold">循环间隔（秒）<ValidatedNumberInput aria-label="路线循环间隔" min={0} step={0.1} className="w-full px-1 border border-black bg-[#EFEBD8]" value={placed.behaviorInterval ?? 1} onChange={event => patchPlaced(unit => { unit.behaviorInterval = Math.max(0, Number(event.target.value) || 0) })} /></label><label className="text-[8px] font-bold">速度（%）<ValidatedNumberInput aria-label="路线移动速度" min={0} max={100} className="w-full px-1 border border-black bg-[#EFEBD8]" value={placed.behaviorSpeedPercent ?? 100} onChange={event => patchPlaced(unit => { unit.behaviorSpeedPercent = Math.max(0, Math.min(100, Number(event.target.value) || 0)) })} /></label></div>
                          <div className="flex items-center gap-1"><button type="button" aria-pressed={edit.brush === 'route'} className={`comic-btn flex-1 py-0 text-[8px] ${edit.brush === 'route' ? 'bg-[#D9A441]' : ''}`} onClick={() => { setEditorSelectedInitialUnitId(placed.id); activateEditorBrush('route') }}>绘制路线节点</button><button type="button" className="comic-btn px-1 py-0 text-[8px]" onClick={() => patchPlaced(unit => { unit.route = [] })}>清空路线</button></div>
                          <div className="max-h-24 overflow-y-auto space-y-0.5">{(placed.route ?? []).length === 0 ? <div className="text-[8px] font-bold text-black/40">在场景中依次点击放置 1、2、3…号节点</div> : (placed.route ?? []).map((point, index) => <div key={`${index}-${point.x}-${point.y}`} className="grid grid-cols-[18px_1fr_1fr_20px] gap-1 items-center text-[8px]"><span className="font-black text-center">{index + 1}</span><label className="flex items-center gap-0.5">X<ValidatedNumberInput aria-label={`路线节点${index + 1} X`} step={0.5} className="min-w-0 w-full px-1 border border-black bg-[#EFEBD8]" value={point.x} onChange={event => patchPlaced(unit => { if (unit.route?.[index]) unit.route[index].x = Math.max(0.5, Math.min(edit.draft.cols - 0.5, Number(event.target.value) || 0.5)) })} /></label><label className="flex items-center gap-0.5">Y<ValidatedNumberInput aria-label={`路线节点${index + 1} Y`} step={0.5} className="min-w-0 w-full px-1 border border-black bg-[#EFEBD8]" value={point.y} onChange={event => patchPlaced(unit => { if (unit.route?.[index]) unit.route[index].y = Math.max(0.5, Math.min(edit.draft.rows - 0.5, Number(event.target.value) || 0.5)) })} /></label><button type="button" aria-label={`删除路线节点${index + 1}`} className="comic-btn px-0 py-0 text-[8px]" onClick={() => patchPlaced(unit => { unit.route?.splice(index, 1) })}>×</button></div>)}</div>
                        </div> : null}
                        {placed.behavior === 'approach' ? <div className="grid grid-cols-2 gap-1 border border-black/25 p-1"><label className="text-[8px] font-bold">触发范围（格）<ValidatedNumberInput aria-label="接近触发范围" min={0} step={0.5} className="w-full px-1 border border-black bg-[#EFEBD8]" value={placed.behaviorRange ?? 8} onChange={event => patchPlaced(unit => { unit.behaviorRange = Math.max(0, Number(event.target.value) || 0) })} /></label><label className="text-[8px] font-bold">速度（%）<ValidatedNumberInput aria-label="接近移动速度" min={0} max={100} className="w-full px-1 border border-black bg-[#EFEBD8]" value={placed.behaviorSpeedPercent ?? 100} onChange={event => patchPlaced(unit => { unit.behaviorSpeedPercent = Math.max(0, Math.min(100, Number(event.target.value) || 0)) })} /></label></div> : null}
                        {placed.behavior === 'follow' ? <div className="grid grid-cols-2 gap-1 border border-black/25 p-1"><label className="text-[8px] font-bold">跟随距离（格）<ValidatedNumberInput aria-label="跟随保持距离" min={0} step={0.5} className="w-full px-1 border border-black bg-[#EFEBD8]" value={placed.behaviorRange ?? 2} onChange={event => patchPlaced(unit => { unit.behaviorRange = Math.max(0, Number(event.target.value) || 0) })} /></label><label className="text-[8px] font-bold">速度（%）<ValidatedNumberInput aria-label="跟随移动速度" min={0} max={100} className="w-full px-1 border border-black bg-[#EFEBD8]" value={placed.behaviorSpeedPercent ?? 100} onChange={event => patchPlaced(unit => { unit.behaviorSpeedPercent = Math.max(0, Math.min(100, Number(event.target.value) || 0)) })} /></label></div> : null}
                        <div className="border-t border-black/30 pt-1 space-y-1">
                          <div className="flex items-center gap-1"><span className="text-[9px] font-black">事件列表</span><span className="text-[8px] text-black/40">{(placed.events ?? []).length}</span><button type="button" className="ml-auto comic-btn px-1.5 py-0 text-[9px]" onClick={addUnitEvent}>＋新增</button></div>
                          <div className="space-y-0.5 max-h-28 overflow-y-auto">{(placed.events ?? []).length === 0 ? <div className="text-[8px] font-bold text-black/40">暂无事件</div> : (placed.events ?? []).map(unitEvent => <button key={unitEvent.id} type="button" className={`w-full px-1 py-0.5 border text-left flex gap-1 ${selectedUnitEventId === unitEvent.id ? 'border-[#B3392E] bg-[#B3392E]/10' : 'border-black/25'}`} onClick={() => setEditorSelectedUnitEvent({ placementId: placed.id, eventId: unitEvent.id })}><span className="w-2 h-2 mt-0.5 border border-black bg-[#3E7D46]" /><span className="text-[9px] font-black truncate">{unitEvent.name}</span><span className="ml-auto text-[7px] text-black/45">{{ interact: '气泡按钮', destroyed: '单位摧毁', contact: '接触单位' }[unitEvent.trigger]}</span></button>)}</div>
                        </div>
                        {selectedUnitEvent ? (() => {
                          const unitEvent = selectedUnitEvent
                          const patchUnitEvent = (change: (event: LevelUnitEvent) => void) => patchPlaced(unit => { const event = (unit.events ?? []).find(item => item.id === unitEvent.id); if (event) change(event) })
                          return <EventEditorModal title={`编辑单位事件 · ${unitEvent.name}`} onClose={() => setEditorSelectedUnitEvent(null)}>
                            <div className="flex items-center gap-1"><input aria-label="单位事件名称" className="flex-1 min-w-0 px-1 border border-black bg-[#EFEBD8] text-[10px]" value={unitEvent.name} onChange={event => patchUnitEvent(item => { item.name = event.target.value })} /><button type="button" className="comic-btn px-2 py-0.5 text-[9px]" onClick={() => { patchPlaced(unit => { unit.events = (unit.events ?? []).filter(item => item.id !== unitEvent.id) }); setEditorSelectedUnitEvent(null) }}>删除</button></div>
                            <div className="grid grid-cols-2 gap-1"><label className="text-[8px] font-black">次数（0=无限）<ValidatedNumberInput min={0} className="w-full px-1 border border-black bg-[#EFEBD8]" value={unitEvent.activationLimit} onChange={event => patchUnitEvent(item => { item.activationLimit = Math.max(0, Math.round(Number(event.target.value) || 0)) })} /></label><label className="text-[8px] font-black">冷却（秒）<ValidatedNumberInput min={0} step={0.1} className="w-full px-1 border border-black bg-[#EFEBD8]" value={unitEvent.cooldown} onChange={event => patchUnitEvent(item => { item.cooldown = Math.max(0, Number(event.target.value) || 0) })} /></label></div>
                            <div className="border border-black/25 p-1"><label className="flex items-center gap-1 text-[8px] font-black"><span className="w-14">触发方式</span><select aria-label="单位事件触发方式" className="flex-1 min-w-0 px-1 border border-black bg-[#EFEBD8]" value={unitEvent.trigger} onChange={event => patchUnitEvent(item => { item.trigger = event.target.value as LevelUnitEvent['trigger'] })}><option value="interact">气泡按钮</option><option value="destroyed">单位摧毁</option><option value="contact">接触单位（包括碰撞）</option></select></label></div>
                            <EventConditionEditor ariaPrefix={`单位事件${unitEvent.id}`} conditions={unitEvent.conditions ?? emptyConditionGroup()} level={edit.draft} globalVariables={edit.library.globalVariables} onChange={conditions => patchUnitEvent(item => { item.conditions = conditions })} />
                            <ActionEditor showCommandPalette sourceKind="unit" actions={unitEvent.actions} level={edit.draft} variables={edit.draft.variables} globalVariables={edit.library.globalVariables} onEnsureVariable={resolveEditorVariableName} onEnsureGlobalVariable={resolveEditorGlobalVariableName} onChange={actions => patchUnitEvent(item => { item.actions = actions })} />
                          </EventEditorModal>
                        })() : null}
                      </div> : null}
                    </div>
                  })}
                </div>
            </div>
            </>
          })()}

          {editorInspectorTab === 'events' && <>
            <div className="comic-panel px-2 py-1.5 mb-1 space-y-1">
              <div className="flex items-center gap-1"><span className="text-[9px] font-black">事件列表</span><span className="text-[8px] text-black/40">{edit.draft.events.length}</span><button type="button" className="ml-auto comic-btn px-1.5 py-0 text-[9px]" onClick={() => {
                const id = Math.max(0, ...edit.draft.events.map(event => event.id)) + 1
                const next: UnifiedLevelEvent = { id, name: `事件 ${id}`, category: 'region', enabled: true, activationLimit: 1, cooldown: 0, trigger: { type: 'regionEnter', cells: [] }, conditions: emptyConditionGroup(), actions: [] }
                updateDraft(draft => { draft.events.push(next) }); setEditorSelectedEventId(id); setEditorEditingEventId(id); activateEditorBrush('trigger')
              }}>＋新增</button></div>
              <div className="space-y-0.5 max-h-28 overflow-y-auto">{edit.draft.events.length === 0 ? <div className="text-[8px] font-bold text-black/40">暂无事件</div> : edit.draft.events.map(event => <button key={event.id} type="button" className={`w-full px-1 py-0.5 border text-left flex gap-1 ${editorSelectedEventId === event.id ? 'border-[#B3392E] bg-[#B3392E]/10' : 'border-black/25'}`} onClick={() => { setEditorSelectedEventId(event.id); setEditorEditingEventId(event.id) }}><span className={`w-2 h-2 mt-0.5 border border-black ${event.enabled ? 'bg-[#3E7D46]' : 'bg-[#777269]'}`} /><span className="text-[9px] font-black truncate">{event.name}</span><span className="ml-auto text-[7px] text-black/45">{event.trigger.type}</span></button>)}</div>
            </div>
            {(() => {
              const selectedEvent = edit.draft.events.find(event => event.id === editorEditingEventId)
              if (!selectedEvent) return null
              const patchEvent = (change: (event: UnifiedLevelEvent, draft: LevelConfig) => void) => updateDraft(draft => { const event = draft.events.find(item => item.id === selectedEvent.id); if (event) change(event, draft) })
              const regionCells = selectedEvent.trigger.type === 'regionEnter' || selectedEvent.trigger.type === 'regionLeave' || selectedEvent.trigger.type === 'regionStay' ? selectedEvent.trigger.cells : null
              return <EventEditorModal title={`编辑关卡事件 · ${selectedEvent.name}`} onClose={() => setEditorEditingEventId(null)}>
                <div className="flex items-center gap-1"><input aria-label="事件名称" className="flex-1 min-w-0 px-1 border border-black bg-[#EFEBD8] text-[10px]" value={selectedEvent.name} onChange={event => patchEvent(item => { item.name = event.target.value })} /><label className="text-[9px] font-bold"><input type="checkbox" checked={selectedEvent.enabled} onChange={event => patchEvent(item => { item.enabled = event.target.checked })} />启用</label><button type="button" className="comic-btn px-2 py-0.5 text-[9px]" onClick={() => { updateDraft(draft => { draft.events = draft.events.filter(event => event.id !== selectedEvent.id) }); if (editorSelectedEventId === selectedEvent.id) setEditorSelectedEventId(null); setEditorEditingEventId(null) }}>删除</button></div>
                <div className="grid grid-cols-2 gap-2">
                  <label className="flex items-center gap-1 text-[8px] font-black"><span className="shrink-0">次数（0=∞）</span><ValidatedNumberInput aria-label="次数（0=∞）" min={0} className="flex-1 min-w-0 px-1 border border-black bg-[#EFEBD8]" value={selectedEvent.activationLimit} onChange={event => patchEvent(item => { item.activationLimit = Math.max(0, Math.round(Number(event.target.value) || 0)) })} /></label>
                  <label className="flex items-center gap-1 text-[8px] font-black"><span className="shrink-0">冷却（s）</span><ValidatedNumberInput aria-label="冷却（s）" min={0} step={0.1} className="flex-1 min-w-0 px-1 border border-black bg-[#EFEBD8]" value={selectedEvent.cooldown} onChange={event => patchEvent(item => { item.cooldown = Math.max(0, Number(event.target.value) || 0) })} /></label>
                </div>
                <div className="border border-black/25 p-1 space-y-1">
                  <label className="flex items-center gap-1 text-[8px] font-black"><span className="w-14">触发方式</span><select aria-label="触发方式" className="flex-1 min-w-0 px-1 border border-black bg-[#EFEBD8]" value={selectedEvent.trigger.type} onChange={event => patchEvent(item => {
                    const type = event.target.value
                    if (type === 'regionEnter' || type === 'regionLeave' || type === 'regionStay') item.trigger = { type, cells: [] }
                    else if (type === 'stageSuccess' || type === 'stageFailure') item.trigger = { type, stageId: edit.draft.stages[0]?.id ?? '' }
                    else if (type === 'automatic' || type === 'parallel' || type === 'missionStart') item.trigger = { type }
                  })}><option value="missionStart">任务开始</option><option value="automatic">自动</option><option value="parallel">并行</option><option value="stageSuccess">阶段成功</option><option value="stageFailure">阶段失败</option><option value="regionEnter">进入区域</option><option value="regionLeave">离开区域</option><option value="regionStay">停留区域</option></select></label>
                  {(selectedEvent.trigger.type === 'stageSuccess' || selectedEvent.trigger.type === 'stageFailure') ? <label className="flex items-center gap-1 text-[8px] font-black"><span className="w-14">任务阶段</span><select className="flex-1 min-w-0 px-1 border border-black bg-[#EFEBD8]" value={selectedEvent.trigger.stageId} onChange={event => patchEvent(item => { if (item.trigger.type === 'stageSuccess' || item.trigger.type === 'stageFailure') item.trigger.stageId = event.target.value })}>{edit.draft.stages.map(stage => <option key={stage.id} value={stage.id}>{stage.name}</option>)}</select></label> : null}
                  {regionCells ? <div className="flex items-center gap-1"><span className="text-[8px] font-bold">区域地格：{regionCells.length}</span><button type="button" className={`ml-auto comic-btn px-1 py-0 text-[8px] ${edit.brush === 'trigger' ? 'bg-[#D9A441]' : ''}`} onClick={() => activateEditorBrush('trigger')}>绘制区域</button><button type="button" className="comic-btn px-1 py-0 text-[8px]" onClick={() => patchEvent(item => { if (item.trigger.type === 'regionEnter' || item.trigger.type === 'regionLeave' || item.trigger.type === 'regionStay') item.trigger.cells = [] })}>清空</button></div> : null}
                </div>
                <EventConditionEditor
                  ariaPrefix={`关卡事件${selectedEvent.id}`}
                  conditions={selectedEvent.conditions ?? emptyConditionGroup()}
                  level={edit.draft}
                  globalVariables={edit.library.globalVariables}
                  onChange={conditions => patchEvent(item => { item.conditions = conditions })}
                />
                <ActionEditor showCommandPalette actions={selectedEvent.actions} level={edit.draft} variables={edit.draft.variables} globalVariables={edit.library.globalVariables} onEnsureVariable={resolveEditorVariableName} onEnsureGlobalVariable={resolveEditorGlobalVariableName} onChange={actions => patchEvent((item, draft) => { item.actions = actions; ensureActionVariableDefinitions(draft.variables, edit.library.globalVariables, actions) })} />
              </EventEditorModal>
            })()}
            <div className="comic-panel px-2 py-1.5 mb-1 space-y-1"><div className="flex items-center gap-1"><span className="text-[9px] font-black">关卡变量</span><span className="ml-auto text-[7px] font-bold text-black/40">数值变量 · 由执行动作自动创建</span></div>{edit.draft.variables.map(variable => <div key={variable.id} className="grid grid-cols-[1fr_58px_24px] gap-1"><input className="min-w-0 px-1 text-[8px] border border-black bg-[#EFEBD8]" value={variable.name} onChange={event => updateDraft(draft => { const item = draft.variables.find(value => value.id === variable.id); if (item) item.name = event.target.value })} /><ValidatedNumberInput aria-label="关卡变量初始值" className="min-w-0 px-1 text-[8px] border border-black bg-[#EFEBD8]" value={variable.initial} onChange={event => updateDraft(draft => { const item = draft.variables.find(value => value.id === variable.id); if (item) item.initial = Number(event.target.value) || 0 })} /><button type="button" className="comic-btn px-0 py-0 text-[8px]" onClick={() => updateDraft(draft => { draft.variables = draft.variables.filter(value => value.id !== variable.id) })}>×</button></div>)}</div>
            <div className="comic-panel px-2 py-1.5 mb-1 space-y-1"><div className="flex items-center gap-1"><span className="text-[9px] font-black">全局变量</span><span className="ml-auto text-[7px] font-bold text-black/40">数值变量 · 所有关卡共用</span></div>{edit.library.globalVariables.length === 0 ? <div className="text-[8px] font-bold text-black/40">由全局变量执行动作自动创建</div> : edit.library.globalVariables.map(variable => <div key={variable.id} className="grid grid-cols-[1fr_58px_24px] gap-1"><input aria-label="全局变量名称" className="min-w-0 px-1 text-[8px] border border-black bg-[#EFEBD8]" value={variable.name} onChange={event => updateEditorGlobalVariables(variables => { const item = variables.find(value => value.id === variable.id); if (item) item.name = event.target.value })} /><ValidatedNumberInput aria-label="全局变量初始值" className="min-w-0 px-1 text-[8px] border border-black bg-[#EFEBD8]" value={variable.initial} onChange={event => updateEditorGlobalVariables(variables => { const item = variables.find(value => value.id === variable.id); if (item) item.initial = Number(event.target.value) || 0 })} /><button type="button" aria-label="删除全局变量" className="comic-btn px-0 py-0 text-[8px]" onClick={() => updateEditorGlobalVariables(variables => { const index = variables.findIndex(value => value.id === variable.id); if (index >= 0) variables.splice(index, 1) })}>×</button></div>)}</div>
          </>}

          {editorInspectorTab === 'mission' && <div className="comic-panel px-2 py-1.5 mb-1"><StageFlowEditor level={edit.draft} selectedStageId={editorStageId} selectedWaveId={editorWaveId} selectedSpawnRegionId={editorSpawnRegionId} placementTarget={activeEditorFortressPlacementTarget} onPlacementTarget={setEditorFortressPlacementTarget} onSelectStage={id => { setEditorStageId(id); setEditorFortressPlacementTarget(null); const next = edit.draft.stages.find(stage => stage.id === id); setEditorSpawnRegionId(next?.objective.type === 'defend' || next?.objective.type === 'fortressDefense' ? next.objective.spawnRegions[0]?.id ?? null : null) }} onSelectWave={setEditorWaveId} onSelectSpawnRegion={setEditorSpawnRegionId} onSetFinish={() => activateEditorBrush('finish')} onDrawSpawnRegion={erase => activateEditorBrush(erase ? 'spawnRegionErase' : 'spawnRegion')} update={updateDraft} /></div>}

          {editorLayer === 'object' && editorInspectorTab !== 'units' ? <div className="mx-1 my-1 px-2 py-1 border border-black/25 bg-black/5 text-center text-[8px] text-black/50 font-bold">
            {edit.brush === 'start'
                ? '点地图放置玩家起点区域'
                    : edit.brush === 'finish'
                      ? '点击或拖动铺设当前抵达任务的终点区域；工具栏“擦除”可逐格移除，支持不规则、镂空和互不相连区域（不同任务互不共享）'
                    : edit.brush === 'trigger'
                      ? '在任意地格点击或拖动绘制事件区域；区域不要求为矩形'
                    : edit.brush === 'route'
                      ? '在场景中依次点击放置路线节点；节点按放置顺序自动编号'
                    : edit.brush === 'unit'
                      ? '选择友方或中立单位后，点击地图放置；点击已有单位可选中'
                  : edit.brush === 'eraser'
                    ? '点击/拖动擦除该格所有编辑层内容（含初始墙与核心）'
                    : edit.brush === 'move'
                      ? edit.picked?.ghostOrigin === 'paste' || edit.pickedGroup?.ghostOrigin === 'paste'
                        ? '黏贴模式：点击连续放置副本 · 右键或 Esc 取消黏贴'
                        : '单击对象定位详情 · 从空白处按住拖动框选多个单位/物体 · 按住对象拖动可移动 · ESC取消选择 · Delete删除'
                      : '点击或按住拖动连续铺设 · 上下拖空白处查看全战场'}
          </div> : null}
        </div>
      </aside>
      </>
      )}
      </div>{/* /中部横版布局 */}

      {/* #18 第二阶段：全屏关卡结算，取代旧的居中胜负弹窗。 */}
      {(game.phase === 'won' || game.phase === 'lost') && (
        <Suspense fallback={<DeferredOverlay label="正在加载任务结算…" />}>
          <MissionSettlement
            won={settlementWon}
            entry={settlementEntry}
            fortress={fortressDef(game)}
            elapsedSeconds={game.time}
            kills={game.kills}
            objectiveResults={settlementObjectiveResults}
            progress={missionProgress}
            newlyEarned={settlementNewMedals}
            newlyUnlocked={settlementNewUnlocks}
            reward={settlementNewReward}
            nextLevelName={settlementWon ? settlementNext?.name : undefined}
            onReturn={() => openMissionBriefing(settlementEntry.id)}
            onRetry={() => { completedRunRef.current = false; setSettlementNewMedals([]); setSettlementNewReward(0); setSettlementNewUnlocks([]); reset() }}
            onNext={settlementWon && settlementNext ? () => openMissionBriefing(settlementNext.id) : undefined}
          />
        </Suspense>
      )}

      {showDebug && (
        <Suspense fallback={<DeferredOverlay label="正在加载 DEBUG…" />}>
        <DebugPanel
          onClose={closeDebug}
          sceneEditDirty={!!edit && JSON.stringify(persistableEditorLibrary(edit)) !== editorSavedSnapshot}
          onSaveSceneEdit={saveEditorDraft}
          onExitSceneEdit={cancelEdit}
          onDeleteDef={(defId) => {
            // 删除自定义炮塔时，同步移除场上已放置实例并清理相关选择/建造状态
            setGame(g => ({ ...g, turrets: g.turrets.filter(t => t.defId !== defId) }))
            setSelTurret(sel => {
              const t = game.turrets.find(t => t.id === sel)
              return t?.defId === defId ? null : sel
            })
            setMode(m => (m.kind === 'turret' && m.defId === defId ? { kind: 'none' } : m))
          }}
          onRestart={() => {
            // 关卡编辑器应用/恢复默认：重置本局并清理选择/模式
            const nextGame = initialState()
            camRef.current = playerCenteredCamera(nextGame, size.cell, size.w, size.h)
            setGame(nextGame)
            setSelTurret(null)
            setMode({ kind: 'none' })
          }}
          onEnterSceneEdit={() => {
            // 打开关卡编辑工作区：载入完整库；活动关卡作为初始草稿，画布临时预览所选关卡。
            const library = levelLibraryForExport()
            const active = library.levels.find(x => x.id === library.activeId) ?? library.levels[0]
            const draft = structuredClone(active.level)
            draft.initialWalls = []
            draft.buildings = []
            draft.core = null // 旧核心/固定建筑/独立墙体退出编辑器；现行内容使用物体、单位与图块。
            const baselineLibrary = structuredClone(library)
            const baselineEntry = baselineLibrary.levels.find(entry => entry.id === active.id)
            if (baselineEntry) baselineEntry.level = structuredClone(draft)
            baselineLibrary.activeId = active.id
            setEditorSavedSnapshot(JSON.stringify(baselineLibrary))
            setEditorSelectedTriggerId(current => draft.triggers.some(trigger => trigger.id === current) ? current : draft.triggers[0]?.id ?? null)
            setEditorSelectedEventId(draft.events[0]?.id ?? null)
            setEditorEditingEventId(null)
            setEditUndo([])
            setEditRedo([])
            setEditorLevelQuery('')
            setEditorLeftTab('levels')
            setEditorLayer('base')
            setEditorInspectorTab('tiles')
            setEditorSelectedTile(null)
            setEditorTileSelection(null)
            const nextEdit: LevelEditState = { draft, levelId: active.id, library, playLevel: structuredClone(LEVEL), brush: 'baseTile', picked: null }
            editRef.current = nextEdit
            setEdit(nextEdit)
            setMode({ kind: 'none' })
            setSelTurret(null)
            if (LEVEL.mode === 'advance') {
              setViewX(clampViewX(LEVEL.startZone.x + LEVEL.startZone.w / 2 - (size.w / cell) / 2, cell, size.w))
              setViewY(clampViewY(LEVEL.startZone.y + LEVEL.startZone.h / 2 - (size.h / cell) / 2, cell, size.h))
            } else {
              setViewX(0)
              setViewY(LEVEL.rows - VIEW_ROWS)
            }
          }}
        />
        </Suspense>
      )}
    </div>
  )
}
