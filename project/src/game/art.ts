import { assetImage, getAsset, resolvePublicAssetSrc } from './assetlib'
import { PROJECTILE_ARTS, PROJECTILE_KIND_COLOR, VERTICAL_LAUNCH_FRAMES, verticalLaunchDuration } from './config'
import type { ProjectileArtDef, TurretDef } from './config'

// 炮塔四个可见层（base/turret/barrel/flash）只绘制显式选择且加载成功的素材。
// 缺省、none、遗留 geo、引用失效都视为不绘制，不再补画程序化几何图形。

export interface TurretArtAssets {
  base?: HTMLImageElement
  turret?: HTMLImageElement
  barrel?: HTMLImageElement
  flash?: HTMLImageElement
  glow?: HTMLImageElement
  charge?: HTMLImageElement // 可选：充能动画帧条（缺失仅无充能动画，不影响 ready 判定）
}

export type ArtStatus = 'loading' | 'ready' | 'fallback'

export interface ArtEntry {
  status: ArtStatus
  assets?: TurretArtAssets
}

/** art 配置校验：errors = 硬性错误；warnings = 可自动兼容的旧配置提示。 */
export interface ArtValidation {
  ok: boolean
  errors: string[]
  warnings: string[]
}

const isNum2 = (p: unknown): p is [number, number] =>
  Array.isArray(p) && p.length === 2 && p.every(n => typeof n === 'number' && Number.isFinite(n))

export function validateArt(def: TurretDef): ArtValidation {
  const errors: string[] = []
  const warnings: string[] = []
  const art = def.art
  if (!art) return { ok: true, errors, warnings }
  if (art.anchor !== undefined && !isNum2(art.anchor)) errors.push('anchor 须为 [x,y] 数值对')
  if (art.recoil !== undefined && (typeof art.recoil !== 'number' || !Number.isFinite(art.recoil) || art.recoil < 0)) {
    errors.push('recoil（统一后坐）须为 ≥0 数值') // v1.58
  }
  if (art.flipEvenBarrels !== undefined && typeof art.flipEvenBarrels !== 'boolean') {
    errors.push('flipEvenBarrels（翻转偶数炮管）须为布尔值')
  }
  if (art.barrels !== undefined) {
    if (!Array.isArray(art.barrels) || art.barrels.length === 0) errors.push('barrels 挂点表须为非空数组（或删除该字段）')
    else art.barrels.forEach((b, i) => {
      if (!isNum2(b?.mount)) errors.push(`barrels[${i}] 缺 mount 或坐标非数值`)
      if (!isNum2(b?.muzzle)) errors.push(`barrels[${i}] 缺 muzzle 或坐标非数值`)
      if (b?.recoil !== undefined && (typeof b.recoil !== 'number' || !Number.isFinite(b.recoil) || b.recoil < 0)) {
        errors.push(`barrels[${i}].recoil 须为 ≥0 数值`)
      }
    })
    if (errors.length === 0 && Array.isArray(art.barrels) && art.barrels.length > 0) {
      const n = Math.max(1, Math.floor(def.barrels ?? 1))
      if (art.barrels.length !== n) {
        warnings.push(`挂点表数量(${art.barrels.length}) ≠ 炮管数(${n})：多余项会忽略，缺少项会自动生成`)
      }
    }
  }
  if (art.rack) { // 导弹挂载显示：dx/dy 非数值 error
    if (art.rack.dx !== undefined && (typeof art.rack.dx !== 'number' || !Number.isFinite(art.rack.dx))) errors.push('rack.dx 须为数值（格）')
    if (art.rack.dy !== undefined && (typeof art.rack.dy !== 'number' || !Number.isFinite(art.rack.dy))) errors.push('rack.dy 须为数值（格）')
  }
  // 火光表现 v1.45 起硬编码（FLASH_* 常量），art.flash 配置项已移除，无需校验
  if (art.projectile !== undefined) { // §3A.4 引用校验
    if (def.type === 'spray') {
      warnings.push('喷射无弹丸，projectile 配置不生效')
    } else {
      const pad = projectileArtDef(art.projectile)
      if (!pad) warnings.push(`弹丸条目「${art.projectile}」不存在，回退几何弹丸`)
      else {
        // 类别映射：直射→bullet、抛射→shell、导弹→missile、射线（持续光束/点射）→ray
        const want = def.type === 'lob' ? 'shell' : def.type === 'missile' ? 'missile' : def.type === 'beam' ? 'ray' : 'bullet'
        if (pad.kind !== want) warnings.push(`弹丸类别不匹配：条目 ${pad.kind} ≠ 炮塔 ${want}（允许跨类借用，按配置生效）`)
        if (pad.beam) { // v2.8：光束表现组挂在 ray 条目上
          if (def.type !== 'beam') warnings.push('引用射线条目的光束表现仅射线类炮塔生效')
          else validateBeamGroup(pad.beam, errors, warnings)
        }
      }
    }
  }
  if (art.charge) { // 充能动画（charge.png）
    const ch = art.charge
    if (!Number.isInteger(ch.frames) || ch.frames < 1 || ch.frames > 12) errors.push('charge.frames 须为 1–12 整数')
    if (!ch.offset || !Number.isFinite(ch.offset[0]) || !Number.isFinite(ch.offset[1])) errors.push('charge.offset 须为 [x,y] 数值')
    if (!(def.chargeTime && def.chargeTime > 0)) warnings.push('充能动画不生效（未配置充能时间）')
  }
  return { ok: errors.length === 0, errors, warnings }
}

