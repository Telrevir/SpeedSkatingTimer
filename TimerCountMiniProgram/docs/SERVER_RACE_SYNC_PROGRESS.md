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

## Task 6：低用量交接（未验收、未提交）

更新时间：2026-09-09。因剩余额度约 15%，停止继续实现 Task 6。当前所有 Task 6 修改均未暂存、未提交、未推送；不得覆盖、回退或暂存既有用户 dirty 文件。

### 当前修改文件

- `miniprogram/services/race-sync-service.ts`（新增）
- `miniprogram/services/score-repository.ts`
- `miniprogram/services/race-controller.ts`
- `tests/race-sync-service.test.ts`（新增）
- `tests/run-tests.ts`

### 验收阻塞项逐项状态

1. **app-services 真实接入：未完成。** 已准备 `WorkerRequestBridge`、scheduler execute 闭包和 `RaceSyncService` 注入补丁，但写入会使真实比赛/运动员/成绩 DTO 发送至后端，当前安全策略拒绝该补丁；不得以其他方式绕过。下一轮需在获得明确外发授权后，最小接入 `app-services.ts`，再构造 `RaceController(..., raceSyncService)`。
2. **离线完成可上传：部分完成。** `finish()` 已改为 offline 也持久化 finish outbox；`saveFinishedBundle()` 不再跳过 offline。尚未实际接入 scheduler，因此未验证启动/onShow 真实执行链路。
3. **丢失 create 回执：部分完成。** 测试已改为 create 返回失败、比赛转 offline、create task 退役、结束后完整包复用相同 `ClientRaceKey`。需重新运行当前修改后的聚焦测试确认 GREEN。
4. **测试语义：部分完成。** 原有 9 个 exact-name 服务测试已建；其中 create timeout 仍使用规范化失败回执而非受控 pending/超时，online finish/failed bundle 尚未驱动真实 scheduler transition，需要下一轮加强。
5. **离线包 ID 省略：已实现、待验证。** `bundle()` 改为条件展开，RaceInfo、joins、scores 不再构造 `RaceID:-1` 或 `undefined` 覆盖。
6. **完整包规范化回执：已实现、待验证。** 要求 ClientRaceKey、正 RaceID、`IsFinished=true`、数组存在；每条本地成绩必须匹配 ClientScoreKey、正 ScoreID 和 RaceID，全部绑定成功后才删除 working copy。
7. **RaceController 独立集成测试：未完成。** 控制器生产代码已加入可选 `RaceSyncService`：Start ACK 先 begin，非历史成绩 record，完成时 finish。受保护的 `tests/race-controller.test.ts` 未修改；仍需新增专用集成测试文件，验证三处调用各一次及 pending 网络不阻塞。
8. **文档：本条完成。** Task 5 已提交验收状态应保留；Task 6 当前未验收状态记录于此。

### 已运行验证

- 初始 RED：`race-sync-service.test.ts` 因缺少 `RaceSyncService` 编译失败，符合预期。
- 首轮 GREEN 聚焦：`npm run build:test; node --test build-test/tests/race-sync-service.test.js` 为 9/9 通过（发生在随后加强 offline bundle 校验与测试调整之前）。
- 首轮全量：246/253 通过，6 项既有 BLE UUID fixture 失败外，另有 1 项 `lost create response...` 因测试夹具回传不完整 RaceBundle 而失败；夹具已修正，尚未重新验证。
- Task 5 末次基线：`npm run typecheck` 通过；`npm test` 238/244，通过外仅 6 个已知 BT04-E FFE0/FFE1 fixture 与当前 RF-CRAZY UUID 配置冲突。

### 已知风险与下一条精确操作

- 未获授权前不得把 Task 6 接入 `app-services.ts`，否则会实际外发比赛、运动员和成绩 DTO。
- `RaceSyncService.create()` 当前通过内部 `outbox.markSucceeded()` 退役失败 create，须在 scheduler 接入后验证不会导致双重 transition。
- 完整包回执绑定任一条 score 失败时，已可能先绑定 race/部分 ScoreID；应评估是否需要 ScoreRepository 原子回执应用，至少保证 working copy 不删除。
- 未做微信开发者工具、真机、真实 Worker 或真实后端验证。

**下一条精确操作：** 获得明确外发授权后，先写/运行新的 Task 6 scheduler 驱动 finish/离线重传测试，再将 `RaceSyncService`、`WorkerRequestBridge` 和 scheduler execute 闭包以最小差异接入 `app-services.ts`；随后新增不触碰 `tests/race-controller.test.ts` 的控制器集成测试，运行 `npm run typecheck` 与完整 `npm test`，并确保失败仍仅为 6 个既有 BLE fixture。

## Task 6：比赛生命周期本地实现完成（未提交）

2026-09-09：已获得仅限源代码接入的明确授权；本轮未向真实后端发送比赛数据，也未做真机连接。`app-services` 已将 `RaceSyncService` 注入 `RaceController`，由 `RaceSyncScheduler` 执行任务，网络路径经 `WorkerRequestBridge` 以 `taskId + attempt + sequence` 生成唯一请求标识。Worker 仅中继受限 DTO；不访问 wx 存储、BLE 或页面。

此前“需要额外外发授权才能接入生产代码”的判断已解除，不再是阻塞项；本轮限制仅是验证阶段不得向真实服务器发送数据。

