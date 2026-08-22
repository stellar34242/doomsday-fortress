// 废土防线 · 静态配置
// 数值体系严格对应《战场空间设计文档》与《炮塔系统属性文档 v1.1》。

// ================= 全局换算 =================
/** 1 格 = 25 m（格-米换算全局配置，战场文档 §2.1 前置配置项） */
export const M_PER_CELL = 25
export const m2c = (m: number) => m / M_PER_CELL
export const c2m = (c: number) => c * M_PER_CELL

// ================= 战场几何（逻辑坐标，Y=0 在顶部） =================
export const COLS = 42 // 战场宽 1050m（横版：横向卷动 + 缩放，镜头跟随）；v2.45 口令(5)：36→42
export const ROWS = 72 // 战场纵深 1800m（v1.75：默认 18 → 72；旧存档保留原值）
export const VIEW_COLS = 20 // 视口宽 500m（横版基准；滚轮/捏合缩放改变实际可见范围）
export const VIEW_ROWS = 12 // 视口高 300m
// 基准格像素（v1.49）：全设备/横竖屏统一 30px=1格，不再按容器适配——与贴图设计基准（30px=1格）恒吻合，
// 堡垒/炮塔/敌兵贴图与战场网格的比例在任何设备、任何朝向完全一致；竖版视口 = 12×20（宽高对调）
export const BASE_CELL = 30
export const SPAWN_ROWS = 1 // 出生带：仅最顶层行 0，不可建造
export const WALL_ROW = 18 // 防御墙所在行（基地围合墙顶边），同属可建造区：墙拆除后该格可建炮塔/重建墙
export const BASE_TOP = 19 // 基地区起始行
export const BASE_BOTTOM = 26 // 建造区结束行（含）
// 行 27 与列 0 / 列 11（基地区段）为模板外轮廓墙，围合基地区

// ================= 移动堡垒（玩家基地；船体血量取代墙圈/核心） =================

export type MountSize = 'S' | 'M' | 'L'
/** v1.76：型号决定占格——S=1×1 / M=1×2 / L=2×2（占格长/宽不再单独编辑，随型号联动） */
export const MOUNT_FOOT: Record<MountSize, { w: number; h: number }> = {
  S: { w: 1, h: 1 }, M: { w: 1, h: 2 }, L: { w: 2, h: 2 },
}
/** 按型号归一化占格（编辑器改型号 / 配置加载·导入·重置时调用） */
export function applyMountFoot(d: { mount: MountSize; w: number; h: number }): void {
  const f = MOUNT_FOOT[d.mount]
  if (f) { d.w = f.w; d.h = f.h }
}

/** 炮位：堡垒局部坐标（格，锚点中心，可为小数）；hidden=内置隐藏硬点（不出现在挂载 UI，预挂 builtIn 炮塔且不可卸载）
 *  arc = 指定视角（度，相对船头 0=上 顺时针，支持跨 0°，如 {start:315,end:45}）；未配置 = 全向
 *  fixed = 固定视角（v1.98，度，-180~180，上方 0° 逆时针为负 顺时针为正）：炮口恒定朝此角不追踪；与 arc 互斥（fixed 优先） */
export interface Hardpoint { id: string; x: number; y: number; size: MountSize; arc?: { start: number; end: number }; fixed?: number; types?: WeaponType[]; hidden?: boolean; builtIn?: string; zLevel?: number } // types = 允许挂载的炮塔类型（未配置 = 不限）；zLevel = 渲染层级（v1.82：默认 1，越大越高，仅决定同尺寸炮塔在堡垒上的叠放顺序）

/** 模块特殊格加成类别：置于该格的模块对应属性 ×SPECIAL_MULT（生产类 = 产出间隔 ÷SPECIAL_MULT） */
export type SpecialBoost = 'energy' | 'ammo' | 'cooling' | 'repair' | 'range' | 'produce' | 'hp' | 'speed' | 'turn'
export const SPECIAL_BOOST_NAME: Record<SpecialBoost, string> = {
  energy: '电力', ammo: '弹药', cooling: '散热', repair: '维修', range: '火控',
  produce: '生产', hp: '结构', speed: '机动', turn: '转向',
}
export const SPECIAL_MULT = 1.5 // 特殊格属性倍率
export interface InteriorSpecial { x: number; y: number; boost: SpecialBoost } // 内部空间局部格坐标

/** 堡垒特效点：贴附船体的粒子发射点，按停止/移动状态切换播放（仅视觉，不参与碰撞）。
 *  v2.40：改为真实世界粒子——发射位置随船体，粒子离口即在世界空间独立运动（不再跟船） */
export type FortressEffectKind = 'smoke' | 'flame' | 'dust' | 'spark'
export const EFFECT_KIND_NAME: Record<FortressEffectKind, string> = { smoke: '烟雾', flame: '火焰', dust: '尘土', spark: '火花' }
export type FortressEffectState = 'idle' | 'move' | 'both' // 停止时 / 移动时 / 两者皆播放
export const EFFECT_STATE_NAME: Record<FortressEffectState, string> = { idle: '停止时', move: '移动时', both: '始终' }
/** v2.40 渲染层级：ground = 地面层（地形之上/堡垒底座之下）；air = 空中层（最上，现状口径） */
export type FortressEffectLayer = 'ground' | 'air'
export const EFFECT_LAYER_NAME: Record<FortressEffectLayer, string> = { ground: '地面（底座下）', air: '空中（最上）' }
export interface FortressEffectPoint {
  id: string; x: number; y: number // x/y = 堡垒局部坐标（格，可为小数）
  kind: FortressEffectKind; state: FortressEffectState
  layer?: FortressEffectLayer // 渲染层级（缺省：dust=ground，其余=air）
  rate?: number // 发射速率 粒/s（缺省按 kind）
  size?: number // 粒子尺寸 格（缺省按 kind）
  life?: number // 粒子寿命 秒（缺省按 kind）
  inherit?: number // 堡垒速度继承 0~1（缺省：dust=0.3，其余=0）
}

/** 履带定义（v1.85 瓦片循环动画；v1.86 调整）：堡垒局部格坐标；瓦片沿「前轮心→后轮心」直线段排布，
 * 两端轮半径 R 区间为透视缩短翻滚区（瓦片高度 × cosθ + 渐暗，模拟俯视立体滚动，翻到底面消失）；
 * 滚动相位由引擎按真实位移驱动（倒退反滚），弧线转向左右履带差速（外侧快内侧慢）。仅视觉。
 * v1.86：只需定义【左侧】履带——右侧按堡垒中心线自动镜像（相位独立，差速对称）；
 * 瓦片原图直绘（不旋转）：图宽 = 履带宽度方向、图高 = 板长方向。
 * v1.87：瓦片尺寸一律取素材原图（宽=图宽、板长=图高），不再配置 width/tileLen；重叠改用 pix 单位。 */
export interface TrackDef {
  id: string
  x1: number; y1: number // 前轮心（船头侧，-y 方向）
  x2: number; y2: number // 后轮心
  radius: number // 轮半径（格）= 头尾翻滚区长度
  tile: string // 瓦片素材（素材库引用 id / /sprites 路径 / dataURL）
  overlapPx: number // 拼接重叠（pix，贴图像素）：有效步长 = 图高 − overlapPx
}
/** v2.51 轮子（轮式底盘美术/落印单元；与履带 tracks 独立共存——半履带 = 前 wheels + 后 tracks） */
export interface WheelDef {
  id: string
  x: number; y: number // 轮心（堡垒局部格，原点在左上，-y = 船头方向）
  unit?: 'single' | 'pair' // 单个 / 一对；pair 以 x 为定义侧，另一侧按堡垒中心线镜像
  r?: number // 遗留轮径字段（v2.73 起忽略，仅为旧存档兼容）
  sprite?: string // 轮胎素材库引用 id（兼容遗留 /res 路径 / dataURL；缺省 = 几何轮胎）
  steered?: boolean // 是否旋转：true 时按轴距与实际/配置转弯半径计算视觉偏角；false/缺省保持与车身平行
}

