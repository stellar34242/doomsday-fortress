import { audioManager, type AudioChannel } from './audio'
import { filterAssets, MECH_FOOTSTEP_ASSET_ID, UI_BUTTON_CLICK_ASSET_ID } from './assetlib'

const STORAGE_KEY = 'td-audio-config'

export type GlobalBgmSlot = 'missionSelect' | 'victory' | 'defeat'
export type AutoSoundChannel = Exclude<AudioChannel, 'preview'>
export type GlobalCueSlot =
  | 'uiClick' | 'uiConfirm' | 'uiCancel' | 'uiError'
  | 'taskNotice' | 'taskComplete' | 'reward'
  | 'shieldSpawn' | 'shieldHit' | 'shieldBreak'
  | 'vehicleCollision' | 'crush' | 'objectInteract'
  | 'unitDeath'

export interface SoundPresetAsset { assetId: string; weight: number }
export interface SoundPreset {
  id: string
  name: string
  assets: SoundPresetAsset[]
  channel: AudioChannel
  volume: number
  pitchMin: number
  pitchMax: number
  loop: boolean
  cooldown: number
  maxVoices: number
  maxDistance: number
}

export interface AudioProjectConfig {
  version: 1
  bgm: Record<GlobalBgmSlot, string>
  cues: Record<GlobalCueSlot, string>
  presets: SoundPreset[]
}

export const GLOBAL_BGM_LABELS: Record<GlobalBgmSlot, string> = {
  missionSelect: '关卡选择/任务介绍', victory: '胜利结算', defeat: '失败结算',
}

export const GLOBAL_CUE_LABELS: Record<GlobalCueSlot, string> = {
  uiClick: 'UI 点击', uiConfirm: 'UI 确认', uiCancel: 'UI 取消', uiError: 'UI 错误',
  taskNotice: '任务提示', taskComplete: '目标完成', reward: '获得奖励',
  shieldSpawn: '护盾生成', shieldHit: '护盾受击', shieldBreak: '护盾破裂',
  vehicleCollision: '载具碰撞', crush: '碾压', objectInteract: '物体交互',
  unitDeath: '单位毁灭',
}

const bgmSlots = Object.keys(GLOBAL_BGM_LABELS) as GlobalBgmSlot[]
const cueSlots = Object.keys(GLOBAL_CUE_LABELS) as GlobalCueSlot[]
const emptyRecord = <K extends string>(keys: K[]) => Object.fromEntries(keys.map(key => [key, ''])) as Record<K, string>
export const UI_BUTTON_CLICK_PRESET_ID = 'builtin:ui/button_click'
export const MECH_FOOTSTEP_PRESET_ID = 'builtin:unit/mech_footstep'
const REMOVED_TRACKED_MOVE_PRESET_ID = 'builtin:movement/tracked'

const defaultUiClickPreset = (): SoundPreset => ({
  id: UI_BUTTON_CLICK_PRESET_ID,
  name: 'switch_button',
  assets: [{ assetId: UI_BUTTON_CLICK_ASSET_ID, weight: 1 }],
  channel: 'ui',
  volume: 0.55,
  pitchMin: 0.97,
  pitchMax: 1.03,
  loop: false,
  cooldown: 0.025,
  maxVoices: 4,
  maxDistance: 0,
})

const defaultMechFootstepPreset = (): SoundPreset => ({
  id: MECH_FOOTSTEP_PRESET_ID,
  name: 'mech_footstep_01',
  assets: [{ assetId: MECH_FOOTSTEP_ASSET_ID, weight: 1 }],
  channel: 'unit',
  volume: 0.78,
  pitchMin: 0.94,
  pitchMax: 1.06,
  loop: false,
  cooldown: 0.055,
  maxVoices: 8,
  maxDistance: 24,
})

export const isBuiltinSoundPresetId = (id: string): boolean => id === UI_BUTTON_CLICK_PRESET_ID || id === MECH_FOOTSTEP_PRESET_ID