/** v2.8：光束表现组字段校验（hex 颜色/范围/素材引用存在性）；供 validateArt 校验引用 ray 条目时复用 */
function validateBeamGroup(b: NonNullable<ProjectileArtDef['beam']>, errors: string[], warnings: string[]) {
  const HEX = /^#[0-9a-fA-F]{6}$/
  if (b.fringeColor !== undefined && !HEX.test(b.fringeColor)) errors.push('beam.fringeColor 须为 #RRGGBB 十六进制颜色')
  if (b.coreColor !== undefined && !HEX.test(b.coreColor)) errors.push('beam.coreColor 须为 #RRGGBB 十六进制颜色')
  if (b.flicker !== undefined && (typeof b.flicker !== 'number' || !Number.isFinite(b.flicker) || b.flicker < 0 || b.flicker > 1)) errors.push('beam.flicker 须为 0~1 数值')
  if (b.scrollSpeed !== undefined && (typeof b.scrollSpeed !== 'number' || !Number.isFinite(b.scrollSpeed) || b.scrollSpeed < 0)) errors.push('beam.scrollSpeed 须为 ≥0 数值（美术 px/s）')
  const refChk = (v: string | undefined, label: string) => { // 素材引用：'none' / /res/ 路径 / 库条目 id
    if (v !== undefined && v !== 'none' && !v.startsWith('/') && !getAsset(v)) warnings.push(`beam.${label} 引用的素材库条目「${v}」不存在，回退程序化表现`)
  }
  refChk(b.glowAsset, 'glowAsset'); refChk(b.coreAsset, 'coreAsset')
  refChk(b.impactAsset, 'impactAsset'); refChk(b.muzzleAsset, 'muzzleAsset')
  // v2.10：闪光缩放 + 粒子组校验
  if (b.muzzleScale !== undefined && (typeof b.muzzleScale !== 'number' || !Number.isFinite(b.muzzleScale) || b.muzzleScale <= 0)) errors.push('beam.muzzleScale 须为 >0 数值')
  if (b.impactScale !== undefined && (typeof b.impactScale !== 'number' || !Number.isFinite(b.impactScale) || b.impactScale <= 0)) errors.push('beam.impactScale 须为 >0 数值')
  const fxChk = (g: { rate?: number; color?: string; size?: number } | undefined, label: string) => {
    if (!g) return
    if (g.rate !== undefined && (typeof g.rate !== 'number' || !Number.isFinite(g.rate) || g.rate < 0)) errors.push(`beam.${label}.rate 须为 ≥0 数值（粒/s）`)
    if (g.size !== undefined && (typeof g.size !== 'number' || !Number.isFinite(g.size) || g.size <= 0)) errors.push(`beam.${label}.size 须为 >0 数值（格）`)
    if (g.color !== undefined && !HEX.test(g.color)) errors.push(`beam.${label}.color 须为 #RRGGBB 十六进制颜色`)
  }
  fxChk(b.absorb, 'absorb'); fxChk(b.scatter, 'scatter'); fxChk(b.smoke, 'smoke')
  // v2.15：散发角度 0~360（全锥角；360=全向）
  if (b.scatter?.angle !== undefined && (typeof b.scatter.angle !== 'number' || !Number.isFinite(b.scatter.angle) || b.scatter.angle < 0 || b.scatter.angle > 360)) errors.push('beam.scatter.angle 须为 0~360 数值（度）')
}

