// 废土防线 · 静态配置
// 数值体系严格对应《战场空间设计文档》与《炮塔系统属性文档 v1.1》。

import type { RotorDef, UnitAI, UnitBossExtension, UnitCombatStats, UnitTargetKind } from './unit'

// ================= 全局换算 =================
/** 1 单元格 = 3.2 m（全局空间换算；编辑器、战斗与预览必须共用） */
export const M_PER_CELL = 3.2
export const m2c = (m: number) => m / M_PER_CELL
export const c2m = (c: number) => c * M_PER_CELL

// ================= 战场几何（逻辑坐标，Y=0 在顶部） =================
export const COLS = 42 // 战场宽 134.4m（横版：横向卷动 + 缩放，镜头跟随）；v2.45 口令(5)：36→42
export const ROWS = 72 // 战场纵深 230.4m（v1.75：默认 18 → 72；旧存档保留原值）
export const VIEW_COLS = 20 // 视口宽 64m（横版基准；滚轮/捏合缩放改变实际可见范围）
export const VIEW_ROWS = 12 // 视口高 38.4m
// 基准格像素：全设备/横竖屏统一 32px=1单元格=3.2m，不再按容器适配；
// 堡垒/炮塔/敌兵贴图与战场网格的比例在任何设备、任何朝向完全一致；竖版视口 = 12×20（宽高对调）
export const BASE_CELL = 32
export const SPAWN_ROWS = 1 // 出生带：仅最顶层行 0，不可建造
export const WALL_ROW = 18 // 防御墙所在行（基地围合墙顶边），同属可建造区：墙拆除后该格可建炮塔/重建墙
export const BASE_TOP = 19 // 基地区起始行
export const BASE_BOTTOM = 26 // 建造区结束行（含）
// 行 27 与列 0 / 列 11（基地区段）为模板外轮廓墙，围合基地区

// ================= 移动堡垒（玩家基地；船体血量取代墙圈/核心） =================

/** 炮塔/炮位槽位尺寸；只决定挂载兼容性，不再决定占格。 */
export type MountSize = 'S' | 'M' | 'L'

/** 单位摧毁视觉模板；只控制表现，不改变爆炸伤害或任务结算。 */
export type UnitDestructionEffect = 'small' | 'medium' | 'large' | 'violent'

/** 旧单位未保存摧毁模板时按主体尺寸补出稳定默认值。 */
export function resolveUnitDestructionEffect(
  configured: UnitDestructionEffect | undefined,
  width: number,
  height: number,
): UnitDestructionEffect {
  if (configured) return configured
  const size = Math.max(width, height)
  return size <= 1.25 ? 'small' : size <= 2.5 ? 'medium' : size <= 5 ? 'large' : 'violent'
}

/** 炮位：堡垒局部坐标（格，锚点中心，可为小数）；hideTurretArt=只隐藏该位置炮塔的美术，战斗与装配照常；builtIn=预装炮塔；lockedTurret=锁定预装型号、禁止拆换
 *  arc = 指定视角（度，相对船头 0=上 顺时针，支持跨 0°，如 {start:315,end:45}）；未配置 = 全向
 *  fixed = 固定视角（v1.98，度，-180~180，上方 0° 逆时针为负 顺时针为正）：炮口恒定朝此角不追踪；与 arc 互斥（fixed 优先） */
export interface Hardpoint { id: string; x: number; y: number; size: MountSize; arc?: { start: number; end: number }; fixed?: number; types?: WeaponType[]; hideTurretArt?: boolean; /** @deprecated 旧“隐藏炮位”，读取时迁移为 hideTurretArt */ hidden?: boolean; builtIn?: string; /** 仅在存在预装炮塔时生效；锁定后战斗整备不能卸下或更换该炮塔。 */ lockedTurret?: boolean; zLevel?: number } // size = S/M/L 挂载尺寸，不再表示占格；types = 允许挂载的炮塔类型（未配置 = 不限）；zLevel = 渲染层级（默认 1，越大越高；<=-1 时在载具素材下方）

/** 炮位层级 <= -1 时，炮塔先于载具主体绘制并由载具素材自然遮挡。 */
export function hardpointBelowVehicleBody(hardpoint?: Pick<Hardpoint, 'zLevel'>): boolean {
  return (hardpoint?.zLevel ?? 1) <= -1
}

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
/** v2.40 渲染层级：ground = 地面层（地形之上/载具及行走部件之下）；air = 空中层（最上，现状口径） */
export type FortressEffectLayer = 'ground' | 'air'
export const EFFECT_LAYER_NAME: Record<FortressEffectLayer, string> = { ground: '地面（载具下）', air: '空中（最上）' }
export interface FortressEffectPoint {
  id: string; x: number; y: number // x/y = 堡垒局部坐标（格，可为小数）
  kind: FortressEffectKind; state: FortressEffectState
  layer?: FortressEffectLayer // 渲染层级（缺省：dust=ground，其余=air）
  rate?: number // 发射速率 粒/s（缺省按 kind）
  size?: number // 粒子尺寸 格（缺省按 kind）
  life?: number // 粒子寿命 秒（缺省按 kind）
  inherit?: number // 堡垒速度继承 0~1（缺省：dust=0.3，其余=0）
}

/** 履带定义（v1.85 瓦片循环动画；v1.86 调整）：以单位实际占格的几何中心为原点，+x 向右、+y 向车头；
 * 瓦片沿「前轮心→后轮心」直线段排布，
 * 两端轮半径 R 区间为透视缩短翻滚区（瓦片高度 × cosθ + 渐暗，模拟俯视立体滚动，翻到底面消失）；
 * 滚动相位由引擎按真实位移驱动（倒退反滚），弧线转向左右履带差速（外侧快内侧慢）。仅视觉。
 * v1.86：只需定义【左侧】履带——右侧按堡垒中心线自动镜像（相位独立，差速对称）；
 * 瓦片原图直绘（不旋转）：图宽 = 履带宽度方向、图高 = 板长方向。
 * v1.87：瓦片尺寸一律取素材原图（宽=图宽、板长=图高），不再配置 width/tileLen；重叠改用 pix 单位。 */
