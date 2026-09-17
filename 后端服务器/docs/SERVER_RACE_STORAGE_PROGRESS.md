# 后端比赛存储实施进度

更新时间：2026-09-09

## 当前状态

- Task 1“冻结协议与数据库迁移”已验收。
- Task 2“增加持久身份与单资源幂等写入”已验收。
- Task 3“事务化运动员分组聚合写入”已验收。
- Task 4“完整比赛包幂等与安全结束”已验收。
- Task 5“稳定分页比赛包查询”已验收。
- Task 6“活动比赛与每名运动员最新成绩查询”已验收。
- Task 7“最终后端验证与交接”已完成，等待最终验收。
- 未连接或修改共享/生产数据库，未推送后端仓库。
- 嵌套后端仓库因 Git `safe.directory` 所有权校验被阻止；按任务要求未修改全局 Git 配置，因此本次没有提交哈希，所有变更保留在工作区。

## 已冻结的协议与数据库决定

- 新比赛的 `RaceID` 由数据库生成；客户端必须提供最长 64 字符的 `ClientRaceKey`，并以 `ClubID + ClientRaceKey` 保证重试幂等。
- 新成绩的 `ScoreID` 由数据库生成；客户端必须提供最长 64 字符的 `ClientScoreKey` 和同一比赛内递增的 `EventSequence`。
- 新参赛关系的 `id` 由数据库生成；`RaceID + AthleteID` 唯一。
- 可选请求 ID 必须省略，不得发送 `-1` 或 `null`；成功响应返回规范化后的生成 ID。
- `IsFinished` 新建时为 `false`，只能由完整比赛包在所有子记录保存成功后最终置为 `true`；结束后只允许内容完全一致的幂等重传。
- `GET /api/v1/race-bundles` 旧版全量同步接口保留；新增分页路径为 `GET /api/v1/race-bundles/page`。
- `sortBy` 仅允许 `RaceDate|RaceID`，`sortOrder` 仅允许 `asc|desc`。
- 最新成绩接口按每名运动员最大的有效 `EventSequence` 选择记录，不按 `LapCount` 判断。

## Task 1 修改文件

- `后端服务器/docs/api-protocol.md`
- `后端服务器/docs/database-design.md`
- `后端服务器/wxcloudrun-springboot/src/main/resources/db.sql`
- `后端服务器/wxcloudrun-springboot/src/main/resources/db/migration/V20260907_01__race_identity_live_queries.sql`
- `后端服务器/wxcloudrun-springboot/src/main/resources/db/migration/V20260907_01__race_identity_live_queries_preflight.sql`

本进度文件：`后端服务器/docs/SERVER_RACE_STORAGE_PROGRESS.md`

## Task 2 修改文件

- `后端服务器/wxcloudrun-springboot/src/main/java/com/tencent/wxcloudrun/config/ConflictException.java`
- `后端服务器/wxcloudrun-springboot/src/main/java/com/tencent/wxcloudrun/model/RaceInfo.java`
- `后端服务器/wxcloudrun-springboot/src/main/java/com/tencent/wxcloudrun/model/Score.java`
- `后端服务器/wxcloudrun-springboot/src/main/java/com/tencent/wxcloudrun/dao/RaceInfoMapper.java`
- `后端服务器/wxcloudrun-springboot/src/main/java/com/tencent/wxcloudrun/dao/ScoreMapper.java`
- `后端服务器/wxcloudrun-springboot/src/main/resources/mapper/RaceInfoMapper.xml`
- `后端服务器/wxcloudrun-springboot/src/main/resources/mapper/ScoreMapper.xml`
- `后端服务器/wxcloudrun-springboot/src/main/java/com/tencent/wxcloudrun/service/RaceInfoService.java`
- `后端服务器/wxcloudrun-springboot/src/main/java/com/tencent/wxcloudrun/service/ScoreService.java`
- `后端服务器/wxcloudrun-springboot/src/main/java/com/tencent/wxcloudrun/service/impl/RaceInfoServiceImpl.java`
- `后端服务器/wxcloudrun-springboot/src/main/java/com/tencent/wxcloudrun/service/impl/ScoreServiceImpl.java`
- `后端服务器/wxcloudrun-springboot/src/main/java/com/tencent/wxcloudrun/controller/RaceInfoController.java`
- `后端服务器/wxcloudrun-springboot/src/main/java/com/tencent/wxcloudrun/controller/ScoreController.java`
- `后端服务器/wxcloudrun-springboot/src/test/java/com/tencent/wxcloudrun/service/RaceIdentityServiceTest.java`
- `后端服务器/wxcloudrun-springboot/src/test/java/com/tencent/wxcloudrun/controller/RaceWriteControllerTest.java`

