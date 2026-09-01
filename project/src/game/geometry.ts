/** 所有单位共用的唯一中心规则：包围盒几何中心，不受奇偶格数或贴图尺寸影响。 */
export function geometryCenter(width: number, height: number): { x: number; y: number } {
  return { x: width / 2, y: height / 2 }
}

export function rectGeometryCenter(rect: { x: number; y: number; w: number; h: number }): { x: number; y: number } {
  const local = geometryCenter(rect.w, rect.h)
  return { x: rect.x + local.x, y: rect.y + local.y }
}

/** 将任意贴图/矩形的自身中心对齐到指定几何中心。 */
export function centeredRect(cx: number, cy: number, width: number, height: number): { x: number; y: number; w: number; h: number } {
  return { x: cx - width / 2, y: cy - height / 2, w: width, h: height }
}
