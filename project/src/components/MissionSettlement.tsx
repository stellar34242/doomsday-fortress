import { MODULE_DEFS, TURRET_DEFS } from '@/game/config'
import { playableVehicleDefs } from '@/game/unit'
import type { FortressDef } from '@/game/config'
import type { EquipmentUnlockRef, LevelLibraryEntry, LevelMedalSlot, LevelProgress } from '@/game/level'
import { hasLevelMedal, missionBriefingOf } from '@/game/level'
import { VehiclePreview } from '@/components/MissionBriefing'

const SLOTS: LevelMedalSlot[] = ['primary', 'secondary-1', 'secondary-2']

function formatTime(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds))
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`
}

function equipmentName(ref: EquipmentUnlockRef): string {
  if (ref.kind === 'fortress') return playableVehicleDefs().find(item => item.id === ref.id)?.name ?? ref.id
  if (ref.kind === 'turret') return TURRET_DEFS.find(item => item.id === ref.id)?.name ?? ref.id
  if (ref.kind === 'module') return MODULE_DEFS.find(item => item.id === ref.id)?.name ?? ref.id
  return ref.id
}

export default function MissionSettlement({
  won,
  entry,
  fortress,
  elapsedSeconds,
  kills,
  objectiveResults,
  progress,
  newlyEarned,
  newlyUnlocked,
  reward,
  nextLevelName,
  onReturn,
  onRetry,
  onNext,
}: {
  won: boolean
  entry: LevelLibraryEntry
  fortress: FortressDef
  elapsedSeconds: number
  kills: number
  objectiveResults: [boolean, boolean, boolean]
  progress: LevelProgress
  newlyEarned: LevelMedalSlot[]
  newlyUnlocked: EquipmentUnlockRef[]
  reward: number
  nextLevelName?: string
  onReturn: () => void
  onRetry: () => void
  onNext?: () => void
}) {
  const briefing = missionBriefingOf(entry)
  const goals = [briefing.primaryObjective, ...briefing.secondaryObjectives]
  const totalMedals = new Set([
    ...progress.medalIds,
    ...progress.completedIds.map(levelId => `${levelId}:primary`),
  ]).size
  return (
    <div className="absolute inset-0 z-[80] bg-[#D8CFB8] p-2 sm:p-4 font-comic select-none overflow-y-auto">
      <main className="relative min-h-full border-2 border-black p-2 sm:p-3 flex flex-col" aria-label="关卡结算">
        <header className="min-h-9 flex items-end justify-between gap-2 px-1 pb-2">
          <h1 className="text-[22px] sm:text-[28px] leading-none font-black">关卡结算</h1>
          <span className="text-[9px] sm:text-[11px] font-black truncate">{entry.name}</span>
        </header>

        <section className="grid grid-cols-[1.05fr_1.35fr] portrait:grid-cols-1 border-2 border-black bg-[#EFEBD8]">
          <div className={`min-h-[86px] px-4 py-3 flex flex-col justify-center border-r-2 portrait:border-r-0 portrait:border-b-2 border-black ${won ? 'bg-[#B3392E] text-[#EFEBD8]' : 'bg-[#4B4941] text-[#EFEBD8]'}`}>
            <strong className="text-[24px] sm:text-[30px] font-black tracking-wider">{won ? '任务完成' : '任务失败'}</strong>
            <span className="mt-1 text-[9px] sm:text-[11px] font-bold">{won ? '作战目标已完成，任务结果已经记录' : '主要目标未完成，本次不会获得关卡奖励'}</span>
          </div>
          <div className="grid grid-cols-2">
            <div className="flex flex-col justify-center items-center border-r border-black/40 p-2"><span className="text-[9px] font-bold text-black/55">任务用时</span><strong className="mt-1 text-[18px] sm:text-[22px] font-black">{formatTime(elapsedSeconds)}</strong></div>
            <div className="flex flex-col justify-center items-center p-2"><span className="text-[9px] font-bold text-black/55">消灭敌人</span><strong className="mt-1 text-[18px] sm:text-[22px] font-black">{kills}</strong></div>
          </div>
        </section>

        <div className="flex-1 min-h-0 mt-1.5 grid grid-cols-[minmax(145px,0.62fr)_minmax(280px,1.38fr)] portrait:grid-cols-1 gap-1.5">
          <section className="border-2 border-black min-h-[190px] flex flex-col bg-[#D8CFB8]">
            <h2 className="px-2 py-1 border-b-2 border-black bg-[#C9C29F] text-[11px] sm:text-[13px] font-black">本次出战车辆</h2>
            <div className="flex-1 min-h-0 p-2 flex flex-col items-center justify-center">
              <div className="w-full flex-1 min-h-[125px] border border-black bg-[#EFEBD8]">
                <VehiclePreview def={fortress} />
              </div>
              <strong className="mt-1 text-[11px] sm:text-[14px] font-black">{fortress.name}</strong>
            </div>
          </section>

          <section className="border-2 border-black min-h-[190px] flex flex-col bg-[#D8CFB8]">
            <h2 className="px-2 py-1 border-b-2 border-black bg-[#C9C29F] text-[11px] sm:text-[13px] font-black">任务目标结算</h2>
            <div className="flex-1 flex flex-col divide-y divide-black/35">
              {goals.map((goal, index) => {
                const slot = SLOTS[index]
                const completed = objectiveResults[index]
                const earned = hasLevelMedal(progress, entry.id, slot)
                const isNew = newlyEarned.includes(slot)
                return <div key={slot} className="flex-1 min-h-[50px] px-2 py-1 grid grid-cols-[68px_minmax(0,1fr)_50px_78px] items-center gap-1">
                  <span className={`w-max px-1 py-0.5 border border-black text-[8px] sm:text-[9px] font-black ${index === 0 ? 'bg-[#B3392E] text-[#EFEBD8]' : 'bg-[#C9C29F]'}`}>{index === 0 ? '主要目标' : '次要目标'}</span>
                  <span className="min-w-0 truncate text-[8px] sm:text-[10px] font-bold" title={goal}>{goal}</span>
                  <span className={`text-center text-[8px] sm:text-[10px] font-black ${completed ? 'text-[#2E6A3A]' : 'text-[#8A332E]'}`}>{completed ? '完成' : '未完成'}</span>
                  <span className={`justify-self-end px-1 py-0.5 border border-black text-[7px] sm:text-[8px] font-black ${isNew ? 'bg-[#D9A441]' : earned ? 'bg-[#EFEBD8] text-[#8A5A16]' : 'bg-[#C9C29F] text-black/45'}`}>{isNew ? '新勋章 ×1' : earned ? '已获得' : '未获得'}</span>
                </div>
              })}
            </div>
          </section>
        </div>

        <section className="mt-1.5 min-h-[42px] px-3 py-2 border-2 border-black bg-[#EFEBD8] grid grid-cols-[auto_1fr_auto_1fr] portrait:grid-cols-2 items-center gap-x-3 gap-y-1 text-[9px] sm:text-[11px] font-bold">
          <span className="font-black">本次奖励</span><span className="font-black text-[#8A5A16]">资源 +{reward}</span>
          <span className="font-black">勋章</span><span className="font-black text-[#8A5A16]">+{newlyEarned.length} · 累计 {totalMedals}</span>
        </section>

        {newlyUnlocked.length > 0 && <section className="mt-1.5 border-2 border-black bg-[#D9A441] px-3 py-2 text-[9px] sm:text-[11px] font-bold">
          <span className="mr-2 font-black">新装备解锁</span>
          {newlyUnlocked.map(ref => <span key={`${ref.kind}:${ref.id}`} className="mr-1 inline-block border border-black bg-[#EFEBD8] px-1.5 py-0.5">{ref.kind === 'fortress' ? '战车' : ref.kind === 'turret' ? '炮塔' : ref.kind === 'module' ? '模块' : ref.kind === 'paint' ? '涂装' : '徽记'} · {equipmentName(ref)}</span>)}
        </section>}

        <footer className="mt-2 grid grid-cols-[1fr_1fr_1.25fr] portrait:grid-cols-1 gap-2 sm:gap-4">
          <button type="button" data-audio-cue="uiCancel" onClick={onReturn} className="comic-btn min-h-10 text-[11px] sm:text-[14px] font-black">返回任务界面</button>
          <button type="button" data-audio-cue="uiConfirm" onClick={onRetry} className="comic-btn min-h-10 text-[11px] sm:text-[14px] font-black">重新挑战</button>
          <button type="button" data-audio-cue="uiConfirm" disabled={!won || !onNext} onClick={onNext} className="comic-btn min-h-10 bg-[#D9A441] text-[11px] sm:text-[14px] font-black disabled:opacity-40 disabled:cursor-not-allowed">{nextLevelName ? `下一关：${nextLevelName}` : '没有下一关'}</button>
        </footer>
      </main>
    </div>
  )
}
