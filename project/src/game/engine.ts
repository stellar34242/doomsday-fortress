// 废土防线 · 纯逻辑引擎
// 实现《战场空间设计文档》（网格/墙段/建造/寻路/目标优先级）与
// 《炮塔系统属性文档 v1.1》（5 类武器、属性计算规则）。
// 不依赖 DOM，可被 esbuild 打包后在 node 中做无头模拟。
import {
  ALLY_DEFS, AMMO, BARREL_BURN, FLASH_DURATION, OVERHEAT_RESUME,
  DEFAULT_FORTRESS, ENERGY, ENEMY_DEFS, FORTRESS_DEFS, M_PER_CELL,
  BOUNTY_MULT, MODULE_DEFS, PREP_TIME, SPAWN_ROWS, START_GOLD,
  SPECIAL_MULT, TURRET_DEFS, WALL_BUILD_COST, WALL_HP,
  buildWave, levelScale, m2c, upgradeCost, waveHpScale, TURN_COAST_TAU, BASE_CELL } from './config'
import type { AllyKind, BattleObject, EnemyKind, FixedBuilding, FortressArmor, FortressDef, Hardpoint, ModuleDef, ResourceTagKey, SpecialBoost, TrackDef, TurretDef, TurretTag, WheelDef } from './config'
import { getSelectedFortressId } from './persist'
import { DEFEND_OVERLAP_TIME_DEFAULT, DEFEND_REST_TIME_DEFAULT, LEVEL, TRIGGER_ENEMY_KINDS, canPlaceBaseCell, getWallInfo, invalidateWallInfo, isBaseCell, isInnerCell } from './level'
import type { LevelBossPhase, LevelEventAction, LevelObjective, LevelTerrain, LevelZone } from './level'
import { fortressBodyMaskSegmentEntry } from './fortressBodyMask'

// ---------- 基础类型 ----------
export type Phase = 'prep' | 'combat' | 'won' | 'lost'
export interface Cell { x: number; y: number }
export type WallState = 'intact' | 'damaged' | 'destroyed'

// 墙体只有一种：基地防御墙与玩家自建墙同属性（WALL_HP）、同行为
export interface WallSeg {
  id: number
  cells: Cell[]
  hp: number
  maxHp: number
  state: WallState
  /** LEVEL.initialWalls 来源（场景编辑模式下由 draft 层接管渲染） */
  fromLevel?: boolean
  /** 孤立格(33)：端头型为 undefined/false（算墙可连接），true = 独立块（不影响邻居选块） */
  isolated?: boolean
}

export interface Turret {
  id: number
  defId: string
  x: number // 占格左上角
  y: number
  w: number
  h: number
  level: number
  hp: number
  maxHp: number
  angle: number // 弧度；0 = 朝 -Y（战场上方），顺时针为正
  cooldown: number
  burstLeft: number
  rackLeft: number // 导弹挂载显示：待发弹余量（仅导弹塔参与；满挂=burst，逐发/齐射扣减，新一轮复挂）
  rackAnim: number // 复挂渐显推入剩余时长（仅复挂触发 RACK_RELOAD_ANIM；初始 0 不播）
  rackTimer: number // 逐枚复挂计时（打空后启动：X=fireRate/(burst+1) 秒/枚；轮中/满挂停计）
  burstTimer: number
  chargeLeft: number // 充能剩余（秒，>0 = 充能前摇中；v2.15 (-CHARGE_LAST_HOLD,0) = 末帧滞留；均不射击）
  firing: boolean
  /** 轮流发射模式当前炮管下标（跨轮轮转不重置） */
  barrelIdx: number
  /** LEVEL.initialTurrets 来源（场景编辑模式下由 draft 层接管渲染） */
  fromLevel?: boolean
  firingLeft: number
  tickTimer: number
  targetId: number | null
  /** v2.35 光束起射时刻（s.time）：起射后光束以 BEAM_ON_SPEED 从炮口伸展到全长；停火清除 */
  beamOnAt?: number
  /** 挂载的堡垒炮位 id（移动堡垒：世界坐标每 tick 由 syncTurretMounts 同步；无值 = 地面炮塔，仅兼容旧逻辑/测试） */
  hardpointId?: string
  /** 内置隐藏炮位的预装武器：不可拆除 */
  builtIn?: boolean
}

export interface BurnDot { damage: number; interval: number; timer: number; left: number }

export interface Enemy {
  id: number
  kind: EnemyKind
  x: number // 连续坐标（格）
  y: number
  hp: number
  maxHp: number
  mode: 'move' | 'attack'
  targetKind: 'wall' | 'turret' | 'building' | 'core' | 'object' | 'ally' | null
  targetId: number | null
  goalX: number
  goalY: number
  hasGoal: boolean
  pathVersion: number
  attackedBy: { turretId: number; time: number }[]
  dots: BurnDot[]
  hitFlash: number
  attackCooldown?: number // 远程实弹攻击冷却；可选以兼容旧测试/存档构造
  bossName?: string
  bossSizeScale?: number
  bossPhases?: LevelBossPhase[]
  bossDefeatActions?: LevelEventAction[]
  bossPhaseDone?: number[]
}

export type ProjKind = 'bullet' | 'shell' | 'missile'
export interface Projectile {
  id: number
  kind: ProjKind
  defId: string
  level: number
  x: number
  y: number
  px: number
  py: number
  heading: number
  damage: number
  traveled: number // m
  maxTravel: number // m
  shooter: number // 发射炮塔 id（用于敌人反击归属）
  hitIds: number[] // 直射已命中敌人（穿透去重）
  // 抛射
  t: number
  flightTime: number
  sx: number
  sy: number
  tx: number
  ty: number
  // 导弹
  speed: number
  turnRate: number
  guided: boolean
  targetId: number | null
  lockX: number
  lockY: number
  lostLock: boolean
  prevDist: number // 制导导弹上一帧与目标距离（近炸引信）
  flightLeft?: number // 导弹：剩余飞行时间（秒，发射时 = def.missileFlightTime；未配置不设）
  fading?: number // 导弹：飞行时间耗尽后的淡出倒计时（停止制导、惯性直飞、不再命中）
  weavePhase: number // 导弹：飞行曲线（weave）摆动相位（发射时随机）
  guideDelayLeft?: number // v1.94 延迟制导：剩余制导延迟（秒；>0 期间沿发射航向=炮塔方向直飞、不追踪不触锁定点爆炸，归零自动开制导）
  tgtPX?: number // v2.20 前置量追踪：上一 tick 目标位置 x（Enemy 无速度字段，按弹采样位移/dt 估算目标速度）
  tgtPY?: number // v2.20 前置量追踪：上一 tick 目标位置 y
  splitDone?: boolean // v2.20 集束分裂：子弹标记（防止二次分裂；母弹分裂后移除）
  igniteAtT?: number // v2.23 点火时刻弹龄（秒；= 出生时的制导延迟，无延迟=0；集束子弹=分裂时刻弹龄）——点火大力喷射/烟尾「持续」窗口的计时基准
}

/** 敌方直线实弹：与玩家弹丸分池，命中目标固定为移动堡垒。 */
export interface EnemyProjectile {
  id: number
  shooterId: number
  x: number
  y: number
  px: number
  py: number
  heading: number
  speed: number // 米/秒
  damage: number
  penetration: number
  traveled: number // 米
  maxTravel: number // 米
}

/** 导弹飞行时间耗尽后的淡出时长（秒） */
export const MISSILE_FADE = 0.5
/** 制导重选可达性机动余量系数 */
export const MISSILE_RETARGET_MARGIN = 0.9
/** 光束持续发射期间转向速度系数（0.5 = 减半） */
export const BEAM_TURN_FACTOR = 0.5
export const CHARGE_LAST_HOLD = 0.05 // v2.15 充能末帧滞留（秒，v2.16 0.1→0.05）：最后一帧亮起后再过 0.05s 起射（不计入 chargeTime）
/** 光束停火消退动画时长（秒）：宽度收窄 + 渐隐 */
export const BEAM_FADE = 0.25
/** 导弹飞行曲线（weave）：摆动频率（Hz）与 curve=100 时的最大航向偏置角（度）。
 * 航向偏置 = (curve/100)×MAX_ANGLE×cos(2πft+phase) 叠加在基础航向上——位置横向偏移自然往复变号。
 * 注：weave 为气动摆动，不占用转向机构角速度（制导转向本身仍受 missileTurnMax 约束）。 */
export const MISSILE_WEAVE_FREQ = 0.8
export const MISSILE_WEAVE_MAX_ANGLE = 90

/** 导弹可视航向（含 weave 摆动偏置）：与 updateMissile 位移公式同源——渲染贴图/喷口跟随蛇形转向 */
export function missileVisHeading(p: Projectile, def: TurretDef): number {
  const curve = def.missileCurve ?? 0
  if (curve <= 0) return p.heading
  return wrapAngle(p.heading + Math.cos(TAU * MISSILE_WEAVE_FREQ * p.t + p.weavePhase) * (curve / 100) * MISSILE_WEAVE_MAX_ANGLE * DEG)
}

export interface BurnZone { id: number; x: number; y: number; r: number; damage: number; interval: number; timer: number; left: number }
export interface ExplosionFx { id: number; x: number; y: number; r: number; ttl: number; max?: number; ammoId?: string; hx?: number; hy?: number; hspeed?: number; kind?: 'deathSmall' | 'deathMain' | 'groundImpact' } // ammoId = 弹丸美术库引用；hx/hy = 命中方向单位向量、hspeed = 命中弹丸速率(格/s)（方向偏置/速度继承用；非弹丸爆炸不带）；v2.53 max = 初始 ttl（渲染进度基准，缺省按 0.35）；kind = 堡垒毁灭演出爆炸，或 v2.57 无伤害的实弹落地事件

// v2.53 堡垒毁灭序列（待开发 #15 落地）：hp 归零 → dying 计时（不立即判负）→ 内伤连锁小爆 → 主爆（AOE）→ 残骸余烟 → lost
export const DEATH_SPARK_T = [0, 0.25, 0.55] // 内伤小爆时刻（s）
export const DEATH_SPARK_FRAC = [0.2, 0.5, 0.8] // 小爆船体格位选取比例（确定性，不用随机——sim 可复现）
export const DEATH_MAIN_T = 0.8 // 主爆时刻（s）
export const DEATH_END_T = 2.2 // 残骸余烟结束 → 判负（s）
export const DEATH_MAIN_DMG = 25 // 主爆 AOE 伤害（波及周围敌人与僚机；驾驶员下车被波及的判负规则待驾驶员模式落地）
export const DEATH_MAIN_R_K = 0.8 // 主爆半径 = max(船体宽, 船体高) × 本系数（格）
/** 非爆炸命中特效事件（§3A.5.4：实弹/点射命中点 impact 帧条；无素材时无特效=现状） */
export interface ImpactFx { id: number; x: number; y: number; ttl: number; max: number; ammoId?: string }
export interface Tracer { id: number; x1: number; y1: number; x2: number; y2: number; ttl: number; pulse?: boolean; defId?: string } // v2.7：pulse 曳光带 defId → 渲染端按光束美术配置绘制
export interface FloatText { id: number; x: number; y: number; text: string; ttl: number }

/** 炮口事件（规范 §5.2/§5.3：后坐/火光的表现层载体；纯数据可 structuredClone，渲染端按渲染帧时间推进动画） */
export interface MuzzleEvent {
  id: number
  turretId: number
  barrelIdx: number // 击发炮管（齐射每管一条；轮流仅当前管）
  x: number // 炮口世界坐标（格）
  y: number
  angle: number // 击发时刻炮口方向（不跟随旋转）
  ttl: number // 剩余存活（= FLASH_DURATION 固定 0.2s，v1.45 硬编码）
  max: number
}

/** 光束停火消退记录（纯数据可 structuredClone）：保持停火时刻角度/长度，宽度收窄 + 渐隐 */
export interface BeamFade {
  id: number
  defId: string // v2.7：消退段复用该炮塔的光束美术配置（贴图/颜色）
  x: number // 起点（炮口点，与光束起点一致）
  y: number
  angle: number // 停火时刻角度（不跟随后续转向）
  len: number // 停火时刻波束长度（格）
  width?: number // v2.50：初始宽幅（m，def.beamWidth；undefined = 未配置，消退段贴图保持原生高度）
  ttl: number
  max: number
}

/** 要塞内部模块实例：摆放在 fortressDef.interior 格阵内（rot=1 旋转 90°）；无耐久、不可被摧毁，仅可拆除 */
export interface ModuleInst { id: number; defId: string; x: number; y: number; rot: 0 | 1; timer: number } // timer = 生产倒计时

/** 友军单位（生产模块产出）：v1 直线移动、无碰撞；air=true 地面敌人无法攻击 */
export interface Ally {
  id: number
  kind: AllyKind
  producerId: number // 产出它的模块 id（用于模块存活上限统计）
  x: number // 连续坐标（格）
  y: number
  hp: number
  maxHp: number
  cooldown: number // 攻击间隔倒计时
  targetId: number | null
  hitFlash: number
}

export interface TriggerRuntime {
  id: number
  inside: boolean
  activations: number
  cooldown: number
}

export interface AmbushSpawn {
  triggerId: number
  kind: EnemyKind
  left: number
  x: number
  y: number
}

export interface EventSequenceRuntime {
  id: number
  sourceId: number
  zone: LevelZone
  actions: LevelEventAction[]
  index: number
  waitLeft: number
}

export interface InteractableRuntime { id: number; inside: boolean; activations: number; enabled: boolean }
export interface LevelNotice { id: number; text: string; left: number }
export interface ShieldHitFx { id: number; x: number; y: number; ttl: number; max: number; broken: boolean }
export type FortressDamageMarkKind = 'bullet' | 'scorch' | 'scratch'
/** 主体层永久战损贴花：坐标为堡垒局部格，角度由事件 id 的黄金角稳定派生。 */
export interface FortressDamageMark { id: number; kind: FortressDamageMarkKind; x: number; y: number; size: number; angle: number }
/** 未被护盾完全吸收的船体受击瞬时事件：驱动火花，贴花本身存于 fortress.damageMarks。 */
export interface FortressHitFx { id: number; x: number; y: number; ttl: number; max: number; penetrated: boolean; ricochet: boolean; ricochetDx: number; ricochetDy: number }

export interface GameState {
  phase: Phase
  time: number
  gold: number
  ammo: number
  energy: number
  wave: number
  prepLeft: number
  /** 波次不等待时，从本波最后一名敌人登场到下波开始的倒计时；null=尚未开始。 */
  nextWaveLeft: number | null
  /** 当前目标累计交战时间（仅 combat 推进；生存目标据此判胜）。 */
  objectiveElapsed: number
  objective: LevelObjective
  /** 移动堡垒：连续坐标（格）左上角 + 船体耐久（取代旧核心血量；归零判负） */
  fortress: { x: number; y: number; hp: number; maxHp: number; armor: FortressArmor; maxArmor: FortressArmor; shield: number; maxShield: number; shieldBroken: boolean; shieldLastHitAt: number; hitFlash: number; damageMarks: FortressDamageMark[]; damageMarkLastAt: number; damageFxLastAt: number; heat: number; overheated: boolean; heading: number; vx: number; vy: number; leanX: number; leanY: number; leanRbT: number; leanRbX: number; leanRbY: number; leanVX: number; leanVY: number; turnW: number; trackPhase: number[]; steerAngle: number; dyingT: number } // armor/maxArmor=四向当前/上限；护盾由模块动态提供；damageMarks=主体局部永久战损；heading=船头朝向（0=朝上，顺时针为正）
  fortressDefId: string
  /** 移动输入（UI 直接写入 gameRef.current.moveDir；tick 消费并随状态克隆延续） */
  moveDir: { x: number; y: number }
  /** 推进幅度 0..1（摇杆模拟量：速度上限 = 最大速度 × moveMag；键盘恒 1） */
  moveMag: number
  /** 转向输入：-1 左转（Q），+1 右转（E），0 不转 */
  turnDir: number
  /** 摇杆目标朝向（弧度，0=朝上顺时针为正；null=无摇杆转向指令）。摇杆推出时由 UI 写入，引擎按转向速率追踪，到位即停 */
  desiredHeading: number | null
  /** 倒退模式（摇杆推向水平以下）：沿船头反方向行驶，最大速度/加速度 × 倒退系数，不改变朝向 */
  reverse: boolean
  /** 堡垒中心所在格（跨格时 pathVersion++ 触发全场重寻路） */
  fortCellX: number
  fortCellY: number
  walls: WallSeg[]
  turrets: Turret[]
  modules: ModuleInst[] // 要塞内部模块（背包式摆放；提供资源回复/上限/散热加成）
  allies: Ally[] // 生产模块产出的友军单位
  buildings: FixedBuilding[]
  objects: BattleObject[]
  enemies: Enemy[]
  projectiles: Projectile[]
  enemyProjectiles: EnemyProjectile[]
  burnZones: BurnZone[]
  explosions: ExplosionFx[]
  tracers: Tracer[]
  muzzles: MuzzleEvent[] // 炮口事件（后坐/火光表现层驱动）
  beamFades: BeamFade[] // 光束停火消退动画
  impacts: ImpactFx[] // 非爆炸命中特效（§3A）
  shieldHits: ShieldHitFx[] // 护盾受击涟漪/破盾事件
  fortressHits: FortressHitFx[] // 船体受击火花事件（护盾完全吸收时不生成）
  floats: FloatText[]
  spawnQueue: { kind: EnemyKind; delay: number }[]
  spawnTimer: number
  triggerStates: TriggerRuntime[]
  ambushQueue: AmbushSpawn[]
  eventQueue: EventSequenceRuntime[]
  interactableStates: InteractableRuntime[]
  notices: LevelNotice[]
  kills: number
  pathVersion: number // 结构变化即 +1，触发敌人重寻路
  nextId: number
}

// ---------- 角度工具 ----------
const TAU = Math.PI * 2
const DEG = Math.PI / 180
export function wrapAngle(a: number): number {
  let r = a % TAU
  if (r > Math.PI) r -= TAU
  if (r < -Math.PI) r += TAU
  return r
}
/** 指向角：0 = -Y（屏幕上方），顺时针为正 */
export function bearing(dx: number, dy: number): number {
  return Math.atan2(dx, -dy)
}
export function dirX(a: number): number { return Math.sin(a) }
export function dirY(a: number): number { return -Math.cos(a) }

/** 事件 id 派生的确定性随机数。同一状态与输入必得同一结果，不依赖进程级 Math.random。 */
export function eventRandom(eventId: number, stream = 0): number {
  let x = (eventId ^ Math.imul(stream + 1, 0x9e3779b9)) >>> 0
  x ^= x >>> 16
  x = Math.imul(x, 0x7feb352d)
  x ^= x >>> 15
  x = Math.imul(x, 0x846ca68b)
  x ^= x >>> 16
  return (x >>> 0) / 4294967296
}

export function defOf(defId: string): TurretDef {
  const d = TURRET_DEFS.find(d => d.id === defId)
  if (!d) throw new Error(`unknown turret def ${defId}`)
  return d
}

export function turretCenter(t: Turret): { x: number; y: number } {
  return { x: t.x + t.w / 2, y: t.y + t.h / 2 }
}

// ---------- 初始状态（防御墙由基地格派生：syncDerivedWalls） ----------

export function initialState(): GameState {
  // 出战堡垒：堡垒编辑器「设为出战」的选择（localStorage），缺省内置标准型
  const fdef = FORTRESS_DEFS.find(f => f.id === getSelectedFortressId()) ?? DEFAULT_FORTRESS
  const spawnX = LEVEL.mode === 'advance'
    ? Math.max(0, Math.min(LEVEL.cols - fdef.w, LEVEL.startZone.x + (LEVEL.startZone.w - fdef.w) / 2))
    : (LEVEL.cols - fdef.w) / 2
  const spawnY = LEVEL.mode === 'advance'
    ? Math.max(0, Math.min(LEVEL.rows - fdef.h, LEVEL.startZone.y + (LEVEL.startZone.h - fdef.h) / 2))
    : LEVEL.rows - fdef.h - 1
  // 从可变关卡配置 LEVEL 构建（战场编辑器可改；墙布局固定由 buildTemplateWalls 生成）
  const initialArmor: FortressArmor = { front: fdef.armor?.front ?? 0, rear: fdef.armor?.rear ?? 0, left: fdef.armor?.left ?? 0, right: fdef.armor?.right ?? 0 }
  const noWaveWait = LEVEL.objective.type === 'defend' && LEVEL.objective.waveWait === false
  const s: GameState = {
    phase: LEVEL.mode === 'advance' || noWaveWait ? 'combat' : 'prep',
    time: 0,
    gold: START_GOLD,
    ammo: AMMO.start,
    energy: ENERGY.start,
    wave: 1,
    prepLeft: LEVEL.mode === 'advance' || noWaveWait ? 0 : LEVEL.objective.type === 'defend' ? (LEVEL.objective.restTime ?? DEFEND_REST_TIME_DEFAULT) : PREP_TIME,
    nextWaveLeft: null,
    objectiveElapsed: 0,
    objective: structuredClone(LEVEL.objective),
    fortress: {
      x: spawnX,
      y: spawnY,
      hp: fdef.hp,
      maxHp: fdef.hp,
      armor: structuredClone(initialArmor), maxArmor: structuredClone(initialArmor),
      shield: 0, maxShield: 0, shieldBroken: false, shieldLastHitAt: -1e9,
      hitFlash: 0, damageMarks: [], damageMarkLastAt: -1e9, damageFxLastAt: -1e9,
      heat: 0, overheated: false,
      heading: 0, // 初始船头朝上
      vx: 0, vy: 0, // 初始静止
      leanX: 0, leanY: 0, leanRbT: -1, leanRbX: 0, leanRbY: 0, leanVX: 0, leanVY: 0, // 刹停前倾位移初始为零；回弹未激活（v1.91）；角速度零（v1.92）
      trackPhase: [], // 履带相位初始为零（首个移动 tick 按 def.tracks 数量对齐）
      turnW: 0, // 转向角速度初始为零（v1.56 松手过渡）
      steerAngle: 0, // v2.51 轮式底盘：当前前轮转角（rad，左负右正）
      dyingT: -1, // v2.53 毁灭序列计时：-1=存活
    },
    fortressDefId: fdef.id,
    moveDir: { x: 0, y: 0 },
    moveMag: 1,
    turnDir: 0,
    desiredHeading: null,
    reverse: false,
    fortCellX: Math.floor(spawnX + fdef.w / 2),
    fortCellY: Math.floor(spawnY + fdef.h / 2),
    walls: [], // 玩家侧墙体退役（移动堡垒无墙圈）；墙系统保留供未来敌方要塞使用
    turrets: [],
    modules: [], // 要塞内部模块（初始空，备战期建造）
    allies: [],
    buildings: [], // 玩家侧固定建筑退役（保留类型供未来敌方要塞使用）
    objects: LEVEL.objects.map((o, i): BattleObject => ({ ...o, id: 2000 + i, maxHp: o.hp })),
    enemies: [],
    projectiles: [],
    enemyProjectiles: [],
    burnZones: [],
    explosions: [],
    tracers: [],
    muzzles: [],
    beamFades: [],
    impacts: [],
    shieldHits: [],
    fortressHits: [],
    floats: [],
    spawnQueue: LEVEL.mode === 'advance' || noWaveWait ? buildWave(1).map(it => ({ ...it })) : [],
    spawnTimer: LEVEL.mode === 'advance' || noWaveWait ? 0.5 : 0,
    triggerStates: LEVEL.triggers.map(t => ({ id: t.id, inside: false, activations: 0, cooldown: 0 })),
    ambushQueue: [],
    eventQueue: [],
    interactableStates: LEVEL.interactables.map(t => ({ id: t.id, inside: false, activations: 0, enabled: t.enabled })),
    notices: [],
    kills: 0,
    pathVersion: 0,
    nextId: 1,
  }
  // 内置隐藏炮位：预装内置武器（免费、不可拆除）
  for (const hp of fdef.hardpoints) {
    if (!hp.builtIn) continue
    const def = TURRET_DEFS.find(d => d.id === hp.builtIn)
    if (!def) {
      console.warn(`[fortress] 内置武器定义不存在：${hp.builtIn}，已跳过`)
      continue
    }
    s.turrets.push({
      id: s.nextId++, defId: def.id,
      x: s.fortress.x + hp.x - def.w / 2, y: s.fortress.y + hp.y - def.h / 2, // heading=0 时即旋转坐标
      w: def.w, h: def.h, level: 1,
      hp: def.hp, maxHp: def.hp, angle: 0, cooldown: 0, burstLeft: 0, burstTimer: 0,
      rackLeft: def.type === 'missile' ? Math.max(1, def.burst ?? 1) : 0,
      rackAnim: 0,
      rackTimer: 0,
      chargeLeft: 0, firing: false, firingLeft: 0, tickTimer: 0,
      targetId: null, barrelIdx: 0,
      hardpointId: hp.id, builtIn: true,
    })
  }
  return s
}

// ---------- 移动堡垒（挂点/移动/挂载炮塔） ----------

export function fortressDef(s: GameState): FortressDef {
  return FORTRESS_DEFS.find(f => f.id === s.fortressDefId) ?? DEFAULT_FORTRESS
}

// ---- 自由网格形状：shape = 局部格坐标列表 "x,y"（须 4-连通，允许镂空）；缺省 = w×h 满矩形 ----
const shapeSetCache = new WeakMap<FortressDef, Set<string>>()

/** 堡垒形状格集合（局部坐标 "x,y"；带 WeakMap 缓存，编辑器 draft 每次新对象自动重算） */
export function fortressShapeSet(d: FortressDef): Set<string> {
  let set = shapeSetCache.get(d)
  if (set) return set
  set = new Set<string>()
  if (d.shape && d.shape.length > 0) {
    for (const k of d.shape) set.add(k)
  } else {
    for (let x = 0; x < d.w; x++) for (let y = 0; y < d.h; y++) set.add(`${x},${y}`)
  }
  shapeSetCache.set(d, set)
  return set
}

