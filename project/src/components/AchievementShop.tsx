import { useMemo, useState } from 'react'
import { Award, Check, Lock, X } from 'lucide-react'
import { MODULE_DEFS, TURRET_DEFS } from '@/game/config'
import {
  ACHIEVEMENT_SHOP_ITEMS,
  availableMedalCount,
  earnedMedalCount,
  equipmentUnlockId,
  purchaseEquipmentFromShop,
} from '@/game/level'
import type { EquipmentKind, LevelProgress } from '@/game/level'
import { gameParameters } from '@/game/gameParameters'

const KIND_NAME: Record<EquipmentKind, string> = {
  fortress: '战车', turret: '炮塔', module: '模块', paint: '涂装', emblem: '徽记',
}

type Category = 'all' | EquipmentKind

function rewardDetail(kind: EquipmentKind, id: string): { color: string; detail: string } {
  if (kind === 'turret') {
    const def = TURRET_DEFS.find(item => item.id === id)
    return { color: def?.color ?? '#8E7A5E', detail: def ? `${def.mount}型 · 战斗造价 ${def.cost}` : '炮塔装备' }
  }
  if (kind === 'module') {
    const def = MODULE_DEFS.find(item => item.id === id)
    return { color: def?.color ?? '#78806C', detail: def ? `${def.w}×${def.h} · 战斗造价 ${def.cost}` : '内部模块' }
  }
  return { color: '#9B8B6E', detail: KIND_NAME[kind] }
}

function unlockSource(progress: LevelProgress, equipmentId: string): string {
  if (gameParameters().unlockAll) return '游戏参数：解锁所有'
  const record = progress.unlockRecords.find(item => item.equipmentId === equipmentId)
  if (record?.source === 'level') return '已通过关卡奖励解锁'
  if (record?.source === 'starter') return '初始装备'
  return '已兑换'
}

export default function AchievementShop({
  progress,
  onProgressChange,
  onClose,
}: {
  progress: LevelProgress
  onProgressChange: (progress: LevelProgress) => void
  onClose: () => void
}) {
  const [category, setCategory] = useState<Category>('all')
  const [message, setMessage] = useState('')
  const visibleItems = useMemo(() => ACHIEVEMENT_SHOP_ITEMS.filter(item => category === 'all' || item.reward.kind === category), [category])
  const earned = earnedMedalCount(progress)
  const available = availableMedalCount(progress)
  const unlockAll = gameParameters().unlockAll

  const exchange = (item: (typeof ACHIEVEMENT_SHOP_ITEMS)[number]) => {
    const result = purchaseEquipmentFromShop(item.reward, item.medalCost, item.id)
    if (!result.ok) {
      setMessage(result.reason === 'owned' ? '该奖励已经解锁。' : `勋章不足：需要 ${item.medalCost} 枚。`)
      return
    }
    onProgressChange(result.progress)
    setMessage(`已解锁：${item.name}`)
  }

  const categories: Array<{ id: Category; label: string }> = [
    { id: 'all', label: '全部' },
    ...(['fortress', 'turret', 'module', 'paint', 'emblem'] as EquipmentKind[])
      .filter(kind => ACHIEVEMENT_SHOP_ITEMS.some(item => item.reward.kind === kind))
      .map(kind => ({ id: kind, label: KIND_NAME[kind] })),
  ]

  return (
    <div className="absolute inset-0 z-[130] bg-[#D8CFB8] p-2 sm:p-4 font-comic select-none">
      <div className="relative h-full border-2 border-black flex flex-col bg-[#D8CFB8]">
        <header className="min-h-14 px-3 py-2 border-b-2 border-black flex items-center gap-3">
          <Award className="w-7 h-7 text-[#9B741D]" strokeWidth={2.5} />
          <div>
            <h1 className="text-[20px] sm:text-[26px] leading-none font-black">勋章与成就商店</h1>
            <p className="mt-1 text-[8px] sm:text-[10px] font-bold text-black/60">完成关卡目标获得勋章，兑换后永久解锁装备。</p>
          </div>
          <div className="ml-auto flex items-stretch border-2 border-black bg-[#EFEBD8] text-center">
            <div className="px-2 py-1 border-r border-black"><span className="block text-[7px] font-bold">累计</span><strong className="text-[14px] text-[#8A5A16]">{earned}</strong></div>
            <div className="px-2 py-1 border-r border-black"><span className="block text-[7px] font-bold">已消费</span><strong className="text-[14px]">{progress.spentMedals}</strong></div>
            <div className="px-2 py-1"><span className="block text-[7px] font-bold">可用</span><strong className="text-[14px] text-[#B3392E]">{available}</strong></div>
          </div>
          <button type="button" aria-label="关闭成就商店" data-audio-cue="uiCancel" onClick={onClose} className="comic-btn w-9 h-9 flex items-center justify-center"><X className="w-5 h-5" /></button>
        </header>

        <div className="px-2 py-1.5 border-b-2 border-black flex items-center gap-1">
          {categories.map(item => <button key={item.id} type="button" aria-pressed={category === item.id} onClick={() => setCategory(item.id)} className={`comic-btn min-w-16 px-3 py-1 text-[10px] font-black ${category === item.id ? 'bg-[#B3392E] text-[#EFEBD8]' : 'bg-[#D8CFB8]'}`}>{item.label}</button>)}
          {message && <span role="status" className="ml-auto px-2 text-[10px] font-black text-[#7A2E2A]">{message}</span>}
        </div>

        <main className="flex-1 min-h-0 overflow-y-auto p-2 sm:p-3">
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
            {visibleItems.map(item => {
              const key = equipmentUnlockId(item.reward)
              const owned = unlockAll || progress.unlockedEquipmentIds.includes(key)
              const affordable = available >= item.medalCost
              const detail = rewardDetail(item.reward.kind, item.reward.id)
              return <article key={item.id} className={`min-h-36 border-2 border-black p-2 flex flex-col ${owned ? 'bg-[#C9C29F]' : 'bg-[#EFEBD8]'}`}>
                <div className="flex items-start gap-2">
                  <div className="w-11 h-11 shrink-0 border-2 border-black flex items-center justify-center" style={{ backgroundColor: detail.color }}>
                    {owned ? <Check className="w-6 h-6" strokeWidth={3} /> : <Lock className="w-5 h-5 text-black/55" />}
                  </div>
                  <div className="min-w-0 flex-1"><span className="inline-block px-1 border border-black bg-[#D9A441] text-[8px] font-black">{KIND_NAME[item.reward.kind]}</span><h2 className="mt-1 text-[12px] sm:text-[14px] font-black leading-tight">{item.name}</h2><p className="text-[8px] font-bold text-black/55">{detail.detail}</p></div>
                </div>
                <p className="my-2 flex-1 text-[9px] sm:text-[10px] font-bold leading-relaxed">{item.description}</p>
                {owned ? <div className="border-2 border-black bg-[#D8CFB8] px-2 py-1 text-center text-[9px] font-black">{unlockSource(progress, key)}</div> : <button type="button" data-audio-cue="uiConfirm" disabled={!affordable} title={affordable ? undefined : `还差 ${item.medalCost - available} 枚勋章`} onClick={() => exchange(item)} className="comic-btn px-2 py-1 text-[10px] font-black disabled:opacity-45 disabled:cursor-not-allowed">兑换 · ● {item.medalCost}</button>}
              </article>
            })}
          </div>
        </main>
      </div>
    </div>
  )
}
