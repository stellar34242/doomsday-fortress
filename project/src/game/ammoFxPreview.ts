/** 弹丸效果预览（v1.69）：弹丸库「飞行/命中/爆炸」播放的纯逻辑部分（发射+推进），
 *  与战斗渲染同一套粒子系统（particles.ts）与参数解析（art.ts resolve*Fx）。
 *  纯函数可 sim；DebugPanel 的 AmmoPreview 组件持池按 rAF 驱动绘制。 */
import { createPool, projectileTrailVelocity, rearOnlyTrailVelocity, spawnBurst, spawnTrail, stepParticles, type ParticlePool } from './particles'
import { beamArtConfigOf, resolveExplosionFx, resolveImpactFx, resolveTrailFx } from './art'
import { M_PER_CELL, type ProjectileArtDef } from './config'
import { BEAM_FADE, BEAM_ON_SPEED } from './engine' // v2.38：发射伸展/停火消退与实战同一常量源（无循环依赖）

export type AmmoFxMode = 'trail' | 'impact' | 'explosion' | 'seq' // v2.34：seq=全程（左→右飞行→右端命中/爆炸，循环）
export const AMMO_FX_MODE_NAME: Record<AmmoFxMode, string> = { trail: '飞行', impact: '命中', explosion: '爆炸', seq: '全程' }

/** 播放状态（组件/sim 共用）：flightT/speedMps 用于按实战参数推进弹丸；其余字段为特效累积与循环状态。 */
export interface AmmoFxState { t: number; flightT: number; speedMps?: number; acc: number; burstAt: number; seed: number; px: number; absorbAcc: number; scatterAcc: number; smokeAcc: number; phase: number }
export function createFxState(): AmmoFxState { return { t: 0, flightT: 0, speedMps: undefined, acc: 0, burstAt: -10, seed: 0, px: 0.5, absorbAcc: 0, scatterAcc: 0, smokeAcc: 0, phase: 0 } }

/** 该模式是否可播放（未配置对应效果 → 按钮禁用）；
 *  v2.9：射线（ray）特殊口径——「飞行」播放光束发射（恒可播）、无爆炸（恒不可播）
 *  v2.34：seq 全程——ray 恒可播（光束持续）；其余任一效果（尾焰/命中/爆炸）已配置即可播 */
export function canPlay(pa: ProjectileArtDef, mode: AmmoFxMode): boolean {
  if (mode === 'seq') return pa.kind === 'ray' ? true : !!(pa.trail || pa.impact || pa.explosion)
  if (pa.kind === 'ray') return mode === 'trail' ? true : mode === 'explosion' ? false : !!pa.impact
  return mode === 'trail' ? !!pa.trail : mode === 'explosion' ? !!pa.explosion : !!pa.impact
}

/** v2.34：seq 命中点 = 右端留 2 格余量（爆炸半径参考 1.2 格 + 冲击环余量） */
export const FX_SEQ_HIT_X = (worldW: number) => worldW - 2

// 预览常量：爆炸参考半径（格）、循环间隔。弹丸速度不再固定，统一读取弹丸库实际配置。
export const FX_PREVIEW_RADIUS = 1.2
const EXPLOSION_PERIOD = 1.6
const IMPACT_PERIOD = 0.9

/** 按实战口径推进预览弹速，并返回格/秒。实弹/抛射读取 speed；导弹读取初速、延迟减速、加速度、极速与燃烧时间。 */
export function advancePreviewProjectileSpeed(pa: ProjectileArtDef, st: AmmoFxState, dt: number): number {
  if (pa.kind !== 'missile') {
    st.flightT += dt
    st.speedMps = Math.max(1, pa.speed ?? 32)
    return st.speedMps / M_PER_CELL
  }
  if (st.speedMps === undefined) st.speedMps = Math.max(0, pa.missileInitSpeed ?? 0)
  const delayed = !!pa.guided && st.flightT < Math.max(0, pa.guideDelay ?? 0)
  if (delayed && (pa.guideDecel ?? 0) > 0) {
    st.speedMps = Math.max(0, st.speedMps - Math.max(0, pa.guideDecel ?? 0) * dt)
  } else if (pa.burnTime === undefined || st.flightT < pa.burnTime) {
    const maxSpeed = Math.max(1, pa.missileMaxSpeed ?? 100)
    st.speedMps = Math.min(maxSpeed, st.speedMps + Math.max(0, pa.missileAccel ?? 40) * dt)
  }
  st.flightT += dt
  return st.speedMps / M_PER_CELL
}

