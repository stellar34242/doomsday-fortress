import type { Ally, Enemy, GameState } from '../engine'
import { unitTypeConfig, type UnitDef } from '../unit'

const SQRT2 = Math.SQRT2
const TARGET_REFRESH_SECONDS = 0.25
const STUCK_SECONDS = 0.65
// 精确碰撞把“刚好贴边”也视作接触；导航额外留出少量余量，避免路点落在理论可过、运行时会卡住的格线上。
const STATIC_CLEARANCE = 0.06
const MAX_FIELD_CACHE = 48
const MAX_COMPONENT_CACHE = 24

export type NonCombatNavigationHost = Pick<Enemy,
  'id' | 'x' | 'y' | 'vehicle' | 'aircraft' | 'bossSizeScale'
  | 'behaviorNavGoalKey' | 'behaviorNavTargetCellX' | 'behaviorNavTargetCellY'
  | 'behaviorNavPathVersion' | 'behaviorNavRefreshWait' | 'behaviorNavStuckTime'
  | 'behaviorNavLastX' | 'behaviorNavLastY' | 'behaviorNavLastHeading'
  | 'behaviorNavRepathSerial' | 'behaviorNavUnreachable'
> | (Pick<Ally,
  'id' | 'x' | 'y' | 'vehicle' | 'aircraft'
  | 'behaviorNavGoalKey' | 'behaviorNavTargetCellX' | 'behaviorNavTargetCellY'
  | 'behaviorNavPathVersion' | 'behaviorNavRefreshWait' | 'behaviorNavStuckTime'
  | 'behaviorNavLastX' | 'behaviorNavLastY' | 'behaviorNavLastHeading'
  | 'behaviorNavRepathSerial' | 'behaviorNavUnreachable'
> & { bossSizeScale?: number })

export interface NonCombatNavigationDependencies {
  level: { cols: number; rows: number }
  unitRadiusToward: (unit: UnitDef, dx: number, dy: number) => number
  vehicleObjectClearanceHeight: (config: ReturnType<typeof unitTypeConfig>) => number
  blockerAt: (state: GameState, x: number, y: number, objectClearanceHeight?: number) => { kind: string; id: number } | null
}

export interface NonCombatNavigationStats {
  gridBuilds: number
  fieldBuilds: number
  fieldCacheHits: number
  componentBuilds: number
  componentCacheHits: number
}

interface NavigationGrid {
  key: string
  passable: Uint8Array
}

interface NavigationField {
  dist: Float64Array
}

function headingOf(host: NonCombatNavigationHost): number | undefined {
  return host.vehicle?.heading ?? host.aircraft?.heading
}

function boundedCacheSet<T>(cache: Map<string, T>, key: string, value: T, limit: number): void {
  if (cache.has(key)) cache.delete(key)
  cache.set(key, value)
  while (cache.size > limit) {
    const oldest = cache.keys().next().value as string | undefined
    if (oldest === undefined) break
    cache.delete(oldest)
  }
}

/**
 * 非战斗导航只负责提供前视路点：最终加速、转弯、倒车、碰撞与地形倍率仍由原底盘运动学处理。
 * 路径栅格忽略其他移动单位和玩家车体；它们继续由运行时实体分离解决，避免每帧重建路径。
 */