/** 查询炮塔贴图加载状态（首次调用触发异步加载；结果随加载完成自动翻转，无需重启） */
/** 素材目录解析（§约定俗成法）：art.spriteSet 覆盖 → 通用集；缺省按炮塔 id。缓存 key = 实际文件夹名（多炮塔共享同一通用集缓存条目） */
export function resolveSpriteFolder(def: TurretDef): string {
  return def.art?.spriteSet ?? def.id
}

// ---- 炮塔贴图（分层合成）：四个可见层只解析显式素材库引用 ----

export type LayerPart = 'base' | 'turret' | 'barrel' | 'flash'

/** 分层素材源解析（纯函数）：素材库引用 → src；缺省/none/遗留 geo/失效引用 → [null]。 */
export function turretLayerSrcs(def: TurretDef): Record<LayerPart, (string | null)[]> {
  const art = def.art
  const pick = (assetId: string | undefined): (string | null)[] => {
    if (!assetId || assetId === 'none' || assetId === 'geo') return [null]
    return [getAsset(assetId)?.src ?? null]
  }
  return {
    base: pick(art?.baseAsset),
    turret: pick(art?.turretAsset),
    barrel: pick(art?.barrelAsset),
    flash: pick(art?.flashAsset),
  }
}

export interface SrcImgEntry { status: 'loading' | 'ready' | 'error'; img?: HTMLImageElement }
const SRC_ERROR: SrcImgEntry = { status: 'error' }
const srcCache = new Map<string, SrcImgEntry>() // 缓存 key = 图片 src（库 dataURL / 文件夹路径；同 src 多塔共享）

/** v2.5：旧 '/sprites/' 路径前缀兼容重写为 '/res/'（素材目录迁移；旧口令/localStorage 引用不 404） */
export function resCompatUrl(src: string): string {
  const compatible = src.startsWith('/sprites/') ? '/res/' + src.slice('/sprites/'.length) : src
  return resolvePublicAssetSrc(compatible)
}

export function srcImage(src: string | null): SrcImgEntry {
  if (src === null) return SRC_ERROR
  src = resCompatUrl(src) // v2.5
  const hit = srcCache.get(src)
  if (hit) return hit
  if (typeof Image === 'undefined') { // 无 DOM 环境（sim/node）：静默 error
    srcCache.set(src, SRC_ERROR)
    return SRC_ERROR
  }
  const e: SrcImgEntry = { status: 'loading' }
  srcCache.set(src, e)
  const img = new Image()
  img.onload = () => { e.status = 'ready'; e.img = img }
  img.onerror = () => { e.status = 'error'; e.img = undefined }
  img.src = src
  return e
}

/** 按候选顺序取第一个未失败的层（loading/ready 即采用；全部 error → 缺失）。动态重算：优先候选后续失败自动落到下一候选 */
function srcImageChain(srcs: (string | null)[]): SrcImgEntry {
  for (const src of srcs) {
    if (src === null) continue
    const e = srcImage(src)
    if (e.status !== 'error') return e
  }
  return SRC_ERROR
}

/** v2.3 充能帧条横向等分：按帧数将素材横向均分为 N 帧，返回当前进度应播帧的源矩形（从左到右顺序播放）。
 *  progress ∈ [0,1]，越界钳制到首/末帧；frames 钳制 1~12（与 validateArt 同口径）。 */
export function chargeFrameRect(imgW: number, imgH: number, frames: number, progress: number): { sx: number; sw: number; sh: number } {
  const n = Math.max(1, Math.min(12, Math.floor(frames)))
  const fi = Math.min(n - 1, Math.max(0, Math.floor(progress * n)))
  const sw = imgW / n
  return { sx: fi * sw, sw, sh: imgH }
}