export interface FortressArmor {
  front: number
  rear: number
  left: number
  right: number
}

export interface FortressDecal {
  id: string
  asset: string
  x: number
  y: number
  size: number
  angle?: number
}

export interface FortressDef {
  id: string
  name: string
  w: number // 底座包围盒 长（格）：自由网格时为 shape 包围盒（编辑器保存时自动重算）
  h: number // 底座包围盒 宽（格）
  /** 自由网格形状：局部格坐标列表 "x,y"；须 4-连通成整体，允许镂空（未配置 = w×h 满矩形）。贴图不参与碰撞，形状格才是碰撞体 */
  shape?: string[]
  spriteBase?: string // 堡垒底座素材库引用 id（兼容遗留 dataURL / /res 路径），仅视觉
  spriteBody?: string // 堡垒主体素材库引用 id（兼容遗留 dataURL / /res 路径），仅视觉
  paint?: { base: string; accent?: string } // 主体乘法染色 + 甲板/方向标强调色；不影响履带、轮子和炮塔
  decals?: FortressDecal[] // 徽记/编号等装饰图，按堡垒局部锚点绘制
  interior: { cols: number; rows: number } // 内部模块空间编辑网格尺寸（interiorCells 缺省时 = 左上角锚定 cols×rows 满矩形）
  interiorCells?: string[] // 内部模块空间自由格阵 "x,y"（须 ⊆ 形状格；缺省 = cols×rows 满矩形）
  interiorSpecials?: InteriorSpecial[] // 内部特殊格：置于其上的模块对应属性加成
  effects?: FortressEffectPoint[] // 特效点：按堡垒停止/移动状态切换播放的程序化粒子（仅视觉）
  tracks?: TrackDef[] // 履带（v1.85：瓦片循环滚动动画，仅视觉；未配置 = 无履带动画层）
  hp: number // 船体结构值
  armor?: FortressArmor // 四向装甲阈值；旧定义缺省为四面 0
  speed: number // 移动速度 格/s
  turnSpeed: number // 横摆角速度上限 度/s（v2.51 起为可选封顶：履带=min(本值, 2×极速/履带间距推导)，轮式=min(本值, v·tanδ/轴距)；未配置语义见各底盘推导）
  turnRadius?: number // 最小转弯半径（格，缺省 0）：>0 时两底盘通用弧线模式覆盖——绕外侧圆心走弧线（转弯带动前行）；0=按底盘物理（履带差速/轮式前轮角）
  // ---------- v2.51 底盘（运动学双底盘；缺省 tracked） ----------
  chassis?: 'tracked' | 'wheeled' // 底盘类型：履带差速（低速可原地枢轴转）/ 轮式前轮转向（静止不能转向）
  trackWidth?: number // 【履带】履带间距（格，缺省 = w）：枢轴角速度推导 = 2×speed/trackWidth
  turnDrag?: number // 【履带】转向阻力 0~0.9（缺省 0）：转向输入期间目标速度 ×(1−turnDrag)
  wheelbase?: number // 【轮式】轴距（格，缺省 = h×0.6）：转弯半径 R = 轴距 / tan(前轮角)
  steerMax?: number // 【轮式】最大前轮转角（度，缺省 35）
  steerRate?: number // 【轮式】方向盘转速（度/秒，缺省 120；无输入时同速率自动回正）
  gripMax?: number // 【轮式】横向附着上限（m/s²，缺省 8）：v²/R 超限即压缩有效前轮角（高速打不死方向；运动学无漂移，漂移另版）
  wheels?: WheelDef[] // 轮子（视觉+落印；与 tracks 独立共存）
  reverseFactor?: number // 倒退系数（缺省 0.8，0~1）：倒退最大速度 = 前进 × 系数，加速度同样 × 系数（如 0.8 = 倒退极速/加速度为前进的 80%）
  brakeInertia?: number // 刹停惯性（1~10，缺省 5）：减速度倍率——1 = 3×加速度急停，5 = 等于加速度，10 = 1/5 加速度长滑行
  pitchGain?: number // 车身俯仰强度（0~10，缺省 4；0=关闭）：汽车悬挂拟真——偏移 = 加速度反向映射（加速后倾/减速前倾/转向侧倾×0.4）
  leanCap?: number // v1.93：俯仰位移上限（px，1~8，缺省 4）——目标倾角钳制值；弹簧过冲软上限 = 本值 + 1
  accel: number // 加速度 格/s²（加/减速同率）
  heatCap: number // 热量上限：所有炮塔开火产热汇聚于此，攒满即过热（全炮塔停火）
  heatDissipation: number // 自然散热（点/s）：持续生效；散热器模块直接叠加到此速率
  hardpoints: Hardpoint[]
  color: string
}

/** 过热解除阈值：堡垒热量降至上限 × 此比例时炮塔恢复射击（迟滞，防抖动） */
export const OVERHEAT_RESUME = 0.5

/** 松手转向过渡时间常数（秒，v1.56）：转向输入解除后角速度按 exp(-t/τ) 衰减归零 */
export const TURN_COAST_TAU = 0.22

// ---- 开火火光（v1.45 起硬编码，不再提供配置项）：1 张帧条贴图横向均分 2 帧，逐帧缩放 1.4× → 1×，每帧 0.1s ----
export const FLASH_FRAMES = 2
export const FLASH_FRAME_DUR = 0.05 // 每帧时长（秒，v1.60：0.1→0.05，火光总时长 0.1s、后座回位 0.2s）
export const FLASH_DURATION = FLASH_FRAMES * FLASH_FRAME_DUR // 总时长 0.2s
export const FLASH_SCALES: readonly number[] = [1.4, 1] // 逐帧缩放

export const FORTRESS_DEFS: FortressDef[] = [
  {
    id: 'standard', name: '测试堡垒', w: 5, h: 8, color: '#767A6E',
    spriteBase: '/res/fortresses/fort_1_02.png', // 内置底座贴图（原比例居中不缩放）
    spriteBody: '/res/fortresses/fort_1_01.png', // 内置主体贴图（原比例居中不缩放）
    interior: { cols: 5, rows: 8 },
    hp: 2000, armor: { front: 4, rear: 2, left: 3, right: 3 }, speed: 6, turnSpeed: 25, turnRadius: 10, reverseFactor: 0.8, brakeInertia: 4, pitchGain: 2, leanCap: 2, accel: 3, // v1.54：测试堡垒机动参数调整（速度6/加速度3/俯仰2/转向25°s/半径10格）；v2.19 口令(4)：leanCap 4→2
    heatCap: 200, heatDissipation: 10,
    tracks: [ // v1.85：按 fort_1_02.png 履带条带标定；v1.86：仅左履带（右侧自动镜像）；v1.87：瓦片尺寸取原图（20×8）、重叠 2pix
      { id: 'trackL', x1: 0.43, y1: 0.83, x2: 0.43, y2: 7.37, radius: 0.5, tile: 'builtin:library/track01', overlapPx: 2 },
    ],
    effects: [ // v2.45 口令(5)沉淀：尾部双排烟（移动时）+ 两侧尘土（移动/静止）
      { id: 'fx-24572', x: 1.9, y: 7.5, kind: 'smoke', state: 'move' },
      { id: 'fx-28202', x: 3.1, y: 7.5, kind: 'smoke', state: 'move' },
      { id: 'fx-29783', x: 1.9, y: 8, kind: 'smoke', state: 'move' },
      { id: 'fx-30781', x: 3.1, y: 8, kind: 'smoke', state: 'move' },
      { id: 'fx-94523', x: 0.5, y: 7.8, kind: 'dust', state: 'both' },
      { id: 'fx-95876', x: 4.5, y: 7.8, kind: 'dust', state: 'both' },
    ],
    hardpoints: [ // v1.72：口令覆盖——11 炮位布局（无隐藏内置；射界角度原样保留口令值，允许 >360/负值回绕）
      { id: 'hpL1', x: 2.5, y: 4.2, size: 'L' },
      { id: 'hpM1', x: 0.9, y: 3.7, size: 'M', arc: { start: 180, end: 415 } },
      { id: 'hpM2', x: 4.1, y: 3.7, size: 'M', arc: { start: -55, end: 180 } },
      { id: 'hpS1', x: 1.5, y: 2, size: 'S', arc: { start: 215, end: 375 } },
      { id: 'hpS2', x: 3.5, y: 2, size: 'S', arc: { start: -15, end: 145 } },
      { id: 'hp6-847', x: 1.5, y: 2.7, size: 'S', arc: { start: 235, end: -30 } },
      { id: 'hp7-980', x: 3.5, y: 2.7, size: 'S', arc: { start: 385, end: 125 } },
      { id: 'hp8-584', x: 1.1, y: 5.1, size: 'S', types: ['missile'], fixed: -90 },
      { id: 'hp9-909', x: 3.9, y: 5.1, size: 'S', types: ['missile'], fixed: 90 },
      { id: 'hp10-288', x: 1.3, y: 6.3, size: 'M', arc: { start: 190, end: -20 } },
      { id: 'hp11-561', x: 3.7, y: 6.3, size: 'M', arc: { start: 380, end: 165 } },
    ],
    // v1.72：口令覆盖——内部模块空间自由格阵 3×6（x1-3 / y1-6）
    interiorCells: [
      '1,1', '1,2', '1,3', '1,4', '1,5', '1,6',
      '2,1', '2,2', '2,3', '2,4', '2,5', '2,6',
      '3,1', '3,2', '3,3', '3,4', '3,5', '3,6',
    ],
  },
]
export const DEFAULT_FORTRESS = FORTRESS_DEFS[0]