function resetPreviewProjectile(st: AmmoFxState, x: number) {
  st.px = x
  st.flightT = 0
  st.speedMps = undefined
}

/** 尾焰/烟尾发射（trail 与 v2.34 seq 飞行段共用；弹体 px 推进由调用方负责） */
function trailEmit(tf: NonNullable<ReturnType<typeof resolveTrailFx>>, pool: ParticlePool, st: AmmoFxState, dt: number, midY: number, tailOff: number, boost: boolean, projectileSpeed: number) {
  let rate = tf.rate
  if (tf.template === 'pulse') rate *= 1 + 0.6 * Math.sin(2 * Math.PI * 1.2 * st.t) // 火焰脉冲 1.2Hz（同战斗）
  // v2.44：预览大力喷射补弹种门控（同战斗 render b24 仅导弹生效——此前预览所有弹种都吃 ×3 爆发，与实战不一致）
  const b24 = boost && st.t < 1 ? 1 - st.t : 0 // v2.24 预览同步大力喷射过渡：预览起播=点火，1s 内线性强化的回落（同战斗 b24）
  rate *= 1 + 2 * b24 // 速率 ×3 线性回落 ×1（同战斗）
  st.acc += rate * dt
  const n = Math.floor(st.acc)
  st.acc -= n
  const heading = Math.PI / 2 // 向右（dirX=sin=1）
  for (let i = 0; i < n; i++) {
    const ang = heading + (Math.random() * 2 - 1) * tf.spread
    const velocity = projectileTrailVelocity(projectileSpeed, 0, ang, tf.inherit)
    spawnTrail(pool, st.px - tailOff, midY, { // 尾部 = 贴图底部中间（向右飞行旋转 90° 后为左端）
      vx: velocity.vx,
      vy: velocity.vy,
      life: tf.life,
      size: tf.size * (1 + 0.6 * b24) * (tf.template === 'pulse' ? 0.85 + Math.random() * 0.3 : 1), // 脉冲尺寸闪烁；v2.24 大力喷射尺寸 ×1.6 线性回落 ×1（同战斗）
      color: tf.color, drag: tf.drag, grow: tf.grow, colorEnd: tf.colorEnd, fadeIn: tf.fadeIn,
      flicker: tf.template === 'pulse' ? 0.2 : undefined,
    })
  }
  if (tf.smoke && (tf.smoke.duration === undefined || st.t < tf.smoke.duration)) { // v2.21/v2.23 预览同步烟尾：与战场同参数（grow 1.6 + growUntil 0.4 扩散后渐隐）；「持续」窗口按预览起播=点火同步；预览无炮塔上下文，不做 burnTime 钳制
    st.smokeAcc += tf.smoke.rate * dt
    const sn = Math.floor(st.smokeAcc)
    st.smokeAcc -= sn
    for (let i = 0; i < sn; i++) {
      const smokeVelocity = rearOnlyTrailVelocity(
        projectileSpeed * 0.15 + (Math.random() * 2 - 1) * 0.3,
        (Math.random() * 2 - 1) * 0.3,
        heading,
      )
      spawnTrail(pool, st.px - tailOff, midY, {
        vx: smokeVelocity.vx,
        vy: smokeVelocity.vy,
        life: tf.smoke.life,
        size: tf.size * 1.6,
        color: tf.smoke.color,
        drag: 1.5,
        grow: 1.6,
        growUntil: 0.4,
        fadeIn: 0.15,
      })
    }
  }
}