/** 内部模块空间格集合（局部坐标 "x,y"；interiorCells 自由格阵优先，缺省 = cols×rows 满矩形；WeakMap 缓存） */
const interiorSetCache = new WeakMap<FortressDef, Set<string>>()
export function fortressInteriorSet(d: FortressDef): Set<string> {
  let set = interiorSetCache.get(d)
  if (set) return set
  set = new Set<string>()
  if (d.interiorCells && d.interiorCells.length > 0) {
    for (const k of d.interiorCells) set.add(k)
  } else {
    for (let x = 0; x < d.interior.cols; x++) for (let y = 0; y < d.interior.rows; y++) set.add(`${x},${y}`)
  }
  interiorSetCache.set(d, set)
  return set
}

/** 堡垒定义校验（编辑器保存/导入闸）：返回错误列表，空数组 = 通过 */
export function validateFortressDef(d: FortressDef): string[] {
  const errs: string[] = []
  if (!(d.hp >= 500 && d.hp <= 20000)) errs.push('耐久需在 500~20000')
  if (d.armor && Object.entries(d.armor).some(([, v]) => !Number.isFinite(v) || v < 0 || v > 10000)) errs.push('四向装甲需在 0~10000')
  if (d.paint && !/^#[0-9a-f]{6}$/i.test(d.paint.base)) errs.push('涂装主体色须为 #RRGGBB')
  if (d.paint?.accent && !/^#[0-9a-f]{6}$/i.test(d.paint.accent)) errs.push('涂装强调色须为 #RRGGBB')
  for (const decal of d.decals ?? []) {
    if (!decal.asset) errs.push(`徽记 ${decal.id} 缺少素材`)
    if (![decal.x, decal.y, decal.size, decal.angle ?? 0].every(Number.isFinite) || decal.size <= 0) errs.push(`徽记 ${decal.id} 坐标/尺寸/角度非法`)
    if (decal.x < 0 || decal.x > d.w || decal.y < 0 || decal.y > d.h) errs.push(`徽记 ${decal.id} 锚点超出堡垒包围盒`)
  }
  if (!(d.speed >= 0.2 && d.speed <= 6)) errs.push('移动速度需在 0.2~6 格/s')
  if (!(d.turnSpeed >= 15 && d.turnSpeed <= 240)) errs.push('转向速度需在 15~240 度/s')
  if (d.turnRadius !== undefined && !(d.turnRadius >= 0 && d.turnRadius <= 20)) errs.push('转向半径需在 0~20 格（0=按底盘物理）')
  // v2.51 底盘参数校验
  if (d.chassis !== undefined && d.chassis !== 'tracked' && d.chassis !== 'wheeled') errs.push('底盘类型仅支持 tracked(履带)/wheeled(轮式)')
  if (d.trackWidth !== undefined && !(d.trackWidth > 0 && d.trackWidth <= 20)) errs.push('履带间距需在 0~20 格')
  if (d.turnDrag !== undefined && !(d.turnDrag >= 0 && d.turnDrag <= 0.9)) errs.push('转向阻力需在 0~0.9')
  if (d.wheelbase !== undefined && !(d.wheelbase > 0 && d.wheelbase <= 30)) errs.push('轴距需在 0~30 格')
  if (d.steerMax !== undefined && !(d.steerMax > 0 && d.steerMax <= 80)) errs.push('最大前轮转角需在 0~80°')
  if (d.steerRate !== undefined && !(d.steerRate > 0 && d.steerRate <= 720)) errs.push('方向盘转速需在 0~720°/s')
  if (d.gripMax !== undefined && !(d.gripMax > 0 && d.gripMax <= 100)) errs.push('横向附着上限需在 0~100 m/s²')
  for (const w of d.wheels ?? []) {
    if (![w.x, w.y].every(Number.isFinite)) errs.push(`轮子 ${w.id} 坐标须为数值`)
    if (w.unit !== undefined && w.unit !== 'single' && w.unit !== 'pair') errs.push(`轮子 ${w.id} 单位仅支持 single(个)/pair(对)`)
  }
  if (d.reverseFactor !== undefined && !(d.reverseFactor >= 0 && d.reverseFactor <= 1)) errs.push('倒退系数需在 0~1（如 0.8 = 倒退极速/加速度为前进的 80%）')
  if (d.brakeInertia !== undefined && !(d.brakeInertia >= 1 && d.brakeInertia <= 10)) errs.push('刹停惯性需在 1~10（1=3×加速度急停，5=同加速度，10=1/5 加速度滑行）')
  if (d.pitchGain !== undefined && !(d.pitchGain >= 0 && d.pitchGain <= 10)) errs.push('车身俯仰需在 0~10（0=关闭俯仰效果）')
  if (d.leanCap !== undefined && !(d.leanCap >= 1 && d.leanCap <= 8)) errs.push('俯仰位移需在 1~8 px（目标倾角上限；缺省 4）') // v1.93
  if (d.tracks) for (const t of d.tracks) { // v1.85 履带参数校验
    if (![t.x1, t.y1, t.x2, t.y2].every(Number.isFinite)) errs.push(`履带 ${t.id} 轮心坐标须为数值`)
    if (!(t.radius > 0 && t.radius <= 2)) errs.push(`履带 ${t.id} 轮半径需在 0~2 格`)
    if (!(Number.isFinite(t.overlapPx ?? 2) && (t.overlapPx ?? 2) >= 0 && (t.overlapPx ?? 2) <= 30)) errs.push(`履带 ${t.id} 重叠需在 0~30 pix`)
    if (Math.hypot(t.x2 - t.x1, t.y2 - t.y1) <= 0.01) errs.push(`履带 ${t.id} 前后轮心不能重合`)
    if (!t.tile) errs.push(`履带 ${t.id} 缺少瓦片素材`)
  }
  if (!(d.accel >= 0.5 && d.accel <= 20)) errs.push('加速度需在 0.5~20 格/s²')
  if (!(d.heatCap >= 50 && d.heatCap <= 2000)) errs.push('热量上限需在 50~2000')
  if (!(d.heatDissipation >= 1 && d.heatDissipation <= 100)) errs.push('自然散热需在 1~100 点/s')
  // 炮位类型限制：全不勾 = 不支持任何炮塔（保存前须修复）
  for (const hp of d.hardpoints) {
    if (hp.types && hp.types.length === 0) errs.push(`炮位 ${hp.id} 类型限制全不勾：不支持任何炮塔`)
    if (hp.zLevel !== undefined && !Number.isFinite(hp.zLevel)) errs.push(`炮位 ${hp.id} 层级须为数值`) // v1.82
    if (hp.fixed !== undefined && !(Number.isFinite(hp.fixed) && hp.fixed >= -180 && hp.fixed <= 180)) errs.push(`炮位 ${hp.id} 固定视角需在 -180~180°（上方 0°，逆负顺正）`) // v1.98
  }
  const raw = d.shape ?? []
  const cells: [number, number][] = []
  let coordBad = false
  for (const k of raw) {
    const [x, y] = k.split(',').map(Number)
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0) { coordBad = true; break }
    cells.push([x, y])
  }
  if (!d.shape) {
    // 缺省满矩形 w×h（内置堡垒无显式形状）：只校验 w/h 与内部空间/炮位界内
    if (!(Number.isInteger(d.w) && Number.isInteger(d.h) && d.w >= 1 && d.h >= 1 && d.w <= 30 && d.h <= 18)) errs.push('包围盒 w/h 非法（1~30 / 1~18 整数）')
    for (const k of fortressInteriorSet(d)) {
      const [ix, iy] = k.split(',').map(Number)
      if (ix >= d.w || iy >= d.h) { errs.push('内部空间超出包围盒'); break }
    }
    for (const hp of d.hardpoints) {
      if (!(hp.x >= 0 && hp.x < d.w && hp.y >= 0 && hp.y < d.h)) errs.push(`炮位 ${hp.id} 不在包围盒内`)
    }
  } else if (raw.length === 0) errs.push('形状网格为空：至少铺设 1 格')
  else if (coordBad) errs.push('形状格坐标非法')
  else {
    const seen = new Set<string>()
    let maxX = 0
    let maxY = 0
    let dup = false
    for (const [x, y] of cells) {
      if (seen.has(`${x},${y}`)) { dup = true; break }
      seen.add(`${x},${y}`)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
    if (dup) errs.push('形状格坐标重复')
    else {
      if (maxX + 1 !== d.w || maxY + 1 !== d.h) errs.push(`w/h 应为形状包围盒 ${maxX + 1}×${maxY + 1}（当前 ${d.w}×${d.h}）`)
      // 4-连通：实心格须连通成整体（镂空空格不计）
      const q: [number, number][] = [cells[0]]
      const vis = new Set<string>([`${cells[0][0]},${cells[0][1]}`])
      while (q.length) {
        const [cx, cy] = q.pop()!
        for (const [nx, ny] of [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]] as [number, number][]) {
          const kk = `${nx},${ny}`
          if (seen.has(kk) && !vis.has(kk)) { vis.add(kk); q.push([nx, ny]) }
        }
      }
      if (vis.size !== cells.length) errs.push(`形状网格未连通成整体（${vis.size}/${cells.length} 格可达）`)
      // 内部空间逐格 ⊆ 形状格（自由格阵或 cols×rows 矩形）
      for (const k of fortressInteriorSet(d)) {
        if (!seen.has(k)) { errs.push(`内部空间 (${k}) 超出形状网格`); break }
      }
    }
  }
  // 炮位：锚点须落在形状格内
  if (d.shape) {
    for (const hp of d.hardpoints) {
      if (!fortressShapeSet(d).has(`${Math.floor(hp.x)},${Math.floor(hp.y)}`)) errs.push(`炮位 ${hp.id} 不在形状网格内`)
    }
  }
  // 特殊格：须在内部空间格集合内且不重复
  const spSeen = new Set<string>()
  const iSet = fortressInteriorSet(d)
  for (const c of d.interiorSpecials ?? []) {
    if (!iSet.has(`${c.x},${c.y}`)) errs.push(`特殊格 (${c.x},${c.y}) 超出内部空间`)
    const kk = `${c.x},${c.y}`
    if (spSeen.has(kk)) errs.push(`特殊格 (${c.x},${c.y}) 重复配置`)
    spSeen.add(kk)
  }
  // 特效点：须在包围盒内（允许在形状格外 = 镂空/边缘特效，但不出包围盒）
  const fxSeen = new Set<string>()
  for (const fx of d.effects ?? []) {
    if (!(fx.x >= 0 && fx.x <= d.w && fx.y >= 0 && fx.y <= d.h)) errs.push(`特效点 ${fx.id} 超出包围盒`)
    if (fxSeen.has(fx.id)) errs.push(`特效点 id ${fx.id} 重复`)
    fxSeen.add(fx.id)
    // v2.40 粒子化参数范围（缺省走 kind 默认，配置才校验）
    if (fx.rate !== undefined && (!(fx.rate > 0) || fx.rate > 120)) errs.push(`特效点 ${fx.id} rate 须为 0~120 粒/s`)
    if (fx.life !== undefined && (!(fx.life > 0) || fx.life > 10)) errs.push(`特效点 ${fx.id} life 须为 0~10 秒`)
    if (fx.size !== undefined && (!(fx.size > 0) || fx.size > 2)) errs.push(`特效点 ${fx.id} size 须为 0~2 格`)
    if (fx.inherit !== undefined && (fx.inherit < 0 || fx.inherit > 1)) errs.push(`特效点 ${fx.id} inherit 须为 0~1`)
  }
  return errs
}

/** 堡垒占地矩形（连续坐标，单位格） */
export function fortressRect(s: GameState): { x: number; y: number; w: number; h: number } {
  const d = fortressDef(s)
  return { x: s.fortress.x, y: s.fortress.y, w: d.w, h: d.h }
}

export function fortressCenter(s: GameState): { x: number; y: number } {
  const r = fortressRect(s)
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 }
}

/** 推进目标：堡垒中心进入终点区域即完成，矩形边界计入区域。 */
export function fortressReachedFinish(s: GameState): boolean {
  const c = fortressCenter(s)
  const z = LEVEL.finishZone
  return c.x >= z.x && c.x <= z.x + z.w && c.y >= z.y && c.y <= z.y + z.h
}

/** 船体血量上限 = 堡垒基础 + 模块加成 */
export function fortressMaxHp(s: GameState): number {
  return fortressDef(s).hp + moduleBonuses(s).hpBoostPool
}

/** 移动速度 格/s = 堡垒基础 + 模块加成（下限 0.2） */
export function fortressSpeed(s: GameState): number {
  return Math.max(0.2, fortressDef(s).speed + moduleBonuses(s).speedBoostPool)
}

/** 转向速度 度/s = 堡垒基础 + 模块加成（下限 10） */
export function fortressTurnSpeed(s: GameState): number {
  return Math.max(10, fortressDef(s).turnSpeed + moduleBonuses(s).turnBoostPool)
}

/** 最小转弯半径（格，缺省 0 = 原地转向）；>0 时转向 = 绕外侧圆心弧线行驶，转弯带动前行 */
export function fortressTurnRadius(s: GameState): number {
  return Math.max(0, fortressDef(s).turnRadius ?? 0)
}

/** 可旋转轮胎的视觉偏角：优先使用配置的弧线半径，否则由实际曲率 ω/v 反推；不转弯时归零。 */
export function wheelVisualSteerAngle(s: GameState, fd: FortressDef = fortressDef(s)): number {
  const f = s.fortress
  if (Math.abs(f.turnW) < 1e-6) return 0
  const vLon = f.vx * dirX(f.heading) + f.vy * dirY(f.heading)
  const configuredRadius = Math.max(0, fd.turnRadius ?? 0)
  if (configuredRadius <= 0 && Math.abs(vLon) < 1e-6) return 0
  const radius = configuredRadius > 0 ? configuredRadius : Math.abs(vLon / f.turnW)
  const curvatureSign = Math.abs(vLon) > 1e-6 ? Math.sign(f.turnW / vLon) : Math.sign(f.turnW) * (s.reverse ? -1 : 1)
  const wheelbase = Math.max(0.5, fd.wheelbase ?? fd.h * 0.6)
  const maxAngle = Math.max(1, Math.min(80, fd.steerMax ?? 35)) * Math.PI / 180
  return Math.max(-maxAngle, Math.min(maxAngle, Math.atan(wheelbase / Math.max(1e-6, radius)) * curvatureSign))
}

/** 落印/滚动相位列（统一数据源）：履带（左定义列 + 右镜像列）在前，轮胎按“个/对”展开在后。
 *  相位推进公式统一：dphase = (纵向速度 − turnW × 横向偏移) × dt（倒退/差速/原地转向天然正确） */
export interface MarkColumn { x1: number; y1: number; x2: number; y2: number; mirror: boolean; tile: string; overlapPx: number; steered?: boolean }
export interface WheelPlacement { x: number; y: number; mirror: boolean }
/** 轮胎放置展开：旧配置缺省为单个；pair 复用履带的定义侧 + 中心线镜像语义。 */
export function wheelPlacements(fd: FortressDef, wheel: WheelDef): WheelPlacement[] {
  const one = { x: wheel.x, y: wheel.y, mirror: false }
  return wheel.unit === 'pair' ? [one, { x: fd.w - wheel.x, y: wheel.y, mirror: true }] : [one]
}
export function fortressMarkColumns(fd: FortressDef): MarkColumn[] {
  const cols: MarkColumn[] = []
  for (const t of fd.tracks ?? []) {
    cols.push({ x1: t.x1, y1: t.y1, x2: t.x2, y2: t.y2, mirror: false, tile: t.tile, overlapPx: t.overlapPx })
    cols.push({ x1: t.x1, y1: t.y1, x2: t.x2, y2: t.y2, mirror: true, tile: t.tile, overlapPx: t.overlapPx })
  }
  for (const w of fd.wheels ?? []) { // 轮子 = 退化列（段长 0，落印取轮心点）；pair 展开为左右两列
    for (const p of wheelPlacements(fd, w)) cols.push({ x1: p.x, y1: p.y, x2: p.x, y2: p.y, mirror: false, tile: w.sprite ?? 'builtin:library/track01', overlapPx: 0, steered: w.steered })
  }
  return cols
}

/** 倒退系数（缺省 0.8，钳制 0~1）：倒退最大速度/加速度 = 前进 × 系数 */
export function fortressReverseFactor(s: GameState): number {
  return Math.max(0, Math.min(1, fortressDef(s).reverseFactor ?? 0.8))
}

/** 刹停惯性（1~10，缺省 5）→ 减速度倍率：1 = 3×加速度（急停），5 = 1×（与加速度相同），10 = 1/5×（长滑行） */
export function brakeDecelMult(d: FortressDef): number {
  const i = Math.max(1, Math.min(10, d.brakeInertia ?? 5))
  return i <= 5 ? 3 - (i - 1) / 2 : 1 - (i - 5) * 0.16
}

// ---- v1.85 履带瓦片循环：纯函数排布计算（sim 可测；render 逐枚 drawImage） ----
export interface TrackTilePlacement { x: number; y: number; scaleY: number; alpha: number } // 堡垒局部格坐标；scaleY=长度轴压缩；alpha=翻滚渐暗
/** 履带瓦片排布：直线段全尺寸；头尾轮半径区间为透视缩短翻滚区（位置 R·sinθ 投影、长度 ×cosθ、渐暗 1−0.45sinθ、端点消失）。
 *  phase（格，引擎按真实位移累加）>0 = 前进 → 瓦片向船尾流动；<0 = 倒退反滚。步长 = tileLen − overlap。
 *  v1.89：翻滚区改弧长参数化（s 沿真实履带路径，四分之一圆弧长 = R·π/2）——旧线性 θ 参数化在直线↔翻滚交界处
 *  把投影间距拉大 π/2 倍而瓦片仍近全尺寸，头尾轮处出现明显缝隙；弧长参数化后全程等间距，重叠量全程保持。 */
export function trackPlacements(t: TrackDef, phase: number, tileLen: number): TrackTilePlacement[] { // v1.87：tileLen = 瓦片原图高（格，=图高px/30），由调用方从素材读取
  const step = Math.max(0.01, tileLen - (t.overlapPx ?? 2) / BASE_CELL)
  const dx = t.x2 - t.x1, dy = t.y2 - t.y1
  const Lc = Math.hypot(dx, dy)
  if (Lc <= 0.01 || t.radius <= 0 || tileLen <= 0) return []
  const ux = dx / Lc, uy = dy / Lc // 船头 → 船尾方向
  const R = t.radius
  const arc89 = R * Math.PI / 2 // v1.89：四分之一轮缘弧长（格），翻滚区路径范围 = [-arc, Lc+arc]
  const off = ((phase % step) + step) % step // [0, step)
  const out: TrackTilePlacement[] = []
  for (let s = -arc89 + off; s <= Lc + arc89; s += step) { // v1.89：s = 沿履带路径的弧长坐标（等间距 step）
    let x: number, y: number, scaleY = 1, alpha = 1
    if (s < 0) { // 前翻滚区：瓦片从船头轮下翻出（θ: 90°→0，θ = 弧长/R）
      const th = -s / R
      const d = -R * Math.sin(th)
      x = t.x1 + ux * d; y = t.y1 + uy * d
      scaleY = Math.cos(th); alpha = 1 - 0.45 * Math.sin(th)
    } else if (s > Lc) { // 后翻滚区：瓦片向船尾轮下翻没（θ: 0→90°，θ = 弧长/R）
      const th = Math.min((s - Lc) / R, Math.PI / 2)
      const d = Lc + R * Math.sin(th)
      x = t.x1 + ux * d; y = t.y1 + uy * d
      scaleY = Math.cos(th); alpha = 1 - 0.45 * Math.sin(th)
    } else { // 直线段
      x = t.x1 + ux * s; y = t.y1 + uy * s
    }
    if (scaleY < 0.05) continue // 端点压成线 = 翻到底面，不画
    out.push({ x, y, scaleY, alpha })
  }
  return out
}

/** 角度归一化到 [0,360) */
function norm360(d: number): number { return ((d % 360) + 360) % 360 }

/** 炮位视界包含判定：relRad 为相对船头的方位角（弧度，顺时针为正）；arc 支持跨 0° */
export function hardpointArcContains(arc: { start: number; end: number }, relRad: number): boolean {
  const r = norm360(relRad / DEG)
  const s0 = norm360(arc.start)
  const e0 = norm360(arc.end)
  return s0 <= e0 ? (r >= s0 && r <= e0) : (r >= s0 || r <= e0)
}

/** 炮位视界中点（相对船头，弧度）：无目标回中方向 */
export function hardpointArcMid(arc: { start: number; end: number }): number {
  const s0 = norm360(arc.start)
  const e0 = norm360(arc.end)
  const mid = s0 <= e0 ? (s0 + e0) / 2 : norm360((s0 + e0 + 360) / 2)
  return mid * DEG
}

/** 把相对船头的方位角钳制进视界区间（取最近边界） */
export function clampToHardpointArc(arc: { start: number; end: number }, relRad: number): number {
  if (hardpointArcContains(arc, relRad)) return relRad
  const cands = [norm360(arc.start) * DEG, norm360(arc.end) * DEG]
  let best = cands[0]
  let bestD = Math.abs(wrapAngle(cands[0] - relRad))
  for (const c of cands) {
    const d = Math.abs(wrapAngle(c - relRad))
    if (d < bestD) { bestD = d; best = c }
  }
  return wrapAngle(best)
}

/** 堡垒局部坐标（相对左上角，格）→ 世界坐标（绕底座中心按 heading 旋转） */
export function fortressLocalToWorld(s: GameState, lx: number, ly: number): { x: number; y: number } {
  const d = fortressDef(s)
  const c = fortressCenter(s)
  const ox = lx - d.w / 2
  const oy = ly - d.h / 2
  const cosA = Math.cos(s.fortress.heading)
  const sinA = Math.sin(s.fortress.heading)
  return { x: c.x + ox * cosA - oy * sinA, y: c.y + ox * sinA + oy * cosA }
}

/** 世界坐标 → 堡垒局部坐标（相对左上角，格；旋转逆变换） */
export function worldToFortressLocal(s: GameState, wx: number, wy: number): { x: number; y: number } {
  const d = fortressDef(s)
  const c = fortressCenter(s)
  const dx = wx - c.x
  const dy = wy - c.y
  const cosA = Math.cos(s.fortress.heading)
  const sinA = Math.sin(s.fortress.heading)
  return { x: dx * cosA + dy * sinA + d.w / 2, y: -dx * sinA + dy * cosA + d.h / 2 }
}

/** 炮位世界坐标（随堡垒 heading 旋转） */
export function hardpointWorldPos(s: GameState, hp: Hardpoint): { x: number; y: number } {
  return fortressLocalToWorld(s, hp.x, hp.y)
}

/** 堡垒形状格覆盖的整数格（自由网格逐格映射；寻路目标格 / blockerAt 判定共用） */
export function fortressCells(s: GameState): Cell[] {
  const d = fortressDef(s)
  const bx = Math.floor(s.fortress.x)
  const by = Math.floor(s.fortress.y)
  const cells: Cell[] = []
  for (const k of fortressShapeSet(d)) {
    const [cx, cy] = k.split(',')
    const x = bx + Number(cx)
    const y = by + Number(cy)
    if (x >= 0 && x < LEVEL.cols && y >= 0 && y < LEVEL.rows) cells.push({ x, y })
  }
  return cells
}

export function hardpointOf(s: GameState, id: string): Hardpoint | undefined {
  return fortressDef(s).hardpoints.find(h => h.id === id)
}

/** 挂载炮塔世界坐标跟随堡垒（每 tick 同步；索敌/弹道/渲染经 turretCenter 无需改动） */
export function syncTurretMounts(s: GameState) {
  for (const t of s.turrets) {
    if (!t.hardpointId) continue
    const hp = hardpointOf(s, t.hardpointId)
    if (!hp) continue
    const p = hardpointWorldPos(s, hp)
    t.x = p.x - t.w / 2
    t.y = p.y - t.h / 2
  }
}

/** 挂炮校验：炮位存在/非内置隐藏/尺寸匹配/未被占用/金币足够（仅备战期建造） */
export function canMountTurret(s: GameState, defId: string, hardpointId: string): { ok: boolean; reason?: string } {
  const def = TURRET_DEFS.find(d => d.id === defId)
  if (!def) return { ok: false, reason: '未知炮塔' }
  const hp = hardpointOf(s, hardpointId)
  if (!hp) return { ok: false, reason: '炮位不存在' }
  if (hp.hidden) return { ok: false, reason: '内置炮位' }
  if (def.mount !== hp.size) return { ok: false, reason: `需要 ${hp.size} 型炮位` }
  if (hp.types && !hp.types.includes(def.type)) return { ok: false, reason: '炮位不兼容该炮塔类型' }
  if (s.turrets.some(t => t.hardpointId === hardpointId)) return { ok: false, reason: '炮位已占用' }
  if (s.gold < def.cost) return { ok: false, reason: '废料不足' }
  return { ok: true }
}