// ================= 经济与资源 =================
export const START_GOLD = 260
export const PREP_TIME = 120
export const TOTAL_WAVES = 6
// 击杀收益倍率（1.5 = 增加 50%）
export const BOUNTY_MULT = 1.5

export interface ResourcePool { start: number; cap: number; regen: number }
export const AMMO: ResourcePool = { start: 80, cap: 160, regen: 3 }
export const ENERGY: ResourcePool = { start: 90, cap: 150, regen: 9 }

export const WALL_BUILD_COST = 25 // 墙体（1×1）造价
// 所有墙统一为同一种墙：基地防御墙与玩家自建墙同属性、同行为
export const WALL_HP = 420

// ================= 地形（贴地效果层：永不挡弹道、不挡移动） =================
// 地形只覆盖地面（泥地/雪地/弹坑/水坑等），对在其上行走的敌人产生效果（如减速），
// 不对弹道产生任何阻挡。
export type TerrainKind = 'puddle'
export interface TerrainDef {
  kind: TerrainKind
  name: string
  moveModifier: number // 地面移动效果（1 = 无效果）
  color: string
}
export const TERRAIN_DEFS: Record<TerrainKind, TerrainDef> = {
  puddle: { kind: 'puddle', name: '水坑', moveModifier: 0.5, color: '#5E7078' },
}
export interface TerrainBlock { kind: TerrainKind; x: number; y: number; w: number; h: number }
export const TERRAIN: TerrainBlock[] = [] // 战场暂为空地（18×36）：默认无地形效果块

// ================= 物体（战场文档 §8 新口径） =================
// 物体细分为是否有耐久：hp = -1 表示不会被破坏（不扣耐久、不摧毁）。
// 物体可选择是否阻挡弹道；阻挡弹道 = 阻挡实弹、喷射、射线类（点射 pulse / 光束 beam）。
// 有耐久的物体在阻挡弹道的同时自身耐久下降（被打掉），归零则摧毁移除。
// 导弹一般可越过阻挡弹道的物体，但目标刚好在物体后面（紧邻 ≤ 物体高度 height 格）时会被物体阻挡。
// 阻挡弹道的物体同时遮挡爆炸伤害（爆心→敌人视线被其截断则敌人豁免）。
// 抛射物不受阻挡弹道物体影响。
export type ObjectKind = 'barrel' | 'ruins' | 'rock'
export interface BattleObject {
  id: number
  kind: ObjectKind
  x: number // 格（矩形左上角）
  y: number
  w: number // 矩形占格
  h: number
  hp: number // -1 = 不可破坏
  maxHp: number
  blockMove: boolean
  blockProjectile: boolean
  /** 物体高度（仅 blockProjectile=true 有意义，默认 1）：
   *  高度 N 可阻挡物体后方 N 格内的单位受到导弹攻击 */
  height: number
}
export const BARREL_HP = 30
export const BARREL_BURN = { radius: 1.6, damage: 6, interval: 0.5, duration: 4 } // 燃烧区域
export const BARREL_POSITIONS: [number, number][] = [] // 战场暂为空地：默认无油桶

export interface ObjectBlock { x: number; y: number; w: number; h: number }
export const RUINS_HP = 150 // 废墟：有耐久，挡路挡弹道（高度 1），可被打掉/被敌人拆除
export const RUINS_BLOCKS: ObjectBlock[] = [] // 战场暂为空地：默认无废墟
export const ROCK_BLOCKS: ObjectBlock[] = [] // 岩石：hp=-1 不可破坏，挡路不挡弹道（默认无）

// ================= 固有建筑与核心（战场文档 §9） =================
export interface FixedBuilding {
  id: number
  name: string
  x: number
  y: number
  w: number
  h: number
  hp: number
  maxHp: number
  color: string
}
export const CORE = { x: 5, y: 25, w: 2, h: 2, hp: 500 } // 核心建筑：被毁即失败
export const FIXED_BUILDINGS: Omit<FixedBuilding, 'id' | 'hp' | 'maxHp'>[] = [
  { name: '弹药库', x: 1, y: 24, w: 2, h: 2, color: '#8C7A4A' },
  { name: '发电机组', x: 9, y: 24, w: 2, h: 2, color: '#6E8B8B' },
]
export const FIXED_BUILDING_HP = 320

// ================= 炮塔属性体系（炮塔文档 §4/§5） =================
export type WeaponType = 'direct' | 'lob' | 'missile' | 'beam' | 'spray'

export interface BlastEffect {
  damage: number // 爆炸直接伤害
  burn?: { damage: number; interval: number; duration: number } // 持续伤害
}

/** 炮塔美术资源配置（贴图渲染管线，规范 v1.1 §4；缺省 = 无美术资源，整体回退几何绘制）。
 * 坐标系：相对 anchor（轴心，默认 [0.5,0.5]），炮口朝上基准系中 x 向右为正、y 向上=沿炮口方向为正，单位格；素材炮口统一朝上绘制（渲染旋转量 = 炮口角度 + 90° 基准换算） */
