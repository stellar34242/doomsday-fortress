/** 堡垒特效点粒子发射（v2.40）：发射点贴附船体（随 heading 旋转的世界坐标），
 *  粒子离口即在世界空间独立运动——已散发的烟/尘不再跟着堡垒移动。
 *  双通道：ground 池 = 地面层（地形之上/载具及行走部件之下，尘土等）；air 池 = 空中层（最上，烟雾/火焰/火花）。
 *  纯函数可 sim；render 持两个粒子池与发射累加器按 rAF 驱动。 */
import type { FortressDef, FortressEffectKind, FortressEffectLayer, FortressEffectPoint } from './config'
import { BASE_CELL } from './config'
import { spawnTrail, type ParticlePool } from './particles'
import { fortressDef, fortressLocalCenter, fortressMarkColumns, fortressRect, wheelVisualSteerAngle, type GameState } from './engine'

/** 特效点解析后的发射参数（缺省按 kind） */
export interface FortressEffectParams {
  layer: FortressEffectLayer
  rate: number // 粒/s
  size: number // 格
  life: number // 秒
  inherit: number // 堡垒速度继承 0~1
}

/** v2.40 各 kind 缺省口径：尘土走地面层+继承 0.3（被车带起前扬）；烟囱烟垂直上升不随车 */
const KIND_DEFAULTS: Record<FortressEffectKind, FortressEffectParams> = {
  smoke: { layer: 'air', rate: 8, size: 0.12, life: 1.3, inherit: 0 },
  flame: { layer: 'air', rate: 24, size: 0.08, life: 0.28, inherit: 0 },
  dust: { layer: 'ground', rate: 14, size: 0.14, life: 0.9, inherit: 0.3 },
  spark: { layer: 'air', rate: 7, size: 0.05, life: 0.22, inherit: 0 },
}

export function effectParams(e: FortressEffectPoint): FortressEffectParams {
  const d = KIND_DEFAULTS[e.kind]
  return {
    layer: e.layer ?? d.layer,
    rate: e.rate ?? d.rate,
    size: e.size ?? d.size,
    life: e.life ?? d.life,
    inherit: e.inherit ?? d.inherit,
  }
}

/** 特效点局部坐标 → 世界坐标（格）：随堡垒位置 + heading 旋转（与 render 堡垒上下文同一变换） */
export function effectWorldPos(s: GameState, e: FortressEffectPoint): { x: number; y: number } {
  const fr = fortressRect(s)
  const localCenter = fortressLocalCenter(fortressDef(s))
  const cx = fr.x + fr.w / 2
  const cy = fr.y + fr.h / 2
  const lx = e.x - localCenter.x
  const ly = e.y - localCenter.y
  const cos = Math.cos(s.fortress.heading)
  const sin = Math.sin(s.fortress.heading)
  return { x: cx + lx * cos - ly * sin, y: cy + lx * sin + ly * cos }
}

export interface VehicleEffectHost { id?: number; x: number; y: number; heading: number; vx: number; vy: number }

export function vehicleEffectWorldPos(host: VehicleEffectHost, fd: FortressDef, e: FortressEffectPoint): { x: number; y: number } {
  const localCenter = fortressLocalCenter(fd)
  const lx = e.x - localCenter.x, ly = e.y - localCenter.y
  const cosine = Math.cos(host.heading), sine = Math.sin(host.heading)
  return { x: host.x + lx * cosine - ly * sine, y: host.y + lx * sine + ly * cosine }
}

