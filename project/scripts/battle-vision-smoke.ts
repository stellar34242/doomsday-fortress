import {
  factionsShareVision,
  initialState,
  playerTeamCanSeePoint,
  playerTeamVisionSources,
} from '../src/game/engine'
import {
  gameParameters,
  setBattleVisionEnabled,
  setPlayerVisionMeters,
} from '../src/game/gameParameters'

const originalEnabled = gameParameters().battleVisionEnabled
const originalMeters = gameParameters().playerVisionMeters

try {
  setBattleVisionEnabled(true)
  setPlayerVisionMeters(6.4)
  const state = initialState()
  state.allies.push({
    id: 9801, kind: 'soldier', faction: 'ally', controller: 'ai', producerId: -1,
    x: 50, y: 50, hp: 10, maxHp: 10, cooldown: 0, targetId: null, hitFlash: 0,
  })
  state.allies.push({
    id: 9802, kind: 'soldier', faction: 'neutral', controller: 'ai', producerId: -1,
    x: 80, y: 80, hp: 10, maxHp: 10, cooldown: 0, targetId: null, hitFlash: 0,
  })
  const sources = playerTeamVisionSources(state)
  const checks = [
    factionsShareVision('player', 'ally'),
    !factionsShareVision('player', 'neutral'),
    sources.some(source => source.entityId === 0),
    sources.some(source => source.entityId === 9801),
    !sources.some(source => source.entityId === 9802),
    playerTeamCanSeePoint(state, 51.5, 50),
    !playerTeamCanSeePoint(state, 55, 50),
  ]
  if (checks.some(result => !result)) throw new Error(`战场共享视野冒烟测试失败：${JSON.stringify(checks)}`)
  console.log('BATTLE VISION SMOKE PASSED')
} finally {
  setPlayerVisionMeters(originalMeters)
  setBattleVisionEnabled(originalEnabled)
}