/** 弹丸美术库（规范 v1.3 §3A）：统一库，炮塔经 art.projectile 引用条目 id；条目不可用 → 回退几何弹丸 */
export type ProjectileArtKind = 'bullet' | 'shell' | 'missile' | 'ray' // 实弹(直线)/抛射(曲线)/导弹/射线(点射)
export const PROJECTILE_KIND_NAME: Record<ProjectileArtKind, string> = {
  bullet: '实弹', shell: '抛射', missile: '导弹', ray: '射线',
}
export const PROJECTILE_KIND_COLOR: Record<ProjectileArtKind, string> = { // 程序化特效默认色（按类别）
  bullet: '#F5E9C8', shell: '#F0A03C', missile: '#D9762E', ray: '#9AD9C8',
}
export interface ProjectileArtDef {
  id: string
  name: string // debug 选择器显示名
  kind: ProjectileArtKind
  projectileAsset?: string // 本体贴图素材库条目 id（优先于 spriteSet/id 文件夹；'none' = 显式无贴图，几何回退）
  // 尾焰/爆炸/命中：轻量粒子系统参数（远行星号式实时生成，无需素材；旧 length/width/rings 字段废弃，兼容读取时忽略）
  trail?: { // 弹尾持续喷粒子（行为模板 + 参数可编辑；模板默认 < 用户显式参数）
    template?: 'standard' | 'inertia' | 'pulse' | 'smoke' // 标准拖尾/惯性甩尾/火焰脉冲/烟雾弥漫（默认 standard）
    color?: string // 默认=类别色（smoke 模板默认暗灰）
    colorEnd?: string // 颜色渐变：寿命内 color→colorEnd（缺省=仅亮度渐隐不变色）
    rate?: number; life?: number; size?: number // 粒/秒、秒、格
    inherit?: number // 惯性继承 0–1：初速=弹速×inherit+反向余速（0=原地消散、1=完全随弹）
    spread?: number // 散开度：发射方向随机锥角（弧度，默认 0.6）
    grow?: number // 尺寸变化率（>0 膨胀 <0 收缩，默认 0）
    fadeIn?: number // 淡入时长（秒，默认 0）
    smoke?: { rate?: number; life?: number; color?: string; duration?: number } // v2.20 长存留烟雾尾迹（与主尾焰并行存在的第二股粒子流；缺省 rate 20 粒/s、life 3s、color #9A958E；smoke32 非加法渲染；粒子前 40% 寿命膨胀扩散、之后尺寸冻结渐隐消失）；v2.23：duration=「持续」——点火后烟尾喷射窗口（秒），结束即停喷（已有烟团自然消散），超过引用炮塔 burnTime 按 burnTime 钳制；缺省=整个燃烧期
  }
  explosion?: { // 火花+烟尘粒子爆发 + 多层冲击环（尺寸/速度按爆炸半径；duration 为矢量底闪时长）
    color?: string; duration?: number; sparks?: number; smoke?: number
    speedJitter?: number // 火花初速随机幅度 0–1（默认 0.4：每粒速度 ×(1±jitter)，seeded 确定性）
    lifeJitter?: number // 火花寿命随机幅度 0–1（默认 0.3）
    turbulence?: number // 烟尘湍流强度 0–2（默认 0.6：漂移抖动幅度）
    rings?: number // 冲击环层数 1–4（默认 1）
    ringSpeed?: number // 环扩散速度系数（默认 1）
    ringWidth?: number // 环厚度 px（默认 2）
    bias?: number // 方向偏置 0–1（默认 0：火花向命中方向收束；1=完全锥形爆发）
    inherit?: number // 速度继承 0–1（默认 0：火花/烟尘初速叠加弹速×inherit）
    fireball?: number // v2.54 径向渐变火球尺寸系数 0–2（默认 1；0=关闭。白核→特效色→透明，加法混合，快膨胀缓衰减）
    shock?: number // v2.54 软边冲击波厚度系数 0–2（默认 1：环带羽化渐变；0=旧细描边环）
    flash?: number // v2.54 瞬时照明强度 0–1（默认 0.5：爆点周围大半径低透明光晕，0.15s 衰减；0=关闭）
    streak?: number // v2.54 火花拉丝 0|1（默认 1：沿速度方向拉亮线；0=圆点）
  }
  impact?: { color?: string; duration?: number; spikes?: number } // 碎屑飞溅粒子+中心亮点一闪
  // v2.8 光束表现（远行星号式分层贴图；仅 kind:'ray' 有意义，射线类炮塔引用本条目后生效；整套缺省 = 贴图默认搭配）
  beam?: {
    glowAsset?: string // 光晕层素材库条目 id（v2.11 beam 分类 /res/beam/），缺省 builtin:beam/beam_glowA；'none' = 程序化旧表现（纯色矩形）
    coreAsset?: string // 亮芯层素材库条目 id（v2.11 beam 分类 /res/beam/），缺省 builtin:beam/beam_coreA；'none' = 程序化旧表现
    impactAsset?: string // 命中点闪光素材库条目 id 或 /res/ 路径，缺省 /res/fx/glow16.png；'none' = 不显示
    muzzleAsset?: string // 炮口光球素材库条目 id 或 /res/ 路径，缺省 /res/fx/glow16.png；'none' = 不显示
    fringeColor?: string // 光晕层染色，缺省 #78C8DC（与旧程序化外圈一致）
    coreColor?: string // 亮芯层染色，缺省 #F0FAFF（与旧程序化内芯一致）
    flicker?: number // 亮度闪烁幅度 0~1，缺省 0.15（0 = 不闪烁）
    scrollSpeed?: number // 贴图沿光束方向滚动速度（美术 px/s，按 cell/30 缩放），缺省 96；0 = 静止
    muzzleScale?: number // v2.10 发射点闪光缩放（1 = 100%，缺省 1）
    impactScale?: number // v2.10 命中点闪光缩放（1 = 100%，缺省 1）
    absorb?: { rate?: number; color?: string; size?: number } // v2.10 吸收粒子（发射点能量吸收：环带向心汇聚；组在=生效；rate 缺省 12 粒/s、color 缺省=亮芯色、size 缺省 0.05 格）
    scatter?: { rate?: number; color?: string; size?: number; angle?: number } // v2.10 散发粒子（命中点飞溅；rate 缺省 24 粒/s、color 缺省=光晕色、size 缺省 0.05 格）；v2.15 angle=散发角度（以朝射线源方向为 0° 的全锥角：90°=左右各 45°，缺省 360=全向）；v2.15 起散射粒子带电焊式速度拖尾
    smoke?: { rate?: number; color?: string; size?: number } // v2.10 烟尘（命中点散发，smoke32 不加光；rate 缺省 6 粒/s、color 缺省 #3A3632、size 缺省 0.1 格）
  }
  spriteSet?: string // 遗留字段（UI 已移除）：素材文件夹名覆盖；解析链 = 库引用 → spriteSet ?? id → 通用集兜底
}
export const PROJECTILE_ARTS: ProjectileArtDef[] = [ // 可变注册表（与 TURRET_DEFS 同模式：内存编辑 + bump，不持久化）
  // v1.72：口令覆盖出厂配置——实弹挂 shell_s 贴图+命中；火箭挂 upload-1 贴图+惯性尾焰+爆炸；射线+命中
  { id: 'bullet_std', name: '标准实弹', kind: 'bullet', projectileAsset: 'builtin:library/shell_s', impact: {}, trail: { template: 'standard', life: 0.12, size: 0.045, inherit: 0.15, spread: 0.25 } }, // v1.83：尾焰参数修正——v1.75 值（life 0.05s=3帧 / size 0.02格≈0.6px）亚像素瞬逝不可见，且挤掉曳光回退线 → 调整为克制但可见的火花拖尾
  { id: 'shell_std', name: '标准榴弹', kind: 'shell' },
  { id: 'rocket_std', name: '标准火箭', kind: 'missile', projectileAsset: 'upload-1', trail: { template: 'inertia', smoke: {} }, explosion: {} }, // v2.45 口令(5)：+默认烟尾
  { id: 'ray_std', name: '标准射线弹', kind: 'ray', impact: {}, beam: { flicker: 0, scrollSpeed: 224, muzzleScale: 0.3, impactScale: 0.3, absorb: { rate: 26, size: 0.05 }, scatter: { rate: 34, size: 0.05, angle: 90 } } }, // v2.14 口令沉淀：无闪烁、高速滚动、闪光 0.3×、吸收 26/s + 散发 34/s；v2.19 口令(4)：散射 0.06→0.05 + 散发角度 90°（朝源±45°）
  { id: 'custom_ammo_1', name: '集束导弹', kind: 'missile', projectileAsset: 'builtin:library/missile2_s', trail: { template: 'inertia', color: '#ffae52', colorEnd: '#ffbb00', life: 0.2, inherit: 0, spread: 0.2, smoke: { duration: 1 } }, explosion: {} }, // v2.19 口令(4)沉淀：猎手塔挂载弹丸；v2.20 加长存留灰烟尾迹；v2.45 口令(5)：烟尾持续 1s
  { id: 'custom_ammo_2', name: '炮弹', kind: 'bullet', projectileAsset: 'builtin:library/shell_m', explosion: { smoke: 8, ringWidth: 3, rings: 2, ringSpeed: 2, sparks: 20, speedJitter: 0.6, inherit: 0.8 }, impact: { spikes: 10, color: '#ff9d4d' } }, // v2.45 口令(5)沉淀：自定义加农炮挂载弹丸
]

