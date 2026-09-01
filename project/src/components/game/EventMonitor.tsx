import type { GameState } from '@/game/engine'
import { LEVEL } from '@/game/level'
import type { LevelEventAction } from '@/game/level'

const ACTION_NAME: Record<LevelEventAction['type'], string> = {
  wait: '等待', spawn: '刷出敌群', boss: 'Boss', message: '任务提示', dialogue: '对话', text: '画面文本', camera: '镜头转移', choice: '选择', assembly: '装配', sound: '播放音效', music: '切换 BGM', reward: '资源奖励', levelVariable: '关卡变量', globalVariable: '全局变量', setEventEnabled: '启用/禁用事件', callEvent: '调用事件', setObjectState: '物体状态', supply: '增减补给', functionalArea: '功能区域', stageJump: '任务阶段跳转', taskResult: '任务结果', unit: '单位指令',
}

export default function EventMonitor({ game }: { game: GameState }) {
  return <section aria-label="事件监视器" className="combat-event-monitor absolute z-[45] overflow-auto comic-panel bg-[#D2CCA9]/95 p-2 text-[8px]">
    <div className="mb-1 flex items-center border-b border-black/40 pb-1"><strong className="font-comic text-[11px]">事件监视器</strong><span className="ml-auto text-black/50">运行 {game.eventQueue.length} · 记录 {game.eventDebugLog?.length ?? 0}</span></div>
    <div className="mb-2 grid grid-cols-2 gap-1">{LEVEL.events.map(event => {
      const runtime = game.unifiedEventStates.find(item => item.id === event.id)
      return <div key={event.id} className="border border-black/20 px-1 py-0.5">
        <div className="flex font-black"><span className="truncate">{event.name}</span><span className={`ml-auto ${runtime?.conditionPassed ? 'text-[#3E7D46]' : 'text-black/45'}`}>{runtime?.conditionPassed ? '条件通过' : '条件未通过'}</span></div>
        <div className="text-black/50">触发 {runtime?.activations ?? 0} 次 · 调用 {runtime?.callActivations ?? 0} 次{runtime?.lastBlockReason ? ` · ${runtime.lastBlockReason}` : ''}</div>
      </div>
    })}</div>
    <div className="mb-2 space-y-1">{game.eventQueue.length === 0 ? <div className="font-bold text-black/45">当前没有执行中的事件</div> : game.eventQueue.map(sequence => {
      const action = sequence.actions[sequence.index]
      const event = sequence.eventRuntimeId && sequence.eventRuntimeId > 0 ? LEVEL.events.find(item => item.id === sequence.eventRuntimeId) : undefined
      const waiting = sequence.waitLeft > 0 ? `等待 ${sequence.waitLeft.toFixed(1)}s` : sequence.waitingChildSequenceId !== undefined ? '等待被调用事件' : game.eventChoice?.sequenceId === sequence.id ? '等待玩家选择' : game.eventAssembly?.sequenceId === sequence.id ? '等待装配完成' : '执行中'
      return <div key={sequence.id} className="border border-black/25 bg-black/[0.03] p-1"><div className="flex font-black"><span>{event?.name ?? '局部事件'}</span><span className="ml-auto">{waiting}</span></div><div className="text-black/55">动作 {sequence.index + 1}/{sequence.actions.length} · {action ? ACTION_NAME[action.type] : '完成'}</div></div>
    })}</div>
    <div className="space-y-0.5">{(game.eventDebugLog ?? []).slice(-20).reverse().map(log => <div key={log.id} className="grid grid-cols-[42px_1fr] gap-1 border-t border-black/15 pt-0.5"><span className="text-black/45">{log.time.toFixed(1)}s</span><span><b>{log.eventName}</b> · {log.detail}</span></div>)}</div>
  </section>
}
