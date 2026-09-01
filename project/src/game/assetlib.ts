/** 素材库（本地上传 + 内置注册）：统一图片/音频条目，供各编辑器按分类引用。
 *  内置条目 = 4 套炮塔通用集 + 4 套弹丸通用集全部文件（代码注册，不可删，不持久化）；
 *  图片上传 = dataURL；音频上传 = IndexedDB Blob + localStorage 轻量元数据。 */
const STORAGE_KEY = 'td-asset-lib'
const ASSET_SCHEMA_KEY = 'td-asset-lib-schema'
const ASSET_SCHEMA_VERSION = 5 // v1：autogun 重命名；v2：重复迁移修复；v3：清理退役素材；v4：旋翼素材并入轮胎分类；v5：删除旧 missile_s 出厂上传
const AUDIO_DB_NAME = 'td-asset-audio'
const AUDIO_DB_STORE = 'clips'
const AUDIO_SRC_PREFIX = 'idb-audio:'
export const ASSET_REPLACED_EVENT = 'td-asset-replaced'
export const BRIEFING_BGM_ASSET_ID = 'builtin:bgm/briefing_eve'
export const UI_BUTTON_CLICK_ASSET_ID = 'builtin:se/ui_button_click'
export const MECH_FOOTSTEP_ASSET_ID = 'builtin:se/mech_footstep_01'

export type AssetCategory = 'base' | 'turret' | 'barrel' | 'flash' | 'projectile' | 'charge' | 'beam' | 'module' | 'icon' | 'decal'
  | 'vehicle' | 'wheel' | 'unitBody' | 'tile' | 'worldObject' | 'missionImage' | 'ui' | 'bgm' | 'se' | 'other'
export const ASSET_CATEGORY_NAME: Record<AssetCategory, string> = {
  base: '炮塔底座', turret: '炮身', barrel: '炮管', flash: '效果', projectile: '弹丸', charge: '充能', beam: '光束', module: '模块', icon: '图标', decal: '徽记',
  vehicle: '载具', wheel: '轮胎', unitBody: '单位主体', tile: '图块', worldObject: '物体贴图', missionImage: '任务贴图', ui: 'UI', bgm: 'BGM', se: 'SE', other: '未分类',
}
const ASSET_CATEGORIES = Object.keys(ASSET_CATEGORY_NAME) as AssetCategory[]

const RENAMED_AUDIO_ASSETS: Record<string, string> = {
  autogun_light_shot: 'autogun_light_loop',
  autogun_light_last: 'autogun_light_shot',
  autogun_light_last_: 'autogun_light_shot',
  autogun_mid_shot: 'autogun_mid_loop',
  autogun_mid_last: 'autogun_mid_shot',
  autogun_mid_last_: 'autogun_mid_shot',
  autogun_heavy_shot: 'autogun_heavy_loop',
  autogun_heavy_last: 'autogun_heavy_shot',
  autogun_heavy_last_: 'autogun_heavy_shot',
}

/** v3 一次性清理：同时覆盖内置素材的旧覆盖记录与用户素材库中的同名遗留项。 */
const V3_RETIRED_ASSET_IDS = new Set([
  'builtin:library/charge_laser_m',
  'builtin:library/laser_m',
  'builtin:library/maincannon_l1',
  'builtin:library/dualcannon_l1',
  'builtin:library/maincannon_l2',
  'builtin:library/twincannon_l2',
  'builtin:vehicle/jeep/main',
  'builtin:vehicle/lighttank01/body',
  'builtin:vehicle/lighttank01/turret',
  'builtin:vehicle/lighttank01/barrel',
])
const V3_RETIRED_ASSET_NAMES = new Set([
  '军用吉普', '轻型坦克', '轻型坦克01', '轻型坦克01炮塔', '轻型坦克01·炮塔',
  '轻型坦克01炮管', '轻型坦克01·炮管', 'charge_laser_m', 'laser_m', 'maincannon_l1',
  'dualcannon_l1', 'maincannon_l2', 'twincannon_l2', 'tank01_cannon2',
])