export interface TurretArt {
  anchor?: [number, number] // 旋转轴心：相对炮塔占格归一化坐标，默认 [0.5, 0.5]
  barrels?: { // 炮管挂点表：数量须与逻辑炮管数一致（不一致时渲染以挂点表为准）
    mount: [number, number] // 挂点（炮管根部）
    muzzle: [number, number] // 炮口点：弹丸出生点与火光定位点
    recoil?: number // 遗留逐管后坐（v1.58 起 UI 不再提供，由 art.recoil 统一；仅旧配置回退读取）
  }[]
  recoil?: number // v1.58 统一后坐行程（格）：所有炮管共用，默认 0.1；0 = 无后坐动画；优先于 barrels[].recoil 遗留逐管值
  // 火光表现 v1.45 起硬编码（2 帧 / 1.4×→1× / 每帧 0.1s，见 FLASH_* 常量），不再提供配置项
  glow?: { overheatOnly?: boolean } // 默认 true：仅过热时显示
  zBias?: number // 同层绘制次序微调，默认 0
  spriteSet?: string // 遗留字段（UI 已移除，不再提供选择）：素材文件夹名覆盖；解析链 = 库引用 → spriteSet ?? id → 通用集兜底
  // 分层素材库引用（每层独立，优先于 spriteSet/id 文件夹）：素材库条目 id；flashAsset='none' = 不播放开火效果
  baseAsset?: string
  turretAsset?: string
  barrelAsset?: string
  flashAsset?: string
  charge?: { offset: [number, number]; frames: number; asset?: string } // 充能动画（帧条：v2.3 起按帧数横向等分、从左到右顺序播一遍；offset 相对轴心 格，右+x 上+y；帧时长 = chargeTime/frames；asset v1.75：素材库引用（charge 分类），'none'=不播放，缺省=文件夹 charge.png 回退）
  projectile?: string // 弹丸美术库条目 id（§3A；喷射无弹丸不适用；射线类引用 ray 条目 = 光束分层表现+命中特效；条目不可用 → 回退几何弹丸/默认光束）
  rack?: { show?: boolean; dx?: number; dy?: number } // 导弹挂载显示（仅导弹塔）：show 默认 true；dx/dy=挂载点相对炮管挂点偏移(格)，默认 0/0.12
  // v2.8：光束表现组已从炮塔迁移至弹丸库 ray 条目（ProjectileArtDef.beam）；旧配置 art.beam 字段读取忽略
}

// ---------- v2.49 标签式索敌 ----------
/** 偏好标签键（软排序：各贡献权重因子连乘到基础分，越小越优先）。
 * 预留键（实体未上线，编辑器暂不开放）：'fortress'（敌方堡垒优先）/ 'wingman'（僚机优先）/ 'missile'（拦截导弹优先）/ 'spawned'（堡垒生产单位优先） */
export type PreferTagKey = 'nearFortress' | 'nearTurret' | 'hpMax' | 'hpMin' | 'sizeBig' | 'sizeSmall' | 'air' | 'ground'
  | 'fortress' | 'wingman' | 'missile' | 'spawned'
/** 约束标签键（硬过滤：命中即剔除出候选）。预留键同 prefer */
export type ExcludeTagKey = 'air' | 'ground' | 'wingman' | 'missile' | 'fortress' | 'spawned'
/** 资源标签键：弹药/电量/热量/防御（堡垒耐久），均为占上限百分比 0-100 */
export type ResourceTagKey = 'ammo' | 'energy' | 'heat' | 'defense'
/** 炮塔标签：prefer=软排序 / exclude=硬过滤 / resource=开火门控（条件成立时禁止开火）。
 * 规则：exclude + resource 全部 AND 通过才开火；prefer 之间非条件、是排序权重（连乘）。零标签 = 现状（近堡垒优先、空军×0.5） */
export type TurretTag =
  | { kind: 'prefer'; key: PreferTagKey }
  | { kind: 'exclude'; key: ExcludeTagKey }
  | { kind: 'resource'; res: ResourceTagKey; op: 'lt' | 'gt'; value: number } // res 百分比 <op> value 时禁止开火

export interface TurretDef {
  id: string
  name: string
  type: WeaponType
  /** 射线子模式（仅 type:'beam' 有意义，缺省视为 'beam'）：
   *  'beam' 光束——宽幅矩形持续 tick，持续发射期间炮塔锁定不转向；
   *  'pulse' 点射——无宽幅、即时单体命中、不可穿透，发射期间正常转向 */
  rayMode?: 'pulse' | 'beam'
  desc: string
  cost: number
  // §4.1 瞄准与射界
  rotateSpeed: number // 度/秒
  aimCone: number // 射角：以炮口方向为中心的总角度（度）；目标在 ±射角/2 内时免转炮直接瞄准
  rangeMin: number // m
  rangeMax: number // m
  canAir: boolean
  canGround: boolean
  // §4.2 伤害与弹道
  damage: number // 喷射类不使用（伤害由持续伤害表达）
  armorPen?: number // 对堡垒装甲的穿透比例 0~1：该比例直入结构
  armorDamage?: number // 每次命中削减受击面装甲；缺省 = damage×armorPen
  projectileSpeed?: number // m/s，直射/抛射
  guided?: boolean // 导弹：制导开关（v1.94 起与 guideDelay 组合成三模式：false=常规 / true=制导 / true+guideDelay>0=延迟制导）
  guideDelay?: number // 导弹·延迟制导（v1.94）：发射后沿炮塔方向直飞 N 秒才开启制导追踪（0.05~2；未配置=立即制导）
  guideDecel?: number // 导弹·延迟制导（v1.96）：延迟时间内的减速度 m/s²（≥0；仅延迟期生效，速度减到 0 为止；未配置/0 = 延迟期照常加速）
  missileFlightTime?: number // 导弹：飞行时间上限(秒)；耗尽未命中则逐渐消失（未配置 = 不限）
  missileCurve?: number // 导弹：飞行曲线系数 0–100（0/未配置 = 直线；越大蛇形摆幅越大，往复摆动非单边扭转）
  ejectAngle?: number // v2.20 出膛方向偏角（度）：延迟制导期内初始航向 = 炮塔方向 + 偏角（缺省 0）；配合 guideDelay 做侧抛/垂发
  burnTime?: number // v2.20 发动机燃烧时间（秒）：期内正常加速，燃尽后惯性滑行（不再加速、尾焰/喷口焰熄灭）；未配置 = 全程燃烧
  split?: { count: number; spread: number; at: 'proximity' | 'burnout'; range?: number } // v2.20 真集束分裂：母弹裂为 count 颗子弹（扇形 spread 度、伤害均分、不再分裂、继承制导/锁定/剩余飞行时间）；at:proximity=距目标 range 米触发（缺省 25）/ burnout=燃尽触发
  missileInitSpeed?: number // 导弹：初速度 m/s（v1.96，≥0；发射瞬间速度，缺省 0 = 从静止加速；可大于极速，超出后不再加速仅维持）
  missileAccel?: number // m/s²
  missileMaxSpeed?: number // m/s
  missileTurnMax?: number // 度/秒
  missileTurnAccel?: number // 度/秒²
  accuracy?: number // m，命中偏差半径
  pierce?: { count: number; decay: number } // 穿透数量 + 衰减幅度(0-1)
  blastRadius?: number // m
  blastEffect?: BlastEffect
  beamWidth?: number // m
  sprayAngle?: number // 度
  attackDuration?: number // s，射线/喷射单次持续
  dot?: { damage: number; interval: number } // 持续伤害
  // §4.3 射速与连发
  fireRate: number // 射速（s/轮）：每轮射击的间隔秒数，越小射得越快（v1.12 起语义反转，旧为 轮/s）
  burst?: number // 连发数
  burstInterval?: number // s
  barrels?: number // 炮管数（默认 1 = 单管）；多管时配合 barrelMode（持续型光束/喷射不适用）
  barrelMode?: 'salvo' | 'sequential' // 齐射(全部炮管同时)/轮流(逐管按连发间隔依次发射)；多管缺省 salvo
  art?: TurretArt // 美术资源配置（可选；缺省 = 几何回退，视觉与现状一致）
  reload?: number // s，射线/喷射攻击持续结束后的装填冷却
  // §4.4 热量（汇聚到堡垒热量池；堡垒过热则全炮塔停火）
  heatPerShot?: number // 点/发（累积到堡垒热量）
  chargeTime?: number // 充能时间（秒，Starsector chargeup）：每次开火周期起射前的前摇（未配置 = 无前摇，现状不变）
  // §4.5 资源消耗
  ammoPerShot?: number // 发数/发
  ammoPerSec?: number // 喷射消耗（弹药/s）
  energyPerShot?: number // 发射电量
  energyPerSec?: number // 维持电量
  gpu: number
  // §4.6 占格与生存（v2.22：人员/最少人员参数已删除——炮塔不再需要人员运转）
  mount: MountSize // 炮位尺寸分级（移动堡垒：只能挂到匹配尺寸的炮位）
  w: number // 占格 长
  h: number // 占格 宽
  hp: number // 耐久
  onDestroyBlast?: BlastEffect & { radius: number } // 毁坏效果（如爆炸）
  color: string
  tags?: TurretTag[] // v2.49 标签式索敌（未配置 = 现状：近堡垒优先、空军×0.5、无资源门控）
}