Task 2 实现规则：比赛按 `ClubID + ClientRaceKey` 幂等创建；成绩按 `RaceID + ClientScoreKey` 和 `RaceID + EventSequence` 交叉查重；并发唯一键冲突后重新读取并比较内容。`RaceID` 和 `ScoreID` 由 MyBatis `useGeneratedKeys` 回填。比赛身份字段和成绩身份字段不可通过单资源更新移动，活动比赛不能通过通用 `PUT` 结束。已结束比赛及其成绩只接受完整内容相同的重放，新增、改写或删除返回 `ConflictException`；控制器保持 HTTP 200，并返回 `ApiResponse.code=409`。

## Task 3 修改文件

- `后端服务器/wxcloudrun-springboot/src/main/java/com/tencent/wxcloudrun/dto/AthleteGroupBundleRequest.java`
- `后端服务器/wxcloudrun-springboot/src/main/java/com/tencent/wxcloudrun/service/AthleteGroupBundleService.java`
- `后端服务器/wxcloudrun-springboot/src/main/java/com/tencent/wxcloudrun/service/impl/AthleteGroupBundleServiceImpl.java`
- `后端服务器/wxcloudrun-springboot/src/main/java/com/tencent/wxcloudrun/controller/AthleteGroupBundleController.java`
- `后端服务器/wxcloudrun-springboot/src/main/java/com/tencent/wxcloudrun/dao/AthleteGroupFormMapper.java`
- `后端服务器/wxcloudrun-springboot/src/main/resources/mapper/AthleteGroupFormMapper.xml`
- `后端服务器/wxcloudrun-springboot/src/test/java/com/tencent/wxcloudrun/service/AthleteGroupBundleServiceImplTest.java`
- `后端服务器/wxcloudrun-springboot/src/test/java/com/tencent/wxcloudrun/controller/AthleteGroupBundleControllerTest.java`

Task 3 实现规则：`POST`、`PUT`、`DELETE /api/v1/athlete-group-bundles` 均通过聚合服务在单个事务中处理。创建和更新在第一条写语句前校验组 ID、俱乐部归属、成员关系 ID、重复运动员及全部运动员引用。更新请求中的成员数组是完整有效成员列表：列出的已有关系会更新并恢复为启用，新关系会插入，遗漏的有效关系会软删除。删除分组时先软删除有效成员关系，再软删除分组。成功响应返回规范化分组和完整有效成员列表；冲突与缺失继续保持 HTTP 200，并分别返回业务码 `409`、`404`。

## Task 4 修改文件

- `后端服务器/wxcloudrun-springboot/src/main/java/com/tencent/wxcloudrun/service/impl/RaceBundleServiceImpl.java`
- `后端服务器/wxcloudrun-springboot/src/main/java/com/tencent/wxcloudrun/dao/RaceInfoMapper.java`
- `后端服务器/wxcloudrun-springboot/src/main/java/com/tencent/wxcloudrun/dao/AthleteRaceJoinMapper.java`
- `后端服务器/wxcloudrun-springboot/src/main/resources/mapper/RaceInfoMapper.xml`
- `后端服务器/wxcloudrun-springboot/src/main/resources/mapper/AthleteRaceJoinMapper.xml`
- `后端服务器/wxcloudrun-springboot/src/main/java/com/tencent/wxcloudrun/controller/RaceBundleController.java`
- `后端服务器/wxcloudrun-springboot/src/test/java/com/tencent/wxcloudrun/service/RaceBundleServiceImplTest.java`
- `后端服务器/wxcloudrun-springboot/src/test/java/com/tencent/wxcloudrun/controller/RaceBundleControllerTest.java`

计划中列出的 `RaceBundleRequest.java` 与 `RaceBundleService.java` 已具备所需请求/响应结构和 `saveRaceBundle` 签名，本轮未做无意义改动。

