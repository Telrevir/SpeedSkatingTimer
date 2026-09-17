# 小程序与后端部署联调交接

更新时间：2026-09-10

## 当前结论

- 后端计划 Task 1-7 已实现，接口、数据库脚本和部署说明已齐备；后端未提交、未推送，也未操作共享数据库。
- 小程序 Task 1-6 已提交到 `DetectOnly`，最新提交为 `e86ae51 feat: sync race lifecycle with backend`。
- 小程序 Task 7-9 已形成一版可供部署联调的生产代码：远端优先名单管理、服务端分页历史、当前比赛实时页。
- 按本轮要求，不继续补写或运行自动化测试。仅执行 TypeScript 类型检查；页面模拟器、真机和真实后端验证留给部署联调。

## 小程序本轮生产代码

- `miniprogram/pages/athletes/page-controller.ts`：运动员和分组的远端优先页面控制；成功回执后才更新界面，失败保留编辑状态。
- `miniprogram/pages/athletes/index.ts|wxml|wxss`：显示服务器可用状态；离线时仅锁定增删改，缓存名单仍可查看和用于比赛。
- `miniprogram/services/race-history-query.ts`：固定封装 `page/pageSize/sortBy/sortOrder`，默认按 `RaceDate desc` 每页 20 条；第一页合并未上传本地比赛并按 `ClientRaceKey` 去重。
- `miniprogram/pages/scores/index.ts|wxml|wxss`：服务端分页历史、上一页/下一页、失败保留旧列表并可重试。
- `miniprogram/pages/live-races/*`：活动比赛 5 秒刷新；展开比赛后成绩 1 秒刷新；请求不重叠，离开页面停止计时器，失败保留上次显示。
- `miniprogram/app.json`：注册非 Tab 的当前比赛页。
- `miniprogram/pages/race/index.wxml|wxss`：增加当前比赛入口；成绩页也提供入口。

## 后端已实现接口

- `GET /api/v1/race-bundles/page?ClubID=1&page=1&pageSize=20&sortBy=RaceDate&sortOrder=desc`
- `GET /api/v1/races/active?ClubID=1`
- `GET /api/v1/races/{RaceID}/latest-scores`
- `POST /api/v1/races`、`POST /api/v1/scores`、`POST /api/v1/race-bundles`
- 运动员 CRUD 与 `POST|PUT|DELETE /api/v1/athlete-group-bundles`

完整协议和部署说明：

- `后端服务器/docs/api-protocol.md`
- `后端服务器/docs/IMPLEMENTATION_HANDOFF_2026-09-07.md`
- `后端服务器/docs/SERVER_RACE_STORAGE_PROGRESS.md`

## 数据库部署位置

- 新建数据库：`后端服务器/wxcloudrun-springboot/src/main/resources/db.sql`
- 存量库只读预检：`后端服务器/wxcloudrun-springboot/src/main/resources/db/migration/V20260907_01__race_identity_live_queries_preflight.sql`
- 存量库正式迁移：`后端服务器/wxcloudrun-springboot/src/main/resources/db/migration/V20260907_01__race_identity_live_queries.sql`
- 历史字段清理：`后端服务器/wxcloudrun-springboot/src/main/resources/db/migration/V20260903_02__drop_clientraceid.sql`

部署顺序：完整备份 `speed_skating`，执行只读预检，人工处理预检结果，再执行正式迁移，最后核对三个目标表的结构和索引。MySQL DDL 不能假定整体事务回滚；失败时停止写入并从迁移前备份恢复。

## 部署联调清单

1. 在测试数据库执行预检与迁移，不直接使用生产库首次验证。
2. 启动后端，检查分页比赛、活动比赛、每名运动员最新成绩三个查询接口。
3. 打开小程序，确认目录刷新失败时仍可使用缓存名单开始离线比赛，但名单增删改被禁用。
4. 在线新增、编辑、归档、恢复运动员，并新增、编辑、删除分组；确认后端失败时界面不提前成功或关闭编辑框。
5. 在线开始比赛，确认后端生成 `RaceID` 和 `ScoreID`；制造超时后确认整场转离线，结束后通过完整包恢复。
6. 在成绩页检查 20 条分页、日期倒序、本地离线比赛合并及上传后去重。
7. 在当前比赛页检查 5 秒列表刷新、1 秒展开成绩刷新、总用时本地递增、领滑和排名。
8. 切换前后台并断开网络，确认轮询停止/恢复、旧显示保留、BLE 比赛不被网络请求阻塞。

## 留给后续人员的测试工作

- 完成并运行 Task 7 页面测试；当前已有未提交骨架 `tests/athlete-management-page.test.ts` 和 `tests/run-tests.ts` 导入。
- 为 `RaceHistoryQuery` 补分页、取消旧响应、离线合并和上传去重测试。
- 为当前比赛页补轮询生命周期、无重叠请求、失败保留旧数据显示和 view-model 测试。
- 运行完整 `npm test`；此前基线为 266 项中 260 项通过，6 项失败均来自用户当前 RF-CRAZY UUID 与旧 BT04-E FFE0/FFE1 测试夹具冲突。
- 使用微信开发者工具和真机完成页面布局、Worker 降级、BLE 重连历史和后台计时器验证。
- 后端在隔离数据库完成真实事务、并发、分页和查询执行计划验证。

## 当前约束

- 后端目录不得推送。
- 不读取或提交任何账号密码文件。
- 本轮小程序生产代码尚未推送；推送须等待明确指令。
- 用户已有 BLE 配置及对应文档/测试改动必须保留，不得回退或混入本轮功能提交。

backend not pushed

## 数据库生成 ID 联调补充

- 新增运动员：POST /athletes 的 body 不得含 AthleteID；仅采用成功回执的正整数 AthleteID 写入本地缓存。
- 新增分组：POST /athlete-group-bundles 的分组及成员 body 不得含 AthleteGroupID、AthleteGroupFormID 或成员的 AthleteGroupID；回执必须返还完整父子 ID。
- 更新分组：PUT 路径携带已有 AthleteGroupID，body 不重复携带组 ID；只有已映射的成员关系可携带 AthleteGroupFormID，新增成员关系不带该字段。
- AthleteID 不再有 65535 上限，但现行 0x10 固件协议仍为 16 位字段。后端业务 ID 与固件定义 ID 的对应方式需要在真机协议联调中单独确认，不能把超过 16 位范围的业务 ID 静默写入 0x10。
- 本轮未运行自动化测试、微信开发者工具、真机或真实后端验证；仅允许执行类型检查。
- 已执行 npm run typecheck 并通过；自动化测试、微信开发者工具、真机和真实后端验证仍未执行。
