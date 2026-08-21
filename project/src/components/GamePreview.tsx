import { useEffect, useRef, useState } from 'react'
import {
  Bomb, Bug, Coins, Crosshair, Flame, Gauge, Hammer, Play, Rocket,
  Trash2, Zap,
} from 'lucide-react'
import DebugPanel from '@/components/DebugPanel'
import {
  CORE, ENEMY_DEFS, MODULE_DEFS, SPAWN_ROWS,
  BASE_CELL, TOTAL_WAVES, TURRET_DEFS, VIEW_COLS, VIEW_ROWS, upgradeCost,
} from '@/game/config'
import type { ModuleDef, TurretDef } from '@/game/config'
import { getAsset } from '@/game/assetlib'
import {
  buildModule, canPlaceModule, defOf, demolishAt, demolishModule, dirX, dirY,
  fortressDef, fortressRect, hardpointWorldPos, initialState, moduleCells, moduleDefOf, moduleFoot, mountTurret,
  resourceCaps, startWave, tick, upgradeTurret, fortressInteriorSet, worldToFortressLocal,
} from '@/game/engine'
import type { GameState } from '@/game/engine'
import { BRUSH_DEFAULTS, LEVEL, saveLevel } from '@/game/level'
import type { LevelBuilding, LevelConfig, LevelObject, LevelTerrain, LevelTurret } from '@/game/level'
import { clampViewX, clampViewY, draw } from '@/game/render'
import type { UiHints } from '@/game/render'

const TICK = 0.1

// 编译期开关：摇杆防抖方案（v2.52）。'filter' = One Euro 平滑滤波（现行）；'hysteresis' = 迟滞吸正（v2.39 旧案，保留可回退）
const STICK_ANTI_JITTER: 'filter' | 'hysteresis' = 'filter'
// One Euro 参数：α=1/(1+τ/dt), τ=1/(2πf)。基础截止频率滤手抖（小幅低速），β 按角速度自适应放开截止（快速甩动不迟钝）
const OE_MIN_CUTOFF = 1.2 // Hz：静止/慢速时的截止频率
const OE_BETA = 1.0 // 速率自适应系数：截止 += β×|角速度|(rad/s)
const OE_D_CUTOFF = 1.0 // Hz：导数通道截止频率
const FILTER_SNAP = (1.5 * Math.PI) / 180 // 滤波后微吸正阈值 1.5°（EMA 只能逼近不能到达，补足「回正=严格直行」）

type Mode =
  | { kind: 'none' }
  | { kind: 'turret'; defId: string } // 挂炮模式：点堡垒上匹配的空闲炮位挂载
  | { kind: 'demolish' }

const TYPE_ICON: Record<string, typeof Crosshair> = {
  direct: Crosshair,
  lob: Bomb,
  missile: Rocket,
  beam: Zap,
  spray: Flame,
}

function cardIcon(def: TurretDef) {
  return TYPE_ICON[def.type] ?? Crosshair
}

type Brush =
  | 'puddle' | 'barrel' | 'ruins' | 'rock' | 'buildzone' | 'ground'
  | 'building' | 'core' | 'turret' | 'wall' | 'eraser' | 'move'

/** 连续铺设型笔刷（按住拖动）；其余为单击放置 */
const PAINT_BRUSHES = new Set<Brush>(['puddle', 'barrel', 'ruins', 'rock', 'buildzone', 'ground', 'eraser'])

/** 移动笔刷取出的元素（已从 draft 删除，幽灵跟随指针，放下/取消时回插） */
type Picked =
  | { kind: 'wall'; w: number; h: number; idx: number; data: { x: number; y: number } }
  | { kind: 'terrain'; w: number; h: number; idx: number; data: LevelTerrain }
  | { kind: 'object'; w: number; h: number; idx: number; data: LevelObject }
  | { kind: 'building'; w: number; h: number; idx: number; data: LevelBuilding }
  | { kind: 'core'; w: number; h: number; idx: number; data: { x: number; y: number } }
  | { kind: 'turret'; w: number; h: number; idx: number; data: LevelTurret }

/** 角度最短路径插值（环绕 ±π） */
function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2)
  if (d > Math.PI) d -= Math.PI * 2
  if (d < -Math.PI) d += Math.PI * 2
  return a + d * t
}

/**
 * 渲染插值视图：逻辑 10Hz 固定步长，渲染帧在 prev/cur 两个逻辑状态间插值。
 * 敌人/弹道按 id 配对 lerp x/y，炮塔角度最短路径 lerp；新出现实体直接用 cur；其余字段用 cur。
 * 不 mutate cur state（map 新对象）。
 */
// v1.55：插值查找表按 prev 状态身份缓存（prev 每 tick 才变，原每帧重建 3 个 Map）
let _interpPrev: GameState | null = null
let _interpMaps: {
  enemies: Map<number, GameState['enemies'][number]>
  projectiles: Map<number, GameState['projectiles'][number]>
  turrets: Map<number, GameState['turrets'][number]>
} | null = null

function interpolate(prev: GameState | null, cur: GameState, alpha: number): GameState {
  if (!prev || alpha >= 1) return cur
  if (prev !== _interpPrev || !_interpMaps) {
    _interpPrev = prev
    _interpMaps = {
      enemies: new Map(prev.enemies.map(e => [e.id, e])),
      projectiles: new Map(prev.projectiles.map(p => [p.id, p])),
      turrets: new Map(prev.turrets.map(t => [t.id, t])),
    }
  }
  const prevEnemies = _interpMaps.enemies
  const enemies = cur.enemies.map(e => {
    const p = prevEnemies.get(e.id)
    if (!p) return e // 新出现不插值
    return { ...e, x: p.x + (e.x - p.x) * alpha, y: p.y + (e.y - p.y) * alpha }
  })
  const prevProj = _interpMaps.projectiles
  const projectiles = cur.projectiles.map(pj => {
    const p = prevProj.get(pj.id)
    if (!p) return pj
    return { ...pj, x: p.x + (pj.x - p.x) * alpha, y: p.y + (pj.y - p.y) * alpha }
  })
  const prevTurrets = _interpMaps.turrets
  const turrets = cur.turrets.map(t => {
    const p = prevTurrets.get(t.id)
    if (!p) return t
    // 挂载炮塔随堡垒移动：位置与角度都插值（60fps 平滑）
    return { ...t, angle: lerpAngle(p.angle, t.angle, alpha), x: p.x + (t.x - p.x) * alpha, y: p.y + (t.y - p.y) * alpha }
  })
  const fortress = {
    ...cur.fortress,
    x: prev.fortress.x + (cur.fortress.x - prev.fortress.x) * alpha,
    y: prev.fortress.y + (cur.fortress.y - prev.fortress.y) * alpha,
    heading: lerpAngle(prev.fortress.heading, cur.fortress.heading, alpha),
    // v1.88：履带相位随 rAF 插值——10Hz 逻辑帧下满速每 tick 恰好整 3 个瓦片步进，
    // 落点重合产生"静止"错觉（频闪混叠）；插值后每帧约 0.1 格平滑滚动。仅视觉，物理不变。
    trackPhase: cur.fortress.trackPhase.map((v, i) => {
      const pv = prev.fortress.trackPhase[i]
      return pv === undefined ? v : pv + (v - pv) * alpha
    }),
  }
  return { ...cur, enemies, projectiles, turrets, fortress }
}
// v1.88：e2e 钩子——无头环境 rAF 会被冻结，直接对纯函数做确定性断言
if (typeof window !== 'undefined') { (window as unknown as { __tdInterp?: typeof interpolate }).__tdInterp = interpolate }

