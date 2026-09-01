import { ASSET_REPLACED_EVENT, audioAssetObjectUrl, getAsset, isAudioAsset } from './assetlib'

const SETTINGS_KEY = 'td-audio-settings'
const ASSET_REMOVED_EVENT = 'td-audio-asset-removed'

export type AudioChannel = 'ui' | 'unit' | 'weapon' | 'environment' | 'preview'

export interface AudioSettings {
  master: number
  bgm: number
  se: number
}

export interface MusicOptions {
  loop?: boolean
  volume?: number
  fadeIn?: number
  owner?: string
}

export interface SoundOptions {
  channel?: AudioChannel
  volume?: number
  loop?: boolean
  playbackRate?: number
  fadeIn?: number
  onEnded?: () => void
}

interface ActiveSource {
  source: AudioBufferSourceNode
  gain: GainNode
  ref: string
}

interface DesiredMusic {
  ref: string
  options: MusicOptions
  requestId: number
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 1))

function loadSettings(): AudioSettings {
  const defaults: AudioSettings = { master: 1, bgm: 0.7, se: 0.8 }
  try {
    if (typeof localStorage === 'undefined') return defaults
    const parsed = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as Partial<AudioSettings>
    return {
      master: clamp01(Number(parsed.master ?? defaults.master)),
      bgm: clamp01(Number(parsed.bgm ?? defaults.bgm)),
      se: clamp01(Number(parsed.se ?? defaults.se)),
    }
  } catch { return defaults }
}

/**
 * 全局唯一音频运行时。
 * BGM、一次性 SE、实体循环声和素材试听共用同一 AudioContext 与音量总线。
 */
class AudioManager {
  private context: AudioContext | null = null
  private masterGain: GainNode | null = null
  private musicGain: GainNode | null = null
  private seGain: GainNode | null = null
  private channelGains = new Map<AudioChannel, GainNode>()
  private buffers = new Map<string, Promise<AudioBuffer>>()
  private music: (ActiveSource & { owner?: string }) | null = null
  private desiredMusic: DesiredMusic | null = null
  private loops = new Map<string, ActiveSource>()
  /** 正在读取/解码、尚未挂入 loops 的循环。用于避免渲染帧反复取消同一次启动。 */
  private pendingLoops = new Set<string>()
  private loopRequestIds = new Map<string, number>()
  private preview: ActiveSource | null = null
  private previewRequestId = 0
  private settings = loadSettings()
  private unlocked = false
  private gamePaused = false
  private hiddenPaused = false
  private requestSeq = 0

  constructor() {
    if (typeof window === 'undefined') return
    const unlock = () => { void this.unlock() }
    window.addEventListener('pointerdown', unlock, { capture: true })
    window.addEventListener('keydown', unlock, { capture: true })
    window.addEventListener('touchstart', unlock, { capture: true })
    document.addEventListener('visibilitychange', () => {
      this.hiddenPaused = document.hidden
      void this.syncContextState()
    })
    window.addEventListener(ASSET_REMOVED_EVENT, event => {
      const id = (event as CustomEvent<string>).detail
      if (id) this.clearAsset(id)
    })
    window.addEventListener(ASSET_REPLACED_EVENT, event => {
      const id = (event as CustomEvent<string>).detail
      if (id) this.clearAsset(id)
    })
  }

  private ensureContext(): AudioContext | null {
    if (this.context || typeof window === 'undefined') return this.context
    try {
      this.context = new AudioContext()
      this.masterGain = this.context.createGain()
      this.musicGain = this.context.createGain()
      this.seGain = this.context.createGain()
      this.musicGain.connect(this.masterGain)
      this.seGain.connect(this.masterGain)
      this.masterGain.connect(this.context.destination)
      for (const channel of ['ui', 'unit', 'weapon', 'environment', 'preview'] as AudioChannel[]) {
        const gain = this.context.createGain()
        gain.connect(this.seGain)
        this.channelGains.set(channel, gain)
      }
      this.applySettings()
    } catch { this.context = null }
    return this.context
  }

  private applySettings() {
    if (!this.context) return
    const now = this.context.currentTime
    this.masterGain?.gain.setValueAtTime(this.settings.master, now)
    this.musicGain?.gain.setValueAtTime(this.settings.bgm, now)
    this.seGain?.gain.setValueAtTime(this.settings.se, now)
  }

  getSettings(): AudioSettings { return { ...this.settings } }

