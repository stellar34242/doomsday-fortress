import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { Check } from 'lucide-react'
import { MODULE_DEFS, PROJECTILE_ARTS, TURRET_DEFS, moduleAssemblyPoints, turretAmmoCapacity, turretAssemblyPoints } from '@/game/config'
import type { MountSize, TurretDef } from '@/game/config'
import { findAssetByName, getAsset, resolveAssetSrc } from '@/game/assetlib'
import { drawTurretPreviewCore } from '@/game/render'
import { isEquipmentUnlocked } from '@/game/level'
import type { LevelLibrary, LevelProgress } from '@/game/level'
import {
  createVehicleLoadout,
  firstLoadoutModulePlacement,
  loadVehicleLoadouts,
  saveVehicleLoadouts,
  setSelectedVehicleLoadoutId,
  vehicleLoadoutAssemblyPoints,
  vehicleLoadoutStats,
} from '@/game/loadout'
import type { VehicleLoadoutPreset, VehicleLoadoutStats } from '@/game/loadout'
import { VehiclePreview } from '@/components/MissionBriefing'
import { playableVehicleDefs } from '@/game/unit'

type EquipmentTab = 'turret' | 'module'

export interface BattleHardpointMarker {
  targetId: 'main' | number
  targetName: string
  hardpointId: string
  x: number
  y: number
  size: MountSize
  types?: TurretDef['type'][]
  locked: boolean
  installedTurretId?: string
}

const EMPTY_BATTLE_HARDPOINTS: BattleHardpointMarker[] = []

const MOUNT_NAME: Record<MountSize, string> = { S: '轻型', M: '中型', L: '重型' }

const STAT_ROWS: Array<{
  key: keyof VehicleLoadoutStats
  label: string
  format: (value: number) => string
}> = [
  { key: 'structure', label: '结构值', format: value => Math.round(value).toString() },
  { key: 'shield', label: '护盾值', format: value => Math.round(value).toString() },
  { key: 'armor', label: '四向装甲总值', format: value => Math.round(value).toString() },
  { key: 'speed', label: '最大速度', format: value => `${value.toFixed(1)} m/s` },
  { key: 'turnSpeed', label: '转向速度', format: value => `${value.toFixed(1)}°/s` },
  { key: 'firepower', label: '单轮火力', format: value => Math.round(value).toString() },
  { key: 'energyCap', label: '电量上限', format: value => Math.round(value).toString() },
  { key: 'ammoCap', label: '弹药上限', format: value => Math.round(value).toString() },
  { key: 'cooling', label: '散热能力', format: value => `${value.toFixed(1)}/s` },
]

function TurretMiniPreview({ def }: { def: TurretDef }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const iconAsset = def.iconAsset ? getAsset(def.iconAsset) : undefined
  const iconSrc = iconAsset?.category === 'icon' ? iconAsset.src : undefined
  useEffect(() => {
    if (iconSrc) return
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const paint = () => {
      const rect = canvas.getBoundingClientRect()
      const dpr = Math.max(1, window.devicePixelRatio || 1)
      canvas.width = Math.max(1, Math.round(rect.width * dpr))
      canvas.height = Math.max(1, Math.round(rect.height * dpr))
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, rect.width, rect.height)
      ctx.imageSmoothingEnabled = false
      const cell = Math.min(rect.width / Math.max(1, def.w), rect.height / Math.max(1, def.h)) * 0.72
      drawTurretPreviewCore(ctx, def, { x: (rect.width - def.w * cell) / 2, y: (rect.height - def.h * cell) / 2, cell }, { angleRad: 0 })
    }
    const observer = new ResizeObserver(paint)
    observer.observe(canvas)
    paint()
    return () => observer.disconnect()
  }, [def, iconSrc])
  return iconSrc
    ? <img src={iconSrc} alt={`${def.name}图标`} draggable={false} className="w-full h-full object-contain [image-rendering:pixelated]" />
    : <canvas ref={canvasRef} aria-label={`${def.name}预览`} className="w-full h-full [image-rendering:pixelated]" />
}

function ModuleMiniPreview({ asset, color, name }: { asset?: string; color: string; name: string }) {
  const src = resolveAssetSrc(asset)
  return src
    ? <img src={src} alt={`${name}预览`} className="w-full h-full object-contain [image-rendering:pixelated]" draggable={false} />
    : <span aria-label={`${name}颜色预览`} className="block w-8 h-8 border-2 border-black" style={{ backgroundColor: color }} />
}

function clonePreset(preset: VehicleLoadoutPreset): VehicleLoadoutPreset {
  return structuredClone(preset)
}

function preparationUiAsset(name: string): string | undefined {
  return findAssetByName(name, 'ui')?.src
}

function nineSliceStyle(src: string | undefined): CSSProperties | undefined {
  return src ? ({ '--combat-prep-window': `url("${src}")`, backgroundColor: 'transparent' } as CSSProperties) : undefined
}