export interface TrackDef {
  id: string
  x1: number; y1: number // 前轮心（单位几何原点坐标，+y 朝车头）
  x2: number; y2: number // 后轮心
  radius: number // 轮半径（格）= 头尾翻滚区长度
  tile: string // 瓦片素材（素材库引用 id / /sprites 路径 / dataURL）
  overlapPx: number // 拼接重叠（pix，贴图像素）：有效步长 = 图高 − overlapPx
}
/** v2.51 轮子（轮式底盘美术/落印单元；与履带 tracks 独立共存——半履带 = 前 wheels + 后 tracks） */
export interface WheelDef {
  id: string
  x: number; y: number // 轮心（单位几何原点坐标，+x 向右、+y 朝车头）
  unit?: 'single' | 'pair' // 单个 / 一对；pair 取 |x| 为左右间距，围绕 x=0 几何中心线镜像
  r?: number // 遗留轮径字段（v2.73 起忽略，仅为旧存档兼容）
  sprite?: string // 轮胎素材库引用 id（兼容遗留 /res 路径 / dataURL；缺省 = 几何轮胎）
  frames?: number // 横向等宽帧条帧数（1~64；缺省 1，内置吉普轮胎旧配置迁移为 4）
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

export interface FortressBodyCollisionPoint {
  /** 相对单位几何中心的横向坐标（格，向右为正）。 */
  x: number
  /** 相对单位几何中心的纵向坐标（格，向下为正）。 */
  y: number
}

/**
 * 由主体贴图透明通道生成的简化物理轮廓。
 * points 为顺/逆时针凸多边形；source/像素尺寸用于判断贴图替换后是否需要重建。
 */
export interface FortressBodyCollision {
  source: string
  widthPx: number
  heightPx: number
  points: FortressBodyCollisionPoint[]
}

export interface FortressDef {
  id: string
  /** 作为统一单位模板使用时保留原 UnitDef 稳定 ID；普通玩家堡垒缺省仍使用 fortress:<id>。 */
  unitId?: string
  /** 单位编辑器主动把非载具单位转换为载具时写入；用于区别同 ID 的历史错误载具快照。 */
  explicitUnitTypeOverride?: boolean
  /** 共用载具平台所承载的单位类型；缺省为地面载具。飞行器仍复用本定义的外观、碰撞、炮位和特效点。 */
  platformType?: 'vehicle' | 'rotorcraft' | 'fixedWingAircraft'
  /** 【旋翼飞行器】可分别位于载具主体上方或下方的动态旋翼层。 */
  rotors?: RotorDef[]
  /** 【飞行器】初始、最低、最高飞行高度及升降速度（格）。 */
  altitude?: number
  minAltitude?: number
  maxAltitude?: number
  climbRate?: number
  /** 【固定翼】最低航速与最小转弯半径（格）。 */
  minFlightSpeed?: number
  flightTurnRadius?: number
  /** 载具的单位层元数据也由本定义保存，避免单位库再保留一份会过期的完整载具快照。 */
  unitTargetClasses?: UnitTargetKind[]
  unitCombat?: UnitCombatStats
  unitAI?: UnitAI
  unitBoss?: UnitBossExtension
  /** 作为敌对单位被击毁时发放的资源；缺省按载具统一默认值 40。 */
  unitReward?: number
  /** 锁定单位平移和主体转向；炮塔仍可独立索敌、旋转和开火。 */
  bodyLocked?: boolean
  name: string
  /** 空值继承单位类型全局声音；'none' 静音；其他值引用声音预设。 */
  sounds?: { movement?: string }
  w: number // 主体贴图外接包围盒宽（格）；无主体轮廓的旧定义继续作为碰撞回退
  h: number // 主体贴图外接包围盒高（格）
  /** 旧自由网格碰撞定义，仅供没有 bodyCollision 的历史载具兼容。 */
  shape?: string[]
  /** @deprecated 旧底座素材字段，仅为读取历史数据保留；加载后会移除且不再渲染。 */
  spriteBase?: string
  spriteBody?: string // 载具素材库引用 id（兼容遗留“堡垒主体”引用、dataURL 与 /res 路径）
  /** 被摧毁时使用的统一视觉模板；旧数据缺省时按主体尺寸自动选择。 */
  destructionEffect?: UnitDestructionEffect
  /** 【步行机甲】单脚完成 7 帧动作时前进的距离（格，缺省 1）；动画按实际位移推进。 */
  walkerStride?: number
  /** @deprecated 旧步态单帧持续时间；载入时按当时极速迁移为 walkerStride。 */
  walkerFrameDuration?: number
  /** 【步行机甲】主体素材中心相对单位几何原点的像素修正；X 向右、Y 向下。 */
  walkerBodyOffsetX?: number
  walkerBodyOffsetY?: number
  /** @deprecated 旧下半身素材；载入时提升为 spriteBody 后删除。 */
  walkerLowerAsset?: string
  /** @deprecated 旧腿部坐标；载入时迁移为 walkerBodyOffsetX/Y。 */
  walkerLowerOffsetX?: number
  walkerLowerOffsetY?: number
  /** 主体透明边缘生成的持久化物理轮廓；缺省时兼容回退到 shape / w×h。 */
  bodyCollision?: FortressBodyCollision
  paint?: { base: string; accent?: string; turret?: string } // 主体乘法染色 + 预留强调色 + 挂载炮塔统一乘法染色；不影响履带和轮胎
  decals?: FortressDecal[] // 徽记/编号等装饰图，按堡垒局部锚点绘制
  interior: { cols: number; rows: number } // 独立虚拟模块空间尺寸，不与主体贴图或外部碰撞轮廓绑定
  interiorCells?: string[] // 虚拟模块空间自由格阵 "x,y"；须位于 interior 的 cols×rows 内，缺省 = 满矩形
  interiorSpecials?: InteriorSpecial[] // 内部特殊格：置于其上的模块对应属性加成
  effects?: FortressEffectPoint[] // 特效点：按堡垒停止/移动状态切换播放的程序化粒子（仅视觉）
  /** 履带/轮胎坐标协议；缺省表示旧存档的左上原点，载入时会迁移为 centered。 */
  runningGearCoordinateSpace?: 'centered'
  tracks?: TrackDef[] // 履带（v1.85：瓦片循环滚动动画，仅视觉；未配置 = 无履带动画层）
  hp: number // 船体结构值
  /** 载具索敌视野半径（格）；同组友方单位共享可见目标。旧定义缺省为 8 格。 */
  vision?: number
  /** 接战后的目标追踪半径（格）；目标离开后结束战斗。缺省为索敌视野的 1.5 倍。 */
  trackingVision?: number
  armor?: FortressArmor // 四向装甲阈值；旧定义缺省为四面 0
  speed: number // 移动速度 格/s
  turnSpeed: number // 横摆角速度上限 度/s（v2.51 起为可选封顶：履带=min(本值, 2×极速/履带间距推导)，轮式=min(本值, v·tanδ/轴距)；未配置语义见各底盘推导）
  turnRadius?: number // 最小转弯半径（格，缺省 0）：>0 时两底盘通用弧线模式覆盖——绕外侧圆心走弧线（转弯带动前行）；0=按底盘物理（履带差速/轮式前轮角）
  // ---------- v2.51 底盘（缺省 tracked） ----------
  chassis?: 'tracked' | 'wheeled' | 'halfTracked' | 'hovercraft' | 'walker' // 履带差速 / 轮式前轮转向 / 半履带 / 气垫惯性滑行 / 步行机甲
  trackWidth?: number // 【履带】履带间距（格，缺省 = w）：枢轴角速度推导 = 2×speed/trackWidth
  turnDrag?: number // 【履带】转向阻力 0~0.9（缺省 0）：转向输入期间目标速度 ×(1−turnDrag)
  wheelbase?: number // 【轮式】轴距（格，缺省 = h×0.6）：转弯半径 R = 轴距 / tan(前轮角)
  steerMax?: number // 【轮式】最大前轮转角（度，缺省 35）
  steerRate?: number // 【轮式】方向盘转速（度/秒，缺省 120；无输入时同速率自动回正）
  gripMax?: number // 【轮式】横向附着上限（m/s²，缺省 1.024）：v²/R 超限即压缩有效前轮角
  hoverDrag?: number // 【气垫】无推进时的滑行阻力（1/s，0.05~5，缺省 0.35）：越小滑行越久
  hoverGrip?: number // 【气垫】横向稳定速率（1/s，0~10，缺省 0.8）：越小甩尾越明显
  /** @deprecated 旧横向主体帧数；新步行机甲固定为 2×7。 */
  walkerFrames?: number
  /** @deprecated 旧步态帧率；载入时按当时极速迁移为 walkerStride。 */
  walkerFps?: number
  wheels?: WheelDef[] // 轮子（视觉+落印；与 tracks 独立共存）
  ramWeight?: 'light' | 'medium' | 'heavy' // 碾压重量级别；缺省按实际形状占格数自动推导
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

/** 载具主体贴图缺失时的固定程序化占位色：RGB(118, 122, 110)。 */
export const VEHICLE_PLACEHOLDER_COLOR = '#767A6E'

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
    id: 'standard', name: '测试堡垒', w: 5, h: 8, color: VEHICLE_PLACEHOLDER_COLOR,
    runningGearCoordinateSpace: 'centered',
    spriteBody: '/res/fortresses/fort_1_01.png', // 内置载具贴图（原比例居中不缩放）
    interior: { cols: 5, rows: 8 },
    hp: 2000, armor: { front: 4, rear: 2, left: 3, right: 3 }, ramWeight: 'heavy', speed: 6, turnSpeed: 25, turnRadius: 10, reverseFactor: 0.8, brakeInertia: 4, pitchGain: 2, leanCap: 2, accel: 3, // v1.54：测试堡垒机动参数调整（速度6/加速度3/俯仰2/转向25°s/半径10格）；v2.19 口令(4)：leanCap 4→2
    heatCap: 200, heatDissipation: 10,
    tracks: [ // 以实际占格几何中心为原点；仅定义左履带，右侧绕 x=0 自动镜像
      { id: 'trackL', x1: -2.07, y1: 3.17, x2: -2.07, y2: -3.37, radius: 0.5, tile: 'builtin:library/track01', overlapPx: 2 },
    ],
    effects: [ // v2.45 口令(5)沉淀：尾部双排烟（移动时）+ 两侧尘土（移动/静止）
      { id: 'fx-24572', x: 1.9, y: 7.5, kind: 'smoke', state: 'move' },
      { id: 'fx-28202', x: 3.1, y: 7.5, kind: 'smoke', state: 'move' },
      { id: 'fx-29783', x: 1.9, y: 8, kind: 'smoke', state: 'move' },
      { id: 'fx-30781', x: 3.1, y: 8, kind: 'smoke', state: 'move' },
      { id: 'fx-94523', x: 0.5, y: 7.8, kind: 'dust', state: 'both' },
      { id: 'fx-95876', x: 4.5, y: 7.8, kind: 'dust', state: 'both' },
    ],
    hardpoints: [ // v1.72：口令覆盖——11 炮位布局（均显示炮塔素材；射界角度原样保留口令值，允许 >360/负值回绕）
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
  defId?: string
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
  renderLayer?: 1 | 2 | 3 | 4 | 5
  flipX?: boolean
  rotation?: 0 | 90 | 180 | 270
  state?: string
}
export const BARREL_HP = 30
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
export type ProjectileArtKind = 'bullet' | 'shell' | 'missile' | 'ray' | 'spray' // 实弹/抛射/导弹/射线/喷射载荷
export type DirectProjectileSubtype = 'bullet' | 'armorPiercing' | 'fragmentation'
export const DIRECT_PROJECTILE_SUBTYPE_NAME: Record<DirectProjectileSubtype, string> = {
  bullet: '子弹', armorPiercing: '穿甲弹', fragmentation: '破片弹',
}
export const PROJECTILE_KIND_NAME: Record<ProjectileArtKind, string> = {
  bullet: '实弹', shell: '抛射', missile: '导弹', ray: '射线', spray: '喷射',
}
export const PROJECTILE_KIND_COLOR: Record<ProjectileArtKind, string> = { // 程序化特效默认色（按类别）
  bullet: '#F5E9C8', shell: '#F0A03C', missile: '#D9762E', ray: '#9AD9C8', spray: '#F08A38',
}
export interface ProjectileArtDef {
  id: string
  name: string // debug 选择器显示名
  kind: ProjectileArtKind
  /** 仅实弹（直射）使用；旧配置缺省按普通子弹处理。 */
  directSubtype?: DirectProjectileSubtype
  /** 空值或 'none' 均不播放；其他值引用声音预设。跳弹音效按弹丸独立配置，默认不播放；持续音效仅供射线持续攻击使用。 */
  sounds?: { flight?: string; impact?: string; ricochet?: string; explosion?: string; continuous?: string }
  // 战斗定义：新配置由弹丸/载荷统一控制；炮塔旧同名字段只作存档兼容回退。
  damage?: number
  speed?: number // m/s；实弹/抛射
  penetration?: number
  armorPen?: number
  armorDamage?: number
  pierce?: { count: number; decay: number }
  blastRadius?: number
  blastEffect?: BlastEffect
  dot?: { damage: number; interval: number }
  guided?: boolean
  guideDelay?: number
  guideDecel?: number
  missileFlightTime?: number
  missileCurve?: number
  ejectAngle?: number
  burnTime?: number
  missileInitSpeed?: number
  missileAccel?: number
  missileMaxSpeed?: number
  missileTurnMax?: number
  missileTurnAccel?: number
  /** 是否允许防空武器将该导弹作为目标；旧导弹缺省为可拦截。 */
  interceptable?: boolean
  /** 被拦截时独立使用的耐久；不会显示血条，也不影响导弹原本伤害。 */
  interceptHp?: number
  /**
   * 导弹垂直发射。开启后直接把 projectileAsset 按 7 帧横向等宽帧条处理：
   * 首帧=全垂直，末帧=正常飞行，中间帧=俯仰转向；不再使用独立转向贴图。
   */
  verticalLaunch?: { enabled: boolean; duration?: number }
  split?: { count: number; spread: number; at: 'proximity' | 'burnout'; range?: number }
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
    template?: 'small' | 'medium' | 'large' // 小型/中型/大型爆炸（默认 medium；模板控制视觉尺寸与华丽程度）
    color?: string; duration?: number; sparks?: number; smoke?: number
    visualScale?: number // 纯视觉尺寸倍率，不改变伤害与爆炸半径判定
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
  impact?: { // 碎屑/火花粒子 + 中心亮点一闪；全部粒子参数可由弹丸编辑器覆盖
    template?: 'bullet' | 'armorPiercing' | 'heavyArmorPiercing' // 子弹/穿甲弹/大型穿甲弹（默认 bullet）
    color?: string
    duration?: number // 中心亮点持续时间（秒）
    spikes?: number // 粒子数量
    speed?: number // 粒子初速（格/秒）
    life?: number // 单粒寿命（秒）
    size?: number // 粒子尺寸（格）
    drag?: number // 阻力系数
    streak?: number // 速度拖尾 0|1
    angle?: number // 围绕外喷方向（来弹反方向）的散射全锥角 0~360°
    bias?: number // 外喷方向偏置 0~1；0=全周随机，1=完全受 angle 锥角约束
  }
  // v2.8 光束表现（远行星号式分层贴图；仅 kind:'ray' 有意义，射线类炮塔引用本条目后生效；整套缺省 = 贴图默认搭配）
  beam?: {
    glowAsset?: string // 光晕层素材库条目 id（v2.11 beam 分类 /res/beam/），缺省 builtin:beam/beam_glowA；'none' = 程序化旧表现（纯色矩形）
    coreAsset?: string // 亮芯层素材库条目 id（v2.11 beam 分类 /res/beam/），缺省 builtin:beam/beam_coreA；'none' = 程序化旧表现
    impactAsset?: string // 命中点闪光素材库条目 id 或 /res/ 路径，缺省 /res/fx/glow16.png；'none' = 不显示
    muzzleAsset?: string // 炮口光球素材库条目 id 或 /res/ 路径，缺省 /res/fx/glow16.png；'none' = 不显示
    fringeColor?: string // 光晕层染色，缺省 #78C8DC（与旧程序化外圈一致）
    coreColor?: string // 亮芯层染色，缺省 #F0FAFF（与旧程序化内芯一致）
    flicker?: number // 亮度闪烁幅度 0~1，缺省 0.15（0 = 不闪烁）
    scrollSpeed?: number // 贴图沿光束方向滚动速度（美术 px/s，按 cell/BASE_CELL 缩放），缺省 96；0 = 静止
    muzzleScale?: number // v2.10 发射点闪光缩放（1 = 100%，缺省 1）
    impactScale?: number // v2.10 命中点闪光缩放（1 = 100%，缺省 1）
    absorb?: { rate?: number; color?: string; size?: number } // v2.10 吸收粒子（发射点能量吸收：环带向心汇聚；组在=生效；rate 缺省 12 粒/s、color 缺省=亮芯色、size 缺省 0.05 格）
    scatter?: { rate?: number; color?: string; size?: number; angle?: number } // v2.10 散发粒子（命中点飞溅；rate 缺省 24 粒/s、color 缺省=光晕色、size 缺省 0.05 格）；v2.15 angle=散发角度（以朝射线源方向为 0° 的全锥角：90°=左右各 45°，缺省 360=全向）；v2.15 起散射粒子带电焊式速度拖尾
    smoke?: { rate?: number; color?: string; size?: number } // v2.10 烟尘（命中点散发，smoke32 不加光；rate 缺省 6 粒/s、color 缺省 #3A3632、size 缺省 0.1 格）
  }
  spriteSet?: string // 遗留字段（UI 已移除）：素材文件夹名覆盖；解析链 = 库引用 → spriteSet ?? id → 通用集兜底
}

export const VERTICAL_LAUNCH_FRAMES = 7
export const VERTICAL_LAUNCH_DEFAULT_DURATION = 0.65

/** 垂发总时长统一口径；飞行寿命从离架后计算，但制导等导弹参数会在本阶段照常推进。 */
export function verticalLaunchDuration(ammo: ProjectileArtDef): number {
  return Math.max(0.05, ammo.verticalLaunch?.duration ?? VERTICAL_LAUNCH_DEFAULT_DURATION)
}

/** 所有阵营共用：仅导弹且明确开启时进入垂发阶段。 */
export function missileVerticalLaunchActive(ammo: ProjectileArtDef | undefined, elapsed: number): boolean {
  return !!ammo && ammo.kind === 'missile' && ammo.verticalLaunch?.enabled === true && elapsed < verticalLaunchDuration(ammo)
}
export const PROJECTILE_ARTS: ProjectileArtDef[] = [ // 可变注册表（与 TURRET_DEFS 同模式：内存编辑 + bump，不持久化）
  // 出厂配置：实弹挂 shell_s 贴图+命中；标准导弹使用不带固定尾焰的 missile2_s；射线+命中
  { id: 'bullet_std', name: '标准实弹', kind: 'bullet', directSubtype: 'bullet', damage: 5, speed: 51.2, penetration: 3, pierce: { count: 0, decay: 0.3 }, projectileAsset: 'builtin:library/shell_s', impact: {}, trail: { template: 'standard', life: 0.12, size: 0.045, inherit: 0.15, spread: 0.25 } },
  { id: 'shell_std', name: '标准榴弹', kind: 'shell', damage: 30, speed: 11.52, blastRadius: 2.56, blastEffect: { damage: 0, burn: { damage: 5, interval: 0.5, duration: 3 } } },
  { id: 'rocket_std', name: '标准火箭', kind: 'missile', damage: 45, guided: false, missileAccel: 5.12, missileMaxSpeed: 15.36, missileTurnMax: 90, missileTurnAccel: 180, interceptable: true, interceptHp: 20, blastRadius: 3.2, blastEffect: { damage: 0 }, projectileAsset: 'builtin:library/missile2_s', trail: { template: 'inertia', smoke: {} }, explosion: {} },
  // 同一个射线弹丸条目兼容两种使用者：光束炮塔读取 dot，单位即时命中读取 damage。
  { id: 'ray_std', name: '标准持续射线', kind: 'ray', damage: 26, dot: { damage: 15, interval: 0.5 }, impact: {}, beam: { flicker: 0, scrollSpeed: 224, muzzleScale: 0.3, impactScale: 0.3, absorb: { rate: 26, size: 0.05 }, scatter: { rate: 34, size: 0.05, angle: 90 } } },
  { id: 'flame_std', name: '标准火焰载荷', kind: 'spray', damage: 0, dot: { damage: 8, interval: 0.5 }, trail: { template: 'pulse', color: '#F08A38' } },
  { id: 'custom_ammo_1', name: '集束导弹', kind: 'missile', damage: 34, guided: true, guideDelay: 0.5, guideDecel: 1.92, missileInitSpeed: 2.56, missileAccel: 10.24, missileMaxSpeed: 40.96, burnTime: 5, missileTurnMax: 90, missileTurnAccel: 1440, missileFlightTime: 10, missileCurve: 10, interceptable: true, interceptHp: 12, blastRadius: 2.304, blastEffect: { damage: 0 }, split: { count: 4, spread: 40, at: 'proximity', range: 3.2 }, projectileAsset: 'builtin:library/missile2_s', trail: { template: 'inertia', color: '#ffae52', colorEnd: '#ffbb00', life: 0.2, inherit: 0, spread: 0.2, smoke: { duration: 1 } }, explosion: {} },
  { id: 'custom_ammo_2', name: '加农炮弹', kind: 'bullet', directSubtype: 'armorPiercing', damage: 50, speed: 51.2, pierce: { count: 0, decay: 0.3 }, projectileAsset: 'builtin:library/shell_m', explosion: { smoke: 8, ringWidth: 3, rings: 2, ringSpeed: 2, sparks: 20, speedJitter: 0.6, inherit: 0.8 }, impact: { spikes: 10, color: '#ff9d4d' } },
  { id: 'custom_ammo_3', name: '大型加农炮弹', kind: 'bullet', directSubtype: 'armorPiercing', damage: 60, speed: 51.2, pierce: { count: 1, decay: 0.3 }, projectileAsset: 'builtin:library/shell_m', explosion: { smoke: 8, ringWidth: 3, rings: 2, ringSpeed: 2, sparks: 20, speedJitter: 0.6, inherit: 0.8 }, impact: { spikes: 10, color: '#ff9d4d' } },
]

export interface TurretArt {
  anchor?: [number, number] // 炮塔原点/旋转轴心：相对旧美术坐标范围归一化坐标，默认 [0.5, 0.5]；预览时固定在画布中心
  barrels?: { // 炮管美术坐标覆盖：数量由 TurretDef.barrels 决定；多余项忽略、缺少项自动生成
    mount: [number, number] // 挂点（炮管根部）
    muzzle: [number, number] // 炮口点：弹丸出生点与火光定位点
    recoil?: number // 遗留逐管后坐（v1.58 起 UI 不再提供，由 art.recoil 统一；仅旧配置回退读取）
  }[]
  recoil?: number // v1.58 统一后坐行程（格）：所有炮管共用，默认 0.1；0 = 无后坐动画；优先于 barrels[].recoil 遗留逐管值
  // 火光表现 v1.45 起硬编码（2 帧 / 1.4×→1× / 每帧 0.1s，见 FLASH_* 常量），不再提供配置项
  glow?: { overheatOnly?: boolean } // 默认 true：仅过热时显示
  zBias?: number // 同层绘制次序微调，默认 0
  spriteSet?: string // 遗留字段（UI 已移除）：不再为底座/炮身/炮管/火光提供文件夹默认素材
  // 分层素材库引用：素材库条目 id；缺省、'none' 与遗留 'geo' 均表示不绘制，不再程序化几何回退
  baseAsset?: string
  turretAsset?: string
  barrelAsset?: string
  flipEvenBarrels?: boolean // 多管炮塔美术：true 时仅镜像第2/4/6…根炮管贴图；不改变挂点、炮口与开火逻辑
  flashAsset?: string
  charge?: { offset: [number, number]; frames: number; asset?: string } // 充能动画（帧条：v2.3 起按帧数横向等分、从左到右顺序播一遍；offset 相对轴心 格，右+x 上+y；帧时长 = chargeTime/frames；asset v1.75：素材库引用（charge 分类），'none'=不播放，缺省=文件夹 charge.png 回退）
  projectile?: string // 弹丸美术库条目 id（§3A；喷射无弹丸不适用；射线类引用 ray 条目 = 光束分层表现+命中特效；条目不可用 → 回退几何弹丸/默认光束）
  rack?: { show?: boolean; dx?: number; dy?: number } // 导弹挂载显示（仅导弹塔）：show 默认 true；dx/dy=挂载点相对炮管挂点偏移(格)，默认 0/0.12
  // v2.8：光束表现组已从炮塔迁移至弹丸库 ray 条目（ProjectileArtDef.beam）；旧配置 art.beam 字段读取忽略
}

// ---------- v2.49 标签式索敌 ----------
/** 偏好标签键（软排序：各贡献权重因子连乘到基础分，越小越优先）。
 * 已激活：'missile'（导弹优先）；预留键（实体未上线，编辑器暂不开放）：'fortress'（敌方堡垒优先）/ 'wingman'（僚机优先）/ 'spawned'（堡垒生产单位优先） */
export type PreferTagKey = 'nearFortress' | 'nearTurret' | 'hpMax' | 'hpMin' | 'sizeBig' | 'sizeSmall' | 'air' | 'ground'
  | 'fortress' | 'wingman' | 'missile' | 'spawned'
/** 约束标签键（硬过滤：命中即剔除出候选）。预留键同 prefer */
export type ExcludeTagKey = 'air' | 'ground' | 'wingman' | 'missile' | 'fortress' | 'spawned'
/** 资源标签键：弹药/电量/热量/防御（堡垒耐久），均为占上限百分比 0-100 */
export type ResourceTagKey = 'ammo' | 'energy' | 'heat' | 'defense'
/** 射线停火后的视觉消散方式：收缩=原地变窄渐隐；传递=源头向命中点收束。 */
export type BeamFadeMode = 'shrink' | 'transfer'
/** 炮塔标签：prefer=软排序 / exclude=硬过滤 / resource=开火门控（条件成立时禁止开火）。
 * 规则：exclude + resource 全部 AND 通过才开火；prefer 之间非条件、是排序权重（连乘）。零标签 = 现状（近堡垒优先、空军×0.5） */
export type TurretTag =
  | { kind: 'prefer'; key: PreferTagKey }
  | { kind: 'exclude'; key: ExcludeTagKey }
  | { kind: 'resource'; res: ResourceTagKey; op: 'lt' | 'gt'; value: number } // res 百分比 <op> value 时禁止开火

export interface TurretDef {
  id: string
  name: string
  /** 战斗 HUD 与整备界面使用的炮塔图标；仅引用素材库“图标”分类。 */
  iconAsset?: string
  /** 空值或 'none' 均不播放；其他值引用声音预设。burstLoop 用于连发过程；charge/continuous 仅由射线类炮塔配置。 */
  sounds?: { fire?: string; burstLoop?: string; charge?: string; continuous?: string; overheat?: string }
  type: WeaponType
  desc: string
  cost: number
  /** 战斗整备占用的装配分；旧定义缺省时按造价自动换算。 */
  assemblyPoints?: number
  // §4.1 瞄准与射界
  rotateSpeed: number // 度/秒
  aimCone: number // 射角：以炮口方向为中心的总角度（度）；目标在 ±射角/2 内时免转炮直接瞄准
  rangeMin: number // m
  rangeMax: number // m
  canAir: boolean
  canGround: boolean
  /** 允许直射与射线类炮塔把敌对、可拦截导弹纳入统一索敌。 */
  canInterceptMissile?: boolean
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
  ejectAngle?: number // 出膛随机偏角总区间（度）：20 表示每发在炮塔方向 -10°～+10° 取样；仅延迟制导导弹生效，不替代垂发流程
  burnTime?: number // v2.20 发动机燃烧时间（秒）：期内正常加速，燃尽后惯性滑行（不再加速、尾焰/喷口焰熄灭）；未配置 = 全程燃烧
  split?: { count: number; spread: number; at: 'proximity' | 'burnout'; range?: number } // 近炸按 range 米触发（缺省 M_PER_CELL，即 1 格）/ burnout=燃尽触发
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
  beamFadeMode?: BeamFadeMode // 射线专用；旧定义缺省为 shrink（收缩）
  sprayAngle?: number // 度
  attackDuration?: number // s，射线/喷射单次持续
  dot?: { damage: number; interval: number } // 持续伤害
  // §4.3 装填与连发
  fireRate: number // 装填时间（s）：一轮/一次持续攻击结束后，到下一轮开始前的等待时间
  burst?: number // 连发数
  burstInterval?: number // s
  barrels?: number // 炮管数（默认 1 = 单管）；多管时配合 barrelMode（持续型光束/喷射不适用）
  barrelMode?: 'salvo' | 'sequential' // 齐射(全部炮管同时)/轮流(逐管按连发间隔依次发射)；多管缺省 salvo
  art?: TurretArt // 美术资源配置（可选；缺省时底座/炮身/炮管/火光均不绘制）
  // §4.4 热量（汇聚到堡垒热量池；堡垒过热则全炮塔停火）
  heatPerShot?: number // 点/发（累积到堡垒热量）
  chargeTime?: number // 充能时间（秒，Starsector chargeup）：每次开火周期起射前的前摇（未配置 = 无前摇，现状不变）
  // §4.5 资源消耗
  /** 炮塔独立弹药上限；不消耗弹药的炮塔可设为 0。旧定义缺省时按消耗类型迁移为 100/0。 */
  ammoCapacity?: number
  /** 外部弹药补给换算倍率；实际恢复量 = 输入补给量 × 汇率。缺省为 1，不影响开火消耗。 */
  ammoExchangeRate?: number
  /** 炮塔独立能量上限；不消耗能量的炮塔可设为 0。旧定义缺省时按消耗类型迁移为 100/0。 */
  energyCapacity?: number
  ammoPerSec?: number // 喷射消耗（弹药/s）
  energyPerShot?: number // 发射电量
  energyPerSec?: number // 维持电量
  // §4.6 生存（v2.22：人员/最少人员参数已删除——炮塔不再需要人员运转）
  mount: MountSize // S/M/L 槽位尺寸：须与炮位 size 匹配，但不再决定占格
  w: number // 旧美术坐标范围宽；不再作为炮塔占格
  h: number // 旧美术坐标范围高；不再作为炮塔占格
  hp: number // 耐久
  onDestroyBlast?: BlastEffect & { radius: number } // 毁坏效果（如爆炸）
  color: string
  tags?: TurretTag[] // v2.49 标签式索敌（未配置 = 现状：近堡垒优先、空军×0.5、无资源门控）
}

export function turretAmmoCapacity(def: Pick<TurretDef, 'type' | 'ammoCapacity' | 'ammoPerSec'>): number {
  if (Number.isFinite(def.ammoCapacity)) return Math.max(0, def.ammoCapacity ?? 0)
  return def.type === 'direct' || def.type === 'lob' || def.type === 'missile' || (def.ammoPerSec ?? 0) > 0 ? 100 : 0
}

export function turretAmmoExchangeRate(def: Pick<TurretDef, 'ammoExchangeRate'>): number {
  return Number.isFinite(def.ammoExchangeRate) ? Math.max(0, def.ammoExchangeRate ?? 1) : 1
}

export function turretEnergyCapacity(def: Pick<TurretDef, 'energyCapacity' | 'energyPerShot' | 'energyPerSec'>): number {
  if (Number.isFinite(def.energyCapacity)) return Math.max(0, def.energyCapacity ?? 0)
  return (def.energyPerShot ?? 0) > 0 || (def.energyPerSec ?? 0) > 0 ? 100 : 0
}

export type TurretFireSoundRole = 'fire' | 'burstLoop'

/** 连发中的非末发/轮使用循环音效；单发及最后一发/轮统一由开火音效收尾。 */
export function turretFireSoundRole(def: Pick<TurretDef, 'burst'>, shotIndex: number): TurretFireSoundRole {
  const shotCount = Math.max(1, Math.floor(def.burst ?? 1))
  return shotCount > 1 && shotIndex < shotCount - 1 ? 'burstLoop' : 'fire'
}

export const TURRET_DEFS: TurretDef[] = [
  {
    // v1.72：口令覆盖出厂配置——双管轮流（DualGun_S1 炮身 + DualGun-_S2 炮管），6 连发不产热，弹速 400，无穿透
    id: 'mg', name: '哨戒机枪', type: 'direct', desc: '实弹直射 · 穿透2/衰减30% · 3连发',
    cost: 80, rotateSpeed: 240, aimCone: 12, rangeMin: 3.2, rangeMax: 19.2, canAir: false, canGround: true,
    damage: 5, projectileSpeed: 51.2, accuracy: 1.536, pierce: { count: 0, decay: 0.3 },
    fireRate: 2, burst: 6, burstInterval: 0.1, heatPerShot: 0, // v2.45 口令(5)：fireRate 1→2
    ammoCapacity: 100, ammoExchangeRate: 1, mount: 'S', w: 1, h: 1, hp: 300, color: '#8C94A0',
    barrels: 2, barrelMode: 'sequential',
    art: {
      anchor: [0.5, 0.5],
      recoil: 0.08, // v1.58 统一后坐（全管共用，优先于逐管遗留值）
      barrels: [ // 炮口对准炮管尖：挂点 + 管高12px/BASE_CELL = 0.375格
        { mount: [-0.1, 0.25], muzzle: [-0.1, 0.625] },
        { mount: [0.1, 0.25], muzzle: [0.1, 0.625], recoil: 0.1 }, // 遗留逐管后坐（被统一值 0.08 覆盖）
      ],
      baseAsset: 'none', turretAsset: 'builtin:library/dualgun_s1', barrelAsset: 'builtin:library/dualgun_s2',
      flashAsset: 'builtin:library/fx_fire_s', // v1.77：接线内置开火效果（此前仅注册未引用 → 无炮口火光）
      projectile: 'bullet_std', zBias: -1,
    },
  },
  {
    id: 'lob', name: '榴弹抛射炮', type: 'lob', desc: '抛物线 · 爆炸2.56m · 命中燃烧',
    cost: 150, rotateSpeed: 90, aimCone: 10, rangeMin: 9.6, rangeMax: 35.2, canAir: false, canGround: true,
    damage: 30, projectileSpeed: 11.52, accuracy: 0.384, blastRadius: 2.56,
    blastEffect: { damage: 0, burn: { damage: 5, interval: 0.5, duration: 3 } },
    fireRate: 2, burst: 1, burstInterval: 0, heatPerShot: 12,
    ammoCapacity: 100, ammoExchangeRate: 1, mount: 'M', w: 1, h: 2, hp: 420, color: '#9C7B54',
    art: { projectile: 'shell_std' },
  },
  {
    id: 'cruise', name: '巡航导弹井', type: 'missile', desc: '非制导 · 锁定落点 · 爆炸3.2m',
    cost: 220, rotateSpeed: 120, aimCone: 16, rangeMin: 12.8, rangeMax: 51.2, canAir: false, canGround: true,
    damage: 45, guided: false, missileAccel: 5.12, missileMaxSpeed: 15.36,
    missileTurnMax: 90, missileTurnAccel: 180, accuracy: 0.512, blastRadius: 3.2,
    blastEffect: { damage: 0 },
    fireRate: 2.5, burst: 1, burstInterval: 0, heatPerShot: 20,
    ammoCapacity: 100, ammoExchangeRate: 1, mount: 'L', w: 2, h: 2, hp: 520, color: '#A05C48',
    art: { projectile: 'rocket_std' },
  },
  {
    id: 'hunter', name: '猎手制导导弹', type: 'missile', desc: '制导追踪 · 可对空 · 受角速度约束',
    cost: 10, rotateSpeed: 0, aimCone: 360, rangeMin: 0, rangeMax: 64, canAir: true, canGround: true,
    damage: 34, guided: true, guideDelay: 0.5, guideDecel: 1.92, missileInitSpeed: 2.56, missileAccel: 10.24, missileMaxSpeed: 40.96, burnTime: 5,
    missileTurnMax: 90, missileTurnAccel: 1440, blastRadius: 2.304,
    blastEffect: { damage: 0 },
    missileFlightTime: 10,
    fireRate: 6, burst: 8, burstInterval: 0.4, barrels: 4, barrelMode: 'sequential', heatPerShot: 2,
    ammoCapacity: 100, ammoExchangeRate: 1, mount: 'S', w: 1, h: 1, hp: 500, color: '#7E6E9C',
    art: { // MissileLauncher2_S 素材退役后保留集束导弹与 4 管炮口配置，炮身使用无素材回退
      anchor: [0.5, 0.5], baseAsset: 'none', recoil: 0,
      barrels: [ // v2.45 口令(5)：4 管挂点下移 + 炮口统一右侧 (0.5,0)
        { mount: [-0.3, 0.3], muzzle: [0.5, 0] },
        { mount: [-0.2, 0.35], muzzle: [0.5, 0] },
        { mount: [0.2, 0.35], muzzle: [0.5, 0] },
        { mount: [0.3, 0.35], muzzle: [0.5, 0] },
      ],
      turretAsset: 'none', barrelAsset: 'none', projectile: 'custom_ammo_1', rack: { show: false }, flashAsset: 'none',
    },
    missileCurve: 10, // v2.19 口令(4)：导弹弹道弯曲度；v2.45 口令(5)：20→10
  },
  {
    id: 'beam', name: '磁轨光束塔', type: 'beam', desc: '矩形波束 · 持续伤害 · 发射时锁定不转向 · 耗电',
    cost: 20, rotateSpeed: 100, aimCone: 5, rangeMin: 0, rangeMax: 32, canAir: true, canGround: true,
    damage: 0, beamWidth: 1.28, beamFadeMode: 'shrink', attackDuration: 3, dot: { damage: 15, interval: 0.5 },
    fireRate: 4.545, ammoExchangeRate: 1, energyCapacity: 100, energyPerShot: 15, energyPerSec: 5,
    mount: 'M', w: 1, h: 2, hp: 450, color: '#5C7E8C', // M 型槽位；w/h 仅保留旧美术坐标范围
    art: { // 退役 Laser_M 与 charge_Laser_M 素材后保留原战斗参数，视觉使用无素材回退
      anchor: [0.5, 0.5], baseAsset: 'none', recoil: 0,
      barrels: [{ mount: [0, 0], muzzle: [0, 0.7] }],
      turretAsset: 'none', barrelAsset: 'none', projectile: 'ray_std', flashAsset: 'none',
      charge: { offset: [0, 0.2], frames: 6, asset: 'none' },
    },
    chargeTime: 2, // v2.19 口令(4)：3→2
  },
  {
    id: 'spray', name: '烈焰喷射塔', type: 'spray', desc: '60°扇形 · 持续灼烧 · 耗弹药',
    cost: 120, rotateSpeed: 200, aimCone: 12, rangeMin: 0, rangeMax: 9.6, canAir: false, canGround: true,
    damage: 0, sprayAngle: 60, attackDuration: 2.5, dot: { damage: 8, interval: 0.5 },
    fireRate: 4, heatPerShot: 0, ammoCapacity: 100, ammoExchangeRate: 1, ammoPerSec: 5,
    mount: 'S', w: 1, h: 1, hp: 350, color: '#A07840',
    art: { projectile: 'flame_std' },
  },
  { // v2.45 口令(5)沉淀：自定义加农炮（MidCannon 炮身/炮管 + 炮弹 custom_ammo_2）
    id: 'custom-1787149972481-1', name: '加农炮', type: 'direct', desc: '自定义 · 直射',
    cost: 80, rotateSpeed: 90, aimCone: 5, rangeMin: 3.2, rangeMax: 38.4, canAir: false, canGround: true,
    damage: 50, projectileSpeed: 51.2, accuracy: 0.384, pierce: { count: 0, decay: 0.3 },
    fireRate: 2.5, burst: 1, burstInterval: 0.1, heatPerShot: 1,
    ammoCapacity: 100, ammoExchangeRate: 1, mount: 'M', w: 1, h: 2, hp: 300, color: '#8C94A0',
    barrels: 1, barrelMode: 'salvo',
    art: {
      anchor: [0.5, 0.5],
      recoil: 0.2,
      barrels: [{ mount: [0, 0.5], muzzle: [0, 1.2] }],
      baseAsset: 'none', turretAsset: 'builtin:library/midcannon_m1', barrelAsset: 'builtin:library/midcannon_m2',
      flashAsset: 'builtin:library/fx_fire_s', projectile: 'custom_ammo_3', zBias: -1,
    },
  },
  { // 大型双联加农炮保留参数；退役旧炮身/炮管素材后保持不绘制
    id: 'custom-1787150582922-2', name: '大型双联加农炮', type: 'direct', desc: '自定义 · 直射',
    cost: 80, rotateSpeed: 90, aimCone: 8, rangeMin: 3.2, rangeMax: 38.4, canAir: false, canGround: true,
    damage: 60, projectileSpeed: 51.2, accuracy: 0.64, pierce: { count: 1, decay: 0.3 },
    fireRate: 2, burst: 2, burstInterval: 0.25, heatPerShot: 0,
    ammoCapacity: 100, ammoExchangeRate: 1, mount: 'L', w: 2, h: 2, hp: 300, color: '#8C94A0',
    barrels: 2, barrelMode: 'salvo',
    art: {
      anchor: [0.5, 0.5],
      recoil: 0.4,
      barrels: [
        { mount: [-0.26, 1], muzzle: [-0.26, 1.8] },
        { mount: [0.26, 1], muzzle: [0.26, 1.8] },
      ],
      baseAsset: 'none', turretAsset: 'none', barrelAsset: 'none',
      flashAsset: 'builtin:library/fx_fire_s', projectile: 'custom_ammo_2', zBias: -1,
    },
  },
]

/** 将弹丸库的战斗属性覆盖到炮塔平台参数上；旧炮塔字段只作为兼容回退。 */
export function projectileDrivenTurret(def: TurretDef): TurretDef {
  const ammo = PROJECTILE_ARTS.find(item => item.id === def.art?.projectile)
  if (!ammo) return def
  return {
    ...def,
    damage: ammo.damage ?? def.damage,
    projectileSpeed: ammo.speed ?? def.projectileSpeed,
    armorPen: ammo.armorPen ?? def.armorPen,
    armorDamage: ammo.armorDamage ?? def.armorDamage,
    pierce: ammo.pierce ?? def.pierce,
    blastRadius: ammo.blastRadius ?? def.blastRadius,
    blastEffect: ammo.blastEffect ?? def.blastEffect,
    dot: ammo.dot ?? def.dot,
    guided: ammo.guided ?? def.guided,
    guideDelay: ammo.guideDelay ?? def.guideDelay,
    guideDecel: ammo.guideDecel ?? def.guideDecel,
    missileFlightTime: ammo.missileFlightTime ?? def.missileFlightTime,
    missileCurve: ammo.missileCurve ?? def.missileCurve,
    ejectAngle: ammo.ejectAngle ?? def.ejectAngle,
    burnTime: ammo.burnTime ?? def.burnTime,
    missileInitSpeed: ammo.missileInitSpeed ?? def.missileInitSpeed,
    missileAccel: ammo.missileAccel ?? def.missileAccel,
    missileMaxSpeed: ammo.missileMaxSpeed ?? def.missileMaxSpeed,
    missileTurnMax: ammo.missileTurnMax ?? def.missileTurnMax,
    missileTurnAccel: ammo.missileTurnAccel ?? def.missileTurnAccel,
    split: ammo.split ?? def.split,
  }
}

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
  walker: { kind: 'walker', name: '行尸', hp: 60, speed: 0.95, dps: 10, bounty: 15, air: false, priority: 'default', armor: 0, color: '#6F7D5C', size: 0.32, attackRange: 8, attackInterval: 1.5, projectileSpeed: 12.8, projectileDamage: 10, penetration: 3 },
  rusher: { kind: 'rusher', name: '冲核尸', hp: 45, speed: 1.5, dps: 12, bounty: 20, air: false, priority: 'core-rush', armor: 0, color: '#A9A06A', size: 0.3, attackRange: 7, attackInterval: 1.1, projectileSpeed: 14.72, projectileDamage: 12, penetration: 2.5 },
  brute: { kind: 'brute', name: '重甲尸', hp: 230, speed: 0.55, dps: 18, bounty: 40, air: false, priority: 'default', armor: 0.25, color: '#555B63', size: 0.4, attackRange: 9, attackInterval: 2.2, projectileSpeed: 10.88, projectileDamage: 18, penetration: 6 },
  flyer: { kind: 'flyer', name: '飞蝗', hp: 34, speed: 1.9, dps: 6, bounty: 18, air: true, priority: 'core-rush', armor: 0, color: '#7E8C5A', size: 0.3, attackRange: 10, attackInterval: 0.9, projectileSpeed: 17.92, projectileDamage: 6, penetration: 2 },
  runner: { kind: 'runner', name: '疾行尸', hp: 36, speed: 1.7, dps: 8, bounty: 12, air: false, priority: 'default', armor: 0, color: '#8A7F6E', size: 0.3, attackRange: 7.5, attackInterval: 1.2, projectileSpeed: 16, projectileDamage: 8, penetration: 3 },
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
  cost: number // 资源
  /** 战斗整备占用的装配分；旧定义缺省时按造价自动换算。 */
  assemblyPoints?: number
  /** 可安装单位角色；缺省表示载具与堡垒均可。 */
  allowedUnitTypes?: Array<'vehicle' | 'fortress'>
  /** 模块效果作用对象；旧数据缺省按“玩家阵营”读取，以保持已经实现的共享效果。 */
  effectTarget?: 'controller' | 'playerFaction'
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
  produce?: { kind: AllyKind; unitDefId?: string; interval: number; cap: number } // 生产类：unitDefId 优先；kind 为旧存档/几何回退
  color: string
  asset?: string // v2.30：贴图素材（素材库「模块」分类锚定；缺省=色块+名称回退）
  shape?: string[] // v2.31：异型占格铺格（"x,y" 未旋转局部格，限 w×h 包围盒内；缺省= w×h 全满矩形；L/T 型等用）
}

/** 旧炮塔未填写装配分时按造价换算；最少占 1 分，显式 0 可配置为免费。 */
export function turretAssemblyPoints(def: TurretDef): number {
  if (Number.isFinite(def.assemblyPoints)) return Math.max(0, Math.round(def.assemblyPoints!))
  return Math.max(1, Math.round(Math.max(0, def.cost) / 50))
}

/** 旧模块未填写装配分时按造价换算；最少占 1 分，显式 0 可配置为免费。 */
export function moduleAssemblyPoints(def: ModuleDef): number {
  if (Number.isFinite(def.assemblyPoints)) return Math.max(0, Math.round(def.assemblyPoints!))
  return Math.max(1, Math.round(Math.max(0, def.cost) / 50))
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
  soldier: { name: '士兵', hp: 120, speed: 1.2, damage: 8, interval: 0.8, range: 1.536, canAir: true, canGround: true, air: false, color: '#7A8C5A', size: 0.18 },
  tank: { name: '坦克', hp: 600, speed: 0.7, damage: 45, interval: 2, range: 9.6, canAir: false, canGround: true, air: false, color: '#6E7A68', size: 0.35 },
  plane: { name: '战斗机', hp: 220, speed: 2.2, damage: 25, interval: 1, range: 7.68, canAir: true, canGround: true, air: true, color: '#7E8E9C', size: 0.3 },
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
  { id: 'barracks', name: '机器人模块', desc: '每 8s 产出 1 架无人飞行器（同时存活 ≤6）', cost: 160, w: 3, h: 2, produce: { kind: 'plane', unitDefId: 'unit:uav', interval: 8, cap: 6 }, color: '#8A7E5E' },
  { id: 'tank_factory', name: '坦克制造模块', desc: '每 15s 产出 1 辆统一载具（同时存活 ≤3）', cost: 260, w: 3, h: 3, produce: { kind: 'tank', unitDefId: 'fortress:standard', interval: 15, cap: 3 }, color: '#6A7462' },
  { id: 'airfield', name: '无人机模块', desc: '每 20s 产出 1 架无人飞行器（同时存活 ≤2）', cost: 300, w: 3, h: 3, produce: { kind: 'plane', unitDefId: 'unit:uav', interval: 20, cap: 2 }, color: '#5E6E7E' },
]