function isV3RetiredAsset(id: string, name: string): boolean {
  return V3_RETIRED_ASSET_IDS.has(id) || V3_RETIRED_ASSET_NAMES.has(name.trim().toLowerCase())
}

/** v5：标准导弹曾引用的 4×14 missile_s 自带固定尾焰，现由统一尾焰系统接管。 */
const RETIRED_STANDARD_MISSILE_ASSET_ID = 'upload-1'

/** 既有上传音频只改展示名，稳定素材 ID 与 IndexedDB 音频正文均不移动。 */
export function migratedAssetName(name: string): string {
  const clean = name.trim()
  return RENAMED_AUDIO_ASSETS[clean.toLowerCase()] ?? clean
}

function repairRepeatedAutogunRename(entries: AssetEntry[]): boolean {
  let changed = false
  for (const size of ['light', 'mid', 'heavy']) {
    const loopName = `autogun_${size}_loop`
    const shotName = `autogun_${size}_shot`
    const loops = entries.filter(entry => entry.category === 'se' && entry.name.toLowerCase() === loopName)
    const hasShot = entries.some(entry => entry.category === 'se' && entry.name.toLowerCase() === shotName)
    // 原上传顺序为 shot 后 last；若热更新让两者都变成 loop，末项就是原 last，应恢复为新的 shot。
    if (!hasShot && loops.length >= 2) { loops[loops.length - 1].name = shotName; changed = true }
  }
  return changed
}

function toCategory(v: unknown): AssetCategory { // 迁移/导入：无/非法 category → 'other'
  if (v === 'terrain') return 'tile' // 旧“地形贴图”并入统一图块库，随后由界面按尺寸补图块协议
  if (v === 'fortressBody') return 'vehicle' // 旧“堡垒主体”无损迁入统一“载具”分类
  if (v === 'rotor') return 'wheel' // v4：旋翼不再单独分类，旧素材无损并入“轮胎”
  return ASSET_CATEGORIES.includes(v as AssetCategory) ? (v as AssetCategory) : 'other'
}

export interface AssetEntry {
  id: string // builtin:turrets/{set}/{part} / builtin:projectiles/{set}/{part} / upload-N
  name: string
  src: string // dataURL（上传）或内置文件路径
  builtin: boolean
  category: AssetCategory
  /** 横向等宽状态条；frameWidth 固定后可继续向右追加新状态。 */
  spriteSheet?: AssetSpriteSheet
  /** 根据像素尺寸自动识别的关卡图块协议。 */
  tileSheet?: AssetTileSheet
  audio?: AssetAudioMeta
}

export interface AssetAudioMeta {
  mimeType: string
  size: number
}

export type AssetTileKind = 'independent' | 'autotileStatic' | 'autotileAnimated'
export interface AssetTileSheet {
  kind: AssetTileKind
  width: 160 | 96 | 384
  height: 160 | 128
  frames: 1 | 4
  /** 独立图块中至少包含一个非透明像素的 32×32 单元格索引。旧数据缺省时按全部25格处理。 */
  validTileIndices?: number[]
}

/** 扫描 160×160 RGBA 像素，只返回非全透明的 5×5 单元格索引。 */
export function independentTileIndicesFromPixels(data: Uint8ClampedArray, width: number, height: number): number[] {
  if (width !== 160 || height !== 160 || data.length < width * height * 4) return []
  const valid: number[] = []
  for (let tileY = 0; tileY < 5; tileY++) {
    for (let tileX = 0; tileX < 5; tileX++) {
      let visible = false
      for (let py = tileY * 32; py < tileY * 32 + 32 && !visible; py++) {
        for (let px = tileX * 32; px < tileX * 32 + 32; px++) {
          if (data[(py * width + px) * 4 + 3] !== 0) { visible = true; break }
        }
      }
      if (visible) valid.push(tileY * 5 + tileX)
    }
  }
  return valid
}

