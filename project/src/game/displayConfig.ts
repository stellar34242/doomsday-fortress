const STORAGE_KEY = 'td-display-config'

export type DisplayResolutionMode = 'adaptive' | 'fixed'

export const DISPLAY_RESOLUTION_PRESETS = [
  { id: '1280x720', width: 1280, height: 720, ratio: '16:9', group: 'PC' },
  { id: '1366x768', width: 1366, height: 768, ratio: '16:9', group: 'PC' },
  { id: '1600x900', width: 1600, height: 900, ratio: '16:9', group: 'PC' },
  { id: '1920x1080', width: 1920, height: 1080, ratio: '16:9', group: 'PC' },
  { id: '2560x1440', width: 2560, height: 1440, ratio: '16:9', group: 'PC' },
  { id: '1920x1200', width: 1920, height: 1200, ratio: '16:10', group: '平板 / PC' },
  { id: '2340x1080', width: 2340, height: 1080, ratio: '19.5:9', group: '手机横屏' },
  { id: '2400x1080', width: 2400, height: 1080, ratio: '20:9', group: '手机横屏' },
] as const

export type DisplayResolutionId = typeof DISPLAY_RESOLUTION_PRESETS[number]['id']

export interface DisplayConfig {
  version: 2
  defaultZoom: number
  minZoom: number
  maxZoom: number
  resolutionMode: DisplayResolutionMode
  referenceResolution: DisplayResolutionId
}

export const DEFAULT_DISPLAY_CONFIG: DisplayConfig = {
  version: 2,
  defaultZoom: 1,
  minZoom: 0.5,
  maxZoom: 2.5,
  resolutionMode: 'adaptive',
  referenceResolution: '1920x1080',
}

export type DisplayConfigKey = keyof Omit<DisplayConfig, 'version'>

export interface DisplayViewportLayout {
  /** Canvas 与 HUD 使用的逻辑像素尺寸。 */
  logicalWidth: number
  logicalHeight: number
  /** 逻辑视口缩放到实际容器时使用的统一倍率。 */
  scale: number
  /** 屏幕中最终占用的 CSS 像素尺寸，不包含黑边。 */
  displayWidth: number
  displayHeight: number
}

const clamp = (value: unknown, min: number, max: number, fallback: number) => {
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback
}

const validResolutionId = (value: unknown): value is DisplayResolutionId =>
  DISPLAY_RESOLUTION_PRESETS.some(preset => preset.id === value)

export function normalizeDisplayConfig(raw: Partial<DisplayConfig>, changed?: DisplayConfigKey): DisplayConfig {
  let minZoom = clamp(raw.minZoom, 0.25, 4, DEFAULT_DISPLAY_CONFIG.minZoom)
  let maxZoom = clamp(raw.maxZoom, 0.25, 4, DEFAULT_DISPLAY_CONFIG.maxZoom)
  if (minZoom > maxZoom) {
    if (changed === 'minZoom') maxZoom = minZoom
    else minZoom = maxZoom
  }
  return {
    version: 2,
    minZoom,
    maxZoom,
    defaultZoom: clamp(raw.defaultZoom, minZoom, maxZoom, DEFAULT_DISPLAY_CONFIG.defaultZoom),
    resolutionMode: raw.resolutionMode === 'fixed' ? 'fixed' : 'adaptive',
    referenceResolution: validResolutionId(raw.referenceResolution) ? raw.referenceResolution : DEFAULT_DISPLAY_CONFIG.referenceResolution,
  }
}

export function displayResolutionPreset(id: DisplayResolutionId) {
  return DISPLAY_RESOLUTION_PRESETS.find(preset => preset.id === id) ?? DISPLAY_RESOLUTION_PRESETS.find(preset => preset.id === DEFAULT_DISPLAY_CONFIG.referenceResolution)!
}

/**
 * 关卡编辑器强制传 forceAdaptive=true；战斗固定模式则以参考分辨率为逻辑画布，
 * 等比完整缩放到可用区域，未占用部分由外层容器保持黑色。
 */
export function resolveDisplayViewport(config: DisplayConfig, availableWidth: number, availableHeight: number, forceAdaptive = false): DisplayViewportLayout {
  const width = Math.max(1, Math.floor(Number(availableWidth) || 1))
  const height = Math.max(1, Math.floor(Number(availableHeight) || 1))
  if (forceAdaptive || config.resolutionMode === 'adaptive') {
    return { logicalWidth: width, logicalHeight: height, scale: 1, displayWidth: width, displayHeight: height }
  }
  const preset = displayResolutionPreset(config.referenceResolution)
  const scale = Math.max(0.01, Math.min(width / preset.width, height / preset.height))
  return {
    logicalWidth: preset.width,
    logicalHeight: preset.height,
    scale,
    displayWidth: preset.width * scale,
    displayHeight: preset.height * scale,
  }
}

function loadDisplayConfig(): DisplayConfig {
  try {
    if (typeof localStorage === 'undefined') return { ...DEFAULT_DISPLAY_CONFIG }
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<DisplayConfig> | null
    return raw ? normalizeDisplayConfig(raw) : { ...DEFAULT_DISPLAY_CONFIG }
  } catch { return { ...DEFAULT_DISPLAY_CONFIG } }
}

let config = loadDisplayConfig()

function save(changed?: DisplayConfigKey) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(config)) } catch { /* 本地存储不可用 */ }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('td-display-config-changed', { detail: { changed } }))
}

export function displayConfig(): DisplayConfig { return config }

/** 导入随项目发布的显示配置，并复用统一归一化规则。 */
export function importDisplayConfig(value: Partial<DisplayConfig> | undefined): void {
  if (!value) return
  config = normalizeDisplayConfig(value)
  save('defaultZoom')
}

export function patchDisplayConfig<K extends DisplayConfigKey>(key: K, value: DisplayConfig[K]): DisplayConfig {
  config = normalizeDisplayConfig({ ...config, [key]: value }, key)
  save(key)
  return config
}

export function resetDisplayConfig(): DisplayConfig {
  config = { ...DEFAULT_DISPLAY_CONFIG }
  save('defaultZoom')
  return config
}