/** 挂炮（仅备战期）：扣金币，炮塔挂载到指定炮位（世界坐标立即就位） */
export function mountTurret(s: GameState, defId: string, hardpointId: string): GameState {
  if (s.phase !== 'prep') return s
  if (!canMountTurret(s, defId, hardpointId).ok) return s
  const def = defOf(defId)
  const hp = hardpointOf(s, hardpointId)!
  const n = clone(s)
  n.gold -= def.cost
  n.turrets.push({
    id: n.nextId++, defId,
    x: hardpointWorldPos(n, hp).x - def.w / 2, y: hardpointWorldPos(n, hp).y - def.h / 2,
    w: def.w, h: def.h, level: 1,
    hp: def.hp, maxHp: def.hp, angle: wrapAngle(n.fortress.heading + (hp.fixed !== undefined ? hp.fixed * DEG : hp.arc ? hardpointArcMid(hp.arc) : 0)), cooldown: 0, burstLeft: 0, burstTimer: 0, // v1.99：挂载初始朝向按炮位视角——全视角=0° / 指定视角=视界中心 / 固定视角=固定角（旋转速度为 0 的炮塔也能一步到位）
    rackLeft: def.type === 'missile' ? Math.max(1, def.burst ?? 1) : 0,
    rackAnim: 0,
    rackTimer: 0,
    chargeLeft: 0, firing: false, firingLeft: 0, tickTimer: 0,
    targetId: null, barrelIdx: 0,
    hardpointId,
  })
  return n
}

/** 卸下炮塔（仅备战期，返半价；内置武器不可拆） */
export function unmountTurret(s: GameState, turretId: number): GameState {
  if (s.phase !== 'prep') return s
  const t = s.turrets.find(t => t.id === turretId)
  if (!t || t.builtIn) return s
  const n = clone(s)
  n.gold += Math.floor(defOf(t.defId).cost / 2)
  n.turrets = n.turrets.filter(x => x.id !== turretId)
  return n
}

/** 堡垒单轴位移：边界钳制（包围盒）+ 形状格逐格碰撞（撞停该轴，另一轴可继续 = 贴墙滑动；镂空格可越过障碍） */
function moveFortressAxis(s: GameState, dx: number, dy: number) {
  if (dx === 0 && dy === 0) return
  const d = fortressDef(s)
  const nx = Math.max(0, Math.min(LEVEL.cols - d.w, s.fortress.x + dx))
  const ny = Math.max(0, Math.min(LEVEL.rows - d.h, s.fortress.y + dy))
  const shape = fortressShapeSet(d)
  const hits = (ox: number, ow: number, oy: number, oh: number): boolean => {
    for (const k of shape) {
      const [cxs, cys] = k.split(',')
      const cx = nx + Number(cxs)
      const cy = ny + Number(cys)
      if (cx < ox + ow && cx + 1 > ox && cy < oy + oh && cy + 1 > oy) return true
    }
    return false
  }
  for (const o of s.objects) {
    if (!o.blockMove) continue
    if (hits(o.x, o.w, o.y, o.h)) return
  }
  for (const w of s.walls) {
    if (w.state === 'destroyed') continue
    for (const c of w.cells) {
      if (hits(c.x, 1, c.y, 1)) return
    }
  }
  s.fortress.x = nx
  s.fortress.y = ny
}

// ---------- 格子占用 / 阻挡查询 ----------
export type BlockerKind = 'terrain' | 'object' | 'wall' | 'turret' | 'building' | 'core'
export interface Blocker { kind: BlockerKind; id: number } // terrain id = TERRAIN 下标

export function terrainAt(x: number, y: number): LevelTerrain | null {
  for (const b of LEVEL.terrain) {
    if (x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h) return b
  }
  return null
}

/** 单位层向下被阻挡的查询（战场文档 §3 阻挡总则） */
export function blockerAt(s: GameState, x: number, y: number): Blocker | null {
  if (x < 0 || x >= LEVEL.cols || y < 0 || y >= LEVEL.rows) return null
  // 地形永不挡移动；物体按矩形占格判定（hp=-1 的物体同样挡移动）
  for (const o of s.objects) {
    if (o.blockMove && x >= o.x && x < o.x + o.w && y >= o.y && y < o.y + o.h) return { kind: 'object', id: o.id }
  }
  for (const w of s.walls) {
    if (w.state === 'destroyed') continue
    if (w.cells.some(c => c.x === x && c.y === y)) return { kind: 'wall', id: w.id }
  }
  for (const b of s.buildings) {
    if (x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h) return { kind: 'building', id: b.id }
  }
  // 移动堡垒：形状占地格即敌人终点目标（kind 'core' 沿用，敌人抵达即攻击船体；镂空格可通行）
  const fd = fortressDef(s)
  const lx = x - Math.floor(s.fortress.x)
  const ly = y - Math.floor(s.fortress.y)
  if (lx >= 0 && lx < fd.w && ly >= 0 && ly < fd.h && fortressShapeSet(fd).has(`${lx},${ly}`)) return { kind: 'core', id: 0 }
  return null
}

/** 弹道阻挡查询：首个阻挡弹道且未被摧毁的物体（地形永不挡弹道） */
function projectileBlockerAt(s: GameState, x: number, y: number): BattleObject | null {
  for (const o of s.objects) {
    if (!o.blockProjectile) continue
    if (x >= o.x && x < o.x + o.w && y >= o.y && y < o.y + o.h) return o
  }
  return null
}

// ---------- 寻路（Dijkstra 距离场，结构格带高惩罚 => 必须清除的障碍） ----------
const STRUCT_PENALTY = 200

// v1.55 性能包：① 障碍格一次性栅格化（原每邻居 blockerAt 全表扫描 objects/walls.cells/buildings）
// ② 二叉堆 Dijkstra（原 O(n²) 线性扫最小值）③ 按 pathVersion 缓存（原每 tick 无条件重算；
// 障碍/结构/堡垒跨格变化均已递增 pathVersion，缓存与之同生命周期；structuredClone 会携带该普通数据字段）
interface PathFieldCache { v: number; dist: number[] }

export function computePathField(s: GameState): number[] {
  const holder = s as GameState & { __pf?: PathFieldCache }
  if (holder.__pf && holder.__pf.v === s.pathVersion) return holder.__pf.dist

  const W = LEVEL.cols, H = LEVEL.rows
  const idx = (x: number, y: number) => y * W + x
  // 障碍栅格：0=空 1=堡垒占地(终点,无惩罚) 2=可破坏障碍(墙/建筑/hp>0物体,+惩罚) 3=硬障碍(hp<0物体,不可通过)
  const grid = new Uint8Array(W * H)
  for (const c of fortressCells(s)) grid[idx(c.x, c.y)] = 1
  for (const b of s.buildings) {
    for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++)
      if (x >= 0 && x < W && y >= 0 && y < H) grid[idx(x, y)] = 2
  }
  for (const w of s.walls) {
    if (w.state === 'destroyed') continue
    for (const c of w.cells) if (c.x >= 0 && c.x < W && c.y >= 0 && c.y < H && grid[idx(c.x, c.y)] !== 3) grid[idx(c.x, c.y)] = 2
  }
  for (const o of s.objects) {
    if (!o.blockMove) continue
    const code = o.hp < 0 ? 3 : 2
    for (let y = o.y; y < o.y + o.h; y++) for (let x = o.x; x < o.x + o.w; x++)
      if (x >= 0 && x < W && y >= 0 && y < H && (code === 3 || grid[idx(x, y)] !== 3)) grid[idx(x, y)] = code
  }

  const dist = new Array<number>(W * H).fill(Infinity)
  // 二叉堆 [dist, cellIdx]
  const heap: number[] = []
  const hPush = (d: number, i: number) => {
    heap.push(d, i)
    let c = heap.length / 2 - 1
    while (c > 0) {
      const p = (c - 1) >> 1
      if (heap[p * 2] <= heap[c * 2]) break
      for (const k of [0, 1]) { const t = heap[p * 2 + k]; heap[p * 2 + k] = heap[c * 2 + k]; heap[c * 2 + k] = t }
      c = p
    }
  }
  const hPop = (): number => { // 返回 cellIdx
    const top = heap[1]
    const ld = heap[heap.length - 2], li = heap[heap.length - 1]
    heap.length -= 2
    if (heap.length > 0) {
      heap[0] = ld; heap[1] = li
      let p = 0
      for (;;) {
        let m = p
        const l = p * 2 + 1, r = p * 2 + 2
        if (l * 2 < heap.length && heap[l * 2] < heap[m * 2]) m = l
        if (r * 2 < heap.length && heap[r * 2] < heap[m * 2]) m = r
        if (m === p) break
        for (const k of [0, 1]) { const t = heap[p * 2 + k]; heap[p * 2 + k] = heap[m * 2 + k]; heap[m * 2 + k] = t }
        p = m
      }
    }
    return top
  }
  for (const c of fortressCells(s)) { const i = idx(c.x, c.y); dist[i] = 0; hPush(0, i) } // 堡垒占地格 = 敌人终点目标
  while (heap.length > 0) {
    const bd = heap[0]
    const bi = hPop()
    if (bd > dist[bi]) continue // 堆中陈旧项
    const bx = bi % W
    const by = Math.floor(bi / W)
    const nb: [number, number][] = [[bx + 1, by], [bx - 1, by], [bx, by + 1], [bx, by - 1]]
    for (const [nx, ny] of nb) {
      if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue
      const ni = idx(nx, ny)
      const g = grid[ni]
      if (g === 3) continue // hp=-1 挡路物体：硬障碍，不可清除
      const step = g === 2 ? 1 + STRUCT_PENALTY : 1 // 可破坏障碍：必经则清除；堡垒格(1)无惩罚
      if (bd + step < dist[ni]) { dist[ni] = bd + step; hPush(dist[ni], ni) }
    }
  }
  holder.__pf = { v: s.pathVersion, dist }
  return dist
}

/** 闭合校验：从出生带是否存在直达堡垒的路径（历史校验入口；移动堡垒下恒有路径，保留供编辑器/测试） */
export function validateTemplateClosed(s: GameState): boolean {
  const fr = fortressRect(s)
  const fx0 = Math.floor(fr.x)
  const fx1 = Math.floor(fr.x + fr.w - 1e-6)
  const fy0 = Math.floor(fr.y)
  const fy1 = Math.floor(fr.y + fr.h - 1e-6)
  const pass = (x: number, y: number) => blockerAt(s, x, y) === null
  const seen = new Array<boolean>(LEVEL.cols * LEVEL.rows).fill(false)
  const q: [number, number][] = []
  for (let x = 0; x < LEVEL.cols; x++) {
    for (let y = 0; y < SPAWN_ROWS; y++) {
      if (pass(x, y)) { seen[y * LEVEL.cols + x] = true; q.push([x, y]) }
    }
  }
  while (q.length) {
    const [cx, cy] = q.pop()!
    const nb: [number, number][] = [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]]
    for (const [nx, ny] of nb) {
      // 抵达堡垒邻接格即视为可直达堡垒
      if (nx >= fx0 && nx <= fx1 && ny >= fy0 && ny <= fy1) return false
      if (nx < 0 || nx >= LEVEL.cols || ny < 0 || ny >= LEVEL.rows) continue
      const i = ny * LEVEL.cols + nx
      if (seen[i] || !pass(nx, ny)) continue
      seen[i] = true
      q.push([nx, ny])
    }
  }
  return true
}

// ---------- 玩家操作 ----------
export function cellBuildableForTurret(s: GameState, x: number, y: number): boolean {
  // 防御设施只能建在基地里侧格（基地格且非墙段）；墙段格不可建造
  if (!isInnerCell(x, y)) return false
  return blockerAt(s, x, y) === null
}

export function placeTurret(s: GameState, defId: string, x: number, y: number): GameState {
  if (s.phase !== 'prep') return s
  const def = defOf(defId)
  if (s.gold < def.cost) return s
  for (let dx = 0; dx < def.w; dx++)
    for (let dy = 0; dy < def.h; dy++)
      if (!cellBuildableForTurret(s, x + dx, y + dy)) return s
  const t: Turret = {
    id: s.nextId, defId, x, y, w: def.w, h: def.h, level: 1,
    hp: def.hp, maxHp: def.hp, angle: 0, cooldown: 0, burstLeft: 0, burstTimer: 0,
      rackLeft: def.type === 'missile' ? Math.max(1, def.burst ?? 1) : 0, // 导弹塔初始满挂
      rackAnim: 0, // 初始放置不播复挂动画
      rackTimer: 0,
    chargeLeft: 0, firing: false, firingLeft: 0, tickTimer: 0,
    targetId: null, barrelIdx: 0,
  }
  const n = clone(s)
  n.gold -= def.cost
  n.turrets.push(t)
  n.pathVersion++ // 新建建筑改变通行 => 重寻路
  n.nextId++
  return n
}

/** 派生防御墙同步：目标墙段集合 = 基地格中 4 邻含非基地格的格子。
 *  已有墙 HP 按键保留；新增墙段满 HP；不再是墙段（变里侧/变非基地）移除墙；缺口格仍为墙段保持缺口（hp=0 可通行） */
export function syncDerivedWalls(s: GameState) {
  invalidateWallInfo() // 基地格变化 → 失效并重建 level 墙信息缓存
  const info = getWallInfo()
  const target = info.walls
  const kept = new Map<string, WallSeg>()
  let changed = false
  for (const w of s.walls) {
    const k = w.cells.length === 1 ? `${w.cells[0].x},${w.cells[0].y}` : null
    if (k && target.has(k)) {
      kept.set(k, w) // 仍在集合：保留（含缺口态 hp=0）
    } else {
      changed = true // 变里侧/变非基地：移除（含清除缺口）
    }
  }
  for (const k of target) {
    if (!kept.has(k)) {
      const [x, y] = k.split(',').map(Number)
      kept.set(k, { id: s.nextId++, cells: [{ x, y }], hp: WALL_HP, maxHp: WALL_HP, state: 'intact', fromLevel: true, isolated: info.isolated.has(k) })
      changed = true // 新增墙段满 HP
    }
  }
  if (changed) {
    s.walls = [...target].map(k => kept.get(k)!)
    s.pathVersion++ // 墙集合变化 → 重寻路
  }
}

/** 基地格扩建（防御墙派生，墙本身不可建造）：校验 → 铺设 → 墙重算 */
export function placeBaseCellAt(s: GameState, x: number, y: number): GameState {
  const chk = canPlaceBaseCell(x, y)
  if (!chk.ok || s.gold < WALL_BUILD_COST || s.phase !== 'prep') return s
  if (!LEVEL.buildCells.includes(`${x},${y}`)) LEVEL.buildCells.push(`${x},${y}`)
  const ns = clone(s)
  ns.gold -= WALL_BUILD_COST
  syncDerivedWalls(ns)
  return ns
}

/** 拆除：炮塔（返半价）→ 基地格（其上有炮塔禁止；连带墙经 syncDerivedWalls 重算） */
// ---------- 要塞内部模块（背包式摆放；无耐久、敌人不可达，仅备战期建造/拆除） ----------

export function moduleDefOf(defId: string): ModuleDef {
  const d = MODULE_DEFS.find(x => x.id === defId)
  if (!d) throw new Error(`未知模块: ${defId}`)
  return d
}

/** 模块占格尺寸（rot=1 旋转 90°，宽高互换；异型模块为包围盒尺寸） */
export function moduleFoot(def: ModuleDef, rot: 0 | 1): { w: number; h: number } {
  return rot ? { w: def.h, h: def.w } : { w: def.w, h: def.h }
}

/** v2.31 模块占格单元（未旋转局部坐标；shape 缺省 = w×h 全满矩形；越界格自动忽略） */
export function moduleBaseCells(def: ModuleDef): { x: number; y: number }[] {
  if (def.shape && def.shape.length > 0) {
    const cells: { x: number; y: number }[] = []
    for (const k of def.shape) {
      const [x, y] = k.split(',').map(Number)
      if (Number.isInteger(x) && Number.isInteger(y) && x >= 0 && x < def.w && y >= 0 && y < def.h) cells.push({ x, y })
    }
    if (cells.length > 0) return cells
  }
  const cells: { x: number; y: number }[] = []
  for (let x = 0; x < def.w; x++) for (let y = 0; y < def.h; y++) cells.push({ x, y })
  return cells
}

/** v2.31 模块占格单元（按 rot 旋转后；rot=1 绕 w×h 包围盒转 90°：(x,y)→(h-1-y, x)） */
export function moduleCells(def: ModuleDef, rot: 0 | 1): { x: number; y: number }[] {
  const base = moduleBaseCells(def)
  if (rot === 0) return base
  return base.map(c => ({ x: def.h - 1 - c.y, y: c.x }))
}

/** 模块实例占格全集（"x,y" 世界局部格阵坐标） */
function moduleInstCellSet(m: ModuleInst): Set<string> {
  const set = new Set<string>()
  for (const c of moduleCells(moduleDefOf(m.defId), m.rot)) set.add(`${m.x + c.x},${m.y + c.y}`)
  return set
}

/** 模块放置校验：内部格阵界内 + 不与其他模块重叠（v2.31 逐格） + 金币足够（不查金币余额时传 skipGold） */
export function canPlaceModule(s: GameState, defId: string, x: number, y: number, rot: 0 | 1): { ok: boolean; reason?: string } {
  const def = moduleDefOf(defId)
  if (def.maxCount !== undefined && s.modules.filter(m => m.defId === defId).length >= def.maxCount) {
    return { ok: false, reason: `${def.name}装配上限 ${def.maxCount}` }
  }
  const cells = moduleCells(def, rot)
  const iSet = fortressInteriorSet(fortressDef(s)) // 内部自由格阵：模块每格都须落在内部格内
  if (x < 0 || y < 0) return { ok: false, reason: '超出内部空间' }
  for (const c of cells) {
    if (!iSet.has(`${x + c.x},${y + c.y}`)) return { ok: false, reason: '超出内部空间' }
  }
  const mine = new Set(cells.map(c => `${x + c.x},${y + c.y}`))
  for (const m of s.modules) {
    const occ = moduleInstCellSet(m)
    for (const k of mine) if (occ.has(k)) return { ok: false, reason: '与其他模块重叠' }
  }
  if (s.gold < def.cost) return { ok: false, reason: '废料不足' }
  return { ok: true }
}

/** 建造模块（仅备战期）：扣金币，放入内部格阵 */
export function buildModule(s: GameState, defId: string, x: number, y: number, rot: 0 | 1): GameState {
  if (s.phase !== 'prep') return s
  if (!canPlaceModule(s, defId, x, y, rot).ok) return s
  const n = clone(s)
  const def = moduleDefOf(defId)
  n.gold -= def.cost
  n.modules.push({ id: n.nextId++, defId, x, y, rot, timer: def.produce?.interval ?? 0 })
  const m = n.modules[n.modules.length - 1]
  if (def.produce) m.timer = def.produce.interval / moduleSpecialMult(n, m, 'produce') // 生产特殊格：间隔 ÷1.5
  n.fortress.maxHp = fortressMaxHp(n)
  syncShieldCapacity(n)
  return n
}

/** 拆除模块（仅备战期）：返半价 */
export function demolishModule(s: GameState, moduleId: number): GameState {
  if (s.phase !== 'prep') return s
  const m = s.modules.find(x => x.id === moduleId)
  if (!m) return s
  const n = clone(s)
  n.gold += Math.floor(moduleDefOf(m.defId).cost / 2)
  n.modules = n.modules.filter(x => x.id !== moduleId)
  n.fortress.maxHp = fortressMaxHp(n)
  n.fortress.hp = Math.min(n.fortress.hp, n.fortress.maxHp)
  syncShieldCapacity(n)
  return n
}

export interface ModuleBonuses {
  energyRegen: number // 电力回复加成（点/s）
  energyCap: number // 储电上限加成
  ammoRegen: number // 弹药回复加成（发/s）
  ammoCap: number // 弹药储存上限加成
  coolingPool: number // 散热功率池（点/s），全额叠加到堡垒散热速率
  repairPool: number // 修复功率池（hp/s），均摊到每座受损炮塔
  rangeBoostPool: number // 射程增益池（比例），均摊到每座炮塔
  hpBoostPool: number // 船体血量上限加成池
  speedBoostPool: number // 移动速度加成池（格/s，可为负）
  turnBoostPool: number // 转向速度加成池（度/s，可为负）
  shieldGeneratorCount: number // 护盾发生器数量（具体上限由各模块定义的 maxCount 决定）
  shieldMaxPool: number // 护盾容量池
  shieldRegenPool: number // 护盾回复池（点/s）
  shieldEnergyPerPoint: number // 每回复 1 点护盾耗电
}

/** 模块特殊格倍率：模块占格覆盖对应类别的特殊格 → SPECIAL_MULT（否则 1）；生产类用于间隔除算 */
export function moduleSpecialMult(s: GameState, m: ModuleInst, boost: SpecialBoost): number {
  const sp = fortressDef(s).interiorSpecials
  if (!sp || sp.length === 0) return 1
  const occ = moduleInstCellSet(m) // v2.31 逐格判定（异型模块空洞不覆盖特殊格）
  for (const c of sp) {
    if (c.boost !== boost) continue
    if (occ.has(`${c.x},${c.y}`)) return SPECIAL_MULT
  }
  return 1
}

/** 汇总全部内部模块的加成（覆盖特殊格的模块对应属性 ×SPECIAL_MULT） */
export function moduleBonuses(s: GameState): ModuleBonuses {
  const b: ModuleBonuses = { energyRegen: 0, energyCap: 0, ammoRegen: 0, ammoCap: 0, coolingPool: 0, repairPool: 0, rangeBoostPool: 0, hpBoostPool: 0, speedBoostPool: 0, turnBoostPool: 0, shieldGeneratorCount: 0, shieldMaxPool: 0, shieldRegenPool: 0, shieldEnergyPerPoint: 0 }
  for (const m of s.modules) {
    const d = moduleDefOf(m.defId)
    const mt = (boost: SpecialBoost) => moduleSpecialMult(s, m, boost)
    b.energyRegen += (d.energyRegen ?? 0) * mt('energy')
    b.energyCap += (d.energyCap ?? 0) * mt('energy')
    b.ammoRegen += (d.ammoRegen ?? 0) * mt('ammo')
    b.ammoCap += (d.ammoCap ?? 0) * mt('ammo')
    b.coolingPool += (d.cooling ?? 0) * mt('cooling')
    b.repairPool += (d.repair ?? 0) * mt('repair')
    b.rangeBoostPool += (d.rangeBoost ?? 0) * mt('range')
    b.hpBoostPool += (d.hpBoost ?? 0) * mt('hp')
    b.speedBoostPool += (d.speedBoost ?? 0) * mt('speed')
    b.turnBoostPool += (d.turnBoost ?? 0) * mt('turn')
    b.shieldMaxPool += Math.max(0, d.shieldMax ?? 0)
    b.shieldRegenPool += Math.max(0, d.shieldRegen ?? 0)
    if (d.shieldGenerator) {
      b.shieldGeneratorCount++
      b.shieldEnergyPerPoint = Math.max(b.shieldEnergyPerPoint, Math.max(0, d.shieldEnergyPerPoint ?? 0.5))
    }
  }
  return b
}

export interface ShieldStats { enabled: boolean; max: number; regen: number; energyPerPoint: number }
/** 护盾模块汇总：没有发生器时，容量/回复增效模块不单独生效。 */
export function shieldStats(s: GameState): ShieldStats {
  const b = moduleBonuses(s)
  const enabled = b.shieldGeneratorCount > 0 && b.shieldMaxPool > 0
  return { enabled, max: enabled ? b.shieldMaxPool : 0, regen: enabled ? b.shieldRegenPool : 0, energyPerPoint: enabled ? b.shieldEnergyPerPoint : 0 }
}

/** 同步模块变化后的动态护盾上限；首次装上发生器及新增容量均补足新增部分。 */
function syncShieldCapacity(s: GameState): ShieldStats {
  const stats = shieldStats(s)
  const oldMax = s.fortress.maxShield
  s.fortress.maxShield = stats.max
  if (!stats.enabled) {
    s.fortress.shield = 0
    s.fortress.shieldBroken = false
    return stats
  }
  if (oldMax <= 0) {
    s.fortress.shield = stats.max
    s.fortress.shieldBroken = false
  } else if (stats.max > oldMax) {
    s.fortress.shield = Math.min(stats.max, s.fortress.shield + stats.max - oldMax)
  } else {
    s.fortress.shield = Math.min(stats.max, s.fortress.shield)
  }
  return stats
}

/** 护盾回复：未破时持续回复；破盾后须 10s 未受攻击。满盾不耗电，电量不足按可用电量部分回复。 */
function updateShield(s: GameState, dt: number): void {
  const stats = syncShieldCapacity(s)
  const f = s.fortress
  if (!stats.enabled || f.shield >= f.maxShield || stats.regen <= 0) return
  if (f.shieldBroken) {
    if (s.time - f.shieldLastHitAt < 10) return
    f.shieldBroken = false
  }
  const wanted = Math.min(f.maxShield - f.shield, stats.regen * dt)
  const possible = stats.energyPerPoint > 0 ? Math.min(wanted, s.energy / stats.energyPerPoint) : wanted
  if (possible <= 0) return
  f.shield += possible
  s.energy = Math.max(0, s.energy - possible * stats.energyPerPoint)
}

/** 资源动态上限 = 基础 cap + 模块加成（UI 与 tick 共用） */
export function resourceCaps(s: GameState): { ammoCap: number; energyCap: number } {
  const b = moduleBonuses(s)
  return { ammoCap: AMMO.cap + b.ammoCap, energyCap: ENERGY.cap + b.energyCap }
}

export interface HeatCurvePoint { time: number; heat: number; overheated: boolean }
/** 炮塔编辑器只读热曲线：按单座炮塔持续射击的平均产热，复用实战过热/50%迟滞口径。 */
export function simulateTurretHeat(def: TurretDef, fortress: FortressDef, seconds = 20, dt = 0.1): HeatCurvePoint[] {
  const cap = Math.max(1, fortress.heatCap)
  const barrels = Math.max(1, Math.floor(def.barrels ?? 1))
  const shotsPerRound = Math.max(1, Math.floor(def.burst ?? 1)) * ((def.barrelMode ?? 'salvo') === 'salvo' ? barrels : 1)
  const heatPerSecond = (def.heatPerShot ?? 0) * shotsPerRound / Math.max(0.05, def.fireRate || 1)
  let heat = 0, overheated = false
  const out: HeatCurvePoint[] = [{ time: 0, heat, overheated }]
  const steps = Math.ceil(seconds / dt)
  for (let i = 1; i <= steps; i++) {
    heat = Math.max(0, heat - fortress.heatDissipation * dt)
    if (overheated && heat <= cap * OVERHEAT_RESUME) overheated = false
    if (!overheated) heat = Math.min(cap, heat + heatPerSecond * dt)
    if (heat >= cap) overheated = true
    out.push({ time: Math.min(seconds, i * dt), heat, overheated })
  }
  return out
}