export default function GamePreview() {
  const [game, setGame] = useState<GameState>(initialState)
  const [mode, setMode] = useState<Mode>({ kind: 'none' })
  const [selTurret, setSelTurret] = useState<number | null>(null)
  const [viewY, setViewY] = useState(LEVEL.rows - VIEW_ROWS) // 场景编辑模式手动卷动（游玩模式相机跟随堡垒）
  const [viewX, setViewX] = useState(0)
  const camRef = useRef({ x: 0, y: LEVEL.rows - VIEW_ROWS }) // 实际绘制用相机（rAF 写入；指针映射读取）
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null)
  const [showDebug, setShowDebug] = useState(false)
  const debugRef = useRef(showDebug) // 主循环读取：debug 打开时备战倒计时暂停
  useEffect(() => { debugRef.current = showDebug }, [showDebug])
  const [size, setSize] = useState({ cell: BASE_CELL, w: VIEW_COLS * BASE_CELL, h: VIEW_ROWS * BASE_CELL })
  const zoomRef = useRef(1) // 场景缩放（0.5–2.5）：改变可见格数而非画布像素尺寸
  // v1.49：基准格全设备统一 BASE_CELL=30px（不再按容器适配）；竖版视口宽高对调 12×20
  const portraitRef = useRef(false) // 竖版 = 容器高>宽
  const viewDims = () => ({ vc: portraitRef.current ? VIEW_ROWS : VIEW_COLS, vr: portraitRef.current ? VIEW_COLS : VIEW_ROWS })
  const pinchRef = useRef<{ d0: number; z0: number } | null>(null) // 双指捏合
  const ptrsRef = useRef<Map<number, { x: number; y: number }>>(new Map())
  // 场景编辑模式：draft 草稿 + 当前笔刷 + 移动笔刷取出的元素；编辑期间本局暂停
  const [edit, setEdit] = useState<{ draft: LevelConfig; brush: Brush; picked: Picked | null } | null>(null)
  // 要塞内部建造模式（原地建造：隐藏主体只露底座，直接在堡垒上摆放模块；建造/拆除仅备战期）
  const [interior, setInterior] = useState(false)
  const [interiorSel, setInteriorSel] = useState<string | null>(null) // 选中待摆放模块
  const [interiorRot, setInteriorRot] = useState<0 | 1>(0)
  const [interiorDemo, setInteriorDemo] = useState(false) // 拆除模块模式
  const [hoverInterior, setHoverInterior] = useState<{ x: number; y: number } | null>(null)
  // v1.53 右缘悬浮列表面板：炮塔 / 模块；打开期间摇杆禁用。模块面板 = 内部空间模式（隐藏主体与已装炮塔贴图）
  const [panel, setPanel] = useState<null | 'turret' | 'module'>(null)

  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const dragRef = useRef<{ startX: number; startY: number; startViewX: number; startViewY: number; moved: boolean; painting: boolean } | null>(null)
  // 触屏虚拟摇杆：游玩模式按住画布拖动即移动堡垒（点按仍是挂炮/拆除/选中）
  const joyRef = useRef<{ id: number; mode: 'fwd' | 'rev' | null; straight: boolean; fAngle: number | null; fDeriv: number; fTime: number } | null>(null) // mode：受控锁定的行驶模式（首推扇区判定后锁定，防边界附近前进/倒退来回切换）；v2.39 straight：迟滞死区状态（true=直行中）；v2.52 fAngle/fDeriv/fTime：One Euro 滤波状态（fAngle=null=未初始化）
  const [joy, setJoy] = useState<{ x: number; y: number; dx: number; dy: number; rev: boolean } | null>(null)
  const editRef = useRef(edit)
  useEffect(() => {
    editRef.current = edit // 主循环读取最新编辑状态（暂停 tick）
  }, [edit])

  // 插值数据源：上一个逻辑 state + 最近一次 tick 的时间戳（interval 回调内同步更新，不等渲染）
  const gameRef = useRef(game)
  useEffect(() => {
    gameRef.current = game
  }, [game])
  const prevStateRef = useRef<GameState | null>(null)
  const lastTickTimeRef = useRef(0)

  // 移动笔刷：ESC 取消放回原地
  useEffect(() => {
    if (!edit?.picked) return
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') cancelMove()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cancelMove 为每帧重建闭包
  }, [edit?.picked])

  // v1.62 坦克式键位：W/↑ 沿当前船头正前方、S/↓ 沿正后方倒退、A/← 左转、D/→ 右转
  // （水平平移取消；v1.61 起 Q/E 已废）。写入 gameRef.current，tick 每帧消费并随克隆延续
  const keysRef = useRef<Set<string>>(new Set())
  // 键位 → 操控状态（keydown/keyup/endJoystick 共用）
  const applyKeys = () => {
    const k = keysRef.current
    const g = gameRef.current
    const fwd = k.has('w') || k.has('arrowup')
    const back = k.has('s') || k.has('arrowdown')
    g.turnDir = (k.has('d') || k.has('arrowright') ? 1 : 0) - (k.has('a') || k.has('arrowleft') ? 1 : 0) // A/← 左转、D/→ 右转
    if (fwd && !back) { // 沿当前朝向正前方（前进方向每 tick 跟随船头刷新，见主循环）
      g.moveDir.x = dirX(g.fortress.heading)
      g.moveDir.y = dirY(g.fortress.heading)
      g.reverse = false
    } else if (back && !fwd) { // 沿正后方倒退（倒退系数生效）
      g.moveDir.x = 0
      g.moveDir.y = 0
      g.reverse = true
    } else {
      g.moveDir.x = 0
      g.moveDir.y = 0
      g.reverse = false
    }
    g.moveMag = 1 // 键盘恒全速
    g.desiredHeading = null // 键盘操控优先：清除摇杆朝向指令
  }
  useEffect(() => {
    const MOVE_KEYS = ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'] // v1.61：q/e 移除
    const update = applyKeys
    const down = (ev: KeyboardEvent) => {
      const key = ev.key.toLowerCase()
      if (!MOVE_KEYS.includes(key)) return
      if (editRef.current) return // 场景编辑中不驱动堡垒
      if ((ev.target as HTMLElement | null)?.tagName === 'INPUT') return
      ev.preventDefault()
      keysRef.current.add(key)
      update()
    }
    const up = (ev: KeyboardEvent) => {
      keysRef.current.delete(ev.key.toLowerCase())
      update()
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])

  // 内部建造模式快捷键：R 旋转模块；ESC 取消选择/退出
  useEffect(() => {
    if (!interior) return
    const onKey = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase()
      if ((e.target as HTMLElement | null)?.tagName === 'INPUT') return
      if (key === 'r') { if (interiorSel) setInteriorRot(r => (r ? 0 : 1)) }
      else if (key === 'escape') {
        if (interiorSel || interiorDemo) { setInteriorSel(null); setInteriorDemo(false) }
        else setInterior(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [interior, interiorSel, interiorDemo])

  // 调试探针：暴露最新游戏状态（无头测试用）
  useEffect(() => {
    (window as unknown as Record<string, unknown>).__game = game
  }, [game])
  // v1.53 调试探针：暴露 UI 面板状态（无头测试用）
  useEffect(() => {
    (window as unknown as Record<string, unknown>).__ui = { panel, mode: mode.kind, interior, camRef }
  }, [panel, mode, interior])

  // 性能探针（诊断卡顿用）：draw/tick 耗时的指数均值与峰值
  const perfRef = useRef({ drawMs: 0, drawMax: 0, tickMs: 0, tickMax: 0 })
  useEffect(() => {
    (window as unknown as Record<string, unknown>).__perf = perfRef.current
  }, [])

  // 主循环（场景编辑模式暂停 tick 推进）
  useEffect(() => {
    const iv = setInterval(() => {
      if (editRef.current) return
      const g = gameRef.current
      // debug 打开时暂停备战波次倒计时（交战正常进行）
      if (debugRef.current && g.phase === 'prep') return
      // v1.62：键盘按住前进（非倒退、摇杆未受控）时，前进方向每 tick 跟随当前船头
      {
        const k = keysRef.current
        if (!joyRef.current && (k.has('w') || k.has('arrowup')) && !(k.has('s') || k.has('arrowdown'))) {
          g.moveDir.x = dirX(g.fortress.heading)
          g.moveDir.y = dirY(g.fortress.heading)
        }
      }
      const _t0 = performance.now()
      const next = tick(g, TICK)
      const _tm = performance.now() - _t0
      const _pf = perfRef.current
      _pf.tickMs = _pf.tickMs * 0.9 + _tm * 0.1
      if (_tm > _pf.tickMax) _pf.tickMax = _tm
      prevStateRef.current = g // 供渲染插值配对
      lastTickTimeRef.current = performance.now()
      setGame(next)
    }, TICK * 1000)
    return () => clearInterval(iv)
  }, [])

  // 波次开始（进入交战）后取消当前卡牌/工具选择
  useEffect(() => {
    if (game.phase === 'combat') setMode({ kind: 'none' })
  }, [game.phase])

  // 画布尺寸：方形格，基准视口 20×12 格；缩放改变可见格数（画布像素尺寸恒定适配容器）
  const applyZoom = (z: number) => {
    const zoom = Math.max(0.5, Math.min(2.5, z))
    zoomRef.current = zoom
    const { vc, vr } = viewDims()
    setSize({ cell: BASE_CELL * zoom, w: BASE_CELL * vc, h: BASE_CELL * vr })
  }
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const rect = el.getBoundingClientRect()
      // v1.49：基准格统一 30px 不随容器变化；仅检测横/竖版切换视口格数（画布超出小屏容器时居中裁边，相机跟随堡垒不受影响）
      const isP = rect.height > rect.width // 竖版：视口 12×20（宽高对调）
      portraitRef.current = isP
      const vc = isP ? VIEW_ROWS : VIEW_COLS
      const vr = isP ? VIEW_COLS : VIEW_ROWS
      setSize({ cell: BASE_CELL * zoomRef.current, w: BASE_CELL * vc, h: BASE_CELL * vr })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // 滚轮缩放（画布上；非被动以阻止页面缩放）
  useEffect(() => {
    const cv = canvasRef.current
    if (!cv) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      applyZoom(zoomRef.current * (e.deltaY < 0 ? 1.125 : 1 / 1.125))
    }
    cv.addEventListener('wheel', onWheel, { passive: false })
    return () => cv.removeEventListener('wheel', onWheel)
  }, [])

  const prep = game.phase === 'prep'
  const cell = size.cell

  // ================= 场景编辑：笔刷占格 / 校验 / 铺设 / 移动 =================
  const brushFoot = (draft: LevelConfig, brush: Brush, picked: Picked | null): { w: number; h: number } => {
    if (brush === 'move') return picked ? { w: picked.w, h: picked.h } : { w: 1, h: 1 }
    if (brush === 'building') {
      const b = draft.buildings.find(x => x.id === BRUSH_DEFAULTS.selectedBuildingId)
      return b ? { w: b.w, h: b.h } : { w: BRUSH_DEFAULTS.building.w, h: BRUSH_DEFAULTS.building.h }
    }
    if (brush === 'core') return { w: CORE.w, h: CORE.h }
    if (brush === 'turret') {
      const d = TURRET_DEFS.find(x => x.id === BRUSH_DEFAULTS.turretDefId)
      return d ? { w: d.w, h: d.h } : { w: 1, h: 1 }
    }
    return { w: 1, h: 1 }
  }

  /** 占用冲突：draft 上的墙/物体/建筑/核心/炮塔占据格；替换型笔刷豁免自身类型 */
  const rectBusy = (draft: LevelConfig, brush: Brush, gx: number, gy: number, w: number, h: number): boolean => {
    const isObj = brush === 'barrel' || brush === 'ruins' || brush === 'rock'
    for (let dx = 0; dx < w; dx++)
      for (let dy = 0; dy < h; dy++) {
        const cx = gx + dx
        const cy = gy + dy
        if (brush !== 'wall' && draft.initialWalls.some(v => v.x === cx && v.y === cy)) return true
        if (!isObj && draft.objects.some(o => cx >= o.x && cx < o.x + o.w && cy >= o.y && cy < o.y + o.h)) return true
        if (brush !== 'building' && draft.buildings.some(b => cx >= b.x && cx < b.x + b.w && cy >= b.y && cy < b.y + b.h)) return true
        if (brush !== 'core' && draft.core && cx >= draft.core.x && cx < draft.core.x + CORE.w && cy >= draft.core.y && cy < draft.core.y + CORE.h) return true
        if (brush !== 'turret' && draft.initialTurrets.some(t => {
          const od = TURRET_DEFS.find(d => d.id === t.defId)
          return od ? cx >= t.x && cx < t.x + od.w && cy >= t.y && cy < t.y + od.h : false
        })) return true
      }
    return false
  }

  const brushValidAt = (draft: LevelConfig, brush: Brush, picked: Picked | null, gx: number, gy: number): boolean => {
    if (brush === 'eraser') return gx >= 0 && gx < LEVEL.cols && gy >= SPAWN_ROWS && gy < LEVEL.rows
    if (brush === 'ground') return gx >= 0 && gx < LEVEL.cols && gy >= SPAWN_ROWS && gy < LEVEL.rows // 纯视觉地面层：不与物体/建筑冲突
    if (brush === 'move' && !picked) return false // 未取件时不铺
    const { w, h } = brushFoot(draft, brush, picked)
    if (gx < 0 || gx + w > LEVEL.cols || gy < SPAWN_ROWS || gy + h > LEVEL.rows) return false
    const coreMoving = brush === 'core' || (brush === 'move' && picked?.kind === 'core')
    if (coreMoving) {
      // 核心：界内即可（不贴边），且不与其他元素冲突
      if (gx < 1 || gx + CORE.w > LEVEL.cols - 1 || gy + CORE.h > LEVEL.rows - 1) return false
      if (brush === 'core') return true
      return !rectBusy(draft, brush, gx, gy, w, h)
    }
    return !rectBusy(draft, brush, gx, gy, w, h)
  }

  /** 移动笔刷：命中检测（优先级：炮塔 > 建筑 > 核心 > 物体 > 墙 > 地形） */
  const hitTest = (draft: LevelConfig, gx: number, gy: number): Picked | null => {
    const ti = draft.initialTurrets.findIndex(t => {
      const od = TURRET_DEFS.find(d => d.id === t.defId)
      return od ? gx >= t.x && gx < t.x + od.w && gy >= t.y && gy < t.y + od.h : false
    })
    if (ti >= 0) {
      const t = draft.initialTurrets[ti]
      const od = TURRET_DEFS.find(d => d.id === t.defId)
      if (od) return { kind: 'turret', w: od.w, h: od.h, idx: ti, data: { ...t } }
    }
    const bi = draft.buildings.findIndex(b => gx >= b.x && gx < b.x + b.w && gy >= b.y && gy < b.y + b.h)
    if (bi >= 0) {
      const b = draft.buildings[bi]
      return { kind: 'building', w: b.w, h: b.h, idx: bi, data: { ...b } }
    }
    if (draft.core && gx >= draft.core.x && gx < draft.core.x + CORE.w && gy >= draft.core.y && gy < draft.core.y + CORE.h) {
      return { kind: 'core', w: CORE.w, h: CORE.h, idx: 0, data: { ...draft.core } }
    }
    const oi = draft.objects.findIndex(o => gx >= o.x && gx < o.x + o.w && gy >= o.y && gy < o.y + o.h)
    if (oi >= 0) {
      const o = draft.objects[oi]
      return { kind: 'object', w: o.w, h: o.h, idx: oi, data: { ...o } }
    }
    const wi = draft.initialWalls.findIndex(v => v.x === gx && v.y === gy)
    if (wi >= 0) return { kind: 'wall', w: 1, h: 1, idx: wi, data: { ...draft.initialWalls[wi] } }
    const ri = draft.terrain.findIndex(t => gx >= t.x && gx < t.x + t.w && gy >= t.y && gy < t.y + t.h)
    if (ri >= 0) {
      const t = draft.terrain[ri]
      return { kind: 'terrain', w: t.w, h: t.h, idx: ri, data: { ...t } }
    }
    return null
  }

  const removePicked = (d: LevelConfig, p: Picked) => {
    if (p.kind === 'wall') d.initialWalls.splice(p.idx, 1)
    else if (p.kind === 'terrain') d.terrain.splice(p.idx, 1)
    else if (p.kind === 'object') d.objects.splice(p.idx, 1)
    else if (p.kind === 'building') d.buildings = d.buildings.filter(b => b.id !== (p.data as LevelBuilding).id)
    else if (p.kind === 'turret') d.initialTurrets.splice(p.idx, 1)
    else d.core = null
  }

  const dropPicked = (d: LevelConfig, p: Picked, gx: number, gy: number) => {
    if (p.kind === 'wall') d.initialWalls.push({ x: gx, y: gy })
    else if (p.kind === 'terrain') d.terrain.push({ ...p.data, x: gx, y: gy })
    else if (p.kind === 'object') d.objects.push({ ...p.data, x: gx, y: gy })
    else if (p.kind === 'building') d.buildings.push({ ...p.data, x: gx, y: gy })
    else if (p.kind === 'turret') d.initialTurrets.push({ ...p.data, x: gx, y: gy })
    else d.core = { x: gx, y: gy }
  }

  /** 移动笔刷点击：未取件=取出，已取件=放下（校验失败拒放） */
  const moveClick = (gx: number, gy: number) => {
    const e = editRef.current
    if (!e) return
    if (!e.picked) {
      if (!hitTest(e.draft, gx, gy)) return
      setEdit(cur => {
        if (!cur) return cur
        const p = hitTest(cur.draft, gx, gy)
        if (!p) return cur
        const d = structuredClone(cur.draft)
        removePicked(d, p)
        return { ...cur, draft: d, picked: p }
      })
    } else {
      if (!brushValidAt(e.draft, 'move', e.picked, gx, gy)) return
      setEdit(cur => {
        if (!cur || !cur.picked) return cur
        const d = structuredClone(cur.draft)
        dropPicked(d, cur.picked, gx, gy)
        return { ...cur, draft: d, picked: null }
      })
    }
  }

  /** 取消移动：放回原地 */
  const cancelMove = () => {
    setEdit(cur => {
      if (!cur || !cur.picked) return cur
      const d = structuredClone(cur.draft)
      dropPicked(d, cur.picked, cur.picked.data.x, cur.picked.data.y)
      return { ...cur, draft: d, picked: null }
    })
  }

  const updateDraft = (fn: (d: LevelConfig) => void) => {
    setEdit(e => {
      if (!e) return e
      const d = structuredClone(e.draft)
      fn(d)
      return { ...e, draft: d }
    })
  }

  const applyBrushAt = (draft: LevelConfig, brush: Brush, gx: number, gy: number) => {
    const covers = (r: { x: number; y: number; w: number; h: number }) =>
      gx >= r.x && gx < r.x + r.w && gy >= r.y && gy < r.y + r.h
    switch (brush) {
      case 'puddle':
        draft.terrain = draft.terrain.filter(t => !(t.x === gx && t.y === gy && t.w === 1 && t.h === 1))
        draft.terrain.push({ kind: 'puddle', x: gx, y: gy, w: 1, h: 1, moveModifier: BRUSH_DEFAULTS.moveModifier })
        break
      case 'barrel':
      case 'ruins':
      case 'rock': {
        draft.objects = draft.objects.filter(o => !covers(o))
        const p = BRUSH_DEFAULTS.obj[brush]
        draft.objects.push({
          kind: brush, x: gx, y: gy, w: 1, h: 1,
          hp: p.hp, blockMove: p.blockMove, blockProjectile: p.blockProjectile, height: p.height,
        })
        break
      }
      case 'buildzone':
        if (!draft.buildCells.includes(`${gx},${gy}`)) draft.buildCells.push(`${gx},${gy}`)
        break
      case 'ground':
        if (!draft.groundCells.includes(`${gx},${gy}`)) draft.groundCells.push(`${gx},${gy}`)
        break
      case 'building': {
        const sel = draft.buildings.find(b => b.id === BRUSH_DEFAULTS.selectedBuildingId)
        if (sel) { sel.x = gx; sel.y = gy } else {
          const id = Math.max(999, ...draft.buildings.map(b => b.id)) + 1
          draft.buildings.push({
            id, name: BRUSH_DEFAULTS.building.name, x: gx, y: gy,
            w: BRUSH_DEFAULTS.building.w, h: BRUSH_DEFAULTS.building.h, color: '#8A8272',
          })
        }
        break
      }
      case 'core':
        draft.core = { x: gx, y: gy }
        break
      case 'turret': {
        const def = TURRET_DEFS.find(d => d.id === BRUSH_DEFAULTS.turretDefId)
        if (!def) break
        draft.initialTurrets = draft.initialTurrets.filter(t => {
          const od = TURRET_DEFS.find(d => d.id === t.defId)
          return od ? !covers({ x: t.x, y: t.y, w: od.w, h: od.h }) : false
        })
        draft.initialTurrets.push({ defId: def.id, x: gx, y: gy })
        break
      }
      case 'eraser':
        // 删除该格上所有编辑层内容（含初始墙/原模板墙格与核心建筑）
        draft.terrain = draft.terrain.filter(t => !covers(t))
        draft.objects = draft.objects.filter(o => !covers(o))
        draft.buildCells = draft.buildCells.filter(k => k !== `${gx},${gy}`)
        draft.groundCells = draft.groundCells.filter(k => k !== `${gx},${gy}`)
        draft.initialWalls = draft.initialWalls.filter(w => !(w.x === gx && w.y === gy))
        draft.initialTurrets = draft.initialTurrets.filter(t => {
          const od = TURRET_DEFS.find(d => d.id === t.defId)
          return od ? !covers({ x: t.x, y: t.y, w: od.w, h: od.h }) : false
        })
        draft.buildings = draft.buildings.filter(b => !covers(b))
        if (draft.core && covers({ x: draft.core.x, y: draft.core.y, w: CORE.w, h: CORE.h })) draft.core = null
        break
    }
  }

  const paintAt = (gx: number, gy: number) => {
    const e = editRef.current
    if (!e) return
    if (e.brush === 'move') { moveClick(gx, gy); return }
    if (!brushValidAt(e.draft, e.brush, e.picked, gx, gy)) return
    updateDraft(d => applyBrushAt(d, e.brush, gx, gy))
  }

  const applyEdit = () => {
    const e = editRef.current
    if (!e) return
    // draft → LEVEL + 持久化 + 重开
    for (const k of Object.keys(LEVEL)) delete (LEVEL as unknown as Record<string, unknown>)[k]
    Object.assign(LEVEL, structuredClone(e.draft))
    saveLevel()
    setEdit(null)
    setGame(initialState())
    setMode({ kind: 'none' })
    setSelTurret(null)
  }

  // rAF 渲染输入：每渲染同步最新值（rAF 回调经 ref 读取保证实时）
  const drawInputsRef = useRef({ game, viewX, viewY, hover, mode, selTurret, size, cell, prep, edit, brushFoot, brushValidAt, interior, interiorSel, interiorRot, hoverInterior, panel })
  useEffect(() => {
    drawInputsRef.current = { game, viewX, viewY, hover, mode, selTurret, size, cell, prep, edit, brushFoot, brushValidAt, interior, interiorSel, interiorRot, hoverInterior, panel }
  })

  // rAF 60fps 渲染循环：每帧在前后两个逻辑状态间插值后绘制（逻辑 10Hz 不变）
  useEffect(() => {
    let raf = 0
    const loop = () => {
      raf = requestAnimationFrame(loop)
      const canvas = canvasRef.current
      if (!canvas) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      const a = drawInputsRef.current
      const { game: cur, viewX: vx, viewY: vy, hover: hov0, mode: md, selTurret: sel, size: sz, cell: cl, prep: pp, edit: ed } = a
      const dpr = Math.min(2, window.devicePixelRatio || 1) // v1.55：dpr 上限 2（移动端省填充率）
      if (canvas.width !== sz.w * dpr) {
        canvas.width = sz.w * dpr
        canvas.height = sz.h * dpr
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      // alpha = 距上次逻辑 tick 的时间占比（clamp 防页面恢复/编辑暂停时跳变）
      const alpha = Math.min(1, Math.max(0, (performance.now() - lastTickTimeRef.current) / (TICK * 1000)))
      const view = interpolate(prevStateRef.current, cur, alpha)
      // 相机：编辑模式手动卷动；游玩模式跟随堡垒中心（宽战场横向卷动）
      let camX: number
      let camY: number
      if (ed) {
        camX = clampViewX(vx, cl, sz.w)
        camY = clampViewY(vy, cl, sz.h)
      } else {
        const fr = fortressRect(view)
        camX = clampViewX(fr.x + fr.w / 2 - (sz.w / cl) / 2, cl, sz.w)
        camY = clampViewY(fr.y + fr.h / 2 - (sz.h / cl) / 2, cl, sz.h)
      }
      camRef.current = { x: camX, y: camY }
      let ghost: UiHints['ghost'] = null
      let wallGhost: UiHints['wallGhost'] = null
      let editOverlay: UiHints['edit']
      if (ed) {
        const hov = hov0 ? { x: Math.floor(hov0.x), y: Math.floor(hov0.y) } : null
        const foot = a.brushFoot(ed.draft, ed.brush, ed.picked)
        editOverlay = {
          cells: ed.draft.buildCells,
          groundCells: ed.draft.groundCells,
          terrain: ed.draft.terrain,
          objects: ed.draft.objects,
          walls: ed.draft.initialWalls,
          buildings: ed.draft.buildings,
          core: ed.draft.core ? { x: ed.draft.core.x, y: ed.draft.core.y, w: CORE.w, h: CORE.h } : null,
          turrets: ed.draft.initialTurrets,
          hover: hov ? { ...hov, w: foot.w, h: foot.h, ok: a.brushValidAt(ed.draft, ed.brush, ed.picked, hov.x, hov.y) } : null,
        }
      } else if (pp && hov0 && md.kind === 'demolish') {
        // 拆除幽灵：指向堡垒上可卸下的炮塔（内置武器不可拆）
        const gx = Math.floor(hov0.x)
        const gy = Math.floor(hov0.y)
        const target = cur.turrets.some(t => !t.builtIn && hov0.x >= t.x && hov0.x < t.x + t.w && hov0.y >= t.y && hov0.y < t.y + t.h)
        wallGhost = { x: gx, y: gy, ok: target, reason: target ? undefined : '指向炮塔卸下' }
      }
      // 内部建造幽灵：世界坐标 → 堡垒局部格阵（随朝向旋转）
      let interiorGhost: UiHints['interiorGhost'] = null
      if (a.interior && !ed && a.interiorSel && a.hoverInterior) {
        const md2 = moduleDefOf(a.interiorSel)
        const foot2 = moduleFoot(md2, a.interiorRot)
        interiorGhost = {
          x: a.hoverInterior.x, y: a.hoverInterior.y, w: foot2.w, h: foot2.h,
          cells: moduleCells(md2, a.interiorRot), // v2.31 异型逐格幽灵
          ok: pp && canPlaceModule(cur, a.interiorSel, a.hoverInterior.x, a.hoverInterior.y, a.interiorRot).ok,
        }
      }
      const _d0 = performance.now()
      draw(ctx, view, { cell: cl, viewX: camX, viewY: camY, overheated: cur.fortress.overheated }, {
        ghost, wallGhost, selectedTurret: sel, buildMode: pp && !ed, edit: editOverlay,
        mountDefId: pp && !ed && md.kind === 'turret' ? md.defId : null,
        turretPanel: !ed && a.panel === 'turret', // v1.75：炮塔按钮按下（卡片栏展开）时显示炮位槽位圈/字母
        interiorMode: a.interior && !ed,
        interiorGhost,
      }, sz.w, sz.h)
      const _dm = performance.now() - _d0
      const _pd = perfRef.current
      _pd.drawMs = _pd.drawMs * 0.95 + _dm * 0.05
      if (_dm > _pd.drawMax) _pd.drawMax = _dm
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])

  const toCell = (e: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect()
    const effCell = size.cell * (rect.width / size.w) // 缩放感知：可见格数 = VIEW_COLS / zoom
    return {
      x: camRef.current.x + (e.clientX - rect.left) / effCell,
      y: camRef.current.y + (e.clientY - rect.top) / effCell,
    }
  }

  /** 命中堡垒炮位：指针世界坐标 0.45 格内的可见炮位（挂炮用；炮位随船体朝向旋转） */
  const hardpointAt = (g: GameState, cx: number, cy: number) => {
    for (const hp of fortressDef(g).hardpoints) {
      if (hp.hidden) continue
      const wp = hardpointWorldPos(g, hp)
      if (Math.hypot(cx - wp.x, cy - wp.y) <= 0.45) return hp
    }
    return null
  }

  /** 指针世界坐标 → 内部模块格阵格（随船体旋转逆变换；越界返回 null） */
  const interiorCellAt = (g: GameState, cx: number, cy: number) => {
    const l = worldToFortressLocal(g, cx, cy)
    const x = Math.floor(l.x)
    const y = Math.floor(l.y)
    if (x < 0 || y < 0) return null
    if (!fortressInteriorSet(fortressDef(g)).has(`${x},${y}`)) return null // 内部自由格阵
    return { x, y }
  }

  const doClickCell = (cx: number, cy: number) => {
    const gx = Math.floor(cx)
    const gy = Math.floor(cy)
    // 内部建造模式：原地摆放/拆除模块（不切换界面）
    if (interior) {
      const ic = interiorCellAt(game, cx, cy)
      if (!ic) return
      if (interiorDemo) {
        if (!prep) return
        const m = game.modules.find(m => // v2.31 逐格命中（异型模块空洞不可点拆）
          moduleCells(moduleDefOf(m.defId), m.rot).some(c => m.x + c.x === ic.x && m.y + c.y === ic.y))
        if (m) setGame(g => demolishModule(g, m.id))
        return
      }
      if (interiorSel && prep) {
        setGame(g => buildModule(g, interiorSel, ic.x, ic.y, interiorRot))
      }
      return
    }
    if (mode.kind === 'turret') {
      // 挂炮：点击堡垒上匹配的空闲炮位
      if (!prep) return
      const hp = hardpointAt(game, cx, cy)
      if (hp) setGame(g => mountTurret(g, mode.defId, hp.id))
      return
    }
    if (mode.kind === 'demolish') {
      if (!prep) return
      setGame(g => demolishAt(g, gx, gy)) // 命中炮塔 = 卸下（内置武器引擎内拦截）
      return
    }
    // 无工具：点炮塔查看/升级
    const t = game.turrets.find(t => cx >= t.x && cx < t.x + t.w && cy >= t.y && cy < t.y + t.h)
    if (t) {
      setSelTurret(selTurret === t.id ? null : t.id)
      return
    }
    setSelTurret(null)
  }

  const onPointerDown = (e: React.PointerEvent) => {
    ptrsRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (ptrsRef.current.size === 2) {
      // 第二指落下：取消单指手势（摇杆/点击/铺设），进入捏合缩放
      const [p1, p2] = [...ptrsRef.current.values()]
      pinchRef.current = { d0: Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1, z0: zoomRef.current }
      dragRef.current = null
      endJoystick(e.pointerId)
      return
    }
    if (dragRef.current) return // 单指手势优先，多余触点忽略
    (e.target as HTMLElement).setPointerCapture(e.pointerId)
    if (edit) {
      // 场景编辑：铺设型笔刷即点即铺（可按住拖动连铺）；放置型笔刷松手落子
      const painting = PAINT_BRUSHES.has(edit.brush)
      dragRef.current = { startX: e.clientX, startY: e.clientY, startViewX: viewX, startViewY: viewY, moved: false, painting }
      if (painting) {
        const c = toCell(e)
        paintAt(Math.floor(c.x), Math.floor(c.y))
      }
      return
    }
    // 游玩模式：相机跟随堡垒，拖动仅作点击阈值判定
    dragRef.current = { startX: e.clientX, startY: e.clientY, startViewX: viewX, startViewY: viewY, moved: false, painting: false }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (ptrsRef.current.has(e.pointerId)) ptrsRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pinchRef.current && ptrsRef.current.size >= 2) {
      const [p1, p2] = [...ptrsRef.current.values()]
      const d = Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1
      applyZoom(pinchRef.current.z0 * (d / pinchRef.current.d0))
      return
    }
    const c = toCell(e)
    setHover(c)
    if (interior) setHoverInterior(interiorCellAt(gameRef.current, c.x, c.y))
    const d = dragRef.current
    if (!d) return
    if (d.painting) {
      if (edit) paintAt(Math.floor(c.x), Math.floor(c.y))
      return
    }
    const dx = e.clientX - d.startX
    const dy = e.clientY - d.startY
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) d.moved = true
    if (edit) { // 场景编辑：双轴拖动查看全战场（游玩模式相机自动跟随）
      setViewX(clampViewX(d.startViewX - dx / size.cell, cell, size.w))
      setViewY(clampViewY(d.startViewY - dy / size.cell, cell, size.h))
    } else if (d.moved) {
      if (panel !== null) return // v1.53：炮塔/模块面板打开期间禁用摇杆（防放置/建造时误动车；d.moved 已置位，松手不会触发点按）
      // 虚拟摇杆（触屏/鼠标拖动通用）：拖过阈值后按拖动方向持续驱动堡垒
      if (!joyRef.current) joyRef.current = { id: e.pointerId, mode: null, straight: true, fAngle: null, fDeriv: 0, fTime: 0 } // 未控状态；迟滞死区初始=直行；滤波状态随每次抓住重置
      if (joyRef.current.id === e.pointerId) {
        const len = Math.hypot(dx, dy)
        let stickForView: number | null = null // v1.48：钳制后的偏角供摇杆头视觉使用
        if (len > 8) { // 8px 死区
          // 摇杆偏角 stick：0=正推（朝船头）=前进（船头领先）；±180°=倒推（朝船尾）=倒退（船尾领先）
          // ——档内摇杆方向 = 堡垒运动方向。模式首推锁定（v1.44 恢复 v1.15 语义；v2.39 扇区重定 ±120°）：
          // 抓住摇杆时首次推出的扇区定档（偏角 ≤120° 前进 / >120° 倒退），锁定期间旋转摇杆不换档
          // （前进档内倒推 = 掉头后船头领先开过去，不会倒车）；松手回未控，下次抓住重新选档。
          // 判定直接看 |偏角|（v1.40 修正：旧式 stick-heading 在船头非 0° 时会误判半球）
          const SECTOR = (Math.PI * 2) / 3 // v2.39：档位扇区边界 120°（前进 ±120° / 倒退正后 ±60°，两扇区在此衔接）
          let stick = Math.atan2(dx / len, -dy / len)
          if (!joyRef.current.mode) {
            joyRef.current.mode = Math.abs(stick) > SECTOR ? 'rev' : 'fwd'
          }
          const mode = joyRef.current.mode
          // 扇区硬门控（v1.48 半球门控演进，v2.39 边界 90°→120°）：锁定档位的对侧扇区「消失」——
          // 前进档仅 ±120° 扇区可达（钳到 ±120° 边界），倒退档仅正后方 ±60° 扇区可达（|偏角|≥120°）；
          // 手指拖入对侧扇区时摇杆吸在边界上（不产生掉头指令），要换向须松开摇杆解除受控后重新抓住定档
          if (mode === 'fwd') {
            if (stick > SECTOR) stick = SECTOR
            else if (stick < -SECTOR) stick = -SECTOR
          } else {
            if (stick >= 0 && stick < SECTOR) stick = SECTOR
            else if (stick < 0 && stick > -SECTOR) stick = -SECTOR
          }
          stickForView = stick // v2.39：视觉用钳制后偏角——防抖只影响指令角，不劫持摇杆头视觉
          if (STICK_ANTI_JITTER === 'hysteresis') {
            // v2.39 迟滞死区（旧案，编译期保留）：正前/正后直行↔转向双阈值切换——距直行位 <3° 进直行
            // （指令角吸为 0°/180°）、>6° 退出、3°~6° 保持原状态；迟滞带隔开进出阈值，手抖在边界往复时
            // 不跨双阈不抽搐。fwd 档只可能吸正前、rev 档只可能吸正后（扇区钳制保证）
            const nearFwd = Math.abs(stick) // 距正前（0°）
            const nearRev = Math.PI - Math.abs(stick) // 距正后（180°）
            const near = Math.min(nearFwd, nearRev)
            if (joyRef.current.straight) {
              if (near > Math.PI / 30) joyRef.current.straight = false // 退出阈值 6°
            } else if (near < Math.PI / 60) joyRef.current.straight = true // 进入阈值 3°
            if (joyRef.current.straight) stick = nearRev < nearFwd ? Math.PI : 0
          } else {
            // v2.52 平滑滤波（One Euro，现行）：手抖=小幅低速角运动 → 低截止频率强平滑；
            // 快速甩动=高角速度 → β 自适应抬升截止频率，延迟随动作速度自动降低（避免「滤波=迟钝」）
            const st = joyRef.current
            const now = e.timeStamp / 1000
            if (st.fAngle === null) {
              st.fAngle = stick // 首次采样直接透传，避免从旧值摆入
              st.fDeriv = 0
              st.fTime = now
            } else {
              const dtF = Math.max(1e-3, now - st.fTime)
              let diff = stick - st.fAngle
              diff = (((diff + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) - Math.PI // 环绕最短弧（倒档过 ±180° 边界时防止滤波绕远路）
              const aD = 1 / (1 + 1 / (Math.PI * 2 * OE_D_CUTOFF) / dtF) // 导数通道 α=1/(1+τ/dt)
              st.fDeriv += aD * (diff / dtF - st.fDeriv)
              const cutoff = OE_MIN_CUTOFF + OE_BETA * Math.abs(st.fDeriv)
              st.fAngle += (1 / (1 + 1 / (Math.PI * 2 * cutoff) / dtF)) * diff
              st.fTime = now
            }
            stick = st.fAngle
            // 微吸正：EMA 只能逼近 0/π 不能到达，<1.5° 直接归零补足「回正=严格直行」语义
            const nearFwd = Math.abs(stick)
            const nearRev = Math.PI - Math.abs(stick)
            if (Math.min(nearFwd, nearRev) < FILTER_SNAP) stick = nearRev < nearFwd ? Math.PI : 0
          }
          // 相对方向控制：摇杆方向以堡垒「实时」船头朝向为基准——正推=沿当前船头直行（不转向），
          // 斜推 θ=移动并转向「当前船头 + θ」（v1.39：基准由锁定瞬间锚定改为实时船头——转向中基准随
          // 船体一起转，保持一个偏角 = 持续转向，摇杆回正 = 立即沿当前船头直行，方向盘手感）
          const world = gameRef.current.fortress.heading + stick
          // 模拟量推进：推出幅度 → 速度上限（满推 40px = 全速）
          const mag = Math.min(1, len / 40)
          gameRef.current.turnDir = 0
          gameRef.current.moveMag = mag
          if (mode === 'rev') {
            // 倒退：沿船头反方向行驶（极速/加速度 × 倒退系数），船尾朝摇杆相对方向（目标船头 = 相对方向 + 180°）
            gameRef.current.reverse = true
            gameRef.current.desiredHeading = world + Math.PI
            gameRef.current.moveDir.x = 0
            gameRef.current.moveDir.y = 0
          } else {
            // 前进：相对方向 = 移动方向 + 堡垒目标朝向（速率追踪，转弯半径>0 时弧线转向）
            gameRef.current.reverse = false
            gameRef.current.moveDir.x = Math.sin(world)
            gameRef.current.moveDir.y = -Math.cos(world)
            gameRef.current.desiredHeading = world
          }
        } else {
          // 死区内：保持已锁定的模式（松手才解除），只清空推进
          gameRef.current.moveDir.x = 0
          gameRef.current.moveDir.y = 0
          gameRef.current.moveMag = 1
          gameRef.current.desiredHeading = null
          gameRef.current.reverse = joyRef.current.mode === 'rev'
        }
        // 摇杆头视觉位置 = 钳制后偏角 × 原始幅度（v1.48：手指在对侧半球时摇杆头吸在 ±90° 边界上）
        const effStick = stickForView ?? Math.atan2(dx / len, -dy / len)
        const ddx = Math.sin(effStick) * len
        const ddy = -Math.cos(effStick) * len
        const cl = len > 30 ? 30 / len : 1 // 摇杆头视觉半径 30px
        const rect = containerRef.current?.getBoundingClientRect()
        setJoy({ x: d.startX - (rect?.left ?? 0), y: d.startY - (rect?.top ?? 0), dx: ddx * cl, dy: ddy * cl, rev: joyRef.current.mode === 'rev' })
      }
    }
  }
  const endJoystick = (pointerId: number) => {
    if (joyRef.current?.id !== pointerId) return
    joyRef.current = null
    setJoy(null)
    applyKeys() // v1.62：键盘仍按住时恢复键盘方向/转向（坦克式键位；内含 desiredHeading=null）
  }
  const onPointerUp = (e: React.PointerEvent) => {
    ptrsRef.current.delete(e.pointerId)
    if (pinchRef.current && ptrsRef.current.size < 2) pinchRef.current = null
    const d = dragRef.current
    dragRef.current = null
    endJoystick(e.pointerId)
    if (d && !d.moved && !d.painting) {
      const c = toCell(e)
      if (edit) paintAt(Math.floor(c.x), Math.floor(c.y))
      else doClickCell(c.x, c.y)
    }
  }
  const onPointerCancel = (e: React.PointerEvent) => {
    ptrsRef.current.delete(e.pointerId)
    if (pinchRef.current && ptrsRef.current.size < 2) pinchRef.current = null
    dragRef.current = null
    endJoystick(e.pointerId)
  }

  const reset = () => {
    setGame(initialState())
    setMode({ kind: 'none' })
    setSelTurret(null)
    setViewX(0)
    setViewY(LEVEL.rows - VIEW_ROWS)
  }

  const earlyBonus = Math.ceil(game.prepLeft) * 2
  // 交战敌人构成：场上存活 + 待出场，按类型计数
  const enemyComp = (() => {
    const counts = new Map<string, number>()
    for (const e of game.enemies) counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1)
    for (const it of game.spawnQueue) counts.set(it.kind, (counts.get(it.kind) ?? 0) + 1)
    return Array.from(counts.entries())
  })()

  const selectedTurret = selTurret != null ? game.turrets.find(t => t.id === selTurret) : undefined

  // v1.53 面板开关：炮塔/模块互斥；再点一次当前按钮关闭并恢复摇杆；模块面板进出内部空间
  const togglePanel = (p: 'turret' | 'module') => {
    if (panel === p) {
      setPanel(null); setInterior(false); setInteriorSel(null); setInteriorDemo(false); setMode({ kind: 'none' })
    } else {
      setPanel(p)
      if (p === 'module') { setInterior(true); setMode({ kind: 'none' }); setSelTurret(null) }
      else { setInterior(false); setInteriorSel(null); setInteriorDemo(false) }
    }
  }

  return (
    <div className="relative w-full h-full flex flex-col bg-[#8A8B6D] overflow-hidden select-none">
      <div className="absolute inset-0 halftone pointer-events-none z-30" />

      {/* 虚拟摇杆（触屏移动堡垒）：按住战场拖动出现，松手消失 */}
      {joy && (
        <div className="absolute pointer-events-none z-40" style={{ left: joy.x - 48, top: joy.y - 48, width: 96, height: 96 }}>
          <div className="absolute inset-0 rounded-full border-2 border-black/50 bg-black/20" />
          <div className={`absolute rounded-full border-2 border-black/70 ${joy.rev ? 'bg-[#B3392E]/85' : 'bg-[#E8E4D8]/85'}`}
            style={{ width: 36, height: 36, left: 30 + joy.dx, top: 30 + joy.dy }} />
        </div>
      )}

      {/* 顶部信息带：波次 | 开波（原基地生命位）| debug */}
      <div className="relative z-10 flex items-stretch gap-1 px-2 pt-2">
        <div className="flex-1 comic-panel px-2 py-1 flex items-center justify-center gap-1">
          <Hammer className="w-3.5 h-3.5" />
          <span className="font-comic text-sm leading-none">波次 {Math.min(game.wave, TOTAL_WAVES)}/{TOTAL_WAVES}</span>
        </div>
        {prep ? (
          <button
            type="button"
            onClick={() => setGame(g => startWave(g, earlyBonus))}
            className="flex-1 comic-panel comic-btn px-2 py-1 flex items-center justify-center gap-1"
          >
            <Play className="w-3.5 h-3.5" />
            <span className="font-comic text-xs leading-none">
              开波 {Math.ceil(game.prepLeft)}s{earlyBonus > 0 ? ` +${earlyBonus}` : ''}
            </span>
          </button>
        ) : (
          <div className="flex-1 comic-panel px-2 py-1 flex items-center justify-center gap-1 overflow-hidden">
            {game.phase === 'combat' ? (
              // 交战信息：敌人构成（类型标志 + 数量，含场上与待出场）
              enemyComp.map(([k, n]) => (
                <span key={k} className="flex items-center gap-[2px] shrink-0">
                  <span
                    className="w-2.5 h-2.5 border border-black inline-block"
                    style={{ backgroundColor: ENEMY_DEFS[k as keyof typeof ENEMY_DEFS].color }}
                  />
                  <span className="font-comic text-[10px] font-black leading-none">×{n}</span>
                </span>
              ))
            ) : (
              <span className="font-comic text-xs leading-none text-black/60">—</span>
            )}
          </div>
        )}
        <button
          type="button"
          title="DEBUG：编辑炮塔参数"
          onClick={() => setShowDebug(v => !v)}
          className={`comic-btn px-1.5 flex items-center shrink-0 ${showDebug ? 'bg-[#B3392E] text-[#EFEBD8]' : ''}`}
        >
          <Bug className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* 中部横版布局：画布列（左）+ 控制侧栏（右）；竖屏回退为上下 */}
      <div className="relative z-10 flex-1 min-h-0 mx-2 mt-1 mb-1 flex flex-row portrait:flex-col gap-1">
      <div className="flex-1 min-w-0 min-h-0 flex flex-col">
      {/* 战场画布（镜头跟随堡垒；滚轮/双指缩放） */}
      <div ref={containerRef} className="relative flex-1 min-h-0 flex items-center justify-center overflow-hidden">
        <div className="border-[3px] border-black" style={{ width: size.w, height: size.h }}>
          <canvas
            ref={canvasRef}
            style={{ width: size.w, height: size.h, display: 'block', touchAction: 'none' }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
            onPointerLeave={() => setHover(null)}
          />
        </div>

        {/* v1.53 战场右缘悬浮面板：炮塔/模块列表（竖排悬浮覆盖战场右缘，一列排完自动排第二列）；打开期间摇杆禁用 */}
        {!edit && panel !== null && (
          <div className="absolute right-1 top-1 bottom-1 z-40 flex flex-col flex-wrap content-start justify-center gap-1 overflow-hidden">
            {panel === 'turret' ? (
              <>
                {TURRET_DEFS.map(def => {
                  const Icon = cardIcon(def)
                  const active = mode.kind === 'turret' && mode.defId === def.id
                  const afford = game.gold >= def.cost
                  return (
                    <button
                      key={def.id}
                      type="button"
                      disabled={!prep}
                      onClick={() => { setMode(active ? { kind: 'none' } : { kind: 'turret', defId: def.id }); setSelTurret(null) }}
                      className={`comic-panel relative px-0.5 py-1 flex flex-col items-center gap-[2px] transition-transform disabled:opacity-50 ${
                        active ? 'border-[#B3392E] -translate-y-1 shadow-[4px_6px_0_#1A1A18]' : ''
                      } ${!afford && prep ? 'opacity-60' : ''}`}
                    >
                      <div className="w-5 h-5 border-2 border-black flex items-center justify-center" style={{ backgroundColor: def.color }}>
                        <Icon className="w-3 h-3 text-black/70" strokeWidth={2.5} />
                      </div>
                      <span className="text-[9px] font-black leading-none whitespace-nowrap">{def.name}</span>
                      {/* 炮位型号 + 造价（弹药/电量等战斗消耗不在牌面显示） */}
                      <span className="text-[8px] font-bold leading-none flex items-center gap-[2px]">
                        <span className="px-[2px] border border-black/60 bg-black/10">{def.mount}型</span>
                        <span className="text-[#8a6a1d] flex items-center gap-[1px]"><Coins className="w-[9px] h-[9px]" />{def.cost}</span>
                      </span>
                    </button>
                  )
                })}
                {/* 拆除工具 */}
                <button
                  type="button"
                  disabled={!prep}
                  onClick={() => setMode(mode.kind === 'demolish' ? { kind: 'none' } : { kind: 'demolish' })}
                  className={`comic-panel relative px-1 py-1 flex flex-col items-center gap-[2px] transition-transform disabled:opacity-50 ${
                    mode.kind === 'demolish' ? 'border-[#B3392E] -translate-y-1 shadow-[4px_6px_0_#1A1A18]' : ''
                  }`}
                >
                  <div className="w-5 h-5 border-2 border-black bg-[#8C8078] flex items-center justify-center">
                    <Trash2 className="w-3 h-3 text-black/70" strokeWidth={2.5} />
                  </div>
                  <span className="text-[9px] font-black leading-none whitespace-nowrap">拆除</span>
                  <span className="text-[7px] font-bold text-black/50 leading-none whitespace-nowrap">返还半价</span>
                </button>
              </>
            ) : (
              <>
                {MODULE_DEFS.map((d: ModuleDef) => {
                  const active = interiorSel === d.id
                  const afford = game.gold >= d.cost
                  return (
                    <button
                      key={d.id}
                      type="button"
                      disabled={!prep}
                      onClick={() => { setInteriorSel(active ? null : d.id); setInteriorDemo(false); setInteriorRot(0) }}
                      title={d.desc}
                      className={`comic-panel relative px-0.5 py-1 flex flex-col items-center gap-[2px] transition-transform disabled:opacity-50 ${
                        active ? 'border-[#B3392E] -translate-y-1 shadow-[4px_6px_0_#1A1A18]' : ''
                      } ${!afford && prep ? 'opacity-60' : ''}`}
                    >
                      <div className="w-5 h-5 border-2 border-black flex items-center justify-center overflow-hidden" style={{ backgroundColor: d.color }}>
                        {d.asset && getAsset(d.asset) ? ( // v2.30 模块贴图（素材库模块分类锚定）；缺省 Zap 图标回退
                          <img src={getAsset(d.asset)!.src} alt="" className="w-full h-full object-contain" />
                        ) : (
                          <Zap className="w-3 h-3 text-black/70" strokeWidth={2.5} />
                        )}
                      </div>
                      <span className="text-[9px] font-black leading-none whitespace-nowrap">{d.name} {d.w}×{d.h}</span>
                      <span className="text-[8px] font-bold text-[#8a6a1d] leading-none flex items-center gap-[1px]">
                        <Coins className="w-[9px] h-[9px]" />{d.cost}
                      </span>
                    </button>
                  )
                })}
                {/* 模块拆除工具 */}
                <button
                  type="button"
                  disabled={!prep}
                  onClick={() => { setInteriorDemo(d => !d); setInteriorSel(null) }}
                  className={`comic-panel relative px-1 py-1 flex flex-col items-center gap-[2px] transition-transform disabled:opacity-50 ${
                    interiorDemo ? 'border-[#B3392E] -translate-y-1 shadow-[4px_6px_0_#1A1A18]' : ''
                  }`}
                >
                  <div className="w-5 h-5 border-2 border-black bg-[#8C8078] flex items-center justify-center">
                    <Trash2 className="w-3 h-3 text-black/70" strokeWidth={2.5} />
                  </div>
                  <span className="text-[9px] font-black leading-none whitespace-nowrap">拆模块</span>
                  <span className="text-[7px] font-bold text-black/50 leading-none whitespace-nowrap">返还半价</span>
                </button>
                {/* 旋转 */}
                <button
                  type="button"
                  disabled={!interiorSel}
                  onClick={() => setInteriorRot(r => (r ? 0 : 1))}
                  className="comic-panel relative px-1 py-1 flex flex-col items-center gap-[2px] transition-transform disabled:opacity-50"
                >
                  <div className="w-5 h-5 border-2 border-black bg-[#7E8A94] flex items-center justify-center">
                    <Rocket className="w-3 h-3 text-black/70 rotate-90" strokeWidth={2.5} />
                  </div>
                  <span className="text-[9px] font-black leading-none whitespace-nowrap">旋转 R</span>
                  {interiorSel && (
                    <span className="text-[7px] font-bold text-black/50 leading-none whitespace-nowrap">
                      {moduleFoot(moduleDefOf(interiorSel), interiorRot).w}×{moduleFoot(moduleDefOf(interiorSel), interiorRot).h}
                    </span>
                  )}
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* 选中炮塔面板 */}
      {selectedTurret && (
        <div className="relative z-20 mt-1 comic-panel px-2 py-1 flex items-center gap-2">
          {(() => {
            const def = defOf(selectedTurret.defId)
            const maxed = selectedTurret.level >= 3
            const cost = maxed ? 0 : upgradeCost(def, selectedTurret.level)
            return (
              <>
                <div className="min-w-0">
                  <div className="font-comic text-xs leading-tight">
                    {def.name} <span className="text-black/50">Lv.{selectedTurret.level}</span>
                    <span className="text-black/40 text-[10px]"> {def.w}×{def.h}格</span>
                  </div>
                  <div className="text-[10px] text-black/60 leading-tight flex items-center gap-1">
                    {game.fortress.overheated && <span className="text-[#B3392E] font-black">堡垒过热停火中</span>}
                    {selectedTurret.chargeLeft > 0 && <span className="text-[#2E63B8] font-black">充能中</span>}
                  </div>
                </div>
                <div className="ml-auto flex items-center gap-1 shrink-0">
                  {maxed ? (
                    <span className="text-[10px] font-black text-black/50 px-1">已满级</span>
                  ) : (
                    <button
                      type="button"
                      disabled={!prep || game.gold < cost}
                      onClick={() => setGame(g => upgradeTurret(g, selectedTurret.id))}
                      className="comic-btn px-2 py-[2px] text-xs font-comic disabled:opacity-40"
                    >
                      升级 {cost}废料
                    </button>
                  )}
                  {prep && !selectedTurret.builtIn && (
                    <button
                      type="button"
                      onClick={() => { setGame(g => demolishAt(g, selectedTurret.x, selectedTurret.y)); setSelTurret(null) }}
                      className="comic-panel px-1 py-[2px] text-[10px] font-black"
                    >
                      卸下
                    </button>
                  )}
                </div>
              </>
            )
          })()}
        </div>
      )}

      </div>{/* /画布列 */}

      {/* 控制侧栏：仅场景编辑笔刷栏（v1.53：游玩 UI 迁至置底栏 + 战场右缘悬浮面板） */}
      {edit && (
      <div className="w-[168px] portrait:w-full portrait:max-h-[46%] shrink-0 min-h-0 overflow-y-auto overflow-x-hidden">
        <div className="relative z-10 pb-1">
          <div className="comic-panel px-2 py-1 mb-1 flex items-center gap-1">
            <span className="font-comic text-[11px] font-black">
              {edit.picked ? '移动中：点目标格放下' : '场景编辑中（已暂停）'}
            </span>
            {edit.picked && (
              <button
                type="button"
                className="comic-btn px-2 py-0.5 text-[10px]"
                onClick={cancelMove}
              >
                取消放回
              </button>
            )}
            <button
              type="button"
              className="ml-auto comic-btn px-2 py-0.5 text-[10px] font-black"
              onClick={applyEdit}
            >
              应用并重开
            </button>
            <button
              type="button"
              className="comic-btn px-2 py-0.5 text-[10px]"
              onClick={() => setEdit(null)}
            >
              退出编辑
            </button>
          </div>
          <div className="grid grid-cols-3 portrait:grid-cols-6 gap-1">
            {([
              ['puddle', '水坑', '#5E7078'], ['barrel', '油桶', '#A05C48'], ['ruins', '废墟', '#5A564E'],
              ['rock', '岩石', '#7A7264'], ['buildzone', '基地格', '#D9A441'], ['ground', '战场地面', '#6F7E6A'],
              ['building', '固有建筑', '#8A8272'], ['core', '核心', '#C8B568'], ['turret', '初始炮塔', '#5C7E8C'],
              ['eraser', '橡皮擦', '#C9C29F'], ['move', '移动', '#EFEBD8'],
            ] as [Brush, string, string][]).map(([id, name, color]) => (
              <button
                key={id}
                type="button"
                onClick={() => setEdit(cur => {
                  if (!cur) return cur
                  // 切换笔刷时若有取出的元素，先放回原地
                  if (cur.picked) {
                    const d = structuredClone(cur.draft)
                    dropPicked(d, cur.picked, cur.picked.data.x, cur.picked.data.y)
                    return { ...cur, draft: d, brush: id, picked: null }
                  }
                  return { ...cur, brush: id }
                })}
                className={`comic-panel px-1 py-1 flex flex-col items-center gap-[2px] transition-transform ${
                  edit.brush === id ? 'border-[#B3392E] -translate-y-1 shadow-[4px_6px_0_#1A1A18]' : ''
                }`}
              >
                <div className="w-6 h-6 border-2 border-black" style={{ backgroundColor: color }} />
                <span className="text-[10px] font-black leading-none">{name}</span>
              </button>
            ))}
          </div>
          <div className="text-center text-[9px] text-black/50 font-bold mt-1">
            {edit.brush === 'building'
              ? '点地图放置/移动选中建筑（在 DEBUG 面板选择）'
              : edit.brush === 'core'
                ? '点地图移动核心建筑（锚定点击格）'
                : edit.brush === 'turret'
                  ? `点地图放置初始炮塔「${TURRET_DEFS.find(d => d.id === BRUSH_DEFAULTS.turretDefId)?.name ?? '?'}」`
                  : edit.brush === 'eraser'
                    ? '点击/拖动擦除该格所有编辑层内容（含初始墙与核心）'
                    : edit.brush === 'move'
                      ? '点任意元素取出（幽灵跟随）→ 点目标格放下 · ESC/取消放回原地'
                      : '点击或按住拖动连续铺设 · 上下拖空白处查看全战场'}
          </div>
        </div>
      </div>
      )}
      </div>{/* /中部横版布局 */}

      {/* v1.53 置底主 UI（游玩模式，横竖版统一）：左=速度(数值占位，后续换仪表贴图)+废料(原金币)；
          中=防御/热量/弹药/电量 2×2 进度条；右=炮塔/模块双按钮（切换右缘悬浮列表） */}
      {!edit && (
      <div className="relative z-10 mx-2 mb-1 comic-panel px-2 py-1 flex items-center gap-2">
        <div className="flex flex-col justify-center gap-[3px] shrink-0">
          <div className="flex items-center gap-1 leading-none" title="堡垒实时速度">
            <Gauge className="w-3 h-3 text-black/70" strokeWidth={2.5} />
            <span className="font-comic text-[11px] leading-none">{Math.hypot(game.fortress.vx, game.fortress.vy).toFixed(1)}</span>
            <span className="text-[8px] font-bold text-black/50 leading-none">格/s</span>
          </div>
          <div className="flex items-center gap-1 leading-none" title="废料（原金币）">
            <Coins className="w-3 h-3 text-[#8a6a1d]" />
            <span className="font-comic text-[11px] leading-none">{game.gold}</span>
            <span className="text-[8px] font-bold text-black/50 leading-none">废料</span>
          </div>
        </div>
        <div className="flex-1 min-w-0 grid grid-cols-2 gap-x-2 gap-y-[3px]">
          <ResourceBar label="防御" value={Math.ceil(game.fortress.hp)} max={game.fortress.maxHp} color="#8C4A3C" />
          <ResourceBar label="热量" value={Math.round(game.fortress.heat)} max={fortressDef(game).heatCap} color="#D9762E" />
          <ResourceBar label="弹药" value={game.ammo} max={resourceCaps(game).ammoCap} color="#A07840" />
          <ResourceBar label="电量" value={game.energy} max={resourceCaps(game).energyCap} color="#5C7E8C" />
        </div>
        {game.fortress.overheated && <span className="text-[10px] font-black text-[#B3392E] shrink-0">过热停火!</span>}
        <div className="flex flex-col gap-1 shrink-0">
          <button
            type="button"
            onClick={() => togglePanel('turret')}
            className={`comic-panel px-2 py-1 text-[10px] font-black leading-none transition-transform ${panel === 'turret' ? 'border-[#B3392E] -translate-y-0.5 shadow-[2px_3px_0_#1A1A18]' : ''}`}
          >炮塔</button>
          <button
            type="button"
            onClick={() => togglePanel('module')}
            className={`comic-panel px-2 py-1 text-[10px] font-black leading-none transition-transform ${panel === 'module' ? 'border-[#B3392E] -translate-y-0.5 shadow-[2px_3px_0_#1A1A18]' : ''}`}
          >模块</button>
        </div>
      </div>
      )}

      {/* 胜负遮罩 */}
      {(game.phase === 'won' || game.phase === 'lost') && (
        <div className="absolute inset-0 z-40 bg-black/60 flex items-center justify-center p-6">
          <div className="comic-panel w-full max-w-[280px] px-4 py-6 flex flex-col items-center gap-3 rotate-[-1.5deg] animate-[slam_0.25s_ease-out]">
            <div className={`font-comic text-3xl ${game.phase === 'lost' ? 'text-[#B3392E]' : ''}`}>
              {game.phase === 'lost' ? '堡垒被毁' : '废土守住了'}
            </div>
            <div className="text-xs font-bold text-black/60">
              {game.phase === 'lost'
                ? `移动堡垒在第 ${game.wave} 波被击穿`
                : `你守住了全部 ${TOTAL_WAVES} 波进攻 · 击杀 ${game.kills}`}
            </div>
            <button type="button" onClick={reset} className="comic-btn px-4 py-2 font-comic text-sm">
              再来一局
            </button>
          </div>
        </div>
      )}

      {showDebug && (
        <DebugPanel
          onClose={() => setShowDebug(false)}
          onDeleteDef={(defId) => {
            // 删除自定义炮塔时，同步移除场上已放置实例并清理相关选择/建造状态
            setGame(g => ({ ...g, turrets: g.turrets.filter(t => t.defId !== defId) }))
            setSelTurret(sel => {
              const t = game.turrets.find(t => t.id === sel)
              return t?.defId === defId ? null : sel
            })
            setMode(m => (m.kind === 'turret' && m.defId === defId ? { kind: 'none' } : m))
          }}
          onRestart={() => {
            // 战场编辑器应用/恢复默认：重置本局并清理选择/模式
            setGame(initialState())
            setSelTurret(null)
            setMode({ kind: 'none' })
          }}
          onPatchGame={(fn) => setGame(g => { fn(g); return { ...g } })}
          onEnterSceneEdit={() => {
            // 进入场景编辑：深拷贝 LEVEL 为草稿，切备战视角并暂停
            const draft = structuredClone(LEVEL)
            draft.initialWalls = [] // 防御墙由基地格派生，编辑器不再管理墙体（旧数据弃置）
            setEdit({ draft, brush: 'buildzone', picked: null })
            setShowDebug(false)
            setMode({ kind: 'none' })
            setSelTurret(null)
            setViewX(0)
            setViewY(LEVEL.rows - VIEW_ROWS)
          }}
        />
      )}
    </div>
  )
}

function ResourceBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  return (
    <div className="flex-1 flex items-center gap-1">
      <span className="text-[9px] font-black text-black shrink-0">{label}</span>
      <div className="flex-1 h-[8px] border-2 border-black bg-black/30">
        <div className="h-full" style={{ width: `${Math.min(100, (value / max) * 100)}%`, backgroundColor: color }} />
      </div>
      <span className="text-[9px] font-bold text-black/60 w-6 text-right">{Math.floor(value)}</span>
    </div>
  )
}
