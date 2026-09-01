/** 单位或载具定义发生变化时，通知所有编辑器重新读取统一单位库。 */
export const UNIT_LIBRARY_CHANGED_EVENT = 'td-unit-library-changed'

export interface UnitLibraryChangedDetail {
  id?: string
  operation: 'save' | 'delete' | 'import'
}

let revision = 0

/** 统一单位库缓存使用的轻量版本号；每次定义增删、导入或载具保存都会递增。 */
export function unitLibraryRevision(): number { return revision }

export function notifyUnitLibraryChanged(detail: UnitLibraryChangedDetail): void {
  revision++
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent<UnitLibraryChangedDetail>(UNIT_LIBRARY_CHANGED_EVENT, { detail }))
}