export default function PreparationScreen({
  library,
  progress,
  selectedPresetId,
  lockedFortressDefId,
  combatPreset,
  combatVehicleDef,
  assemblyPointLimit,
  turretOnly = false,
  combatResourceBudget,
  combatResourceCost,
  battleHardpoints = EMPTY_BATTLE_HARDPOINTS,
  battleTargetId = 'main',
  battleOverlay = false,
  onApplyCombat,
  onSelectBattleTarget,
  onSelectPreset,
  onClose,
}: {
  library: LevelLibrary
  progress: LevelProgress
  selectedPresetId: string
  lockedFortressDefId?: string
  /** 传入后进入战斗整备模式：当前载具锁定、全部可见炮位可替换、应用时不改写出战预设。 */
  combatPreset?: VehicleLoadoutPreset
  /** 关卡玩家单位的载具平台可能不属于常规可出战车型库。 */
  combatVehicleDef?: import('@/game/config').FortressDef
  assemblyPointLimit?: number
  /** 次级玩家单位只开放炮塔，不允许编辑模块。 */
  turretOnly?: boolean
  /** 堡垒防御整备使用关卡资源，而不是装配分。 */
  combatResourceBudget?: number
  combatResourceCost?: (preset: VehicleLoadoutPreset) => number | null
  /** 战场内所有可整备玩家单位的炮位屏幕坐标。 */
  battleHardpoints?: BattleHardpointMarker[]
  battleTargetId?: 'main' | number
  /** 战斗内使用轻量浮动 HUD；任务介绍仍使用完整整备页面。 */
  battleOverlay?: boolean
  onApplyCombat?: (preset: VehicleLoadoutPreset, options?: { keepOpen?: boolean }) => void
  onSelectBattleTarget?: (targetId: 'main' | number) => void
  onSelectPreset: (presetId: string, fortressDefId: string) => void
  onClose: () => void
}) {
  const combatMode = !!combatPreset && !!onApplyCombat
  const pointLimited = combatMode && assemblyPointLimit !== undefined
  const [presets, setPresets] = useState(loadVehicleLoadouts)
  const initialPreset = combatPreset ?? presets.find(item => item.id === selectedPresetId) ?? presets[0]
  const [activeId, setActiveId] = useState(initialPreset?.id ?? '')
  const [draft, setDraft] = useState<VehicleLoadoutPreset | null>(() => initialPreset ? clonePreset(initialPreset) : null)
  const [tab, setTab] = useState<EquipmentTab>('turret')
  const [selectedHardpointId, setSelectedHardpointId] = useState<string | null>(null)
  const [selectedTurretId, setSelectedTurretId] = useState<string | null>(null)
  const [pendingNewId, setPendingNewId] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const savedPreset = combatMode ? combatPreset! : presets.find(item => item.id === activeId) ?? null
  const vehicles = playableVehicleDefs()
  const fortress = draft
    ? (combatVehicleDef?.id === draft.fortressDefId ? combatVehicleDef : vehicles.find(item => item.id === draft.fortressDefId) ?? null)
    : null
  const savedStats = useMemo(() => {
    const referencePreset = savedPreset ?? (draft ? { ...draft, turrets: [], modules: [] } : null)
    return referencePreset ? vehicleLoadoutStats(referencePreset, { includeBuiltInTurrets: !combatMode, vehicleDef: combatVehicleDef }) : null
  }, [combatMode, combatVehicleDef, draft, savedPreset])
  const currentStats = useMemo(() => draft ? vehicleLoadoutStats(draft, { includeBuiltInTurrets: !combatMode, vehicleDef: combatVehicleDef }) : null, [combatMode, combatVehicleDef, draft])
  const unlockedFortresses = useMemo(() => combatVehicleDef
    ? [combatVehicleDef]
    : playableVehicleDefs().filter(def => isEquipmentUnlocked(progress, { kind: 'fortress', id: def.id }, library)), [combatVehicleDef, library, progress])
  const unlockedTurrets = useMemo(() => TURRET_DEFS.filter(def => isEquipmentUnlocked(progress, { kind: 'turret', id: def.id }, library)), [library, progress])
  const unlockedModules = useMemo(() => MODULE_DEFS.filter(def => isEquipmentUnlocked(progress, { kind: 'module', id: def.id }, library)), [library, progress])
  const dirty = !!draft && (pendingNewId === draft.id || (!!savedPreset && JSON.stringify(draft) !== JSON.stringify(savedPreset)))
  const usedAssemblyPoints = useMemo(() => draft ? vehicleLoadoutAssemblyPoints(draft) : 0, [draft])
  const pointLimit = Math.max(0, Math.round(assemblyPointLimit ?? Number.MAX_SAFE_INTEGER))
  const resourceCost = useMemo(() => draft && combatResourceCost ? combatResourceCost(draft) : 0, [combatResourceCost, draft])
  const resourceAffordable = resourceCost !== null && (combatResourceBudget === undefined || Math.max(0, resourceCost) <= combatResourceBudget)

  useEffect(() => {
    if (!battleOverlay) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [battleOverlay, onClose])

  const compatibleHardpoints = (turret: TurretDef) => fortress?.hardpoints.filter(hardpoint => !hardpoint.lockedTurret && (combatMode || !hardpoint.builtIn)
    && hardpoint.size === turret.mount && (!hardpoint.types || hardpoint.types.includes(turret.type))) ?? []

  const targetHardpointFor = (turret: TurretDef) => {
    if (!draft) return null
    const compatible = compatibleHardpoints(turret)
    return compatible.find(item => item.id === selectedHardpointId)
      ?? compatible.find(item => !draft.turrets.some(installed => installed.hardpointId === item.id))
      ?? compatible[0]
      ?? null
  }

  const turretProjectedPoints = (turret: TurretDef) => {
    if (!draft) return Number.POSITIVE_INFINITY
    const target = targetHardpointFor(turret)
    if (!target) return Number.POSITIVE_INFINITY
    const installedId = draft.turrets.find(item => item.hardpointId === target.id)?.turretDefId
    const installed = TURRET_DEFS.find(item => item.id === installedId)
    return usedAssemblyPoints - (installed ? turretAssemblyPoints(installed) : 0) + turretAssemblyPoints(turret)
  }

  const commitCombatDraft = (next: VehicleLoadoutPreset, successMessage: string): boolean => {
    if (!combatMode || !onApplyCombat) return false
    const nextPoints = vehicleLoadoutAssemblyPoints(next)
    if (pointLimited && nextPoints > pointLimit) {
      setMessage(`装配分不足：本场上限 ${pointLimit}。`)
      return false
    }
    const nextCost = combatResourceCost ? combatResourceCost(next) : 0
    if (nextCost === null) {
      setMessage('当前整备方案无效。')
      return false
    }
    if (combatResourceBudget !== undefined && nextCost > combatResourceBudget) {
      setMessage(`资源不足：还需要 ${Math.ceil(nextCost - combatResourceBudget)}。`)
      return false
    }
    setDraft(clonePreset(next))
    setMessage(successMessage)
    onApplyCombat(clonePreset(next), { keepOpen: true })
    return true
  }

  const installTurretAt = (turret: TurretDef, hardpointId: string) => {
    if (!draft || !fortress) return
    const hardpoint = fortress.hardpoints.find(item => item.id === hardpointId)
    if (!hardpoint || hardpoint.lockedTurret || hardpoint.size !== turret.mount || (hardpoint.types && !hardpoint.types.includes(turret.type))) {
      setMessage('该炮塔与这个炮位不兼容。')
      return
    }
    const next: VehicleLoadoutPreset = {
      ...clonePreset(draft),
      turrets: [...draft.turrets.filter(item => item.hardpointId !== hardpointId), { hardpointId, turretDefId: turret.id }],
    }
    if (commitCombatDraft(next, `${turret.name}已安装到 ${hardpointId}。`)) {
      setSelectedHardpointId(hardpointId)
      setSelectedTurretId(null)
    }
  }

  const switchPreset = (id: string) => {
    if (combatMode) return
    const next = presets.find(item => item.id === id)
    if (!next) return
    setActiveId(id)
    setDraft(clonePreset(next))
    setSelectedHardpointId(null)
    setMessage('')
  }

  const switchVehicle = (fortressDefId: string) => {
    if (combatMode) return
    if (lockedFortressDefId && fortressDefId !== lockedFortressDefId) return
    const next = presets.find(item => item.fortressDefId === fortressDefId)
    if (next) switchPreset(next.id)
  }

  const newPreset = () => {
    if (combatMode) return
    if (!fortress) return
    const retainedPresets = pendingNewId ? presets.filter(item => item.id !== pendingNewId) : presets
    const created = createVehicleLoadout(fortress.id, retainedPresets)
    if (!created) return
    setPresets([...retainedPresets, created])
    setActiveId(created.id)
    setDraft(clonePreset(created))
    setPendingNewId(created.id)
    setSelectedHardpointId(null)
    setMessage('新预设尚未保存。')
  }

  const deletePreset = () => {
    if (combatMode) return
    if (!savedPreset) return
    if (pendingNewId === savedPreset.id) {
      const nextPresets = presets.filter(item => item.id !== savedPreset.id)
      const next = nextPresets.find(item => item.fortressDefId === savedPreset.fortressDefId) ?? nextPresets[0]
      setPresets(nextPresets)
      setPendingNewId(null)
      if (next) { setActiveId(next.id); setDraft(clonePreset(next)) }
      setMessage('未保存的新预设已删除。')
      return
    }
    const sameVehicle = presets.filter(item => item.fortressDefId === savedPreset.fortressDefId)
    if (sameVehicle.length <= 1) { setMessage('每种载具至少保留一个预设。'); return }
    const nextPresets = presets.filter(item => item.id !== savedPreset.id)
    const next = nextPresets[0]
    setPresets(nextPresets)
    saveVehicleLoadouts(nextPresets)
    setPendingNewId(null)
    if (next) {
      setActiveId(next.id)
      setDraft(clonePreset(next))
      onSelectPreset(next.id, next.fortressDefId)
    }
    setMessage('预设已删除。')
  }

  const installTurret = (turret: TurretDef) => {
    if (!draft || !fortress) return
    if (!isEquipmentUnlocked(progress, { kind: 'turret', id: turret.id }, library)) return
    const target = targetHardpointFor(turret)
    if (!target) { setMessage('当前载具没有兼容炮位。'); return }
    if (pointLimited && turretProjectedPoints(turret) > pointLimit) { setMessage(`装配分不足：本场上限 ${pointLimit}。`); return }
    setDraft(current => current ? {
      ...current,
      turrets: [...current.turrets.filter(item => item.hardpointId !== target.id), { hardpointId: target.id, turretDefId: turret.id }],
    } : current)
    setSelectedHardpointId(target.id)
    setMessage(`${turret.name}已装入 ${target.id}${combatMode ? '，应用后生效。' : '，保存后生效。'}`)
  }

  const removeTurret = (hardpointId: string) => {
    if (fortress?.hardpoints.find(item => item.id === hardpointId)?.lockedTurret) { setMessage('该炮位的预装炮塔已锁定。'); return }
    if (battleOverlay && combatMode && draft) {
      const next = { ...clonePreset(draft), turrets: draft.turrets.filter(item => item.hardpointId !== hardpointId) }
      if (!commitCombatDraft(next, '炮塔已卸下，返还其装配资源的 50%。')) return
      setSelectedHardpointId(hardpointId)
      return
    } else {
      setDraft(current => current ? { ...current, turrets: current.turrets.filter(item => item.hardpointId !== hardpointId) } : current)
    }
    setSelectedHardpointId(hardpointId)
    setMessage(`炮位已清空，${combatMode ? '应用' : '保存'}后生效。`)
  }

  const installModule = (defId: string) => {
    if (turretOnly) return
    if (!draft || !fortress) return
    if (!isEquipmentUnlocked(progress, { kind: 'module', id: defId }, library)) return
    const placement = firstLoadoutModulePlacement(fortress, draft.modules, defId)
    if (!placement) { setMessage('内部空间不足或已达到装配上限。'); return }
    const moduleDef = MODULE_DEFS.find(item => item.id === defId)
    if (pointLimited && moduleDef && usedAssemblyPoints + moduleAssemblyPoints(moduleDef) > pointLimit) { setMessage(`装配分不足：本场上限 ${pointLimit}。`); return }
    if (battleOverlay && combatMode) {
      const next = { ...clonePreset(draft), modules: [...draft.modules, placement] }
      commitCombatDraft(next, '模块已装入当前主控单位。')
    } else {
      setDraft(current => current ? { ...current, modules: [...current.modules, placement] } : current)
      setMessage(`模块已自动放入可用位置，${combatMode ? '应用' : '保存'}后生效。`)
    }
  }

  const removeModule = (index: number) => {
    if (battleOverlay && combatMode && draft) {
      const next = { ...clonePreset(draft), modules: draft.modules.filter((_, itemIndex) => itemIndex !== index) }
      commitCombatDraft(next, '模块已卸下，返还其装配资源的 50%。')
    } else {
      setDraft(current => current ? { ...current, modules: current.modules.filter((_, itemIndex) => itemIndex !== index) } : current)
      setMessage(`模块已卸下，${combatMode ? '应用' : '保存'}后生效。`)
    }
  }

  const savePreset = () => {
    if (combatMode) return
    if (!draft) return
    const nextPresets = presets.some(item => item.id === draft.id)
      ? presets.map(item => item.id === draft.id ? clonePreset(draft) : item)
      : [...presets, clonePreset(draft)]
    if (!saveVehicleLoadouts(nextPresets)) { setMessage('预设保存失败，请检查浏览器存储权限。'); return }
    setPresets(nextPresets)
    setPendingNewId(null)
    setSelectedVehicleLoadoutId(draft.id)
    onSelectPreset(draft.id, draft.fortressDefId)
    setMessage('预设已保存并设为当前出战方案。')
  }

  const applyCombatPreset = () => {
    if (!combatMode || !draft || !onApplyCombat) return
    if (pointLimited && usedAssemblyPoints > pointLimit) { setMessage(`当前装配分 ${usedAssemblyPoints} 超过本场上限 ${pointLimit}。`); return }
    if (!resourceAffordable) { setMessage(resourceCost === null ? '当前整备方案无效。' : `资源不足：需要 ${Math.max(0, resourceCost)}。`); return }
    onApplyCombat(clonePreset(draft))
  }

  if (!draft || !fortress || !currentStats || !savedStats) return null
  const turretAssignments = Object.fromEntries(draft.turrets.map(item => [item.hardpointId, item.turretDefId]))
  const vehiclePresets = presets.filter(item => item.fortressDefId === fortress.id)

  if (battleOverlay && combatMode) {
    const windowAsset = preparationUiAsset('bg_window01')
    const rowAsset = preparationUiAsset('banner_weapon')
    const rowSelectedAsset = preparationUiAsset('banner_weapon_sel')
    const selectionArrowAsset = preparationUiAsset('arrow_sel')
    const resourceAsset = preparationUiAsset('sign_res')
    const slotAsset = preparationUiAsset('slot_weapon')
    const slotLockAsset = preparationUiAsset('slot_weapon_lock')
    const slotSetupAsset = preparationUiAsset('slot_weapon_setup')
    const slotSetupArrowAsset = preparationUiAsset('slot_weapon_setup_arrow')
    const slotReplaceAsset = preparationUiAsset('slot_weapon_replace')
    const slotReplaceArrowAsset = preparationUiAsset('slot_weapon_replace_arrow')
    const slotIgnoreAsset = preparationUiAsset('slot_weapon_ingore')
    const selectedTurret = TURRET_DEFS.find(item => item.id === selectedTurretId)
    const selectedHardpoint = fortress.hardpoints.find(item => item.id === selectedHardpointId)
    const selectedInstalledId = draft.turrets.find(item => item.hardpointId === selectedHardpointId)?.turretDefId
    const selectedInstalledTurret = TURRET_DEFS.find(item => item.id === selectedInstalledId)
    const propertyTurret = selectedTurret ?? selectedInstalledTurret
    const propertyProjectile = PROJECTILE_ARTS.find(item => item.id === propertyTurret?.art?.projectile)
    const propertyDamage = propertyTurret ? (propertyProjectile?.damage ?? propertyTurret.damage) : 0
    const propertyAmmo = propertyTurret ? turretAmmoCapacity(propertyTurret) : 0
    const activeMarkers = battleHardpoints.filter(marker => marker.targetId === battleTargetId)
    const matchingMarkers = (turret: TurretDef) => activeMarkers.filter(marker => !marker.locked && marker.size === turret.mount && (!marker.types || marker.types.includes(turret.type)))
    const projectedMarkerCost = (turret: TurretDef, marker: BattleHardpointMarker) => {
      const installed = TURRET_DEFS.find(item => item.id === marker.installedTurretId)
      if (installed?.id === turret.id) return 0
      return turret.cost - (installed ? Math.floor(installed.cost / 2) : 0)
    }

    return (
      <div data-layout="battle-floating-hud" className="combat-preparation-hud font-comic select-none">
        <div className="combat-preparation-hud__shade" />

        {battleHardpoints.map(marker => {
          const isCurrentTarget = marker.targetId === battleTargetId
          const compatible = !!selectedTurret && isCurrentTarget && !marker.locked && marker.size === selectedTurret.mount && (!marker.types || marker.types.includes(selectedTurret.type))
          const occupied = !!marker.installedTurretId
          const state = marker.locked ? 'locked' : selectedTurret
            ? compatible ? (occupied ? 'replace' : 'setup') : 'ignore'
            : 'default'
          const baseSrc = state === 'locked' ? slotLockAsset : state === 'setup' ? slotSetupAsset : state === 'replace' ? slotReplaceAsset : state === 'ignore' ? slotIgnoreAsset : slotAsset
          const arrowSrc = state === 'setup' ? slotSetupArrowAsset : state === 'replace' ? slotReplaceArrowAsset : undefined
          const installed = TURRET_DEFS.find(item => item.id === marker.installedTurretId)
          const delta = selectedTurret && compatible ? projectedMarkerCost(selectedTurret, marker) : null
          const markerSelected = isCurrentTarget && marker.hardpointId === selectedHardpointId
          return <button
            key={`${marker.targetId}-${marker.hardpointId}`}
            type="button"
            aria-label={`${marker.targetName} ${marker.hardpointId} ${marker.size}型炮位${marker.locked ? ' 已锁定' : ''}`}
            aria-pressed={markerSelected}
            title={!isCurrentTarget ? `切换到${marker.targetName}` : marker.locked ? '该炮位已锁定' : compatible && selectedTurret ? `安装${selectedTurret.name}` : installed?.name ?? '空炮位'}
            onClick={() => {
              if (!isCurrentTarget) { onSelectBattleTarget?.(marker.targetId); return }
              if (selectedTurret) installTurretAt(selectedTurret, marker.hardpointId)
              else { setSelectedHardpointId(marker.hardpointId); setTab('turret') }
            }}
            className={`combat-preparation-slot is-${state} ${markerSelected ? 'is-selected' : ''}`}
            style={{ left: marker.x, top: marker.y }}
          >
            {baseSrc ? <img src={baseSrc} alt="" draggable={false} className="combat-preparation-slot__base" /> : <span className="combat-preparation-slot__fallback" />}
            {arrowSrc ? <img src={arrowSrc} alt="" draggable={false} className="combat-preparation-slot__arrow" /> : null}
            {!marker.locked ? <strong>{marker.size}</strong> : null}
            {delta !== null ? <span className={`combat-preparation-slot__delta ${delta <= 0 ? 'is-refund' : ''}`}>
              {delta > 0 ? `-${delta}` : delta < 0 ? `+${Math.abs(delta)}` : '0'}
              {resourceAsset ? <img src={resourceAsset} alt="" draggable={false} className="combat-preparation-resource-icon" /> : null}
            </span> : null}
          </button>
        })}

        {propertyTurret ? <section aria-label="武器属性" className="combat-preparation-hud__properties combat-preparation-window" style={nineSliceStyle(windowAsset)}>
          <header>{propertyTurret.name}</header>
          <dl>
            <div><dt>尺寸</dt><dd>{propertyTurret.mount}</dd></div>
            <div><dt>射程</dt><dd>{Math.round(propertyTurret.rangeMin)}-{Math.round(propertyTurret.rangeMax)}m</dd></div>
            <div><dt>装填</dt><dd>{propertyTurret.fireRate.toFixed(1)}s</dd></div>
            <div><dt>弹药类型</dt><dd>{propertyProjectile?.name ?? '无'}</dd></div>
            <div><dt>伤害</dt><dd>{propertyTurret.burst && propertyTurret.burst > 1 ? `${Math.round(propertyDamage)}×${propertyTurret.burst}` : Math.round(propertyDamage)}</dd></div>
            <div><dt>弹药量</dt><dd>{propertyAmmo > 0 ? propertyAmmo : '∞'}</dd></div>
          </dl>
          {!selectedTurret && selectedHardpoint && selectedInstalledTurret ? <button type="button" disabled={selectedHardpoint.lockedTurret} onClick={() => removeTurret(selectedHardpoint.id)} className="combat-preparation-hud__remove">{selectedHardpoint.lockedTurret ? '炮塔已锁定' : '卸下炮塔'}</button> : null}
        </section> : null}

        <section role="dialog" aria-modal="true" aria-label="战斗整备" className="combat-preparation-hud__weapons combat-preparation-window" style={nineSliceStyle(windowAsset)}>
          <header className="combat-preparation-hud__weapons-title">
            <h2>武器列表</h2>
            <button type="button" data-audio-cue="uiCancel" aria-label="关闭战车整备" title="关闭（Esc）" onClick={onClose}>×</button>
          </header>

          <div className="combat-preparation-hud__weapon-list">
            {tab === 'turret' ? unlockedTurrets.map(def => {
              const selected = def.id === selectedTurretId
              const matches = matchingMarkers(def)
              const hasMatch = matches.length > 0
              const lowestCost = hasMatch ? Math.min(...matches.map(marker => projectedMarkerCost(def, marker))) : def.cost
              const affordable = combatResourceBudget === undefined || lowestCost <= combatResourceBudget
              return <button
                key={def.id}
                type="button"
                aria-pressed={selected}
                onClick={() => { setSelectedTurretId(selected ? null : def.id); setSelectedHardpointId(null); setMessage(selected ? '已取消选择。' : `请选择一个 ${def.mount} 型炮位安装${def.name}。`) }}
                className="combat-preparation-weapon-row"
              >
                {rowAsset ? <img src={rowAsset} alt="" draggable={false} className="combat-preparation-weapon-row__background" /> : null}
                {selected && rowSelectedAsset ? <img src={rowSelectedAsset} alt="" draggable={false} className="combat-preparation-weapon-row__selected" /> : null}
                {selected && selectionArrowAsset ? <img src={selectionArrowAsset} alt="" draggable={false} className="combat-preparation-weapon-row__arrow" /> : null}
                <span className="combat-preparation-weapon-row__icon"><TurretMiniPreview def={def} /></span>
                <strong className={selected ? 'is-selected' : ''}>{def.name}</strong>
                <span className={!hasMatch ? 'is-incompatible' : ''}>{def.mount}</span>
                <span className={!affordable ? 'is-unaffordable' : ''}>{def.cost}{resourceAsset ? <img src={resourceAsset} alt="" draggable={false} className="combat-preparation-resource-icon" /> : null}</span>
              </button>
            }) : unlockedModules.map(def => {
              const placeable = !!firstLoadoutModulePlacement(fortress, draft.modules, def.id)
              const affordable = combatResourceBudget === undefined || def.cost <= combatResourceBudget
              return <button key={def.id} type="button" disabled={!placeable || !affordable} onClick={() => installModule(def.id)} className="combat-preparation-weapon-row">
                {rowAsset ? <img src={rowAsset} alt="" draggable={false} className="combat-preparation-weapon-row__background" /> : null}
                <span className="combat-preparation-weapon-row__icon"><ModuleMiniPreview asset={def.asset} color={def.color} name={def.name} /></span>
                <strong>{def.name}</strong>
                <span>{def.w}×{def.h}</span>
                <span className={!affordable ? 'is-unaffordable' : ''}>{def.cost}{resourceAsset ? <img src={resourceAsset} alt="" draggable={false} className="combat-preparation-resource-icon" /> : null}</span>
              </button>
            })}
          </div>

          <span role="status" aria-live="polite" className="sr-only">{message}</span>
        </section>
      </div>
    )
  }

  return (
    <div data-layout={battleOverlay ? 'battle-floating-hud' : 'full-preparation'} className={battleOverlay
      ? 'absolute z-[145] right-2 top-12 bottom-[4.75rem] w-[min(900px,calc(100%-16px))] max-h-[720px] font-comic select-none overflow-hidden drop-shadow-[5px_6px_0_rgba(0,0,0,0.72)]'
      : 'absolute inset-0 z-[145] bg-[#CFC7A8] p-1.5 sm:p-2 font-comic select-none overflow-hidden'}>
      <div className={`h-full border-[3px] border-black flex flex-col ${battleOverlay ? 'bg-[#CFC7A8]/[0.97] backdrop-blur-[1px]' : 'bg-[#CFC7A8]'}`}>
        <header className={`${battleOverlay ? 'h-10' : 'h-12'} px-3 border-b-2 border-black flex items-center gap-3 bg-[#CFC7A8]`}>
          <h1 className={`${battleOverlay ? 'text-[18px]' : 'text-[22px] sm:text-[28px]'} font-black leading-none`}>战车整备</h1>
          {battleOverlay && combatMode ? <span className="border border-black bg-[#8A887A]/45 px-1.5 py-0.5 text-[8px] font-black">{combatResourceCost ? '堡垒防御' : '标准战斗'}</span> : null}
          {pointLimited ? <span className={`border-2 border-black px-2 py-1 text-[10px] font-black ${usedAssemblyPoints > pointLimit ? 'bg-[#B3392E] text-[#EFEBD8]' : 'bg-[#D9A441]'}`}>装配分 {usedAssemblyPoints} / {pointLimit}</span> : null}
          {combatMode && combatResourceCost ? <span className={`border-2 border-black px-2 py-1 text-[10px] font-black ${resourceAffordable ? 'bg-[#D9A441]' : 'bg-[#B3392E] text-[#EFEBD8]'}`}>资源 {Math.max(0, resourceCost ?? 0)} / {Math.max(0, combatResourceBudget ?? 0)}</span> : null}
          {message ? <span role="status" className="ml-auto text-[9px] sm:text-[11px] font-black text-[#7A2E2A] truncate">{message}</span> : null}
        </header>

        <main className={`flex-1 min-h-0 grid ${battleOverlay && combatMode ? 'grid-cols-[32%_34%_34%]' : 'grid-cols-[17%_30%_29%_24%]'} portrait:grid-cols-1 portrait:overflow-y-auto portrait:auto-rows-[minmax(230px,auto)]`}>
          {!(battleOverlay && combatMode) ? <section className="min-h-0 border-r-2 border-black flex flex-col">
            <h2 className="px-2 py-1 border-b-2 border-black text-[12px] font-black">{combatMode ? '当前出战车型' : '已解锁车型'}</h2>
            <div className="flex-1 min-h-0 overflow-y-auto">
              {unlockedFortresses.map(def => {
                const active = def.id === fortress.id
                const contextLocked = combatMode || (!!lockedFortressDefId && def.id !== lockedFortressDefId)
                const presetCount = presets.filter(item => item.fortressDefId === def.id).length
                return <button key={def.id} type="button" aria-pressed={active} disabled={contextLocked} title={contextLocked ? '本场战斗已锁定当前车型' : undefined} onClick={() => switchVehicle(def.id)} className={`w-full min-h-12 px-2 py-1 border-b border-black/35 text-left disabled:cursor-not-allowed ${active ? 'bg-[#A94138] text-[#F2EDD9]' : contextLocked ? 'bg-[#AAA68F] text-black/45' : 'hover:bg-[#D9A441]/25'}`}>
                  <span className="block text-[11px] font-black truncate">{def.name}</span>
                  <span className="block text-[8px] font-bold opacity-65 truncate">{presetCount} 个出战方案{contextLocked ? ' · 当前不可切换' : ''}</span>
                </button>
              })}
            </div>
            {lockedFortressDefId || combatMode ? <div className="px-2 py-1 border-t border-black/35 text-[8px] font-black text-[#7A2E2A]">{combatMode ? '战斗整备：仅调整当前战车装备' : '关卡整备：车型已锁定'}</div> : null}
            {!combatMode ? <div className="p-2 border-t-2 border-black grid grid-cols-2 gap-2">
              <button type="button" onClick={newPreset} className="comic-btn px-1 py-1 text-[9px] font-black">新建预设</button>
              <button type="button" onClick={deletePreset} className="comic-btn px-1 py-1 text-[9px] font-black">删除</button>
            </div> : null}
          </section> : null}

          <div className="min-h-0 border-r-2 border-black grid grid-rows-[minmax(0,72%)_minmax(0,28%)]">
            <section className="min-h-0 border-b-2 border-black flex flex-col">
              <div className="h-9 px-2 border-b border-black/35 grid grid-cols-2 gap-2 items-center text-[9px] font-black">
                {combatMode ? <span className="min-w-0 truncate">本场战车：{fortress.name}</span> : <label className="min-w-0 flex items-center gap-1">方案<select aria-label="当前车型出战方案" value={activeId} onChange={event => switchPreset(event.target.value)} className="min-w-0 flex-1 h-6 px-1 border-2 border-black bg-[#EFEBD8] text-[9px]">{vehiclePresets.map(preset => <option key={preset.id} value={preset.id}>{preset.name}</option>)}</select></label>}
                {combatMode ? <span className={`text-right ${(pointLimited && usedAssemblyPoints > pointLimit) || !resourceAffordable ? 'text-[#B3392E]' : 'text-black/60'}`}>{turretOnly ? '仅可调整炮塔' : pointLimited ? `炮塔与模块合计 ${usedAssemblyPoints} 分` : '主控单位模块效果共享'}</span> : <label className="min-w-0 flex items-center gap-1">名称<input aria-label="预设名称" value={draft.name} onChange={event => setDraft(current => current ? { ...current, name: event.target.value.slice(0, 32) } : current)} className="min-w-0 flex-1 h-6 px-1 border-2 border-black bg-[#EFEBD8] text-[9px]" /></label>}
              </div>
              <div className="flex-1 min-h-0 bg-[linear-gradient(#00000012_1px,transparent_1px),linear-gradient(90deg,#00000012_1px,transparent_1px)] bg-[size:32px_32px]">
                <VehiclePreview def={fortress} turretAssignments={turretAssignments} showHardpoints replaceBuiltInTurrets={combatMode} />
              </div>
            </section>
            <section className="min-h-0 overflow-y-auto">
              <h2 className="px-2 py-1 border-b-2 border-black text-[12px] font-black text-center">当前参数</h2>
              <div className="grid grid-cols-2 gap-x-3 px-2 py-1">
                {STAT_ROWS.map(row => {
                  const value = currentStats[row.key]
                  const delta = value - savedStats[row.key]
                  const changed = Math.abs(delta) > 0.0001
                  return <div key={row.key} className="min-w-0 flex items-baseline justify-between gap-1 border-b border-black/25 py-0.5 text-[8px] sm:text-[9px]"><span className="font-black truncate">{row.label}</span><span className="font-black whitespace-nowrap">{row.format(value)}{changed ? <em className={`not-italic ml-1 ${delta > 0 ? 'text-[#287A39]' : 'text-[#B3392E]'}`}>({delta > 0 ? '+' : ''}{row.format(delta)})</em> : null}</span></div>
                })}
              </div>
            </section>
          </div>

          <div className="min-h-0 border-r-2 border-black grid grid-rows-2">
            <section className="min-h-0 border-b-2 border-black flex flex-col">
              <h2 className="px-2 py-1 border-b-2 border-black text-[12px] font-black">炮塔位</h2>
              <div className="flex-1 min-h-0 overflow-y-auto">
                {fortress.hardpoints.map(hardpoint => {
                  const assignedId = draft.turrets.find(item => item.hardpointId === hardpoint.id)?.turretDefId
                  const installedId = combatMode ? assignedId : hardpoint.builtIn ?? assignedId
                  const installed = TURRET_DEFS.find(item => item.id === installedId)
                  const selected = selectedHardpointId === hardpoint.id
                  const locked = hardpoint.lockedTurret === true
                  return <div key={hardpoint.id} className={`grid grid-cols-[54px_1fr_42px_42px] items-center gap-1 px-1 py-1 border-b border-black/30 ${selected ? 'bg-[#D9A441]/30' : ''}`}>
                    <button type="button" onClick={() => { setSelectedHardpointId(hardpoint.id); setTab('turret') }} className="h-6 border border-black bg-[#D9A441] text-[8px] font-black">{hardpoint.id}</button>
                    <span className="min-w-0 text-[8px] font-black truncate">{installed?.name ?? `${MOUNT_NAME[hardpoint.size]}空位`}{locked ? ' · 锁定' : installed ? ` · ${turretAssemblyPoints(installed)}分` : ''}</span>
                    <button type="button" disabled={locked} onClick={() => { setSelectedHardpointId(hardpoint.id); setTab('turret') }} className="comic-btn h-6 text-[8px] font-black disabled:opacity-35">更换</button>
                    <button type="button" disabled={locked || (!combatMode && !!hardpoint.builtIn) || !installed} onClick={() => removeTurret(hardpoint.id)} className="comic-btn h-6 text-[8px] font-black disabled:opacity-35">卸下</button>
                  </div>
                })}
              </div>
            </section>

            <section className="min-h-0 flex flex-col">
              <h2 className="px-2 py-1 border-b-2 border-black text-[12px] font-black">模块位</h2>
              <div className="flex-1 min-h-0 overflow-y-auto">
                {turretOnly ? <div className="h-full flex items-center justify-center px-3 text-center text-[9px] font-black text-black/45">该玩家单位共享主控单位模块，不开放独立模块装配。</div> : draft.modules.length === 0 ? <div className="h-full flex items-center justify-center text-[9px] font-black text-black/45">尚未安装模块</div> : draft.modules.map((module, index) => {
                  const def = MODULE_DEFS.find(item => item.id === module.defId)
                  return <div key={`${module.defId}-${module.x}-${module.y}-${index}`} className="grid grid-cols-[54px_1fr_42px] items-center gap-1 px-1 py-1 border-b border-black/30">
                    <span className="h-6 border border-black bg-[#D9A441] flex items-center justify-center text-[8px] font-black">{module.x},{module.y}</span>
                    <span className="min-w-0 text-[8px] font-black truncate">{def?.name ?? module.defId}{def ? ` · ${moduleAssemblyPoints(def)}分` : ''}</span>
                    <button type="button" onClick={() => removeModule(index)} className="comic-btn h-6 text-[8px] font-black">卸下</button>
                  </div>
                })}
              </div>
            </section>
          </div>

          <section className="min-h-0 flex flex-col">
            <h2 className="px-2 py-1 border-b-2 border-black text-[12px] font-black">装备仓库</h2>
            <div className="grid grid-cols-2 border-b-2 border-black">
              <button type="button" aria-pressed={tab === 'turret'} onClick={() => setTab('turret')} className={`h-9 border-r border-black text-[10px] font-black ${tab === 'turret' ? 'bg-[#A94138] text-[#F2EDD9]' : 'bg-[#8A887A] text-black/60'}`}>炮塔</button>
              <button type="button" disabled={turretOnly} aria-pressed={tab === 'module'} onClick={() => setTab('module')} className={`h-9 text-[10px] font-black disabled:opacity-35 ${tab === 'module' ? 'bg-[#A94138] text-[#F2EDD9]' : 'bg-[#8A887A] text-black/60'}`}>模块</button>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto p-1.5 grid grid-cols-2 xl:grid-cols-3 auto-rows-[112px] gap-1.5 content-start">
              {tab === 'turret' ? unlockedTurrets.map(def => {
                const installed = (!combatMode && !!fortress.hardpoints.find(item => item.builtIn === def.id)) || draft.turrets.some(item => item.turretDefId === def.id)
                const target = fortress.hardpoints.find(item => item.id === selectedHardpointId)
                const compatible = target
                  ? !target.lockedTurret && (combatMode || !target.builtIn) && target.size === def.mount && (!target.types || target.types.includes(def.type))
                  : !!targetHardpointFor(def)
                const withinPoints = !pointLimited || turretProjectedPoints(def) <= pointLimit
                return <button key={def.id} type="button" disabled={!compatible || !withinPoints} onClick={() => installTurret(def)} className={`relative border-2 border-black p-1 flex flex-col items-center bg-[#D8CFB8] disabled:bg-[#9C998B] disabled:text-black/45 ${installed ? 'outline outline-2 outline-[#287A39] outline-offset-[-4px]' : ''}`}>
                  {installed ? <Check className="absolute right-1 top-1 w-4 h-4 text-[#287A39]" strokeWidth={3} /> : null}
                  <div className="w-full flex-1 min-h-0"><TurretMiniPreview def={def} /></div>
                  <span className="w-full truncate text-[8px] font-black">{def.name}</span>
                  <span className={`text-[8px] font-black ${installed ? 'text-[#287A39]' : ''}`}>{turretAssemblyPoints(def)}分 · {!compatible ? '炮位不兼容' : !withinPoints ? '装配分不足' : installed ? '已安装' : '可用'}</span>
                </button>
              }) : turretOnly ? null : unlockedModules.map(def => {
                const installed = draft.modules.some(item => item.defId === def.id)
                const placeable = !!firstLoadoutModulePlacement(fortress, draft.modules, def.id)
                const withinPoints = !pointLimited || usedAssemblyPoints + moduleAssemblyPoints(def) <= pointLimit
                return <button key={def.id} type="button" disabled={!placeable || !withinPoints} onClick={() => installModule(def.id)} className={`relative border-2 border-black p-1 flex flex-col items-center bg-[#D8CFB8] disabled:bg-[#9C998B] disabled:text-black/45 ${installed ? 'outline outline-2 outline-[#287A39] outline-offset-[-4px]' : ''}`}>
                  {installed ? <Check className="absolute right-1 top-1 w-4 h-4 text-[#287A39]" strokeWidth={3} /> : null}
                  <div className="w-full flex-1 min-h-0 flex items-center justify-center"><ModuleMiniPreview asset={def.asset} color={def.color} name={def.name} /></div>
                  <span className="w-full truncate text-[8px] font-black">{def.name}</span>
                  <span className={`text-[8px] font-black ${installed ? 'text-[#287A39]' : ''}`}>{moduleAssemblyPoints(def)}分 · {!placeable ? '无可用空间' : !withinPoints ? '装配分不足' : installed ? '已安装' : '可用'}</span>
                </button>
              })}
            </div>
            <div className="p-2 border-t-2 border-black grid grid-cols-2 gap-3">
              <button type="button" data-audio-cue="uiConfirm" disabled={!dirty || (pointLimited && usedAssemblyPoints > pointLimit) || !resourceAffordable} onClick={combatMode ? applyCombatPreset : savePreset} className="comic-btn min-h-10 text-[11px] font-black disabled:opacity-45">{combatMode ? '应用整备' : '保存预设'}</button>
              <button type="button" data-audio-cue="uiCancel" onClick={onClose} className="comic-btn min-h-10 text-[11px] font-black">返回</button>
            </div>
          </section>
        </main>
      </div>
    </div>
  )
}
