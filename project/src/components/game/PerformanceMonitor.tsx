import { useEffect, useRef, useSyncExternalStore } from 'react'
import type { PerformanceMonitorOptions } from '@/game/gameParameters'
import { performanceMonitorSnapshot, subscribePerformanceMonitor } from '@/game/performanceMonitor'
import type { PerformanceMonitorSnapshot } from '@/game/performanceMonitor'

const metric = (value: number) => Number.isFinite(value) ? value.toFixed(2) : '0.00'
const integer = (value: number) => Number.isFinite(value) ? Math.round(value) : 0

function bottleneckOf(snapshot: PerformanceMonitorSnapshot): { label: string; value: number } {
  const engine = snapshot.engine
  return [
    { label: '画布绘制', value: snapshot.drawMs },
    { label: '友方 AI', value: engine.allyAiMs },
    { label: '敌方 AI', value: engine.enemyAiMs },
    { label: '碰撞', value: engine.collisionMs },
    { label: '索敌与武器', value: engine.targetingWeaponsMs },
    { label: '弹丸', value: engine.projectileMs },
    { label: '事件', value: engine.eventMs },
  ].reduce((largest, item) => item.value > largest.value ? item : largest)
}

function FrameHistory({ snapshot }: { snapshot: PerformanceMonitorSnapshot }) {
  const width = 252
  const height = 54
  const points = snapshot.history
  if (points.length < 2) return <div className="h-[54px] flex items-center justify-center border border-[#EFEBD8]/20 text-[8px] text-[#EFEBD8]/55">正在采样曲线…</div>
  return <FrameHistoryCanvas snapshot={snapshot} width={width} height={height} />
}

/** 500ms 更新时只重绘一张小画布，避免反复创建 SVG 折线节点及透明图层合成。 */
function FrameHistoryCanvas({ snapshot, width, height }: { snapshot: PerformanceMonitorSnapshot; width: number; height: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context || snapshot.history.length < 2) return
    const points = snapshot.history
    const pixelRatio = Math.min(2, Math.max(1, window.devicePixelRatio || 1))
    const bitmapWidth = Math.round(width * pixelRatio)
    const bitmapHeight = Math.round(height * pixelRatio)
    if (canvas.width !== bitmapWidth || canvas.height !== bitmapHeight) {
      canvas.width = bitmapWidth
      canvas.height = bitmapHeight
    }
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
    context.clearRect(0, 0, width, height)
    let ceiling = 33.3
    for (const point of points) if (point.frameMs > ceiling) ceiling = point.frameMs
    const firstSecond = points[0].second
    const span = Math.max(1, points[points.length - 1].second - firstSecond)
    const budgetY = height - Math.min(1, 16.7 / ceiling) * height
    context.save()
    context.strokeStyle = '#D9A441'
    context.globalAlpha = 0.7
    context.lineWidth = 1
    context.setLineDash([3, 3])
    context.beginPath()
    context.moveTo(0, budgetY)
    context.lineTo(width, budgetY)
    context.stroke()
    context.restore()
    context.strokeStyle = '#EFEBD8'
    context.lineWidth = 1.5
    context.beginPath()
    for (let index = 0; index < points.length; index++) {
      const point = points[index]
      const x = (point.second - firstSecond) / span * width
      const y = height - Math.min(1, point.frameMs / ceiling) * height
      if (index === 0) context.moveTo(x, y); else context.lineTo(x, y)
    }
    context.stroke()
  }, [height, snapshot.history, width])
  return <canvas ref={canvasRef} className="block h-[54px] w-full border border-[#EFEBD8]/20" role="img" aria-label="最近60秒帧耗时曲线" />
}

export default function PerformanceMonitor({ options }: { options: PerformanceMonitorOptions }) {
  const snapshot = useSyncExternalStore(subscribePerformanceMonitor, performanceMonitorSnapshot, performanceMonitorSnapshot)
  const engine = snapshot?.engine
  const bottleneck = snapshot ? bottleneckOf(snapshot) : null
  return <section aria-label="性能监控" className="combat-performance-monitor pointer-events-auto absolute z-30 border-2 border-black bg-[#1A1A18] px-2 py-1 font-mono text-[8px] leading-tight text-[#EFEBD8] [contain:layout_paint]">
    <div className="mb-1 flex items-center border-b border-[#EFEBD8]/25 pb-1 font-comic text-[10px] font-black">
      <span>性能监控</span><span className="ml-auto text-[8px] font-bold text-[#EFEBD8]/60">500ms · 近60s</span>
    </div>
    {!snapshot || !engine ? <div className="py-2 text-center text-[#EFEBD8]/60">等待战斗采样…</div> : <div className="space-y-1">
      {(options.fps || options.frameTime) && <div className="grid grid-cols-2 gap-x-2">
        {options.fps && <div><b>FPS</b> {integer(snapshot.fps)} <span className="text-[#EFEBD8]/55">均{integer(snapshot.fpsAverage)} 低{integer(snapshot.fpsMin)}</span></div>}
        {options.frameTime && <div><b>帧</b> {metric(snapshot.frameMs)}ms <span className="text-[#EFEBD8]/55">峰{metric(snapshot.frameMaxMs)}</span></div>}
      </div>}
      {(options.drawTime || options.tickTime) && <div className="grid grid-cols-2 gap-x-2">
        {options.drawTime && <div><b>绘制</b> {metric(snapshot.drawMs)}ms <span className="text-[#EFEBD8]/55">峰{metric(snapshot.drawMaxMs)}</span></div>}
        {options.tickTime && <div><b>逻辑</b> {metric(snapshot.tickMs)}ms <span className="text-[#EFEBD8]/55">峰{metric(snapshot.tickMaxMs)}</span></div>}
      </div>}
      {options.engineBreakdown && <div className="border-t border-[#EFEBD8]/20 pt-1">
        <div className="mb-0.5 font-bold text-[#D9A441]">引擎分项（ms）</div>
        <div className="grid grid-cols-3 gap-x-2 gap-y-0.5">
          <span>友AI {metric(engine.allyAiMs)}</span><span>敌AI {metric(engine.enemyAiMs)}</span><span>碰撞 {metric(engine.collisionMs)}</span>
          <span>索敌 {metric(engine.targetingWeaponsMs)}</span><span>弹丸 {metric(engine.projectileMs)}</span><span>事件 {metric(engine.eventMs)}</span>
        </div>
      </div>}
      {options.sceneCounts && <div className="border-t border-[#EFEBD8]/20 pt-1"><b>场景</b> 敌{engine.enemies} · 友{engine.allies} · 弹丸{engine.projectiles}</div>}
      {options.spatialIndex && <div className="border-t border-[#EFEBD8]/20 pt-1"><b>空间索引</b> 查询{engine.spatialQueries} · 候选{engine.spatialCandidates}<br />碰撞组合{engine.collisionPairs} · 暴力组合{engine.collisionBruteForcePairs}</div>}
      {options.hitchCounts && <div className="border-t border-[#EFEBD8]/20 pt-1"><b>超时帧</b> &gt;16.7ms {snapshot.hitchOver16} · &gt;33.3ms {snapshot.hitchOver33} · &gt;50ms {snapshot.hitchOver50}</div>}
      {options.bottleneck && bottleneck && <div className="border-t border-[#EFEBD8]/20 pt-1"><b className="text-[#D9A441]">主要消耗</b> {bottleneck.label} {metric(bottleneck.value)}ms</div>}
      {options.history && <FrameHistory snapshot={snapshot} />}
    </div>}
  </section>
}