export const TURRET_DEFS: TurretDef[] = [
  {
    // v1.72：口令覆盖出厂配置——双管轮流（DualGun_S1 炮身 + DualGun-_S2 炮管），6 连发不产热，弹速 400，无穿透
    id: 'mg', name: '哨戒机枪', type: 'direct', desc: '实弹直射 · 穿透2/衰减30% · 3连发',
    cost: 80, rotateSpeed: 240, aimCone: 12, rangeMin: 25, rangeMax: 150, canAir: false, canGround: true,
    damage: 5, projectileSpeed: 400, accuracy: 12, pierce: { count: 0, decay: 0.3 }, // v2.45 口令(5)：damage 12→5 / accuracy 1.5→12
    fireRate: 2, burst: 6, burstInterval: 0.1, heatPerShot: 0, // v2.45 口令(5)：fireRate 1→2
    ammoPerShot: 1, gpu: 2, mount: 'S', w: 1, h: 1, hp: 300, color: '#8C94A0',
    barrels: 2, barrelMode: 'sequential',
    art: {
      recoil: 0.08, // v1.58 统一后坐（全管共用，优先于逐管遗留值）
      barrels: [ // v1.75 挂点 (-0.1,0.25)/(0.1,0.25)；v1.77 炮口修正：对准炮管尖（挂点 + 管高12px/30=0.4格）
        { mount: [-0.1, 0.25], muzzle: [-0.1, 0.65] },
        { mount: [0.1, 0.25], muzzle: [0.1, 0.65], recoil: 0.1 }, // 口令原样保留的遗留逐管后坐（被统一值 0.08 覆盖）
      ],
      baseAsset: 'none', turretAsset: 'builtin:library/dualgun_s1', barrelAsset: 'builtin:library/dualgun_s2',
      flashAsset: 'builtin:library/fx_fire_s', // v1.77：接线内置开火效果（此前仅注册未引用 → 无炮口火光）
      projectile: 'bullet_std', zBias: -1,
    },
  },
  {
    id: 'lob', name: '榴弹抛射炮', type: 'lob', desc: '抛物线 · 爆炸20m · 命中燃烧',
    cost: 150, rotateSpeed: 90, aimCone: 10, rangeMin: 75, rangeMax: 275, canAir: false, canGround: true,
    damage: 30, projectileSpeed: 90, accuracy: 3, blastRadius: 20,
    blastEffect: { damage: 0, burn: { damage: 5, interval: 0.5, duration: 3 } },
    fireRate: 2, burst: 1, burstInterval: 0, heatPerShot: 12,
    ammoPerShot: 2, gpu: 3, mount: 'M', w: 1, h: 2, hp: 420, color: '#9C7B54',
  },
  {
    id: 'cruise', name: '巡航导弹井', type: 'missile', desc: '非制导 · 锁定落点 · 爆炸25m',
    cost: 220, rotateSpeed: 120, aimCone: 16, rangeMin: 100, rangeMax: 400, canAir: false, canGround: true, // v2.45 口令(5)：rangeMax 300→400
    damage: 45, guided: false, missileAccel: 40, missileMaxSpeed: 120,
    missileTurnMax: 90, missileTurnAccel: 180, accuracy: 4, blastRadius: 25,
    blastEffect: { damage: 0 },
    fireRate: 2.5, burst: 1, burstInterval: 0, heatPerShot: 20,
    ammoPerShot: 4, gpu: 4, mount: 'L', w: 2, h: 2, hp: 520, color: '#A05C48',
  },
  {
    id: 'hunter', name: '猎手制导导弹', type: 'missile', desc: '制导追踪 · 可对空 · 受角速度约束',
    cost: 10, rotateSpeed: 0, aimCone: 360, rangeMin: 0, rangeMax: 500, canAir: true, canGround: true,
    damage: 34, guided: true, guideDelay: 0.5, guideDecel: 15, missileInitSpeed: 20, missileAccel: 80, missileMaxSpeed: 320, burnTime: 5, // v2.45 口令(5)：guideDelay 0.8→0.5 / guideDecel 10→15
    missileTurnMax: 90, missileTurnAccel: 1440, blastRadius: 18,
    blastEffect: { damage: 0 },
    missileFlightTime: 10,
    fireRate: 6, burst: 8, burstInterval: 0.4, barrels: 4, barrelMode: 'sequential', heatPerShot: 2,
    ammoPerShot: 3, gpu: 5, mount: 'S', w: 1, h: 1, hp: 500, color: '#7E6E9C',
    art: { // v2.19 口令(4)沉淀：MissileLauncher2_S 炮身 + 集束导弹 + 4 管炮口前移 + 隐藏挂架
      anchor: [0.5, 0.5], baseAsset: 'none', recoil: 0,
      barrels: [ // v2.45 口令(5)：4 管挂点下移 + 炮口统一右侧 (0.5,0)
        { mount: [-0.3, 0.3], muzzle: [0.5, 0] },
        { mount: [-0.2, 0.35], muzzle: [0.5, 0] },
        { mount: [0.2, 0.35], muzzle: [0.5, 0] },
        { mount: [0.3, 0.35], muzzle: [0.5, 0] },
      ],
      turretAsset: 'builtin:library/missilelauncher2_s', barrelAsset: 'none', projectile: 'custom_ammo_1', rack: { show: false }, flashAsset: 'none',
    },
    missileCurve: 10, // v2.19 口令(4)：导弹弹道弯曲度；v2.45 口令(5)：20→10
  },
  {
    id: 'beam', name: '磁轨光束塔', type: 'beam', rayMode: 'beam', desc: '矩形波束 · 持续伤害 · 发射时锁定不转向 · 耗电',
    cost: 20, rotateSpeed: 100, aimCone: 5, rangeMin: 0, rangeMax: 250, canAir: true, canGround: true, // v2.45 口令(5)：rotateSpeed 90→100
    damage: 0, beamWidth: 10, attackDuration: 3, dot: { damage: 15, interval: 0.5 },
    fireRate: 4.545, reload: 0.5, energyPerShot: 15, energyPerSec: 5,
    gpu: 6, mount: 'M', w: 1, h: 2, hp: 450, color: '#5C7E8C', // v2.14：口令沉淀为出厂默认（M=1×2；含美术分层 + 充能 3s）
    art: { // v2.14 口令沉淀：Laser_M 炮身 + charge_Laser_M 充能（5 帧）+ 引用 ray_std 光束表现；底座/炮管/火光「无」
      anchor: [0.5, 0.5], baseAsset: 'none', recoil: 0,
      barrels: [{ mount: [0, 0], muzzle: [0, 0.7] }],
      turretAsset: 'builtin:library/laser_m', barrelAsset: 'none', projectile: 'ray_std', flashAsset: 'none',
      charge: { offset: [0, 0.2], frames: 6, asset: 'builtin:library/charge_laser_m' }, // v2.19 口令(4)：偏移 [0,0.2] + 6 帧
    },
    chargeTime: 2, // v2.19 口令(4)：3→2
  },
  {
    id: 'pulse', name: '脉冲射线塔', type: 'beam', rayMode: 'pulse', desc: '脉冲点射 · 单体即中 · 不穿透 · 耗电按发',
    cost: 160, rotateSpeed: 200, aimCone: 10, rangeMin: 0, rangeMax: 225, canAir: true, canGround: true,
    damage: 26, // 单发伤害高于光束 tick 秒伤折算（光束 10/0.5s）
    fireRate: 1.25, burst: 1, burstInterval: 0, heatPerShot: 9,
    energyPerShot: 6, // 耗电按发计，无维持电量
    gpu: 5, mount: 'M', w: 1, h: 2, hp: 380, color: '#6E9CA8', // v1.76：占格随型号 M=1×2
  },
  {
    id: 'spray', name: '烈焰喷射塔', type: 'spray', desc: '60°扇形 · 持续灼烧 · 耗弹药',
    cost: 120, rotateSpeed: 200, aimCone: 12, rangeMin: 0, rangeMax: 75, canAir: false, canGround: true,
    damage: 0, sprayAngle: 60, attackDuration: 2.5, dot: { damage: 8, interval: 0.5 },
    fireRate: 4, reload: 1.5, heatPerShot: 0, ammoPerSec: 5,
    gpu: 2, mount: 'S', w: 1, h: 1, hp: 350, color: '#A07840',
  },
  { // v2.45 口令(5)沉淀：自定义加农炮（MidCannon 炮身/炮管 + 炮弹 custom_ammo_2）
    id: 'custom-1787149972481-1', name: '加农炮', type: 'direct', desc: '自定义 · 直射',
    cost: 80, rotateSpeed: 90, aimCone: 5, rangeMin: 25, rangeMax: 300, canAir: false, canGround: true,
    damage: 50, projectileSpeed: 400, accuracy: 3, pierce: { count: 0, decay: 0.3 },
    fireRate: 2.5, burst: 1, burstInterval: 0.1, heatPerShot: 1,
    ammoPerShot: 1, gpu: 2, mount: 'M', w: 1, h: 2, hp: 300, color: '#8C94A0',
    barrels: 1, barrelMode: 'salvo',
    art: {
      recoil: 0.2,
      barrels: [{ mount: [0, 0.5], muzzle: [0, 1.2] }],
      baseAsset: 'none', turretAsset: 'builtin:library/midcannon_m1', barrelAsset: 'builtin:library/midcannon_m2',
      flashAsset: 'builtin:library/fx_fire_s', projectile: 'custom_ammo_2', zBias: -1,
    },
  },
  { // v2.45 口令(5)沉淀：大型双联加农炮（DualCannon_L1 炮身 + TwinCannon_L2 炮管 + 炮弹 custom_ammo_2）
    id: 'custom-1787150582922-2', name: '大型双联加农炮', type: 'direct', desc: '自定义 · 直射',
    cost: 80, rotateSpeed: 90, aimCone: 8, rangeMin: 25, rangeMax: 300, canAir: false, canGround: true,
    damage: 60, projectileSpeed: 400, accuracy: 5, pierce: { count: 1, decay: 0.3 },
    fireRate: 2, burst: 2, burstInterval: 0.25, heatPerShot: 0,
    ammoPerShot: 2, gpu: 2, mount: 'L', w: 2, h: 2, hp: 300, color: '#8C94A0',
    barrels: 2, barrelMode: 'salvo',
    art: {
      recoil: 0.4,
      barrels: [
        { mount: [-0.26, 1], muzzle: [-0.26, 1.8] },
        { mount: [0.26, 1], muzzle: [0.26, 1.8] },
      ],
      baseAsset: 'none', turretAsset: 'builtin:library/dualcannon_l1', barrelAsset: 'builtin:library/twincannon_l2',
      flashAsset: 'builtin:library/fx_fire_s', projectile: 'custom_ammo_2', zBias: -1,
    },
  },
]