/** 模块规划参考：忽略当前装配，只计算模块在目标堡垒内部自由格阵中的可放起点数量。 */
export function modulePlanningFits(fortress: FortressDef, module: ModuleDef): { normal: number; rotated: number } {
  const inside = fortressInteriorSet(fortress)
  const count = (rot: 0 | 1) => {
    const cells = moduleCells(module, rot)
    const foot = moduleFoot(module, rot)
    let n = 0
    for (let y = 0; y <= fortress.h - foot.h; y++) for (let x = 0; x <= fortress.w - foot.w; x++) {
      if (cells.every(c => inside.has(`${x + c.x},${y + c.y}`))) n++
    }
    return n
  }
  return { normal: count(0), rotated: count(1) }
}

/** 堡垒散热速率（点/s）= 堡垒自然散热 + 散热器功率池（全额直连，不按炮塔数摊薄） */
export function fortressCooling(s: GameState): number {
  return fortressDef(s).heatDissipation + moduleBonuses(s).coolingPool
}

/** 开火产热汇聚到堡垒热量池：攒满上限即过热（全炮塔停火） */
export function addFortressHeat(s: GameState, amount: number): void {
  if (amount <= 0) return
  const cap = fortressDef(s).heatCap
  s.fortress.heat = Math.min(cap, s.fortress.heat + amount)
  if (s.fortress.heat >= cap) s.fortress.overheated = true
}

/** 堡垒散热推进：自然散热+散热器持续生效（含射击/过热中）；过热迟滞解除（降至上限×OVERHEAT_RESUME） */
function coolFortress(s: GameState, dt: number): void {
  const f = s.fortress
  if (f.heat > 0) f.heat = Math.max(0, f.heat - fortressCooling(s) * dt)
  if (f.overheated && f.heat <= fortressDef(s).heatCap * OVERHEAT_RESUME) f.overheated = false
}

/** 火控雷达摊薄：每座炮塔射程增益比例 = 增益池 / 炮塔数（无炮塔为 0） */
export function turretRangeBonus(s: GameState): number {
  if (s.turrets.length === 0) return 0
  return moduleBonuses(s).rangeBoostPool / s.turrets.length
}

// ---------- 友军单位（生产模块产出；v1 直线移动、无碰撞；空中单位地面敌人无法攻击） ----------

/** 出征点：堡垒上方（迎敌侧）中点外侧，跟随堡垒移动 */
export function allySpawnPoint(s: GameState): { x: number; y: number } {
  const d = fortressDef(s)
  return { x: s.fortress.x + d.w / 2, y: Math.max(SPAWN_ROWS + 0.5, s.fortress.y - 0.6) }
}

/** 生产模块倒计时 + 维修站修复 + 友军单位推进（备战/交战都生效；tick 每帧调用） */
function updateModulesAndAllies(s: GameState, dt: number) {
  const mb = moduleBonuses(s)
  // 维修站：结构、四面装甲与受损炮塔共同均摊修复功率
  if (mb.repairPool > 0) {
    const damaged = s.turrets.filter(t => t.hp < t.maxHp)
    const sides = (['front', 'rear', 'left', 'right'] as FortressArmorSide[]).filter(side => s.fortress.armor[side] < s.fortress.maxArmor[side])
    const structureDamaged = s.fortress.hp < s.fortress.maxHp
    const consumers = damaged.length + sides.length + (structureDamaged ? 1 : 0)
    if (consumers > 0) {
      const per = (mb.repairPool / consumers) * dt
      for (const t of damaged) t.hp = Math.min(t.maxHp, t.hp + per)
      for (const side of sides) s.fortress.armor[side] = Math.min(s.fortress.maxArmor[side], s.fortress.armor[side] + per)
      if (structureDamaged) s.fortress.hp = Math.min(s.fortress.maxHp, s.fortress.hp + per)
    }
  }
  // 生产模块：倒计时产出友军（受本模块存活上限约束）
  for (const m of s.modules) {
    const d = moduleDefOf(m.defId)
    if (!d.produce) continue
    m.timer -= dt
    if (m.timer > 0) continue
    const alive = s.allies.filter(a => a.producerId === m.id).length
    if (alive >= d.produce.cap) { m.timer = 0.5; continue } // 满员：稍后复查
    m.timer = d.produce.interval / moduleSpecialMult(s, m, 'produce') // 生产特殊格：间隔 ÷1.5
    const def = ALLY_DEFS[d.produce.kind]
    const p = allySpawnPoint(s)
    s.allies.push({
      id: s.nextId++, kind: d.produce.kind, producerId: m.id,
      x: p.x, y: p.y, hp: def.hp, maxHp: def.hp,
      cooldown: 0, targetId: null, hitFlash: 0,
    })
  }
  // 友军推进：全图索敌巡航，进射程攻击；阵亡清理
  for (const a of s.allies) updateAlly(s, a, dt)
  for (const a of s.allies) if (a.hp <= 0) addFloat(s, a.x, a.y, `${ALLY_DEFS[a.kind].name}阵亡`)
  s.allies = s.allies.filter(a => a.hp > 0)
}

function updateAlly(s: GameState, a: Ally, dt: number) {
  const def = ALLY_DEFS[a.kind]
  a.hitFlash = Math.max(0, a.hitFlash - dt)
  // 索敌：最近的可攻击目标（全图巡航；v1 直线移动无碰撞）
  let best: Enemy | null = null
  let bd = Infinity
  for (const e of s.enemies) {
    if (e.hp <= 0) continue
    const ed = ENEMY_DEFS[e.kind]
    if (ed.air && !def.canAir) continue
    if (!ed.air && !def.canGround) continue
    const d = Math.hypot(e.x - a.x, e.y - a.y)
    if (d < bd) { bd = d; best = e }
  }
  if (!best) { a.targetId = null; return } // 无敌人：原地待命
  a.targetId = best.id
  const range = m2c(def.range)
  if (bd > range) {
    const step = Math.min(bd - range, def.speed * dt) // 进到射程边沿即停
    a.x = Math.max(0, Math.min(LEVEL.cols, a.x + ((best.x - a.x) / bd) * step))
    a.y = Math.max(0, Math.min(LEVEL.rows, a.y + ((best.y - a.y) / bd) * step))
    return
  }
  a.cooldown -= dt
  if (a.cooldown <= 0) {
    a.cooldown = def.interval
    damageEnemy(s, best, def.damage, null)
  }
}

export function demolishAt(s: GameState, x: number, y: number): GameState {

  if (s.phase !== 'prep') return s
  const t = s.turrets.find(t => x >= t.x && x < t.x + t.w && y >= t.y && y < t.y + t.h)
  if (t) return unmountTurret(s, t.id) // 炮塔优先：卸下返半价（内置武器不可拆，unmountTurret 内拦截）
  const n = clone(s)
  if (isBaseCell(x, y)) { // 基地格拆除（编辑器遗留路径）：连带墙经 syncDerivedWalls 重算
    const i = LEVEL.buildCells.indexOf(`${x},${y}`)
    if (i >= 0) LEVEL.buildCells.splice(i, 1)
    n.gold += Math.floor(WALL_BUILD_COST / 2)
    syncDerivedWalls(n)
    return n
  }
  return n
}

export const WALL_REPAIR_FULL_COST = 60
export function wallRepairCost(w: WallSeg): number {
  if (w.state === 'destroyed' || w.hp >= w.maxHp) return 0
  return Math.max(5, Math.ceil((1 - w.hp / w.maxHp) * WALL_REPAIR_FULL_COST * (w.maxHp / WALL_HP)))
}

/** 受损墙段修复：仅恢复 hp，不影响已开放入口（destroyed 不可修复，只能在原格位重建封堵） */
export function repairWall(s: GameState, wallId: number): GameState {
  if (s.phase !== 'prep') return s
  const w = s.walls.find(w => w.id === wallId)
  if (!w) return s
  const cost = wallRepairCost(w)
  if (cost <= 0 || s.gold < cost) return s
  const n = clone(s)
  const nw = n.walls.find(w => w.id === wallId)!
  nw.hp = nw.maxHp
  nw.state = 'intact'
  n.gold -= cost
  return n
}

export function upgradeTurret(s: GameState, turretId: number): GameState {
  if (s.phase !== 'prep') return s
  const t = s.turrets.find(t => t.id === turretId)
  if (!t || t.level >= 3) return s
  const cost = upgradeCost(defOf(t.defId), t.level)
  if (s.gold < cost) return s
  const n = clone(s)
  n.turrets.find(t => t.id === turretId)!.level++
  n.gold -= cost
  return n
}

export function startWave(s: GameState, bonus: number): GameState {
  if (s.phase !== 'prep') return s
  const n = clone(s)
  n.phase = 'combat'
  n.gold += bonus
  n.prepLeft = 0
  n.nextWaveLeft = null
  n.spawnQueue = buildWave(n.wave).map(it => ({ ...it }))
  n.spawnTimer = 0.5
  return n
}

// ---------- 内部工具 ----------
function clone(s: GameState): GameState {
  return structuredClone(s)
}

function spawnEnemyAt(s: GameState, kind: EnemyKind, x: number, y: number): Enemy {
  const def = ENEMY_DEFS[kind]
  const enemyId = s.nextId++
  const hp = Math.round(def.hp * waveHpScale(s.wave))
  const enemy: Enemy = {
    id: enemyId, kind,
    x: Math.max(0.1, Math.min(LEVEL.cols - 0.1, x)),
    y: Math.max(-0.5, Math.min(LEVEL.rows - 0.1, y)),
    hp, maxHp: hp, mode: 'move', targetKind: null, targetId: null,
    goalX: x, goalY: y, hasGoal: false, pathVersion: -1,
    attackedBy: [], dots: [], hitFlash: 0,
    attackCooldown: eventRandom(enemyId, 97) * def.attackInterval,
  }
  s.enemies.push(enemy)
  return enemy
}

function zoneSpawnPoint(z: LevelZone, seed: number): { x: number; y: number } {
  const side = Math.floor(eventRandom(seed, 0) * 4)
  const px = z.x + 0.35 + eventRandom(seed, 1) * Math.max(0.1, z.w - 0.7)
  const py = z.y + 0.35 + eventRandom(seed, 2) * Math.max(0.1, z.h - 0.7)
  if (side === 0) return { x: px, y: z.y + 0.15 }
  if (side === 1) return { x: z.x + z.w - 0.15, y: py }
  if (side === 2) return { x: px, y: z.y + z.h - 0.15 }
  return { x: z.x + 0.15, y: py }
}

function queueEvent(s: GameState, sourceId: number, zone: LevelZone, actions: LevelEventAction[]) {
  if (actions.length === 0) return
  s.eventQueue.push({ id: s.nextId++, sourceId, zone: { ...zone }, actions: structuredClone(actions), index: 0, waitLeft: 0 })
}

function executeEventAction(s: GameState, seq: EventSequenceRuntime, action: LevelEventAction): boolean {
  if (action.type === 'wait') {
    if (seq.waitLeft <= 0) seq.waitLeft = action.seconds
    return seq.waitLeft <= 0
  }
  if (action.type === 'spawn') {
    let order = 0
    for (const kind of TRIGGER_ENEMY_KINDS) for (let i = 0; i < action.enemies[kind]; i++) {
      const p = zoneSpawnPoint(seq.zone, seq.id * 1000003 + order)
      s.ambushQueue.push({ triggerId: seq.sourceId, kind, left: order * action.interval, x: p.x, y: p.y })
      order++
    }
  } else if (action.type === 'boss') {
    const p = zoneSpawnPoint(seq.zone, seq.id * 1000003 + seq.index)
    const e = spawnEnemyAt(s, action.boss.kind, p.x, p.y)
    e.maxHp = Math.round(e.maxHp * action.boss.hpScale)
    e.hp = e.maxHp
    e.bossName = action.boss.name
    e.bossSizeScale = action.boss.sizeScale
    e.bossPhases = structuredClone(action.boss.phases)
    e.bossDefeatActions = structuredClone(action.boss.defeatActions)
    e.bossPhaseDone = []
    s.notices.push({ id: s.nextId++, text: `Boss 出现：${action.boss.name}`, left: 4 })
  } else if (action.type === 'message') {
    if (action.text) s.notices.push({ id: s.nextId++, text: action.text, left: action.duration })
  } else if (action.type === 'reward') {
    s.gold += action.gold
    addFloat(s, s.fortress.x, s.fortress.y, `奖励 +${action.gold}`)
  } else if (action.type === 'objective') {
    s.objective = structuredClone(action.objective)
    s.objectiveElapsed = 0
    s.nextWaveLeft = null
  } else if (action.type === 'toggle') {
    const rt = s.interactableStates.find(v => v.id === action.interactableId)
    if (rt) rt.enabled = action.enabled
  } else if (action.type === 'complete') {
    if (s.fortress.hp > 0 && s.fortress.dyingT < 0) s.phase = 'won'
  }
  return true
}

function updateEventQueue(s: GameState, dt: number) {
  for (const seq of s.eventQueue) {
    if (seq.waitLeft > 0) {
      seq.waitLeft = Math.max(0, seq.waitLeft - dt)
      if (seq.waitLeft > 0) continue
      seq.index++
    }
    let guard = 0
    while (seq.index < seq.actions.length && guard++ < 50) {
      if (!executeEventAction(s, seq, seq.actions[seq.index])) break
      seq.index++
      if (s.phase === 'won') break
    }
  }
  s.eventQueue = s.eventQueue.filter(q => q.index < q.actions.length)
}

function updateInteractables(s: GameState) {
  const c = fortressCenter(s)
  for (const item of LEVEL.interactables) {
    let rt = s.interactableStates.find(v => v.id === item.id)
    if (!rt) { rt = { id: item.id, inside: false, activations: 0, enabled: item.enabled }; s.interactableStates.push(rt) }
    const inside = c.x >= item.x && c.x <= item.x + item.w && c.y >= item.y && c.y <= item.y + item.h
    if (rt.enabled && inside && !rt.inside && (!item.once || rt.activations === 0)) {
      rt.activations++
      queueEvent(s, -item.id, item, item.actions)
      s.notices.push({ id: s.nextId++, text: `${item.name} 已激活`, left: 2.5 })
    }
    rt.inside = inside
  }
}

/** 区域伏击：只在“区域外→区域内”沿触发；重复触发须先离开并满足冷却。 */
function updateRegionTriggers(s: GameState, dt: number) {
  const c = fortressCenter(s)
  for (const t of LEVEL.triggers) {
    let rt = s.triggerStates.find(v => v.id === t.id)
    if (!rt) {
      rt = { id: t.id, inside: false, activations: 0, cooldown: 0 }
      s.triggerStates.push(rt)
    }
    rt.cooldown = Math.max(0, rt.cooldown - dt)
    const inside = c.x >= t.x && c.x <= t.x + t.w && c.y >= t.y && c.y <= t.y + t.h
    if (t.enabled && inside && !rt.inside && rt.cooldown <= 0 && rt.activations < t.activationLimit) {
      rt.activations++
      rt.cooldown = t.cooldown
      if (t.actions?.length) queueEvent(s, t.id, t, t.actions)
      else {
        let order = 0
        for (const kind of TRIGGER_ENEMY_KINDS) for (let i = 0; i < t.enemies[kind]; i++) {
          const p = zoneSpawnPoint(t, t.id * 1000003 + rt.activations * 1009 + order)
          s.ambushQueue.push({ triggerId: t.id, kind, left: t.delay + order * t.interval, x: p.x, y: p.y })
          order++
        }
      }
    }
    rt.inside = inside
  }
}

function wallStateOf(w: WallSeg): WallState {
  if (w.hp <= 0) return 'destroyed'
  return w.hp < w.maxHp ? 'damaged' : 'intact'
}

function distToFortress(s: GameState, e: { x: number; y: number }): number {
  const fc = fortressCenter(s)
  return Math.hypot(e.x - fc.x, e.y - fc.y)
}

// ================= 伤害与效果结算 =================

function addFloat(s: GameState, x: number, y: number, text: string) {
  s.floats.push({ id: s.nextId++, x, y, text, ttl: 0.8 })
}

export type FortressArmorSide = keyof FortressArmor
export interface FortressDamageSource {
  x: number
  y: number
  kind: 'melee' | 'projectile' | 'aoe'
  armorPen?: number
  armorDamage?: number
  penetration?: number // 概率穿深值：小于当前装甲时以 penetration/armor 判定；失败则跳弹且不伤结构
  duration?: number // 持续伤害按秒给攻击强度，duration=本 tick 秒数
}
export interface FortressDamageResult {
  side: FortressArmorSide
  blocked: boolean
  shieldDamage: number
  shieldBroken: boolean
  structureDamage: number
  armorDamage: number
  ricochet: boolean
}

export const FORTRESS_DAMAGE_MARK_CAP = 60

/** 英雄连式穿深概率：穿深达到装甲即必穿，否则按比例，最低保留 5% 幸运穿透。 */
export function fortressPenetrationChance(penetration: number, armor: number): number {
  if (armor <= 0) return 1
  return Math.max(0.05, Math.min(1, Math.max(0, penetration) / armor))
}

/** 世界命中点 → 堡垒主体局部格；越出车体的攻击源投影到主体边缘，保证贴花落在车上。 */
export function fortressDamageLocalPoint(s: GameState, x: number, y: number): { x: number; y: number } {
  const r = fortressRect(s)
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2
  const dx = x - cx, dy = y - cy
  const c = Math.cos(s.fortress.heading), sn = Math.sin(s.fortress.heading)
  const lx = dx * c + dy * sn + r.w / 2
  const ly = -dx * sn + dy * c + r.h / 2
  const inset = Math.min(0.08, r.w / 4, r.h / 4)
  return {
    x: Math.max(inset, Math.min(r.w - inset, lx)),
    y: Math.max(inset, Math.min(r.h - inset, ly)),
  }
}

function recordFortressBodyHit(s: GameState, source: FortressDamageSource, penetrated: boolean, ricochet = false): void {
  s.fortress.hitFlash = 0.08
  const continuous = source.duration !== undefined && source.duration < 0.25
  const local = fortressDamageLocalPoint(s, source.x, source.y)
  if (!continuous || s.time - s.fortress.damageMarkLastAt >= 0.14) {
    const id = s.nextId++
    const kind: FortressDamageMarkKind = penetrated
      ? source.kind === 'aoe' ? 'scorch' : source.kind === 'projectile' ? 'bullet' : 'scratch'
      : 'scratch'
    const baseSize = kind === 'scorch' ? 0.46 : kind === 'scratch' ? 0.32 : 0.22
    s.fortress.damageMarks.push({
      id, kind, x: local.x, y: local.y,
      size: baseSize * (0.85 + eventRandom(id, 74) * 0.3),
      angle: (id * 137.50776405003785) % 360,
    })
    if (s.fortress.damageMarks.length > FORTRESS_DAMAGE_MARK_CAP) {
      s.fortress.damageMarks.splice(0, s.fortress.damageMarks.length - FORTRESS_DAMAGE_MARK_CAP)
    }
    s.fortress.damageMarkLastAt = s.time
  }
  if (!continuous || s.time - s.fortress.damageFxLastAt >= 0.08) {
    const r = fortressRect(s)
    const dx = local.x - r.w / 2, dy = local.y - r.h / 2
    const c = Math.cos(s.fortress.heading), sn = Math.sin(s.fortress.heading)
    const wx = r.x + r.w / 2 + dx * c - dy * sn
    const wy = r.y + r.h / 2 + dx * sn + dy * c
    const nx0 = wx - (r.x + r.w / 2), ny0 = wy - (r.y + r.h / 2)
    const nl = Math.max(1e-6, Math.hypot(nx0, ny0)), nx = nx0 / nl, ny = ny0 / nl
    const ix0 = wx - source.x, iy0 = wy - source.y
    const il = Math.max(1e-6, Math.hypot(ix0, iy0)), ix = ix0 / il, iy = iy0 / il
    const dot = ix * nx + iy * ny
    let rx = ix - 2 * dot * nx, ry = iy - 2 * dot * ny
    const rl = Math.max(1e-6, Math.hypot(rx, ry)); rx /= rl; ry /= rl
    s.fortressHits.push({
      id: s.nextId++,
      x: wx, y: wy,
      ttl: ricochet ? 0.28 : 0.18, max: ricochet ? 0.28 : 0.18, penetrated, ricochet,
      ricochetDx: rx, ricochetDy: ry,
    })
    s.fortress.damageFxLastAt = s.time
  }
}

/** 世界命中点映射到堡垒四向受击面；角部按矩形归一化对角线裁决。 */
export function fortressArmorSideAt(s: GameState, x: number, y: number): FortressArmorSide {
  const r = fortressRect(s)
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2
  const dx = x - cx, dy = y - cy
  const c = Math.cos(s.fortress.heading), sn = Math.sin(s.fortress.heading)
  const lx = dx * c + dy * sn
  const ly = -dx * sn + dy * c
  const nx = lx / Math.max(0.01, r.w / 2)
  const ny = ly / Math.max(0.01, r.h / 2)
  if (Math.abs(nx) > Math.abs(ny)) return nx < 0 ? 'left' : 'right'
  return ny < 0 ? 'front' : 'rear'
}

/** 堡垒唯一承伤入口：受击面装甲阈值 → 穿甲直伤/削甲 → 结构值。 */
export function damageFortress(s: GameState, rawDamage: number, source: FortressDamageSource): FortressDamageResult {
  const side = fortressArmorSideAt(s, source.x, source.y)
  const duration = Math.max(0, source.duration ?? 1)
  const raw = Math.max(0, rawDamage)
  const actualRaw = raw * duration
  let shieldDamage = 0
  let shieldBroken = false
  if (actualRaw > 0) s.fortress.shieldLastHitAt = s.time
  let remainingActual = actualRaw
  if (remainingActual > 0 && s.fortress.maxShield > 0 && s.fortress.shield > 0) {
    shieldDamage = Math.min(s.fortress.shield, remainingActual)
    s.fortress.shield = Math.max(0, s.fortress.shield - shieldDamage)
    remainingActual -= shieldDamage
    shieldBroken = s.fortress.shield <= 0
    if (shieldBroken) s.fortress.shieldBroken = true
    s.shieldHits.push({ id: s.nextId++, x: source.x, y: source.y, ttl: shieldBroken ? 0.8 : 0.45, max: shieldBroken ? 0.8 : 0.45, broken: shieldBroken })
  }
  if (remainingActual <= 0 || duration <= 0) return { side, blocked: true, shieldDamage, shieldBroken, structureDamage: 0, armorDamage: 0, ricochet: false }
  const remainingRaw = remainingActual / duration
  const armor = Math.max(0, s.fortress.armor?.[side] ?? 0)
  const pen = Math.max(0, Math.min(1, source.armorPen ?? 0))
  let structureDamage = 0
  let armorDamage = 0
  let ricochet = false
  if (armor > 0 && source.penetration !== undefined) {
    const chance = fortressPenetrationChance(source.penetration, armor)
    ricochet = eventRandom(s.nextId, 91) >= chance
    if (!ricochet) {
      structureDamage = remainingActual
      armorDamage = Math.min(armor, Math.max(0, source.armorDamage ?? 0) * duration)
      s.fortress.armor[side] = Math.max(0, armor - armorDamage)
    }
  } else if (armor <= 0) {
    structureDamage = remainingActual
  } else if (pen > 0) {
    const direct = remainingRaw * pen
    const checked = remainingRaw - direct
    structureDamage = (direct + Math.max(0, checked - armor)) * duration
    armorDamage = Math.min(armor, Math.max(0, source.armorDamage ?? remainingRaw * pen) * duration)
    s.fortress.armor[side] = Math.max(0, armor - armorDamage)
  } else if (remainingRaw >= armor) {
    structureDamage = (remainingRaw - armor) * duration
  }
  s.fortress.hp = Math.max(0, s.fortress.hp - structureDamage)
  recordFortressBodyHit(s, source, structureDamage > 0, ricochet)
  return { side, blocked: structureDamage <= 0, shieldDamage, shieldBroken, structureDamage, armorDamage, ricochet }
}

/** 对敌人结算伤害（护甲、受击记录、燃烧 dot 挂载） */
function damageEnemy(s: GameState, e: Enemy, raw: number, srcTurretId: number | null) {
  const def = ENEMY_DEFS[e.kind]
  e.hp -= raw * (1 - def.armor)
  e.hitFlash = 0.08
  if (srcTurretId != null) {
    e.attackedBy = e.attackedBy.filter(a => a.turretId !== srcTurretId)
    e.attackedBy.push({ turretId: srcTurretId, time: s.time })
  }
}

function applyBurn(e: Enemy, burn: { damage: number; interval: number; duration: number }) {
  e.dots.push({ damage: burn.damage, interval: burn.interval, timer: burn.interval, left: burn.duration })
}

/** 爆炸遮挡判定：爆心→目标格级视线路径上存在阻挡弹道物体格则目标被遮挡。
 *  爆心近场 0.5 格内不计（爆心可能位于物体表面，如导弹撞物体爆炸），
 *  避免物体"自我遮挡"导致近侧目标也被豁免。 */
