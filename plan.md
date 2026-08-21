# plan.md 记录约定（2026-08-20 起生效）

- **不记录**：纯文案、贴图内置、编辑器参数修改、口令导入，及一切快速通道改动。
- **机制变更**：只记一行（版本 + 摘要）。
- **"为什么"（关键参数/行为的设定依据）**：写入对应设计文档，不写入本文件。
- **待开发项**：一律只指向 `project/docs/待开发记录.md`，不复制内容。

---

# v1.88 履带相位渲染帧插值（修复高速"静止"错觉）

## 背景
10Hz 逻辑帧（TICK=0.1s）下，满速 6 格/s → 每 tick 相位 +18px = 整 3 个瓦片步进（6px），
落点与上一 tick 完全重合 → 频闪混叠，看上去履带静止。
用户已确认采用方案一：渲染帧插值相位（仅视觉平滑，物理同步不变）。

## 改动
1. `src/components/GamePreview.tsx` · `interpolate()`：
   堡垒 `trackPhase[]` 在 prev/cur 两逻辑态间按 alpha 逐元素 lerp
   （位置/heading 已有同款插值，履带相位复用同一机制）。
2. `src/game/render.ts`：新增无头探针 `__tdTrackPhase`（本帧最后渲染的相位值），供 e2e 采样。

## 验证
- tsc --noEmit
- sim 回归（ALL CHECKS PASSED，引擎无改动）
- build + 无头 e2e：
  1. 开波 → 按住 W 加速至满速
  2. 以 ~16ms 间隔采样 `__tdTrackPhase` 8 次，断言不同值数量 ≥ 5（插值前同 tick 窗口内恒定）
  3. 相位增量方向为正（前进向后滚）
  4. `__tdTrack` 瓦片数仍 > 40（渲染未破坏）
- website_version_manager build_version（static）
- 文档 v1.88 段落前置 + 同步 output/app/docs + 导出 /mnt/agents/output

---

# v1.89 履带翻滚区弧长参数化（消除头尾轮处缝隙）

## 根因
旧参数化：s∈[-R,0] 线性映射 θ∈[0,90°]，但四分之一圆弧真实弧长 = R·π/2 ≈ 1.57R
→ 直线↔翻滚交界处（θ≈0，瓦片近全尺寸）投影间距 = 1.57×步进，而瓦片高仅 1×板长
→ 缝隙 ≈ (1.57·step − tileLen)·cosθ ≈ 1.4px·cosθ，θ≈0 处最大，半径越大越明显。

## 改动
1. engine.ts trackPlacements：翻滚区改弧长参数化（θ = 弧长/R，s∈[-R·π/2, Lc+R·π/2]）
   → 全程等间距 step，投影间距 step·cosθ 与瓦片压缩高 tileLen·cosθ 匹配，重叠 2px 全程保持。
   TrackDef 不变、渲染层不变、编辑器预览自动受益。
2. sim.ts 新增 v1.89 断言：多相位扫描，任意相邻瓦片 间距 − 平均压缩高 < 0.005格（全程无正缝隙）。

## 验证
tsc / sim 回归 / build / e2e（__tdTrack 总数升至 ~80、压扁瓦片存在、相位物理不变）→ 版本 → 文档

---

# v1.90 俯仰/侧倾死区保持不归位

## 需求
用户：实际加速度为 0 时，俯仰不要归位（保持当前倾角）。

## 改动
1. engine.ts lean 块：aLon、aLat 同时进死区（|a|<0.05）且 pitchGain>0 → 跳过目标重算与趋近，
   leanX/leanY 冻结保持；pitchGain=0 仍强制回正（关闭语义）。
   更新 v1.43 块注释「匀速/静止 → 回正」为 v1.90 保持语义。
2. sim.ts 用例65 更新两条旧断言：
   - 「匀速行驶回正」→「匀速保持后倾不归位（≈+3.0px）」
   - 「停稳后回正归零」→「停稳保持前倾不归位（≤-2.5px）」
   （末 tick 部分加速可能使冻结值略低于目标，容差按趋近步长 1.33px/tick 放宽）

## 验证
tsc / sim / build / e2e（加速→满速后 lean 探针保持非零）→ 版本 → 文档

---

# v1.91 停稳俯仰惯性回弹（反向过冲 1~2px 后归位）

## 需求
用户：堡垒停下来、俯仰归位时加惯性——主体先朝反方向位移 1-2px，再回到原位。
（调整 v1.90：巡航保持不归位不变；停稳从"永久保持"改为"回弹归位"）

## 设计
停稳瞬间（v 截断为 0 且带保持倾角 >0.3px）启动欠阻尼回摆：
lean(t) = L₀·e^(−ζωt)·(cos ωd·t + ζω/ωd·sin ωd·t)，ζ=0.3、T=0.35s
→ 反向峰值 ≈ −0.37·L₀（满刹 L₀=4px → ≈+1.5px，正在 1-2px 区间），0.8s 衰减归位。
状态：fortress.leanRbT（-1=未激活）/ leanRbX / leanRbY（标量，避开克隆引用问题）。
新加速度打断回弹从当前值重新跟随；pitchGain=0 取消回弹仍回正；小倾角（≤0.3px）直接归位不回弹。

## 改动
engine.ts（接口+初始化+lean 块重构）；sim 用例65：停稳断言改「反向过冲 ≥1px + 衰减后归位 |lean|<0.1」；
e2e：停稳后 50ms 采样 2.5s，断言过冲峰值 ≥1px 且终值 ≈0。巡航保持检查保留。

---

# v1.92 俯仰改弹簧-阻尼二阶模型（速度随加速度缩放）

## 需求
用户确认：真实车辆俯仰初速度 ∝ 加速度、稳定时间由悬挂固有频率决定——把定速趋近改为二阶系统。

## 设计
- 目标倾角不变：lt = −a·k（k = pitchGain×0.5，上限 ±4px，侧倾 ×0.4，死区 0.05）
- 动态：lean'' = ωn²·(lt − lean) − 2ζωn·lean'，ωn = 2π×1.2Hz（≈7.54 rad/s，稳定 ~0.5s），ζ = 0.5
  （阶跃过冲 16%：急加速冲过目标再回落 = 悬挂韵味；峰值速率 ∝ 目标幅度 ∝ |a| → 轻踩慢、地板油猛）
- 积分：半隐式欧拉（10Hz tick 稳定）；新增状态 leanVX/leanVY（标量）
- 软上限 ±5px 防过冲超界；目标为 0 且 |lean|、|leanV| 均小 → 吸附归零
- 保留：v1.90 巡航死区冻结（冻结时 leanV 清零）；v1.91 停稳回弹（启动/打断时 leanV 清零）；gain=0 → 弹簧回 0

## 改动
engine.ts：类型 + 初始化 + lean 块趋近段重写；sim 用例65 数值断言按弹簧响应重标定（先跑后校准区间）
e2e __v192：起步 0.2s 时 leanY 明显小于稳态（渐进建立），1s ≈ 3.0；巡航保持/停稳回弹复用 v1.91 检查

---

# v1.93 俯仰位移上限加入堡垒参数（leanCap 1~8px，默认 4）

## 需求
用户：把俯仰位移上限从硬编码改为可编辑参数。

## 改动
1. config.ts：FortressDef 新增 `leanCap?: number`（俯仰位移上限 px，1~8，缺省 4）；DEFAULT_FORTRESS 显式 4。
2. engine.ts：lean 块 leanCap = clamp(d.leanCap ?? 4)；软上限 = leanCap + 1（原 5 = 4+1）；
   validateFortressDef 校验 1~8；更新块注释「上限 ±4px」表述。
3. DebugPanel.tsx：堡垒编辑器在「车身俯仰」后加「俯仰位移」numInput（步进 1）。
4. sim：新增用例——自定义 leanCap=2 的堡垒刹停前倾 ≈-2px（过冲至 -2.x，不越 -3 软上限）；
   校验拦截 leanCap 0/9、放行 1/8；既有默认 4 检查全部兼容。

## 验证
tsc / sim / build / e2e（编辑器行存在且默认值 4、改为 6 后 def 生效）→ 版本 → 文档

---

# v1.94 导弹制导模式下拉框 + 延迟制导

## 需求（用户）
1. 制导打勾 → 下拉选择框：常规（不制导）/ 制导 / 延迟制导
2. 延迟制导追加参数「延迟时间」（发射后直飞 N 秒才开制导）
3. 发射方向以炮塔方向为准（延迟期沿炮塔朝向直飞）
4. 兼容现有配置：guided boolean 保留，新参数 guideDelay 可选

## 设计
- TurretDef 新增 `guideDelay?: number`（0.05~2s；>0 且 guided=true 即延迟制导）
- 模式派生：!guided → 常规；guided && !guideDelay → 制导；guided && guideDelay>0 → 延迟制导
- Projectile 新增 `guideDelayLeft?`：>0 期间沿发射航向（= 发射瞬间炮塔角度 t.angle）直飞，
  不做追踪、不触发锁定点爆炸；倒计时归零 → guided=true（targetId 已保留，目标死亡走既有重选）
- 编辑器：FieldSpec 扩展 get/set 钩子；制导字段改 select（常规/制导/延迟制导）；
  延迟时间 number 字段仅延迟模式显示（步进 0.05，默认 0.4）

## 验证
sim：延迟弹出生 guided=false/朝向=炮塔角/延迟期航向不变/到期开制导命中；立即制导与常规回归
e2e：下拉 3 选项、切延迟制导出现延迟时间输入；tsc；版本；文档

## v1.95 猎手导弹初始数据更新（口令烘焙）
- 用户口令：将口令里的猎手导弹数据作为初始数据，快速调整，不需要验证和测试。
- Stage 1 — 解码口令 base64 JSON，提取 hunter 炮塔定义。
- Stage 2 — 原子补丁替换 config.ts TURRET_DEFS 中 hunter 条目（含 guideDelay 0.4、missileFlightTime 10、四管 sequential、S 型 1×1、art 块），grep 校验。
- Stage 3 — rsync 到 output/app → vite build → website_version_manager（static）。
- Stage 4 — 文档版本块 + 同步导出。跳过 tsc/sim/e2e（用户明确不要求）。

## v1.96 导弹初速度 + 延迟减速度
- 需求：导弹新增初速度参数（missileInitSpeed，缺省 0）；延迟制导模式新增延迟减速度参数（guideDecel，仅延迟时间内生效，减到 0 为止，缺省 0=照常加速）。
- Stage 1 — config.ts：TurretDef 加两个可选字段（注释单位 m/s、m/s²）。
- Stage 2 — engine.ts：弹丸出生 speed=missileInitSpeed；updateMissile 延迟期分支优先应用 guideDecel（下限 0），其余分支保持加速爬升；速度爬升改为仅在上限以下时加速（兼容初速度>极速）。
- Stage 3 — DebugPanel：导弹区加「导弹初速度(m/s)」（所有导弹显示）与「延迟减速度(m/s²)」（仅延迟制导模式显示）；guideMode 切离延迟制导时连带清除 guideDecel。
- Stage 4 — sim 新增用例（出生初速度 / 延迟期减速 / 减到 0 下限 / 到期后恢复加速追踪 / 未配置兼容），tsc + sim 回归。
- Stage 5 — rsync → build → e2e（编辑器字段 + 引擎行为抽样）→ build_version → 文档 v1.96 块。
- 注：猎手初始数据未配此二参（用户未给值），默认行为不变。
- 收尾：tsc 通过；sim ALL CHECKS PASSED（新增 5 项 + 修复 v1.94 重选用例的出厂延迟制导假设）；e2e 11/11；版本卡 f87d0fe；文档 v1.96 块已同步导出。

## v1.97 延迟时间字段编辑自隐藏修复
- 问题：guideDelay 字段 showIf 依赖自身 >0，逐键提交时中间态（空/0）触发字段卸载 → 表现为「延迟时间无法修改」。
- Stage 1 — DebugPanel：guideDelay showIf 改为 missile && guided（制导/延迟制导模式常显，未配置=立即制导）；guideDecel 保持仅延迟模式显示（无自隐藏问题）。tip 更新。
- Stage 2 — tsc + sim 回归（无引擎改动）。
- Stage 3 — build + e2e（实际键入 0.8 字段不消失、清空后仍在且模式回落为制导、重输 0.5 恢复延迟制导）。
- Stage 4 — build_version + 文档 v1.97 块。

## v1.98 炮位视角三模式 + 取消炮塔最大角度
- 需求：堡垒编辑器炮位视角改下拉——全视角（360° 自由旋转，已实现）/ 指定视角（起止角，已实现）/ 固定视角（新：设角度后炮口恒定朝向不变；上方=0°，逆时针 -180°，顺时针 +180°）；取消炮塔编辑器的「最大角度」(TurretDef.arc)。
- Stage 1 — config.ts：Hardpoint 加 fixed?: number（与 arc 互斥）；TurretDef 删 arc 字段与全部内置条目的 arc 值。
- Stage 2 — engine.ts：aim() 删 def.arc 钳制（地面炮塔随之 360°），固定视角分支 clampedRel=fixed、inArc=true（开火由射角锥判定）；aimRestAngle 支持 fixed；mountTurret 初始角 = heading + fixed；validateFortressDef 加 fixed -180~180 校验。
- Stage 3 — render.ts：drawTurret 射界指示——fixed 画单射线、无视界画整圆（原 def.arc 扇形移除）。
- Stage 4 — DebugPanel：删「最大角度」字段；炮位行视角勾选改三模式下拉 + 条件输入（起°/止° 或 角° clamp ±180）；编辑器预览 SVG 固定视角画射线。
- Stage 5 — sim 新用例（固定视角只打锥内目标/初始角/校验/去 arc 后地面炮塔全向回归）+ tsc + 回归。
- Stage 6 — build + e2e + build_version + 文档 v1.98。

## v1.99 挂载初始朝向按炮位视角
- 需求：全视角=朝 0°；指定视角=朝视界中心；固定视角=朝固定角（v1.98 已做固定）。
- Stage 1 — engine.ts mountTurret 初始角改为 船头 + (fixed ?? arc中点 ?? 0)。
- Stage 2 — sim 新用例（指定视角初始角=视界中心 295° / 全视角初始角 0）+ tsc + 回归。
- Stage 3 — build + build_version + 文档 v1.99（引擎行为变更，sim 覆盖，免 e2e）。

## v2.0 堡垒编辑器数字输入负值修复
- 问题：numInput 全受控，逐键输入负号时被中间态冲掉 → 固定视角/起止角等无法输入负数。
- Stage 1 — DebugPanel：新增模块级组件 FortNumInput（聚焦期本地文本 + 合法值实时提交 + 失焦回落外部值），numInput helper 改为返回该组件（调用点不变，组件定义在模块级避免重挂载丢态）。
- Stage 2 — tsc + sim 回归（纯 UI 改动）。
- Stage 3 — build + e2e（逐键模拟 "-"→"-45" 输入生效、失焦显示钳制值、普通正数输入回归）。
- Stage 4 — build_version + 文档 v2.0。

