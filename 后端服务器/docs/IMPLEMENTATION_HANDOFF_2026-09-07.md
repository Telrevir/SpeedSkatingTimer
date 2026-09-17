# 后端比赛存储实现交接

交接日期：2026-09-09  
项目：`wxcloudrun-springboot`  
数据库：`speed_skating`  
服务器：`https://springboot-z3m5-307081-12-1465315659.sh.run.tcloudbase.com`

## 1. 状态摘要

- Task 1 至 Task 6 已完成并验收；Task 7 已完成最终本地验证和交接整理，等待最终验收。
- 后端保持既有 HTTP 200 + `ApiResponse.code` 业务信封惯例。
- 本轮未连接、修改或迁移共享/生产数据库。
- 嵌套后端仓库被 Git `unsafe repository` 所有权检查阻止；未修改全局 `safe.directory`。
- 本次没有可提供的实现提交哈希，变更保留在工作区，未暂存、未提交、未推送。

backend not pushed

## 2. 响应与通用规则

所有业务路径以 `/api/v1` 开头，请求和响应使用 `application/json`。成功业务码为 `0`，常用失败业务码为 `400`、`404`、`409`、`500`。删除接口默认软删除；列表默认不包含禁用数据。

列表默认 `page=1`、`pageSize=20`，单页上限 200。比赛列表和分页比赛包的 `sortBy` 仅允许 `RaceDate|RaceID`，`sortOrder` 仅允许 `asc|desc`。

## 3. 端点表

| 资源 | 方法与路径 | 用途 |
| --- | --- | --- |
| 俱乐部 | `GET, POST /api/v1/clubs`; `GET, PUT, DELETE /api/v1/clubs/{ClubID}` | 俱乐部 CRUD |
| 教练 | `GET, POST /api/v1/coaches`; `GET, PUT, DELETE /api/v1/coaches/{CoachID}` | 教练 CRUD |
| 运动员 | `GET, POST /api/v1/athletes`; `GET, PUT, DELETE /api/v1/athletes/{AthleteID}` | 运动员 CRUD |
| 运动员组 | `GET, POST /api/v1/athlete-groups`; `GET, PUT, DELETE /api/v1/athlete-groups/{AthleteGroupID}` | 分组 CRUD |
| 分组关系 | `GET, POST /api/v1/athlete-group-forms`; `GET, PUT, DELETE /api/v1/athlete-group-forms/{AthleteGroupFormID}` | 分组成员 CRUD |
| 家长 | `GET, POST /api/v1/parents`; `GET, PUT, DELETE /api/v1/parents/{ParentID}` | 家长 CRUD |
| 比赛 | `GET, POST /api/v1/races`; `GET, PUT, DELETE /api/v1/races/{RaceID}` | 比赛 CRUD 和稳定排序 |
| 参赛关系 | `GET, POST /api/v1/athlete-race-joins`; `GET, PUT, DELETE /api/v1/athlete-race-joins/{id}` | 比赛运动员关系 CRUD |
| 成绩 | `GET, POST /api/v1/scores`; `GET, PUT, DELETE /api/v1/scores/{ScoreID}` | 成绩 CRUD |
| 分组聚合 | `POST /api/v1/athlete-group-bundles`; `PUT, DELETE /api/v1/athlete-group-bundles/{AthleteGroupID}` | 事务化创建、完整成员替换和联动删除 |
| 比赛包写入 | `POST /api/v1/race-bundles` | 幂等保存完整比赛、参赛关系和成绩，最后结束比赛 |
| 旧全量同步 | `GET /api/v1/race-bundles?ClubID={ClubID}` | 保留的兼容接口 |
| 分页比赛包 | `GET /api/v1/race-bundles/page?ClubID={ClubID}&page=1&pageSize=20&sortBy=RaceDate&sortOrder=desc` | 分页查询完整比赛包，子表批量加载 |
| 活动比赛 | `GET /api/v1/races/active?ClubID={ClubID}` | 返回全部启用且未结束比赛 |
| 最新成绩 | `GET /api/v1/races/{RaceID}/latest-scores` | 按每名运动员最大有效 `EventSequence` 返回成绩 |

## 4. 最终 DTO 示例

以下只使用无个人身份含义的占位 ID。

### 4.1 完整比赛包

首次提交必须省略 `RaceID`、参赛关系 `id` 和 `ScoreID`，不得发送 `-1` 或 `null`。

