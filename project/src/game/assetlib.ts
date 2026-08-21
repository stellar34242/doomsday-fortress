/** 素材库（本地上传 + 内置注册）：统一图片条目，炮塔美术分层选配引用。
 *  内置条目 = 4 套炮塔通用集 + 4 套弹丸通用集全部文件（代码注册，不可删，不持久化）；
 *  上传条目 = 本地图片 dataURL，localStorage 'td-asset-lib' 持久化（体积敏感：>500KB 软警告仍允许）。 */
const STORAGE_KEY = 'td-asset-lib'

export type AssetCategory = 'base' | 'turret' | 'barrel' | 'flash' | 'projectile' | 'charge' | 'beam' | 'module' | 'other' // 底座/炮身/炮管/开火效果/弹丸/充能/光束/模块/未分类（v2.30 新增模块）
export const ASSET_CATEGORY_NAME: Record<AssetCategory, string> = {
  base: '底座', turret: '炮身', barrel: '炮管', flash: '效果', projectile: '弹丸', charge: '充能', beam: '光束', module: '模块', other: '未分类', // v2.15：开火效果→效果；v2.30：新增模块分类
}
const ASSET_CATEGORIES = Object.keys(ASSET_CATEGORY_NAME) as AssetCategory[]

function toCategory(v: unknown): AssetCategory { // 迁移/导入：无/非法 category → 'other'
  return ASSET_CATEGORIES.includes(v as AssetCategory) ? (v as AssetCategory) : 'other'
}

export interface AssetEntry {
  id: string // builtin:turrets/{set}/{part} / builtin:projectiles/{set}/{part} / upload-N
  name: string
  src: string // dataURL（上传）或内置文件路径
  builtin: boolean
  category: AssetCategory
}

