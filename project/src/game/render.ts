// 战场画布渲染：低饱和废土漫画风（粗黑描边、硬阴影）
import {
  ALLY_DEFS, ENEMY_DEFS, ENEMY_SPRITE, FLASH_DURATION, FLASH_FRAME_DUR, FLASH_FRAMES, FLASH_SCALES, M_PER_CELL, SPAWN_ROWS,
  TERRAIN_DEFS, TURRET_DEFS, PROJECTILE_KIND_COLOR, MODULE_DEFS, BASE_CELL,
} from './config'
import { isInnerCell, LEVEL } from './level'
import { artMounts, beamLength, defOf, eventRandom, trackPlacements, turretRenderKey, dirX, dirY, fortressDef, fortressRect, fortressShapeSet, fortressInteriorSet, hardpointOf, MISSILE_FADE, missileVisHeading, moduleCells, moduleFoot, muzzlePos, RACK_RELOAD_ANIM, rackCounts, rackMissilePos, turretCenter, DEATH_MAIN_T, DEATH_END_T, wheelPlacements, wheelVisualSteerAngle, type MuzzleEvent } from './engine'
import { SPECIAL_BOOST_NAME } from './config'

// ---- 堡垒贴图缓存（dataURL；render 每帧轮询，加载完成自动生效；贴图仅视觉不参与碰撞） ----
const fortressSpriteCache = new Map<string, { status: 'loading' | 'ready' | 'error'; img?: HTMLImageElement }>()
function fortressSprite(srcData?: string): HTMLImageElement | null {
  if (!srcData) return null
  srcData = getAsset(srcData)?.src ?? srcData // v2.72：堡垒底座/主体从素材库按 id 选择；遗留路径继续直读
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

// ---- v1.85/v1.86 履带瓦片：库引用/路径/dataURL 原图直绘（不旋转：图宽 = 履带宽度方向，图高 = 板长方向）----
function trackTileImage(ref: string): HTMLImageElement | null {
  if (typeof document === 'undefined') return null
  const e = getAsset(ref) ? assetImage(ref) : srcImage(ref) // 库条目走 assetImage；否则按路径/dataURL
  return e.status === 'ready' && e.img ? e.img : null // 加载中/失败：本帧跳过，下一帧重试
}
import { chargeFrameRect, turretArtState, projectileArtDef, projectileArtState, resolveTrailFx, resolveExplosionFx, resolveImpactFx, srcImage, resCompatUrl, beamArtConfig, smokeDuration, type ProjectileArtAssets, type TurretArtAssets } from './art'
import { assetImage, getAsset } from './assetlib'
import { createPool, glowFlicker, spawnBurst, spawnTrail, stepParticles, type ParticlePool } from './particles'
import { drawExplosionLayers, drawImpactFlash, drawParticlePool, hexA, tintedFx } from './fxDraw' // v2.55：特效画法统一走共用层
import { emitFortressEffects, updateTrackMarks, TRACK_MARK_LIFE, TRACK_MARK_FADE, TRACK_MARK_ALPHA, type TrackMark, type TrackMarkState } from './fortressFx' // v2.40 堡垒特效点粒子化；v2.41 履带印；v2.43 印透明度/渐隐参数
import { craterOpacity, updateCraters, type Crater } from './craters'
import { rmxpAutotileIndex, rmxpQuarterSrc, RMXP_SUBTILES } from './autotile'
import type { FortressDef, ProjectileArtDef, TurretDef } from './config'
import { registerFortressBodyImage } from './fortressBodyMask'

// v2.55：fadeColor / tintedFx / hexRgb / hexA / drawParticlePool / drawExplosionLayers / drawImpactFlash 已迁至 ./fxDraw（战场与编辑器预览共用画法层）

/** v2.7 光束贴图层（远行星号式）：局部坐标系（原点=光束起点，+x 沿光束方向）内沿轴向无缝平铺染色贴图并滚动；
 *  img 为 null 时回退程序化矩形（与旧版等效：颜色/宽度相同，alpha 由调用方合成）。加法发光。 */
export function drawBeamLayer(ctx: CanvasRenderingContext2D, img: HTMLCanvasElement | null, color: string, lenPx: number, widthPx: number, alpha: number, scrollPx: number, texScale = 1, vScale = 1) {
  ctx.globalAlpha = alpha
  if (img) {
    ctx.globalCompositeOperation = 'lighter'
    // v2.15：贴图按原生尺寸平铺不缩放（128×32 → 每块 128×32×texScale；texScale = cell/30 适配战场缩放）
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
import type { Enemy, FortressDamageMark, GameState, Turret } from './engine'

// ================= 丧尸精灵（按需加载，失败降级为圆形） =================
type SpriteDir = 'front' | 'right' | 'back' | 'left'
const spriteCache = new Map<string, HTMLImageElement>()
const spriteFailed = new Set<string>()
/** 敌人上一帧位置（用于推算朝向速度向量） */
const prevPos = new Map<number, { x: number; y: number }>()

function spriteImage(group: string, dir: 'front' | 'right' | 'back', walk: boolean): HTMLImageElement | null {
  const key = `${group}_${dir}${walk ? '_walk' : ''}`
  if (spriteFailed.has(key)) return null
  let img = spriteCache.get(key)
  if (!img) {
    img = new Image()
    img.onerror = () => { spriteFailed.add(key); spriteCache.delete(key) }
    img.src = `/res/zombies/${key}.png`
    spriteCache.set(key, img)
  }
  return img.complete && img.naturalWidth > 0 ? img : null
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
  buildMode: boolean
  /** 堡垒内部建造模式：隐藏主体/上层贴图只露底座，原地摆放模块 */
  interiorMode?: boolean
  /** 内部建造幽灵（格阵坐标 + 占地 + 合法性） */
  interiorGhost?: { x: number; y: number; w: number; h: number; ok: boolean; cells?: { x: number; y: number }[] } | null // v2.31：cells=逐格幽灵（异型模块；缺省= w×h 矩形）
  /** 场景编辑模式：draft 编辑层叠加 */
  edit?: EditOverlay
}

export interface EditOverlay {
  cells: string[] // draft.buildCells
  groundCells: string[] // draft.groundCells（战场地面层）
  terrain: { kind: string; x: number; y: number; w: number; h: number }[]
  objects: { kind: string; x: number; y: number; w: number; h: number }[]
  walls: { x: number; y: number }[]
  buildings: { x: number; y: number; w: number; h: number; color: string }[]
  core: { x: number; y: number; w: number; h: number } | null
  turrets: { defId: string; x: number; y: number }[]
  startZone: { x: number; y: number; w: number; h: number }
  finishZone: { x: number; y: number; w: number; h: number }
  triggers: { id: number; name: string; x: number; y: number; w: number; h: number; enabled: boolean; selected: boolean }[]
  interactables: { id: number; name: string; kind: string; x: number; y: number; w: number; h: number; enabled: boolean; selected: boolean }[]
  hover: { x: number; y: number; w: number; h: number; ok: boolean } | null
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

/** 推进模式边缘带相机：目标可在中央自由移动，越过 22%/78% 安全带才推动视口。 */
export function edgeBandView(current: number, target: number, visible: number, worldSize: number, band = 0.22): number {
  const safeBand = Math.max(0.05, Math.min(0.45, band))
  const near = current + visible * safeBand
  const far = current + visible * (1 - safeBand)
  let next = current
  if (target < near) next = target - visible * safeBand
  else if (target > far) next = target - visible * (1 - safeBand)
  return Math.max(0, Math.min(Math.max(0, worldSize - visible), next))
}

/** 绘制一层 RMXP Autotile 地面（96×128 单帧；cells 为同层格集合） */
function drawRmxpGroundLayer(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  cells: readonly string[],
  X: (x: number) => number,
  Y: (y: number) => number,
  cell: number,
) {
  const set = new Set(cells)
  const half = cell / 2
  const prevSmooth = ctx.imageSmoothingEnabled
  ctx.imageSmoothingEnabled = false // 像素贴图最近邻
  for (const k of cells) {
    const [x, y] = k.split(',').map(Number)
    const variation = rmxpAutotileIndex(set, x, y)
    const pieces = RMXP_SUBTILES[variation]
    for (let q = 0; q < 4; q++) {
      const [sx, sy] = rmxpQuarterSrc(pieces[q])
      ctx.drawImage(img, sx, sy, 16, 16, X(x) + (q % 2) * half, Y(y) + Math.floor(q / 2) * half, half, half)
    }
  }
  ctx.imageSmoothingEnabled = prevSmooth
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

/** 结构值阶段：0=完好，1=轻度变暗，2=裂纹，3=低结构警戒/冒烟。 */
export function fortressDamageStage(hp: number, maxHp: number): 0 | 1 | 2 | 3 {
  const ratio = maxHp > 0 ? Math.max(0, hp / maxHp) : 0
  return ratio >= 0.75 ? 0 : ratio >= 0.5 ? 1 : ratio >= 0.25 ? 2 : 3
}

function drawFortressDamageMark(ctx: CanvasRenderingContext2D, mark: FortressDamageMark, x: number, y: number, cell: number): void {
  const r = Math.max(2, mark.size * cell)
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

function drawFortressDamageContent(ctx: CanvasRenderingContext2D, s: GameState, stage: number, ox: number, oy: number, fw: number, fh: number, cell: number): void {
  if (stage > 0) {
    const ratio = s.fortress.maxHp > 0 ? Math.max(0, s.fortress.hp / s.fortress.maxHp) : 0
    const darkAlpha = Math.min(0.34, 0.06 + (0.75 - ratio) * 0.42)
    ctx.fillStyle = `rgba(20,18,16,${darkAlpha.toFixed(3)})`
    ctx.fillRect(ox, oy, fw, fh)
  }
  if (stage >= 2) {
    const crackCount = stage === 3 ? 4 : 2
    ctx.lineCap = 'round'
    for (let i = 0; i < crackCount; i++) {
      const x = ox + fw * (0.22 + eventRandom(913, i * 3) * 0.56)
      const y = oy + fh * (0.18 + eventRandom(913, i * 3 + 1) * 0.64)
      const len = cell * (0.35 + eventRandom(913, i * 3 + 2) * 0.3)
      ctx.save(); ctx.translate(x, y); ctx.rotate((i * 2.17 + 0.4) % Math.PI)
      ctx.strokeStyle = 'rgba(18,15,13,0.7)'; ctx.lineWidth = Math.max(1, cell * 0.045)
      ctx.beginPath(); ctx.moveTo(-len, -len * 0.16); ctx.lineTo(-len * 0.18, len * 0.06); ctx.lineTo(len * 0.22, -len * 0.11); ctx.lineTo(len, len * 0.2); ctx.stroke()
      ctx.restore()
    }
  }
  for (const mark of s.fortress.damageMarks) drawFortressDamageMark(ctx, mark, ox + mark.x * cell, oy + mark.y * cell, cell)
  if (s.fortress.hitFlash > 0) {
    ctx.fillStyle = `rgba(255,248,220,${Math.min(0.62, s.fortress.hitFlash / 0.08 * 0.62).toFixed(3)})`
    ctx.fillRect(ox, oy, fw, fh)
  }
}

/** 主体战损覆盖：有主体贴图时严格使用其 alpha 作遮罩，透明区下方的底座/履带/轮子不会被染到。 */
function drawFortressDamageOverlay(
  ctx: CanvasRenderingContext2D, s: GameState, fd: FortressDef, bodyImg: HTMLImageElement | null,
  fx: number, fy: number, fw: number, fh: number, cell: number, stage: number,
): void {
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
// v2.40 双通道：groundPool = 地面层（地形之上/堡垒底座之下：尘土等）；fxPool = 空中层（最上，现状口径）
const fxPool: ParticlePool = createPool()
const groundPool: ParticlePool = createPool()
const fxEmitterAccs = new Map<string, number>() // v2.40 堡垒特效点 id → 发射累加器
const trackMarks: TrackMark[] = [] // v2.41 履带印（地面层）
const trackMarkSt: TrackMarkState = { acc: [], prevPhase: [], moving: [] }
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
let damageSmokeAcc = 0
let damageSmokeSeq = 0
let damageSmokeTime = -1

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

/** 命中扩散亮度：一次命中只从命中格传播到紧邻一圈，每圈仅产生一个亮度脉冲。 */
export function shieldHexRipple(progress: number, ring: number, broken = false): number {
  if (ring < 0 || ring > 1 || progress < 0 || progress >= 1) return 0
  const start = ring * (broken ? 0.12 : 0.14)
  const duration = broken ? 0.34 : 0.26
  const local = (progress - start) / duration
  // 单向衰减而非往复正弦：命中格不会在扩散结束后再次变亮。
  return local >= 0 && local < 1 ? Math.pow(1 - local, 1.55) : 0
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

export interface ShieldFieldMotion { x1: number; y1: number; r1: number; a1: number; x2: number; y2: number; r2: number; a2: number }

/** 同一场体素材的双层反向漂移参数，产生缓慢能量干涉而无需额外贴图。 */
export function shieldFieldMotion(time: number, hw: number, hh: number): ShieldFieldMotion {
  return {
    x1: Math.sin(time * 0.43) * hw * 0.075,
    y1: Math.cos(time * 0.31) * hh * 0.055,
    r1: Math.sin(time * 0.22) * 0.045,
    a1: 0.76 + Math.sin(time * 0.67) * 0.14,
    x2: Math.cos(time * 0.37 + 1.4) * hw * 0.065,
    y2: Math.sin(time * 0.28 + 2.1) * hh * 0.06,
    r2: -Math.sin(time * 0.19 + 0.8) * 0.052,
    a2: 0.58 + Math.sin(time * 0.53 + 2.4) * 0.12,
  }
}

/** 碎片尺寸随护盾短边增长，并钳制在兼顾可读性与遮挡的范围内。 */
export function shieldShardSize(hw: number, hh: number): number {
  return Math.max(0.2, Math.min(0.55, Math.min(hw, hh) * 2 * 0.07))
}

/** 沿圆角矩形护盾外缘近似等距采样，供柔光与破盾碎片共用同一边界。 */
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
    if (d < top) out.push({ x: -hw + radius + d, y: -hh })
    else if ((d -= top) < arc) { const a = -Math.PI / 2 + d / radius; out.push({ x: hw - radius + Math.cos(a) * radius, y: -hh + radius + Math.sin(a) * radius }) }
    else if ((d -= arc) < side) out.push({ x: hw, y: -hh + radius + d })
    else if ((d -= side) < arc) { const a = d / radius; out.push({ x: hw - radius + Math.cos(a) * radius, y: hh - radius + Math.sin(a) * radius }) }
    else if ((d -= arc) < top) out.push({ x: hw - radius - d, y: hh })
    else if ((d -= top) < arc) { const a = Math.PI / 2 + d / radius; out.push({ x: -hw + radius + Math.cos(a) * radius, y: hh - radius + Math.sin(a) * radius }) }
    else if ((d -= arc) < side) out.push({ x: -hw, y: hh - radius - d })
    else { d -= side; const a = Math.PI + d / radius; out.push({ x: -hw + radius + Math.cos(a) * radius, y: -hh + radius + Math.sin(a) * radius }) }
  }
  return out
}

function shieldClipPath(ctx: CanvasRenderingContext2D, hw: number, hh: number): void {
  const r = shieldCornerRadius(hw, hh)
  ctx.beginPath()
  ctx.moveTo(-hw + r, -hh)
  ctx.lineTo(hw - r, -hh); ctx.quadraticCurveTo(hw, -hh, hw, -hh + r)
  ctx.lineTo(hw, hh - r); ctx.quadraticCurveTo(hw, hh, hw - r, hh)
  ctx.lineTo(-hw + r, hh); ctx.quadraticCurveTo(-hw, hh, -hw, hh - r)
  ctx.lineTo(-hw, -hh + r); ctx.quadraticCurveTo(-hw, -hh, -hw + r, -hh)
  ctx.closePath()
}

export function draw(ctx: CanvasRenderingContext2D, s: GameState, v: ViewCtx, ui: UiHints, W: number, H: number) {
  const { cell, viewX, viewY } = v
  const X = (x: number) => (x - viewX) * cell
  const Y = (y: number) => (y - viewY) * cell
  // 贴图原尺寸倍率：基准格全设备统一 BASE_CELL=30px（v1.49）——zoom=1 时 1 贴图像素 = 1 画布像素，
  // 横竖屏/任何设备贴图与网格比例恒定，随用户缩放等比变化
  const zf = v.cell / BASE_CELL
  ctx.clearRect(0, 0, W, H)

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
  // v2.40 堡垒特效点粒子发射（编辑模式不发射）：粒子离口即世界空间独立运动，不再跟船
  if (!ui.edit) emitFortressEffects(s, fortressDef(s), fxDt, groundPool, fxPool, fxEmitterAccs)
  if (!ui.edit) {
    if (craterTime >= 0 && s.time < craterTime) { craters.length = 0; craterSeen.clear() }
    craterTime = s.time
    updateCraters(craters, craterSeen, s.explosions, s.time)
  }
  // 结构值低于 25%：主体持续冒出少量深色烟；重开时清累加器，毁灭序列接管后停止本通道。
  const damageStage = fortressDamageStage(s.fortress.hp, s.fortress.maxHp)
  if (damageSmokeTime >= 0 && s.time < damageSmokeTime) { damageSmokeAcc = 0; damageSmokeSeq = 0 }
  damageSmokeTime = s.time
  if (!ui.edit && damageStage === 3 && s.fortress.dyingT < 0 && fxDt > 0) {
    const ratio = s.fortress.maxHp > 0 ? s.fortress.hp / s.fortress.maxHp : 0
    damageSmokeAcc += (3 + (0.25 - Math.max(0, ratio)) * 16) * fxDt
    const count = Math.floor(damageSmokeAcc)
    damageSmokeAcc -= count
    const fdDmg = fortressDef(s)
    const frDmg = fortressRect(s)
    const cxDmg = frDmg.x + frDmg.w / 2, cyDmg = frDmg.y + frDmg.h / 2
    const coDmg = Math.cos(s.fortress.heading), siDmg = Math.sin(s.fortress.heading)
    for (let i = 0; i < count; i++) {
      const seed = ++damageSmokeSeq
      const lx = (eventRandom(seed, 81) - 0.5) * fdDmg.w * 0.42
      const ly = (eventRandom(seed, 82) - 0.5) * fdDmg.h * 0.34
      const x = cxDmg + lx * coDmg - ly * siDmg
      const y = cyDmg + lx * siDmg + ly * coDmg
      spawnTrail(fxPool, x, y, {
        vx: (eventRandom(seed, 83) - 0.5) * 0.18, vy: -(0.3 + eventRandom(seed, 84) * 0.22),
        life: 0.8 + eventRandom(seed, 85) * 0.35, size: 0.1 + eventRandom(seed, 86) * 0.045,
        color: '#4C4842', colorEnd: '#252321', drag: 1.1, grow: 1.8, growUntil: 0.55, fadeIn: 0.12,
      })
    }
  } else if (damageStage !== 3 || s.fortress.dyingT >= 0) damageSmokeAcc = 0
  // v2.53 毁灭序列浓烟：内伤期缓释、主爆后加浓（累加器节率，与 emitFortressEffects 同模式）
  if (!ui.edit && s.fortress.dyingT >= 0 && fxDt > 0) {
    const dead53 = s.fortress.dyingT >= DEATH_MAIN_T
    const acc53 = (fxEmitterAccs.get('deathSmoke') ?? 0) + (dead53 ? 14 : 5) * fxDt
    const n53 = Math.floor(acc53)
    fxEmitterAccs.set('deathSmoke', acc53 - n53)
    const fd53 = fortressDef(s)
    for (let i = 0; i < n53; i++) {
      spawnTrail(fxPool, s.fortress.x + Math.random() * fd53.w, s.fortress.y + Math.random() * fd53.h, {
        vx: (Math.random() - 0.5) * 0.2, vy: -(0.35 + Math.random() * 0.25),
        life: 0.85 + Math.random() * 0.3, size: 0.12,
        color: dead53 ? '#4A453E' : '#78766E', drag: 1.2, grow: 2.0, growUntil: 0.5, fadeIn: 0.12,
      })
    }
  }

  // ---- 三层地面：底层平铺 → 战场层（RMXP Autotile）→ 基地层（RMXP Autotile） ----
  const groundBase = srcImage('/res/ground/ground_base.png')
  const groundMid = srcImage('/res/ground/ground_mid.png')
  const groundTop = srcImage('/res/ground/ground_top.png')
  const gy0 = Math.max(0, Math.floor(viewY))
  const gy1 = Math.min(LEVEL.rows, Math.ceil(viewY + H / cell + 1))
  const gx0 = Math.max(0, Math.floor(viewX))
  const gx1 = Math.min(LEVEL.cols, Math.ceil(viewX + W / cell + 1))
  if (groundBase.status === 'ready' && groundBase.img) { // 底层：32×32 平铺满整个场景（可视区）
    for (let y = gy0; y < gy1; y++)
      for (let x = gx0; x < gx1; x++)
        ctx.drawImage(groundBase.img, 0, 0, 32, 32, X(x), Y(y), cell, cell)
  } else { // 贴图未就绪兜底：延续统一灰底
    ctx.fillStyle = '#71757A'
    ctx.fillRect(0, 0, W, H)
  }

  const inScene = (k: string) => {
    const [x, y] = k.split(',').map(Number)
    return x >= 0 && x < LEVEL.cols && y >= gy0 && y < gy1
  }
  // 战场层：纯视觉笔刷层（出生带不铺设；编辑模式读 draft）
  const battleCells = (ui.edit?.groundCells ?? LEVEL.groundCells).filter(k => {
    const [, y] = k.split(',').map(Number)
    return y >= SPAWN_ROWS && inScene(k)
  })
  if (battleCells.length > 0) {
    if (groundMid.status === 'ready' && groundMid.img) drawRmxpGroundLayer(ctx, groundMid.img, battleCells, X, Y, cell)
    else { // 未就绪兜底：淡绿灰提示已铺设区域
      ctx.fillStyle = 'rgba(110,123,104,0.35)'
      for (const k of battleCells) {
        const [x, y] = k.split(',').map(Number)
        ctx.fillRect(X(x), Y(y), cell, cell)
      }
    }
  }
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

  // 推进终点：游玩态给出清晰但不遮挡战场的撤离区域标记。
  if (!ui.edit && s.objective.type === 'reach') {
    const z = LEVEL.finishZone
    ctx.fillStyle = 'rgba(217,164,65,0.14)'
    ctx.fillRect(X(z.x), Y(z.y), z.w * cell, z.h * cell)
    ctx.strokeStyle = 'rgba(217,164,65,0.9)'
    ctx.lineWidth = 2
    ctx.setLineDash([8, 5])
    ctx.strokeRect(X(z.x), Y(z.y), z.w * cell, z.h * cell)
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
  ctx.strokeStyle = 'rgba(0,0,0,0.08)'
  ctx.lineWidth = 1
  for (let x = 1; x < LEVEL.cols; x++) {
    ctx.beginPath(); ctx.moveTo(X(x), 0); ctx.lineTo(X(x), H); ctx.stroke()
  }
  const y0 = Math.max(0, Math.floor(viewY))
  const y1 = Math.min(LEVEL.rows, Math.ceil(viewY + H / cell + 1))
  for (let y = y0; y <= y1; y++) {
    ctx.beginPath(); ctx.moveTo(0, Y(y)); ctx.lineTo(W, Y(y)); ctx.stroke()
  }

  // ---- 地形（贴地效果层，永不挡弹道/移动；实例随 LEVEL） ----
  if (!ui.edit) for (const b of LEVEL.terrain) {
    const def = TERRAIN_DEFS[b.kind]
    ctx.fillStyle = def.color
    ctx.fillRect(X(b.x), Y(b.y), b.w * cell, b.h * cell)
    ctx.strokeStyle = '#1A1A18'
    ctx.lineWidth = 2
    ctx.strokeRect(X(b.x), Y(b.y), b.w * cell, b.h * cell)
    if (b.kind === 'puddle') {
      ctx.fillStyle = 'rgba(255,255,255,0.18)'
      ctx.beginPath()
      ctx.ellipse(X(b.x + b.w / 2), Y(b.y + b.h / 2), b.w * cell * 0.32, b.h * cell * 0.28, 0, 0, Math.PI * 2)
      ctx.fill()
    }
  }

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
  if (!ui.edit) for (const o of s.objects) {
    if (o.kind === 'barrel') {
      ctx.fillStyle = '#A05C48'
      ctx.strokeStyle = '#1A1A18'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(X(o.x + 0.5), Y(o.y + 0.5), cell * 0.32, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
      ctx.fillStyle = '#1A1A18'
      ctx.fillRect(X(o.x + 0.42), Y(o.y + 0.25), cell * 0.16, cell * 0.5)
      continue
    }
    // 废墟 / 岩石：矩形色块 + 粗黑描边（沿用原地形配色）
    ctx.fillStyle = o.kind === 'ruins' ? '#5A564E' : '#7A7264'
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
      // 有耐久物体：受损画血条（岩石 hp=-1 不画）
      if (o.hp < o.maxHp) drawHpBar(ctx, X(o.x), Y(o.y) - 5, o.w * cell, o.hp / o.maxHp)
    } else {
      ctx.fillStyle = 'rgba(0,0,0,0.25)'
      ctx.beginPath()
      ctx.arc(X(o.x + o.w / 2), Y(o.y + o.h / 2), cell * 0.28, 0, Math.PI * 2)
      ctx.fill()
    }
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

  // ---- 固有建筑（编辑模式由 draft 层接管） ----
  if (!ui.edit) for (const b of s.buildings) {
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

  // ---- 履带印（v2.41：地面层最底——印距=瓦片有效步长，压暗瓦片压印，前 60% 恒定后渐隐）----
  const fd0 = fortressDef(s)
  if (!ui.edit) {
    if (trackMarkTime >= 0 && s.time < trackMarkTime) { trackMarks.length = 0; trackMarkSt.acc = []; trackMarkSt.prevPhase = []; trackMarkSt.moving = [] } // 重开清印
    trackMarkTime = s.time
    updateTrackMarks(trackMarks, trackMarkSt, s, fd0, tile => trackTileImage(tile)?.height ?? null)
    const zmK = cell / BASE_CELL
    for (const mk of trackMarks) {
      const img = trackTileImage(mk.tile)
      if (!img) continue
      const age = Math.max(0, s.time - mk.born) // v2.43：0.25 透明度，前 (LIFE−FADE) 全亮、末 FADE 秒线性渐隐
      const a = TRACK_MARK_ALPHA * Math.max(0, Math.min(1, (TRACK_MARK_LIFE - age) / TRACK_MARK_FADE))
      if (a <= 0.01) continue
      ctx.save()
      ctx.translate(X(mk.x), Y(mk.y))
      ctx.rotate(mk.angle)
      ctx.globalAlpha = a
      const tint = tintedFx(img, '#2E2A24')
      if (tint) ctx.drawImage(tint, (-img.width * zmK) / 2, (-img.height * zmK) / 2, img.width * zmK, img.height * zmK)
      ctx.restore()
    }
    ctx.globalAlpha = 1
  }

  // ---- 地面粒子层（v2.40：尘土等——地形之上、堡垒底座之下）----
  drawParticlePool(ctx, groundPool, X, Y, cell, nowFx)

  // ---- 移动堡垒（底座层 + 内部模块层[建造模式] + 主体层；随 heading 旋转；编辑模式不画） ----
  if (!ui.edit) {
    const fd = fortressDef(s)
    const fr = fortressRect(s)
    const fw = fr.w * cell
    const fh = fr.h * cell
    ctx.save()
    ctx.translate(X(fr.x + fr.w / 2), Y(fr.y + fr.h / 2))
    ctx.rotate(s.fortress.heading)
    const fx = -fw / 2
    const fy = -fh / 2
    // 底座层（始终渲染）：贴图 > 自由形状逐格 > 旧矩形（履带侧裙 + 底盘）
    const baseImg = fortressSprite(fd.spriteBase)
    if (baseImg) {
      // 底座贴图：原比例显示（不缩放）——zoom=1 时 1 贴图像素 = 1 画布像素，随画布缩放倍率变化；中心对准底格中心；仅视觉
      const zm = v.cell / BASE_CELL // v1.49：基准格统一 30px
      const dw = baseImg.naturalWidth * zm
      const dh = baseImg.naturalHeight * zm
      ctx.drawImage(baseImg, fx + (fw - dw) / 2, fy + (fh - dh) / 2, dw, dh)
    } else if (fd.shape && fd.shape.length > 0) {
      // 自由形状底盘：逐格绘制（镂空处透明 = 真实碰撞体）
      for (const k of fd.shape) {
        const [cx, cy] = k.split(',').map(Number)
        ctx.fillStyle = fd.paint?.base ?? fd.color
        ctx.fillRect(fx + cx * cell + 0.5, fy + cy * cell + 0.5, cell - 1, cell - 1)
        ctx.strokeStyle = '#1A1A18'
        ctx.lineWidth = 1.5
        ctx.strokeRect(fx + cx * cell + 0.5, fy + cy * cell + 0.5, cell - 1, cell - 1)
      }
    } else {
      ctx.fillStyle = '#4A4D45'
      ctx.fillRect(fx, fy + cell * 0.15, cell * 0.35, fh - cell * 0.3)
      ctx.fillRect(fx + fw - cell * 0.35, fy + cell * 0.15, cell * 0.35, fh - cell * 0.3)
      ctx.fillStyle = fd.paint?.base ?? fd.color
      ctx.fillRect(fx + cell * 0.18, fy + cell * 0.12, fw - cell * 0.36, fh - cell * 0.24)
      ctx.strokeStyle = '#1A1A18'
      ctx.lineWidth = 3
      ctx.strokeRect(fx + cell * 0.18, fy + cell * 0.12, fw - cell * 0.36, fh - cell * 0.24)
    }
    // 履带层（v1.85/v1.86）：瓦片循环滚动，底座之上/主体之下；随船体旋转（本上下文已 rotate(heading)）；
    // 不随俯仰 lean（悬挂拟真：履带贴地不动，只有车壳倾）；仅视觉
    // v1.86：def 只存左履带，右侧按堡垒中心线镜像（x → w − x，相位独立）；瓦片原图直绘不旋转；v1.87：尺寸一律取素材原图
    if (fd.tracks && fd.tracks.length > 0) {
      let trackDrawn = 0
      let lastPh88 = 0 // v1.88：探针用——本帧最后渲染的履带相位
      ctx.imageSmoothingEnabled = false
      const zmT = cell / BASE_CELL // 美术基准 30px=1 格：原尺寸 = 图像素 × zm
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
          for (const pl of trackPlacements(t, ph, tileLenC)) {
            const lh = lpx * pl.scaleY
            if (lh < 0.3) continue
            const px85 = mirror ? fd.w - pl.x : pl.x
            ctx.globalAlpha = pl.alpha
            ctx.drawImage(tileImg, fx + px85 * cell - wpx / 2, fy + pl.y * cell - lh / 2, wpx, lh)
            trackDrawn++
          }
        }
      }
      ctx.globalAlpha = 1
      if (typeof window !== 'undefined') { const w88 = window as unknown as { __tdTrack?: number; __tdTrackPhase?: number; __tdFrame?: number }; w88.__tdTrack = trackDrawn; w88.__tdTrackPhase = lastPh88; w88.__tdFrame = (w88.__tdFrame ?? 0) + 1 } // 无头探针：本帧履带瓦片绘制数 + 最后渲染相位（v1.88）
    }
    // 轮子层：与履带同层级、不随俯仰 lean；原始像素尺寸直绘；pair 按中心线展开左右两轮。
    if (fd.wheels && fd.wheels.length > 0) {
      const visualSteer = wheelVisualSteerAngle(s, fd)
      for (const wd of fd.wheels) {
        const img51 = wd.sprite ? trackTileImage(wd.sprite) : null
        if (wd.sprite && !img51) continue // 配了贴图但未加载：跳过（与履带瓦片同口径）
        const zmW = cell / BASE_CELL
        const ww = (img51?.width ?? 11) * zmW
        const hw = (img51?.height ?? 20) * zmW
        for (const p of wheelPlacements(fd, wd)) {
          ctx.save()
          ctx.translate(fx + p.x * cell, fy + p.y * cell)
          ctx.rotate(wd.steered ? visualSteer : 0)
          if (img51) {
            ctx.drawImage(img51, -ww / 2, -hw / 2, ww, hw)
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
    if (ui.interiorMode) {
      // 内部模块层：隐藏主体与炮位，露出底座格阵（与底座格 1:1 对齐）+ 已建模块 + 建造幽灵
      const shapeSet = fortressShapeSet(fd)
      const iSet = fortressInteriorSet(fd) // 内部自由格阵（interiorCells 优先，缺省 cols×rows）
      for (const k of iSet) { // 内部格阵逐格：仅落在形状格内的格子可摆放（镂空格不可见不可建）
        const [cx, cy] = k.split(',').map(Number)
        if (!shapeSet.has(`${cx},${cy}`)) continue
        ctx.fillStyle = 'rgba(20,22,20,0.55)'
        ctx.fillRect(fx + cx * cell, fy + cy * cell, cell, cell)
        ctx.strokeStyle = 'rgba(200,181,104,0.35)'
        ctx.lineWidth = 1
        ctx.strokeRect(fx + cx * cell, fy + cy * cell, cell, cell)
      }
      // 特殊格高亮：置于其上的模块对应属性 ×1.5（类别色 + 首字标记）
      const BOOST_COLOR: Record<string, string> = {
        energy: '#D8B84A', ammo: '#B5793A', cooling: '#5FA8A0', repair: '#7EA06E', range: '#8A7FC0',
        produce: '#B58AB0', hp: '#A86A5A', speed: '#6A90B8', turn: '#B8A86A',
      }
      for (const c of fd.interiorSpecials ?? []) {
        if (!shapeSet.has(`${c.x},${c.y}`)) continue
        const col = BOOST_COLOR[c.boost] ?? '#C8B568'
        ctx.fillStyle = col + '55'
        ctx.fillRect(fx + c.x * cell + 1, fy + c.y * cell + 1, cell - 2, cell - 2)
        ctx.strokeStyle = col
        ctx.lineWidth = 2
        ctx.strokeRect(fx + c.x * cell + 1, fy + c.y * cell + 1, cell - 2, cell - 2)
        ctx.fillStyle = col
        ctx.font = `bold ${Math.max(7, cell * 0.24)}px sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(SPECIAL_BOOST_NAME[c.boost][0], fx + (c.x + 0.5) * cell, fy + (c.y + 0.5) * cell)
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
              fx + (m.x + c.x) * cell + 1.5, fy + (m.y + c.y) * cell + 1.5, cell - 3, cell - 3,
            )
          }
        } else {
          ctx.fillStyle = md.color
          for (const c of mCells) ctx.fillRect(fx + (m.x + c.x) * cell + 1.5, fy + (m.y + c.y) * cell + 1.5, cell - 3, cell - 3)
        }
        ctx.strokeStyle = '#1A1A18'
        ctx.lineWidth = 1.5
        for (const c of mCells) ctx.strokeRect(fx + (m.x + c.x) * cell + 1.5, fy + (m.y + c.y) * cell + 1.5, cell - 3, cell - 3)
        ctx.fillStyle = '#141614'
        ctx.font = `${Math.max(7, cell * 0.2)}px sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(md.name, fx + (m.x + foot.w / 2) * cell, fy + (m.y + foot.h / 2) * cell)
        ctx.textBaseline = 'alphabetic'
      }
      if (ui.interiorGhost) {
        const g = ui.interiorGhost
        ctx.fillStyle = g.ok ? 'rgba(126,160,110,0.5)' : 'rgba(178,74,63,0.5)'
        ctx.strokeStyle = g.ok ? '#2E5B2E' : '#7A2E2A'
        ctx.lineWidth = 2
        if (g.cells) { // v2.31 异型逐格幽灵
          for (const c of g.cells) {
            ctx.fillRect(fx + (g.x + c.x) * cell, fy + (g.y + c.y) * cell, cell, cell)
            ctx.strokeRect(fx + (g.x + c.x) * cell, fy + (g.y + c.y) * cell, cell, cell)
          }
        } else {
          ctx.fillRect(fx + g.x * cell, fy + g.y * cell, g.w * cell, g.h * cell)
          ctx.strokeRect(fx + g.x * cell, fy + g.y * cell, g.w * cell, g.h * cell)
        }
      }
    } else {
      // 主体层：主体贴图（有则替代甲板底色）+ 船艏标记（指示朝向） + 可见炮位
      // 刹停惯性前倾：世界系位移 → 船体系（上下文已 rotate(heading)，逆旋转换算）
      const lh = s.fortress.heading
      const lx = s.fortress.leanX * Math.cos(lh) + s.fortress.leanY * Math.sin(lh)
      const ly = -s.fortress.leanX * Math.sin(lh) + s.fortress.leanY * Math.cos(lh)
      ctx.save()
      ctx.translate(lx, ly)
      const bodyImg = fortressSprite(fd.spriteBody)
      if (bodyImg) {
        // 主体贴图：原比例显示（不缩放），并把 alpha 缓存给敌方弹丸主体命中检测。
        if (fd.spriteBody) registerFortressBodyImage(fd.spriteBody, bodyImg)
        const zm = v.cell / BASE_CELL // v1.49：基准格统一 30px
        const dw = bodyImg.naturalWidth * zm
        const dh = bodyImg.naturalHeight * zm
        const paintedBody = fd.paint?.base ? tintedFx(bodyImg, fd.paint.base, 'multiply') : null
        ctx.drawImage(paintedBody ?? bodyImg, fx + (fw - dw) / 2, fy + (fh - dh) / 2, dw, dh)
      } else {
        ctx.strokeStyle = 'rgba(26,26,24,0.35)'
        ctx.lineWidth = 1.5
        ctx.strokeRect(fx + cell * 0.5, fy + cell * 0.45, fw - cell * 1.0, fh - cell * 0.9)
      }
      for (const decal of fd.decals ?? []) {
        const img = trackTileImage(decal.asset)
        if (!img) continue
        const size = Math.max(0.1, decal.size) * cell
        const ratio = img.width / Math.max(1, img.height)
        ctx.save()
        ctx.translate(fx + decal.x * cell, fy + decal.y * cell)
        ctx.rotate((decal.angle ?? 0) * Math.PI / 180)
        ctx.drawImage(img, -size * ratio / 2, -size / 2, size * ratio, size)
        ctx.restore()
      }
      // 结构阶段损伤与命中点贴花：主体贴图之上、炮塔挂点之下；贴图 alpha 严格隔离底座/履带/轮子。
      const bodyDamageStage = fortressDamageStage(s.fortress.hp, s.fortress.maxHp)
      drawFortressDamageOverlay(ctx, s, fd, bodyImg, fx, fy, fw, fh, cell, bodyDamageStage)
      if (typeof window !== 'undefined') {
        (window as unknown as { __tdDamage?: { marks: number; stage: number; flash: number } }).__tdDamage = {
          marks: s.fortress.damageMarks.length, stage: bodyDamageStage, flash: s.fortress.hitFlash,
        }
      }
      // v2.53 毁灭序列：船体渐进变暗（内伤期 0.10→0.45；主爆后焦黑残骸态 0.45→0.75）
      if (s.fortress.dyingT >= 0) {
        const dt53 = s.fortress.dyingT
        const dk = dt53 < DEATH_MAIN_T
          ? 0.1 + (dt53 / DEATH_MAIN_T) * 0.35
          : 0.45 + Math.min(1, (dt53 - DEATH_MAIN_T) / (DEATH_END_T - DEATH_MAIN_T)) * 0.3
        ctx.fillStyle = `rgba(20,18,16,${dk.toFixed(3)})`
        ctx.fillRect(fx, fy, fw, fh)
      }
      ctx.restore()
      ctx.beginPath()
      ctx.moveTo(fx + fw / 2 - cell * 0.22, fy + cell * 0.34)
      ctx.lineTo(fx + fw / 2 + cell * 0.22, fy + cell * 0.34)
      ctx.lineTo(fx + fw / 2, fy + cell * 0.06)
      ctx.closePath()
      ctx.fillStyle = fd.paint?.accent ?? '#C8B568'
      ctx.fill()
      // 可见炮位（S/M/L 标记；隐藏内置炮位不画；挂炮模式高亮匹配位；视界弧线）
      let hpDrawn = 0 // v1.75：本帧绘制的槽位圈数（观测探针）
      let arcDrawn = 0 // v1.80：本帧绘制的视界弧数（观测探针）
      // v1.80：视界弧仅 ①打开炮塔安装界面（卡片栏/挂炮模式，显示全部炮位）或 ②选中炮塔（仅其挂载炮位）时显示
      const showAllArcs = !!(ui.turretPanel || ui.mountDefId)
      const selTurretHp = ui.selectedTurret != null ? s.turrets.find(t => t.id === ui.selectedTurret)?.hardpointId : undefined
      for (const hp of fd.hardpoints) {
        if (hp.hidden) continue
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
    drawHpBar(ctx, X(fr.x), Y(fr.y) - 6, fw, s.fortress.hp / s.fortress.maxHp)
  }

  // ---- 炮塔（编辑模式：LEVEL 初始炮塔由 draft 层接管） ----
  // v1.73：俯仰偏移随主体——挂载炮塔整体随车体前倾平移（画布像素位移，与主体精灵层同帧一致；地面/LEVEL 炮塔与编辑模式不受影响）
  const leanX = s.fortress.leanX
  const leanY = s.fortress.leanY
  const leanOn = !ui.edit && (leanX !== 0 || leanY !== 0)
  let leanN = 0
  // v1.82：按渲染层级排序绘制——尺寸越小越底层（S<M<L）；同尺寸炮位 zLevel 大者在上；同键保持放置顺序（稳定排序）
  const zSorted = [...s.turrets].sort((a, b) => {
    const ka = turretRenderKey(s, a)
    const kb = turretRenderKey(s, b)
    return ka[0] - kb[0] || ka[1] - kb[1]
  })
  if (typeof window !== 'undefined') { // v1.82 观测探针：本帧炮塔绘制顺序（id 列表，靠后=上层）
    (window as unknown as { __tdZ?: number[] }).__tdZ = zSorted.map(t => t.id)
  }
  const turretsGone53 = s.fortress.dyingT >= DEATH_MAIN_T // v2.53：主爆后炮塔随船体损毁，不再绘制
  for (const t of zSorted) {
    if (turretsGone53) break
    if (ui.edit && t.fromLevel) continue
    if (ui.interiorMode) continue // v1.53：内部空间不显示已安装炮塔贴图
    const lean = leanOn && t.hardpointId != null
    if (lean) { ctx.save(); ctx.translate(leanX, leanY); leanN++ }
    drawTurret(ctx, t, v, ui.selectedTurret === t.id, s.muzzles,
      t.hardpointId ? s.fortress.heading : 0,
      t.hardpointId ? hardpointOf(s, t.hardpointId) : undefined, zf)
    if (lean) ctx.restore()
  }
  // v1.73 观测探针：跟随俯仰的炮塔数与位移峰值（ever 为会话峰值，松手归位后不清零，供测试读取）
  if (typeof window !== 'undefined') {
    const w = window as unknown as { __tdLean?: { n: number; max: number; ever: number } }
    const prev = w.__tdLean ?? { n: 0, max: 0, ever: 0 }
    const mag = leanN > 0 ? Math.hypot(leanX, leanY) : 0
    w.__tdLean = { n: leanN, max: mag, ever: Math.max(prev.ever, mag) }
  }

  // ---- v2.71 堡垒护盾：单张灰度六边形瓦片 + 程序命中扩散 / 电弧 / 破盾碎片 ----
  if (!ui.edit && !ui.interiorMode && s.fortress.dyingT < DEATH_MAIN_T) {
    const fr = fortressRect(s)
    const fw = fr.w * cell, fh = fr.h * cell
    const activeHits = s.shieldHits
    const visible = s.fortress.maxShield > 0 && (s.fortress.shield > 0 || activeHits.length > 0)
    const tileImg = activeHits.length > 0 ? trackTileImage('/res/fx/shield_hex_tile_32_v1.png') : null
    const tileTint = tileImg ? tintedFx(tileImg, '#76C8D2') : null
    const fieldImg = visible ? trackTileImage('/res/fx/shield_field_inner_128_v1.png') : null
    const edgeImg = visible ? trackTileImage('/res/fx/shield_edge_glow_64_v1.png') : null
    const fieldTint = fieldImg ? tintedFx(fieldImg, '#6DBCC8') : null
    const edgeTint = edgeImg ? tintedFx(edgeImg, '#B7F4F7') : null
    if (visible) {
      const ratio = s.fortress.maxShield > 0 ? Math.max(0, Math.min(1, s.fortress.shield / s.fortress.maxShield)) : 0
      const pad = Math.max(6, cell * 0.22)
      const hw = fw / 2 + pad, hh = fh / 2 + pad
      const tileSize = Math.max(13, cell * 0.72)
      const tiles = tileTint ? shieldHexLayout(hw, hh, tileSize) : []
      const co = Math.cos(s.fortress.heading), si = Math.sin(s.fortress.heading)
      const localHits = activeHits.map(hit => {
        const dx = (hit.x - (fr.x + fr.w / 2)) * cell
        const dy = (hit.y - (fr.y + fr.h / 2)) * cell
        return { hit, x: dx * co + dy * si, y: -dx * si + dy * co }
      })
      let wholeBreakFlash = 0
      for (const h of localHits) {
        if (!h.hit.broken) continue
        wholeBreakFlash = Math.max(wholeBreakFlash, shieldBreakEnvelope(1 - h.hit.ttl / h.hit.max))
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
      ctx.scale(unfoldScale, unfoldScale)
      // 常态由两张灰度素材动态染色：淡内部场体 + 沿轮廓重复的径向柔光。
      ctx.globalCompositeOperation = 'source-over'
      ctx.globalAlpha = 1
      shieldClipPath(ctx, hw, hh)
      const fieldBaseAlpha = s.fortress.shield > 0 ? (0.022 + ratio * 0.016) * unfoldAlpha : 0
      // 破盾后内部场体立即消失，避免加法闪光把下方战车底盘照成亮色块。
      ctx.fillStyle = `rgba(76, 190, 207, ${fieldBaseAlpha})`
      ctx.fill()
      if (edgeTint && (s.fortress.shield > 0 || wholeBreakFlash > 0)) {
        ctx.globalCompositeOperation = 'lighter'
        const stableEdgeAlpha = s.fortress.shield > 0 ? (0.06 + ratio * 0.055) * unfoldAlpha * unfoldEdgeBoost : 0
        ctx.globalAlpha = Math.min(0.58, stableEdgeAlpha * edgePulse.alpha + wholeBreakFlash * 0.46)
        const glowSize = Math.max(10, cell * 0.56) * edgePulse.width
        for (const p of shieldPerimeterSamples(hw, hh, Math.max(3, cell * 0.16))) {
          ctx.drawImage(edgeTint, p.x - glowSize / 2, p.y - glowSize / 2, glowSize, glowSize)
        }
      }
      ctx.globalCompositeOperation = 'source-over'
      ctx.globalAlpha = unfoldAlpha
      shieldClipPath(ctx, hw, hh)
      const stableStrokeAlpha = s.fortress.shield > 0 ? 0.34 + ratio * 0.12 : 0.04
      ctx.strokeStyle = `rgba(225, 255, 255, ${Math.min(0.92, stableStrokeAlpha * edgePulse.alpha + wholeBreakFlash * 0.7)})`
      ctx.lineWidth = Math.max(0.7, cell * (0.026 * edgePulse.width + wholeBreakFlash * 0.055))
      ctx.stroke()
      shieldClipPath(ctx, hw, hh); ctx.clip()
      if (fieldTint && s.fortress.shield > 0) {
        ctx.globalCompositeOperation = 'lighter'
        const stableFieldAlpha = s.fortress.shield > 0 ? (0.16 + ratio * 0.08) * unfoldAlpha : 0
        const motion = shieldFieldMotion(s.time, hw, hh)
        ctx.save()
        ctx.translate(motion.x1, motion.y1); ctx.rotate(motion.r1)
        ctx.globalAlpha = Math.min(0.58, stableFieldAlpha * motion.a1)
        ctx.drawImage(fieldTint, -hw * 1.13, -hh * 1.13, hw * 2.26, hh * 2.26)
        ctx.restore()
        ctx.save()
        ctx.translate(motion.x2, motion.y2); ctx.rotate(Math.PI + motion.r2)
        ctx.globalAlpha = Math.min(0.48, stableFieldAlpha * motion.a2)
        ctx.drawImage(fieldTint, -hw * 1.12, -hh * 1.12, hw * 2.24, hh * 2.24)
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
          // 破盾也只显现命中格与紧邻一圈；整盾瓦解由电弧和碎片承担，避免六边形全屏常亮。
          if (h.hit.broken && ring <= 1) breakFlash = Math.max(breakFlash, Math.max(0, 1 - progress * 1.4) * 0.22)
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
      fxElapsed(hit)
      if (firstSeen) {
        spawnBurst(fxPool, { x: hit.x, y: hit.y, count: hit.broken ? 7 : 3, speed: hit.broken ? 2.8 : 1.8, life: 0.24, size: 0.035, color: '#B9F4F7', drag: 5, seed: hit.id, streak: true })
        if (hit.broken) {
          // 破盾以整个场体为主体：沿完整轮廓分布式生成碎片，而非只在命中点爆开。
          const padWorld = Math.max(6, cell * 0.22) / cell
          const hwWorld = fr.w / 2 + padWorld, hhWorld = fr.h / 2 + padWorld
          const co = Math.cos(s.fortress.heading), si = Math.sin(s.fortress.heading)
          const cx = fr.x + fr.w / 2, cy = fr.y + fr.h / 2
          const anchors = shieldPerimeterSamples(hwWorld, hhWorld, 0.62)
          const shardSize = shieldShardSize(hwWorld, hhWorld)
          for (let i = 0; i < anchors.length; i++) {
            const p = anchors[i]
            const x = cx + p.x * co - p.y * si
            const y = cy + p.x * si + p.y * co
            spawnBurst(fxPool, { x, y, count: 3, speed: 4.2, life: 0.98, size: shardSize, color: '#83D6DF', drag: 1.9, seed: hit.id + 900 + i * 37, grow: -0.38, shape: 'shieldShard', speedJitter: 0.72, lifeJitter: 0.4, sizeJitter: 0.38 })
          }
        }
      }
    }
  }

  // ---- 船体受击火花：仅未被护盾完全吸收的事件进入本通道；首见一次性发射。 ----
  for (const hit of s.fortressHits) {
    const firstSeen = !fxSeen.has(hit.id)
    fxElapsed(hit)
    const frHit = fortressRect(s)
    const dx = hit.x - (frHit.x + frHit.w / 2), dy = hit.y - (frHit.y + frHit.h / 2)
    const len = Math.max(1e-6, Math.hypot(dx, dy))
    if (firstSeen) {
      spawnBurst(fxPool, {
        x: hit.x, y: hit.y, count: hit.ricochet ? 9 : hit.penetrated ? 7 : 4, speed: hit.ricochet ? 4.2 : hit.penetrated ? 3.3 : 2.2,
        life: 0.24, size: 0.038, color: hit.ricochet ? '#FFE09A' : hit.penetrated ? '#F2B45F' : '#D6C39A', drag: 5.5,
        seed: hit.id, streak: true, dirX: hit.ricochet ? hit.ricochetDx : dx / len, dirY: hit.ricochet ? hit.ricochetDy : dy / len, bias: hit.ricochet ? 0.82 : 0.62,
      })
    }
    if (hit.ricochet) {
      const life = Math.max(0, hit.ttl / hit.max)
      const travel = (1 - life) * 1.35 * cell
      ctx.strokeStyle = `rgba(255,224,154,${(life * 0.9).toFixed(3)})`
      ctx.lineWidth = Math.max(1.2, cell * 0.055)
      ctx.beginPath(); ctx.moveTo(X(hit.x) + hit.ricochetDx * travel, Y(hit.y) + hit.ricochetDy * travel)
      ctx.lineTo(X(hit.x) + hit.ricochetDx * (travel + cell * 0.72), Y(hit.y) + hit.ricochetDy * (travel + cell * 0.72)); ctx.stroke()
    }
  }

  // ---- 敌人 ----
  // 清理已死亡敌人的朝向缓存
  for (const id of prevPos.keys()) {
    if (!s.enemies.some(e => e.id === id)) prevPos.delete(id)
  }
  for (const e of s.enemies) {
    const def = ENEMY_DEFS[e.kind]
    const px = X(e.x)
    const py = Y(e.y)
    const r = def.size * (e.bossSizeScale ?? 1) * cell
    drawEnemy(ctx, e, px, py, r, s.time)
    drawHpBar(ctx, px - r, py - r - 6, r * 2, e.hp / e.maxHp)
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

  // ---- 友军单位（生产模块产出）：士兵=圆+短枪线，坦克=方车体+炮管，战斗机=三角+偏移阴影（高度感） ----
  for (const a of s.allies) {
    const def = ALLY_DEFS[a.kind]
    const px = X(a.x)
    const py = Y(a.y)
    const r = def.size * cell
    const tgt = a.targetId != null ? s.enemies.find(e => e.id === a.targetId) : null
    const ang = tgt ? Math.atan2(tgt.y - a.y, tgt.x - a.x) : -Math.PI / 2 // 默认朝上
    if (def.air) { // 飞行阴影偏移
      ctx.fillStyle = 'rgba(0,0,0,0.25)'
      ctx.beginPath()
      ctx.ellipse(px + r * 0.8, py + r * 1.2, r * 0.9, r * 0.5, 0, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.save()
    ctx.translate(px, py)
    ctx.rotate(ang)
    ctx.fillStyle = a.hitFlash > 0 ? '#E8E4D8' : def.color
    ctx.strokeStyle = '#1A1A18'
    ctx.lineWidth = 2
    if (a.kind === 'soldier') {
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(r * 0.4, 0); ctx.lineTo(r * 1.8, 0); ctx.stroke() // 枪线
    } else if (a.kind === 'tank') {
      ctx.fillRect(-r, -r * 0.75, r * 2, r * 1.5); ctx.strokeRect(-r, -r * 0.75, r * 2, r * 1.5) // 车体
      ctx.beginPath(); ctx.arc(0, 0, r * 0.4, 0, Math.PI * 2); ctx.fill(); ctx.stroke() // 炮塔
      ctx.beginPath(); ctx.moveTo(r * 0.3, 0); ctx.lineTo(r * 1.7, 0); ctx.lineWidth = 3; ctx.stroke() // 炮管
    } else { // plane：三角机身 + 后掠翼
      ctx.beginPath()
      ctx.moveTo(r * 1.4, 0); ctx.lineTo(-r * 0.8, -r * 0.7); ctx.lineTo(-r * 0.4, 0); ctx.lineTo(-r * 0.8, r * 0.7)
      ctx.closePath(); ctx.fill(); ctx.stroke()
    }
    ctx.restore()
    if (a.hp < a.maxHp) drawHpBar(ctx, px - r, py - r - 6, r * 2, a.hp / a.maxHp)
  }

  // ---- 弹道 ----
  // 导弹尾部喷口 glow（远行星号式引擎喷口：glow32 加法混合高亮；贴图/几何两分支共用；v2.46：随尾焰配置门控，无尾焰配置不画）
  // tailY = 弹体局部系尾部位置（下方为正，贴图弹=弹体半高）；width = glow 尺寸（贴图弹自适应贴图宽度）
  const drawEngineGlow = (p: (typeof s.projectiles)[number], tailY = cell * 0.2, width = cell * 0.5) => {
    if (p.kind !== 'missile') return
    // v2.20 喷口焰门控：制导延迟期（未点火）/ burnTime 燃尽滑行期不画
    if ((p.guideDelayLeft ?? 0) > 0) return
    const d20 = defOf(p.defId)
    if (d20.burnTime !== undefined && p.t >= d20.burnTime) return
    const g = srcImage('/res/fx/glow16.png')
    const tint = g.status === 'ready' && g.img ? tintedFx(g.img, '#ffa640') : null // 预着色橙黄火焰（alpha 强度遮罩）
    if (!tint) return
    const fl = glowFlicker(nowFx, p.x * 7 + p.y * 3) // 亮度闪烁 0.85~1.15（高频 sin + 位置相位）
    const fade = p.fading !== undefined ? Math.max(0, p.fading / MISSILE_FADE) : 1 // fading 同步渐隐
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.globalAlpha = fl * fade
    ctx.translate(X(p.x), Y(p.y))
    ctx.rotate(missileVisHeading(p, d20)) // 随可视航向旋转（含 weave 摆动偏置）：局部系下方(+y)即弹尾
    ctx.drawImage(tint, -width / 2, tailY - width * 0.35, width, width) // 中心对齐尾部：水平居中，竖直 65% 偏下
    ctx.restore()
  }
  for (const p of s.projectiles) {
    // v2.20 发动机门控：制导延迟期（未点火）/ burnTime 燃尽滑行期不喷主尾焰、烟尾、喷口焰
    const defP20 = p.kind === 'missile' ? defOf(p.defId) : undefined
    const engineOff20 = defP20 !== undefined && ((p.guideDelayLeft ?? 0) > 0 || (defP20.burnTime !== undefined && p.t >= defP20.burnTime))
    // v2.23 点火大力喷射（v2.24 过渡化）：点火后 1s 内主尾焰强化线性回落（rate ×3→×1 / size ×1.6→×1），替代 v2.20 点火闪光
    const boostT24 = p.t - (p.igniteAtT ?? 0)
    const b24 = defP20 !== undefined && !engineOff20 && p.fading === undefined && boostT24 < 1 ? 1 - boostT24 : 0
    const am = ammoAssetsFor(p.defId)
    if (am) { // §3A.5 贴图弹丸：本体按飞行航向旋转（含导弹 weave 瞬时航向），尺寸 = 几何弹丸量级 × scale
      const img = am.assets.projectile
      const size = img.height * zf // 原尺寸显示（1 贴图像素 = 1 画布像素 × 缩放），宽高比保持
      const bw = size * (img.width / img.height)
      const lift = p.kind === 'shell' ? Math.sin(Math.min(1, p.t) * Math.PI) * cell * 0.8 : 0
      if (p.kind === 'shell') { // 抛物线影子保留
        ctx.fillStyle = 'rgba(0,0,0,0.3)'
        ctx.beginPath(); ctx.arc(X(p.x), Y(p.y), 3, 0, Math.PI * 2); ctx.fill()
      }
      if (p.fading !== undefined) ctx.globalAlpha = Math.max(0, p.fading / MISSILE_FADE) // 导弹 fading 贴图同步渐隐
      const tf = resolveTrailFx(am.ammo)
      if (tf && !engineOff20) { // 粒子尾焰（行为模板分支 standard/inertia/pulse/smoke；rAF 插值位置发射，蛇形导弹拖出弯曲轨迹）；v2.20 发动机门控：未点火/燃尽不喷
        const prev = projPrev.get(p.id) // 弹速估算：相邻帧插值位移 / dt（惯性继承用）
        const pvx = prev && fxDt > 0 ? (p.x - prev.x) / fxDt : 0
        const pvy = prev && fxDt > 0 ? (p.y - prev.y) / fxDt : 0
        projPrev.set(p.id, { x: p.x, y: p.y })
        let rate = tf.rate
        if (tf.template === 'pulse') rate *= 1 + 0.6 * Math.sin(2 * Math.PI * 1.2 * nowFx) // 火焰脉冲：1.2Hz 振荡（0.4~1.6 倍均值）
        rate *= 1 + 2 * b24 // v2.24 大力喷射过渡：速率 ×3 线性回落 ×1
        const acc = (trailAcc.get(p.id) ?? 0) + rate * fxDt
        const n = Math.floor(acc)
        trailAcc.set(p.id, acc - n)
        for (let i = 0; i < n; i++) {
          const ang = p.heading + (Math.random() * 2 - 1) * tf.spread // 散开锥角（弧度）
          const back = 1.5 * (1 - tf.inherit) // 反向余速：惯性越高反向越弱（1=完全随弹）
          spawnTrail(fxPool, p.x, p.y - lift / cell, {
            vx: pvx * tf.inherit - dirX(ang) * back, // 初速 = 弹速×inherit + 反向余速
            vy: pvy * tf.inherit - dirY(ang) * back,
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
        // v2.23 烟尾「持续」窗口：点火后 effDur 秒内喷烟（effDur = min(duration, burnTime)，缺省=整个燃烧期），结束停喷（已有烟团自然消散）
        const effDur23 = tf.smoke ? smokeDuration(tf.smoke.duration, defP20?.burnTime) : undefined
        const smokeOn23 = tf.smoke !== undefined && (effDur23 === undefined || p.t - (p.igniteAtT ?? 0) < effDur23)
        if (tf.smoke && smokeOn23) { // v2.20 长存留烟雾尾迹：与主尾焰并行的第二股粒子流（grow>0 → smoke32 非加法渲染）
          // v2.21：前 40% 寿命膨胀扩散、之后尺寸冻结渐隐消失
          const sAcc = (smokeAcc.get(p.id) ?? 0) + tf.smoke.rate * fxDt
          const sN = Math.floor(sAcc)
          smokeAcc.set(p.id, sAcc - sN)
          for (let i = 0; i < sN; i++) {
            spawnTrail(fxPool, p.x, p.y - lift / cell, {
              vx: pvx * 0.15 + (Math.random() * 2 - 1) * 0.3, // 少量惯性继承 + 横向弥散
              vy: pvy * 0.15 + (Math.random() * 2 - 1) * 0.3,
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
      ctx.rotate(p.kind === 'missile' ? missileVisHeading(p, defOf(p.defId)) : p.heading)
      ctx.drawImage(img, -bw / 2, -size / 2, bw, size)
      ctx.restore()
      ctx.globalAlpha = 1
      // 贴图导弹喷口 glow：尾部 = 贴图中间最下方（局部 +y 半高处），尺寸自适应贴图宽度
      if (p.kind === 'missile' && tf) drawEngineGlow(p, size / 2, bw * 1.3) // v2.46：喷口 glow 随尾焰配置（无配置不画）
      continue
    }
    if (p.kind === 'bullet') { // v2.46：删除默认曳光线（无尾焰配置=无尾迹），仅留弹体圆点
      ctx.fillStyle = '#F5E9C8'
      ctx.strokeStyle = '#1A1A18'
      ctx.lineWidth = 1
      ctx.beginPath(); ctx.arc(X(p.x), Y(p.y), 2.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
    } else if (p.kind === 'shell') {
      // 抛物线高度视觉：影子 + 抬升的弹体
      const hgt = Math.sin(Math.min(1, p.t) * Math.PI)
      ctx.fillStyle = 'rgba(0,0,0,0.3)'
      ctx.beginPath(); ctx.arc(X(p.x), Y(p.y), 3, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = '#9C7B54'
      ctx.strokeStyle = '#1A1A18'
      ctx.lineWidth = 1.5
      ctx.beginPath(); ctx.arc(X(p.x), Y(p.y) - hgt * cell * 0.8, 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
    } else {
      // 导弹：弹体圆点（fading 阶段按剩余比例淡出）；v2.25 删除几何尾焰线，尾部表现交由粒子尾焰/烟尾与喷口 glow
      if (p.fading !== undefined) ctx.globalAlpha = Math.max(0, p.fading / MISSILE_FADE)
      ctx.fillStyle = p.guided ? '#7E6E9C' : '#A05C48'
      ctx.strokeStyle = '#1A1A18'
      ctx.lineWidth = 1.5
      ctx.beginPath(); ctx.arc(X(p.x), Y(p.y), 3.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
      ctx.globalAlpha = 1
    }

    // 导弹尾部喷口 glow：v2.46 起随尾焰配置门控（无尾焰配置 = 无默认尾焰/喷口焰）
    const paGlow = defOf(p.defId).art?.projectile ? projectileArtDef(defOf(p.defId).art!.projectile!) : undefined
    if (p.kind === 'missile' && paGlow && resolveTrailFx(paGlow)) drawEngineGlow(p)
  }

  // 敌方测试实弹：暖红色直线曳光，与玩家弹丸分池，便于观察来袭方向和跳弹。
  for (const p of s.enemyProjectiles) {
    const tail = Math.max(cell * 0.18, Math.hypot(X(p.x) - X(p.px), Y(p.y) - Y(p.py)) * 0.75)
    const hx = dirX(p.heading), hy = dirY(p.heading)
    ctx.strokeStyle = 'rgba(244,116,72,0.82)'
    ctx.lineWidth = Math.max(1.4, cell * 0.055)
    ctx.beginPath(); ctx.moveTo(X(p.x) - hx * tail, Y(p.y) - hy * tail); ctx.lineTo(X(p.x), Y(p.y)); ctx.stroke()
    ctx.fillStyle = '#FFE0A6'; ctx.strokeStyle = '#48251D'; ctx.lineWidth = 1
    ctx.beginPath(); ctx.arc(X(p.x), Y(p.y), Math.max(2, cell * 0.075), 0, Math.PI * 2); ctx.fill(); ctx.stroke()
  }

  // ---- 炮口火光（规范 §5.3：击发时刻炮口点，帧条按渲染帧推进，朝向 = 击发时刻炮口方向不跟随旋转）----
  {
    const live = new Set<number>()
    for (const m of s.muzzles) {
      live.add(m.id)
      if (ui.interiorMode) continue // v1.53：内部空间不画炮口火光（炮塔已隐藏）
      const t = s.turrets.find(tt => tt.id === m.turretId)
      const def = t ? defOf(t.defId) : undefined
      if (!def) continue
      const mLean = !!(t && leanOn && t.hardpointId != null) // v1.73：挂载炮塔的火光随主体俯仰
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
        ctx.translate(X(m.x) + (mLean ? leanX : 0), Y(m.y) + (mLean ? leanY : 0))
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
    for (const fh of s.fortressHits) live.add(fh.id)
    for (const id of [...fxSeen.keys()]) if (!live.has(id)) fxSeen.delete(id)
  }

  // ---- 射线 / 喷射 ----
  for (const t of s.turrets) {
    if (ui.interiorMode) continue // v1.53：内部空间不画射线/喷射（炮塔已隐藏）
    if (!t.firing) continue
    const bLean = leanOn && t.hardpointId != null // v1.73：挂载炮塔的射线/喷射起点随主体俯仰
    const def = defOf(t.defId)
    // §5.4：配置 art 挂点表时光束/喷射起点对齐炮口点（barrel 0）；未配置维持炮塔中心（现状）
    const c = def.art?.barrels?.length ? muzzlePos(t, def, 0) : turretCenter(t)
    if (def.type === 'beam') {
      const len = beamLength(s, t, def)
      const wpx = (def.beamWidth ?? 8) / M_PER_CELL * cell
      const lenPx = len * cell
      // v2.7 远行星号式分层光束：光晕层 + 亮芯层（贴图平铺滚动 + 加法发光 + 亮度闪烁），缺省贴图搭配；
      // 层素材 'none'/未就绪 → 该层回退程序化矩形（颜色/宽度与旧版一致）
      const ba = beamArtConfig(def)
      const ph = t.id * 1.7 // 相位：多炮塔闪烁错开
      const wave = 0.5 + 0.5 * (0.7 * Math.sin(nowFx * 22 + ph) + 0.3 * Math.sin(nowFx * 57 + ph * 2))
      const bright = 1 - ba.flicker + ba.flicker * wave // [1-flicker, 1]
      const scroll = ba.scrollSpeed > 0 ? nowFx * ba.scrollSpeed * (cell / 30) : 0
      ctx.save()
      ctx.translate(X(c.x) + (bLean ? leanX : 0), Y(c.y) + (bLean ? leanY : 0))
      ctx.rotate(t.angle - Math.PI / 2) // 局部 +x 沿光束方向（贴图平铺轴向）
      const glowT = ba.glow?.status === 'ready' && ba.glow.img ? tintedFx(ba.glow.img, ba.fringeColor) : null
      const coreT = ba.core?.status === 'ready' && ba.core.img ? tintedFx(ba.core.img, ba.coreColor) : null
      // v2.50：宽幅已配置 → 贴图高度缩放到 宽幅/25 格（光晕=wpx、亮芯=wpx×0.5）；未配置 = 贴图原生高度（现状）
      const fitB = (im: { height: number } | null, targetH: number) =>
        def.beamWidth !== undefined && im ? targetH / (im.height * (cell / 30)) : 1
      drawBeamLayer(ctx, glowT, ba.fringeColor, lenPx, wpx, 0.45 * bright, scroll, cell / 30, fitB(glowT, wpx)) // v2.15 贴图原生 32px 高（texScale 适配缩放）
      drawBeamLayer(ctx, coreT, ba.coreColor, lenPx, wpx * 0.5, 0.9 * bright, scroll, cell / 30, fitB(coreT, wpx * 0.5))
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
    const t = s.turrets.find(t2 => t2.id === id)
    if (!t || !t.firing) beamFxAcc.delete(id)
  }

  // ---- 光束停火消退：保持停火角度/长度，宽度收窄 + 渐隐（alpha = p^0.7 前期更亮）----
  for (const bf of s.beamFades) {
    const p = Math.max(0, bf.ttl / bf.max) // 1 → 0
    const alpha = Math.pow(p, 0.7)
    const wpx = ((bf.width ?? 8) / M_PER_CELL) * cell * p // 宽度随进度收窄至 0（v2.50：width 可选，未配置回退 8m 仅供几何回退）
    const lenPx = bf.len * cell
    const ba = beamArtConfig(defOf(bf.defId)) // v2.7：消退段沿用 firing 时的光束美术配置
    const scroll = ba.scrollSpeed > 0 ? nowFx * ba.scrollSpeed * (cell / 30) : 0
    ctx.save()
    ctx.translate(X(bf.x), Y(bf.y))
    ctx.rotate(bf.angle - Math.PI / 2) // 局部 +x 沿光束方向
    const glowT = ba.glow?.status === 'ready' && ba.glow.img ? tintedFx(ba.glow.img, ba.fringeColor) : null
    const coreT = ba.core?.status === 'ready' && ba.core.img ? tintedFx(ba.core.img, ba.coreColor) : null
    // v2.50：宽幅已配置 → 贴图高度缩放到 宽幅/25 格（wpx 已含 p 收窄，亮芯不再叠乘 p）；未配置 = 原生高度、亮芯随 p 收窄（现状）
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
    if (ex.kind) { // v2.53 堡垒毁灭演出爆炸（v2.54 起与弹丸爆炸共用画法；固定橙金配色，不依赖弹丸美术库）
      const isMain = ex.kind === 'deathMain'
      const maxTtl = ex.max ?? 0.4
      const firstSeen = !fxSeen.has(ex.id)
      const el = fxElapsed({ id: ex.id, ttl: ex.ttl, max: maxTtl })
      if (firstSeen) {
        const rC = Math.max(0.2, ex.r)
        spawnBurst(fxPool, { x: ex.x, y: ex.y, count: isMain ? 26 : 10, speed: rC * 6, life: 0.5, size: 0.05, color: '#E8A33D', drag: 4, seed: ex.id, speedJitter: 0.4, lifeJitter: 0.3, streak: true })
        spawnBurst(fxPool, { x: ex.x, y: ex.y, count: isMain ? 18 : 7, speed: rC * 1.5, life: 1.1, size: 0.1, color: '#3A3632', drag: 1.5, seed: ex.id + 1, grow: 2, turb: 0.6 })
      }
      drawExplosionLayers(ctx, X, Y, cell, ex, Math.min(1, el / maxTtl), { color: '#D98C2D', rings: isMain ? 2 : 1, ringSpeed: 1, ringWidth: isMain ? 4 : 2.5, fireball: 1, shock: 1, flash: isMain ? 0.8 : 0.4 }, el)
      continue
    }
    const pad = ex.ammoId ? projectileArtDef(ex.ammoId) : undefined
    const ef = pad ? resolveExplosionFx(pad) : null
    if (pad && ef) { // 粒子爆炸（远行星号式，v2.54 四层增强）：火花/烟尘两组粒子（首见 spawn 一次）+ 统一矢量层
      const firstSeen = !fxSeen.has(ex.id)
      const el = fxElapsed({ id: ex.id, ttl: ex.ttl, max: 0.35 })
      if (firstSeen) { // 火花：向外高速+强 drag+短寿命+亮色+拉丝（速度/寿命 jitter）；烟尘：低速+长寿命+膨胀+暗色+湍流
        const rC = Math.max(0.2, ex.r) // 世界半径（格），速度/尺寸按爆炸半径缩放
        const inh = ef.inherit * (ex.hspeed ?? 0) // 速度继承速率（事件带命中弹丸速率）
        spawnBurst(fxPool, {
          x: ex.x, y: ex.y, count: ef.sparks, speed: rC * 6, life: 0.5, size: 0.05, color: ef.color, drag: 4, seed: ex.id,
          speedJitter: ef.speedJitter, lifeJitter: ef.lifeJitter, streak: ef.streak === 1, // v2.54 拉丝可关
          dirX: ex.hx, dirY: ex.hy, bias: ef.bias,
          inheritVx: ex.hx !== undefined ? ex.hx * inh : 0, inheritVy: ex.hy !== undefined ? ex.hy * inh : 0,
        })
        spawnBurst(fxPool, {
          x: ex.x, y: ex.y, count: ef.smoke, speed: rC * 1.5, life: 0.9, size: 0.1, color: '#3A3632', drag: 1.5, seed: ex.id + 1, grow: 2, turb: ef.turbulence,
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
    const pad = projectileArtDef(im.ammoId)
    const inf = pad ? resolveImpactFx(pad) : null
    if (pad && inf) { // 粒子命中：碎屑飞溅（spikes 个短寿命粒子，首见 spawn 一次）+ 中心亮点一闪（矢量）
      const firstSeen = !fxSeen.has(im.id)
      const el = fxElapsed(im)
      if (firstSeen) {
        spawnBurst(fxPool, { x: im.x, y: im.y, count: inf.spikes, speed: 3, life: 0.25, size: 0.04, color: inf.color, drag: 6, seed: im.id })
      }
      if (el >= inf.duration) continue
      drawImpactFlash(ctx, X, Y, im.x, im.y, el / inf.duration) // 中心亮点一闪（v2.55 走 fxDraw 共用层）
      continue
    }
    // 未配置命中特效：不播放任何效果（旧 impact.png 帧条回退已移除——特效一律以配置为准）
  }

  // ---- 粒子层（空中层；地面层已在堡垒底座之下先行绘制）----
  if (typeof window !== 'undefined') { (window as unknown as { __tdFx?: number }).__tdFx = fxPool.parts.length } // v1.83 无头探针：存活特效粒子数
  drawParticlePool(ctx, fxPool, X, Y, cell, nowFx)

  // ---- 曳光 / 脉冲射线 ----
  for (const tr of s.tracers) {
    if (tr.pulse) {
      // 脉冲点射：细亮射线（炮口→命中点，ttl 0.07s 闪烁 1–2 帧）
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
        const scroll = ba.scrollSpeed > 0 ? nowFx * ba.scrollSpeed * (cell / 30) : 0
        ctx.save()
        ctx.translate(X(tr.x1), Y(tr.y1))
        ctx.rotate(Math.atan2(dyp, dxp))
        drawBeamLayer(ctx, glowT, ba.fringeColor, lenPx, w, 0.6 * a, scroll, cell / 30) // v2.15 原生尺寸
        drawBeamLayer(ctx, coreT, ba.coreColor, lenPx, w * 0.5, 0.95 * a, scroll, cell / 30)
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
    for (const t of eo.terrain) {
      ctx.fillStyle = 'rgba(94,112,120,0.7)'
      ctx.fillRect(X(t.x), Y(t.y), t.w * cell, t.h * cell)
      ctx.strokeStyle = '#1A1A18'
      ctx.lineWidth = 1
      ctx.strokeRect(X(t.x), Y(t.y), t.w * cell, t.h * cell)
    }
    for (const o of eo.objects) {
      ctx.fillStyle = o.kind === 'barrel' ? 'rgba(160,92,72,0.85)' : o.kind === 'ruins' ? 'rgba(90,86,78,0.85)' : 'rgba(122,114,100,0.85)'
      ctx.fillRect(X(o.x), Y(o.y), o.w * cell, o.h * cell)
      ctx.strokeStyle = '#1A1A18'
      ctx.lineWidth = 1
      ctx.strokeRect(X(o.x), Y(o.y), o.w * cell, o.h * cell)
    }
    {
      // 编辑层初始墙：同样按连通规则（共享边不描边）
      const eoCells = new Set(eo.walls.map(w => `${w.x},${w.y}`))
      ctx.fillStyle = 'rgba(155,148,132,0.9)'
      for (const w of eo.walls) ctx.fillRect(X(w.x), Y(w.y), cell, cell)
      ctx.strokeStyle = '#1A1A18'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      for (const w of eo.walls) {
        const px = X(w.x)
        const py = Y(w.y)
        if (!eoCells.has(`${w.x},${w.y - 1}`)) { ctx.moveTo(px, py); ctx.lineTo(px + cell, py) }
        if (!eoCells.has(`${w.x + 1},${w.y}`)) { ctx.moveTo(px + cell, py); ctx.lineTo(px + cell, py + cell) }
        if (!eoCells.has(`${w.x},${w.y + 1}`)) { ctx.moveTo(px + cell, py + cell); ctx.lineTo(px, py + cell) }
        if (!eoCells.has(`${w.x - 1},${w.y}`)) { ctx.moveTo(px, py + cell); ctx.lineTo(px, py) }
      }
      ctx.stroke()
    }
    for (const b of eo.buildings) {
      ctx.fillStyle = b.color
      ctx.globalAlpha = 0.85
      ctx.fillRect(X(b.x), Y(b.y), b.w * cell, b.h * cell)
      ctx.globalAlpha = 1
      ctx.strokeStyle = '#1A1A18'
      ctx.lineWidth = 2
      ctx.strokeRect(X(b.x), Y(b.y), b.w * cell, b.h * cell)
    }
    for (const [z, color, label] of [[eo.startZone, '#3E7D46', '起点'], [eo.finishZone, '#D9A441', '终点']] as const) {
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
    for (const t of eo.interactables) {
      const color = t.enabled ? (t.kind === 'supply' ? '#3E7D46' : t.kind === 'gate' ? '#5C7E8C' : t.kind === 'target' ? '#D9762E' : '#8A5C9E') : '#777269'
      ctx.fillStyle = `${color}${t.selected ? '42' : '24'}`
      ctx.fillRect(X(t.x), Y(t.y), t.w * cell, t.h * cell)
      ctx.strokeStyle = color
      ctx.lineWidth = t.selected ? 3 : 2
      ctx.setLineDash([3, 3])
      ctx.strokeRect(X(t.x), Y(t.y), t.w * cell, t.h * cell)
      ctx.setLineDash([])
      ctx.fillStyle = color
      ctx.font = `bold ${Math.max(10, cell * 0.34)}px sans-serif`
      ctx.fillText(`交互 · ${t.name}`, X(t.x) + 4, Y(t.y) + Math.max(12, cell * 0.42))
    }
    if (eo.core) {
      // 核心：金色虚线框
      ctx.strokeStyle = '#D9A441'
      ctx.lineWidth = 2
      ctx.setLineDash([4, 3])
      ctx.strokeRect(X(eo.core.x), Y(eo.core.y), eo.core.w * cell, eo.core.h * cell)
      ctx.setLineDash([])
    }
    for (const t of eo.turrets) { // §7.3：编辑器态复用 drawTurret（含 art 分层/回退），与战斗态表现一致
      const def = TURRET_DEFS.find(d => d.id === t.defId)
      if (!def) continue
      const pseudo: Turret = {
        id: -1, defId: t.defId, x: t.x, y: t.y, w: def.w, h: def.h, level: 1,
        hp: def.hp, maxHp: def.hp, angle: 0, cooldown: 0, burstLeft: 0, burstTimer: 0,
        rackLeft: def.type === 'missile' ? Math.max(1, def.burst ?? 1) : 0, // 编辑器伪炮塔满挂展示
        rackAnim: 0,
        rackTimer: 0,
        chargeLeft: 0, firing: false, firingLeft: 0, tickTimer: 0,
        targetId: null, barrelIdx: 0,
      }
      ctx.globalAlpha = 0.9 // 编辑层轻微半透明以示区分
      drawTurret(ctx, pseudo, v, false, [], 0, undefined, zf)
      ctx.globalAlpha = 1
    }
    if (eo.hover) {
      const h = eo.hover
      ctx.strokeStyle = h.ok ? '#3E7D46' : '#B3392E'
      ctx.lineWidth = 2
      ctx.strokeRect(X(h.x) + 1, Y(h.y) + 1, h.w * cell - 2, h.h * cell - 2)
    }
  }

  // ---- 飘字 ----
  ctx.font = `bold ${Math.max(10, cell * 0.36)}px sans-serif`
  ctx.textAlign = 'center'
  for (const f of s.floats) {
    ctx.globalAlpha = Math.min(1, f.ttl / 0.4)
    ctx.fillStyle = '#D9A441'
    ctx.strokeStyle = '#1A1A18'
    ctx.lineWidth = 2
    ctx.strokeText(f.text, X(f.x), Y(f.y) - (0.8 - f.ttl) * 20)
    ctx.fillText(f.text, X(f.x), Y(f.y) - (0.8 - f.ttl) * 20)
    ctx.globalAlpha = 1
  }

  // ---- 拖动边界提示条（右缘迷你滚动条） ----
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
}

/** 敌人绘制：像素精灵（方向帧 + 行走动画），缺失时降级为圆形 */
function drawEnemy(ctx: CanvasRenderingContext2D, e: Enemy, px: number, py: number, r: number, time: number) {
  const def = ENEMY_DEFS[e.kind]
  const group = ENEMY_SPRITE[e.kind]

  // 依据位移速度向量推算朝向（渲染帧间位移）
  const prev = prevPos.get(e.id)
  let dx = 0
  let dy = 0
  if (prev) { dx = e.x - prev.x; dy = e.y - prev.y }
  const moving = Math.abs(dx) + Math.abs(dy) > 1e-4
  let dir: SpriteDir
  if (Math.abs(dx) > Math.abs(dy)) dir = dx < 0 ? 'left' : 'right'
  else dir = dy < 0 ? 'back' : 'front'
  prevPos.set(e.id, { x: e.x, y: e.y })

  // 帧选择：移动时静态帧↔行走帧约 4 次/秒交替；back/left 无行走帧
  const imgDir = dir === 'left' ? 'right' : dir
  const walkPhase = moving && Math.floor(time * 4) % 2 === 1
  let img: HTMLImageElement | null = null
  let walkMissing = false
  if (walkPhase) {
    img = spriteImage(group, imgDir, true)
    walkMissing = img === null // 行走帧缺失（back 方向或未生成/加载失败）
  }
  if (!img) img = spriteImage(group, imgDir, false)

  if (img) {
    // 行走帧缺失时：静态帧 + 轻微上下颠簸
    const bob = walkPhase && walkMissing ? Math.round(Math.sin(time * 10) * 1.5) : 0
    const lift = def.air ? 6 : 0
    if (def.air) {
      // 飞行单位：地面椭圆阴影
      ctx.fillStyle = 'rgba(0,0,0,0.25)'
      ctx.beginPath()
      ctx.ellipse(px, py + 1, r * 0.9, r * 0.35, 0, 0, Math.PI * 2)
      ctx.fill()
    }
    const scaleH = def.kind === 'brute' ? 1.35 : 1.15
    const h = r * 2 * scaleH // 精灵高 ≈ 半径×2（米换算像素）× 系数
    const w = h * (img.naturalWidth / img.naturalHeight)
    ctx.save()
    if (e.hitFlash > 0) {
      ctx.shadowColor = '#fff'
      ctx.shadowBlur = 6
    }
    ctx.imageSmoothingEnabled = false // 像素风锐利
    if (dir === 'left') {
      // left 用 right 图水平镜像
      ctx.translate(px, py - lift + bob)
      ctx.scale(-1, 1)
      ctx.drawImage(img, -w / 2, -h, w, h) // 脚底锚定在敌人位置点
    } else {
      ctx.drawImage(img, px - w / 2, py - lift + bob - h, w, h)
    }
    ctx.restore()
    return
  }

  // ---- 最终降级：圆形绘制 ----
  ctx.save()
  if (e.hitFlash > 0) {
    ctx.shadowColor = '#fff'
    ctx.shadowBlur = 6
  }
  ctx.fillStyle = e.dots.length > 0 ? '#B3702E' : def.color
  ctx.strokeStyle = '#1A1A18'
  ctx.lineWidth = 2
  if (def.air) {
    ctx.beginPath()
    ctx.moveTo(px, py - r)
    ctx.lineTo(px + r, py + r * 0.7)
    ctx.lineTo(px - r, py + r * 0.7)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
  } else {
    ctx.beginPath()
    ctx.arc(px, py, r, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = '#1A1A18'
    ctx.beginPath(); ctx.arc(px - r * 0.35, py - r * 0.2, 1.6, 0, Math.PI * 2); ctx.fill()
    ctx.beginPath(); ctx.arc(px + r * 0.35, py - r * 0.2, 1.6, 0, Math.PI * 2); ctx.fill()
  }
  ctx.restore()
}

function drawHpBar(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, ratio: number) {
  if (ratio >= 1) return
  ctx.fillStyle = '#1A1A18'
  ctx.fillRect(x, y, w, 4)
  ctx.fillStyle = ratio < 0.35 ? '#B3392E' : '#D9A441'
  ctx.fillRect(x, y, w * Math.max(0, ratio), 4)
}

/** 炮管挂点表（渲染用）：配置 art.barrels 时以表为准（§7.1）；未配置按逻辑炮管数自动生成（单管 [0,0]，多管均布，与 muzzlePos 同规则） */
/** 炮口事件首次渲染时刻缓存（表现层状态：后坐/火光按渲染帧时间推进，不进逻辑 state） */
const fxSeen = new Map<number, number>()
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
 *  animK<1 时复挂推入——渐显 + 沿尾部方向滑入挂载位（仅复挂触发，初始放置 animK=1 不播） */
function drawRackMissiles(
  ctx: CanvasRenderingContext2D, v: ViewCtx, t: Turret, def: ReturnType<typeof defOf>,
  bi: number, count: number, ammo: ReturnType<typeof projectileArtDef>, animK: number, newestSlot: number,
  zf = v.cell / 30,
) {
  if (count <= 0) return
  const { cell, viewX, viewY } = v
  const st = ammo ? projectileArtState(ammo) : null
  const img = st?.status === 'ready' ? st.assets?.projectile : undefined
  const size = img ? img.height * zf : cell * 0.34 // 贴图=原尺寸显示（1 贴图像素 = 1 画布像素 × 缩放）；几何回退=固定基准
  for (let j = 0; j < count; j++) {
    const k = j === newestSlot ? animK : 1 // 推入动画仅作用最新复挂那枚，其余不受影响
    const pushJ = (1 - k) * 0.3 // 推入偏移（格，沿尾部方向）
    const p = rackMissilePos(t, def, bi, j)
    const px = (p.x - dirX(t.angle) * pushJ - viewX) * cell
    const py = (p.y - dirY(t.angle) * pushJ - viewY) * cell
    ctx.save()
    ctx.globalAlpha *= k // 渐显
    ctx.translate(px, py)
    ctx.rotate(t.angle) // 弹体朝向 = 炮口方向（素材朝上，与炮塔同约定）
    if (img) { // 弹丸贴图
      const bw = size * (img.width / img.height)
      ctx.drawImage(img, -bw / 2, -size / 2, bw, size)
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
  assets: TurretArtAssets, muzzles: MuzzleEvent[], baseAngle: number, zf: number,
) {
  const { cell, viewX, viewY } = v
  const px = (t.x - viewX) * cell
  const py = (t.y - viewY) * cell
  const w = t.w * cell
  const h = t.h * cell
  const F = zf // 原尺寸显示：zoom=1 时 1 贴图像素 = 1 画布像素，随缩放等比变化（编辑器预览 F=1，与之一致）
  const A = 30 * zf // 美术坐标空间：固定 30px=1格（挂点/炮口/后座/充能偏移换算），与编辑器预览 P30 严格对应，zoom=1 时两边逐像素一致
  const prevSmooth = ctx.imageSmoothingEnabled
  ctx.imageSmoothingEnabled = false // 像素风：最近邻
  // 1. 底座层（跟随堡垒朝向：挂载炮塔底座随船体旋转；地面炮塔 baseAngle=0 不旋转；原始尺寸，居中于占格）
  //    逐层降级：无底座贴图 → 几何色块底座（与整体回退视觉一致）
  const geoBase = () => {
    ctx.fillStyle = def.color
    ctx.fillRect(px + 1, py + 1, w - 2, h - 2)
    ctx.strokeStyle = '#1A1A18'
    ctx.lineWidth = 2
    ctx.strokeRect(px + 1, py + 1, w - 2, h - 2)
  }
  if (def.art?.baseAsset === 'none') {
    // 底座选配「无」（默认）：不绘制底座层，塔体直接落地
  } else if (baseAngle !== 0) {
    ctx.save()
    ctx.translate(px + w / 2, py + h / 2)
    ctx.rotate(baseAngle)
    ctx.translate(-(px + w / 2), -(py + h / 2))
    if (assets.base) ctx.drawImage(assets.base, px + (w - assets.base.width * F) / 2, py + (h - assets.base.height * F) / 2, assets.base.width * F, assets.base.height * F)
    else geoBase()
    ctx.restore()
  } else if (assets.base) {
    ctx.drawImage(assets.base, px + (w - assets.base.width * F) / 2, py + (h - assets.base.height * F) / 2, assets.base.width * F, assets.base.height * F)
  } else {
    geoBase()
  }
  const a = def.art?.anchor ?? [0.5, 0.5]
  const ax = (t.x - viewX + a[0] * t.w) * cell
  const ay = (t.y - viewY + a[1] * t.h) * cell
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
      if (def.art?.barrelAsset === 'none') return // 炮管选配「无」：跳过炮管层（挂点/炮口/火光逻辑不受影响）
      ctx.save()
      ctx.translate(b.mount[0] * A, -b.mount[1] * A + shift * A)
      if (assets.barrel) { // 贴图炮管：原始尺寸（30px=1格基准，与炮身图分辨率解耦）
        const bw = assets.barrel.width * F
        const bh = assets.barrel.height * F
        ctx.drawImage(assets.barrel, -bw / 2, -bh, bw, bh)
      } else { // 逐层降级：无炮管贴图 → 几何炮管线（挂点起，沿炮口方向）
        const nB = Math.max(1, mounts.length)
        ctx.strokeStyle = '#1A1A18'
        ctx.lineWidth = nB > 1 ? Math.max(2, cell * 0.14 / Math.min(nB, 3)) : Math.max(3, cell * 0.14)
        ctx.beginPath()
        ctx.moveTo(0, 0)
        ctx.lineTo(0, -Math.min(w, h) * 0.55)
        ctx.stroke()
      }
      ctx.restore()
    })
  }
  const barrelBelow = (def.art?.zBias ?? 0) < 0 // zBias < 0：炮管压到炮身之下（根部被炮身遮盖）；>= 0：炮管在上（默认）
  // 2. 炮身层（画布中心 = 旋转轴心）；zBias<0 时炮管先画在炮身下
  if (barrelBelow) drawBarrels()
  if (assets.turret) ctx.drawImage(assets.turret, -assets.turret.width * F / 2, -assets.turret.height * F / 2, assets.turret.width * F, assets.turret.height * F) // 原始尺寸，画布中心=轴心
  else { // 逐层降级：无炮身贴图 → 几何圆座（与整体回退视觉一致）
    ctx.fillStyle = '#2A2A26'
    ctx.beginPath()
    ctx.arc(0, 0, Math.min(w, h) * 0.2, 0, Math.PI * 2)
    ctx.fill()
  }
  // 3. 辉光层（可选；默认仅过热）
  if (assets.glow && v.overheated && (def.art?.glow?.overheatOnly ?? true)) {
    ctx.drawImage(assets.glow, -assets.glow.width * F / 2, -assets.glow.height * F / 2, assets.glow.width * F, assets.glow.height * F)
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
  state: { chargeProgress?: number | null; firing?: boolean; fireElapsed?: (number | null)[]; overheated?: boolean } = {},
) {
  const t: Turret = {
    id: -900, defId: def.id, x: box.x / box.cell, y: box.y / box.cell, w: def.w, h: def.h,
    level: 1, hp: def.hp, maxHp: def.hp, angle: 0, cooldown: 0, burstLeft: 0,
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
  if (artEntry.status === 'ready' && artEntry.assets) {
    drawTurretLayers(ctx, t, def, v, artEntry.assets, muzzles, 0, 1)
    return
  }
  const px = box.x, py = box.y, w = def.w * box.cell, h = def.h * box.cell
  if (def.art?.baseAsset !== 'none') { ctx.fillStyle = def.color; ctx.fillRect(px + 1, py + 1, w - 2, h - 2) }
  const a = def.art?.anchor ?? [0.5, 0.5]
  const ax = px + a[0] * w, ay = py + a[1] * h
  ctx.strokeStyle = '#A8A28C'; ctx.lineWidth = 1.5
  for (const b of artMounts(t, def)) { ctx.beginPath(); ctx.moveTo(ax + b.mount[0] * 30, ay - b.mount[1] * 30); ctx.lineTo(ax + b.muzzle[0] * 30, ay - b.muzzle[1] * 30); ctx.stroke() }
  ctx.fillStyle = '#4A4740'; ctx.beginPath(); ctx.arc(ax, ay, Math.min(w, h) * 0.2, 0, Math.PI * 2); ctx.fill()
}

function drawTurret(ctx: CanvasRenderingContext2D, t: Turret, v: ViewCtx, selected: boolean, muzzles: MuzzleEvent[], baseAngle = 0, hp?: { arc?: { start: number; end: number }; fixed?: number }, zf = v.cell / 30) {
  const { cell, viewX, viewY } = v
  const def = defOf(t.defId)
  const px = (t.x - viewX) * cell
  const py = (t.y - viewY) * cell
  const w = t.w * cell
  const h = t.h * cell
  // 贴图管线 ready → 分层渲染（逐层降级：ready 层贴图 + 缺失层几何补绘）；loading/fallback → 整体几何绘制
  const artEntry = turretArtState(def)
  if (artEntry.status === 'ready' && artEntry.assets) {
    drawTurretLayers(ctx, t, def, v, artEntry.assets, muzzles, baseAngle, zf)
    if (selected) { // 选中描边保留
      ctx.strokeStyle = '#B3392E'
      ctx.lineWidth = 3
      ctx.strokeRect(px + 1, py + 1, w - 2, h - 2)
    }
  } else {
    // 底座（挂载炮塔随船体朝向旋转）；选配「无」→ 跳过色块底座，仅保留选中描边
    ctx.save()
    if (baseAngle !== 0) {
      ctx.translate(px + w / 2, py + h / 2)
      ctx.rotate(baseAngle)
      ctx.translate(-(px + w / 2), -(py + h / 2))
    }
    if (def.art?.baseAsset !== 'none') {
      ctx.fillStyle = def.color
      ctx.fillRect(px + 1, py + 1, w - 2, h - 2)
      ctx.strokeStyle = selected ? '#B3392E' : '#1A1A18'
      ctx.lineWidth = selected ? 3 : 2
      ctx.strokeRect(px + 1, py + 1, w - 2, h - 2)
    } else if (selected) {
      ctx.strokeStyle = '#B3392E'
      ctx.lineWidth = 3
      ctx.strokeRect(px + 1, py + 1, w - 2, h - 2)
    }
    ctx.restore()
    // 炮管（可见转向；多联炮管 = 平行排列，沿垂直炮口方向均布）
    const c = turretCenter(t)
    const cx = (c.x - viewX) * cell
    const cy = (c.y - viewY) * cell
    const barrelLen = Math.min(w, h) * 0.55
    const nBarrels = Math.max(1, Math.floor(def.barrels ?? 1))
    const lineW = nBarrels > 1 ? Math.max(2, cell * 0.14 / Math.min(nBarrels, 3)) : Math.max(3, cell * 0.14)
    ctx.strokeStyle = '#1A1A18'
    ctx.lineWidth = lineW
    ctx.beginPath()
    for (let i = 0; i < nBarrels; i++) {
      const lat = nBarrels > 1 ? (i - (nBarrels - 1) / 2) * ((t.w * 0.6) / (nBarrels - 1)) : 0 // 与 muzzlePos 同规则
      const bx = cx + (-dirY(t.angle)) * lat * cell
      const by = cy + dirX(t.angle) * lat * cell
      ctx.moveTo(bx, by)
      ctx.lineTo(bx + dirX(t.angle) * barrelLen, by + dirY(t.angle) * barrelLen)
    }
    ctx.stroke()
    if (def.type === 'missile' && (def.art?.rack?.show ?? true) && t.rackLeft > 0) { // 几何塔挂载显示（共享定位 + 复挂推入）
      const ammoId = def.art?.projectile
      const ammo = ammoId ? projectileArtDef(ammoId) : undefined
      const counts = rackCounts(t, def, nBarrels)
      const animK = t.rackAnim > 0 ? 1 - t.rackAnim / RACK_RELOAD_ANIM : 1
      const newestBi = t.rackAnim > 0 && t.rackLeft > 0
        ? (((def.barrelMode ?? 'salvo') === 'sequential' ? t.barrelIdx : 0) + t.rackLeft - 1) % nBarrels
        : -1
      for (let i = 0; i < nBarrels; i++) {
        drawRackMissiles(ctx, v, t, def, i, counts[i] ?? 0, ammo, animK, i === newestBi ? (counts[i] ?? 1) - 1 : -1, zf)
      }
    }
    ctx.fillStyle = '#2A2A26'
    ctx.beginPath()
    ctx.arc(cx, cy, Math.min(w, h) * 0.2, 0, Math.PI * 2)
    ctx.fill()
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
