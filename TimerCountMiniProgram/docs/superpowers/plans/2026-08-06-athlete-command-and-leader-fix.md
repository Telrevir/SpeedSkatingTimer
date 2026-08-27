# Athlete Command Confirmation and Leader State Fix Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让运动员管理命令以设备 `0xF1` 回复为准并自动刷新名单，同时使领滑卡片、排名和比赛重置状态保持一致。

**Architecture:** `RaceController` 管理单个待确认管理命令，成功后发送 `0x18`，失败或超时则拒绝页面 Promise。`RaceStore` 与 `AthleteStore` 分别负责领滑状态和比赛成绩清理；`0x06` 同时更新领滑快照及运动员排名。

**Tech Stack:** TypeScript、微信原生小程序、Node.js test runner、自定义二进制协议

## Global Constraints

- 管理命令成功必须以匹配的 `0xF1 [commandId, 0x00]` 为准。
- 不匹配的 `0xF1` 不得结束当前等待。
- 查询命令在管理命令等待期间仍可发送。
- 领滑单圈只使用同一运动员的相邻圈总用时差值。
- 只在比赛运行中轮询领滑；重置时清除领滑和比赛排名。

---

### Task 1: 管理命令确认与名单刷新

**Files:**
- Modify: `tests/race-controller.test.ts`
- Modify: `miniprogram/services/race-controller.ts`
- Modify: `miniprogram/pages/athletes/index.ts`

- [ ] 写入 `0xF1` 成功、错误和不匹配回复测试。
- [ ] 运行测试并确认旧实现失败。
- [ ] 实现待确认命令、状态错误映射和成功后的 `0x18`。
- [ ] 运行控制器测试确认通过。

### Task 2: 领滑与重置状态一致性

**Files:**
- Modify: `tests/race-controller.test.ts`
- Modify: `tests/race-state.test.ts`
- Modify: `miniprogram/stores/race-store.ts`
- Modify: `miniprogram/stores/athlete-store.ts`
- Modify: `miniprogram/services/race-controller.ts`
- Modify: `miniprogram/pages/race/index.ts`

- [ ] 写入领滑同步排名、领滑切换基准和重置清理测试。
- [ ] 运行测试并确认旧实现失败。
- [ ] 实现 `0x06` 的运动员同步和比赛数据清理。
- [ ] 将领滑轮询限制为 `RaceState.Running`。
- [ ] 运行全量测试与类型检查。