  setSettings(patch: Partial<AudioSettings>): AudioSettings {
    this.settings = {
      master: clamp01(patch.master ?? this.settings.master),
      bgm: clamp01(patch.bgm ?? this.settings.bgm),
      se: clamp01(patch.se ?? this.settings.se),
    }
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings)) } catch { /* 无存储环境 */ }
    this.applySettings()
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('td-audio-settings-changed', { detail: this.getSettings() }))
    return this.getSettings()
  }

  async unlock(): Promise<boolean> {
    const context = this.ensureContext()
    if (!context) return false
    try {
      if (context.state === 'suspended' && !this.gamePaused && !this.hiddenPaused) await context.resume()
      this.unlocked = true
      const desired = this.desiredMusic
      if (desired && !this.music) void this.startDesiredMusic(desired)
      return true
    } catch { return false }
  }

  private async audioData(ref: string): Promise<ArrayBuffer> {
    const asset = getAsset(ref)
    if (asset && !isAudioAsset(asset)) throw new Error('所选素材不是音频')
    const source = asset ? await audioAssetObjectUrl(asset) : { url: ref, revoke: false }
    try {
      const response = await fetch(source.url)
      if (!response.ok) throw new Error(`音频读取失败（${response.status}）`)
      return await response.arrayBuffer()
    } finally {
      if (source.revoke) URL.revokeObjectURL(source.url)
    }
  }

  private buffer(ref: string): Promise<AudioBuffer> {
    const cached = this.buffers.get(ref)
    if (cached) return cached
    const context = this.ensureContext()
    if (!context) return Promise.reject(new Error('当前环境不支持音频播放'))
    const promise = this.audioData(ref).then(data => context.decodeAudioData(data.slice(0))).catch(error => {
      this.buffers.delete(ref)
      throw error
    })
    this.buffers.set(ref, promise)
    return promise
  }

  /** 只读取并解码到全局缓存，不创建音源；任务介绍阶段用于预热本关音频。 */
  async preload(ref: string): Promise<boolean> {
    if (!ref) return false
    try {
      await this.buffer(ref)
      return true
    } catch { return false }
  }

  private stopSource(active: ActiveSource | null, fadeOut = 0) {
    if (!active || !this.context) return
    const now = this.context.currentTime
    try {
      active.gain.gain.cancelScheduledValues(now)
      if (fadeOut > 0) {
        active.gain.gain.setValueAtTime(active.gain.gain.value, now)
        active.gain.gain.linearRampToValueAtTime(0, now + fadeOut)
        active.source.stop(now + fadeOut)
      } else active.source.stop()
    } catch { /* 已停止 */ }
  }

  async playMusic(ref: string, options: MusicOptions = {}): Promise<boolean> {
    if (!ref) { this.stopMusic(); return false }
    const desired: DesiredMusic = { ref, options, requestId: ++this.requestSeq }
    this.desiredMusic = desired
    if (!this.unlocked || this.gamePaused || this.hiddenPaused) return false
    return this.startDesiredMusic(desired)
  }

  private async startDesiredMusic(desired: DesiredMusic): Promise<boolean> {
    try {
      const context = this.ensureContext()
      if (!context) return false
      const buffer = await this.buffer(desired.ref)
      if (this.desiredMusic?.requestId !== desired.requestId || this.gamePaused || this.hiddenPaused) return false
      this.stopSource(this.music, 0.08)
      const source = context.createBufferSource()
      const gain = context.createGain()
      source.buffer = buffer
      source.loop = desired.options.loop ?? true
      source.connect(gain)
      gain.connect(this.musicGain!)
      const target = clamp01(desired.options.volume ?? 1)
      const fadeIn = Math.max(0, desired.options.fadeIn ?? 0)
      gain.gain.setValueAtTime(fadeIn > 0 ? 0 : target, context.currentTime)
      if (fadeIn > 0) gain.gain.linearRampToValueAtTime(target, context.currentTime + fadeIn)
      const active = { source, gain, ref: desired.ref, owner: desired.options.owner }
      this.music = active
      source.onended = () => { if (this.music === active) this.music = null }
      source.start()
      return true
    } catch {
      return false
    }
  }

  stopMusic(options: { fadeOut?: number; owner?: string } = {}) {
    if (options.owner && this.desiredMusic?.options.owner !== options.owner && this.music?.owner !== options.owner) return
    this.desiredMusic = null
    this.requestSeq++
    this.stopSource(this.music, Math.max(0, options.fadeOut ?? 0))
    this.music = null
  }

  async playSE(ref: string, options: SoundOptions = {}): Promise<boolean> {
    // 解锁前的一次性声音不排队，避免首次操作后补放一串过期音效。
    if (!ref || !this.unlocked || this.gamePaused || this.hiddenPaused) return false
    try {
      const context = this.ensureContext()
      if (!context) return false
      const buffer = await this.buffer(ref)
      if (this.gamePaused || this.hiddenPaused) return false
      const source = context.createBufferSource()
      const gain = context.createGain()
      source.buffer = buffer
      source.loop = options.loop ?? false
      const playbackRate = Math.max(0.25, Math.min(4, options.playbackRate ?? 1))
      source.playbackRate.value = playbackRate
      gain.gain.value = clamp01(options.volume ?? 1)
      source.connect(gain)
      gain.connect(this.channelGains.get(options.channel ?? 'ui') ?? this.seGain!)
      source.onended = options.onEnded ?? null
      source.start()
      return true
    } catch { return false }
  }

  async startLoop(entityId: string, ref: string, options: Omit<SoundOptions, 'loop' | 'onEnded'> = {}): Promise<boolean> {
    this.stopLoop(entityId)
    const requestId = (this.loopRequestIds.get(entityId) ?? 0) + 1
    this.loopRequestIds.set(entityId, requestId)
    if (!ref || this.gamePaused || this.hiddenPaused) return false
    this.pendingLoops.add(entityId)
    try {
      // 循环声可能由“速度从 0 变为正数”触发，并不保证此前已有一次性 SE/BGM 完成解锁。
      // 先标记为正在启动，避免渲染帧在解锁期间重复创建请求。
      if (!this.unlocked && !await this.unlock()) return false
      if (this.loopRequestIds.get(entityId) !== requestId || this.gamePaused || this.hiddenPaused) return false
      const context = this.ensureContext()
      if (!context) return false
      const buffer = await this.buffer(ref)
      if (this.loopRequestIds.get(entityId) !== requestId || this.loops.has(entityId) || this.gamePaused || this.hiddenPaused) return false
      const source = context.createBufferSource()
      const gain = context.createGain()
      source.buffer = buffer
      source.loop = true
      source.playbackRate.value = Math.max(0.25, Math.min(4, options.playbackRate ?? 1))
      const target = clamp01(options.volume ?? 1)
      const fadeIn = Math.max(0, options.fadeIn ?? 0)
      gain.gain.setValueAtTime(fadeIn > 0 ? 0 : target, context.currentTime)
      if (fadeIn > 0) gain.gain.linearRampToValueAtTime(target, context.currentTime + fadeIn)
      source.connect(gain)
      gain.connect(this.channelGains.get(options.channel ?? 'unit') ?? this.seGain!)
      const active = { source, gain, ref }
      this.loops.set(entityId, active)
      source.onended = () => { if (this.loops.get(entityId) === active) this.loops.delete(entityId) }
      source.start()
      return true
    } catch { return false }
    finally {
      if (this.loopRequestIds.get(entityId) === requestId) this.pendingLoops.delete(entityId)
    }
  }

  stopLoop(entityId: string, options: { fadeOut?: number } = {}) {
    this.loopRequestIds.set(entityId, (this.loopRequestIds.get(entityId) ?? 0) + 1)
    this.pendingLoops.delete(entityId)
    const active = this.loops.get(entityId)
    this.loops.delete(entityId)
    this.stopSource(active ?? null, Math.max(0, options.fadeOut ?? 0))
  }

  /** 不重启循环声地调整实体音量；用于坠毁、距离等连续衰减。 */
  setLoopVolume(entityId: string, volume: number, ramp = 0.06) {
    const active = this.loops.get(entityId)
    if (!active || !this.context) return
    const now = this.context.currentTime
    const target = clamp01(volume)
    try {
      active.gain.gain.cancelScheduledValues(now)
      active.gain.gain.setValueAtTime(active.gain.gain.value, now)
      if (ramp > 0) active.gain.gain.linearRampToValueAtTime(target, now + ramp)
      else active.gain.gain.setValueAtTime(target, now)
    } catch { /* 音源可能恰好在本帧结束 */ }
  }

  /** 循环已在播放或正在解码启动。 */
  hasLoop(entityId: string): boolean {
    return this.loops.has(entityId) || this.pendingLoops.has(entityId)
  }

  async playPreview(
    ref: string,
    loop: boolean,
    onEnded?: () => void,
    options: { volume?: number; playbackRate?: number } = {},
  ): Promise<boolean> {
    this.stopPreview()
    const requestId = ++this.previewRequestId
    if (!await this.unlock()) return false
    try {
      const context = this.ensureContext()
      if (!context) return false
      const buffer = await this.buffer(ref)
      if (requestId !== this.previewRequestId) return false
      const source = context.createBufferSource()
      const gain = context.createGain()
      source.buffer = buffer
      source.loop = loop
      source.playbackRate.value = Math.max(0.25, Math.min(4, options.playbackRate ?? 1))
      gain.gain.value = clamp01(options.volume ?? 1)
      source.connect(gain)
      gain.connect(this.channelGains.get('preview') ?? this.seGain!)
      const active = { source, gain, ref }
      this.preview = active
      source.onended = () => {
        if (this.preview === active) this.preview = null
        if (!loop) onEnded?.()
      }
      source.start()
      return true
    } catch { return false }
  }

  stopPreview() {
    this.previewRequestId++
    this.stopSource(this.preview)
    this.preview = null
  }

  pauseGame() {
    this.gamePaused = true
    void this.syncContextState()
  }

  resumeGame() {
    this.gamePaused = false
    void this.syncContextState()
  }

  private async syncContextState() {
    const context = this.context
    if (!context || !this.unlocked) return
    try {
      if (this.gamePaused || this.hiddenPaused) {
        if (context.state === 'running') await context.suspend()
      } else if (context.state === 'suspended') await context.resume()
    } catch { /* 浏览器仍未允许恢复，下一次用户输入会重试 */ }
  }

  clearAsset(ref: string) {
    this.buffers.delete(ref)
    if (this.music?.ref === ref || this.desiredMusic?.ref === ref) this.stopMusic()
    if (this.preview?.ref === ref) this.stopPreview()
    for (const [entityId, active] of this.loops) if (active.ref === ref) this.stopLoop(entityId)
  }
}

export const audioManager = new AudioManager()
export { ASSET_REMOVED_EVENT }