export const MAX_LEVEL = 3
export function upgradeCost(def: TurretDef, level: number): number {
  return Math.round(def.cost * 0.9 * level)
}
export function levelScale(level: number): number {
  return 1 + 0.35 * (level - 1) // 伤害/持续伤害倍率
}

// ================= 敌人（战场文档 §6 目标优先级） =================
export type EnemyKind = 'walker' | 'rusher' | 'brute' | 'flyer' | 'runner'
export type EnemyPriority = 'default' | 'core-rush'
export interface EnemyDef {
  kind: EnemyKind
  name: string
  hp: number
  speed: number // 格/秒
  dps: number // 对建筑/墙/核心
  bounty: number
  air: boolean
  priority: EnemyPriority
  armor: number // 受击减伤 0-1
  color: string
  size: number // 碰撞半径（格）
  attackRange: number // 远程直线实弹射程（格）
  attackInterval: number // 射击间隔（秒）
  projectileSpeed: number // 敌方实弹速度（米/秒）
  projectileDamage: number // 单发伤害
  penetration: number // 穿深；低于受击面装甲时按 穿深/装甲 概率穿透，否则跳弹
}
export const ENEMY_DEFS: Record<EnemyKind, EnemyDef> = {
  walker: { kind: 'walker', name: '行尸', hp: 60, speed: 0.95, dps: 10, bounty: 15, air: false, priority: 'default', armor: 0, color: '#6F7D5C', size: 0.32, attackRange: 8, attackInterval: 1.5, projectileSpeed: 100, projectileDamage: 10, penetration: 3 },
  rusher: { kind: 'rusher', name: '冲核尸', hp: 45, speed: 1.5, dps: 12, bounty: 20, air: false, priority: 'core-rush', armor: 0, color: '#A9A06A', size: 0.3, attackRange: 7, attackInterval: 1.1, projectileSpeed: 115, projectileDamage: 12, penetration: 2.5 },
  brute: { kind: 'brute', name: '重甲尸', hp: 230, speed: 0.55, dps: 18, bounty: 40, air: false, priority: 'default', armor: 0.25, color: '#555B63', size: 0.4, attackRange: 9, attackInterval: 2.2, projectileSpeed: 85, projectileDamage: 18, penetration: 6 },
  flyer: { kind: 'flyer', name: '飞蝗', hp: 34, speed: 1.9, dps: 6, bounty: 18, air: true, priority: 'core-rush', armor: 0, color: '#7E8C5A', size: 0.3, attackRange: 10, attackInterval: 0.9, projectileSpeed: 140, projectileDamage: 6, penetration: 2 },
  runner: { kind: 'runner', name: '疾行尸', hp: 36, speed: 1.7, dps: 8, bounty: 12, air: false, priority: 'default', armor: 0, color: '#8A7F6E', size: 0.3, attackRange: 7.5, attackInterval: 1.2, projectileSpeed: 125, projectileDamage: 8, penetration: 3 },
}

// 敌人 → 丧尸精灵图组（public/res/zombies/{group}_{dir}.png）
export const ENEMY_SPRITE: Record<EnemyKind, string> = {
  walker: 'g2_normal',
  rusher: 'g1_skinny',
  brute: 'g3_burly',
  runner: 'g4_clothed',
  flyer: 'g5_rotten',
}

// ================= 波次 =================
export interface SpawnItem { kind: EnemyKind; delay: number }
export function buildWave(wave: number): SpawnItem[] {
  const list: SpawnItem[] = []
  const push = (kind: EnemyKind, n: number, gap: number) => {
    for (let i = 0; i < n; i++) list.push({ kind, delay: gap })
  }
  switch (wave) {
    case 1: push('walker', 6, 1.4); break
    case 2: push('walker', 9, 1.1); push('runner', 2, 1.0); push('rusher', 2, 1.0); break
    case 3: push('walker', 8, 0.9); push('runner', 3, 0.9); push('rusher', 4, 0.9); break
    case 4: push('walker', 8, 0.8); push('runner', 4, 0.8); push('brute', 2, 2.0); push('rusher', 4, 0.8); break
    case 5: push('walker', 8, 0.7); push('runner', 5, 0.7); push('flyer', 3, 1.6); push('brute', 3, 1.8); push('rusher', 4, 0.7); break
    default: push('walker', 10, 0.6); push('runner', 6, 0.6); push('brute', 4, 1.5); push('rusher', 6, 0.6); push('flyer', 3, 1.4); break
  }
  return list
}
export function waveHpScale(wave: number): number {
  return Math.pow(1.12, wave - 1)
}

