import { useEffect, useId, useReducer, useRef, useState, type ReactNode } from 'react'
import { Bug, Play, Plus, RotateCcw, Square, Trash2, X } from 'lucide-react'
import { BASE_CELL, DEFAULT_FORTRESS, DIRECT_PROJECTILE_SUBTYPE_NAME, EFFECT_KIND_NAME, EFFECT_LAYER_NAME, EFFECT_STATE_NAME, FLASH_DURATION, FLASH_FRAME_DUR, FLASH_FRAMES, FLASH_SCALES, FORTRESS_DEFS, M_PER_CELL, MODULE_DEFS, PROJECTILE_ARTS, PROJECTILE_KIND_COLOR, PROJECTILE_KIND_NAME, SPECIAL_BOOST_NAME, TURRET_DEFS, VEHICLE_PLACEHOLDER_COLOR, hardpointBelowVehicleBody, moduleAssemblyPoints, resolveUnitDestructionEffect, turretAmmoCapacity, turretAmmoExchangeRate, turretAssemblyPoints, turretEnergyCapacity, turretFireSoundRole } from '@/game/config'
import type { DirectProjectileSubtype, ModuleDef, ProjectileArtDef, ProjectileArtKind } from '@/game/config'
import type { ExcludeTagKey, FortressDef, FortressEffectKind, FortressEffectLayer, FortressEffectState, Hardpoint, MountSize, PreferTagKey, ResourceTagKey, SpecialBoost, TurretDef, TurretTag, WeaponType } from '@/game/config'
import { levelLibraryForExport, removeUnitDefinitionReferences, saveLevelLibrary } from '@/game/level'
import type { LevelEventAction, LevelUnitCommand } from '@/game/level'
import { BEAM_FADE, CHARGE_LAST_HOLD, centeredTrackPlacements, fortressInteriorSet, fortressLocalCenter, modulePlanningFits, runningGearPoint, simulateTurretHeat, validateFortressDef, wheelFrameCount, wheelPlacements } from '@/game/engine'
import { beamArtConfig, beamArtConfigOf, chargeFrameRect, projectileArtDef, projectileArtState, projectileBodyFrameRect, resCompatUrl, resolveExplosionFx, resolveImpactFx, resolveTrailFx, srcImage, turretArtState, validateArt } from '@/game/art'
import { drawBeamLayer, drawTurretPreviewCore, WALKER_COLUMNS, WALKER_FRAMES, WALKER_ROWS } from '@/game/render'
import { drawExplosionLayers, drawImpactFlash, drawParticlePool, tintedFx } from '@/game/fxDraw' // v2.55：特效画法统一走共用层
import { deleteCustomFortress, fortressPersistFailed, getSelectedFortressId, isBuiltinFortressOverridden, listCustomFortresses, resetModuleDefsToFactory, resetPersistedToDefaults, saveAll, saveCustomFortress, saveVehicleUnitDefinition, setSelectedFortressId } from '@/game/persist'
import { applyConfig, exportConfig } from '@/game/config_transfer'
import { addAsset, addAudioAsset, filterAssets, getAsset, independentTileIndicesFromPixels, isAudioAsset, listAssets, removeAsset, resolveAssetSrc, setAssetCategory, setAssetTileSheet, tileSheetForDimensions, ASSET_CATEGORY_NAME } from '@/game/assetlib'
import { audioManager } from '@/game/audio'
import { BEAM_CONTINUOUS_AUDIO_DELAY, GLOBAL_BGM_LABELS, GLOBAL_CUE_LABELS, audioProjectConfig, globalCueAutoOptions, patchGlobalBgm, patchGlobalCue, playCue, resolveCue, startCueLoop, stopCueLoop } from '@/game/audioConfig'
import type { GlobalBgmSlot, GlobalCueSlot } from '@/game/audioConfig'
import SoundAssetSelect from '@/components/SoundAssetSelect'
import ValidatedNumberInput from '@/components/ValidatedNumberInput'
import { DISPLAY_RESOLUTION_PRESETS, displayConfig, patchDisplayConfig, resetDisplayConfig } from '@/game/displayConfig'
import { gameParameters, setBattleVisionEnabled, setEntityShadowsVisible, setHitFxVisibility, setNaturalHeatDissipation, setPerformanceMonitorEnabled, setPerformanceMonitorItem, setPlayerVisionMeters, setUnitDestructionWreckageScalePercent, setUnitHealthBarsVisible, setUnlockAll } from '@/game/gameParameters'
import type { PerformanceMonitorItem } from '@/game/gameParameters'
import { createPool, gradientColorKey, spawnTrail, stepParticles } from '@/game/particles'
import { canPlay, createFxState, FX_PREVIEW_RADIUS, FX_SEQ_HIT_X, fxRaySeqFade, fxRaySeqLen, fxTick, simAmmoFx } from '@/game/ammoFxPreview'
import type { AmmoFxMode } from '@/game/ammoFxPreview'
import type { AssetCategory, AssetEntry, AssetSpriteState } from '@/game/assetlib'
import { centeredRect } from '@/game/geometry'
import { bodyCollisionFromPixels } from '@/game/fortressCollision'
import {
  DEFAULT_UNIT_AI, defaultUnitTypeConfig, deleteCustomUnitDef, fortressUnitId, isBuiltinUnitId, isBuiltinUnitOverridden,
  allyKindForUnit, allyUnitId, saveCustomUnitDef, unitDefById, unitLibrary, unitLibraryPersistHasFailed, validateUnitDef,
  normalizeUnitAI, rotorPlacements, unitCollisionRadii, unitTypeConfig,
} from '@/game/unit'
import type { AIAttackProfile, AIMovementProfile, AIPreferredTarget, AIPositioningProfile, AISpecialProfile, UnitDef, UnitDeployDirection, UnitTargetKind, UnitType } from '@/game/unit'

// 模块加载时快照原始参数，用于"重置"内置炮塔
const ORIGINALS = TURRET_DEFS.map(d => structuredClone(d))
const BUILTIN_IDS = new Set(ORIGINALS.map(d => d.id))

// 各武器类型的克隆原型（保证新炮塔带齐该类型的全部字段）
const ARCHETYPE: Record<WeaponType, string> = {
  direct: 'mg',
  lob: 'lob',
  missile: 'cruise',
  beam: 'beam',
  spray: 'spray',
}
const TYPE_NAME: Record<WeaponType, string> = {
  direct: '直射',
  lob: '抛射',
  missile: '导弹',
  beam: '射线',
  spray: '喷射',
}
const TYPE_COLOR: Record<WeaponType, string> = {
  direct: '#8C94A0',
  lob: '#9C7B54',
  missile: '#A05C48',
  beam: '#5C7E8C',
  spray: '#B3702E',
}

type FieldType = 'number' | 'boolean' | 'select'

interface FieldSpec {
  path: string // 支持 a.b 嵌套
  label: string
  tip?: string // 悬停/长按解释气泡
  type: FieldType
  step?: number
  options?: { value: string; label: string }[] // type:'select' 时的可选项
  defaultValue?: string // type:'select' 且 def 上无值时的显示默认
  /** 自定义显示条件（缺省：字段在 def 上有值才显示） */
  showIf?: (def: TurretDef) => boolean
  /** v1.94：派生/复合字段（select 用）——提供后读取/写入绕过 getPath/setPath */
  get?: (def: TurretDef) => string
  set?: (def: TurretDef, v: string) => void
}

/** 炮管数是数量唯一来源；修改时同步收口美术挂点，避免预览和实战仍绘制旧炮管。 */
function setTurretBarrelCount(def: TurretDef, value: string) {
  const parsed = Number(value)
  const count = value === '' || !Number.isFinite(parsed) ? 1 : Math.max(1, Math.floor(parsed))
  if (value === '') delete def.barrels
  else def.barrels = count
  const configured = def.art?.barrels
  if (configured?.length) {
    if (count === 1 && configured.length > 1) {
      const average = (read: (barrel: NonNullable<typeof configured>[number]) => number) => configured.reduce((sum, barrel) => sum + read(barrel), 0) / configured.length
      def.art!.barrels = [{
        mount: [average(barrel => barrel.mount[0]), average(barrel => barrel.mount[1])],
        muzzle: [average(barrel => barrel.muzzle[0]), average(barrel => barrel.muzzle[1])],
      }]
    } else {
      const spread = def.w * 0.6
      def.art!.barrels = Array.from({ length: count }, (_, index) => structuredClone(configured[index] ?? {
        mount: [count <= 1 ? 0 : (index - (count - 1) / 2) * (spread / (count - 1)), 0] as [number, number],
        muzzle: [count <= 1 ? 0 : (index - (count - 1) / 2) * (spread / (count - 1)), 0.35] as [number, number],
      }))
    }
  }
  if (count < 2 && def.art) delete def.art.flipEvenBarrels
}

const FIELDS: FieldSpec[] = [
  { path: 'cost', label: '造价', tip: '建造成本（资源点）', type: 'number' },
  {
    path: 'assemblyPoints', label: '装配分', tip: '战斗整备时占用的装配分（≥0）；关卡的装配分上限会限制炮塔与模块的总和', type: 'number', step: 1,
    showIf: () => true,
    get: def => String(turretAssemblyPoints(def)),
    set: (def, value) => {
      const parsed = Number(value)
      if (value === '' || !Number.isFinite(parsed)) delete def.assemblyPoints
      else def.assemblyPoints = Math.max(0, Math.round(parsed))
    },
  },
  { path: 'rotateSpeed', label: '旋转(°/s)', tip: '炮塔旋转速度（度/秒），越高跟踪越快', type: 'number' },
  { path: 'aimCone', label: '射角(°)', tip: '开火判定锥角：目标进入该角度才起射', type: 'number' },
  { path: 'rangeMin', label: '最小射程(m)', tip: '最小射程（米），太近的目标打不到', type: 'number' },
  { path: 'rangeMax', label: '最大射程(m)', tip: '最大射程（米），超出不索敌', type: 'number' },
  { path: 'canAir', label: '对空', tip: '可攻击空中单位', type: 'boolean' },
  { path: 'canGround', label: '对地', tip: '可攻击地面单位', type: 'boolean' },
  { path: 'canInterceptMissile', label: '拦截导弹', tip: '允许直射和光束把敌对的可拦截导弹作为目标；不会让导弹或抛射武器互相拦截', type: 'boolean', showIf: def => def.type === 'direct' || def.type === 'beam' },
  { path: 'damage', label: '伤害值', tip: '单发/单次伤害值', type: 'number' },
  { path: 'projectileSpeed', label: '实弹速度(m/s)', tip: '实弹飞行速度（米/秒）', type: 'number' },
  { // v1.94：制导打勾改为下拉（guided boolean 保留兼容）；v2.23：三档→两档，原「延迟制导」并入「制导」（下方「延迟时间」填秒数即延迟制导）
    path: 'guideMode', label: '制导模式', tip: '常规=直飞锁定落点；制导=追踪目标（「延迟时间」填秒数即先沿炮塔方向直飞一段再追踪）',
    type: 'select',
    options: [{ value: 'none', label: '常规' }, { value: 'guided', label: '制导' }],
    defaultValue: 'none',
    showIf: def => def.type === 'missile',
    get: def => !def.guided ? 'none' : 'guided',
    set: (def, val) => {
      if (val === 'none') { def.guided = false; delete def.guideDelay; delete def.guideDecel }
      else def.guided = true // v2.23：切制导不再清 guideDelay/guideDecel——延迟制导经「延迟时间」字段表达
    },
  },
  { path: 'guideDelay', label: '延迟时间(s)', tip: '延迟制导：发射后沿炮塔方向直飞这段秒数，之后才开启追踪；未配置/0 = 立即制导（制导模式下常显，可直接填入秒数切换为延迟制导）', type: 'number', step: 0.05, showIf: def => def.type === 'missile' && !!def.guided }, // v1.97：showIf 不再依赖自身值，修复逐键提交时中间态（空/0）导致字段编辑中途自隐藏、无法修改
  { path: 'guideDecel', label: '延迟减速度(m/s²)', tip: '延迟制导：延迟时间内每秒减速量，速度减到 0 为止；缺省 0 = 延迟期照常加速', type: 'number', step: 1, showIf: def => def.type === 'missile' && !!def.guided && (def.guideDelay ?? 0) > 0 }, // v1.96
  { path: 'missileInitSpeed', label: '导弹初速度(m/s)', tip: '发射瞬间初速度（米/秒）；缺省 0 = 从静止加速；可大于极速，超出后不再加速仅维持', type: 'number', showIf: def => def.type === 'missile' }, // v1.96
  { path: 'missileAccel', label: '导弹加速度(m/s²)', tip: '导弹加速度（米/秒²）', type: 'number' },
  { path: 'missileMaxSpeed', label: '导弹极速(m/s)', tip: '导弹极速（米/秒）', type: 'number' },
  { path: 'missileFlightTime', label: '导弹飞行时间(s)', tip: '导弹最长飞行时间（秒），超时自毁', type: 'number', showIf: def => def.type === 'missile' },
  { path: 'missileCurve', label: '导弹飞行曲线(0-100)', tip: '蛇形机动幅度 0-100，越大轨迹越弯；制导延迟期间实际曲线幅度自动提高 30%，制导启动后恢复设定值。', type: 'number', showIf: def => def.type === 'missile' },
  { path: 'ejectAngle', label: '出膛偏角(°)', tip: '填写随机偏转的总角度区间，例如 20 表示每发在 -10°～+10° 内随机出膛；仅制导延迟期间决定初始主方向。真正的垂直发射请在导弹弹丸条目的「垂发」面板中开启。', type: 'number', step: 5, showIf: def => def.type === 'missile' && !!def.guided && (def.guideDelay ?? 0) > 0 },
  { path: 'burnTime', label: '燃烧时间(s)', tip: 'v2.20：发动机燃烧秒数——期内加速+喷焰，燃尽后惯性滑行、尾焰/喷口焰熄灭；未配置 = 全程燃烧', type: 'number', step: 0.5, showIf: def => def.type === 'missile' },
  { // v2.20 集束分裂：子弹数量（清空/小于 2 = 不分裂；首次填入自动补默认扇角 40°/近炸 1 格=3.2m）
    path: 'splitCount', label: '集束子弹数', tip: 'v2.20 真集束：触发后母弹裂为 N 颗扇形子弹（伤害均分、不再分裂、继承制导/锁定/剩余飞行时间）；清空 = 不分裂', type: 'number',
    showIf: def => def.type === 'missile',
    get: def => def.split ? String(def.split.count) : '',
    set: (def, val) => {
      const n = val === '' ? undefined : Number(val)
      if (n === undefined || Number.isNaN(n) || n < 2) delete def.split
      else if (def.split) def.split.count = Math.round(n)
      else def.split = { count: Math.round(n), spread: 40, at: 'proximity', range: M_PER_CELL }
    },
  },
  { path: 'splitSpread', label: '集束扇角(°)', tip: 'v2.20：子弹扇形展开总角度（以母弹航向为中心 ±半角对称）', type: 'number', step: 5, showIf: def => def.type === 'missile' && !!def.split, get: def => String(def.split!.spread), set: (def, val) => { if (def.split) def.split.spread = Number(val) || 0 } },
  { // v2.20 分裂时机
    path: 'splitAt', label: '分裂时机', tip: 'v2.20：近炸=距目标进入触发距离时分裂；燃尽=燃烧时间耗尽时分裂（需先配置燃烧时间）',
    type: 'select',
    options: [{ value: 'proximity', label: '近炸' }, { value: 'burnout', label: '燃尽' }],
    defaultValue: 'proximity',
    showIf: def => def.type === 'missile' && !!def.split,
    get: def => def.split?.at ?? 'proximity',
    set: (def, val) => { if (def.split) def.split.at = val as 'proximity' | 'burnout' },
  },
  { path: 'splitRange', label: '分裂距离(m)', tip: '近炸分裂触发距离（米）；缺省为 1 格，即 3.2m', type: 'number', step: 0.1, showIf: def => def.type === 'missile' && !!def.split && def.split.at === 'proximity', get: def => String(def.split!.range ?? M_PER_CELL), set: (def, val) => { if (def.split) { const n = Number(val); def.split.range = val === '' || Number.isNaN(n) ? undefined : n } } },
  { path: 'chargeTime', label: '充能时间(s)', tip: '开火前摇秒数：充能期间不射击，目标丢失取消；未配置=无前摇', type: 'number', showIf: def => def.type === 'beam' }, // v2.3：充能参数仅射线类（beam）炮塔拥有；填写后每次开火周期起射前充能
  { path: 'missileTurnMax', label: '最大转向(°/s)', tip: '导弹最大转向角速度（度/秒）', type: 'number' },
  { path: 'missileTurnAccel', label: '转向加速度(°/s²)', tip: '转向角加速度（度/秒²）', type: 'number' },
  { path: 'accuracy', label: '精度(m)', tip: '命中散布半径（米），越小越准', type: 'number', step: 0.1 },
  { path: 'pierce.count', label: '穿透数量', tip: '弹丸可穿透的敌人数量', type: 'number' },
  { path: 'pierce.decay', label: '穿透衰减(0-1)', tip: '每穿透一个目标伤害衰减比例（0-1）', type: 'number', step: 0.05 },
  { path: 'blastRadius', label: '爆炸半径(m)', tip: '爆炸波及半径（米），直射/榴弹/导弹通用（v2.47 起直射生效）；未配置不播放爆炸特效', type: 'number', showIf: () => true }, // v2.48：常驻显示（原无 showIf → 未预置爆炸的直射炮字段被隐藏死锁）
  { path: 'blastEffect.damage', label: '爆炸附加伤害', tip: '爆炸附加伤害（叠加在直接命中上）；v2.47 起直射命中时波及半径内所有敌人', type: 'number', showIf: () => true }, // v2.48
  { path: 'blastEffect.burn.damage', label: '爆炸燃烧伤害', tip: '燃烧每跳伤害', type: 'number', showIf: () => true }, // v2.48
  { path: 'blastEffect.burn.interval', label: '燃烧间隔(s)', tip: '燃烧伤害跳间隔（秒）', type: 'number', step: 0.1, showIf: () => true }, // v2.48
  { path: 'blastEffect.burn.duration', label: '燃烧时长(s)', tip: '燃烧总时长（秒）', type: 'number', step: 0.1, showIf: () => true }, // v2.48
  { path: 'beamWidth', label: '射线宽幅(m)', tip: '光束判定宽度（米）；同时驱动贴图渲染宽度（米数按3.2m/格换算）；未填 = 贴图原生尺寸（32px 高）', type: 'number', step: 0.1 },
  {
    path: 'beamFadeMode', label: '消散模式', tip: '收缩：保持射线长度，宽度逐渐缩小并渐隐。传递：命中端保持不动，射线从源头向目标收束，同时缩小宽度并渐隐。',
    type: 'select', options: [{ value: 'shrink', label: '收缩' }, { value: 'transfer', label: '传递' }],
    defaultValue: 'shrink', showIf: def => def.type === 'beam',
  },
  { path: 'sprayAngle', label: '喷射角度(°)', tip: '喷射散布角（度），火焰锥形范围', type: 'number' },
  { path: 'attackDuration', label: '攻击持续(s)', tip: '单次开火持续时间（秒）', type: 'number', step: 0.1 },
  { path: 'dot.damage', label: '持续伤害值', tip: '持续伤害每跳数值', type: 'number' },
  { path: 'dot.interval', label: '持续伤害间隔(s)', tip: '持续伤害跳间隔（秒）', type: 'number', step: 0.1 },
  { path: 'fireRate', label: '装填时间(s)', tip: '一轮射击或一次持续攻击结束后，到下一轮开始前的等待时间', type: 'number', step: 0.1 },
  { path: 'burst', label: '连发数', tip: '每轮连发弹数', type: 'number' },
  { path: 'burstInterval', label: '连发间隔(s)', tip: '连发之间的间隔（秒）', type: 'number', step: 0.05 },
  {
    path: 'barrels', label: '炮管数', tip: '炮管数量；这是预览、实战炮管贴图与弹丸出生点的唯一数量来源。未配置视为 1 单管。', type: 'number', showIf: () => true,
    get: def => String(Math.max(1, Math.floor(def.barrels ?? 1))),
    set: setTurretBarrelCount,
  },
  {
    path: 'barrelMode', label: '发射模式', type: 'select',
    options: [{ value: 'salvo', label: '齐射' }, { value: 'sequential', label: '轮流' }],
    defaultValue: 'salvo',
    showIf: def => def.type === 'direct' || def.type === 'lob' || def.type === 'missile',
  },
  { path: 'heatPerShot', label: '热量/发', tip: '每发产热汇聚到堡垒热量池，堡垒积满即全炮塔过热停火', type: 'number' },
  {
    path: 'ammoCapacity', label: '弹药量', tip: '该炮塔独立储存的最大弹药量；消耗完后停止开火，需通过功能区域或恢复模块补充。0 表示没有弹药容量。', type: 'number', showIf: () => true,
    get: def => String(turretAmmoCapacity(def)),
    set: (def, val) => { def.ammoCapacity = Math.max(0, Number(val) || 0) },
  },
  {
    path: 'ammoExchangeRate', label: '弹药汇率', tip: '外部补给弹药的换算倍率。实际恢复量 = 补给量 × 汇率；例如 0.5 时补给 2 单位只恢复 1 发。不会改变每枚弹丸固定消耗 1 发的规则。', type: 'number', step: 0.1, showIf: () => true,
    get: def => String(turretAmmoExchangeRate(def)),
    set: (def, val) => { def.ammoExchangeRate = Math.max(0, Number(val) || 0) },
  },
  {
    path: 'energyCapacity', label: '能量值', tip: '该炮塔独立储存的最大能量值；消耗完后停止开火，需通过功能区域或恢复模块补充。0 表示没有能量容量。', type: 'number', showIf: () => true,
    get: def => String(turretEnergyCapacity(def)),
    set: (def, val) => { def.energyCapacity = Math.max(0, Number(val) || 0) },
  },
  { path: 'armorPen', label: '穿甲比例', tip: '命中堡垒时直接穿过装甲进入结构的比例（0~1）', type: 'number', step: 0.05, showIf: () => true },
  { path: 'armorDamage', label: '削甲/命中', tip: '每次命中削减受击面装甲；留空时按伤害×穿甲比例', type: 'number', step: 1, showIf: () => true },
  { path: 'ammoPerSec', label: '弹药/秒', tip: '喷射武器每秒弹药消耗', type: 'number' },
  { path: 'energyPerShot', label: '发射电量', tip: '每发消耗电量', type: 'number' },
  { path: 'energyPerSec', label: '维持电量', tip: '维持状态每秒耗电', type: 'number', step: 0.1 },
  { path: 'hp', label: '耐久', tip: '结构耐久，归零被摧毁', type: 'number' },
  { path: 'onDestroyBlast.radius', label: '毁坏爆炸半径(m)', tip: '被摧毁时爆炸半径（米）', type: 'number' },
  { path: 'onDestroyBlast.damage', label: '毁坏爆炸伤害', tip: '被摧毁时爆炸伤害', type: 'number' },
]

const PROJECTILE_OWNED_TURRET_FIELDS = new Set([
  'damage', 'projectileSpeed', 'guideMode', 'guideDelay', 'guideDecel', 'missileInitSpeed',
  'missileAccel', 'missileMaxSpeed', 'missileFlightTime', 'missileCurve', 'ejectAngle', 'burnTime',
  'splitCount', 'splitSpread', 'splitAt', 'splitRange', 'missileTurnMax', 'missileTurnAccel',
  'pierce.count', 'pierce.decay', 'blastRadius', 'blastEffect.damage', 'blastEffect.burn.damage',
  'blastEffect.burn.interval', 'blastEffect.burn.duration', 'dot.damage', 'dot.interval',
  'armorPen', 'armorDamage',
])

// ---------- v2.49 索敌标签编辑器 ----------
// 偏好=软排序（权重因子连乘，可多个叠加）；约束=硬过滤；资源=开火门控（条件成立即禁火）。
// 约束+资源全部 AND 通过才开火；偏好之间非条件、是排序权重。零标签 = 现状（近堡垒优先、空军×0.5）。
const PREFER_LABELS: [PreferTagKey, string][] = [ // 预留键（fortress/wingman/spawned）实体上线后再开放
  ['nearFortress', '近堡垒优先'], ['nearTurret', '近炮塔优先'],
  ['hpMax', '血最多优先'], ['hpMin', '血最少优先'],
  ['sizeBig', '大单位优先'], ['sizeSmall', '小单位优先'],
  ['air', '空中优先'], ['ground', '地面优先'],
  ['missile', '导弹优先'],
]
const EXCLUDE_LABELS: [ExcludeTagKey, string][] = [['air', '不打空中'], ['ground', '不打地面'], ['missile', '不攻击导弹']]
const RESOURCE_LABELS: [ResourceTagKey, string][] = [['ammo', '弹药'], ['energy', '电量'], ['heat', '热量'], ['defense', '结构值']]

function tagText(tg: TurretTag): string {
  if (tg.kind === 'prefer') return `偏好·${PREFER_LABELS.find(([k]) => k === tg.key)?.[1] ?? tg.key}`
  if (tg.kind === 'exclude') return `约束·${EXCLUDE_LABELS.find(([k]) => k === tg.key)?.[1] ?? tg.key}`
  return `资源·${RESOURCE_LABELS.find(([k]) => k === tg.res)?.[1] ?? tg.res}${tg.op === 'lt' ? '低于' : '高于'}${tg.value}%禁火`
}

function TagEditor({ def, onChange }: { def: TurretDef; onChange: (tags: TurretTag[] | undefined) => void }) {
  const [cat, setCat] = useState<'prefer' | 'exclude' | 'resource'>('prefer')
  const [pKey, setPKey] = useState<PreferTagKey>('hpMax')
  const [xKey, setXKey] = useState<ExcludeTagKey>('air')
  const [rRes, setRRes] = useState<ResourceTagKey>('ammo')
  const [rOp, setROp] = useState<'lt' | 'gt'>('lt')
  const [rVal, setRVal] = useState('20')
  const tags = def.tags ?? []
  const add = () => {
    const tg: TurretTag = cat === 'prefer' ? { kind: 'prefer', key: pKey }
      : cat === 'exclude' ? { kind: 'exclude', key: xKey }
      : { kind: 'resource', res: rRes, op: rOp, value: Math.max(0, Math.min(100, Number(rVal) || 0)) }
    const dup = tags.some(x =>
      (tg.kind === 'prefer' && x.kind === 'prefer' && x.key === tg.key) ||
      (tg.kind === 'exclude' && x.kind === 'exclude' && x.key === tg.key) ||
      (tg.kind === 'resource' && x.kind === 'resource' && x.res === tg.res && x.op === tg.op))
    if (dup) return
    onChange([...tags, tg])
  }
  const selCls = 'px-1 py-0.5 text-[10px] font-comic border-2 border-black bg-[#EFEBD8]'
  return (
    <div className="mt-1.5 border-t-2 border-black/15 pt-1">
      <div className="flex items-center gap-1 mb-0.5">
        <TipLabel text="索敌标签" tip="偏好=软排序（权重连乘，可叠加）；约束=硬过滤；资源=条件成立即禁火（占上限百分比）。约束+资源全部满足才开火；零标签=现状（近堡垒优先、空军×0.5）" className="text-[10px] font-black text-black/70" />
        {tags.length > 0 && (
          <button className="comic-btn px-1 py-0 text-[9px]" title="清空全部标签（恢复默认索敌）"
            onClick={() => onChange(undefined)}>清空</button>
        )}
      </div>
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-1">
          {tags.map((tg, i) => (
            <span key={i} className="inline-flex items-center gap-0.5 px-1 py-0 text-[9px] font-bold border-2 border-black bg-[#E4D9B8]">
              {tagText(tg)}
              <button className="text-[#B3392E] font-black" title="移除该标签"
                onClick={() => { const next = tags.filter((_, j) => j !== i); onChange(next.length ? next : undefined) }}>×</button>
            </span>
          ))}
        </div>
      )}
      <div className="flex items-center gap-1 flex-wrap">
        <select className={selCls} value={cat} onChange={e => setCat(e.target.value as typeof cat)}>
          <option value="prefer">偏好</option>
          <option value="exclude">约束</option>
          <option value="resource">资源</option>
        </select>
        {cat === 'prefer' && (
          <select className={selCls} value={pKey} onChange={e => setPKey(e.target.value as PreferTagKey)}>
            {PREFER_LABELS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        )}
        {cat === 'exclude' && (
          <select className={selCls} value={xKey} onChange={e => setXKey(e.target.value as ExcludeTagKey)}>
            {EXCLUDE_LABELS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        )}
        {cat === 'resource' && (
          <>
            <select className={selCls} value={rRes} onChange={e => setRRes(e.target.value as ResourceTagKey)}>
              {RESOURCE_LABELS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            <select className={selCls} value={rOp} onChange={e => setROp(e.target.value as 'lt' | 'gt')}>
              <option value="lt">低于</option>
              <option value="gt">高于</option>
            </select>
            <input className={`${selCls} w-12`} value={rVal} onChange={e => setRVal(e.target.value)} title="阈值（占上限百分比 0-100）" />
            <span className="text-[9px] font-bold text-black/60">%禁火</span>
          </>
        )}
        <button className="comic-btn px-1.5 py-0.5 text-[10px]" onClick={add}>＋添加</button>
      </div>
    </div>
  )
}

function getPath(obj: unknown, path: string): unknown {
  let cur = obj as Record<string, unknown>
  for (const key of path.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined
    cur = cur[key] as Record<string, unknown>
  }
  return cur
}

/** 美术配置编辑块（规范 §7.3/P3）：art JSON 文本编辑 + validateArt 校验（errors 红 / warnings 黄） */
type ArtCfg = NonNullable<TurretDef['art']>

const DEFAULT_ART = (): ArtCfg => ({
  anchor: [0.5, 0.5],
  // 四个可见层都必须显式选素材；新建炮塔默认不绘制任何几何替代图形。
  baseAsset: 'none',
  turretAsset: 'none',
  barrelAsset: 'none',
  flashAsset: 'none',
  recoil: 0.1, // v1.58 统一后坐（全管共用）
  barrels: [{ mount: [0, 0], muzzle: [0, 0.5] }],
})

/** 预览有效挂点表（与 engine.artMounts 同规则）：逻辑炮管数是唯一数量来源。 */
function previewMounts(def: TurretDef): { mount: [number, number]; muzzle: [number, number]; recoil: number }[] {
  const cfg = def.art?.barrels
  const uni = def.art?.recoil // v1.58 统一后坐：全管共用，优先于遗留逐管 recoil
  const n = Math.max(1, Math.floor(def.barrels ?? 1))
  const spread = def.w * 0.6
  return Array.from({ length: n }, (_, i) => {
    const configured = cfg?.[i]
    if (configured) return { mount: configured.mount, muzzle: configured.muzzle, recoil: uni ?? configured.recoil ?? 0.1 }
    const lat = n <= 1 ? 0 : (i - (n - 1) / 2) * (spread / (n - 1))
    return { mount: [lat, 0] as [number, number], muzzle: [lat, 0.35] as [number, number], recoil: uni ?? 0.1 }
  })
}

/** 预览绘制（模块级纯函数）：32px 方格 + 居中原点 + 贴图分层；angle=0 炮口朝上。 */
// v2.10 光束粒子预览池（模块级：drawArtPreview 每帧推进；静态重绘时清空）
const artPrevBeamPool = createPool()
const artPrevBeamAcc = { absorb: 0, scatter: 0, smoke: 0 }
let artPrevBeamLastT = -1

function drawArtPreview(cv: HTMLCanvasElement, def: TurretDef, anim?: { t: number }, markers = true) { // v1.57 anim.t=播放经过秒（不传=静态）；v1.59 markers=是否显示轴心/挂点/炮口/充能点位标注
  if (!anim) { artPrevBeamPool.parts.length = 0; artPrevBeamLastT = -1; artPrevBeamAcc.absorb = 0; artPrevBeamAcc.scatter = 0; artPrevBeamAcc.smoke = 0 } // v2.10 静态重绘清空粒子
  const ctx = cv.getContext('2d')
  if (!ctx) return
  const S = cv.width
  const art = def.art
  // 炮塔编辑器默认严格按原始像素显示：32px=1格。
  // 过去按画布尺寸自适应计算 cell，会把 S 型炮塔约放大到 2.84 倍；
  // 现在只有下方预览缩放控件会改变最终显示倍率。
  const cell = BASE_CELL
  // 炮塔轴心就是炮塔原点，并永远锁定在预览画布中心；
  // 轴心参数改变时仅移动炮身贴图相对原点的位置，不移动炮位/炮口/索敌原点。
  const ancX = S / 2
  const ancY = S / 2
  const tpx = ancX - def.w * cell / 2
  const tpy = ancY - def.h * cell / 2
  // config 坐标 → 预览像素：anchor 为原点，x 向右为正、y 向上（沿炮口）为正，与游戏渲染一致 (x, -y)
  // 预览格坐标统一通过 PCell 使用全局 BASE_CELL 换算
  // 美术坐标空间：固定 BASE_CELL=32px=1格（贴图/挂点/炮口/后座/火光/充能偏移），与战场严格对应
  const PCell = (x: number, y: number): [number, number] => [ancX + x * BASE_CELL, ancY - y * BASE_CELL]
  ctx.clearRect(0, 0, S, S)
  // v2.12 深色底（与弹丸预览一致 #262420）。
  ctx.fillStyle = '#262420'
  ctx.fillRect(0, 0, S, S)
  // 只绘制 32×32px 完整方格，不显示半格细分线或 X/Y 坐标轴。
  ctx.strokeStyle = 'rgba(239,235,216,0.07)'
  ctx.lineWidth = 1
  ctx.beginPath()
  const gridStartX = ((ancX % cell) + cell) % cell
  const gridStartY = ((ancY % cell) + cell) % cell
  for (let x = gridStartX; x <= S + 0.5; x += cell) { ctx.moveTo(x, 0); ctx.lineTo(x, S) }
  for (let y = gridStartY; y <= S + 0.5; y += cell) { ctx.moveTo(0, y); ctx.lineTo(S, y) }
  ctx.stroke()
  const mounts = previewMounts(def)
  // ---- v1.57 射击动画预览（播放动画按钮）----
  // 直射/抛射/导弹：充能前摇 → 击发（火光 0.2s + 后座 0.4s 线性回位）循环，周期=fireRate，连发按 burstInterval 轮转各管；
  // 光束/喷射：充能后持续开火（光束矩形/喷射扇形 + 火光循环 2 帧）
  const isBeamP = def.type === 'beam'
  const isSprayP = def.type === 'spray'
  const contFireP = isBeamP || isSprayP
  const chargeDurP = def.chargeTime && def.chargeTime > 0 ? def.chargeTime : 0
  let chargeP: number | null = null // 充能进度 0-1（仅播放中）
  let contFiring = false // 持续开火中（光束/喷射）
  const fireEl: (number | null)[] = [] // 各管最近一次击发的经过秒（后座/火光时间基准）
  if (anim) {
    if (contFireP) {
      // v2.15：充能末帧滞留 0.05s（v2.16，与战场一致）——chargeDur 内前 N-1 帧，滞留段定格末帧，之后才起射
      if (chargeDurP > 0 && anim.t < chargeDurP + CHARGE_LAST_HOLD) chargeP = Math.min(1, anim.t / chargeDurP)
      else { contFiring = true; if (chargeDurP > 0) chargeP = 1; fireEl[0] = Math.max(0, anim.t - chargeDurP - CHARGE_LAST_HOLD) }
    } else {
      const nShots = Math.max(1, Math.floor(def.burst ?? 1))
      const gap = def.burstInterval ?? 0.15
      const period = Math.max(def.fireRate || 1, chargeDurP + 0.05 + (nShots - 1) * gap + 0.6, 0.8)
      const ct = anim.t % period
      if (ct < chargeDurP + 0.05) chargeP = Math.min(1, ct / chargeDurP)
      else for (let k = 0; k < nShots; k++) {
        const el = ct - chargeDurP - 0.05 - k * gap
        if (el >= 0) fireEl[k % mounts.length] = el // k 递增 el 递减，末写=最近一发
      }
    }
  }
  const st = turretArtState(def)
  drawTurretPreviewCore(ctx, def, { x: tpx, y: tpy, cell }, { chargeProgress: chargeP, firing: contFiring, fireElapsed: fireEl })
  // 标注：recoil 虚线箭头 / flash 尺寸参考圆 / 挂点炮口点位（v1.59：markers 勾选框统一显隐）
  const fs = FLASH_SCALES[0] // 火光参考尺寸 = 第 1 帧缩放 1.4×（v1.45 硬编码）
  if (markers) mounts.forEach((b, i) => {
    const [mx, my] = PCell(b.mount[0], b.mount[1])
    const [zx, zy] = PCell(b.muzzle[0], b.muzzle[1])
    if (b.recoil > 0) {
      ctx.strokeStyle = 'rgba(46,99,184,0.8)'
      ctx.setLineDash([3, 2])
      ctx.beginPath()
      ctx.moveTo(mx, my)
      ctx.lineTo(mx, my + b.recoil * BASE_CELL) // 反炮口方向（向下）；美术坐标 BASE_CELL=1格
      ctx.stroke()
      ctx.setLineDash([])
      ctx.fillStyle = 'rgba(46,99,184,0.8)'
      ctx.beginPath() // 箭头
      ctx.moveTo(mx - 3, my + b.recoil * BASE_CELL - 4)
      ctx.lineTo(mx + 3, my + b.recoil * BASE_CELL - 4)
      ctx.lineTo(mx, my + b.recoil * BASE_CELL)
      ctx.closePath()
      ctx.fill()
    }
    if (art?.flashAsset && art.flashAsset !== 'none' && art.flashAsset !== 'geo') { // 仅已配置火光素材时显示尺寸参考
      const r = Math.hypot(b.muzzle[0] - b.mount[0], b.muzzle[1] - b.mount[1]) * BASE_CELL * fs / 2
      ctx.fillStyle = 'rgba(240,160,60,0.25)'
      ctx.beginPath()
      ctx.arc(zx, zy, r, 0, Math.PI * 2)
      ctx.fill()
    }
    // 标注点错位防重叠：序号奇偶左右分列、按序号纵向错开
    const side = i % 2 === 0 ? 1 : -1
    const tag = (x: number, y: number, label: string, color: string, dy: number) => {
      ctx.fillStyle = color
      ctx.strokeStyle = 'rgba(239,235,216,0.85)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.arc(x, y, 3, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
      ctx.fillStyle = color
      ctx.font = 'bold 9px sans-serif'
      ctx.fillText(label, x + side * 5 - (side < 0 ? 18 : 0), y + dy)
    }
    tag(mx, my, `挂${i + 1}`, '#2E63B8', 10 + i * 3)
    tag(zx, zy, `口${i + 1}`, '#B3392E', -5 - i * 3)
  })
  if (art?.charge) { // 充能动画点（绿色）：有 charge.png 时叠画第 1 帧
    const [cxp, cyp] = PCell(art.charge.offset[0], art.charge.offset[1])
    const stc = turretArtState(def)
    if (stc.status === 'ready' && stc.assets?.charge) { // v2.3：按帧数横向等分（与战场渲染一致）
      const { sx, sw, sh } = chargeFrameRect(stc.assets.charge.width, stc.assets.charge.height, art.charge.frames, (chargeP ?? 0) * (art.charge.frames - 1) / Math.max(1, art.charge.frames)) // v2.15 末帧不计入充能时间
      ctx.imageSmoothingEnabled = false
      ctx.drawImage(stc.assets.charge, sx, 0, sw, sh, cxp - sw / 2, cyp - sh / 2, sw, sh)
    }
    if (markers) { // v1.59 充能点位标注可隐藏
      ctx.fillStyle = '#2E8B57'
      ctx.strokeStyle = 'rgba(239,235,216,0.85)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.arc(cxp, cyp, 3, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
      ctx.font = 'bold 9px sans-serif'
      ctx.fillText('充', cxp + 5, cyp + 8)
    }
  }
  // ---- v1.57 播放动画叠加：光束/喷射持续体 + 炮口火光（贴图帧条优先、无素材几何圆回退、「无」不播）----
  if (anim && contFiring) {
    const b0 = mounts[0]
    const [zx, zy] = PCell(b0.muzzle[0], b0.muzzle[1])
    if (isBeamP) { // 光束：v2.7 分层贴图（与战场同步：光晕+亮芯平铺滚动+亮度闪烁+炮口光球+命中闪光；'none'/未就绪回退程序化矩形）
      const wpx = Math.max(2, (def.beamWidth ?? 1.024) / M_PER_CELL * BASE_CELL)
      const ba = beamArtConfig(def)
      const tSec = anim.t
      const wave = 0.5 + 0.5 * (0.7 * Math.sin(tSec * 22) + 0.3 * Math.sin(tSec * 57))
      const bright = 1 - ba.flicker + ba.flicker * wave
      const scroll = ba.scrollSpeed > 0 ? tSec * ba.scrollSpeed : 0 // 预览比例 BASE_CELL px/格；战场按当前缩放同步换算
      const lenPx = zy // 预览向上画满画布
      ctx.save()
      ctx.translate(zx, zy)
      ctx.rotate(-Math.PI / 2) // 局部 +x 沿光束方向（向上）
      const glowT = ba.glow?.status === 'ready' && ba.glow.img ? tintedFx(ba.glow.img, ba.fringeColor) : null
      const coreT = ba.core?.status === 'ready' && ba.core.img ? tintedFx(ba.core.img, ba.coreColor) : null
      // v2.50：宽幅已配置 → 贴图高度缩放到 宽幅/M_PER_CELL 格（与战场同语义）；未配置 = 贴图原生高度
      const fitP = (im: { height: number } | null, targetH: number) =>
        def.beamWidth !== undefined && im ? targetH / im.height : 1
      drawBeamLayer(ctx, glowT, ba.fringeColor, lenPx, wpx, 0.45 * bright, scroll, 1, fitP(glowT, wpx))
      drawBeamLayer(ctx, coreT, ba.coreColor, lenPx, wpx * 0.5, 0.9 * bright, scroll, 1, fitP(coreT, wpx * 0.5))
      const mzT = ba.muzzle?.status === 'ready' && ba.muzzle.img ? tintedFx(ba.muzzle.img, ba.fringeColor) : null
      if (mzT) { // 炮口光球（缺省 glow16；v2.10 尺寸×muzzleScale）
        const msz = wpx * 2 * ba.muzzleScale * (0.9 + 0.2 * wave)
        ctx.globalCompositeOperation = 'lighter'
        ctx.globalAlpha = 0.85 * bright
        ctx.drawImage(mzT, -msz / 2, -msz / 2, msz, msz)
        ctx.globalCompositeOperation = 'source-over'
        ctx.globalAlpha = 1
      }
      const imT = ba.impact?.status === 'ready' && ba.impact.img ? tintedFx(ba.impact.img, ba.coreColor) : null
      if (imT) { // 命中点闪光（缺省 glow16，光束端点；v2.10 尺寸×impactScale）
        const isz = wpx * 2.6 * ba.impactScale * (0.85 + 0.3 * wave)
        const tw = Math.sin(tSec * 40)
        ctx.globalCompositeOperation = 'lighter'
        ctx.globalAlpha = Math.min(1, 0.75 * bright + 0.25 * tw * tw)
        ctx.drawImage(imT, lenPx - isz / 2, -isz / 2, isz, isz)
        ctx.globalCompositeOperation = 'source-over'
        ctx.globalAlpha = 1
      }
      ctx.restore()
      // v2.10 光束三组粒子（与战场/弹丸预览同参数；吸收=炮口环带向心、散发=端点飞溅、烟尘=端点不加光）
      const dtB = artPrevBeamLastT < 0 ? 0 : Math.min(0.1, Math.max(0, tSec - artPrevBeamLastT))
      artPrevBeamLastT = tSec
      if (ba.absorb) {
        artPrevBeamAcc.absorb += ba.absorb.rate * dtB
        const n = Math.floor(artPrevBeamAcc.absorb)
        artPrevBeamAcc.absorb -= n
        for (let i = 0; i < n; i++) {
          const ang = Math.random() * Math.PI * 2
          const dist = (0.35 + Math.random() * 0.3) * BASE_CELL // px
          const sp = 1.6 * BASE_CELL // px/s
          spawnTrail(artPrevBeamPool, zx + Math.cos(ang) * dist, zy + Math.sin(ang) * dist, {
            vx: -Math.cos(ang) * sp, vy: -Math.sin(ang) * sp,
            life: dist / sp, size: ba.absorb.size, color: ba.absorb.color, drag: 0,
          })
        }
      }
      if (ba.scatter) {
        artPrevBeamAcc.scatter += ba.scatter.rate * dtB
        const n = Math.floor(artPrevBeamAcc.scatter)
        artPrevBeamAcc.scatter -= n
        const cone = ba.scatter.angle * Math.PI / 180 // v2.15：散发角度——朝射线源（向下）为 0°；360=全向
        for (let i = 0; i < n; i++) {
          const ang = ba.scatter.angle >= 360 ? Math.random() * Math.PI * 2 : Math.PI / 2 + (Math.random() - 0.5) * cone
          const sp = (2 + Math.random() * 2) * BASE_CELL
          spawnTrail(artPrevBeamPool, zx, 4, { // 端点=画布顶边内 4px（防裁切）
            vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
            life: 0.2 + Math.random() * 0.15, size: ba.scatter.size, color: ba.scatter.color, drag: 6, streak: true,
          })
        }
      }
      if (ba.smoke) {
        artPrevBeamAcc.smoke += ba.smoke.rate * dtB
        const n = Math.floor(artPrevBeamAcc.smoke)
        artPrevBeamAcc.smoke -= n
        for (let i = 0; i < n; i++) {
          const ang = Math.random() * Math.PI * 2
          const sp = (0.3 + Math.random() * 0.4) * BASE_CELL
          spawnTrail(artPrevBeamPool, zx, 4, {
            vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 0.2 * BASE_CELL,
            life: 0.8 + Math.random() * 0.4, size: ba.smoke.size, color: ba.smoke.color, drag: 1.5, grow: 2,
          })
        }
      }
      stepParticles(artPrevBeamPool, dtB)
      // 粒子层绘制（贴图口径与战场/v2.6 一致：烟尘 smoke32 不加光，其余 particlealpha32 + lighter）
      const fxPE = srcImage('/res/fx/particlealpha32.png')
      const fxSE = srcImage('/res/fx/smoke32.png')
      const fxP = fxPE.status === 'ready' ? fxPE.img : undefined
      const fxS = fxSE.status === 'ready' ? fxSE.img : undefined
      for (const pt of artPrevBeamPool.parts) {
        const k = Math.max(0, pt.life / pt.maxLife)
        let a = k * (pt.grow > 0 ? 0.5 : 0.9)
        if (pt.fadeIn && pt.fadeIn > 0) a *= Math.min(1, (pt.maxLife - pt.life) / pt.fadeIn)
        if (a <= 0.01) continue
        ctx.globalCompositeOperation = pt.grow > 0 ? 'source-over' : 'lighter'
        const r = Math.max(0.5, pt.size * BASE_CELL)
        const tex = pt.grow > 0 ? fxS : fxP
        const col = pt.colorEnd ? gradientColorKey(pt.color, pt.colorEnd, 1 - k) : pt.color
        if (pt.streak) { // v2.15 电焊式拖尾（与战场一致：速度反向 0.05s 亮线）
          ctx.globalAlpha = a
          ctx.strokeStyle = col
          ctx.lineWidth = Math.max(1, r * 0.6)
          ctx.beginPath()
          ctx.moveTo(pt.x - pt.vx * 0.05, pt.y - pt.vy * 0.05)
          ctx.lineTo(pt.x, pt.y)
          ctx.stroke()
        }
        const tint = tex ? tintedFx(tex, col) : null
        ctx.globalAlpha = a
        if (tint) ctx.drawImage(tint, pt.x - r, pt.y - r, r * 2, r * 2)
        else { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2); ctx.fill() }
      }
      ctx.globalCompositeOperation = 'source-over'
      ctx.globalAlpha = 1
    } else if (isSprayP) { // 喷射：扇形锥（半径封顶画布）
      const half = (def.sprayAngle ?? 60) * Math.PI / 360
      const rC = Math.min(def.rangeMax / M_PER_CELL * BASE_CELL, S)
      ctx.fillStyle = 'rgba(217,120,45,0.4)'
      ctx.beginPath()
      ctx.moveTo(zx, zy)
      ctx.arc(zx, zy, rC, -Math.PI / 2 - half, -Math.PI / 2 + half)
      ctx.closePath()
      ctx.fill()
    }
  }
  if (anim) {
    mounts.forEach((b, i) => {
      const el = fireEl[i]
      if (el == null) return
      if (!contFiring && el >= FLASH_DURATION) return // 击发型火光窗 0.2s（v1.45 硬编码）
      if (!def.art?.flashAsset || def.art.flashAsset === 'none' || def.art.flashAsset === 'geo') return
      const fi = Math.min(FLASH_FRAMES - 1, Math.floor((contFiring ? el % FLASH_DURATION : el) / FLASH_FRAME_DUR)) // 固定 2 帧
      const [zx, zy] = PCell(b.muzzle[0], b.muzzle[1])
      if (st.status === 'ready' && st.assets?.flash) { // 贴图火光：原尺寸 × 逐帧缩放 1.4×→1×，炮口点向上展开
        const img = st.assets.flash
        const fh = img.height
        ctx.save()
        ctx.globalCompositeOperation = 'lighter' // v2.6：火光加法发光（与战场同步）
        ctx.imageSmoothingEnabled = false
        if (img.width >= fh * FLASH_FRAMES) { // 横向帧条（fh×fh × N）：逐帧裁切
          const size = fh * FLASH_SCALES[fi]
          ctx.drawImage(img, fi * fh, 0, fh, fh, zx - size / 2, zy - size, size, size)
        } else { // v1.77：单张火光图：整图绘制，逐帧脉冲缩放（与游戏内渲染同规则）
          const fw = img.width * FLASH_SCALES[fi]
          const fhh = fh * FLASH_SCALES[fi]
          ctx.drawImage(img, zx - fw / 2, zy - fhh, fw, fhh)
        }
        ctx.restore()
      }
    })
  }
  // ---- v1.78 播放动画弹丸：击发弹丸从炮口沿炮口方向飞出（直射/抛射/导弹；光束/喷射持续型无弹丸）----
  if (anim && !contFireP && chargeP == null) {
    const nShots = Math.max(1, Math.floor(def.burst ?? 1))
    const gap = def.burstInterval ?? 0.15
    const period = Math.max(def.fireRate || 1, chargeDurP + (nShots - 1) * gap + 0.6, 0.8)
    const ct = anim.t % period
    const pid = def.art?.projectile
    const ammo = pid ? projectileArtDef(pid) : undefined
    const pst = ammo ? projectileArtState(ammo) : null
    const pImg = pst && pst.status === 'ready' && pst.assets ? pst.assets.projectile : null // 弹丸贴图（库引用 ?? 文件夹解析链）
    const spd = (def.projectileSpeed ?? 12.8) / M_PER_CELL // 弹速 → 格/秒
    const hasTrail = !!(ammo && resolveTrailFx(ammo)) // 配了尾焰的弹丸补两颗渐隐尾随点（模拟战场粒子观感）
    for (let k = 0; k < nShots; k++) {
      const el = ct - chargeDurP - 0.05 - k * gap
      if (el < 0) continue // 该发尚未击发
      const b = mounts[k % mounts.length] // 与火光/后座同规则：第 k 发 → 第 k%N 管
      const [zx, zy] = PCell(b.muzzle[0], b.muzzle[1])
      const py = zy - spd * el * BASE_CELL // 沿炮口方向（预览 +y 向上）推进
      if (py < -24) continue // 飞出画布不再绘制
      if (pImg && ammo) { // 贴图弹丸：垂发导弹直接从当前本体帧条取帧，其余仍使用整张图。
        const frame = projectileBodyFrameRect(ammo, pImg.naturalWidth, pImg.naturalHeight, el)
        ctx.save()
        ctx.imageSmoothingEnabled = false
        ctx.drawImage(pImg, frame.sx, 0, frame.sw, frame.sh, zx - frame.sw / 2, py - frame.sh / 2, frame.sw, frame.sh)
        ctx.restore()
        if (hasTrail) {
          ctx.fillStyle = 'rgba(245,233,200,0.5)'
          ctx.beginPath(); ctx.arc(zx, py + 6, 1.8, 0, Math.PI * 2); ctx.fill()
          ctx.fillStyle = 'rgba(245,233,200,0.25)'
          ctx.beginPath(); ctx.arc(zx, py + 12, 1.2, 0, Math.PI * 2); ctx.fill()
        }
      } else { // 几何回退：曳光短线（与战场 bullet 回退同色 #F5E9C8）
        ctx.strokeStyle = '#F5E9C8'
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.moveTo(zx, Math.min(zy, py + 15))
        ctx.lineTo(zx, py)
        ctx.stroke()
      }
    }
  }
  // 轴心：固定在预览中心的红色十字（markers 门控）。
  if (markers) {
    ctx.strokeStyle = '#E03A32'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(ancX - 5, ancY)
    ctx.lineTo(ancX + 5, ancY)
    ctx.moveTo(ancX, ancY - 5)
    ctx.lineTo(ancX, ancY + 5)
    ctx.stroke()
  }
}

// v1.57 e2e 探针：动画绘制的确定性验证（虚拟时间下 rAF 帧率不可靠，直接注入 t 采样）
if (typeof window !== 'undefined') (window as unknown as { __artPreview?: unknown }).__artPreview = { draw: drawArtPreview, defs: TURRET_DEFS }
// v1.69 弹丸效果预览探针（无头/sim 验证）
if (typeof window !== 'undefined') (window as unknown as { __ammoFx?: unknown }).__ammoFx = { sim: simAmmoFx, canPlay, arts: PROJECTILE_ARTS }

const PREVIEW_ZOOM_MIN = 50
const PREVIEW_ZOOM_MAX = 200
const PREVIEW_ZOOM_STEP = 25

function PreviewZoom({ value, onChange, overlay = true, compact = false }: { value: number; onChange: (value: number) => void; overlay?: boolean; compact?: boolean }) {
  const adjust = (direction: -1 | 1) => onChange(Math.max(PREVIEW_ZOOM_MIN, Math.min(PREVIEW_ZOOM_MAX, value + direction * PREVIEW_ZOOM_STEP)))
  return (
    <div className={`${overlay ? 'absolute bottom-1.5 right-1.5 z-10' : ''} flex items-center justify-center border-2 border-black bg-[#D2CCA9] p-0.5 shadow-[1px_1px_0_rgba(0,0,0,0.45)]`} aria-label="预览缩放">
      <button type="button" aria-label="缩小预览" title="缩小预览" disabled={value <= PREVIEW_ZOOM_MIN} onClick={() => adjust(-1)} className={`comic-btn flex items-center justify-center p-0 leading-none disabled:opacity-40 ${compact ? 'h-5 w-5 text-sm' : 'h-6 w-6 text-base'}`}>−</button>
      <span className={`${compact ? 'w-9 text-[9px]' : 'w-11 text-[10px]'} text-center font-black tabular-nums text-black/70`}>{value}%</span>
      <button type="button" aria-label="放大预览" title="放大预览" disabled={value >= PREVIEW_ZOOM_MAX} onClick={() => adjust(1)} className={`comic-btn flex items-center justify-center p-0 leading-none disabled:opacity-40 ${compact ? 'h-5 w-5 text-sm' : 'h-6 w-6 text-base'}`}>＋</button>
    </div>
  )
}

/** 美术预览画布：随 def.art 修改即时重绘；贴图加载完成后自动升级；v1.57 预览窗口下侧「播放动画」射击循环预览 */
function ArtPreview({ def }: { def: TurretDef }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const burstAudioOpenRef = useRef(false)
  const previewId = useId()
  const continuousLoopKeyRef = useRef(`turret-preview:${def.id}:${previewId}`)
  const artJson = JSON.stringify(def.art ?? null)
  const soundJson = JSON.stringify(def.sounds ?? null)
  const nBarrels = Math.max(1, Math.floor(def.barrels ?? 1))
  const [playing, setPlaying] = useState(false) // v1.57 播放射击动画
  const [markers, setMarkers] = useState(true) // v1.59 点位标注显隐（轴心/挂点/炮口/充能）
  const [previewZoom, setPreviewZoom] = useState(100)
  useEffect(() => {
    void artJson // art 变更触发重绘（def 为就地修改对象）
    if (playing) return // 播放中由 rAF 循环驱动
    let alive = true
    let tries = 0
    const paint = () => {
      const cv = ref.current
      if (!cv || !alive) return
      drawArtPreview(cv, def, undefined, markers)
      if (turretArtState(def).status === 'loading' && tries++ < 20) setTimeout(paint, 150)
    }
    paint()
    return () => { alive = false }
  }, [def, artJson, nBarrels, playing, markers])
  useEffect(() => { // v1.57 播放循环：rAF 每帧重绘，t=播放经过秒（素材加载逐帧自动升级，无需重试器）
    if (!playing) return
    const continuousLoopKey = continuousLoopKeyRef.current
    let raf = 0
    let alive = true
    const t0 = performance.now()
    let audioCycle = -1
    let audioShot = -1
    let continuousAudioPlayed = false
    const playFireSound = (role: 'fire' | 'burstLoop') => {
      const sounds = def.sounds
      const cue = resolveCue(role === 'burstLoop' ? sounds?.burstLoop ?? sounds?.fire : sounds?.fire)
      burstAudioOpenRef.current = role === 'burstLoop'
      void playCue(cue)
    }
    const loop = () => {
      const elapsed = (performance.now() - t0) / 1000
      const cv = ref.current
      if (cv) drawArtPreview(cv, def, { t: elapsed }, markers)

      const continuous = def.type === 'beam' || def.type === 'spray'
      const chargeDuration = def.chargeTime && def.chargeTime > 0 ? def.chargeTime : 0
      if (continuous) {
        // 与实战相同：完整充能及末帧滞留结束、光束真正射出后才启动持续声。
        if (!continuousAudioPlayed && elapsed >= chargeDuration + CHARGE_LAST_HOLD) {
          continuousAudioPlayed = true
          if (def.type === 'beam') {
            const ammo = PROJECTILE_ARTS.find(item => item.id === def.art?.projectile)
            const continuousCue = resolveCue(def.sounds?.continuous ?? ammo?.sounds?.continuous)
            const startContinuous = () => { if (alive) void startCueLoop(continuousLoopKey, continuousCue) }
            // 起射先播放开火声，固定延迟后接入持续循环；停止预览后 alive 会阻止迟到启动。
            void playCue(resolveCue(def.sounds?.fire))
              .then(() => window.setTimeout(startContinuous, BEAM_CONTINUOUS_AUDIO_DELAY * 1000))
          } else playFireSound('fire')
        }
      } else {
        const shotCount = Math.max(1, Math.floor(def.burst ?? 1))
        const shotGap = Math.max(0, def.burstInterval ?? 0.15)
        // 与实战同语义：一轮连发完成后等待 fireRate，再进行下一轮充能。
        const period = Math.max(0.05, (shotCount - 1) * shotGap + Math.max(0, def.fireRate || 0) + chargeDuration + 0.05)
        const cycle = Math.floor(elapsed / period)
        const cycleTime = elapsed - cycle * period
        if (cycle !== audioCycle) {
          audioCycle = cycle
          audioShot = -1
        }
        let reachedShot = -1
        for (let shot = 0; shot < shotCount; shot++) {
          if (cycleTime >= chargeDuration + 0.05 + shot * shotGap) reachedShot = shot
          else break
        }
        for (let shot = audioShot + 1; shot <= reachedShot; shot++) {
          playFireSound(turretFireSoundRole(def, shot))
        }
        audioShot = Math.max(audioShot, reachedShot)
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => {
      alive = false
      cancelAnimationFrame(raf)
      stopCueLoop(continuousLoopKey, def.type === 'beam' ? BEAM_FADE : 0)
    }
  }, [playing, def, artJson, soundJson, nBarrels, markers])
  const v = validateArt(def)
  return (
    <div className="relative mx-auto my-1 w-full max-w-[200px]">
      {/* v1.59 点位图例置顶 + 勾选框决定预览图是否显示这些点位 */}
      <div className="flex items-center justify-center gap-2 mb-0.5 text-[9px] font-bold">
        <span className="text-[#E03A32]">✚ 轴心</span>
        <span className="text-[#2E63B8]">● 挂点</span>
        <span className="text-[#B3392E]">● 炮口</span>
        <span className="text-[#2E8B57]">● 充能</span>
        <label className="flex items-center gap-0.5 cursor-pointer" title="勾选后预览图显示轴心/挂点/炮口/充能点位标注（含后座箭头与火光尺寸参考）">
          <input
            type="checkbox"
            className="w-3 h-3 accent-[#B3392E]"
            checked={markers}
            onChange={e => setMarkers(e.target.checked)}
          />
          <span className="text-black/60">点位</span>
        </label>
      </div>
      <div className="relative aspect-square overflow-hidden border-2 border-black bg-[#262420]">
        <canvas ref={ref} width={200} height={200} className="block h-full w-full transition-transform duration-150" style={{ transform: `scale(${previewZoom / 100})` }} />
        {v.warnings.length > 0 && (
          <span className="absolute top-1 right-1 text-[11px] font-bold text-[#B98A1D]" title={v.warnings.join('\n')}>
            ⚠{v.warnings.length}
          </span>
        )}
      </div>
      {/* v1.57 预览窗口下侧：播放/停止射击动画（充能→击发火光 2 帧 + 炮管后座回位；光束/喷射为持续开火） */}
      <div className="mt-0.5 grid grid-cols-2 items-center gap-1">
        <button
          className="comic-btn h-8 w-full px-2 py-0.5 text-[10px]"
          onClick={() => setPlaying(p => {
            if (!p) void audioManager.unlock()
            else if (burstAudioOpenRef.current) {
              burstAudioOpenRef.current = false
              void playCue(resolveCue(def.sounds?.fire))
            }
            return !p
          })}
          title="循环播放射击动画和对应音效；射线持续音效会在光束停火时随消散过程渐隐"
        >{playing ? '■ 停止' : '▶ 播放动画'}</button>
        <PreviewZoom value={previewZoom} onChange={setPreviewZoom} overlay={false} />
      </div>
    </div>
  )
}

function HeatPreview({ def }: { def: TurretDef }) {
  const fortress = FORTRESS_DEFS.find(f => f.id === getSelectedFortressId()) ?? DEFAULT_FORTRESS
  const curve = simulateTurretHeat(def, fortress, 20, 0.1)
  const cap = fortress.heatCap
  const points = curve.map(p => `${(p.time / 20) * 180},${42 - (p.heat / cap) * 38}`).join(' ')
  const firstOverheat = curve.find(p => p.overheated)?.time
  const peak = Math.max(...curve.map(p => p.heat))
  return (
    <div className="border-2 border-black/40 bg-[#262420] p-1 mt-1" aria-label="热管理预览">
      <div className="flex items-center justify-between text-[9px] font-bold text-[#EFEBD8]">
        <span>热管理预览 · 单座持续射击 20s</span>
        <span>{firstOverheat === undefined ? '稳定' : `${firstOverheat.toFixed(1)}s 过热`} · 峰值 {Math.round(peak)}/{cap}</span>
      </div>
      <svg viewBox="0 0 180 46" className="w-full h-12" role="img" aria-label="热量曲线">
        <line x1="0" y1="23" x2="180" y2="23" stroke="#B3392E" strokeDasharray="3 2" opacity="0.55" />
        <polyline points={points} fill="none" stroke="#D9762E" strokeWidth="2" />
      </svg>
    </div>
  )
}

/** 美术配置表单（规范 §7.3/P3）：结构化字段即时生效 + ArtPreview 实时预览 + validateArt 校验 */
function ArtEditor({ def, onApply }: { def: TurretDef; onApply: (art: TurretDef['art'] | null) => void }) {
  const art = def.art // v1.59：板块常驻显示，无折叠状态
  const v = validateArt(def)
  // 所有修改在结构化克隆上进行，经 onApply 整体写回（react-hooks/immutability：不直接改 props）
  const patch = (fn: (a: ArtCfg) => void) => {
    const clone: ArtCfg = structuredClone(art ?? DEFAULT_ART())
    fn(clone)
    onApply(clone)
  }
  const numField = (
    label: string, val: number | undefined, step: number,
    commit: (n: number | undefined) => void, ph?: string, tip?: string,
  ) => (
    <label key={label} className="flex items-center gap-1 min-w-0">
      <TipLabel text={label} tip={tip} className="text-[9px] font-bold text-black/60 shrink-0 w-9" />
      <FieldNumInput v={val} step={step} clearable onCommit={commit} />
      {ph && val === undefined && <span className="text-[8px] text-black/35 shrink-0">{ph}</span>}
    </label>
  )
  // 美术配置底层继续按格/归一化坐标保存，编辑界面统一用像素输入，避免破坏旧存档。
  const pixelField = (
    label: string, val: number | undefined,
    commit: (n: number | undefined) => void, ph?: string, tip?: string,
  ) => numField(
    `${label}(px)`, val === undefined ? undefined : Math.round(val * BASE_CELL * 10000) / 10000, 1,
    n => commit(n === undefined ? undefined : Math.round((n / BASE_CELL) * 1000000) / 1000000), ph, tip,
  )
  const normalizedPixelField = (
    label: string, val: number, spanCells: number,
    commit: (n: number) => void, tip: string,
  ) => numField(
    `${label}(px)`, Math.round((val - 0.5) * spanCells * BASE_CELL * 10000) / 10000, 1,
    n => commit(0.5 + (n ?? 0) / (spanCells * BASE_CELL)), undefined, tip,
  )
  // 炮管挂点卡片数量由炮塔属性「炮管数」决定（默认 1）；未配置项按引擎均布默认显示
  const nBar = Math.max(1, Math.floor(def.barrels ?? 1))
  type BarrelEntry = { mount: [number, number]; muzzle: [number, number]; recoil?: number }
  const defBarrel = (i: number): BarrelEntry => {
    const lat = nBar > 1 ? (i - (nBar - 1) / 2) * ((def.w * 0.6) / (nBar - 1)) : 0 // 与引擎 artMounts 均布同规则
    return { mount: [lat, 0], muzzle: [lat, 0.35], recoil: 0.1 }
  }
  const barrelAt = (i: number): BarrelEntry => art?.barrels?.[i] ?? defBarrel(i)
  const patchBarrel = (i: number, fn: (b: BarrelEntry) => void) => patch(a => {
    const arr = Array.from({ length: nBar }, (_, j) => structuredClone(a.barrels?.[j] ?? defBarrel(j)))
    fn(arr[i])
    a.barrels = arr
  })
  return (
    <div className="mt-1 border-t-2 border-black/15 pt-1 landscape:mt-0 landscape:border-t-0 landscape:border-l-2 landscape:pl-2">
      {/* v1.59：板块常驻显示（不再折叠），与炮塔参数一致；标题为纯文本非按钮 */}
      <div className="flex items-center gap-1 text-[10px] font-bold text-black/70">
        美术配置(art)
        {!art && <span className="text-black/40">未配置·不绘制</span>}
        {v.errors.length > 0 && <span className="text-[#B3392E]">✕{v.errors.length}</span>}
        {v.warnings.length > 0 && <span className="text-[#B98A1D]">⚠{v.warnings.length}</span>}
      </div>
      {(
        <div className="mt-1">
          {!art ? (
            <button className="comic-btn px-2 py-0.5 text-[10px]" onClick={() => onApply(DEFAULT_ART())}>
              + 启用美术配置
            </button>
          ) : (
            <>
              <div className="flex gap-1 items-start">
                <ArtPreview def={def} />
                <div className="flex-1 min-w-0 space-y-0 pt-0.5">
                  {([['底座', 'baseAsset', 'base'], ['炮身', 'turretAsset', 'turret'], ['炮管', 'barrelAsset', 'barrel']] as const).map(([label, key, cat]) => {
                    const { groups, mismatch } = assetSelectGroups(cat, art[key])
                    return (
                      <div key={key} className="flex items-center gap-1 min-w-0">
                        <TipLabel text={label} tip={{ 底座: '底座贴图：固定不旋转；默认「无」，不绘制', 炮身: '炮身贴图：随瞄准方向旋转；默认「无」，不绘制', 炮管: '炮管贴图：根部锚定挂点；默认「无」，不绘制' }[label]} className="text-[9px] font-bold text-black/60 shrink-0 w-9" />
                        <span className="flex-1 min-w-0">
                          <span className="flex items-center gap-1 min-w-0">
                            <select
                              className="flex-1 min-w-0 px-0.5 py-0 text-[9px] font-comic border-2 border-black bg-[#EFEBD8]"
                              value={art[key] ?? 'none'}
                              onChange={e => patch(a => { a[key] = e.target.value })}
                            >
                              <option value="none">无（不绘制）</option>
                              {groups.map(([g, items]) => items.length > 0 && (
                                <optgroup key={g} label={g}>
                                  {items.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                                </optgroup>
                              ))}
                            </select>
                            {key === 'barrelAsset' && nBar >= 2 && (
                              <label className="flex items-center gap-0.5 shrink-0" title="勾选后，第2、4、6等偶数炮管贴图水平翻转；挂点、炮口和开火逻辑不变">
                                <input
                                  type="checkbox"
                                  aria-label="翻转偶数炮管"
                                  className="w-3 h-3 accent-[#B3392E]"
                                  checked={art.flipEvenBarrels === true}
                                  onChange={e => patch(a => {
                                    if (e.target.checked) a.flipEvenBarrels = true
                                    else delete a.flipEvenBarrels
                                  })}
                                />
                                <span className="text-[9px] font-bold text-black/60 whitespace-nowrap">翻转</span>
                              </label>
                            )}
                          </span>
                          {mismatch && (
                            <div className="text-[8px] font-bold text-[#B98A1D]">引用条目「{mismatch.name}」分类为{ASSET_CATEGORY_NAME[mismatch.category]}，与{label}不符</div>
                          )}
                        </span>
                      </div>
                    )
                  })}
                  {(() => {
                    const { groups, mismatch } = assetSelectGroups('flash', art.flashAsset)
                    return (
                      <label className="flex items-center gap-1 min-w-0">
                        <TipLabel text="火光" tip="开火火光贴图（帧条）；默认「无」不播放；表现硬编码：2 帧、逐帧 1.4×→1×、每帧 0.1s" className="text-[9px] font-bold text-black/60 shrink-0 w-9" />
                        <span className="flex-1 min-w-0">
                          <select
                            className="w-full min-w-0 px-0.5 py-0 text-[9px] font-comic border-2 border-black bg-[#EFEBD8]"
                            value={art.flashAsset ?? 'none'}
                            onChange={e => patch(a => { a.flashAsset = e.target.value })}
                          >
                            <option value="none">无（不播放）</option>
                            {groups.map(([g, items]) => items.length > 0 && (
                              <optgroup key={g} label={g}>
                                {items.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                              </optgroup>
                            ))}
                          </select>
                          {mismatch && (
                            <div className="text-[8px] font-bold text-[#B98A1D]">引用条目「{mismatch.name}」分类为{ASSET_CATEGORY_NAME[mismatch.category]}，与火光不符</div>
                          )}
                        </span>
                      </label>
                    )
                  })()}
                  {/* v1.58：zBias 置于火光下面；统一后坐（全管共用）置于 zBias 下面 */}
                  {numField('zBias', art.zBias, 1, n => patch(a => {
                    if (n === undefined) delete a.zBias
                    else a.zBias = n
                  }), '0', '炮管层级偏移：<0 时炮管画在炮身下面，默认 0')}
                  {numField('后坐', art.recoil ?? art.barrels?.[0]?.recoil, 0.05, n => patch(a => {
                    if (n === undefined) delete a.recoil
                    else a.recoil = n
                    a.barrels?.forEach(b => { delete b.recoil }) // 统一后清理遗留逐管值，避免双源
                  }), '0.1', '统一后坐（v1.58）：所有炮管共用，击发时炮管后退距离（格），纯视觉；0=无后坐动画')}
                </div>
              </div>
              {def.type === 'missile' && (
                <div className="mt-1 border-t border-black/15 pt-1">
                  <label className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      className="w-3.5 h-3.5 accent-[#B3392E]"
                      checked={art.rack?.show ?? true}
                      onChange={e => patch(a => { a.rack = { ...a.rack, show: e.target.checked } })}
                    />
                    <TipLabel text="挂载显示" tip="远行星号式弹架：炮管旁显示待发导弹，逐发消耗、打空显示空架、新一轮复挂（仅导弹塔）" className="text-[9px] font-bold text-black/60" />
                  </label>
                  <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 mt-0.5">
                    {pixelField('挂载x', art.rack?.dx, n => patch(a => {
                      a.rack = { ...a.rack }
                      if (n === undefined) delete a.rack.dx
                      else a.rack.dx = n
                    }), '0', '挂载点相对炮管挂点的侧向偏移（px），默认 0')}
                    {pixelField('挂载y', art.rack?.dy, n => patch(a => {
                      a.rack = { ...a.rack }
                      if (n === undefined) delete a.rack.dy
                      else a.rack.dy = n
                    }), String(0.12 * BASE_CELL), '挂载点沿炮口方向偏移（px），默认 3.84px（炮管根部侧后方）')}
                  </div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 mt-1">
                {normalizedPixelField('轴心 x', art.anchor?.[0] ?? 0.5, def.w, n => patch(a => { a.anchor = [n, a.anchor?.[1] ?? 0.5] }), '炮身贴图轴心相对炮塔原点的 X 偏移（px）；0 表示与炮位中心重合，正数向右')}
                {normalizedPixelField('轴心 y', art.anchor?.[1] ?? 0.5, def.h, n => patch(a => { a.anchor = [a.anchor?.[0] ?? 0.5, n] }), '炮身贴图轴心相对炮塔原点的 Y 偏移（px）；0 表示与炮位中心重合，正数向下')}
              </div>
              <div className="mt-1 space-y-1">
                {/* 挂点卡片数量由炮塔属性「炮管数」决定（默认 1），不提供手动增删；未配置的管按引擎均布默认显示 */}
                {Array.from({ length: nBar }, (_, i) => barrelAt(i)).map((b, i) => (
                  <div key={i} className="border border-black/25 p-1 bg-black/[0.03]">
                    <div className="flex items-center justify-between">
                      <span className="text-[9px] font-bold text-black/70">炮管 {i + 1}</span>
                      {!art.barrels?.[i] && <span className="text-[9px] text-black/40">默认</span>}
                    </div>
                    <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 mt-0.5">
                      {pixelField('挂点 x', b.mount?.[0], n => patchBarrel(i, bb => { bb.mount = [n ?? 0, bb.mount?.[1] ?? 0] }), undefined, '炮管根部挂点 X（相对轴心，px）')}
                      {pixelField('挂点 y', b.mount?.[1], n => patchBarrel(i, bb => { bb.mount = [bb.mount?.[0] ?? 0, n ?? 0] }), undefined, '炮管挂点 Y（沿炮口方向，px）')}
                      {pixelField('炮口 x', b.muzzle?.[0], n => patchBarrel(i, bb => { bb.muzzle = [n ?? 0.5, bb.muzzle?.[1] ?? 0] }), undefined, '出弹点 X（相对挂点，px）：火光/弹丸从此发出')}
                      {pixelField('炮口 y', b.muzzle?.[1], n => patchBarrel(i, bb => { bb.muzzle = [bb.muzzle?.[0] ?? 0.5, n ?? 0] }), undefined, '出弹点 Y（沿炮管方向，px）')}
                      {/* v1.58：后坐统一为 art.recoil 单一参数（素材列 zBias 下面），炮管卡片不再提供逐管后坐 */}
                    </div>
                  </div>
                ))}
              </div>
              {/* v1.45：火光缩放/时长/帧数配置项移除（表现硬编码）；zBias/弹丸/火光上移素材列 */}
              <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 mt-1">
                {def.type === 'beam' && ( // v2.3：充能动画板块仅射线类炮塔拥有
                <div className="col-span-2 mt-1 border-t border-black/15 pt-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-black/70">充能动画（charge.png）</span>
                    {art.charge ? (
                      <button className="text-[9px] text-[#B3392E]" onClick={() => patch(a => { delete a.charge })}>删除该组</button>
                    ) : (
                      <button className="text-[9px] text-[#2E63B8]" onClick={() => patch(a => { a.charge = { offset: [0, 0.3], frames: 4 } })}>+ 添加充能动画</button>
                    )}
                  </div>
                  <div className="text-[8px] text-black/40">素材按帧数横向等分，从左到右顺序播一遍（帧时长 = 充能时间/帧数）；未配置充能时间则不生效（validate 黄警）</div>
                  {art.charge && (
                    <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 mt-0.5">
                      {pixelField('充能x', art.charge.offset[0], n => patch(a => { if (a.charge) a.charge.offset[0] = n ?? 0 }), '0', '充能动画中心 X（相对轴心，px）')}
                      {pixelField('充能y', art.charge.offset[1], n => patch(a => { if (a.charge) a.charge.offset[1] = n ?? 0 }), '0', '充能动画中心 Y（沿炮口方向，px）')}
                      {numField('充能帧数', art.charge.frames, 1, n => patch(a => { if (a.charge) a.charge.frames = Math.max(1, Math.min(12, Math.round(n ?? 4))) }), '1-12', '充能动画帧数（1-12）：charge.png 均分，每帧时长=充能时间/帧数')}
                      {(() => { // v1.75：充能素材选择（charge 分类库引用；'none'=不播放；缺省=文件夹 charge.png 回退）
                        const { groups, mismatch } = assetSelectGroups('charge', art.charge?.asset)
                        return (
                          <label className="flex items-center gap-1 min-w-0 col-span-2">
                            <TipLabel text="素材" tip="充能动画帧条素材（充能分类）；可选「无」不播放；缺省 = 文件夹 charge.png 回退" className="text-[9px] font-bold text-black/60 shrink-0 w-9" />
                            <span className="flex-1 min-w-0">
                              <select
                                className="w-full min-w-0 px-0.5 py-0 text-[9px] font-comic border-2 border-black bg-[#EFEBD8]"
                                value={art.charge?.asset ?? ''}
                                onChange={e => patch(a => {
                                  if (!a.charge) return
                                  if (e.target.value) a.charge.asset = e.target.value
                                  else delete a.charge.asset
                                })}
                              >
                                <option value="">默认（文件夹 charge.png）</option>
                                <option value="none">无（不播放）</option>
                                {groups.map(([g, items]) => items.length > 0 && (
                                  <optgroup key={g} label={g}>
                                    {items.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                                  </optgroup>
                                ))}
                              </select>
                              {mismatch && (
                                <div className="text-[8px] font-bold text-[#B98A1D]">引用条目「{mismatch.name}」分类为{ASSET_CATEGORY_NAME[mismatch.category]}，与充能不符</div>
                              )}
                            </span>
                          </label>
                        )
                      })()}
                    </div>
                  )}
                </div>
                )}
                <label className="flex items-center gap-1">
                  <span className="text-[9px] font-bold text-black/60 shrink-0 w-9">辉光仅过热</span>
                  <input
                    type="checkbox"
                    className="w-3.5 h-3.5 accent-[#B3392E]"
                    checked={art.glow?.overheatOnly ?? true}
                    onChange={e => patch(a => { a.glow = { ...a.glow, overheatOnly: e.target.checked } })}
                  />
                </label>
              </div>
              <button
                className="mt-1 text-[9px] text-[#B3392E] underline"
                onClick={() => onApply(null)}
              >删除美术配置（不绘制）</button>
            </>
          )}
          {v.errors.map((e, i) => <div key={i} className="text-[9px] text-[#B3392E]">✕ {e}</div>)}
          {v.warnings.map((w, i) => <div key={i} className="text-[9px] text-[#B98A1D]">⚠ {w}</div>)}
        </div>
      )}
    </div>
  )
}

function setPath(obj: unknown, path: string, value: unknown) {
  const keys = path.split('.')
  let cur = obj as Record<string, unknown>
  for (const key of keys.slice(0, -1)) cur = cur[key] as Record<string, unknown>
  cur[keys[keys.length - 1]] = value
}

/** 数值输入：本地文本态编辑——允许删空最后一位、支持 "0.5" 中间态输入；
 *  clearable（始终显示的字段）删空即提交 undefined=未配置；其余字段删空仅停留在本地，失焦或输入新值后回落/提交 */
/** v2.0 堡垒编辑器数字输入：type=text + inputMode=decimal（type=number 会把 "-" 净化成空串，受控回写即清掉负号）。
 *  聚焦期展示本地编辑文本（允许 "-"/"1." 等中间态），可解析为数值时实时提交，失焦回落外部值（含钳制结果）。
 *  必须定义在模块级——若在渲染函数内定义，每次渲染组件标识变更会重挂载丢态。 */
const FORTRESS_PARAM_TIPS: Record<string, string> = {
  '耐久': '单位结构生命值；受到穿透装甲或护盾后的伤害时扣除。无预设上限，必须大于 0。',
  '击毁奖励': '该载具作为敌对单位被摧毁时发放的基础资源；最终奖励仍会乘全局击杀收益倍率。',
  '视野': '单位可主动发现敌对目标的半径，单位为米；同组且非敌对的关卡单位会共享可见目标。',
  '追踪视野': '单位接战后继续追踪当前目标的最大距离，单位为米；目标离开后结束战斗并恢复关卡行为。不得小于索敌视野。',
  '重量级别': '决定载具碾压伤害倍率：轻型 0.8 倍、中型 1 倍、重型 1.3 倍。未配置的旧载具按实际形状占格数自动推导。',
  '前装甲': '车头方向的装甲值，用于抵挡或削减来自前方的伤害。范围 0～10000。',
  '后装甲': '车尾方向的装甲值，用于抵挡或削减来自后方的伤害。范围 0～10000。',
  '左装甲': '车体左侧装甲值。范围 0～10000。',
  '右装甲': '车体右侧装甲值。范围 0～10000。',
  '移动速度': '单位前进最高速度，单位为米/秒；无预设上限，0 表示不能主动移动。',
  '加速度': '单位每秒增加的移动速度，单位为米/秒²；决定起步和提速快慢。必须大于 0。',
  '初始飞行高度': '单位生成与巡航时的默认高度，单位为米；必须位于最低与最高飞行高度之间。',
  '最低飞行高度': '事件或 AI 可要求单位下降到的最低高度，单位为米。',
  '最高飞行高度': '事件或 AI 可要求单位上升到的最高高度，单位为米。',
  '升降速度': '飞行器垂直改变高度的速度，单位为米/秒。',
  '最低航速': '固定翼维持飞行所需的最低前进速度，不能超过最大移动速度。',
  '最小转弯半径': '固定翼盘旋和改变航向时允许的最小轨迹半径。',
  '刹停惯性': '松开移动后的减速特征：1 为急停，5 约等于加速度，10 为长距离滑行。范围 1～10。',
  '滑行阻力': '气垫载具松开动力后的速度衰减率。数值越小滑行越远，数值越大越快停下。范围 0.05～5/秒。',
  '横向稳定': '气垫载具抑制侧滑的速度。数值越小甩尾越明显，数值越大越快对齐车头方向。范围 0～10/秒。',
  '步幅': '步行机甲单脚完成一组 7 帧动作时前进的距离；动画按照单位实际移动距离推进。范围 0.16～64 米。',
  '车身俯仰': '加减速和转弯造成的车体视觉倾斜强度；0 关闭效果。范围 0～10。',
  '俯仰位移': '车体视觉倾斜的目标位移上限，单位像素。范围 1～8。',
  '倒退系数': '倒退最高速度和加速度相对前进的倍率。范围 0～1。',
  '转向速度': '单位每秒可改变的最大朝向角度。范围 15～240°/秒。',
  '飞行转向速度': '飞行器在平面内每秒可改变的最大朝向角度。范围大于 0 且不超过 1080°/秒。',
  '转向半径': '大于 0 时按指定半径沿弧线转弯；0 时使用所选底盘自身的转向物理。范围 0～64 米。',
  '履带间距': '左右履带中心之间的距离，用于差速转向计算。范围大于 0 且不超过 64 米。',
  '转向阻力': '履带转向时对前进速度的削减比例。范围 0～0.9。',
  '轴距': '轮式车辆前后轮轴之间的距离，影响实际转弯半径。范围大于 0 且不超过 96 米。',
  '前轮转角°': '方向盘打满时前轮允许达到的最大偏转角。范围大于 0 且不超过 80°。',
  '方向盘°/s': '前轮偏转角每秒变化速度。范围大于 0 且不超过 720°/秒。',
  '附着m/s²': '轮式车辆横向附着上限；速度越高，超过此上限时转向能力越受压缩。范围大于 0 且不超过 100 m/s²。',
  '热量上限': '全车共享热量池容量；达到上限后炮塔过热停火。必须大于 0。',
  '自然散热': '不依赖模块的基础散热速度，单位为热量/秒。必须大于等于 0。',
  '列数': '虚拟内部空间的横向格数，与载具外形和碰撞轮廓相互独立。范围 1～30 的整数。',
  '行数': '虚拟内部空间的纵向格数，与载具外形和碰撞轮廓相互独立。范围 1～30 的整数。',
  '前轮x': '履带前端轮心的 X 坐标，单位为像素；单位几何中心为 0，向右为正。', '前轮y': '履带前端轮心的 Y 坐标，单位为像素；单位几何中心为 0，向车头为正。',
  '后轮x': '履带后端轮心的 X 坐标，单位为像素；单位几何中心为 0，向右为正。', '后轮y': '履带后端轮心的 Y 坐标，单位为像素；单位几何中心为 0，向车头为正。',
  '轮心x': '轮胎中心的 X 坐标，单位为像素；单位几何中心为 0，向右为正。', '轮心y': '轮胎中心的 Y 坐标，单位为像素；单位几何中心为 0，向车头为正。',
  '轮半径': '履带端部参考轮半径，单位为米；决定履带翻滚区曲率。必须大于 0。',
  '重叠px': '相邻履带瓦片的像素重叠量，用于消除接缝。范围 0～贴图高度减 1。',
  '帧数': '轮胎素材横向排列的等宽动画帧数量；1 表示普通单图。范围 1～64 的整数。',
  '层级': '炮位绘制层级；数值越大越靠上。层级小于等于 -1 时，炮塔绘制在载具素材下方并会被载具主体覆盖。',
  '起°': '炮位可旋转视界的起始角。范围 -180～180°。',
  '止°': '炮位可旋转视界的结束角。范围 -180～180°。',
  '角°': '固定炮位朝向；0°朝车头，负值逆时针、正值顺时针。范围 -180～180°。',
  'x': '所选元素在单位局部坐标中的横向位置，单位为像素。', 'y': '所选元素在单位局部坐标中的纵向位置，单位为像素。',
  '尺寸': '徽记的显示尺寸，单位为米；必须大于 0。', '角度': '徽记相对车体的旋转角度，单位为度。',
}

const roundMetric = (value: number) => Math.round(value * 10000) / 10000
const cellsToMeters = (cells: number) => roundMetric(cells * M_PER_CELL)
const metersToCells = (meters: number) => roundMetric(meters / M_PER_CELL)
const cellsToPixels = (cells: number) => roundMetric(cells * BASE_CELL)
const pixelsToCells = (pixels: number) => roundMetric(pixels / BASE_CELL)

const FORTRESS_METRIC_PARAMS: Record<string, string> = {
  '视野': '视野(m)',
  '追踪视野': '追踪视野(m)',
  '移动速度': '移动速度(m/s)',
  '加速度': '加速度(m/s²)',
  '初始飞行高度': '初始飞行高度(m)',
  '最低飞行高度': '最低飞行高度(m)',
  '最高飞行高度': '最高飞行高度(m)',
  '升降速度': '升降速度(m/s)',
  '最低航速': '最低航速(m/s)',
  '最小转弯半径': '最小转弯半径(m)',
  '转向半径': '转向半径(m)',
  '履带间距': '履带间距(m)',
  '轴距': '轴距(m)',
  '轮半径': '轮半径(m)',
  '尺寸': '尺寸(m)',
}

const FORTRESS_PIXEL_COORD_PARAMS: Record<string, string> = {
  '前轮x': '前轮x(px)', '前轮y': '前轮y(px)',
  '后轮x': '后轮x(px)', '后轮y': '后轮y(px)',
  '轮心x': '轮心x(px)', '轮心y': '轮心y(px)',
  'x': 'x(px)', 'y': 'y(px)',
}

const FORTRESS_PARAM_BOUNDS: Record<string, { min?: number; max?: number; integer?: boolean }> = {
  '前装甲': { min: 0, max: 10000 }, '后装甲': { min: 0, max: 10000 }, '左装甲': { min: 0, max: 10000 }, '右装甲': { min: 0, max: 10000 },
  '耐久': { min: 1 }, '视野': { min: 0, max: 200 }, '追踪视野': { min: 0, max: 300 }, '移动速度': { min: 0 }, '加速度': { min: 0.01 }, '转向速度': { min: 15, max: 240 },
  '初始飞行高度': { min: 0, max: 10 }, '最低飞行高度': { min: 0, max: 10 }, '最高飞行高度': { min: 0, max: 10 },
  '升降速度': { min: 0.01, max: 10 }, '最低航速': { min: 0.01 }, '最小转弯半径': { min: 0.01, max: 100 },
  '飞行转向速度': { min: 0.1, max: 1080 },
  '转向半径': { min: 0, max: 20 }, '倒退系数': { min: 0, max: 1 }, '刹停惯性': { min: 1, max: 10 },
  '滑行阻力': { min: 0.05, max: 5 }, '横向稳定': { min: 0, max: 10 },
  '车身俯仰': { min: 0, max: 10 }, '俯仰位移': { min: 1, max: 8 }, '步幅': { min: 0.16, max: 64 }, '履带间距': { min: 0.01, max: 20 },
  '转向阻力': { min: 0, max: 0.9 }, '轴距': { min: 0.01, max: 30 }, '前轮转角°': { min: 0.01, max: 80 },
  '方向盘°/s': { min: 0.01, max: 720 }, '附着m/s²': { min: 0.01, max: 100 }, '热量上限': { min: 0.01 },
  '自然散热': { min: 0 }, '列数': { min: 1, max: 30, integer: true }, '行数': { min: 1, max: 30, integer: true },
  '轮半径': { min: 0.01 }, '重叠px': { min: 0 }, '帧数': { min: 1, max: 64, integer: true },
  '起°': { min: -180, max: 180 }, '止°': { min: -180, max: 180 }, '角°': { min: -180, max: 180 },
}

function FortNumInput({ label, value, set, step, compact = false }: { label: string; value: number; set: (v: number) => void; step: number; steppers?: boolean; compact?: boolean }) {
  const bounds = FORTRESS_PARAM_BOUNDS[label] ?? {}
  const metricLabel = FORTRESS_METRIC_PARAMS[label]
  const pixelLabel = FORTRESS_PIXEL_COORD_PARAMS[label]
  const displayLabel = pixelLabel ?? metricLabel ?? label
  const displayValue = pixelLabel ? cellsToPixels(value) : metricLabel ? cellsToMeters(value) : value
  const displayStep = pixelLabel ? 1 : metricLabel ? cellsToMeters(step) : step
  const displayMin = bounds.min === undefined ? undefined : pixelLabel ? cellsToPixels(bounds.min) : metricLabel ? cellsToMeters(bounds.min) : bounds.min
  const displayMax = bounds.max === undefined ? undefined : pixelLabel ? cellsToPixels(bounds.max) : metricLabel ? cellsToMeters(bounds.max) : bounds.max
  return (
    <label className="flex items-center gap-1 text-[10px] font-comic">
      <TipLabel text={displayLabel} tip={FORTRESS_PARAM_TIPS[label] ?? `${label}参数。`} className="text-black/70 shrink-0" />
      <ValidatedNumberInput
        aria-label={displayLabel}
        step={displayStep}
        min={displayMin}
        max={displayMax}
        integer={pixelLabel || metricLabel ? false : bounds.integer}
        value={displayValue}
        onValueCommit={next => set(pixelLabel ? pixelsToCells(next) : metricLabel ? metersToCells(next) : next)}
        className={`h-5 ${compact ? 'w-12' : 'w-16'} px-1 py-0 text-[10px] border-2 border-black bg-[#EFEBD8]`}
      />
    </label>
  )
}

function FieldNumInput({ v, step, clearable, disabled, onCommit, ph }: {
  v: unknown
  step?: number
  clearable?: boolean
  disabled?: boolean
  onCommit: (n: number | undefined) => void
  ph?: string // 未配置时的占位提示（如模板/解析默认值）
}) {
  const num = typeof v === 'number' ? v : (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v)) ? Number(v) : undefined) // v2.20：兼容 f.get 派生字段返回的数值字符串（集束分裂等嵌套字段）
  return (
    <ValidatedNumberInput
      className="h-6 w-full min-w-0 px-1 text-[11px] font-comic border-2 border-black bg-[#EFEBD8]"
      step={step ?? 1}
      disabled={disabled}
      value={num ?? ''}
      allowEmpty={clearable}
      onEmptyCommit={() => onCommit(undefined)}
      onValueCommit={onCommit}
      placeholder={num === undefined ? (ph ?? '未配置') : undefined}
    />
  )
}

let customSeq = TURRET_DEFS.reduce((m, d) => { // 初始化扫描现有自定义 id 取最大序号+1（持久化恢复后新建不冲突）
  const mm = /^custom-\d+-(\d+)$/.exec(d.id)
  return mm ? Math.max(m, Number(mm[1]) + 1) : m
}, 1)

export default function DebugPanel({
  onClose,
  onDeleteDef,
  onRestart,
  onEnterSceneEdit,
  onExitSceneEdit,
  onSaveSceneEdit,
  sceneEditDirty,
}: {
  onClose: () => void
  onDeleteDef: (defId: string) => void
  /** 关卡编辑器「应用并重开/恢复默认」：重置本局游戏 */
  onRestart: () => void
  /** 打开关卡编辑工作区（地图上直接笔刷铺设） */
  onEnterSceneEdit: () => void
  /** 离开关卡编辑页签时放弃草稿并恢复试玩关卡 */
  onExitSceneEdit: () => void
  onSaveSceneEdit: () => void
  sceneEditDirty: boolean
}) {
  const [, setRev] = useState(0)
  type DebugTab = 'turret' | 'ammo' | 'assets' | 'editor' | 'fortress' | 'module' | 'game'
  const [tab, setTab] = useState<DebugTab>('turret')
  const [pendingEditorExit, setPendingEditorExit] = useState<{ target: DebugTab | null } | null>(null)
  const finishEditorExit = (target: DebugTab | null) => {
    onExitSceneEdit()
    setPendingEditorExit(null)
    if (target === null) onClose(); else setTab(target)
  }
  const requestEditorExit = (target: DebugTab | null) => {
    if (sceneEditDirty) { setPendingEditorExit({ target }); return }
    finishEditorExit(target)
  }
  const [selectedId, setSelectedId] = useState<string | null>(TURRET_DEFS[0]?.id ?? null) // 炮塔页签单选（左列表右参数窗）
  const [newType, setNewType] = useState<WeaponType>('direct')
  const [newName, setNewName] = useState('')
  const bump = () => { setRev(r => r + 1); saveAll() } // 所有编辑经 bump：即时持久化
  const patchTurret = (id: string, change: (next: TurretDef) => void) => {
    const index = TURRET_DEFS.findIndex(definition => definition.id === id)
    if (index < 0) return
    const next = structuredClone(TURRET_DEFS[index])
    change(next)
    TURRET_DEFS.splice(index, 1, next)
    bump()
  }
  // 配置口令导出/导入（跨设备搬运，方案A）
  const [exportText, setExportText] = useState<string | null>(null)
  const [copyMsg, setCopyMsg] = useState('')
  const [importOpen, setImportOpen] = useState(false)
  const [importText, setImportText] = useState('')
  const [importMsg, setImportMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const resetAll = () => { // 内置+自定义全清回出厂（TURRET_DEFS/PROJECTILE_ARTS），并清除持久化 key
    resetPersistedToDefaults()
    bump()
  }

  const createTurret = () => {
    const base = TURRET_DEFS.find(d => d.id === ARCHETYPE[newType])
    if (!base) return
    const def = structuredClone(base) as TurretDef
    def.id = `custom-${Date.now()}-${customSeq++}`
    def.name = newName.trim() || `自定义${TYPE_NAME[newType]}塔${customSeq - 1}`
    def.desc = `自定义 · ${TYPE_NAME[newType]}`
    def.color = TYPE_COLOR[newType]
    TURRET_DEFS.push(def)
    setNewName('')
    setSelectedId(def.id) // 新建后自动选中
    bump()
  }

  const deleteTurret = (def: TurretDef) => {
    const i = TURRET_DEFS.findIndex(d => d.id === def.id)
    if (i >= 0) TURRET_DEFS.splice(i, 1)
    onDeleteDef(def.id) // 同步移除场上已放置的该型炮塔，避免引擎查不到定义
    if (selectedId === def.id) setSelectedId(TURRET_DEFS[Math.min(i, TURRET_DEFS.length - 1)]?.id ?? null) // 选中邻近项
    bump()
  }

  const selDef = TURRET_DEFS.find(d => d.id === selectedId) ?? null // 右参数窗当前条目

  return (
    <div className={`absolute inset-0 z-40 flex items-stretch ${tab === 'editor' ? 'pointer-events-none bg-transparent' : 'bg-[#D8D2B8]'}`}>
      <div className={`w-full flex flex-col ${tab === 'editor' ? 'pointer-events-none bg-transparent' : 'bg-[#D8D2B8] border-l-4 border-black'}`}>
        <div className="pointer-events-auto flex items-center gap-2 px-2 py-1.5 border-b-2 border-black bg-[#C9C29F]">
          <Bug className="w-4 h-4" />
          <span className="font-comic text-sm font-black">DEBUG</span>
          <button
            className="ml-auto comic-btn px-1.5 py-0.5 text-[10px]"
            onClick={() => { setExportText(exportConfig()); setCopyMsg('') }} // 实时取当前注册表生成
            title="导出全部配置为口令串（炮塔/弹丸/关卡/素材/堡垒，跨设备搬运）"
          >导出</button>
          <button
            className="comic-btn px-1.5 py-0.5 text-[10px]"
            onClick={() => { setImportOpen(true); setImportText(''); setImportMsg(null) }}
            title="粘贴口令串恢复配置（含堡垒类型库）"
          >导入</button>
          <button
            className="comic-btn px-1.5 py-0.5 text-[10px] flex items-center gap-1"
            onClick={resetAll}
            title="恢复内置炮塔默认值"
          >
            <RotateCcw className="w-3 h-3" /> 重置
          </button>
          <button className="comic-btn px-1.5 py-0.5" onClick={() => { if (tab === 'editor') requestEditorExit(null); else onClose() }} title="关闭">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* 分页栏 */}
        <div className="pointer-events-auto flex border-b-2 border-black bg-[#C9C29F]">
          {([['turret', '炮塔'], ['ammo', '弹丸库'], ['assets', '素材库'], ['editor', '关卡编辑器'], ['fortress', '单位编辑器'], ['module', '模块'], ['game', '游戏参数']] as const).map(([k, label]) => (
            <button
              key={k}
              className={`flex-1 px-1 py-1 text-[11px] font-comic font-black border-r border-black/40 last:border-r-0 ${
                tab === k ? 'bg-[#B3392E] text-[#EFEBD8]' : 'hover:bg-black/10'
              }`}
              onClick={() => {
                if (k === 'editor') {
                  if (tab !== 'editor') onEnterSceneEdit()
                  setTab('editor')
                  return
                }
                if (tab === 'editor') { requestEditorExit(k); return }
                setTab(k)
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'turret' && (<>
        {/* 新建自定义炮塔 */}
        <div className="px-2 py-1.5 border-b-2 border-black bg-[#D2CCA9]">
          <div className="text-[10px] font-black text-black/70 mb-1">新建自定义炮塔</div>
          <div className="flex items-center gap-1">
            <select
              className="px-1 py-0.5 text-[11px] font-comic border-2 border-black bg-[#EFEBD8]"
              value={newType}
              onChange={e => setNewType(e.target.value as WeaponType)}
            >
              {(Object.keys(TYPE_NAME) as WeaponType[]).map(t => (
                <option key={t} value={t}>{TYPE_NAME[t]}</option>
              ))}
            </select>
            <input
              className="flex-1 min-w-0 px-1 py-0.5 text-[11px] font-comic border-2 border-black bg-[#EFEBD8]"
              placeholder="名称（可留空）"
              value={newName}
              onChange={e => setNewName(e.target.value)}
            />
            <button
              className="comic-btn px-1.5 py-0.5 text-[10px] flex items-center gap-0.5 shrink-0"
              onClick={createTurret}
            >
              <Plus className="w-3 h-3" /> 创建
            </button>
          </div>
          <div className="text-[9px] font-bold text-black/50 mt-0.5">
            创建后出现在底部卡片栏，备战阶段即可放置试玩；参数在下方继续编辑
          </div>
        </div>

        <div className="px-2 py-1 text-[10px] font-bold text-black/60 border-b border-black/30">
          修改即时生效（对新旧炮塔均生效）
        </div>
        <div className="flex-1 min-h-0 flex">
          {/* 左：内容列表（单选切换） */}
          <div className="w-[96px] shrink-0 overflow-y-auto border-r border-black/30">
            {TURRET_DEFS.map(def => {
              const sel = selectedId === def.id
              const custom = !BUILTIN_IDS.has(def.id)
              return (
                <button
                  key={def.id}
                  className={`w-full flex items-center gap-1.5 px-1.5 py-1.5 text-left border-b border-black/20 ${sel ? 'bg-[#C9C29F] border-l-4 border-l-[#B3392E]' : 'hover:bg-black/5'}`}
                  onClick={() => setSelectedId(def.id)}
                >
                  <span className="w-3 h-3 border border-black shrink-0" style={{ backgroundColor: def.color }} />
                  <span className="min-w-0 flex-1">
                    <span className="block font-comic text-[11px] font-black truncate">{def.name}</span>
                    <span className="block text-[8px] text-black/45 truncate">{TYPE_NAME[def.type]} · {def.mount} 型</span>
                  </span>
                  {custom && (
                    <span className="text-[8px] font-black px-0.5 border border-black bg-[#B3392E] text-[#EFEBD8] shrink-0">自定义</span>
                  )}
                </button>
              )
            })}
          </div>
          {/* 右：参数窗口（当前选中条目完整表单） */}
          <div className="flex-1 min-w-0 overflow-y-auto">
            {selDef ? (() => {
              const def = selDef
              const custom = !BUILTIN_IDS.has(def.id)
              const fields = FIELDS.filter(f => !PROJECTILE_OWNED_TURRET_FIELDS.has(f.path) && (f.showIf ? f.showIf(def) : getPath(def, f.path) !== undefined))
              const iconAssets = assetSelectGroups('icon', def.iconAsset)
              return (
                <div className="px-2 pb-2 pt-1">

                    {custom && (
                      <div className="flex justify-end mb-1">
                        <button
                          className="comic-btn px-1.5 py-0.5 text-[10px] flex items-center gap-0.5 shrink-0"
                          onClick={() => deleteTurret(def)}
                          title="删除该自定义炮塔（场上已放置的会一并移除）"
                        >
                          <Trash2 className="w-3 h-3" /> 删除
                        </button>
                      </div>
                    )}
                    {/* v1.57 横版布局：美术板块配置置于炮塔参数板块右侧（竖版保持上下堆叠） */}
                    <div className="flex items-start gap-3 portrait:flex-col">
                      <div className="flex-1 min-w-0">
                        <div className="text-[10px] font-black text-black/70 mb-0.5">炮塔参数</div>
                        <div className="grid grid-cols-2 gap-x-2 gap-y-1">
                      <label className="flex items-center gap-1 min-w-0">
                        <TipLabel text="炮塔名称" tip="炮塔在编辑器、整备界面及战斗信息中的显示名称。" className="text-[10px] font-bold text-black/70 shrink-0" />
                        <input
                          aria-label="炮塔名称"
                          className="h-6 w-full min-w-0 px-1 text-[11px] font-comic border-2 border-black bg-[#EFEBD8]"
                          value={def.name}
                          onChange={event => patchTurret(def.id, next => { next.name = event.target.value })}
                        />
                      </label>
                      <label className="flex items-center gap-1 min-w-0">
                        <TipLabel text="炮塔图标" tip="炮塔在战斗 HUD 和整备界面中使用的图标；选项只读取素材库的“图标”分类。" className="text-[10px] font-bold text-black/70 shrink-0" />
                        <select
                          aria-label="炮塔图标"
                          className="h-6 w-full min-w-0 px-1 text-[11px] font-comic border-2 border-black bg-[#EFEBD8]"
                          value={def.iconAsset ?? ''}
                          onChange={event => patchTurret(def.id, next => {
                            if (event.target.value) next.iconAsset = event.target.value
                            else delete next.iconAsset
                          })}
                        >
                          <option value="">未配置</option>
                          {iconAssets.mismatch ? <option value={iconAssets.mismatch.id}>分类不符：{iconAssets.mismatch.name}</option> : null}
                          {iconAssets.groups.map(([group, items]) => items.length > 0 ? <optgroup key={group} label={group}>{items.map(asset => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</optgroup> : null)}
                        </select>
                      </label>
                      <label className="flex items-center gap-1 min-w-0">
                        <TipLabel text="炮塔类型" tip="决定炮塔使用直射、抛射、导弹、射线或喷射的攻击逻辑，并控制下方显示的专用参数。" className="text-[10px] font-bold text-black/70 shrink-0" />
                        <select
                          aria-label="炮塔类型"
                          className="h-6 w-full min-w-0 px-1 text-[11px] font-comic border-2 border-black bg-[#EFEBD8]"
                          value={def.type}
                          onChange={event => patchTurret(def.id, next => {
                            next.type = event.target.value as WeaponType
                          })}
                        >
                          {(Object.keys(TYPE_NAME) as WeaponType[]).map(type => <option key={type} value={type}>{TYPE_NAME[type]}</option>)}
                        </select>
                      </label>
                      <label className="flex items-center gap-1 min-w-0">
                        <TipLabel text="尺寸" tip="炮塔槽位尺寸：S/M/L；只能挂载到相同尺寸的炮位。尺寸只决定挂载兼容性，不代表炮塔占格。" className="text-[10px] font-bold text-black/70 shrink-0" />
                        <select
                          aria-label="炮塔尺寸"
                          className="h-6 w-full min-w-0 px-1 text-[11px] font-comic border-2 border-black bg-[#EFEBD8]"
                          value={def.mount}
                          onChange={event => patchTurret(def.id, next => { next.mount = event.target.value as MountSize })}
                        >
                          {(['S', 'M', 'L'] as const).map(model => <option key={model} value={model}>{model} 型</option>)}
                        </select>
                      </label>
                      <label className="flex items-center gap-1 min-w-0">
                        <TipLabel
                          text={def.type === 'beam' ? '光束弹丸' : '弹丸'}
                          tip={def.type === 'beam'
                            ? '射线弹丸条目同时决定光束分层、命中闪光和粒子效果；不选时使用默认光束搭配'
                            : '选择该炮塔实际使用的弹丸条目；弹体、尾迹、命中与爆炸表现由弹丸库定义，喷射类型可选择喷射载荷'}
                          className="text-[10px] font-bold text-black/70 shrink-0"
                        />
                        <select
                          aria-label="炮塔弹丸"
                          className="h-6 w-full min-w-0 px-1 text-[11px] font-comic border-2 border-black bg-[#EFEBD8]"
                          value={def.art?.projectile ?? ''}
                          onChange={event => {
                            const projectile = event.target.value
                            if (!projectile && !def.art) return
                            const next = structuredClone(def.art ?? DEFAULT_ART())
                            if (projectile) next.projectile = projectile
                            else delete next.projectile
                            patchTurret(def.id, definition => { definition.art = next })
                          }}
                        >
                          <option value="">无（几何回退）</option>
                          {(['bullet', 'shell', 'missile', 'ray', 'spray'] as const).map(kind => (
                            <optgroup key={kind} label={PROJECTILE_KIND_NAME[kind]}>
                              {PROJECTILE_ARTS.filter(projectile => projectile.kind === kind).map(projectile => (
                                <option key={projectile.id} value={projectile.id}>{projectile.name}（{projectile.id}）</option>
                              ))}
                            </optgroup>
                          ))}
                        </select>
                      </label>
                      {fields.map(f => {
                        const v = f.get ? f.get(def) : getPath(def, f.path)
                        return (
                          <label key={f.path} className="flex items-center gap-1 min-w-0">
                            <TipLabel text={f.label} tip={f.tip} className="text-[10px] font-bold text-black/70 shrink-0" />
                            {f.type === 'boolean' ? (
                              <input
                                type="checkbox"
                                className="w-3.5 h-3.5 accent-[#B3392E]"
                                checked={Boolean(v)}
                                onChange={e => {
                                  setPath(def, f.path, e.target.checked)
                                  bump()
                                }}
                              />
                            ) : f.type === 'select' ? (
                              <select
                                className="h-6 w-full min-w-0 px-1 text-[11px] font-comic border-2 border-black bg-[#EFEBD8]"
                                value={String(v ?? f.defaultValue ?? f.options?.[0]?.value ?? '')}
                                onChange={e => {
                                  if (f.set) f.set(def, e.target.value)
                                  else setPath(def, f.path, e.target.value)
                                  bump()
                                }}
                              >
                                {(f.options ?? []).map(o => (
                                  <option key={o.value} value={o.value}>{o.label}</option>
                                ))}
                              </select>
                            ) : (
                              <FieldNumInput
                                v={v}
                                step={f.step}
                                clearable={Boolean(f.showIf)} // 始终显示的字段：删空 = 未配置；其余字段删空停留本地、失焦回落
                                onCommit={n => { if (f.set) f.set(def, n === undefined ? '' : String(n)); else setPath(def, f.path, n); bump() }} // v2.20：派生/复合数值字段（get/set）绕过 setPath
                              />
                            )}
                          </label>
                        )
                      })}
                        </div>
                        <TurretSoundPanel def={def} bump={bump} />
                        <TagEditor def={def} onChange={tags => patchTurret(def.id, next => { next.tags = tags })} />{/* v2.49 索敌标签（常驻显示） */}
                      </div>
                      <div className="w-[380px] max-w-[46%] shrink-0 portrait:w-full portrait:max-w-none">
                        <HeatPreview def={def} />
                        <ArtEditor
                          def={def}
                          onApply={art => patchTurret(def.id, next => { if (art) next.art = art; else delete next.art })}
                        />
                      </div>
                    </div>
                </div>
              )
            })() : (
              <div className="p-6 text-center text-[11px] font-bold text-black/40">← 选择一座炮塔</div>
            )}
          </div>
        </div>
        </>)}

        {tab === 'ammo' && (<AmmoTab bump={bump} />)}
        {tab === 'assets' && (<AssetsTab bump={bump} />)}
        {tab === 'game' && (<GameSettingsTab />)}
        {/* 关卡编辑内容由 GamePreview 的左侧列表与右侧画布承载；此处只保留固定 DEBUG 框架。 */}
        {tab === 'fortress' && (<UnitTab onRestart={onRestart} />)}
        {tab === 'module' && (<ModuleTab bump={bump} />)}
      </div>

      {/* 配置口令导出小窗 */}
      {exportText !== null && (
        <div className="pointer-events-auto absolute inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="comic-card bg-[#EFEBD8] p-3 w-full max-w-sm space-y-2">
            <div className="font-comic font-black text-sm">配置口令（粘贴到另一台设备导入）</div>
            <textarea
              readOnly
              className="w-full h-32 text-[9px] font-mono border-2 border-black bg-white p-1"
              value={exportText}
              onFocus={e => e.target.select()}
            />
            <div className="flex items-center gap-2">
              <button
                className="comic-btn px-2 py-0.5 text-[10px]"
                onClick={() => {
                  if (navigator.clipboard) {
                    navigator.clipboard.writeText(exportText)
                      .then(() => setCopyMsg('已复制 ✓'))
                      .catch(() => setCopyMsg('复制失败，请手动全选复制'))
                  } else setCopyMsg('请手动全选复制')
                }}
              >复制</button>
              {copyMsg && <span className="text-[10px] font-bold text-[#2E8B57]">{copyMsg}</span>}
              <button className="ml-auto comic-btn px-2 py-0.5 text-[10px]" onClick={() => setExportText(null)}>关闭</button>
            </div>
          </div>
        </div>
      )}

      {/* 配置口令导入小窗 */}
      {importOpen && (
        <div className="pointer-events-auto absolute inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="comic-card bg-[#EFEBD8] p-3 w-full max-w-sm space-y-2">
            <div className="font-comic font-black text-sm">导入配置口令</div>
            <textarea
              className="w-full h-32 text-[9px] font-mono border-2 border-black bg-white p-1"
              placeholder="粘贴口令串…"
              value={importText}
              onChange={e => setImportText(e.target.value)}
            />
            {importMsg && (
              <div className={`text-[10px] font-bold ${importMsg.ok ? 'text-[#2E8B57]' : 'text-[#B3392E]'}`}>
                {importMsg.text}
              </div>
            )}
            <div className="flex items-center gap-2">
              <button
                className="comic-btn px-2 py-0.5 text-[10px]"
                onClick={() => {
                  const r = applyConfig(importText)
                  if (r.ok) {
                    setImportMsg({ ok: true, text: '导入成功，正在重载…' })
                    setTimeout(() => window.location.reload(), 400) // 重载后全部状态从 localStorage 重建
                  } else setImportMsg({ ok: false, text: r.error })
                }}
              >应用</button>
              <button className="ml-auto comic-btn px-2 py-0.5 text-[10px]" onClick={() => setImportOpen(false)}>关闭</button>
            </div>
          </div>
        </div>
      )}

      {pendingEditorExit && (
        <div className="pointer-events-auto absolute inset-0 z-[90] bg-black/55 flex items-center justify-center p-4">
          <div role="dialog" aria-modal="true" aria-labelledby="level-unsaved-title" className="comic-panel w-[min(360px,92vw)] bg-[#EFEBD8] border-2 border-black p-4 shadow-[6px_6px_0_#1A1A18]">
            <div id="level-unsaved-title" className="font-comic font-black text-base">关卡尚未保存</div>
            <div className="mt-2 text-[11px] font-bold text-black/65">是否保存本次修改后再离开关卡编辑器？</div>
            <div className="mt-4 grid grid-cols-3 gap-2">
              <button type="button" className="comic-btn px-2 py-1 text-[10px] bg-[#D9A441]" onClick={() => { const target = pendingEditorExit.target; onSaveSceneEdit(); finishEditorExit(target) }}>保存并离开</button>
              <button type="button" className="comic-btn px-2 py-1 text-[10px]" onClick={() => finishEditorExit(pendingEditorExit.target)}>放弃更改</button>
              <button type="button" className="comic-btn px-2 py-1 text-[10px]" onClick={() => setPendingEditorExit(null)}>取消</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ================= 素材库 Tab =================
const ASSET_CATS = Object.keys(ASSET_CATEGORY_NAME) as AssetCategory[]

/** 参数标签：悬停（桌面）/长按 500ms（移动端）显示字段解释气泡；松手/离开后延迟隐藏；气泡不可点、靠右自动左偏防出屏 */
function TipLabel({ text, tip, className }: { text: string; tip?: string; className?: string }) {
  const [show, setShow] = useState(false)
  const [alignRight, setAlignRight] = useState(false)
  const rootRef = useRef<HTMLSpanElement>(null)
  const pressTimer = useRef<number | null>(null)
  const hideTimer = useRef<number | null>(null)
  if (!tip) return <span className={className}>{text}</span>
  const clearPress = () => { if (pressTimer.current !== null) { clearTimeout(pressTimer.current); pressTimer.current = null } }
  const clearHide = () => { if (hideTimer.current !== null) { clearTimeout(hideTimer.current); hideTimer.current = null } }
  const open = () => {
    const r = rootRef.current?.getBoundingClientRect()
    setAlignRight(r !== undefined && r !== null && r.left > window.innerWidth / 2) // 靠右则左偏
    setShow(true)
  }
  const scheduleHide = (ms: number) => { clearHide(); hideTimer.current = window.setTimeout(() => setShow(false), ms) }
  return (
    <span
      ref={rootRef}
      className={`${className ?? ''} relative`}
      onMouseEnter={() => { clearHide(); open() }}
      onMouseLeave={() => { clearPress(); setShow(false) }}
      onTouchStart={() => { clearHide(); clearPress(); pressTimer.current = window.setTimeout(open, 500) }} // 长按 500ms
      onTouchEnd={() => { clearPress(); if (show) scheduleHide(1500) }} // 松手延迟 1.5s 隐藏
      onTouchCancel={() => { clearPress(); setShow(false) }}
      onTouchMove={clearPress} // 移动视为取消长按，不影响滚动
    >
      {text}
      {show && (
        <span
          className={`absolute bottom-full mb-1 z-50 pointer-events-none block w-max max-w-[180px] whitespace-normal text-left text-[10px] leading-snug font-normal text-[#F5E9C8] bg-[#2B2B26] border-2 border-black rounded px-1.5 py-1 shadow-[2px_2px_0_rgba(0,0,0,0.4)] ${alignRight ? 'right-0' : 'left-0'}`}
        >
          {tip}
        </span>
      )}
    </span>
  )
}

/** 选配下拉选项分组（内置/上传，严格按分类过滤，未分类不显示）+ 当前引用分类不符检测（仅黄色提示，不作选项） */
function assetSelectGroups(cat: AssetCategory, current: string | undefined): { groups: [string, AssetEntry[]][]; mismatch: AssetEntry | null } {
  const items = filterAssets(cat)
  const groups: [string, AssetEntry[]][] = [
    ['内置', items.filter(a => a.builtin)],
    ['上传', items.filter(a => !a.builtin)],
  ]
  const cur = current && current !== 'none' ? getAsset(current) : undefined
  const mismatch = cur && cur.category !== cat ? cur : null
  return { groups, mismatch }
}

function TurretSoundPanel({ def, bump }: { def: TurretDef; bump: () => void }) {
  const soundControl = 'h-6 w-auto max-w-full min-w-0 px-1 text-[11px] font-comic border-2 border-black bg-[#EFEBD8]'
  const fields: { key: keyof NonNullable<TurretDef['sounds']>; label: string }[] = [
    { key: 'fire', label: '开火' },
    ...(Math.max(1, Math.floor(def.burst ?? 1)) > 1 ? [{ key: 'burstLoop' as const, label: '连发循环' }] : []),
    { key: 'overheat', label: '过热' },
    ...(def.type === 'beam' ? [{ key: 'charge' as const, label: '充能' }, { key: 'continuous' as const, label: '持续' }] : []),
  ]
  return <section className="mt-1.5 border-t-2 border-black/15 pt-1">
    <div className="text-[10px] font-black text-black/70 mb-1">音效</div>
    <div className="grid grid-cols-2 gap-x-2 gap-y-1">
      {fields.map(field => <label key={field.key} title={field.key === 'burstLoop' ? '轮流连发与齐射连发的中间发/轮使用该音效；最后一发/轮及中断收尾仍使用开火音效。齐射每轮只播放一次。' : field.key === 'continuous' ? `充能阶段不播放；光束实际射出时先播放开火音效，${BEAM_CONTINUOUS_AUDIO_DELAY} 秒后接入持续循环音效；停火后随光束在 ${BEAM_FADE} 秒内收缩渐隐。` : undefined} className="flex items-center gap-1 min-w-0 text-[10px] font-bold text-black/70"><span className="w-12 shrink-0">{field.label}</span><SoundAssetSelect ariaLabel={`炮塔${field.label}音效`} channel="weapon" loop={field.key === 'continuous'} className={soundControl} value={def.sounds?.[field.key]} onChange={value => { def.sounds = { ...(def.sounds ?? {}), [field.key]: value }; bump() }} /></label>)}
    </div>
  </section>
}

function AudioSettingsEditor() {
  const [, setRevision] = useState(0)
  const refresh = () => setRevision(value => value + 1)
  const settings = audioManager.getSettings()
  const config = audioProjectConfig()
  const bgmAssets = filterAssets('bgm')
  const compactControl = 'h-6 w-auto max-w-full min-w-0 px-1 border-2 border-black bg-[#EFEBD8] text-[11px] font-comic'
  return <details className="shrink-0 border-2 border-black bg-[#D2CCA9]" open>
    <summary className="cursor-pointer px-2 py-1 text-[10px] font-black bg-[#C9C29F]">音频设置</summary>
    <div className="max-h-[42vh] overflow-y-auto border-t border-black p-1.5 space-y-2 text-[8px]">
      <section className="grid grid-cols-3 gap-1">
        {(['master', 'bgm', 'se'] as const).map(key => <label key={key} className="flex items-center gap-1 font-black"><span>{key === 'master' ? '主音量' : key.toUpperCase()}</span><input aria-label={`${key}音量`} type="range" min="0" max="1" step="0.05" value={settings[key]} onChange={event => { audioManager.setSettings({ [key]: Number(event.target.value) }); refresh() }} className="h-6 w-auto min-w-24 max-w-full" /><span className="w-7 text-right">{Math.round(settings[key] * 100)}%</span></label>)}
      </section>
      <section className="border border-black/30 p-1">
        <div className="font-black mb-1">全局唯一 BGM</div>
        <div className="grid grid-cols-3 gap-1">{(Object.keys(GLOBAL_BGM_LABELS) as GlobalBgmSlot[]).map(slot => <label key={slot} className="flex items-center gap-1"><span className="shrink-0">{GLOBAL_BGM_LABELS[slot]}</span><select aria-label={`${GLOBAL_BGM_LABELS[slot]}BGM`} className={compactControl} value={config.bgm[slot]} onChange={event => { patchGlobalBgm(slot, event.target.value); refresh() }}><option value="">无</option>{bgmAssets.map(asset => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</select></label>)}</div>
      </section>
      <section className="border border-black/30 p-1"><div className="font-black mb-1">全局通用音效</div><div className="grid grid-cols-3 gap-1">{(Object.keys(GLOBAL_CUE_LABELS) as GlobalCueSlot[]).map(slot => { const options = globalCueAutoOptions(slot); return <label key={slot} className="flex items-center gap-1"><span className="w-20 shrink-0 truncate" title={GLOBAL_CUE_LABELS[slot]}>{GLOBAL_CUE_LABELS[slot]}</span><SoundAssetSelect {...options} ariaLabel={`${GLOBAL_CUE_LABELS[slot]}声音`} className={compactControl} value={config.cues[slot]} onChange={value => { patchGlobalCue(slot, value ?? ''); refresh() }} /></label> })}</div></section>
    </div>
  </details>
}

function DisplaySettingsEditor() {
  const [config, setConfig] = useState(displayConfig)
  const control = 'h-6 w-24 max-w-full px-1 text-[11px] font-comic border-2 border-black bg-[#EFEBD8]'
  const selectControl = 'h-6 min-w-0 flex-1 px-1 text-[10px] font-comic border-2 border-black bg-[#EFEBD8] disabled:cursor-not-allowed disabled:opacity-45'
  const patchZoom = (key: 'defaultZoom' | 'minZoom' | 'maxZoom', percent: number) => {
    setConfig(patchDisplayConfig(key, percent / 100))
  }
  return <details className="shrink-0 border-2 border-black bg-[#D2CCA9]" open>
    <summary className="cursor-pointer px-2 py-1 text-[10px] font-black bg-[#C9C29F]">画面设置</summary>
    <div className="border-t border-black p-2 space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <label className="flex items-center gap-1 text-[10px] font-black"><span className="shrink-0">显示模式</span><select aria-label="主界面显示模式" className={selectControl} value={config.resolutionMode} onChange={event => setConfig(patchDisplayConfig('resolutionMode', event.target.value as 'adaptive' | 'fixed'))}><option value="adaptive">自适应</option><option value="fixed">固定参考分辨率</option></select></label>
        <label className="flex items-center gap-1 text-[10px] font-black"><span className="shrink-0">参考分辨率</span><select aria-label="主界面参考分辨率" disabled={config.resolutionMode !== 'fixed'} className={selectControl} value={config.referenceResolution} onChange={event => setConfig(patchDisplayConfig('referenceResolution', event.target.value as typeof config.referenceResolution))}>{DISPLAY_RESOLUTION_PRESETS.map(preset => <option key={preset.id} value={preset.id}>{preset.width}×{preset.height} · {preset.ratio} · {preset.group}</option>)}</select></label>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <label className="flex items-center gap-1 text-[10px] font-black"><span className="shrink-0">默认缩放</span><ValidatedNumberInput aria-label="主界面默认缩放比例" min={25} max={400} step={5} className={control} value={Math.round(config.defaultZoom * 100)} onChange={event => patchZoom('defaultZoom', Number(event.target.value))} /><span>%</span></label>
        <label className="flex items-center gap-1 text-[10px] font-black"><span className="shrink-0">最小缩放</span><ValidatedNumberInput aria-label="主界面最小缩放比例" min={25} max={400} step={5} className={control} value={Math.round(config.minZoom * 100)} onChange={event => patchZoom('minZoom', Number(event.target.value))} /><span>%</span></label>
        <label className="flex items-center gap-1 text-[10px] font-black"><span className="shrink-0">最大缩放</span><ValidatedNumberInput aria-label="主界面最大缩放比例" min={25} max={400} step={5} className={control} value={Math.round(config.maxZoom * 100)} onChange={event => patchZoom('maxZoom', Number(event.target.value))} /><span>%</span></label>
      </div>
      <div className="flex items-center gap-2 text-[9px] font-bold text-black/50"><span>自适应沿用当前全屏逻辑；固定模式会保持比例完整显示，空余区域为黑色。缩放允许 25%–400%。</span><button type="button" className="comic-btn ml-auto shrink-0 px-2 py-0.5 text-[9px]" onClick={() => setConfig(resetDisplayConfig())}>恢复默认</button></div>
    </div>
  </details>
}

const PERFORMANCE_MONITOR_ITEMS: { key: PerformanceMonitorItem; label: string; tip: string }[] = [
  { key: 'fps', label: 'FPS', tip: '显示当前、平均和最低帧率。' },
  { key: 'frameTime', label: '帧耗时', tip: '显示画面帧间隔的当前平均值和累计峰值。' },
  { key: 'drawTime', label: '绘制耗时', tip: '显示 Canvas 场景绘制的平均值和峰值。' },
  { key: 'tickTime', label: '逻辑耗时', tip: '显示战斗 Tick 的平均值和峰值。' },
  { key: 'engineBreakdown', label: '引擎分项', tip: '分别显示友方 AI、敌方 AI、碰撞、索敌与武器、弹丸和事件耗时。' },
  { key: 'sceneCounts', label: '场景规模', tip: '显示敌方、友方与在场弹丸数量。' },
  { key: 'spatialIndex', label: '空间索引', tip: '显示空间查询、候选对象和碰撞组合数量。' },
  { key: 'hitchCounts', label: '卡顿计数', tip: '累计超过 16.7ms、33.3ms 和 50ms 的画面帧。' },
  { key: 'history', label: '耗时曲线', tip: '显示最近 60 秒的平均帧耗时曲线。' },
  { key: 'bottleneck', label: '主要消耗', tip: '自动找出当前耗时最高的绘制或引擎分项。' },
]

function PerformanceSettingsEditor({ parameters, setParameters }: {
  parameters: ReturnType<typeof gameParameters>
  setParameters: (value: ReturnType<typeof gameParameters>) => void
}) {
  const monitor = parameters.performanceMonitor
  return <details className="shrink-0 border-2 border-black bg-[#D2CCA9]" open>
    <summary className="cursor-pointer px-2 py-1 text-[10px] font-black bg-[#C9C29F]">性能监控</summary>
    <div className="border-t border-black p-2">
      <label className="inline-flex items-center gap-2 text-[10px] font-black" title="控制战斗主界面是否显示并记录性能监控；关闭后不会刷新监控浮层。">
        <input type="checkbox" aria-label="主界面显示性能监控" checked={monitor.enabled} onChange={event => setParameters(setPerformanceMonitorEnabled(event.target.checked))} />
        主界面显示性能监控
      </label>
      <div className="mt-2 grid grid-cols-5 gap-x-4 gap-y-2 max-[760px]:grid-cols-3">
        {PERFORMANCE_MONITOR_ITEMS.map(item => <label key={item.key} className="inline-flex min-w-0 items-center gap-1.5 text-[9px] font-bold" title={item.tip}>
          <input type="checkbox" aria-label={`性能监控：${item.label}`} checked={monitor[item.key]} onChange={event => setParameters(setPerformanceMonitorItem(item.key, event.target.checked))} />
          <span className="truncate">{item.label}</span>
        </label>)}
      </div>
      <div className="mt-2 text-[9px] font-bold text-black/50">监控每约 500ms 汇总一次，曲线仅保留最近 60 秒；打开 DEBUG 暂停游戏时保留暂停前数据。</div>
    </div>
  </details>
}

function GameSettingsTab() {
  const [parameters, setParameters] = useState(gameParameters)
  return <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-2">
    <details className="shrink-0 border-2 border-black bg-[#D2CCA9]" open>
      <summary className="cursor-pointer px-2 py-1 text-[10px] font-black bg-[#C9C29F]">战斗参数</summary>
      <div className="border-t border-black p-2">
        <label className="inline-flex items-center gap-2 text-[10px] font-black" title="玩家当前控制战车的基础自然散热。散热模块会在此数值上额外叠加；修改热量上限不会自动改变本数值。">
          <span>自然散热值</span>
          <ValidatedNumberInput
            aria-label="自然散热值"
            min={0}
            max={1000}
            step={1}
            className="h-6 w-24 border-2 border-black bg-[#EFEBD8] px-1 text-[10px] font-black"
            value={parameters.naturalHeatDissipation}
            onValueCommit={value => setParameters(setNaturalHeatDissipation(value))}
          />
          <span>点/s</span>
        </label>
        <div className="mt-1 text-[9px] font-bold text-black/50">仅作为玩家战车的基础散热；散热模块继续额外叠加，热量上限和炮塔产热不会同比变化。</div>
        <div className="mt-2 border-t border-black/20 pt-2">
          <div className="text-[10px] font-black">单位摧毁残骸缩放</div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
            {([
              ['small', '小型'],
              ['medium', '中型'],
              ['large', '大型'],
              ['violent', '剧烈'],
            ] as const).map(([key, label]) => <label key={key} className="inline-flex items-center gap-1 text-[10px] font-black">
              <span>{label}</span>
              <ValidatedNumberInput
                aria-label={`${label}爆炸残骸缩放`}
                min={10}
                max={400}
                step={10}
                className="h-6 w-16 border-2 border-black bg-[#EFEBD8] px-1 text-[10px] font-black"
                value={parameters.unitDestructionWreckageScalePercent[key]}
                onValueCommit={value => setParameters(setUnitDestructionWreckageScalePercent(key, value))}
              />
              <span>%</span>
            </label>)}
          </div>
          <div className="mt-1 text-[9px] font-bold text-black/50">控制 fx_Wreckage 残骸贴图大小，范围 10%～400%；不会改变残骸数量、速度或飞散距离。</div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
          <label className="inline-flex items-center gap-2 text-[10px] font-black" title="战斗中启用当前可见与视野外阴影两层结构；关卡编辑器不显示该遮罩。">
            <span>战场视野遮罩</span>
            <select aria-label="战场视野遮罩" value={parameters.battleVisionEnabled ? 'show' : 'hide'} onChange={event => setParameters(setBattleVisionEnabled(event.target.value === 'show'))} className="h-6 border-2 border-black bg-[#EFEBD8] px-2 text-[10px] font-black">
              <option value="show">显示</option>
              <option value="hide">不显示</option>
            </select>
          </label>
          <label className="inline-flex items-center gap-2 text-[10px] font-black" title="玩家主控、玩家阵营单位和友方单位均以该半径贡献视野；所有来源取并集。">
            <span>玩家视野</span>
            <ValidatedNumberInput
              aria-label="玩家共享视野范围"
              min={3.2}
              max={960}
              step={3.2}
              className="h-6 w-24 border-2 border-black bg-[#EFEBD8] px-1 text-[10px] font-black"
              value={parameters.playerVisionMeters}
              onValueCommit={value => setParameters(setPlayerVisionMeters(value))}
            />
            <span>m</span>
          </label>
        </div>
        <div className="mt-1 text-[9px] font-bold text-black/50">当前采用两层视野；玩家主控、玩家阵营与友方单位共享视野，多人模式同阵营沿用同一共享口径。</div>
        <label className="mt-2 inline-flex items-center gap-2 text-[10px] font-black" title="控制战场内主控、友方、玩家阵营与敌方单位头顶的结构血条；左上角主控状态 HUD 不受影响。">
          <span>单位血条</span>
          <select aria-label="单位血条显示" value={parameters.showUnitHealthBars ? 'show' : 'hide'} onChange={event => setParameters(setUnitHealthBarsVisible(event.target.value === 'show'))} className="h-6 border-2 border-black bg-[#EFEBD8] px-2 text-[10px] font-black">
            <option value="show">显示</option>
            <option value="hide">不显示</option>
          </select>
        </label>
        <label className="mt-2 ml-5 inline-flex items-center gap-2 text-[10px] font-black" title="统一控制主游戏与关卡编辑器内单位、物体和幽灵预览的地面阴影；飞行单位仍会按实际高度改变阴影偏移、大小和透明度。">
          <span>单位/物体阴影</span>
          <select aria-label="单位物体阴影显示" value={parameters.showEntityShadows ? 'show' : 'hide'} onChange={event => setParameters(setEntityShadowsVisible(event.target.value === 'show'))} className="h-6 border-2 border-black bg-[#EFEBD8] px-2 text-[10px] font-black">
            <option value="show">显示</option>
            <option value="hide">不显示</option>
          </select>
        </label>
      </div>
    </details>
    <details className="shrink-0 border-2 border-black bg-[#D2CCA9]" open>
      <summary className="cursor-pointer px-2 py-1 text-[10px] font-black bg-[#C9C29F]">调试设置</summary>
      <div className="border-t border-black p-2">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <label className="inline-flex items-center gap-2 text-[10px] font-black" title="开启期间，所有战车、炮塔、模块、涂装、徽记和关卡均视为已解锁；关闭后恢复真实玩家进度。">
            <input
              type="checkbox"
              aria-label="解锁所有"
              checked={parameters.unlockAll}
              onChange={event => setParameters(setUnlockAll(event.target.checked))}
            />
            解锁所有
          </label>
          <label className="inline-flex items-center gap-2 text-[10px] font-black" title="只控制“击穿”战斗文字；穿甲火花和弹丸库命中特效始终播放。">
            <input
              type="checkbox"
              aria-label="穿甲显示"
              checked={parameters.showPenetrationFx}
              onChange={event => setParameters(setHitFxVisibility('showPenetrationFx', event.target.checked))}
            />
            穿甲显示
          </label>
          <label className="inline-flex items-center gap-2 text-[10px] font-black" title="只控制“跳弹”战斗文字；跳弹亮线、火花和碎屑始终播放。">
            <input
              type="checkbox"
              aria-label="跳弹显示"
              checked={parameters.showRicochetFx}
              onChange={event => setParameters(setHitFxVisibility('showRicochetFx', event.target.checked))}
            />
            跳弹显示
          </label>
          <label className="inline-flex items-center gap-2 text-[10px] font-black" title="只控制冲撞战斗文字；冲撞火花、碰撞阻挡、实体分离、伤害和音效始终保留。">
            <input
              type="checkbox"
              aria-label="冲撞显示"
              checked={parameters.showRammingFx}
              onChange={event => setParameters(setHitFxVisibility('showRammingFx', event.target.checked))}
            />
            冲撞显示
          </label>
        </div>
        <div className="mt-1 text-[9px] font-bold text-black/50">三个显示开关只控制对应战斗文字；穿甲、跳弹和冲撞的火花、粒子、音效及实际结算始终保留。</div>
      </div>
    </details>
    <DisplaySettingsEditor />
    <PerformanceSettingsEditor parameters={parameters} setParameters={setParameters} />
    <AudioSettingsEditor />
  </div>
}

function AssetsTab({ bump }: { bump: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const previewActionRef = useRef(0)
  const [msg, setMsg] = useState('')
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [expandedCategories, setExpandedCategories] = useState<Set<AssetCategory>>(() => new Set())
  const [upCat, setUpCat] = useState<AssetCategory>('base') // 上传时选分类（默认底座）
  const audioCategory = (category: AssetCategory): category is 'bgm' | 'se' => category === 'bgm' || category === 'se'
  const stopPreview = () => {
    previewActionRef.current++
    audioManager.stopPreview()
    setPreviewId(null)
  }
  const togglePreview = async (asset: AssetEntry) => {
    if (previewId === asset.id) { stopPreview(); return }
    stopPreview()
    const actionId = previewActionRef.current
    try {
      setPreviewId(asset.id)
      const played = await audioManager.playPreview(asset.id, asset.category === 'bgm', () => setPreviewId(current => current === asset.id ? null : current))
      if (actionId !== previewActionRef.current) return
      if (!played) throw new Error(`${asset.name} 无法播放`)
    } catch (error) {
      if (actionId !== previewActionRef.current) return
      stopPreview()
      setMsg(error instanceof Error ? error.message : '音频试听失败')
    }
  }
  useEffect(() => () => {
    previewActionRef.current++
    audioManager.stopPreview()
  }, [])
  const tileKindName = (kind: NonNullable<AssetEntry['tileSheet']>['kind']) => kind === 'independent' ? '独立图块 5×5' : kind === 'autotileStatic' ? '静态 Autotile' : '动态 Autotile（4 帧）'
  const detectTileSheet = (src: string, done: (sheet: NonNullable<AssetEntry['tileSheet']> | undefined) => void) => {
    const image = new Image()
    image.onload = () => {
      const sheet = tileSheetForDimensions(image.naturalWidth, image.naturalHeight)
      if (sheet?.kind !== 'independent') { done(sheet); return }
      try {
        const canvas = document.createElement('canvas')
        canvas.width = image.naturalWidth; canvas.height = image.naturalHeight
        const context = canvas.getContext('2d', { willReadFrequently: true })
        if (!context) { done(undefined); return }
        context.drawImage(image, 0, 0)
        sheet.validTileIndices = independentTileIndicesFromPixels(context.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height)
        done(sheet)
      } catch { done(undefined) }
    }
    image.onerror = () => done(undefined)
    image.src = src
  }
  useEffect(() => {
    // 旧“地形贴图”加载时已迁入图块分类；在素材库打开后补做尺寸识别。
    // 不符合现行三种图块尺寸的旧素材转为未分类，避免出现在图块选择器中。
    for (const asset of listAssets().filter(item => !item.builtin && (item.category === 'tile' || item.category === 'worldObject') && !item.tileSheet)) {
      detectTileSheet(asset.src, sheet => {
        if (asset.category === 'worldObject') {
          if (sheet?.kind === 'autotileStatic' || sheet?.kind === 'autotileAnimated') setAssetTileSheet(asset.id, sheet)
        } else if (!sheet || (sheet.kind === 'independent' && sheet.validTileIndices?.length === 0)) setAssetCategory(asset.id, 'other')
        else { setAssetCategory(asset.id, 'tile'); setAssetTileSheet(asset.id, sheet) }
        bump()
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅在素材库挂载时迁移一次既有条目
  }, [])
  const onFile = async (f: File, category: AssetCategory): Promise<{ replacing: boolean; message: string }> => {
    const wantsAudio = audioCategory(category)
    const assetName = f.name.replace(/\.[^.]+$/, '')
    const replacing = listAssets().some(asset => asset.category === category && asset.name === assetName)
    const audioFile = /^audio\/(mpeg|wav|ogg|x-wav)$/.test(f.type) || /\.(mp3|wav|ogg)$/i.test(f.name)
    if (wantsAudio ? !audioFile : !/^image\/(png|jpeg)$/.test(f.type)) throw new Error(wantsAudio ? 'BGM/SE 仅支持 MP3/WAV/OGG' : '图片素材仅支持 PNG/JPG')
    if (wantsAudio) {
      await addAudioAsset(assetName, f, category)
      return { replacing, message: `已${replacing ? '替换' : '添加'}${category === 'bgm' ? '背景音乐' : '音效'} ✓ · ${(f.size / 1024 / 1024).toFixed(2)}MB` }
    }
    const src = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(reader.error ?? new Error('图片读取失败'))
      reader.readAsDataURL(f)
    })
    let sheet: NonNullable<AssetEntry['tileSheet']> | undefined
    if (category === 'tile' || category === 'worldObject') {
      sheet = await new Promise(resolve => detectTileSheet(src, resolve))
      if (category === 'worldObject' && sheet?.kind !== 'autotileStatic' && sheet?.kind !== 'autotileAnimated') sheet = undefined
      if (category === 'tile' && !sheet) throw new Error('图块尺寸无效：独立图块需 160×160，静态 Autotile 需 96×128，动态 Autotile 需 384×128')
      if (category === 'tile' && sheet?.kind === 'independent' && sheet.validTileIndices?.length === 0) throw new Error('独立图块中没有可见单元格：25格均为全透明空图')
    }
    addAsset(assetName, src, category, sheet)
    const sizeMessage = f.size > 500 * 1024 ? `；${Math.round(f.size / 1024)}KB 超过 500KB` : ''
    return { replacing, message: sheet ? `已${replacing ? '替换并识别' : '识别'}：${tileKindName(sheet.kind)}${sizeMessage}` : `已${replacing ? '替换' : '添加'} ✓${sizeMessage}` }
  }
  const onFiles = async (files: File[]) => {
    if (files.length === 0) return
    const category = upCat
    const completed: { replacing: boolean; message: string }[] = []
    const failures: string[] = []
    for (const file of files) {
      try { completed.push(await onFile(file, category)) }
      catch (error) { failures.push(`${file.name}：${error instanceof Error ? error.message : '保存失败'}`) }
    }
    bump()
    if (files.length === 1 && completed[0] && failures.length === 0) setMsg(completed[0].message)
    else {
      const added = completed.filter(item => !item.replacing).length
      const replaced = completed.length - added
      const summary = `批量上传完成：新增 ${added}，替换 ${replaced}，失败 ${failures.length}`
      setMsg(failures.length > 0 ? `${summary}；${failures.slice(0, 2).join('；')}${failures.length > 2 ? `；另有 ${failures.length - 2} 项` : ''}` : summary)
    }
  }
  const changeCategory = (asset: AssetEntry, category: AssetCategory) => {
    const isAudio = isAudioAsset(asset)
    if (audioCategory(category) && !isAudio) { setMsg(`${asset.name} 不是音频，无法转入 ${ASSET_CATEGORY_NAME[category]} 分类`); return }
    if (!audioCategory(category) && isAudio) { setMsg(`${asset.name} 是音频，只能归入 BGM 或 SE`); return }
    if (category !== 'tile' && category !== 'worldObject') { setAssetCategory(asset.id, category); bump(); return }
    detectTileSheet(asset.src, sheet => {
      if (category === 'worldObject') {
        setAssetCategory(asset.id, category)
        if (sheet?.kind === 'autotileStatic' || sheet?.kind === 'autotileAnimated') setAssetTileSheet(asset.id, sheet)
        setMsg(sheet?.kind === 'autotileStatic' || sheet?.kind === 'autotileAnimated' ? `${asset.name} 已识别为${tileKindName(sheet.kind)}物体` : `${asset.name} 已转入物体贴图（普通贴图）`)
        bump()
        return
      }
      if (!sheet) { setMsg(`${asset.name} 尺寸不符合图块规则，无法转入图块分类`); return }
      if (sheet.kind === 'independent' && sheet.validTileIndices?.length === 0) { setMsg(`${asset.name} 的25个单元格均为全透明空图，无法转入图块分类`); return }
      setAssetCategory(asset.id, category)
      setAssetTileSheet(asset.id, sheet)
      setMsg(`${asset.name} 已识别为${tileKindName(sheet.kind)}`)
      bump()
    })
  }
  return (
    // v1.68：根容器改为 flex 列布局（flex-1 min-h-0），列表区占满剩余空间精确滚动——
    // 修复横版下列表拉到最底显示不全（原 space-y-2 无高度约束，内容超出面板被裁剪）
    <div className="flex-1 min-h-0 flex flex-col gap-2 px-2 py-1.5 overflow-hidden">
      <div className="text-[9px] text-black/50 leading-tight shrink-0">
        素材库：图片支持 PNG/JPG；BGM（背景音乐）与 SE（音效）支持 MP3/WAV/OGG，并保存到独立音频存储。素材按分类锚定选配，内置条目（如有）不可删。
      </div>
      <input
        ref={fileRef}
        type="file"
        multiple
        accept={audioCategory(upCat) ? 'audio/mpeg,audio/wav,audio/ogg,.mp3,.wav,.ogg' : 'image/png,image/jpeg'}
        className="hidden"
        onChange={e => {
          const files = Array.from(e.target.files ?? [])
          if (files.length > 0) void onFiles(files)
          e.target.value = ''
        }}
      />
      <div className="flex items-center gap-1.5 shrink-0">
        <button className="comic-btn px-2 py-1 text-[10px]" onClick={() => fileRef.current?.click()}>+ 上传{audioCategory(upCat) ? '音频' : '图片'}</button>
        <span className="text-[9px] font-bold text-black/60">分类</span>
        <select
          className="h-6 w-auto max-w-full px-1 text-[11px] font-comic border-2 border-black bg-[#EFEBD8]"
          value={upCat}
          onChange={e => setUpCat(e.target.value as AssetCategory)}
        >
          {ASSET_CATS.map(c => <option key={c} value={c}>{ASSET_CATEGORY_NAME[c]}</option>)}
        </select>
      </div>
      {msg && <div className="text-[9px] font-bold text-[#B98A1D] shrink-0">{msg}</div>}
      {/* 各分类统一使用可折叠面板；展开后以自适应矩阵横向排列素材卡片。 */}
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain touch-pan-y pr-0.5 pb-2 space-y-1">
      {ASSET_CATS.map(cat => {
        const items = listAssets().filter(a => a.category === cat)
        return (
          <details
            key={cat}
            data-asset-category={cat}
            className="border-2 border-black bg-[#D2CCA9]"
            open={expandedCategories.has(cat)}
            onToggle={event => {
              const isOpen = event.currentTarget.open
              setExpandedCategories(current => {
                if (current.has(cat) === isOpen) return current
                const next = new Set(current)
                if (isOpen) next.add(cat); else next.delete(cat)
                return next
              })
            }}
          >
            <summary className="cursor-pointer select-none px-2 py-1 text-[9px] font-black bg-[#C9C29F] border-b border-black/35">
              {ASSET_CATEGORY_NAME[cat]}（{items.length}）
            </summary>
            {items.length === 0 ? (
              <div className="m-1 px-2 py-3 border border-dashed border-black/25 text-center text-[8px] font-bold text-black/40">
                暂无{ASSET_CATEGORY_NAME[cat]}，请在上方选择该分类后上传
              </div>
            ) : (
              <div data-asset-grid={cat} className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-1 p-1">
                {items.map(a => (
                  <article key={a.id} className="comic-card min-w-0 p-1.5 grid grid-cols-[40px_minmax(0,1fr)] grid-rows-[auto_auto] gap-x-1.5 gap-y-1 items-start">
                    {isAudioAsset(a) ? (
                      <span className="w-10 h-10 border border-black bg-[#D9A441] shrink-0 flex items-center justify-center text-[15px]">♪</span>
                    ) : a.spriteSheet ? (
                      <span className="w-10 h-10 border border-black overflow-hidden bg-white shrink-0">
                        <img src={a.src} alt={a.name} className="h-full max-w-none object-contain" />
                      </span>
                    ) : (
                      <img src={a.src} alt={a.name} className="w-10 h-10 border border-black object-contain bg-white shrink-0" />
                    )}
                    <div className="min-w-0">
                      <div className="flex items-start gap-1">
                        <div className="min-w-0 flex-1 text-[10px] font-bold truncate" title={a.name}>{a.name}</div>
                        <span className={`text-[8px] font-bold shrink-0 ${a.builtin ? 'text-black/40' : 'text-[#2E63B8]'}`}>{a.builtin ? '内置' : '上传'}</span>
                      </div>
                      <div className="text-[8px] text-black/45 truncate" title={a.id}>{a.id}</div>
                      {a.spriteSheet && <div className="text-[8px] text-black/45 truncate">横向 {a.spriteSheet.frameWidth}×{a.spriteSheet.frameHeight} · 行走/射击/掩体/死亡</div>}
                      {a.tileSheet && <div className="text-[8px] text-black/45 truncate">{a.tileSheet.width}×{a.tileSheet.height} · {tileKindName(a.tileSheet.kind)}</div>}
                      {a.audio && <div className="text-[8px] text-black/45 truncate">{a.audio.mimeType.replace('audio/', '').toUpperCase()} · {(a.audio.size / 1024 / 1024).toFixed(2)}MB</div>}
                    </div>
                    <div className="col-span-2 min-w-0 flex items-center justify-end gap-1 border-t border-black/15 pt-1">
                      {isAudioAsset(a) && <button type="button" className={`comic-btn px-1.5 py-0.5 text-[8px] shrink-0 ${previewId === a.id ? 'bg-[#B3392E] text-[#EFEBD8]' : ''}`} onClick={() => void togglePreview(a)}>{previewId === a.id ? <><Square className="inline w-2.5 h-2.5 mr-0.5" />停止</> : <><Play className="inline w-2.5 h-2.5 mr-0.5" />试听</>}</button>}
                      {!a.builtin && <>
                        <select
                          className="h-6 w-auto max-w-full min-w-0 px-1 text-[11px] font-comic border-2 border-black bg-[#EFEBD8]"
                          value={a.category}
                          title="改分类"
                          onChange={e => changeCategory(a, e.target.value as AssetCategory)}
                        >
                          {ASSET_CATS.map(c => <option key={c} value={c}>{ASSET_CATEGORY_NAME[c]}</option>)}
                        </select>
                        <button className="text-[9px] text-[#B3392E] shrink-0" onClick={() => { if (previewId === a.id) stopPreview(); removeAsset(a.id); bump() }}>删除</button>
                      </>}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </details>
        )
      })}
      </div>
    </div>
  )
}

// ================= 弹丸效果预览（v1.69） =================
const AMMO_FX_CELL = BASE_CELL // 与战斗和炮塔美术预览共用全局格像素
function AmmoPreview({ pa }: { pa: ProjectileArtDef }) {
  const cvRef = useRef<HTMLCanvasElement>(null)
  const [mode, setMode] = useState<AmmoFxMode | null>(null)
  const poolRef = useRef(createPool())
  const stRef = useRef(createFxState())

  // 切换条目/模式：重置粒子池与播放状态
  useEffect(() => {
    poolRef.current = createPool()
    stRef.current = createFxState()
  }, [pa.id, mode])

  useEffect(() => {
    const cv = cvRef.current
    if (!cv) return
    const ctx = cv.getContext('2d')
    if (!ctx) return
    const W = cv.width
    const H = cv.height
    const worldW = W / AMMO_FX_CELL
    const midY = H / AMMO_FX_CELL / 2
    // v1.70 探针：预览效果重跑计数（无头验证换贴图刷新）
    if (typeof window !== 'undefined') {
      const w = window as unknown as { __ammoPreviewReruns?: number; __ammoBodyAsset?: string | null }
      w.__ammoPreviewReruns = (w.__ammoPreviewReruns ?? 0) + 1
      w.__ammoBodyAsset = pa.projectileAsset ?? null
    }
    let last = performance.now()
    let raf = 0
    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      const st = stRef.current
      // v1.70：贴图每帧重取解析链——选择新弹丸贴图后加载完成即刷新，无需重启播放
      const artSt = projectileArtState(pa)
      const bodyImg = artSt.status === 'ready' ? artSt.assets?.projectile : undefined
      if (mode) { // v1.71：尾焰尾部偏移 = 贴图高度一半（绑定底部中间，适配不同弹丸尺寸）
        const tailOff = bodyImg ? bodyImg.height / 2 / AMMO_FX_CELL : 4 / AMMO_FX_CELL
        fxTick(pa, mode, poolRef.current, st, dt, worldW, midY, tailOff)
      }
      // 背景 + 弹道参考线
      ctx.globalCompositeOperation = 'source-over'
      ctx.globalAlpha = 1
      ctx.fillStyle = '#262420'
      ctx.fillRect(0, 0, W, H)
      ctx.strokeStyle = 'rgba(239,235,216,0.14)'
      ctx.setLineDash([4, 4])
      ctx.beginPath(); ctx.moveTo(0, midY * AMMO_FX_CELL); ctx.lineTo(W, midY * AMMO_FX_CELL); ctx.stroke()
      ctx.setLineDash([])
      // 弹体：飞行模式随弹右移；未播放时居中静立（贴图按原图尺寸绘制，不缩放）
      const drawBody = (wx: number, wy: number, heading: number) => {
        ctx.save()
        ctx.translate(wx * AMMO_FX_CELL, wy * AMMO_FX_CELL)
        ctx.rotate(heading)
        if (bodyImg) {
          // 垂发导弹静态美术预览固定展示第 1 帧（全垂直）；开始播放后才按垂发时间轴切换 7 帧。
          const bodyFrame = projectileBodyFrameRect(pa, bodyImg.naturalWidth, bodyImg.naturalHeight, mode ? st.t : 0)
          ctx.imageSmoothingEnabled = false
          ctx.drawImage(bodyImg, bodyFrame.sx, 0, bodyFrame.sw, bodyFrame.sh, -bodyFrame.sw / 2, -bodyFrame.sh / 2, bodyFrame.sw, bodyFrame.sh)
        } else {
          ctx.fillStyle = PROJECTILE_KIND_COLOR[pa.kind]
          ctx.strokeStyle = '#1A1A18'
          ctx.lineWidth = 1.5
          ctx.beginPath(); ctx.arc(0, 0, 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
        }
        ctx.restore()
      }
      // v2.38：射线 seq 发射/持续/消失与实战一致——phase0 起射按 BEAM_ON_SPEED 伸展（端点闪光随前锋）；
      // 熄灭窗口前 BEAM_FADE(0.25s) 走停火消退口径（长度冻结、光晕渐隐、亮芯收窄到 0%，无光球/端点闪光）
      const raySeqFade = mode === 'seq' && pa.kind === 'ray' ? fxRaySeqFade(st) : 0
      if (mode === 'seq' && pa.kind === 'ray' && (st.phase === 0 || raySeqFade > 0)) {
        const ba = beamArtConfigOf(pa)
        const nowSb = now / 1000
        const wave = 0.5 + 0.5 * (0.7 * Math.sin(nowSb * 22) + 0.3 * Math.sin(nowSb * 57))
        const bright = 1 - ba.flicker + ba.flicker * wave
        const scroll = ba.scrollSpeed > 0 ? nowSb * ba.scrollSpeed * (AMMO_FX_CELL / BASE_CELL) : 0
        const wpx = 0.45 * AMMO_FX_CELL
        const firing = st.phase === 0
        // 发射/持续：长度随伸展 ramp；消退：长度冻结在全长
        const lenPx = (firing ? fxRaySeqLen(st, worldW) : worldW - 1) * AMMO_FX_CELL
        // 消退段：alpha=p^0.7、亮芯 vScale=p 收窄到 0%（与战场 v2.36 同口径）；发射段：闪烁亮度
        const fadeA = firing ? 1 : Math.pow(raySeqFade, 0.7)
        const coreVS = firing ? 1 : raySeqFade
        ctx.save()
        ctx.translate(0.5 * AMMO_FX_CELL, midY * AMMO_FX_CELL) // 发射点（局部 +x 即光束方向，无需旋转）
        const glowT = ba.glow?.status === 'ready' && ba.glow.img ? tintedFx(ba.glow.img, ba.fringeColor) : null
        const coreT = ba.core?.status === 'ready' && ba.core.img ? tintedFx(ba.core.img, ba.coreColor) : null
        drawBeamLayer(ctx, glowT, ba.fringeColor, lenPx, wpx, 0.45 * bright * fadeA, scroll)
        drawBeamLayer(ctx, coreT, ba.coreColor, lenPx, wpx * 0.5, 0.9 * bright * fadeA, scroll, 1, coreVS)
        if (firing) {
          const mzT = ba.muzzle?.status === 'ready' && ba.muzzle.img ? tintedFx(ba.muzzle.img, ba.fringeColor) : null
          if (mzT) { // 炮口光球（v2.10 尺寸×muzzleScale）
            const msz = wpx * 2 * ba.muzzleScale * (0.9 + 0.2 * wave)
            ctx.globalCompositeOperation = 'lighter'
            ctx.globalAlpha = 0.85 * bright
            ctx.drawImage(mzT, -msz / 2, -msz / 2, msz, msz)
            ctx.globalCompositeOperation = 'source-over'
            ctx.globalAlpha = 1
          }
          const imT = ba.impact?.status === 'ready' && ba.impact.img ? tintedFx(ba.impact.img, ba.coreColor) : null
          if (imT) { // 端点命中闪光（v2.10 尺寸×impactScale）；v2.38：随伸展前锋移动
            const isz = wpx * 2.6 * ba.impactScale * (0.85 + 0.3 * wave)
            const tw = Math.sin(nowSb * 40)
            ctx.globalCompositeOperation = 'lighter'
            ctx.globalAlpha = Math.min(1, 0.75 * bright + 0.25 * tw * tw)
            ctx.drawImage(imT, lenPx - isz / 2, -isz / 2, isz, isz)
            ctx.globalCompositeOperation = 'source-over'
            ctx.globalAlpha = 1
          }
        }
        ctx.restore()
      } else if (mode === 'seq' && st.phase === 0) drawBody(st.px, midY, Math.PI / 2) // v2.34：弹体仅飞行段绘制（爆发段弹已消溶）
      else if (!mode) drawBody(worldW / 2, midY, 0)
      // 矢量底闪：爆炸 = 亮核收缩 + 多层冲击环；命中 = 中心亮点一闪（相位由 burstAt 推演，同战斗渲染）
      // v2.34：seq 模式下命中/爆炸闪均在右端命中点（FX_SEQ_HIT_X）
      const el = st.t - st.burstAt
      // v2.55：爆炸/命中/粒子画法一律走 fxDraw 共用层（与战场同一函数，杜绝平行实现漂移）
      const xp = (x: number) => x * AMMO_FX_CELL
      const yp = (y: number) => y * AMMO_FX_CELL
      const hitXW = mode === 'seq' ? FX_SEQ_HIT_X(worldW) : worldW / 2
      if (mode === 'seq' || mode === 'explosion') {
        const ef = resolveExplosionFx(pa)
        if (ef && el >= 0 && el < ef.duration) {
          drawExplosionLayers(ctx, xp, yp, AMMO_FX_CELL, { x: hitXW, y: midY, r: FX_PREVIEW_RADIUS }, el / ef.duration, ef, el)
        }
      }
      if (mode === 'seq' || mode === 'impact') { // v2.34：seq 下命中闪光与爆炸环可同时（按配置各自门控）
        const inf = resolveImpactFx(pa)
        if (inf && el >= 0 && el < inf.duration) {
          drawImpactFlash(ctx, xp, yp, hitXW, midY, el / inf.duration)
        }
      }
      // 粒子层（v2.55 走 fxDraw 共用画法层，与战场完全一致）
      drawParticlePool(ctx, poolRef.current, xp, yp, AMMO_FX_CELL, now / 1000)
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
    // v1.70：依赖加入 pa.projectileAsset——选择弹丸贴图后立即重取 bodyImg，预览图刷新新贴图
  }, [pa, mode, pa.projectileAsset, pa.speed, pa.missileInitSpeed, pa.missileAccel, pa.missileMaxSpeed, pa.burnTime, pa.guided, pa.guideDelay, pa.guideDecel])

  return (
    <div className="border-2 border-black bg-[#262420] mb-1.5">
      <canvas ref={cvRef} width={360} height={108} className="block max-w-full h-auto" /> {/* v1.71：不用 w-full 拉伸——画布 1px=1px，弹丸贴图按原图尺寸显示不缩放 */}
      <div className="flex items-center gap-1 border-t-2 border-black bg-[#C9C29F] p-1">
        {/* v2.34：三模式按钮整合为单「播放/停止」——动画=从左飞行到右端命中/爆炸全过程（循环至停止） */}
        {(() => {
          const ok = canPlay(pa, 'seq') // 飞行/命中/爆炸至少配置一项（射线恒可播=光束持续）
          const active = mode === 'seq'
          return (
            <button
              disabled={!ok}
              title={ok ? (pa.kind === 'ray' ? '播放/停止：与实战一致——光束起射伸展→持续 5s→消退消失，停顿循环至停止' : '播放/停止：弹丸从左飞行到右端，命中/爆炸全过程循环') : '未配置任何效果（尾焰/命中/爆炸至少一项）'}
              className={`comic-btn px-2 py-0.5 text-[10px] flex items-center gap-0.5 ${active ? 'bg-[#B3392E] text-[#EFEBD8]' : ''} ${!ok ? 'opacity-40 cursor-not-allowed' : ''}`}
              onClick={() => { if (ok) setMode(active ? null : 'seq') }}
            >
              {active ? <Square className="w-3 h-3" /> : <Play className="w-3 h-3" />}
              {active ? '停止' : '播放'}
            </button>
          )
        })()}
        <span className="ml-auto text-[8px] text-black/45">{pa.kind === 'ray' ? '与实战一致：起射伸展→持续 5s→消退消失，循环至停止' : '从左飞行到右端命中/爆炸，循环至停止；未配置任何效果不可播'}</span>
      </div>
    </div>
  )
}

// ================= 弹丸库 Tab =================
const BUILTIN_AMMO = new Set(['bullet_std', 'shell_std', 'rocket_std', 'ray_std', 'flame_std', 'custom_ammo_1', 'custom_ammo_2', 'custom_ammo_3'])
const KIND_COLOR: Record<ProjectileArtKind, string> = { bullet: '#E8C86A', shell: '#8FAADC', missile: '#D98F6A', ray: '#9AD9C8', spray: '#D98A45' }

function AmmoTab({ bump }: { bump: () => void }) {
  const [selectedId, setSelectedId] = useState<string | null>(PROJECTILE_ARTS[0]?.id ?? null) // 弹丸页签单选（左列表右参数窗）
  const [newName, setNewName] = useState('')
  const addAmmo = () => {
    const name = newName.trim()
    if (!name) return
    let n = 1
    while (PROJECTILE_ARTS.some(a => a.id === `custom_ammo_${n}`)) n++
    PROJECTILE_ARTS.push({ id: `custom_ammo_${n}`, name, kind: 'bullet', directSubtype: 'bullet', damage: 10, speed: 100, penetration: 1, pierce: { count: 0, decay: 0.3 } })
    setSelectedId(`custom_ammo_${n}`) // 新建后自动选中
    setNewName('')
    bump()
  }
  const patchAmmo = (id: string, change: (next: ProjectileArtDef) => void) => {
    const index = PROJECTILE_ARTS.findIndex(definition => definition.id === id)
    if (index < 0) return
    const next = structuredClone(PROJECTILE_ARTS[index])
    change(next)
    PROJECTILE_ARTS.splice(index, 1, next)
    bump()
  }
  const deleteAmmo = (pa: ProjectileArtDef) => {
    if (BUILTIN_AMMO.has(pa.id)) return
    const index = PROJECTILE_ARTS.findIndex(item => item.id === pa.id)
    if (index < 0) return
    PROJECTILE_ARTS.splice(index, 1)
    if (selectedId === pa.id) setSelectedId(PROJECTILE_ARTS[Math.min(index, PROJECTILE_ARTS.length - 1)]?.id ?? null)
    bump()
  }
  const FX_TIPS: Record<string, string> = {
    color: '特效主色；默认=弹丸类别色',
    rate: '尾焰粒子发射速率（粒/秒）',
    speed: '命中粒子初速度（格/秒），越大飞溅越有力',
    life: '单粒寿命（秒）',
    size: '粒子尺寸（格）',
    drag: '粒子阻力系数：越大减速越快，0=匀速',
    inherit: '尾焰粒子的惯性保留比例 0-1：数值越高越能保留转向时的侧向甩尾，但始终不会向弹头前方喷射',
    spread: '发射方向随机锥角（弧度），越大越散',
    grow: '尺寸变化率：>0 膨胀 <0 收缩',
    fadeIn: '淡入时长（秒），0=立即全亮',
    duration: '矢量底闪播放时长（秒）',
    visualScale: '爆炸纯视觉尺寸倍率；不改变爆炸伤害、爆炸半径或其他战斗判定',
    sparks: '火花粒子数：向外高速、强减速、短寿命',
    smoke: '烟尘粒子数：低速、长寿命、膨胀、暗色',
    rings: '冲击环层数 1-4：相位错开逐层扩散',
    ringSpeed: '冲击环扩散速度系数，>1 更快',
    ringWidth: '冲击环线宽（px）',
    turbulence: '烟尘湍流强度 0-2：漂移抖动幅度',
    speedJitter: '火花初速随机幅度 0-1：每粒速度 ×(1±jitter)',
    lifeJitter: '火花寿命随机幅度 0-1',
    bias: '方向偏置 0-1：火花朝来弹反方向向外喷射，1=完全锥形爆发',
    angle: '散射全锥角 0-360°：需配合方向偏置；90°表示外喷方向左右各45°',
    streak: '速度拖尾：开启后粒子沿速度反方向拉出短亮线',
    spikes: '命中碎屑粒子数：短寿命向外飞溅',
  }
  const ammoSectionClass = 'mt-2 border-t-2 border-black/25 pt-1'
  const ammoGridClass = 'grid grid-cols-2 lg:grid-cols-4 gap-x-2 gap-y-1'
  const ammoFieldClass = 'flex items-center gap-1 min-w-0'
  const ammoTipClass = 'text-[9px] font-bold text-black/60 w-14 shrink-0'

  // 程序化特效参数组（远行星号式实时生成，无需序列帧素材；删空数值=用默认）
  const fxGroup = (
    pa: ProjectileArtDef, key: 'trail' | 'explosion' | 'impact', label: string, hint: string,
    fields: [string, string, number][], // [标签, 参数名, step]
    extra?: (fx: Record<string, unknown>, patchFx: (change: (next: Record<string, unknown>) => void) => void) => ReactNode,
    bottom?: (fx: Record<string, unknown>, patchFx: (change: (next: Record<string, unknown>) => void) => void) => ReactNode,
  ) => {
    const fx = pa[key] as Record<string, unknown> | undefined
    const patchFx = (change: (next: Record<string, unknown>) => void) => patchAmmo(pa.id, next => {
      const record = next as unknown as Record<string, unknown>
      const nextFx = record[key]
      if (nextFx && typeof nextFx === 'object') change(nextFx as Record<string, unknown>)
    })
    // 解析后的生效默认值（模板/全局默认），作为留空字段的占位提示——所见即当前生效值
    const resolved = fx
      ? (key === 'trail' ? resolveTrailFx(pa) : key === 'explosion' ? resolveExplosionFx(pa) : resolveImpactFx(pa))
      : null
    return (
      <section key={key} className={ammoSectionClass}>
        <div className="flex items-center justify-between gap-2 mb-1">
          <TipLabel text={label} tip={hint} className="text-[10px] font-black text-black/70" />
          {fx ? (
            <button className="text-[9px] text-[#B3392E]" onClick={() => patchAmmo(pa.id, next => { delete next[key] })}>删除该特效(回退)</button>
          ) : (
            <button className="text-[9px] text-[#2E63B8]" onClick={() => patchAmmo(pa.id, next => { (next as unknown as Record<string, unknown>)[key] = {} })}>+ 添加{label}</button>
          )}
        </div>
        {fx && (
          <div className={ammoGridClass}>
            {extra?.(fx, patchFx)}
            <label className={ammoFieldClass}>
              <TipLabel text="颜色" tip={FX_TIPS.color} className={ammoTipClass} />
              <input
                type="color"
                className="w-8 h-5 border border-black bg-[#EFEBD8]"
                value={(fx.color as string) ?? PROJECTILE_KIND_COLOR[pa.kind]}
                onChange={e => patchFx(next => { next.color = e.target.value })}
              />
              <button className="text-[8px] text-black/40" onClick={() => patchFx(next => { delete next.color })}>默认</button>
            </label>
            {fields.map(([flabel, prop, step]) => (
              <label key={prop} className={ammoFieldClass}>
                <TipLabel text={flabel} tip={FX_TIPS[prop]} className={ammoTipClass} />
                <FieldNumInput
                  v={fx[prop] as number | undefined}
                  step={step}
                  clearable
                  ph={resolved && prop in resolved ? String((resolved as unknown as Record<string, unknown>)[prop]) : undefined}
                  onCommit={n => {
                    patchFx(next => { if (n === undefined) delete next[prop]; else next[prop] = n })
                  }}
                />
              </label>
            ))}
            {bottom?.(fx, patchFx)}
          </div>
        )}
      </section>
    )
  }
  const selPa = PROJECTILE_ARTS.find(a => a.id === selectedId) ?? null // 右参数窗当前条目
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="text-[9px] text-black/50 leading-tight shrink-0 pb-1">
        弹丸库统一管理：炮塔经「弹丸」引用库条目；条目无素材时按几何回退渲染。
      </div>
      <div className="flex-1 min-h-0 flex">
        {/* 左：内容列表（单选切换） */}
        <div className="w-[96px] shrink-0 overflow-y-auto border-r border-black/30 flex flex-col">
          <div className="p-1 border-b border-black/30 shrink-0 flex items-center gap-1">
            <input
              className="flex-1 min-w-0 px-1 py-0.5 text-[10px] font-comic border-2 border-black bg-[#EFEBD8]"
              placeholder="新弹丸名称…"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addAmmo() }}
            />
            <button className="comic-btn px-1.5 py-0.5 text-[10px] shrink-0" onClick={addAmmo}>+ 新建</button>
          </div>
          <div className="flex-1">
            {PROJECTILE_ARTS.map(pa => {
              const st = projectileArtState(pa) // 本体按解析链（库引用 ?? spriteSet ?? id）
              const sel = selectedId === pa.id
              return (
                <button
                  key={pa.id}
                  className={`w-full flex items-center gap-1.5 px-1.5 py-1.5 text-left border-b border-black/20 ${sel ? 'bg-[#C9C29F] border-l-4 border-l-[#B3392E]' : 'hover:bg-black/5'}`}
                  onClick={() => setSelectedId(pa.id)}
                >
                  <span className="w-2.5 h-2.5 border border-black shrink-0" style={{ background: KIND_COLOR[pa.kind] }} />
                  <span className="min-w-0 flex-1">
                    <span className="block font-comic text-[11px] font-black truncate">{pa.name}</span>
                    <span className="block text-[8px] text-black/45 truncate">
                      {PROJECTILE_KIND_NAME[pa.kind]}
                      {st.status !== 'ready' && <span className="text-[#B3392E]/70"> · {st.status === 'loading' ? '…' : '无素材'}</span>}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        </div>
        {/* 右：参数窗口（当前选中条目完整表单） */}
        <div className="flex-1 min-w-0 overflow-y-auto">
          {selPa ? (() => {
            const pa = selPa
            return (
              <div className="p-2">
                <div className="grid grid-cols-[minmax(180px,240px)_minmax(360px,1fr)] gap-2 items-start portrait:grid-cols-1">
                  <div className="border-2 border-black/35 bg-[#D2CCA9] p-1.5 flex flex-col gap-1">
                  <label className="flex items-center gap-1 min-w-0">
                    <TipLabel text="名称" tip="弹丸条目显示名（仅标识用）" className="text-[9px] font-bold text-black/60 w-9 shrink-0" />
                    <input
                      key={pa.id}
                      className="w-full min-w-0 px-1 py-0.5 text-[10px] font-comic border-2 border-black bg-[#EFEBD8]"
                      defaultValue={pa.name}
                      onBlur={e => patchAmmo(pa.id, next => { next.name = e.target.value.trim() || next.name })}
                    />
                  </label>
                  <label className="flex items-center gap-1 min-w-0">
                    <TipLabel text="类别" tip="实弹/抛射/导弹/射线：决定默认特效色与适配炮塔类型" className="text-[9px] font-bold text-black/60 w-9 shrink-0" />
                    <select
                      className="flex-1 min-w-0 px-1 py-0.5 text-[10px] font-comic border-2 border-black bg-[#EFEBD8]"
                      value={pa.kind}
                      onChange={e => patchAmmo(pa.id, next => { next.kind = e.target.value as ProjectileArtKind; if (next.kind === 'bullet') next.directSubtype ??= 'bullet' })}
                    >
                      {(['bullet', 'shell', 'missile', 'ray', 'spray'] as const).map(k => (
                        <option key={k} value={k}>{PROJECTILE_KIND_NAME[k]}({k})</option>
                      ))}
                    </select>
                  </label>
                  {pa.kind === 'bullet' ? <label className="flex items-center gap-1 min-w-0">
                    <TipLabel text="子类" tip="仅决定与场景高度的交互；高度1只阻挡子弹，高度2和3阻挡全部直射子类。" className="text-[9px] font-bold text-black/60 w-9 shrink-0" />
                    <select className="flex-1 min-w-0 px-1 py-0.5 text-[10px] font-comic border-2 border-black bg-[#EFEBD8]" value={pa.directSubtype ?? 'bullet'} onChange={e => patchAmmo(pa.id, next => { next.directSubtype = e.target.value as DirectProjectileSubtype })}>
                      {(Object.keys(DIRECT_PROJECTILE_SUBTYPE_NAME) as DirectProjectileSubtype[]).map(subtype => <option key={subtype} value={subtype}>{DIRECT_PROJECTILE_SUBTYPE_NAME[subtype]}</option>)}
                    </select>
                  </label> : <div className="flex items-center gap-1 min-w-0">
                    <TipLabel text="子类" tip="当前类别没有子类设置。" className="text-[9px] font-bold text-black/60 w-9 shrink-0" />
                    <span className="flex-1 px-1 py-0.5 text-[10px] font-comic border-2 border-black/35 bg-black/5 text-black/45">无</span>
                  </div>}
                  <label className="flex items-center gap-1 min-w-0">
                    <TipLabel text="贴图" tip="弹丸本体贴图：素材库引用；垂发导弹开启后会自动按横向7帧垂发格式处理，不再另选转向贴图；选「无」强制几何弹丸" className="text-[9px] font-bold text-black/60 w-9 shrink-0" />
                    <select
                      className="flex-1 min-w-0 px-1 py-0.5 text-[10px] font-comic border-2 border-black bg-[#EFEBD8]"
                      value={pa.projectileAsset ?? ''}
                      onChange={e => {
                        patchAmmo(pa.id, next => { if (e.target.value) next.projectileAsset = e.target.value; else delete next.projectileAsset })
                      }}
                    >
                      <option value="">默认（文件夹/几何绘制）</option>
                      <option value="none">无（几何回退）</option>
                      {assetSelectGroups('projectile', pa.projectileAsset).groups.map(([g, items]) => items.length > 0 && (
                        <optgroup key={g} label={g}>
                          {items.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                        </optgroup>
                      ))}
                    </select>
                  </label>
                  <button
                    className="comic-btn mt-1 self-start px-1.5 py-0.5 text-[9px] text-[#B3392E] flex items-center gap-0.5 disabled:opacity-40 disabled:cursor-not-allowed"
                    disabled={BUILTIN_AMMO.has(pa.id)}
                    title={BUILTIN_AMMO.has(pa.id) ? '内置弹丸不可删除' : '删除当前弹丸'}
                    onClick={() => deleteAmmo(pa)}
                  >
                    <Trash2 className="w-3 h-3" />删除弹丸
                  </button>
                  </div>
                  <AmmoPreview pa={pa} />
                </div>
                <div className="mt-2 border-t-2 border-black/25 pt-1">
                  <div className="text-[10px] font-black text-black/70 mb-1">战斗参数（由弹丸控制）</div>
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-2 gap-y-1">
                    {([
                      ['伤害', 'damage', 1, '弹丸命中时的基础伤害；直接命中用于单体伤害，爆炸弹丸也会把它计入爆心伤害。'],
                      ['速度(m/s)', 'speed', 5, '弹丸离膛后的飞行速度（米/秒）；数值越高，抵达目标越快，不会改变武器射速。'],
                      ['穿深', 'penetration', 0.5, '用于对抗目标受击面的装甲值：穿深达到或超过装甲时必定击穿，低于装甲时按穿深与装甲的比例判定击穿或跳弹。'],
                      ['穿甲比例', 'armorPen', 0.05, '范围 0～1。未配置穿深时，表示直接作用于结构的伤害比例，其余伤害仍需扣除装甲；配置穿深后优先按穿深规则判定。'],
                      ['削甲', 'armorDamage', 1, '成功击穿时额外削减目标受击面装甲的数值；只降低装甲，不直接扣除结构值。'],
                      ['爆炸半径(m)', 'blastRadius', 1, '弹丸命中后的范围伤害半径（米）；范围内目标按爆炸规则承伤，设为 0 时不启用该弹丸配置的爆炸范围。'],
                    ] as const)
                      .filter(([, key]) => pa.kind !== 'missile' || key !== 'speed')
                      .map(([label, key, step, tip]) => <label key={key} className="flex items-center gap-1"><TipLabel text={label} tip={tip} className="text-[9px] font-bold text-black/60 w-14 shrink-0" /><FieldNumInput v={pa[key]} step={step} clearable onCommit={n => patchAmmo(pa.id, next => { if (n === undefined) delete next[key]; else next[key] = n })} /></label>)}
                    <label className="flex items-center gap-1"><TipLabel text="穿透数量" tip="弹丸可继续穿过的目标数量" className="text-[9px] font-bold text-black/60 w-14 shrink-0" /><FieldNumInput v={pa.pierce?.count} step={1} clearable onCommit={n => patchAmmo(pa.id, next => { if (n === undefined) delete next.pierce; else next.pierce = { count: Math.max(0, Math.round(n)), decay: next.pierce?.decay ?? 0.3 } })} /></label>
                    <label className="flex items-center gap-1"><TipLabel text="穿透衰减" tip="每穿过一个目标后的伤害衰减比例，范围 0-1" className="text-[9px] font-bold text-black/60 w-14 shrink-0" /><FieldNumInput v={pa.pierce?.decay} step={0.05} clearable onCommit={n => patchAmmo(pa.id, next => { next.pierce ??= { count: 0, decay: 0.3 }; next.pierce.decay = Math.max(0, Math.min(1, n ?? 0.3)) })} /></label>
                    <label className="flex items-center gap-1"><TipLabel text="持续伤害" tip="每次持续伤害跳的数值" className="text-[9px] font-bold text-black/60 w-14 shrink-0" /><FieldNumInput v={pa.dot?.damage} step={1} clearable onCommit={n => patchAmmo(pa.id, next => { if (n === undefined) delete next.dot; else next.dot = { damage: n, interval: next.dot?.interval ?? 0.5 } })} /></label>
                    <label className="flex items-center gap-1"><TipLabel text="伤害间隔" tip="持续伤害的触发间隔（秒）" className="text-[9px] font-bold text-black/60 w-14 shrink-0" /><FieldNumInput v={pa.dot?.interval} step={0.1} clearable onCommit={n => patchAmmo(pa.id, next => { next.dot ??= { damage: 0, interval: 0.5 }; next.dot.interval = Math.max(0.05, n ?? 0.5) })} /></label>
                    <label className="flex items-center gap-1"><TipLabel text="爆炸附伤" tip="爆炸范围内附加的即时伤害" className="text-[9px] font-bold text-black/60 w-14 shrink-0" /><FieldNumInput v={pa.blastEffect?.damage} step={1} clearable onCommit={n => patchAmmo(pa.id, next => { next.blastEffect ??= { damage: 0 }; next.blastEffect.damage = n ?? 0 })} /></label>
                    <label className="flex items-center gap-1"><TipLabel text="燃烧伤害" tip="爆炸后燃烧每跳伤害" className="text-[9px] font-bold text-black/60 w-14 shrink-0" /><FieldNumInput v={pa.blastEffect?.burn?.damage} step={1} clearable onCommit={n => patchAmmo(pa.id, next => { next.blastEffect ??= { damage: 0 }; next.blastEffect.burn ??= { damage: 0, interval: 0.5, duration: 3 }; next.blastEffect.burn.damage = n ?? 0 })} /></label>
                    <label className="flex items-center gap-1"><TipLabel text="燃烧间隔" tip="爆炸燃烧伤害的跳动间隔（秒）" className="text-[9px] font-bold text-black/60 w-14 shrink-0" /><FieldNumInput v={pa.blastEffect?.burn?.interval} step={0.1} clearable onCommit={n => patchAmmo(pa.id, next => { next.blastEffect ??= { damage: 0 }; next.blastEffect.burn ??= { damage: 0, interval: 0.5, duration: 3 }; next.blastEffect.burn.interval = n ?? 0.5 })} /></label>
                    <label className="flex items-center gap-1"><TipLabel text="燃烧时长" tip="爆炸燃烧持续总时长（秒）" className="text-[9px] font-bold text-black/60 w-14 shrink-0" /><FieldNumInput v={pa.blastEffect?.burn?.duration} step={0.1} clearable onCommit={n => patchAmmo(pa.id, next => { next.blastEffect ??= { damage: 0 }; next.blastEffect.burn ??= { damage: 0, interval: 0.5, duration: 3 }; next.blastEffect.burn.duration = n ?? 3 })} /></label>
                  </div>
                  {pa.kind === 'missile' && <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-2 gap-y-1 mt-1 border-t border-black/15 pt-1">
                    <label className="text-[9px] font-bold"><input type="checkbox" checked={pa.guided ?? false} onChange={e => patchAmmo(pa.id, next => { next.guided = e.target.checked })} /> 制导</label>
                    <label className="text-[9px] font-bold"><input type="checkbox" checked={pa.interceptable ?? true} onChange={e => patchAmmo(pa.id, next => { next.interceptable = e.target.checked })} /> 可拦截</label>
                    <label className="flex items-center gap-1"><TipLabel text="拦截耐久" tip="导弹承受拦截武器伤害的独立耐久；归零时只播放空爆并销毁，不触发原弹头伤害" className="text-[9px] font-bold text-black/60 w-14 shrink-0" /><FieldNumInput v={pa.interceptHp ?? 1} step={1} onCommit={n => patchAmmo(pa.id, next => { next.interceptHp = Math.max(1, n ?? 1) })} /></label>
                    {([
                      ['制导延迟', 'guideDelay', 0.1, '导弹发射后等待多少秒才开始追踪目标；延迟期间保持当前航向飞行，进入制导阶段后再按现有规则索敌和转向。'],
                      ['延迟减速', 'guideDecel', 1, '制导延迟期间的减速度（米/秒²）；速度最低降至 0，设为 0 时延迟期间不额外减速。'],
                      ['初速度', 'missileInitSpeed', 5, '导弹离开发射点时的初始飞行速度（米/秒）；之后再受加速度、燃烧时间和极速限制。'],
                      ['加速度', 'missileAccel', 5, '发动机燃烧期间每秒增加的速度（米/秒²）；达到极速后不再继续加速。'],
                      ['极速', 'missileMaxSpeed', 5, '导弹动力飞行可达到的最高速度（米/秒），用于限制加速后的速度上限。'],
                      ['最大转向', 'missileTurnMax', 5, '导弹追踪目标时允许达到的最大转向角速度（度/秒）；越高越能跟随近距离或高速目标。'],
                      ['转向加速', 'missileTurnAccel', 10, '导弹转向角速度每秒增加的幅度（度/秒²）；越高越快达到最大转向速度。'],
                      ['飞行时间', 'missileFlightTime', 0.5, '导弹进入正常飞行后的最长存续时间（秒）；时间耗尽仍未命中时会消失，不触发弹头伤害。'],
                      ['曲线', 'missileCurve', 1, '导弹飞行时左右蛇形摆动的幅度；0 表示不摆动，数值越大轨迹弯曲越明显，制导延迟期间会额外放大。'],
                      ['出膛偏角', 'ejectAngle', 5, '每发导弹随机偏转的总角度区间：20 表示在 -10°～+10° 内随机出膛；仅制导延迟导弹生效。'],
                      ['燃烧时间', 'burnTime', 0.5, '导弹发动机持续工作的时间（秒）；期间可以加速并产生动力尾迹，燃尽后保持惯性飞行。'],
                    ] as const).map(([label, key, step, tip]) => <label key={key} className="flex items-center gap-1"><TipLabel text={label} tip={tip} className="text-[9px] font-bold text-black/60 w-14 shrink-0" /><FieldNumInput v={pa[key]} step={step} clearable onCommit={n => patchAmmo(pa.id, next => { if (n === undefined) delete next[key]; else next[key] = n })} /></label>)}
                  </div>}
                  {pa.kind === 'missile' && <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-2 gap-y-1 mt-1 border-t border-black/15 pt-1">
                    <label className="flex items-center gap-1"><TipLabel text="集束子弹数" tip="小于 2 视为不分裂" className="text-[9px] font-bold text-black/60 w-16 shrink-0" /><FieldNumInput v={pa.split?.count} step={1} clearable onCommit={n => patchAmmo(pa.id, next => { if (n === undefined || n < 2) delete next.split; else next.split = { count: Math.round(n), spread: next.split?.spread ?? 40, at: next.split?.at ?? 'proximity', range: next.split?.range ?? M_PER_CELL } })} /></label>
                    <label className="flex items-center gap-1"><TipLabel text="集束扇角(°)" tip="子弹展开的总扇角" className="text-[9px] font-bold text-black/60 w-16 shrink-0" /><FieldNumInput v={pa.split?.spread} step={5} clearable onCommit={n => patchAmmo(pa.id, next => { if (next.split) next.split.spread = n ?? 40 })} /></label>
                    <label className="flex items-center gap-1"><TipLabel text="分裂时机" tip="近炸按距离触发；燃尽按发动机燃烧结束触发" className="text-[9px] font-bold text-black/60 w-16 shrink-0" /><select className="flex-1 min-w-0 px-1 py-0.5 text-[9px] border-2 border-black bg-[#EFEBD8]" value={pa.split?.at ?? 'proximity'} onChange={e => patchAmmo(pa.id, next => { next.split ??= { count: 4, spread: 40, at: 'proximity', range: M_PER_CELL }; next.split.at = e.target.value as 'proximity' | 'burnout' })}><option value="proximity">近炸</option><option value="burnout">燃尽</option></select></label>
                    {pa.split?.at !== 'burnout' && <label className="flex items-center gap-1"><TipLabel text="分裂距离(m)" tip="母弹距目标进入该距离后分裂" className="text-[9px] font-bold text-black/60 w-16 shrink-0" /><FieldNumInput v={pa.split?.range} step={0.1} clearable onCommit={n => patchAmmo(pa.id, next => { if (next.split) next.split.range = n ?? M_PER_CELL })} /></label>}
                  </div>}
                </div>
                {pa.kind === 'missile' && (
                  <section className={ammoSectionClass}>
                    <div className="text-[10px] font-black text-black/70 mb-1">
                      <TipLabel text="垂发" tip="垂直发射阶段使用固定横向7帧弹丸贴图；转向结束后才开始正式飞行时间和平面碰撞。" className="text-[10px] font-black text-black/70" />
                    </div>
                    <div className={ammoGridClass}>
                      <label className={ammoFieldClass}>
                        <TipLabel text="启用" tip="启用固定7帧垂直发射流程。" className={ammoTipClass} />
                        <input
                          type="checkbox"
                          aria-label="启用垂直发射"
                          checked={pa.verticalLaunch?.enabled === true}
                          onChange={e => patchAmmo(pa.id, next => {
                            next.verticalLaunch ??= { enabled: false }
                            next.verticalLaunch.enabled = e.target.checked
                          })}
                        />
                      </label>
                      {pa.verticalLaunch?.enabled && (
                        <label className={ammoFieldClass}>
                          <TipLabel text="转向时长" tip="7帧从全垂直到正常飞行的总播放时间；转向期间制导、转向、加速等导弹参数已经生效，但飞行寿命在离开发射阶段后才开始计算。" className={ammoTipClass} />
                          <FieldNumInput
                            v={pa.verticalLaunch.duration}
                            step={0.05}
                            clearable
                            ph="0.65"
                            onCommit={n => patchAmmo(pa.id, next => {
                              next.verticalLaunch ??= { enabled: true }
                              if (n === undefined) delete next.verticalLaunch.duration
                              else next.verticalLaunch.duration = Math.max(0.05, n)
                            })}
                          />
                        </label>
                      )}
                    </div>
                  </section>
                )}
                <section className={ammoSectionClass}>
                  <div className="text-[10px] font-black text-black/70 mb-1">音效</div>
                  <div className={ammoGridClass}>
                    {([['flight', '飞行'], ['impact', '命中'], ['ricochet', '跳弹'], ['explosion', '爆炸'], ...(pa.kind === 'ray' ? [['continuous', '持续'] as const] : [])] as const).map(([key, label]) => <label key={key} className={`${ammoFieldClass} text-[9px] font-bold`}><span className={ammoTipClass}>{label}</span><SoundAssetSelect ariaLabel={`弹丸${label}音效`} channel="weapon" loop={key === 'flight' || key === 'continuous'} value={pa.sounds?.[key]} onChange={value => { const sounds = { ...(pa.sounds ?? {}) }; if (value) sounds[key] = value; else delete sounds[key]; pa.sounds = sounds; bump() }} /></label>)}
                  </div>
                </section>
                {pa.kind !== 'ray' && fxGroup(pa, 'trail', '尾焰', '先选尾焰模板，再按需覆盖参数；数值留空时使用模板默认值。', [ // v2.8：射线（hitscan 无弹道飞行）不提供尾焰编辑

            ['速率(粒/s)', 'rate', 10], ['寿命(s)', 'life', 0.05], ['尺寸(格)', 'size', 0.02],
            ['惯性(0-1)', 'inherit', 0.05], ['散开(弧度)', 'spread', 0.1], ['尺寸变化', 'grow', 0.5], ['淡入(s)', 'fadeIn', 0.05],
          ], fx => (
            <>
              <label className={ammoFieldClass}>
                <TipLabel text="模板" tip="标准尾焰适合常规火箭；惯性尾焰强调转弯甩尾；脉冲尾焰有节奏地明暗变化；烟雾尾迹寿命更长且逐渐扩散。数值留空=模板默认。" className={ammoTipClass} />
                <select
                  className="flex-1 min-w-0 px-0.5 py-0.5 text-[9px] font-comic border-2 border-black bg-[#EFEBD8]"
                  value={(fx.template as string) ?? 'standard'}
                  onChange={e => {
                    if (e.target.value === 'standard') delete fx.template
                    else fx.template = e.target.value
                    bump() // 切换模板即时反映（数值留空=模板默认）
                  }}
                >
                  <option value="standard">标准尾焰</option>
                  <option value="inertia">惯性尾焰</option>
                  <option value="pulse">脉冲尾焰</option>
                  <option value="smoke">烟雾尾迹</option>
                </select>
              </label>
              <label className={ammoFieldClass}>
                <TipLabel text="渐变色" tip="粒子寿命内从主色渐变到该色；无=仅亮度渐隐不变色" className={ammoTipClass} />
                <input
                  type="color"
                  className="w-8 h-5 border border-black bg-[#EFEBD8]"
                  value={(fx.colorEnd as string) ?? PROJECTILE_KIND_COLOR[pa.kind]}
                  onChange={e => { fx.colorEnd = e.target.value; bump() }}
                />
                <button className="text-[8px] text-black/40" onClick={() => { delete fx.colorEnd; bump() }}>无</button>
              </label>
            </>
          ), fx => ( // v2.28：烟尾子组移到尾焰组最下面（fxGroup 底部槽）
            <>
              {(() => { // v2.21 烟尾子组：长存留烟雾尾迹（与主尾焰并行；时长 ≤ 引用炮塔燃烧时间；扩散后逐渐消失）
                const sm = fx.smoke as Record<string, unknown> | undefined
                return (
                  <section className="col-span-2 lg:col-span-4 mt-1 border-t-2 border-black/25 pt-1">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <TipLabel text="烟尾" tip="长存留烟雾尾迹：与主尾焰并行的第二股粒子流（非加法烟团，前 40% 寿命膨胀扩散、之后冻结渐隐）" className="text-[10px] font-black text-black/70" />
                      {sm ? (
                        <button className="text-[9px] text-[#B3392E]" onClick={() => { delete fx.smoke; bump() }}>删除烟尾</button>
                      ) : (
                        <button className="text-[9px] text-[#2E63B8]" onClick={() => { fx.smoke = {}; bump() }}>+ 添加烟尾</button>
                      )}
                    </div>
                    {sm && (
                      <div className={ammoGridClass}>
                        <label className={ammoFieldClass}>
                          <TipLabel text="寿命(s)" tip="单粒烟团寿命（秒，缺省 3）——烟团存活多久" className={ammoTipClass} />
                          <FieldNumInput v={sm.life as number | undefined} step={0.5} clearable ph="3" onCommit={n => { if (n === undefined) delete sm.life; else sm.life = n; bump() }} />
                        </label>
                        <label className={ammoFieldClass}>
                          <TipLabel text="持续(s)" tip="点火后烟尾喷射窗口（秒）：结束即停喷（已有烟团自然消散）；超过引用炮塔燃烧时间时按燃烧时间钳制；缺省=整个燃烧期" className={ammoTipClass} />
                          <FieldNumInput v={sm.duration as number | undefined} step={0.5} clearable ph="整个燃烧期" onCommit={n => { if (n === undefined) delete sm.duration; else sm.duration = n; bump() }} />
                        </label>
                        <label className={ammoFieldClass}>
                          <TipLabel text="速率" tip="烟团发射速率（粒/秒，缺省 20）" className={ammoTipClass} />
                          <FieldNumInput v={sm.rate as number | undefined} step={5} clearable ph="20" onCommit={n => { if (n === undefined) delete sm.rate; else sm.rate = n; bump() }} />
                        </label>
                        <label className={ammoFieldClass}>
                          <TipLabel text="颜色" tip="烟团颜色（缺省浅灰 #9A958E）" className={ammoTipClass} />
                          <input
                            type="color"
                            className="w-8 h-5 border border-black bg-[#EFEBD8]"
                            value={(sm.color as string) ?? '#9A958E'}
                            onChange={e => { sm.color = e.target.value; bump() }}
                          />
                          <button className="text-[8px] text-black/40" onClick={() => { delete sm.color; bump() }}>默认</button>
                        </label>
                      </div>
                    )}
                  </section>
                )
              })()}
            </>
          ))}
                {pa.kind !== 'ray' && fxGroup(pa, 'explosion', '爆炸', '小型、中型、大型模板会同步改变视觉尺寸、粒子数量、冲击环和闪光强度；不改变伤害与爆炸判定半径。', [['视觉尺寸', 'visualScale', 0.1], ['底闪(s)', 'duration', 0.05], ['火花数', 'sparks', 1], ['烟尘数', 'smoke', 1], ['环数(1-4)', 'rings', 1], ['环速', 'ringSpeed', 0.2], ['环厚(px)', 'ringWidth', 0.5], ['湍流(0-2)', 'turbulence', 0.1], ['速度抖动', 'speedJitter', 0.1], ['寿命抖动', 'lifeJitter', 0.1], ['方向偏置', 'bias', 0.05], ['速度继承', 'inherit', 0.05], ['火球(0-2)', 'fireball', 0.1], ['软边环(0-2)', 'shock', 0.1], ['照明(0-1)', 'flash', 0.05], ['拉丝(0/1)', 'streak', 1]], (fx, patchFx) => (
                  <label className={ammoFieldClass}>
                    <TipLabel text="模板" tip="小型：紧凑、粒子较少；中型：标准规模；大型：范围更大、火花烟尘更多、冲击环和闪光更强。" className={ammoTipClass} />
                    <select className="flex-1 min-w-0 px-0.5 py-0.5 text-[9px] font-comic border-2 border-black bg-[#EFEBD8]" value={(fx.template as string) ?? 'medium'} onChange={e => patchFx(next => { if (e.target.value === 'medium') delete next.template; else next.template = e.target.value })}>
                      <option value="small">小型爆炸</option>
                      <option value="medium">中型爆炸</option>
                      <option value="large">大型爆炸</option>
                    </select>
                  </label>
                ))}
                {pa.kind === 'ray' && ( // v2.8：光束表现板块（仅射线类条目；从炮塔编辑器迁入，战场/预览经 beamArtConfig 同步）
                  <div className="mt-1 border-t border-black/15 pt-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold text-black/70">光束表现</span>
                      {pa.beam ? (
                        <button className="text-[9px] text-[#B3392E]" onClick={() => patchAmmo(pa.id, next => { delete next.beam })}>删除该组（恢复默认搭配）</button>
                      ) : (
                        <button className="text-[9px] text-[#2E63B8]" onClick={() => patchAmmo(pa.id, next => { next.beam = {} })}>+ 添加光束表现</button>
                      )}
                    </div>
                    <div className="text-[8px] text-black/40">射线类炮塔经「光束(弹丸)」引用本条目后生效：光晕+亮芯贴图沿光束平铺滚动、加法发光、亮度闪烁；命中闪光/炮口光球缺省 glow16.png；「无」= 该层程序化矩形/不显示</div>
                    {pa.beam && (() => {
                      const beamSel = (key: 'glowAsset' | 'coreAsset' | 'impactAsset' | 'muzzleAsset', label: string, defText: string, noneText: string, tip: string, cat: AssetCategory = 'projectile') => {
                        const { groups, mismatch } = assetSelectGroups(cat, pa.beam?.[key])
                        return (
                          <label key={key} className="flex items-center gap-1 min-w-0">
                            <TipLabel text={label} tip={tip} className="text-[9px] font-bold text-black/60 shrink-0 w-9" />
                            <span className="flex-1 min-w-0">
                              <select
                                className="w-full min-w-0 px-0.5 py-0 text-[9px] font-comic border-2 border-black bg-[#EFEBD8]"
                                value={pa.beam?.[key] ?? ''}
                                onChange={e => {
                                  if (!pa.beam) return
                                  if (e.target.value) pa.beam[key] = e.target.value
                                  else delete pa.beam[key]
                                  bump()
                                }}
                              >
                                <option value="">{defText}</option>
                                <option value="none">{noneText}</option>
                                {groups.map(([g, items]) => items.length > 0 && (
                                  <optgroup key={g} label={g}>
                                    {items.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                                  </optgroup>
                                ))}
                              </select>
                              {mismatch && (
                                <div className="text-[8px] font-bold text-[#B98A1D]">引用条目「{mismatch.name}」分类为{ASSET_CATEGORY_NAME[mismatch.category]}，与{ASSET_CATEGORY_NAME[cat]}不符</div>
                              )}
                            </span>
                          </label>
                        )
                      }
                      const beamNum = (label: string, key: 'flicker' | 'scrollSpeed' | 'muzzleScale' | 'impactScale', step: number, ph: string, tip: string, clamp: (n: number) => number) => (
                        <label key={key} className="flex items-center gap-1 min-w-0">
                          <TipLabel text={label} tip={tip} className="text-[9px] font-bold text-black/60 shrink-0 w-9" />
                          <FieldNumInput
                            v={pa.beam?.[key]}
                            step={step}
                            clearable
                            ph={pa.beam?.[key] === undefined ? ph : undefined}
                            onCommit={n => {
                              if (!pa.beam) return
                              if (n === undefined) delete pa.beam[key]
                              else pa.beam[key] = clamp(n)
                              bump()
                            }}
                          />
                        </label>
                      )
                      return (
                        <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 mt-0.5">
                          {beamSel('coreAsset', '亮芯层', '默认（beam_coreA）', '无（程序化矩形）', '光束亮芯层贴图（光束分类 /res/beam/，128×32 原尺寸横向平铺不缩放）；染色=亮芯色；缺省 beam_coreA；「无」回退旧版纯色矩形', 'beam')}
                          {beamSel('glowAsset', '光晕层', '默认（beam_glowA）', '无（程序化矩形）', '光束光晕层贴图（光束分类 /res/beam/，128×32 原尺寸横向平铺不缩放）；染色=光晕色；缺省 beam_glowA；「无」回退旧版纯色矩形', 'beam')}
                          {beamSel('muzzleAsset', '炮口闪光', '默认（glow16.png）', '无（不显示）', '持续光束发射期间炮口光球贴图（效果分类）；缺省 /res/fx/glow16.png；「无」不显示（点射不适用）', 'flash')}
                          {beamSel('impactAsset', '命中闪光', '默认（glow16.png）', '无（不显示）', '命中点闪光贴图（效果分类）：光束端点/点射命中点，加法发光高频脉动；缺省 /res/fx/glow16.png；「无」不显示', 'flash')}
                          {([['fringeColor', '光晕色', '#78C8DC'], ['coreColor', '亮芯色', '#F0FAFF']] as const).map(([key, label, dft]) => (
                            <label key={key} className="flex items-center gap-1">
                              <TipLabel text={label} tip={`${label}：贴图染色/程序化矩形颜色（缺省 ${dft}，与旧版一致）`} className="text-[9px] font-bold text-black/60 w-9 shrink-0" />
                              <input
                                type="color"
                                className="w-8 h-5 border border-black bg-[#EFEBD8]"
                                value={pa.beam?.[key] ?? dft}
                                onChange={e => { if (pa.beam) { pa.beam[key] = e.target.value; bump() } }}
                              />
                              {pa.beam?.[key] !== undefined && (
                                <button className="text-[8px] text-black/40" onClick={() => patchAmmo(pa.id, next => { if (next.beam) delete next.beam[key] })}>默认</button>
                              )}
                            </label>
                          ))}
                          {beamNum('闪烁', 'flicker', 0.05, '0.15', '亮度闪烁幅度 0~1（缺省 0.15；0 = 不闪烁）', n => Math.max(0, Math.min(1, n)))}
                          {beamNum('滚动', 'scrollSpeed', 8, '96', '贴图沿光束方向滚动速度（美术 px/s，按格宽缩放；缺省 96；0 = 静止）', n => Math.max(0, n))}
                          {beamNum('发射缩放', 'muzzleScale', 0.1, '1', '发射点闪光缩放（缺省 1 = 100%）', n => Math.max(0.01, n))}
                          {beamNum('命中缩放', 'impactScale', 0.1, '1', '命中点闪光缩放（缺省 1 = 100%）', n => Math.max(0.01, n))}
                          {([ // v2.10 光束三组粒子子组：组在=生效
                            ['absorb', '吸收粒子', '发射点能量吸收：炮口环带向心汇聚（缺省速率 12 粒/s、颜色=亮芯色、尺寸 0.05 格）', 12, 0.05],
                            ['scatter', '散发粒子', '命中点粒子飞溅（缺省速率 24 粒/s、颜色=光晕色、尺寸 0.05 格）', 24, 0.05],
                            ['smoke', '烟尘', '命中点散发烟尘（不加光，smoke32；缺省速率 6 粒/s、颜色 #3A3632、尺寸 0.1 格）', 6, 0.1],
                          ] as const).map(([key, label, tip, defRate, defSize]) => {
                            const g = pa.beam?.[key]
                            return (
                              <div key={key} className="col-span-2 mt-0.5 border-t border-black/10 pt-0.5">
                                <div className="flex items-center justify-between">
                                  <span className="text-[9px] font-bold text-black/60">{label}</span>
                                  {g ? (
                                    <button className="text-[9px] text-[#B3392E]" onClick={() => { if (pa.beam) { delete pa.beam[key]; bump() } }}>删除</button>
                                  ) : (
                                    <button className="text-[9px] text-[#2E63B8]" onClick={() => { if (pa.beam) { pa.beam[key] = {}; bump() } }}>+ 添加</button>
                                  )}
                                </div>
                                <div className="text-[8px] text-black/40">{tip}</div>
                                {g && (
                                  <div className="grid grid-cols-3 gap-x-2 gap-y-0.5 mt-0.5">
                                    <label className="flex items-center gap-1 min-w-0">
                                      <TipLabel text="速率" tip={`${label}发射速率（粒/秒，缺省 ${defRate}）`} className="text-[9px] font-bold text-black/60 shrink-0 w-6" />
                                      <FieldNumInput
                                        v={g.rate}
                                        step={2}
                                        clearable
                                        ph={g.rate === undefined ? String(defRate) : undefined}
                                        onCommit={n => { if (n === undefined) delete g.rate; else g.rate = Math.max(0, n); bump() }}
                                      />
                                    </label>
                                    <label className="flex items-center gap-1 min-w-0">
                                      <TipLabel text="尺寸" tip={`粒子尺寸（格，缺省 ${defSize}）`} className="text-[9px] font-bold text-black/60 shrink-0 w-6" />
                                      <FieldNumInput
                                        v={g.size}
                                        step={0.01}
                                        clearable
                                        ph={g.size === undefined ? String(defSize) : undefined}
                                        onCommit={n => { if (n === undefined) delete g.size; else g.size = Math.max(0.005, n); bump() }}
                                      />
                                    </label>
                                    <label className="flex items-center gap-1 min-w-0">
                                      <TipLabel text="颜色" tip={`粒子颜色（缺省=${key === 'absorb' ? '亮芯色' : key === 'scatter' ? '光晕色' : '#3A3632'}）`} className="text-[9px] font-bold text-black/60 shrink-0 w-6" />
                                      <input
                                        type="color"
                                        className="w-8 h-5 border border-black bg-[#EFEBD8]"
                                        value={g.color ?? (key === 'absorb' ? (pa.beam?.coreColor ?? '#F0FAFF') : key === 'scatter' ? (pa.beam?.fringeColor ?? '#78C8DC') : '#3A3632')}
                                        onChange={e => { g.color = e.target.value; bump() }}
                                      />
                                      {g.color !== undefined && (
                                        <button className="text-[8px] text-black/40" onClick={() => { delete g.color; bump() }}>默认</button>
                                      )}
                                    </label>
                                    {key === 'scatter' && ( // v2.15：散发角度（仅散射组）+ 电焊拖尾
                                      <label className="flex items-center gap-1 min-w-0">
                                        <TipLabel text="角度" tip="散发角度：以朝射线源方向为 0° 的全锥角——输入 90° = 左右各 45°；缺省 360° 全向。散射粒子带电焊式拖尾" className="text-[9px] font-bold text-black/60 shrink-0 w-6" />
                                        <FieldNumInput
                                          v={(g as { angle?: number }).angle}
                                          step={15}
                                          clearable
                                          ph={(g as { angle?: number }).angle === undefined ? '360' : undefined}
                                          onCommit={n => {
                                            if (n === undefined) delete (g as { angle?: number }).angle
                                            else (g as { angle?: number }).angle = Math.max(0, Math.min(360, n))
                                            bump()
                                          }}
                                        />
                                      </label>
                                    )}
                                  </div>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      )
                    })()}
                  </div>
                )}
                {fxGroup(
                  pa, 'impact', '命中', '粒子实时生成：可调火花/碎屑飞溅 + 中心亮点一闪（非爆炸命中）',
                  [
                    ['闪光(s)', 'duration', 0.01], ['粒子数', 'spikes', 1],
                    ['速度', 'speed', 0.1], ['寿命(s)', 'life', 0.01],
                    ['尺寸', 'size', 0.005], ['阻力', 'drag', 0.1],
                    ['散射°', 'angle', 5], ['偏置', 'bias', 0.05],
                  ],
                  (fx, patchFx) => (
                    <>
                      <label className={ammoFieldClass}>
                        <TipLabel text="模板" tip="子弹：小而短促；穿甲弹：更集中并带高速火花；大型穿甲弹：尺寸、粒子数量和持续时间进一步提高。" className={ammoTipClass} />
                        <select className="flex-1 min-w-0 px-0.5 py-0.5 text-[9px] font-comic border-2 border-black bg-[#EFEBD8]" value={(fx.template as string) ?? 'bullet'} onChange={e => patchFx(next => { if (e.target.value === 'bullet') delete next.template; else next.template = e.target.value })}>
                          <option value="bullet">子弹</option>
                          <option value="armorPiercing">穿甲弹</option>
                          <option value="heavyArmorPiercing">大型穿甲弹</option>
                        </select>
                      </label>
                      <label className={ammoFieldClass}>
                        <TipLabel text="速度拖尾" tip={FX_TIPS.streak} className={ammoTipClass} />
                        <input type="checkbox" checked={((fx.streak as number | undefined) ?? (resolveImpactFx(pa)?.streak ?? 0)) === 1} onChange={e => patchFx(next => { next.streak = e.target.checked ? 1 : 0 })} />
                      </label>
                    </>
                  ),
                )}
              </div>
            )
          })() : (
            <div className="p-6 text-center text-[11px] font-bold text-black/40">← 选择一个弹丸条目</div>
          )}
        </div>
      </div>
    </div>
  )
}

const ALL_WEAPON_TYPES = Object.keys(TYPE_NAME) as WeaponType[]
const BOOST_KEYS = Object.keys(SPECIAL_BOOST_NAME) as SpecialBoost[]
const EFFECT_KIND_KEYS = Object.keys(EFFECT_KIND_NAME) as FortressEffectKind[]

// ================= v2.30 模块编辑器（MODULE_DEFS 注册表直改，bump 落盘 td-module-defs；贴图锚定素材库「模块」分类） =================
const MODULE_BONUS_FIELDS: [keyof ModuleDef, string, number, string][] = [ // [字段, 标签, step, 说明]
  ['energyRegen', '发电(/s)', 1, '电力回复 +点/s'], ['energyCap', '储电上限', 5, '储电上限 +'],
  ['ammoRegen', '弹药(/s)', 0.5, '弹药回复 +发/s'], ['ammoCap', '弹药上限', 5, '弹药储存上限 +'],
  ['cooling', '散热(/s)', 1, '堡垒散热 +点/s（全额叠加不摊薄）'], ['hpBoost', '血量+', 50, '船体血量上限加成'],
  ['speedBoost', '移速+', 0.05, '移动速度加成（格/s，可负）'], ['turnBoost', '转向+', 5, '转向速度加成（度/s，可负）'],
  ['repair', '维修/s', 1, '修复功率池 hp/s（结构、装甲面与受损炮塔共同均摊）'], ['rangeBoost', '射程+', 0.05, '射程增益池（比例，0.5=+50%，均摊）'],
  ['shieldMax', '护盾上限', 10, '护盾容量加成；无发生器时不生效'], ['shieldRegen', '护盾回复', 1, '护盾回复 +点/s；无发生器时不生效'],
  ['shieldEnergyPerPoint', '回复耗电', 0.05, '发生器每回复 1 点护盾消耗的电量'],
]
function ModuleTab({ bump }: { bump: () => void }) {
  const [selectedId, setSelectedId] = useState(MODULE_DEFS[0]?.id ?? '')
  const md = MODULE_DEFS.find(d => d.id === selectedId) ?? null
  const errs: string[] = []
  if (md) {
    if (!md.id.trim() || MODULE_DEFS.some(d => d !== md && d.id === md.id)) errs.push('id 为空或与其他模块重复')
    if (!(md.w >= 1) || !(md.h >= 1)) errs.push('占格 w/h 须 ≥ 1')
    if (!(md.cost >= 0)) errs.push('造价须 ≥ 0')
    if (md.assemblyPoints !== undefined && (!Number.isInteger(md.assemblyPoints) || md.assemblyPoints < 0)) errs.push('装配分须为 ≥0 的整数')
    if (md.maxCount !== undefined && (!Number.isInteger(md.maxCount) || md.maxCount < 1)) errs.push('数量上限须为 ≥1 的整数，或留空表示不限')
    if (md.produce && (!(md.produce.interval > 0) || !(md.produce.cap >= 1))) errs.push('生产周期须 >0 且存活上限 ≥ 1')
    if ((md.shieldMax ?? 0) < 0 || (md.shieldRegen ?? 0) < 0 || (md.shieldEnergyPerPoint ?? 0) < 0) errs.push('护盾上限/回复/耗电不得为负')
    if (md.shieldGenerator && (!(md.shieldMax! > 0) || !(md.shieldRegen! > 0))) errs.push('护盾发生器须配置正数的护盾上限与回复速度')
  }
  // v2.32：id 全自动（唯一兜底），编辑器不再提供 id 输入框
  const genId = (base: string) => {
    let id = base
    while (MODULE_DEFS.some(d => d.id === id)) id += 'x'
    return id
  }
  const patchModule = (change: (next: ModuleDef) => void) => {
    const index = MODULE_DEFS.findIndex(definition => definition.id === selectedId)
    if (index < 0) return
    const next = structuredClone(MODULE_DEFS[index])
    change(next)
    MODULE_DEFS.splice(index, 1, next)
    bump()
  }
  const createNew = () => {
    const d: ModuleDef = { id: genId('mod_custom'), name: '新模块', desc: '', cost: 100, assemblyPoints: 2, effectTarget: 'controller', w: 1, h: 1, color: '#8A8E86' }
    MODULE_DEFS.push(d)
    setSelectedId(d.id)
    bump()
  }
  const copyOne = () => {
    if (!md) return
    const d = structuredClone(md)
    d.id = genId(`${md.id}_copy`)
    d.name = `${md.name}·副本`
    MODULE_DEFS.push(d)
    setSelectedId(d.id)
    bump()
  }
  const removeOne = () => {
    const i = MODULE_DEFS.findIndex(d => d.id === selectedId)
    if (i >= 0) MODULE_DEFS.splice(i, 1)
    setSelectedId(MODULE_DEFS[0]?.id ?? '')
    bump()
  }
  const moduleAssets = filterAssets('module')
  const producibleUnits = unitLibrary().filter(unit => unit.legacy?.registry !== 'fortress' && unit.type !== 'building')
  const assetEntry = md?.asset ? getAsset(md.asset) : undefined
  const req = (label: string, key: 'cost', step: number) => md && (
    <label className="flex items-center gap-1" key={key}>
      <TipLabel text={label} tip="建造造价（资源，≥0）" className="text-[9px] font-bold text-black/60 w-12 shrink-0" />
      <FieldNumInput v={md[key]} step={step} onCommit={n => {
        if (n === undefined) return
        patchModule(next => { next.cost = n })
      }} />
    </label>
  )
  // v2.32 占格铺格：底格固定 5×5，占格按包围盒居中显示；点击切换后重算包围盒并归一化 shape（w/h 派生只读）
  // （遗留兼容：v2.31 期持久化的 w/h>5 模块，画布临时放大到能容下包围盒，编辑收缩后回 5×5）
  const GRID5 = 5
  const GRID = md ? Math.max(GRID5, md.w, md.h) : GRID5
  const offX = md ? Math.floor((GRID - md.w) / 2) : 0
  const offY = md ? Math.floor((GRID - md.h) / 2) : 0
  const cellOn = (gx: number, gy: number) => {
    if (!md) return false
    const x = gx - offX, y = gy - offY
    if (x < 0 || y < 0 || x >= md.w || y >= md.h) return false
    return md.shape ? md.shape.includes(`${x},${y}`) : true
  }
  const toggleCell = (gx: number, gy: number) => {
    if (!md) return
    const on = new Set<string>()
    for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) if (cellOn(x, y)) on.add(`${x},${y}`)
    const k = `${gx},${gy}`
    if (on.has(k)) {
      if (on.size === 1) return // 至少保留 1 格
      on.delete(k)
    } else {
      on.add(k)
    }
    let minX = GRID, minY = GRID, maxX = -1, maxY = -1
    for (const c of on) {
      const [x, y] = c.split(',').map(Number)
      minX = Math.min(minX, x); minY = Math.min(minY, y)
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y)
    }
    const width = maxX - minX + 1
    const height = maxY - minY + 1
    const norm = [...on].map(c => {
      const [x, y] = c.split(',').map(Number)
      return `${x - minX},${y - minY}`
    })
    patchModule(next => {
      next.w = width
      next.h = height
      if (norm.length === width * height) delete next.shape
      else next.shape = norm
    })
  }
  const shapeConnWarn = (() => {
    if (!md?.shape) return null
    const set = new Set(md.shape)
    const first = md.shape[0]
    if (!first) return null
    const seen = new Set([first])
    const q = [first]
    while (q.length > 0) {
      const [cx, cy] = q.pop()!.split(',').map(Number)
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const k = `${cx + dx},${cy + dy}`
        if (set.has(k) && !seen.has(k)) { seen.add(k); q.push(k) }
      }
    }
    return seen.size < set.size ? '占格不连通（仅提示：允许但建议四连通）' : null
  })()
  return (
    <div className="flex-1 min-h-0 flex gap-2">
      {/* 左：模块列表 */}
      <div className="w-40 shrink-0 border-2 border-black bg-[#D2CCA9] p-1 flex flex-col gap-0.5 overflow-y-auto">
        {MODULE_DEFS.map(d => (
          <button
            key={d.id}
            onClick={() => setSelectedId(d.id)}
            className={`px-1 py-0.5 text-left text-[10px] font-comic border border-black/30 ${d.id === selectedId ? 'bg-[#B3392E] text-[#EFEBD8]' : 'hover:bg-black/10'}`}
          >
            <span className="inline-block w-2.5 h-2.5 mr-1 border border-black/40 align-middle" style={{ background: d.color }} />
            {d.name}<span className="block text-[8px] opacity-60">{d.id} · {d.w}×{d.h}{d.maxCount !== undefined ? ` · 上限${d.maxCount}` : ''}</span>
          </button>
        ))}
        <div className="flex gap-1 mt-1">
          <button className="comic-btn px-1.5 py-0.5 text-[10px] flex items-center gap-0.5" onClick={createNew}><Plus className="w-3 h-3" />新建</button>
          <button className="comic-btn px-1.5 py-0.5 text-[10px]" disabled={!md} onClick={copyOne}>复制</button>
        </div>
        <button className="comic-btn px-1.5 py-0.5 text-[10px] mt-0.5" onClick={() => { resetModuleDefsToFactory(); setSelectedId(MODULE_DEFS[0]?.id ?? ''); bump() }}>全部恢复出厂</button>
      </div>
      {/* 右：参数表单 */}
      <div className="flex-1 min-w-0 border-2 border-black bg-[#D2CCA9] p-1.5 overflow-y-auto">
        {!md ? <div className="text-[10px] text-black/50">左侧选择或新建模块</div> : (
          <div className="flex flex-col gap-1.5">
            {errs.length > 0 && <div className="text-[10px] font-bold text-[#B3392E]">{'\u26a0'}{errs.join('；')}</div>}
            <div className="flex flex-wrap gap-x-3 gap-y-1 items-center">
              <label className="flex items-center gap-1">
                <TipLabel text="id" tip="唯一标识（v2.32 起自动生成，不可编辑）" className="text-[9px] font-bold text-black/60 w-12 shrink-0" />
                <span className="text-[10px] font-comic text-black/55">{md.id}</span>
              </label>
              <label className="flex items-center gap-1">
                <TipLabel text="名称" className="text-[9px] font-bold text-black/60 w-12 shrink-0" />
                <input value={md.name} onChange={e => patchModule(next => { next.name = e.target.value })} className="w-28 px-1 py-0.5 text-[10px] font-comic border-2 border-black bg-[#EFEBD8]" />
              </label>
              {req('造价', 'cost', 10)}
              <label className="flex items-center gap-1">
                <TipLabel text="装配分" tip="战斗整备时占用的装配分（≥0）；关卡限制炮塔与模块的装配分总和" className="text-[9px] font-bold text-black/60 w-12 shrink-0" />
                <FieldNumInput v={moduleAssemblyPoints(md)} step={1} onCommit={n => {
                  if (n === undefined) return
                  patchModule(next => { next.assemblyPoints = Math.max(0, Math.round(n)) })
                }} />
              </label>
              <label className="flex items-center gap-1">
                <TipLabel text="数量上限" tip="同一种模块最多可装多少个；留空表示不限" className="text-[9px] font-bold text-black/60 w-12 shrink-0" />
                <FieldNumInput v={md.maxCount} step={1} clearable onCommit={n => {
                  patchModule(next => { next.maxCount = n === undefined ? undefined : Math.max(1, Math.floor(n)) })
                }} />
              </label>
              <label className="flex items-center gap-1">
                <TipLabel text="作用对象" tip="主控：只影响当前玩家控制的单位。玩家阵营：同时影响主控和本关所有玩家阵营单位；旧模块默认按玩家阵营兼容。" className="text-[9px] font-bold text-black/60 w-12 shrink-0" />
                <select aria-label="模块效果作用对象" value={md.effectTarget ?? 'playerFaction'} onChange={event => patchModule(next => { next.effectTarget = event.target.value as NonNullable<ModuleDef['effectTarget']> })} className="h-6 px-1 text-[10px] font-comic border-2 border-black bg-[#EFEBD8]">
                  <option value="controller">主控</option>
                  <option value="playerFaction">玩家阵营</option>
                </select>
              </label>
              <span className="text-[9px] text-black/55 self-center">包围盒 {md.w}×{md.h}（铺格自动）</span>
              <label className="flex items-center gap-1">
                <TipLabel text="颜色" tip="无贴图时的色块颜色（建造卡片也用）" className="text-[9px] font-bold text-black/60 w-12 shrink-0" />
                <input type="color" value={md.color} onChange={e => patchModule(next => { next.color = e.target.value })} className="w-8 h-5 border border-black bg-[#EFEBD8]" />
              </label>
            </div>
            <label className="flex items-center gap-1">
              <TipLabel text="描述" className="text-[9px] font-bold text-black/60 w-12 shrink-0" />
              <input value={md.desc} onChange={e => patchModule(next => { next.desc = e.target.value })} className="flex-1 px-1 py-0.5 text-[10px] font-comic border-2 border-black bg-[#EFEBD8]" />
            </label>
            {/* 贴图锚定（素材库「模块」分类） */}
            <div className="flex items-center gap-1.5 border-t border-black/15 pt-1">
              <TipLabel text="贴图" tip="模块贴图：锚定素材库「模块」分类条目（素材库页签上传时选模块分类）；无=色块+名称回退。局内按占格拉伸、随模块旋向" className="text-[9px] font-bold text-black/60 w-12 shrink-0" />
              <select
                className="px-0.5 py-0.5 text-[10px] font-comic border-2 border-black bg-[#EFEBD8]"
                value={md.asset ?? ''}
                onChange={e => patchModule(next => { if (e.target.value) next.asset = e.target.value; else delete next.asset })}
              >
                <option value="">无（色块+名称）</option>
                {moduleAssets.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
              {assetEntry && <img src={assetEntry.src} alt="" className="w-8 h-8 object-contain border border-black/40 bg-black/10" />}
              {moduleAssets.length === 0 && <span className="text-[9px] text-black/45">素材库暂无「模块」分类条目，去素材库上传并选模块分类</span>}
            </div>
            {/* v2.32 占格铺格：底格固定 5×5（占格居中），白色=空；包围盒由铺格自动得出 */}
            <div className="border-t border-black/15 pt-1">
              <div className="flex items-center gap-1.5 flex-wrap">
                <TipLabel text="占格铺格" tip="底格固定 5×5：点击格切换占位（彩色=占格，白色=空），占格居中显示。包围盒 w×h 由铺格自动得出（全满包围盒=标准矩形，不存 shape）；挖掉格子即成 L/T 型等异型。局内旋转绕包围盒 90°" className="text-[9px] font-bold text-black/60 w-12 shrink-0" />
                <svg width={GRID * 22} height={GRID * 22} className="border-2 border-black bg-white select-none shrink-0">
                  {Array.from({ length: GRID }, (_, cy) =>
                    Array.from({ length: GRID }, (_, cx) => (
                      <rect
                        key={`${cx},${cy}`}
                        x={cx * 22 + 1} y={cy * 22 + 1} width={20} height={20}
                        fill={cellOn(cx, cy) ? md.color : '#FFFFFF'}
                        stroke="#1A1A18" strokeWidth={1}
                        className="cursor-pointer"
                        onClick={() => toggleCell(cx, cy)}
                      />
                    )),
                  )}
                </svg>
                <button className="comic-btn px-1.5 py-0.5 text-[10px]" disabled={!md.shape} onClick={() => patchModule(next => { delete next.shape })}>填满为矩形</button>
                {md.shape && <span className="text-[9px] text-black/50">异型：{md.shape.length}/{md.w * md.h} 格</span>}
                {shapeConnWarn && <span className="text-[9px] font-bold text-[#B3392E]">{'\u26a0'}{shapeConnWarn}</span>}
                {GRID > GRID5 && <span className="text-[9px] font-bold text-[#B3392E]">{'\u26a0'}遗留模块超出 5×5 底格，点击挖格收缩后自动恢复 5×5</span>}
              </div>
              {(() => {
                const fortress = FORTRESS_DEFS.find(f => f.id === getSelectedFortressId()) ?? DEFAULT_FORTRESS
                const fits = modulePlanningFits(fortress, md)
                const cells = md.shape?.length ?? md.w * md.h
                return <div className="mt-1 p-1 border border-black/30 bg-[#EFEBD8] text-[9px] font-bold text-black/60" aria-label="模块规划参考">
                  规划参考 · 当前出战「{fortress.name}」内部 {fortressInteriorSet(fortress).size} 格 · 本模块占 {cells} 格 · 可放起点：0° {fits.normal} 个 / 90° {fits.rotated} 个
                </div>
              })()}
            </div>
            {/* 加成字段（留空=无此加成） */}
            <div className="border-t border-black/15 pt-1">
              <div className="mb-1 flex items-center gap-3 text-[9px] font-bold text-black/60">
                <span>单位类型限制</span>
                {([['vehicle', '载具'], ['fortress', '堡垒']] as const).map(([type, label]) => {
                  const selected = md.allowedUnitTypes ?? ['vehicle', 'fortress']
                  return <label key={type} className="flex items-center gap-1"><input type="checkbox" checked={selected.includes(type)} onChange={event => patchModule(next => { const current = next.allowedUnitTypes ?? ['vehicle', 'fortress']; const updated = event.target.checked ? [...new Set([...current, type])] : current.filter(item => item !== type); next.allowedUnitTypes = updated.length === 2 ? undefined : updated })} />{label}</label>
                })}
              </div>
              <div className="text-[9px] font-bold text-black/50 mb-0.5">加成（留空 = 无此项）：</div>
              <label className="flex items-center gap-1 mb-1 text-[9px] font-bold text-black/60">
                <input type="checkbox" checked={md.shieldGenerator ?? false} onChange={e => patchModule(next => { next.shieldGenerator = e.target.checked || undefined })} className="w-3 h-3 accent-[#B3392E]" />
                护盾发生器（勾选后启用全部护盾加成；数量由上方通用上限控制）
              </label>
              <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                {MODULE_BONUS_FIELDS.map(([key, label, step, tip]) => (
                  <label className="flex items-center gap-1" key={key}>
                    <TipLabel text={label} tip={tip} className="text-[9px] font-bold text-black/60 w-12 shrink-0" />
                    <FieldNumInput
                      v={md[key] as number | undefined}
                      step={step}
                      clearable
                      onCommit={n => patchModule(next => { if (n === undefined) delete next[key]; else (next as unknown as Record<string, unknown>)[key] = n })}
                    />
                  </label>
                ))}
              </div>
            </div>
            {/* 生产子组 */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-black/15 pt-1">
              <TipLabel text="生产" tip="周期产出友军单位（兵营/坦克厂/机场）；无 = 非生产模块" className="text-[9px] font-bold text-black/60 w-12 shrink-0" />
              <select
                className="px-0.5 py-0.5 text-[10px] font-comic border-2 border-black bg-[#EFEBD8]"
                aria-label="生产单位"
                value={md.produce ? md.produce.unitDefId ?? allyUnitId(md.produce.kind) : ''}
                onChange={e => {
                  const unit = unitDefById(e.target.value)
                  patchModule(next => {
                    if (unit) next.produce = { kind: allyKindForUnit(unit), unitDefId: unit.id, interval: next.produce?.interval ?? 10, cap: next.produce?.cap ?? 3 }
                    else delete next.produce
                  })
                }}
              >
                <option value="">无</option>
                {producibleUnits.map(unit => <option key={unit.id} value={unit.id}>{unit.name}</option>)}
              </select>
              {md.produce && (<>
                <label className="flex items-center gap-1">
                  <TipLabel text="周期(s)" tip="多少秒产出 1 个" className="text-[9px] font-bold text-black/60 w-12 shrink-0" />
                  <FieldNumInput v={md.produce.interval} step={1} onCommit={n => { if (n !== undefined) patchModule(next => { if (next.produce) next.produce.interval = Math.max(0.5, n) }) }} />
                </label>
                <label className="flex items-center gap-1">
                  <TipLabel text="存活上限" tip="本模块同时存活产出单位上限" className="text-[9px] font-bold text-black/60 w-12 shrink-0" />
                  <FieldNumInput v={md.produce.cap} step={1} onCommit={n => { if (n !== undefined) patchModule(next => { if (next.produce) next.produce.cap = Math.max(1, Math.floor(n)) }) }} />
                </label>
              </>)}
              <button className="comic-btn px-1.5 py-0.5 text-[10px] flex items-center gap-0.5 ml-auto text-[#B3392E]" onClick={removeOne}><Trash2 className="w-3 h-3" />删除模块</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

const UNIT_TYPE_NAME: Record<UnitType, string> = { vehicle: '载具', rotorcraft: '旋翼飞行器', fixedWingAircraft: '固定翼飞行器', building: '建筑' }
type UnitEditorType = 'trackedVehicle' | 'wheeledVehicle' | 'halfTrackedVehicle' | 'hovercraftVehicle' | 'walkerVehicle' | 'rotorcraft' | 'fixedWingAircraft'
const UNIT_EDITOR_TYPE_NAME: Record<UnitEditorType, string> = {
  trackedVehicle: '履带载具', wheeledVehicle: '轮式载具', halfTrackedVehicle: '半履带载具', hovercraftVehicle: '气垫载具', walkerVehicle: '步行机甲', rotorcraft: '旋翼飞行器', fixedWingAircraft: '固定翼飞行器',
}
const UNIT_EDITOR_TYPES = Object.keys(UNIT_EDITOR_TYPE_NAME) as UnitEditorType[]

function unitEditorTypeOf(unit: UnitDef): UnitEditorType | null {
  if (unit.type === 'rotorcraft') return 'rotorcraft'
  if (unit.type === 'fixedWingAircraft') return 'fixedWingAircraft'
  if (unit.type !== 'vehicle') return null // 建筑仅作为旧定义兼容，不进入新建类型选项
  const config = unitTypeConfig(unit)
  if (config?.kind !== 'vehicle') return 'trackedVehicle'
  return config.chassis === 'wheeled' ? 'wheeledVehicle' : config.chassis === 'halfTracked' ? 'halfTrackedVehicle' : config.chassis === 'hovercraft' ? 'hovercraftVehicle' : config.chassis === 'walker' ? 'walkerVehicle' : 'trackedVehicle'
}

function unitEditorTypeName(unit: UnitDef): string {
  const type = unitEditorTypeOf(unit)
  return type ? UNIT_EDITOR_TYPE_NAME[type] : `${UNIT_TYPE_NAME[unit.type]}（旧类型）`
}

function applyUnitEditorType(unit: UnitDef, type: UnitEditorType): void {
  if (type === 'trackedVehicle' || type === 'wheeledVehicle' || type === 'halfTrackedVehicle' || type === 'hovercraftVehicle' || type === 'walkerVehicle') {
    unit.type = 'vehicle'
    const defaults = defaultUnitTypeConfig('vehicle')
    if (!defaults || defaults.kind !== 'vehicle') return
    const existing = unit.typeConfig?.kind === 'vehicle' ? unit.typeConfig : defaults
    unit.typeConfig = { ...existing, chassis: type === 'wheeledVehicle' ? 'wheeled' : type === 'halfTrackedVehicle' ? 'halfTracked' : type === 'hovercraftVehicle' ? 'hovercraft' : type === 'walkerVehicle' ? 'walker' : 'tracked' }
    unit.stats.air = false
    return
  }
  unit.type = type
  unit.typeConfig = defaultUnitTypeConfig(type)
  unit.stats.air = type === 'rotorcraft' || type === 'fixedWingAircraft'
}

/** 将通用单位迁入唯一的载具协议；unitId 保证关卡/生产中的稳定引用不变。 */
function fortressFromUnit(unit: UnitDef, chassis: NonNullable<FortressDef['chassis']>): FortressDef {
  const source = structuredClone(DEFAULT_FORTRESS)
  const config = unit.typeConfig?.kind === 'vehicle' ? unit.typeConfig : defaultUnitTypeConfig('vehicle')
  const w = Math.max(3, Math.ceil(unit.visual?.width ?? unit.stats.size * 2))
  const h = Math.max(4, Math.ceil(unit.visual?.height ?? unit.stats.size * 2))
  source.id = `unit-vehicle:${unit.id}`
  source.unitId = unit.id
  source.explicitUnitTypeOverride = true
  source.unitTargetClasses = structuredClone(unit.targetClasses)
  source.unitReward = unit.stats.reward ?? 40
  source.unitCombat = unit.combat ? structuredClone(unit.combat) : undefined
  source.unitAI = unit.ai ? structuredClone(unit.ai) : undefined
  source.unitBoss = unit.boss ? structuredClone(unit.boss) : undefined
  source.bodyLocked = unit.bodyLocked === true || undefined
  source.name = unit.name
  source.sounds = unit.sounds ? structuredClone(unit.sounds) : undefined
  source.w = w
  source.h = h
  source.shape = Array.from({ length: w * h }, (_, index) => `${index % w},${Math.floor(index / w)}`)
  source.interior = { cols: w, rows: h }
  source.interiorCells = undefined
  source.interiorSpecials = undefined
  source.spriteBody = unit.visual?.bodyAsset
  source.destructionEffect = unit.visual?.destructionEffect
  source.paint = undefined
  source.decals = undefined
  source.effects = undefined
  source.hardpoints = []
  source.hp = unit.stats.hp
  source.vision = unit.stats.vision ?? 8
  source.speed = unit.stats.speed
  source.color = VEHICLE_PLACEHOLDER_COLOR
  source.chassis = chassis
  source.armor = config?.kind === 'vehicle' ? structuredClone(config.armor) : { front: 0, rear: 0, left: 0, right: 0 }
  source.accel = config?.kind === 'vehicle' ? config.accel : 3
  source.turnSpeed = config?.kind === 'vehicle' ? config.turnSpeed : 25
  source.turnRadius = config?.kind === 'vehicle' ? config.turnRadius : 0
  source.reverseFactor = config?.kind === 'vehicle' ? config.reverseFactor : 0.8
  source.brakeInertia = config?.kind === 'vehicle' ? config.brakeInertia : 5
  source.trackWidth = config?.kind === 'vehicle' ? config.trackWidth : Math.max(1, w - 1)
  source.turnDrag = config?.kind === 'vehicle' ? config.turnDrag : 0
  source.wheelbase = config?.kind === 'vehicle' ? config.wheelbase : Math.max(1, h - 1.5)
  source.steerMax = config?.kind === 'vehicle' ? config.steerMax : 35
  source.steerRate = config?.kind === 'vehicle' ? config.steerRate : 120
  source.gripMax = config?.kind === 'vehicle' ? config.gripMax : 1.024
  source.hoverDrag = config?.kind === 'vehicle' ? config.hoverDrag : 0.35
  source.hoverGrip = config?.kind === 'vehicle' ? config.hoverGrip : 0.8
  source.walkerStride = config?.kind === 'vehicle' ? config.walkerStride : 1
  source.runningGearCoordinateSpace = 'centered'
  source.tracks = chassis === 'tracked' || chassis === 'halfTracked' ? [{ id: 'trackL', x1: 0.45 - w / 2, y1: chassis === 'halfTracked' ? 0.3 : h / 2 - 0.65, x2: 0.45 - w / 2, y2: 0.65 - h / 2, radius: 0.45, tile: 'builtin:library/track01', overlapPx: 2 }] : undefined
  source.wheels = chassis === 'wheeled' || chassis === 'halfTracked' ? [
    { id: 'wheelFront', x: 0.45 - w / 2, y: h / 2 - 0.85, unit: 'pair', sprite: 'builtin:vehicle/jeep/wheel', frames: 4, steered: true },
    ...(chassis === 'wheeled' ? [{ id: 'wheelRear', x: 0.45 - w / 2, y: 0.85 - h / 2, unit: 'pair' as const, sprite: 'builtin:vehicle/jeep/wheel', frames: 4, steered: false }] : []),
  ] : undefined
  return source
}

function unitFromFortress(unit: UnitDef, fortress: FortressDef, type: 'rotorcraft' | 'fixedWingAircraft'): UnitDef {
  const next = structuredClone(unit)
  delete next.legacy
  next.type = type
  next.typeConfig = defaultUnitTypeConfig(type)
  next.name = fortress.name
  next.bodyLocked = fortress.bodyLocked === true || undefined
  next.stats = {
    ...next.stats,
    hp: fortress.hp,
    speed: fortress.speed,
    size: Math.max(0.05, Math.max(fortress.w, fortress.h) / 2),
    collisionRadiusX: Math.max(0.05, fortress.w / 2),
    collisionRadiusY: Math.max(0.05, fortress.h / 2),
    air: type === 'rotorcraft' || type === 'fixedWingAircraft',
  }
  next.visual = {
    ...next.visual,
    bodyAsset: fortress.spriteBody,
    width: fortress.w,
    height: fortress.h,
    destructionEffect: fortress.destructionEffect,
  }
  return next
}

/** 飞行器使用与地面载具相同的完整平台外观/碰撞协议，仅把飞行方式保留为专属参数。 */
function aircraftPlatformFromUnit(unit: UnitDef): FortressDef {
  const type = unit.type === 'fixedWingAircraft' ? 'fixedWingAircraft' : 'rotorcraft'
  const config = unitTypeConfig(unit)
  const source = unit.vehiclePlatform
    ? structuredClone(unit.vehiclePlatform)
    : fortressFromUnit(unit, 'hovercraft')
  source.id = `unit-platform:${unit.id}`
  source.unitId = unit.id
  source.name = unit.name
  source.platformType = type
  // 飞行平台不运行任何地面底盘组件；hovercraft 仅作为旧 FortressDef 校验的无行走部件兼容值。
  source.chassis = 'hovercraft'
  source.explicitUnitTypeOverride = true
  source.spriteBody = unit.visual?.bodyAsset ?? source.spriteBody
  source.destructionEffect = unit.visual?.destructionEffect ?? source.destructionEffect
  source.hp = unit.stats.hp
  source.speed = unit.stats.speed
  source.vision = unit.stats.vision ?? source.vision ?? 8
  source.trackingVision = unit.stats.trackingVision ?? source.trackingVision ?? source.vision * 1.5
  source.unitReward = unit.stats.reward ?? source.unitReward ?? 40
  source.unitTargetClasses = structuredClone(unit.targetClasses)
  source.unitCombat = unit.combat ? structuredClone(unit.combat) : undefined
  source.unitAI = unit.ai ? structuredClone(unit.ai) : undefined
  source.unitBoss = unit.boss ? structuredClone(unit.boss) : undefined
  source.bodyLocked = unit.bodyLocked === true || undefined
  source.sounds = unit.sounds ? { movement: unit.sounds.movement } : undefined
  delete source.tracks
  delete source.wheels
  if (config?.kind === 'rotorcraft') {
    source.rotors = structuredClone(config.rotors ?? [])
    source.altitude = config.altitude
    source.minAltitude = config.minAltitude
    source.maxAltitude = config.maxAltitude
    source.climbRate = config.climbRate
    source.accel = config.accel
    source.turnSpeed = config.turnSpeed
  } else if (config?.kind === 'fixedWingAircraft') {
    delete source.rotors
    source.altitude = config.altitude
    source.minAltitude = config.minAltitude
    source.maxAltitude = config.maxAltitude
    source.climbRate = config.climbRate
    source.accel = config.accel
    source.turnSpeed = config.turnSpeed
    source.minFlightSpeed = config.minSpeed
    source.flightTurnRadius = config.turnRadius
  }
  return source
}

function unitFromAircraftPlatform(unit: UnitDef, platform: FortressDef): UnitDef {
  const next = structuredClone(unit)
  const type = platform.platformType === 'fixedWingAircraft' ? 'fixedWingAircraft' : 'rotorcraft'
  const defaults = defaultUnitTypeConfig(type)
  next.type = type
  next.name = platform.name
  next.stats = {
    ...next.stats,
    hp: platform.hp,
    speed: platform.speed,
    reward: platform.unitReward ?? next.stats.reward,
    vision: platform.vision ?? next.stats.vision ?? 8,
    trackingVision: platform.trackingVision ?? next.stats.trackingVision,
    size: Math.max(0.05, Math.max(platform.w, platform.h) / 2),
    collisionRadiusX: Math.max(0.05, platform.w / 2),
    collisionRadiusY: Math.max(0.05, platform.h / 2),
    air: true,
  }
  next.visual = { ...next.visual, bodyAsset: platform.spriteBody, width: platform.w, height: platform.h, destructionEffect: platform.destructionEffect }
  next.targetClasses = structuredClone(platform.unitTargetClasses ?? next.targetClasses)
  next.combat = platform.unitCombat ? structuredClone(platform.unitCombat) : next.combat
  next.ai = platform.unitAI ? normalizeUnitAI(platform.unitAI) : next.ai
  next.boss = platform.unitBoss ? structuredClone(platform.unitBoss) : next.boss
  next.bodyLocked = platform.bodyLocked === true || undefined
  next.sounds = platform.sounds ? { ...next.sounds, ...platform.sounds } : next.sounds
  next.vehiclePlatform = structuredClone(platform)
  if (type === 'rotorcraft' && defaults?.kind === 'rotorcraft') next.typeConfig = {
    ...defaults,
    rotors: structuredClone(platform.rotors ?? []),
    altitude: platform.altitude ?? defaults.altitude,
    minAltitude: platform.minAltitude ?? defaults.minAltitude,
    maxAltitude: platform.maxAltitude ?? defaults.maxAltitude,
    climbRate: platform.climbRate ?? defaults.climbRate,
    accel: platform.accel,
    turnSpeed: platform.turnSpeed,
  }
  if (type === 'fixedWingAircraft' && defaults?.kind === 'fixedWingAircraft') next.typeConfig = {
    ...defaults,
    altitude: platform.altitude ?? defaults.altitude,
    minAltitude: platform.minAltitude ?? defaults.minAltitude,
    maxAltitude: platform.maxAltitude ?? defaults.maxAltitude,
    climbRate: platform.climbRate ?? defaults.climbRate,
    accel: platform.accel,
    turnSpeed: platform.turnSpeed,
    minSpeed: platform.minFlightSpeed ?? defaults.minSpeed,
    turnRadius: platform.flightTurnRadius ?? defaults.turnRadius,
  }
  return next
}
const AI_TARGET_NAME: Record<AIPreferredTarget, string> = { playerControlled: '玩家主控单位', playerFaction: '玩家阵营', allHostile: '所有敌对（不含中立敌对）' }
const AI_POSITION_NAME: Record<AIPositioningProfile, string> = { longestRange: '最远射程', optimalRange: '最优射程', shortestRange: '最近射程' }
const AI_MOVE_NAME: Record<AIMovementProfile, string> = { orbit: '环绕', keepFar: '远离', closeIn: '抵近', stop: '停止', ram: '撞击' }
const AI_SPECIAL_NAME: Record<AISpecialProfile, string> = { none: '无', deployForces: '投送兵力' }
const AI_ATTACK_NAME: Record<AIAttackProfile, string> = { none: '无攻击', melee: '近战', projectile: '直线实弹', hitscan: '即时命中', kamikaze: '自爆', scripted: '脚本' }

type BossActionKind = 'wait' | 'message' | 'reward' | 'unit'
type BossMoveCommand = Extract<LevelUnitCommand, { kind: 'move' }>
type BossAltitudeCommand = Extract<LevelUnitCommand, { kind: 'altitude' }>
type BossHoldCommand = Extract<LevelUnitCommand, { kind: 'hold' }>
type BossAttackCommand = Extract<LevelUnitCommand, { kind: 'attack' }>
type BossAICommand = Extract<LevelUnitCommand, { kind: 'ai' }>
const patchBossMove = (command: LevelUnitCommand, next: Partial<BossMoveCommand>): BossMoveCommand => ({ ...(command.kind === 'move' ? command : { kind: 'move' as const, x: 0, y: 0, speed: 1, wait: true }), ...next })
const patchBossAltitude = (command: LevelUnitCommand, next: Partial<BossAltitudeCommand>): BossAltitudeCommand => ({ ...(command.kind === 'altitude' ? command : { kind: 'altitude' as const, altitude: 1, wait: true }), ...next })
const patchBossHold = (command: LevelUnitCommand, next: Partial<BossHoldCommand>): BossHoldCommand => ({ ...(command.kind === 'hold' ? command : { kind: 'hold' as const, seconds: 1, wait: true }), ...next })
const patchBossAttack = (command: LevelUnitCommand, next: Partial<BossAttackCommand>): BossAttackCommand => ({ ...(command.kind === 'attack' ? command : { kind: 'attack' as const, target: { type: 'player' as const }, seconds: 1, wait: true }), ...next })
const patchBossAI = (command: LevelUnitCommand, next: Partial<BossAICommand>): BossAICommand => ({ ...(command.kind === 'ai' ? command : { kind: 'ai' as const, mode: 'restore' as const }), ...next })
const BOSS_ACTION_NAME: Record<BossActionKind, string> = { wait: '等待', message: '任务提示', reward: '资源奖励', unit: '单位指令' }

function newBossAction(kind: BossActionKind): LevelEventAction {
  if (kind === 'wait') return { type: 'wait', seconds: 1 }
  if (kind === 'message') return { type: 'message', text: 'Boss 进入新阶段！', duration: 3 }
  if (kind === 'reward') return { type: 'reward', gold: 100 }
  return { type: 'unit', selector: { scope: 'source' }, command: { kind: 'ai', mode: 'replace', preferredTarget: 'allHostile', positioning: 'optimalRange', movement: 'stop' } }
}

function BossSequenceEditor({ actions, onChange }: { actions: LevelEventAction[]; onChange: (next: LevelEventAction[]) => void }) {
  const units = unitLibrary()
  const patch = (index: number, action: LevelEventAction) => onChange(actions.map((value, i) => i === index ? action : value))
  return <div className="space-y-1">
    {actions.map((action, index) => <div key={`${action.type}-${index}`} className="border border-black/30 bg-black/[0.03] p-1">
      <div className="flex items-center gap-1 text-[8px] font-black"><span>{index + 1}. {action.type === 'unit' ? '单位指令' : action.type === 'wait' ? '等待' : action.type === 'message' ? '任务提示' : action.type === 'reward' ? '资源奖励' : action.type}</span><button type="button" aria-label="Boss动作上移" className="ml-auto comic-btn px-1 py-0" onClick={() => { if (index === 0) return; const next = [...actions]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; onChange(next) }}>↑</button><button type="button" aria-label="Boss动作下移" className="comic-btn px-1 py-0" onClick={() => { if (index === actions.length - 1) return; const next = [...actions]; [next[index + 1], next[index]] = [next[index], next[index + 1]]; onChange(next) }}>↓</button><button type="button" className="comic-btn px-1 py-0" onClick={() => onChange(actions.filter((_, i) => i !== index))}>删</button></div>
      {action.type === 'wait' && <label className="text-[8px] font-bold">等待秒数 <ValidatedNumberInput aria-label="Boss等待秒数" min={0} step={0.1} className="w-16 px-1 border border-black bg-[#EFEBD8]" value={action.seconds} onChange={event => patch(index, { ...action, seconds: Math.max(0, Number(event.target.value) || 0) })} /></label>}
      {action.type === 'message' && <div className="grid grid-cols-[1fr_60px] gap-1"><input aria-label="Boss任务提示" className="px-1 border border-black bg-[#EFEBD8]" value={action.text} onChange={event => patch(index, { ...action, text: event.target.value })} /><ValidatedNumberInput aria-label="Boss提示秒数" min={0.5} step={0.5} className="px-1 border border-black bg-[#EFEBD8]" value={action.duration} onChange={event => patch(index, { ...action, duration: Math.max(0.5, Number(event.target.value) || 0.5) })} /></div>}
      {action.type === 'reward' && <label className="text-[8px] font-bold">资源 <ValidatedNumberInput aria-label="Boss资源奖励" min={0} className="w-20 px-1 border border-black bg-[#EFEBD8]" value={action.gold} onChange={event => patch(index, { ...action, gold: Math.max(0, Math.round(Number(event.target.value) || 0)) })} /></label>}
      {action.type === 'unit' && <div className="space-y-1 mt-1">
        <div className="grid grid-cols-2 gap-1"><select aria-label="Boss指令目标" className="px-1 border border-black bg-[#EFEBD8]" value={action.selector.scope} onChange={event => patch(index, { ...action, selector: event.target.value === 'unitDef' ? { scope: 'unitDef', unitDefId: units[0]?.id ?? '' } : { scope: event.target.value as 'source' | 'allEnemies' | 'allAllies' } })}><option value="source">当前 Boss</option><option value="unitDef">指定单位定义</option><option value="allEnemies">全部敌人</option><option value="allAllies">全部友军</option></select><select aria-label="Boss单位指令" className="px-1 border border-black bg-[#EFEBD8]" value={action.command.kind} onChange={event => { const kind = event.target.value; const command = kind === 'move' ? { kind: 'move' as const, x: 10, y: 10, speed: 2, wait: true } : kind === 'altitude' ? { kind: 'altitude' as const, altitude: 1, wait: true } : kind === 'hold' ? { kind: 'hold' as const, seconds: 1, wait: true } : kind === 'attack' ? { kind: 'attack' as const, target: 'nearestHostile' as const, seconds: 3, wait: true } : kind === 'ai' ? { kind: 'ai' as const, mode: 'pause' as const } : { kind: 'remove' as const }; patch(index, { ...action, command }) }}><option value="move">移动</option><option value="altitude">飞行高度</option><option value="hold">停留</option><option value="attack">攻击</option><option value="ai">AI 控制</option><option value="remove">移除</option></select></div>
        {action.selector.scope === 'unitDef' && <select aria-label="Boss指定单位定义" className="w-full px-1 border border-black bg-[#EFEBD8]" value={action.selector.unitDefId} onChange={event => patch(index, { ...action, selector: { scope: 'unitDef', unitDefId: event.target.value } })}>{units.map(unit => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select>}
        {action.command.kind === 'move' && <div className="grid grid-cols-4 gap-1"><label>X(px)<ValidatedNumberInput aria-label="Boss移动X（像素）" step={1} className="w-full px-1 border border-black bg-[#EFEBD8]" value={cellsToPixels(action.command.x)} onChange={event => patch(index, { ...action, command: patchBossMove(action.command, { x: pixelsToCells(Number(event.target.value) || 0) }) })} /></label><label>Y(px)<ValidatedNumberInput aria-label="Boss移动Y（像素）" step={1} className="w-full px-1 border border-black bg-[#EFEBD8]" value={cellsToPixels(action.command.y)} onChange={event => patch(index, { ...action, command: patchBossMove(action.command, { y: pixelsToCells(Number(event.target.value) || 0) }) })} /></label><label>速度(m/s)<ValidatedNumberInput aria-label="Boss移动速度（米每秒）" min={0.32} step={0.32} className="w-full px-1 border border-black bg-[#EFEBD8]" value={cellsToMeters(action.command.speed)} onChange={event => patch(index, { ...action, command: patchBossMove(action.command, { speed: Math.max(0.1, metersToCells(Number(event.target.value) || 0.32)) }) })} /></label><label className="self-end"><input type="checkbox" checked={action.command.wait} onChange={event => patch(index, { ...action, command: patchBossMove(action.command, { wait: event.target.checked }) })} />等待</label></div>}
        {action.command.kind === 'altitude' && <div className="flex items-center gap-2"><label>目标高度(m)<ValidatedNumberInput aria-label="Boss目标飞行高度（米）" min={0} max={cellsToMeters(10)} step={0.32} className="ml-1 w-20 px-1 border border-black bg-[#EFEBD8]" value={cellsToMeters(action.command.altitude)} onChange={event => patch(index, { ...action, command: patchBossAltitude(action.command, { altitude: metersToCells(Number(event.target.value) || 0) }) })} /></label><label><input type="checkbox" checked={action.command.wait} onChange={event => patch(index, { ...action, command: patchBossAltitude(action.command, { wait: event.target.checked }) })} />等待到达</label></div>}
        {action.command.kind === 'hold' && <div className="flex gap-2"><label>秒<ValidatedNumberInput aria-label="Boss停留秒数" min={0} step={0.1} className="ml-1 w-16 px-1 border border-black bg-[#EFEBD8]" value={action.command.seconds} onChange={event => patch(index, { ...action, command: patchBossHold(action.command, { seconds: Math.max(0, Number(event.target.value) || 0) }) })} /></label><label><input type="checkbox" checked={action.command.wait} onChange={event => patch(index, { ...action, command: patchBossHold(action.command, { wait: event.target.checked }) })} />等待完成</label></div>}
        {action.command.kind === 'attack' && <div className="grid grid-cols-3 gap-1"><select aria-label="Boss攻击目标" className="px-1 border border-black bg-[#EFEBD8]" value={action.command.target === 'nearestHostile' ? 'nearestHostile' : action.command.target.type} onChange={event => patch(index, { ...action, command: patchBossAttack(action.command, { target: event.target.value === 'nearestHostile' ? 'nearestHostile' : { type: 'player' } }) })}><option value="nearestHostile">最近敌对（旧）</option><option value="player">玩家</option></select><label>秒<ValidatedNumberInput aria-label="Boss攻击秒数" min={0.1} step={0.1} className="w-full px-1 border border-black bg-[#EFEBD8]" value={action.command.seconds} onChange={event => patch(index, { ...action, command: patchBossAttack(action.command, { seconds: Math.max(0.1, Number(event.target.value) || 0.1) }) })} /></label><label className="self-end"><input type="checkbox" checked={action.command.wait} onChange={event => patch(index, { ...action, command: patchBossAttack(action.command, { wait: event.target.checked }) })} />等待</label></div>}
        {action.command.kind === 'ai' && <div className="space-y-1"><select aria-label="BossAI控制" className="w-full px-1 border border-black bg-[#EFEBD8]" value={action.command.mode} onChange={event => patch(index, { ...action, command: event.target.value === 'replace' ? { kind: 'ai', mode: 'replace', preferredTarget: 'allHostile', positioning: 'optimalRange', movement: 'stop' } : { kind: 'ai', mode: event.target.value as 'pause' | 'restore' } })}><option value="pause">暂停 AI</option><option value="restore">恢复原 AI</option><option value="replace">替换 AI</option></select>{action.command.mode === 'replace' && <div className="grid grid-cols-3 gap-1"><select aria-label="Boss替换首选目标" className="px-1 border border-black bg-[#EFEBD8]" value={action.command.preferredTarget ?? 'allHostile'} onChange={event => patch(index, { ...action, command: patchBossAI(action.command, { preferredTarget: event.target.value }) })}>{(Object.keys(AI_TARGET_NAME) as AIPreferredTarget[]).map(value => <option key={value} value={value}>{AI_TARGET_NAME[value]}</option>)}</select><select aria-label="Boss替换站位" className="px-1 border border-black bg-[#EFEBD8]" value={action.command.positioning ?? 'optimalRange'} onChange={event => patch(index, { ...action, command: patchBossAI(action.command, { positioning: event.target.value }) })}>{(Object.keys(AI_POSITION_NAME) as AIPositioningProfile[]).map(value => <option key={value} value={value}>{AI_POSITION_NAME[value]}</option>)}</select><select aria-label="Boss替换移动" className="px-1 border border-black bg-[#EFEBD8]" value={action.command.movement ?? 'stop'} onChange={event => patch(index, { ...action, command: patchBossAI(action.command, { movement: event.target.value }) })}>{(Object.keys(AI_MOVE_NAME) as AIMovementProfile[]).map(value => <option key={value} value={value}>{AI_MOVE_NAME[value]}</option>)}</select></div>}</div>}
      </div>}
    </div>)}
    <select aria-label="新增Boss动作" className="w-full px-1 border border-black bg-[#EFEBD8]" value="" onChange={event => { if (event.target.value) onChange([...actions, newBossAction(event.target.value as BossActionKind)]) }}><option value="">＋ 添加动作…</option>{(Object.keys(BOSS_ACTION_NAME) as BossActionKind[]).map(kind => <option key={kind} value={kind}>{BOSS_ACTION_NAME[kind]}</option>)}</select>
  </div>
}
const UNIT_TARGET_NAME: Record<UnitTargetKind, string> = { fortress: '移动堡垒', coreBuilding: '核心建筑', fixedBuilding: '固定建筑', wall: '防御墙', turret: '炮塔', combatUnit: '战斗单位', object: '场景物体' }

function defaultEditableUnit(): UnitDef {
  const stamp = Date.now()
  return {
    id: `unit:${stamp}`,
    name: `自定义单位 ${unitLibrary().filter(unit => !unit.legacy).length + 1}`,
    type: 'rotorcraft', targetClasses: ['combatUnit'],
    stats: { hp: 100, speed: 1, reward: 18, size: 0.35, air: true },
    visual: { width: 0.7, height: 0.7 },
    combat: { profile: 'projectile', range: 8, interval: 1.5, projectileId: 'bullet_std', damage: 5, projectileSpeed: 51.2, penetration: 3 },
    ai: { preferredTarget: 'playerControlled', positioning: 'longestRange', movement: 'stop', special: { profile: 'none' } },
  }
}

const UNIT_PARAM_TIPS: Record<string, string> = {
  '名称': '单位在关卡、事件、血条与编辑器中的显示名称。',
  '类型': '统一选择履带载具、轮式载具、半履带载具、气垫载具、步行机甲、旋翼飞行器或固定翼飞行器；类型会自动决定底盘、飞行方式与专属参数。',
  '生命': '单位最大生命值；无预设上限，必须大于 0。',
  '击毁奖励': '该单位作为敌对目标被击毁时发放的基础资源；最终奖励仍会乘全局击杀收益倍率。',
  '速度': '单位最高移动速度，单位为米/秒；无预设上限，0 表示不能主动移动。',
  '移动速度': '单位最高移动速度，单位为米/秒；无预设上限，0 表示不能主动移动。',
  '移动音效': '单位移动时使用的循环音效。旋翼飞行器正常飞行时按实际速度调整音量：静止为 10%，速度达到最大速度的 80% 时为 100%，超过后保持满音量；进入坠毁时改为从 100% 开始逐渐衰减。',
  '碰撞设置': '沿画面水平和垂直方向的椭圆碰撞半径，单位为米；两项都必须大于 0。',
  '按素材原尺寸': '按素材单帧的原始像素宽高显示；战场缩放时仍会整体跟随缩放。',
  '中心偏移 X（px）': '素材中心相对单位原点的水平偏移；正数向右。',
  '中心偏移 Y（px）': '素材中心相对单位原点的垂直偏移；正数向下。',
  '开火点 X（px）': '开火点相对单位原点的水平偏移；正数向右、负数向左。',
  '开火点 Y（px）': '开火点相对单位原点的垂直偏移；正数向下、负数向上。',
  '飞行单位': '勾选后单位按空中目标处理，并使用可对空攻击判定。',
  '前装甲': '车头方向装甲值。弹丸穿深不足时可能跳弹；范围 0～10000。',
  '后装甲': '车尾方向装甲值。范围 0～10000。',
  '左装甲': '车体左侧装甲值。范围 0～10000。',
  '右装甲': '车体右侧装甲值。范围 0～10000。',
  '视野': '单位未接战时发现目标的范围，单位为米；同组且非敌对的单位可以共享视野。',
  '追踪视野': '单位接战后继续追踪目标的最大范围，单位为米；目标离开后结束战斗并恢复关卡行为。不得小于索敌视野。',
  '加速度': '单位达到目标速度的快慢，单位为米/秒²；必须大于等于 0。',
  '转向速度（°/s）': '车体横摆角速度上限；必须大于等于 0。',
  '转弯半径': '大于 0 时使用指定弧线半径，单位为米；0 表示按履带差速或轮式转向参数推导。',
  '倒车系数': '倒车极速和加速度相对前进的比例；范围 0～1。',
  '刹停惯性': '数值越高滑行越久；范围 1～10。',
  '履带间距': '左右履带中心的距离，单位为米；影响差速转向角速度，必须大于 0。',
  '履带转向阻力': '转向时降低目标速度的比例；范围 0～0.9。',
  '轴距': '前后轮轴之间的距离，单位为米；影响轮式载具转弯半径，必须大于 0。',
  '最大前轮转角（°）': '轮式载具前轮最大偏转角；范围大于 0 且不超过 90。',
  '方向盘转速（°/s）': '前轮转向和自动回正速度；必须大于 0。',
  '横向附着（m/s²）': '限制高速转向能力，数值越高高速时越容易保持转向角；必须大于 0。',
  '滑行阻力': '气垫载具松开推进后的速度衰减率；数值越小滑行越远。范围 0.05～5/秒。',
  '横向稳定': '气垫载具侧向速度向车头方向收束的速度；数值越小甩尾越明显。范围 0～10/秒。',
  '步幅': '步行机甲单脚完成一组 7 帧动作时前进的距离；动画按照实际移动距离推进。范围 0.16～64 米。',
  '初始飞行高度': '单位生成时的高度，也是未被事件指令修改时的巡航高度。范围 0～32 米，并且必须处于最低与最高高度之间。',
  '最低飞行高度': '事件指令能够设置的最低高度。范围 0～初始高度。',
  '最高飞行高度': '事件指令能够设置的最高高度。范围 初始高度～32 米。',
  '升降速度': '飞行器接近目标高度的垂直速度。范围 (0, 32] 米/秒。',
  '旋翼素材': '动态旋翼使用的透明贴图；按素材原始像素尺寸显示。',
  '旋翼层级': '选择“上”时旋翼绘制在载具主体上方；选择“下”时旋翼先绘制并被载具主体遮挡。',
  '旋翼单位': '单个只在指定坐标绘制一个；一对会使用横坐标绝对值围绕单位中心线左右镜像，并以相反方向旋转。',
  '旋翼坐标（px）': '旋翼中心相对单位几何中心的坐标，单位为素材像素；X 向右、Y 向下。',
  '旋转速度': '旋翼每秒旋转角度；正数顺时针、负数逆时针，0 表示静止。',
  '最低航速': '固定翼飞行器在空中必须保持的最低前进速度，单位为米/秒；必须大于 0 且不能超过移动速度。',
  '最小转弯半径': '固定翼飞行器允许的最小盘旋与转向半径，单位为米；范围大于 0 且不超过 320 米。',
  '阴影比例': '飞行器地面阴影相对主体尺寸的倍率。范围 0.05～3。',
  '占格宽': '建筑阻挡矩形的横向格数。范围 1～12。',
  '占格高': '建筑阻挡矩形的纵向格数。范围 1～12。',
  '阻挡地面移动': '勾选后建筑占格进入寻路障碍；建筑被摧毁后解除。',
  '主体素材': '单位主体使用的素材库贴图；无贴图时使用程序化或旧精灵回退。',
  '摧毁效果': '单位被摧毁时使用的统一视觉模板。小、中、大逐级增加范围与附加粒子；剧烈会播放多重爆炸。所有模板都包含残骸、碎片飞溅和黑色浓烟。',
  '显示宽（m）': '主体贴图显示宽度，单位为米；必须大于 0。',
  '显示高（m）': '主体贴图显示高度，单位为米；必须大于 0。',
  '首选目标': '在所有合法敌人中先搜索哪一类。玩家主控单位在堡垒防御阶段指当前可控堡垒；玩家阵营只指阵营为玩家的单位；所有敌对不会主动选择中立敌对。首选目标不存在时会回退到其他合法敌人。',
  '站位': '根据当前目标可用炮塔自动计算距离带：最远射程为最长射程的 75%～95%（目标 85%）；最近射程为最短射程的 40%～60%（目标 50%）；最优射程选择最多炮塔射程重叠的区间。',
  '移动': '进入战斗后在站位距离带内采用的运动方式。环绕会侧向运动，远离贴近外沿，抵近贴近内沿，停止不主动平移，撞击会直冲可碰撞的地面目标；撞击目标为空中、不可碰撞或车道受阻时临时按停止处理。',
  '攻击': '决定攻击实现方式：实弹、接触、自爆或不攻击。',
  '特殊': '复合型特殊行为。“投送兵力”会驶近目标，双方几何外沿接触后从指定车身方向生成单位。',
  '投送单位': '实际生成的单位模板；生成实例继承运输单位在关卡中的阵营，并使用该模板自己的 AI。',
  '投送总数': '本次共生成多少个单位。范围 1～99；全部生成后运输单位恢复原组合式 AI。',
  '投送间隔（秒）': '相邻两次生成及无空位时重试的间隔。范围 0.1～60 秒。',
  '投送方向': '相对运输载具车头选择投送侧：车前、车后、车左或车右。该侧无合法落点时会停车重试。',
  '射程（m）': '目标进入该距离后允许攻击，单位为米；必须大于等于 0。',
  '引爆距离': '自爆单位距离目标达到该值时主动引爆，单位为米；必须大于等于 0。',
  '攻击间隔（秒）': '两次攻击之间的时间，越小攻击越频繁；必须大于 0。',
  '伤害': '每次攻击造成的基础伤害；必须大于等于 0。',
  '满额伤害': '自爆中心范围内造成的基础满额伤害；必须大于等于 0。',
  '弹速（米/秒）': '直线实弹的飞行速度；必须大于等于 0。',
  '穿深': '敌方弹丸与目标装甲比较时使用的穿透能力；必须大于等于 0。',
  '爆炸半径': '自爆对周围目标结算伤害的半径，单位为米；必须大于 0。',
  '被击毁爆炸': '控制自爆单位被玩家提前击毁时不爆、造成半额或满额爆炸。',
  '弹丸素材': '直线实弹的显示贴图；留空时使用程序化小弹头。',
  'Boss 扩展': '启用名称、倍率、专属血条、生命阶段动作和击败动作。',
  '显示名称': 'Boss 血条和事件中显示的名称。',
  '生命倍率': 'Boss 生成时对单位基础生命的乘数；必须大于 0。',
  '体型倍率': 'Boss 生成时对显示尺寸与碰撞半径的乘数；必须大于 0。',
  '血条颜色': 'Boss 顶部专属生命条颜色。',
  '生命阶段': 'Boss 生命百分比首次跌破阈值时执行对应动作；阈值范围 1%～99%，最多 8 阶段。',
}

const UNIT_PARAM_DISPLAY: Record<string, string> = {
  '移动速度': '移动速度(m/s)',
  '视野': '视野(m)',
  '追踪视野': '追踪视野(m)',
  '加速度': '加速度(m/s²)',
  '转弯半径': '转弯半径(m)',
  '履带间距': '履带间距(m)',
  '轴距': '轴距(m)',
  '碰撞设置': '碰撞设置(m)',
  '初始飞行高度': '初始飞行高度(m)',
  '最低飞行高度': '最低飞行高度(m)',
  '最高飞行高度': '最高飞行高度(m)',
  '升降速度': '升降速度(m/s)',
  '最低航速': '最低航速(m/s)',
  '最小转弯半径': '最小转弯半径(m)',
  '引爆距离': '引爆距离(m)',
  '爆炸半径': '爆炸半径(m)',
}

function UnitParamTip({ text, className }: { text: string; className?: string }) {
  return <TipLabel text={UNIT_PARAM_DISPLAY[text] ?? text} tip={UNIT_PARAM_TIPS[text] ?? `${text}参数。`} className={className} />
}

function UnitTab({ onRestart }: { onRestart: () => void }) {
  const [revision, setRevision] = useState(0)
  const [selectedId, setSelectedId] = useState(() => fortressUnitId(getSelectedFortressId()))
  const [draft, setDraft] = useState<UnitDef | null>(null)
  const [message, setMessage] = useState('')
  const [previewZoom, setPreviewZoom] = useState(100)
  const [unitPreviewAnimation, setUnitPreviewAnimation] = useState<'move' | 'attack' | 'death'>('move')
  void revision
  const units = unitLibrary()
  const selected = units.find(unit => unit.id === selectedId) ?? units[0]
  const current = draft?.id === selected?.id ? draft : selected
  const deployUnitOptions = units.filter(unit => unit.id !== current?.id)
  const deploySpecial = current?.ai?.special?.profile === 'deployForces' ? current.ai.special : null
  const fortressLegacy = current?.legacy?.registry === 'fortress' ? current.legacy : null
  const errors = current ? validateUnitDef(current) : []
  const visual = current?.visual ?? { width: (current?.stats.size ?? 0.35) * 2, height: (current?.stats.size ?? 0.35) * 2 }
  const combat = current?.combat ?? { profile: 'none' as const, range: 8, interval: 1.5, damage: 0, projectileSpeed: 0, penetration: 0 }
  const typeConfig = current ? unitTypeConfig(current) : undefined
  const unitBodyAssets = filterAssets('unitBody')
  // 旋翼与轮胎共用同一素材分类；运行组件仍各自独立，只统一素材入口。
  const rotorAssets = filterAssets('wheel')
  const bodySrc = resolveAssetSrc(visual.bodyAsset)
  const bodyAssetEntry = visual.bodyAsset ? getAsset(visual.bodyAsset) : undefined
  const previewSpriteState: AssetSpriteState = unitPreviewAnimation === 'move' ? 'walk' : unitPreviewAnimation
  const previewSheet = bodyAssetEntry?.spriteSheet
  const previewFrameIndex = previewSheet?.stateFrames[previewSpriteState] ?? 0
  const previewFrameCount = previewSheet ? Math.max(1, ...Object.values(previewSheet.stateFrames).map(value => value + 1)) : 1
  const collision = current ? unitCollisionRadii(current) : { x: 0.35, y: 0.35 }
  const previewBodyWidth = Math.max(2, visual.nativeSize && previewSheet ? previewSheet.frameWidth : visual.width * BASE_CELL)
  const previewBodyHeight = Math.max(2, visual.nativeSize && previewSheet ? previewSheet.frameHeight : visual.height * BASE_CELL)
  const previewBodyTransform = `translate(-50%, -50%) translate(${visual.offsetX ?? 0}px, ${visual.offsetY ?? 0}px)`
  const previewRotors = typeConfig?.kind === 'rotorcraft' ? (typeConfig.rotors ?? []).flatMap(rotor => {
    const src = resolveAssetSrc(rotor.asset)
    return src ? rotorPlacements(rotor).map((placement, index) => ({ ...rotor, ...placement, src, key: `${rotor.id}-${index}` })) : []
  }) : []

  const choose = (id: string) => {
    setSelectedId(id)
    const unit = unitDefById(id)
    setDraft(unit?.legacy?.registry === 'fortress' ? null : unit ? structuredClone(unit) : null)
    setMessage('')
  }
  const mutate = (fn: (next: UnitDef) => void) => {
    setDraft(previous => {
      const base = previous ?? (current ? structuredClone(current) : null)
      if (!base) return previous
      const next = structuredClone(base)
      fn(next)
      return next
    })
  }
  const create = () => {
    const next = defaultEditableUnit()
    saveCustomUnitDef(next)
    setSelectedId(next.id)
    setDraft(structuredClone(next))
    setRevision(value => value + 1)
    setMessage('已新建单位，可编辑通用属性与组合式 AI')
  }
  const copy = () => {
    if (!current) return
    const next = structuredClone(current)
    next.id = `unit:${Date.now()}`
    next.name = `${current.name} 副本`
    delete next.legacy
    saveCustomUnitDef(next)
    setSelectedId(next.id)
    setDraft(structuredClone(next))
    setRevision(value => value + 1)
    setMessage('已复制为独立自定义单位')
  }
  const save = () => {
    if (!draft || errors.length > 0) return
    if (draft.legacy?.registry === 'fortress') {
      if (!saveVehicleUnitDefinition(draft)) {
        setMessage(`⚠载具定义引用失效：${draft.legacy.id}；未保存，也未回退到测试堡垒`)
        return
      }
      setRevision(value => value + 1)
      setDraft(null)
      setMessage(fortressPersistFailed() ? '⚠载具 AI / Boss 已写入内存，但本地存储失败' : '载具 AI / Boss 已保存到唯一载具定义')
      return
    }
    saveCustomUnitDef(draft)
    setRevision(value => value + 1)
    setDraft(structuredClone(draft))
    setMessage(unitLibraryPersistHasFailed() ? '⚠单位已写入内存，但本地存储失败' : '单位定义已保存')
  }
  const removeOrRestore = () => {
    if (!current) return
    const restoringBuiltin = isBuiltinUnitOverridden(current.id)
    if (!restoringBuiltin) {
      const library = levelLibraryForExport()
      removeUnitDefinitionReferences(library, current.id)
      saveLevelLibrary(library)
    }
    if (!deleteCustomUnitDef(current.id)) return
    const next = unitLibrary()[0]
    setSelectedId(next.id)
    setDraft(next.legacy?.registry === 'fortress' ? null : structuredClone(next))
    setRevision(value => value + 1)
    setMessage(isBuiltinUnitId(current.id) ? '已恢复内置单位定义' : '已删除自定义单位')
  }

  const changeEditorType = (type: UnitEditorType) => {
    if (!current) return
    if (type === 'trackedVehicle' || type === 'wheeledVehicle' || type === 'halfTrackedVehicle' || type === 'hovercraftVehicle' || type === 'walkerVehicle') {
      const next = structuredClone(current)
      applyUnitEditorType(next, type)
      const chassis = type === 'wheeledVehicle' ? 'wheeled' : type === 'halfTrackedVehicle' ? 'halfTracked' : type === 'hovercraftVehicle' ? 'hovercraft' : type === 'walkerVehicle' ? 'walker' : 'tracked'
      const fortress = fortressFromUnit(next, chassis)
      saveCustomFortress(fortress)
      deleteCustomUnitDef(current.id)
      setSelectedId(current.id)
      setDraft(null)
      setRevision(value => value + 1)
      setMessage('已切换为载具，外观、碰撞、特效点、履带/轮胎和炮位已迁入完整载具面板')
      return
    }
    mutate(next => { applyUnitEditorType(next, type) })
  }

  const changeFortressType = (type: 'rotorcraft' | 'fixedWingAircraft', fortress: FortressDef) => {
    if (!current || !fortressLegacy) return
    const converted = unitFromFortress(current, fortress, type)
    const platform = aircraftPlatformFromUnit(converted)
    platform.platformType = type
    const next = unitFromAircraftPlatform(converted, platform)
    saveCustomUnitDef(next)
    if (listCustomFortresses().some(item => item.id === fortress.id)) deleteCustomFortress(fortress.id)
    setSelectedId(next.id)
    setDraft(structuredClone(next))
    setRevision(value => value + 1)
    setMessage(`已切换为${type === 'rotorcraft' ? '旋翼飞行器' : '固定翼飞行器'}通用面板`)
  }

  const updateAircraftPlatform = (platform: FortressDef) => {
    if (!current) return
    mutate(next => Object.assign(next, unitFromAircraftPlatform(next, platform)))
  }

  const saveAircraftPlatform = (platform: FortressDef) => {
    if (!current) return
    const next = unitFromAircraftPlatform(current, platform)
    saveCustomUnitDef(next)
    setDraft(structuredClone(next))
    setRevision(value => value + 1)
    setMessage(unitLibraryPersistHasFailed() ? '⚠飞行器平台已写入内存，但本地存储失败' : '飞行器平台与专属参数已保存')
  }

  const changeAircraftToGround = (chassis: NonNullable<FortressDef['chassis']>, platform: FortressDef) => {
    if (!current) return
    const fortress = structuredClone(platform)
    fortress.platformType = 'vehicle'
    fortress.chassis = chassis
    delete fortress.rotors
    delete fortress.altitude
    delete fortress.minAltitude
    delete fortress.maxAltitude
    delete fortress.climbRate
    delete fortress.minFlightSpeed
    delete fortress.flightTurnRadius
    const leftX = 0.45 - fortress.w / 2
    if (chassis === 'tracked') fortress.tracks = fortress.tracks?.length ? fortress.tracks : [{ id: `track1-${Date.now() % 1000}`, x1: leftX, y1: fortress.h / 2 - 0.8, x2: leftX, y2: 0.8 - fortress.h / 2, radius: 0.45, tile: 'builtin:library/track01', overlapPx: 2 }]
    if (chassis === 'wheeled') fortress.wheels = fortress.wheels?.length ? fortress.wheels : [
      { id: `wheel1-${Date.now() % 1000}`, x: leftX, y: fortress.h / 2 - 0.85, unit: 'pair', sprite: 'builtin:vehicle/jeep/wheel', frames: 4, steered: true },
      { id: `wheel2-${Date.now() % 1000}`, x: leftX, y: 0.85 - fortress.h / 2, unit: 'pair', sprite: 'builtin:vehicle/jeep/wheel', frames: 4, steered: false },
    ]
    if (chassis === 'halfTracked') {
      fortress.tracks = fortress.tracks?.length ? fortress.tracks : [{ id: `track1-${Date.now() % 1000}`, x1: leftX, y1: 0.3, x2: leftX, y2: 0.65 - fortress.h / 2, radius: 0.45, tile: 'builtin:library/track01', overlapPx: 2 }]
      fortress.wheels = fortress.wheels?.length ? fortress.wheels : [{ id: `wheel1-${Date.now() % 1000}`, x: leftX, y: fortress.h / 2 - 0.85, unit: 'pair', sprite: 'builtin:vehicle/jeep/wheel', frames: 4, steered: true }]
    }
    if (chassis === 'hovercraft' || chassis === 'walker') { delete fortress.tracks; delete fortress.wheels }
    saveCustomFortress(fortress)
    deleteCustomUnitDef(current.id)
    setDraft(null)
    setRevision(value => value + 1)
    setMessage('已切换为地面载具，保留共用外观、碰撞、炮位和特效点')
  }

  const patchAI = (fn: (ai: NonNullable<UnitDef['ai']>) => void) => mutate(next => {
    next.ai ??= structuredClone(DEFAULT_UNIT_AI)
    fn(next.ai)
  })
  const patchVisual = (fn: (visual: NonNullable<UnitDef['visual']>) => void) => mutate(next => {
    next.visual ??= { width: next.stats.size * 2, height: next.stats.size * 2 }
    fn(next.visual)
  })
  const patchCombat = (fn: (combat: NonNullable<UnitDef['combat']>) => void) => mutate(next => {
    next.combat ??= { range: 8, interval: 1.5, damage: 10, projectileSpeed: 12.8, penetration: 3 }
    fn(next.combat)
  })
  const field = 'px-1 py-0.5 text-[10px] font-comic border-2 border-black bg-[#EFEBD8]'
  const inlineField = 'grid grid-cols-[76px_minmax(0,1fr)] items-center gap-1 text-[9px] font-black'
  const attackProfile = combat.profile ?? 'none'
  const behaviorPanels = current ? <>
    <div className="border-2 border-black bg-[#D2CCA9] p-2">
      <div className="mb-1 flex items-center gap-2">
        <div className="text-[11px] font-black">组合式 AI</div>
        {fortressLegacy && <button type="button" className="comic-btn ml-auto px-1.5 py-0.5 text-[9px]" disabled={!draft || errors.length > 0} onClick={save}>保存 AI / Boss{draft ? '（有改动）' : ''}</button>}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-2">
        <label className="flex flex-col text-[9px] font-black"><UnitParamTip text="首选目标" /><select aria-label="AI首选目标" className={field} value={current.ai?.preferredTarget ?? 'allHostile'} onChange={event => patchAI(ai => { ai.preferredTarget = event.target.value as AIPreferredTarget })}>{(Object.keys(AI_TARGET_NAME) as AIPreferredTarget[]).map(value => <option key={value} value={value}>{AI_TARGET_NAME[value]}</option>)}</select></label>
        <label className="flex flex-col text-[9px] font-black"><UnitParamTip text="站位" /><select aria-label="AI站位" className={field} value={current.ai?.positioning ?? 'optimalRange'} onChange={event => patchAI(ai => { ai.positioning = event.target.value as AIPositioningProfile })}>{(Object.keys(AI_POSITION_NAME) as AIPositioningProfile[]).map(value => <option key={value} value={value}>{AI_POSITION_NAME[value]}</option>)}</select></label>
        <label className="flex flex-col text-[9px] font-black"><UnitParamTip text="移动" /><select aria-label="AI移动" className={field} value={current.ai?.movement ?? 'stop'} onChange={event => patchAI(ai => { ai.movement = event.target.value as AIMovementProfile })}>{(Object.keys(AI_MOVE_NAME) as AIMovementProfile[]).map(value => <option key={value} value={value}>{AI_MOVE_NAME[value]}</option>)}</select></label>
      </div>
      <div className="mt-2 border-t border-black/30 pt-2">
        <label className="flex max-w-[320px] flex-col text-[9px] font-black"><UnitParamTip text="特殊" /><select aria-label="AI特殊" className={field} value={current.ai?.special?.profile ?? 'none'} onChange={event => patchAI(ai => {
          const profile = event.target.value as AISpecialProfile
          ai.special = profile === 'deployForces'
            ? { profile, unitDefId: deployUnitOptions[0]?.id ?? '', count: 1, interval: 0.5, direction: 'rear' }
            : { profile: 'none' }
        })}>{(Object.keys(AI_SPECIAL_NAME) as AISpecialProfile[]).map(profile => <option key={profile} value={profile}>{AI_SPECIAL_NAME[profile]}</option>)}</select></label>
      </div>
      {deploySpecial && <div className="mt-2 grid grid-cols-2 lg:grid-cols-4 gap-1.5 border-t border-black/30 pt-2">
        <label className="flex flex-col text-[9px] font-black"><UnitParamTip text="投送单位" /><select aria-label="投送单位" className={field} value={deploySpecial.unitDefId} onChange={event => patchAI(ai => { if (ai.special?.profile === 'deployForces') ai.special.unitDefId = event.target.value })}>{deployUnitOptions.map(unit => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></label>
        <label className="flex flex-col text-[9px] font-black"><UnitParamTip text="投送总数" /><ValidatedNumberInput aria-label="投送总数" min={1} max={99} step={1} className={field} value={deploySpecial.count} onChange={event => patchAI(ai => { if (ai.special?.profile === 'deployForces') ai.special.count = Math.round(Number(event.target.value)) })} /></label>
        <label className="flex flex-col text-[9px] font-black"><UnitParamTip text="投送间隔（秒）" /><ValidatedNumberInput aria-label="投送间隔" min={0.1} max={60} step={0.1} className={field} value={deploySpecial.interval} onChange={event => patchAI(ai => { if (ai.special?.profile === 'deployForces') ai.special.interval = Number(event.target.value) })} /></label>
        <label className="flex flex-col text-[9px] font-black"><UnitParamTip text="投送方向" /><select aria-label="投送方向" className={field} value={deploySpecial.direction} onChange={event => patchAI(ai => { if (ai.special?.profile === 'deployForces') ai.special.direction = event.target.value as UnitDeployDirection })}><option value="front">车前</option><option value="rear">车后</option><option value="left">车左</option><option value="right">车右</option></select></label>
      </div>}
    </div>
    <div className="border-2 border-black bg-[#D2CCA9] p-2">
      <label className="text-[10px] font-black"><input type="checkbox" checked={current.boss?.enabled ?? false} onChange={event => mutate(next => { next.boss = event.target.checked ? { enabled: true, displayName: next.name, hpScale: 1, sizeScale: 1, barColor: '#B3392E', phases: [], defeatActions: [] } : undefined })} /> <UnitParamTip text="Boss 扩展" /></label>
      {current.boss?.enabled && <div className="space-y-2 mt-1">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-1.5"><label className="flex flex-col text-[9px] font-black"><UnitParamTip text="显示名称" /><input aria-label="Boss显示名称" className={field} value={current.boss.displayName ?? ''} onChange={event => mutate(next => { if (next.boss) next.boss.displayName = event.target.value })} /></label><label className="flex flex-col text-[9px] font-black"><UnitParamTip text="生命倍率" /><ValidatedNumberInput aria-label="Boss生命倍率" min={0.1} step={0.1} className={field} value={current.boss.hpScale ?? 1} onChange={event => mutate(next => { if (next.boss) next.boss.hpScale = Number(event.target.value) })} /></label><label className="flex flex-col text-[9px] font-black"><UnitParamTip text="体型倍率" /><ValidatedNumberInput aria-label="Boss体型倍率" min={0.1} step={0.1} className={field} value={current.boss.sizeScale ?? 1} onChange={event => mutate(next => { if (next.boss) next.boss.sizeScale = Number(event.target.value) })} /></label><label className="flex flex-col text-[9px] font-black"><UnitParamTip text="血条颜色" /><input aria-label="Boss血条颜色" type="color" className={`${field} h-[27px]`} value={current.boss.barColor ?? '#B3392E'} onChange={event => mutate(next => { if (next.boss) next.boss.barColor = event.target.value })} /></label></div>
        <div className="border-t border-black/30 pt-1"><div className="flex items-center text-[9px] font-black"><UnitParamTip text="生命阶段" /><button type="button" className="ml-auto comic-btn px-1 py-0" disabled={(current.boss.phases?.length ?? 0) >= 8} onClick={() => mutate(next => { if (next.boss) next.boss.phases = [...(next.boss.phases ?? []), { hpPercent: 50, actions: [] }] })}>＋ 阶段</button></div>{(current.boss.phases ?? []).map((phase, phaseIndex) => <div key={phaseIndex} className="mt-1 border-l-2 pl-1" style={{ borderColor: current.boss?.barColor ?? '#B3392E' }}><div className="flex items-center gap-1 text-[8px] font-black">生命降至 <ValidatedNumberInput aria-label={`Boss阶段${phaseIndex + 1}阈值`} min={1} max={99} className="w-12 px-1 border border-black bg-[#EFEBD8]" value={phase.hpPercent} onChange={event => mutate(next => { if (!next.boss) return; next.boss.phases = (next.boss.phases ?? []).map((value, i) => i === phaseIndex ? { ...value, hpPercent: Math.max(1, Math.min(99, Number(event.target.value) || 50)) } : value) })} />%<button type="button" className="ml-auto comic-btn px-1 py-0" onClick={() => mutate(next => { if (next.boss) next.boss.phases = (next.boss.phases ?? []).filter((_, i) => i !== phaseIndex) })}>删阶段</button></div><BossSequenceEditor actions={phase.actions} onChange={actions => mutate(next => { if (!next.boss) return; next.boss.phases = (next.boss.phases ?? []).map((value, i) => i === phaseIndex ? { ...value, actions } : value) })} /></div>)}</div>
        <div className="border-t border-black/30 pt-1"><div className="text-[9px] font-black">击败后动作</div><BossSequenceEditor actions={current.boss.defeatActions ?? []} onChange={actions => mutate(next => { if (next.boss) next.boss.defeatActions = actions })} /></div>
      </div>}
    </div>
  </> : null

  return (
    <div className="flex-1 min-h-0 flex">
      <aside className="w-[132px] shrink-0 overflow-y-auto border-r border-black/30 flex flex-col" aria-label="单位列表">
        <div className="p-1 border-b border-black/30">
          <button type="button" className="comic-btn w-full px-1 py-1 text-[10px] flex items-center justify-center gap-0.5" onClick={create}><Plus className="w-3 h-3" />新建单位</button>
        </div>
        {units.map(unit => {
          const active = unit.id === selectedId
          return (
            <button key={unit.id} type="button" title={`${unit.name} · ${unitEditorTypeName(unit)}`} className={`w-full px-1.5 py-1.5 text-left border-b border-black/20 ${active ? 'bg-[#C9C29F] border-l-4 border-l-[#B3392E]' : 'hover:bg-black/5'}`} onClick={() => choose(unit.id)}>
              <span className={`block font-comic text-[11px] truncate ${active ? 'font-black' : ''}`}>{unit.name}</span>
              <span className="block text-[8px] text-black/45 truncate">{unitEditorTypeName(unit)}</span>
            </button>
          )
        })}
      </aside>

      <section className="flex-1 min-w-0 overflow-y-auto">
        {fortressLegacy ? (
          <div className="min-h-full flex flex-col">
            <FortressTab
            key={fortressLegacy.id}
            embedded
            initialSelectedId={fortressLegacy.id}
            onSelectFortress={id => { const def = FORTRESS_DEFS.find(item => item.id === id); setSelectedId(def?.unitId ?? fortressUnitId(id)); setRevision(value => value + 1) }}
            onUnitTypeChange={changeFortressType}
            onDeleteReferences={fortress => {
              const unitId = fortress.unitId ?? fortressUnitId(fortress.id)
              const library = levelLibraryForExport()
              const cleaned = removeUnitDefinitionReferences(library, unitId, fortress.id)
              saveLevelLibrary(library)
              deleteCustomUnitDef(unitId)
              setMessage(cleaned > 0 ? `已同步清理 ${cleaned} 处关卡引用` : '')
            }}
            onRestart={onRestart}
            footer={<div className="flex flex-col gap-1.5 lg:col-start-1 lg:row-start-4">{behaviorPanels}</div>}
            />
          </div>
        ) : current && (current.type === 'rotorcraft' || current.type === 'fixedWingAircraft') ? (
          <div className="min-h-full flex flex-col">
            <FortressTab
              key={`${current.id}:${current.type}`}
              embedded
              initialSelectedId={`unit-platform:${current.id}`}
              externalDefinition={aircraftPlatformFromUnit(current)}
              onExternalChange={updateAircraftPlatform}
              onExternalSave={saveAircraftPlatform}
              onExternalDelete={removeOrRestore}
              onExternalCopy={copy}
              onGroundTypeChange={changeAircraftToGround}
              onRestart={onRestart}
              footer={<div className="flex flex-col gap-1.5 lg:col-start-1 lg:row-start-4">{behaviorPanels}</div>}
            />
          </div>
        ) : current ? (
          <div className="p-2 flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-1">
              <button type="button" className="comic-btn px-1.5 py-0.5 text-[10px]" onClick={copy}>复制</button>
              <button type="button" className="comic-btn px-1.5 py-0.5 text-[10px]" disabled={!draft || errors.length > 0} onClick={save}>保存{draft ? '（有改动）' : ''}</button>
              {draft && <button type="button" className="comic-btn px-1.5 py-0.5 text-[10px]" onClick={() => choose(current.id)}>放弃改动</button>}
              {(!isBuiltinUnitId(current.id) || isBuiltinUnitOverridden(current.id)) && <button type="button" className="comic-btn px-1.5 py-0.5 text-[10px] text-[#B3392E]" onClick={removeOrRestore}>{isBuiltinUnitOverridden(current.id) ? '恢复内置' : '删除'}</button>}
              {message && <span className={`text-[10px] font-comic ${message.startsWith('⚠') ? 'text-[#B3392E]' : 'text-[#2E5B2E]'}`}>{message}</span>}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-2 items-stretch">
            <div className="border-2 border-black bg-[#D2CCA9] p-2 flex flex-col">
              <div className="text-[11px] font-black mb-1.5">基础属性</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1.5 content-start">
                <label className={inlineField}><UnitParamTip text="名称" /><input aria-label="单位名称" className={field} value={current.name} onChange={event => mutate(next => { next.name = event.target.value })} /></label>
                <label className={inlineField}><UnitParamTip text="类型" /><select aria-label="单位类型" className={field} value={unitEditorTypeOf(current) ?? 'legacy'} onChange={event => changeEditorType(event.target.value as UnitEditorType)}>
                  {!unitEditorTypeOf(current) && <option value="legacy" disabled>{UNIT_TYPE_NAME[current.type]}（旧类型兼容）</option>}
                  {UNIT_EDITOR_TYPES.map(type => <option key={type} value={type}>{UNIT_EDITOR_TYPE_NAME[type]}</option>)}
                </select></label>
                {typeConfig?.kind === 'vehicle' && <div className="sm:col-span-2 grid grid-cols-2 sm:grid-cols-4 gap-1.5 border-y border-black/25 py-1.5">
                  {(['front', 'rear', 'left', 'right'] as const).map(side => { const label = { front: '前装甲', rear: '后装甲', left: '左装甲', right: '右装甲' }[side]; return <label key={side} className={inlineField}><UnitParamTip text={label} /><ValidatedNumberInput aria-label={`载具${label}`} min={0} max={10000} step={1} className={field} value={typeConfig.armor[side]} onChange={event => mutate(next => { if (next.typeConfig?.kind === 'vehicle') next.typeConfig.armor[side] = Math.max(0, Number(event.target.value) || 0) })} /></label> })}
                </div>}
                {(['hp', 'speed'] as const).map(key => { const label = key === 'hp' && current.type === 'vehicle' ? '耐久' : ({ hp: '生命', speed: '移动速度' } as const)[key]; const metric = key === 'speed'; return <label key={key} className={inlineField}><UnitParamTip text={label} /><ValidatedNumberInput aria-label={`单位${label}${metric ? '（米每秒）' : ''}`} step={key === 'hp' ? 10 : 0.16} className={field} value={metric ? cellsToMeters(current.stats[key]) : current.stats[key]} onChange={event => mutate(next => { next.stats[key] = metric ? metersToCells(Number(event.target.value)) : Number(event.target.value) })} /></label> })}
                <label className={inlineField}><UnitParamTip text="击毁奖励" /><ValidatedNumberInput aria-label="单位击毁奖励" min={0} step={5} className={field} value={current.stats.reward ?? (current.stats.air ? 18 : 40)} onChange={event => mutate(next => { next.stats.reward = Math.max(0, Number(event.target.value) || 0) })} /></label>
                <label className={inlineField}><UnitParamTip text="视野" /><ValidatedNumberInput aria-label="单位视野（米）" min={0} max={640} step={0.32} className={field} value={cellsToMeters(current.stats.vision ?? 8)} onChange={event => mutate(next => { const vision = Math.max(0, metersToCells(Number(event.target.value))); next.stats.vision = vision; next.stats.trackingVision = Math.max(vision, next.stats.trackingVision ?? vision * 1.5) })} /></label>
                <label className={inlineField}><UnitParamTip text="追踪视野" /><ValidatedNumberInput aria-label="单位追踪视野（米）" min={cellsToMeters(current.stats.vision ?? 8)} max={960} step={0.32} className={field} value={cellsToMeters(current.stats.trackingVision ?? (current.stats.vision ?? 8) * 1.5)} onChange={event => mutate(next => { next.stats.trackingVision = Math.max(next.stats.vision ?? 8, metersToCells(Number(event.target.value))) })} /></label>
                <label className={inlineField}><UnitParamTip text="移动音效" /><SoundAssetSelect ariaLabel="单位移动音效" channel="unit" loop value={current.sounds?.movement} onChange={value => mutate(next => { next.sounds = { ...(next.sounds ?? {}), movement: value } })} /></label>
                {typeConfig?.kind === 'vehicle' && <>
                  {([['加速度', 'accel', 0.1, 0], ['转向速度', 'turnSpeed', 1, 0], ['倒车系数', 'reverseFactor', 0.05, 0]] as const).map(([label, key, step, min]) => { const metric = key === 'accel'; return <label key={key} className={inlineField}><UnitParamTip text={label} /><ValidatedNumberInput aria-label={`载具${label}${metric ? '（米每秒平方）' : ''}`} min={metric ? cellsToMeters(min) : min} step={metric ? cellsToMeters(step) : step} className={field} value={metric ? cellsToMeters(typeConfig[key]) : typeConfig[key]} onChange={event => mutate(next => { if (next.typeConfig?.kind === 'vehicle') next.typeConfig[key] = metric ? metersToCells(Number(event.target.value)) : Number(event.target.value) })} /></label> })}
                  {typeConfig.chassis !== 'hovercraft' && <label className={inlineField}><UnitParamTip text="刹停惯性" /><ValidatedNumberInput aria-label="载具刹停惯性" min={1} max={10} step={0.5} className={field} value={typeConfig.brakeInertia} onChange={event => mutate(next => { if (next.typeConfig?.kind === 'vehicle') next.typeConfig.brakeInertia = Number(event.target.value) })} /></label>}
                  {typeConfig.chassis !== 'hovercraft' && typeConfig.chassis !== 'walker' && <label className={inlineField}><UnitParamTip text="转弯半径" /><ValidatedNumberInput aria-label="载具转弯半径（米）" min={0} step={0.32} className={field} value={cellsToMeters(typeConfig.turnRadius)} onChange={event => mutate(next => { if (next.typeConfig?.kind === 'vehicle') next.typeConfig.turnRadius = metersToCells(Number(event.target.value)) })} /></label>}
                  {(typeConfig.chassis === 'tracked' || typeConfig.chassis === 'halfTracked') && <>
                    <label className={inlineField}><UnitParamTip text="履带间距" /><ValidatedNumberInput aria-label="载具履带间距（米）" min={0.16} step={0.16} className={field} value={cellsToMeters(typeConfig.trackWidth)} onChange={event => mutate(next => { if (next.typeConfig?.kind === 'vehicle') next.typeConfig.trackWidth = metersToCells(Number(event.target.value)) })} /></label>
                    <label className={inlineField}><UnitParamTip text="转向阻力" /><ValidatedNumberInput aria-label="载具履带转向阻力" min={0} max={0.9} step={0.05} className={field} value={typeConfig.turnDrag} onChange={event => mutate(next => { if (next.typeConfig?.kind === 'vehicle') next.typeConfig.turnDrag = Number(event.target.value) })} /></label>
                  </>}
                  {(typeConfig.chassis === 'wheeled' || typeConfig.chassis === 'halfTracked') && <>
                    {([['轴距', 'wheelbase', 0.05], ['最大转角', 'steerMax', 1], ['转向速率', 'steerRate', 5], ['横向附着', 'gripMax', 0.5]] as const).map(([label, key, step]) => { const metric = key === 'wheelbase'; return <label key={key} className={inlineField}><UnitParamTip text={label} /><ValidatedNumberInput aria-label={`载具${label}${metric ? '（米）' : ''}`} min={metric ? 0.16 : 0.05} step={metric ? 0.16 : step} className={field} value={metric ? cellsToMeters(typeConfig[key]) : typeConfig[key]} onChange={event => mutate(next => { if (next.typeConfig?.kind === 'vehicle') next.typeConfig[key] = metric ? metersToCells(Number(event.target.value)) : Number(event.target.value) })} /></label> })}
                  </>}
                  {typeConfig.chassis === 'hovercraft' && <>
                    <label className={inlineField}><UnitParamTip text="滑行阻力" /><ValidatedNumberInput aria-label="气垫滑行阻力" min={0.05} max={5} step={0.05} className={field} value={typeConfig.hoverDrag} onChange={event => mutate(next => { if (next.typeConfig?.kind === 'vehicle') next.typeConfig.hoverDrag = Number(event.target.value) })} /></label>
                    <label className={inlineField}><UnitParamTip text="横向稳定" /><ValidatedNumberInput aria-label="气垫横向稳定" min={0} max={10} step={0.1} className={field} value={typeConfig.hoverGrip} onChange={event => mutate(next => { if (next.typeConfig?.kind === 'vehicle') next.typeConfig.hoverGrip = Number(event.target.value) })} /></label>
                  </>}
                  {typeConfig.chassis === 'walker' && <>
                    <label className={inlineField}><UnitParamTip text="步幅" /><ValidatedNumberInput aria-label="步行机甲步幅（米）" min={0.16} max={64} step={0.16} className={field} value={cellsToMeters(typeConfig.walkerStride)} onChange={event => mutate(next => { if (next.typeConfig?.kind === 'vehicle') next.typeConfig.walkerStride = metersToCells(Number(event.target.value)) })} /></label>
                  </>}
                </>}
                {(typeConfig?.kind === 'rotorcraft' || typeConfig?.kind === 'fixedWingAircraft') && <>
                  <label className={inlineField}><UnitParamTip text="加速度" /><ValidatedNumberInput aria-label="飞行器加速度（米每秒平方）" min={0.032} max={320} step={0.32} className={field} value={cellsToMeters(typeConfig.accel)} onChange={event => mutate(next => { if (next.typeConfig?.kind === 'rotorcraft' || next.typeConfig?.kind === 'fixedWingAircraft') next.typeConfig.accel = metersToCells(Number(event.target.value)) })} /></label>
                  <label className={inlineField}><UnitParamTip text="转向速度" /><ValidatedNumberInput aria-label="飞行器转向速度" min={0.1} max={1080} step={1} className={field} value={typeConfig.turnSpeed} onChange={event => mutate(next => { if (next.typeConfig?.kind === 'rotorcraft' || next.typeConfig?.kind === 'fixedWingAircraft') next.typeConfig.turnSpeed = Number(event.target.value) })} /></label>
                  <label className={inlineField}><UnitParamTip text="初始飞行高度" /><ValidatedNumberInput aria-label="初始飞行高度（米）" min={cellsToMeters(typeConfig.minAltitude)} max={cellsToMeters(typeConfig.maxAltitude)} step={0.32} className={field} value={cellsToMeters(typeConfig.altitude)} onChange={event => mutate(next => { if (next.typeConfig?.kind === 'rotorcraft' || next.typeConfig?.kind === 'fixedWingAircraft') next.typeConfig.altitude = metersToCells(Number(event.target.value)) })} /></label>
                  <label className={inlineField}><UnitParamTip text="最低飞行高度" /><ValidatedNumberInput aria-label="最低飞行高度（米）" min={0} max={cellsToMeters(typeConfig.altitude)} step={0.32} className={field} value={cellsToMeters(typeConfig.minAltitude)} onChange={event => mutate(next => { if (next.typeConfig?.kind === 'rotorcraft' || next.typeConfig?.kind === 'fixedWingAircraft') next.typeConfig.minAltitude = metersToCells(Number(event.target.value)) })} /></label>
                  <label className={inlineField}><UnitParamTip text="最高飞行高度" /><ValidatedNumberInput aria-label="最高飞行高度（米）" min={cellsToMeters(typeConfig.altitude)} max={cellsToMeters(10)} step={0.32} className={field} value={cellsToMeters(typeConfig.maxAltitude)} onChange={event => mutate(next => { if (next.typeConfig?.kind === 'rotorcraft' || next.typeConfig?.kind === 'fixedWingAircraft') next.typeConfig.maxAltitude = metersToCells(Number(event.target.value)) })} /></label>
                  <label className={inlineField}><UnitParamTip text="升降速度" /><ValidatedNumberInput aria-label="飞行升降速度（米每秒）" min={0.032} max={32} step={0.32} className={field} value={cellsToMeters(typeConfig.climbRate)} onChange={event => mutate(next => { if (next.typeConfig?.kind === 'rotorcraft' || next.typeConfig?.kind === 'fixedWingAircraft') next.typeConfig.climbRate = metersToCells(Number(event.target.value)) })} /></label>
                </>}
                {typeConfig?.kind === 'fixedWingAircraft' && <>
                  <label className={inlineField}><UnitParamTip text="最低航速" /><ValidatedNumberInput aria-label="固定翼最低航速（米每秒）" min={0.032} max={cellsToMeters(Math.max(0.01, current.stats.speed))} step={0.16} className={field} value={cellsToMeters(typeConfig.minSpeed)} onChange={event => mutate(next => { if (next.typeConfig?.kind === 'fixedWingAircraft') next.typeConfig.minSpeed = metersToCells(Number(event.target.value)) })} /></label>
                  <label className={inlineField}><UnitParamTip text="最小转弯半径" /><ValidatedNumberInput aria-label="固定翼最小转弯半径（米）" min={0.32} max={320} step={0.32} className={field} value={cellsToMeters(typeConfig.turnRadius)} onChange={event => mutate(next => { if (next.typeConfig?.kind === 'fixedWingAircraft') next.typeConfig.turnRadius = metersToCells(Number(event.target.value)) })} /></label>
                </>}
                {current.type !== 'vehicle' && <>
                  <label className={inlineField}><UnitParamTip text="攻击" /><select aria-label="单位攻击类型" className={field} value={attackProfile} onChange={event => mutate(next => { const profile = event.target.value as AIAttackProfile; next.combat ??= { range: 0, interval: 1, damage: 0, projectileSpeed: 0, penetration: 0 }; next.combat.profile = profile; next.ai ??= structuredClone(DEFAULT_UNIT_AI); if (profile === 'kamikaze') next.combat.kamikaze ??= { radius: 1.5, destroyedMode: 'none' } })}>{(Object.keys(AI_ATTACK_NAME) as AIAttackProfile[]).map(profile => <option key={profile} value={profile}>{AI_ATTACK_NAME[profile]}</option>)}</select></label>
                  {attackProfile !== 'none' && <label className={inlineField}><UnitParamTip text={attackProfile === 'kamikaze' ? '引爆距离' : '射程（m）'} /><ValidatedNumberInput aria-label="单位攻击射程（米）" min={0} step={0.32} className={field} value={cellsToMeters(combat.range)} onChange={event => patchCombat(next => { next.range = metersToCells(Number(event.target.value)) })} /></label>}
                  {attackProfile !== 'none' && <>
                    <label className={inlineField}><UnitParamTip text="对空" /><input aria-label="单位武器对空" type="checkbox" checked={combat.canAir ?? true} onChange={event => patchCombat(next => { next.canAir = event.target.checked })} /></label>
                    <label className={inlineField}><UnitParamTip text="对地" /><input aria-label="单位武器对地" type="checkbox" checked={combat.canGround ?? true} onChange={event => patchCombat(next => { next.canGround = event.target.checked })} /></label>
                  </>}
                  {attackProfile !== 'none' && attackProfile !== 'kamikaze' && <>
                    <label className={inlineField}><UnitParamTip text="攻击间隔" /><ValidatedNumberInput aria-label="单位攻击间隔" min={0.01} step={0.05} className={field} value={combat.interval} onChange={event => patchCombat(next => { next.interval = Number(event.target.value) })} /></label>
                    <label className={inlineField}><UnitParamTip text="弹丸" /><select aria-label="单位弹丸" className={field} value={combat.projectileId ?? ''} onChange={event => patchCombat(next => { next.projectileId = event.target.value || undefined })}><option value="">无</option>{PROJECTILE_ARTS.map(projectile => <option key={projectile.id} value={projectile.id}>{projectile.name}</option>)}</select></label>
                  </>}
                  {attackProfile === 'kamikaze' && <><label className={inlineField}><UnitParamTip text="爆炸半径" /><ValidatedNumberInput aria-label="自爆半径（米）" min={0.16} step={0.32} className={field} value={cellsToMeters(combat.kamikaze?.radius ?? 1.5)} onChange={event => patchCombat(next => { next.kamikaze ??= { radius: 1.5, destroyedMode: 'none' }; next.kamikaze.radius = metersToCells(Number(event.target.value)) })} /></label><label className={inlineField}><UnitParamTip text="被击毁爆炸" /><select aria-label="被击毁爆炸" className={field} value={combat.kamikaze?.destroyedMode ?? 'none'} onChange={event => patchCombat(next => { next.kamikaze ??= { radius: 1.5, destroyedMode: 'none' }; next.kamikaze.destroyedMode = event.target.value as 'none' | 'half' | 'full' })}><option value="none">不爆炸</option><option value="half">半额爆炸</option><option value="full">满额爆炸</option></select></label></>}
                </>}
              </div>
              <div className="mt-auto pt-2 border-t border-black/25 text-[9px] font-black"><TipLabel text="目标类别" tip="供炮塔索敌标签、AI 攻击规则与关卡脚本筛选，可同时勾选多个。" /></div>
              <div className="flex flex-wrap gap-x-2 gap-y-1">{(Object.keys(UNIT_TARGET_NAME) as UnitTargetKind[]).map(kind => <label key={kind} className="text-[9px] font-comic"><input type="checkbox" checked={current.targetClasses.includes(kind)} onChange={event => mutate(next => { const set = new Set(next.targetClasses); if (event.target.checked) set.add(kind); else set.delete(kind); next.targetClasses = [...set] })} />{UNIT_TARGET_NAME[kind]}</label>)}</div>
            </div>

            <div className="border-2 border-black bg-[#D2CCA9] p-2 flex flex-col">
              <div className="text-[11px] font-black mb-1.5">外观与碰撞</div>
              <div className="grid grid-cols-1 lg:grid-cols-[auto_1fr] gap-2">
                <div className="flex items-start gap-1.5">
                  <div className="relative h-[132px] w-[180px] shrink-0 overflow-hidden border-2 border-black bg-[#B7B18F]" aria-label="单位几何中心预览">
                    <div className="absolute inset-0 transition-transform duration-150" style={{ transform: `scale(${previewZoom / 100})` }}>
                      <div className="absolute left-1/2 top-0 bottom-0 border-l border-dashed border-black/35" />
                      <div className="absolute top-1/2 left-0 right-0 border-t border-dashed border-black/35" />
                      <div className="absolute left-1/2 top-1/2 rounded-[50%] border-2 border-[#B3392E]" style={{ width: Math.max(2, collision.x * 60), height: Math.max(2, collision.y * 60), transform: 'translate(-50%, -50%)' }} />
                      {previewRotors.filter(rotor => (rotor.layer ?? 'above') === 'below').map(rotor => <div key={rotor.key} className="pointer-events-none absolute" style={{ left: `calc(50% + ${rotor.x}px)`, top: `calc(50% + ${rotor.y}px)`, transform: 'translate(-50%, -50%)' }}><img src={rotor.src} alt="" className="block max-w-none animate-spin" style={{ animationDuration: rotor.speed === 0 ? '0s' : `${360 / Math.abs(rotor.speed)}s`, animationDirection: rotor.speed < 0 ? 'reverse' : 'normal', animationPlayState: rotor.speed === 0 ? 'paused' : 'running' }} /></div>)}
                      {bodySrc ? previewSheet ? <div className="absolute left-1/2 top-1/2 overflow-hidden" style={{ width: previewBodyWidth, height: previewBodyHeight, transform: previewBodyTransform }}><img src={bodySrc} alt={`${current.name}${unitPreviewAnimation === 'move' ? '移动' : unitPreviewAnimation === 'attack' ? '射击' : '死亡'}预览`} className="absolute top-0 max-w-none" style={{ left: -previewFrameIndex * previewBodyWidth, width: previewBodyWidth * previewFrameCount, height: previewBodyHeight }} /></div> : <img src={bodySrc} alt={`${current.name}主体预览`} className="absolute left-1/2 top-1/2 object-contain" style={{ width: previewBodyWidth, height: previewBodyHeight, transform: previewBodyTransform }} /> : <div className="absolute left-1/2 top-1/2 rounded-full bg-[#7C765F] border-2 border-black" style={{ width: previewBodyWidth, height: previewBodyHeight, transform: previewBodyTransform }} />}
                      {previewRotors.filter(rotor => (rotor.layer ?? 'above') === 'above').map(rotor => <div key={rotor.key} className="pointer-events-none absolute z-10" style={{ left: `calc(50% + ${rotor.x}px)`, top: `calc(50% + ${rotor.y}px)`, transform: 'translate(-50%, -50%)' }}><img src={rotor.src} alt="" className="block max-w-none animate-spin" style={{ animationDuration: rotor.speed === 0 ? '0s' : `${360 / Math.abs(rotor.speed)}s`, animationDirection: rotor.speed < 0 ? 'reverse' : 'normal', animationPlayState: rotor.speed === 0 ? 'paused' : 'running' }} /></div>)}
                      {unitPreviewAnimation === 'attack' && <div className="pointer-events-none absolute z-20 h-2 w-2" aria-label="开火点预览" style={{ left: `calc(50% + ${visual.muzzleOffsetX ?? 0}px)`, top: `calc(50% + ${visual.muzzleOffsetY ?? 0}px)`, transform: 'translate(-50%, -50%)' }}>
                        <span className="absolute inset-[-2px] animate-ping rounded-full bg-[#F3B13F]/60" />
                        <span className="absolute inset-0 rotate-45 border border-[#FFF0A6] bg-[#D85B2B] shadow-[0_0_3px_1px_rgba(255,190,70,0.8)]" />
                        <span className="absolute left-1/2 top-[-3px] h-3 border-l border-dashed border-[#7D241B]" />
                        <span className="absolute left-[-3px] top-1/2 w-3 border-t border-dashed border-[#7D241B]" />
                      </div>}
                    </div>
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="w-[54px] text-[8px] font-black leading-tight">预览状态<select aria-label="单位预览状态" className="mt-0.5 w-full px-0.5 py-0.5 text-[8px] font-comic border-2 border-black bg-[#EFEBD8]" value={unitPreviewAnimation} onChange={event => setUnitPreviewAnimation(event.target.value as 'move' | 'attack' | 'death')}><option value="move">移动</option><option value="attack">射击</option><option value="death">死亡</option></select></label>
                    <PreviewZoom value={previewZoom} onChange={setPreviewZoom} overlay={false} />
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-1.5 content-start">
                  <label className={inlineField}><UnitParamTip text="主体素材" /><select aria-label="单位主体素材" className={field} value={visual.bodyAsset ?? ''} onChange={event => patchVisual(next => { next.bodyAsset = event.target.value || undefined })}><option value="">程序化/旧精灵</option>{visual.bodyAsset && !unitBodyAssets.some(asset => asset.id === visual.bodyAsset) && <option value={visual.bodyAsset}>当前引用（未分类或缺失）</option>}{unitBodyAssets.map(asset => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</select></label>
                  <label className={inlineField}><UnitParamTip text="摧毁效果" /><select aria-label="单位摧毁效果" className={field} value={resolveUnitDestructionEffect(visual.destructionEffect, visual.width, visual.height)} onChange={event => patchVisual(next => { next.destructionEffect = event.target.value as 'small' | 'medium' | 'large' | 'violent' })}><option value="small">小型爆炸</option><option value="medium">中型爆炸</option><option value="large">大型爆炸</option><option value="violent">剧烈爆炸</option></select></label>
                  <label className={inlineField}><UnitParamTip text="原始尺寸" /><span><input aria-label="按素材原尺寸" type="checkbox" checked={visual.nativeSize ?? false} onChange={event => patchVisual(next => { next.nativeSize = event.target.checked })} /> 按贴图尺寸</span></label>
                  <label className={inlineField}><UnitParamTip text="中心偏移 X（px）" /><ValidatedNumberInput aria-label="单位素材中心偏移X（像素）" step={1} className={field} value={visual.offsetX ?? 0} onChange={event => patchVisual(next => { next.offsetX = Number(event.target.value) })} /></label>
                  <label className={inlineField}><UnitParamTip text="中心偏移 Y（px）" /><ValidatedNumberInput aria-label="单位素材中心偏移Y（像素）" step={1} className={field} value={visual.offsetY ?? 0} onChange={event => patchVisual(next => { next.offsetY = Number(event.target.value) })} /></label>
                  <label className={inlineField}><UnitParamTip text="碰撞设置" /><span className="grid grid-cols-2 gap-1"><ValidatedNumberInput aria-label="单位碰撞横半径（米）" title="横半径（m）" min={0.032} step={0.16} className={field} value={cellsToMeters(collision.x)} onChange={event => mutate(next => { next.stats.collisionRadiusX = metersToCells(Number(event.target.value)) })} /><ValidatedNumberInput aria-label="单位碰撞纵半径（米）" title="纵半径（m）" min={0.032} step={0.16} className={field} value={cellsToMeters(collision.y)} onChange={event => mutate(next => { next.stats.collisionRadiusY = metersToCells(Number(event.target.value)) })} /></span></label>
                  <label className={inlineField}><UnitParamTip text="开火点 X（px）" /><ValidatedNumberInput aria-label="单位开火点X（像素）" step={1} className={field} value={visual.muzzleOffsetX ?? 0} onFocus={() => setUnitPreviewAnimation('attack')} onChange={event => { setUnitPreviewAnimation('attack'); patchVisual(next => { next.muzzleOffsetX = Number(event.target.value) }) }} /></label>
                  <label className={inlineField}><UnitParamTip text="开火点 Y（px）" /><ValidatedNumberInput aria-label="单位开火点Y（像素）" step={1} className={field} value={visual.muzzleOffsetY ?? 0} onFocus={() => setUnitPreviewAnimation('attack')} onChange={event => { setUnitPreviewAnimation('attack'); patchVisual(next => { next.muzzleOffsetY = Number(event.target.value) }) }} /></label>
                </div>
              </div>
            </div>
            </div>

            {typeConfig?.kind === 'rotorcraft' && <div className="border-2 border-black bg-[#D2CCA9] p-2">
              <div className="mb-1.5 flex items-center gap-2"><div className="text-[11px] font-black">动态旋翼</div><button type="button" className="comic-btn ml-auto px-1.5 py-0.5 text-[9px]" onClick={() => mutate(next => { if (next.typeConfig?.kind !== 'rotorcraft') return; next.typeConfig.rotors = [...(next.typeConfig.rotors ?? []), { id: `rotor${(next.typeConfig.rotors?.length ?? 0) + 1}-${Date.now() % 1000}`, asset: rotorAssets[0]?.id ?? '', layer: 'above', unit: 'single', x: 0, y: 0, speed: 720 }] })}>＋ 旋翼</button></div>
              {(typeConfig.rotors ?? []).length === 0 ? <div className="text-[9px] font-bold text-black/45">未配置旋翼；单位只显示主体素材。</div> : <div className="space-y-1.5">{(typeConfig.rotors ?? []).map((rotor, index) => <div key={rotor.id} className="border border-black/30 bg-[#EFEBD8]/45 p-1.5">
                <div className="mb-1 flex items-center text-[9px] font-black"><span>旋翼 {index + 1}</span><button type="button" className="comic-btn ml-auto px-1 py-0 text-[8px] text-[#B3392E]" onClick={() => mutate(next => { if (next.typeConfig?.kind === 'rotorcraft') next.typeConfig.rotors = (next.typeConfig.rotors ?? []).filter(item => item.id !== rotor.id) })}>删除</button></div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-1.5">
                  <label className={inlineField}><UnitParamTip text="旋翼素材" /><select aria-label={`旋翼${index + 1}素材`} className={field} value={rotor.asset} onChange={event => mutate(next => { if (next.typeConfig?.kind === 'rotorcraft') { const item = next.typeConfig.rotors?.find(value => value.id === rotor.id); if (item) item.asset = event.target.value } })}><option value="">未配置</option>{rotor.asset && !rotorAssets.some(asset => asset.id === rotor.asset) && <option value={rotor.asset}>当前引用（未分类或缺失）</option>}{rotorAssets.map(asset => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</select></label>
                  <label className={inlineField}><UnitParamTip text="旋翼层级" /><select aria-label={`旋翼${index + 1}层级`} className={field} value={rotor.layer ?? 'above'} onChange={event => mutate(next => { if (next.typeConfig?.kind === 'rotorcraft') { const item = next.typeConfig.rotors?.find(value => value.id === rotor.id); if (item) item.layer = event.target.value === 'below' ? 'below' : 'above' } })}><option value="above">上</option><option value="below">下</option></select></label>
                  <label className={inlineField}><UnitParamTip text="旋翼单位" /><select aria-label={`旋翼${index + 1}单位`} className={field} value={rotor.unit ?? 'single'} onChange={event => mutate(next => { if (next.typeConfig?.kind === 'rotorcraft') { const item = next.typeConfig.rotors?.find(value => value.id === rotor.id); if (item) item.unit = event.target.value === 'pair' ? 'pair' : 'single' } })}><option value="single">单个</option><option value="pair">一对</option></select></label>
                  <label className={inlineField}><UnitParamTip text="旋翼坐标（px）" /><span className="grid grid-cols-2 gap-1"><ValidatedNumberInput aria-label={`旋翼${index + 1}坐标X（像素）`} title="X（px）" step={1} className={field} value={rotor.x} onChange={event => mutate(next => { if (next.typeConfig?.kind === 'rotorcraft') { const item = next.typeConfig.rotors?.find(value => value.id === rotor.id); if (item) item.x = Number(event.target.value) } })} /><ValidatedNumberInput aria-label={`旋翼${index + 1}坐标Y（像素）`} title="Y（px）" step={1} className={field} value={rotor.y} onChange={event => mutate(next => { if (next.typeConfig?.kind === 'rotorcraft') { const item = next.typeConfig.rotors?.find(value => value.id === rotor.id); if (item) item.y = Number(event.target.value) } })} /></span></label>
                  <label className={inlineField}><UnitParamTip text="旋转速度" /><ValidatedNumberInput aria-label={`旋翼${index + 1}旋转速度`} min={-10000} max={10000} step={30} className={field} value={rotor.speed} onChange={event => mutate(next => { if (next.typeConfig?.kind === 'rotorcraft') { const item = next.typeConfig.rotors?.find(value => value.id === rotor.id); if (item) item.speed = Number(event.target.value) } })} /></label>
                </div>
              </div>)}</div>}
            </div>}

            {behaviorPanels}

            <div className={`border-2 border-black p-1.5 text-[10px] font-comic ${errors.length > 0 ? 'bg-[#E8C9B8]' : 'bg-[#C9D8B8]'}`}>{errors.length > 0 ? errors.map((error, index) => <div key={index}>· {error}</div>) : '单位定义校验通过'}</div>
          </div>
        ) : <div className="p-6 text-center text-[11px] text-black/50">没有可编辑单位</div>}
      </section>
    </div>
  )
}

function newCustomFortress(): FortressDef {
  const d = structuredClone(DEFAULT_FORTRESS)
  d.id = `fort-${Date.now()}`
  d.name = `自定义堡垒${listCustomFortresses().length + 1}`
  // 展开为显式自由网格（可在此基础上镂空/扩建）
  d.shape = []
  for (let x = 0; x < d.w; x++) for (let y = 0; y < d.h; y++) d.shape.push(`${x},${y}`)
  return d
}

type FortressEditSession = {
  draft: FortressDef | null
  history: FortressDef[]
  historyIndex: number
}

type FortressEditAction =
  | { type: 'reset' }
  | { type: 'mutate'; base: FortressDef; change: (draft: FortressDef) => void }
  | { type: 'undo' }
  | { type: 'redo' }

const EMPTY_FORTRESS_EDIT_SESSION: FortressEditSession = { draft: null, history: [], historyIndex: -1 }

/** 编辑草稿专用：undefined 表示隐式矩形，[] 表示明确没有内部格。 */
function fortressInteriorCellsForEdit(d: FortressDef): string[] {
  if (d.interiorCells !== undefined) return [...d.interiorCells]
  const cells: string[] = []
  for (let x = 0; x < d.interior.cols; x++) for (let y = 0; y < d.interior.rows; y++) cells.push(`${x},${y}`)
  return cells
}

async function collisionOutlineForBody(
  assetRef: string, columns = 1, rows = 1, offsetX = 0, offsetY = 0, collisionSource = assetRef,
): Promise<NonNullable<FortressDef['bodyCollision']> | undefined> {
  const resolved = resolveAssetSrc(assetRef)
  if (!resolved) return undefined
  const src = resCompatUrl(resolved)
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image()
    element.onload = () => resolve(element)
    element.onerror = () => reject(new Error('载具素材加载失败'))
    element.src = src
  })
  const canvas = document.createElement('canvas')
  const frameColumns = Math.max(1, Math.min(64, Math.round(columns)))
  const frameRows = Math.max(1, Math.min(64, Math.round(rows)))
  canvas.width = Math.max(1, Math.floor(image.naturalWidth / frameColumns))
  canvas.height = Math.max(1, Math.floor(image.naturalHeight / frameRows))
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return undefined
  context.drawImage(image, 0, 0, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height)
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
  const outline = bodyCollisionFromPixels(pixels, canvas.width, canvas.height, collisionSource)
  if (!outline || (offsetX === 0 && offsetY === 0)) return outline
  return { ...outline, points: outline.points.map(point => ({ x: point.x + offsetX / BASE_CELL, y: point.y + offsetY / BASE_CELL })) }
}

function fortressEditReducer(state: FortressEditSession, action: FortressEditAction): FortressEditSession {
  if (action.type === 'reset') return EMPTY_FORTRESS_EDIT_SESSION
  if (action.type === 'undo') {
    if (state.historyIndex <= 0) return state
    const historyIndex = state.historyIndex - 1
    return { ...state, historyIndex, draft: structuredClone(state.history[historyIndex]) }
  }
  if (action.type === 'redo') {
    if (state.historyIndex < 0 || state.historyIndex >= state.history.length - 1) return state
    const historyIndex = state.historyIndex + 1
    return { ...state, historyIndex, draft: structuredClone(state.history[historyIndex]) }
  }

  const source = state.draft ?? structuredClone(action.base)
  const draft = structuredClone(source)
  action.change(draft)
  if (JSON.stringify(draft) === JSON.stringify(source)) return state
  const history = state.historyIndex >= 0
    ? state.history.slice(0, state.historyIndex + 1)
    : [structuredClone(source)]
  history.push(structuredClone(draft))
  if (history.length > 50) history.shift()
  return { draft, history, historyIndex: history.length - 1 }
}

/** 轮胎横向帧条预览：嵌套 SVG 以 viewBox 裁出单帧，不改变素材原始像素比例。 */
function WheelStripPreview({ href, x, y, width, height, sourceWidth, sourceHeight, frames }: {
  href: string; x: number; y: number; width: number; height: number; sourceWidth: number; sourceHeight: number; frames: number
}) {
  const [frame, setFrame] = useState(0)
  useEffect(() => {
    if (frames <= 1) return
    const timer = window.setInterval(() => setFrame(value => (value + 1) % frames), 100)
    return () => window.clearInterval(timer)
  }, [frames])
  const sourceFrameWidth = sourceWidth / frames
  return (
    <svg x={x} y={y} width={width} height={height} viewBox={`${(frame % frames) * sourceFrameWidth} 0 ${sourceFrameWidth} ${sourceHeight}`} preserveAspectRatio="none" overflow="hidden" pointerEvents="none">
      <image href={href} x={0} y={0} width={sourceWidth} height={sourceHeight} />
    </svg>
  )
}

/** 步行机甲主体预览：固定按 2 行×7 列、行优先切分。 */
function WalkerGridPreview({ href, x, y, width, height, sourceWidth, sourceHeight, frameInterval }: {
  href: string; x: number; y: number; width: number; height: number; sourceWidth: number; sourceHeight: number; frameInterval: number
}) {
  const [frame, setFrame] = useState(0)
  useEffect(() => {
    const timer = window.setInterval(() => setFrame(value => (value + 1) % WALKER_FRAMES), Math.max(30, Math.min(2000, frameInterval * 1000)))
    return () => window.clearInterval(timer)
  }, [frameInterval])
  const sourceFrameWidth = sourceWidth / WALKER_COLUMNS
  const sourceFrameHeight = sourceHeight / WALKER_ROWS
  const column = frame % WALKER_COLUMNS
  const row = Math.floor(frame / WALKER_COLUMNS)
  return (
    <svg x={x} y={y} width={width} height={height} viewBox={`${column * sourceFrameWidth} ${row * sourceFrameHeight} ${sourceFrameWidth} ${sourceFrameHeight}`} preserveAspectRatio="none" overflow="hidden" pointerEvents="none">
      <image href={href} x={0} y={0} width={sourceWidth} height={sourceHeight} />
    </svg>
  )
}

/** 单位编辑器的预装炮塔层：与关卡选择预览共用 drawTurretPreviewCore，保持炮位、朝向、层级与炮塔色一致。 */
function BuiltInTurretPreviewLayer({ def, offX, offY, cell, width, height, placement }: {
  def: FortressDef
  offX: number
  offY: number
  cell: number
  width: number
  height: number
  placement: 'below' | 'above'
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    let disposed = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let attempts = 0
    const angleOf = (hardpoint: Hardpoint) => {
      if (hardpoint.fixed !== undefined) return hardpoint.fixed * Math.PI / 180
      if (!hardpoint.arc) return 0
      const span = ((hardpoint.arc.end - hardpoint.arc.start) % 360 + 360) % 360
      return (hardpoint.arc.start + span / 2) * Math.PI / 180
    }
    const paint = () => {
      if (disposed) return
      const dpr = Math.max(1, window.devicePixelRatio || 1)
      const backingWidth = Math.max(1, Math.round(width * dpr))
      const backingHeight = Math.max(1, Math.round(height * dpr))
      if (canvas.width !== backingWidth || canvas.height !== backingHeight) {
        canvas.width = backingWidth
        canvas.height = backingHeight
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, width, height)
      ctx.imageSmoothingEnabled = false
      const layers = def.hardpoints.flatMap(hardpoint => {
        if (!hardpoint.builtIn || (hardpoint.hideTurretArt ?? hardpoint.hidden)) return []
        if (hardpointBelowVehicleBody(hardpoint) !== (placement === 'below')) return []
        const turret = TURRET_DEFS.find(item => item.id === hardpoint.builtIn)
        if (!turret || turret.mount !== hardpoint.size || (hardpoint.types && !hardpoint.types.includes(turret.type))) return []
        return [{ hardpoint, turret }]
      }).sort((a, b) => {
        const sizeRank = (size: MountSize) => size === 'L' ? 2 : size === 'M' ? 1 : 0
        return sizeRank(a.turret.mount) - sizeRank(b.turret.mount)
          || (a.hardpoint.zLevel ?? 1) - (b.hardpoint.zLevel ?? 1)
      })
      for (const { hardpoint, turret } of layers) {
        drawTurretPreviewCore(ctx, turret, {
          x: (hardpoint.x + offX - turret.w / 2) * cell,
          y: (hardpoint.y + offY - turret.h / 2) * cell,
          cell,
        }, { angleRad: angleOf(hardpoint), tintColor: def.paint?.turret })
      }
      // 炮塔图片可能仍在异步加载；短期重绘使已配置素材加载完成后自动出现。
      if (attempts++ < 16) timer = setTimeout(paint, 120)
    }
    paint()
    return () => { disposed = true; if (timer) clearTimeout(timer) }
  }, [cell, def, height, offX, offY, placement, width])

  return <canvas ref={canvasRef} aria-label="预装炮塔预览层" className="block h-full w-full [image-rendering:pixelated]" />
}

function FortressTab({ onRestart, embedded = false, initialSelectedId, onSelectFortress, onUnitTypeChange, onGroundTypeChange, onDeleteReferences, footer, externalDefinition, onExternalChange, onExternalSave, onExternalDelete, onExternalCopy }: { onRestart: () => void; embedded?: boolean; initialSelectedId?: string; onSelectFortress?: (id: string) => void; onUnitTypeChange?: (type: 'rotorcraft' | 'fixedWingAircraft', fortress: FortressDef) => void; onGroundTypeChange?: (chassis: NonNullable<FortressDef['chassis']>, fortress: FortressDef) => void; onDeleteReferences?: (fortress: FortressDef) => void; footer?: ReactNode; externalDefinition?: FortressDef; onExternalChange?: (fortress: FortressDef) => void; onExternalSave?: (fortress: FortressDef) => void; onExternalDelete?: () => void; onExternalCopy?: () => void }) {
  const [, setRev] = useState(0)
  const bump = () => setRev(r => r + 1)
  const [selectedId, setSelectedId] = useState<string>(initialSelectedId ?? getSelectedFortressId())
  const [editSession, dispatchEdit] = useReducer(fortressEditReducer, EMPTY_FORTRESS_EDIT_SESSION)
  const draft = editSession.draft // 编辑中副本（保存才落库）
  const [view, setView] = useState<'exterior' | 'interior'>('exterior') // 预览模式：外部/内部
  const [tool, setTool] = useState<'none' | 'hp' | 'fx' | 'icell' | 'special'>('none')
  const [boost, setBoost] = useState<SpecialBoost | 'none'>('cooling')
  const [hpSel, setHpSel] = useState<string | null>(null)
  // 贴图原始尺寸缓存：预览按原比例 1:1 显示（1 贴图像素 = 1 预览像素），中心对准底格中心
  const [spriteDims, setSpriteDims] = useState<Record<string, { w: number; h: number }>>({})
  const [msg, setMsg] = useState('')
  const [previewZoom, setPreviewZoom] = useState(100)
  const [showOutline, setShowOutline] = useState(true)
  const [showPoints, setShowPoints] = useState(true)
  const [showWheelRadius, setShowWheelRadius] = useState(true)
  const [showTurrets, setShowTurrets] = useState(true)

  const customs = listCustomFortresses()
  const resolvedBaseDef = externalDefinition?.id === selectedId ? externalDefinition : FORTRESS_DEFS.find(f => f.id === selectedId)
  // 仅供 Hook 与局部计算维持稳定；下方会显示明确错误，绝不会把该回退定义暴露为可编辑载具。
  const baseDef = resolvedBaseDef ?? DEFAULT_FORTRESS
  const isExternal = !!externalDefinition
  const isFactory = !isExternal && !customs.some(f => f.id === selectedId) && baseDef.id === DEFAULT_FORTRESS.id // 未改动的内置
  const overridden = !isExternal && isBuiltinFortressOverridden(selectedId) // 内置但已被覆盖
  const cur = isExternal ? baseDef : draft ?? baseDef
  const platformType = cur.platformType ?? 'vehicle'
  const aircraftPlatform = platformType === 'rotorcraft' || platformType === 'fixedWingAircraft'
  const selectedIsDeployed = getSelectedFortressId() === selectedId
  const errors = isExternal || draft ? validateFortressDef(cur) : []
  const iSet = fortressInteriorSet(cur)
  const decalAssets = filterAssets('decal')
  const vehicleAssets = filterAssets('vehicle')
  const trackAssets = filterAssets('wheel')
  const wheelAssets = filterAssets('wheel')
  // 旋翼素材锚定“轮胎”分类，与单位编辑器的另一入口保持一致。
  const rotorAssets = filterAssets('wheel')

  const select = (id: string) => { setSelectedId(id); dispatchEdit({ type: 'reset' }); setTool('none'); setHpSel(null); setMsg(''); onSelectFortress?.(id) }

  // v2.29 撤销/重做：草稿与历史栈由同一 reducer 原子更新，最多保留 50 个快照。
  const canUndo = editSession.historyIndex > 0
  const canRedo = editSession.historyIndex >= 0 && editSession.historyIndex < editSession.history.length - 1
  const undo = () => dispatchEdit({ type: 'undo' })
  const redo = () => dispatchEdit({ type: 'redo' })
  useEffect(() => { // Ctrl+Z 撤销 / Ctrl+Y、Ctrl+Shift+Z 重做（输入框内交给原生文本撤销）
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return
      const k = e.key.toLowerCase()
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && k === 'z') { e.preventDefault(); undo() }
      else if ((e.ctrlKey || e.metaKey) && (k === 'y' || (e.shiftKey && k === 'z'))) { e.preventDefault(); redo() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const mutate = (fn: (d: FortressDef) => void) => {
    if (isExternal && onExternalChange) {
      const next = structuredClone(cur)
      fn(next)
      onExternalChange(next)
      return
    }
    dispatchEdit({ type: 'mutate', base: baseDef, change: fn })
  }

  const createNew = () => {
    const d = newCustomFortress()
    saveCustomFortress(d)
    select(d.id)
    setMsg('已新建自定义堡垒（基于测试堡垒），可直接编辑')
  }
  const copyAsCustom = () => {
    if (isExternal) { onExternalCopy?.(); return }
    const d = newCustomFortress()
    const srcDef = structuredClone(baseDef)
    d.w = srcDef.w; d.h = srcDef.h
    d.shape = srcDef.shape ? [...srcDef.shape] : d.shape
    d.interior = { ...srcDef.interior }
    d.interiorCells = srcDef.interiorCells ? [...srcDef.interiorCells] : undefined
    d.interiorSpecials = srcDef.interiorSpecials ? structuredClone(srcDef.interiorSpecials) : undefined
    d.effects = srcDef.effects ? structuredClone(srcDef.effects) : undefined
    d.paint = srcDef.paint ? structuredClone(srcDef.paint) : undefined
    d.decals = srcDef.decals ? structuredClone(srcDef.decals) : undefined
    d.spriteBody = srcDef.spriteBody
    d.walkerStride = srcDef.walkerStride
    d.walkerBodyOffsetX = srcDef.walkerBodyOffsetX
    d.walkerBodyOffsetY = srcDef.walkerBodyOffsetY
    d.bodyCollision = srcDef.bodyCollision ? structuredClone(srcDef.bodyCollision) : undefined
    d.unitTargetClasses = srcDef.unitTargetClasses ? structuredClone(srcDef.unitTargetClasses) : undefined
    d.unitReward = srcDef.unitReward
    d.unitCombat = srcDef.unitCombat ? structuredClone(srcDef.unitCombat) : undefined
    d.unitAI = srcDef.unitAI ? structuredClone(srcDef.unitAI) : undefined
    d.unitBoss = srcDef.unitBoss ? structuredClone(srcDef.unitBoss) : undefined
    d.chassis = srcDef.chassis
    d.runningGearCoordinateSpace = srcDef.runningGearCoordinateSpace ?? 'centered'
    d.tracks = srcDef.tracks ? structuredClone(srcDef.tracks) : undefined
    d.wheels = srcDef.wheels ? structuredClone(srcDef.wheels) : undefined
    d.armor = srcDef.armor ? structuredClone(srcDef.armor) : undefined
    d.hp = srcDef.hp; d.speed = srcDef.speed; d.turnSpeed = srcDef.turnSpeed; d.accel = srcDef.accel
    d.heatCap = srcDef.heatCap; d.heatDissipation = srcDef.heatDissipation
    d.hardpoints = structuredClone(srcDef.hardpoints)
    d.color = VEHICLE_PLACEHOLDER_COLOR
    saveCustomFortress(d)
    select(d.id)
    setMsg(`已复制「${baseDef.name}」为自定义堡垒`)
  }
  const save = () => {
    if (isExternal) {
      if (errors.length > 0) {
        setMsg(`\u26a0校验未通过（${errors.length} 项）：${errors[0]}${errors.length > 1 ? '；其余见下方校验面板' : ''}`)
        return
      }
      onExternalSave?.(structuredClone(cur))
      setMsg('飞行器平台已保存')
      return
    }
    if (!draft) { setMsg('\u26a0没有待保存的改动'); return }
    if (errors.length > 0) {
      setMsg(`\u26a0校验未通过（${errors.length} 项）：${errors[0]}${errors.length > 1 ? '；其余见下方校验面板' : ''}`)
      return
    }
    saveCustomFortress(draft)
    dispatchEdit({ type: 'reset' })
    bump()
    const base = overridden || baseDef.id === DEFAULT_FORTRESS.id ? '已保存（内置堡垒已修改，可「恢复出厂」还原）' : '已保存（出战堡垒重开一局后生效）'
    setMsg(fortressPersistFailed() ? `\u26a0${base}；但本地存储写入失败（空间不足），刷新后将丢失` : base)
  }
  const removeOrRestore = () => {
    if (isExternal) { onExternalDelete?.(); return }
    if (!overridden) onDeleteReferences?.(baseDef)
    deleteCustomFortress(selectedId) // 纯自定义=删除；内置覆盖=恢复出厂
    select(DEFAULT_FORTRESS.id)
    bump()
    setMsg(overridden ? '已恢复内置出厂定义' : '已删除自定义堡垒')
  }
  const deploy = (restart: boolean) => {
    if (draft) { setMsg('请先保存或放弃改动'); return }
    setSelectedFortressId(selectedId)
    bump()
    setMsg(restart ? '已设为出战并重开' : '已设为出战（下一局生效）')
    if (restart) onRestart()
  }

  // 主体贴图变更后由 alpha 自动生成持久化碰撞轮廓，并同步载具素材范围。
  useEffect(() => {
    const assetRef = cur.spriteBody
    const walker = cur.chassis === 'walker'
    const offsetX = walker ? cur.walkerBodyOffsetX ?? 0 : 0
    const offsetY = walker ? cur.walkerBodyOffsetY ?? 0 : 0
    const collisionSource = walker ? `${assetRef}#walker:2x7:${offsetX},${offsetY}` : assetRef
    if (!assetRef || assetRef === 'none' || cur.bodyCollision?.source === collisionSource) return
    let cancelled = false
    void collisionOutlineForBody(assetRef, walker ? WALKER_COLUMNS : 1, walker ? WALKER_ROWS : 1, offsetX, offsetY, collisionSource).then(outline => {
      if (cancelled || !outline) return
      mutate(d => {
        if (d.spriteBody !== assetRef) return
        const oldCenter = fortressLocalCenter(d)
        const nextW = Math.max(1, Math.ceil(outline.widthPx / BASE_CELL))
        const nextH = Math.max(1, Math.ceil(outline.heightPx / BASE_CELL))
        d.w = nextW
        d.h = nextH
        d.bodyCollision = outline
        // 当前载具不再使用可编辑形状格；shape 仅保留给没有轮廓的历史数据回退。
        delete d.shape
        const nextCenter = fortressLocalCenter(d)
        const dx = nextCenter.x - oldCenter.x
        const dy = nextCenter.y - oldCenter.y
        d.hardpoints = d.hardpoints.map(point => ({ ...point, x: point.x + dx, y: point.y + dy }))
        d.effects = d.effects?.map(point => ({ ...point, x: point.x + dx, y: point.y + dy }))
        d.decals = d.decals?.map(point => ({ ...point, x: point.x + dx, y: point.y + dy }))
      })
      setMsg('已按载具素材透明边缘生成碰撞轮廓；请检查炮位后保存')
    }).catch(() => {
      if (!cancelled) setMsg('\u26a0无法读取载具素材透明边缘，将继续使用旧碰撞回退')
    })
    return () => { cancelled = true }
    // mutate 由 reducer 承载当前草稿；这里只在素材引用/轮廓来源改变时重建。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur.spriteBody, cur.bodyCollision?.source, cur.chassis, cur.walkerBodyOffsetX, cur.walkerBodyOffsetY])

  // 画布点击：按当前模式/子工具分发
  const clickCell = (cx: number, cy: number) => {
    if (tool === 'icell') {
      mutate(d => {
        const set = new Set(fortressInteriorCellsForEdit(d))
        const k = `${cx},${cy}`
        if (set.has(k)) {
          set.delete(k)
          d.interiorSpecials = (d.interiorSpecials ?? []).filter(c => !(c.x === cx && c.y === cy)) // 连带清除特殊格
          if (d.interiorSpecials.length === 0) d.interiorSpecials = undefined
        } else set.add(k)
        d.interiorCells = [...set]
      })
    } else if (tool === 'special') {
      if (!iSet.has(`${cx},${cy}`)) return
      mutate(d => {
        const arr = (d.interiorSpecials ?? []).filter(c => !(c.x === cx && c.y === cy))
        if (boost !== 'none') arr.push({ x: cx, y: cy, boost })
        d.interiorSpecials = arr.length > 0 ? arr : undefined
      })
    } else if (tool === 'hp' && hpSel) {
      mutate(d => {
        const hp = d.hardpoints.find(h => h.id === hpSel)
        if (hp) { hp.x = cx + 0.5; hp.y = cy + 0.5 }
      })
    } else if (tool === 'fx') {
      mutate(d => {
        const arr = [...(d.effects ?? [])]
        const hit = arr.findIndex(e => Math.floor(e.x) === cx && Math.floor(e.y) === cy)
        if (hit >= 0) arr.splice(hit, 1) // 同格已有特效点 → 点击移除
        else arr.push({ id: `fx-${Date.now() % 100000}`, x: cx + 0.5, y: cy + 0.5, kind: 'smoke', state: 'both' }) // v1.75：生成前不可设类型/时机，固定默认 烟雾+始终，生成后在列表逐项配置
        d.effects = arr.length > 0 ? arr : undefined
      })
    }
  }

  // v2.0：numInput 改由 FortNumInput 承载（聚焦期本地文本，修复负号/小数点等中间态被全受控冲掉，无法输入负数）
  const numInput = (label: string, value: number, set: (v: number) => void, step = 1, steppers = false, compact = false) => (
    <FortNumInput label={label} value={value} set={set} step={step} steppers={steppers} compact={compact} />
  )

  // 炮位坐标底层仍按格保存；编辑器统一以像素显示和输入。
  const hpCoord = (hp: Hardpoint) => {
    const center = fortressLocalCenter(cur)
    const dx = cellsToPixels(hp.x - center.x)
    const dy = cellsToPixels(center.y - hp.y)
    const setDx = (pixels: number) => mutate(d => {
      const h = d.hardpoints.find(x => x.id === hp.id)!
      const c = fortressLocalCenter(d)
      const value = pixelsToCells(pixels)
      h.x = Math.round((c.x + Math.max(-c.x, Math.min(c.x, value))) * 10000) / 10000
    })
    const setDy = (pixels: number) => mutate(d => {
      const h = d.hardpoints.find(x => x.id === hp.id)!
      const c = fortressLocalCenter(d)
      const value = pixelsToCells(pixels)
      h.y = Math.round((c.y - Math.max(-c.y, Math.min(c.y, value))) * 10000) / 10000
    })
    const inp = 'w-14 px-1 py-0.5 text-[11px] border-2 border-black bg-[#EFEBD8]'
    return (
      <span className="flex items-center gap-1 text-[10px] font-comic" title="炮位坐标：原点=载具几何中心；dx 向右为正、dy 向上为正；单位为像素">
        <span className="text-black/70 shrink-0">坐标(px)</span>
        <span className="text-black/50 shrink-0">dx</span>
        <ValidatedNumberInput aria-label={`${hp.id} 炮位dx（像素）`} step={1} value={dx} onChange={e => { const n = Number(e.target.value); if (!Number.isNaN(n)) setDx(n) }} className={inp} />
        <span className="text-black/50 shrink-0">dy</span>
        <ValidatedNumberInput aria-label={`${hp.id} 炮位dy（像素）`} step={1} value={dy} onChange={e => { const n = Number(e.target.value); if (!Number.isNaN(n)) setDy(n) }} className={inp} />
      </span>
    )
  }

  // 画布几何
  const previewCols = view === 'interior' ? cur.interior.cols : cur.w
  const previewRows = view === 'interior' ? cur.interior.rows : cur.h
  const gridCols = 10
  const gridRows = 10
  const px = Math.floor(210 / gridCols)
  const previewAssetScale = px / BASE_CELL
  const runningGearCenter = fortressLocalCenter(cur)
  // 固定 10×10 预览：允许半格偏移，确保载具几何原点精确锁定在窗口中心。
  const offX = gridCols / 2 - runningGearCenter.x
  const offY = gridRows / 2 - runningGearCenter.y
  // 虚拟内部空间独立于载具外形，但自身也始终围绕同一窗口中心展开。
  const cellOffX = view === 'interior' ? gridCols / 2 - previewCols / 2 : offX
  const cellOffY = view === 'interior' ? gridRows / 2 - previewRows / 2 : offY
  const FX_COLOR: Record<FortressEffectKind, string> = { smoke: '#888880', flame: '#D87828', dust: '#96825F', spark: '#F0DC78' }
  useEffect(() => {
    const trackSrcs = (cur.tracks ?? []).map(t => getAsset(t.tile)?.src ?? t.tile) // v1.87：履带瓦片也进尺寸缓存（预览用）
    const wheelSrcs = (cur.wheels ?? []).map(w => resolveAssetSrc(w.sprite)).filter((src): src is string => !!src)
    const rotorSrcs = (cur.rotors ?? []).map(rotor => resolveAssetSrc(rotor.asset)).filter((src): src is string => !!src)
    for (let src of [resolveAssetSrc(cur.spriteBody), ...trackSrcs, ...wheelSrcs, ...rotorSrcs]) {
      if (!src) continue
      src = resCompatUrl(src) // v2.5 兼容旧 /sprites/ 路径
      if (spriteDims[src]) continue
      const im = new Image()
      im.onload = () => setSpriteDims(m => (m[src] ? m : { ...m, [src]: { w: im.naturalWidth, h: im.naturalHeight } }))
      im.src = src
    }
  })
  if (!resolvedBaseDef) {
    return <div className="m-2 border-2 border-[#B3392E] bg-[#E8C9B8] p-4 text-[11px] font-comic text-[#7A1F18]">
      ⚠载具定义引用失效：{selectedId}。编辑器没有回退到“测试堡垒”，请从左侧重新选择有效单位。
    </div>
  }
  /** 贴图预览元素：原尺寸 1:1，中心对准底格（包围盒）中心 */
  const spriteImg = (src: string | undefined, key: string) => {
    src = resolveAssetSrc(src)
    if (!src) return null
    src = resCompatUrl(src) // v2.5 兼容旧 /sprites/ 路径
    const dm = spriteDims[src]
    if (!dm) return null // 尺寸未就绪：本帧跳过，onload 后自动出现
    const center = fortressLocalCenter(cur)
    const box = centeredRect(
      (offX + center.x) * px,
      (offY + center.y) * px,
      dm.w * previewAssetScale,
      dm.h * previewAssetScale,
    )
    return <image key={key} href={src} x={box.x} y={box.y} width={box.w} height={box.h} pointerEvents="none" />
  }
  const walkerSpriteImg = (src: string | undefined, key: string) => {
    src = resolveAssetSrc(src)
    if (!src) return null
    src = resCompatUrl(src)
    const dm = spriteDims[src]
    if (!dm) return null
    const frameWidth = dm.w / WALKER_COLUMNS
    const frameHeight = dm.h / WALKER_ROWS
    const center = fortressLocalCenter(cur)
    const box = centeredRect(
      (offX + center.x) * px + (cur.walkerBodyOffsetX ?? 0) * previewAssetScale,
      (offY + center.y) * px + (cur.walkerBodyOffsetY ?? 0) * previewAssetScale,
      frameWidth * previewAssetScale,
      frameHeight * previewAssetScale,
    )
    const frameInterval = (cur.walkerStride ?? 1) / (WALKER_COLUMNS * Math.max(0.01, cur.speed))
    return <WalkerGridPreview key={key} href={src} x={box.x} y={box.y} width={box.w} height={box.h} sourceWidth={dm.w} sourceHeight={dm.h} frameInterval={frameInterval} />
  }

  return (
    <div className="flex-1 min-h-0 flex">
      {/* 独立使用时保留旧堡垒列表；嵌入单位编辑器时由外层统一单位库接管。 */}
      {!embedded && <div className="w-[96px] shrink-0 overflow-y-auto border-r border-black/30 flex flex-col">
        <div className="p-1 border-b border-black/30">
          <div className="text-[9px] font-black text-black/60 mb-1 truncate" title={`出战：${FORTRESS_DEFS.find(f => f.id === getSelectedFortressId())?.name ?? '测试堡垒'}`}>出战：{FORTRESS_DEFS.find(f => f.id === getSelectedFortressId())?.name ?? '测试堡垒'}</div>
          <button className="comic-btn w-full px-1 py-1 text-[10px] flex items-center justify-center gap-0.5" onClick={createNew}><Plus className="w-3 h-3" />新建</button>
        </div>
        {FORTRESS_DEFS.map(f => (
          <button
            key={f.id}
            title={f.name}
            className={`w-full px-1 py-1.5 text-left border-b border-black/20 ${f.id === selectedId ? 'bg-[#C9C29F] border-l-4 border-l-[#B3392E]' : 'hover:bg-black/5'}`}
            onClick={() => select(f.id)}
          >
            <span className={`block font-comic text-[11px] truncate ${f.id === selectedId ? 'font-black' : ''}`}>
              {f.name}{getSelectedFortressId() === f.id ? '★' : ''}
            </span>
            <span className="block text-[8px] text-black/45 truncate">
              {isBuiltinFortressOverridden(f.id) ? '内置·已改' : (!customs.some(c => c.id === f.id) ? '内置' : '自定义')}
            </span>
          </button>
        ))}
      </div>}
      {/* 右：内容区 */}
      <div className="flex-1 min-w-0 overflow-y-auto p-2 flex flex-col gap-2">

      {/* 操作行 */}
      <div className="flex flex-wrap items-center gap-1">
        <button className="comic-btn px-1.5 py-0.5 text-[10px]" disabled={!canUndo} onClick={undo} title="撤销（Ctrl+Z）">撤销</button>
        <button className="comic-btn px-1.5 py-0.5 text-[10px]" disabled={!canRedo} onClick={redo} title="重做（Ctrl+Y / Ctrl+Shift+Z）">重做</button>
        <button className="comic-btn px-1.5 py-0.5 text-[10px]" onClick={copyAsCustom}>复制为新自定义</button>
        <button
          className={`comic-btn px-1.5 py-0.5 text-[10px] ${(draft || isExternal) && errors.length > 0 ? '!border-[#B3392E] !text-[#B3392E]' : ''}`}
          disabled={!draft && !isExternal}
          onClick={save}
        >保存{draft || isExternal ? (errors.length > 0 ? `（${errors.length} 项待修复）` : '（有改动）') : ''}</button>
        {draft && !isExternal && <button className="comic-btn px-1.5 py-0.5 text-[10px]" onClick={() => select(selectedId)}>放弃改动</button>}
        {!isFactory && (
          <button className="comic-btn px-1.5 py-0.5 text-[10px] flex items-center gap-0.5" onClick={removeOrRestore}>
            <Trash2 className="w-3 h-3" />{overridden ? '恢复出厂' : '删除'}
          </button>
        )}
        {!isExternal && !selectedIsDeployed && <>
          <button className="comic-btn px-1.5 py-0.5 text-[10px]" onClick={() => deploy(false)}>设为出战（下局生效）</button>
          <button className="comic-btn px-1.5 py-0.5 text-[10px]" onClick={() => deploy(true)}>设为出战并重开</button>
        </>}
        {!isExternal && selectedIsDeployed && <span className="text-[10px] font-comic text-black/60">当前出战堡垒</span>}
        {msg && <span className={`text-[10px] font-comic ${msg.startsWith('\u26a0') ? 'text-[#B3392E]' : 'text-[#2E5B2E]'}`}>{msg}</span>}
      </div>

      {/* 基础属性 + 外观与碰撞：同一行、内容驱动等高 */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,0.4fr)_minmax(200px,0.27fr)_minmax(210px,0.33fr)] gap-0 items-stretch">
      {/* 基础属性（内置也可直接改） */}
      <div className="border-2 border-black bg-[#D2CCA9] p-1.5 min-w-0 w-full grid grid-cols-1 sm:grid-cols-2 gap-x-2 gap-y-1 content-start lg:mr-1.5 [&>label]:grid [&>label]:grid-cols-[58px_minmax(0,1fr)] [&>label]:items-center">
        <div className="sm:col-span-2 text-[11px] font-black mb-0.5">基础属性</div>
        <label className="flex items-center gap-1 text-[10px] font-comic">
          <TipLabel text="名称" tip="单位在编辑器、HUD 与事件中的显示名称。" className="text-black/70 shrink-0" />
          <input
            value={cur.name}
            onChange={e => mutate(d => { d.name = e.target.value })}
            className="h-5 w-16 px-1 py-0 text-[10px] border-2 border-black bg-[#EFEBD8]"
          />
        </label>
        <label className="flex items-center gap-1 text-[10px] font-comic">
          <TipLabel text="类型" tip="履带载具使用差速转向；轮式载具使用前轮转向；半履带载具由前轮转向与后履带差速共同控制；气垫载具使用低摩擦惯性移动；步行机甲可原地转向并跨越高度 1 的物体。" className="text-black/70 shrink-0" />
          <select aria-label="单位类型" value={aircraftPlatform ? platformType : cur.chassis ?? 'tracked'} onChange={e => {
            const type = e.target.value
            if (type === 'rotorcraft' || type === 'fixedWingAircraft') {
              if (isExternal) mutate(d => {
                const defaults = defaultUnitTypeConfig(type)
                d.platformType = type
                delete d.tracks
                delete d.wheels
                d.altitude = defaults && (defaults.kind === 'rotorcraft' || defaults.kind === 'fixedWingAircraft') ? defaults.altitude : 1
                d.minAltitude = defaults && (defaults.kind === 'rotorcraft' || defaults.kind === 'fixedWingAircraft') ? defaults.minAltitude : 0.2
                d.maxAltitude = defaults && (defaults.kind === 'rotorcraft' || defaults.kind === 'fixedWingAircraft') ? defaults.maxAltitude : 3
                d.climbRate = defaults && (defaults.kind === 'rotorcraft' || defaults.kind === 'fixedWingAircraft') ? defaults.climbRate : 1
                d.accel = defaults && (defaults.kind === 'rotorcraft' || defaults.kind === 'fixedWingAircraft') ? defaults.accel : d.accel
                d.turnSpeed = defaults && (defaults.kind === 'rotorcraft' || defaults.kind === 'fixedWingAircraft') ? defaults.turnSpeed : d.turnSpeed
                if (defaults?.kind === 'rotorcraft') d.rotors ??= []
                else {
                  delete d.rotors
                  if (defaults?.kind === 'fixedWingAircraft') {
                    d.minFlightSpeed = defaults.minSpeed
                    d.flightTurnRadius = defaults.turnRadius
                  }
                }
              })
              else onUnitTypeChange?.(type, structuredClone(cur))
            }
            else if (isExternal && onGroundTypeChange) onGroundTypeChange(type as NonNullable<FortressDef['chassis']>, structuredClone(cur))
            else mutate(d => {
              d.platformType = 'vehicle'
              d.chassis = type as NonNullable<FortressDef['chassis']>
              if (type !== 'walker') {
                delete d.walkerStride
                delete d.walkerFrameDuration
                delete d.walkerBodyOffsetX
                delete d.walkerBodyOffsetY
                delete d.walkerLowerAsset
                delete d.walkerLowerOffsetX
                delete d.walkerLowerOffsetY
                delete d.walkerFrames
                delete d.walkerFps
              }
              d.runningGearCoordinateSpace = 'centered'
              const leftX = 0.45 - d.w / 2
              if (type === 'hovercraft') {
                d.hoverDrag ??= 0.35
                d.hoverGrip ??= 0.8
                delete d.tracks
                delete d.wheels
              } else if (type === 'walker') {
                d.walkerStride ??= 1
                d.walkerBodyOffsetX ??= 0
                d.walkerBodyOffsetY ??= 0
                delete d.tracks
                delete d.wheels
                delete d.turnRadius
                delete d.trackWidth
                delete d.turnDrag
                delete d.wheelbase
                delete d.steerMax
                delete d.steerRate
                delete d.gripMax
                delete d.hoverDrag
                delete d.hoverGrip
                delete d.pitchGain
                delete d.leanCap
              } else if (type === 'tracked') {
                if (!d.tracks?.length) d.tracks = [{ id: `track1-${Date.now() % 1000}`, x1: leftX, y1: d.h / 2 - 0.8, x2: leftX, y2: 0.8 - d.h / 2, radius: 0.45, tile: 'builtin:library/track01', overlapPx: 2 }]
                delete d.wheels
              } else if (type === 'wheeled') {
                if (!d.wheels?.length) d.wheels = [
                  { id: `wheel1-${Date.now() % 1000}`, x: leftX, y: d.h / 2 - 0.85, unit: 'pair', sprite: 'builtin:vehicle/jeep/wheel', frames: 4, steered: true },
                  { id: `wheel2-${Date.now() % 1000}`, x: leftX, y: 0.85 - d.h / 2, unit: 'pair', sprite: 'builtin:vehicle/jeep/wheel', frames: 4, steered: false },
                ]
                delete d.tracks
              } else if (type === 'halfTracked') {
                if (!d.tracks?.length) d.tracks = [{ id: `track1-${Date.now() % 1000}`, x1: leftX, y1: 0.3, x2: leftX, y2: 0.65 - d.h / 2, radius: 0.45, tile: 'builtin:library/track01', overlapPx: 2 }]
                if (!d.wheels?.length) d.wheels = [{ id: `wheel1-${Date.now() % 1000}`, x: leftX, y: d.h / 2 - 0.85, unit: 'pair', sprite: 'builtin:vehicle/jeep/wheel', frames: 4, steered: true }]
              }
            })
          }} className="h-5 w-24 px-1 py-0 text-[10px] border-2 border-black bg-[#EFEBD8]">
            <option value="tracked">履带载具</option>
            <option value="wheeled">轮式载具</option>
            <option value="halfTracked">半履带载具</option>
            <option value="hovercraft">气垫载具</option>
            <option value="walker">步行机甲</option>
            {(onUnitTypeChange || isExternal) && <><option value="rotorcraft">旋翼飞行器</option><option value="fixedWingAircraft">固定翼飞行器</option></>}
          </select>
        </label>
        {numInput('前装甲', cur.armor?.front ?? 0, v => mutate(d => { d.armor = { ...(d.armor ?? { front: 0, rear: 0, left: 0, right: 0 }), front: Math.max(0, v) } }), 1)}
        {numInput('后装甲', cur.armor?.rear ?? 0, v => mutate(d => { d.armor = { ...(d.armor ?? { front: 0, rear: 0, left: 0, right: 0 }), rear: Math.max(0, v) } }), 1)}
        {numInput('左装甲', cur.armor?.left ?? 0, v => mutate(d => { d.armor = { ...(d.armor ?? { front: 0, rear: 0, left: 0, right: 0 }), left: Math.max(0, v) } }), 1)}
        {numInput('右装甲', cur.armor?.right ?? 0, v => mutate(d => { d.armor = { ...(d.armor ?? { front: 0, rear: 0, left: 0, right: 0 }), right: Math.max(0, v) } }), 1)}
        {numInput('耐久', cur.hp, v => mutate(d => { d.hp = v }), 100)}
        {numInput('击毁奖励', cur.unitReward ?? 40, v => mutate(d => { d.unitReward = Math.max(0, v) }), 5)}
        {numInput('视野', cur.vision ?? 8, v => mutate(d => { d.vision = v; d.trackingVision = Math.max(v, d.trackingVision ?? v * 1.5) }), 0.5)}
        {numInput('追踪视野', cur.trackingVision ?? (cur.vision ?? 8) * 1.5, v => mutate(d => { d.trackingVision = Math.max(d.vision ?? 8, v) }), 0.5)}
        <label className="flex items-center gap-1 text-[10px] font-comic">
          <TipLabel text="重量级别" tip={FORTRESS_PARAM_TIPS['重量级别']} className="text-black/70 shrink-0" />
          <select value={cur.ramWeight ?? ''} onChange={e => mutate(d => { d.ramWeight = (e.target.value || undefined) as FortressDef['ramWeight'] })} className="h-5 w-20 px-1 py-0 text-[10px] border-2 border-black bg-[#EFEBD8]">
            <option value="">自动推导</option>
            <option value="light">轻型</option>
            <option value="medium">中型</option>
            <option value="heavy">重型</option>
          </select>
        </label>
        {numInput('移动速度', cur.speed, v => mutate(d => { d.speed = v }), 0.1)}
        <label className="flex items-center gap-1 text-[10px] font-comic" title="同时锁定单位平移和主体转向；炮塔仍可独立索敌、旋转和开火。">
          <input aria-label="锁定单位移动和转向" type="checkbox" checked={cur.bodyLocked === true} onChange={event => mutate(d => { d.bodyLocked = event.target.checked || undefined })} />
          <TipLabel text="锁定" tip="同时锁定单位平移和主体转向；适合固定火力底座。炮塔仍可独立索敌、旋转和开火；即使没有炮位也不会产生校验提示。" className="text-black/70 shrink-0" />
        </label>
        {numInput('加速度', cur.accel, v => mutate(d => { d.accel = v }), 0.5)}
        {numInput(aircraftPlatform ? '飞行转向速度' : '转向速度', cur.turnSpeed, v => mutate(d => { d.turnSpeed = v }), 5)}
        {aircraftPlatform && <>
          {numInput('初始飞行高度', cur.altitude ?? 1, v => mutate(d => { d.altitude = v }), 0.1)}
          {numInput('最低飞行高度', cur.minAltitude ?? 0.2, v => mutate(d => { d.minAltitude = v }), 0.1)}
          {numInput('最高飞行高度', cur.maxAltitude ?? 3, v => mutate(d => { d.maxAltitude = v }), 0.1)}
          {numInput('升降速度', cur.climbRate ?? 1, v => mutate(d => { d.climbRate = v }), 0.1)}
          {platformType === 'fixedWingAircraft' && <>
            {numInput('最低航速', cur.minFlightSpeed ?? 1, v => mutate(d => { d.minFlightSpeed = v }), 0.1)}
            {numInput('最小转弯半径', cur.flightTurnRadius ?? 2.5, v => mutate(d => { d.flightTurnRadius = v }), 0.1)}
          </>}
        </>}
        {!aircraftPlatform && cur.chassis !== 'hovercraft' && cur.chassis !== 'walker' && numInput('转向半径', cur.turnRadius ?? 0, v => mutate(d => { d.turnRadius = v }), 0.5)}
        {!aircraftPlatform && numInput('倒退系数', cur.reverseFactor ?? 0.8, v => mutate(d => { d.reverseFactor = v }), 0.05)}
        {!aircraftPlatform && cur.chassis !== 'hovercraft' && numInput('刹停惯性', cur.brakeInertia ?? 5, v => mutate(d => { d.brakeInertia = v }), 1)}
        {!aircraftPlatform && cur.chassis === 'hovercraft' && <>
          {numInput('滑行阻力', cur.hoverDrag ?? 0.35, v => mutate(d => { d.hoverDrag = v }), 0.05)}
          {numInput('横向稳定', cur.hoverGrip ?? 0.8, v => mutate(d => { d.hoverGrip = v }), 0.1)}
        </>}
        {!aircraftPlatform && cur.chassis === 'walker' && <>
          {numInput('步幅', cellsToMeters(cur.walkerStride ?? 1), v => mutate(d => { d.walkerStride = metersToCells(v) }), 0.16)}
        </>}
        {!aircraftPlatform && cur.chassis !== 'walker' && numInput('车身俯仰', cur.pitchGain ?? 4, v => mutate(d => { d.pitchGain = v }), 1)}
        {!aircraftPlatform && cur.chassis !== 'walker' && numInput('俯仰位移', cur.leanCap ?? 4, v => mutate(d => { d.leanCap = v }), 1)}
        {!aircraftPlatform && ((cur.chassis ?? 'tracked') === 'tracked' || cur.chassis === 'halfTracked') && (<>
          {numInput('履带间距', cur.trackWidth ?? cur.w, v => mutate(d => { d.trackWidth = v }), 0.5)}
          {numInput('转向阻力', cur.turnDrag ?? 0, v => mutate(d => { d.turnDrag = v }), 0.1)}
        </>)}
        {!aircraftPlatform && (cur.chassis === 'wheeled' || cur.chassis === 'halfTracked') && (<>
          {numInput('轴距', cur.wheelbase ?? Math.round(cur.h * 0.6 * 10) / 10, v => mutate(d => { d.wheelbase = v }), 0.5)}
          {numInput('前轮转角°', cur.steerMax ?? 35, v => mutate(d => { d.steerMax = v }), 5)}
          {numInput('方向盘°/s', cur.steerRate ?? 120, v => mutate(d => { d.steerRate = v }), 10)}
          {numInput('附着m/s²', cur.gripMax ?? 1.024, v => mutate(d => { d.gripMax = v }), 0.1)}
        </>)}
        <label className="flex items-center gap-1 text-[10px] font-comic"><TipLabel text="移动音效" tip="只使用当前单位配置的移动音效，未配置时保持静音。旋翼飞行器正常飞行时静止音量为 10%，达到最大速度的 80% 时为 100%；进入坠毁时从 100% 开始逐渐衰减。" className="text-black/70 shrink-0" /><SoundAssetSelect ariaLabel="载具移动音效" channel="unit" loop value={cur.sounds?.movement} onChange={value => mutate(d => { d.sounds = { ...(d.sounds ?? {}), movement: value } })} /></label>
        {numInput('热量上限', cur.heatCap, v => mutate(d => { d.heatCap = v }), 10)}
        {numInput('自然散热', cur.heatDissipation, v => mutate(d => { d.heatDissipation = v }), 1)}
      </div>

      {/* 外观区：名称后直接接选项，每项独占一行 */}
      <div className="border-2 border-black bg-[#D2CCA9] p-1.5 min-w-0 flex flex-col gap-1 lg:col-start-3 lg:row-start-1 lg:border-l-0">
      <div className="text-[10px] font-black">外观与碰撞</div>
      <div className="flex flex-col gap-1">
        {(() => {
          const current = vehicleAssets.find(a => a.id === cur.spriteBody || a.src === cur.spriteBody)
          const legacy = cur.spriteBody && !current ? cur.spriteBody : ''
          return <div className="flex items-center gap-1">
            <TipLabel text={cur.chassis === 'walker' ? '主体素材' : '载具素材'} tip={cur.chassis === 'walker' ? '固定按 2 行×7 列切为 14 帧；第 1 帧为站立图，移动时依次循环。第一帧透明边缘用于生成物理碰撞轮廓。' : '完整载具贴图；选择后会按透明边缘自动生成物理碰撞轮廓。'} className="w-[74px] shrink-0 text-[10px] font-comic text-black/70" />
            <select
              aria-label="载具素材"
              className="h-5 min-w-0 flex-1 px-1 py-0 text-[9px] font-comic border-2 border-black bg-[#EFEBD8]"
              value={current?.id ?? legacy}
              onChange={e => mutate(d => {
                if (e.target.value) {
                  d.spriteBody = e.target.value
                } else {
                  delete d.spriteBody
                }
                delete d.spriteBase
                delete d.bodyCollision
              })}
            >
              <option value="">无（程序化回退）</option>
              {legacy && <option value={legacy}>旧内嵌贴图（保留）</option>}
              <optgroup label="内置">{vehicleAssets.filter(a => a.builtin).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</optgroup>
              <optgroup label="已上传">{vehicleAssets.filter(a => !a.builtin).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</optgroup>
            </select>
          </div>
        })()}
        <div className="flex items-center gap-1">
          <TipLabel text="摧毁效果" tip="单位被摧毁时的统一表现模板。剧烈爆炸会播放多重爆炸；四档均包含残骸、碎片飞溅和黑色浓烟，强度随档位提升。" className="w-[74px] shrink-0 text-[10px] font-comic text-black/70" />
          <select aria-label="载具摧毁效果" className="h-5 min-w-0 flex-1 px-1 py-0 text-[9px] font-comic border-2 border-black bg-[#EFEBD8]" value={resolveUnitDestructionEffect(cur.destructionEffect, cur.w, cur.h)} onChange={event => mutate(d => { d.destructionEffect = event.target.value as 'small' | 'medium' | 'large' | 'violent' })}>
            <option value="small">小型爆炸</option><option value="medium">中型爆炸</option><option value="large">大型爆炸</option><option value="violent">剧烈爆炸</option>
          </select>
        </div>
        {view === 'exterior' && cur.chassis === 'walker' && <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <TipLabel text="坐标修正" tip="修正主体序列帧素材中心相对单位几何原点的位置；X 正值向右，Y 正值向下。碰撞轮廓会按相同偏移重建。" className="w-[74px] shrink-0 text-[10px] font-comic text-black/70" />
          {numInput('X(px)', cur.walkerBodyOffsetX ?? 0, value => mutate(d => { d.walkerBodyOffsetX = value }), 1, false, true)}
          {numInput('Y(px)', cur.walkerBodyOffsetY ?? 0, value => mutate(d => { d.walkerBodyOffsetY = value }), 1, false, true)}
        </div>}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-black/25 pt-1">
          <TipLabel text="虚拟内部空间" tip="用于摆放模块的独立虚拟格子空间，不依照载具贴图或碰撞轮廓排布。" className="w-[74px] shrink-0 text-[10px] font-comic text-black/70" />
          {numInput('列数', cur.interior.cols, v => mutate(d => {
            d.interior.cols = Math.max(1, Math.min(30, Math.floor(v)))
            d.interiorCells = d.interiorCells?.filter(key => Number(key.split(',')[0]) < d.interior.cols)
            d.interiorSpecials = d.interiorSpecials?.filter(cell => cell.x < d.interior.cols)
          }), 1, false, true)}
          {numInput('行数', cur.interior.rows, v => mutate(d => {
            d.interior.rows = Math.max(1, Math.min(30, Math.floor(v)))
            d.interiorCells = d.interiorCells?.filter(key => Number(key.split(',')[1]) < d.interior.rows)
            d.interiorSpecials = d.interiorSpecials?.filter(cell => cell.y < d.interior.rows)
          }), 1, false, true)}
        </div>
      </div>

      {view === 'exterior' && (
        <div className="flex flex-col gap-1">
          <div className="grid grid-cols-2 gap-1">
            <label className="grid grid-cols-[44px_minmax(0,1fr)] items-center gap-1 text-[10px] font-comic"><TipLabel text="载具色" tip="对载具贴图进行乘法染色；不改变履带和轮胎。" />
              <input type="color" value={cur.paint?.base ?? '#FFFFFF'} onChange={e => mutate(d => { d.paint = { ...d.paint, base: e.target.value, accent: d.paint?.accent ?? '#C8B568' } })} className="h-5 w-8 border-2 border-black" />
            </label>
            <label className="grid grid-cols-[44px_minmax(0,1fr)] items-center gap-1 text-[10px] font-comic"><TipLabel text="强调色" tip="不会自动生成车头箭头或其他图形；当前仅保留颜色设置。只有从素材库选择并添加徽记后，才会显示对应徽记贴图。" />
              <input type="color" value={cur.paint?.accent ?? '#C8B568'} onChange={e => mutate(d => { d.paint = { ...d.paint, base: d.paint?.base ?? '#FFFFFF', accent: e.target.value } })} className="h-5 w-8 border-2 border-black" />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-1">
            <label className="grid grid-cols-[44px_minmax(0,1fr)] items-center gap-1 text-[10px] font-comic"><TipLabel text="炮塔色" tip="对安装在该单位炮位上的全部炮塔素材进行乘法染色，使炮塔与载具保持统一配色；不改变弹丸和开火特效。" />
              <input type="color" aria-label="炮塔色" value={cur.paint?.turret ?? '#FFFFFF'} onChange={e => mutate(d => { d.paint = { ...d.paint, base: d.paint?.base ?? '#FFFFFF', accent: d.paint?.accent ?? '#C8B568', turret: e.target.value } })} className="h-5 w-8 border-2 border-black" />
            </label>
            <label className="grid grid-cols-[44px_minmax(0,1fr)] items-center gap-1 text-[10px] font-comic"><TipLabel text="徽记" tip="从素材库选择一个单位徽记；选择“无”时不显示徽记。" /><select aria-label="单位徽记素材" value={cur.decals?.[0]?.asset ?? ''} onChange={e => mutate(d => { if (!e.target.value) { delete d.decals; return } const c = fortressLocalCenter(d); const first = d.decals?.[0]; d.decals = [{ id: first?.id ?? `decal-${Date.now()}`, asset: e.target.value, x: first?.x ?? c.x, y: first?.y ?? c.y, size: first?.size ?? 1, angle: first?.angle ?? 0 }] })} className="h-5 min-w-0 px-1 py-0 text-[9px] font-comic border-2 border-black bg-[#EFEBD8]"><option value="">无</option><optgroup label="内置">{decalAssets.filter(a => a.builtin).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</optgroup><optgroup label="已上传">{decalAssets.filter(a => !a.builtin).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</optgroup></select></label>
          </div>
        </div>
      )}
      <div className="mt-1 grid grid-cols-2 gap-1">
        {([['exterior', '外部模式'], ['interior', '内部模式']] as const).map(([k, label]) => <button key={k} className={`comic-btn h-5 w-full px-1 py-0 text-[8px] ${view === k ? 'bg-[#B3392E] text-[#EFEBD8]' : ''}`} onClick={() => { setView(k); setTool('none') }}>{label}</button>)}
        {view === 'exterior' ? <><button className={`comic-btn h-5 w-full px-1 py-0 text-[8px] ${tool === 'hp' ? 'bg-[#B3392E] text-[#EFEBD8]' : ''}`} onClick={() => setTool('hp')}>炮位落点</button><button className={`comic-btn h-5 w-full px-1 py-0 text-[8px] ${tool === 'fx' ? 'bg-[#B3392E] text-[#EFEBD8]' : ''}`} onClick={() => setTool('fx')}>特效点</button><span className="col-span-2 text-[8px] text-black/45">碰撞边缘由载具贴图自动生成</span></> : <><button type="button" aria-pressed={tool === 'icell'} className={`comic-btn h-5 w-full px-1 py-0 text-[8px] ${tool === 'icell' ? 'bg-[#B3392E] text-[#EFEBD8]' : ''}`} onClick={() => setTool(current => current === 'icell' ? 'none' : 'icell')}>铺/擦内部格</button><button className={`comic-btn h-5 w-full px-1 py-0 text-[8px] ${tool === 'special' ? 'bg-[#B3392E] text-[#EFEBD8]' : ''}`} onClick={() => setTool('special')}>特殊格</button><button className="comic-btn h-5 w-full px-1 py-0 text-[8px]" onClick={() => mutate(d => { d.interiorCells = undefined })}>重置为矩形</button></>}
      </div>
      {view === 'interior' && tool === 'special' && <select value={boost} onChange={e => setBoost(e.target.value as SpecialBoost | 'none')} className="w-full px-1 py-0.5 text-[9px] font-comic border-2 border-black bg-[#EFEBD8]"><option value="none">清除特殊格</option>{BOOST_KEYS.map(b => <option key={b} value={b}>{SPECIAL_BOOST_NAME[b]}加成 ×1.5</option>)}</select>}
      <div className="mt-auto grid grid-cols-[auto_1fr] items-end gap-1 pt-1">
        <PreviewZoom value={previewZoom} onChange={setPreviewZoom} overlay={false} compact />
        <div className="flex h-6 items-center justify-end gap-2 border-2 border-black bg-[#EFEBD8] px-1.5 text-[9px] font-comic">
          <label className="flex cursor-pointer items-center gap-0.5 whitespace-nowrap">
            <input type="checkbox" aria-label="显示轮廓" checked={showOutline} onChange={event => setShowOutline(event.target.checked)} />
            轮廓
          </label>
          <label className="flex cursor-pointer items-center gap-0.5 whitespace-nowrap">
            <input type="checkbox" aria-label="显示点位" checked={showPoints} onChange={event => setShowPoints(event.target.checked)} />
            点位
          </label>
          <label className="flex cursor-pointer items-center gap-0.5 whitespace-nowrap">
            <input type="checkbox" aria-label="显示炮塔" checked={showTurrets} onChange={event => setShowTurrets(event.target.checked)} />
            炮塔
          </label>
          {((cur.tracks?.length ?? 0) > 0 || (cur.wheels?.length ?? 0) > 0) && <label className="flex cursor-pointer items-center gap-0.5 whitespace-nowrap">
            <input type="checkbox" aria-label="显示轮半径" checked={showWheelRadius} onChange={event => setShowWheelRadius(event.target.checked)} />
            轮半径
          </label>}
        </div>
      </div>
      </div>

      {/* 预览与操作属于外观与碰撞；参数区在其后统一双栏。 */}
      <div className="contents">
      {/* 预览模式 + 子工具 */}
      <div className="grid min-w-0 place-items-center overflow-hidden border-2 border-black bg-[#D2CCA9] p-1.5 lg:col-start-2 lg:row-start-1 lg:border-r-0">
        <div className="relative col-start-1 row-start-1 mx-auto overflow-hidden border border-black/30 bg-[#EFEBD8]" style={{ width: gridCols * px, height: gridRows * px }}>
        <svg aria-label="载具预览网格 10×10" data-preview-grid="10x10" width={gridCols * px} height={gridRows * px} className="block touch-none select-none transition-transform duration-150" style={{ transform: `scale(${previewZoom / 100})` }}>
          <defs>
            <filter id="fortress-paint-preview" colorInterpolationFilters="sRGB">
              <feFlood floodColor={cur.paint?.base ?? cur.color} result="paint" />
              <feBlend in="SourceGraphic" in2="paint" mode="multiply" result="colored" />
              <feComposite in="colored" in2="SourceAlpha" operator="in" />
            </filter>
          </defs>
          {Array.from({ length: gridCols * gridRows }, (_, i) => {
            const gx = i % gridCols
            const gy = Math.floor(i / gridCols)
            return <rect key={`preview-grid-${i}`} x={gx * px} y={gy * px} width={px} height={px} fill="transparent" stroke="rgba(0,0,0,0.25)" strokeWidth={0.5} pointerEvents="none" />
          })}
          {Array.from({ length: previewCols * previewRows }, (_, i) => {
            const cx = i % previewCols
            const cy = Math.floor(i / previewCols)
            const x = (cx + cellOffX) * px
            const y = (cy + cellOffY) * px
            const interactive = tool !== 'none'
            const k = `${cx},${cy}`
            const inInterior = view === 'interior' && iSet.has(k)
            const sp = view === 'interior' ? (cur.interiorSpecials ?? []).find(c => c.x === cx && c.y === cy) : undefined
            const fill = inInterior ? 'rgba(60,64,56,0.82)' : 'transparent'
            return (
              <g
                key={`preview-cell-${cx}-${cy}`}
                data-grid-cell={view === 'interior' ? 'unit-interior' : 'unit-exterior'}
                data-cell-x={cx}
                data-cell-y={cy}
                onPointerDown={event => { if (event.button === 0 && interactive) { event.preventDefault(); clickCell(cx, cy) } }}
                className={interactive ? 'cursor-pointer' : ''}
              >
                <rect x={x} y={y} width={px} height={px}
                  fill={sp ? 'rgba(180,140,60,0.55)' : fill}
                  stroke={inInterior ? 'rgba(46,91,46,0.72)' : 'transparent'} strokeWidth={inInterior ? 0.9 : 0} />
                {sp && <text x={x + px / 2} y={y + px / 2 + 3} textAnchor="middle" fontSize={px * 0.42} fill="#EFEBD8" pointerEvents="none">{SPECIAL_BOOST_NAME[sp.boost][0]}</text>}
              </g>
            )
          })}
          {view === 'exterior' && !aircraftPlatform && ((cur.chassis ?? 'tracked') === 'tracked' || cur.chassis === 'halfTracked') && (cur.tracks ?? []).map(t => { // 履带/半履带预览按当前设置真实渲染履带瓦片
            const src = getAsset(t.tile)?.src ?? t.tile
            const dm = src ? spriteDims[src] : undefined
            if (!src || !dm) return null
            const tileLenC = dm.h / BASE_CELL
            const wpxP = (dm.w / BASE_CELL) * px // 图宽原尺寸
            const els = []
            for (const mirror of [false, true]) {
              for (const pl of centeredTrackPlacements(cur, t, 0, tileLenC)) {
                const hpx = tileLenC * pl.scaleY * px
                if (hpx < 0.3) continue
                const cxP = (runningGearCenter.x + (mirror ? -pl.x : pl.x) + offX) * px
                const cyP = (runningGearCenter.y - pl.y + offY) * px
                els.push(<image key={`${mirror ? 'r' : 'l'}-${els.length}`} href={src} x={cxP - wpxP / 2} y={cyP - hpx / 2}
                  width={wpxP} height={hpx} opacity={pl.alpha} preserveAspectRatio="none" pointerEvents="none"
                  transform={mirror ? `translate(${2 * cxP} 0) scale(-1 1)` : undefined} />)
              }
            }
            if (showWheelRadius) {
              // 轮圆标定参考线（细线，不遮挡瓦片）
              const front = runningGearPoint(cur, t.x1, t.y1)
              const rear = runningGearPoint(cur, t.x2, t.y2)
              for (const mirror of [false, true]) {
                const mx = (x: number) => runningGearCenter.x + (mirror ? -x : x)
                els.push(<circle data-wheel-radius-reference="track" key={`wc${mirror ? 'r' : 'l'}1`} cx={(mx(front.x) + offX) * px} cy={(runningGearCenter.y - front.y + offY) * px} r={t.radius * px} fill="none" stroke="#B3392E" strokeWidth={0.8} strokeOpacity={0.5} pointerEvents="none" />)
                els.push(<circle data-wheel-radius-reference="track" key={`wc${mirror ? 'r' : 'l'}2`} cx={(mx(rear.x) + offX) * px} cy={(runningGearCenter.y - rear.y + offY) * px} r={t.radius * px} fill="none" stroke="#B3392E" strokeWidth={0.8} strokeOpacity={0.5} pointerEvents="none" />)
              }
            }
            return <g key={t.id}>{els}</g>
          })}
          {!aircraftPlatform && (cur.chassis === 'wheeled' || cur.chassis === 'halfTracked') && (cur.wheels ?? []).map(wd => {
            const src51 = wd.sprite ? (getAsset(wd.sprite)?.src ?? wd.sprite) : null
            const dm51 = src51 ? spriteDims[src51] : undefined
            const frames51 = wheelFrameCount(wd)
            const sizeScale = px / BASE_CELL
            const twW = (dm51 ? dm51.w / frames51 : 11) * sizeScale
            const thH = (dm51?.h ?? 20) * sizeScale
            return (
              <g key={wd.id} pointerEvents="none">
                {wheelPlacements(cur, wd).map(p => {
                  const wpx51 = (runningGearCenter.x + p.x + offX) * px
                  const wpy51 = (runningGearCenter.y - p.y + offY) * px
                  return <g key={p.mirror ? 'mirror' : 'single'} transform={p.mirror ? `translate(${2 * wpx51} 0) scale(-1 1)` : undefined}>
                    {src51 && dm51 ? (
                      <WheelStripPreview key={`${src51}:${frames51}`} href={src51} x={wpx51 - twW / 2} y={wpy51 - thH / 2} width={twW} height={thH}
                        sourceWidth={dm51.w} sourceHeight={dm51.h} frames={frames51} />
                    ) : (
                      <rect x={wpx51 - twW / 2} y={wpy51 - thH / 2} width={twW} height={thH} rx={twW * 0.35}
                        fill="#2A2A28" stroke="#1A1A18" strokeWidth={0.8} />
                    )}
                    {showWheelRadius && <>
                      <ellipse data-wheel-radius-reference="wheel" cx={wpx51} cy={wpy51} rx={twW / 2} ry={thH / 2} fill="none" stroke="#B3392E" strokeWidth={0.8} strokeOpacity={0.5} />
                      <line data-wheel-radius-reference="wheel" x1={wpx51} y1={wpy51 - thH * 0.28} x2={wpx51} y2={wpy51 + thH * 0.28}
                        stroke={wd.steered ? '#B3392E' : '#8C8878'} strokeWidth={0.8} />
                    </>}
                  </g>
                })}
              </g>
            )
          })}
          {view === 'exterior' && showTurrets && (
            <foreignObject x={0} y={0} width={gridCols * px} height={gridRows * px} pointerEvents="none">
              <BuiltInTurretPreviewLayer def={cur} offX={offX} offY={offY} cell={px} width={gridCols * px} height={gridRows * px} placement="below" />
            </foreignObject>
          )}
          {view === 'exterior' && platformType === 'rotorcraft' && (cur.rotors ?? []).filter(rotor => (rotor.layer ?? 'above') === 'below').flatMap(rotor => {
            const src = resolveAssetSrc(rotor.asset)
            const dm = src ? spriteDims[resCompatUrl(src)] ?? spriteDims[src] : undefined
            if (!src || !dm) return []
            return rotorPlacements(rotor).map((placement, index) => {
              const center = fortressLocalCenter(cur)
              const cx = (offX + center.x) * px + placement.x * previewAssetScale
              const cy = (offY + center.y) * px + placement.y * previewAssetScale
              const width = dm.w * previewAssetScale
              const height = dm.h * previewAssetScale
              const duration = placement.speed === 0 ? 999999 : 360 / Math.abs(placement.speed)
              return <g key={`${rotor.id}-${index}`} transform={`translate(${cx} ${cy})`} pointerEvents="none">
                <image href={resCompatUrl(src)} x={-width / 2} y={-height / 2} width={width} height={height} />
                {placement.speed !== 0 && <animateTransform attributeName="transform" type="rotate" from="0" to={placement.speed < 0 ? '-360' : '360'} dur={`${duration}s`} repeatCount="indefinite" additive="sum" />}
              </g>
            })
          })}
          {view === 'exterior' && <g filter={cur.paint?.base ? 'url(#fortress-paint-preview)' : undefined}>
            {cur.chassis === 'walker' ? walkerSpriteImg(cur.spriteBody, 'vehicle-e') : spriteImg(cur.spriteBody, 'vehicle-e')}
          </g>}
          {view === 'exterior' && platformType === 'rotorcraft' && (cur.rotors ?? []).filter(rotor => (rotor.layer ?? 'above') === 'above').flatMap(rotor => {
            const src = resolveAssetSrc(rotor.asset)
            const dm = src ? spriteDims[resCompatUrl(src)] ?? spriteDims[src] : undefined
            if (!src || !dm) return []
            return rotorPlacements(rotor).map((placement, index) => {
              const center = fortressLocalCenter(cur)
              const cx = (offX + center.x) * px + placement.x * previewAssetScale
              const cy = (offY + center.y) * px + placement.y * previewAssetScale
              const width = dm.w * previewAssetScale
              const height = dm.h * previewAssetScale
              const duration = placement.speed === 0 ? 999999 : 360 / Math.abs(placement.speed)
              return <g key={`${rotor.id}-${index}`} transform={`translate(${cx} ${cy})`} pointerEvents="none">
                <image href={resCompatUrl(src)} x={-width / 2} y={-height / 2} width={width} height={height} />
                {placement.speed !== 0 && <animateTransform attributeName="transform" type="rotate" from="0" to={placement.speed < 0 ? '-360' : '360'} dur={`${duration}s`} repeatCount="indefinite" additive="sum" />}
              </g>
            })
          })}
          {view === 'exterior' && showTurrets && (
            <foreignObject x={0} y={0} width={gridCols * px} height={gridRows * px} pointerEvents="none">
              <BuiltInTurretPreviewLayer def={cur} offX={offX} offY={offY} cell={px} width={gridCols * px} height={gridRows * px} placement="above" />
            </foreignObject>
          )}
          {view === 'exterior' && showOutline && cur.bodyCollision?.points.length && (() => {
            const center = fortressLocalCenter(cur)
            const points = cur.bodyCollision.points.map(point => `${(offX + center.x + point.x) * px},${(offY + center.y + point.y) * px}`).join(' ')
            return <polygon data-body-collision-outline="true" points={points} fill="none" stroke="#B3392E" strokeWidth={1.25} strokeDasharray="4 2" pointerEvents="none" />
          })()}
          {view === 'exterior' && (cur.decals ?? []).map(decal => {
            const a = getAsset(decal.asset)
            if (!a) return null
            const sz = Math.max(0.1, decal.size) * px
            const dm = spriteDims[a.src]
            const ratio = dm ? dm.w / Math.max(1, dm.h) : 1
            return <image key={decal.id} href={a.src} x={(decal.x + offX) * px - sz * ratio / 2} y={(decal.y + offY) * px - sz / 2} width={sz * ratio} height={sz} transform={`rotate(${decal.angle ?? 0} ${(decal.x + offX) * px} ${(decal.y + offY) * px})`} pointerEvents="none" />
          })}
          {view === 'exterior' && showPoints && (() => {
            // 选中炮位的视界范围（相对船头 0=上 顺时针，支持跨 0°；半径取画布对角线，超出部分由 svg 自动裁切）
            const hp = cur.hardpoints.find(h => h.id === hpSel)
            if (!hp) return null
            const hx = (hp.x + offX) * px
            const hy = (hp.y + offY) * px
            const R = Math.hypot(gridCols * px, gridRows * px)
            const omni = <circle cx={hx} cy={hy} r={R} fill="rgba(126,160,110,0.10)" stroke="rgba(46,91,46,0.55)" strokeWidth={1} strokeDasharray="5 4" pointerEvents="none" />
            if (hp.fixed !== undefined) { // v1.98 固定视角：单射线
              const af = (hp.fixed - 90) * Math.PI / 180
              return <line x1={hx} y1={hy} x2={hx + R * Math.cos(af)} y2={hy + R * Math.sin(af)} stroke="#2E5B2E" strokeWidth={1.6} pointerEvents="none" />
            }
            if (!hp.arc) return omni // 未设视界 = 全向
            const span = ((hp.arc.end - hp.arc.start) % 360 + 360) % 360
            if (span === 0) return omni
            const a0 = (hp.arc.start - 90) * Math.PI / 180 // 画布角 0=+X 轴，需 -90° 换算（与战场渲染一致）
            const a1 = (hp.arc.end - 90) * Math.PI / 180
            return (
              <path
                d={`M ${hx} ${hy} L ${hx + R * Math.cos(a0)} ${hy + R * Math.sin(a0)} A ${R} ${R} 0 ${span > 180 ? 1 : 0} 1 ${hx + R * Math.cos(a1)} ${hy + R * Math.sin(a1)} Z`}
                fill="rgba(126,160,110,0.16)" stroke="#2E5B2E" strokeWidth={1.2} pointerEvents="none"
              />
            )
          })()}
          {view === 'exterior' && (() => { // 载具几何原点固定在预览窗口中心
            const center = fortressLocalCenter(cur)
            const ox = (center.x + offX) * px
            const oy = (center.y + offY) * px
            return (
              <g data-unit-origin-marker="true" pointerEvents="none">
                <line x1={ox - 5} y1={oy} x2={ox + 5} y2={oy} stroke="#B3392E" strokeWidth={1.5} />
                <line x1={ox} y1={oy - 5} x2={ox} y2={oy + 5} stroke="#B3392E" strokeWidth={1.5} />
              </g>
            )
          })()}
          {view === 'exterior' && showPoints && cur.hardpoints.map(hp => (
            <g key={hp.id} pointerEvents="none">
              <circle cx={(hp.x + offX) * px} cy={(hp.y + offY) * px} r={px * (hp.size === 'L' ? 0.42 : hp.size === 'M' ? 0.34 : 0.26)}
                fill={(hp.hideTurretArt ?? hp.hidden) ? 'rgba(80,80,80,0.7)' : 'rgba(200,181,104,0.85)'}
                stroke={hpSel === hp.id ? '#B3392E' : '#1A1A18'} strokeWidth={hpSel === hp.id ? 2.5 : 1} />
              <text x={(hp.x + offX) * px} y={(hp.y + offY) * px + 3} textAnchor="middle" fontSize={px * 0.36} fill="#1A1A18">{hp.size}</text>
            </g>
          ))}
          {view === 'exterior' && showPoints && (cur.effects ?? []).map(e => (
            <g key={e.id} pointerEvents="none">
              <circle cx={(e.x + offX) * px} cy={(e.y + offY) * px} r={px * 0.16} fill={FX_COLOR[e.kind]} stroke="#1A1A18" strokeWidth={0.8} />
              <text x={(e.x + offX) * px} y={(e.y + offY) * px - px * 0.22} textAnchor="middle" fontSize={px * 0.28} fill="#1A1A18">
                {EFFECT_KIND_NAME[e.kind][0]}{e.state === 'idle' ? '停' : e.state === 'move' ? '动' : ''}
              </text>
            </g>
          ))}
        </svg>
        </div>
      </div>

      {/* 参数区（PC 端位于预览右侧，随外部/内部模式切换） */}
      <div className="min-w-0 w-full grid grid-cols-1 lg:grid-cols-[minmax(0,0.4fr)_minmax(0,0.6fr)] gap-1.5 lg:col-span-3">
      {view === 'exterior' && (
      <div className="min-w-0 flex flex-col gap-1.5 self-start">
      {/* 外部模式：特效点列表 */}
      {view === 'exterior' && (
        <div className="border-2 border-black bg-[#D2CCA9] p-1.5">
          <div className="flex items-center gap-1 mb-1">
            <span className="text-[10px] font-black text-black/70">特效点</span>
            <button className="comic-btn px-1.5 py-0.5 text-[10px] flex items-center gap-0.5" onClick={() => mutate(d => {
              const center = fortressLocalCenter(d)
              d.effects = [...(d.effects ?? []), { id: `fx-${Date.now() % 100000}`, x: center.x, y: center.y, kind: 'smoke', state: 'both' }]
            })}><Plus className="w-3 h-3" />添加</button>
          </div>
          <div className="flex flex-col gap-1">
            {(cur.effects ?? []).map(e => (
              <div key={e.id} className="flex flex-wrap items-center gap-1 border border-black/40 px-1 py-0.5 text-[10px] font-comic">
                <i className="inline-block w-2.5 h-2.5 rounded-full border border-black/50" style={{ background: FX_COLOR[e.kind] }} />
                {/* v1.75：生成后可配置——停止时/移动时可选用不同特效；坐标可手填，最小调整单位 0.1 */}
                <select value={e.kind} onChange={ev => mutate(d => { d.effects!.find(x => x.id === e.id)!.kind = ev.target.value as FortressEffectKind })} className="px-0.5 py-0 text-[10px] font-comic border border-black bg-[#EFEBD8]">
                  {EFFECT_KIND_KEYS.map(k => <option key={k} value={k}>{EFFECT_KIND_NAME[k]}</option>)}
                </select>
                <select value={e.state} onChange={ev => mutate(d => { d.effects!.find(x => x.id === e.id)!.state = ev.target.value as FortressEffectState })} className="px-0.5 py-0 text-[10px] font-comic border border-black bg-[#EFEBD8]">
                  {(Object.keys(EFFECT_STATE_NAME) as FortressEffectState[]).map(st => <option key={st} value={st}>{EFFECT_STATE_NAME[st]}</option>)}
                </select>
                {/* v2.40：渲染层级（缺省 尘土=地面/其余=空中）；地面层 = 载具及行走部件之下 */}
                <select value={e.layer ?? (e.kind === 'dust' ? 'ground' : 'air')} onChange={ev => mutate(d => { d.effects!.find(x => x.id === e.id)!.layer = ev.target.value as FortressEffectLayer })} title="渲染层级：地面=载具及行走部件之下，空中=最上" className="px-0.5 py-0 text-[10px] font-comic border border-black bg-[#EFEBD8]">
                  {(Object.keys(EFFECT_LAYER_NAME) as FortressEffectLayer[]).map(l => <option key={l} value={l}>{EFFECT_LAYER_NAME[l]}</option>)}
                </select>
                {numInput('x', e.x, v => mutate(d => { d.effects!.find(x => x.id === e.id)!.x = v }), 0.1, true, true)}
                {numInput('y', e.y, v => mutate(d => { d.effects!.find(x => x.id === e.id)!.y = v }), 0.1, true, true)}
                <button className="ml-auto text-[#B3392E] font-black" onClick={() => mutate(d => { d.effects = (d.effects ?? []).filter(x => x.id !== e.id); if (d.effects.length === 0) d.effects = undefined })}>×</button>
              </div>
            ))}
          </div>
          {(cur.effects ?? []).length === 0 && <span className="text-[10px] text-black/40">未配置特效点，可在上方预览选择“特效点”后点击画布添加。</span>}
        </div>
      )}

      {/* 旋翼飞行器专属：与履带/轮胎一样作为共用载具平台的动态部件。 */}
      {view === 'exterior' && platformType === 'rotorcraft' && (
        <div className="border-2 border-black bg-[#D2CCA9] p-1.5">
          <div className="flex items-center gap-1 mb-1">
            <span className="text-[10px] font-black text-black/70">动态旋翼：</span>
            <button className="comic-btn px-1.5 py-0.5 text-[10px] flex items-center gap-0.5" onClick={() => mutate(d => {
              d.rotors = [...(d.rotors ?? []), { id: `rotor${(d.rotors ?? []).length + 1}-${Date.now() % 1000}`, asset: rotorAssets[0]?.id ?? '', layer: 'above', unit: 'single', x: 0, y: 0, speed: 720 }]
            })}><Plus className="w-3 h-3" />添加</button>
          </div>
          <div className="flex flex-col gap-1.5">
            {(cur.rotors ?? []).map((rotor, index) => <div key={rotor.id} className="border border-black/40 p-1">
              <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                <span className="text-[10px] font-black">旋翼 {index + 1}</span>
                <TipLabel text="素材" tip="旋翼素材按原始像素尺寸显示。" className="text-[10px] font-comic text-black/70" />
                <select aria-label={`旋翼${index + 1}素材`} value={rotor.asset} onChange={event => mutate(d => { const item = d.rotors?.find(value => value.id === rotor.id); if (item) item.asset = event.target.value })} className="max-w-40 px-1 py-0 text-[10px] border border-black bg-[#EFEBD8]">
                  <option value="">未配置</option>
                  {rotor.asset && !rotorAssets.some(asset => asset.id === rotor.asset) && <option value={rotor.asset}>当前旧引用</option>}
                  {rotorAssets.map(asset => <option key={asset.id} value={asset.id}>{asset.name}</option>)}
                </select>
                <label className="flex items-center gap-1 text-[10px] font-comic"><TipLabel text="层级" tip="上：绘制在载具主体上方；下：绘制在载具主体下方并被主体遮挡。" /><select aria-label={`旋翼${index + 1}层级`} value={rotor.layer ?? 'above'} onChange={event => mutate(d => { const item = d.rotors?.find(value => value.id === rotor.id); if (item) item.layer = event.target.value === 'below' ? 'below' : 'above' })} className="px-1 py-0 text-[10px] border border-black bg-[#EFEBD8]"><option value="above">上</option><option value="below">下</option></select></label>
                <select aria-label={`旋翼${index + 1}单位`} value={rotor.unit ?? 'single'} onChange={event => mutate(d => { const item = d.rotors?.find(value => value.id === rotor.id); if (item) item.unit = event.target.value === 'pair' ? 'pair' : 'single' })} className="px-1 py-0 text-[10px] border border-black bg-[#EFEBD8]"><option value="single">单个</option><option value="pair">一对</option></select>
                <button className="ml-auto text-[#B3392E] font-black" onClick={() => mutate(d => { d.rotors = (d.rotors ?? []).filter(value => value.id !== rotor.id); if (d.rotors.length === 0) d.rotors = undefined })}>×</button>
              </div>
              <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 mt-1">
                <label className="flex items-center gap-1 text-[10px] font-comic">
                  <TipLabel text="x(px)" tip="旋翼中心相对单位几何中心的横向像素坐标；向右为正。一对模式会自动使用 ±|x|。" className="text-black/70 shrink-0" />
                  <ValidatedNumberInput aria-label={`旋翼${index + 1}坐标X（像素）`} step={1} value={rotor.x} onValueCommit={value => mutate(d => { const item = d.rotors?.find(entry => entry.id === rotor.id); if (item) item.x = value })} className="h-5 w-12 px-1 py-0 text-[10px] border-2 border-black bg-[#EFEBD8]" />
                </label>
                <label className="flex items-center gap-1 text-[10px] font-comic">
                  <TipLabel text="y(px)" tip="旋翼中心相对单位几何中心的纵向像素坐标；向下为正。" className="text-black/70 shrink-0" />
                  <ValidatedNumberInput aria-label={`旋翼${index + 1}坐标Y（像素）`} step={1} value={rotor.y} onValueCommit={value => mutate(d => { const item = d.rotors?.find(entry => entry.id === rotor.id); if (item) item.y = value })} className="h-5 w-12 px-1 py-0 text-[10px] border-2 border-black bg-[#EFEBD8]" />
                </label>
                {numInput('旋转速度', rotor.speed, value => mutate(d => { const item = d.rotors?.find(entry => entry.id === rotor.id); if (item) item.speed = value }), 30, false, true)}
              </div>
            </div>)}
            {(cur.rotors ?? []).length === 0 && <span className="text-[10px] text-black/40">未配置旋翼</span>}
          </div>
        </div>
      )}

      {/* 外部模式：履带载具专属履带列表（v1.85 瓦片循环动画标定） */}
      {view === 'exterior' && !aircraftPlatform && ((cur.chassis ?? 'tracked') === 'tracked' || cur.chassis === 'halfTracked') && (
        <div className="border-2 border-black bg-[#D2CCA9] p-1.5">
          <div className="flex items-center gap-1 mb-1">
            <span className="text-[10px] font-black text-black/70">履带：</span>
            <button className="comic-btn px-1.5 py-0.5 text-[10px] flex items-center gap-0.5" onClick={() => mutate(d => {
              const nid = `track${(d.tracks ?? []).length + 1}-${Date.now() % 1000}`
              const center = fortressLocalCenter(d)
              d.runningGearCoordinateSpace = 'centered'
              d.tracks = [...(d.tracks ?? []), { id: nid, x1: 0.5 - center.x, y1: center.y - 0.5, x2: 0.5 - center.x, y2: 0.5 - center.y, radius: 0.5, tile: 'builtin:library/track01', overlapPx: 2 }]
            })}><Plus className="w-3 h-3" />添加</button>
          </div>
          <div className="flex flex-col gap-1.5">
            {(cur.tracks ?? []).map(t => (
              <div key={t.id} className="border border-black/40 p-1">
                <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                  <TipLabel text="素材" tip="循环铺设在履带路径上的瓦片贴图，按素材原始尺寸计算步进和翻滚。" className="text-[10px] font-comic text-black/70" />
                  <select aria-label={`${t.id} 履带素材`} value={t.tile} onChange={e => mutate(d => { d.tracks!.find(x => x.id === t.id)!.tile = e.target.value })} className="max-w-40 px-1 py-0 text-[10px] font-comic border border-black bg-[#EFEBD8]">
                    {!trackAssets.some(a => a.id === t.tile) && <option value={t.tile}>当前旧引用</option>}
                    <optgroup label="内置">{trackAssets.filter(a => a.builtin).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</optgroup>
                    <optgroup label="已上传">{trackAssets.filter(a => !a.builtin).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</optgroup>
                  </select>
                  {numInput('轮半径', t.radius, v => mutate(d => { d.tracks!.find(x => x.id === t.id)!.radius = v }), 0.05, false, true)}
                  {numInput('重叠px', t.overlapPx, v => mutate(d => { d.tracks!.find(x => x.id === t.id)!.overlapPx = v }), 1, false, true)}
                  <button className="ml-auto text-[#B3392E] font-black" onClick={() => mutate(d => { d.tracks = (d.tracks ?? []).filter(x => x.id !== t.id); if (d.tracks.length === 0) d.tracks = undefined })}>×</button>
                </div>
                <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 mt-1">
                  {numInput('前轮x', t.x1, v => mutate(d => { d.tracks!.find(x => x.id === t.id)!.x1 = v }), 0.1, true, true)}
                  {numInput('前轮y', t.y1, v => mutate(d => { d.tracks!.find(x => x.id === t.id)!.y1 = v }), 0.1, true, true)}
                  {numInput('后轮x', t.x2, v => mutate(d => { d.tracks!.find(x => x.id === t.id)!.x2 = v }), 0.1, true, true)}
                  {numInput('后轮y', t.y2, v => mutate(d => { d.tracks!.find(x => x.id === t.id)!.y2 = v }), 0.1, true, true)}
                </div>
              </div>
            ))}
            {(cur.tracks ?? []).length === 0 && <span className="text-[10px] text-black/40">未配置履带</span>}
          </div>
        </div>
      )}

      {/* 外部模式：轮式载具专属轮胎列表 */}
      {view === 'exterior' && !aircraftPlatform && (cur.chassis === 'wheeled' || cur.chassis === 'halfTracked') && (
        <div className="border-2 border-black bg-[#D2CCA9] p-1.5">
          <div className="flex items-center gap-1 mb-1">
            <span className="text-[10px] font-black text-black/70">轮胎：</span>
            <button className="comic-btn px-1.5 py-0.5 text-[10px] flex items-center gap-0.5" onClick={() => mutate(d => {
              const nid = `wheel${(d.wheels ?? []).length + 1}-${Date.now() % 1000}`
              const front = (d.wheels ?? []).length === 0 // 成对定义：第一对为前轮，其后默认后轮
              const center = fortressLocalCenter(d)
              d.runningGearCoordinateSpace = 'centered'
              d.wheels = [...(d.wheels ?? []), { id: nid, x: 0.5 - center.x, y: front ? center.y - 1 : 1 - center.y, unit: 'pair', sprite: 'builtin:library/track01', steered: front }]
            })}><Plus className="w-3 h-3" />添加</button>
          </div>
          <div className="flex flex-col gap-1.5">
            {(cur.wheels ?? []).map(wd => (
              <div key={wd.id} className="border border-black/40 p-1">
                <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                  <TipLabel text="素材" tip="轮胎显示与落印使用的贴图，按素材原始像素尺寸绘制。" className="text-[10px] font-comic text-black/70" />
                  <select
                    aria-label={`${wd.id} 轮胎素材`}
                    value={wd.sprite ?? ''}
                    onChange={e => mutate(d => {
                      const wheel = d.wheels!.find(x => x.id === wd.id)!
                      if (e.target.value) wheel.sprite = e.target.value
                      else delete wheel.sprite
                    })}
                    className="max-w-40 px-1 py-0 text-[10px] font-comic border border-black bg-[#EFEBD8]"
                    title="从素材库选择轮胎；按素材原始像素尺寸显示"
                  >
                    <option value="">无（几何轮胎）</option>
                    {wd.sprite && !wheelAssets.some(a => a.id === wd.sprite) && <option value={wd.sprite}>当前旧引用</option>}
                    <optgroup label="内置">{wheelAssets.filter(a => a.builtin).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</optgroup>
                    <optgroup label="已上传">{wheelAssets.filter(a => !a.builtin).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</optgroup>
                  </select>
                  <label className="flex items-center gap-0.5 text-[10px] font-comic"><TipLabel text="单位" tip="“个”只放置一个轮胎；“对”会以单位几何中心线自动生成左右镜像轮胎。" />
                    <select aria-label={`${wd.id} 轮胎单位`} value={wd.unit ?? 'single'} onChange={e => mutate(d => { d.wheels!.find(x => x.id === wd.id)!.unit = e.target.value as 'single' | 'pair' })} className="px-1 py-0 text-[10px] font-comic border border-black bg-[#EFEBD8]">
                      <option value="single">个</option>
                      <option value="pair">对（左右镜像）</option>
                    </select>
                  </label>
                  <label className="flex items-center gap-0.5 text-[10px] font-comic">
                    <TipLabel text="旋转" tip="选择“是”后轮胎会按轴距与实际转弯半径产生转向角；选择“否”则始终与车身平行。" />
                    <select aria-label={`${wd.id} 轮胎旋转`} value={wd.steered ? 'yes' : 'no'} onChange={e => mutate(d => { d.wheels!.find(x => x.id === wd.id)!.steered = e.target.value === 'yes' })} className="px-1 py-0 text-[10px] font-comic border border-black bg-[#EFEBD8]">
                      <option value="no">否</option>
                      <option value="yes">是（随转弯半径）</option>
                    </select>
                  </label>
                  <button className="ml-auto text-[#B3392E] font-black" onClick={() => mutate(d => { d.wheels = (d.wheels ?? []).filter(x => x.id !== wd.id); if (d.wheels.length === 0) d.wheels = undefined })}>×</button>
                </div>
                <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 mt-1">
                  {numInput('帧数', wheelFrameCount(wd), v => mutate(d => {
                    const wheel = d.wheels!.find(x => x.id === wd.id)!
                    wheel.frames = Math.max(1, Math.min(64, Math.round(v)))
                  }), 1, false, true)}
                  {numInput('轮心x', wd.x, v => mutate(d => { d.wheels!.find(x => x.id === wd.id)!.x = v }), 0.1, true, true)}
                  {numInput('轮心y', wd.y, v => mutate(d => { d.wheels!.find(x => x.id === wd.id)!.y = v }), 0.1, true, true)}
                </div>
              </div>
            ))}
            {(cur.wheels ?? []).length === 0 && <span className="text-[10px] text-black/40">未配置轮胎</span>}
          </div>
        </div>
      )}
      {footer}
      </div>
      )}

      {/* 外部模式：炮位列表 */}
      {view === 'exterior' && (
        <div className="border-2 border-black bg-[#D2CCA9] p-1.5 self-start">
          <div className="flex items-center gap-1 mb-1">
            <span className="text-[10px] font-black text-black/70">炮位（尺寸 + 类型限制 + 视角 + 层级）：</span>
            <button className="comic-btn px-1.5 py-0.5 text-[10px] flex items-center gap-0.5" onClick={() => mutate(d => {
              const nid = `hp${d.hardpoints.length + 1}-${Date.now() % 1000}`
              const c = fortressLocalCenter(d)
              d.hardpoints.push({ id: nid, x: c.x, y: c.y, size: 'S' })
              setHpSel(nid)
            })}><Plus className="w-3 h-3" />添加</button>
          </div>
          <div className="flex flex-col gap-1">
            {cur.hardpoints.map(hp => (
              <div key={hp.id} className={`relative border border-black/40 p-1 pr-6 ${hpSel === hp.id ? 'bg-[#C9C29F]' : ''}`}>
                <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                  <button className="comic-btn px-1 py-0 text-[10px]" onClick={() => { setHpSel(hp.id); setTool('hp') }}>{hp.id}</button>
                  <select value={hp.size} onChange={e => mutate(d => {
                    const hardpoint = d.hardpoints.find(h => h.id === hp.id)!
                    hardpoint.size = e.target.value as MountSize
                    const installed = TURRET_DEFS.find(t => t.id === hardpoint.builtIn)
                    if (installed && installed.mount !== hardpoint.size) delete hardpoint.builtIn
                  })} className="px-0.5 py-0 text-[10px] border border-black bg-[#EFEBD8]">
                    {(['S', 'M', 'L'] as const).map(model => <option key={model} value={model}>{model}型</option>)}
                  </select>
                  {hpCoord(hp)}
                  {numInput('层级', hp.zLevel ?? 1, v => mutate(d => { d.hardpoints.find(h => h.id === hp.id)!.zLevel = v === 1 ? undefined : v }), 1)}
                  <label className="flex items-center gap-0.5 text-[10px] font-comic">
                    <input type="checkbox" aria-label={`${hp.id} 隐藏炮塔素材`} checked={!!(hp.hideTurretArt ?? hp.hidden)} onChange={e => mutate(d => { const point = d.hardpoints.find(x => x.id === hp.id)!; point.hideTurretArt = e.target.checked || undefined; delete point.hidden })} />
                    隐藏炮塔素材
                  </label>
                  <label className="flex items-center gap-1 text-[10px] font-comic">
                    <span className="text-black/60 shrink-0">预装炮塔</span>
                    <select
                      aria-label={`${hp.id} 预装炮塔`}
                      value={hp.builtIn ?? ''}
                      onChange={e => mutate(d => { const point = d.hardpoints.find(h => h.id === hp.id)!; point.builtIn = e.target.value || undefined; if (!point.builtIn) delete point.lockedTurret })}
                      className="max-w-36 px-0.5 py-0 text-[10px] border border-black bg-[#EFEBD8]"
                    >
                      <option value="">无</option>
                      {TURRET_DEFS.filter(t => t.mount === hp.size && (!hp.types || hp.types.includes(t.type))).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </label>
                  <label className="flex items-center gap-0.5 text-[10px] font-comic" title="锁定后预装炮塔可以正常战斗、补给和维修，但不能在整备中卸下或替换。">
                    <input type="checkbox" aria-label={`${hp.id} 锁定炮塔`} disabled={!hp.builtIn} checked={!!hp.builtIn && !!hp.lockedTurret} onChange={e => mutate(d => { const point = d.hardpoints.find(h => h.id === hp.id)!; point.lockedTurret = point.builtIn && e.target.checked ? true : undefined })} />
                    锁定炮塔
                  </label>
                </div>
                <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 mt-1">
                  {/* v1.98：炮位视角三模式——全视角（360° 自由旋转）/ 指定视角（起止角）/ 固定视角（恒定朝向不追踪） */}
                  <select
                    value={hp.fixed !== undefined ? 'fixed' : hp.arc ? 'arc' : 'omni'}
                    onChange={e => mutate(d => {
                      const h = d.hardpoints.find(x => x.id === hp.id)!
                      const m = e.target.value
                      if (m === 'omni') { delete h.arc; delete h.fixed }
                      else if (m === 'arc') { h.arc = { start: 315, end: 45 }; delete h.fixed }
                      else { h.fixed = 0; delete h.arc }
                    })}
                    className="px-0.5 py-0 text-[10px] border border-black bg-[#EFEBD8]"
                    title="炮位视角：全视角=360° 自由旋转；指定视角=起止角度区间；固定视角=炮口恒定朝一个角度（上方 0°，逆负顺正）"
                  >
                    <option value="omni">全视角</option>
                    <option value="arc">指定视角</option>
                    <option value="fixed">固定视角</option>
                  </select>
                  {hp.fixed === undefined && hp.arc && <>
                    {numInput('起°', hp.arc.start, v => mutate(d => { d.hardpoints.find(h => h.id === hp.id)!.arc!.start = v }), 5, true)}
                    {numInput('止°', hp.arc.end, v => mutate(d => { d.hardpoints.find(h => h.id === hp.id)!.arc!.end = v }), 5, true)}
                  </>}
                  {hp.fixed !== undefined &&
                    numInput('角°', hp.fixed, v => mutate(d => { d.hardpoints.find(h => h.id === hp.id)!.fixed = Math.max(-180, Math.min(180, v)) }), 5, true)}
                  <span className="ml-1 text-[9px] text-black/60">可装：</span>
                  {ALL_WEAPON_TYPES.map(t => (
                    <label key={t} className="flex items-center gap-0.5 text-[10px] font-comic">
                      <input type="checkbox" checked={!hp.types || hp.types.includes(t)}
                        onChange={e => mutate(d => {
                          const h = d.hardpoints.find(x => x.id === hp.id)!
                          const set = new Set(h.types ?? ALL_WEAPON_TYPES)
                          if (e.target.checked) set.add(t); else set.delete(t)
                          h.types = set.size >= ALL_WEAPON_TYPES.length ? undefined : [...set]
                          const installed = TURRET_DEFS.find(def => def.id === h.builtIn)
                          if (installed && h.types && !h.types.includes(installed.type)) delete h.builtIn
                        })} />
                      {TYPE_NAME[t]}
                    </label>
                  ))}
                  {hp.types && hp.types.length === 0 && <span className="text-[9px] font-black text-[#B3392E]">全不勾=不支持任何炮塔</span>}
                </div>
                <button
                  type="button"
                  aria-label={`删除炮位 ${hp.id}`}
                  title="删除炮位"
                  className="absolute right-1 top-1 text-[14px] leading-none font-black text-[#B3392E] hover:text-black"
                  onClick={() => mutate(d => { d.hardpoints = d.hardpoints.filter(h => h.id !== hp.id) })}
                >×</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 内部模式的校验/行为区 */}
      {view === 'interior' && <div className="lg:col-span-2">{footer}</div>}
      </div>
      </div>
      </div>

      {draft && (
        <div className={`border-2 border-black p-1.5 text-[10px] font-comic ${errors.length > 0 ? 'bg-[#E8C9B8]' : 'bg-[#C9D8B8]'}`}>
          {errors.length > 0
            ? (<><div className="font-black mb-0.5">保存前需修复：</div>{errors.map((e, i) => <div key={i}>· {e}</div>)}</>)
            : '校验通过：网格连通、内部空间/炮位/特效点/特殊格均在界内'}
        </div>
      )}
      </div>
    </div>
  )
}
