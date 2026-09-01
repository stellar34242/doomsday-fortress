// 复现：摇杆松手后转向是否立刻归零
import { initialState, tick } from '../src/game/engine'

const DEG = Math.PI / 180
let s = initialState()
s.phase = 'prep'
// 满速直线
s.moveDir = { x: 0, y: -1 }
s.moveMag = 1
for (let i = 0; i < 30; i++) s = tick(s, 0.1)
console.log('满速 v=', Math.hypot(s.fortress.vx, s.fortress.vy).toFixed(2))

// 摇杆推 30°（前进弧线）：desiredHeading = heading + 30°，持续 1s
s.desiredHeading = s.fortress.heading + 30 * DEG
for (let i = 0; i < 10; i++) s = tick(s, 0.1)
console.log('弧转 1s 后 heading=', (s.fortress.heading / DEG).toFixed(2), '° 速度方向=', (Math.atan2(s.fortress.vx, -s.fortress.vy) / DEG).toFixed(2), '°')

// 松手：模拟 endJoystick
s.desiredHeading = null
s.moveDir = { x: 0, y: 0 }
s.reverse = false
const h0 = s.fortress.heading
for (let i = 1; i <= 10; i++) {
  s = tick(s, 0.1)
  const velDir = Math.atan2(s.fortress.vx, -s.fortress.vy) / DEG
  console.log(`松手后 ${(i * 0.1).toFixed(1)}s: Δheading=${((s.fortress.heading - h0) / DEG).toFixed(3)}° v=${Math.hypot(s.fortress.vx, s.fortress.vy).toFixed(2)} velDir=${velDir.toFixed(2)}°`)
}
