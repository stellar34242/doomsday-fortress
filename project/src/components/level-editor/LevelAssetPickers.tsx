import { filterAssets, getAsset } from '@/game/assetlib'
import type { AssetTileKind } from '@/game/assetlib'
import type { LevelTileCell } from '@/game/levelEditor'

const TILE_KIND_NAME: Record<AssetTileKind, string> = {
  independent: '独立图块',
  autotileStatic: '静态 Autotile',
  autotileAnimated: '动态 Autotile',
}

export function TileAssetPicker({ kind, template, onSelect }: {
  kind: AssetTileKind
  template: Omit<LevelTileCell, 'x' | 'y'>
  onSelect: (next: Omit<LevelTileCell, 'x' | 'y'>) => void
}) {
  const assets = filterAssets('tile').filter(asset => asset.tileSheet?.kind === kind)
  const independent = kind === 'independent'
  return <section className="border-2 border-black/45 bg-[#D2CCA9] px-1.5 py-1 space-y-1">
    <div className="flex items-center justify-between gap-1"><span className="text-[9px] font-black">{TILE_KIND_NAME[kind]}</span><span className="text-[7px] font-bold text-black/45">{independent ? '160×160 · 25格' : kind === 'autotileStatic' ? '96×128' : '384×128 · 4帧'}</span></div>
    {assets.length === 0 ? <div className="px-1 py-2 border border-dashed border-black/30 text-center text-[8px] font-bold text-black/40">素材库中暂无此类图块</div> : independent ? assets.map(asset => {
      const selectedAsset = template.assetId === asset.id && template.source === 'independent'
      const validTileIndices = asset.tileSheet?.validTileIndices ?? Array.from({ length: 25 }, (_, index) => index)
      return <div key={asset.id} className="p-1 border-2 border-black/30 bg-[#EFEBD8]">
        <button type="button" disabled={validTileIndices.length === 0} className="w-full mb-1 text-left text-[8px] font-black flex items-center gap-1 disabled:opacity-40" onClick={() => onSelect({ source: 'independent', assetId: asset.id, tileIndex: validTileIndices[0], flipX: false, rotation: 0 })}><span className="truncate">{asset.name}</span><span className="ml-auto shrink-0 text-[7px] text-black/45">有效 {validTileIndices.length}/25</span></button>
        <div className="flex flex-wrap gap-1">{validTileIndices.map(index => {
          const x = index % 5; const y = Math.floor(index / 5)
          return <button key={index} type="button" aria-label={`${asset.name} 图块 ${index}`} title={`${asset.name} · 索引 ${index}`} className={`relative w-8 h-8 shrink-0 overflow-hidden border bg-no-repeat [image-rendering:pixelated] ${selectedAsset && template.tileIndex === index ? 'border-2 border-[#B3392E]' : 'border-black/35'}`} style={{ backgroundImage: `url(${asset.src})`, backgroundSize: '160px 160px', backgroundPosition: `${-x * 32}px ${-y * 32}px` }} onClick={() => onSelect({ source: 'independent', assetId: asset.id, tileIndex: index, flipX: false, rotation: 0 })}><span className="absolute right-0 bottom-0 min-w-3 px-0.5 bg-black/65 text-[#EFEBD8] text-[6px] leading-3 text-center">{index}</span></button>
        })}</div>
      </div>
    }) : <div className="flex flex-wrap gap-1">{assets.map((asset, index) => {
      const selectedAsset = template.assetId === asset.id && template.source === 'autotile'
      return <button key={asset.id} type="button" aria-label={`${asset.name} Autotile ${index}`} title={`${asset.name} · 索引 ${index} · 代表图为第3个32×32图块`} className={`relative w-8 h-8 shrink-0 overflow-hidden border bg-white bg-no-repeat [image-rendering:pixelated] ${kind === 'autotileAnimated' ? 'autotile-index-animated' : ''} ${selectedAsset ? 'border-2 border-[#B3392E]' : 'border-black/35'}`} style={{ backgroundImage: `url(${asset.src})`, backgroundSize: kind === 'autotileAnimated' ? '384px 128px' : '96px 128px', backgroundPosition: '-64px 0' }} onClick={() => onSelect({ source: 'autotile', assetId: asset.id, tileIndex: 0, flipX: false, rotation: 0 })}><span className="absolute right-0 bottom-0 min-w-3 px-0.5 bg-black/65 text-[#EFEBD8] text-[6px] leading-3 text-center">{index}</span></button>
    })}</div>}
  </section>
}

export function MissionImageSelect({ value, onChange }: { value: string; onChange: (assetId: string) => void }) {
  const assets = filterAssets('missionImage')
  const current = getAsset(value)
  const builtins = assets.filter(asset => asset.builtin)
  const uploads = assets.filter(asset => !asset.builtin)
  return <select aria-label="任务贴图" className="w-full px-1 py-0.5 text-[8px] border border-black bg-[#EFEBD8]" value={value} onChange={event => onChange(event.target.value)}>
    {!current && value ? <option value={value}>现有贴图（旧路径）</option> : null}
    <optgroup label="内置">{builtins.map(asset => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</optgroup>
    {uploads.length > 0 ? <optgroup label="已上传">{uploads.map(asset => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</optgroup> : null}
  </select>
}