/**
 * 垂发素材横向自动切帧：0=全垂直，末帧=正常飞行，中间帧按时间顺序转向。
 * 规格固定为 7 帧，编辑器不开放帧数，避免不同弹丸产生不兼容协议。
 */
export function verticalLaunchFrameRect(imgW: number, imgH: number, progress: number): { index: number; sx: number; sw: number; sh: number } {
  const frames = VERTICAL_LAUNCH_FRAMES
  const clamped = Math.max(0, Math.min(1, progress))
  const index = Math.min(frames - 1, Math.floor(clamped * frames))
  const sw = imgW / frames
  return { index, sx: index * sw, sw, sh: imgH }
}

/**
 * 弹丸本体统一取帧：普通弹丸使用整张图；垂发导弹把当前 projectileAsset 视为固定 7 帧横向帧条。
 * elapsed 缺省时取末帧（正常飞行姿态），传 0 时取首帧（待发/全垂直姿态）。
 */
export function projectileBodyFrameRect(entry: ProjectileArtDef, imgW: number, imgH: number, elapsed?: number): { index: number; sx: number; sw: number; sh: number } {
  if (entry.kind !== 'missile' || entry.verticalLaunch?.enabled !== true) return { index: 0, sx: 0, sw: imgW, sh: imgH }
  const progress = elapsed === undefined ? 1 : elapsed / verticalLaunchDuration(entry)
  return verticalLaunchFrameRect(imgW, imgH, progress)
}

/** 查询炮塔贴图加载状态：显式素材加载中返回 loading；其余情况均可进入 ready，缺失层保持透明。 */
export function turretArtState(def: TurretDef): ArtEntry {
  const folder = resolveSpriteFolder(def)
  const art = def.art
  const layer = (assetId: string | undefined): SrcImgEntry | null => {
    if (!assetId || assetId === 'none' || assetId === 'geo') return null
    return assetImage(assetId)
  }
  const b = layer(art?.baseAsset)
  const t = layer(art?.turretAsset)
  const r = layer(art?.barrelAsset)
  const f = layer(art?.flashAsset)
  const layers = [b, t, r, f].filter((e): e is SrcImgEntry => e !== null)
  if (layers.some(e => e.status === 'loading')) return { status: 'loading' }
  const assets: TurretArtAssets = {}
  if (b?.img) assets.base = b.img
  if (t?.img) assets.turret = t.img
  if (r?.img) assets.barrel = r.img
  if (f?.status === 'ready' && f.img) assets.flash = f.img
  const g = srcImage(`${'/res/turrets/' + folder}/glow.png`) // 可选（暂不进素材库选配）
  if (g.status === 'ready' && g.img) assets.glow = g.img
  // v1.75：充能素材可选配（charge 分类库引用；'none' = 不播放；缺省 = 文件夹 charge.png 回退）
  const ca = art?.charge?.asset
  const c = ca === 'none' ? null : ca ? assetImage(ca) : srcImage(`${'/res/turrets/' + folder}/charge.png`) // 可选
  if (c && c.status === 'ready' && c.img) assets.charge = c.img
  return { status: 'ready', assets }
}