```json
{
  "RaceInfo": {
    "ClientRaceKey": "client-race-example-001",
    "RaceDate": "2026-09-09 10:00:00",
    "ClubID": 1,
    "IsFinished": true,
    "Enabled": true
  },
  "AthleteRaceJoins": [
    {
      "AthleteID": 100,
      "Enabled": true
    }
  ],
  "Scores": [
    {
      "AthleteID": 100,
      "ClientScoreKey": "client-score-example-001",
      "EventSequence": 1,
      "LapCount": 1,
      "SingleLapTime": 4310,
      "TotalTime": 4310,
      "Rank": 1,
      "Enabled": true
    }
  ]
}
```

成功响应的 `data` 使用同一结构，并补全数据库生成的正整数 `RaceID`、`id` 和 `ScoreID`。

### 4.2 分页比赛包

```json
{
  "list": [
    {
      "RaceInfo": {
        "RaceID": 1001,
        "ClientRaceKey": "client-race-example-001",
        "RaceDate": "2026-09-09 10:00:00",
        "ClubID": 1,
        "IsFinished": true,
        "Enabled": true
      },
      "AthleteRaceJoins": [],
      "Scores": []
    }
  ],
  "page": 1,
  "pageSize": 20,
  "total": 1,
  "sortBy": "RaceDate",
  "sortOrder": "desc"
}
```

### 4.3 活动比赛

```json
{
  "list": [
    {
      "RaceID": 1002,
      "ClientRaceKey": "client-race-example-002",
      "RaceDate": "2026-09-09 11:00:00",
      "ClubID": 1,
      "IsFinished": false,
      "Enabled": true
    }
  ],
  "total": 1,
  "ServerTime": "2026-09-09 11:05:00"
}
```

### 4.4 每名运动员最新成绩

```json
{
  "RaceID": 1002,
  "Scores": [
    {
      "ScoreID": 3001,
      "RaceID": 1002,
      "AthleteID": 100,
      "ClientScoreKey": "client-score-example-001",
      "EventSequence": 4,
      "LapCount": 3,
      "SingleLapTime": 4310,
      "TotalTime": 12980,
      "Rank": 1,
      "Enabled": true
    }
  ]
}
```

最新成绩按每名运动员的最大有效 `EventSequence` 选取；同序列以更大 `ScoreID` 决胜，`LapCount` 不参与新旧判断。

### 4.5 运动员分组聚合

```json
{
  "AthleteGroup": {
    "AthleteGroupID": 10,
    "ClubID": 1,
    "AthleteGroupName": "Group 10",
    "Enabled": true
  },
  "AthleteGroupForms": [
    {
      "AthleteGroupFormID": 101,
      "AthleteGroupID": 10,
      "AthleteID": 100,
      "Enabled": true
    }
  ]
}
```

`PUT` 请求中的 `AthleteGroupForms` 是完整有效成员列表：列出的关系会更新/恢复，遗漏的现有有效关系会软删除。

## 5. 数据库部署交接

本节仅记录后续人工部署步骤；本轮没有执行任何数据库命令。

### 5.1 文件

- 新库结构：`后端服务器/wxcloudrun-springboot/src/main/resources/db.sql`
- 存量库只读预检：`后端服务器/wxcloudrun-springboot/src/main/resources/db/migration/V20260907_01__race_identity_live_queries_preflight.sql`
- 存量库正式迁移：`后端服务器/wxcloudrun-springboot/src/main/resources/db/migration/V20260907_01__race_identity_live_queries.sql`
- 历史清理：`后端服务器/wxcloudrun-springboot/src/main/resources/db/migration/V20260903_02__drop_clientraceid.sql`。`ClientRaceID` 只在该脚本中用于删除旧列/索引，不是生产 Java 或 MyBatis 的过时用法，不得因静态检索命中而删除该迁移。

### 5.2 必须的执行顺序

1. 停止相关写入，确认目标库为 `speed_skating`。
2. 先创建完整备份，并验证备份文件可读。命令示例：

```powershell
mysqldump --single-transaction --routines --triggers --user=<db_user> --password --result-file=speed_skating_before_V20260907_01.sql speed_skating
```

3. 只运行预检，检查所有重复、空值、非正 ID、孤儿引用以及目标列/索引状态：

```powershell
mysql --user=<db_user> --password --database=speed_skating --execute="SOURCE D:/path/to/V20260907_01__race_identity_live_queries_preflight.sql"
```

4. 任何重复、空值、非正 ID 或孤儿引用都必须先人工处理；不得让迁移脚本自动删除或合并业务数据。
5. 预检全部通过后才执行正式迁移：

