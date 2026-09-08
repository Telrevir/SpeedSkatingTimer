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

本轮交接已完成。下一步按 `docs/superpowers/plans/2026-09-07-miniprogram-server-race-sync.md` 的顺序继续 **Task 3：启动编排与页面接入**；先构造并注入 `CatalogCacheSync`、两类管理服务及其 `mappingStorage`，再接入页面。不得覆盖上述工作区保护列表；不需要重做 Task 2 的缓存、管理服务或映射测试。
