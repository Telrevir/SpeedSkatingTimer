# 开发交接文档

更新时间：2026-09-03（第二阶段收尾 + RaceID 归属调整）

## 当前架构

- `AthleteCatalogService` 管理本地运动员主档；ID 范围 `1..65535`，自动递增，归档后不复用。
- `ActiveRaceSessionRepository` 以 schemaVersion 2 保存当前参赛 ID、活动分组 ID、定义成功数、本地比赛阶段与结束圈，以及每名运动员的原始圈数、补圈偏移、最后总时长和真实圈速历史；仍兼容 schemaVersion 1，成功重置后清除。
- `EpcDefinitionQueue` 严格串行发送 `0x10`，每条只等待匹配的 `0xF0`；成功才增加对应计数，失败不重试。
- `LocalRaceScoring` 保留 `0x12` 原始圈数，并通过独立 `LapCorrectionEngine` 维护累计补圈偏移。排名和领滑按修正圈数降序、总用时升序、ID 升序；固件单圈字段仍原样显示，估算圈不伪造单圈时间。
- `RaceController` 分别协调前台同步、EPC 定义和成绩接收。`0x10` 与 `0x12` 无耦合。
- `RaceController` 统一管理手动和自动连接尝试：小程序启动、比赛页显示及 BLE 断联后触发单轮自动连接；并发请求共用同一连接 Promise，未找到设备只更新状态，不弹 Toast。
- 历史成绩页使用“比赛 → 圈 → 运动员成绩”三级树状视图。比赛层显示时间、最大记录圈数和真实有效单圈平均值；圈层领滑及第三级名次均直接采用当时保存的原始成绩，不重新计算，也不生成自动补圈对应的虚拟圈。
- 第一阶段已停用旧临时上传：`temporary-backend-sync.ts` 默认 `false`，无启动调用与装配；旧文件现场改动和旧 ID 存储 `timer_count_temporary_backend_ids_v1` 保留，不再启动上传或弹窗。
- 接口层 `services/backend-api/`：config 集中地址/ClubID，request 只处理 HTTP/业务信封（2xx 且 `code === 0`），athletes/groups/group-members/race-bundles/sync-data 按业务分离；无页面、蓝牙、仓库依赖，不自动请求、重试或弹窗。
- 协调层 `services/backend-sync/` 已实现并接入：`StartupSync.runOnce` 在 `App.onLaunch` 非阻塞运行一次（状态可读、输出单条摘要）；流程为 拉取 → `validation.ts` 运行时校验 → 运动员 → 分组/关系 → 比赛包 保守合并。
- 后端契约：POST `/api/v1/race-bundles` 收单场比赛包，GET 同路径按 `ClubID` + `includeDisabled=true` 全量读取；时间百分秒。**比赛去重只使用 `RaceID`**：首次上传可不带 `RaceID`（后端生成并在成功响应返回，小程序绑定并持久化到该本地比赛），之后更新/重传携带同一 `RaceID`；远端历史无结束时间时 `finishedAt=null`，不虚构。
- 上传前先持久化映射（存储键 `timer_count_backend_sync_ids_v1`，按 ClubID 隔离、重启稳定、损坏拒绝重置）；POST 成功须通过**回执身份/内容校验**（`data:null`、错误 ClubID/ID 计失败；比赛回执必须带有效 `RaceID`）；既有子记录 ID 被其他云端父记录占用时上传前整体跳过并记冲突。
- 合并策略：相同忽略、远端独有导入（仓库 `importIfMissing` 只增不覆盖）、本地独有上传、冲突保留本地；无删除依据不删除；活动比赛或本地数据变化立即跳过本轮。

## 交接记录（2026-09-03 收尾）

本记录供后续接手者查阅。启动同步第二阶段已实现并通过自动化验证；原进度文件 `docs/STARTUP_SYNC_PROGRESS.md` 中的开放项已逐条关闭如下。

- 本轮修复（对应原“独立审查发现”项）：
  1. **POST 回执校验**：`upload()` 不再仅凭 `result.ok` 计成功；各实体新增 `verify*Receipt`（startup-sync.ts），要求回执身份与内容同请求一致，`data:null`、错误 ClubID/ID 一律计失败且不放行依赖上传。
  2. **子记录 ID 父归属冲突**：`id-mapping.ts` 将 reserve 的远端 ID 单独记录并暴露 `isRemote(kind, id)`；`races()`/`groups()` 上传前核对既有 join/score/member 绑定是否已被其他云端父记录占用，冲突则整体跳过。
  3. **导入后指纹/并发守护**：已确认每步导入后刷新 `expected`、仓库写队列内重检 `canImport`、运动员导入带 revision 守卫，均有既有回归覆盖；新增失败用例同时验证“等待期间不产生错误写入”。
