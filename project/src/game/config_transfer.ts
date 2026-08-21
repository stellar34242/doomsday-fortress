/** 配置导出/导入：口令串（base64，跨设备搬运）+ v2.18 本地文件夹 JSON（td-config.json，便于直接编辑）。
 *  口令 = base64(JSON(bundle))，unicode 安全（TextEncoder/TextDecoder + 纯 JS base64，无 btoa/Buffer 环境依赖）。
 *  导入保证：先完整解析+形状校验，全部通过后才就地替换注册表并落盘（任何一步失败不写坏现有数据）。 */
import { applyMountFoot, MODULE_DEFS, PROJECTILE_ARTS, TURRET_DEFS } from './config'
import type { ModuleDef, ProjectileArtDef, TurretDef } from './config'
import { LEVEL, mergeBaseCells, ROWS_MIN, saveLevel } from './level'
import type { LevelConfig } from './level'
import { fortressLibForExport, importFortressLib, saveAll } from './persist'
import type { FortressLibData } from './persist'
import { importUploads, uploadsForExport } from './assetlib'
import type { UploadData } from './assetlib'

interface ConfigBundle {
  app: 'td-config'
  version: number // 2 起含 assets（素材库上传条目）；3 起含 fortressLib（堡垒类型库）；4 起含 moduleDefs（模块库）；低版本口令导入时对应数据不动
  turretDefs: TurretDef[]
  projectileArts: ProjectileArtDef[]
  level: LevelConfig
  assets?: UploadData[]
  fortressLib?: FortressLibData
  moduleDefs?: ModuleDef[] // v2.30
}

// ---- 纯 JS base64（unicode 安全：UTF-8 字节 ⇄ base64）----
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

export function encodeBase64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : -1
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : -1
    out += B64[b0 >> 2]
    out += B64[((b0 & 3) << 4) | (b1 >= 0 ? b1 >> 4 : 0)]
    out += b1 >= 0 ? B64[((b1 & 15) << 2) | (b2 >= 0 ? b2 >> 6 : 0)] : '='
    out += b2 >= 0 ? B64[b2 & 63] : '='
  }
  return out
}

export function decodeBase64(b64: string): string {
  const s = b64.replace(/\s+/g, '') // 容忍粘贴带入的空白/换行
  if (s.length % 4 !== 0) throw new Error('bad base64 length')
  const bytes: number[] = []
  for (let i = 0; i < s.length; i += 4) {
    const v = [...s.slice(i, i + 4)].map(c => (c === '=' ? -1 : B64.indexOf(c)))
    if (v[0] < 0 || v[1] < 0) throw new Error('bad base64 char')
    bytes.push((v[0] << 2) | (v[1] >> 4))
    if (v[2] >= 0) bytes.push(((v[1] & 15) << 4) | (v[2] >> 2))
    if (v[3] >= 0) bytes.push(((v[2] & 3) << 6) | v[3])
  }
  return new TextDecoder().decode(new Uint8Array(bytes))
}

/** 当前全部 debug 配置打包（调用时实时取注册表现状） */
function buildBundle(): ConfigBundle {
  return {
    app: 'td-config',
    version: 4,
    turretDefs: TURRET_DEFS,
    projectileArts: PROJECTILE_ARTS,
    level: LEVEL,
    assets: uploadsForExport(),
    fortressLib: fortressLibForExport(),
    moduleDefs: MODULE_DEFS,
  }
}

/** 导出当前全部 debug 配置为口令串 */
export function exportConfig(): string {
  return encodeBase64(JSON.stringify(buildBundle()))
}

/** v2.18：导出为美化 JSON（本地文件夹 td-config.json 用，便于直接编辑） */
export function exportConfigJson(): string {
  return JSON.stringify(buildBundle(), null, 2)
}

