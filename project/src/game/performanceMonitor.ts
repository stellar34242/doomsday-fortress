import type { EnginePerformanceSnapshot } from './engine'

export const PERFORMANCE_MONITOR_PUBLISH_MS = 500
export const PERFORMANCE_MONITOR_HISTORY_SECONDS = 60

export interface PerformanceHistoryPoint {
  second: number
  frameMs: number
}

export interface PerformanceMonitorSnapshot {
  samples: number
  fps: number
  fpsAverage: number
  fpsMin: number
  frameMs: number
  frameAverageMs: number
  frameMaxMs: number
  drawMs: number
  drawMaxMs: number
  tickMs: number
  tickMaxMs: number
  hitchOver16: number
  hitchOver33: number
  hitchOver50: number
  history: PerformanceHistoryPoint[]
  engine: EnginePerformanceSnapshot
}

export interface PerformanceFrameMeasurement {
  frameMs: number
  drawMs: number
  drawMaxMs: number
  tickMs: number
  tickMaxMs: number
  engine: EnginePerformanceSnapshot
}

export interface PerformanceMonitorAccumulator {
  samples: number
  activeMs: number
  totalFrames: number
  totalFrameMs: number
  frameMaxMs: number
  fpsMin: number
  windowFrames: number
  windowFrameMs: number
  hitchOver16: number
  hitchOver33: number
  hitchOver50: number
  history: PerformanceHistoryPoint[]
}

let currentSnapshot: PerformanceMonitorSnapshot | null = null
const snapshotListeners = new Set<() => void>()

export function performanceMonitorSnapshot(): PerformanceMonitorSnapshot | null { return currentSnapshot }

export function subscribePerformanceMonitor(listener: () => void): () => void {
  snapshotListeners.add(listener)
  return () => snapshotListeners.delete(listener)
}

export function publishPerformanceMonitor(snapshot: PerformanceMonitorSnapshot): void {
  currentSnapshot = snapshot
  for (const listener of snapshotListeners) listener()
}

export function resetPerformanceMonitorSnapshot(): void {
  currentSnapshot = null
  for (const listener of snapshotListeners) listener()
}

export function createPerformanceMonitorAccumulator(): PerformanceMonitorAccumulator {
  return {
    samples: 0,
    activeMs: 0,
    totalFrames: 0,
    totalFrameMs: 0,
    frameMaxMs: 0,
    fpsMin: Number.POSITIVE_INFINITY,
    windowFrames: 0,
    windowFrameMs: 0,
    hitchOver16: 0,
    hitchOver33: 0,
    hitchOver50: 0,
    history: [],
  }
}

/**
 * 只累计实际战斗画面帧；暂停、DEBUG 与任务界面不调用本函数，因此不会把暂停时间误算成卡顿。
 * 每约 500ms 返回一次可供 React 显示的快照，其余帧返回 null。
 */
export function recordPerformanceFrame(
  accumulator: PerformanceMonitorAccumulator,
  measurement: PerformanceFrameMeasurement,
): PerformanceMonitorSnapshot | null {
  const frameMs = Math.max(0.01, Math.min(1000, measurement.frameMs))
  accumulator.activeMs += frameMs
  accumulator.totalFrames++
  accumulator.totalFrameMs += frameMs
  accumulator.frameMaxMs = Math.max(accumulator.frameMaxMs, frameMs)
  accumulator.windowFrames++
  accumulator.windowFrameMs += frameMs
  if (frameMs > 16.7) accumulator.hitchOver16++
  if (frameMs > 33.3) accumulator.hitchOver33++
  if (frameMs > 50) accumulator.hitchOver50++

  if (accumulator.windowFrameMs < PERFORMANCE_MONITOR_PUBLISH_MS) return null

  const fps = accumulator.windowFrames * 1000 / accumulator.windowFrameMs
  accumulator.fpsMin = Math.min(accumulator.fpsMin, fps)
  const frameAverage = accumulator.windowFrameMs / accumulator.windowFrames
  accumulator.samples++
  accumulator.history.push({ second: accumulator.activeMs / 1000, frameMs: frameAverage })
  const cutoff = accumulator.activeMs / 1000 - PERFORMANCE_MONITOR_HISTORY_SECONDS
  while (accumulator.history[0]?.second < cutoff) accumulator.history.shift()
  accumulator.windowFrames = 0
  accumulator.windowFrameMs = 0

  return {
    samples: accumulator.samples,
    fps,
    fpsAverage: accumulator.totalFrames * 1000 / accumulator.totalFrameMs,
    fpsMin: accumulator.fpsMin,
    frameMs: frameAverage,
    frameAverageMs: accumulator.totalFrameMs / accumulator.totalFrames,
    frameMaxMs: accumulator.frameMaxMs,
    drawMs: measurement.drawMs,
    drawMaxMs: measurement.drawMaxMs,
    tickMs: measurement.tickMs,
    tickMaxMs: measurement.tickMaxMs,
    hitchOver16: accumulator.hitchOver16,
    hitchOver33: accumulator.hitchOver33,
    hitchOver50: accumulator.hitchOver50,
    history: [...accumulator.history],
    engine: { ...measurement.engine },
  }
}
