// RPG Maker XP Autotile（96×128）纯逻辑：48 变体 quarter 映射 + 3×3 邻居分类。
// 规则来源：RMXP/RGSS Tilemap —— 96×128 帧切为 6×8 个 16×16 quarter（编号 1–48），
// 每个 32×32 逻辑格由 4 个 quarter 拼成；变体索引由同层 8 邻居决定（角邻居仅在两正交边同层时参与）。

/** quarter 映射表：48 个变体 × [左上, 右上, 左下, 右下]，元素为 1–48 的 quarter 编号 */
export const RMXP_SUBTILES: readonly (readonly number[])[] = [
  [27, 28, 33, 34], [5, 28, 33, 34], [27, 6, 33, 34], [5, 6, 33, 34],
  [27, 28, 33, 12], [5, 28, 33, 12], [27, 6, 33, 12], [5, 6, 33, 12],
  [27, 28, 11, 34], [5, 28, 11, 34], [27, 6, 11, 34], [5, 6, 11, 34],
  [27, 28, 11, 12], [5, 28, 11, 12], [27, 6, 11, 12], [5, 6, 11, 12],
  [25, 26, 31, 32], [25, 6, 31, 32], [25, 26, 31, 12], [25, 6, 31, 12],
  [15, 16, 21, 22], [15, 16, 21, 12], [15, 16, 11, 22], [15, 16, 11, 12],
  [29, 30, 35, 36], [29, 30, 11, 36], [5, 30, 35, 36], [5, 30, 11, 36],
  [39, 40, 45, 46], [5, 40, 45, 46], [39, 6, 45, 46], [5, 6, 45, 46],
  [25, 30, 31, 36], [15, 16, 45, 46], [13, 14, 19, 20], [13, 14, 19, 12],
  [17, 18, 23, 24], [17, 18, 11, 24], [41, 42, 47, 48], [5, 42, 47, 48],
  [37, 38, 43, 44], [37, 6, 43, 44], [13, 18, 19, 24], [13, 14, 43, 44],
  [37, 42, 43, 48], [17, 18, 47, 48], [13, 18, 43, 48], [1, 2, 7, 8],
]

type P = 0 | 1 | null // null = 通配（该方向不参与匹配）
/** 3×3 邻居模式表（行主序 [NW,N,NE,W,C,E,SW,S,SE]，C 恒为 null 通配） */
const NEIGHBOR_PATTERNS: readonly (readonly P[])[] = [
  [1, 1, 1, 1, null, 1, 1, 1, 1], [0, 1, 1, 1, null, 1, 1, 1, 1],
  [1, 1, 0, 1, null, 1, 1, 1, 1], [0, 1, 0, 1, null, 1, 1, 1, 1],
  [1, 1, 1, 1, null, 1, 1, 1, 0], [0, 1, 1, 1, null, 1, 1, 1, 0],
  [1, 1, 0, 1, null, 1, 1, 1, 0], [0, 1, 0, 1, null, 1, 1, 1, 0],
  [1, 1, 1, 1, null, 1, 0, 1, 1], [0, 1, 1, 1, null, 1, 0, 1, 1],
  [1, 1, 0, 1, null, 1, 0, 1, 1], [0, 1, 0, 1, null, 1, 0, 1, 1],
  [1, 1, 1, 1, null, 1, 0, 1, 0], [0, 1, 1, 1, null, 1, 0, 1, 0],
  [1, 1, 0, 1, null, 1, 0, 1, 0], [0, 1, 0, 1, null, 1, 0, 1, 0],
  [null, 1, 1, 0, null, 1, null, 1, 1], [null, 1, 0, 0, null, 1, null, 1, 1],
  [null, 1, 1, 0, null, 1, null, 1, 0], [null, 1, 0, 0, null, 1, null, 1, 0],
  [null, 0, null, 1, null, 1, 1, 1, 1], [null, 0, null, 1, null, 1, 1, 1, 0],
  [null, 0, null, 1, null, 1, 0, 1, 1], [null, 0, null, 1, null, 1, 0, 1, 0],
  [1, 1, null, 1, null, 0, 1, 1, null], [1, 1, null, 1, null, 0, 0, 1, null],
  [0, 1, null, 1, null, 0, 1, 1, null], [0, 1, null, 1, null, 0, 0, 1, null],
  [1, 1, 1, 1, null, 1, null, 0, null], [0, 1, 1, 1, null, 1, null, 0, null],
  [1, 1, 0, 1, null, 1, null, 0, null], [0, 1, 0, 1, null, 1, null, 0, null],
  [null, 1, null, 0, null, 0, null, 1, null], [null, 0, null, 1, null, 1, null, 0, null],
  [null, 0, null, 0, null, 1, null, 1, 1], [null, 0, null, 0, null, 1, null, 1, 0],
  [null, 0, null, 1, null, 0, 1, 1, null], [null, 0, null, 1, null, 0, 0, 1, null],
  [1, 1, null, 1, null, 0, null, 0, null], [0, 1, null, 1, null, 0, null, 0, null],
  [null, 1, 1, 0, null, 1, null, 0, null], [null, 1, 0, 0, null, 1, null, 0, null],
  [null, 0, null, 0, null, 0, null, 1, null], [null, 0, null, 0, null, 1, null, 0, null],
  [null, 1, null, 0, null, 0, null, 0, null], [null, 0, null, 1, null, 0, null, 0, null],
  [null, 0, null, 0, null, 0, null, 0, null],
]

const key = (x: number, y: number) => `${x},${y}`

/**
 * RMXP Autotile 变体索引（0–47）。
 * cells：同层格集合；界外按非本层处理。角邻居仅在两条相邻正交边均为本层时参与，
 * 否则置为通配（等价 RMXP 编辑器对“缺边侧角”的忽略规则）。
 */
export function rmxpAutotileIndex(cells: ReadonlySet<string>, x: number, y: number): number {
  const n = cells.has(key(x, y - 1)) ? 1 : 0
  const s = cells.has(key(x, y + 1)) ? 1 : 0
  const w = cells.has(key(x - 1, y)) ? 1 : 0
  const e = cells.has(key(x + 1, y)) ? 1 : 0
  const nw: P = n && w ? (cells.has(key(x - 1, y - 1)) ? 1 : 0) : null
  const ne: P = n && e ? (cells.has(key(x + 1, y - 1)) ? 1 : 0) : null
  const sw: P = s && w ? (cells.has(key(x - 1, y + 1)) ? 1 : 0) : null
  const se: P = s && e ? (cells.has(key(x + 1, y + 1)) ? 1 : 0) : null
  const q: readonly P[] = [nw, n, ne, w, null, e, sw, s, se]
  for (let i = 0; i < NEIGHBOR_PATTERNS.length; i++) {
    const p = NEIGHBOR_PATTERNS[i]
    let ok = true
    for (let j = 0; j < 9; j++) {
      if (q[j] === null || p[j] === null) continue
      if (q[j] !== p[j]) { ok = false; break }
    }
    if (ok) return i
  }
  return 46 // 理论不可达（角通配后 48 模式完备）；兜底孤立块
}

/** quarter 源坐标（96×128 帧、16×16 quarter、6 列）：返回 [sx, sy] */
export function rmxpQuarterSrc(piece: number): readonly [number, number] {
  const p = piece - 1
  return [(p % 6) * 16, Math.floor(p / 6) * 16]
}