- 新增回归（`tests/backend-startup-sync.test.ts`，+5 条）：回执 `data:null`（运动员/比赛）、回执错误 ClubID、远端复用比赛子记录 ID、远端复用组员 ID。
- 验证结果：编译后全套测试 **224/224 通过**，`tsc -p tsconfig.json --noEmit` **0 错误**，`git diff --check` 无告警。
- 标准命令：`npm test`、`npm run typecheck`。收尾会话因沙箱禁止写入 git-ignored 的 `build-test/`，改为 `node node_modules/typescript/bin/tsc -p tsconfig.test.json --outDir <临时目录>` 后运行同一套用例（结果等价，命令差异仅为环境限制）。
- 未完成、需人工/真机处理（勿自动执行）：真实后端接口联调并确认**回执形状**与代码假设一致；正式 ClubID 来源与合法 request 域名；跨设备 ID 冲突与唯一约束失败错误码；端到端真机验收（BLE + 同步）。
- 提交状态：**未提交、未推送**，工作区保留全部改动，等待项目主管审核后再决定提交。
- **RaceID 归属调整（同日第二轮）**：业务层移除 ClientRaceID，查重只使用 RaceID。后端 `RaceInfo`/Mapper/XML/`RaceBundleServiceImpl`/`RaceInfoServiceImpl` 删除 ClientRaceID；POST `/race-bundles`（及单资源 `/races` 新增）的 `RaceID` 可空=后端生成（`MAX+1`、冲突重试）并随成功响应返回，携带=按 RaceID 覆盖更新（跨俱乐部拒绝）。小程序 `backend-api/race-bundles.ts`、`backend-sync/race-mapping.ts`、`validation.ts`、`startup-sync.ts` 同步适配：首传不带 RaceID，成功后把回执 RaceID 绑定并持久化到本地比赛（`ids.bind('race', …)`），重传携带同一 RaceID；匹配与导入键只用 RaceID。
- 数据库：`db.sql` 去掉 `ClientRaceID` 列与 `uk_race_client_id`；需在运行库执行 `resources/db/migration/V20260903_02__drop_clientraceid.sql`（幂等；原 V1 补列文件已删除）。
- 验证：小程序全套 **224/224** + typecheck 0；后端 `mvn -o test` 通过（需 JDK，`JAVA_HOME=C:\Users\xiaog\.jdks\openjdk-18.0.1`）。
- 遗留注意：首次新增若响应丢失（重试时无 RaceID），纯 RaceID 去重无法识别同一场，会重复创建——正式联调时确认重试策略。

## 最终协议职责

| 命令 | 小程序行为 |
|---|---|
| `0x10` | 发送是否为运动员、4 字节 EPC、2 字节运动员 ID；非运动员 ID 固定 `0000` |
| `0x11` | 请求固件当前全部运动员状态 |
| `0x12` | 按运动员 ID 接收原始圈数、单圈百分秒和总百分秒；必要时只在小程序侧叠加补圈偏移 |
| `0x13` | 1 字节传输状态：`01` 开始、`00` 结束 |
| `0x14` | 接收 4 字节 EPC，按当前比赛范围分类后排队发送 `0x10` |

`0x12` 在 `0x13` 传输期间和日常主动上报期间采用完全相同的处理逻辑。`0x10` 失败只记录同步错误，不会阻止之后的 `0x12`。

## 比赛流程

- 开始：选定当前有效名单或分组，最多 50 人；`0x01/0xF0` 成功后创建本地活动会话并开始本场成绩。
- 结束：不发送停止命令，以当前领滑圈数为 `finishLap`；运动员到达该圈后冻结成绩。
- 重置：发送 `0x02`；仅在成功 `0xF0` 后清除本场成绩、定义队列和活动会话。
- 前台恢复：仅在控制器处于已连接状态时执行 `0x03 → 0x04`。若固件为 Detecting，则恢复本地会话并执行 `0x11 → 0x13[01] → 若干普通 0x12 → 0x13[00]`。

## 自动补圈边界

- 每名运动员独立使用最近 2 圈平均值或最近 3～5 圈中位数作为基准。
- 仅 `rawLapDelta === 1`、历史波动不超过 15%、估计经过 2～3 圈且分摊误差不超过 15% 时自动补圈，单次最多补 2 圈。
- `rawLapDelta > 1` 视为小程序漏收中间包，不补圈；重复包、倒退包和 `0x11` 重放不重复增加偏移。
- 自动补出的圈不进入真实圈速历史，不生成独立 `ScoreRepository` 记录，也不代表精确过线时间。
- finishing 阶段可通过补圈达到终点，但最终展示圈数不超过 `finishLap`。

## 已知限制与验收

- iOS 不保证小程序在后台持续运行或持续接收 BLE；依赖固件保存当前成绩，并在前台恢复时通过 `0x11` 补齐当前状态。
- 如果固件正在检测但本地活动会话缺失，`0x12` 和 `0x14` 会被忽略并记录“缺少本地比赛会话”。
- 启动同步尚未经过真机/真实新接口联调：回执校验假设真实接口会回显所建记录的完整身份/内容（AthleteID、AthleteGroupID、组员三字段、RaceInfo 与子记录 ID），联调时须确认；不匹配时同步会保守失败而不是写错数据。
- 待确认：合法 request 域名、ClubID 正式来源、跨手机 ID 冲突、唯一约束失败的明确错误码；后端契约已明确 EPC long 和时间百分秒。
- 自动化验证命令：`npm test`、`npm run typecheck`。
- 本次自动补圈实现按用户要求未执行自动化测试或类型检查。
- 仍需真机检查：停止状态连接不发 `0x11`；开始会话；组内/组外 EPC 分类；前后台恢复序列；补圈偏移在进程重启后恢复；结束圈跨越与冻结；成功重置清理。