Task 4 实现：比赛按 `RaceID` 或 `ClubID + ClientRaceKey` 解析；不存在时以 `IsFinished=false` 插入并使用数据库生成的 `RaceID`。参赛关系按 `RaceID + AthleteID` 解析并返回数据库生成的 `id`，成绩交叉校验 `ScoreID`、`ClientScoreKey`、`EventSequence` 并返回数据库生成的 `ScoreID`。显式提供的 join/score ID 必须能按自身解析且与复合身份命中同一记录，不能被其他幂等键静默替代。未结束比赛只更新非身份字段，所有子记录成功后才执行 `markFinished`；已结束比赛必须完整、逐字段一致且不执行任何写操作。重复参赛者和显式跨比赛子记录在 Mapper 调用前拒绝。控制器保持 HTTP 200，并把 `ConflictException` 映射为业务码 `409`。旧 `maxRaceID` 方法、SQL、测试假设及 `MAX+1` 分配已删除。

## Task 5 修改文件

- `后端服务器/wxcloudrun-springboot/src/main/java/com/tencent/wxcloudrun/dto/RaceBundlePageResult.java`
- `后端服务器/wxcloudrun-springboot/src/main/java/com/tencent/wxcloudrun/controller/RaceBundleController.java`
- `后端服务器/wxcloudrun-springboot/src/main/java/com/tencent/wxcloudrun/controller/RaceInfoController.java`
- `后端服务器/wxcloudrun-springboot/src/main/java/com/tencent/wxcloudrun/service/RaceBundleService.java`
- `后端服务器/wxcloudrun-springboot/src/main/java/com/tencent/wxcloudrun/service/RaceInfoService.java`
- `后端服务器/wxcloudrun-springboot/src/main/java/com/tencent/wxcloudrun/service/impl/RaceBundleServiceImpl.java`
- `后端服务器/wxcloudrun-springboot/src/main/java/com/tencent/wxcloudrun/service/impl/RaceInfoServiceImpl.java`
- `后端服务器/wxcloudrun-springboot/src/main/java/com/tencent/wxcloudrun/dao/RaceInfoMapper.java`
- `后端服务器/wxcloudrun-springboot/src/main/java/com/tencent/wxcloudrun/dao/AthleteRaceJoinMapper.java`
- `后端服务器/wxcloudrun-springboot/src/main/java/com/tencent/wxcloudrun/dao/ScoreMapper.java`
- `后端服务器/wxcloudrun-springboot/src/main/resources/mapper/RaceInfoMapper.xml`
- `后端服务器/wxcloudrun-springboot/src/main/resources/mapper/AthleteRaceJoinMapper.xml`
- `后端服务器/wxcloudrun-springboot/src/main/resources/mapper/ScoreMapper.xml`
- `后端服务器/wxcloudrun-springboot/src/test/java/com/tencent/wxcloudrun/service/RaceBundleQueryServiceTest.java`
- `后端服务器/wxcloudrun-springboot/src/test/java/com/tencent/wxcloudrun/controller/RaceBundleControllerTest.java`
- `后端服务器/wxcloudrun-springboot/src/test/java/com/tencent/wxcloudrun/service/RaceBundleServiceImplTest.java`

Task 5 实现：新增 `GET /api/v1/race-bundles/page`，返回 `list`、`page`、`pageSize`、`total`、`sortBy`和 `sortOrder`。默认为 `page=1`、`pageSize=20`、`sortBy=RaceDate`、`sortOrder=desc`，单页最大 200 条；`sortBy` 仅允许 `RaceDate|RaceID`，`sortOrder` 仅允许 `asc|desc`，非法值拒绝。`RaceDate` 排序以同方向 `RaceID` 作稳定次排序。实现先分页查询比赛，再按当页 `RaceID` 各执行一次参赛关系和成绩批量查询，按比赛页顺序组装，避免 N+1；空页不执行子表查询。现有 `GET /api/v1/races` 共用同一排序默认和白名单；旧 `GET /api/v1/race-bundles` 全量同步行为保持不变。Mapper XML 只使用受控 `<choose>` 分支和 `<foreach>` 批量条件，未使用 `${sortBy}` 或 `${sortOrder}`。

## Task 6 当前修改文件

