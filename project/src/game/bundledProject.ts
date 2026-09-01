const LOCAL_PROJECT_KEYS = [
  'td-turret-defs',
  'td-projectile-arts',
  'td-level-library-v1',
  'td-asset-lib',
  'td-fortress-lib-v1',
  'td-module-defs',
]

/**
 * 新浏览器首次打开时载入仓库随附的项目快照；已有本地项目数据时完全跳过，
 * 避免部署更新覆盖玩家或编辑器当前存档。
 */
export async function bootstrapBundledProject(): Promise<void> {
  if (typeof window === 'undefined') return
  try {
    if (LOCAL_PROJECT_KEYS.some(key => localStorage.getItem(key) !== null)) return
  } catch { return }

  try {
    const response = await fetch(new URL('res/config/default-project.json', document.baseURI), { cache: 'no-store' })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    // 配置模块会在初始化时载入并规范化各注册表；必须等“本地是否已有项目”的
    // 判断完成后再导入，否则这些默认写入会让首次访问被误判成已有项目。
    const { applyConfigSmart } = await import('./config_transfer')
    const result = applyConfigSmart(await response.text())
    if (!result.ok) throw new Error(result.error)
  } catch (error) {
    console.warn('[bundled-project] 默认项目快照载入失败，继续使用代码默认配置。', error)
  }
}