/** 单步推进：按模式发射粒子并推进粒子池。worldW/midY = 世界宽/弹道高（格）。
 *  tailOff（v1.71）：尾焰发射点后移量（格）= 贴图高度一半（绑定贴图底部中间，随弹丸尺寸适配；几何回退按 4px 半径） */
/** v2.37：射线 seq 发射持续时长（秒）——开始发射 5s 后消失，停顿 FX_RAY_SEQ_GAP 后循环（保持 seq「循环至停止」语义） */
export const FX_RAY_SEQ_ON = 5
/** v2.37：射线 seq 熄灭后停顿时长（秒），与弹丸 seq 爆发后的循环停顿同口径 */
export const FX_RAY_SEQ_GAP = 0.9

/** v2.38：射线 seq 光束当前长度（格）——与战场 beamLength 同口径（v2.35）：起射按 BEAM_ON_SPEED 从发射点伸展。
 *  st.t = 循环内时刻（每次循环重置归零）；全长 = 发射点 0.5 → 右端 worldW−0.5 = worldW−1 格。 */
export function fxRaySeqLen(st: AmmoFxState, worldW: number): number {
  return Math.min(worldW - 1, (st.t * BEAM_ON_SPEED) / M_PER_CELL)
}

/** v2.38：射线 seq 停火消退进度 p（1→0）——与战场 beamFades 同口径（v2.36）：
 *  熄灭窗口前 BEAM_FADE(0.25s) 内从 1 收到 0，其余时刻为 0（不绘制）。 */
export function fxRaySeqFade(st: AmmoFxState): number {
  const el = st.t - FX_RAY_SEQ_ON
  return el > 0 && el < BEAM_FADE ? 1 - el / BEAM_FADE : 0
}