- `后端服务器/wxcloudrun-springboot/src/main/java/com/tencent/wxcloudrun/dto/ActiveRacesResponse.java`
- `后端服务器/wxcloudrun-springboot/src/main/java/com/tencent/wxcloudrun/dto/LatestScoresResponse.java`
- `后端服务器/wxcloudrun-springboot/src/main/java/com/tencent/wxcloudrun/controller/RaceInfoController.java`
- `后端服务器/wxcloudrun-springboot/src/main/java/com/tencent/wxcloudrun/service/RaceInfoService.java`
- `后端服务器/wxcloudrun-springboot/src/main/java/com/tencent/wxcloudrun/service/impl/RaceInfoServiceImpl.java`
- `后端服务器/wxcloudrun-springboot/src/main/java/com/tencent/wxcloudrun/dao/RaceInfoMapper.java`
- `后端服务器/wxcloudrun-springboot/src/main/java/com/tencent/wxcloudrun/dao/ScoreMapper.java`
- `后端服务器/wxcloudrun-springboot/src/main/resources/mapper/RaceInfoMapper.xml`
- `后端服务器/wxcloudrun-springboot/src/main/resources/mapper/ScoreMapper.xml`
- `后端服务器/wxcloudrun-springboot/src/test/java/com/tencent/wxcloudrun/service/LiveRaceQueryServiceTest.java`
- `后端服务器/wxcloudrun-springboot/src/test/java/com/tencent/wxcloudrun/controller/LiveRaceControllerTest.java`
- `后端服务器/wxcloudrun-springboot/src/test/java/com/tencent/wxcloudrun/service/RaceIdentityServiceTest.java`
- `后端服务器/wxcloudrun-springboot/src/test/java/com/tencent/wxcloudrun/service/RaceBundleQueryServiceTest.java`

Task 6 当前实现：新增 `GET /api/v1/races/active?ClubID={ClubID}`，在 Mapper 前校验 `ClubID` 为正整数，只返回 `Enabled=true` 且 `IsFinished=false` 的比赛，固定按 `RaceDate DESC, RaceID DESC` 排序，响应包含 `list`、`total` 和按 `yyyy-MM-dd HH:mm:ss` 序列化的 `ServerTime`。新增 `GET /api/v1/races/{RaceID}/latest-scores`，先确认比赛存在，不存在时保持 HTTP 200 并返回业务码 `404`；存在但无成绩时返回空 `Scores`。SQL 使用有效 `EventSequence` 按运动员选择最新成绩，同序列以更大 `ScoreID` 稳定决胜，未使用 `LapCount` 判断新旧。服务层同时做相同的轻量归一化兜底，防止旧序列或禁用成绩透传，并按 `AthleteID` 稳定输出。其他接口路径和 HTTP 200 + 业务信封惯例保持不变。

## Task 7 交接文件

- `后端服务器/docs/IMPLEMENTATION_HANDOFF_2026-09-07.md`

Task 7 完成内容：使用系统 Maven 3.8.6 和 JDK 1.8.0_51 运行完整 `mvn clean test`；检索动态排序插值、手工比赛 ID 分配和旧 `ClientRaceID` 用法；只读复核预检、正式迁移和历史 `ClientRaceID` 删除脚本；记录完整端点表、DTO 示例、备份/预检/迁移/结构复核命令、回滚限制、变更文件和已知风险。交接文档不含密码或运动员个人数据，并包含原文 `backend not pushed`。

## 迁移与预检

- 只读预检：`后端服务器/wxcloudrun-springboot/src/main/resources/db/migration/V20260907_01__race_identity_live_queries_preflight.sql`
- 正式迁移：`后端服务器/wxcloudrun-springboot/src/main/resources/db/migration/V20260907_01__race_identity_live_queries.sql`

实际升级前必须先完整备份 `speed_skating`，执行只读预检并人工处理所有重复、空值、非正 ID 或孤儿引用。正式迁移不会删除或合并冲突记录，发现不安全数据时以 `SIGNAL SQLSTATE '45000'` 中止。成功后应核对 `RaceInfoTable`、`AthleteRaceJoinTable`、`ScoreTable` 的 `SHOW CREATE TABLE` 输出。

MySQL 的 `ALTER TABLE` 和数据回填可能在后续报错前已经提交，不能假定脚本整体事务回滚。需要回退时应停止写入并从迁移前备份恢复；不要直接删除幂等键列或生成 ID 配置。

## 验证结果