## v2.1 制导导弹脱靶不丢锁（尽量朝目标飞）
- 需求：就算飞不到目标，制导导弹也要尽量朝目标飞——移除脱靶 lostLock 机制。
- Stage 1 — engine.ts：删除脱靶判定（越过目标且偏离>120° → lostLock），制导块持续追踪；lostLock 字段保留兼容旧状态。
- Stage 2 — sim 用例 13b 重写：构造越过目标且背向（diff=180°）几何，断言 lostLock 保持 false 且航向持续向目标收敛。
- Stage 3 — tsc + sim + build + e2e（引擎行为 sim 已覆盖，免 e2e）+ build_version + 文档 v2.1。

## v2.2 猎手出厂参数快速调整
- 需求（快速修改，免验证）：初速度 40、延迟减速度 30、炮管素材=无。
- Stage 1 — config.ts hunter 条目：missileInitSpeed: 40、guideDecel: 30、art.barrelAsset: 'none'。grep 校验。
- Stage 2 — rsync → build → build_version → 文档 v2.2。

## v2.3 充能参数仅射线类 + 充能帧条横向等分
- 需求：充能参数（chargeTime）只有射线类（beam）炮塔拥有；充能动画按帧数将素材横向等分、从左到右顺序播放（原实现按"帧宽=图高"的方帧假设切，非等分）。
- Stage 1 — art.ts：新增 chargeFrameRect(imgW,imgH,frames,progress) 纯函数（等分源矩形）。
- Stage 2 — render.ts / DebugPanel 预览：充能层改用等分矩形（宽高分别按原始比例绘制）。
- Stage 3 — DebugPanel：chargeTime 字段 showIf 改 beam；ArtEditor 充能动画板块仅 beam 显示。
- Stage 4 — sim 新增 chargeFrameRect 单测 + tsc + 回归；build + e2e（hunter 无充能字段、beam 有）+ build_version + 文档 v2.3。

## v2.4 素材库替换（Laser_M / charge_Laser_M）
- 需求（快速修改，免验证）：下载用户提供的两个素材，替换内置库 laser_m.png 与 charge_laser_m.png。
- Stage 1 — 下载校验 PNG → 覆盖 public/sprites/library/ 同名文件。
- Stage 2 — rsync → build → build_version → 文档 v2.4。