/** 独立图块随机填充：0 号有效图块占 95%，其余有效图块均分剩余 5% 权重。 */
export function weightedIndependentTileIndex(validTileIndices: readonly number[], random = Math.random): number | undefined {
  if (validTileIndices.length === 0) return undefined
  if (validTileIndices.length === 1) return validTileIndices[0]
  const roll = Math.max(0, Math.min(1 - Number.EPSILON, random()))
  const primaryIndex = validTileIndices.indexOf(0)
  if (primaryIndex < 0) {
    return validTileIndices[Math.min(validTileIndices.length - 1, Math.floor(roll * validTileIndices.length))]
  }
  const primaryWeight = 0.95
  if (roll < primaryWeight) return 0
  const secondaryIndices = validTileIndices.filter(index => index !== 0)
  const secondaryCount = secondaryIndices.length
  const secondaryRoll = (roll - primaryWeight) / (1 - primaryWeight)
  const secondaryIndex = Math.min(secondaryCount - 1, Math.floor(secondaryRoll * secondaryCount))
  return secondaryIndices[secondaryIndex]
}

/** 图块只接受约定尺寸；类型完全由图片尺寸推导。 */
export function tileSheetForDimensions(width: number, height: number): AssetTileSheet | undefined {
  if (width === 160 && height === 160) return { kind: 'independent', width: 160, height: 160, frames: 1 }
  if (width === 96 && height === 128) return { kind: 'autotileStatic', width: 96, height: 128, frames: 1 }
  if (width === 384 && height === 128) return { kind: 'autotileAnimated', width: 384, height: 128, frames: 4 }
  return undefined
}

function normalizeTileSheet(value: unknown): AssetTileSheet | undefined {
  const raw = (value ?? {}) as Partial<AssetTileSheet>
  if (raw.kind === 'independent') {
    const sheet = tileSheetForDimensions(Number(raw.width), Number(raw.height))
    if (sheet?.kind !== raw.kind) return undefined
    if (Array.isArray(raw.validTileIndices)) sheet.validTileIndices = [...new Set(raw.validTileIndices.map(Number).filter(index => Number.isInteger(index) && index >= 0 && index < 25))].sort((a, b) => a - b)
    return sheet
  }
  if (raw.kind === 'autotileStatic' || raw.kind === 'autotileAnimated') {
    const sheet = tileSheetForDimensions(Number(raw.width), Number(raw.height))
    return sheet?.kind === raw.kind ? sheet : undefined
  }
  return undefined
}

export type AssetSpriteState = 'walk' | 'attack' | 'cover' | 'death'
export interface AssetSpriteSheet {
  frameWidth: number
  frameHeight: number
  stateFrames: Record<AssetSpriteState, number>
}

const lib: AssetEntry[] = []
const overriddenBuiltinIds = new Set<string>()

// ---- 内置注册（通用素材已废止，暂无内置条目；保留注册机制供将来内置）----
const TURRET_SETS: [string, string][] = []
const TURRET_PARTS: [string, string][] = [['base', '底座'], ['turret', '炮身'], ['barrel', '炮管'], ['flash', '开火效果']]
for (const [setId, setName] of TURRET_SETS) {
  for (const [part, partName] of TURRET_PARTS) {
    lib.push({ id: `builtin:turrets/${setId}/${part}`, name: `${setName}·${partName}`, src: `/res/turrets/${setId}/${part}.png`, builtin: true, category: part as AssetCategory })
  }
}
const AMMO_SETS: [string, string][] = []
const AMMO_PARTS: [string, string][] = [['projectile', '弹丸']] // 特效（尾焰/爆炸/命中）一律程序化参数生成，帧条素材已废止
for (const [setId, setName] of AMMO_SETS) {
  for (const [part, partName] of AMMO_PARTS) {
    lib.push({ id: `builtin:projectiles/${setId}/${part}`, name: `${setName}弹·${partName}`, src: `/res/projectiles/${setId}/${part}.png`, builtin: true, category: 'projectile' })
  }
}