/** 形状校验（纯校验，不落盘）：形状全对才返回 bundle */
function validateBundleShape(o: unknown): { ok: true; bundle: ConfigBundle } | { ok: false; error: string } {
  const b = o as Partial<ConfigBundle> | null
  if (!b || b.app !== 'td-config') return { ok: false, error: '口令标识不符（app ≠ td-config）' }
  if (b.version !== 1 && b.version !== 2 && b.version !== 3 && b.version !== 4) return { ok: false, error: `口令版本不符（${String(b.version)}，支持 1/2/3/4）` }
  if (b.fortressLib !== undefined && (!b.fortressLib || !Array.isArray(b.fortressLib.customs))) {
    return { ok: false, error: '数据形状不对（fortressLib.customs 非数组）' }
  }
  if (b.moduleDefs !== undefined && !Array.isArray(b.moduleDefs)) {
    return { ok: false, error: '数据形状不对（moduleDefs 非数组）' }
  }
  if (!Array.isArray(b.turretDefs) || !Array.isArray(b.projectileArts)) {
    return { ok: false, error: '数据形状不对（turretDefs/projectileArts 非数组）' }
  }
  const lv = b.level as LevelConfig | undefined
  if (!lv || typeof lv !== 'object' || !Array.isArray(lv.buildCells) || !Array.isArray(lv.objects) || !Array.isArray(lv.terrain)) {
    return { ok: false, error: '数据形状不对（level 字段缺失）' }
  }
  return { ok: true, bundle: b as ConfigBundle }
}

/** 解析口令（纯校验，不落盘）：形状全对才返回 bundle */
export function parseConfig(text: string): { ok: true; bundle: ConfigBundle } | { ok: false; error: string } {
  let json: string
  try {
    json = decodeBase64(text.trim())
  } catch {
    return { ok: false, error: '口令不是有效的 base64 编码' }
  }
  let o: unknown
  try {
    o = JSON.parse(json)
  } catch {
    return { ok: false, error: '口令内容不是有效 JSON' }
  }
  return validateBundleShape(o)
}

/** v2.18：智能解析——JSON（本地 td-config.json，以 { 开头）或 base64 口令双兼容 */
export function parseConfigSmart(text: string): { ok: true; bundle: ConfigBundle } | { ok: false; error: string } {
  const t = text.trim()
  if (t.startsWith('{')) {
    let o: unknown
    try {
      o = JSON.parse(t)
    } catch {
      return { ok: false, error: '文件内容不是有效 JSON' }
    }
    return validateBundleShape(o)
  }
  return parseConfig(t)
}

/** 应用已校验的 bundle：就地替换注册表并落盘 */
function applyBundle(bundle: ConfigBundle): { ok: true } {
  const { turretDefs, projectileArts, level } = bundle
  turretDefs.forEach(applyMountFoot) // v1.76：占格随型号归一化（旧口令携带的 w/h 以型号为准）
  TURRET_DEFS.splice(0, TURRET_DEFS.length, ...turretDefs)
  PROJECTILE_ARTS.splice(0, PROJECTILE_ARTS.length, ...projectileArts)
  // 旧口令 level 迁移：无 rows → 28 保留行为；模板墙格并入基地格全集（按 rows 锚定）
  if (typeof level.rows !== 'number') level.rows = 28
  level.rows = Number.isFinite(level.rows) ? Math.max(ROWS_MIN, Math.round(level.rows)) : 28 // 上限不限（仅保留下限）
  level.buildCells = mergeBaseCells(level.buildCells, level.rows)
  for (const k of Object.keys(LEVEL)) delete (LEVEL as unknown as Record<string, unknown>)[k]
  Object.assign(LEVEL, level)
  importUploads(bundle.assets) // 素材库上传条目（v1 口令 undefined → 不动现有库）
  importFortressLib(bundle.fortressLib) // 堡垒类型库（v1/v2 口令 undefined → 不动现有库）
  if (bundle.moduleDefs !== undefined) MODULE_DEFS.splice(0, MODULE_DEFS.length, ...bundle.moduleDefs) // v2.30 模块库（v1~v3 口令 undefined → 不动现有库）
  saveLevel() // 关卡走 level.ts 持久化通道（td-level-config）
  saveAll() // 炮塔定义 + 弹丸库持久化（td-turret-defs / td-projectile-arts）
  return { ok: true }
}

/** 导入口令：先全部解析校验通过，再一次性落盘（就地替换 + 持久化；失败不写坏现有数据） */
export function applyConfig(text: string): { ok: true } | { ok: false; error: string } {
  const r = parseConfig(text)
  if (!r.ok) return r
  return applyBundle(r.bundle)
}

/** v2.18：导入 JSON 或 base64 口令（本地文件夹读取用；同 applyConfig 的全校验后落盘保证） */
export function applyConfigSmart(text: string): { ok: true } | { ok: false; error: string } {
  const r = parseConfigSmart(text)
  if (!r.ok) return r
  return applyBundle(r.bundle)
}