const lib: AssetEntry[] = []

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
const LIBRARY_ASSETS: [string, AssetCategory][] = [ // [文件名（原名）, 类别]（v1.65：旧炮身/炮管素材已全部删除；v1.67：口令沉淀内置；v1.70：取消尾焰分类删 fixg_s_missile、底座 4 件转炮管、charge_Laser_M 转新增充能分类）
  ['shell_s', 'projectile'], ['shell_m', 'projectile'], ['shell_l', 'projectile'], // v1.71：弹丸 missile_s 已删除
  ['missile2_s', 'projectile'], // v2.17 用户上传：missile2_s 弹丸内置
  // 炮身 ×7
  ['dualgun_s1', 'turret'], ['midcannon_m1', 'turret'], ['laser_m', 'turret'],
  ['maincannon_l1', 'turret'], ['dualcannon_l1', 'turret'], ['missile_s_t', 'turret'],
  ['missilelauncher2_s', 'turret'], // v2.17 用户上传：MissileLauncher2_S 炮身内置
  // 炮管 ×4（v1.70 自底座转入）
  ['dualgun_s2', 'barrel'], ['maincannon_l2', 'barrel'], ['midcannon_m2', 'barrel'], ['twincannon_l2', 'barrel'],
  // 充能 ×1（v1.70 新增分类）
  ['charge_laser_m', 'charge'],
  // 开火效果 ×1（v1.74 口令沉淀：fx_fire_S 设为内置开火效果；同口令 DualGun-_S1/S2 已直接替换 dualgun_s1/s2.png 贴图文件，分类与引用不变）
  ['fx_fire_s', 'flash'],
  // 履带瓦片 ×1（v1.85 用户上传 Track01：履带板循环拼接瓦片，重叠 2px）
  ['track01', 'base'],
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
  dualgun_s1: 'DualGun-_S1', midcannon_m1: 'MidCannon_M1', laser_m: 'Laser_M',
  maincannon_l1: 'MainCannon_L1', dualcannon_l1: 'DualCannon_L1', missile_s_t: 'MissileLauncher_S', // v1.71 改名（原 missile_s，与已删弹丸 missile_s 区分）
  dualgun_s2: 'DualGun-_S2', maincannon_l2: 'MainCannon_L2', midcannon_m2: 'MidCannon_M2',
  twincannon_l2: 'TwinCannon_L2', charge_laser_m: 'charge_Laser_M', fx_fire_s: 'fx_fire_S',
  track01: 'Track01',
  missilelauncher2_s: 'MissileLauncher2_S', // v2.17 用户上传内置（炮身）
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

export interface UploadData { id: string; name: string; src: string; category?: AssetCategory }

// ---- 出厂上传素材（v1.72 口令沉淀：弹丸 missile_s，被 rocket_std 引用）----
// 仅首次启动播种（localStorage 无 key 时写入；此后删除不复活）。非内置：可删、持久化、随口令导出。
const DEFAULT_UPLOADS: UploadData[] = [
  { id: 'upload-1', name: 'missile_s', src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAAOCAYAAAAIar0YAAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAA4RpVFh0WE1MOmNvbS5hZG9iZS54bXAAAAAAADw/eHBhY2tldCBiZWdpbj0i77u/IiBpZD0iVzVNME1wQ2VoaUh6cmVTek5UY3prYzlkIj8+IDx4OnhtcG1ldGEgeG1sbnM6eD0iYWRvYmU6bnM6bWV0YS8iIHg6eG1wdGs9IkFkb2JlIFhNUCBDb3JlIDUuNi1jMTExIDc5LjE1ODMyNSwgMjAxNS8wOS8xMC0wMToxMDoyMCAgICAgICAgIj4gPHJkZjpSREYgeG1sbnM6cmRmPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5LzAyLzIyLXJkZi1zeW50YXgtbnMjIj4gPHJkZjpEZXNjcmlwdGlvbiByZGY6YWJvdXQ9IiIgeG1sbnM6eG1wTU09Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC9tbS8iIHhtbG5zOnN0UmVmPSJodHRwOi8vbnMuYWRvYmUuY29tL3hhcC8xLjAvc1R5cGUvUmVzb3VyY2VSZWYjIiB4bWxuczp4bXA9Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC8iIHhtcE1NOk9yaWdpbmFsRG9jdW1lbnRJRD0ieG1wLmRpZDpmMTBmY2RhYi0xMGEyLWEwNDMtYmZjYS0yNWI4YTIxNmJlNGUiIHhtcE1NOkRvY3VtZW50SUQ9InhtcC5kaWQ6MDYxNjAyNDA5OTcwMTFGMUJCMjFENDY3Mjg3MDJDNzgiIHhtcE1NOkluc3RhbmNlSUQ9InhtcC5paWQ6MDYxNjAyM0Y5OTcwMTFGMUJCMjFENDY3Mjg3MDJDNzgiIHhtcDpDcmVhdG9yVG9vbD0iQWRvYmUgUGhvdG9zaG9wIENDIDIwMTUgKFdpbmRvd3MpIj4gPHhtcE1NOkRlcml2ZWRGcm9tIHN0UmVmOmluc3RhbmNlSUQ9InhtcC5paWQ6ODJmYTAyOWQtZDY1OC0wNDRlLWI3MzEtZTc4NmUzZDk4OTljIiBzdFJlZjpkb2N1bWVudElEPSJhZG9iZTpkb2NpZDpwaG90b3Nob3A6ZDEzNzA4ODYtOTdmYy0xMWYxLWEzM2ItODdhYzhhMWQ0ZDAzIi8+IDwvcmRmOkRlc2NyaXB0aW9uPiA8L3JkZjpSREY+IDwveDp4bXBtZXRhPiA8P3hwYWNrZXQgZW5kPSJyIj8+oKdp7QAAALFJREFUeNpi6po+kyNVTeE/CM9auISbAcS4PqPi/y47TbAg0/cvnz9p/P3JIM/PywAGmkyMn/Z6mvyv1JH/z8/K/pqBk5Pj/45TJ/5PnNv7H8QGC3z5/PL/3fObwQJMIG1vn91jePToMdgIsADDv98MMAAWkJWTYRAVEQALsICIY4f2M5w6dRYh0DVlGcPDR08QWpyt9Rh01aQRAg+evmH49PUXWIARaDeI/g+1hBEgwAC8tkYJ1uXEdgAAAABJRU5ErkJggg==', category: 'projectile' },
]
function seedDefaultUploads() {
  for (const u of DEFAULT_UPLOADS) {
    if (!lib.some(e => e.id === u.id)) {
      lib.push({ id: u.id, name: String(u.name ?? u.id), src: u.src, builtin: false, category: toCategory(u.category) })
    }
  }
}

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
  if (!st) { seedDefaultUploads(); return } // 无存储环境（sim/node）：内存播种
  try {
    const raw = st.getItem(STORAGE_KEY)
    if (!raw) { seedDefaultUploads(); save(); return } // v1.72：首次启动播种出厂上传并落盘（此后删除不复活）
    const arr = JSON.parse(raw) as UploadData[]
    if (!Array.isArray(arr)) return
    for (const u of arr) {
      if (u && typeof u.id === 'string' && typeof u.src === 'string' && !lib.some(e => e.id === u.id)) {
        lib.push({ id: u.id, name: String(u.name ?? u.id), src: u.src, builtin: false, category: toCategory(u.category) })
      }
    }
  } catch { /* 静默 */ }
}
load()

function save() {
  const st = storage()
  if (!st) return
  try {
    const ups: UploadData[] = lib.filter(e => !e.builtin).map(e => ({ id: e.id, name: e.name, src: e.src, category: e.category }))
    st.setItem(STORAGE_KEY, JSON.stringify(ups))
  } catch { /* 无存储环境/超配额静默 */ }
}

let uploadSeq = lib.reduce((m, e) => {
  const mm = /^upload-(\d+)$/.exec(e.id)
  return mm ? Math.max(m, Number(mm[1]) + 1) : m
}, 1)

export function listAssets(): AssetEntry[] { return lib }

export function getAsset(id: string): AssetEntry | undefined {
  return lib.find(e => e.id === id)
}

/** 上传条目（dataURL）；name 为空取 id；category 默认 'other'（未分类，所有选配下拉末尾仍可见） */
export function addAsset(name: string, dataUrl: string, category: AssetCategory = 'other'): AssetEntry {
  const entry: AssetEntry = { id: `upload-${uploadSeq++}`, name: name.trim() || `上传素材${uploadSeq - 1}`, src: dataUrl, builtin: false, category }
  lib.push(entry)
  save()
  return entry
}

/** 改上传条目分类 */
export function setAssetCategory(id: string, category: AssetCategory): boolean {
  const e = lib.find(x => x.id === id && !x.builtin)
  if (!e) return false
  e.category = category
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
  lib.splice(i, 1)
  save()
  return true
}

/** 口令导出：仅上传条目 */
export function uploadsForExport(): UploadData[] {
  return lib.filter(e => !e.builtin).map(e => ({ id: e.id, name: e.name, src: e.src, category: e.category }))
}

/** 口令导入：合入上传条目（id 去重）并持久化；v1 口令无 assets → 传 undefined 不动现有库 */
export function importUploads(arr: UploadData[] | undefined) {
  if (!arr) return
  for (const u of arr) {
    if (u && typeof u.id === 'string' && typeof u.src === 'string' && !lib.some(e => e.id === u.id)) {
      lib.push({ id: u.id, name: String(u.name ?? u.id), src: u.src, builtin: false, category: toCategory(u.category) })
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