function explosionShielded(s: GameState, x1: number, y1: number, x2: number, y2: number): boolean {
  const d = Math.hypot(x2 - x1, y2 - y1)
  if (d < 1e-6) return false
  for (let l = 0.5; l < d; l += 0.2) {
    const o = projectileBlockerAt(s, Math.floor(x1 + (x2 - x1) / d * l), Math.floor(y1 + (y2 - y1) / d * l))
    if (o) return true
  }
  return false
}

/** 爆炸：范围内敌人受伤 + 爆炸效果；波及油桶（物体不分敌我）；不伤己方墙段（防误伤） */
function explode(s: GameState, x: number, y: number, radiusM: number, damage: number,
  effect: { damage: number; burn?: { damage: number; interval: number; duration: number } } | undefined,
  srcTurretId: number | null, lvl: number, ammoId?: string, hx?: number, hy?: number, hspeed?: number) {
  const rC = m2c(radiusM)
  s.explosions.push({ id: s.nextId++, x, y, r: rC, ttl: 0.35, ammoId, hx, hy, hspeed })
  const scale = levelScale(lvl)
  for (const e of s.enemies) {
    if (Math.hypot(e.x - x, e.y - y) <= rC + ENEMY_DEFS[e.kind].size) {
      // 爆炸遮挡：爆心→敌人格级视线被阻挡弹道物体截断 => 敌人豁免本次爆炸
      if (explosionShielded(s, x, y, e.x, e.y)) continue
      damageEnemy(s, e, (damage + (effect?.damage ?? 0)) * scale, srcTurretId)
      if (effect?.burn) applyBurn(e, effect.burn)
    }
  }
  for (const o of s.objects) {
    // 矩形物体按中心 + 半尺寸判定波及（hp=-1 物体在 damageObject 内豁免）
    if (Math.hypot(o.x + o.w / 2 - x, o.y + o.h / 2 - y) <= rC + Math.max(o.w, o.h) / 2) damageObject(s, o, 9999)
  }
}

function damageObject(s: GameState, o: BattleObject, dmg: number) {
  if (o.hp < 0) return // hp=-1：不可破坏，永不扣耐久
  o.hp -= dmg
  if (o.hp > 0) return
  // 破坏流程（§8.2）：移除、恢复通行、触发 on_destroy；挡路物体摧毁触发重寻路
  s.objects = s.objects.filter(x => x.id !== o.id)
  if (o.kind === 'barrel') {
    s.burnZones.push({
      id: s.nextId++, x: o.x + 0.5, y: o.y + 0.5, r: BARREL_BURN.radius,
      damage: BARREL_BURN.damage, interval: BARREL_BURN.interval, timer: 0, left: BARREL_BURN.duration,
    })
    s.explosions.push({ id: s.nextId++, x: o.x + 0.5, y: o.y + 0.5, r: BARREL_BURN.radius, ttl: 0.4 })
  }
  if (o.blockMove) s.pathVersion++
}

function damageWall(s: GameState, w: WallSeg, dmg: number) {
  if (w.state === 'destroyed') return
  w.hp -= dmg
  const st = wallStateOf(w)
  if (st === 'destroyed') {
    // §4.2：移除阻挡 + 登记入口（cells 可通行）+ 触发全场重寻路
    w.hp = 0
    w.state = 'destroyed'
    s.pathVersion++
  } else {
    w.state = st
  }
}

function damageTurret(s: GameState, t: Turret, dmg: number) {
  t.hp -= dmg
  if (t.hp > 0) return
  // §6.9：移除、格位释放；填写了毁坏效果的在毁坏位置触发
  const def = defOf(t.defId)
  const c = turretCenter(t)
  s.turrets = s.turrets.filter(x => x.id !== t.id)
  s.pathVersion++
  if (def.onDestroyBlast) {
    explode(s, c.x, c.y, def.onDestroyBlast.radius, def.onDestroyBlast.damage, def.onDestroyBlast, null, t.level)
  }
  addFloat(s, c.x, c.y, '炮塔损毁')
}

function damageBuilding(s: GameState, b: FixedBuilding, dmg: number) {
  b.hp -= dmg
  if (b.hp > 0) return
  // §5.3：固有建筑被毁，同一帧释放占格
  s.buildings = s.buildings.filter(x => x.id !== b.id)
  s.pathVersion++
  addFloat(s, b.x + b.w / 2, b.y, '建筑被毁')
}

/** 对目标实体结算敌人攻击，返回目标是否仍有效 */
function enemyDealDamage(s: GameState, e: Enemy, dmg: number, duration = 1): boolean {
  switch (e.targetKind) {
    case 'wall': {
      const w = s.walls.find(w => w.id === e.targetId)
      if (!w || w.state === 'destroyed') return false
      damageWall(s, w, dmg)
      return (w.state as WallState) !== 'destroyed'
    }
    case 'turret': {
      const t = s.turrets.find(t => t.id === e.targetId)
      if (!t) return false
      damageTurret(s, t, dmg)
      return s.turrets.some(x => x.id === e.targetId)
    }
    case 'building': {
      const b = s.buildings.find(b => b.id === e.targetId)
      if (!b) return false
      damageBuilding(s, b, dmg)
      return s.buildings.some(x => x.id === e.targetId)
    }
    case 'object': {
      const o = s.objects.find(o => o.id === e.targetId)
      if (!o || o.hp < 0) return false // 不可破坏物体不是有效攻击目标
      damageObject(s, o, dmg)
      return s.objects.some(x => x.id === e.targetId)
    }
    case 'core': {
      // 攻击船体：堡垒已移动脱离接触 => 目标失效，重新追击
      const r = fortressRect(s)
      if (e.x < r.x - 0.7 || e.x > r.x + r.w + 0.7 || e.y < r.y - 0.7 || e.y > r.y + r.h + 0.7) return false
      damageFortress(s, dmg, { x: e.x, y: e.y, kind: 'melee', duration })
      return s.fortress.hp > 0
    }
    case 'ally': {
      const a = s.allies.find(x => x.id === e.targetId)
      if (!a || a.hp <= 0) return false
      if (Math.hypot(a.x - e.x, a.y - e.y) > 1.0) return false // 友军脱离接触，重新寻路
      a.hp -= dmg
      a.hitFlash = 0.08
      return a.hp > 0
    }
  }
  return false
}

// ================= 敌人行为（§6） =================

function terrainSpeedMod(x: number, y: number): number {
  const t = terrainAt(Math.floor(x), Math.floor(y))
  if (!t) return 1
  return t.moveModifier // 地形只有地面效果（如减速），不挡移动/弹道；每实例可调
}

function setAttackFromBlocker(s: GameState, e: Enemy, bl: Blocker) {
  if (bl.kind === 'terrain') return // 地形不可攻击（新口径下地形不挡路，理论上不会选到）
  if (bl.kind === 'object') {
    const o = s.objects.find(o => o.id === bl.id)
    if (o && o.hp < 0) return // hp=-1 物体不可破坏：不进入攻击，保持移动重寻路
  }
  e.mode = 'attack'
  e.targetKind = bl.kind as Enemy['targetKind']
  e.targetId = bl.id
}

/** 依距离场选择下一步格；结构格 => 攻击；§6.3 就近原则 */
function followPath(s: GameState, e: Enemy, dist: number[], dt: number) {
  const cx = Math.min(LEVEL.cols - 1, Math.max(0, Math.floor(e.x)))
  const cy = Math.min(LEVEL.rows - 1, Math.max(0, Math.floor(e.y)))
  const need = !e.hasGoal || e.pathVersion !== s.pathVersion ||
    (Math.abs(e.x - e.goalX) < 0.08 && Math.abs(e.y - e.goalY) < 0.08)
  if (need) {
    e.pathVersion = s.pathVersion
    let best = dist[cy * LEVEL.cols + cx]
    let bx = cx
    let by = cy + 1 // 默认向下
    const nb: [number, number][] = [[cx, cy + 1], [cx + 1, cy], [cx - 1, cy], [cx, cy - 1]]
    for (const [nx, ny] of nb) {
      if (nx < 0 || nx >= LEVEL.cols || ny < 0 || ny >= LEVEL.rows) continue
      const d = dist[ny * LEVEL.cols + nx]
      if (d < best) { best = d; bx = nx; by = ny }
    }
    if (!isFinite(best)) { bx = cx; by = Math.min(LEVEL.rows - 1, cy + 1) }
    const bl = blockerAt(s, bx, by)
    if (bl && bl.kind !== 'core') {
      // 下一步是必须清除的障碍（墙/炮塔/建筑/物体）
      setAttackFromBlocker(s, e, bl)
      e.hasGoal = false
      return
    }
    if (bl && bl.kind === 'core') {
      e.mode = 'attack'
      e.targetKind = 'core'
      e.targetId = 0
      e.hasGoal = false
      return
    }
    e.goalX = bx + 0.5
    e.goalY = by + 0.5
    e.hasGoal = true
  }
  const spd = ENEMY_DEFS[e.kind].speed * terrainSpeedMod(e.x, e.y)
  const dx = e.goalX - e.x
  const dy = e.goalY - e.y
  const d = Math.hypot(dx, dy)
  if (d > 1e-6) {
    const step = Math.min(d, spd * dt)
    e.x += (dx / d) * step
    e.y += (dy / d) * step
  }
}

function moveToward(s: GameState, e: Enemy, tx: number, ty: number, dt: number, ignoreBlockers = false) {
  // 检查前方格是否被结构阻挡（通往目标路径上的障碍优先清除）
  const dx = tx - e.x
  const dy = ty - e.y
  const d = Math.hypot(dx, dy)
  if (d < 1e-6) return
  const aheadX = Math.floor(e.x + (dx / d) * 0.45)
  const aheadY = Math.floor(e.y + (dy / d) * 0.45)
  if (!ignoreBlockers && (aheadX !== Math.floor(e.x) || aheadY !== Math.floor(e.y))) {
    const bl = blockerAt(s, aheadX, aheadY)
    if (bl) {
      if (bl.kind === 'core') { e.mode = 'attack'; e.targetKind = 'core'; e.targetId = 0 }
      else setAttackFromBlocker(s, e, bl)
      return
    }
  }
  const spd = ENEMY_DEFS[e.kind].speed * terrainSpeedMod(e.x, e.y)
  const step = Math.min(d, spd * dt)
  e.x += (dx / d) * step
  e.y += (dy / d) * step
}

/** 点到旋转堡垒矩形的最短距离（格），供远程敌人决定停车射击。 */
export function fortressDistanceToPoint(s: GameState, x: number, y: number): number {
  const r = fortressRect(s)
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2
  const dx = x - cx, dy = y - cy
  const c = Math.cos(s.fortress.heading), sn = Math.sin(s.fortress.heading)
  const lx = dx * c + dy * sn, ly = -dx * sn + dy * c
  const ox = Math.max(0, Math.abs(lx) - r.w / 2)
  const oy = Math.max(0, Math.abs(ly) - r.h / 2)
  return Math.hypot(ox, oy)
}

function enemyFireAtFortress(s: GameState, e: Enemy, def: (typeof ENEMY_DEFS)[EnemyKind]): void {
  const r = fortressRect(s)
  const tx = r.x + r.w / 2, ty = r.y + r.h / 2
  const heading = bearing(tx - e.x, ty - e.y)
  s.enemyProjectiles.push({
    id: s.nextId++, shooterId: e.id,
    x: e.x, y: e.y, px: e.x, py: e.y, heading,
    speed: def.projectileSpeed, damage: def.projectileDamage, penetration: def.penetration,
    traveled: 0, maxTravel: def.attackRange * M_PER_CELL * 1.25,
  })
}

/** 全部现有敌人的测试用远程模式：进入射程即停车，按各自间隔发射直线实弹。 */
function updateEnemyRangedAttack(s: GameState, e: Enemy, def: (typeof ENEMY_DEFS)[EnemyKind], dt: number): boolean {
  const distance = fortressDistanceToPoint(s, e.x, e.y)
  if (distance > def.attackRange) {
    if (e.mode === 'attack' && e.targetKind === 'core') {
      e.mode = 'move'; e.targetKind = null; e.targetId = null; e.hasGoal = false
    }
    return false
  }
  e.mode = 'attack'; e.targetKind = 'core'; e.targetId = 0; e.hasGoal = false
  e.attackCooldown = (e.attackCooldown ?? 0) - dt
  if (e.attackCooldown <= 0) {
    enemyFireAtFortress(s, e, def)
    e.attackCooldown += def.attackInterval
    if (e.attackCooldown <= 0) e.attackCooldown = def.attackInterval
  }
  return true
}

function updateEnemy(s: GameState, e: Enemy, dist: number[], dt: number) {
  const def = ENEMY_DEFS[e.kind]
  e.hitFlash = Math.max(0, e.hitFlash - dt)

  if (updateEnemyRangedAttack(s, e, def, dt)) return

  // 攻击状态：目标失效才重选（§6.3 重寻路不打断攻击）
  if (e.mode === 'attack') {
    const ok = e.targetKind === 'core'
      ? enemyDealDamage(s, e, def.dps, dt)
      : enemyDealDamage(s, e, def.dps * dt)
    if (!ok) {
      e.mode = 'move'
      e.targetKind = null
      e.targetId = null
      e.hasGoal = false
    }
    return
  }

  // 地面敌人：附近的地面友军单位会缠住它（空中敌人/飞行友军互不理会，v1）
  if (!def.air) {
    let near: Ally | null = null
    let nd = Infinity
    for (const a of s.allies) {
      if (a.hp <= 0 || ALLY_DEFS[a.kind].air) continue
      const d = Math.hypot(a.x - e.x, a.y - e.y)
      if (d < nd) { nd = d; near = a }
    }
    if (near && nd < 0.7) {
      e.mode = 'attack'
      e.targetKind = 'ally'
      e.targetId = near.id
      return
    }
  }

  // 飞行单位：无视地面阻挡直冲堡垒（移动目标，每帧追踪当前位置）
  if (def.air) {
    const fc = fortressCenter(s)
    moveToward(s, e, fc.x, fc.y, dt, true)
    if ((e.mode as Enemy['mode']) === 'attack') return
    if (Math.hypot(e.x - fc.x, e.y - fc.y) < 1.2) {
      e.mode = 'attack'
      e.targetKind = 'core'
      e.targetId = 0
    }
    return
  }

  // 地面单位：沿距离场追击堡垒（移动堡垒无炮塔反击，统一以船体为目标）
  followPath(s, e, dist, dt)
}

// ================= 炮塔行为（炮塔文档 §4–§6） =================

// v2.22：人员/最少人员参数已删除——炮塔不再需要人员运转，原 §6.1 人员减益（crewFactor）移除，效率系数恒 1

interface AimResult { target: Enemy | null; desired: number; canFire: boolean }

/** 瞄准基角：挂载炮塔随船头朝向，地面炮塔恒 0（朝上） */
function aimBase(s: GameState, t: Turret): number {
  return t.hardpointId ? s.fortress.heading : 0
}

/** 无目标回中角：固定视角回固定角，有视界回视界中点，否则回基角 */
function aimRestAngle(s: GameState, t: Turret): number {
  const base = aimBase(s, t)
  const hp = t.hardpointId ? hardpointOf(s, t.hardpointId) : undefined
  if (hp?.fixed !== undefined) return wrapAngle(base + hp.fixed * DEG) // v1.98 固定视角
  if (hp?.arc) return wrapAngle(base + hardpointArcMid(hp.arc))
  return base
}

/** v2.49 候选目标列表（索敌注入钩子）：现为全部敌人；未来敌方堡垒/生产单位/可拦截导弹并入此处即可被标签体系覆盖 */
function targetCandidates(s: GameState): Enemy[] {
  return s.enemies
}

/** v2.49 标签打分：基础分 = 距堡垒（含 nearTurret 偏好时改距炮塔）；各 prefer 标签权重因子连乘（越小越优先） */
function tagScore(s: GameState, c: { x: number; y: number }, e: Enemy, def: TurretDef): number {
  const ed = ENEMY_DEFS[e.kind]
  const prefers = def.tags?.filter((tg): tg is Extract<TurretTag, { kind: 'prefer' }> => tg.kind === 'prefer')
  const nearT = prefers?.some(p => p.key === 'nearTurret')
  let score = nearT ? Math.hypot(e.x - c.x, e.y - c.y) : distToFortress(s, e)
  // 空军旧加权（×0.5 优先拦截）：无 air/ground 偏好标签时保留，向后兼容
  if (!prefers?.some(p => p.key === 'air' || p.key === 'ground') && ed.air) score *= 0.5
  if (prefers) {
    for (const p of prefers) {
      switch (p.key) {
        case 'air': if (ed.air) score *= 0.5; break
        case 'ground': if (!ed.air) score *= 0.5; break
        case 'hpMax': score *= 1 / (1 + e.hp / 100); break
        case 'hpMin': score *= 1 + e.hp / 100; break
        case 'sizeBig': score *= 1 / (1 + ed.size / 0.35); break
        case 'sizeSmall': score *= 1 + ed.size / 0.35; break
        // nearFortress / nearTurret 已体现在基础分；预留键（fortress/wingman/missile/spawned）实体上线后生效
      }
    }
  }
  return score
}

function aim(s: GameState, t: Turret, def: TurretDef, factor: number): AimResult {
  const c = turretCenter(t)
  const minR = def.rangeMin
  const maxR = def.rangeMax * (1 + turretRangeBonus(s)) // 火控雷达：射程增益（按炮塔数摊薄）
  const excludes = def.tags?.filter((tg): tg is Extract<TurretTag, { kind: 'exclude' }> => tg.kind === 'exclude')
  let best: Enemy | null = null
  let bestScore = Infinity
  for (const e of targetCandidates(s)) {
    if (e.hp <= 0) continue
    const ed = ENEMY_DEFS[e.kind]
    if (ed.air && !def.canAir) continue // §验收3：仅对地不索空
    if (!ed.air && !def.canGround) continue
    // v2.49 约束标签（硬过滤）
    if (excludes) {
      if (ed.air && excludes.some(x => x.key === 'air')) continue
      if (!ed.air && excludes.some(x => x.key === 'ground')) continue
    }
    const distM = Math.hypot(e.x - c.x, e.y - c.y) * M_PER_CELL
    if (distM < minR || distM > maxR) continue // §射程区间外不可瞄准
    const score = tagScore(s, c, e, def)
    if (score < bestScore) { bestScore = score; best = e }
  }
  if (!best) {
    // 无目标：炮口缓慢回中（挂载炮塔回视界中点/船头向）
    const rest = aimRestAngle(s, t)
    const rot = def.rotateSpeed * factor * DEG
    const dtAim = wrapAngle(rest - t.angle)
    const step = Math.min(Math.abs(dtAim), rot * lastDt)
    t.angle = wrapAngle(t.angle + Math.sign(dtAim) * step)
    return { target: null, desired: rest, canFire: false }
  }
  const b = bearing(best.x - c.x, best.y - c.y)
  const base = aimBase(s, t)
  const hp = t.hardpointId ? hardpointOf(s, t.hardpointId) : undefined
  // v1.98 固定视角（度，-180~180，上=0 顺正逆负）
  const fixed98 = hp?.fixed
  const coneR = Math.max((def.aimCone / 2) * DEG, 4 * DEG) // 射角：免转瞄准锥，最小 4°
  // v1.98：炮塔级最大角度（def.arc）已取消——全视角 360° 自由旋转；仅炮位视界/固定视角约束
  let clampedRel: number // 相对基角
  let inArc: boolean
  if (fixed98 !== undefined) {
    // 固定视角：期望角恒为固定角，炮口不追踪目标；开火由下方射角锥 aligned 判定
    clampedRel = fixed98 * DEG
    inArc = true
  } else if (hp?.arc) {
    // 指定视角：目标须在视界区间内方可开火；期望角钳制进视界
    inArc = hardpointArcContains(hp.arc, wrapAngle(b - base))
    clampedRel = clampToHardpointArc(hp.arc, wrapAngle(b - base))
  } else {
    // 全视角：360° 自由旋转
    clampedRel = wrapAngle(b - base)
    inArc = true
  }
  const clamped = wrapAngle(base + clampedRel)
  // §4.1 旋转速度（度/秒；v2.22 人员减益已移除，factor 恒 1）
  const rot = def.rotateSpeed * factor * DEG
  const diff = wrapAngle(clamped - t.angle)
  // §射角：目标在射角内时无需转动炮塔；仅当目标偏离射角时才旋转，转到目标进入射角即停（炮口方向恒为射角中心）
  if (Math.abs(diff) > coneR) {
    const step = Math.min(Math.abs(diff) - coneR, rot * lastDt)
    t.angle = wrapAngle(t.angle + Math.sign(diff) * step)
  }
  // 最大角度与炮位视界外不可射击；目标在射角内即可开火
  const aligned = Math.abs(wrapAngle(b - t.angle)) <= coneR + 1e-9
  return { target: best, desired: b, canFire: inArc && aligned }
}

// lastDt：aim/旋转步长使用的本帧 dt（updateTurrets 入口设置）
let lastDt = 0.1

function accuracyOffset(eventId: number, radiusM: number): { dx: number; dy: number } {
  // §6.3：以瞄准点为圆心、精度值为半径随机取命中点
  if (radiusM <= 0) return { dx: 0, dy: 0 }
  const a = eventRandom(eventId, 0) * TAU
  const r = Math.sqrt(eventRandom(eventId, 1)) * m2c(radiusM)
  return { dx: Math.cos(a) * r, dy: Math.sin(a) * r }
}

/** art 配置坐标（相对轴心，炮口朝上基准系：x 向右为正、y 向上=沿炮口方向为正，单位格）→ 世界坐标（随 t.angle 旋转） */
export function artPoint(t: Turret, def: TurretDef, pt: readonly [number, number]): { x: number; y: number } {
  const a = def.art?.anchor ?? [0.5, 0.5]
  const ax = t.x + a[0] * t.w
  const ay = t.y + a[1] * t.h
  const dx = dirX(t.angle)
  const dy = dirY(t.angle)
  const px = -dy // 面向炮口时的右手边（屏幕顺时针 90°）
  const py = dx
  return { x: ax + px * pt[0] + dx * pt[1], y: ay + py * pt[0] + dy * pt[1] }
}

/** v1.82：炮塔渲染层级键（按升序绘制，靠后者叠在上）：尺寸越小层级越低（S=0/M=1/L=2）；
 *  同尺寸按挂载炮位 zLevel（缺省 1，越大越高）；地面炮塔 zLevel 视为 1。
 *  配合稳定排序：同键保持放置先后顺序。 */
export function turretRenderKey(s: GameState, t: Turret): [number, number] {
  const m = defOf(t.defId).mount
  const rank = m === 'L' ? 2 : m === 'M' ? 1 : 0
  const z = t.hardpointId != null ? (hardpointOf(s, t.hardpointId)?.zLevel ?? 1) : 1
  return [rank, z]
}

const artMismatchWarned = new Set<string>()

/** 炮管口位置：配置 art.barrels 挂点表时以各 barrel.muzzle 为准（取代均布公式）；
 * 未配置：单管 = 炮塔中心（现状）；多管沿垂直炮口方向均布 + 沿炮口方向前伸 0.35 格 */
/** 有效挂点表（配置优先，未配置按逻辑炮管数自动生成；渲染/出生点共享同一规则） */
export function artMounts(t: Turret, def: TurretDef): { mount: [number, number]; muzzle: [number, number]; recoil: number }[] {
  const cfg = def.art?.barrels
  const uni = def.art?.recoil // v1.58 统一后坐：全管共用，优先于遗留逐管 recoil
  if (cfg && cfg.length > 0) return cfg.map(b => ({ mount: b.mount, muzzle: b.muzzle, recoil: uni ?? b.recoil ?? 0.1 }))
  const n = Math.max(1, Math.floor(def.barrels ?? 1))
  if (n <= 1) return [{ mount: [0, 0], muzzle: [0, 0.35], recoil: uni ?? 0.1 }]
  const spread = t.w * 0.6
  return Array.from({ length: n }, (_, i) => {
    const lat = (i - (n - 1) / 2) * (spread / (n - 1))
    return { mount: [lat, 0] as [number, number], muzzle: [lat, 0.35] as [number, number], recoil: uni ?? 0.1 }
  })
}

export const RACK_RELOAD_ANIM = 0.25 // 复挂渐显推入时长（秒）
const RACK_SLOT_SPACING = 0.34 * 0.48 // 挂载弹逐枚向后间距（格；= 弹宽×1.2 同 render 规则）

/** 挂载弹世界坐标（引擎/渲染共享，消除两套公式漂移）：挂点 + rack.dx/dy 偏移 + slot 向后间距，随炮塔旋转 */
export function rackMissilePos(t: Turret, def: TurretDef, barrelIdx: number, slot: number): { x: number; y: number } {
  const mounts = artMounts(t, def)
  const b = mounts[barrelIdx % mounts.length]
  const dx = def.art?.rack?.dx ?? 0
  const dy = def.art?.rack?.dy ?? 0.12
  return artPoint(t, def, [b.mount[0] + dx, b.mount[1] + dy - slot * RACK_SLOT_SPACING])
}

/** 挂载显示：每管待发弹数（rackLeft 均分；轮流模式从 barrelIdx 侧开始扣余数——当前管优先消耗先空） */
export function rackCounts(t: Turret, def: TurretDef, nBar: number): number[] {
  const per = Math.floor(t.rackLeft / nBar)
  const extra = t.rackLeft % nBar
  const start = (def.barrelMode ?? 'salvo') === 'sequential' ? t.barrelIdx : 0
  return Array.from({ length: nBar }, (_, bi) => per + (((bi - start) % nBar + nBar) % nBar < extra ? 1 : 0))
}