const defaults = (): AudioProjectConfig => {
  const cues = emptyRecord(cueSlots)
  cues.uiClick = UI_BUTTON_CLICK_PRESET_ID
  return { version: 1, bgm: emptyRecord(bgmSlots), cues, presets: [defaultUiClickPreset(), defaultMechFootstepPreset()] }
}
let config = defaults()

const clamp = (value: unknown, min: number, max: number, fallback: number) => {
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback
}

function normalizePreset(raw: Partial<SoundPreset>, index: number): SoundPreset {
  const validAssets = new Set(filterAssets('se').map(asset => asset.id))
  return {
    id: String(raw.id ?? `sound-${index + 1}`).trim().slice(0, 80) || `sound-${index + 1}`,
    name: String(raw.name ?? `声音预设 ${index + 1}`).trim().slice(0, 60) || `声音预设 ${index + 1}`,
    assets: (Array.isArray(raw.assets) ? raw.assets : []).map(item => ({ assetId: String(item?.assetId ?? ''), weight: clamp(item?.weight, 0.01, 100, 1) })).filter(item => validAssets.has(item.assetId)).slice(0, 8),
    channel: ['ui', 'unit', 'weapon', 'environment', 'preview'].includes(String(raw.channel)) ? raw.channel as AudioChannel : 'weapon',
    volume: clamp(raw.volume, 0, 1, 1), pitchMin: clamp(raw.pitchMin, 0.5, 2, 1), pitchMax: clamp(raw.pitchMax, 0.5, 2, 1),
    loop: raw.loop === true, cooldown: clamp(raw.cooldown, 0, 60, 0), maxVoices: Math.round(clamp(raw.maxVoices, 1, 32, 4)), maxDistance: clamp(raw.maxDistance, 0, 200, 24),
  }
}

function load() {
  try {
    if (typeof localStorage === 'undefined') return
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<AudioProjectConfig> | null
    if (!raw) return
    const next = defaults()
    for (const key of bgmSlots) next.bgm[key] = typeof raw.bgm?.[key] === 'string' ? raw.bgm[key] : ''
    const presets = (Array.isArray(raw.presets) ? raw.presets : []).map(normalizePreset)
      // 已删除的内置“履带持续行驶”不再从既有本地配置恢复。
      .filter(preset => preset.id !== REMOVED_TRACKED_MOVE_PRESET_ID)
      // 内置按钮音效更名后同步既有本地配置；保留稳定 ID 和用户调整过的播放参数。
      .map(preset => preset.id === UI_BUTTON_CLICK_PRESET_ID ? { ...preset, name: 'switch_button' } : preset)
      // 自动预设名称跟随素材库；素材重命名不会改变预设 ID、参数或炮塔引用。
      .map(preset => {
        const asset = preset.id.startsWith('auto:') && preset.assets.length === 1
          ? filterAssets('se').find(item => item.id === preset.assets[0]?.assetId)
          : undefined
        return asset ? { ...preset, name: asset.name } : preset
      })
      .filter(preset => !preset.id.startsWith('quick:') || preset.assets.length > 0)
    if (!presets.some(preset => preset.id === UI_BUTTON_CLICK_PRESET_ID)) presets.unshift(defaultUiClickPreset())
    if (!presets.some(preset => preset.id === MECH_FOOTSTEP_PRESET_ID)) presets.push(defaultMechFootstepPreset())
    const ids = new Set<string>()
    next.presets = presets.filter(preset => !ids.has(preset.id) && !!ids.add(preset.id))
    const validPresetIds = new Set(next.presets.map(preset => preset.id))
    for (const key of cueSlots) {
      const value = typeof raw.cues?.[key] === 'string' ? raw.cues[key] : ''
      next.cues[key] = value === 'none' || validPresetIds.has(value) ? value : next.cues[key]
    }
    config = next
  } catch { config = defaults() }
}
load()

