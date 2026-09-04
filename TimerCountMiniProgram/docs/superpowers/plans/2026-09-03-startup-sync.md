# 启动数据同步实施计划

> **For agentic workers:** 使用测试驱动逐项实施，分离模块由子任务完成，最后做独立代码审查；保留共享工作区现有修改，不提交其他任务文件。

**Goal:** 打开小程序时按 ClubID 拉取、校验并保守同步本地数据，失败不影响比赛。

**Architecture:** backend-api 保留独立 HTTP/DTO 接口；backend-sync 新增运行时校验、持久 ID 映射、比赛包映射和同步协调。业务仓库只添加不覆盖的导入入口；App.onLaunch 异步启动一次。

**Tech Stack:** TypeScript、wx.request、wx 本地存储、Node test。

**Spec:** 本任务已确认委派要求与后端服务器/docs/api-protocol.md；正常空数组是有效空库，需要上传本地独有数据。

## 全局约束

- 只改 TimerCountMiniProgram，不读账号文件，不改固件或后端；保留现场改动。
- HTTP/业务失败、损坏响应、ClubID 不匹配跳过。无自动删除；冲突保留本地。
- 当前进程只执行一轮；进入活动比赛或等待期间本地变化则停止后续动作。
- 数字 ID 必须为正安全整数，运动员 1..65535，EPC 0..4294967295，成绩百分秒。
- 新建 stable ID 存储与旧临时映射隔离；上传前保存，云端已有主键冲突不得覆盖。

## Task 1：校验及只增不改导入

文件：services/backend-sync/validation.ts、AthleteCatalogService/GroupStore/ScoreRepository 最小导入入口及 tests/backend-sync-validation.test.ts、tests/backend-sync-import.test.ts。

接口：validateClubData(value: unknown, clubId: number): ClubDataDto；parseRaceDate(value: string): number；仓库 importIfMissing 返回是否插入，运动员方法在现有队列内再检查 canImport。

- [ ] 先写正确快照和错误 ClubID/ID/关系/日期测试，运行观察失败。
- [ ] 实现完整快照校验和 JSON 克隆，不忽略不合法行。
- [ ] 测试导入不覆盖既有 ID/EPC/名字、不降低 nextId，写入失败不发布未落盘数据。
- [ ] 实现导入并运行定向测试，交由独立审查。

## Task 2：稳定 ID 和比赛包映射

文件：services/backend-sync/id-mapping.ts、race-mapping.ts、tests/backend-sync-mapping.test.ts。

接口：SyncIdMapping(storage, clubId)，get/assign/bind/save 管理实体类型与本地键；toRaceBundle(record, clubId, ids) 输出一次完整比赛包；fromRaceBundle(bundle, athletes, localId) 恢复历史。

- [ ] 测试同一存储重启后 ID 不变、不同 ClubID 隔离、已有云端 ID 不重用、损坏存储不重置。
- [ ] 实现正安全整数 ID、预留云端主键、冲突拒绝及写入后才允许上传。
- [ ] 测试百分秒原样、一次真实事件一条成绩、首次上传不带 RaceID 由后端分配返回并绑定复用、以及远端成绩还原。
- [ ] 实现映射；远端缺少精确结束时间时 finishedAt 为 null，不伪造，姓名/EPC 使用服务器运动员资料。

## Task 3：比对、协调与启动

文件：services/backend-sync/startup-sync.ts、app-services.ts、app.ts、tests/backend-startup-sync.test.ts、README/HANDOFF。

接口：StartupSync.runOnce(): Promise<SyncStatus>，status 可读取；依赖现有仓库和独立 API，isBusy 为 !raceController.canManageAthletes。

- [ ] 写空库上传、云端独有导入、相同忽略、冲突保留、失败跳过、并发同 Promise、活动比赛/异步本地变更停止测试。
- [ ] 实现先获取完整合法快照再依次运动员→分组→比赛同步，依赖上传失败则跳过相关数据。
- [ ] 每步写入前重新读取本地快照，导入只添加缺失记录；不删除/覆盖。
- [ ] App.onLaunch 非阻塞调用，onShow 只保留 BLE；旧临时模块无入口。
- [ ] 更新文档，运行 npm test、npm run typecheck、git diff --check，独立审查并修复。

## 决策和进度

- 正常空库仍执行本地独有上传（项目主管已明确纠正）；data 为 null 或损坏不是空库。
- 当前共享目录是用户指定工作区，保留未提交实现；不新建工作树、不自动提交或推送。
- **完成状态（2026-09-03 收尾）**：Task 1/2/3 已全部实现并通过自动化验证（全套 224/224、typecheck 0 错误）。独立审查发现的开放项已关闭：`id-mapping.ts` 暴露 `isRemote` 并在 `races()`/`groups()` 上传前核对既有子记录 ID 父归属，冲突整体不上传；`upload()` 增加回执身份/内容校验，`data:null`/错误 ClubID/ID 不再计成功。对应 5 条回归已加入 `tests/backend-startup-sync.test.ts`。
- **设计修订（同日，RaceID 归属调整）**：按业务要求移除 `ClientRaceID`，查重只使用 `RaceID`。新增比赛的 `RaceID` 由后端分配并在成功响应中返回；小程序把回执 `RaceID` 绑定并持久化到本地比赛，之后更新/重传携带同一 `RaceID`。后端（`RaceBundleServiceImpl`/`RaceInfoServiceImpl`/Mapper/db.sql/迁移）与小程序（DTO/validation/race-mapping/startup-sync）已同步修改，全套验证通过（小程序 224/224 + typecheck 0；后端 `mvn -o test` 通过），详见 `docs/HANDOFF.md` 与 `docs/STARTUP_SYNC_PROGRESS.md`。
- 剩余为人工/真机事项（运行库执行删列迁移、真机联调、回执形状确认、正式 ClubID/request 域名、首次新增响应丢失时的重试策略、跨设备冲突与错误码），交接见 `docs/HANDOFF.md`。
