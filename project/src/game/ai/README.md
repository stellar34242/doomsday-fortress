# AI 代码边界

本目录集中维护单位的观察与决策。正式设计见 `docs/AI行为重构设计.md`。

- `schema.ts`：首选目标、站位、移动三字段协议，旧存档迁移，站位算法和事件覆盖。
- `combatTargeting.ts`：阵营无关的合法目标过滤、偏好排序、目标保持和武器射程提取。
- `nonCombatBehavior.ts`：关卡编辑器配置的停留、坚守、随机、路线、跟随与接近，以及编组视野、接战和脱战归位。
- `allyCombatAI.ts` / `enemyCombatAI.ts`：进入战斗后的单位主决策。
- `vehicleCombatAI.ts`：载具站位、环绕、撞击回退和受限炮位车体协同。
- `turretAI.ts` / `turretGeometry.ts`：所有阵营炮塔的独立索敌、评分、瞄准与炮位几何。
- `deploymentAI.ts`：投送单位状态机。
- `missileAI.ts`：导弹重索敌与制导转向。
- `targetSelection.ts`：只保留旧静态攻城存档/测试兼容，不是新版单位 AI 的目标入口。

`engine.ts` 拥有世界状态、碰撞、移动学、生成、发射、伤害和特效执行。AI 通过显式依赖端口调用这些系统，不得在 AI 文件中复制阵营专用伤害或运动规则。