export function fxTick(pa: ProjectileArtDef, mode: AmmoFxMode, pool: ParticlePool, st: AmmoFxState, dt: number, worldW: number, midY: number, tailOff = 0) {
  st.t += dt
  if (mode === 'trail' || (mode === 'seq' && pa.kind === 'ray')) { // 飞行：弹体向右平飞，按解析参数持续喷尾焰（模板含脉冲振荡/惯性甩尾）；v2.34：ray 的 seq=光束持续（全过程即发射本身）
    if (pa.kind === 'ray') { // v2.9：射线「飞行」= 光束发射（光束体由绘制层推演，无尾焰粒子）
      // v2.37：seq 播放 = 发射 5s → 熄灭（光束与三组粒子全停）→ 停顿 0.9s → 循环重启；trail 模式不受限
      if (mode === 'seq') {
        if (st.t >= FX_RAY_SEQ_ON + FX_RAY_SEQ_GAP) { // 循环重置：t 归零 = 重新起射
          st.t = 0
          st.phase = 0
          st.absorbAcc = 0
          st.scatterAcc = 0
          st.smokeAcc = 0
        } else if (st.t >= FX_RAY_SEQ_ON) { // 熄灭窗口：不发射粒子，仅推进残存粒子
          st.phase = 1
          stepParticles(pool, dt)
          return
        } else st.phase = 0
      }
      // v2.10：光束三组粒子（吸收=发射点向心汇聚 / 散发=命中端点飞溅 / 烟尘=端点慢速扩散不加光）
      const ba = beamArtConfigOf(pa)
      if (ba.absorb || ba.scatter || ba.smoke) {
        const mzx = 0.5 // 发射点（与 AmmoPreview 绘制一致）
        // v2.38：seq 端点随起射伸展前锋前移（与战场 v2.35 光束端点一致）；trail 模式恒为右端
        const epX = mode === 'seq' ? mzx + fxRaySeqLen(st, worldW) : worldW - 0.5
        if (ba.absorb) {
          st.absorbAcc += ba.absorb.rate * dt
          const n = Math.floor(st.absorbAcc)
          st.absorbAcc -= n
          for (let i = 0; i < n; i++) {
            const ang = Math.random() * Math.PI * 2
            const dist = 0.35 + Math.random() * 0.3
            const sp = 1.6
            spawnTrail(pool, mzx + Math.cos(ang) * dist, midY + Math.sin(ang) * dist, {
              vx: -Math.cos(ang) * sp, vy: -Math.sin(ang) * sp,
              life: dist / sp, size: ba.absorb.size, color: ba.absorb.color, drag: 0,
            })
          }
        }
        if (ba.scatter) {
          st.scatterAcc += ba.scatter.rate * dt
          const n = Math.floor(st.scatterAcc)
          st.scatterAcc -= n
          const cone = ba.scatter.angle * Math.PI / 180 // v2.15：散发角度——朝射线源（向左 π）为 0°；360=全向
          for (let i = 0; i < n; i++) {
            const ang = ba.scatter.angle >= 360 ? Math.random() * Math.PI * 2 : Math.PI + (Math.random() - 0.5) * cone
            const sp = 2 + Math.random() * 2
            spawnTrail(pool, epX, midY, {
              vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
              life: 0.2 + Math.random() * 0.15, size: ba.scatter.size, color: ba.scatter.color, drag: 6, streak: true,
            })
          }
        }
        if (ba.smoke) {
          st.smokeAcc += ba.smoke.rate * dt
          const n = Math.floor(st.smokeAcc)
          st.smokeAcc -= n
          for (let i = 0; i < n; i++) {
            const ang = Math.random() * Math.PI * 2
            const sp = 0.3 + Math.random() * 0.4
            spawnTrail(pool, epX, midY, {
              vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 0.2,
              life: 0.8 + Math.random() * 0.4, size: ba.smoke.size, color: ba.smoke.color, drag: 1.5, grow: 2,
            })
          }
        }
      }
      stepParticles(pool, dt)
      return
    }
    const tf = resolveTrailFx(pa)
    if (!tf) return
    const speed = advancePreviewProjectileSpeed(pa, st, dt)
    st.px += speed * dt
    trailEmit(tf, pool, st, dt, midY, tailOff, pa.kind === 'missile', speed)
    if (st.px > worldW + 0.5) { // 飞出右侧后按一次新的发射重新计算初速/加速过程
      resetPreviewProjectile(st, -0.5)
      st.t = 0
      st.acc = 0
      st.smokeAcc = 0
    }
  } else if (mode === 'seq') { // v2.34 全程：飞行段（喷尾焰）→ 命中点爆发（命中碎屑+爆炸按配置同时触发）→ 爆发结束+停顿后循环
    const hitX = FX_SEQ_HIT_X(worldW)
    if (st.phase === 0) {
      const speed = advancePreviewProjectileSpeed(pa, st, dt)
      st.px += speed * dt
      const tf = resolveTrailFx(pa)
      if (tf) trailEmit(tf, pool, st, dt, midY, tailOff, pa.kind === 'missile', speed)
      if (st.px >= hitX) {
        st.px = hitX
        st.phase = 1
        st.burstAt = st.t
        st.seed++
        const inf = resolveImpactFx(pa)
        if (inf) spawnBurst(pool, { x: hitX, y: midY, count: inf.spikes, speed: inf.speed, life: inf.life, size: inf.size, color: inf.color, drag: inf.drag, seed: st.seed * 2 + 7, streak: inf.streak === 1, dirX: -1, dirY: 0, bias: inf.bias, spread: inf.angle * Math.PI / 180 })
        const ef = resolveExplosionFx(pa)
        if (ef) {
          const visualR = FX_PREVIEW_RADIUS * ef.visualScale
          spawnBurst(pool, { x: hitX, y: midY, count: ef.sparks, speed: visualR * 6, life: 0.5, size: 0.05 * ef.visualScale, color: ef.color, drag: 4, seed: st.seed * 2, speedJitter: ef.speedJitter, lifeJitter: ef.lifeJitter, streak: ef.streak === 1 })
          spawnBurst(pool, { x: hitX, y: midY, count: ef.smoke, speed: visualR * 1.5, life: 0.9, size: 0.1 * ef.visualScale, color: '#3A3632', drag: 1.5, seed: st.seed * 2 + 1, grow: 2, turb: ef.turbulence, speedJitter: ef.speedJitter, lifeJitter: ef.lifeJitter })
        }
      }
    } else {
      const ef = resolveExplosionFx(pa)
      const inf = resolveImpactFx(pa)
      const wait = Math.max(ef?.duration ?? 0, inf?.duration ?? 0, 0.2) + 0.9 // 爆发结束 + 停顿再循环
      if (st.t - st.burstAt >= wait) { // 循环重置：t 归零 = 重新点火（b24 大力喷射/烟尾持续窗口按新一轮起算）
        st.phase = 0
        resetPreviewProjectile(st, -0.5)
        st.t = 0
        st.burstAt = -10
        st.acc = 0
        st.smokeAcc = 0
      }
    }
    stepParticles(pool, dt)
    return
  } else if (mode === 'explosion') { // 爆炸：周期触发火花+烟尘爆发（矢量底闪/冲击环由绘制层按 burstAt 推演）
    const ef = resolveExplosionFx(pa)
    if (!ef) return
    if (st.t - st.burstAt >= EXPLOSION_PERIOD) {
      st.burstAt = st.t
      st.seed++
      const cx = worldW / 2
      const visualR = FX_PREVIEW_RADIUS * ef.visualScale
      spawnBurst(pool, { x: cx, y: midY, count: ef.sparks, speed: visualR * 6, life: 0.5, size: 0.05 * ef.visualScale, color: ef.color, drag: 4, seed: st.seed * 2, speedJitter: ef.speedJitter, lifeJitter: ef.lifeJitter, streak: ef.streak === 1 })
      spawnBurst(pool, { x: cx, y: midY, count: ef.smoke, speed: visualR * 1.5, life: 0.9, size: 0.1 * ef.visualScale, color: '#3A3632', drag: 1.5, seed: st.seed * 2 + 1, grow: 2, turb: ef.turbulence, speedJitter: ef.speedJitter, lifeJitter: ef.lifeJitter })
    }
  } else { // 命中：周期触发碎屑飞溅（中心亮点由绘制层推演）
    const inf = resolveImpactFx(pa)
    if (!inf) return
    if (st.t - st.burstAt >= IMPACT_PERIOD) {
      st.burstAt = st.t
      st.seed++
      spawnBurst(pool, { x: worldW / 2, y: midY, count: inf.spikes, speed: inf.speed, life: inf.life, size: inf.size, color: inf.color, drag: inf.drag, seed: st.seed * 2 + 7, streak: inf.streak === 1, dirX: -1, dirY: 0, bias: inf.bias, spread: inf.angle * Math.PI / 180 })
    }
  }
  stepParticles(pool, dt)
}