function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(config)) } catch { /* 本地存储不可用 */ }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('td-audio-config-changed'))
}

export function audioProjectConfig(): AudioProjectConfig { return config }
export function saveAudioProjectConfig(): void { save() }
/** 导入项目级声音配置；素材库必须先完成导入，才能保留预设里的素材引用。 */
export function importAudioProjectConfig(value: Partial<AudioProjectConfig> | undefined): void {
  if (!value) return
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
    load()
    save()
  } catch { /* 无本地存储时保持当前配置 */ }
}
export function patchGlobalBgm(slot: GlobalBgmSlot, assetId: string): void { config.bgm[slot] = assetId; save() }
export function patchGlobalCue(slot: GlobalCueSlot, presetId: string): void { config.cues[slot] = presetId; save() }
export function saveSoundPreset(preset: SoundPreset): void {
  const normalized = normalizePreset(preset, config.presets.length)
  const index = config.presets.findIndex(item => item.id === normalized.id)
  if (index >= 0) config.presets.splice(index, 1, normalized); else config.presets.push(normalized)
  save()
}
export function createSoundPreset(): SoundPreset {
  let index = config.presets.length + 1
  while (config.presets.some(item => item.id === `sound-${index}`)) index++
  const preset = normalizePreset({ id: `sound-${index}`, name: `声音预设 ${index}`, channel: 'weapon' }, index - 1)
  config.presets.push(preset); save(); return preset
}
const AUTO_SOUND_DEFAULTS: Record<AutoSoundChannel, Pick<SoundPreset, 'volume' | 'pitchMin' | 'pitchMax' | 'cooldown' | 'maxVoices' | 'maxDistance'>> = {
  ui: { volume: 0.7, pitchMin: 0.98, pitchMax: 1.02, cooldown: 0.03, maxVoices: 4, maxDistance: 0 },
  unit: { volume: 0.85, pitchMin: 0.95, pitchMax: 1.05, cooldown: 0.04, maxVoices: 6, maxDistance: 24 },
  weapon: { volume: 0.9, pitchMin: 0.96, pitchMax: 1.04, cooldown: 0.03, maxVoices: 8, maxDistance: 36 },
  environment: { volume: 0.85, pitchMin: 0.95, pitchMax: 1.05, cooldown: 0.05, maxVoices: 6, maxDistance: 30 },
}

/** 前台只选择一个 SE 素材（内置或上传）；其余播放参数按使用通道在后台生成。 */
export function autoSoundPreset(assetId: string, options: { channel: AutoSoundChannel; loop?: boolean }): SoundPreset | undefined {
  const asset = filterAssets('se').find(item => item.id === assetId)
  if (!asset) return undefined
  const loop = options.loop === true
  const reusable = config.presets.find(item => item.id.startsWith('auto:') && item.channel === options.channel && item.loop === loop && item.assets.length === 1 && item.assets[0]?.assetId === assetId)
  if (reusable) return reusable
  const id = `auto:${options.channel}:${loop ? 'loop' : 'shot'}:${assetId}`.slice(0, 80)
  const existing = config.presets.find(item => item.id === id)
  if (existing) return existing
  const defaults = AUTO_SOUND_DEFAULTS[options.channel]
  const preset = normalizePreset({
    id,
    name: asset.name,
    assets: [{ assetId, weight: 1 }],
    channel: options.channel,
    ...defaults,
    loop,
    cooldown: loop ? 0 : defaults.cooldown,
  }, config.presets.length)
  config.presets.push(preset)
  save()
  return preset
}

export function globalCueAutoOptions(slot: GlobalCueSlot): { channel: AutoSoundChannel; loop: boolean } {
  if (slot.startsWith('ui') || slot === 'taskNotice' || slot === 'taskComplete' || slot === 'reward') return { channel: 'ui', loop: false }
  if (slot === 'unitDeath') return { channel: 'unit', loop: false }
  return { channel: 'environment', loop: false }
}