- 文档与 SQL 名称检索通过：四个字段、九个接口、六个目标索引/唯一键名称一致。
- 协议文档内 26 个 JSON 代码块全部可解析，Markdown 围栏成对。
- 预检脚本静态检查未发现 `ALTER`、`UPDATE`、`INSERT`、`DELETE`、`CREATE`、`DROP` 或 `TRUNCATE` 数据/结构写语句。
- 使用本机隔离的 MySQL 8.0.28 验证了新库 `db.sql`：3 个目标主键均为 `AUTO_INCREMENT`，6 个目标索引均存在。
- 在本机旧结构样例上运行迁移成功：存量比赛回填 `legacy:{RaceID}` 且 `IsFinished=true`；成绩回填 `legacy:{ScoreID}`，并按每场比赛的 `ScoreID` 顺序生成 `EventSequence`。
- 同一旧结构连续执行迁移两次成功；旧数据保持不变，新比赛、参赛关系和成绩均能生成新 ID，新比赛默认 `IsFinished=false`。
- 人为制造重复有效参赛关系后，迁移按预期以 `SQLSTATE 45000` 中止。
- 初次旧库验证暴露外键引用导致的 MySQL 错误 1833；迁移已增加会话级外键检查保存/恢复及异常恢复处理，修正后外键保持存在且旧库升级通过。
- Task 1 只修改文档和 SQL，没有运行 Maven 测试；后端 Java 自动化测试从 Task 2 开始。
- 本地 MySQL 测试实例已关闭，临时目录已清理。
- Task 2 严格按 TDD 执行：先新增 `RaceIdentityServiceTest` 和 `RaceWriteControllerTest`，聚焦测试在生产代码修改前因缺少 `ConflictException` 编译失败，符合预期红灯。
- Task 2 聚焦测试：`mvn '-Dtest=RaceIdentityServiceTest,RaceWriteControllerTest' test`，19 个测试通过，0 失败、0 错误、0 跳过。
- Task 2 全量测试：`mvn test`，34 个测试通过，0 失败、0 错误、0 跳过。
- Task 3 严格按 TDD 执行：先新增 `AthleteGroupBundleServiceImplTest` 和 `AthleteGroupBundleControllerTest`，生产代码修改前聚焦测试因缺少聚合 DTO、服务和控制器而编译失败，符合预期红灯。
- Task 3 聚焦测试：`mvn '-Dtest=AthleteGroupBundleServiceImplTest,AthleteGroupBundleControllerTest' test`，13 个测试通过，0 失败、0 错误、0 跳过。
- Task 3 全量测试：`mvn test`，47 个测试通过，0 失败、0 错误、0 跳过。
- Task 3 测试覆盖聚合创建、完整成员列表替换、停用关系恢复、遗漏关系软删除、跨俱乐部拒绝且组/成员 Mapper 零交互、重复成员、路径/正文 ID 冲突、联动删除、第三个成员写入异常向事务边界传播，以及控制器 `409/404` 业务码映射。
- Task 4 严格按 TDD 执行：先替换比赛包测试，生产代码修改前因缺少 `AthleteRaceJoinMapper.getByRaceAndAthlete` 和 `RaceInfoMapper.markFinished` 编译失败，符合预期红灯。
- Task 4 聚焦测试：`mvn '-Dtest=RaceBundleServiceImplTest,RaceBundleControllerTest' test`，20 个测试通过，0 失败、0 错误、0 跳过。
- Task 4 聚焦测试覆盖缺失 ID 的数据库回填、已有 `ClientRaceKey` 续传、结束标志最后写入、已结束比赛完全一致重放零写入、分歧成绩重放冲突、重复参赛者、跨比赛子记录、子写入异常传播且不结束比赛、结束后修改拒绝，以及未结束成绩仅更新非身份字段。
- Task 4 全量测试：`mvn test`，58 个测试通过，0 失败、0 错误、0 跳过。
- 最终逻辑复核新增两项 TDD 场景：显式不存在的参赛关系 `id` 或 `ScoreID` 不得借由复合幂等键命中其他记录。测试先失败并复现静默归一化问题，修正后聚焦与全量测试均通过。
- 已补充断言按已有 `ClientRaceKey` 恢复未结束比赛时返回原有参赛关系 `id` 和成绩 `ScoreID`，并覆盖比赛包控制器 HTTP 200 下的业务码 `400/409/500` 信封。
- `RaceInfoMapper.xml` 与 `AthleteRaceJoinMapper.xml` 均可解析；源码和测试检索确认不存在 `maxRaceID` 或 `MAX(RaceID)` 引用。
- Task 5 严格按 TDD 执行：先新增 `RaceBundleQueryServiceTest`，生产代码修改前聚焦测试因缺少 `RaceBundlePageResult` 而编译失败，符合预期红灯。
- Task 5 聚焦服务测试：`mvn '-Dtest=RaceBundleQueryServiceTest' test`，7 个测试通过，0 失败、0 错误、0 跳过。覆盖默认值、200 条上限、排序白名单、升降序、空页以及两次子表批量查询。
- Task 5 验收全量测试：主管独立运行 Maven 全量测试，76 个测试通过，0 失败、0 错误。
- Task 5 静态复核确认排序 SQL 未插值用户输入，非空页仅各执行一次 join/score 批量查询，并保留页面比赛顺序。
- Task 6 严格按 TDD 执行：先新增 `LiveRaceQueryServiceTest` 和 `LiveRaceControllerTest`，生产代码修改前聚焦测试因缺少 `ActiveRacesResponse` 和 `LatestScoresResponse` 而编译失败，符合预期红灯。
- Task 6 加强最新成绩兜底前，聚焦测试准确复现 3 个失败：旧 `EventSequence`、禁用高序列和同序列较小 `ScoreID` 被透传。增加服务层归一化后三项均转绿。
- Task 6 最终聚焦测试：`mvn '-Dtest=LiveRaceQueryServiceTest,LiveRaceControllerTest' test`，11 个测试通过，0 失败、0 错误、0 跳过。
- Task 6 最终全量测试：`mvn test`，78 个测试通过，0 失败、0 错误、0 跳过。
- Task 6 测试覆盖计划规定的精确用例名 `returnsAllActiveRacesForClubInNewestOrder`、`latestScoresSelectMaxEventSequencePerAthlete`、`latestScoresIgnoreDisabledEvents` 和 `missingRaceReturnsCode404`，另覆盖缺少/0 俱乐部 ID、空成绩、同序列 `ScoreID` 决胜、查询顺序和响应字段/时间格式。
- `RaceInfoMapper.xml` 与 `ScoreMapper.xml` 可解析；静态复核确认活动比赛过滤/排序、最新成绩有效性、`EventSequence` 主比较及 `ScoreID` 次比较均在固定 SQL 中。
- Task 7 完整验证：`mvn clean test` 退出码 0，78 个测试通过，0 失败、0 错误、0 跳过。Maven Wrapper 启动包不存在，因此按计划允许的兜底使用系统 Maven。
- Task 7 禁止模式检索：生产 Java、Mapper XML 和测试中未发现动态排序插值、`maxRaceID`、`MAX(RaceID)` 或旧 `ClientRaceID` 用法。`ClientRaceID` 只出现在合法的历史删除迁移 `V20260903_02__drop_clientraceid.sql` 中。
- Task 7 只读 SQL 复核：预检脚本未发现数据/结构写语句；本轮未执行任何数据库操作。
- Maven Wrapper 因本地缺少 wrapper 启动包并尝试联网下载而不可用；改用系统 Maven 3.8.6 和项目要求的 JDK 1.8.0_51。Maven 输出仅有系统 `settings.xml` 中既有未知 `mirror` 标签警告，不影响构建结果。
- 两份 Mapper XML 均可解析；`RaceInfoMapper.insert` 和 `ScoreMapper.insert` 均启用 `useGeneratedKeys=true`，本次两个单资源服务中不存在 `maxRaceID` 或 `MAX+1` 分配。

## 阻塞项

- `后端服务器/wxcloudrun-springboot` 当前返回 `fatal: unsafe repository`。任务明确禁止自行修改全局 Git 配置，因此无法执行嵌套仓库的 `git status`、暂存或提交。本次提交状态：未提交。
- 协议文档位于嵌套仓库外的兄弟目录，按计划仅作为本地主管审查材料保留。
- 本轮未运行真实数据库事务、并发、分页或实时查询集成测试；自动化测试使用 Mockito 验证异常传播、零写重放、最后写入顺序、批量查询调用和实时查询服务边界。MySQL 真实排序、最新成绩执行计划及大数据量性能仍属于部署前集成验证范围。
- Task 7 的 Git 状态记录仍被 `fatal: unsafe repository` 阻止；按约束未修改 `safe.directory`，未暂存、未提交、未推送。

## 下一步

当前等待 Task 7 最终验收。若继续，下一条精确操作是由主管打开 `后端服务器/docs/IMPLEMENTATION_HANDOFF_2026-09-07.md`，按其端点表、测试摘要、迁移顺序和已知风险做最终文档审查；在获得新的明确授权前，不执行数据库脚本、不修改 Git 配置、不提交也不推送。

backend not pushed
