import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Lock } from 'lucide-react'
import { BASE_CELL, TURRET_DEFS, hardpointBelowVehicleBody } from '@/game/config'
import type { FortressDef, Hardpoint } from '@/game/config'
import { resolveAssetSrc } from '@/game/assetlib'
import { centeredTrackPlacements, fortressLocalCenter, wheelFrameCount, wheelPlacements } from '@/game/engine'
import { tintedFx } from '@/game/fxDraw'
import { drawTurretPreviewCore, WALKER_COLUMNS, WALKER_ROWS } from '@/game/render'
import {
  hasLevelMedal,
  availableMedalCount,
  deployableFortressIdsOf,
  isEquipmentUnlocked,
  isLevelUnlocked,
  missionBriefingOf,
} from '@/game/level'
import type { LevelLibrary, LevelMedalSlot, LevelProgress } from '@/game/level'
import { loadVehicleLoadouts } from '@/game/loadout'
import type { VehicleLoadoutPreset } from '@/game/loadout'

const AchievementShop = lazy(() => import('@/components/AchievementShop'))
const PreparationScreen = lazy(() => import('@/components/PreparationScreen'))

const MEDAL_SLOTS: LevelMedalSlot[] = ['primary', 'secondary-1', 'secondary-2']
const EMPTY_TURRET_ASSIGNMENTS: Readonly<Record<string, string>> = {}

function loadoutEquipmentUnlocked(preset: VehicleLoadoutPreset, progress: LevelProgress, library: LevelLibrary): boolean {
  return preset.turrets.every(item => isEquipmentUnlocked(progress, { kind: 'turret', id: item.turretDefId }, library))
    && preset.modules.every(item => isEquipmentUnlocked(progress, { kind: 'module', id: item.defId }, library))
}