## v2.5 充能末帧攻击期常显 + public/res 素材目录迁移
- 需求1：充能贴图最后一帧在攻击持续时间内常显（充能结束→持续攻击期间定格末帧）。
- 需求2：新建 res 目录，按贴图分类建文件夹，所有贴图素材移入（/sprites/* → /res/*，分类子目录保留：turrets/projectiles/fortresses/zombies/ground/walls/fx/library）。
- Stage 1 — render.ts 充能层：chargeLeft>0 播进度帧；t.firing && firingLeft>0 定格末帧（progress=1）；ArtPreview 攻击窗口同步定格。
- Stage 2 — 目录迁移：mv public/sprites/* public/res/；更新 config/render/art/assetlib 全部 /sprites/ 引用为 /res/；DebugPanel 提示文本同步。
- Stage 3 — 兼容 shim：srcImage/fortressSprite 将旧 '/sprites/' 前缀重写为 '/res/'（旧口令/localStorage 引用不 404）。
- Stage 4 — sim（shim 单测 + 充能末帧逻辑）+ tsc + build + e2e（页面加载无 404、beam 充能流程）+ build_version + 文档 v2.5。

---

## v2.5（2026-08-18，已完成）充能末帧攻击期常显 + 贴图迁移 res 分类目录

- 需求：① 充能贴图最后一帧在攻击持续时间内常显；② 新建 res 目录按分类建文件夹迁移全部贴图。
- 执行：render.ts 充能层 chargeHold 定格末帧 + ArtPreview 同步；public/sprites/ → public/res/ 8 分类目录（56 文件）；6 处代码引用替换；resCompatUrl shim 接入 srcImage/fortressSprite/DebugPanel 堡垒预览。
- 验证：sim +2 用例 ALL CHECKS PASSED；tsc 过；e2e 4/4（无 /sprites/ 请求、9 png 全 200、堡垒贴图 /res/fortresses/）。
- 交付：rsync output/app → vite build → 版本卡 478a2fd；文档 v2.5 块 + 同步 output/app/docs + 导出。

---

## v2.6（2026-08-18，已完成）烟尘粒子贴图 smoke32 + 火光加法发光（lighter）

- 需求：① 烟尘粒子贴图用用户上传的 smoke32.png；② 火光（炮口击发 + 持续发射循环）加 'lighter' 加法发光；③ 长期规则：主界面与预览图效果默认同步。
- 改动：
  1. smoke32.png → public/res/fx/smoke32.png
  2. render.ts 粒子层：烟尘（grow>0）用 smoke32.png，其余粒子仍 particlealpha32.png（tintedFx 着色不变）；导出 tintedFx 供预览复用
  3. render.ts 两处火光（击发帧条 / 持续发射循环）ctx.save 后加 globalCompositeOperation='lighter'
  4. DebugPanel ArtPreview 火光（贴图 + 几何回退）同步 lighter；弹丸特效预览粒子层同步贴图化（smoke32/particlealpha32 + tintedFx，回退 arc）
- 验证：sim 加 smoke32 存在性检查；tsc；e2e（smoke32 200、无 /sprites/、无 404）；版本卡；文档 v2.6 块。

- 结果：sim +1 用例 ALL CHECKS PASSED；tsc 过；e2e 4/4（smoke32 经 /res/fx/ 加载、10 png 全 200）；版本卡 6f904e9；文档 v2.6 块 + 同步导出。
- 长期规则（用户）：未特别说明时，主界面与预览图效果默认同步。

---

## 文档重组（2026-08-18，已完成）设计文档按编辑器域拆分

- 原《堡垒编辑器设计.md》（1487 行合集：66 补充块 + 51 详情块 + 基础章节）拆分为 4 份：
  - 炮塔编辑器设计.md（476 行）：TurretDef/型号/美术配置/火光/充能/素材库/炮塔渲染
  - 弹丸编辑器设计.md（162 行）：ProjectileArt/尾焰/命中/爆炸/弹道行为/效果预览
  - 战场编辑器设计.md（95 行）：战场宽深/地形/主界面布局/视口/性能
  - 堡垒编辑器设计.md（926 行）：FortressDef/炮位/内部空间/机动/履带/俯仰/操控 + 原基础章节 ## 1-6
- 交叉版本块按条目拆分并互注（v2.6/v2.5/v1.98/v1.75/v1.72/v1.70/v1.69 及补充块 v1.17/v1.22/v1.55/v1.98 等）；覆盖校验：66 补充 key + 51 详情 key 全部分配无遗漏。
- 原合集文件已不保留（用户确认）；project/docs、output/app/docs、/mnt/agents/output 三处同步。
- 后续规则：新版本块按归属追加到对应文档（跨编辑器改动拆条目互注）。

---

## v2.7（2026-08-18，已落地）远行星号式光束表现（分层贴图 + 命中/炮口光球 + 弹丸库射线命中接线）

- 素材：用户上传 7 张（beam_glowA-D 光晕层 / beam_coreA-C 亮芯层）→ public/res/projectiles/beam/，注册内置素材库（弹丸分类，src 覆盖机制）。
- config：TurretArt.beam = { glowAsset/coreAsset（缺省 beam_glow_a/beam_core_a，'none'=程序化旧表现）、impactAsset/muzzleAsset（缺省 /res/fx/glow16.png）、fringeColor（缺省 #78C8DC）/coreColor（缺省 #F0FAFF）、flicker（0~1 缺省 0.15）、scrollSpeed（缺省 96 美术px/s）}。
- art.ts：beamArtConfig 纯函数解析 + validateArt 校验。
- render.ts：光束两段 fillRect → 光晕+亮芯双层贴图（90° 旋转平铺 + lighter + 宽度/亮度脉动 + 纹理滚动）；beamFades 同步；持续发射期间炮口光球 + 命中点闪光（glowFlicker 脉动）；pulse 曳光升级 lighter 双色 + 命中闪光。
- engine.ts：beam DoT tick 在光束终点产 impact 事件、pulse 命中点产 impact 事件（ammoId=art.projectile，接弹丸库 ray impact 配置，v2.7 前战场射线命中无特效）。
- DebugPanel：ArtEditor 光束表现板块（beam 专属，4 素材下拉 + 2 色 + 2 数值）；ArtPreview 同步（长期规则）。
- 验证：sim（素材注册/落盘、beamArtConfig 默认与覆盖、validateArt）+ tsc + e2e（素材 200、板块显隐）+ 版本卡 + 文档（炮塔/弹丸各记 v2.7 互注）。

### v2.7 落地记录
- 全部按计划实施：assetlib LIBRARY_SRC 覆盖 + 7 条目注册；config TurretArt.beam；art beamArtConfig + validateArt；render drawBeamLayer（导出供预览复用）+ 持续光束/消退段/脉冲曳光三分支 + 炮口光球 + 端点命中闪光；engine BeamFade.defId、Tracer.defId、beamTick 端点 impact、fireGunShot 脉冲命中 impact；DebugPanel 光束表现板块 + ArtPreview 同步。
- 验证：sim 9 新用例全过（两处内置素材计数 16→23 随动）、ALL CHECKS PASSED；tsc 通过；e2e 4/4（9 贴图 200/PNG 合法、glow 81% > core 19% alpha 分层、路由正常、运行期 clean）。版本卡 d7c2569。
- 文档：炮塔编辑器设计.md v2.7（主）+ 弹丸编辑器设计.md v2.7（命中接线，互注），三处同步。
- 注意：用户所述 beam_coreD 未实际上传（亮芯层仅 A/B/C），已在回复与文档中说明。

---

## v2.8（2026-08-18，已落地）光束表现迁移弹丸库 ray 条目 + 炮塔编辑器插光束选择 + 射线去尾焰

**需求**（用户）：① 射线类炮塔编辑器在炮管与火光之间插入「光束（弹丸）」选择；② 光束表现配置从炮塔 art.beam 转移到弹丸库射线（ray）类条目编辑面板；③ 去掉射线弹丸的尾焰编辑。

- config：ProjectileArtDef 增 beam 组（沿用 v2.7 八字段，仅 kind:'ray' 有意义）；TurretArt.beam 移除（旧口令该字段读取忽略，由引用条目接管）。
- art.ts：beamArtConfig 改经 def.art.projectile → projectileArtDef → entry.beam 解析（无引用/无 beam 组 → 默认搭配）；validateArt——喷射才警告弹丸不生效（持续光束现已生效）、beam 型 want='ray' 两模式一致、引用条目 beam 字段校验（hex/flicker/scrollSpeed error、未知素材 warning、非射线炮塔引用带 beam 的 ray 条目 warning）。
- DebugPanel 炮塔编辑器：删 v2.7 光束表现板块；弹丸下拉仅对喷射隐藏，beam 型标签改「光束（弹丸）」+ 新提示（位置本就在炮管与火光之间）。
- DebugPanel 弹丸库：kind='ray' 时隐藏尾焰 fxGroup；新增「光束表现」板块（4 素材下拉 + 2 色 + 2 数值，pa.beam 直改 + bump）。
- sim：v2.7 ②③ 改写为条目式（临时 ray 条目 push/pop）；④ 命中事件不变；验证后 tsc/build/e2e/版本卡/双文档 v2.8 互注。

### v2.8 落地记录
- 全部按计划实施：ProjectileArtDef.beam 新增 / TurretArt.beam 移除；beamArtConfig 经条目解析 + validateBeamGroup 抽出复用；炮塔编辑器删光束板块、弹丸下拉仅喷射隐藏、射线标签「光束(弹丸)」；弹丸库 ray 隐藏尾焰 + 光束表现板块（直改 pa.beam + bump）。
- 旧「弹丸类别校验」sim 用例口径随动（光束引用→类别不匹配，喷射引用→无弹丸警告）。
- 验证：sim ALL CHECKS PASSED；tsc 通过；e2e 4/4（修掉 driver 双跑 guard + 去掉 localStorage 探测）。版本卡 f76aa7c。
- 文档：炮塔/弹丸双文档 v2.8 互注，三处同步。

---

## v2.9（2026-08-18，已落地）弹丸库射线：飞行预览=光束发射、取消爆炸、光束表现移至原爆炸位

**需求**（用户）：弹丸库射线条目的飞行预览改为播放光束发射；取消爆炸（fxGroup 与预览按钮）；光束表现板块移到原爆炸位置（命中之前）；板块标题去括号文字。
- art.ts：beamArtConfigOf(pa) 核心解析抽出，beamArtConfig(def) 转调（渲染三处签名不变）。
- ammoFxPreview：canPlay——ray 的 trail 恒可播（光束发射）、explosion 恒不可播；fxTick ray-trail 不喷粒子（光束体由绘制层推演）。
- AmmoPreview：ray 且 trail 模式绘制分层光束（drawBeamLayer + tintedFx，发射点左端向右，炮口光球+端点命中闪光，AMMO_FX_CELL=30 滚动 1:1）；ray 隐藏爆炸按钮；ray-trail 不画弹体。
- DebugPanel 弹丸库：爆炸 fxGroup 仅 kind!=='ray'；光束板块移到爆炸原位（trail 后、命中前）；标题「光束表现（远行星号式分层）」→「光束表现」。
- sim：canPlay ray 新口径 + ray-trail 无粒子用例；tsc/build/e2e/版本卡/《弹丸编辑器设计》v2.9。

### v2.9 落地记录
- 全部按计划实施：beamArtConfigOf 抽出、canPlay/fxTick ray 口径、AmmoPreview 光束发射绘制 + 去爆炸按钮、面板爆炸仅非 ray、光束板块移位至原爆炸位、标题去括号。
- 验证：sim 2 新用例全过、ALL CHECKS PASSED；tsc 通过；e2e 4/4（bundle 标记检查改用中文面板文本——函数名被 minify；首跑 root 检查抖动重跑即过）。版本卡 ac83d1f。
- 文档：《弹丸编辑器设计》v2.9（纯弹丸域，无跨文档互注），三处同步。

---

## v2.10（2026-08-18，已落地）射线条目：发射/命中闪光缩放 + 吸收/散发/烟尘粒子

**需求**（用户）：弹丸库射线条目新增——发射点闪光缩放（默认1=100%）、吸收粒子（发射点能量吸收）、命中点闪光缩放（默认1=100%）、散发粒子（命中点粒子飞溅）、烟尘（命中点散发烟尘）。
- config：ProjectileArtDef.beam 增 muzzleScale/impactScale（缺省1）+ absorb/scatter/smoke 三组 { rate/color/size }（组在=生效）。
- art.ts：BeamArtConfig 扩展解析（缩放缺省1；粒子组缺省 rate 12/24/6、size 0.05/0.05/0.1、色=亮芯色/光晕色/#3A3632）；validateBeamGroup 扩校（缩放>0、rate≥0、size>0、色 hex）。
- render.ts：持续光束发射期间——吸收粒子（炮口环带向心汇聚）、散发粒子（端点飞溅 lighter）、烟尘（端点 grow>0 走 smoke32 source-over）；闪光尺寸×缩放；脉冲命中闪光×impactScale；beamFxAcc 按 turret id 累加清理。
- ammoFxPreview：AmmoFxState 加三个累加器；fxTick ray-trail 发射三组粒子（发射点 0.5/端点 worldW-0.5），sim 可测。
- DebugPanel：AmmoPreview 缩放；ArtPreview 光束块同步（缩放+模块级粒子池，30px/格）；编辑器光束板块加 2 缩放数值 + 3 粒子子组（增删+速率/颜色/尺寸）。
- sim：解析缺省/覆盖、校验、fxTick 三组粒子计数；tsc/build/e2e/版本卡/《弹丸编辑器设计》v2.10。

### v2.10 落地记录
- 全部按计划实施：config/art 解析与校验、render.ts 战场三组粒子 + 闪光缩放（含脉冲曳光）、fxTick ray-trail 三组发射、AmmoPreview/ArtPreview 同步（ArtPreview 独立模块粒子池）、编辑面板 2 缩放数值 + 3 粒子子组。
- 验证：sim 5 新用例全过、ALL CHECKS PASSED；tsc 通过（beamNum 键类型拓宽修复）；e2e 4/4（virtual-time-budget=40000 一次过）。版本卡 8bed359。
- 环境：node_modules 被环境抹除 → npm ci 重装；output/app/node_modules 软链丢失 → ln -sfn 重建后 vite build 通过。
- 文档：《弹丸编辑器设计》v2.10 详情 + 速览，《炮塔编辑器设计》v2.10 互注，三处同步。

---

## v2.11（2026-08-18，已落地）光束贴图迁移 /res/beam/ + 新增 15 张 + 亮芯层置光晕层上方

**需求**（用户）：① 弹丸库光束表现板块中亮芯层选择放到光晕层上方；② 删除内置 beam_core_a/b/c、beam_glow_a/b/c/d 共 7 张贴图；③ res 下新增 beam 文件夹，15 张上传贴图落位（chunky/laser/rough2/weave 各 core+glow、coreA-C、glowA-D）；④ 亮芯层/光晕层素材选择指向该文件夹。
- 文件：public/res/beam/ 新建并放入 15 张（去 "(1)" 后缀，保留驼峰命名）；删除 public/res/projectiles/beam/。
- assetlib：AssetCategory 增 'beam'（光束）；删 7 条 LIBRARY_ASSETS 与 LIBRARY_SRC；新增 15 条内置（id `builtin:beam/{file}`，src /res/beam/{file}.png，类别 beam）。
- art.ts：beamArtConfigOf 缺省 → builtin:beam/beam_glowA / builtin:beam/beam_coreA。
- DebugPanel 光束板块：beamSel 加 cat 参数（亮芯/光晕 → 'beam'，命中/炮口仍 'projectile'）；亮芯层行移到光晕层上方；默认文案/提示更新。
- sim：v2.7 ① 改写为 v2.11 落位检查（15 新 + 7 旧删除）；v2.8 ② 显式覆盖用例改新 id；内置计数 23→30。
- tsc/sim/build/e2e（贴图清单换 15 beam + fx）/版本卡/《弹丸编辑器设计》v2.11 + 《炮塔编辑器设计》互注。

### v2.11 落地记录
- 全部按计划实施：/res/beam/ 15 张落位（去 "(1)" 后缀）、旧 projectiles/beam 删除；assetlib 增 beam 分类 + 15 条 builtin:beam/ 注册（LIBRARY_SRC 机制移除）；默认搭配 beam_glowA/beam_coreA；面板亮芯层置顶 + 双层选择器改 beam 分类（命中/炮口保持弹丸分类）。
- 验证：sim 全量 ALL CHECKS PASSED（v2.11 ① 落位/注册/旧删除；内置计数修正为 31——16 常用 + 15 光束，初算 30 有误已修）；tsc 通过；e2e 5/5（驱动两处修正：SPA 回退下删除断言改 PNG 魔数判定、入口 js 相对路径 ./assets 正则）。版本卡 e90dd74。
- 文档：《弹丸编辑器设计》v2.11 详情 + 速览，《炮塔编辑器设计》v2.11 互注，三处同步。

---

## v2.12（2026-08-18，已落地）炮塔预览深色背景 + 弹丸预览竖版超框修复

**需求**（用户）：① 炮塔编辑器预览图背景改深色，与弹丸编辑器预览图一致；② 竖版模式下弹丸编辑器预览超框出屏，需优化。
- drawArtPreview：显式填充 #262420 底；网格 rgba(26,26,24,0.08)→rgba(239,235,216,0.07)；坐标轴 0.45→rgba(239,235,216,0.5)；几何炮管线/占格轮廓 #1A1A18→#A8A28C；几何圆座 #2A2A26→#4A4740；标注点/轴心/充能点描边→rgba(239,235,216,0.85)；drawPreviewRack 描边同步。
- ArtPreview canvas class：bg-[#F4EFDC]→bg-[#262420]。
- AmmoPreview canvas：class 加 max-w-full h-auto——宽处保持 1px=1px（v1.71 口径），竖版窄容器等比缩小不超框。
- 验证：tsc/sim/e2e/版本卡；《炮塔编辑器设计》v2.12 + 《弹丸编辑器设计》互注。

### v2.12 落地记录
- 全部按计划实施：drawArtPreview 显式填充 #262420 + 网格/坐标轴/几何线/圆座/标注描边转浅色系 + drawPreviewRack 同步；ArtPreview class 改 bg-[#262420]；AmmoPreview 画布加 max-w-full h-auto。
- 验证：tsc 通过；sim ALL CHECKS PASSED（纯观感改动无新用例）；e2e 4/4 一次过。版本卡 e7f4aad。
- 环境：node_modules 再被抹除 → npm ci 恢复。
- 文档：《炮塔编辑器设计》v2.12 详情 + 《弹丸编辑器设计》v2.12 互注，三处同步。

---

## v2.13（2026-08-18，已落地）编辑器 0.5 步进统一改 0.1

**需求**（用户）：编辑器中所有原本最小调整值为 0.5 的统一改为 0.1。
- DebugPanel FIELDS：燃烧时长/射线宽幅/攻击持续/装填冷却/维持电量 5 个字段 step 0.5→0.1（全局仅这 5 处 0.5 步进）。
- 验证：tsc/sim/e2e/版本卡；《炮塔编辑器设计》v2.13。

### v2.13 落地记录
- 5 处 step: 0.5 → 0.1（燃烧时长/射线宽幅/攻击持续/装填冷却/维持电量），全局确认无其他 0.5 步进。
- 验证：tsc 通过；sim ALL CHECKS PASSED；e2e 3/3（产物无 step:0.5 残留）。版本卡 863f999。
- 文档：《炮塔编辑器设计》v2.13 详情 + 速览，三处同步。

---

## v2.14（2026-08-18，已落地）磁轨光束塔口令沉淀为出厂默认

**需求**（用户）：将附件口令（td-config v3）中磁轨光束塔内容设置为默认内容。
- config.ts beam 塔：cost 240→20、rotateSpeed 180→90、aimCone 8→5、rangeMax 200→250、beamWidth 8→10、dot 10→15、reload 2→0.5、mount L→M（w/h 2×2→1×2）、新增 art（Laser_M 炮身 + charge_Laser_M 充能 5 帧 + ray_std 引用 + 底座/炮管/火光「无」）、chargeTime 3。
- ray_std：新增 beam 组（flicker 0/scrollSpeed 224/muzzleScale 0.3/impactScale 0.3/absorb 26·0.05/scatter 34·0.06）。
- sim：v2.14 两条出厂值断言；历史光束用例统一 chargeTime=0（充能用例自行覆盖）；用例9 DoT 期望 50~80→80~115；停火消退宽幅 8→10。
- 验证：tsc/sim/e2e/版本卡；《炮塔编辑器设计》v2.14 + 《弹丸编辑器设计》互注（ray_std）。

### v2.14 落地记录
- 全部按计划实施；sim ALL CHECKS PASSED（含 2 条 v2.14 新断言一次过）；e2e 3/3。版本卡 7149015。
- 文档：双文档互注，三处同步。

---

## v2.15（2026-08-18，已落地）光束贴图原尺寸 + 散发角度/电焊拖尾 + 效果分类 + 充能末帧 0.1s

**需求**（用户，4 项）：
1. 光束光晕层/亮芯层素材默认高度保持原尺寸 32px，不缩放（drawBeamLayer 贴图按原生 128×32 平铺）。
2. 射线散发粒子：新增散发角度（朝射线源方向为 0°，90°=左右各 45°，缺省 360° 全向）；散射粒子加电焊式拖尾（速度向亮线）。
3. 素材库「开火效果」改名「效果」；glow16/particlealpha32/smoke32 注册进该分类（builtin:fx/*）；射线命中闪光/炮口闪光选择锚定效果分类；面板布局：亮芯+光晕一行、炮口闪光+命中闪光一行。
4. 充能最后一帧不算在充能时间内：chargeLeft 到 0 后滞留 0.1s（末帧亮起）才起射；预览同步。
- sim：内置计数 31→34；散射 angle 解析/校验；充能滞留用例；tsc/e2e/版本卡/文档（炮塔+弹丸双文档互注）。

### v2.15 落地记录
- 全部 4 项按计划实施：
  1. drawBeamLayer 新增 texScale=1 参数，贴图按原生尺寸平铺（tileW/tileH=img 尺寸×texScale）；render.ts 两处调用传 cell/30；宽度衰减仅作用于程序化回退。
  2. scatter 组新增 angle?: number（全锥角，朝射线源 0°，缺省 360）；art.ts 解析 angle ?? 360 + validateBeamGroup 0~360 校验；render.ts srcAng=atan2(命中点-端点)、AmmoPreview π、ArtPreview π/2；Particle/TrailSpawnOpts 新增 streak，散射粒子 streak: true，三处渲染循环画速度向亮线（0.05s 拖尾，lighter）。
  3. ASSET_CATEGORY_NAME.flash「开火效果」→「效果」；FX_ASSETS 注册 glow16/particlealpha32/smoke32 为 builtin:fx/*（内置 31→34）；beamSel 新增 cat 参数，命中/炮口闪光锚定 flash；四选择器去 col-span-2 成两行；「炮口光球」改名「炮口闪光」。
  4. engine.ts 导出 CHARGE_LAST_HOLD=0.1；chargeLeft 负值保持段状态机 + 精确落零 -1e-9 兜底；充能帧映射 progress×(frames-1)/frames 末帧恰在结束时点亮；ArtPreview 阈值 +0.1s。
- 踩坑：① sim 漏 import ASSET_CATEGORY_NAME → ReferenceError，补入 assetlib 导入；② 充能精确落零（dt=0.05 整除 0.5）跳过保持段 → 引擎 -1e-9 修复，sim 计时 0.55→0.6；③ e2e 标记 builtin:fx/glow16 因模板字符串不拼接而缺席 → 改查 builtin:fx/。
- 验证：tsc 通过；sim ALL CHECKS PASSED（含 4 条 v2.15 新断言）；e2e 4/4（beam 贴图 PNG 魔数 + builtin:fx/ + 散发角度 + streak 标记）；版本卡 e8db8d9。
- 文档：《弹丸编辑器设计》v2.15 详情+速览、《炮塔编辑器设计》v2.15 详情+速览（互注），三处同步。

---

## v2.16（2026-08-18，已落地）Laser_M/fx_fire_S/charge_Laser_M 贴图替换 + 充能末帧滞留 0.1→0.05s

**需求**（用户，4 项）：
1. 下载新 Laser_M.png 替换素材库「Laser_M」（/res/library/laser_m.png 文件级替换，注册/引用不变）。
2. 下载新 fx_fire_S.png 替换素材库「fx_fire_S」（/res/library/fx_fire_s.png）。
3. 下载新 charge_Laser_M.png 替换素材库「charge_Laser_M」（/res/library/charge_laser_m.png）。
4. 充能末帧滞留 0.1s → 0.05s（CHARGE_LAST_HOLD；ArtPreview 阈值同步；sim 滞留用例改时序）。
- 验证：PNG 魔数/尺寸核对 → tsc → sim（滞留段 (-0.05,0) 断言）→ 构建 → e2e（3 贴图新字节数+魔数）→ 版本卡 → 文档（炮塔+弹丸互注）→ 三处同步。

### v2.16 落地记录
- 三贴图下载替换：laser_m 38×50→32×42（4096B）、fx_fire_s 6×18（1280B）、charge_laser_m 20×12→14×21（1096B，5 帧等分帧宽 2.8px 小数 canvas 兼容）。
- CHARGE_LAST_HOLD 0.1→0.05；DebugPanel ArtPreview 3 处阈值 +0.1→+0.05（含弹丸发射偏移 -0.1→-0.05 两处）；render.ts 注释同步。
- 踩坑：① v1.74「fx_fire_s==口令 upload-4」字节断言失效 → 改 v2.16 魔数+尺寸+字节数断言；② 滞留用例 chargeTime 0.5 逐 tick 累减 0.05 浮点落零方向不定（实测落 +2.8e-17 仍在充能）→ chargeTime 改 0.52，0.6s 时 -0.03 ∈ (-0.05,0) 滞留、再 0.1s 起射；③ e2e canvas 挂载检查 onload 早于 React 挂载 → 改 250ms 轮询。
- 验证：tsc 通过；sim ALL CHECKS PASSED；e2e 7/7；版本卡 bdd77f4。
- 文档：《炮塔编辑器设计》v2.16 详情+速览、《弹丸编辑器设计》互注，三处同步。

---

## v2.17（2026-08-18，已落地）新增内置素材：MissileLauncher2_S（炮身）+ missile2_s（弹丸）

**需求**（用户，2 项）：
1. 下载 MissileLauncher2_S.png 作为内置素材放至炮身分类（/res/library/missilelauncher2_s.png，LIBRARY_ASSETS + LIBRARY_NAMES 注册）。
2. 下载 missile2_s.png 作为内置素材放至弹丸分类（/res/library/missile2_s.png）。
- 内置素材计数 34→36；sim 两处计数 + 新注册断言；tsc/构建/e2e（两 PNG 魔数+bundle 注册标记）/版本卡/文档（炮塔①+弹丸② 双详情互注）/三处同步。

### v2.17 落地记录
- missilelauncher2_s 26×28/3026B（炮身 ×6→×7，展示名 MissileLauncher2_S）；missile2_s 3×12/1162B（弹丸组，展示名同文件名）；均 builtin 不随口令导出。
- 踩坑：① 同一文件并行 edit_file 发生覆盖丢失（assetlib LIBRARY_ASSETS 与 sim 计数/类别断言两处在同消息多 edit 下被后写覆盖）→ 改为顺序编辑补齐；教训：同文件多处编辑必须串行；② e2e 标记 builtin:library/xxx 因模板字符串不拼接缺席 → 改查裸文件名。
- sim：两处计数 34→36 + libNames 补 2 件 + 类别/展示名断言 + 贴图魔数/尺寸/字节数断言；ALL CHECKS PASSED。
- e2e 7/7（两 PNG 魔数 + bundle 注册/展示名标记 + 应用挂载）；版本卡 2b467fb。
- 文档：《炮塔编辑器设计》v2.17 详情+速览（另补回 v2.16 丢失的速览条）、《弹丸编辑器设计》v2.17 详情+速览互注，三处同步。

---

## v2.18（2026-08-18，已落地）编辑器配置直连本地文件夹（File System Access API）

**需求**（用户）：编辑器数据存到本地文件夹（如 D:\tank），随时改动保存。方案：FSA API 直连（用户已选）。
- config_transfer.ts：拆 buildBundle/validateBundleShape；新增 exportConfigJson（美化 JSON）、parseConfigSmart/applyConfigSmart（JSON 或 base64 双兼容）。
- 新增 localFolder.ts：showDirectoryPicker 连接、句柄 IndexedDB 记忆、权限再请求、td-config.json 读写。
- DebugPanel 顶栏「本地」按钮 + 小窗：连接/保存/读取，不支持时提示降级口令。
- sim：Smart 双格式往返断言；e2e：bundle 标记（td-config.json/showDirectoryPicker/本地）+ 挂载；版本卡；文档（炮塔设计主记+弹丸互注）；三处同步。

### v2.18 落地记录
- 全部按计划实施；另抽出 applyBundle 供 applyConfig/applyConfigSmart 共用，口令通道行为零变化（sim 口令往返/坏口令用例全过）。
- 踩坑：edit_file 大段 old_string 因历史乱码字符不匹配 → config_transfer.ts 整文件重写（注意 encodeBase64 重写时引入笔误 B64[(b2&3)<<6] 已修正回 B64[b2&63]）。
- 验证：tsc 通过；sim ALL CHECKS PASSED（新增 ②b Smart 双格式+恒等+坏 JSON 断言）；e2e 8/8（6 个 bundle 标记+挂载）；版本卡 6efbc31。
- 文档：《炮塔编辑器设计》v2.18 详情+速览、《弹丸编辑器设计》互注，三处同步。

---

## v2.19（2026-08-18，已落地）口令(4)沉淀为出厂默认（猎手/光束塔/ray_std/集束导弹/堡垒 leanCap）

**需求**（用户）：将附件口令(4)导入编辑器 = 沉淀为出厂默认（范围确认：全部，用户无偏好取推荐）。
- 差异解析：①hunter 8 项（guideDecel 30→100、missileInitSpeed 40→100、turretAsset→missilelauncher2_s、rack.show→false、barrels 炮口 y→0.4、projectile→custom_ammo_1、missileCurve+20、burst 4→8/burstInterval 0.5→0.4）②beam chargeTime 3→2、charge.offset→[0,0.2]、frames 5→6 ③ray_std scatter.size 0.06→0.05、angle+90 ④新增 custom_ammo_1 集束导弹（missile2_s + 橙惯性尾焰）⑤堡垒 leanCap 4→2（其余堡垒字段/关卡已与出厂一致）⑥关卡无差异。
- sim：v2.14 断言改新值；v1.90/1.91 俯仰用例按 leanCap 2 重定标；v2.15 散射用例 angle 影响复核；版本卡/文档（炮塔+弹丸+堡垒三文档）/三处同步。

### v2.19 落地记录
- 全量 diff（python 对比口令 vs dump_defs）：实际差异仅 hunter 8 项、beam 3 项、ray_std 2 项、custom_ammo_1 新增、堡垒 leanCap；堡垒其余字段（v1.72 已沉淀）与关卡（出厂已 72×36 全空）零差异。
- 踩坑：① 俯仰 6 用例 cap 2 重定标——倒车刹停用固定窗口断言失败两次（0.35s=+1.14 上升沿、0.5s=-0.58 回摆），probe 采样发现欠阻尼振荡轨迹（峰值 +1.74@0.25s）→ 改 0.35s 峰值采样断言；② v2.14 两条出厂断言改写为 v2.19（保留历史块标题语义以新断言替代）。
- sim 修改点：弹丸库计数 4→5 两处、v2.19 beam/ray_std 出厂断言、俯仰 6 用例（±2 钳制/(-3,-2.2] 过冲/回弹 0.4~1/倒车峰值）。
- 验证：tsc 通过；sim ALL CHECKS PASSED；e2e 7/7（5 个 bundle 标记+挂载）；版本卡 2122e42。
- 文档：《炮塔编辑器设计》v2.19 详情+速览（主记）、《弹丸编辑器设计》v2.19 详情+速览、《堡垒编辑器设计》v2.19 速览互注，三处同步。

---

## v2.20（2026-08-18，已落地）导弹系统远行星号化七连改（前置量/出膛偏角/长烟尾/撞击炸/点火闪光/燃烧时间/真集束）

**需求**（用户，按优先级 1→2→6→4→7→3→9）：
1. 前置量追踪：TurretDef.guidance 'pursuit'|'lead'（缺省 pursuit 兼容；猎手出厂 lead）——迭代 1 次预估拦截点。
2. 出膛方向偏角：TurretDef.ejectAngle（度，延迟期内初始航向=炮塔向+偏角；缺省 0）。
6. 长存留烟雾尾迹：新 trail 模板（life ~3s/grow/drag 小/非加法 alpha 渲染）——粒子支持 blend 标志；集束导弹出厂挂烟尾。
4. 非制导沿途撞击：飞行中撞敌即炸（hitR 同制导 0.45），锁定点/射程终点爆炸保留。
7. 点火闪光（guideDelay 归零瞬间弹尾闪光+浓烟迸发）+ 发动机喷口焰（燃烧期弹尾 glow16 加法亮点，燃尽熄灭）。
3. 燃烧时间：TurretDef.burnTime——期内加速+喷焰，燃尽惯性滑行+尾焰/喷口焰熄灭（Projectile.t 全程计时）。
9. 真集束：TurretDef.split {count,spread,at:'proximity'|'burnout',range}——母弹消失裂为 N 颗子弹（伤害均分、不再分裂、继承制导/锁定）；猎手出厂 split {3,40°,proximity,25m}。
- 编辑器：导弹参数区补 guidance 下拉/ejectAngle/burnTime/split 组 + trail 模板新选项。
- sim：lead 拦截直线度/命中率、撞击炸、burnTime 燃尽加速停止、split 数量/伤害均分、点火事件；既有 hunter 用例复核（出厂 lead/split 影响）。
- e2e/版本卡/文档（炮塔主记+弹丸互注）/三处同步。

### v2.20 落地记录
- 实现口径：①guidance:'lead' 按弹采样目标位移/dt 估算速度（Enemy 无速度字段），tHit=distM/max(speed,1) 封顶 2s，重选目标同步重置采样基线；②ejectAngle 仅延迟期生效（出生航向=炮塔向+偏角）；⑥trail.smoke 组（rate 20/life 3/#9A958E 缺省）经 resolveTrailFx 下发，render 独立 smokeAcc 累积器 spawnTrail grow 1.6 → smoke32 非加法；④非制导（含延迟直飞期）沿途 dist≤size+0.45 撞敌即炸；⑦render 侧 projWasDelay 边沿检测点火闪光（spawnBurst '#ffd080' + 灰烟迸发），drawEngineGlow/主尾焰按 guideDelay>0 或 p.t≥burnTime 门控熄灭；③burnTime 期内加速，p.t 改全程计时（weave 语义等价）；⑨split 近炸/燃尽两时机，子弹伤害均分+splitDone 防再分裂+继承制导/锁定/flightLeft/弹龄，weavePhase 随扇角错开。
- 踩坑（关键）：updateMissile 在 projectiles.filter 迭代期触发分裂，直接 push 进 s.projectiles 会被 filter 长度缓存丢弃（子弹出生即消失、母弹白损）→ 模块级 splitSpawnQueue 缓冲，tick 两处 filter 后 drain 入数组。probe 复现：母弹在距目标 1 格处凭空消失且无伤害。
- 出厂沉淀：hunter guidance:'lead' + split {3,40,proximity,25}；custom_ammo_1 trail 加 smoke:{}（橙惯性火焰 + 长灰烟并存）。
- 编辑器：导弹区新增 制导律下拉（纯追踪/前置量）/出膛偏角/燃烧时间/集束四字段（数量·扇角·时机·距离，get/set 派生字段绕过 setPath 嵌套创建限制；FieldNumInput 兼容数值字符串 + onCommit 支持 f.set）。
- sim 新增 10 条：出厂断言×3、lead vs pursuit 横移目标航向领先对照、出膛偏角 90° 出生航向、burnTime 燃尽速度封顶、沿途撞击、近炸分裂 3 颗/伤害均分/母弹消失/防再分裂、燃尽分裂弹龄继承；既有 hunter 用例（13a/13b/延迟系列）在出厂 lead+split 下复核通过。
- 验证：tsc 通过；sim ALL CHECKS PASSED；e2e 12/12（10 bundle 标记 + 挂载 + 非空；iframe 路径须为 ./ 而非 ./index.html——react-router 不匹配 /index.html 会白屏）；版本卡 df9332f。
- 文档：《炮塔编辑器设计》v2.20 详情+速览（主记）、《弹丸编辑器设计》v2.20 详情+速览（smoke 组+点火闪光互注），三处同步。

---

## v2.21（2026-08-18，已落地）导弹三调整：制导恒前置量 / 烟尾时长可配置且≤燃烧时间 / 烟尾扩散后渐隐

**需求**（用户）：
1. 所有制导和延迟制导都是前置量追踪，取消专门选择制导律——删除 TurretDef.guidance 字段与编辑器下拉，引擎制导分支恒走 lead；猎手出厂 guidance:'lead' 一并移除（行为内建）。
2. 烟尾持续时间可配置（trail.smoke.life 已有，补弹丸编辑器 UI），且不能大于燃烧时间——render 按 min(smoke.life, 炮塔 burnTime) 钳制（clampSmokeLife 纯函数）；预览无炮塔上下文不钳（注释）。
3. 烟尾效果扩散后逐渐消失——Particle 新增 growUntil（膨胀截止年龄占比），stepParticles 超过后尺寸冻结；烟尾粒子 grow 1.6 + growUntil 0.4：前 40% 寿命膨胀扩散，之后尺寸冻结 alpha 随寿命渐隐至消失。
- 预览同步：ammoFxPreview trail 分支补 smoke 组粒子流（复用 st.smokeAcc，同战场参数）。
- sim：出厂断言改（hunter 无 guidance）、lead 恒前置量单测改写（去 pursuit 对照）、clampSmokeLife 单测、growUntil 尺寸冻结单测。
- e2e/版本卡/文档（炮塔+弹丸互注）/三处同步。

### v2.21 落地记录
- ① 制导恒前置量：删 TurretDef.guidance 字段 + hunter 出厂 guidance + 编辑器下拉；engine 制导分支恒走 lead（tgtPX/tgtPY 采样保留，首帧无基线退化直飞）。旧存档/口令中残留的 guidance 字段无害忽略。
- ② 烟尾时长可配置且 ≤burnTime：弹丸编辑器尾焰组补「烟尾」子组 UI（添加/删除 + 时长/速率/颜色，缺省 3s/20粒/s/#9A958E）；clampSmokeLife 纯函数（art.ts）render 侧按 min(life, 炮塔 burnTime) 钳制；弹丸预览无炮塔上下文不钳（注释说明）。
- ③ 烟尾扩散后渐隐：Particle 新增 growUntil（膨胀截止年龄占比），stepParticles 超过后尺寸冻结；烟尾 grow 1.6 + growUntil 0.4 → 前 40% 寿命膨胀扩散、之后尺寸冻结 alpha 随寿命渐隐至消失；预览（ammoFxPreview trail 分支）同参数同步。
- 踩坑：sim 新 growUntil 用例用了未导入的 spawnTrail → ReferenceError 中断（esbuild 打包不做类型检查）；node_modules 再次被环境清理 → npm ci 恢复（工作区与 output/app 各一次）。
- sim：v2.20 出厂断言改写（猎手无 guidance）、①用例改恒 lead 单跑（去 pursuit 对照）、新增 clampSmokeLife 单测 + growUntil 尺寸冻结/寿命移除单测；e2e 9/9（5 新标记 + 纯追踪/制导律移除断言 + 挂载 + 非空）。
- 验证：tsc 通过；sim ALL CHECKS PASSED；版本卡 ae8053e。
- 文档：《炮塔编辑器设计》v2.21 详情+速览（主记①②钳制互注）、《弹丸编辑器设计》v2.21 详情+速览（主记②③），三处同步。

---

## v2.22（2026-08-18，已落地）删除炮塔人员/最少人员参数

**需求**（用户）：删除炮塔人员、最小人员参数。
- 范围：TurretDef.crew/minCrew 字段 + 7 条出厂定义；Turret.crewAssigned（3 处生成点 + render 预览 mock）；crewFactor 机制（§6.1 人员减益：低于最少人员停工 + 人员缺失按比例降低转速/射速）——factor 恒 1；DebugPanel 人员/最少人员两字段；GamePreview 选中炮塔人员显示；sim mkTurret + 用例 8（人员不足停工）移除。
- 兼容：旧存档/口令残留 crew 字段无害忽略。
- sim/e2e/版本卡/文档（炮塔主记）/三处同步。

### v2.22 落地记录
- 删除面：TurretDef.crew/minCrew 字段（§4.6 注释改「占格与生存」）+ 7 条出厂定义值（sed 批量剥离，逐行复核）；Turret.crewAssigned（interface + 3 处生成点 + render 编辑器伪炮塔 mock）；crewFactor 函数（§6.1 人员减益：低于最少人员停工 + 缺失按比例降转速/射速）→ factor 恒 1 常量保留下游公式不变；DebugPanel 人员/最少人员两字段；GamePreview 选中炮塔「n/N人」显示行（Users 图标引用一并清理）；sim mkTurret + 用例 8 改写为出厂断言（TURRET_DEFS 无 crew/minCrew 残留）。
- 兼容：旧存档/口令残留 crew 字段无害忽略（不再读取）；行为变化=炮塔恒全效率（此前出厂均满员，实际无差异）。
- 验证：tsc 通过；sim ALL CHECKS PASSED（含 v2.22 出厂断言）；e2e 7/7（最少人员/crewFactor/crewAssigned 移除断言 + splitDone/烟尾保留断言 + 挂载 + 非空）；版本卡 91fb3a1。
- 文档：《炮塔编辑器设计》v2.22 详情+速览（纯炮塔侧，无弹丸互注），三处同步。

---

## v2.23（2026-08-18，已落地 33c790a）烟尾寿命/持续 + 制导两档 + 点火大力喷射

**需求**（用户）：
1. 烟尾「时长」改名「寿命」，取消寿命 ≤ 燃烧时间的钳制（移除 clampSmokeLife）。
2. 烟尾新增「持续」duration：点火后一段时间内喷烟尾，结束后关闭；持续 ≤ 燃烧时间（art.smokeDuration 纯函数钳制；缺省=整个燃烧期）。引擎记录 Projectile.igniteAtT（出生延迟秒数，子弹=分裂时刻弹龄），render 按 p.t - igniteAtT 判定烟尾窗口；预览按 st.t 同步。
3. 制导模式下拉 3 档→2 档（常规/制导）：原「延迟制导」并入「制导」（guideDelay>0 即延迟制导，延迟时间字段保留）；set 制导不再清 guideDelay/guideDecel。
4. 点火闪光（spawnBurst 闪光+浓烟）改为大力喷射尾焰：点火后 1s 主尾焰 rate×3/size×1.6，之后转常规；projWasDelay 边沿检测移除（改用 p.t - igniteAtT < 1，纯游戏时间）。
- sim：clampSmokeLife 用例→smokeDuration 用例；e2e/版本卡/文档（弹丸主记+炮塔互注）/三处同步。

### 落地记录（v2.23）
- config.ts：trail.smoke 增加 `duration?: number`（持续，秒；缺省=整个燃烧期）；注释同步。
- art.ts：clampSmokeLife 删除 → 新增 `smokeDuration(duration, burnTime)`（duration 未配返回 undefined；配了 burnTime 则取 min）。
- engine.ts：Projectile 新增 `igniteAtT`（点火时刻弹龄：出生时=制导延迟，集束子弹=分裂时刻弹龄，无延迟=0）。
- render.ts：projWasDelay 边沿表删除；点火闪光改为大力喷射尾焰 `boost23 = 点火后 <1s`（主尾焰 rate×3、size×1.6，1s 后转常规）；烟尾按窗口 `p.t - igniteAtT < smokeDuration(duration, burnTime)` 判定开关。
- DebugPanel.tsx：烟尾「时长(s)」改名「寿命(s)」且不再钳制；新增「持续(s)」（tip 注明 ≤ 燃烧时间钳制、缺省整个燃烧期）；制导模式下拉 3 档→2 档（常规/制导，延迟制导并入制导，延迟时间字段保留）。
- ammoFxPreview.ts：烟尾按 `st.t < duration` 同步持续窗口。
- 验证：tsc 0 错；sim ALL CHECKS PASSED（smokeDuration 四断言 + igniteAtT=0.4）；e2e 7/7（持续(s)/寿命(s)/igniteAtT/splitDone HIT、clampSmokeLife MISS、画布 600x360 非空白）。
- 版本卡 33c790a。

## v2.24（2026-08-18，已落地 7b6ea75）大力喷射→常规尾焰数值过渡 + 预览同步

**需求**（用户）：主尾焰转常规尾焰的数值是有过渡的。
- render.ts：boost23 布尔 → 线性系数 b24 = clamp(1 - (p.t - igniteAtT)/1, 0, 1)；rate ×(1+2b24)（3→1）、size ×(1+0.6b24)（1.6→1），1s 内连续回落。
- ammoFxPreview.ts：主尾焰同系数同步（预览起播=点火，st.t 代入），补齐 v2.23 未同步的大力喷射。
- sim 回归 / e2e / 版本卡 / 弹丸主记+炮塔互注 / 三处同步。

### 落地记录（v2.24）
- render.ts：boost23 布尔 → 线性系数 `b24 = 1 - (p.t - igniteAtT)`（<1s 内）；主尾焰 rate ×(1+2·b24)（3→1）、size ×(1+0.6·b24)（1.6→1）连续回落，门控（导弹/发动机开/非渐隐）不变。
- ammoFxPreview.ts：补齐 v2.23 未同步的大力喷射——预览起播=点火，同系数 b24=st.t<1?1-st.t:0 同步 rate/size 回落。
- 验证：tsc 0 错；sim ALL CHECKS PASSED；构建通过；e2e 8/8（含 boost23 移除断言 + 画布 600x360 非空白）。版本卡 7b6ea75。

## v2.25（2026-08-18，已落地 3569249）删除几何导弹尾焰线

**需求**（用户）：把几何降级渲染下导弹尾部那条淡黄色线去掉。
- render.ts：无贴图导弹分支删除尾焰线 stroke（保留圆点弹体与喷口 glow），vh 若无他用一并清理。
- sim 回归 / e2e / 版本卡 / 弹丸主记+炮塔互注 / 三处同步。

### 落地记录（v2.25）
- render.ts 两处导弹几何尾焰线全删：① 无贴图降级分支（vh 黄线 stroke + vh 局部变量）；② 贴图弹无尾焰配置分支（导弹 0.5 格黄线），子弹曳光线（px,py→x,y，#F5E9C8）保留。导弹尾部表现统一交给粒子尾焰/烟尾与喷口 glow，无配置即无尾迹。
- 验证：tsc 0 错；sim ALL CHECKS PASSED；构建通过；e2e 6/6（240,220,160 MISS、#F5E9C8 HIT、画布 600x360 非空白）。版本卡 3569249。

## v2.26（2026-08-18，已落地 7a8290b）删除本地文件夹直连

**需求**（用户）：本地文件夹直连功能去掉，目前用不到（日常调参走编辑器即时生效，沉淀走发 json 给开发）。
- DebugPanel.tsx：删「本地」按钮（FolderOpen）、localOpen/dirHandle/localMsg/localBusy 状态、localConnect/localSave/localLoad、直连小窗 JSX、localFolder 导入与挂载恢复逻辑。
- 删除 src/game/localFolder.ts；全局 grep 确认无残留引用。导出/导入口令保留。
- 全流程验证（删功能）：tsc/sim/e2e（showDirectoryPicker、td-config.json MISS）/版本卡/炮塔主记+弹丸互注/三处同步。

### 落地记录（v2.26）
- DebugPanel.tsx：删「📁 本地」按钮、localOpen/dirHandle/localMsg/localBusy 状态、句柄恢复 useEffect、localConnect/localSave/localLoad、直连小窗 JSX、lucide FolderOpen 与 localFolder 两组导入；applyConfigSmart/exportConfigJson 面板侧导入一并清理（config_transfer 中函数保留，sim 口令/JSON 恒等测试仍在用）。
- 删除 src/game/localFolder.ts。导出/导入口令功能不受影响。
- 验证：tsc 0 错；sim ALL CHECKS PASSED；构建通过；e2e 8/8（showDirectoryPicker/td-config.json/连接文件夹 MISS，导入/导出/splitDone HIT，画布 600x360 非空白）。版本卡 7a8290b。

## v2.27（2026-08-18，快速通道，已落地 d3d36ff）猎手参数 + 炮位固定视角

**需求**（用户快速改）：猎手 guideDelay 0.8 / guideDecel 10 / missileInitSpeed 20 / burnTime 5 / 移除集束 split；堡垒炮位 hp9-909 fixed 90°、hp8-584 fixed -90°。
- 落地：config.ts 三处编辑；tsc 0 错；构建通过。（快速通道：sim/e2e/文档攒批后补）

## v2.28（2026-08-18，快速通道，已落地 50cef7c）烟尾参数移到尾焰组最下面

**需求**（用户）：烟尾部分的参数放置在尾焰最下面。
- 落地：fxGroup 新增底部槽 bottom（渲染在全部数值字段之后）；弹丸编辑器尾焰组的烟尾子组从顶部 extra 挪入底部槽（模板/渐变色仍在顶部，颜色+数值字段居中，烟尾垫底）。tsc 0 错；构建通过。

## v2.29（2026-08-18，已落地 70b6eff）堡垒编辑器撤销/重做

**需求**（用户，评估①）：FortressTab 历史栈（cap 50）——mutate 压快照、拖动 transient 合并（pointerdown 快照一次）、按钮 + Ctrl+Z/Ctrl+Shift+Z、切换/保存/新建/复制清空。
- 全流程验证；炮塔主记（编辑器域）+ 堡垒文档互注。

## v2.30（2026-08-18，已落地 594b9c4）模块编辑器 + 素材库模块分类 + 模块贴图锚定

**需求**（用户，评估②+追加）：
1. assetlib 新增「模块」分类（ASSET_CATEGORY_NAME + 类型）。
2. ModuleDef.asset?: string（素材库引用）；render 模块贴图优先、缺省色块回退。
3. MODULE_DEFS 注册表化：persist 通道 td-module-defs（splice 覆盖，同 TURRET_DEFS 模式）+ 恢复出厂。
4. DebugPanel 新增「模块」页签：列表（新建/复制/删除/恢复出厂）+ 表单（基础字段/加成字段/produce 子组/贴图锚定模块分类下拉）。
5. 校验：id 唯一、w/h≥1、cost≥0、produce.kind 合法。
6. config_transfer 版本 3→4：bundle 加 moduleDefs，低版本导入不动模块库。
7. sim 用例：持久化往返 / 口令 v4 往返 / 非法拒收。
- 全流程验证；堡垒主记 + 炮塔互注（素材分类）。

### 落地记录（v2.29）
- DebugPanel.tsx FortressTab：histRef 历史栈（stack/idx/lastPush，cap 50）；mutate 压栈（首次编辑记基线、800ms 窗口合并连续输入、撤销后再编辑截断 redo 分支）；undo/redo 函数 + 操作行「撤销/重做」按钮（禁用态）；window keydown（Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z，输入框内放行原生撤销）；select/save 清空历史（新建/复制/删除经 select 覆盖）。
- sim 顺带修正 v2.27 快速通道欠账：猎手出厂断言改为 split 不存在；近炸分裂用例临时挂回 split（机制测试与出厂配置解耦）。
- 验证：tsc 0 错；sim ALL CHECKS PASSED；构建通过；e2e 5/5（histRef 为局部变量名被 minify 属正常，已改用 撤销/重做 标记）。版本卡 70b6eff。

### 落地记录（v2.30）
- assetlib.ts：AssetCategory 新增 'module'（素材库「模块」分类，上传/改分类可选）。
- config.ts：ModuleDef.asset?: string（素材库引用，缺省色块回退）。
- render.ts：模块绘制贴图优先（库引用经 assetImage/srcImage 加载，按占格拉伸、rot=1 随转 90°），缺省原色块+名称；建造卡片（GamePreview）图标同步贴图/Zap 回退。
- persist.ts：td-module-defs 通道（序列化/解析/load splice/saveModuleDefs 入 saveAll/resetPersistedToDefaults 含模块库）+ resetModuleDefsToFactory（常量声明前置避免 TDZ）。
- config_transfer.ts：bundle 版本 3→4 携带 moduleDefs；校验支持 1/2/3/4 + moduleDefs 形状；导入 v4 splice 覆盖（v1~v3 不动现有库）。
- DebugPanel.tsx：新增「模块」页签 ModuleTab——列表（新建/复制/删除/全部恢复出厂）+ 表单（id/名称/造价/占格/颜色/描述 + 贴图锚定下拉（模块分类，带缩略图）+ 10 项加成字段（留空无加成）+ 生产子组（士兵/坦克/战斗机 + 周期/存活上限）+ 校验提示：id 唯一、w/h≥1、cost≥0、produce 合法）。改动经父级 bump 即时落盘。
- sim：口令版本断言 3→4；新增 v2.30 两用例（v4 往返恒等 + v3 旧口令不动模块库 + 非法拒收；出厂模块无 asset）。
- 验证：tsc 0 错；sim ALL CHECKS PASSED；构建通过；e2e 7/7（td-module-defs/模块/全部恢复出厂/无（色块+名称）/moduleDefs HIT + 画布非空白）。版本卡 594b9c4。

## v2.31（2026-08-19，已落地 cb99d47）模块异型占格（铺格 L/T 型）

**需求**（用户）：模块占格不一定是标准矩形，可能 L/T 型，用铺格方式确定占格。
- config：ModuleDef.shape?: string[]（"x,y" 未旋转局部格，缺省=w×h 矩形）。
- engine：moduleBaseCells/moduleCells（rot=1 绕包围盒 90°）；canPlaceModule/重叠/moduleSpecialMult 逐格化。
- render：已放模块逐格渲染（贴图按格源矩形裁切；色块逐格+描边）；interiorGhost 加 cells 逐格幽灵。
- GamePreview：幽灵/拆除命中逐格化。
- ModuleTab：铺格画布（点击切换、全满=矩形=shape 缺省、连通性提示、w/h 变更裁剪越界格）。
- sim：L 型旋转映射/异型放置与重叠/特殊格逐格/出厂无 shape。全流程验证；堡垒主记。

### 落地记录（v2.31）
- config.ts：ModuleDef.shape?: string[]（"x,y" 未旋转局部格集合，在 w×h 包围盒内；缺省 = 全满矩形，出厂 13 模块均无 shape）。
- engine.ts：moduleFoot 语义不变（仍=包围盒）；新增 moduleBaseCells（越界格忽略、空集回退全满矩形）/moduleCells（rot=1 映射 (x,y)→(h-1-y,x)）/moduleInstCellSet；canPlaceModule 逐格判定（内部集合 + Set 交集查重叠）；moduleSpecialMult 逐格覆盖（异型空洞不触发特殊格）。
- render.ts：已放模块逐格渲染——贴图按格做源矩形裁切（rot=1 逆映射 sc={x:c.y, y:md.h-1-c.x}），色块回退逐格填充+描边；interiorGhost 加 cells?: {x,y}[] 支持逐格幽灵。
- GamePreview：放置幽灵逐格显示；拆除命中逐格查找。
- DebugPanel ModuleTab：铺格 SVG 画布（22px 格，点击 toggleCell：矩形模式首击创建 shape 并挖掉该格、空格→['0,0']、补满全格→删 shape 回矩形）；w/h 变更裁剪越界格；连通性 BFS 仅警告不禁止。
- sim：新增用例 52b 共 10 项——L 型 0°/90° 旋转映射、无 shape=全满矩形、L 可放、洞位 (1,0) 可铺 1×1、被占格拒绝、洞位放不下 2×2、空洞不覆盖特殊格（倍率 1）、铺满洞位触发 SPECIAL_MULT（临时挂 interiorSpecials 用后恢复）、出厂模块均无 shape。
- 验证：tsc 0 错；sim ALL CHECKS PASSED；构建通过；e2e 4/4（铺格UI/连通警告/包围盒提示/画布非空白 HIT）。版本卡 cb99d47。

## v2.32（2026-08-19，已落地 ed216c9）模块铺格底格固定 5×5 + id 自动化

**需求**（用户）：铺格底格固定 5×5，默认中心一格彩色、其他白色；取消 id 输入框。
- ModuleTab：铺格画布固定 5×5，占格按包围盒居中显示；点击切换后重算包围盒并归一化 shape（w/h 派生只读，移除 w/h 输入与裁剪逻辑）；至少保留 1 格；空格填充白色。
- 新建模块默认 w=h=1（即中心一格彩色）；id 自动生成（唯一兜底）+ 只读展示，移除输入框。
- 引擎不变（shape 语义不变）；sim 回归 + e2e + 文档同步，全流程。

### 落地记录（v2.32）
- DebugPanel ModuleTab：铺格底格固定 5×5（GRID5），占格按包围盒居中（offX/offY=(GRID-w)/2）；toggleCell 改为全格集切换后重算包围盒并归一化 shape——w/h 成为派生只读（移除 w/h 输入与越界裁剪逻辑），至少保留 1 格，全满包围盒自动删 shape 回矩形。
- 空格填充改白色（#FFFFFF），新建模块默认 w=h=1 → 呈现为中心一格彩色。
- id 输入框移除：genId 唯一兜底自动生成（新建/复制），表单 id 改只读文本；新增「包围盒 w×h（铺格自动）」只读展示。
- 遗留兼容：v2.31 期 w/h>5 的持久化模块，画布临时放大到容下包围盒（GRID=max(5,w,h)），附红色提示，挖格收缩后自动回 5×5。
- 引擎零改动（shape 语义不变）。验证：tsc 0 错；sim ALL CHECKS PASSED；构建通过；e2e 4/4（铺格自动/底格固定 5×5/占格铺格 HIT + 画布非空白）。版本卡 ed216c9。

### 事故记录（v2.32b，2026-08-19）：内置素材不显示
- 现象：素材库内置条目图片全部裂图（/res/* 404）。
- 根因：vite.config `build.copyPublicDir=false`（fuse 挂载不支持 copy_file_range），public 必须构建后 `rsync -a public/ dist/` 手动补拷；v2.31/v2.32 两次流水线漏了这一步（e2e 只校验 JS 标记与画布非空白，未能发现）。
- 修复：重新构建 + 补拷，HTTP 验证 res/library·beam·fx 200。版本卡 4b6ee43。
- **流水线规约（此后必须执行）**：`npm run build` 后立刻 `rsync -a public/ dist/`，并抽查 `dist/res/` 存在；e2e 增加一项内置贴图 200 校验（如 res/library/shell_s.png）。

## v2.33（2026-08-19，已落地 7b62eed）导弹载体速度继承

**需求**（用户）：猎手导弹在堡垒移动中不出现在炮口——根因是弹丸不继承堡垒移动速度；确认实现出生瞬间速度合成方案。
- engine：fireGunShot 导弹分支，挂载炮塔（hardpointId）出生速度向量 += 堡垒 vx/vy（格/s×M_PER_CELL），合成后折回 航向+标量初速；抵消归零保持原航向；地面炮塔不继承；制导阶段不变。
- sim：用例 13c（挂载继承初速/航向精确断言 + 地面不继承负对照；missileCurve 临时置 0 抗干扰）。

### 落地记录（v2.33）
- engine.ts fireGunShot：`let h/speed0` 可变（合成时覆写）；t.hardpointId 时向量合成（fvx=s.fortress.vx×25），v0>1e-6 才覆写（防对消乱航向）。
- 关键顺序依据：tick 内 堡垒机动(更新vx)→…→炮塔开火→弹道推进，出生 tick 后读 s.fortress.vx 即开火所用值（sim 断言锚点）。
- sim 用例 13c 共 7 项全过；mountTurret 仅 prep 生效（用例用 fresh() 挂载后切 combat）。
- 验证：tsc 0 错；sim ALL CHECKS PASSED；构建+public 补拷；e2e 2/2（内置贴图 200 + 画布非空白；行为由 sim 兜底——压缩产物无对应字符串标记）。版本卡 7b62eed。
- 顺带补文档欠账：v2.27 猎手参数/集束移除 → 炮塔文档速览；hp8-584/hp9-909 固定视角 → 堡垒文档速览。

## v2.34（2026-08-19，已落地 c9c6536）弹丸预览整合「播放/停止」全程动画

**需求**（用户）：弹丸编辑器预览整合为单个「播放/停止」，动画=从左飞行到右端命中/爆炸全过程。
- ammoFxPreview：AmmoFxMode + 'seq'；状态机 phase 0=飞行/1=爆发等待；到达命中点（worldW-2）按配置触发 命中碎屑+爆炸爆发；结束后停顿循环（t 归零=重新点火）；canPlay(seq)=任一效果已配置（ray 恒可播=光束持续）；新增 simAmmoSeq。
- AmmoPreview：三按钮整合为单「播放/停止」；弹体仅飞行段绘制；命中闪光/爆炸环改在右端命中点；ray 的 seq=光束持续发射。
- sim：seq 门控/飞行粒子/爆发计数/循环重置/命中点位置。全流程；弹丸文档主记。

### 落地记录（v2.34）
- ammoFxPreview.ts：AmmoFxMode+'seq'；AmmoFxState+phase（0=飞行/1=爆发等待）；FX_SEQ_HIT_X=worldW−2；trailEmit 提取共用；seq 分支——飞行段推进+尾焰、到点同帧触发命中碎屑+爆炸爆发、max(duration)+0.9s 停顿后循环（t 归零=重新点火）；canPlay(seq)=任一效果已配置/ray 恒可播；新增 simAmmoSeq。ray 的 seq 走原 trail 光束分支。
- DebugPanel AmmoPreview：三按钮→单「播放/停止」（停止态红底 Square）；弹体仅 phase 0 绘制；命中/爆炸闪改命中点；AMMO_FX_MODE_NAME 导入移除（未用）。
- sim 用例66 新增 6 项全过（门控/循环/爆发16/命中点/同帧21/射线持续）。
- 验证：tsc 0 错；sim ALL CHECKS PASSED；构建+public 补拷；e2e 4/4（循环至停止/未配置任何效果 HIT + 内置贴图 200 + 画布非空白）。版本卡 c9c6536。

## v2.47（2026-08-19，已落地 011741a）实弹爆炸：直射炮支持爆炸半径/爆炸伤害

**需求**（用户）：实弹（直射）也需要爆炸半径和爆炸伤害参数。
**现状**：编辑器 blastRadius/blastEffect 字段本就无类型门控（所有炮塔可见可编），缺口在引擎 updateBullet 不吃这两个参数。
**落地**：updateBullet 命中每个目标时，blastRadius>0 → 在命中点 explode（伤害基底 0——直击已按穿透衰减结算，爆炸附加/燃烧由 blastEffect 提供；遮挡豁免/物体波及/弹丸库爆炸帧图与榴弹同 explode 口径；穿透多目标逐目标各爆一次）；命中阻挡物体同样触发爆炸（替代原 0.3 格小火花，物体摧毁由 explode 9999 波及结算）。编辑器两处 tip 补充直射说明。出厂配置不变（mg 等不加爆炸）。
**sim**：+2 条（克隆 mg 改 accuracy 0 + blastRadius 50/blastEffect 10：主目标每发 15=直击5+爆炸10、波及 10、范围外 0、一轮 6 爆；mg 未配置命中无爆炸事件）。
**调试记录**：① 索敌打分 = distToFortress（离堡垒最近优先）——布点须让直击目标离堡垒最近；② 爆炸事件 ttl 0.35s 衰减快，须逐 tick 计数不能终态数；③ LEVEL 默认 (5,8) 油桶被子弹爆炸 9999 波及殉爆 + 燃烧区持续掉血（行为正确！ explode 物体波及与榴弹同口径）——用例须 s.objects=[] 隔离环境物体。
**验证**：tsc ✓ → sim ALL CHECKS PASSED ✓ → build+public ✓ → e2e CANVAS_OK ✓ → 版本 011741a。

## v2.46（2026-08-19，已落地 6bc317b）无尾焰配置 = 无任何默认尾焰 + v2.45 sim 重定标

**需求**（用户）："所有弹药，如果不添加尾焰，就不要加默认尾焰。"
**根因**：resolveTrailFx 本身无配置即 null，但 render 有两处默认回退——① 子弹（bullet）无尾焰时画程序化曳光线（贴图/几何两分支各一处）；② 导弹喷口 glow「默认所有导弹生效，无配置项」。
**落地**：删两处子弹曳光线回退（几何分支补小圆点弹体避免隐形）；喷口 glow 两分支改随 `resolveTrailFx(pa)` 门控（有尾焰配置才画）；engine 旧注释同步。预览本就无默认尾焰（天然一致）。
**sim**：+1 条 v2.46（无 trail → null / 空组 trail → 模板缺省，自足构造防注册表污染——教训：sim 末尾断言勿依赖前文未隔离的注册表状态）。**顺带完成 v2.45 欠账**：口令(5)出厂变动的 11 处断言重定标——mg（伤5/速2/精12）、弹丸库 5→6、beam 转速 100、COLS 42、迁移用例 cols、波次投射物（敌 hp 30→65 第三轮首发致死）、轮流跨轮窗口 2.2→5s、废墟/自定义物体用例钉敌（walker.speed=0 临时）+ hp 130→60、自由格阵跨格模块 armor_plate→ammo_factory。ALL CHECKS PASSED；e2e CANVAS_OK；版本 6bc317b。

## v2.45（2026-08-19，已落地 d5a9919，快速通道）口令(5)沉淀为出厂默认

**需求**（用户口令"快速通道"）：将附件口令(5)导入 = 沉淀为出厂默认。
**沉淀清单**（全量 diff 复验零差异）：新炮塔×2（加农炮 custom-1787149972481-1 / 大型双联加农炮 custom-1787150582922-2，均挂新弹丸）；新弹丸 custom_ammo_2 炮弹（shell_m+爆炸+命中）；mg 伤12→5/速1→2/精1.5→12；巡航 rangeMax 300→400；猎手 guideDelay 0.8→0.5/guideDecel 10→15/missileCurve 20→10/4 管挂点炮口重排；beam 转速 90→100；火箭+默认烟尾、集束导弹烟尾持续 1s；堡垒+6 特效点（双排烟×4 move + 尘土×2 both）；模块 兵工厂/弹药库/散热器 h 2→1、复合装甲 w 2→1、兵营→机器人模块/坦克制造厂→坦克制造模块/机场→无人机模块；战场 COLS 36→42。
**踩坑**：output/app node_modules 被环境清空 → 构建脚本 tsc 缺失静默失败（管道 tail 掩盖退出码），dist 未更新差点发旧版；补 npm ci 重建。教训：构建后必须确认 "✓ built" 字样。
**欠账**：快速通道跳 sim → 11 处出厂断言待重定标（已在 v2.46 流程完成）。

## v2.44（2026-08-19，已落地 201405d）修复预览大力喷射弹种门控：实弹预览与实战一致

**需求**（用户）：发现实弹也有大力喷射——经查实战无（render b24 仅 `kind==='missile'` 生效），是**预览门控缺失**（ammoFxPreview `b24 = st.t<1 ? 1−st.t : 0` 不分弹种），违反"主界面与预览效果同步"规则。用户决策：以实战为准，预览去掉实弹大力喷射。
**落地**：trailEmit + boost 参数（`pa.kind === 'missile'` 传入），trail/seq 两调用点同步。sim +1 条（同配置实弹 0.5s=60 粒无爆发 vs 导弹 ≈150 粒）。ALL CHECKS PASSED；e2e CANVAS_OK；版本 201405d。

## v2.43（2026-08-19，已落地 410ffa5，快速通道）履带印透明度 0.25 + 10s 渐隐

**需求**（用户口令"快速通道"）：印透明度 0.38→0.25，渐隐 2.4s→10s。
**落地**：fortressFx 抽常量 TRACK_MARK_ALPHA=0.25 / TRACK_MARK_FADE=10 / TRACK_MARK_LIFE 6→12（前 2s 全亮 + 末 10s 线性渐隐）；render 渐隐公式改时间口径（原 60%/40% 比例式废弃）。tsc ✓ → build+public ✓ → 版本 410ffa5（快速通道：跳 sim/e2e/文档）。

## v2.42（2026-08-19，已落地 d1cebb8）履带印即时可见：启动即印 + 印落履带后端

**需求**（用户）：印子要在堡垒开动一段时间后（开出约半个船长）才显示，真实应启动后很快可见。
**根因**：① 首印阈值——位移需累满一个印距（1 格）才落第一印；② 更主要——印落在履带段**中点**，被 5×8 格船体压在底下，要开出半个船长印才从船尾露出。
**方案**：静止→移动瞬间立即落"启动印"（履带本就压着地面，间距后续仍按 acc 步进）；接地点由段中点改为**段的运动方向后端**（局部 −y=前进，速度≈0 时仍取中点），印从船尾缘即时露出；倒退时自然取前端。

**落地记录（d1cebb8）**
- fortressFx.ts：TrackMarkState + moving[]（静止→移动沿 |d|>1e-9 判定）；世界速度→船体局部（lvx=vx·cos+vy·sin，lvy=−vx·sin+vy·cos，与 dirX/dirY 约定一致），接地点 gx/gy = 段方向 dot 局部速度 >0.05 取 (x1,y1)、<−0.05 取 (x2,y2)、否则中点；启动印 push 在步进循环前（余量照常累计，不密不疏）。
- render.ts：trackMarkSt 字面量与重开清空 + moving 字段。
- sim：v2.41 用例数量期望随启动印更新（前进 6→8、差速 7→9、倒退 9→11；镜像侧首印 marks[3]→marks[4]，速度为 0 落点仍为中点断言不变）；+2 条 v2.42（0.05 格微动即印且余量保留；前进印落 y2 端/倒退印落 y1 端）。ALL CHECKS PASSED。
- 全流程：tsc ✓ → sim ✓ → build+public ✓ → e2e CANVAS_OK ✓ → 版本 d1cebb8。

## v2.41（2026-08-19，已落地 a50ed13）履带印：按各侧履带真实位移落地的瓦片压印

**需求**（用户）：堡垒特效优化阶段二——履带印子效果。
**方案**（v2.40 详情中预告并获"继续"确认）：不重算位移，复用引擎 `fortress.trackPhase[]`（每侧位移累加，弧线差速/倒退反向天然正确）；每侧累计位移每满一个瓦片有效步长落一印；印=压暗的履带瓦片贴图，走地面层（地形之上、底座之下），6s 渐隐。

**落地记录（a50ed13）**
- fortressFx.ts（纯函数可 sim）：TrackMark{x,y,angle,born,tile} + TrackMarkState{acc,prevPhase} + TRACK_MARK_LIFE=6 / TRACK_MARK_CAP=600；trackMarkStep(tileHPx,overlapPx)=max(0.2,(图高−overlap)/30) 格；updateTrackMarks（过期清理 → 履带数变化锚定不爆发 → 每履带×每侧 acc+=相位差，|acc|≥step 则同点连落至不足 step，余量带符号保留（倒退先抵正余量）→ 世界坐标=履带段中点随 heading 旋转，镜像侧 x=fd.w−mx → 超 600 FIFO）。
- render.ts：模块态 trackMarks/trackMarkSt/trackMarkTime（时间回退=重开 → 清空）；绘制块在 groundPool 之前（同为地面层、印在尘土之下）：tintedFx(瓦片,'#2E2A24') 压暗 + alpha 0.38、60% 后线性渐隐、随 zoom 缩放、随 s.time−born 消失；编辑模式不产印。
- sim：+3 条（印距计算与 0.2 下限；前进 3 格 6 印→差速余量 0.5/0.75→倒退 2 格净 −1.5/−1.25 各 1 印共 9 印+落点世界坐标；过期清理+容量 FIFO）。修正：同侧连落印同坐标，镜像侧断言应取 marks[3] 而非 marks[1]。
- 全流程：tsc ✓ → sim ALL CHECKS PASSED ✓（期间 esbuild 曾因 node_modules 波动报 2 errors 致跑了旧 bundle，重打包后即过）→ build+public 补拷 ✓ → e2e CANVAS_OK + 资源 200 ✓ → 版本 a50ed13。

## v2.40（2026-08-19，已落地 fb0298f）堡垒特效点粒子化 + 粒子双通道分层

**需求**（用户）：① 已散发的烟雾不应跟着堡垒移动（现状：程序化圆点锚在发射点随船体变换，非真粒子）；② 需要底座以下层级的尘土效果。
**方案**（用户确认推荐默认值）：特效点改真实世界粒子（离口独立，inherit 默认 dust 0.3/其余 0）；粒子池拆 groundPool（地形之上/底座之下）+ fxPool（空中层维持最上）；FortressEffectPoint + layer/rate/size/life/inherit（带缺省）；编辑器加层级下拉。

**落地记录（fb0298f）**
- config.ts：FortressEffectPoint + layer/rate/size/life/inherit；FortressEffectLayer + EFFECT_LAYER_NAME（ground=地面（底座下）/air=空中（最上））。
- 新 fortressFx.ts（纯函数可 sim）：KIND_DEFAULTS（smoke air/8粒/s/1.3s/inherit0；flame air/24/0.28/0；dust ground/14/0.9/0.3；spark air/7/0.22/0）；effectParams 覆盖优先；effectWorldPos（fortressRect 中心 + heading 旋转，与 render 堡垒上下文同变换）；emitFortressEffects（状态门控 idle/move/both + rate 累加器 Map + layer 路由双池；粒子视觉：smoke=smoke32 上升 grow、flame=加法金→橙 flicker、dust=smoke32 横向弥散+继承前扬、spark=streak 亮线）。
- render.ts：+groundPool 与 step；粒子绘制抽 drawParticlePool（两通道共用， ground 在堡垒块前调用、air 维持末尾）；删旧程序化特效块（约 60 行）；每帧 `if (!ui.edit) emitFortressEffects(...)`。注意：删块时误删一层 `}` 致 TS1005，已补回（同文件编辑教训：删大括号块先数平衡）。
- engine validateFortressDef：fx 参数范围校验（rate 0~120 / life 0~10 / size 0~2 / inherit 0~1）——inline 而非调 fortressFx.validateEffectPoint（避免 engine↔fortressFx 循环依赖）。
- DebugPanel：特效点行加层级下拉（缺省 dust=ground 其余=air）。
- sim：+3 条（缺省/覆盖、heading 旋转换算、门控+路由+继承 vx=3×0.3+0.2=1.1）。ALL CHECKS PASSED。
- 全流程：tsc ✓（effectWorldPos 未用 fd 参数 TS6133 → 删参）→ sim ✓ → build+public ✓ → e2e ✓ → 版本 fb0298f。
- 阶段二 → v2.41 履带印（见上节，已落地 a50ed13）。

## v2.39（2026-08-19，已落地 f3cd0f9）摇杆扇区重定 + 迟滞死区取代 ±10° 吸正

**需求**（用户确认）：① 前进档锁定扇区 ±90°→±120°；② 倒退档锁定扇区改为正后方 ±60°（即 |偏角|≥120°，两扇区在 120° 衔接）；③ 删除 v1.51 ±10° 吸正；④ 迟滞死区防抖：<3° 进直行（视为 0°/180°）、>6° 退出、3~6° 保持原状态。
- GamePreview.tsx 摇杆块：首推定档阈值 90°→120°；fwd 钳制 ±120°；rev 钳制到 ±120° 边界（正后 ±60°）；删吸正；joyRef +straight 迟滞标志。引擎零改动。
- 完整流程；堡垒编辑器设计（操控章节）主记。

**落地记录（f3cd0f9）**
- GamePreview.tsx：joyRef 类型 +straight（初始 true、松手随 joyRef 置空复位）；SECTOR=2π/3 常量统一首推定档与双向钳制边界；删 v1.51 ±10° 吸正；迟滞死区块（near<π/60 进直行、>π/30 退出、straight 时指令角吸 0/π）；**stickForView 取钳制后吸正前的值——摇杆头视觉不再被吸正劫持**（v1.51 会吸到正中）。
- 引擎零改动；sim ALL CHECKS PASSED（无新用例——UI 层逻辑无头覆盖不到，e2e 冒烟兜底）；e2e ✓；版本 f3cd0f9。
- 环境备注：本轮 node_modules 再次被清空且 `npx tsc` 误装了同名假包（tsc@2.0.4），npm ci 后恢复；流水线规约不变。

## v2.38（2026-08-19，已落地 47cf3a2）弹丸预览射线发射/持续/消失与实战一致

**需求**（用户）：弹丸编辑器中射线的发射、持续和消失都需要跟实际场景一致。
- 发射 = v2.35 起射高速伸展（BEAM_ON_SPEED 2400m/s 从炮口伸出，粒子端点随伸展前锋移动）；持续 = 5s 光束本体（闪烁/滚动不变）；消失 = v2.36 停火消退 0.25s（长度冻结、光晕渐隐 alpha=p^0.7、亮芯 vScale=p 收窄到 0%，无炮口光球/端点闪光）。
- ammoFxPreview：fxRaySeqLen(st, worldW)（=min(全长, t×BEAM_ON_SPEED/25)）与 fxRaySeqFade(st)（熄灭窗口前 BEAM_FADE 秒内 1→0）两helper，直接 import 引擎 BEAM_ON_SPEED/BEAM_FADE（无循环依赖）；fxTick ray seq 粒子端点 epX 改随伸展前锋。
- DebugPanel AmmoPreview：phase0 按 ramp 长度绘制光束+端点闪光；熄灭窗口前 0.25s 按消退口径绘制（光晕渐隐/亮芯收窄，隐藏光球/端点闪光）；其后全隐至循环。
- sim：ramp 端点逐帧前移 + fade 进度断言。弹丸文档主记。

**落地记录（47cf3a2）**
- ammoFxPreview.ts：import 引擎 `BEAM_ON_SPEED`/`BEAM_FADE`（同一常量源）；新增导出 `fxRaySeqLen(st,worldW)=min(worldW−1, t×2400/25)`、`fxRaySeqFade(st)=熄灭窗口前 0.25s 内 1→0`；fxTick ray seq 粒子端点 `epX = 0.5 + fxRaySeqLen`（trail 模式仍恒右端）。
- DebugPanel.tsx：射线 seq 绘制块重构——phase0 长度随 ramp、端点命中闪光随前锋；熄灭窗口前 0.25s 走消退口径（len 冻结全长、fadeA=p^0.7、亮芯 coreVS=p，光球/端点闪光不绘制）；提示文案改「与实战一致：起射伸展→持续 5s→消退消失，循环至停止」。
- sim.ts：+2 条（scatter rate=600 首 tick 端点 x≈2.1<5 → 0.217s 后 x≈11.5>10.5；helper 常量口径断言）。ALL CHECKS PASSED。
- 全流程：tsc ✓ → sim ✓ → rsync+build+`rsync -a public/ dist/` ✓ → e2e ✓ → 版本 47cf3a2。

## v2.37（2026-08-19，已落地 88de467）弹丸预览射线 seq 发射 5s 后消失

**需求**（用户）：弹丸预览播放射线时，射线开始发射后持续 5s，然后消失。
- ammoFxPreview：FX_RAY_SEQ_ON=5s / 停顿 0.9s 后循环（保持 seq「循环至停止」语义）；ray seq 相位机：phase0 发射（光束+三组粒子）→ t≥5 phase1 熄灭（不绘制光束、不发射粒子）→ t≥5.9 重置循环。
- DebugPanel AmmoPreview：seq 射线光束体/炮口光球/端点闪光仅 phase0 绘制；按钮提示射线口径改为「光束发射 5s 后消失，停顿循环至停止」。
- sim：ray seq 5s 熄灭 + 5.9s 循环重启。弹丸文档主记。

**落地记录（88de467）**
- ammoFxPreview.ts：导出 `FX_RAY_SEQ_ON=5` / `FX_RAY_SEQ_GAP=0.9`；fxTick ray 分支加 seq 相位机（t≥5.9 重置 t/phase/三组 acc，t≥5 phase=1 仅 stepParticles 不发射，否则 phase=0）；trail 模式不进相位机（持续发射不变）。
- DebugPanel.tsx：seq 射线光束绘制块条件 +`st.phase === 0`（熄灭窗口光束体/炮口光球/端点闪光全隐，残存粒子自然衰减）；播放按钮 title 与右下提示按 ray/非 ray 分口径。
- sim.ts：新增 2 条（5s 前 phase0 有粒子 → 5.2s phase1 粒子递减 → 6.1s phase0 t<0.5 重新发射；trail 6s 仍 end>0）。ALL CHECKS PASSED。
- 全流程：tsc ✓ → sim ✓ → rsync+build+`rsync -a public/ dist/` ✓ → e2e（canvas 非空白+内置贴图 200+无错误）✓ → 版本 88de467。

（附：v2.36 快速通道已落地 0d4d750——drawBeamLayer +vScale，停火消退亮芯层贴图随 p 收窄到 0%；按快速通道规约未走 sim/e2e/文档。）

## v2.35（2026-08-19，已落地 eb216f5）光束起射高速伸展

**需求**（用户）：光束以非常快的速度发射出去（非瞬时全出现）。
- engine：BEAM_ON_SPEED=2400 m/s；Turret.beamOnAt（firing 转换沿 false→true 记录，停火清除）；beamLength = min(beamMarch, 伸展进度)；beamTick 伤害/截断/端点特效同步 ramp。
- render 无需改（已走 beamLength）。
- sim：起射伸展中 len<full、≈0.1s 后=full、伤害随伸展。全流程；炮塔文档主记。

**落地记录（eb216f5）**
- engine.ts：① `export const BEAM_ON_SPEED = 2400`；② Turret + `beamOnAt?: number`；③ `beamLength()` ramp = min(beamMarch 截断全长, m2c((time−beamOnAt)×2400))，beamOnAt 缺省恒=全长（兼容旧语义）；④ beamMarch 改为 export（sim 断言用）；⑤ beamTick 用 ramp 后 len，blocker 门控 `len >= march.len−1e-9` 才结算阻挡物；⑥ DoT 分支：伸展未到位时 tickTimer 不消费（置 0 下帧再检），到位帧立即结算首次伤害——**否则首帧 len=0 空打会白等一整个 DoT 间隔 0.5s**（调试实测伤害被拖到起射后 0.55s）；⑦ updateTurret 包装：false→true 记 beamOnAt=s.time；停火推消退段后清 beamOnAt。
- sim.ts：① v2.16 充能滞留用例第二窗口 0.1s→0.2s（ramp 0.104s+对齐一拍，首次伤害自然顺延，充能时序断言不变）；② 新增 v2.35 用例组（chargeTime=0 逐帧）：起射帧 beamOnAt=time/len=0 → +0.05s len≈4.8 格无伤 → +0.10s len=9.6 格仍无伤 → +0.15s 到位帧结算；阻挡物门控（伸展抵达前不伤、抵达帧即结算）；停火（firingLeft→0）清 beamOnAt+推消退段。5 条全新增 PASS，v2.16/光束充能两条旧用例修正后 PASS，ALL CHECKS PASSED。
- 行为口径：250m 射程 ≈0.104s 伸展到位（60fps 约 6 帧可见快速扫出）；伸展期敌人/阻挡物均不结算，到位帧首次 DoT，此后正常 0.5s 节奏；停火消退段（0.25s 收窄+渐隐）快照当时长度不受影响。
- 全流程：tsc ✓ → sim ALL CHECKS PASSED → rsync+build+`rsync -a public/ dist/` ✓ → e2e（canvas 非空白+内置贴图 200+无错误）✓ → 版本 eb216f5。

---

## v2.48：爆炸参数常驻显示（修复直射炮塔找不到爆炸字段）

**需求原话**：你检查下，我并没有在直射炮塔的参数中找到这三个字段。

**根因**：`DebugPanel.tsx` 炮塔参数过滤规则为「无 showIf 的字段仅当定义中已有值时才显示」（`getPath(def, f.path) !== undefined`）；blastRadius / blastEffect.damage / blastEffect.burn.* 五个字段均未配 showIf，而内置直射炮塔未预置爆炸参数 → 字段永久隐藏（死锁：没值不给填、不填永远没值）。榴弹/导弹炮出厂带爆炸配置故可见。

**改动（仅 DebugPanel.tsx）**：5 个爆炸字段补 `showIf: () => true` 常驻显示。

**验证（落地记录）**：tsc ✓ → 模拟回归 ALL CHECKS PASSED（v2.47 直射爆炸两项仍过）→ output/app 构建 ✓ built → e2e CANVAS_OK → 版本 1a15b9f。教训沉淀：DebugPanel 无 showIf 字段 = 「有值才显示」，新增可选参数字段时必须显式 showIf，否则用户无法首开。

---

## v2.49：标签式索敌系统（目标标签 + 资源标签）

**需求原话**：炮塔根据标签索敌——目标标签（血最多/少优先、近堡垒优先、堡垒优先、大/小尺寸单位优先、地面/空中单位优先、僚机优先、不打僚机、导弹优先、不打导弹）+ 资源标签（防御/弹药/电量/热量阈值时开火/不开火）；一个武器组可打多个标签，必须满足所有后缀条件才开火。

**拍板（用户三项均无偏好，按推荐）**：单座炮塔打标签（标签存 TurretDef）；资源标签=硬开关语义；目标+资源标签一版全量交付。

**设计**：
- `TurretDef.tags?: TurretTag[]`，判别联合：prefer（软排序，权重连乘）/ exclude（硬过滤）/ resource（开火门控，条件成立=禁火）。
- 首版激活键：prefer = nearFortress(默认现状)/nearTurret/hpMax/hpMin/sizeBig/sizeSmall/air/ground；exclude = air/ground；resource = ammo/energy/heat/defense × 低于/高于 × 阈值百分比。僚机/导弹/堡垒/生产单位等键预留类型位，实体上线后激活。
- 合成规则：exclude+resource 全部 AND；prefer 各贡献权重因子连乘到基础分（基础分=distToFortress，含 nearTurret 时改为距炮塔）；空军 ×0.5 旧行为在无 air/ground 偏好标签时保留（向后兼容）。
- 零标签 = 完全现状（旧口令/配置兼容，token version 不变）。
- aim() 候选列表参数化钩子（现在传 s.enemies，未来并入敌方堡垒/生产单位/拦截弹）。
- 资源门控位置：updateTurretBody 开火判定前统一拦截（持续型中断/连发中止/充能取消，与过热同径）。

**改动文件**：config.ts（类型）、engine.ts（aim 重构 + 资源门控）、DebugPanel.tsx（标签编辑 UI，常驻显示）、sim.ts（各标签用例 + 零标签回归）。

**验证（落地记录）**：tsc ✓ → 模拟回归 ALL CHECKS PASSED（新增 8 用例：hpMax 颠覆距离/近炮塔/不打地面/地面优先等距取代空军加权/大单位优先等距/弹药低于50%禁火与恢复/热量高于80%禁火与散热恢复/空标签=现状空军×0.5）→ 构建 ✓ built → e2e CANVAS_OK → 版本 054eed2。注：本次期间 node_modules 再被擦除（npx tsc 拉到假 tsc 包），npm ci 后恢复——tsc 输出出现 npm warn 即视为依赖被擦，须重装。

---

## v2.50：激光宽幅驱动贴图宽度

**需求原话**：激光宽幅改为会影响激光贴图的宽度，激光贴图默认为原尺寸32pix，如果宽幅填8m，那么根据一格32像素等于25米来换算，最后缩放为8/25。

**现状根因**：drawBeamLayer 贴图分支平铺块高 = img.height × texScale（原生尺寸），忽略 widthPx；仅几何回退按宽幅画矩形。

**语义（按用户拍板）**：beamWidth 未配置 → 贴图原生高度（现状）；已配置 → 渲染高度 = beamWidth/M_PER_CELL 格 × cell px（例：8m → 8/25 格，32px 基准下 = 32×8/25 = 10.24px）。光晕层=宽幅、亮芯层=宽幅×0.5（沿用现有比例）。

**改动**：
- render.ts 战场 firing 光束（1308/1309）：vScale 按 fit 目标高度计算；
- render.ts 光束停火消退（1440/1441）：同语义（core 层 p 收窄与 fit 复合）；engine.ts BeamFade.width 改可选（存 undefined 以区分未配置，回退矩形仍 ?? 8）；
- DebugPanel.tsx 炮塔美术预览光束（572/573）：同步语义（主界面与预览一致）；
- 脉冲曳光（1549/1550）与弹药 FX 预览（1771/1772，固定 0.45 格宽、与炮塔宽幅无关）：不动；
- beamWidth 字段 tip 更新。

**验证（落地记录）**：tsc ✓ → 模拟回归 ALL CHECKS PASSED（新增：未配置宽幅的光束消退 width=undefined；旧用例 w=10 保持）→ 构建 ✓ built → e2e CANVAS_OK → 版本 dbb678d。踩坑：① sim 块插入截断既有②块致 esbuild Unexpected "}"——插入新块必须整段落在既有块外；② 模拟器须在项目目录运行（相对路径读 public/res），cwd 错误报 ENOENT 非真失败。

---

## v2.51：双底盘运动学（履带差速 / 轮式转向）+ 轮子美术组

**需求原话**：兼容履带和轮式两种配置，同一套设定可配置出轮式堡垒和履带堡垒；轮式美术配轮子、转向影响轮子方向旋转；履带和轮子可共存（半履带预留）；不需要街机底盘；漂移后续开发。

**拍板**：chassis: 'tracked' | 'wheeled'，旧配置缺省 tracked（现堡垒=履带车，低速枢轴转最接近现状）；turnSpeed 降级为可选横摆角速度上限（未配置=物理推导）；tracks/wheels 两数组独立共存；漂移记入待开发。

**参数改造**：
- 公共保留：speed/accel/reverseFactor/brakeInertia/pitchGain/leanCap；turnRadius 在两底盘下退化为最小半径钳制。
- 履带组：trackWidth（缺省=车宽w）、turnDrag（转向阻力系数，按角速度抽速）。
- 轮式组：wheelbase（缺省=车长h×0.6）、steerMax（缺省35°）、steerRate（方向盘转速°/s+自动回正）、gripMax（横向附着上限 m/s²，高速压缩有效转角）；轮式静止不能原地转（v>蠕行阈值才有转向能力）。
- 美术组：wheels?: WheelDef[]{x,y,r,sprite?,steered?}，steered 轮随前轮角 δ 偏转；轮印复用履带印引擎（外侧轮位两列）；tracks 与 wheels 共存（半履带预留：未来求解器同输 δ+速差）。

**改动**：config.ts（FortressDef 参数+WheelDef）、engine.ts（运动求解器按底盘分派、fortress 状态 +steerAngle）、render.ts（轮子绘制+轮印）、DebugPanel.tsx/堡垒编辑器（按底盘分组显隐+wheels 编辑组）、sim.ts（运动用例重校准+双底盘新用例）。

**验证**：tsc → 模拟回归 → 构建 → e2e → 版本。

**落地记录（2026-08-20，版本 599fd14）**：
- config.ts：`chassis?: 'tracked'|'wheeled'`（缺省 tracked，旧配置无损迁移）+ trackWidth/turnDrag/wheelbase/steerMax/steerRate/gripMax 六个可选底盘参数 + `WheelDef{id,x,y,r,sprite?,steered?}` 与 `wheels?[]`；turnSpeed/turnRadius 注释改写为「可选封顶 / 0=按底盘物理」。
- engine.ts：
  - 履带（turnRadius=0）= 差速枢轴：转速不再乘速度比率，静止可原地转；上限 = min(turnSpeed, 2×极速/履带间距)；turnDrag 转向输入期间目标速度 ×(1−系数)。
  - 轮式 = 运动学自行车模型：δ 按方向盘转速积分（A/D 打满、摇杆映射角差、无输入自动回正）；横向附着钳制 tanδ_eff ≤ grip·L/v²（v<0.5 格/s 不再收紧）；ω = vLon·tanδ_eff/L，倒退 vLon<0 自然反向（真车车尾语义，无需翻转补丁）；turnSpeed 仍为可选横摆封顶；静止无转向能力（涌现）。
  - arcTurn（turnRadius>0）保留为两底盘通用覆盖 → 默认堡垒（R=10）手感不变。
  - `fortressMarkColumns()` 统一落印/滚动相位列：履带 [左,右镜像] 对在前、轮子退化单列在后；相位公式统一 dphase = (vLon − turnW×sx)×dt；trackPhase 长度自适应（tracks×2 + wheels）。
- fortressFx.ts：updateTrackMarks 改走 fortressMarkColumns（轮印复用履带印引擎，退化段取轮心点）。
- render.ts：轮子绘制层（贴图按 2r 高度等比缩放 / 几何轮胎 fallback；steered 轮随 f.steerAngle 偏转）。
- DebugPanel.tsx 堡垒编辑器：底盘类型下拉 + 按底盘分组的参数区；wheels 编辑组（增删、坐标/半径/转向勾选、贴图上传）+ 外观预览轮子层（转向轮红色轮毂线）。
- sim.ts：旧方向盘语义用例重校准（履带枢轴接管：⑤d、②a、②c、③）；新增用例59b 共 20 项（校验 9 项 + 轮式静止无转向能力/前轮打满/自动回正/附着钳制/高附着对照/turnSpeed 封顶/倒退自然反向/滑行衰减/停稳停转 + 履带 turnDrag 3 项 + 落印列 4 项）。
- 回归：ALL CHECKS PASSED；构建 ✓ built；e2e CANVAS_OK。
- 教训沉淀：轮式用例期望值先用 Python 逐 tick 复刻求解器再写断言（含加速度起步、vLon=|v|·cos(h) 衰减），容差 ±0.01 一次通过。

## 待开发记录

所有待开发项已独立成文：`project/docs/待开发记录.md`（按序号列出，不记版本号）。本文件不再复制其内容。

## 文档重构：炮塔编辑器设计文档去版本化 + 弹丸文档并入（2026-08-20）
**任务**：重编《炮塔编辑器设计》为完整设计文档（取消版本补充/版本详情记录），《弹丸编辑器设计》内容并入后删除该文档；姊妹文档头部「弹丸」引用同步移除。
**流程**：① 5 个主题代理并行（读两文档 + 对照 src 代码核实现行语义，各产出主题章）→ ② 审校代理对照代码抽查 → ③ 整合定稿替换原文档、删弹丸文档、改姊妹引用 → ④ 三方同步 + 重打包。纯文档任务，不动代码/不构建/不出版本。
**目标目录**：总览与类型体系 / 参数全集 / 索敌 / 直射 / 导弹 / 射线 / 近战与生产 / 命中效果 / 热量与资源 / 美术渲染 / 编辑器UI / 口令持久化与sim约定。
**落地记录（2026-08-20）**：5 主题代理并行产出 13 章 → 审校代理对照代码抽查 22 项（2 中 5 低全部修复）→ 定稿 1050 行替换 docs/炮塔编辑器设计.md；docs/弹丸编辑器设计.md 删除；堡垒/战场文档头部姊妹引用与正文历史引用全部加「已并入《炮塔编辑器设计》」注记；待开发记录.md 指针同步。
**代码真相修正**（重构中发现并采信）：炮塔类型实为 direct/lob/missile/beam/spray 五类（无近战/生产炮塔；生产行为属堡垒内部模块 ModuleDef.produce）；光束发射期转向为 ×0.5 削减而非锁定；弹丸库实为持久化（localStorage td-projectile-arts）而非注释所称不持久化；爆炸无距离衰减。

## 文档重构：堡垒编辑器设计文档去版本化（2026-08-20）
**任务**：同炮塔文档流程，重编《堡垒编辑器设计》为完整设计文档（取消版本记录，仅现行设计，代码为准）。主题切分：总览+参数全集+机动 / 操控+炮位 / 内部空间模块+热量 / 主体美术+编辑器UI+类型库口令。审校后定稿、三方同步、重打包。纯文档任务。
**落地记录（2026-08-20）**：4 主题代理并行产出 9 章 → 审校代理抽查 28 项（2 中 4 低全部修复）→ 定稿 875 行替换 docs/堡垒编辑器设计.md。
**代码真相修正**：出厂炮位构成为 1L+4M+4S+2S fixed（原文档 3M/5S 错误）；「复制为新自定义」仅拷贝机动四参数（底盘组不拷）；smoke 寿命抖动 ±15%（非 ±30%）；俯仰死区按纵/横分量判定；过热停火清连发/充能但不清冷却；w/h 上限仅无 shape 时强制。文末原"基础设计"章节的过期口径（Q/E 转向、speed 0.5~4、custom- id 前缀等）全部以代码为准重写。

## v2.52：摇杆防抖改 One Euro 平滑滤波（2026-08-20，版本 34170ec）
- GamePreview.tsx：防抖改 One Euro 平滑滤波（β 速率自适应 + 1.5° 微吸正），编译期开关 STICK_ANTI_JITTER 保留迟滞旧案可回退；摇杆头视觉不受滤波影响。

## v2.53：堡垒毁灭演出（2026-08-20，版本 c842951）
- hp 归零 → dyingT 状态机三段式演出（内伤小爆→主爆 AOE→残骸余烟 2.2s）后判负；判负与毁灭事件解耦；sim 两处旧「同帧判负」断言改新语义。

## v2.54：爆炸视觉升级（2026-08-20，版本 9189e82）
- 统一程序化画法（火球/软边冲击环/瞬时照明/拉丝火花），弹丸库 explosion 组新增 fireball/shock/flash/streak 四参数，毁灭演出分支复用同画法；纯渲染层+配置增强。
  - 补：编辑器弹丸预览路径同步新画法（预览为独立绘制实现，v2.54 初版遗漏）；拉丝加长加粗 0.09s/0.8r（版本 d237593/1ba7a7e）。

## v2.55：特效画法共用层 fxDraw（2026-08-21，版本 b45d4df）
- 新增 src/game/fxDraw.ts（粒子池/爆炸矢量层/命中闪光/染色缓存/hex 工具），render.ts 与弹丸预览（DebugPanel AmmoPreview）删除平行实现改调共用层；炮塔美术预览统一为 backlog #15 第二步。

## v2.56：迁移加固与事件 ID 确定性随机（2026-08-21）
- 建立“末日堡垒”Git 迁移基线；依赖恢复改为 Windows/POSIX 双脚本，统一按 `package-lock.json` 重建当前平台依赖。
- 新增 `npm run verify`，串行执行类型检查、611 项 sim 回归、生产构建和 public 素材同步。
- 引擎精度散布、导弹摆动相位、出怪位置由 `eventRandom(eventId, stream)` 派生，`engine.ts` 不再调用 `Math.random`；设定依据见 `project/docs/炮塔编辑器设计.md` §4.8、§13.3。