```powershell
mysql --user=<db_user> --password --database=speed_skating --execute="SOURCE D:/path/to/V20260907_01__race_identity_live_queries.sql"
```

6. 执行后复核最终结构：

```sql
SHOW CREATE TABLE `RaceInfoTable`;
SHOW CREATE TABLE `AthleteRaceJoinTable`;
SHOW CREATE TABLE `ScoreTable`;
```

必须确认三个主键为 `AUTO_INCREMENT`，并存在 `uk_race_club_client_key`、`idx_race_live_history`、`uk_race_athlete`、`uk_score_race_client_key`、`uk_score_race_sequence` 和 `idx_score_latest`。

### 5.3 回滚限制

MySQL `ALTER TABLE` 和数据回填可能在后续错误前已提交，不能假定迁移程序整体事务回滚。若迁移失败，应继续停止写入，保留错误现场，并从迁移前完整备份恢复。不得通过直接删除幂等键列、索引或 `AUTO_INCREMENT` 配置作为通用回滚。

## 6. 验证结果

- Maven Wrapper 启动包 `.mvn/wrapper/maven-wrapper.jar` 不存在；未依赖 Wrapper 联网下载。
- 使用系统 Maven 3.8.6 和 JDK 1.8.0_51 运行 `mvn clean test`：退出码 0，78 个测试通过，0 失败、0 错误、0 跳过。
- Maven 仅输出系统 `settings.xml` 中既有的未识别 `mirror` 标签警告，未影响构建结果。
- 生产 Java、Mapper XML 和测试中未发现动态排序插值、`maxRaceID`、`MAX(RaceID)` 或旧 `ClientRaceID` 用法。
- `ClientRaceID` 仅在合法的 `V20260903_02__drop_clientraceid.sql` 历史删除脚本中出现。
- `V20260907_01__race_identity_live_queries_preflight.sql` 语句级静态检查不包含 `ALTER`、`UPDATE`、`INSERT`、`DELETE`、`CREATE`、`DROP` 或 `TRUNCATE` 写语句。
- 本轮仅只读复核 SQL，没有在真实数据库上运行预检、迁移或查询。

## 7. 变更文件

以下为 Task 1 至 Task 6 的合并交接范围；同一文件只列一次。

### 7.1 文档与 SQL

- `后端服务器/docs/api-protocol.md`
- `后端服务器/docs/database-design.md`
- `后端服务器/docs/SERVER_RACE_STORAGE_PROGRESS.md`
- `后端服务器/docs/IMPLEMENTATION_HANDOFF_2026-09-07.md`
- `后端服务器/wxcloudrun-springboot/src/main/resources/db.sql`
- `后端服务器/wxcloudrun-springboot/src/main/resources/db/migration/V20260907_01__race_identity_live_queries_preflight.sql`
- `后端服务器/wxcloudrun-springboot/src/main/resources/db/migration/V20260907_01__race_identity_live_queries.sql`

### 7.2 主要生产代码

- 配置/模型：`ConflictException.java`、`RaceInfo.java`、`Score.java`
- DTO：`AthleteGroupBundleRequest.java`、`RaceBundlePageResult.java`、`ActiveRacesResponse.java`、`LatestScoresResponse.java`
- Controller：`AthleteGroupBundleController.java`、`RaceBundleController.java`、`RaceInfoController.java`、`ScoreController.java`
- Service：`AthleteGroupBundleService.java`、`RaceBundleService.java`、`RaceInfoService.java`、`ScoreService.java`
- Service 实现：`AthleteGroupBundleServiceImpl.java`、`RaceBundleServiceImpl.java`、`RaceInfoServiceImpl.java`、`ScoreServiceImpl.java`
- Mapper 接口：`AthleteGroupFormMapper.java`、`AthleteRaceJoinMapper.java`、`RaceInfoMapper.java`、`ScoreMapper.java`
- Mapper XML：`AthleteGroupFormMapper.xml`、`AthleteRaceJoinMapper.xml`、`RaceInfoMapper.xml`、`ScoreMapper.xml`

### 7.3 测试

- `AthleteGroupBundleServiceImplTest.java`
- `AthleteGroupBundleControllerTest.java`
- `RaceIdentityServiceTest.java`
- `RaceWriteControllerTest.java`
- `RaceBundleServiceImplTest.java`
- `RaceBundleControllerTest.java`
- `RaceBundleQueryServiceTest.java`
- `LiveRaceQueryServiceTest.java`
- `LiveRaceControllerTest.java`