/** @deprecated 兼容旧调用；新界面统一使用 autoSoundPreset。 */
export function quickSoundPreset(slot: GlobalCueSlot, assetId: string): SoundPreset | undefined {
  return autoSoundPreset(assetId, globalCueAutoOptions(slot))
}
export function deleteSoundPreset(id: string): boolean {
  if (isBuiltinSoundPresetId(id)) return false
  const index = config.presets.findIndex(item => item.id === id)
  if (index < 0) return false
  config.presets.splice(index, 1)
  for (const key of cueSlots) if (config.cues[key] === id) config.cues[key] = ''
  save(); return true
}
export function soundPreset(id: string | undefined): SoundPreset | undefined { return id && id !== 'none' ? config.presets.find(item => item.id === id) : undefined }
export function resolveCue(override: string | undefined, fallback?: GlobalCueSlot): string | undefined {
  if (override === 'none') return undefined
  if (override && soundPreset(override)) return override
  return fallback ? soundPreset(config.cues[fallback])?.id : undefined
}

/**
 * 移动/发动机声音只读取单位自身配置，并且必须引用循环预设。
 * 旧存档中的 `none`、已删除预设或早期单次预设统一视为未配置。
 */
export function resolveMovementCue(override: string | undefined): string | undefined {
  const overridePreset = override && override !== 'none' ? soundPreset(override) : undefined
  return overridePreset?.loop ? overridePreset.id : undefined
}

/** 预热声音预设的全部候选素材，避免第一次随机命中某个候选时才读取与解码。 */
export async function prewarmSoundPresets(presetIds: Iterable<string | undefined>, directAssets: Iterable<string | undefined> = []): Promise<void> {
  const assets = new Set<string>()
  for (const presetId of presetIds) for (const item of soundPreset(presetId)?.assets ?? []) if (item.assetId) assets.add(item.assetId)
  for (const assetId of directAssets) if (assetId) assets.add(assetId)
  await Promise.all([...assets].map(assetId => audioManager.preload(assetId)))
}

const lastPlayed = new Map<string, number>()
const voiceCounts = new Map<string, number>()
const activeLoopPresets = new Map<string, string>()
/** 射线起射声与持续循环声之间的固定衔接延迟。 */
export const BEAM_CONTINUOUS_AUDIO_DELAY = 0.1

function chooseAsset(preset: SoundPreset): string | undefined {
  const candidates = preset.assets.filter(item => !!item.assetId && item.weight > 0)
  const total = candidates.reduce((sum, item) => sum + item.weight, 0)
  if (total <= 0) return undefined
  let roll = Math.random() * total
  for (const item of candidates) { roll -= item.weight; if (roll <= 0) return item.assetId }
  return candidates[candidates.length - 1]?.assetId
}

export async function playCue(presetId: string | undefined, options: { volumeScale?: number; pitchScale?: number; distance?: number } = {}): Promise<boolean> {
  const preset = soundPreset(presetId)
  if (!preset || preset.loop) return false
  const now = performance.now() / 1000
  if (now - (lastPlayed.get(preset.id) ?? -Infinity) < preset.cooldown || (voiceCounts.get(preset.id) ?? 0) >= preset.maxVoices) return false
  const assetId = chooseAsset(preset)
  if (!assetId) return false
  const distanceGain = preset.maxDistance <= 0 || options.distance === undefined ? 1 : Math.max(0, 1 - options.distance / preset.maxDistance)
  if (distanceGain <= 0) return false
  lastPlayed.set(preset.id, now)
  voiceCounts.set(preset.id, (voiceCounts.get(preset.id) ?? 0) + 1)
  const pitch = (preset.pitchMin + Math.random() * Math.max(0, preset.pitchMax - preset.pitchMin)) * (options.pitchScale ?? 1)
  const played = await audioManager.playSE(assetId, {
    channel: preset.channel, volume: preset.volume * (options.volumeScale ?? 1) * distanceGain, playbackRate: pitch,
    onEnded: () => voiceCounts.set(preset.id, Math.max(0, (voiceCounts.get(preset.id) ?? 1) - 1)),
  })
  if (!played) voiceCounts.set(preset.id, Math.max(0, (voiceCounts.get(preset.id) ?? 1) - 1))
  return played
}