/** 阵营无关的载具特效点发射器；host 坐标均为车体世界中心。 */
export function emitVehicleEffects(
  host: VehicleEffectHost, fd: FortressDef, dt: number,
  ground: ParticlePool, air: ParticlePool, accs: Map<string, number>,
): number {
  if (!fd.effects || fd.effects.length === 0 || dt <= 0) return 0
  const moving = Math.hypot(host.vx, host.vy) > 0.05
  let spawned = 0
  for (const e of fd.effects) {
    if (e.state === 'idle' && moving) continue
    if (e.state === 'move' && !moving) continue
    const p = effectParams(e), pool = p.layer === 'ground' ? ground : air
    const pos = vehicleEffectWorldPos(host, fd, e)
    const key = `${host.id ?? 'fortress'}:${e.id}`
    const hash = Math.abs(e.x * 7.13 + e.y * 3.71) % 1
    const acc = (accs.get(key) ?? hash) + p.rate * dt
    const n = Math.floor(acc); accs.set(key, acc - n)
    for (let i = 0; i < n; i++) {
      spawned++
      const jx = (Math.random() - 0.5) * 0.08, jy = (Math.random() - 0.5) * 0.08
      if (e.kind === 'smoke') spawnTrail(pool, pos.x + jx, pos.y + jy, { vx: host.vx * p.inherit + (Math.random() - 0.5) * 0.15, vy: host.vy * p.inherit - (0.3 + Math.random() * 0.2), life: p.life * (0.85 + Math.random() * 0.3), size: p.size, color: '#78766E', drag: 1.2, grow: 1.8, growUntil: 0.5, fadeIn: 0.12 })
      else if (e.kind === 'flame') spawnTrail(pool, pos.x + jx, pos.y + jy, { vx: host.vx * p.inherit + (Math.random() - 0.5) * 0.2, vy: host.vy * p.inherit - (0.45 + Math.random() * 0.3), life: p.life * (0.8 + Math.random() * 0.4), size: p.size, color: '#F0C85A', colorEnd: '#D87828', drag: 1.5, grow: -1.2, flicker: 0.4 })
      else if (e.kind === 'dust') { const side = Math.random() < 0.5 ? 1 : -1; spawnTrail(pool, pos.x + jx, pos.y + jy, { vx: host.vx * p.inherit + side * (0.2 + Math.random() * 0.4), vy: host.vy * p.inherit + (Math.random() - 0.5) * 0.3, life: p.life * (0.85 + Math.random() * 0.3), size: p.size, color: '#96825F', drag: 1.6, grow: 1.6, growUntil: 0.4, fadeIn: 0.1 }) }
      else { const angle = Math.random() * Math.PI * 2, speed = 1.5 + Math.random() * 2.5; spawnTrail(pool, pos.x, pos.y, { vx: Math.cos(angle) * speed + host.vx * p.inherit, vy: Math.sin(angle) * speed + host.vy * p.inherit, life: p.life * (0.7 + Math.random() * 0.6), size: p.size, color: '#F0DC78', drag: 6, streak: true }) }
    }
  }
  return spawned
}

/** 单帧发射：按状态门控（停止/移动/始终）+ rate 累加器，按 layer 路由到对应粒子池。
 *  accs = 渲染端持有的「特效点 id → 发射累加器」（跨帧连续，避免小数粒截断闪烁）；
 *  fvx/fvy = 堡垒速度（格/s），按 inherit 比例加入粒子初速。返回本帧发射总数（sim 断言用）。 */
export function emitFortressEffects(
  s: GameState, fd: FortressDef, dt: number,
  ground: ParticlePool, air: ParticlePool,
  accs: Map<string, number>,
): number {
  const rect = fortressRect(s)
  return emitVehicleEffects({
    x: rect.x + rect.w / 2, y: rect.y + rect.h / 2,
    heading: s.fortress.heading, vx: s.fortress.vx, vy: s.fortress.vy,
  }, fd, dt, ground, air, accs)
}

// ---- v2.41 履带印：按各侧履带真实位移（引擎 trackPhase，格）在地面落印，瓦片压印走地面层渐隐 ----
// 生成纯函数可 sim；render 持 marks/st 两模块状态按 rAF 驱动，位移源 = 引擎 trackPhase 增量
// （弧线转向左右差速、倒退反滚天然正确——与船体履带瓦片滚动同一数据源，印与轮永不脱节）

export interface TrackMark { x: number; y: number; angle: number; born: number; tile: string; kind?: 'track' | 'wheel'; pathKey?: string; mirror?: boolean; frames?: number }
export interface TrackMarkState { acc: number[]; prevPhase: number[]; moving: boolean[]; stroke?: number[] } // 与 fortressMarkColumns 展开后的列一一对应
export const TRACK_MARK_LIFE = 12 // 印寿命（秒，游戏时间；暂停不老化）；v2.43：前 2s 全亮 + 后 10s 渐隐
export const TRACK_MARK_FADE = 10 // 渐隐窗口（秒，v2.43）：寿命最后 10s 线性到 0
export const TRACK_MARK_ALPHA = 0.25 // 印基础透明度（v2.43：0.38→0.25）
export const TRACK_MARK_CAP = 600 // 容量上限（FIFO 丢最旧）

/** 印距（格）= 瓦片有效步长（图高−拼接重叠）/ BASE_CELL——与履带瓦片滚动同口径，印迹连续无缝 */
export function trackMarkStep(tileHPx: number, overlapPx: number): number {
  return Math.max(0.2, (tileHPx - overlapPx) / BASE_CELL)
}

