const STORAGE_KEY = 'td-game-parameters-v1'

export interface PerformanceMonitorOptions {
  /** 总开关：开启后在战斗主界面显示监控浮层，并记录最近 60 秒采样。 */
  enabled: boolean
  fps: boolean
  frameTime: boolean
  drawTime: boolean
  tickTime: boolean
  engineBreakdown: boolean
  sceneCounts: boolean
  spatialIndex: boolean
  hitchCounts: boolean
  history: boolean
  bottleneck: boolean
}

export type PerformanceMonitorItem = Exclude<keyof PerformanceMonitorOptions, 'enabled'>

export type UnitDestructionEffectKey = 'small' | 'medium' | 'large' | 'violent'

export interface UnitDestructionWreckageScalePercent {
  small: number
  medium: number
  large: number
  violent: number
}

export const DEFAULT_PERFORMANCE_MONITOR_OPTIONS: PerformanceMonitorOptions = {
  enabled: false,
  fps: true,
  frameTime: true,
  drawTime: true,
  tickTime: true,
  engineBreakdown: true,
  sceneCounts: true,
  spatialIndex: false,
  hitchCounts: true,
  history: true,
  bottleneck: true,
}

export interface GameParameters {
  version: 8
  /** DEBUG 覆盖：不改写玩家进度，开启期间所有可解锁内容均视为已解锁。 */
  unlockAll: boolean
  /** 玩家当前控制战车的基础自然散热（点/s）；散热模块在此基础上额外叠加。 */
  naturalHeatDissipation: number
  /** 仅控制“击穿”战斗飘字；穿甲火花与弹丸库命中特效始终保留。 */
  showPenetrationFx: boolean
  /** 仅控制“跳弹”战斗飘字；跳弹亮线、火花与碎屑始终保留。 */
  showRicochetFx: boolean
  /** 仅控制冲撞战斗飘字；冲撞火花、碰撞、分离、伤害与音效始终保留。 */
  showRammingFx: boolean
  /** 是否绘制战场内单位头顶的结构血条；不影响左上角主控战车状态 HUD。 */
  showUnitHealthBars: boolean
  /** 是否绘制战场和关卡编辑器内全部单位、物体及其幽灵预览的地面阴影。 */
  showEntityShadows: boolean
  /** 是否启用战斗中的两层共享视野遮罩；关卡编辑器始终不显示。 */
  battleVisionEnabled: boolean
  /** 玩家主控、玩家阵营单位与友方单位共用的单个视野源半径（米）。 */
  playerVisionMeters: number
  /** 单位摧毁时 fx_Wreckage 四档残骸贴图的缩放百分比。 */
  unitDestructionWreckageScalePercent: UnitDestructionWreckageScalePercent
  /** 战斗主界面的性能监控显示与分项开关。 */
  performanceMonitor: PerformanceMonitorOptions
}

export const DEFAULT_GAME_PARAMETERS: GameParameters = {
  version: 8,
  unlockAll: false,
  naturalHeatDissipation: 10,
  showPenetrationFx: true,
  showRicochetFx: true,
  showRammingFx: true,
  showUnitHealthBars: true,
  showEntityShadows: true,
  battleVisionEnabled: true,
  playerVisionMeters: 64,
  unitDestructionWreckageScalePercent: {
    small: 50,
    medium: 100,
    large: 150,
    violent: 180,
  },
  performanceMonitor: { ...DEFAULT_PERFORMANCE_MONITOR_OPTIONS },
}

function normalizedWreckageScalePercent(value: unknown, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(10, Math.min(400, parsed)) : fallback
}

function defaultGameParameters(): GameParameters {
  return {
    ...DEFAULT_GAME_PARAMETERS,
    unitDestructionWreckageScalePercent: { ...DEFAULT_GAME_PARAMETERS.unitDestructionWreckageScalePercent },
    performanceMonitor: { ...DEFAULT_GAME_PARAMETERS.performanceMonitor },
  }
}

