# 服务端权威比赛存储同步进度

更新时间：2026-09-08



## 已完成：Task 4（本地身份、工作副本与任务箱）

已提交本地 Git 提交 `1555e67`（`feat: persist race identities and sync outbox`），未推送远端。

- `ScoreRepository` 使用 schemaVersion 2 工作副本保存稳定比赛/成绩身份，并兼容旧记录迁移。
- `ActiveRaceSessionRepository` 使用 schemaVersion 3 保存可选比赛同步身份，并兼容 schemaVersion 1、2。
- `RaceOutboxRepository` 持久保存 create → score → finish 依赖、重试元数据与 `400/409` held 状态；损坏存储保留且不执行。



## 已完成：Task 1（按端点隔离 API）

已提交本地 Git 提交 `c40c62a`（`refactor: separate backend endpoint modules`）及验收修正 `fe1f9b4`（`fix: omit local IDs from race bundle uploads`），未推送远端。

- 新增共享 DTO 和每端点一个函数模块，覆盖运动员、分组、分组成员、分组聚合写入、比赛创建、成绩创建、完整比赛包、分页比赛、活动比赛和最新成绩。
- `BackendClient` 仍只负责泛用 HTTP 信封与规范化状态；端点模块不含重试、存储、Toast、Worker 或跨接口编排。
- `ScoreDto` 与 `RaceJoinDto` 代表单条服务器记录，`RaceID` 为必填；首次完整比赛包使用 `RaceBundleScoreDto` 与 `RaceBundleJoinDto`，可省略子记录父比赛 ID。
- `saveRaceBundle` 只上传正整数 `RaceID`、`id`、`ScoreID`；本地 `-1`、`null`、`undefined` 一律省略，业务字段与零值圈数、时间、排名保持原样。
- 新增端点隔离及完整比赛包首次上传/正 ID 重传测试。完整 `npm test` 为 226/232 通过，剩余 6 项均为既有 BLE UUID fixture 不匹配；`npm run typecheck` 通过。

本次验收修正文件：

- `miniprogram/services/backend-api/types.ts`
- `miniprogram/services/backend-api/races/save-race-bundle.ts`
- `tests/backend-api.test.ts`



## 已完成：Task 2（运动员、分组服务端权威联合缓存）

已提交本地 Git 提交 `40c0e08`（`feat: add authoritative athlete group cache`）及审查修正 `d432f4c`（`fix: complete authoritative catalog management`），未推送远端。

- 新增 `schemaVersion: 2` 的 ClubID 隔离联合缓存；运动员、分组及其软删除状态仅在所有分页数据验证完成后一次性写入。
- 任一分页请求、分页一致性、关联或本地写入失败时，保留原有完整缓存且不会发布半成品；旧 v1 运动员/分组存储仅保留为 v2 缓存缺失或损坏时的兼容读取回退。
- 新增运动员与分组远端优先管理服务：本地验证 → 请求 → 严格回执比对 → 一次缓存写入 → 订阅发布；分组仅走聚合包端点。
- 服务端已成功而本地写入失败时，返回“服务器已保存，本地刷新失败”，并立即尝试重新拉取服务端目录。
- 审查补充：运动员归档/恢复、分组删除同样采用远端优先；分组聚合包带有持久的 `AthleteGroupID` 与 `AthleteGroupFormID`，并兼容保留旧 schema 中比赛相关映射键。
- 新增联合缓存与管理服务测试；`npm run typecheck` 通过。完整 `npm test` 为 236/242 通过，剩余 6 项为既有 BLE UUID fixture 不匹配。


## 已完成：Task 3（启动目录刷新与比赛唤醒）

本次本地提交，未推送远端。

- `StartupSync` 只并行协调目录缓存刷新与待处理比赛队列唤醒；不再使用 `SyncDataApi`、不上传本地目录、不下载或导入线上比赛历史。
- 目录失败不会阻断待处理比赛唤醒，也不会影响 `app.ts` 的非阻塞启动和 BLE 自动连接。
- 应用服务已注入 v2 目录缓存、目录刷新、运动员/分组管理服务、目录 ID 映射和比赛任务箱；网络比赛执行仍留给后续 Task 5。
- `SyncIdMapping` 的新目录公开接口收窄为 `group/member`；遗留 race/join/score 映射仅作为旧存储兼容读取。
- 新增三项启动边界测试。`npm run typecheck` 通过；完整 `npm test` 为 223/229 通过，剩余 6 项为既有 BLE UUID fixture 不匹配。


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
- 未跟踪的后端目录。



## 下一步

按计划继续 **Task 5：Worker 调度器与桥接**；Task 3 已完成。不得覆盖上述工作区保护列表。

## Task 5：Worker 调度器与主线程桥接（待验收）

本轮未提交、未推送。已完成以下最小实现：