// ---- v2.7 光束表现（远行星号式分层贴图：光晕层 + 亮芯层 + 命中闪光 + 炮口光球） ----
export interface BeamArtConfig {
  glow: SrcImgEntry | null // 光晕层（null = 程序化旧表现）；加载中/失败由渲染侧回退程序化
  core: SrcImgEntry | null // 亮芯层
  impact: SrcImgEntry | null // 命中点闪光（null = 不显示）
  muzzle: SrcImgEntry | null // 炮口光球（null = 不显示）
  fringeColor: string // 光晕层染色（缺省 #78C8DC）
  coreColor: string // 亮芯层染色（缺省 #F0FAFF）
  flicker: number // 亮度闪烁幅度 0~1（缺省 0.15）
  scrollSpeed: number // 贴图滚动速度 美术 px/s（缺省 96）
  muzzleScale: number // v2.10 发射点闪光缩放（缺省 1）
  impactScale: number // v2.10 命中点闪光缩放（缺省 1）
  absorb: { rate: number; color: string; size: number } | null // v2.10 吸收粒子（发射点向心汇聚；null=未配置）
  scatter: { rate: number; color: string; size: number; angle: number } | null // v2.10 散发粒子（命中点飞溅）；v2.15 angle=散发全锥角（朝射线源 0°，缺省 360 全向）+ 电焊拖尾
  smoke: { rate: number; color: string; size: number } | null // v2.10 烟尘（命中点，不加光）
}
/** v2.9：光束表现核心解析（条目直取）——AmmoPreview 等无炮塔上下文处复用 */
export function beamArtConfigOf(pa: ProjectileArtDef | undefined): BeamArtConfig {
  const b = pa?.beam
  // 层素材：'none' → null；显式引用 → 库条目（/ 开头视为 /res/ 路径）；缺省 → 默认搭配
  const pick = (v: string | undefined, defId: string): SrcImgEntry | null =>
    v === 'none' ? null : v ? (v.startsWith('/') ? srcImage(v) : assetImage(v)) : assetImage(defId)
  const pickFx = (v: string | undefined, defSrc: string): SrcImgEntry | null =>
    v === 'none' ? null : v ? (v.startsWith('/') ? srcImage(v) : assetImage(v)) : srcImage(defSrc)
  const fringeColor = b?.fringeColor ?? '#78C8DC'
  const coreColor = b?.coreColor ?? '#F0FAFF'
  // v2.10 粒子组：组在=生效；颜色缺省随本组配色（吸收=亮芯色、散发=光晕色、烟尘=暗灰）
  const mkFx = (g: { rate?: number; color?: string; size?: number } | undefined, defColor: string, defRate: number, defSize: number) =>
    g ? { rate: g.rate ?? defRate, color: g.color ?? defColor, size: g.size ?? defSize } : null
  return {
    glow: pick(b?.glowAsset, 'builtin:beam/beam_glowA'), // v2.11：默认贴图迁移 /res/beam/
    core: pick(b?.coreAsset, 'builtin:beam/beam_coreA'),
    impact: pickFx(b?.impactAsset, '/res/fx/glow16.png'),
    muzzle: pickFx(b?.muzzleAsset, '/res/fx/glow16.png'),
    fringeColor,
    coreColor,
    flicker: b?.flicker ?? 0.15,
    scrollSpeed: b?.scrollSpeed ?? 96,
    muzzleScale: b?.muzzleScale ?? 1,
    impactScale: b?.impactScale ?? 1,
    absorb: mkFx(b?.absorb, coreColor, 12, 0.05),
    scatter: b?.scatter ? { rate: b.scatter.rate ?? 24, color: b.scatter.color ?? fringeColor, size: b.scatter.size ?? 0.05, angle: b.scatter.angle ?? 360 } : null, // v2.15：angle 缺省 360 全向
    smoke: mkFx(b?.smoke, '#3A3632', 6, 0.1),
  }
}
export function beamArtConfig(def: TurretDef): BeamArtConfig {
  // v2.8：光束表现迁移至弹丸库 ray 条目——经炮塔 art.projectile 引用解析；无引用/条目无 beam 组 → 默认搭配
  return beamArtConfigOf(def.art?.projectile ? projectileArtDef(def.art.projectile) : undefined)
}

// ---- 弹丸美术库（§3A）：/res/projectiles/{ammoId}/{projectile,trail,explosion,impact}.png ----

/** 引用解析（纯函数）：有效 id → 库条目；不存在/未传 → undefined（调用侧回退几何弹丸） */
export function projectileArtDef(ammoId: string | undefined): ProjectileArtDef | undefined {
  if (!ammoId) return undefined
  return PROJECTILE_ARTS.find(a => a.id === ammoId)
}

export interface ProjectileArtAssets {
  projectile: HTMLImageElement // 必填
  trail?: HTMLImageElement
  explosion?: HTMLImageElement
  impact?: HTMLImageElement
}

export interface ProjectileArtEntry {
  status: ArtStatus
  assets?: ProjectileArtAssets
}