// ---- 常用素材（用户口令沉淀的内置条目；随应用分发，不可删、不持久化、不随口令导出）----
const LIBRARY_ASSETS: [string, AssetCategory][] = [ // [文件名（原名）, 类别]；只注册当前仍在使用的内置素材
  ['shell_s', 'projectile'], ['shell_m', 'projectile'], ['shell_l', 'projectile'], // v1.71：弹丸 missile_s 已删除
  ['missile2_s', 'projectile'], // v2.17 用户上传：missile2_s 弹丸内置
  // 炮身
  ['dualgun_s1', 'turret'], ['midcannon_m1', 'turret'], ['missile_s_t', 'turret'],
  // 炮管（v1.70 自底座转入）
  ['dualgun_s2', 'barrel'], ['midcannon_m2', 'barrel'],
  // 开火效果 ×1（v1.74 口令沉淀：fx_fire_S 设为内置开火效果；同口令 DualGun-_S1/S2 已直接替换 dualgun_s1/s2.png 贴图文件，分类与引用不变）
  ['fx_fire_s', 'flash'],
  // Track01 ×1（v1.85 用户上传：履带板循环拼接瓦片，重叠 2px；v2.72 按用户要求转入「轮胎」）
  ['track01', 'wheel'],
]
// 光束贴图 ×15（v2.11 用户上传：落位 /res/beam/，独立「光束」分类，亮芯层/光晕层选择指向；
// 白图 alpha 遮罩走 tintedFx 着色；v2.7 旧 7 张 beam_glow_a-d/beam_core_a-c 已删除）
const BEAM_ASSETS: string[] = [
  'beam_coreA', 'beam_coreB', 'beam_coreC', 'beam_glowA', 'beam_glowB', 'beam_glowC', 'beam_glowD',
  'beam_chunky_core', 'beam_chunky_glow', 'beam_laser_core', 'beam_laser_glow',
  'beam_rough2_core', 'beam_rough2_glow', 'beam_weave_core', 'beam_weave_glow',
]
// v1.67：内置条目的展示名（与文件名不同时覆盖；missile_s_t 原口令名 missile_s，避免与弹丸 missile_s 撞文件名）
const LIBRARY_NAMES: Record<string, string> = {
  dualgun_s1: 'DualGun-_S1', midcannon_m1: 'MidCannon_M1',
  missile_s_t: 'MissileLauncher_S', // v1.71 改名（原 missile_s，与已删弹丸 missile_s 区分）
  dualgun_s2: 'DualGun-_S2', midcannon_m2: 'MidCannon_M2', fx_fire_s: 'fx_fire_S',
  track01: 'Track01',
  // missile2_s 展示名同文件名，无需覆盖
}
for (const [file, category] of LIBRARY_ASSETS) {
  lib.push({ id: `builtin:library/${file}`, name: LIBRARY_NAMES[file] ?? file, src: `/res/library/${file}.png`, builtin: true, category })
}
for (const file of BEAM_ASSETS) { // v2.11：光束贴图独立注册（/res/beam/，类别 beam）
  lib.push({ id: `builtin:beam/${file}`, name: file, src: `/res/beam/${file}.png`, builtin: true, category: 'beam' })
}
// v2.15：特效贴图注册进「效果」分类（原开火效果；命中闪光/炮口闪光选择锚定本分类）
const FX_ASSETS: string[] = ['glow16', 'particlealpha32', 'smoke32']
for (const file of FX_ASSETS) {
  lib.push({ id: `builtin:fx/${file}`, name: file, src: `/res/fx/${file}.png`, builtin: true, category: 'flash' })
}
// 载具只保留单一“载具素材”；旧底座层与对应内置素材已移除。
const FORTRESS_ASSETS: AssetEntry[] = [
  { id: 'builtin:fortress/standard/body', name: '测试堡垒', src: '/res/fortresses/fort_1_01.png', builtin: true, category: 'vehicle' },
  { id: 'builtin:vehicle/jeep/wheel', name: '吉普轮胎', src: '/res/vehicles/jeep_wheel.png', builtin: true, category: 'wheel' },
  { id: 'builtin:vehicle/lighttank01/track', name: '轻型坦克01·履带', src: '/res/vehicles/track_lighttank01.png', builtin: true, category: 'wheel' },
]
lib.push(...FORTRESS_ASSETS)