/** 无头/sim 验证：固定步长推进 seconds 秒，返回粒子峰值/存活数（确定性判断发射是否工作） */
export function simAmmoFx(pa: ProjectileArtDef, mode: AmmoFxMode, seconds = 2, worldW = 12, midY = 1.6): { peak: number; end: number } {
  const pool = createPool()
  const st = createFxState()
  const dt = 1 / 60
  let peak = 0
  for (let t = 0; t < seconds; t += dt) {
    fxTick(pa, mode, pool, st, dt, worldW, midY)
    if (pool.parts.length > peak) peak = pool.parts.length
  }
  return { peak, end: pool.parts.length }
}

/** v2.34 无头/sim 验证：seq 全程推进，返回粒子峰值、爆发次数、循环次数 */
export function simAmmoSeq(pa: ProjectileArtDef, seconds = 8, worldW = 12, midY = 1.6): { peak: number; bursts: number; loops: number } {
  const pool = createPool()
  const st = createFxState()
  const dt = 1 / 60
  let peak = 0, bursts = 0, loops = 0, prevPhase = 0
  for (let t = 0; t < seconds; t += dt) {
    fxTick(pa, 'seq', pool, st, dt, worldW, midY)
    if (st.phase === 1 && prevPhase === 0) bursts++
    if (st.phase === 0 && prevPhase === 1) loops++
    prevPhase = st.phase
    if (pool.parts.length > peak) peak = pool.parts.length
  }
  return { peak, bursts, loops }
}