const P_FALLBACK: ProjectileArtEntry = { status: 'fallback' }
/** 弹丸条目贴图加载状态（projectile.png 必填，其余可选各自缺失仅影响对应效果） */
/** 弹丸素材目录解析（约定俗成法）：条目 spriteSet 覆盖 → 通用集；缺省按条目 id。缓存 key = 实际文件夹名（多条目共享同一通用集缓存条目） */
export function resolveAmmoFolder(entry: ProjectileArtDef): string {
  return entry.spriteSet ?? entry.id
}

/** 弹丸本体素材源解析（纯函数，与炮塔分层同构）：素材库引用 → spriteSet(遗留) ?? 条目 id 文件夹；'none'/坏引用 → [null]；无素材 → 几何弹丸（通用素材已废止） */
export function ammoProjectileSrc(entry: ProjectileArtDef): (string | null)[] {
  if (entry.projectileAsset === 'none') return [null] // 显式无贴图（几何回退弹丸）
  if (entry.projectileAsset) return [getAsset(entry.projectileAsset)?.src ?? null]
  const folder = resolveAmmoFolder(entry)
  const list: (string | null)[] = [`/res/projectiles/${folder}/projectile.png`] // 无通用兜底：无素材即几何弹丸
  return list
}

// ---- 程序化特效参数（默认填充纯函数；配置了对应段即程序化生成，无素材需求）----
export type TrailTemplate = 'standard' | 'inertia' | 'pulse' | 'smoke'
export type ExplosionTemplate = 'small' | 'medium' | 'large'
export type ImpactTemplate = 'bullet' | 'armorPiercing' | 'heavyArmorPiercing'

/** 模板默认（覆盖顺序：模板默认 < 用户显式参数） */
const TRAIL_TEMPLATES: Record<TrailTemplate, { rate: number; life: number; size: number; inherit: number; spread: number; grow: number; fadeIn: number; drag: number; color?: string }> = {
  standard: { rate: 54, life: 0.32, size: 0.055, inherit: 0.18, spread: 0.5, grow: -0.15, fadeIn: 0, drag: 3.2 }, // 标准尾焰：短、清晰，适合常规火箭/导弹
  inertia: { rate: 64, life: 0.55, size: 0.06, inherit: 0.9, spread: 0.42, grow: -0.08, fadeIn: 0, drag: 4 }, // 惯性尾焰：明显保留弹体侧向速度，转弯时形成弧形甩尾
  pulse: { rate: 72, life: 0.38, size: 0.065, inherit: 0.22, spread: 0.55, grow: -0.1, fadeIn: 0.02, drag: 3 }, // 脉冲尾焰：速率 1.2Hz 振荡 + 尺寸/alpha 闪烁
  smoke: { rate: 22, life: 1.35, size: 0.15, inherit: 0.1, spread: 0.75, grow: 1.8, fadeIn: 0.08, drag: 1.5, color: '#6B6560' }, // 烟雾尾迹：低速率、长寿命、持续膨胀
}

const EXPLOSION_TEMPLATES: Record<ExplosionTemplate, Omit<ExplosionFxParams, 'template' | 'color'>> = {
  small: { duration: 0.28, visualScale: 0.72, sparks: 7, smoke: 3, speedJitter: 0.3, lifeJitter: 0.2, turbulence: 0.35, rings: 1, ringSpeed: 1.25, ringWidth: 1.5, bias: 0.05, inherit: 0.08, fireball: 0.7, shock: 0.55, flash: 0.25, streak: 0 },
  medium: { duration: 0.4, visualScale: 1, sparks: 14, smoke: 7, speedJitter: 0.45, lifeJitter: 0.32, turbulence: 0.65, rings: 2, ringSpeed: 1, ringWidth: 2.5, bias: 0.1, inherit: 0.12, fireball: 1, shock: 1, flash: 0.55, streak: 1 },
  large: { duration: 0.58, visualScale: 1.38, sparks: 28, smoke: 16, speedJitter: 0.65, lifeJitter: 0.48, turbulence: 1.1, rings: 3, ringSpeed: 0.9, ringWidth: 4, bias: 0.15, inherit: 0.2, fireball: 1.35, shock: 1.45, flash: 0.95, streak: 1 },
}