// 任务情报界面贴图：关卡配置保存素材 ID，显示时统一通过 resolveAssetSrc 解析。
lib.push({ id: 'builtin:mission/briefing_default', name: '默认任务贴图', src: '/res/mission/briefing_default.svg', builtin: true, category: 'missionImage' })

// 关卡选择/任务介绍配乐：作为内置 BGM 纳入统一素材库，可试听并供所有 BGM 下拉框复用。
lib.push({
  id: BRIEFING_BGM_ASSET_ID,
  name: '备战前夕',
  src: '/res/audio/briefing_eve_loop.wav',
  builtin: true,
  category: 'bgm',
  audio: { mimeType: 'audio/wav', size: 6_144_044 },
})
lib.push({
  id: UI_BUTTON_CLICK_ASSET_ID,
  name: 'switch_button',
  src: '/res/audio/switch_button.wav',
  builtin: true,
  category: 'se',
  audio: { mimeType: 'audio/wav', size: 147_038 },
})
lib.push({
  id: MECH_FOOTSTEP_ASSET_ID,
  name: 'mech_footstep_01',
  src: '/res/audio/mech_footstep_01.ogg',
  builtin: true,
  category: 'se',
  audio: { mimeType: 'audio/ogg', size: 10_336 },
})
// 关卡图块：既有 RMXP 静态 Autotile 纳入统一素材库；独立图块与动态 Autotile 可由用户上传。
lib.push(
  { id: 'builtin:ground/mid', name: '内置装饰地面', src: '/res/ground/ground_mid.png', builtin: true, category: 'tile', tileSheet: { kind: 'autotileStatic', width: 96, height: 128, frames: 1 } },
  { id: 'builtin:ground/top', name: '内置上层地面', src: '/res/ground/ground_top.png', builtin: true, category: 'tile', tileSheet: { kind: 'autotileStatic', width: 96, height: 128, frames: 1 } },
)

export interface UploadData { id: string; name: string; src: string; category?: AssetCategory; tileSheet?: AssetTileSheet; audio?: AssetAudioMeta }


function storage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null
    return localStorage
  } catch {
    return null
  }
}

function load() {
  const st = storage()
  if (!st) return
  try {
    const raw = st.getItem(STORAGE_KEY)
    if (!raw) { save(); st.setItem(ASSET_SCHEMA_KEY, String(ASSET_SCHEMA_VERSION)); return }
    const arr = JSON.parse(raw) as UploadData[]
    if (!Array.isArray(arr)) return
    const schema = Number(st.getItem(ASSET_SCHEMA_KEY) ?? 0)
    let assetMetadataChanged = schema < ASSET_SCHEMA_VERSION
    for (const u of arr) {
      if (!u || typeof u.id !== 'string' || typeof u.src !== 'string') continue
      if (u.id === RETIRED_STANDARD_MISSILE_ASSET_ID) { assetMetadataChanged = true; continue }
      if (String(u.category) === 'creature' || String(u.category) === 'fortressBase') { assetMetadataChanged = true; continue }
      const originalName = String(u.name ?? u.id)
      if (schema < 3 && isV3RetiredAsset(u.id, originalName)) { assetMetadataChanged = true; continue }
      const name = schema < 1 && toCategory(u.category) === 'se' ? migratedAssetName(originalName) : originalName
      if (name !== originalName) assetMetadataChanged = true
      const existing = lib.find(entry => entry.id === u.id)
      if (existing?.builtin) {
        existing.name = name
        existing.src = u.src
        existing.category = toCategory(u.category)
        existing.tileSheet = normalizeTileSheet(u.tileSheet)
        existing.audio = normalizeAudioMeta(u.audio)
        overriddenBuiltinIds.add(existing.id)
      } else if (!existing) lib.push({ id: u.id, name, src: u.src, builtin: false, category: toCategory(u.category), tileSheet: normalizeTileSheet(u.tileSheet), audio: normalizeAudioMeta(u.audio) })
    }
    if (schema < 2 && repairRepeatedAutogunRename(lib)) assetMetadataChanged = true
    if (assetMetadataChanged) save()
    if (schema < ASSET_SCHEMA_VERSION) st.setItem(ASSET_SCHEMA_KEY, String(ASSET_SCHEMA_VERSION))
  } catch { /* 静默 */ }
}
load()

