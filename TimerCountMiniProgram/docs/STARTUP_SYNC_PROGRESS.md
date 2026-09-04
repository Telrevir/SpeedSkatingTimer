# 启动同步进度（2026-09-03：第二阶段收尾 + RaceID 归属调整，均已完成并验证）

## 最终状态

启动同步第二阶段与随后的“业务层移除 ClientRaceID、纯 RaceID 查重、后端分配并返回 RaceID”调整均已实现并通过自动化验证。交接与后续人工事项见 `docs/HANDOFF.md`。

## 设计与策略（现行有效）

- backend-api 按业务独立文件；POST `/api/v1/race-bundles` 一次比赛包，GET 同路径 ClubID + `includeDisabled=true`。
- **比赛去重只使用 `RaceID`（已移除 ClientRaceID）**：
  - 首次新增：请求 `RaceInfo.RaceID` 可省略，后端分配（`MAX(RaceID)+1`，主键冲突重试）并随成功响应返回；
  - 小程序保存：把回执 `RaceID` 绑定并持久化到该本地比赛（`id-mapping` race 绑定，存储键 `timer_count_backend_sync_ids_v1`），此后更新/重传同一场比赛携带同一 `RaceID`（后端按 `RaceID` 覆盖更新，已属其他俱乐部则拒绝）；
  - 远端回拉与本地匹配、冲突检测、导入键（`backend:{clubId}:race:{RaceID}`）都只依据 `RaceID`。
- 运行时校验 ClubID、安全整数、ID/EPC/姓名/日期与关联引用；RaceID 在远端快照中必填、在新增上传载荷中可空。
- StartupSync 启动异步运行一次、缓存 Promise；状态可读并输出一次摘要，不弹窗、不阻断 BLE、不自动重试。
- 相同忽略、远端独有导入（只增不覆盖）、本地独有上传、冲突保留本地；不自动删除；活动比赛或本地变化立即跳过本轮。
- POST 成功以回执身份/内容校验为准（`data:null`、错误 ClubID/ID 计失败；比赛回执必须带有效 RaceID）；既有子记录 ID 被其他云端父记录占用时上传前整体跳过并记冲突。

## 本轮文件清单（含第二阶段遗留与 RaceID 调整）

后端 `后端服务器/wxcloudrun-springboot`：
- `model/RaceInfo.java`、`dao/RaceInfoMapper.java`、`resources/mapper/RaceInfoMapper.xml`：删除 ClientRaceID，新增 `maxRaceID`。
- `service/impl/RaceBundleServiceImpl.java`：去掉 ClientRaceID 查重；RaceID 可空=生成并插入，非空=按 RaceID 覆盖更新（跨 Club 拒绝）。
- `service/impl/RaceInfoServiceImpl.java`：单资源 `/races` 新增同规则（RaceID 可空=后端分配）。
- `resources/db.sql`：RaceInfoTable 去掉 ClientRaceID 列与唯一键。
- `resources/db/migration/V20260903_02__drop_clientraceid.sql`：删列/删键幂等迁移（V1 补列迁移已删除）。

小程序 `TimerCountMiniProgram`：
- `backend-api/race-bundles.ts`：RaceInfo/子记录 RaceID 可空，移除 ClientRaceID。
- `backend-sync/race-mapping.ts`：首传不带 RaceID/ClientRaceID；绑定后携带 RaceID。
- `backend-sync/validation.ts`：移除 ClientRaceID；RaceID 支持 `raceIdOptional`（创建载荷可空，远端必填且唯一）。
- `backend-sync/startup-sync.ts`：匹配/导入键只按 RaceID；上传成功把回执 RaceID 绑定持久化（`ids.bind('race', …)` + `save`）。
- 测试：`backend-api.test.ts`、`backend-sync-validation.test.ts`、`backend-sync-mapping.test.ts`、`backend-startup-sync.test.ts` 全部适配（模拟后端对无 RaceID 的 POST 分配并返回）。

文档：`后端服务器/docs/api-protocol.md`、`database-design.md`、`TimerCountMiniProgram/README.md`、`docs/HANDOFF.md`、`docs/superpowers/plans/2026-09-03-startup-sync.md`。

## 验证结果（实测）

- 小程序：编译后全套测试 **224/224 通过**；`tsc -p tsconfig.json --noEmit` **0 错误**；`git diff --check` 无告警。
- 后端：`mvn -o test` 通过（服务层单测 + 接口层测试；需 `JAVA_HOME` 指向 JDK，本机为 `C:\Users\xiaog\.jdks\openjdk-18.0.1`）。
- 说明：标准 `npm test` 会写 git-ignored `build-test/`，本环境沙箱禁写，改为 `node node_modules/typescript/bin/tsc -p tsconfig.test.json --outDir <临时目录>` 后运行同一套用例。

## 仍未完成（人工/真机，勿自动执行）

- 真实后端联调并确认回执形状；在运行库执行 `V20260903_02__drop_clientraceid.sql` 删列。
- 首次新增响应丢失时的重试去重窗口（无 RaceID 可凭）需人工策略确认。
- 正式 ClubID 与合法 request 域名；端到端真机验收；不得对真实接口做写测试。

## 提交状态

未提交、未推送；工作区保留全部改动，等待审核。后续接手先读 `docs/HANDOFF.md`。
