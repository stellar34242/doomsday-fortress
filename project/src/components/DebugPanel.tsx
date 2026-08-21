import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Bug, Play, Plus, RotateCcw, Square, Trash2, X } from 'lucide-react'
import { BASE_CELL, CORE, DEFAULT_FORTRESS, MOUNT_FOOT, EFFECT_KIND_NAME, EFFECT_LAYER_NAME, EFFECT_STATE_NAME, FLASH_DURATION, FLASH_FRAME_DUR, FLASH_FRAMES, FLASH_SCALES, FORTRESS_DEFS, M_PER_CELL, MODULE_DEFS, PROJECTILE_ARTS, PROJECTILE_KIND_COLOR, PROJECTILE_KIND_NAME, SPECIAL_BOOST_NAME, TURRET_DEFS } from '@/game/config'
import type { AllyKind, ModuleDef, ProjectileArtDef, ProjectileArtKind } from '@/game/config'
import type { BattleObject, ExcludeTagKey, FortressDef, FortressEffectKind, FortressEffectLayer, FortressEffectState, Hardpoint, MountSize, PreferTagKey, ResourceTagKey, SpecialBoost, TurretDef, TurretTag, WeaponType } from '@/game/config'
import { BRUSH_DEFAULTS, COLS_MIN, LEVEL, reanchorCols, reanchorRows, resetLevel, ROWS_MIN, saveLevel } from '@/game/level'
import { fortressInteriorSet, fortressShapeSet, trackPlacements, validateFortressDef } from '@/game/engine'
import type { GameState } from '@/game/engine'
import { beamArtConfig, beamArtConfigOf, chargeFrameRect, projectileArtDef, projectileArtState, resCompatUrl, resolveExplosionFx, resolveImpactFx, resolveTrailFx, srcImage, turretArtState, validateArt } from '@/game/art'
import { drawBeamLayer } from '@/game/render'
import { drawExplosionLayers, drawImpactFlash, drawParticlePool, tintedFx } from '@/game/fxDraw' // v2.55：特效画法统一走共用层
import { deleteCustomFortress, fortressPersistFailed, getSelectedFortressId, isBuiltinFortressOverridden, listCustomFortresses, resetModuleDefsToFactory, resetPersistedToDefaults, saveAll, saveCustomFortress, setSelectedFortressId } from '@/game/persist'
import { applyConfig, exportConfig } from '@/game/config_transfer'
import { addAsset, filterAssets, getAsset, listAssets, removeAsset, setAssetCategory, ASSET_CATEGORY_NAME } from '@/game/assetlib'
import { createPool, gradientColorKey, spawnTrail, stepParticles } from '@/game/particles'
import { canPlay, createFxState, FX_PREVIEW_RADIUS, FX_SEQ_HIT_X, fxRaySeqFade, fxRaySeqLen, fxTick, simAmmoFx } from '@/game/ammoFxPreview'
import type { AmmoFxMode } from '@/game/ammoFxPreview'
import type { AssetCategory, AssetEntry } from '@/game/assetlib'

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