/** 逐帧推进：读各侧 trackPhase 增量，累计满一个印距在接地点落一印；
 *  接地点 = 履带段沿运动方向的**后端**（v2.42：印从船尾缘即时露出，不再压在船底中心；
 *  速度≈0 时取段中点）；静止→移动瞬间立即落一"启动印"（v2.42：履带本来压着地面）。
 *  过期印（>LIFE）与超容量旧印在此清理。tileH 返回 null（贴图未加载）的履带跳过。 */
export function updateTrackMarks(
  marks: TrackMark[], st: TrackMarkState,
  s: GameState, fd: FortressDef,
  tileH: (tile: string) => number | null,
  streamPrefix = 'vehicle',
): void {
  for (let i = marks.length - 1; i >= 0; i--) if (s.time - marks[i].born > TRACK_MARK_LIFE) marks.splice(i, 1)
  // 统一列布局 = 履带（左定义列+右镜像列）+ 轮胎（单个一列 / 成对左右两列，落印点=轮心）
  const cols = fortressMarkColumns(fd)
  const n = cols.length
  if (st.prevPhase.length !== n) { // 初始化/列数变化：锚定当前相位，不产生爆发
    st.prevPhase = Array.from({ length: n }, (_, k) => s.fortress.trackPhase[k] ?? 0)
    st.acc = new Array(n).fill(0)
    st.moving = new Array(n).fill(false)
    st.stroke = new Array(n).fill(0)
    return
  }
  if (st.stroke?.length !== n) st.stroke = new Array(n).fill(0)
  if (n === 0) return
  const fr = fortressRect(s)
  const cx = fr.x + fr.w / 2
  const cy = fr.y + fr.h / 2
  const cos = Math.cos(s.fortress.heading)
  const sin = Math.sin(s.fortress.heading)
  const visualSteer = wheelVisualSteerAngle(s, fd)
  // 世界速度 → 船体几何原点坐标（+x 向右、+y 向车头）。
  const lvx = s.fortress.vx * cos + s.fortress.vy * sin
  const lvy = s.fortress.vx * sin - s.fortress.vy * cos
  for (let k = 0; k < n; k++) {
    const t = cols[k]
    const h = tileH(t.tile)
    if (t.kind === 'track' && !h) continue
    // 轮胎以较密路径点连接成连续曲线；履带仍按真实履带板有效步长压印。
    const step = t.kind === 'wheel' ? 0.16 : trackMarkStep(h!, t.overlapPx)
    const mx = (t.x1 + t.x2) / 2
    const my = (t.y1 + t.y2) / 2
    // 接地点：段方向 dot 局部速度 >0 → 后端为 (x1,y1)；<0 → 后端为 (x2,y2)；≈0 → 中点（轮子段长 0 恒取轮心）
    const sdx = t.x2 - t.x1, sdy = t.y2 - t.y1
    const segLen = Math.hypot(sdx, sdy)
    const dot = segLen > 1e-9 ? (lvx * sdx + lvy * sdy) / segLen : 0
    const gx = dot > 0.05 ? t.x1 : dot < -0.05 ? t.x2 : mx
    const gy = dot > 0.05 ? t.y1 : dot < -0.05 ? t.y2 : my
    const ph = s.fortress.trackPhase[k] ?? 0
    const d = ph - st.prevPhase[k]
    const acc = st.acc[k] + d
    st.prevPhase[k] = ph
    const lx = gx
    const ly = -gy // 渲染/世界局部轴仍以向下为 +y，故将「向车头为正」取反。
    const wx = cx + lx * cos - ly * sin
    const wy = cy + lx * sin + ly * cos
    const markAngle = s.fortress.heading + (t.steered ? visualSteer : 0)
    const movingNow = Math.abs(d) > 1e-9
    if (!movingNow && st.moving[k]) st.stroke![k]++ // 停车后再次起步开启新路径，避免跨空白连接
    const pushMark = () => marks.push({
      x: wx, y: wy, angle: markAngle, born: s.time, tile: t.tile, kind: t.kind,
      pathKey: `${streamPrefix}:${k}:${st.stroke![k]}`, mirror: t.spriteMirror, frames: t.frames,
    })
    if (Math.abs(d) > 1e-9 && !st.moving[k]) { // v2.42 启动印：静止→移动瞬间立即落一印（间距后续仍按 acc 步进，不密不疏）
      pushMark()
    }
    st.moving[k] = movingNow
    if (Math.abs(acc) < step) { st.acc[k] = acc; continue }
    let rest = acc
    while (rest >= step || rest <= -step) { // 正倒向都落印
      pushMark()
      rest += rest >= step ? -step : step
    }
    st.acc[k] = rest
  }
  if (marks.length > TRACK_MARK_CAP) marks.splice(0, marks.length - TRACK_MARK_CAP)
}