export function VehiclePreview({
  def,
  turretAssignments = EMPTY_TURRET_ASSIGNMENTS,
  showHardpoints = false,
  replaceBuiltInTurrets = false,
}: {
  def: FortressDef
  turretAssignments?: Readonly<Record<string, string>>
  showHardpoints?: boolean
  /** 战斗整备草稿显式接管全部可见炮位，不再从模板回退到预装炮塔。 */
  replaceBuiltInTurrets?: boolean
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const body = resolveAssetSrc(def.spriteBody)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    let disposed = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let attempts = 0
    const load = (src: string | null | undefined) => new Promise<HTMLImageElement | null>(resolve => {
      if (!src) { resolve(null); return }
      const image = new Image()
      image.onload = () => resolve(image)
      image.onerror = () => resolve(null)
      image.src = src
    })
    const trackSources = (def.tracks ?? []).map(track => resolveAssetSrc(track.tile))
    const wheelSources = (def.wheels ?? []).map(wheel => resolveAssetSrc(wheel.sprite))
    const rotorSources = (def.rotors ?? []).map(rotor => resolveAssetSrc(rotor.asset))
    const decalSources = (def.decals ?? []).map(decal => resolveAssetSrc(decal.asset))
    const sources = Array.from(new Set([body, ...trackSources, ...wheelSources, ...rotorSources, ...decalSources].filter((src): src is string => !!src)))
    const loaded = new Map<string, HTMLImageElement>()

    const angleOf = (hardpoint: Hardpoint) => {
      if (hardpoint.fixed !== undefined) return hardpoint.fixed * Math.PI / 180
      if (!hardpoint.arc) return 0
      const span = ((hardpoint.arc.end - hardpoint.arc.start) % 360 + 360) % 360
      return (hardpoint.arc.start + span / 2) * Math.PI / 180
    }

    const paint = () => {
      if (disposed) return
      const rect = canvas.getBoundingClientRect()
      const width = Math.max(1, rect.width)
      const height = Math.max(1, rect.height)
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

      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
      const include = (x: number, y: number, w: number, h: number) => {
        minX = Math.min(minX, x); minY = Math.min(minY, y)
        maxX = Math.max(maxX, x + w); maxY = Math.max(maxY, y + h)
      }
      // 只把实际占格纳入预览边界；旧数据中位于形状上方/左侧的空坐标不应压缩载具。
      if (def.shape && def.shape.length > 0) {
        for (const key of def.shape) {
          const [x, y] = key.split(',').map(Number)
          if (Number.isInteger(x) && Number.isInteger(y)) include(x * BASE_CELL, y * BASE_CELL, BASE_CELL, BASE_CELL)
        }
      } else include(0, 0, def.w * BASE_CELL, def.h * BASE_CELL)
      // 与单位编辑器和战场渲染共用有效车体中心；外框可能含左/上空白边距，
      // 不能再用 w/2、h/2，否则主体会与按局部坐标绘制的履带、轮胎和炮位错开。
      const localCenter = fortressLocalCenter(def)
      const nativeCenterX = localCenter.x * BASE_CELL
      const nativeCenterY = localCenter.y * BASE_CELL
      const bodyImage = body ? loaded.get(body) ?? null : null
      if (bodyImage) {
        const columns = def.chassis === 'walker' ? WALKER_COLUMNS : 1
        const rows = def.chassis === 'walker' ? WALKER_ROWS : 1
        const frameWidth = bodyImage.naturalWidth / columns
        const frameHeight = bodyImage.naturalHeight / rows
        const offsetX = def.chassis === 'walker' ? def.walkerBodyOffsetX ?? 0 : 0
        const offsetY = def.chassis === 'walker' ? def.walkerBodyOffsetY ?? 0 : 0
        include(nativeCenterX + offsetX - frameWidth / 2, nativeCenterY + offsetY - frameHeight / 2, frameWidth, frameHeight)
      }

      const trackLayers = (def.tracks ?? []).flatMap((track, index) => {
        const src = trackSources[index]
        const image = src ? loaded.get(src) : undefined
        if (!image) return []
        const tileLength = image.naturalHeight / BASE_CELL
        return [false, true].flatMap(mirror => centeredTrackPlacements(def, track, 0, tileLength).map(placement => {
          const x = nativeCenterX + (mirror ? -placement.x : placement.x) * BASE_CELL
          const y = nativeCenterY - placement.y * BASE_CELL
          const layer = { image, mirror, x, y, width: image.naturalWidth, height: image.naturalHeight * placement.scaleY, alpha: placement.alpha }
          include(x - layer.width / 2, y - layer.height / 2, layer.width, layer.height)
          return layer
        }))
      })
      const wheelLayers = (def.wheels ?? []).flatMap((wheel, index) => {
        const src = wheelSources[index]
        const image = src ? loaded.get(src) : undefined
        const frames = wheelFrameCount(wheel)
        const sourceWidth = image ? image.naturalWidth / frames : 11
        const sourceHeight = image?.naturalHeight ?? 20
        return wheelPlacements(def, wheel).map(placement => {
          const layer = { image, mirror: placement.mirror, x: nativeCenterX + placement.x * BASE_CELL, y: nativeCenterY - placement.y * BASE_CELL, width: sourceWidth, height: sourceHeight }
          include(layer.x - layer.width / 2, layer.y - layer.height / 2, layer.width, layer.height)
          return layer
        })
      })
      const rotorLayers = (def.rotors ?? []).flatMap((rotor, index) => {
        const src = rotorSources[index]
        const image = src ? loaded.get(src) : undefined
        if (!image) return []
        const xs = rotor.unit === 'pair' && Math.abs(rotor.x) > 1e-6 ? [-Math.abs(rotor.x), Math.abs(rotor.x)] : [rotor.x]
        return xs.map((x, rotorIndex) => {
          const layer = { image, x: nativeCenterX + x, y: nativeCenterY + rotor.y, width: image.naturalWidth, height: image.naturalHeight, key: `${rotor.id}-${rotorIndex}`, layer: rotor.layer ?? 'above' }
          include(layer.x - layer.width / 2, layer.y - layer.height / 2, layer.width, layer.height)
          return layer
        })
      })
      const decalLayers = (def.decals ?? []).flatMap((decal, index) => {
        const src = decalSources[index]
        const image = src ? loaded.get(src) : undefined
        if (!image) return []
        const height = Math.max(0.1, decal.size) * BASE_CELL
        const width = height * image.naturalWidth / Math.max(1, image.naturalHeight)
        const layer = { image, x: decal.x * BASE_CELL, y: decal.y * BASE_CELL, width, height, angle: (decal.angle ?? 0) * Math.PI / 180 }
        const radius = Math.hypot(width, height) / 2
        include(layer.x - radius, layer.y - radius, radius * 2, radius * 2)
        return [layer]
      })
      for (const hardpoint of def.hardpoints) {
        if (hardpoint.hideTurretArt ?? hardpoint.hidden) continue
        const turretId = replaceBuiltInTurrets ? turretAssignments[hardpoint.id] : hardpoint.builtIn ?? turretAssignments[hardpoint.id]
        if (!turretId) continue
        const turret = TURRET_DEFS.find(item => item.id === turretId)
        if (turret) include((hardpoint.x - turret.w / 2) * BASE_CELL, (hardpoint.y - turret.h / 2) * BASE_CELL, turret.w * BASE_CELL, turret.h * BASE_CELL)
      }

      // 原始像素优先：小于预览框时 scale=1；只有完整单位越界时才统一缩小。
      const padding = 6
      const scale = Math.min(1, (width - padding * 2) / Math.max(1, maxX - minX), (height - padding * 2) / Math.max(1, maxY - minY))
      const originX = (width - (maxX - minX) * scale) / 2 - minX * scale
      const originY = (height - (maxY - minY) * scale) / 2 - minY * scale
      const cell = BASE_CELL * scale
      const centerX = originX + nativeCenterX * scale
      const centerY = originY + nativeCenterY * scale
      const drawVehicleLayer = (image: HTMLImageElement | null) => {
        if (!image) return
        const columns = def.chassis === 'walker' ? WALKER_COLUMNS : 1
        const rows = def.chassis === 'walker' ? WALKER_ROWS : 1
        const sourceWidth = image.naturalWidth / columns
        const sourceHeight = image.naturalHeight / rows
        const drawWidth = sourceWidth * scale
        const drawHeight = sourceHeight * scale
        const offsetX = def.chassis === 'walker' ? (def.walkerBodyOffsetX ?? 0) * scale : 0
        const offsetY = def.chassis === 'walker' ? (def.walkerBodyOffsetY ?? 0) * scale : 0
        const painted = def.paint?.base ? tintedFx(image, def.paint.base, 'multiply') : null
        ctx.drawImage(painted ?? image, 0, 0, sourceWidth, sourceHeight, centerX + offsetX - drawWidth / 2, centerY + offsetY - drawHeight / 2, drawWidth, drawHeight)
      }
      const turretLayers = def.hardpoints.flatMap(hardpoint => {
        if (hardpoint.hideTurretArt ?? hardpoint.hidden) return []
        const turretId = replaceBuiltInTurrets ? turretAssignments[hardpoint.id] : hardpoint.builtIn ?? turretAssignments[hardpoint.id]
        if (!turretId) return []
        const turret = TURRET_DEFS.find(item => item.id === turretId)
        if (!turret || turret.mount !== hardpoint.size || (hardpoint.types && !hardpoint.types.includes(turret.type))) return []
        return [{ hardpoint, turret }]
      }).sort((a, b) => (a.hardpoint.zLevel ?? 1) - (b.hardpoint.zLevel ?? 1))
      const drawMountedTurret = ({ hardpoint, turret }: (typeof turretLayers)[number]) => {
        drawTurretPreviewCore(ctx, turret, {
          x: originX + (hardpoint.x - turret.w / 2) * cell,
          y: originY + (hardpoint.y - turret.h / 2) * cell,
          cell,
        }, { angleRad: angleOf(hardpoint), tintColor: def.paint?.turret })
      }

      if (!bodyImage) {
        ctx.fillStyle = def.color
        ctx.fillRect(originX, originY, def.w * cell, def.h * cell)
        ctx.strokeStyle = '#1A1A18'
        ctx.lineWidth = Math.max(1, 2 * scale)
        ctx.strokeRect(originX, originY, def.w * cell, def.h * cell)
      }
      for (const layer of trackLayers) {
        ctx.save()
        ctx.globalAlpha = layer.alpha
        ctx.translate(originX + layer.x * scale, originY + layer.y * scale)
        if (layer.mirror) ctx.scale(-1, 1)
        ctx.drawImage(layer.image, -layer.width * scale / 2, -layer.height * scale / 2, layer.width * scale, layer.height * scale)
        ctx.restore()
      }
      for (const layer of wheelLayers) {
        ctx.save()
        ctx.translate(originX + layer.x * scale, originY + layer.y * scale)
        if (layer.mirror) ctx.scale(-1, 1)
        if (layer.image) ctx.drawImage(layer.image, 0, 0, layer.width, layer.height, -layer.width * scale / 2, -layer.height * scale / 2, layer.width * scale, layer.height * scale)
        else {
          ctx.fillStyle = '#2A2A28'; ctx.strokeStyle = '#1A1A18'; ctx.lineWidth = Math.max(1, scale)
          ctx.beginPath(); ctx.roundRect(-layer.width * scale / 2, -layer.height * scale / 2, layer.width * scale, layer.height * scale, layer.width * scale * 0.35); ctx.fill(); ctx.stroke()
        }
        ctx.restore()
      }
      for (const layer of turretLayers) if (hardpointBelowVehicleBody(layer.hardpoint)) drawMountedTurret(layer)
      for (const layer of rotorLayers) if (layer.layer === 'below') {
        ctx.drawImage(layer.image, originX + (layer.x - layer.width / 2) * scale, originY + (layer.y - layer.height / 2) * scale, layer.width * scale, layer.height * scale)
      }
      drawVehicleLayer(bodyImage)
      for (const layer of rotorLayers) if (layer.layer === 'above') {
        ctx.drawImage(layer.image, originX + (layer.x - layer.width / 2) * scale, originY + (layer.y - layer.height / 2) * scale, layer.width * scale, layer.height * scale)
      }
      for (const layer of decalLayers) {
        ctx.save()
        ctx.translate(originX + layer.x * scale, originY + layer.y * scale)
        ctx.rotate(layer.angle)
        ctx.drawImage(layer.image, -layer.width * scale / 2, -layer.height * scale / 2, layer.width * scale, layer.height * scale)
        ctx.restore()
      }
      for (const layer of turretLayers) if (!hardpointBelowVehicleBody(layer.hardpoint)) drawMountedTurret(layer)
      if (showHardpoints) for (const hardpoint of def.hardpoints) {
        const x = originX + hardpoint.x * cell
        const y = originY + hardpoint.y * cell
        const occupied = !!(replaceBuiltInTurrets ? turretAssignments[hardpoint.id] : hardpoint.builtIn ?? turretAssignments[hardpoint.id])
        const radius = Math.max(5, cell * (hardpoint.size === 'L' ? 0.32 : hardpoint.size === 'M' ? 0.25 : 0.19))
        ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2)
        ctx.fillStyle = occupied ? '#D9A441CC' : '#EFEBD8CC'; ctx.fill()
        ctx.strokeStyle = '#1A1A18'; ctx.lineWidth = Math.max(1.5, scale * 2); ctx.stroke()
        ctx.fillStyle = '#1A1A18'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = `900 ${Math.max(7, radius)}px sans-serif`; ctx.fillText(hardpoint.size, x, y)
      }
      if (attempts++ < 16) timer = setTimeout(paint, 120)
    }

    const observer = new ResizeObserver(paint)
    observer.observe(canvas)
    Promise.all(sources.map(async src => ({ src, image: await load(src) }))).then(results => {
      if (disposed) return
      for (const result of results) if (result.image) loaded.set(result.src, result.image)
      paint()
    })
    return () => { disposed = true; observer.disconnect(); if (timer) clearTimeout(timer) }
  }, [body, def, replaceBuiltInTurrets, showHardpoints, turretAssignments])

  return (
    <div className="relative flex-1 min-h-0 w-full overflow-hidden flex items-center justify-center">
      <canvas ref={canvasRef} width={1} height={1} aria-label={`${def.name}载具及预装炮塔预览`} className="w-full h-full [image-rendering:pixelated]" />
    </div>
  )
}