export function muzzlePos(t: Turret, def: TurretDef, barrelIdx: number): { x: number; y: number } {
  const c = turretCenter(t)
  const n = Math.max(1, Math.floor(def.barrels ?? 1))
  const artBarrels = def.art?.barrels
  if (artBarrels && artBarrels.length > 0) {
    if (artBarrels.length !== n && !artMismatchWarned.has(def.id)) { // 数量不一致：以挂点表为准，警告一次（P3 做面板提示）
      artMismatchWarned.add(def.id)
      console.warn(`[art] 炮塔 ${def.id} 挂点表数量(${artBarrels.length})与逻辑炮管数(${n})不一致，渲染/出生点以挂点表为准`)
    }
    const b = artBarrels[barrelIdx % artBarrels.length]
    return artPoint(t, def, b.muzzle)
  }
  if (n <= 1) return c
  const spread = t.w * 0.6 // 均布总宽（格）
  const lat = (barrelIdx - (n - 1) / 2) * (spread / (n - 1))
  const px = -dirY(t.angle) // 垂直于炮口方向
  const py = dirX(t.angle)
  return { x: c.x + px * lat + dirX(t.angle) * 0.35, y: c.y + py * lat + dirY(t.angle) * 0.35 }
}

function fireGunShot(s: GameState, t: Turret, def: TurretDef, target: Enemy, dt: number, muzzle?: { x: number; y: number }) {
  const c = muzzle ?? turretCenter(t)
  const lvl = t.level
  const scale = levelScale(lvl)
  if (def.type === 'beam') {
    // 脉冲点射：即时单体命中，无宽幅、不可穿透、无弹道飞行时间
    // 炮口→目标视线被阻挡弹道物体截断时，命中物体并扣其耐久
    const d = Math.hypot(target.x - c.x, target.y - c.y)
    let hx = target.x
    let hy = target.y
    let blocker: BattleObject | null = null
    if (d > 1e-6) {
      for (let l = 0.2; l < d; l += 0.2) {
        const px = c.x + (target.x - c.x) / d * l
        const py = c.y + (target.y - c.y) / d * l
        const o = projectileBlockerAt(s, Math.floor(px), Math.floor(py))
        if (o) { blocker = o; hx = px; hy = py; break }
      }
    }
    if (blocker) damageObject(s, blocker, def.damage * scale)
    else damageEnemy(s, target, def.damage * scale, t.id)
    s.tracers.push({ id: s.nextId++, x1: c.x, y1: c.y, x2: hx, y2: hy, ttl: 0.07, pulse: true, defId: t.defId }) // v2.7：defId 供渲染端解析光束美术配置
    // v2.7：点射命中点特效（弹丸库 ray 条目 impact 参数；无配置不产生事件=现状）
    if (def.art?.projectile) {
      s.impacts.push({ id: s.nextId++, x: hx, y: hy, ttl: 0.15, max: 0.15, ammoId: def.art.projectile })
    }
  } else if (def.type === 'direct') {
    const off = accuracyOffset(s.nextId, def.accuracy ?? 0)
    const ax = target.x + off.dx
    const ay = target.y + off.dy
    const h = bearing(ax - c.x, ay - c.y)
    // v1.79：开火（tick 步骤4）先于弹道推进（步骤5），同 tick 内弹丸会被立刻前移 v·dt——
    // 弹速越快首帧离炮口越远（400m/s × 0.1s = 1.6格）。出生点沿弹道反向预偏一个 tick 行程，
    // 首帧渲染恰好位于炮口；traveled 负初始化保持射程口径（traveled>maxTravel 消亡点）不变。
    const stepM = (def.projectileSpeed ?? 200) * dt
    const bx = c.x - dirX(h) * m2c(stepM)
    const by = c.y - dirY(h) * m2c(stepM)
    s.projectiles.push({
      id: s.nextId++, kind: 'bullet', defId: t.defId, level: lvl,
      x: bx, y: by, px: bx, py: by, heading: h,
      damage: def.damage * scale, traveled: -stepM, maxTravel: def.rangeMax + M_PER_CELL,
      shooter: t.id, hitIds: [],
      t: 0, flightTime: 0, sx: 0, sy: 0, tx: 0, ty: 0,
      speed: 0, turnRate: 0, guided: false, targetId: null, lockX: 0, lockY: 0, lostLock: false, prevDist: -1,
      weavePhase: 0,
    })
    // 直射弹丸不推发射曳光线：弹丸尾迹由 render 按弹丸美术配置绘制（v2.46：无尾焰配置=无尾迹），
    // 发射瞬间到目标点的整条直线会造成"先拉一条直线再出子弹"的视觉 bug
  } else if (def.type === 'lob') {
    const off = accuracyOffset(s.nextId, def.accuracy ?? 0)
    const tx = target.x + off.dx
    const ty = target.y + off.dy
    const distM = Math.hypot(tx - c.x, ty - c.y) * M_PER_CELL
    s.projectiles.push({
      id: s.nextId++, kind: 'shell', defId: t.defId, level: lvl,
      x: c.x, y: c.y, px: c.x, py: c.y, heading: 0,
      damage: def.damage * scale, traveled: 0, maxTravel: 0,
      shooter: t.id, hitIds: [],
      t: 0, flightTime: Math.max(0.3, distM / (def.projectileSpeed ?? 60)),
      sx: c.x, sy: c.y, tx, ty,
      speed: 0, turnRate: 0, guided: false, targetId: null, lockX: 0, lockY: 0, lostLock: false, prevDist: -1,
      weavePhase: 0,
    })
  } else if (def.type === 'missile') {
    let guided = !!def.guided
    const off = guided ? { dx: 0, dy: 0 } : accuracyOffset(s.nextId, def.accuracy ?? 0)
    // §6.4：非制导发射瞬间锁定落点坐标，之后不再修正
    let lockX = target.x + off.dx
    let lockY = target.y + off.dy
    // 发射时检查：炮口→目标线段穿过阻挡弹道物体，且目标刚好在物体后面（格距 ≤1）
    // => 导弹被物体阻挡，直飞物体位置爆炸并结算物体耐久；否则完全越过物体（飞行途中无碰撞）
    const blockAt = missileBlockPoint(s, c.x, c.y, lockX, lockY)
    if (blockAt) {
      lockX = blockAt.x
      lockY = blockAt.y
      guided = false // 退化为直飞撞击点
    }
    // v1.94 延迟制导：guided + guideDelay>0 → 发射航向取炮塔方向（t.angle），延迟期内直飞不追踪
    const delay94 = guided ? Math.max(0, Math.min(2, def.guideDelay ?? 0)) : 0
    // v2.20 出膛偏角：延迟期内初始航向 = 炮塔方向 + ejectAngle（度）——侧抛/垂发式发射
    let h = delay94 > 0 ? wrapAngle(t.angle + (def.ejectAngle ?? 0) * DEG) : bearing(lockX - c.x, lockY - c.y)
    let speed0 = Math.max(0, def.missileInitSpeed ?? 0)
    // v2.33 载体速度继承：堡垒挂载炮塔（hardpointId）发射的导弹，出生速度向量 += 堡垒移动速度（格/s→m/s），
    // 合成后折回 航向+标量初速（点火制导后仍完全自驱动，与现状一致；地面炮塔不继承）
    if (t.hardpointId) {
      const fvx = s.fortress.vx * M_PER_CELL
      const fvy = s.fortress.vy * M_PER_CELL
      if (fvx !== 0 || fvy !== 0) {
        const vx = dirX(h) * speed0 + fvx
        const vy = dirY(h) * speed0 + fvy
        const v0 = Math.hypot(vx, vy)
        if (v0 > 1e-6) { speed0 = v0; h = bearing(vx, vy) } // 抵消归零时保持原航向
      }
    }
    const missileId = s.nextId++
    s.projectiles.push({
      id: missileId, kind: 'missile', defId: t.defId, level: lvl,
      x: c.x, y: c.y, px: c.x, py: c.y, heading: h,
      damage: def.damage * scale, traveled: 0, maxTravel: def.rangeMax * 1.3,
      shooter: t.id, hitIds: [],
      t: 0, flightTime: 0, sx: 0, sy: 0, tx: 0, ty: 0,
      speed: speed0, turnRate: 0, guided: delay94 > 0 ? false : guided, targetId: guided ? target.id : null, // v1.96：出生初速度（缺省 0）；v2.33：挂载弹含载体速度合成
      lockX, lockY, lostLock: false, prevDist: -1,
      flightLeft: def.missileFlightTime, // 未配置则为 undefined（不限飞行时间）
      weavePhase: eventRandom(missileId, 2) * TAU, // 曲线摆动相位（按事件 id 确定性派生）
      guideDelayLeft: delay94 > 0 ? delay94 : undefined, // v1.94：仅延迟制导弹携带
      tgtPX: guided ? target.x : undefined, tgtPY: guided ? target.y : undefined, // v2.20 前置量追踪：速度采样基线
      igniteAtT: delay94, // v2.23：点火时刻弹龄（无延迟=0=出生即点火）
    })
  }
}

/** 导弹阻挡判定：炮口→目标线段上首个阻挡弹道物体，且目标格紧邻该物体（沿线格距 ≤1）时返回撞击点 */
function missileBlockPoint(s: GameState, x1: number, y1: number, x2: number, y2: number): { x: number; y: number } | null {
  const d = Math.hypot(x2 - x1, y2 - y1)
  if (d < 1e-6) return null
  const tx = Math.floor(x2)
  const ty = Math.floor(y2)
  for (let l = 0.2; l < d; l += 0.2) {
    const px = x1 + (x2 - x1) / d * l
    const py = y1 + (y2 - y1) / d * l
    const o = projectileBlockerAt(s, Math.floor(px), Math.floor(py))
    if (!o) continue
    // 目标刚好在物体后面：目标格与物体矩形沿线的格距 ≤ 物体高度 height
    const gdx = Math.max(o.x - tx, 0, tx - (o.x + o.w - 1))
    const gdy = Math.max(o.y - ty, 0, ty - (o.y + o.h - 1))
    if (Math.hypot(gdx, gdy) <= (o.height || 1)) return { x: px, y: py }
    // 目标远离该物体：越过它继续检查（导弹一般可越过阻挡弹道的物体）
  }
  return null
}

/** 光束推进：矩形在首个阻挡弹道物体格截断，返回长度与截断物体（§7.2 新口径：仅物体挡弹道） */
export function beamMarch(s: GameState, t: Turret, def: TurretDef): { len: number; blocker: BattleObject | null } {
  const c = turretCenter(t)
  const maxC = m2c(def.rangeMax)
  const stepLen = 0.2
  let len = 0
  while (len < maxC) {
    len = Math.min(maxC, len + stepLen)
    const x = Math.floor(c.x + dirX(t.angle) * len)
    const y = Math.floor(c.y + dirY(t.angle) * len)
    if (x < 0 || x >= LEVEL.cols || y < 0 || y >= LEVEL.rows) break
    const o = projectileBlockerAt(s, x, y)
    if (o) return { len: Math.max(0, len - stepLen), blocker: o }
  }
  return { len: Math.max(0, len), blocker: null }
}

/** 射线矩形端点长度（格）：被阻挡弹道的物体截断 */
export const BEAM_ON_SPEED = 2400 // v2.35 光束起射伸展速度（m/s，非常快：250m 射程 ≈0.10s 到位；视觉与伤害范围同步）

/** 光束当前长度（格）：beamMarch 截断全长 × 起射伸展 ramp（beamOnAt 起按 BEAM_ON_SPEED 伸展，到位后恒=全长） */
export function beamLength(s: GameState, t: Turret, def: TurretDef): number {
  const full = beamMarch(s, t, def).len
  if (t.beamOnAt === undefined) return full
  return Math.min(full, m2c((s.time - t.beamOnAt) * BEAM_ON_SPEED))
}

function beamTick(s: GameState, t: Turret, def: TurretDef) {
  const c = turretCenter(t)
  const march = beamMarch(s, t, def)
  const len = beamLength(s, t, def) // v2.35：伤害范围随起射伸展 ramp（伸展未到的区段不结算）
  const blocker = len >= march.len - 1e-9 ? march.blocker : null // 伸展未触及截断物体时不结算其耐久
  const halfW = m2c(def.beamWidth ?? 2) / 2
  const dot = def.dot!
  const scale = levelScale(t.level)
  for (const e of s.enemies) {
    const dx = e.x - c.x
    const dy = e.y - c.y
    const along = dx * dirX(t.angle) + dy * dirY(t.angle)
    if (along < 0 || along > len) continue
    const perp = Math.abs(dx * dirY(t.angle) * -1 + dy * dirX(t.angle)) // |cross|
    if (perp <= halfW + ENEMY_DEFS[e.kind].size) {
      damageEnemy(s, e, dot.damage * scale, t.id)
    }
  }
  // 每个伤害 tick 同时对截断光束的物体扣耐久（hp=-1 物体在 damageObject 内豁免）
  if (blocker) damageObject(s, blocker, dot.damage * scale)
  // v2.7：光束 DoT 端点命中特效（与点射共用弹丸库 ray 条目 impact 参数；无配置不产生事件=现状）
  if (def.art?.projectile) {
    s.impacts.push({
      id: s.nextId++,
      x: c.x + dirX(t.angle) * len, y: c.y + dirY(t.angle) * len,
      ttl: 0.15, max: 0.15, ammoId: def.art.projectile,
    })
  }
}

function sprayTick(s: GameState, t: Turret, def: TurretDef) {
  const c = turretCenter(t)
  const rC = m2c(def.rangeMax)
  const halfA = (def.sprayAngle ?? 60) * DEG / 2
  const dot = def.dot!
  const scale = levelScale(t.level)
  for (const e of s.enemies) {
    if (ENEMY_DEFS[e.kind].air && !def.canAir) continue
    const dx = e.x - c.x
    const dy = e.y - c.y
    const dE = Math.hypot(dx, dy)
    if (dE > rC + ENEMY_DEFS[e.kind].size) continue
    if (Math.abs(wrapAngle(bearing(dx, dy) - t.angle)) > halfA) continue
    // 喷射在首个阻挡弹道物体格截断：物体后方的敌人不被命中
    let shielded = false
    for (let l = 0.2; l < dE; l += 0.2) {
      if (projectileBlockerAt(s, Math.floor(c.x + dx / dE * l), Math.floor(c.y + dy / dE * l))) {
        shielded = true
        break
      }
    }
    if (!shielded) damageEnemy(s, e, dot.damage * scale, t.id)
  }
  // 扇形内阻挡弹道的物体按 tick 扣耐久（hp=-1 豁免）
  for (const o of s.objects) {
    if (!o.blockProjectile || o.hp <= 0) continue
    const odx = o.x + o.w / 2 - c.x
    const ody = o.y + o.h / 2 - c.y
    if (Math.hypot(odx, ody) > rC + Math.max(o.w, o.h) / 2) continue
    if (Math.abs(wrapAngle(bearing(odx, ody) - t.angle)) <= halfA) damageObject(s, o, dot.damage * scale)
  }
}

/** 炮塔 tick 包装：热量已汇聚到堡垒（coolFortress 统一散热）；此处仅保留光束停火消退表现 */
function updateTurret(s: GameState, t: Turret, dt: number) {
  const def = defOf(t.defId)
  const wasFiring = t.firing // 持续型（光束/喷射）射击中
  updateTurretBody(s, t, dt)
  // v2.35 光束起射伸展（firing 转换沿 false→true 记起射时刻）：点射不触发
  if (!wasFiring && t.firing && def.type === 'beam' && (def.rayMode ?? 'beam') === 'beam') t.beamOnAt = s.time
  // 光束停火消退（firing 转换沿 true→false 推一次）：覆盖持续结束/目标丢失/资源中断/过热；点射与未起射不触发
  if (wasFiring && !t.firing && def.type === 'beam' && (def.rayMode ?? 'beam') === 'beam') {
    const c = def.art?.barrels?.length ? muzzlePos(t, def, 0) : turretCenter(t) // 与光束起点同规则
    s.beamFades.push({
      id: s.nextId++, defId: t.defId, x: c.x, y: c.y, angle: t.angle,
      len: beamLength(s, t, def), width: def.beamWidth, // v2.50：不再 ?? 8——保留 undefined 以区分"未配置宽幅"（消退段贴图原生高度）
      ttl: BEAM_FADE, max: BEAM_FADE,
    })
    t.beamOnAt = undefined // v2.35：停火清除起射锚点（消退段长度已快照）
  }
}


/** v2.49 资源标签门控（硬开关）：任一 resource 标签条件成立 → 禁止开火。阈值均为占上限百分比 0-100 */
function resourceHold(s: GameState, def: TurretDef): boolean {
  if (!def.tags?.some(tg => tg.kind === 'resource')) return false
  const caps = resourceCaps(s)
  const pct = (k: ResourceTagKey): number => {
    switch (k) {
      case 'ammo': return caps.ammoCap > 0 ? s.ammo / caps.ammoCap * 100 : 100
      case 'energy': return caps.energyCap > 0 ? s.energy / caps.energyCap * 100 : 100
      case 'heat': { const cap = fortressDef(s).heatCap; return cap > 0 ? s.fortress.heat / cap * 100 : 0 }
      case 'defense': return s.fortress.maxHp > 0 ? s.fortress.hp / s.fortress.maxHp * 100 : 100
    }
  }
  for (const tg of def.tags) {
    if (tg.kind !== 'resource') continue
    const v = pct(tg.res)
    if (tg.op === 'lt' ? v < tg.value : v > tg.value) return true
  }
  return false
}

function updateTurretBody(s: GameState, t: Turret, dt: number) {
  const def = defOf(t.defId)
  if (t.rackAnim > 0) t.rackAnim = Math.max(0, t.rackAnim - dt) // 复挂渐显推入动画衰减（无条件的每 tick）
  // 导弹逐枚渐进复挂：一轮打空（burstLeft→0）后计时，每隔 X=fireRate/(burst+1) 秒 rackLeft+1 至满挂；
  // 轮中（burstLeft>0，含中断暂停）/满挂不复挂；复挂与索敌无关
  if (def.type === 'missile') {
    const full = Math.max(1, def.burst ?? 1)
    if (t.rackLeft > full) t.rackLeft = full // burst 动态改小 clamp
    if (t.burstLeft > 0 || t.rackLeft >= full) {
      t.rackTimer = 0
    } else {
      const x = def.fireRate / (full + 1)
      if (t.rackTimer <= 0) t.rackTimer = x // 打空后启动计时
      else {
        t.rackTimer -= dt
        if (t.rackTimer <= 0) {
          t.rackLeft++
          t.rackAnim = RACK_RELOAD_ANIM // 逐枚推入动画（仅最新枚，render 按 slot 判定）
          t.rackTimer = t.rackLeft < full ? x : 0
        }
      }
    }
  }
  const factor = 1 // v2.22：人员机制删除后效率系数恒 1（原 crewFactor：人员缺失降低转速/射速）

  // 堡垒过热：全炮塔停火（热量汇聚替代单炮塔过热；解除由 coolFortress 迟滞控制）
  if (s.fortress.overheated) { t.firing = false; t.burstLeft = 0; t.chargeLeft = 0; return }

  // v2.49 资源标签门控：条件成立即停火（持续型中断/连发中止/充能取消，与过热同径）
  if (resourceHold(s, def)) { t.firing = false; t.burstLeft = 0; t.chargeLeft = 0; return }

  // 射线维持电量（§4.5 / §6.8）：中断则停止运作
  if (def.type === 'beam' && def.energyPerSec) {
    const need = def.energyPerSec * dt
    if (s.energy < need) { s.energy = 0; t.firing = false; return }
    s.energy -= need
  }

  t.cooldown -= dt
  // 光束（rayMode:'beam'）持续发射期间转向速度削减 50%（BEAM_TURN_FACTOR）；点射模式不受影响
  const beamFiring = def.type === 'beam' && (def.rayMode ?? 'beam') === 'beam' && t.firing
  const { target, canFire } = aim(
    s, t,
    beamFiring ? { ...def, rotateSpeed: def.rotateSpeed * BEAM_TURN_FACTOR } : def,
    factor,
  )

  // 充能前摇（Starsector chargeup）：每次开火周期（实弹每轮 / 持续型每次 attackDuration）起射前先充能 chargeTime 秒
  if (def.chargeTime && def.chargeTime > 0) {
    const sustained = def.type === 'spray' || (def.type === 'beam' && (def.rayMode ?? 'beam') === 'beam')
    // v2.15：充能最后一帧不算在充能时间内——chargeLeft 计到 0 后进入 0.1s 末帧滞留（负值段），滞留结束才起射
    if (t.chargeLeft !== 0) { // >0 充能中；(-CHARGE_LAST_HOLD, 0) 末帧滞留
      if (!target || !canFire) t.chargeLeft = 0 // 目标丢失/移出射程射界 → 取消充能，重新索敌后重新充能
      else {
        t.chargeLeft -= dt // 充能期间不射击、不涨热、不耗弹药/电量（包装层视为"不射击"可自然散热）
        if (t.chargeLeft <= -CHARGE_LAST_HOLD) t.chargeLeft = 0 // 滞留结束当 tick 起正常开火
        else { if (t.chargeLeft === 0) t.chargeLeft = -1e-9; return } // 充能中/末帧滞留（恰落 0 须转入滞留段，否则下 tick 被当作空闲态）
      }
    } else if (target && canFire && t.cooldown <= 0 && (sustained ? !t.firing : t.burstLeft <= 0)) {
      t.chargeLeft = def.chargeTime // 新一轮起射前进入充能（轮内连发/齐射/轮流不重复充能）
      return
    }
  }

  // 持续型武器（光束/喷射）状态机（§6.6）；脉冲点射走下方实弹类轮+连发流程
  if (def.type === 'spray' || (def.type === 'beam' && (def.rayMode ?? 'beam') === 'beam')) {
    // 持续型武器状态机（§6.6）
    if (t.firing) {
      // 资源中断立即停射（§6.8）
      if (def.type === 'spray' && def.ammoPerSec) {
        const need = def.ammoPerSec * dt
        if (s.ammo < need) { s.ammo = 0; t.firing = false; t.cooldown = def.reload ?? 1; return }
        s.ammo -= need
      }
      t.tickTimer -= dt
      if (t.tickTimer <= 0) {
        // v2.35：光束起射伸展期间 DoT 计时器不消费——否则首帧 len=0 空打后白等一整个 DoT 间隔，
        // 伤害会被拖到伸展完成后 0.5s。待光束伸展到全长（或抵达阻挡物）当帧立刻结算首次伤害。
        if (def.type === 'beam') {
          const len = beamLength(s, t, def)
          const full = beamMarch(s, t, def).len
          if (t.beamOnAt !== undefined && len < full - 1e-9) {
            t.tickTimer = 0 // 伸展中：不消费，下一帧再检测
          } else {
            beamTick(s, t, def)
            t.tickTimer += def.dot!.interval
          }
        } else {
          sprayTick(s, t, def)
          t.tickTimer += def.dot!.interval
        }
      }
      t.firingLeft -= dt
      if (t.firingLeft <= 0) {
        t.firing = false
        t.cooldown = Math.max(def.reload ?? 0, def.fireRate / factor) // fireRate 语义 = s/轮（每轮间隔秒数）
      }
      return
    }
    if (!target || !canFire || t.cooldown > 0) return
    // 开火预检资源
    if (def.type === 'beam' && def.energyPerShot && s.energy < def.energyPerShot) return
    if (def.type === 'spray' && def.ammoPerSec && s.ammo <= 0) return
    if (def.type === 'beam' && def.energyPerShot) s.energy -= def.energyPerShot
    t.firing = true
    t.firingLeft = def.attackDuration ?? 1
    t.tickTimer = 0
    return
  }

  // 实弹类：轮 + 连发（§6.7）
  if (t.burstLeft > 0) {
    t.burstTimer -= dt
    if (t.burstTimer > 0) return
    if (!target || !canFire) { t.burstLeft = 0; return }
    // 多联炮管：齐射 = 每次击发全部炮管各射 1 枚（弹药/热量/电量按实际弹丸数结算）；
    // 轮流 = 每击发 1 枚，从 barrelIdx 炮管射出并轮转（连发间隔 = 相邻两管发射间隔，跨轮不重置）
    const nBarrels = Math.max(1, Math.floor(def.barrels ?? 1))
    const bMode = def.barrelMode ?? 'salvo'
    const shots = nBarrels > 1 && bMode === 'salvo' ? nBarrels : 1
    const rackBefore = def.type === 'missile' ? rackCounts(t, def, nBarrels) : null // 发射前分配（slot 取该管当前枚数-1，与展示消耗一致）
    const ammoNeed = (def.ammoPerShot ?? 0) * shots
    const energyNeed = (def.type === 'beam' ? (def.energyPerShot ?? 0) : 0) * shots // 脉冲点射耗电按发
    if (s.ammo < ammoNeed || s.energy < energyNeed) { t.burstLeft = 0; return } // 资源不足停射（§6.8）
    s.ammo -= ammoNeed
    s.energy -= energyNeed
    for (let i = 0; i < shots; i++) {
      const bi = bMode === 'sequential' ? t.barrelIdx : i
      // 方案1：导弹出生点 = 挂载位（待发弹视觉位置）；实弹/抛射仍炮口点
      const mp = def.type === 'missile'
        ? rackMissilePos(t, def, bi, Math.max(0, (rackBefore?.[bi] ?? 1) - 1))
        : muzzlePos(t, def, bi)
      fireGunShot(s, t, def, target, dt, mp) // v1.79：透传 dt 供弹丸出生点预偏
      // 炮口事件：后坐/火光表现层驱动（齐射每管一条、轮流仅当前管；不跟随旋转）
      const fd = FLASH_DURATION // 火光总时长硬编码 0.2s（v1.45：2 帧 × 0.1s）
      s.muzzles.push({ id: s.nextId++, turretId: t.id, barrelIdx: bi, x: mp.x, y: mp.y, angle: t.angle, ttl: fd, max: fd })
      if (bMode === 'sequential') t.barrelIdx = (t.barrelIdx + 1) % nBarrels
    }
    addFortressHeat(s, (def.heatPerShot ?? 0) * shots) // 产热汇聚到堡垒热量池
    if (def.type === 'missile') t.rackLeft = Math.max(0, t.rackLeft - shots) // 挂载消耗：轮流-1/齐射-N
    t.burstLeft--
    t.burstTimer = def.burstInterval ?? 0
    if (s.fortress.overheated) { t.burstLeft = 0; t.cooldown = 0; return } // 本轮换热过载：中断连发
    if (t.burstLeft === 0) t.cooldown = def.fireRate / factor // s/轮语义
    return
  }
  if (!target || !canFire || t.cooldown > 0) return
  const ammoNeed = (def.ammoPerShot ?? 0)
  const energyNeed = def.type === 'beam' ? (def.energyPerShot ?? 0) : 0
  if (s.ammo < ammoNeed || s.energy < energyNeed) return
  t.burstLeft = Math.max(1, def.burst ?? 1)
  t.burstTimer = 0
}