export function createNonCombatNavigator(deps: NonCombatNavigationDependencies) {
  const { level, unitRadiusToward, vehicleObjectClearanceHeight, blockerAt } = deps
  let cacheSession = Number.NaN
  let cacheVersion = Number.NaN
  const grids = new Map<string, NavigationGrid>()
  const fields = new Map<string, NavigationField>()
  const components = new Map<string, Uint8Array>()
  const stats: NonCombatNavigationStats = {
    gridBuilds: 0,
    fieldBuilds: 0,
    fieldCacheHits: 0,
    componentBuilds: 0,
    componentCacheHits: 0,
  }

  const indexOf = (x: number, y: number) => y * level.cols + x
  const inBounds = (x: number, y: number) => x >= 0 && x < level.cols && y >= 0 && y < level.rows

  function ensureVersion(state: GameState): void {
    const session = state.navigationSessionId ?? 0
    if (cacheSession === session && cacheVersion === state.pathVersion) return
    cacheSession = session
    cacheVersion = state.pathVersion
    grids.clear()
    fields.clear()
    components.clear()
  }

  function profileKey(unit: UnitDef, scale: number): string {
    const rx = unitRadiusToward(unit, 1, 0) * scale + STATIC_CLEARANCE
    const ry = unitRadiusToward(unit, 0, 1) * scale + STATIC_CLEARANCE
    const clearance = vehicleObjectClearanceHeight(unitTypeConfig(unit))
    return `${unit.id}:${rx.toFixed(3)}:${ry.toFixed(3)}:${clearance}`
  }

  function navigationGrid(state: GameState, unit: UnitDef, scale: number): NavigationGrid {
    ensureVersion(state)
    const key = profileKey(unit, scale)
    const cached = grids.get(key)
    if (cached) return cached

    const rx = Math.max(0.05, unitRadiusToward(unit, 1, 0) * scale + STATIC_CLEARANCE)
    const ry = Math.max(0.05, unitRadiusToward(unit, 0, 1) * scale + STATIC_CLEARANCE)
    const clearance = vehicleObjectClearanceHeight(unitTypeConfig(unit))
    const passable = new Uint8Array(level.cols * level.rows)
    for (let y = 0; y < level.rows; y++) for (let x = 0; x < level.cols; x++) {
      const centerX = x + 0.5, centerY = y + 0.5
      if (centerX - rx < 0 || centerX + rx > level.cols || centerY - ry < 0 || centerY + ry > level.rows) continue
      const x0 = Math.floor(centerX - rx)
      const x1 = Math.floor(centerX + rx - 1e-7)
      const y0 = Math.floor(centerY - ry)
      const y1 = Math.floor(centerY + ry - 1e-7)
      let blocked = false
      for (let cy = y0; cy <= y1 && !blocked; cy++) for (let cx = x0; cx <= x1; cx++) {
        const blocker = blockerAt(state, cx, cy, clearance)
        if (blocker && blocker.kind !== 'combatUnit' && blocker.kind !== 'fortress') { blocked = true; break }
      }
      if (!blocked) passable[indexOf(x, y)] = 1
    }
    const grid = { key, passable }
    grids.set(key, grid)
    stats.gridBuilds++
    return grid
  }

  function neighbors(grid: NavigationGrid, x: number, y: number): { x: number; y: number; cost: number }[] {
    const result: { x: number; y: number; cost: number }[] = []
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      if (ox === 0 && oy === 0) continue
      const nx = x + ox, ny = y + oy
      if (!inBounds(nx, ny) || grid.passable[indexOf(nx, ny)] === 0) continue
      if (ox !== 0 && oy !== 0) {
        if (grid.passable[indexOf(x + ox, y)] === 0 || grid.passable[indexOf(x, y + oy)] === 0) continue
      }
      result.push({ x: nx, y: ny, cost: ox !== 0 && oy !== 0 ? SQRT2 : 1 })
    }
    return result
  }

  function distanceField(state: GameState, unit: UnitDef, scale: number, targetX: number, targetY: number): NavigationField | null {
    const grid = navigationGrid(state, unit, scale)
    if (!inBounds(targetX, targetY) || grid.passable[indexOf(targetX, targetY)] === 0) return null
    const key = `${grid.key}:${targetX}:${targetY}`
    const cached = fields.get(key)
    if (cached) {
      fields.delete(key)
      fields.set(key, cached)
      stats.fieldCacheHits++
      return cached
    }

    const dist = new Float64Array(level.cols * level.rows)
    dist.fill(Infinity)
    const heapDistance: number[] = []
    const heapIndex: number[] = []
    const push = (distance: number, index: number) => {
      heapDistance.push(distance)
      heapIndex.push(index)
      let child = heapDistance.length - 1
      while (child > 0) {
        const parent = (child - 1) >> 1
        if (heapDistance[parent] <= heapDistance[child]) break
        ;[heapDistance[parent], heapDistance[child]] = [heapDistance[child], heapDistance[parent]]
        ;[heapIndex[parent], heapIndex[child]] = [heapIndex[child], heapIndex[parent]]
        child = parent
      }
    }
    const pop = (): { distance: number; index: number } | null => {
      if (heapDistance.length === 0) return null
      const result = { distance: heapDistance[0], index: heapIndex[0] }
      const lastDistance = heapDistance.pop()!
      const lastIndex = heapIndex.pop()!
      if (heapDistance.length > 0) {
        heapDistance[0] = lastDistance
        heapIndex[0] = lastIndex
        let parent = 0
        for (;;) {
          const left = parent * 2 + 1, right = left + 1
          let smallest = parent
          if (left < heapDistance.length && heapDistance[left] < heapDistance[smallest]) smallest = left
          if (right < heapDistance.length && heapDistance[right] < heapDistance[smallest]) smallest = right
          if (smallest === parent) break
          ;[heapDistance[parent], heapDistance[smallest]] = [heapDistance[smallest], heapDistance[parent]]
          ;[heapIndex[parent], heapIndex[smallest]] = [heapIndex[smallest], heapIndex[parent]]
          parent = smallest
        }
      }
      return result
    }

    const targetIndex = indexOf(targetX, targetY)
    dist[targetIndex] = 0
    push(0, targetIndex)
    for (;;) {
      const current = pop()
      if (!current) break
      if (current.distance > dist[current.index]) continue
      const x = current.index % level.cols
      const y = Math.floor(current.index / level.cols)
      for (const neighbor of neighbors(grid, x, y)) {
        const nextIndex = indexOf(neighbor.x, neighbor.y)
        const nextDistance = current.distance + neighbor.cost
        if (nextDistance + 1e-9 >= dist[nextIndex]) continue
        dist[nextIndex] = nextDistance
        push(nextDistance, nextIndex)
      }
    }

    const field = { dist }
    boundedCacheSet(fields, key, field, MAX_FIELD_CACHE)
    stats.fieldBuilds++
    return field
  }

  function componentFrom(state: GameState, unit: UnitDef, scale: number, startX: number, startY: number): Uint8Array {
    const grid = navigationGrid(state, unit, scale)
    const key = `${grid.key}:${startX}:${startY}`
    const cached = components.get(key)
    if (cached) {
      components.delete(key)
      components.set(key, cached)
      stats.componentCacheHits++
      return cached
    }
    const reached = new Uint8Array(level.cols * level.rows)
    if (!inBounds(startX, startY) || grid.passable[indexOf(startX, startY)] === 0) return reached
    const queueX = new Int16Array(level.cols * level.rows)
    const queueY = new Int16Array(level.cols * level.rows)
    let read = 0, write = 0
    queueX[write] = startX
    queueY[write++] = startY
    reached[indexOf(startX, startY)] = 1
    while (read < write) {
      const x = queueX[read], y = queueY[read++]
      for (const neighbor of neighbors(grid, x, y)) {
        const index = indexOf(neighbor.x, neighbor.y)
        if (reached[index]) continue
        reached[index] = 1
        queueX[write] = neighbor.x
        queueY[write++] = neighbor.y
      }
    }
    boundedCacheSet(components, key, reached, MAX_COMPONENT_CACHE)
    stats.componentBuilds++
    return reached
  }

  function isReachable(
    state: GameState, host: NonCombatNavigationHost, unit: UnitDef,
    fromX: number, fromY: number, targetX: number, targetY: number,
  ): boolean {
    if (unit.stats.air) return true
    const scale = host.bossSizeScale ?? 1
    const sx = Math.max(0, Math.min(level.cols - 1, Math.floor(fromX)))
    const sy = Math.max(0, Math.min(level.rows - 1, Math.floor(fromY)))
    const tx = Math.max(0, Math.min(level.cols - 1, Math.floor(targetX)))
    const ty = Math.max(0, Math.min(level.rows - 1, Math.floor(targetY)))
    return componentFrom(state, unit, scale, sx, sy)[indexOf(tx, ty)] === 1
  }

  function linePassable(grid: NavigationGrid, fromX: number, fromY: number, toX: number, toY: number): boolean {
    const distance = Math.hypot(toX - fromX, toY - fromY)
    const samples = Math.max(1, Math.ceil(distance / 0.2))
    let previousX = Math.floor(fromX), previousY = Math.floor(fromY)
    for (let sample = 1; sample <= samples; sample++) {
      const progress = sample / samples
      const cellX = Math.floor(fromX + (toX - fromX) * progress)
      const cellY = Math.floor(fromY + (toY - fromY) * progress)
      if (!inBounds(cellX, cellY) || grid.passable[indexOf(cellX, cellY)] === 0) return false
      if (cellX !== previousX && cellY !== previousY) {
        if (!inBounds(cellX, previousY) || !inBounds(previousX, cellY)) return false
        if (grid.passable[indexOf(cellX, previousY)] === 0 || grid.passable[indexOf(previousX, cellY)] === 0) return false
      }
      previousX = cellX
      previousY = cellY
    }
    return true
  }

  function noteProgress(host: NonCombatNavigationHost, dt: number, speed: number): boolean {
    const heading = headingOf(host)
    if (host.behaviorNavLastX === undefined || host.behaviorNavLastY === undefined) {
      host.behaviorNavLastX = host.x
      host.behaviorNavLastY = host.y
      host.behaviorNavLastHeading = heading
      host.behaviorNavStuckTime = 0
      return false
    }
    const moved = Math.hypot(host.x - host.behaviorNavLastX, host.y - host.behaviorNavLastY)
    const turned = heading !== undefined && host.behaviorNavLastHeading !== undefined
      ? Math.abs(heading - host.behaviorNavLastHeading) > 0.002
      : false
    const progressed = moved > Math.max(0.002, speed * dt * 0.02) || turned
    host.behaviorNavStuckTime = progressed ? 0 : (host.behaviorNavStuckTime ?? 0) + dt
    host.behaviorNavLastX = host.x
    host.behaviorNavLastY = host.y
    host.behaviorNavLastHeading = heading
    if ((host.behaviorNavStuckTime ?? 0) < STUCK_SECONDS) return false
    host.behaviorNavStuckTime = 0
    host.behaviorNavRepathSerial = (host.behaviorNavRepathSerial ?? 0) + 1
    host.behaviorNavRefreshWait = 0
    return true
  }

  function reset(host: NonCombatNavigationHost): void {
    host.behaviorNavGoalKey = undefined
    host.behaviorNavTargetCellX = undefined
    host.behaviorNavTargetCellY = undefined
    host.behaviorNavPathVersion = undefined
    host.behaviorNavRefreshWait = undefined
    host.behaviorNavStuckTime = undefined
    host.behaviorNavLastX = undefined
    host.behaviorNavLastY = undefined
    host.behaviorNavLastHeading = undefined
    host.behaviorNavRepathSerial = undefined
    host.behaviorNavUnreachable = undefined
  }

  function waypoint(
    state: GameState, host: NonCombatNavigationHost, unit: UnitDef,
    targetX: number, targetY: number, goalKey: string, dt: number, speed: number,
  ): { x: number; y: number } | null {
    if (unit.stats.air) {
      reset(host)
      return { x: targetX, y: targetY }
    }
    const forcedRefresh = noteProgress(host, dt, speed)
    host.behaviorNavRefreshWait = Math.max(0, (host.behaviorNavRefreshWait ?? 0) - dt)
    const requestedTargetX = Math.max(0, Math.min(level.cols - 1, Math.floor(targetX)))
    const requestedTargetY = Math.max(0, Math.min(level.rows - 1, Math.floor(targetY)))
    const goalChanged = host.behaviorNavGoalKey !== goalKey
    const targetCellChanged = requestedTargetX !== host.behaviorNavTargetCellX || requestedTargetY !== host.behaviorNavTargetCellY
    const shouldRefresh = goalChanged || forcedRefresh || host.behaviorNavPathVersion !== state.pathVersion
      || host.behaviorNavTargetCellX === undefined || host.behaviorNavTargetCellY === undefined
      || (targetCellChanged && (host.behaviorNavRefreshWait ?? 0) <= 0)
    if (shouldRefresh) {
      host.behaviorNavGoalKey = goalKey
      host.behaviorNavTargetCellX = requestedTargetX
      host.behaviorNavTargetCellY = requestedTargetY
      host.behaviorNavPathVersion = state.pathVersion
      host.behaviorNavRefreshWait = TARGET_REFRESH_SECONDS
      host.behaviorNavUnreachable = false
    }

    const targetCellX = host.behaviorNavTargetCellX ?? requestedTargetX
    const targetCellY = host.behaviorNavTargetCellY ?? requestedTargetY
    const scale = host.bossSizeScale ?? 1
    const grid = navigationGrid(state, unit, scale)
    const field = distanceField(state, unit, scale, targetCellX, targetCellY)
    const currentX = Math.max(0, Math.min(level.cols - 1, Math.floor(host.x)))
    const currentY = Math.max(0, Math.min(level.rows - 1, Math.floor(host.y)))
    if (!field || !Number.isFinite(field.dist[indexOf(currentX, currentY)])) {
      host.behaviorNavUnreachable = true
      return null
    }
    host.behaviorNavUnreachable = false

    if (currentX === targetCellX && currentY === targetCellY) return { x: targetX, y: targetY }
    const chain: { x: number; y: number }[] = []
    let cellX = currentX, cellY = currentY
    for (let lookahead = 0; lookahead < 5; lookahead++) {
      const currentDistance = field.dist[indexOf(cellX, cellY)]
      const candidates = neighbors(grid, cellX, cellY)
        .map(cell => ({ ...cell, distance: field.dist[indexOf(cell.x, cell.y)] }))
        .filter(cell => Number.isFinite(cell.distance) && cell.distance < currentDistance - 1e-6)
        .sort((a, b) => a.distance - b.distance || a.y - b.y || a.x - b.x)
      if (candidates.length === 0) break
      const bestDistance = candidates[0].distance
      const alternatives = candidates.filter(candidate => candidate.distance <= bestDistance + 0.45)
      const serial = lookahead === 0 ? host.behaviorNavRepathSerial ?? 0 : 0
      const next = alternatives[Math.abs(host.id + serial) % alternatives.length]
      chain.push({ x: next.x + 0.5, y: next.y + 0.5 })
      cellX = next.x
      cellY = next.y
      if (cellX === targetCellX && cellY === targetCellY) break
    }
    if (chain.length === 0) return null

    let selected = chain[0]
    for (const candidate of chain) {
      if (!linePassable(grid, host.x, host.y, candidate.x, candidate.y)) break
      selected = candidate
    }
    if (cellX === targetCellX && cellY === targetCellY && linePassable(grid, host.x, host.y, targetX, targetY)) {
      selected = { x: targetX, y: targetY }
    }
    return selected
  }

  return {
    waypoint,
    isReachable,
    reset,
    stats: () => ({ ...stats }),
  }
}