function save() {
  const st = storage()
  if (!st) return
  try {
    const ups: UploadData[] = lib.filter(e => !e.builtin || overriddenBuiltinIds.has(e.id)).map(e => ({ id: e.id, name: e.name, src: e.src, category: e.category, tileSheet: e.tileSheet, audio: e.audio }))
    st.setItem(STORAGE_KEY, JSON.stringify(ups))
  } catch { /* 无存储环境/超配额静默 */ }
}

// upload-1 是已删除的旧标准导弹贴图，永久保留编号避免新上传误用退役引用。
let uploadSeq = lib.reduce((m, e) => {
  const mm = /^upload-(\d+)$/.exec(e.id)
  return mm ? Math.max(m, Number(mm[1]) + 1) : m
}, 2)

export function listAssets(): AssetEntry[] { return lib }

export function getAsset(id: string): AssetEntry | undefined {
  return lib.find(e => e.id === id)
}

/** 按展示名查找素材；运行时约定型素材使用名称而非 upload-N，避免重新导入后引用失效。 */
export function findAssetByName(name: string, category?: AssetCategory): AssetEntry | undefined {
  const normalized = name.trim().toLowerCase()
  return lib.find(entry => (!category || entry.category === category) && entry.name.trim().toLowerCase() === normalized)
}

export function isAutotileAsset(id: string | undefined): boolean {
  const kind = id ? getAsset(id)?.tileSheet?.kind : undefined
  return kind === 'autotileStatic' || kind === 'autotileAnimated'
}

/** 素材库 id / 遗留路径 / dataURL 统一解析；便于新引用与旧存档共存。 */
export function resolveAssetSrc(ref: string | undefined): string | undefined {
  if (!ref) return undefined
  return getAsset(ref)?.src ?? ref
}

/** 上传条目（dataURL）；name 为空取 id；category 默认 'other'（未分类，所有选配下拉末尾仍可见） */
export function addAsset(name: string, dataUrl: string, category: AssetCategory = 'other', tileSheet?: AssetTileSheet): AssetEntry {
  const acceptedTileSheet = category === 'tile' || (category === 'worldObject' && (tileSheet?.kind === 'autotileStatic' || tileSheet?.kind === 'autotileAnimated')) ? tileSheet : undefined
  const cleanName = name.trim()
  const existing = cleanName ? lib.find(entry => entry.category === category && entry.name === cleanName) : undefined
  if (existing) {
    existing.src = dataUrl
    existing.tileSheet = acceptedTileSheet
    delete existing.audio
    if (existing.builtin) overriddenBuiltinIds.add(existing.id)
    imgCache.delete(existing.id)
    save()
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(ASSET_REPLACED_EVENT, { detail: existing.id }))
    return existing
  }
  const entry: AssetEntry = { id: `upload-${uploadSeq++}`, name: cleanName || `上传素材${uploadSeq - 1}`, src: dataUrl, builtin: false, category, tileSheet: acceptedTileSheet }
  lib.push(entry)
  save()
  return entry
}