- `app.json` 注册 `workers`，新增 `workers/race-sync/index.ts`。Worker 仅中继受限 `payload` 请求与结果，不调用 `wx`、存储、页面或 BLE。
- `WorkerRequestBridge` 以 `requestId + taskId` 关联 pending 请求，支持乱序结果、重复/未知结果忽略、超时规范化失败、终止时结清全部等待项；Worker 创建失败时回退为主线程 Promise 队列。
- `RaceSyncScheduler` 提供独立 `control`、`race-write:<raceLocalId>`、`read` 通道；同一比赛串行、不同比赛可并发；按未来 `nextAttemptAt` 安排计时器；业务 `400/409`（含 HTTP 200 的业务码）转为 held 且不继续定时。
- 启动和 `App.onShow` 均调用 `wake()`；Task 6 未提供 DTO 执行器前，wake 不会改写已有 outbox 的 attempt 或状态。

新增/修改文件：

- `miniprogram/workers/race-sync/index.ts`
- `miniprogram/services/backend-sync/worker-protocol.ts`
- `miniprogram/services/backend-sync/worker-request-bridge.ts`
- `miniprogram/services/backend-sync/race-sync-scheduler.ts`
- `miniprogram/app.json`
- `miniprogram/app.ts`
- `miniprogram/services/app-services.ts`
- `tests/worker-request-bridge.test.ts`
- `tests/race-sync-scheduler.test.ts`
- `tests/temporary-backend-sync.test.ts`
- `tests/run-tests.ts`

验证：`npm run typecheck` 通过；`npm test` 为 232/238，通过的新增用例覆盖乱序关联、Worker 终止、超时、重复/未知结果、Worker 创建失败降级、跨比赛并发、read 独立、409 held、无执行器零写入。其余 6 项失败均为已有 `ble-transport.test.ts` 中 BT04-E/FFE0 固定夹具与当前未提交 RF-CRAZY UUID 配置不一致。

风险与下一步：尚未在微信开发者工具或真机验证 `wx.createWorker` 的运行时退出事件、Worker 脚本加载路径和回退路径；Task 6 才能为调度器注入实际比赛 DTO 执行器。后续先复核本 Task 5 的 worker 运行时行为，验收后仅暂存上述 Task 5 文件并提交，禁止混入保护列表中的蓝牙/页面改动。

## Task 5 架构复审追加（未验收）

2026-09-09：复审确认先前版本的 `RaceSyncScheduler` 仍在主线程完成调度与退避，未满足“Worker 决策、主线程执行网络和持久化”的架构要求。本轮新增 `miniprogram/services/backend-sync/race-sync-worker-engine.ts`，其中的 `plan()` 与 `result()` 是无副作用规则：计算可执行任务、同比赛排他、跨比赛并发、下一唤醒、60 秒封顶退避及业务 400/409 held。真实 Worker 已增加 `engine-plan`、`engine-result` 消息处理，且不触及 wx.request、存储、BLE 或页面；主线程 fallback 也使用相同引擎。

当前未完成阻塞项：`RaceSyncScheduler` 尚未以 Worker 消息端口替代本地主线程直接调用引擎，尚不能证明真实 Worker 路径在 fake port 下发出执行意图并依据结果产生 transition；因此不提交。下一步：新增 EnginePort（Worker 端口与 fallback 端口同一接口），让 coordinator 仅投递 outbox 快照和结果、先持久化 transition 后再请求下一 plan；补 Worker/fallback 等价、60 秒封顶、onShow 不阻塞 BLE 的测试。

本轮验证：新增 worker-engine 测试通过；`npm run typecheck` 通过；`npm test` 为 235/241，通过外仍有 6 项既有 BT04-E/FFE0 测试夹具与 RF-CRAZY UUID 配置不一致失败。未执行微信开发者工具或真机验证。

## Task 5：EnginePort 架构修正完成（待验收）

2026-09-09 架构修正已完成并准备本地提交：

- 新增 `RaceSyncEnginePort`，真实 `WorkerEnginePort` 与 `FallbackEnginePort` 提供完全相同的 `plan/result/terminate` 接口；`createWechatEnginePort()` 优先创建 `wx.createWorker`，不可用或创建异常自动降级。
- `RaceSyncScheduler` 不再计算 race lane、退避、held 或下一次唤醒；它只提交 outbox 快照/当前时间/请求结果给端口，接收 Worker 的执行意图、transition 与 nextWake。收到 transition 后先通过 `RaceOutboxRepository` 持久化，再触发下一 plan。
- Worker 脚本实际处理 `engine-plan`、`engine-result`，使用纯 `RaceSyncWorkerEngine` 生成计划和成功/重试/held 转换；Worker 不访问 wx.request、存储、BLE 或页面。
- 主线程仍只负责执行器（Task 6 将把 Task 1 endpoint DTO 请求接入 `WorkerRequestBridge`）、outbox 持久化、计时器与 control/read Promise 通道。

新增测试覆盖：真实 fake Worker 端口产生 request intent 和 retry/held transition；Worker 与 fallback 对同一事件序列的 plan/transition 完全一致；指数退避 60 秒上限；onShow 同时触发 scheduler wake 与 BLE autoConnect，互不等待。

验证：`npm run typecheck` 通过；`npm test` 238/244 通过，剩余 6 项均为已知 `ble-transport.test.ts` 的旧 BT04-E FFE0/FFE1 夹具与用户当前 RF-CRAZY UUID 配置冲突。未运行微信开发者工具或真机验证。仅提交 Task 5 文件，不推送；随后等待验收，禁止进入 Task 6。