// ================= 弹道更新 =================

/** 世界线段与旋转后的主体贴图 alpha 首次交点；底座、履带和轮胎不阻挡弹丸。 */
export function enemyProjectileFortressHit(s: GameState, x1: number, y1: number, x2: number, y2: number): { x: number; y: number } | null {
  const r = fortressRect(s)
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2
  const c = Math.cos(s.fortress.heading), sn = Math.sin(s.fortress.heading)
  const local = (x: number, y: number) => {
    const dx = x - cx, dy = y - cy
    return { x: dx * c + dy * sn, y: -dx * sn + dy * c }
  }
  const a = local(x1, y1), b = local(x2, y2)
  const t = fortressBodyMaskSegmentEntry(
    fortressDef(s).spriteBody, r.w, r.h,
    a.x + r.w / 2, a.y + r.h / 2,
    b.x + r.w / 2, b.y + r.h / 2,
  )
  if (t === null) return null
  return { x: x1 + (x2 - x1) * t, y: y1 + (y2 - y1) * t }
}

function updateEnemyProjectile(s: GameState, p: EnemyProjectile, dt: number): boolean {
  const stepM = p.speed * dt
  p.px = p.x; p.py = p.y
  p.x += dirX(p.heading) * m2c(stepM)
  p.y += dirY(p.heading) * m2c(stepM)
  p.traveled += stepM
  const hit = enemyProjectileFortressHit(s, p.px, p.py, p.x, p.y)
  if (hit) {
    const result = damageFortress(s, p.damage, { x: hit.x, y: hit.y, kind: 'projectile', penetration: p.penetration })
    if (result.ricochet) addFloat(s, hit.x, hit.y, '跳弹')
    return false
  }
  const cx = Math.floor(p.x), cy = Math.floor(p.y)
  if (cx < 0 || cx >= LEVEL.cols || cy < 0 || cy >= LEVEL.rows || p.traveled >= p.maxTravel) return false
  const block = projectileBlockerAt(s, cx, cy)
  if (block) {
    damageObject(s, block, p.damage)
    s.explosions.push({ id: s.nextId++, x: p.x, y: p.y, r: 0.2, ttl: 0.12, max: 0.12, kind: 'groundImpact' })
    return false
  }
  return true
}

function updateBullet(s: GameState, p: Projectile, dt: number): boolean {
  const def = defOf(p.defId)
  const stepM = (def.projectileSpeed ?? 200) * dt
  p.px = p.x
  p.py = p.y
  p.x += dirX(p.heading) * m2c(stepM)
  p.y += dirY(p.heading) * m2c(stepM)
  p.traveled += stepM
  // 地形截断弹道（§7.2）
  const cx = Math.floor(p.x)
  const cy = Math.floor(p.y)
  if (cx < 0 || cx >= LEVEL.cols || cy < 0 || cy >= LEVEL.rows) return false
  const blockObj = projectileBlockerAt(s, cx, cy)
  if (blockObj) {
    // 命中阻挡弹道的物体：扣其耐久（hp>0 才扣，归零摧毁），弹丸消失不穿透
    // v2.47：配置爆炸（blastRadius>0）的直射弹命中物体同样触发爆炸（波及由 explode 结算，含物体摧毁）
    if (def.blastRadius !== undefined && def.blastRadius > 0) {
      explode(s, p.x, p.y, def.blastRadius, 0, def.blastEffect, p.shooter, p.level, def.art?.projectile)
    } else {
      s.explosions.push({ id: s.nextId++, x: p.x, y: p.y, r: 0.3, ttl: 0.15 })
    }
    damageObject(s, blockObj, p.damage)
    return false
  }
  // 命中：线段-目标判定，穿透按距离排序（§6.5）
  const hits: { e: Enemy; along: number; qx: number; qy: number }[] = []
  for (const e of s.enemies) {
    if (e.hp <= 0) continue
    const ed = ENEMY_DEFS[e.kind]
    if (ed.air && !def.canAir) continue
    const vx = p.x - p.px
    const vy = p.y - p.py
    const len2 = vx * vx + vy * vy
    let tt = len2 > 0 ? ((e.x - p.px) * vx + (e.y - p.py) * vy) / len2 : 0
    tt = Math.max(0, Math.min(1, tt))
    const qx = p.px + vx * tt
    const qy = p.py + vy * tt
    if (Math.hypot(e.x - qx, e.y - qy) <= ed.size + 0.06) hits.push({ e, along: tt, qx, qy })
  }
  const fresh = hits.filter(h => !p.hitIds.includes(h.e.id))
  if (fresh.length > 0) {
    fresh.sort((a, b) => a.along - b.along)
    const maxTargets = 1 + (def.pierce?.count ?? 0) // §6.5：最多作用 1+穿透数量 个目标
    const decay = def.pierce?.decay ?? 0
    const room = maxTargets - p.hitIds.length
    for (let i = 0; i < Math.min(room, fresh.length); i++) {
      // 第 1 个目标 100%，每穿透 1 个后续伤害 ×(1-衰减幅度)
      const scale = Math.pow(1 - decay, p.hitIds.length)
      damageEnemy(s, fresh[i].e, p.damage * scale, p.shooter)
      p.hitIds.push(fresh[i].e.id)
      // v2.47 实弹爆炸：blastRadius>0 时命中点触发爆炸——直击目标吃 直击+爆炸，波及目标吃爆炸；
      // 伤害基底 0（直击已按穿透衰减结算），爆炸附加/燃烧由 blastEffect 提供；遮挡豁免/物体波及与榴弹同 explode 口径
      if (def.blastRadius !== undefined && def.blastRadius > 0) {
        explode(s, fresh[i].e.x, fresh[i].e.y, def.blastRadius, 0, def.blastEffect, p.shooter, p.level, def.art?.projectile,
          dirX(p.heading), dirY(p.heading), m2c(def.projectileSpeed ?? 200))
      }
      // §3A.5.4：非爆炸命中 → impact 事件（无素材时渲染端无特效=现状）
      // 位置 = 敌人身体上爆开：逻辑坐标是脚底锚点，身体视觉中心在其上方 size×scaleH 格（与渲染 drawEnemy 一致）；
      // 再加每次不同的确定性抖动（半径 ≤ 体型 0.6），次次有差异
      if (def.art?.projectile) {
        const ed2 = ENEMY_DEFS[fresh[i].e.kind]
        const scaleH = fresh[i].e.kind === 'brute' ? 1.35 : 1.15 // 与渲染端精灵高系数一致
        const cy = fresh[i].e.y - ed2.size * scaleH // 身体视觉中心
        const h = Math.abs(Math.sin(fresh[i].e.id * 31.7 + p.hitIds.length * 7.3) * 43758.5453) % 1 // 角度种子
        const h2 = Math.abs(Math.sin(fresh[i].e.id * 11.3 + p.hitIds.length * 3.1) * 24634.6345) % 1 // 半径种子
        const ja = h * Math.PI * 2
        const jr = h2 * ed2.size * 0.6
        s.impacts.push({
          id: s.nextId++,
          x: fresh[i].e.x + Math.cos(ja) * jr, y: cy + Math.sin(ja) * jr,
          ttl: 0.15, max: 0.15, ammoId: def.art.projectile,
        })
      }
    }
    if (p.hitIds.length >= maxTargets) return false
  }
  if (p.traveled >= p.maxTravel) {
    // v2.57：未命中实弹射程耗尽落地，只发无伤害事件供渲染层留下小弹坑。
    s.explosions.push({ id: s.nextId++, x: p.x, y: p.y, r: 0.2, ttl: 0.12, max: 0.12, kind: 'groundImpact' })
    return false
  }
  return true
}

function updateShell(s: GameState, p: Projectile, dt: number): boolean {
  p.t += dt / p.flightTime
  p.px = p.x
  p.py = p.y
  p.x = p.sx + (p.tx - p.sx) * Math.min(1, p.t)
  p.y = p.sy + (p.ty - p.sy) * Math.min(1, p.t)
  if (p.t >= 1) {
    const def = defOf(p.defId)
    // §3A 门控：炮塔未配置爆炸（blastRadius 缺失/≤0）时不走弹丸库爆炸帧图（程序化圈维持）
    const flyLen = Math.hypot(p.tx - p.sx, p.ty - p.sy) || 1 // 命中方向=起点→落点（方向偏置/速度继承）
    explode(s, p.tx, p.ty, def.blastRadius ?? 15, p.damage, def.blastEffect, null, p.level,
      def.blastRadius !== undefined && def.blastRadius > 0 ? def.art?.projectile : undefined,
      (p.tx - p.sx) / flyLen, (p.ty - p.sy) / flyLen, m2c(p.speed))
    return false
  }
  return true
}

/** 制导导弹目标丢失重选：射界过滤（含空/地规则）+ 剩余飞行时间可达性估计，可达者优先取最近 */
function retargetMissile(s: GameState, p: Projectile, def: TurretDef): Enemy | null {
  const cands = s.enemies.filter(e => {
    if (e.hp <= 0) return false
    const ed = ENEMY_DEFS[e.kind]
    if (ed.air && !def.canAir) return false
    if (!ed.air && !def.canGround) return false
    return true
  })
  if (cands.length === 0) return null // 完全无候选：保持直飞最后已知位置（现状）
  const vmax = (def.missileMaxSpeed ?? 0) || p.speed || 1 // 极速兜底当前速度（m/s）
  const fl = p.flightLeft
  const reachable = fl === undefined
    ? cands
    : cands.filter(e => Math.hypot(e.x - p.x, e.y - p.y) * M_PER_CELL / vmax <= fl * MISSILE_RETARGET_MARGIN)
  const pool = reachable.length > 0 ? reachable : cands // 无可达但有候选：取最近（允许飞不到后 fade）
  let best = pool[0]
  let bd = Infinity
  for (const e of pool) {
    const d = Math.hypot(e.x - p.x, e.y - p.y)
    if (d < bd) { bd = d; best = e }
  }
  return best
}

/** v2.20 集束分裂子弹待入队缓冲：updateMissile 在 projectiles.filter 迭代期间触发分裂，
 *  直接 push 进 s.projectiles 会因 filter 缓存原长度而丢失——先入队，filter 结束后由 tick  drain 入数组 */
const splitSpawnQueue: Projectile[] = []

function updateMissile(s: GameState, p: Projectile, dt: number): boolean {
  const def = defOf(p.defId)
  // 淡出阶段：停止制导、惯性直飞、不再命中/爆炸，淡出结束移除
  if (p.fading !== undefined) {
    p.fading -= dt
    p.px = p.x
    p.py = p.y
    p.x += dirX(p.heading) * m2c(p.speed * dt)
    p.y += dirY(p.heading) * m2c(p.speed * dt)
    return p.fading > 0
  }
  // 飞行时间耗尽（未命中）：进入淡出，不再爆炸/伤害
  if (p.flightLeft !== undefined) {
    p.flightLeft -= dt
    if (p.flightLeft <= 0) {
      p.fading = MISSILE_FADE
      p.guided = false
      p.targetId = null
      return true
    }
  }
  p.t += dt // v2.20：弹龄全程计时（weave 相位推进 + burnTime 燃烧时间共用；此前仅 curve>0 时推进，语义等价）
  // v1.94 延迟制导：延迟期沿发射航向直飞，倒计时归零开启制导（targetId 出生时已保留；目标死亡走下方既有重选）
  const inDelay96 = p.guideDelayLeft !== undefined && p.guideDelayLeft > 0
  if (inDelay96) {
    p.guideDelayLeft! -= dt
    if (p.guideDelayLeft! <= 0) p.guided = true
  }
  // 导弹速度：v1.96 延迟期内若配置延迟减速度则减速（下限 0），否则加速度爬升；v1.96 起仅在上限以下才加速（兼容初速度 > 极速）
  // v2.20 燃烧时间：burnTime 期内正常加速，燃尽后惯性滑行（不再加速；渲染侧同步熄灭尾焰/喷口焰）
  const burning20 = def.burnTime === undefined || p.t < def.burnTime
  const decel96 = inDelay96 ? Math.max(0, def.guideDecel ?? 0) : 0
  if (decel96 > 0) p.speed = Math.max(0, p.speed - decel96 * dt)
  else if (burning20) {
    const vmax96 = def.missileMaxSpeed ?? 100
    if (p.speed < vmax96) p.speed = Math.min(vmax96, p.speed + (def.missileAccel ?? 40) * dt)
  }
  let target = p.targetId != null ? s.enemies.find(e => e.id === p.targetId && e.hp > 0) : undefined

  // 制导导弹目标已被消灭/不存在：重选新目标（优先飞行时间内可达者）
  if (p.guided && !target && !p.lostLock) {
    const nt = retargetMissile(s, p, def)
    if (nt) {
      p.targetId = nt.id
      p.lockX = nt.x
      p.lockY = nt.y
      p.prevDist = -1 // 近炸引信基线重置
      p.tgtPX = nt.x // v2.20：前置量速度采样基线同步重置（避免换目标瞬间速度尖峰）
      p.tgtPY = nt.y
      target = nt
    }
  }

  if (p.guided) {
    if (target && !p.lostLock) {
      // v2.20/v2.21 前置量追踪（制导恒为 lead，不再可选纯追踪）：按目标速度（本弹采样位移/dt）
      // 预估拦截点，迭代 1 次；首帧无采样基线时退化为直飞目标当前位置
      let aimX20 = target.x
      let aimY20 = target.y
      if (p.tgtPX !== undefined && p.tgtPY !== undefined && dt > 0) {
        const vx20 = (target.x - p.tgtPX) / dt // 格/秒
        const vy20 = (target.y - p.tgtPY) / dt
        const tHit20 = Math.min(2, Math.hypot(target.x - p.x, target.y - p.y) * M_PER_CELL / Math.max(p.speed, 1)) // 预估命中时间（封顶 2s 防远距过冲）
        aimX20 = target.x + vx20 * tHit20
        aimY20 = target.y + vy20 * tHit20
      }
      p.tgtPX = target.x
      p.tgtPY = target.y
      // 制导：实时追踪，受导弹角速度约束（§6.4.2/3）
      const desired = bearing(aimX20 - p.x, aimY20 - p.y)
      const diff = wrapAngle(desired - p.heading)
      p.turnRate = Math.min((def.missileTurnMax ?? 120) * DEG,
        p.turnRate + (def.missileTurnAccel ?? 240) * DEG * dt)
      const turn = Math.min(Math.abs(diff), p.turnRate * dt)
      p.heading = wrapAngle(p.heading + Math.sign(diff) * turn)
      // v2.1：脱靶判定移除——即使越过目标/转向能力不足也不失去锁定，持续转弯尽量朝目标飞
      // （靠近通过时由下方近炸引信结算擦爆；实在追不上由飞行时间/射程终点收尾）
    }
  }
  // 飞行曲线（weave）：基础航向（制导追踪/非制导锁定航向）上叠加余弦航向偏置——
  // 往复摆动非单边扭转，missileCurve 越大摆幅越大；不改变制导/锁定/命中/过期判定（按弹体实际位置结算）
  const curve = def.missileCurve ?? 0
  let moveHeading = p.heading
  if (curve > 0) { // v2.20：p.t 已改为全程计时（上方统一推进），此处不再重复累加
    moveHeading = wrapAngle(p.heading + Math.cos(TAU * MISSILE_WEAVE_FREQ * p.t + p.weavePhase) * (curve / 100) * MISSILE_WEAVE_MAX_ANGLE * DEG)
  }
  p.px = p.x
  p.py = p.y
  p.x += dirX(moveHeading) * m2c(p.speed * dt)
  p.y += dirY(moveHeading) * m2c(p.speed * dt)
  p.traveled += p.speed * dt

  const doExplode = (x: number, y: number) => {
    // §3A 门控：同上，未配置爆炸不传 ammoId；命中方向/速率随事件（方向偏置/速度继承）
    explode(s, x, y, def.blastRadius ?? 20, p.damage, def.blastEffect, p.shooter, p.level,
      def.blastRadius !== undefined && def.blastRadius > 0 ? def.art?.projectile : undefined,
      dirX(moveHeading), dirY(moveHeading), m2c(p.speed))
  }
  // v2.20 真集束分裂：at:'proximity'=距目标 ≤range 米触发（缺省 25）/ at:'burnout'=燃烧时间耗尽触发；
  // 母弹裂为 count 颗扇形子弹（伤害均分、splitDone 防再分裂、继承制导/锁定/剩余飞行时间），随后母弹移除
  const sp20 = def.split
  if (sp20 && !p.splitDone && sp20.count >= 2) {
    let trig20 = false
    if (sp20.at === 'burnout') trig20 = def.burnTime !== undefined && p.t >= def.burnTime
    else if (p.guided && target && !p.lostLock) trig20 = Math.hypot(target.x - p.x, target.y - p.y) * M_PER_CELL <= (sp20.range ?? 25)
    if (trig20) {
      for (let i = 0; i < sp20.count; i++) {
        const off20 = (i / (sp20.count - 1) - 0.5) * sp20.spread * DEG // 扇形对称展开（±spread/2）
        splitSpawnQueue.push({ // filter 迭代期间不能直接入 s.projectiles（会被 filter 长度缓存丢弃），由 tick drain
          id: s.nextId++, kind: 'missile', defId: p.defId, level: p.level,
          x: p.x, y: p.y, px: p.x, py: p.y, heading: wrapAngle(p.heading + off20),
          damage: p.damage / sp20.count, traveled: p.traveled, maxTravel: p.maxTravel,
          shooter: p.shooter, hitIds: [],
          t: p.t, flightTime: 0, sx: 0, sy: 0, tx: 0, ty: 0,
          speed: p.speed, turnRate: 0, guided: p.guided, targetId: p.targetId,
          lockX: p.lockX, lockY: p.lockY, lostLock: p.lostLock, prevDist: -1,
          flightLeft: p.flightLeft,
          weavePhase: p.weavePhase + off20, // 相位随扇角错开，避免子弹叠摆成一束
          splitDone: true,
          tgtPX: p.tgtPX, tgtPY: p.tgtPY, // 前置量速度采样基线继承
          igniteAtT: p.t, // v2.23：子弹出生即点火（点火时刻=分裂时刻弹龄）
        })
      }
      s.impacts.push({ id: s.nextId++, x: p.x, y: p.y, ttl: 0.15, max: 0.15, ammoId: def.art?.projectile }) // 分裂瞬间小型碎裂闪光
      return false // 母弹移除
    }
  }
  // 命中判定
  if (p.guided && target && !p.lostLock) {
    const dNow = Math.hypot(target.x - p.x, target.y - p.y)
    const hitR = ENEMY_DEFS[target.kind].size + 0.45
    // 直接命中，或近炸引信：通过最近点（距离由减转增）且仍在近炸半径内
    const proximity = p.prevDist >= 0 && dNow > p.prevDist && dNow <= m2c(def.blastRadius ?? 18) + 0.6
    if (dNow <= hitR || proximity) {
      doExplode(target.x, target.y)
      return false
    }
    p.prevDist = dNow
  } else if (!p.guided) {
    // v2.20 沿途撞击：非制导（含延迟制导直飞期）飞行中撞上敌人即在敌处爆炸（远行星号式；锁定点/射程终点爆炸保留）
    const hitU20 = s.enemies.find(e => e.hp > 0 && Math.hypot(e.x - p.x, e.y - p.y) <= ENEMY_DEFS[e.kind].size + 0.45)
    if (hitU20) {
      doExplode(hitU20.x, hitU20.y)
      return false
    }
    if (!(p.guideDelayLeft !== undefined && p.guideDelayLeft > 0)) { // v1.94：延迟期内不触发锁定点爆炸
      // 非制导：飞向锁定落点并触发爆炸（目标移动不改变落点）
      if (Math.hypot(p.lockX - p.x, p.lockY - p.y) <= Math.max(0.2, m2c(p.speed * dt))) {
        doExplode(p.lockX, p.lockY)
        return false
      }
    }
  }
  // 出界 / 射程终点 => 就地爆炸（§6.4.3 脱靶后行为默认口径）
  // 导弹飞行途中不与阻挡弹道的物体碰撞（越过物体；目标在物体正后方的情况在发射时处理）
  const cx = Math.floor(p.x)
  const cy = Math.floor(p.y)
  if (cx < 0 || cx >= LEVEL.cols || cy < 0 || cy >= LEVEL.rows) return false
  if (p.traveled >= p.maxTravel) { doExplode(p.x, p.y); return false }
  return true
}

// ================= 主循环 =================

/** v2.53 毁灭序列推进：内伤连锁小爆（确定性格位）→ 主爆（AOE 波及周围敌人/僚机，不分敌我）→ 残骸余烟 → 判负 */
function advanceFortressDeath(s: GameState, dt: number) {
  const f = s.fortress
  const prev = f.dyingT
  f.dyingT = prev + dt
  const cells = fortressCells(s)
  for (let i = 0; i < DEATH_SPARK_T.length; i++) {
    const t = DEATH_SPARK_T[i]
    if (prev < t && f.dyingT >= t && cells.length > 0) {
      const c = cells[Math.min(cells.length - 1, Math.floor(cells.length * DEATH_SPARK_FRAC[i]))]
      s.explosions.push({ id: s.nextId++, x: c.x + 0.5, y: c.y + 0.5, r: 0.9, ttl: 0.4, max: 0.4, kind: 'deathSmall' })
    }
  }
  if (prev < DEATH_MAIN_T && f.dyingT >= DEATH_MAIN_T) {
    const d = fortressDef(s)
    const fc = fortressCenter(s)
    const r = Math.max(d.w, d.h) * DEATH_MAIN_R_K
    s.explosions.push({ id: s.nextId++, x: fc.x, y: fc.y, r, ttl: 0.6, max: 0.6, kind: 'deathMain' })
    // 主爆 AOE：波及范围内敌人与僚机（未来驾驶员下车后被波及 → 驾驶员死亡，判负规则见待开发 #6 联动）
    for (const e of s.enemies) if (Math.hypot(e.x - fc.x, e.y - fc.y) <= r + ENEMY_DEFS[e.kind].size) damageEnemy(s, e, DEATH_MAIN_DMG, null)
    for (const a of s.allies) if (Math.hypot(a.x - fc.x, a.y - fc.y) <= r) a.hp -= DEATH_MAIN_DMG
  }
  if (f.dyingT >= DEATH_END_T) s.phase = 'lost'
}

