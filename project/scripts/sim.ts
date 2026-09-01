// 无头模拟验证脚本：esbuild 打包后用 node 运行。
// 覆盖两份设计文档的关键验收口径。
import {
  ALLY_DEFS, AMMO, BARREL_HP, BASE_CELL, COLS, buildWave, CORE, DEFAULT_FORTRESS, ENEMY_DEFS, ENERGY, FORTRESS_DEFS, FORTRESS_INTERIOR, M_PER_CELL, RUINS_HP, SPECIAL_MULT, TURRET_DEFS, VEHICLE_PLACEHOLDER_COLOR, VERTICAL_LAUNCH_FRAMES, WALL_BUILD_COST,
  WALL_HP, PROJECTILE_ARTS, FLASH_DURATION, MODULE_DEFS,
  hardpointBelowVehicleBody, moduleAssemblyPoints, resolveUnitDestructionEffect, turretAmmoExchangeRate, turretAssemblyPoints,
} from '../src/game/config'
import type { BattleObject, EnemyKind, FortressDef, TurretDef, TurretTag } from '../src/game/config'
import { trackPlacements,
  allySpawnPoint, artMounts, blockerAt, turretRenderKey, buildModule, canMountTurret, canPlaceModule, computePathField, demolishAt, demolishModule, dirX, dirY, wrapAngle, fortressCenter,
  damageAlly, damageEnemy, damageFortress, defenseWaveCountdown, defenseWaveSpawnPoint, destroyObjectiveProgress, enemyVehicleArmorSideAt, eventRandom, fortressArmorSideAt, fortressCells, fortressReachedFinish, fortressRect, initialState,
  fortressAssemblyAllowed, fortressCooling, fortressDef, fortressInAssemblyZone, fortressInStartZone, fortressMaxHp, fortressSpeed, fortressSupplyStatus, fortressTurnSpeed, hardpointArcContains, hardpointWorldPos, levelServiceZones, moduleBonuses, moduleCells, moduleDefOf, moduleFoot, moduleSpecialMult, mountTurret, muzzlePos, placeBaseCellAt, placeTurret, resourceCaps,
  syncDerivedWalls, tick, startWave, isTerminalPhase, interactWithObjectAt, interactWithUnitAt, interactionBubbles, primaryObjectiveStatus, resolveEventChoice, completeEventAssembly, secondaryObjectiveStatuses, settlementObjectiveStatuses, setTurretAutoFire,
  turretRangeBonus, unmountTurret,
  RACK_RELOAD_ANIM, rackMissilePos, validateFortressDef, validateTemplateClosed,
  beamMarch, beamLength, BEAM_ON_SPEED, BEAM_FADE, fortressMarkColumns, modulePlanningFits, simulateTurretHeat, wheelFrameCount, wheelPlacements, wheelRollFrame, wheelVisualSteerAngle,
  shieldStats, enemyProjectileFortressHit, fortressDamageLocalPoint, fortressDistanceToPoint, fortressPenetrationChance, FORTRESS_DAMAGE_MARK_CAP,
  GEOMETRIC_BULLET_VISUAL_SIZE, UNIT_BODY_DAMAGE_VISUALS_ENABLED, UNIT_BODY_DECALS_ENABLED, UNIT_FOLLOW_GAP,
  EXPLOSION_COVER_REDUCTION, objectBlocksEnvironmentShot, shellArcVisual, UNIT_RETALIATION_MEMORY_SECONDS,
  fortressLocalCenter, fortressShapeOrigin, selectSiegeTarget, applyFortressRamming, applyFortressVehicleCollisions, moveEnemyVehicleToward, moveGroundUnitWithBlockers, moveUnitAircraftToward, moveUnitVehicleToward, resolveUnitCollisions, fortressRamWeight, fortressRamWeightFactor, ensureUnitVehicleTurrets,
  advanceWalkerAnimation, hoverVelocityStep, walkerMotionStep,
  RAM_MIN_SPEED, VEHICLE_COLLISION_COOLDOWN,
  pointInsideUnitShape, segmentUnitShapeEntry, coolUnitVehicleHeat, factionsHostile, factionsShareVision, playerTeamCanSeePoint, playerTeamVisionSources,
  advanceUnitAircraftCrash, beginUnitAircraftCrash, constrainedHardpointBodyHeading, currentUnitAltitude, projectileAltitudeAtTravel, ROTORCRAFT_AUDIO_FULL_SPEED_RATIO, ROTORCRAFT_AUDIO_MIN_GAIN, rotorcraftMovementAudioGain, setUnitAircraftTargetAltitude, unitAircraftMovementAudioGain, updateUnitAircraftAltitude,
  applyMissileInterceptionDamage, interceptableMissileTargets, missileCurveAmplitudeScale, missileEjectOffsetDeg, segmentCircleEntry, applyCombatLoadout,
  applyPlayerUnitCombatLoadout, playerUnitCombatLoadout, playerUnitLoadoutChangeCost,
  playerUnitResourceDetails, playerTurretResourceCaps, nonCombatNavigationStats,
} from '../src/game/engine'
import { defaultStage, normalizeObjective, parseLevel, templateWallCells } from '../src/game/level'
import { simAmmoFx, simAmmoSeq, canPlay, fxTick, createFxState, FX_SEQ_HIT_X, FX_RAY_SEQ_ON, fxRaySeqFade, fxRaySeqLen } from '../src/game/ammoFxPreview'
import { chargeFrameRect, resCompatUrl, validateArt, projectileArtDef, projectileArtState, projectileBodyFrameRect, resolveSpriteFolder, resolveAmmoFolder, turretArtState, turretLayerSrcs, ammoProjectileSrc, resolveTrailFx, resolveExplosionFx, resolveImpactFx, beamArtConfig, beamArtConfigOf, smokeDuration, verticalLaunchFrameRect } from '../src/game/art'
import { migrateBeamTurretSounds, migrateLegacyProjectileMetrics, migrateLegacyTurretArt, migrateLegacyTurretMetrics, migrateModuleDefs, migrateProjectileInterception, migrateRetiredRayTurret, migrateRetiredStandardMissileAsset, migrateRetiredTurretFields, migrateTurretLayerDefaults, migrateTurretResourceCapacity, migrateVerticalLaunchProjectileAsset, parseProjectileArts, parseTurretDefs, serializeProjectileArts, serializeTurretDefs } from '../src/game/persist'
import { deleteCustomFortress, deleteCustomVehicleDefinition, fortressPersistFailed, getSelectedFortressId, isBuiltinFortressOverridden, isSupportedFortressLibVersion, migrateLegacyCustomVehicleUnits, resetPersistedToDefaults, saveCustomFortress, saveVehicleUnitDefinition, setSelectedFortressId } from '../src/game/persist'
import { applyConfig, applyConfigSmart, encodeBase64, exportConfig, exportConfigJson, parseConfig, parseConfigSmart } from '../src/game/config_transfer'
import { addAsset, filterAssets, getAsset, importUploads, independentTileIndicesFromPixels, isAutotileAsset, listAssets, removeAsset, resolveAssetSrc, tileSheetForDimensions, uploadsForExport, weightedIndependentTileIndex, ASSET_CATEGORY_NAME } from '../src/game/assetlib'
import { BEAM_CONTINUOUS_AUDIO_DELAY, GLOBAL_CUE_LABELS, UI_BUTTON_CLICK_PRESET_ID, audioProjectConfig, autoSoundPreset, resolveCue } from '../src/game/audioConfig'
import { DISPLAY_RESOLUTION_PRESETS, normalizeDisplayConfig, resolveDisplayViewport } from '../src/game/displayConfig'
import { gameParameters, setBattleVisionEnabled, setEntityShadowsVisible, setHitFxVisibility, setNaturalHeatDissipation, setPlayerVisionMeters, setUnitDestructionWreckageScalePercent, setUnitHealthBarsVisible } from '../src/game/gameParameters'
import { createPool, glowFlicker, gradientColorKey, projectileTailEmitter, projectileTrailVelocity, rearOnlyTrailVelocity, ringProgress, spawnBurst, spawnTrail, stepParticles } from '../src/game/particles'
import { effectParams, effectWorldPos, emitFortressEffects, trackMarkStep, updateTrackMarks, TRACK_MARK_CAP, TRACK_MARK_LIFE, type TrackMark, type TrackMarkState } from '../src/game/fortressFx'
import { craterOpacity, craterRadius, updateCraters, CRATER_CAP, CRATER_LIFE, type Crater } from '../src/game/craters'
import { airUnitShadowTransform, beamFadeSpan, clampViewX, clampViewY, compareSceneRenderItems, groundEntityShadowTransform, wallFaceInfo, wallVertexInfo, classifyWallTile, fortressDamageStage, missileEngineGlowLayout, ricochetVisualScale, shieldCornerRadius, shieldEdgeFlowGain, shieldEdgePulse, shieldHexLayout, shieldHexRipple, shieldPerimeterSamples, shieldUnfoldProgress, shieldUnfoldScale, shieldBreakEnvelope, shieldFieldMotion, shieldShardSize, shouldFlipEvenBarrel, trackMarkVisibleOnScreen, unboundedCenteredView, unitDamageMarkVisible, unitDestructionVisualParams, vehicleDamageBrightness, vehicleDamageSmokeSourceCount, verticalLaunchTailProjection, walkerFrameCount, walkerFrameIndex } from '../src/game/render'
import { ACHIEVEMENT_SHOP_ITEMS, availableMedalCount, awardLevelProgress, canPlaceBaseCell, COLS_MIN, defaultLevel, defaultLevelLibrary, deployableFortressIdsOf, equipmentUnlockId, globalVariableValues, hasLevelMedal, invalidateWallInfo, isBaseCell, isEquipmentUnlocked, isInnerCell, isLevelUnlocked, isWallSegment, LEVEL, LEVEL_LIBRARY, levelLibraryForExport, mergeBaseCells, missionBriefingOf, normalizeEventActions, parseLevelLibrary, purchaseEquipment, reanchorCols, reanchorRows, removeUnitDefinitionReferences, resetLevel, saveLevelLibrary } from '../src/game/level'
import type { LevelProgress } from '../src/game/level'
import { eraseTileCellsInRect, fillTileCellsInRect, gridCellSelectionRect, levelCenterCell, pruneVisualLayersOutsideBounds, validateLevelReferences } from '../src/game/levelEditor'
import type { LevelTileCell } from '../src/game/levelEditor'
import { rmxpAutotileIndex, rmxpQuarterSrc, RMXP_SUBTILES } from '../src/game/autotile'
import { clearFortressBodyAlpha, registerFortressBodyAlpha } from '../src/game/fortressBodyMask'
import { bodyCollisionCells, bodyCollisionFromPixels } from '../src/game/fortressCollision'
import { dilateShieldMask, sampleShieldMaskInterior, traceShieldMaskContours } from '../src/game/shieldMask'
import { wreckageFrameRect } from '../src/game/fxDraw'
import { aiRangeDecision, computeAIStandingRange, deleteCustomUnitDef, enemyUnitDef, SIEGE_TARGETS, allyUnitId, enemyUnitId, fortressUnitId, importUnitLibrary, migrateLegacyTargetKind, normalizeKamikazeConfig, normalizeUnitAI, playableVehicleDefs, rotorPlacements, saveCustomUnitDef, targetingAllowsTarget, unitAltitude, unitDefById, unitFootprint, unitLibrary, unitLibraryForExport, unitShadowScale, unitTypeConfig, validateUnitDef } from '../src/game/unit'
import { unitUsesGroundApproachPath } from '../src/game/ai/vehicleCombatAI'
import type { Enemy, EnemyProjectile, ExplosionFx, GameState, Turret } from '../src/game/engine'
import { centeredRect, geometryCenter, rectGeometryCenter } from '../src/game/geometry'
import { deleteObjectType, deleteTerrainType, newObjectType, newTerrainType, objectTypeById, objectTypeLibrary, restoreWorldTypeLibrary, saveObjectType, saveTerrainType, snapshotWorldTypeLibrary, terrainTypeById, terrainTypeLibrary } from '../src/game/worlddef'
import { firstLoadoutModulePlacement, normalizeCombatVehicleLoadout, normalizeVehicleLoadout, vehicleLoadoutAssemblyPoints, vehicleLoadoutStats } from '../src/game/loadout'
import type { VehicleLoadoutPreset } from '../src/game/loadout'

// ---------- 确定性随机 ----------
let seed = 42
Math.random = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296
  return seed / 4294967296
}
// 精度散布归零（r=0 => 命中点=瞄准点），需要散布时单独恢复
const zeroRandom = () => 0
// 旧配置以 25m/格编写；现在统一为 3.2m/格。测试中的历史米制参数按格距等比迁移。
const legacyMeters = (value: number) => value * M_PER_CELL / 25

// ---------- 测试框架 ----------
let failures = 0
function check(name: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS ${name}`)
  else { failures++; console.log(`  FAIL ${name} ${detail}`) }
}

// ---------- 场景构造 ----------
function mkEnemy(s: GameState, kind: EnemyKind, x: number, y: number, hp = 100000): Enemy {
  const def = ENEMY_DEFS[kind]
  // 钉住：攻击一个场外不可摧毁的假物体（移动堡垒会脱离核心攻击的贴脸判定，不能再钉 core）
  let pin = s.objects.find(o => o.maxHp === 1e12)
  if (!pin) {
    pin = { id: s.nextId++, kind: 'rock', x: -5, y: -5, w: 1, h: 1, hp: 1e12, maxHp: 1e12, blockMove: false, blockProjectile: false, height: 0 }
    s.objects.push(pin)
  }
  const e: Enemy = {
    id: s.nextId++, kind, x, y, hp, maxHp: hp,
    controller: 'static',
    mode: 'attack', targetKind: 'object', targetId: pin.id, // 钉住：攻击假物体不移动
    goalX: x, goalY: y, hasGoal: true, pathVersion: 0,
    attackedBy: [], dots: [], hitFlash: 0,
  }
  void def
  s.enemies.push(e)
  return e
}

function mkTurret(s: GameState, defId: string, x: number, y: number): Turret {
  const def = TURRET_DEFS.find(d => d.id === defId)!
  const t: Turret = {
    id: s.nextId++, defId, x, y, w: def.w, h: def.h, level: 1,
    hp: def.hp, maxHp: def.hp, angle: 0, cooldown: 0, burstLeft: 0, burstTimer: 0,
    rackLeft: def.type === 'missile' ? Math.max(1, def.burst ?? 1) : 0, // 与引擎初始满挂同规则
    rackAnim: 0,
    rackTimer: 0,
    chargeLeft: 0, firing: false, firingLeft: 0, tickTimer: 0,
    targetId: null, barrelIdx: 0,
  }
  s.turrets.push(t)
  return t
}

/** 资源拉满、进入交战态的最小场景 */
// LEVEL 可变后测试间隔离：快照默认值，每个用例结束恢复
// 旧用例按 28 行基准布局运行（纵深默认 20 的语义另设专项验收）：无损重建（reanchor 会丢出界元素）
const D28 = defaultLevel(28)
D28.buildCells = mergeBaseCells(D28.buildCells, 28)
// 旧默认布局语义：墙圈内部全宽行同为基地格（可建造区；里侧格才可建炮塔）
for (let y = D28.rows - 9; y <= D28.rows - 2; y++) for (let x = 1; x < COLS - 1; x++) D28.buildCells.push(`${x},${y}`)
// 战场默认已清空（18×36 空地）：物体/地形相关用例的标准夹具改由测试自带
D28.terrain.push(
  { kind: 'puddle', x: 6, y: 8, w: 3, h: 2, moveModifier: 0.5 }, // 用例12 减速水坑
  { kind: 'puddle', x: 2, y: 3, w: 2, h: 1, moveModifier: 0.5 }, // 纵深③：改小后移出丢弃验证
)
D28.objects.push(
  { kind: 'barrel', x: 5, y: 8, w: 1, h: 1, hp: BARREL_HP, blockMove: true, blockProjectile: false, height: 1 }, // 用例13（须为 objects[0]）
  { kind: 'ruins', x: 4, y: 6, w: 2, h: 2, hp: RUINS_HP, blockMove: true, blockProjectile: true, height: 1 }, // 用例11/物体框架①③④
  { kind: 'rock', x: 8, y: 5, w: 2, h: 1, hp: -1, blockMove: true, blockProjectile: false, height: 1 }, // 用例11/物体框架②
)
for (const k of Object.keys(LEVEL)) delete (LEVEL as unknown as Record<string, unknown>)[k]
Object.assign(LEVEL, D28)
const TEMPLATE_TOP = LEVEL.rows - 10 // 模板墙顶边行（rows 底部锚定）= 18
const LEVEL_DEFAULT = structuredClone(LEVEL)
const restoreLevel = () => {
  for (const k of Object.keys(LEVEL)) delete (LEVEL as unknown as Record<string, unknown>)[k]
  Object.assign(LEVEL, structuredClone(LEVEL_DEFAULT))
  invalidateWallInfo()
}
const configureObjective = <T extends typeof LEVEL>(level: T, objective: unknown) => {
  const normalized = normalizeObjective(objective, (objective as { type?: unknown } | null)?.type === 'reach' ? 'advance' : 'defend', level.rows, level.cols)
  level.objective = structuredClone(normalized)
  const stage = defaultStage(structuredClone(normalized))
  level.stages = [stage]
  level.startStageId = stage.id
}

function arena(): GameState {
  const s = initialState()
  s.turrets = [] // 清掉堡垒内置武器：旧用例语义 = 初始无炮塔
  s.phase = 'combat'
  s.ammo = 100000
  s.energy = 100000
  s.gold = 100000
  return s
}

/** 无内置武器的干净状态（旧用例语义：初始无炮塔） */
function fresh(): GameState {
  const s = initialState()
  s.turrets = []
  return s
}

/** 干净状态 + 按 LEVEL.buildCells 派生墙（旧用例语义：初始有模板墙圈） */
function walled(): GameState {
  const s = fresh()
  syncDerivedWalls(s)
  return s
}

function run(s: GameState, seconds: number, dt = 0.05, perTick?: (s: GameState) => void): GameState {
  let cur = s
  const n = Math.round(seconds / dt)
  for (let i = 0; i < n; i++) {
    cur = tick(cur, dt)
    if (perTick) perTick(cur)
  }
  return cur
}

const byId = <T extends { id: number }>(arr: T[], id: number) => arr.find(x => x.id === id)

// ================================================================
// --- 内置载具出厂贴图守卫：仅保留统一载具素材 ---
{
  const std = FORTRESS_DEFS.find(f => f.id === 'standard')!
  check('内置载具出厂只配置载具素材（/res/fortresses 路径）',
    std.spriteBase === undefined && std.spriteBody === '/res/fortresses/fort_1_01.png'
    && DEFAULT_FORTRESS.spriteBase === undefined && DEFAULT_FORTRESS.spriteBody === std.spriteBody,
    `legacyBase=${std.spriteBase} vehicle=${std.spriteBody}`)
}

console.log('== 炮塔验收 ==')
{
  check('受限炮位车体协同：固定前向炮位在侧向目标时要求机体转向，全视角炮位不干预车体',
    Math.abs(wrapAngle((constrainedHardpointBodyHeading(0, Math.PI / 2, { fixed: 0 }, 10) ?? 0) - Math.PI / 2)) < 1e-9
      && constrainedHardpointBodyHeading(0, Math.PI / 2, {}, 10) === null)
  const arcAssistHeading = constrainedHardpointBodyHeading(0, Math.PI / 2, { arc: { start: -30, end: 30 } }, 10)
  check('受限炮位车体协同：目标在视界外时转入边界内侧并保留防抖余量',
    arcAssistHeading !== null
      && hardpointArcContains({ start: -30, end: 30 }, wrapAngle(Math.PI / 2 - arcAssistHeading!)))
}

console.log('== v1.72 口令覆盖出厂配置验收 ==')
{
  const mgD = TURRET_DEFS.find(d => d.id === 'mg')!
  check('口令覆盖：mg 双管轮流/6连发/不产热/弹速51.2m/s/无穿透/DualGun素材/实弹引用',
    mgD.barrels === 2 && mgD.barrelMode === 'sequential' && mgD.burst === 6 && mgD.heatPerShot === 0
    && mgD.projectileSpeed === legacyMeters(400) && mgD.pierce?.count === 0 && mgD.fireRate === 2 && mgD.damage === 5
    && Math.abs(mgD.accuracy - legacyMeters(12)) < 1e-9
    && mgD.art?.turretAsset === 'builtin:library/dualgun_s1' && mgD.art?.barrelAsset === 'builtin:library/dualgun_s2'
    && mgD.art?.baseAsset === 'none' && mgD.art?.projectile === 'bullet_std' && (mgD.art?.barrels?.length ?? 0) === 2,
    JSON.stringify({ barrels: mgD.barrels, mode: mgD.barrelMode, burst: mgD.burst, heat: mgD.heatPerShot, spd: mgD.projectileSpeed }))
  const paB = projectileArtDef('bullet_std')
  const paR = projectileArtDef('rocket_std')
  const paRay = projectileArtDef('ray_std')
  check('弹丸库包含 8 条当前内置载荷（标准脉冲射线已删除）',
    PROJECTILE_ARTS.length === 8 && !projectileArtDef('pulse_std')
    && paB?.projectileAsset === 'builtin:library/shell_s' && paB?.impact !== undefined
    && paR?.projectileAsset === 'builtin:library/missile2_s' && paR?.trail?.template === 'inertia' && paR?.explosion !== undefined
    && paRay?.impact !== undefined
    && projectileArtDef('custom_ammo_1')?.projectileAsset === 'builtin:library/missile2_s'
    && projectileArtDef('custom_ammo_1')?.trail?.template === 'inertia'
    && projectileArtDef('custom_ammo_2')?.projectileAsset === 'builtin:library/shell_m'
    && projectileArtDef('custom_ammo_2')?.kind === 'bullet'
    && projectileArtDef('custom_ammo_3')?.projectileAsset === 'builtin:library/shell_m',
    JSON.stringify(PROJECTILE_ARTS.map(p => [p.id, p.projectileAsset])))
  const fd0 = DEFAULT_FORTRESS
  check('口令覆盖：堡垒 11 炮位（无隐藏炮塔素材、2 个导弹限定）+ 内部空间 18 格',
    fd0.hardpoints.length === 11 && !fd0.hardpoints.some(h => h.hideTurretArt || h.hidden || h.builtIn)
    && (fd0.interiorCells?.length ?? 0) === 18
    && fd0.hardpoints.filter(h => h.types?.includes('missile')).length === 2
    && fd0.hardpoints.some(h => h.id === 'hpL1' && h.size === 'L'),
    `hps=${fd0.hardpoints.length} cells=${fd0.interiorCells?.length}`)
  check('标准导弹旧 upload-1/missile_s 已删除，内置素材数量保持稳定',
    getAsset('upload-1') === undefined && listAssets().filter(a => a.builtin).length === 38,
    JSON.stringify(getAsset('upload-1')))
  importUploads([{ id: 'upload-1', name: 'missile_s', src: 'data:image/png;base64,legacy', category: 'projectile' }])
  check('旧口令不会重新导入已退役的标准导弹固定尾焰贴图', getAsset('upload-1') === undefined)
}
console.log('== 炮塔型号占格取消验收 ==')
{
  check('炮塔定义保留 S/M/L 槽位型号，w/h 仅作为美术坐标范围',
    TURRET_DEFS.every(d => ['S', 'M', 'L'].includes(d.mount) && d.w > 0 && d.h > 0),
    TURRET_DEFS.map(d => `${d.id}:${d.mount}/${d.w}x${d.h}`).join(' '))
  // v2.14：磁轨光束塔口令沉淀为出厂默认（含 ray_std 光束表现组）
  const beam14 = TURRET_DEFS.find(d => d.id === 'beam')!
  const ray14 = PROJECTILE_ARTS.find(a => a.id === 'ray_std')!
  check('磁轨光束塔保留战斗参数，退役炮身与充能贴图后使用无素材回退',
    beam14.cost === 20 && beam14.rotateSpeed === 100 && beam14.aimCone === 5 && beam14.rangeMax === legacyMeters(250) // v2.45 口令(5)：rotateSpeed 90→100
    && beam14.beamWidth === legacyMeters(10) && beam14.dot?.damage === 15 && beam14.dot?.interval === 0.5
    && beam14.fireRate === 4.545 && beam14.mount === 'M' && beam14.w === 1 && beam14.h === 2
    && beam14.chargeTime === 2 && beam14.art?.turretAsset === 'none'
    && beam14.art?.baseAsset === 'none' && beam14.art?.barrelAsset === 'none' && beam14.art?.flashAsset === 'none'
    && beam14.art?.projectile === 'ray_std' && beam14.art?.charge?.asset === 'none'
    && beam14.art?.charge?.frames === 6 && beam14.art?.charge?.offset?.[0] === 0 && beam14.art?.charge?.offset?.[1] === 0.2
    && beam14.art?.barrels?.[0]?.muzzle[1] === 0.7,
    `cost=${beam14.cost} mount=${beam14.mount} charge=${beam14.chargeTime} art=${JSON.stringify(beam14.art?.turretAsset)}`)
  check('v2.19：ray_std 出厂光束表现组 = 口令(4)内容（无闪烁/滚动 224/闪光 0.3×/吸收 26/散发 34·0.05·90°）',
    ray14.beam?.flicker === 0 && ray14.beam?.scrollSpeed === 224
    && ray14.beam?.muzzleScale === 0.3 && ray14.beam?.impactScale === 0.3
    && ray14.beam?.absorb?.rate === 26 && ray14.beam?.absorb?.size === 0.05
    && ray14.beam?.scatter?.rate === 34 && ray14.beam?.scatter?.size === 0.05 && ray14.beam?.scatter?.angle === 90,
    JSON.stringify(ray14.beam))
}
// v2.14：出厂 beam 现带 chargeTime:3，历史光束用例均假设立即起射——统一关闭（后续充能用例自行覆盖/恢复，互不影响）
TURRET_DEFS.find(d => d.id === 'beam')!.chargeTime = 0
console.log('== v1.75 五项优化验收 ==')
{
  const mg75 = TURRET_DEFS.find(d => d.id === 'mg')!
  const b1 = mg75.art?.barrels?.[0]
  const b2 = mg75.art?.barrels?.[1]
  check('全局32px基准：mg 炮口按12px炮管长度对准管尖',
    !!b1 && b1.mount[0] === -0.1 && b1.mount[1] === 0.25 && b1.muzzle[0] === -0.1 && b1.muzzle[1] === 0.625
    && !!b2 && b2.mount[0] === 0.1 && b2.mount[1] === 0.25 && b2.muzzle[0] === 0.1 && b2.muzzle[1] === 0.625,
    JSON.stringify(mg75.art?.barrels))
  const pb75 = projectileArtDef('bullet_std')
  check('v1.83：标准实弹尾焰参数（standard 模板；v1.75 原值 0.05/0.02 亚像素不可见已修正）',
    pb75?.trail?.template === 'standard' && pb75.trail.life === 0.12 && pb75.trail.size === 0.045
    && pb75.trail.inherit === 0.15 && pb75.trail.spread === 0.25,
    JSON.stringify(pb75?.trail))
  // 充能素材字段：口令导出→解析往返不丢失（charge.asset 进入 TurretDef.art 序列化；仅解析不应用，避免注册表被替换）
  const mgC = TURRET_DEFS.find(d => d.id === 'mg')!
  mgC.art!.charge = { offset: [0, 0.3], frames: 4, asset: 'none' }
  const tok75 = exportConfig()
  const parsed75 = parseConfig(tok75)
  const rt = parsed75.ok ? parsed75.bundle.turretDefs.find(d => d.id === 'mg')?.art?.charge : undefined
  check('v1.75：充能素材选择字段随口令往返（charge.asset 保留）',
    parsed75.ok && rt?.asset === 'none' && rt.frames === 4,
    JSON.stringify(rt))
  delete mgC.art!.charge // 还原出厂（mg 默认无充能动画）
  const lv75 = defaultLevel()
  check('v1.75：战场默认纵深 72（v2.45 口令(5)：宽度 36→42）', lv75.rows === 72 && lv75.cols === 42, `rows=${lv75.rows} cols=${lv75.cols}`)
}
console.log('== v1.74 口令素材沉淀验收 ==')
{
  const fx = getAsset('builtin:library/fx_fire_s')
  check('v1.74：fx_fire_S 内置开火效果（flash 分类、内置、展示名 fx_fire_S）',
    !!fx && fx.builtin && fx.category === 'flash' && fx.name === 'fx_fire_S' && fx.src === '/res/library/fx_fire_s.png',
    JSON.stringify(fx ? { id: fx.id, name: fx.name, cat: fx.category, builtin: fx.builtin } : null))
  const s1 = getAsset('builtin:library/dualgun_s1')
  const s2 = getAsset('builtin:library/dualgun_s2')
  check('v1.74：DualGun-_S1 仍在炮身分类 / DualGun-_S2 仍在炮管分类（贴图文件已替换，引用不变）',
    !!s1 && s1.category === 'turret' && s1.builtin && !!s2 && s2.category === 'barrel' && s2.builtin,
    JSON.stringify([s1?.category, s2?.category]))
  // 贴图文件字节级一致性：库内 PNG 与口令 dataURL 解码结果完全一致（替换生效）
  // 口令文件路径经环境变量 TD_TOKEN_FILE 传入；库文件相对项目根（cwd）读取
  const fs = await import('node:fs')
  const dec = (u: string) => Buffer.from(u.split(',')[1], 'base64')
  const tokRaw = fs.readFileSync(process.env.TD_TOKEN_FILE ?? '', 'utf-8').trim()
  const tok = JSON.parse(Buffer.from(tokRaw, 'base64').toString('utf-8'))
  const tk = Object.fromEntries((tok.assets as { id: string; src: string }[]).map(a => [a.id, dec(a.src)]))
  const rd = (f: string) => fs.readFileSync('public/res/library/' + f)
  check('v1.74：dualgun_s1.png == 口令 upload-2（20×20 新贴图）',
    rd('dualgun_s1.png').equals(tk['upload-2']), 'bytes=' + rd('dualgun_s1.png').length)
  check('v1.74：dualgun_s2.png == 口令 upload-3', rd('dualgun_s2.png').equals(tk['upload-3']), 'bytes=' + rd('dualgun_s2.png').length)
  // v2.16：这些内置贴图允许用户替换；PNG 重编码会改变文件字节数，因此只校验格式与运行时依赖的像素尺寸。
  const pngDim = (b: Buffer) => ({ w: b.readUInt32BE(16), h: b.readUInt32BE(20), magic: b.readUInt32BE(0) === 0x89504e47 })
  const fxB = rd('fx_fire_s.png')
  const fxD = pngDim(fxB)
  check('v2.16：fx_fire_s 贴图格式与像素尺寸正确',
    fxD.magic && fxD.w === 6 && fxD.h === 18,
    `fx=${fxD.w}x${fxD.h}/${fxB.length}`)
  // v2.17：missile2_s 内置贴图允许替换，只锁定格式与尺寸，不锁定 PNG 压缩后的字节数。
  const m2B = rd('missile2_s.png')
  const m2D = pngDim(m2B)
  check('v2.17：missile2_s 贴图格式与像素尺寸正确',
    m2D.magic && m2D.w === 3 && m2D.h === 12,
    `m2=${m2D.w}x${m2D.h}/${m2B.length}`)
  // 口令的底座分类素材未残留为出厂上传（"转移"语义：不留副本）
  check('v1.74：upload-2/3/4 不作为出厂上传播种（已转为内置）',
    !getAsset('upload-2') && !getAsset('upload-3') && !getAsset('upload-4'), '')
  // 旧模块用例（用例 52/53 等）基于满矩形内部空间编写：恢复满矩形语义（interiorCells 自由格阵语义由用例 55② 自定义堡垒覆盖）
  delete DEFAULT_FORTRESS.interiorCells
}

// --- v1.77 弹丸出生点/开火效果修复验收 ---
{
  const mg77 = TURRET_DEFS.find(d => d.id === 'mg')!
  check('v1.77：mg 接线内置开火效果 fx_fire_s（flashAsset）',
    mg77.art?.flashAsset === 'builtin:library/fx_fire_s', `flashAsset=${mg77.art?.flashAsset}`)
  const lib77 = getAsset('builtin:library/fx_fire_s')
  check('v1.77：fx_fire_s 素材库条目存在且分类为开火效果',
    !!lib77 && lib77.category === 'flash' && lib77.builtin === true)
  // 炮口对准炮管尖：muzzle.x === mount.x，muzzle.y === mount.y + 管高(12px)/BASE_CELL
  const bars = mg77.art!.barrels!
  check('v1.77：炮口与挂点横向对齐且位于管尖（12px 管 → +0.375 格）',
    bars.every(b => b.muzzle[0] === b.mount[0] && Math.abs(b.muzzle[1] - (b.mount[1] + 12 / BASE_CELL)) < 1e-9),
    JSON.stringify(bars.map(b => b.muzzle)))
  // 弹丸出生点 = 炮口：挂载炮塔实际出生坐标（artPoint 链路验证）
  let st77 = initialState()
  st77 = mountTurret(st77, 'mg', 'hpS1')
  const tur = st77.turrets.find(t => t.defId === 'mg')!
  const mp77 = muzzlePos(tur, mg77, 0)
  const ctr = { x: tur.x + tur.w / 2, y: tur.y + tur.h / 2 }
  const dFwd = (mp77.x - ctr.x) * dirX(tur.angle) + (mp77.y - ctr.y) * dirY(tur.angle)
  const dLat = (mp77.x - ctr.x) * -dirY(tur.angle) + (mp77.y - ctr.y) * dirX(tur.angle)
  check('v1.77：弹丸出生点世界坐标 = 锚点前伸0.625格/横偏-0.1格（炮管尖）',
    Math.abs(dFwd - 0.625) < 1e-6 && Math.abs(dLat - (-0.1)) < 1e-6, `fwd=${dFwd.toFixed(3)} lat=${dLat.toFixed(3)}`)
}

// --- v1.79 高速弹丸出生帧位置验收 ---
{
  Math.random = zeroRandom
  const mg = TURRET_DEFS.find(d => d.id === 'mg')!
  const burst0 = mg.burst
  mg.burst = 1 // 单发便于定位
  let s = arena()
  const t = mkTurret(s, 'mg', 6, 20)
  mkEnemy(s, 'walker', 6.5, 16)
  let first: { x: number; y: number; traveled: number } | null = null
  for (let i = 0; i < 40 && !first; i++) {
    s = tick(s, 0.05)
    const p = s.projectiles.find(p2 => p2.shooter === t.id)
    if (p) first = { x: p.x, y: p.y, traveled: p.traveled }
  }
  const mz = muzzlePos(byId(s.turrets, t.id)!, mg, 0)
  check('v1.79：高速弹丸首个可见帧恰在炮口（51.2m/s 不再偏移 v·dt）',
    !!first && Math.abs(first.x - mz.x) < 0.01 && Math.abs(first.y - mz.y) < 0.01,
    first ? `first=(${first.x.toFixed(2)},${first.y.toFixed(2)}) muzzle=(${mz.x.toFixed(2)},${mz.y.toFixed(2)})` : '未击发')
  check('v1.79：射程口径不变（首 tick 后 traveled=0）',
    !!first && Math.abs(first.traveled) < 1e-9, `traveled=${first?.traveled}`)
  mg.burst = burst0
}

// --- v1.85 履带瓦片循环验收 ---
{
  const t85 = DEFAULT_FORTRESS.tracks![0] // trackL：几何原点坐标 x=-2.07，y1=3.17（前），y2=-3.37（后）
  const tileLen85 = 8 / BASE_CELL // 板长取瓦片原图高并按全局格像素换算
  const step85 = tileLen85 - t85.overlapPx / BASE_CELL
  const Lc85 = Math.hypot(t85.x2 - t85.x1, t85.y2 - t85.y1)
  const pl = trackPlacements(t85, 0, tileLen85)
  const straight = pl.filter(q => q.scaleY === 1)
  const roll = pl.filter(q => q.scaleY < 1)
  check('v1.86：默认堡垒仅配置左履带（右侧自动镜像）且通过校验',
    DEFAULT_FORTRESS.tracks!.length === 1 && !validateFortressDef(DEFAULT_FORTRESS).some(e => e.includes('履带')), '')
  check('v1.85：直线段瓦片全尺寸不透明', straight.length > 0 && straight.every(q => q.alpha === 1), '')
  check('v1.85：直线段瓦片数 ≈ 轮心距/步长', Math.abs(straight.length - Lc85 / step85) < 1.5,
    `实${straight.length} vs 期望${(Lc85 / step85).toFixed(1)}`)
  // 翻滚区：步长 > 翻滚区长时单相位可能仅 1 枚 → 扫一个完整步长周期收集
  let minScale = 1, rollSeen = 0, rollAlphaOk = true
  for (let k = 0; k < 6; k++) {
    for (const q of trackPlacements(t85, step85 * k / 6, tileLen85)) {
      if (q.scaleY < 1) { rollSeen++; if (q.alpha >= 1) rollAlphaOk = false; if (q.scaleY < minScale) minScale = q.scaleY }
    }
  }
  check('v1.85：翻滚区瓦片透视压缩+渐暗（周期扫描：出现压扁瓦片、最扁 <0.3、alpha<1）',
    rollSeen >= 2 && minScale < 0.3 && rollAlphaOk, `seen=${rollSeen} minScale=${minScale.toFixed(2)} roll@相位0=${roll.map(q => q.scaleY.toFixed(2)).join(',')}`)
  // 循环：相位 + 整步 → 排布逐枚一致
  const pl2 = trackPlacements(t85, step85, tileLen85)
  check('v1.85：相位 + 一个步长 → 排布相同（无缝循环）',
    pl.length === pl2.length && pl.every((q, i) => Math.abs(q.x - pl2[i].x) < 1e-9 && Math.abs(q.y - pl2[i].y) < 1e-9 && q.scaleY === pl2[i].scaleY), '')
  // 正相位代表前进。路径坐标 s 的正方向为船头→船尾，因此可见纹理应取反，向船头滚动。
  // 使用 1/4 步（而非对称的半步）检查相位符号，避免正反方向得到相同循环排布。
  const pl3 = trackPlacements(t85, step85 / 4, tileLen85)
  const ux85 = (t85.x2 - t85.x1) / Lc85, uy85 = (t85.y2 - t85.y1) / Lc85
  const axis85 = (q: { x: number; y: number }) => (q.x - t85.x1) * ux85 + (q.y - t85.y1) * uy85
  const straight0 = pl.find(q => q.scaleY === 1 && axis85(q) > step85 && axis85(q) < Lc85 - step85)
  const straight3 = pl3.find(q => q.scaleY === 1 && axis85(q) > step85 && axis85(q) < Lc85 - step85)
  const baseRemainder = straight0 ? ((axis85(straight0) % step85) + step85) % step85 : -1
  const phaseRemainder = straight3 ? ((axis85(straight3) % step85) + step85) % step85 : -1
  const expectedRemainder = ((baseRemainder - step85 / 4) + step85) % step85
  check('履带方向：前进正相位时可见纹理向船头滚动', !!straight0 && !!straight3 && Math.abs(phaseRemainder - expectedRemainder) < 1e-9,
    `remainder=${phaseRemainder.toFixed(6)} expected=${expectedRemainder.toFixed(6)}`)
  // v1.89：弧长参数化后全程无缝隙——多相位扫描，任意相邻瓦片（含翻滚区）投影间距 ≤ 两者平均压缩高 + 0.005 格
  {
    let maxGap89 = -1
    for (const ph89 of [0, step85 / 3, step85 * 2 / 3]) {
      const qs = trackPlacements(t85, ph89, tileLen85)
      for (let i = 1; i < qs.length; i++) {
        const a = qs[i - 1], b = qs[i]
        const dist = Math.hypot(b.x - a.x, b.y - a.y)
        const hAvg = tileLen85 * (a.scaleY + b.scaleY) / 2
        const gap = dist - hAvg
        if (gap > maxGap89) maxGap89 = gap
      }
    }
    check('v1.89：履带全程无缝隙（相邻瓦片间距 ≤ 平均压缩高 +0.005格，含翻滚区）', maxGap89 < 0.005, `maxGap=${(maxGap89 * BASE_CELL).toFixed(2)}px`)
  }
  // 引擎相位：前进累加（双履带同向）
  let st = arena()
  st.phase = 'prep'
  st.moveDir = { x: 0, y: -1 }
  st = run(st, 1.0, 0.05)
  check('v1.85：前进时双履带相位同步累加', st.fortress.trackPhase.length === 2 && st.fortress.trackPhase[0] > 0.5 && st.fortress.trackPhase[1] > 0.5
    && Math.abs(st.fortress.trackPhase[0] - st.fortress.trackPhase[1]) < 1e-9,
    st.fortress.trackPhase.map(v => v.toFixed(2)).join(','))
  // 倒退反滚
  let srv = arena()
  srv.phase = 'prep'
  srv.reverse = true
  srv = run(srv, 0.8, 0.05)
  check('v1.85：倒退时履带相位反向（反滚）', srv.fortress.trackPhase[0] < -0.1 && srv.fortress.trackPhase[1] < -0.1,
    srv.fortress.trackPhase.map(v => v.toFixed(2)).join(','))
  // 弧线转向差速：右转（desiredHeading=90°）→ 外侧（左）履带相位领先
  let sd = arena()
  sd.phase = 'prep'
  sd.desiredHeading = 90 * (Math.PI / 180)
  sd = run(sd, 2.0, 0.05)
  check('v1.85：弧线转向外侧履带更快（右转→左履带相位领先）',
    sd.fortress.trackPhase[0] > sd.fortress.trackPhase[1] + 0.05,
    sd.fortress.trackPhase.map(v => v.toFixed(2)).join(','))
  // 校验拦截非法履带
  check('v1.85：validateFortressDef 拦截非法履带（轮心重合/重叠超限）',
    validateFortressDef({ ...DEFAULT_FORTRESS, tracks: [{ ...t85, id: 'bad1', x2: t85.x1, y2: t85.y1 }] }).some(e => e.includes('轮心'))
    && validateFortressDef({ ...DEFAULT_FORTRESS, tracks: [{ ...t85, id: 'bad2', overlapPx: 31 }] }).some(e => e.includes('重叠')), '')
}

// --- v1.83 标准实弹尾焰可见性验收 ---
{
  const tf = resolveTrailFx(PROJECTILE_ARTS.find(a => a.id === 'bullet_std')!)
  check('v1.83：标准实弹尾焰配置存在（standard 模板）', !!tf && tf.template === 'standard', '')
  // 可见性阈值：size >= 0.04 格（≈1.2px 半径 @zoom1，贴图绘制直径 ×2）、life >= 0.1s（>=6 帧 @60fps）
  check('v1.83：标准实弹尾焰尺寸可见（>=0.04 格）', !!tf && tf.size >= 0.04, `size=${tf?.size}`)
  check('v1.83：标准实弹尾焰寿命可见（>=0.1s）', !!tf && tf.life >= 0.1, `life=${tf?.life}`)
  check('v1.83：标准实弹尾焰发射速率 > 0', !!tf && tf.rate > 0, `rate=${tf?.rate}`)
}

// --- v1.82 炮塔渲染层级验收 ---
{
  let s82 = initialState()
  s82.gold = 10000 // 层级测试与资源无关：补足资源避免 mountTurret 因余额不足空转
  // 使用旧 S/M/L 字段不同的三个炮位；型号不再影响挂载或绘制顺序。
  const fd82 = DEFAULT_FORTRESS
  const hpS = fd82.hardpoints.find(h => h.size === 'S' && !h.hidden)!
  const hpM = fd82.hardpoints.find(h => h.size === 'M' && !h.hidden)!
  const hpL = fd82.hardpoints.find(h => h.size === 'L' && !h.hidden)!
  s82 = mountTurret(s82, 'cruise', hpL.id)   // L 先放置（插入序在前）
  s82 = mountTurret(s82, 'mg', hpS.id)       // S 后放置
  s82 = mountTurret(s82, 'lob', hpM.id)      // M 最后
  const ids = s82.turrets.map(t => t.id)
  const sorted = [...s82.turrets].sort((a, b) => {
    const ka = turretRenderKey(s82, a), kb = turretRenderKey(s82, b)
    return ka[0] - kb[0] || ka[1] - kb[1]
  }).map(t => t.id)
  const mgId = s82.turrets.find(t => t.defId === 'mg')!.id
  const lobId = s82.turrets.find(t => t.defId === 'lob')!.id
  const cruiseId = s82.turrets.find(t => t.defId === 'cruise')!.id
  check('炮塔槽位型号保留：绘制顺序 S→M→L，与放置顺序无关',
    sorted.join(',') === [mgId, lobId, cruiseId].join(','),
    `sorted=${sorted} 原始=${ids}`)
  // zLevel 大者层级高（在上）；缺省 = 1
  fd82.hardpoints.find(h => h.id === hpS.id)!.zLevel = 5
  const hpS2 = fd82.hardpoints.filter(h => h.size === 'S' && !h.hidden && h.id !== hpS.id)[0]
  if (hpS2) {
    s82 = mountTurret(s82, 'mg', hpS2.id) // 第二台 S（zLevel 缺省 1）
    const s2Id = s82.turrets[s82.turrets.length - 1].id
    const k1 = turretRenderKey(s82, s82.turrets.find(t => t.id === mgId)!)
    const k2 = turretRenderKey(s82, s82.turrets.find(t => t.id === s2Id)!)
    check('v1.82：同尺寸按炮位 zLevel 排序（zLevel=5 在 缺省1 之上）',
      k1[0] === k2[0] && k1[1] === 5 && k2[1] === 1,
      `k1=${k1} k2=${k2}`)
  } else {
    check('v1.82：同尺寸按炮位 zLevel 排序（单 S 炮位跳过）', turretRenderKey(s82, s82.turrets.find(t => t.id === mgId)!)[1] === 5, '')
  }
  fd82.hardpoints.find(h => h.id === hpS.id)!.zLevel = undefined // 还原
  // 校验：zLevel 非数值报错
  check('v1.82：validateFortressDef 拦截非法 zLevel',
    validateFortressDef({ ...fd82, hardpoints: [{ ...hpS, zLevel: NaN }] }).some(e => e.includes('层级')),
    '')
  check('v1.82：默认堡垒炮位 zLevel 缺省合法（校验通过项不增）',
    !validateFortressDef(fd82).some(e => e.includes('层级')), '')
  check('炮位车体遮挡：层级 -1 及更低绘制在载具主体下方',
    hardpointBelowVehicleBody({ zLevel: -1 }) && hardpointBelowVehicleBody({ zLevel: -3 }), '')
  check('炮位车体遮挡：缺省、0 与大于0层级保持在载具主体上方',
    !hardpointBelowVehicleBody() && !hardpointBelowVehicleBody({ zLevel: 0 }) && !hardpointBelowVehicleBody({ zLevel: 2 }), '')
}




// --- 用例 1：v1.98 取消炮塔最大角度——地面炮塔 360° 自由旋转，正后方目标也能打 ---
{
  Math.random = zeroRandom
  let s = arena()
  const t = mkTurret(s, 'mg', 6, 20) // 炮口 6.5,20.5 朝 0°（上）；旧机制 arc=150 单边 ±75° 打不到正后方
  const e = mkEnemy(s, 'walker', 6.5, 25) // 正下方，bearing 180°（旧机制的射界外）
  s = run(s, 3, 0.05)
  const tt = byId(s.turrets, t.id)!
  const ee = byId(s.enemies, e.id)!
  check('v1.98：取消最大角度后炮塔可转过旧射界（>75°）', Math.abs(tt.angle) > 75 * Math.PI / 180, `angle=${tt.angle}`)
  check('v1.98：取消最大角度后正后方目标正常开火', ee.hp < 100000, `hp=${ee.hp}`)
}

// --- 用例 1b：射角内免转炮开火；射角外只转到目标进入射角即停 ---
{
  Math.random = zeroRandom
  let s = arena()
  const t = mkTurret(s, 'mg', 6, 20) // 炮口朝 0°（上），射角 12°（±6°）
  const dx = Math.tan(4 * Math.PI / 180) * 4 // bearing ≈ +4°，射角内
  mkEnemy(s, 'walker', 6.5 + dx, 16.5)
  s = run(s, 0.5, 0.05)
  const tt = byId(s.turrets, t.id)!
  check('射角内免转炮', Math.abs(tt.angle) <= 1e-9, `angle=${tt.angle}`)
  check('射角内直接开火', s.enemies[0].hp < 100000)
}
{
  Math.random = zeroRandom
  let s = arena()
  const t = mkTurret(s, 'mg', 6, 20)
  const dx = Math.tan(30 * Math.PI / 180) * 4 // bearing ≈ +30°，射角外、最大角度内
  mkEnemy(s, 'walker', 6.5 + dx, 16.5)
  s = run(s, 1.5, 0.05)
  const tt = byId(s.turrets, t.id)!
  const deg = tt.angle * 180 / Math.PI
  check('射角外转到目标进入射角即停', deg >= 23 && deg <= 30.5, `angle=${deg}`)
  check('进入射角即开火', s.enemies[0].hp < 100000)
}

// --- 用例 2：射程区间 ---
{
  Math.random = zeroRandom
  let s = arena()
  const t = mkTurret(s, 'mg', 6, 20) // mg 射程 25–150m = 1–6 格
  const e = mkEnemy(s, 'walker', 6.5, 20.1) // 距离 0.4 格 < 最小射程
  s = run(s, 1.5, 0.05)
  check('小于最小射程不射击', byId(s.enemies, e.id)!.hp === 100000 && s.projectiles.length === 0)
  byId(s.enemies, e.id)!.y = 13.4 // 距离 7.1 格 > 最大射程
  s = run(s, 1.5, 0.05)
  check('大于最大射程不射击', byId(s.enemies, e.id)!.hp === 100000)
  byId(s.enemies, e.id)!.y = 17 // 3.5 格，区间内
  s = run(s, 1.5, 0.05)
  check('回到区间内恢复射击', byId(s.enemies, e.id)!.hp < 100000)
  void t
}

// --- 用例 3：仅对地炮塔不索空中目标 ---
{
  Math.random = zeroRandom
  let s = arena()
  mkTurret(s, 'mg', 6, 20)
  const e = mkEnemy(s, 'flyer', 6.5, 16)
  s = run(s, 2, 0.05)
  check('仅对地不攻击空中目标', byId(s.enemies, e.id)!.hp === 100000 && s.projectiles.length === 0)
}

// --- 战斗 HUD：每座玩家炮塔可独立关闭/恢复自动开火 ---
{
  Math.random = zeroRandom
  let s = arena()
  const turret = mkTurret(s, 'mg', 6, 20)
  const enemy = mkEnemy(s, 'walker', 6.5, 16)
  s = setTurretAutoFire(s, turret.id, false)
  s = run(s, 1, 0.05)
  check('炮塔自动开火关闭后不会造成伤害', byId(s.enemies, enemy.id)!.hp === 100000)
  s = setTurretAutoFire(s, turret.id, true)
  s = run(s, 1, 0.05)
  check('炮塔自动开火重新开启后恢复攻击', byId(s.enemies, enemy.id)!.hp < 100000)
}

// --- 用例 4：穿透 2、衰减 30%，4 敌一线 => 命中 3 个，70% / 49% ---
{
  Math.random = zeroRandom
  const mgP = TURRET_DEFS.find(d => d.id === 'mg')!
  const ammoP = PROJECTILE_ARTS.find(a => a.id === mgP.art?.projectile)!
  const pierce0 = ammoP.pierce
  const accuracy0 = mgP.accuracy
  ammoP.pierce = { count: 2, decay: 0.3 } // 战斗属性已迁移到弹丸库
  mgP.accuracy = 0 // 隔离穿透机制，不依赖全局随机数关闭散布
  let s = arena()
  mkTurret(s, 'mg', 6, 20) // 伤害 12，穿透 2，衰减 30%
  const es = [17, 16, 15, 14].map(y => mkEnemy(s, 'walker', 6.5, y))
  s = run(s, 1.0, 0.05) // 一轮 3 连发全部穿过
  const hps = es.map(e => byId(s.enemies, e.id)!.maxHp - byId(s.enemies, e.id)!.hp)
  const [h1, h2, h3, h4] = hps
  check('穿透命中前 3 个', h1 > 0 && h2 > 0 && h3 > 0, `hps=${hps}`)
  check('第 4 个不受伤害', h4 === 0, `h4=${h4}`)
  check('第 2 个伤害 70%', Math.abs(h2 / h1 - 0.7) < 0.02, `${h2}/${h1}`)
  check('第 3 个伤害 49%', Math.abs(h3 / h1 - 0.49) < 0.02, `${h3}/${h1}`)
  ammoP.pierce = pierce0
  mgP.accuracy = accuracy0
}

// --- 用例 6：连发 3、弹药不足时射出可负担发数后停射 ---
{
  Math.random = zeroRandom
  const savedRegen = AMMO.regen
  AMMO.regen = 0 // 关闭回复，隔离测试
  const diss0 = gameParameters().naturalHeatDissipation
  setNaturalHeatDissipation(0) // 关闭散热，精确计量产热
  let s = arena()
  const t = mkTurret(s, 'mg', 6, 20)
  t.ammo = 2 // mg 弹药 1/发，连发 3；资源归属于炮塔实例
  mkEnemy(s, 'walker', 6.5, 16)
  s = run(s, 1.5, 0.05)
  const mg6 = TURRET_DEFS.find(d => d.id === 'mg')! // v1.72：热量按出厂 heatPerShot 动态折算（口令出厂 = 0）
  const ammoLeft = byId(s.turrets, t.id)!.ammo
  check('弹药 2 时射出 2 发停射', ammoLeft === 0 && s.fortress.heat === (mg6.heatPerShot ?? 0) * 2, `ammo=${ammoLeft} heat=${s.fortress.heat}`)
  AMMO.regen = savedRegen
  setNaturalHeatDissipation(diss0)
}

// --- 用例 7（汇聚替代）：热量 25/发 => 堡垒池第 4 发后过热全停，散热至 50% 恢复 ---
{
  Math.random = zeroRandom
  const mg = TURRET_DEFS.find(d => d.id === 'mg')!
  const oldHeat = mg.heatPerShot!
  mg.heatPerShot = 25
  const cap0 = DEFAULT_FORTRESS.heatCap
  const diss0 = gameParameters().naturalHeatDissipation
  DEFAULT_FORTRESS.heatCap = 100
  setNaturalHeatDissipation(0) // 隔离散热，精确计量产热
  let s = arena()
  mkTurret(s, 'mg', 6, 20)
  mkEnemy(s, 'walker', 6.5, 16, 1e9)
  let sawOverheat = false
  let heatAtOverheat = 0
  s = run(s, 6, 0.05, (g) => {
    if (g.fortress.overheated && !sawOverheat) { sawOverheat = true; heatAtOverheat = g.fortress.heat }
  })
  check('第 4 发后堡垒热量 100 过热（汇聚全停）', sawOverheat && heatAtOverheat === 100, `heat=${heatAtOverheat}（=4发×25）`)
  setNaturalHeatDissipation(20) // 恢复散热 → 降至上限 50% 解除
  let resumed = false
  s = run(s, 6, 0.05, (g) => {
    if (sawOverheat && !g.fortress.overheated && g.fortress.heat > 0) resumed = true
  })
  check('散热至 50% 后恢复射击', resumed)
  mg.heatPerShot = oldHeat
  DEFAULT_FORTRESS.heatCap = cap0
  setNaturalHeatDissipation(diss0)
}

// --- 用例 8（v2.22 移除）：人员机制已删除——原「人员不足 => 完全停止工作」用例随 crewFactor 一并移除 ---
{
  // v2.22 出厂断言：全部炮塔定义不再携带 crew/minCrew
  const withCrew = TURRET_DEFS.filter(d => 'crew' in d || 'minCrew' in d)
  check('v2.22：出厂炮塔定义不含人员/最少人员参数', withCrew.length === 0, `残留=${withCrew.map(d => d.id).join(',')}`)
}

// --- 用例 9：射线持续伤害 tick / 宽幅矩形 / 耗电 ---
{
  Math.random = zeroRandom
  let s = arena()
  const t = mkTurret(s, 'beam', 5, 20) // 中心 6,20.5；持续 10/0.5s，攻击持续 3s
  t.energy = 100
  const e1 = mkEnemy(s, 'walker', 6.0, 16) // 波束内
  const e2 = mkEnemy(s, 'walker', 1.5, 16) // 波束外（远离堡垒，不被索敌选中）
  const energy0 = t.energy ?? 0
  s = run(s, 4, 0.05)
  const d1 = byId(s.enemies, e1.id)!.maxHp - byId(s.enemies, e1.id)!.hp
  const d2 = byId(s.enemies, e2.id)!.maxHp - byId(s.enemies, e2.id)!.hp
  // 单轮 3s / 0.5s = 6~7 次 tick × 15 伤（v2.14 出厂 DoT 10→15）
  check('射线波束内敌人按 tick 受伤', d1 >= 80 && d1 <= 115, `d1=${d1}`)
  check('波束外敌人不受影响', d2 === 0)
  const energyLeft = byId(s.turrets, t.id)!.energy ?? 0
  check('射线消耗电量（发射+维持）', energy0 - energyLeft >= 15, `used=${energy0 - energyLeft}`)
}

// --- 用例 10：喷射扇形 + 弹药消耗，弹药不足立即停射 ---
{
  Math.random = zeroRandom
  const savedRegen = AMMO.regen
  AMMO.regen = 0 // 关闭回复，隔离测试
  let s = arena()
  const t = mkTurret(s, 'spray', 6, 20) // 60° 扇形朝 0°
  t.ammo = 6 // 喷射 5/s，仅够约 1.2s（不足 2.5s 全程）
  const e1 = mkEnemy(s, 'walker', 6.5, 18.5) // 扇形内
  const e2 = mkEnemy(s, 'walker', 3.0, 20.4) // 扇形外（bearing≈-95°）
  let fireStart = -1
  let fireEnd = -1
  s = run(s, 4, 0.05, g => {
    const firing = byId(g.turrets, t.id)!.firing
    if (firing && fireStart < 0) fireStart = g.time
    if (!firing && fireStart >= 0 && fireEnd < 0) fireEnd = g.time
  })
  const d1 = byId(s.enemies, e1.id)!.maxHp - byId(s.enemies, e1.id)!.hp
  const d2 = byId(s.enemies, e2.id)!.maxHp - byId(s.enemies, e2.id)!.hp
  check('扇形内敌人受伤', d1 > 0, `d1=${d1}`)
  check('扇形外敌人不受影响', d2 === 0)
  check('弹药不足提前中断喷射', fireStart >= 0 && fireEnd > fireStart && fireEnd - fireStart < 2.5,
    `session=${(fireEnd - fireStart).toFixed(2)}s`)
  check('喷射消耗弹药', (byId(s.turrets, t.id)!.ammo ?? Infinity) <= 1)
  AMMO.regen = savedRegen
}

// --- 用例 12：非制导导弹锁定原落点 ---
{
  Math.random = zeroRandom
  const cruise = TURRET_DEFS.find(d => d.id === 'cruise')!
  const accuracy0 = cruise.accuracy
  cruise.accuracy = 0 // 隔离锁定落点机制，不依赖全局随机数关闭散布
  let s = arena()
  const t = mkTurret(s, 'cruise', 6, 20) // 射程 100–300m = 4–12 格
  const e = mkEnemy(s, 'walker', 6.5, 10)
  let lockX = 0
  let lockY = 0
  let launched = false
  let fxX = -1
  let fxY = -1
  s = run(s, 6, 0.05, g => {
    if (!launched) {
      const m = g.projectiles.find(p => p.kind === 'missile')
      if (m) {
        launched = true
        lockX = m.lockX; lockY = m.lockY
        // 目标移出落点，并撤掉炮塔避免后续弹
        const ee = byId(g.enemies, e.id)!
        ee.x = 11; ee.y = 15
        g.turrets = g.turrets.filter(x => x.id !== t.id)
      }
    } else if (fxX < 0) {
      const fx = g.explosions.find(x => Math.hypot(x.x - lockX, x.y - lockY) < 0.3)
      if (fx) { fxX = fx.x; fxY = fx.y }
    }
  })
  const ee = byId(s.enemies, e.id)!
  check('非制导导弹锁定发射瞬间落点', launched && Math.hypot(lockX - 6.5, lockY - 10) < 0.01, `lock=(${lockX},${lockY})`)
  check('导弹仍飞向原坐标爆炸', fxX >= 0 && Math.hypot(fxX - lockX, fxY - lockY) < 0.3)
  check('移出落点的目标不受爆炸伤害', ee.hp === ee.maxHp, `hp=${ee.hp}`)
  cruise.accuracy = accuracy0
}

// --- 用例 13a：制导导弹追踪命中 ---
{
  Math.random = zeroRandom
  let s = arena()
  mkTurret(s, 'hunter', 6, 20)
  const e = mkEnemy(s, 'walker', 6.5, 12) // 开阔地上的目标
  s = run(s, 6, 0.05)
  const ee = byId(s.enemies, e.id)!
  check('制导导弹追踪命中目标', ee.hp < ee.maxHp, `hp=${ee.hp}/${ee.maxHp}`)
}

// --- 用例 13b（v2.1 重写）：越过目标/转向不足不再失去锁定，持续转弯朝目标飞 ---
{
  Math.random = zeroRandom
  const hunter = TURRET_DEFS.find(d => d.id === 'hunter')!
  const savedTurn = hunter.missileTurnMax!
  const savedAccel = hunter.missileTurnAccel!
  const savedDelay = hunter.guideDelay
  hunter.missileTurnMax = 25
  hunter.missileTurnAccel = 50
  delete hunter.guideDelay // 立即制导，聚焦追踪行为
  let s = arena()
  mkTurret(s, 'hunter', 6, 20)
  mkEnemy(s, 'walker', 6.5, 12)
  let p0: (typeof s.projectiles)[number] | undefined
  for (let i = 0; i < 60 && !p0; i++) {
    s = tick(s, 0.05)
    p0 = s.projectiles.find(p => p.kind === 'missile')
  }
  // 强制构造旧机制的脱靶几何：导弹在目标上方 2 格、航向正上（背向目标，diff=180°、正在远离）
  const pid = p0!.id
  p0!.x = 6.5; p0!.y = 10
  p0!.heading = 0
  p0!.speed = legacyMeters(50)
  const h0 = p0!.heading
  s = run(s, 2, 0.05)
  const pp1 = s.projectiles.find(q => q.id === pid)
  const turned = pp1 ? Math.abs(wrapAngle(pp1.heading - h0)) : 0
  check('v2.1：脱靶几何下导弹不再失去锁定（lostLock 恒 false）',
    !!pp1 && pp1.lostLock === false, `lostLock=${pp1?.lostLock}`)
  check('v2.1：导弹持续以最大转向能力朝目标转弯（2s 转角 ≥40°，转向速率顶格 25°/s）',
    !!pp1 && turned >= 40 * Math.PI / 180 && pp1.turnRate >= 25 * Math.PI / 180 - 1e-6,
    `turned=${(turned * 180 / Math.PI).toFixed(1)}° turnRate=${pp1 ? (pp1.turnRate * 180 / Math.PI).toFixed(1) : '?'}°/s`)
  hunter.missileTurnMax = savedTurn
  hunter.missileTurnAccel = savedAccel
  hunter.guideDelay = savedDelay
}

// --- 用例 13c：v2.33 导弹载体速度继承（堡垒挂载继承 / 地面炮塔不继承） ---
{
  Math.random = zeroRandom
  const hunter = TURRET_DEFS.find(d => d.id === 'hunter')!
  const savedCurve = hunter.missileCurve
  hunter.missileCurve = 0 // 排除蛇形摆动对航向的干扰（测完恢复）
  const dt33 = 0.05
  // ① 堡垒挂载：出生速度向量 = 初速×炮塔航向 + 堡垒速度（格/s × M_PER_CELL），合成折回 航向+标量
  {
    let s = fresh() // mountTurret 仅备战期生效
    s = mountTurret(s, 'hunter', 'hpS1')
    s.phase = 'combat'
    s.ammo = 100000; s.energy = 100000
    s.fortress.vx = 6 // 无输入逐 tick 衰减，但 tick 内 移动(更新vx)→开火 顺序保证：出生后读到的 vx 即开火时所用值
    s.fortress.vy = 0
    mkEnemy(s, 'walker', s.fortress.x + 2, s.fortress.y - 6) // 上方（hpS1 视界 215°~375° 内）
    let p0: (typeof s.projectiles)[number] | undefined
    for (let i = 0; i < 80 && !p0; i++) { s = tick(s, dt33); p0 = s.projectiles.find(p => p.kind === 'missile') }
    check('v2.33：挂载猎手已发射', !!p0, '')
    if (p0) {
      const tur = s.turrets.find(t => t.defId === 'hunter')! // rotateSpeed=0：航向=挂载初始角，恒定
      const expVx = dirX(tur.angle) * (hunter.missileInitSpeed ?? 0) + s.fortress.vx * M_PER_CELL
      const expVy = dirY(tur.angle) * (hunter.missileInitSpeed ?? 0) + s.fortress.vy * M_PER_CELL
      const v0 = Math.hypot(expVx, expVy)
      const hExp = Math.atan2(expVx, -expVy) // bearing 同口径
      const spdAfter1 = v0 - (hunter.guideDecel ?? 0) * dt33 // 出生 tick 已推进一次（延迟期减速）
      check('v2.33：挂载导弹出生初速 = 载体速度合成（减速一次后）', Math.abs(p0.speed - spdAfter1) < 1e-6,
        `speed=${p0.speed.toFixed(3)} exp=${spdAfter1.toFixed(3)}`)
      check('v2.33：挂载导弹出生航向 = 合成向量方向', Math.abs(wrapAngle(p0.heading - hExp)) < 1e-6,
        `h=${p0.heading.toFixed(4)} exp=${hExp.toFixed(4)}`)
      check('v2.33：合成初速显著大于裸初速（继承生效）', v0 > (hunter.missileInitSpeed ?? 0) + 1, `v0=${v0.toFixed(1)}`)
    }
  }
  // ② 地面炮塔（无 hardpointId）不继承：堡垒同速移动，出生速度向量 = 初速×航向
  {
    let s = arena()
    const tur = mkTurret(s, 'hunter', 6, 20)
    s.fortress.vx = 6
    s.fortress.vy = 0
    mkEnemy(s, 'walker', 6.5, 12)
    let p0: (typeof s.projectiles)[number] | undefined
    for (let i = 0; i < 80 && !p0; i++) { s = tick(s, dt33); p0 = s.projectiles.find(p => p.kind === 'missile') }
    check('v2.33：地面猎手已发射', !!p0, '')
    if (p0) {
      const spdAfter1 = (hunter.missileInitSpeed ?? 0) - (hunter.guideDecel ?? 0) * dt33
      check('v2.33：地面导弹出生初速 = 裸初速（不继承载体速度）', Math.abs(p0.speed - spdAfter1) < 1e-6,
        `speed=${p0.speed.toFixed(3)} exp=${spdAfter1.toFixed(3)}`)
      check('v2.33：地面导弹出生航向 = 炮塔航向', Math.abs(wrapAngle(p0.heading - tur.angle)) < 1e-6,
        `h=${p0.heading.toFixed(4)} angle=${tur.angle.toFixed(4)}`)
    }
  }
  hunter.missileCurve = savedCurve
}

// --- 用例 16：断电无法开火 ---
{
  Math.random = zeroRandom
  let s = arena()
  const t = mkTurret(s, 'beam', 5, 20)
  t.energy = 0
  mkEnemy(s, 'walker', 6.0, 16)
  s = run(s, 0.8, 0.05) // 回电 9/s，0.8s 仅 7.2 < 发射电量 15
  check('发射电量不足无法开火', !byId(s.turrets, t.id)!.firing && s.projectiles.length === 0)
}

console.log('== 战场验收 ==')

// --- 模板闭合校验（用例 15）---
{
  const s = walled()
  check('闭合模板校验通过', validateTemplateClosed(s))
  const broken = walled()
  const gapWall = broken.walls.find(w => w.cells[0].x === 5 && w.cells[0].y === TEMPLATE_TOP)! // 顶边中格
  gapWall.state = 'destroyed' // 外轮廓开口
  gapWall.hp = 0
  check('存在缺口的模板校验失败', !validateTemplateClosed(broken))
}

// --- 用例 3/5/7：墙段摧毁 => 入口生成 + 重寻路 + 相邻墙不受影响 ---
{
  Math.random = zeroRandom
  let s = walled()
  s.phase = 'combat'
  const seg = s.walls.find(w => w.cells[0].x === 5 && w.cells[0].y === TEMPLATE_TOP)! // 顶边中格（拆后成缺口）
  const v0 = s.pathVersion
  seg.hp = 0
  seg.state = 'destroyed'
  s.pathVersion++
  check('墙段摧毁形成可通行缺口', s.walls[1].hp === s.walls[1].maxHp)
  check('重寻路事件触发', s.pathVersion === v0 + 1)
  // 敌人从缺口进入
  const e = mkEnemy(s, 'walker', 4.5, 10)
  e.controller = 'ai'
  e.mode = 'move'; e.targetKind = null; e.targetId = null; e.hasGoal = false
  s = run(s, 20, 0.05)
  const ee = byId(s.enemies, e.id)
  check('入口开放后敌人经缺口进入基地', !ee || ee.y > TEMPLATE_TOP + 0.5 || (ee.mode === 'attack' && ee.targetKind !== 'wall'))
}

// --- 用例 6：墙全完好时寻路终点为墙前，无直达内部路径 ---
{
  const s = walled()
  const dist = computePathField(s)
  // 出生带任一格的距离场必须经由墙（距离含结构惩罚 200）
  const d = dist[1 * COLS + 5]
  check('墙完好时无直达核心路径（必经墙体）', isFinite(d) && d >= 200, `dist=${d}`)
}

// --- 用例 16（新语义）：缺口不可封堵——墙段不可建造，敌人经缺口进入基地内部 ---
{
  Math.random = zeroRandom
  let s = walled()
  s.phase = 'combat'
  const seg = s.walls.find(w => w.cells[0].x === 5 && w.cells[0].y === TEMPLATE_TOP)! // 顶边中格（摧毁成缺口）
  seg.hp = 0
  seg.state = 'destroyed'
  s.pathVersion++
  const wallsBefore = s.walls.length
  // 缺口格仍是基地格/墙段 → 扩建拒绝、无墙可建
  s.phase = 'prep'
  const g0 = placeBaseCellAt(s, 5, TEMPLATE_TOP)
  check('缺口格不可封堵（已是基地格，墙段不可建造）',
    g0.walls.length === wallsBefore && !g0.walls.some(w => w.state === 'intact' && w.cells[0].x === 5 && w.cells[0].y === TEMPLATE_TOP),
    `walls=${g0.walls.length - wallsBefore}`)
  s.phase = 'combat'
  // 敌人经缺口进入基地内部
  const e0 = mkEnemy(s, 'walker', 4.5, 10)
  e0.controller = 'ai'
  e0.mode = 'move'; e0.targetKind = null; e0.targetId = null; e0.hasGoal = false
  s = run(s, 20, 0.05)
  const ee = byId(s.enemies, e0.id)
  check('缺口开放后敌人经缺口进入基地内部',
    !ee || ee.y > TEMPLATE_TOP + 0.5 || (ee.mode === 'attack' && ee.targetKind !== 'wall'),
    `y=${ee?.y.toFixed(2)} mode=${ee?.mode}`)
}

// --- 用例 19（移动堡垒语义）：敌人被炮塔攻击不反击——统一以船体为目标 ---
{
  Math.random = zeroRandom
  let s = arena()
  // 冲核心型
  const r = mkEnemy(s, 'rusher', 5.5, 22, 50000)
  r.controller = 'ai'
  r.mode = 'move'; r.targetKind = null; r.targetId = null; r.hasGoal = false
  mkTurret(s, 'mg', 3, 23) // 侧向射击冲核尸
  let rusherRetaliated = false
  let rusherHitCore = false
  s = run(s, 15, 0.05, g => {
    const ee = byId(g.enemies, r.id)
    if (ee) {
      if (ee.targetKind === 'turret') rusherRetaliated = true
      if (ee.targetKind === 'fortress' && ee.mode === 'attack') rusherHitCore = true
    }
  })
  check('冲核心型被炮塔攻击不切换目标', !rusherRetaliated)
  check('冲核心型最终攻击堡垒船体', rusherHitCore)
}
{
  Math.random = zeroRandom
  let s = arena()
  const w = mkEnemy(s, 'walker', 5.5, 22, 50000)
  w.controller = 'ai'
  w.mode = 'move'; w.targetKind = null; w.targetId = null; w.hasGoal = false
  mkTurret(s, 'mg', 3, 23)
  let walkerRetaliated = false
  s = run(s, 15, 0.05, g => {
    const ee = byId(g.enemies, w.id)
    if (ee && ee.targetKind === 'turret') walkerRetaliated = true
  })
  check('默认型敌人同样不反击炮塔（反击机制已移除）', !walkerRetaliated)
}

// --- 用例 10：玩家单位归零 → 统一摧毁表现（演出毕判负，取代旧同帧判负） ---
{
  Math.random = zeroRandom
  let s = arena()
  s.fortress.hp = 0
  const fr = fortressRect(s)
  const e = mkEnemy(s, 'brute', fr.x + fr.w / 2, fr.y - 0.5, 5000)
  e.mode = 'attack'; e.targetKind = 'fortress'; e.targetId = 0
  s = run(s, 2, 0.05) // 远程重甲弹出膛、进入主体并飞至随机内部命中点
  check('玩家单位 hp 归零进入摧毁演出（不立即判负）', s.fortress.hp === 0 && s.fortress.dyingT >= 0 && s.phase !== 'lost', `phase=${s.phase} dyingT=${s.fortress.dyingT}`)
  for (let i = 0; i < 23; i++) s = tick(s, 0.1) // 推进越过玩家摧毁结算延时（2.2s）
  check('毁灭演出毕判负', s.phase === 'lost', `phase=${s.phase} dyingT=${s.fortress.dyingT.toFixed(2)}`)
}

// --- 用例 11：废墟挡弹道 / 岩石不挡 ---
{
  Math.random = zeroRandom
  let s = arena()
  mkTurret(s, 'mg', 5, 9) // 中心 5.5,9.5；废墟 (4,6) 2×2
  const e = mkEnemy(s, 'walker', 5.5, 4) // 连线穿过废墟格 (5,6)-(5,7)
  s = run(s, 3, 0.05)
  const ee = byId(s.enemies, e.id)!
  check('废墟截断弹道不可命中其后目标', ee.hp === ee.maxHp, `hp=${ee.hp}`)
}
{
  Math.random = zeroRandom
  let s = arena()
  mkTurret(s, 'mg', 8, 7) // 中心 8.5,7.5；岩石 (8,5) 2×1
  const e = mkEnemy(s, 'walker', 8.5, 3.5) // 连线穿过岩石格 (8,5)
  s = run(s, 3, 0.05)
  check('岩石不挡弹道可命中', byId(s.enemies, e.id)!.hp < 100000)
}

// --- 用例 12（战场）：水坑减速 ---
{
  Math.random = zeroRandom
  let s = arena()
  const e1 = mkEnemy(s, 'walker', 7.5, 5.5, 100000) // 直线穿水坑 (6-8, 8-9)
  const e2 = mkEnemy(s, 'walker', 10.5, 5.5, 100000) // 直线不穿水坑
  for (const e of [e1, e2]) {
    e.controller = 'ai'
    e.mode = 'move'; e.targetKind = null; e.targetId = null; e.hasGoal = false
    e.aiOverride = { targeting: { profile: 'fortress' }, movement: { profile: 'direct' }, attack: { profile: 'none' }, special: { profile: 'none' } }
  }
  s = run(s, 6, 0.05)
  const a = byId(s.enemies, e1.id)!
  const b = byId(s.enemies, e2.id)!
  check('水坑中敌人推进更慢', a.y < b.y - 0.3, `through=${a.y} free=${b.y}`)
}

// --- 用例 13：油桶燃烧区域 ---
{
  Math.random = zeroRandom
  let s = arena()
  const barrel = s.objects[0] // 首个油桶（D28 夹具首项）
  const bx = barrel.x + 0.5
  const by = barrel.y + 0.5
  const eIn = mkEnemy(s, 'walker', bx, by, 100000)
  const eOut = mkEnemy(s, 'walker', bx + 5, by, 100000)
  barrel.hp = 1
  // 用爆炸引爆：直接扣血
  barrel.hp = -1 // 模拟任意来源伤害 => 破坏流程由爆炸结算；这里手动触发
  s.objects = s.objects.filter(o => o.id !== barrel.id)
  s.burnZones.push({ id: s.nextId++, x: bx, y: by, r: 1.6, damage: 6, interval: 0.5, timer: 0, left: 4 })
  s = run(s, 5, 0.05)
  const dIn = byId(s.enemies, eIn.id)!.maxHp - byId(s.enemies, eIn.id)!.hp
  const dOut = byId(s.enemies, eOut.id)!.maxHp - byId(s.enemies, eOut.id)!.hp
  check('燃烧区域内敌人受持续伤害', dIn >= 40, `dIn=${dIn}`)
  check('区域外敌人不受影响', dOut === 0)
  check('燃烧结束后区域移除', s.burnZones.length === 0)
}

console.log('== 敌人配置验收 ==')

// --- 疾行尸（runner）定义与波次混入 ---
{
  const r = ENEMY_DEFS.runner
  check('疾行尸定义存在且速度快于行尸', !!r && r.speed > ENEMY_DEFS.walker.speed,
    `speed=${r?.speed} walker=${ENEMY_DEFS.walker.speed}`)
  const counts = [1, 2, 3, 4, 5, 6].map(w => buildWave(w).filter(i => i.kind === 'runner').length)
  check('波次表第 2 波起混入疾行尸且数量递增',
    counts[0] === 0 && counts[1] > 0 && counts.every((n, i) => i === 0 || n >= counts[i - 1]),
    `counts=${counts}`)
}

console.log('== 墙体统一验收 ==')

// --- 墙体统一：所有墙 HP 一致 ---
{
  const s = walled()
  s.gold = 10000
  const uniform = s.walls.every(w => w.hp === WALL_HP && w.maxHp === WALL_HP)
  const built = placeBaseCellAt(s, 5, 17) // 扩建基地格 → 派生新墙段
  const newWall = built.walls.find(w => w.cells[0].x === 5 && w.cells[0].y === 17)
  check('所有墙（含初始防御墙与扩建派生墙）HP 一致 = WALL_HP',
    uniform && !!newWall && newWall.hp === WALL_HP && newWall.maxHp === WALL_HP,
    `WALL_HP=${WALL_HP} new=${newWall?.hp}`)
  restoreLevel()
}

// --- 墙体统一：任意墙（含基地防御墙）均可拆除，返还半价并触发重寻路 ---
{
  Math.random = zeroRandom
  const s = walled()
  s.phase = 'prep'
  const seg = s.walls[0] // 派生防御墙段
  const c = seg.cells[0]
  const gold0 = s.gold
  const v0 = s.pathVersion
  const g = demolishAt(s, c.x, c.y) // 拆墙段格 = 拆基地格 → 连带墙移除
  check('拆墙段基地格连带墙移除、返还半价、触发重寻路',
    g.walls.length === s.walls.length - 1
    && g.gold === gold0 + Math.floor(WALL_BUILD_COST / 2)
    && g.pathVersion === v0 + 1,
    `gold=${g.gold - gold0} dv=${g.pathVersion - v0}`)
  restoreLevel()
}

console.log('== 防御墙行纳入建造区验收 ==')

// --- 墙段格不可建炮塔（新语义：设施只建里侧格）；拆基地格后该格变非基地仍不可建 ---
{
  const s = walled()
  s.phase = 'prep'
  const c = { x: 1, y: TEMPLATE_TOP } // 顶边墙段格 (1, 18)
  const blocked = placeTurret(s, 'mg', c.x, c.y)
  const blockedOk = blocked.turrets.length === 0 && blocked.gold === s.gold
  const g = demolishAt(s, c.x, c.y) // 拆基地格 → 该格非基地
  const stillBlocked = placeTurret(g, 'mg', c.x, c.y)
  check('墙段格不可建炮塔；拆基地格后该格非基地亦不可建',
    blockedOk && stillBlocked.turrets.length === 0 && !isBaseCell(c.x, c.y),
    `blockedOk=${blockedOk} after=${stillBlocked.turrets.length}`)
  restoreLevel()
}

console.log('== 射线光束验收 ==')

check('射线固定为光束：无子模式、无脉冲塔',
  !TURRET_DEFS.some(def => def.id === 'pulse') && TURRET_DEFS.filter(def => def.type === 'beam').every(def => !('rayMode' in def)))

// --- 光束端点：炮口、目标主体轮廓、命中特效统一使用同一条射线 ---
{
  const s = arena()
  const t = mkTurret(s, 'beam', 5, 20)
  const e = mkEnemy(s, 'walker', 6, 16)
  t.targetId = e.id
  const def = TURRET_DEFS.find(item => item.id === 'beam')!
  const muzzle = muzzlePos(t, def, 0)
  t.angle = Math.atan2(e.x - muzzle.x, -(e.y - muzzle.y))
  const origin = muzzlePos(t, def, 0)
  const march = beamMarch(s, t, def)
  const end = { x: origin.x + dirX(t.angle) * march.len, y: origin.y + dirY(t.angle) * march.len }
  const centerDistance = Math.hypot(e.x - origin.x, e.y - origin.y)
  const entry = segmentUnitShapeEntry(origin.x, origin.y, end.x, end.y, e, enemyUnitDef('walker'))
  check('光束直接止于单位主体：从实际炮口发出且端点不再越过目标到最大射程',
    march.blocker === null && march.len < centerDistance && entry !== null && Math.abs(entry - 1) < 1e-3,
    `len=${march.len.toFixed(3)} center=${centerDistance.toFixed(3)} entry=${entry}`)
}

// --- ① 光束：持续发射期间可转向，但转向速度削减 50%（BEAM_TURN_FACTOR） ---
{
  Math.random = zeroRandom
  let s = arena()
  const t = mkTurret(s, 'beam', 5, 20) // 中心 6,20.5 朝上
  const e = mkEnemy(s, 'walker', 6.0, 16, 100000)
  const wdiff = (a: number) => {
    while (a > Math.PI) a -= Math.PI * 2
    while (a < -Math.PI) a += Math.PI * 2
    return a
  }
  let lastAngle: number | null = null
  let firingTime = 0
  let firingTurn = 0
  let idleTime = 0
  let idleTurn = 0
  let swap = 0
  s = run(s, 8, 0.05, g => {
    const tt = byId(g.turrets, t.id)!
    const ee = byId(g.enemies, e.id)
    if (ee) { // 横向来回拉动目标（方位角持续偏离，炮塔全程追赶）
      swap++
      ee.x = swap % 12 < 6 ? 4 : 9
    }
    if (lastAngle !== null) {
      const d = Math.abs(wdiff(tt.angle - lastAngle))
      if (tt.firing) { firingTime += 0.05; firingTurn += d } else { idleTime += 0.05; idleTurn += d }
    }
    lastAngle = tt.angle
  })
  const rateF = firingTime > 0 ? firingTurn / firingTime : 0
  const rateI = idleTime > 0 ? idleTurn / idleTime : 0
  check('光束持续发射期间炮塔可转向（不再冻结）',
    firingTime > 0 && firingTurn > 1e-3,
    `firingTurn=${firingTurn.toFixed(3)} firingTime=${firingTime.toFixed(2)}`)
  check('光束持续发射期间转向速度减半（≈未发射时的 50%）',
    rateI > 0 && rateF > 0 && rateF / rateI > 0.35 && rateF / rateI < 0.65,
    `firing=${rateF.toFixed(2)}rad/s idle=${rateI.toFixed(2)}rad/s ratio=${(rateF / rateI).toFixed(2)}`)
}

console.log('== 物体/地形新框架验收 ==')

// --- ① 直射弹丸被废墟阻挡：扣耐久、后方无伤；打光后摧毁贯通、pathVersion+1 ---
{
  Math.random = zeroRandom
  const spdBk = ENEMY_DEFS.walker.speed
  ENEMY_DEFS.walker.speed = 0 // v2.45 口令(5)：mg DPS 降（12→5 伤、2s/轮），钉住敌人保证摧毁后仍在射界内
  let s = arena()
  mkTurret(s, 'mg', 5, 9) // 中心 5.5,9.5 朝上，弹道穿废墟 (4,6,2×2)
  const e = mkEnemy(s, 'walker', 5.5, 4) // 废墟后方
  const ruins = s.objects.find(o => o.kind === 'ruins' && o.x === 4 && o.y === 6)!
  const v0 = s.pathVersion
  s = run(s, 1.5, 0.05)
  const ruinsMid = s.objects.find(o => o.id === ruins.id)
  check('直射被废墟阻挡：废墟扣耐久、后方敌人无伤',
    !!ruinsMid && ruinsMid.hp < RUINS_HP && byId(s.enemies, e.id)!.hp === 100000,
    `ruinsHp=${ruinsMid?.hp}`)
  s = run(s, 16, 0.05) // v2.45：150 耐久 ÷ 每轮 30 伤（2.6s/轮）≈ 13s 摧毁
  const gone = !s.objects.some(o => o.id === ruins.id)
  check('废墟耐久打光后摧毁移除、弹道贯通且重寻路',
    gone && s.pathVersion > v0 && byId(s.enemies, e.id)!.hp < 100000,
    `gone=${gone} dv=${s.pathVersion - v0} hp=${byId(s.enemies, e.id)!.hp}`)
  ENEMY_DEFS.walker.speed = spdBk
}

// --- ② 岩石 hp=-1：敌人攻击与爆炸均不扣耐久、不摧毁 ---
{
  Math.random = zeroRandom
  let s = arena()
  const rock = s.objects.find(o => o.kind === 'rock')! // (8,5,2×1)
  const e = mkEnemy(s, 'walker', rock.x + 0.5, rock.y + rock.h + 0.6)
  e.mode = 'attack'; e.targetKind = 'object'; e.targetId = rock.id
  s = run(s, 2, 0.05)
  const r1 = s.objects.find(o => o.id === rock.id)
  check('岩石 hp=-1：敌人攻击不扣耐久不摧毁', !!r1 && r1.hp === -1)
  // 抛射落点在岩石旁：爆炸波及岩石但岩石豁免；敌人受伤证明爆炸发生
  s.enemies = [] // 隔离第二段爆炸测试，避免炮塔继续索引上一段攻击者
  mkTurret(s, 'lob', 7, 10) // 中心 (7.5,11)
  const e2 = mkEnemy(s, 'walker', 8.5, 6.6) // 落点贴近岩石
  s = run(s, 6, 0.05)
  const r2 = s.objects.find(o => o.id === rock.id)
  check('岩石 hp=-1：爆炸不扣耐久不摧毁',
    !!r2 && r2.hp === -1 && byId(s.enemies, e2.id)!.hp < 100000,
    `rock=${r2?.hp} e2=${byId(s.enemies, e2.id)!.hp}`)
}

// --- ③ 导弹：远离物体则越过命中；目标刚好在物体后面则被挡、物体受爆炸伤害 ---
{
  Math.random = zeroRandom
  let s = arena()
  mkTurret(s, 'cruise', 3, 10) // 中心 (4,11)，弹道线穿废墟 (4,6,2×2)
  const eFar = mkEnemy(s, 'walker', 4.5, 3) // 废墟后方 3 格（非紧邻）
  s = run(s, 8, 0.05)
  const ruins = s.objects.find(o => o.kind === 'ruins' && o.x === 4 && o.y === 6)!
  check('导弹越过废墟命中远离物体的目标',
    byId(s.enemies, eFar.id)!.hp < 100000 && ruins.hp === RUINS_HP,
    `hp=${byId(s.enemies, eFar.id)!.hp} ruins=${ruins.hp}`)
}
{
  Math.random = zeroRandom
  let s = arena()
  mkTurret(s, 'cruise', 3, 10)
  const eNear = mkEnemy(s, 'walker', 4.5, 5.5) // 紧贴废墟 (4,6,2×2) 正后方一格
  const ruins = s.objects.find(o => o.kind === 'ruins' && o.x === 4 && o.y === 6)!
  let snap = -1 // 废墟首次受爆炸伤害/被毁瞬间的敌人血量
  s = run(s, 8, 0.05, g => {
    if (snap < 0) {
      const r = g.objects.find(o => o.id === ruins.id)
      if (!r || r.hp < RUINS_HP) snap = byId(g.enemies, eNear.id)!.hp
    }
  })
  check('目标刚好在废墟后面时导弹被挡、废墟受爆炸伤害',
    snap === 100000, // 废墟被炸瞬间敌人仍满血（导弹打在废墟上而非目标）
    `enemyHpAtBlast=${snap}`)
}

// --- ④ 抛射落点在废墟后方：不受阻挡正常爆炸结算 ---
{
  Math.random = zeroRandom
  let s = arena()
  mkTurret(s, 'lob', 4, 10) // 中心 (4.5,11)
  const e = mkEnemy(s, 'walker', 4.5, 3) // 废墟正后方远处
  const ruins = s.objects.find(o => o.kind === 'ruins' && o.x === 4 && o.y === 6)!
  s = run(s, 6, 0.05)
  check('抛射越过废墟不受阻挡正常爆炸',
    byId(s.enemies, e.id)!.hp < 100000 && ruins.hp === RUINS_HP,
    `hp=${byId(s.enemies, e.id)!.hp} ruins=${ruins.hp}`)
}

console.log('== 物体高度与爆炸遮挡验收 ==')

{
  const object = { blockProjectile: true, height: 1 }
  check('高度1只阻挡子弹直射，不阻挡穿甲弹和破片弹',
    objectBlocksEnvironmentShot(object, { kind: 'direct', subtype: 'bullet' })
    && !objectBlocksEnvironmentShot(object, { kind: 'direct', subtype: 'armorPiercing' })
    && !objectBlocksEnvironmentShot(object, { kind: 'direct', subtype: 'fragmentation' }))
  object.height = 2
  check('高度2阻挡全部直射子类、射线与喷射',
    objectBlocksEnvironmentShot(object, { kind: 'direct', subtype: 'bullet' })
    && objectBlocksEnvironmentShot(object, { kind: 'direct', subtype: 'armorPiercing' })
    && objectBlocksEnvironmentShot(object, { kind: 'direct', subtype: 'fragmentation' })
    && objectBlocksEnvironmentShot(object, { kind: 'ray' })
    && objectBlocksEnvironmentShot(object, { kind: 'spray' }))
  check('爆炸高度减伤表为0%/30%/60%/80%', EXPLOSION_COVER_REDUCTION.join(',') === '0,0.3,0.6,0.8')
}

// --- ① height=2 的阻挡物体拦截后方 2 格内目标的导弹；2 格外越过 ---
{
  Math.random = zeroRandom
  const mk = () => {
    LEVEL.objects = [] // 清空场景物体：隔离自定义高度物体
    const s = arena()
    s.objects.push({
      id: 3000, kind: 'ruins', x: 10, y: 10, w: 1, h: 2, hp: -1, maxHp: -1,
      blockMove: true, blockProjectile: true, height: 2,
    })
    mkTurret(s, 'cruise', 9, 14) // 中心 (10,15)，弹道线穿 (10,10)-(10,11)
    return s
  }
  let s = mk()
  const eNear = mkEnemy(s, 'walker', 10.5, 8.5) // 物体后方 2 格（格距 2 ≤ height 2）
  s = run(s, 8, 0.05)
  check('高度2物体拦截其后方2格内目标的导弹',
    byId(s.enemies, eNear.id)!.hp === 100000, `hp=${byId(s.enemies, eNear.id)!.hp}`)
  s = mk()
  const eFar = mkEnemy(s, 'walker', 10.5, 7.5) // 物体后方 3 格（格距 3 > height 2）
  s = run(s, 8, 0.05)
  check('目标在高度2物体后方2格外时导弹越过命中',
    byId(s.enemies, eFar.id)!.hp < 100000, `hp=${byId(s.enemies, eFar.id)!.hp}`)
  restoreLevel()
}

// --- ② 爆炸遮挡：爆心与敌人之间隔阻挡物体 => 无伤；无遮挡 => 正常受伤 ---
{
  Math.random = zeroRandom
  const lob = TURRET_DEFS.find(d => d.id === 'lob')!
  const lobAmmo = PROJECTILE_ARTS.find(a => a.id === lob.art?.projectile)!
  const savedBlast = lobAmmo.blastRadius!
  lobAmmo.blastRadius = 60 // 战斗属性由弹丸库控制；临时扩大到 2.4 格
  const mk = (withObj: boolean) => {
    const s = arena()
    if (withObj) {
      s.objects.push({
        id: 3001, kind: 'ruins', x: 3, y: 9, w: 1, h: 2, hp: -1, maxHp: -1,
        blockMove: true, blockProjectile: true, height: 1,
      })
    }
    mkTurret(s, 'lob', 4, 13) // 中心 (4.5,14)
    return s
  }
  let s = mk(true)
  const eNear = mkEnemy(s, 'walker', 3.5, 10.5) // 落点（近侧，更靠近核心被索敌选中）
  const eFar = mkEnemy(s, 'walker', 3.5, 8.5) // 物体 (3,9)-(3,10) 正后方
  s = run(s, 6, 0.05)
  const nearDamage = 100000 - byId(s.enemies, eNear.id)!.hp
  const farDamage = 100000 - byId(s.enemies, eFar.id)!.hp
  check('高度1遮蔽使后方目标爆炸伤害降低30%',
    nearDamage > 0 && Math.abs(farDamage / nearDamage - 0.7) < 0.01,
    `near=${byId(s.enemies, eNear.id)!.hp} far=${byId(s.enemies, eFar.id)!.hp}`)
  s = mk(false)
  const eA = mkEnemy(s, 'walker', 3.5, 10.5)
  const eB = mkEnemy(s, 'walker', 3.5, 8.5)
  s = run(s, 6, 0.05)
  check('无遮挡时爆炸对两个敌人正常结算',
    byId(s.enemies, eA.id)!.hp < 100000 && byId(s.enemies, eB.id)!.hp < 100000,
    `a=${byId(s.enemies, eA.id)!.hp} b=${byId(s.enemies, eB.id)!.hp}`)
  lobAmmo.blastRadius = savedBlast
}

console.log('== 光束消灭目标不中断验收 ==')

// --- 光束持续期间首个目标死亡后仍保持 firing，继续伤害波束内第二个敌人 ---
{
  Math.random = zeroRandom
  let s = arena()
  const t = mkTurret(s, 'beam', 5, 20) // 中心 (6,20.5) 朝上
  const e1 = mkEnemy(s, 'walker', 6.0, 16, 15) // 波束内，很快被消灭
  const e2 = mkEnemy(s, 'walker', 6.0, 14, 100000) // 同波束内第二个敌人
  let killSeen = false
  let e2HpAtKill = -1
  let firingTicksAfterKill = 0
  let stoppedEarly = false
  s = run(s, 5, 0.05, g => {
    const tt = byId(g.turrets, t.id)!
    const dead1 = !g.enemies.some(x => x.id === e1.id)
    if (dead1 && !killSeen && tt.firing) {
      killSeen = true
      e2HpAtKill = byId(g.enemies, e2.id)!.hp
    }
    if (killSeen && tt.firing) firingTicksAfterKill++
    // 目标死亡后当轮未满（firingLeft 明显剩余）就停射 => 异常中断
    if (killSeen && !tt.firing && tt.firingLeft > 0.2) stoppedEarly = true
  })
  check('光束消灭目标后当轮不中断、继续伤害波束内其他敌人',
    killSeen && !stoppedEarly && firingTicksAfterKill > 5
    && byId(s.enemies, e2.id)!.hp < e2HpAtKill,
    `killSeen=${killSeen} ticks=${firingTicksAfterKill} early=${stoppedEarly} e2=${byId(s.enemies, e2.id)!.hp}/${e2HpAtKill}`)
}

console.log('== 关卡配置（LEVEL）验收 ==')

{
  const sceneOrder = [
    { id: 'layer-low', layer: 2, x: 99, y: 99, kind: 'object' as const, order: 0 },
    { id: 'xy-low', layer: 3, x: 1, y: 1, kind: 'unit' as const, order: 1 },
    { id: 'x-low', layer: 3, x: 1, y: 2, kind: 'unit' as const, order: 2 },
    { id: 'same-object', layer: 3, x: 2, y: 2, kind: 'object' as const, order: 3 },
    { id: 'same-unit-a', layer: 3, x: 2, y: 2, kind: 'unit' as const, order: 4 },
    { id: 'same-unit-b', layer: 3, x: 2, y: 2, kind: 'unit' as const, order: 5 },
    { id: 'ground-low-screen', layer: 3, x: 9, y: 9, kind: 'unit' as const, airborne: false, order: 6 },
    { id: 'air-high-altitude', layer: 3, x: 0, y: 0, kind: 'unit' as const, airborne: true, altitude: 3, order: 7 },
    { id: 'air-low-altitude', layer: 3, x: 9, y: 9, kind: 'unit' as const, airborne: true, altitude: 1, order: 8 },
    { id: 'air-same-altitude-y0', layer: 3, x: 0, y: 0, kind: 'unit' as const, airborne: true, altitude: 2, order: 9 },
    { id: 'air-same-altitude-y1', layer: 3, x: 0, y: 1, kind: 'unit' as const, airborne: true, altitude: 2, order: 10 },
    { id: 'layer-high', layer: 4, x: 0, y: 0, kind: 'object' as const, order: 11 },
  ].sort(compareSceneRenderItems).map(item => item.id)
  check('全局显示层级：层级优先于坐标且高层最后绘制', sceneOrder[0] === 'layer-low' && sceneOrder.at(-1) === 'layer-high')
  check('全局显示层级：同层按 Y 后按 X 升序绘制', sceneOrder.indexOf('xy-low') < sceneOrder.indexOf('x-low') && sceneOrder.indexOf('x-low') < sceneOrder.indexOf('same-object'))
  check('全局显示层级：同层同坐标单位覆盖物体', sceneOrder.indexOf('same-object') < sceneOrder.indexOf('same-unit-a'))
  check('全局显示层级：同类完全同键保持稳定放置顺序', sceneOrder.indexOf('same-unit-a') < sceneOrder.indexOf('same-unit-b'))
  check('飞行载具层级：同层飞行单位始终覆盖地面单位', sceneOrder.indexOf('ground-low-screen') < sceneOrder.indexOf('air-low-altitude'))
  check('飞行载具层级：飞行单位先按当前高度由低到高绘制', sceneOrder.indexOf('air-low-altitude') < sceneOrder.indexOf('air-high-altitude'))
  check('飞行载具层级：同高度飞行单位仍按原有 Y 坐标顺序', sceneOrder.indexOf('air-same-altitude-y0') < sceneOrder.indexOf('air-same-altitude-y1'))
  const airUnit = unitLibrary().find(unit => unit.stats.air)!
  const shadowNorth = airUnitShadowTransform(airUnit, 1, BASE_CELL, 0)
  const shadowEast = airUnitShadowTransform(airUnit, 1, BASE_CELL, Math.PI / 2)
  const shadowHigh = airUnitShadowTransform(airUnit, 3, BASE_CELL, Math.PI / 2)
  check('飞行载具阴影：轮廓方向严格复用单位当前朝向', shadowNorth.heading === 0 && shadowEast.heading === Math.PI / 2)
  check('飞行载具阴影：高度越高越小、越淡且地面投影偏移更远', shadowHigh.scale < shadowEast.scale && shadowHigh.opacity < shadowEast.opacity && shadowHigh.offsetX > shadowEast.offsetX)
  const groundLow = groundEntityShadowTransform(0, BASE_CELL)
  const groundHigh = groundEntityShadowTransform(3, BASE_CELL)
  const infantry = groundEntityShadowTransform(0, BASE_CELL, true)
  check('地面实体阴影：物体高度越高投影偏移越远', groundHigh.offsetX > groundLow.offsetX && groundHigh.offsetY > groundLow.offsetY)
  check('地面实体阴影：步兵使用压扁的贴地轮廓', infantry.scaleY < groundLow.scaleY)
}


// --- ① buildCells 非矩形集合：集合内逐格可建、集合外不可建 ---
{
  LEVEL.buildCells = [] // 3×3 基地块：中心为里侧格，边缘为墙段
  for (let dx = 0; dx < 3; dx++) for (let dy = 0; dy < 3; dy++) LEVEL.buildCells.push(`${4 + dx},${20 + dy}`)
  const s = walled()
  s.phase = 'prep'
  const tIn = placeTurret(s, 'mg', 5, 21) // 里侧格 → 可建
  const tWall = placeTurret(s, 'mg', 4, 20) // 墙段格 → 拒绝
  const tOut = placeTurret(s, 'mg', 5, 24) // 非基地格 → 拒绝
  check('基地格语义：里侧格可建炮塔、墙段格/非基地格不可建',
    tIn.turrets.length === 1 && tWall.turrets.length === 0 && tOut.turrets.length === 0
    && s.walls.length === 8, // 3×3 块边界 8 格全部派生为墙段
    `tIn=${tIn.turrets.length} tWall=${tWall.turrets.length} walls=${s.walls.length}`)
  restoreLevel()
}

// --- ③ 自定义地形减速生效；自定义 hp=50 挡弹道物体截断实弹并可被打掉 ---
{
  const travel = (withPuddle: boolean) => {
    LEVEL.terrain = withPuddle ? [{ kind: 'puddle', x: 4, y: 5, w: 2, h: 5, moveModifier: 0.3 }] : []
    LEVEL.objects = []; LEVEL.buildCells = []; LEVEL.initialWalls = []; LEVEL.buildings = []; LEVEL.core = null
    let state = fresh(); state.phase = 'combat'; state.spawnQueue = [{ kind: 'walker', delay: 100 }]; state.spawnTimer = 100
    const enemy = mkEnemy(state, 'walker', 4.5, 4, 100000)
    enemy.controller = 'ai'
    enemy.aiOverride = { targeting: { profile: 'fortress' }, movement: { profile: 'direct' }, attack: { profile: 'none' }, special: { profile: 'none' } }
    state = run(state, 4, 0.05)
    return state.enemies.find(item => item.id === enemy.id)?.y ?? 4
  }
  const through = travel(true)
  const free = travel(false)
  check('自定义地形实例（减速 0.3）生效',
    through < free - 0.5,
    `through=${through} free=${free}`)

  Math.random = zeroRandom
  const spdBk3 = ENEMY_DEFS.walker.speed
  ENEMY_DEFS.walker.speed = 0 // v2.45 口令(5)：钉住敌人（理由同废墟用例）
  LEVEL.objects.push({ kind: 'ruins', x: 6, y: 9, w: 1, h: 1, hp: 60, blockMove: true, blockProjectile: true, height: 1 }) // v1.72：第一轮后存活；v2.45 口令(5)：单轮 6×5=30 → hp 60（130 需 5 轮 ≈13s 超出窗口）
  let s = arena()
  mkTurret(s, 'mg', 6, 13) // 中心 (6.5,13.5) 朝上，弹道穿自定义物体 (6,9)
  const e3 = mkEnemy(s, 'walker', 6.5, 8)
  const obj = s.objects.find(o => o.x === 6 && o.y === 9)!
  s = run(s, 1.5, 0.05)
  const mid = s.objects.find(o => o.id === obj.id)
  const midOk = !!mid && mid.hp < 60 && byId(s.enemies, e3.id)!.hp === 100000
  s = run(s, 8, 0.05)
  check('自定义 hp=60 挡弹道物体截断实弹并可被打掉',
    midOk && !s.objects.some(o => o.id === obj.id) && byId(s.enemies, e3.id)!.hp < 100000,
    `midHp=${mid?.hp} gone=${!s.objects.some(o => o.id === obj.id)}`)
  ENEMY_DEFS.walker.speed = spdBk3
  restoreLevel()
}

// --- ④ 堡垒为原点：距离场以堡垒覆盖格为源、敌人朝堡垒推进、船体归零同帧判负 ---
{
  let s = fresh()
  s.phase = 'combat'
  const dist = computePathField(s)
  const fr0 = fortressRect(s)
  const originOk = dist[Math.floor(fr0.y) * COLS + Math.floor(fr0.x)] === 0
    && dist[25 * COLS + 5] !== 0 // 旧核心位置不再是原点
  const e = mkEnemy(s, 'flyer', 9, 10, 100000) // 飞行直冲堡垒中心
  e.controller = 'ai'
  e.mode = 'move'; e.targetKind = null; e.targetId = null; e.hasGoal = false
  s = run(s, 8, 0.05)
  const ee = byId(s.enemies, e.id)!
  check('距离场以堡垒为原点、敌人朝堡垒推进',
    originOk && (ee.y > 17 || (ee.mode === 'attack' && ee.targetKind === 'fortress')),
    `originOk=${originOk} y=${ee.y} mode=${ee.mode}/${ee.targetKind}`)
  // 船体归零 → v2.53 毁灭序列（直接走统一承伤，避免依赖某个敌人武器配置）
  s.fortress.hp = 0
  s.fortress.shield = 0
  s.fortress.armor = { front: 0, rear: 0, left: 0, right: 0 }
  s = tick(s, 0.05)
  check('船体归零进入毁灭序列（不立即判负）', s.fortress.dyingT >= 0 && s.phase !== 'lost', `phase=${s.phase} dyingT=${s.fortress.dyingT}`)
  for (let i = 0; i < 23; i++) s = tick(s, 0.1)
  check('毁灭演出毕判负', s.phase === 'lost', `phase=${s.phase}`)
  restoreLevel()
}

// --- ② 派生初始墙：walls 集合 = isWallSegment 全集、hp=WALL_HP ---
{
  const s = walled()
  let expect = 0
  for (let x = 0; x < COLS; x++) for (let y = 0; y < LEVEL.rows; y++) if (isWallSegment(x, y)) expect++
  check('初始墙全部由基地格边界派生（集合一致、hp=WALL_HP）',
    s.walls.length === expect && s.walls.every(w => w.hp === WALL_HP && w.fromLevel),
    `walls=${s.walls.length} expect=${expect}`)
  restoreLevel()
}

// --- ⑤ 默认关卡：无基地格/核心/初始墙（移动堡垒），初始无派生墙 ---
{
  resetLevel()
  const s = fresh()
  check('默认关卡无基地格/核心/初始墙（移动堡垒）',
    LEVEL.buildCells.length === 0 && LEVEL.core === null && LEVEL.initialWalls.length === 0 && s.walls.length === 0,
    `cells=${LEVEL.buildCells.length} walls=${s.walls.length}`)
  restoreLevel()
}

// --- ⑥ 清空 baseCells：无派生墙，敌人从出生带直达基地区 ---
{
  LEVEL.buildCells = []
  let s = fresh()
  s.phase = 'combat'
  const e = mkEnemy(s, 'walker', 5.5, 3.5)
  e.controller = 'ai'
  e.controller = 'ai'
  e.controller = 'ai'
  e.mode = 'move'; e.targetKind = null; e.targetId = null; e.hasGoal = false
  e.aiOverride = { targeting: { profile: 'fortress' }, movement: { profile: 'direct' }, attack: { profile: 'none' }, special: { profile: 'none' } }
  s = run(s, 25)
  const ee = byId(s.enemies, e.id)
  check('清空 baseCells 后敌人直达基地区（无派生墙阻挡）',
    s.walls.length === 0 && ee !== undefined && ee.y > fortressRect(s).y - 2 && ee.hp > 0,
    `walls=${s.walls.length} y=${ee?.y.toFixed(2)} hp=${ee?.hp}`)
  restoreLevel()
}

// --- ⑦ 无核心建筑（core=null，移动堡垒默认）：距离场以堡垒为原点、可 tick 运行不误判负 ---
{
  LEVEL.core = null
  let s = fresh()
  const dist = computePathField(s)
  const fr = fortressRect(s)
  const seedFort = dist[Math.floor(fr.y + 1) * COLS + Math.floor(fr.x + 1)] === 0
  s.phase = 'combat'
  const e = mkEnemy(s, 'walker', 5.5, 3.5)
  e.controller = 'ai'
  e.mode = 'move'; e.targetKind = null; e.targetId = null; e.hasGoal = false
  s = run(s, 6)
  const ee = byId(s.enemies, e.id)
  const adv = ee !== undefined && ee.y > 3.5
  s = tick(s, 0.05)
  check('core=null：距离场以堡垒为原点、敌人向堡垒推进、不误判负',
    seedFort && s.time > 0 && adv && s.phase === 'combat',
    `seed=${seedFort} y=${ee?.y.toFixed(2)} phase=${s.phase}`)
  restoreLevel()
}

// --- ⑧ version 迁移：旧配置迁移至当前 v18 ---
{
  const m1 = parseLevel(JSON.stringify({ buildTop: 20, buildBottom: 24 })) // 无 version 老存档
  const m2 = parseLevel(JSON.stringify({ version: 2, initialWalls: [] })) // v2 存档同样并入模板墙
  check('version 迁移：模板墙格 + buildCells 合并为基地格全集，version 升 18 且补齐分层/统一事件/初始单位',
    m1.version === 18 && m2.version === 18
    && Array.isArray(m1.groundCells) && m1.groundCells.length === 0
    && Array.isArray(m2.groundCells) && m2.groundCells.length === 0
    && m1.mode === 'defend' && m1.objective.type === 'defend'
    && m1.startZone.w > 0 && m1.finishZone.w > 0
    && m1.triggers.length === 0 && m2.triggers.length === 0 && m1.interactables.length === 0 && m1.events.length === 0 && m1.initialUnits.length === 0
    && new Set(m1.buildCells).size === m1.buildCells.length
    && m1.rows === 28 && m1.cols === 42 // 旧配置无 rows/cols → 28/COLS（v1.41 上限不限：不再钳到 24）；v2.45 口令(5)：COLS 36→42
    && templateWallCells(m1.rows, m1.cols).every(c => m1.buildCells.includes(`${c.x},${c.y}`))
    && m1.buildCells.includes('3,22') && !m1.buildCells.includes('3,25') // 原行区保留
    && templateWallCells(m2.rows, m2.cols).every(c => m2.buildCells.includes(`${c.x},${c.y}`)),
    `m1=${m1.version}/${m1.buildCells.length} m2=${m2.version}/${m2.buildCells.length}`)
  restoreLevel()
}

// --- ⑧b v4 存档往返：用户拆除的墙格/基地格不得在重载时回补（编辑后重开场景保持一致） ---
{
  const lv = defaultLevel()
  lv.buildCells = mergeBaseCells(lv.buildCells, lv.rows)
  const removed = ['0,10', '1,10', '5,10', '6,10', '6,19'] // 均为模板墙格
  lv.buildCells = lv.buildCells.filter(k => !removed.includes(k))
  lv.groundCells = ['3,5', '4,5', '5,5']
  lv.initialWalls = []
  lv.version = 4
  const loaded = parseLevel(JSON.stringify(lv))
  check('v4 存档往返：buildCells/groundCells 原样保留，不回补模板墙格',
    loaded.version === 18
    && loaded.buildCells.length === lv.buildCells.length
    && removed.every(k => !loaded.buildCells.includes(k))
    && lv.buildCells.every(k => loaded.buildCells.includes(k))
    && loaded.groundCells.length === 3
    && loaded.initialWalls.length === 0,
    `buildCells=${loaded.buildCells.length} ground=${loaded.groundCells.length}`)
  restoreLevel()
}

// --- ③ 旧格式 localStorage（buildTop/buildBottom）迁移为 buildCells，语义等价 ---
{
  const migrated = parseLevel(JSON.stringify({ buildTop: 20, buildBottom: 24 }))
  const inOld = migrated.buildCells.includes('3,22')
  const aboveOld = migrated.buildCells.includes('3,19') // 行区外（且非模板墙格）
  const belowOld = migrated.buildCells.includes('3,25')
  const tmplIn = migrated.buildCells.includes(`5,${migrated.rows - 10}`) // 模板墙格并入基地格全集（顶边 = rows-10）
  const fullWidth = migrated.buildCells.includes('0,22') && migrated.buildCells.includes(`${COLS - 1},22`)
  const dedup = new Set(migrated.buildCells).size === migrated.buildCells.length
  check('旧格式（buildTop/buildBottom）迁移为基地格全集（含模板墙并入、去重）',
    inOld && !aboveOld && !belowOld && fullWidth && tmplIn && dedup,
    `in=${inOld} above=${aboveOld} below=${belowOld} tmpl=${tmplIn} dedup=${dedup}`)
  restoreLevel()
}

// --- ⑨ 三层地面：groundCells 迁移/底部锚定 + RMXP Autotile 分类 ---
{
  const lv = defaultLevel(20)
  lv.groundCells = ['5,0', '6,19', '7,25'] // 7,25 出界（rows=20）应被丢弃
  reanchorRows(lv, 22) // 底部锚定：y +2
  check('groundCells 随纵深底部锚定迁移并丢弃出界格',
    lv.groundCells.includes('5,2') && lv.groundCells.includes('6,21') && !lv.groundCells.includes('7,27'),
    JSON.stringify(lv.groundCells))

  const set = (cells: [number, number][]) => new Set(cells.map(([x, y]) => `${x},${y}`))
  const idxFull = rmxpAutotileIndex(set([[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1], [0, 2], [1, 2], [2, 2]]), 1, 1)
  const idxIso = rmxpAutotileIndex(set([[0, 0]]), 0, 0)
  const idxH = rmxpAutotileIndex(set([[-1, 0], [0, 0], [1, 0]]), 0, 0)
  const idxV = rmxpAutotileIndex(set([[0, -1], [0, 0], [0, 1]]), 0, 0)
  const idxNoNW = rmxpAutotileIndex(set([[1, 0], [2, 0], [0, 1], [1, 1], [2, 1], [0, 2], [1, 2], [2, 2]]), 1, 1)
  const idxCorner = rmxpAutotileIndex(set([[0, 0], [1, 0], [0, 1], [1, 1]]), 0, 0)
  const srcOk = JSON.stringify(rmxpQuarterSrc(1)) === '[0,0]'
    && JSON.stringify(rmxpQuarterSrc(6)) === '[80,0]'
    && JSON.stringify(rmxpQuarterSrc(48)) === '[80,112]'
    && JSON.stringify(RMXP_SUBTILES[47]) === '[1,2,7,8]'
  check('RMXP Autotile：全包围/孤立/横直/竖直/缺角/转角索引与 quarter 源坐标',
    idxFull === 0 && idxIso === 46 && idxH === 33 && idxV === 32 && idxNoNW === 1 && idxCorner === 34 && srcOk,
    `full=${idxFull} iso=${idxIso} h=${idxH} v=${idxV} noNW=${idxNoNW} corner=${idxCorner} srcOk=${srcOk}`)
  restoreLevel()
}

console.log('== 导弹飞行时间/制导重选验收 ==')

// --- ① 飞行时间耗尽未命中：不爆炸不伤害，经淡出阶段后移除 ---
{
  Math.random = zeroRandom
  const cruise = TURRET_DEFS.find(d => d.id === 'cruise')!
  cruise.missileFlightTime = 0.3
  let s = arena()
    mkTurret(s, 'cruise', 6, 20)
  const e = mkEnemy(s, 'walker', 6.5, 10) // 射程内（8 格=200m）但 0.3s 飞不到
  let sawFading = false
  s = run(s, 4, 0.05, g => {
    if (g.projectiles.some(p => p.fading !== undefined)) sawFading = true
  })
  const ee = byId(s.enemies, e.id)!
  check('导弹飞行时间耗尽未命中：无伤害、经淡出后移除',
    ee.hp === ee.maxHp && sawFading && !s.projectiles.some(p => p.defId === 'cruise'),
    `hp=${ee.hp} fading=${sawFading} left=${s.projectiles.filter(p => p.defId === 'cruise').length}`)
  delete cruise.missileFlightTime
}

// --- ② 未配置 missileFlightTime：行为不变（直飞锁定落点爆炸） ---
{
  Math.random = zeroRandom
  const cruise = TURRET_DEFS.find(d => d.id === 'cruise')!
  let s = arena()
  mkTurret(s, 'cruise', 6, 20)
  const e = mkEnemy(s, 'walker', 6.5, 14) // 射程内、落点处
  s = run(s, 8, 0.05)
  const ee = byId(s.enemies, e.id)!
  check('未配置飞行时间的导弹行为不变（命中落点爆炸）',
    cruise.missileFlightTime === undefined && ee.hp < ee.maxHp,
    `hp=${ee.hp}/${ee.maxHp}`)
}

// --- ③ 制导导弹目标被消灭后重选：优先飞行时间内可达的 B，不选不可达的 C ---
{
  Math.random = zeroRandom
  const hunter = TURRET_DEFS.find(d => d.id === 'hunter')!
  const hunterAmmo = PROJECTILE_ARTS.find(a => a.id === hunter.art?.projectile)!
  const savedFlightTime = hunterAmmo.missileFlightTime, savedDelay = hunterAmmo.guideDelay
  const savedTurretDelay = hunter.guideDelay
  hunterAmmo.missileFlightTime = 2.0 // 可达半径 ≈ flightLeft*0.9*320m
  delete hunterAmmo.guideDelay
  delete hunter.guideDelay
  let s = arena()
  mkTurret(s, 'hunter', 6, 20) // 中心 (7,21)
  const a = mkEnemy(s, 'walker', 14.5, 18.5) // 首选（紧邻 5×8 堡垒，离堡垒最近）
  const b = mkEnemy(s, 'walker', 8.5, 15) // 可达
  const c = mkEnemy(s, 'walker', 6.5, 1) // 极远不可达
  let p0: (typeof s.projectiles)[number] | undefined
  for (let i = 0; i < 40 && !p0; i++) {
    s = tick(s, 0.05)
    p0 = s.projectiles.find(p => p.kind === 'missile')
  }
  const lockedA = p0 !== undefined && p0.targetId === a.id
  byId(s.enemies, a.id)!.hp = 0 // A 在命中前被消灭
  s = run(s, 0.15, 0.05)
  const p1 = s.projectiles.find(p => p.id === p0?.id)
  check('制导导弹目标被消灭后重选：优先可达的 B 而非不可达的 C',
    lockedA && p1 !== undefined && p1.targetId === b.id && p1.targetId !== c.id,
    `lockedA=${lockedA} target=${p1?.targetId} b=${b.id} c=${c.id}`)
  hunterAmmo.missileFlightTime = savedFlightTime
  hunterAmmo.guideDelay = savedDelay
  hunter.guideDelay = savedTurretDelay
}

// --- ③b 垂发固定 7 帧 + 发射阶段制导生效、飞行寿命从离架后计算 ---
{
  const first = verticalLaunchFrameRect(700, 48, 0)
  const middle = verticalLaunchFrameRect(700, 48, 0.5)
  const last = verticalLaunchFrameRect(700, 48, 0.999)
  check('垂发素材固定横向7帧自动切分（首帧/中间帧/末帧）',
    VERTICAL_LAUNCH_FRAMES === 7
      && first.index === 0 && first.sx === 0 && first.sw === 100
      && middle.index === 3 && middle.sx === 300
      && last.index === 6 && last.sx === 600,
    `frames=${VERTICAL_LAUNCH_FRAMES} indices=${first.index}/${middle.index}/${last.index}`)

  const sharedAssetAmmo = { id: 'vertical-shared', name: '垂发共用素材', kind: 'missile', projectileAsset: 'shared-projectile', verticalLaunch: { enabled: true, duration: 0.6 } } as ProjectileArtDef
  const sharedFirst = projectileBodyFrameRect(sharedAssetAmmo, 700, 48, 0)
  const sharedFlight = projectileBodyFrameRect(sharedAssetAmmo, 700, 48)
  check('垂发导弹直接把当前弹丸贴图作为7帧帧条，飞行阶段保持末帧',
    sharedFirst.index === 0 && sharedFirst.sw === 100 && sharedFlight.index === 6 && sharedFlight.sx === 600)
  const tailStart = verticalLaunchTailProjection(sharedAssetAmmo, 0)
  const tailMiddle = verticalLaunchTailProjection(sharedAssetAmmo, 0.3)
  const tailFlight = verticalLaunchTailProjection(sharedAssetAmmo, 0.6)
  check('垂发尾焰平面投影：竖直首帧位于弹体下方，转向中逐渐移至平飞尾端',
    tailStart === 0 && tailMiddle === 0.5 && tailFlight === 1,
    `projection=${tailStart}/${tailMiddle}/${tailFlight}`)
  const uprightTrail = projectileTrailVelocity(12, -4, Math.PI / 3, 0.9, tailStart)
  const flightTrail = projectileTrailVelocity(0, 0, 0, 0, tailFlight)
  check('垂发尾焰速度投影：竖直首帧不继承平面前向速度，平飞后只向航向后方喷射',
    uprightTrail.vx === 0 && uprightTrail.vy === 0 && Math.abs(flightTrail.vx) < 1e-9 && flightTrail.vy > 0,
    `upright=${JSON.stringify(uprightTrail)} flight=${JSON.stringify(flightTrail)}`)
  const inheritedTrail = projectileTrailVelocity(12, 0, Math.PI / 2, 0.9, 1)
  const driftingSmoke = rearOnlyTrailVelocity(12, 2, Math.PI / 2)
  const bulletEmitter = projectileTailEmitter(5, 6, Math.PI / 2, 0.8)
  check('所有弹丸尾迹统一：惯性与烟尾不含航向前方速度，贴图弹丸从弹体尾端发射',
    inheritedTrail.vx <= 1e-9 && driftingSmoke.vx <= 1e-9
      && Math.abs(bulletEmitter.x - 4.6) < 1e-9 && Math.abs(bulletEmitter.y - 6) < 1e-9,
    `trail=${JSON.stringify(inheritedTrail)} smoke=${JSON.stringify(driftingSmoke)} emitter=${JSON.stringify(bulletEmitter)}`)
  const uprightGlow = missileEngineGlowLayout(0.5, tailStart)
  const middleGlow = missileEngineGlowLayout(0.5, tailMiddle)
  const flightGlow = missileEngineGlowLayout(0.5, tailFlight)
  check('垂发喷口辉光：竖直首帧隐藏，转向后仅从弹体中心向航向后方渐显并最终锚定尾端',
    uprightGlow.alpha === 0 && uprightGlow.y === 0
      && middleGlow.alpha === 0.5 && middleGlow.y === 0.25
      && flightGlow.alpha === 1 && flightGlow.y === 0.5,
    `upright=${JSON.stringify(uprightGlow)} middle=${JSON.stringify(middleGlow)} flight=${JSON.stringify(flightGlow)}`)
  const migratedSharedAsset = migrateVerticalLaunchProjectileAsset({
    id: 'legacy-vertical', name: '旧垂发', kind: 'missile', projectileAsset: 'old-flight', verticalLaunch: { enabled: true, asset: 'old-turn-strip', duration: 0.6 },
  } as unknown as ProjectileArtDef)
  check('旧独立垂发转向贴图迁入统一弹丸贴图并删除旧字段',
    migratedSharedAsset.projectileAsset === 'old-turn-strip'
      && !('asset' in (migratedSharedAsset.verticalLaunch ?? {})))

  Math.random = zeroRandom
  const hunter = TURRET_DEFS.find(d => d.id === 'hunter')!
  const hunterAmmo = PROJECTILE_ARTS.find(a => a.id === hunter.art?.projectile)!
  const savedVerticalLaunch = structuredClone(hunterAmmo.verticalLaunch)
  const savedDelay = hunterAmmo.guideDelay
  const savedTurretDelay = hunter.guideDelay
  const savedSplit = structuredClone(hunterAmmo.split)
  const savedVerticalFlightTime = hunterAmmo.missileFlightTime
  hunterAmmo.verticalLaunch = { enabled: true, duration: 0.6 }
  hunterAmmo.missileFlightTime = 2
  delete hunterAmmo.guideDelay
  delete hunter.guideDelay
  delete hunterAmmo.split
  let s = arena()
  mkTurret(s, 'hunter', 6, 20)
  const candidateA = mkEnemy(s, 'walker', 14.5, 18.5)
  const candidateB = mkEnemy(s, 'walker', 8.5, 15)
  let launched: (typeof s.projectiles)[number] | undefined
  for (let i = 0; i < 60 && !launched; i++) {
    s = tick(s, 0.05)
    launched = s.projectiles.find(p => p.kind === 'missile')
  }
  const launchX = launched?.x, launchY = launched?.y, lockedTargetId = launched?.targetId
  const launchFlightLeft = launched?.flightLeft
  const replacementId = lockedTargetId === candidateA.id ? candidateB.id : candidateA.id
  if (lockedTargetId !== undefined && lockedTargetId !== null) byId(s.enemies, lockedTargetId)!.hp = 0
  s = run(s, 0.25, 0.05)
  const during = s.projectiles.find(p => p.id === launched?.id)
  check('垂发转向期间弹体持续移动，制导和重索敌生效且不扣飞行寿命',
    lockedTargetId !== undefined && lockedTargetId !== null && during !== undefined && during.targetId === replacementId
      && launchX !== undefined && launchY !== undefined
      && Math.hypot(during.x - launchX, during.y - launchY) > 1e-6
      && launchFlightLeft !== undefined && Math.abs((during.flightLeft ?? -1) - launchFlightLeft) < 1e-9,
    `locked=${lockedTargetId} target=${during?.targetId} pos=${during?.x.toFixed(3)},${during?.y.toFixed(3)} flight=${during?.flightLeft}`)
  for (let i = 0; i < 20; i++) {
    const current = s.projectiles.find(p => p.id === launched?.id)
    if (!current || current.t >= 0.65) break
    s = tick(s, 0.05)
  }
  const after = s.projectiles.find(p => p.id === launched?.id)
  check('垂发结束后继续移动并扣减飞行寿命，继续跟踪垂发期间锁定的新目标',
    after !== undefined && after.targetId === replacementId
      && launchX !== undefined && launchY !== undefined
      && Math.hypot(after.x - launchX, after.y - launchY) > 1e-6
      && launchFlightLeft !== undefined && (after.flightLeft ?? Infinity) < launchFlightLeft,
    `target=${after?.targetId} replacement=${replacementId} t=${after?.t.toFixed(2)} flight=${after?.flightLeft}`)

  let unitState = arena()
  const playerRect = fortressRect(unitState)
  const playerCenter = { x: playerRect.x + playerRect.w / 2, y: playerRect.y + playerRect.h / 2 }
  const unitLaunch = { x: playerCenter.x, y: playerCenter.y - 8 }
  const unitMissileId = unitState.nextId++
  unitState.enemyProjectiles.push({
    id: unitMissileId, shooterId: -1,
    x: unitLaunch.x, y: unitLaunch.y, px: unitLaunch.x, py: unitLaunch.y,
    heading: Math.PI / 2, speed: 4, damage: 1, penetration: 0,
    traveled: 0, maxTravel: 999,
    kind: 'missile', defId: hunter.id, ammoId: hunterAmmo.id,
    t: 0, guided: true, willGuide: true, turnRate: 0,
    missileAccel: 40, missileMaxSpeed: 100, missileTurnMax: 120, missileTurnAccel: 240,
    flightLeft: 2, targetKind: 'fortress', targetX: playerCenter.x, targetY: playerCenter.y,
    tgtPX: playerCenter.x, tgtPY: playerCenter.y,
    sourceSide: 'enemy', sourceFaction: 'enemy',
  })
  unitState = run(unitState, 0.25, 0.05)
  const unitDuring = unitState.enemyProjectiles.find(projectile => projectile.id === unitMissileId)
  check('敌方/友方单位导弹共用垂发口径：转向期制导并持续移动，但不扣飞行寿命',
    unitDuring !== undefined
      && Math.hypot(unitDuring.x - unitLaunch.x, unitDuring.y - unitLaunch.y) > 1e-6
      && Math.abs((unitDuring.flightLeft ?? -1) - 2) < 1e-9
      && Math.abs(unitDuring.heading - Math.PI / 2) > 1e-6,
    `pos=${unitDuring?.x.toFixed(3)},${unitDuring?.y.toFixed(3)} heading=${unitDuring?.heading.toFixed(3)} flight=${unitDuring?.flightLeft}`)
  unitState = run(unitState, 0.4, 0.05)
  const unitAfter = unitState.enemyProjectiles.find(projectile => projectile.id === unitMissileId)
  check('敌方/友方单位导弹转向结束后继续移动并开始扣飞行寿命',
    unitAfter !== undefined
      && Math.hypot(unitAfter.x - unitLaunch.x, unitAfter.y - unitLaunch.y) > 1e-6
      && (unitAfter.flightLeft ?? Infinity) < 2,
    `pos=${unitAfter?.x.toFixed(3)},${unitAfter?.y.toFixed(3)} flight=${unitAfter?.flightLeft}`)
  if (savedVerticalLaunch) hunterAmmo.verticalLaunch = savedVerticalLaunch
  else delete hunterAmmo.verticalLaunch
  if (savedDelay !== undefined) hunterAmmo.guideDelay = savedDelay
  else delete hunterAmmo.guideDelay
  if (savedTurretDelay !== undefined) hunter.guideDelay = savedTurretDelay
  else delete hunter.guideDelay
  if (savedSplit) hunterAmmo.split = savedSplit
  else delete hunterAmmo.split
  if (savedVerticalFlightTime !== undefined) hunterAmmo.missileFlightTime = savedVerticalFlightTime
  else delete hunterAmmo.missileFlightTime
}

// --- ④ 非制导导弹无重选行为（目标消灭不影响锁定落点） ---
{
  Math.random = zeroRandom
  let s = arena()
  mkTurret(s, 'cruise', 6, 20)
  const a = mkEnemy(s, 'walker', 6.5, 14)
  let p0: (typeof s.projectiles)[number] | undefined
  for (let i = 0; i < 40 && !p0; i++) {
    s = tick(s, 0.05)
    p0 = s.projectiles.find(p => p.kind === 'missile')
  }
  const guided0 = p0?.guided
  const tid0 = p0?.targetId ?? null
  byId(s.enemies, a.id)!.hp = 0
  s = tick(s, 0.05)
  const p1 = s.projectiles.find(p => p.id === p0?.id)
  check('非制导导弹无重选行为（直飞锁定落点）',
    !!p0 && guided0 === false && p1 !== undefined && (p1.targetId ?? null) === tid0,
    `guided=${guided0} t0=${tid0} t1=${p1?.targetId}`)
}

// --- ⑤ v1.94 延迟制导：出生沿炮塔方向直飞不追踪，延迟到期开制导命中 ---
{
  Math.random = zeroRandom
  const hunter = TURRET_DEFS.find(d => d.id === 'hunter')!
  const hunterAmmo = PROJECTILE_ARTS.find(a => a.id === hunter.art?.projectile)!
  const savedDelay = hunterAmmo.guideDelay
  hunterAmmo.guideDelay = 0.5
  let s = arena()
  mkTurret(s, 'hunter', 6, 20)
  const e94 = mkEnemy(s, 'walker', 8.5, 15)
  let p0: (typeof s.projectiles)[number] | undefined
  for (let i = 0; i < 60 && !p0; i++) {
    s = tick(s, 0.05)
    p0 = s.projectiles.find(p => p.kind === 'missile')
  }
  const h0 = p0?.heading
  check('v1.94：延迟制导弹出生 guided=false + 携带延迟倒计时 + 保留目标',
    !!p0 && p0.guided === false && p0.guideDelayLeft !== undefined && p0.guideDelayLeft > 0.3 && p0.targetId === e94.id,
    `guided=${p0?.guided} delayLeft=${p0?.guideDelayLeft?.toFixed(2)} target=${p0?.targetId}`)
  s = tick(s, 0.05); s = tick(s, 0.05) // 延迟期内再推进 0.1s（累计 ≤0.5s）
  const p1 = s.projectiles.find(p => p.id === p0?.id)
  check('v1.94：延迟期内航向不变（沿炮塔方向直飞不追踪）',
    !!p1 && h0 !== undefined && Math.abs(p1.heading - h0) < 1e-9 && p1.guided === false,
    `h0=${h0?.toFixed(3)} h1=${p1?.heading.toFixed(3)} guided=${p1?.guided}`)
  let hit94 = false
  for (let i = 0; i < 200 && !hit94; i++) { // 最长 10s：延迟到期 → 开制导 → 命中
    s = tick(s, 0.05)
    if (byId(s.enemies, e94.id)!.hp < byId(s.enemies, e94.id)!.maxHp) hit94 = true
  }
  const pEnd = s.projectiles.find(p => p.id === p0?.id)
  check('v1.94：延迟到期开制导并命中目标', hit94 && (!pEnd || pEnd.guided || pEnd.fading !== undefined),
    `hit=${hit94}`)
  hunterAmmo.guideDelay = savedDelay
}

// --- ⑥ v1.94 兼容回归：guided=true 无 guideDelay → 立即制导（无延迟字段） ---
{
  Math.random = zeroRandom
  const hunter6 = TURRET_DEFS.find(d => d.id === 'hunter')!
  const hunterAmmo6 = PROJECTILE_ARTS.find(a => a.id === hunter6.art?.projectile)!
  const savedDelay6 = hunterAmmo6.guideDelay
  const savedTurretDelay6 = hunter6.guideDelay
  delete hunterAmmo6.guideDelay // 临时移除弹丸库延迟制导，模拟立即制导
  delete hunter6.guideDelay
  let s = arena()
  mkTurret(s, 'hunter', 6, 20)
  mkEnemy(s, 'walker', 8.5, 15)
  let p0: (typeof s.projectiles)[number] | undefined
  for (let i = 0; i < 60 && !p0; i++) {
    s = tick(s, 0.05)
    p0 = s.projectiles.find(p => p.kind === 'missile')
  }
  check('v1.94：立即制导弹无延迟字段且出生即追踪（兼容旧配置）',
    !!p0 && p0.guided === true && p0.guideDelayLeft === undefined && p0.targetId !== null,
    `guided=${p0?.guided} delayLeft=${p0?.guideDelayLeft}`)
  hunterAmmo6.guideDelay = savedDelay6
  hunter6.guideDelay = savedTurretDelay6
}


// --- ⑦ v1.96 导弹初速度 + 延迟减速度：出生带初速，延迟期减速，到期恢复加速 ---
{
  Math.random = zeroRandom
  const hunter = TURRET_DEFS.find(d => d.id === 'hunter')!
  const hunterAmmo = PROJECTILE_ARTS.find(a => a.id === hunter.art?.projectile)!
  const bakDelay = hunterAmmo.guideDelay, bakInit = hunterAmmo.missileInitSpeed, bakDecel = hunterAmmo.guideDecel
  hunterAmmo.guideDelay = 0.5
  hunterAmmo.missileInitSpeed = legacyMeters(100)
  hunterAmmo.guideDecel = legacyMeters(150) // 延迟 0.5s 内按旧格速等比减速
  let s = arena()
  mkTurret(s, 'hunter', 6, 20)
  mkEnemy(s, 'walker', 8.5, 15)
  let p0: (typeof s.projectiles)[number] | undefined
  for (let i = 0; i < 60 && !p0; i++) {
    s = tick(s, 0.05)
    p0 = s.projectiles.find(p => p.kind === 'missile')
  }
  check('v1.96：导弹出生速度 = 初速度参数（而非 0）',
    !!p0 && p0.speed > legacyMeters(80) && p0.speed <= legacyMeters(100),
    `speed=${p0?.speed.toFixed(1)}`)
  let prevSp = p0!.speed
  let decOK = true
  for (let i = 0; i < 4; i++) { // 延迟期内：速度应严格递减（150×0.05=7.5/tick）
    s = tick(s, 0.05)
    const pp = s.projectiles.find(p => p.id === p0!.id)
    if (!pp || pp.speed >= prevSp) decOK = false
    else prevSp = pp.speed
  }
  check('v1.96：延迟期内速度按延迟减速度递减', decOK && prevSp < legacyMeters(90), `末速=${prevSp.toFixed(1)}`)
  let sp2 = 0, guided96 = false
  for (let i = 0; i < 40; i++) { // 延迟到期：开制导 + 恢复加速度爬升
    s = tick(s, 0.05)
    const pp = s.projectiles.find(p => p.id === p0!.id)
    if (pp && pp.guided) {
      guided96 = true
      sp2 = pp.speed
      if (sp2 > prevSp) break
    }
  }
  check('v1.96：延迟到期后开制导并恢复加速（速度重新爬升）', guided96 && sp2 > prevSp,
    `guided=${guided96} 延迟末速=${prevSp.toFixed(1)} 制导后=${sp2.toFixed(1)}`)
  hunterAmmo.guideDelay = bakDelay; hunterAmmo.missileInitSpeed = bakInit; hunterAmmo.guideDecel = bakDecel
}

// --- ⑧ v1.96 延迟减速度下限：减到 0 为止不出现负速度 ---
{
  Math.random = zeroRandom
  const hunter = TURRET_DEFS.find(d => d.id === 'hunter')!
  const hunterAmmo = PROJECTILE_ARTS.find(a => a.id === hunter.art?.projectile)!
  const bakDelay = hunterAmmo.guideDelay, bakInit = hunterAmmo.missileInitSpeed, bakDecel = hunterAmmo.guideDecel
  hunterAmmo.guideDelay = 0.5
  hunterAmmo.missileInitSpeed = 10
  hunterAmmo.guideDecel = 10000 // 极大减速度：第 1 tick 就应钳到 0
  let s = arena()
  mkTurret(s, 'hunter', 6, 20)
  mkEnemy(s, 'walker', 8.5, 15)
  let p0: (typeof s.projectiles)[number] | undefined
  for (let i = 0; i < 60 && !p0; i++) {
    s = tick(s, 0.05)
    p0 = s.projectiles.find(p => p.kind === 'missile')
  }
  s = tick(s, 0.05); s = tick(s, 0.05)
  const p1 = s.projectiles.find(p => p.id === p0?.id)
  check('v1.96：延迟减速度将速度钳到 0（不为负）',
    !!p1 && p1.speed === 0 && p1.guided === false,
    `speed=${p1?.speed} guided=${p1?.guided}`)
  hunterAmmo.guideDelay = bakDelay; hunterAmmo.missileInitSpeed = bakInit; hunterAmmo.guideDecel = bakDecel
}

// --- ⑨ v1.96 兼容回归：未配置初速度/减速度 → 出生 0 速、延迟期照常加速 ---
{
  Math.random = zeroRandom
  const hunter = TURRET_DEFS.find(d => d.id === 'hunter')!
  const hunterAmmo = PROJECTILE_ARTS.find(a => a.id === hunter.art?.projectile)!
  const bakDelay = hunterAmmo.guideDelay, bakInit = hunterAmmo.missileInitSpeed, bakDecel = hunterAmmo.guideDecel
  const bakTurretInit = hunter.missileInitSpeed, bakTurretDecel = hunter.guideDecel
  hunterAmmo.guideDelay = 0.5 // 仅延迟，无初速/减速
  delete hunterAmmo.missileInitSpeed
  delete hunterAmmo.guideDecel
  delete hunter.missileInitSpeed
  delete hunter.guideDecel
  let s = arena()
  mkTurret(s, 'hunter', 6, 20)
  mkEnemy(s, 'walker', 8.5, 15)
  let p0: (typeof s.projectiles)[number] | undefined
  for (let i = 0; i < 60 && !p0; i++) {
    s = tick(s, 0.05)
    p0 = s.projectiles.find(p => p.kind === 'missile')
  }
  const spA = p0?.speed ?? -1
  s = tick(s, 0.05); s = tick(s, 0.05)
  const p1 = s.projectiles.find(p => p.id === p0?.id)
  check('v1.96：未配置时出生近 0 速且延迟期照常加速（旧行为兼容）',
    spA >= 0 && spA <= 4 && !!p1 && p1.speed > spA && p1.guided === false,
    `出生=${spA.toFixed(1)} 两帧后=${p1?.speed.toFixed(1)}`)
  hunterAmmo.guideDelay = bakDelay; hunterAmmo.missileInitSpeed = bakInit; hunterAmmo.guideDecel = bakDecel
  hunter.missileInitSpeed = bakTurretInit; hunter.guideDecel = bakTurretDecel
}


// --- v2.20/v2.21 出厂断言：猎手真集束分裂 / 集束导弹长存留烟尾 / 制导律字段已移除（恒前置量） ---
{
  const hunter = TURRET_DEFS.find(d => d.id === 'hunter')!
  check('v2.27：猎手出厂集束分裂已移除（split 不存在）',
    hunter.split === undefined,
    `split=${JSON.stringify(hunter.split)}`)
  check('v2.21：制导律字段已移除（制导恒前置量追踪，hunter 不再携带 guidance）',
    (hunter as unknown as Record<string, unknown>).guidance === undefined && !('guidance' in hunter),
    `guidance=${String((hunter as unknown as Record<string, unknown>).guidance)}`)
  const ca = PROJECTILE_ARTS.find(a => a.id === 'custom_ammo_1')!
  const tf = resolveTrailFx(ca)
  check('v2.20：集束导弹尾迹挂长存留烟雾组（缺省 20 粒/s·3s·#9A958E）',
    !!tf && !!tf.smoke && tf.smoke.rate === 20 && tf.smoke.life === 3 && tf.smoke.color === '#9A958E',
    `smoke=${JSON.stringify(tf?.smoke)}`)
  const tfB = resolveTrailFx(PROJECTILE_ARTS.find(a => a.id === 'bullet_std')!)
  check('v2.20：未配置 smoke 组的尾迹解析为 undefined（兼容旧配置）', !!tfB && tfB.smoke === undefined, `smoke=${JSON.stringify(tfB?.smoke)}`)
}

// --- v2.21 ① 制导恒前置量：对横移目标的航向显著领先直飞方位（制导律字段已删，所有制导/延迟制导统一 lead） ---
{
  Math.random = zeroRandom
  const hunter = TURRET_DEFS.find(d => d.id === 'hunter')!
  const bakDelay = hunter.guideDelay, bakCurve = hunter.missileCurve, bakSplit = hunter.split
  delete hunter.guideDelay
  delete hunter.missileCurve // 排除 weave 噪声，聚焦制导律
  delete hunter.split // 排除分裂干扰
  const bear = (dx: number, dy: number) => Math.atan2(dx, -dy)
  let s = arena()
  mkTurret(s, 'hunter', 6, 20)
  const e = mkEnemy(s, 'walker', 6.5, 12)
  let lastDiff = 0
  s = run(s, 2.5, 0.05, st => {
    const ee = st.enemies.find(x => x.id === e.id)
    if (ee) ee.x += 4 * 0.05 // 目标匀速横移 +x（4 格/秒 = 100 m/s）
    const m = st.projectiles.find(p => p.kind === 'missile' && p.guided)
    if (m && ee) lastDiff = Math.abs(wrapAngle(m.heading - bear(ee.x - m.x, ee.y - m.y))) // 航向 vs 直飞方位偏差
  })
  check('v2.21：制导恒前置量——航向领先目标当前方位（横移目标；纯追踪应 ≈0°）',
    lastDiff > 6 * Math.PI / 180,
    `lead=${(lastDiff * 57.3).toFixed(1)}°`)
  hunter.guideDelay = bakDelay; hunter.missileCurve = bakCurve; hunter.split = bakSplit
}

// --- 出膛偏角：填写总随机区间，延迟期内按弹丸 id 确定性取样 ---
{
  Math.random = zeroRandom
  const hunter = TURRET_DEFS.find(d => d.id === 'hunter')!
  const bakEject = hunter.ejectAngle, bakSplit = hunter.split
  hunter.ejectAngle = 20
  delete hunter.split
  let s = arena()
  mkTurret(s, 'hunter', 6, 20) // hunter rotateSpeed 0 → 炮塔向恒 0（-y）
  mkEnemy(s, 'walker', 6.5, 12)
  let p0: (typeof s.projectiles)[number] | undefined
  for (let i = 0; i < 60 && !p0; i++) {
    s = tick(s, 0.05)
    p0 = s.projectiles.find(p => p.kind === 'missile')
  }
  const expected = p0 ? missileEjectOffsetDeg(20, p0.id) * Math.PI / 180 : 999
  const dev = p0 ? Math.abs(wrapAngle(p0.heading - expected)) : 999
  check('出膛偏角 20° → 每发在 -10°～+10° 确定性取样（且延迟期未开制导）',
    !!p0 && Math.abs(p0.heading) <= 10 * Math.PI / 180 + 1e-9 && dev < 1e-9 && p0.guided === false,
    `heading=${p0 ? (p0.heading * 57.3).toFixed(1) : '?'}° expected=${expected === 999 ? '?' : (expected * 57.3).toFixed(1)}° guided=${p0?.guided}`)
  check('制导延迟期间曲线幅度提高 100%，延迟结束恢复设定值',
    missileCurveAmplitudeScale(0.5) === 2 && missileCurveAmplitudeScale(0) === 1,
    `delay=${missileCurveAmplitudeScale(0.5)} guided=${missileCurveAmplitudeScale(0)}`)
  if (bakEject !== undefined) hunter.ejectAngle = bakEject; else delete hunter.ejectAngle
  hunter.split = bakSplit
}

// --- v2.20 ③ 燃烧时间：燃尽后速度封顶惯性滑行（不再加速、低于极速） ---
{
  Math.random = zeroRandom
  const hunter = TURRET_DEFS.find(d => d.id === 'hunter')!
  const hunterAmmo = PROJECTILE_ARTS.find(a => a.id === hunter.art?.projectile)!
  const bakDelay = hunterAmmo.guideDelay, bakCurve = hunterAmmo.missileCurve, bakSplit = hunterAmmo.split, bakBurn = hunterAmmo.burnTime
  delete hunterAmmo.guideDelay
  delete hunterAmmo.missileCurve
  delete hunterAmmo.split
  hunterAmmo.burnTime = 0.6
  let s = arena()
  mkTurret(s, 'hunter', 6, 20)
  mkEnemy(s, 'walker', 6.5, 6) // 远距离目标：保证弹存活足够久
  let spAtBurn = -1, spLate = -1, p0id = -1
  s = run(s, 3, 0.05, st => {
    const m = st.projectiles.find(p => p.kind === 'missile')
    if (!m) return
    p0id = m.id
    if (m.t >= 0.62 && spAtBurn < 0) spAtBurn = m.speed // 刚燃尽
    if (m.t >= 1.5 && spLate < 0) spLate = m.speed // 燃尽后 0.9s
  })
  check('v2.20：燃烧时间耗尽后速度不再爬升（惯性滑行，且低于极速 320）',
    p0id >= 0 && spAtBurn > 0 && spLate > 0 && Math.abs(spLate - spAtBurn) < 0.01 && spLate < 320,
    `燃尽末速=${spAtBurn.toFixed(1)} 1.5s=${spLate.toFixed(1)}`)
  hunterAmmo.guideDelay = bakDelay; hunterAmmo.missileCurve = bakCurve; hunterAmmo.split = bakSplit
  if (bakBurn !== undefined) hunterAmmo.burnTime = bakBurn; else delete hunterAmmo.burnTime
}

// --- v2.20 ④ 非制导沿途撞击：飞行途中撞敌即在敌处爆炸（不再只等锁定落点） ---
{
  Math.random = zeroRandom
  const hunter = TURRET_DEFS.find(d => d.id === 'hunter')!
  const bakGuided = hunter.guided, bakCurve = hunter.missileCurve, bakSplit = hunter.split
  hunter.guided = false
  delete hunter.missileCurve // 直线直飞，聚焦沿途撞击
  delete hunter.split
  let s = arena()
  mkTurret(s, 'hunter', 6, 20)
  mkEnemy(s, 'walker', 6.5, 12) // 锁定落点（远）
  const eb = mkEnemy(s, 'walker', 6.5, 16.5) // 弹道上（近）——旧行为：掠过不炸，直落锁定点
  s = run(s, 4, 0.05)
  const ebAfter = s.enemies.find(x => x.id === eb.id)
  check('v2.20：非制导导弹沿途撞上弹道中途敌人并结算伤害', !!ebAfter && ebAfter.hp < ebAfter.maxHp,
    `hp=${ebAfter?.hp.toFixed(1)}/${ebAfter?.maxHp}`)
  hunter.guided = bakGuided; hunter.missileCurve = bakCurve; hunter.split = bakSplit
}

// --- v2.20 ⑨ 真集束（近炸）：裂为 3 颗、伤害均分、母弹移除、子弹不再分裂 ---
{
  Math.random = zeroRandom
  const hunter20 = TURRET_DEFS.find(d => d.id === 'hunter')!
  const hunterAmmo20 = PROJECTILE_ARTS.find(a => a.id === hunter20.art?.projectile)!
  const bakSplit20 = hunterAmmo20.split
  hunterAmmo20.split = { count: 3, spread: 40, at: 'proximity', range: M_PER_CELL }
  let s = arena()
  mkTurret(s, 'hunter', 6, 20)
  mkEnemy(s, 'walker', 6.5, 12)
  let firstSubs = 0, subDmg = 0, maxSubs = 0, parentGone = false
  s = run(s, 8, 0.05, st => {
    const subs = st.projectiles.filter(p => p.splitDone)
    if (subs.length > maxSubs) maxSubs = subs.length
    if (subs.length > 0 && firstSubs === 0) {
      firstSubs = subs.length
      subDmg = subs[0].damage
      parentGone = !st.projectiles.some(p => !p.splitDone && Math.hypot(p.x - subs[0].x, p.y - subs[0].y) < 0.5) // 母弹应与子弹同位——已移除
    }
  })
  check('v2.20：近炸分裂 = 3 颗子弹、伤害均分 ≈34/3、母弹同位消失',
    firstSubs === 3 && Math.abs(subDmg - 34 / 3) < 0.01 && parentGone,
    `subs=${firstSubs} dmg=${subDmg.toFixed(2)} parentGone=${parentGone}`)
  check('v2.20：子弹 splitDone 防再分裂（同屏子弹数不爆炸式增长）且继承制导结算伤害',
    maxSubs <= 6 && s.enemies[0].hp < 100000 - 30,
    `maxSubs=${maxSubs} hp=${s.enemies[0].hp.toFixed(1)}`)
  hunterAmmo20.split = bakSplit20
}

// --- v2.20 ⑨b 真集束（燃尽）：burnTime 耗尽触发分裂，子弹继承弹龄 ---
{
  Math.random = zeroRandom
  const hunter = TURRET_DEFS.find(d => d.id === 'hunter')!
  const hunterAmmo = PROJECTILE_ARTS.find(a => a.id === hunter.art?.projectile)!
  const bakSplit = hunterAmmo.split, bakBurn = hunterAmmo.burnTime, bakDelay = hunterAmmo.guideDelay, bakCurve = hunterAmmo.missileCurve
  delete hunterAmmo.guideDelay
  delete hunterAmmo.missileCurve
  hunterAmmo.burnTime = 0.6
  hunterAmmo.split = { count: 2, spread: 30, at: 'burnout' }
  let s = arena()
  mkTurret(s, 'hunter', 6, 20)
  mkEnemy(s, 'walker', 6.5, 6)
  let firstSubs = 0, subT = -1
  s = run(s, 4, 0.05, st => {
    const subs = st.projectiles.filter(p => p.splitDone)
    if (subs.length > 0 && firstSubs === 0) { firstSubs = subs.length; subT = subs[0].t }
  })
  check('v2.20：燃尽分裂 = 燃烧时间耗尽触发（子弹弹龄 ≥ burnTime）',
    firstSubs === 2 && subT >= 0.6 - 1e-6,
    `subs=${firstSubs} subT=${subT.toFixed(2)}`)
  hunterAmmo.split = bakSplit; hunterAmmo.guideDelay = bakDelay; hunterAmmo.missileCurve = bakCurve
  if (bakBurn !== undefined) hunterAmmo.burnTime = bakBurn; else delete hunterAmmo.burnTime
}

// --- v2.23 ② 烟尾「持续」：点火后喷射窗口，≤ 燃烧时间；缺省=整个燃烧期 ---
{
  check('v2.23：smokeDuration——持续 ≤ 炮塔燃烧时间（未配 burnTime 不钳；未配持续=整个燃烧期）',
    smokeDuration(5, 3) === 3 && smokeDuration(2, 3) === 2 && smokeDuration(5, undefined) === 5 && smokeDuration(undefined, 3) === undefined,
    `sd(5,3)=${smokeDuration(5, 3)} sd(undef,3)=${smokeDuration(undefined, 3)}`)
  // 点火时刻弹龄：延迟制导弹 = 弹丸库出生延迟；当前集束导弹 guideDelay=0.5
  Math.random = zeroRandom
  let s = arena()
  mkTurret(s, 'hunter', 6, 20)
  mkEnemy(s, 'walker', 6.5, 12)
  let p0: (typeof s.projectiles)[number] | undefined
  for (let i = 0; i < 60 && !p0; i++) {
    s = tick(s, 0.05)
    p0 = s.projectiles.find(p => p.kind === 'missile')
  }
  check('v2.23：导弹携带点火时刻弹龄（igniteAtT = 出生制导延迟 0.5s）',
    !!p0 && Math.abs((p0.igniteAtT ?? -1) - 0.5) < 1e-9,
    `igniteAtT=${p0?.igniteAtT}`)
}

// --- v2.21 ③ 烟尾扩散后逐渐消失：growUntil 后尺寸冻结、寿命耗尽移除 ---
{
  const pool = createPool()
  spawnTrail(pool, 0, 0, { vx: 0, vy: 0, life: 1, size: 0.1, color: '#9A958E', drag: 0, grow: 10, growUntil: 0.4 })
  const pt = pool.parts[0]
  for (let i = 0; i < 8; i++) stepParticles(pool, 0.05) // 年龄 0.4 = 寿命 40%：growUntil 边界
  const sizeAt40 = pt.size
  for (let i = 0; i < 4; i++) stepParticles(pool, 0.05) // 年龄 0.6：超过 growUntil → 尺寸应冻结
  const sizeAt60 = pt.size
  const grownBefore = sizeAt40 > 0.1 * 2 // 前 40% 有明显膨胀（grow 10 × 0.4s ≈ ×e^4 量级，宽松断言）
  for (let i = 0; i < 20; i++) stepParticles(pool, 0.05) // 总计 1.6s > 寿命 1s → 粒子移除
  check('v2.21：烟尾扩散后逐渐消失——growUntil 前膨胀、之后尺寸冻结、寿命耗尽移除',
    grownBefore && Math.abs(sizeAt60 - sizeAt40) < 1e-9 && pool.parts.length === 0,
    `size@40%=${sizeAt40.toFixed(3)} size@60%=${sizeAt60.toFixed(3)} left=${pool.parts.length}`)
}

// --- v2.3 充能帧条横向等分：chargeFrameRect 纯函数单测 ---
{
  const r1 = chargeFrameRect(400, 100, 4, 0)      // 第 1 帧（最左）
  const r2 = chargeFrameRect(400, 100, 4, 0.26)   // 第 2 帧
  const r3 = chargeFrameRect(400, 100, 4, 0.99)   // 末帧（最右）
  const r4 = chargeFrameRect(400, 100, 4, 1.5)    // 进度越界 → 钳末帧
  const r5 = chargeFrameRect(90, 60, 3, 0.5)      // 非整除宽度：90/3=30
  check('v2.3：充能帧条按帧数横向等分（帧宽=图宽/帧数，全高）',
    r1.sx === 0 && r1.sw === 100 && r1.sh === 100
    && r2.sx === 100 && r3.sx === 300 && r4.sx === 300
    && Math.abs(r5.sx - 30) < 1e-9 && r5.sw === 30,
    `r1=${r1.sx}/${r1.sw} r2=${r2.sx} r3=${r3.sx} r5=${r5.sx}/${r5.sw}`)
}

// --- v2.6 烟尘贴图 smoke32.png 落位（粒子层引用 /res/fx/smoke32.png）---
{
  const fs = await import('node:fs')
  const p = 'public/res/fx/smoke32.png'
  const ok = fs.existsSync(p) && fs.statSync(p).size > 0
  // PNG 魔数校验
  const magic = ok ? fs.readFileSync(p).subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) : false
  check('v2.6：烟尘粒子贴图 /res/fx/smoke32.png 存在且为合法 PNG', ok && magic, ok ? 'bytes=' + fs.statSync(p).size : 'missing')
}

// --- v2.11 ① 光束贴图迁移 /res/beam/（15 张新贴图 + 独立 beam 分类；旧 7 张与旧目录删除）---
{
  const fs = await import('node:fs')
  const files = ['beam_coreA', 'beam_coreB', 'beam_coreC', 'beam_glowA', 'beam_glowB', 'beam_glowC', 'beam_glowD',
    'beam_chunky_core', 'beam_chunky_glow', 'beam_laser_core', 'beam_laser_glow',
    'beam_rough2_core', 'beam_rough2_glow', 'beam_weave_core', 'beam_weave_glow']
  const magic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const bad: string[] = []
  for (const f of files) {
    const p = `public/res/beam/${f}.png`
    if (!fs.existsSync(p) || !fs.readFileSync(p).subarray(0, 8).equals(magic)) bad.push(p)
    const a = getAsset(`builtin:beam/${f}`) // 素材库条目存在且类别为光束、src 指向 /res/beam/
    if (!a || a.category !== 'beam' || a.src !== `/res/beam/${f}.png`) bad.push(`asset:${f}`)
  }
  const oldFiles = ['beam_glow_a', 'beam_glow_b', 'beam_glow_c', 'beam_glow_d', 'beam_core_a', 'beam_core_b', 'beam_core_c']
  for (const f of oldFiles) { // 旧内置条目与旧目录必须已删除
    if (getAsset(`builtin:library/${f}`)) bad.push(`old-asset:${f}`)
  }
  if (fs.existsSync('public/res/projectiles/beam')) bad.push('old-dir:projectiles/beam')
  check('v2.11：15 张光束贴图落位 /res/beam/ 且注册 beam 分类；旧 7 张条目与旧目录已删除', bad.length === 0, bad.join(',') || '15 png + 15 entries，旧 7 清除')
}

// --- v2.8 ② beamArtConfig（条目式）：经 art.projectile 引用 ray 条目解析；无引用/无 beam 组 → 默认搭配 ---
{
  const mkEntry = (beam?: unknown) => {
    const pa = { id: '__v28test', name: 't', kind: 'ray', ...(beam === undefined ? {} : { beam }) } as never
    PROJECTILE_ARTS.push(pa)
    return pa
  }
  const popEntry = () => { const i = PROJECTILE_ARTS.findIndex(a => a.id === '__v28test'); if (i >= 0) PROJECTILE_ARTS.splice(i, 1) }
  const beamDef = (refEntry: boolean) => ({ id: 't', type: 'beam', art: refEntry ? { projectile: '__v28test' } : {} }) as never
  const d0 = beamArtConfig(beamDef(false)) // 未引用条目 → 默认搭配
  mkEntry() // 条目无 beam 组 → 同默认
  const d1 = beamArtConfig(beamDef(true))
  popEntry()
  mkEntry({ glowAsset: 'none', coreAsset: 'none', impactAsset: 'none', muzzleAsset: 'none' })
  const d2 = beamArtConfig(beamDef(true))
  popEntry()
  mkEntry({
    glowAsset: 'builtin:beam/beam_glowC', coreAsset: 'builtin:beam/beam_coreB', // v2.11：新 beam 分类条目
    impactAsset: '/res/fx/glow16.png', muzzleAsset: 'builtin:beam/beam_glowA',
    fringeColor: '#112233', coreColor: '#445566', flicker: 0.5, scrollSpeed: 0,
  })
  const d3 = beamArtConfig(beamDef(true))
  popEntry()
  check('v2.8：beamArtConfig 无引用/条目无 beam 组 = 默认贴图搭配（v2.11 beam_glowA/beam_coreA/glow16，#78C8DC/#F0FAFF，0.15，96）',
    d0.glow !== null && d0.core !== null && d0.impact !== null && d0.muzzle !== null
    && d0.fringeColor === '#78C8DC' && d0.coreColor === '#F0FAFF' && d0.flicker === 0.15 && d0.scrollSpeed === 96
    && d1.fringeColor === '#78C8DC' && d1.flicker === 0.15,
    `d0=${d0.fringeColor}/${d0.coreColor}/${d0.flicker}/${d0.scrollSpeed}`)
  check('v2.8：beamArtConfig 条目「none」 → 该层 null（程序化回退/不显示）',
    d2.glow === null && d2.core === null && d2.impact === null && d2.muzzle === null,
    `d2=${d2.glow},${d2.core},${d2.impact},${d2.muzzle}`)
  check('v2.8：beamArtConfig 条目显式覆盖（库引用/路径/颜色/闪烁/滚动）全部生效',
    d3.glow !== null && d3.core !== null && d3.impact !== null && d3.muzzle !== null
    && d3.fringeColor === '#112233' && d3.coreColor === '#445566' && d3.flicker === 0.5 && d3.scrollSpeed === 0,
    `d3=${d3.fringeColor}/${d3.coreColor}/${d3.flicker}/${d3.scrollSpeed}`)
}

// --- v2.8 ③ validateArt（条目式 beam 校验 + 弹丸引用口径调整）---
{
  const mkEntry = (beam?: unknown, kind = 'ray') => {
    const pa = { id: '__v28test', name: 't', kind, ...(beam === undefined ? {} : { beam }) } as never
    PROJECTILE_ARTS.push(pa)
  }
  const popEntry = () => { const i = PROJECTILE_ARTS.findIndex(a => a.id === '__v28test'); if (i >= 0) PROJECTILE_ARTS.splice(i, 1) }
  const mk = (type: string) => ({ id: 't_beam', name: 't', type, desc: '', cost: 0, art: { projectile: '__v28test' } }) as never
  mkEntry({ fringeColor: '#AABBCC', flicker: 0, scrollSpeed: 120 })
  const ok1 = validateArt(mk('beam'))
  popEntry()
  mkEntry({ fringeColor: 'red' }); const bad1 = validateArt(mk('beam')); popEntry()
  mkEntry({ coreColor: '#12345' }); const bad2 = validateArt(mk('beam')); popEntry()
  mkEntry({ flicker: 1.5 }); const bad3 = validateArt(mk('beam')); popEntry()
  mkEntry({ scrollSpeed: -1 }); const bad4 = validateArt(mk('beam')); popEntry()
  mkEntry({}) // ray 条目带 beam 组，非射线炮塔引用 → warning
  const warn1 = validateArt(mk('direct'))
  popEntry()
  mkEntry({ glowAsset: 'builtin:library/no_such_beam' })
  const warn2 = validateArt(mk('beam'))
  popEntry()
  mkEntry(undefined, 'bullet') // 类别不匹配：beam 炮塔引用 bullet 条目
  const warn3 = validateArt(mk('beam'))
  popEntry()
  check('v2.8：validateArt 持续光束引用 ray 条目不再警告「不生效」，合法 beam 组通过（含边界值 0）',
    ok1.ok && !ok1.warnings.some(w => w.includes('不生效')),
    `ok1=${ok1.ok} warns=${ok1.warnings.join('|')}`)
  check('v2.8：validateArt 条目 beam 非法颜色/越界 flicker/负滚动 → error',
    !bad1.ok && !bad2.ok && !bad3.ok && !bad4.ok
    && bad1.errors.some(e => e.includes('fringeColor')) && bad2.errors.some(e => e.includes('coreColor'))
    && bad3.errors.some(e => e.includes('flicker')) && bad4.errors.some(e => e.includes('scrollSpeed')),
    `b1=${bad1.errors[0]} b3=${bad3.errors[0]}`)
  check('v2.8：validateArt 非射线炮塔引用带 beam 的 ray 条目 / 未知素材 / 类别不匹配 → warning',
    warn1.ok && warn1.warnings.some(w => w.includes('仅射线类炮塔生效'))
    && warn2.ok && warn2.warnings.some(w => w.includes('no_such_beam'))
    && warn3.ok && warn3.warnings.some(w => w.includes('类别不匹配')),
    `w1=${warn1.warnings[0]} w2=${warn2.warnings[0]} w3=${warn3.warnings[0]}`)
}

// --- v2.10 ① beamArtConfigOf：闪光缩放缺省 1；粒子组缺省参数与配色跟随 ---
{
  const d0 = beamArtConfigOf(undefined) // 无条目：缩放 1，粒子组 null
  const d1 = beamArtConfigOf({ id: 'x', name: 'x', kind: 'ray', beam: {} }) // 空组：同缺省
  const d2 = beamArtConfigOf({ id: 'x', name: 'x', kind: 'ray', beam: { fringeColor: '#112233', coreColor: '#445566', absorb: {}, scatter: {}, smoke: {} } }) // 组在=生效，色随配色
  const d3 = beamArtConfigOf({ id: 'x', name: 'x', kind: 'ray', beam: { muzzleScale: 2, impactScale: 0.5, absorb: { rate: 30, color: '#FF0000', size: 0.1 } } })
  check('v2.10：闪光缩放缺省 1（100%），粒子组未配置 = null',
    d0.muzzleScale === 1 && d0.impactScale === 1 && d0.absorb === null && d0.scatter === null && d0.smoke === null
    && d1.muzzleScale === 1 && d1.absorb === null,
    `d0=${d0.muzzleScale}/${d0.impactScale} d1=${d1.absorb}`)
  check('v2.10：粒子组缺省参数（12/24/6 粒/s、0.05/0.05/0.1 格）且颜色跟随配色（吸收=亮芯、散发=光晕、烟尘=暗灰）',
    d2.absorb?.rate === 12 && d2.absorb.color === '#445566' && d2.absorb.size === 0.05
    && d2.scatter?.rate === 24 && d2.scatter.color === '#112233' && d2.scatter.size === 0.05
    && d2.smoke?.rate === 6 && d2.smoke.color === '#3A3632' && d2.smoke.size === 0.1,
    `a=${JSON.stringify(d2.absorb)} s=${JSON.stringify(d2.scatter)} m=${JSON.stringify(d2.smoke)}`)
  check('v2.10：闪光缩放与粒子组显式覆盖生效',
    d3.muzzleScale === 2 && d3.impactScale === 0.5
    && d3.absorb?.rate === 30 && d3.absorb.color === '#FF0000' && d3.absorb.size === 0.1,
    `d3=${d3.muzzleScale}/${d3.impactScale} a=${JSON.stringify(d3.absorb)}`)
}

// --- v2.10 ② validateArt：缩放/粒子组非法值 → error ---
{
  const mkEntry = (beam: unknown) => {
    PROJECTILE_ARTS.push({ id: '__v210test', name: 't', kind: 'ray', beam } as never)
  }
  const popEntry = () => { const i = PROJECTILE_ARTS.findIndex(a => a.id === '__v210test'); if (i >= 0) PROJECTILE_ARTS.splice(i, 1) }
  const mkDef = () => ({ id: 't_beam', name: 't', type: 'beam', desc: '', cost: 0, art: { projectile: '__v210test' } }) as never
  mkEntry({ muzzleScale: 0 }); const bad1 = validateArt(mkDef()); popEntry()
  mkEntry({ impactScale: -1 }); const bad2 = validateArt(mkDef()); popEntry()
  mkEntry({ absorb: { rate: -5 } }); const bad3 = validateArt(mkDef()); popEntry()
  mkEntry({ scatter: { size: 0 } }); const bad4 = validateArt(mkDef()); popEntry()
  mkEntry({ smoke: { color: 'gray' } }); const bad5 = validateArt(mkDef()); popEntry()
  mkEntry({ muzzleScale: 1.5, absorb: { rate: 0, color: '#AABBCC', size: 0.02 } }); const ok1 = validateArt(mkDef()); popEntry()
  check('v2.10：validateArt 缩放/粒子组非法值（0/负缩放、负速率、0 尺寸、非 hex 色）→ error',
    !bad1.ok && !bad2.ok && !bad3.ok && !bad4.ok && !bad5.ok
    && bad1.errors.some(e => e.includes('muzzleScale')) && bad2.errors.some(e => e.includes('impactScale'))
    && bad3.errors.some(e => e.includes('absorb.rate')) && bad4.errors.some(e => e.includes('scatter.size'))
    && bad5.errors.some(e => e.includes('smoke.color')),
    `b1=${bad1.errors[0]} b5=${bad5.errors[0]}`)
  check('v2.10：validateArt 合法缩放与粒子组（含速率 0）通过',
    ok1.ok && ok1.errors.length === 0,
    `ok1=${ok1.ok} errs=${ok1.errors.join('|')}`)
}

// --- v2.15 ① 素材库：「开火效果」改名「效果」+ glow16/particlealpha32/smoke32 注册 ---
{
  const fx = ['glow16', 'particlealpha32', 'smoke32']
  const bad = fx.filter(f => {
    const a = getAsset(`builtin:fx/${f}`)
    return !a || a.category !== 'flash' || a.src !== `/res/fx/${f}.png` || !a.builtin
  })
  check('v2.15：特效贴图注册素材库（builtin:fx/*，分类=效果）',
    bad.length === 0 && ASSET_CATEGORY_NAME.flash === '效果',
    bad.join(',') || `3 entries，分类名=${ASSET_CATEGORY_NAME.flash}`)
}

// --- v2.15 ② 散射：angle 解析缺省 360 / 显式生效 / 越界校验 + fxTick 锥角约束与电焊拖尾 ---
{
  const d0 = beamArtConfigOf({ id: 'x', name: 'x', kind: 'ray', beam: { scatter: {} } })
  const d1 = beamArtConfigOf({ id: 'x', name: 'x', kind: 'ray', beam: { scatter: { angle: 90 } } })
  PROJECTILE_ARTS.push({ id: '__v215test', name: 't', kind: 'ray', beam: { scatter: { angle: 400 } } } as never)
  const badA = validateArt({ id: 't', name: 't', type: 'beam', desc: '', cost: 0, art: { projectile: '__v215test' } } as never)
  PROJECTILE_ARTS.splice(PROJECTILE_ARTS.findIndex(a => a.id === '__v215test'), 1)
  check('v2.15：散射 angle 解析（缺省 360 全向 / 显式 90）与越界校验（400 → error）',
    d0.scatter?.angle === 360 && d1.scatter?.angle === 90
    && !badA.ok && badA.errors.some(e => e.includes('scatter.angle')),
    `d0=${d0.scatter?.angle} d1=${d1.scatter?.angle} err=${badA.errors[0]}`)
  // fxTick 锥角：angle=90 → 全部朝射线源方向（左半平面 vx<0，即 π±45°）且带 streak 拖尾
  PROJECTILE_ARTS.push({ id: '__v215fx', name: 't', kind: 'ray', beam: { scatter: { rate: 200, angle: 90 } } } as never)
  const pool = createPool()
  const st = createFxState()
  for (let i = 0; i < 5; i++) fxTick(projectileArtDef('__v215fx')!, 'trail', pool, st, 0.05, 12, 1.8, 0.1)
  const pa215 = pool.parts
  PROJECTILE_ARTS.splice(PROJECTILE_ARTS.findIndex(a => a.id === '__v215fx'), 1)
  check('v2.15：fxTick 散射 90° 锥角（全部 vx<0 朝源）且粒子带 streak 拖尾标记',
    pa215.length > 0 && pa215.every(p2 => p2.streak === true && p2.vx < 0),
    `n=${pa215.length} bad=${pa215.filter(p2 => !(p2.streak && p2.vx < 0)).length}`)
}

// --- v2.15 ③ 充能末帧滞留：chargeLeft 到 0 后滞留才起射；帧映射末帧不计入充能时间（v2.16 滞留 0.1→0.05s） ---
{
  Math.random = zeroRandom
  const beam = TURRET_DEFS.find(d => d.id === 'beam')!
  const ch0 = beam.chargeTime
  beam.chargeTime = 0.52 // v2.16：取 0.52 避开 dt 整除的浮点落零歧义（0.5/0.05 逐 tick 累减误差方向不定）
  let s = arena()
  const t = mkTurret(s, 'beam', 5, 20)
  const e = mkEnemy(s, 'walker', 6.0, 16)
  const hp0 = byId(s.enemies, e.id)!.hp
  s = run(s, 0.6, 0.05) // 11 次递减后 0.52-0.55=-0.03 → 滞留段：不起射、不结算
  const tt1 = byId(s.turrets, t.id)!
  const holding = !tt1.firing && tt1.chargeLeft < 0 && tt1.chargeLeft > -0.05 && byId(s.enemies, e.id)!.hp === hp0
  s = run(s, 0.2, 0.05) // -0.03-0.05=-0.08 ≤ -0.05 → 滞留 0.05 结束起射
  // 起射后光束按 BEAM_ON_SPEED 伸展，首次 DoT 顺延到伸展到位帧，
  // 故伤害断言窗口由 0.1s 放宽到 0.2s（滞留/起射时序断言不变）
  const tt2 = byId(s.turrets, t.id)!
  const fired = tt2.firing && byId(s.enemies, e.id)!.hp < hp0
  // 帧映射：progress<1 → 前 N-1 帧；progress=1（滞留/攻击期）→ 末帧
  const r1 = chargeFrameRect(50, 10, 5, 0.99 * 4 / 5) // floor(0.792×5)=3 → 第 4 帧（非末帧）
  const r2 = chargeFrameRect(50, 10, 5, 1 * 4 / 5) // → 末帧
  check('v2.16：充能末帧滞留 0.05s 后起射（滞留段不 firing 不结算）+ 帧映射末帧不计入充能时间',
    holding && fired && r1.sx === 30 && r2.sx === 40,
    `hold=${tt1.chargeLeft.toFixed(2)}/${tt1.firing} fired=${tt2.firing} frames=${r1.sx}/${r2.sx}`)
  beam.chargeTime = ch0
}

// --- v2.7 ④ 光束命中事件：持续光束 DoT 端点（配置弹丸条目时）---
{
  Math.random = zeroRandom
  // 持续光束：注入 art.projectile → DoT tick 在端点产生 impact 事件（ttl 0.15s，回调内观察避免过期被清）
  let s = arena()
  const beamDef = TURRET_DEFS.find(d => d.id === 'beam')!
  const savedBeamArt = beamDef.art
  beamDef.art = { ...(savedBeamArt ?? {}), projectile: 'ray_std' }
  mkTurret(s, 'beam', 5, 20) // 中心 6,20.5 朝 0°（上）
  mkEnemy(s, 'walker', 6.0, 16) // 波束内
  let beamSeen = 0
  s = run(s, 1.6, 0.05, g => { beamSeen += g.impacts.filter(im => im.ammoId === 'ray_std').length })
  beamDef.art = savedBeamArt // 恢复
  check('v2.7：持续光束 DoT 在端点产生 impact 事件（ammoId=art.projectile）', beamSeen > 0, `seen=${beamSeen}`)
}

// --- 弹丸库命中表现：直射弹实际碰撞后必须生成 impact 事件 ---
{
  Math.random = zeroRandom
  let s = arena()
  s.objects = []
  const cannon = TURRET_DEFS.find(d => d.id === 'custom-1787149972481-1')!
  const savedProjectile = cannon.art?.projectile
  cannon.art = { ...(cannon.art ?? {}), projectile: 'custom_ammo_2' }
  const target = mkEnemy(s, 'walker', 6, 5, 100)
  s.projectiles.push({
    id: s.nextId++, kind: 'bullet', defId: cannon.id, level: 1,
    x: 6, y: 4.5, px: 6, py: 4.5, heading: Math.PI,
    damage: 10, traveled: 0, maxTravel: 1000, shooter: 0, hitIds: [],
    t: 0, flightTime: 0, sx: 0, sy: 0, tx: 0, ty: 0,
    speed: 0, turnRate: 0, guided: false, targetId: null,
    lockX: 0, lockY: 0, lostLock: false, prevDist: -1, weavePhase: 0,
  })
  s = tick(s, 0.05)
  const impacts = s.impacts.filter(im => im.ammoId === 'custom_ammo_2')
  check('弹丸库命中表现：穿甲直射弹命中单位后生成一次对应 impact 事件',
    byId(s.enemies, target.id)!.hp < 100 && impacts.length === 1,
    `hp=${byId(s.enemies, target.id)!.hp} impacts=${JSON.stringify(impacts)}`)
  cannon.art = { ...(cannon.art ?? {}), projectile: savedProjectile }
}

// --- v2.5 ① resCompatUrl：旧 /sprites/ 路径重写为 /res/，其余不动 ---
{
  const a = resCompatUrl('/sprites/fortresses/fort_1_01.png')
  const b = resCompatUrl('/res/fortresses/fort_1_01.png')
  const c = resCompatUrl('data:image/png;base64,AAAA')
  const d = resCompatUrl('builtin:library/missile_s_t')
  check('v2.5：resCompatUrl 旧 /sprites/ 前缀重写为 /res/，其余原样',
    a === '/res/fortresses/fort_1_01.png' && b === '/res/fortresses/fort_1_01.png'
    && c === 'data:image/png;base64,AAAA' && d === 'builtin:library/missile_s_t',
    `a=${a} b=${b} c=${c.slice(0, 12)} d=${d}`)
}

// --- v2.5 ② 充能末帧定格：攻击期（firing）chargeLeft=0 → 进度钳 1（末帧常显）---
{
  // 与 render.ts / ArtPreview 同一段逻辑：chargeLeft>0 走正常进度，否则攻击期定格末帧
  const chargeTime = 0.8
  const calc = (chargeLeft: number, firing: boolean, firingLeft: number) => {
    const hold = firing && firingLeft > 0
    if (!hold && chargeLeft <= 0) return null // 不充能也不攻击：不绘制
    return chargeLeft > 0 ? Math.min(1, (chargeTime - chargeLeft) / chargeTime) : 1
  }
  const p1 = calc(0.4, false, 0)   // 充能中：50%
  const p2 = calc(0, true, 0.5)    // 攻击期：定格末帧
  const p3 = calc(0, false, 0)     // 既不充能也不攻击：不绘制
  const r = chargeFrameRect(400, 100, 4, p2!)
  check('v2.5：充能末帧在攻击持续时间内常显（进度钳 1）',
    Math.abs(p1! - 0.5) < 1e-9 && p2 === 1 && p3 === null && r.sx === 300,
    `p1=${p1} p2=${p2} p3=${p3} sx=${r.sx}`)
}

console.log('== 波次收尾投射物/自然散热验收 ==')

// --- ① 整备阶段：上一波已发射投射物继续飞行直至消失，不冻结 ---
{
  let s = arena()
  s.phase = 'prep'; s.prepLeft = 999
  s.objects = []; s.walls = []; s.buildings = []; s.core = null; s.enemies = []; s.allies = []
  s.projectiles.push({ id: s.nextId++, kind: 'bullet', defId: 'mg', x: 20, y: 10, px: 20, py: 10,
    heading: Math.PI / 2, speed: 10, damage: 1, t: 0, traveled: 0, maxTravel: 500, hitIds: [] })
  const x0 = s.projectiles[0].x
  const y0 = s.projectiles[0].y
  s = tick(s, 0.05)
  const firstProjectile = s.projectiles[0]
  const movedDuringPrep = !!firstProjectile && Math.hypot(firstProjectile.x - x0, firstProjectile.y - y0) > 0
  s = run(s, 10, 0.05)
  check('波次结束后已发射投射物继续执行直至消失（不冻结）',
    movedDuringPrep && s.projectiles.length === 0,
    `moved=${movedDuringPrep} first=${firstProjectile ? `${firstProjectile.x},${firstProjectile.y}` : 'removed'} left=${s.projectiles.length} phase=${s.phase}`)
}

// --- ② 堡垒汇聚散热：射击产热进堡垒池，停止射击后按散热速率下降至 0 ---
{
  Math.random = zeroRandom
  const diss0 = gameParameters().naturalHeatDissipation
  setNaturalHeatDissipation(10) // 10 点/s = 0.5 点/0.05s tick
  const mgH = TURRET_DEFS.find(d => d.id === 'mg')!
  const heatPS0 = mgH.heatPerShot
  mgH.heatPerShot = 7 // v1.72：口令出厂不产热；本用例显式给产热测汇聚散热
  let s = arena()
  mkTurret(s, 'mg', 6, 20)
  const e = mkEnemy(s, 'walker', 6.5, 15)
  s = run(s, 2, 0.05) // 射击积累堡垒热量（产热净增 > 散热）
  const hot = s.fortress.heat
  byId(s.enemies, e.id)!.y = -50 // 移出射程 => 待机不射击
  s = run(s, 1, 0.05)
  const cool1 = s.fortress.heat
  s = run(s, 30, 0.05)
  const cool2 = s.fortress.heat
  check('堡垒汇聚散热：停止射击后按散热速率(点/s)下降至 0',
    hot > 0 && Math.abs(hot - cool1 - 10) < 0.5 && cool2 === 0, // 10 点/s × 1s = 10 点
    `hot=${hot.toFixed(1)} after1s=${cool1.toFixed(1)} end=${cool2}`)
  mgH.heatPerShot = heatPS0
  setNaturalHeatDissipation(diss0)
}

// --- ③ 持续射击中（光束）堡垒散热持续生效（汇聚后散热不中断） ---
{
  Math.random = zeroRandom
  const diss0 = gameParameters().naturalHeatDissipation
  setNaturalHeatDissipation(10)
  let s = arena()
  const t = mkTurret(s, 'beam', 6, 20)
  mkEnemy(s, 'walker', 6.5, 16)
  s = run(s, 1.5, 0.05) // 进入持续发射（attackDuration 3s；beam heatPerShot=0 不产热）
  const wasFiring = byId(s.turrets, t.id)!.firing
  s.fortress.heat = 50
  s = run(s, 0.5, 0.05)
  const during = s.fortress.heat
  check('持续射击中（光束）堡垒散热持续生效',
    wasFiring && byId(s.turrets, t.id)!.firing && Math.abs(50 - during - 5) < 0.5, // 10 点/s × 0.5s = 5 点
    `firing=${wasFiring} heat=${during.toFixed(1)}`)
  setNaturalHeatDissipation(diss0)
}

// --- ④ 散热器直连堡垒：功率全额叠加到堡垒散热速率（不按炮塔数摊薄、可叠加） ---
{
  Math.random = zeroRandom
  let s = fresh()
  s.gold = 100000
  const base = fortressCooling(s)
  s = buildModule(s, 'radiator', 0, 0, 0)
  const one = fortressCooling(s)
  s = buildModule(s, 'radiator', 2, 0, 0)
  const two = fortressCooling(s)
  check('散热器全额直连堡垒散热（不摊薄、可叠加）',
    Math.abs(one - base - 8) < 1e-9 && Math.abs(two - base - 16) < 1e-9,
    `base=${base} one=${one} two=${two}`)
  restoreLevel()
}

// --- ⑤ 备战阶段（波次结束后）堡垒散热继续生效 ---
{
  Math.random = zeroRandom
  const diss0 = gameParameters().naturalHeatDissipation
  setNaturalHeatDissipation(10) // 点/s
  let s = arena()
  s.fortress.heat = 40
  s.phase = 'prep'
  s.prepLeft = 999 // 阻止自动开波
  s = run(s, 1, 0.05)
  const heat1 = s.fortress.heat
  s = run(s, 5, 0.05)
  const heat2 = s.fortress.heat
  check('备战阶段堡垒散热继续生效（点/s）',
    Math.abs(heat1 - 30) < 0.5 && heat2 === 0,
    `after1s=${heat1.toFixed(1)} end=${heat2}`)
  setNaturalHeatDissipation(diss0)
}

// --- ⑥ 堡垒过热：全炮塔停火；降至上限 50% 迟滞恢复 ---
{
  Math.random = zeroRandom
  const cap0 = DEFAULT_FORTRESS.heatCap
  const diss0 = gameParameters().naturalHeatDissipation
  DEFAULT_FORTRESS.heatCap = 100
  setNaturalHeatDissipation(20)
  let s = arena()
  mkTurret(s, 'mg', 6, 20)
  const e = mkEnemy(s, 'walker', 6.5, 16, 1e9) // 打不死，持续供靶
  s.fortress.heat = 100
  s.fortress.overheated = true
  const hp0 = byId(s.enemies, e.id)!.hp
  s = run(s, 1, 0.05) // 100 → 80：仍过热（>50），炮塔停火无伤害
  const stillHot = s.fortress.overheated && byId(s.enemies, e.id)!.hp === hp0
  s = run(s, 2, 0.05) // 80 → 40：穿越 50 阈值解除过热，恢复射击
  const resumed = !s.fortress.overheated && byId(s.enemies, e.id)!.hp < hp0
  check('堡垒过热全炮塔停火、降至 50% 迟滞恢复',
    stillHot && resumed,
    `stillHot=${stillHot} heat=${s.fortress.heat.toFixed(1)} oh=${s.fortress.overheated} hp=${byId(s.enemies, e.id)!.hp}`)
  DEFAULT_FORTRESS.heatCap = cap0
  setNaturalHeatDissipation(diss0)
}

console.log('== 导弹飞行曲线（weave）验收 ==')

/** 有符号横向偏移（格）：弹体相对 发射点→锁定点 理想直线的偏离 */
const crossOf = (lx: number, ly: number, tx: number, ty: number, px: number, py: number) => {
  const dx = tx - lx
  const dy = ty - ly
  const len = Math.hypot(dx, dy)
  return (dx * (py - ly) - dy * (px - lx)) / len
}

/** 跑一发 cruise（非制导，固定锁定落点），逐 tick 记录横向偏移 */
function weaveRun(curve: number | undefined): number[] {
  Math.random = zeroRandom
  const cruise = TURRET_DEFS.find(d => d.id === 'cruise')!
  const accuracy0 = cruise.accuracy
  cruise.accuracy = 0 // 隔离曲线机制，不依赖全局随机数关闭散布
  if (curve === undefined) delete cruise.missileCurve
  else cruise.missileCurve = curve
  let s = arena()
  mkTurret(s, 'cruise', 6, 20) // 中心 (7,21)
  mkEnemy(s, 'walker', 6.5, 12) // 锁定落点（显式 accuracy=0，无散布）
  const crosses: number[] = []
  s = run(s, 3, 0.05, g => {
    const p = g.projectiles.find(pj => pj.defId === 'cruise')
    if (p) crosses.push(crossOf(7, 21, 6.5, 12, p.x, p.y))
  })
  delete cruise.missileCurve
  cruise.accuracy = accuracy0
  return crosses
}

// --- ① missileCurve=0/未配置：直线飞行（回归，现状不变） ---
{
  const crosses = weaveRun(undefined)
  const maxAbs = Math.max(...crosses.map(Math.abs), 0)
  check('missileCurve=0 轨迹直线（现状不变）', crosses.length > 5 && maxAbs < 0.05,
    `ticks=${crosses.length} maxCross=${maxAbs.toFixed(4)}`)
}

// --- ② missileCurve=50：横向偏移 > 0.3 格且至少变号一次（往复非单边） ---
{
  const crosses = weaveRun(50)
  const maxAbs = Math.max(...crosses.map(Math.abs), 0)
  const hasPos = crosses.some(c => c > 0.05)
  const hasNeg = crosses.some(c => c < -0.05)
  check('missileCurve=50 蛇形轨迹：摆幅>0.3 格且横偏变号（往复）',
    crosses.length > 5 && maxAbs > 0.3 && hasPos && hasNeg,
    `maxCross=${maxAbs.toFixed(2)} pos=${hasPos} neg=${hasNeg}`)
}

// --- ③ 摆幅随系数增大：curve=100 最大横偏 > curve=10 ---
{
  const c100 = Math.max(...weaveRun(100).map(Math.abs), 0)
  const c10 = Math.max(...weaveRun(10).map(Math.abs), 0)
  check('曲线摆幅随系数增大（curve100 > curve10）', c100 > c10 && c10 > 0.01,
    `c100=${c100.toFixed(2)} c10=${c10.toFixed(2)}`)
}

// --- ④ 曲线制导导弹仍能命中目标并结算伤害 ---
{
  Math.random = zeroRandom
  const hunter = TURRET_DEFS.find(d => d.id === 'hunter')!
  hunter.missileCurve = 80
  let s = arena()
  mkTurret(s, 'hunter', 6, 20)
  const e = mkEnemy(s, 'walker', 6.5, 15)
  s = run(s, 10, 0.05)
  const ee = byId(s.enemies, e.id)!
  check('曲线制导导弹仍能命中目标并结算伤害', ee.hp < ee.maxHp, `hp=${ee.hp}/${ee.maxHp}`)
  delete hunter.missileCurve
}

console.log('== 多联炮管（barrels/barrelMode）验收 ==')

// --- ① 齐射：barrels=3 + salvo + 连发=1，单次击发 3 枚，弹药/热量按 3 枚结算 ---
{
  Math.random = zeroRandom
  const mg = TURRET_DEFS.find(d => d.id === 'mg')!
  const burst0 = mg.burst
  const regen0 = AMMO.regen
  AMMO.regen = 0 // 关闭回复，隔离计量
  const diss0 = gameParameters().naturalHeatDissipation
  setNaturalHeatDissipation(0) // 关闭散热，精确计量产热
  mg.barrels = 3; mg.barrelMode = 'salvo'; mg.burst = 1
  let s = arena()
  const t = mkTurret(s, 'mg', 6, 20)
  mkEnemy(s, 'walker', 6.5, 16)
  t.ammo = 100
  const ammo0 = t.ammo
  let volley = 0
  for (let i = 0; i < 30 && volley === 0; i++) {
    s = tick(s, 0.05)
    volley = s.projectiles.filter(p => p.shooter === t.id).length
  }
  const ammoLeft = byId(s.turrets, t.id)!.ammo ?? 0
  check('齐射 barrels=3：单次击发 3 枚弹丸，弹药/热量按 3 枚结算',
    volley === 3 && Math.abs(ammo0 - ammoLeft - 3) < 1e-6 && s.fortress.heat === (mg.heatPerShot ?? 0) * 3,
    `volley=${volley} ammoΔ=${ammo0 - ammoLeft} heat=${s.fortress.heat}`)
  delete mg.barrels; delete mg.barrelMode; mg.burst = burst0
  AMMO.regen = regen0
  setNaturalHeatDissipation(diss0)
}

// --- ② 轮流：barrels=3 + sequential（连发=3），逐枚射出、间隔≈连发间隔、barrelIdx 轮转 ---
{
  Math.random = zeroRandom
  const mg = TURRET_DEFS.find(d => d.id === 'mg')! // v1.72：出厂 burst 6；本用例显式 3 连发
  const spd0 = mg.projectileSpeed
  mg.barrels = 3; mg.barrelMode = 'sequential'; mg.burst = 3
  mg.projectileSpeed = 100 // v1.72：口令弹速 400 会命中消亡导致逐发计数漏检，减速保证 3 发同在飞行
  let s = arena()
  const t = mkTurret(s, 'mg', 6, 20)
  mkEnemy(s, 'walker', 6.5, 16)
  const seen: { time: number; idx: number }[] = []
  let lastCount = 0
  s = run(s, 0.6, 0.05, g => {
    const tt = byId(g.turrets, t.id)!
    const n = g.projectiles.filter(p => p.shooter === t.id).length
    if (n > lastCount) { seen.push({ time: g.time, idx: tt.barrelIdx }); lastCount = n }
  })
  const gaps = seen.slice(1).map((v, i) => v.time - seen[i].time)
  check('轮流 barrels=3：逐枚射出、间隔≈连发间隔、barrelIdx 轮转',
    seen.length === 3 && seen.map(v => v.idx).join(',') === '1,2,0'
    && gaps.every(g => Math.abs(g - 0.1) < 0.06),
    `seen=${JSON.stringify(seen)} gaps=${gaps.map(g => g.toFixed(2))}`)
  delete mg.barrels; delete mg.barrelMode
  mg.projectileSpeed = spd0
}

// --- ③ barrels 未配置：行为不变（单管，弹丸/弹药/热量与现状一致） ---
{
  Math.random = zeroRandom
  const mg = TURRET_DEFS.find(d => d.id === 'mg')! // 注：上方②结束已 delete barrels/barrelMode = 未配置态
  const regen0 = AMMO.regen
  AMMO.regen = 0
  const diss0 = gameParameters().naturalHeatDissipation
  setNaturalHeatDissipation(0) // 关闭散热，精确计量产热
  let s = arena()
  const t = mkTurret(s, 'mg', 6, 20)
  mkEnemy(s, 'walker', 6.5, 16)
  t.ammo = 100
  const ammo0 = t.ammo
  let volley = 0
  for (let i = 0; i < 30 && volley === 0; i++) {
    s = tick(s, 0.05)
    volley = s.projectiles.filter(p => p.shooter === t.id).length
  }
  const ammoLeft = byId(s.turrets, t.id)!.ammo ?? 0
  check('barrels 未配置：行为不变（单管单发结算）',
    mg.barrels === undefined && volley === 1
    && Math.abs(ammo0 - ammoLeft - 1) < 1e-6 && s.fortress.heat === (mg.heatPerShot ?? 0),
    `volley=${volley} ammoΔ=${ammo0 - ammoLeft} heat=${s.fortress.heat}`)
  AMMO.regen = regen0
  setNaturalHeatDissipation(diss0)
}

// --- ④ 轮流跨轮 barrelIdx 不重置：第二轮第一枚从前一轮的下一管射出 ---
{
  Math.random = zeroRandom
  const mg = TURRET_DEFS.find(d => d.id === 'mg')!
  const burst0 = mg.burst
  mg.barrels = 3; mg.barrelMode = 'sequential'; mg.burst = 1 // 每轮 1 枚
  let s = arena()
  const t = mkTurret(s, 'mg', 6, 20)
  mkEnemy(s, 'walker', 6.5, 16)
  const seen: number[] = []
  let lastCount = 0
  s = run(s, 5, 0.05, g => { // v2.45 口令(5)：fireRate 1→2s/轮，三轮采样窗口 2.2→5s
    const tt = byId(g.turrets, t.id)!
    const n = g.projectiles.filter(p => p.shooter === t.id).length
    if (n > lastCount) seen.push(tt.barrelIdx) // 弹丸命中消亡后计数回落，逐 tick 对比捕新弹
    lastCount = n
  })
  check('轮流跨轮 barrelIdx 不重置（1→2→0 连续轮转）',
    seen.length >= 3 && seen[0] === 1 && seen[1] === 2 && seen[2] === 0,
    `seen=${seen.slice(0, 4)}`)
  delete mg.barrels; delete mg.barrelMode; mg.burst = burst0
}

console.log('== 炮塔美术渲染管线（art 挂点/炮口事件）验收 ==')

// 场景：mg(6,20) 中心 (6.5,20.5)，敌人正上方 => angle=0；dir=(0,-1) perp=(1,0)
// --- ① art.barrels 非对称挂点：弹丸出生点 = 配置 muzzle 旋转后世界坐标 ---
{
  Math.random = zeroRandom
  const mg = TURRET_DEFS.find(d => d.id === 'mg')!
  const burst0 = mg.burst
  const art0 = mg.art // mg 默认带范例 art，用完恢复
  mg.barrels = 2; mg.barrelMode = 'salvo'; mg.burst = 1
  mg.art = { barrels: [{ mount: [-0.2, 0], muzzle: [-0.2, 0.5] }, { mount: [0.3, 0], muzzle: [0.3, 0.5] }] } // 新坐标系（x右/y上），世界坐标不变
  let s = arena()
  const t = mkTurret(s, 'mg', 6, 20)
  mkEnemy(s, 'walker', 6.5, 16)
  let spawns: { x: number; y: number }[] = []
  for (let i = 0; i < 30 && spawns.length === 0; i++) {
    s = tick(s, 0.05)
    spawns = s.projectiles.filter(p => p.shooter === t.id).map(p => ({ x: p.x, y: p.y })) // v1.79：出生点预偏 -v·dt，首 tick 推进后 x/y 恰 = 炮口
  }
  // muzzle[0.5,-0.2] → (6.5-0.2, 20.5-0.5)=(6.3,20.0)；muzzle[0.5,0.3] → (6.8,20.0)
  check('art 挂点表：弹丸出生点 = 配置 muzzle 旋转后世界坐标',
    spawns.length === 2
    && Math.abs(spawns[0].x - 6.3) < 0.01 && Math.abs(spawns[0].y - 20.0) < 0.01
    && Math.abs(spawns[1].x - 6.8) < 0.01 && Math.abs(spawns[1].y - 20.0) < 0.01,
    JSON.stringify(spawns))
  mg.art = art0; delete mg.barrels; delete mg.barrelMode; mg.burst = burst0
}

// --- ② 未配置 art：出生点维持均布公式（回归） ---
{
  Math.random = zeroRandom
  const mg = TURRET_DEFS.find(d => d.id === 'mg')!
  const burst0 = mg.burst
  const art0 = mg.art
  delete mg.art // 显式删除默认范例 art，测未配置回退
  mg.barrels = 2; mg.barrelMode = 'salvo'; mg.burst = 1 // 无 art
  let s = arena()
  const t = mkTurret(s, 'mg', 6, 20)
  mkEnemy(s, 'walker', 6.5, 16)
  let spawns: { x: number; y: number }[] = []
  for (let i = 0; i < 30 && spawns.length === 0; i++) {
    s = tick(s, 0.05)
    spawns = s.projectiles.filter(p => p.shooter === t.id).map(p => ({ x: p.x, y: p.y })) // v1.79：同上
  }
  // 均布：lat=±0.3，前伸 0.35 → (6.2,20.15) / (6.8,20.15)
  check('未配置 art：出生点维持均布公式（回归）',
    mg.art === undefined && spawns.length === 2
    && Math.abs(spawns[0].x - 6.2) < 0.01 && Math.abs(spawns[0].y - 20.15) < 0.01
    && Math.abs(spawns[1].x - 6.8) < 0.01 && Math.abs(spawns[1].y - 20.15) < 0.01,
    JSON.stringify(spawns))
  delete mg.barrels; delete mg.barrelMode; mg.burst = burst0
  mg.art = art0
}

// --- ②b 未配置 art 的单管：预览挂点、弹丸出生点与火光事件共用前伸 0.35 格炮口 ---
{
  Math.random = zeroRandom
  const mg = TURRET_DEFS.find(d => d.id === 'mg')!
  const burst0 = mg.burst
  const art0 = mg.art
  const barrels0 = mg.barrels
  const barrelMode0 = mg.barrelMode
  delete mg.art
  mg.barrels = 1; mg.barrelMode = 'salvo'; mg.burst = 1
  let s = arena()
  const t = mkTurret(s, 'mg', 6, 20)
  const expected = muzzlePos(t, mg, 0)
  const generated = artMounts(t, mg)[0].muzzle
  mkEnemy(s, 'walker', 6.5, 16)
  let spawn: { x: number; y: number } | undefined
  let flash: typeof s.muzzles[number] | undefined
  for (let i = 0; i < 30 && (!spawn || !flash); i++) {
    s = tick(s, 0.05)
    spawn ??= s.projectiles.find(p => p.shooter === t.id)
    flash ??= s.muzzles.find(m => m.turretId === t.id)
  }
  check('未配置 art 的单管：预览挂点、弹丸出生点与火光共用 +0.35 格炮口',
    generated[0] === 0 && generated[1] === 0.35
    && Math.abs(expected.x - 6.5) < 0.01 && Math.abs(expected.y - 20.15) < 0.01
    && !!spawn && Math.abs(spawn.x - expected.x) < 0.01 && Math.abs(spawn.y - expected.y) < 0.01
    && !!flash && Math.abs(flash.x - expected.x) < 0.01 && Math.abs(flash.y - expected.y) < 0.01,
    `expected=${JSON.stringify(expected)} spawn=${JSON.stringify(spawn)} flash=${JSON.stringify(flash)}`)
  mg.art = art0
  if (barrels0 === undefined) delete mg.barrels; else mg.barrels = barrels0
  if (barrelMode0 === undefined) delete mg.barrelMode; else mg.barrelMode = barrelMode0
  mg.burst = burst0
}

// --- ③ sequential + art：barrelIdx 轮转对应不同 muzzle ---
{
  Math.random = zeroRandom
  const mg = TURRET_DEFS.find(d => d.id === 'mg')!
  const burst0 = mg.burst
  const art0 = mg.art
  mg.barrels = 2; mg.barrelMode = 'sequential'; mg.burst = 1
  mg.art = { barrels: [{ mount: [-0.2, 0], muzzle: [-0.2, 0.5] }, { mount: [0.3, 0], muzzle: [0.3, 0.5] }] } // 新坐标系（x右/y上），世界坐标不变
  let s = arena()
  const t = mkTurret(s, 'mg', 6, 20)
  mkEnemy(s, 'walker', 6.5, 16)
  const seen: { x: number; y: number }[] = []
  let last = 0
  s = run(s, 2.2, 0.05, g => {
    const ps = g.projectiles.filter(p => p.shooter === t.id)
    if (ps.length > last) {
      const np = ps[ps.length - 1]
      seen.push({ x: np.x, y: np.y }) // v1.79：新弹出现 tick 的 x/y = 炮口
    }
    last = ps.length
  })
  check('sequential + art：barrelIdx 轮转对应不同 muzzle',
    seen.length >= 2
    && Math.abs(seen[0].x - 6.3) < 0.01 && Math.abs(seen[0].y - 20.0) < 0.01
    && Math.abs(seen[1].x - 6.8) < 0.01 && Math.abs(seen[1].y - 20.0) < 0.01,
    JSON.stringify(seen.slice(0, 2)))
  mg.art = art0; delete mg.barrels; delete mg.barrelMode; mg.burst = burst0
}

// --- ④ 炮口事件：发射后 s.muzzles 出现含 barrelIdx/炮口坐标的事件 ---
{
  Math.random = zeroRandom
  const mg = TURRET_DEFS.find(d => d.id === 'mg')!
  const burst0 = mg.burst
  const art0 = mg.art // mg 默认带范例 art，用完恢复
  mg.barrels = 2; mg.barrelMode = 'salvo'; mg.burst = 1
  mg.art = { barrels: [{ mount: [-0.2, 0], muzzle: [-0.2, 0.5] }, { mount: [0.3, 0], muzzle: [0.3, 0.5] }] } // 新坐标系（x右/y上），世界坐标不变
  let s = arena()
  const t = mkTurret(s, 'mg', 6, 20)
  mkEnemy(s, 'walker', 6.5, 16)
  let evs: typeof s.muzzles = []
  for (let i = 0; i < 30 && evs.length === 0; i++) {
    s = tick(s, 0.05)
    evs = s.muzzles.filter(m => m.turretId === t.id)
  }
  check('炮口事件：发射后视觉数组出现含 barrelIdx/炮口坐标的事件',
    evs.length === 2 && evs[0].barrelIdx === 0 && evs[1].barrelIdx === 1
    && Math.abs(evs[0].x - 6.3) < 0.01 && Math.abs(evs[0].y - 20.0) < 0.01
    && Math.abs(evs[1].x - 6.8) < 0.01 && evs.every(m => m.ttl > 0),
    JSON.stringify(evs))
  check('火光事件时长硬编码 0.2s（v1.45：2 帧 × 0.1s，不再可配）',
    evs.every(m => Math.abs(m.max - FLASH_DURATION) < 1e-9),
    `max=${evs.map(m => m.max).join(',')}`)
  mg.art = art0; delete mg.barrels; delete mg.barrelMode; mg.burst = burst0
}

// v1.72：口令覆盖后 mg 出厂 = barrels 2 + sequential + burst 6；上方多管/art 用例结束均 delete，这里统一恢复出厂
{
  const mgF = TURRET_DEFS.find(d => d.id === 'mg')!
  mgF.barrels = 2; mgF.barrelMode = 'sequential'; mgF.burst = 6
}

console.log('== validateArt 校验验收 ==')

// --- ① 正常配置：ok 无警告 ---
{
  const mg = TURRET_DEFS.find(d => d.id === 'mg')! // mg 自带范例 art（单管挂点，barrels 未配置=1）
  const v = validateArt(mg)
  check('validateArt：正常配置 ok 无警告',
    v.ok && v.errors.length === 0 && v.warnings.length === 0,
    JSON.stringify(v))
}

// --- ①b 偶数炮管贴图翻转：索引、默认值与持久化 ---
{
  const mg = TURRET_DEFS.find(d => d.id === 'mg')!
  const art0 = mg.art
  mg.art = { ...art0, flipEvenBarrels: true }
  check('偶数炮管翻转：仅第2/4/6…根炮管贴图翻转',
    !shouldFlipEvenBarrel(mg, 0)
    && shouldFlipEvenBarrel(mg, 1)
    && !shouldFlipEvenBarrel(mg, 2)
    && shouldFlipEvenBarrel(mg, 3))
  const roundTrip = parseTurretDefs(serializeTurretDefs([mg]))?.[0]
  check('偶数炮管翻转：炮塔配置序列化往返保留开关', roundTrip?.art?.flipEvenBarrels === true)
  mg.art = { ...art0 }
  delete mg.art.flipEvenBarrels
  check('偶数炮管翻转：默认关闭时所有炮管均不翻转',
    !shouldFlipEvenBarrel(mg, 0) && !shouldFlipEvenBarrel(mg, 1))
  mg.art = art0
}

// --- ② 炮管数是唯一数量来源；旧挂点表不再额外绘制/发射 ---
{
  const mg = TURRET_DEFS.find(d => d.id === 'mg')!
  const art0 = mg.art
  const fakeT = { x: 0, y: 0, w: mg.w, h: mg.h } as never
  mg.barrels = 3 // 逻辑 3 管 vs 挂点表 2 项（v1.72 口令出厂挂点表为双管）
  const v = validateArt(mg)
  check('validateArt：旧挂点数≠炮管数 → 自动兼容 warning',
    v.ok && v.warnings.some(w => w.includes('≠')),
    JSON.stringify(v))
  check('炮管数增加：缺少的美术挂点自动生成且有效挂点数=3', artMounts(fakeT, mg).length === 3)
  mg.barrels = 1
  check('炮管数减少：多余旧挂点不再进入预览、实战渲染或出生点', artMounts(fakeT, mg).length === 1)
  mg.barrels = 2 // 恢复 v1.72 出厂
  mg.art = art0
}

// --- ②b v1.58 统一后坐：art.recoil 全管共用、优先于遗留逐管 recoil；validateArt 校验 ---
{
  const mg = TURRET_DEFS.find(d => d.id === 'mg')!
  const art0 = mg.art
  // v1.72：口令出厂挂点表第 2 管带遗留逐管 recoil=0.1（被统一值 0.08 覆盖）；统一后坐仍为 art 级
  check('v1.58 出厂 mg：统一后坐 art.recoil=0.08（art 级统一值）',
    mg.art?.recoil === 0.08,
    JSON.stringify(mg.art))
  const fakeT = { x: 0, y: 0, w: mg.w, h: mg.h } as never
  const m0 = artMounts(fakeT, mg)
  check('v1.58 统一后坐生效（artMounts 全管 0.08）', m0.every(b => b.recoil === 0.08), JSON.stringify(m0))
  // 统一值优先于遗留逐管值
  mg.art = { recoil: 0.2, barrels: [{ mount: [0, 0], muzzle: [0, 0.5], recoil: 0.05 }] }
  const m1 = artMounts(fakeT, mg)
  check('v1.58 统一后坐优先于遗留逐管值（0.2 覆盖 0.05）', m1.every(b => b.recoil === 0.2), JSON.stringify(m1))
  // 回退链：无 art.recoil 时读遗留逐管值
  mg.art = { barrels: [{ mount: [0, 0], muzzle: [0, 0.5], recoil: 0.05 }] }
  check('v1.58 回退：无统一值时读逐管遗留 0.05', artMounts(fakeT, mg)[0].recoil === 0.05)
  // validateArt：负数统一后坐 → error
  mg.art = { recoil: -1 }
  const v = validateArt(mg)
  check('v1.58 validateArt：负统一后坐 → error', !v.ok && v.errors.some(e => e.includes('统一后坐')), JSON.stringify(v))
  mg.art = art0
}

// --- ③ 缺 muzzle 字段 → error ---
{
  const mg = TURRET_DEFS.find(d => d.id === 'mg')!
  const art0 = mg.art
  mg.art = { barrels: [{ mount: [0, 0] } as never] }
  const v = validateArt(mg)
  check('validateArt：缺 muzzle 字段 → error',
    !v.ok && v.errors.some(e => e.includes('muzzle')),
    JSON.stringify(v))
  mg.art = art0
}

console.log('== 光束停火消退验收 ==')

{
  const shrink = beamFadeSpan(10, 0.5, 'shrink')
  const transferFull = beamFadeSpan(10, 1, 'transfer')
  const transferHalf = beamFadeSpan(10, 0.5, 'transfer')
  const transferGone = beamFadeSpan(10, 0, 'transfer')
  check('光束消散模式：收缩保持原长度；传递从源头向目标收束且命中端点保持原位',
    shrink.start === 0 && shrink.length === 10
    && transferFull.start === 0 && transferFull.length === 10
    && transferHalf.start === 5 && transferHalf.length === 5 && transferHalf.start + transferHalf.length === 10
    && transferGone.start === 10 && transferGone.length === 0 && transferGone.start + transferGone.length === 10,
    `shrink=${JSON.stringify(shrink)} transfer=${JSON.stringify(transferHalf)}`)
}

// --- ① 停火转换沿推 1 条消退记录（角度=停火时刻、宽幅=配置、ttl≈BEAM_FADE） ---
{
  Math.random = zeroRandom
  let s = arena()
  const t = mkTurret(s, 'beam', 5, 20)
  mkEnemy(s, 'walker', 6.0, 16)
  let sawFiring = false
  let stopAngle = 0
  let snap: typeof s.beamFades[0] | null = null
  let maxN = 0
  s = run(s, 5, 0.05, g => { // 持续 3s 自然停火（转换沿出现在 run 内；记录 0.25s 后移除，perTick 抓取）
    const tt = byId(g.turrets, t.id)!
    if (tt.firing) { sawFiring = true; stopAngle = tt.angle } // 静态目标下角度恒定
    maxN = Math.max(maxN, g.beamFades.length)
    if (!snap && g.beamFades.length > 0) snap = { ...g.beamFades[0] }
  })
  const tt = byId(s.turrets, t.id)!
  check('光束停火：转换沿推 1 条消退记录（角度/宽幅/ttl 正确）',
    sawFiring && !tt.firing && maxN === 1 && snap !== null
    && Math.abs(snap.angle - stopAngle) < 1e-9 && snap.width === legacyMeters(10) && snap.mode === 'shrink' && snap.len > 0
    && snap.ttl > 0 && snap.ttl <= 0.25 && snap.max === 0.25,
    `firing=${sawFiring}→${tt.firing} maxN=${maxN} angle=${snap?.angle.toFixed(3)}/${stopAngle.toFixed(3)} w=${snap?.width} ttl=${snap?.ttl}`)
}

// --- ② 从未起射/持续停火不产生新记录（无重复推） ---
{
  Math.random = zeroRandom
  let s = arena()
  mkTurret(s, 'beam', 5, 20) // 无敌人，从未起射
  s = run(s, 2, 0.05)
  check('光束未起射：不产生消退记录', s.beamFades.length === 0, `n=${s.beamFades.length}`)
  // 已停火（攻击持续跑完自然停火）后不再重复推
  Math.random = zeroRandom
  s = arena()
  mkTurret(s, 'beam', 5, 20)
  mkEnemy(s, 'walker', 6.0, 16)
  let maxN = 0
  s = run(s, 6, 0.05, g => { maxN = Math.max(maxN, g.beamFades.length) }) // 3s 持续 + 装填停火 + 再起射循环
  check('光束停火/起射循环：每次停火沿仅 1 条，无堆积', maxN <= 1 && s.beamFades.length === 0,
    `maxN=${maxN} end=${s.beamFades.length}`)
}

// --- v2.50 宽幅驱动贴图宽度：BeamFade.width 可选语义（未配置宽幅 → undefined，消退段贴图保持原生高度） ---
{
  Math.random = zeroRandom
  const beam0 = TURRET_DEFS.find(d => d.id === 'beam')!
  TURRET_DEFS.push({ ...beam0, id: 'test-beam-nw', beamWidth: undefined }) // 未配置宽幅
  let s = arena()
  mkTurret(s, 'test-beam-nw', 5, 20)
  mkEnemy(s, 'walker', 6.0, 16)
  let snap: typeof s.beamFades[0] | null = null
  s = run(s, 5, 0.05, g => { if (!snap && g.beamFades.length > 0) snap = { ...g.beamFades[0] } })
  check('v2.50：未配置宽幅的光束停火消退 width=undefined（贴图原生高度）；已配置=实数（上方用例 w=10 保持）',
    snap !== null && snap.width === undefined, `w=${snap?.width}`)
  TURRET_DEFS.splice(TURRET_DEFS.findIndex(d => d.id === 'test-beam-nw'), 1)
}

// --- ③ ttl 衰减至 0 后记录移除 ---
{
  Math.random = zeroRandom
  let s = arena()
  mkTurret(s, 'beam', 5, 20)
  mkEnemy(s, 'walker', 6.0, 16)
  let firstTtl = -1
  let midTtl = -1
  s = run(s, 5, 0.05, g => { // perTick 追踪：出现 → 衰减 → 消失
    if (g.beamFades.length > 0) {
      if (firstTtl < 0) firstTtl = g.beamFades[0].ttl
      else midTtl = g.beamFades[0].ttl
    }
  })
  check('消退记录 ttl 衰减至 0 后移除',
    firstTtl > 0 && firstTtl <= 0.25 && midTtl >= 0 && midTtl < firstTtl && s.beamFades.length === 0,
    `first=${firstTtl.toFixed(2)} later=${midTtl.toFixed(2)} end=${s.beamFades.length}`)
}

console.log('== 弹丸美术库（§3A）验收 ==')

// --- ① 引用解析：有效 id 返回条目，不存在/未传 → undefined（回退） ---
{
  const ok = projectileArtDef('bullet_std')
  check('弹丸库引用解析：有效 id 返回条目，不存在 id → fallback',
    ok?.kind === 'bullet' && projectileArtDef('rocket_std')?.kind === 'missile'
    && projectileArtDef('nope') === undefined && projectileArtDef(undefined) === undefined,
    JSON.stringify(ok))
}

// --- ② 类别匹配：bullet 配直射塔无警告；配抛射塔/光束塔有警告 ---
{
  const mg = TURRET_DEFS.find(d => d.id === 'mg')!
  const lob = TURRET_DEFS.find(d => d.id === 'lob')!
  const beam = TURRET_DEFS.find(d => d.id === 'beam')!
  const mgArt0 = mg.art
  mg.art = { ...mgArt0, projectile: 'bullet_std' }
  const vMatch = validateArt(mg)
  const lobArt0 = lob.art
  lob.art = { ...lobArt0, projectile: 'bullet_std' } // bullet 条目配抛射塔
  const vMismatch = validateArt(lob)
  const beamArt0 = beam.art
  beam.art = { ...beamArt0, projectile: 'bullet_std' } // v2.8：光束引用已生效（ray 条目），bullet 条目 → 类别不匹配
  const vBeam = validateArt(beam)
  const spray = TURRET_DEFS.find(d => d.id === 'spray')!
  const sprayArt0 = spray.art
  spray.art = { ...sprayArt0, projectile: 'bullet_std' } // 喷射无弹丸不生效
  const vSpray = validateArt(spray)
  check('弹丸类别校验：匹配无警告、跨类/光束类别不匹配/喷射引用黄色警告',
    vMatch.ok && vMatch.warnings.length === 0
    && vMismatch.warnings.some(w => w.includes('类别不匹配'))
    && vBeam.warnings.some(w => w.includes('类别不匹配')) && !vBeam.warnings.some(w => w.includes('无弹丸'))
    && vSpray.warnings.some(w => w.includes('无弹丸')),
    `mg=${vMatch.warnings.length} lob=${JSON.stringify(vMismatch.warnings)} beam=${JSON.stringify(vBeam.warnings)} spray=${JSON.stringify(vSpray.warnings)}`)
  mg.art = mgArt0
  lob.art = lobArt0
  spray.art = sprayArt0
  beam.art = beamArt0
}

// --- ③ 无 DOM 环境：条目加载状态静默 fallback（渲染回退几何弹丸） ---
{
  const st = projectileArtState(projectileArtDef('bullet_std')!)
  check('弹丸贴图无 DOM 静默回退（sim 环境）', st.status === 'fallback' && st.assets === undefined,
    st.status)
}

console.log('== 弹丸库四类别/爆炸门控/注册表增删验收 ==')

// --- ① ray 类别映射：ray_std 配光束无警告、配直射有警告 ---
{
  const beam = TURRET_DEFS.find(d => d.id === 'beam')!
  const mg = TURRET_DEFS.find(d => d.id === 'mg')!
  const beamArt0 = beam.art
  const mArt0 = mg.art
  beam.art = { ...beamArt0, projectile: 'ray_std' }
  mg.art = { ...mArt0, projectile: 'ray_std' }
  const vBeam = validateArt(beam)
  const vMg = validateArt(mg)
  check('ray 类别映射：配光束无警告、配直射有警告',
    vBeam.ok && !vBeam.warnings.some(w => w.includes('类别不匹配')) && vMg.warnings.some(w => w.includes('类别不匹配')),
    `beam=${vBeam.warnings.length} mg=${JSON.stringify(vMg.warnings)}`)
  beam.art = beamArt0
  mg.art = mArt0
}

// --- ② 爆炸门控：未配置 blastRadius 的 def 爆炸事件不带库引用（不走库帧图） ---
{
  Math.random = zeroRandom
  const lob = TURRET_DEFS.find(d => d.id === 'lob')!
  const art0 = lob.art
  const shellAmmo = PROJECTILE_ARTS.find(a => a.id === 'shell_std')!
  const blast0 = shellAmmo.blastRadius
  const turretBlast0 = lob.blastRadius
  lob.art = { ...art0, projectile: 'shell_std' }
  delete shellAmmo.blastRadius // 模拟弹丸库未配置爆炸
  delete lob.blastRadius // 旧炮塔字段也清空，模拟真正未配置
  let s = arena()
  mkTurret(s, 'lob', 6, 20)
  mkEnemy(s, 'walker', 6.5, 12)
  let sawExplosion = false
  let gated = true
  s = run(s, 8, 0.05, g => { // 爆炸事件 0.35s 即衰减，perTick 观测
    for (const ex of g.explosions) {
      sawExplosion = true
      if (ex.kind !== 'groundImpact' && ex.ammoId !== undefined) gated = false
    }
  })
  shellAmmo.blastRadius = blast0 // 恢复：配置爆炸 → 带库引用
  s = arena()
  mkTurret(s, 'lob', 6, 20)
  mkEnemy(s, 'walker', 6.5, 12)
  let withRef = false
  s = run(s, 8, 0.05, g => {
    if (g.explosions.some(ex => ex.ammoId === 'shell_std')) withRef = true
  })
  gated = gated && sawExplosion // 确实发生过爆炸（门控断言有效）
  check('爆炸门控：未配置 blastRadius 不带库引用，配置后带引用',
    gated && withRef,
    `gated=${gated} withRef=${withRef} saw=${sawExplosion}`)
  lob.art = art0
  lob.blastRadius = turretBlast0
}

// --- ③ 注册表增删：新条目可解析、删除后回退 ---
{
  PROJECTILE_ARTS.push({ id: 'custom_ammo_9', name: '测试弹', kind: 'ray' })
  const added = projectileArtDef('custom_ammo_9')?.kind === 'ray'
  const i = PROJECTILE_ARTS.findIndex(a => a.id === 'custom_ammo_9')
  PROJECTILE_ARTS.splice(i, 1)
  const removed = projectileArtDef('custom_ammo_9') === undefined
  check('注册表增删：新条目可解析、删除后引用回退',
    added && removed && PROJECTILE_ARTS.length === 8,
    `added=${added} removed=${removed} n=${PROJECTILE_ARTS.length}`)
}

console.log('== 充能时间验收 ==')

// --- ① chargeTime=0.5：首次开火 ≥0.5s；轮内连发不重复充能 ---
{
  Math.random = zeroRandom
  const mg = TURRET_DEFS.find(d => d.id === 'mg')!
  const ch0 = mg.chargeTime
  mg.chargeTime = 0.5
  let s = arena()
  const t = mkTurret(s, 'mg', 5, 20)
  mkEnemy(s, 'walker', 6.0, 16)
  let tm = 0
  let firstShot = -1
  let chargeStarts = 0
  let prevCharge = 0
  s = run(s, 1.5, 0.05, g => {
    tm += 0.05
    const tt = byId(g.turrets, t.id)!
    if (firstShot < 0 && tt.chargeLeft > 0 && prevCharge <= 0) chargeStarts++
    prevCharge = tt.chargeLeft
    if (firstShot < 0 && g.projectiles.length > 0) firstShot = tm
  })
  check('充能 0.5s：首次开火 ≥0.5s 且起射前仅充能 1 次',
    firstShot >= 0.5 && chargeStarts === 1,
    `firstShot=${firstShot.toFixed(2)} chargeStarts=${chargeStarts}`)
  mg.chargeTime = ch0
}

// --- ② 充能中目标移出 → 取消；回来重新完整充能 ---
{
  Math.random = zeroRandom
  const mg = TURRET_DEFS.find(d => d.id === 'mg')!
  const ch0 = mg.chargeTime
  mg.chargeTime = 0.5
  let s = arena()
  const t = mkTurret(s, 'mg', 5, 20)
  const e = mkEnemy(s, 'walker', 6.0, 16)
  s = run(s, 0.3, 0.05) // 充能进行中（未完成）
  const charging = byId(s.turrets, t.id)!.chargeLeft > 0 && s.projectiles.length === 0
  byId(s.enemies, e.id)!.y = -50 // 移出射程
  s = run(s, 0.2, 0.05)
  const cancelled = byId(s.turrets, t.id)!.chargeLeft <= 0 && s.projectiles.length === 0
  byId(s.enemies, e.id)!.y = 16 // 回到射程内
  let tm = 0
  let firstShot = -1
  s = run(s, 1.2, 0.05, g => {
    tm += 0.05
    if (firstShot < 0 && g.projectiles.length > 0) firstShot = tm
  })
  check('充能取消：目标移出清零，回来后重新完整充能 0.5s',
    charging && cancelled && firstShot >= 0.5,
    `charging=${charging} cancelled=${cancelled} refire=${firstShot.toFixed(2)}`)
  mg.chargeTime = ch0
}

// --- ③ 持续型光束：充能期无 firing/无持续伤害，完成后进入 attackDuration ---
{
  Math.random = zeroRandom
  const beam = TURRET_DEFS.find(d => d.id === 'beam')!
  const ch0 = beam.chargeTime
  beam.chargeTime = 0.5
  let s = arena()
  const t = mkTurret(s, 'beam', 5, 20)
  const e = mkEnemy(s, 'walker', 6.0, 16)
  const hp0 = byId(s.enemies, e.id)!.hp
  s = run(s, 0.4, 0.05) // 索敌(~0.1s)+充能中
  const tt1 = byId(s.turrets, t.id)!
  const noFireDuringCharge = !tt1.firing && tt1.chargeLeft > 0 && byId(s.enemies, e.id)!.hp === hp0
  let beamFireSignalOwned = false
  s = run(s, 0.6, 0.05, current => {
    beamFireSignalOwned ||= !!current.audioSignals?.some(signal => signal.kind === 'turretFire' && signal.defId === 'beam' && signal.sourceId === t.id)
  }) // 充能完成 → 起射
  const tt2 = byId(s.turrets, t.id)!
  const firingAfter = tt2.firing && byId(s.enemies, e.id)!.hp < hp0
  check('光束充能：充能期不 firing 不结算伤害，完成后起射且开火声携带炮塔来源',
    noFireDuringCharge && firingAfter && beamFireSignalOwned,
    `charge=${tt1.chargeLeft.toFixed(2)} firing=${tt1.firing}→${tt2.firing} signal=${beamFireSignalOwned}`)
  beam.chargeTime = ch0
}

// --- ④ 未配置 chargeTime：行为与现状一致（立即开火，chargeLeft 恒 0） ---
{
  Math.random = zeroRandom
  let s = arena()
  const t = mkTurret(s, 'mg', 5, 20)
  mkEnemy(s, 'walker', 6.0, 16)
  let tm = 0
  let firstShot = -1
  let everCharged = false
  s = run(s, 1.0, 0.05, g => {
    tm += 0.05
    if (byId(g.turrets, t.id)!.chargeLeft > 0) everCharged = true
    if (firstShot < 0 && g.projectiles.length > 0) firstShot = tm
  })
  check('未配置充能：立即开火（回归）', firstShot > 0 && firstShot < 0.3 && !everCharged,
    `firstShot=${firstShot.toFixed(2)} everCharged=${everCharged}`)
}

// --- ⑤ validateArt：charge.frames 越界 error；有 charge 无 chargeTime → warning ---
{
  const mg = TURRET_DEFS.find(d => d.id === 'mg')!
  const art0 = mg.art
  mg.art = { ...art0, charge: { offset: [0, 0.3], frames: 20 } }
  const vBad = validateArt(mg)
  mg.art = { ...art0, charge: { offset: [0, 0.3], frames: 4 } } // mg 未配置 chargeTime
  const vWarn = validateArt(mg)
  check('charge 校验：frames 越界 error、无 chargeTime 黄警',
    vBad.errors.some(e => e.includes('charge.frames'))
    && vWarn.ok && vWarn.warnings.some(w => w.includes('充能动画不生效')),
    `bad=${JSON.stringify(vBad.errors)} warn=${JSON.stringify(vWarn.warnings)}`)
  mg.art = art0
}

console.log('== debug 持久化验收 ==')

// --- 序列化/解析往返一致 + 版本不符丢弃 + 无存储环境静默 ---
{
  const tj = serializeTurretDefs(TURRET_DEFS)
  const rt = parseTurretDefs(tj)
  const aj = serializeProjectileArts(PROJECTILE_ARTS)
  const ra = parseProjectileArts(aj)
  check('持久化序列化往返一致',
    rt !== null && JSON.stringify(rt) === JSON.stringify(TURRET_DEFS)
    && ra !== null && JSON.stringify(ra) === JSON.stringify(PROJECTILE_ARTS),
    `turrets=${rt?.length} ammo=${ra?.length}`)
  const raySoundRoundTrip = parseProjectileArts(serializeProjectileArts([{ id: 'sound-ray', name: '声音射线', kind: 'ray', sounds: { flight: 'none', impact: 'none', ricochet: 'bounce-preset', explosion: 'none', continuous: 'loop-preset' } }]))
  check('弹丸音效：跳弹与射线持续播放预设可随弹丸库往返保存', raySoundRoundTrip?.[0]?.sounds?.ricochet === 'bounce-preset' && raySoundRoundTrip?.[0]?.sounds?.continuous === 'loop-preset')
  const migratedBeamSounds = migrateBeamTurretSounds({ ...TURRET_DEFS.find(def => def.id === 'beam')!, sounds: { reload: 'old-reload', continuous: 'beam-loop' } } as TurretDef & { sounds: { reload?: string; continuous?: string } })
  check('射线炮塔音效迁移：删除旧装填音效并保留持续循环音效',
    !(migratedBeamSounds.sounds as { reload?: string } | undefined)?.reload && migratedBeamSounds.sounds?.continuous === 'beam-loop')
  check('射线炮塔音效衔接：开火音效启动后固定 0.1s 接入持续循环音效', BEAM_CONTINUOUS_AUDIO_DELAY === 0.1)
  const retiredClusterLaser = { ...TURRET_DEFS.find(def => def.id === 'beam')!, id: 'custom-1787847910626-3', name: '集束激光炮' }
  check('炮塔退役迁移：集束激光炮不会从旧存档或导入配置恢复', migrateRetiredRayTurret(retiredClusterLaser) === null)
  const retiredFields = migrateRetiredTurretFields({ ...TURRET_DEFS.find(def => def.id === 'beam')!, fireRate: 2, reload: 5, gpu: 6 } as TurretDef & { reload: number; gpu: number })
  check('炮塔字段迁移：旧持续武器取双冷却较大值并删除 reload/GPU',
    retiredFields.fireRate === 5 && !('reload' in retiredFields) && !('gpu' in retiredFields))
  const migratedAmmoPool = migrateTurretResourceCapacity({ ...TURRET_DEFS.find(def => def.id === 'mg')!, ammoCapacity: undefined, ammoPerShot: 4 } as TurretDef & { ammoPerShot: number })
  const migratedEnergyPool = migrateTurretResourceCapacity({ ...TURRET_DEFS.find(def => def.id === 'beam')!, energyCapacity: undefined })
  check('炮塔资源迁移：旧消耗型炮塔补齐100容量并删除旧弹药/发字段',
    migratedAmmoPool.ammoCapacity === 100 && migratedAmmoPool.energyCapacity === 0
    && !('ammoPerShot' in migratedAmmoPool)
    && migratedEnergyPool.ammoCapacity === 0 && migratedEnergyPool.energyCapacity === 100
    && migratedAmmoPool.ammoExchangeRate === 1 && turretAmmoExchangeRate({}) === 1)
  check('持久化版本/坏数据丢弃为 null',
    parseTurretDefs(JSON.stringify({ version: 99, data: [] })) === null
    && parseTurretDefs('not-json') === null
    && parseProjectileArts(JSON.stringify({ version: 1, data: {} })) === null,
    'version/badjson/badshape')
  // 无 DOM 环境：import persist 已静默跳过 load（注册表未被改动——由往返断言间接覆盖）

  const oldTurret = { ...TURRET_DEFS[0], rangeMin: 25, rangeMax: 150, projectileSpeed: 400, accuracy: 12, blastRadius: 20, beamWidth: 10,
    split: { count: 4, spread: 40, at: 'proximity' as const, range: 25 }, onDestroyBlast: { radius: 25, damage: 10 } }
  const migratedTurret = migrateLegacyTurretMetrics(oldTurret)
  check('3.2m空间迁移：旧炮塔米制参数按格距等比转换且不修改原对象',
    migratedTurret.rangeMin === 3.2 && migratedTurret.rangeMax === 19.2 && migratedTurret.projectileSpeed === 51.2
    && Math.abs((migratedTurret.accuracy ?? 0) - 1.536) < 1e-9 && migratedTurret.blastRadius === 2.56
    && migratedTurret.beamWidth === 1.28 && migratedTurret.split?.range === 3.2 && migratedTurret.onDestroyBlast?.radius === 3.2
    && oldTurret.rangeMax === 150)
  const oldProjectile = { id: 'legacy-metric', name: '旧米制弹丸', kind: 'missile' as const, speed: 400, blastRadius: 25,
    guideDecel: 15, missileInitSpeed: 20, missileAccel: 80, missileMaxSpeed: 320, split: { count: 4, spread: 40, at: 'proximity' as const, range: 25 } }
  const migratedProjectile = migrateLegacyProjectileMetrics(oldProjectile)
  check('3.2m空间迁移：旧弹丸速度、加速度、半径与分裂距离保持原格数',
    migratedProjectile.speed === 51.2 && migratedProjectile.blastRadius === 3.2 && migratedProjectile.guideDecel === 1.92
    && migratedProjectile.missileInitSpeed === 2.56 && migratedProjectile.missileAccel === 10.24
    && migratedProjectile.missileMaxSpeed === 40.96 && migratedProjectile.split?.range === 3.2)
  const migratedFactoryRocket = migrateProjectileInterception(
    { id: 'rocket_std', name: '旧标准火箭', kind: 'missile' },
    PROJECTILE_ARTS.find(item => item.id === 'rocket_std'),
  )
  const repairedFactoryRocket = migrateProjectileInterception(
    { id: 'rocket_std', name: '旧标准火箭', kind: 'missile', interceptable: true, interceptHp: 1 },
    PROJECTILE_ARTS.find(item => item.id === 'rocket_std'),
    true,
  )
  const migratedCustomRocket = migrateProjectileInterception({ id: 'legacy-custom-rocket', name: '旧自定义导弹', kind: 'missile' })
  check('导弹拦截迁移：出厂导弹继承新版耐久，自定义导弹采用安全回退',
    migratedFactoryRocket.interceptable === true && migratedFactoryRocket.interceptHp === 20
    && repairedFactoryRocket.interceptHp === 20
    && migratedCustomRocket.interceptable === true && migratedCustomRocket.interceptHp === 1)
  const migratedMissileAsset = migrateRetiredStandardMissileAsset({ id: 'old-missile', name: '旧导弹', kind: 'missile', projectileAsset: 'upload-1' })
  check('旧标准导弹固定尾焰贴图引用迁移为现行无固定尾焰弹体',
    migratedMissileAsset.projectileAsset === 'builtin:library/missile2_s')
  const oldMgArt = structuredClone(TURRET_DEFS.find(item => item.id === 'mg')!)
  oldMgArt.art!.barrels![0].muzzle[1] = 0.65
  oldMgArt.art!.barrels![1].muzzle[1] = 0.65
  const migratedMgArt = migrateLegacyTurretArt(oldMgArt)
  const customMgArt = structuredClone(oldMgArt)
  customMgArt.art!.barrels![0].muzzle[0] = -0.2
  check('32px美术迁移：只把可识别的旧出厂机枪炮口从12/30格改为12/32格',
    migratedMgArt.art?.barrels?.every(barrel => barrel.muzzle[1] === 0.625) === true
    && migrateLegacyTurretArt(customMgArt).art?.barrels?.[0].muzzle[1] === 0.65)
}

console.log('== 素材集映射验收 ==')

// --- spriteSet 覆盖解析 + 缺省回归 id + 通用集共享缓存条目 ---
{
  const mg = TURRET_DEFS.find(d => d.id === 'mg')!
  const art0 = mg.art
  const byId0 = resolveSpriteFolder(mg) // 缺省 → id
  mg.art = { ...art0, spriteSet: 'generic_direct' }
  const overridden = resolveSpriteFolder(mg)
  check('spriteSet 解析：覆盖 → 通用集，缺省 → 炮塔 id',
    byId0 === 'mg' && overridden === 'generic_direct',
    `default=${byId0} override=${overridden}`)
  const gd = { ...mg, art: { ...mg.art, spriteSet: 'generic_direct' } }
  const e1 = turretArtState(gd)
  const e2 = turretArtState(gd)
  const noVisibleLayers = (entry: ReturnType<typeof turretArtState>) => !entry.assets?.base && !entry.assets?.turret && !entry.assets?.barrel && !entry.assets?.flash
  check('遗留 spriteSet 不再生成四个可见层的默认贴图',
    e1.status === 'ready' && e2.status === 'ready'
    && noVisibleLayers(e1) && noVisibleLayers(e2),
    `first=${e1.status} second=${e2.status}`)
  mg.art = art0
}

console.log('== 配置导出/导入验收 ==')

// --- ① 往返一致（含中文名/自定义塔/art 配置/level） ---
{
  const mg = TURRET_DEFS.find(d => d.id === 'mg')!
  const dmg0 = mg.damage
  const nT0 = TURRET_DEFS.length
  const nA0 = PROJECTILE_ARTS.length
  const cells0 = LEVEL.buildCells.length
  mg.damage = 99
  TURRET_DEFS.push({ ...structuredClone(mg), id: 'custom-x-1', name: '中文自定义塔', art: { spriteSet: 'generic_direct', anchor: [0.5, 0.5] } })
  PROJECTILE_ARTS.push({ id: 'custom_ammo_8', name: '中文测试弹', kind: 'ray' })
  LEVEL.buildCells.push('99,99')
  const token = exportConfig()
  // 还原到出厂（模拟另一台设备）
  resetPersistedToDefaults()
  const r = applyConfig(token)
  const mg2 = TURRET_DEFS.find(d => d.id === 'mg')!
  const ct = TURRET_DEFS.find(d => d.id === 'custom-x-1')
  check('口令往返一致：炮塔/弹丸库/level 全量恢复（含中文与 art）',
    r.ok && mg2.damage === 99 && ct?.name === '中文自定义塔' && ct.art?.spriteSet === 'generic_direct'
    && PROJECTILE_ARTS.some(a => a.id === 'custom_ammo_8') && LEVEL.buildCells.includes('99,99'),
    `ok=${r.ok} dmg=${mg2.damage} ct=${ct?.name} cells=${LEVEL.buildCells.length}`)
  // 清理现场（还原出厂，避免影响后续用例）
  resetPersistedToDefaults()
  resetLevel() // 关卡另走 level.ts 出厂恢复
  restoreLevel() // 本套件基准为 28 行布局（出厂默认 rows=20 另有专项验收）
  mg.damage = dmg0
  check('口令测试后注册表已还原', TURRET_DEFS.length === nT0 && PROJECTILE_ARTS.length === nA0 && LEVEL.buildCells.length === cells0,
    `t=${TURRET_DEFS.length}/${nT0}`)
}

// --- ② 坏输入：ok:false 且不污染注册表 ---
{
  const snapshot = JSON.stringify({ t: TURRET_DEFS, a: PROJECTILE_ARTS, l: LEVEL })
  const bad1 = applyConfig('垃圾口令！！！')
  const bad2 = applyConfig(encodeBase64(JSON.stringify({ app: 'td-config', version: 99, turretDefs: [], projectileArts: [], level: LEVEL })))
  const bad3 = applyConfig(encodeBase64(JSON.stringify({ app: 'td-config', version: 1, turretDefs: [] })))
  const after = JSON.stringify({ t: TURRET_DEFS, a: PROJECTILE_ARTS, l: LEVEL })
  check('坏口令：base64/版本/缺字段均 ok:false 且注册表零污染',
    !bad1.ok && !bad2.ok && !bad3.ok && snapshot === after,
    `e1=${bad1.ok ? '' : bad1.error} e2=${bad2.ok ? '' : bad2.error} e3=${bad3.ok ? '' : bad3.error}`)
}

// --- ②b v2.18 本地文件夹 JSON：Smart 双格式解析 + JSON 往返一致 ---
{
  const json = exportConfigJson() // 美化 JSON（td-config.json 落盘格式）
  const pj = parseConfigSmart(json) // JSON 路径
  const pb = parseConfigSmart(exportConfig()) // base64 口令路径（向后兼容）
  const badJson = parseConfigSmart('{ 破损 JSON')
  const snapshot = JSON.stringify({ t: TURRET_DEFS.map(migrateTurretResourceCapacity), a: PROJECTILE_ARTS, l: LEVEL })
  const ra = applyConfigSmart(json) // 恒等应用（同一份数据，注册表不应变化）
  const after = JSON.stringify({ t: TURRET_DEFS, a: PROJECTILE_ARTS, l: LEVEL })
  check('v2.18：Smart 解析 JSON/base64 双兼容 + JSON 往返恒等 + 坏 JSON 报错',
    pj.ok && pj.bundle.app === 'td-config' && pj.bundle.version === 7 && Array.isArray(pj.bundle.levelLibrary?.levels) &&
    pb.ok && pb.bundle.turretDefs.length === TURRET_DEFS.length &&
    !badJson.ok && ra.ok && snapshot === after,
    `pj=${pj.ok} pb=${pb.ok} bad=${badJson.ok ? 'unexpected-ok' : badJson.error} ra=${ra.ok} same=${snapshot === after}`)
}

// --- v2.30/v2.62/v2.69：口令 v7 携带模块库版本+关卡库；旧 v3 仍兼容 ---
{
  const json = exportConfigJson()
  const o = JSON.parse(json) as { version: number; moduleDefs?: unknown; audioConfig?: unknown; gameParameters?: unknown; displayConfig?: unknown }
  const mSnap = JSON.stringify(MODULE_DEFS)
  const r7 = applyConfigSmart(json) // v7 恒等往返
  const legacy = JSON.parse(json) as Record<string, unknown>
  legacy.version = 3
  delete legacy.moduleDefs
  delete legacy.levelLibrary
  delete legacy.audioConfig
  delete legacy.gameParameters
  delete legacy.displayConfig
  const r3 = applyConfigSmart(JSON.stringify(legacy)) // v3 导入：moduleDefs undefined → 不动现有模块库
  const bad = parseConfigSmart(JSON.stringify({ ...JSON.parse(json), moduleDefs: 'xxx' }))
  const badVer = parseConfigSmart(JSON.stringify({ ...JSON.parse(json), version: 8 }))
  check('v2.30/v2.62/v2.69：口令 v7 携带模块库版本、关卡库与运行参数（往返恒等）+ v3 兼容 + 非法形状/版本拒收',
    o.version === 7 && Array.isArray(o.moduleDefs) && (o.moduleDefs as unknown[]).length === MODULE_DEFS.length &&
    Array.isArray((o as { levelLibrary?: { levels?: unknown[] } }).levelLibrary?.levels) &&
    !!o.audioConfig && !!o.gameParameters && !!o.displayConfig &&
    r7.ok && JSON.stringify(MODULE_DEFS) === mSnap &&
    r3.ok && JSON.stringify(MODULE_DEFS) === mSnap &&
    !bad.ok && !badVer.ok,
    `v=${o.version} n=${Array.isArray(o.moduleDefs) ? (o.moduleDefs as unknown[]).length : '?'} r7=${r7.ok} r3=${r3.ok} bad=${bad.ok} badVer=${badVer.ok}`)
  check('v2.30：出厂模块均无 asset 字段（贴图为可选增强，色块回退兼容）',
    MODULE_DEFS.every(d => d.asset === undefined),
    `withAsset=${MODULE_DEFS.filter(d => d.asset !== undefined).length}`)
}

console.log('== 弹丸素材集映射验收 ==')

// --- resolveAmmoFolder 覆盖解析（无 spriteSet 回归 id）+ 共享缓存 key ---
{
  const bullet = projectileArtDef('bullet_std')!
  const byId = resolveAmmoFolder(bullet) // 缺省 → 条目 id
  bullet.spriteSet = 'generic_bullet'
  const overridden = resolveAmmoFolder(bullet)
  check('弹丸 spriteSet 解析：覆盖 → 通用集，缺省 → 条目 id',
    byId === 'bullet_std' && overridden === 'generic_bullet',
    `default=${byId} override=${overridden}`)
  const gb = projectileArtDef('bullet_std')!
  const e1 = projectileArtState(gb)
  const e2 = projectileArtState(gb)
  check('弹丸通用集按文件夹名共享缓存条目', e1 === e2, `shared=${e1 === e2}`)
  delete bullet.spriteSet // 还原
}

console.log('== 素材库/分层选配/flash 可选验收 ==')

// --- ① 四个可见层只接受显式素材引用；缺省/none/geo/坏引用都不绘制 ---
{
  const mg = TURRET_DEFS.find(d => d.id === 'mg')!
  const art0 = mg.art
  const upRef = addAsset('解析测试图', 'data:image/png;base64,CCCC', 'turret')
  mg.art = { ...art0, spriteSet: 'legacy_a', baseAsset: upRef.id, flashAsset: 'none', barrelAsset: 'upload-999' }
  delete mg.art.turretAsset
  const srcs = turretLayerSrcs(mg)
  check('炮塔可见层：显式库引用生效；缺省/none/坏引用均为 [null]',
    srcs.base.length === 1 && srcs.base[0] === 'data:image/png;base64,CCCC' // 库引用独占候选
    && srcs.turret.length === 1 && srcs.turret[0] === null
    && srcs.flash.length === 1 && srcs.flash[0] === null && srcs.barrel.length === 1 && srcs.barrel[0] === null,
    JSON.stringify(srcs))
  removeAsset(upRef.id)
  // 无库引用：四层都透明，不再按 id 文件夹或几何图形回退。
  mg.art = { ...art0 }
  delete mg.art.spriteSet
  delete mg.art.baseAsset
  delete mg.art.turretAsset
  delete mg.art.flashAsset
  delete mg.art.barrelAsset
  const dflt = turretLayerSrcs(mg)
  check('炮塔可见层缺省：底座/炮身/炮管/火光全部不绘制',
    Object.values(dflt).every(values => values.length === 1 && values[0] === null),
    JSON.stringify(dflt))
  // 遗留 spriteSet 只保留给未退役的可选扩展层，不再影响四个可见层。
  mg.art = { ...art0, spriteSet: 'legacy_set' }
  delete mg.art.baseAsset; delete mg.art.turretAsset; delete mg.art.barrelAsset; delete mg.art.flashAsset // v1.72：清除口令出厂层引用/none，测纯 spriteSet 遗留
  const legacy = turretLayerSrcs(mg)
  check('遗留 spriteSet 不再为四个可见层提供默认素材',
    Object.values(legacy).every(values => values.length === 1 && values[0] === null),
    JSON.stringify(legacy))
  mg.art = art0
}

// --- ② flash 缺失但整体 ready（新就绪规则：base/turret/barrel 三层齐备即可） ---
{
  const RealImage = (globalThis as { Image?: unknown }).Image
  ;(globalThis as { Image?: unknown }).Image = class { // 同步桩：flash.png 路径一律失败，其余成功
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    width = 32
    height = 32
    set src(v: string) {
      if (v.includes('flash.png')) this.onerror?.()
      else this.onload?.()
    }
  }
  const fake = { ...TURRET_DEFS.find(d => d.id === 'mg')!, id: 'sim_flash_test', art: { spriteSet: 'sim_ft' } } as TurretDef
  const st = turretArtState(fake)
  check('flash 缺失整体仍 ready（新就绪规则）',
    st.status === 'ready' && st.assets !== undefined && st.assets.flash === undefined,
    `status=${st.status} flash=${st.assets?.flash}`)
  ;(globalThis as { Image?: unknown }).Image = RealImage
}

// --- ②B 显式分层：已选素材照常绘制，未选/失效层保持透明，不补几何图形 ---
{
  const mg = TURRET_DEFS.find(d => d.id === 'mg')!
  const RealImage = (globalThis as { Image?: unknown }).Image
  ;(globalThis as { Image?: unknown }).Image = class {
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    width = 32
    height = 32
    set src(v: string) { if (v.includes('BAD')) this.onerror?.(); else this.onload?.() }
  }
  const base = addAsset('炮塔层默认无测试底座', 'data:image/png;base64,BASE', 'base')
  const turret = addAsset('炮塔层默认无测试炮身', 'data:image/png;base64,TURRET', 'turret')
  const noVisibleLayers = (entry: ReturnType<typeof turretArtState>) => !entry.assets?.base && !entry.assets?.turret && !entry.assets?.barrel && !entry.assets?.flash
  const fake = { ...mg, id: 'sim_partial_test', art: { baseAsset: base.id, turretAsset: turret.id, barrelAsset: 'upload-BAD', flashAsset: 'none' } } as TurretDef
  const st = turretArtState(fake)
  check('显式分层：底座/炮身贴图就绪，失效炮管保持透明且不阻止 ready',
    st.status === 'ready' && st.assets?.base !== undefined && st.assets?.turret !== undefined && st.assets?.barrel === undefined,
    `status=${st.status} base=${!!st.assets?.base} turret=${!!st.assets?.turret} barrel=${!!st.assets?.barrel}`)
  const st2 = turretArtState({ ...mg, id: 'sim_none_test', art: { baseAsset: 'none', turretAsset: 'none', barrelAsset: 'none', flashAsset: 'none' } } as TurretDef)
  check('四层选择「无」：ready 且素材集合为空',
    st2.status === 'ready' && noVisibleLayers(st2),
    `status=${st2.status}`)
  const st2b = turretArtState({ ...mg, id: 'sim_default_none_test', art: {} } as TurretDef)
  check('四层字段缺省：与「无」相同，不绘制任何层',
    st2b.status === 'ready' && noVisibleLayers(st2b),
    `status=${st2b.status}`)
  const st2c = turretArtState({ ...mg, id: 'sim_geobase_test', art: { spriteSet: 'sim_gb', baseAsset: 'geo' } } as TurretDef)
  check('遗留 geo：按 none 处理，不再强制几何色块',
    st2c.status === 'ready' && noVisibleLayers(st2c),
    `status=${st2c.status}`)
  const migrated = migrateTurretLayerDefaults({ ...mg, art: { spriteSet: 'legacy', baseAsset: 'geo', turretAsset: turret.id } } as TurretDef)
  check('旧炮塔层迁移：缺省与 geo 统一写为 none，显式设置保持不变',
    migrated.art?.baseAsset === 'none' && migrated.art?.turretAsset === turret.id
    && migrated.art?.barrelAsset === 'none' && migrated.art?.flashAsset === 'none',
    JSON.stringify(migrated.art))
  removeAsset(base.id)
  removeAsset(turret.id)
  ;(globalThis as { Image?: unknown }).Image = RealImage
}

// --- ③ 素材库增删查纯函数（内置不可删） ---
{
  const up = addAsset('测试图', 'data:image/png;base64,AAAA')
  const found = getAsset(up.id)?.src === 'data:image/png;base64,AAAA' && listAssets().some(a => a.id === up.id)
  const removed = removeAsset(up.id) && getAsset(up.id) === undefined
  check('素材库增删查：上传可加可删',
    found && removed,
    `found=${found} removed=${removed}`)
  const original = addAsset('同名替换测试', 'data:image/png;base64,OLD', 'turret')
  const replacement = addAsset('同名替换测试', 'data:image/png;base64,NEW', 'turret')
  const otherCategory = addAsset('同名替换测试', 'data:image/png;base64,OTHER', 'barrel')
  check('素材上传：同类型同名称沿用原 ID 并替换内容，不同类型同名可并存',
    replacement.id === original.id
    && getAsset(original.id)?.src === 'data:image/png;base64,NEW'
    && otherCategory.id !== original.id
    && listAssets().filter(asset => asset.name === '同名替换测试').length === 2,
    `original=${original.id} replacement=${replacement.id} other=${otherCategory.id}`)
  removeAsset(original.id); removeAsset(otherCategory.id)
  // 常用素材内置注册：退役旧载具/炮塔素材后，剩余条目全在、不可删且不随口令导出。
  const libBuiltin = listAssets().filter(a => a.builtin)
  const libNames = ['shell_s', 'shell_m', 'shell_l', 'missile2_s',
    'dualgun_s1', 'midcannon_m1', 'missile_s_t',
    'dualgun_s2', 'midcannon_m2', 'fx_fire_s']
  const libAllPresent = libNames.every(n => libBuiltin.some(a => a.id === `builtin:library/${n}`))
  const libProtected = !removeAsset('builtin:library/shell_s') && getAsset('builtin:library/shell_s') !== undefined
  const libCategorized = getAsset('builtin:library/shell_s')?.category === 'projectile'
    && getAsset('builtin:library/dualgun_s1')?.category === 'turret'
    && getAsset('builtin:library/dualgun_s2')?.category === 'barrel' // v1.70 底座→炮管
    && getAsset('builtin:library/twincannon_l2') === undefined
    && getAsset('builtin:library/charge_laser_m') === undefined
    && getAsset('builtin:library/fixg_s_missile') === undefined // v1.70 已删除
    && getAsset('builtin:library/missile_s') === undefined // v1.71 弹丸 missile_s 已删除
    && getAsset('builtin:library/missile_s_t')?.name === 'MissileLauncher_S' // v1.71 炮身改名
    && getAsset('builtin:library/fx_fire_s')?.category === 'flash' // v1.74 新增开火效果分类内置
    && getAsset('builtin:library/missile2_s')?.category === 'projectile' // v2.17 弹丸内置
    && getAsset('builtin:library/missilelauncher2_s') === undefined // MissileLauncher2_S 炮身已退役
  const notExported = !uploadsForExport().some(u => u.id.startsWith('builtin:'))
  check('常用素材内置注册：38 件全在/不可删/类别正确（含载具、图块、任务贴图、BGM 与内置 SE）/不随口令导出',
    libBuiltin.length === 38 && libAllPresent && libProtected && libCategorized
    && getAsset('builtin:mission/briefing_default')?.category === 'missionImage'
    && getAsset('builtin:bgm/briefing_eve')?.category === 'bgm' && !removeAsset('builtin:bgm/briefing_eve')
    && getAsset('builtin:se/ui_button_click')?.category === 'se' && !removeAsset('builtin:se/ui_button_click')
    && getAsset('builtin:se/mech_footstep_01')?.category === 'se' && !removeAsset('builtin:se/mech_footstep_01')
    && getAsset('builtin:se/tracked_move_loop') === undefined && notExported,
    `count=${libBuiltin.length} present=${libAllPresent} protected=${libProtected} cat=${libCategorized} notExported=${notExported}`)
  check('图块素材：尺寸自动识别独立/静态/动态且内置 RMXP 图块归入图块分类',
    tileSheetForDimensions(160, 160)?.kind === 'independent'
    && tileSheetForDimensions(96, 128)?.kind === 'autotileStatic'
    && tileSheetForDimensions(384, 128)?.kind === 'autotileAnimated'
    && tileSheetForDimensions(100, 100) === undefined
    && getAsset('builtin:ground/mid')?.category === 'tile'
    && getAsset('builtin:ground/mid')?.tileSheet?.kind === 'autotileStatic')
  const tilePixels = new Uint8ClampedArray(160 * 160 * 4)
  tilePixels[(1 * 160 + 1) * 4 + 3] = 255
  tilePixels[(159 * 160 + 159) * 4 + 3] = 1
  check('独立图块：全透明单元格不计入有效索引，原图索引保持不重排',
    JSON.stringify(independentTileIndicesFromPixels(tilePixels, 160, 160)) === JSON.stringify([0, 24])
    && independentTileIndicesFromPixels(new Uint8ClampedArray(160 * 160 * 4), 160, 160).length === 0)
  const weightedTiles = [0, 7, 9, 12]
  const weightedPrimaryCount = Array.from({ length: 1000 }, (_, index) => weightedIndependentTileIndex(weightedTiles, () => (index + 0.5) / 1000))
    .filter(index => index === 0).length
  check('独立图块随机填充：0号有效图块占95%，其余有效图块均分剩余权重',
    weightedPrimaryCount === 950
    && weightedIndependentTileIndex([], () => 0) === undefined
    && weightedIndependentTileIndex([7], () => 0.99) === 7
    && weightedIndependentTileIndex(weightedTiles, () => 0.9499) === 0
    && weightedIndependentTileIndex(weightedTiles, () => 0.95) === 7
    && weightedIndependentTileIndex(weightedTiles, () => 0.97) === 9
    && weightedIndependentTileIndex(weightedTiles, () => 0.9999) === 12)
  check('独立图块随机填充：0号为空图时，其余有效图块均分全部权重',
    weightedIndependentTileIndex([2, 7, 9, 12], () => 0) === 2
    && weightedIndependentTileIndex([2, 7, 9, 12], () => 0.2499) === 2
    && weightedIndependentTileIndex([2, 7, 9, 12], () => 0.25) === 7
    && weightedIndependentTileIndex([2, 7, 9, 12], () => 0.9999) === 12)
  const tileSelection = gridCellSelectionRect(4.8, 3.2, 1.1, 0.2, 10, 8)
  const selectionTiles: LevelTileCell[] = [
    { x: 0, y: 0, source: 'independent', assetId: 'test', tileIndex: 0, flipX: false, rotation: 0 },
    { x: 2, y: 2, source: 'independent', assetId: 'test', tileIndex: 0, flipX: false, rotation: 0 },
    { x: 6, y: 4, source: 'independent', assetId: 'test', tileIndex: 0, flipX: false, rotation: 0 },
  ]
  const selectionErased = eraseTileCellsInRect(selectionTiles, tileSelection)
  const selectionFilled = fillTileCellsInRect(selectionTiles, tileSelection, (x, y) => ({ x, y, source: 'independent', assetId: 'fill', tileIndex: 9, flipX: false, rotation: 0 }))
  check('关卡编辑器中心格：奇偶尺寸均稳定落在单一地格，偶数尺寸取右下侧中心格',
    JSON.stringify(levelCenterCell(9, 7)) === JSON.stringify({ x: 4, y: 3 })
    && JSON.stringify(levelCenterCell(10, 8)) === JSON.stringify({ x: 5, y: 4 }))
  check('底图/装饰层选择：反向拖拽吸附完整地格，批量擦除与填充只作用于选区',
    JSON.stringify(tileSelection) === JSON.stringify({ x: 1, y: 0, w: 4, h: 4 })
    && selectionErased.length === 2
    && selectionErased.some(tile => tile.x === 0 && tile.y === 0)
    && selectionErased.some(tile => tile.x === 6 && tile.y === 4)
    && selectionFilled.length === 18
    && selectionFilled.filter(tile => tile.assetId === 'fill').length === 16)
  check('退役生物素材：Infantry01 不再注册进素材库', getAsset('builtin:unit/infantry01') === undefined)
  check('载具素材统一分类；退役吉普/轻型坦克主体并保留轮胎与履带分类',
    ASSET_CATEGORY_NAME.base === '炮塔底座'
    && ASSET_CATEGORY_NAME.vehicle === '载具'
    && ASSET_CATEGORY_NAME.wheel === '轮胎'
    && !Object.prototype.hasOwnProperty.call(ASSET_CATEGORY_NAME, 'rotor')
    && filterAssets('vehicle').some(a => a.id === 'builtin:fortress/standard/body')
    && getAsset('builtin:vehicle/jeep/main') === undefined
    && getAsset('builtin:vehicle/lighttank01/body') === undefined
    && getAsset('builtin:vehicle/lighttank01/turret') === undefined
    && getAsset('builtin:vehicle/lighttank01/barrel') === undefined
    && getAsset('builtin:fortress/standard/base') === undefined
    && getAsset('builtin:vehicle/jeep/chassis') === undefined
    && filterAssets('wheel').some(a => a.id === 'builtin:library/track01')
    && getAsset('builtin:library/track01')?.category === 'wheel'
    && getAsset('builtin:vehicle/jeep-wheel') === undefined
    && getAsset('builtin:vehicle/jeep-wheel-master') === undefined
    && resolveAssetSrc('builtin:fortress/standard/body') === '/res/fortresses/fort_1_01.png',
    `vehicle=${filterAssets('vehicle').length} wheel=${filterAssets('wheel').length}`)
  importUploads([{ id: 'sim-legacy-rotor-asset', name: '旧旋翼素材', src: 'data:image/png;base64,AAAA', category: 'rotor' as never }])
  check('旋翼素材分类退役：旧 rotor 条目导入时自动迁移到轮胎分类',
    getAsset('sim-legacy-rotor-asset')?.category === 'wheel'
    && filterAssets('wheel').some(asset => asset.id === 'sim-legacy-rotor-asset'))
  removeAsset('sim-legacy-rotor-asset')
}

// --- ④ 口令 v2 含素材库往返 + v1 兼容导入 ---
{
  const up = addAsset('口令图', 'data:image/png;base64,BBBB')
  const token = exportConfig()
  const parsed = parseConfig(token)
  removeAsset(up.id) // 模拟另一台设备（无该上传）
  const r = parsed.ok ? applyConfig(token) : ({ ok: false as const, error: 'parse' })
  const restored = getAsset(up.id)?.src === 'data:image/png;base64,BBBB'
  // v1 口令（无 assets 字段）→ 兼容导入不动素材库
  const v1 = encodeBase64(JSON.stringify({
    app: 'td-config', version: 1, turretDefs: TURRET_DEFS, projectileArts: PROJECTILE_ARTS, level: LEVEL,
  }))
  const r1 = applyConfig(v1)
  const stillThere = getAsset(up.id) !== undefined
  check('口令 v2 素材库往返 + v1 兼容',
    r.ok && restored && r1.ok && stillThere,
    `v2=${r.ok} restored=${restored} v1=${r1.ok}`)
  removeAsset(up.id) // 清理
}

console.log('== 弹丸本体选配/程序化特效验收 ==')

// --- ① ammoProjectileSrc 解析链：库引用 > spriteSet > id；none → null ---
{
  const e = projectileArtDef('bullet_std')!
  const upRef2 = addAsset('弹丸解析图', 'data:image/png;base64,DDDD', 'projectile')
  const paAsset0 = e.projectileAsset
  delete e.projectileAsset // v1.72：口令出厂已带库引用 shell_s，暂删测 id 文件夹缺省链，用完恢复
  const byId = ammoProjectileSrc(e) // 缺省 → id 文件夹
  e.spriteSet = 'legacy_ammo'
  const bySet = ammoProjectileSrc(e) // spriteSet 文件夹
  e.projectileAsset = upRef2.id
  const byLib = ammoProjectileSrc(e) // 库引用优先
  e.projectileAsset = 'none'
  const none = ammoProjectileSrc(e)
  e.projectileAsset = 'upload-999'
  const bad = ammoProjectileSrc(e)
  check('弹丸本体解析链：库引用 > spriteSet(遗留)/id（无通用兜底）；none/坏引用 → [null]',
    byId.length === 1 && byId[0] === '/res/projectiles/bullet_std/projectile.png' // id 文件夹单候选
    && bySet.length === 1 && bySet[0] === '/res/projectiles/legacy_ammo/projectile.png'
    && byLib.length === 1 && byLib[0] === 'data:image/png;base64,DDDD'
    && none.length === 1 && none[0] === null && bad.length === 1 && bad[0] === null,
    `lib=${byLib} none=${none}`)
  delete e.spriteSet
  e.projectileAsset = paAsset0 // 恢复口令出厂库引用
  removeAsset(upRef2.id)
}

// --- ② 程序化参数默认填充：空段 → 类别色+默认值；自定义覆盖生效 ---
{
  const e = projectileArtDef('rocket_std')! // kind=missile
  e.trail = {}
  e.explosion = {}
  e.impact = { spikes: 9, color: '#112233' }
  const tf = resolveTrailFx(e)!
  const ef = resolveExplosionFx(e)!
  const inf = resolveImpactFx(e)!
  check('程序化参数默认填充：类别色 + 默认值，自定义覆盖',
    tf.color === '#D9762E' && tf.rate === 54 && tf.life === 0.32 && tf.size === 0.055
    && ef.duration === 0.4 && ef.sparks === 14 && ef.smoke === 7
    && inf.spikes === 9 && inf.color === '#112233' && inf.duration === 0.12,
    JSON.stringify({ tf, ef, inf }))
  check('未配置段 → null（回退旧帧条/现状）',
    resolveTrailFx(projectileArtDef('shell_std')!) === null, // v1.75：bullet_std 已配尾焰，改用无特效的 shell_std
    'null')
  delete e.trail
  delete e.explosion
  delete e.impact
}

// --- ③ 爆炸门控回归：程序化配置不改变"无 blastRadius 不播爆炸"规则 ---
{
  Math.random = zeroRandom
  const lob = TURRET_DEFS.find(d => d.id === 'lob')!
  const shell = projectileArtDef('shell_std')!
  shell.explosion = { sparks: 12, smoke: 5 } // 粒子段配置
  const art0 = lob.art
  const blast0 = shell.blastRadius
  const turretBlast0 = lob.blastRadius
  lob.art = { ...art0, projectile: 'shell_std' }
  delete shell.blastRadius // 未配置爆炸
  delete lob.blastRadius
  let s = arena()
  mkTurret(s, 'lob', 6, 20)
  mkEnemy(s, 'walker', 6.5, 12)
  let sawExplosion = false
  let gated = true
  s = run(s, 8, 0.05, g => {
    for (const ex of g.explosions) {
      sawExplosion = true
      if (ex.kind !== 'groundImpact' && ex.ammoId !== undefined) gated = false
    }
  })
  check('爆炸门控回归：程序化配置下无 blastRadius 仍不带库引用',
    sawExplosion && gated,
    `saw=${sawExplosion} gated=${gated}`)
  lob.art = art0
  lob.blastRadius = turretBlast0
  shell.blastRadius = blast0
  delete shell.explosion
}

console.log('== 素材库分类验收 ==')

// --- ① 分类迁移：旧数据无 category → 'other' ---
{
  importUploads([{ id: 'upload-77', name: '迁移条目', src: 'data:x' }]) // 无 category（旧 localStorage/旧口令形状）
  const e = getAsset('upload-77')
  check('分类迁移：无 category → other',
    e !== undefined && e.category === 'other',
    `cat=${e?.category}`)
  removeAsset('upload-77')
}

// --- ② filterAssets：对应类 + other，不含其他类 ---
{
  const up = addAsset('未分类图', 'data:y') // 默认 other
  const bases = filterAssets('base')
  const projs = filterAssets('projectile')
  check('filterAssets 严格过滤：只含对应分类（other 不出现）',
    !bases.some(a => a.id === up.id) // other 严格不显示
    && bases.every(a => a.category === 'base')
    && projs.every(a => a.category === 'projectile'),
    `bases=${bases.length} projs=${projs.length}`)
  removeAsset(up.id)
}

// --- ③ 口令 v2 含 category 往返 ---
{
  const up = addAsset('分类图', 'data:z', 'barrel')
  const token = exportConfig()
  removeAsset(up.id) // 模拟另一台设备
  const r = applyConfig(token)
  const restored = getAsset(up.id)
  check('口令含 category 往返一致',
    r.ok && restored?.category === 'barrel',
    `ok=${r.ok} cat=${restored?.category}`)
  removeAsset(up.id)
}

// --- ⑤ 口令 v3 含堡垒类型库往返 + v2 兼容导入（无 fortressLib 不动现有库） + 形状校验 ---
{
  const fx: FortressDef = { ...structuredClone(DEFAULT_FORTRESS), id: 'sim_token_ft', name: '口令堡垒' }
  saveCustomFortress(fx)
  const sel0 = getSelectedFortressId()
  setSelectedFortressId('sim_token_ft')
  const token = exportConfig()
  const parsed = parseConfig(token)
  const inBundle = parsed.ok
    && (parsed.bundle.fortressLib?.customs.some(c => c.id === 'sim_token_ft') ?? false)
    && parsed.bundle.fortressLib?.selectedId === 'sim_token_ft'
  deleteCustomFortress('sim_token_ft') // 模拟另一台设备（无该自定义堡垒）
  const gone = !FORTRESS_DEFS.some(f => f.id === 'sim_token_ft')
  const r = parsed.ok ? applyConfig(token) : ({ ok: false as const, error: 'parse' })
  const back = FORTRESS_DEFS.some(f => f.id === 'sim_token_ft') && getSelectedFortressId() === 'sim_token_ft'
  // v2 口令（无 fortressLib 字段）→ 兼容导入不动堡垒库
  const v2 = encodeBase64(JSON.stringify({
    app: 'td-config', version: 2, turretDefs: TURRET_DEFS, projectileArts: PROJECTILE_ARTS, level: LEVEL,
  }))
  const r2 = applyConfig(v2)
  const untouched = FORTRESS_DEFS.some(f => f.id === 'sim_token_ft') && getSelectedFortressId() === 'sim_token_ft'
  // 同 id 覆盖：本机先改过该堡垒（hp=5555），导入后口令数据（hp=2000 出厂克隆）为准
  const local = FORTRESS_DEFS.find(f => f.id === 'sim_token_ft')!
  local.hp = 5555
  saveCustomFortress(local)
  const r3 = applyConfig(token)
  const overwritten = r3.ok && FORTRESS_DEFS.find(f => f.id === 'sim_token_ft')?.hp === 2000
  // 形状校验：fortressLib.customs 非数组 → 拒绝
  const bad = parseConfig(encodeBase64(JSON.stringify({
    app: 'td-config', version: 3, turretDefs: TURRET_DEFS, projectileArts: PROJECTILE_ARTS, level: LEVEL,
    fortressLib: { version: 1, customs: 42 },
  })))
  check('口令 v3 堡垒库往返 + 同id覆盖 + v2 兼容 + 形状校验',
    inBundle && gone && r.ok && back && r2.ok && untouched && overwritten && !bad.ok,
    `inBundle=${inBundle} gone=${gone} apply=${r.ok} back=${back} v2=${r2.ok} untouched=${untouched} overwritten=${overwritten} badRejected=${!bad.ok}`)
  deleteCustomFortress('sim_token_ft') // 清理
  setSelectedFortressId(sel0)
}

console.log('== 粒子系统验收 ==')

// --- ① stepParticles：积分位置正确 + drag 衰减 + 过期回收 ---
{
  const pool = createPool()
  spawnBurst(pool, { x: 0, y: 0, count: 5, speed: 10, life: 0.2, size: 0.05, color: '#FFF', drag: 2, seed: 1 })
  const before = pool.parts.map(pt => ({ x: pt.x, y: pt.y, vx: pt.vx, vy: pt.vy }))
  stepParticles(pool, 0.1)
  const moved = pool.parts.every((pt, i) => Math.abs(pt.x - (before[i].x + before[i].vx * 0.1)) < 1e-9
    && Math.abs(pt.y - (before[i].y + before[i].vy * 0.1)) < 1e-9)
  const dragged = pool.parts.every((pt, i) => Math.hypot(pt.vx, pt.vy) < Math.hypot(before[i].vx, before[i].vy))
  stepParticles(pool, 0.15) // 累计 0.25s > life 0.2（含 jitter 最长 0.2 → 全过期）
  check('stepParticles：位置积分 + drag 减速 + 过期回收', moved && dragged && pool.parts.length === 0,
    `moved=${moved} dragged=${dragged} left=${pool.parts.length}`)
}

// --- ② pool 上限回收：超 400 最老先出 ---
{
  const pool = createPool()
  spawnBurst(pool, { x: 0, y: 0, count: 500, speed: 1, life: 10, size: 0.05, color: '#FFF', drag: 0, seed: 2 })
  const capped = pool.parts.length === 400
  // 最老 100 粒已回收：剩余速度 seed=2 系列（无法直接区分，验数量与仍可运动即可）
  stepParticles(pool, 0.1)
  check('pool 上限回收：超 400 最老先出', capped && pool.parts.length === 400, `n=${pool.parts.length}`)
}

// --- ③ spawnBurst：数量与参数一致、速度方向向外 ---
{
  const pool = createPool()
  spawnBurst(pool, { x: 5, y: 5, count: 8, speed: 4, life: 1, size: 0.05, color: '#FFF', drag: 1, seed: 3 })
  check('spawnBurst：数量一致、方向向外（vx²+vy²>0）',
    pool.parts.length === 8 && pool.parts.every(pt => pt.x === 5 && pt.y === 5 && pt.vx * pt.vx + pt.vy * pt.vy > 0),
    `n=${pool.parts.length}`)
}

// --- ④ resolveXxxFx 新字段默认填充（粒子参数） ---
{
  const e = projectileArtDef('bullet_std')!
  e.trail = {}
  e.explosion = {}
  const tf = resolveTrailFx(e)!
  const ef = resolveExplosionFx(e)!
  check('粒子参数默认填充：rate/life/size、sparks/smoke',
    tf.rate === 54 && tf.life === 0.32 && tf.size === 0.055
    && ef.sparks === 14 && ef.smoke === 7 && ef.duration === 0.4,
    JSON.stringify({ tf, ef }))
  delete e.trail
  delete e.explosion
}

console.log('== 尾焰行为模板验收 ==')

// --- ① 四模板默认解析 + 用户显式参数覆盖模板默认 ---
{
  const e = projectileArtDef('bullet_std')!
  e.trail = { template: 'inertia' }
  const ti = resolveTrailFx(e)!
  e.trail = { template: 'smoke' }
  const ts = resolveTrailFx(e)!
  e.trail = { template: 'pulse' }
  const tp = resolveTrailFx(e)!
  e.trail = { template: 'smoke', rate: 99, grow: -1 } // 用户覆盖模板默认
  const tc = resolveTrailFx(e)!
  check('模板默认解析：inertia→inherit 0.9/drag 4，smoke→grow 1.8/life 1.35/rate 22/暗灰',
    ti.inherit === 0.9 && ti.drag === 4 && ti.life === 0.55
    && ts.grow === 1.8 && ts.life === 1.35 && ts.rate === 22 && ts.size === 0.15 && ts.color === '#6B6560' && ts.inherit === 0.1
    && tp.template === 'pulse' && tp.rate === 72,
    JSON.stringify({ ti: ti.inherit, ts: ts.grow }))
  check('用户显式参数覆盖模板默认',
    tc.rate === 99 && tc.grow === -1 && tc.life === 1.35 && tc.color === '#6B6560',
    JSON.stringify({ rate: tc.rate, grow: tc.grow, life: tc.life }))
  delete e.trail
}

// --- ② colorEnd 缺省/自定义解析 ---
{
  const e = projectileArtDef('bullet_std')!
  e.trail = {}
  const dflt = resolveTrailFx(e)!
  e.trail = { colorEnd: '#112233' }
  const cust = resolveTrailFx(e)!
  check('colorEnd：缺省 undefined（不变色），自定义生效',
    dflt.colorEnd === undefined && cust.colorEnd === '#112233',
    `dflt=${dflt.colorEnd} cust=${cust.colorEnd}`)
  delete e.trail
}

// --- ③ stepParticles 尺寸 grow 积分 ---
{
  const pool = createPool()
  spawnBurst(pool, { x: 0, y: 0, count: 2, speed: 1, life: 10, size: 0.1, color: '#FFF', drag: 0, seed: 9, grow: 2 })
  const s0 = pool.parts.map(pt => pt.size)
  stepParticles(pool, 0.1) // size *= (1 + 2×0.1) = ×1.2
  check('stepParticles：grow 尺寸积分（膨胀）',
    pool.parts.every((pt, i) => Math.abs(pt.size - s0[i] * 1.2) < 1e-9),
    `s=${pool.parts[0]?.size}`)
}

console.log('== 粒子贴图化验收 ==')

// --- ① gradientColorKey：端点精确 + 8 档量化确定性 ---
{
  const a = gradientColorKey('#000000', '#ffffff', 0)
  const b = gradientColorKey('#000000', '#ffffff', 1)
  const m1 = gradientColorKey('#000000', '#ffffff', 0.5)
  const m2 = gradientColorKey('#000000', '#ffffff', 0.5)
  const near = gradientColorKey('#000000', '#ffffff', 0.51) // 相邻值量化同档
  check('gradientColorKey：端点精确、8 档量化、确定性',
    a === '#000000' && b === '#ffffff' && m1 === m2 && m1 === near && /^#[0-9a-f]{6}$/.test(m1),
    `a=${a} b=${b} m=${m1}`)
}

// --- ② glowFlicker：有界 0.85–1.15 + 确定性 ---
{
  let lo = 99
  let hi = -99
  for (let t = 0; t < 10; t += 0.01) {
    const f = glowFlicker(t, 3.7)
    lo = Math.min(lo, f)
    hi = Math.max(hi, f)
  }
  check('glowFlicker：有界 0.85–1.15、确定性',
    lo >= 0.85 - 1e-9 && hi <= 1.15 + 1e-9 && glowFlicker(1.23, 4.5) === glowFlicker(1.23, 4.5),
    `lo=${lo.toFixed(3)} hi=${hi.toFixed(3)}`)
}

console.log('== 爆炸增强验收 ==')

// --- ① spawnBurst jitter：0 一致 / 0.5 逐粒不同且有界 ---
{
  const p0 = createPool()
  spawnBurst(p0, { x: 0, y: 0, count: 6, speed: 4, life: 1, size: 0.05, color: '#FFF', drag: 0, seed: 5, speedJitter: 0, lifeJitter: 0 })
  const speeds0 = p0.parts.map(pt => Math.hypot(pt.vx, pt.vy))
  const p5 = createPool()
  spawnBurst(p5, { x: 0, y: 0, count: 8, speed: 4, life: 1, size: 0.05, color: '#FFF', drag: 0, seed: 6, speedJitter: 0.5 })
  const speeds5 = p5.parts.map(pt => Math.hypot(pt.vx, pt.vy))
  const distinct = new Set(speeds5.map(v => v.toFixed(6))).size
  check('spawnBurst jitter：jitter=0 速度一致，jitter=0.5 逐粒不同且 ∈ (1±0.5)',
    speeds0.every(v => Math.abs(v - 4) < 1e-9)
    && distinct >= 6
    && speeds5.every(v => v >= 4 * 0.5 - 1e-9 && v <= 4 * 1.5 + 1e-9),
    `distinct=${distinct}`)
}

// --- ② 湍流：偏离直线轨迹但偏移有界 ---
{
  const pa = createPool()
  const pb = createPool()
  spawnBurst(pa, { x: 0, y: 0, count: 4, speed: 2, life: 5, size: 0.1, color: '#FFF', drag: 0, seed: 7, turb: 0 })
  spawnBurst(pb, { x: 0, y: 0, count: 4, speed: 2, life: 5, size: 0.1, color: '#FFF', drag: 0, seed: 7, turb: 1 })
  for (let i = 0; i < 10; i++) { stepParticles(pa, 0.05); stepParticles(pb, 0.05) }
  const dev = pb.parts.map((pt, i) => Math.hypot(pt.x - pa.parts[i].x, pt.y - pa.parts[i].y))
  check('湍流：turb=1 偏离直线轨迹且偏移有界（>0 且 < 0.5 格）',
    dev.every(d => d > 1e-6 && d < 0.5),
    `maxDev=${Math.max(...dev).toFixed(4)}`)
}

// --- ③ resolveExplosionFx 新字段默认填充 + 环数钳制取整 ---
{
  const e = projectileArtDef('shell_std')!
  e.explosion = {}
  const d = resolveExplosionFx(e)!
  e.explosion = { rings: 9, turbulence: 5 }
  const c = resolveExplosionFx(e)!
  check('爆炸新字段默认填充 + 钳制',
    d.speedJitter === 0.45 && d.lifeJitter === 0.32 && d.turbulence === 0.65
    && d.rings === 2 && d.ringSpeed === 1 && d.ringWidth === 2.5
    && c.rings === 4 && c.turbulence === 2,
    JSON.stringify({ rings: c.rings, turb: c.turbulence }))
  delete e.explosion
}

// --- ④ ringProgress 相位纯函数 ---
{
  check('ringProgress：相位错开 i/rings、ringSpeed 倍乘',
    ringProgress(0.5, 1, 0, 3) === 0.5
    && Math.abs(ringProgress(0.5, 1, 1, 3) - (0.5 - 1 / 3)) < 1e-9
    && ringProgress(0.5, 1, 2, 3) < 0
    && ringProgress(0.25, 2, 0, 1) === 0.5,
    'ok')
}

console.log('== 爆炸方向偏置/速度继承验收 ==')

// --- ① bias=1 锥形收束 / bias=0 全周回归 ---
{
  const pa = createPool()
  spawnBurst(pa, { x: 0, y: 0, count: 8, speed: 4, life: 1, size: 0.05, color: '#FFF', drag: 0, seed: 11, speedJitter: 0, dirX: 1, dirY: 0, bias: 1 })
  const angs = pa.parts.map(pt => Math.atan2(pt.vy, pt.vx))
  const cone = angs.every(a => Math.abs(a) <= 0.1) // 全部沿 +x
  const pb = createPool()
  spawnBurst(pb, { x: 0, y: 0, count: 8, speed: 4, life: 1, size: 0.05, color: '#FFF', drag: 0, seed: 11, speedJitter: 0, dirX: 1, dirY: 0, bias: 0 })
  const spread = new Set(pb.parts.map(pt => Math.atan2(pt.vy, pt.vx).toFixed(3))).size
  check('方向偏置：bias=1 锥形收束（±0.1 rad），bias=0 全周均匀回归',
    cone && spread >= 6,
    `cone=${cone} spread=${spread}`)
}

// --- ② 速度继承：粒子速度精确含 inherit 分量 ---
{
  const pool = createPool()
  spawnBurst(pool, { x: 0, y: 0, count: 4, speed: 0, life: 1, size: 0.05, color: '#FFF', drag: 0, seed: 12, inheritVx: 1.5, inheritVy: -0.5 })
  check('速度继承：初速精确叠加 (inheritVx, inheritVy)',
    pool.parts.every(pt => pt.vx === 1.5 && pt.vy === -0.5),
    `vx=${pool.parts[0]?.vx}`)
}

// --- ③ 无方向事件（油桶）配 bias 也不报错且全周均匀 ---
{
  const pool = createPool()
  spawnBurst(pool, { x: 0, y: 0, count: 8, speed: 4, life: 1, size: 0.05, color: '#FFF', drag: 0, seed: 13, speedJitter: 0, bias: 1 }) // 无 dirX/dirY
  const spread = new Set(pool.parts.map(pt => Math.atan2(pt.vy, pt.vx).toFixed(3))).size
  check('无命中方向：bias 配置不生效不报错，全周均匀',
    pool.parts.length === 8 && spread >= 6,
    `spread=${spread}`)
}

// --- ④ resolveExplosionFx bias/inherit 模板默认 + 钳制 ---
{
  const e = projectileArtDef('shell_std')!
  e.explosion = {}
  const d = resolveExplosionFx(e)!
  e.explosion = { bias: 2, inherit: -1 }
  const c = resolveExplosionFx(e)!
  check('bias/inherit 使用中型模板默认值 + 钳制 0–1',
    d.bias === 0.1 && d.inherit === 0.12 && c.bias === 1 && c.inherit === 0,
    JSON.stringify({ b: c.bias, i: c.inherit }))
  delete e.explosion
}

console.log('== 导弹挂载显示验收 ==')

// --- ① 导弹塔放置 rackLeft 满挂 = burst ---
{
  Math.random = zeroRandom
  const mdef = TURRET_DEFS.find(d => d.type === 'missile')!
  const s = arena()
  const t = mkTurret(s, mdef.id, 6, 20)
  check('rackLeft 初始化满挂（= burst）', t.rackLeft === Math.max(1, mdef.burst ?? 1), `rack=${t.rackLeft} burst=${mdef.burst}`)
}

// --- ② 逐发递减 + 齐射一次 -N ---
{
  Math.random = zeroRandom
  const mdef = TURRET_DEFS.find(d => d.type === 'missile')!
  // 轮流单管：发射 1 枚 rackLeft-1
  let s = arena()
  mkTurret(s, mdef.id, 6, 20)
  mkEnemy(s, 'walker', 6.5, 12)
  const full = Math.max(1, mdef.burst ?? 1)
  let minRack = full
  s = run(s, 4, 0.05, g => { minRack = Math.min(minRack, g.turrets[0]?.rackLeft ?? full) })
  // 齐射双管临时定义：一次击发 -2
  const salvoDef = { ...mdef, id: 'sim_rack_salvo', name: '挂载齐射', barrels: 2, barrelMode: 'salvo' as const, burst: 4 }
  TURRET_DEFS.push(salvoDef)
  let s2 = arena()
  mkTurret(s2, 'sim_rack_salvo', 6, 20)
  mkEnemy(s2, 'walker', 6.5, 12)
  let minRack2 = 4
  s2 = run(s2, 2.5, 0.05, g => { minRack2 = Math.min(minRack2, g.turrets[0]?.rackLeft ?? 4) })
  TURRET_DEFS.splice(TURRET_DEFS.indexOf(salvoDef), 1)
  check('rackLeft 逐发递减 / 齐射一次 -N',
    minRack < full && minRack2 <= 2, // 齐射 burst 4 一次 -2 → ≤2
    `min=${minRack}/${full} salvoMin=${minRack2}/4`)
}

// --- ③ burstLeft 重置时复挂满挂 ---
{
  Math.random = zeroRandom
  const mdef = TURRET_DEFS.find(d => d.type === 'missile')!
  let s = arena()
  mkTurret(s, mdef.id, 6, 20)
  mkEnemy(s, 'walker', 6.5, 12)
  const full = Math.max(1, mdef.burst ?? 1)
  let sawEmpty = false
  let refullAfterEmpty = false
  s = run(s, 12, 0.05, g => {
    const r = g.turrets[0]?.rackLeft
    if (r === undefined) return
    if (r < full) sawEmpty = true
    else if (sawEmpty) refullAfterEmpty = true
  })
  check('新一轮复挂满挂', sawEmpty && refullAfterEmpty, `empty=${sawEmpty} refull=${refullAfterEmpty}`)
}

// --- ④ 非导弹塔 rackLeft 不参与 ---
{
  Math.random = zeroRandom
  let s = arena()
  mkTurret(s, 'mg', 6, 20)
  mkEnemy(s, 'walker', 6.5, 12)
  let staysZero = true
  s = run(s, 4, 0.05, g => { if ((g.turrets[0]?.rackLeft ?? 0) !== 0) staysZero = false })
  check('非导弹塔 rackLeft 恒为 0（不参与）', staysZero, `zero=${staysZero}`)
}

console.log('== 挂载位射出/复挂推入验收 ==')

// --- ① 导弹弹丸出生点 = rackMissilePos（±0.01 格），非炮口点 ---
{
  Math.random = zeroRandom
  const mdef = TURRET_DEFS.find(d => d.type === 'missile')!
  let s = arena()
  const t = mkTurret(s, mdef.id, 6, 20)
  mkEnemy(s, 'walker', 6.5, 12)
  let spawn: { x: number; y: number } | null = null
  s = run(s, 3, 0.05, g => {
    if (!spawn && g.projectiles.length > 0) spawn = { x: g.projectiles[0].x, y: g.projectiles[0].y }
  })
  const slot = Math.max(0, Math.max(1, mdef.burst ?? 1) - 1) // 发射前满挂 slot=枚数-1
  const expect = rackMissilePos(t, mdef, 0, slot)
  const mz = muzzlePos(t, mdef, 0)
  const dRack = spawn ? Math.hypot(spawn.x - expect.x, spawn.y - expect.y) : 99 // perTick 观测在弹丸首 tick 后，含一格内位移
  const dMuzzle = spawn ? Math.hypot(spawn.x - mz.x, spawn.y - mz.y) : 99
  check('导弹出生点 = 挂载位（rackMissilePos 邻近），非炮口点',
    spawn !== null && dRack < 0.2 && dRack < dMuzzle,
    `dRack=${dRack.toFixed(3)} dMuzzle=${dMuzzle.toFixed(3)}`)
}

// --- ② 复挂触发 rackAnim=RACK_RELOAD_ANIM 且衰减至 0；初始为 0 ---
{
  Math.random = zeroRandom
  const mdef = TURRET_DEFS.find(d => d.type === 'missile')!
  let s = arena()
  const t = mkTurret(s, mdef.id, 6, 20)
  mkEnemy(s, 'walker', 6.5, 12)
  const initZero = t.rackAnim === 0
  let sawAnim = false
  let decayedAfter = false
  s = run(s, 12, 0.05, g => {
    const a = g.turrets[0]?.rackAnim ?? 0
    if (a > 0 && a <= RACK_RELOAD_ANIM + 1e-9) sawAnim = true
    else if (sawAnim && a === 0) decayedAfter = true
  })
  check('复挂渐显推入：初始 0 → 复挂 rackAnim>0 → 衰减至 0', initZero && sawAnim && decayedAfter,
    `init=${initZero} anim=${sawAnim} decayed=${decayedAfter}`)
}

// --- ③ rackMissilePos 随 slot 向后排列（间距恒定、沿炮口反向） ---
{
  const mdef = TURRET_DEFS.find(d => d.type === 'missile')!
  const s0 = arena()
  const t = mkTurret(s0, mdef.id, 6, 20)
  const p0 = rackMissilePos(t, mdef, 0, 0)
  const p1 = rackMissilePos(t, mdef, 0, 1)
  const d = Math.hypot(p1.x - p0.x, p1.y - p0.y)
  const backX = p1.x - p0.x + dirX(0) * 0 // 方向校验：位移应与 -dir(0)（炮口反向）平行
  const dot = (p1.x - p0.x) * dirX(t.angle) + (p1.y - p0.y) * dirY(t.angle)
  check('rackMissilePos：slot 间距恒定且沿炮口反向',
    Math.abs(d - 0.34 * 0.48) < 1e-9 && dot < 0,
    `d=${d} dot=${dot} ${backX}`)
}

console.log('== 装填时间语义迁移验收 ==')

// --- v1 持久化数据迁移：fireRate 取倒数；缺失/0 跳过；v2 直通 ---
{
  const v1 = JSON.stringify({ version: 1, data: [{ id: 'a', fireRate: 2 }, { id: 'b' }, { id: 'c', fireRate: 0 }] })
  const defs = parseTurretDefs(v1)!
  const v2 = JSON.stringify({ version: 2, data: [{ id: 'd', fireRate: 0.5 }] })
  const defs2 = parseTurretDefs(v2)!
  check('v1 迁移：fireRate 2 → 0.5；缺失/0 跳过；v2 直通',
    defs[0].fireRate === 0.5
    && defs[1].fireRate === undefined
    && defs[2].fireRate === 0
    && defs2[0].fireRate === 0.5,
    JSON.stringify(defs.map(d => d.fireRate)))
}

console.log('== 逐枚渐进复挂验收 ==')

// --- ① 打空后计时启动，X=fireRate/(burst+1) 精确逐枚；满后停计 ---
{
  Math.random = zeroRandom
  const mdef = TURRET_DEFS.find(d => d.type === 'missile')!
  let s = arena()
  mkTurret(s, mdef.id, 6, 20)
  mkEnemy(s, 'walker', 6.5, 12)
  const full = Math.max(1, mdef.burst ?? 1)
  const x = mdef.fireRate / (full + 1)
  let volleyEnd: number | null = null // burstLeft >0 → 0 的转换沿
  let firstReload: number | null = null
  let fullStop = true
  let clock = 0
  let prev = s.turrets[0]!
  s = run(s, 12, 0.05, g => {
    clock += 0.05
    const t = g.turrets[0]!
    if (volleyEnd === null && prev.burstLeft > 0 && t.burstLeft === 0) volleyEnd = clock
    if (volleyEnd !== null && firstReload === null && t.rackLeft > prev.rackLeft) firstReload = clock
    if (t.rackLeft >= full && t.rackTimer > 0.001) fullStop = false // 满后停计
    prev = t
  })
  const dt = volleyEnd !== null && firstReload !== null ? firstReload - volleyEnd : -1
  check('逐枚复挂：打空后 X=fireRate/(burst+1) 秒首枚复挂，满后停计',
    volleyEnd !== null && firstReload !== null
    && Math.abs(dt - x) < 0.1 // perTick 分辨率 0.05 容差
    && fullStop,
    `dt=${dt.toFixed(3)} X=${x.toFixed(3)} fullStop=${fullStop}`)
}

// --- ② 下一轮起射时 rackLeft 必满（N×X ≤ cooldown） ---
{
  Math.random = zeroRandom
  const mdef = TURRET_DEFS.find(d => d.type === 'missile')!
  let s = arena()
  mkTurret(s, mdef.id, 6, 20)
  mkEnemy(s, 'walker', 6.5, 12)
  const full = Math.max(1, mdef.burst ?? 1)
  let fullAtVolley = true
  let volleys = 0
  let prev = s.turrets[0]!
  s = run(s, 12, 0.05, g => {
    const t = g.turrets[0]!
    if (prev.burstLeft === 0 && t.burstLeft > 0) { // 新一轮起射沿
      volleys++
      if (t.rackLeft < full) fullAtVolley = false
    }
    prev = t
  })
  check('下一轮起射时弹架必满', volleys >= 2 && fullAtVolley, `volleys=${volleys} full=${fullAtVolley}`)
}

// --- ③ 轮中（burstLeft>0）rackLeft 只减不增（不复挂） ---
{
  Math.random = zeroRandom
  const mdef = TURRET_DEFS.find(d => d.type === 'missile')!
  let s = arena()
  mkTurret(s, mdef.id, 6, 20)
  mkEnemy(s, 'walker', 6.5, 12)
  let noReloadMidVolley = true
  let prev = s.turrets[0]!
  s = run(s, 8, 0.05, g => {
    const t = g.turrets[0]!
    if (t.burstLeft > 0 && t.rackLeft > prev.rackLeft) noReloadMidVolley = false
    prev = t
  })
  check('轮中 rackLeft 不增（复挂仅轮外）', noReloadMidVolley, `ok=${noReloadMidVolley}`)
}

// --- ④ rackAnim 仅在 rackLeft+1 时重置（逐枚），随后衰减 ---
{
  Math.random = zeroRandom
  const mdef = TURRET_DEFS.find(d => d.type === 'missile')!
  let s = arena()
  mkTurret(s, mdef.id, 6, 20)
  mkEnemy(s, 'walker', 6.5, 12)
  let animOnReload = 0 // rackLeft 增加当 tick rackAnim>0 的次数
  let reloads = 0
  let animWithoutReload = 0 // rackAnim>0 但 rackLeft 未增的 tick（首 tick 除外：动画存续期合法）
  let prev = s.turrets[0]!
  s = run(s, 12, 0.05, g => {
    const t = g.turrets[0]!
    if (t.rackLeft > prev.rackLeft) {
      reloads++
      if (t.rackAnim > 0) animOnReload++
    } else if (t.rackAnim > prev.rackAnim + 1e-9) animWithoutReload++ // 无增量却重置动画
    prev = t
  })
  check('rackAnim 逐枚重置：仅 rackLeft+1 时触发',
    reloads >= 1 && animOnReload === reloads && animWithoutReload === 0,
    `reloads=${reloads} anim=${animOnReload} stray=${animWithoutReload}`)
}

console.log('== 基地格/派生墙体系验收 ==')

// --- ① 派生墙计算：边界格=墙段、里侧格非墙段、凸出格使邻格变墙段 ---
{
  LEVEL.buildCells = []
  for (let dx = 0; dx < 3; dx++) for (let dy = 0; dy < 3; dy++) LEVEL.buildCells.push(`${4 + dx},${20 + dy}`) // 3×3 块
  LEVEL.buildCells.push('7,21')
  invalidateWallInfo() // 直接改写基地格后刷新墙信息缓存 // 右侧凸出一格：邻居 (6,21) 是内部格 → (7,21) 为孤立格(33)，(6,21) 仍为墙段
  const innerBefore = isInnerCell(5, 21) && !isWallSegment(5, 21)
  const edgeIsWall = isWallSegment(4, 20) && isWallSegment(6, 22)
  const tipIsolated = isWallSegment(7, 21) && !isInnerCell(6, 21) // 孤立格不影响邻居：'(6,21)' 仍为墙段
  const st = walled()
  const wallCount = st.walls.length // 3×3 边界 8 + 凸出 (7,21) = 9（孤立格仍属墙段，渲染为 33）
  check('派生墙计算：里侧格非墙段、边界格为墙段、孤立凸尖不影响邻格（数量精确）',
    innerBefore && edgeIsWall && tipIsolated && wallCount === 9,
    `walls=${wallCount} tip=${tipIsolated}`)
  restoreLevel()
}

// --- ② 扩建规则：距 3 拒绝、出生区拒绝、可破坏物体格拒绝、≤2 通过 ---
{
  const far = canPlaceBaseCell(5, 10) // 距最近基地格 >2
  const spawn = canPlaceBaseCell(5, 0) // 出生区（仅最顶层）
  const obj = LEVEL.objects.find(o => o.hp >= 0) // 可破坏物体（岩石等）
  const objChk = obj ? canPlaceBaseCell(obj.x, obj.y) : { ok: true }
  const near = canPlaceBaseCell(5, 17) // 与墙段 (5,18) 距离 1
  const near2 = canPlaceBaseCell(5, 16) // 切比雪夫距离 2（经 (5,18)）
  check('扩建规则：距>2 拒绝、出生区拒绝、可破坏物体格拒绝、≤2 通过',
    !far.ok && !spawn.ok && !!obj && !objChk.ok && near.ok && near2.ok,
    `far=${far.ok} spawn=${spawn.ok} obj=${obj ? objChk.ok : 'none'} near=${near.ok}/${near2.ok}`)
  restoreLevel()
}

// --- ④ 扩建填平：原墙段变里侧（墙移除）→ 可建造炮塔 ---
{
  let s = walled()
  s.gold = 10000
  s.phase = 'prep'
  const wasWall = isWallSegment(5, 18) && s.walls.some(w => w.cells[0].x === 5 && w.cells[0].y === 18)
  // 单格凸尖不会填平（变 33 孤立块，原墙不消解）；结构性扩建（2 格并排使彼此非孤立）才填平
  s = placeBaseCellAt(s, 5, 17)
  s = placeBaseCellAt(s, 6, 17) // (5,17) 因 (6,17) 有 2 基地邻居 → 非孤立
  s = placeBaseCellAt(s, 5, 19)
  s = placeBaseCellAt(s, 6, 19) // (5,19) 同理非孤立 → (5,18) 四邻全为有效基地 → 变里侧
  const nowInner = isInnerCell(5, 18) && !s.walls.some(w => w.cells[0].x === 5 && w.cells[0].y === 18)
  const g = placeTurret(s, 'mg', 5, 18)
  check('扩建填平：结构性扩建使原墙段变里侧格（墙自动移除）→ 可建造炮塔',
    wasWall && nowInner && g.turrets.length === 1,
    `wasWall=${wasWall} inner=${nowInner} turrets=${g.turrets.length}`)
  restoreLevel()
}

// --- ⑥ 炮塔只能建里侧格：墙段格/非基地格拒绝（默认布局实证） ---
{
  const s = walled()
  s.phase = 'prep'
  const onWall = placeTurret(s, 'mg', 5, 18) // 墙段格
  const onOuter = placeTurret(s, 'mg', 5, 17) // 非基地格
  const onInner = placeTurret(s, 'mg', 5, 22) // 里侧格
  check('炮塔只能建里侧格（墙段格/非基地格拒绝）',
    onWall.turrets.length === 0 && onOuter.turrets.length === 0 && onInner.turrets.length === 1,
    `wall=${onWall.turrets.length} outer=${onOuter.turrets.length} inner=${onInner.turrets.length}`)
  restoreLevel()
}

console.log('== 战场纵深可配验收 ==')

// --- ① 默认 rows=72（v1.75：18→72）：视口 12 格高，纵向余量 60 行 ---
{
  const d = defaultLevel() // 出厂默认（横版 36×72 空地）
  LEVEL.rows = 72
  const clamp0 = clampViewY(0, 24, 288) // 视口 12 格（288px）
  const clampAny = clampViewY(999, 24, 288) // 拖过下沿 → 钳到 rows-12=60
  check('默认纵深 72 格（v1.75，余量 60 行，钳制边界正确）',
    d.rows === 72 && clamp0 === 0 && clampAny === 60,
    `rows=${d.rows} clamp=${clamp0}/${clampAny}`)
  restoreLevel()
}

// --- ② rows=28：初始沉底 viewY=rows-20，拖动边界停靠 ---
{
  LEVEL.rows = 28
  const bottom = clampViewY(999, 24, 480) // 拖过下沿 → 停靠 rows-20=8
  const top = clampViewY(-5, 24, 480) // 拖过上沿 → 0
  check('rows=28 初始沉底 viewY=rows-20、拖动边界停靠',
    bottom === 8 && top === 0,
    `bottom=${bottom} top=${top}`)
  restoreLevel()
}

// --- ③ 纵深改小：底部锚定（基地格/物体/地形随下沿平移 dy=rows 差，出界丢弃） ---
{
  const cellOk0 = LEVEL.buildCells.includes('5,18') // 模板顶边（rows=28）
  const terN0 = LEVEL.terrain.length
  reanchorRows(LEVEL, 20) // 28 → 20，dy=-8
  const okCell = LEVEL.buildCells.includes('5,10') && LEVEL.buildCells.includes('5,18') && !LEVEL.buildCells.includes('5,26') // 18 行格 → 10 行、26 行格 → 18 行、无残留 26 行
  const okObj = LEVEL.objects.every(o => o.y >= 0 && o.y < 20)
  const okTer = LEVEL.terrain.every(t => t.y + t.h > 0 && t.y < 20) && LEVEL.terrain.length < terN0 // 顶部地形移出丢弃
  check('纵深改小底部锚定：基地格/物体/地形随下沿平移',
    cellOk0 && LEVEL.rows === 20 && okCell && okObj && okTer,
    `cell=${okCell} obj=${okObj} ter=${LEVEL.terrain.length}/${terN0}`)
  restoreLevel()
}

// --- ④ 宽度变更：左侧锚定（x 不变，出界丢弃、部分出界收缩）；上限不限、仅钳制 COLS_MIN ---
{
  const cellOk0 = LEVEL.buildCells.includes(`${COLS - 1},18`) // 模板右侧墙格（cols=36）
  LEVEL.objects.push({ kind: 'rock', x: 30, y: 5, w: 2, h: 1, hp: -1, blockMove: true, blockProjectile: false, height: 1 }) // 完全出界（x=30 ≥ 24）
  LEVEL.objects.push({ kind: 'ruins', x: 23, y: 6, w: 3, h: 1, hp: 150, blockMove: true, blockProjectile: true, height: 1 }) // 部分出界 → 收缩 w=1
  reanchorCols(LEVEL, 24) // 36 → 24
  const dropped = !LEVEL.objects.some(o => o.x === 30)
  const shrunk = LEVEL.objects.find(o => o.x === 23 && o.y === 6)
  const okCell = LEVEL.buildCells.includes('5,18') && !LEVEL.buildCells.includes(`${COLS - 1},18`) && !LEVEL.buildCells.includes('24,18')
  const okObj = dropped && !!shrunk && shrunk.w === 1 && LEVEL.objects.every(o => o.x + o.w <= 24)
  const okTer = LEVEL.terrain.every(t => t.x + t.w <= 24)
  check('宽度改小左侧锚定：出界丢弃、部分出界收缩、左侧元素不动',
    cellOk0 && LEVEL.cols === 24 && okCell && okObj && okTer,
    `cols=${LEVEL.cols} cell=${okCell} dropped=${dropped} shrunk=${shrunk?.w} ter=${okTer}`)
  reanchorCols(LEVEL, 40) // 改大：x 不变，无元素平移
  const wide = LEVEL.cols === 40 && LEVEL.objects.some(o => o.x === 5 && o.y === 8) // 油桶仍在 (5,8)
  reanchorCols(LEVEL, 999) // 上限不限 → 接受 999（v1.41）
  const noCap = LEVEL.cols === 999
  reanchorCols(LEVEL, 5) // 低于下限 → 仍钳制 COLS_MIN
  const minClamped = LEVEL.cols === COLS_MIN
  reanchorRows(LEVEL, 100) // 纵深上限不限 → 接受 100
  const noCapR = LEVEL.rows === 100
  check('宽度改大元素不平移；宽度/纵深上限不限、下限仍钳制', wide && noCap && minClamped && noCapR, `wide=${wide} cols=${LEVEL.cols} rows=${LEVEL.rows}`)
  restoreLevel()
}

console.log('== 棱堡墙体掩码验收 ==')

// --- wallFaceInfo：直段单面 / 转角两面 / 凸角判定 / 凹角不补 / 孤立墙四面 ---
{
  const set = (cells: [number, number][]) => new Set(cells.map(([x, y]) => `${x},${y}`))
  // 直段：横排 (0,0)(1,0)(2,0)，中格仅 n/s 朝外
  const mid = wallFaceInfo(1, 0, set([[0, 0], [1, 0], [2, 0]]))
  const straight = mid.edges.size === 2 && mid.edges.has('n') && mid.edges.has('s') && mid.convex.length === 0
  // L 转角：(0,0)(1,0)(0,1)，拐角格 (0,0)：外侧边 n/w 朝外 + 对角 (-1,-1) 不在集 → 凸角 nw
  const corner = wallFaceInfo(0, 0, set([[0, 0], [1, 0], [0, 1]]))
  const convexOk = corner.edges.has('n') && corner.edges.has('w') && corner.convex.length === 1 && corner.convex[0] === 'nw'
  // 凹角：3×3 缺 (1,1)——格 (0,0) 的 e/s 朝外但对角 (1,1)... 用 T 形验凹角：(0,0)(1,0)(2,0)(1,1)，格 (1,0) s 朝外单面无角
  // 凹角标准场景：2×2 缺一角 (0,0)(1,0)(0,1)，格 (1,1)... 不在集；改验 (0,1)：n 邻 (0,0) 在集、e 邻 (1,1) 不在 → e 朝外；s 朝外 → 对角 (1,2) 不在 → 凸角
  // 真正凹角：3×3 全满中心格外。用 U 形：(0,0)(2,0)(0,1)(1,1)(2,1)，格 (1,0)：w/e 邻不在集...简化——3×3 满集角格 (0,0) 仅 s/e 邻在集 → 无朝外边
  const full3 = set([[0,0],[1,0],[2,0],[0,1],[1,1],[2,1],[0,2],[1,2],[2,2]])
  const inner = wallFaceInfo(0, 0, full3) // (0,0) 角格：s/e 邻在集，n/w 朝外；对角 (-1,-1) 不在 → 凸角 nw
  const concaveCell = wallFaceInfo(1, 0, full3) // 顶边中格：仅 n 朝外，无角
  // 凹角（不补）：格 (1,0) 在 U 形 (0,0)(2,0)(0,1)(1,1)(2,1) 中？w/e 邻 (0,0)/(2,0) 在集 → 不朝外。构造凹腔：满 3×3 去掉 (1,0) —— 格 (1,1) n 朝外（邻 (1,0) 不在），w/e 邻在集 → 单面无角
  const notch = new Set(full3); notch.delete('1,0')
  const notchCell = wallFaceInfo(1, 1, notch)
  const concaveOk = notchCell.edges.size === 1 && notchCell.edges.has('n') && notchCell.convex.length === 0
  // 凹角（同样补角）：格 (1,1) 的 e/s 朝外（(2,1)(1,2) 不在集）且对角 (2,2) 在集 → concave se（凸角列表为空）
  const withDiag = wallFaceInfo(1, 1, set([[0, 1], [1, 0], [1, 1], [2, 2]]))
  const concaveCornerOk = withDiag.edges.has('e') && withDiag.edges.has('s')
    && withDiag.convex.length === 0 && withDiag.concave.length === 1 && withDiag.concave[0] === 'se'
  // 对角邻居在集与否决定 convex/concave 互斥：同形态去掉 (2,2) → convex se、concave 空
  const noDiag = wallFaceInfo(1, 1, set([[0, 1], [1, 0], [1, 1]]))
  const mutexOk = noDiag.convex.length === 1 && noDiag.convex[0] === 'se' && noDiag.concave.length === 0
  // 孤立墙：四面朝外 + 4 凸角
  const iso = wallFaceInfo(5, 5, set([[5, 5]]))
  const isoOk = iso.edges.size === 4 && iso.convex.length === 4
  check('wallFaceInfo：直段单面/转角凸角/凹角补角（concave 列表）/孤立四面',
    straight && convexOk && concaveOk && concaveCornerOk && mutexOk && isoOk
    && inner.convex.includes('nw') && concaveCell.convex.length === 0 && concaveCell.concave.length === 0,
    `straight=${straight} convex=${convexOk} concave=${concaveOk}/${concaveCornerOk} mutex=${mutexOk} iso=${isoOk}`)
}

console.log('== 顶点级转角掩码验收 ==')

// --- wallVertexInfo：凸角/凹角顶点补角，直段/端头/孤立不补 ---
{
  const set = (cells: [number, number][]) => new Set(cells.map(([x, y]) => `${x},${y}`))
  // 凸角：2×2 块 (0,0)(1,0)(0,1)(1,1)，外角顶点 (0,0) → 真转角（walls=1，hx=1,vy=1）
  const cv = wallVertexInfo(0, 0, set([[0, 0], [1, 0], [0, 1], [1, 1]]))
  const convexOk = cv !== null && cv.walls === 1 && cv.hx === 1 && cv.vy === 1
  // 凹角：3×3 缺 (2,2)，内角顶点 (2,2)（周围 3 墙格）→ walls=3
  const cc = wallVertexInfo(2, 2, set([[0,0],[1,0],[2,0],[0,1],[1,1],[2,1],[0,2],[1,2]]))
  const concaveOk = cc !== null && cc.walls === 3
  // 连接格 C = 空腔象限 (2,2) 的对角墙格 (1,1)；凸角无 conn
  const connOk = cc !== null && cc.conn !== undefined && cc.conn.cx === 1 && cc.conn.cy === 1
    && (cv === null || cv.conn === undefined)
  // 直段顶点：横排 (0,0)(1,0)(2,0) 中间顶点 (1,0) → 两条水平外沿共线，非转角
  const straight = wallVertexInfo(1, 0, set([[0, 0], [1, 0], [2, 0]])) === null
    && wallVertexInfo(1, 1, set([[0, 0], [1, 0], [2, 0]])) === null
  // 端头：横排 (0,0)(1,0) 末端顶点 (2,0) —— 几何上 1H+1V 但延伸 1 格即折返 → 不补
  const tip1 = wallVertexInfo(2, 0, set([[0, 0], [1, 0]])) === null
    && wallVertexInfo(2, 1, set([[0, 0], [1, 0]])) === null
  // 孤立墙：单格四角顶点全为端头折返 → 全不补
  const iso = [[0, 0], [1, 0], [0, 1], [1, 1]] as [number, number][]
  const isoOk = iso.every(([vx, vy]) => wallVertexInfo(vx, vy, set([[0, 0]])) === null)
  // 对角接触 pinch：块 A(0,0) 与块 B(1,1) 顶点 (1,1) → 2H2V 非转角
  const pinch = wallVertexInfo(1, 1, set([[0, 0], [1, 1]])) === null
  check('wallVertexInfo：凸/凹角补（凹角附连接格 C）、直段/端头/孤立/对角 pinch 不补',
    convexOk && concaveOk && connOk && straight && tip1 && isoOk && pinch,
    `convex=${convexOk} concave=${concaveOk} conn=${connOk} straight=${straight} tip=${tip1} iso=${isoOk} pinch=${pinch}`)
}

console.log('== 防御墙九宫贴图分类验收 ==')

// --- classifyWallTile：直墙四向/凸凹转角/独立块/变体确定性/地面映射 ---
{
  const set = (cells: [number, number][]) => new Set(cells.map(([x, y]) => `${x},${y}`))
  const rc = (p: { wall: { r: number; c: number } }) => `${p.wall.r}${p.wall.c}`
  // 直墙四向（横排 (0,0)(1,0)(2,0)，中格 E&&W）
  const mid = classifyWallTile(1, 0, set([[0, 0], [1,0], [2, 0]]))
  const upOk = mid.wall.r === 1 && mid.wall.c >= 2 && mid.wall.c <= 4 && mid.ground.col === 2 && mid.ground.row === 1 // 朝上 12-14 → 地面 AB(行A,列B)
  const downOk = rc(classifyWallTile(1, 0, set([[0, 0], [1, 0], [2, 0], [1, -1]]))).startsWith('5') // E&&W&&N → 朝下
  const vset = set([[1, -1], [1, 0], [1, 1]])
  const leftOk = classifyWallTile(1, 0, vset).wall.c === 1 && classifyWallTile(1, 0, vset).ground.col === 1 && classifyWallTile(1, 0, vset).ground.row === 2 // N&&S&&!W → 朝左 21/31/41 + 地面 BA(行B,列A)
  const rightOk = classifyWallTile(1, 0, set([[1, -1], [1, 0], [1, 1], [0, 0]])).wall.c === 5 // N&&S&&W（缺 E）→ 朝右
  // 凸转角：连接对角反向是外部地面 → 凸角（baseSet 含基地里侧格以区分外部/里侧）
  const withBase = (walls: [number, number][], inner: [number, number][]) =>
    ({ w: set(walls), b: set([...walls, ...inner]) })
  const convL = withBase([[0, 0], [1, 0], [0, 1]], [[1, 1]]) // E+S，SE=里侧，NW=外部 → 11/A1
  const conv = classifyWallTile(0, 0, convL.w, convL.b)
  const convOk = rc(conv) === '11' && conv.ground !== null && conv.ground.col === 1 && conv.ground.row === 1 // 11 → 地面 AA
  const conv15L = withBase([[0, 0], [1, 0], [1, 1]], [[0, 1]]) // W+S，SW=里侧，NE=外部 → 15
  const conv15 = rc(classifyWallTile(1, 0, conv15L.w, conv15L.b)) === '15'
  const conv51L = withBase([[0, 0], [0, 1], [1, 1]], [[1, 0]]) // E+N，NE=里侧，SW=外部 → 51
  const conv51 = rc(classifyWallTile(0, 1, conv51L.w, conv51L.b)) === '51'
  const conv55L = withBase([[0, 1], [1, 0], [1, 1]], [[0, 0]]) // W+N，NW=里侧，SE=外部 → 55
  const conv55 = rc(classifyWallTile(1, 1, conv55L.w, conv55L.b)) === '55'
  // 凹转角（参数表）：连接方向是有效墙（相邻基地格 >1，非 33 独立格）+ 内部地面方向是基地格且非墙段
  const concL = withBase([[1, 1], [1, 0], [0, 1]], [[2, 1], [1, 2], [2, 0], [0, 2]]) // W(0,1)+N(1,0) 均双基地邻居（有效墙），E/S 内部 → 22
  const conc = classifyWallTile(1, 1, concL.w, concL.b)
  const concOk = rc(conc) === '22' && conc.ground !== null && conc.ground.col === 1 && conc.ground.row === 4 // 22 → 地面 DA
  const conc24L = withBase([[1, 1], [1, 0], [2, 1]], [[1, 2], [0, 1], [2, 0], [2, 2]]) // N+E 有效墙，S/W 内部 → 24
  const conc24 = rc(classifyWallTile(1, 1, conc24L.w, conc24L.b)) === '24'
  const conc42L = withBase([[1, 1], [1, 2], [0, 1]], [[1, 0], [2, 1], [2, 2], [0, 2]]) // S+W 有效墙，N/E 内部 → 42
  const conc42 = rc(classifyWallTile(1, 1, conc42L.w, conc42L.b)) === '42'
  const conc44L = withBase([[1, 1], [1, 2], [2, 1]], [[0, 1], [1, 0], [2, 2]]) // E+S 有效墙，W/N 内部 → 44
  const conc44 = rc(classifyWallTile(1, 1, conc44L.w, conc44L.b)) === '44'
  // 孤立规则修订：唯一邻居是内部格 → 33；唯一邻居是有效墙 → 端头算墙（可连接）
  const isoTip = withBase([[0, 1]], [[1, 1], [1, 0], [2, 1], [1, 2]]) // (0,1) 唯一邻居 (1,1) 是内部格（(1,1) 四邻全基地）→ 33
  const isoPick = classifyWallTile(0, 1, isoTip.w, isoTip.b)
  // 凸台场景（口令布局）：(10,10)=11（蓝），(11,10)=端头（非 33，邻居 (10,10) 是有效墙）
  const bumpW = set([[10, 10], [11, 10], [10, 11], [9, 11], [10, 12], [9, 12], [10, 13], [9, 13], [10, 14], [9, 14], [9, 15], [10, 15]])
  const bumpB = set([[10, 10], [11, 10], [10, 11], [9, 11], [10, 12], [9, 12], [10, 13], [9, 13], [10, 14], [9, 14], [9, 15], [10, 15], [8, 11], [8, 12], [8, 13], [8, 14], [8, 15]])
  const bumpBlue = classifyWallTile(10, 10, bumpW, bumpB)
  const bumpTip = classifyWallTile(11, 10, bumpW, bumpB)
  const isoRuleOk = rc(isoPick) === '33' && rc(bumpBlue) === '11' && rc(bumpTip) !== '33'
  // 独立块 33（地面 null 不铺贴图）
  const iso = classifyWallTile(5, 5, set([[5, 5]]))
  const isoOk = rc(iso) === '33' && iso.ground === null
  // 端头兜底：横墙右端 (1,0) 仅 W 邻居 → 朝上横墙
  const tip = classifyWallTile(1, 0, set([[0, 0], [1, 0]]))
  const tipOk = tip.wall.r === 1 && tip.wall.c >= 2 && tip.wall.c <= 4
  // T 兜底：E&W&S（缺 N）→ 朝上
  const tOk = classifyWallTile(1, 0, set([[0, 0], [1, 0], [2, 0], [1, 1]])).wall.r === 1
  // 变体确定性：同格两次同结果；不同横排格变体分布合法
  const detOk = rc(classifyWallTile(3, 7, set([[2, 7], [3, 7], [4, 7]]))) === rc(classifyWallTile(3, 7, set([[2, 7], [3, 7], [4, 7]])))
  const variants = [0, 1, 2].map(i => classifyWallTile(i * 3, 9, set([[i * 3 - 1, 9], [i * 3, 9], [i * 3 + 1, 9]])).wall.c)
  const varOk = variants.every(c => c >= 2 && c <= 4)
  check('classifyWallTile：直墙四向/凸凹转角（对角条件）/独立块/兜底/变体确定性',
    upOk && downOk && leftOk && rightOk && convOk && conv15 && conv51 && conv55
    && concOk && conc24 && conc42 && conc44 && isoRuleOk && isoOk && tipOk && tOk && detOk && varOk,
    `up=${upOk} down=${downOk} left=${leftOk} right=${rightOk} conv=${convOk}${conv15}${conv51}${conv55} conc=${concOk}${conc24}${conc42}${conc44} isoRule=${isoRuleOk} iso=${isoOk} tip=${tipOk} T=${tOk} det=${detOk} var=${varOk}`)
}

// --- 用例 52：要塞内部模块——摆放/旋转/重叠/拆除返还/加成/散热摊薄/燃油移除 ---
{
  Math.random = zeroRandom
  let s = initialState()
  s.gold = 10000

  // ① 摆放校验：界内/旋转/重叠/资源
  const gen = moduleDefOf('generator') // 2×2
  check('模块占格旋转互换', moduleFoot(gen, 0).w === 2 && moduleFoot(gen, 1).w === gen.h && moduleFoot(gen, 1).h === gen.w)
  check('界内可放', canPlaceModule(s, 'generator', 0, 0, 0).ok)
  check('越界不可放', !canPlaceModule(s, 'generator', FORTRESS_INTERIOR.cols - 1, 0, 0).ok
    && !canPlaceModule(s, 'generator', 0, FORTRESS_INTERIOR.rows - 1, 0).ok)
  const bat = moduleDefOf('battery') // 1×2，旋转后 2×1
  check('旋转影响界内判定', bat.w === 1 && bat.h === 2
    && canPlaceModule(s, 'battery', FORTRESS_INTERIOR.cols - 1, 0, 0).ok
    && !canPlaceModule(s, 'battery', FORTRESS_INTERIOR.cols - 1, 0, 1).ok)
  s = buildModule(s, 'generator', 0, 0, 0)
  check('建造扣资源并入列', s.modules.length === 1 && s.gold === 10000 - gen.cost, `gold=${s.gold}`)
  check('重叠不可放', !canPlaceModule(s, 'battery', 1, 1, 0).ok && canPlaceModule(s, 'battery', 2, 0, 0).ok)
  const poor: GameState = { ...s, gold: 0 }
  check('资源不足不可放', !canPlaceModule(poor, 'battery', 2, 0, 0).ok)

  // ② 拆除返半价
  const before = s.gold
  s = demolishModule(s, s.modules[0].id)
  check('拆除模块返半价', s.modules.length === 0 && s.gold === before + Math.floor(gen.cost / 2), `gold=${s.gold}`)

  // ③ 加成聚合与动态上限/回复
  s = buildModule(s, 'generator', 0, 0, 0)
  s = buildModule(s, 'battery', 2, 0, 0)
  s = buildModule(s, 'ammo_factory', 3, 0, 0)
  s = buildModule(s, 'ammo_depot', 0, 3, 0)
  const mb = moduleBonuses(s)
  const caps = resourceCaps(s)
  check('模块加成聚合', mb.energyRegen === 4 && mb.energyCap === 65 && mb.ammoRegen === 2 && mb.ammoCap === 80,
    JSON.stringify(mb))
  check('资源动态上限', caps.energyCap === ENERGY.cap + 65 && caps.ammoCap === AMMO.cap + 80, JSON.stringify(caps))
  s.phase = 'prep' // 隔离恢复计量：备战期炮塔不索敌开火
  s.energy = ENERGY.cap + 60 // 超过基础 cap、低于加成后 cap
  s.ammo = AMMO.cap + 70
  const e0 = s.energy
  const a0 = s.ammo
  const moduleAmmoTurret = mkTurret(s, 'mg', 4, 20)
  const moduleEnergyTurret = mkTurret(s, 'beam', 5, 20)
  moduleAmmoTurret.ammo = 0
  moduleEnergyTurret.energy = 0
  const moduleAmmoDef = TURRET_DEFS.find(def => def.id === 'mg')!
  const originalModuleAmmoExchangeRate = moduleAmmoDef.ammoExchangeRate
  moduleAmmoDef.ammoExchangeRate = 0.5
  s = tick(s, 1)
  check('模块回复加成生效且封顶于动态上限',
    s.energy === Math.min(ENERGY.cap + 65, e0 + ENERGY.regen + 4)
    && s.ammo === Math.min(AMMO.cap + 80, a0 + AMMO.regen + 2),
    `energy=${s.energy} ammo=${s.ammo}`)
  check('恢复模块作用于玩家每座炮塔的独立弹药/能量池',
    byId(s.turrets, moduleAmmoTurret.id)!.ammo === 1
    && byId(s.turrets, moduleEnergyTurret.id)!.energy === 4,
    `ammo=${byId(s.turrets, moduleAmmoTurret.id)!.ammo} energy=${byId(s.turrets, moduleEnergyTurret.id)!.energy}`)
  moduleAmmoDef.ammoExchangeRate = originalModuleAmmoExchangeRate
  let noRecovery = arena()
  const noRecoveryTurret = mkTurret(noRecovery, 'mg', 6, 20)
  noRecoveryTurret.ammo = 5
  noRecovery = tick(noRecovery, 1)
  check('未安装恢复模块时炮塔弹药不会自动恢复', byId(noRecovery.turrets, noRecoveryTurret.id)!.ammo === 5)

  // ④ 散热器直连堡垒（汇聚替代）：功率全额叠加堡垒散热速率，与炮塔数无关
  s = initialState()
  s.gold = 10000
  s = buildModule(s, 'radiator', 0, 0, 0)
  s.turrets = [mkTurret(s, 'mg', 5, 20), mkTurret(s, 'mg', 6, 20)]
  const c2 = fortressCooling(s)
  s.turrets = Array.from({ length: 10 }, (_, i) => mkTurret(s, 'mg', i % 10, 20))
  const c10 = fortressCooling(s)
  check('散热器全额直连堡垒散热（不按炮塔数摊薄）',
    Math.abs(c2 - (gameParameters().naturalHeatDissipation + 8)) < 1e-9 && Math.abs(c10 - c2) < 1e-9,
    `c2=${c2} c10=${c10}`)
  const noTurret: GameState = { ...s, turrets: [] }
  check('无炮塔时散热加成依然生效（作用于堡垒而非炮塔）', fortressCooling(noTurret) === c10)

  // ⑤ 燃油移除：状态无 fuel 字段；喷火器改用 ammoPerSec
  const raw = initialState() as unknown as Record<string, unknown>
  check('燃油资源已移除', !('fuel' in raw) && moduleDefOf('radiator').cooling === 8
    && !TURRET_DEFS.some(d => 'fuelPerSec' in d)
    && (TURRET_DEFS.find(d => d.id === 'spray') as unknown as Record<string, unknown>).ammoPerSec === 5)

  // ⑥ 模块属性加成：血量上限/移动速度/转向速度（内部空间与底座 1:1 对齐、不超出底座）
  s = initialState()
  s.gold = 10000
  const fdef = fortressDef(s)
  check('内部模块空间与底座对齐且不超出底座', fdef.interior.cols <= fdef.w && fdef.interior.rows <= fdef.h
    && fdef.interior.cols === 5 && fdef.interior.rows === 8, JSON.stringify(fdef.interior))
  check('基础派生属性', fortressMaxHp(s) === 2000 && Math.abs(fortressSpeed(s) - 6) < 1e-9
    && Math.abs(fortressTurnSpeed(s) - 25) < 1e-9,
    `hp=${fortressMaxHp(s)} spd=${fortressSpeed(s)} turn=${fortressTurnSpeed(s)}`)
  s = buildModule(s, 'armor_plate', 0, 0, 0)
  check('复合装甲加血量上限', s.fortress.maxHp === 2800 && fortressMaxHp(s) === 2800, `maxHp=${s.fortress.maxHp}`)
  s = buildModule(s, 'engine_boost', 2, 0, 0)
  check('推进引擎加速（装甲减速叠加）', Math.abs(fortressSpeed(s) - (6 + 0.35 - 0.15)) < 1e-9, `spd=${fortressSpeed(s)}`) // v1.54：基础 2→6
  s = buildModule(s, 'gyro', 4, 0, 0)
  check('陀螺稳定器加转向', Math.abs(fortressTurnSpeed(s) - 75) < 1e-9, `turn=${fortressTurnSpeed(s)}`) // v1.54：基础 15→25
  s.fortress.hp = s.fortress.maxHp // 满血 2800
  s = demolishModule(s, s.modules.find(m => m.defId === 'armor_plate')!.id)
  check('拆除装甲血量上限回落并钳制当前血量', s.fortress.maxHp === 2000 && s.fortress.hp === 2000,
    `hp=${s.fortress.hp}/${s.fortress.maxHp}`)
  restoreLevel()
}

// --- 用例 52b：v2.31 模块异型占格铺格（L 型旋转映射/洞位可铺/覆盖拒绝/特殊格逐格/出厂无 shape） ---
{
  const L = { ...moduleDefOf('generator'), id: 'sim_L', name: 'L模块', w: 2, h: 2, shape: ['0,0', '0,1', '1,1'] }
  const dot = { ...moduleDefOf('battery'), id: 'sim_dot', name: '单格模块', w: 1, h: 1 }
  const cellsOf = (rot: 0 | 1) => moduleCells(L, rot).map(c => `${c.x},${c.y}`).sort().join(';')
  check('v2.31：L 型 0° 占格=铺格集合', cellsOf(0) === ['0,0', '0,1', '1,1'].sort().join(';'), cellsOf(0))
  // rot=1 映射 (x,y)→(h-1-y, x)：(0,0)→(1,0)；(0,1)→(0,0)；(1,1)→(0,1)
  check('v2.31：L 型 90° 旋转映射 (x,y)→(h-1-y,x)', cellsOf(1) === ['0,0', '0,1', '1,0'].sort().join(';'), cellsOf(1))
  check('v2.31：无 shape 模块按全满矩形', moduleCells(moduleDefOf('generator'), 0).length === moduleDefOf('generator').w * moduleDefOf('generator').h, '')
  MODULE_DEFS.push(L, dot)
  let s = initialState()
  s.gold = 10000
  check('v2.31：L 型模块可放置', canPlaceModule(s, 'sim_L', 0, 0, 0).ok, '')
  s = buildModule(s, 'sim_L', 0, 0, 0)
  check('v2.31：已建 L 模块', s.modules.some(m => m.defId === 'sim_L'), '')
  check('v2.31：洞位 (1,0) 可再铺单格模块', canPlaceModule(s, 'sim_dot', 1, 0, 0).ok, '')
  check('v2.31：被占格 (0,0) 拒绝放置', !canPlaceModule(s, 'sim_dot', 0, 0, 0).ok, '')
  check('v2.31：洞位不足以放 2×2 模块', !canPlaceModule(s, 'generator', 1, 0, 0).ok, '')
  // 特殊格逐格判定：临时在洞位 (1,0) 挂生产特殊格（用例后恢复，模式同 290 行 interiorCells）
  DEFAULT_FORTRESS.interiorSpecials = [{ x: 1, y: 0, boost: 'produce' }]
  const mL = s.modules.find(m => m.defId === 'sim_L')!
  check('v2.31：异型模块空洞不覆盖特殊格（倍率 1）', moduleSpecialMult(s, mL, 'produce') === 1, `${moduleSpecialMult(s, mL, 'produce')}`)
  s = buildModule(s, 'sim_dot', 1, 0, 0)
  const mDot = s.modules.find(m => m.defId === 'sim_dot')!
  check('v2.31：铺满洞位的模块覆盖特殊格（倍率 SPECIAL_MULT）', moduleSpecialMult(s, mDot, 'produce') === SPECIAL_MULT, `${moduleSpecialMult(s, mDot, 'produce')}`)
  delete DEFAULT_FORTRESS.interiorSpecials
  MODULE_DEFS.splice(MODULE_DEFS.indexOf(L), 1)
  MODULE_DEFS.splice(MODULE_DEFS.indexOf(dot), 1)
  check('v2.31：出厂模块均无 shape（全满矩形语义不变）', MODULE_DEFS.every(m => m.shape === undefined), '')
}

// --- 用例 53：第二批模块——维修站/火控雷达/生产类（兵营·坦克厂·机场）与友军单位 ---
{
  Math.random = zeroRandom

  // ① 维修站：修复功率均摊到受损炮塔
  let s = initialState()
  s.gold = 10000
  s = buildModule(s, 'repair', 0, 0, 0)
  const rt1 = mkTurret(s, 'mg', 5, 20)
  rt1.hp = rt1.maxHp - 100
  s.turrets = [rt1]
  s = tick(s, 1)
  check('维修站单炮塔修复 8 hp/s', Math.abs(s.turrets[0].hp - (rt1.maxHp - 92)) < 1e-6, `hp=${s.turrets[0].hp}`)
  const rt2 = mkTurret(s, 'mg', 6, 20)
  rt1.hp = rt1.maxHp - 100
  rt2.hp = rt2.maxHp - 100
  s.turrets = [rt1, rt2]
  s = tick(s, 1)
  check('维修站两受损炮塔摊薄为 4 hp/s',
    Math.abs(s.turrets[0].hp - (rt1.maxHp - 96)) < 1e-6 && Math.abs(s.turrets[1].hp - (rt2.maxHp - 96)) < 1e-6,
    `hp=${s.turrets[0].hp},${s.turrets[1].hp}`)
  s.turrets[0].hp = s.turrets[0].maxHp - 1
  s = tick(s, 1)
  check('维修不超过耐久上限', s.turrets[0].hp === s.turrets[0].maxHp)

  // ② 火控雷达：射程增益池摊薄
  s = fresh()
  s.gold = 10000
  s = buildModule(s, 'radar', 0, 0, 0)
  check('雷达无炮塔增益为 0', turretRangeBonus(s) === 0)
  s.turrets = [mkTurret(s, 'mg', 5, 20), mkTurret(s, 'mg', 6, 20)]
  check('雷达射程增益摊薄（0.5/2=0.25）', Math.abs(turretRangeBonus(s) - 0.25) < 1e-9, `b=${turretRangeBonus(s)}`)

  // ③ 生产模块：到期产出、满员不产、拆除停产
  s = fresh()
  s.gold = 10000
  s = buildModule(s, 'barracks', 0, 0, 0)
  const barId = s.modules[0].id
  s.modules[0].timer = 0.05 // 直接快进到产出点
  const sp = allySpawnPoint(s)
  s = tick(s, 0.1)
  check('机器人模块到期产出无人飞行器于出征点', s.allies.length === 1 && s.allies[0].kind === 'plane' && s.allies[0].unitDefId === 'unit:uav'
    && s.allies[0].producerId === barId && Math.abs(s.allies[0].x - sp.x) < 1e-9 && Math.abs(s.allies[0].y - sp.y) < 1e-9,
    JSON.stringify(s.allies[0] ?? null))
  check('产出后倒计时重置', Math.abs(s.modules[0].timer - 8) < 0.2, `timer=${s.modules[0].timer}`)
  const capDef = unitDefById('unit:uav')!
  s.allies = Array.from({ length: 6 }, (_, i) => ({
    id: 9000 + i, kind: 'plane' as const, unitDefId: capDef.id, producerId: barId, x: 6, y: 5,
    hp: capDef.stats.hp, maxHp: capDef.stats.hp, cooldown: 0, targetId: null, hitFlash: 0,
  }))
  s.modules[0].timer = 0.01
  s = tick(s, 0.1)
  check('满员（6/6）不再产出', s.allies.filter(a => a.producerId === barId).length === 6)

  // ④ 友军战斗：士兵击杀行尸；行尸被地面友军缠住反击
  s = arena()
  const sol = {
    id: 9100, kind: 'soldier' as const, producerId: 1, x: 6.5, y: 10,
    hp: ALLY_DEFS.soldier.hp, maxHp: ALLY_DEFS.soldier.hp, cooldown: 0, targetId: null, hitFlash: 0,
  }
  s.allies = [sol]
  const w1 = mkEnemy(s, 'walker', 6.5, 10.4, 60) // 0.4 格：士兵射程（12m=0.48格）内、行尸缠斗距离（0.7）内
  w1.controller = 'ai'
  w1.mode = 'move'; w1.targetKind = null; w1.targetId = null // 解除钉住，走正常行为（可被友军缠住）
  s = run(s, 8, 0.05)
  check('士兵击杀行尸', !s.enemies.some(e => e.id === w1.id), `enemies=${s.enemies.length}`)
  check('退役生物近战：旧行尸夹具不再强制启用独立缠斗分支', s.allies.length === 0 || s.allies[0].hp === s.allies[0].maxHp, `allyHp=${s.allies[0]?.hp}`)

  // ⑤ 飞行友军：地面敌人无法攻击；战斗机可空地双攻击
  s = arena()
  const pl = {
    id: 9200, kind: 'plane' as const, producerId: 1, x: 6.5, y: 8,
    hp: ALLY_DEFS.plane.hp, maxHp: ALLY_DEFS.plane.hp, cooldown: 0, targetId: null, hitFlash: 0,
  }
  s.allies = [pl]
  const w2 = mkEnemy(s, 'walker', 6.5, 8.3, 60) // 贴身，但无法攻击飞行单位
  w2.controller = 'ai'
  w2.mode = 'move'; w2.targetKind = null; w2.targetId = null
  s = run(s, 5, 0.05)
  check('地面敌人无法攻击飞行友军', s.allies.length === 1 && s.allies[0].hp === s.allies[0].maxHp, `hp=${s.allies[0]?.hp}`)
  check('战斗机空地双攻击击杀行尸', !s.enemies.some(e => e.id === w2.id))

  // ⑥ 坦克/机场产出种类
  s = initialState()
  s.gold = 10000
  s = buildModule(s, 'tank_factory', 0, 0, 0)
  s = buildModule(s, 'airfield', 0, 3, 0)
  s.modules[0].timer = 0.05
  s.modules[1].timer = 0.05
  s = tick(s, 0.1)
  const kinds = s.allies.map(a => a.kind).sort().join(',')
  check('坦克厂/机场产出对应单位', kinds === 'plane,tank', kinds)
  restoreLevel()
}

// --- 用例 54：移动堡垒——初始状态/四向移动/边界钳制/碰撞滑行/挂炮系统/敌人脱战 ---
console.log('== 用例 54：移动堡垒验收 ==')

// ① 初始状态：堡垒位置/船体/内置武器/无墙无基地格/距离场原点
{
  resetLevel()
  const fd = DEFAULT_FORTRESS
  fd.hardpoints.push({ id: 'hpT1', x: 2.5, y: 4.5, size: 'S', builtIn: 'mg' }) // 普通可见炮位也可预装炮塔
  const s = initialState() // 特意用原始 initialState 验证炮位预装
  const expectedStartX = Math.max(0, Math.min(LEVEL.cols - fd.w, LEVEL.startZone.x + (LEVEL.startZone.w - fd.w) / 2))
  const expectedStartY = Math.max(0, Math.min(LEVEL.rows - fd.h, LEVEL.startZone.y + (LEVEL.startZone.h - fd.h) / 2))
  check('堡垒初始位置：几何中心对齐关卡起点区域并保持在战场内',
    Math.abs(s.fortress.x - expectedStartX) < 1e-9 && Math.abs(s.fortress.y - expectedStartY) < 1e-9,
    `x=${s.fortress.x} y=${s.fortress.y}`)
  check('船体耐久初始化', s.fortress.hp === fd.hp && s.fortress.maxHp === fd.hp)
  const hpH = fd.hardpoints.find(h => h.id === 'hpT1')!
  const t0 = s.turrets[0]
  check('普通炮位可预装炮塔',
    s.turrets.length === 1 && t0.builtIn === true && t0.hardpointId === 'hpT1' && t0.defId === hpH.builtIn,
    JSON.stringify({ n: s.turrets.length, hp: t0?.hardpointId, def: t0?.defId }))
  check('内置武器世界坐标就位',
    Math.abs(t0.x + t0.w / 2 - (s.fortress.x + hpH.x)) < 1e-9 && Math.abs(t0.y + t0.h / 2 - (s.fortress.y + hpH.y)) < 1e-9,
    `t=(${t0.x},${t0.y})`)
  check('移动堡垒无地面墙/基地格/核心', s.walls.length === 0 && LEVEL.buildCells.length === 0 && LEVEL.core === null)
  const d0 = computePathField(s)
  check('距离场以堡垒覆盖格为原点', fortressCells(s).every(c => d0[c.y * COLS + c.x] === 0))
  const incompatible = structuredClone(fd)
  incompatible.hardpoints.find(h => h.id === 'hpT1')!.size = 'L'
  check('炮位预装校验：拒绝炮塔尺寸与炮位尺寸不匹配', validateFortressDef(incompatible).some(error => error.includes('预装炮塔尺寸')))
  fd.hardpoints.splice(fd.hardpoints.findIndex(h => h.id === 'hpT1'), 1) // 还原出厂炮位表
  restoreLevel()
}

// ② 移动：四向位移、跨格重寻路、挂载炮塔跟随、四边界钳制
{
  resetLevel()
  LEVEL.objects = [] // 空旷战场：隔离移动/钳制语义
  DEFAULT_FORTRESS.hardpoints.push({ id: 'hpT1', x: 2.5, y: 4.5, size: 'S', hidden: true, builtIn: 'mg' }) // v1.72：临时注入内置武器验证跟随
  let s = initialState()
  s.prepLeft = 1e9 // 停留在备战期（移动不受阶段限制）
  const x0 = s.fortress.x
  const pv0 = s.pathVersion
  s.moveDir.x = -1
  s = run(s, 3, 0.05) // 加速度 0.8：3s ≈ 左移 3.5 格
  s.moveDir.x = 0
  check('左移输入生效', s.fortress.x < x0 - 2, `x=${s.fortress.x.toFixed(2)} (was ${x0})`)
  check('堡垒跨格触发全场重寻路', s.pathVersion > pv0, `pv=${s.pathVersion} (was ${pv0})`)
  const hpH2 = DEFAULT_FORTRESS.hardpoints.find(h => h.id === 'hpT1')!
  const tm = s.turrets[0]
  const wpH2 = hardpointWorldPos(s, hpH2) // 左移 1s 触发自动朝向（船头已转 270°），炮位取旋转后世界坐标
  check('挂载炮塔世界坐标跟随堡垒',
    Math.abs(tm.x + tm.w / 2 - wpH2.x) < 1e-9 && Math.abs(tm.y + tm.h / 2 - wpH2.y) < 1e-9,
    `t=(${tm.x.toFixed(2)},${tm.y.toFixed(2)}) wp=(${wpH2.x.toFixed(2)},${wpH2.y.toFixed(2)})`)
  s.moveDir.x = -1
  s = run(s, 30, 0.05)
  s.moveDir.x = 0
  check('左边界钳制', s.fortress.x === 0, `x=${s.fortress.x}`)
  s.moveDir.y = -1
  s = run(s, 40, 0.05)
  s.moveDir.y = 0
  check('上边界钳制', s.fortress.y === 0, `y=${s.fortress.y}`)
  s.moveDir.y = 1
  s = run(s, 40, 0.05)
  s.moveDir.y = 0
  check('下边界钳制', Math.abs(s.fortress.y - (LEVEL.rows - DEFAULT_FORTRESS.h)) < 1e-9, `y=${s.fortress.y}`)
  s.moveDir.x = 1
  s = run(s, 40, 0.05)
  s.moveDir.x = 0
  check('右边界钳制', Math.abs(s.fortress.x - (COLS - DEFAULT_FORTRESS.w)) < 1e-9, `x=${s.fortress.x}`)
  DEFAULT_FORTRESS.hardpoints.splice(DEFAULT_FORTRESS.hardpoints.findIndex(h => h.id === 'hpT1'), 1) // 还原出厂炮位表
  restoreLevel()
}

// ③ 碰撞：挡移动物体撞停该轴，另一轴可贴墙滑行
{
  resetLevel()
  LEVEL.objects = [{ kind: 'rock', x: 8, y: 5, w: 2, h: 1, hp: -1, blockMove: true, blockProjectile: false, height: 1 }]
  let s = initialState()
  s.prepLeft = 1e9
  s.fortress.x = 6
  s.fortress.y = 8 // 岩石 (8-9, 5) 下方
  s.moveDir.y = -1
  s = run(s, 3, 0.05)
  s.moveDir.y = 0
  check('岩石撞停上移轴（停在岩石下沿）', s.fortress.y >= 6 - 1e-6 && s.fortress.y < 6.35, `y=${s.fortress.y}`) // v1.54：高速挡停回推 <0.35
  const xs0 = s.fortress.x
  s.moveDir.x = -1
  s = run(s, 1.5, 0.05) // 加速度 0.8：1.5s ≈ 滑行 0.9 格
  s.moveDir.x = 0
  check('受阻轴外另一轴可滑行', s.fortress.x < xs0 - 0.5, `x=${s.fortress.x.toFixed(2)} (was ${xs0})`)
  restoreLevel()
}

// ④ 挂炮系统：尺寸匹配/隐藏素材不影响装配/占用/资源/扣款就位/半价返还/预装锁定/战斗期禁止
{
  resetLevel()
  DEFAULT_FORTRESS.hardpoints.push({ id: 'hpT1', x: 2.5, y: 4.5, size: 'S', hideTurretArt: true })
  DEFAULT_FORTRESS.hardpoints.push({ id: 'hpT2', x: 2.5, y: 5.5, size: 'S', builtIn: 'mg' })
  DEFAULT_FORTRESS.hardpoints.push({ id: 'hpT3', x: 3.5, y: 5.5, size: 'S', builtIn: 'mg', lockedTurret: true })
  let s = initialState()
  s.gold = 10000
  check('S 型武器可挂 S 炮位', canMountTurret(s, 'mg', 'hpS1').ok)
  const hid = canMountTurret(s, 'mg', 'hpT1')
  check('隐藏炮塔素材只影响绘制，不阻止炮位装配', hid.ok, hid.reason)
  const needL = canMountTurret(s, 'mg', 'hpL1')
  check('尺寸不匹配拒绝（S 武器 vs L 炮位）', !needL.ok && needL.reason === '需要 L 尺寸炮位', needL.reason)
  const needS = canMountTurret(s, 'cruise', 'hpS1')
  check('尺寸不匹配拒绝（L 武器 vs S 炮位）', !needS.ok && needS.reason === '需要 S 尺寸炮位', needS.reason)
  check('M 型武器可挂 M 炮位', canMountTurret(s, 'lob', 'hpM1').ok)
  const g0 = s.gold
  const lobCost = TURRET_DEFS.find(d => d.id === 'lob')!.cost
  s = mountTurret(s, 'lob', 'hpM1')
  const mt = s.turrets.find(t => t.hardpointId === 'hpM1')!
  const hpM1def = DEFAULT_FORTRESS.hardpoints.find(h => h.id === 'hpM1')!
  check('挂炮成功扣款并就位',
    !!mt && !mt.builtIn && s.gold === g0 - lobCost
    && Math.abs(mt.x + mt.w / 2 - (s.fortress.x + hpM1def.x)) < 1e-9
    && Math.abs(mt.y + mt.h / 2 - (s.fortress.y + hpM1def.y)) < 1e-9,
    `gold=${s.gold} t=(${mt?.x},${mt?.y})`)
  const occ = canMountTurret(s, 'beam', 'hpM1')
  check('炮位占用后不可再挂', !occ.ok && occ.reason === '炮位已占用', occ.reason)
  const g1 = s.gold
  s = unmountTurret(s, mt.id)
  check('卸炮返还半价',
    !s.turrets.some(t => t.hardpointId === 'hpM1') && s.gold === g1 + Math.floor(lobCost / 2),
    `gold=${s.gold}`)
  const bt = s.turrets.find(t => t.hardpointId === 'hpT2')!
  const n0 = s.turrets.length
  const builtInGold = s.gold
  s = unmountTurret(s, bt.id)
  check('预装武器默认可卸且不返还资源', s.turrets.length === n0 - 1 && !s.turrets.some(t => t.hardpointId === 'hpT2') && s.gold === builtInGold)
  const lockedBuiltIn = s.turrets.find(t => t.hardpointId === 'hpT3')!
  const lockedCount = s.turrets.length
  s = unmountTurret(s, lockedBuiltIn.id)
  check('显式锁定的预装武器不可卸', s.turrets.length === lockedCount && s.turrets.some(t => t.id === lockedBuiltIn.id && t.locked))
  s.gold = 0
  const poor = canMountTurret(s, 'mg', 'hpS1')
  check('资源不足不可挂', !poor.ok && poor.reason === '资源不足', poor.reason)
  s.gold = 10000
  s.phase = 'combat'
  s.fortress.x = LEVEL.startZone.x + LEVEL.startZone.w + 2
  s.fortress.y = LEVEL.startZone.y
  const n1 = s.turrets.length
  s = mountTurret(s, 'mg', 'hpS1')
  check('战斗中驶离起点区域不可挂炮', s.turrets.length === n1)
  DEFAULT_FORTRESS.hardpoints.splice(DEFAULT_FORTRESS.hardpoints.findIndex(h => h.id === 'hpT1'), 1)
  DEFAULT_FORTRESS.hardpoints.splice(DEFAULT_FORTRESS.hardpoints.findIndex(h => h.id === 'hpT2'), 1) // 还原出厂炮位表
  DEFAULT_FORTRESS.hardpoints.splice(DEFAULT_FORTRESS.hardpoints.findIndex(h => h.id === 'hpT3'), 1)
  restoreLevel()
}

// ⑤ 敌人脱战：堡垒驶离射程 → 远程攻击失效、重新追击
{
  resetLevel()
  LEVEL.objects = []
  let s = arena()
  const fr = fortressRect(s)
  const hp0 = s.fortress.hp
  s.fortress.armor.front = 0 // 本用例只验证远程攻击状态，不让概率跳弹干扰
  const e = mkEnemy(s, 'walker', fr.x + fr.w / 2, fr.y - 0.5)
  e.controller = 'ai'
  e.mode = 'attack'; e.targetKind = 'fortress'; e.targetId = 0
  s = run(s, 1.8, 0.05)
  check('近距敌方直线实弹命中并削减船体', s.fortress.hp < hp0, `hp=${s.fortress.hp}`)
  s.fortress.x += 12 // 驶出行尸 8 格射程
  s = tick(s, 0.1)
  const ee = byId(s.enemies, e.id)!
  check('堡垒驶出射程后敌人停止射击并重追', ee.targetKind === 'fortress' && ee.mode === 'move', `kind=${ee.targetKind} mode=${ee.mode}`)
  restoreLevel()
}

// 玩家与其他阵营共用单位摧毁入口：只播放所选模板，不再触发堡垒专属连锁爆炸或 AOE。
{
  check('单位摧毁模板：支持小/中/大/剧烈四档配置',
    (['small', 'medium', 'large', 'violent'] as const).every(destructionEffect =>
      !validateFortressDef({ ...DEFAULT_FORTRESS, destructionEffect }).some(error => error.includes('摧毁效果'))), '')
  check('单位摧毁模板：旧单位按主体尺寸获得兼容默认值',
    resolveUnitDestructionEffect(undefined, 1, 1) === 'small'
    && resolveUnitDestructionEffect(undefined, 2, 2) === 'medium'
    && resolveUnitDestructionEffect(undefined, 4, 3) === 'large'
    && resolveUnitDestructionEffect(undefined, 6, 4) === 'violent', '')
  check('单位摧毁模板：显式配置优先于尺寸默认值',
    resolveUnitDestructionEffect('small', 8, 8) === 'small', '')
  const destructionSmall = unitDestructionVisualParams('small')
  const destructionMedium = unitDestructionVisualParams('medium')
  const destructionLarge = unitDestructionVisualParams('large')
  const destructionViolent = unitDestructionVisualParams('violent')
  const wreckageFrames = [0, 1, 2, 3].map(index => wreckageFrameRect(64, 64, index))
  check('单位摧毁残骸素材：64×64 图集按 2×2 切为四个 32×32 随机残片',
    wreckageFrames.every(frame => frame.sw === 32 && frame.sh === 32)
      && wreckageFrames.map(frame => `${frame.sx},${frame.sy}`).join('|') === '0,0|32,0|0,32|32,32')
  check('单位摧毁残骸素材：游戏参数默认小/中/大/剧烈缩放为50%/100%/150%/180%',
    destructionSmall.debrisSpriteScale === 0.5
      && destructionMedium.debrisSpriteScale === 1
      && destructionLarge.debrisSpriteScale === 1.5
      && destructionViolent.debrisSpriteScale === 1.8)
  setUnitDestructionWreckageScalePercent('small', 80)
  check('单位摧毁残骸素材：游戏参数修改后立即作用于爆炸渲染',
    unitDestructionVisualParams('small').debrisSpriteScale === 0.8)
  setUnitDestructionWreckageScalePercent('small', 50)
  check('单位摧毁表现：小/中/大档直接复用弹丸爆炸模板参数',
    destructionSmall.explosion.template === 'small'
    && destructionMedium.explosion.template === 'medium'
    && destructionLarge.explosion.template === 'large'
    && destructionMedium.explosion.sparks === 14
    && destructionLarge.explosion.rings === 3, '')
  check('单位摧毁表现：剧烈档由大型弹丸爆炸模板增强为四层冲击环',
    destructionViolent.explosion.template === 'large'
    && destructionViolent.explosion.rings === 4
    && destructionViolent.explosion.sparks > destructionLarge.explosion.sparks, '')
  const mediumDebrisTravel = destructionMedium.debrisSpeed / destructionMedium.debrisDrag
    * (1 - Math.exp(-destructionMedium.debrisDrag * destructionMedium.debrisLife))
  check('单位摧毁表现：残骸高速飞散且理论距离超过爆心半径 3.7 倍',
    destructionMedium.debrisSpeed >= 4.8 && mediumDebrisTravel > 3.7,
    `distance=${mediumDebrisTravel.toFixed(2)}r`)

  resetLevel()
  LEVEL.objects = []
  let s = arena()
  const fr = fortressRect(s)
  s.fortress.hp = 5 // 一击即毁
  const e = mkEnemy(s, 'walker', fr.x + fr.w / 2, fr.y - 0.5)
  e.controller = 'ai'
  e.mode = 'attack'; e.targetKind = 'fortress'; e.targetId = 0
  const e2 = mkEnemy(s, 'walker', fr.x + fr.w / 2, fr.y - 1.5) // 位于表现范围内，但统一摧毁视觉不造成 AOE
  const hp2 = e2.hp
  let sawDying = false, sawUnified = false
  let guard = 0
  while (s.phase !== 'lost' && guard++ < 60) {
    s = tick(s, 0.1)
    if (s.fortress.dyingT >= 0 && !sawDying) {
      sawDying = true
      check('v2.53 hp 归零进入毁灭序列（不立即判负）', s.phase !== 'lost', `phase=${s.phase} dyingT=${s.fortress.dyingT}`)
    }
    if (s.explosions.some(x => x.kind === 'unitDeath' && x.deathEffect === 'violent')) sawUnified = true
  }
  check('玩家摧毁：按主体尺寸进入统一剧烈爆炸模板', sawUnified, '')
  check('玩家摧毁：视觉模板不再附带堡垒专属 AOE', byId(s.enemies, e2.id)?.hp === hp2, `hp=${byId(s.enemies, e2.id)?.hp}`)
  check('玩家摧毁：演出毕判负（且未误判胜）', s.phase === 'lost' && guard < 60, `phase=${s.phase} ticks=${guard} dyingT=${s.fortress.dyingT.toFixed(2)}`)
  restoreLevel()
}

// --- 用例 55：横版操控——堡垒转向（A/D，v1.61 原 Q/E）、挂载炮塔随转、炮位视界 ---
{
  resetLevel()
  Math.random = zeroRandom
  const DEG2 = Math.PI / 180

  // ① 转向速度与方向：D 右转（顺时针 +）、A 左转（v1.61 原 E/Q）（全速移动 → 转向比率 1，满速率）
  let s = arena()
  s.turnDir = 1
  s.moveDir = { x: 0, y: 1 }
  s.fortress.vy = fortressSpeed(s) // 全速：比率 = 1
  s = tick(s, 0.5)
  check(`D 右转（转向 25°/s，0.5s = 12.5°）`, Math.abs(s.fortress.heading - 25 * DEG2 * 0.5) < 1e-9, `h=${(s.fortress.heading / DEG2).toFixed(1)}`) // v1.54
  s.turnDir = -1
  s = tick(s, 1)
  check(`A 左转（净 -12.5°）`, Math.abs(s.fortress.heading - (-25 * DEG2 * 0.5)) < 1e-9, `h=${(s.fortress.heading / DEG2).toFixed(1)}`) // v1.54
  s.turnDir = 0
  s.moveDir = { x: 0, y: 0 }
  const hRel55 = s.fortress.heading
  s = run(s, 0.15, 0.05)
  check('v1.56 松手过渡：松开后仍在惯性左转（角速度未立刻归零）', s.fortress.heading < hRel55 - 0.8 * DEG2, `Δ=${((s.fortress.heading - hRel55) / DEG2).toFixed(2)}°`)
  s = run(s, 2, 0.05)
  const extra55 = (s.fortress.heading - hRel55) / DEG2
  check('v1.56 松手过渡：角速度指数衰减归零，额外摆动 ≈-5.4°（-7~-4）', s.fortress.turnW === 0 && extra55 < -4 && extra55 > -7, `extra=${extra55.toFixed(2)}° turnW=${s.fortress.turnW}`)
  const hDone55 = s.fortress.heading
  s = run(s, 1, 0.05)
  check('v1.56 松手过渡：衰减完成后船头稳定不再转', s.fortress.heading === hDone55)

  // ② 挂载炮塔随船体旋转：位置 = 旋转后炮位坐标，炮口角随动
  s = arena()
  s.phase = 'prep'
  s = mountTurret(s, 'lob', 'hpM1')
  const lobT = s.turrets.find(t => t.hardpointId === 'hpM1')!
  const a0 = lobT.angle
  s.turnDir = 1
  s.moveDir = { x: 0, y: 1 }
  s.fortress.vy = fortressSpeed(s) // 全速：比率 = 1
  s = tick(s, 1) // 备战期转 0.1rad（备战无瞄准回中干扰；R=20 弧线限速）
  const lobT2 = byId(s.turrets, lobT.id)!
  const hpM1 = DEFAULT_FORTRESS.hardpoints.find(h => h.id === 'hpM1')!
  const wp = hardpointWorldPos(s, hpM1)
  check('挂载炮塔随转就位（旋转炮位坐标）',
    Math.abs(lobT2.x + lobT2.w / 2 - wp.x) < 1e-9 && Math.abs(lobT2.y + lobT2.h / 2 - wp.y) < 1e-9,
    `t=(${lobT2.x.toFixed(2)},${lobT2.y.toFixed(2)}) wp=(${wp.x.toFixed(2)},${wp.y.toFixed(2)})`)
  check('挂载炮塔炮口随船体 +25°（转向 25°/s × 1s）', Math.abs(lobT2.angle - (a0 + 25 * DEG2)) < 1e-9, `a=${(lobT2.angle / DEG2).toFixed(1)}`) // v1.54
  s.turnDir = 0

  // ③ 炮位视界：区间包含判定（跨 0° 与直区间）
  check('视界包含判定',
    hardpointArcContains({ start: 315, end: 45 }, 0) && hardpointArcContains({ start: 315, end: 45 }, 44 * DEG2)
    && !hardpointArcContains({ start: 315, end: 45 }, 90 * DEG2)
    && hardpointArcContains({ start: 140, end: 270 }, 200 * DEG2) && !hardpointArcContains({ start: 140, end: 270 }, 0))

  // ④ 视界限制交战：v1.72 口令布局——hpS1（arc 215~375 = 前左半球）打不到前右目标（射程内），可打前左目标
  s = arena()
  s.phase = 'prep'
  s = mountTurret(s, 'mg', 'hpS1')
  s.phase = 'combat'
  const fr = fortressRect(s)
  const front = mkEnemy(s, 'walker', fr.x + 4, fr.y - 2, 100000) // 炮位前右（bearing≈32°，视界外、射程内——纯视界隔离）
  front.mode = 'move'; front.targetKind = null; front.targetId = null
  s = run(s, 3)
  check('视界外目标不开火', byId(s.enemies, front.id)!.hp === 100000, `hp=${byId(s.enemies, front.id)!.hp}`)
  s.enemies = []
  const rear = mkEnemy(s, 'walker', fr.x - 1.5, fr.y - 3, 100000) // 炮位前左（bearing≈329°，视界内 215~375）
  rear.mode = 'move'; rear.targetKind = null; rear.targetId = null
  s = run(s, 4)
  check('视界内目标正常开火', byId(s.enemies, rear.id)!.hp < 100000, `hp=${byId(s.enemies, rear.id)!.hp}`)


  // ④c v1.98 固定视角：炮口恒定朝固定角（初始角=船头+固定角、不追踪），仅射角锥内目标可打
  {
    Math.random = zeroRandom
    let s = arena()
    s.phase = 'prep'
    s.gold = 10000
    const fd98 = fortressDef(s)
    const hp98 = fd98.hardpoints.find(h => h.id === 'hpS1')!
    const bakArc98 = hp98.arc, bakFixed98 = hp98.fixed
    hp98.fixed = 90 // 船头右方（顺时针 90°）
    delete hp98.arc
    s = mountTurret(s, 'mg', 'hpS1')
    s.phase = 'combat'
    const mt98 = s.turrets.find(t => t.hardpointId === 'hpS1')!
    check('v1.98：固定视角炮塔初始角 = 船头 + 固定角',
      Math.abs(mt98.angle - Math.PI / 2) < 1e-9, `angle=${mt98.angle}`)
    const hpPos = hardpointWorldPos(s, hp98)
    const left = mkEnemy(s, 'walker', hpPos.x - 4, hpPos.y, 100000) // 左方 bearing 270°：固定角（90°）锥外
    left.mode = 'move'; left.targetKind = null; left.targetId = null
    s = run(s, 3)
    const mt98b = byId(s.turrets, mt98.id)!
    check('v1.98：固定视角炮口不追踪（恒定朝固定角）',
      Math.abs(mt98b.angle - Math.PI / 2) < 1e-9, `angle=${mt98b.angle}`)
    check('v1.98：固定视角锥外目标不开火',
      byId(s.enemies, left.id)!.hp === 100000, `hp=${byId(s.enemies, left.id)!.hp}`)
    s.enemies = []
    const right = mkEnemy(s, 'walker', hpPos.x + 4, hpPos.y, 100000) // 右方 bearing 90°：锥内（mg 射角 ±6°）
    right.mode = 'move'; right.targetKind = null; right.targetId = null
    s = run(s, 3)
    check('v1.98：固定视角锥内目标正常开火',
      byId(s.enemies, right.id)!.hp < 100000, `hp=${byId(s.enemies, right.id)!.hp}`)
    // 校验：固定角范围 -180~180
    check('v1.98：validateFortressDef 固定视角范围校验（181 拦截 / -180 放行）',
      validateFortressDef({ ...fd98, hardpoints: [{ ...hp98, fixed: 181 }] }).some(e => e.includes('固定视角'))
      && !validateFortressDef({ ...fd98, hardpoints: [{ ...hp98, fixed: -180 }] }).some(e => e.includes('固定视角')), '')
    hp98.arc = bakArc98; hp98.fixed = bakFixed98 // 恢复
  }


  // ④d v1.99 挂载初始朝向按炮位视角：指定视角=视界中心、全视角=0°（固定视角=固定角，v1.98 已验）
  {
    Math.random = zeroRandom
    let s = arena()
    s.phase = 'prep'
    s.gold = 10000
    s = mountTurret(s, 'mg', 'hpS1') // hpS1 指定视角 215~375（跨 0°），中心 = 295°
    const tA = s.turrets.find(t => t.hardpointId === 'hpS1')!
    const mid99 = 295 * Math.PI / 180
    check('v1.99：指定视角炮位挂载初始角 = 视界中心（295°）',
      Math.abs(wrapAngle(tA.angle - mid99)) < 1e-9, `angle=${tA.angle.toFixed(4)} mid=${wrapAngle(mid99).toFixed(4)}`)
    // 全视角：临时移除 hpS1 视界再挂载第二台（换个炮位以免占位冲突，用 hpS2 并清其视界）
    const fd99 = fortressDef(s)
    const hpS2 = fd99.hardpoints.find(h => h.id === 'hpS2')!
    const bakArc99 = hpS2.arc
    delete hpS2.arc // 全视角
    s = mountTurret(s, 'mg', 'hpS2')
    const tB = s.turrets.find(t => t.hardpointId === 'hpS2')!
    check('v1.99：全视角炮位挂载初始角 = 0°（船头方向）',
      Math.abs(wrapAngle(tB.angle)) < 1e-9, `angle=${tB.angle}`)
    hpS2.arc = bakArc99 // 恢复
  }

  // ④e 战斗 HUD 关闭自动开火：停止索敌并按炮塔转速回到炮位原始朝向
  {
    Math.random = zeroRandom
    let s = arena()
    s.phase = 'prep'
    s.gold = 10000
    s = mountTurret(s, 'mg', 'hpS1')
    const mounted = s.turrets.find(t => t.hardpointId === 'hpS1')!
    const rest = mounted.angle
    mounted.angle = wrapAngle(rest + Math.PI / 2)
    mounted.targetId = 999
    s = setTurretAutoFire(s, mounted.id, false)
    s.phase = 'combat'
    mkEnemy(s, 'walker', 100, 100) // 保持交战阶段，但位于炮塔射程外
    const before = Math.abs(wrapAngle(mounted.angle - rest))
    s = tick(s, 0.1)
    const afterTick = s.turrets.find(t => t.id === mounted.id)!
    const after = Math.abs(wrapAngle(afterTick.angle - rest))
    check('关闭自动开火：立即解除目标并开始向炮位原始朝向回正',
      afterTick.targetId === null && after < before, `before=${before} after=${after} target=${afterTick.targetId}`)
    s = run(s, 5, 0.05)
    const returned = s.turrets.find(t => t.id === mounted.id)!
    check('关闭自动开火：挂载炮塔最终回到炮位视界中心',
      Math.abs(wrapAngle(returned.angle - rest)) < 1e-6, `angle=${returned.angle} rest=${rest}`)

    let ground = arena()
    const groundTurret = mkTurret(ground, 'mg', 6, 20)
    groundTurret.angle = Math.PI / 2
    ground = setTurretAutoFire(ground, groundTurret.id, false)
    mkEnemy(ground, 'walker', 100, 100) // 保持交战阶段，但位于炮塔射程外
    ground = run(ground, 5, 0.05)
    check('关闭自动开火：地面炮塔最终回到世界上方0°',
      Math.abs(wrapAngle(byId(ground.turrets, groundTurret.id)!.angle)) < 1e-6)
  }

  // ⑤b 平移：移动不再改变朝向（仅 A/D 显式转向，速率受速度比率调制）
  s = arena()
  s.moveDir = { x: 0, y: 1 }
  s.fortress.vy = fortressSpeed(s) // 全速向下平移
  s = tick(s, 2)
  check('移动不改朝向（平移）', s.fortress.heading === 0, `h=${(s.fortress.heading / DEG2).toFixed(1)}`)
  s.fortress.heading = 10 * DEG2
  s.moveDir = { x: 1, y: -1 } // 对角平移
  s.fortress.vx = fortressSpeed(s) / Math.SQRT2
  s.fortress.vy = -fortressSpeed(s) / Math.SQRT2
  s = tick(s, 1)
  check('对角平移朝向保持', Math.abs(s.fortress.heading - 10 * DEG2) < 1e-9,
    `h=${(s.fortress.heading / DEG2).toFixed(1)}`)
  // A/D 显式转向：移动中按住 A，按速度比率转向
  s.fortress.heading = 0
  s.moveDir = { x: 0, y: 1 }
  s.fortress.vx = 0
  s.fortress.vy = fortressSpeed(s) // 全速 → 比率 1
  s.turnDir = -1 // 按住 A 左转
  s = tick(s, 0.5)
  check('移动中 Q 显式转向（0.5s = -12.5°）', Math.abs(s.fortress.heading - (-25 * DEG2 * 0.5)) < 1e-9, // v1.54
    `h=${(s.fortress.heading / DEG2).toFixed(1)}`)
  s.turnDir = 0
  s.moveDir = { x: 0, y: 0 }

  // ⑤ 陀螺稳定器提升实际转向速度
  s = arena()
  s.phase = 'prep'
  s = buildModule(s, 'gyro', 0, 0, 0)
  s.phase = 'combat'
  s.turnDir = 1
  s.moveDir = { x: 0, y: 1 }
  s.fortress.vy = fortressSpeed(s) // 全速：比率 = 1
  s = tick(s, 0.5)
  check('陀螺稳定器：转向 75°/s 超弧线半径上限，受 maxSpd/R=0.6rad/s 限速（0.5s = 0.3rad）', Math.abs(s.fortress.heading - 0.3) < 1e-9, // v1.54
    `h=${(s.fortress.heading / DEG2).toFixed(1)}`)

  // ⑤c 加速度：速度按 accel 爬升/衰减，封顶于最大速度
  s = arena()
  s.moveDir = { x: 1, y: 0 }
  s = tick(s, 0.1)
  check('加速度起步（3 格/s² × 0.1s = 0.3 格/s）', Math.abs(s.fortress.vx - 3 * 0.1) < 1e-9, `vx=${s.fortress.vx}`) // v1.54
  s = run(s, 3, 0.05) // 加速度 0.8：2.5s 到满速 2
  check('加速封顶于最大速度', Math.abs(s.fortress.vx - fortressSpeed(s)) < 1e-9, `vx=${s.fortress.vx}`)
  s.moveDir = { x: 0, y: 0 }
  s = tick(s, 0.1)
  check('松开输入按惯性减速（惯性4≈1.5×加速度）', Math.abs(s.fortress.vx - (fortressSpeed(s) - 3 * 1.5 * 0.1)) < 1e-9, `vx=${s.fortress.vx}`) // v1.54

  // ⑤d 弧线转向（R=20>0）：角速度 = min(turnSpeed, maxSpd/R)；v2.51：出厂堡垒缺省履带底盘——静止单独按 D 为原地枢轴转向（v1.63 静止无效语义移交轮式底盘）
  s = arena()
  s.turnDir = 1
  s = tick(s, 0.5)
  check('v2.51 履带枢轴：静止按 D 原地转向（25°/s × 0.5s = 12.5°）', Math.abs(s.fortress.heading - 12.5 * Math.PI / 180) < 1e-9, `h=${s.fortress.heading}`)
  s.fortress.heading = 0
  s.moveDir = { x: 1, y: 0 }
  s.fortress.vx = 0.8 // 半速：角速度仍按 maxSpd/R，与当前速度无关
  s = tick(s, 0.1)
  check('弧线转向角速度不受速度比率影响（0.1s = 2.5°）', Math.abs(s.fortress.heading - 25 * DEG2 * 0.1) < 1e-9, // v1.54
    `h=${(s.fortress.heading / DEG2).toFixed(3)}rad→°`)
  restoreLevel()
}


// ====== 用例56：堡垒编辑器扩展（摇杆模拟量 / 自由网格镂空 / 炮位类型限制 / 模块特殊格 / 类型库出战） ======
{
  const mkObj = (id: number, x: number, y: number): BattleObject =>
    ({ id, kind: 'rock', x, y, w: 1, h: 1, hp: 100, maxHp: 100, blockMove: true, blockProjectile: true }) as BattleObject

  // ① 摇杆模拟量：moveMag 缩放速度上限
  let s = arena()
  s.moveDir = { x: 1, y: 0 }
  s.moveMag = 0.5
  s = run(s, 2, 0.05)
  check('摇杆半推：稳态速度 = 最大速度×0.5', Math.abs(s.fortress.vx - fortressSpeed(s) * 0.5) < 1e-6, `vx=${s.fortress.vx} expect=${fortressSpeed(s) * 0.5}`)
  s = arena()
  s.moveDir = { x: 1, y: 0 }
  s.moveMag = 3 // 越界钳制
  s = run(s, 3, 0.05)
  check('moveMag>1 钳制为全速', Math.abs(s.fortress.vx - fortressSpeed(s)) < 1e-6, `vx=${s.fortress.vx}`)

  // ② 自由网格形状校验
  const ring: FortressDef = {
    id: 'test-ring', name: '测试环', w: 3, h: 3,
    shape: ['0,0', '1,0', '2,0', '0,1', '2,1', '0,2', '1,2', '2,2'], // 3×3 环形（中心镂空）
    interior: { cols: 1, rows: 1 },
    hp: 1000, speed: 2, turnSpeed: 90, accel: 5, heatCap: 200, heatDissipation: 10,
    hardpoints: [], color: '#888888',
  }
  check('环形镂空校验通过', validateFortressDef(ring).length === 0, validateFortressDef(ring).join(';'))
  check('不连通网格被拒绝', validateFortressDef({ ...ring, shape: ['0,0', '2,2'] }).some(e => e.includes('连通')))
  check('旧载具 w/h 与形状范围不一致时被拒绝', validateFortressDef({ ...ring, w: 4 }).some(e => e.includes('旧载具范围')))
  check('虚拟内部空间可独立大于旧外部形状', !validateFortressDef({ ...ring, interior: { cols: 4, rows: 4 } }).some(e => e.includes('内部空间')))
  check('炮位不在形状格被拒绝', validateFortressDef({ ...ring, hardpoints: [{ id: 'hpX', x: 1.5, y: 1.5, size: 'S' }] }).some(e => e.includes('炮位')))
  check('炮位类型限制全不勾被拒绝', validateFortressDef({ ...ring, hardpoints: [{ id: 'hpX', x: 1.5, y: 1.5, size: 'S', types: [] }] }).some(e => e.includes('类型限制')))
  check('耐久/移动速度取消旧区间限制',
    !validateFortressDef({ ...ring, hp: 1, speed: 0 }).some(e => e.includes('耐久') || e.includes('移动速度'))
    && !validateFortressDef({ ...ring, hp: 1e12, speed: 1e6 }).some(e => e.includes('耐久') || e.includes('移动速度')))
  check('耐久/移动速度仍拦截无效运行值',
    validateFortressDef({ ...ring, hp: 0 }).some(e => e.includes('耐久'))
    && validateFortressDef({ ...ring, speed: -1 }).some(e => e.includes('移动速度'))
    && validateFortressDef({ ...ring, hp: Number.POSITIVE_INFINITY }).some(e => e.includes('耐久'))
    && validateFortressDef({ ...ring, speed: Number.NaN }).some(e => e.includes('移动速度')))

  const bodyPixels = new Uint8ClampedArray(64 * 32 * 4)
  for (let y = 4; y < 28; y++) for (let x = 8; x < 56; x++) bodyPixels[(y * 64 + x) * 4 + 3] = 255
  const bodyCollision = bodyCollisionFromPixels(bodyPixels, 64, 32, 'test:body')
  check('主体透明边缘可生成中心相对凸轮廓', !!bodyCollision && bodyCollision.points.length === 4
    && Math.min(...bodyCollision.points.map(point => point.x)) === -0.75
    && Math.max(...bodyCollision.points.map(point => point.x)) === 0.75)
  check('主体轮廓可映射为格寻路兼容占位', !!bodyCollision && bodyCollisionCells({ w: 2, h: 1, bodyCollision }).size === 2)
  check('主体轮廓存在时忽略遗留 shape 的范围与连通校验', !!bodyCollision && !validateFortressDef({
    ...ring,
    w: 2,
    h: 1,
    bodyCollision,
    shape: ['0,0', '9,9'],
  }).some(error => error.includes('旧形状') || error.includes('旧载具范围')))

  // ③ 镂空占地/碰撞
  const typed: FortressDef = {
    id: 'test-typed', name: '测试类型', w: 3, h: 3,
    shape: ['0,0', '1,0', '2,0', '0,1', '1,1', '2,1', '0,2', '1,2', '2,2'],
    interior: { cols: 1, rows: 1 },
    hp: 1000, speed: 2, turnSpeed: 90, accel: 5, heatCap: 200, heatDissipation: 10,
    hardpoints: [{ id: 'hpT1', x: 1.5, y: 1.5, size: 'S', types: ['spray'] }], color: '#888888',
  }
  const special: FortressDef = {
    id: 'test-special', name: '测试特殊格', w: 4, h: 5,
    shape: (() => { const a: string[] = []; for (let x = 0; x < 4; x++) for (let y = 0; y < 5; y++) a.push(`${x},${y}`); return a })(),
    interior: { cols: 4, rows: 5 },
    interiorSpecials: [{ x: 0, y: 0, boost: 'cooling' }, { x: 0, y: 2, boost: 'produce' }],
    hp: 1500, speed: 1.5, turnSpeed: 80, accel: 4, heatCap: 200, heatDissipation: 10,
    hardpoints: [], color: '#888888',
  }
  FORTRESS_DEFS.push(ring, typed, special)

  s = arena()
  s.fortressDefId = 'test-ring'
  s.fortress.x = 10
  s.fortress.y = 12
  s.objects = []
  check('镂空堡垒占地格 = 形状格数（8）', fortressCells(s).length === 8, `n=${fortressCells(s).length}`)
  check('镂空格不属于堡垒阻挡', blockerAt(s, 11, 13)?.kind !== 'fortress', `${JSON.stringify(blockerAt(s, 11, 13))}`)
  check('形状格为堡垒格', blockerAt(s, 10, 12)?.kind === 'fortress')

  // 实心格碰撞挡停
  let s2 = arena()
  s2.fortressDefId = 'test-ring'
  s2.fortress.x = 10
  s2.fortress.y = 12
  s2.objects = [mkObj(9002, 14, 12)] // 顶行实心格路径
  s2.moveDir = { x: 1, y: 0 }
  s2 = run(s2, 0.5, 0.05)
  check('实心格碰撞挡停该轴', s2.fortress.x > 10 && s2.fortress.x <= 11.0001, `x=${s2.fortress.x.toFixed(3)}`)

  // 镂空碰撞语义：洞内小物体不挡移动（镂空 = 可骑跨）；对照满形被同一物体立即撞停
  const ring4: FortressDef = {
    ...ring, id: 'test-ring4', w: 4, h: 4,
    shape: (() => { const a: string[] = []; for (let x = 0; x < 4; x++) for (let y = 0; y < 4; y++) { if (x >= 1 && x <= 2 && y >= 1 && y <= 2) continue; a.push(`${x},${y}`) } return a })(),
  }
  const full4: FortressDef = {
    ...ring, id: 'test-full4', w: 4, h: 4,
    shape: (() => { const a: string[] = []; for (let x = 0; x < 4; x++) for (let y = 0; y < 4; y++) a.push(`${x},${y}`); return a })(),
  }
  FORTRESS_DEFS.push(ring4, full4)
  const holeRock: BattleObject = { id: 9003, kind: 'rock', x: 11.2, y: 13.2, w: 0.6, h: 0.6, hp: 100, maxHp: 100, blockMove: true, blockProjectile: true } as BattleObject
  s = arena()
  s.fortressDefId = 'test-ring4'
  s.fortress.x = 10
  s.fortress.y = 12
  s.objects = [holeRock]
  s.moveDir = { x: 0, y: -1 }
  const y0 = s.fortress.y
  s = run(s, 0.5, 0.05)
  check('镂空洞内物体不挡移动（可骑跨）', s.fortress.y < y0 - 0.3, `y=${s.fortress.y.toFixed(3)} (from ${y0})`)
  s2 = arena()
  s2.fortressDefId = 'test-full4'
  s2.fortress.x = 10
  s2.fortress.y = 12
  s2.objects = [{ ...holeRock, id: 9004 }]
  s2.moveDir = { x: 0, y: -1 }
  s2 = run(s2, 0.5, 0.05)
  check('满形被同一物体撞停（对照组）', s2.fortress.y === 12, `y=${s2.fortress.y.toFixed(3)}`)

  // ④ 炮位类型限制
  s = arena()
  s.fortressDefId = 'test-typed'
  s.phase = 'prep'
  const chkMg = canMountTurret(s, 'mg', 'hpT1') // 直射塔 vs 仅喷射炮位
  check('炮位类型限制：不兼容类型被拒', !chkMg.ok && (chkMg.reason ?? '').includes('类型'), chkMg.reason)
  check('炮位类型限制：兼容类型可挂', canMountTurret(s, 'spray', 'hpT1').ok)

  // ⑤ 模块特殊格加成（×1.5 / 生产间隔÷1.5）
  s = arena()
  s.fortressDefId = 'test-special'
  s.phase = 'prep'
  s = buildModule(s, 'radiator', 0, 0, 0) // 覆盖散热特殊格 (0,0)
  check('散热器特殊格：散热 ×1.5', Math.abs(moduleBonuses(s).coolingPool - 8 * 1.5) < 1e-9, `cool=${moduleBonuses(s).coolingPool}`)
  s = demolishModule(s, s.modules[s.modules.length - 1].id)
  s = buildModule(s, 'radiator', 3, 3, 0) // 普通格
  check('普通格无加成', Math.abs(moduleBonuses(s).coolingPool - 8) < 1e-9)
  s = buildModule(s, 'barracks', 0, 2, 0) // 覆盖生产特殊格 (0,2)
  const bk = s.modules.find(m => m.defId === 'barracks')!
  check('生产特殊格：产出间隔 ÷1.5', Math.abs(bk.timer - 8 / 1.5) < 1e-9, `timer=${bk.timer}`)

  // ⑥ 堡垒类型库：保存/出战/持久化/删除
  const store = new Map<string, string>()
  ;(globalThis as unknown as { localStorage: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
  }
  const libDef: FortressDef = { ...ring, id: 'test-lib', shape: [...ring.shape!], color: '#ff00ff' }
  check('保存自定义堡垒入注册表', saveCustomFortress(libDef) && FORTRESS_DEFS.some(f => f.id === 'test-lib'))
  check('载具占位颜色：保存时统一为固定 RGB(118,122,110)', FORTRESS_DEFS.find(f => f.id === 'test-lib')?.color === VEHICLE_PLACEHOLDER_COLOR)
  check('非法定义拒绝保存', !saveCustomFortress({} as FortressDef))
  setSelectedFortressId('test-lib')
  const s3 = initialState()
  check('出战堡垒生效于 initialState', s3.fortressDefId === 'test-lib' && s3.fortress.hp === libDef.hp && s3.fortress.maxHp === libDef.hp,
    `${s3.fortressDefId} hp=${s3.fortress.hp}`)
  const persisted = JSON.parse(store.get('td-fortress-lib-v1') ?? '{}') as { customs?: FortressDef[]; selectedId?: string }
  check('类型库持久化（customs+selectedId）', persisted.selectedId === 'test-lib' && (persisted.customs?.length ?? 0) === 1)
  check('载具占位颜色：持久化数据不保留旧自定义颜色', persisted.customs?.[0]?.color === VEHICLE_PLACEHOLDER_COLOR)
  setSelectedFortressId(DEFAULT_FORTRESS.id)
  check('删除自定义堡垒并回落默认出战', deleteCustomFortress('test-lib') && !FORTRESS_DEFS.some(f => f.id === 'test-lib') && getSelectedFortressId() === DEFAULT_FORTRESS.id)

  const legacyGear = structuredClone(DEFAULT_FORTRESS)
  legacyGear.id = 'test-legacy-running-gear'
  delete legacyGear.runningGearCoordinateSpace
  legacyGear.tracks = [{ id: 'legacy-track', x1: 0.5, y1: 0.5, x2: 0.5, y2: 7.5, radius: 0.5, tile: 'builtin:library/track01', overlapPx: 2 }]
  legacyGear.wheels = [{ id: 'legacy-wheel', x: 0.5, y: 1, unit: 'pair' }]
  saveCustomFortress(legacyGear)
  const migratedGear = FORTRESS_DEFS.find(def => def.id === legacyGear.id)!
  const migratedWheelPair = wheelPlacements(migratedGear, migratedGear.wheels![0])
  check('旧载具存档：左上原点履带/轮胎坐标自动迁移到几何原点', migratedGear.runningGearCoordinateSpace === 'centered'
    && migratedGear.tracks?.[0].x1 === -2 && migratedGear.tracks[0].y1 === 3.5
    && migratedGear.tracks[0].x2 === -2 && migratedGear.tracks[0].y2 === -3.5
    && migratedWheelPair[0].x === -2 && migratedWheelPair[1].x === 2 && migratedWheelPair.every(point => point.y === 3))
  deleteCustomFortress(legacyGear.id)
  delete (globalThis as unknown as { localStorage?: unknown }).localStorage

  // 清理测试堡垒定义
  for (const id of ['test-ring', 'test-typed', 'test-special', 'test-ring4', 'test-full4']) {
    const i = FORTRESS_DEFS.findIndex(f => f.id === id)
    if (i >= 0) FORTRESS_DEFS.splice(i, 1)
  }
  restoreLevel()
}


// ====== 用例57：内置堡垒直接编辑 / 内部自由格阵 / 特效点校验 ======
{
  const store = new Map<string, string>()
  ;(globalThis as unknown as { localStorage: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
  }

  // ⓪ 内置标准型（无显式 shape）本身通过校验（缺省满矩形）
  check('内置标准型缺省形状校验通过', validateFortressDef(FORTRESS_DEFS[0]).length === 0, validateFortressDef(FORTRESS_DEFS[0]).join(';'))

  // ① 内置堡垒可直接覆盖保存；删除覆盖 = 恢复出厂
  const factoryHp = FORTRESS_DEFS[0].hp
  const modded = structuredClone(FORTRESS_DEFS[0])
  modded.hp = 3456
  check('内置堡垒可直接覆盖保存', saveCustomFortress(modded) && FORTRESS_DEFS[0].hp === 3456)
  check('内置覆盖标记 isBuiltinFortressOverridden', isBuiltinFortressOverridden(DEFAULT_FORTRESS.id))
  check('删除内置覆盖 = 恢复出厂', deleteCustomFortress(DEFAULT_FORTRESS.id)
    && FORTRESS_DEFS[0].hp === factoryHp && !isBuiltinFortressOverridden(DEFAULT_FORTRESS.id))

  // ② 内部自由格阵（interiorCells）
  const carve: FortressDef = {
    id: 'test-icarve', name: '测试内部格阵', w: 5, h: 5,
    shape: (() => { const a: string[] = []; for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) a.push(`${x},${y}`); return a })(),
    interior: { cols: 3, rows: 3 },
    interiorCells: ['0,0', '1,0', '2,0', '0,1', '1,1'], // L 形内部空间（(2,1) 起全擦除）
    hp: 1200, speed: 1.5, turnSpeed: 80, accel: 4, heatCap: 200, heatDissipation: 10,
    hardpoints: [], color: '#888888',
  }
  check('内部自由格阵校验通过', validateFortressDef(carve).length === 0, validateFortressDef(carve).join(';'))
  check('内部格越出虚拟网格被拒', validateFortressDef({ ...carve, interiorCells: ['9,9'] }).some(e => e.includes('内部空间')))
  check('特殊格越出内部格阵被拒', validateFortressDef({ ...carve, interiorSpecials: [{ x: 2, y: 1, boost: 'hp' }] }).some(e => e.includes('特殊格')))
  FORTRESS_DEFS.push(carve)
  let s = arena()
  s.fortressDefId = 'test-icarve'
  s.phase = 'prep'
  check('内部自由格阵：格内可放模块', canPlaceModule(s, 'gyro', 0, 0, 0).ok)
  check('内部自由格阵：擦除格不可放', !canPlaceModule(s, 'gyro', 2, 1, 0).ok)
  check('内部自由格阵：跨擦除格的多格模块被拒', !canPlaceModule(s, 'ammo_factory', 1, 1, 0).ok) // v2.45 口令(5)：armor_plate 缩为 1×1 不再跨格，改用 2×2 兵工厂（覆盖擦除格 (2,1)）
  s = buildModule(s, 'gyro', 0, 0, 0)
  check('自由格阵内模块正常建造', s.modules.length === 1)

  // ③ 特效点校验
  check('特效点越出包围盒被拒', validateFortressDef({ ...carve, effects: [{ id: 'e1', x: 9, y: 9, kind: 'smoke', state: 'both' }] }).some(e => e.includes('特效点')))
  check('合法特效点通过', validateFortressDef({ ...carve, effects: [{ id: 'e1', x: 2.5, y: 4.5, kind: 'flame', state: 'move' }] }).length === 0)

  // 清理
  const i = FORTRESS_DEFS.findIndex(f => f.id === 'test-icarve')
  if (i >= 0) FORTRESS_DEFS.splice(i, 1)
  delete (globalThis as unknown as { localStorage?: unknown }).localStorage
  restoreLevel()
}

// ====== 用例58：堡垒库持久化失败标志（配额满/无存储环境时编辑器可警告） ======
{
  // ① setItem 抛错（模拟 localStorage 配额满）：保存仍成功（内存注册表），但失败标志置位
  ;(globalThis as unknown as { localStorage: unknown }).localStorage = {
    getItem: () => null,
    setItem: () => { throw new Error('QuotaExceededError') },
    removeItem: () => undefined,
  }
  const q: FortressDef = {
    id: 'test-quota', name: '测试配额', w: 3, h: 3,
    shape: ['0,0', '1,0', '2,0', '0,1', '1,1', '2,1', '0,2', '1,2', '2,2'],
    interior: { cols: 1, rows: 1 },
    hp: 1000, speed: 1.5, turnSpeed: 80, accel: 4, heatCap: 200, heatDissipation: 10,
    hardpoints: [], color: '#888888',
  }
  check('配额满时内存保存仍成功', saveCustomFortress(q) && FORTRESS_DEFS.some(f => f.id === 'test-quota'))
  check('配额满时持久化失败标志置位', fortressPersistFailed())

  // ② 正常存储：写入成功后标志清除
  const store = new Map<string, string>()
  ;(globalThis as unknown as { localStorage: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
  }
  saveCustomFortress(q)
  check('写入成功后失败标志清除', !fortressPersistFailed())

  // ③ 无存储环境：标志置位
  delete (globalThis as unknown as { localStorage?: unknown }).localStorage
  saveCustomFortress(q)
  check('无存储环境时失败标志置位', fortressPersistFailed())

  // 清理
  deleteCustomFortress('test-quota')
  const i = FORTRESS_DEFS.findIndex(f => f.id === 'test-quota')
  if (i >= 0) FORTRESS_DEFS.splice(i, 1)
  restoreLevel()
}

// ====== 用例59：最小转弯半径（弧线转向：转弯带动前行、本体随转） ======
{
  const DEG2 = Math.PI / 180
  const full3 = (() => { const a: string[] = []; for (let x = 0; x < 3; x++) for (let y = 0; y < 3; y++) a.push(`${x},${y}`); return a })()
  const arcDef: FortressDef = {
    id: 'test-arc', name: '测试弧线转向', w: 3, h: 3, shape: [...full3],
    interior: { cols: 1, rows: 1 },
    hp: 1000, speed: 2, turnSpeed: 90, turnRadius: 2, accel: 20, heatCap: 200, heatDissipation: 10,
    hardpoints: [], color: '#888888',
  }
  FORTRESS_DEFS.push(arcDef)

  // ① 校验：负值/超上限被拒；0 与缺省合法
  check('转向半径：负值被拒', validateFortressDef({ ...arcDef, turnRadius: -1 }).some(e => e.includes('转向半径')))
  check('转向半径：超 20 被拒', validateFortressDef({ ...arcDef, turnRadius: 21 }).some(e => e.includes('转向半径')))
  check('转弯半径：0 合法', validateFortressDef({ ...arcDef, turnRadius: 0 }).length === 0)
  check('转弯半径：缺省合法', validateFortressDef({ ...arcDef, turnRadius: undefined }).length === 0)

  // ②a v2.51 履带枢轴：静止且无油门单独按 A/D → 原地枢轴转向（角速度 = min(turnSpeed 90, 2×speed/trackWidth = 2×2/3 = 76.39°/s)），无位移
  // （v1.63「静止无效」方向盘语义移交轮式底盘，见下方 v2.51 轮式用例）
  let s = arena()
  s.fortressDefId = 'test-arc'
  s.phase = 'prep'
  s.turnDir = 1 // 静止单独按 D
  const c0x = s.fortress.x + 1.5
  const c0y = s.fortress.y + 1.5
  s = run(s, 2, 0.05)
  const pivotRate = Math.min(90, 2 * 2 / 3 / (Math.PI / 180)) // 76.394°/s
  check('v2.51 履带枢轴：静止按 D 原地转向（76.39°/s × 2s）', Math.abs(s.fortress.heading - pivotRate * 2 * Math.PI / 180) < 1e-6, `heading=${s.fortress.heading.toFixed(4)}rad`)
  check('v2.51 履带枢轴：原地转向无位移', Math.hypot(s.fortress.x + 1.5 - c0x, s.fortress.y + 1.5 - c0y) < 1e-9, `v=${Math.hypot(s.fortress.vx, s.fortress.vy).toFixed(3)}`)

  // ②b 行驶中（按住油门）A/D 仍为弧线转向（原语义）：满速 2 格/s + R=2 → ω=min(90°/s, 2/2)=1rad/s，转弯带动前行、绕外侧圆心
  s = arena()
  s.fortressDefId = 'test-arc'
  s.phase = 'prep'
  s.moveDir = { x: 0, y: -1 } // 油门按住（v1.64：无油门的移动=滑行转向，本用例须有油门才是弧线）
  s.moveMag = 1
  s.fortress.vy = -2 // 满速沿船头（heading=0 朝 -y；比率 1）
  s.turnDir = 1
  const b0x = s.fortress.x + 1.5
  const b0y = s.fortress.y + 1.5
  s = run(s, 1, 0.05)
  check('弧线转向：转速受 速度/R 约束（行驶中 1s 转 1rad≈57.3°）', Math.abs(s.fortress.heading - 1) < 1e-6, `heading=${s.fortress.heading.toFixed(4)}rad`)
  check('弧线转向：弧速不超速度上限（≤2）', Math.hypot(s.fortress.vx, s.fortress.vy) <= 2.0001, `v=${Math.hypot(s.fortress.vx, s.fortress.vy).toFixed(3)}`)
  check('弧线转向：转弯带动前行（非原地）', Math.hypot(s.fortress.x + 1.5 - b0x, s.fortress.y + 1.5 - b0y) > 1.5)
  const hm = s.fortress.heading
  const px = s.fortress.x + 1.5 - 2 * dirY(hm)
  const py = s.fortress.y + 1.5 + 2 * dirX(hm)
  s = run(s, 1, 0.05)
  check('弧线转向：稳态再转 1rad（总计 2rad）', Math.abs(s.fortress.heading - 2) < 1e-6, `heading=${s.fortress.heading.toFixed(4)}rad`)
  const rp = Math.hypot(s.fortress.x + 1.5 - px, s.fortress.y + 1.5 - py)
  check('弧线转向：绕外侧圆心（到圆心距离≈R=2）', Math.abs(rp - 2) < 0.15, `r=${rp.toFixed(3)}`)

  // ②c v2.51 履带滑行转向：松开油门后按 A/D 以恒定枢轴速率转向（履带动力转向不随滑行衰减；v1.64 衰减语义移交轮式）
  // test-coast：speed=2、turnSpeed=90°/s、R=2（滑行非弧线）、accel=20、brakeInertia=10 → 减速度 = 20×0.2 = 4 格/s²，满速 2 → 0.5s 停稳
  const coastDef: FortressDef = { ...arcDef, id: 'test-coast', brakeInertia: 10 }
  FORTRESS_DEFS.push(coastDef)
  let sc = arena()
  sc.fortressDefId = 'test-coast'
  sc.phase = 'prep'
  sc.moveDir = { x: 0, y: -1 }
  sc.moveMag = 1
  sc = run(sc, 1, 0.05) // 满速 2 格/s
  sc.moveDir = { x: 0, y: 0 } // 松开 W
  sc.turnDir = 1 // 滑行中按住 D
  sc = run(sc, 0.1, 0.05) // 枢轴速率恒 min(90, 76.394) = 76.394°/s
  const cEarly = sc.fortress.heading / DEG2
  check('v2.51 履带滑行转向：松油门后恒定枢轴速率（前 0.1s ≈7.64°）', Math.abs(cEarly - 76.394 * 0.1) < 0.15, `d=${cEarly.toFixed(2)}°`)
  const vMid = Math.hypot(sc.fortress.vx, sc.fortress.vy)
  check('v2.51 履带滑行转向：滑行不注入速度（v≤2 单调减速）', vMid <= 2.0001 && vMid > 1.3, `v=${vMid.toFixed(3)}`)
  sc = run(sc, 0.4, 0.05) // 余下 0.4s 停稳，转速不变
  const cTotal = sc.fortress.heading / DEG2
  check('v2.51 履带滑行转向：全程恒速转向（0.5s ≈38.2°）', Math.abs(cTotal - 76.394 * 0.5) < 0.3, `d=${cTotal.toFixed(2)}°`)
  check('v2.51 履带滑行转向：末段转速等于初段（恒定）', Math.abs((cTotal - cEarly) / 0.4 - cEarly / 0.1) < 1, `early=${cEarly.toFixed(2)} late=${(cTotal - cEarly).toFixed(2)}`)
  check('v2.51 履带滑行转向：速度归 0', Math.hypot(sc.fortress.vx, sc.fortress.vy) < 1e-9, `v=${Math.hypot(sc.fortress.vx, sc.fortress.vy).toFixed(4)}`)
  const cStop = sc.fortress.heading
  sc = run(sc, 1, 0.05) // 停稳后继续按 D → 履带原地枢轴继续转（76.394°/s）
  check('v2.51 履带滑行转向：速度归 0 后原地继续转（+76.39°）', Math.abs((sc.fortress.heading - cStop) / DEG2 - 76.394) < 0.3, `dh=${((sc.fortress.heading - cStop) / DEG2).toFixed(3)}°`)
  {
    const i = FORTRESS_DEFS.findIndex(f => f.id === 'test-coast')
    if (i >= 0) FORTRESS_DEFS.splice(i, 1)
  }

  // ③ v1.63：R=0 静止按下转向 → 静止无效门控同样生效（朝向不变、无位移；门控不区分转弯半径）
  const pivotDef: FortressDef = { ...arcDef, id: 'test-pivot0', turnRadius: 0 }
  FORTRESS_DEFS.push(pivotDef)
  let s2 = arena()
  s2.fortressDefId = 'test-pivot0'
  s2.phase = 'prep'
  s2.turnDir = 1
  const x20 = s2.fortress.x
  const y20 = s2.fortress.y
  s2 = run(s2, 1, 0.05)
  check('v2.51 半径0 履带：静止原地掉头(76.394°/s×1s)', Math.abs(s2.fortress.heading - 1.333333) < 1e-4, `h=${s2.fortress.heading.toFixed(4)}`)
  check('v1.63 半径0：静止无效无位移', s2.fortress.x === x20 && s2.fortress.y === y20)

  // ④ R=0 移动中转向 = 原有比率门控仍生效（满速 → 全速转向）
  let s3 = arena()
  s3.fortressDefId = 'test-pivot0'
  s3.phase = 'prep'
  s3.moveDir = { x: 0, y: -1 }
  s3.moveMag = 1
  s3 = run(s3, 2, 0.05) // 加速到满速
  s3.turnDir = 1
  s3 = run(s3, 0.5, 0.05)
  check('半径0：移动中转向按速度比率', s3.fortress.heading > 30 * DEG2 && s3.fortress.heading < 60 * DEG2, `heading=${(s3.fortress.heading / DEG2).toFixed(2)}°`)

  // 清理
  for (const id of ['test-arc', 'test-pivot0']) {
    const i = FORTRESS_DEFS.findIndex(f => f.id === id)
    if (i >= 0) FORTRESS_DEFS.splice(i, 1)
  }
  restoreLevel()
}

// ====== 用例59b：v2.51 运动学双底盘（轮式前轮转向 / 履带枢轴转向阻力 / 轮子落印列） ======
{
  const DEG2 = Math.PI / 180
  const full3w = (() => { const a: string[] = []; for (let x = 0; x < 3; x++) for (let y = 0; y < 3; y++) a.push(`${x},${y}`); return a })()
  const wheelDef: FortressDef = {
    id: 'test-wheel', name: '测试轮式底盘', w: 3, h: 3, shape: [...full3w],
    runningGearCoordinateSpace: 'centered',
    interior: { cols: 1, rows: 1 },
    hp: 1000, speed: 2, turnSpeed: 90, turnRadius: 0, accel: 20, heatCap: 200, heatDissipation: 10,
    hardpoints: [], color: '#888888', chassis: 'wheeled',
    wheels: [
      { id: 'wfl', x: -1, y: 0.7, r: 0.45, steered: true },
      { id: 'wfr', x: 1, y: 0.7, r: 0.45, steered: true },
      { id: 'wrl', x: -1, y: -0.7, r: 0.45 },
      { id: 'wrr', x: 1, y: -0.7, r: 0.45 },
    ],
  }
  FORTRESS_DEFS.push(wheelDef)

  // ⓪ 校验：底盘参数区间
  check('v2.51 校验：非法底盘类型被拒', validateFortressDef({ ...wheelDef, chassis: 'arcade' as unknown as 'tracked' }).some(e => e.includes('底盘类型')))
  check('v2.51 校验：履带间距 0/21 被拒', validateFortressDef({ ...wheelDef, chassis: 'tracked', trackWidth: 0 }).some(e => e.includes('履带间距')) && validateFortressDef({ ...wheelDef, chassis: 'tracked', trackWidth: 21 }).some(e => e.includes('履带间距')))
  check('v2.51 校验：转向阻力越界被拒', validateFortressDef({ ...wheelDef, chassis: 'tracked', turnDrag: -0.1 }).some(e => e.includes('转向阻力')) && validateFortressDef({ ...wheelDef, chassis: 'tracked', turnDrag: 0.91 }).some(e => e.includes('转向阻力')))
  check('v2.51 校验：轴距 0/31 被拒', validateFortressDef({ ...wheelDef, wheelbase: 0 }).some(e => e.includes('轴距')) && validateFortressDef({ ...wheelDef, wheelbase: 31 }).some(e => e.includes('轴距')))
  check('v2.51 校验：前轮转角 0/81 被拒', validateFortressDef({ ...wheelDef, steerMax: 0 }).some(e => e.includes('最大前轮转角')) && validateFortressDef({ ...wheelDef, steerMax: 81 }).some(e => e.includes('最大前轮转角')))
  check('v2.51 校验：方向盘转速 0/721 被拒', validateFortressDef({ ...wheelDef, steerRate: 0 }).some(e => e.includes('方向盘转速')) && validateFortressDef({ ...wheelDef, steerRate: 721 }).some(e => e.includes('方向盘转速')))
  check('v2.51 校验：附着上限 0/101 被拒', validateFortressDef({ ...wheelDef, gripMax: 0 }).some(e => e.includes('横向附着上限')) && validateFortressDef({ ...wheelDef, gripMax: 101 }).some(e => e.includes('横向附着上限')))
  check('v2.73 校验：轮胎单位非法值被拒', validateFortressDef({ ...wheelDef, wheels: [{ id: 'wb', x: 1, y: 1, unit: 'triple' as 'pair' }] }).some(e => e.includes('单位仅支持')))
  check('轮胎帧数校验：0、65 和小数均被拒', [0, 65, 1.5].every(frames =>
    validateFortressDef({ ...wheelDef, wheels: [{ id: 'wb', x: 1, y: 1, frames }] }).some(e => e.includes('帧数'))))
  check('v2.51 校验：合法轮式配置零报错', validateFortressDef(wheelDef).length === 0)

  // ① 静止无转向能力（方向盘语义）：静止按 D 1s → 前轮打到 35° 但朝向不变
  let sw = arena()
  sw.fortressDefId = 'test-wheel'
  sw.phase = 'prep'
  sw.turnDir = 1
  sw = run(sw, 1, 0.05)
  check('v2.51 轮式：静止按 D 朝向不变（无转向能力）', Math.abs(sw.fortress.heading) < 1e-9, `h=${sw.fortress.heading.toFixed(4)}`)
  check('v2.51 轮式：静止按 D 前轮仍打满 35°', Math.abs(sw.fortress.steerAngle - 35 * DEG2) < 1e-9, `δ=${(sw.fortress.steerAngle / DEG2).toFixed(3)}°`)

  // ② 松开 D 前轮自动回正（方向盘转速 120°/s，0.29s 归零），朝向不受影响
  sw.turnDir = 0
  sw = run(sw, 1, 0.05)
  check('v2.51 轮式：松手前轮自动回正', Math.abs(sw.fortress.steerAngle) < 1e-9 && Math.abs(sw.fortress.heading) < 1e-9, `δ=${(sw.fortress.steerAngle / DEG2).toFixed(3)}°`)

  // ③ 满速转向：横向附着钳制生效（grip 8 m/s² → tanδ_eff ≤ 0.144，稳态 ω≈0.16 rad/s，1s ≈ 8.91°）
  sw = arena()
  sw.fortressDefId = 'test-wheel'
  sw.phase = 'prep'
  sw.moveDir = { x: 0, y: -1 }
  sw.moveMag = 1
  sw.fortress.vy = -2 // 直接满速
  sw.turnDir = 1
  sw = run(sw, 1, 0.05)
  check('v2.51 轮式：满速转向受附着钳制（1s ≈8.91°）', Math.abs(sw.fortress.heading - 0.1555) < 0.01, `h=${(sw.fortress.heading / DEG2).toFixed(3)}°`)
  check('v2.51 轮式：稳态横摆 ≈0.16 rad/s（附着主导）', Math.abs(sw.fortress.turnW - 0.1618) < 0.01, `ω=${sw.fortress.turnW.toFixed(4)}`)
  // 高附着对照（grip 100 → 不钳制，1s ≈ 36.13°，约 4 倍）
  const gripDef: FortressDef = { ...wheelDef, id: 'test-wheel-grip', gripMax: 100 }
  FORTRESS_DEFS.push(gripDef)
  let sg = arena()
  sg.fortressDefId = 'test-wheel-grip'
  sg.phase = 'prep'
  sg.moveDir = { x: 0, y: -1 }
  sg.moveMag = 1
  sg.fortress.vy = -2
  sg.turnDir = 1
  sg = run(sg, 1, 0.05)
  check('v2.51 轮式：高附着对照不钳制（1s ≈36.13°，约 4 倍）', Math.abs(sg.fortress.heading - 0.6307) < 0.02 && sg.fortress.heading > 3 * sw.fortress.heading, `h=${(sg.fortress.heading / DEG2).toFixed(3)}°`)
  // turnSpeed 封顶（15°/s：高附着下 ω 被钳到 0.2618 rad/s）
  const capDef: FortressDef = { ...wheelDef, id: 'test-wheel-cap', gripMax: 100, turnSpeed: 15 }
  FORTRESS_DEFS.push(capDef)
  let sp = arena()
  sp.fortressDefId = 'test-wheel-cap'
  sp.phase = 'prep'
  sp.moveDir = { x: 0, y: -1 }
  sp.moveMag = 1
  sp.fortress.vy = -2
  sp.turnDir = 1
  sp = run(sp, 1, 0.05)
  check('v2.51 轮式：转向速度封顶（ω = 15°/s）', Math.abs(sp.fortress.turnW - 15 * DEG2) < 0.002 && Math.abs(sp.fortress.heading - 0.2504) < 0.01, `ω=${(sp.fortress.turnW / DEG2).toFixed(3)}°/s h=${(sp.fortress.heading / DEG2).toFixed(3)}°`)

  // ④ 倒退自然反向：倒车满速 1.6 格/s 按 D → ω = v·tanδ/L 自然为负（车头左甩 = 真车倒车车尾语义，无需翻转补丁）
  let sr = arena()
  sr.fortressDefId = 'test-wheel'
  sr.phase = 'prep'
  sr.reverse = true
  sr.moveMag = 1
  sr = run(sr, 1, 0.05) // 倒退满速 2×0.8
  sr.turnDir = 1
  sr = run(sr, 0.5, 0.05)
  check('v2.51 轮式：倒退按 D 车头自然左甩（h≈−5.26°）', sr.fortress.heading < 0 && Math.abs(sr.fortress.heading + 0.0918) < 0.01, `h=${(sr.fortress.heading / DEG2).toFixed(3)}°`)

  // ⑤ 滑行转向随速度衰减（松 W 按 D：vLon→0 则 ω→0，停稳后不再转——涌现的方向盘语义）
  const wheelCoast: FortressDef = { ...wheelDef, id: 'test-wheel-coast', brakeInertia: 10 }
  FORTRESS_DEFS.push(wheelCoast)
  let sk = arena()
  sk.fortressDefId = 'test-wheel-coast'
  sk.phase = 'prep'
  sk.moveDir = { x: 0, y: -1 }
  sk.moveMag = 1
  sk.fortress.vy = -2
  sk.moveDir = { x: 0, y: 0 }
  sk.moveMag = 0
  sk.turnDir = 1
  sk = run(sk, 0.6, 0.05) // 刹停惯性 10 → 减速 4 格/s²，0.5s 停稳
  check('v2.51 轮式滑行转向：转速随速度衰减（0.6s ≈5.40°）', Math.abs(sk.fortress.heading - 0.0943) < 0.01, `h=${(sk.fortress.heading / DEG2).toFixed(3)}°`)
  check('v2.51 轮式滑行转向：速度归 0', Math.hypot(sk.fortress.vx, sk.fortress.vy) < 1e-9)
  const hStop = sk.fortress.heading
  sk = run(sk, 0.5, 0.05)
  check('v2.51 轮式滑行转向：停稳后不再转', sk.fortress.heading === hStop, `dh=${((sk.fortress.heading - hStop) / DEG2).toFixed(4)}°`)

  // ⑥ 履带转向阻力（turnDrag 0.5）：转向输入期间目标速度减半，松开恢复
  const dragDef: FortressDef = { ...wheelDef, id: 'test-drag', chassis: 'tracked', wheels: undefined, turnDrag: 0.5 }
  FORTRESS_DEFS.push(dragDef)
  let sd = arena()
  sd.fortressDefId = 'test-drag'
  sd.phase = 'prep'
  sd.moveDir = { x: 0, y: -1 }
  sd.moveMag = 1
  sd.turnDir = 1
  sd = run(sd, 1, 0.05)
  check('v2.51 履带转向阻力：转向中极速减半（2→1）', Math.abs(Math.hypot(sd.fortress.vx, sd.fortress.vy) - 1) < 0.05, `v=${Math.hypot(sd.fortress.vx, sd.fortress.vy).toFixed(3)}`)
  check('v2.51 履带转向阻力：转向中仍按枢轴速率转向', Math.abs(sd.fortress.heading - 76.394 * DEG2) < 0.02, `h=${(sd.fortress.heading / DEG2).toFixed(2)}°`)
  sd.turnDir = 0
  sd = run(sd, 1, 0.05)
  check('v2.51 履带转向阻力：松开转向恢复满速 2', Math.abs(Math.hypot(sd.fortress.vx, sd.fortress.vy) - 2) < 0.05, `v=${Math.hypot(sd.fortress.vx, sd.fortress.vy).toFixed(3)}`)

  // ⑦ 轮子落印列（fortressMarkColumns）：纯轮式 4 轮 = 4 列；半履带布局 1 履带×2 + 2 轮 = 4 列
  check('v2.51 落印列：纯轮式 4 轮 = 4 列', fortressMarkColumns(wheelDef).length === 4)
  const pairWheel = { id: 'pair-front', x: -1, y: 0.7, unit: 'pair' as const, sprite: 'builtin:library/track01', steered: true }
  const pairDef: FortressDef = { ...wheelDef, id: 'test-wheel-pair', wheels: [pairWheel] }
  const pairPlaced = wheelPlacements(pairDef, pairWheel)
  check('轮胎单位“对”：几何原点左侧 x=-1 自动镜像到 x=1',
    pairPlaced.length === 2 && pairPlaced[0].x === -1 && pairPlaced[1].x === 1 && pairPlaced.every(p => p.y === 0.7))
  const pairFromRight = wheelPlacements(pairDef, { ...pairWheel, x: 1 })
  check('成对轮胎素材朝向：即使从右侧定义，也固定左轮原图、右轮水平反置',
    pairFromRight[0].x === -1 && !pairFromRight[0].mirror && pairFromRight[1].x === 1 && pairFromRight[1].mirror)
  const pairCols = fortressMarkColumns(pairDef)
  check('v2.73 成对轮胎落印：一条定义展开左右两列且使用原图零重叠步长',
    pairCols.length === 2 && pairCols.every(c => c.overlapPx === 0))
  check('左右对称贴图：成对轮胎的复制侧与落印标记为水平镜像',
    pairCols[0].spriteMirror === false && pairCols[1].spriteMirror === true)
  const wheelCircumference = 16 / BASE_CELL * Math.PI
  check('轮胎横向帧条：单帧素材始终停在第 0 帧', wheelRollFrame(999, 1, 16) === 0)
  check('轮胎横向帧条：前进按周长推进并在一周后循环',
    wheelRollFrame(wheelCircumference / 8 * 1.1, 8, 16) === 1 && wheelRollFrame(wheelCircumference, 8, 16) === 0)
  check('轮胎横向帧条：倒退时反向选帧', wheelRollFrame(-wheelCircumference / 8 * 0.1, 8, 16) === 7)
  check('内置吉普轮胎旧配置自动迁移为 4 帧，显式帧数优先',
    wheelFrameCount({ sprite: 'builtin:vehicle/jeep/wheel' }) === 4 && wheelFrameCount({ sprite: 'builtin:vehicle/jeep/wheel', frames: 2 }) === 2)
  const steerVisualState = arena()
  steerVisualState.fortress.vy = -2
  steerVisualState.fortress.turnW = 0.2
  const steerVisualDef: FortressDef = { ...pairDef, wheelbase: 2, turnRadius: 4 }
  check('v2.74 轮胎旋转“是”：偏角按 atan(轴距/配置转弯半径) 计算',
    Math.abs(wheelVisualSteerAngle(steerVisualState, steerVisualDef) - Math.atan(0.5)) < 1e-9)
  steerVisualState.fortress.turnW = 0
  check('v2.74 非转弯状态：轮胎视觉偏角归零', wheelVisualSteerAngle(steerVisualState, steerVisualDef) === 0)
  const halfDef: FortressDef = { ...wheelDef, id: 'test-half', chassis: 'halfTracked', wheels: [wheelDef.wheels![0], wheelDef.wheels![1]],
    tracks: [{ id: 'tk0', x1: -1.1, y1: 0.2, x2: -1.1, y2: -0.9, radius: 0.4, tile: 'builtin:library/track01', overlapPx: 2 }] }
  FORTRESS_DEFS.push(halfDef)
  check('半履带校验：前轮和后履带同时存在时合法', validateFortressDef(halfDef).length === 0, validateFortressDef(halfDef).join(';'))
  check('半履带校验：缺少前轮或后履带时拒绝保存',
    validateFortressDef({ ...halfDef, wheels: undefined }).some(error => error.includes('同时配置'))
    && validateFortressDef({ ...halfDef, tracks: undefined }).some(error => error.includes('同时配置')))
  check('v2.51 落印列：半履带布局 1 履带×2 + 2 轮 = 4 列', fortressMarkColumns(halfDef).length === 4)
  let sh = arena()
  sh.fortressDefId = 'test-half'
  sh.phase = 'prep'
  sh.turnDir = 1
  sh = run(sh, 0.5, 0.05)
  check('半履带运动：静止转向时前轮打角且后履带差速带动车身', sh.fortress.steerAngle > 0 && sh.fortress.heading > 0,
    `steer=${(sh.fortress.steerAngle / DEG2).toFixed(2)}° heading=${(sh.fortress.heading / DEG2).toFixed(2)}°`)
  sh.moveDir = { x: 0, y: -1 }
  sh.moveMag = 1
  sh = run(sh, 1, 0.05)
  check('半履带运动：行驶转向同时推进全部履带与前轮相位', Math.hypot(sh.fortress.vx, sh.fortress.vy) > 0.5
    && sh.fortress.trackPhase.length === 4 && sh.fortress.trackPhase.some((phase, index) => index > 0 && Math.abs(phase - sh.fortress.trackPhase[0]) > 0.01),
    `v=${Math.hypot(sh.fortress.vx, sh.fortress.vy).toFixed(2)} phases=${sh.fortress.trackPhase.map(value => value.toFixed(2)).join(',')}`)
  let sm = arena()
  sm.fortressDefId = 'test-wheel'
  sm.phase = 'prep'
  sm.moveDir = { x: 0, y: -1 }
  sm.moveMag = 1
  sm.fortress.vy = -2
  sm = run(sm, 1, 0.05)
  check('v2.51 落印列：trackPhase 长度自适应 = 4', sm.fortress.trackPhase.length === 4, `n=${sm.fortress.trackPhase.length}`)
  check('v2.51 落印列：直行 1s 各轮相位 = 2 格', Math.abs(sm.fortress.trackPhase[0] - 2) < 1e-6 && Math.abs(sm.fortress.trackPhase[3] - 2) < 1e-6, `p=${sm.fortress.trackPhase.map(p => p.toFixed(3)).join(',')}`)

  // 清理
  for (const id of ['test-wheel', 'test-wheel-grip', 'test-wheel-cap', 'test-wheel-coast', 'test-drag', 'test-half']) {
    const i = FORTRESS_DEFS.findIndex(f => f.id === id)
    if (i >= 0) FORTRESS_DEFS.splice(i, 1)
  }
  restoreLevel()
}

// ====== 用例60：摇杆目标朝向（desiredHeading 速率追踪） ======
{
  const DEG2 = Math.PI / 180

  // ⓪ 初始状态无摇杆朝向指令
  check('初始 desiredHeading 为 null', initialState().desiredHeading === null)

  // ① 满速移动中摇杆推向正右（90°）→ 满速率转向，1s 整好转到 90°
  let s = arena()
  s.phase = 'prep'
  s.moveDir = { x: 0, y: -1 }
  s.moveMag = 1
  s = run(s, 3, 0.05) // 加速到满速（加速度 0.8 → 2.5s 满速）
  s.desiredHeading = 15 * DEG2
  s = run(s, 1, 0.05)
  check('摇杆朝向：转向 25°/s，1s 内进入 15° 目标的 3° 死区（12.5°）', Math.abs(s.fortress.heading - 12.5 * DEG2) < 1e-9, `heading=${(s.fortress.heading / DEG2).toFixed(3)}°`) // v1.54
  // ② 到位即停：15° 需 2.62s，再跑 2.5s 后停在 3° 防抖动死区内（不超调）
  s = run(s, 2.5, 0.05)
  const diff60 = wrapAngle(s.fortress.heading - 15 * DEG2)
  check('摇杆朝向：到位即停不超调（3° 死区内）', diff60 <= 1e-9 && diff60 > -3.5 * DEG2, `heading=${(s.fortress.heading / DEG2).toFixed(3)}° diff=${(diff60 / DEG2).toFixed(3)}°`)
  const hStop60 = s.fortress.heading
  s = run(s, 1, 0.05)
  check('摇杆朝向：死区内保持不动（防抖动）', s.fortress.heading === hStop60, `h=${(s.fortress.heading / DEG2).toFixed(3)}°`)
  // v1.56 到位后再松手无过渡（死区期间角速度已清零，不产生惯性摆动）
  s.desiredHeading = null
  s = run(s, 1, 0.05)
  check('v1.56 到位后松手无过渡（heading 不变、turnW=0）', s.fortress.heading === hStop60 && s.fortress.turnW === 0)

  // ③ 出厂 R=20 + 摇杆朝向（无移动输入）→ 弧线转向生效，1s 转 0.1rad
  let s2 = arena()
  s2.phase = 'prep'
  s2.desiredHeading = 90 * DEG2
  s2 = run(s2, 1, 0.05)
  check('摇杆朝向：出厂静止弧线转向（转向 25°/s，1s = 25°）', Math.abs(s2.fortress.heading - 25 * DEG2) < 1e-9, `h=${(s2.fortress.heading / DEG2).toFixed(3)}°`) // v1.54

  // ③b v1.56 摇杆弧转中途松手：转向角速度指数衰减过渡（≈+5.4°）后停稳
  s2.desiredHeading = null
  const hRel2 = s2.fortress.heading
  s2 = run(s2, 0.1, 0.05)
  check('v1.56 摇杆松手过渡：0.1s 内仍在惯性右转', s2.fortress.heading > hRel2 + 0.5 * DEG2, `Δ=${((s2.fortress.heading - hRel2) / DEG2).toFixed(2)}°`)
  s2 = run(s2, 2, 0.05)
  const extra2 = (s2.fortress.heading - hRel2) / DEG2
  check('v1.56 摇杆松手过渡：衰减归零、额外摆动 ≈+5.4°（4~7）', s2.fortress.turnW === 0 && extra2 > 4 && extra2 < 7, `extra=${extra2.toFixed(2)}°`)
  const hDone2 = s2.fortress.heading
  s2 = run(s2, 1, 0.05)
  check('v1.56 摇杆松手过渡：完成后船头稳定', s2.fortress.heading === hDone2)

  // ④ R=2 + 摇杆朝向（静止）→ 弧线转向：全速转且带动前行
  const full3b = (() => { const a: string[] = []; for (let x = 0; x < 3; x++) for (let y = 0; y < 3; y++) a.push(`${x},${y}`); return a })()
  const arcDef2: FortressDef = {
    id: 'test-arc2', name: '测试摇杆弧线', w: 3, h: 3, shape: [...full3b],
    interior: { cols: 1, rows: 1 },
    hp: 1000, speed: 2, turnSpeed: 90, turnRadius: 2, accel: 20, heatCap: 200, heatDissipation: 10,
    hardpoints: [], color: '#888888',
  }
  FORTRESS_DEFS.push(arcDef2)
  let s3 = arena()
  s3.fortressDefId = 'test-arc2'
  s3.phase = 'prep'
  const x30 = s3.fortress.x
  const y30 = s3.fortress.y
  s3.desiredHeading = 90 * DEG2
  s3 = run(s3, 1, 0.05)
  check('摇杆弧线转向：静止 1s 转 1rad（速度/R 约束）', Math.abs(wrapAngle(s3.fortress.heading - 1)) < 1e-9, `heading=${s3.fortress.heading.toFixed(4)}rad`)
  check('摇杆弧线转向：转弯带动前行', Math.hypot(s3.fortress.x - x30, s3.fortress.y - y30) > 1.5)

  // ⑤ 摇杆反向（左侧 -90°）：向右转为负方向
  let s4 = arena()
  s4.phase = 'prep'
  s4.moveDir = { x: 0, y: -1 }
  s4.moveMag = 1
  s4 = run(s4, 3, 0.05)
  s4.desiredHeading = -15 * DEG2
  s4 = run(s4, 1, 0.05)
  check('摇杆朝向：左推 1s 进入 -15° 目标的 3° 死区（-12.5°）', Math.abs(s4.fortress.heading + 12.5 * DEG2) < 1e-9, `heading=${(s4.fortress.heading / DEG2).toFixed(3)}°`) // v1.54

  // 清理
  const i = FORTRESS_DEFS.findIndex(f => f.id === 'test-arc2')
  if (i >= 0) FORTRESS_DEFS.splice(i, 1)
  restoreLevel()
}

// ====== 用例61：倒退模式（摇杆水平以下）与倒退系数 ======
{
  // ① 校验：越界被拒；0.8 与缺省合法（标准型已内置 0.8）
  check('倒退系数：负值被拒', validateFortressDef({ ...FORTRESS_DEFS[0], reverseFactor: -0.1 }).some(e => e.includes('倒退系数')))
  check('倒退系数：超 1 被拒', validateFortressDef({ ...FORTRESS_DEFS[0], reverseFactor: 1.5 }).some(e => e.includes('倒退系数')))
  check('倒退系数：0.8 合法', validateFortressDef({ ...FORTRESS_DEFS[0], reverseFactor: 0.8 }).length === 0)

  // ② 倒退：静止 → 沿船头反方向（船头朝上=向下）加速，极速 = 1.6×0.8=1.28
  let s = arena()
  s.phase = 'prep'
  // 移到战场中段，隔离倒退运动学与关卡起点/世界边界语义。
  s.fortress.y = (LEVEL.rows - fortressDef(s).h) / 2
  const h0 = s.fortress.heading
  const y0 = s.fortress.y
  s.reverse = true
  s.moveMag = 1
  s = run(s, 0.05, 0.05) // 单 tick：v = accel×rf×dt = 0.8×0.8×0.05 = 0.032
  check('倒退：加速度 × 系数（首 tick v=3×0.8×0.05=0.12）', Math.abs(Math.hypot(s.fortress.vx, s.fortress.vy) - 0.12) < 1e-9, `v=${Math.hypot(s.fortress.vx, s.fortress.vy)}`) // v1.54
  s = run(s, 4, 0.05)
  check('倒退：极速 = 前进×0.8（4.8）', Math.abs(Math.hypot(s.fortress.vx, s.fortress.vy) - 4.8) < 1e-6, `v=${Math.hypot(s.fortress.vx, s.fortress.vy)}`) // v1.54
  check('倒退：沿船头反方向（向下，y 增大）', s.fortress.y > y0 && Math.abs(s.fortress.vx) < 1e-9 && s.fortress.vy > 0)
  check('倒退：朝向不变', s.fortress.heading === h0)

  // ③ 倒退中可随摇杆朝向转向（旧行为"不转向"已按需求变更；转速 × 倒退系数）
  let s3 = arena()
  s3.phase = 'prep'
  s3.reverse = true
  s3.moveMag = 1
  s3.desiredHeading = 90 * (Math.PI / 180)
  s3 = run(s3, 3, 0.05)
  check('倒退：摇杆朝向可转向（朝向>8°）', s3.fortress.heading > 8 * (Math.PI / 180), `heading=${(s3.fortress.heading / (Math.PI / 180)).toFixed(2)}°`)

  // ④ 系数 1 = 倒退极速与前进一致
  const rev1: FortressDef = { ...FORTRESS_DEFS[0], id: 'test-rev1', reverseFactor: 1 }
  FORTRESS_DEFS.push(rev1)
  let s4 = arena()
  s4.fortressDefId = 'test-rev1'
  s4.phase = 'prep'
  s4.reverse = true
  s4.moveMag = 1
  s4 = run(s4, 4, 0.05)
  check('倒退系数1：极速 = 前进极速（6）', Math.abs(Math.hypot(s4.fortress.vx, s4.fortress.vy) - 6) < 1e-6, `v=${Math.hypot(s4.fortress.vx, s4.fortress.vy)}`) // v1.54

  // ⑤ 前进不受倒退系数影响（对照）
  let s5 = arena()
  s5.phase = 'prep'
  s5.moveDir = { x: 0, y: -1 }
  s5.moveMag = 1
  s5 = run(s5, 3, 0.05)
  check('前进：极速不受倒退系数影响（6）', Math.abs(Math.hypot(s5.fortress.vx, s5.fortress.vy) - 6) < 1e-6) // v1.54

  // 清理
  const i = FORTRESS_DEFS.findIndex(f => f.id === 'test-rev1')
  if (i >= 0) FORTRESS_DEFS.splice(i, 1)
  restoreLevel()
}

// ====== 用例62：刹停惯性（减速度 = 加速度 × 惯性倍率） ======
{
  // ① 校验：越界被拒；1/5/10 合法
  check('刹停惯性：0 被拒', validateFortressDef({ ...FORTRESS_DEFS[0], brakeInertia: 0 }).some(e => e.includes('刹停惯性')))
  check('刹停惯性：11 被拒', validateFortressDef({ ...FORTRESS_DEFS[0], brakeInertia: 11 }).some(e => e.includes('刹停惯性')))
  check('刹停惯性：5 合法', validateFortressDef({ ...FORTRESS_DEFS[0], brakeInertia: 5 }).length === 0)

  const in1: FortressDef = { ...FORTRESS_DEFS[0], id: 'test-in1', brakeInertia: 1 }   // 减速度 3×
  const in10: FortressDef = { ...FORTRESS_DEFS[0], id: 'test-in10', brakeInertia: 10 } // 减速度 1/5×
  FORTRESS_DEFS.push(in1, in10)

  const fullSpeed = (id?: string) => {
    const s = arena()
    if (id) s.fortressDefId = id
    s.phase = 'prep'
    s.moveDir = { x: 0, y: -1 }
    s.moveMag = 1
    return run(s, 3, 0.05) // 满速 2（加速度 0.8 → 2.5s）
  }

  // ② 惯性 5（标准型默认）：单 tick 减速 Δv = accel×dt = 0.15（与加速度相同）
  let s = fullSpeed()
  s.moveDir = { x: 0, y: 0 }
  s = run(s, 0.05, 0.05)
  check('惯性4（出厂）：减速度=1.5×加速度（单tick Δv=0.225）', Math.abs(Math.hypot(s.fortress.vx, s.fortress.vy) - 5.775) < 1e-9, `v=${Math.hypot(s.fortress.vx, s.fortress.vy)}`) // v1.54

  // ③ 惯性 1：减速度 3×（单 tick Δv=0.45）；约 0.2s 停稳
  let s1 = fullSpeed('test-in1')
  s1.moveDir = { x: 0, y: 0 }
  s1 = run(s1, 0.05, 0.05)
  check('惯性1：减速度=3×加速度（单tick Δv=0.45）', Math.abs(Math.hypot(s1.fortress.vx, s1.fortress.vy) - 5.55) < 1e-9, `v=${Math.hypot(s1.fortress.vx, s1.fortress.vy)}`) // v1.54
  s1 = run(s1, 0.85, 0.05) // 停稳需 2÷(3×0.8)≈0.83s
  check('惯性1：0.9s 内停稳', Math.hypot(s1.fortress.vx, s1.fortress.vy) === 0)

  // ④ 惯性 10：减速度 1/5×（单 tick Δv=0.03）；1s 后 v=1.0（还在滑行）
  let s10 = fullSpeed('test-in10')
  s10.moveDir = { x: 0, y: 0 }
  s10 = run(s10, 0.05, 0.05)
  check('惯性10：减速度=1/5×加速度（单tick Δv=0.03）', Math.abs(Math.hypot(s10.fortress.vx, s10.fortress.vy) - 5.97) < 1e-9, `v=${Math.hypot(s10.fortress.vx, s10.fortress.vy)}`) // v1.54
  s10 = run(s10, 0.95, 0.05)
  check('惯性10：1s 后仍在滑行（v=5.4）', Math.abs(Math.hypot(s10.fortress.vx, s10.fortress.vy) - 5.4) < 1e-9, `v=${Math.hypot(s10.fortress.vx, s10.fortress.vy)}`) // v1.54

  // ⑤ 加速不受惯性影响：惯性10 从静止单 tick 仍 Δv=0.15
  let sa = arena()
  sa.fortressDefId = 'test-in10'
  sa.phase = 'prep'
  sa.moveDir = { x: 0, y: -1 }
  sa.moveMag = 1
  sa = run(sa, 0.05, 0.05)
  check('惯性10：加速不受影响（单tick Δv=0.15）', Math.abs(Math.hypot(sa.fortress.vx, sa.fortress.vy) - 0.15) < 1e-9, `v=${Math.hypot(sa.fortress.vx, sa.fortress.vy)}`) // v1.54

  // 清理
  for (const id of ['test-in1', 'test-in10']) {
    const i = FORTRESS_DEFS.findIndex(f => f.id === id)
    if (i >= 0) FORTRESS_DEFS.splice(i, 1)
  }
  restoreLevel()
}

// ====== 用例63：倒退转向（转速/半径同前进 × 倒退系数） ======
{
  const DEG2 = Math.PI / 180

  // ① 倒退转向受倒退系数减益：前进满速 1s 转 90° vs 倒退满速 1s ≈ 90×0.8(速度比率)×0.8(系数)=57.6°
  let sf = arena()
  sf.phase = 'prep'
  sf.moveDir = { x: 0, y: -1 }
  sf.moveMag = 1
  sf = run(sf, 3, 0.05) // 前进满速
  sf.desiredHeading = 180 * DEG2 // 目标 180°（1s 内不会到位，避免钳制；v1.48 起摇杆半球门控使 >90° 目标不再由摇杆产生，此处直接写状态验证弧线物理）
  sf = run(sf, 1, 0.05)
  const fwdTurn = sf.fortress.heading
  check('前进转向基准：满速 1s 转 25°（转向 25°/s）', Math.abs(fwdTurn - 25 * DEG2) < 1e-6, `fwd=${(fwdTurn / DEG2).toFixed(2)}°`) // v1.54

  let sr = arena()
  sr.phase = 'prep'
  sr.reverse = true
  sr.moveMag = 1
  sr = run(sr, 4, 0.05) // 倒退满速 1.6（速度比率 0.8）
  sr.desiredHeading = 180 * DEG2
  sr = run(sr, 1, 0.05)
  const revTurn = sr.fortress.heading
  check('倒退转向：1s 转角 = 前进×倒退系数（20°）', Math.abs(revTurn - 25 * DEG2 * 0.8) < 1e-6, `rev=${(revTurn / DEG2).toFixed(2)}°`) // v1.54
  check('倒退转向：转角比率 ≈ 倒退系数（弧线角速度不受速度比率影响）', Math.abs(revTurn / fwdTurn - 0.8) < 1e-6, `ratio=${(revTurn / fwdTurn).toFixed(3)}`)

  // ② 倒退弧线（R=2）：角速度 = turnSpeed × 倒退系数（全速 72°/s），船尾先行
  const full3c = (() => { const a: string[] = []; for (let x = 0; x < 3; x++) for (let y = 0; y < 3; y++) a.push(`${x},${y}`); return a })()
  const arcRev: FortressDef = {
    id: 'test-arcrev', name: '测试倒退弧线', w: 3, h: 3, shape: [...full3c],
    interior: { cols: 1, rows: 1 },
    hp: 1000, speed: 2, turnSpeed: 90, turnRadius: 2, reverseFactor: 0.8, accel: 20, heatCap: 200, heatDissipation: 10,
    hardpoints: [], color: '#888888',
  }
  FORTRESS_DEFS.push(arcRev)
  let sa = arena()
  sa.fortressDefId = 'test-arcrev'
  sa.phase = 'prep'
  sa.reverse = true
  sa.moveMag = 1
  sa.desiredHeading = 180 * DEG2
  const xa0 = sa.fortress.x
  const ya0 = sa.fortress.y
  sa = run(sa, 1, 0.05)
  check('倒退弧线：转速 = min(转向速度, 速度/R) × 倒退系数（1s 转 0.8rad）', Math.abs(sa.fortress.heading - 0.8) < 1e-6, `heading=${sa.fortress.heading.toFixed(4)}rad`)
  const vdot = sa.fortress.vx * dirX(sa.fortress.heading) + sa.fortress.vy * dirY(sa.fortress.heading)
  check('倒退弧线：速度沿船尾方向（与船头反向）', vdot < 0, `dot=${vdot.toFixed(3)}`)
  check('倒退弧线：转弯带动移动', Math.hypot(sa.fortress.x - xa0, sa.fortress.y - ya0) > 1)

  // ③ 倒退中 A/D 键盘转向以车尾为准（v1.63 翻转语义，系数减益不变）
  let sq = arena()
  sq.phase = 'prep'
  sq.reverse = true
  sq.moveMag = 1
  sq = run(sq, 4, 0.05)
  sq.turnDir = 1 // D：倒退时车尾朝右 = 船头向左 = heading −20°
  sq = run(sq, 1, 0.05)
  const qTurn = sq.fortress.heading
  check('倒退 D：车尾朝右（船头 −20°，受倒退系数减益）', Math.abs(qTurn + 25 * DEG2 * 0.8) < 1e-6, `q=${(qTurn / DEG2).toFixed(2)}°`)
  sq.turnDir = -1 // A：倒退时车尾朝左 = 船头向右 = heading 回正
  sq = run(sq, 1, 0.05)
  const qTurn2 = sq.fortress.heading
  check('倒退 A：车尾朝左（船头 +20° 回正）', Math.abs(qTurn2) < 1e-6, `q=${(qTurn2 / DEG2).toFixed(2)}°`)

  // ④ v1.66 倒退中松开后退键滑行：转向方向保持车尾语义（按实际倒行速度判定），不突变
  sq.turnDir = 0
  sq.reverse = false // 松开 S（键盘 applyKeys 行为：moveDir 清零、reverse 复位）
  sq.moveMag = 0
  const vBack = -(sq.fortress.vx * dirX(sq.fortress.heading) + sq.fortress.vy * dirY(sq.fortress.heading)) // 倒行速率 >0
  sq.turnDir = -1 // 倒行滑行中按住 A
  const hR0 = sq.fortress.heading
  sq = run(sq, 0.5, 0.05)
  const dhR = sq.fortress.heading - hR0
  check('v1.66 倒退滑行按 A：保持车尾朝左（heading 继续 +，不突变）', vBack > 0.3 && dhR > 0.01, `vBack=${vBack.toFixed(2)} dh=${(dhR / DEG2).toFixed(2)}°`)
  sq.turnDir = 0
  sq.reverse = true
  sq.moveMag = 1
  sq = run(sq, 2, 0.05) // 重新倒退到速度
  sq.reverse = false
  sq.moveMag = 0 // 再次松开 S
  sq.turnDir = 1 // 倒行滑行中按住 D
  const hR2 = sq.fortress.heading
  sq = run(sq, 0.5, 0.05)
  check('v1.66 倒退滑行按 D：保持车尾朝右（heading 继续 −，不突变）', sq.fortress.heading < hR2 - 0.005, `dh=${((sq.fortress.heading - hR2) / DEG2).toFixed(2)}°`)

  // 清理
  const i = FORTRESS_DEFS.findIndex(f => f.id === 'test-arcrev')
  if (i >= 0) FORTRESS_DEFS.splice(i, 1)
  restoreLevel()
}

// ====== 用例64：标准堡垒出厂默认参数（用户实战参数固化） ======
{
  const f0 = FORTRESS_DEFS[0]
  check('出厂默认：血量2000', f0.hp === 2000)
  check('出厂默认：移动速度 6', f0.speed === 6) // v1.54
  check('出厂默认：转向速度 25', f0.turnSpeed === 25) // v1.54
  check('出厂默认：转弯半径 10', f0.turnRadius === 10) // v1.54
  check('出厂默认：倒退系数 0.8', f0.reverseFactor === 0.8)
  check('出厂默认：刹停惯性 4', f0.brakeInertia === 4)
  check('出厂默认：加速度 3', f0.accel === 3) // v1.54
  check('出厂默认：通过校验', validateFortressDef(f0).length === 0, validateFortressDef(f0).join(';'))
}

// ====== 用例65：车身俯仰（v1.43 加速度反向映射：启动后倾/匀速回正/刹停前倾/倒车镜像/转向侧倾/增益0关闭/校验） ======
{
  // 标准堡垒：accel=0.8、极速2、brakeInertia=4（刹停减速 0.8×1.5=1.2）；pitchGain 默认 4 → k=2 px/(格/s²)，上限 ±4px
  // ① 启动加速后倾：朝船头方向（上）加速，aLon=+0.8 → 位移朝船尾 leanY≈+1.6
  let s = arena()
  s.phase = 'prep'
  s.moveDir = { x: 0, y: -1 }
  s = run(s, 0.3, 0.05) // 仍在加速（v≈0.24 << 2）
  check('俯仰：启动加速后倾（朝船尾，钳至上限 ≈+2px）', s.fortress.leanY > 1.8 && s.fortress.leanY <= 2.4 && Math.abs(s.fortress.leanX) < 0.05, // v2.19：leanCap 4→2，目标 a×k=3 被钳到 2（弹簧瞬态 ≤2.4）
    `lean=(${s.fortress.leanX.toFixed(3)},${s.fortress.leanY.toFixed(3)})`)
  // ② v1.90：满速后 a≈0 进死区 → 冻结保持后倾不归位（v2.19：冻结值=钳制上限 2.0）
  s = run(s, 3, 0.05)
  check('俯仰：匀速行驶保持后倾不归位（v1.90/v2.19，≈+2.0px 钳制上限）', s.fortress.leanY > 1.9 && s.fortress.leanY <= 2.05 && Math.hypot(s.fortress.vx, s.fortress.vy) === 6,
    `leanY=${s.fortress.leanY.toFixed(3)} v=${Math.hypot(s.fortress.vx, s.fortress.vy)}`)
  // ③ 刹停前倾：松开 → aLon=-4.5 → 目标钳 -2px（v2.19），弹簧过冲（软上限 -3）；停稳后保持不归位（v1.90）
  s.moveDir = { x: 0, y: 0 }
  s = run(s, 0.35, 0.05)
  check('俯仰：刹停前倾（目标钳上限 -2px，弹簧过冲至 (-3,-2.2]，v1.92/v2.19）', s.fortress.leanY <= -2.2 && s.fortress.leanY > -3 && Math.abs(s.fortress.leanX) < 0.05, // v2.19：区间同 v1.93 ⑨ cap2 用例
    `leanY=${s.fortress.leanY.toFixed(3)}`)
  // v1.91：停稳瞬间带保持的前倾（≈-2px，v2.19）→ 触发欠阻尼回弹：反向（朝船尾 +y）过冲，随后衰减归位
  let maxRb91 = -9
  for (let i = 0; i < 80; i++) { // 4s：刹停约 2.7s + 回弹 0.8s 全程覆盖
    s = run(s, 0.05, 0.05)
    if (Math.hypot(s.fortress.vx, s.fortress.vy) === 0 && s.fortress.leanY > maxRb91) maxRb91 = s.fortress.leanY
  }
  check('俯仰：停稳回弹反向过冲（v1.91；v2.19 上限 2px 后峰值 ≈0.4~1px）', maxRb91 >= 0.4 && maxRb91 <= 1.5, `过冲峰值=+${maxRb91.toFixed(2)}px`)
  check('俯仰：回弹衰减后归位（v1.91，|leanY|<0.1）', Math.hypot(s.fortress.vx, s.fortress.vy) === 0 && Math.abs(s.fortress.leanY) < 0.1 && s.fortress.leanRbT < 0,
    `v=${Math.hypot(s.fortress.vx, s.fortress.vy)} leanY=${s.fortress.leanY.toFixed(4)}`)
  // ④ 倒车镜像：倒退加速（a=+y×0.64，aLon=-0.64）→ 前倾 ≈-1.28；倒退刹停（aLon=+1.2）→ 后倾 ≈+2.4
  let sr = arena()
  sr.phase = 'prep'
  sr.reverse = true
  sr = run(sr, 0.5, 0.05) // 倒退加速中
  check('俯仰：倒车加速前倾（朝船头 ≈-2.4px）', Math.abs(sr.fortress.leanY + 2.4) < 0.3, `leanY=${sr.fortress.leanY.toFixed(3)}`) // v1.54：a=-2.4×k1
  sr.reverse = false // 松开倒退 → 刹停（reverse 复位，减速 1.2/s）
  let maxRbBk = -9
  for (let i = 0; i < 7; i++) { // v2.19：0.35s 窗口采峰值——后倾峰值 ≈+1.74（0.25s，未触 cap 2 即被回弹压回），随后欠阻尼振荡归位
    sr = run(sr, 0.05, 0.05)
    if (sr.fortress.leanY > maxRbBk) maxRbBk = sr.fortress.leanY
  }
  check('俯仰：倒车刹停后倾（朝船尾，峰值 ≈+1.7px < 上限 2）', maxRbBk > 1.5 && maxRbBk <= 2.2, `峰值=${maxRbBk.toFixed(3)}`) // v2.19：leanCap 4→2 后重定标（原 >2.5 @cap4）
  // ⑤ 弧线转向侧倾：右转向心加速度朝弯内（右）→ 车身向弯道外侧（左）侧倾（幅度 ×0.6）
  const full65: string[] = []
  for (let x = 0; x < 3; x++) for (let y = 0; y < 3; y++) full65.push(`${x},${y}`)
  const arcDef65: FortressDef = {
    id: 'test-pitch-arc', name: '测试俯仰弧线', w: 3, h: 3, shape: [...full65],
    interior: { cols: 1, rows: 1 },
    hp: 1000, speed: 2, turnSpeed: 90, turnRadius: 2, accel: 20, heatCap: 200, heatDissipation: 10,
    hardpoints: [], color: '#888888',
  }
  FORTRESS_DEFS.push(arcDef65)
  let sa = arena()
  sa.fortressDefId = 'test-pitch-arc'
  sa.phase = 'prep'
  sa.desiredHeading = 90 * (Math.PI / 180) // 右转弧线（ω=min(90°/s, 2/2)=1rad/s，稳态向心 a=v²/R=2 → 侧倾 0.6×2×2=2.4px）
  sa = run(sa, 0.6, 0.05)
  check('俯仰：弧线转向向弯道外侧侧倾（leanX<-0.8）', sa.fortress.leanX < -0.8,
    `lean=(${sa.fortress.leanX.toFixed(3)},${sa.fortress.leanY.toFixed(3)}) heading=${(sa.fortress.heading / (Math.PI / 180)).toFixed(1)}°`)
  // ⑥ pitchGain=0 完全关闭（加速/刹停均不倾）
  const g0def: FortressDef = { ...FORTRESS_DEFS[0], id: 'test-pitch0', pitchGain: 0 }
  FORTRESS_DEFS.push(g0def)
  let s0 = arena()
  s0.fortressDefId = 'test-pitch0'
  s0.phase = 'prep'
  s0.moveDir = { x: 0, y: -1 }
  s0 = run(s0, 0.5, 0.05)
  s0.moveDir = { x: 0, y: 0 }
  s0 = run(s0, 0.3, 0.05)
  check('俯仰：pitchGain=0 完全关闭（加/减速均不倾）', s0.fortress.leanX === 0 && s0.fortress.leanY === 0,
    `lean=(${s0.fortress.leanX},${s0.fortress.leanY})`)
  // ⑦ 急停点头更猛：惯性1（减速 0.8×3=2.4）前倾撞上限 -4px；惯性10（减速 0.8×0.2=0.16）仅轻点 ≈-0.32
  const in1: FortressDef = { ...FORTRESS_DEFS[0], id: 'test-in1', brakeInertia: 1 }
  const in10: FortressDef = { ...FORTRESS_DEFS[0], id: 'test-in10', brakeInertia: 10 }
  FORTRESS_DEFS.push(in1, in10)
  const brakeLean = (id: string) => {
    let sb = arena()
    sb.fortressDefId = id
    sb.phase = 'prep'
    sb.moveDir = { x: 0, y: -1 }
    sb = run(sb, 3, 0.05)
    sb.moveDir = { x: 0, y: 0 }
    sb = run(sb, 0.35, 0.05) // v1.90：起点为保持的后倾 +3.0，观察窗 0.2→0.35s 保证趋近完成
    return sb.fortress.leanY
  }
  const bl1 = brakeLean('test-in1')
  const bl10 = brakeLean('test-in10')
  check('俯仰：急停（惯性1）点头过冲至 (-3,-2.2]（v1.92 弹簧；v2.19 目标钳 -2）', bl1 <= -2.2 && bl1 > -3, `leanY=${bl1.toFixed(3)}`)
  check('俯仰：长滑行（惯性10）轻点 ≈-1.0px（v1.92 弹簧过冲后）', bl10 < -0.7 && bl10 > -1.2, `leanY=${bl10.toFixed(3)}`) // v1.92：目标 -0.6，过冲至 ≈-0.96
  // ⑧ 校验：0~10（0=关闭）
  check('俯仰校验：负值/超10被拒，0/10 合法',
    validateFortressDef({ ...FORTRESS_DEFS[0], pitchGain: -1 }).some(e => e.includes('车身俯仰'))
    && validateFortressDef({ ...FORTRESS_DEFS[0], pitchGain: 11 }).some(e => e.includes('车身俯仰'))
    && validateFortressDef({ ...FORTRESS_DEFS[0], pitchGain: 0 }).length === 0
    && validateFortressDef({ ...FORTRESS_DEFS[0], pitchGain: 10 }).length === 0)
  // ⑨ v1.93：俯仰位移上限可调——leanCap=2 时目标钳 ±2px（过冲允许至 -3 软上限内）；校验拦截 0/9
  {
    const cap2: FortressDef = { ...FORTRESS_DEFS[0], id: 'test-cap2', leanCap: 2 }
    FORTRESS_DEFS.push(cap2)
    let sc = arena()
    sc.fortressDefId = 'test-cap2'
    sc.phase = 'prep'
    sc.moveDir = { x: 0, y: -1 }
    sc = run(sc, 3, 0.05) // 加速至满速：目标 a×k=3px 被钳到 2px
    check('v1.93：俯仰位移上限=2 时加速后倾钳在 ≈+2px（原硬编码 4px 不再生效）', Math.abs(sc.fortress.leanY - 2) < 0.3,
      `leanY=${sc.fortress.leanY.toFixed(3)}`)
    sc.moveDir = { x: 0, y: 0 }
    sc = run(sc, 0.35, 0.05) // 刹停：目标钳 -2，弹簧过冲至 ≈-2.6（软上限 -3）
    check('v1.93：刹停前倾过冲受限在 (-3, -2.2] 区间（目标 -2 + 过冲余量 1px）', sc.fortress.leanY <= -2.2 && sc.fortress.leanY > -3,
      `leanY=${sc.fortress.leanY.toFixed(3)}`)
    check('v1.93：俯仰位移校验拦截 0/9、放行 1/8',
      validateFortressDef({ ...FORTRESS_DEFS[0], leanCap: 0 }).some(e => e.includes('俯仰位移'))
      && validateFortressDef({ ...FORTRESS_DEFS[0], leanCap: 9 }).some(e => e.includes('俯仰位移'))
      && validateFortressDef({ ...FORTRESS_DEFS[0], leanCap: 1 }).length === 0
      && validateFortressDef({ ...FORTRESS_DEFS[0], leanCap: 8 }).length === 0, '')
    const i93 = FORTRESS_DEFS.findIndex(f => f.id === 'test-cap2')
    if (i93 >= 0) FORTRESS_DEFS.splice(i93, 1)
  }
  // 清理
  for (const id of ['test-pitch-arc', 'test-pitch0', 'test-in1', 'test-in10']) {
    const i = FORTRESS_DEFS.findIndex(f => f.id === id)
    if (i >= 0) FORTRESS_DEFS.splice(i, 1)
  }
  restoreLevel()
}

// ====== 用例66：弹丸效果预览（v1.69） ======
{
  // 未配置效果的条目：三种模式均不可播放 & 模拟不产生粒子
  const plain = PROJECTILE_ARTS.find(a => a.id === 'shell_std')! // v1.72：bullet_std 口令版已带命中效果，改用无效果的 shell_std
  check('弹丸预览：未配置效果 → 按钮禁用（飞行/命中/爆炸均不可播）', !canPlay(plain, 'trail') && !canPlay(plain, 'impact') && !canPlay(plain, 'explosion'))
  check('弹丸预览：未配置尾焰 → 模拟无粒子', simAmmoFx(plain, 'trail', 2).peak === 0)

  // 配置尾焰：持续喷粒子
  const paT: ProjectileArtDef = { id: 'sim-fx-t', name: '测试尾焰', kind: 'missile', trail: {} }
  const rT = simAmmoFx(paT, 'trail', 2)
  check('弹丸预览：飞行（尾焰）持续发射粒子', rT.peak >= 5 && rT.end >= 0, `peak=${rT.peak}`)

  // 配置爆炸：首爆 = 火花14+烟尘7（默认值）
  const paE: ProjectileArtDef = { id: 'sim-fx-e', name: '测试爆炸', kind: 'shell', explosion: {} }
  const rE = simAmmoFx(paE, 'explosion', 0.5)
  check('弹丸预览：爆炸爆发粒子（火花+烟尘=21）', rE.peak === 21, `peak=${rE.peak}`)

  // 配置命中：碎屑 4
  const paI: ProjectileArtDef = { id: 'sim-fx-i', name: '测试命中', kind: 'bullet', impact: {} }
  const rI = simAmmoFx(paI, 'impact', 0.2)
  check('弹丸预览：命中碎屑粒子（spikes=4）', rI.peak === 4, `peak=${rI.peak}`)

  // 可播放性门控与配置一致
  check('弹丸预览：canPlay 与配置一致', canPlay(paT, 'trail') && !canPlay(paT, 'impact') && canPlay(paE, 'explosion') && canPlay(paI, 'impact'))

  // v2.10 光束三组粒子：fxTick ray-trail 发射吸收/散发/烟尘（组在=生效；未配置仍无粒子）
  const paRayFx: ProjectileArtDef = { id: 'sim-fx-rayfx', name: '射线粒子', kind: 'ray', beam: { absorb: {}, scatter: {}, smoke: {} } }
  const rRayFx = simAmmoFx(paRayFx, 'trail', 2)
  check('弹丸预览：射线光束三组粒子持续发射（吸收+散发+烟尘）', rRayFx.peak > 0, `peak=${rRayFx.peak}`)

  // v2.9 射线口径：飞行=光束发射（恒可播、无尾焰粒子）、取消爆炸（恒不可播）；命中仍按配置
  const paRay0: ProjectileArtDef = { id: 'sim-fx-ray', name: '测试射线', kind: 'ray' }
  const rRay = simAmmoFx(paRay0, 'trail', 2)
  check('弹丸预览：射线飞行恒可播（光束发射）且无尾焰粒子', canPlay(paRay0, 'trail') && rRay.peak === 0, `peak=${rRay.peak}`)
  check('弹丸预览：射线取消爆炸（恒不可播），命中仍按配置门控',
    !canPlay(paRay0, 'explosion') && !canPlay(paRay0, 'impact')
    && canPlay({ ...paRay0, impact: {} }, 'impact'),
    `exp=${canPlay(paRay0, 'explosion')} imp=${canPlay(paRay0, 'impact')}`)

  // v1.71 尾焰绑定贴图底部中间：发射点 = 弹体中心 − 尾偏（tailOff）
  {
    const pool = createPool()
    const st = createFxState()
    const pa: ProjectileArtDef = { id: 'sim-fx-tail', name: '尾偏测试', kind: 'missile', trail: { rate: 600, inherit: 1, spread: 0 } }
    const dt = 1 / 60
    fxTick(pa, 'trail', pool, st, dt, 12, 1.6, 0.5) // tailOff=0.5 格
    const pt = pool.parts[0]
    const expectX = st.px - 0.5 // 发射点在弹体尾端；即使惯性=1，也不得继续向弹头前方移动
    check('弹丸预览：尾焰从贴图尾端发射且不向弹头前方移动', pool.parts.length >= 10 && Math.abs(pt.x - expectX) < 0.02, `x=${pt?.x.toFixed(3)} expect≈${expectX.toFixed(3)}`)
  }

  // v2.34 全程（seq）：单「播放/停止」= 左→右飞行 → 右端命中/爆炸 → 停顿循环
  {
    check('v2.34：seq 门控（未配置不可播 / 任一配置可播 / 射线恒可播）',
      !canPlay(plain, 'seq') && canPlay(paT, 'seq') && canPlay(paI, 'seq') && canPlay(paE, 'seq') && canPlay(paRay0, 'seq'), '')
    // 飞行+爆发+循环（尾焰+爆炸同配；10s 内爆发≥2、循环≥1、粒子峰值>0）
    const paSeq: ProjectileArtDef = { id: 'sim-fx-seq', name: '全程测试', kind: 'missile', trail: {}, explosion: {} }
    const rSeq = simAmmoSeq(paSeq, 10)
    check('v2.34：seq 飞行+爆发+循环', rSeq.bursts >= 2 && rSeq.loops >= 1 && rSeq.peak > 0, JSON.stringify(rSeq))
    // 到达右端爆发粒子数 = 火花14+烟尘7（爆炸默认；无尾焰排除干扰）
    const paSeqE: ProjectileArtDef = { id: 'sim-fx-seqe', name: '全程爆发', kind: 'shell', explosion: {} }
    const poolS = createPool()
    const stS = createFxState()
    const dtS = 1 / 60
    for (let i = 0; i < 60 * 10 && stS.phase === 0; i++) fxTick(paSeqE, 'seq', poolS, stS, dtS, 12, 1.6)
    const burstX = poolS.parts.reduce((m, p) => Math.max(m, p.x), -1)
    check('v2.34：到达右端爆发（火花+烟尘=21）', stS.phase === 1 && poolS.parts.length === 21, `phase=${stS.phase} parts=${poolS.parts.length}`)
    check('v2.34：爆发点在右端命中点（worldW−2=10）', Math.abs(burstX - FX_SEQ_HIT_X(12)) < 1, `x=${burstX.toFixed(2)}`)
    // 命中+爆炸同配：同帧同时触发（碎屑4+火花14+烟尘7=25）
    const paSeqIE: ProjectileArtDef = { id: 'sim-fx-seqie', name: '全程命中爆炸', kind: 'missile', impact: {}, explosion: {} }
    const poolI = createPool()
    const stI = createFxState()
    for (let i = 0; i < 60 * 10 && stI.phase === 0; i++) fxTick(paSeqIE, 'seq', poolI, stI, dtS, 12, 1.6)
    check('v2.34：命中+爆炸同帧触发（4+14+7=25）', stI.phase === 1 && poolI.parts.length === 25, `parts=${poolI.parts.length}`)
    // 射线：seq=光束持续发射（无飞行/爆发状态机），粒子三组持续
    check('v2.34：射线 seq=光束持续（无爆发、三组粒子持续）', simAmmoSeq(paRayFx, 2).bursts === 0 && simAmmoFx(paRayFx, 'seq', 2).peak > 0, '')
    // v2.37：射线 seq 发射 5s 后熄灭（phase1 停发粒子），停顿 0.9s 后循环重启；trail 模式不受限
    {
      const pool = createPool()
      const st = createFxState()
      const dt = 1 / 60
      let emittedBefore5 = 0
      for (let t = 0; t < FX_RAY_SEQ_ON - 0.2; t += dt) { fxTick(paRayFx, 'seq', pool, st, dt, 12, 1.6); emittedBefore5 = Math.max(emittedBefore5, pool.parts.length) }
      const onOk = st.phase === 0 && st.t < FX_RAY_SEQ_ON && emittedBefore5 > 0
      for (let t = 0; t < 0.4; t += dt) fxTick(paRayFx, 'seq', pool, st, dt, 12, 1.6) // t≈5.2：熄灭窗口
      const nAt52 = pool.parts.length
      for (let t = 0; t < 0.5; t += dt) fxTick(paRayFx, 'seq', pool, st, dt, 12, 1.6) // t≈5.7：仍在熄灭窗口，粒子只衰减不新增
      const offOk = st.phase === 1 && pool.parts.length < nAt52
      for (let t = 0; t < 0.4; t += dt) fxTick(paRayFx, 'seq', pool, st, dt, 12, 1.6) // t≈6.1：5+0.9 已循环重启
      const loopOk = st.phase === 0 && st.t < 0.5 && pool.parts.length > 0
      check('v2.37：射线 seq 发射 5s 后熄灭、停顿 0.9s 循环重启',
        onOk && offOk && loopOk,
        `on=${onOk}(peak=${emittedBefore5}) off=${offOk}(${nAt52}→${pool.parts.length}) loop=${loopOk}(phase=${st.phase} t=${st.t.toFixed(2)})`)
      check('v2.37：射线 trail 模式不受 5s 限制（持续发射）', simAmmoFx(paRayFx, 'trail', 6).end > 0, '')
    }
    // v2.38：射线 seq 发射/持续/消失与实战一致——起射伸展端点随前锋前移；消退进度同 BEAM_FADE 口径
    {
      const pool = createPool()
      const st = createFxState()
      const dt = 1 / 60
      const paRayS: ProjectileArtDef = { id: 'sim-fx-rays', name: '射线伸展', kind: 'ray', beam: { scatter: { rate: 600 } } }
      fxTick(paRayS, 'seq', pool, st, dt, 12, 1.6) // t=1/60：前锋 1.6 格 → 端点 x≈2.1
      const x1 = Math.max(...pool.parts.map(p => p.x))
      for (let i = 0; i < 12; i++) fxTick(paRayS, 'seq', pool, st, dt, 12, 1.6) // t≈0.217：伸展已到位（11/96≈0.115s）
      const x2 = Math.max(...pool.parts.map(p => p.x))
      check('v2.38：射线 seq 起射伸展——粒子端点随前锋前移',
        x1 < 5 && x2 > 10.5, `x ${x1.toFixed(2)}→${x2.toFixed(2)}`)
      const stL = createFxState(); stL.t = 0.05
      const stF = createFxState(); stF.t = FX_RAY_SEQ_ON + BEAM_FADE / 2
      const stG = createFxState(); stG.t = FX_RAY_SEQ_ON + BEAM_FADE + 0.01
      check('v2.38：fxRaySeqLen/fxRaySeqFade 与战场常量同口径（伸展 BEAM_ON_SPEED / 消退 0.25s）',
        Math.abs(fxRaySeqLen(stL, 12) - (0.05 * BEAM_ON_SPEED) / M_PER_CELL) < 1e-9 && fxRaySeqLen(stG, 12) === 11
        && fxRaySeqFade(stL) === 0 && Math.abs(fxRaySeqFade(stF) - 0.5) < 1e-9 && fxRaySeqFade(stG) === 0,
        `len=${fxRaySeqLen(stL, 12).toFixed(2)} fade=${fxRaySeqFade(stF).toFixed(2)}`)
    }
  }
}

// --- 光束起射高速伸展：beamOnAt 起按 BEAM_ON_SPEED 从炮口伸展到全长，伤害范围同步 ---
{
  Math.random = zeroRandom
  const beam = TURRET_DEFS.find(d => d.id === 'beam')!
  const ch0 = beam.chargeTime
  beam.chargeTime = 0 // 免充能：首个索敌 tick 即起射，便于逐帧观察 ramp
  const dt = 0.05
  // A. ramp 时序：起射 len=0 → +0.05s ≈4.8 格 → +0.10s ≈9.6 格（仍未到位不伤）→ +0.15s 到位(=全长10格)当帧结算首次伤害
  let s = arena()
  const t = mkTurret(s, 'beam', 5, 20)
  const e = mkEnemy(s, 'walker', 6.0, 16)
  const hp0 = byId(s.enemies, e.id)!.hp
  s = tick(s, dt)
  const tt1 = byId(s.turrets, t.id)!
  const fullLen = beamMarch(s, tt1, beam).len
  check('v2.35：起射当帧 beamOnAt=当前时刻、len=0（光束尚未伸展）',
    tt1.firing && tt1.beamOnAt === s.time && beamLength(s, tt1, beam) < 1e-9 && fullLen > 9,
    `firing=${tt1.firing} beamOnAt=${tt1.beamOnAt} len=${beamLength(s, tt1, beam).toFixed(2)}/${fullLen.toFixed(2)}`)
  s = tick(s, dt)
  const tt2 = byId(s.turrets, t.id)!
  const lenMid = beamLength(s, tt2, beam)
  check('v2.35：伸展中 len≈速度×时间 <全长，且伸展未到不结算伤害',
    lenMid > 1 && lenMid < fullLen - 1e-9 && Math.abs(lenMid - (dt * BEAM_ON_SPEED) / M_PER_CELL) < 0.2
      && byId(s.enemies, e.id)!.hp === hp0,
    `len=${lenMid.toFixed(2)} expect≈${((dt * BEAM_ON_SPEED) / M_PER_CELL).toFixed(2)} hp=${byId(s.enemies, e.id)!.hp}`)
  s = tick(s, dt) // len=9.6 格，距到位还差 0.4 格：仍不结算
  const hpStill = byId(s.enemies, e.id)!.hp
  s = tick(s, dt) // len 到位（≥全长）→ 首次 DoT 当帧结算（不因 ramp 空等一个 DoT 间隔）
  const tt4 = byId(s.turrets, t.id)!
  check('v2.35：伸展到位帧即结算首次伤害（DoT 计时器不被空打消耗）',
    hpStill === hp0 && beamLength(s, tt4, beam) >= fullLen - 1e-9 && byId(s.enemies, e.id)!.hp < hp0,
    `hp ${hpStill}→${byId(s.enemies, e.id)!.hp} len=${beamLength(s, tt4, beam).toFixed(2)}/${fullLen.toFixed(2)}`)
  // B. 阻挡物门控：伸展未抵达阻挡物时不结算阻挡物伤害；抵达当帧结算
  let s2 = arena()
  const tB = mkTurret(s2, 'beam', 5, 20)
  mkEnemy(s2, 'walker', 5.5, 14) // 正上方，光束垂直向上
  s2.objects.push({
    id: 3100, kind: 'ruins', x: 5, y: 18, w: 1, h: 1, hp: 100000, maxHp: 100000,
    blockMove: true, blockProjectile: true, height: 3,
  })
  const blk = () => s2.objects.find(o => o.id === 3100)!
  s2 = tick(s2, dt) // 起射帧：len=0 < 阻挡距离 → 不伤
  const ttB1 = byId(s2.turrets, tB.id)!
  const mLen = beamMarch(s2, ttB1, beam).len
  const gatedAtStart = blk().hp === 100000 && beamMarch(s2, ttB1, beam).blocker?.id === 3100 && mLen < fullLen - 1
  let arriveTicks = 0
  while (arriveTicks < 5 && blk().hp === 100000) { s2 = tick(s2, dt); arriveTicks++ }
  const ttB2 = byId(s2.turrets, tB.id)!
  check('v2.35：阻挡物在伸展抵达前不受伤害、抵达帧即结算',
    gatedAtStart && blk().hp < 100000 && arriveTicks >= 1 && arriveTicks <= 3
      && beamLength(s2, ttB2, beam) >= mLen - 1e-9,
    `mLen=${mLen.toFixed(2)} ticks=${arriveTicks} hp=${blk().hp}`)
  // C. 停火清除：attackDuration 自然结束（firingLeft→0）→ firing false + beamOnAt 清除 + 推入消退段
  byId(s2.turrets, tB.id)!.firingLeft = 0.01 // 下一拍 firingLeft-=dt ≤0 → 停射
  s2 = tick(s2, dt)
  const ttB3 = byId(s2.turrets, tB.id)!
  check('v2.35：停火清除 beamOnAt 并推入光束消退段',
    !ttB3.firing && ttB3.beamOnAt === undefined && s2.beamFades.length >= 1,
    `firing=${ttB3.firing} beamOnAt=${ttB3.beamOnAt} fades=${s2.beamFades.length}`)
  beam.chargeTime = ch0
}

// --- v2.40 堡垒特效点粒子化：真实世界粒子（离口不跟船）+ 双通道分层（ground=底座之下） ---
{
  Math.random = zeroRandom
  // 缺省参数：dust=ground/inherit 0.3；smoke=air/inherit 0；配置覆盖优先
  const d0 = effectParams({ id: 'a', x: 1, y: 1, kind: 'dust', state: 'both' })
  const s0 = effectParams({ id: 'b', x: 1, y: 1, kind: 'smoke', state: 'both' })
  const o0 = effectParams({ id: 'c', x: 1, y: 1, kind: 'dust', state: 'both', layer: 'air', inherit: 0.8, rate: 30 })
  check('v2.40：特效点缺省参数（尘土=地面+继承0.3 / 烟雾=空中+继承0）与覆盖',
    d0.layer === 'ground' && d0.inherit === 0.3 && d0.size === 0.14 && s0.layer === 'air' && s0.inherit === 0
    && o0.layer === 'air' && o0.inherit === 0.8 && o0.rate === 30,
    `dust=${d0.layer}/${d0.inherit} smoke=${s0.layer}/${s0.inherit} ovr=${o0.layer}/${o0.rate}`)
  // 世界坐标：随 heading 旋转（右缘中点：heading 0 → 中心+(w/2,0)；heading π/2 → 中心+(0,w/2)）
  {
    const s = arena()
    const fr = fortressRect(s)
    const pt = { id: 'p', x: fr.w, y: fr.h / 2, kind: 'smoke', state: 'both' } as const
    s.fortress.heading = 0
    const w0 = effectWorldPos(s, pt)
    s.fortress.heading = Math.PI / 2
    const w1 = effectWorldPos(s, pt)
    const cx = fr.x + fr.w / 2, cy = fr.y + fr.h / 2
    check('v2.40：特效点世界坐标随 heading 旋转',
      Math.abs(w0.x - (cx + fr.w / 2)) < 1e-9 && Math.abs(w0.y - cy) < 1e-9
      && Math.abs(w1.x - cx) < 1e-9 && Math.abs(w1.y - (cy + fr.w / 2)) < 1e-9,
      `h0=(${w0.x.toFixed(1)},${w0.y.toFixed(1)}) h90=(${w1.x.toFixed(1)},${w1.y.toFixed(1)})`)
    s.fortress.heading = 0
  }
  // 状态门控 + 层级路由 + 速度继承：移动中 dust(move) 进 ground、smoke(idle) 不发射；停止后 smoke 进 air
  {
    const s = arena()
    const fd: FortressDef = { ...fortressDef(s), effects: [
      { id: 'fx-d', x: 1, y: 1, kind: 'dust', state: 'move' },
      { id: 'fx-s', x: 2, y: 1, kind: 'smoke', state: 'idle' },
    ] }
    const ground = createPool(), air = createPool()
    const accs = new Map<string, number>()
    s.fortress.vx = 3
    emitFortressEffects(s, fd, 0.5, ground, air, accs)
    const moveOk = ground.parts.length >= 6 && air.parts.length === 0
    const inh = ground.parts[0] // zeroRandom：side=1 → vx = 3×0.3 + 0.2 = 1.1
    s.fortress.vx = 0
    emitFortressEffects(s, fd, 0.5, ground, air, accs)
    const idleOk = air.parts.length >= 3
    check('v2.40：状态门控/层级路由/速度继承（尘土→地面池且 vx 含继承；停止后烟雾→空中池）',
      moveOk && idleOk && Math.abs(inh.vx - 1.1) < 1e-9,
      `move g=${ground.parts.length} a=${air.parts.length} vx=${inh?.vx.toFixed(2)} idle a=${air.parts.length}`)
  }
}

// --- v2.41 履带印：按各侧 trackPhase 位移落印（印距=瓦片有效步长、正倒向皆印、过期/容量清理） ---
{
  Math.random = zeroRandom
  // 印距：(32−2)/BASE_CELL = 0.9375 格；下限 0.2 格
  check('v2.41：印距 = (图高−重叠)/BASE_CELL 格', Math.abs(trackMarkStep(32, 2) - 30 / BASE_CELL) < 1e-9 && trackMarkStep(3, 2) === 0.2, '')
  const s = arena()
  const fd: FortressDef = { ...fortressDef(s), tracks: [{ id: 'tk1', x1: -2, y1: 3.5, x2: -2, y2: 1.5, radius: 0.5, tile: 't1', overlapPx: 2 }] }
  const marks: TrackMark[] = []
  const st: TrackMarkState = { acc: [], prevPhase: [], moving: [] }
  s.fortress.heading = 0
  s.fortress.trackPhase = [0, 0]
  const tileH = () => BASE_CELL + 2 // 扣除 2px 重叠后，步长正好为 1 格
  updateTrackMarks(marks, st, s, fd, tileH) // 首次锚定：不产印
  const anchored = marks.length === 0
  s.fortress.trackPhase = [3, 3] // 静止→前进 3 格：每侧 1 启动印 + 3 步进印 = 4 印（v2.42）
  updateTrackMarks(marks, st, s, fd, tileH)
  const fwdOk = marks.length === 8 && marks.every(m => Math.abs(m.angle - 0) < 1e-9 && m.tile === 't1')
  const mirrorOk = marks.slice(0, 4).every(m => !m.mirror) && marks.slice(4, 8).every(m => m.mirror)
  s.fortress.trackPhase = [3.5, 4.75] // 左侧 +0.5（不足 1 格无印）；右侧 +1.75（1 印，余 0.75）
  updateTrackMarks(marks, st, s, fd, tileH)
  const diffOk = marks.length === 9 && Math.abs(st.acc[0] - 0.5) < 1e-9 && Math.abs(st.acc[1] - 0.75) < 1e-9
  s.fortress.trackPhase = [1.5, 2.75] // 倒退 2 格：左 0.5−2=−1.5（1 印余 −0.5）；右 0.75−2=−1.25（1 印余 −0.25）
  updateTrackMarks(marks, st, s, fd, tileH)
  const revOk = marks.length === 11
  // 落点 = 速度为 0 时取履带段中点随 heading 的世界坐标（heading 0：几何原点坐标左 (-2,2.5) / 右 (2,2.5)）
  const fr = fortressRect(s)
  const cx = fr.x + fr.w / 2, cy = fr.y + fr.h / 2
  const posOk = Math.abs(marks[0].x - (cx - 2)) < 1e-9 && Math.abs(marks[0].y - (cy - 2.5)) < 1e-9
    && Math.abs(marks[4].x - (cx + 2)) < 1e-9 // marks[0..3]=左侧启动印+3 印（同点连落），marks[4]=镜像侧首印
  check('v2.41：位移落印（前进/差速/倒退）+ 接地点世界坐标',
    anchored && fwdOk && mirrorOk && diffOk && revOk && posOk,
    `n=${marks.length} acc=${st.acc.map(a => a.toFixed(2))} p0=(${marks[0]?.x.toFixed(1)},${marks[0]?.y.toFixed(1)})`)
  // 过期清理 + 容量上限
  marks.length = 0
  marks.push({ x: 0, y: 0, angle: 0, born: s.time - TRACK_MARK_LIFE - 1, tile: 't1' })
  for (let i = 0; i < TRACK_MARK_CAP + 10; i++) marks.push({ x: 0, y: 0, angle: 0, born: s.time, tile: 't1' })
  updateTrackMarks(marks, st, s, fd, tileH)
  check('v2.41：过期印清理 + 容量 600 FIFO', marks.length === TRACK_MARK_CAP && marks.every(m => s.time - m.born <= TRACK_MARK_LIFE), `n=${marks.length}`)
  check('v2.41：屏幕外履带印不参与绘制，边缘外扩范围仍保留', trackMarkVisibleOnScreen(50, 50, 100, 100, 10)
    && trackMarkVisibleOnScreen(-8, 50, 100, 100, 10)
    && !trackMarkVisibleOnScreen(-12, 50, 100, 100, 10))
}

// --- v2.42 履带印即时可见：静止→移动立即落启动印（不足一印距也印）；接地点 = 履带段运动方向后端（印从船尾缘即时露出） ---
{
  const s = arena()
  const fd: FortressDef = { ...fortressDef(s), tracks: [{ id: 'tk1', x1: -2, y1: 3.5, x2: -2, y2: 1.5, radius: 0.5, tile: 't1', overlapPx: 2 }] }
  const marks: TrackMark[] = []
  const st: TrackMarkState = { acc: [], prevPhase: [], moving: [] }
  const tileH = () => BASE_CELL + 2 // 扣除 2px 重叠后，步长正好为 1 格
  s.fortress.heading = 0
  s.fortress.trackPhase = [0, 0]
  updateTrackMarks(marks, st, s, fd, tileH) // 锚定
  s.fortress.trackPhase = [0.05, 0.05] // 仅动 0.05 格（远不足 1 格印距）
  updateTrackMarks(marks, st, s, fd, tileH)
  const startOk = marks.length === 2 && Math.abs(st.acc[0] - 0.05) < 1e-9 // 启动印：左右各 1，余量不吞
  // 后端采样：前进（vy=−6）→ 印落段后端 y=1.5；倒退（vy=+6）→ 段前端 y=3.5。
  const fr = fortressRect(s)
  const cy = fr.y + fr.h / 2
  const marks2: TrackMark[] = []
  const st2: TrackMarkState = { acc: [], prevPhase: [], moving: [] }
  s.fortress.trackPhase = [0, 0]
  updateTrackMarks(marks2, st2, s, fd, tileH) // 锚定
  s.fortress.vy = -6
  s.fortress.trackPhase = [0.5, 0.5] // 前进 0.5 格：启动印落在后端
  updateTrackMarks(marks2, st2, s, fd, tileH)
  const rearOk = marks2.length === 2 && Math.abs(marks2[0].y - (cy - 1.5)) < 1e-9
  const marks3: TrackMark[] = []
  const st3: TrackMarkState = { acc: [], prevPhase: [], moving: [] }
  s.fortress.vy = 6
  s.fortress.trackPhase = [0, 0]
  updateTrackMarks(marks3, st3, s, fd, tileH) // 锚定（倒退相位移为负方向）
  s.fortress.trackPhase = [-0.5, -0.5] // 倒退 0.5 格：启动印落在前端
  updateTrackMarks(marks3, st3, s, fd, tileH)
  const frontOk = marks3.length === 2 && Math.abs(marks3[0].y - (cy - 3.5)) < 1e-9
  s.fortress.vy = 0
  check('v2.42：静止→移动立即落启动印（0.05 格即印，余量保留）', startOk, `n=${marks.length} acc=${st.acc[0]?.toFixed(2)}`)
  check('v2.42：接地点=运动方向后端（前进印落 y2 端 / 倒退印落 y1 端）', rearOk && frontOk,
    `rear y=${marks2[0]?.y.toFixed(1)} exp=${(cy - 1.5).toFixed(1)} front y=${marks3[0]?.y.toFixed(1)} exp=${(cy - 3.5).toFixed(1)}`)
}

// --- v2.57 地面弹坑：爆炸/落地事件首见生成、45s 生命周期、120 FIFO、实弹射程终点小坑 ---
{
  const marks: Crater[] = []
  const seen = new Set<number>()
  const events: ExplosionFx[] = [
    { id: 10, x: 2, y: 3, r: 1, ttl: 0.3 },
    { id: 11, x: 4, y: 5, r: 3, ttl: 2.25, max: 2.25, kind: 'unitDeath', deathEffect: 'large' },
    { id: 12, x: 6, y: 7, r: 0.2, ttl: 0.12, kind: 'groundImpact', projectileSize: 0.6 },
    { id: 13, x: 8, y: 9, r: 0.35, ttl: 0.24, leavesCrater: false },
  ]
  updateCraters(marks, seen, events, 10)
  updateCraters(marks, seen, events, 10.1) // 同一事件多帧可见，不重复落坑
  check('v2.57：爆炸坑维持半径规则，非爆炸落地坑直径等于弹丸显示尺寸',
    marks.length === 3 && !marks.some(mark => mark.seed === 13)
      && craterRadius(events[1]) > craterRadius(events[0]) && craterRadius(events[2]) === 0.3
      && craterRadius({ r: 1, kind: undefined, projectileSize: 10 }) === 0.75,
    `n=${marks.length} r=${marks.map(m => m.r.toFixed(2))}`)

  const many: ExplosionFx[] = Array.from({ length: CRATER_CAP + 10 }, (_, i) => ({ id: 100 + i, x: i, y: 0, r: 1, ttl: 0.3 }))
  updateCraters(marks, seen, many, 11)
  const fadeOk = craterOpacity(30) === 1 && Math.abs(craterOpacity(37.5) - 0.5) < 1e-9 && craterOpacity(CRATER_LIFE) === 0
  const fifoOk = marks.length === CRATER_CAP && marks[0].seed === 110
  updateCraters(marks, seen, [], 11 + CRATER_LIFE + 0.1)
  check('v2.57：弹坑 120 FIFO、前30s常显/末15s渐隐、45s过期',
    fadeOk && fifoOk && marks.length === 0,
    `fade=${fadeOk} fifo=${fifoOk} left=${marks.length}`)

  let s = arena()
  s.objects = []
  const pId = s.nextId++
  s.projectiles.push({
    id: pId, kind: 'bullet', defId: 'mg', level: 1,
    x: 5, y: 5, px: 5, py: 5, heading: Math.PI / 2,
    damage: 1, traveled: 99, maxTravel: 100, shooter: 0, hitIds: [],
    t: 0, flightTime: 0, sx: 0, sy: 0, tx: 0, ty: 0,
    speed: 0, turnRate: 0, guided: false, targetId: null,
    lockX: 0, lockY: 0, lostLock: false, prevDist: -1, weavePhase: 0,
  })
  s = tick(s, 0.05)
  const landing = s.explosions.find(ex => ex.kind === 'groundImpact')
  check('v2.57：未命中实弹射程耗尽产生携带弹丸尺寸来源的无伤害落地坑事件',
    s.projectiles.length === 0 && landing?.r === 0.2 && landing.ammoId === 'bullet_std'
      && landing.projectileSize === 5 / BASE_CELL,
    `projectiles=${s.projectiles.length} landing=${JSON.stringify(landing)}`)
}

// --- 地图边缘命中：弹丸中心越界前，必须先结算本帧线段穿过的贴边敌人 ---
{
  let s = arena()
  s.objects = []
  const edgeEnemy = mkEnemy(s, 'walker', 0.1, 5, 100)
  s.projectiles.push({
    id: s.nextId++, kind: 'bullet', defId: 'mg', level: 1,
    x: 0.35, y: 5, px: 0.35, py: 5, heading: -Math.PI / 2,
    damage: 10, traveled: 0, maxTravel: 1000, shooter: 0, hitIds: [],
    t: 0, flightTime: 0, sx: 0, sy: 0, tx: 0, ty: 0,
    speed: 0, turnRate: 0, guided: false, targetId: null,
    lockX: 0, lockY: 0, lostLock: false, prevDist: -1, weavePhase: 0,
  })
  s = tick(s, 0.05) // mg 51.2m/s = 0.8格/帧，弹丸中心从 x=0.35 推进到 x=-0.45
  const after = s.enemies.find(enemy => enemy.id === edgeEnemy.id)
  check('地图边缘：高速实弹中心越界时仍结算线段穿过的敌人',
    after !== undefined && after.hp < edgeEnemy.hp && s.projectiles.length === 0,
    `hp=${after?.hp}/${edgeEnemy.hp} projectiles=${s.projectiles.length}`)
}

// --- v2.44 预览大力喷射补弹种门控：仅导弹吃 ×3 爆发，实弹/榴弹预览与实战一致（无爆发） ---
{
  Math.random = zeroRandom
  const dt = 1 / 60
  const mk = (kind: 'bullet' | 'missile'): ProjectileArtDef => ({ id: `sim-fx-${kind}`, name: kind, kind, trail: { rate: 120, life: 1, size: 0.1, inherit: 0, spread: 0.2 } })
  const runN = (pa: ProjectileArtDef) => {
    const pool = createPool(); const st = createFxState()
    for (let i = 0; i < 30; i++) fxTick(pa, 'trail', pool, st, dt, 12, 1.6) // 0.5s，life=1 全部存活
    return pool.parts.length
  }
  const nBullet = runN(mk('bullet'))
  const nMissile = runN(mk('missile'))
  // 实弹 0.5s：120×0.5=60 粒（无爆发）；导弹同窗口 ≈120×0.5×(1+2×0.75)=150 粒（b24 由 1→0.5 均值 2.5 倍）
  check('v2.44：预览大力喷射仅导弹生效（实弹无爆发=实战一致）',
    nBullet <= 62 && nMissile >= 140, `bullet=${nBullet} missile=${nMissile}`)
}

// --- v2.47 实弹爆炸：直射 blastRadius>0 命中触发爆炸（主目标直击+爆炸、波及目标爆炸、范围外无伤；未配置无爆炸事件） ---
{
  Math.random = zeroRandom
  const spdBk = ENEMY_DEFS.walker.speed
  ENEMY_DEFS.walker.speed = 0 // 钉住，保证波及关系不随时间漂移
  const base = TURRET_DEFS.find(d => d.id === 'mg')!
  TURRET_DEFS.push({ ...base, id: 'test-blast', accuracy: 0, pierce: { count: 0, decay: 0 }, blastRadius: legacyMeters(50), blastEffect: { damage: 10 } }) // 保持旧配置 2 格爆炸半径
  let s = arena()
  s.objects = [] // 清掉 LEVEL 默认物体：(5,8) 油桶会被子弹爆炸 9999 波及殉爆、燃烧区干扰伤害断言
  mkTurret(s, 'test-blast', 6, 13) // 中心 (6.5,13.5) 朝上直射
  // 索敌打分 = 离堡垒距离（堡垒在右下）：x 越大越优先被直击——A(7.5) 中弹，B(6.5) 波及，C(1.5) 最远不挨打
  const eA = mkEnemy(s, 'walker', 7.5, 8, 1000)  // 直击目标（离堡垒最近）
  const eB = mkEnemy(s, 'walker', 6.5, 8, 1000)  // 爆心 1 格 < 2 格半径 → 波及
  const eC = mkEnemy(s, 'walker', 1.5, 8, 1000)  // 爆心 6 格 > 半径 → 无伤
  let expEvents = 0
  const expLog: string[] = []
  s = run(s, 2, 0.05, g => { for (const x of g.explosions) if (x.ttl > 0.3) { expEvents++; expLog.push(`(${x.x.toFixed(1)},${x.y.toFixed(1)})`) } }) // 爆炸事件 ttl 0.35 衰减快，逐 tick 计新生（2s 窗口仅第一轮连发）
  const hpA = byId(s.enemies, eA.id)!.hp, hpB = byId(s.enemies, eB.id)!.hp, hpC = byId(s.enemies, eC.id)!.hp
  check('v2.47：直射爆炸——主目标 直击5+爆炸10=15 / 波及 10 / 范围外 0（1 级无升级缩放）',
    hpA === 1000 - 90 && hpB === 1000 - 60 && hpC === 1000 && expEvents === 6, // 一轮 6 发：主目标每发 15、波及每发 10
    `hpA=${hpA} hpB=${hpB} hpC=${hpC} exp=${expEvents} ${expLog.join('')}`)
  TURRET_DEFS.splice(TURRET_DEFS.findIndex(d => d.id === 'test-blast'), 1)
  // 对照：mg 未配置爆炸 → 命中不产生爆炸事件
  let s2 = arena()
  s2.objects = [] // 同上：隔离环境物体
  mkTurret(s2, 'mg', 6, 13)
  const e2 = mkEnemy(s2, 'walker', 6.5, 8, 100000)
  s2 = run(s2, 2, 0.05)
  check('v2.47：未配置爆炸的直射命中无爆炸事件（现状保持）',
    byId(s2.enemies, e2.id)!.hp < 100000 && s2.explosions.length === 0,
    `hp=${byId(s2.enemies, e2.id)!.hp} exp=${s2.explosions.length}`)
  ENEMY_DEFS.walker.speed = spdBk
}

// --- v2.46 无尾焰配置 = 无任何默认尾焰：未配 trail 的弹丸 resolveTrailFx 恒 null（渲染不再回退曳光线/默认喷口 glow） ---
{
  check('v2.46：未配置尾焰的弹丸 resolveTrailFx = null（无默认尾焰；渲染不再回退曳光线/默认喷口 glow）',
    resolveTrailFx({ id: 't1', name: 't', kind: 'shell' }) === null
    && resolveTrailFx({ id: 't2', name: 't', kind: 'bullet', explosion: {}, impact: {} }) === null
    && resolveTrailFx({ id: 't3', name: 't', kind: 'bullet', trail: {} }) !== null, // 对照：配了 trail（哪怕空组）正常解析模板缺省
    '')
}

// --- v2.49 标签式索敌：prefer 软排序（权重连乘）/ exclude 硬过滤 / resource 开火门控；空标签=现状 ---
{
  Math.random = zeroRandom
  const spdW = ENEMY_DEFS.walker.speed, spdB = ENEMY_DEFS.brute.speed, spdF = ENEMY_DEFS.flyer.speed
  ENEMY_DEFS.walker.speed = 0; ENEMY_DEFS.brute.speed = 0; ENEMY_DEFS.flyer.speed = 0 // 全钉住：距离关系不随时间漂移
  const mg0 = TURRET_DEFS.find(d => d.id === 'mg')!
  // 测试塔模板：精度 0、免弹药（隔离资源标签语义）、可对空、零穿透、射程拉满
  const mk = (id: string, tags: TurretTag[]) =>
    TURRET_DEFS.push({ ...mg0, id, accuracy: 0, ammoCapacity: 100, canAir: true, pierce: { count: 0, decay: 0 }, rangeMin: 0, rangeMax: 2000, tags })
  const drop = (id: string) => TURRET_DEFS.splice(TURRET_DEFS.findIndex(d => d.id === id), 1)
  const fcX = (s: GameState) => { const r = fortressRect(s); return r.x + r.w / 2 }

  // A. prefer·血最多优先：远距高血目标颠覆默认近堡垒
  mk('t-hpmax', [{ kind: 'prefer', key: 'hpMax' }])
  let sA = arena(); sA.objects = []
  mkTurret(sA, 't-hpmax', 6, 13)
  const aHi = mkEnemy(sA, 'walker', 1.5, 8, 10000) // 离堡垒远、血厚
  const aLo = mkEnemy(sA, 'walker', 7.5, 8, 60)    // 离堡垒近、血薄
  sA = run(sA, 3, 0.05)
  check('v2.49：偏好·血最多优先——远距高血目标优先于近距低血（颠覆默认近堡垒）',
    byId(sA.enemies, aHi.id)!.hp < 10000 && byId(sA.enemies, aLo.id)!.hp === 60,
    `hi=${byId(sA.enemies, aHi.id)!.hp} lo=${byId(sA.enemies, aLo.id)!.hp}`)
  drop('t-hpmax')

  // B. prefer·近炮塔优先：基础分改距炮塔
  mk('t-near', [{ kind: 'prefer', key: 'nearTurret' }])
  let sB = arena(); sB.objects = []
  mkTurret(sB, 't-near', 6, 13)
  const bNearT = mkEnemy(sB, 'walker', 6.5, 20, 1000) // 距炮塔 6.5 格、距堡垒远
  const bNearF = mkEnemy(sB, 'walker', 14, 50, 1000)  // 距堡垒近、距炮塔远
  sB = run(sB, 3, 0.05)
  check('v2.49：偏好·近炮塔优先——近炮塔目标优先于近堡垒目标',
    byId(sB.enemies, bNearT.id)!.hp < 1000 && byId(sB.enemies, bNearF.id)!.hp === 1000,
    `nearT=${byId(sB.enemies, bNearT.id)!.hp} nearF=${byId(sB.enemies, bNearF.id)!.hp}`)
  drop('t-near')

  // C. exclude·不打地面：硬过滤
  mk('t-xg', [{ kind: 'exclude', key: 'ground' }])
  let sC = arena(); sC.objects = []
  mkTurret(sC, 't-xg', 6, 13)
  const cG = mkEnemy(sC, 'walker', 7.5, 8, 1000)
  const cA = mkEnemy(sC, 'flyer', 6.5, 8, 1000)
  sC = run(sC, 3, 0.05)
  check('v2.49：约束·不打地面——地面目标全程无伤、空中目标被打',
    byId(sC.enemies, cG.id)!.hp === 1000 && byId(sC.enemies, cA.id)!.hp < 1000,
    `g=${byId(sC.enemies, cG.id)!.hp} a=${byId(sC.enemies, cA.id)!.hp}`)
  drop('t-xg')

  // D. prefer·地面优先：等距（关于堡垒中线对称）时地面×0.5 胜出
  mk('t-pg', [{ kind: 'prefer', key: 'ground' }])
  let sD = arena(); sD.objects = []
  mkTurret(sD, 't-pg', 6, 13)
  const dW = mkEnemy(sD, 'walker', fcX(sD) - 5, 8, 1000)
  const dF = mkEnemy(sD, 'flyer', fcX(sD) + 5, 8, 1000)
  sD = run(sD, 3, 0.05)
  check('v2.49：偏好·地面优先——等距时地面目标胜出（默认空军×0.5 被标签取代）',
    byId(sD.enemies, dW.id)!.hp < 1000 && byId(sD.enemies, dF.id)!.hp === 1000,
    `w=${byId(sD.enemies, dW.id)!.hp} f=${byId(sD.enemies, dF.id)!.hp}`)
  drop('t-pg')

  // E. prefer·大单位优先：等距时 brute(0.40) 胜 walker(0.32)
  mk('t-big', [{ kind: 'prefer', key: 'sizeBig' }])
  let sE = arena(); sE.objects = []
  mkTurret(sE, 't-big', 6, 13)
  const eW = mkEnemy(sE, 'walker', fcX(sE) - 5, 8, 100000)
  const eB = mkEnemy(sE, 'brute', fcX(sE) + 5, 8, 100000)
  sE = run(sE, 3, 0.05)
  check('v2.49：偏好·大单位优先——等距时大体型目标胜出',
    byId(sE.enemies, eB.id)!.hp < 100000 && byId(sE.enemies, eW.id)!.hp === 100000,
    `brute=${byId(sE.enemies, eB.id)!.hp} walker=${byId(sE.enemies, eW.id)!.hp}`)
  drop('t-big')

  // F. resource·弹药低于 50% 禁火（硬开关；弹药恢复后解禁）
  mk('t-rammo', [{ kind: 'resource', res: 'ammo', op: 'lt', value: 50 }])
  let sF = arena(); sF.objects = []
  const rT = mkTurret(sF, 't-rammo', 6, 13)
  const rE = mkEnemy(sF, 'walker', 6.5, 8, 100000)
  rT.ammo = 40 // 炮塔独立弹药池：40% < 50%
  sF = run(sF, 2, 0.05)
  const hpLow = byId(sF.enemies, rE.id)!.hp
  byId(sF.turrets, rT.id)!.ammo = 100
  sF = run(sF, 3, 0.05)
  check('v2.49：资源·弹药低于50%禁火——低弹药停火、补足后恢复开火',
    hpLow === 100000 && byId(sF.enemies, rE.id)!.hp < 100000,
    `low=${hpLow} after=${byId(sF.enemies, rE.id)!.hp}`)
  drop('t-rammo')

  // G. resource·热量高于 80% 禁火（散热后解禁）
  mk('t-rheat', [{ kind: 'resource', res: 'heat', op: 'gt', value: 80 }])
  let sG = arena(); sG.objects = []
  mkTurret(sG, 't-rheat', 6, 13)
  const hE = mkEnemy(sG, 'walker', 6.5, 8, 100000)
  sG.fortress.heat = 199 // 99.5% > 80%；散热 10/s×2s 后 179=89.5% 仍 >80%
  sG = run(sG, 2, 0.05)
  const hpHot = byId(sG.enemies, hE.id)!.hp
  sG.fortress.heat = 0
  sG = run(sG, 3, 0.05)
  check('v2.49：资源·热量高于80%禁火——高热停火、散热后恢复开火',
    hpHot === 100000 && byId(sG.enemies, hE.id)!.hp < 100000,
    `hot=${hpHot} after=${byId(sG.enemies, hE.id)!.hp}`)
  drop('t-rheat')

  // H. 空标签 = 现状：等距时空军×0.5 优先
  mk('t-def', [])
  let sH = arena(); sH.objects = []
  mkTurret(sH, 't-def', 6, 13)
  const hW = mkEnemy(sH, 'walker', fcX(sH) - 5, 8, 1000)
  const hF = mkEnemy(sH, 'flyer', fcX(sH) + 5, 8, 1000)
  sH = run(sH, 3, 0.05)
  check('v2.49：空标签=现状——等距时空中目标×0.5 优先（旧行为保持）',
    byId(sH.enemies, hF.id)!.hp < 1000 && byId(sH.enemies, hW.id)!.hp === 1000,
    `f=${byId(sH.enemies, hF.id)!.hp} w=${byId(sH.enemies, hW.id)!.hp}`)
  drop('t-def')

  ENEMY_DEFS.walker.speed = spdW; ENEMY_DEFS.brute.speed = spdB; ENEMY_DEFS.flyer.speed = spdF
}

console.log('== 迁移加固：引擎确定性随机验收 ==')
{
  const a = arena()
  a.phase = 'combat'
  a.spawnQueue = [{ kind: 'walker', delay: 0 }]
  a.spawnTimer = 0
  const b = structuredClone(a)
  const savedRandom = Math.random
  try {
    Math.random = () => { throw new Error('引擎不应调用 Math.random') }
    const nextA = tick(a, 0.05)
    const nextB = tick(b, 0.05)
    check('事件随机：相同状态与输入生成相同出怪位置',
      nextA.enemies.length === 1 && nextA.enemies[0].x === nextB.enemies[0].x,
      `a=${nextA.enemies[0]?.x} b=${nextB.enemies[0]?.x}`)
    check('事件随机：不同事件/流得到不同样本',
      eventRandom(42, 0) !== eventRandom(43, 0) && eventRandom(42, 0) !== eventRandom(42, 1))
  } catch (error) {
    check('引擎逻辑不调用 Math.random', false, String(error))
  } finally {
    Math.random = savedRandom
  }
}

console.log('== v2.58：关卡目标系统 ==')
{
  const savedObjective = structuredClone(LEVEL.objective)
  try {
    const legacy = defaultLevel() as Partial<ReturnType<typeof defaultLevel>>
    delete legacy.objective
    const migrated = parseLevel(JSON.stringify(legacy))
    check('旧关卡缺少 objective 时迁移为 6 波保卫', migrated.objective.type === 'defend' && migrated.objective.waves === 6)
    const legacyDirections = defaultLevel()
    legacyDirections.version = 17
    const legacyStage = legacyDirections.stages[0]
    if (legacyStage.objective.type === 'defend') {
      delete (legacyStage.objective as { spawnRegions?: unknown }).spawnRegions
      legacyStage.objective.spawnDirections = ['left', 'right']
    }
    const migratedDirections = parseLevel(JSON.stringify(legacyDirections))
    const migratedRegions = migratedDirections.stages[0].objective.type === 'defend' ? migratedDirections.stages[0].objective.spawnRegions : []
    check('出生区域迁移：旧左右方向转换为两个编号边缘区域', migratedRegions.length === 2 && migratedRegions[0].id === 1 && migratedRegions[1].id === 2 && migratedRegions.every(region => region.cells.length > 0))

    configureObjective(LEVEL, { type: 'defend', waves: 1 })
    let defend = arena()
    defend.phase = 'combat'
    defend.spawnQueue = []
    defend.enemies = []
    defend = tick(defend, 0.1)
    check('保卫目标：清空配置的最后一波后判胜', defend.phase === 'won')

    configureObjective(LEVEL, { type: 'survive', duration: 10 })
    let survive = arena()
    survive.phase = 'combat'
    survive.objectiveElapsed = 9.95
    survive.spawnQueue = [{ kind: 'walker', delay: 10 }]
    survive.spawnTimer = 10
    survive = tick(survive, 0.1)
    check('生存目标：交战累计达到时长时即判胜', survive.phase === 'won' && survive.objectiveElapsed >= 10)

    let destroyed = arena()
    destroyed.phase = 'combat'
    destroyed.objectiveElapsed = 9.95
    destroyed.fortress.hp = 0
    destroyed = tick(destroyed, 0.1)
    check('生存目标：同 tick 堡垒被毁时毁灭序列优先于胜利', destroyed.phase !== 'won' && destroyed.fortress.dyingT >= 0)
  } finally {
    LEVEL.objective = savedObjective
  }
}

console.log('== 关卡起点统一出生规则 ==')
{
  const savedLevel = structuredClone(LEVEL)
  try {
    LEVEL.startZone = { x: 4, y: 5, w: 10, h: 12 }
    configureObjective(LEVEL, { type: 'defend', waves: 1 })
    const state = initialState()
    const rect = fortressRect(state)
    const centerX = rect.x + rect.w / 2
    const centerY = rect.y + rect.h / 2
    check('防守任务：玩家战车也在关卡起点区域中心出生',
      Math.abs(centerX - (LEVEL.startZone.x + LEVEL.startZone.w / 2)) < 1e-9
      && Math.abs(centerY - (LEVEL.startZone.y + LEVEL.startZone.h / 2)) < 1e-9,
      `center=(${centerX.toFixed(2)},${centerY.toFixed(2)}) start=(${LEVEL.startZone.x + LEVEL.startZone.w / 2},${LEVEL.startZone.y + LEVEL.startZone.h / 2})`)

    const assemblyState = structuredClone(state)
    assemblyState.phase = 'combat'
    assemblyState.gold = 9999
    assemblyState.modules = []
    check('起点装配：交战阶段以载具几何中心判断仍位于起点区域', fortressInStartZone(assemblyState) && fortressAssemblyAllowed(assemblyState))
    const shieldDef = MODULE_DEFS.find(module => module.id === 'shield_generator')!
    let moduleSpot: { x: number; y: number; rot: 0 | 1 } | undefined
    for (const rot of [0, 1] as const) for (let y = 0; y < fortressDef(assemblyState).interior.rows; y++) for (let x = 0; x < fortressDef(assemblyState).interior.cols; x++) {
      if (!moduleSpot && canPlaceModule(assemblyState, shieldDef.id, x, y, rot).ok) moduleSpot = { x, y, rot }
    }
    const withModule = moduleSpot ? buildModule(assemblyState, shieldDef.id, moduleSpot.x, moduleSpot.y, moduleSpot.rot) : assemblyState
    check('起点装配：交战中可在起点区域配置模块', !!moduleSpot && withModule.modules.some(module => module.defId === shieldDef.id))

    const turretDef = TURRET_DEFS.find(turret => turret.id === 'mg')!
    const hardpoint = fortressDef(assemblyState).hardpoints.find(point => point.size === turretDef.mount
      && (!point.types || point.types.includes(turretDef.type))
      && !assemblyState.turrets.some(turret => turret.hardpointId === point.id))
    const withTurret = hardpoint ? mountTurret(assemblyState, turretDef.id, hardpoint.id) : assemblyState
    check('起点装配：交战中可在起点区域配置炮塔', !!hardpoint && withTurret.turrets.length === assemblyState.turrets.length + 1)

    const outside = structuredClone(assemblyState)
    outside.fortress.x = LEVEL.startZone.x + LEVEL.startZone.w + 2
    outside.fortress.y = LEVEL.startZone.y
    check('起点装配：驶离起点区域后立即关闭普通装配权限', !fortressInStartZone(outside) && !fortressAssemblyAllowed(outside))
    const rejectedModule = moduleSpot ? buildModule(outside, shieldDef.id, moduleSpot.x, moduleSpot.y, moduleSpot.rot) : outside
    check('起点装配：区域外引擎入口同样拒绝配置', rejectedModule.modules.length === outside.modules.length)

    const finished = structuredClone(assemblyState)
    finished.phase = 'won'
    check('起点装配：关卡结束后即使仍在起点也不可继续配置', fortressInStartZone(finished) && !fortressAssemblyAllowed(finished))
  } finally {
    for (const key of Object.keys(LEVEL)) delete (LEVEL as unknown as Record<string, unknown>)[key]
    Object.assign(LEVEL, savedLevel)
    invalidateWallInfo()
  }
}

console.log('== 堡垒防御系统 ==')
{
  const savedLevel = structuredClone(LEVEL)
  try {
    const legacyLevel = defaultLevel()
    delete (legacyLevel.stages[0].waves[0] as Partial<typeof legacyLevel.stages[0].waves[0]>).enemyDamageMultiplier
    const normalizedLegacy = parseLevel(JSON.stringify(legacyLevel))
    const configuredLevel = defaultLevel()
    configuredLevel.stages[0].waves[0].enemyDamageMultiplier = 1.5
    const normalizedConfigured = parseLevel(JSON.stringify(configuredLevel))
    check('波次敌人强度：旧关卡缺省为 1，配置 1.5 后保持 1.5',
      normalizedLegacy.stages[0].waves[0].enemyDamageMultiplier === 1
      && normalizedConfigured.stages[0].waves[0].enemyDamageMultiplier === 1.5)
    const originalState = initialState()
    const originalDefId = originalState.fortressDefId
    const defenseDef = playableVehicleDefs().find(def => def.id !== originalDefId) ?? playableVehicleDefs()[0]
    const objective = {
      type: 'fortressDefense' as const, waves: 1, waveWait: true, restTime: 5, overlapTime: 2,
      spawnRegions: [
        { id: 1, cells: ['1,1'] }, { id: 2, cells: ['3,1'] },
        { id: 3, cells: ['5,1'] }, { id: 4, cells: ['7,1'] },
      ],
      fortressDefId: defenseDef.id, fortressPoint: { x: 9.5, y: 10.5 }, returnPoint: { x: 6.5, y: 7.5 },
    }
    LEVEL.mode = 'defend'
    configureObjective(LEVEL, { ...objective, spawnRegions: structuredClone(objective.spawnRegions) })
    const playerBaseUnit = unitLibrary().find(unit => !!unit.vehiclePlatform || unit.legacy?.registry === 'fortress')!
    const playerBasePlatform = playerBaseUnit.vehiclePlatform ?? (playerBaseUnit.legacy?.registry === 'fortress' ? playerBaseUnit.legacy.def : undefined)!
    const playerBaseUnitId = playerBaseUnit.id
    LEVEL.initialUnits.push({
      id: 987654, unitDefId: playerBaseUnitId, faction: 'player', controller: 'ai',
      x: 3.5, y: 3.5, rotation: 0, lockMovement: true, lockRotation: true, behavior: 'static',
    })
    const stage = LEVEL.stages[0]
    const enemyUnit = unitLibrary().find(unit => unit.type === 'vehicle') ?? unitLibrary()[0]
    stage.waves[0].enemyDamageMultiplier = 1.5
    stage.waves[0].entries = [
      { id: 'fortress-region-specified', unitDefId: enemyUnit.id, count: 1, delay: 0, interval: 0, spawnRegionId: 3 },
      { id: 'fortress-region-random', unitDefId: enemyUnit.id, count: 1, delay: 0, interval: 0 },
    ]
    let state = initialState()
    state.enemies = []
    state.ambushQueue = []
    const center = fortressRect(state)
    check('堡垒防御进入：玩家载具完整快照被保存并切换关卡指定堡垒',
      state.fortressDefenseSnapshot?.fortressDefId === originalDefId && state.fortressDefId === defenseDef.id)
    check('堡垒防御位置：堡垒几何中心使用任务阶段坐标',
      Math.abs(center.x + center.w / 2 - 9.5) < 1e-6 && Math.abs(center.y + center.h / 2 - 10.5) < 1e-6)
    state.moveDir = { x: 0, y: -1 }; state.moveMag = 1
    state = tick(state, 0.25)
    const locked = fortressRect(state)
    check('堡垒防御机动：即使收到移动输入也保持原位', Math.abs(locked.x + locked.w / 2 - 9.5) < 1e-6 && Math.abs(locked.y + locked.h / 2 - 10.5) < 1e-6)
    state.gold = 999
    const groundPlacementRejected = placeTurret(state, 'mg', 3, 3)
    const playerBase = state.allies.find(ally => ally.placementId === 987654)!
    const baseLoadout = playerUnitCombatLoadout(state, playerBase.id)!
    const editableHardpoint = playerBasePlatform.hardpoints.find(point => !point.lockedTurret)!
    const compatibleTurret = TURRET_DEFS.find(turret => turret.mount === editableHardpoint.size && (!editableHardpoint.types || editableHardpoint.types.includes(turret.type)))!
    const emptied = { ...baseLoadout, turrets: baseLoadout.turrets.filter(item => item.hardpointId !== editableHardpoint.id) }
    state = applyPlayerUnitCombatLoadout(state, playerBase.id, emptied)
    const installPreset = { ...emptied, turrets: [...emptied.turrets, { hardpointId: editableHardpoint.id, turretDefId: compatibleTurret.id }] }
    const installCost = playerUnitLoadoutChangeCost(state, playerBase.id, installPreset)
    const beforeInstallGold = state.gold
    state = applyPlayerUnitCombatLoadout(state, playerBase.id, installPreset)
    const fixedTurret = state.allies.find(ally => ally.id === playerBase.id)?.vehicle?.turrets?.find(turret => turret.hardpointId === editableHardpoint.id)
    check('堡垒固定火力点：地面槽位建造关闭，锁定车体的玩家单位炮位在准备阶段消耗资源整备',
      groundPlacementRejected === state || groundPlacementRejected.turrets.length === state.turrets.length
      ? !!fixedTurret && installCost !== null && state.gold === Math.max(0, beforeInstallGold - installCost)
      : false)
    const fixedTurretId = fixedTurret?.id
    state = startWave(state, 0)
    check('编号出生区域：波次队列保留指定区域，随机条目不锁定编号', state.spawnQueue[0]?.spawnRegionId === 3 && state.spawnQueue[1]?.spawnRegionId === undefined)
    check('波次敌人强度：整波队列携带 1.5 倍攻击伤害系数', state.spawnQueue.every(item => item.damageMultiplier === 1.5))
    const specifiedSpawn = defenseWaveSpawnPoint(state.objective, 3, state.nextId)
    check('编号出生区域：指定区域从对应区域格中心生成', specifiedSpawn.regionId === 3 && specifiedSpawn.x === 5.5 && specifiedSpawn.y === 1.5)
    const randomSpawn = defenseWaveSpawnPoint(state.objective, undefined, state.nextId)
    check('编号出生区域：随机模式只会从当前阶段的非空区域生成', objective.spawnRegions.some(region => region.id === randomSpawn.regionId && region.cells.some(key => { const [x, y] = key.split(',').map(Number); return randomSpawn.x === x + 0.5 && randomSpawn.y === y + 0.5 })))
    state.spawnTimer = 0
    state = tick(state, 0.01)
    check('波次敌人强度：生成后的敌人实例保留 1.5 倍系数', state.enemies.some(enemy => enemy.damageMultiplier === 1.5))
    state.spawnQueue = []; state.enemies = []; state.eventQueue = []; state.ambushQueue = []
    state = tick(state, 0.1)
    const restored = fortressRect(state)
    check('堡垒防御退出：恢复原载具且朝向重置，并在指定返回点出现',
      state.phase === 'won' && state.fortressDefId === originalDefId && !state.fortressDefenseSnapshot && state.fortress.heading === 0
      && Math.abs(restored.x + restored.w / 2 - 6.5) < 1e-6 && Math.abs(restored.y + restored.h / 2 - 7.5) < 1e-6)
    const defenseUnitId = defenseDef.unitId ?? fortressUnitId(defenseDef.id)
    check('堡垒防御退出：存活堡垒转为友方单位，玩家单位炮位永久留场',
      state.allies.some(ally => ally.unitDefId === defenseUnitId)
      && state.allies.some(ally => ally.placementId === 987654 && ally.vehicle?.turrets?.some(turret => turret.id === fixedTurretId)),
      JSON.stringify({ defenseUnitId, allies: state.allies.map(ally => [ally.unitDefId, ally.placementId, ally.vehicle?.turrets?.map(turret => turret.id)]) }))
  } finally {
    for (const key of Object.keys(LEVEL)) delete (LEVEL as unknown as Record<string, unknown>)[key]
    Object.assign(LEVEL, savedLevel)
    invalidateWallInfo()
  }
}

console.log('== v2.59：推进模式骨架 ==')
{
  const savedLevel = structuredClone(LEVEL)
  try {
    LEVEL.mode = 'advance'
    LEVEL.startZone = { x: 12, y: LEVEL.rows - 6, w: 8, h: 5 }
    LEVEL.finishZone = { x: 4, y: 0, w: LEVEL.cols - 8, h: 6 }
    const stageFinish = { x: 2, y: 8, w: 3, h: 2 }
    configureObjective(LEVEL, { type: 'reach', finishZone: stageFinish })

    const opened = initialState()
    const openedCenter = fortressRect(opened)
    const ocx = openedCenter.x + openedCenter.w / 2
    const ocy = openedCenter.y + openedCenter.h / 2
    check('推进模式：开局直接交战且不暗中生成防守波次', opened.phase === 'combat' && opened.prepLeft === 0 && opened.spawnQueue.length === 0)
    check('推进模式：堡垒中心出生在玩家起点区域',
      ocx >= LEVEL.startZone.x && ocx <= LEVEL.startZone.x + LEVEL.startZone.w
      && ocy >= LEVEL.startZone.y && ocy <= LEVEL.startZone.y + LEVEL.startZone.h,
      `center=(${ocx.toFixed(2)},${ocy.toFixed(2)})`)

    let reached = structuredClone(opened)
    reached.spawnQueue = [{ kind: 'walker', delay: 10 }]
    reached.spawnTimer = 10
    reached.fortress.x = stageFinish.x + stageFinish.w / 2 - fortressRect(reached).w / 2
    reached.fortress.y = stageFinish.y + stageFinish.h / 2 - fortressRect(reached).h / 2
    check('reach 目标：每个任务阶段使用自己的终点而非关卡全局终点', fortressReachedFinish(reached))
    reached = tick(reached, 0.1)
    check('reach 目标：进入终点后判胜', reached.phase === 'won')

    const disconnected = structuredClone(opened)
    disconnected.objective = { type: 'reach', finishCells: ['2,8', '3,8', '10,12'] }
    disconnected.fortress.x = 6.5 - fortressRect(disconnected).w / 2
    disconnected.fortress.y = 8.5 - fortressRect(disconnected).h / 2
    check('reach 不规则区域：两块终点之间的空白不会误判完成', !fortressReachedFinish(disconnected))
    disconnected.fortress.x = 10.5 - fortressRect(disconnected).w / 2
    disconnected.fortress.y = 12.5 - fortressRect(disconnected).h / 2
    check('reach 不相连区域：进入任一独立终点块都可完成', fortressReachedFinish(disconnected))

    let destroyedAtFinish = structuredClone(opened)
    destroyedAtFinish.spawnQueue = [{ kind: 'walker', delay: 10 }]
    destroyedAtFinish.fortress.x = stageFinish.x + stageFinish.w / 2 - fortressRect(destroyedAtFinish).w / 2
    destroyedAtFinish.fortress.y = stageFinish.y + stageFinish.h / 2 - fortressRect(destroyedAtFinish).h / 2
    destroyedAtFinish.fortress.hp = 0
    destroyedAtFinish = tick(destroyedAtFinish, 0.1)
    check('reach 目标：同 tick 堡垒被毁时毁灭序列优先', destroyedAtFinish.phase !== 'won' && destroyedAtFinish.fortress.dyingT >= 0)

    let nextWave = structuredClone(opened)
    nextWave.fortress.x = LEVEL.startZone.x
    nextWave.fortress.y = LEVEL.startZone.y
    nextWave.spawnQueue = []
    nextWave.enemies = []
    const oldWave = nextWave.wave
    nextWave = tick(nextWave, 0.1)
    check('推进模式：清场后保持当前阶段，等待关卡事件或抵达终点',
      nextWave.phase === 'combat' && nextWave.wave === oldWave && nextWave.spawnQueue.length === 0)

    const cameraCell = 10
    const cameraCanvas = 200
    const topLeftCamera = unboundedCenteredView(1, 1, cameraCell, cameraCanvas, cameraCanvas)
    const bottomRightCamera = unboundedCenteredView(LEVEL.cols - 1, LEVEL.rows - 1, cameraCell, cameraCanvas, cameraCanvas)
    check('玩家中心相机：场景边缘仍严格居中并允许视口越界',
      topLeftCamera.x === -9
      && topLeftCamera.y === -9
      && bottomRightCamera.x === LEVEL.cols - 11
      && bottomRightCamera.y === LEVEL.rows - 11)
    check('编辑器相机：仍钳制在关卡边界内',
      clampViewX(-10, cameraCell, cameraCanvas) === 0
      && clampViewY(-10, cameraCell, cameraCanvas) === 0
      && clampViewX(LEVEL.cols, cameraCell, cameraCanvas) === LEVEL.cols - 20
      && clampViewY(LEVEL.rows, cameraCell, cameraCanvas) === LEVEL.rows - 20)
  } finally {
    for (const k of Object.keys(LEVEL)) delete (LEVEL as unknown as Record<string, unknown>)[k]
    Object.assign(LEVEL, savedLevel)
    invalidateWallInfo()
  }
}

console.log('== v2.60：区域伏击触发器 ==')
{
  const savedLevel = structuredClone(LEVEL)
  try {
    LEVEL.mode = 'defend'
    LEVEL.objective = { type: 'defend', waves: 99 }
    LEVEL.triggers = [{
      id: 77, name: '测试伏击', enabled: true,
      x: 2, y: 2, w: 8, h: 6,
      activationLimit: 2, cooldown: 1, delay: 0.2, interval: 0.3,
      enemies: { walker: 2, runner: 0, rusher: 0, brute: 0, flyer: 0 },
      units: { 'unit:uav': 2 },
    }]

    const setCenter = (s: GameState, x: number, y: number) => {
      const r = fortressRect(s)
      s.fortress.x = x - r.w / 2
      s.fortress.y = y - r.h / 2
    }
    let entered = initialState()
    entered.phase = 'combat'
    entered.spawnQueue = [{ kind: 'walker', delay: 100 }]
    entered.spawnTimer = 100
    setCenter(entered, 20, 20)
    entered = tick(entered, 0.1)
    const preEntry = structuredClone(entered)
    setCenter(entered, 5, 5)
    const sameEntry = structuredClone(preEntry)
    setCenter(sameEntry, 5, 5)
    entered = tick(entered, 0.1)
    const deterministic = tick(sameEntry, 0.1)
    check('区域伏击：堡垒由外进入后按配置建立延迟队列',
      entered.triggerStates.find(t => t.id === 77)?.activations === 1
      && entered.ambushQueue.length === 2
      && entered.enemies.length === 0,
      `activations=${entered.triggerStates[0]?.activations} queue=${entered.ambushQueue.length}`)
    check('区域伏击：同一状态的刷怪位置与时序可复现',
      JSON.stringify(entered.ambushQueue) === JSON.stringify(deterministic.ambushQueue))

    entered = tick(entered, 0.1)
    check('区域伏击：首次延迟到期后刷出第一名敌人', entered.enemies.length === 1 && entered.ambushQueue.length === 1)
    entered = tick(entered, 0.31)
    check('区域伏击：按间隔刷完其余敌人', entered.enemies.length === 2 && entered.ambushQueue.length === 0)
    entered = tick(entered, 0.2)
    check('区域伏击：持续停留在区域内不会重复触发', entered.triggerStates[0]?.activations === 1 && entered.ambushQueue.length === 0)

    entered.enemies = []
    setCenter(entered, 20, 20)
    entered = tick(entered, 1.1)
    setCenter(entered, 5, 5)
    entered = tick(entered, 0.1)
    check('区域伏击：离开且冷却结束后可再次触发', entered.triggerStates[0]?.activations === 2 && entered.ambushQueue.length === 2)

    entered.ambushQueue = []
    setCenter(entered, 20, 20)
    entered = tick(entered, 1.1)
    setCenter(entered, 5, 5)
    entered = tick(entered, 0.1)
    check('区域伏击：达到次数上限后不再触发', entered.triggerStates[0]?.activations === 2 && entered.ambushQueue.length === 0)

    LEVEL.triggers = []
    LEVEL.objective = { type: 'defend', waves: 1 }
    let pending = initialState()
    pending.phase = 'combat'
    pending.spawnQueue = []
    pending.enemies = []
    pending.ambushQueue = [{ triggerId: 77, kind: 'walker', left: 10, x: 5, y: 5 }]
    pending = tick(pending, 0.1)
    check('区域伏击：待刷伏击队列会阻止波次提前结束', pending.phase === 'combat' && pending.ambushQueue.length === 1)

    const migrated = parseLevel(JSON.stringify({ version: 8 }))
    check('区域伏击：v8 旧关卡迁移到 v18 并补空分层/统一事件', migrated.version === 18 && migrated.triggers.length === 0 && migrated.interactables.length === 0 && migrated.events.length === 0 && migrated.initialUnits.length === 0)
  } finally {
    for (const k of Object.keys(LEVEL)) delete (LEVEL as unknown as Record<string, unknown>)[k]
    Object.assign(LEVEL, savedLevel)
    invalidateWallInfo()
  }
}

console.log('== v2.62：多关卡库 ==')
{
  const savedLibrary = levelLibraryForExport()
  try {
    const legacy = defaultLevel(36, 24)
    legacy.mode = 'advance'
    configureObjective(legacy as typeof LEVEL, { type: 'reach' })
    const migrated = parseLevelLibrary(null, JSON.stringify(legacy))
    check('多关卡库：旧单关卡存档迁移为关卡 01 且内容保留',
      migrated.version === 1 && migrated.activeId === 'level-1' && migrated.levels.length === 1
      && migrated.levels[0].name === '关卡 01' && migrated.levels[0].level.mode === 'advance')

    const a = defaultLevel(40, 30)
    const b = defaultLevel(48, 32)
    b.mode = 'advance'; configureObjective(b as typeof LEVEL, { type: 'reach' })
    const library = defaultLevelLibrary(a)
    library.levels.push({ id: 'level-2', name: '推进测试', level: b })
    library.activeId = 'level-2'
    const normalized = parseLevelLibrary(JSON.stringify(library))
    check('多关卡库：多条目顺序、名称和活动 id 往返保留',
      normalized.levels.length === 2 && normalized.levels[0].level.rows === 40
      && normalized.levels[1].name === '推进测试' && normalized.activeId === 'level-2')

    const duplicateIds = parseLevelLibrary(JSON.stringify({ version: 1, activeId: 'missing', levels: [
      { id: 'same', name: '', level: a }, { id: 'same', name: '第二关', level: b },
    ] }))
    check('多关卡库：重复 id 自动消歧、空名称补默认、坏活动 id 回落首关',
      duplicateIds.levels[0].id !== duplicateIds.levels[1].id
      && duplicateIds.levels[0].name === '关卡 01' && duplicateIds.activeId === duplicateIds.levels[0].id)

    saveLevelLibrary(library)
    check('多关卡库：保存后 LEVEL 切换为活动试玩关卡',
      LEVEL_LIBRARY.activeId === 'level-2' && LEVEL.mode === 'advance' && LEVEL.rows === 48 && LEVEL.cols === 32)

    LEVEL.triggers.push({ id: 9, name: '同步测试', enabled: true, x: 1, y: 1, w: 2, h: 2, activationLimit: 1, cooldown: 0, delay: 0, interval: 0, enemies: { walker: 1, runner: 0, rusher: 0, brute: 0, flyer: 0 } })
    const exported = levelLibraryForExport()
    check('多关卡库：导出快照前会同步当前 LEVEL 到活动条目',
      exported.levels.find(x => x.id === 'level-2')?.level.triggers.some(t => t.name === '同步测试') === true)

    const capped = parseLevelLibrary(JSON.stringify({ version: 1, activeId: 'level-1', levels: Array.from({ length: 55 }, (_, i) => ({ id: `level-${i + 1}`, name: `关卡${i + 1}`, level: a })) }))
    check('多关卡库：最多载入 50 个关卡', capped.levels.length === 50)
  } finally {
    saveLevelLibrary(savedLibrary)
    invalidateWallInfo()
  }
}

console.log('== v2.64：通用事件 / 交互物 / Boss / 关卡链 ==')
{
  const savedLevel = structuredClone(LEVEL)
  try {
    LEVEL.mode = 'defend'
    LEVEL.objective = { type: 'defend', waves: 99 }
    LEVEL.interactables = []
    LEVEL.triggers = [{
      id: 91, name: '事件测试', enabled: true, x: 2, y: 2, w: 6, h: 6,
      activationLimit: 1, cooldown: 0, delay: 0, interval: 0, enemies: { walker: 0, runner: 0, rusher: 0, brute: 0, flyer: 0 },
      actions: [
        { type: 'message', text: '事件开始', duration: 2 },
        { type: 'reward', gold: 50 },
        { type: 'boss', boss: { kind: 'brute', name: '测试巨兽', hpScale: 5, sizeScale: 2, phases: [{ hpPercent: 50, actions: [{ type: 'reward', gold: 25 }] }], defeatActions: [{ type: 'reward', gold: 75 }, { type: 'message', text: 'Boss 已击败', duration: 2 }] } },
      ],
    }]
    const setCenter = (s: GameState, x: number, y: number) => {
      const r = fortressRect(s); s.fortress.x = x - r.w / 2; s.fortress.y = y - r.h / 2
    }
    let s = initialState(); s.phase = 'combat'; s.spawnQueue = [{ kind: 'walker', delay: 100 }]; s.spawnTimer = 100
    setCenter(s, 20, 20); s = tick(s, 0.1); setCenter(s, 5, 5); const beforeGold = s.gold; s = tick(s, 0.1)
    const boss = s.enemies.find(e => e.bossName === '测试巨兽')
    check('通用事件：区域按顺序执行提示、奖励与 Boss 动作', !!boss && s.gold === beforeGold + 50 && s.notices.some(n => n.text === '事件开始'))
    check('Boss：生命/体型倍率与名称写入运行时', !!boss && boss.maxHp > ENEMY_DEFS.brute.hp && boss.bossSizeScale === 2)
    if (boss) boss.hp = boss.maxHp * 0.4
    s = tick(s, 0.1)
    check('Boss：生命阈值阶段动作仅触发一次', s.gold === beforeGold + 75 && s.enemies.find(e => e.id === boss?.id)?.bossPhaseDone?.length === 1)
    s = tick(s, 0.1)
    check('Boss：持续低于阈值不重复触发阶段', s.gold === beforeGold + 75)
    const liveBoss = s.enemies.find(e => e.id === boss?.id); if (liveBoss) liveBoss.hp = 0
    s = tick(s, 0.1)
    check('Boss：击败动作执行奖励与提示', s.gold >= beforeGold + 150 && s.notices.some(n => n.text === 'Boss 已击败'))

    LEVEL.triggers = [{ id: 92, name: '等待测试', enabled: true, x: 10, y: 10, w: 4, h: 4, activationLimit: 1, cooldown: 0, delay: 0, interval: 0, enemies: { walker: 0, runner: 0, rusher: 0, brute: 0, flyer: 0 }, actions: [{ type: 'wait', seconds: 0.5 }, { type: 'reward', gold: 20 }] }]
    s = initialState(); s.phase = 'combat'; s.spawnQueue = [{ kind: 'walker', delay: 100 }]; s.spawnTimer = 100; setCenter(s, 20, 20); s = tick(s, 0.1); setCenter(s, 11, 11); const waitGold = s.gold; s = tick(s, 0.1); s = tick(s, 0.3)
    check('通用事件：等待动作阻塞后续动作', s.gold === waitGold && s.eventQueue.length === 1)
    s = tick(s, 0.3)
    check('通用事件：等待结束继续执行奖励', s.gold === waitGold + 20 && s.eventQueue.length === 0)

    check('次要目标：新一局开始时两个完成标记都未达成', !s.secondaryObjectivesCompleted[0] && !s.secondaryObjectivesCompleted[1])
    s.eventQueue.push({ id: s.nextId++, sourceId: 0, zone: { x: 0, y: 0, w: 1, h: 1 }, actions: [
      { type: 'taskResult', target: 'secondary1', state: 'complete' },
      { type: 'taskResult', target: 'secondary2', state: 'complete' },
    ], index: 0, waitLeft: 0 })
    s = tick(s, 0.1)
    check('次要目标：事件动作分别完成次要目标 1/2', s.secondaryObjectivesCompleted[0] && s.secondaryObjectivesCompleted[1])
    const normalizedSecondaryActions = normalizeEventActions([{ type: 'completeSecondary1' }, { type: 'completeSecondary2' }])
    const normalizedAudioActions = normalizeEventActions([{ type: 'sound', presetId: 'sound-alert' }, { type: 'music', assetId: 'bgm-boss', mode: 'override' }, { type: 'music', assetId: '', mode: 'restore' }])
    check('音频动作：声音预设、临时 BGM 与恢复关卡 BGM 可随统一事件协议保存', normalizedAudioActions.length === 3
      && normalizedAudioActions[0]?.type === 'sound' && normalizedAudioActions[0].presetId === 'sound-alert'
      && normalizedAudioActions[1]?.type === 'music' && normalizedAudioActions[1].mode === 'override'
      && normalizedAudioActions[2]?.type === 'music' && normalizedAudioActions[2].mode === 'restore')
    check('次要目标：旧完成动作迁移到统一任务结果指令', normalizedSecondaryActions[0]?.type === 'taskResult' && normalizedSecondaryActions[0].target === 'secondary1' && normalizedSecondaryActions[1]?.type === 'taskResult' && normalizedSecondaryActions[1].target === 'secondary2')
    s.globalVariables = { 'global:rescued': 1 }
    s.eventQueue.push({ id: s.nextId++, sourceId: 0, zone: { x: 0, y: 0, w: 1, h: 1 }, actions: [
      { type: 'globalVariable', operation: 'set', variableId: 'global:rescued', value: 4 },
      { type: 'globalVariable', operation: 'add', variableId: 'global:rescued', value: 3 },
    ], index: 0, waitLeft: 0 })
    s = tick(s, 0.1)
    check('全局变量：设置与增减动作写入独立运行时值', s.globalVariables['global:rescued'] === 7)
    const normalizedGlobalActions = normalizeEventActions([{ type: 'setGlobalVariable', variableId: 'global:rescued', value: true }, { type: 'addGlobalVariable', variableId: 'global:count', value: 2 }])
    check('全局变量：旧设置/增减动作迁移到统一指令', normalizedGlobalActions[0]?.type === 'globalVariable' && normalizedGlobalActions[0].operation === 'set' && normalizedGlobalActions[1]?.type === 'globalVariable' && normalizedGlobalActions[1].operation === 'add')

    s.gold = 5; s.ammo = 3; s.energy = 2
    const suppliedAmmoTurret = mkTurret(s, 'mg', 4, 20); suppliedAmmoTurret.ammo = 5
    const suppliedEnergyTurret = mkTurret(s, 'beam', 5, 20); suppliedEnergyTurret.energy = 4
    s.eventQueue.push({ id: s.nextId++, sourceId: 0, zone: { x: 0, y: 0, w: 1, h: 1 }, actions: [{ type: 'supply', gold: -50, ammo: -20, energy: -10 }], index: 0, waitLeft: 0 })
    s = tick(s, 0.1)
    check('增减补给：负数扣除资源与每座玩家炮塔储量且最低为 0',
      s.gold === 0 && s.ammo === 0 && s.energy === 0
      && byId(s.turrets, suppliedAmmoTurret.id)!.ammo === 0 && byId(s.turrets, suppliedEnergyTurret.id)!.energy === 0)
    const exchangeAmmoDef = TURRET_DEFS.find(def => def.id === 'mg')!
    const originalExchangeRate = exchangeAmmoDef.ammoExchangeRate
    exchangeAmmoDef.ammoExchangeRate = 0.5
    s.phase = 'prep'
    s.eventQueue.push({ id: s.nextId++, sourceId: 0, zone: { x: 0, y: 0, w: 1, h: 1 }, actions: [{ type: 'supply', gold: 0, ammo: 2, energy: 0 }], index: 0, waitLeft: 0 })
    s = tick(s, 0.1)
    check('弹药汇率：增减补给输入2单位、汇率0.5时只恢复1发',
      byId(s.turrets, suppliedAmmoTurret.id)!.ammo === 1)
    exchangeAmmoDef.ammoExchangeRate = originalExchangeRate

    const normalizedSupplyZone = normalizeEventActions([{ type: 'supplyZone', ammoEnabled: true, ammoPerSec: 12, energyEnabled: false, energyPerSec: 9999 }])
    check('功能区域协议：旧补给区自动迁移，并分别钳制各项效率',
      normalizedSupplyZone[0]?.type === 'functionalArea' && normalizedSupplyZone[0].ammoEnabled && normalizedSupplyZone[0].ammoPerSec === 12
      && !normalizedSupplyZone[0].energyEnabled && normalizedSupplyZone[0].energyPerSec === 1000 && !normalizedSupplyZone[0].repairEnabled && !normalizedSupplyZone[0].assemblyEnabled)
    LEVEL.events = [{
      id: 204, name: '炮塔补给区', category: 'flow', enabled: true, activationLimit: 0, cooldown: 0,
      conditions: { mode: 'all', conditions: [] }, trigger: { type: 'regionStay', cells: ['4,4'] },
      actions: [{ type: 'functionalArea', ammoEnabled: true, ammoPerSec: 10, energyEnabled: true, energyPerSec: 20, repairEnabled: true, structurePerSec: 30, armorPerSec: 40, assemblyEnabled: true }],
    }]
    let supplyState = initialState(); supplyState.phase = 'prep'; supplyState.enemies = []; supplyState.allies = []; supplyState.spawnQueue = [{ kind: 'walker', delay: 100 }]; supplyState.spawnTimer = 100
    const zoneAmmoTurret = mkTurret(supplyState, 'mg', 4, 20); zoneAmmoTurret.ammo = 0
    const zoneEnergyTurret = mkTurret(supplyState, 'beam', 5, 20); zoneEnergyTurret.energy = 0
    exchangeAmmoDef.ammoExchangeRate = 0.5
    setCenter(supplyState, 4.5, 4.5)
    supplyState = tick(supplyState, 0.1)
    const ammoBeforeZoneTick = byId(supplyState.turrets, zoneAmmoTurret.id)!.ammo ?? 0
    const energyBeforeZoneTick = byId(supplyState.turrets, zoneEnergyTurret.id)!.energy ?? 0
    const hpBeforeZoneTick = supplyState.fortress.hp = supplyState.fortress.maxHp - 100
    supplyState.fortress.armor.front = Math.max(0, supplyState.fortress.maxArmor.front - 100)
    const armorBeforeZoneTick = supplyState.fortress.armor.front
    supplyState = tick(supplyState, 1)
    check('功能区域：停留区域内补充炮塔资源并修理结构/装甲',
      supplyState.functionalAreas.length === 1
      && Math.abs((byId(supplyState.turrets, zoneAmmoTurret.id)!.ammo ?? 0) - ammoBeforeZoneTick - 5) < 1e-6
      && Math.abs((byId(supplyState.turrets, zoneEnergyTurret.id)!.energy ?? 0) - energyBeforeZoneTick - 20) < 1e-6
      && Math.abs(supplyState.fortress.hp - hpBeforeZoneTick - 30) < 1e-6
      && Math.abs(supplyState.fortress.armor.front - armorBeforeZoneTick - Math.min(40, supplyState.fortress.maxArmor.front - armorBeforeZoneTick)) < 1e-6,
      JSON.stringify({ zones: supplyState.functionalAreas, ammoBeforeZoneTick, ammo: byId(supplyState.turrets, zoneAmmoTurret.id)!.ammo, energyBeforeZoneTick, energy: byId(supplyState.turrets, zoneEnergyTurret.id)!.energy }))
    const activeSupply = fortressSupplyStatus(supplyState)
    check('功能区域反馈：可汇总补弹、充能、修理与整备',
      activeSupply.inside && activeSupply.ammo && activeSupply.energy && activeSupply.repair && activeSupply.assembly
      && activeSupply.ammoPerSec === 10 && activeSupply.energyPerSec === 20 && activeSupply.structurePerSec === 30 && activeSupply.armorPerSec === 40)
    check('服务区域显示：可从停留事件直接取得不规则功能区域',
      levelServiceZones(supplyState).some(zone => zone.service === 'functional' && zone.cells.includes('4,4') && zone.ammoEnabled && zone.energyEnabled && zone.repairEnabled && zone.assemblyEnabled))
    setCenter(supplyState, 8.5, 8.5)
    const ammoOutside = byId(supplyState.turrets, zoneAmmoTurret.id)!.ammo ?? 0
    const energyOutside = byId(supplyState.turrets, zoneEnergyTurret.id)!.energy ?? 0
    supplyState = tick(supplyState, 1)
    check('功能区域：离开区域后立即停止补充',
      byId(supplyState.turrets, zoneAmmoTurret.id)!.ammo === ammoOutside
      && byId(supplyState.turrets, zoneEnergyTurret.id)!.energy === energyOutside,
      JSON.stringify({ ammoOutside, ammo: byId(supplyState.turrets, zoneAmmoTurret.id)!.ammo, energyOutside, energy: byId(supplyState.turrets, zoneEnergyTurret.id)!.energy }))
    check('功能区域反馈：离开区域后立即结束工作状态', !fortressSupplyStatus(supplyState).inside)
    exchangeAmmoDef.ammoExchangeRate = originalExchangeRate

    LEVEL.events = [{
      id: 205, name: '战车整备区', category: 'flow', enabled: true, activationLimit: 0, cooldown: 0,
      conditions: { mode: 'all', conditions: [] }, trigger: { type: 'regionStay', cells: ['6,6', '7,6', '6,7'] },
      actions: [{ type: 'assembly' }],
    }]
    const assemblyZoneState = initialState(); assemblyZoneState.phase = 'combat'; setCenter(assemblyZoneState, 6.5, 6.5)
    check('整备区：进入不规则停留区域后开放整备权限', fortressInAssemblyZone(assemblyZoneState) && fortressAssemblyAllowed(assemblyZoneState))
    setCenter(assemblyZoneState, LEVEL.startZone.x + LEVEL.startZone.w / 2, LEVEL.startZone.y + LEVEL.startZone.h / 2)
    check('整备区：关卡已配置整备区时不再把起点视为整备区', !fortressInAssemblyZone(assemblyZoneState) && !fortressAssemblyAllowed(assemblyZoneState))

    const stateTestObjects = structuredClone(LEVEL.objects)
    const stateObjectId = 9100
    LEVEL.objects = [{ id: stateObjectId, kind: 'rock', defId: 'object:rock', x: 30, y: 30, w: 1, h: 1, hp: -1, blockMove: false, blockProjectile: false, height: 0, state: 'default' }]
    LEVEL.triggers = []
    LEVEL.interactables = []
    LEVEL.events = [
      { id: 201, name: '写入物体状态', category: 'flow', enabled: true, activationLimit: 1, cooldown: 0, conditions: { mode: 'all', conditions: [] }, trigger: { type: 'missionStart' }, actions: [{ type: 'setObjectState', objectId: stateObjectId, state: 'powered' }] },
      { id: 202, name: '读取物体状态', category: 'flow', enabled: true, activationLimit: 1, cooldown: 0, conditions: { mode: 'all', conditions: [{ kind: 'objectState', objectId: stateObjectId, operator: 'eq', state: 'powered' }] }, trigger: { type: 'automatic' }, actions: [{ type: 'reward', gold: 17 }] },
    ]
    s = initialState(); s.phase = 'combat'; s.spawnQueue = [{ kind: 'walker', delay: 100 }]; s.spawnTimer = 100
    const stateGold = s.gold
    for (let i = 0; i < 4; i++) s = tick(s, 0.1)
    check('物体状态：设置动作与触发条件读写同一实例状态', s.objectStates[stateObjectId] === 'powered' && s.gold === stateGold + 17)

    const stateWorldTypes = snapshotWorldTypeLibrary()
    const stateWallDef = { ...newObjectType(), id: 'object:state-wall', name: '状态围墙', asset: 'builtin:ground/mid', states: ['default', 'open'], blockMove: true, blockProjectile: true }
    saveObjectType(stateWallDef)
    LEVEL.objects = [
      { id: 9201, kind: 'rock', defId: stateWallDef.id, x: 30, y: 30, w: 1, h: 1, hp: -1, blockMove: true, blockProjectile: true, height: 1, renderLayer: 3, state: 'default' },
      { id: 9202, kind: 'rock', defId: stateWallDef.id, x: 31, y: 30, w: 1, h: 1, hp: -1, blockMove: true, blockProjectile: true, height: 1, renderLayer: 3, state: 'default' },
      { id: 9203, kind: 'rock', defId: stateWallDef.id, x: 32, y: 30, w: 1, h: 1, hp: -1, blockMove: true, blockProjectile: true, height: 1, renderLayer: 3, state: 'default' },
      { id: 9204, kind: 'rock', defId: stateWallDef.id, x: 35, y: 30, w: 1, h: 1, hp: -1, blockMove: true, blockProjectile: true, height: 1, renderLayer: 3, state: 'default' },
    ]
    LEVEL.events = [{ id: 203, name: '打开连续围墙', category: 'flow', enabled: true, activationLimit: 1, cooldown: 0, conditions: { mode: 'all', conditions: [] }, trigger: { type: 'missionStart' }, actions: [{ type: 'setObjectState', objectId: 9202, state: 'open' }] }]
    s = initialState(); s.phase = 'combat'; s.spawnQueue = [{ kind: 'walker', delay: 100 }]; s.spawnTimer = 100
    for (let i = 0; i < 3; i++) s = tick(s, 0.1)
    check('物体状态：Autotile 连通组选择任意一格会同步整组', [9201, 9202, 9203].every(id => s.objectStates[id] === 'open') && s.objectStates[9204] === 'default')
    check('物体状态：连通组打开时统一解除阻挡，非连通同类不受影响', [9201, 9202, 9203].every(id => { const object = s.objects.find(item => item.id === id); return object && !object.blockMove && !object.blockProjectile }) && !!s.objects.find(item => item.id === 9204)?.blockMove)
    restoreWorldTypeLibrary(stateWorldTypes)
    LEVEL.objects = stateTestObjects

    LEVEL.triggers = []
    LEVEL.events = []
    LEVEL.interactables = [
      { id: 7, name: '测试补给', kind: 'supply', enabled: true, once: true, x: 3, y: 3, w: 3, h: 3, actions: [
        { type: 'reward', gold: 30 },
        { type: 'levelVariable', operation: 'set', variableId: 'var:interacted', value: 1 },
      ] },
      { id: 8, name: '关闭目标', kind: 'target', enabled: true, once: false, x: 8, y: 8, w: 2, h: 2, actions: [] },
    ]
    s = initialState(); s.phase = 'combat'; s.spawnQueue = [{ kind: 'walker', delay: 100 }]; s.spawnTimer = 100; setCenter(s, 20, 20); s = tick(s, 0.1); setCenter(s, 4, 4); const itemGold = s.gold; s = tick(s, 0.1); s = tick(s, 0.1)
    check('场景交互物：进入激活、仅一次并执行动作', s.gold === itemGold + 30 && s.interactableStates.find(x => x.id === 7)?.activations === 1)
    check('通用事件：统一关卡变量指令可写入数值', s.levelVariables['var:interacted'] === 1)

    const jumpStage = defaultStage({ type: 'survive', duration: 30 }); jumpStage.id = 'stage-jump'; jumpStage.name = '跳转测试阶段'
    LEVEL.stages = [LEVEL.stages[0], jumpStage]
    LEVEL.interactables = [{ id: 9, name: '阶段门', kind: 'checkpoint', enabled: true, once: true, x: 3, y: 3, w: 3, h: 3, actions: [{ type: 'stageJump', stageId: jumpStage.id }] }]
    s = initialState(); s.phase = 'combat'; s.spawnQueue = [{ kind: 'walker', delay: 100 }]; s.spawnTimer = 100; setCenter(s, 20, 20); s = tick(s, 0.1); setCenter(s, 4, 4); s = tick(s, 0.1)
    check('任务阶段跳转：切换指定阶段并重新初始化目标计时', s.activeStageId === jumpStage.id && s.objective.type === 'survive' && s.objectiveElapsed === 0)
    s.eventQueue.push({ id: s.nextId++, sourceId: 0, zone: { x: 0, y: 0, w: 1, h: 1 }, actions: [{ type: 'taskResult', target: 'primary', state: 'complete' }], index: 0, waitLeft: 0 })
    s = tick(s, 0.1)
    check('任务结果：主要目标完成会立即判定整关胜利并固化主要目标', s.phase === 'won' && s.levelVariables['builtin:primaryObjectiveCompleted'] === true)
    let failed = initialState(); failed.phase = 'combat'; failed.spawnQueue = [{ kind: 'walker', delay: 100 }]; failed.spawnTimer = 100
    failed.eventQueue.push({ id: failed.nextId++, sourceId: 0, zone: { x: 0, y: 0, w: 1, h: 1 }, actions: [{ type: 'taskResult', target: 'primary', state: 'failed' }], index: 0, waitLeft: 0 })
    failed = tick(failed, 0.1)
    check('任务结果：主要目标失败会立即判定整关失败', failed.phase === 'lost')

    const chain = defaultLevelLibrary(defaultLevel())
    chain.levels[0].nextId = 'level-2'; chain.levels[0].reward = 120
    chain.levels.push({ id: 'level-2', name: '下一关', level: defaultLevel(), nextId: null, reward: 50 })
    const parsedChain = parseLevelLibrary(JSON.stringify(chain))
    check('关卡链：下一关与通关奖励随关卡库往返', parsedChain.levels[0].nextId === 'level-2' && parsedChain.levels[0].reward === 120)
  } finally {
    for (const k of Object.keys(LEVEL)) delete (LEVEL as unknown as Record<string, unknown>)[k]
    Object.assign(LEVEL, savedLevel)
    invalidateWallInfo()
  }
}

console.log('== v2.65：涂装与徽记 ==')
{
  const painted = structuredClone(DEFAULT_FORTRESS)
  painted.paint = { base: '#556B52', accent: '#D0A544', turret: '#8A7654' }
  painted.decals = [{ id: 'badge-1', asset: 'builtin:library/track01', x: 2.5, y: 2, size: 0.8, angle: 15 }]
  check('涂装：主体色、强调色、炮塔色与徽记锚点通过堡垒定义校验', validateFortressDef(painted).length === 0)
  const badPaint = structuredClone(painted); badPaint.paint!.base = 'red'
  check('涂装：非法颜色被保存校验拦截', validateFortressDef(badPaint).some(x => x.includes('主体色')))
  const badTurretPaint = structuredClone(painted); badTurretPaint.paint!.turret = 'red'
  check('涂装：非法炮塔色被保存校验拦截', validateFortressDef(badTurretPaint).some(x => x.includes('炮塔色')))
  const badDecal = structuredClone(painted); badDecal.decals![0].x = painted.w + 1
  check('徽记：越界锚点被保存校验拦截', validateFortressDef(badDecal).some(x => x.includes('锚点超出')))
}

console.log('== v2.66：热管理预览 / 模块规划参考 ==')
{
  const hot = structuredClone(TURRET_DEFS[0]); hot.heatPerShot = 80; hot.fireRate = 1; hot.burst = 1; hot.barrels = 1
  const fort = structuredClone(DEFAULT_FORTRESS); fort.heatCap = 100; fort.heatDissipation = 5
  const curve = simulateTurretHeat(hot, fort, 5, 0.1)
  check('热管理预览：高产热炮塔达到上限并进入过热迟滞', curve.some(p => p.overheated) && Math.max(...curve.map(p => p.heat)) === 100)
  const cold = structuredClone(hot); cold.heatPerShot = 0
  check('热管理预览：零产热曲线保持为零', simulateTurretHeat(cold, fort, 5).every(p => p.heat === 0 && !p.overheated))
  const planFort = structuredClone(DEFAULT_FORTRESS); planFort.w = 2; planFort.h = 2; planFort.shape = ['0,0', '1,0', '0,1', '1,1']; planFort.interior = { cols: 2, rows: 2 }; planFort.interiorCells = undefined
  const planMod = { id: 'plan', name: '规划件', desc: '', cost: 0, w: 1, h: 2, color: '#777777' }
  const fits = modulePlanningFits(planFort, planMod)
  check('模块规划：1×2 模块在 2×2 内部空间两种旋向各有 2 个起点', fits.normal === 2 && fits.rotated === 2, JSON.stringify(fits))
}

console.log('== v2.67：炮塔共用绘制层 ==')
check('炮塔共用绘制：全部出厂炮塔仍通过美术配置校验', TURRET_DEFS.every(d => validateArt(d).ok))

console.log('== v2.68：四向装甲与统一承伤 ==')
{
  let s = initialState()
  const r = fortressRect(s), cx = r.x + r.w / 2, cy = r.y + r.h / 2
  s.fortress.hp = 1000; s.fortress.maxHp = 1000
  s.fortress.armor = { front: 10, rear: 10, left: 10, right: 10 }
  s.fortress.maxArmor = structuredClone(s.fortress.armor)
  check('装甲受击面：朝向 0 时世界上/下/左/右映射前/后/左/右',
    fortressArmorSideAt(s, cx, r.y - 1) === 'front' && fortressArmorSideAt(s, cx, r.y + r.h + 1) === 'rear'
    && fortressArmorSideAt(s, r.x - 1, cy) === 'left' && fortressArmorSideAt(s, r.x + r.w + 1, cy) === 'right')
  const blocked = damageFortress(s, 9, { x: cx, y: r.y - 1, kind: 'projectile' })
  check('统一承伤：伤害低于前装甲时完全格挡且结构不降', blocked.blocked && s.fortress.hp === 1000)
  const overflow = damageFortress(s, 15, { x: cx, y: r.y - 1, kind: 'projectile' })
  check('统一承伤：伤害达到装甲后仅溢出部分伤结构', overflow.structureDamage === 5 && s.fortress.hp === 995)
  const penetrated = damageFortress(s, 10, { x: cx, y: r.y - 1, kind: 'projectile', armorPen: 0.5, armorDamage: 3 })
  check('统一承伤：穿甲部分直伤结构并削弱对应装甲面', penetrated.structureDamage === 5 && penetrated.armorDamage === 3 && s.fortress.hp === 990 && s.fortress.armor.front === 7)
  s.fortress.armor.front = 0
  const unarmored = damageFortress(s, 4, { x: cx, y: r.y - 1, kind: 'aoe' })
  check('统一承伤：装甲削穿后低伤害可直接伤结构', unarmored.structureDamage === 4 && s.fortress.hp === 986)
  s.fortress.heading = Math.PI / 2
  check('装甲受击面：车体旋转 90° 后世界右侧对应车头', fortressArmorSideAt(s, r.x + r.w + 1, cy) === 'front')

  s = initialState(); s.phase = 'prep'; s.fortress.hp = s.fortress.maxHp - 10; s.fortress.maxArmor.front = 20; s.fortress.armor.front = 10
  s.modules = [{ id: 900, defId: 'repair', x: 0, y: 0, rot: 0, timer: 0 }]
  s = tick(s, 1)
  check('维修模块：结构与受损装甲面共同均摊修复功率', s.fortress.hp === s.fortress.maxHp - 6 && s.fortress.armor.front === 14,
    `hp=${s.fortress.hp}/${s.fortress.maxHp} armor=${s.fortress.armor.front}`)
}

console.log('== v2.69：防御能量罩 ==')
{
  let s = initialState(); s.phase = 'prep'; s.gold = 2000
  check('护盾：未安装发生器时容量为 0', shieldStats(s).max === 0 && s.fortress.maxShield === 0)
  const shieldTiles = shieldHexLayout(60, 100, 24)
  check('护盾瓦片：覆盖护罩且边缘瓦片产生压缩', shieldTiles.length > 20 && shieldTiles.some(t => t.edge < 0.5 && (t.squashX < 0.8 || t.squashY < 0.8)))
  check('护盾瓦片：一次受击向外扩散两圈、逐圈衰减且命中格及时熄灭', shieldHexRipple(0, 0) === 1
    && shieldHexRipple(0.2, 1) > 0 && shieldHexRipple(0.3, 2) > 0
    && shieldHexRipple(0.14, 1) < shieldHexRipple(0, 0)
    && shieldHexRipple(0.28, 2) < shieldHexRipple(0.14, 1)
    && shieldHexRipple(0.3, 0) === 0 && shieldHexRipple(0.8, 2) === 0)
  const edgeSamples = shieldPerimeterSamples(60, 100, 10)
  const shieldRadius = shieldCornerRadius(60, 100)
  check('护盾外缘：柔光素材沿圆角矩形轮廓近似等距覆盖', edgeSamples.length > 50
    && edgeSamples.every(p => {
      const qx = Math.max(Math.abs(p.x) - (60 - shieldRadius), 0)
      const qy = Math.max(Math.abs(p.y) - (100 - shieldRadius), 0)
      return Math.abs(Math.hypot(qx, qy) - shieldRadius) < 0.002
        || (Math.abs(p.y) === 100 && Math.abs(p.x) <= 60 - shieldRadius)
        || (Math.abs(p.x) === 60 && Math.abs(p.y) <= 100 - shieldRadius)
    }))
  const rawVehicleMask = new Uint8Array(9 * 7)
  for (let y = 2; y <= 4; y++) for (let x = 2; x <= 6; x++) rawVehicleMask[y * 9 + x] = 1
  rawVehicleMask[3 * 9] = 1; rawVehicleMask[3 * 9 + 8] = 1
  const fittedVehicleMask = dilateShieldMask(rawVehicleMask, 9, 7, 1)
  const fittedContours = traceShieldMaskContours(fittedVehicleMask, 9, 7)
  const fittedInterior = sampleShieldMaskInterior(fittedVehicleMask, 9, 7, -4.5, -3.5, 1.5)
  check('贴身护盾：主体与两侧行走部件扩张后形成可描边的底盘体系轮廓', fittedContours.length === 1
    && fittedContours[0].points.some(point => point.x === 0)
    && fittedContours[0].points.some(point => point.x === 9))
  check('贴身护盾：破盾内部采样只落在 Alpha 轮廓有效区域', fittedInterior.length > 0
    && fittedInterior.every(point => {
      const x = Math.floor(point.x + 4.5), y = Math.floor(point.y + 3.5)
      return x >= 0 && x < 9 && y >= 0 && y < 7 && fittedVehicleMask[y * 9 + x] > 0
    }))
  check('护盾开展：从 50% 渐显、极限轻微回弹后稳定在完整场体', shieldUnfoldProgress(0) === 0
    && shieldUnfoldProgress(0.5) > 0.8 && shieldUnfoldProgress(1) === 1
    && shieldUnfoldScale(0) === 0.5 && shieldUnfoldScale(0.86) > 1 && shieldUnfoldScale(1) === 1)
  const edgePulseSamples = Array.from({ length: 80 }, (_, i) => shieldEdgePulse(i * 0.125))
  check('护盾外缘：常态亮度与线宽做可辨识的连续波动', edgePulseSamples.some((v, i) => i > 0 && Math.abs(v.alpha - edgePulseSamples[i - 1].alpha) > 0.003)
    && edgePulseSamples.every(v => v.alpha >= 0.84 && v.alpha <= 1.16 && v.width >= 0.93 && v.width <= 1.07))
  const flowAt0 = Array.from({ length: 100 }, (_, i) => shieldEdgeFlowGain(0, i / 100))
  const flowAt4 = Array.from({ length: 100 }, (_, i) => shieldEdgeFlowGain(4, i / 100))
  check('护盾外缘：局部亮度波峰沿闭合周长移动且保留柔和拖尾', Math.max(...flowAt0) > 1.6
    && Math.min(...flowAt0) >= 0.81 && flowAt0.indexOf(Math.max(...flowAt0)) !== flowAt4.indexOf(Math.max(...flowAt4)))
  check('护盾破裂：整场闪光快速衰减并及时交给碎片演出', shieldBreakEnvelope(0) === 1
    && shieldBreakEnvelope(0.2) > 0 && shieldBreakEnvelope(0.5) === 0 && shieldBreakEnvelope(1) === 0)
  const field0 = shieldFieldMotion(0, 60, 100), field1 = shieldFieldMotion(1, 60, 100)
  check('护盾内部场体：双层纹理持续反向漂移并错峰明灭', field0.x1 !== field1.x1 && field0.y2 !== field1.y2
    && field0.r1 !== field1.r1 && field0.a1 !== field0.a2)
  check('护盾碎片：尺寸随护盾短边增长并保持可读范围', shieldShardSize(1, 2) === 0.2
    && shieldShardSize(3, 5) > shieldShardSize(2, 5) && shieldShardSize(10, 12) === 0.6)
  const migrated = migrateModuleDefs(MODULE_DEFS.filter(d => !d.id.startsWith('shield_')), 0)
  check('旧模块库迁移：保留原模块并补入三件护盾模块', ['shield_generator', 'shield_capacitor', 'shield_amplifier'].every(id => migrated.some(d => d.id === id)))
  const legacyLimit = MODULE_DEFS.map(d => ({ ...d }))
  const legacyGenerator = legacyLimit.find(d => d.id === 'shield_generator')!
  delete legacyGenerator.maxCount
  check('旧模块库迁移：护盾发生器补通用数量上限 1', migrateModuleDefs(legacyLimit, 4).find(d => d.id === 'shield_generator')?.maxCount === 1)

  const limitedId = 'sim_limited_module'
  MODULE_DEFS.push({ id: limitedId, name: '测试限装模块', desc: '', cost: 0, w: 1, h: 1, maxCount: 2, color: '#888888' })
  let limited = initialState()
  limited.gold = 999
  limited.modules = []
  limited.phase = 'prep'
  limited = buildModule(limited, limitedId, 1, 1, 0)
  limited = buildModule(limited, limitedId, 2, 1, 0)
  const thirdLimited = canPlaceModule(limited, limitedId, 1, 2, 0)
  check('通用数量上限：任意模块达到配置数量后拒绝继续装配', limited.modules.filter(m => m.defId === limitedId).length === 2 && !thirdLimited.ok && thirdLimited.reason === '测试限装模块装配上限 2',
    `built=${limited.modules.filter(m => m.defId === limitedId).length} ok=${thirdLimited.ok} reason=${thirdLimited.reason}`)
  MODULE_DEFS.splice(MODULE_DEFS.findIndex(d => d.id === limitedId), 1)

  s = buildModule(s, 'shield_generator', 1, 1, 0)
  check('护盾发生器：建造后以满盾启用', s.fortress.maxShield === 300 && s.fortress.shield === 300 && !s.fortress.shieldBroken)
  check('护盾发生器：出厂数量上限 1 通过通用规则生效', !canPlaceModule(s, 'shield_generator', 1, 3, 0).ok)

  s.energy = 50
  s = tick(s, 1)
  check('护盾满值：不消耗回复电力', Math.abs(s.energy - 59) < 1e-6 && s.fortress.shield === s.fortress.maxShield)

  const r = fortressRect(s), hx = r.x + r.w / 2, hy = r.y - 1
  const hp0 = s.fortress.hp
  const absorbed = damageFortress(s, 100, { x: hx, y: hy, kind: 'projectile', armorPen: 1, armorDamage: 50 })
  check('护盾承伤：穿甲对护盾无效且本体/装甲不受伤', absorbed.shieldDamage === 100 && absorbed.structureDamage === 0 && s.fortress.hp === hp0 && s.fortress.armor.front === s.fortress.maxArmor.front)
  const shieldNoRicochet = structuredClone(s)
  shieldNoRicochet.fortress.shield = 5; shieldNoRicochet.fortress.hp = 1000; shieldNoRicochet.fortress.armor.front = 20
  const ricochetSuppressed = damageFortress(shieldNoRicochet, 10, { x: hx, y: hy, kind: 'projectile', penetration: 0 })
  check('护盾承伤：击破护盾的同一发不会触发跳弹，溢出按普通装甲格挡',
    ricochetSuppressed.shieldBroken && !ricochetSuppressed.ricochet && ricochetSuppressed.structureDamage === 0
    && ricochetSuppressed.armorDamage === 0 && shieldNoRicochet.fortress.armor.front === 20 && shieldNoRicochet.fortress.hp === 1000)
  const shieldNoPierce = structuredClone(s)
  shieldNoPierce.fortress.shield = 5; shieldNoPierce.fortress.hp = 1000; shieldNoPierce.fortress.armor.front = 20
  const pierceSuppressed = damageFortress(shieldNoPierce, 10, { x: hx, y: hy, kind: 'projectile', armorPen: 1, armorDamage: 20 })
  const pierceRestored = damageFortress(shieldNoPierce, 10, { x: hx, y: hy, kind: 'projectile', armorPen: 1, armorDamage: 20 })
  check('护盾承伤：护盾命中禁用穿甲与削甲，破盾后的下一发恢复穿甲',
    pierceSuppressed.structureDamage === 0 && pierceSuppressed.armorDamage === 0
    && pierceRestored.structureDamage === 10 && pierceRestored.armorDamage === 20
    && shieldNoPierce.fortress.hp === 990 && shieldNoPierce.fortress.armor.front === 0,
    `first=${JSON.stringify(pierceSuppressed)} second=${JSON.stringify(pierceRestored)} hp=${shieldNoPierce.fortress.hp} armor=${shieldNoPierce.fortress.armor.front}`)
  check('装甲提示文字：玩家载具与其他阵营共用击穿文字规则', shieldNoPierce.floats.at(-1)?.text === '击穿' && shieldNoPierce.floats.at(-1)?.visualKind === 'penetration')
  const energy0 = s.energy
  s = tick(s, 1)
  check('护盾回复：未破盾时持续回复并按点耗电', s.fortress.shield === 212 && Math.abs(s.energy - (Math.min(ENERGY.cap, energy0 + ENERGY.regen) - 4.2)) < 1e-9, `shield=${s.fortress.shield} energy=${s.energy}`)
  s.fortress.shield = 50; s.fortress.hp = 1000; s.fortress.maxHp = 1000
  const overflow = damageFortress(s, 100, { x: hx, y: hy, kind: 'aoe' })
  check('护盾破裂：溢出伤害继续经过装甲后伤结构', overflow.shieldBroken && overflow.shieldDamage === 50 && overflow.structureDamage === 46 && s.fortress.hp === 954)
  check('护盾破裂：生成破盾视觉事件', s.shieldHits.some(x => x.broken))
  s = tick(s, 9)
  check('破盾冷却：受击后 10 秒内不回复', s.fortress.shield === 0 && s.fortress.shieldBroken)
  s.energy = 150; s = tick(s, 1.1)
  check('破盾冷却：脱战满 10 秒后恢复', s.fortress.shield > 0 && !s.fortress.shieldBroken)
  s.phase = 'prep'; s.gold = 2000
  s = buildModule(s, 'shield_capacitor', 3, 1, 0)
  check('护盾增效：容量模块叠加并补足新增容量', s.fortress.maxShield === 460 && s.fortress.shield > 160)
  const generator = s.modules.find(m => m.defId === 'shield_generator')!
  s = demolishModule(s, generator.id)
  check('拆除发生器：增效模块单独存在时护盾关闭', s.fortress.maxShield === 0 && s.fortress.shield === 0)
}

console.log('== v2.70：防守波次自动节奏 ==')
{
  const oldLevel = structuredClone(LEVEL)
  const migrated = normalizeObjective({ type: 'defend', waves: 4 }, 'defend')
  check('旧防守目标迁移：默认等待波次、休整60秒、接踵5秒', migrated.type === 'defend' && migrated.waveWait === true && migrated.restTime === 60 && migrated.overlapTime === 5)

  LEVEL.mode = 'defend'
  configureObjective(LEVEL, { type: 'defend', waves: 3, waveWait: true, restTime: 7, overlapTime: 5 })
  let s = initialState()
  check('等待模式：首波自动进入部署倒计时且无需手动开波', s.phase === 'prep' && s.prepLeft === 7)
  check('等待模式 HUD：首波部署显示现有引擎倒计时', defenseWaveCountdown(s) === 7)
  s.phase = 'combat'; s.wave = 1; s.spawnQueue = []; s.enemies = []; s.ambushQueue = []; s.eventQueue = []
  check('等待模式 HUD：交战中没有下一波计时则隐藏', defenseWaveCountdown(s) === null)
  s = tick(s, 0.1)
  check('等待模式：清场后进入配置的休整时间', s.phase === 'prep' && s.wave === 2 && s.prepLeft === 7)
  check('等待模式 HUD：波间休整继续显示倒计时', defenseWaveCountdown(s) === 7)

  configureObjective(LEVEL, { type: 'defend', waves: 2, waveWait: false, restTime: 999, overlapTime: 5 })
  LEVEL.stages[0].waves[0].entries = [{ id: 'v270-wave-1', unitDefId: 'unit:uav', count: 1, delay: 0, interval: 0 }]
  LEVEL.stages[0].waves[1].entries = [{ id: 'v270-wave-2', unitDefId: 'unit:uav', count: 1, delay: 0, interval: 0 }]
  s = initialState()
  check('接踵模式：首波直接开战且休整时间不生效', s.phase === 'combat' && s.spawnQueue.length > 0 && s.prepLeft === 0)
  s.spawnQueue = []; s.enemies = []; s.ambushQueue = []; s.eventQueue = []; s.nextWaveLeft = 5; s.wave = 1
  check('接踵模式 HUD：最后一名敌人出场后显示接踵倒计时', defenseWaveCountdown(s) === 5)
  s = tick(s, 4.9)
  check('接踵模式：倒计时结束前不提前进入下波或休整', s.phase === 'combat' && s.wave === 1 && s.nextWaveLeft !== null && s.nextWaveLeft > 0)
  s = tick(s, 0.11)
  check('接踵模式：计时到点自动开始下波', s.phase === 'combat' && s.wave === 2 && (s.enemies.length > 0 || s.spawnQueue.length > 0))
  s.spawnQueue = []; s.enemies = []; s.ambushQueue = []; s.eventQueue = []; s.nextWaveLeft = null
  s = tick(s, 0.1)
  check('接踵模式：最后一波清场后正常胜利', s.phase === 'won')
  check('防御模式 HUD：关卡结算后隐藏倒计时', defenseWaveCountdown(s) === null)

  s.objective = { type: 'fortressDefense', waves: 3, waveWait: true, restTime: 7, overlapTime: 5, spawnRegions: [], fortressDefId: s.fortressDefId, fortressPoint: { x: 10, y: 10 }, returnPoint: { x: 5, y: 5 } }
  s.phase = 'prep'; s.wave = 2; s.prepLeft = 3.25; s.nextWaveLeft = null
  check('堡垒防御 HUD：与普通防守共用波间倒计时口径', defenseWaveCountdown(s) === 3.25)
  Object.assign(LEVEL, oldLevel)
}

console.log('== v2.75：堡垒战损痕迹 ==')
{
  let s = initialState()
  const r = fortressRect(s), cx = r.x + r.w / 2
  s.fortress.maxShield = 50; s.fortress.shield = 50
  damageFortress(s, 20, { x: cx, y: r.y - 1, kind: 'projectile' })
  check('战损：护盾完全吸收时不生成主体贴花或火花', s.fortress.damageMarks.length === 0 && s.unitHits.length === 0 && s.fortress.hitFlash === 0)

  s.fortress.maxShield = 0; s.fortress.shield = 0
  s.fortress.armor.front = 20
  damageFortress(s, 5, { x: cx, y: r.y - 2, kind: 'projectile' })
  check('战损屏蔽：装甲格挡不再生成擦痕，但瞬时受击火花保留且单位本体不泛白',
    s.fortress.damageMarks.length === 0 && s.unitHits.length === 1 && s.fortress.hitFlash === 0)

  damageFortress(s, 10, { x: cx, y: r.y - 1, kind: 'projectile', armorPen: 0.6, projectileSize: 0.4 })
  check('战损：穿透实弹不再生成主体弹孔贴花', !s.fortress.damageMarks.some(mark => mark.kind === 'bullet'))
  s.fortress.armor.front = 0
  damageFortress(s, 8, { x: cx, y: r.y - 1, kind: 'aoe' })
  check('战损：爆炸伤及结构不再生成主体焦痕贴花', !s.fortress.damageMarks.some(mark => mark.kind === 'scorch'))
  check('战损屏蔽：弹孔、焦痕与装甲擦痕全部不可见',
    !unitDamageMarkVisible('bullet') && !unitDamageMarkVisible('scorch') && !unitDamageMarkVisible('scratch'))

  s.fortress.heading = Math.PI / 2
  const local = fortressDamageLocalPoint(s, r.x + r.w + 2, r.y + r.h / 2)
  check('战损：旋转车体的世界命中点正确反算到车头局部边缘', local.y <= 0.081 && local.x > r.w * 0.4 && local.x < r.w * 0.6)

  s.fortress.heading = 0; s.fortress.hp = 10000; s.fortress.maxHp = 10000; s.fortress.armor.front = 10000
  for (let i = 0; i < FORTRESS_DAMAGE_MARK_CAP + 5; i++) {
    s.time += 0.01
    damageFortress(s, 1, { x: cx, y: r.y - 1, kind: 'projectile' })
  }
  check('战损屏蔽：连续受击也不再累积任何永久主体贴花', s.fortress.damageMarks.length === 0)
  check('载具结构阶段：50%及以上正常、低于50%整车变暗、低于25%追加深色烟', UNIT_BODY_DAMAGE_VISUALS_ENABLED
    && fortressDamageStage(100, 100) === 0 && fortressDamageStage(50, 100) === 0
    && fortressDamageStage(49, 100) === 1 && fortressDamageStage(25, 100) === 1
    && fortressDamageStage(24, 100) === 2)
  check('载具结构阶段：变暗亮度随结构降低且永久贴花继续关闭', vehicleDamageBrightness(50, 100) === 1
    && vehicleDamageBrightness(49, 100) < 1 && vehicleDamageBrightness(10, 100) < vehicleDamageBrightness(49, 100)
    && !UNIT_BODY_DECALS_ENABLED)
  check('载具结构阶段：深色烟源数量按载具尺寸增加并设置上限', vehicleDamageSmokeSourceCount(2, 2) < vehicleDamageSmokeSourceCount(5, 8)
    && vehicleDamageSmokeSourceCount(100, 100) === 6)

  s = tick(s, 0.2)
  check('战损：船体火花事件按 TTL 正常回收且全程无白闪', s.fortress.hitFlash === 0 && s.unitHits.length === 0)
}

console.log('== v2.76：敌方直线实弹与装甲跳弹 ==')
{
  check('敌方远程化：现有五类敌人均配置射程、间隔、弹速、伤害与穿深', Object.values(ENEMY_DEFS).every(d =>
    d.attackRange > 0 && d.attackInterval > 0 && d.projectileSpeed > 0 && d.projectileDamage > 0 && d.penetration > 0))
  check('穿深概率：低穿深按比例、达到装甲必穿、零穿深保留最低5%', fortressPenetrationChance(3, 6) === 0.5
    && fortressPenetrationChance(6, 6) === 1 && fortressPenetrationChance(0, 6) === 0.05 && fortressPenetrationChance(3, 0) === 1)
  const smallRicochet = ricochetVisualScale(GEOMETRIC_BULLET_VISUAL_SIZE, 0.5)
  const largeRicochet = ricochetVisualScale(GEOMETRIC_BULLET_VISUAL_SIZE * 4, 0.5)
  check('通用跳弹口径：大弹丸同时增加亮线宽度与飞出距离',
    largeRicochet.width > smallRicochet.width && largeRicochet.range > smallRicochet.range,
    JSON.stringify({ smallRicochet, largeRicochet }))

  let s = arena()
  const r = fortressRect(s), cx = r.x + r.w / 2
  s.fortress.hp = 1000; s.fortress.maxHp = 1000; s.fortress.armor.front = 6; s.fortress.maxArmor.front = 6
  let ricochetSeed = 1
  while (eventRandom(ricochetSeed, 91) < 0.5) ricochetSeed++
  s.nextId = ricochetSeed
  const bounced = damageFortress(s, 10, {
    x: cx, y: r.y - 1, kind: 'projectile', penetration: 3,
    incomingDx: 0, incomingDy: 1, ammoId: 'custom_ammo_3', projectileSize: 0.6,
  })
  const fortressRicochetFx = s.unitHits.at(-1)
  check('概率装甲：穿深不足且判定失败时跳弹、结构不受伤并生成跳弹事件', bounced.ricochet && bounced.blocked
    && s.fortress.hp === 1000 && fortressRicochetFx?.ricochet === true
    && fortressRicochetFx.ammoId === 'custom_ammo_3' && fortressRicochetFx.projectileSize === 0.6)
  const pierced = damageFortress(s, 10, { x: cx, y: r.y - 1, kind: 'projectile', penetration: 6 })
  check('概率装甲：穿深达到装甲时必定穿透并造成完整单发伤害', !pierced.ricochet && pierced.structureDamage === 10 && s.fortress.hp === 990)

  s = arena()
  const fr = fortressRect(s), ex = fr.x + fr.w / 2, ey = fr.y - 1
  s.fortress.armor.front = 0
  const enemy = mkEnemy(s, 'walker', ex, ey)
  enemy.controller = 'ai'
  enemy.attackCooldown = 0
  const dist = fortressDistanceToPoint(s, enemy.x, enemy.y)
  s = tick(s, 0.01)
  check('敌方远程攻击：进入射程后停车并生成独立直线实弹', dist <= ENEMY_DEFS.walker.attackRange
    && byId(s.enemies, enemy.id)?.mode === 'attack' && s.enemyProjectiles.length === 1)
  const hp0 = s.fortress.hp
  const shotDamage = s.enemyProjectiles[0]?.damage ?? 0
  byId(s.enemies, enemy.id)!.attackCooldown = 999 // 隔离首发弹：大 dt 验高速跨帧时不再生成第二发
  s = tick(s, 2)
  check('敌方远程攻击：高速线段命中堡垒且不会跨帧穿模', s.enemyProjectiles.length === 0 && s.fortress.hp === hp0 - shotDamage,
    `projectiles=${JSON.stringify(s.enemyProjectiles)} hp=${s.fortress.hp}/${hp0}`)

  s = arena(); s.fortress.heading = Math.PI / 2
  const rr = fortressRect(s), cy = rr.y + rr.h / 2
  const hit = enemyProjectileFortressHit(s, rr.x + rr.w + 3, cy, rr.x + rr.w / 2, cy)
  check('敌方实弹碰撞：车体旋转后仍能求出首次命中点', hit !== null && hit.x > rr.x + rr.w / 2)

  s = arena(); s.fortress.heading = 0
  const bodyRef = fortressDef(s).spriteBody!
  const alpha = new Uint8Array(150 * 240)
  for (let y = 0; y < 240; y++) for (let x = 45; x <= 104; x++) alpha[y * 150 + x] = 255
  registerFortressBodyAlpha(bodyRef, 150, 240, alpha)
  const ar = fortressRect(s), ay = ar.y + ar.h / 2
  const transparentPass = enemyProjectileFortressHit(s, ar.x + ar.w + 1, ay, ar.x + ar.w - 1, ay)
  const bodyHit = enemyProjectileFortressHit(s, ar.x + ar.w + 1, ay, ar.x + ar.w / 2, ay)
  const deepHit = enemyProjectileFortressHit(s, ar.x + ar.w + 1, ay, ar.x + ar.w / 2, ay, 0.6)
  check('敌方实弹碰撞：轮胎与履带所在的主体透明外侧带不阻挡弹丸', transparentPass === null)
  check('敌方实弹碰撞：弹丸越过外侧带后在主体首个不透明像素命中', bodyHit !== null
    && bodyHit.x < ar.x + ar.w - 1.4 && bodyHit.x > ar.x + ar.w / 2)
  check('敌方实弹碰撞：随机深入命中点仍在主体不透明像素且明显深于边缘', deepHit !== null && bodyHit !== null
    && deepHit.x < bodyHit.x - 0.5 && deepHit.x > ar.x + ar.w / 2)
  clearFortressBodyAlpha(bodyRef)
}

console.log('== v2.77：统一单位数据层与目标类别拆分 ==')
{
  const units = unitLibrary()
  check('统一单位库：现有堡垒与无人飞行器均生成稳定单位 id',
    FORTRESS_DEFS.every(d => units.some(u => u.id === fortressUnitId(d.id) && u.type === 'vehicle'))
      && units.some(u => u.id === 'unit:uav' && u.type === 'rotorcraft'))

  const rangedEnemy = unitDefById(enemyUnitId('walker'))!
  check('统一单位 AI：战斗配置收口为首选目标、站位与移动，攻击仍属于战斗参数', rangedEnemy.ai?.preferredTarget === 'playerControlled'
    && rangedEnemy.ai.positioning === 'longestRange' && rangedEnemy.ai.movement === 'stop'
    && rangedEnemy.combat?.profile === 'projectile' && rangedEnemy.type === 'vehicle')

  const migratedAI = normalizeUnitAI({
    targeting: { profile: 'fortress' },
    movement: { profile: 'rangeEdge' },
    attack: { profile: 'projectile' },
  })
  check('战斗 AI 迁移：旧堡垒索敌/射程游走自动转为主控目标/最远站位/环绕', migratedAI.preferredTarget === 'playerControlled'
    && migratedAI.positioning === 'longestRange' && migratedAI.movement === 'orbit')

  check('目标迁移：旧 core/building/ally 分别迁移为 fortress/fixedBuilding/combatUnit', migrateLegacyTargetKind('core') === 'fortress'
    && migrateLegacyTargetKind('building') === 'fixedBuilding' && migrateLegacyTargetKind('ally') === 'combatUnit'
    && migrateLegacyTargetKind('???') === null)

  let s = arena()
  s.phase = 'combat'; s.spawnQueue = [{ kind: 'walker', delay: 0 }]; s.spawnTimer = 0
  s = tick(s, 0.01)
  check('运行时单位引用：新生成敌人携带统一 unitDefId', s.enemies.some(e => e.kind === 'walker' && e.unitDefId === enemyUnitId('walker')))
}

console.log('== v2.78：三字段战斗 AI 运行时决策 ==')
{
  const weaponRanges = [{ min: 0, max: 100 }, { min: 30, max: 80 }, { min: 50, max: 120 }]
  const longest = computeAIStandingRange(weaponRanges, 'longestRange')
  const shortest = computeAIStandingRange(weaponRanges, 'shortestRange')
  const optimal = computeAIStandingRange(weaponRanges, 'optimalRange')
  check('最远射程：最长武器按 75%～95% 建带，目标 85%', longest.min === 90 && longest.max === 114 && longest.desired === 102)
  check('最近射程：最短武器按 40%～60% 建带，目标 50%', shortest.min === 32 && shortest.max === 48 && shortest.desired === 40)
  check('最优射程：选择三件武器同时覆盖的 50～80 区间', optimal.min === 50 && optimal.max === 80 && optimal.desired === 65 && optimal.overlap === 3)
  check('移动决策：过远接近、带内环绕、过近后退', aiRangeDecision(121, longest, 'orbit') === 'approach'
    && aiRangeDecision(100, longest, 'orbit') === 'orbit' && aiRangeDecision(80, longest, 'orbit') === 'retreat')
  check('远离/抵近：在站位带内分别靠向外沿和内沿', aiRangeDecision(100, longest, 'keepFar') === 'retreat'
    && aiRangeDecision(100, longest, 'closeIn') === 'approach')
  check('撞击回退：可达时直冲；空中或不可碰撞按停止站位；不可达原地保持', aiRangeDecision(100, longest, 'ram', 'available') === 'ram'
    && aiRangeDecision(100, longest, 'ram', 'ineligible') === 'hold'
    && aiRangeDecision(121, longest, 'ram', 'ineligible') === 'approach'
    && aiRangeDecision(121, longest, 'ram', 'unreachable') === 'hold')
}

console.log('== v2.79：可持久化单位库与内置覆盖 ==')
{
  const custom = {
    id: 'unit:sim-neutral', name: '测试中立建筑', type: 'building' as const,
    targetClasses: ['combatUnit' as const],
    stats: { hp: 80, speed: 0, size: 0.3, air: false },
    ai: { preferredTarget: 'allHostile' as const, positioning: 'optimalRange' as const, movement: 'stop' as const, special: { profile: 'none' as const } },
  }
  check('单位库持久化：可保存无旧注册表来源的自定义单位', saveCustomUnitDef(custom)
    && unitDefById(custom.id)?.type === 'building' && unitLibraryForExport().customs.some(unit => unit.id === custom.id))

  const walkerOverride = structuredClone(unitDefById(enemyUnitId('walker'))!)
  walkerOverride.ai!.movement = 'orbit'
  walkerOverride.combat!.preferredRangeRatio = 0.9
  walkerOverride.combat!.rangeTolerance = 0.08
  check('单位库收口：旧敌人载具快照不能写入独立单位库存储', !saveCustomUnitDef(walkerOverride)
    && enemyUnitDef('walker').ai?.movement === 'stop')
  check('单位库收口：旧适配单位继续保持只读迁移来源', !deleteCustomUnitDef(walkerOverride.id)
    && enemyUnitDef('walker').ai?.movement === 'stop')
  check('单位库删除：自定义单位删除后不再出现在统一列表', deleteCustomUnitDef(custom.id) && !unitLibrary().some(unit => unit.id === custom.id))
}

console.log('== v2.80：单位几何中心统一 ==')
{
  check('几何中心：奇数与偶数包围盒均严格使用宽高除以二', geometryCenter(5, 8).x === 2.5
    && geometryCenter(5, 8).y === 4 && geometryCenter(4, 6).x === 2 && geometryCenter(4, 6).y === 3)
  check('世界中心：左上角偏移后仍保持同一几何中心', rectGeometryCenter({ x: 10, y: 20, w: 5, h: 8 }).x === 12.5
    && rectGeometryCenter({ x: 10, y: 20, w: 5, h: 8 }).y === 24)
  const sprite = centeredRect(100, 80, 30, 50)
  check('贴图中心：任意原图尺寸均以自身中心对齐单位几何中心', sprite.x === 85 && sprite.y === 55
    && sprite.x + sprite.w / 2 === 100 && sprite.y + sprite.h / 2 === 80)
  check('堡垒局部原点：与全单位几何中心规则同源', fortressLocalCenter({ w: 4, h: 7 }).x === 2
    && fortressLocalCenter({ w: 4, h: 7 }).y === 3.5)
  const insetVehicleCenter = fortressLocalCenter({ w: 2, h: 5, shape: ['0,2', '1,2', '0,3', '1,3', '0,4', '1,4'] })
  check('载具有效中心：外框含空白边距时仍按实际占格中心对齐主体、履带与炮位', insetVehicleCenter.x === 1 && insetVehicleCenter.y === 3.5)
  const insetOrigin = fortressShapeOrigin({ w: 2, h: 5, shape: ['0,2', '1,2', '0,3', '1,3', '0,4', '1,4'] }, 10, 12)
  check('载具碰撞原点：有效占格中心锚定完整外框中心', insetOrigin.x === 10 && insetOrigin.y === 11)

  const legacyInset: FortressDef = {
    ...structuredClone(DEFAULT_FORTRESS),
    id: 'test-origin-normalize', name: '测试原点归零', w: 2, h: 5,
    shape: ['0,2', '1,2', '0,3', '1,3', '0,4', '1,4'],
    interior: { cols: 2, rows: 3 }, interiorCells: ['0,2', '1,2', '0,3', '1,3', '0,4', '1,4'],
    hardpoints: [{ id: 'center', x: 1, y: 3.5, size: 'S' }],
    effects: [{ id: 'smoke', x: 1, y: 4, kind: 'smoke', state: 'both' }],
    tracks: [{ id: 'track', x1: -0.8, y1: 1, x2: -0.8, y2: -1, radius: 0.3, tile: 'builtin:vehicle/lighttank01/track' }],
    wheels: [], runningGearCoordinateSpace: 'centered',
  }
  saveCustomFortress(legacyInset)
  const normalizedInset = FORTRESS_DEFS.find(def => def.id === legacyInset.id)!
  check('载具库存档迁移：顶部空行自动归零为真实 2×3 外框', normalizedInset.w === 2 && normalizedInset.h === 3
    && normalizedInset.shape?.includes('0,0') && normalizedInset.shape?.includes('1,2'))
  check('载具库存档迁移：炮位、特效与内部格同步平移，居中履带坐标保持不变', normalizedInset.hardpoints[0]?.y === 1.5
    && normalizedInset.effects?.[0]?.y === 2 && normalizedInset.interiorCells?.includes('0,0')
    && normalizedInset.tracks?.[0]?.y1 === 1 && normalizedInset.tracks?.[0]?.y2 === -1)
  deleteCustomFortress(legacyInset.id)

  const insetDef: FortressDef = {
    ...structuredClone(DEFAULT_FORTRESS),
    id: 'test-inset-movement', name: '测试内缩车体', w: 2, h: 5,
    shape: ['0,2', '1,2', '0,3', '1,3', '0,4', '1,4'],
    hardpoints: [], tracks: [], wheels: [],
  }
  FORTRESS_DEFS.push(insetDef)
  let insetState = arena()
  insetState.fortressDefId = insetDef.id
  insetState.fortress.x = 10
  insetState.fortress.y = 12
  insetState.fortress.vx = 0
  insetState.fortress.vy = 0
  insetState.objects = [{
    id: 98001, kind: 'rock', x: 10, y: 16, w: 2, h: 1,
    hp: -1, maxHp: -1, blockMove: true, blockProjectile: false,
  } as BattleObject]
  check('载具占格查询：不会把外框空白边距误判为车体', blockerAt(insetState, 10, 16)?.kind !== 'fortress')
  insetState.moveDir = { x: 0, y: -1 }
  insetState = run(insetState, 0.5, 0.05)
  check('载具起点移动：外框空白边距不会形成隐形碰撞并卡住战车', insetState.fortress.y < 11.9, `y=${insetState.fortress.y.toFixed(3)}`)
  FORTRESS_DEFS.splice(FORTRESS_DEFS.findIndex(def => def.id === insetDef.id), 1)
}

console.log('== v2.81：单位视觉、碰撞与攻击参数接入运行时 ==')
{
  check('单位库存档：三字段战斗 AI 使用当前 v19 协议', unitLibraryForExport().version === 19)
  const obsoleteDeathSound = structuredClone(unitDefById('unit:uav')!) as ReturnType<typeof structuredClone> & { sounds?: { movement?: string; fire?: string; death?: string } }
  obsoleteDeathSound.id = 'unit:sim-obsolete-death-sound'
  obsoleteDeathSound.sounds = { movement: 'move-test', death: 'retired-death-test' }
  saveCustomUnitDef(obsoleteDeathSound)
  const cleanedDeathSound = unitLibraryForExport().customs.find(def => def.id === obsoleteDeathSound.id)?.sounds as { movement?: string; death?: string } | undefined
  check('单位音效迁移：旧死亡音效字段被删除且移动音效保留', cleanedDeathSound?.movement === 'move-test' && cleanedDeathSound.death === undefined)
  deleteCustomUnitDef(obsoleteDeathSound.id)
  const invalid = structuredClone(unitDefById(enemyUnitId('walker'))!)
  invalid.visual = { width: 0, height: 1 }
  check('单位定义校验：拒绝零尺寸主体素材', validateUnitDef(invalid).some(error => error.includes('显示宽高')))

  const walker = structuredClone(unitDefById(enemyUnitId('walker'))!)
  walker.stats.hp = 321
  walker.stats.speed = 0.42
  walker.stats.size = 0.27
  walker.visual = { bodyAsset: 'sim:unit-body', width: 0.8, height: 1.1, muzzleOffsetX: 0, muzzleOffsetY: BASE_CELL }
  walker.combat = { profile: 'projectile', range: 12, interval: 0.75, projectileId: 'bullet_std' }
  const bullet = PROJECTILE_ARTS.find(item => item.id === 'bullet_std')!
  const savedBullet = structuredClone(bullet)
  bullet.damage = 37; bullet.speed = 1; bullet.penetration = 11; bullet.projectileAsset = 'sim:enemy-round'
  saveCustomUnitDef(walker)

  let spawned = arena()
  spawned.phase = 'combat'; spawned.spawnQueue = [{ kind: 'walker', delay: 0 }]; spawned.spawnTimer = 0
  spawned = tick(spawned, 0.01)
  const created = spawned.enemies.find(enemy => enemy.kind === 'walker')
  check('旧敌人适配器：拒绝写入第二份载具快照并保持迁移源生命', created?.maxHp === ENEMY_DEFS.walker.hp)

  let firing = arena()
  const rect = fortressRect(firing)
  const enemy = mkEnemy(firing, 'walker', rect.x + rect.w / 2, rect.y - 2, 321)
  enemy.controller = 'ai'
  enemy.attackCooldown = 0
  firing = tick(firing, 0.01)
  const shot = firing.enemyProjectiles[0]
  check('敌方远程攻击：弹速、伤害、穿深和素材引用均读取统一参数', shot?.speed === 1
    && shot.damage === 37 && shot.penetration === 11 && shot.assetRef === 'sim:enemy-round'
    && shot.ammoId === 'bullet_std' && shot.kind === 'bullet' && shot.sourceSide === 'enemy')
  check('单位开火音效：实际生成弹丸时同步产生单位开火声音事件', firing.audioSignals?.some(signal => signal.kind === 'unitFire' && signal.defId === walker.id) === true)
  check('旧敌人适配器：不再读取被拒绝快照中的开火点偏移', !!shot
    && Math.abs(shot.x - (firing.enemies.find(item => item.id === enemy.id)?.x ?? enemy.x)) < 1e-9
    && Math.abs(shot.y - (firing.enemies.find(item => item.id === enemy.id)?.y ?? enemy.y)) < 1e-9
    && Math.abs(shot.px - shot.x) < 1e-9 && Math.abs(shot.py - shot.y) < 1e-9,
    shot ? `visible=(${shot.x.toFixed(3)},${shot.y.toFixed(3)}) live=(${firing.enemies.find(item => item.id === enemy.id)?.x.toFixed(3)},${firing.enemies.find(item => item.id === enemy.id)?.y.toFixed(3)})` : '未生成弹丸')
  deleteCustomUnitDef(walker.id)
  Object.assign(bullet, savedBullet)
  check('单位内置覆盖：专项测试结束后恢复内置参数', enemyUnitDef('walker').stats.hp === ENEMY_DEFS.walker.hp)
}

console.log('== v2.82：关卡、Boss 与生产模块统一引用单位 ID ==')
{
  const savedLevel = structuredClone(LEVEL)
  const customEnemy = {
    id: 'unit:sim-event-enemy', name: '事件自定义旋翼机', type: 'rotorcraft' as const, faction: 'enemy' as const,
    controller: 'ai' as const, targetClasses: ['combatUnit' as const],
    stats: { hp: 444, speed: 0.4, size: 0.28, air: true },
    visual: { width: 0.7, height: 0.8 },
    combat: { profile: 'projectile' as const, range: 8, interval: 1, projectileId: 'bullet_std', damage: 12, projectileSpeed: 20, penetration: 2 },
    ai: { targeting: { profile: 'fortress' as const, allowedTargets: ['fortress' as const] }, movement: { profile: 'holdRange' as const }, attack: { profile: 'projectile' as const } },
  }
  const customAlly = {
    id: 'unit:sim-produced-ally', name: '生产自定义友军旋翼机', type: 'rotorcraft' as const, faction: 'ally' as const,
    controller: 'ai' as const, targetClasses: ['combatUnit' as const],
    stats: { hp: 555, speed: 1.1, size: 0.22, air: true },
    visual: { width: 0.5, height: 0.7 },
    combat: { profile: 'hitscan' as const, range: 5, interval: 0.7, projectileId: 'ray_std', damage: 9, projectileSpeed: 0, penetration: 0 },
    ai: { targeting: { profile: 'closestHostile' as const, allowedTargets: ['combatUnit' as const] }, movement: { profile: 'holdRange' as const }, attack: { profile: 'hitscan' as const } },
  }
  const tempModuleId = 'sim_unit_factory'
  try {
    saveCustomUnitDef(customEnemy)
    saveCustomUnitDef(customAlly)
    LEVEL.mode = 'defend'; LEVEL.objective = { type: 'defend', waves: 99 }; LEVEL.interactables = []; LEVEL.triggers = []
    LEVEL.events = [{
      id: 982, name: '统一单位触发', category: 'region', enabled: true,
      activationLimit: 1, cooldown: 0, conditions: { mode: 'all', conditions: [] },
      trigger: { type: 'regionEnter', cells: Array.from({ length: 16 }, (_, index) => `${2 + index % 4},${2 + Math.floor(index / 4)}`) }, actions: [
        { type: 'spawn', enemies: { walker: 0, runner: 0, rusher: 0, brute: 0, flyer: 0 }, units: { [customEnemy.id]: 1 }, interval: 0 },
        { type: 'boss', boss: { kind: 'walker', unitDefId: customEnemy.id, name: '自定义 Boss', hpScale: 2, sizeScale: 1.5, phases: [], defeatActions: [] } },
      ],
    }]
    const setCenter = (state: GameState, x: number, y: number) => {
      const r = fortressRect(state); state.fortress.x = x - r.w / 2; state.fortress.y = y - r.h / 2
    }
    let eventState = initialState(); eventState.phase = 'combat'; eventState.spawnQueue = [{ kind: 'walker', delay: 100 }]; eventState.spawnTimer = 100
    setCenter(eventState, 20, 20); eventState = tick(eventState, 0.1); setCenter(eventState, 3, 3); eventState = tick(eventState, 0.1)
    const customEnemies = eventState.enemies.filter(enemy => enemy.unitDefId === customEnemy.id)
    check('关卡刷怪：自定义敌人按 unitDefId 生成并读取自定义生命', customEnemies.some(enemy => !enemy.bossName && enemy.maxHp === 444))
    check('Boss 动作：自定义单位 ID、倍率和名称共同生效', customEnemies.some(enemy => enemy.bossName === '自定义 Boss' && enemy.maxHp === 888 && enemy.bossSizeScale === 1.5))

    MODULE_DEFS.push({ id: tempModuleId, name: '单位工厂测试', desc: '', cost: 0, w: 1, h: 1, color: '#888', produce: { kind: 'soldier', unitDefId: customAlly.id, interval: 1, cap: 2 } })
    let production = initialState(); production.phase = 'combat'; production.spawnQueue = [{ kind: 'walker', delay: 100 }]; production.spawnTimer = 100
    production.modules = [{ id: production.nextId++, defId: tempModuleId, x: 0, y: 0, rot: 0, timer: 0 }]
    production = tick(production, 0.1)
    check('生产模块：按 unitDefId 产出自定义友军并读取自定义生命', production.allies.some(ally => ally.unitDefId === customAlly.id && ally.maxHp === 555))

    const legacyModule = { id: 'legacy_factory', name: '旧兵营', desc: '', cost: 0, w: 1, h: 1, color: '#888', produce: { kind: 'tank' as const, interval: 5, cap: 1 } }
    check('模块迁移：旧 produce.kind 自动迁入统一载具单位 ID', migrateModuleDefs([legacyModule], 6)[0].produce?.unitDefId === 'fortress:standard')

    const migratedLevel = parseLevel(JSON.stringify({ version: 10, triggers: [{ id: 1, name: '旧伏击', enabled: true, x: 1, y: 1, w: 2, h: 2, activationLimit: 1, cooldown: 0, delay: 0, interval: 0, enemies: { walker: 2 } }] }))
    const migratedEvent = migratedLevel.events[0]
    const migratedSpawn = migratedEvent?.actions.find(action => action.type === 'spawn')
    check('关卡迁移：退役敌人枚举不再生成步兵单位引用', migratedLevel.version === 18 && migratedEvent?.trigger.type === 'regionEnter'
      && migratedSpawn?.type === 'spawn' && Object.keys(migratedSpawn.units ?? {}).length === 0)
  } finally {
    deleteCustomUnitDef(customEnemy.id); deleteCustomUnitDef(customAlly.id)
    const moduleIndex = MODULE_DEFS.findIndex(module => module.id === tempModuleId)
    if (moduleIndex >= 0) MODULE_DEFS.splice(moduleIndex, 1)
    for (const key of Object.keys(LEVEL)) delete (LEVEL as unknown as Record<string, unknown>)[key]
    Object.assign(LEVEL, savedLevel)
    invalidateWallInfo()
  }
}

console.log('== v2.83：关卡初始友军与中立单位 ==')
{
  const savedLevel = structuredClone(LEVEL)
  const neutral = {
    id: 'unit:sim-neutral-observer', name: '中立观察建筑', type: 'building' as const, faction: 'neutral' as const,
    controller: 'static' as const, targetClasses: ['combatUnit' as const],
    stats: { hp: 777, speed: 0, size: 0.3, air: false }, visual: { width: 0.8, height: 0.9 },
    combat: { range: 0, interval: 1, damage: 0, projectileSpeed: 0, penetration: 0 },
    ai: { targeting: { profile: 'none' as const }, movement: { profile: 'stationary' as const }, attack: { profile: 'none' as const } },
  }
  try {
    saveCustomUnitDef(neutral)
    LEVEL.initialUnits = [
      { id: 1, unitDefId: 'ally:tank', faction: 'ally', x: 8.5, y: 20.5, flipX: true, rotation: 90 },
      { id: 2, unitDefId: neutral.id, faction: 'neutral', x: 11.5, y: 18.5 },
    ]
    let state = initialState()
    const tank = state.allies.find(unit => unit.unitDefId === 'ally:tank')
    const observer = state.allies.find(unit => unit.unitDefId === neutral.id)
    check('初始单位：友军和中立单位按稳定 ID、中心坐标、实例变换与生命生成', tank?.x === 8.5 && tank.y === 20.5
      && tank.flipX === true && Math.abs((tank.initialHeading ?? 0) - Math.PI / 2) < 1e-9
      && observer?.x === 11.5 && observer.y === 18.5 && observer.maxHp === 777)
    state.phase = 'combat'; state.spawnQueue = [{ kind: 'walker', delay: 100 }]; state.spawnTimer = 100
    state = tick(state, 0.5)
    const neutralAfter = state.allies.find(unit => unit.unitDefId === neutral.id)
    check('中立单位：保持静止且不参与索敌', neutralAfter?.faction === 'neutral' && neutralAfter.x === 11.5 && neutralAfter.y === 18.5 && neutralAfter.targetId === null)

    const migrated = parseLevel(JSON.stringify({ version: 11, rows: 20, cols: 20, initialUnits: [
      { id: 4, unitDefId: 'ally:soldier', faction: 'ally', x: -5, y: 99, flipX: true, rotation: 270 },
      { id: 4, unitDefId: neutral.id, faction: 'neutral', x: 5.5, y: 6.5, rotation: 45 },
      { id: 8, unitDefId: '', faction: 'ally', x: 1, y: 1 },
    ] }))
    check('关卡迁移：v11 清理退役/空单位引用并保留有效中立实例', migrated.version === 18 && migrated.initialUnits.length === 1
      && migrated.initialUnits[0].unitDefId === neutral.id && migrated.initialUnits[0].x === 5.5 && migrated.initialUnits[0].y === 6.5
      && migrated.initialUnits[0].rotation === 0)
  } finally {
    deleteCustomUnitDef(neutral.id)
    for (const key of Object.keys(LEVEL)) delete (LEVEL as unknown as Record<string, unknown>)[key]
    Object.assign(LEVEL, savedLevel)
    invalidateWallInfo()
  }
}

console.log('== v2.84：独立核心建筑与攻城索敌 ==')
{
  const savedLevel = structuredClone(LEVEL)
  try {
    LEVEL.core = { x: 4, y: 6 }
    LEVEL.buildCells = []; LEVEL.initialWalls = []; LEVEL.buildings = []; LEVEL.objects = []
    configureObjective(LEVEL, { type: 'defend', waves: 1, protectTarget: 'core' })
    const siege = { profile: 'siege' as const, allowedTargets: ['coreBuilding' as const, 'fixedBuilding' as const, 'wall' as const] }
    let state = initialState()
    const core = state.core
    check('核心实体：按关卡坐标和 CORE 独立耐久生成', core?.x === 4 && core.y === 6 && core.w === CORE.w && core.h === CORE.h && core.hp === CORE.hp)
    check('核心阻挡：完好时以 coreBuilding 进入单位占格查询', blockerAt(state, 4, 6)?.kind === 'coreBuilding')
    const target = selectSiegeTarget(state, 4, 2, siege)
    check('攻城索敌：严格选择独立核心且不把移动堡垒当核心', target?.kind === 'coreBuilding' && target.id === core?.id)

    if (core) state.enemyProjectiles.push({
      id: state.nextId++, shooterId: 9001, x: core.x + core.w / 2, y: core.y + core.h / 2,
      px: core.x + core.w / 2, py: core.y + core.h / 2, heading: 0, speed: 0,
      damage: CORE.hp + 10, penetration: 999, traveled: 0, maxTravel: 100,
      targetKind: 'coreBuilding', targetId: core.id, targetX: core.x + core.w / 2, targetY: core.y + core.h / 2,
    })
    state.phase = 'combat'; state.spawnQueue = [{ kind: 'walker', delay: 100 }]; state.spawnTimer = 100
    state = tick(state, 0.1)
    check('核心摧毁：远程实弹扣尽耐久、释放占格并立即判负', state.core?.hp === 0 && state.phase === 'lost' && blockerAt(state, 4, 6) === null,
      `hp=${state.core?.hp} phase=${state.phase} blocker=${blockerAt(state, 4, 6)?.kind ?? 'none'}`)
  } finally {
    for (const key of Object.keys(LEVEL)) delete (LEVEL as unknown as Record<string, unknown>)[key]
    Object.assign(LEVEL, savedLevel)
    invalidateWallInfo()
  }
}

console.log('== 防守任务：物体/单位实例保护目标 ==')
{
  const savedLevel = structuredClone(LEVEL)
  try {
    LEVEL.core = null; LEVEL.buildCells = []; LEVEL.initialWalls = []; LEVEL.buildings = []
    LEVEL.objects = [
      { id: 77, kind: 'barrel', x: 6, y: 8, w: 1, h: 1, hp: 10, blockMove: true, blockProjectile: false, height: 1 },
      { id: 78, kind: 'barrel', x: 7, y: 8, w: 1, h: 1, hp: 10, blockMove: true, blockProjectile: false, height: 1 },
    ]
    LEVEL.initialUnits = []
    configureObjective(LEVEL, { type: 'defend', waves: 1, protectTarget: { type: 'object', objectIds: [77, 78] } })
    let objectState = initialState()
    objectState.phase = 'combat'; objectState.spawnQueue = [{ kind: 'walker', delay: 100 }]; objectState.spawnTimer = 100
    objectState.objects[0].hp = 0
    objectState = tick(objectState, 0.1)
    check('防守保护 Autotile 组合：仍有一个连接图块存活时目标仍存在', objectState.phase === 'combat')
    objectState.objects.find(object => object.id === 78)!.hp = 0
    objectState = tick(objectState, 0.1)
    check('防守保护 Autotile 组合：全部连接图块摧毁后进入失败分支', objectState.phase === 'lost')

    LEVEL.objects = []
    LEVEL.initialUnits = [{ id: 88, unitDefId: 'unit:uav', faction: 'ally', controller: 'ai', x: 8, y: 10, events: [] }]
    configureObjective(LEVEL, { type: 'defend', waves: 1, protectTarget: { type: 'unit', unitPlacementId: 88 } })
    let unitState = initialState()
    unitState.phase = 'combat'; unitState.spawnQueue = [{ kind: 'walker', delay: 100 }]; unitState.spawnTimer = 100
    unitState.allies.find(unit => unit.placementId === 88)!.hp = 0
    unitState = tick(unitState, 0.1)
    check('防守保护单位：所选已放置单位摧毁后立即进入失败分支', unitState.phase === 'lost')
  } finally {
    for (const key of Object.keys(LEVEL)) delete (LEVEL as unknown as Record<string, unknown>)[key]
    Object.assign(LEVEL, savedLevel)
    invalidateWallInfo()
  }
}

console.log('== v2.85：组合式 AI 自爆攻击 ==')
{
  const legacyKamikaze = structuredClone(unitDefById(enemyUnitId('walker'))!)
  legacyKamikaze.ai = {
    targeting: { profile: 'fortress' }, movement: { profile: 'direct' }, attack: { profile: 'kamikaze' }, special: { profile: 'none' },
  } as never
  legacyKamikaze.combat!.profile = 'kamikaze'
  legacyKamikaze.combat!.range = 8
  delete legacyKamikaze.combat!.kamikaze
  const migrated = normalizeKamikazeConfig(legacyKamikaze)
  check('自爆迁移：旧草稿补 0.5 格引爆距离、1.5 格半径与被击毁不爆默认值', migrated.combat?.range === 0.5
    && migrated.combat.kamikaze?.radius === 1.5 && migrated.combat.kamikaze.destroyedMode === 'none')

  const kamikazeId = 'unit:sim-kamikaze'
  const kamikaze = {
    id: kamikazeId, name: '测试自爆旋翼机', type: 'rotorcraft' as const, faction: 'enemy' as const,
    controller: 'ai' as const, targetClasses: ['fortress' as const, 'coreBuilding' as const, 'fixedBuilding' as const, 'wall' as const],
    stats: { hp: 40, speed: 2, size: 0.25, air: true },
    visual: { width: 0.5, height: 0.5 },
    combat: { profile: 'kamikaze' as const, range: 0.5, interval: 1, damage: 100, projectileSpeed: 0, penetration: 0, kamikaze: { radius: 1.5, destroyedMode: 'none' as const } },
    ai: { preferredTarget: 'playerControlled' as const, positioning: 'shortestRange' as const, movement: 'closeIn' as const, special: { profile: 'none' as const } },
  }
  try {
    const kamikazeSaved = saveCustomUnitDef(kamikaze)
    let arrival = arena()
    arrival.spawnQueue = [{ kind: 'walker', delay: 100 }]; arrival.spawnTimer = 100
    arrival.fortress.maxShield = 0; arrival.fortress.shield = 0
    arrival.fortress.armor = { front: 0, rear: 0, left: 0, right: 0 }
    const rect = fortressRect(arrival)
    const arriving = mkEnemy(arrival, 'walker', rect.x + rect.w / 2, rect.y + rect.h / 2, 40)
    arriving.controller = 'ai'
    arriving.unitDefId = kamikazeId; arriving.mode = 'move'; arriving.targetKind = null; arriving.targetId = null
    const hpBefore = arrival.fortress.hp, goldBefore = arrival.gold
    arrival = tick(arrival, 0.05)
    const arrivalExploded = arrival.explosions.some(explosion => explosion.r === 1.5)
    const arrivalResolved = arrival.enemies.some(enemy => enemy.id === arriving.id && enemy.hp === 0 && enemy.kamikazeArrival)
    arrival = run(arrival, 2, 0.1)
    check('自爆抵达：进入引爆距离恒造成满额范围伤害并移除自身', arrival.fortress.hp === hpBefore - 100
      && arrivalResolved && !arrival.enemies.some(enemy => enemy.id === arriving.id) && arrivalExploded,
      `saved=${kamikazeSaved} hp=${arrival.fortress.hp}/${hpBefore} resolved=${arrivalResolved} alive=${arrival.enemies.some(enemy => enemy.id === arriving.id)} exploded=${arrivalExploded}`)
    check('自爆抵达：主动引爆不计玩家击杀且不发放赏金', arrival.kills === 0 && arrival.gold === goldBefore)

    let destroyed = arena()
    destroyed.spawnQueue = [{ kind: 'walker', delay: 100 }]; destroyed.spawnTimer = 100
    destroyed.core = { id: -1000, name: '测试核心', x: 2, y: 2, w: 1, h: 1, hp: 500, maxHp: 500, color: '#fff' }
    destroyed.buildings = [{ id: 9201, name: '测试建筑', x: 2, y: 2, w: 1, h: 1, hp: 100, maxHp: 100, color: '#fff' }]
    destroyed.walls = [{ id: 9202, cells: [{ x: 2, y: 2 }], hp: 100, maxHp: 100, state: 'intact' }]
    destroyed.allies = [{ id: 9203, kind: 'soldier', producerId: -1, x: 2.5, y: 2.5, hp: 100, maxHp: 100, cooldown: 99, targetId: null, hitFlash: 0 }]
    const killed = mkEnemy(destroyed, 'walker', 2.5, 2.5, 0)
    killed.unitDefId = kamikazeId
    destroyed = tick(destroyed, 0.05)
    check('自爆被击毁：不爆档位不会产生爆炸或波及附近目标', destroyed.core?.hp === 500
      && destroyed.buildings[0]?.hp === 100 && destroyed.walls[0]?.hp === 100 && destroyed.allies[0]?.hp === 100)

    kamikaze.combat.kamikaze.destroyedMode = 'half'
    saveCustomUnitDef(kamikaze)
    let half = arena()
    half.spawnQueue = [{ kind: 'walker', delay: 100 }]; half.spawnTimer = 100
    half.core = { id: -1000, name: '测试核心', x: 2, y: 2, w: 1, h: 1, hp: 500, maxHp: 500, color: '#fff' }
    half.buildings = [{ id: 9301, name: '测试建筑', x: 2, y: 2, w: 1, h: 1, hp: 100, maxHp: 100, color: '#fff' }]
    half.walls = [{ id: 9302, cells: [{ x: 2, y: 2 }], hp: 100, maxHp: 100, state: 'intact' }]
    half.allies = [{ id: 9303, kind: 'soldier', producerId: -1, x: 2.5, y: 2.5, hp: 100, maxHp: 100, cooldown: 99, targetId: null, hitFlash: 0 }]
    const halfKilled = mkEnemy(half, 'walker', 2.5, 2.5, 0)
    halfKilled.unitDefId = kamikazeId
    half = tick(half, 0.05)
    check('自爆被击毁：半额档位以 50% 伤害同时波及核心、建筑、墙和友军', half.core?.hp === 450
      && half.buildings[0]?.hp === 50 && half.walls[0]?.hp === 50 && half.allies[0]?.hp === 50)
    check('自爆被击毁：爆炸只结算一次且仍按正常击杀发放赏金', half.explosions.filter(explosion => explosion.r === 1.5).length === 1
      && half.kills === 1 && half.gold > 100000)

    check('新版战斗目标：自爆单位使用首选玩家主控单位，不再保留旧静态攻城目标分支',
      unitDefById(kamikazeId)?.ai?.preferredTarget === 'playerControlled')
  } finally {
    deleteCustomUnitDef(kamikazeId)
  }
}

console.log('== v2.87：单位类型专属参数与飞行器拆分 ==')
{
  const retiredInfantry = normalizeKamikazeConfig({
    id: 'unit:sim-retired-infantry', name: '退役步兵', type: 'infantry', targetClasses: ['combatUnit'],
    stats: { hp: 50, speed: 1, size: 0.2, air: false },
  } as never)
  const rotorBase = normalizeKamikazeConfig({
    id: 'unit:sim-rotor-base', name: '测试旋翼机', type: 'rotorcraft', targetClasses: ['combatUnit'],
    stats: { hp: 50, speed: 3, size: 0.2, air: true },
  })
  const legacyRotorId = 'unit:sim-legacy-rotor-coordinate'
  importUnitLibrary({ version: 15, customs: [{
    ...structuredClone(rotorBase), id: legacyRotorId,
    typeConfig: {
      kind: 'rotorcraft', rotors: [{ id: 'legacy-pair', asset: 'builtin:library/prop01', unit: 'pair', x: 0.5, y: -0.25, speed: 600 }],
      altitude: 0.8, minAltitude: 0.2, maxAltitude: 3, climbRate: 1, accel: 4, turnSpeed: 180,
    },
  }] })
  const migratedRotorConfig = unitTypeConfig(unitDefById(legacyRotorId)!)
  check('旋翼坐标迁移：v15 被输入框误除以32的坐标恢复为真实像素值',
    migratedRotorConfig?.kind === 'rotorcraft'
      && migratedRotorConfig.rotors?.[0]?.x === 16
      && migratedRotorConfig.rotors?.[0]?.y === -8
      && migratedRotorConfig.rotors?.[0]?.layer === 'above',
    JSON.stringify(migratedRotorConfig?.kind === 'rotorcraft' ? migratedRotorConfig.rotors : migratedRotorConfig))
  deleteCustomUnitDef(legacyRotorId)
  const aircraft = normalizeKamikazeConfig({ ...rotorBase, id: 'unit:sim-aircraft-default', type: 'aircraft', stats: { ...rotorBase.stats, air: true } } as unknown as typeof rotorBase)
  const fixedWing = normalizeKamikazeConfig({
    ...rotorBase, id: 'unit:sim-fixed-wing', type: 'fixedWingAircraft', stats: { ...rotorBase.stats, speed: 3, air: true },
    typeConfig: { kind: 'fixedWingAircraft', altitude: 1.2, minAltitude: 0.5, maxAltitude: 4, climbRate: 0.75, accel: 3, turnSpeed: 90, minSpeed: 1, turnRadius: 2.5 },
  })
  const vehicle = normalizeKamikazeConfig({ ...rotorBase, id: 'unit:sim-vehicle-default', type: 'vehicle', stats: { ...rotorBase.stats, air: false } })
  const staleRotor = normalizeKamikazeConfig({ ...rotorBase, id: 'unit:sim-stale-rotor-air', stats: { ...rotorBase.stats, air: false } })
  const staleFixedWing = normalizeKamikazeConfig({ ...fixedWing, id: 'unit:sim-stale-fixed-wing-air', stats: { ...fixedWing.stats, air: false } })
  check('类型迁移：步兵已停用、旧飞行器无损迁移为旋翼飞行器，现有类型补安全默认值', validateUnitDef(retiredInfantry).some(error => error.includes('单位类型已停用'))
    && aircraft.type === 'rotorcraft' && unitTypeConfig(aircraft)?.kind === 'rotorcraft' && unitAltitude(aircraft) === 0.8
    && unitTypeConfig(vehicle)?.kind === 'vehicle' && unitTypeConfig(vehicle)?.chassis === 'tracked')
  check('飞行寻路：旋翼与固定翼以单位类型修正空中标记，敌方挂炮飞行器不会进入地面距离场',
    staleRotor.stats.air && staleFixedWing.stats.air
      && !unitUsesGroundApproachPath(staleRotor) && !unitUsesGroundApproachPath(staleFixedWing)
      && unitUsesGroundApproachPath(vehicle))
  const aircraftConfig = unitTypeConfig(aircraft)
  const singleRotor = rotorPlacements({ id: 'single', asset: 'rotor', unit: 'single', x: 11, y: -7, speed: 720 })
  const pairedRotors = rotorPlacements({ id: 'pair', asset: 'rotor', unit: 'pair', x: 11, y: -7, speed: 720 })
  check('旋翼坐标：单个保留配置坐标；一对按 X 左右镜像并使用相反旋向',
    singleRotor.length === 1 && singleRotor[0].x === 11 && singleRotor[0].y === -7 && singleRotor[0].speed === 720
      && pairedRotors.length === 2
      && pairedRotors[0].x === -11 && pairedRotors[1].x === 11
      && pairedRotors.every(rotor => rotor.y === -7)
      && pairedRotors[0].speed === 720 && pairedRotors[1].speed === -720,
    `single=${JSON.stringify(singleRotor)} pair=${JSON.stringify(pairedRotors)}`)
  const layeredRotor = normalizeKamikazeConfig({
    ...rotorBase,
    id: 'unit:sim-layered-rotor',
    typeConfig: {
      kind: 'rotorcraft', rotors: [{ id: 'lower', asset: 'rotor', layer: 'below', unit: 'single', x: 0, y: 0, speed: 720 }],
      altitude: 0.8, minAltitude: 0.2, maxAltitude: 3, climbRate: 1, accel: 4, turnSpeed: 180,
    },
  })
  check('旋翼层级：旧数据默认在上，显式“下”配置可持久保留',
    aircraftConfig?.kind === 'rotorcraft'
      && (aircraftConfig.rotors ?? []).every(rotor => (rotor.layer ?? 'above') === 'above')
      && unitTypeConfig(layeredRotor)?.kind === 'rotorcraft'
      && unitTypeConfig(layeredRotor)?.rotors?.[0]?.layer === 'below')
  const aircraftHost = { x: 5, y: 5, aircraft: { heading: 0, vx: 0, vy: 0, altitude: 0.8, targetAltitude: 0.8, verticalSpeed: 0 } }
  for (let index = 0; index < 10; index++) moveUnitAircraftToward(aircraftHost, aircraft, 10, 5, 0.1)
  check('旋翼飞行器：旧参数保留，单位按受限转向连续加速且阴影由高度自动推导',
    aircraftConfig?.kind === 'rotorcraft' && aircraftConfig.accel === 4 && aircraftConfig.turnSpeed === 180
      && aircraftHost.x > 5 && Math.hypot(aircraftHost.aircraft.vx, aircraftHost.aircraft.vy) <= aircraft.stats.speed + 1e-6
      && unitShadowScale(aircraft) < 1)
  const strafingRotorHost = {
    id: 705, x: 8, y: 8,
    aircraft: { heading: 0, vx: 0, vy: 0, altitude: 0.8, targetAltitude: 0.8, verticalSpeed: 0 },
    vehicle: { heading: 0, vx: 0, vy: 0 },
  }
  for (let index = 0; index < 10; index++) moveUnitAircraftToward(strafingRotorHost, aircraft, 12, 8, 0.1, 0.62, 0)
  check('旋翼战斗环绕：受限炮位可保持机头朝向，同时沿环绕切线持续侧飞',
    strafingRotorHost.x > 8.2
      && Math.abs(wrapAngle(strafingRotorHost.aircraft.heading)) < 1e-9
      && Math.abs(wrapAngle(strafingRotorHost.vehicle.heading)) < 1e-9
      && strafingRotorHost.aircraft.vx > 0.1,
    `pos=${strafingRotorHost.x.toFixed(2)},${strafingRotorHost.y.toFixed(2)} heading=${strafingRotorHost.aircraft.heading.toFixed(2)} vx=${strafingRotorHost.aircraft.vx.toFixed(2)}`)
  const fixedHost = { id: 13, x: 8, y: 8, aircraft: { heading: 0, vx: 0, vy: -1, altitude: 1.2, targetAltitude: 1.2, verticalSpeed: 0 } }
  const fixedStart = { x: fixedHost.x, y: fixedHost.y }
  for (let index = 0; index < 30; index++) moveUnitAircraftToward(fixedHost, fixedWing, 8, 8, 0.1, 0)
  const fixedSpeed = Math.hypot(fixedHost.aircraft.vx, fixedHost.aircraft.vy)
  check('固定翼飞行器：无推进或抵达目标后仍保持最低航速并围绕目标盘旋',
    fixedSpeed >= 1 - 1e-6 && Math.hypot(fixedHost.x - fixedStart.x, fixedHost.y - fixedStart.y) > 0.2
      && Math.abs(fixedHost.aircraft.heading) > 0.05,
    `speed=${fixedSpeed.toFixed(2)} pos=${fixedHost.x.toFixed(2)},${fixedHost.y.toFixed(2)} heading=${fixedHost.aircraft.heading.toFixed(2)}`)
  const edgeRotorHost = {
    id: 707, x: LEVEL.cols / 2, y: LEVEL.rows - 0.1,
    aircraft: { heading: Math.PI, vx: 0, vy: 0, altitude: 0.8, targetAltitude: 0.8, verticalSpeed: 0 },
  }
  for (let index = 0; index < 12; index++) moveUnitAircraftToward(edgeRotorHost, aircraft, edgeRotorHost.x, LEVEL.rows + 4, 0.1)
  const rotorLeftBattlefield = edgeRotorHost.y > LEVEL.rows
  for (let index = 0; index < 45; index++) moveUnitAircraftToward(edgeRotorHost, aircraft, LEVEL.cols / 2, LEVEL.rows - 4, 0.1)
  check('飞行边界：旋翼机可以越过战场边缘继续转向，并按后续目标自主返回',
    rotorLeftBattlefield && edgeRotorHost.y < LEVEL.rows,
    `left=${rotorLeftBattlefield} returnPos=${edgeRotorHost.x.toFixed(2)},${edgeRotorHost.y.toFixed(2)}`)
  const edgeFixedHost = {
    id: 709, x: LEVEL.cols / 2, y: LEVEL.rows - 0.1,
    aircraft: { heading: Math.PI, vx: 0, vy: 1, altitude: 1.2, targetAltitude: 1.2, verticalSpeed: 0 },
  }
  for (let index = 0; index < 15; index++) moveUnitAircraftToward(edgeFixedHost, fixedWing, edgeFixedHost.x, LEVEL.rows + 3, 0.1, 1)
  const fixedLeftBattlefield = edgeFixedHost.y > LEVEL.rows
  for (let index = 0; index < 120; index++) moveUnitAircraftToward(edgeFixedHost, fixedWing, LEVEL.cols / 2, LEVEL.rows - 5, 0.1, 1)
  check('飞行边界：固定翼越界后仍保持最低航速和转向能力，不会被边界钳成静止',
    fixedLeftBattlefield && edgeFixedHost.y < LEVEL.rows,
    `left=${fixedLeftBattlefield} returnPos=${edgeFixedHost.x.toFixed(2)},${edgeFixedHost.y.toFixed(2)} speed=${Math.hypot(edgeFixedHost.aircraft.vx, edgeFixedHost.aircraft.vy).toFixed(2)}`)
  let offMapShotState = arena()
  offMapShotState.phase = 'prep'
  offMapShotState.prepLeft = 99
  offMapShotState.enemyProjectiles = []
  const offMapTarget = fortressRect(offMapShotState)
  const offMapTargetX = offMapTarget.x + offMapTarget.w / 2
  const offMapTargetY = offMapTarget.y + offMapTarget.h / 2
  const offMapShotId = offMapShotState.nextId++
  const offMapHpBefore = offMapShotState.fortress.hp
  offMapShotState.enemyProjectiles.push({
    id: offMapShotId, shooterId: -707,
    x: -1, y: offMapTargetY, px: -1, py: offMapTargetY,
    heading: Math.PI / 2, speed: 32, damage: 10, penetration: 999,
    traveled: 0, maxTravel: 200, targetKind: 'fortress', targetId: 0,
    targetX: offMapTargetX, targetY: offMapTargetY,
    sourceSide: 'enemy', sourceFaction: 'enemy',
  })
  offMapShotState = tick(offMapShotState, 0.05)
  const shotSurvivedOutside = offMapShotState.enemyProjectiles.some(projectile => projectile.id === offMapShotId && projectile.x < 0)
  offMapShotState = run(offMapShotState, 5, 0.05)
  const remainingOffMapShot = offMapShotState.enemyProjectiles.find(projectile => projectile.id === offMapShotId)
  check('飞行边界：场外飞行器发射的弹丸不会被地图边缘删除，可飞回场内正常命中',
    shotSurvivedOutside && offMapShotState.fortress.hp < offMapHpBefore,
    `survived=${shotSurvivedOutside} hp=${offMapShotState.fortress.hp}/${offMapHpBefore} target=${offMapTargetX.toFixed(2)},${offMapTargetY.toFixed(2)} projectile=${remainingOffMapShot?.x.toFixed(2)},${remainingOffMapShot?.y.toFixed(2)}`)
  setUnitAircraftTargetAltitude(fixedHost, fixedWing, 99)
  updateUnitAircraftAltitude(fixedHost, fixedWing, 1)
  check('动态高度：目标高度按模板上下限钳制，并以爬升速度逐帧接近', fixedHost.aircraft.targetAltitude === 4
    && Math.abs(currentUnitAltitude(fixedHost, fixedWing) - 1.95) < 1e-6
    && Math.abs(fixedHost.aircraft.verticalSpeed - 0.75) < 1e-6)
  setUnitAircraftTargetAltitude(fixedHost, fixedWing, -99)
  updateUnitAircraftAltitude(fixedHost, fixedWing, 4)
  check('动态高度：下降同样遵守最低高度和下降速度', fixedHost.aircraft.targetAltitude === 0.5
    && Math.abs(currentUnitAltitude(fixedHost, fixedWing) - 0.5) < 1e-6)
  const crashingRotor = {
    id: 701, x: 7, y: 7,
    aircraft: { heading: 0, vx: 1.2, vy: -0.4, altitude: 1.6, targetAltitude: 1.6, verticalSpeed: 0 },
  }
  const rotorCrashStarted = beginUnitAircraftCrash(crashingRotor, aircraft, 12)
  const rotorCrashStart = { x: crashingRotor.x, y: crashingRotor.y, heading: crashingRotor.aircraft.heading }
  for (let index = 0; index < 5; index++) advanceUnitAircraftCrash(crashingRotor, aircraft, 0.1)
  const rejectedCrashAltitudeChange = !setUnitAircraftTargetAltitude(crashingRotor, aircraft, 3)
  updateUnitAircraftAltitude(crashingRotor, aircraft, 1)
  check('旋翼坠毁：结构归零后自转、保留水平惯性并持续下降，普通高度指令不再接管', rotorCrashStarted
    && crashingRotor.aircraft.altitude < 1.6
    && Math.abs(crashingRotor.aircraft.heading - rotorCrashStart.heading) > 0.2
    && Math.hypot(crashingRotor.x - rotorCrashStart.x, crashingRotor.y - rotorCrashStart.y) > 0.1
    && rejectedCrashAltitudeChange,
  `alt=${crashingRotor.aircraft.altitude.toFixed(2)} heading=${crashingRotor.aircraft.heading.toFixed(2)} pos=${crashingRotor.x.toFixed(2)},${crashingRotor.y.toFixed(2)}`)
  const driftRotor = {
    id: 703, x: 12, y: 12,
    aircraft: { heading: 0, vx: 0, vy: 0, altitude: 2.4, targetAltitude: 2.4, verticalSpeed: 0 },
  }
  const otherDriftRotor = {
    id: 704, x: 12, y: 12,
    aircraft: { heading: 0, vx: 0, vy: 0, altitude: 2.4, targetAltitude: 2.4, verticalSpeed: 0 },
  }
  beginUnitAircraftCrash(driftRotor, aircraft, 30)
  beginUnitAircraftCrash(otherDriftRotor, aircraft, 30)
  const driftHeading = driftRotor.aircraft.crash!.driftHeading!
  const earlyHeading = driftRotor.aircraft.heading
  const earlyAltitude = driftRotor.aircraft.altitude
  advanceUnitAircraftCrash(driftRotor, aircraft, 0.1)
  const earlySpin = Math.abs(wrapAngle(driftRotor.aircraft.heading - earlyHeading))
  const earlyDescent = earlyAltitude - driftRotor.aircraft.altitude
  const startCrashGain = unitAircraftMovementAudioGain({ ...driftRotor.aircraft.crash!, elapsed: 0 })
  const middleCrashGain = unitAircraftMovementAudioGain({ ...driftRotor.aircraft.crash!, elapsed: driftRotor.aircraft.crash!.duration * 0.5 })
  for (let index = 0; index < 9; index++) advanceUnitAircraftCrash(driftRotor, aircraft, 0.1)
  const lateHeading = driftRotor.aircraft.heading
  const lateAltitude = driftRotor.aircraft.altitude
  advanceUnitAircraftCrash(driftRotor, aircraft, 0.1)
  const lateSpin = Math.abs(wrapAngle(driftRotor.aircraft.heading - lateHeading))
  const lateDescent = lateAltitude - driftRotor.aircraft.altitude
  const driftProjection = (driftRotor.x - 12) * dirX(driftHeading) + (driftRotor.y - 12) * dirY(driftHeading)
  check('旋翼坠毁：每个实例确定随机偏出方向，并持续向该方向漂移', Number.isFinite(driftHeading)
    && driftRotor.aircraft.crash!.driftHeading !== otherDriftRotor.aircraft.crash!.driftHeading
    && driftProjection > 0.04,
  `heading=${driftHeading.toFixed(2)} other=${otherDriftRotor.aircraft.crash!.driftHeading?.toFixed(2)} projection=${driftProjection.toFixed(3)}`)
  check('旋翼坠毁：后段自转和下降速度高于初段', lateSpin > earlySpin * 1.25 && lateDescent > earlyDescent * 1.25,
    `spin=${earlySpin.toFixed(3)}→${lateSpin.toFixed(3)} descent=${earlyDescent.toFixed(3)}→${lateDescent.toFixed(3)}`)
  check('旋翼坠毁：移动循环音按进度由 1 平滑衰减至 0', startCrashGain === 1
    && middleCrashGain > 0 && middleCrashGain < startCrashGain
    && unitAircraftMovementAudioGain({ ...driftRotor.aircraft.crash!, elapsed: driftRotor.aircraft.crash!.duration }) === 0,
  `gain=${startCrashGain.toFixed(2)}→${middleCrashGain.toFixed(2)}→0`)
  check('旋翼移动音：静止为10%，达到极速80%时满音量且之后保持满音量', ROTORCRAFT_AUDIO_MIN_GAIN === 0.1
    && ROTORCRAFT_AUDIO_FULL_SPEED_RATIO === 0.8
    && rotorcraftMovementAudioGain(0, 10) === 0.1
    && rotorcraftMovementAudioGain(4, 10) === 0.55
    && rotorcraftMovementAudioGain(8, 10) === 1
    && rotorcraftMovementAudioGain(12, 10) === 1)
  check('旋翼坠毁音：无论坠毁瞬间速度如何都从100%开始并按坠毁进度衰减', rotorcraftMovementAudioGain(0, 10, { ...driftRotor.aircraft.crash!, elapsed: 0 }) === 1
    && rotorcraftMovementAudioGain(0, 10, { ...driftRotor.aircraft.crash!, elapsed: driftRotor.aircraft.crash!.duration * 0.5 }) === middleCrashGain
    && rotorcraftMovementAudioGain(12, 10, { ...driftRotor.aircraft.crash!, elapsed: driftRotor.aircraft.crash!.duration }) === 0)
  let rotorImpacted = false
  for (let index = 0; index < 50 && !rotorImpacted; index++) rotorImpacted = advanceUnitAircraftCrash(crashingRotor, aircraft, 0.1)
  check('旋翼坠毁：下降完成后才触地并归零高度与速度', rotorImpacted
    && crashingRotor.aircraft.altitude === 0
    && crashingRotor.aircraft.vx === 0 && crashingRotor.aircraft.vy === 0)

  const crashingFixed = {
    id: 702, x: 10, y: 10,
    aircraft: { heading: 0, vx: 0, vy: -2, altitude: 2.2, targetAltitude: 2.2, verticalSpeed: 0 },
  }
  beginUnitAircraftCrash(crashingFixed, fixedWing, 20)
  const fixedCrashStart = { x: crashingFixed.x, y: crashingFixed.y, heading: crashingFixed.aircraft.heading }
  for (let index = 0; index < 7; index++) advanceUnitAircraftCrash(crashingFixed, fixedWing, 0.1)
  const fixedCrashSpeed = Math.hypot(crashingFixed.aircraft.vx, crashingFixed.aircraft.vy)
  check('固定翼坠毁：保持前进速度并以大半径弧线俯冲，不会原地垂落', crashingFixed.aircraft.altitude < 2.2
    && fixedCrashSpeed >= 0.7
    && Math.hypot(crashingFixed.x - fixedCrashStart.x, crashingFixed.y - fixedCrashStart.y) > 0.5
    && Math.abs(crashingFixed.aircraft.heading - fixedCrashStart.heading) > 0.02,
  `alt=${crashingFixed.aircraft.altitude.toFixed(2)} speed=${fixedCrashSpeed.toFixed(2)} pos=${crashingFixed.x.toFixed(2)},${crashingFixed.y.toFixed(2)}`)
  const lowWall: BattleObject = { id: 1, kind: 'rock', x: 0, y: 0, w: 1, h: 1, hp: 1, maxHp: 1, blockMove: true, blockProjectile: true, height: 1 }
  const highWall: BattleObject = { ...lowWall, id: 2, height: 3 }
  check('动态高度战斗：高度 1 物体阻挡地面弹道，但飞行高度足够时可越过', objectBlocksEnvironmentShot(lowWall, { kind: 'direct', subtype: 'bullet', altitude: 0 })
    && !objectBlocksEnvironmentShot(lowWall, { kind: 'direct', subtype: 'bullet', altitude: 1.2 })
    && objectBlocksEnvironmentShot(highWall, { kind: 'direct', subtype: 'bullet', altitude: 2 }))
  const shortArc = shellArcVisual(0.5, 0, 0, 2, 0)
  const longArc = shellArcVisual(0.5, 0, 0, 12, 0)
  const earlyArc = shellArcVisual(0.2, 0, 0, 12, 0)
  const lateArc = shellArcVisual(0.9, 0, 0, 12, 0)
  check('抛射视觉：弧高随射程增加，阴影在最高点缩小且落点提示只在末段出现', longArc.altitude > shortArc.altitude
    && longArc.shadowScale < 1 && earlyArc.landingProgress === 0 && lateArc.landingProgress > 0)
  const invalidFixedWing = structuredClone(fixedWing)
  if (invalidFixedWing.typeConfig?.kind === 'fixedWingAircraft') invalidFixedWing.typeConfig.minSpeed = invalidFixedWing.stats.speed + 1
  check('固定翼校验：最低航速不能超过最大移动速度', validateUnitDef(invalidFixedWing).some(error => error.includes('最低航速')))
  const platformDrone = structuredClone(rotorBase)
  platformDrone.id = 'unit:sim-platform-drone'
  platformDrone.name = '平台无人机'
  platformDrone.vehiclePlatform = {
    ...structuredClone(DEFAULT_FORTRESS), id: 'unit-platform:unit:sim-platform-drone', unitId: platformDrone.id,
    name: platformDrone.name, platformType: 'rotorcraft', chassis: 'hovercraft', hp: platformDrone.stats.hp,
    speed: platformDrone.stats.speed, tracks: undefined, wheels: undefined,
    rotors: [{ id: 'main', asset: 'builtin:rotor/rotor01', unit: 'single', x: 0, y: 0, speed: 720 }],
    altitude: 0.8, minAltitude: 0.2, maxAltitude: 3, climbRate: 1,
    hardpoints: [{ id: 'hp1', x: 2.5, y: 4, size: 'S' }],
    effects: [{ id: 'fx1', x: 2.5, y: 6, kind: 'smoke', state: 'move' }],
  }
  const platformSaved = saveCustomUnitDef(platformDrone)
  const platformResolved = unitDefById(platformDrone.id)
  check('飞行载具共用平台：旋翼飞行器可持久化矩形车体、炮位、特效点与旋翼专属模板', platformSaved
    && platformResolved?.type === 'rotorcraft'
    && platformResolved.vehiclePlatform?.hardpoints[0]?.id === 'hp1'
    && platformResolved.vehiclePlatform?.effects?.[0]?.id === 'fx1'
    && platformResolved.vehiclePlatform?.rotors?.[0]?.id === 'main')
  const deployableAircraft = playableVehicleDefs().find(def => def.unitId === platformDrone.id)
  const aircraftPreset = deployableAircraft ? normalizeVehicleLoadout({ id: 'sim-aircraft-preset', name: '飞行出战', fortressDefId: deployableAircraft.id, turrets: [], modules: [] }) : null
  check('关卡备选出战：旋翼与固定翼平台进入统一载具候选并可建立整备预设', deployableAircraft?.platformType === 'rotorcraft'
    && deployableAircraft.hardpoints[0]?.id === 'hp1' && aircraftPreset?.fortressDefId === deployableAircraft.id)
  if (platformResolved) {
    let flightState = arena()
    flightState.phase = 'combat'; flightState.spawnQueue = []; flightState.enemies = []
    const playerRect = fortressRect(flightState)
    const flyer = mkEnemy(flightState, 'walker', playerRect.x + playerRect.w / 2, playerRect.y + playerRect.h / 2, platformResolved.stats.hp)
    flyer.unitDefId = platformResolved.id
    flyer.controller = 'ai'
    flyer.aiOverride = {
      targeting: { profile: 'fortress' }, movement: { profile: 'stationary' },
      attack: { profile: 'projectile' }, special: { profile: 'none' },
    }
    flyer.vehicle = {
      heading: 0, vx: 0, vy: 3, steerAngle: 0, turnW: 0,
      heat: 0, overheated: false, heatCap: 100, heatDissipation: 10,
      trackPhase: [], armor: { front: 0, rear: 0, left: 0, right: 0 }, maxArmor: { front: 0, rear: 0, left: 0, right: 0 }, turrets: [],
    }
    flyer.aircraft = { heading: 0, vx: 0, vy: 3, altitude: 0.8, targetAltitude: 0.8, verticalSpeed: 0 }
    const beforeCollision = { x: flyer.x, y: flyer.y, hp: flyer.hp, fortressHp: flightState.fortress.hp }
    const flightHits = applyFortressVehicleCollisions(flightState, 0, -3)
    check('飞行载具碰撞：空中单位不参与玩家载具的实体分离或冲撞伤害', flightHits === 0
      && flyer.x === beforeCollision.x && flyer.y === beforeCollision.y && flyer.hp === beforeCollision.hp
      && flightState.fortress.hp === beforeCollision.fortressHp)

    flyer.x = playerRect.x + playerRect.w / 2
    flyer.y = Math.max(1, playerRect.y + playerRect.h / 2 - 3)
    flyer.vehicle.vx = 0; flyer.vehicle.vy = 0
    flyer.aircraft.vx = 0; flyer.aircraft.vy = 0
    platformResolved.vehiclePlatform!.hardpoints[0].builtIn = 'mg'
    ensureUnitVehicleTurrets(flightState, flyer, platformResolved)
    let flightMuzzle: typeof flightState.muzzles[number] | undefined
    for (let index = 0; index < 80 && !flightMuzzle; index++) {
      flightState = tick(flightState, 0.05)
      flightMuzzle = flightState.muzzles.find(item => flyer.vehicle?.turrets?.some(turret => turret.id === item.turretId))
    }
    check('飞行载具炮口：炮口事件继承发射单位高度并与炮塔、弹丸视觉对齐', Math.abs((flightMuzzle?.sourceAltitude ?? -1) - 0.8) < 1e-6,
      JSON.stringify({ muzzle: flightMuzzle, turrets: flyer.vehicle.turrets, enemyProjectiles: flightState.enemyProjectiles.slice(-2), flyer: flightState.enemies.find(item => item.id === flyer.id) }))
    const flightProjectile = flightState.enemyProjectiles.find(projectile => flyer.vehicle?.turrets?.some(turret => turret.id === projectile.shooterId))
    check('飞行载具弹丸：出生首帧视觉高度等于炮口与发射单位高度', !!flightProjectile
      && Math.abs((flightProjectile.sourceAltitude ?? -1) - 0.8) < 1e-6
      && Math.abs(projectileAltitudeAtTravel(flightProjectile, 0) - 0.8) < 1e-6)
    flightState.time += 1
    damageEnemy(flightState, flyer, 1, null, { x: flyer.x, y: flyer.y - 1, incomingDx: 0, incomingDy: 1, ammoId: 'bullet_std' })
    const flightHit = flightState.unitHits.at(-1)
    check('飞行载具受击：命中事件保存实时高度并叠加到空中主体', Math.abs((flightHit?.altitude ?? -1) - 0.8) < 1e-6)
    flightState.spawnQueue = [{ kind: 'walker', delay: 100 }]
    flightState.spawnTimer = 100
    flightState.projectiles = []; flightState.enemyProjectiles = []; flightState.explosions = []; flightState.audioSignals = []
    const liveFlyerBeforeCrash = flightState.enemies.find(enemy => enemy.id === flyer.id)
    if (liveFlyerBeforeCrash) liveFlyerBeforeCrash.hp = 0
    flightState = tick(flightState, 0.05)
    const crashingFlyer = flightState.enemies.find(enemy => enemy.id === flyer.id)
    check('飞行坠毁闭环：结构归零先保留空中单位并停止炮塔，不立即播放触地主爆炸', !!crashingFlyer?.aircraft?.crash
      && flightState.explosions.length === 0
      && !flightState.audioSignals?.some(signal => signal.kind === 'unitDeath')
      && crashingFlyer.vehicle?.turrets?.every(turret => !turret.firing && turret.burstLeft === 0),
    `alive=${!!crashingFlyer} crash=${!!crashingFlyer?.aircraft?.crash} explosions=${flightState.explosions.length}`)
    flightState = run(flightState, 1.4, 0.05)
    check('飞行坠毁闭环：下降触地后才移除单位并生成统一摧毁模板与死亡音频', !flightState.enemies.some(enemy => enemy.id === flyer.id)
      && flightState.explosions.length === 1
      && flightState.explosions[0]?.kind === 'unitDeath'
      && !!flightState.audioSignals?.some(signal => signal.kind === 'unitDeath'),
    `alive=${flightState.enemies.some(enemy => enemy.id === flyer.id)} explosions=${flightState.explosions.length} audio=${flightState.audioSignals?.map(signal => signal.kind).join(',')}`)
  }
  deleteCustomUnitDef(platformDrone.id)
  const collidingVehicle: FortressDef = { ...structuredClone(DEFAULT_FORTRESS), id: 'sim-uav-collision', unitId: 'unit:uav', name: '错误的无人机载具快照' }
  FORTRESS_DEFS.push(collidingVehicle)
  try {
    const resolvedUav = unitDefById('unit:uav')
    check('内置飞行器保留 ID：旧载具快照不能遮住无人飞行器', resolvedUav?.type === 'rotorcraft' && resolvedUav.name === '无人飞行器')
  } finally {
    FORTRESS_DEFS.splice(FORTRESS_DEFS.indexOf(collidingVehicle), 1)
  }
  const explicitWalker: FortressDef = { ...structuredClone(DEFAULT_FORTRESS), id: 'sim-uav-walker', unitId: 'unit:uav', name: '无人步行机甲', chassis: 'walker', explicitUnitTypeOverride: true }
  FORTRESS_DEFS.push(explicitWalker)
  try {
    const resolvedWalker = unitDefById('unit:uav')
    check('单位编辑器显式转换：内置飞行器可使用同一稳定 ID 切换为步行机甲', resolvedWalker?.type === 'vehicle'
      && unitTypeConfig(resolvedWalker)?.kind === 'vehicle' && unitTypeConfig(resolvedWalker)?.chassis === 'walker')
  } finally {
    FORTRESS_DEFS.splice(FORTRESS_DEFS.indexOf(explicitWalker), 1)
  }
  const staleVehicleConfig = unitTypeConfig(vehicle)
  const legacyWheeled = {
    ...vehicle,
    typeConfig: staleVehicleConfig?.kind === 'vehicle' ? { ...staleVehicleConfig, chassis: 'tracked' as const } : undefined,
    legacy: { registry: 'fortress' as const, id: 'sim-wheel', def: { ...structuredClone(DEFAULT_FORTRESS), id: 'sim-wheel', chassis: 'wheeled' as const } },
  }
  check('载具类型来源：完整载具定义优先于旧单位副本，轮式吉普不会误标为履带载具', unitTypeConfig(legacyWheeled)?.kind === 'vehicle'
    && unitTypeConfig(legacyWheeled)?.chassis === 'wheeled')
  const legacyPlacementDefaults = normalizeKamikazeConfig({ ...rotorBase, faction: 'enemy', controller: 'ai' } as typeof rotorBase & { faction: string; controller: string })
  check('单位模板归属迁移：旧阵营和控制器字段被移除，归属只由关卡实例保存', !('faction' in legacyPlacementDefaults) && !('controller' in legacyPlacementDefaults))

  const invalidBuilding = structuredClone(rotorBase)
  invalidBuilding.type = 'building'; invalidBuilding.typeConfig = { kind: 'building', footprintW: 0, footprintH: 13, blocksMovement: true }
  check('类型校验：拒绝非法建筑占格', validateUnitDef(invalidBuilding).some(error => error.includes('建筑占格')))

  const buildingId = 'unit:sim-blocking-building'
  const building = {
    id: buildingId, name: '测试阻挡建筑', type: 'building' as const,
    targetClasses: ['combatUnit' as const], stats: { hp: 120, speed: 5, size: 0.4, air: false },
    visual: { width: 2, height: 3 }, typeConfig: { kind: 'building' as const, footprintW: 2, footprintH: 3, blocksMovement: true },
    combat: { profile: 'hitscan' as const, range: 8, interval: 1, projectileId: 'ray_std', damage: 5, projectileSpeed: 0, penetration: 0 },
    ai: { targeting: { profile: 'closestHostile' as const, allowedTargets: ['combatUnit' as const] }, movement: { profile: 'direct' as const }, attack: { profile: 'hitscan' as const } },
  }
  try {
    saveCustomUnitDef(building)
    check('建筑占格：运行时解析 2×3 阻挡矩形并保留可配置开关', unitFootprint(unitDefById(buildingId)!).w === 2
      && unitFootprint(unitDefById(buildingId)!).h === 3 && unitFootprint(unitDefById(buildingId)!).blocksMovement)
    let state = arena()
    state.spawnQueue = [{ kind: 'walker', delay: 100 }]; state.spawnTimer = 100
    state.objects = []; state.walls = []; state.buildings = []; state.core = null
    state.allies = [{ id: 9401, kind: 'soldier', unitDefId: buildingId, producerId: 0, x: 5, y: 6.5, hp: 120, maxHp: 120, cooldown: 0, targetId: null, hitFlash: 0 }]
    const before = { x: state.allies[0].x, y: state.allies[0].y }
    check('建筑占格：2×3 范围进入 combatUnit 阻挡查询', blockerAt(state, 4, 5)?.kind === 'combatUnit'
      && blockerAt(state, 5, 7)?.kind === 'combatUnit' && blockerAt(state, 6, 7) === null)
    mkEnemy(state, 'walker', 10, 6.5, 100)
    state = run(state, 0.8, 0.1)
    check('建筑单位：即使定义了移动速度和直冲 AI 也保持原地', state.allies[0]?.x === before.x && state.allies[0]?.y === before.y)
    const pathVersion = state.pathVersion
    if (state.allies[0]) state.allies[0].hp = 0
    state = run(state, 0.8, 0.1)
    check('建筑占格：建筑阵亡后移除阻挡并触发寻路版本更新', !state.allies.some(ally => ally.id === 9401)
      && state.pathVersion > pathVersion && blockerAt(state, 4, 5)?.kind !== 'combatUnit',
      `allies=${state.allies.map(ally => `${ally.id}:${ally.hp}:${ally.deathLeft}`).join(',')} path=${state.pathVersion}/${pathVersion} blocker=${blockerAt(state, 4, 5)?.kind ?? 'none'}`)
  } finally {
    deleteCustomUnitDef(buildingId)
  }
}

console.log('== v2.87：Boss 阶段与单位脚本控制 ==')
{
  const normalized = normalizeEventActions([{ type: 'unit', selector: { scope: 'broken' }, command: { kind: 'move', x: -5, y: 999, speed: 99, wait: true } }, { type: 'unit', selector: { scope: 'allEnemies' }, command: { kind: 'ai', mode: 'replace', targeting: 'bad', movement: 'direct', attack: 'projectile' } }, { type: 'unit', selector: { scope: 'source' }, command: { kind: 'attack', target: { type: 'unit', placementId: 77 }, seconds: 2, wait: true } }, { type: 'unit', selector: { scope: 'source' }, command: { kind: 'behavior', behavior: 'random', range: 9, interval: 2, speedPercent: 65 } }, { type: 'unit', selector: { scope: 'source' }, command: { kind: 'altitude', altitude: 99, wait: true } }])
  const move = normalized[0]?.type === 'unit' ? normalized[0] : null
  const replace = normalized[1]?.type === 'unit' ? normalized[1] : null
  const attack = normalized[2]?.type === 'unit' ? normalized[2] : null
  const behavior = normalized[3]?.type === 'unit' ? normalized[3] : null
  const altitude = normalized[4]?.type === 'unit' ? normalized[4] : null
  check('单位指令迁移：非法选择器回落事件来源，坐标与速度钳制到安全范围', move?.selector.scope === 'source' && move.command.kind === 'move' && move.command.x === 0 && move.command.y === 500 && move.command.speed === 20)
  check('单位指令迁移：旧替换 AI 自动迁入三字段协议', replace?.command.kind === 'ai'
    && replace.command.preferredTarget === 'allHostile'
    && replace.command.positioning === 'shortestRange'
    && replace.command.movement === 'closeIn')
  check('单位攻击指令：指定关卡单位目标可归一化保存', attack?.command.kind === 'attack' && attack.command.target !== 'nearestHostile' && attack.command.target.type === 'unit' && attack.command.target.placementId === 77)
  check('单位行为指令：行为及范围、间隔、速度可归一化保存', behavior?.command.kind === 'behavior' && behavior.command.behavior === 'random' && behavior.command.range === 9 && behavior.command.interval === 2 && behavior.command.speedPercent === 65)
  check('飞行高度指令：目标高度归一化到关卡安全范围并保留等待语义', altitude?.command.kind === 'altitude' && altitude.command.altitude === 10 && altitude.command.wait)
  const normalizedFaction = normalizeEventActions([{ type: 'unit', selector: { scope: 'group', group: '  第三组  ' }, command: { kind: 'faction', faction: 'neutralHostile' } }])[0]
  check('切换阵营指令：组别选择器与目标阵营可归一化保存', normalizedFaction?.type === 'unit'
    && normalizedFaction.selector.scope === 'group' && normalizedFaction.selector.group === '第三组'
    && normalizedFaction.command.kind === 'faction' && normalizedFaction.command.faction === 'neutralHostile')

  const altitudeUnitId = 'unit:sim-altitude-command'
  const altitudeUnit = normalizeKamikazeConfig({ ...structuredClone(unitDefById('unit:uav')!), id: altitudeUnitId, name: '高度指令测试机' })
  saveCustomUnitDef(altitudeUnit)
  try {
    let altitudeState = arena()
    altitudeState.spawnQueue = [{ kind: 'walker', delay: 100 }]; altitudeState.spawnTimer = 100
    const flyer = mkEnemy(altitudeState, 'walker', 5, 5, 100)
    flyer.unitDefId = altitudeUnitId
    flyer.aircraft = { heading: 0, vx: 0, vy: 0, altitude: 0.8, targetAltitude: 0.8, verticalSpeed: 0 }
    const rewardBeforeAltitude = altitudeState.gold
    altitudeState.eventQueue.push({ id: altitudeState.nextId++, sourceId: flyer.id, zone: { x: 0, y: 0, w: 1, h: 1 }, actions: [
      { type: 'unit', selector: { scope: 'source' }, command: { kind: 'altitude', altitude: 2.4, wait: true } },
      { type: 'reward', gold: 23 },
    ], index: 0, waitLeft: 0 })
    altitudeState = tick(altitudeState, 0.1)
    check('飞行高度指令：等待升降完成前阻塞后续动作', altitudeState.gold === rewardBeforeAltitude && altitudeState.eventQueue.length === 1)
    altitudeState = run(altitudeState, 2.5, 0.1)
    const landedFlyer = altitudeState.enemies.find(enemy => enemy.id === flyer.id)
    check('飞行高度指令：按模板升降速度抵达目标后继续事件序列', !!landedFlyer
      && Math.abs(currentUnitAltitude(landedFlyer, altitudeUnit) - 2.4) < 1e-4
      && altitudeState.gold === rewardBeforeAltitude + 23 && altitudeState.eventQueue.length === 0)
  } finally {
    deleteCustomUnitDef(altitudeUnitId)
  }

  let scripted = arena()
  scripted.spawnQueue = [{ kind: 'walker', delay: 100 }]; scripted.spawnTimer = 100
  scripted.allies = [{ id: 9501, kind: 'soldier', unitDefId: allyUnitId('soldier'), producerId: 0, x: 2, y: 2, hp: 60, maxHp: 60, cooldown: 0, targetId: null, hitFlash: 0 }]
  const scriptedGold = scripted.gold
  scripted.eventQueue.push({ id: scripted.nextId++, sourceId: 9501, zone: { x: 0, y: 0, w: 1, h: 1 }, actions: [
    { type: 'unit', selector: { scope: 'source' }, command: { kind: 'move', x: 4, y: 2, speed: 2, wait: true } },
    { type: 'reward', gold: 37 },
  ], index: 0, waitLeft: 0 })
  scripted = tick(scripted, 0.1)
  check('单位脚本：等待式移动在抵达前阻塞后续关卡动作', scripted.allies[0]?.x === 2 && scripted.gold === scriptedGold && scripted.eventQueue.length === 1)
  scripted = run(scripted, 1.2, 0.1)
  check('单位脚本：抵达几何中心后自动恢复 AI 并继续动作队列', Math.abs((scripted.allies[0]?.x ?? 0) - 4) < 0.01 && scripted.gold === scriptedGold + 37 && scripted.eventQueue.length === 0)

  scripted.eventQueue.push({ id: scripted.nextId++, sourceId: 9501, zone: { x: 0, y: 0, w: 1, h: 1 }, actions: [
    { type: 'unit', selector: { scope: 'source' }, command: { kind: 'ai', mode: 'pause' } },
    { type: 'wait', seconds: 0.3 },
    { type: 'unit', selector: { scope: 'source' }, command: { kind: 'ai', mode: 'replace', preferredTarget: 'allHostile', positioning: 'optimalRange', movement: 'stop' } },
  ], index: 0, waitLeft: 0 })
  scripted = tick(scripted, 0.1)
  check('单位脚本：可暂停单位原 AI 并让等待动作保持暂停状态', scripted.allies[0]?.scriptPaused === true)
  scripted = run(scripted, 0.4, 0.1)
  check('单位脚本：可恢复运行并替换为新的首选目标、站位和移动组合', scripted.allies[0]?.scriptPaused === false
    && scripted.allies[0]?.aiOverride?.preferredTarget === 'allHostile'
    && scripted.allies[0]?.aiOverride?.positioning === 'optimalRange'
    && scripted.allies[0]?.aiOverride?.movement === 'stop')

  scripted.eventQueue.push({ id: scripted.nextId++, sourceId: 9501, zone: { x: 0, y: 0, w: 1, h: 1 }, actions: [{ type: 'unit', selector: { scope: 'source' }, command: { kind: 'behavior', behavior: 'follow', range: 3, interval: 0, speedPercent: 60 } }], index: 0, waitLeft: 0 })
  scripted = tick(scripted, 0.1)
  check('单位行为指令：运行时覆盖关卡实例移动行为', scripted.allies[0]?.behaviorOverride?.behavior === 'follow' && scripted.allies[0]?.behaviorOverride?.range === 3 && scripted.allies[0]?.behaviorOverride?.speedPercent === 60)
  scripted.eventQueue.push({ id: scripted.nextId++, sourceId: 9501, zone: { x: 0, y: 0, w: 1, h: 1 }, actions: [{ type: 'unit', selector: { scope: 'source' }, command: { kind: 'behavior', behavior: 'restore', range: 0, interval: 0, speedPercent: 100 } }], index: 0, waitLeft: 0 })
  scripted = tick(scripted, 0.1)
  check('单位行为指令：恢复初始行为会清除运行时覆盖', scripted.allies[0]?.behaviorOverride === undefined)

  let factionState = arena()
  factionState.spawnQueue = [{ kind: 'walker', delay: 100 }]; factionState.spawnTimer = 100
  factionState.allies = [
    { id: 9551, kind: 'soldier', unitDefId: allyUnitId('soldier'), placementId: 551, group: '突击组', faction: 'ally', producerId: 0, x: 3, y: 3, hp: 47, maxHp: 60, cooldown: 0, targetId: null, hitFlash: 0 },
    { id: 9552, kind: 'soldier', unitDefId: allyUnitId('soldier'), placementId: 552, group: '突击组', faction: 'ally', producerId: 0, x: 4, y: 3, hp: 60, maxHp: 60, cooldown: 0, targetId: null, hitFlash: 0 },
    { id: 9553, kind: 'soldier', unitDefId: allyUnitId('soldier'), placementId: 553, group: '留守组', faction: 'ally', producerId: 0, x: 5, y: 3, hp: 60, maxHp: 60, cooldown: 0, targetId: null, hitFlash: 0 },
  ]
  const oldEnemy = mkEnemy(factionState, 'walker', 8, 8, 100)
  oldEnemy.targetId = 9551
  oldEnemy.targetKind = 'combatUnit'
  oldEnemy.mode = 'attack'
  oldEnemy.behaviorEngaged = true
  factionState.eventQueue.push({ id: factionState.nextId++, sourceId: 0, zone: { x: 0, y: 0, w: 1, h: 1 }, actions: [{ type: 'unit', selector: { scope: 'group', group: '突击组' }, command: { kind: 'faction', faction: 'enemy' } }], index: 0, waitLeft: 0 })
  factionState = tick(factionState, 0.1)
  check('切换阵营指令：指定组别的全部单位迁移到目标阵营运行池', [9551, 9552].every(id => factionState.enemies.some(enemy => enemy.id === id && enemy.faction === 'enemy'))
    && factionState.allies.some(ally => ally.id === 9553) && !factionState.allies.some(ally => ally.group === '突击组'))
  check('切换阵营指令：迁移保留实例身份、生命和组别，并清理旧阵营索敌', factionState.enemies.some(enemy => enemy.id === 9551 && enemy.placementId === 551 && enemy.hp === 47 && enemy.group === '突击组')
    && factionState.enemies.find(enemy => enemy.id === oldEnemy.id)?.targetId !== 9551)
  factionState.eventQueue.push({ id: factionState.nextId++, sourceId: 0, zone: { x: 0, y: 0, w: 1, h: 1 }, actions: [{ type: 'unit', selector: { scope: 'placement', placementId: 551 }, command: { kind: 'faction', faction: 'neutral' } }], index: 0, waitLeft: 0 })
  factionState = tick(factionState, 0.1)
  check('切换阵营指令：可按指定单位实例跨阵营迁移为中立单位', factionState.allies.some(ally => ally.id === 9551 && ally.faction === 'neutral' && ally.hp === 47)
    && !factionState.enemies.some(enemy => enemy.id === 9551))

  scripted.objects.push({ id: 9601, kind: 'barrel', x: 5, y: 2, w: 1, h: 1, hp: 40, maxHp: 40, blockMove: false, blockProjectile: false, height: 0 })
  if (scripted.allies[0]) scripted.allies[0].cooldown = 0
  scripted.eventQueue.push({ id: scripted.nextId++, sourceId: 9501, zone: { x: 0, y: 0, w: 1, h: 1 }, actions: [{ type: 'unit', selector: { scope: 'source' }, command: { kind: 'attack', target: { type: 'object', objectId: 9601 }, seconds: 2, wait: true } }], index: 0, waitLeft: 0 })
  scripted = run(scripted, 1.5, 0.1)
  check('单位攻击指令：可强制攻击指定物体', (scripted.objects.find(object => object.id === 9601)?.hp ?? 40) < 40,
    `hp=${scripted.objects.find(object => object.id === 9601)?.hp ?? 'removed'} ally=${scripted.allies[0]?.x},${scripted.allies[0]?.y} cooldown=${scripted.allies[0]?.cooldown} script=${scripted.allies[0]?.script?.command.kind}:${scripted.allies[0]?.script?.left}:${scripted.allies[0]?.script?.done}`)

  scripted.eventQueue.push({ id: scripted.nextId++, sourceId: 0, zone: { x: 0, y: 0, w: 1, h: 1 }, actions: [{ type: 'unit', selector: { scope: 'allAllies' }, command: { kind: 'remove' } }], index: 0, waitLeft: 0 })
  scripted = run(scripted, 1, 0.1)
  check('单位脚本：移除指令可按阵营批量清理单位', scripted.allies.length === 0,
    `allies=${scripted.allies.map(ally => `${ally.id}:${ally.hp}:${ally.deathLeft}`).join(',')} queue=${scripted.eventQueue.length}`)

  const bossId = 'unit:sim-stage-boss'
  const bossDef = {
    id: bossId, name: '测试阶段首领', type: 'rotorcraft' as const, faction: 'enemy' as const,
    controller: 'ai' as const, targetClasses: ['fortress' as const], stats: { hp: 100, speed: 0, size: 0.5, air: true },
    visual: { width: 1, height: 1 }, combat: { profile: 'projectile' as const, range: 4, interval: 1, projectileId: 'bullet_std', damage: 1, projectileSpeed: 20, penetration: 1 },
    ai: { preferredTarget: 'playerControlled' as const, positioning: 'longestRange' as const, movement: 'stop' as const, special: { profile: 'none' as const } },
    boss: { enabled: true, displayName: '赤色监察者', hpScale: 3, sizeScale: 1.6, barColor: '#2244AA', phases: [{ hpPercent: 50, actions: [{ type: 'unit' as const, selector: { scope: 'source' as const }, command: { kind: 'ai' as const, mode: 'pause' as const } }] }], defeatActions: [{ type: 'reward' as const, gold: 123 }] },
  }
  try {
    check('Boss 校验：拒绝非法血条颜色和重复生命阶段阈值', (() => { const invalid = structuredClone(bossDef); invalid.boss.barColor = 'blue'; invalid.boss.phases.push({ hpPercent: 50, actions: [] }); const errors = validateUnitDef(invalid); return errors.some(error => error.includes('颜色')) && errors.some(error => error.includes('重复')) })())
    saveCustomUnitDef(bossDef)
    const savedBoss = unitDefById(bossId)!
    check('Boss 单位库：保存阶段、击败动作、血条色并按生命阈值降序标准化', savedBoss.boss?.barColor === '#2244AA' && savedBoss.boss.phases?.[0]?.hpPercent === 50 && savedBoss.boss.defeatActions?.[0]?.type === 'reward')
    let bossState = arena()
    bossState.spawnQueue = [{ kind: 'walker', delay: 100 }]; bossState.spawnTimer = 100
    bossState.eventQueue.push({ id: bossState.nextId++, sourceId: 0, zone: { x: 2, y: 2, w: 1, h: 1 }, actions: [{ type: 'spawn', enemies: { walker: 0, runner: 0, rusher: 0, brute: 0, flyer: 0 }, units: { [bossId]: 1 }, interval: 0 }], index: 0, waitLeft: 0 })
    bossState = run(bossState, 0.4, 0.1)
    const boss = bossState.enemies.find(enemy => enemy.unitDefId === bossId)
    check('Boss 运行时：普通刷怪动作也会自动应用名称、生命倍率、体型与专属血条', boss?.bossName === '赤色监察者' && boss.maxHp === 300 && boss.bossSizeScale === 1.6 && boss.bossBarColor === '#2244AA')
    if (boss) boss.hp = 149
    bossState = run(bossState, 0.8, 0.1)
    check('Boss 阶段：越过生命阈值后以 Boss 自身作为事件来源执行单位指令', bossState.enemies.find(enemy => enemy.id === boss?.id)?.scriptPaused === true)
    const bossGold = bossState.gold
    const liveBoss = bossState.enemies.find(enemy => enemy.id === boss?.id)
    if (liveBoss) liveBoss.hp = 0
    bossState = run(bossState, 2, 0.1)
    check('Boss 击败：死亡后执行统一动作协议中的击败奖励', bossState.gold >= bossGold + 123 && !bossState.enemies.some(enemy => enemy.id === boss?.id),
      `gold=${bossState.gold}/${bossGold} enemy=${bossState.enemies.find(enemy => enemy.id === boss?.id)?.deathLeft ?? 'none'} queue=${bossState.eventQueue.length}`)
  } finally {
    deleteCustomUnitDef(bossId)
  }
}

console.log('== 剧情演出事件动作 ==')
{
  const normalized = normalizeEventActions([
    { type: 'dialogue', speaker: '指挥官', text: '坚守阵地', duration: 2, wait: true },
    { type: 'text', text: '第一幕', duration: 1.5, position: 'top', wait: false },
    { type: 'camera', x: -5, y: 999, duration: 1, hold: 2, wait: true, returnToOrigin: true },
    { type: 'unit', selector: { scope: 'placement', placementId: 77 }, command: { kind: 'move', x: 4, y: 2, speed: 2, wait: true } },
  ])
  const dialogue = normalized[0]?.type === 'dialogue' ? normalized[0] : null
  const text = normalized[1]?.type === 'text' ? normalized[1] : null
  const camera = normalized[2]?.type === 'camera' ? normalized[2] : null
  const unit = normalized[3]?.type === 'unit' ? normalized[3] : null
  check('演出存档：对话、画面文本与镜头转移参数可归一化保存', dialogue?.speaker === '指挥官' && dialogue.wait === true && text?.position === 'top' && text.wait === false && camera?.x === 0 && camera.y === 500 && camera.hold === 2 && camera.returnToOrigin === true)
  check('单位演出：关卡实例选择器按 placementId 保存', unit?.selector.scope === 'placement' && unit.selector.placementId === 77)

  let cinematic = arena()
  cinematic.spawnQueue = [{ kind: 'walker', delay: 100 }]; cinematic.spawnTimer = 100
  cinematic.allies = [{ id: 9601, placementId: 77, kind: 'soldier', unitDefId: allyUnitId('soldier'), producerId: 0, x: 2, y: 2, hp: 60, maxHp: 60, cooldown: 0, targetId: null, hitFlash: 0 }]
  const initialGold = cinematic.gold
  cinematic.eventQueue.push({ id: cinematic.nextId++, sourceId: 0, zone: { x: 0, y: 0, w: 1, h: 1 }, actions: [
    { type: 'dialogue', speaker: '指挥官', text: '开始行动', duration: 0.3, wait: true },
    { type: 'text', text: '目标区域', duration: 0.8, position: 'center', wait: false },
    { type: 'camera', x: 8, y: 8, duration: 0.2, hold: 0.1, wait: true, returnToOrigin: false },
    { type: 'unit', selector: { scope: 'placement', placementId: 77 }, command: { kind: 'move', x: 4, y: 2, speed: 2, wait: true } },
    { type: 'reward', gold: 17 },
  ], index: 0, waitLeft: 0 })
  cinematic = tick(cinematic, 0.1)
  check('对话演出：显示期间阻塞后续动作', cinematic.cinematicDialogue?.speaker === '指挥官' && cinematic.gold === initialGold && cinematic.eventQueue[0]?.index === 0)
  cinematic = run(cinematic, 0.4, 0.1)
  check('文本与镜头演出：非等待文本可与等待镜头同时显示', cinematic.cinematicText?.text === '目标区域' && !!cinematic.cinematicCamera && cinematic.gold === initialGold)
  cinematic = run(cinematic, 1.5, 0.1)
  check('演出顺序：镜头结束后指定实例移动，完成后继续奖励', Math.abs((cinematic.allies[0]?.x ?? 0) - 4) < 0.01 && cinematic.gold === initialGold + 17 && cinematic.eventQueue.length === 0)

  let returningCamera = arena()
  returningCamera.spawnQueue = [{ kind: 'walker', delay: 100 }]; returningCamera.spawnTimer = 100
  const returnGold = returningCamera.gold
  returningCamera.eventQueue.push({ id: returningCamera.nextId++, sourceId: 0, zone: { x: 0, y: 0, w: 1, h: 1 }, actions: [
    { type: 'camera', x: 8, y: 8, duration: 0.2, hold: 0.1, wait: true, returnToOrigin: true },
    { type: 'reward', gold: 9 },
  ], index: 0, waitLeft: 0 })
  returningCamera = run(returningCamera, 0.3, 0.1)
  check('镜头返回：停留结束后仍保留镜头状态并等待回程', !!returningCamera.cinematicCamera && returningCamera.gold === returnGold)
  returningCamera = run(returningCamera, 0.3, 0.1)
  check('镜头返回：回程结束后清除镜头状态并继续后续动作', !returningCamera.cinematicCamera && returningCamera.gold === returnGold + 9 && returningCamera.eventQueue.length === 0)

  const interfaceActions = normalizeEventActions([
    { type: 'choice', prompt: '选择路线', options: [{ text: '左路', actions: [{ type: 'reward', gold: 11 }] }, { text: '右路', actions: [{ type: 'reward', gold: 22 }] }] },
    { type: 'assembly' },
  ])
  check('界面指令存档：选择项的分支动作与装配指令可归一化保存', interfaceActions[0]?.type === 'choice' && interfaceActions[0].options[1]?.actions[0]?.type === 'reward' && interfaceActions[1]?.type === 'assembly')

  let interfaceState = arena()
  interfaceState.spawnQueue = [{ kind: 'walker', delay: 100 }]; interfaceState.spawnTimer = 100
  const interfaceGold = interfaceState.gold
  interfaceState.eventQueue.push({ id: interfaceState.nextId++, sourceId: 0, zone: { x: 0, y: 0, w: 1, h: 1 }, actions: [
    { type: 'choice', prompt: '选择路线', options: [{ text: '左路', actions: [{ type: 'reward', gold: 11 }] }, { text: '右路', actions: [{ type: 'reward', gold: 22 }] }] },
    { type: 'assembly' },
    { type: 'reward', gold: 3 },
  ], index: 0, waitLeft: 0 })
  interfaceState = tick(interfaceState, 0.1)
  check('选择指令：弹出选项并阻塞后续动作', interfaceState.eventChoice?.options.join(',') === '左路,右路' && interfaceState.gold === interfaceGold)
  interfaceState = resolveEventChoice(interfaceState, interfaceState.eventChoice!.id, 1)
  interfaceState = tick(interfaceState, 0.1)
  check('选择指令：只插入所选分支动作，并继续到装配指令', interfaceState.gold === interfaceGold + 22 && !!interfaceState.eventAssembly)
  interfaceState = completeEventAssembly(interfaceState, interfaceState.eventAssembly!.id)
  interfaceState = tick(interfaceState, 0.1)
  check('装配指令：完成装配后继续后续动作', interfaceState.gold === interfaceGold + 25 && interfaceState.eventQueue.length === 0)
}

console.log('== 单位编组共享敌情与统一脱战 ==')
{
  const savedLevel = structuredClone(LEVEL)
  const shooterId = 'unit:sim-group-shooter'
  try {
    const shooterDef = structuredClone(unitDefById('unit:uav')!)
    shooterDef.id = shooterId
    shooterDef.name = '编组远距射手'
    shooterDef.stats.vision = 1
    shooterDef.stats.trackingVision = 1
    shooterDef.stats.speed = 0
    shooterDef.combat = { profile: 'hitscan', range: 10, interval: 0.1, projectileId: 'bullet_std', damage: 11, projectileSpeed: 0, penetration: 0 }
    shooterDef.ai = { preferredTarget: 'allHostile', positioning: 'optimalRange', movement: 'stop', special: { profile: 'none' } }
    check('编组共享敌情夹具：低视野远距射手定义可保存', saveCustomUnitDef(shooterDef))

    LEVEL.initialUnits = [
      { id: 8811, unitDefId: 'unit:uav', faction: 'ally', controller: 'ai', group: 'shared-contact', x: 10, y: 10, behavior: 'static', events: [] },
      { id: 8812, unitDefId: shooterId, faction: 'ally', controller: 'ai', group: 'shared-contact', x: 20, y: 10, behavior: 'static', events: [] },
      { id: 8813, unitDefId: 'unit:uav', faction: 'enemy', controller: 'static', x: 12, y: 10, behavior: 'static', events: [] },
    ]
    configureObjective(LEVEL, { type: 'defend', waves: 99 })
    let groupState = initialState()
    groupState.phase = 'combat'
    groupState.spawnQueue = [{ kind: 'walker', delay: 100 }]
    groupState.spawnTimer = 100
    const scout = groupState.allies.find(unit => unit.placementId === 8811)!
    const target = groupState.enemies.find(unit => unit.placementId === 8813)!
    const targetHp = target.hp
    damageAlly(groupState, scout, 1)
    groupState = tick(groupState, 0.1)
    const scoutAfter = groupState.allies.find(unit => unit.placementId === 8811)
    const shooterAfter = groupState.allies.find(unit => unit.placementId === 8812)
    const targetAfter = groupState.enemies.find(unit => unit.placementId === 8813)
    check('任一组员受击：同组全部进入攻击状态', !!scoutAfter?.behaviorEngaged && !!shooterAfter?.behaviorEngaged)
    check('共享敌情：射手无视自身视野与追踪视野攻击其他组员视野内敌人', shooterAfter?.targetId === targetAfter?.id && (targetAfter?.hp ?? targetHp) < targetHp,
      JSON.stringify({ shooterTarget: shooterAfter?.targetId, targetId: targetAfter?.id, targetHp: targetAfter?.hp }))

    if (targetAfter) { targetAfter.x = 40; targetAfter.y = 40 }
    groupState = run(groupState, 0.4, 0.1)
    const scoutLost = groupState.allies.find(unit => unit.placementId === 8811)
    const shooterLost = groupState.allies.find(unit => unit.placementId === 8812)
    check('整组失去全部敌情：所有成员统一脱战并清除目标', !scoutLost?.behaviorEngaged && !shooterLost?.behaviorEngaged
      && scoutLost?.targetId == null && shooterLost?.targetId == null)
  } finally {
    deleteCustomUnitDef(shooterId)
    for (const key of Object.keys(LEVEL)) delete (LEVEL as unknown as Record<string, unknown>)[key]
    Object.assign(LEVEL, savedLevel)
    invalidateWallInfo()
  }
}

console.log('== 放置单位受击反击记忆 ==')
{
  const savedLevel = structuredClone(LEVEL)
  try {
    LEVEL.initialUnits = [
      { id: 8821, unitDefId: 'unit:uav', faction: 'enemy', controller: 'ai', group: 'retaliation', x: 1.5, y: 1.5, behavior: 'guard', events: [] },
      { id: 8822, unitDefId: 'unit:uav', faction: 'enemy', controller: 'ai', group: 'retaliation', x: 2.5, y: 1.5, behavior: 'guard', events: [] },
    ]
    configureObjective(LEVEL, { type: 'defend', waves: 99 })
    let state = initialState()
    state.phase = 'combat'
    state.spawnQueue = [{ kind: 'walker', delay: 100 }]
    state.spawnTimer = 100
    const struck = state.enemies.find(unit => unit.placementId === 8821)!
    const player = fortressCenter(state)
    const distanceBefore = Math.hypot(struck.x - player.x, struck.y - player.y)
    check('受击反击夹具：玩家位于放置单位正常视野外', distanceBefore > (unitDefById(struck.unitDefId!)?.stats.vision ?? 8), `distance=${distanceBefore.toFixed(2)}`)

    damageEnemy(state, struck, 1, 987654)
    state = tick(state, 0.1)
    const struckAlert = state.enemies.find(unit => unit.placementId === 8821)
    const mateAlert = state.enemies.find(unit => unit.placementId === 8822)
    check('视野外受击：受击者锁定真实攻击者并进入战斗', struckAlert?.behaviorEngaged === true
      && struckAlert.retaliationSide === 'fortress' && struckAlert.targetKind === 'fortress' && struckAlert.targetId === 0)
    check('视野外受击：同组成员共享反击目标与记忆', mateAlert?.behaviorEngaged === true
      && mateAlert.retaliationSide === 'fortress' && mateAlert.targetKind === 'fortress' && mateAlert.targetId === 0)
    check('反击记忆保留统一最短时长', (struckAlert?.retaliationUntil ?? 0) - state.time >= UNIT_RETALIATION_MEMORY_SECONDS - 0.11,
      `until=${struckAlert?.retaliationUntil} time=${state.time}`)

    state = run(state, 0.8, 0.05)
    const struckChasing = state.enemies.find(unit => unit.placementId === 8821)
    const distanceAfter = struckChasing ? Math.hypot(struckChasing.x - player.x, struckChasing.y - player.y) : Infinity
    check('反击记忆期间：放置单位会主动接近视野外攻击者', distanceAfter < distanceBefore - 0.05,
      `before=${distanceBefore.toFixed(2)} after=${distanceAfter.toFixed(2)}`)

    LEVEL.initialUnits = [
      { id: 8831, unitDefId: 'unit:uav', faction: 'ally', controller: 'ai', group: 'ally-retaliation', x: 1.5, y: 1.5, behavior: 'guard', events: [] },
      { id: 8832, unitDefId: 'unit:uav', faction: 'enemy', controller: 'static', x: 16.5, y: 1.5, behavior: 'static', events: [] },
    ]
    let allyState = initialState()
    allyState.phase = 'combat'
    allyState.spawnQueue = [{ kind: 'walker', delay: 100 }]
    allyState.spawnTimer = 100
    const ally = allyState.allies.find(unit => unit.placementId === 8831)!
    const attacker = allyState.enemies.find(unit => unit.placementId === 8832)!
    damageAlly(allyState, ally, 1, { x: ally.x, y: ally.y, attackerSide: 'enemy', attackerId: attacker.id })
    allyState = tick(allyState, 0.1)
    const allyAlert = allyState.allies.find(unit => unit.placementId === 8831)
    check('阵营无关入口：友方放置单位同样反击视野外实际攻击者', allyAlert?.retaliationSide === 'enemy'
      && allyAlert.retaliationId === attacker.id && allyAlert.combatTargetSide === 'enemy' && allyAlert.targetId === attacker.id)
  } finally {
    for (const key of Object.keys(LEVEL)) delete (LEVEL as unknown as Record<string, unknown>)[key]
    Object.assign(LEVEL, savedLevel)
    invalidateWallInfo()
  }
}

console.log('== 全单位战斗 AI 闭环：固定单位、即时命中与近战节奏 ==')
{
  const savedLevel = structuredClone(LEVEL)
  const hitscanId = 'unit:sim-ai-closure-hitscan'
  const escortHitscanId = 'unit:sim-ai-closure-escort-hitscan'
  const meleeId = 'unit:sim-ai-closure-melee'
  const rotorProjectileId = 'unit:sim-ai-closure-rotor'
  const fixedWingProjectileId = 'unit:sim-ai-closure-fixed-wing'
  const hitscanDef = {
    id: hitscanId, name: 'AI 闭环固定射手', type: 'building' as const,
    targetClasses: ['combatUnit' as const], bodyLocked: true,
    stats: { hp: 500, speed: 0, vision: 20, trackingVision: 24, size: 0.2, air: false },
    typeConfig: { kind: 'building' as const, footprintW: 1, footprintH: 1, blocksMovement: false },
    combat: { profile: 'hitscan' as const, range: 8, interval: 0.5, projectileId: 'ray_std', damage: 1, projectileSpeed: 0, penetration: 0 },
    ai: { preferredTarget: 'allHostile' as const, positioning: 'optimalRange' as const, movement: 'stop' as const, special: { profile: 'none' as const } },
  }
  const meleeDef = {
    ...structuredClone(hitscanDef), id: meleeId, name: 'AI 闭环近战单位', bodyLocked: false,
    stats: { ...hitscanDef.stats, speed: 2 },
    combat: { profile: 'melee' as const, range: 1, interval: 0.5, damage: 10, projectileSpeed: 0, penetration: 0 },
  }
  const escortHitscanDef = {
    ...structuredClone(hitscanDef), id: escortHitscanId, name: 'AI 闭环护送射手', bodyLocked: false,
  }
  const rotorProjectileDef = {
    ...structuredClone(unitDefById('unit:uav')!), id: rotorProjectileId, name: 'AI 闭环旋翼射手',
  }
  const fixedWingProjectileDef = {
    ...structuredClone(rotorProjectileDef), id: fixedWingProjectileId, name: 'AI 闭环固定翼射手', type: 'fixedWingAircraft' as const,
    typeConfig: { kind: 'fixedWingAircraft' as const, altitude: 1.2, minAltitude: 0.5, maxAltitude: 4, climbRate: 0.75, accel: 3, turnSpeed: 90, minSpeed: 1, turnRadius: 2.5 },
  }
  const placement = (id: number, unitDefId: string, faction: 'ally' | 'enemy', controller: 'ai' | 'static', x: number, y: number, behavior: 'static' | 'guard' = 'static') => ({
    id, unitDefId, faction, controller, x, y, behavior, behaviorSpeedPercent: 100, events: [],
  })
  const combatState = (sourceFaction: 'ally' | 'enemy', unitDefId: string, distance: number) => {
    LEVEL.initialUnits = sourceFaction === 'enemy'
      ? [placement(8841, unitDefId, 'enemy', 'ai', 4.5, 4.5), placement(8842, unitDefId, 'ally', 'static', 4.5 + distance, 4.5)]
      : [placement(8841, unitDefId, 'ally', 'ai', 4.5, 4.5), placement(8842, unitDefId, 'enemy', 'static', 4.5 + distance, 4.5)]
    configureObjective(LEVEL, { type: 'defend', waves: 99 })
    const state = initialState()
    state.phase = 'combat'
    state.spawnQueue = [{ kind: 'walker', delay: 100 }]
    state.spawnTimer = 100
    return state
  }
  try {
    check('AI 闭环夹具：固定、护送、近战与两类飞行射手定义可保存',
      saveCustomUnitDef(hitscanDef) && saveCustomUnitDef(escortHitscanDef) && saveCustomUnitDef(meleeDef)
      && saveCustomUnitDef(rotorProjectileDef) && saveCustomUnitDef(fixedWingProjectileDef))

    let enemyHitscan = combatState('enemy', hitscanId, 4)
    const enemySource = enemyHitscan.enemies.find(unit => unit.placementId === 8841)!
    const enemyTarget = enemyHitscan.allies.find(unit => unit.placementId === 8842)!
    const enemySourceOrigin = { x: enemySource.x, y: enemySource.y }
    const enemyTargetHp = enemyTarget.hp
    enemyHitscan = run(enemyHitscan, 1.1, 0.05)
    const enemySourceAfter = enemyHitscan.enemies.find(unit => unit.placementId === 8841)!
    const enemyTargetAfter = enemyHitscan.allies.find(unit => unit.placementId === 8842)!
    const enemyLoss = enemyTargetHp - enemyTargetAfter.hp
    check('固定/停留敌方单位：主体不移动但即时命中武器仍按射程开火', enemyLoss > 0
      && Math.hypot(enemySourceAfter.x - enemySourceOrigin.x, enemySourceAfter.y - enemySourceOrigin.y) < 1e-9,
    JSON.stringify({ loss: enemyLoss, source: [enemySourceAfter.x, enemySourceAfter.y], target: enemySourceAfter.targetId }))

    let allyHitscan = combatState('ally', hitscanId, 4)
    const allyTarget = allyHitscan.enemies.find(unit => unit.placementId === 8842)!
    const allyTargetHp = allyTarget.hp
    allyHitscan = run(allyHitscan, 1.1, 0.05)
    const allyLoss = allyTargetHp - (allyHitscan.enemies.find(unit => unit.placementId === 8842)?.hp ?? allyTargetHp)
    check('即时命中节奏统一：敌方与友方在相同装填时间内造成相同伤害', enemyLoss === allyLoss && enemyLoss > 0,
      `enemy=${enemyLoss} ally=${allyLoss}`)

    for (const [label, unitDefId] of [['旋翼飞行器', rotorProjectileId], ['固定翼飞行器', fixedWingProjectileId]] as const) {
      let aircraftCombat = combatState('enemy', unitDefId, 4)
      const aircraftTarget = aircraftCombat.allies.find(unit => unit.placementId === 8842)!
      const aircraftTargetHp = aircraftTarget.hp
      aircraftCombat = run(aircraftCombat, 1.5, 0.05)
      const aircraftSource = aircraftCombat.enemies.find(unit => unit.placementId === 8841)
      const aircraftLoss = aircraftTargetHp - (aircraftCombat.allies.find(unit => unit.placementId === 8842)?.hp ?? aircraftTargetHp)
      check(`单位类型矩阵：${label}在停留行为下仍能索敌并发射统一弹丸`, aircraftLoss > 0 && aircraftSource?.targetId != null,
        `${label} loss=${aircraftLoss} target=${aircraftSource?.targetId}`)
    }

    const retreatingTarget = enemyHitscan.allies.find(unit => unit.placementId === 8842)
    if (retreatingTarget) { retreatingTarget.x = 40; retreatingTarget.y = 40 }
    enemyHitscan = run(enemyHitscan, 0.5, 0.05)
    const fixedAfterLoss = enemyHitscan.enemies.find(unit => unit.placementId === 8841)
    check('锁定主体的放置单位：整组失去敌情后仍会退出接战并清除目标', fixedAfterLoss?.behaviorEngaged === false && fixedAfterLoss.targetId == null,
      JSON.stringify({ engaged: fixedAfterLoss?.behaviorEngaged, target: fixedAfterLoss?.targetId, lost: fixedAfterLoss?.behaviorLostTime }))

    LEVEL.initialUnits = [
      { id: 8841, unitDefId: escortHitscanId, faction: 'ally', controller: 'ai', x: 4.5, y: 4.5, events: [] },
      placement(8842, hitscanId, 'enemy', 'static', 8.5, 4.5),
    ]
    configureObjective(LEVEL, { type: 'escort', unitPlacementId: 8841 })
    let escortHitscan = initialState()
    escortHitscan.phase = 'combat'
    escortHitscan.spawnQueue = [{ kind: 'walker', delay: 100 }]
    escortHitscan.spawnTimer = 100
    const escortTarget = escortHitscan.enemies.find(unit => unit.placementId === 8842)!
    const escortTargetHp = escortTarget.hp
    escortHitscan = run(escortHitscan, 1.1, 0.05)
    const escortLoss = escortTargetHp - (escortHitscan.enemies.find(unit => unit.placementId === 8842)?.hp ?? escortTargetHp)
    check('护送单位攻击口径：即时命中同样按主体外沿射程与装填时间结算', escortLoss === allyLoss && escortLoss > 0,
      `escort=${escortLoss} regular=${allyLoss}`)

    // 单位战斗射程以格为单位；中心距 1 格扣除双方轮廓后已处于 1 格近战范围内。
    let enemyMelee = combatState('enemy', meleeId, 1)
    const enemyMeleeTarget = enemyMelee.allies.find(unit => unit.placementId === 8842)!
    const enemyMeleeHp = enemyMeleeTarget.hp
    enemyMelee = run(enemyMelee, 0.8, 0.05)
    const enemyMeleeLoss = enemyMeleeHp - (enemyMelee.allies.find(unit => unit.placementId === 8842)?.hp ?? enemyMeleeHp)
    let allyMelee = combatState('ally', meleeId, 1)
    const allyMeleeTarget = allyMelee.enemies.find(unit => unit.placementId === 8842)!
    const allyMeleeHp = allyMeleeTarget.hp
    allyMelee = run(allyMelee, 0.8, 0.05)
    const allyMeleeLoss = allyMeleeHp - (allyMelee.enemies.find(unit => unit.placementId === 8842)?.hp ?? allyMeleeHp)
    check('近战节奏统一：敌方与友方都按伤害/间隔换算持续接触伤害', Math.abs(enemyMeleeLoss - allyMeleeLoss) < 1e-6 && enemyMeleeLoss > 0,
      `enemy=${enemyMeleeLoss} ally=${allyMeleeLoss}`)
  } finally {
    deleteCustomUnitDef(hitscanId)
    deleteCustomUnitDef(escortHitscanId)
    deleteCustomUnitDef(meleeId)
    deleteCustomUnitDef(rotorProjectileId)
    deleteCustomUnitDef(fixedWingProjectileId)
    for (const key of Object.keys(LEVEL)) delete (LEVEL as unknown as Record<string, unknown>)[key]
    Object.assign(LEVEL, savedLevel)
    invalidateWallInfo()
  }
}

console.log('== #22：摧毁目标任务 ==')
{
  const normalized = normalizeObjective({ type: 'destroy', unitPlacementIds: [7, 7, -2, 3.6, '9', 'bad'] })
  check('摧毁目标迁移：实例 ID 去重、取整、钳正并过滤非法值', normalized.type === 'destroy'
    && JSON.stringify(normalized.unitPlacementIds) === '[7,1,4,9]', JSON.stringify(normalized))

  const savedLevel = structuredClone(LEVEL)
  try {
    LEVEL.initialUnits = [
      { id: 101, unitDefId: 'unit:uav', faction: 'enemy', controller: 'static', x: 6.5, y: 6.5 },
      { id: 102, unitDefId: 'unit:uav', faction: 'enemy', controller: 'static', x: 9.5, y: 6.5 },
      { id: 103, unitDefId: 'unit:uav', faction: 'enemy', controller: 'static', x: 12.5, y: 6.5 },
    ]
    configureObjective(LEVEL, { type: 'destroy', unitPlacementIds: [101, 102] })
    LEVEL.mode = 'advance'
    let state = initialState()
    state.spawnQueue = [{ kind: 'walker', delay: 100 }]; state.spawnTimer = 100
    const first = state.enemies.find(enemy => enemy.placementId === 101)
    const second = state.enemies.find(enemy => enemy.placementId === 102)
    const other = state.enemies.find(enemy => enemy.placementId === 103)
    check('摧毁目标生成：初始敌方单位保留关卡实例 ID，目标与非目标可稳定区分', !!first && !!second && !!other)
    if (other) other.hp = 0
    state = tick(state, 0.1)
    check('摧毁目标判定：击毁非目标不会完成阶段', state.phase === 'combat' && destroyObjectiveProgress(state).destroyed === 0)
    const liveFirst = state.enemies.find(enemy => enemy.placementId === 101)
    if (liveFirst) liveFirst.hp = 0
    state = tick(state, 0.1)
    const halfway = destroyObjectiveProgress(state)
    check('摧毁目标进度：多目标任务在首个目标击毁后保持交战', state.phase === 'combat'
      && halfway.total === 2 && halfway.destroyed === 1 && halfway.remaining === 1)
    const liveSecond = state.enemies.find(enemy => enemy.placementId === 102)
    if (liveSecond) liveSecond.hp = 0
    state = tick(state, 0.1)
    check('摧毁目标完成：全部指定实例击毁后走阶段成功分支', state.phase === 'won'
      && state.defeatedUnitPlacementIds.includes(101) && state.defeatedUnitPlacementIds.includes(102))

    configureObjective(LEVEL, { type: 'destroy', unitPlacementIds: [] })
    const empty = tick(initialState(), 0.1)
    check('摧毁目标安全门：未配置目标时不会空目标自动获胜', empty.phase === 'combat')

    const migrated = parseLevel(JSON.stringify({ version: 15, initialUnits: LEVEL.initialUnits, objective: { type: 'destroy', unitPlacementIds: [102, 101, 102] }, stages: [{ id: 'stage-1', name: '歼灭', objective: { type: 'destroy', unitPlacementIds: [102, 101, 102] }, waves: [], success: { type: 'win' }, failure: { type: 'lose' } }], startStageId: 'stage-1' }))
    check('摧毁目标存档：v15 关卡迁移至 v18 并保留去重后的目标实例引用', migrated.version === 18
      && migrated.objective.type === 'destroy' && JSON.stringify(migrated.objective.unitPlacementIds) === '[102,101]')
  } finally {
    for (const key of Object.keys(LEVEL)) delete (LEVEL as unknown as Record<string, unknown>)[key]
    Object.assign(LEVEL, savedLevel)
    invalidateWallInfo()
  }
}

console.log('== v2.89：地形/物体类型库 ==')
{
  check('统一阵营关系：玩家与友方同盟，中立不敌对，中立敌对与其他阵营均敌对',
    !factionsHostile('player', 'ally')
      && !factionsHostile('neutral', 'enemy')
      && factionsHostile('neutralHostile', 'player')
      && factionsHostile('neutralHostile', 'ally')
      && factionsHostile('neutralHostile', 'enemy')
      && !factionsHostile('neutralHostile', 'neutralHostile'))
  check('素材库：内置 BGM 与按钮 SE 使用独立分类', ASSET_CATEGORY_NAME.bgm === 'BGM' && ASSET_CATEGORY_NAME.se === 'SE'
    && filterAssets('bgm').some(asset => asset.id === 'builtin:bgm/briefing_eve' && asset.name === '备战前夕' && asset.src === '/res/audio/briefing_eve_loop.wav')
    && filterAssets('se').some(asset => asset.id === 'builtin:se/ui_button_click' && asset.name === 'switch_button' && asset.src === '/res/audio/switch_button.wav')
    && !filterAssets('se').some(asset => asset.id === 'builtin:se/tracked_move_loop' || asset.name === '履带持续行驶'))
  check('素材库：UI 图片使用独立正式分类并可参与分类筛选', ASSET_CATEGORY_NAME.ui === 'UI'
    && filterAssets('ui').every(asset => asset.category === 'ui'))
  const turretIcon = addAsset('炮塔图标测试', 'data:image/png;base64,AA==', 'icon')
  const turretWithIcon = { ...TURRET_DEFS[0], iconAsset: turretIcon.id } as TurretDef
  const turretIconRoundTrip = parseTurretDefs(serializeTurretDefs([turretWithIcon]))?.[0]
  check('素材库与炮塔：图标使用独立分类，炮塔图标引用可持久化往返', ASSET_CATEGORY_NAME.icon === '图标'
    && filterAssets('icon').some(asset => asset.id === turretIcon.id)
    && turretIconRoundTrip?.iconAsset === turretIcon.id)
  removeAsset(turretIcon.id)
  check('音频默认：按钮音效预设接入全局 UI 点击槽', resolveCue(undefined, 'uiClick') === UI_BUTTON_CLICK_PRESET_ID
    && audioProjectConfig().presets.some(preset => preset.id === UI_BUTTON_CLICK_PRESET_ID && preset.assets[0]?.assetId === 'builtin:se/ui_button_click' && preset.channel === 'ui'))
  check('全局通用音效：载具怠速与各底盘移动音效槽已删除，移动音效改由单位单独配置',
    !Object.values(GLOBAL_CUE_LABELS).some(label => ['载具怠速', '履带移动', '轮式移动', '飞行器移动'].includes(label))
      && !audioProjectConfig().presets.some(preset => preset.id === 'builtin:movement/tracked'))
  check('全局通用音效：已移除对象专属和武器/弹丸通用回退槽', !Object.values(GLOBAL_CUE_LABELS).some(label => ['装甲穿透', '物体摧毁', '武器充能', '通用武器开火', '武器装填', '武器过热', '通用弹丸飞行', '通用弹丸命中', '通用爆炸'].includes(label))
    && resolveCue(undefined) === undefined)
  const uploadedSound = addAsset('后台预设模拟音效', 'data:audio/wav;base64,AA==', 'se')
  const weaponSound = autoSoundPreset(uploadedSound.id, { channel: 'weapon' })
  const unitLoopSound = autoSoundPreset(uploadedSound.id, { channel: 'unit', loop: true })
  check('音效选择：只用单个 SE 素材并按使用位置自动生成通道参数', weaponSound?.assets.length === 1
    && weaponSound.assets[0]?.assetId === uploadedSound.id && weaponSound.channel === 'weapon' && weaponSound.maxDistance === 36
    && unitLoopSound?.assets.length === 1 && unitLoopSound.channel === 'unit' && unitLoopSound.loop && unitLoopSound.cooldown === 0
    && autoSoundPreset('builtin:se/ui_button_click', { channel: 'ui' })?.channel === 'ui')
  removeAsset(uploadedSound.id)
  const displayLimits = normalizeDisplayConfig({ defaultZoom: 3, minZoom: 1.25, maxZoom: 2 })
  const raisedMinimum = normalizeDisplayConfig({ defaultZoom: 1, minZoom: 3, maxZoom: 2 }, 'minZoom')
  check('游戏参数：默认缩放受最小/最大缩放约束且交叉边界自动联动', displayLimits.defaultZoom === 2
    && displayLimits.minZoom === 1.25 && displayLimits.maxZoom === 2
    && raisedMinimum.minZoom === 3 && raisedMinimum.maxZoom === 3 && raisedMinimum.defaultZoom === 3)
  const legacyDisplay = normalizeDisplayConfig({ version: 1 } as never)
  const fixedDisplay = normalizeDisplayConfig({ resolutionMode: 'fixed', referenceResolution: '1920x1080' })
  const invalidDisplay = normalizeDisplayConfig({ resolutionMode: 'fixed', referenceResolution: 'invalid' as never })
  const adaptiveViewport = resolveDisplayViewport(legacyDisplay, 1000.9, 800.9)
  const fixedViewport = resolveDisplayViewport(fixedDisplay, 1000, 800)
  const editorViewport = resolveDisplayViewport(fixedDisplay, 1000, 800, true)
  check('游戏参数：旧显示配置迁移为自适应，固定模式保留合法预设并修复非法预设',
    legacyDisplay.version === 2 && legacyDisplay.resolutionMode === 'adaptive' && legacyDisplay.referenceResolution === '1920x1080'
    && fixedDisplay.resolutionMode === 'fixed' && fixedDisplay.referenceResolution === '1920x1080'
    && invalidDisplay.referenceResolution === '1920x1080')
  check('游戏参数：常用参考分辨率包含 PC、平板和手机横屏预设且 ID 唯一',
    DISPLAY_RESOLUTION_PRESETS.length === 8
    && new Set(DISPLAY_RESOLUTION_PRESETS.map(preset => preset.id)).size === DISPLAY_RESOLUTION_PRESETS.length
    && DISPLAY_RESOLUTION_PRESETS.some(preset => preset.id === '2560x1440')
    && DISPLAY_RESOLUTION_PRESETS.some(preset => preset.id === '1920x1200')
    && DISPLAY_RESOLUTION_PRESETS.some(preset => preset.id === '2400x1080'))
  check('游戏参数：自适应填满容器；固定分辨率完整等比显示；关卡编辑器强制自适应',
    adaptiveViewport.logicalWidth === 1000 && adaptiveViewport.logicalHeight === 800 && adaptiveViewport.scale === 1
    && fixedViewport.logicalWidth === 1920 && fixedViewport.logicalHeight === 1080
    && Math.abs(fixedViewport.scale - 1000 / 1920) < 1e-9
    && Math.abs(fixedViewport.displayWidth - 1000) < 1e-9 && Math.abs(fixedViewport.displayHeight - 562.5) < 1e-9
    && editorViewport.logicalWidth === 1000 && editorViewport.logicalHeight === 800 && editorViewport.scale === 1)
  const originalNaturalCooling = gameParameters().naturalHeatDissipation
  setNaturalHeatDissipation(37)
  const coolingState = initialState()
  const moduleCooling = moduleBonuses(coolingState).coolingPool
  check('游戏参数：自然散热值直接作为玩家战车基础散热并与模块叠加',
    gameParameters().naturalHeatDissipation === 37 && fortressCooling(coolingState) === 37 + moduleCooling)
  setNaturalHeatDissipation(1200)
  check('游戏参数：自然散热值限制在 0~1000 点/s', gameParameters().naturalHeatDissipation === 1000)
  setNaturalHeatDissipation(originalNaturalCooling)
  setHitFxVisibility('showPenetrationFx', false)
  setHitFxVisibility('showRicochetFx', false)
  setHitFxVisibility('showRammingFx', false)
  check('调试设置：穿甲、跳弹与冲撞显示可独立关闭且默认结算配置不受影响',
    !gameParameters().showPenetrationFx && !gameParameters().showRicochetFx && !gameParameters().showRammingFx)
  setHitFxVisibility('showPenetrationFx', true)
  setHitFxVisibility('showRicochetFx', true)
  setHitFxVisibility('showRammingFx', true)
  check('类型库：内置水坑、油桶、废墟和岩石定义齐全', terrainTypeById('terrain:puddle')?.moveModifier === 0.5
    && objectTypeById('object:barrel')?.name === '油桶' && objectTypeById('object:barrel')?.hp === 30
    && objectTypeById('object:ruins')?.blockProjectile === true && objectTypeById('object:rock')?.hp === 0)
  check('素材库：旧地形贴图分类已移除，地形统一使用图块且保留物体贴图分类', !Object.values(ASSET_CATEGORY_NAME).includes('地形贴图') && ASSET_CATEGORY_NAME.tile === '图块' && ASSET_CATEGORY_NAME.worldObject === '物体贴图')
  const terrain = { ...newTerrainType(), name: '模拟泥地', asset: 'upload-terrain-test', defaultW: 3, defaultH: 2, effect: 'moveModifier' as const, moveModifier: 0.35 }
  const object = { ...newObjectType(), name: '模拟路障', asset: 'upload-object-test', defaultW: 2, defaultH: 1, hp: 280, blockProjectile: true, states: ['default', 'open', 'locked'],
    events: [
      { id: 1, name: '检查物体', trigger: 'interact' as const, activationLimit: 1, cooldown: 0, actions: [{ type: 'reward' as const, gold: 11 }] },
      { id: 2, name: '碰到物体', trigger: 'contact' as const, activationLimit: 1, cooldown: 0, actions: [{ type: 'reward' as const, gold: 13 }] },
      { id: 3, name: '摧毁物体', trigger: 'destroyed' as const, activationLimit: 1, cooldown: 0, actions: [{ type: 'message' as const, text: '已摧毁', duration: 1 }] },
    ] }
  const autotileAsset = addAsset('模拟物体 Autotile', 'data:image/png;base64,AA==', 'worldObject', { kind: 'autotileStatic', width: 96, height: 128, frames: 1 })
  const autotileObject = { ...newObjectType(), name: '模拟连续物体', asset: autotileAsset.id, defaultW: 4, defaultH: 3 }
  try {
    saveTerrainType(terrain)
    saveObjectType(object)
    check('自定义类型：地形贴图按单格保存、无贴图回退白色且移动倍率效果可解析', terrainTypeById(terrain.id)?.asset === terrain.asset
      && terrainTypeById(terrain.id)?.defaultW === 1
      && terrainTypeById(terrain.id)?.defaultH === 1
      && terrainTypeById(terrain.id)?.color === '#FFFFFF'
      && terrainTypeById(terrain.id)?.effect === 'moveModifier'
      && terrainTypeById(terrain.id)?.moveModifier === 0.35)
    check('自定义类型：物体耐久、碰撞与贴图可保存并解析', objectTypeById(object.id)?.asset === object.asset && objectTypeById(object.id)?.hp === 280 && objectTypeById(object.id)?.blockProjectile === true)
    check('物体状态：类型定义保存可供条件与动作共用的去重状态列表', objectTypeById(object.id)?.states.join(',') === 'default,open,locked')
    const worldTypeSnapshot = snapshotWorldTypeLibrary()
    saveObjectType({ ...object, name: '撤销测试改名' })
    restoreWorldTypeLibrary(worldTypeSnapshot)
    check('全编辑器历史：地形/物体类型库快照可完整恢复', objectTypeById(object.id)?.name === object.name)
    check('物体事件：气泡、接触与摧毁三种触发方式可保存并解析', objectTypeById(object.id)?.events.map(event => event.trigger).join(',') === 'interact,contact,destroyed')
    const eventState = initialState()
    const eventObject = { id: 9901, kind: 'rock' as const, defId: object.id, x: eventState.fortress.x, y: eventState.fortress.y, w: 2, h: 1, hp: 280, maxHp: 280, blockMove: false, blockProjectile: false, height: 0 }
    eventState.objects = [eventObject]
    const beforeObjectGold = eventState.gold
    const playerRect = fortressRect(eventState)
    eventObject.x = playerRect.x + playerRect.w + 3.01
    check('物体气泡：目标外轮廓超过3格时不显示且点击无效', interactionBubbles(eventState).length === 0 && !interactWithObjectAt(eventState, eventObject.x, eventObject.y))
    eventObject.x = playerRect.x + playerRect.w + 2.99
    check('物体气泡：目标进入3格时显示并允许点击', interactionBubbles(eventState).some(bubble => bubble.kind === 'object' && bubble.id === eventObject.id) && interactWithObjectAt(eventState, eventObject.x, eventObject.y))
    eventState.eventQueue = []
    eventState.unifiedEventStates = eventState.unifiedEventStates.filter(runtime => runtime.id >= 0)
    eventObject.x = eventState.fortress.x
    check('物体事件：点击实例执行气泡按钮动作且次数限制独立生效', interactWithObjectAt(eventState, eventObject.x, eventObject.y) && !interactWithObjectAt(eventState, eventObject.x, eventObject.y))
    let contactedState = tick(eventState, 0.1)
    contactedState = tick(contactedState, 0.1)
    check('物体事件：与阻挡物体接触时只在接触沿触发一次', contactedState.gold === beforeObjectGold + 24, `gold=${contactedState.gold}`)
    saveObjectType(autotileObject)
    check('物体 Autotile：由物体贴图尺寸协议识别并强制锁定 1×1 占格', isAutotileAsset(autotileAsset.id) && objectTypeById(autotileObject.id)?.defaultW === 1 && objectTypeById(autotileObject.id)?.defaultH === 1)
    const freshObject = newObjectType()
    check('新建物体默认：蓝色回退、不可破坏、无碰撞且高度为0', freshObject.color === '#5387C8' && freshObject.hp === 0 && !freshObject.blockMove && !freshObject.blockProjectile && freshObject.height === 0)
    const parsed = parseLevel(JSON.stringify({ ...defaultLevel(), terrain: [{ kind: 'puddle', defId: terrain.id, x: 1, y: 3, w: 3, h: 2, moveModifier: 0.35 }], objects: [{ kind: 'ruins', defId: object.id, x: 5, y: 6, w: 2, h: 1, hp: 280, blockMove: true, blockProjectile: true, height: 1 }] }))
    check('关卡实例：可复用定义 ID 随关卡存档往返保留', parsed.terrain[0]?.defId === terrain.id && parsed.objects[0]?.defId === object.id)
  } finally {
    deleteTerrainType(terrain.id)
    deleteObjectType(object.id)
    deleteObjectType(autotileObject.id)
    removeAsset(autotileAsset.id)
  }
  check('类型删除：自定义定义可移除且内置定义保持可用', !terrainTypeLibrary().some(def => def.id === terrain.id) && !objectTypeLibrary().some(def => def.id === object.id) && !!terrainTypeById('terrain:puddle'))
}

// 初始单位实例与物体共用同一套3格气泡交互口径。
{
  const savedInitialUnits = structuredClone(LEVEL.initialUnits)
  try {
    LEVEL.initialUnits = [{
      id: 9911, unitDefId: 'unit:uav', faction: 'enemy', controller: 'static', x: 1, y: 1,
      events: [{ id: 1, name: '询问士兵', trigger: 'interact', activationLimit: 1, cooldown: 0, actions: [{ type: 'reward', gold: 7 }] }],
    }]
    const state = initialState()
    const placedEnemy = state.enemies.find(enemy => enemy.placementId === 9911)
    const playerRect = fortressRect(state)
    if (placedEnemy) {
      placedEnemy.x = playerRect.x + playerRect.w + 10
      placedEnemy.y = playerRect.y + playerRect.h / 2
      check('单位气泡：单位超过3格时不显示且点击无效', !interactionBubbles(state).some(bubble => bubble.kind === 'unit' && bubble.id === 9911)
        && !interactWithUnitAt(state, placedEnemy.x, placedEnemy.y))
      placedEnemy.x = playerRect.x + playerRect.w + 1
      check('单位气泡：单位进入3格时显示并允许点击', interactionBubbles(state).some(bubble => bubble.kind === 'unit' && bubble.id === 9911)
        && interactWithUnitAt(state, placedEnemy.x, placedEnemy.y))
    } else check('单位气泡：初始单位测试实例成功生成', false)
  } finally {
    LEVEL.initialUnits = savedInitialUnits
  }
}

// #19：移动堡垒碾压单位（实际位移、重量档位、接触冷却、地空过滤与大型单位击退衰减）
{
  const inferredLight: FortressDef = { ...structuredClone(DEFAULT_FORTRESS), id: 'ram-light', w: 2, h: 2, shape: undefined, ramWeight: undefined }
  const inferredMedium: FortressDef = { ...structuredClone(DEFAULT_FORTRESS), id: 'ram-medium', w: 4, h: 4, shape: undefined, ramWeight: undefined }
  const explicitHeavy: FortressDef = { ...inferredLight, id: 'ram-heavy', ramWeight: 'heavy' }
  check('碾压重量：旧载具按真实占格自动推导，显式档位优先', fortressRamWeight(inferredLight) === 'light' && fortressRamWeight(inferredMedium) === 'medium' && fortressRamWeight(explicitHeavy) === 'heavy' && fortressRamWeightFactor(explicitHeavy) === 1.3)

  const s = arena()
  s.enemies = []
  const rect = fortressRect(s)
  const e = mkEnemy(s, 'walker', rect.x + rect.w / 2, rect.y + 0.15, 1000)
  const hp0 = e.hp
  const hits = applyFortressRamming(s, 0, -3)
  check('旧椭圆碾压不会误处理已统一为旋转矩形的载具单位', hits === 0 && e.hp === hp0)

  const air = mkEnemy(s, 'flyer', rect.x + rect.w / 2, rect.y + 0.2, 500)
  const airHp = air.hp
  const slow = mkEnemy(s, 'walker', rect.x + rect.w / 2, rect.y + 0.25, 500)
  const slowHp = slow.hp
  applyFortressRamming(s, RAM_MIN_SPEED - 0.01, 0)
  check('碾压过滤：飞行单位免疫，低于最低速度不触发', air.hp === airHp && slow.hp === slowHp)

  const blocked = arena()
  blocked.enemies = []
  blocked.fortress.x = 0
  blocked.fortress.vx = -3
  blocked.moveDir = { x: -1, y: 0 }
  const blockedRect = fortressRect(blocked)
  const pinned = mkEnemy(blocked, 'walker', blockedRect.x + 0.2, blockedRect.y + blockedRect.h / 2, 500)
  const pinnedHp = pinned.hp
  const afterBlocked = tick(blocked, 0.05)
  check('碾压实际位移：撞边界空转不造成伤害', afterBlocked.enemies.find(x => x.id === pinned.id)?.hp === pinnedHp)
}

// #19：敌方载具运行时与堡垒对堡垒冲撞
{
  const savedInitialUnits = structuredClone(LEVEL.initialUnits)
  const wheeledUnitId = 'unit:sim-enemy-wheeled'
  const wheeledFortressId = 'sim-enemy-wheeled-fortress'
  try {
    const wheeledUnit = structuredClone(unitDefById(fortressUnitId(DEFAULT_FORTRESS.id))!)
    wheeledUnit.id = wheeledUnitId
    wheeledUnit.name = '敌方轮式运动测试载具'
    const wheeledConfig = unitTypeConfig(wheeledUnit)!
    const wheeledFortress = structuredClone(DEFAULT_FORTRESS)
    wheeledFortress.id = wheeledFortressId
    wheeledFortress.unitId = wheeledUnitId
    wheeledFortress.name = wheeledUnit.name
    wheeledFortress.unitTargetClasses = structuredClone(wheeledUnit.targetClasses)
    wheeledFortress.unitCombat = wheeledUnit.combat ? structuredClone(wheeledUnit.combat) : undefined
    wheeledFortress.unitAI = wheeledUnit.ai ? structuredClone(wheeledUnit.ai) : undefined
    wheeledFortress.unitBoss = wheeledUnit.boss ? structuredClone(wheeledUnit.boss) : undefined
    if (wheeledConfig.kind === 'vehicle') {
      wheeledConfig.chassis = 'wheeled'
      wheeledConfig.accel = 2.5
      wheeledConfig.turnSpeed = 45
      wheeledConfig.wheelbase = 2.2
      wheeledConfig.steerMax = 35
      wheeledConfig.steerRate = 90
      wheeledFortress.chassis = wheeledConfig.chassis
      wheeledFortress.accel = wheeledConfig.accel
      wheeledFortress.turnSpeed = wheeledConfig.turnSpeed
      wheeledFortress.wheelbase = wheeledConfig.wheelbase
      wheeledFortress.steerMax = wheeledConfig.steerMax
      wheeledFortress.steerRate = wheeledConfig.steerRate
    }
    saveCustomFortress(wheeledFortress)
    LEVEL.initialUnits = [{
      id: 'sim-enemy-fortress', unitDefId: fortressUnitId(DEFAULT_FORTRESS.id),
      faction: 'enemy', controller: 'ai', x: LEVEL.cols / 2, y: LEVEL.rows / 2,
    }, {
      id: 'sim-enemy-wheeled', unitDefId: wheeledUnitId,
      faction: 'enemy', controller: 'ai', x: LEVEL.cols / 2 + 8, y: LEVEL.rows / 2,
    }]
    const s = initialState()
    s.phase = 'combat'
    s.spawnQueue = []
    const enemy = s.enemies[0]
    check('敌方载具生成：关卡中的堡垒单位建立朝向、速度与独立四向装甲', !!enemy?.vehicle && enemy.unitDefId === fortressUnitId(DEFAULT_FORTRESS.id) && enemy.vehicle.armor.front === (DEFAULT_FORTRESS.armor?.front ?? 0))
    const movementState = initialState()
    movementState.phase = 'combat'
    movementState.spawnQueue = []
    const movingVehicle = movementState.enemies[0]
    if (movingVehicle) {
      movingVehicle.x = 2
      movingVehicle.y = 2
      movingVehicle.placementId = undefined // 隔离视野门控，只验证组合式 AI 的无武器移动分支
      movingVehicle.aiOverride = {
        targeting: { profile: 'fortress' }, movement: { profile: 'direct' }, attack: { profile: 'none' }, special: { profile: 'none' },
      }
      const target = fortressRect(movementState)
      const before = Math.hypot(movingVehicle.x - (target.x + target.w / 2), movingVehicle.y - (target.y + target.h / 2))
      const movedState = run(movementState, 2, 0.05)
      const movedVehicle = movedState.enemies.find(item => item.id === movingVehicle.id)
      const after = movedVehicle ? Math.hypot(movedVehicle.x - (target.x + target.w / 2), movedVehicle.y - (target.y + target.h / 2)) : Infinity
      check('敌方无武器载具：攻击为无时仍执行移动堡垒＋直冲 AI', after < before && movedVehicle?.vehicle !== undefined,
        JSON.stringify({ before, after, pos: movedVehicle && { x: movedVehicle.x, y: movedVehicle.y }, heading: movedVehicle?.vehicle?.heading }))
    }
    const curveState = initialState()
    // 该用例只验证底盘运动学；清空场景阻挡，避免连续碰撞系统把出生于障碍内的载具先行截停。
    curveState.objects = []
    curveState.walls = []
    curveState.buildings = []
    curveState.core = null
    const trackedVehicle = curveState.enemies[0]
    const wheeledVehicle = curveState.enemies[1]
    if (trackedVehicle?.vehicle && wheeledVehicle?.vehicle) {
      trackedVehicle.x = 8; trackedVehicle.y = 12
      trackedVehicle.vehicle.heading = 0; trackedVehicle.vehicle.vx = 0; trackedVehicle.vehicle.vy = 0
      const trackedStart = { x: trackedVehicle.x, y: trackedVehicle.y }
      moveEnemyVehicleToward(curveState, trackedVehicle, 16, 4, 0.1)
      const trackedFirstSpeed = Math.hypot(trackedVehicle.vehicle.vx, trackedVehicle.vehicle.vy)
      for (let index = 0; index < 39; index++) moveEnemyVehicleToward(curveState, trackedVehicle, 16, 4, 0.1)
      check('敌方履带载具：按加速度起步并以连续朝向形成曲线轨迹', trackedFirstSpeed > 0 && trackedFirstSpeed <= DEFAULT_FORTRESS.accel * 0.1 + 1e-6
        && Math.abs(trackedVehicle.x - trackedStart.x) > 0.05 && Math.abs(trackedVehicle.y - trackedStart.y) > 0.05
        && Math.abs(trackedVehicle.vehicle.heading) > 0.01 && Math.abs(trackedVehicle.vehicle.heading) < Math.PI / 2,
        JSON.stringify({ start: trackedStart, end: { x: trackedVehicle.x, y: trackedVehicle.y }, firstSpeed: trackedFirstSpeed, heading: trackedVehicle.vehicle.heading }))

      wheeledVehicle.x = 24; wheeledVehicle.y = 12
      wheeledVehicle.vehicle.heading = 0; wheeledVehicle.vehicle.vx = 0; wheeledVehicle.vehicle.vy = 0; wheeledVehicle.vehicle.steerAngle = 0
      const wheeledStart = { x: wheeledVehicle.x, y: wheeledVehicle.y }
      for (let index = 0; index < 40; index++) moveEnemyVehicleToward(curveState, wheeledVehicle, 32, 5, 0.1)
      check('敌方轮式载具：按方向盘速率、最大转角和轴距转弯，不横移或原地旋转', Math.abs(wheeledVehicle.vehicle.steerAngle) > 0.01
        && Math.abs(wheeledVehicle.vehicle.heading) > 0.01
        && Math.abs(wheeledVehicle.x - wheeledStart.x) > 0.05 && Math.abs(wheeledVehicle.y - wheeledStart.y) > 0.05)
    }
    const armedTemplate = unitDefById(fortressUnitId(DEFAULT_FORTRESS.id))!
    const armedVehicleDef = armedTemplate.legacy?.registry === 'fortress' ? armedTemplate.legacy.def : DEFAULT_FORTRESS
    const armedHp = armedVehicleDef.hardpoints.find(item => !item.types && item.fixed === undefined && item.arc === undefined) ?? armedVehicleDef.hardpoints[0]
    const savedBuiltIn = armedHp.builtIn
    const savedArmedSize = armedHp.size
    const savedArmedPosition = { x: armedHp.x, y: armedHp.y }
    try {
      for (const [weaponId, expected] of [['mg', 'bullet'], ['lob', 'shell'], ['hunter', 'missile'], ['beam', 'beam'], ['spray', 'spray']] as const) {
        const weapon = TURRET_DEFS.find(item => item.id === weaponId)!
        const savedMinRange = weapon.rangeMin, savedMaxRange = weapon.rangeMax
        weapon.rangeMin = 0; weapon.rangeMax = Math.max(legacyMeters(400), weapon.rangeMax)
        armedHp.builtIn = weaponId
        armedHp.size = weapon.mount
        let armedState = initialState()
        armedState.phase = 'combat'
        armedState.spawnQueue = []
        const armedEnemy = armedState.enemies[0]
        const player = fortressRect(armedState)
        let attackGroupmateId: number | null = null
        if (armedEnemy?.vehicle) {
          armedEnemy.damageMultiplier = 1.5
          armedEnemy.x = player.x + player.w / 2
          armedEnemy.y = player.y + player.h / 2 - 10
          armedEnemy.vehicle.heading = Math.PI
          armedEnemy.group = 'attack-sync'
          armedEnemy.aiOverride = {
            targeting: { profile: 'closestHostile' }, movement: { profile: 'stationary' }, attack: { profile: 'none' }, special: { profile: 'none' },
          }
          const groupmate = structuredClone(armedEnemy)
          groupmate.id = armedState.nextId++
          groupmate.placementId = 900000 + groupmate.id
          groupmate.controller = 'static'
          groupmate.x = 2; groupmate.y = 2
          groupmate.behaviorEngaged = false
          if (groupmate.vehicle) groupmate.vehicle.turrets = []
          armedState.enemies.push(groupmate)
          attackGroupmateId = groupmate.id
        }
        const mountedId = armedEnemy?.vehicle?.turrets?.[0]?.id
        let fired = false, firingSeen = false, projectileKindSeen = false, sharedProjectileArtSeen = false, groupEngagedSeen = false, scaledProjectileDamageSeen = false, scaledBlastEffectSeen = false
        for (let index = 0; index < 45; index++) {
          armedState = tick(armedState, 0.1)
          fired ||= !!mountedId && armedState.muzzles.some(item => item.turretId === mountedId)
          const mounted = armedState.enemies.find(item => item.id === armedEnemy?.id)?.vehicle?.turrets?.find(item => item.id === mountedId)
          firingSeen ||= mounted?.firing ?? false
          projectileKindSeen ||= armedState.enemyProjectiles.some(item => item.kind === expected)
          const ammo = weapon.art?.projectile ? PROJECTILE_ARTS.find(item => item.id === weapon.art?.projectile) : undefined
          sharedProjectileArtSeen ||= armedState.enemyProjectiles.some(item => item.defId === weaponId
            && item.ammoId === weapon.art?.projectile && item.assetRef === ammo?.projectileAsset)
          scaledProjectileDamageSeen ||= (expected === 'bullet' || expected === 'shell' || expected === 'missile') && armedState.enemyProjectiles.some(item => item.defId === weaponId
            && Math.abs(item.damage - weapon.damage * 1.5) < 1e-9)
          scaledBlastEffectSeen ||= !!weapon.blastEffect && armedState.enemyProjectiles.some(item => item.defId === weaponId
            && Math.abs((item.blastEffect?.damage ?? 0) - weapon.blastEffect!.damage * 1.5) < 1e-9
            && (!weapon.blastEffect!.burn || Math.abs((item.blastEffect?.burn?.damage ?? 0) - weapon.blastEffect!.burn!.damage * 1.5) < 1e-9))
          groupEngagedSeen ||= attackGroupmateId !== null
            && !!armedState.enemies.find(item => item.id === attackGroupmateId)?.behaviorEngaged
        }
        const armedAfter = armedState.enemies.find(item => item.id === armedEnemy?.id)
        const behaviorSeen = expected === 'beam' || expected === 'spray' ? firingSeen : expected === 'bullet' ? fired : projectileKindSeen
        check(`敌方载具五类炮塔：${weapon.name} 复用共用状态机并执行${expected}行为`,
          !!mountedId && !!armedAfter?.vehicle?.turrets?.some(item => item.id === mountedId) && behaviorSeen,
          JSON.stringify({ mountedId, turrets: armedAfter?.vehicle?.turrets?.length, fired, firingSeen, projectileKindSeen }))
        check(`单位编组主动攻击：${weapon.name} 起射后同组成员共同进入攻击状态`, groupEngagedSeen)
        if (expected === 'bullet') check('敌我哨戒机枪：敌方弹丸携带与我方相同的弹丸库及贴图引用', sharedProjectileArtSeen,
          JSON.stringify({ ammoId: weapon.art?.projectile, asset: PROJECTILE_ARTS.find(item => item.id === weapon.art?.projectile)?.projectileAsset }))
        if (expected === 'bullet' || expected === 'shell' || expected === 'missile') check(`波次敌人强度：1.5 系数把${weapon.name}弹丸威力提升为 150%`, scaledProjectileDamageSeen)
        if (weapon.blastEffect) check(`波次敌人强度：${weapon.name}爆炸及燃烧附加伤害同步提升为 150%`, scaledBlastEffectSeen)
        weapon.rangeMin = savedMinRange; weapon.rangeMax = savedMaxRange
      }

      // 车体中心刚好进入旧 16 格射程时，后置 0.5 格的炮塔仍有 16.5 格；敌友双方都必须继续靠近，
      // 不能因为车体中心已进射程而停在炮塔实际射程之外。
      const sharedRangeWeapon = TURRET_DEFS.find(item => item.id === 'mg')!
      const savedSharedRange = { min: sharedRangeWeapon.rangeMin, max: sharedRangeWeapon.rangeMax }
      const savedSharedVision = armedTemplate.stats.vision
      try {
        sharedRangeWeapon.rangeMin = 0; sharedRangeWeapon.rangeMax = legacyMeters(400)
        armedTemplate.stats.vision = 40
        armedHp.builtIn = 'mg'; armedHp.size = sharedRangeWeapon.mount
        armedHp.x = armedVehicleDef.w / 2; armedHp.y = armedVehicleDef.h / 2 + 0.5

        let enemyRangeState = initialState()
        enemyRangeState.phase = 'combat'; enemyRangeState.spawnQueue = []
        const rangeEnemy = enemyRangeState.enemies[0]
        const playerCenter = fortressRect(enemyRangeState)
        const playerX = playerCenter.x + playerCenter.w / 2, playerY = playerCenter.y + playerCenter.h / 2
        if (rangeEnemy?.vehicle) {
          rangeEnemy.placementId = undefined // 隔离关卡实例视野，只验证炮位实际射程
          rangeEnemy.x = playerX; rangeEnemy.y = playerY - 12
          rangeEnemy.vehicle.heading = Math.PI; rangeEnemy.vehicle.vx = 0; rangeEnemy.vehicle.vy = 0
          rangeEnemy.aiOverride = { targeting: { profile: 'closestHostile' }, movement: { profile: 'holdRange' }, attack: { profile: 'none' }, special: { profile: 'none' } }
        }
        const enemyRangeY = rangeEnemy?.y ?? 0
        enemyRangeState = run(enemyRangeState, 0.5, 0.05)
        const enemyRangeAfter = enemyRangeState.enemies.find(item => item.id === rangeEnemy?.id)
        check('敌方载具实际炮位射程：已在 75%～95% 站位带时稳定保持位置', !!enemyRangeAfter && Math.abs(enemyRangeAfter.y - enemyRangeY) < 0.01 && enemyRangeAfter.targetId === 0,
          JSON.stringify({ before: enemyRangeY, after: enemyRangeAfter?.y, targetId: enemyRangeAfter?.targetId, engaged: enemyRangeAfter?.behaviorEngaged }))

        let allyRangeState = initialState()
        allyRangeState.phase = 'combat'; allyRangeState.spawnQueue = []
        const staticEnemy = allyRangeState.enemies[0]
        if (staticEnemy?.vehicle) {
          staticEnemy.controller = 'static'; staticEnemy.x = 12; staticEnemy.y = 12
          staticEnemy.vehicle.vx = 0; staticEnemy.vehicle.vy = 0
          allyRangeState.enemies = [staticEnemy]
          const allyRange = {
            id: allyRangeState.nextId++, kind: 'tank' as const, unitDefId: staticEnemy.unitDefId,
            faction: 'ally' as const, controller: 'ai' as const, producerId: 0,
            x: 12, y: 28, hp: staticEnemy.maxHp, maxHp: staticEnemy.maxHp,
            cooldown: 0, targetId: null, hitFlash: 0,
            vehicle: structuredClone(staticEnemy.vehicle),
            aiOverride: { targeting: { profile: 'closestHostile' as const }, movement: { profile: 'holdRange' as const }, attack: { profile: 'none' as const }, special: { profile: 'none' as const } },
          }
          allyRange.vehicle.heading = 0; allyRange.vehicle.vx = 0; allyRange.vehicle.vy = 0
          for (const turret of allyRange.vehicle.turrets ?? []) turret.id = allyRangeState.nextId++
          allyRangeState.allies = [allyRange]
          const allyRangeY = allyRange.y
          allyRangeState = tick(allyRangeState, 0.1)
          const allyRangeAfter = allyRangeState.allies.find(item => item.id === allyRange.id)
          check('友方载具实际炮位射程：与敌方共用同一接敌规则并继续靠近', !!allyRangeAfter && allyRangeAfter.y < allyRangeY,
            JSON.stringify({ before: allyRangeY, after: allyRangeAfter?.y, targetId: allyRangeAfter?.targetId }))
        }
      } finally {
        sharedRangeWeapon.rangeMin = savedSharedRange.min; sharedRangeWeapon.rangeMax = savedSharedRange.max
        armedTemplate.stats.vision = savedSharedVision
      }
    } finally {
      armedHp.builtIn = savedBuiltIn
      armedHp.size = savedArmedSize
      armedHp.x = savedArmedPosition.x
      armedHp.y = savedArmedPosition.y
    }
    const aiHardpoints = armedVehicleDef.hardpoints.slice(0, 2)
    const aiHardpointSnapshots = aiHardpoints.map(item => structuredClone(item))
    const mgForAi = TURRET_DEFS.find(item => item.id === 'mg')!
    const savedMgRanges = { min: mgForAi.rangeMin, max: mgForAi.rangeMax }
    try {
      mgForAi.rangeMin = 0; mgForAi.rangeMax = legacyMeters(400)
      for (const hp of aiHardpoints) {
        hp.size = 'S'; hp.builtIn = 'mg'; delete hp.types; delete hp.arc; delete hp.fixed
      }
      let aiState = initialState()
      aiState.phase = 'combat'; aiState.spawnQueue = []
      const aiEnemy = aiState.enemies[0]
      const player = fortressRect(aiState)
      const firedTurrets = new Set<number>()
      let independentAimSeen = false
      let startDistance = 0
      if (aiEnemy?.vehicle) {
        aiEnemy.x = player.x + player.w / 2; aiEnemy.y = player.y + player.h / 2 - 10; aiEnemy.vehicle.heading = 0
        aiEnemy.aiOverride = { targeting: { profile: 'closestHostile' }, movement: { profile: 'rangeEdge' }, attack: { profile: 'none' }, special: { profile: 'none' } }
        startDistance = fortressDistanceToPoint(aiState, aiEnemy.x, aiEnemy.y)
      }
      for (let index = 0; index < 35; index++) {
        aiState = tick(aiState, 0.1)
        for (const muzzle of aiState.muzzles) firedTurrets.add(muzzle.turretId)
        const live = aiState.enemies.find(item => item.id === aiEnemy?.id)
        independentAimSeen ||= !!live?.vehicle?.turrets?.some(turret => Math.abs(wrapAngle(turret.angle - live.vehicle!.heading)) > 0.01)
      }
      const aiAfter = aiState.enemies.find(item => item.id === aiEnemy?.id)
      const mountedIds = aiAfter?.vehicle?.turrets?.map(item => item.id) ?? []
      check('敌方载具炮塔 AI：车体按载具运动学进入站位，炮塔朝向与车体独立', !!aiAfter?.vehicle
        && fortressDistanceToPoint(aiState, aiAfter.x, aiAfter.y) > startDistance
        && independentAimSeen,
        JSON.stringify({ startDistance, endDistance: aiAfter ? fortressDistanceToPoint(aiState, aiAfter.x, aiAfter.y) : null,
          heading: aiAfter?.vehicle?.heading, turret: aiAfter?.vehicle?.turrets?.[0]?.angle, independentAimSeen }))
      check('敌方载具多炮塔：每个炮位拥有独立状态并都能索敌开火', mountedIds.length === 2 && mountedIds.every(id => firedTurrets.has(id)))
    } finally {
      mgForAi.rangeMin = savedMgRanges.min; mgForAi.rangeMax = savedMgRanges.max
      aiHardpoints.forEach((hp, index) => {
        const snapshot = aiHardpointSnapshots[index]
        Object.assign(hp, snapshot)
        if (snapshot.builtIn === undefined) delete hp.builtIn
        if (snapshot.types === undefined) delete hp.types
        if (snapshot.arc === undefined) delete hp.arc
        if (snapshot.fixed === undefined) delete hp.fixed
      })
    }
    let armorState = initialState()
    armorState.phase = 'combat'; armorState.spawnQueue = []
    const armorEnemy = armorState.enemies[0]
    if (armorEnemy?.vehicle) {
      armorEnemy.vehicle.heading = 0
      armorEnemy.vehicle.armor = { front: 100, rear: 80, left: 60, right: 40 }
      armorEnemy.vehicle.maxArmor = { ...armorEnemy.vehicle.armor }
      while (eventRandom(armorState.nextId, 131) < 0.05) armorState.nextId++
      const hpBeforeBlock = armorEnemy.hp
      const hitFxBeforeBlock = armorState.unitHits.length
      damageEnemy(armorState, armorEnemy, 25, null, {
        x: armorEnemy.x, y: armorEnemy.y - 2, penetration: 0,
        incomingDx: 0, incomingDy: 1, ammoId: 'custom_ammo_3', projectileSize: 0.6,
      })
      check('敌方载具四向装甲：车头来弹读取前装甲并产生跳弹/格挡而不伤结构', armorEnemy.hp === hpBeforeBlock && armorEnemy.vehicle.armor.front === 100)
      const enemyRicochetFx = armorState.unitHits.at(-1)
      check('敌我单位受击反馈统一：敌方载具跳弹也生成共用反射粒子事件', armorState.unitHits.length === hitFxBeforeBlock + 1
        && enemyRicochetFx?.ricochet === true && Math.hypot(enemyRicochetFx.ricochetDx, enemyRicochetFx.ricochetDy) > 0.99
        && enemyRicochetFx.normalDy < -0.99 && enemyRicochetFx.ammoId === 'custom_ammo_3' && enemyRicochetFx.projectileSize === 0.6)
      check('装甲提示文字：跳弹只生成“跳弹”飘字并标记为可独立隐藏', armorState.floats.at(-1)?.text === '跳弹' && armorState.floats.at(-1)?.visualKind === 'ricochet')
      damageEnemy(armorState, armorEnemy, 25, null, { x: armorEnemy.x, y: armorEnemy.y - 2, penetration: 200, armorDamage: 7 })
      check('敌方载具四向装甲：穿深足够时伤结构并削减对应受击面', armorEnemy.hp === hpBeforeBlock - 25 && armorEnemy.vehicle.armor.front === 93)
      check('装甲提示文字：有装甲的结构伤害显示“击穿”', armorState.floats.at(-1)?.text === '击穿' && armorState.floats.at(-1)?.visualKind === 'penetration')
      armorState.time += 0.1
      while (eventRandom(armorState.nextId, 131) < 0.05) armorState.nextId++
      damageEnemy(armorState, armorEnemy, 10, null, {
        x: armorEnemy.x - 10, y: armorEnemy.y, penetration: 0,
        incomingDx: 1, incomingDy: 0, ammoId: 'bullet_std', projectileSize: GEOMETRIC_BULLET_VISUAL_SIZE,
      })
      const sideHitFx = armorState.unitHits.at(-1)
      const armorUnit = unitDefById(armorEnemy.unitDefId!)!
      const visualHalfWidth = (armorUnit.visual?.width ?? armorUnit.stats.size * 2) * (armorEnemy.bossSizeScale ?? 1) / 2
      check('敌方载具受击点：按实际主体宽度内缩投影，不落到较大的碰撞体外圈', !!sideHitFx
        && Math.abs(sideHitFx.x - armorEnemy.x) < visualHalfWidth
        && Math.abs(sideHitFx.y - armorEnemy.y) <= (armorUnit.visual?.height ?? armorUnit.stats.size * 2) / 2,
        JSON.stringify({ hit: sideHitFx && { x: sideHitFx.x, y: sideHitFx.y }, center: { x: armorEnemy.x, y: armorEnemy.y }, visualHalfWidth }))
      armorState.time += 0.1
      damageEnemy(armorState, armorEnemy, 10, null, {
        x: armorEnemy.x - 10, y: armorEnemy.y - 10, penetration: 0,
        incomingDx: 1, incomingDy: 1, ammoId: 'bullet_std', projectileSize: GEOMETRIC_BULLET_VISUAL_SIZE,
      })
      const cornerHitFx = armorState.unitHits.at(-1)
      const cornerOutwardLength = cornerHitFx ? Math.hypot(cornerHitFx.x - armorEnemy.x, cornerHitFx.y - armorEnemy.y) : 0
      const cornerOutside = cornerHitFx && cornerOutwardLength > 0 ? {
        x: cornerHitFx.x + (cornerHitFx.x - armorEnemy.x) / cornerOutwardLength * 0.1,
        y: cornerHitFx.y + (cornerHitFx.y - armorEnemy.y) / cornerOutwardLength * 0.1,
      } : null
      check('载具受击点：斜向来弹投影到主体透明边缘轮廓内，继续向外即离开贴图', !!cornerHitFx && !!cornerOutside
        && pointInsideUnitShape(cornerHitFx.x, cornerHitFx.y, armorEnemy, armorUnit)
        && !pointInsideUnitShape(cornerOutside.x, cornerOutside.y, armorEnemy, armorUnit))
      armorEnemy.vehicle.heading = Math.PI / 2
      check('敌方载具四向装甲：车体旋转后世界右侧映射为车头', enemyVehicleArmorSideAt(armorEnemy, armorEnemy.x + 2, armorEnemy.y) === 'front')
      armorEnemy.vehicle.armor = { front: 0, rear: 0, left: 0, right: 0 }
      armorEnemy.hp = 1
      damageEnemy(armorState, armorEnemy, 10, null, { x: armorEnemy.x, y: armorEnemy.y - 2, penetration: 200 })
      const destroyedId = armorEnemy.id
      armorState = tick(armorState, 0.1)
      const destroyed = armorState.enemies.find(item => item.id === destroyedId)
      check('敌方载具损毁：炮塔停火、播放载具爆炸并进入延迟移除流程', !!destroyed?.vehicle?.destroyedFx && (destroyed.deathLeft ?? 0) > 0 && armorState.explosions.length > 0 && destroyed.vehicle.turrets?.every(item => !item.firing && item.burstLeft === 0))
      check('载具摧毁表现：不显示“载具摧毁”文字', !armorState.floats.some(item => item.text === '载具摧毁'))
    }
    if (enemy?.vehicle) {
      const rect = fortressRect(s)
      enemy.x = rect.x + rect.w / 2
      enemy.y = rect.y + rect.h / 2 - 1
      enemy.vehicle.heading = Math.PI
      enemy.vehicle.vx = 0
      enemy.vehicle.vy = 3
      const playerHp = s.fortress.hp
      const enemyHp = enemy.hp
      const enemyArmor = { ...enemy.vehicle.armor }
      const hits = applyFortressVehicleCollisions(s, 0, -3)
      check('堡垒冲撞：重叠载具按相对速度双向损伤并削减敌方受击面装甲', hits === 1 && s.fortress.hp < playerHp && enemy.hp < enemyHp && Object.keys(enemyArmor).some(side => enemy.vehicle!.armor[side as keyof typeof enemyArmor] < enemyArmor[side as keyof typeof enemyArmor]))
      const hpAfterHit = enemy.hp
      enemy.x = rect.x + rect.w / 2
      enemy.y = rect.y + rect.h / 2 - 1
      applyFortressVehicleCollisions(s, 0, -3)
      check('堡垒冲撞冷却：持续重叠只分离车体，不会逐帧重复扣血', enemy.hp === hpAfterHit)
      s.time += VEHICLE_COLLISION_COOLDOWN
      enemy.x = rect.x + rect.w / 2
      enemy.y = rect.y + rect.h / 2 - 1
      applyFortressVehicleCollisions(s, 0, -3)
      check('堡垒冲撞冷却：冷却结束后再次接触可重新结算', enemy.hp < hpAfterHit)
    }

    const separationState = initialState()
    separationState.spawnQueue = []
    const firstVehicle = separationState.enemies[0]
    const secondVehicle = separationState.enemies[1]
    if (firstVehicle?.vehicle && secondVehicle?.vehicle) {
      firstVehicle.x = secondVehicle.x = 12
      firstVehicle.y = secondVehicle.y = 8
      const contacts = resolveUnitCollisions(separationState, 6)
      check('单位实体分离：同点生成的两台载具会按碰撞体积自动分开', contacts === 1 && Math.hypot(firstVehicle.x - secondVehicle.x, firstVehicle.y - secondVehicle.y) > 0.5)
    }

    const groundUnitState = initialState()
    groundUnitState.enemies = []
    groundUnitState.allies = []
    const groundUnitA = mkEnemy(groundUnitState, 'walker', 10, 10, 100)
    const groundUnitB = mkEnemy(groundUnitState, 'walker', 10, 10, 100)
    const groundUnitContacts = resolveUnitCollisions(groundUnitState, 6)
    check('单位实体分离：地面载具追逐同一点时不会叠在一起', groundUnitContacts === 1 && Math.hypot(groundUnitA.x - groundUnitB.x, groundUnitA.y - groundUnitB.y) > 0.1)
    groundUnitA.controller = 'static'
    groundUnitB.controller = 'static'
    groundUnitA.x = groundUnitB.x = 10
    groundUnitA.y = groundUnitB.y = 10
    const staticContacts = resolveUnitCollisions(groundUnitState, 6)
    check('单位实体分离：两个静止控制器同点生成也会确定性解开重叠', staticContacts === 1 && Math.hypot(groundUnitA.x - groundUnitB.x, groundUnitA.y - groundUnitB.y) > 0.1)

    const sweptState = initialState()
    sweptState.objects = [{
      id: sweptState.nextId++, kind: 'rock', x: 8, y: 8, w: 1, h: 1,
      hp: -1, maxHp: -1, blockMove: true, blockProjectile: false, height: 0,
    }]
    sweptState.walls = []
    sweptState.buildings = []
    sweptState.core = null
    sweptState.enemies = []
    sweptState.allies = []
    const walkerDef = unitDefById(enemyUnitId('walker'))!
    const sweptMove = moveGroundUnitWithBlockers(sweptState, walkerDef, 5, 8.5, 7, 0, null, 1, 90001)
    check('地面单位连续碰撞：单帧高速移动不会穿过阻挡移动的物体', sweptMove.blockedX && sweptMove.x < 8)
    const airMove = moveGroundUnitWithBlockers(sweptState, { ...walkerDef, stats: { ...walkerDef.stats, air: true } }, 5, 8.5, 7, 0, null, 1, 90002)
    check('空中单位碰撞例外：仍可越过地面阻挡物', !airMove.blockedX && airMove.x > 8)

    const prepContactState = initialState()
    prepContactState.phase = 'prep'
    prepContactState.enemies = []
    prepContactState.allies = []
    const prepFortressRect = fortressRect(prepContactState)
    const prepCenterX = prepFortressRect.x + prepFortressRect.w / 2
    const prepCenterY = prepFortressRect.y + prepFortressRect.h / 2
    const prepVehicle = structuredClone(firstVehicle!)
    prepVehicle.id = prepContactState.nextId++
    prepVehicle.x = prepCenterX
    prepVehicle.y = prepCenterY
    prepVehicle.hp = prepVehicle.maxHp = 100
    prepContactState.enemies = [prepVehicle]
    const prepHp = prepVehicle.hp
    const prepPlayerX = prepContactState.fortress.x
    const prepPlayerY = prepContactState.fortress.y
    applyFortressVehicleCollisions(prepContactState, 0, 0)
    check('备战阶段实体碰撞：玩家与地面载具会分离且不结算伤害', prepVehicle.hp === prepHp
      && (Math.hypot(prepContactState.fortress.x - prepPlayerX, prepContactState.fortress.y - prepPlayerY) > 0
        || Math.hypot(prepVehicle.x - prepCenterX, prepVehicle.y - prepCenterY) > 0),
      JSON.stringify({ hasVehicle: !!prepVehicle.vehicle, player: { x: prepContactState.fortress.x, y: prepContactState.fortress.y }, enemy: { x: prepVehicle.x, y: prepVehicle.y } }))
    groundUnitState.time += 0.1
    damageEnemy(groundUnitState, groundUnitA, 1, null, { x: groundUnitA.x - 2, y: groundUnitA.y - 2, incomingDx: 1, incomingDy: 1 })
    const vehicleHitFx = groundUnitState.unitHits.at(-1)
    const vehicleUnit = unitDefById(groundUnitA.unitDefId ?? enemyUnitId(groundUnitA.kind))!
    const vehicleOutwardLength = vehicleHitFx ? Math.hypot(vehicleHitFx.x - groundUnitA.x, vehicleHitFx.y - groundUnitA.y) : 0
    const vehicleOutside = vehicleHitFx && vehicleOutwardLength > 0 ? {
      x: vehicleHitFx.x + (vehicleHitFx.x - groundUnitA.x) / vehicleOutwardLength * 0.1,
      y: vehicleHitFx.y + (vehicleHitFx.y - groundUnitA.y) / vehicleOutwardLength * 0.1,
    } : null
    check('载具受击点：统一按主体透明边缘轮廓投影', !!vehicleHitFx && !!vehicleOutside
      && pointInsideUnitShape(vehicleHitFx.x, vehicleHitFx.y, groundUnitA, vehicleUnit)
      && !pointInsideUnitShape(vehicleOutside.x, vehicleOutside.y, groundUnitA, vehicleUnit))

    const sharedUnitState = initialState()
    sharedUnitState.phase = 'combat'; sharedUnitState.spawnQueue = []
    const vehicleSource = sharedUnitState.enemies.find(item => (item.vehicle?.turrets?.length ?? 0) > 0)
      ?? sharedUnitState.enemies.find(item => item.vehicle)
    if (vehicleSource?.vehicle) {
      sharedUnitState.enemies = [vehicleSource]
      const allyVehicle = {
        id: sharedUnitState.nextId++, kind: 'tank' as const, unitDefId: vehicleSource.unitDefId,
        faction: 'ally' as const, controller: 'ai' as const, producerId: 0,
        x: vehicleSource.x + 6, y: vehicleSource.y, hp: vehicleSource.maxHp, maxHp: vehicleSource.maxHp,
        cooldown: 0, targetId: null, hitFlash: 0,
        vehicle: structuredClone(vehicleSource.vehicle),
        aiOverride: { targeting: { profile: 'closestHostile' as const, allowedTargets: ['combatUnit' as const] }, movement: { profile: 'direct' as const }, attack: { profile: 'none' as const }, special: { profile: 'none' as const } },
      }
      allyVehicle.vehicle.heading = 0
      allyVehicle.vehicle.armor = { front: 100, rear: 80, left: 60, right: 40 }
      allyVehicle.vehicle.maxArmor = { ...allyVehicle.vehicle.armor }
      const anchorTestUnit = unitDefById(allyVehicle.unitDefId)!
      if (anchorTestUnit.legacy?.registry === 'fortress' && allyVehicle.vehicle.turrets?.length === 0) {
        const hardpoint = anchorTestUnit.legacy.def.hardpoints[0]
        const previousBuiltIn = hardpoint.builtIn
        const previousSize = hardpoint.size
        hardpoint.builtIn = 'mg'; hardpoint.size = 'S'
        ensureUnitVehicleTurrets(sharedUnitState, allyVehicle, anchorTestUnit)
        if (previousBuiltIn === undefined) delete hardpoint.builtIn; else hardpoint.builtIn = previousBuiltIn
        hardpoint.size = previousSize
      }
      sharedUnitState.allies = [allyVehicle]
      const allyHpBefore = allyVehicle.hp
      while (eventRandom(sharedUnitState.nextId, 131) < 0.05) sharedUnitState.nextId++
      damageAlly(sharedUnitState, allyVehicle, 25, {
        x: allyVehicle.x, y: allyVehicle.y - 2, penetration: 0,
        incomingDx: 0, incomingDy: 1, ammoId: 'custom_ammo_3', projectileSize: 0.6,
      })
      const allyRicochetFx = sharedUnitState.unitHits.at(-1)
      check('阵营无关承伤：友方载具与敌方载具共用命中面、反射与弹丸口径数据', allyVehicle.hp === allyHpBefore
        && allyRicochetFx?.ricochet === true && allyRicochetFx.normalDy < -0.99
        && allyRicochetFx.ammoId === 'custom_ammo_3' && allyRicochetFx.projectileSize === 0.6)
      damageAlly(sharedUnitState, allyVehicle, 25, { x: allyVehicle.x, y: allyVehicle.y - 2, penetration: 200, armorDamage: 7 })
      check('阵营无关承伤：友方载具穿透后同样扣结构并削减对应装甲', allyVehicle.hp === allyHpBefore - 25 && allyVehicle.vehicle.armor.front === 93)
      allyVehicle.vehicle.heading = -Math.PI / 2
      const beforeMove = { x: allyVehicle.x, y: allyVehicle.y, heading: allyVehicle.vehicle.heading }
      let maxObservedSpeed = 0
      for (let index = 0; index < 20; index++) {
        moveUnitVehicleToward(sharedUnitState, allyVehicle, unitDefById(allyVehicle.unitDefId)!, vehicleSource.x, vehicleSource.y, 0.1)
        maxObservedSpeed = Math.max(maxObservedSpeed, Math.hypot(allyVehicle.vehicle.vx, allyVehicle.vehicle.vy))
      }
      check('阵营无关运动：友方载具使用与敌方相同的加速和连续转向组件', Math.hypot(allyVehicle.x - beforeMove.x, allyVehicle.y - beforeMove.y) > 0
        && maxObservedSpeed > 0,
        JSON.stringify({ beforeMove, maxObservedSpeed, moved: { x: allyVehicle.x, y: allyVehicle.y, vehicle: allyVehicle.vehicle } }))
      const vehicleUnit = unitDefById(allyVehicle.unitDefId)!
      const vehicleTurretsAnchored = (host: typeof allyVehicle) => {
        if (vehicleUnit.legacy?.registry !== 'fortress' || !host.vehicle.turrets?.length) return false
        const body = vehicleUnit.legacy.def
        const cosine = Math.cos(host.vehicle.heading), sine = Math.sin(host.vehicle.heading)
        return host.vehicle.turrets.every(turret => {
          const hardpoint = body.hardpoints.find(item => item.id === turret.hardpointId)
          if (!hardpoint) return false
          const localX = hardpoint.x - body.w / 2, localY = hardpoint.y - body.h / 2
          const expectedX = host.x + localX * cosine - localY * sine
          const expectedY = host.y + localX * sine + localY * cosine
          return Math.abs(turret.x + turret.w / 2 - expectedX) < 1e-6
            && Math.abs(turret.y + turret.h / 2 - expectedY) < 1e-6
        })
      }
      check('车载炮塔锚定：友方载具普通移动和转向后炮塔同帧跟随炮位', vehicleTurretsAnchored(allyVehicle),
        JSON.stringify({ legacy: vehicleUnit.legacy?.registry, turrets: allyVehicle.vehicle.turrets }))

      const playerRect = fortressRect(sharedUnitState)
      allyVehicle.x = playerRect.x + playerRect.w / 2
      allyVehicle.y = playerRect.y + playerRect.h / 2
      applyFortressVehicleCollisions(sharedUnitState, 0, 0)
      check('车载炮塔锚定：玩家碰撞推开友方载具后主体与炮塔保持同步', vehicleTurretsAnchored(allyVehicle))

      const secondAllyVehicle = structuredClone(allyVehicle)
      secondAllyVehicle.id = sharedUnitState.nextId++
      secondAllyVehicle.x = allyVehicle.x
      secondAllyVehicle.y = allyVehicle.y
      sharedUnitState.allies.push(secondAllyVehicle)
      resolveUnitCollisions(sharedUnitState, 6)
      check('车载炮塔锚定：单位互相挤开和同点出生分离后所有载具炮塔保持同步',
        vehicleTurretsAnchored(allyVehicle) && vehicleTurretsAnchored(secondAllyVehicle))

      const parallelState = initialState()
      parallelState.enemies = []
      const parallelA = structuredClone(allyVehicle)
      const parallelB = structuredClone(allyVehicle)
      parallelA.id = parallelState.nextId++; parallelB.id = parallelState.nextId++
      parallelA.x = 10; parallelA.y = 10
      parallelB.x = 10.2; parallelB.y = 10
      parallelA.vehicle.heading = parallelB.vehicle.heading = 0
      parallelA.vehicle.vx = 0.6; parallelA.vehicle.vy = -3
      parallelB.vehicle.vx = 0; parallelB.vehicle.vy = -3
      parallelState.allies = [parallelA, parallelB]
      resolveUnitCollisions(parallelState, 6)
      check('友方载具贴行：只削减互相挤压的横向相对速度，完整保留共同前进速度',
        Math.abs(parallelA.vehicle.vy + 3) < 1e-9 && Math.abs(parallelB.vehicle.vy + 3) < 1e-9
        && parallelA.vehicle.vx - parallelB.vehicle.vx < 0.6,
        JSON.stringify({ a: { vx: parallelA.vehicle.vx, vy: parallelA.vehicle.vy }, b: { vx: parallelB.vehicle.vx, vy: parallelB.vehicle.vy } }))
      const visual = vehicleUnit.visual ?? { width: vehicleUnit.stats.size * 2, height: vehicleUnit.stats.size * 2 }
      const localCornerX = visual.width * 0.45, localCornerY = visual.height * 0.45
      const cornerCos = Math.cos(allyVehicle.vehicle.heading), cornerSin = Math.sin(allyVehicle.vehicle.heading)
      const cornerX = allyVehicle.x + localCornerX * cornerCos - localCornerY * cornerSin
      const cornerY = allyVehicle.y + localCornerX * cornerSin + localCornerY * cornerCos
      check('统一弹丸碰撞体：载具主体角部按旋转矩形命中', pointInsideUnitShape(cornerX, cornerY, allyVehicle, vehicleUnit)
        && segmentUnitShapeEntry(cornerX - visual.width, cornerY, cornerX + visual.width, cornerY, allyVehicle, vehicleUnit) !== null)
      allyVehicle.vehicle.heat = allyVehicle.vehicle.heatCap
      allyVehicle.vehicle.overheated = true
      coolUnitVehicleHeat(allyVehicle, vehicleUnit, 0.1)
      const coolingStarted = allyVehicle.vehicle.heat < allyVehicle.vehicle.heatCap && allyVehicle.vehicle.overheated
      coolUnitVehicleHeat(allyVehicle, vehicleUnit, allyVehicle.vehicle.heatCap / Math.max(0.01, allyVehicle.vehicle.heatDissipation))
      const nonPlayerResourcesRemainInfinite = allyVehicle.vehicle.turrets?.every(item => item.ammo === undefined && item.energy === undefined) ?? true
      check('非玩家炮塔热量：无限弹药/电量不影响产热，过热后按同一50%迟滞散热恢复',
        coolingStarted && !allyVehicle.vehicle.overheated && nonPlayerResourcesRemainInfinite)
    }
  } finally {
    LEVEL.initialUnits = savedInitialUnits
    deleteCustomFortress(wheeledFortressId)
  }
}

// 关卡单位实例行为：静止、范围随机、循环路线、玩家接近、跟随玩家。
{
  const savedLevel = structuredClone(LEVEL)
  const navigationFortressId = 'sim-non-combat-navigation'
  const navigationUnitId = fortressUnitId(navigationFortressId)
  const placed = (behavior: 'static' | 'guard' | 'random' | 'route' | 'approach' | 'follow', extra: Partial<typeof LEVEL.initialUnits[number]> = {}): typeof LEVEL.initialUnits[number] => ({
    id: 9801, unitDefId: 'unit:uav', faction: 'neutral', controller: 'ai', x: 6.5, y: 6.5,
    behavior, behaviorRange: behavior === 'random' ? 4 : 8, behaviorInterval: 0.25, behaviorSpeedPercent: 50, route: [], events: [], ...extra,
  })
  const behaviorState = (unit: typeof LEVEL.initialUnits[number]) => {
    LEVEL.initialUnits = [unit]
    const state = initialState()
    state.phase = 'combat'
    state.spawnQueue = [{ kind: 'walker', delay: 1000 }]
    state.spawnTimer = 1000
    return state
  }
  try {
    const migrated = parseLevel(JSON.stringify({ ...defaultLevel(), rows: 20, cols: 20, initialUnits: [
      placed('random', { behaviorRange: 7, behaviorInterval: 0, behaviorSpeedPercent: 35 }),
      { ...placed('route', { id: 9802 }), route: [{ x: -2, y: 4.5 }, { x: 99, y: 99 }] },
    ] })).initialUnits
    check('单位行为配置：范围、零间隔、速度百分比会持久化，路线节点限制在战场内', migrated[0]?.behaviorRange === 7 && migrated[0]?.behaviorInterval === 0 && migrated[0]?.behaviorSpeedPercent === 35
      && migrated[1]?.route[0]?.x === 0.5 && migrated[1]?.route[1]?.x === 19.5 && migrated[1]?.route[1]?.y === 19.5)

    let state = behaviorState(placed('static'))
    const still = state.allies.find(unit => unit.placementId === 9801)!
    const stillAt = { x: still.x, y: still.y }
    state = run(state, 1)
    const stillAfter = state.allies.find(unit => unit.placementId === 9801)!
    check('静止行为：单位固定在放置位置', Math.hypot(stillAfter.x - stillAt.x, stillAfter.y - stillAt.y) < 1e-6)

    const guardPlacement = placed('guard', { unitDefId: fortressUnitId(DEFAULT_FORTRESS.id), rotation: 90, behaviorSpeedPercent: 100 })
    state = behaviorState(guardPlacement)
    const guard = state.allies.find(unit => unit.placementId === 9801)!
    guard.x += 0.05
    guard.vehicle!.heading = Math.PI
    guard.behaviorReturning = true
    guard.behaviorFacingHome = false
    state = run(state, 0.2)
    const guardAfter = state.allies.find(unit => unit.placementId === 9801)!
    check('坚守行为：返回原位后恢复关卡实例的初始朝向', !guardAfter.behaviorReturning && guardAfter.behaviorFacingHome === true
      && Math.abs(guardAfter.vehicle!.heading - Math.PI / 2) < 1e-9,
    JSON.stringify({ returning: guardAfter.behaviorReturning, facingHome: guardAfter.behaviorFacingHome, heading: guardAfter.vehicle?.heading }))

    state = behaviorState(placed('random'))
    const randomStart = state.allies.find(unit => unit.placementId === 9801)!
    const randomHome = { x: randomStart.x, y: randomStart.y }
    state = run(state, 1.2)
    const randomAfter = state.allies.find(unit => unit.placementId === 9801)!
    const randomDistance = Math.hypot(randomAfter.x - randomHome.x, randomAfter.y - randomHome.y)
    check('随机行为：按范围20%–50%目标与速度百分比执行移动', randomDistance > 0.05 && randomDistance <= 2.1, `distance=${randomDistance}`)

    state = behaviorState(placed('route', { behaviorSpeedPercent: 100, route: [{ x: 7.5, y: 6.5 }, { x: 8.5, y: 6.5 }] }))
    state = run(state, 0.6)
    const routeMid = state.allies.find(unit => unit.placementId === 9801)!
    state = run(state, 1.2)
    const routeAfter = state.allies.find(unit => unit.placementId === 9801)!
    check('路线行为：先到1号节点，再按编号推进并在末节点后回到1号循环', routeMid.x > 6.5 && (routeAfter.behaviorRouteIndex === 0 || routeAfter.behaviorRouteIndex === 1), JSON.stringify({ mid: routeMid.x, after: routeAfter.x, index: routeAfter.behaviorRouteIndex }))

    state = behaviorState(placed('approach', { behaviorRange: 5, behaviorSpeedPercent: 60 }))
    const approach = state.allies.find(unit => unit.placementId === 9801)!
    const fortress = fortressRect(state)
    approach.x = fortress.x + fortress.w / 2
    approach.y = fortress.y - 3
    const before = fortressDistanceToPoint(state, approach.x, approach.y)
    state = run(state, 2)
    const afterUnit = state.allies.find(unit => unit.placementId === 9801)!
    const after = fortressDistanceToPoint(state, afterUnit.x, afterUnit.y)
    check('接近行为：玩家进入触发范围后持续向玩家移动', after < before, `before=${before} after=${after}`)

    state = behaviorState(placed('follow', { behaviorRange: 2, behaviorSpeedPercent: 60 }))
    const follower = state.allies.find(unit => unit.placementId === 9801)!
    const followFortress = fortressRect(state)
    follower.x = followFortress.x + followFortress.w / 2
    follower.y = followFortress.y - 6
    const followBefore = fortressDistanceToPoint(state, follower.x, follower.y)
    state = run(state, 2)
    const followerAfter = state.allies.find(unit => unit.placementId === 9801)!
    const followAfter = fortressDistanceToPoint(state, followerAfter.x, followerAfter.y)
    check('跟随行为：单位持续向玩家移动并保持配置距离', followAfter < followBefore, `before=${followBefore} after=${followAfter}`)

    const navigationDef = structuredClone(DEFAULT_FORTRESS)
    navigationDef.id = navigationFortressId
    navigationDef.unitId = navigationUnitId
    navigationDef.name = '非战斗寻路夹具'
    navigationDef.w = 1
    navigationDef.h = 1
    navigationDef.shape = ['0,0']
    navigationDef.interior = { cols: 1, rows: 1 }
    navigationDef.interiorCells = ['0,0']
    navigationDef.hardpoints = []
    navigationDef.effects = []
    navigationDef.tracks = undefined
    navigationDef.wheels = undefined
    navigationDef.spriteBody = undefined
    navigationDef.speed = 2
    navigationDef.accel = 8
    navigationDef.turnSpeed = 360
    navigationDef.turnRadius = 0
    saveCustomFortress(navigationDef)

    LEVEL.objects = [{
      id: 9890, kind: 'rock', x: 8, y: 4, w: 1, h: 5,
      hp: -1, maxHp: -1, blockMove: true, blockProjectile: false, height: 3,
    }]
    LEVEL.initialUnits = [
      placed('route', { id: 9811, unitDefId: navigationUnitId, x: 6.5, y: 6.5, behaviorSpeedPercent: 100, route: [{ x: 12.5, y: 6.5 }] }),
      placed('route', { id: 9812, unitDefId: navigationUnitId, x: 6.5, y: 7.5, behaviorSpeedPercent: 100, route: [{ x: 12.5, y: 6.5 }] }),
    ]
    const statsBefore = nonCombatNavigationStats()
    state = initialState()
    state.phase = 'combat'
    state.spawnQueue = [{ kind: 'walker', delay: 1000 }]
    state.spawnTimer = 1000
    let deviatedAroundWall = false
    state = run(state, 14, 0.05, current => {
      const first = current.allies.find(unit => unit.placementId === 9811)
      if (first && Math.abs(first.y - 6.5) > 0.7) deviatedAroundWall = true
    })
    const routedUnits = state.allies.filter(unit => unit.placementId === 9811 || unit.placementId === 9812)
    const statsAfter = nonCombatNavigationStats()
    check('统一地格寻路：路线单位绕开阻挡物抵达指定节点而非直线顶墙',
      deviatedAroundWall && routedUnits.length === 2 && routedUnits.every(unit => Math.hypot(unit.x - 12.5, unit.y - 6.5) < 0.8),
      JSON.stringify(routedUnits.map(unit => ({ x: unit.x, y: unit.y, index: unit.behaviorRouteIndex }))))
    check('统一地格寻路：同类型同目标单位共享一份距离场缓存',
      statsAfter.fieldBuilds - statsBefore.fieldBuilds === 1 && statsAfter.fieldCacheHits > statsBefore.fieldCacheHits,
      JSON.stringify({ before: statsBefore, after: statsAfter }))

    LEVEL.objects = [{
      id: 9891, kind: 'rock', x: 8, y: 0, w: 1, h: LEVEL.rows,
      hp: -1, maxHp: -1, blockMove: true, blockProjectile: false, height: 3,
    }]
    state = behaviorState(placed('route', {
      id: 9813, unitDefId: navigationUnitId, x: 6.5, y: 6.5,
      behaviorSpeedPercent: 100, route: [{ x: 12.5, y: 6.5 }],
    }))
    state = run(state, 1.6)
    const unreachable = state.allies.find(unit => unit.placementId === 9813)!
    check('统一地格寻路：不可达路线节点不会被跳过，单位停车并周期触发脱困重算',
      unreachable.x < 7.5 && unreachable.behaviorRouteIndex === 0
        && unreachable.behaviorNavUnreachable === true && (unreachable.behaviorNavRepathSerial ?? 0) >= 1,
      JSON.stringify({ x: unreachable.x, y: unreachable.y, index: unreachable.behaviorRouteIndex, unreachable: unreachable.behaviorNavUnreachable, replans: unreachable.behaviorNavRepathSerial }))
  } finally {
    deleteCustomFortress(navigationFortressId)
    for (const key of Object.keys(LEVEL)) delete (LEVEL as unknown as Record<string, unknown>)[key]
    Object.assign(LEVEL, savedLevel)
    invalidateWallInfo()
  }
}

// 放置行为与战斗 AI 的车体移动必须严格单入口：复现 13 台勇士 K1“接近”时逐帧加速乱飞。
{
  const savedLevel = structuredClone(LEVEL)
  const fortressId = 'sim-k1-approach-regression'
  const unitId = fortressUnitId(fortressId)
  try {
    const k1 = structuredClone(DEFAULT_FORTRESS)
    k1.id = fortressId
    k1.unitId = unitId
    k1.name = '勇士 K1 移动回归夹具'
    k1.chassis = 'walker'
    k1.w = 1
    k1.h = 1
    k1.shape = ['0,0']
    k1.interior = { cols: 1, rows: 1 }
    k1.interiorCells = ['0,0']
    k1.hardpoints = [{ id: 'k1-gun', x: 0.5, y: 0.5, size: 'S', builtIn: 'mg' }]
    k1.effects = []
    k1.tracks = undefined
    k1.wheels = undefined
    k1.speed = 2.5
    k1.accel = 1
    k1.turnSpeed = 90
    k1.brakeInertia = 1
    k1.walkerStride = 2.1
    k1.vision = 1
    k1.trackingVision = 1
    k1.unitAI = { preferredTarget: 'allHostile', positioning: 'optimalRange', movement: 'stop', special: { profile: 'none' } }
    check('勇士 K1 回归夹具：步行机甲定义可保存', saveCustomFortress(k1))

    LEVEL.objects = []
    LEVEL.terrain = []
    LEVEL.events = []
    LEVEL.triggers = []
    LEVEL.interactables = []
    configureObjective(LEVEL, { type: 'defend', waves: 99 })

    const verifyFaction = (faction: 'ally' | 'enemy') => {
      LEVEL.initialUnits = Array.from({ length: 13 }, (_, index) => ({
        id: 9810 + index,
        unitDefId: unitId,
        faction,
        controller: 'ai' as const,
        x: 3.5 + (index % 7) * 4,
        y: 3.5 + Math.floor(index / 7) * 4,
        rotation: 180,
        behavior: 'approach' as const,
        behaviorRange: 100,
        behaviorInterval: 1,
        behaviorSpeedPercent: 100,
        route: [],
        events: [],
      }))
      let state = initialState()
      state.phase = 'combat'
      state.turrets = []
      state.spawnQueue = [{ kind: 'walker', delay: 999 }]
      state.spawnTimer = 999
      const dt = 0.05
      const previous = new Map<number, { x: number; y: number }>()
      const hosts = faction === 'enemy' ? state.enemies : state.allies
      for (const host of hosts) previous.set(host.id, { x: host.x, y: host.y })
      let maxStep = 0
      let maxRuntimeSpeed = 0
      for (let step = 0; step < 40; step++) {
        state = tick(state, dt)
        const liveHosts = faction === 'enemy' ? state.enemies : state.allies
        for (const host of liveHosts) {
          const before = previous.get(host.id)
          if (before) maxStep = Math.max(maxStep, Math.hypot(host.x - before.x, host.y - before.y))
          previous.set(host.id, { x: host.x, y: host.y })
          if (host.vehicle) maxRuntimeSpeed = Math.max(maxRuntimeSpeed, Math.hypot(host.vehicle.vx, host.vehicle.vy))
        }
      }
      const liveHosts = faction === 'enemy' ? state.enemies : state.allies
      check(`勇士 K1 接近回归：${faction === 'enemy' ? '敌方' : '友方'}13 台单位不会因双重积分加速乱飞`,
        liveHosts.length === 13 && maxStep <= k1.speed * dt * 1.5 + 0.02 && maxRuntimeSpeed <= k1.speed * 1.5
          && liveHosts.every(host => Number.isFinite(host.x) && Number.isFinite(host.y) && host.x >= 0 && host.x <= LEVEL.cols && host.y >= 0 && host.y <= LEVEL.rows),
        JSON.stringify({ count: liveHosts.length, maxStep, maxRuntimeSpeed }))
    }

    verifyFaction('enemy')
    verifyFaction('ally')
  } finally {
    deleteCustomFortress(fortressId)
    for (const key of Object.keys(LEVEL)) delete (LEVEL as unknown as Record<string, unknown>)[key]
    Object.assign(LEVEL, savedLevel)
    invalidateWallInfo()
  }
}

// #18 一期：任务简报、三枚勋章展示与线性/显式关卡链解锁。
{
  const first = defaultLevel()
  const second = defaultLevel()
  const missionLibrary = parseLevelLibrary(JSON.stringify({
    version: 1,
    activeId: 'level-1',
    levels: [
      { id: 'level-1', name: '第一关', level: first, nextId: 'level-2' },
      { id: 'level-2', name: '第二关', level: second },
    ],
  }))
  const emptyProgress: LevelProgress = { completedIds: [], totalReward: 0, medalIds: [], unlockedEquipmentIds: [], unlockRecords: [], spentMedals: 0, globalVariables: { 'global:rescued': 2 } }
  const completedProgress: LevelProgress = { completedIds: ['level-1'], totalReward: 0, medalIds: ['level-1:primary', 'level-1:secondary-1'], unlockedEquipmentIds: [], unlockRecords: [], spentMedals: 0, globalVariables: {} }
  const brief = missionBriefingOf(missionLibrary.levels[0])
  check('任务介绍：旧关卡自动补齐任务贴图、简报和一主两次目标', !!brief.image && !!brief.introduction && !!brief.primaryObjective && brief.secondaryObjectives.length === 2)
  check('任务介绍：默认任务贴图锚定素材库任务贴图分类', brief.image === 'builtin:mission/briefing_default' && getAsset(brief.image)?.category === 'missionImage')
  check('任务介绍：首关默认解锁、后续关卡在前置完成前锁定', isLevelUnlocked(missionLibrary, 'level-1', emptyProgress) && !isLevelUnlocked(missionLibrary, 'level-2', emptyProgress))
  check('任务介绍：前置关卡完成后按顺序/nextId 解锁下一关', isLevelUnlocked(missionLibrary, 'level-2', completedProgress))
  check('任务介绍：已获得目标勋章按独立槽位识别', hasLevelMedal(completedProgress, 'level-1', 'primary') && hasLevelMedal(completedProgress, 'level-1', 'secondary-1') && !hasLevelMedal(completedProgress, 'level-1', 'secondary-2'))
  const deploymentLibrary = parseLevelLibrary(JSON.stringify({
    version: 1,
    activeId: 'level-1',
    levels: [{ id: 'level-1', name: '限定载具关', level: first, deployableFortressIds: ['standard', 'jeep', 'standard', '', 7, 'third-valid-id', 'extra-fourth'] }],
  }))
  check('任务介绍：关卡出战车辆去重、过滤非法值并限制最多三个', JSON.stringify(deploymentLibrary.levels[0].deployableFortressIds) === JSON.stringify(['standard', 'jeep', 'third-valid-id']))
  check('任务介绍：旧关卡未配置时默认取当前车辆库前三项', JSON.stringify(deployableFortressIdsOf(missionLibrary.levels[0], FORTRESS_DEFS.map(def => def.id))) === JSON.stringify(FORTRESS_DEFS.slice(0, 3).map(def => def.id)))
  const unlockLibrary = parseLevelLibrary(JSON.stringify({
    version: 1,
    activeId: 'level-1',
    levels: [{ id: 'level-1', name: '装备奖励关', level: first, unlockRewards: [
      { kind: 'fortress', id: 'jeep' }, { kind: 'fortress', id: 'jeep' }, { kind: 'turret', id: 'mg' }, { kind: 'bad', id: 'ignored' },
    ] }],
  }))
  const jeepRef = { kind: 'fortress' as const, id: 'jeep' }
  const freeRef = { kind: 'module' as const, id: 'unlisted-module' }
  check('装备解锁配置：关卡奖励引用会去重并过滤非法类型', unlockLibrary.levels[0].unlockRewards?.length === 2)
  check('装备准入：已配置为奖励的装备在获得前锁定，未配置来源的现有装备默认可用', !isEquipmentUnlocked(emptyProgress, jeepRef, unlockLibrary) && isEquipmentUnlocked(emptyProgress, freeRef, unlockLibrary))
  const unlockedProgress = awardLevelProgress(emptyProgress, 'level-1', 0, ['primary'], unlockLibrary.levels[0].unlockRewards)
  const unlockedAgain = awardLevelProgress(unlockedProgress, 'level-1', 0, ['primary'], unlockLibrary.levels[0].unlockRewards)
  check('关卡装备奖励：首次通关永久解锁并记录关卡来源', isEquipmentUnlocked(unlockedProgress, jeepRef, unlockLibrary)
    && unlockedProgress.unlockRecords.some(record => record.equipmentId === equipmentUnlockId(jeepRef) && record.source === 'level' && record.sourceId === 'level-1'))
  check('关卡装备奖励：重复通关不会重复写入所有权或来源记录', unlockedAgain.unlockedEquipmentIds.length === unlockedProgress.unlockedEquipmentIds.length && unlockedAgain.unlockRecords.length === unlockedProgress.unlockRecords.length)
  const shopRef = { kind: 'module' as const, id: 'shop-module' }
  const insufficientPurchase = purchaseEquipment(emptyProgress, shopRef, 1, 'shop:item-1')
  const successfulPurchase = purchaseEquipment(completedProgress, shopRef, 2, 'shop:item-1')
  check('成就商店接口：勋章不足时不扣除也不解锁', !insufficientPurchase.ok && insufficientPurchase.reason === 'insufficient-medals' && insufficientPurchase.progress.spentMedals === 0)
  check('成就商店接口：足额购买原子扣除勋章并记录商店来源', successfulPurchase.ok && availableMedalCount(successfulPurchase.progress) === 0
    && successfulPurchase.progress.unlockRecords.some(record => record.equipmentId === equipmentUnlockId(shopRef) && record.source === 'shop' && record.sourceId === 'shop:item-1'))
  const shopKeys = ACHIEVEMENT_SHOP_ITEMS.map(item => equipmentUnlockId(item.reward))
  check('#27 商品目录：商品 ID、装备引用唯一且勋章价格为正整数',
    new Set(ACHIEVEMENT_SHOP_ITEMS.map(item => item.id)).size === ACHIEVEMENT_SHOP_ITEMS.length
    && new Set(shopKeys).size === shopKeys.length
    && ACHIEVEMENT_SHOP_ITEMS.every(item => Number.isInteger(item.medalCost) && item.medalCost > 0))
  check('#27 商品目录：全部炮塔和模块奖励都指向当前有效定义', ACHIEVEMENT_SHOP_ITEMS.every(item => item.reward.kind === 'turret'
    ? TURRET_DEFS.some(def => def.id === item.reward.id)
    : item.reward.kind === 'module' ? MODULE_DEFS.some(def => def.id === item.reward.id) : true))
  const firstShopItem = ACHIEVEMENT_SHOP_ITEMS[0]
  check('#27 商店准入：目录装备在获得前锁定', !isEquipmentUnlocked(emptyProgress, firstShopItem.reward, missionLibrary))
  const catalogPurchase = purchaseEquipment(completedProgress, firstShopItem.reward, firstShopItem.medalCost, firstShopItem.id)
  const duplicatePurchase = purchaseEquipment(catalogPurchase.progress, firstShopItem.reward, firstShopItem.medalCost, firstShopItem.id)
  check('#27 兑换：成功后永久解锁并准确扣除勋章', catalogPurchase.ok
    && isEquipmentUnlocked(catalogPurchase.progress, firstShopItem.reward, missionLibrary)
    && catalogPurchase.progress.spentMedals === firstShopItem.medalCost)
  check('#27 兑换：重复兑换被拦截且不再扣除勋章', !duplicatePurchase.ok && duplicatePurchase.reason === 'owned'
    && duplicatePurchase.progress.spentMedals === firstShopItem.medalCost)
  const levelUnlockedShopItem = awardLevelProgress(emptyProgress, 'level-1', 0, ['primary'], [firstShopItem.reward])
  check('#27 双来源：关卡奖励可提前解锁商店装备且不消费勋章', isEquipmentUnlocked(levelUnlockedShopItem, firstShopItem.reward, missionLibrary)
    && levelUnlockedShopItem.spentMedals === 0
    && levelUnlockedShopItem.unlockRecords.some(record => record.equipmentId === equipmentUnlockId(firstShopItem.reward) && record.source === 'level'))
  let trackedGoalState = initialState()
  trackedGoalState.kills = 999
  trackedGoalState.fortress.hp = trackedGoalState.fortress.maxHp
  trackedGoalState = tick(trackedGoalState, 0.01)
  check('目标状态：数值条件变化不会自动完成任何目标', !primaryObjectiveStatus(trackedGoalState) && JSON.stringify(secondaryObjectiveStatuses(trackedGoalState)) === JSON.stringify([false, false]))
  trackedGoalState.secondaryObjectivesCompleted[0] = true
  check('主界面目标：事件写入次要目标后立即显示达成', secondaryObjectiveStatuses(trackedGoalState)[0])
  trackedGoalState.phase = 'lost'
  check('目标结算：失败关卡不会确认已追踪的次要目标', JSON.stringify(settlementObjectiveStatuses(trackedGoalState)) === JSON.stringify([false, false, false]))
  trackedGoalState.phase = 'won'
  trackedGoalState.levelVariables['builtin:primaryObjectiveCompleted'] = true
  check('目标结算：胜利时确认主要目标及已达成的次要目标', JSON.stringify(settlementObjectiveStatuses(trackedGoalState)) === JSON.stringify([true, true, false]))
  const firstSettlement = awardLevelProgress(emptyProgress, 'level-1', 320, ['primary', 'secondary-1'])
  const repeatedSettlement = awardLevelProgress(firstSettlement, 'level-1', 320, ['primary', 'secondary-1'])
  check('关卡结算：首次胜利发放奖励并记录完成的目标勋章', firstSettlement.totalReward === 320 && firstSettlement.completedIds.includes('level-1') && firstSettlement.medalIds.length === 2)
  check('关卡结算：重复挑战可重复获得奖励，但不会重复记录关卡或同一目标勋章', repeatedSettlement.totalReward === 640 && repeatedSettlement.completedIds.length === 1 && repeatedSettlement.medalIds.length === 2)
  check('玩家进度：关卡结算保留全局变量当前值', repeatedSettlement.globalVariables['global:rescued'] === 2)
  const globalLibrary = parseLevelLibrary(JSON.stringify({ version: 1, activeId: 'level-1', globalVariables: [{ id: 'rescued', name: '已救人数', type: 'number', initial: 1 }], levels: [{ id: 'level-1', name: '第一关', level: first }] }))
  const globalValues = globalVariableValues(globalLibrary.globalVariables, { 'global:rescued': 5 })
  check('全局变量：定义归属整个关卡库，玩家进度值优先于初始值', globalLibrary.globalVariables[0]?.id === 'global:rescued' && globalValues['global:rescued'] === 5)
  check('关卡结算：胜利或失败状态会冻结游戏主循环', isTerminalPhase('won') && isTerminalPhase('lost') && !isTerminalPhase('combat'))
}

// 关卡事件：触发方式只描述时机，单位/物体/变量统一作为触发条件。
{
  const legacy = defaultLevel()
  ;(legacy.events as unknown[]) = [{
    id: 9900, name: '旧变量触发', category: 'scene', enabled: true,
    activationLimit: 1, cooldown: 0, conditions: { mode: 'all', conditions: [] },
    trigger: { type: 'variable', conditions: { mode: 'all', conditions: [{ variableId: 'gate', operator: 'eq', value: true }] } },
    actions: [],
  }]
  const migrated = parseLevel(JSON.stringify(legacy)).events[0]
  check('事件条件迁移：旧“变量满足”触发方式转为“自动”并保留变量判断', migrated?.trigger.type === 'automatic'
    && migrated.conditions.conditions[0]?.kind === 'variable'
    && migrated.conditions.conditions[0]?.variableId === 'gate')

  const numericMigration = defaultLevel()
  ;(numericMigration.variables as unknown[]) = [
    { id: 'var:true', name: '旧真值', type: 'boolean', initial: true },
    { id: 'var:false', name: '旧假值', type: 'boolean', initial: false },
  ]
  ;(numericMigration.events as unknown[]) = [{
    id: 9905, name: '旧布尔条件', category: 'scene', enabled: true, activationLimit: 1, cooldown: 0,
    trigger: { type: 'automatic' }, conditions: { mode: 'all', conditions: [{ variableId: 'var:true', operator: 'eq', value: true }] }, actions: [],
  }]
  const migratedNumeric = parseLevel(JSON.stringify(numericMigration))
  check('数值变量迁移：旧布尔定义、初始值与条件统一转为 1/0', migratedNumeric.variables.every(variable => variable.type === 'number')
    && migratedNumeric.variables[0]?.initial === 1 && migratedNumeric.variables[1]?.initial === 0
    && migratedNumeric.events[0]?.conditions.conditions[0]?.kind === 'variable'
    && migratedNumeric.events[0]?.conditions.conditions[0]?.value === 1)

  const legacyObjectState = defaultLevel()
  ;(legacyObjectState.events as unknown[]) = [{
    id: 9901, name: '旧物体状态触发', category: 'object', enabled: true,
    activationLimit: 1, cooldown: 0, conditions: { mode: 'all', conditions: [] },
    trigger: { type: 'objectState', objectId: 7, state: 'open' }, actions: [],
  }]
  const migratedObjectState = parseLevel(JSON.stringify(legacyObjectState)).events[0]
  const migratedStateCondition = migratedObjectState?.conditions.conditions[0]
  check('物体状态迁移：旧触发方式收口为自动时机＋物体状态条件', migratedObjectState?.trigger.type === 'automatic'
    && migratedStateCondition?.kind === 'objectState'
    && migratedStateCondition.objectId === 7 && migratedStateCondition.operator === 'eq' && migratedStateCondition.state === 'open')

  const savedLevel = structuredClone(LEVEL)
  try {
    LEVEL.mode = 'defend'; LEVEL.objective = { type: 'defend', waves: 99 }
    LEVEL.interactables = []; LEVEL.triggers = []; LEVEL.stages = [defaultStage({ type: 'defend', waves: 99 })]; LEVEL.startStageId = LEVEL.stages[0].id
    LEVEL.initialUnits = [{ id: 9901, unitDefId: 'unit:uav', faction: 'ally', controller: 'static', x: 8.5, y: 8.5, events: [] }]
    LEVEL.objects = [{ id: 9902, kind: 'rock', x: 10, y: 10, w: 1, h: 1, hp: -1, blockMove: false, blockProjectile: false, height: 0 }]
    const event = (id: number, conditions: typeof LEVEL.events[number]['conditions'], gold: number): typeof LEVEL.events[number] => ({
      id, name: `条件 ${id}`, category: 'scene', enabled: true, activationLimit: 1, cooldown: 0,
      trigger: { type: 'automatic' }, conditions, actions: [{ type: 'reward', gold }],
    })
    LEVEL.events = [
      event(9911, { mode: 'all', conditions: [{ kind: 'unit', unitPlacementId: 9901, state: 'alive' }] }, 10),
      event(9912, { mode: 'all', conditions: [{ kind: 'unit', unitPlacementId: 9901, state: 'dead' }] }, 20),
      event(9913, { mode: 'all', conditions: [{ kind: 'object', objectId: 9902, state: 'intact' }] }, 30),
      event(9914, { mode: 'all', conditions: [{ kind: 'object', objectId: 9902, state: 'destroyed' }] }, 40),
    ]
    let state = initialState(); state.phase = 'combat'; state.spawnQueue = [{ kind: 'walker', delay: 100 }]; state.spawnTimer = 100
    const baseGold = state.gold
    state = tick(state, 0.1)
    check('事件条件：单位存活与物体未摧毁条件读取关卡实例状态', state.gold === baseGold + 40)
    state.allies = state.allies.filter(unit => unit.placementId !== 9901)
    state.defeatedUnitPlacementIds.push(9901)
    state.objects = state.objects.filter(object => object.id !== 9902)
    state = tick(state, 0.1)
    check('事件条件：单位死亡与物体摧毁后触发对应事件', state.gold === baseGold + 100)

    LEVEL.objects = [{ id: 9920, kind: 'rock', defId: 'object:rock', x: 8, y: 8, w: 1, h: 1, hp: -1, blockMove: false, blockProjectile: false, height: 0, state: 'default', events: [{ id: 1, name: '开启自身', trigger: 'interact', activationLimit: 1, cooldown: 0, conditions: { mode: 'all', conditions: [] }, actions: [{ type: 'setObjectState', objectId: 'source', state: 'open' }] }] }]
    LEVEL.initialUnits = [{ id: 9921, unitDefId: 'unit:uav', faction: 'ally', controller: 'static', x: 10.5, y: 8.5, events: [{ id: 1, name: '移除自身', trigger: 'interact', activationLimit: 1, cooldown: 0, conditions: { mode: 'all', conditions: [] }, actions: [{ type: 'unit', selector: { scope: 'source' }, command: { kind: 'remove' } }] }] }]
    LEVEL.events = []
    const setEventCenter = (game: GameState, x: number, y: number) => { const rect = fortressRect(game); game.fortress.x = x - rect.w / 2; game.fortress.y = y - rect.h / 2 }
    let sourceState = initialState(); sourceState.phase = 'combat'; sourceState.spawnQueue = [{ kind: 'walker', delay: 100 }]; sourceState.spawnTimer = 100; setEventCenter(sourceState, 9, 8.5)
    const sourceObjectActivated = interactWithObjectAt(sourceState, 8.5, 8.5)
    sourceState = tick(sourceState, 0.1)
    check('物体实例事件：事件来源物体可作为状态动作目标', sourceObjectActivated && sourceState.objectStates[9920] === 'open')
    const sourceUnitActivated = interactWithUnitAt(sourceState, 10.5, 8.5)
    sourceState = tick(sourceState, 0.1)
    check('单位实例事件：事件来源单位解析为真实运行时单位', sourceUnitActivated && sourceState.allies.some(unit => unit.placementId === 9921 && unit.hp <= 0))

    LEVEL.initialUnits = []
    LEVEL.objects = []
    LEVEL.events = [{ id: 9930, name: '并行防重入', category: 'flow', enabled: true, activationLimit: 0, cooldown: 0, conditions: { mode: 'all', conditions: [] }, trigger: { type: 'parallel' }, actions: [{ type: 'wait', seconds: 2 }] }]
    let parallelState = initialState(); parallelState.phase = 'combat'; parallelState.spawnQueue = [{ kind: 'walker', delay: 100 }]; parallelState.spawnTimer = 100
    for (let i = 0; i < 5; i++) parallelState = tick(parallelState, 0.1)
    check('并行事件：冷却为0时默认禁止动作序列重入', parallelState.unifiedEventStates.find(item => item.id === 9930)?.activations === 1 && parallelState.eventQueue.length === 1)
    check('事件监视器：持续阻塞只记录一次原因，不会逐帧刷满日志', parallelState.eventDebugLog.filter(log => log.eventId === 9930 && log.status === 'blocked').length === 1)

    const exactCells = ['2,2', '12,12']
    LEVEL.events = [{ id: 9931, name: '不规则区域刷怪', category: 'region', enabled: true, activationLimit: 1, cooldown: 0, conditions: { mode: 'all', conditions: [] }, trigger: { type: 'regionEnter', cells: exactCells }, actions: [{ type: 'spawn', enemies: { walker: 0, runner: 0, rusher: 0, brute: 0, flyer: 0 }, units: { 'unit:uav': 12 }, interval: 100 }] }]
    let regionState = initialState(); regionState.phase = 'combat'; regionState.spawnQueue = [{ kind: 'walker', delay: 100 }]; regionState.spawnTimer = 100; setEventCenter(regionState, 2.5, 2.5)
    regionState = tick(regionState, 0.1)
    check('不规则区域：刷怪点只落在实际选中格而非包围盒空洞', regionState.ambushQueue.length > 0 && regionState.ambushQueue.every(item => exactCells.includes(`${Math.floor(item.x)},${Math.floor(item.y)}`)))

    LEVEL.events = [
      { id: 9940, name: '调用方', category: 'flow', enabled: true, activationLimit: 1, cooldown: 0, conditions: { mode: 'all', conditions: [] }, trigger: { type: 'automatic' }, actions: [{ type: 'callEvent', eventId: 9941 }, { type: 'reward', gold: 3 }] },
      { id: 9941, name: '被调用事件', category: 'flow', enabled: false, activationLimit: 1, cooldown: 0, conditions: { mode: 'all', conditions: [] }, trigger: { type: 'automatic' }, actions: [{ type: 'wait', seconds: 0.2 }, { type: 'reward', gold: 7 }] },
    ]
    let callState = initialState(); callState.phase = 'combat'; callState.spawnQueue = [{ kind: 'walker', delay: 100 }]; callState.spawnTimer = 100
    const callGold = callState.gold
    callState = run(callState, 0.6)
    check('调用事件：等待被调用动作完成后返回调用方继续执行', callState.gold === callGold + 10 && callState.eventQueue.length === 0)
    check('事件监视器：直接调用次数与自动触发次数分开记录', callState.unifiedEventStates.find(item => item.id === 9941)?.callActivations === 1 && callState.unifiedEventStates.find(item => item.id === 9941)?.activations === 0)

    LEVEL.events = [{ id: 9942, name: '递归调用', category: 'flow', enabled: true, activationLimit: 1, cooldown: 0, conditions: { mode: 'all', conditions: [] }, trigger: { type: 'automatic' }, actions: [{ type: 'callEvent', eventId: 9942 }] }]
    let recursiveState = initialState(); recursiveState.phase = 'combat'; recursiveState.spawnQueue = [{ kind: 'walker', delay: 100 }]; recursiveState.spawnTimer = 100
    recursiveState = run(recursiveState, 2)
    check('调用事件：循环调用在8层后被阻止且事件队列能够结束', recursiveState.eventQueue.length === 0 && recursiveState.eventDebugLog.some(log => log.status === 'blocked' && log.detail.includes('调用深度')), JSON.stringify({ queue: recursiveState.eventQueue.map(item => ({ depth: item.callDepth, index: item.index, child: item.waitingChildSequenceId })), logs: recursiveState.eventDebugLog.slice(-5) }))

    const loopStage = defaultStage({ type: 'defend', waves: 99 }); loopStage.id = 'loop-stage'
    LEVEL.stages = [loopStage]; LEVEL.startStageId = loopStage.id; LEVEL.objective = structuredClone(loopStage.objective)
    LEVEL.events = [{ id: 9943, name: '回到当前阶段', category: 'flow', enabled: true, activationLimit: 1, cooldown: 0, conditions: { mode: 'all', conditions: [] }, trigger: { type: 'automatic' }, actions: [{ type: 'stageJump', stageId: loopStage.id }] }]
    let loopState = initialState(); loopState.phase = 'combat'; loopState.levelVariables['builtin:stageSuccess:loop-stage'] = true; loopState.levelVariables['builtin:stageFailure:loop-stage'] = true
    loopState = tick(loopState, 0.1)
    check('任务阶段回环：重新进入阶段时重置上一轮成功与失败标记', loopState.levelVariables['builtin:stageSuccess:loop-stage'] === false && loopState.levelVariables['builtin:stageFailure:loop-stage'] === false)

    const pulseStage = defaultStage({ type: 'survive', duration: 0.1 }); pulseStage.id = 'pulse-stage'; pulseStage.success = { type: 'stage', stageId: pulseStage.id }
    LEVEL.stages = [pulseStage]; LEVEL.startStageId = pulseStage.id; LEVEL.objective = structuredClone(pulseStage.objective)
    LEVEL.events = [{ id: 9945, name: '循环阶段成功脉冲', category: 'flow', enabled: true, activationLimit: 0, cooldown: 0, conditions: { mode: 'all', conditions: [] }, trigger: { type: 'stageSuccess', stageId: pulseStage.id }, actions: [{ type: 'reward', gold: 1 }] }]
    let pulseState = initialState(); pulseState.phase = 'combat'
    const pulseGold = pulseState.gold
    pulseState = run(pulseState, 0.5)
    check('任务阶段回环：同阶段成功事件可以在每轮结果后再次触发', (pulseState.unifiedEventStates.find(item => item.id === 9945)?.activations ?? 0) >= 2 && pulseState.gold >= pulseGold + 2)

    const invalidLevel = defaultLevel()
    invalidLevel.events = [{ id: 9944, name: '坏引用', category: 'region', enabled: true, activationLimit: 1, cooldown: 0, conditions: { mode: 'all', conditions: [] }, trigger: { type: 'regionEnter', cells: [] }, actions: [{ type: 'callEvent', eventId: 9999 }, { type: 'stageJump', stageId: 'missing' }] }]
    const validation = validateLevelReferences(invalidLevel)
    check('保存校验：识别空区域及失效事件、任务阶段引用', validation.filter(issue => issue.severity === 'error').length >= 3)
    check('保存校验：事件问题携带可定位的事件编号', validation.filter(issue => issue.severity === 'error').every(issue => issue.target.kind === 'event' && issue.target.eventId === 9944))

    const nestedCycleLevel = defaultLevel()
    nestedCycleLevel.events = [{ id: 9946, name: '嵌套循环', category: 'flow', enabled: true, activationLimit: 1, cooldown: 0, conditions: { mode: 'all', conditions: [] }, trigger: { type: 'automatic' }, actions: [{ type: 'choice', prompt: '继续？', options: [{ text: '是', actions: [{ type: 'callEvent', eventId: 9946 }] }] }] }]
    const nestedValidation = validateLevelReferences(nestedCycleLevel)
    check('保存校验：选择分支内的调用事件也参与循环引用检查', nestedValidation.some(issue => issue.severity === 'warning' && issue.message.includes('循环引用')))
    check('保存校验：循环警告可定位到对应事件', nestedValidation.some(issue => issue.severity === 'warning' && issue.target.kind === 'event' && issue.target.eventId === 9946))

    const invalidStageLevel = defaultLevel()
    invalidStageLevel.startStageId = 'missing-stage'
    const stageValidation = validateLevelReferences(invalidStageLevel)
    check('保存校验：任务阶段问题可定位到任务页', stageValidation.some(issue => issue.target.kind === 'mission'))

    const soundLevel = defaultLevel()
    soundLevel.events = [{ id: 9947, name: '音效引用', category: 'flow', enabled: true, activationLimit: 1, cooldown: 0, conditions: { mode: 'all', conditions: [] }, trigger: { type: 'automatic' }, actions: [{ type: 'sound', presetId: 'auto:environment:shot:test' }] }]
    const soundValidation = validateLevelReferences(soundLevel, undefined, new Set(['test']), new Set(), new Set(['auto:environment:shot:test']))
    check('保存校验：声音预设按预设ID校验，不会被误判为素材缺失', !soundValidation.some(issue => issue.severity === 'error'))

    const resizedLevel = defaultLevel(12, 20)
    resizedLevel.objects = [{ id: 9950, kind: 'rock', x: 19, y: 10, w: 2, h: 1, hp: 0, blockMove: false, blockProjectile: false, height: 0 }]
    resizedLevel.initialUnits = [{ id: 9951, unitDefId: 'unit:uav', faction: 'enemy', controller: 'ai', x: 20.5, y: 6 }]
    resizedLevel.events = [{ id: 9952, name: '越界区域', category: 'region', enabled: true, activationLimit: 1, cooldown: 0, conditions: { mode: 'all', conditions: [] }, trigger: { type: 'regionEnter', cells: ['19,11', '20,11'] }, actions: [{ type: 'reward', gold: 1 }] }]
    const resizedValidation = validateLevelReferences(resizedLevel)
    check('保存校验：物体、单位和事件区域越界会阻止保存', [
      resizedValidation.some(issue => issue.severity === 'error' && issue.target.kind === 'object' && issue.target.objectId === 9950),
      resizedValidation.some(issue => issue.severity === 'error' && issue.target.kind === 'unit' && issue.target.placementId === 9951),
      resizedValidation.some(issue => issue.severity === 'error' && issue.target.kind === 'event' && issue.target.eventId === 9952),
    ].every(Boolean))

    const visualOverflowLevel = defaultLevel(12, 20)
    visualOverflowLevel.baseTiles = [
      { x: 1, y: 1, source: 'independent', assetId: 'test', tileIndex: 0, flipX: false, rotation: 0 },
      { x: 20, y: 1, source: 'independent', assetId: 'test', tileIndex: 0, flipX: false, rotation: 0 },
    ]
    visualOverflowLevel.overlayTiles = [
      { x: 2, y: 2, source: 'independent', assetId: 'test', tileIndex: 0, flipX: false, rotation: 0 },
      { x: 2, y: 12, source: 'independent', assetId: 'test', tileIndex: 0, flipX: false, rotation: 0 },
    ]
    visualOverflowLevel.groundCells = ['3,3', '20,3']
    visualOverflowLevel.terrain = [
      { id: 9953, kind: 'puddle', x: 4, y: 4, w: 1, h: 1, moveModifier: 0.5 },
      { id: 9954, kind: 'puddle', x: 19, y: 5, w: 2, h: 1, moveModifier: 0.5 },
    ]
    const prunedVisualLevel = pruneVisualLayersOutsideBounds(visualOverflowLevel)
    check('保存清理：仅删除越界底图、装饰与地形，且不修改原草稿', prunedVisualLevel.baseTiles.length === 1 && prunedVisualLevel.overlayTiles.length === 1 && prunedVisualLevel.groundCells.length === 1 && prunedVisualLevel.terrain.length === 1 && visualOverflowLevel.baseTiles.length === 2 && visualOverflowLevel.terrain.length === 2)
  } finally {
    for (const key of Object.keys(LEVEL)) delete (LEVEL as unknown as Record<string, unknown>)[key]
    Object.assign(LEVEL, savedLevel)
    invalidateWallInfo()
  }
}

console.log('== v2.94：组合式 AI 投送兵力 ==')
{
  const savedLevel = structuredClone(LEVEL)
  const transportId = 'unit:sim-deploy-transport'
  const transportFortressId = 'sim-deploy-transport-fortress'
  const deployedUnitId = unitDefById(fortressUnitId('jeep')) ? fortressUnitId('jeep') : fortressUnitId(DEFAULT_FORTRESS.id)
  try {
    const transport = structuredClone(unitDefById(fortressUnitId('jeep')) ?? unitDefById(fortressUnitId('standard'))!)
    transport.id = transportId
    transport.name = '测试投送载具'
    transport.stats.vision = 100
    transport.stats.trackingVision = 100
    transport.combat = { profile: 'none', range: 0, interval: 1 }
    transport.ai = {
      preferredTarget: 'playerControlled', positioning: 'shortestRange', movement: 'closeIn',
      special: { profile: 'deployForces', unitDefId: deployedUnitId, count: 3, interval: 0.25, direction: 'right' },
    }
    check('投送配置：合法单位、总数、间隔和方向可通过单位定义校验', validateUnitDef(transport).length === 0, validateUnitDef(transport).join('；'))
    const invalidTransport = structuredClone(transport)
    invalidTransport.ai!.special = { profile: 'deployForces', unitDefId: transportId, count: 0, interval: 0, direction: 'diagonal' as 'front' }
    check('投送配置：拒绝投送自身及越界总数/间隔/方向', validateUnitDef(invalidTransport).filter(error => error.includes('投送')).length >= 4)
    const migratedTransport = normalizeKamikazeConfig({
      ...structuredClone(transport),
      ai: { ...structuredClone(transport.ai!), special: { profile: 'deployForces', unitDefId: deployedUnitId, count: 1, interval: 0.5, stopDistance: 8 } as never },
    })
    check('投送配置：旧停车距离被移除并默认迁移为车后投送', migratedTransport.ai?.special?.profile === 'deployForces'
      && migratedTransport.ai.special.direction === 'rear' && !('stopDistance' in migratedTransport.ai.special))
    const transportFortress = structuredClone(transport.legacy?.registry === 'fortress' ? transport.legacy.def : DEFAULT_FORTRESS)
    transportFortress.id = transportFortressId
    transportFortress.unitId = transportId
    transportFortress.name = transport.name
    transportFortress.unitTargetClasses = structuredClone(transport.targetClasses)
    transportFortress.unitCombat = transport.combat ? structuredClone(transport.combat) : undefined
    transportFortress.unitAI = transport.ai ? structuredClone(transport.ai) : undefined
    transportFortress.vision = 100
    transportFortress.trackingVision = 100
    transportFortress.unitBoss = transport.boss ? structuredClone(transport.boss) : undefined
    check('投送配置：单位模板可持久化特殊行为', saveCustomFortress(transportFortress)
      && unitDefById(transportId)?.ai?.special?.profile === 'deployForces')

    LEVEL.mode = 'defend'
    configureObjective(LEVEL, { type: 'defend', waves: 99 })
    LEVEL.events = []; LEVEL.triggers = []; LEVEL.interactables = []; LEVEL.objects = []
    LEVEL.initialUnits = [{ id: 9960, unitDefId: transportId, faction: 'neutralHostile', controller: 'ai', x: LEVEL.cols / 2, y: 3, behavior: 'approach', behaviorRange: 8, behaviorInterval: 1, behaviorSpeedPercent: 100, route: [], events: [] }]
    let state = initialState()
    state.turrets = []; state.phase = 'combat'; state.spawnQueue = [{ kind: 'walker', delay: 999 }]; state.spawnTimer = 999
    const hostId = state.enemies.find(enemy => enemy.placementId === 9960)!.id
    let completedDistance = Infinity
    for (let step = 0; step < 800; step++) {
      state = tick(state, 0.05)
      const host = state.enemies.find(enemy => enemy.id === hostId)
      if (!host) break
      if (host.deployForces?.complete) {
        completedDistance = fortressDistanceToPoint(state, host.x, host.y)
        break
      }
    }
    const hostAtDeploy = state.enemies.find(enemy => enemy.id === hostId)!
    const dropped = state.enemies.filter(enemy => enemy.unitDefId === deployedUnitId && enemy.id !== hostId)
    const transportRadius = Math.max(transport.stats.collisionRadiusX ?? transport.stats.size, transport.stats.collisionRadiusY ?? transport.stats.size)
    check('投送运行时：关卡实例行为存在时仍优先抵达几何外沿并按配置总数生成单位', hostAtDeploy.deployForces?.complete === true && dropped.length === 3
      && completedDistance - transportRadius <= 0.35, `complete=${hostAtDeploy.deployForces?.complete} count=${dropped.length} edgeDistance=${completedDistance - transportRadius}`)
    check('投送运行时：生成单位继承运输实例阵营并使用自身单位定义', dropped.every(enemy => enemy.faction === 'neutralHostile'
      && enemy.unitDefId === deployedUnitId && enemy.controller === 'ai'))
    check('投送运行时：合法落点不会与运输载具或彼此重叠', dropped.every((enemy, index) => {
      const others = [hostAtDeploy, ...dropped.filter((_, otherIndex) => otherIndex !== index)]
      return others.every(other => Math.hypot(enemy.x - other.x, enemy.y - other.y) > 0.3)
    }))
    const deployHeading = hostAtDeploy.vehicle?.heading ?? hostAtDeploy.initialHeading ?? 0
    const rightX = Math.cos(deployHeading), rightY = Math.sin(deployHeading)
    check('投送运行时：落点限制在配置的车右方向', dropped.every(enemy => (enemy.x - hostAtDeploy.x) * rightX + (enemy.y - hostAtDeploy.y) * rightY > 0.05))
    hostAtDeploy.behaviorOverride = { behavior: 'random', range: 4, interval: 0, speedPercent: 100 }
    hostAtDeploy.behaviorWait = 0
    hostAtDeploy.behaviorTargetX = undefined
    hostAtDeploy.behaviorTargetY = undefined
    hostAtDeploy.behaviorEngaged = false
    hostAtDeploy.targetId = null
    hostAtDeploy.targetKind = null
    hostAtDeploy.mode = 'move'
    state = tick(state, 0.05)
    const resumedHost = state.enemies.find(enemy => enemy.id === hostId)!
    check('投送运行时：完成后恢复运输单位原移动 AI', (resumedHost.behaviorStep ?? 0) > 0)

    LEVEL.initialUnits = [{ id: 9961, unitDefId: transportId, faction: 'enemy', controller: 'ai', x: LEVEL.cols / 2, y: 3, events: [] }]
    let blocked = initialState()
    blocked.turrets = []; blocked.phase = 'combat'; blocked.spawnQueue = [{ kind: 'walker', delay: 999 }]; blocked.spawnTimer = 999
    const blockedHost = blocked.enemies.find(enemy => enemy.placementId === 9961)!
    const blockedRect = fortressRect(blocked)
    blockedHost.x = blockedRect.x + blockedRect.w / 2
    blockedHost.y = blockedRect.y - transportRadius
    blocked.objects = [{ id: blocked.nextId++, kind: 'rock', x: 0, y: 0, w: LEVEL.cols, h: LEVEL.rows, hp: -1, maxHp: -1, blockMove: true, blockProjectile: false, height: 0 }]
    blocked = run(blocked, 0.8, 0.05)
    const waitingHost = blocked.enemies.find(enemy => enemy.id === blockedHost.id)!
    check('投送运行时：附近无合法空间时保持停车并重试，不丢失剩余数量', waitingHost.deployForces?.spawned === 0
      && waitingHost.deployForces.complete === false && waitingHost.deployForces.cooldown > 0)
    blocked.objects = []
    blocked = run(blocked, 0.8, 0.05)
    check('投送运行时：空间恢复后继续投送', blocked.enemies.some(enemy => enemy.unitDefId === deployedUnitId))

    const allyTransport = structuredClone(transport)
    allyTransport.ai!.preferredTarget = 'allHostile'
    if (allyTransport.ai?.special?.profile === 'deployForces') {
      allyTransport.ai.special.count = 1
      allyTransport.ai.special.direction = 'rear'
    }
    transportFortress.unitAI = structuredClone(allyTransport.ai!)
    saveCustomFortress(transportFortress)
    LEVEL.initialUnits = [
      { id: 9962, unitDefId: transportId, faction: 'ally', controller: 'ai', x: 8, y: 4, events: [] },
      { id: 9963, unitDefId: deployedUnitId, faction: 'enemy', controller: 'static', x: 12, y: 4, events: [] },
    ]
    let allied = initialState()
    allied.turrets = []; allied.phase = 'combat'; allied.spawnQueue = [{ kind: 'walker', delay: 999 }]; allied.spawnTimer = 999
    allied = run(allied, 12, 0.05)
    check('投送运行时：友方实例复用同一状态机并生成友方单位', allied.allies.some(unit => unit.placementId === 9962 && unit.deployForces?.complete)
      && allied.allies.some(unit => unit.placementId === undefined && unit.unitDefId === deployedUnitId && unit.faction === 'ally'))
  } finally {
    deleteCustomFortress(transportFortressId)
    for (const key of Object.keys(LEVEL)) delete (LEVEL as unknown as Record<string, unknown>)[key]
    Object.assign(LEVEL, savedLevel)
    invalidateWallInfo()
  }
}

console.log('== 堡垒库版本兼容 ==')
check('堡垒库 v8 存档可在 v9 启动时载入迁移', isSupportedFortressLibVersion(8) && isSupportedFortressLibVersion(9))
check('堡垒库拒绝无效及未来版本', !isSupportedFortressLibVersion(0) && !isSupportedFortressLibVersion(11) && !isSupportedFortressLibVersion('8'))

console.log('== 自定义载具单一数据源与删除闭环 ==')
{
  const fortressId = 'sim-single-source-armor'
  const unitId = 'unit:sim-single-source-armor'
  const physical = structuredClone(DEFAULT_FORTRESS)
  physical.id = fortressId
  physical.unitId = unitId
  physical.name = '装甲车'
  physical.hp = 777
  physical.speed = 4.5
  physical.chassis = 'wheeled'
  physical.wheelbase = 2.4
  physical.unitAI = { preferredTarget: 'allHostile', positioning: 'shortestRange', movement: 'closeIn', special: { profile: 'none' } }
  saveCustomFortress(physical)

  const stale = structuredClone(unitDefById(fortressUnitId(DEFAULT_FORTRESS.id))!)
  stale.id = unitId
  stale.name = '装甲车'
  stale.stats.hp = DEFAULT_FORTRESS.hp
  stale.ai = { targeting: { profile: 'antiVehicle' }, movement: { profile: 'rangeEdge' }, attack: { profile: 'none' } }
  stale.boss = { enabled: true, displayName: '装甲车首领', hpScale: 2, sizeScale: 1.2, phases: [], defeatActions: [] }
  importUnitLibrary({ version: unitLibraryForExport().version, customs: [stale] })
  check('载具旧快照注入：迁移前确实会覆盖为测试堡垒耐久', unitDefById(unitId)?.stats.hp === DEFAULT_FORTRESS.hp)
  check('载具旧数据迁移：发现并迁移重复 UnitDef', migrateLegacyCustomVehicleUnits() === 1)
  const migrated = unitDefById(unitId)!
  check('载具唯一数据源：保留装甲车物理参数而不再套用测试堡垒', migrated.stats.hp === 777 && migrated.stats.speed === 4.5 && unitTypeConfig(migrated)?.kind === 'vehicle' && unitTypeConfig(migrated)?.chassis === 'wheeled')
  check('载具唯一数据源：AI 与 Boss 元数据迁回 FortressDef', migrated.ai?.preferredTarget === 'allHostile'
    && migrated.ai?.positioning === 'longestRange' && migrated.ai?.movement === 'orbit'
    && migrated.boss?.displayName === '装甲车首领')
  check('载具唯一数据源：单位库不再保存任何完整载具记录', !unitLibraryForExport().customs.some(unit => unit.type === 'vehicle'))
  check('载具保存闸：禁止再次向 UnitDef 库写入载具副本', !saveCustomUnitDef(structuredClone(migrated)))

  const renamed = structuredClone(migrated)
  renamed.name = '装甲侦察车'
  renamed.ai = { preferredTarget: 'playerControlled', positioning: 'shortestRange', movement: 'closeIn', special: { profile: 'none' } }
  check('载具重命名/AI 保存：写回唯一 FortressDef 并保持单位 ID', saveVehicleUnitDefinition(renamed)
    && FORTRESS_DEFS.find(item => item.id === fortressId)?.name === '装甲侦察车'
    && unitDefById(unitId)?.ai?.preferredTarget === 'playerControlled'
    && unitDefById(unitId)?.ai?.movement === 'closeIn')

  const invalid = structuredClone(unitDefById(unitId)!)
  invalid.id = 'unit:missing-vehicle-ref'
  if (invalid.legacy?.registry === 'fortress') invalid.legacy.id = 'missing-fortress-ref'
  check('载具失效引用：明确拒绝保存且不回退覆盖测试堡垒', !saveVehicleUnitDefinition(invalid) && DEFAULT_FORTRESS.hp === 2000)

  const references = defaultLevelLibrary()
  const entry = references.levels[0]
  entry.deployableFortressIds = [fortressId]
  entry.level.initialUnits = [{ id: 7001, unitDefId: unitId, faction: 'enemy', controller: 'ai', x: 5, y: 5, events: [] }]
  entry.level.stages[0].waves = [{ id: 'single-source-wave', name: '测试波次', entries: [{ id: 'single-source-entry', unitDefId: unitId, count: 1, delay: 0, interval: 0 }] }]
  entry.level.events = [{ id: 7002, name: '测试事件', category: 'flow', enabled: true, activationLimit: 1, cooldown: 0, conditions: { mode: 'all', conditions: [] }, trigger: { type: 'missionStart' }, actions: [
    { type: 'spawn', enemies: { walker: 0, runner: 0, rusher: 0, brute: 0, flyer: 0 }, units: { [unitId]: 2 }, interval: 0 },
    { type: 'boss', boss: { kind: 'brute', unitDefId: unitId, name: '测试', hpScale: 1, sizeScale: 1, phases: [], defeatActions: [] } },
    { type: 'unit', selector: { scope: 'unitDef', unitDefId: unitId }, command: { kind: 'remove' } },
  ] }]
  const cleaned = removeUnitDefinitionReferences(references, unitId, fortressId)
  check('载具删除清理：初始单位、波次、事件与备选出战引用同步移除', cleaned >= 6
    && entry.level.initialUnits.length === 0
    && entry.level.stages[0].waves[0].entries.length === 0
    && entry.level.events[0].actions.length === 1
    && !entry.deployableFortressIds)

  setSelectedFortressId(fortressId)
  check('载具统一删除：载具定义、旧单位记录与当前选择同时清理', deleteCustomVehicleDefinition(fortressId, unitId)
    && !FORTRESS_DEFS.some(item => item.id === fortressId)
    && !unitLibraryForExport().customs.some(unit => unit.id === unitId)
    && getSelectedFortressId() === DEFAULT_FORTRESS.id)
}

console.log('== 气垫载具首版 ==')
{
  const savedLevel = structuredClone(LEVEL)
  const previousFortressId = getSelectedFortressId()
  const fortressId = 'sim-hovercraft'
  const unitId = fortressUnitId(fortressId)
  try {
    const hover = structuredClone(DEFAULT_FORTRESS)
    hover.id = fortressId
    hover.unitId = unitId
    hover.name = '测试气垫载具'
    hover.chassis = 'hovercraft'
    hover.w = 1
    hover.h = 1
    hover.shape = ['0,0']
    hover.interior = { cols: 1, rows: 1 }
    hover.interiorCells = ['0,0']
    hover.hardpoints = []
    hover.effects = []
    hover.tracks = undefined
    hover.wheels = undefined
    hover.speed = 4
    hover.accel = 12
    hover.turnSpeed = 120
    hover.hoverDrag = 0.35
    hover.hoverGrip = 0.8
    check('气垫定义：合法参数通过堡垒校验', validateFortressDef(hover).length === 0, validateFortressDef(hover).join('；'))
    const invalidHover = structuredClone(hover)
    invalidHover.hoverDrag = 0
    invalidHover.hoverGrip = 11
    check('气垫定义：滑行阻力与横向稳定范围受保存校验保护', validateFortressDef(invalidHover).some(error => error.includes('气垫滑行阻力'))
      && validateFortressDef(invalidHover).some(error => error.includes('气垫横向稳定')))
    saveCustomFortress(hover)
    setSelectedFortressId(fortressId)
    const stored = FORTRESS_DEFS.find(def => def.id === fortressId)!
    check('气垫存档：保留独立底盘类型与参数并清理履带轮胎', stored.chassis === 'hovercraft'
      && stored.hoverDrag === 0.35 && stored.hoverGrip === 0.8 && !stored.tracks && !stored.wheels)
    const unit = unitDefById(unitId)!
    const typeConfig = unitTypeConfig(unit)
    check('气垫单位协议：动态单位适配器读取同一载具定义', typeConfig?.kind === 'vehicle'
      && typeConfig.chassis === 'hovercraft' && typeConfig.hoverDrag === 0.35 && typeConfig.hoverGrip === 0.8)

    const drift = hoverVelocityStep(0, -4, Math.PI / 2, 4, 12, 0.35, 0.8, 0.1)
    check('气垫运动：车身转向后保留原速度方向并逐步产生甩尾', drift.vx > 0.5 && drift.vy < -3.5, JSON.stringify(drift))
    const coast = hoverVelocityStep(0, -4, 0, 0, 12, 0.35, 0.8, 1)
    check('气垫运动：松开推进后低摩擦滑行而非立即停下', Math.hypot(coast.vx, coast.vy) > 2.5 && Math.hypot(coast.vx, coast.vy) < 4, JSON.stringify(coast))

    LEVEL.objects = []
    LEVEL.terrain = [{ kind: 'puddle', x: 0, y: 0, w: LEVEL.cols, h: LEVEL.rows, moveModifier: 0.05 }]
    LEVEL.buildCells = []
    LEVEL.core = null
    LEVEL.initialUnits = []
    LEVEL.events = []
    LEVEL.triggers = []
    LEVEL.interactables = []
    LEVEL.startZone = { x: 8, y: 14, w: 1, h: 1 }
    configureObjective(LEVEL, { type: 'defend', waves: 99 })
    let player = initialState()
    player.phase = 'prep'
    const startY = player.fortress.y
    player.moveDir = { x: 0, y: -1 }
    player = run(player, 1, 0.05)
    check('气垫玩家运动：无视地形移动倍率', startY - player.fortress.y > 2.5, `distance=${startY - player.fortress.y}`)

    LEVEL.terrain = []
    LEVEL.objects = [{ id: 9910, kind: 'rock', x: 8, y: 12, w: 1, h: 1, hp: -1, blockMove: true, blockProjectile: false, height: 1 }]
    let lowBarrier = initialState()
    lowBarrier.phase = 'prep'
    lowBarrier.moveDir = { x: 0, y: -1 }
    lowBarrier = run(lowBarrier, 1.2, 0.05)
    check('气垫玩家碰撞：可越过高度 1 的移动阻挡物', lowBarrier.fortress.y < 12, `y=${lowBarrier.fortress.y}`)

    LEVEL.objects = [{ id: 9911, kind: 'rock', x: 8, y: 12, w: 1, h: 1, hp: -1, blockMove: true, blockProjectile: false, height: 2 }]
    let highBarrier = initialState()
    highBarrier.phase = 'prep'
    highBarrier.moveDir = { x: 0, y: -1 }
    highBarrier = run(highBarrier, 1.2, 0.05)
    check('气垫玩家碰撞：高度 2 及以上仍会阻挡移动', highBarrier.fortress.y >= 13 - 1e-6, `y=${highBarrier.fortress.y}`)

    LEVEL.objects = [{ id: 9912, kind: 'rock', x: 8, y: 8, w: 1, h: 1, hp: -1, blockMove: true, blockProjectile: false, height: 1 }]
    LEVEL.initialUnits = [{ id: 9913, unitDefId: unitId, faction: 'enemy', controller: 'static', x: 8.5, y: 10.5, events: [] }]
    const aiState = initialState()
    const ai = aiState.enemies.find(enemy => enemy.placementId === 9913)!
    for (let step = 0; step < 40; step++) moveUnitVehicleToward(aiState, ai, unit, 8.5, 6.5, 0.05)
    check('气垫 AI 运动：复用惯性运动并可越过高度 1 物体', ai.y < 8, `y=${ai.y}`)
  } finally {
    deleteCustomFortress(fortressId)
    setSelectedFortressId(previousFortressId)
    for (const key of Object.keys(LEVEL)) delete (LEVEL as unknown as Record<string, unknown>)[key]
    Object.assign(LEVEL, savedLevel)
    invalidateWallInfo()
  }
}

console.log('== 步行机甲首版 ==')
{
  const savedLevel = structuredClone(LEVEL)
  const previousFortressId = getSelectedFortressId()
  const fortressId = 'sim-walker-mech'
  const unitId = fortressUnitId(fortressId)
  const bodyAsset = addAsset('Mech01_body', 'data:image/png;base64,AA==', 'vehicle')
  const footAsset = addAsset('Mech01_foot', 'data:image/png;base64,AA==', 'vehicle')
  try {
    const walker = structuredClone(DEFAULT_FORTRESS)
    walker.id = fortressId
    walker.unitId = unitId
    walker.name = '测试步行机甲'
    walker.chassis = 'walker'
    walker.w = 1
    walker.h = 1
    walker.shape = ['0,0']
    walker.interior = { cols: 1, rows: 1 }
    walker.interiorCells = ['0,0']
    const walkerTurret = TURRET_DEFS.find(def => def.mount === 'S' && def.canGround && def.type === 'direct')!
    walker.hardpoints = [{ id: 'hidden-art', x: 0.5, y: 0.5, size: 'S', hidden: true, builtIn: walkerTurret.id }]
    walker.effects = []
    walker.tracks = undefined
    walker.wheels = undefined
    walker.speed = 3
    walker.accel = 6
    walker.turnSpeed = 180
    walker.brakeInertia = 5
    walker.walkerFrames = 6
    walker.walkerFps = 10
    walker.spriteBody = bodyAsset.id
    walker.walkerLowerAsset = footAsset.id
    walker.walkerLowerOffsetX = 3
    walker.walkerLowerOffsetY = -2
    walker.bodyCollision = {
      source: `${bodyAsset.id}#walker:0,0`, widthPx: 64, heightPx: 64,
      points: [{ x: -1, y: -1 }, { x: 1, y: -1 }, { x: 1, y: 1 }, { x: -1, y: 1 }],
    }
    check('步行机甲定义：合法参数通过堡垒校验', validateFortressDef(walker).length === 0, validateFortressDef(walker).join('；'))
    const invalidWalker = structuredClone(walker)
    invalidWalker.walkerStride = 0.01
    invalidWalker.walkerBodyOffsetX = 600
    check('步行机甲定义：步幅与主体坐标修正受保存校验保护', validateFortressDef(invalidWalker).some(error => error.includes('步幅'))
      && validateFortressDef(invalidWalker).some(error => error.includes('主体 X 坐标修正')))

    saveCustomFortress(walker)
    setSelectedFortressId(fortressId)
    const stored = FORTRESS_DEFS.find(def => def.id === fortressId)!
    check('步行机甲旧双层迁移：旧下半身序列提升为唯一主体且移除配对字段', stored.spriteBody === footAsset.id
      && stored.walkerLowerAsset === undefined && stored.walkerLowerOffsetX === undefined && stored.walkerLowerOffsetY === undefined)
    check('步行机甲 2×7 迁移：旧 2×6 首帧碰撞轮廓失效并等待按新首帧重建', stored.bodyCollision === undefined)
    check('步行机甲存档：旧帧率迁移为步幅并清理其他底盘参数', stored.chassis === 'walker'
      && Math.abs((stored.walkerStride ?? 0) - 2.1) < 1e-9
      && stored.walkerFrameDuration === undefined
      && stored.walkerBodyOffsetX === 3 && stored.walkerBodyOffsetY === -2 && !stored.tracks && !stored.wheels
      && stored.turnRadius === undefined && stored.trackWidth === undefined && stored.wheelbase === undefined
      && stored.hoverDrag === undefined && stored.pitchGain === undefined && stored.leanCap === undefined)
    check('炮位迁移：旧隐藏炮位转为只隐藏炮塔素材', stored.hardpoints[0]?.hideTurretArt === true && stored.hardpoints[0]?.hidden === undefined)
    const unit = unitDefById(unitId)!
    const typeConfig = unitTypeConfig(unit)
    check('步行机甲单位协议：动态单位适配器读取同一载具定义', typeConfig?.kind === 'vehicle'
      && typeConfig.chassis === 'walker' && Math.abs(typeConfig.walkerStride - 2.1) < 1e-9)
    check('步行机甲单层主体：实际位移按步幅驱动 2×7 的 14 帧循环', walkerFrameCount(stored) === 14
      && walkerFrameIndex(stored, 0) === 0 && walkerFrameIndex(stored, 0.61) === 2
      && walkerFrameIndex(stored, 2.11) === 7 && walkerFrameIndex(stored, 3.91) === 13)

    const turnFirst = walkerMotionStep(0, 0, 0, Math.PI / 2, 3, 6, 5, 90, 0.1)
    check('步行机甲运动：大角度指令先转身且不会横向漂移', turnFirst.heading > 0 && turnFirst.speed === 0 && turnFirst.vx === 0 && turnFirst.vy === 0, JSON.stringify(turnFirst))
    const aligned = walkerMotionStep(0, 0, 0, 0, 3, 6, 5, 180, 0.1)
    check('步行机甲运动：朝向对齐后按加速度沿机体前方起步', aligned.speed > 0 && Math.abs(aligned.vx) < 1e-8 && aligned.vy < 0, JSON.stringify(aligned))
    const braking = walkerMotionStep(aligned.vx, aligned.vy, aligned.heading, aligned.heading, 0, 6, 5, 180, 0.1)
    check('步行机甲运动：松开输入后按刹停惯性减速', braking.speed >= 0 && braking.speed < aligned.speed, JSON.stringify(braking))
    const turnGait: { walkPhase?: number; walkSettleTarget?: number; walkSettleBlend?: number } = { walkPhase: 0 }
    const turnFootfall = advanceWalkerAnimation(turnGait, 2.1, 0, Math.PI / 2, 0.1)
    check('步行机甲步态：原地转向会推进低速步态并产生一次交替落脚', Math.abs((turnGait.walkPhase ?? 0) - 2.1) < 1e-9
      && turnFootfall.turningInPlace && turnFootfall.footfalls.length === 1)
    const settling: { walkPhase?: number; walkSettleTarget?: number; walkSettleBlend?: number } = { walkPhase: 0.8 }
    let settleFootfalls = 0
    for (let i = 0; i < 8; i++) settleFootfalls += advanceWalkerAnimation(settling, 2.1, 0, 0, 0.05).footfalls.length
    check('步行机甲停步：补完当前半步后淡回待机帧且只触发落脚一次', settling.walkPhase === 0
      && settling.walkSettleTarget === undefined && settling.walkSettleBlend === undefined && settleFootfalls === 1, JSON.stringify(settling))

    LEVEL.objects = []
    LEVEL.terrain = []
    LEVEL.buildCells = []
    LEVEL.core = null
    LEVEL.initialUnits = []
    LEVEL.events = []
    LEVEL.triggers = []
    LEVEL.interactables = []
    LEVEL.startZone = { x: 8, y: 14, w: 1, h: 1 }
    configureObjective(LEVEL, { type: 'defend', waves: 99 })
    let clearGround = initialState()
    clearGround.phase = 'prep'
    clearGround.moveDir = { x: 0, y: -1 }
    clearGround.desiredHeading = 0
    const clearStartY = clearGround.fortress.y
    clearGround = run(clearGround, 1, 0.05)
    const clearDistance = clearStartY - clearGround.fortress.y
    check('步行机甲玩家运动：腿部动画相位等于实际移动距离', clearDistance > 1
      && Math.abs((clearGround.fortress.walkPhase ?? 0) - clearDistance) < 0.05,
      `distance=${clearDistance}, phase=${clearGround.fortress.walkPhase}`)

    LEVEL.terrain = [{ kind: 'puddle', x: 0, y: 0, w: LEVEL.cols, h: LEVEL.rows, moveModifier: 0.25 }]
    let slowed = initialState()
    slowed.phase = 'prep'
    slowed.moveDir = { x: 0, y: -1 }
    slowed.desiredHeading = 0
    const slowedStartY = slowed.fortress.y
    slowed = run(slowed, 1, 0.05)
    check('步行机甲玩家运动：仍受地形移动倍率影响', slowedStartY - slowed.fortress.y < clearDistance * 0.6,
      `clear=${clearDistance}, slowed=${slowedStartY - slowed.fortress.y}`)

    LEVEL.terrain = []
    LEVEL.objects = [{ id: 9920, kind: 'rock', x: 8, y: 12, w: 1, h: 1, hp: -1, blockMove: true, blockProjectile: false, height: 1 }]
    let lowBarrier = initialState()
    lowBarrier.phase = 'prep'
    lowBarrier.moveDir = { x: 0, y: -1 }
    lowBarrier.desiredHeading = 0
    lowBarrier = run(lowBarrier, 1.5, 0.05)
    check('步行机甲玩家碰撞：可跨越高度 1 的移动阻挡物', lowBarrier.fortress.y < 12, `y=${lowBarrier.fortress.y}`)

    LEVEL.objects = [{ id: 9921, kind: 'rock', x: 8, y: 12, w: 1, h: 1, hp: -1, blockMove: true, blockProjectile: false, height: 2 }]
    let highBarrier = initialState()
    highBarrier.phase = 'prep'
    highBarrier.moveDir = { x: 0, y: -1 }
    highBarrier.desiredHeading = 0
    highBarrier = run(highBarrier, 1.5, 0.05)
    check('步行机甲玩家碰撞：高度 2 及以上仍会阻挡移动', highBarrier.fortress.y >= 13 - 1e-6, `y=${highBarrier.fortress.y}`)

    LEVEL.objects = [{ id: 9922, kind: 'rock', x: 8, y: 8, w: 1, h: 1, hp: -1, blockMove: true, blockProjectile: false, height: 1 }]
    LEVEL.initialUnits = [{ id: 9923, unitDefId: unitId, faction: 'enemy', controller: 'static', x: 8.5, y: 10.5, events: [] }]
    const aiState = initialState()
    const ai = aiState.enemies.find(enemy => enemy.placementId === 9923)!
    let maxAiWalkPhase = 0
    for (let step = 0; step < 80; step++) {
      moveUnitVehicleToward(aiState, ai, unit, 8.5, 6.5, 0.05)
      maxAiWalkPhase = Math.max(maxAiWalkPhase, ai.vehicle?.walkPhase ?? 0)
    }
    check('步行机甲 AI 运动：复用同一转身/行走求解并跨越高度 1 物体', ai.y < 8 && maxAiWalkPhase > 0,
      `y=${ai.y}, maxPhase=${maxAiWalkPhase}`)

    LEVEL.objects = []
    LEVEL.startZone = { x: Math.max(0, LEVEL.cols - 3), y: Math.max(0, LEVEL.rows - 3), w: 1, h: 1 }
    LEVEL.initialUnits = [{
      id: 9924,
      unitDefId: unitId,
      faction: 'enemy',
      controller: 'ai',
      x: 1.5,
      y: 1.5,
      behavior: 'guard',
      events: [],
    }]
    let retaliationState = initialState()
    retaliationState.phase = 'combat'
    retaliationState.spawnQueue = [{ kind: 'walker', delay: 100 }]
    retaliationState.spawnTimer = 100
    const retaliatingWalker = retaliationState.enemies.find(enemy => enemy.placementId === 9924)!
    const retaliationPlayer = fortressCenter(retaliationState)
    const retaliationDistanceBefore = Math.hypot(retaliatingWalker.x - retaliationPlayer.x, retaliatingWalker.y - retaliationPlayer.y)
    damageEnemy(retaliationState, retaliatingWalker, 1, 992400)
    const longRangeMemory = retaliatingWalker.retaliationUntil ?? 0
    retaliationState = run(retaliationState, UNIT_RETALIATION_MEMORY_SECONDS + 1, 0.05)
    const walkerAfterRetaliation = retaliationState.enemies.find(enemy => enemy.placementId === 9924)
    const retaliationDistanceAfter = walkerAfterRetaliation
      ? Math.hypot(walkerAfterRetaliation.x - retaliationPlayer.x, walkerAfterRetaliation.y - retaliationPlayer.y)
      : Infinity
    check('步行机甲受击反击：远距离记忆动态延长并持续锁定玩家接近', longRangeMemory - retaliationState.time > 0
      && walkerAfterRetaliation?.retaliationSide === 'fortress'
      && walkerAfterRetaliation.targetKind === 'fortress' && retaliationDistanceAfter < retaliationDistanceBefore - 0.05,
    `before=${retaliationDistanceBefore.toFixed(2)}, after=${retaliationDistanceAfter.toFixed(2)}, memory=${longRangeMemory.toFixed(2)}, target=${walkerAfterRetaliation?.targetKind}`)
    const retaliationTurretId = walkerAfterRetaliation?.vehicle?.turrets?.[0]?.id
    let retaliationFired = false
    for (let step = 0; step < 600 && !retaliationFired; step++) {
      retaliationState = tick(retaliationState, 0.05)
      retaliationFired = retaliationTurretId !== undefined && (retaliationState.muzzles.some(muzzle => muzzle.turretId === retaliationTurretId)
        || retaliationState.enemyProjectiles.some(projectile => projectile.shooterId === retaliationTurretId))
    }
    const finalWalker = retaliationState.enemies.find(enemy => enemy.placementId === 9924)
    const finalTurret = finalWalker?.vehicle?.turrets?.find(turret => turret.id === retaliationTurretId)
    check('步行机甲受击反击：追入射程后预装炮塔实际开火', retaliationFired,
      `turret=${retaliationTurretId}, time=${retaliationState.time.toFixed(2)}, distance=${finalWalker ? Math.hypot(finalWalker.x - retaliationPlayer.x, finalWalker.y - retaliationPlayer.y).toFixed(2) : 'missing'}, target=${finalWalker?.targetKind}:${finalWalker?.targetId}, retaliationUntil=${finalWalker?.retaliationUntil?.toFixed(2)}, turretTarget=${finalTurret?.targetId}, cooldown=${finalTurret?.cooldown.toFixed(2)}`)

    clearGround.moveDir = { x: 0, y: 0 }
    clearGround.desiredHeading = null
    clearGround = run(clearGround, 2, 0.05)
    check('步行机甲动画：停稳后复位到静止帧', Math.hypot(clearGround.fortress.vx, clearGround.fortress.vy) < 0.01
      && (clearGround.fortress.walkPhase ?? 0) === 0, JSON.stringify({ vx: clearGround.fortress.vx, vy: clearGround.fortress.vy, phase: clearGround.fortress.walkPhase }))
  } finally {
    deleteCustomFortress(fortressId)
    removeAsset(bodyAsset.id)
    removeAsset(footAsset.id)
    setSelectedFortressId(previousFortressId)
    for (const key of Object.keys(LEVEL)) delete (LEVEL as unknown as Record<string, unknown>)[key]
    Object.assign(LEVEL, savedLevel)
    invalidateWallInfo()
  }
}

console.log('== 战车整备预设 ==')
{
  const fortress = FORTRESS_DEFS.find(item => item.hardpoints.some(hardpoint => !hardpoint.builtIn))!
  const hardpoint = fortress.hardpoints.find(item => !item.builtIn)!
  const turret = TURRET_DEFS.find(item => item.mount === hardpoint.size && (!hardpoint.types || hardpoint.types.includes(item.type)))!
  const blank: VehicleLoadoutPreset = {
    id: 'sim-loadout', name: '模拟整备', fortressDefId: fortress.id, turrets: [], modules: [],
  }
  const modulePlacement = MODULE_DEFS.flatMap(def => firstLoadoutModulePlacement(fortress, [], def.id) ?? [])[0]
  const equipped: VehicleLoadoutPreset = {
    ...blank,
    turrets: [{ hardpointId: hardpoint.id, turretDefId: turret.id }],
    modules: modulePlacement ? [modulePlacement] : [],
  }
  const normalized = normalizeVehicleLoadout(equipped)
  check('整备预设校验：保留兼容炮位和合法模块', normalized?.turrets.length === 1 && normalized.modules.length === equipped.modules.length)
  const blankStats = vehicleLoadoutStats(blank)
  const equippedStats = vehicleLoadoutStats(equipped)
  check('整备参数：只需用当前值与已保存值求变化量', equippedStats.firepower > blankStats.firepower,
    `before=${blankStats.firepower}, current=${equippedStats.firepower}`)
  const state = initialState(equipped)
  check('整备出战：预设载具成为玩家战车', state.fortressDefId === fortress.id)
  check('整备出战：预装炮塔进入统一炮塔战斗实例', state.turrets.some(item => item.hardpointId === hardpoint.id && item.defId === turret.id && item.builtIn === false))
  check('整备出战：预装模块进入统一模块实例', state.modules.length === equipped.modules.length)
  check('整备出战：模块加成已同步到初始结构上限', state.fortress.maxHp === fortressMaxHp(state) && state.fortress.hp === state.fortress.maxHp)

  check('装配分：炮塔与模块按各自定义计入总分', vehicleLoadoutAssemblyPoints(equipped) === turretAssemblyPoints(turret)
    + (modulePlacement ? moduleAssemblyPoints(MODULE_DEFS.find(item => item.id === modulePlacement.defId)!) : 0))
  const parsedLevel = parseLevel(JSON.stringify({ ...defaultLevel(), assemblyPointLimit: 17 }))
  check('关卡装配分上限：可保存并解析', parsedLevel.assemblyPointLimit === 17)

  const replaceableHardpoint = fortress.hardpoints.find(item => item.size === 'S' && (!item.types || item.types.includes('direct')))
  const builtInTurret = TURRET_DEFS.find(item => item.mount === replaceableHardpoint?.size && (!replaceableHardpoint?.types || replaceableHardpoint.types.includes(item.type)))
  const alternateTurret = TURRET_DEFS.find(item => item.mount === replaceableHardpoint?.size && item.id !== builtInTurret?.id && (!replaceableHardpoint?.types || replaceableHardpoint.types.includes(item.type)))
  if (replaceableHardpoint && builtInTurret && alternateTurret) {
    const previousBuiltIn = replaceableHardpoint.builtIn
    replaceableHardpoint.builtIn = builtInTurret.id
    try {
      const combatBefore = initialState({ ...blank, turrets: [], modules: [] })
      const combatDraft: VehicleLoadoutPreset = {
        ...blank,
        turrets: [{ hardpointId: replaceableHardpoint.id, turretDefId: alternateTurret.id }],
        modules: modulePlacement ? [modulePlacement] : [],
      }
      check('战斗整备校验：模板预装炮位可由草稿显式接管', normalizeCombatVehicleLoadout(combatDraft)?.turrets.length === 1)
      const overLimit = Math.max(0, vehicleLoadoutAssemblyPoints(combatDraft) - 1)
      check('战斗整备提交：超过关卡装配分时拒绝变更', applyCombatLoadout(combatBefore, combatDraft, overLimit) === combatBefore)
      const combatAfter = applyCombatLoadout(combatBefore, combatDraft, vehicleLoadoutAssemblyPoints(combatDraft))
      check('战斗整备提交：预装炮塔可被替换并转为普通可替换实例', combatAfter !== combatBefore
        && combatAfter.turrets.some(item => item.hardpointId === replaceableHardpoint.id && item.defId === alternateTurret.id && item.builtIn === false))
      check('战斗整备提交：模块草稿同步为当前战车装备', combatAfter.modules.length === combatDraft.modules.length)
    } finally {
      replaceableHardpoint.builtIn = previousBuiltIn
    }
  }
}

console.log('== 导弹拦截首版 ==')
{
  const state = fresh()
  const fortressHp = state.fortress.hp
  const rocket: EnemyProjectile = {
    id: state.nextId++, shooterId: 70001,
    x: 8, y: 8, px: 7.5, py: 8, heading: Math.PI / 2,
    speed: 20, damage: 9999, penetration: 9999,
    traveled: 10, maxTravel: 100,
    kind: 'missile', ammoId: 'rocket_std', sourceSide: 'enemy', sourceFaction: 'enemy',
    sourceAltitude: 0, targetAltitude: 0, altitudeTravelM: 20,
  }
  const allyRocket: EnemyProjectile = {
    ...structuredClone(rocket), id: state.nextId++, y: 9, py: 9,
    sourceSide: 'ally', sourceFaction: 'ally',
  }
  state.enemyProjectiles.push(rocket, allyRocket)
  const playerTargets = interceptableMissileTargets(state, 'player')
  check('导弹拦截阵营：玩家只取得敌对导弹，不会拦截友军导弹', playerTargets.length === 1 && playerTargets[0].id === rocket.id)
  check('导弹拦截配置：标准火箭读取独立拦截耐久', playerTargets[0]?.maxHp === 20 && playerTargets[0]?.hp === 20)
  const firstDestroyed = applyMissileInterceptionDamage(state, 'unit', rocket.id, 5)
  check('导弹拦截伤害：未归零时累计耐久且导弹继续存在', !firstDestroyed && rocket.interceptHp === 15 && !rocket.intercepted)
  const explosionBefore = state.explosions.length
  const destroyed = applyMissileInterceptionDamage(state, 'unit', rocket.id, 15)
  check('导弹拦截伤害：耐久归零后标记空爆销毁', destroyed && rocket.intercepted === true && state.explosions.length === explosionBefore + 1)
  check('导弹拦截表现：空爆事件不会留下地面弹坑', state.explosions.at(-1)?.leavesCrater === false)
  check('导弹拦截结算：空爆不触发原弹头伤害', state.fortress.hp === fortressHp)
  check('导弹拦截碰撞：高速线段跨越小目标仍能命中', segmentCircleEntry(0, 0, 20, 0, 10, 0, 0.18) !== null)

  const mg = TURRET_DEFS.find(item => item.id === 'mg')!
  const savedCapability = mg.canInterceptMissile
  const savedTags = structuredClone(mg.tags)
  try {
    mg.canInterceptMissile = true
    mg.tags = [{ kind: 'prefer', key: 'missile' }]
    let priorityState = arena()
    priorityState.spawnQueue = []
    priorityState.ambushQueue = []
    const turret = mkTurret(priorityState, 'mg', 8, 10)
    mkEnemy(priorityState, 'walker', 8.5, 8.5)
    priorityState.enemyProjectiles = [{
      id: priorityState.nextId++, shooterId: 70003,
      x: 8.5, y: 5.5, px: 8.5, py: 5.5, heading: Math.PI,
      speed: 0, damage: 1, penetration: 0, traveled: 1, maxTravel: 100,
      kind: 'missile', ammoId: 'rocket_std', sourceSide: 'enemy', sourceFaction: 'enemy',
    }]
    priorityState = tick(priorityState, 0.01)
    const liveTurret = priorityState.turrets.find(item => item.id === turret.id)
    check('导弹优先标签：较远导弹可压过普通近目标成为当前锁定', liveTurret?.targetMissilePool === 'unit')
  } finally {
    mg.canInterceptMissile = savedCapability
    mg.tags = savedTags
  }

  const clusterAmmo = PROJECTILE_ARTS.find(item => item.id === 'custom_ammo_1')!
  const clusterState = fresh()
  clusterState.phase = 'prep'
  clusterState.prepLeft = 99
  clusterState.projectiles = []
  const center = fortressRect(clusterState)
  const cluster: EnemyProjectile = {
    id: clusterState.nextId++, shooterId: 70002,
    x: center.x + center.w / 2, y: center.y + center.h / 2 - 0.5,
    px: center.x + center.w / 2, py: center.y + center.h / 2 - 0.5,
    heading: Math.PI, speed: 5, damage: clusterAmmo.damage ?? 34, penetration: 0,
    traveled: 1, maxTravel: 100, kind: 'missile', ammoId: clusterAmmo.id,
    sourceSide: 'enemy', sourceFaction: 'enemy', targetKind: 'fortress', targetId: 0,
    targetX: center.x + center.w / 2, targetY: center.y + center.h / 2,
    guided: true, willGuide: true, split: { count: 4, spread: 40, at: 'proximity', range: 99 },
    t: 0, flightLeft: 10, missileAccel: 0, missileMaxSpeed: 5,
  }
  cluster.interceptHp = 1
  clusterState.enemyProjectiles = [cluster]
  const afterSplit = tick(clusterState, 0.05)
  const children = afterSplit.enemyProjectiles.filter(item => item.kind === 'missile' && item.splitDone)
  const childTargets = interceptableMissileTargets(afterSplit, 'player').filter(item => children.some(child => child.id === item.id))
  check('集束导弹拦截：母弹分裂后四颗子弹分别成为独立目标', children.length === 4 && childTargets.length === 4)
  check('集束导弹拦截：子弹使用完整拦截耐久而非继承母弹残血', childTargets.every(item => item.hp === 12 && item.maxHp === 12))
}

console.log('== 模块作用对象 / 单位锁定 / 资源提示 ==')
{
  const controllerId = 'sim_effect_controller'
  const factionId = 'sim_effect_player_faction'
  MODULE_DEFS.push(
    { id: controllerId, name: '主控测试模块', desc: '', cost: 0, w: 1, h: 1, effectTarget: 'controller', hpBoost: 100, ammoCap: 3, color: '#888' },
    { id: factionId, name: '阵营测试模块', desc: '', cost: 0, w: 1, h: 1, effectTarget: 'playerFaction', hpBoost: 250, ammoCap: 7, color: '#999' },
  )
  try {
    const state = fresh()
    state.modules = [
      { id: state.nextId++, defId: controllerId, x: 0, y: 0, rot: 0, timer: 0 },
      { id: state.nextId++, defId: factionId, x: 1, y: 0, rot: 0, timer: 0 },
    ]
    const controller = moduleBonuses(state)
    const faction = moduleBonuses(state, 'playerFaction')
    check('模块作用对象：主控汇总全部模块，玩家阵营只汇总明确共享模块', controller.hpBoostPool === 350 && faction.hpBoostPool === 250)
    const turret = mkTurret(state, 'mg', 5, 5)
    const details = playerUnitResourceDetails(state, null)
    const caps = playerTurretResourceCaps(TURRET_DEFS.find(item => item.id === turret.defId)!, controller)
    check('模块作用对象：资源详情与炮塔容量使用同一模块上限口径', details?.turrets.some(row => row.turretId === turret.id && row.ammoCap === caps.ammoCap) === true)
    const migrated = migrateModuleDefs([{ id: 'legacy-target', name: '旧模块', desc: '', cost: 0, w: 1, h: 1, color: '#777' }], 8)
    check('模块作用对象：旧模块迁移后保持玩家阵营共享', migrated[0].effectTarget === 'playerFaction')

    const def = fortressDef(state)
    const savedLocked = def.bodyLocked
    def.bodyLocked = true
    const before = fortressRect(state)
    state.phase = 'prep'; state.moveDir = { x: 0, y: -1 }; state.moveMag = 1
    const locked = tick(state, 0.5)
    const after = fortressRect(locked)
    check('单位模板锁定：单一开关同时阻止主控平移和主体转向', Math.abs(before.x - after.x) < 1e-9 && Math.abs(before.y - after.y) < 1e-9 && locked.fortress.turnW === 0)
    def.bodyLocked = savedLocked

    const beforeBars = gameParameters().showUnitHealthBars
    setUnitHealthBarsVisible(false)
    check('游戏参数：单位血条可以独立关闭', gameParameters().showUnitHealthBars === false)
    setUnitHealthBarsVisible(beforeBars)
    const beforeShadows = gameParameters().showEntityShadows
    setEntityShadowsVisible(false)
    check('游戏参数：单位与物体阴影可以统一关闭', gameParameters().showEntityShadows === false)
    setEntityShadowsVisible(beforeShadows)
    const beforeVisionEnabled = gameParameters().battleVisionEnabled
    const beforeVisionMeters = gameParameters().playerVisionMeters
    setBattleVisionEnabled(true)
    setPlayerVisionMeters(6.4)
    const visionState = initialState()
    visionState.allies.push({
      id: 8801, kind: 'soldier', faction: 'ally', controller: 'ai', producerId: -1,
      x: 50, y: 50, hp: 10, maxHp: 10, cooldown: 0, targetId: null, hitFlash: 0,
    })
    visionState.allies.push({
      id: 8802, kind: 'soldier', faction: 'neutral', controller: 'ai', producerId: -1,
      x: 80, y: 80, hp: 10, maxHp: 10, cooldown: 0, targetId: null, hitFlash: 0,
    })
    check('战场共享视野：玩家与友方属于同一视野队伍', factionsShareVision('player', 'ally') && !factionsShareVision('player', 'neutral'))
    check('战场共享视野：主控和友方单位共同成为视野源', playerTeamVisionSources(visionState).some(source => source.entityId === 0) && playerTeamVisionSources(visionState).some(source => source.entityId === 8801) && !playerTeamVisionSources(visionState).some(source => source.entityId === 8802))
    check('战场共享视野：友方视野可揭示其附近位置', playerTeamCanSeePoint(visionState, 51.5, 50) && !playerTeamCanSeePoint(visionState, 55, 50))
    setPlayerVisionMeters(beforeVisionMeters)
    setBattleVisionEnabled(beforeVisionEnabled)
  } finally {
    for (const id of [controllerId, factionId]) {
      const index = MODULE_DEFS.findIndex(module => module.id === id)
      if (index >= 0) MODULE_DEFS.splice(index, 1)
    }
  }
}

// v1.72：总结移至真正末尾（此前在 case66 之前，尾部用例失败不会被门禁捕获）
console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
if (failures > 0) throw new Error(`${failures} checks failed`)