function loadGameParameters(): GameParameters {
  try {
    if (typeof localStorage === 'undefined') return defaultGameParameters()
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<GameParameters> | null
    const monitor = raw?.performanceMonitor as Partial<PerformanceMonitorOptions> | undefined
    const wreckageScale = raw?.unitDestructionWreckageScalePercent as Partial<UnitDestructionWreckageScalePercent> | undefined
    const naturalHeatDissipation = Number(raw?.naturalHeatDissipation)
    const storedVersion = Number(raw?.version)
    const storedPlayerVisionMeters = Number(raw?.playerVisionMeters)
    const normalized: GameParameters = {
      version: 8,
      unlockAll: raw?.unlockAll === true,
      naturalHeatDissipation: Number.isFinite(naturalHeatDissipation)
        ? Math.max(0, Math.min(1000, naturalHeatDissipation))
        : DEFAULT_GAME_PARAMETERS.naturalHeatDissipation,
      showPenetrationFx: raw?.showPenetrationFx !== false,
      showRicochetFx: raw?.showRicochetFx !== false,
      showRammingFx: raw?.showRammingFx !== false,
      showUnitHealthBars: raw?.showUnitHealthBars !== false,
      showEntityShadows: raw?.showEntityShadows !== false,
      battleVisionEnabled: raw?.battleVisionEnabled !== false,
      playerVisionMeters: storedVersion >= 7 && Number.isFinite(storedPlayerVisionMeters)
        ? Math.max(3.2, Math.min(960, storedPlayerVisionMeters))
        : DEFAULT_GAME_PARAMETERS.playerVisionMeters,
      unitDestructionWreckageScalePercent: {
        small: normalizedWreckageScalePercent(wreckageScale?.small, DEFAULT_GAME_PARAMETERS.unitDestructionWreckageScalePercent.small),
        medium: normalizedWreckageScalePercent(wreckageScale?.medium, DEFAULT_GAME_PARAMETERS.unitDestructionWreckageScalePercent.medium),
        large: normalizedWreckageScalePercent(wreckageScale?.large, DEFAULT_GAME_PARAMETERS.unitDestructionWreckageScalePercent.large),
        violent: normalizedWreckageScalePercent(wreckageScale?.violent, DEFAULT_GAME_PARAMETERS.unitDestructionWreckageScalePercent.violent),
      },
      performanceMonitor: {
        ...DEFAULT_PERFORMANCE_MONITOR_OPTIONS,
        ...(monitor ?? {}),
        enabled: monitor?.enabled === true,
      },
    }
    if (storedVersion < 8) localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized))
    return normalized
  } catch { return defaultGameParameters() }
}

let parameters = loadGameParameters()

function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(parameters)) } catch { /* 本地存储不可用 */ }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('td-game-parameters-changed', { detail: { ...parameters } }))
}

export function gameParameters(): GameParameters { return parameters }

/** 导入随项目发布的游戏参数，并沿用现有迁移与范围校验。 */
export function importGameParameters(value: Partial<GameParameters> | undefined): void {
  if (!value) return
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
    parameters = loadGameParameters()
    save()
  } catch { /* 无本地存储时保持当前参数 */ }
}

export function setUnlockAll(enabled: boolean): GameParameters {
  parameters = { ...parameters, unlockAll: enabled }
  save()
  return parameters
}

export function setNaturalHeatDissipation(value: number): GameParameters {
  if (!Number.isFinite(value)) return parameters
  parameters = { ...parameters, naturalHeatDissipation: Math.max(0, Math.min(1000, value)) }
  save()
  return parameters
}

export function setHitFxVisibility(key: 'showPenetrationFx' | 'showRicochetFx' | 'showRammingFx', enabled: boolean): GameParameters {
  parameters = { ...parameters, [key]: enabled }
  save()
  return parameters
}

export function setUnitHealthBarsVisible(enabled: boolean): GameParameters {
  parameters = { ...parameters, showUnitHealthBars: enabled }
  save()
  return parameters
}

export function setEntityShadowsVisible(enabled: boolean): GameParameters {
  parameters = { ...parameters, showEntityShadows: enabled }
  save()
  return parameters
}

export function setBattleVisionEnabled(enabled: boolean): GameParameters {
  parameters = { ...parameters, battleVisionEnabled: enabled }
  save()
  return parameters
}

export function setPlayerVisionMeters(value: number): GameParameters {
  if (!Number.isFinite(value)) return parameters
  parameters = { ...parameters, playerVisionMeters: Math.max(3.2, Math.min(960, value)) }
  save()
  return parameters
}

export function setUnitDestructionWreckageScalePercent(key: UnitDestructionEffectKey, value: number): GameParameters {
  if (!Number.isFinite(value)) return parameters
  parameters = {
    ...parameters,
    unitDestructionWreckageScalePercent: {
      ...parameters.unitDestructionWreckageScalePercent,
      [key]: normalizedWreckageScalePercent(value, parameters.unitDestructionWreckageScalePercent[key]),
    },
  }
  save()
  return parameters
}

export function setPerformanceMonitorEnabled(enabled: boolean): GameParameters {
  parameters = { ...parameters, performanceMonitor: { ...parameters.performanceMonitor, enabled } }
  save()
  return parameters
}

export function setPerformanceMonitorItem(key: PerformanceMonitorItem, enabled: boolean): GameParameters {
  parameters = { ...parameters, performanceMonitor: { ...parameters.performanceMonitor, [key]: enabled } }
  save()
  return parameters
}