export async function startCueLoop(entityId: string, presetId: string | undefined, volumeScale = 1, distance?: number, fadeIn = 0): Promise<boolean> {
  stopCueLoop(entityId)
  const preset = soundPreset(presetId)
  const assetId = preset ? chooseAsset(preset) : undefined
  if (!preset || !preset.loop || !assetId) return false
  const distanceGain = preset.maxDistance <= 0 || distance === undefined ? 1 : Math.max(0, 1 - distance / preset.maxDistance)
  if (distanceGain <= 0 || (voiceCounts.get(preset.id) ?? 0) >= preset.maxVoices) return false
  const pitch = preset.pitchMin + Math.random() * Math.max(0, preset.pitchMax - preset.pitchMin)
  voiceCounts.set(preset.id, (voiceCounts.get(preset.id) ?? 0) + 1)
  activeLoopPresets.set(entityId, preset.id)
  const started = await audioManager.startLoop(entityId, assetId, { channel: preset.channel, volume: preset.volume * volumeScale * distanceGain, playbackRate: pitch, fadeIn })
  if (!started && activeLoopPresets.get(entityId) === preset.id) {
    activeLoopPresets.delete(entityId)
    voiceCounts.set(preset.id, Math.max(0, (voiceCounts.get(preset.id) ?? 1) - 1))
  }
  return started
}

/**
 * 同时核对配置层和音频运行时，避免素材替换、浏览器解锁竞态等情况留下
 * “配置层认为已启动、底层实际没有声音”的失效循环。
 */
export function isCueLoopActive(entityId: string, presetId: string | undefined): boolean {
  return !!presetId && activeLoopPresets.get(entityId) === presetId && audioManager.hasLoop(entityId)
}

export function stopCueLoop(entityId: string, fadeOut = 0): void {
  const presetId = activeLoopPresets.get(entityId)
  if (presetId) voiceCounts.set(presetId, Math.max(0, (voiceCounts.get(presetId) ?? 1) - 1))
  activeLoopPresets.delete(entityId)
  audioManager.stopLoop(entityId, { fadeOut })
}

/** 保持循环声连续播放，仅更新该实体的实际音量。 */
export function setCueLoopVolume(entityId: string, presetId: string | undefined, volumeScale = 1, distance?: number, ramp = 0.06): void {
  const preset = soundPreset(presetId)
  if (!preset || activeLoopPresets.get(entityId) !== preset.id) return
  const distanceGain = preset.maxDistance <= 0 || distance === undefined ? 1 : Math.max(0, 1 - distance / preset.maxDistance)
  audioManager.setLoopVolume(entityId, preset.volume * Math.max(0, volumeScale) * distanceGain, ramp)
}

if (typeof window !== 'undefined') {
  const audioWindow = window as Window & { __tdAudioConfigCleanupBound?: boolean }
  if (!audioWindow.__tdAudioConfigCleanupBound) {
    audioWindow.__tdAudioConfigCleanupBound = true
    window.addEventListener('td-audio-asset-removed', event => {
      const assetId = (event as CustomEvent<string>).detail
      if (!assetId) return
      let changed = false
      for (const slot of bgmSlots) if (config.bgm[slot] === assetId) { config.bgm[slot] = ''; changed = true }
      for (const preset of config.presets) {
        const assets = preset.assets.filter(item => item.assetId !== assetId)
        if (assets.length !== preset.assets.length) { preset.assets = assets; changed = true }
      }
      if (changed) save()
    })
  }
}
