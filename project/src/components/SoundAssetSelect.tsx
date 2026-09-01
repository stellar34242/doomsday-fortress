import { useEffect, useState } from 'react'
import { filterAssets } from '@/game/assetlib'
import { autoSoundPreset, saveSoundPreset, soundPreset } from '@/game/audioConfig'
import type { AutoSoundChannel, SoundPreset } from '@/game/audioConfig'
import { audioManager } from '@/game/audio'
import ValidatedNumberInput from '@/components/ValidatedNumberInput'

const CHANNEL_LABEL: Record<AutoSoundChannel, string> = {
  ui: 'UI', unit: '单位', weapon: '武器', environment: '环境',
}

export default function SoundAssetSelect({ value, onChange, ariaLabel, channel, loop = false, className }: {
  value: string | undefined
  onChange: (value: string | undefined) => void
  ariaLabel: string
  channel: AutoSoundChannel
  loop?: boolean
  className?: string
}) {
  const [, setRevision] = useState(0)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  useEffect(() => () => { if (previewing) audioManager.stopPreview() }, [previewing])
  const soundAssets = filterAssets('se')
  const currentPreset = soundPreset(value)
  const currentAssetId = currentPreset?.assets.length === 1 ? currentPreset.assets[0]?.assetId : undefined
  const selectedAssetId = soundAssets.some(asset => asset.id === currentAssetId) ? currentAssetId : ''
  const patchPreset = (patch: Partial<SoundPreset>) => {
    if (!currentPreset) return
    saveSoundPreset({ ...currentPreset, ...patch })
    setRevision(revision => revision + 1)
  }
  const stopPreview = () => {
    audioManager.stopPreview()
    setPreviewing(false)
  }
  const closeSettings = () => {
    stopPreview()
    setSettingsOpen(false)
  }
  const togglePreview = async () => {
    if (!selectedAssetId || !currentPreset) return
    if (previewing) { stopPreview(); return }
    const pitch = currentPreset.pitchMin + Math.random() * Math.max(0, currentPreset.pitchMax - currentPreset.pitchMin)
    setPreviewing(true)
    const played = await audioManager.playPreview(selectedAssetId, loop, () => setPreviewing(false), {
      volume: currentPreset.volume,
      playbackRate: pitch,
    })
    if (!played) setPreviewing(false)
  }

  return <span className="relative inline-flex min-w-0 max-w-full items-center gap-1">
    <select aria-label={ariaLabel} className={`h-6 w-auto max-w-full min-w-0 px-1 text-[11px] font-comic border-2 border-black bg-[#EFEBD8] ${className ?? ''}`} value={selectedAssetId ?? ''} onChange={event => {
      stopPreview()
      if (!event.target.value) { onChange(undefined); setSettingsOpen(false); return }
      onChange(autoSoundPreset(event.target.value, { channel, loop })?.id)
    }}>
      <option value="">未配置</option>
      <optgroup label="内置">{soundAssets.filter(asset => asset.builtin).map(asset => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</optgroup>
      <optgroup label="已上传">{soundAssets.filter(asset => !asset.builtin).map(asset => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</optgroup>
    </select>
    <button
      type="button"
      aria-label={`${ariaLabel}参数`}
      title={selectedAssetId ? '配置当前音效参数' : '请先选择音效素材'}
      disabled={!selectedAssetId || !currentPreset}
      className="h-6 w-6 shrink-0 border-2 border-black bg-[#D9A441] text-[12px] font-black leading-none disabled:cursor-not-allowed disabled:opacity-35"
      onClick={() => {
        const normalized = selectedAssetId ? autoSoundPreset(selectedAssetId, { channel, loop }) : undefined
        if (normalized && normalized.id !== value) onChange(normalized.id)
        setSettingsOpen(true)
      }}
    >⚙</button>
    {settingsOpen && currentPreset ? <div role="dialog" aria-modal="true" aria-label={`${ariaLabel}参数设置`} className="fixed inset-0 z-[120] flex items-center justify-center bg-black/35 p-3" onMouseDown={closeSettings}>
      <section className="comic-panel w-[300px] max-w-full p-2 text-[10px] text-black" onMouseDown={event => event.stopPropagation()}>
        <div className="mb-2 flex items-center gap-2 border-b-2 border-black/20 pb-1">
          <span className="min-w-0 flex-1 truncate font-black">{soundAssets.find(asset => asset.id === selectedAssetId)?.name ?? currentPreset.name}</span>
          <button type="button" aria-label={`${ariaLabel}${previewing ? '停止播放' : '播放'}`} className={`comic-btn h-6 px-2 ${previewing ? 'bg-[#B3392E] text-[#EFEBD8]' : ''}`} onClick={() => void togglePreview()}>{previewing ? '■ 停止' : '▶ 播放'}</button>
          <button type="button" aria-label="关闭音效参数" className="comic-btn h-6 w-6 p-0" onClick={closeSettings}>×</button>
        </div>
        <div className="mb-2 grid grid-cols-2 gap-1 text-[9px] font-bold text-black/55">
          <span>通道：{CHANNEL_LABEL[channel]}</span><span>播放：{loop ? '循环' : '单次'}</span>
        </div>
        <div className="grid grid-cols-2 gap-x-2 gap-y-1.5">
          <label className="grid grid-cols-[58px_1fr] items-center gap-1 font-bold">音量<ValidatedNumberInput aria-label="音效音量" min={0} max={1} step={0.05} className="h-6 min-w-0 px-1 border-2 border-black bg-[#EFEBD8]" value={currentPreset.volume} onChange={event => patchPreset({ volume: Number(event.target.value) })} /></label>
          <label className="grid grid-cols-[58px_1fr] items-center gap-1 font-bold">并发<ValidatedNumberInput aria-label="音效并发" min={1} max={32} step={1} className="h-6 min-w-0 px-1 border-2 border-black bg-[#EFEBD8]" value={currentPreset.maxVoices} onChange={event => patchPreset({ maxVoices: Number(event.target.value) })} /></label>
          <label className="grid grid-cols-[58px_1fr] items-center gap-1 font-bold">最低音高<ValidatedNumberInput aria-label="音效最低音高" min={0.5} max={currentPreset.pitchMax} step={0.05} className="h-6 min-w-0 px-1 border-2 border-black bg-[#EFEBD8]" value={currentPreset.pitchMin} onChange={event => patchPreset({ pitchMin: Number(event.target.value) })} /></label>
          <label className="grid grid-cols-[58px_1fr] items-center gap-1 font-bold">最高音高<ValidatedNumberInput aria-label="音效最高音高" min={currentPreset.pitchMin} max={2} step={0.05} className="h-6 min-w-0 px-1 border-2 border-black bg-[#EFEBD8]" value={currentPreset.pitchMax} onChange={event => patchPreset({ pitchMax: Number(event.target.value) })} /></label>
          <label className="grid grid-cols-[58px_1fr] items-center gap-1 font-bold">冷却(s)<ValidatedNumberInput aria-label="音效冷却" min={0} max={60} step={0.05} disabled={loop} className="h-6 min-w-0 px-1 border-2 border-black bg-[#EFEBD8] disabled:opacity-45" value={currentPreset.cooldown} onChange={event => patchPreset({ cooldown: Number(event.target.value) })} /></label>
          <label className="grid grid-cols-[58px_1fr] items-center gap-1 font-bold">距离(格)<ValidatedNumberInput aria-label="音效传播距离" min={0} max={200} step={1} disabled={channel === 'ui'} className="h-6 min-w-0 px-1 border-2 border-black bg-[#EFEBD8] disabled:opacity-45" value={currentPreset.maxDistance} onChange={event => patchPreset({ maxDistance: Number(event.target.value) })} /></label>
        </div>
      </section>
    </div> : null}
  </span>
}