const FIELDS: FieldSpec[] = [
  { path: 'cost', label: '造价', tip: '建造成本（资源点）', type: 'number' },
  { path: 'rotateSpeed', label: '旋转(°/s)', tip: '炮塔旋转速度（度/秒），越高跟踪越快', type: 'number' },
  { path: 'aimCone', label: '射角(°)', tip: '开火判定锥角：目标进入该角度才起射', type: 'number' },
  { path: 'rangeMin', label: '最小射程(m)', tip: '最小射程（米），太近的目标打不到', type: 'number' },
  { path: 'rangeMax', label: '最大射程(m)', tip: '最大射程（米），超出不索敌', type: 'number' },
  { path: 'canAir', label: '对空', tip: '可攻击空中单位', type: 'boolean' },
  { path: 'canGround', label: '对地', tip: '可攻击地面单位', type: 'boolean' },
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
  { path: 'missileCurve', label: '导弹飞行曲线(0-100)', tip: '蛇形机动幅度 0-100，越大轨迹越弯', type: 'number', showIf: def => def.type === 'missile' },
  { path: 'ejectAngle', label: '出膛偏角(°)', tip: 'v2.20：延迟制导期内初始航向 = 炮塔方向 + 偏角（度），点火后转向追踪——侧抛/垂发式发射；缺省 0', type: 'number', step: 5, showIf: def => def.type === 'missile' && !!def.guided && (def.guideDelay ?? 0) > 0 },
  { path: 'burnTime', label: '燃烧时间(s)', tip: 'v2.20：发动机燃烧秒数——期内加速+喷焰，燃尽后惯性滑行、尾焰/喷口焰熄灭；未配置 = 全程燃烧', type: 'number', step: 0.5, showIf: def => def.type === 'missile' },
  { // v2.20 集束分裂：子弹数量（清空/小于 2 = 不分裂；首次填入自动补默认扇角 40°/近炸 25m）
    path: 'splitCount', label: '集束子弹数', tip: 'v2.20 真集束：触发后母弹裂为 N 颗扇形子弹（伤害均分、不再分裂、继承制导/锁定/剩余飞行时间）；清空 = 不分裂', type: 'number',
    showIf: def => def.type === 'missile',
    get: def => def.split ? String(def.split.count) : '',
    set: (def, val) => {
      const n = val === '' ? undefined : Number(val)
      if (n === undefined || Number.isNaN(n) || n < 2) delete def.split
      else if (def.split) def.split.count = Math.round(n)
      else def.split = { count: Math.round(n), spread: 40, at: 'proximity', range: 25 }
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
  { path: 'splitRange', label: '分裂距离(m)', tip: 'v2.20：近炸分裂触发距离（米）——距目标进入该距离即裂为子弹；缺省 25', type: 'number', step: 5, showIf: def => def.type === 'missile' && !!def.split && def.split.at === 'proximity', get: def => String(def.split!.range ?? 25), set: (def, val) => { if (def.split) { const n = Number(val); def.split.range = val === '' || Number.isNaN(n) ? undefined : n } } },
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
  {
    path: 'rayMode', label: '射线模式', type: 'select', // 仅射线(type:beam)类炮塔显示
    options: [{ value: 'pulse', label: '点射' }, { value: 'beam', label: '光束' }],
    defaultValue: 'beam', // 与引擎缺省语义（?? 'beam'）一致
    showIf: def => def.type === 'beam',
  },
  { path: 'beamWidth', label: '射线宽幅(m)', tip: '光束判定宽度（米）；v2.50 起同时驱动贴图渲染宽度（贴图高度缩放到 宽幅/25 格）；未填 = 贴图原生尺寸（32px 高）', type: 'number', step: 0.1 },
  { path: 'sprayAngle', label: '喷射角度(°)', tip: '喷射散布角（度），火焰锥形范围', type: 'number' },
  { path: 'attackDuration', label: '攻击持续(s)', tip: '单次开火持续时间（秒）', type: 'number', step: 0.1 },
  { path: 'dot.damage', label: '持续伤害值', tip: '持续伤害每跳数值', type: 'number' },
  { path: 'dot.interval', label: '持续伤害间隔(s)', tip: '持续伤害跳间隔（秒）', type: 'number', step: 0.1 },
  { path: 'fireRate', label: '射速(s/轮)', tip: '每轮射击的间隔秒数，越小射得越快', type: 'number', step: 0.1 },
  { path: 'burst', label: '连发数', tip: '每轮连发弹数', type: 'number' },
  { path: 'burstInterval', label: '连发间隔(s)', tip: '连发之间的间隔（秒）', type: 'number', step: 0.05 },
  { path: 'barrels', label: '炮管数', tip: '炮管数量；未配置视为 1 单管', type: 'number', showIf: () => true }, // 始终显示：未配置(undefined)视为 1 单管
  {
    path: 'barrelMode', label: '发射模式', type: 'select',
    options: [{ value: 'salvo', label: '齐射' }, { value: 'sequential', label: '轮流' }],
    defaultValue: 'salvo',
    showIf: def => def.type === 'direct' || def.type === 'lob' || def.type === 'missile'
      || (def.type === 'beam' && def.rayMode === 'pulse'),
  },
  { path: 'reload', label: '装填/冷却(s)', tip: '两轮开火之间的冷却（秒）', type: 'number', step: 0.1 },
  { path: 'heatPerShot', label: '热量/发', tip: '每发产热汇聚到堡垒热量池，堡垒积满即全炮塔过热停火', type: 'number' },
  { path: 'ammoPerShot', label: '弹药/发', tip: '每发消耗弹药量', type: 'number' },
  { path: 'ammoPerSec', label: '弹药/秒', tip: '喷射武器每秒弹药消耗', type: 'number' },
  { path: 'energyPerShot', label: '发射电量', tip: '每发消耗电量', type: 'number' },
  { path: 'energyPerSec', label: '维持电量', tip: '维持状态每秒耗电', type: 'number', step: 0.1 },
  { path: 'gpu', label: 'GPU', tip: '占用 GPU 算力（建造配额）', type: 'number' },
  { path: 'hp', label: '耐久', tip: '结构耐久，归零被摧毁', type: 'number' },
  { path: 'onDestroyBlast.radius', label: '毁坏爆炸半径(m)', tip: '被摧毁时爆炸半径（米）', type: 'number' },
  { path: 'onDestroyBlast.damage', label: '毁坏爆炸伤害', tip: '被摧毁时爆炸伤害', type: 'number' },
]

// ---------- v2.49 索敌标签编辑器 ----------
// 偏好=软排序（权重因子连乘，可多个叠加）；约束=硬过滤；资源=开火门控（条件成立即禁火）。
// 约束+资源全部 AND 通过才开火；偏好之间非条件、是排序权重。零标签 = 现状（近堡垒优先、空军×0.5）。
const PREFER_LABELS: [PreferTagKey, string][] = [ // 预留键（fortress/wingman/missile/spawned）实体上线后再开放
  ['nearFortress', '近堡垒优先'], ['nearTurret', '近炮塔优先'],
  ['hpMax', '血最多优先'], ['hpMin', '血最少优先'],
  ['sizeBig', '大单位优先'], ['sizeSmall', '小单位优先'],
  ['air', '空中优先'], ['ground', '地面优先'],
]
const EXCLUDE_LABELS: [ExcludeTagKey, string][] = [['air', '不打空中'], ['ground', '不打地面']]
const RESOURCE_LABELS: [ResourceTagKey, string][] = [['ammo', '弹药'], ['energy', '电量'], ['heat', '热量'], ['defense', '防御(堡垒耐久)']]

function tagText(tg: TurretTag): string {
  if (tg.kind === 'prefer') return `偏好·${PREFER_LABELS.find(([k]) => k === tg.key)?.[1] ?? tg.key}`
  if (tg.kind === 'exclude') return `约束·${EXCLUDE_LABELS.find(([k]) => k === tg.key)?.[1] ?? tg.key}`
  return `资源·${RESOURCE_LABELS.find(([k]) => k === tg.res)?.[1] ?? tg.res}${tg.op === 'lt' ? '低于' : '高于'}${tg.value}%禁火`
}

function TagEditor({ def, bump }: { def: TurretDef; bump: () => void }) {
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
    def.tags = [...tags, tg]
    bump()
  }
  const selCls = 'px-1 py-0.5 text-[10px] font-comic border-2 border-black bg-[#EFEBD8]'
  return (
    <div className="mt-1.5 border-t-2 border-black/15 pt-1">
      <div className="flex items-center gap-1 mb-0.5">
        <TipLabel text="索敌标签" tip="偏好=软排序（权重连乘，可叠加）；约束=硬过滤；资源=条件成立即禁火（占上限百分比）。约束+资源全部满足才开火；零标签=现状（近堡垒优先、空军×0.5）" className="text-[10px] font-black text-black/70" />
        {tags.length > 0 && (
          <button className="comic-btn px-1 py-0 text-[9px]" title="清空全部标签（恢复默认索敌）"
            onClick={() => { delete def.tags; bump() }}>清空</button>
        )}
      </div>
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-1">
          {tags.map((tg, i) => (
            <span key={i} className="inline-flex items-center gap-0.5 px-1 py-0 text-[9px] font-bold border-2 border-black bg-[#E4D9B8]">
              {tagText(tg)}
              <button className="text-[#B3392E] font-black" title="移除该标签"
                onClick={() => { const n = tags.filter((_, j) => j !== i); if (n.length) def.tags = n; else delete def.tags; bump() }}>×</button>
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
  baseAsset: 'none', // 底座默认「无」（塔体直接落地）；可选「几何」色块或素材贴图
  recoil: 0.1, // v1.58 统一后坐（全管共用）
  barrels: [{ mount: [0, 0], muzzle: [0, 0.5] }],
})

/** 预览有效挂点表（与 render.artMounts 同规则）：配置优先，未配置按逻辑炮管数自动生成 */
function previewMounts(def: TurretDef): { mount: [number, number]; muzzle: [number, number]; recoil: number }[] {
  const cfg = def.art?.barrels
  const uni = def.art?.recoil // v1.58 统一后坐：全管共用，优先于遗留逐管 recoil
  if (cfg && cfg.length > 0) return cfg.map(b => ({ mount: b.mount, muzzle: b.muzzle, recoil: uni ?? b.recoil ?? 0.1 }))
  const n = Math.max(1, Math.floor(def.barrels ?? 1))
  if (n <= 1) return [{ mount: [0, 0], muzzle: [0, 0.35], recoil: uni ?? 0.1 }]
  const spread = def.w * 0.6
  return Array.from({ length: n }, (_, i) => {
    const lat = (i - (n - 1) / 2) * (spread / (n - 1))
    return { mount: [lat, 0] as [number, number], muzzle: [lat, 0.35] as [number, number], recoil: uni ?? 0.1 }
  })
}

/** 预览挂载绘制：满挂 round-robin 均分到管，贴图优先、几何小导弹回退（与 render.drawRackMissiles 同规则） */
function drawPreviewRack(
  ctx: CanvasRenderingContext2D, def: TurretDef,
  mounts: { mount: [number, number] }[],
  P30: (x: number, y: number) => [number, number],
) {
  const rackLeft = Math.max(1, def.burst ?? 1) // 预览满挂
  const nBar = mounts.length
  const per = Math.floor(rackLeft / nBar)
  const extra = rackLeft % nBar
  const ammoId = def.art?.projectile
  const ammo = ammoId ? projectileArtDef(ammoId) : undefined
  const st = ammo ? projectileArtState(ammo) : null
  const img = st?.status === 'ready' ? st.assets?.projectile : undefined
  // v1.81：与战场 drawRackMissiles 严格一致——统一美术坐标 30px=1格（P30），贴图原尺寸无缩放
  // （此前用预览 cell 基准：贴图被强制缩放到 0.34×预览格，且坐标随炮塔占格漂移，与战场不一致）
  const size = img ? img.height : 0.34 * 30
  const spacing = 0.34 * 0.48 * 30 // = engine RACK_SLOT_SPACING × 30px（弹宽×1.2 同战场规则）
  const dx = def.art?.rack?.dx ?? 0
  const dy = def.art?.rack?.dy ?? 0.12
  mounts.forEach((b, i) => {
    const count = per + (i < extra ? 1 : 0)
    const [ox, oy] = P30(b.mount[0] + dx, b.mount[1] + dy)
    for (let j = 0; j < count; j++) {
      const y = oy + j * spacing
      if (img) {
        const bw = size * (img.width / img.height)
        ctx.drawImage(img, ox - bw / 2, y - size / 2, bw, size)
      } else {
        ctx.fillStyle = PROJECTILE_KIND_COLOR[ammo?.kind ?? 'missile']
        ctx.strokeStyle = '#A8A28C'
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(ox, y - size * 0.45)
        ctx.lineTo(ox - size * 0.16, y + size * 0.2)
        ctx.lineTo(ox + size * 0.16, y + size * 0.2)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
      }
    }
  })
}

/** 预览绘制（模块级纯函数）：网格 + 贴图分层/几何回退 + 坐标点彩色标注；angle=0 炮口朝上 */
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
  const world = Math.max(def.w, def.h) + 1.2 // 预览范围（格，含边距）
  const cell = S / world
  const tpx = (S - def.w * cell) / 2
  const tpy = (S - def.h * cell) / 2
  const [ax, ay] = art?.anchor ?? [0.5, 0.5]
  const ancX = tpx + ax * def.w * cell
  const ancY = tpy + ay * def.h * cell
  // config 坐标 → 预览像素：anchor 为原点，x 向右为正、y 向上（沿炮口）为正，与游戏渲染一致 (x, -y)
  // v1.81：P（预览格基准）已随 drawPreviewRack 改 P30 而移除
  // 美术坐标空间：固定 30px=1格（贴图/挂点/炮口/后座/火光/充能偏移），与战场 A=30×zf 严格对应——zoom=1 时预览与战场逐像素一致
  const P30 = (x: number, y: number): [number, number] => [ancX + x * 30, ancY - y * 30]
  ctx.clearRect(0, 0, S, S)
  // v2.12 深色底（与弹丸预览一致 #262420）；网格/坐标轴/几何线转为浅色系
  ctx.fillStyle = '#262420'
  ctx.fillRect(0, 0, S, S)
  // 网格（0.5 格细分线）
  ctx.strokeStyle = 'rgba(239,235,216,0.07)'
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let p = 0; p <= S + 0.5; p += cell / 2) {
    ctx.moveTo(p, 0); ctx.lineTo(p, S)
    ctx.moveTo(0, p); ctx.lineTo(S, p)
  }
  ctx.stroke()
  // 坐标轴（过轴心）：水平 x 轴向右为正、竖直 y 轴向上为正，带箭头与标签
  ctx.strokeStyle = 'rgba(239,235,216,0.5)'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(0, ancY); ctx.lineTo(S - 8, ancY) // x 轴 →
  ctx.moveTo(ancX, S); ctx.lineTo(ancX, 8) // y 轴 ↑
  ctx.stroke()
  ctx.fillStyle = 'rgba(239,235,216,0.5)'
  ctx.beginPath() // x 轴箭头
  ctx.moveTo(S - 8, ancY - 3.5)
  ctx.lineTo(S - 8, ancY + 3.5)
  ctx.lineTo(S - 2, ancY)
  ctx.closePath()
  ctx.fill()
  ctx.beginPath() // y 轴箭头
  ctx.moveTo(ancX - 3.5, 8)
  ctx.lineTo(ancX + 3.5, 8)
  ctx.lineTo(ancX, 2)
  ctx.closePath()
  ctx.fill()
  ctx.font = 'bold 10px sans-serif'
  ctx.fillText('x', S - 16, ancY - 5)
  ctx.fillText('y', ancX + 6, 12)
  const mounts = previewMounts(def)
  // ---- v1.57 射击动画预览（播放动画按钮）----
  // 直射/抛射/导弹：充能前摇 → 击发（火光 0.2s + 后座 0.4s 线性回位）循环，周期=fireRate，连发按 burstInterval 轮转各管；
  // 光束/喷射：充能后持续开火（光束矩形/喷射扇形 + 火光循环 2 帧）
  const isBeamP = def.type === 'beam' && (def.rayMode ?? 'beam') === 'beam'
  const isSprayP = def.type === 'spray'
  const contFireP = isBeamP || isSprayP
  const chargeDurP = def.chargeTime && def.chargeTime > 0 ? def.chargeTime : 0
  let chargeP: number | null = null // 充能进度 0-1（仅播放中）
  let contFiring = false // 持续开火中（光束/喷射）
  const fireEl: (number | null)[] = [] // 各管最近一次击发的经过秒（后座/火光时间基准）
  if (anim) {
    if (contFireP) {
      // v2.15：充能末帧滞留 0.05s（v2.16，与战场一致）——chargeDur 内前 N-1 帧，滞留段定格末帧，之后才起射
      if (chargeDurP > 0 && anim.t < chargeDurP + 0.05) chargeP = Math.min(1, anim.t / chargeDurP)
      else { contFiring = true; if (chargeDurP > 0) chargeP = 1; fireEl[0] = Math.max(0, anim.t - chargeDurP - 0.05) }
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
  const recoilPx = (i: number, rec: number) => { // v1.57 后座位移（与战场同规则：2×火光时长内线性回位；美术坐标 30px=1格）
    const el = fireEl[i]
    return el != null && rec > 0 ? rec * Math.max(0, 1 - el / (2 * FLASH_DURATION)) * 30 : 0
  }
  const st = turretArtState(def)
  if (st.status === 'ready' && st.assets) { // 贴图分层（逐层降级：ready 层贴图、缺失层几何补绘）：base → turret(anchor 为轴) → barrel × N；zBias<0 时炮管在炮身下
    ctx.imageSmoothingEnabled = false
    const F = 1 // 预览按素材原始尺寸绘制（1 贴图像素 = 1 预览像素，与战场 zoom=1 一致）
    // 底座：原始尺寸，居中于占格；「无」→ 不绘制；无贴图（含「几何」）→ 色块底座
    if (def.art?.baseAsset === 'none') { /* 底座选配「无」：不绘制底座层 */ }
    else if (st.assets.base) ctx.drawImage(st.assets.base, tpx + (def.w * cell - st.assets.base.width * F) / 2, tpy + (def.h * cell - st.assets.base.height * F) / 2, st.assets.base.width * F, st.assets.base.height * F)
    else { ctx.fillStyle = def.color; ctx.fillRect(tpx + 1, tpy + 1, def.w * cell - 2, def.h * cell - 2) }
    const barrelBelow = (def.art?.zBias ?? 0) < 0
    const noBarrel = def.art?.barrelAsset === 'none'
    const drawBarrels = () => {
      // 炮管按原始尺寸绘制（30px=1格绝对基准），根部锚定挂点；炮口仅为定位点不参与缩放
      if (!noBarrel) { // 选配「无」→ 跳过炮管层（挂载预览仍绘制——导弹巢无管也有弹架）
        const barrelImg = st.assets!.barrel
        if (barrelImg) {
          mounts.forEach((b, i) => {
            const [mx, my] = P30(b.mount[0], b.mount[1])
            const bw = barrelImg.width * F
            const bh = barrelImg.height * F
            ctx.drawImage(barrelImg, mx - bw / 2, my - bh + recoilPx(i, b.recoil), bw, bh) // v1.57 后座位移
          })
        } else { // 逐层降级：无炮管贴图 → 几何挂点→炮口线
          ctx.strokeStyle = '#A8A28C'
          ctx.lineWidth = 1.5
          mounts.forEach((b, i) => {
            const sh = recoilPx(i, b.recoil) // v1.57 后座位移
            const [mx, my] = P30(b.mount[0], b.mount[1])
            const [zx, zy] = P30(b.muzzle[0], b.muzzle[1])
            ctx.beginPath()
            ctx.moveTo(mx, my + sh)
            ctx.lineTo(zx, zy + sh)
            ctx.stroke()
          })
        }
      }
      if (def.type === 'missile' && (def.art?.rack?.show ?? true)) drawPreviewRack(ctx, def, mounts, P30) // 挂载显示预览（满挂；无管也画弹架）；v1.81 改 P30 基准
    }
    if (barrelBelow) drawBarrels()
    if (st.assets.turret) ctx.drawImage(st.assets.turret, ancX - st.assets.turret.width * F / 2, ancY - st.assets.turret.height * F / 2, st.assets.turret.width * F, st.assets.turret.height * F) // 原始尺寸，轴心居中
    else { ctx.fillStyle = '#4A4740'; ctx.beginPath(); ctx.arc(ancX, ancY, Math.min(def.w, def.h) * cell * 0.2, 0, Math.PI * 2); ctx.fill() } // 无炮身贴图 → 几何圆座
    if (!barrelBelow) drawBarrels()
    ctx.imageSmoothingEnabled = true
  } else { // 几何回退（与游戏内一致：色块底座 + 圆座 + 炮管线；底座「无」→ 跳过色块）
    if (def.art?.baseAsset !== 'none') {
      ctx.fillStyle = def.color
      ctx.fillRect(tpx + 1, tpy + 1, def.w * cell - 2, def.h * cell - 2)
    }
    ctx.strokeStyle = '#A8A28C'
    ctx.lineWidth = 1.5
    mounts.forEach((b, i) => {
      const sh = recoilPx(i, b.recoil) // v1.57 后座位移
      const [mx, my] = P30(b.mount[0], b.mount[1])
      const [zx, zy] = P30(b.muzzle[0], b.muzzle[1])
      ctx.beginPath()
      ctx.moveTo(mx, my + sh)
      ctx.lineTo(zx, zy + sh)
      ctx.stroke()
    })
    ctx.fillStyle = '#4A4740'
    ctx.beginPath()
    ctx.arc(ancX, ancY, Math.min(def.w, def.h) * cell * 0.2, 0, Math.PI * 2)
    ctx.fill()
  }
  // 炮塔占格轮廓框
  ctx.strokeStyle = '#A8A28C'
  ctx.lineWidth = 1.5
  ctx.strokeRect(tpx, tpy, def.w * cell, def.h * cell)
  // 标注：recoil 虚线箭头 / flash 尺寸参考圆 / 挂点炮口点位（v1.59：markers 勾选框统一显隐）
  const fs = FLASH_SCALES[0] // 火光参考尺寸 = 第 1 帧缩放 1.4×（v1.45 硬编码）
  if (markers) mounts.forEach((b, i) => {
    const [mx, my] = P30(b.mount[0], b.mount[1])
    const [zx, zy] = P30(b.muzzle[0], b.muzzle[1])
    if (b.recoil > 0) {
      ctx.strokeStyle = 'rgba(46,99,184,0.8)'
      ctx.setLineDash([3, 2])
      ctx.beginPath()
      ctx.moveTo(mx, my)
      ctx.lineTo(mx, my + b.recoil * 30) // 反炮口方向（向下）；美术坐标 30px=1格
      ctx.stroke()
      ctx.setLineDash([])
      ctx.fillStyle = 'rgba(46,99,184,0.8)'
      ctx.beginPath() // 箭头
      ctx.moveTo(mx - 3, my + b.recoil * 30 - 4)
      ctx.lineTo(mx + 3, my + b.recoil * 30 - 4)
      ctx.lineTo(mx, my + b.recoil * 30)
      ctx.closePath()
      ctx.fill()
    }
    if (art?.flashAsset !== 'none') { // 火光尺寸参考（半透明圆，半径 = 挂点距×1.4/2，v1.45 硬编码）；美术坐标 30px=1格
      const r = Math.hypot(b.muzzle[0] - b.mount[0], b.muzzle[1] - b.mount[1]) * 30 * fs / 2
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
    const [cxp, cyp] = P30(art.charge.offset[0], art.charge.offset[1])
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
    const [zx, zy] = P30(b0.muzzle[0], b0.muzzle[1])
    if (isBeamP) { // 光束：v2.7 分层贴图（与战场同步：光晕+亮芯平铺滚动+亮度闪烁+炮口光球+命中闪光；'none'/未就绪回退程序化矩形）
      const wpx = Math.max(2, (def.beamWidth ?? 8) / M_PER_CELL * 30)
      const ba = beamArtConfig(def)
      const tSec = anim.t
      const wave = 0.5 + 0.5 * (0.7 * Math.sin(tSec * 22) + 0.3 * Math.sin(tSec * 57))
      const bright = 1 - ba.flicker + ba.flicker * wave
      const scroll = ba.scrollSpeed > 0 ? tSec * ba.scrollSpeed : 0 // 预览比例 30px/格 → 美术 px 即屏幕 px（战场为 scrollSpeed×cell/30）
      const lenPx = zy // 预览向上画满画布
      ctx.save()
      ctx.translate(zx, zy)
      ctx.rotate(-Math.PI / 2) // 局部 +x 沿光束方向（向上）
      const glowT = ba.glow?.status === 'ready' && ba.glow.img ? tintedFx(ba.glow.img, ba.fringeColor) : null
      const coreT = ba.core?.status === 'ready' && ba.core.img ? tintedFx(ba.core.img, ba.coreColor) : null
      // v2.50：宽幅已配置 → 贴图高度缩放到 宽幅/25 格（与战场同语义）；未配置 = 贴图原生高度
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
          const dist = (0.35 + Math.random() * 0.3) * 30 // px
          const sp = 1.6 * 30 // px/s
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
          const sp = (2 + Math.random() * 2) * 30
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
          const sp = (0.3 + Math.random() * 0.4) * 30
          spawnTrail(artPrevBeamPool, zx, 4, {
            vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 0.2 * 30,
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
        const r = Math.max(0.5, pt.size * 30)
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
      const rC = Math.min(def.rangeMax / M_PER_CELL * 30, S)
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
      if (def.art?.flashAsset === 'none') return // 火光选配「无」：不播放
      const fi = Math.min(FLASH_FRAMES - 1, Math.floor((contFiring ? el % FLASH_DURATION : el) / FLASH_FRAME_DUR)) // 固定 2 帧
      const [zx, zy] = P30(b.muzzle[0], b.muzzle[1])
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
      } else { // 几何回退火光（预览专用：无素材也能看到动画）
        const dist = Math.hypot(b.muzzle[0] - b.mount[0], b.muzzle[1] - b.mount[1]) * 30
        const r0 = Math.max(4, dist * FLASH_SCALES[fi] / 2)
        ctx.save()
        ctx.globalCompositeOperation = 'lighter' // v2.6：火光加法发光（与战场同步）
        ctx.fillStyle = 'rgba(240,160,60,0.85)'
        ctx.beginPath()
        ctx.arc(zx, zy - r0 * 0.4, r0, 0, Math.PI * 2)
        ctx.fill()
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
    const spd = (def.projectileSpeed ?? 100) / M_PER_CELL // 弹速 → 格/秒
    const hasTrail = !!(ammo && resolveTrailFx(ammo)) // 配了尾焰的弹丸补两颗渐隐尾随点（模拟战场粒子观感）
    for (let k = 0; k < nShots; k++) {
      const el = ct - chargeDurP - 0.05 - k * gap
      if (el < 0) continue // 该发尚未击发
      const b = mounts[k % mounts.length] // 与火光/后座同规则：第 k 发 → 第 k%N 管
      const [zx, zy] = P30(b.muzzle[0], b.muzzle[1])
      const py = zy - spd * el * 30 // 沿炮口方向（预览 +y 向上）推进；美术坐标 30px=1格
      if (py < -24) continue // 飞出画布不再绘制
      if (pImg) { // 贴图弹丸：原尺寸（与战场 zoom=1 一致），朝上居中于弹道点
        ctx.save()
        ctx.imageSmoothingEnabled = false
        ctx.drawImage(pImg, zx - pImg.width / 2, py - pImg.height / 2, pImg.width, pImg.height)
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
  // 轴心（黄色；v1.59 markers 门控）
  if (markers) {
    ctx.fillStyle = '#D9A441'
    ctx.strokeStyle = 'rgba(239,235,216,0.85)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.arc(ancX, ancY, 3.5, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
    ctx.font = 'bold 9px sans-serif'
    ctx.fillStyle = '#B98A1D'
    ctx.fillText('轴', ancX + 5, ancY - 5)
  }
}

// v1.57 e2e 探针：动画绘制的确定性验证（虚拟时间下 rAF 帧率不可靠，直接注入 t 采样）
if (typeof window !== 'undefined') (window as unknown as { __artPreview?: unknown }).__artPreview = { draw: drawArtPreview, defs: TURRET_DEFS }
// v1.69 弹丸效果预览探针（无头/sim 验证）
if (typeof window !== 'undefined') (window as unknown as { __ammoFx?: unknown }).__ammoFx = { sim: simAmmoFx, canPlay, arts: PROJECTILE_ARTS }

/** 美术预览画布：随 def.art 修改即时重绘；贴图加载完成后自动升级；v1.57 预览窗口下侧「播放动画」射击循环预览 */
function ArtPreview({ def }: { def: TurretDef }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const artJson = JSON.stringify(def.art ?? null)
  const nBarrels = Math.max(1, Math.floor(def.barrels ?? 1))
  const [playing, setPlaying] = useState(false) // v1.57 播放射击动画
  const [markers, setMarkers] = useState(true) // v1.59 点位标注显隐（轴心/挂点/炮口/充能）
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
    let raf = 0
    const t0 = performance.now()
    const loop = () => {
      const cv = ref.current
      if (cv) drawArtPreview(cv, def, { t: (performance.now() - t0) / 1000 }, markers)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [playing, def, artJson, nBarrels, markers])
  const v = validateArt(def)
  return (
    <div className="relative mx-auto my-1 w-full max-w-[200px]">
      {/* v1.59 点位图例置顶 + 勾选框决定预览图是否显示这些点位 */}
      <div className="flex items-center justify-center gap-2 mb-0.5 text-[9px] font-bold">
        <span className="text-[#B98A1D]">● 轴心</span>
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
      <canvas ref={ref} width={200} height={200} className="block w-full h-auto border-2 border-black bg-[#262420]" />
      {v.warnings.length > 0 && (
        <span className="absolute top-1 right-1 text-[11px] font-bold text-[#B98A1D]" title={v.warnings.join('\n')}>
          ⚠{v.warnings.length}
        </span>
      )}
      {/* v1.57 预览窗口下侧：播放/停止射击动画（充能→击发火光 2 帧 + 炮管后座回位；光束/喷射为持续开火） */}
      <div className="flex justify-center mt-0.5">
        <button
          className="comic-btn px-2 py-0.5 text-[10px]"
          onClick={() => setPlaying(p => !p)}
          title="循环播放射击动画：充能前摇 → 炮口火光(2帧) + 炮管后座回位；光束/喷射为持续开火；连发轮转各炮管"
        >{playing ? '■ 停止' : '▶ 播放动画'}</button>
      </div>
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
        {!art && <span className="text-black/40">未配置·几何回退</span>}
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
                      <label key={key} className="flex items-center gap-1 min-w-0">
                        <TipLabel text={label} tip={{ 底座: '底座贴图：固定不旋转；可选「无」（默认，不绘制）或「几何」色块', 炮身: '炮身贴图：随瞄准方向旋转', 炮管: '炮管贴图：根部锚定挂点' }[label]} className="text-[9px] font-bold text-black/60 shrink-0 w-9" />
                        <span className="flex-1 min-w-0">
                          <select
                            className="w-full min-w-0 px-0.5 py-0 text-[9px] font-comic border-2 border-black bg-[#EFEBD8]"
                            value={art[key] ?? ''}
                            onChange={e => patch(a => {
                              if (e.target.value) a[key] = e.target.value
                              else delete a[key]
                            })}
                          >
                            <option value="">默认（文件夹/几何绘制）</option>
                            {key === 'baseAsset' && <option value="none">无（不绘制底座）</option>}
                            {key === 'baseAsset' && <option value="geo">几何（色块底座）</option>}
                            {key === 'barrelAsset' && <option value="none">无（不绘制炮管）</option>}
                            {groups.map(([g, items]) => items.length > 0 && (
                              <optgroup key={g} label={g}>
                                {items.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                              </optgroup>
                            ))}
                          </select>
                          {mismatch && (
                            <div className="text-[8px] font-bold text-[#B98A1D]">引用条目「{mismatch.name}」分类为{ASSET_CATEGORY_NAME[mismatch.category]}，与{label}不符</div>
                          )}
                        </span>
                      </label>
                    )
                  })}
                  {/* v1.45：弹丸 / 火光在素材列；v1.58：zBias 移到火光下面、统一后坐放在 zBias 下面；v2.8：射线类标签改「光束（弹丸）」位于炮管与火光之间，引用 ray 条目 = 光束分层表现+命中特效 */}
                  {def.type !== 'spray' && (
                    <label className="flex items-center gap-1 min-w-0">
                      <TipLabel
                        text={def.type === 'beam' ? '光束(弹丸)' : '弹丸'}
                        tip={def.type === 'beam'
                          ? '射线（弹丸）美术库条目引用：决定光束分层贴图表现（光晕/亮芯/命中闪光/炮口光球，v2.8 起在弹丸库 ray 条目编辑）与命中粒子特效；不选 = 默认光束搭配'
                          : '弹丸美术库条目引用：决定弹体/尾焰/爆炸/命中表现；喷射无弹丸不生效'}
                        className={`text-[9px] font-bold text-black/60 shrink-0 ${def.type === 'beam' ? 'whitespace-nowrap' : 'w-9'}`}
                      />
                      <span className="flex-1 min-w-0">
                        <select
                          className="w-full min-w-0 px-0.5 py-0 text-[9px] font-comic border-2 border-black bg-[#EFEBD8]"
                          value={art.projectile ?? ''}
                          onChange={e => patch(a => {
                            if (e.target.value) a.projectile = e.target.value
                            else delete a.projectile
                          })}
                        >
                          <option value="">无（几何回退）</option>
                          {(['bullet', 'shell', 'missile', 'ray'] as const).map(k => (
                            <optgroup key={k} label={PROJECTILE_KIND_NAME[k]}>
                              {PROJECTILE_ARTS.filter(pa => pa.kind === k).map(pa => (
                                <option key={pa.id} value={pa.id}>{pa.name}（{pa.id}）</option>
                              ))}
                            </optgroup>
                          ))}
                        </select>
                      </span>
                    </label>
                  )}
                  {(() => {
                    const { groups, mismatch } = assetSelectGroups('flash', art.flashAsset)
                    return (
                      <label className="flex items-center gap-1 min-w-0">
                        <TipLabel text="火光" tip="开火火光贴图（帧条）；可选「无」不播放；表现硬编码：2 帧、逐帧 1.4×→1×、每帧 0.1s" className="text-[9px] font-bold text-black/60 shrink-0 w-9" />
                        <span className="flex-1 min-w-0">
                          <select
                            className="w-full min-w-0 px-0.5 py-0 text-[9px] font-comic border-2 border-black bg-[#EFEBD8]"
                            value={art.flashAsset ?? ''}
                            onChange={e => patch(a => {
                              if (e.target.value) a.flashAsset = e.target.value
                              else delete a.flashAsset
                            })}
                          >
                            <option value="">默认（文件夹/几何绘制）</option>
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
                    {numField('挂载x', art.rack?.dx, 0.05, n => patch(a => {
                      a.rack = { ...a.rack }
                      if (n === undefined) delete a.rack.dx
                      else a.rack.dx = n
                    }), '0', '挂载点相对炮管挂点的侧向偏移（格），默认 0')}
                    {numField('挂载y', art.rack?.dy, 0.05, n => patch(a => {
                      a.rack = { ...a.rack }
                      if (n === undefined) delete a.rack.dy
                      else a.rack.dy = n
                    }), '0.12', '挂载点沿炮口方向偏移（格），默认 0.12（炮管根部侧后方）')}
                  </div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 mt-1">
                {numField('轴心 x', art.anchor?.[0] ?? 0.5, 0.05, n => patch(a => { a.anchor = [n ?? 0.5, a.anchor?.[1] ?? 0.5] }), undefined, '炮身旋转中心 x（0-1 相对坐标），向右为正')}
                {numField('轴心 y', art.anchor?.[1] ?? 0.5, 0.05, n => patch(a => { a.anchor = [a.anchor?.[0] ?? 0.5, n ?? 0.5] }), undefined, '炮身旋转中心 y（0-1），沿炮口向上为正')}
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
                      {numField('挂点 x', b.mount?.[0], 0.05, n => patchBarrel(i, bb => { bb.mount = [n ?? 0, bb.mount?.[1] ?? 0] }), undefined, '炮管根部挂点 x（相对轴心，格）')}
                      {numField('挂点 y', b.mount?.[1], 0.05, n => patchBarrel(i, bb => { bb.mount = [bb.mount?.[0] ?? 0, n ?? 0] }), undefined, '炮管挂点 y（沿炮口方向，格）')}
                      {numField('炮口 x', b.muzzle?.[0], 0.05, n => patchBarrel(i, bb => { bb.muzzle = [n ?? 0.5, bb.muzzle?.[1] ?? 0] }), undefined, '出弹点 x（相对挂点，格）：火光/弹丸从此发出')}
                      {numField('炮口 y', b.muzzle?.[1], 0.05, n => patchBarrel(i, bb => { bb.muzzle = [bb.muzzle?.[0] ?? 0.5, n ?? 0] }), undefined, '出弹点 y（沿炮管方向，格）')}
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
                      {numField('充能x', art.charge.offset[0], 0.1, n => patch(a => { if (a.charge) a.charge.offset[0] = n ?? 0 }), '0', '充能动画中心 x（相对轴心，格）')}
                      {numField('充能y', art.charge.offset[1], 0.1, n => patch(a => { if (a.charge) a.charge.offset[1] = n ?? 0 }), '0', '充能动画中心 y（沿炮口方向，格）')}
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
              >删除美术配置（恢复几何回退）</button>
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
function FortNumInput({ label, value, set, step }: { label: string; value: number; set: (v: number) => void; step: number }) {
  const [text, setText] = useState<string | null>(null) // 非 null = 聚焦中的本地编辑文本
  return (
    <label className="flex items-center gap-1 text-[10px] font-comic">
      <span className="text-black/70 shrink-0">{label}</span>
      <input
        type="text" inputMode="decimal" step={step}
        value={text ?? String(value)}
        onFocus={e => setText(e.target.value)}
        onBlur={() => setText(null)}
        onChange={e => {
          const raw = e.target.value
          setText(raw)
          const n = Number(raw)
          if (raw.trim() !== '' && !Number.isNaN(n)) set(n)
        }}
        className="w-20 px-1 py-0.5 text-[11px] border-2 border-black bg-[#EFEBD8]"
      />
    </label>
  )
}

function FieldNumInput({ v, step, clearable, onCommit, ph }: {
  v: unknown
  step?: number
  clearable?: boolean
  onCommit: (n: number | undefined) => void
  ph?: string // 未配置时的占位提示（如模板/解析默认值）
}) {
  const num = typeof v === 'number' ? v : (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v)) ? Number(v) : undefined) // v2.20：兼容 f.get 派生字段返回的数值字符串（集束分裂等嵌套字段）
  const [text, setText] = useState('')
  const [focused, setFocused] = useState(false)
  // 非聚焦时直接展示外部值（受控派生，无需 effect 同步）；聚焦时展示本地编辑文本
  const display = focused ? text : (num === undefined ? '' : String(num))
  return (
    <input
      type="number"
      className="w-full min-w-0 px-1 py-0.5 text-[11px] font-comic border-2 border-black bg-[#EFEBD8]"
      step={step ?? 1}
      value={display}
      placeholder={num === undefined ? (ph ?? '未配置') : undefined}
      onFocus={e => { setFocused(true); setText(e.target.value) }}
      onBlur={() => setFocused(false)}
      onChange={e => {
        const raw = e.target.value
        setText(raw)
        if (raw === '') { if (clearable) onCommit(undefined); return }
        const n = Number(raw)
        if (!Number.isNaN(n)) onCommit(n)
      }}
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
  onPatchGame,
  onEnterSceneEdit,
}: {
  onClose: () => void
  onDeleteDef: (defId: string) => void
  /** 战场编辑器「应用并重开/恢复默认」：重置本局游戏 */
  onRestart: () => void
  /** 地形/物体数值改动同步进当前局 game state（可选） */
  onPatchGame?: (fn: (g: GameState) => void) => void
  /** 进入场景编辑模式（地图上笔刷铺设） */
  onEnterSceneEdit: () => void
}) {
  const [, setRev] = useState(0)
  const [tab, setTab] = useState<'turret' | 'ammo' | 'assets' | 'world' | 'editor' | 'fortress' | 'module'>('turret')
  const [selectedId, setSelectedId] = useState<string | null>(TURRET_DEFS[0]?.id ?? null) // 炮塔页签单选（左列表右参数窗）
  const [newType, setNewType] = useState<WeaponType>('direct')
  const [newName, setNewName] = useState('')
  const bump = () => { setRev(r => r + 1); saveAll() } // 所有编辑经 bump：即时持久化
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
    if (def.type === 'beam' && def.rayMode === undefined) def.rayMode = 'beam' // 射线类默认光束子模式
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
    <div className="absolute inset-0 z-40 bg-[#D8D2B8] flex items-stretch">
      <div className="w-full bg-[#D8D2B8] border-l-4 border-black flex flex-col">
        <div className="flex items-center gap-2 px-2 py-1.5 border-b-2 border-black bg-[#C9C29F]">
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
          <button className="comic-btn px-1.5 py-0.5" onClick={onClose} title="关闭">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* 分页栏 */}
        <div className="flex border-b-2 border-black bg-[#C9C29F]">
          {([['turret', '炮塔'], ['ammo', '弹丸库'], ['assets', '素材库'], ['world', '地形/物体'], ['editor', '战场编辑器'], ['fortress', '堡垒'], ['module', '模块']] as const).map(([k, label]) => (
            <button
              key={k}
              className={`flex-1 px-1 py-1 text-[11px] font-comic font-black border-r border-black/40 last:border-r-0 ${
                tab === k ? 'bg-[#B3392E] text-[#EFEBD8]' : 'hover:bg-black/10'
              }`}
              onClick={() => setTab(k)}
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
                    <span className="block text-[8px] text-black/45 truncate">{def.id}</span>
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
              const fields = FIELDS.filter(f => f.showIf ? f.showIf(def) : getPath(def, f.path) !== undefined)
              return (
                <div className="px-2 pb-2 pt-1">

                    {/* id 与素材目录对照（素材文件夹名 = 炮塔 id） */}
                    <div className="text-[9px] font-bold text-black/45 leading-tight mb-1 break-all">
                      id: {def.id} · <TipLabel text="素材目录" tip="炮塔贴图文件夹：/res/turrets/{id}/，缺失则几何绘制" className="font-bold" /> /res/turrets/{def.id}/（缺省几何绘制）
                    </div>
                    {custom && (
                      <div className="flex items-center gap-1 mb-1">
                        <input
                          className="flex-1 min-w-0 px-1 py-0.5 text-[11px] font-comic border-2 border-black bg-[#EFEBD8]"
                          value={def.name}
                          onChange={e => { def.name = e.target.value; bump() }}
                        />
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
                      {/* v1.76：型号（S/M/L）选择——占格随型号联动（S=1×1 / M=1×2 / L=2×2），占格长/宽字段已删除 */}
                      <label className="flex items-center gap-1 min-w-0">
                        <TipLabel text="型号" tip="炮位型号：只能挂到匹配尺寸的炮位；占格随型号——S=1×1 / M=1×2 / L=2×2" className="text-[10px] font-bold text-black/70 shrink-0" />
                        <select
                          className="w-full min-w-0 px-1 py-0.5 text-[11px] font-comic border-2 border-black bg-[#EFEBD8]"
                          value={def.mount}
                          onChange={e => {
                            def.mount = e.target.value as MountSize
                            const f0 = MOUNT_FOOT[def.mount]
                            def.w = f0.w; def.h = f0.h // 占格随型号联动
                            bump()
                          }}
                        >
                          {(['S', 'M', 'L'] as const).map(m => (
                            <option key={m} value={m}>{m} 型（占格 {MOUNT_FOOT[m].w}×{MOUNT_FOOT[m].h}）</option>
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
                                className="w-full min-w-0 px-1 py-0.5 text-[11px] font-comic border-2 border-black bg-[#EFEBD8]"
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
                        <TagEditor def={def} bump={bump} />{/* v2.49 索敌标签（常驻显示） */}
                      </div>
                      <div className="w-[380px] max-w-[46%] shrink-0 portrait:w-full portrait:max-w-none">
                        <ArtEditor
                          def={def}
                          onApply={art => {
                            if (art) def.art = art
                            else delete def.art
                            bump()
                          }}
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
        {tab === 'world' && (<WorldTab bump={bump} onPatchGame={onPatchGame} />)}
        {tab === 'editor' && (<EditorTab bump={bump} onRestart={onRestart} onEnterSceneEdit={onEnterSceneEdit} />)}
        {tab === 'fortress' && (<FortressTab onRestart={onRestart} />)}
        {tab === 'module' && (<ModuleTab bump={bump} />)}
      </div>

      {/* 配置口令导出小窗 */}
      {exportText !== null && (
        <div className="absolute inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
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
        <div className="absolute inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
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

function AssetsTab({ bump }: { bump: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [msg, setMsg] = useState('')
  const [upCat, setUpCat] = useState<AssetCategory>('base') // 上传时选分类（默认底座）
  const onFile = (f: File) => {
    if (!/^image\/(png|jpeg)$/.test(f.type)) { setMsg('仅支持 PNG/JPG'); return }
    const rd = new FileReader()
    rd.onload = () => {
      addAsset(f.name.replace(/\.[^.]+$/, ''), String(rd.result), upCat)
      setMsg(f.size > 500 * 1024 ? `已添加（${Math.round(f.size / 1024)}KB 超过 500KB，注意 localStorage 体积）` : '已添加 ✓')
      bump()
    }
    rd.readAsDataURL(f)
  }
  return (
    // v1.68：根容器改为 flex 列布局（flex-1 min-h-0），列表区占满剩余空间精确滚动——
    // 修复横版下列表拉到最底显示不全（原 space-y-2 无高度约束，内容超出面板被裁剪）
    <div className="flex-1 min-h-0 flex flex-col gap-2 px-2 py-1.5 overflow-hidden">
      <div className="text-[9px] text-black/50 leading-tight shrink-0">
        素材库：上传本地图片（PNG/JPG，超 500KB 软警告仍允许）供分层选配；按分类分门别类——选底座时不会显示底座以外的素材（未分类条目在所有下拉末尾可见）。内置条目（如有）不可删。
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg"
        className="hidden"
        onChange={e => {
          const f = e.target.files?.[0]
          if (f) onFile(f)
          e.target.value = ''
        }}
      />
      <div className="flex items-center gap-1.5 shrink-0">
        <button className="comic-btn px-2 py-1 text-[10px]" onClick={() => fileRef.current?.click()}>+ 上传图片</button>
        <span className="text-[9px] font-bold text-black/60">分类</span>
        <select
          className="px-1 py-0.5 text-[10px] font-comic border-2 border-black bg-[#EFEBD8]"
          value={upCat}
          onChange={e => setUpCat(e.target.value as AssetCategory)}
        >
          {ASSET_CATS.map(c => <option key={c} value={c}>{ASSET_CATEGORY_NAME[c]}</option>)}
        </select>
      </div>
      {msg && <div className="text-[9px] font-bold text-[#B98A1D] shrink-0">{msg}</div>}
      {/* v1.67/v1.68：列表滚动区占满剩余空间（flex-1 min-h-0 取代固定 max-h）——滚轮/手指上下滑动浏览，
          底部留 padding 保证拉到底后末条完整可见；touch-pan-y 允许触屏纵向滚动，overscroll 防穿透 */}
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain touch-pan-y pr-0.5 pb-2">
      {ASSET_CATS.map(cat => {
        const items = listAssets().filter(a => a.category === cat)
        if (items.length === 0) return null
        return (
          <div key={cat}>
            <div className="text-[9px] font-black text-black/55 mt-1">{ASSET_CATEGORY_NAME[cat]}（{items.length}）</div>
            {items.map(a => (
              <div key={a.id} className="comic-card p-1.5 flex items-center gap-1.5 mt-0.5">
                <img src={a.src} alt={a.name} className="w-8 h-8 border border-black object-contain bg-white shrink-0" />
                <div className="min-w-0">
                  <div className="text-[10px] font-bold truncate">{a.name}</div>
                  <div className="text-[8px] text-black/45 truncate">{a.id}</div>
                </div>
                <span className={`ml-auto text-[8px] font-bold shrink-0 ${a.builtin ? 'text-black/40' : 'text-[#2E63B8]'}`}>
                  {a.builtin ? '内置' : '上传'}
                </span>
                {!a.builtin && (
                  <>
                    <select
                      className="px-0.5 py-0 text-[8px] font-comic border border-black bg-[#EFEBD8] shrink-0"
                      value={a.category}
                      title="改分类"
                      onChange={e => { setAssetCategory(a.id, e.target.value as AssetCategory); bump() }}
                    >
                      {ASSET_CATS.map(c => <option key={c} value={c}>{ASSET_CATEGORY_NAME[c]}</option>)}
                    </select>
                    <button className="text-[9px] text-[#B3392E] shrink-0" onClick={() => { removeAsset(a.id); bump() }}>删除</button>
                  </>
                )}
              </div>
            ))}
          </div>
        )
      })}
      </div>
    </div>
  )
}

// ================= 弹丸效果预览（v1.69） =================
const AMMO_FX_CELL = 30 // 1 格 = 30px（与炮塔美术预览一致）
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
          ctx.imageSmoothingEnabled = false
          ctx.drawImage(bodyImg, -bodyImg.width / 2, -bodyImg.height / 2, bodyImg.width, bodyImg.height)
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
        const scroll = ba.scrollSpeed > 0 ? nowSb * ba.scrollSpeed * (AMMO_FX_CELL / 30) : 0
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pa, mode, pa.projectileAsset])

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
const BUILTIN_AMMO = new Set(['bullet_std', 'shell_std', 'rocket_std', 'ray_std'])
const KIND_COLOR: Record<ProjectileArtKind, string> = { bullet: '#E8C86A', shell: '#8FAADC', missile: '#D98F6A', ray: '#9AD9C8' }

function AmmoTab({ bump }: { bump: () => void }) {
  const [selectedId, setSelectedId] = useState<string | null>(PROJECTILE_ARTS[0]?.id ?? null) // 弹丸页签单选（左列表右参数窗）
  const [newName, setNewName] = useState('')
  const addAmmo = () => {
    const name = newName.trim()
    if (!name) return
    let n = 1
    while (PROJECTILE_ARTS.some(a => a.id === `custom_ammo_${n}`)) n++
    PROJECTILE_ARTS.push({ id: `custom_ammo_${n}`, name, kind: 'bullet' }) // 无素材即几何弹丸（通用素材已废止，无需预填）
    setSelectedId(`custom_ammo_${n}`) // 新建后自动选中
    setNewName('')
    bump()
  }
  const FX_TIPS: Record<string, string> = {
    color: '特效主色；默认=弹丸类别色',
    rate: '尾焰粒子发射速率（粒/秒）',
    life: '单粒寿命（秒）',
    size: '粒子尺寸（格）',
    inherit: '尾焰粒子初速随弹比例 0-1：0=原地消散，1=完全随弹飞行',
    spread: '发射方向随机锥角（弧度），越大越散',
    grow: '尺寸变化率：>0 膨胀 <0 收缩',
    fadeIn: '淡入时长（秒），0=立即全亮',
    duration: '矢量底闪播放时长（秒）',
    sparks: '火花粒子数：向外高速、强减速、短寿命',
    smoke: '烟尘粒子数：低速、长寿命、膨胀、暗色',
    rings: '冲击环层数 1-4：相位错开逐层扩散',
    ringSpeed: '冲击环扩散速度系数，>1 更快',
    ringWidth: '冲击环线宽（px）',
    turbulence: '烟尘湍流强度 0-2：漂移抖动幅度',
    speedJitter: '火花初速随机幅度 0-1：每粒速度 ×(1±jitter)',
    lifeJitter: '火花寿命随机幅度 0-1',
    bias: '方向偏置 0-1：火花向命中方向收束，1=完全锥形爆发',
    spikes: '命中碎屑粒子数：短寿命向外飞溅',
  }

  // 程序化特效参数组（远行星号式实时生成，无需序列帧素材；删空数值=用默认）
  const fxGroup = (
    pa: ProjectileArtDef, key: 'trail' | 'explosion' | 'impact', label: string, hint: string,
    fields: [string, string, number][], // [标签, 参数名, step]
    extra?: (fx: Record<string, unknown>) => ReactNode, // 额外控件（模板/渐变色等），渲染在颜色/数值字段之前
    bottom?: (fx: Record<string, unknown>) => ReactNode, // v2.28：底部额外控件（烟尾子组），渲染在全部数值字段之后
  ) => {
    const fx = pa[key] as Record<string, unknown> | undefined
    // 解析后的生效默认值（模板/全局默认），作为留空字段的占位提示——所见即当前生效值
    const resolved = fx
      ? (key === 'trail' ? resolveTrailFx(pa) : key === 'explosion' ? resolveExplosionFx(pa) : resolveImpactFx(pa))
      : null
    return (
      <div key={key} className="mt-1 border-t border-black/15 pt-1">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold text-black/70">{label}</span>
          {fx ? (
            <button className="text-[9px] text-[#B3392E]" onClick={() => { delete pa[key]; bump() }}>删除该特效(回退)</button>
          ) : (
            <button className="text-[9px] text-[#2E63B8]" onClick={() => { (pa as unknown as Record<string, unknown>)[key] = {}; bump() }}>+ 添加{label}</button>
          )}
        </div>
        <div className="text-[8px] text-black/40">{hint}</div>
        {fx && (
          <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 mt-0.5">
            {extra?.(fx)}
            <label className="flex items-center gap-1">
              <TipLabel text="颜色" tip={FX_TIPS.color} className="text-[9px] font-bold text-black/60 w-9 shrink-0" />
              <input
                type="color"
                className="w-8 h-5 border border-black bg-[#EFEBD8]"
                value={(fx.color as string) ?? PROJECTILE_KIND_COLOR[pa.kind]}
                onChange={e => { fx.color = e.target.value; bump() }}
              />
              <button className="text-[8px] text-black/40" onClick={() => { delete fx.color; bump() }}>默认</button>
            </label>
            {fields.map(([flabel, prop, step]) => (
              <label key={prop} className="flex items-center gap-1">
                <TipLabel text={flabel} tip={FX_TIPS[prop]} className="text-[9px] font-bold text-black/60 w-9 shrink-0" />
                <FieldNumInput
                  v={fx[prop] as number | undefined}
                  step={step}
                  clearable
                  ph={resolved && prop in resolved ? String((resolved as unknown as Record<string, unknown>)[prop]) : undefined}
                  onCommit={n => {
                    if (n === undefined) delete fx[prop]
                    else fx[prop] = n
                    bump()
                  }}
                />
              </label>
            ))}
            {bottom?.(fx)}
          </div>
        )}
      </div>
    )
  }
  const selPa = PROJECTILE_ARTS.find(a => a.id === selectedId) ?? null // 右参数窗当前条目
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="text-[9px] text-black/50 leading-tight shrink-0 pb-1">
        弹丸库统一管理：炮塔经「弹丸」引用库条目；条目无素材时按几何回退渲染。素材目录 /res/projectiles/条目id/
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
                <AmmoPreview pa={pa} />
                <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
                  <label className="flex items-center gap-1">
                    <TipLabel text="名称" tip="弹丸条目显示名（仅标识用）" className="text-[9px] font-bold text-black/60 w-9 shrink-0" />
                    <input
                      className="w-full min-w-0 px-1 py-0.5 text-[10px] font-comic border-2 border-black bg-[#EFEBD8]"
                      defaultValue={pa.name}
                      onBlur={e => { pa.name = e.target.value.trim() || pa.name; bump() }}
                    />
                  </label>
                  <label className="flex items-center gap-1">
                    <TipLabel text="类别" tip="实弹/抛射/导弹/射线：决定默认特效色与适配炮塔类型" className="text-[9px] font-bold text-black/60 w-9 shrink-0" />
                    <select
                      className="flex-1 min-w-0 px-1 py-0.5 text-[10px] font-comic border-2 border-black bg-[#EFEBD8]"
                      value={pa.kind}
                      onChange={e => { pa.kind = e.target.value as ProjectileArtKind; bump() }}
                    >
                      {(['bullet', 'shell', 'missile', 'ray'] as const).map(k => (
                        <option key={k} value={k}>{PROJECTILE_KIND_NAME[k]}({k})</option>
                      ))}
                    </select>
                  </label>
                  <label className="flex items-center gap-1 col-span-2">
                    <TipLabel text="弹丸贴图" tip="弹丸本体贴图：素材库引用；默认=按 id 文件夹，缺失则几何弹丸；选「无」强制几何弹丸" className="text-[9px] font-bold text-black/60 w-9 shrink-0" />
                    <select
                      className="flex-1 min-w-0 px-1 py-0.5 text-[10px] font-comic border-2 border-black bg-[#EFEBD8]"
                      value={pa.projectileAsset ?? ''}
                      onChange={e => {
                        if (e.target.value) pa.projectileAsset = e.target.value
                        else delete pa.projectileAsset
                        bump()
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
                  <div className="col-span-2 text-[8px] text-black/40 break-all -mt-0.5">
                    <TipLabel text="素材目录" tip="弹丸贴图文件夹：/res/projectiles/{id}/，缺失则几何弹丸" className="font-bold" /> /res/projectiles/{pa.id}/（缺省几何弹丸）
                  </div>
                </div>
                {pa.kind !== 'ray' && fxGroup(pa, 'trail', '尾焰', '粒子实时生成：行为模板+参数（颜色默认=类别色；惯性=初速随弹比例；渐变=寿命内变色）', [ // v2.8：射线（hitscan 无弹道飞行）不提供尾焰编辑

            ['速率(粒/s)', 'rate', 10], ['寿命(s)', 'life', 0.05], ['尺寸(格)', 'size', 0.02],
            ['惯性(0-1)', 'inherit', 0.05], ['散开(弧度)', 'spread', 0.1], ['尺寸变化', 'grow', 0.5], ['淡入(s)', 'fadeIn', 0.05],
          ], fx => (
            <>
              <label className="flex items-center gap-1">
                <TipLabel text="模板" tip="行为模板：标准拖尾/惯性甩尾/火焰脉冲/烟雾弥漫；数值留空=模板默认，填了以你为准" className="text-[9px] font-bold text-black/60 w-9 shrink-0" />
                <select
                  className="flex-1 min-w-0 px-0.5 py-0.5 text-[9px] font-comic border-2 border-black bg-[#EFEBD8]"
                  value={(fx.template as string) ?? 'standard'}
                  onChange={e => {
                    if (e.target.value === 'standard') delete fx.template
                    else fx.template = e.target.value
                    bump() // 切换模板即时反映（数值留空=模板默认）
                  }}
                >
                  <option value="standard">标准拖尾</option>
                  <option value="inertia">惯性甩尾</option>
                  <option value="pulse">火焰脉冲</option>
                  <option value="smoke">烟雾弥漫</option>
                </select>
              </label>
              <label className="flex items-center gap-1">
                <TipLabel text="渐变色" tip="粒子寿命内从主色渐变到该色；无=仅亮度渐隐不变色" className="text-[9px] font-bold text-black/60 w-9 shrink-0" />
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
                  <div className="col-span-2 border-t border-black/10 pt-0.5 mt-0.5">
                    <div className="flex items-center justify-between">
                      <TipLabel text="烟尾" tip="长存留烟雾尾迹：与主尾焰并行的第二股粒子流（非加法烟团，前 40% 寿命膨胀扩散、之后冻结渐隐）" className="text-[9px] font-bold text-black/60" />
                      {sm ? (
                        <button className="text-[9px] text-[#B3392E]" onClick={() => { delete fx.smoke; bump() }}>删除烟尾</button>
                      ) : (
                        <button className="text-[9px] text-[#2E63B8]" onClick={() => { fx.smoke = {}; bump() }}>+ 添加烟尾</button>
                      )}
                    </div>
                    {sm && (
                      <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 mt-0.5">
                        <label className="flex items-center gap-1">
                          <TipLabel text="寿命(s)" tip="单粒烟团寿命（秒，缺省 3）——烟团存活多久" className="text-[9px] font-bold text-black/60 w-9 shrink-0" />
                          <FieldNumInput v={sm.life as number | undefined} step={0.5} clearable ph="3" onCommit={n => { if (n === undefined) delete sm.life; else sm.life = n; bump() }} />
                        </label>
                        <label className="flex items-center gap-1">
                          <TipLabel text="持续(s)" tip="点火后烟尾喷射窗口（秒）：结束即停喷（已有烟团自然消散）；超过引用炮塔燃烧时间时按燃烧时间钳制；缺省=整个燃烧期" className="text-[9px] font-bold text-black/60 w-9 shrink-0" />
                          <FieldNumInput v={sm.duration as number | undefined} step={0.5} clearable ph="整个燃烧期" onCommit={n => { if (n === undefined) delete sm.duration; else sm.duration = n; bump() }} />
                        </label>
                        <label className="flex items-center gap-1">
                          <TipLabel text="速率" tip="烟团发射速率（粒/秒，缺省 20）" className="text-[9px] font-bold text-black/60 w-9 shrink-0" />
                          <FieldNumInput v={sm.rate as number | undefined} step={5} clearable ph="20" onCommit={n => { if (n === undefined) delete sm.rate; else sm.rate = n; bump() }} />
                        </label>
                        <label className="flex items-center gap-1">
                          <TipLabel text="颜色" tip="烟团颜色（缺省浅灰 #9A958E）" className="text-[9px] font-bold text-black/60 w-9 shrink-0" />
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
                  </div>
                )
              })()}
            </>
          ))}
                {pa.kind !== 'ray' && fxGroup(pa, 'explosion', '爆炸', '粒子实时生成：火球+软边冲击环+瞬时照明+拉丝火花/烟尘（底闪时长；尺寸/速度按爆炸半径；未配置爆炸(blastRadius)时不播放）', [['底闪(s)', 'duration', 0.05], ['火花数', 'sparks', 1], ['烟尘数', 'smoke', 1], ['环数(1-4)', 'rings', 1], ['环速', 'ringSpeed', 0.2], ['环厚(px)', 'ringWidth', 0.5], ['湍流(0-2)', 'turbulence', 0.1], ['速度抖动', 'speedJitter', 0.1], ['寿命抖动', 'lifeJitter', 0.1], ['方向偏置', 'bias', 0.05], ['速度继承', 'inherit', 0.05], ['火球(0-2)', 'fireball', 0.1], ['软边环(0-2)', 'shock', 0.1], ['照明(0-1)', 'flash', 0.05], ['拉丝(0/1)', 'streak', 1]])}
                {pa.kind === 'ray' && ( // v2.8：光束表现板块（仅射线类条目；从炮塔编辑器迁入，战场/预览经 beamArtConfig 同步）
                  <div className="mt-1 border-t border-black/15 pt-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold text-black/70">光束表现</span>
                      {pa.beam ? (
                        <button className="text-[9px] text-[#B3392E]" onClick={() => { delete pa.beam; bump() }}>删除该组（恢复默认搭配）</button>
                      ) : (
                        <button className="text-[9px] text-[#2E63B8]" onClick={() => { pa.beam = {}; bump() }}>+ 添加光束表现</button>
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
                                <button className="text-[8px] text-black/40" onClick={() => { if (pa.beam) { delete pa.beam[key]; bump() } }}>默认</button>
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
                {fxGroup(pa, 'impact', '命中', '粒子实时生成：碎屑飞溅+中心亮点一闪（非爆炸命中）', [['时长(s)', 'duration', 0.01], ['碎屑数', 'spikes', 1]])}
                {!BUILTIN_AMMO.has(pa.id) && (
                  <button className="mt-1 text-[9px] text-[#B3392E] underline" onClick={() => {
                    const i = PROJECTILE_ARTS.findIndex(a => a.id === pa.id)
                    if (i >= 0) PROJECTILE_ARTS.splice(i, 1)
                    if (selectedId === pa.id) setSelectedId(PROJECTILE_ARTS[Math.min(i, PROJECTILE_ARTS.length - 1)]?.id ?? null) // 选中邻近项
                    bump()
                  }}>删除该条目</button>
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

// ================= 地形/物体 Tab =================
const OBJ_KIND_NAME: Record<BattleObject['kind'], string> = { barrel: '油桶', ruins: '废墟', rock: '岩石' }

/** 小数字输入框（事件内通过 set 回调提交，避免在渲染作用域内联突变） */
function NumInput({ v, set, w = 'w-10' }: { v: number; set: (n: number) => void; w?: string }) {
  return (
    <input
      type="number"
      className={`${w} min-w-0 px-0.5 py-0 text-[10px] font-comic border border-black bg-[#EFEBD8]`}
      value={v}
      onChange={e => {
        const n = Number(e.target.value)
        if (!Number.isNaN(n)) set(n)
      }}
    />
  )
}

function WorldTab({ bump, onPatchGame }: { bump: () => void; onPatchGame?: (fn: (g: GameState) => void) => void }) {
  // 物体数值改动（hp/阻挡标志/高度）同步进当前局对应实例（id = 2000 + 下标）
  const liveObject = (i: number, fn: (o: BattleObject) => void) => {
    onPatchGame?.(g => {
      const o = g.objects.find(x => x.id === 2000 + i)
      if (o) fn(o)
    })
  }
  return (
    <div className="flex-1 overflow-y-auto px-2 py-1.5">
      <div className="text-[9px] font-bold text-black/50 mb-1">
        减速系数/物体数值改动本局即时生效；位置/尺寸/增删在「战场编辑器 → 应用并重开」后生效
      </div>

      <div className="text-[10px] font-black text-black/70 mb-0.5">地形（贴地效果层，不挡弹道/移动）</div>
      {LEVEL.terrain.map((t, i) => (
        <div key={i} className="flex items-center gap-1 py-0.5 border-b border-black/20 flex-wrap">
          <span className="text-[10px] font-black w-8 shrink-0">水坑</span>
          <span className="text-[9px] font-bold text-black/50">x</span>
          <NumInput v={t.x} w="w-8" set={n => { setField(t, 'x', n); bump() }} />
          <span className="text-[9px] font-bold text-black/50">y</span>
          <NumInput v={t.y} w="w-8" set={n => { setField(t, 'y', n); bump() }} />
          <span className="text-[9px] font-bold text-black/50">w</span>
          <NumInput v={t.w} w="w-8" set={n => { setField(t, 'w', Math.max(1, n)); bump() }} />
          <span className="text-[9px] font-bold text-black/50">h</span>
          <NumInput v={t.h} w="w-8" set={n => { setField(t, 'h', Math.max(1, n)); bump() }} />
          <span className="text-[9px] font-bold text-black/50">减速</span>
          <NumInput v={t.moveModifier} set={n => { setField(t, 'moveModifier', n); bump() }} />
          <button
            className="comic-btn px-1 py-0 text-[9px] ml-auto shrink-0"
            onClick={() => { LEVEL.terrain.splice(i, 1); bump() }}
          >删</button>
        </div>
      ))}
      <button
        className="comic-btn px-1.5 py-0.5 text-[10px] flex items-center gap-0.5 mt-1"
        onClick={() => { LEVEL.terrain.push({ kind: 'puddle', x: 2, y: 3, w: 2, h: 1, moveModifier: 0.5 }); bump() }}
      >
        <Plus className="w-3 h-3" /> 新增水坑
      </button>

      <div className="text-[10px] font-black text-black/70 mt-2 mb-0.5">物体（hp 填 -1 = 不可破坏）</div>
      {LEVEL.objects.map((o, i) => (
        <div key={i} className="py-1 border-b border-black/20">
          <div className="flex items-center gap-1 flex-wrap">
            <select
              className="px-0.5 py-0 text-[10px] font-comic border border-black bg-[#EFEBD8]"
              value={o.kind}
              onChange={e => {
                const k = e.target.value as BattleObject['kind']
                setField(o, 'kind', k)
                liveObject(i, lo => { setField(lo, 'kind', k) })
                bump()
              }}
            >
              {(Object.keys(OBJ_KIND_NAME) as BattleObject['kind'][]).map(k => (
                <option key={k} value={k}>{OBJ_KIND_NAME[k]}</option>
              ))}
            </select>
            <span className="text-[9px] font-bold text-black/50">x</span>
            <NumInput v={o.x} w="w-8" set={n => { setField(o, 'x', n); bump() }} />
            <span className="text-[9px] font-bold text-black/50">y</span>
            <NumInput v={o.y} w="w-8" set={n => { setField(o, 'y', n); bump() }} />
            <span className="text-[9px] font-bold text-black/50">w</span>
            <NumInput v={o.w} w="w-8" set={n => { setField(o, 'w', Math.max(1, n)); bump() }} />
            <span className="text-[9px] font-bold text-black/50">h</span>
            <NumInput v={o.h} w="w-8" set={n => { setField(o, 'h', Math.max(1, n)); bump() }} />
            <button
              className="comic-btn px-1 py-0 text-[9px] ml-auto shrink-0"
              onClick={() => { LEVEL.objects.splice(i, 1); bump() }}
            >删</button>
          </div>
          <div className="flex items-center gap-1 mt-0.5 flex-wrap">
            <span className="text-[9px] font-bold text-black/50">hp</span>
            <NumInput v={o.hp} w="w-12" set={n => {
              setField(o, 'hp', n)
              liveObject(i, lo => { setField(lo, 'hp', n); setField(lo, 'maxHp', n) })
              bump()
            }} />
            <label className="flex items-center gap-0.5 text-[9px] font-bold text-black/50">
              <input
                type="checkbox"
                className="w-3 h-3 accent-[#B3392E]"
                checked={o.blockMove}
                onChange={e => {
                  setField(o, 'blockMove', e.target.checked)
                  liveObject(i, lo => { setField(lo, 'blockMove', e.target.checked) })
                  bump()
                }}
              />挡移动
            </label>
            <label className="flex items-center gap-0.5 text-[9px] font-bold text-black/50">
              <input
                type="checkbox"
                className="w-3 h-3 accent-[#B3392E]"
                checked={o.blockProjectile}
                onChange={e => {
                  setField(o, 'blockProjectile', e.target.checked)
                  liveObject(i, lo => { setField(lo, 'blockProjectile', e.target.checked) })
                  bump()
                }}
              />挡弹道
            </label>
            <span className="text-[9px] font-bold text-black/50">高度</span>
            <NumInput v={o.height} w="w-8" set={n => {
              setField(o, 'height', n)
              liveObject(i, lo => { setField(lo, 'height', n) })
              bump()
            }} />
          </div>
        </div>
      ))}
      <button
        className="comic-btn px-1.5 py-0.5 text-[10px] flex items-center gap-0.5 mt-1"
        onClick={() => {
          LEVEL.objects.push({ kind: 'ruins', x: 4, y: 4, w: 2, h: 2, hp: 150, blockMove: true, blockProjectile: true, height: 1 })
          bump()
        }}
      >
        <Plus className="w-3 h-3" /> 新增物体
      </button>
    </div>
  )
}

// ================= 战场编辑器 Tab =================
/** 模块级字段写入（编辑器语义即直接改写 LEVEL 单例），避免在渲染作用域内联突变 */
function setField<T extends object, K extends keyof T>(obj: T, key: K, val: T[K]) {
  obj[key] = val
}

function EditorTab({ bump, onRestart, onEnterSceneEdit }: { bump: () => void; onRestart: () => void; onEnterSceneEdit: () => void }) {
  // 校验（应用时执行）
  const warnings: string[] = []
  const { core } = LEVEL
  const cellSet = new Set(LEVEL.buildCells)
  if (LEVEL.buildCells.length === 0) warnings.push('基地格为空：请用场景编辑铺设基地格（边界自动成墙）')
  if (core) {
    const coreOverlap = LEVEL.buildings.some(b =>
      core.x < b.x + b.w && core.x + CORE.w > b.x && core.y < b.y + b.h && core.y + CORE.h > b.y)
    if (core.x < 1 || core.x + CORE.w > LEVEL.cols - 1 || core.y < 0 || core.y + CORE.h > LEVEL.rows - 1) {
      warnings.push(`核心需位于界内（x 1–${LEVEL.cols - 1 - CORE.w}，y 0–${LEVEL.rows - 1 - CORE.h}）`)
    } else if (coreOverlap) {
      warnings.push('核心与固有建筑重叠')
    }
  }
  for (const b of LEVEL.buildings) {
    if (b.w < 1 || b.h < 1 || b.x < 0 || b.x + b.w > LEVEL.cols || b.y < 0 || b.y + b.h > LEVEL.rows) {
      warnings.push(`建筑「${b.name}」位置/尺寸越界`)
    }
  }
  LEVEL.initialTurrets.forEach((t, i) => {
    const def = TURRET_DEFS.find(d => d.id === t.defId)
    if (!def) { warnings.push(`初始炮塔 #${i + 1}：定义 ${t.defId} 不存在`); return }
    let inZone = true
    for (let dx = 0; dx < def.w && inZone; dx++)
      for (let dy = 0; dy < def.h && inZone; dy++)
        if (!cellSet.has(`${t.x + dx},${t.y + dy}`)) inZone = false
    const overlapCore = !!core && t.x < core.x + CORE.w && t.x + def.w > core.x && t.y < core.y + CORE.h && t.y + def.h > core.y
    const overlapB = LEVEL.buildings.some(b =>
      t.x < b.x + b.w && t.x + def.w > b.x && t.y < b.y + b.h && t.y + def.h > b.y)
    const overlapT = LEVEL.initialTurrets.some((o, j) => {
      if (j === i) return false
      const od = TURRET_DEFS.find(d => d.id === o.defId)
      if (!od) return false
      return t.x < o.x + od.w && t.x + def.w > o.x && t.y < o.y + od.h && t.y + def.h > o.y
    })
    if (!inZone || overlapCore || overlapB || overlapT) {
      warnings.push(`初始炮塔 ${def.name}@(${t.x},${t.y}) 放置非法，应用时将被跳过`)
    }
  })

  return (
    <div className="flex-1 overflow-y-auto px-2 py-1.5">
      <div className="text-[9px] font-bold text-black/50 mb-1">
        数值表单为精确微调；推荐「进入场景编辑」在地图上笔刷铺设。改动在「应用并重开」后生效
      </div>

      <button
        className="comic-btn w-full px-2 py-1 text-[11px] font-black mb-1"
        onClick={onEnterSceneEdit}
      >
        进入场景编辑（地图笔刷铺设）
      </button>

      <div className="flex items-center gap-1 py-0.5">
        <span className="text-[10px] font-black text-black/70">宽度(格)</span>
        <span className="w-14 shrink-0">
          {/* v1.50：FieldNumInput 本地草稿模式——可删空重输（旧受控 onChange 立即钳值导致无法删除干净），失焦回落 */}
          <FieldNumInput v={LEVEL.cols} step={1} onCommit={n => {
            if (n === undefined) return // 删空不提交，失焦回落实况值
            const v = Math.max(COLS_MIN, Math.round(n)) // 上限不限（reanchorCols 内部仍兜底有限性）
            reanchorCols(LEVEL, v) // 左侧锚定迁移全部元素（出界丢弃、部分出界收缩）
            saveLevel()
            bump()
          }} />
        </span>
        <span className="text-[9px] font-bold text-black/50">≥{COLS_MIN} · 上限不限（{LEVEL.cols * 25}m）· 左侧锚定重排，重开后墙体重算</span>
      </div>

      <div className="flex items-center gap-1 py-0.5">
        <span className="text-[10px] font-black text-black/70">纵深(格)</span>
        <span className="w-14 shrink-0">
          {/* v1.50：同宽度——可删空重输，失焦回落 */}
          <FieldNumInput v={LEVEL.rows} step={1} onCommit={n => {
            if (n === undefined) return
            const v = Math.max(ROWS_MIN, Math.round(n)) // 上限不限（reanchorRows 内部仍兜底有限性）
            reanchorRows(LEVEL, v) // 底部锚定迁移全部元素（核心/建筑/基地格随下沿平移）
            saveLevel()
            bump()
          }} />
        </span>
        <span className="text-[9px] font-bold text-black/50">≥{ROWS_MIN} · 上限不限（{LEVEL.rows * 25}m）· 底部锚定重排，重开后墙体重算</span>
      </div>

      <div className="flex items-center gap-1 py-0.5">
        <span className="text-[10px] font-black text-black/70">基地格</span>
        <span className="text-[9px] font-bold text-black/50">{LEVEL.buildCells.length} 格 · 笔刷铺设/擦除，边界自动成墙（灰底描边=墙段预览）</span>
      </div>

      <div className="flex items-center gap-1 py-0.5">
        <span className="text-[10px] font-black text-black/70">核心</span>
        {core ? (
          <>
            <span className="text-[9px] font-bold text-black/50">x</span>
            <NumInput v={core.x} set={n => { setField(core, 'x', n); bump() }} />
            <span className="text-[9px] font-bold text-black/50">y</span>
            <NumInput v={core.y} set={n => { setField(core, 'y', n); bump() }} />
            <span className="text-[9px] font-bold text-black/40">（{CORE.w}×{CORE.h}）</span>
          </>
        ) : (
          <>
            <span className="text-[9px] font-bold text-[#B3392E]">已删除（无核心不判负）</span>
            <button
              className="comic-btn px-1.5 py-0 text-[9px]"
              onClick={() => { LEVEL.core = { x: CORE.x, y: CORE.y }; bump() }}
            >恢复默认位</button>
          </>
        )}
      </div>

      <div className="text-[10px] font-black text-black/70 mt-1 mb-0.5">固有建筑（点行选中，场景编辑点地图放置）</div>
      {LEVEL.buildings.map((b, i) => (
        <div
          key={b.id}
          className={`flex items-center gap-1 py-0.5 border-b border-black/20 flex-wrap cursor-pointer ${
            BRUSH_DEFAULTS.selectedBuildingId === b.id ? 'bg-[#D9A441]/25' : ''
          }`}
          onClick={() => { BRUSH_DEFAULTS.selectedBuildingId = b.id; bump() }}
        >
          <input
            className="w-12 min-w-0 px-0.5 py-0 text-[10px] font-comic border border-black bg-[#EFEBD8]"
            value={b.name}
            onChange={e => { setField(b, 'name', e.target.value); bump() }}
          />
          <span className="text-[9px] font-bold text-black/50">x</span>
          <NumInput v={b.x} w="w-8" set={n => { setField(b, 'x', n); bump() }} />
          <span className="text-[9px] font-bold text-black/50">y</span>
          <NumInput v={b.y} w="w-8" set={n => { setField(b, 'y', n); bump() }} />
          <span className="text-[9px] font-bold text-black/50">w</span>
          <NumInput v={b.w} w="w-8" set={n => { setField(b, 'w', n); bump() }} />
          <span className="text-[9px] font-bold text-black/50">h</span>
          <NumInput v={b.h} w="w-8" set={n => { setField(b, 'h', n); bump() }} />
          <button
            className="comic-btn px-1 py-0 text-[9px] ml-auto shrink-0"
            onClick={() => { LEVEL.buildings.splice(i, 1); bump() }}
          >删</button>
        </div>
      ))}
      <button
        className="comic-btn px-1.5 py-0.5 text-[10px] flex items-center gap-0.5 mt-1"
        onClick={() => {
          const id = Math.max(999, ...LEVEL.buildings.map(b => b.id)) + 1
          LEVEL.buildings.push({ id, name: '新建筑', x: 4, y: 24, w: 2, h: 1, color: '#8A8272' })
          bump()
        }}
      >
        <Plus className="w-3 h-3" /> 新增建筑
      </button>

      <div className="text-[10px] font-black text-black/70 mt-2 mb-0.5">初始炮塔（开局免费）</div>
      {LEVEL.initialTurrets.map((t, i) => (
        <div key={i} className="flex items-center gap-1 py-0.5 border-b border-black/20 flex-wrap">
          <select
            className="px-0.5 py-0 text-[10px] font-comic border border-black bg-[#EFEBD8] max-w-[110px]"
            value={t.defId}
            onChange={e => { setField(t, 'defId', e.target.value); bump() }}
          >
            {TURRET_DEFS.map(d => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
          <span className="text-[9px] font-bold text-black/50">x</span>
          <NumInput v={t.x} w="w-8" set={n => { setField(t, 'x', n); bump() }} />
          <span className="text-[9px] font-bold text-black/50">y</span>
          <NumInput v={t.y} w="w-8" set={n => { setField(t, 'y', n); bump() }} />
          <button
            className="comic-btn px-1 py-0 text-[9px] ml-auto shrink-0"
            onClick={() => { LEVEL.initialTurrets.splice(i, 1); bump() }}
          >删</button>
        </div>
      ))}
      <button
        className="comic-btn px-1.5 py-0.5 text-[10px] flex items-center gap-0.5 mt-1"
        onClick={() => { LEVEL.initialTurrets.push({ defId: TURRET_DEFS[0]?.id ?? 'mg', x: 5, y: 22 }); bump() }}
      >
        <Plus className="w-3 h-3" /> 新增初始炮塔
      </button>

      <div className="text-[10px] font-black text-black/70 mt-2 mb-0.5">笔刷默认值（场景编辑用）</div>
      <div className="flex items-center gap-1 py-0.5 flex-wrap">
        <span className="text-[9px] font-bold text-black/50">水坑减速</span>
        <NumInput v={BRUSH_DEFAULTS.moveModifier} set={n => { BRUSH_DEFAULTS.moveModifier = n; bump() }} />
        <span className="text-[9px] font-bold text-black/50">炮塔</span>
        <select
          className="px-0.5 py-0 text-[10px] font-comic border border-black bg-[#EFEBD8] max-w-[100px]"
          value={BRUSH_DEFAULTS.turretDefId}
          onChange={e => { BRUSH_DEFAULTS.turretDefId = e.target.value; bump() }}
        >
          {TURRET_DEFS.map(d => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
      </div>
      {(['barrel', 'ruins', 'rock'] as const).map(k => (
        <div key={k} className="flex items-center gap-1 py-0.5 flex-wrap">
          <span className="text-[9px] font-black text-black/70 w-8">{OBJ_KIND_NAME[k]}</span>
          <span className="text-[9px] font-bold text-black/50">hp</span>
          <NumInput v={BRUSH_DEFAULTS.obj[k].hp} w="w-10" set={n => { BRUSH_DEFAULTS.obj[k].hp = n; bump() }} />
          <span className="text-[9px] font-bold text-black/50">高度</span>
          <NumInput v={BRUSH_DEFAULTS.obj[k].height} w="w-8" set={n => { BRUSH_DEFAULTS.obj[k].height = n; bump() }} />
          <label className="flex items-center gap-0.5 text-[9px] font-bold text-black/50">
            <input
              type="checkbox"
              className="w-3 h-3 accent-[#B3392E]"
              checked={BRUSH_DEFAULTS.obj[k].blockMove}
              onChange={e => { BRUSH_DEFAULTS.obj[k].blockMove = e.target.checked; bump() }}
            />挡移动
          </label>
          <label className="flex items-center gap-0.5 text-[9px] font-bold text-black/50">
            <input
              type="checkbox"
              className="w-3 h-3 accent-[#B3392E]"
              checked={BRUSH_DEFAULTS.obj[k].blockProjectile}
              onChange={e => { BRUSH_DEFAULTS.obj[k].blockProjectile = e.target.checked; bump() }}
            />挡弹道
          </label>
        </div>
      ))}
      <div className="flex items-center gap-1 py-0.5 flex-wrap">
        <span className="text-[9px] font-bold text-black/50">建筑名</span>
        <input
          className="w-14 min-w-0 px-0.5 py-0 text-[10px] font-comic border border-black bg-[#EFEBD8]"
          value={BRUSH_DEFAULTS.building.name}
          onChange={e => { BRUSH_DEFAULTS.building.name = e.target.value; bump() }}
        />
        <span className="text-[9px] font-bold text-black/50">w</span>
        <NumInput v={BRUSH_DEFAULTS.building.w} w="w-8" set={n => { BRUSH_DEFAULTS.building.w = Math.max(1, n); bump() }} />
        <span className="text-[9px] font-bold text-black/50">h</span>
        <NumInput v={BRUSH_DEFAULTS.building.h} w="w-8" set={n => { BRUSH_DEFAULTS.building.h = Math.max(1, n); bump() }} />
      </div>

      {warnings.length > 0 && (
        <div className="mt-2 px-1.5 py-1 border-2 border-[#B3392E] bg-[#B3392E]/10">
          {warnings.map((w, i) => (
            <div key={i} className="text-[9px] font-bold text-[#B3392E]">⚠ {w}</div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-1.5 mt-2 pb-2">
        <button
          className={`comic-btn px-2 py-1 text-[11px] font-black ${warnings.length > 0 ? 'opacity-40 pointer-events-none' : ''}`}
          onClick={() => { saveLevel(); onRestart() }}
        >
          应用并重开
        </button>
        <button
          className="comic-btn px-2 py-1 text-[11px]"
          onClick={() => { resetLevel(); onRestart() }}
        >
          恢复默认
        </button>
      </div>
      <div className="text-[9px] font-bold text-black/40 pb-1">
        应用后写入 localStorage（td-level-config），刷新仍保留；恢复默认清除并还原现有关卡
      </div>
    </div>
  )
}

// ================= 堡垒编辑器页签：内置可直接编辑 / 外部模式（底盘·炮位·特效点）/ 内部模式（内部格阵·特殊格） / 出战选择 =================

const ALL_WEAPON_TYPES = Object.keys(TYPE_NAME) as WeaponType[]
const BOOST_KEYS = Object.keys(SPECIAL_BOOST_NAME) as SpecialBoost[]
const EFFECT_KIND_KEYS = Object.keys(EFFECT_KIND_NAME) as FortressEffectKind[]

// ================= v2.30 模块编辑器（MODULE_DEFS 注册表直改，bump 落盘 td-module-defs；贴图锚定素材库「模块」分类） =================
const MODULE_BONUS_FIELDS: [keyof ModuleDef, string, number, string][] = [ // [字段, 标签, step, 说明]
  ['energyRegen', '发电(/s)', 1, '电力回复 +点/s'], ['energyCap', '储电上限', 5, '储电上限 +'],
  ['ammoRegen', '弹药(/s)', 0.5, '弹药回复 +发/s'], ['ammoCap', '弹药上限', 5, '弹药储存上限 +'],
  ['cooling', '散热(/s)', 1, '堡垒散热 +点/s（全额叠加不摊薄）'], ['hpBoost', '血量+', 50, '船体血量上限加成'],
  ['speedBoost', '移速+', 0.05, '移动速度加成（格/s，可负）'], ['turnBoost', '转向+', 5, '转向速度加成（度/s，可负）'],
  ['repair', '维修/s', 1, '修复功率池 hp/s（均摊到受损炮塔）'], ['rangeBoost', '射程+', 0.05, '射程增益池（比例，0.5=+50%，均摊）'],
]
const ALLY_KIND_NAME: Record<AllyKind, string> = { soldier: '士兵', tank: '坦克', plane: '战斗机' }

function ModuleTab({ bump }: { bump: () => void }) {
  const [selectedId, setSelectedId] = useState(MODULE_DEFS[0]?.id ?? '')
  const md = MODULE_DEFS.find(d => d.id === selectedId) ?? null
  const errs: string[] = []
  if (md) {
    if (!md.id.trim() || MODULE_DEFS.some(d => d !== md && d.id === md.id)) errs.push('id 为空或与其他模块重复')
    if (!(md.w >= 1) || !(md.h >= 1)) errs.push('占格 w/h 须 ≥ 1')
    if (!(md.cost >= 0)) errs.push('造价须 ≥ 0')
    if (md.produce && (!(md.produce.interval > 0) || !(md.produce.cap >= 1))) errs.push('生产周期须 >0 且存活上限 ≥ 1')
  }
  // v2.32：id 全自动（唯一兜底），编辑器不再提供 id 输入框
  const genId = (base: string) => {
    let id = base
    while (MODULE_DEFS.some(d => d.id === id)) id += 'x'
    return id
  }
  const createNew = () => {
    const d: ModuleDef = { id: genId(`mod_${Date.now() % 100000}`), name: '新模块', desc: '', cost: 100, w: 1, h: 1, color: '#8A8E86' }
    MODULE_DEFS.push(d)
    setSelectedId(d.id)
    bump()
  }
  const copyOne = () => {
    if (!md) return
    const d = structuredClone(md)
    d.id = genId(`${md.id}_c${Date.now() % 1000}`)
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
  const assetEntry = md?.asset ? getAsset(md.asset) : undefined
  const req = (label: string, key: 'cost', step: number) => md && (
    <label className="flex items-center gap-1" key={key}>
      <TipLabel text={label} tip="建造造价（金币，≥0）" className="text-[9px] font-bold text-black/60 w-12 shrink-0" />
      <FieldNumInput v={md[key]} step={step} onCommit={n => {
        if (n === undefined) return
        md.cost = n
        bump()
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
    md.w = maxX - minX + 1
    md.h = maxY - minY + 1
    const norm = [...on].map(c => {
      const [x, y] = c.split(',').map(Number)
      return `${x - minX},${y - minY}`
    })
    if (norm.length === md.w * md.h) delete md.shape // 全满包围盒 → 回矩形态
    else md.shape = norm
    bump()
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
            {d.name}<span className="block text-[8px] opacity-60">{d.id} · {d.w}×{d.h}</span>
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
                <input value={md.name} onChange={e => { md.name = e.target.value; bump() }} className="w-28 px-1 py-0.5 text-[10px] font-comic border-2 border-black bg-[#EFEBD8]" />
              </label>
              {req('造价', 'cost', 10)}
              <span className="text-[9px] text-black/55 self-center">包围盒 {md.w}×{md.h}（铺格自动）</span>
              <label className="flex items-center gap-1">
                <TipLabel text="颜色" tip="无贴图时的色块颜色（建造卡片也用）" className="text-[9px] font-bold text-black/60 w-12 shrink-0" />
                <input type="color" value={md.color} onChange={e => { md.color = e.target.value; bump() }} className="w-8 h-5 border border-black bg-[#EFEBD8]" />
              </label>
            </div>
            <label className="flex items-center gap-1">
              <TipLabel text="描述" className="text-[9px] font-bold text-black/60 w-12 shrink-0" />
              <input value={md.desc} onChange={e => { md.desc = e.target.value; bump() }} className="flex-1 px-1 py-0.5 text-[10px] font-comic border-2 border-black bg-[#EFEBD8]" />
            </label>
            {/* 贴图锚定（素材库「模块」分类） */}
            <div className="flex items-center gap-1.5 border-t border-black/15 pt-1">
              <TipLabel text="贴图" tip="模块贴图：锚定素材库「模块」分类条目（素材库页签上传时选模块分类）；无=色块+名称回退。局内按占格拉伸、随模块旋向" className="text-[9px] font-bold text-black/60 w-12 shrink-0" />
              <select
                className="px-0.5 py-0.5 text-[10px] font-comic border-2 border-black bg-[#EFEBD8]"
                value={md.asset ?? ''}
                onChange={e => { if (e.target.value) md.asset = e.target.value; else delete md.asset; bump() }}
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
                <button className="comic-btn px-1.5 py-0.5 text-[10px]" disabled={!md.shape} onClick={() => { delete md.shape; bump() }}>填满为矩形</button>
                {md.shape && <span className="text-[9px] text-black/50">异型：{md.shape.length}/{md.w * md.h} 格</span>}
                {shapeConnWarn && <span className="text-[9px] font-bold text-[#B3392E]">{'\u26a0'}{shapeConnWarn}</span>}
                {GRID > GRID5 && <span className="text-[9px] font-bold text-[#B3392E]">{'\u26a0'}遗留模块超出 5×5 底格，点击挖格收缩后自动恢复 5×5</span>}
              </div>
            </div>
            {/* 加成字段（留空=无此加成） */}
            <div className="border-t border-black/15 pt-1">
              <div className="text-[9px] font-bold text-black/50 mb-0.5">加成（留空 = 无此项）：</div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                {MODULE_BONUS_FIELDS.map(([key, label, step, tip]) => (
                  <label className="flex items-center gap-1" key={key}>
                    <TipLabel text={label} tip={tip} className="text-[9px] font-bold text-black/60 w-12 shrink-0" />
                    <FieldNumInput
                      v={md[key] as number | undefined}
                      step={step}
                      clearable
                      onCommit={n => { if (n === undefined) delete md[key]; else (md as unknown as Record<string, unknown>)[key] = n; bump() }}
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
                value={md.produce ? md.produce.kind : ''}
                onChange={e => {
                  if (e.target.value) md.produce = { kind: e.target.value as AllyKind, interval: md.produce?.interval ?? 10, cap: md.produce?.cap ?? 3 }
                  else delete md.produce
                  bump()
                }}
              >
                <option value="">无</option>
                {(Object.keys(ALLY_KIND_NAME) as AllyKind[]).map(k => <option key={k} value={k}>{ALLY_KIND_NAME[k]}</option>)}
              </select>
              {md.produce && (<>
                <label className="flex items-center gap-1">
                  <TipLabel text="周期(s)" tip="多少秒产出 1 个" className="text-[9px] font-bold text-black/60 w-12 shrink-0" />
                  <FieldNumInput v={md.produce.interval} step={1} onCommit={n => { if (n !== undefined && md.produce) { md.produce.interval = Math.max(0.5, n); bump() } }} />
                </label>
                <label className="flex items-center gap-1">
                  <TipLabel text="存活上限" tip="本模块同时存活产出单位上限" className="text-[9px] font-bold text-black/60 w-12 shrink-0" />
                  <FieldNumInput v={md.produce.cap} step={1} onCommit={n => { if (n !== undefined && md.produce) { md.produce.cap = Math.max(1, Math.floor(n)); bump() } }} />
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

function newCustomFortress(): FortressDef {
  const d = structuredClone(DEFAULT_FORTRESS)
  d.id = `fort-${Date.now()}`
  d.name = `自定义堡垒${listCustomFortresses().length + 1}`
  // 展开为显式自由网格（可在此基础上镂空/扩建）
  d.shape = []
  for (let x = 0; x < d.w; x++) for (let y = 0; y < d.h; y++) d.shape.push(`${x},${y}`)
  return d
}

function FortressTab({ onRestart }: { onRestart: () => void }) {
  const [, setRev] = useState(0)
  const bump = () => setRev(r => r + 1)
  const [selectedId, setSelectedId] = useState<string>(getSelectedFortressId())
  const [draft, setDraft] = useState<FortressDef | null>(null) // 编辑中副本（保存才落库）
  const [view, setView] = useState<'exterior' | 'interior'>('exterior') // 预览模式：外部/内部
  const [tool, setTool] = useState<'shape' | 'hp' | 'fx' | 'icell' | 'special'>('shape')
  const [boost, setBoost] = useState<SpecialBoost | 'none'>('cooling')
  const [hpSel, setHpSel] = useState<string | null>(null)
  // 贴图原始尺寸缓存：预览按原比例 1:1 显示（1 贴图像素 = 1 预览像素），中心对准底格中心
  const [spriteDims, setSpriteDims] = useState<Record<string, { w: number; h: number }>>({})
  const [msg, setMsg] = useState('')

  const customs = listCustomFortresses()
  const baseDef = FORTRESS_DEFS.find(f => f.id === selectedId) ?? FORTRESS_DEFS[0]
  const isFactory = !customs.some(f => f.id === selectedId) && baseDef.id === DEFAULT_FORTRESS.id // 未改动的内置
  const overridden = isBuiltinFortressOverridden(selectedId) // 内置但已被覆盖
  const cur = draft ?? baseDef
  const selectedIsDeployed = getSelectedFortressId() === selectedId
  const errors = draft ? validateFortressDef(draft) : []
  const shapeSet = fortressShapeSet(cur)
  const iSet = fortressInteriorSet(cur)

  const select = (id: string) => { setSelectedId(id); setDraft(null); setHpSel(null); setMsg(''); resetHist() }

  // v2.29 撤销/重做：历史栈（cap 50）——mutate 压栈，800ms 内连续编辑（打字/连点）合并为一步；切换/保存/新建/复制/删除清空
  const histRef = useRef<{ stack: FortressDef[]; idx: number; lastPush: number }>({ stack: [], idx: -1, lastPush: 0 })
  const [, setHistRev] = useState(0)
  function resetHist() {
    histRef.current = { stack: [], idx: -1, lastPush: 0 }
    setHistRev(r => r + 1)
  }
  const canUndo = histRef.current.idx > 0
  const canRedo = histRef.current.idx >= 0 && histRef.current.idx < histRef.current.stack.length - 1
  const undo = () => {
    const h = histRef.current
    if (h.idx <= 0) return
    h.idx -= 1
    setDraft(structuredClone(h.stack[h.idx]))
    setHistRev(r => r + 1)
  }
  const redo = () => {
    const h = histRef.current
    if (h.idx >= h.stack.length - 1) return
    h.idx += 1
    setDraft(structuredClone(h.stack[h.idx]))
    setHistRev(r => r + 1)
  }
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

  const ensureDraft = (): FortressDef | null => { // 内置/自定义均可直接编辑
    if (draft) return draft
    const d = structuredClone(baseDef)
    setDraft(d)
    return d
  }
  const mutate = (fn: (d: FortressDef) => void) => {
    const d = ensureDraft()
    if (!d) return
    const h = histRef.current
    if (h.idx < 0) { h.stack = [structuredClone(d)]; h.idx = 0; h.lastPush = 0 } // 基线 = 首次编辑前状态
    const now = Date.now()
    const merged = now - h.lastPush < 800 && h.idx > 0 && h.idx === h.stack.length - 1
    fn(d)
    setDraft({ ...d })
    const snap = structuredClone(d)
    h.stack = h.stack.slice(0, h.idx + 1) // 撤销后再编辑：截断 redo 分支
    if (merged) h.stack[h.stack.length - 1] = snap
    else {
      h.stack.push(snap)
      if (h.stack.length > 50) h.stack.shift()
      h.idx = h.stack.length - 1
    }
    h.lastPush = now
    setHistRev(r => r + 1)
  }

  const createNew = () => {
    const d = newCustomFortress()
    saveCustomFortress(d)
    select(d.id)
    setMsg('已新建自定义堡垒（基于测试堡垒），可直接编辑')
  }
  const copyAsCustom = () => {
    const d = newCustomFortress()
    const srcDef = structuredClone(baseDef)
    d.w = srcDef.w; d.h = srcDef.h
    d.shape = srcDef.shape ? [...srcDef.shape] : d.shape
    d.interior = { ...srcDef.interior }
    d.interiorCells = srcDef.interiorCells ? [...srcDef.interiorCells] : undefined
    d.interiorSpecials = srcDef.interiorSpecials ? structuredClone(srcDef.interiorSpecials) : undefined
    d.effects = srcDef.effects ? structuredClone(srcDef.effects) : undefined
    d.hp = srcDef.hp; d.speed = srcDef.speed; d.turnSpeed = srcDef.turnSpeed; d.accel = srcDef.accel
    d.heatCap = srcDef.heatCap; d.heatDissipation = srcDef.heatDissipation
    d.hardpoints = structuredClone(srcDef.hardpoints)
    d.color = srcDef.color
    saveCustomFortress(d)
    select(d.id)
    setMsg(`已复制「${baseDef.name}」为自定义堡垒`)
  }
  const save = () => {
    if (!draft) { setMsg('\u26a0没有待保存的改动'); return }
    if (errors.length > 0) {
      setMsg(`\u26a0校验未通过（${errors.length} 项）：${errors[0]}${errors.length > 1 ? '；其余见下方校验面板' : ''}`)
      return
    }
    saveCustomFortress(draft)
    setDraft(null)
    resetHist()
    bump()
    const base = overridden || baseDef.id === DEFAULT_FORTRESS.id ? '已保存（内置堡垒已修改，可「恢复出厂」还原）' : '已保存（出战堡垒重开一局后生效）'
    setMsg(fortressPersistFailed() ? `\u26a0${base}；但本地存储写入失败（空间不足），刷新后将丢失` : base)
  }
  const removeOrRestore = () => {
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

  const onUpload = (which: 'spriteBase' | 'spriteBody', f: File | undefined) => {
    if (!f) return
    const r = new FileReader()
    r.onload = () => {
      const img = new Image()
      img.onload = () => {
        const MAX = 384 // 贴图最长边上限：压缩 dataURL 体积，避免 localStorage 超配额
        const scale = Math.min(1, MAX / Math.max(img.width, img.height, 1))
        const cv = document.createElement('canvas')
        cv.width = Math.max(1, Math.round(img.width * scale))
        cv.height = Math.max(1, Math.round(img.height * scale))
        const cx = cv.getContext('2d')
        if (!cx) { setMsg('\u26a0贴图处理失败'); return }
        cx.drawImage(img, 0, 0, cv.width, cv.height)
        const url = cv.toDataURL('image/png')
        mutate(d => { d[which] = url })
        setMsg(`贴图已压缩为 ${cv.width}\u00d7${cv.height} 写入草稿（记得点保存）`)
      }
      img.onerror = () => setMsg('\u26a0图片读取失败')
      img.src = String(r.result)
    }
    r.onerror = () => setMsg('\u26a0文件读取失败')
    r.readAsDataURL(f)
  }

  // 画布点击：按当前模式/子工具分发
  const clickCell = (cx: number, cy: number) => {
    if (tool === 'shape') {
      mutate(d => {
        const set = new Set(d.shape ?? [...fortressShapeSet(d)])
        const k = `${cx},${cy}`
        if (set.has(k)) set.delete(k)
        else set.add(k)
        d.shape = [...set]
        let mx = 0
        let my = 0
        for (const kk of set) {
          const [x, y] = kk.split(',').map(Number)
          mx = Math.max(mx, x)
          my = Math.max(my, y)
        }
        d.w = mx + 1
        d.h = my + 1
        // 级联擦除：底盘格被擦掉时，对应内部格与其特殊格一并移除（隐式满矩形则实化后剔除）
        if (!set.has(k)) {
          const had = d.interiorCells ? d.interiorCells.includes(k) : (cx < d.interior.cols && cy < d.interior.rows)
          if (had) {
            const base = new Set(d.interiorCells ?? (() => {
              const a: string[] = []
              for (let x = 0; x < d.interior.cols; x++) for (let y = 0; y < d.interior.rows; y++) a.push(`${x},${y}`)
              return a
            })())
            base.delete(k)
            d.interiorCells = [...base]
            const sp = (d.interiorSpecials ?? []).filter(c => !(c.x === cx && c.y === cy))
            d.interiorSpecials = sp.length > 0 ? sp : undefined
          }
        }
      })
    } else if (tool === 'icell') {
      if (!shapeSet.has(`${cx},${cy}`)) return // 内部格必须落在底盘格内
      mutate(d => {
        const set = new Set(d.interiorCells ?? [...fortressInteriorSet(d)])
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
  const numInput = (label: string, value: number, set: (v: number) => void, step = 1) => (
    <FortNumInput label={label} value={value} set={set} step={step} />
  )

  // v1.70 炮位坐标：原点 = 堡垒中心（dx 右+、dy 上+，单位格），输入框步进 0.1（v1.69 箭头改回输入框）
  const hpCoord = (hp: Hardpoint) => {
    const dx = Math.round((hp.x - cur.w / 2) * 10) / 10
    const dy = Math.round((cur.h / 2 - hp.y) * 10) / 10
    const setDx = (v: number) => mutate(d => {
      const h = d.hardpoints.find(x => x.id === hp.id)!
      h.x = Math.round((d.w / 2 + Math.max(-d.w / 2, Math.min(d.w / 2, v))) * 10) / 10
    })
    const setDy = (v: number) => mutate(d => {
      const h = d.hardpoints.find(x => x.id === hp.id)!
      h.y = Math.round((d.h / 2 - Math.max(-d.h / 2, Math.min(d.h / 2, v))) * 10) / 10
    })
    const inp = 'w-14 px-1 py-0.5 text-[11px] border-2 border-black bg-[#EFEBD8]'
    return (
      <span className="flex items-center gap-1 text-[10px] font-comic" title="炮位坐标：原点=堡垒中心；dx 向右为正、dy 向上为正；步进 0.1 格">
        <span className="text-black/70 shrink-0">坐标</span>
        <span className="text-black/50 shrink-0">dx</span>
        <input type="number" step={0.1} value={dx} onChange={e => { const n = Number(e.target.value); if (!Number.isNaN(n)) setDx(n) }} className={inp} />
        <span className="text-black/50 shrink-0">dy</span>
        <input type="number" step={0.1} value={dy} onChange={e => { const n = Number(e.target.value); if (!Number.isNaN(n)) setDy(n) }} className={inp} />
      </span>
    )
  }

  // 画布几何
  const gridCols = Math.max(9, Math.min(30, cur.w + 2)) // 背景格至少 9 列（与常见堡垒宽度同奇偶，整数格精确居中）
  const gridRows = Math.max(10, Math.min(18, cur.h + 2)) // 背景格至少 10 行
  const px = Math.max(16, Math.min(30, Math.floor(360 / gridCols)))
  // 堡垒在预览画布中居中：渲染位置 = 局部坐标 + 整数格偏移；点击反向换算（负局部坐标不可交互）
  const offX = Math.floor((gridCols - cur.w) / 2)
  const offY = Math.floor((gridRows - cur.h) / 2)
  const FX_COLOR: Record<FortressEffectKind, string> = { smoke: '#888880', flame: '#D87828', dust: '#96825F', spark: '#F0DC78' }
  useEffect(() => {
    const trackSrcs = (cur.tracks ?? []).map(t => getAsset(t.tile)?.src ?? t.tile) // v1.87：履带瓦片也进尺寸缓存（预览用）
    for (let src of [cur.spriteBase, cur.spriteBody, ...trackSrcs]) {
      if (!src) continue
      src = resCompatUrl(src) // v2.5 兼容旧 /sprites/ 路径
      if (spriteDims[src]) continue
      const im = new Image()
      im.onload = () => setSpriteDims(m => (m[src] ? m : { ...m, [src]: { w: im.naturalWidth, h: im.naturalHeight } }))
      im.src = src
    }
  })
  /** 贴图预览元素：原尺寸 1:1，中心对准底格（包围盒）中心 */
  const spriteImg = (src: string | undefined, key: string) => {
    if (!src) return null
    src = resCompatUrl(src) // v2.5 兼容旧 /sprites/ 路径
    const dm = spriteDims[src]
    if (!dm) return null // 尺寸未就绪：本帧跳过，onload 后自动出现
    const cx = (offX + cur.w / 2) * px
    const cy = (offY + cur.h / 2) * px
    return <image key={key} href={src} x={cx - dm.w / 2} y={cy - dm.h / 2} width={dm.w} height={dm.h} pointerEvents="none" />
  }

  return (
    <div className="flex-1 min-h-0 flex">
      {/* 左：堡垒类型库（置最左，与炮塔页签一致） */}
      <div className="w-[96px] shrink-0 overflow-y-auto border-r border-black/30 flex flex-col">
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
      </div>
      {/* 右：内容区 */}
      <div className="flex-1 min-w-0 overflow-y-auto p-2 flex flex-col gap-2">

      {/* 操作行 */}
      <div className="flex flex-wrap items-center gap-1">
        <button className="comic-btn px-1.5 py-0.5 text-[10px]" disabled={!canUndo} onClick={undo} title="撤销（Ctrl+Z）">撤销</button>
        <button className="comic-btn px-1.5 py-0.5 text-[10px]" disabled={!canRedo} onClick={redo} title="重做（Ctrl+Y / Ctrl+Shift+Z）">重做</button>
        <button className="comic-btn px-1.5 py-0.5 text-[10px]" onClick={copyAsCustom}>复制为新自定义</button>
        <button
          className={`comic-btn px-1.5 py-0.5 text-[10px] ${draft && errors.length > 0 ? '!border-[#B3392E] !text-[#B3392E]' : ''}`}
          disabled={!draft}
          onClick={save}
        >保存{draft ? (errors.length > 0 ? `（${errors.length} 项待修复）` : '（有改动）') : ''}</button>
        {draft && <button className="comic-btn px-1.5 py-0.5 text-[10px]" onClick={() => select(selectedId)}>放弃改动</button>}
        {!isFactory && (
          <button className="comic-btn px-1.5 py-0.5 text-[10px] flex items-center gap-0.5" onClick={removeOrRestore}>
            <Trash2 className="w-3 h-3" />{overridden ? '恢复出厂' : '删除'}
          </button>
        )}
        {!selectedIsDeployed && <>
          <button className="comic-btn px-1.5 py-0.5 text-[10px]" onClick={() => deploy(false)}>设为出战（下局生效）</button>
          <button className="comic-btn px-1.5 py-0.5 text-[10px]" onClick={() => deploy(true)}>设为出战并重开</button>
        </>}
        {selectedIsDeployed && <span className="text-[10px] font-comic text-black/60">当前出战堡垒</span>}
        {msg && <span className={`text-[10px] font-comic ${msg.startsWith('\u26a0') ? 'text-[#B3392E]' : 'text-[#2E5B2E]'}`}>{msg}</span>}
      </div>

      {/* 属性 + 贴图：PC 端属性置左、贴图板块置右 */}
      <div className="flex flex-col lg:flex-row gap-1.5 items-start">
      {/* 基础属性（内置也可直接改） */}
      <div className="border-2 border-black bg-[#D2CCA9] p-1.5 flex-1 min-w-0 w-full flex flex-wrap gap-x-3 gap-y-1 items-center">
        <label className="flex items-center gap-1 text-[10px] font-comic">
          <span className="text-black/70 shrink-0">名称</span>
          <input
            value={cur.name}
            onChange={e => mutate(d => { d.name = e.target.value })}
            className="w-28 px-1 py-0.5 text-[11px] border-2 border-black bg-[#EFEBD8]"
          />
        </label>
        {numInput('耐久', cur.hp, v => mutate(d => { d.hp = v }), 100)}
        {numInput('移动速度', cur.speed, v => mutate(d => { d.speed = v }), 0.1)}
        {numInput('加速度', cur.accel, v => mutate(d => { d.accel = v }), 0.5)}
        {numInput('刹停惯性', cur.brakeInertia ?? 5, v => mutate(d => { d.brakeInertia = v }), 1)}
        {numInput('车身俯仰', cur.pitchGain ?? 4, v => mutate(d => { d.pitchGain = v }), 1)}
        {numInput('俯仰位移', cur.leanCap ?? 4, v => mutate(d => { d.leanCap = v }), 1)} // v1.93：目标倾角上限 1~8px
        {numInput('倒退系数', cur.reverseFactor ?? 0.8, v => mutate(d => { d.reverseFactor = v }), 0.05)}
        {numInput('转向速度', cur.turnSpeed, v => mutate(d => { d.turnSpeed = v }), 5)}
        {numInput('转向半径', cur.turnRadius ?? 0, v => mutate(d => { d.turnRadius = v }), 0.5)}
        {/* v2.51 底盘类型 + 分组参数（履带/轮式；转向半径>0 时两底盘通用弧线覆盖） */}
        <label className="flex items-center gap-1 text-[10px] font-comic" title="履带差速：低速可原地枢轴转向；轮式前轮转向：静止不能转向，高速受附着上限压缩转角。转向半径>0 时覆盖为两底盘通用弧线模式">
          <span className="text-black/70 shrink-0">底盘</span>
          <select value={cur.chassis ?? 'tracked'} onChange={e => mutate(d => { d.chassis = e.target.value as 'tracked' | 'wheeled' })} className="px-1 py-0.5 text-[10px] border-2 border-black bg-[#EFEBD8]">
            <option value="tracked">履带（差速/原地转向）</option>
            <option value="wheeled">轮式（前轮转向）</option>
          </select>
        </label>
        {(cur.chassis ?? 'tracked') === 'tracked' && (<>
          {numInput('履带间距', cur.trackWidth ?? cur.w, v => mutate(d => { d.trackWidth = v }), 0.5)}
          {numInput('转向阻力', cur.turnDrag ?? 0, v => mutate(d => { d.turnDrag = v }), 0.1)}
        </>)}
        {cur.chassis === 'wheeled' && (<>
          {numInput('轴距', cur.wheelbase ?? Math.round(cur.h * 0.6 * 10) / 10, v => mutate(d => { d.wheelbase = v }), 0.5)}
          {numInput('前轮转角°', cur.steerMax ?? 35, v => mutate(d => { d.steerMax = v }), 5)}
          {numInput('方向盘°/s', cur.steerRate ?? 120, v => mutate(d => { d.steerRate = v }), 10)}
          {numInput('附着m/s²', cur.gripMax ?? 8, v => mutate(d => { d.gripMax = v }), 1)}
        </>)}
        {numInput('热量上限', cur.heatCap, v => mutate(d => { d.heatCap = v }), 10)}
        {numInput('自然散热', cur.heatDissipation, v => mutate(d => { d.heatDissipation = v }), 1)}
        <label className="flex items-center gap-1 text-[10px] font-comic">
          <span className="text-black/70">颜色</span>
          <input type="color" value={cur.color} onChange={e => mutate(d => { d.color = e.target.value })} className="w-8 h-6 border-2 border-black" />
        </label>
        <span className="text-[10px] font-comic text-black/60">包围盒 {cur.w}×{cur.h}（由形状派生） · 内部格 {iSet.size} 个 · 转向半径 0=原地转向，&gt;0=绕外侧圆心弧线转向 · 倒退系数 0~1（倒退极速/加速度 = 前进 × 系数） · 刹停惯性 1=急停（3×)～5=同加速度～10=长滑行（1/5×) · 车身俯仰 0~10（0=关闭；加速后倾/减速前倾/转向侧倾）</span>
      </div>

      {/* 贴图板块（属性右侧）：底座贴图 / 主体贴图 */}
      <div className="border-2 border-black bg-[#D2CCA9] p-1.5 shrink-0 flex flex-col gap-1.5">
        {(['spriteBase', 'spriteBody'] as const).map(which => (
          <div key={which} className="flex items-center gap-1.5">
            <span className="text-[10px] font-comic text-black/70">{which === 'spriteBase' ? '底座贴图' : '主体贴图'}</span>
            {cur[which] && <img src={cur[which]} alt="" className="w-10 h-10 object-contain border border-black/40 bg-black/10" />}
            <label className="comic-btn px-1.5 py-0.5 text-[10px] cursor-pointer">
              上传
              <input type="file" accept="image/*" className="hidden" onChange={e => { onUpload(which, e.target.files?.[0]); e.target.value = '' }} />
            </label>
            {cur[which] && <button className="comic-btn px-1.5 py-0.5 text-[10px]" onClick={() => mutate(d => { delete d[which] })}>清除</button>}
            <span className="text-[9px] text-black/50">仅视觉 · 原尺寸居中不缩放（超过 384px 会压缩）</span>
          </div>
        ))}
      </div>
      </div>

      {/* 编辑区：PC 端预览置左 + 参数置右，移动端纵向堆叠 */}
      <div className="flex flex-col lg:flex-row gap-1.5 items-start">
      {/* 预览模式 + 子工具 */}
      <div className="border-2 border-black bg-[#D2CCA9] p-1.5 shrink-0">
        <div className="flex flex-wrap items-center gap-1 mb-1">
          <span className="text-[10px] font-black text-black/70">预览：</span>
          {([['exterior', '外部模式'], ['interior', '内部模式']] as const).map(([k, label]) => (
            <button key={k} className={`comic-btn px-1.5 py-0.5 text-[10px] ${view === k ? 'bg-[#B3392E] text-[#EFEBD8]' : ''}`}
              onClick={() => { setView(k); setTool(k === 'exterior' ? 'shape' : 'icell') }}>{label}</button>
          ))}
          <span className="text-black/40 text-[10px]">|</span>
          {view === 'exterior' && (<>
            {([['shape', '铺/擦底盘格'], ['hp', '炮位落点'], ['fx', '特效点']] as const).map(([k, label]) => (
              <button key={k} className={`comic-btn px-1.5 py-0.5 text-[10px] ${tool === k ? 'bg-[#B3392E] text-[#EFEBD8]' : ''}`} onClick={() => setTool(k)}>{label}</button>
            ))}
            {tool === 'fx' && (<>
              <span className="text-[9px] text-black/50">点击空格添加（默认 烟雾·始终，生成后在下方列表配置类型/时机/坐标）/ 点击同格移除</span>
            </>)}
            {tool === 'hp' && <span className="text-[9px] text-black/50">点击画布设置选中炮位锚点（格中心）</span>}
          </>)}
          {view === 'interior' && (<>
            {([['icell', '铺/擦内部格'], ['special', '特殊格']] as const).map(([k, label]) => (
              <button key={k} className={`comic-btn px-1.5 py-0.5 text-[10px] ${tool === k ? 'bg-[#B3392E] text-[#EFEBD8]' : ''}`} onClick={() => setTool(k)}>{label}</button>
            ))}
            {tool === 'special' && (
              <select value={boost} onChange={e => setBoost(e.target.value as SpecialBoost | 'none')} className="px-1 py-0.5 text-[10px] font-comic border-2 border-black bg-[#EFEBD8]">
                <option value="none">清除特殊格</option>
                {BOOST_KEYS.map(b => <option key={b} value={b}>{SPECIAL_BOOST_NAME[b]}加成 ×1.5</option>)}
              </select>
            )}
            {tool === 'icell' && <button className="comic-btn px-1.5 py-0.5 text-[10px]" onClick={() => mutate(d => { d.interiorCells = undefined })}>重置为矩形</button>}
          </>)}
        </div>
        <svg width={gridCols * px} height={gridRows * px} className="block mx-auto border border-black/30 bg-[#EFEBD8] touch-none select-none">
          {view === 'interior' && spriteImg(cur.spriteBase, 'base-i') /* 内部模式：底座贴图垫底参照（原尺寸，主体不显示） */}
          {Array.from({ length: gridCols * gridRows }, (_, i) => {
            const gx = i % gridCols // 画布格（渲染位置）
            const gy = Math.floor(i / gridCols)
            const cx = gx - offX // 堡垒局部坐标（数据/交互）
            const cy = gy - offY
            const inBounds = cx >= 0 && cy >= 0 // 局部坐标非负才可编辑（画布左/上边距仅留白）
            const k = `${cx},${cy}`
            const inShape = inBounds && shapeSet.has(k)
            const inInterior = inBounds && iSet.has(k)
            const sp = inBounds ? (cur.interiorSpecials ?? []).find(c => c.x === cx && c.y === cy) : undefined
            let fill = 'transparent'
            if (inShape) fill = view === 'interior'
              ? (inInterior ? (cur.spriteBase ? 'rgba(60,64,56,0.55)' : 'rgba(60,64,56,0.85)') : (cur.spriteBase ? 'rgba(118,122,110,0.25)' : 'rgba(118,122,110,0.35)'))
              : (inInterior ? 'rgba(60,64,56,0.85)' : cur.color)
            return (
              <g key={i} onClick={() => { if (inBounds) clickCell(cx, cy) }} className={inBounds ? 'cursor-pointer' : ''}>
                <rect x={gx * px} y={gy * px} width={px} height={px}
                  fill={sp ? 'rgba(180,140,60,0.55)' : fill}
                  stroke="rgba(0,0,0,0.25)" strokeWidth={0.5} />
                {sp && <text x={gx * px + px / 2} y={gy * px + px / 2 + 3} textAnchor="middle" fontSize={px * 0.42} fill="#EFEBD8" pointerEvents="none">{SPECIAL_BOOST_NAME[sp.boost][0]}</text>}
              </g>
            )
          })}
          {view === 'exterior' && spriteImg(cur.spriteBase, 'base-e') /* 底座贴图：原尺寸居中，与游戏渲染一致 */}
          {view === 'exterior' && (cur.tracks ?? []).map(t => { // v1.87：预览按当前设置真实渲染履带瓦片（相位 0 静态；左 + 右侧镜像）
            const src = getAsset(t.tile)?.src ?? t.tile
            const dm = src ? spriteDims[src] : undefined
            if (!src || !dm) return null
            const tileLenC = dm.h / BASE_CELL
            const wpxP = (dm.w / BASE_CELL) * px // 图宽原尺寸
            const els = []
            for (const mirror of [false, true]) {
              for (const pl of trackPlacements(t, 0, tileLenC)) {
                const hpx = tileLenC * pl.scaleY * px
                if (hpx < 0.3) continue
                const cxP = ((mirror ? cur.w - pl.x : pl.x) + offX) * px
                const cyP = (pl.y + offY) * px
                els.push(<image key={`${mirror ? 'r' : 'l'}-${els.length}`} href={src} x={cxP - wpxP / 2} y={cyP - hpx / 2}
                  width={wpxP} height={hpx} opacity={pl.alpha} preserveAspectRatio="none" pointerEvents="none" />)
              }
            }
            // 轮圆标定参考线（细线，不遮挡瓦片）
            for (const mirror of [false, true]) {
              const mx = (x: number) => (mirror ? cur.w - x : x)
              els.push(<circle key={`wc${mirror ? 'r' : 'l'}1`} cx={(mx(t.x1) + offX) * px} cy={(t.y1 + offY) * px} r={t.radius * px} fill="none" stroke="#B3392E" strokeWidth={0.8} strokeOpacity={0.5} pointerEvents="none" />)
              els.push(<circle key={`wc${mirror ? 'r' : 'l'}2`} cx={(mx(t.x2) + offX) * px} cy={(t.y2 + offY) * px} r={t.radius * px} fill="none" stroke="#B3392E" strokeWidth={0.8} strokeOpacity={0.5} pointerEvents="none" />)
            }
            return <g key={t.id}>{els}</g>
          })}
          {view === 'exterior' && (cur.wheels ?? []).map(wd => { // v2.51：预览按当前设置渲染轮子（δ=0 静态；转向轮画红色轮毂参考线）
            const wpx51 = (wd.x + offX) * px
            const wpy51 = (wd.y + offY) * px
            const rpx51 = Math.max(1.5, wd.r * px)
            const src51 = wd.sprite ? (getAsset(wd.sprite)?.src ?? wd.sprite) : null
            const dm51 = src51 ? spriteDims[src51] : undefined
            const twW = rpx51 * 1.1, thH = rpx51 * 2
            return (
              <g key={wd.id} pointerEvents="none">
                {src51 && dm51 ? (
                  <image href={src51} x={wpx51 - (dm51.w / dm51.h) * thH / 2} y={wpy51 - thH / 2}
                    width={(dm51.w / dm51.h) * thH} height={thH} preserveAspectRatio="none" />
                ) : (
                  <rect x={wpx51 - twW / 2} y={wpy51 - thH / 2} width={twW} height={thH} rx={twW * 0.35}
                    fill="#2A2A28" stroke="#1A1A18" strokeWidth={0.8} />
                )}
                <line x1={wpx51} y1={wpy51 - thH * 0.28} x2={wpx51} y2={wpy51 + thH * 0.28}
                  stroke={wd.steered ? '#B3392E' : '#8C8878'} strokeWidth={0.8} />
              </g>
            )
          })}
          {view === 'exterior' && spriteImg(cur.spriteBody, 'body-e') /* 主体贴图：原尺寸居中，盖在底座之上 */}
          {view === 'exterior' && (() => {
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
          {view === 'exterior' && (() => { // v1.70 坐标原点标记：堡垒中心（炮位坐标 dx/dy 的零点）
            const ox = (cur.w / 2 + offX) * px
            const oy = (cur.h / 2 + offY) * px
            return (
              <g pointerEvents="none">
                <line x1={ox - 5} y1={oy} x2={ox + 5} y2={oy} stroke="#B3392E" strokeWidth={1.5} />
                <line x1={ox} y1={oy - 5} x2={ox} y2={oy + 5} stroke="#B3392E" strokeWidth={1.5} />
                <text x={ox + 7} y={oy + 9} fontSize={8} fill="#B3392E">原点</text>
              </g>
            )
          })()}
          {view === 'exterior' && cur.hardpoints.map(hp => (
            <g key={hp.id} pointerEvents="none">
              <circle cx={(hp.x + offX) * px} cy={(hp.y + offY) * px} r={px * (hp.size === 'L' ? 0.42 : hp.size === 'M' ? 0.34 : 0.26)}
                fill={hp.hidden ? 'rgba(80,80,80,0.7)' : 'rgba(200,181,104,0.85)'}
                stroke={hpSel === hp.id ? '#B3392E' : '#1A1A18'} strokeWidth={hpSel === hp.id ? 2.5 : 1} />
              <text x={(hp.x + offX) * px} y={(hp.y + offY) * px + 3} textAnchor="middle" fontSize={px * 0.36} fill="#1A1A18">{hp.size}</text>
            </g>
          ))}
          {view === 'exterior' && (cur.effects ?? []).map(e => (
            <g key={e.id} pointerEvents="none">
              <circle cx={(e.x + offX) * px} cy={(e.y + offY) * px} r={px * 0.16} fill={FX_COLOR[e.kind]} stroke="#1A1A18" strokeWidth={0.8} />
              <text x={(e.x + offX) * px} y={(e.y + offY) * px - px * 0.22} textAnchor="middle" fontSize={px * 0.28} fill="#1A1A18">
                {EFFECT_KIND_NAME[e.kind][0]}{e.state === 'idle' ? '停' : e.state === 'move' ? '动' : ''}
              </text>
            </g>
          ))}
        </svg>
        <div className="text-[9px] text-black/50 mt-0.5">
          {view === 'exterior' ? '深色=内部空间 · 贴图=底座/主体（原尺寸） · 圆=炮位（灰=隐藏内置） · 彩点=特效点 · 绿扇/绿圈=选中炮位视界' : '深色=内部模块格 · 浅色=底盘非内部格 · 黄底字=特殊格 · 底图垫底（原尺寸）'}
        </div>
      </div>

      {/* 参数区（PC 端位于预览右侧，随外部/内部模式切换） */}
      <div className="flex-1 min-w-0 w-full flex flex-col gap-1.5">
      {/* 内部模式：空间尺寸（缺省矩形） */}
      {view === 'interior' && (
        <div className="border-2 border-black bg-[#D2CCA9] p-1.5 flex flex-wrap gap-x-3 gap-y-1 items-center">
          <span className="text-[10px] font-black text-black/70">内部空间缺省矩形（清空自由格阵后生效）：</span>
          {numInput('列数', cur.interior.cols, v => mutate(d => { d.interior.cols = Math.max(1, Math.floor(v)) }))}
          {numInput('行数', cur.interior.rows, v => mutate(d => { d.interior.rows = Math.max(1, Math.floor(v)) }))}
        </div>
      )}

      {/* 外部模式：特效点列表 */}
      {view === 'exterior' && (cur.effects ?? []).length > 0 && (
        <div className="border-2 border-black bg-[#D2CCA9] p-1.5">
          <div className="text-[10px] font-black text-black/70 mb-1">特效点（按堡垒状态播放/切换）：</div>
          <div className="flex flex-wrap gap-1">
            {(cur.effects ?? []).map(e => (
              <span key={e.id} className="flex flex-wrap items-center gap-1 border border-black/40 px-1 py-0.5 text-[10px] font-comic">
                <i className="inline-block w-2.5 h-2.5 rounded-full border border-black/50" style={{ background: FX_COLOR[e.kind] }} />
                {/* v1.75：生成后可配置——停止时/移动时可选用不同特效；坐标可手填，最小调整单位 0.1 */}
                <select value={e.kind} onChange={ev => mutate(d => { d.effects!.find(x => x.id === e.id)!.kind = ev.target.value as FortressEffectKind })} className="px-0.5 py-0 text-[10px] font-comic border border-black bg-[#EFEBD8]">
                  {EFFECT_KIND_KEYS.map(k => <option key={k} value={k}>{EFFECT_KIND_NAME[k]}</option>)}
                </select>
                <select value={e.state} onChange={ev => mutate(d => { d.effects!.find(x => x.id === e.id)!.state = ev.target.value as FortressEffectState })} className="px-0.5 py-0 text-[10px] font-comic border border-black bg-[#EFEBD8]">
                  {(Object.keys(EFFECT_STATE_NAME) as FortressEffectState[]).map(st => <option key={st} value={st}>{EFFECT_STATE_NAME[st]}</option>)}
                </select>
                {/* v2.40：渲染层级（缺省 尘土=地面/其余=空中）；地面层 = 堡垒底座之下 */}
                <select value={e.layer ?? (e.kind === 'dust' ? 'ground' : 'air')} onChange={ev => mutate(d => { d.effects!.find(x => x.id === e.id)!.layer = ev.target.value as FortressEffectLayer })} title="渲染层级：地面=底座之下，空中=最上" className="px-0.5 py-0 text-[10px] font-comic border border-black bg-[#EFEBD8]">
                  {(Object.keys(EFFECT_LAYER_NAME) as FortressEffectLayer[]).map(l => <option key={l} value={l}>{EFFECT_LAYER_NAME[l]}</option>)}
                </select>
                {numInput('x', e.x, v => mutate(d => { d.effects!.find(x => x.id === e.id)!.x = Math.round(v * 10) / 10 }), 0.1)}
                {numInput('y', e.y, v => mutate(d => { d.effects!.find(x => x.id === e.id)!.y = Math.round(v * 10) / 10 }), 0.1)}
                <button className="text-[#B3392E] font-black" onClick={() => mutate(d => { d.effects = (d.effects ?? []).filter(x => x.id !== e.id); if (d.effects.length === 0) d.effects = undefined })}>×</button>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 外部模式：履带列表（v1.85 瓦片循环动画标定） */}
      {view === 'exterior' && (
        <div className="border-2 border-black bg-[#D2CCA9] p-1.5">
          <div className="flex items-center gap-1 mb-1">
            <span className="text-[10px] font-black text-black/70">履带：</span>
            <button className="comic-btn px-1.5 py-0.5 text-[10px] flex items-center gap-0.5" onClick={() => mutate(d => {
              const nid = `track${(d.tracks ?? []).length + 1}-${Date.now() % 1000}`
              d.tracks = [...(d.tracks ?? []), { id: nid, x1: 0.5, y1: 0.5, x2: 0.5, y2: d.h - 0.5, radius: 0.5, tile: 'builtin:library/track01', overlapPx: 2 }]
            })}><Plus className="w-3 h-3" />添加</button>
          </div>
          <div className="flex flex-col gap-1.5">
            {(cur.tracks ?? []).map(t => (
              <div key={t.id} className="border border-black/40 p-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="text-[10px] font-comic text-black/70">{t.id}</span>
                  <label className="comic-btn px-1 py-0 text-[10px] cursor-pointer" title="上传履带瓦片（入素材库底座类并引用；瓦片尺寸取原图）">
                    上传
                    <input type="file" accept="image/png,image/jpeg" className="hidden" onChange={e => {
                      const f = e.target.files?.[0]; e.target.value = ''
                      if (!f) return
                      const rd = new FileReader()
                      rd.onload = () => { const a = addAsset(f.name.replace(/\.[^.]+$/, ''), String(rd.result), 'base'); mutate(d => { d.tracks!.find(x => x.id === t.id)!.tile = a.id }); setMsg(`履带瓦片已入素材库：${a.name}`) }
                      rd.readAsDataURL(f)
                    }} />
                  </label>
                  {numInput('前轮x', t.x1, v => mutate(d => { d.tracks!.find(x => x.id === t.id)!.x1 = v }), 0.1)}
                  {numInput('前轮y', t.y1, v => mutate(d => { d.tracks!.find(x => x.id === t.id)!.y1 = v }), 0.1)}
                  {numInput('后轮x', t.x2, v => mutate(d => { d.tracks!.find(x => x.id === t.id)!.x2 = v }), 0.1)}
                  {numInput('后轮y', t.y2, v => mutate(d => { d.tracks!.find(x => x.id === t.id)!.y2 = v }), 0.1)}
                  {numInput('轮半径', t.radius, v => mutate(d => { d.tracks!.find(x => x.id === t.id)!.radius = v }), 0.05)}
                  {numInput('重叠px', t.overlapPx, v => mutate(d => { d.tracks!.find(x => x.id === t.id)!.overlapPx = v }), 1)}
                  <button className="text-[#B3392E] font-black" onClick={() => mutate(d => { d.tracks = (d.tracks ?? []).filter(x => x.id !== t.id); if (d.tracks.length === 0) d.tracks = undefined })}>×</button>
                </div>
              </div>
            ))}
            {(cur.tracks ?? []).length === 0 && <span className="text-[10px] text-black/40">未配置履带（无履带动画层）</span>}
          </div>
        </div>
      )}

      {/* 外部模式：轮子列表（v2.51 轮式底盘美术；与履带独立共存——半履带 = 前轮后履带） */}
      {view === 'exterior' && (
        <div className="border-2 border-black bg-[#D2CCA9] p-1.5">
          <div className="flex items-center gap-1 mb-1">
            <span className="text-[10px] font-black text-black/70">轮子：</span>
            <button className="comic-btn px-1.5 py-0.5 text-[10px] flex items-center gap-0.5" onClick={() => mutate(d => {
              const nid = `wheel${(d.wheels ?? []).length + 1}-${Date.now() % 1000}`
              const front = (d.wheels ?? []).length < 2 // 默认前两个为转向轮（前轮）
              d.wheels = [...(d.wheels ?? []), { id: nid, x: d.w / 2, y: front ? 1 : d.h - 1, r: 0.4, steered: front }]
            })}><Plus className="w-3 h-3" />添加</button>
            <span className="text-[9px] text-black/50">转向轮随方向盘偏转；未配贴图 = 几何轮胎；落印 = 轮心压痕（沿用履带瓦片）</span>
          </div>
          <div className="flex flex-col gap-1.5">
            {(cur.wheels ?? []).map(wd => (
              <div key={wd.id} className="border border-black/40 p-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="text-[10px] font-comic text-black/70">{wd.id}</span>
                  <label className="comic-btn px-1 py-0 text-[10px] cursor-pointer" title="上传轮子贴图（入素材库底座类并引用；原比例按 2×半径 定高）">
                    上传
                    <input type="file" accept="image/png,image/jpeg" className="hidden" onChange={e => {
                      const f = e.target.files?.[0]; e.target.value = ''
                      if (!f) return
                      const rd = new FileReader()
                      rd.onload = () => { const a = addAsset(f.name.replace(/\.[^.]+$/, ''), String(rd.result), 'base'); mutate(d => { d.wheels!.find(x => x.id === wd.id)!.sprite = a.id }); setMsg(`轮子贴图已入素材库：${a.name}`) }
                      rd.readAsDataURL(f)
                    }} />
                  </label>
                  {numInput('x', wd.x, v => mutate(d => { d.wheels!.find(x => x.id === wd.id)!.x = v }), 0.1)}
                  {numInput('y', wd.y, v => mutate(d => { d.wheels!.find(x => x.id === wd.id)!.y = v }), 0.1)}
                  {numInput('半径', wd.r, v => mutate(d => { d.wheels!.find(x => x.id === wd.id)!.r = v }), 0.05)}
                  <label className="flex items-center gap-0.5 text-[10px] font-comic" title="转向轮：随前轮转角 δ 偏转（前轮勾上，后轮不勾）">
                    <input type="checkbox" checked={wd.steered ?? false} onChange={e => mutate(d => { d.wheels!.find(x => x.id === wd.id)!.steered = e.target.checked })} className="w-3 h-3 accent-[#B3392E]" />
                    转向
                  </label>
                  <button className="text-[#B3392E] font-black" onClick={() => mutate(d => { d.wheels = (d.wheels ?? []).filter(x => x.id !== wd.id); if (d.wheels.length === 0) d.wheels = undefined })}>×</button>
                </div>
              </div>
            ))}
            {(cur.wheels ?? []).length === 0 && <span className="text-[10px] text-black/40">未配置轮子（轮式底盘可无贴图运行——无轮子视觉层）</span>}
          </div>
        </div>
      )}

      {/* 外部模式：炮位列表 */}
      {view === 'exterior' && (
        <div className="border-2 border-black bg-[#D2CCA9] p-1.5">
          <div className="flex items-center gap-1 mb-1">
            <span className="text-[10px] font-black text-black/70">炮位（尺寸 + 类型限制 + 视角 + 层级）：</span>
            <button className="comic-btn px-1.5 py-0.5 text-[10px] flex items-center gap-0.5" onClick={() => mutate(d => {
              const nid = `hp${d.hardpoints.length + 1}-${Date.now() % 1000}`
              d.hardpoints.push({ id: nid, x: Math.floor(d.w / 2) + 0.5, y: Math.floor(d.h / 2) + 0.5, size: 'S' })
              setHpSel(nid)
            })}><Plus className="w-3 h-3" />添加</button>
          </div>
          <div className="flex flex-col gap-1.5">
            {cur.hardpoints.map(hp => (
              <div key={hp.id} className={`border border-black/40 p-1 ${hpSel === hp.id ? 'bg-[#C9C29F]' : ''}`}>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <button className="comic-btn px-1 py-0 text-[10px]" onClick={() => { setHpSel(hp.id); setTool('hp') }}>{hp.id}</button>
                  <select value={hp.size} onChange={e => mutate(d => { d.hardpoints.find(h => h.id === hp.id)!.size = e.target.value as MountSize })} className="px-0.5 py-0 text-[10px] border border-black bg-[#EFEBD8]">
                    {(['S', 'M', 'L'] as const).map(sz => <option key={sz} value={sz}>{sz}型</option>)}
                  </select>
                  {hpCoord(hp)}
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
                  {numInput('层级', hp.zLevel ?? 1, v => mutate(d => { d.hardpoints.find(h => h.id === hp.id)!.zLevel = v === 1 ? undefined : v }), 1)}

                  {hp.fixed === undefined && hp.arc && <>
                    {numInput('起°', hp.arc.start, v => mutate(d => { d.hardpoints.find(h => h.id === hp.id)!.arc!.start = v }), 5)}
                    {numInput('止°', hp.arc.end, v => mutate(d => { d.hardpoints.find(h => h.id === hp.id)!.arc!.end = v }), 5)}
                  </>}
                  {hp.fixed !== undefined &&
                    numInput('角°', hp.fixed, v => mutate(d => { d.hardpoints.find(h => h.id === hp.id)!.fixed = Math.max(-180, Math.min(180, v)) }), 5)}
                  <label className="flex items-center gap-0.5 text-[10px] font-comic">
                    <input type="checkbox" checked={!!hp.hidden} onChange={e => mutate(d => { const h = d.hardpoints.find(x => x.id === hp.id)!; h.hidden = e.target.checked; if (!e.target.checked) h.builtIn = undefined })} />
                    隐藏内置
                  </label>
                  {hp.hidden && (
                    <select value={hp.builtIn ?? ''} onChange={e => mutate(d => { d.hardpoints.find(h => h.id === hp.id)!.builtIn = e.target.value || undefined })} className="px-0.5 py-0 text-[10px] border border-black bg-[#EFEBD8]">
                      <option value="">（无内置武器）</option>
                      {TURRET_DEFS.filter(t => t.mount === hp.size).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  )}
                  <button className="comic-btn px-1 py-0 text-[10px]" onClick={() => mutate(d => { d.hardpoints = d.hardpoints.filter(h => h.id !== hp.id) })}>删</button>
                </div>
                <div className="flex flex-wrap items-center gap-x-2 mt-0.5">
                  <span className="text-[9px] text-black/60">类型限制（勾=可装）：</span>
                  {ALL_WEAPON_TYPES.map(t => (
                    <label key={t} className="flex items-center gap-0.5 text-[10px] font-comic">
                      <input type="checkbox" checked={!hp.types || hp.types.includes(t)}
                        onChange={e => mutate(d => {
                          const h = d.hardpoints.find(x => x.id === hp.id)!
                          const set = new Set(h.types ?? ALL_WEAPON_TYPES)
                          if (e.target.checked) set.add(t); else set.delete(t)
                          h.types = set.size >= ALL_WEAPON_TYPES.length ? undefined : [...set]
                        })} />
                      {TYPE_NAME[t]}
                    </label>
                  ))}
                  {hp.types && hp.types.length === 0 && <span className="text-[9px] font-black text-[#B3392E]">全不勾=不支持任何炮塔</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 校验结果 */}
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
