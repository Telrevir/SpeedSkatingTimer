# 服务端权威比赛存储同步进度

更新时间：2026-09-07



## 已完成：Task 4（本地身份、工作副本与任务箱）

已提交本地 Git 提交 `1555e67`（`feat: persist race identities and sync outbox`），未推送远端。

- 新增 `RaceIdentity`、`ScoreIdentity` 与 `RaceSyncState`，比赛稳定保存 `localId`、`clientRaceKey`、可空 `raceId` 和同步状态；成绩稳定保存 `localScoreId`、`clientScoreKey`、从 1 递增的 `eventSequence` 与可空 `scoreId`。
- `ScoreRepository` 使用 schemaVersion 2 的比赛工作副本存储。旧的比赛记录数组仍可读取，并在下一次写入时迁移；旧比赛/成绩会补齐稳定身份，自动补圈等内容重算只能替换成绩字段，不能改变成绩幂等键或事件序号。
- `ActiveRaceSessionRepository` 升级到 schemaVersion 3，保存可选 `raceIdentity`，兼容 schemaVersion 1、2；恢复会话可通过 `localId` 找回原始工作副本。
- 新增持久 `RaceOutboxRepository` 与微信存储适配：任务按 create → score → finish 建立依赖；相同 `ClientScoreKey` 合并；重试次数、下次重试时间和错误码持久保存；`400`、`409` 进入 held 状态；损坏的 outbox 原值保留用于诊断，不会覆盖或执行。
- 在线比赛在最终服务器确认后可由后续生命周期调用 `removeCompletedOnlineRace` 清理；本 Task 尚未接入网络、Worker 或比赛控制器。

修改文件：

- `miniprogram/domain/race-identity.ts`
- `miniprogram/domain/active-race-session.ts`
- `miniprogram/services/active-race-session-repository.ts`
- `miniprogram/services/score-repository.ts`
- `miniprogram/services/race-outbox-repository.ts`
- `miniprogram/platform/wechat-score-storage.ts`
- `miniprogram/platform/wechat-race-outbox-storage.ts`
- `tests/active-race-session-repository.test.ts`
- `tests/score-repository.test.ts`
- `tests/race-outbox-repository.test.ts`
- `tests/run-tests.ts`
- `docs/HANDOFF.md`
- `../CurrentTask.md`



## 验证记录

- Task 4 新增定向测试：14/14 通过。
- `npm run typecheck`：通过。
- 完整 `npm test`：224/230 通过；6 个 BLE 测试失败。失败原因是现有未提交的 `miniprogram/config/ble-config.ts` 已更新 UUID，而旧 `tests/ble-transport.test.ts` fixture 仍预期 FFE0 服务；Task 4 未修改两者。
- 未进行微信开发者工具或真机验证。



## 工作区保护

后续任务不得覆盖、回退或暂存下列当前未提交修改；它们属于其他工作内容：

- `README.md`
- `docs/ESP32-BLE-GATT.md`
- `docs/superpowers/plans/2026-08-06-bt04-e-uuid.md`
- `miniprogram/config/app-config.ts`
- `miniprogram/config/ble-config.ts`
- `miniprogram/pages/race/index.ts`
- `tests/ble-transport.test.ts`
- `tests/race-controller.test.ts`
- `tests/race-state.test.ts`
- 未跟踪的后端目录及 `.codex-task1-*.md` 文件。



## 下一步

## 已完成：Task 1（按端点隔离 API）

- 新增共享 DTO 和每端点一个函数模块，覆盖运动员、分组、分组成员、分组聚合写入、比赛创建、成绩创建、完整比赛包、分页比赛、活动比赛和最新成绩。
- `BackendClient` 仍只负责泛用 HTTP 信封与规范化状态；端点模块不含重试、存储、Toast、Worker 或跨接口编排。
- 新建比赛和成绩的 POST 会分别剔除 `RaceID`、`ScoreID`，保留零值的圈数、时间和排名。
- 新增端点隔离测试；完整 `npm test` 为 225/231 通过，剩余 6 项仍是 BLE UUID fixture 不匹配；`npm run typecheck` 通过。
- 本 Task 待本地提交：`refactor: separate backend endpoint modules`。

修改文件：

- `miniprogram/services/backend-api/types.ts`
- `miniprogram/services/backend-api/query-types.ts`
- `miniprogram/services/backend-api/athletes/`
- `miniprogram/services/backend-api/groups/`
- `miniprogram/services/backend-api/races/`
- `tests/backend-api.test.ts`