function normalizeAudioMeta(value: unknown): AssetAudioMeta | undefined {
  const raw = value as Partial<AssetAudioMeta> | null
  if (!raw || typeof raw.mimeType !== 'string') return undefined
  return { mimeType: raw.mimeType, size: Math.max(0, Math.round(Number(raw.size) || 0)) }
}

function openAudioDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('当前环境不支持 IndexedDB')); return }
    const request = indexedDB.open(AUDIO_DB_NAME, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(AUDIO_DB_STORE)) request.result.createObjectStore(AUDIO_DB_STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('音频存储打开失败'))
  })
}

async function writeAudioBlob(id: string, blob: Blob): Promise<void> {
  const db = await openAudioDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(AUDIO_DB_STORE, 'readwrite')
      transaction.objectStore(AUDIO_DB_STORE).put(blob, id)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error ?? new Error('音频保存失败'))
      transaction.onabort = () => reject(transaction.error ?? new Error('音频保存已取消'))
    })
  } finally { db.close() }
}

async function readAudioBlob(id: string): Promise<Blob | undefined> {
  const db = await openAudioDb()
  try {
    return await new Promise<Blob | undefined>((resolve, reject) => {
      const request = db.transaction(AUDIO_DB_STORE, 'readonly').objectStore(AUDIO_DB_STORE).get(id)
      request.onsuccess = () => resolve(request.result instanceof Blob ? request.result : undefined)
      request.onerror = () => reject(request.error ?? new Error('音频读取失败'))
    })
  } finally { db.close() }
}

async function deleteAudioBlob(id: string): Promise<void> {
  const db = await openAudioDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(AUDIO_DB_STORE, 'readwrite')
      transaction.objectStore(AUDIO_DB_STORE).delete(id)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error ?? new Error('音频删除失败'))
    })
  } finally { db.close() }
}

export function isAudioAsset(asset: Pick<AssetEntry, 'src' | 'category' | 'audio'>): boolean {
  return asset.category === 'bgm' || asset.category === 'se' || !!asset.audio || asset.src.startsWith('data:audio/') || asset.src.startsWith(AUDIO_SRC_PREFIX)
}

/** BGM/SE 正文保存至 IndexedDB，素材列表只持久化稳定引用与轻量元数据。 */
export async function addAudioAsset(name: string, file: File, category: 'bgm' | 'se'): Promise<AssetEntry> {
  const cleanName = name.trim()
  const existing = cleanName ? lib.find(entry => entry.category === category && entry.name === cleanName) : undefined
  const id = existing?.id ?? `upload-${uploadSeq++}`
  await writeAudioBlob(id, file)
  const entry: AssetEntry = existing ?? { id, name: cleanName || `上传音频${uploadSeq - 1}`, src: '', builtin: false, category }
  entry.src = `${AUDIO_SRC_PREFIX}${id}`
  entry.audio = { mimeType: file.type || 'audio/mpeg', size: file.size }
  delete entry.tileSheet
  if (existing?.builtin) overriddenBuiltinIds.add(existing.id)
  if (existing) {
    save()
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(ASSET_REPLACED_EVENT, { detail: existing.id }))
    return existing
  }
  lib.push(entry)
  save()
  return entry
}

/** 返回可供 Audio 播放的 URL；IndexedDB 音频返回 object URL，调用方用后负责 revoke。 */
export async function audioAssetObjectUrl(asset: AssetEntry): Promise<{ url: string; revoke: boolean }> {
  if (!asset.src.startsWith(AUDIO_SRC_PREFIX)) return { url: asset.src, revoke: false }
  const blob = await readAudioBlob(asset.id)
  if (!blob) throw new Error('音频文件不存在，请重新上传')
  return { url: URL.createObjectURL(blob), revoke: true }
}

/** 改上传条目分类 */
export function setAssetCategory(id: string, category: AssetCategory): boolean {
  const e = lib.find(x => x.id === id && !x.builtin)
  if (!e) return false
  e.category = category
  if (category !== 'tile' && category !== 'worldObject') delete e.tileSheet
  else if (category === 'worldObject' && e.tileSheet?.kind === 'independent') delete e.tileSheet
  save()
  return true
}