export function tick(prev: GameState, dt: number): GameState {
  const s = clone(prev)
  lastDt = dt
  s.time += dt
  if (prev.phase === 'combat') s.objectiveElapsed += dt
  // 视觉效果衰减
  s.tracers = s.tracers.filter(tr => (tr.ttl -= dt) > 0)
  s.muzzles = s.muzzles.filter(m => (m.ttl -= dt) > 0)
  s.beamFades = s.beamFades.filter(b => (b.ttl -= dt) > 0)
  s.impacts = s.impacts.filter(m => (m.ttl -= dt) > 0) // 命中事件 ttl 衰减（此前缺失：事件永存导致粒子每帧重复发射）
  s.shieldHits = s.shieldHits.filter(m => (m.ttl -= dt) > 0)
  s.fortressHits = s.fortressHits.filter(m => (m.ttl -= dt) > 0)
  s.explosions = s.explosions.filter(ex => (ex.ttl -= dt) > 0)
  s.floats = s.floats.filter(f => (f.ttl -= dt) > 0)
  s.notices = s.notices.filter(n => (n.left -= dt) > 0)
  s.fortress.hitFlash = Math.max(0, s.fortress.hitFlash - dt)

  // v2.53 毁灭序列中：冻结操控输入（堡垒已毁，只推进演出；运动求解器照常运行 → 惯性滑停）
  if (s.fortress.dyingT >= 0) { s.moveDir.x = 0; s.moveDir.y = 0; s.desiredHeading = null; s.reverse = false; s.turnDir = 0 }

  // 资源回复（内部模块提供回复/上限加成）
  const mb = moduleBonuses(s)
  s.ammo = Math.min(AMMO.cap + mb.ammoCap, s.ammo + (AMMO.regen + mb.ammoRegen) * dt)
  s.energy = Math.min(ENERGY.cap + mb.energyCap, s.energy + (ENERGY.regen + mb.energyRegen) * dt)
  updateShield(s, dt)

  // 堡垒机动（备战/交战均可）：加速度驱动速度向量 → 轴分离位移；移动不改变朝向（平移）
  // 转向速率 = turnSpeed × （当前速度/最大速度）；仅 A/D 显式转向（v1.61，原 Q/E）
  if (s.phase === 'prep' || s.phase === 'combat') {
    const f = s.fortress
    const d = fortressDef(s)
    const fc = fortressCenter(s)
    const maxSpd = fortressSpeed(s) // 最大速度（含模块加成；地形减速只影响目标速度，不影响比率分母）
    // 目标速度向量 = 输入方向 × 最大速度（地形调制）
    const turnR = fortressTurnRadius(s) // 最小转弯半径（格）
    const rf = fortressReverseFactor(s) // 倒退系数（速度/加速度同比例）
    const steerDiff = s.desiredHeading != null ? wrapAngle(s.desiredHeading - f.heading) : 0 // 摇杆目标朝向差
    const steering = s.desiredHeading != null && Math.abs(steerDiff) > 3 * DEG // 摇杆转向中（倒退时追踪船尾朝向；到位即停，防抖动阈值 3°——目标角差 ≤3° 视为已到位，过滤摇杆微抖）
    // v1.64 滑行转向（演进 v1.63 静止门控）：A/D 单独按下（无任何油门输入：无移动指令、非倒退、
    // 无摇杆/受控朝向）时不做弧线驱动——不注入新速度，堡垒凭惯性继续滑行减速；
    // 转向走 speedRatio 比率门控（见 turnRate）：转速随当前速度衰减，速度降到 0 转向也归 0。
    // 即：松开 W/S 后按 A/D 仍可转向，但越来越慢直到停转（方向盘语义：静止单独按 A/D 无效）
    const throttle = s.moveDir.x !== 0 || s.moveDir.y !== 0 || s.reverse || steering || s.desiredHeading != null
    const coastTurn = s.turnDir !== 0 && !throttle
    const arcTurn = turnR > 0 && (s.turnDir !== 0 || steering) && !coastTurn // 弧线转向中：覆盖平移输入，转弯带动前行、本体随转
    // 弧线转向角速度（rad/s）：ω ≤ 转向速度，且 ω ≤ 最大速度/R——弧速不超速度上限、路径半径 ≥ R（最小转弯半径的真正约束）
    const arcW = arcTurn ? Math.min(fortressTurnSpeed(s) * DEG, (maxSpd * terrainSpeedMod(fc.x, fc.y)) / turnR) * (s.reverse ? rf : 1) : 0
    let tx = 0
    let ty = 0
    if (arcTurn) {
      // 弧线行驶：目标速度 = 朝向前方 × ω·R（倒退取反 = 船尾先行倒弧）；v 与 ω 同比例 → 路径半径恒为 R、速度不超上限
      const sgn = s.reverse ? -1 : 1
      tx = sgn * dirX(f.heading) * arcW * turnR
      ty = sgn * dirY(f.heading) * arcW * turnR
    } else if (s.reverse) {
      // 倒退（摇杆水平以下）：沿船头反方向，最大速度 = 前进 × 倒退系数
      const spd = maxSpd * rf * Math.max(0, Math.min(1, s.moveMag)) * terrainSpeedMod(fc.x, fc.y)
      tx = -dirX(f.heading) * spd
      ty = -dirY(f.heading) * spd
    } else if (s.moveDir.x !== 0 || s.moveDir.y !== 0) {
      const len = Math.hypot(s.moveDir.x, s.moveDir.y) || 1
      const mag = Math.max(0, Math.min(1, s.moveMag)) // 摇杆模拟量：推进幅度 → 速度上限
      const spd = maxSpd * mag * terrainSpeedMod(fc.x, fc.y)
      tx = (s.moveDir.x / len) * spd
      ty = (s.moveDir.y / len) * spd
    }
    // v2.51 履带转向阻力（turnDrag，缺省 0）：转向输入期间目标速度 ×(1−turnDrag)——滑移转向功耗
    const chassis51 = d.chassis ?? 'tracked'
    if (!arcTurn && chassis51 === 'tracked') {
      const td51 = Math.max(0, Math.min(0.9, d.turnDrag ?? 0))
      if (td51 > 0 && (s.turnDir !== 0 || steering)) { tx *= 1 - td51; ty *= 1 - td51 }
    }
    // 趋近目标速度：加速用加速度；刹停（速度变化量与当前速度反向）用减速度 = 加速度 × 刹停惯性倍率
    const dvx = tx - f.vx
    const dvy = ty - f.vy
    const dv = Math.hypot(dvx, dvy)
    const braking = dv > 0 && (f.vx * dvx + f.vy * dvy) < 0 // 正在减速（含松摇杆/换挡/倒退刹停）——仅用于减速度物理
    const maxDv = d.accel * (braking ? brakeDecelMult(d) : 1) * (s.reverse ? rf : 1) * dt // 倒退时加/减速度同样 × 倒退系数
    const pvx = f.vx, pvy = f.vy // 俯仰用：本 tick 更新前的速度
    if (dv > 0) {
      if (dv <= maxDv) { f.vx = tx; f.vy = ty } else { f.vx += (dvx / dv) * maxDv; f.vy += (dvy / dv) * maxDv }
    }
    // 车身俯仰/侧倾（纯视觉，v1.43 重定义为汽车悬挂拟真）：偏移 = 本 tick 实际加速度的反向映射——
    // 启动/加速 → 朝船尾后倾；减速/刹停 → 朝船头前倾；倒退天然镜像（倒车加速前倾、
    // 倒车刹停后倾）；弧线转向的向心加速度 → 向弯道外侧侧倾（幅度 ×0.4，v1.84 由 0.6 下调）。仅响应操控引起的加减速
    // （碰撞截断不计入）。强度 pitchGain 0~10（缺省 4，0=关闭）；目标上限 ±leanCap px（v1.93 可调 1~8，缺省 4）；弹簧-阻尼趋近（v1.92）
    // v1.90：匀速巡航（实际加速度进死区）→ 保持当前倾角不归位；v1.91：停稳 → 欠阻尼回弹（反向过冲后归位）；gain=0 仍强制回正
    {
      const gain = Math.max(0, Math.min(10, d.pitchGain ?? 4))
      const k = gain * 0.5 // px per (格/s²)
      const leanCap = Math.max(1, Math.min(8, d.leanCap ?? 4)) // v1.93：俯仰位移上限 px，堡垒参数可调（缺省 4）
      const ax = (f.vx - pvx) / dt // 实际生效加速度（经加速度上限/地形/倒退系数约束后的真实 Δv/Δt）
      const ay = (f.vy - pvy) / dt
      const hx = dirX(f.heading) // 船头纵轴
      const hy = dirY(f.heading)
      const aLon = ax * hx + ay * hy // 纵向投影 → 俯仰
      const aLat = ax * -hy + ay * hx // 横向投影 → 侧倾
      const dead = 0.05 // 死区防数值抖动
      const inDead91 = Math.abs(aLon) < dead && Math.abs(aLat) < dead // 实际加速度≈0（匀速/停稳）
      const stopped91 = tx === 0 && ty === 0 && f.vx === 0 && f.vy === 0 // 本 tick 处于静止无输入（含刹停截断到 0 的瞬间）
      if (gain === 0) f.leanRbT = -1 // v1.91：关闭俯仰时取消回弹（走强制回正）
      // v1.91 停稳惯性回弹：停稳瞬间若带着保持的倾角（>0.3px）→ 以此为初值做欠阻尼回摆
      // lean(t) = L0·e^(−ζωt)·(cos ωd t + ζω/ωd·sin ωd t)，ζ=0.3、T=0.35s：
      // 反向过冲峰值 ≈ 0.37×L0（满刹 L0=4px → ≈1.5px，用户要求 1-2px），0.8s 衰减归位
      if (gain > 0 && f.leanRbT >= 0) { // 回弹进行中
        if (!inDead91 && !stopped91) {
          f.leanRbT = -1 // 新加速度 → 打断回弹，下方正常路径从当前值趋近新目标
        } else {
          f.leanRbT += dt
          const wd91 = (Math.PI * 2) / 0.35, z91 = 0.3, w91 = wd91 / Math.sqrt(1 - z91 * z91)
          const c91 = Math.exp(-z91 * w91 * f.leanRbT) * (Math.cos(wd91 * f.leanRbT) + (z91 * w91 / wd91) * Math.sin(wd91 * f.leanRbT))
          f.leanX = f.leanRbX * c91
          f.leanY = f.leanRbY * c91
          if (f.leanRbT >= 0.8) { f.leanX = 0; f.leanY = 0; f.leanRbT = -1 } // 衰减殆尽 → 归位
        }
      }
      if (f.leanRbT < 0) {
        if (gain > 0 && stopped91 && Math.hypot(f.leanX, f.leanY) > 0.3) {
          f.leanRbT = 0; f.leanRbX = f.leanX; f.leanRbY = f.leanY; f.leanVX = 0; f.leanVY = 0 // 启动回弹：c(0)=1，本 tick 倾角不变；角速度清零（v1.92）
        } else {
          // v1.90：巡航（a≈0 但仍在行驶）冻结保持不归位；再次出现真实加速度时按新目标趋近
          const coast90 = gain > 0 && inDead91
          if (coast90) { f.leanVX = 0; f.leanVY = 0 } // v1.92：冻结即停动
          if (!coast90) {
            const lon = Math.abs(aLon) < dead ? 0 : aLon
            const lat = Math.abs(aLat) < dead ? 0 : aLat
            let ltX = (-hx * lon + hy * lat * 0.4) * k // 偏移 = 加速度反向（侧倾 = 向心加速度反向 → 弯道外侧；v1.84 系数 0.6→0.4）
            let ltY = (-hy * lon - hx * lat * 0.4) * k
            const lm = Math.hypot(ltX, ltY)
            if (lm > leanCap) { ltX *= leanCap / lm; ltY *= leanCap / lm }
            if (gain === 0) { ltX = 0; ltY = 0 }
            // v1.92 弹簧-阻尼二阶趋近（悬挂拟真，取代定速趋近）：lean'' = ωn²(lt−lean) − 2ζωn·lean'
            // ωn=2π×1.2Hz（车身俯仰固有频率量级，稳定约0.5s）；ζ=0.5（阶跃过冲 16%：急加速冲过目标再回落）
            // 效果：俯仰峰值速率 ∝ 目标幅度 ∝ |实际加速度|——轻踩缓倾、地板油猛仰，且起步不再瞬间顶满
            const wn92 = Math.PI * 2 * 1.2, z92 = 0.5
            f.leanVX += (wn92 * wn92 * (ltX - f.leanX) - 2 * z92 * wn92 * f.leanVX) * dt
            f.leanVY += (wn92 * wn92 * (ltY - f.leanY) - 2 * z92 * wn92 * f.leanVY) * dt
            f.leanX += f.leanVX * dt
            f.leanY += f.leanVY * dt
            const lm92 = Math.hypot(f.leanX, f.leanY) // 软上限 = leanCap + 1px 过冲余量（v1.93 随参数缩放）
            const softCap92 = leanCap + 1
            if (lm92 > softCap92) { f.leanX *= softCap92 / lm92; f.leanY *= softCap92 / lm92; f.leanVX *= softCap92 / lm92; f.leanVY *= softCap92 / lm92 }
            if (ltX === 0 && Math.abs(f.leanX) < 0.02 && Math.abs(f.leanVX) < 0.05) { f.leanX = 0; f.leanVX = 0 } // 静止吸附防浮点残尘
            if (ltY === 0 && Math.abs(f.leanY) < 0.02 && Math.abs(f.leanVY) < 0.05) { f.leanY = 0; f.leanVY = 0 }
          }
        }
      }
    }
    // 履带/轮滚动相位（v1.85 履带；v2.51 统一为落印列含轮子）：本 tick 真实纵向速度 × dt 累加；转向差速 = v_i = vLon − turnW×横向偏移
    // （右转为正 turnW → 右侧为内侧变慢；倒退 vLon<0 自然反滚；原地转向 vLon=0 时两侧一正一反）
    // def 只存左履带，右侧按中心线镜像；轮胎 unit=pair 同样展开为左右两列（fortressMarkColumns）
    const cols51 = fortressMarkColumns(d)
    if (cols51.length > 0) {
      if (f.trackPhase.length !== cols51.length) f.trackPhase = Array.from({ length: cols51.length }, (_, i) => f.trackPhase[i] ?? 0)
      const vLon85 = f.vx * dirX(f.heading) + f.vy * dirY(f.heading) // 纵向速度分量（格/s，倒退为负）
      for (let k = 0; k < cols51.length; k++) {
        const c51 = cols51[k]
        const sx51 = (c51.mirror ? d.w - c51.x1 : c51.x1) - d.w / 2 // 横向偏移（格，右舷为正）
        f.trackPhase[k] += (vLon85 - f.turnW * sx51) * dt
      }
    }
    // 位移（轴分离碰撞 = 贴墙滑动；跨格触发全场重寻路）
    if (f.vx !== 0 || f.vy !== 0) {
      moveFortressAxis(s, f.vx * dt, 0)
      moveFortressAxis(s, 0, f.vy * dt)
      syncTurretMounts(s)
      const nfc = fortressCenter(s)
      const ncx = Math.floor(nfc.x)
      const ncy = Math.floor(nfc.y)
      if (ncx !== s.fortCellX || ncy !== s.fortCellY) {
        s.fortCellX = ncx
        s.fortCellY = ncy
        s.pathVersion++ // 堡垒跨格 → 敌人重寻路
      }
    }
    // 转向：仅 A/D 显式转向（移动不再改变朝向；v1.61，原 Q/E）
    // arcTurn（turnRadius>0 且有油门/受控）：全速转向——转弯本身带动前行，堡垒绕外侧圆心走弧、本体随转（v2.51 起为两底盘通用覆盖）
    // v2.51 底盘物理（turnRadius=0/未配置时）：履带=差速枢轴转（转速不再乘速度比率，静止可原地转；上限=min(turnSpeed, 2×极速/履带间距)）；
    // 轮式=前轮角模型（δ 经方向盘转速积分，ω=v·tanδ/轴距；静止无转向能力；倒退 v<0 自动反向=车尾语义）
    let dH = 0
    if (!arcTurn && chassis51 === 'wheeled') {
      // 轮式前轮转向（运动学自行车模型）
      const L51 = Math.max(0.5, d.wheelbase ?? d.h * 0.6)
      const steerMax51 = (d.steerMax ?? 35) * DEG
      const steerRate51 = (d.steerRate ?? 120) * DEG
      let steerTgt = 0 // 无输入自动回正
      if (steering) steerTgt = Math.max(-steerMax51, Math.min(steerMax51, steerDiff)) // 摇杆：朝向差直接映射前轮角
      else if (s.turnDir !== 0) steerTgt = Math.sign(s.turnDir) * steerMax51 // A/D：打满
      const dDel = steerTgt - f.steerAngle
      const maxDDel = steerRate51 * dt
      f.steerAngle += Math.max(-maxDDel, Math.min(maxDDel, dDel))
      const vLonW = f.vx * dirX(f.heading) + f.vy * dirY(f.heading) // 纵向速度（倒退为负）
      // 横向附着上限：v²/R ≤ gripMax → tanδ_eff ≤ grip·L/v²（v<0.5 格/s 后不再收紧；运动学不漂移，漂移另版）
      const gripW = m2c(d.gripMax ?? 8)
      const tanMaxW = gripW * L51 / Math.max(vLonW * vLonW, 0.25)
      const tanW = Math.max(-tanMaxW, Math.min(tanMaxW, Math.tan(f.steerAngle)))
      let omW = vLonW * tanW / L51
      const omCapW = fortressTurnSpeed(s) * DEG // turnSpeed 仍为可选横摆角速度上限
      if (omCapW > 0) omW = Math.max(-omCapW, Math.min(omCapW, omW))
      dH = omW * dt
      f.turnW = omW
    } else if (arcTurn || chassis51 === 'tracked') {
      // 履带差速（含 arcTurn 覆盖）：枢轴上限推导 = 2×极速/履带间距；turnSpeed 封顶
      const pivotCap = (2 * maxSpd / Math.max(0.5, d.trackWidth ?? d.w)) / DEG
      const turnRate = arcTurn ? arcW / DEG : Math.min(fortressTurnSpeed(s), pivotCap) * (s.reverse ? rf : 1) // 弧线：受半径约束的角速度；履带：差速枢轴（无速度比率——原地可转）；倒退 × 倒退系数
    if (steering) {
      // 摇杆转向：按转向速率追踪摇杆推出方向（到位即停、不超调）
      const maxDH = turnRate * DEG * dt
      dH = Math.max(-maxDH, Math.min(maxDH, steerDiff))
      f.turnW = dH / dt // v1.56：记录当前转向角速度（松手过渡的种子值）
    } else if (s.turnDir !== 0) {
      // v1.63：倒退时转向以车尾为准——A 使车尾朝左（船头向右，heading+）、D 使车尾朝右（heading−），
      // 与摇杆倒车「船尾追踪摇杆」及真车倒车方向盘语义一致。
      // v1.64：滑行（无油门）时 speedRatio 门控使转速随速度衰减至 0，无需额外门控。
      // v1.66：翻转依据「实际纵向速度方向」而非仅倒退输入标志——松开后退键后堡垒仍在向后滑行时
      // 保持车尾语义（A 继续车尾朝左/heading+、D 继续车尾朝右/heading−），转向方向不突变，随减速平滑停转。
      // 仅在滑行（coastTurn，无任何油门/移动指令）时按速度方向判定；有移动指令时以 reverse 标志为准
      // （自由移动指令与船头轴向无关，不适用车尾语义）
      const vAlong = f.vx * dirX(f.heading) + f.vy * dirY(f.heading) // 纵向速度投影（>0 前行，<0 倒行）
      const revFlip = (s.reverse || (coastTurn && vAlong < 0)) ? -1 : 1
      dH = Math.sign(s.turnDir) * turnRate * DEG * dt * revFlip
      f.turnW = dH / dt
    } else if (s.desiredHeading == null) {
      // v1.56 松手转向过渡：转向输入解除（摇杆松手/回死区、A/D 松开）后角速度不瞬间归零，
      // 按时间常数 TURN_COAST_TAU 指数衰减——船头继续按衰减中的角速度惯性摆动，低于 0.2°/s 归零
      if (f.turnW !== 0) {
        const decayed = f.turnW * Math.exp(-dt / TURN_COAST_TAU)
        f.turnW = Math.abs(decayed) < 0.2 * DEG ? 0 : decayed
        dH = f.turnW * dt
      }
    } else {
      f.turnW = 0 // 摇杆在位但已到位（3° 死区）：不计入过渡
    }
    }
    if (dH !== 0) {
      f.heading = wrapAngle(f.heading + dH)
      for (const t of s.turrets) if (t.hardpointId) t.angle = wrapAngle(t.angle + dH)
      syncTurretMounts(s)
    }
  }

  // 生产模块产出 + 维修站修复 + 友军单位推进（备战/交战都生效）
  updateModulesAndAllies(s, dt)

  if (s.phase === 'prep') {
    // 波次结束收尾：已发射投射物继续飞行直至命中/出界/过期（不出怪、炮塔不开火）
    s.projectiles = s.projectiles.filter(p => {
      if (p.kind === 'bullet') return updateBullet(s, p, dt)
      if (p.kind === 'shell') return updateShell(s, p, dt)
      return updateMissile(s, p, dt)
    })
    s.enemyProjectiles = s.enemyProjectiles.filter(p => updateEnemyProjectile(s, p, dt))
    if (splitSpawnQueue.length > 0) { s.projectiles.push(...splitSpawnQueue); splitSpawnQueue.length = 0 } // v2.20 集束子弹入队
    coolFortress(s, dt) // 备战阶段堡垒散热继续生效
    s.prepLeft = Math.max(0, s.prepLeft - dt)
    if (s.prepLeft <= 0) return startWave(s, 0)
    return s
  }
  if (s.phase !== 'combat') return s

  // 防守任务关闭“波次等待”时：上一波最后一名敌人上场后，按接踵时间自动排入下一波。
  if (s.objective.type === 'defend' && s.objective.waveWait === false && s.nextWaveLeft !== null) {
    s.nextWaveLeft = Math.max(0, s.nextWaveLeft - dt)
    if (s.nextWaveLeft <= 0 && s.wave < s.objective.waves) {
      s.wave++
      s.spawnQueue = buildWave(s.wave).map(it => ({ ...it }))
      s.spawnTimer = 0
      s.nextWaveLeft = null
    }
  }

  // 1) 出怪
  updateRegionTriggers(s, dt)
  updateInteractables(s)
  updateEventQueue(s, dt)
  if ((s.phase as Phase) === 'won') return s
  if (s.ambushQueue.length > 0) {
    const pending: AmbushSpawn[] = []
    for (const a of s.ambushQueue) {
      a.left -= dt
      if (a.left <= 0) spawnEnemyAt(s, a.kind, a.x, a.y)
      else pending.push(a)
    }
    s.ambushQueue = pending
  }
  if (s.spawnQueue.length > 0) {
    s.spawnTimer -= dt
    if (s.spawnTimer <= 0) {
      const item = s.spawnQueue.shift()!
      const col = 1 + eventRandom(s.nextId, 0) * (LEVEL.cols - 2)
      spawnEnemyAt(s, item.kind, col, -0.5)
      s.spawnTimer = item.delay
      if (s.spawnQueue.length === 0 && s.objective.type === 'defend' && s.objective.waveWait === false && s.wave < s.objective.waves) {
        s.nextWaveLeft = s.objective.overlapTime ?? DEFEND_OVERLAP_TIME_DEFAULT
      }
    }
  }

  // 2) 距离场（结构变化时重算 => 全场重寻路）
  const dist = computePathField(s)

  // 3) 敌人行动（船体归零 => v2.53 进入毁灭序列，不再同帧判负；演出推进见步骤 9）
  for (const e of s.enemies) {
    if (e.hp > 0) updateEnemy(s, e, dist, dt)
    if (s.fortress.hp <= 0 && s.fortress.dyingT < 0) s.fortress.dyingT = 0
  }

  // 4) 炮塔索敌与开火（产热汇聚堡垒）→ 随后统一散热（v2.53：毁灭序列中全炮塔停火）
  if (s.fortress.dyingT < 0) for (const t of [...s.turrets]) updateTurret(s, t, dt)
  coolFortress(s, dt)

  // 5) 弹道推进
  s.projectiles = s.projectiles.filter(p => {
    if (p.kind === 'bullet') return updateBullet(s, p, dt)
    if (p.kind === 'shell') return updateShell(s, p, dt)
    return updateMissile(s, p, dt)
  })
  s.enemyProjectiles = s.enemyProjectiles.filter(p => updateEnemyProjectile(s, p, dt))
  if (splitSpawnQueue.length > 0) { s.projectiles.push(...splitSpawnQueue); splitSpawnQueue.length = 0 } // v2.20 集束子弹入队

  // 6) 燃烧区域（只结算敌人，§8.3）
  for (const z of s.burnZones) {
    z.timer -= dt
    z.left -= dt
    if (z.timer <= 0) {
      z.timer += z.interval
      for (const e of s.enemies) {
        if (Math.hypot(e.x - z.x, e.y - z.y) <= z.r) damageEnemy(s, e, z.damage, null)
      }
    }
  }
  s.burnZones = s.burnZones.filter(z => z.left > 0)

  // 7) 敌人持续伤害 dot
  for (const e of s.enemies) {
    for (const d of e.dots) {
      d.timer -= dt
      d.left -= dt
      if (d.timer <= 0) { d.timer += d.interval; damageEnemy(s, e, d.damage, null) }
    }
    e.dots = e.dots.filter(d => d.left > 0)
    if (e.bossPhases && e.hp > 0) {
      const done = e.bossPhaseDone ?? (e.bossPhaseDone = [])
      e.bossPhases.forEach((phase, index) => {
        if (!done.includes(index) && e.hp / e.maxHp * 100 <= phase.hpPercent) {
          done.push(index)
          queueEvent(s, e.id, { x: e.x - 1, y: e.y - 1, w: 2, h: 2 }, phase.actions)
          s.notices.push({ id: s.nextId++, text: `${e.bossName ?? 'Boss'} 进入阶段 ${index + 2}`, left: 3 })
        }
      })
    }
  }

  // 8) 击杀结算
  const alive: Enemy[] = []
  for (const e of s.enemies) {
    if (e.hp <= 0) {
      const bounty = Math.round(ENEMY_DEFS[e.kind].bounty * BOUNTY_MULT)
      s.gold += bounty
      s.kills++
      addFloat(s, e.x, e.y, `+${bounty}`)
      if (e.bossName) {
        queueEvent(s, e.id, { x: e.x - 1, y: e.y - 1, w: 2, h: 2 }, e.bossDefeatActions ?? [])
        s.notices.push({ id: s.nextId++, text: `${e.bossName} 已被击败`, left: 4 })
      }
    } else {
      alive.push(e)
    }
  }
  s.enemies = alive

  // 9) 阶段判定（船体归零 → v2.53 毁灭序列；演出期间不判胜、不推进波次，演出毕判负）
  if (s.fortress.hp <= 0 && s.fortress.dyingT < 0) s.fortress.dyingT = 0
  if (s.fortress.dyingT >= 0) { advanceFortressDeath(s, dt); return s }
  updateEventQueue(s, 0)
  if ((s.phase as Phase) === 'won') return s
  if (s.objective.type === 'reach' && fortressReachedFinish(s)) {
    s.phase = 'won'
    return s
  }
  if (s.objective.type === 'survive' && s.objectiveElapsed >= s.objective.duration) {
    s.phase = 'won'
    return s
  }
  if (s.spawnQueue.length === 0 && s.ambushQueue.length === 0 && s.eventQueue.length === 0 && s.enemies.length === 0) {
    if (s.objective.type === 'defend' && s.wave >= s.objective.waves) { s.phase = 'won'; return s }
    if (LEVEL.mode === 'advance') {
      s.wave++
      s.spawnQueue = buildWave(s.wave).map(it => ({ ...it }))
      s.spawnTimer = 0.8
      return s
    }
    if (s.objective.type === 'defend' && s.objective.waveWait === false) return s
    s.phase = 'prep'
    s.wave++
    s.prepLeft = s.objective.type === 'defend' ? (s.objective.restTime ?? DEFEND_REST_TIME_DEFAULT) : PREP_TIME
  }
  return s
}