function MedalState({ earned }: { earned: boolean }) {
  return (
    <div className="flex items-center gap-1 shrink-0">
      <span aria-hidden="true" className={`text-[15px] leading-none ${earned ? 'text-[#C58B12]' : 'text-black/28'}`}>●</span>
      <span className={`px-1 py-0.5 border text-[8px] font-black ${earned ? 'border-[#B3392E] text-[#B3392E] bg-[#EFEBD8]' : 'border-black/45 text-black/55 bg-[#C9C29F]'}`}>
        {earned ? '已获得' : '未获得'}
      </span>
    </div>
  )
}

export default function MissionBriefing({
  library,
  progress,
  selectedLevelId,
  selectedLoadoutId,
  fortresses,
  onSelectLevel,
  onSelectLoadout,
  onProgressChange,
  onBack,
  onStart,
}: {
  library: LevelLibrary
  progress: LevelProgress
  selectedLevelId: string
  selectedLoadoutId: string
  fortresses: FortressDef[]
  onSelectLevel: (id: string) => void
  onSelectLoadout: (presetId: string, fortressDefId: string) => void
  onProgressChange: (progress: LevelProgress) => void
  onBack: () => void
  onStart: () => void
}) {
  const [shopOpen, setShopOpen] = useState(false)
  const [preparationOpen, setPreparationOpen] = useState(false)
  const [loadouts, setLoadouts] = useState(loadVehicleLoadouts)
  const selected = library.levels.find(entry => entry.id === selectedLevelId) ?? library.levels[0]
  const briefing = missionBriefingOf(selected)
  const goals = [briefing.primaryObjective, ...briefing.secondaryObjectives]
  const allowedIds = deployableFortressIdsOf(selected, fortresses.map(def => def.id))
  const availableFortresses = fortresses.filter(def => allowedIds.includes(def.id))
  const unlockedFortresses = availableFortresses.filter(def => isEquipmentUnlocked(progress, { kind: 'fortress', id: def.id }, library))
  const availableLoadouts = loadouts.filter(preset => availableFortresses.some(def => def.id === preset.fortressDefId))
  const unlockedLoadouts = availableLoadouts.filter(preset => unlockedFortresses.some(def => def.id === preset.fortressDefId)
    && loadoutEquipmentUnlocked(preset, progress, library))
  const selectedLoadout = availableLoadouts.find(preset => preset.id === selectedLoadoutId)
  const canStart = isLevelUnlocked(library, selected.id, progress) && unlockedLoadouts.some(preset => preset.id === selectedLoadoutId)

  return (
    <div className="absolute inset-0 z-[90] bg-[#D8CFB8] p-2 sm:p-4 font-comic select-none overflow-hidden">
      <div className="relative h-full border-2 border-black p-2 sm:p-3 pt-12 sm:pt-14 flex flex-col">
        <h1 className="absolute left-3 top-2 text-[22px] sm:text-[28px] leading-none font-black">关卡任务</h1>
        <div className="absolute right-3 top-2 flex gap-2">
          <button type="button" onClick={() => setPreparationOpen(true)} className="comic-btn px-3 py-1 text-[10px] sm:text-[12px] font-black">战车整备</button>
          <button type="button" onClick={() => setShopOpen(true)} className="comic-btn px-3 py-1 text-[10px] sm:text-[12px] font-black">成就商店 · ● {availableMedalCount(progress)}</button>
        </div>

        <div className="flex-1 min-h-0 grid grid-cols-[22%_40%_1fr] gap-1.5 portrait:grid-cols-1 portrait:overflow-y-auto portrait:auto-rows-[minmax(180px,auto)]">
          <section className="border-2 border-black min-h-0 flex flex-col bg-[#D8CFB8]">
            <h2 className="px-2 py-1 text-[12px] sm:text-[14px] font-black border-b-2 border-black">关卡列表</h2>
            <div className="flex-1 min-h-0 overflow-y-auto">
              {library.levels.map((entry, index) => {
                const unlocked = isLevelUnlocked(library, entry.id, progress)
                const selectedNow = entry.id === selected.id
                const medalCount = MEDAL_SLOTS.filter(slot => hasLevelMedal(progress, entry.id, slot)).length
                const completed = progress.completedIds.includes(entry.id)
                return (
                  <button
                    key={entry.id}
                    type="button"
                    disabled={!unlocked}
                    onClick={() => {
                      onSelectLevel(entry.id)
                      const entryAllowedIds = deployableFortressIdsOf(entry, fortresses.map(def => def.id))
                      const allowed = fortresses.filter(def => entryAllowedIds.includes(def.id))
                      const nextAvailable = allowed.filter(def => isEquipmentUnlocked(progress, { kind: 'fortress', id: def.id }, library))
                      const nextPreset = loadouts.find(preset => nextAvailable.some(def => def.id === preset.fortressDefId)
                        && loadoutEquipmentUnlocked(preset, progress, library))
                      if (nextPreset) {
                        onSelectLoadout(nextPreset.id, nextPreset.fortressDefId)
                      }
                    }}
                    className={`w-full min-h-[66px] px-2 py-2 text-left border-b border-black/35 disabled:cursor-not-allowed ${selectedNow ? 'bg-[#B3392E] text-[#EFEBD8]' : unlocked ? 'bg-[#D8CFB8] hover:bg-[#D9A441]/20' : 'bg-[#C9C29F] text-black/45'}`}
                  >
                    <div className="text-[11px] sm:text-[13px] font-black truncate">{String(index + 1).padStart(2, '0')} · {entry.name}</div>
                    <div className="mt-1 flex items-center gap-1 text-[9px] sm:text-[10px] font-bold">
                      {!unlocked ? <><Lock className="w-3 h-3" /><span>前置关卡未完成</span></> : <><span>{completed ? '已完成' : '未完成'}</span><span className={selectedNow ? 'text-[#F4C247]' : 'text-[#9B741D]'}>{'★'.repeat(medalCount)}{'☆'.repeat(3 - medalCount)}</span></>}
                    </div>
                  </button>
                )
              })}
            </div>
          </section>

          <div className="min-h-0 grid grid-rows-[minmax(0,72%)_minmax(0,28%)] gap-1.5">
            <section className="border-2 border-black min-h-0 flex flex-col bg-[#D8CFB8]">
              <h2 className="px-2 py-1 text-[12px] sm:text-[14px] font-black border-b-2 border-black">任务贴图</h2>
              <div className="flex-1 min-h-0 bg-[#6F6250] p-1">
                <img src={resolveAssetSrc(briefing.image) ?? '/res/mission/briefing_default.svg'} alt={`${selected.name}任务贴图`} className="w-full h-full object-cover border border-black" draggable={false} />
              </div>
            </section>

            <section className="border-2 border-black min-h-0 flex flex-col bg-[#D8CFB8]">
              <h2 className="px-2 py-1 text-[11px] sm:text-[13px] font-black border-b-2 border-black">出战车辆选择</h2>
              <div className="flex-1 min-h-0 grid grid-flow-col auto-cols-[minmax(92px,1fr)] gap-1 p-1 overflow-x-auto">
                {availableLoadouts.map(preset => {
                  const def = fortresses.find(item => item.id === preset.fortressDefId)
                  if (!def) return null
                  const active = preset.id === selectedLoadoutId
                  const unlocked = isEquipmentUnlocked(progress, { kind: 'fortress', id: preset.fortressDefId }, library)
                    && loadoutEquipmentUnlocked(preset, progress, library)
                  const turretAssignments = Object.fromEntries(preset.turrets.map(item => [item.hardpointId, item.turretDefId]))
                  return (
                    <button key={preset.id} type="button" aria-pressed={active} disabled={!unlocked} title={unlocked ? undefined : '载具或预设装备尚未解锁'} onClick={() => onSelectLoadout(preset.id, def.id)} className={`relative min-w-[92px] min-h-0 border-2 p-1 flex flex-col items-center bg-[#EFEBD8] disabled:opacity-45 disabled:cursor-not-allowed ${active ? 'border-[#B3392E]' : 'border-black'}`}>
                      <span className={`absolute right-1 top-1 w-4 h-4 border-2 border-black text-[10px] leading-[11px] font-black ${active ? 'bg-[#B3392E] text-white' : 'bg-[#EFEBD8]'}`}>{active ? '✓' : ''}</span>
                      {!unlocked && <span className="absolute left-1 top-1 z-10 border border-black bg-[#C9C29F] p-0.5"><Lock className="w-3 h-3" /></span>}
                      <VehiclePreview def={def} turretAssignments={turretAssignments} />
                      <span className="w-full text-[9px] sm:text-[11px] font-black truncate">{preset.name}</span>
                      <span className="w-full text-[7px] sm:text-[8px] font-bold text-black/55 truncate">{def.name}</span>
                    </button>
                  )
                })}
                {availableLoadouts.length === 0 && <div className="col-span-full flex items-center justify-center px-3 text-[10px] font-black text-[#7A2E2A]">本关尚未配置可出战载具预设</div>}
              </div>
            </section>
          </div>

          <div className="min-h-0 grid grid-rows-[minmax(0,61%)_minmax(0,27%)_minmax(44px,12%)] gap-1.5">
            <section className="border-2 border-black min-h-0 flex flex-col bg-[#D8CFB8]">
              <h2 className="px-2 py-1 text-[12px] sm:text-[14px] font-black border-b-2 border-black">任务简报</h2>
              <p className="p-3 text-[10px] sm:text-[13px] font-bold leading-relaxed whitespace-pre-wrap overflow-y-auto">{briefing.introduction}</p>
            </section>

            <section className="border-2 border-black min-h-0 flex flex-col bg-[#D8CFB8]">
              <h2 className="px-2 py-1 text-[12px] sm:text-[14px] font-black border-b-2 border-black">任务目标面板</h2>
              <div className="flex-1 min-h-0 flex flex-col divide-y divide-black/35">
                {goals.map((goal, index) => {
                  const slot = MEDAL_SLOTS[index]
                  const earned = hasLevelMedal(progress, selected.id, slot)
                  return (
                    <div key={slot} className="flex-1 min-h-0 px-2 py-1 flex items-center gap-2">
                      <span className={`px-1 py-0.5 border border-black text-[8px] sm:text-[9px] font-black shrink-0 ${index === 0 ? 'bg-[#B3392E] text-[#EFEBD8]' : 'bg-[#C9C29F]'}`}>{index === 0 ? '主要目标' : '次要目标'}</span>
                      <span className="flex-1 min-w-0 text-[8px] sm:text-[10px] font-bold truncate" title={goal}>{goal}</span>
                      <span className="text-[8px] font-bold shrink-0">奖励：</span>
                      <MedalState earned={earned} />
                    </div>
                  )
                })}
              </div>
            </section>

            <div className="grid grid-cols-2 gap-5 min-h-0">
              <button type="button" data-audio-cue="uiCancel" onClick={onBack} className="comic-btn bg-[#D8CFB8] text-[13px] sm:text-[16px] font-black">返回</button>
              <button type="button" data-audio-cue="uiConfirm" disabled={!canStart} onClick={onStart} className="comic-btn text-[13px] sm:text-[16px] font-black disabled:opacity-40 disabled:cursor-not-allowed">开始任务</button>
            </div>
          </div>
        </div>
      </div>
      {shopOpen && (
        <Suspense fallback={<div className="absolute inset-0 z-[110] flex items-center justify-center bg-[#D8CFB8] font-comic text-sm font-black">正在加载成就商店…</div>}>
          <AchievementShop progress={progress} onProgressChange={onProgressChange} onClose={() => setShopOpen(false)} />
        </Suspense>
      )}
      {preparationOpen && (
        <Suspense fallback={<div className="absolute inset-0 z-[140] flex items-center justify-center bg-[#D8CFB8] font-comic text-sm font-black">正在加载战车整备…</div>}>
          <PreparationScreen
            library={library}
            progress={progress}
            selectedPresetId={selectedLoadout?.id ?? selectedLoadoutId}
            lockedFortressDefId={selectedLoadout?.fortressDefId}
            onSelectPreset={(presetId, fortressDefId) => {
              setLoadouts(loadVehicleLoadouts())
              onSelectLoadout(presetId, fortressDefId)
            }}
            onClose={() => { setLoadouts(loadVehicleLoadouts()); setPreparationOpen(false) }}
          />
        </Suspense>
      )}
    </div>
  )
}