// ================= 要塞内部模块（背包式摆放，可旋转；无耐久不可摧毁，仅可拆除） =================

/** @deprecated 已并入 FortressDef.interior（内部模块空间与底座 1:1 对齐，不得超出底座 w×h） */
export const FORTRESS_INTERIOR = { cols: 5, rows: 8 }

export interface ModuleDef {
  id: string
  name: string
  desc: string
  cost: number // 金币
  w: number // 内部空间占格 长（放置时可旋转 90°）
  h: number // 内部空间占格 宽
  maxCount?: number // 同一定义模块的装配数量上限（正整数；缺省=不限）
  energyRegen?: number // 发电：电力回复 +点/s
  energyCap?: number // 储电上限 +
  ammoRegen?: number // 兵工厂：弹药回复 +发/s
  ammoCap?: number // 弹药储存上限 +
  cooling?: number // 散热器：散热功率（点/s），全额叠加到堡垒散热速率（不摊薄）
  hpBoost?: number // 船体血量上限加成
  speedBoost?: number // 移动速度加成（格/s，可为负）
  turnBoost?: number // 转向速度加成（度/s，可为负）
  repair?: number // 维修站：修复功率池（hp/s），均摊到每座受损炮塔
  rangeBoost?: number // 火控雷达：射程增益池（比例，如 0.5 = 50%），均摊到每座炮塔
  shieldGenerator?: boolean // 护盾发生器标记；存在时才启用全部护盾加成
  shieldMax?: number // 护盾容量加成（发生器自带基础容量，增效模块可继续叠加）
  shieldRegen?: number // 护盾回复 +点/s
  shieldEnergyPerPoint?: number // 发生器每回复 1 点护盾消耗的电量
  produce?: { kind: AllyKind; interval: number; cap: number } // 生产类：周期产出友军单位，cap = 本模块同时存活上限
  color: string
  asset?: string // v2.30：贴图素材（素材库「模块」分类锚定；缺省=色块+名称回退）
  shape?: string[] // v2.31：异型占格铺格（"x,y" 未旋转局部格，限 w×h 包围盒内；缺省= w×h 全满矩形；L/T 型等用）
}

// ================= 友军单位（生产模块产出；当前版本作为机动防御猎杀丧尸，对战模式再改为出征进攻） =================

export type AllyKind = 'soldier' | 'tank' | 'plane'

export interface AllyDef {
  name: string
  hp: number
  speed: number // 格/s
  damage: number // 每次攻击伤害
  interval: number // 攻击间隔 s
  range: number // 射程 m
  canAir: boolean // 可攻击空中敌人
  canGround: boolean // 可攻击地面敌人
  air: boolean // 飞行单位（地面敌人无法攻击它；v1 无碰撞直线移动）
  color: string
  size: number // 渲染半径（格）
}

export const ALLY_DEFS: Record<AllyKind, AllyDef> = {
  soldier: { name: '士兵', hp: 120, speed: 1.2, damage: 8, interval: 0.8, range: 12, canAir: true, canGround: true, air: false, color: '#7A8C5A', size: 0.18 },
  tank: { name: '坦克', hp: 600, speed: 0.7, damage: 45, interval: 2, range: 75, canAir: false, canGround: true, air: false, color: '#6E7A68', size: 0.35 },
  plane: { name: '战斗机', hp: 220, speed: 2.2, damage: 25, interval: 1, range: 60, canAir: true, canGround: true, air: true, color: '#7E8E9C', size: 0.3 },
}

/** 独立于可变模块注册表的迁移源；旧存档覆盖 MODULE_DEFS 时仍可安全补入。 */
export const SHIELD_MODULE_DEFS: readonly ModuleDef[] = [
  { id: 'shield_generator', name: '护盾发生器', desc: '护盾上限 300 · 回复 12/s · 回复每点耗电 0.35', cost: 220, w: 2, h: 2, maxCount: 1, shieldGenerator: true, shieldMax: 300, shieldRegen: 12, shieldEnergyPerPoint: 0.35, color: '#5E8E9C' },
  { id: 'shield_capacitor', name: '护盾电容', desc: '护盾上限 +160（需护盾发生器）', cost: 120, w: 1, h: 2, shieldMax: 160, color: '#667E9A' },
  { id: 'shield_amplifier', name: '护盾增效器', desc: '护盾回复 +6/s（需护盾发生器）', cost: 110, w: 1, h: 1, shieldRegen: 6, color: '#5A9A91' },
]

export const MODULE_DEFS: ModuleDef[] = [
  { id: 'generator', name: '发电模块', desc: '电力回复 +4/s · 储电上限 +15', cost: 120, w: 2, h: 2, energyRegen: 4, energyCap: 15, color: '#C8A83C' },
  { id: 'battery', name: '电池模块', desc: '储电上限 +50', cost: 90, w: 1, h: 2, energyCap: 50, color: '#7E9A4E' },
  { id: 'ammo_factory', name: '兵工厂', desc: '弹药回复 +2/s · 弹药上限 +20', cost: 150, w: 2, h: 2, ammoRegen: 2, ammoCap: 20, color: '#A0693A' }, // v2.45 口令(5)：h 3→2
  { id: 'ammo_depot', name: '弹药库', desc: '弹药上限 +60', cost: 100, w: 2, h: 1, ammoCap: 60, color: '#8C7A52' }, // v2.45 口令(5)：h 2→1
  { id: 'radiator', name: '散热器', desc: '堡垒散热 +8 点/s（可叠加，不摊薄）', cost: 110, w: 1, h: 1, cooling: 8, color: '#6E8E9C' }, // v2.45 口令(5)：h 2→1
  { id: 'armor_plate', name: '复合装甲', desc: '船体血量上限 +800，移动速度 -0.15 格/s', cost: 140, w: 1, h: 1, hpBoost: 800, speedBoost: -0.15, color: '#7A7E72' }, // v2.45 口令(5)：w 2→1
  { id: 'engine_boost', name: '推进引擎', desc: '移动速度 +0.35 格/s', cost: 150, w: 1, h: 2, speedBoost: 0.35, color: '#8E7A5E' },
  { id: 'gyro', name: '陀螺稳定器', desc: '转向速度 +50 度/s', cost: 120, w: 1, h: 1, turnBoost: 50, color: '#6E7E8A' },
  { id: 'repair', name: '维修站', desc: '修复结构、四向装甲与炮塔 8 点/s（受损项共享）', cost: 130, w: 2, h: 2, repair: 8, color: '#9C8A6E' },
  ...SHIELD_MODULE_DEFS.map(d => ({ ...d })),
  { id: 'radar', name: '火控雷达', desc: '全部炮塔射程 +50%（炮塔越多越摊薄）', cost: 140, w: 1, h: 2, rangeBoost: 0.5, color: '#5E7E8E' },
  { id: 'barracks', name: '机器人模块', desc: '每 8s 产出 1 名士兵（同时存活 ≤6）', cost: 160, w: 3, h: 2, produce: { kind: 'soldier', interval: 8, cap: 6 }, color: '#8A7E5E' }, // v2.45 口令(5)：改名（原 兵营）
  { id: 'tank_factory', name: '坦克制造模块', desc: '每 15s 产出 1 辆坦克（同时存活 ≤3）', cost: 260, w: 3, h: 3, produce: { kind: 'tank', interval: 15, cap: 3 }, color: '#6A7462' }, // v2.45 口令(5)：改名（原 坦克制造厂）
  { id: 'airfield', name: '无人机模块', desc: '每 20s 产出 1 架战斗机（同时存活 ≤2）', cost: 300, w: 3, h: 3, produce: { kind: 'plane', interval: 20, cap: 2 }, color: '#5E6E7E' }, // v2.45 口令(5)：改名（原 机场）
]