详细的逐任务文件记录见 `后端服务器/docs/SERVER_RACE_STORAGE_PROGRESS.md`。

## 8. 已知风险与部署前检查

- 未在真实 MySQL 上验证并发唯一键恢复、`markFinished` 锁等待、分页稳定性、批量 `IN` 查询、最新成绩执行计划或大数据量性能。
- 自动化测试主要使用 Mockito；上线前应在脱敏隔离环境执行数据库集成和并发验证。
- 迁移包含 DDL 和数据回填，失败时可能部分提交；完整备份是唯一可靠的通用回退基础。
- 当前业务接口尚未接入登录鉴权，正式暴露前需要按部署环境完成访问控制。
- 客户端必须以响应体 `code` 判断业务成功，不能仅依赖 HTTP 状态。
- 部署前必须人工核对目标数据库、备份文件、预检所有结果、六个目标索引和三个数据库生成主键。

## 9. 仓库状态

在 `后端服务器/wxcloudrun-springboot` 执行 `git status --short --branch` 被以下错误阻止：

```text
fatal: unsafe repository
```

按任务约束，未执行 Git 建议的全局 `safe.directory` 修改，因此无法在本轮获取可信的嵌套仓库分支/工作区清单，也没有暂存、提交或推送。最终验收应以当前工作区文件和本交接记录为准。

backend not pushed

## 10. 2026-09-10 数据库生成主键补充交接

### 10.1 根因与契约

- 生产日志 `Unknown column 'ClientRaceKey' in 'field list'` 的直接原因是目标数据库未完整执行 `V20260907_01__race_identity_live_queries.sql`，与本轮六张目录表自增改造是两个独立部署事项。
- 九张业务表保留既有主键名称：`ClubID`、`CoachID`、`AthleteID`、`AthleteGroupID`、`AthleteGroupFormID`、`ParentID`、`RaceID`、参赛关系 `id`、`ScoreID`。
- 所有普通 `POST` 新增请求必须省略自身主键；非空客户端主键返回业务码 `400`。数据库生成正主键，MyBatis 回填后由成功响应返回。
- `AthleteID` 是普通数据库 `INT` 主键，与 EPC、固件编号无关，不设 `65535`、`SMALLINT` 或 `CHECK` 限制。
- 分组聚合创建先生成组 ID，再生成全部成员关系 ID；更新时已有成员保留数据库 ID，新成员省略 ID。比赛、参赛关系和成绩继续保留既有幂等键与重放规则。

### 10.2 新增迁移文件

- `wxcloudrun-springboot/src/main/resources/db/migration/V20260910_01__database_generated_ids_preflight.sql`：只读检查九张表、主键形态、非正 ID、前置比赛字段和孤儿引用。
- `wxcloudrun-springboot/src/main/resources/db/migration/V20260910_01__database_generated_ids.sql`：幂等地将六张剩余目录表主键改为 `AUTO_INCREMENT`，保存并恢复 `FOREIGN_KEY_CHECKS`，保留既有 ID 和外键值。

### 10.3 严格部署顺序

1. 停止写入，确认目标数据库为 `speed_skating`，完成并验证全量备份。
2. 执行 `V20260907_01__race_identity_live_queries_preflight.sql`。
3. 执行 `V20260907_01__race_identity_live_queries.sql`，修复缺失的 `ClientRaceKey` 等字段，并完成比赛侧三个自增主键。
4. 检查 `RaceInfoTable`、`AthleteRaceJoinTable`、`ScoreTable` 的最终结构。
5. 执行 `V20260910_01__database_generated_ids_preflight.sql`，所有异常计数必须为零。
6. 执行 `V20260910_01__database_generated_ids.sql`。
7. 检查九张表的 `SHOW CREATE TABLE`，确认主键原名不变且全部包含 `AUTO_INCREMENT`。
8. 部署本轮后端；确认新增接口省略 ID 且响应返回正 ID 后，再部署匹配的新小程序。

### 10.4 验证与边界

- 使用本机 JDK 8 执行 `mvn '-Dmaven.test.skip=true' package`，生产源码编译和 Spring Boot JAR 打包成功，退出码 0。
- 按部署优先策略未编译或运行测试。自动化测试、一次性数据库迁移演练以及端到端部署验证均留待后续执行，不宣称通过。
- 本轮未执行任何数据库语句，未读取凭据，未修改 Git `safe.directory`，未提交或推送。