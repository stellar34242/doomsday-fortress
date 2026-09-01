import type { Hardpoint } from '../config'

const DEG = Math.PI / 180

function wrapAngle(angle: number): number {
  while (angle > Math.PI) angle -= Math.PI * 2
  while (angle < -Math.PI) angle += Math.PI * 2
  return angle
}

function norm360(degrees: number): number { return ((degrees % 360) + 360) % 360 }

/** 炮位视界包含判定；arc 支持跨 0°。 */
export function hardpointArcContains(arc: { start: number; end: number }, relativeRadians: number): boolean {
  const relative = norm360(relativeRadians / DEG)
  const start = norm360(arc.start)
  const end = norm360(arc.end)
  return start <= end ? (relative >= start && relative <= end) : (relative >= start || relative <= end)
}

/** 炮位视界中点（相对车头，弧度）。 */
export function hardpointArcMid(arc: { start: number; end: number }): number {
  const start = norm360(arc.start)
  const end = norm360(arc.end)
  return (start <= end ? (start + end) / 2 : norm360((start + end + 360) / 2)) * DEG
}

/** 把相对车头的方位角钳制进视界区间，取最近边界。 */
export function clampToHardpointArc(arc: { start: number; end: number }, relativeRadians: number): number {
  if (hardpointArcContains(arc, relativeRadians)) return relativeRadians
  const candidates = [norm360(arc.start) * DEG, norm360(arc.end) * DEG]
  let best = candidates[0]
  let bestDistance = Math.abs(wrapAngle(candidates[0] - relativeRadians))
  for (const candidate of candidates) {
    const distance = Math.abs(wrapAngle(candidate - relativeRadians))
    if (distance < bestDistance) { bestDistance = distance; best = candidate }
  }
  return wrapAngle(best)
}

/** 受限炮位的安全内收角，避免目标落在边界时反复抖动。 */
export const HARDPOINT_BODY_AIM_MARGIN = 4 * DEG

/** 返回需要的车体朝向；null 表示当前车体朝向已经满足炮位视界。 */
export function constrainedHardpointBodyHeading(
  bodyHeading: number,
  targetBearing: number,
  hardpoint: Pick<Hardpoint, 'fixed' | 'arc'>,
  aimConeDeg: number,
): number | null {
  if (hardpoint.fixed !== undefined) {
    const fixedAngle = hardpoint.fixed * DEG
    const cone = Math.max(4, aimConeDeg / 2) * DEG
    if (Math.abs(wrapAngle(targetBearing - bodyHeading - fixedAngle)) <= cone) return null
    return wrapAngle(targetBearing - fixedAngle)
  }
  if (!hardpoint.arc) return null
  const relative = wrapAngle(targetBearing - bodyHeading)
  if (hardpointArcContains(hardpoint.arc, relative)) return null
  const boundary = clampToHardpointArc(hardpoint.arc, relative)
  const towardMiddle = wrapAngle(hardpointArcMid(hardpoint.arc) - boundary)
  const safeRelative = wrapAngle(boundary + Math.sign(towardMiddle) * Math.min(Math.abs(towardMiddle), HARDPOINT_BODY_AIM_MARGIN))
  return wrapAngle(targetBearing - safeRelative)
}
