# 小程序自动补圈实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development task-by-task. 当前为共享脏工作区，不创建提交，不覆盖或回退其他任务改动。

**Goal:** 在小程序侧以高置信度识别 RFID 漏检，持久保存累计补圈偏移，并用修正圈数完成排名、领滑和结束判断。

**Architecture:** 新增无外部依赖的纯领域补圈引擎；`LocalRaceScoring` 维护每名运动员的原始圈数、偏移、修正圈数和真实圈速历史。活动会话保存可恢复的补圈状态，控制器在每条真实 `0x12` 后只追加一条成绩记录并持久化状态，比赛页和排名页拆分显示原始圈数与橙色 `+N`。

**Tech Stack:** TypeScript、微信小程序 WXML/WXSS、Node.js `node:test`

**Spec:** 已确认的任务说明（源任务 `01a0533d-16be-7562-8a17-2408ebc9f590`）

**执行变更（用户追加）：** 本次取消所有新增/修改测试和测试执行。下列测试步骤仅保留为后续验证清单，本轮不实施；本轮只完成生产代码与必要文档。

## 全局约束

- 自动补圈只在小程序领域层完成，不为此新增或修改协议字段。
- 保留并行任务正在实施的 9 字节 `0x12` 和固件权威单圈时长接口，不回退共享文件。
- `correctedLapCount = rawLapCount + correctionOffset`；排名、领滑、`finishLap` 使用修正圈数。
- 仅 `rawLapDelta === 1` 可补圈；单次最多补 2 圈；估算圈不进入真实圈速历史。
- 不伪造虚拟过线记录或精确估算时间；每条真实 `0x12` 最多追加一条成绩记录。
- schemaVersion 1 活动会话继续可读；重置必须清除补圈状态。
- 使用补丁编辑，保留日志功能及其他未提交改动；共享工作区不执行提交。

---

### Task 1: 纯补圈判断引擎

**Files:**
- Create: `miniprogram/domain/lap-correction-engine.ts`
- Create: `tests/lap-correction-engine.test.ts`
- Modify: `tests/run-tests.ts`

**Interfaces:**
- Produces: `evaluateLapCorrection(input: LapCorrectionInput): LapCorrectionDecision`
- Input: `{ rawLapDelta, observedCentiseconds, validLapCentiseconds }`
- Output: `{ addedLaps, baselineCentiseconds, impliedLapCentiseconds, reason }`

- [ ] 写表驱动失败测试，覆盖正常圈、61 秒补 1 圈、92 秒补 2 圈、45 秒不补、历史波动、`rawLapDelta > 1` 和 8 秒边界。
- [ ] 运行 `npm test`，确认因模块缺失或行为缺失而失败。
- [ ] 实现集中常量、最近 2 圈平均/最近 3～5 圈中位数、15% 稳定性和 15% 分摊误差门槛。
- [ ] 运行 `npm test`，确认引擎测试及既有测试通过；若并行协议任务尚未完成，只记录其既有编译失败。

### Task 2: 本地计分状态与修正排名

**Files:**
- Modify: `miniprogram/domain/local-race-scoring.ts`
- Modify: `tests/local-race-scoring.test.ts`

**Interfaces:**
- Produces: `LocalAthleteScore.rawLapCount`、`correctionOffset`、`correctedLapCount`、`addedLaps`
- Produces: `LocalRaceScoring.correctionSnapshot`、`resume(participantIds, correctionStates?)`
- Consumes: Task 1 `evaluateLapCorrection`

- [ ] 先增加失败测试：补圈后下一包保留偏移、重复/倒退/跨圈包不重复补、修正圈参与排名和领滑、重置清空。
- [ ] 增加恢复状态测试：重建 `LocalRaceScoring` 后用保存状态恢复，相同 `0x11` 数据只重建显示、不重复补圈。
- [ ] 增加 finishing 失败测试：修正圈跨过 `finishLap` 时冻结且展示圈数不超过终点圈。
- [ ] 最小扩展内部 timing state；真实有效单圈仅在未补圈的 `rawLapDelta === 1` 时进入历史。
- [ ] 运行测试并保持并行任务的固件单圈参数语义。

