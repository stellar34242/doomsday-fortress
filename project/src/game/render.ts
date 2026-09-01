// 战场画布渲染：低饱和废土漫画风（粗黑描边、硬阴影）
import {
  FLASH_DURATION, FLASH_FRAME_DUR, FLASH_FRAMES, FLASH_SCALES, M_PER_CELL, SPAWN_ROWS,
  TURRET_DEFS, PROJECTILE_KIND_COLOR, MODULE_DEFS, BASE_CELL, VEHICLE_PLACEHOLDER_COLOR, hardpointBelowVehicleBody, verticalLaunchDuration,
} from './config'
import { isInnerCell, LEVEL, objectiveFinishCells } from './level'
import { artMounts, beamLength, centeredTrackPlacements, currentUnitAltitude, defOf, eventRandom, interactionBubbles, turretRenderKey, dirX, dirY, fortressDef, fortressLocalCenter, fortressRect, fortressInteriorSet, hardpointOf, levelServiceZones, MISSILE_FADE, missileVisHeading, moduleCells, moduleFoot, muzzlePos, playerTeamVisionRadiusCells, playerTeamVisionSources, projectileAltitudeAtTravel, RACK_RELOAD_ANIM, rackCounts, rackMissilePos, shellArcVisual, turretCenter, ENEMY_PROJECTILE_VISUAL_SIZE, GEOMETRIC_BULLET_VISUAL_SIZE, wheelFrameCount, wheelPlacements, wheelRollFrame, wheelVisualSteerAngle, type BattleVisionSource, type MuzzleEvent, type ShellArcVisual } from './engine'
import { SPECIAL_BOOST_NAME } from './config'
import { centeredRect } from './geometry'
import { enemyKindForUnit, fortressUnitId, rotorPlacements, runtimeAllyUnitDef, runtimeEnemyUnitDef, unitCollisionRadii, unitDefById, unitShadowOpacity, unitShadowScale, unitTypeConfig, type RotorDef, type UnitDef, type UnitVisual } from './unit'
import { objectTypeById, terrainTypeById } from './worlddef'
import type { LevelTileCell } from './levelEditor'

// ---- 载具贴图缓存（dataURL；render 每帧轮询，加载完成自动生效） ----
const fortressSpriteCache = new Map<string, { status: 'loading' | 'ready' | 'error'; img?: HTMLImageElement }>()
function fortressSprite(srcData?: string): HTMLImageElement | null {
  if (!srcData || srcData === 'none') return null
  srcData = getAsset(srcData)?.src ?? srcData // 载具素材从素材库按 id 选择；遗留路径继续直读
  srcData = resCompatUrl(srcData) // v2.5 兼容旧 /sprites/ 路径
  let e = fortressSpriteCache.get(srcData)
  if (!e) {
    e = { status: 'loading' }
    fortressSpriteCache.set(srcData, e)
    try {
      const img = new Image()
      img.onload = () => { const c = fortressSpriteCache.get(srcData); if (c) { c.status = 'ready'; c.img = img } }
      img.onerror = () => { const c = fortressSpriteCache.get(srcData); if (c) c.status = 'error' }
      img.src = srcData
    } catch {
      e.status = 'error'
    }
  }
  return e.status === 'ready' && e.img ? e.img : null
}

/** 主体局部空间中的动态旋翼层；调用方已完成单位位置、朝向和镜像变换。 */
function drawRotors(ctx: CanvasRenderingContext2D, rotors: RotorDef[] | undefined, layer: 'below' | 'above', cell: number, time: number, scale = 1): void {
  const nativeScale = cell / BASE_CELL * scale
  for (const rotor of rotors ?? []) {
    if ((rotor.layer ?? 'above') !== layer) continue
    const image = fortressSprite(rotor.asset)
    if (!image) continue
    for (const placement of rotorPlacements(rotor)) {
      ctx.save()
      ctx.translate(placement.x * nativeScale, placement.y * nativeScale)
      ctx.rotate(time * placement.speed * Math.PI / 180)
      ctx.drawImage(image, -image.naturalWidth * nativeScale / 2, -image.naturalHeight * nativeScale / 2, image.naturalWidth * nativeScale, image.naturalHeight * nativeScale)
      ctx.restore()
    }
  }
}

function drawUnitRotors(ctx: CanvasRenderingContext2D, unit: UnitDef, layer: 'below' | 'above', cell: number, time: number, scale = 1): void {
  const config = unitTypeConfig(unit)
  if (config?.kind === 'rotorcraft') drawRotors(ctx, config.rotors, layer, cell, time, scale)
}

/** 坠毁时逐步降低旋翼角速度，同时保持进入坠毁前后的旋转相位连续。 */
function aircraftRotorVisualTime(time: number, crash: { startedAt: number; elapsed: number; duration: number } | undefined): number {
  if (!crash) return time
  const elapsed = Math.max(0, Math.min(crash.duration, crash.elapsed))
  return crash.startedAt + elapsed - 0.46 * elapsed * elapsed / Math.max(0.001, crash.duration)
}

/** 单位主体统一绘制；带 spriteSheet 元数据时只截取对应横向状态格。 */
function drawUnitBody(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  assetRef: string | undefined,
  state: AssetSpriteState,
  box: { x: number; y: number; w: number; h: number },
  source: CanvasImageSource = image,
): void {
  const sheet = assetRef ? getAsset(assetRef)?.spriteSheet : undefined
  if (!sheet) {
    ctx.drawImage(source, box.x, box.y, box.w, box.h)
    return
  }
  const columns = Math.max(1, Math.floor(image.naturalWidth / sheet.frameWidth))
  const index = Math.min(columns - 1, Math.max(0, sheet.stateFrames[state]))
  ctx.drawImage(
    source,
    index * sheet.frameWidth, 0, sheet.frameWidth, Math.min(sheet.frameHeight, image.naturalHeight),
    box.x, box.y, box.w, box.h,
  )
}

/** 统一计算单位主体相对几何原点的绘制框；原尺寸模式随战场缩放，但不再被格宽高拉伸。 */
function unitBodyBox(image: HTMLImageElement, visual: UnitVisual, cell: number, bossScale = 1): { x: number; y: number; w: number; h: number } {
  const sheet = visual.bodyAsset ? getAsset(visual.bodyAsset)?.spriteSheet : undefined
  const nativeScale = cell / BASE_CELL
  const width = (visual.nativeSize ? (sheet?.frameWidth ?? image.naturalWidth) * nativeScale : visual.width * cell) * bossScale
  const height = (visual.nativeSize ? (sheet?.frameHeight ?? image.naturalHeight) * nativeScale : visual.height * cell) * bossScale
  const offsetX = (visual.offsetX ?? 0) * nativeScale * bossScale
  const offsetY = (visual.offsetY ?? 0) * nativeScale * bossScale
  return centeredRect(offsetX, offsetY, width, height)
}

export interface AirUnitShadowTransform {
  offsetX: number
  offsetY: number
  scale: number
  opacity: number
  heading: number
}

/** 飞行单位地面投影：保留现有随高度缩小、变淡的口径，并让主体轮廓直接复用单位朝向。 */
export function airUnitShadowTransform(unit: UnitDef, altitude: number, cell: number, heading: number): AirUnitShadowTransform {
  const offset = Math.max(1, altitude * cell * 0.12)
  return {
    offsetX: offset,
    offsetY: offset,
    scale: unitShadowScale(unit, altitude),
    opacity: unitShadowOpacity(unit, altitude),
    heading,
  }
}

function drawAirUnitShadow(
  ctx: CanvasRenderingContext2D,
  unit: UnitDef,
  altitude: number,
  cell: number,
  px: number,
  py: number,
  heading: number,
  flipX: boolean,
  drawSilhouette: () => void,
): void {
  const shadow = airUnitShadowTransform(unit, altitude, cell, heading)
  ctx.save()
  ctx.translate(px + shadow.offsetX, py + shadow.offsetY)
  ctx.rotate(shadow.heading)
  ctx.scale(flipX ? -shadow.scale : shadow.scale, shadow.scale)
  ctx.globalAlpha *= shadow.opacity
  ctx.imageSmoothingEnabled = false
  drawSilhouette()
  ctx.restore()
}

export interface GroundEntityShadowTransform {
  offsetX: number
  offsetY: number
  scaleY: number
  opacity: number
}

/**
 * 地面实体的统一硬阴影。高度只影响投影距离，不参与碰撞；步兵会在纵向压扁，形成贴地接触感。
 * 该函数保持纯计算，供模拟测试和编辑器预览共用。
 */
export function groundEntityShadowTransform(height: number, cell: number, flattened = false): GroundEntityShadowTransform {
  const level = Math.max(0, Math.min(3, Math.round(Number.isFinite(height) ? height : 0)))
  const zoom = cell / BASE_CELL
  const offset = (3 + level * 2) * zoom
  return {
    offsetX: offset,
    offsetY: offset,
    scaleY: flattened ? 0.68 : 1,
    opacity: Math.max(0.18, 0.27 - level * 0.015),
  }
}

const BATTLE_VISION_FEATHER_CELLS = 10
const BATTLE_VISION_SHADOW_ALPHA = 0.5
let battleVisionOverlayCanvas: HTMLCanvasElement | null = null
const battleVisionCutoutCache = new Map<string, HTMLCanvasElement>()

function battleVisionCutout(radiusPx: number, featherPx: number): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null
  const radius = Math.max(1, Math.round(radiusPx))
  const feather = Math.max(1, Math.min(radius, Math.round(featherPx)))
  const key = `${radius}:${feather}`
  const cached = battleVisionCutoutCache.get(key)
  if (cached) return cached
  if (battleVisionCutoutCache.size >= 24) battleVisionCutoutCache.clear()
  const pad = 2
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = radius * 2 + pad * 2
  const context = canvas.getContext('2d')
  if (!context) return null
  const center = radius + pad
  const gradient = context.createRadialGradient(center, center, 0, center, center, radius)
  const inner = Math.max(0, Math.min(0.995, (radius - feather) / radius))
  gradient.addColorStop(0, 'rgba(0,0,0,1)')
  gradient.addColorStop(inner, 'rgba(0,0,0,1)')
  gradient.addColorStop(1, 'rgba(0,0,0,0)')
  context.fillStyle = gradient
  context.fillRect(0, 0, canvas.width, canvas.height)
  battleVisionCutoutCache.set(key, canvas)
  return canvas
}

/** 当前两层视野的单次合成：场景保留在暗层，所有共享来源从遮罩中挖出柔边可见区。 */
function drawBattleVisionOverlay(
  ctx: CanvasRenderingContext2D,
  sources: BattleVisionSource[],
  radiusCells: number,
  cell: number,
  X: (x: number) => number,
  Y: (y: number) => number,
  width: number,
  height: number,
): void {
  if (typeof document === 'undefined') return
  if (!battleVisionOverlayCanvas) battleVisionOverlayCanvas = document.createElement('canvas')
  if (battleVisionOverlayCanvas.width !== width || battleVisionOverlayCanvas.height !== height) {
    battleVisionOverlayCanvas.width = width
    battleVisionOverlayCanvas.height = height
  }
  const overlay = battleVisionOverlayCanvas.getContext('2d')
  if (!overlay) return
  overlay.clearRect(0, 0, width, height)
  overlay.globalCompositeOperation = 'source-over'
  overlay.globalAlpha = 1
  overlay.fillStyle = `rgba(0,0,0,${BATTLE_VISION_SHADOW_ALPHA})`
  overlay.fillRect(0, 0, width, height)
  const radiusPx = radiusCells * cell
  const cutout = battleVisionCutout(radiusPx, BATTLE_VISION_FEATHER_CELLS * cell)
  if (cutout) {
    overlay.globalCompositeOperation = 'destination-out'
    const half = cutout.width / 2
    for (const source of sources) overlay.drawImage(cutout, X(source.x) - half, Y(source.y) - half)
    overlay.globalCompositeOperation = 'source-over'
  }
  ctx.save()
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
  ctx.drawImage(battleVisionOverlayCanvas, 0, 0)
  ctx.restore()
}

function drawGroundEntityShadow(
  ctx: CanvasRenderingContext2D,
  height: number,
  cell: number,
  px: number,
  py: number,
  heading: number,
  flipX: boolean,
  flattened: boolean,
  drawSilhouette: () => void,
): void {
  const shadow = groundEntityShadowTransform(height, cell, flattened)
  ctx.save()
  ctx.translate(px + shadow.offsetX, py + shadow.offsetY)
  ctx.rotate(heading)
  ctx.scale(flipX ? -1 : 1, shadow.scaleY)
  ctx.globalAlpha *= shadow.opacity
  ctx.imageSmoothingEnabled = false
  drawSilhouette()
  ctx.restore()
}

function unitUsesFlattenedShadow(unit: UnitDef | undefined): boolean {
  if (!unit || unit.stats.air || unit.vehiclePlatform || unit.legacy?.registry === 'fortress') return false
  if (unit.legacy?.registry === 'ally') return unit.legacy.id === 'soldier'
  return unit.legacy?.registry === 'enemy'
}

export function walkerFrameCount(def: FortressDef): number {
  return def.chassis === 'walker' ? WALKER_FRAMES : 1
}

export function walkerFrameIndex(def: FortressDef, phase: number): number {
  const frames = walkerFrameCount(def)
  if (frames <= 1 || phase <= 0) return 0
  // phase 是实际移动距离（格）；2×7 素材的每一行代表一次单脚动作。
  // 兼容尚未经过持久化迁移的旧定义：步幅 = 满速 × 单帧时长 × 7。
  const legacyStride = Math.max(0.05, def.speed * Math.max(0.03, Math.min(2, def.walkerFrameDuration ?? 0.125)) * WALKER_COLUMNS)
  const stride = Math.max(0.05, Math.min(20, def.walkerStride ?? legacyStride))
  const frameDistance = stride / WALKER_COLUMNS
  return Math.floor(phase / frameDistance) % frames
}

export const WALKER_COLUMNS = 7
export const WALKER_ROWS = 2
export const WALKER_FRAMES = WALKER_COLUMNS * WALKER_ROWS

/** 单一载具素材统一绘制；步行机甲固定把主体解释为 2 行×7 列序列帧。 */
function drawVehicleImage(
  ctx: CanvasRenderingContext2D, image: HTMLImageElement, def: FortressDef, scale: number, walkPhase = 0, source: CanvasImageSource = image,
  walkSettleBlend = 0,
): void {
  const walker = def.chassis === 'walker'
  const columns = walker ? WALKER_COLUMNS : 1
  const rows = walker ? WALKER_ROWS : 1
  const sourceWidth = image.naturalWidth / columns
  const sourceHeight = image.naturalHeight / rows
  const drawWidth = sourceWidth * scale
  const drawHeight = sourceHeight * scale
  const frame = walkerFrameIndex(def, walkPhase)
  const offsetX = walker ? (def.walkerBodyOffsetX ?? 0) * scale : 0
  const offsetY = walker ? (def.walkerBodyOffsetY ?? 0) * scale : 0
  const drawFrame = (frameIndex: number) => {
    const sourceX = (frameIndex % columns) * sourceWidth
    const sourceY = Math.floor(frameIndex / columns) * sourceHeight
    ctx.drawImage(source, sourceX, sourceY, sourceWidth, sourceHeight, offsetX - drawWidth / 2, offsetY - drawHeight / 2, drawWidth, drawHeight)
  }
  const blend = walker ? Math.max(0, Math.min(1, walkSettleBlend)) : 0
  if (blend > 0 && frame !== 0) {
    const alpha = ctx.globalAlpha
    ctx.globalAlpha = alpha * (1 - blend)
    drawFrame(frame)
    ctx.globalAlpha = alpha * blend
    drawFrame(0)
    ctx.globalAlpha = alpha
  } else drawFrame(frame)
}

/** 挂载炮塔的低成本轮廓投影；不重新走炮塔特效/选中态，避免阴影层引入额外状态和绘制开销。 */
function drawMountedTurretShadowSilhouettes(
  ctx: CanvasRenderingContext2D,
  vehicle: FortressDef,
  turrets: readonly Turret[],
  vehicleHeading: number,
  cell: number,
  scale = 1,
): void {
  const center = fortressLocalCenter(vehicle)
  for (const turret of turrets) {
    const hardpoint = vehicle.hardpoints.find(item => item.id === turret.hardpointId)
    if (!hardpoint || hardpoint.hideTurretArt || hardpoint.hidden) continue
    const def = defOf(turret.defId)
    const radius = cell * scale * (def.mount === 'L' ? 0.3 : def.mount === 'M' ? 0.24 : 0.19)
    ctx.save()
    ctx.translate((hardpoint.x - center.x) * cell * scale, (hardpoint.y - center.y) * cell * scale)
    ctx.rotate(turret.angle - vehicleHeading)
    ctx.fillStyle = '#000000'
    ctx.beginPath()
    ctx.arc(0, 0, radius, 0, Math.PI * 2)
    ctx.fill()
    if (def.type !== 'missile') ctx.fillRect(-radius * 0.24, -radius * 1.8, radius * 0.48, radius * 1.7)
    ctx.restore()
  }
}

/** 所有阵营与玩家共用的载具主体层：主体、占位轮廓与贴花只在这里定义。 */
function drawVehicleBodyLayer(
  ctx: CanvasRenderingContext2D,
  def: FortressDef,
  bodyImage: HTMLImageElement | null,
  nativeScale: number,
  cell: number,
  localScale: number,
  walkPhase = 0,
  walkSettleBlend = 0,
): void {
  if (bodyImage) {
    const paintedBody = def.paint?.base ? tintedFx(bodyImage, def.paint.base, 'multiply') : null
    drawVehicleImage(ctx, bodyImage, def, nativeScale, walkPhase, paintedBody ?? bodyImage, walkSettleBlend)
  } else {
    ctx.fillStyle = def.paint?.base ?? VEHICLE_PLACEHOLDER_COLOR
    ctx.strokeStyle = '#1A1A18'
    ctx.lineWidth = 2
    ctx.fillRect(-def.w * cell * localScale / 2, -def.h * cell * localScale / 2, def.w * cell * localScale, def.h * cell * localScale)
    ctx.strokeRect(-def.w * cell * localScale / 2, -def.h * cell * localScale / 2, def.w * cell * localScale, def.h * cell * localScale)
  }
  const center = fortressLocalCenter(def)
  for (const decal of def.decals ?? []) {
    const image = trackTileImage(decal.asset)
    if (!image) continue
    const size = Math.max(0.1, decal.size) * cell * localScale
    const ratio = image.width / Math.max(1, image.height)
    ctx.save()
    ctx.translate((decal.x - center.x) * cell * localScale, (decal.y - center.y) * cell * localScale)
    ctx.rotate((decal.angle ?? 0) * Math.PI / 180)
    ctx.drawImage(image, -size * ratio / 2, -size / 2, size * ratio, size)
    ctx.restore()
  }
}

// ---- v1.85/v1.86 履带瓦片：库引用/路径/dataURL 原图直绘（不旋转：图宽 = 履带宽度方向，图高 = 板长方向）----
function trackTileImage(ref: string): HTMLImageElement | null {
  if (typeof document === 'undefined') return null
  const e = getAsset(ref) ? assetImage(ref) : srcImage(ref) // 库条目走 assetImage；否则按路径/dataURL
  return e.status === 'ready' && e.img ? e.img : null // 加载中/失败：本帧跳过，下一帧重试
}

/** 提前触发载具相关图片进入与实战绘制相同的缓存。 */
export function prewarmVehicleRenderAssets(def: FortressDef): void {
  fortressSprite(def.spriteBody)
  for (const track of def.tracks ?? []) trackTileImage(track.tile)
  for (const wheel of def.wheels ?? []) if (wheel.sprite) trackTileImage(wheel.sprite)
  for (const rotor of def.rotors ?? []) fortressSprite(rotor.asset)
  for (const decal of def.decals ?? []) trackTileImage(decal.asset)
  for (const hardpoint of def.hardpoints ?? []) {
    const turret = hardpoint.builtIn ? TURRET_DEFS.find(item => item.id === hardpoint.builtIn) : undefined
    if (turret) prewarmTurretRenderAssets(turret)
  }
}

/** 提前触发单位主体、飞行旋翼与复用载具平台进入渲染缓存。 */
export function prewarmUnitRenderAssets(unit: UnitDef): void {
  fortressSprite(unit.visual?.bodyAsset)
  const typeConfig = unitTypeConfig(unit)
  if (typeConfig?.kind === 'rotorcraft') for (const rotor of typeConfig.rotors ?? []) fortressSprite(rotor.asset)
  const vehicle = unit.legacy?.registry === 'fortress' ? unit.legacy.def : unit.vehiclePlatform
  if (vehicle) prewarmVehicleRenderAssets(vehicle)
}

/** 提前触发炮塔分层图片及其弹丸图片进入渲染缓存。 */
export function prewarmTurretRenderAssets(def: TurretDef): void {
  turretArtState(def)
  const projectile = projectileArtDef(def.art?.projectile)
  if (projectile) projectileArtState(projectile)
}
import { chargeFrameRect, turretArtState, projectileArtDef, projectileArtState, projectileBodyFrameRect, resolveTrailFx, resolveExplosionFx, resolveImpactFx, explosionTemplateFx, srcImage, resCompatUrl, beamArtConfig, smokeDuration, type ExplosionFxParams, type ProjectileArtAssets, type TurretArtAssets } from './art'
import { assetImage, getAsset, type AssetSpriteState } from './assetlib'
import { createPool, glowFlicker, projectileTailEmitter, projectileTrailVelocity, rearOnlyTrailVelocity, spawnBurst, spawnTrail, stepParticles, type ParticlePool } from './particles'
import { drawExplosionLayers, drawImpactFlash, drawParticlePool, hexA, tintedFx } from './fxDraw' // v2.55：特效画法统一走共用层
import { emitFortressEffects, emitVehicleEffects, updateTrackMarks, TRACK_MARK_LIFE, TRACK_MARK_FADE, TRACK_MARK_ALPHA, type TrackMark, type TrackMarkState } from './fortressFx' // v2.40 堡垒特效点粒子化；v2.41 履带印；v2.43 印透明度/渐隐参数
import { craterOpacity, updateCraters, type Crater } from './craters'
import { rmxpAutotileIndex, rmxpQuarterSrc, RMXP_SUBTILES } from './autotile'
import type { BeamFadeMode, FortressDef, ProjectileArtDef, TurretDef, UnitDestructionEffect } from './config'
import { registerFortressBodyImage } from './fortressBodyMask'
import { dilateShieldMask, resampleShieldContour, sampleShieldMaskInterior, traceShieldMaskContours, type ShieldMaskPoint } from './shieldMask'

// v2.55：fadeColor / tintedFx / hexRgb / hexA / drawParticlePool / drawExplosionLayers / drawImpactFlash 已迁至 ./fxDraw（战场与编辑器预览共用画法层）

export interface UnitDestructionVisualParams {
  explosion: ExplosionFxParams
  debrisCount: number
  debrisSpeed: number
  debrisLife: number
  debrisDrag: number
  debrisSize: number
  debrisSpriteScale: number
}

/** 单位摧毁复用弹丸爆炸模板，仅额外附加更远的实体残骸和剧烈档连锁爆炸。 */
export function unitDestructionVisualParams(effect: UnitDestructionEffect): UnitDestructionVisualParams {
  const rank = effect === 'small' ? 0 : effect === 'medium' ? 1 : effect === 'large' ? 2 : 3
  const template = effect === 'small' ? 'small' : effect === 'medium' ? 'medium' : 'large'
  const base = explosionTemplateFx(template, effect === 'small' ? '#E89A36' : '#F08B2D')
  const wreckageScalePercent = gameParameters().unitDestructionWreckageScalePercent[effect]
  return {
    explosion: effect === 'violent' ? {
      ...base,
      visualScale: 1.62,
      sparks: 40,
      smoke: 24,
      rings: 4,
      turbulence: 1.35,
      fireball: 1.6,
      shock: 1.65,
      flash: 1,
    } : base,
    debrisCount: 4 + rank * 3,
    debrisSpeed: 4.2 + rank * 0.7,
    debrisLife: 1.05 + rank * 0.28,
    debrisDrag: 0.9 - rank * 0.08,
    debrisSize: 0.072 + rank * 0.016,
    debrisSpriteScale: wreckageScalePercent / 100,
  }
}

/** v2.7 光束贴图层（远行星号式）：局部坐标系（原点=光束起点，+x 沿光束方向）内沿轴向无缝平铺染色贴图并滚动；
 *  img 为 null 时回退程序化矩形（与旧版等效：颜色/宽度相同，alpha 由调用方合成）。加法发光。 */
export function drawBeamLayer(ctx: CanvasRenderingContext2D, img: HTMLCanvasElement | null, color: string, lenPx: number, widthPx: number, alpha: number, scrollPx: number, texScale = 1, vScale = 1) {
  ctx.globalAlpha = alpha
  if (img) {
    ctx.globalCompositeOperation = 'lighter'
    // 贴图按原生尺寸平铺不缩放（128×32 → 每块 128×32×texScale；texScale = cell/BASE_CELL 适配战场缩放）
    // v2.36：vScale 纵向收窄（停火消退亮芯层 p→0）；贴图块高度按 vScale 缩放、保持纵向居中
    const tileW = Math.max(1, img.width * texScale)
    const tileH = img.height * texScale * vScale
    if (tileH < 0.5) { ctx.globalAlpha = 1; return } // 收窄到不可见即跳过
    const off = scrollPx > 0 ? scrollPx % tileW : 0
    for (let dx = -off; dx < lenPx; dx += tileW) {
      const d0 = Math.max(0, dx)
      const d1 = Math.min(lenPx, dx + tileW)
      if (d1 <= d0) continue
      const s0 = ((d0 - dx) / tileW) * img.width
      const s1 = ((d1 - dx) / tileW) * img.width
      ctx.drawImage(img, s0, 0, s1 - s0, img.height, d0, -tileH / 2, d1 - d0, tileH)
    }
    ctx.globalCompositeOperation = 'source-over'
  } else {
    ctx.fillStyle = hexA(color, 1)
    ctx.fillRect(0, -widthPx / 2, lenPx, widthPx) // 程序化回退仍按光束宽幅
  }
  ctx.globalAlpha = 1
}

/** 停火残影从炮口端向命中点收束：起点前移、终点保持在原命中位置。 */
export function beamFadeSpan(fullLength: number, progress: number, mode: BeamFadeMode = 'shrink'): { start: number; length: number } {
  const p = Math.max(0, Math.min(1, progress))
  return mode === 'transfer'
    ? { start: fullLength * (1 - p), length: fullLength * p }
    : { start: 0, length: fullLength }
}

/** 弹丸美术解析（§3A）：引用有效且贴图 ready → 条目+素材；否则 null（回退几何/程序化） */
function ammoAssetsFor(defId: string): { ammo: ProjectileArtDef; assets: ProjectileArtAssets } | null {
  const pid = defOf(defId).art?.projectile
  if (!pid) return null
  const ammo = projectileArtDef(pid)
  if (!ammo) return null
  const st = projectileArtState(ammo) // 本体按解析链（库引用 ?? spriteSet ?? id 文件夹）
  if (st.status !== 'ready' || !st.assets) return null
  return { ammo, assets: st.assets }
}

/** 垂发导弹直接使用当前弹丸贴图帧条；垂发结束后持续显示末帧正常飞行姿态。 */
function verticalLaunchVisual(ammo: ProjectileArtDef | undefined, elapsed: number): { img: HTMLImageElement; sx: number; sw: number; sh: number } | null {
  if (ammo?.kind !== 'missile' || ammo.verticalLaunch?.enabled !== true) return null
  const state = projectileArtState(ammo)
  const img = state.status === 'ready' ? state.assets?.projectile : undefined
  if (!img) return null
  const frame = projectileBodyFrameRect(ammo, img.naturalWidth, img.naturalHeight, elapsed)
  return { img, sx: frame.sx, sw: frame.sw, sh: frame.sh }
}

/**
 * 垂发导弹尾焰在地面的投影比例：首帧导弹近乎竖直，尾焰应位于弹体下方而没有平面方向；
 * 随转向动画逐渐放平，尾焰才沿当前航向移动到完整尾端。非垂发/垂发结束恒为 1。
 */
export function verticalLaunchTailProjection(ammo: ProjectileArtDef | undefined, elapsed: number): number {
  if (ammo?.kind !== 'missile' || ammo.verticalLaunch?.enabled !== true) return 1
  const progress = Math.max(0, Math.min(1, elapsed / verticalLaunchDuration(ammo)))
  return progress * progress * (3 - 2 * progress)
}

/**
 * 尾焰粒子的平面初速。垂发首帧没有可见的平面喷射方向，因此弹速继承和反向喷射必须一起投影；
 * 否则只压低反向喷射时，惯性模板会把粒子沿导弹航向向前推出，转向后又恢复向后喷，形成前后双喷。
 */
/**
 * 喷口辉光的局部 Y 与可见度。辉光贴图从喷口位置向航向后方（局部 +Y）展开；
 * 垂发首帧没有平面尾部方向，因此隐藏平面辉光，随导弹放平再渐显。
 */
export function missileEngineGlowLayout(tailY: number, tailProjection: number): { y: number; alpha: number } {
  const projection = Math.max(0, Math.min(1, tailProjection))
  return { y: tailY * projection, alpha: projection }
}

/**
 * 烟尾启停统一口径：垂发导弹从离架第一帧就开始喷烟，不再等待制导延迟结束；
 * 非垂发弹丸仍按原点火时刻开始。持续时间和燃尽门控对所有阵营一致。
 */
function projectileSmokeTailActive(
  ammo: ProjectileArtDef,
  elapsed: number,
  guideDelayLeft: number | undefined,
  igniteAtT: number | undefined,
  burnTime: number | undefined,
  configuredDuration: number | undefined,
): boolean {
  if (burnTime !== undefined && elapsed >= burnTime) return false
  const verticalLaunch = ammo.kind === 'missile' && ammo.verticalLaunch?.enabled === true
  if (!verticalLaunch && (guideDelayLeft ?? 0) > 0) return false
  const smokeAge = verticalLaunch ? elapsed : elapsed - (igniteAtT ?? 0)
  const effectiveDuration = smokeDuration(configuredDuration, burnTime)
  return smokeAge >= 0 && (effectiveDuration === undefined || smokeAge < effectiveDuration)
}

/** 弹丸在战场上的显示直径（格）：贴图按原尺寸显示，圆形坑/孔取最长边为直径。 */
function ammoVisualDiameter(ammoId: string | undefined, fallback: number): number {
  const ammo = projectileArtDef(ammoId)
  const st = ammo ? projectileArtState(ammo) : null
  const img = st?.status === 'ready' ? st.assets?.projectile : undefined
  if (!img || !ammo) return fallback
  const frame = projectileBodyFrameRect(ammo, img.naturalWidth, img.naturalHeight)
  return Math.max(frame.sw, frame.sh) / BASE_CELL
}

/** 跳弹口径缩放为纯规则函数，所有阵营的受击事件统一调用。 */
export function ricochetVisualScale(projectileDiameter: number, rangeRandom = 0.5): { width: number; range: number; head: number } {
  const width = Math.min(3, Math.max(1, Math.sqrt(Math.max(0, projectileDiameter) / GEOMETRIC_BULLET_VISUAL_SIZE)))
  return {
    width,
    range: (0.8 + Math.min(1, Math.max(0, rangeRandom)) * 0.4) * Math.min(2.2, width),
    head: Math.sqrt(width),
  }
}
import { UNIT_BODY_DAMAGE_VISUALS_ENABLED, UNIT_BODY_DECALS_ENABLED, type Enemy, type FortressDamageMark, type GameState, type Turret } from './engine'
import { gameParameters } from './gameParameters'

/** 单位上一帧位置与朝向；静止时保持最后朝向。 */
const prevPos = new Map<number, { x: number; y: number; heading: number }>()

/** 单位贴图原始正朝向为屏幕下方：0°=向下，旋转后对齐给定向量。 */
function downFacingAngle(dx: number, dy: number): number {
  return Math.atan2(-dx, dy)
}

function nBaseOf(x: number, y: number, baseSet: Set<string>): number {
  return [[-1, 0], [1, 0], [0, -1], [0, 1]].filter(([dx, dy]) => baseSet.has(`${x + dx},${y + dy}`)).length
}
/** 原始墙段：基地格且有非基地邻居（孤立判定用，与 level.ts 同规则） */
function isRawWallCell(x: number, y: number, baseSet: Set<string>): boolean {
  return baseSet.has(`${x},${y}`)
    && [[-1, 0], [1, 0], [0, -1], [0, 1]].some(([dx, dy]) => !baseSet.has(`${x + dx},${y + dy}`))
}

/** 独立块(33)（修订规则）：是原始墙段，且相邻基地格 ≤1，且唯一邻居不是有效墙
 *  （有效墙=原始墙段且 nBase>1）。唯一邻居是有效墙时该格是端头（算墙、可连接）。
 *  对邻居的分类判定而言，独立块被完全忽略（不算墙、也不算基地格，按外部处理）。 */
export function isIsolated33(x: number, y: number, wallSet: Set<string>, baseSet?: Set<string>): boolean {
  if (!baseSet || !wallSet.has(`${x},${y}`) || !isRawWallCell(x, y, baseSet)) return false
  const nb = [[-1, 0], [1, 0], [0, -1], [0, 1]].filter(([dx, dy]) => baseSet.has(`${x + dx},${y + dy}`))
  if (nb.length === 0) return true
  if (nb.length > 1) return false
  const [dx, dy] = nb[0]
  return !(isRawWallCell(x + dx, y + dy, baseSet) && nBaseOf(x + dx, y + dy, baseSet) > 1)
}

/** 有效墙判定：是墙段且非 33 独立块（独立块不影响邻居选块）。 */
export function isEffectiveWall(x: number, y: number, wallSet: Set<string>, baseSet?: Set<string>): boolean {
  return wallSet.has(`${x},${y}`) && !isIsolated33(x, y, wallSet, baseSet)
}


/** 内角缺口判定（模块级复用：战斗渲染与编辑器预览共用）。
 *  基地内部格被 2 段垂直墙（可为转角墙）夹成 90° 内角 → 凹转角（N+W→22 / N+E→24 / S+W→42 / S+E→44）；
 *  互斥规则③：缺口格若是某凸角墙（11/15/51/55）的反向对角，则不放凹角。 */
export function notchTileAt(bx: number, by: number, wallSet: Set<string>, baseSet?: Set<string>): { r: number; c: number } | null {
  const wN = isEffectiveWall(bx, by - 1, wallSet, baseSet), wS = isEffectiveWall(bx, by + 1, wallSet, baseSet)
  const wE = isEffectiveWall(bx + 1, by, wallSet, baseSet), wW = isEffectiveWall(bx - 1, by, wallSet, baseSet)
  const isConvexAt = (cx: number, cy: number): boolean => {
    if (!wallSet.has(`${cx},${cy}`)) return false
    const p = classifyWallTile(cx, cy, wallSet, baseSet)
    const id = p.wall.r * 10 + p.wall.c
    return id === 11 || id === 15 || id === 51 || id === 55 // 凸角四块
  }
  if (wN && wW && !wS && !wE) return isConvexAt(bx - 1, by - 1) ? null : { r: 2, c: 2 } // 22（角在 NW）
  if (wN && wE && !wS && !wW) return isConvexAt(bx + 1, by - 1) ? null : { r: 2, c: 4 } // 24（角在 NE）
  if (wS && wW && !wN && !wE) return isConvexAt(bx - 1, by + 1) ? null : { r: 4, c: 2 } // 42（角在 SW）
  if (wS && wE && !wN && !wW) return isConvexAt(bx + 1, by + 1) ? null : { r: 4, c: 4 } // 44（角在 SE）
  return null
}

// ---- 棱堡式墙体掩码（纯函数，引擎零改动；sim 可测） ----
export interface WallFaceInfo {
  edges: Set<'n' | 'e' | 's' | 'w'> // 朝外侧面（该向邻居不在墙集 → 外斜面）
  convex: ('ne' | 'nw' | 'se' | 'sw')[] // 凸角：两相邻边均朝外且对角邻居不在墙集 → 切外凸尖角
  concave: ('ne' | 'nw' | 'se' | 'sw')[] // 凹角：两相邻边均朝外且对角邻居在墙集 → 切内凹转角（cavity 同样八边感）
}
export function wallFaceInfo(x: number, y: number, wallSet: Set<string>): WallFaceInfo {
  const has = (dx: number, dy: number) => wallSet.has(`${x + dx},${y + dy}`)
  const edges = new Set<'n' | 'e' | 's' | 'w'>()
  if (!has(0, -1)) edges.add('n')
  if (!has(1, 0)) edges.add('e')
  if (!has(0, 1)) edges.add('s')
  if (!has(-1, 0)) edges.add('w')
  const convex: WallFaceInfo['convex'] = []
  const concave: WallFaceInfo['concave'] = []
  if (edges.has('n') && edges.has('e')) (has(1, -1) ? concave : convex).push('ne')
  if (edges.has('n') && edges.has('w')) (has(-1, -1) ? concave : convex).push('nw')
  if (edges.has('s') && edges.has('e')) (has(1, 1) ? concave : convex).push('se')
  if (edges.has('s') && edges.has('w')) (has(-1, 1) ? concave : convex).push('sw')
  return { edges, convex, concave }
}

// ---- 顶点级转角掩码（跨格补角：45° 斜边以转角顶点为中心，连接两条垂直墙外沿的边中点） ----
export interface WallVertexTurn {
  hx: -1 | 1 // 水平外沿方向（-1=顶点西侧线段，1=东侧）
  vy: -1 | 1 // 垂直外沿方向（-1=北侧线段，1=南侧）
  walls: number // 顶点周围墙格数：1=凸角（切除三角在墙格内）/ 3=凹角（连接格斜墙带）
  conn?: { cx: number; cy: number } // 仅 walls=3：空腔象限对角墙格（连接格 C，掩码信息/sim 用；渲染=内缘 45° 斜接）
}
/** 原始转角判定：顶点恰好 1 条水平外沿 + 1 条垂直外沿（直段 2 同向/无沿/十字 pinch 均非转角） */
function rawVertexTurn(vx: number, vy: number, wallSet: Set<string>): WallVertexTurn | null {
  const NW = wallSet.has(`${vx - 1},${vy - 1}`)
  const NE = wallSet.has(`${vx},${vy - 1}`)
  const SW = wallSet.has(`${vx - 1},${vy}`)
  const SE = wallSet.has(`${vx},${vy}`)
  const hW = NW !== SW // 水平外沿（西段 [vx-1,vx]@vy）
  const hE = NE !== SE // 水平外沿（东段 [vx,vx+1]@vy）
  const vN = NW !== NE // 垂直外沿（北段 [vy-1,vy]@vx）
  const vS = SW !== SE // 垂直外沿（南段 [vy,vy+1]@vx）
  if (hW === hE || vN === vS) return null
  const hx = hW ? -1 : 1
  const vy2 = vN ? -1 : 1
  const walls = (NW ? 1 : 0) + (NE ? 1 : 0) + (SW ? 1 : 0) + (SE ? 1 : 0)
  // 空腔象限 = 两条外沿共同夹着的空格；连接格 C = 其对角墙格
  const conn = walls === 3
    ? { cx: vx + (hx === 1 ? -1 : 0), cy: vy + (vy2 === 1 ? -1 : 0) }
    : undefined
  return { hx, vy: vy2, walls, conn }
}
/** 仅真转角：凸角候选（顶点仅 1 墙格）的任一条外沿延伸 1 格即另一转角（轮廓绕同一格 1 格内折返）→ 端头/孤立边，不补；
 *  凹角（3 墙格）必为真转角（1 格厚墙的凹角邻接外凸角属正常轮廓） */
export function wallVertexInfo(vx: number, vy: number, wallSet: Set<string>): WallVertexTurn | null {
  const t = rawVertexTurn(vx, vy, wallSet)
  if (!t) return null
  if (t.walls !== 1) return t // 凹角直过
  if (rawVertexTurn(vx + t.hx, vy, wallSet)) return null // 水平外沿另一端也是转角 → 端头
  if (rawVertexTurn(vx, vy + t.vy, wallSet)) return null // 垂直外沿另一端也是转角 → 端头
  return t
}

// ---- 防御墙九宫贴图分类（wall01 5×5×32 / ground01 3×3×32；坐标 1 起始） ----
export interface WallTilePick {
  wall: { r: number; c: number } // wall01 行/列
  ground: { col: number; row: number } | null // ground01 列/行（A=1..C=3）；null = 不铺地面贴图（独立块 33）
}
/** 8 邻角色分类：直墙四向（3 变体 hash 确定性随机）/凸四角（对角非墙）/凹四角（对角是墙）/独立块；
 *  兜底：端头按开口侧当直墙，T 按主要朝向（缺失侧即朝向），十字按朝下横墙 */
// ---- 防御墙素材参数表（素材块.xlsx：连接方向/外部地面/内部地面）----
// 连接方向 = 该方向必须有墙接入；外部地面 = 该方向必须是非基地格；内部地面 = 该方向必须是基地格且非墙段。
// 选块 = 逐格模式匹配：从凸角 → 直墙 → 凹角 → 独立块 的顺序找第一个四方向全满足的块。
// 新地面图集 ground01：128×128（4×4×32px），坐标 {行字母}{列字母}（A–D），如 AB=第1行第2列、DC=第4行第3列
// row/col 均为 1–4 的索引（A=1,B=2,C=3,D=4）
const G = {
  AA: { row: 1, col: 1 }, AB: { row: 1, col: 2 }, AC: { row: 1, col: 3 }, AD: { row: 1, col: 4 },
  BA: { row: 2, col: 1 }, BB: { row: 2, col: 2 }, BC: { row: 2, col: 3 }, BD: { row: 2, col: 4 },
  CA: { row: 3, col: 1 }, CB: { row: 3, col: 2 }, CC: { row: 3, col: 3 }, CD: { row: 3, col: 4 },
  DA: { row: 4, col: 1 }, DB: { row: 4, col: 2 }, DC: { row: 4, col: 3 }, DD: { row: 4, col: 4 },
}
type GroundRef = { col: number; row: number } | null
interface TileRule {
  r: number; c: number // wall01 行/列（1 起始）
  conn: string // 连接方向串（N/E/S/W）
  ext: string // 外部地面方向串
  int: string // 内部地面方向串
  ground: GroundRef
}
const TILE_RULES: TileRule[] = [
  // —— 凸转角（带外部方位）——
  { r: 1, c: 1, conn: 'ES', ext: 'WN', int: '', ground: G.AA }, // 11（外部 N/W）
  { r: 1, c: 5, conn: 'SW', ext: 'NE', int: '', ground: G.AC }, // 15（外部 N/E）
  { r: 5, c: 1, conn: 'NE', ext: 'SW', int: '', ground: G.CA }, // 51（外部 S/W）
  { r: 5, c: 5, conn: 'WN', ext: 'ES', int: '', ground: G.CC }, // 55（外部 S/E）
  // —— 直墙（基准行列 + 变体偏移在匹配后叠加）——
  { r: 1, c: 2, conn: 'EW', ext: 'N', int: 'S', ground: G.AB }, // 朝上 12/13/14
  { r: 5, c: 2, conn: 'EW', ext: 'S', int: 'N', ground: G.CB }, // 朝下 52/53/54
  { r: 2, c: 1, conn: 'SN', ext: 'W', int: 'E', ground: G.BA }, // 朝左 21/31/41
  { r: 2, c: 5, conn: 'SN', ext: 'E', int: 'W', ground: G.BC }, // 朝右 25/35/45
  // —— 凹转角（无外部方位，仅基地格可放）——
  { r: 2, c: 2, conn: 'WN', ext: '', int: 'ES', ground: G.DA }, // 22
  { r: 2, c: 4, conn: 'NE', ext: '', int: 'SW', ground: G.DB }, // 24
  { r: 4, c: 2, conn: 'SW', ext: '', int: 'NE', ground: G.DC }, // 42
  { r: 4, c: 4, conn: 'ES', ext: '', int: 'WN', ground: G.DD }, // 44
]
const DIR_DELTA: Record<string, [number, number]> = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] }

export function classifyWallTile(x: number, y: number, wallSet: Set<string>, baseSet?: Set<string>, notchMap?: Map<string, { r: number; c: number }>): WallTilePick {
  const h = (dx: number, dy: number) => isEffectiveWall(x + dx, y + dy, wallSet, baseSet) // 连接判定用有效墙（独立格不算墙）
  // 缺口连接扩展：相邻格若是合法凹角缺口格（22 系），且其连接边朝向本格，则视为有连接（阶梯转角 11↓22 竖直衔接）
  // 缺口连接边：22→N/W、24→N/E、42→S/W、44→S/E
  const NOTCH_EDGES: Record<string, string> = { '22': 'NW', '24': 'NE', '42': 'SW', '44': 'SE' }
  const extraConn = (dx: number, dy: number): boolean => {
    if (!notchMap) return false
    const t = notchMap.get(`${x + dx},${y + dy}`)
    if (!t) return false
    const edgeToCell = dx === 0 ? (dy === 1 ? 'N' : 'S') : (dx === 1 ? 'W' : 'E') // 缺口格朝向本格的边
    return NOTCH_EDGES[`${t.r}${t.c}`]?.includes(edgeToCell) ?? false
  }
  const connOf = (dx: number, dy: number) => h(dx, dy) || extraConn(dx, dy) // 连接判定 = 墙段 或 缺口连接边
  const N = connOf(0, -1), S = connOf(0, 1), E = connOf(1, 0), W = connOf(-1, 0)
  const vh = (((x * 73856093) ^ (y * 19349663)) >>> 0) % 3 // 同格不闪变（直墙 3 变体）
  const n = (N ? 1 : 0) + (S ? 1 : 0) + (E ? 1 : 0) + (W ? 1 : 0)
  const isBase = (dx: number, dy: number) => baseSet?.has(`${x + dx},${y + dy}`) ?? false
  const isBaseEff = (dx: number, dy: number) => isBase(dx, dy) && !isIsolated33(x + dx, y + dy, wallSet, baseSet) // 有效基地格（独立块按非基地处理）
  // 方向满足度：连接=有效墙、外部=非有效墙且非有效基地格（独立块=外部）、内部=有效基地格且非有效墙
  const dirOk = (d: string, kind: 'conn' | 'ext' | 'int'): boolean => {
    const [dx, dy] = DIR_DELTA[d]
    if (kind === 'conn') return connOf(dx, dy)
    if (kind === 'ext') return !h(dx, dy) && !isBaseEff(dx, dy)
    return isBaseEff(dx, dy) && !h(dx, dy)
  }
  // ① 独立块 33（先行守卫：4 邻基地格 ≤1，自身不计；独立块格下不铺地面贴图）
  // ① 独立块 33（先行守卫：符合修订孤立规则——唯一邻居非有效墙；独立块格下不铺地面贴图）
  if (baseSet ? isIsolated33(x, y, wallSet, baseSet) : n === 0) return { wall: { r: 3, c: 3 }, ground: null }
  // ② 参数表模式匹配（表内顺序即 凸→直→凹 的优先级）
  for (const t of TILE_RULES) {
    const ok =
      [...t.conn].every(d => dirOk(d, 'conn')) &&
      [...t.ext].every(d => dirOk(d, 'ext')) &&
      [...t.int].every(d => dirOk(d, 'int'))
    if (!ok) continue
    let { r, c } = t
    // 直墙叠加变体：横墙列 2→2+vh（12/13/14、52/53/54），纵墙行 2→2+vh（21/31/41、25/35/45）
    const isStraightVariant = (r === 1 && c === 2) || (r === 5 && c === 2) || (r === 2 && c === 1) || (r === 2 && c === 5)
    if (isStraightVariant) {
      if (c === 2) c = 2 + vh // 横墙：列偏移
      else r = 2 + vh // 纵墙：行偏移
    }
    return { wall: { r, c }, ground: t.ground }
  }
  // ③ 兜底（参数表无匹配：破洞端头 / T 字 / 孤立直墙段）——按朝外侧当直墙
  const outN = !N && !isBase(0, -1), outS = !S && !isBase(0, 1), outW = !W && !isBase(-1, 0)
  const up = (): WallTilePick => ({ wall: { r: 1, c: 2 + vh }, ground: G.AB })
  const down = (): WallTilePick => ({ wall: { r: 5, c: 2 + vh }, ground: G.CB })
  const left = (): WallTilePick => ({ wall: { r: 2 + vh, c: 1 }, ground: G.BA })
  const right = (): WallTilePick => ({ wall: { r: 2 + vh, c: 5 }, ground: G.BC })
  // T/十字优先按贯通轴（与直墙同规则：朝外侧定向）
  if (N && S) return outW ? left() : right()
  if (E && W) return outN ? up() : down()
  if (n === 0) { // 孤立直墙段（凹槽底）：四选一按朝外侧
    if (outN) return up()
    if (outS) return down()
    if (outW) return left()
    return right()
  }
  if (E || W) return outN ? up() : down() // 水平端头（n===1）
  return outW ? left() : right() // 垂直端头（n===1）
}

export interface ViewCtx {
  cell: number // 每格像素
  viewX: number // 视口左沿（格，浮点；宽战场横向卷动）
  viewY: number // 视口上沿（格，浮点）
  overheated: boolean // 堡垒过热中（全炮塔停火表现：辉光/冒烟）
}

export interface UiHints {
  /** 挂炮模式：选中待挂炮塔 defId（渲染端高亮匹配的空闲炮位） */
  mountDefId?: string | null
  /** v1.75：主界面「炮塔」按钮按下（卡片栏展开）——炮位槽位圈/字母仅此时（或挂炮模式）显示 */
  turretPanel?: boolean
  ghost: { x: number; y: number; w: number; h: number; ok: boolean } | null
  wallGhost: { x: number; y: number; ok: boolean; reason?: string } | null // 基地格铺设/拆除幽灵（reason=非法原因小字）
  selectedTurret: number | null
  /** 游玩模式中点选的敌方单位；渲染其单位模板配置的索敌视野范围。 */
  selectedEnemyUnit?: number | null
  buildMode: boolean
  /** 堡垒内部建造模式：隐藏主体/上层贴图只露底座，原地摆放模块 */
  interiorMode?: boolean
  /** 内部建造幽灵（格阵坐标 + 占地 + 合法性） */
  interiorGhost?: { x: number; y: number; w: number; h: number; ok: boolean; cells?: { x: number; y: number }[] } | null // v2.31：cells=逐格幽灵（异型模块；缺省= w×h 矩形）
  /** 场景编辑模式：draft 编辑层叠加 */
  edit?: EditOverlay
  showGrid?: boolean
}

export interface EditOverlay {
  cells: string[] // draft.buildCells
  groundCells: string[] // draft.groundCells（战场地面层）
  baseTiles: LevelTileCell[]
  overlayTiles: LevelTileCell[]
  terrain: { kind: string; defId?: string; x: number; y: number; w: number; h: number; preview?: boolean }[]
  objects: { kind: string; defId?: string; x: number; y: number; w: number; h: number; blockProjectile?: boolean; height?: number; renderLayer?: 1 | 2 | 3 | 4 | 5; flipX?: boolean; rotation?: 0 | 90 | 180 | 270; preview?: boolean }[]
  showHeight: boolean
  /** 关卡几何中心所在的单元格（零基索引）。 */
  centerCell: { x: number; y: number }
  startZone: { x: number; y: number; w: number; h: number }
  finishCells: string[]
  spawnRegions: { id: number; cells: string[]; selected: boolean }[]
  triggers: { id: number; name: string; x: number; y: number; w: number; h: number; enabled: boolean; selected: boolean }[]
  events: { id: number; name: string; cells: string[]; enabled: boolean; selected: boolean }[]
  routes: { unitId: number; points: { x: number; y: number }[]; selected: boolean }[]
  units: { id: number; unitDefId: string; name: string; faction: 'player' | 'ally' | 'enemy' | 'neutral' | 'neutralHostile'; x: number; y: number; size: number; width: number; height: number; footprintW: number; footprintH: number; bodyAsset?: string; flipX?: boolean; rotation?: 0 | 90 | 180 | 270; renderLayer?: 1 | 2 | 3 | 4 | 5; selected: boolean; preview?: boolean }[]
  /** 当前任务页选中的堡垒防御阶段空间配置；坐标均为世界几何中心。 */
  fortressDefense?: {
    stageId: string
    fortressPoint: { x: number; y: number }
    returnPoint: { x: number; y: number }
    selectedTarget: { stageId: string; kind: 'fortress' | 'return' } | null
  } | null
  selection: { x: number; y: number; w: number; h: number } | null
  selections?: { x: number; y: number; w: number; h: number }[]
  /** 底图/装饰层当前已确认的地格选区。 */
  tileSelection?: { x: number; y: number; w: number; h: number } | null
  selectionArea?: { x: number; y: number; w: number; h: number } | null
  hover: { x: number; y: number; w: number; h: number; ok: boolean; ghost?: boolean } | null
}

type SceneRenderItem = {
  layer: number
  x: number
  y: number
  kind: 'object' | 'unit'
  /** 仅用于单位间排序：飞行单位始终在地面单位之后绘制。 */
  airborne?: boolean
  /** 飞行单位当前实际高度（格）；高度越高越晚绘制。 */
  altitude?: number
  order: number
  draw: () => void
}

/** 全局场景实体顺序：层级优先；同层单位之间空中永远高于地面；飞行单位先按当前高度，再按 Y、X；
 *  物体与单位之间保持既有排序口径，同类完全同键时保持稳定放置顺序。 */
export function compareSceneRenderItems(a: Omit<SceneRenderItem, 'draw'>, b: Omit<SceneRenderItem, 'draw'>): number {
  const layer = a.layer - b.layer
  if (layer !== 0) return layer
  if (a.kind === 'unit' && b.kind === 'unit') {
    const altitudeLayer = Number(a.airborne ?? false) - Number(b.airborne ?? false)
    if (altitudeLayer !== 0) return altitudeLayer
    if (a.airborne && b.airborne) {
      const altitude = (Number.isFinite(a.altitude) ? a.altitude! : 0) - (Number.isFinite(b.altitude) ? b.altitude! : 0)
      if (altitude !== 0) return altitude
    }
  }
  return a.y - b.y || a.x - b.x || (a.kind === b.kind ? 0 : a.kind === 'unit' ? 1 : -1) || a.order - b.order
}

export function visibleRows(cell: number, canvasH: number): number {
  return canvasH / cell
}

export function clampViewY(viewY: number, cell: number, canvasH: number): number {
  const vis = visibleRows(cell, canvasH)
  return Math.max(0, Math.min(LEVEL.rows - vis, viewY))
}

export function clampViewX(viewX: number, cell: number, canvasW: number): number {
  const vis = canvasW / cell
  return Math.max(0, Math.min(LEVEL.cols - vis, viewX))
}

/**
 * 游玩镜头以目标世界坐标为屏幕中心，不受关卡边界限制。
 * 负视口坐标与超过右/下边界的坐标是合法值，场景外区域由渲染器绘制为黑色。
 */
export function unboundedCenteredView(centerX: number, centerY: number, cell: number, canvasW: number, canvasH: number) {
  return {
    x: centerX - canvasW / cell / 2,
    y: centerY - canvasH / cell / 2,
  }
}

/** 绘制一层 RMXP Autotile 地面；动态素材为横向 4 个 96×128 帧。 */
function drawRmxpGroundLayer(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  cells: readonly string[],
  X: (x: number) => number,
  Y: (y: number) => number,
  cell: number,
  frameX = 0,
) {
  const set = new Set(cells)
  const half = cell / 2
  const prevSmooth = ctx.imageSmoothingEnabled
  ctx.imageSmoothingEnabled = false // 像素贴图最近邻
  for (const k of cells) {
    const [x, y] = k.split(',').map(Number)
    drawRmxpAutotileCell(ctx, img, set, x, y, X, Y, half, frameX)
  }
  ctx.imageSmoothingEnabled = prevSmooth
}

function drawRmxpAutotileCell(ctx: CanvasRenderingContext2D, img: CanvasImageSource, cells: ReadonlySet<string>, x: number, y: number, X: (x: number) => number, Y: (y: number) => number, half: number, frameX = 0) {
  const variation = rmxpAutotileIndex(cells, x, y)
  const pieces = RMXP_SUBTILES[variation]
  for (let q = 0; q < 4; q++) {
    const [sx, sy] = rmxpQuarterSrc(pieces[q])
    ctx.drawImage(img, frameX + sx, sy, 16, 16, X(x) + (q % 2) * half, Y(y) + Math.floor(q / 2) * half, half, half)
  }
}

function rmxpAnimationFrameX(img: HTMLImageElement): number {
  return img.width === 384 && img.height === 128 ? Math.floor(performance.now() / 250) % 4 * 96 : 0
}

// ---- v2.57 地面弹坑：启动时按 seed 烘焙少量纹理变体，世界坐标 decal 复用 ----
const craterTextures = new Map<number, HTMLCanvasElement>()
function craterTexture(seed: number): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null
  const key = seed & 15
  const cached = craterTextures.get(key)
  if (cached) return cached
  const cv = document.createElement('canvas')
  cv.width = 96
  cv.height = 96
  const c = cv.getContext('2d')
  if (!c) return null
  c.translate(48, 48)
  c.rotate((eventRandom(key, 0) - 0.5) * 0.8)
  c.scale(1, 0.82 + eventRandom(key, 1) * 0.12)
  const burn = c.createRadialGradient(-5, -5, 3, 0, 0, 43)
  burn.addColorStop(0, 'rgba(16,14,12,0.88)')
  burn.addColorStop(0.48, 'rgba(35,29,23,0.78)')
  burn.addColorStop(0.72, 'rgba(73,57,40,0.48)')
  burn.addColorStop(1, 'rgba(40,31,24,0)')
  c.fillStyle = burn
  c.beginPath(); c.arc(0, 0, 44, 0, Math.PI * 2); c.fill()
  c.strokeStyle = 'rgba(151,119,78,0.42)'
  c.lineWidth = 4
  c.beginPath(); c.ellipse(1, 2, 35, 29, 0, Math.PI * 0.08, Math.PI * 0.92); c.stroke()
  c.strokeStyle = 'rgba(12,10,9,0.62)'
  c.lineWidth = 3
  c.beginPath(); c.ellipse(-1, 1, 30, 24, 0, Math.PI * 1.02, Math.PI * 1.9); c.stroke()
  for (let i = 0; i < 9; i++) {
    const a = eventRandom(key, 10 + i) * Math.PI * 2
    const d = 24 + eventRandom(key, 30 + i) * 17
    const rr = 1 + eventRandom(key, 50 + i) * 2.2
    c.fillStyle = `rgba(42,32,23,${0.25 + eventRandom(key, 70 + i) * 0.35})`
    c.beginPath(); c.arc(Math.cos(a) * d, Math.sin(a) * d, rr, 0, Math.PI * 2); c.fill()
  }
  craterTextures.set(key, cv)
  return cv
}

/** 载具结构值阶段：0=正常，1=低于50%整车变暗，2=低于25%变暗并持续冒深色烟。 */
export function fortressDamageStage(hp: number, maxHp: number): 0 | 1 | 2 {
  const ratio = maxHp > 0 ? Math.max(0, hp / maxHp) : 0
  return ratio >= 0.5 ? 0 : ratio >= 0.25 ? 1 : 2
}

/** 低结构载具的整车亮度。跨过50%时明确进入受损态，之后随结构继续降低。 */
export function vehicleDamageBrightness(hp: number, maxHp: number): number {
  const ratio = maxHp > 0 ? Math.max(0, Math.min(1, hp / maxHp)) : 0
  if (!UNIT_BODY_DAMAGE_VISUALS_ENABLED || ratio >= 0.5) return 1
  const severity = (0.5 - ratio) / 0.5
  return Math.max(0.58, 0.82 - severity * 0.24)
}

/** 深色烟源数量按载具占格面积分级：小型至少1处，大型最多6处。 */
export function vehicleDamageSmokeSourceCount(width: number, height: number): number {
  const area = Math.max(0.25, Math.abs(width * height))
  return Math.max(1, Math.min(6, Math.ceil(Math.sqrt(area) / 2)))
}

function vehicleDamageFilter(hp: number, maxHp: number): string {
  const brightness = vehicleDamageBrightness(hp, maxHp)
  return brightness < 1 ? `brightness(${Math.round(brightness * 100)}%)` : 'none'
}

/**
 * 单位主体的弹孔、焦痕和擦痕统一屏蔽，等待共用战损视觉重做。
 */
export function unitDamageMarkVisible(kind: FortressDamageMark['kind']): boolean {
  void kind
  return UNIT_BODY_DECALS_ENABLED
}

function drawFortressDamageMark(ctx: CanvasRenderingContext2D, mark: FortressDamageMark, x: number, y: number, cell: number): void {
  const markRadius = mark.kind === 'bullet' && mark.ammoId
    ? ammoVisualDiameter(mark.ammoId, mark.projectileSize ?? mark.size * 4) * 0.25
    : mark.size
  const r = Math.max(0.35, markRadius * cell)
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(mark.angle * Math.PI / 180)
  if (mark.kind === 'bullet') {
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r)
    g.addColorStop(0, 'rgba(8,7,6,0.96)')
    g.addColorStop(0.28, 'rgba(30,24,20,0.92)')
    g.addColorStop(0.62, 'rgba(88,72,55,0.55)')
    g.addColorStop(1, 'rgba(24,20,17,0)')
    ctx.fillStyle = g
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill()
    ctx.strokeStyle = 'rgba(205,183,139,0.72)'
    ctx.lineWidth = Math.max(0.8, r * 0.12)
    ctx.beginPath(); ctx.arc(0, 0, r * 0.58, Math.PI * 0.98, Math.PI * 1.82); ctx.stroke()
  } else if (mark.kind === 'scorch') {
    const g = ctx.createRadialGradient(0, 0, r * 0.08, 0, 0, r)
    g.addColorStop(0, 'rgba(16,12,9,0.78)')
    g.addColorStop(0.48, 'rgba(48,35,25,0.58)')
    g.addColorStop(0.78, 'rgba(104,67,35,0.22)')
    g.addColorStop(1, 'rgba(40,28,20,0)')
    ctx.fillStyle = g
    ctx.beginPath(); ctx.ellipse(0, 0, r, r * 0.78, 0, 0, Math.PI * 2); ctx.fill()
  } else {
    ctx.lineCap = 'round'
    for (let i = -1; i <= 1; i++) {
      const off = i * r * 0.22
      ctx.strokeStyle = i === -1 ? 'rgba(201,180,139,0.48)' : 'rgba(22,18,15,0.76)'
      ctx.lineWidth = Math.max(0.8, r * 0.09)
      ctx.beginPath()
      ctx.moveTo(-r * 0.82, off - r * 0.1)
      ctx.lineTo(-r * 0.12, off + r * 0.08)
      ctx.lineTo(r * 0.86, off - r * 0.04)
      ctx.stroke()
    }
  }
  ctx.restore()
}

let fortressDamageLayer: HTMLCanvasElement | null = null

function drawFortressDamageContent(ctx: CanvasRenderingContext2D, s: GameState, _stage: number, ox: number, oy: number, _fw: number, _fh: number, cell: number): void {
  for (const mark of s.fortress.damageMarks) {
    if (unitDamageMarkVisible(mark.kind)) drawFortressDamageMark(ctx, mark, ox + mark.x * cell, oy + mark.y * cell, cell)
  }
}

/** 载具战损覆盖：有载具贴图时严格使用其 alpha 作遮罩，透明区下方的履带/轮胎不会被染到。 */
function drawFortressDamageOverlay(
  ctx: CanvasRenderingContext2D, s: GameState, fd: FortressDef, bodyImg: HTMLImageElement | null,
  fx: number, fy: number, fw: number, fh: number, cell: number, stage: number,
): void {
  if (!UNIT_BODY_DECALS_ENABLED || s.fortress.damageMarks.length === 0) return
  if (bodyImg && typeof document !== 'undefined') {
    fortressDamageLayer ??= document.createElement('canvas')
    const sw = Math.max(1, Math.round(fw)), sh = Math.max(1, Math.round(fh))
    if (fortressDamageLayer.width !== sw) fortressDamageLayer.width = sw
    if (fortressDamageLayer.height !== sh) fortressDamageLayer.height = sh
    const dc = fortressDamageLayer.getContext('2d')
    if (!dc) return
    dc.setTransform(1, 0, 0, 1, 0, 0); dc.clearRect(0, 0, sw, sh)
    dc.setTransform(sw / fw, 0, 0, sh / fh, 0, 0)
    dc.globalCompositeOperation = 'source-over'
    drawFortressDamageContent(dc, s, stage, 0, 0, fw, fh, cell)
    const zm = cell / BASE_CELL
    const dw = bodyImg.naturalWidth * zm, dh = bodyImg.naturalHeight * zm
    dc.globalCompositeOperation = 'destination-in'
    dc.drawImage(bodyImg, (fw - dw) / 2, (fh - dh) / 2, dw, dh)
    dc.setTransform(1, 0, 0, 1, 0, 0); dc.globalCompositeOperation = 'source-over'
    ctx.drawImage(fortressDamageLayer, 0, 0, sw, sh, fx, fy, fw, fh)
    return
  }
  ctx.save()
  ctx.beginPath()
  if (fd.shape && fd.shape.length > 0) {
    for (const key of fd.shape) {
      const [sx, sy] = key.split(',').map(Number)
      ctx.rect(fx + sx * cell, fy + sy * cell, cell, cell)
    }
  } else ctx.rect(fx, fy, fw, fh)
  ctx.clip()
  drawFortressDamageContent(ctx, s, stage, fx, fy, fw, fh, cell)
  ctx.restore()
}

// ---- 轻量粒子系统（渲染端纯视觉，wall-clock 驱动；引擎零侵入）----
// v2.40 双通道：groundPool = 地面层（地形之上/载具及行走部件之下：尘土等）；fxPool = 空中层（最上，现状口径）
const fxPool: ParticlePool = createPool()
const groundPool: ParticlePool = createPool()
const fxEmitterAccs = new Map<string, number>() // v2.40 堡垒特效点 id → 发射累加器
// 履带/轮胎落印暂时关闭；保留完整实现，待视觉与性能优化后重新启用。
const TRACK_MARK_EFFECT_ENABLED = false
const trackMarks: TrackMark[] = [] // v2.41 履带印（地面层）
const trackMarkSt: TrackMarkState = { acc: [], prevPhase: [], moving: [] }
const unitTrackMarkStates = new Map<number, TrackMarkState>()
interface TrackMarkChunk { cx: number; cy: number; bucket: number; bornMax: number; canvas: HTMLCanvasElement }
const TRACK_MARK_CHUNK_CELLS = 8
const TRACK_MARK_CHUNK_BUCKET = 2 // 秒；整块分龄淡出，避免每个履带板每帧单独更新透明度
const trackMarkChunks = new Map<string, TrackMarkChunk>()
let trackMarkTime = -1 // v2.41：游戏重开检测（s.time 回退 → 清印）
const craters: Crater[] = []
const craterSeen = new Set<number>()
let craterTime = -1
let fxLastStep = -1
const trailAcc = new Map<number, number>() // 弹丸 id → 尾焰发射累积器
const projPrev = new Map<number, { x: number; y: number }>() // 弹丸 id → 上帧插值位置（尾焰惯性继承的弹速估算）
const smokeAcc = new Map<number, number>() // v2.20 弹丸 id → 长存留烟尾发射累积器（与主尾焰并行的第二股粒子流）
const beamFxAcc = new Map<number, { absorb: number; scatter: number; smoke: number }>() // v2.10 炮塔 id → 光束三组粒子发射累积器
let shieldInteriorWasOpen = false
let shieldUnfoldStartedAt = -1
const vehicleDamageSmokeStates = new Map<string, { acc: number; seq: number }>()
let vehicleDamageSmokeTime = -1
const aircraftCrashSmokeStates = new Map<string, { acc: number; seq: number }>()
let walkerStepSeenId = 0
let walkerStepTime = -1

/** 机甲落脚只生成少量地面尘土；不附带镜头或地面震动。 */
function emitWalkerStepDust(s: GameState): void {
  if (walkerStepTime >= 0 && s.time < walkerStepTime) walkerStepSeenId = 0
  walkerStepTime = s.time
  for (const signal of s.audioSignals ?? []) {
    if (signal.kind !== 'walkerStep' || signal.id <= walkerStepSeenId || signal.x === undefined || signal.y === undefined) continue
    const intensity = Math.max(0.4, Math.min(1.4, signal.intensity ?? 1))
    const count = Math.max(2, Math.min(4, Math.round(2.4 * intensity)))
    for (let index = 0; index < count; index++) {
      const angle = Math.random() * Math.PI * 2
      const speed = 0.12 + Math.random() * 0.28
      spawnTrail(groundPool, signal.x + (Math.random() - 0.5) * 0.09, signal.y + (Math.random() - 0.5) * 0.07, {
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed * 0.65,
        life: (0.32 + Math.random() * 0.2) * (0.85 + intensity * 0.15),
        size: (0.045 + Math.random() * 0.035) * (0.75 + intensity * 0.25),
        color: '#88765B', colorEnd: '#4A4438', drag: 2.1, grow: 1.45, growUntil: 0.48, fadeIn: 0.06,
      })
    }
    walkerStepSeenId = Math.max(walkerStepSeenId, signal.id)
  }
}

/** 飞行坠毁黑烟直接从空中主体位置发出；随着接近地面逐步加浓。 */
function emitAircraftCrashSmoke(
  key: string,
  seedBase: number,
  host: { x: number; y: number; aircraft?: { altitude: number; vx: number; vy: number; crash?: { elapsed: number; duration: number; impacted?: boolean } } },
  unit: UnitDef,
  scale: number,
  dt: number,
): void {
  const crash = host.aircraft?.crash
  if (!crash || crash.impacted || dt <= 0) {
    aircraftCrashSmokeStates.delete(key)
    return
  }
  const state = aircraftCrashSmokeStates.get(key) ?? { acc: 0, seq: 0 }
  aircraftCrashSmokeStates.set(key, state)
  const progress = Math.max(0, Math.min(1, crash.elapsed / Math.max(0.001, crash.duration)))
  state.acc += (4.5 + progress * 9.5) * dt
  const count = Math.floor(state.acc)
  state.acc -= count
  const visualSize = Math.max(unit.visual?.width ?? unit.stats.size * 2, unit.visual?.height ?? unit.stats.size * 2) * scale
  for (let index = 0; index < count; index++) {
    const sequence = state.seq++
    const seed = seedBase + sequence * 41
    spawnTrail(fxPool, host.x + (eventRandom(seed, 91) - 0.5) * visualSize * 0.18, host.y - (host.aircraft?.altitude ?? 0) + (eventRandom(seed, 92) - 0.5) * visualSize * 0.12, {
      vx: (host.aircraft?.vx ?? 0) * 0.12 + (eventRandom(seed, 93) - 0.5) * 0.2,
      vy: (host.aircraft?.vy ?? 0) * 0.12 - (0.24 + eventRandom(seed, 94) * 0.22),
      life: 0.9 + eventRandom(seed, 95) * 0.5,
      size: Math.min(0.28, 0.09 + visualSize * 0.025) * (0.82 + eventRandom(seed, 96) * 0.4),
      color: '#403D39', colorEnd: '#181716', drag: 0.95, grow: 2.15, growUntil: 0.62, fadeIn: 0.1,
    })
  }
}

function emitVehicleDamageSmoke(
  key: string,
  seedBase: number,
  host: { x: number; y: number; heading: number; vx: number; vy: number },
  vehicle: FortressDef,
  hp: number,
  maxHp: number,
  scale: number,
  dt: number,
): void {
  if (!UNIT_BODY_DAMAGE_VISUALS_ENABLED || fortressDamageStage(hp, maxHp) !== 2 || dt <= 0) {
    vehicleDamageSmokeStates.delete(key)
    return
  }
  const state = vehicleDamageSmokeStates.get(key) ?? { acc: 0, seq: 0 }
  vehicleDamageSmokeStates.set(key, state)
  const ratio = maxHp > 0 ? Math.max(0, hp / maxHp) : 0
  const sourceCount = vehicleDamageSmokeSourceCount(vehicle.w * scale, vehicle.h * scale)
  const severity = Math.max(0, Math.min(1, (0.25 - ratio) / 0.25))
  state.acc += sourceCount * (1.15 + severity * 0.85) * dt
  const count = Math.floor(state.acc)
  state.acc -= count
  const co = Math.cos(host.heading), si = Math.sin(host.heading)
  const width = vehicle.w * scale, height = vehicle.h * scale
  const smokeSize = Math.min(0.24, 0.1 + Math.sqrt(width * height) * 0.012)
  for (let i = 0; i < count; i++) {
    const sequence = state.seq++
    const sourceIndex = sequence % sourceCount
    const sourceSeed = seedBase + sourceIndex * 977
    const lx = (eventRandom(sourceSeed, 81) - 0.5) * width * 0.56
    const ly = (eventRandom(sourceSeed, 82) - 0.5) * height * 0.46
    const x = host.x + lx * co - ly * si
    const y = host.y + lx * si + ly * co
    const particleSeed = seedBase + sequence * 37
    spawnTrail(fxPool, x, y, {
      vx: host.vx * 0.08 + (eventRandom(particleSeed, 83) - 0.5) * 0.16,
      vy: host.vy * 0.08 - (0.28 + eventRandom(particleSeed, 84) * 0.22),
      life: 1 + eventRandom(particleSeed, 85) * 0.42,
      size: smokeSize * (0.82 + eventRandom(particleSeed, 86) * 0.36),
      color: '#45413D', colorEnd: '#211F1D', drag: 1.05, grow: 1.9, growUntil: 0.58, fadeIn: 0.12,
    })
  }
}

export interface ShieldHexTile { x: number; y: number; edge: number; squashX: number; squashY: number }

/** 圆角半径随护盾短边缩放；保留矩形体量，同时避免四角过于生硬。 */
export function shieldCornerRadius(hw: number, hh: number): number {
  return Math.max(0, Math.min(hw, hh) * 0.38)
}

/** 常态护盾边缘的轻微双频呼吸；只改变亮度/线宽，不移动轮廓位置。 */
export function shieldEdgePulse(time: number): { alpha: number; width: number } {
  return {
    alpha: 1 + Math.sin(time * 1.34) * 0.12 + Math.sin(time * 0.47 + 1.8) * 0.035,
    width: 1 + Math.sin(time * 1.08 + 0.65) * 0.065,
  }
}

/** 沿闭合护盾周长移动的局部能量波峰；progress 为周长归一化位置 0..1。 */
export function shieldEdgeFlowGain(time: number, progress: number): number {
  const phase = ((time * 0.15) % 1 + 1) % 1
  const wrappedDistance = (a: number, b: number) => {
    const d = Math.abs(a - b) % 1
    return Math.min(d, 1 - d)
  }
  const headD = wrappedDistance(progress, phase)
  const wakePhase = (phase - 0.13 + 1) % 1
  const wakeD = wrappedDistance(progress, wakePhase)
  const head = Math.exp(-(headD * headD) / (2 * 0.055 * 0.055))
  const wake = Math.exp(-(wakeD * wakeD) / (2 * 0.11 * 0.11))
  return 0.82 + head * 0.72 + wake * 0.16
}

/** v2.71 六边形护盾铺格：点阵覆盖圆角矩形护罩；边缘瓦片按最近边压缩。 */
export function shieldHexLayout(hw: number, hh: number, tileSize: number): ShieldHexTile[] {
  if (!(hw > 0) || !(hh > 0) || !(tileSize > 0)) return []
  const hexW = tileSize * 0.75
  const hexH = tileSize * 0.875
  const stepY = hexH * 0.75
  const radius = shieldCornerRadius(hw, hh)
  const margin = tileSize * 0.38
  const rows = Math.ceil((hh * 2 + margin * 2) / stepY)
  const cols = Math.ceil((hw * 2 + margin * 2) / hexW)
  const out: ShieldHexTile[] = []
  for (let row = -1; row <= rows + 1; row++) {
    const y = -hh - margin + row * stepY
    const offset = row & 1 ? hexW / 2 : 0
    for (let col = -1; col <= cols + 1; col++) {
      const x = -hw - margin + col * hexW + offset
      const ax = Math.abs(x), ay = Math.abs(y)
      // 圆角矩形 signed-distance：d>0 在场体内，d<0 在场体外。
      const qx = ax - (hw - radius), qy = ay - (hh - radius)
      const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0))
      const inside = Math.min(Math.max(qx, qy), 0)
      const d = radius - outside - inside
      if (d < -margin) continue
      const edge = Math.max(0.22, Math.min(1, (d + margin) / (margin * 1.55)))
      const sideNearest = hw > 0 && hh > 0 ? ax / hw > ay / hh : false
      const corner = qx > 0 && qy > 0
      const squash = 0.48 + edge * 0.52
      out.push({ x, y, edge, squashX: sideNearest || corner ? squash : 1, squashY: !sideNearest || corner ? squash : 1 })
    }
  }
  return out
}

/** 命中扩散亮度：命中格 → 紧邻一圈 → 外围第二圈，越外层亮度越弱；每圈仅产生一个亮度脉冲。 */
export function shieldHexRipple(progress: number, ring: number, broken = false): number {
  if (ring < 0 || ring > 2 || progress < 0 || progress >= 1) return 0
  const start = ring * (broken ? 0.12 : 0.14)
  const duration = broken ? 0.34 : 0.26
  const local = (progress - start) / duration
  const ringAttenuation = [1, 0.62, 0.34][ring]
  // 单向衰减而非往复正弦：命中格不会在扩散结束后再次变亮。
  return local >= 0 && local < 1 ? Math.pow(1 - local, 1.55) * ringAttenuation : 0
}

/** 护盾开展使用快速起步、柔和收尾的 ease-out。 */
export function shieldUnfoldProgress(progress: number): number {
  const p = Math.max(0, Math.min(1, progress))
  return 1 - Math.pow(1 - p, 3)
}

/** 从 50% 等比尺寸开展，末段轻微超过极限后回落至 100%。 */
export function shieldUnfoldScale(progress: number): number {
  const p = Math.max(0, Math.min(1, progress))
  const base = 0.5 + shieldUnfoldProgress(p) * 0.5
  const rebound = p > 0.72 ? Math.sin(((p - 0.72) / 0.28) * Math.PI) * 0.018 : 0
  return base + rebound
}

/** 破盾整场闪光：从满强度快速衰减，后半段完全归零交给碎片表现。 */
export function shieldBreakEnvelope(progress: number): number {
  const p = Math.max(0, Math.min(1, progress))
  return p < 0.42 ? Math.pow(1 - p / 0.42, 1.55) : 0
}

/** 破盾后内部场体不再硬切，短暂淡出后归零。 */
export function shieldBreakFieldFade(elapsed: number): number {
  return Math.pow(Math.max(0, 1 - Math.max(0, elapsed) / 0.26), 1.45)
}

/** 整体崩解时各外缘段的短暂错峰：delayRatio 仅用于打散同步感，不代表命中距离。 */
export function shieldBreakSegmentAlpha(elapsed: number, delayRatio: number): number {
  const delay = Math.max(0, Math.min(1, delayRatio)) * 0.08
  const age = Math.max(0, elapsed) - delay
  if (age <= 0) return 1
  return Math.pow(Math.max(0, 1 - age / 0.16), 1.35)
}

export interface ShieldFieldMotion { x1: number; y1: number; r1: number; a1: number; x2: number; y2: number; r2: number; a2: number }

/** 同一场体素材的双层反向漂移参数，产生缓慢能量干涉而无需额外贴图。 */
export function shieldFieldMotion(time: number, hw: number, hh: number): ShieldFieldMotion {
  return {
    x1: Math.sin(time * 0.43) * hw * 0.075,
    y1: Math.cos(time * 0.31) * hh * 0.055,
    r1: Math.sin(time * 0.22) * 0.045,
    a1: 0.86 + Math.sin(time * 0.6) * 0.2,
    x2: Math.cos(time * 0.37 + 1.4) * hw * 0.065,
    y2: Math.sin(time * 0.28 + 2.1) * hh * 0.06,
    r2: -Math.sin(time * 0.19 + 0.8) * 0.052,
    a2: 0.64 + Math.sin(time * 0.64  + 2.4) * 0.25,
  }
}

/** 碎片尺寸随护盾短边增长，并钳制在兼顾可读性与遮挡的范围内。 */
export function shieldShardSize(hw: number, hh: number): number {
  return Math.max(0.2, Math.min(0.6, Math.min(hw, hh) * 2 * 0.07))
}

/** 在圆角矩形场体内生成近似等面积交错采样点，供整体破盾碎片均匀分布。 */
export function shieldInteriorSamples(hw: number, hh: number, spacing: number): { x: number; y: number }[] {
  if (!(hw > 0) || !(hh > 0) || !(spacing > 0)) return []
  const radius = shieldCornerRadius(hw, hh)
  const stepY = spacing * Math.sqrt(3) / 2
  const rows = Math.max(1, Math.ceil(hh * 2 / stepY))
  const cols = Math.max(1, Math.ceil(hw * 2 / spacing))
  const out: { x: number; y: number }[] = []
  for (let row = 0; row <= rows; row++) {
    const y = -hh + row * stepY
    if (y > hh) continue
    const offset = row % 2 ? spacing / 2 : 0
    for (let col = -1; col <= cols; col++) {
      const x = -hw + col * spacing + offset
      if (x < -hw || x > hw) continue
      const qx = Math.abs(x) - (hw - radius), qy = Math.abs(y) - (hh - radius)
      const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0))
      const inside = Math.min(Math.max(qx, qy), 0)
      if (outside + inside <= radius) out.push({ x, y })
    }
  }
  return out
}

/** 沿圆角矩形护盾外缘近似等距采样，供边缘柔光与分段熄灭共用同一边界。 */
export function shieldPerimeterSamples(hw: number, hh: number, spacing: number): { x: number; y: number }[] {
  if (!(hw > 0) || !(hh > 0) || !(spacing > 0)) return []
  const radius = shieldCornerRadius(hw, hh)
  const top = Math.max(0, 2 * (hw - radius))
  const side = Math.max(0, 2 * (hh - radius))
  const arc = Math.PI * radius / 2
  const perimeter = top * 2 + side * 2 + arc * 4
  const count = Math.max(16, Math.ceil(perimeter / spacing))
  const out: { x: number; y: number }[] = []
  for (let i = 0; i < count; i++) {
    let d = (i / count) * perimeter
    if (d < top) { out.push({ x: -hw + radius + d, y: -hh }); continue }
    d -= top
    if (d < arc) { const a = -Math.PI / 2 + d / radius; out.push({ x: hw - radius + Math.cos(a) * radius, y: -hh + radius + Math.sin(a) * radius }); continue }
    d -= arc
    if (d < side) { out.push({ x: hw, y: -hh + radius + d }); continue }
    d -= side
    if (d < arc) { const a = d / radius; out.push({ x: hw - radius + Math.cos(a) * radius, y: hh - radius + Math.sin(a) * radius }); continue }
    d -= arc
    if (d < top) { out.push({ x: hw - radius - d, y: hh }); continue }
    d -= top
    if (d < arc) { const a = Math.PI / 2 + d / radius; out.push({ x: -hw + radius + Math.cos(a) * radius, y: hh - radius + Math.sin(a) * radius }); continue }
    d -= arc
    if (d < side) { out.push({ x: -hw, y: hh - radius - d }); continue }
    d -= side
    const a = Math.PI + d / radius
    out.push({ x: -hw + radius + Math.cos(a) * radius, y: -hh + radius + Math.sin(a) * radius })
  }
  return out
}

interface ShieldSilhouetteEdgeSample extends ShieldMaskPoint {
  nextX: number
  nextY: number
  progress: number
}

interface VehicleShieldSilhouette {
  path: Path2D
  minX: number
  minY: number
  maxX: number
  maxY: number
  centerX: number
  centerY: number
  halfW: number
  halfH: number
  edgeSamples: ShieldSilhouetteEdgeSample[]
  interiorSamples: ShieldMaskPoint[]
}

interface ShieldMaskDrawLayer {
  minX: number
  minY: number
  maxX: number
  maxY: number
  draw: (ctx: CanvasRenderingContext2D) => void
}

const vehicleShieldSilhouetteCache = new Map<string, VehicleShieldSilhouette>()
const vehicleShieldImageIds = new WeakMap<HTMLImageElement, number>()
let vehicleShieldImageId = 1

function shieldImageKey(image: HTMLImageElement | null): string {
  if (!image) return '-'
  let id = vehicleShieldImageIds.get(image)
  if (id === undefined) {
    id = vehicleShieldImageId++
    vehicleShieldImageIds.set(image, id)
  }
  return `${id}@${image.naturalWidth}x${image.naturalHeight}`
}

function shieldRefKey(ref: string | undefined): string {
  if (!ref) return '-'
  let hash = 2166136261
  for (let i = 0; i < ref.length; i++) hash = Math.imul(hash ^ ref.charCodeAt(i), 16777619)
  return `${ref.length}:${hash >>> 0}`
}

/**
 * 载具、履带与轮胎合成贴身护盾；炮塔不传入本函数，因此不会参与轮廓重算。
 * 遮罩按 BASE_CELL 原生像素缓存，缩放只发生在最终绘制阶段。
 */
function vehicleShieldSilhouette(def: FortressDef): VehicleShieldSilhouette | null {
  if (typeof document === 'undefined' || typeof Path2D === 'undefined') return null
  const bodyImage = fortressSprite(def.spriteBody)
  const trackImages = (def.tracks ?? []).map(track => trackTileImage(track.tile))
  const wheelImages = (def.wheels ?? []).map(wheel => wheel.sprite ? trackTileImage(wheel.sprite) : null)
  const key = JSON.stringify({
    id: def.id,
    w: def.w,
    h: def.h,
    shape: def.shape,
    chassis: def.chassis,
    walkerStride: def.walkerStride,
    spriteBody: shieldRefKey(def.spriteBody),
    walkerBodyOffsetX: def.walkerBodyOffsetX,
    walkerBodyOffsetY: def.walkerBodyOffsetY,
    tracks: (def.tracks ?? []).map(track => ({ ...track, tile: shieldRefKey(track.tile) })),
    wheels: (def.wheels ?? []).map(wheel => ({ ...wheel, sprite: shieldRefKey(wheel.sprite) })),
    images: [shieldImageKey(bodyImage), ...trackImages.map(shieldImageKey), ...wheelImages.map(shieldImageKey)],
  })
  const cached = vehicleShieldSilhouetteCache.get(key)
  if (cached) return cached

  const layers: ShieldMaskDrawLayer[] = []
  const addLayer = (minX: number, minY: number, maxX: number, maxY: number, draw: ShieldMaskDrawLayer['draw']) => {
    if (![minX, minY, maxX, maxY].every(Number.isFinite) || maxX <= minX || maxY <= minY) return
    layers.push({ minX, minY, maxX, maxY, draw })
  }
  const addImage = (image: HTMLImageElement, width: number, height: number, x = 0, y = 0, source?: { x: number; y: number; w: number; h: number }) => {
    addLayer(x - width / 2, y - height / 2, x + width / 2, y + height / 2, ctx => {
      if (source) ctx.drawImage(image, source.x, source.y, source.w, source.h, x - width / 2, y - height / 2, width, height)
      else ctx.drawImage(image, x - width / 2, y - height / 2, width, height)
    })
  }

  if (bodyImage) {
    const columns = def.chassis === 'walker' ? WALKER_COLUMNS : 1
    const rows = def.chassis === 'walker' ? WALKER_ROWS : 1
    const sourceWidth = bodyImage.naturalWidth / columns
    const sourceHeight = bodyImage.naturalHeight / rows
    addImage(bodyImage, sourceWidth, sourceHeight, def.walkerBodyOffsetX ?? 0, def.walkerBodyOffsetY ?? 0, { x: 0, y: 0, w: sourceWidth, h: sourceHeight })
  }

  for (let index = 0; index < (def.tracks?.length ?? 0); index++) {
    const track = def.tracks![index]
    const image = trackImages[index]
    if (!image) continue
    const width = image.naturalWidth
    const tileLengthCells = image.naturalHeight / BASE_CELL
    for (const mirror of [false, true]) {
      for (const placement of centeredTrackPlacements(def, track, 0, tileLengthCells)) {
        const height = image.naturalHeight * placement.scaleY
        if (height < 0.3) continue
        const x = (mirror ? -placement.x : placement.x) * BASE_CELL
        const y = -placement.y * BASE_CELL
        addLayer(x - width / 2, y - height / 2, x + width / 2, y + height / 2, ctx => {
          ctx.save(); ctx.globalAlpha = placement.alpha; ctx.translate(x, y)
          if (mirror) ctx.scale(-1, 1)
          ctx.drawImage(image, -width / 2, -height / 2, width, height)
          ctx.restore()
        })
      }
    }
  }

  for (let index = 0; index < (def.wheels?.length ?? 0); index++) {
    const wheel = def.wheels![index]
    const image = wheelImages[index]
    const frames = wheelFrameCount(wheel)
    const sourceWidth = image ? image.naturalWidth / frames : 11
    const height = image?.naturalHeight ?? 20
    const source = image ? { x: 0, y: 0, w: sourceWidth, h: height } : undefined
    for (const placement of wheelPlacements(def, wheel)) {
      const x = placement.x * BASE_CELL, y = -placement.y * BASE_CELL
      // 转向轮使用三个固定角度的并集，既覆盖活动范围，又避免每帧随转角重建轮廓。
      const angles = wheel.steered ? [-Math.PI / 6, 0, Math.PI / 6] : [0]
      const radius = Math.hypot(sourceWidth, height) / 2
      addLayer(x - radius, y - radius, x + radius, y + radius, ctx => {
        for (const angle of angles) {
          ctx.save(); ctx.translate(x, y); ctx.rotate(angle)
          if (placement.mirror) ctx.scale(-1, 1)
          if (image && source) ctx.drawImage(image, source.x, source.y, source.w, source.h, -sourceWidth / 2, -height / 2, sourceWidth, height)
          else {
            ctx.fillStyle = '#fff'
            ctx.beginPath(); ctx.roundRect(-sourceWidth / 2, -height / 2, sourceWidth, height, sourceWidth * 0.35); ctx.fill()
          }
          ctx.restore()
        }
      })
    }
  }

  // 贴图尚未就绪或显式没有底座时，以载具占格形状提供稳定回退，避免护盾瞬间消失。
  if (layers.length === 0) {
    const localCenter = fortressLocalCenter(def)
    if (def.shape?.length) {
      for (const key of def.shape) {
        const [x, y] = key.split(',').map(Number)
        const minX = (x - localCenter.x) * BASE_CELL, minY = (y - localCenter.y) * BASE_CELL
        addLayer(minX, minY, minX + BASE_CELL, minY + BASE_CELL, ctx => {
          ctx.fillStyle = '#fff'; ctx.fillRect(minX, minY, BASE_CELL, BASE_CELL)
        })
      }
    } else {
      const width = Math.max(1, def.w) * BASE_CELL, height = Math.max(1, def.h) * BASE_CELL
      addLayer(-width / 2, -height / 2, width / 2, height / 2, ctx => {
        ctx.fillStyle = '#fff'; ctx.fillRect(-width / 2, -height / 2, width, height)
      })
    }
  }
  if (layers.length === 0) return null

  const dilation = 3
  const margin = dilation + 2
  const minX = Math.floor(Math.min(...layers.map(layer => layer.minX)) - margin)
  const minY = Math.floor(Math.min(...layers.map(layer => layer.minY)) - margin)
  const maxX = Math.ceil(Math.max(...layers.map(layer => layer.maxX)) + margin)
  const maxY = Math.ceil(Math.max(...layers.map(layer => layer.maxY)) + margin)
  const width = Math.max(1, maxX - minX), height = Math.max(1, maxY - minY)
  if (width > 2048 || height > 2048) return null
  const canvas = document.createElement('canvas')
  canvas.width = width; canvas.height = height
  const maskCtx = canvas.getContext('2d', { willReadFrequently: true })
  if (!maskCtx) return null
  maskCtx.translate(-minX, -minY)
  maskCtx.imageSmoothingEnabled = false
  for (const layer of layers) layer.draw(maskCtx)
  let rgba: Uint8ClampedArray
  try {
    rgba = maskCtx.getImageData(0, 0, width, height).data
  } catch {
    return null
  }
  const rawMask = new Uint8Array(width * height)
  for (let i = 0; i < rawMask.length; i++) rawMask[i] = rgba[i * 4 + 3] > 16 ? 1 : 0
  const mask = dilateShieldMask(rawMask, width, height, dilation)
  const contours = traceShieldMaskContours(mask, width, height, minX, minY, 8)
  if (contours.length === 0) return null
  const path = new Path2D()
  for (const contour of contours) {
    const points = resampleShieldContour(contour, 1.5)
    if (points.length < 3) continue
    path.moveTo(points[0].x, points[0].y)
    for (let i = 1; i < points.length; i++) path.lineTo(points[i].x, points[i].y)
    path.closePath()
  }
  const totalPerimeter = contours.reduce((sum, contour) => sum + contour.perimeter, 0)
  const edgeSamples: ShieldSilhouetteEdgeSample[] = []
  let perimeterOffset = 0
  for (const contour of contours) {
    const samples = resampleShieldContour(contour, Math.max(3, BASE_CELL * 0.16))
    for (let i = 0; i < samples.length; i++) {
      const point = samples[i], next = samples[(i + 1) % samples.length]
      edgeSamples.push({
        ...point,
        nextX: next.x,
        nextY: next.y,
        progress: totalPerimeter > 0 ? (perimeterOffset + contour.perimeter * i / Math.max(1, samples.length)) / totalPerimeter : 0,
      })
    }
    perimeterOffset += contour.perimeter
  }
  const silhouette: VehicleShieldSilhouette = {
    path,
    minX,
    minY,
    maxX,
    maxY,
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
    halfW: (maxX - minX) / 2,
    halfH: (maxY - minY) / 2,
    edgeSamples,
    interiorSamples: sampleShieldMaskInterior(mask, width, height, minX, minY, BASE_CELL * 0.72),
  }
  if (vehicleShieldSilhouetteCache.size >= 24) vehicleShieldSilhouetteCache.clear()
  vehicleShieldSilhouetteCache.set(key, silhouette)
  return silhouette
}

function shieldSilhouetteHexLayout(silhouette: VehicleShieldSilhouette, tileSize: number): ShieldHexTile[] {
  const hexW = tileSize * 0.75, hexH = tileSize * 0.875, stepY = hexH * 0.75
  const margin = tileSize * 0.38
  const out: ShieldHexTile[] = []
  let row = 0
  for (let y = silhouette.minY - margin; y <= silhouette.maxY + margin; y += stepY, row++) {
    const offset = row & 1 ? hexW / 2 : 0
    for (let x = silhouette.minX - margin + offset; x <= silhouette.maxX + margin; x += hexW) {
      out.push({ x, y, edge: 1, squashX: 1, squashY: 1 })
    }
  }
  return out
}

/** 履带/轮胎印屏幕外剔除；margin 覆盖贴图旋转后的外扩范围。 */
export function trackMarkVisibleOnScreen(screenX: number, screenY: number, width: number, height: number, margin: number): boolean {
  return screenX >= -margin && screenX <= width + margin && screenY >= -margin && screenY <= height + margin
}

/** 履带板只在生成时写入固定世界分辨率缓存；之后每帧按可见分块合批绘制。 */
function stampTrackMarkChunk(mark: TrackMark): void {
  if (mark.kind === 'wheel' || typeof document === 'undefined') return
  const image = trackTileImage(mark.tile)
  if (!image) return
  const tinted = tintedFx(image, '#2E2A24')
  if (!tinted) return
  const frames = Math.max(1, Math.floor(mark.frames ?? 1))
  const sourceW = image.width / frames
  const radius = Math.hypot(sourceW, image.height) / BASE_CELL / 2
  const minCx = Math.floor((mark.x - radius) / TRACK_MARK_CHUNK_CELLS)
  const maxCx = Math.floor((mark.x + radius) / TRACK_MARK_CHUNK_CELLS)
  const minCy = Math.floor((mark.y - radius) / TRACK_MARK_CHUNK_CELLS)
  const maxCy = Math.floor((mark.y + radius) / TRACK_MARK_CHUNK_CELLS)
  const bucket = Math.floor(mark.born / TRACK_MARK_CHUNK_BUCKET)
  const chunkPx = TRACK_MARK_CHUNK_CELLS * BASE_CELL
  for (let cy = minCy; cy <= maxCy; cy++) for (let cx = minCx; cx <= maxCx; cx++) {
    const key = `${cx},${cy},${bucket}`
    let chunk = trackMarkChunks.get(key)
    if (!chunk) {
      const canvas = document.createElement('canvas')
      canvas.width = chunkPx; canvas.height = chunkPx
      chunk = { cx, cy, bucket, bornMax: mark.born, canvas }
      trackMarkChunks.set(key, chunk)
    }
    chunk.bornMax = Math.max(chunk.bornMax, mark.born)
    const chunkCtx = chunk.canvas.getContext('2d')
    if (!chunkCtx) continue
    chunkCtx.save()
    chunkCtx.translate((mark.x - cx * TRACK_MARK_CHUNK_CELLS) * BASE_CELL, (mark.y - cy * TRACK_MARK_CHUNK_CELLS) * BASE_CELL)
    chunkCtx.rotate(mark.angle)
    if (mark.mirror) chunkCtx.scale(-1, 1)
    chunkCtx.drawImage(tinted, 0, 0, sourceW, image.height, -sourceW / 2, -image.height / 2, sourceW, image.height)
    chunkCtx.restore()
  }
}

function drawTrackMarkChunks(
  ctx: CanvasRenderingContext2D, time: number, X: (x: number) => number, Y: (y: number) => number,
  cell: number, width: number, height: number,
): number {
  let visible = 0
  const screenSize = TRACK_MARK_CHUNK_CELLS * cell
  for (const [key, chunk] of trackMarkChunks) {
    const age = Math.max(0, time - chunk.bornMax)
    if (age > TRACK_MARK_LIFE + TRACK_MARK_CHUNK_BUCKET) { trackMarkChunks.delete(key); continue }
    const alpha = TRACK_MARK_ALPHA * Math.max(0, Math.min(1, (TRACK_MARK_LIFE - age) / TRACK_MARK_FADE))
    if (alpha <= 0.01) continue
    const sx = X(chunk.cx * TRACK_MARK_CHUNK_CELLS)
    const sy = Y(chunk.cy * TRACK_MARK_CHUNK_CELLS)
    if (sx > width || sy > height || sx + screenSize < 0 || sy + screenSize < 0) continue
    ctx.globalAlpha = alpha
    ctx.drawImage(chunk.canvas, sx, sy, screenSize, screenSize)
    visible++
  }
  ctx.globalAlpha = 1
  return visible
}

/** 轮胎印按路径和四档年龄合并为少量 Path2D；外缘与中芯双层描边增强可读性。 */
function drawWheelMarkPaths(
  ctx: CanvasRenderingContext2D, marks: readonly TrackMark[], time: number,
  X: (x: number) => number, Y: (y: number) => number, cell: number, width: number, height: number,
): number {
  if (typeof Path2D === 'undefined') return 0
  const groups = new Map<string, TrackMark[]>()
  for (const mark of marks) if (mark.kind === 'wheel') {
    const key = mark.pathKey ?? 'wheel'
    const group = groups.get(key)
    if (group) group.push(mark); else groups.set(key, [mark])
  }
  const paths = Array.from({ length: 4 }, () => new Path2D())
  let segments = 0
  for (const points of groups.values()) for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i]
    const age = Math.max(0, time - b.born)
    if (age > TRACK_MARK_LIFE || Math.hypot(b.x - a.x, b.y - a.y) > 0.75) continue
    const ax = X(a.x), ay = Y(a.y), bx = X(b.x), by = Y(b.y)
    if (!trackMarkVisibleOnScreen(ax, ay, width, height, cell) && !trackMarkVisibleOnScreen(bx, by, width, height, cell)) continue
    const band = Math.min(3, Math.floor(age / TRACK_MARK_LIFE * 4))
    paths[band].moveTo(ax, ay); paths[band].lineTo(bx, by)
    segments++
  }
  ctx.save()
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'
  for (let band = 3; band >= 0; band--) {
    const age = (band + 0.5) / 4 * TRACK_MARK_LIFE
    const alpha = TRACK_MARK_ALPHA * Math.max(0, Math.min(1, (TRACK_MARK_LIFE - age) / TRACK_MARK_FADE))
    if (alpha <= 0.01) continue
    ctx.globalAlpha = alpha
    ctx.strokeStyle = '#211E1A'; ctx.lineWidth = Math.max(1, cell * 0.16); ctx.stroke(paths[band])
    ctx.globalAlpha = alpha * 0.55
    ctx.strokeStyle = '#51483C'; ctx.lineWidth = Math.max(0.6, cell * 0.065); ctx.stroke(paths[band])
  }
  ctx.restore()
  return segments
}

export function draw(ctx: CanvasRenderingContext2D, s: GameState, v: ViewCtx, ui: UiHints, W: number, H: number) {
  const { cell, viewX, viewY } = v
  const X = (x: number) => (x - viewX) * cell
  const Y = (y: number) => (y - viewY) * cell
  // 动态实体只为当前视口生成排序项与绘制命令；4 格余量覆盖大型单位、炮管、阴影与粒子外延。
  const visiblePadding = 4
  const visibleLeft = viewX - visiblePadding
  const visibleTop = viewY - visiblePadding
  const visibleRight = viewX + W / cell + visiblePadding
  const visibleBottom = viewY + H / cell + visiblePadding
  const pointVisible = (x: number, y: number) => x >= visibleLeft && x <= visibleRight && y >= visibleTop && y <= visibleBottom
  const rectVisible = (x: number, y: number, w: number, h: number) => x + w >= visibleLeft && x <= visibleRight && y + h >= visibleTop && y <= visibleBottom
  const battleVisionActive = !ui.edit && gameParameters().battleVisionEnabled
  const battleVisionSources = battleVisionActive ? playerTeamVisionSources(s) : []
  const battleVisionRadius = battleVisionActive ? playerTeamVisionRadiusCells() : Infinity
  const pointInBattleVision = (x: number, y: number, padding = 0) => {
    if (!battleVisionActive) return true
    const radius = battleVisionRadius + Math.max(0, padding)
    const radiusSq = radius * radius
    return battleVisionSources.some(source => {
      const dx = x - source.x
      const dy = y - source.y
      return dx * dx + dy * dy <= radiusSq
    })
  }
  const beginBattleVisionClip = () => {
    if (!battleVisionActive) return false
    ctx.save()
    ctx.beginPath()
    for (const source of battleVisionSources) ctx.arc(X(source.x), Y(source.y), battleVisionRadius * cell, 0, Math.PI * 2)
    ctx.clip()
    return true
  }
  // 贴图原尺寸倍率：基准格全设备统一 BASE_CELL=32px——zoom=1 时 1 贴图像素 = 1 画布像素，
  // 横竖屏/任何设备贴图与网格比例恒定，随用户缩放等比变化
  const zf = v.cell / BASE_CELL
  ctx.clearRect(0, 0, W, H)
  if (!ui.edit) {
    // 游玩镜头允许越出关卡边缘；所有未被有效战场矩形覆盖的区域保持纯黑。
    ctx.fillStyle = '#000000'
    ctx.fillRect(0, 0, W, H)
  }

  // 粒子逐帧运动（rAF wall-clock dt，clamp 0.1 防后台切回大步长）
  const nowFx = typeof performance !== 'undefined' ? performance.now() / 1000 : 0
  const fxDt = fxLastStep < 0 ? 0 : Math.min(0.1, Math.max(0, nowFx - fxLastStep))
  fxLastStep = nowFx
  stepParticles(fxPool, fxDt)
  if (ui.interiorMode) shieldInteriorWasOpen = true
  else if (shieldInteriorWasOpen) {
    shieldInteriorWasOpen = false
    if (s.fortress.maxShield > 0) shieldUnfoldStartedAt = s.time
  }
  stepParticles(groundPool, fxDt)
  if (!ui.edit) emitWalkerStepDust(s)
  // v2.40 堡垒特效点粒子发射（编辑模式不发射）：粒子离口即世界空间独立运动，不再跟船
  if (!ui.edit) emitFortressEffects(s, fortressDef(s), fxDt, groundPool, fxPool, fxEmitterAccs)
  if (!TRACK_MARK_EFFECT_ENABLED) {
    // 防止开发热更新或日后运行时切换开关时留下旧印迹和单位累加状态。
    if (trackMarkTime !== -2) {
      trackMarks.length = 0
      trackMarkSt.acc = []; trackMarkSt.prevPhase = []; trackMarkSt.moving = []; trackMarkSt.stroke = []
      unitTrackMarkStates.clear()
      trackMarkChunks.clear()
      trackMarkTime = -2
    }
    if (typeof window !== 'undefined') {
      (window as unknown as { __tdTrackMarks?: { total: number; visible: number } }).__tdTrackMarks = { total: 0, visible: 0 }
    }
  } else if (!ui.edit) {
    for (const enemy of s.enemies) {
      const unit = runtimeEnemyUnitDef(enemy.unitDefId, enemy.kind)
      const platform = unit.legacy?.registry === 'fortress' ? unit.legacy.def : unit.vehiclePlatform
      if (enemy.hp > 0 && enemy.vehicle && platform) emitVehicleEffects({ id: enemy.id, x: enemy.x, y: enemy.y, heading: enemy.vehicle.heading, vx: enemy.vehicle.vx, vy: enemy.vehicle.vy }, platform, fxDt, groundPool, fxPool, fxEmitterAccs)
    }
    for (const ally of s.allies) {
      const unit = runtimeAllyUnitDef(ally.unitDefId, ally.kind)
      const platform = unit.legacy?.registry === 'fortress' ? unit.legacy.def : unit.vehiclePlatform
      if (ally.hp > 0 && ally.vehicle && platform) emitVehicleEffects({ id: ally.id, x: ally.x, y: ally.y, heading: ally.vehicle.heading, vx: ally.vehicle.vx, vy: ally.vehicle.vy }, platform, fxDt, groundPool, fxPool, fxEmitterAccs)
    }
  }
  if (!ui.edit) {
    if (craterTime >= 0 && s.time < craterTime) { craters.length = 0; craterSeen.clear() }
    craterTime = s.time
    updateCraters(craters, craterSeen, s.explosions, s.time, ex => ex.kind === 'groundImpact'
      ? ammoVisualDiameter(ex.ammoId, ex.projectileSize ?? 0.4)
      : undefined)
  }
  // 阵营无关的载具结构烟：低于25%时按载具体量分配稳定烟源；重开时清空累积状态。
  if (vehicleDamageSmokeTime >= 0 && s.time < vehicleDamageSmokeTime) {
    vehicleDamageSmokeStates.clear()
    aircraftCrashSmokeStates.clear()
  }
  vehicleDamageSmokeTime = s.time
  if (!ui.edit) {
    const liveSmokeKeys = new Set<string>()
    const liveCrashSmokeKeys = new Set<string>()
    const playerDef = fortressDef(s)
    const playerRect = fortressRect(s)
    const playerSmokeKey = 'player'
    liveSmokeKeys.add(playerSmokeKey)
    emitVehicleDamageSmoke(playerSmokeKey, 17, {
      x: playerRect.x + playerRect.w / 2, y: playerRect.y + playerRect.h / 2,
      heading: s.fortress.heading, vx: s.fortress.vx, vy: s.fortress.vy,
    }, playerDef, s.fortress.hp, s.fortress.maxHp, 1, s.fortress.dyingT < 0 ? fxDt : 0)
    for (const enemy of s.enemies) {
      const unit = runtimeEnemyUnitDef(enemy.unitDefId, enemy.kind)
      const platform = unit.legacy?.registry === 'fortress' ? unit.legacy.def : unit.vehiclePlatform
      if (enemy.aircraft?.crash) {
        const crashKey = `enemy:${enemy.id}`
        liveCrashSmokeKeys.add(crashKey)
        emitAircraftCrashSmoke(crashKey, 300_000 + enemy.id, enemy, unit, enemy.bossSizeScale ?? 1, fxDt)
      }
      if (!enemy.vehicle || !platform) continue
      const key = `enemy:${enemy.id}`
      liveSmokeKeys.add(key)
      emitVehicleDamageSmoke(key, 100_000 + enemy.id, {
        x: enemy.x, y: enemy.y, heading: enemy.vehicle.heading, vx: enemy.vehicle.vx, vy: enemy.vehicle.vy,
      }, platform, enemy.hp, enemy.maxHp, enemy.bossSizeScale ?? 1, enemy.hp > 0 ? fxDt : 0)
    }
    for (const ally of s.allies) {
      const unit = runtimeAllyUnitDef(ally.unitDefId, ally.kind)
      const platform = unit.legacy?.registry === 'fortress' ? unit.legacy.def : unit.vehiclePlatform
      if (ally.aircraft?.crash) {
        const crashKey = `ally:${ally.id}`
        liveCrashSmokeKeys.add(crashKey)
        emitAircraftCrashSmoke(crashKey, 400_000 + ally.id, ally, unit, 1, fxDt)
      }
      if (!ally.vehicle || !platform) continue
      const key = `ally:${ally.id}`
      liveSmokeKeys.add(key)
      emitVehicleDamageSmoke(key, 200_000 + ally.id, {
        x: ally.x, y: ally.y, heading: ally.vehicle.heading, vx: ally.vehicle.vx, vy: ally.vehicle.vy,
      }, platform, ally.hp, ally.maxHp, 1, ally.hp > 0 ? fxDt : 0)
    }
    for (const key of vehicleDamageSmokeStates.keys()) if (!liveSmokeKeys.has(key)) vehicleDamageSmokeStates.delete(key)
    for (const key of aircraftCrashSmokeStates.keys()) if (!liveCrashSmokeKeys.has(key)) aircraftCrashSmokeStates.delete(key)
  } else {
    vehicleDamageSmokeStates.clear()
    aircraftCrashSmokeStates.clear()
  }
  // ---- 三层地面：底层平铺 → 战场层（RMXP Autotile）→ 基地层（RMXP Autotile） ----
  const groundBase = srcImage('/res/ground/ground_base.png')
  const groundMid = srcImage('/res/ground/ground_mid.png')
  const groundTop = srcImage('/res/ground/ground_top.png')
  const gy0 = Math.max(0, Math.floor(viewY))
  const gy1 = Math.min(LEVEL.rows, Math.ceil(viewY + H / cell + 1))
  const gx0 = Math.max(0, Math.floor(viewX))
  const gx1 = Math.min(LEVEL.cols, Math.ceil(viewX + W / cell + 1))
  if (!ui.edit) {
    // 游玩场景只在有效关卡矩形内铺无纹理底色；镜头越界部分保留上方黑底。
    ctx.fillStyle = '#877760'
    ctx.fillRect(X(0), Y(0), LEVEL.cols * cell, LEVEL.rows * cell)
  } else if (groundBase.status === 'ready' && groundBase.img) { // 编辑器保留底图纹理，便于图块定位
    for (let y = gy0; y < gy1; y++)
      for (let x = gx0; x < gx1; x++)
        ctx.drawImage(groundBase.img, 0, 0, 32, 32, X(x), Y(y), cell, cell)
  } else { // 贴图未就绪兜底：延续统一灰底
    ctx.fillStyle = '#71757A'
    ctx.fillRect(0, 0, W, H)
  }

  const drawConfiguredTiles = (tiles: LevelTileCell[], layer: 'base' | 'overlay') => {
    const autotiles = new Map<string, string[]>()
    for (const tile of tiles) {
      if (tile.x < gx0 || tile.x >= gx1 || tile.y < gy0 || tile.y >= gy1) continue
      // 游玩态的内置底图也改用统一实色，避免关卡保存的逐格底图重新带回
      // ground_base 贴图中的网点与平铺接缝；编辑器仍保留原图块预览。
      if (!ui.edit && (tile.assetId === 'builtin:ground/base' || tile.assetId === 'builtin:ground/mid')) {
        ctx.fillStyle = '#877760'
        ctx.fillRect(X(tile.x), Y(tile.y), cell, cell)
        continue
      }
      const source = tile.assetId === 'builtin:ground/base' ? '/res/ground/ground_base.png'
        : tile.assetId === 'builtin:ground/mid' ? '/res/ground/ground_mid.png'
          : tile.assetId === 'builtin:ground/top' ? '/res/ground/ground_top.png'
            : getAsset(tile.assetId)?.src ?? tile.assetId
      if (!source) continue
      if (tile.source === 'autotile') {
        const cells = autotiles.get(source) ?? []
        cells.push(`${tile.x},${tile.y}`)
        autotiles.set(source, cells)
        continue
      }
      const image = srcImage(source)
      if (image.status !== 'ready' || !image.img) continue
      const columns = Math.max(1, Math.floor(image.img.width / 32))
      const sx = (tile.tileIndex % columns) * 32
      const sy = Math.floor(tile.tileIndex / columns) * 32
      ctx.save()
      const cx = X(tile.x) + cell / 2; const cy = Y(tile.y) + cell / 2
      ctx.translate(cx, cy)
      ctx.rotate(tile.rotation * Math.PI / 180)
      ctx.scale(tile.flipX ? -1 : 1, 1)
      ctx.imageSmoothingEnabled = false
      // 游玩态底图轻微外扩，覆盖小数缩放/相机偏移造成的逐格采样缝；
      // 图块内容仍完整保留，不再把铺满场景的底图误当作网格隐藏。
      const seamOverlap = !ui.edit && layer === 'base' ? Math.min(0.75, cell * 0.025) : 0
      ctx.drawImage(image.img, sx, sy, 32, 32, -cell / 2 - seamOverlap, -cell / 2 - seamOverlap, cell + seamOverlap * 2, cell + seamOverlap * 2)
      ctx.restore()
    }
    for (const [source, cells] of autotiles) {
      const image = srcImage(source)
      if (image.status === 'ready' && image.img) {
        // 使用渲染时钟而非逻辑时钟：关卡编辑器暂停 tick 时动态 Autotile 仍可预览。
        drawRmxpGroundLayer(ctx, image.img, cells, X, Y, cell, rmxpAnimationFrameX(image.img))
      }
    }
  }

  const drawTerrainDefinitions = (
    terrain: readonly { kind: string; defId?: string; x: number; y: number; w: number; h: number }[],
    showLabels = false,
  ) => {
    const groups = new Map<string, { assetId?: string; name: string; cells: Set<string> }>()
    for (const item of terrain) {
      if (!rectVisible(item.x, item.y, item.w, item.h)) continue
      const def = terrainTypeById(item.defId)
      const key = item.defId ?? item.kind
      const group = groups.get(key) ?? {
        assetId: def?.asset,
        name: def?.name ?? (item.kind === 'puddle' ? '水坑' : item.kind),
        cells: new Set<string>(),
      }
      for (let y = Math.floor(item.y); y < Math.ceil(item.y + item.h); y++) {
        for (let x = Math.floor(item.x); x < Math.ceil(item.x + item.w); x++) group.cells.add(`${x},${y}`)
      }
      groups.set(key, group)
    }
    for (const group of groups.values()) {
      const cells = [...group.cells]
      const art = group.assetId ? assetImage(group.assetId) : null
      if (art?.status === 'ready' && art.img) drawRmxpGroundLayer(ctx, art.img, cells, X, Y, cell, rmxpAnimationFrameX(art.img))
      else {
        ctx.fillStyle = '#FFFFFF'
        for (const key of cells) {
          const [x, y] = key.split(',').map(Number)
          ctx.fillRect(X(x), Y(y), cell, cell)
        }
      }
    }
    if (!showLabels) return

    // 同一地形类型按四方向连通拆分；每块连通区域只标一次名称。
    for (const group of groups.values()) {
      const remaining = new Set(group.cells)
      while (remaining.size > 0) {
        const first = remaining.values().next().value
        if (typeof first !== 'string') break
        const stack = [first]
        const component: { x: number; y: number }[] = []
        remaining.delete(first)
        while (stack.length > 0) {
          const key = stack.pop()!
          const [x, y] = key.split(',').map(Number)
          component.push({ x, y })
          for (const neighbor of [`${x - 1},${y}`, `${x + 1},${y}`, `${x},${y - 1}`, `${x},${y + 1}`]) {
            if (!remaining.delete(neighbor)) continue
            stack.push(neighbor)
          }
        }

        const centerX = component.reduce((sum, point) => sum + point.x + 0.5, 0) / component.length
        const centerY = component.reduce((sum, point) => sum + point.y + 0.5, 0) / component.length
        const anchor = component.reduce((best, point) => {
          const distance = (point.x + 0.5 - centerX) ** 2 + (point.y + 0.5 - centerY) ** 2
          return distance < best.distance ? { point, distance } : best
        }, { point: component[0], distance: Number.POSITIVE_INFINITY }).point
        const minX = Math.min(...component.map(point => point.x))
        const maxX = Math.max(...component.map(point => point.x))

        ctx.save()
        ctx.font = `900 ${Math.max(10, Math.min(14, cell * 0.36))}px sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.lineJoin = 'round'
        ctx.strokeStyle = 'rgba(239,235,216,0.92)'
        ctx.lineWidth = Math.max(2, cell * 0.1)
        const labelX = X(anchor.x + 0.5)
        const labelY = Y(anchor.y + 0.5)
        const maxWidth = Math.max(cell - 6, (maxX - minX + 1) * cell - 8)
        ctx.strokeText(group.name, labelX, labelY, maxWidth)
        ctx.fillStyle = '#1A1A18'
        ctx.fillText(group.name, labelX, labelY, maxWidth)
        ctx.restore()
      }
    }
  }

  drawConfiguredTiles(ui.edit?.baseTiles ?? LEVEL.baseTiles, 'base')

  const inScene = (k: string) => {
    const [x, y] = k.split(',').map(Number)
    return x >= 0 && x < LEVEL.cols && y >= gy0 && y < gy1
  }
  // 战场层：纯视觉笔刷层（出生带不铺设；编辑模式读 draft）
  const configuredOverlay = ui.edit?.overlayTiles ?? LEVEL.overlayTiles
  const battleCells = configuredOverlay.length > 0 ? [] : (ui.edit?.groundCells ?? LEVEL.groundCells).filter(k => {
    const [, y] = k.split(',').map(Number)
    return y >= SPAWN_ROWS && inScene(k)
  })
  if (battleCells.length > 0) {
    if (!ui.edit) {
      // 旧关卡的 groundCells 会覆盖整片战场；游玩态改用实色，避免 ground_mid
      // 自带的逐格纹理再次形成全屏网格。关卡编辑器仍显示原 Autotile 便于编辑。
      ctx.fillStyle = '#877760'
      for (const k of battleCells) {
        const [x, y] = k.split(',').map(Number)
        ctx.fillRect(X(x), Y(y), cell, cell)
      }
    } else if (groundMid.status === 'ready' && groundMid.img) drawRmxpGroundLayer(ctx, groundMid.img, battleCells, X, Y, cell)
    else { // 未就绪兜底：淡绿灰提示已铺设区域
      ctx.fillStyle = 'rgba(110,123,104,0.35)'
      for (const k of battleCells) {
        const [x, y] = k.split(',').map(Number)
        ctx.fillRect(X(x), Y(y), cell, cell)
      }
    }
  }
  drawConfiguredTiles(configuredOverlay, 'overlay')
  // 基地层：基地格全集（含墙段格；墙段后续由 wall01/ground01 覆盖），编辑模式读 draft
  const baseGroundCells = (ui.edit?.cells ?? LEVEL.buildCells).filter(inScene)
  if (baseGroundCells.length > 0) {
    if (groundTop.status === 'ready' && groundTop.img) drawRmxpGroundLayer(ctx, groundTop.img, baseGroundCells, X, Y, cell)
    else { // 未就绪兜底：保持基地底色统一
      ctx.fillStyle = '#71757A'
      for (const k of baseGroundCells) {
        const [x, y] = k.split(',').map(Number)
        ctx.fillRect(X(x), Y(y), cell, cell)
      }
    }
  }

  // 事件功能区域沿用停留区域的不规则格集合，边界只绘制外轮廓。
  if (!ui.edit) {
    const playerRect = fortressRect(s)
    const playerCellKey = `${Math.floor(playerRect.x + playerRect.w / 2)},${Math.floor(playerRect.y + playerRect.h / 2)}`
    for (const zone of levelServiceZones(s)) {
      const cells = new Set(zone.cells)
      const inside = zone.active && cells.has(playerCellKey)
      const ammoOnly = zone.service === 'functional' && zone.ammoEnabled && !zone.energyEnabled && !zone.repairEnabled && !zone.assemblyEnabled
      const energyOnly = zone.service === 'functional' && zone.energyEnabled && !zone.ammoEnabled && !zone.repairEnabled && !zone.assemblyEnabled
      const repairOnly = zone.service === 'functional' && zone.repairEnabled && !zone.ammoEnabled && !zone.energyEnabled && !zone.assemblyEnabled
      const color = !zone.active ? '#77736A' : zone.service === 'assembly' || zone.assemblyEnabled ? '#B3392E' : repairOnly ? '#A34B42' : ammoOnly ? '#A07840' : energyOnly ? '#5C7E8C' : '#3E7D46'
      ctx.save()
      ctx.fillStyle = `${color}${inside ? '32' : '1A'}`
      for (const key of cells) {
        const [x, y] = key.split(',').map(Number)
        if (!rectVisible(x, y, 1, 1)) continue
        ctx.fillRect(X(x), Y(y), cell, cell)
      }
      ctx.strokeStyle = color
      ctx.lineWidth = inside ? 3 : 2
      ctx.setLineDash(zone.active ? [Math.max(4, cell * 0.18), Math.max(3, cell * 0.12)] : [3, 4])
      ctx.beginPath()
      for (const key of cells) {
        const [x, y] = key.split(',').map(Number)
        if (!rectVisible(x, y, 1, 1)) continue
        const left = X(x), top = Y(y), right = left + cell, bottom = top + cell
        if (!cells.has(`${x},${y - 1}`)) { ctx.moveTo(left, top); ctx.lineTo(right, top) }
        if (!cells.has(`${x + 1},${y}`)) { ctx.moveTo(right, top); ctx.lineTo(right, bottom) }
        if (!cells.has(`${x},${y + 1}`)) { ctx.moveTo(right, bottom); ctx.lineTo(left, bottom) }
        if (!cells.has(`${x - 1},${y}`)) { ctx.moveTo(left, bottom); ctx.lineTo(left, top) }
      }
      ctx.stroke()
      ctx.setLineDash([])
      if (cells.size > 0) {
        const points = [...cells].map(key => key.split(',').map(Number) as [number, number])
        const labelX = points.reduce((sum, point) => sum + point[0] + 0.5, 0) / points.length
        const labelY = points.reduce((sum, point) => sum + point[1] + 0.5, 0) / points.length
        const functions = zone.service === 'assembly' ? ['整备'] : [zone.ammoEnabled ? '补弹' : '', zone.energyEnabled ? '充能' : '', zone.repairEnabled ? '修理' : '', zone.assemblyEnabled ? '整备' : ''].filter(Boolean)
        const label = functions.length === 1 ? `${functions[0]}区` : '功能区域'
        ctx.font = `900 ${Math.max(9, Math.min(13, cell * 0.34))}px sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.lineJoin = 'round'
        ctx.strokeStyle = 'rgba(26,26,24,0.92)'
        ctx.lineWidth = 3
        ctx.strokeText(label, X(labelX), Y(labelY))
        ctx.fillStyle = zone.active ? '#EFEBD8' : '#C7C2AF'
        ctx.fillText(label, X(labelX), Y(labelY))
      }
      ctx.restore()
    }
  }

  // 推进终点：游玩态给出清晰但不遮挡战场的撤离区域标记。
  if (!ui.edit && s.objective.type === 'reach') {
    const cells = new Set(objectiveFinishCells(s.objective, LEVEL.finishZone, LEVEL.rows, LEVEL.cols))
    ctx.fillStyle = 'rgba(217,164,65,0.14)'
    for (const key of cells) {
      const [x, y] = key.split(',').map(Number)
      ctx.fillRect(X(x), Y(y), cell, cell)
    }
    ctx.strokeStyle = 'rgba(217,164,65,0.9)'
    ctx.lineWidth = 2
    ctx.setLineDash([8, 5])
    ctx.beginPath()
    for (const key of cells) {
      const [x, y] = key.split(',').map(Number)
      const left = X(x), top = Y(y), right = left + cell, bottom = top + cell
      if (!cells.has(`${x},${y - 1}`)) { ctx.moveTo(left, top); ctx.lineTo(right, top) }
      if (!cells.has(`${x + 1},${y}`)) { ctx.moveTo(right, top); ctx.lineTo(right, bottom) }
      if (!cells.has(`${x},${y + 1}`)) { ctx.moveTo(right, bottom); ctx.lineTo(left, bottom) }
      if (!cells.has(`${x - 1},${y}`)) { ctx.moveTo(left, bottom); ctx.lineTo(left, top) }
    }
    ctx.stroke()
    ctx.setLineDash([])
  }

  if (!ui.edit) for (const item of LEVEL.interactables) {
    const rt = s.interactableStates.find(v => v.id === item.id)
    if (rt && !rt.enabled) continue
    const color = item.kind === 'supply' ? '#3E7D46' : item.kind === 'gate' ? '#5C7E8C' : item.kind === 'target' ? '#D9762E' : '#8A5C9E'
    ctx.fillStyle = `${color}24`
    ctx.fillRect(X(item.x), Y(item.y), item.w * cell, item.h * cell)
    ctx.strokeStyle = color
    ctx.lineWidth = 2
    ctx.setLineDash([4, 3])
    ctx.strokeRect(X(item.x), Y(item.y), item.w * cell, item.h * cell)
    ctx.setLineDash([])
  }

  // 内角凹转角叠加（基地内部格被 2 段垂直墙夹成 90° 内角；地面已由基地层铺设）
  if (!ui.edit) {
    const wAtlas = srcImage('/res/walls/wall01.png')
    const wOk = wAtlas.status === 'ready' && wAtlas.img !== undefined
    if (wOk) {
      const wallSet0 = new Set<string>()
      const baseSet0 = new Set<string>(LEVEL.buildCells)
      for (const w of s.walls) {
        for (const c of w.cells) wallSet0.add(`${c.x},${c.y}`)
      }
      for (const k of LEVEL.buildCells) {
        const [bx, by] = k.split(',').map(Number)
        if (!isInnerCell(bx, by)) continue
        const notch = notchTileAt(bx, by, wallSet0, baseSet0)
        if (notch) {
          ctx.drawImage(wAtlas.img as CanvasImageSource,
            (notch.c - 1) * 32, (notch.r - 1) * 32, 32, 32, X(bx), Y(by), cell, cell)
        }
      }
    }
  }

  // 网格
  if (ui.edit && ui.showGrid !== false) {
    ctx.strokeStyle = 'rgba(0,0,0,0.2)'
    ctx.lineWidth = 1
    for (let x = 1; x < LEVEL.cols; x++) {
      ctx.beginPath(); ctx.moveTo(X(x), 0); ctx.lineTo(X(x), H); ctx.stroke()
    }
    const y0 = Math.max(0, Math.floor(viewY))
    const y1 = Math.min(LEVEL.rows, Math.ceil(viewY + H / cell + 1))
    for (let y = y0; y <= y1; y++) {
      ctx.beginPath(); ctx.moveTo(0, Y(y)); ctx.lineTo(W, Y(y)); ctx.stroke()
    }
  }

  // ---- 地形（贴地效果层，永不挡弹道/移动；实例随 LEVEL） ----
  if (!ui.edit) drawTerrainDefinitions(LEVEL.terrain)

  // ---- 地面弹坑（v2.57：地形之上、物体与履带印之下；纯装饰，不进引擎持久状态） ----
  if (!ui.edit) for (const mk of craters) {
    const age = Math.max(0, s.time - mk.born)
    const alpha = 0.82 * craterOpacity(age)
    if (alpha <= 0.01) continue
    const tex = craterTexture(mk.seed)
    const size = mk.r * 2 * cell
    ctx.save()
    ctx.translate(X(mk.x), Y(mk.y))
    ctx.rotate((eventRandom(mk.seed, 90) - 0.5) * 0.6)
    ctx.globalAlpha = alpha
    if (tex) ctx.drawImage(tex, -size / 2, -size * 0.38, size, size * 0.76)
    else {
      ctx.fillStyle = '#2B241D'
      ctx.beginPath(); ctx.ellipse(0, 0, size / 2, size * 0.32, 0, 0, Math.PI * 2); ctx.fill()
    }
    ctx.restore()
  }
  ctx.globalAlpha = 1

  // ---- 物体（油桶/废墟/岩石；编辑模式由 draft 层接管） ----
  const runtimeObjects = s.objects
    .filter(object => rectVisible(object.x, object.y, object.w, object.h))
    .sort((a, b) => (a.renderLayer ?? 3) - (b.renderLayer ?? 3) || (a.y + a.h) - (b.y + b.h))
  const runtimeObjectAutotiles = new Map<string, Set<string>>()
  if (!ui.edit) for (const o of runtimeObjects) {
    const def = objectTypeById(o.defId)
    const sheetKind = def?.asset ? getAsset(def.asset)?.tileSheet?.kind : undefined
    if (sheetKind !== 'autotileStatic' && sheetKind !== 'autotileAnimated') continue
    const key = `${o.renderLayer ?? 3}:${o.defId ?? o.kind}`
    const cells = runtimeObjectAutotiles.get(key) ?? new Set<string>()
    cells.add(`${Math.floor(o.x)},${Math.floor(o.y)}`)
    runtimeObjectAutotiles.set(key, cells)
  }
  const drawRuntimeObject = (o: (typeof runtimeObjects)[number]) => {
    const typeDef = objectTypeById(o.defId)
    const objectArt = typeDef?.asset ? assetImage(typeDef.asset) : null
    const sheetKind = typeDef?.asset ? getAsset(typeDef.asset)?.tileSheet?.kind : undefined
    if ((sheetKind === 'autotileStatic' || sheetKind === 'autotileAnimated') && objectArt?.status === 'ready' && objectArt.img) {
      const cells = runtimeObjectAutotiles.get(`${o.renderLayer ?? 3}:${o.defId ?? o.kind}`) ?? new Set([`${Math.floor(o.x)},${Math.floor(o.y)}`])
      const previousSmoothing = ctx.imageSmoothingEnabled
      ctx.imageSmoothingEnabled = false
      drawRmxpAutotileCell(ctx, objectArt.img, cells, Math.floor(o.x), Math.floor(o.y), X, Y, cell / 2, rmxpAnimationFrameX(objectArt.img))
      ctx.imageSmoothingEnabled = previousSmoothing
      // Autotile 依靠相邻格无缝拼接；不再为每个实例追加黑色单格描边。
      return
    }
    if (objectArt?.status === 'ready' && objectArt.img) {
      ctx.save()
      ctx.translate(X(o.x + o.w / 2), Y(o.y + o.h / 2))
      ctx.rotate((o.rotation ?? 0) * Math.PI / 180)
      ctx.scale(o.flipX ? -1 : 1, 1)
      ctx.drawImage(objectArt.img as CanvasImageSource, -o.w * cell / 2, -o.h * cell / 2, o.w * cell, o.h * cell)
      ctx.restore()
      ctx.strokeStyle = '#1A1A18'; ctx.lineWidth = 2; ctx.strokeRect(X(o.x), Y(o.y), o.w * cell, o.h * cell)
      return
    }
    if (o.kind === 'barrel') {
      ctx.fillStyle = typeDef?.color ?? '#A05C48'
      ctx.strokeStyle = '#1A1A18'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(X(o.x + 0.5), Y(o.y + 0.5), cell * 0.32, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
      ctx.fillStyle = '#1A1A18'
      ctx.fillRect(X(o.x + 0.42), Y(o.y + 0.25), cell * 0.16, cell * 0.5)
      return
    }
    // 废墟 / 岩石：矩形色块 + 粗黑描边（沿用原地形配色）
    ctx.fillStyle = typeDef?.color ?? (o.kind === 'ruins' ? '#5A564E' : '#7A7264')
    ctx.fillRect(X(o.x), Y(o.y), o.w * cell, o.h * cell)
    ctx.strokeStyle = '#1A1A18'
    ctx.lineWidth = 2
    ctx.strokeRect(X(o.x), Y(o.y), o.w * cell, o.h * cell)
    if (o.kind === 'ruins') {
      // 废墟纹理：斜线瓦砾
      ctx.strokeStyle = 'rgba(0,0,0,0.45)'
      ctx.lineWidth = 1.5
      for (let i = 0; i < o.w * 2; i++) {
        ctx.beginPath()
        ctx.moveTo(X(o.x) + i * cell * 0.5, Y(o.y + o.h))
        ctx.lineTo(X(o.x) + i * cell * 0.5 + cell * 0.5, Y(o.y))
        ctx.stroke()
      }
    } else {
      ctx.fillStyle = 'rgba(0,0,0,0.25)'
      ctx.beginPath()
      ctx.arc(X(o.x + o.w / 2), Y(o.y + o.h / 2), cell * 0.28, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  const drawRuntimeObjectShadow = (o: (typeof runtimeObjects)[number]) => {
    const typeDef = objectTypeById(o.defId)
    const objectArt = typeDef?.asset ? assetImage(typeDef.asset) : null
    const sheetKind = typeDef?.asset ? getAsset(typeDef.asset)?.tileSheet?.kind : undefined
    const height = typeDef?.height ?? 0
    const centerX = X(o.x + o.w / 2)
    const centerY = Y(o.y + o.h / 2)
    drawGroundEntityShadow(ctx, height, cell, centerX, centerY, 0, false, false, () => {
      if ((sheetKind === 'autotileStatic' || sheetKind === 'autotileAnimated') && objectArt?.status === 'ready' && objectArt.img) {
        const cells = runtimeObjectAutotiles.get(`${o.renderLayer ?? 3}:${o.defId ?? o.kind}`) ?? new Set([`${Math.floor(o.x)},${Math.floor(o.y)}`])
        const silhouette = tintedFx(objectArt.img, '#000000')
        const localX = (value: number) => X(value) - centerX
        const localY = (value: number) => Y(value) - centerY
        drawRmxpAutotileCell(ctx, silhouette ?? objectArt.img, cells, Math.floor(o.x), Math.floor(o.y), localX, localY, cell / 2, rmxpAnimationFrameX(objectArt.img))
        return
      }
      if (objectArt?.status === 'ready' && objectArt.img) {
        const silhouette = tintedFx(objectArt.img, '#000000')
        ctx.save()
        ctx.rotate((o.rotation ?? 0) * Math.PI / 180)
        ctx.scale(o.flipX ? -1 : 1, 1)
        ctx.drawImage(silhouette ?? objectArt.img, -o.w * cell / 2, -o.h * cell / 2, o.w * cell, o.h * cell)
        ctx.restore()
        return
      }
      ctx.fillStyle = '#000000'
      if (o.kind === 'barrel') {
        ctx.beginPath()
        ctx.arc(0, 0, cell * 0.32, 0, Math.PI * 2)
        ctx.fill()
      } else ctx.fillRect(-o.w * cell / 2, -o.h * cell / 2, o.w * cell, o.h * cell)
    })
  }

  // ---- 燃烧区域 ----
  for (const z of s.burnZones) {
    ctx.fillStyle = 'rgba(179,57,46,0.30)'
    ctx.beginPath()
    ctx.arc(X(z.x), Y(z.y), z.r * cell, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = 'rgba(217,164,65,0.5)'
    ctx.beginPath()
    ctx.arc(X(z.x), Y(z.y), z.r * cell * 0.5, 0, Math.PI * 2)
    ctx.fill()
  }

  // ---- 围墙段（九宫格连通渲染：相邻墙格共享边不描边，仅外轮廓描边） ----
  // ① 墙格集合：分类连通集（含 destroyed 缺口——闭环拓扑不因破洞产生悬空连接口，缺口两侧仍按闭环选块）；
  //    渲染集（不含缺口，缺口格画瓦砾）
  const tileCells = new Set<string>()
  const wallCells = new Set<string>()
  const baseCells = new Set<string>(LEVEL.buildCells) // 基地格集合：直墙朝向判定（朝外=非基地格）
  for (const w of s.walls) {
    if (ui.edit && w.fromLevel) continue // 编辑模式：LEVEL 墙由 draft 层接管
    for (const c of w.cells) {
      tileCells.add(`${c.x},${c.y}`)
      if (w.state !== 'destroyed') wallCells.add(`${c.x},${c.y}`)
    }
  }
  // ② 凹角缺口映射（内角缺口格 → 22 系贴图；含互斥规则③）——同时用于缺口连接扩展（阶梯转角衔接）
  const notchMap = new Map<string, { r: number; c: number }>()
  if (!ui.edit) {
    for (const k of LEVEL.buildCells) {
      const [bx, by] = k.split(',').map(Number)
      if (tileCells.has(k)) continue // 缺口格必须非墙段
      const t = notchTileAt(bx, by, tileCells, baseCells)
      if (t) notchMap.set(k, t)
    }
  }
  // ② 防御墙（九宫贴图：地面块垫底 + 墙体块叠加；图集未就绪退回灰底描边兜底）
  const wallAtlas = srcImage('/res/walls/wall01.png')
  const groundAtlas = srcImage('/res/walls/ground01.png')
  const tileOk = wallAtlas.status === 'ready' && groundAtlas.status === 'ready'
    && wallAtlas.img !== undefined && groundAtlas.img !== undefined
  for (const w of s.walls) {
    if (ui.edit && w.fromLevel) continue // 编辑模式：LEVEL 墙由 draft 层接管
    for (const c of w.cells) {
      const px = X(c.x)
      const py = Y(c.y)
      if (w.state === 'destroyed') {
        // 缺口：基地层 ground_top 已垫底，直接画瓦砾
        ctx.fillStyle = '#57534A'
        ctx.fillRect(px + cell * 0.15, py + cell * 0.55, cell * 0.7, cell * 0.35)
        ctx.fillStyle = '#46423A'
        ctx.fillRect(px + cell * 0.3, py + cell * 0.4, cell * 0.3, cell * 0.25)
        continue
      }
      const pick = classifyWallTile(c.x, c.y, tileCells, baseCells, notchMap) // 分类用连通集（含缺口）+ 缺口连接扩展（阶梯转角）
      if (tileOk) {
        if (pick.ground) { // 独立块（ground:null）不铺地面贴图，露出战场地面
          ctx.drawImage(groundAtlas.img as CanvasImageSource,
            (pick.ground.col - 1) * 32, (pick.ground.row - 1) * 32, 32, 32, px, py, cell, cell)
        }
        ctx.drawImage(wallAtlas.img as CanvasImageSource,
          (pick.wall.c - 1) * 32, (pick.wall.r - 1) * 32, 32, 32, px, py, cell, cell)
      } else { // 图集未就绪兜底：灰底描边
        ctx.fillStyle = w.state === 'damaged' ? '#7D7666' : '#9B9484'
        ctx.fillRect(px, py, cell, cell)
        ctx.strokeStyle = 'rgba(30,28,24,0.6)'
        ctx.lineWidth = 1
        ctx.strokeRect(px + 0.5, py + 0.5, cell - 1, cell - 1)
      }
      // 损伤裂纹（叠加于贴图之上）
      if (w.state === 'damaged') {
        ctx.strokeStyle = 'rgba(0,0,0,0.5)'
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.moveTo(px + cell * 0.2, py + cell * 0.15)
        ctx.lineTo(px + cell * 0.55, py + cell * 0.55)
        ctx.lineTo(px + cell * 0.35, py + cell * 0.9)
        ctx.stroke()
      }
    }
    // 段耐久条（画在段首格上方）
    if (w.state !== 'destroyed' && w.hp < w.maxHp) {
      const c = w.cells[Math.floor(w.cells.length / 2)]
      const ratio = w.hp / w.maxHp
      ctx.fillStyle = '#1A1A18'
      ctx.fillRect(X(c.x) - cell * 0.5, Y(c.y) - 5, cell * 2, 4)
      ctx.fillStyle = ratio < 0.35 ? '#B3392E' : '#D9A441'
      ctx.fillRect(X(c.x) - cell * 0.5, Y(c.y) - 5, cell * 2 * ratio, 4)
    }
  }

  // ---- 遗留独立核心 / 固有建筑：纳入统一对象绘制层，避免后绘制的单位阴影压在建筑主体之上。 ----
  const runtimeCore = !ui.edit && s.core && rectVisible(s.core.x, s.core.y, s.core.w, s.core.h) ? s.core : null
  const drawRuntimeCore = () => {
    if (!runtimeCore) return
    const core = runtimeCore
    ctx.fillStyle = core.hp > 0 ? core.color : '#4A4740'
    ctx.fillRect(X(core.x), Y(core.y), core.w * cell, core.h * cell)
    ctx.strokeStyle = '#1A1A18'
    ctx.lineWidth = 3
    ctx.strokeRect(X(core.x), Y(core.y), core.w * cell, core.h * cell)
    ctx.fillStyle = '#1A1A18'
    ctx.beginPath()
    ctx.arc(X(core.x + core.w / 2), Y(core.y + core.h / 2), Math.min(core.w, core.h) * cell * 0.2, 0, Math.PI * 2)
    ctx.fill()
    ctx.font = `bold ${Math.max(10, cell * 0.34)}px sans-serif`
    ctx.textAlign = 'center'
    ctx.fillText('核心', X(core.x + core.w / 2), Y(core.y + core.h) - 5)
    drawHpBar(ctx, X(core.x), Y(core.y) - 6, core.w * cell, core.hp / core.maxHp)
  }

  const runtimeBuildings = ui.edit ? [] : s.buildings.filter(building => rectVisible(building.x, building.y, building.w, building.h))
  const drawRuntimeBuilding = (b: (typeof runtimeBuildings)[number]) => {
    ctx.fillStyle = b.color
    ctx.fillRect(X(b.x), Y(b.y), b.w * cell, b.h * cell)
    ctx.strokeStyle = '#1A1A18'
    ctx.lineWidth = 2.5
    ctx.strokeRect(X(b.x), Y(b.y), b.w * cell, b.h * cell)
    ctx.fillStyle = 'rgba(0,0,0,0.55)'
    ctx.font = `bold ${Math.max(9, cell * 0.3)}px sans-serif`
    ctx.textAlign = 'center'
    ctx.fillText(b.name, X(b.x + b.w / 2), Y(b.y + b.h / 2) + 3)
    drawHpBar(ctx, X(b.x), Y(b.y) - 5, b.w * cell, b.hp / b.maxHp)
  }
  const drawRuntimeBuildingShadow = (building: { x: number; y: number; w: number; h: number; hp: number }, height: number) => {
    if (building.hp <= 0) return
    drawGroundEntityShadow(ctx, height, cell, X(building.x + building.w / 2), Y(building.y + building.h / 2), 0, false, false, () => {
      ctx.fillStyle = '#000000'
      ctx.fillRect(-building.w * cell / 2, -building.h * cell / 2, building.w * cell, building.h * cell)
    })
  }

  // ---- 履带印（v2.41：地面层最底——印距=瓦片有效步长，压暗瓦片压印，前 60% 恒定后渐隐）----
  const fd0 = fortressDef(s)
  const playerVehicleDamageFilter = vehicleDamageFilter(s.fortress.hp, s.fortress.maxHp)
  if (!ui.edit) {
    if (trackMarkTime >= 0 && s.time < trackMarkTime) {
      trackMarks.length = 0; trackMarkSt.acc = []; trackMarkSt.prevPhase = []; trackMarkSt.moving = []; trackMarkSt.stroke = []
      trackMarkChunks.clear()
    } // 重开清印
    trackMarkTime = s.time
    updateTrackMarks(trackMarks, trackMarkSt, s, fd0, tile => trackTileImage(tile)?.height ?? null, 'player')
    const liveVehicleIds = new Set<number>()
    const updateUnitMarks = (id: number, x: number, y: number, vehicle: NonNullable<Enemy['vehicle']>, fd: FortressDef) => {
      liveVehicleIds.add(id)
      let state = unitTrackMarkStates.get(id)
      if (!state) { state = { acc: [], prevPhase: [], moving: [] }; unitTrackMarkStates.set(id, state) }
      const projected: GameState = {
        ...s,
        reverse: vehicle.vx * dirX(vehicle.heading) + vehicle.vy * dirY(vehicle.heading) < 0,
        fortress: {
          ...s.fortress,
          x: x - fd.w / 2, y: y - fd.h / 2, heading: vehicle.heading,
          vx: vehicle.vx, vy: vehicle.vy, turnW: vehicle.turnW, steerAngle: vehicle.steerAngle,
          trackPhase: vehicle.trackPhase ?? [],
        },
      }
      updateTrackMarks(trackMarks, state, projected, fd, tile => trackTileImage(tile)?.height ?? null, `unit:${id}`)
    }
    for (const enemy of s.enemies) {
      const unit = runtimeEnemyUnitDef(enemy.unitDefId, enemy.kind)
      const platform = unit.legacy?.registry === 'fortress' ? unit.legacy.def : unit.vehiclePlatform
      if (enemy.hp > 0 && enemy.vehicle && platform && !unit.stats.air) updateUnitMarks(enemy.id, enemy.x, enemy.y, enemy.vehicle, platform)
    }
    for (const ally of s.allies) {
      const unit = runtimeAllyUnitDef(ally.unitDefId, ally.kind)
      const platform = unit.legacy?.registry === 'fortress' ? unit.legacy.def : unit.vehiclePlatform
      if (ally.hp > 0 && ally.vehicle && platform && !unit.stats.air) updateUnitMarks(ally.id, ally.x, ally.y, ally.vehicle, platform)
    }
    for (const id of unitTrackMarkStates.keys()) if (!liveVehicleIds.has(id)) unitTrackMarkStates.delete(id)
    // 履带板写入缓存后立即丢弃独立记录；数组只保留轮胎路径点，避免二次遍历和 600 条容量互相挤占。
    for (let i = trackMarks.length - 1; i >= 0; i--) if (trackMarks[i].kind !== 'wheel') {
      stampTrackMarkChunk(trackMarks[i])
      trackMarks.splice(i, 1)
    }
    const visibleTrackChunks = drawTrackMarkChunks(ctx, s.time, X, Y, cell, W, H)
    const visibleWheelSegments = drawWheelMarkPaths(ctx, trackMarks, s.time, X, Y, cell, W, H)
    if (typeof window !== 'undefined') {
      (window as unknown as { __tdTrackMarks?: { total: number; visible: number } }).__tdTrackMarks = { total: trackMarks.length, visible: visibleTrackChunks + visibleWheelSegments }
    }
    ctx.globalAlpha = 1
  }

  // ---- 地面粒子层（v2.40：尘土等——地形之上、载具及行走部件之下）----
  const groundParticlesClipped = beginBattleVisionClip()
  drawParticlePool(ctx, groundPool, X, Y, cell, nowFx)
  if (groundParticlesClipped) ctx.restore()

  // ---- 玩家载具（行走部件 + 单一载具素材；随 heading 旋转；编辑模式不画） ----
  const leanX = s.fortress.leanX
  const leanY = s.fortress.leanY
  const leanOn = !ui.edit && (leanX !== 0 || leanY !== 0)
  const drawPlayerShadow = () => {
    if (ui.edit || ui.interiorMode || s.fortress.dyingT >= 0) return
    const def = fortressDef(s)
    const rect = fortressRect(s)
    const px = X(rect.x + rect.w / 2)
    const py = Y(rect.y + rect.h / 2)
    const body = fortressSprite(def.spriteBody)
    const silhouette = body ? tintedFx(body, '#000000') : null
    const drawSilhouette = () => {
      if (body && silhouette) drawVehicleImage(ctx, body, def, cell / BASE_CELL, s.fortress.walkPhase ?? 0, silhouette, s.fortress.walkSettleBlend ?? 0)
      else {
        ctx.fillStyle = '#000000'
        ctx.fillRect(-def.w * cell / 2, -def.h * cell / 2, def.w * cell, def.h * cell)
      }
      drawMountedTurretShadowSilhouettes(ctx, def, s.turrets, s.fortress.heading, cell)
    }
    const airborne = def.platformType === 'rotorcraft' || def.platformType === 'fixedWingAircraft'
    if (airborne) {
      const unit = unitDefById(def.unitId ?? fortressUnitId(def.id))
      if (unit) drawAirUnitShadow(ctx, unit, Math.max(0, def.altitude ?? 0), cell, px, py, s.fortress.heading, false, drawSilhouette)
      else drawGroundEntityShadow(ctx, 3, cell, px, py, s.fortress.heading, false, false, drawSilhouette)
    } else drawGroundEntityShadow(ctx, 0, cell, px, py, s.fortress.heading, false, false, drawSilhouette)
  }
  const drawPlayerUnit = () => {
  // 炮塔仍按尺寸与炮位层级稳定排序；其中层级 <= -1 的挂载炮塔会插入到行走部件与载具主体之间。
  const zSorted = [...s.turrets].sort((a, b) => {
    const ka = turretRenderKey(s, a)
    const kb = turretRenderKey(s, b)
    return ka[0] - kb[0] || ka[1] - kb[1]
  })
  if (typeof window !== 'undefined') { // 观测探针：完整排序，靠后=同一绘制批次内更上层
    (window as unknown as { __tdZ?: number[] }).__tdZ = zSorted.map(t => t.id)
  }
  const playerDestroyed = s.fortress.dyingT >= 0
  let leanN = 0
  const underVehicleBody = (turret: Turret) => turret.hardpointId != null && hardpointBelowVehicleBody(hardpointOf(s, turret.hardpointId))
  const drawPlayerTurret = (turret: Turret) => {
    const lean = leanOn && turret.hardpointId != null
    const damagedMountedTurret = turret.hardpointId != null && playerVehicleDamageFilter !== 'none'
    if (lean || damagedMountedTurret) {
      ctx.save()
      if (damagedMountedTurret) ctx.filter = playerVehicleDamageFilter
      if (lean) { ctx.translate(leanX, leanY); leanN++ }
    }
    drawTurret(ctx, turret, v, ui.selectedTurret === turret.id, s.muzzles,
      turret.hardpointId ? s.fortress.heading : 0,
      turret.hardpointId ? hardpointOf(s, turret.hardpointId) : undefined, zf,
      turret.hardpointId ? fortressDef(s).paint?.turret : undefined)
    if (lean || damagedMountedTurret) ctx.restore()
  }
  if (!ui.edit) {
    const fd = fortressDef(s)
    const fr = fortressRect(s)
    const fw = fr.w * cell
    const fh = fr.h * cell
    const localCenter = fortressLocalCenter(fd)
    ctx.save()
    ctx.filter = playerVehicleDamageFilter
    ctx.translate(X(fr.x + fr.w / 2), Y(fr.y + fr.h / 2))
    ctx.rotate(s.fortress.heading)
    const fx = -localCenter.x * cell
    const fy = -localCenter.y * cell
    if (!ui.interiorMode) {
    // 履带层（v1.85/v1.86）：瓦片循环滚动，载具素材之下；随车体旋转（本上下文已 rotate(heading)）；
    // 不随俯仰 lean（悬挂拟真：履带贴地不动，只有车壳倾）；仅视觉
    // 定义只存左履带，右侧围绕单位几何原点 x=0 镜像（相位独立）；瓦片原图直绘不旋转。
    if (fd.tracks && fd.tracks.length > 0) {
      let trackDrawn = 0
      let lastPh88 = 0 // v1.88：探针用——本帧最后渲染的履带相位
      ctx.imageSmoothingEnabled = false
      const zmT = cell / BASE_CELL // 美术基准 32px=1 格：原尺寸 = 图像素 × zm
      for (let i = 0; i < fd.tracks.length; i++) {
        const t = fd.tracks[i]
        const tileImg = trackTileImage(t.tile)
        if (!tileImg) continue
        const wpx = tileImg.width * zmT // v1.87：宽度 = 图宽原尺寸（不再缩放）
        const tileLenC = tileImg.height / BASE_CELL // 板长 = 图高原尺寸（格）
        const lpx = tileLenC * cell
        for (const mirror of [false, true]) { // 左 → 右（镜像）
          const ph = s.fortress.trackPhase[i * 2 + (mirror ? 1 : 0)] ?? 0
          lastPh88 = ph
          for (const pl of centeredTrackPlacements(fd, t, ph, tileLenC)) {
            const lh = lpx * pl.scaleY
            if (lh < 0.3) continue
            const px85 = mirror ? -pl.x : pl.x
            ctx.save()
            ctx.globalAlpha = pl.alpha
            ctx.translate(px85 * cell, -pl.y * cell)
            if (mirror) ctx.scale(-1, 1)
            ctx.drawImage(tileImg, -wpx / 2, -lh / 2, wpx, lh)
            ctx.restore()
            trackDrawn++
          }
        }
      }
      ctx.globalAlpha = 1
      if (typeof window !== 'undefined') { const w88 = window as unknown as { __tdTrack?: number; __tdTrackPhase?: number; __tdFrame?: number }; w88.__tdTrack = trackDrawn; w88.__tdTrackPhase = lastPh88; w88.__tdFrame = (w88.__tdFrame ?? 0) + 1 } // 无头探针：本帧履带瓦片绘制数 + 最后渲染相位（v1.88）
    }
    // 轮胎层：与履带同层级、不随俯仰 lean；横向帧条按真实位移滚动；pair 按中心线展开左右两轮。
    if (fd.wheels && fd.wheels.length > 0) {
      const visualSteer = wheelVisualSteerAngle(s, fd)
      let wheelPhaseIndex = (fd.tracks?.length ?? 0) * 2
      for (const wd of fd.wheels) {
        const img51 = wd.sprite ? trackTileImage(wd.sprite) : null
        const placements = wheelPlacements(fd, wd)
        if (wd.sprite && !img51) { wheelPhaseIndex += placements.length; continue } // 配了贴图但未加载：跳过（与履带瓦片同口径）
        const frames = wheelFrameCount(wd)
        const zmW = cell / BASE_CELL
        const sourceW = img51 ? img51.width / frames : 11
        const ww = sourceW * zmW
        const hw = (img51?.height ?? 20) * zmW
        for (const p of placements) {
          const phase = s.fortress.trackPhase[wheelPhaseIndex++] ?? 0
          ctx.save()
          ctx.translate(p.x * cell, -p.y * cell)
          ctx.rotate(wd.steered ? visualSteer : 0)
          if (p.mirror) ctx.scale(-1, 1)
          if (img51) {
            const frame = wheelRollFrame(phase, frames, img51.height)
            ctx.drawImage(img51, frame * sourceW, 0, sourceW, img51.height, -ww / 2, -hw / 2, ww, hw)
          } else { // 遗留无贴图配置：固定 11×20 基准像素几何回退，不再读取旧轮径
            ctx.fillStyle = '#2A2A28'
            ctx.strokeStyle = '#1A1A18'
            ctx.lineWidth = 1.5
            ctx.beginPath(); ctx.roundRect(-ww / 2, -hw / 2, ww, hw, ww * 0.35); ctx.fill(); ctx.stroke()
            ctx.strokeStyle = '#8C8878'
            ctx.lineWidth = 1
            ctx.beginPath(); ctx.moveTo(0, -hw * 0.28); ctx.lineTo(0, hw * 0.28); ctx.stroke()
          }
          ctx.restore()
        }
      }
    }
    }
    // 先结束行走部件的车体局部坐标，再以标准世界坐标绘制负层级炮塔。
    // 随后重新进入车体局部坐标绘制主体，因此载具素材会自然覆盖这些炮塔。
    ctx.restore()
    if (!ui.interiorMode && !playerDestroyed) {
      for (const turret of zSorted) if (underVehicleBody(turret)) drawPlayerTurret(turret)
    }
    ctx.save()
    ctx.filter = playerVehicleDamageFilter
    ctx.translate(X(fr.x + fr.w / 2), Y(fr.y + fr.h / 2))
    ctx.rotate(s.fortress.heading)
    if (ui.interiorMode) {
      // 内部模块层：独立虚拟网格以单位几何中心居中，不再依附底盘/主体的外部占格。
      const ix = -fd.interior.cols * cell / 2
      const iy = -fd.interior.rows * cell / 2
      const iSet = fortressInteriorSet(fd)
      for (const k of iSet) {
        const [cx, cy] = k.split(',').map(Number)
        ctx.fillStyle = 'rgba(20,22,20,0.55)'
        ctx.fillRect(ix + cx * cell, iy + cy * cell, cell, cell)
        ctx.strokeStyle = 'rgba(200,181,104,0.35)'
        ctx.lineWidth = 1
        ctx.strokeRect(ix + cx * cell, iy + cy * cell, cell, cell)
      }
      // 特殊格高亮：置于其上的模块对应属性 ×1.5（类别色 + 首字标记）
      const BOOST_COLOR: Record<string, string> = {
        energy: '#D8B84A', ammo: '#B5793A', cooling: '#5FA8A0', repair: '#7EA06E', range: '#8A7FC0',
        produce: '#B58AB0', hp: '#A86A5A', speed: '#6A90B8', turn: '#B8A86A',
      }
      for (const c of fd.interiorSpecials ?? []) {
        if (!iSet.has(`${c.x},${c.y}`)) continue
        const col = BOOST_COLOR[c.boost] ?? '#C8B568'
        ctx.fillStyle = col + '55'
        ctx.fillRect(ix + c.x * cell + 1, iy + c.y * cell + 1, cell - 2, cell - 2)
        ctx.strokeStyle = col
        ctx.lineWidth = 2
        ctx.strokeRect(ix + c.x * cell + 1, iy + c.y * cell + 1, cell - 2, cell - 2)
        ctx.fillStyle = col
        ctx.font = `bold ${Math.max(7, cell * 0.24)}px sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(SPECIAL_BOOST_NAME[c.boost][0], ix + (c.x + 0.5) * cell, iy + (c.y + 0.5) * cell)
        ctx.textBaseline = 'alphabetic'
      }
      for (const m of s.modules) {
        const md = MODULE_DEFS.find(d => d.id === m.defId)
        if (!md) continue
        const foot = moduleFoot(md, m.rot)
        const mCells = moduleCells(md, m.rot) // v2.31 逐格渲染（异型模块空洞不绘制）
        const mImg30 = md.asset ? trackTileImage(md.asset) : null // v2.30 模块贴图（素材库「模块」分类锚定；缺省色块回退）
        if (mImg30) {
          for (const c of mCells) { // 贴图按格源矩形裁切（旋转后格 c 对应未旋转图源格：rot=1 逆映射 (x,y)→(y, w-1-x)）
            const sc = m.rot === 1 ? { x: c.y, y: md.h - 1 - c.x } : c
            ctx.drawImage(
              mImg30,
              (sc.x * mImg30.width) / md.w, (sc.y * mImg30.height) / md.h, mImg30.width / md.w, mImg30.height / md.h,
              ix + (m.x + c.x) * cell + 1.5, iy + (m.y + c.y) * cell + 1.5, cell - 3, cell - 3,
            )
          }
        } else {
          ctx.fillStyle = md.color
          for (const c of mCells) ctx.fillRect(ix + (m.x + c.x) * cell + 1.5, iy + (m.y + c.y) * cell + 1.5, cell - 3, cell - 3)
        }
        ctx.strokeStyle = '#1A1A18'
        ctx.lineWidth = 1.5
        for (const c of mCells) ctx.strokeRect(ix + (m.x + c.x) * cell + 1.5, iy + (m.y + c.y) * cell + 1.5, cell - 3, cell - 3)
        ctx.fillStyle = '#141614'
        ctx.font = `${Math.max(7, cell * 0.2)}px sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(md.name, ix + (m.x + foot.w / 2) * cell, iy + (m.y + foot.h / 2) * cell)
        ctx.textBaseline = 'alphabetic'
      }
      if (ui.interiorGhost) {
        const g = ui.interiorGhost
        ctx.fillStyle = g.ok ? 'rgba(126,160,110,0.5)' : 'rgba(178,74,63,0.5)'
        ctx.strokeStyle = g.ok ? '#2E5B2E' : '#7A2E2A'
        ctx.lineWidth = 2
        if (g.cells) { // v2.31 异型逐格幽灵
          for (const c of g.cells) {
            ctx.fillRect(ix + (g.x + c.x) * cell, iy + (g.y + c.y) * cell, cell, cell)
            ctx.strokeRect(ix + (g.x + c.x) * cell, iy + (g.y + c.y) * cell, cell, cell)
          }
        } else {
          ctx.fillRect(ix + g.x * cell, iy + g.y * cell, g.w * cell, g.h * cell)
          ctx.strokeRect(ix + g.x * cell, iy + g.y * cell, g.w * cell, g.h * cell)
        }
      }
    } else {
      // 载具层：单一载具贴图 + 徽记 + 可见炮位
      // 刹停惯性前倾：世界系位移 → 船体系（上下文已 rotate(heading)，逆旋转换算）
      const lh = s.fortress.heading
      const lx = s.fortress.leanX * Math.cos(lh) + s.fortress.leanY * Math.sin(lh)
      const ly = -s.fortress.leanX * Math.sin(lh) + s.fortress.leanY * Math.cos(lh)
      ctx.save()
      ctx.translate(lx, ly)
      if (fd.platformType === 'rotorcraft') drawRotors(ctx, fd.rotors, 'below', cell, s.time)
      const bodyImg = fortressSprite(fd.spriteBody)
      if (bodyImg) {
        // 载具贴图：原比例显示（不缩放），并把 alpha 缓存给敌方弹丸载具命中检测。
        if (fd.spriteBody) registerFortressBodyImage(fd.spriteBody, bodyImg, fd.chassis === 'walker' ? WALKER_COLUMNS : 1, fd.chassis === 'walker' ? WALKER_ROWS : 1)
      }
      drawVehicleBodyLayer(ctx, fd, bodyImg, v.cell / BASE_CELL, cell, 1, s.fortress.walkPhase ?? 0, s.fortress.walkSettleBlend ?? 0)
      // 结构阶段损伤与命中点贴花：载具贴图之上、炮塔挂点之下；贴图 alpha 严格隔离履带/轮胎。
      const bodyDamageStage = UNIT_BODY_DAMAGE_VISUALS_ENABLED ? fortressDamageStage(s.fortress.hp, s.fortress.maxHp) : 0
      drawFortressDamageOverlay(ctx, s, fd, bodyImg, fx, fy, fw, fh, cell, bodyDamageStage)
      if (typeof window !== 'undefined') {
        (window as unknown as { __tdDamage?: { marks: number; stage: number; flash: number } }).__tdDamage = {
          marks: s.fortress.damageMarks.length, stage: bodyDamageStage, flash: s.fortress.hitFlash,
        }
      }
      if (fd.platformType === 'rotorcraft') drawRotors(ctx, fd.rotors, 'above', cell, s.time)
      ctx.restore()
      // 炮位圈与视界弧属于编辑/选择提示，不随整车结构值变暗。
      ctx.filter = 'none'
      // 炮位（S/M/L 标记；隐藏炮塔素材仍保留可装配炮位；挂炮模式高亮匹配位；视界弧线）
      let hpDrawn = 0 // v1.75：本帧绘制的槽位圈数（观测探针）
      let arcDrawn = 0 // v1.80：本帧绘制的视界弧数（观测探针）
      // v1.80：视界弧仅 ①打开炮塔安装界面（卡片栏/挂炮模式，显示全部炮位）或 ②选中炮塔（仅其挂载炮位）时显示
      const showAllArcs = !!(ui.turretPanel || ui.mountDefId)
      const selTurretHp = ui.selectedTurret != null ? s.turrets.find(t => t.id === ui.selectedTurret)?.hardpointId : undefined
      for (const hp of fd.hardpoints) {
        const hx = fx + hp.x * cell
        const hy = fy + hp.y * cell
        const r = cell * (hp.size === 'L' ? 0.34 : hp.size === 'M' ? 0.28 : 0.22)
        const occupied = s.turrets.some(t => t.hardpointId === hp.id)
        const mountDef = ui.mountDefId ? TURRET_DEFS.find(d => d.id === ui.mountDefId) : null
        const match = mountDef != null && !occupied && mountDef.mount === hp.size && (!hp.types || hp.types.includes(mountDef.type))
        // 视界弧（相对船头 start→end 顺时针；画布角度 0=+X 轴，需 -90° 换算）
        if (hp.arc && (showAllArcs || (selTurretHp != null && selTurretHp === hp.id))) {
          arcDrawn++
          const a0 = (hp.arc.start - 90) * Math.PI / 180
          const a1 = (hp.arc.end - 90) * Math.PI / 180
          ctx.beginPath()
          ctx.moveTo(hx, hy)
          ctx.arc(hx, hy, cell * 1.1, a0, a1, false)
          ctx.closePath()
          ctx.fillStyle = match ? 'rgba(126,160,110,0.18)' : 'rgba(200,181,104,0.12)'
          ctx.fill()
        }
        // v1.75：槽位圆圈和字母仅在按下「炮塔」按钮（卡片栏展开/挂炮模式）时显示；v1.80：视界弧亦改为门控（见上）
        if (ui.turretPanel || ui.mountDefId) {
          ctx.beginPath()
          ctx.arc(hx, hy, r, 0, Math.PI * 2)
          ctx.fillStyle = occupied ? 'rgba(26,26,24,0.55)' : match ? 'rgba(126,160,110,0.85)' : 'rgba(200,181,104,0.5)'
          ctx.fill()
          ctx.strokeStyle = match ? '#2E5B2E' : '#1A1A18'
          ctx.lineWidth = match ? 3 : 1.5
          ctx.stroke()
          if (!occupied) {
            ctx.fillStyle = '#1A1A18'
            ctx.font = `bold ${Math.max(8, cell * 0.26)}px sans-serif`
            ctx.textAlign = 'center'
            ctx.textBaseline = 'middle'
            ctx.fillText(hp.size, hx, hy)
            ctx.textBaseline = 'alphabetic'
          }
          hpDrawn++
        }
      }
      if (typeof window !== 'undefined') { // v1.75/v1.80 观测探针：本帧槽位圈绘制数 + 视界弧绘制数
        (window as unknown as { __tdHp?: { drawn: number; arcs: number } }).__tdHp = { drawn: hpDrawn, arcs: arcDrawn }
      }
    }
    ctx.restore()
    // 船体耐久条（屏幕空间，不随船体旋转）
    if (gameParameters().showUnitHealthBars) drawHpBar(ctx, X(fr.x), Y(fr.y) - 6, fw, s.fortress.hp / s.fortress.maxHp)
  }

  // ---- 炮塔（编辑模式：LEVEL 初始炮塔由 draft 层接管） ----
  // v1.73：俯仰偏移随主体——挂载炮塔整体随车体前倾平移（画布像素位移，与主体精灵层同帧一致；地面/LEVEL 炮塔与编辑模式不受影响）
  for (const t of zSorted) {
    if (playerDestroyed) break
    if (ui.edit && t.fromLevel) continue
    if (ui.interiorMode) continue // v1.53：内部空间不显示已安装炮塔贴图
    if (!ui.edit && underVehicleBody(t)) continue // 已在载具主体之前绘制
    drawPlayerTurret(t)
  }
  // v1.73 观测探针：跟随俯仰的炮塔数与位移峰值（ever 为会话峰值，松手归位后不清零，供测试读取）
  if (typeof window !== 'undefined') {
    const w = window as unknown as { __tdLean?: { n: number; max: number; ever: number } }
    const prev = w.__tdLean ?? { n: 0, max: 0, ever: 0 }
    const mag = leanN > 0 ? Math.hypot(leanX, leanY) : 0
    w.__tdLean = { n: leanN, max: mag, ever: Math.max(prev.ever, mag) }
  }
  }

  // ---- 贴身载具护盾：底盘体系 Alpha 轮廓 + 程序命中扩散 / 电弧 / 破盾碎片；炮塔不参与轮廓 ----
  const drawPlayerShield = () => {
  if (!ui.edit && !ui.interiorMode && s.fortress.dyingT < 0) {
    const fr = fortressRect(s)
    const silhouette = vehicleShieldSilhouette(fortressDef(s))
    const activeHits = s.shieldHits.filter(hit => hit.unitId === undefined)
    const visible = s.fortress.maxShield > 0 && (s.fortress.shield > 0 || activeHits.length > 0)
    if (typeof window !== 'undefined') {
      (window as unknown as { __tdShieldSilhouette?: null | { edges: number; anchors: number; width: number; height: number; visible: boolean } }).__tdShieldSilhouette = silhouette ? {
        edges: silhouette.edgeSamples.length,
        anchors: silhouette.interiorSamples.length,
        width: silhouette.maxX - silhouette.minX,
        height: silhouette.maxY - silhouette.minY,
        visible,
      } : null
    }
    const tileImg = activeHits.length > 0 ? trackTileImage('/res/fx/shield_hex_tile_32_v1.png') : null
    const tileTint = tileImg ? tintedFx(tileImg, '#76C8D2') : null
    const fieldImg = visible ? trackTileImage('/res/fx/shield_field_inner_128_v1.png') : null
    const edgeImg = visible ? trackTileImage('/res/fx/shield_edge_glow_64_v1.png') : null
    const fieldTint = fieldImg ? tintedFx(fieldImg, '#6DBCC8') : null
    const edgeTint = edgeImg ? tintedFx(edgeImg, '#B7F4F7') : null
    if (visible && silhouette) {
      const ratio = s.fortress.maxShield > 0 ? Math.max(0, Math.min(1, s.fortress.shield / s.fortress.maxShield)) : 0
      const tileSize = Math.max(13, BASE_CELL * 0.72)
      const tiles = tileTint ? shieldSilhouetteHexLayout(silhouette, tileSize) : []
      const co = Math.cos(s.fortress.heading), si = Math.sin(s.fortress.heading)
      const localHits = activeHits.map(hit => {
        const dx = (hit.x - (fr.x + fr.w / 2)) * BASE_CELL
        const dy = (hit.y - (fr.y + fr.h / 2)) * BASE_CELL
        return { hit, x: dx * co + dy * si, y: -dx * si + dy * co }
      })
      let wholeBreakFlash = 0
      let breakFieldFade = 0
      for (const h of localHits) {
        if (!h.hit.broken) continue
        const progress = 1 - h.hit.ttl / h.hit.max
        wholeBreakFlash = Math.max(wholeBreakFlash, shieldBreakEnvelope(progress))
        breakFieldFade = Math.max(breakFieldFade, shieldBreakFieldFade(h.hit.max - h.hit.ttl))
      }
      const unfoldElapsed = shieldUnfoldStartedAt >= 0 ? s.time - shieldUnfoldStartedAt : 1
      const unfolding = unfoldElapsed >= 0 && unfoldElapsed < 0.82
      const unfoldPhase = unfolding ? unfoldElapsed / 0.82 : 1
      const unfold = shieldUnfoldProgress(unfoldPhase)
      const unfoldScale = shieldUnfoldScale(unfoldPhase)
      if (!unfolding && shieldUnfoldStartedAt >= 0) shieldUnfoldStartedAt = -1
      const unfoldAlpha = unfolding ? 0.06 + unfold * 0.94 : 1
      const unfoldEdgeBoost = 1 + (unfolding ? Math.sin(unfoldPhase * Math.PI) * 0.7 : 0)
      const edgePulse = shieldEdgePulse(s.time)
      ctx.save()
      ctx.translate(X(fr.x + fr.w / 2), Y(fr.y + fr.h / 2))
      ctx.rotate(s.fortress.heading)
      ctx.scale(zf * unfoldScale, zf * unfoldScale)
      // 常态由两张灰度素材动态染色：淡内部场体 + 沿轮廓重复的径向柔光。
      ctx.globalCompositeOperation = 'source-over'
      ctx.globalAlpha = 1
      const fieldBaseAlpha = s.fortress.shield > 0 ? (0.022 + ratio * 0.016) * unfoldAlpha : breakFieldFade * 0.026
      // 破盾后使用普通透明混合短暂淡出，避免硬切，也避免加法闪光把底盘照成亮色块。
      ctx.fillStyle = `rgba(76, 190, 207, ${fieldBaseAlpha})`
      ctx.fill(silhouette.path)
      if (edgeTint && (s.fortress.shield > 0 || breakFieldFade > 0)) {
        ctx.globalCompositeOperation = 'lighter'
        const stableEdgeAlpha = s.fortress.shield > 0 ? (0.06 + ratio * 0.055) * unfoldAlpha * unfoldEdgeBoost : 0
        const glowSize = Math.max(10, BASE_CELL * 0.56) * edgePulse.width
        const edgeSamples = silhouette.edgeSamples
        const breakSources = localHits.filter(h => h.hit.broken)
        const segmentAlpha = (index: number) => breakSources.reduce((best, source) => {
          const delayRatio = eventRandom(source.hit.id + index * 43, 11)
          return Math.max(best, shieldBreakSegmentAlpha(source.hit.max - source.hit.ttl, delayRatio))
        }, 0)
        // 初版沿边波动：只对原有柔光采样点做轻微亮度调制，不叠加独立高亮光带或描线。
        for (let i = 0; i < edgeSamples.length; i++) {
          const p = edgeSamples[i]
          const flowGain = s.fortress.shield > 0 ? shieldEdgeFlowGain(s.time, p.progress) : 1
          const brokenAlpha = s.fortress.shield > 0 ? 0 : segmentAlpha(i) * (0.045 + wholeBreakFlash * 0.1)
          ctx.globalAlpha = Math.min(0.58, stableEdgeAlpha * edgePulse.alpha * flowGain + brokenAlpha)
          ctx.drawImage(edgeTint, p.x - glowSize / 2, p.y - glowSize / 2, glowSize, glowSize)
        }
        // 整体同时失稳，仅用极短随机错峰打散机械感；不再从命中点沿轮廓传播。
        if (s.fortress.shield <= 0 && edgeSamples.length > 1) {
          ctx.globalCompositeOperation = 'source-over'
          ctx.lineCap = 'round'
          ctx.lineWidth = Math.max(0.7, BASE_CELL * (0.026 + wholeBreakFlash * 0.025))
          for (let i = 0; i < edgeSamples.length; i++) {
            const p = edgeSamples[i]
            ctx.globalAlpha = segmentAlpha(i) * (0.22 + wholeBreakFlash * 0.18)
            if (ctx.globalAlpha <= 0.005) continue
            ctx.strokeStyle = 'rgb(225, 255, 255)'
            ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.nextX, p.nextY); ctx.stroke()
          }
        }
      }
      ctx.globalCompositeOperation = 'source-over'
      if (s.fortress.shield > 0) {
        ctx.globalAlpha = unfoldAlpha
        const stableStrokeAlpha = 0.34 + ratio * 0.12
        ctx.strokeStyle = `rgba(225, 255, 255, ${Math.min(0.92, stableStrokeAlpha * edgePulse.alpha)})`
        ctx.lineJoin = 'round'
        ctx.lineWidth = Math.max(0.7, BASE_CELL * 0.026 * edgePulse.width)
        ctx.stroke(silhouette.path)
      }
      ctx.clip(silhouette.path)
      if (fieldTint && (s.fortress.shield > 0 || breakFieldFade > 0)) {
        ctx.globalCompositeOperation = s.fortress.shield > 0 ? 'lighter' : 'source-over'
        const stableFieldAlpha = s.fortress.shield > 0 ? (0.16 + ratio * 0.08) * unfoldAlpha : breakFieldFade * 0.085
        const motion = shieldFieldMotion(s.time, silhouette.halfW, silhouette.halfH)
        const collapseScale = s.fortress.shield > 0 ? 1 : 0.92 + breakFieldFade * 0.08
        ctx.save()
        ctx.translate(silhouette.centerX, silhouette.centerY)
        ctx.scale(collapseScale, collapseScale)
        ctx.translate(motion.x1, motion.y1); ctx.rotate(motion.r1)
        ctx.globalAlpha = Math.min(0.58, stableFieldAlpha * motion.a1)
        ctx.drawImage(fieldTint, -silhouette.halfW * 1.13, -silhouette.halfH * 1.13, silhouette.halfW * 2.26, silhouette.halfH * 2.26)
        ctx.restore()
        ctx.save()
        ctx.translate(silhouette.centerX, silhouette.centerY)
        ctx.scale(collapseScale, collapseScale)
        ctx.translate(motion.x2, motion.y2); ctx.rotate(Math.PI + motion.r2)
        ctx.globalAlpha = Math.min(0.48, stableFieldAlpha * motion.a2)
        ctx.drawImage(fieldTint, -silhouette.halfW * 1.12, -silhouette.halfH * 1.12, silhouette.halfW * 2.24, silhouette.halfH * 2.24)
        ctx.restore()
      }
      ctx.globalCompositeOperation = 'lighter'
      for (const tile of tiles) {
        if (!tileTint) continue
        let hitLight = 0
        let breakFlash = 0
        for (const h of localHits) {
          const progress = 1 - h.hit.ttl / h.hit.max
          const ring = Math.max(0, Math.round(Math.hypot(tile.x - h.x, tile.y - h.y) / (tileSize * 0.68)))
          hitLight = Math.max(hitLight, shieldHexRipple(progress, ring, h.hit.broken))
          // 破盾同样只显现三层衰减波纹；整盾瓦解由电弧和碎片承担，避免六边形全屏常亮。
          if (h.hit.broken && ring <= 2) {
            const ringAttenuation = [1, 0.62, 0.34][ring]
            breakFlash = Math.max(breakFlash, Math.max(0, 1 - progress * 1.4) * 0.22 * ringAttenuation)
          }
        }
        ctx.globalAlpha = tile.edge * Math.min(0.92, hitLight * 0.82 + breakFlash)
        if (ctx.globalAlpha <= 0.005) continue
        const dw = tileSize * tile.squashX, dh = tileSize * tile.squashY
        ctx.drawImage(tileTint, tile.x - dw / 2, tile.y - dh / 2, dw, dh)
      }
      ctx.restore()
    }
    for (const hit of activeHits) {
      const firstSeen = !fxSeen.has(hit.id)
      const elapsed = fxElapsed(hit)
      if (firstSeen) {
        spawnBurst(fxPool, { x: hit.x, y: hit.y, count: hit.broken ? 7 : 3, speed: hit.broken ? 2.8 : 1.8, life: 0.24, size: 0.035, color: '#B9F4F7', drag: 5, seed: hit.id, streak: true })
      }
      if (hit.broken) {
        // 整个贴身场体共同崩碎：碎片锚点来自底盘体系 Alpha 轮廓内部，炮塔不参与。
        if (!silhouette) continue
        const hwWorld = silhouette.halfW / BASE_CELL, hhWorld = silhouette.halfH / BASE_CELL
        const co = Math.cos(s.fortress.heading), si = Math.sin(s.fortress.heading)
        const cx = fr.x + fr.w / 2, cy = fr.y + fr.h / 2
        const anchors = silhouette.interiorSamples
          .map((p, index) => ({ p, index }))
        const emitted = shieldBreakEmitted.get(hit.id) ?? new Set<number>()
        shieldBreakEmitted.set(hit.id, emitted)
        const shardSize = shieldShardSize(hwWorld, hhWorld)
        for (let rank = 0; rank < anchors.length; rank++) {
          const anchor = anchors[rank]
          const delay = eventRandom(hit.id + anchor.index * 31, 12) * 0.12
          if (elapsed < delay || emitted.has(anchor.index)) continue
          emitted.add(anchor.index)
          // 确定性跳过 60% 锚点：主碎片总量为完整采样方案的约五分之二。
          if (eventRandom(hit.id + anchor.index * 47, 13) < 0.6) continue
          const p = anchor.p
          const localX = p.x / BASE_CELL, localY = p.y / BASE_CELL
          const x = cx + localX * co - localY * si, y = cy + localX * si + localY * co
          const nx0 = (p.x - silhouette.centerX) / Math.max(0.001, silhouette.halfW)
          const ny0 = (p.y - silhouette.centerY) / Math.max(0.001, silhouette.halfH)
          const nl0 = Math.hypot(nx0, ny0)
          const fallbackAngle = eventRandom(hit.id + anchor.index * 23, 4) * Math.PI * 2
          const nx = nl0 > 0.05 ? nx0 / nl0 : Math.cos(fallbackAngle)
          const ny = nl0 > 0.05 ? ny0 / nl0 : Math.sin(fallbackAngle)
          const tangentSign = eventRandom(hit.id + anchor.index * 17, 5) < 0.5 ? -1 : 1
          const tx = -ny * tangentSign, ty = nx * tangentSign
          const dl = Math.max(0.001, Math.hypot(nx * 0.5 + tx * 0.86, ny * 0.5 + ty * 0.86))
          const dirLocalX = (nx * 0.5 + tx * 0.86) / dl, dirLocalY = (ny * 0.5 + ty * 0.86) / dl
          const dirX = dirLocalX * co - dirLocalY * si, dirY = dirLocalX * si + dirLocalY * co
          const count = eventRandom(hit.id + anchor.index * 29, 6) < 0.28 ? 3 : 2
          spawnBurst(fxPool, { x, y, count, speed: 3.5, life: 1.05, size: shardSize, color: '#83D6DF', drag: 1.7, seed: hit.id + 900 + anchor.index * 37, grow: -0.08, shape: 'shieldShard', speedJitter: 0.68, lifeJitter: 0.44, sizeJitter: 0.42, dirX, dirY, bias: 0.76 })
          // 冰晶按每片主碎片 45% 的确定性概率生成；高速起步后受强阻力快速变慢，约 1s 淡出。
          let crystalCount = 0
          for (let crystalIndex = 0; crystalIndex < count; crystalIndex++) {
            if (eventRandom(hit.id + anchor.index * 59 + crystalIndex * 17, 14) < 0.45) crystalCount++
          }
          if (crystalCount > 0) spawnBurst(fxPool, { x, y, count: crystalCount, speed: 5.4, life: 1, size: shardSize * 0.24, color: '#DFFFFF', drag: 6.5, seed: hit.id + 2300 + anchor.index * 41, grow: -0.05, shape: 'shieldCrystal', speedJitter: 0.55, lifeJitter: 0.18, sizeJitter: 0.38, dirX, dirY, bias: 0.62 })
          if (rank % 4 === 0) spawnBurst(fxPool, { x, y, count: 1, speed: 2.4, life: 0.32, size: 0.026, color: '#C8FAFF', drag: 4.2, seed: hit.id + 1700 + anchor.index * 13, streak: true, dirX, dirY, bias: 0.58 })
        }
      }
    }
  }
  }

  // ---- 阵营无关的单位受击火花：玩家载具、友军、敌军共用；首见一次性发射。 ----
  for (const hit of s.unitHits) {
    const firstSeen = !fxSeen.has(hit.id)
    const hitVisualY = hit.y - (hit.altitude ?? 0)
    fxElapsed(hit)
    if (firstSeen && !hit.ricochet) {
      spawnBurst(fxPool, {
        x: hit.x, y: hitVisualY, count: hit.penetrated ? 7 : 4, speed: hit.penetrated ? 3.3 : 2.2,
        life: 0.24, size: 0.038, color: hit.penetrated ? '#F2B45F' : '#D6C39A', drag: 5.5,
        seed: hit.id, streak: true, dirX: hit.normalDx, dirY: hit.normalDy, bias: 0.62,
      })
    }
    if (firstSeen && hit.ricochet) {
      const angleJitter = (eventRandom(hit.id, 811) * 2 - 1) * Math.PI * 0.1
      const jitterC = Math.cos(angleJitter), jitterS = Math.sin(angleJitter)
      const bounceDx = hit.ricochetDx * jitterC - hit.ricochetDy * jitterS
      const bounceDy = hit.ricochetDx * jitterS + hit.ricochetDy * jitterC
      const projectileDiameter = ammoVisualDiameter(hit.ammoId, hit.projectileSize ?? ENEMY_PROJECTILE_VISUAL_SIZE)
      // 当前小口径表现是下限；口径按直径平方根柔化放大，宽度最多 3 倍、射程最多 2.2 倍。
      const caliber = ricochetVisualScale(projectileDiameter, eventRandom(hit.id, 812))
      // 跳弹尾迹由两层高速粒子飞行形成，不再直接绘制固定线段。
      spawnBurst(fxPool, {
        x: hit.x + bounceDx * 0.294 * caliber.range, y: hitVisualY + bounceDy * 0.294 * caliber.range,
        count: 2, speed: 9.2 * caliber.range, life: 0.13, size: 0.055 * caliber.head, color: '#F29B37', drag: 0.6,
        seed: hit.id + 311, streak: true, streakTime: 0.032, streakWidthScale: 0.65 * caliber.width, speedJitter: 0.04, lifeJitter: 0,
        dirX: bounceDx, dirY: bounceDy, bias: 1,
      })
      spawnBurst(fxPool, {
        x: hit.x + bounceDx * 0.294 * caliber.range, y: hitVisualY + bounceDy * 0.294 * caliber.range,
        count: 3, speed: 9.8 * caliber.range, life: 0.12, size: 0.028 * caliber.head, color: '#FFF7CD', drag: 0.4,
        seed: hit.id + 509, streak: true, streakTime: 0.03, streakWidthScale: 0.5 * caliber.width, speedJitter: 0.06, lifeJitter: 0.06,
        dirX: bounceDx, dirY: bounceDy, bias: 1,
      })
      spawnBurst(fxPool, {
        x: hit.x, y: hitVisualY, count: 3, speed: 2.1, life: 0.18, size: 0.024, color: '#F2A34A', drag: 7.2,
        seed: hit.id + 701, streak: true, dirX: -bounceDx, dirY: -bounceDy, bias: 0.35,
      })
    }
  }

  // ---- 单位 ----
  // 清理已离场单位的朝向缓存；友军使用负数渲染键，避免与敌方运行时 id 冲突。
  const liveHeadingKeys = new Set<number>([
    ...s.enemies.map(enemy => enemy.id),
    ...s.allies.map(ally => -ally.id - 1),
  ])
  for (const id of prevPos.keys()) {
    if (!liveHeadingKeys.has(id)) prevPos.delete(id)
  }
  const drawRuntimeEnemy = (e: (typeof s.enemies)[number], shadowOnly = false) => {
    const unit = runtimeEnemyUnitDef(e.unitDefId, e.kind)
    const px = X(e.x)
    const groundPy = Y(e.y)
    const altitude = currentUnitAltitude(e, unit)
    const py = groundPy - altitude * cell
    const collision = unitCollisionRadii(unit)
    const r = Math.max(collision.x, collision.y) * (e.bossSizeScale ?? 1) * cell
    drawEnemy(ctx, s, e, px, groundPy, r, cell, s.time, shadowOnly ? 'only' : 'skip')
    if (shadowOnly) return
    if (gameParameters().showUnitHealthBars && e.hp > 0) drawHpBar(ctx, px - r, py - r - 6, r * 2, e.hp / e.maxHp)
    const destroyTarget = s.objective.type === 'destroy' && e.placementId !== undefined && s.objective.unitPlacementIds.includes(e.placementId)
    if (destroyTarget && e.hp > 0) {
      const pulse = 0.82 + Math.sin(s.time * 5 + e.id) * 0.12
      const markerY = -r - Math.max(8, cell * 0.28)
      ctx.save()
      ctx.translate(px, py)
      ctx.strokeStyle = `rgba(217,164,65,${pulse})`
      ctx.fillStyle = '#D9A441'
      ctx.lineWidth = Math.max(1.5, cell * 0.05)
      ctx.beginPath(); ctx.moveTo(0, markerY); ctx.lineTo(-5, markerY - 8); ctx.lineTo(5, markerY - 8); ctx.closePath(); ctx.fill(); ctx.stroke()
      ctx.restore()
    }
    if (e.bossName) {
      ctx.save()
      ctx.font = `bold ${Math.max(9, Math.round(10 * zf))}px sans-serif`
      ctx.textAlign = 'center'
      ctx.fillStyle = '#EFEBD8'
      ctx.strokeStyle = '#1A1A18'
      ctx.lineWidth = 3
      ctx.strokeText(e.bossName, px, py - r - 11)
      ctx.fillText(e.bossName, px, py - r - 11)
      ctx.restore()
    }
  }

  // 友军与敌军只保留阵营/目标关系差异，美术、朝向、载具层级共用同一绘制入口。
  const drawRuntimeAlly = (a: (typeof s.allies)[number], shadowOnly = false) => {
    const unit = runtimeAllyUnitDef(a.unitDefId, a.kind)
    const px = X(a.x)
    const groundPy = Y(a.y)
    const altitude = currentUnitAltitude(a, unit)
    const py = groundPy - altitude * cell
    const collision = unitCollisionRadii(unit)
    const r = Math.max(collision.x, collision.y) * cell
    const tgt = a.targetId != null ? s.enemies.find(e => e.id === a.targetId) : null
    drawEnemy(ctx, s, {
      id: -a.id - 1, kind: enemyKindForUnit(unit), unitDefId: unit.id,
      x: a.x, y: a.y, hp: a.hp, maxHp: a.maxHp, mode: tgt ? 'attack' : 'move',
      targetKind: tgt ? 'combatUnit' : null, targetId: a.targetId,
      goalX: a.x, goalY: a.y, hasGoal: false, pathVersion: -1,
      attackedBy: [], dots: [], hitFlash: a.hitFlash, vehicle: a.vehicle, aircraft: a.aircraft,
      initialHeading: a.initialHeading, flipX: a.flipX, behaviorFacingHome: a.behaviorFacingHome,
    }, px, groundPy, r, cell, s.time, shadowOnly ? 'only' : 'skip')
    if (shadowOnly) return
    if (gameParameters().showUnitHealthBars && a.hp > 0) drawHpBar(ctx, px - r, py - r - 6, r * 2, a.hp / a.maxHp)
    const maxShield = Math.max(0, a.vehicle?.maxShield ?? 0)
    const shield = Math.max(0, a.vehicle?.shield ?? 0)
    const shieldHits = s.shieldHits.filter(hit => hit.unitId === a.id)
    if (maxShield > 0 && (shield > 0 || shieldHits.length > 0)) {
      const hitPulse = shieldHits.reduce((peak, hit) => Math.max(peak, hit.ttl / Math.max(0.001, hit.max)), 0)
      ctx.save()
      ctx.strokeStyle = `rgba(118,200,210,${0.3 + 0.5 * Math.max(hitPulse, shield / maxShield * 0.25)})`
      ctx.lineWidth = Math.max(1.5, cell * 0.05)
      ctx.beginPath()
      ctx.ellipse(px, py, r + cell * 0.12, r + cell * 0.08, 0, 0, Math.PI * 2)
      ctx.stroke()
      ctx.restore()
    }
  }

  if (!ui.edit) {
    const fr = fortressRect(s)
    const visibleEnemies = s.enemies.filter(enemy => {
      if (!pointVisible(enemy.x, enemy.y)) return false
      const unit = runtimeEnemyUnitDef(enemy.unitDefId, enemy.kind)
      const collision = unitCollisionRadii(unit)
      return pointInBattleVision(enemy.x, enemy.y, Math.max(collision.x, collision.y) * (enemy.bossSizeScale ?? 1))
    })
    const visibleAllies = s.allies.filter(ally => {
      if (!pointVisible(ally.x, ally.y)) return false
      const unit = runtimeAllyUnitDef(ally.unitDefId, ally.kind)
      const collision = unitCollisionRadii(unit)
      return pointInBattleVision(ally.x, ally.y, Math.max(collision.x, collision.y))
    })
    const playerDef = fortressDef(s)
    const playerAirborne = playerDef.platformType === 'rotorcraft' || playerDef.platformType === 'fixedWingAircraft'
    const playerAltitude = playerAirborne ? Math.max(0, playerDef.altitude ?? 0) : 0
    // 全部阴影属于地面预渲染层：先于物体和单位统一绘制，避免高空投影或高物体投影盖住实体。
    if (gameParameters().showEntityShadows) {
      for (const object of runtimeObjects) drawRuntimeObjectShadow(object)
      if (runtimeCore) drawRuntimeBuildingShadow(runtimeCore, 3)
      for (const building of runtimeBuildings) drawRuntimeBuildingShadow(building, 2)
      drawPlayerShadow()
      for (const enemy of visibleEnemies) drawRuntimeEnemy(enemy, true)
      for (const ally of visibleAllies) drawRuntimeAlly(ally, true)
    }
    const sceneItems: SceneRenderItem[] = [
      ...runtimeObjects.map((object, order) => ({ layer: object.renderLayer ?? 3, x: object.x, y: object.y, kind: 'object' as const, order, draw: () => drawRuntimeObject(object) })),
      ...(runtimeCore ? [{ layer: 3, x: runtimeCore.x, y: runtimeCore.y, kind: 'object' as const, order: runtimeObjects.length, draw: drawRuntimeCore }] : []),
      ...runtimeBuildings.map((building, index) => ({ layer: 3, x: building.x, y: building.y, kind: 'object' as const, order: runtimeObjects.length + 1 + index, draw: () => drawRuntimeBuilding(building) })),
      { layer: 3, x: fr.x + fr.w / 2, y: fr.y + fr.h / 2, kind: 'unit', airborne: playerAirborne, altitude: playerAltitude, order: runtimeObjects.length + runtimeBuildings.length + 1, draw: drawPlayerUnit },
      ...visibleEnemies.map((enemy, index) => {
        const unit = runtimeEnemyUnitDef(enemy.unitDefId, enemy.kind)
        return { layer: 3, x: enemy.x, y: enemy.y, kind: 'unit' as const, airborne: unit.stats.air, altitude: currentUnitAltitude(enemy, unit), order: runtimeObjects.length + runtimeBuildings.length + 2 + index, draw: () => drawRuntimeEnemy(enemy) }
      }),
      ...visibleAllies.map((ally, index) => {
        const unit = runtimeAllyUnitDef(ally.unitDefId, ally.kind)
        return { layer: 3, x: ally.x, y: ally.y, kind: 'unit' as const, airborne: unit.stats.air, altitude: currentUnitAltitude(ally, unit), order: runtimeObjects.length + runtimeBuildings.length + 2 + visibleEnemies.length + index, draw: () => drawRuntimeAlly(ally) }
      }),
    ]
    sceneItems.sort(compareSceneRenderItems)
    for (const item of sceneItems) item.draw()
    drawPlayerShield()
  }

  // 弹丸、炮口、射线、爆炸与空中粒子只在玩家队伍当前共享视野内出现。
  const runtimeDynamicClipped = beginBattleVisionClip()

  // ---- 弹道 ----
  // 导弹尾部喷口 glow（远行星号式引擎喷口：glow32 加法混合高亮；贴图/几何两分支共用；v2.46：随尾焰配置门控，无尾焰配置不画）
  // tailY = 弹体局部系尾部位置（下方为正，贴图弹=弹体半高）；width = glow 尺寸（贴图弹自适应贴图宽度）
  const drawEngineGlow = (p: (typeof s.projectiles)[number] | (typeof s.enemyProjectiles)[number], tailY = cell * 0.2, width = cell * 0.5, tailProjection = 1) => {
    if (p.kind !== 'missile') return
    // v2.20 喷口焰门控：制导延迟期（未点火）/ burnTime 燃尽滑行期不画
    if ((p.guideDelayLeft ?? 0) > 0) return
    const d20 = p.defId ? defOf(p.defId) : undefined
    if (d20?.burnTime !== undefined && (p.t ?? 0) >= d20.burnTime) return
    const g = srcImage('/res/fx/glow16.png')
    const tint = g.status === 'ready' && g.img ? tintedFx(g.img, '#ffa640') : null // 预着色橙黄火焰（alpha 强度遮罩）
    if (!tint) return
    const fl = glowFlicker(nowFx, p.x * 7 + p.y * 3) // 亮度闪烁 0.85~1.15（高频 sin + 位置相位）
    const fading = 'fading' in p ? p.fading : undefined
    const fade = fading !== undefined ? Math.max(0, fading / MISSILE_FADE) : 1 // fading 同步渐隐
    const glowLayout = missileEngineGlowLayout(tailY, tailProjection)
    if (glowLayout.alpha <= 0) return
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.globalAlpha = fl * fade * glowLayout.alpha
    ctx.translate(X(p.x), Y(p.y) - projectileAltitudeAtTravel(p, p.traveled) * cell)
    ctx.rotate('shooterId' in p ? (p.moveHeading ?? p.heading) : missileVisHeading(p, d20!)) // 随可视航向旋转（含 weave 摆动偏置）
    ctx.drawImage(tint, -width / 2, glowLayout.y, width, width) // 从尾端起只向航向后方展开，不再越过弹体中心出现在前方
    ctx.restore()
  }
  const drawShellGroundVisual = (p: { x: number; y: number; tx?: number; ty?: number }, visual: ShellArcVisual) => {
    ctx.save()
    ctx.fillStyle = `rgba(0,0,0,${visual.shadowOpacity})`
    ctx.beginPath()
    ctx.ellipse(X(p.x), Y(p.y), cell * 0.12 * visual.shadowScale, cell * 0.075 * visual.shadowScale, 0, 0, Math.PI * 2)
    ctx.fill()
    if (visual.landingProgress > 0 && p.tx !== undefined && p.ty !== undefined) {
      const pulse = 0.75 + Math.sin(visual.landingProgress * Math.PI * 5) * 0.15
      ctx.strokeStyle = `rgba(217,164,65,${(0.25 + visual.landingProgress * 0.55) * pulse})`
      ctx.lineWidth = Math.max(1, cell * 0.045)
      ctx.beginPath()
      ctx.arc(X(p.tx), Y(p.ty), cell * (0.34 - visual.landingProgress * 0.16), 0, Math.PI * 2)
      ctx.stroke()
    }
    ctx.restore()
  }
  for (const p of s.projectiles) {
    if (!pointVisible(p.x, p.y)) continue
    const pathAltitude = projectileAltitudeAtTravel(p, p.traveled)
    // v2.20 发动机门控：制导延迟期（未点火）/ burnTime 燃尽滑行期不喷主尾焰、烟尾、喷口焰
    const defP20 = p.kind === 'missile' ? defOf(p.defId) : undefined
    const engineOff20 = defP20 !== undefined && ((p.guideDelayLeft ?? 0) > 0 || (defP20.burnTime !== undefined && p.t >= defP20.burnTime))
    // v2.23 点火大力喷射（v2.24 过渡化）：点火后 1s 内主尾焰强化线性回落（rate ×3→×1 / size ×1.6→×1），替代 v2.20 点火闪光
    const boostT24 = p.t - (p.igniteAtT ?? 0)
    const b24 = defP20 !== undefined && !engineOff20 && p.fading === undefined && boostT24 >= 0 && boostT24 < 1 ? 1 - boostT24 : 0
    const am = ammoAssetsFor(p.defId)
    if (am) { // §3A.5 贴图弹丸：本体按飞行航向旋转（含导弹 weave 瞬时航向），尺寸 = 几何弹丸量级 × scale
      const vertical = p.kind === 'missile' ? verticalLaunchVisual(am.ammo, p.t) : null
      const img = vertical?.img ?? am.assets.projectile
      const sourceWidth = vertical?.sw ?? img.naturalWidth
      const sourceHeight = vertical?.sh ?? img.naturalHeight
      const shellVisual = p.kind === 'shell' ? shellArcVisual(p.t, p.sx, p.sy, p.tx, p.ty) : null
      const shellBodyScale = shellVisual?.bodyScale ?? 1
      const size = sourceHeight * zf * shellBodyScale // 原尺寸显示；抛射到达最高点时轻微放大
      const bw = size * (sourceWidth / sourceHeight)
      const lift = (pathAltitude + (shellVisual?.altitude ?? 0)) * cell
      const visualHeading = p.kind === 'missile' ? missileVisHeading(p, defOf(p.defId)) : p.heading
      const tailProjection = p.kind === 'missile' ? verticalLaunchTailProjection(am.ammo, p.t) : 1
      const emitter = projectileTailEmitter(p.x, p.y, visualHeading, size / cell, tailProjection)
      const emitterX = emitter.x
      const emitterY = emitter.y
      if (shellVisual) drawShellGroundVisual(p, shellVisual)
      if (p.fading !== undefined) ctx.globalAlpha = Math.max(0, p.fading / MISSILE_FADE) // 导弹 fading 贴图同步渐隐
      const tf = resolveTrailFx(am.ammo)
      const smokeOn = !!tf?.smoke && projectileSmokeTailActive(
        am.ammo, p.t, p.guideDelayLeft, p.igniteAtT, defP20?.burnTime, tf.smoke.duration,
      )
      if (tf && (!engineOff20 || smokeOn)) {
        const prev = projPrev.get(p.id) // 弹速估算：相邻帧插值位移 / dt（惯性继承用）
        const pvx = prev && fxDt > 0 ? (p.x - prev.x) / fxDt : 0
        const pvy = prev && fxDt > 0 ? (p.y - prev.y) / fxDt : 0
        projPrev.set(p.id, { x: p.x, y: p.y })
        if (!engineOff20) { // 主尾焰仍遵循点火/燃尽门控；垂发提前生效的只有烟尾。
          let rate = tf.rate
          if (tf.template === 'pulse') rate *= 1 + 0.6 * Math.sin(2 * Math.PI * 1.2 * nowFx) // 火焰脉冲：1.2Hz 振荡（0.4~1.6 倍均值）
          rate *= 1 + 2 * b24 // v2.24 大力喷射过渡：速率 ×3 线性回落 ×1
          const acc = (trailAcc.get(p.id) ?? 0) + rate * fxDt
          const n = Math.floor(acc)
          trailAcc.set(p.id, acc - n)
          for (let i = 0; i < n; i++) {
            const ang = visualHeading + (Math.random() * 2 - 1) * tf.spread // 与贴图当前可视航向一致
            const velocity = projectileTrailVelocity(pvx, pvy, ang, tf.inherit, tailProjection)
            spawnTrail(fxPool, emitterX, emitterY - lift / cell, {
              vx: velocity.vx,
              vy: velocity.vy,
              life: tf.life,
              size: tf.size * (1 + 0.6 * b24) * (tf.template === 'pulse' ? 0.85 + Math.random() * 0.3 : 1), // 脉冲尺寸闪烁；v2.24 大力喷射尺寸 ×1.6 线性回落 ×1
              color: tf.color,
              drag: tf.drag,
              grow: tf.grow,
              colorEnd: tf.colorEnd,
              fadeIn: tf.fadeIn,
              flicker: tf.template === 'pulse' ? 0.2 : undefined, // 脉冲 alpha 抖动
            })
          }
        }
        if (tf.smoke && smokeOn) { // 垂发从离架第一帧开始；普通弹丸仍从点火时刻开始。
          // v2.21：前 40% 寿命膨胀扩散、之后尺寸冻结渐隐消失
          const sAcc = (smokeAcc.get(p.id) ?? 0) + tf.smoke.rate * fxDt
          const sN = Math.floor(sAcc)
          smokeAcc.set(p.id, sAcc - sN)
          for (let i = 0; i < sN; i++) {
            const smokeVelocity = rearOnlyTrailVelocity(
              pvx * 0.15 * tailProjection + (Math.random() * 2 - 1) * 0.3,
              pvy * 0.15 * tailProjection + (Math.random() * 2 - 1) * 0.3,
              visualHeading,
            )
            spawnTrail(fxPool, emitterX, emitterY - lift / cell, {
              vx: smokeVelocity.vx,
              vy: smokeVelocity.vy,
              life: tf.smoke.life, // v2.23：寿命不再受 burnTime 钳制（钳制只作用于「持续」窗口）
              size: tf.size * 1.6, // 比主尾焰更大团
              color: tf.smoke.color,
              drag: 1.5,
              grow: 1.6,
              growUntil: 0.4, // 扩散后逐渐消失：膨胀至 40% 寿命后冻结尺寸，alpha 随寿命渐隐
              fadeIn: 0.15,
            })
          }
        }
      }
      // v2.46：无尾焰配置 = 无任何默认尾焰（原子弹曳光线回退删除；导弹喷口 glow 同样改随尾焰配置门控）
      ctx.save()
      ctx.imageSmoothingEnabled = false
      ctx.translate(X(p.x), Y(p.y) - lift)
      // 导弹按可视航向旋转（含 weave 摆动偏置，与位移公式同源）；其他弹丸按航向
      ctx.rotate(visualHeading)
      if (vertical) ctx.drawImage(img, vertical.sx, 0, vertical.sw, vertical.sh, -bw / 2, -size / 2, bw, size)
      else ctx.drawImage(img, -bw / 2, -size / 2, bw, size)
      ctx.restore()
      ctx.globalAlpha = 1
      // 贴图导弹喷口 glow：尾部 = 贴图中间最下方（局部 +y 半高处），尺寸自适应贴图宽度
      if (p.kind === 'missile' && tf) drawEngineGlow(p, size / 2, bw * 1.3, tailProjection) // v2.46：喷口 glow 随尾焰配置（无配置不画）
      continue
    }
    if (p.kind === 'bullet') { // v2.46：删除默认曳光线（无尾焰配置=无尾迹），仅留弹体圆点
      ctx.fillStyle = '#F5E9C8'
      ctx.strokeStyle = '#1A1A18'
      ctx.lineWidth = 1
      ctx.beginPath(); ctx.arc(X(p.x), Y(p.y) - pathAltitude * cell, 2.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
    } else if (p.kind === 'shell') {
      const visual = shellArcVisual(p.t, p.sx, p.sy, p.tx, p.ty)
      drawShellGroundVisual(p, visual)
      ctx.fillStyle = '#9C7B54'
      ctx.strokeStyle = '#1A1A18'
      ctx.lineWidth = 1.5
      ctx.beginPath(); ctx.arc(X(p.x), Y(p.y) - (pathAltitude + visual.altitude) * cell, 4 * visual.bodyScale, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
    } else {
      // 导弹：弹体圆点（fading 阶段按剩余比例淡出）；v2.25 删除几何尾焰线，尾部表现交由粒子尾焰/烟尾与喷口 glow
      if (p.fading !== undefined) ctx.globalAlpha = Math.max(0, p.fading / MISSILE_FADE)
      ctx.fillStyle = p.guided ? '#7E6E9C' : '#A05C48'
      ctx.strokeStyle = '#1A1A18'
      ctx.lineWidth = 1.5
      ctx.beginPath(); ctx.arc(X(p.x), Y(p.y) - pathAltitude * cell, 3.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
      ctx.globalAlpha = 1
    }

    // 导弹尾部喷口 glow：v2.46 起随尾焰配置门控（无尾焰配置 = 无默认尾焰/喷口焰）
    const paGlow = defOf(p.defId).art?.projectile ? projectileArtDef(defOf(p.defId).art!.projectile!) : undefined
    if (p.kind === 'missile' && paGlow && resolveTrailFx(paGlow)) drawEngineGlow(p, cell * 0.2, cell * 0.5, verticalLaunchTailProjection(paGlow, p.t))
  }

  // 敌方/友方单位弹丸：战斗与美术都只读取同一弹丸库条目。
  // 加载期可以接收旧快照，但无有效弹丸定义的遗留飞行物不再进入旧数值/暖红回退表现。
  for (const p of s.enemyProjectiles) {
    if (!pointVisible(p.x, p.y)) continue
    const projectileKind = p.kind ?? 'bullet'
    const pathAltitude = projectileAltitudeAtTravel(p, p.traveled)
    const projectileHeading = p.moveHeading ?? p.heading
    const ammo = p.ammoId ? projectileArtDef(p.ammoId) : undefined
    if (!ammo) continue
    const ammoState = ammo ? projectileArtState(ammo) : null
    const ammoImage = ammoState?.status === 'ready' ? ammoState.assets?.projectile : undefined
    const vertical = projectileKind === 'missile' ? verticalLaunchVisual(ammo, p.t ?? 0) : null
    const shellVisual = projectileKind === 'shell'
      ? shellArcVisual(p.t ?? 0, p.sx ?? p.x, p.sy ?? p.y, p.tx ?? p.x, p.ty ?? p.y)
      : null
    const shellLift = (pathAltitude + (shellVisual?.altitude ?? 0)) * cell
    const projectileY = Y(p.y) - shellLift
    const trail = ammo ? resolveTrailFx(ammo) : null
    const trailBodyLength = ammoImage ? (vertical?.sh ?? ammoImage.naturalHeight) / BASE_CELL : 0.4
    const tailProjection = projectileKind === 'missile' ? verticalLaunchTailProjection(ammo, p.t ?? 0) : 1
    const emitter = projectileTailEmitter(p.x, p.y, projectileHeading, trailBodyLength, tailProjection)
    const emitterX = emitter.x
    const emitterY = emitter.y
    const engineOff = projectileKind === 'missile' && ((p.guideDelayLeft ?? 0) > 0 || (p.burnTime !== undefined && (p.t ?? 0) >= p.burnTime))
    const boostAge = (p.t ?? 0) - (p.igniteAtT ?? 0)
    const boost = projectileKind === 'missile' && !engineOff && boostAge >= 0 && boostAge < 1 ? 1 - boostAge : 0
    const smokeOn = !!(ammo && trail?.smoke) && projectileSmokeTailActive(
      ammo, p.t ?? 0, p.guideDelayLeft, p.igniteAtT, p.burnTime, trail.smoke.duration,
    )
    if (trail && (!engineOff || smokeOn)) {
      const prev = projPrev.get(p.id)
      const pvx = prev && fxDt > 0 ? (p.x - prev.x) / fxDt : 0
      const pvy = prev && fxDt > 0 ? (p.y - prev.y) / fxDt : 0
      projPrev.set(p.id, { x: p.x, y: p.y })
      if (!engineOff) {
        let rate = trail.rate * (1 + 2 * boost)
        if (trail.template === 'pulse') rate *= 1 + 0.6 * Math.sin(2 * Math.PI * 1.2 * nowFx)
        const acc = (trailAcc.get(p.id) ?? 0) + rate * fxDt
        const count = Math.floor(acc)
        trailAcc.set(p.id, acc - count)
        for (let index = 0; index < count; index++) {
          const angle = projectileHeading + (Math.random() * 2 - 1) * trail.spread
          const velocity = projectileTrailVelocity(pvx, pvy, angle, trail.inherit, tailProjection)
          spawnTrail(fxPool, emitterX, emitterY - shellLift / cell, {
            vx: velocity.vx,
            vy: velocity.vy,
            life: trail.life,
            size: trail.size * (1 + 0.6 * boost) * (trail.template === 'pulse' ? 0.85 + Math.random() * 0.3 : 1),
            color: trail.color,
            drag: trail.drag,
            grow: trail.grow,
            colorEnd: trail.colorEnd,
            fadeIn: trail.fadeIn,
            flicker: trail.template === 'pulse' ? 0.2 : undefined,
          })
        }
      }
      if (trail.smoke && smokeOn) {
        const accumulator = (smokeAcc.get(p.id) ?? 0) + trail.smoke.rate * fxDt
        const smokeCount = Math.floor(accumulator); smokeAcc.set(p.id, accumulator - smokeCount)
        for (let index = 0; index < smokeCount; index++) {
          const smokeVelocity = rearOnlyTrailVelocity(
            pvx * 0.15 * tailProjection + (Math.random() * 2 - 1) * 0.3,
            pvy * 0.15 * tailProjection + (Math.random() * 2 - 1) * 0.3,
            projectileHeading,
          )
          spawnTrail(fxPool, emitterX, emitterY - shellLift / cell, {
            vx: smokeVelocity.vx, vy: smokeVelocity.vy,
            life: trail.smoke.life, size: trail.size * 1.6, color: trail.smoke.color,
            drag: 1.5, grow: 1.6, growUntil: 0.4, fadeIn: 0.15,
          })
        }
      }
    }
    if (shellVisual) drawShellGroundVisual(p, shellVisual)
    const img = vertical?.img ?? ammoImage
    let renderedBodyWidth: number | undefined
    let renderedBodyHeight: number | undefined
    if (img) {
      ctx.save()
      ctx.translate(X(p.x), projectileY)
      ctx.rotate(projectileHeading)
      ctx.imageSmoothingEnabled = false
      const sourceWidth = vertical?.sw ?? img.naturalWidth
      const sourceHeight = vertical?.sh ?? img.naturalHeight
      const w = sourceWidth * zf * (shellVisual?.bodyScale ?? 1), h = sourceHeight * zf * (shellVisual?.bodyScale ?? 1)
      renderedBodyWidth = w; renderedBodyHeight = h
      if (vertical) ctx.drawImage(img, vertical.sx, 0, vertical.sw, vertical.sh, -w / 2, -h / 2, w, h)
      else ctx.drawImage(img, -w / 2, -h / 2, w, h)
      ctx.restore()
    } else {
      if (projectileKind === 'bullet') {
        ctx.fillStyle = '#F5E9C8'; ctx.strokeStyle = '#1A1A18'; ctx.lineWidth = 1
        ctx.beginPath(); ctx.arc(X(p.x), projectileY, 2.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
      } else if (projectileKind === 'shell') {
        ctx.fillStyle = '#9C7B54'; ctx.strokeStyle = '#1A1A18'; ctx.lineWidth = 1.5
        ctx.beginPath(); ctx.arc(X(p.x), projectileY, 4 * (shellVisual?.bodyScale ?? 1), 0, Math.PI * 2); ctx.fill(); ctx.stroke()
      } else {
        ctx.fillStyle = p.guided ? '#7E6E9C' : '#A05C48'; ctx.strokeStyle = '#1A1A18'; ctx.lineWidth = 1.5
        ctx.beginPath(); ctx.arc(X(p.x), projectileY, 3.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
      }
    }
    if (projectileKind === 'missile' && trail && !engineOff) drawEngineGlow(p, renderedBodyHeight ? renderedBodyHeight / 2 : cell * 0.2, renderedBodyWidth ? renderedBodyWidth * 1.3 : cell * 0.5, tailProjection)
  }

  const enemyMountedTurrets = s.enemies.flatMap(enemy => enemy.vehicle?.turrets ?? [])
  const allyMountedTurrets = s.allies.flatMap(ally => ally.vehicle?.turrets ?? [])
  const allCombatTurrets = [...s.turrets, ...enemyMountedTurrets, ...allyMountedTurrets]
  const playerTurretIds = new Set(s.turrets.map(turret => turret.id))

  // ---- 炮口火光（规范 §5.3：击发时刻炮口点，帧条按渲染帧推进，朝向 = 击发时刻炮口方向不跟随旋转）----
  {
    const live = new Set<number>()
    for (const m of s.muzzles) {
      live.add(m.id)
      if (ui.interiorMode && playerTurretIds.has(m.turretId)) continue
      const t = allCombatTurrets.find(tt => tt.id === m.turretId)
      const def = t ? defOf(t.defId) : undefined
      if (!def) continue
      // 只允许继承自身车体的俯仰；当前只有玩家堡垒具有 lean，不能把它误加到其他单位炮口。
      const mLean = !!(t && playerTurretIds.has(t.id) && leanOn && t.hardpointId != null)
      const artEntry = turretArtState(def)
      const fd = FLASH_DURATION // 火光总时长硬编码 0.2s（v1.45：2 帧 × 0.1s）
      const el = fxElapsed(m)
      if (el >= fd) continue
      if (artEntry.status === 'ready' && artEntry.assets?.flash) { // 贴图火光（flash 可选，无素材/回退态不画，保持现状视觉零变化）
        const img = artEntry.assets.flash
        const fi = Math.min(FLASH_FRAMES - 1, Math.floor(el / FLASH_FRAME_DUR)) // 固定 2 帧（v1.45）
        const fh = img.height
        ctx.save()
        ctx.globalCompositeOperation = 'lighter' // v2.6：火光加法发光
        ctx.imageSmoothingEnabled = false
        ctx.translate(X(m.x) + (mLean ? leanX : 0), Y(m.y) - (m.sourceAltitude ?? 0) * cell + (mLean ? leanY : 0))
        ctx.rotate(m.angle)
        if (img.width >= fh * FLASH_FRAMES) { // 横向帧条（fh×fh × N）：逐帧裁切，原尺寸 × 逐帧缩放（1.4×→1×）
          const size = fh * zf * FLASH_SCALES[fi]
          ctx.drawImage(img, fi * fh, 0, fh, fh, -size / 2, -size, size, size)
        } else { // v1.77：单张火光图（宽 < 高×帧数，如 fx_fire_s 6×18）：整图绘制，逐帧脉冲缩放
          const fw = img.width * zf * FLASH_SCALES[fi]
          const fhh = fh * zf * FLASH_SCALES[fi]
          ctx.drawImage(img, -fw / 2, -fhh, fw, fhh)
        }
        ctx.restore()
      }
    }
    // 事件消亡清缓存：live 需覆盖所有使用 fxSeen 的事件类型（炮口/爆炸/命中），
    // 否则爆炸/命中 id 被误删 → firstSeen 每帧重复触发 → 粒子重复发射不消失
    for (const ex of s.explosions) live.add(ex.id)
    for (const im of s.impacts) live.add(im.id)
    for (const sh of s.shieldHits) live.add(sh.id)
    for (const fh of s.unitHits) live.add(fh.id)
    for (const id of [...fxSeen.keys()]) if (!live.has(id)) {
      fxSeen.delete(id)
      shieldBreakEmitted.delete(id)
    }
  }

  // ---- 射线 / 喷射 ----
  for (const t of allCombatTurrets) {
    const playerOwned = playerTurretIds.has(t.id)
    if (ui.interiorMode && playerOwned) continue
    if (!t.firing) continue
    const bLean = playerOwned && leanOn && t.hardpointId != null
    const def = defOf(t.defId)
    // §5.4：光束/喷射同样使用 barrel 0 炮口点；未配置挂点时读取自动生成炮口。
    const c = muzzlePos(t, def, 0)
    if (def.type === 'beam') {
      const len = beamLength(s, t, def)
      const wpx = (def.beamWidth ?? 1.024) / M_PER_CELL * cell
      const lenPx = len * cell
      // v2.7 远行星号式分层光束：光晕层 + 亮芯层（贴图平铺滚动 + 加法发光 + 亮度闪烁），缺省贴图搭配；
      // 层素材 'none'/未就绪 → 该层回退程序化矩形（颜色/宽度与旧版一致）
      const ba = beamArtConfig(def)
      const ph = t.id * 1.7 // 相位：多炮塔闪烁错开
      const wave = 0.5 + 0.5 * (0.7 * Math.sin(nowFx * 22 + ph) + 0.3 * Math.sin(nowFx * 57 + ph * 2))
      const bright = 1 - ba.flicker + ba.flicker * wave // [1-flicker, 1]
      const scroll = ba.scrollSpeed > 0 ? nowFx * ba.scrollSpeed * (cell / BASE_CELL) : 0
      ctx.save()
      ctx.translate(X(c.x) + (bLean ? leanX : 0), Y(c.y) + (bLean ? leanY : 0))
      ctx.rotate(t.angle - Math.PI / 2) // 局部 +x 沿光束方向（贴图平铺轴向）
      const glowT = ba.glow?.status === 'ready' && ba.glow.img ? tintedFx(ba.glow.img, ba.fringeColor) : null
      const coreT = ba.core?.status === 'ready' && ba.core.img ? tintedFx(ba.core.img, ba.coreColor) : null
      // v2.50：宽幅已配置 → 贴图高度缩放到 宽幅/M_PER_CELL 格（光晕=wpx、亮芯=wpx×0.5）；未配置 = 贴图原生高度（现状）
      const fitB = (im: { height: number } | null, targetH: number) =>
        def.beamWidth !== undefined && im ? targetH / (im.height * (cell / BASE_CELL)) : 1
      drawBeamLayer(ctx, glowT, ba.fringeColor, lenPx, wpx, 0.45 * bright, scroll, cell / BASE_CELL, fitB(glowT, wpx)) // 贴图原生 32px 高（texScale 适配缩放）
      drawBeamLayer(ctx, coreT, ba.coreColor, lenPx, wpx * 0.5, 0.9 * bright, scroll, cell / BASE_CELL, fitB(coreT, wpx * 0.5))
      // 炮口光球（缺省 glow16；'none'/未就绪不画；v2.10 尺寸×muzzleScale）
      const mzT = ba.muzzle?.status === 'ready' && ba.muzzle.img ? tintedFx(ba.muzzle.img, ba.fringeColor) : null
      if (mzT) {
        const msz = wpx * 2 * ba.muzzleScale * (0.9 + 0.2 * wave)
        ctx.globalCompositeOperation = 'lighter'
        ctx.globalAlpha = 0.85 * bright
        ctx.drawImage(mzT, -msz / 2, -msz / 2, msz, msz)
        ctx.globalCompositeOperation = 'source-over'
        ctx.globalAlpha = 1
      }
      // 命中点闪光（缺省 glow16；光束端点，高频脉动；v2.10 尺寸×impactScale）
      const imT = ba.impact?.status === 'ready' && ba.impact.img ? tintedFx(ba.impact.img, ba.coreColor) : null
      if (imT) {
        const isz = wpx * 2.6 * ba.impactScale * (0.85 + 0.3 * wave)
        const tw = Math.sin(nowFx * 40 + ph)
        ctx.globalCompositeOperation = 'lighter'
        ctx.globalAlpha = Math.min(1, 0.75 * bright + 0.25 * tw * tw)
        ctx.drawImage(imT, lenPx - isz / 2, -isz / 2, isz, isz)
        ctx.globalCompositeOperation = 'source-over'
        ctx.globalAlpha = 1
      }
      ctx.restore()
      // v2.10 光束三组粒子（仅持续光束发射期间；吸收=炮口环带向心汇聚，散发=端点飞溅 lighter，烟尘=端点 grow>0 不加光）
      if (ba.absorb || ba.scatter || ba.smoke) {
        const accE = beamFxAcc.get(t.id) ?? { absorb: 0, scatter: 0, smoke: 0 }
        beamFxAcc.set(t.id, accE)
        if (ba.absorb) {
          accE.absorb += ba.absorb.rate * fxDt
          const n = Math.floor(accE.absorb)
          accE.absorb -= n
          for (let i = 0; i < n; i++) {
            const ang = Math.random() * Math.PI * 2
            const dist = 0.35 + Math.random() * 0.3 // 出生环带半径（格）
            const sp = 1.6 // 向心速度（格/s）：life = dist/sp 恰好到达汇聚点
            spawnTrail(fxPool, c.x + Math.cos(ang) * dist, c.y + Math.sin(ang) * dist, {
              vx: -Math.cos(ang) * sp, vy: -Math.sin(ang) * sp,
              life: dist / sp, size: ba.absorb.size, color: ba.absorb.color, drag: 0,
            })
          }
        }
        const epX = c.x + dirX(t.angle) * len // 命中端点（世界格）
        const epY = c.y + dirY(t.angle) * len
        if (ba.scatter) {
          accE.scatter += ba.scatter.rate * fxDt
          const n = Math.floor(accE.scatter)
          accE.scatter -= n
          // v2.15：散发角度——以朝射线源方向（端点→炮口）为 0° 的全锥角；360=全向（旧行为）；电焊拖尾 streak
          const srcAng = Math.atan2(c.y - epY, c.x - epX)
          const cone = ba.scatter.angle * Math.PI / 180
          for (let i = 0; i < n; i++) {
            const ang = ba.scatter.angle >= 360 ? Math.random() * Math.PI * 2 : srcAng + (Math.random() - 0.5) * cone
            const sp = 2 + Math.random() * 2 // 飞溅初速 2~4 格/s
            spawnTrail(fxPool, epX, epY, {
              vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
              life: 0.2 + Math.random() * 0.15, size: ba.scatter.size, color: ba.scatter.color, drag: 6, streak: true,
            })
          }
        }
        if (ba.smoke) {
          accE.smoke += ba.smoke.rate * fxDt
          const n = Math.floor(accE.smoke)
          accE.smoke -= n
          for (let i = 0; i < n; i++) {
            const ang = Math.random() * Math.PI * 2
            const sp = 0.3 + Math.random() * 0.4 // 慢速漂移
            spawnTrail(fxPool, epX, epY, {
              vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 0.2, // 微上浮
              life: 0.8 + Math.random() * 0.4, size: ba.smoke.size, color: ba.smoke.color, drag: 1.5, grow: 2, // grow>0 → smoke32 + source-over（与爆炸烟尘同口径）
            })
          }
        }
      }
    } else if (def.type === 'spray') {
      const rC = def.rangeMax / M_PER_CELL * cell
      const half = (def.sprayAngle ?? 60) * Math.PI / 360
      ctx.save()
      ctx.translate(X(c.x) + (bLean ? leanX : 0), Y(c.y) + (bLean ? leanY : 0))
      ctx.rotate(t.angle)
      ctx.fillStyle = 'rgba(217,120,45,0.4)'
      ctx.beginPath()
      ctx.moveTo(0, 0)
      ctx.arc(0, 0, rC, -Math.PI / 2 - half, -Math.PI / 2 + half)
      ctx.closePath()
      ctx.fill()
      ctx.restore()
    }
    // P3 §5.4 扩展：持续发射期间炮口循环播放 flash 帧条（跟随炮塔当前角度；回退态不画，保持视觉零变化）
    const susArt = turretArtState(def)
    if (susArt.status === 'ready' && susArt.assets?.flash) { // flash 可选
      const img = susArt.assets.flash
      const now = typeof performance !== 'undefined' ? performance.now() / 1000 : 0
      const fi = Math.floor((now % FLASH_DURATION) / FLASH_FRAME_DUR) % FLASH_FRAMES // 循环帧（固定 2 帧 × 0.1s，v1.45）
      const mp = muzzlePos(t, def, 0) // 持续型取 barrel 0 炮口
      const b0 = artMounts(t, def)[0]
      ctx.save()
      ctx.globalCompositeOperation = 'lighter' // v2.6：火光加法发光
      ctx.imageSmoothingEnabled = false
      ctx.translate(X(mp.x), Y(mp.y))
      ctx.rotate(t.angle)
      if (img.width >= img.height * FLASH_FRAMES) { // 横向帧条：尺寸 = 挂点距 × 逐帧缩放 1.4× → 1×
        const size = Math.hypot(b0.muzzle[0] - b0.mount[0], b0.muzzle[1] - b0.mount[1]) * cell * FLASH_SCALES[fi]
        ctx.drawImage(img, fi * img.height, 0, img.height, img.height, -size / 2, -size, size, size)
      } else { // v1.77：单张火光图：整图原尺寸 × 脉冲缩放
        const fw = img.width * zf * FLASH_SCALES[fi]
        const fhh = img.height * zf * FLASH_SCALES[fi]
        ctx.drawImage(img, -fw / 2, -fhh, fw, fhh)
      }
      ctx.restore()
    }
  }

  // v2.10：清理不再发射光束的炮塔粒子累积器（停火/拆除/过热）
  for (const id of [...beamFxAcc.keys()]) {
    const t = allCombatTurrets.find(t2 => t2.id === id)
    if (!t || !t.firing) beamFxAcc.delete(id)
  }

  // ---- 光束停火消退：命中点保持不动，起点从炮口向目标收束，同时宽度收窄 + 渐隐 ----
  for (const bf of s.beamFades) {
    const p = Math.max(0, bf.ttl / bf.max) // 1 → 0
    const alpha = Math.pow(p, 0.7)
    const wpx = ((bf.width ?? 1.024) / M_PER_CELL) * cell * p // 宽度随进度收窄至 0（未配置回退旧版等价格宽）
    const span = beamFadeSpan(bf.len, p, bf.mode ?? 'shrink')
    const lenPx = span.length * cell
    const startX = bf.x + dirX(bf.angle) * span.start
    const startY = bf.y + dirY(bf.angle) * span.start
    const ba = beamArtConfig(defOf(bf.defId)) // v2.7：消退段沿用 firing 时的光束美术配置
    // 加入已收束长度，保持贴图相位锚定在原光束上，不因起点前移而跳纹理。
    const scroll = (ba.scrollSpeed > 0 ? nowFx * ba.scrollSpeed * (cell / BASE_CELL) : 0) + span.start * cell
    ctx.save()
    ctx.translate(X(startX), Y(startY))
    ctx.rotate(bf.angle - Math.PI / 2) // 局部 +x 沿光束方向
    const glowT = ba.glow?.status === 'ready' && ba.glow.img ? tintedFx(ba.glow.img, ba.fringeColor) : null
    const coreT = ba.core?.status === 'ready' && ba.core.img ? tintedFx(ba.core.img, ba.coreColor) : null
    // 宽幅已配置 → 贴图高度按 M_PER_CELL 换算（wpx 已含 p 收窄，亮芯不再叠乘 p）；未配置 = 原生高度
    const fitF = (im: { height: number } | null, targetH: number) =>
      bf.width !== undefined && im ? targetH / im.height : 1
    drawBeamLayer(ctx, glowT, ba.fringeColor, lenPx, wpx, 0.45 * alpha, scroll, 1, fitF(glowT, wpx))
    drawBeamLayer(ctx, coreT, ba.coreColor, lenPx, wpx * 0.5, 0.9 * alpha, scroll, 1,
      bf.width !== undefined && coreT ? fitF(coreT, wpx * 0.5) : p) // v2.36：亮芯层贴图随 p 收窄到 0%
    ctx.restore()
  }

  // ---- 爆炸（v2.54 统一程序化画法：火球+软边/描边冲击环+瞬时照明+拉丝火花/烟尘；门控不变：无 blastRadius 不产生带 ammoId 事件；v2.55 画法走 fxDraw 共用层）----
  for (const ex of s.explosions) {
    if (ex.kind === 'groundImpact') continue // v2.57：仅用于地面小坑，不播放爆炸视觉
    if (ex.kind === 'unitDeath') { // 所有阵营与玩家共用：四档火球 + 实体残骸 + 飞溅碎片 + 黑色浓烟
      const preset = ex.deathEffect ?? 'medium'
      const intensity = preset === 'small' ? 0 : preset === 'medium' ? 1 : preset === 'large' ? 2 : 3
      const visual = unitDestructionVisualParams(preset)
      const ef = visual.explosion
      const maxTtl = ex.max ?? 1.75
      const firstSeen = !fxSeen.has(ex.id)
      const el = fxElapsed({ id: ex.id, ttl: ex.ttl, max: maxTtl })
      if (firstSeen) {
        const rC = Math.max(0.2, ex.r * ef.visualScale)
        // 与弹丸爆炸完全共用火花和第一层烟尘的数量、速度、寿命与扰动口径。
        spawnBurst(fxPool, {
          x: ex.x, y: ex.y, count: ef.sparks, speed: rC * 6, life: 0.5,
          size: 0.05 * ef.visualScale, color: ef.color, drag: 4, seed: ex.id,
          speedJitter: ef.speedJitter, lifeJitter: ef.lifeJitter, streak: ef.streak === 1,
        })
        spawnBurst(fxPool, {
          x: ex.x, y: ex.y, count: ef.smoke, speed: rC * 1.5, life: 0.9,
          size: 0.1 * ef.visualScale, color: '#3A3632', drag: 1.5, seed: ex.id + 1,
          grow: 2, turb: ef.turbulence, speedJitter: ef.speedJitter, lifeJitter: ef.lifeJitter,
        })
        // 实体残骸比旧版拥有更高初速、更低阻力和更长寿命，因此能明显飞出爆炸主体范围。
        const debrisRadius = Math.max(0.2, ex.r)
        spawnBurst(fxPool, {
          x: ex.x, y: ex.y, count: visual.debrisCount, speed: debrisRadius * visual.debrisSpeed,
          life: visual.debrisLife, size: visual.debrisSize, color: '#5B4B3D', drag: visual.debrisDrag,
          seed: ex.id + 101, speedJitter: 0.62, lifeJitter: 0.32, sizeJitter: 0.48,
          shape: 'debris', spriteScale: visual.debrisSpriteScale,
        })
        // 单位摧毁额外保留一层慢速黑烟；爆心本身仍使用弹丸爆炸模板。
        spawnBurst(fxPool, {
          x: ex.x, y: ex.y, count: 5 + intensity * 4, speed: debrisRadius * (0.62 + intensity * 0.07),
          life: 1.45 + intensity * 0.34, size: 0.11 + intensity * 0.024, color: '#211F1D',
          drag: 1.15, seed: ex.id + 211, grow: 1.6, turb: Math.max(0.72, ef.turbulence),
          speedJitter: 0.68, lifeJitter: 0.36, sizeJitter: 0.38,
        })
      }
      drawExplosionLayers(ctx, X, Y, cell, ex, Math.min(1, el / ef.duration), ef, el)

      // 剧烈模板复用旧堡垒“连锁爆炸”的观感，但不再拥有堡垒专属事件或伤害逻辑。
      if (preset === 'violent') {
        const offsets = [[-0.28, -0.22], [0.3, 0.18], [-0.12, 0.31], [0.2, -0.34]] as const
        const secondaryFx = { ...explosionTemplateFx('medium', '#F08B2D'), visualScale: 0.88 }
        const heading = ex.heading ?? 0
        const bw = ex.bodyWidth ?? ex.r
        const bh = ex.bodyHeight ?? ex.r
        for (let i = 0; i < offsets.length; i++) {
          const localElapsed = el - 0.16 - i * 0.17
          if (localElapsed < 0 || localElapsed > 0.72) continue
          const lx = offsets[i][0] * bw
          const ly = offsets[i][1] * bh
          const ox = lx * Math.cos(heading) - ly * Math.sin(heading)
          const oy = lx * Math.sin(heading) + ly * Math.cos(heading)
          const sub = { x: ex.x + ox, y: ex.y + oy, r: ex.r * (0.34 + i * 0.035) }
          drawExplosionLayers(ctx, X, Y, cell, sub, Math.min(1, localElapsed / secondaryFx.duration), secondaryFx, localElapsed)
        }
      }

      // 主体消失后仍保留短暂焦黑残骸轮廓，随后与浓烟一同淡出。
      const wreckIn = Math.min(1, el / 0.28)
      const wreckOut = Math.max(0, Math.min(1, (maxTtl - el) / Math.max(0.35, maxTtl * 0.38)))
      const wreckAlpha = wreckIn * wreckOut * (0.38 + intensity * 0.08)
      if (wreckAlpha > 0.01) {
        const ww = Math.max(0.16, (ex.bodyWidth ?? ex.r) * cell * (0.2 + intensity * 0.025))
        const wh = Math.max(0.12, (ex.bodyHeight ?? ex.r) * cell * (0.16 + intensity * 0.02))
        ctx.save(); ctx.translate(X(ex.x), Y(ex.y)); ctx.rotate(ex.heading ?? 0)
        ctx.globalAlpha = wreckAlpha; ctx.fillStyle = '#211D19'; ctx.strokeStyle = '#0E0D0C'; ctx.lineWidth = 1.5
        ctx.beginPath(); ctx.moveTo(-ww, -wh * 0.45); ctx.lineTo(-ww * 0.18, -wh); ctx.lineTo(ww * 0.88, -wh * 0.54); ctx.lineTo(ww, wh * 0.36); ctx.lineTo(ww * 0.1, wh); ctx.lineTo(-ww * 0.78, wh * 0.62); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore()
      }
      continue
    }
    const pad = ex.ammoId ? projectileArtDef(ex.ammoId) : undefined
    const ef = pad ? resolveExplosionFx(pad) : null
    if (pad && ef) { // 粒子爆炸（远行星号式，v2.54 四层增强）：火花/烟尘两组粒子（首见 spawn 一次）+ 统一矢量层
      const firstSeen = !fxSeen.has(ex.id)
      const el = fxElapsed({ id: ex.id, ttl: ex.ttl, max: 0.35 })
      if (firstSeen) { // 火花：向外高速+强 drag+短寿命+亮色+拉丝（速度/寿命 jitter）；烟尘：低速+长寿命+膨胀+暗色+湍流
        const rC = Math.max(0.2, ex.r * ef.visualScale) // 视觉半径（格）；不改变战斗爆炸判定半径
        const inh = ef.inherit * (ex.hspeed ?? 0) // 速度继承速率（事件带命中弹丸速率）
        spawnBurst(fxPool, {
          x: ex.x, y: ex.y, count: ef.sparks, speed: rC * 6, life: 0.5, size: 0.05 * ef.visualScale, color: ef.color, drag: 4, seed: ex.id,
          speedJitter: ef.speedJitter, lifeJitter: ef.lifeJitter, streak: ef.streak === 1, // v2.54 拉丝可关
          dirX: ex.hx, dirY: ex.hy, bias: ef.bias,
          inheritVx: ex.hx !== undefined ? ex.hx * inh : 0, inheritVy: ex.hy !== undefined ? ex.hy * inh : 0,
        })
        spawnBurst(fxPool, {
          x: ex.x, y: ex.y, count: ef.smoke, speed: rC * 1.5, life: 0.9, size: 0.1 * ef.visualScale, color: '#3A3632', drag: 1.5, seed: ex.id + 1, grow: 2, turb: ef.turbulence,
          dirX: ex.hx, dirY: ex.hy, bias: ef.bias,
          inheritVx: ex.hx !== undefined ? ex.hx * inh * 0.5 : 0, inheritVy: ex.hy !== undefined ? ex.hy * inh * 0.5 : 0, // 烟尘继承减半（沉重迟滞）
        })
      }
      drawExplosionLayers(ctx, X, Y, cell, ex, Math.min(1, el / ef.duration), ef, el)
      continue
    }
    // 未配置爆炸特效：维持现有程序化爆炸圈（旧 explosion.png 帧条回退已移除——特效一律以配置为准）
    const k = 1 - ex.ttl / 0.35
    ctx.strokeStyle = '#1A1A18'
    ctx.lineWidth = 2
    ctx.fillStyle = `rgba(217,${140 - Math.floor(k * 60)},45,${0.75 * (1 - k)})`
    ctx.beginPath()
    ctx.arc(X(ex.x), Y(ex.y), Math.max(2, ex.r * cell * (0.4 + 0.6 * k)), 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
  }

  // ---- 非爆炸命中（程序化段优先 → 旧帧条回退 → 现状无特效）----
  for (const im of s.impacts) {
    if (!im.ammoId) continue
    const impactVisualY = im.y - (im.altitude ?? 0)
    const pad = projectileArtDef(im.ammoId)
    const inf = pad ? resolveImpactFx(pad) : null
    if (pad && inf) { // 粒子命中：碎屑飞溅（spikes 个短寿命粒子，首见 spawn 一次）+ 中心亮点一闪（矢量）
      const firstSeen = !fxSeen.has(im.id)
      const el = fxElapsed(im)
      if (firstSeen) {
        const hasDirection = im.hx !== undefined && im.hy !== undefined
        spawnBurst(fxPool, {
          x: im.x, y: impactVisualY, count: inf.spikes, speed: inf.speed, life: inf.life, size: inf.size,
          color: inf.color, drag: inf.drag, seed: im.id, streak: inf.streak === 1,
          dirX: hasDirection ? -im.hx! : undefined, dirY: hasDirection ? -im.hy! : undefined,
          bias: hasDirection ? inf.bias : 0, spread: inf.angle * Math.PI / 180,
        })
      }
      if (el >= inf.duration) continue
      drawImpactFlash(ctx, X, Y, im.x, impactVisualY, el / inf.duration) // 中心亮点一闪（v2.55 走 fxDraw 共用层）
      continue
    }
    // 未配置命中特效：不播放任何效果（旧 impact.png 帧条回退已移除——特效一律以配置为准）
  }

  // ---- 粒子层（空中层；地面层已在载具及行走部件之下先行绘制）----
  if (typeof window !== 'undefined') { (window as unknown as { __tdFx?: number }).__tdFx = fxPool.parts.length } // v1.83 无头探针：存活特效粒子数
  drawParticlePool(ctx, fxPool, X, Y, cell, nowFx)

  // ---- 曳光 / 脉冲射线 ----
  for (const tr of s.tracers) {
    if (tr.pulse) {
      // 瞬时命中曳光：细亮射线（炮口→命中点，ttl 0.07s 闪烁 1–2 帧）
      // v2.7：与持续光束共用 beamArtConfig 分层贴图（素材就绪时）；未就绪回退旧版双描边
      const ba = tr.defId ? beamArtConfig(defOf(tr.defId)) : null
      const glowT = ba?.glow?.status === 'ready' && ba.glow.img ? tintedFx(ba.glow.img, ba.fringeColor) : null
      const coreT = ba?.core?.status === 'ready' && ba.core.img ? tintedFx(ba.core.img, ba.coreColor) : null
      if (ba && (glowT || coreT)) {
        const a = Math.max(0, tr.ttl / 0.07)
        const dxp = X(tr.x2) - X(tr.x1)
        const dyp = Y(tr.y2) - Y(tr.y1)
        const lenPx = Math.hypot(dxp, dyp)
        const w = cell * 0.4
        const scroll = ba.scrollSpeed > 0 ? nowFx * ba.scrollSpeed * (cell / BASE_CELL) : 0
        ctx.save()
        ctx.translate(X(tr.x1), Y(tr.y1))
        ctx.rotate(Math.atan2(dyp, dxp))
        drawBeamLayer(ctx, glowT, ba.fringeColor, lenPx, w, 0.6 * a, scroll, cell / BASE_CELL) // 原生尺寸
        drawBeamLayer(ctx, coreT, ba.coreColor, lenPx, w * 0.5, 0.95 * a, scroll, cell / BASE_CELL)
        const imT = ba.impact?.status === 'ready' && ba.impact.img ? tintedFx(ba.impact.img, ba.coreColor) : null
        if (imT) { // 命中点闪光（默认 glow16；v2.10 尺寸×impactScale）
          const isz = w * 2.2 * ba.impactScale
          ctx.globalCompositeOperation = 'lighter'
          ctx.globalAlpha = a
          ctx.drawImage(imT, lenPx - isz / 2, -isz / 2, isz, isz)
          ctx.globalCompositeOperation = 'source-over'
          ctx.globalAlpha = 1
        }
        ctx.restore()
      } else {
        ctx.strokeStyle = 'rgba(120,210,240,0.85)'
        ctx.lineWidth = 2.5
        ctx.beginPath()
        ctx.moveTo(X(tr.x1), Y(tr.y1))
        ctx.lineTo(X(tr.x2), Y(tr.y2))
        ctx.stroke()
        ctx.strokeStyle = 'rgba(240,252,255,0.95)'
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(X(tr.x1), Y(tr.y1))
        ctx.lineTo(X(tr.x2), Y(tr.y2))
        ctx.stroke()
      }
    } else {
      ctx.strokeStyle = 'rgba(245,233,200,0.85)'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(X(tr.x1), Y(tr.y1))
      ctx.lineTo(X(tr.x2), Y(tr.y2))
      ctx.stroke()
    }
  }

  // ---- 建造预览 ----
  if (ui.ghost) {
    const g = ui.ghost
    ctx.fillStyle = g.ok ? 'rgba(120,160,90,0.4)' : 'rgba(179,57,46,0.4)'
    ctx.fillRect(X(g.x), Y(g.y), g.w * cell, g.h * cell)
    ctx.strokeStyle = g.ok ? '#4A6B3A' : '#B3392E'
    ctx.lineWidth = 2
    ctx.strokeRect(X(g.x), Y(g.y), g.w * cell, g.h * cell)
  }
  if (ui.wallGhost) {
    const g = ui.wallGhost
    ctx.fillStyle = g.ok ? 'rgba(74,107,58,0.45)' : 'rgba(179,57,46,0.4)' // 合法绿 / 非法红
    ctx.fillRect(X(g.x), Y(g.y), cell, cell)
    ctx.strokeStyle = g.ok ? '#4A6B3A' : '#B3392E'
    ctx.lineWidth = 2
    ctx.strokeRect(X(g.x), Y(g.y), cell, cell)
    if (!g.ok && g.reason) { // 非法原因小字（格上方）
      ctx.font = `bold ${Math.max(9, cell * 0.3)}px sans-serif`
      ctx.textAlign = 'center'
      ctx.fillStyle = '#B3392E'
      ctx.strokeStyle = 'rgba(239,235,216,0.9)'
      ctx.lineWidth = 3
      ctx.strokeText(g.reason, X(g.x + 0.5), Y(g.y) - 4)
      ctx.fillText(g.reason, X(g.x + 0.5), Y(g.y) - 4)
      ctx.textAlign = 'left'
    }
  }

  if (runtimeDynamicClipped) ctx.restore()

  // ---- 场景编辑叠加层（draft 编辑内容 + 笔刷幽灵） ----
  if (ui.edit) {
    const eo = ui.edit
    ctx.fillStyle = 'rgba(217,164,65,0.18)'
    const eoSet = new Set(eo.cells)
    for (const k of eo.cells) {
      const [bx, by] = k.split(',').map(Number)
      ctx.fillRect(X(bx), Y(by), cell, cell)
    }
    // 派生墙段实时贴图预览（与战斗渲染同规则：直墙/凸凹角/独立块 + 地面块 + 内角互斥③）
    {
      const wallSetE = new Set<string>()
      for (const k of eo.cells) {
        const [bx, by] = k.split(',').map(Number)
        const seg = !eoSet.has(`${bx - 1},${by}`) || !eoSet.has(`${bx + 1},${by}`) || !eoSet.has(`${bx},${by - 1}`) || !eoSet.has(`${bx},${by + 1}`)
        if (seg) wallSetE.add(k)
      }
      const wAtlas = srcImage('/res/walls/wall01.png')
      const gAtlas = srcImage('/res/walls/ground01.png')
      const notchMapE = new Map<string, { r: number; c: number }>()
      for (const k of eo.cells) {
        const [bx, by] = k.split(',').map(Number)
        if (wallSetE.has(k)) continue
        const t = notchTileAt(bx, by, wallSetE, eoSet)
        if (t) notchMapE.set(k, t)
      }
      const tilesOk = wAtlas.status === 'ready' && gAtlas.status === 'ready' && wAtlas.img !== undefined && gAtlas.img !== undefined
      if (tilesOk) {
        // 里侧格：基地层 ground_top 已垫底，仅叠加内角凹转角
        for (const k of eo.cells) {
          if (wallSetE.has(k)) continue
          const [bx, by] = k.split(',').map(Number)
          const notch = notchMapE.get(k)
          if (notch) ctx.drawImage(wAtlas.img as CanvasImageSource, (notch.c - 1) * 32, (notch.r - 1) * 32, 32, 32, X(bx), Y(by), cell, cell)
        }
        // 墙段格：地面块 + 墙体块
        for (const k of wallSetE) {
          const [bx, by] = k.split(',').map(Number)
          const pick = classifyWallTile(bx, by, wallSetE, eoSet, notchMapE)
          if (pick.ground) ctx.drawImage(gAtlas.img as CanvasImageSource, (pick.ground.col - 1) * 32, (pick.ground.row - 1) * 32, 32, 32, X(bx), Y(by), cell, cell)
          ctx.drawImage(wAtlas.img as CanvasImageSource, (pick.wall.c - 1) * 32, (pick.wall.r - 1) * 32, 32, 32, X(bx), Y(by), cell, cell)
        }
      } else { // 图集未就绪退回灰底描边
        ctx.fillStyle = 'rgba(155,148,132,0.45)'
        ctx.strokeStyle = '#1A1A18'
        ctx.lineWidth = 2
        for (const k of wallSetE) {
          const [bx, by] = k.split(',').map(Number)
          ctx.fillRect(X(bx), Y(by), cell, cell)
          ctx.strokeRect(X(bx) + 1, Y(by) + 1, cell - 2, cell - 2)
        }
      }
    }
    drawTerrainDefinitions(eo.terrain, true)
    const editorObjects = [...eo.objects]
    const editorObjectAutotiles = new Map<string, Set<string>>()
    for (const o of editorObjects) {
      const def = objectTypeById(o.defId)
      const sheetKind = def?.asset ? getAsset(def.asset)?.tileSheet?.kind : undefined
      if (sheetKind !== 'autotileStatic' && sheetKind !== 'autotileAnimated') continue
      const key = `${o.renderLayer ?? 3}:${o.defId ?? o.kind}`
      const cells = editorObjectAutotiles.get(key) ?? new Set<string>()
      cells.add(`${Math.floor(o.x)},${Math.floor(o.y)}`)
      editorObjectAutotiles.set(key, cells)
    }
    const drawEditorObject = (o: (typeof editorObjects)[number]) => {
      ctx.save()
      if (o.preview) ctx.globalAlpha = 0.62
      const typeDef = objectTypeById(o.defId)
      const sheetKind = typeDef?.asset ? getAsset(typeDef.asset)?.tileSheet?.kind : undefined
      const art = typeDef?.asset ? assetImage(typeDef.asset) : null
      if ((sheetKind === 'autotileStatic' || sheetKind === 'autotileAnimated') && art?.status === 'ready' && art.img) {
        const cells = editorObjectAutotiles.get(`${o.renderLayer ?? 3}:${o.defId ?? o.kind}`) ?? new Set([`${Math.floor(o.x)},${Math.floor(o.y)}`])
        const previousSmoothing = ctx.imageSmoothingEnabled
        ctx.imageSmoothingEnabled = false
        drawRmxpAutotileCell(ctx, art.img, cells, Math.floor(o.x), Math.floor(o.y), X, Y, cell / 2, rmxpAnimationFrameX(art.img))
        ctx.imageSmoothingEnabled = previousSmoothing
        ctx.restore()
        return
      }
      ctx.fillStyle = typeDef?.color ?? (o.kind === 'barrel' ? 'rgba(160,92,72,0.85)' : o.kind === 'ruins' ? 'rgba(90,86,78,0.85)' : 'rgba(122,114,100,0.85)')
      ctx.fillRect(X(o.x), Y(o.y), o.w * cell, o.h * cell)
      if (art?.status === 'ready' && art.img) {
        ctx.save()
        ctx.translate(X(o.x + o.w / 2), Y(o.y + o.h / 2))
        ctx.rotate(((o as { rotation?: number }).rotation ?? 0) * Math.PI / 180)
        ctx.scale((o as { flipX?: boolean }).flipX ? -1 : 1, 1)
        ctx.drawImage(art.img as CanvasImageSource, -o.w * cell / 2, -o.h * cell / 2, o.w * cell, o.h * cell)
        ctx.restore()
      }
      ctx.strokeStyle = '#1A1A18'
      ctx.lineWidth = 1
      ctx.strokeRect(X(o.x), Y(o.y), o.w * cell, o.h * cell)
      ctx.restore()
    }
    const drawEditorObjectShadow = (o: (typeof editorObjects)[number]) => {
      const typeDef = objectTypeById(o.defId)
      const sheetKind = typeDef?.asset ? getAsset(typeDef.asset)?.tileSheet?.kind : undefined
      const art = typeDef?.asset ? assetImage(typeDef.asset) : null
      const centerX = X(o.x + o.w / 2)
      const centerY = Y(o.y + o.h / 2)
      ctx.save()
      if (o.preview) ctx.globalAlpha *= 0.62
      drawGroundEntityShadow(ctx, typeDef?.height ?? 0, cell, centerX, centerY, 0, false, false, () => {
        if ((sheetKind === 'autotileStatic' || sheetKind === 'autotileAnimated') && art?.status === 'ready' && art.img) {
          const cells = editorObjectAutotiles.get(`${o.renderLayer ?? 3}:${o.defId ?? o.kind}`) ?? new Set([`${Math.floor(o.x)},${Math.floor(o.y)}`])
          const silhouette = tintedFx(art.img, '#000000')
          const localX = (value: number) => X(value) - centerX
          const localY = (value: number) => Y(value) - centerY
          drawRmxpAutotileCell(ctx, silhouette ?? art.img, cells, Math.floor(o.x), Math.floor(o.y), localX, localY, cell / 2, rmxpAnimationFrameX(art.img))
          return
        }
        if (art?.status === 'ready' && art.img) {
          const silhouette = tintedFx(art.img, '#000000')
          ctx.save()
          ctx.rotate((o.rotation ?? 0) * Math.PI / 180)
          ctx.scale(o.flipX ? -1 : 1, 1)
          ctx.drawImage(silhouette ?? art.img, -o.w * cell / 2, -o.h * cell / 2, o.w * cell, o.h * cell)
          ctx.restore()
        } else {
          ctx.fillStyle = '#000000'
          if (o.kind === 'barrel') {
            ctx.beginPath(); ctx.arc(0, 0, cell * 0.32, 0, Math.PI * 2); ctx.fill()
          } else ctx.fillRect(-o.w * cell / 2, -o.h * cell / 2, o.w * cell, o.h * cell)
        }
      })
      ctx.restore()
    }
    for (const [z, color, label] of [[eo.startZone, '#3E7D46', '起点']] as const) {
      ctx.fillStyle = `${color}33`
      ctx.fillRect(X(z.x), Y(z.y), z.w * cell, z.h * cell)
      ctx.strokeStyle = color
      ctx.lineWidth = 2
      ctx.setLineDash([6, 4])
      ctx.strokeRect(X(z.x), Y(z.y), z.w * cell, z.h * cell)
      ctx.setLineDash([])
      ctx.fillStyle = color
      ctx.font = `bold ${Math.max(10, cell * 0.38)}px sans-serif`
      ctx.textAlign = 'left'
      ctx.fillText(label, X(z.x) + 4, Y(z.y) + Math.max(12, cell * 0.45))
    }
    if (eo.finishCells.length > 0) {
      const color = '#D9A441'
      const cells = new Set(eo.finishCells)
      ctx.fillStyle = `${color}33`
      for (const key of cells) {
        const [x, y] = key.split(',').map(Number)
        ctx.fillRect(X(x), Y(y), cell, cell)
      }
      ctx.strokeStyle = color
      ctx.lineWidth = 2
      ctx.setLineDash([6, 4])
      ctx.beginPath()
      for (const key of cells) {
        const [x, y] = key.split(',').map(Number)
        const left = X(x), top = Y(y), right = left + cell, bottom = top + cell
        if (!cells.has(`${x},${y - 1}`)) { ctx.moveTo(left, top); ctx.lineTo(right, top) }
        if (!cells.has(`${x + 1},${y}`)) { ctx.moveTo(right, top); ctx.lineTo(right, bottom) }
        if (!cells.has(`${x},${y + 1}`)) { ctx.moveTo(right, bottom); ctx.lineTo(left, bottom) }
        if (!cells.has(`${x - 1},${y}`)) { ctx.moveTo(left, bottom); ctx.lineTo(left, top) }
      }
      ctx.stroke()
      ctx.setLineDash([])
      ctx.fillStyle = color
      ctx.font = `bold ${Math.max(10, cell * 0.38)}px sans-serif`
      ctx.textAlign = 'left'
      const [x, y] = eo.finishCells[0].split(',').map(Number)
      ctx.fillText('终点', X(x) + 4, Y(y) + Math.max(12, cell * 0.45))
    }
    for (const t of eo.triggers) {
      const color = t.enabled ? '#B3392E' : '#777269'
      ctx.fillStyle = `${color}${t.selected ? '42' : '24'}`
      ctx.fillRect(X(t.x), Y(t.y), t.w * cell, t.h * cell)
      ctx.strokeStyle = color
      ctx.lineWidth = t.selected ? 3 : 2
      ctx.setLineDash(t.selected ? [8, 3] : [5, 4])
      ctx.strokeRect(X(t.x), Y(t.y), t.w * cell, t.h * cell)
      ctx.setLineDash([])
      ctx.fillStyle = color
      ctx.font = `bold ${Math.max(10, cell * 0.34)}px sans-serif`
      ctx.textAlign = 'left'
      ctx.fillText(`伏击 · ${t.name}`, X(t.x) + 4, Y(t.y) + Math.max(12, cell * 0.42))
    }
    for (const region of eo.spawnRegions) {
      if (region.cells.length === 0) continue
      const hue = (region.id * 67 + 18) % 360
      const color = `hsl(${hue} 72% 42%)`
      const cells = new Set(region.cells)
      ctx.fillStyle = `hsl(${hue} 72% 42% / ${region.selected ? 0.28 : 0.15})`
      for (const key of cells) {
        const [x, y] = key.split(',').map(Number)
        ctx.fillRect(X(x), Y(y), cell, cell)
      }
      ctx.strokeStyle = color
      ctx.lineWidth = region.selected ? 3 : 2
      ctx.setLineDash(region.selected ? [8, 3] : [5, 4])
      ctx.beginPath()
      for (const key of cells) {
        const [x, y] = key.split(',').map(Number)
        const left = X(x), top = Y(y), right = left + cell, bottom = top + cell
        if (!cells.has(`${x},${y - 1}`)) { ctx.moveTo(left, top); ctx.lineTo(right, top) }
        if (!cells.has(`${x + 1},${y}`)) { ctx.moveTo(right, top); ctx.lineTo(right, bottom) }
        if (!cells.has(`${x},${y + 1}`)) { ctx.moveTo(right, bottom); ctx.lineTo(left, bottom) }
        if (!cells.has(`${x - 1},${y}`)) { ctx.moveTo(left, bottom); ctx.lineTo(left, top) }
      }
      ctx.stroke(); ctx.setLineDash([])
      const points = region.cells.map(key => { const [x, y] = key.split(',').map(Number); return { x, y } })
      const centerX = points.reduce((sum, point) => sum + point.x + 0.5, 0) / points.length
      const centerY = points.reduce((sum, point) => sum + point.y + 0.5, 0) / points.length
      const anchor = points.reduce((best, point) => {
        const distance = (point.x + 0.5 - centerX) ** 2 + (point.y + 0.5 - centerY) ** 2
        return distance < best.distance ? { point, distance } : best
      }, { point: points[0], distance: Number.POSITIVE_INFINITY }).point
      ctx.save(); ctx.font = `bold ${Math.max(10, Math.min(14, cell * 0.36))}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round'; ctx.strokeStyle = 'rgba(239,235,216,0.94)'; ctx.lineWidth = Math.max(2, cell * 0.1)
      const label = `出生区域 ${region.id}`, labelX = X(anchor.x + 0.5), labelY = Y(anchor.y + 0.5)
      ctx.strokeText(label, labelX, labelY); ctx.fillStyle = color; ctx.fillText(label, labelX, labelY); ctx.restore()
    }
    for (const event of eo.events) {
      const color = event.enabled ? '#8A5C9E' : '#777269'
      const cells = new Set(event.cells)
      ctx.fillStyle = `${color}${event.selected ? '46' : '24'}`
      for (const key of cells) {
        const [x, y] = key.split(',').map(Number)
        ctx.fillRect(X(x), Y(y), cell, cell)
      }

      // 共享边不绘制，只保留整块事件区域的最外围轮廓。
      ctx.strokeStyle = color
      ctx.lineWidth = event.selected ? 2.5 : 1.5
      ctx.setLineDash(event.selected ? [7, 3] : [4, 4])
      ctx.beginPath()
      for (const key of cells) {
        const [x, y] = key.split(',').map(Number)
        const left = X(x); const top = Y(y); const right = left + cell; const bottom = top + cell
        if (!cells.has(`${x},${y - 1}`)) { ctx.moveTo(left, top); ctx.lineTo(right, top) }
        if (!cells.has(`${x + 1},${y}`)) { ctx.moveTo(right, top); ctx.lineTo(right, bottom) }
        if (!cells.has(`${x},${y + 1}`)) { ctx.moveTo(right, bottom); ctx.lineTo(left, bottom) }
        if (!cells.has(`${x - 1},${y}`)) { ctx.moveTo(left, bottom); ctx.lineTo(left, top) }
      }
      ctx.stroke()
      ctx.setLineDash([])

      // 与地形名称相同：四方向连通的每块独立区域各显示一次事件名。
      const remaining = new Set(cells)
      while (remaining.size > 0) {
        const first = remaining.values().next().value
        if (typeof first !== 'string') break
        const stack = [first]
        const component: { x: number; y: number }[] = []
        remaining.delete(first)
        while (stack.length > 0) {
          const key = stack.pop()!
          const [x, y] = key.split(',').map(Number)
          component.push({ x, y })
          for (const neighbor of [`${x - 1},${y}`, `${x + 1},${y}`, `${x},${y - 1}`, `${x},${y + 1}`]) {
            if (!remaining.delete(neighbor)) continue
            stack.push(neighbor)
          }
        }
        const centerX = component.reduce((sum, point) => sum + point.x + 0.5, 0) / component.length
        const centerY = component.reduce((sum, point) => sum + point.y + 0.5, 0) / component.length
        const anchor = component.reduce((best, point) => {
          const distance = (point.x + 0.5 - centerX) ** 2 + (point.y + 0.5 - centerY) ** 2
          return distance < best.distance ? { point, distance } : best
        }, { point: component[0], distance: Number.POSITIVE_INFINITY }).point
        const minX = Math.min(...component.map(point => point.x))
        const maxX = Math.max(...component.map(point => point.x))

        ctx.save()
        ctx.font = `bold ${Math.max(10, Math.min(14, cell * 0.36))}px sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.lineJoin = 'round'
        ctx.strokeStyle = 'rgba(239,235,216,0.94)'
        ctx.lineWidth = Math.max(2, cell * 0.1)
        const labelX = X(anchor.x + 0.5)
        const labelY = Y(anchor.y + 0.5)
        const maxWidth = Math.max(cell - 6, (maxX - minX + 1) * cell - 8)
        ctx.strokeText(event.name, labelX, labelY, maxWidth)
        ctx.fillStyle = color
        ctx.fillText(event.name, labelX, labelY, maxWidth)
        ctx.restore()
      }
    }
    for (const route of eo.routes) {
      const owner = eo.units.find(unit => unit.id === route.unitId)
      if (!owner || route.points.length === 0) continue
      ctx.save()
      ctx.strokeStyle = route.selected ? '#B3392E' : 'rgba(55,52,46,0.5)'
      ctx.fillStyle = route.selected ? '#D9A441' : '#C7BE91'
      ctx.lineWidth = route.selected ? Math.max(2, cell * 0.08) : Math.max(1, cell * 0.05)
      ctx.setLineDash(route.selected ? [Math.max(3, cell * 0.18), Math.max(2, cell * 0.1)] : [3, 3])
      ctx.beginPath()
      ctx.moveTo(X(owner.x), Y(owner.y))
      for (const point of route.points) ctx.lineTo(X(point.x), Y(point.y))
      if (route.points.length > 1) ctx.lineTo(X(route.points[0].x), Y(route.points[0].y))
      ctx.stroke()
      ctx.setLineDash([])
      ctx.font = `bold ${Math.max(8, Math.min(12, cell * 0.32))}px sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      route.points.forEach((point, index) => {
        const px = X(point.x), py = Y(point.y)
        ctx.beginPath()
        ctx.arc(px, py, Math.max(6, cell * 0.22), 0, Math.PI * 2)
        ctx.fill()
        ctx.strokeStyle = '#1A1A18'
        ctx.lineWidth = 1.5
        ctx.stroke()
        ctx.fillStyle = '#1A1A18'
        ctx.fillText(String(index + 1), px, py + 0.5)
        ctx.fillStyle = route.selected ? '#D9A441' : '#C7BE91'
      })
      ctx.restore()
    }
    const drawEditorUnit = (u: (typeof eo.units)[number], shadowOnly = false) => {
      const px = X(u.x)
      const py = Y(u.y)
      const color = u.faction === 'enemy' ? '#B3392E' : u.faction === 'player' ? '#D9A441' : u.faction === 'neutral' ? '#777269' : u.faction === 'neutralHostile' ? '#8A5C9E' : '#3E7D46'
      const body = fortressSprite(u.bodyAsset)
      const unit = unitDefById(u.unitDefId)
      ctx.save()
      ctx.globalAlpha = u.preview ? 0.62 : 0.9
      const unitPlatform = unit?.legacy?.registry === 'fortress' ? unit.legacy.def : unit?.vehiclePlatform
      if (unit && unitPlatform) {
        const vehicleDef = unitPlatform
        const localCenter = fortressLocalCenter(vehicleDef)
        const heading = (u.rotation ?? 0) * Math.PI / 180
        const turrets: Turret[] = vehicleDef.hardpoints.flatMap((hardpoint, index) => {
          if (!hardpoint.builtIn) return []
          const turretDef = TURRET_DEFS.find(item => item.id === hardpoint.builtIn)
          if (!turretDef || turretDef.mount !== hardpoint.size || (hardpoint.types && !hardpoint.types.includes(turretDef.type))) return []
          const hardpointX = u.flipX ? vehicleDef.w - hardpoint.x : hardpoint.x
          const hardpointFixed = hardpoint.fixed === undefined ? undefined : u.flipX ? -hardpoint.fixed : hardpoint.fixed
          const ox = hardpointX - localCenter.x
          const oy = hardpoint.y - localCenter.y
          const c = Math.cos(heading), sn = Math.sin(heading)
          const wx = u.x + ox * c - oy * sn
          const wy = u.y + ox * sn + oy * c
          return [{
            id: -2_100_000 - u.id * 100 - index, defId: turretDef.id,
            x: wx - turretDef.w / 2, y: wy - turretDef.h / 2, w: turretDef.w, h: turretDef.h,
            level: 1, hp: turretDef.hp, maxHp: turretDef.hp,
            angle: heading + (hardpointFixed ?? 0) * Math.PI / 180,
            cooldown: 0, burstLeft: 0, burstTimer: 0,
            rackLeft: turretDef.type === 'missile' ? Math.max(1, turretDef.burst ?? 1) : 0,
            rackAnim: 0, rackTimer: 0, chargeLeft: 0,
            firing: false, firingLeft: 0, tickTimer: 0,
            targetId: null, barrelIdx: 0, hardpointId: hardpoint.id, builtIn: true,
          }]
        })
        const armor = structuredClone(vehicleDef.armor ?? { front: 0, rear: 0, left: 0, right: 0 })
        const previewEnemy: Enemy = {
          id: -2_000_000 - u.id, kind: enemyKindForUnit(unit), unitDefId: unit.id,
          x: u.x, y: u.y, hp: unit.stats.hp, maxHp: unit.stats.hp,
          mode: 'move', targetKind: null, targetId: null, goalX: u.x, goalY: u.y,
          hasGoal: false, pathVersion: -1, attackedBy: [], dots: [], hitFlash: 0,
          flipX: u.flipX,
          vehicle: {
            heading, vx: 0, vy: 0, steerAngle: 0, turnW: 0,
            heat: 0, overheated: false, heatCap: Math.max(1, vehicleDef.heatCap), heatDissipation: Math.max(0, vehicleDef.heatDissipation),
            trackPhase: [], armor, maxArmor: structuredClone(armor), turrets,
          },
        }
        const collision = unitCollisionRadii(unit)
        drawEnemy(ctx, s, previewEnemy, px, py, Math.max(collision.x, collision.y) * cell, cell, s.time, shadowOnly ? 'only' : 'skip')
      } else if (body) {
        const box = centeredRect(0, 0, u.width * cell, u.height * cell)
        const heading = (u.rotation ?? 0) * Math.PI / 180
        if (shadowOnly) {
          const silhouette = tintedFx(body, '#000000')
          const drawSilhouette = () => drawUnitBody(ctx, body, u.bodyAsset, 'walk', box, silhouette ?? body)
          const config = unit ? unitTypeConfig(unit) : undefined
          const altitude = config?.kind === 'rotorcraft' || config?.kind === 'fixedWingAircraft' ? config.altitude : 0
          if (unit?.stats.air) drawAirUnitShadow(ctx, unit, altitude, cell, px, py, heading, u.flipX === true, drawSilhouette)
          else drawGroundEntityShadow(ctx, 0, cell, px, py, heading, u.flipX === true, unitUsesFlattenedShadow(unit), drawSilhouette)
        } else {
          ctx.translate(px, py)
          ctx.rotate(heading)
          ctx.scale(u.flipX ? -1 : 1, 1)
          ctx.imageSmoothingEnabled = false
          if (unit) drawUnitRotors(ctx, unit, 'below', cell, s.time)
          drawUnitBody(ctx, body, u.bodyAsset, 'walk', box)
          if (unit) drawUnitRotors(ctx, unit, 'above', cell, s.time)
        }
      } else {
        const heading = (u.rotation ?? 0) * Math.PI / 180
        const radius = Math.max(4, u.size * cell)
        if (shadowOnly) {
          const drawSilhouette = () => { ctx.fillStyle = '#000000'; ctx.beginPath(); ctx.arc(0, 0, radius, 0, Math.PI * 2); ctx.fill() }
          const config = unit ? unitTypeConfig(unit) : undefined
          const altitude = config?.kind === 'rotorcraft' || config?.kind === 'fixedWingAircraft' ? config.altitude : 0
          if (unit?.stats.air) drawAirUnitShadow(ctx, unit, altitude, cell, px, py, heading, u.flipX === true, drawSilhouette)
          else drawGroundEntityShadow(ctx, 0, cell, px, py, heading, u.flipX === true, unitUsesFlattenedShadow(unit), drawSilhouette)
        } else {
          if (unit) {
            ctx.save()
            ctx.translate(px, py)
            ctx.rotate(heading)
            ctx.scale(u.flipX ? -1 : 1, 1)
            drawUnitRotors(ctx, unit, 'below', cell, s.time)
            ctx.restore()
          }
          ctx.fillStyle = color
          ctx.strokeStyle = '#1A1A18'
          ctx.lineWidth = 2
          ctx.beginPath()
          ctx.arc(px, py, radius, 0, Math.PI * 2)
          ctx.fill()
          ctx.stroke()
          if (unit) {
            ctx.save()
            ctx.translate(px, py)
            ctx.rotate(heading)
            ctx.scale(u.flipX ? -1 : 1, 1)
            drawUnitRotors(ctx, unit, 'above', cell, s.time)
            ctx.restore()
          }
        }
      }
      if (!shadowOnly && !u.preview) {
        ctx.globalAlpha = 1
        ctx.strokeStyle = color
        ctx.lineWidth = u.selected ? 3 : 1.5
        ctx.setLineDash(u.selected ? [5, 3] : [])
        const outline = centeredRect(px, py, Math.max(u.footprintW * cell, u.width * cell), Math.max(u.footprintH * cell, u.height * cell))
        ctx.strokeRect(outline.x, outline.y, outline.w, outline.h)
        ctx.setLineDash([])
        ctx.fillStyle = color
        ctx.font = `bold ${Math.max(9, cell * 0.3)}px sans-serif`
        ctx.textAlign = 'center'
        ctx.fillText(`${{ player: '己方', ally: '友方', enemy: '敌方', neutral: '中立', neutralHostile: '中立敌对' }[u.faction]} · ${u.name}`, px, outline.y - 3)
      }
      ctx.restore()
    }
    const editorSceneItems: SceneRenderItem[] = [
      ...editorObjects.map((object, order) => ({ layer: object.renderLayer ?? 3, x: object.x, y: object.y, kind: 'object' as const, order, draw: () => drawEditorObject(object) })),
      ...eo.units.map((unit, index) => {
        const def = unitDefById(unit.unitDefId)
        const config = def ? unitTypeConfig(def) : undefined
        const airborne = def?.stats.air ?? false
        const altitude = config?.kind === 'rotorcraft' || config?.kind === 'fixedWingAircraft' ? config.altitude : 0
        return { layer: 3, x: unit.x, y: unit.y, kind: 'unit' as const, airborne, altitude, order: editorObjects.length + index, draw: () => drawEditorUnit(unit) }
      }),
    ]
    editorSceneItems.sort(compareSceneRenderItems)
    if (gameParameters().showEntityShadows) {
      for (const object of editorObjects) drawEditorObjectShadow(object)
      for (const unit of eo.units) drawEditorUnit(unit, true)
    }
    for (const item of editorSceneItems) item.draw()
    if (eo.fortressDefense) {
      const defense = eo.fortressDefense
      ctx.save()
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.font = `900 ${Math.max(8, Math.min(12, cell * 0.3))}px sans-serif`
      const returning = defense.selectedTarget?.kind === 'return'
      const rx = X(defense.returnPoint.x)
      const ry = Y(defense.returnPoint.y)
      const radius = cell * 0.34
      ctx.beginPath()
      ctx.moveTo(rx, ry - radius)
      ctx.lineTo(rx + radius, ry)
      ctx.lineTo(rx, ry + radius)
      ctx.lineTo(rx - radius, ry)
      ctx.closePath()
      ctx.fillStyle = returning ? 'rgba(179,57,46,0.38)' : 'rgba(62,125,70,0.34)'
      ctx.fill()
      ctx.strokeStyle = returning ? '#B3392E' : '#3E7D46'
      ctx.lineWidth = returning ? Math.max(3, cell * 0.08) : Math.max(2, cell * 0.06)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(rx - radius * 0.48, ry)
      ctx.lineTo(rx + radius * 0.48, ry)
      ctx.moveTo(rx, ry - radius * 0.48)
      ctx.lineTo(rx, ry + radius * 0.48)
      ctx.stroke()
      ctx.lineJoin = 'round'
      ctx.lineWidth = Math.max(3, cell * 0.1)
      ctx.strokeStyle = 'rgba(239,235,216,0.95)'
      ctx.strokeText('返回位置', rx, ry - radius - Math.max(7, cell * 0.2))
      ctx.fillStyle = returning ? '#B3392E' : '#3E7D46'
      ctx.fillText('返回位置', rx, ry - radius - Math.max(7, cell * 0.2))
      ctx.restore()
    }
    if (eo.showHeight) {
      const colors = ['', '#D9A441', '#D97A32', '#B3392E']
      const autotileHeightGroups = new Map<string, { height: number; color: string; cells: Set<string> }>()
      for (const object of editorObjects) {
        const def = objectTypeById(object.defId)
        if (!(object.blockProjectile ?? def?.blockProjectile) || object.preview) continue
        const height = Math.max(0, Math.min(3, Math.round(object.height ?? def?.height ?? 0)))
        if (height === 0) continue
        const color = colors[height]
        const sheetKind = def?.asset ? getAsset(def.asset)?.tileSheet?.kind : undefined
        if (sheetKind === 'autotileStatic' || sheetKind === 'autotileAnimated') {
          const key = `${object.defId ?? object.kind}:${height}`
          const group = autotileHeightGroups.get(key) ?? { height, color, cells: new Set<string>() }
          group.cells.add(`${Math.floor(object.x)},${Math.floor(object.y)}`)
          autotileHeightGroups.set(key, group)
          continue
        }
        ctx.save()
        ctx.fillStyle = `${color}55`
        ctx.strokeStyle = color
        ctx.lineWidth = 2
        ctx.fillRect(X(object.x), Y(object.y), object.w * cell, object.h * cell)
        ctx.strokeRect(X(object.x) + 1, Y(object.y) + 1, object.w * cell - 2, object.h * cell - 2)
        ctx.fillStyle = color
        ctx.font = `bold ${Math.max(10, cell * 0.4)}px sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(String(height), X(object.x + object.w / 2), Y(object.y + object.h / 2))
        ctx.restore()
      }
      for (const group of autotileHeightGroups.values()) {
        ctx.save()
        ctx.fillStyle = `${group.color}55`
        for (const key of group.cells) {
          const [x, y] = key.split(',').map(Number)
          ctx.fillRect(X(x), Y(y), cell, cell)
        }
        // Autotile 的共享边不绘制，只保留每块四方向连通区域的外围轮廓。
        ctx.strokeStyle = group.color
        ctx.lineWidth = 2
        ctx.beginPath()
        for (const key of group.cells) {
          const [x, y] = key.split(',').map(Number)
          const left = X(x), top = Y(y), right = left + cell, bottom = top + cell
          if (!group.cells.has(`${x},${y - 1}`)) { ctx.moveTo(left, top); ctx.lineTo(right, top) }
          if (!group.cells.has(`${x + 1},${y}`)) { ctx.moveTo(right, top); ctx.lineTo(right, bottom) }
          if (!group.cells.has(`${x},${y + 1}`)) { ctx.moveTo(right, bottom); ctx.lineTo(left, bottom) }
          if (!group.cells.has(`${x - 1},${y}`)) { ctx.moveTo(left, bottom); ctx.lineTo(left, top) }
        }
        ctx.stroke()

        const remaining = new Set(group.cells)
        ctx.fillStyle = group.color
        ctx.font = `bold ${Math.max(10, cell * 0.4)}px sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        while (remaining.size > 0) {
          const first = remaining.values().next().value as string
          const queue = [first]
          remaining.delete(first)
          let sumX = 0, sumY = 0, count = 0
          while (queue.length > 0) {
            const current = queue.shift()!
            const [x, y] = current.split(',').map(Number)
            sumX += x + 0.5; sumY += y + 0.5; count++
            for (const neighbor of [`${x + 1},${y}`, `${x - 1},${y}`, `${x},${y + 1}`, `${x},${y - 1}`]) {
              if (!remaining.delete(neighbor)) continue
              queue.push(neighbor)
            }
          }
          ctx.fillText(String(group.height), X(sumX / count), Y(sumY / count))
        }
        ctx.restore()
      }
    }
    // 中心位置始终写在中心地格内；描边保证在明暗素材上均可辨认。
    ctx.save()
    ctx.font = `bold ${Math.max(8, cell * 0.28)}px sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.lineJoin = 'round'
    ctx.lineWidth = Math.max(2, cell * 0.08)
    ctx.strokeStyle = 'rgba(26,26,24,0.9)'
    ctx.strokeText('中心', X(eo.centerCell.x + 0.5), Y(eo.centerCell.y + 0.5))
    ctx.fillStyle = '#EFEBD8'
    ctx.fillText('中心', X(eo.centerCell.x + 0.5), Y(eo.centerCell.y + 0.5))
    ctx.restore()

    if (eo.tileSelection) {
      const selected = eo.tileSelection
      ctx.fillStyle = 'rgba(179,57,46,0.14)'
      ctx.fillRect(X(selected.x), Y(selected.y), selected.w * cell, selected.h * cell)
      ctx.strokeStyle = '#B3392E'
      ctx.lineWidth = 2.5
      ctx.setLineDash([6, 3])
      ctx.strokeRect(X(selected.x) + 1, Y(selected.y) + 1, selected.w * cell - 2, selected.h * cell - 2)
      ctx.setLineDash([])
    }
    for (const selected of eo.selections ?? (eo.selection ? [eo.selection] : [])) {
      ctx.strokeStyle = '#B3392E'
      ctx.lineWidth = 2.5
      ctx.setLineDash([6, 3])
      ctx.strokeRect(X(selected.x) + 1, Y(selected.y) + 1, selected.w * cell - 2, selected.h * cell - 2)
      ctx.setLineDash([])
    }
    if (eo.selectionArea) {
      const area = eo.selectionArea
      ctx.fillStyle = 'rgba(62,125,70,0.12)'
      ctx.fillRect(X(area.x), Y(area.y), area.w * cell, area.h * cell)
      ctx.strokeStyle = '#3E7D46'
      ctx.lineWidth = 2
      ctx.setLineDash([4, 3])
      ctx.strokeRect(X(area.x), Y(area.y), area.w * cell, area.h * cell)
      ctx.setLineDash([])
    }
    if (eo.hover) {
      const h = eo.hover
      if (h.ghost) {
        ctx.fillStyle = h.ok ? 'rgba(239,235,216,0.18)' : 'rgba(179,57,46,0.18)'
        ctx.fillRect(X(h.x), Y(h.y), h.w * cell, h.h * cell)
      }
      ctx.strokeStyle = h.ok ? '#3E7D46' : '#B3392E'
      ctx.lineWidth = 2
      ctx.strokeRect(X(h.x) + 1, Y(h.y) + 1, h.w * cell - 2, h.h * cell - 2)
    }
  }

  // ---- 近距离事件交互气泡（编辑模式不显示运行时提示） ----
  if (!ui.edit) for (const bubble of interactionBubbles(s)) {
    if (!pointInBattleVision(bubble.x, bubble.y)) continue
    const tailX = X(bubble.x)
    const tailY = Y(bubble.y) - 4
    const pulse = 1 + Math.sin(s.time * 4 + bubble.id) * 0.04
    const bw = 26 * pulse
    const bh = 20 * pulse
    const bx = tailX - bw / 2
    const by = tailY - bh - 9
    ctx.save()
    ctx.fillStyle = '#F3EDCE'
    ctx.strokeStyle = '#1A1A18'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.roundRect(bx, by, bw, bh, 5)
    ctx.fill()
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(tailX - 4, by + bh - 1)
    ctx.lineTo(tailX, tailY)
    ctx.lineTo(tailX + 5, by + bh - 1)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = '#1A1A18'
    ctx.font = `bold ${Math.max(12, cell * 0.42)}px sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('…', tailX, by + bh / 2 - 2)
    ctx.restore()
  }

  // ---- 飘字 ----
  ctx.font = `bold ${Math.max(10, cell * 0.36)}px sans-serif`
  ctx.textAlign = 'center'
  const textVisibility = gameParameters()
  for (const f of s.floats) {
    if (!pointInBattleVision(f.x, f.y)) continue
    if (f.visualKind === 'penetration' && !textVisibility.showPenetrationFx) continue
    if (f.visualKind === 'ricochet' && !textVisibility.showRicochetFx) continue
    if (f.visualKind === 'ramming' && !textVisibility.showRammingFx) continue
    ctx.globalAlpha = Math.min(1, f.ttl / 0.4)
    ctx.fillStyle = '#D9A441'
    ctx.strokeStyle = '#1A1A18'
    ctx.lineWidth = 2
    ctx.strokeText(f.text, X(f.x), Y(f.y) - (0.8 - f.ttl) * 20)
    ctx.fillText(f.text, X(f.x), Y(f.y) - (0.8 - f.ttl) * 20)
    ctx.globalAlpha = 1
  }

  if (battleVisionActive) drawBattleVisionOverlay(ctx, battleVisionSources, battleVisionRadius, cell, X, Y, W, H)

  // 敌方单位视野是点击后的 UI 辅助层：仅在单位仍存活且仍处于玩家可见范围时显示，
  // 圆心使用地面逻辑坐标（飞行高度只影响主体贴图），半径读取单位自身的索敌视野。
  if (!ui.edit && ui.selectedEnemyUnit != null) {
    const enemy = s.enemies.find(item => item.id === ui.selectedEnemyUnit && item.hp > 0)
    if (enemy) {
      const unit = runtimeEnemyUnitDef(enemy.unitDefId, enemy.kind)
      const collision = unitCollisionRadii(unit)
      const visible = pointInBattleVision(enemy.x, enemy.y, Math.max(collision.x, collision.y) * (enemy.bossSizeScale ?? 1))
      const radius = Math.max(0, unit.stats.vision ?? 8) * cell
      if (visible && radius > 0) {
        ctx.save()
        ctx.fillStyle = 'rgba(190, 54, 43, 0.075)'
        ctx.strokeStyle = 'rgba(235, 96, 72, 0.92)'
        ctx.lineWidth = Math.max(1.5, cell * 0.055)
        ctx.setLineDash([Math.max(5, cell * 0.24), Math.max(3, cell * 0.13)])
        ctx.beginPath()
        ctx.arc(X(enemy.x), Y(enemy.y), radius, 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()
        ctx.setLineDash([])
        ctx.fillStyle = 'rgba(255, 190, 126, 0.95)'
        ctx.beginPath()
        ctx.arc(X(enemy.x), Y(enemy.y), Math.max(2, cell * 0.085), 0, Math.PI * 2)
        ctx.fill()
        ctx.restore()
      }
    }
  }

  // ---- 编辑器拖动边界提示条（主游戏不再显示长宽位置比例尺） ----
  if (ui.edit) {
    const vis = visibleRows(cell, H)
    if (LEVEL.rows - vis > 0.5) {
      const trackH = H - 16
      const thumbH = Math.max(24, trackH * (vis / LEVEL.rows))
      const maxScroll = LEVEL.rows - vis
      const ty = 8 + (trackH - thumbH) * (viewY / maxScroll)
      ctx.fillStyle = 'rgba(0,0,0,0.25)'
      ctx.fillRect(W - 7, 8, 4, trackH)
      ctx.fillStyle = '#D9A441'
      ctx.fillRect(W - 7, ty, 4, thumbH)
    }
    const visCols = W / cell
    if (LEVEL.cols - visCols > 0.5) {
      const trackW = W - 16
      const thumbW = Math.max(24, trackW * (visCols / LEVEL.cols))
      const maxScroll = LEVEL.cols - visCols
      const tx = 8 + (trackW - thumbW) * (viewX / maxScroll)
      ctx.fillStyle = 'rgba(0,0,0,0.25)'
      ctx.fillRect(8, H - 7, trackW, 4)
      ctx.fillStyle = '#D9A441'
      ctx.fillRect(tx, H - 7, thumbW, 4)
    }
  }
}

/** 全阵营单位绘制：阵营不参与主体、载具层级或无素材占位表现。 */
function drawEnemy(
  ctx: CanvasRenderingContext2D,
  s: GameState,
  e: Enemy,
  px: number,
  py: number,
  r: number,
  cell: number,
  time: number,
  shadowMode: 'inline' | 'only' | 'skip' = 'inline',
) {
  const unit = runtimeEnemyUnitDef(e.unitDefId, e.kind)
  const altitude = currentUnitAltitude(e, unit)
  const visualPy = py - altitude * cell
  const crashing = e.aircraft?.crash !== undefined
  const rotorTime = aircraftRotorVisualTime(time, e.aircraft?.crash)

  // 依据位移速度向量推算朝向（渲染帧间位移）
  const prev = prevPos.get(e.id)
  let dx = 0
  let dy = 0
  if (prev) { dx = e.x - prev.x; dy = e.y - prev.y }
  const moving = Math.abs(dx) + Math.abs(dy) > 1e-4
  let target: { x: number; y: number } | null = null
  if (e.mode === 'attack') {
    if (e.targetKind === 'fortress') {
      const rect = fortressRect(s)
      target = { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 }
    } else if (e.targetKind === 'combatUnit') target = s.allies.find(ally => ally.id === e.targetId) ?? null
    else if (e.targetKind === 'coreBuilding' && s.core) target = { x: s.core.x + s.core.w / 2, y: s.core.y + s.core.h / 2 }
    else if (e.targetKind === 'fixedBuilding') {
      const building = s.buildings.find(item => item.id === e.targetId)
      if (building) target = { x: building.x + building.w / 2, y: building.y + building.h / 2 }
    } else if (e.targetKind === 'wall') {
      const wallCell = s.walls.find(item => item.id === e.targetId)?.cells[0]
      if (wallCell) target = { x: wallCell.x + 0.5, y: wallCell.y + 0.5 }
    }
  }
  const heading = crashing
    ? e.aircraft!.heading
    : target
    ? downFacingAngle(target.x - e.x, target.y - e.y)
    : e.behaviorFacingHome
      ? e.initialHeading ?? 0
      : e.aircraft?.heading ?? (moving ? downFacingAngle(dx, dy) : prev?.heading ?? e.initialHeading ?? 0)
  prevPos.set(e.id, { x: e.x, y: e.y, heading })

  // 统一单位库中的载具作为敌人时，仍按真实载具贴图绘制，
  // 不再降级为其兼容 kind 对应的僵尸精灵。
  const unitPlatform = unit.legacy?.registry === 'fortress' ? unit.legacy.def : unit.vehiclePlatform
  if (unitPlatform) {
    const vehicle = unitPlatform
    const vehicleHeading = e.vehicle?.heading ?? heading
    const bossScale = e.bossSizeScale ?? 1
    const bodyImage = fortressSprite(vehicle.spriteBody)
    const nativeScale = cell / BASE_CELL * bossScale
    const damageFilter = vehicleDamageFilter(e.hp, e.maxHp)
    const enemyView: ViewCtx = {
      cell,
      viewX: e.x - px / cell,
      viewY: e.y - visualPy / cell,
      overheated: false,
    }
    const mounted = e.hp > 0 || crashing ? [...(e.vehicle?.turrets ?? [])].sort((a, b) => {
      const ah = vehicle.hardpoints.find(item => item.id === a.hardpointId)
      const bh = vehicle.hardpoints.find(item => item.id === b.hardpointId)
      const ad = defOf(a.defId), bd = defOf(b.defId)
      const ar = ad.mount === 'L' ? 2 : ad.mount === 'M' ? 1 : 0
      const br = bd.mount === 'L' ? 2 : bd.mount === 'M' ? 1 : 0
      return ar - br || (ah?.zLevel ?? 1) - (bh?.zLevel ?? 1)
    }) : []
    const drawMountedTurret = (turret: Turret) => {
      const hp = vehicle.hardpoints.find(item => item.id === turret.hardpointId)
      ctx.save()
      ctx.filter = damageFilter
      drawTurret(ctx, turret, enemyView, false, s.muzzles, vehicleHeading, hp, cell / BASE_CELL, vehicle.paint?.turret)
      ctx.restore()
    }
    if (shadowMode !== 'skip') {
      const shadowImage = bodyImage ? tintedFx(bodyImage, '#000000') : null
      const drawSilhouette = () => {
        if (bodyImage && shadowImage) drawVehicleImage(ctx, bodyImage, vehicle, nativeScale, e.vehicle?.walkPhase ?? 0, shadowImage, e.vehicle?.walkSettleBlend ?? 0)
        else {
          ctx.fillStyle = '#000000'
          ctx.fillRect(-vehicle.w * cell * bossScale / 2, -vehicle.h * cell * bossScale / 2, vehicle.w * cell * bossScale, vehicle.h * cell * bossScale)
        }
        drawMountedTurretShadowSilhouettes(ctx, vehicle, mounted, vehicleHeading, cell, bossScale)
      }
      ctx.save()
      if (e.hp <= 0 && !crashing) ctx.globalAlpha *= Math.max(0, Math.min(1, (e.deathLeft ?? 0) / 1.1))
      if (unit.stats.air) drawAirUnitShadow(ctx, unit, altitude, cell, px, py, vehicleHeading, e.flipX === true, drawSilhouette)
      else drawGroundEntityShadow(ctx, 0, cell, px, py, vehicleHeading, e.flipX === true, false, drawSilhouette)
      ctx.restore()
    }
    if (shadowMode === 'only') return
    ctx.save()
    if (e.hp <= 0 && !crashing) ctx.globalAlpha = Math.max(0, Math.min(1, (e.deathLeft ?? 0) / 1.1))
    ctx.filter = damageFilter
    ctx.translate(px, visualPy)
    ctx.rotate(vehicleHeading)
    ctx.scale(e.flipX ? -1 : 1, 1)
    ctx.imageSmoothingEnabled = false
    // 所有阵营载具共用：履带/轮胎 → 负层级炮塔 → 载具主体 → 其余炮塔。
    let phaseIndex = 0
    for (const track of vehicle.tracks ?? []) {
      const tile = trackTileImage(track.tile)
      if (!tile) { phaseIndex += 2; continue }
      const tileLen = tile.height / BASE_CELL
      const width = tile.width * nativeScale
      for (const mirror of [false, true]) {
        const phase = e.vehicle?.trackPhase?.[phaseIndex++] ?? 0
        for (const placement of centeredTrackPlacements(vehicle, track, phase, tileLen)) {
          const localX = mirror ? -placement.x : placement.x
          const localY = -placement.y
          const height = tileLen * cell * bossScale * placement.scaleY
          if (height < 0.3) continue
          ctx.save(); ctx.globalAlpha *= placement.alpha; ctx.translate(localX * cell * bossScale, localY * cell * bossScale)
          if (mirror) ctx.scale(-1, 1)
          ctx.drawImage(tile, -width / 2, -height / 2, width, height); ctx.restore()
        }
      }
    }
    for (const wheel of vehicle.wheels ?? []) {
      const image = wheel.sprite ? trackTileImage(wheel.sprite) : null
      const placements = wheelPlacements(vehicle, wheel)
      const frames = wheelFrameCount(wheel)
      const sourceWidth = image ? image.width / frames : 11
      const drawWidth = sourceWidth * nativeScale
      const drawHeight = (image?.height ?? 20) * nativeScale
      for (const placement of placements) {
        const phase = e.vehicle?.trackPhase?.[phaseIndex++] ?? 0
        ctx.save()
        ctx.translate(placement.x * cell * bossScale, -placement.y * cell * bossScale)
        if (wheel.steered) ctx.rotate(e.vehicle?.steerAngle ?? 0)
        if (placement.mirror) ctx.scale(-1, 1)
        if (image) {
          const frame = wheelRollFrame(phase, frames, image.height)
          ctx.drawImage(image, frame * sourceWidth, 0, sourceWidth, image.height, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight)
        } else {
          ctx.fillStyle = '#2A2A28'; ctx.strokeStyle = '#1A1A18'; ctx.lineWidth = 1.5
          ctx.beginPath(); ctx.roundRect(-drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight, drawWidth * 0.35); ctx.fill(); ctx.stroke()
        }
        ctx.restore()
      }
    }
    ctx.restore()
    for (const turret of mounted) {
      const hp = vehicle.hardpoints.find(item => item.id === turret.hardpointId)
      if (hardpointBelowVehicleBody(hp)) drawMountedTurret(turret)
    }
    ctx.save()
    ctx.filter = damageFilter
    ctx.translate(px, visualPy)
    ctx.rotate(vehicleHeading)
    ctx.scale(e.flipX ? -1 : 1, 1)
    ctx.imageSmoothingEnabled = false
    if (unit.stats.air) drawUnitRotors(ctx, unit, 'below', cell, rotorTime, bossScale)
    drawVehicleBodyLayer(ctx, vehicle, bodyImage, nativeScale, cell, bossScale, e.vehicle?.walkPhase ?? 0, e.vehicle?.walkSettleBlend ?? 0)
    if (unit.stats.air) drawUnitRotors(ctx, unit, 'above', cell, rotorTime, bossScale)
    ctx.restore()
    for (const turret of mounted) {
      const hp = vehicle.hardpoints.find(item => item.id === turret.hardpointId)
      if (!hardpointBelowVehicleBody(hp)) drawMountedTurret(turret)
    }
    return
  }

  const body = fortressSprite(unit.visual?.bodyAsset)
  if (body && unit.visual) {
    const bossScale = e.bossSizeScale ?? 1
    const box = unitBodyBox(body, unit.visual, cell, bossScale)
    const bodyState: AssetSpriteState = e.hp <= 0 && !crashing ? 'death' : e.coverHidden ? 'cover' : e.mode === 'attack' ? 'attack' : 'walk'
    if (shadowMode !== 'skip') {
      const shadowImage = tintedFx(body, '#000000')
      const drawSilhouette = () => {
        if (shadowImage) drawUnitBody(ctx, body, unit.visual?.bodyAsset, bodyState, box, shadowImage)
        else {
          ctx.fillStyle = '#000000'
          ctx.fillRect(box.x, box.y, box.w, box.h)
        }
      }
      ctx.save()
      if (e.hp <= 0 && !crashing) ctx.globalAlpha *= Math.max(0, Math.min(1, (e.deathLeft ?? 0) / 1.1))
      if (unit.stats.air) drawAirUnitShadow(ctx, unit, altitude, cell, px, py, heading, e.flipX === true, drawSilhouette)
      else drawGroundEntityShadow(ctx, 0, cell, px, py, heading, e.flipX === true, unitUsesFlattenedShadow(unit), drawSilhouette)
      ctx.restore()
    }
    if (shadowMode === 'only') return
    ctx.save()
    ctx.translate(px, visualPy)
    ctx.rotate(heading)
    ctx.scale(e.flipX ? -1 : 1, 1)
    ctx.imageSmoothingEnabled = false
    drawUnitRotors(ctx, unit, 'below', cell, rotorTime, bossScale)
    drawUnitBody(ctx, body, unit.visual.bodyAsset, bodyState, box)
    drawUnitRotors(ctx, unit, 'above', cell, rotorTime, bossScale)
    ctx.restore()
    return
  }

  // 无素材时只显示与单位类型对应的中性工程占位，不再回落为僵尸、步兵或阵营专属颜色。
  const bossScale = e.bossSizeScale ?? 1
  const halfW = Math.max(r * 0.7, unit.visual?.width ? unit.visual.width * cell * bossScale / 2 : r)
  const halfH = Math.max(r * 0.55, unit.visual?.height ? unit.visual.height * cell * bossScale / 2 : r * 0.75)
  if (shadowMode !== 'skip') {
    const drawSilhouette = () => {
      ctx.fillStyle = '#000000'
      if (unit.type === 'rotorcraft' || unit.type === 'fixedWingAircraft') {
        ctx.beginPath()
        ctx.moveTo(0, -halfH)
        ctx.lineTo(halfW, halfH * 0.65)
        ctx.lineTo(0, halfH * 0.3)
        ctx.lineTo(-halfW, halfH * 0.65)
        ctx.closePath()
        ctx.fill()
      } else ctx.fillRect(-halfW, -halfH, halfW * 2, halfH * 2)
    }
    ctx.save()
    if (e.hp <= 0 && !crashing) ctx.globalAlpha *= Math.max(0, Math.min(1, (e.deathLeft ?? 0) / 1.1))
    if (unit.stats.air) drawAirUnitShadow(ctx, unit, altitude, cell, px, py, heading, e.flipX === true, drawSilhouette)
    else drawGroundEntityShadow(ctx, 0, cell, px, py, heading, e.flipX === true, unitUsesFlattenedShadow(unit), drawSilhouette)
    ctx.restore()
  }
  if (shadowMode === 'only') return
  ctx.save()
  ctx.translate(px, visualPy)
  ctx.rotate(heading)
  ctx.scale(e.flipX ? -1 : 1, 1)
  drawUnitRotors(ctx, unit, 'below', cell, rotorTime, bossScale)
  ctx.fillStyle = e.dots.length > 0 ? '#B3702E' : VEHICLE_PLACEHOLDER_COLOR
  ctx.strokeStyle = '#1A1A18'
  ctx.lineWidth = 2
  if (unit.type === 'rotorcraft' || unit.type === 'fixedWingAircraft') {
    ctx.beginPath()
    ctx.moveTo(0, -halfH)
    ctx.lineTo(halfW, halfH * 0.65)
    ctx.lineTo(0, halfH * 0.3)
    ctx.lineTo(-halfW, halfH * 0.65)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
  } else {
    ctx.beginPath(); ctx.roundRect(-halfW, -halfH, halfW * 2, halfH * 2, Math.min(halfW, halfH) * 0.2); ctx.fill(); ctx.stroke()
  }
  drawUnitRotors(ctx, unit, 'above', cell, rotorTime, bossScale)
  ctx.restore()
}

function drawHpBar(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, ratio: number) {
  if (ratio >= 1) return
  ctx.fillStyle = '#1A1A18'
  ctx.fillRect(x, y, w, 4)
  ctx.fillStyle = ratio < 0.35 ? '#B3392E' : '#D9A441'
  ctx.fillRect(x, y, w * Math.max(0, ratio), 4)
}

/** 炮管序号为界面中的 1-based 序号；这里只接收 0-based 索引。翻转仅作用于贴图，不改变炮口或挂点。 */
export function shouldFlipEvenBarrel(def: TurretDef, barrelIndex: number): boolean {
  return def.art?.flipEvenBarrels === true && barrelIndex >= 0 && barrelIndex % 2 === 1
}

/** 炮口事件首次渲染时刻缓存（表现层状态：后坐/火光按渲染帧时间推进，不进逻辑 state） */
const fxSeen = new Map<number, number>()
/** 每次破盾已发射的外缘锚点；事件回收时与 fxSeen 同步清理。 */
const shieldBreakEmitted = new Map<number, Set<number>>()
function fxElapsed(ev: { id: number; ttl: number; max: number }): number {
  const now = typeof performance !== 'undefined' ? performance.now() : 0
  let t0 = fxSeen.get(ev.id)
  if (t0 === undefined) {
    t0 = now - (ev.max - ev.ttl) * 1000
    fxSeen.set(ev.id, t0)
  }
  return Math.max(0, (now - t0) / 1000)
}

/** 贴图分层渲染（规范 §5.1）：base → turret（绕 anchor 旋转）→ glow（过热）→ barrel × N（挂点对齐 + 后坐） */
/** 绘制单管待发弹（世界坐标 = engine.rackMissilePos 共享定位）：沿炮口向后逐枚排列；
 *  animK<1 时普通导弹渐显并沿尾部推入；垂发导弹固定在挂载位原地渐显。 */
function drawRackMissiles(
  ctx: CanvasRenderingContext2D, v: ViewCtx, t: Turret, def: ReturnType<typeof defOf>,
  bi: number, count: number, ammo: ReturnType<typeof projectileArtDef>, animK: number, newestSlot: number,
  zf = v.cell / BASE_CELL,
) {
  if (count <= 0) return
  const { cell, viewX, viewY } = v
  const st = ammo ? projectileArtState(ammo) : null
  const img = st?.status === 'ready' ? st.assets?.projectile : undefined
  const frame = img && ammo ? projectileBodyFrameRect(ammo, img.naturalWidth, img.naturalHeight, 0) : undefined
  const verticalRack = ammo?.kind === 'missile' && ammo.verticalLaunch?.enabled === true
  const size = frame ? frame.sh * zf : cell * 0.34 // 垂发导弹待发时显示同一素材的首帧；普通贴图仍按原尺寸。
  for (let j = 0; j < count; j++) {
    const k = j === newestSlot ? animK : 1 // 推入动画仅作用最新复挂那枚，其余不受影响
    const pushJ = verticalRack ? 0 : (1 - k) * 0.3 // 垂发弹原位渐显；普通导弹沿尾部方向推入。
    const p = rackMissilePos(t, def, bi, j)
    const px = (p.x - dirX(t.angle) * pushJ - viewX) * cell
    const py = (p.y - dirY(t.angle) * pushJ - viewY) * cell
    ctx.save()
    ctx.globalAlpha *= k // 渐显
    ctx.translate(px, py)
    ctx.rotate(t.angle) // 弹体朝向 = 炮口方向（素材朝上，与炮塔同约定）
    if (img && frame) { // 弹丸贴图；垂发帧条只裁出待发首帧，避免整条素材被拉宽显示。
      const bw = size * (frame.sw / frame.sh)
      ctx.drawImage(img, frame.sx, 0, frame.sw, frame.sh, -bw / 2, -size / 2, bw, size)
    } else { // 几何小导弹：类别色三角 + 尾翼线
      const color = PROJECTILE_KIND_COLOR[ammo?.kind ?? 'missile']
      ctx.fillStyle = color
      ctx.strokeStyle = '#1A1A18'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(0, -size * 0.45)
      ctx.lineTo(-size * 0.16, size * 0.2)
      ctx.lineTo(size * 0.16, size * 0.2)
      ctx.closePath()
      ctx.fill()
      ctx.stroke()
      ctx.beginPath() // 尾翼
      ctx.moveTo(-size * 0.22, size * 0.42)
      ctx.lineTo(-size * 0.1, size * 0.2)
      ctx.moveTo(size * 0.22, size * 0.42)
      ctx.lineTo(size * 0.1, size * 0.2)
      ctx.stroke()
    }
    ctx.restore()
  }
}

function drawTurretLayers(
  ctx: CanvasRenderingContext2D, t: Turret, def: ReturnType<typeof defOf>, v: ViewCtx,
  assets: TurretArtAssets, muzzles: MuzzleEvent[], baseAngle: number, zf: number, tintColor?: string,
) {
  const { cell, viewX, viewY } = v
  const px = (t.x - viewX) * cell
  const py = (t.y - viewY) * cell
  const w = t.w * cell
  const h = t.h * cell
  const F = zf // 原尺寸显示：zoom=1 时 1 贴图像素 = 1 画布像素，随缩放等比变化（编辑器预览 F=1，与之一致）
  const A = BASE_CELL * zf // 美术坐标空间：32px=1格（挂点/炮口/后座/充能偏移换算），与编辑器预览严格对应
  const prevSmooth = ctx.imageSmoothingEnabled
  ctx.imageSmoothingEnabled = false // 像素风：最近邻
  const tintedBase = assets.base && tintColor ? tintedFx(assets.base, tintColor, 'multiply') : null
  const tintedTurret = assets.turret && tintColor ? tintedFx(assets.turret, tintColor, 'multiply') : null
  const tintedBarrel = assets.barrel && tintColor ? tintedFx(assets.barrel, tintColor, 'multiply') : null
  // 1. 底座层：只绘制显式配置且加载成功的贴图。
  if (assets.base && baseAngle !== 0) {
    ctx.save()
    ctx.translate(px + w / 2, py + h / 2)
    ctx.rotate(baseAngle)
    ctx.translate(-(px + w / 2), -(py + h / 2))
    ctx.drawImage(tintedBase ?? assets.base, px + (w - assets.base.width * F) / 2, py + (h - assets.base.height * F) / 2, assets.base.width * F, assets.base.height * F)
    ctx.restore()
  } else if (assets.base) {
    ctx.drawImage(tintedBase ?? assets.base, px + (w - assets.base.width * F) / 2, py + (h - assets.base.height * F) / 2, assets.base.width * F, assets.base.height * F)
  }
  const a = def.art?.anchor ?? [0.5, 0.5]
  const origin = turretCenter(t)
  const ax = (origin.x - viewX) * cell
  const ay = (origin.y - viewY) * cell
  // anchor 只决定炮身贴图相对固定炮塔原点的偏移；炮位、炮口和索敌原点不随它移动。
  const turretLayerX = (0.5 - a[0]) * w
  const turretLayerY = (0.5 - a[1]) * h
  // 素材炮口朝上绘制：canvas 旋转量 = t.angle（引擎角 0=正上，等价"数学炮口角 + 90°"）
  ctx.save()
  ctx.translate(ax, ay)
  ctx.rotate(t.angle)
  // 炮管层 × N（闭包提取，zBias 控制与炮身的上下关系）
  const mounts = artMounts(t, def)
  const fd = FLASH_DURATION // 后坐回位时长基准 = 火光总时长 0.2s（v1.45 硬编码）
  const drawBarrels = () => {
    mounts.forEach((b, i) => {
      let shift = 0
      const ev = [...muzzles].reverse().find(m => m.turretId === t.id && m.barrelIdx === i)
      if (ev && b.recoil > 0) {
        const el = fxElapsed(ev)
        shift = b.recoil * Math.max(0, 1 - el / (2 * fd)) // 击发位移 recoil，2×duration 内线性回位
      }
      // 炮管按自然尺寸绘制（与炮身同一缩放基准），根部锚定挂点；
      // 炮口坐标只是弹丸/火光定位点，不参与炮管缩放（修复：挂点/炮口 y 此前实际是缩放值）
      if (!assets.barrel) return // 未配置/未加载炮管素材：不绘制，挂点与开火逻辑不受影响
      ctx.save()
      ctx.translate(b.mount[0] * A, -b.mount[1] * A + shift * A)
      const bw = assets.barrel.width * F
      const bh = assets.barrel.height * F
      if (shouldFlipEvenBarrel(def, i)) ctx.scale(-1, 1)
      ctx.drawImage(tintedBarrel ?? assets.barrel, -bw / 2, -bh, bw, bh)
      ctx.restore()
    })
  }
  const barrelBelow = (def.art?.zBias ?? 0) < 0 // zBias < 0：炮管压到炮身之下（根部被炮身遮盖）；>= 0：炮管在上（默认）
  // 2. 炮身层（画布中心 = 旋转轴心）；zBias<0 时炮管先画在炮身下
  if (barrelBelow) drawBarrels()
  if (assets.turret) ctx.drawImage(tintedTurret ?? assets.turret, turretLayerX - assets.turret.width * F / 2, turretLayerY - assets.turret.height * F / 2, assets.turret.width * F, assets.turret.height * F) // 原始尺寸，anchor 对齐固定炮塔原点
  // 3. 辉光层（可选；默认仅过热）
  if (assets.glow && v.overheated && (def.art?.glow?.overheatOnly ?? true)) {
    ctx.drawImage(assets.glow, turretLayerX - assets.glow.width * F / 2, turretLayerY - assets.glow.height * F / 2, assets.glow.width * F, assets.glow.height * F)
  }
  // 4. 炮管层（默认在炮身之上）
  if (!barrelBelow) drawBarrels()
  // 5. 充能动画层（可选 charge.png 帧条）：随炮塔层旋转；v2.3 按帧数横向等分、从左到右顺序播一遍不循环
  //    v2.5：充能结束后，最后一帧在攻击持续时间内（持续型 firing && firingLeft>0）定格常显
  const chg = def.art?.charge
  const chargeHold25 = t.firing && t.firingLeft > 0
  // v2.15：chargeLeft<0 段 = 末帧滞留（0.05s，v2.16），与充能段同样绘制；帧映射改为前 N-1 帧占满 chargeTime、末帧在充能结束时亮起
  if (assets.charge && chg && def.chargeTime && def.chargeTime > 0 && (t.chargeLeft !== 0 || chargeHold25)) {
    const progress = t.chargeLeft > 0 ? Math.min(1, (def.chargeTime - t.chargeLeft) / def.chargeTime) : 1 // 滞留/攻击期定格末帧
    const mapped = progress * (chg.frames - 1) / Math.max(1, chg.frames) // 末帧不计入充能时间：充能结束时才亮起
    const { sx, sw, sh } = chargeFrameRect(assets.charge.width, assets.charge.height, chg.frames, mapped)
    const dw = sw * F, dh = sh * F // 单帧原始宽高比 × 基准
    ctx.drawImage(assets.charge, sx, 0, sw, sh,
      chg.offset[0] * A - dw / 2, -chg.offset[1] * A - dh / 2, dw, dh)
  }
  ctx.restore()
  // 6. 挂载显示层（世界系绘制，层级≈炮管同层——在旋转块外避免二次旋转；共享定位 + 复挂推入）
  if (def.type === 'missile' && (def.art?.rack?.show ?? true) && t.rackLeft > 0) {
    const ammoId = def.art?.projectile
    const ammo = ammoId ? projectileArtDef(ammoId) : undefined
    const counts = rackCounts(t, def, mounts.length)
    const animK = t.rackAnim > 0 ? 1 - t.rackAnim / RACK_RELOAD_ANIM : 1
    const newestBi = t.rackAnim > 0 && t.rackLeft > 0 // 最新复挂枚所在管（逐枚动画只作用于它）
      ? (((def.barrelMode ?? 'salvo') === 'sequential' ? t.barrelIdx : 0) + t.rackLeft - 1) % mounts.length
      : -1
    for (let i = 0; i < mounts.length; i++) {
      drawRackMissiles(ctx, v, t, def, i, counts[i] ?? 0, ammo, animK, i === newestBi ? (counts[i] ?? 1) - 1 : -1, zf)
    }
  }
  ctx.imageSmoothingEnabled = prevSmooth
}

/** 编辑器与战场共用的炮塔核心绘制入口；编辑器只在外层叠加网格、坐标轴与点位标注。 */
export function drawTurretPreviewCore(
  ctx: CanvasRenderingContext2D,
  def: TurretDef,
  box: { x: number; y: number; cell: number },
  state: { chargeProgress?: number | null; firing?: boolean; fireElapsed?: (number | null)[]; overheated?: boolean; angleRad?: number; tintColor?: string } = {},
) {
  const t: Turret = {
    id: -900, defId: def.id, x: box.x / box.cell, y: box.y / box.cell, w: def.w, h: def.h,
    level: 1, hp: def.hp, maxHp: def.hp, angle: state.angleRad ?? 0, cooldown: 0, burstLeft: 0,
    rackLeft: Math.max(1, def.burst ?? 1), rackAnim: 0, rackTimer: 0, burstTimer: 0,
    chargeLeft: state.chargeProgress == null || !def.chargeTime ? 0 : Math.max(0, def.chargeTime * (1 - state.chargeProgress)),
    firing: state.firing ?? false, firingLeft: state.firing ? 1 : 0, tickTimer: 0, targetId: null, barrelIdx: 0,
  }
  const muzzles: MuzzleEvent[] = (state.fireElapsed ?? []).flatMap((elapsed, i) => elapsed == null ? [] : [{
    id: -100000 - i * 10000 - Math.round(elapsed * 1000), turretId: t.id, barrelIdx: i,
    x: 0, y: 0, angle: 0, ttl: Math.max(0, FLASH_DURATION - elapsed), max: FLASH_DURATION,
  }])
  const v: ViewCtx = { cell: box.cell, viewX: 0, viewY: 0, overheated: state.overheated ?? false }
  const artEntry = turretArtState(def)
  if (artEntry.status === 'ready' && artEntry.assets) drawTurretLayers(ctx, t, def, v, artEntry.assets, muzzles, 0, box.cell / BASE_CELL, state.tintColor)
}

function drawTurret(ctx: CanvasRenderingContext2D, t: Turret, v: ViewCtx, selected: boolean, muzzles: MuzzleEvent[], baseAngle = 0, hp?: { arc?: { start: number; end: number }; fixed?: number; hideTurretArt?: boolean; hidden?: boolean }, zf = v.cell / BASE_CELL, tintColor?: string) {
  const { cell, viewX, viewY } = v
  const def = defOf(t.defId)
  const px = (t.x - viewX) * cell
  const py = (t.y - viewY) * cell
  const w = t.w * cell
  // “隐藏炮塔素材”只跳过炮塔美术；炮塔状态、射界、开火与命中特效继续运行。
  const hideArt = hp?.hideTurretArt ?? hp?.hidden ?? false
  if (!hideArt) {
    // 贴图管线 ready → 仅绘制已配置且加载成功的层；loading/失效层保持透明。
    const artEntry = turretArtState(def)
    if (artEntry.status === 'ready' && artEntry.assets) {
      drawTurretLayers(ctx, t, def, v, artEntry.assets, muzzles, baseAngle, zf, tintColor)
    }
  }
  const c = turretCenter(t)
  const cx = (c.x - viewX) * cell
  const cy = (c.y - viewY) * cell
  // 射界与射程指示（选中时）
  if (selected) {
    const rO = def.rangeMax / M_PER_CELL * cell
    // v1.98：炮塔级最大角度已取消——固定视角画单射线；指定视角画视界扇形（相对船头）；否则整圆
    if (hp?.fixed !== undefined) {
      const af = baseAngle + hp.fixed * Math.PI / 180 - Math.PI / 2
      ctx.strokeStyle = 'rgba(217,164,65,0.85)'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(cx, cy)
      ctx.lineTo(cx + rO * Math.cos(af), cy + rO * Math.sin(af))
      ctx.stroke()
    } else {
    const a0 = hp?.arc
      ? baseAngle + (hp.arc.start * Math.PI / 180) - Math.PI / 2
      : baseAngle - Math.PI / 2
    const a1 = hp?.arc
      ? baseAngle + (hp.arc.end * Math.PI / 180) - Math.PI / 2
      : baseAngle + Math.PI * 1.5
    // 射界扇形填充
    ctx.fillStyle = 'rgba(217,164,65,0.20)'
    ctx.beginPath()
    ctx.moveTo(cx, cy)
    ctx.arc(cx, cy, rO, a0, a1)
    ctx.closePath()
    ctx.fill()
    // 最小射程盲区
    if (def.rangeMin > 0) {
      const rI = def.rangeMin / M_PER_CELL * cell
      ctx.fillStyle = 'rgba(26,26,24,0.16)'
      ctx.beginPath()
      ctx.moveTo(cx, cy)
      ctx.arc(cx, cy, rI, a0, a1)
      ctx.closePath()
      ctx.fill()
      ctx.setLineDash([4, 3])
      ctx.strokeStyle = 'rgba(26,26,24,0.65)'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.arc(cx, cy, rI, a0, a1)
      ctx.stroke()
      ctx.setLineDash([])
    }
    // 扇形轮廓：粗黑描边 + 琥珀内线（漫画风）
    const strokeSector = (color: string, lw: number) => {
      ctx.strokeStyle = color
      ctx.lineWidth = lw
      ctx.beginPath()
      ctx.moveTo(cx, cy)
      ctx.lineTo(cx + Math.cos(a0) * rO, cy + Math.sin(a0) * rO)
      ctx.moveTo(cx, cy)
      ctx.lineTo(cx + Math.cos(a1) * rO, cy + Math.sin(a1) * rO)
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(cx, cy, rO, a0, a1)
      ctx.stroke()
    }
    strokeSector('#1A1A18', 3.5)
    strokeSector('#D9A441', 1.5)
    } // v1.98 else（非固定视角）
    // 射角（免转瞄准锥）：以当前炮口方向为中心
    const coneR = (def.aimCone / 2) * Math.PI / 180
    const c0 = t.angle - coneR - Math.PI / 2
    const c1 = t.angle + coneR - Math.PI / 2
    ctx.fillStyle = 'rgba(239,235,216,0.14)'
    ctx.beginPath()
    ctx.moveTo(cx, cy)
    ctx.arc(cx, cy, rO, c0, c1)
    ctx.closePath()
    ctx.fill()
    ctx.setLineDash([5, 4])
    ctx.strokeStyle = '#EFEBD8'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(cx, cy)
    ctx.lineTo(cx + Math.cos(c0) * rO, cy + Math.sin(c0) * rO)
    ctx.moveTo(cx, cy)
    ctx.lineTo(cx + Math.cos(c1) * rO, cy + Math.sin(c1) * rO)
    ctx.stroke()
    ctx.setLineDash([])
  }
  // 热量条已移除：热量汇聚到堡垒（HUD 显示堡垒热量池）
  // 等级点：已取消显示（升级逻辑保留，仅不再渲染等级标记）
  if (t.hp < t.maxHp) drawHpBar(ctx, px, py - 5, w, t.hp / t.maxHp)
  // 堡垒过热：全炮塔冒烟
  if (v.overheated) {
    ctx.fillStyle = 'rgba(40,40,40,0.5)'
    ctx.beginPath()
    ctx.arc(cx, cy - cell * 0.35 - ((t.id * 7 + Math.floor(t.tickTimer * 10)) % 8), 4, 0, Math.PI * 2)
    ctx.fill()
  }
}