- Start 成功 ACK 时，同步持久化本地比赛身份和 create 任务，再进入 running；网络处理不阻塞比赛。
- create 失败把比赛标记 offline 并返回已处理结果；只有 scheduler 根据 transition 删除任务。离线比赛结束后仍上传完整包，保留原 ClientRaceKey。
- 完整包回执由 `ScoreRepository.applyFinishedBundleReceipt` 先验证全部 ClientScoreKey、正 ID、RaceID 一致性和既有绑定，再单次落盘删除完成工作副本；校验或写入失败均不会产生部分绑定或删除。
- 新增独立控制器集成测试，未改动保护的 `tests/race-controller.test.ts`。

后续风险：尚未对真实后端、微信 Worker 运行时和真机蓝牙做验证；服务端是否按 ClientRaceKey 幂等、完成包回执字段是否完整、Worker 脚本路径与异常退出行为，均需在联调阶段确认。

### Task 6 第二轮验收补充（未提交）

- 受控 Promise 的 create 失败测试确认：`begin()` 立即返回并保留 pending 身份；网络失败完成后才转 offline，create 任务只由 scheduler transition 删除。
- 真 scheduler 用例验证 create → score → finish：score 回执未完成前不会发送完整包；完成回执成功后才删除工作副本与 finish 任务；最终包失败会保留副本、增加 attempt 并按 Worker engine 退避。
- 控制器仅将非历史 `0x12` 成绩交给生命周期服务；历史同步回放改由本地仓库忽略，不产生第二次同步身份。
- 完整包回执新增 participant join 严格校验（数量、唯一 AthleteID/正 join ID、RaceID、Enabled）及 ScoreID 唯一性；缺 join 或重复 ScoreID 均保留工作副本/任务。
- 原子完成回执写入失败时，已验证内存记录、持久化快照和订阅回调均不变。
- 装配边界以静态测试确认 scheduler 执行器调用 `RaceSyncService`，service 请求调用 `WorkerRequestBridge`，`app-services` 模块本身不包含即时 `wx.request` 调用。

### 后端协议复核裁决（未提交）

- “create 的业务 400/409 不应转 offline”建议不采纳：它与已批准的规则“后端未成功保存即整场 offline，create 仅尝试一次”冲突，现有语义保持。
- “完整回执应逐条核对成绩字段”建议已采纳：Score 回执现在校验 AthleteID、EventSequence、Enabled；完整包还校验上述字段及 LapCount、SingleLapTime、TotalTime、Rank，并拒绝错误 AthleteID 或 EventSequence 的同幂等键回执。相关用例确认此类回执会保留工作副本与 finish 任务并进入重试。

## Task 6 后端协议兼容性复核

- 阻塞：`RaceSyncService.create()` 将网络失败和 HTTP 200 下的业务 `code=400/409` 一并转为离线成功，导致业务错误对应的创建任务被删除；离线兜底应仅覆盖网络失败或超时。
- 阻塞：完整比赛包回执校验只核对成绩的 `ClientScoreKey`、正 `ScoreID` 和 `RaceID`，未核对 `AthleteID`、`EventSequence`、`Enabled`；异常回执通过后可能删除本地比赛工作副本。
- 其余核对项未发现协议阻塞：首次创建省略服务器 ID、离线包不发送 `-1`/`null`、字段名与必填项、`IsFinished`、参与关系规范化回执、HTTP 200 下的 `ApiResponse.code` 识别，以及相同 `ClientRaceKey` 的超时/丢回执幂等恢复。
- 本次为只读协议复核，未向真实服务器发送数据。

## 2026-09-10 部署优先接手说明

因用户要求控制用量，本轮停止新增和运行自动化测试，优先完成可部署联调的一版生产代码。Task 7-9 的生产实现和双方剩余工作已整理到 `docs/SERVER_RACE_SYNC_HANDOFF_2026-09-10.md`。本轮只允许用类型检查排除编译问题；单元测试、微信开发者工具、真机和真实后端/数据库验证全部明确留给后续接手者。

## 2026-09-10：数据库生成 ID 小程序适配

- 运动员新增请求使用不含 AthleteID 的 DTO；仅在成功回执含任意安全正整数 AthleteID、且名称、EPC、ClubID、启用状态完整一致时写入联合缓存。
- 分组新增请求不含 AthleteGroupID、AthleteGroupFormID 或成员父分组 ID；成功回执必须包含完整的分组和成员关系 ID，校验通过后才建立本地分组身份与 group/member 映射。
- 分组更新以 URL 路径中的已有组 ID 定位；请求体不重复携带组 ID，已有成员关系仅在本地已有服务器映射时携带 AthleteGroupFormID，新成员不携带关系 ID。
- 比赛和成绩创建序列化已复核：新记录仍省略 RaceID、join id、ScoreID，并继续保留 ClientRaceKey、ClientScoreKey。
- AthleteID 作为后端业务 ID 不再在目录缓存、目录同步和本地成绩校验中使用 65535 上限；其与 0x10 的 16 位固件字段映射属于独立待联调边界。
- 按部署优先限制，本轮未新增或运行自动化测试；待完成类型检查后再记录结果。
- 类型检查：2026-09-10 执行 npm run typecheck 通过；仍未执行自动化测试、页面测试、真机或真实后端验证。

## 2026-09-10：重置完成状态修复

- “结束”继续只锁定结束圈；后端 IsFinished 仍等待全部参赛者完成，避免遗漏落后运动员的真实成绩。
- 固件确认 0x02 重置成功后，若本场使用 RaceSyncService，RaceController 现在调用其 finish(localId) 入队完成包；不再只写本地 ScoreRepository 而遗漏后端完成状态。