### Task 3: 活动会话向后兼容持久化

**Files:**
- Modify: `miniprogram/domain/active-race-session.ts`
- Modify: `miniprogram/services/active-race-session-repository.ts`
- Modify: `tests/active-race-session-repository.test.ts`

**Interfaces:**
- Produces: `ActiveRaceSession.lapCorrectionStates?`
- Produces: `saveLapCorrectionStates(states)`
- Consumes: Task 2 可序列化 correction state

- [ ] 先写 schemaVersion 1 可读、补圈状态克隆保存和更新失败测试。
- [ ] 将新写入升级为 schemaVersion 2；解析 v1 时把补圈状态视为空，解析 v2 时严格校验数值和历史数组。
- [ ] 运行仓储测试，确认旧会话不会失效。

### Task 4: 控制器恢复与单条真实成绩记录

**Files:**
- Modify: `miniprogram/services/race-controller.ts`
- Modify: `miniprogram/services/score-repository.ts`
- Modify: `tests/race-controller.test.ts`
- Modify: `tests/score-repository.test.ts`

**Interfaces:**
- 每条有效真实 `0x12` 调用一次 `applyFirmwareScore`，随后持久化 correction snapshot。
- `LapScoreRecord` 增加 `rawLap`、`correctionOffset`、`correctedLap`，但不生成虚拟补圈记录。

- [ ] 先写控制器测试：实时补圈仅增加一条记录；`0x11` 重放不追加记录；进程恢复后偏移与历史保留；重置清空活动会话。
- [ ] 修改恢复流程，在 `scoring.resume` 时传入会话补圈状态，并在每条接受的 `0x12` 后更新会话。
- [ ] 仅为非历史实时包追加一条成绩记录，记录原始圈与累计偏移。
- [ ] 运行控制器和成绩仓储测试。

### Task 5: 比赛页与排名页拆分显示

**Files:**
- Modify: `miniprogram/domain/athlete.ts`
- Modify: `miniprogram/stores/athlete-store.ts`
- Modify: `miniprogram/pages/race/index.ts`
- Modify: `miniprogram/pages/race/index.wxml`
- Modify: `miniprogram/pages/race/index.wxss`
- Modify: `miniprogram/pages/ranking/index.ts`
- Modify: `miniprogram/pages/ranking/index.wxml`
- Modify: `miniprogram/pages/ranking/index.wxss`
- Create: `tests/lap-correction-wxml.test.ts`
- Modify: `tests/run-tests.ts`

**Interfaces:**
- 页面行模型分别提供 `rawLap` 与 `correctionOffset`，禁止预拼接并整体着色。

- [ ] 先写 WXML 失败测试，要求比赛页实时前五和排名页都存在独立的原始圈节点与 `wx:if` 橙色偏移节点。
- [ ] 扩展 Athlete 映射和页面 view model；无补圈时只显示原始值，有补圈时显示 `raw+offset`。
- [ ] 添加 `.lap-correction` 橙色样式并运行 WXML/全量测试。

### Task 6: 文档与最终验证

**Files:**
- Modify: `README.md`
- Modify: `docs/HANDOFF.md`
- Modify: `../CurrentTask.md`（仅追加与本功能直接相关的任务/待实机验证条目，不改写并行固件内容）

- [ ] 更新小程序架构说明：协议仍由并行固件任务定义，自动补圈只消费原始数据并保存偏移。
- [ ] 记录阈值、保守边界、历史恢复和“虚拟圈不代表精确过线时间”。
- [ ] 运行 `npm test`、`npm run typecheck`、`git diff --check -- TimerCountMiniProgram CurrentTask.md`。
- [ ] 检查 `git status --short`，确认没有回退日志功能或修改不在计划内的固件文件。
- [ ] 报告未做微信开发者工具、BLE 真机和赛事数据影子验证。