const IMPACT_TEMPLATES: Record<ImpactTemplate, Omit<ImpactFxParams, 'template' | 'color'>> = {
  bullet: { duration: 0.12, spikes: 4, speed: 2.6, life: 0.18, size: 0.028, drag: 7, streak: 0, angle: 150, bias: 0.55 },
  armorPiercing: { duration: 0.18, spikes: 8, speed: 4.2, life: 0.28, size: 0.04, drag: 5.5, streak: 1, angle: 110, bias: 0.72 },
  heavyArmorPiercing: { duration: 0.26, spikes: 15, speed: 5.8, life: 0.4, size: 0.06, drag: 4.5, streak: 1, angle: 135, bias: 0.82 },
}

export interface TrailFxParams {
  template: TrailTemplate
  color: string
  colorEnd?: string // 缺省 = 不变色
  rate: number
  life: number
  size: number
  inherit: number // 0–1
  spread: number // 弧度
  grow: number
  fadeIn: number
  drag: number // 模板决定（不开放编辑）
  smoke?: { rate: number; life: number; color: string; duration?: number } // v2.20 长存留烟雾尾迹（与主尾焰并行的第二股粒子流；trail.smoke 组在=生效）；v2.23 duration=「持续」（点火后喷射窗口，缺省=整个燃烧期）
}

/** v2.23：烟尾「持续」有效时长——点火后烟尾喷射窗口（秒）；超过引用炮塔 burnTime 时按 burnTime 钳制；
 *  返回 undefined = 未配置持续（整个燃烧期都喷）。渲染侧调用（战场），弹丸预览无炮塔上下文不钳 */
export function smokeDuration(duration: number | undefined, burnTime: number | undefined): number | undefined {
  if (duration === undefined) return undefined
  return burnTime !== undefined ? Math.min(duration, burnTime) : duration
}

export function resolveTrailFx(e: ProjectileArtDef): TrailFxParams | null {
  if (!e.trail) return null
  const t = e.trail.template ?? 'standard'
  const d = TRAIL_TEMPLATES[t]
  return {
    template: t,
    color: e.trail.color ?? d.color ?? PROJECTILE_KIND_COLOR[e.kind],
    colorEnd: e.trail.colorEnd,
    rate: e.trail.rate ?? d.rate,
    life: e.trail.life ?? d.life,
    size: e.trail.size ?? d.size,
    inherit: Math.min(1, Math.max(0, e.trail.inherit ?? d.inherit)),
    spread: e.trail.spread ?? d.spread,
    grow: e.trail.grow ?? d.grow,
    fadeIn: e.trail.fadeIn ?? d.fadeIn,
    drag: d.drag,
    smoke: e.trail.smoke ? { // v2.20 长存留烟雾：组在=生效，缺省 rate 20 粒/s、life 3s、浅灰；v2.23 duration=持续（可选）
      rate: e.trail.smoke.rate ?? 20,
      life: e.trail.smoke.life ?? 3,
      color: e.trail.smoke.color ?? '#9A958E',
      duration: e.trail.smoke.duration,
    } : undefined,
  }
}
export interface ExplosionFxParams {
  template: ExplosionTemplate
  color: string
  duration: number
  visualScale: number
  sparks: number
  smoke: number
  speedJitter: number // 0–1
  lifeJitter: number // 0–1
  turbulence: number // 0–2（烟尘）
  rings: number // 1–4
  ringSpeed: number
  ringWidth: number // px
  bias: number // 0–1（方向偏置）
  inherit: number // 0–1（速度继承）
  fireball: number // v2.54：0–2 火球尺寸系数（0=关闭）
  shock: number // v2.54：0–2 软边冲击波厚度系数（0=旧细描边环）
  flash: number // v2.54：0–1 瞬时照明强度（0=关闭）
  streak: number // v2.54：0|1 火花拉丝
}

/**
 * 取得弹丸爆炸模板的完整表现参数。单位摧毁、战场弹丸和弹丸预览共用此入口，
 * 避免各自复制一套火球、冲击环和粒子数量后产生画面差异。
 */
export function explosionTemplateFx(template: ExplosionTemplate, color: string): ExplosionFxParams {
  return { template, color, ...EXPLOSION_TEMPLATES[template] }
}