/** 写入尺寸识别结果；图块接受三类协议，物体贴图只接受静态/动态 Autotile。 */
export function setAssetTileSheet(id: string, tileSheet: AssetTileSheet): boolean {
  const entry = lib.find(item => item.id === id && !item.builtin && (item.category === 'tile' || (item.category === 'worldObject' && tileSheet.kind !== 'independent')))
  if (!entry) return false
  entry.tileSheet = tileSheet
  save()
  return true
}

/** 选配下拉严格过滤：只返回对应分类（未分类素材不出现在任何选配下拉，可在素材库页签改分类） */
export function filterAssets(category: AssetCategory): AssetEntry[] {
  return lib.filter(e => e.category === category)
}

/** 删除上传条目（内置不可删） */
export function removeAsset(id: string): boolean {
  const i = lib.findIndex(e => e.id === id && !e.builtin)
  if (i < 0) return false
  const [removed] = lib.splice(i, 1)
  if (removed.src.startsWith(AUDIO_SRC_PREFIX)) void deleteAudioBlob(removed.id).catch(() => undefined)
  save()
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('td-audio-asset-removed', { detail: removed.id }))
  return true
}

/** 口令导出：仅上传条目 */
export function uploadsForExport(): UploadData[] {
  return lib.filter(e => !e.builtin || overriddenBuiltinIds.has(e.id)).map(e => ({ id: e.id, name: e.name, src: e.src, category: e.category, tileSheet: e.tileSheet, audio: e.audio }))
}

/** 口令导入：合入上传条目（id 去重）并持久化；v1 口令无 assets → 传 undefined 不动现有库 */
export function importUploads(arr: UploadData[] | undefined) {
  if (!arr) return
  for (const u of arr) {
    if (u && typeof u.id === 'string' && typeof u.src === 'string') {
      if (u.id === RETIRED_STANDARD_MISSILE_ASSET_ID) continue
      if (String(u.category) === 'creature' || String(u.category) === 'fortressBase') continue
      const category = toCategory(u.category)
      const name = String(u.name ?? u.id)
      const existing = lib.find(e => e.id === u.id)
      if (existing?.builtin) {
        existing.name = name; existing.src = u.src; existing.category = category
        existing.tileSheet = normalizeTileSheet(u.tileSheet); existing.audio = normalizeAudioMeta(u.audio)
        overriddenBuiltinIds.add(existing.id); imgCache.delete(existing.id)
      } else if (!existing) lib.push({ id: u.id, name, src: u.src, builtin: false, category, tileSheet: normalizeTileSheet(u.tileSheet), audio: normalizeAudioMeta(u.audio) })
      const mm = /^upload-(\d+)$/.exec(u.id)
      if (mm) uploadSeq = Math.max(uploadSeq, Number(mm[1]) + 1)
    }
  }
  save()
}

/** 素材图片加载（dataURL/路径统一 new Image，按 id 缓存；无 DOM 静默 error） */
export interface AssetImgEntry { status: 'loading' | 'ready' | 'error'; img?: HTMLImageElement }
const IMG_ERROR: AssetImgEntry = { status: 'error' }
const imgCache = new Map<string, AssetImgEntry>()

export function assetImage(id: string): AssetImgEntry {
  const hit = imgCache.get(id)
  if (hit) return hit
  if (typeof Image === 'undefined') { // 无 DOM 环境（sim/node）静默
    imgCache.set(id, IMG_ERROR)
    return IMG_ERROR
  }
  const entry = getAsset(id)
  if (!entry) {
    imgCache.set(id, IMG_ERROR)
    return IMG_ERROR
  }
  const e: AssetImgEntry = { status: 'loading' }
  imgCache.set(id, e)
  const img = new Image()
  img.onload = () => { e.status = 'ready'; e.img = img }
  img.onerror = () => { e.status = 'error'; e.img = undefined }
  img.src = entry.src
  return e
}