export function resolveExplosionFx(e: ProjectileArtDef): ExplosionFxParams | null {
  if (!e.explosion) return null
  const t = e.explosion.template ?? 'medium'
  const d = explosionTemplateFx(t, e.explosion.color ?? PROJECTILE_KIND_COLOR[e.kind])
  return {
    template: t,
    color: e.explosion.color ?? d.color,
    duration: e.explosion.duration ?? d.duration,
    visualScale: Math.min(3, Math.max(0.1, e.explosion.visualScale ?? d.visualScale)),
    sparks: e.explosion.sparks ?? d.sparks,
    smoke: e.explosion.smoke ?? d.smoke,
    speedJitter: Math.min(1, Math.max(0, e.explosion.speedJitter ?? d.speedJitter)),
    lifeJitter: Math.min(1, Math.max(0, e.explosion.lifeJitter ?? d.lifeJitter)),
    turbulence: Math.min(2, Math.max(0, e.explosion.turbulence ?? d.turbulence)),
    rings: Math.min(4, Math.max(1, Math.round(e.explosion.rings ?? d.rings))),
    ringSpeed: e.explosion.ringSpeed ?? d.ringSpeed,
    ringWidth: e.explosion.ringWidth ?? d.ringWidth,
    bias: Math.min(1, Math.max(0, e.explosion.bias ?? d.bias)),
    inherit: Math.min(1, Math.max(0, e.explosion.inherit ?? d.inherit)),
    fireball: Math.min(2, Math.max(0, e.explosion.fireball ?? d.fireball)),
    shock: Math.min(2, Math.max(0, e.explosion.shock ?? d.shock)),
    flash: Math.min(1, Math.max(0, e.explosion.flash ?? d.flash)),
    streak: (e.explosion.streak ?? d.streak) === 0 ? 0 : 1,
  }
}
export interface ImpactFxParams {
  template: ImpactTemplate
  color: string
  duration: number
  spikes: number
  speed: number
  life: number
  size: number
  drag: number
  streak: number
  angle: number
  bias: number
}
export function resolveImpactFx(e: ProjectileArtDef): ImpactFxParams | null {
  if (!e.impact) return null
  const t = e.impact.template ?? 'bullet'
  const d = IMPACT_TEMPLATES[t]
  return {
    template: t,
    color: e.impact.color ?? PROJECTILE_KIND_COLOR[e.kind],
    duration: Math.min(5, Math.max(0.01, e.impact.duration ?? d.duration)),
    spikes: Math.min(100, Math.max(0, Math.round(e.impact.spikes ?? d.spikes))),
    speed: Math.min(50, Math.max(0, e.impact.speed ?? d.speed)),
    life: Math.min(5, Math.max(0.01, e.impact.life ?? d.life)),
    size: Math.min(2, Math.max(0.005, e.impact.size ?? d.size)),
    drag: Math.min(30, Math.max(0, e.impact.drag ?? d.drag)),
    streak: (e.impact.streak ?? d.streak) === 1 ? 1 : 0,
    angle: Math.min(360, Math.max(0, e.impact.angle ?? d.angle)),
    bias: Math.min(1, Math.max(0, e.impact.bias ?? d.bias)),
  }
}

/** 弹丸条目贴图加载状态：本体按解析链（库引用 ?? 文件夹），trail/explosion/impact 帧条为旧素材回退（程序化段未配置时仍可用） */
export function projectileArtState(entry: ProjectileArtDef): ProjectileArtEntry {
  // 本体：库引用（'none' = 显式无 → 回退）优先经 assetImage；缺省经 srcCache（文件夹）
  if (entry.projectileAsset === 'none') return P_FALLBACK
  const body = entry.projectileAsset ? assetImage(entry.projectileAsset) : srcImageChain(ammoProjectileSrc(entry))
  if (body.status === 'error') return P_FALLBACK
  if (body.status !== 'ready' || !body.img) return { status: 'loading' }
  const folder = resolveAmmoFolder(entry)
  const assets: ProjectileArtAssets = { projectile: body.img }
  for (const k of ['trail', 'explosion', 'impact'] as const) { // 旧帧条可选件（回退兼容）：成功挂上，失败仅无该效果
    const e = srcImage(`/res/projectiles/${folder}/${k}.png`)
    if (e.status === 'ready' && e.img) assets[k] = e.img
  }
  return { status: 'ready', assets }
}
