# 数据库设计文档

> 本文档冻结 `wxcloudrun-springboot` 比赛存储改造的目标数据库结构。新库初始化脚本见 `wxcloudrun-springboot/src/main/resources/db.sql`，存量库必须使用第 7 节列出的预检与迁移文件。

## 1. 总览

数据库名：`speed_skating`

本数据库用于速滑计时系统后端服务，核心对象包括俱乐部、教练、运动员、运动员分组、家长、比赛、参赛关系和成绩。

| 序号 | 表名 | 说明 |
| --- | --- | --- |
| 1 | `ClubTable` | 俱乐部信息 |
| 2 | `CoachTable` | 教练信息 |
| 3 | `AthleteTable` | 运动员信息 |
| 4 | `AthleteGroupTable` | 运动员分组信息 |
| 5 | `AthleteGroupFormTable` | 运动员与运动员组的关系 |
| 6 | `ParentTable` | 家长信息及其关联运动员 |
| 7 | `RaceInfoTable` | 比赛信息 |
| 8 | `AthleteRaceJoinTable` | 比赛与运动员的参与关系 |
| 9 | `ScoreTable` | 比赛成绩信息 |

## 2. 通用约定

- 所有业务表均有 `Enabled` 字段，用于软删除或禁用数据。
- `AthleteID` 使用 `int auto_increment`，是普通数据库主键，与 EPC 或固件编号无关。
- `AthleteEPC` 使用 `bigint unsigned`，用于保存 8 位 hex 转换后的无符号整数。
- `SingleLapTime`、`TotalTime` 单位为百分秒。
- 九张业务表的主键全部使用 `auto_increment`；新增请求省略主键，数据库生成后由后端返回，存量正整数 ID 保持有效。
- 新比赛用 `ClientRaceKey` 作为客户端稳定幂等键，新成绩用 `ClientScoreKey` 和 `EventSequence` 作为客户端稳定身份。
- `ClientRaceKey` 与 `ClientScoreKey` 最长 64 字符；新请求必须提供，获得成功响应前本地可暂未拥有数据库 ID。
- `EventSequence` 在同一场比赛内从 `1` 开始递增，表示成绩事件顺序，不能用 `LapCount` 替代。
- `IsFinished` 新比赛默认为 `false`，只允许在完整比赛包成功保存后改为 `true`；已结束比赛只允许内容完全一致的幂等重传。

## 3. 唯一约束

| 表 | 字段 | 说明 |
| --- | --- | --- |
| `ClubTable` | `ClubName` | 俱乐部名称唯一 |
| `CoachTable` | `OpenID` | 教练微信 OpenID 唯一 |
| `ParentTable` | `OpenID` | 家长微信 OpenID 唯一 |
| `AthleteTable` | `AthleteEPC` | 运动员 EPC 唯一 |
| `RaceInfoTable` | `ClubID, ClientRaceKey` | 客户端比赛键在同一俱乐部内唯一 |
| `ScoreTable` | `RaceID, ClientScoreKey` | 客户端成绩键在同一比赛内唯一 |
| `ScoreTable` | `RaceID, EventSequence` | 成绩事件序号在同一比赛内唯一 |
| `AthleteRaceJoinTable` | `RaceID, AthleteID` | 同一运动员在同一比赛中只有一条参赛关系 |

数据库生成的主键负责持久身份，客户端稳定键负责网络超时和重试场景下的幂等查找。任何冲突数据必须在迁移前人工处理，迁移脚本不会自动删除或合并记录。

## 4. 表结构

### 4.1 `ClubTable` - 俱乐部表

| 字段名 | 类型 | 约束 | 描述 |
| --- | --- | --- | --- |
| `ClubID` | `int` | 主键、自增 | 俱乐部 ID，由数据库生成 |
| `ClubName` | `varchar(20)` | 唯一 | 俱乐部名称 |
| `Enabled` | `boolean` | 默认 `true` | 是否启用 |

### 4.2 `CoachTable` - 教练表

| 字段名 | 类型 | 约束 | 描述 |
| --- | --- | --- | --- |
| `CoachID` | `int` | 主键、自增 | 教练 ID，由数据库生成 |
| `ClubID` | `int` | 外键 | 俱乐部 ID，关联 `ClubTable.ClubID` |
| `OpenID` | `varchar(64)` | 唯一 | 教练微信 OpenID |
| `Enabled` | `boolean` | 默认 `true` | 是否启用 |

### 4.3 `AthleteTable` - 运动员表

| 字段名 | 类型 | 约束 | 描述 |
| --- | --- | --- | --- |
| `AthleteID` | `int` | 主键、自增 | 运动员 ID，由数据库生成，与 EPC、固件编号无关 |
| `ClubID` | `int` | 外键 | 俱乐部 ID，关联 `ClubTable.ClubID` |
| `AthleteName` | `varchar(10)` |  | 运动员姓名 |
| `AthleteEPC` | `bigint unsigned` | 唯一 | 运动员 EPC，8 位 hex 转无符号整数 |
| `Enabled` | `boolean` | 默认 `true` | 是否启用 |

### 4.4 `AthleteGroupTable` - 运动员组表

| 字段名 | 类型 | 约束 | 描述 |
| --- | --- | --- | --- |
| `AthleteGroupID` | `int` | 主键、自增 | 运动员组 ID，由数据库生成 |
| `ClubID` | `int` | 外键 | 俱乐部 ID，关联 `ClubTable.ClubID` |
| `AthleteGroupName` | `varchar(10)` |  | 运动员组名 |
| `Enabled` | `boolean` | 默认 `true` | 是否启用 |

### 4.5 `AthleteGroupFormTable` - 运动员组关系表

| 字段名 | 类型 | 约束 | 描述 |
| --- | --- | --- | --- |
| `AthleteGroupFormID` | `bigint` | 主键、自增 | 运动员组关系 ID，由数据库生成 |
| `AthleteGroupID` | `int` | 外键 | 运动员组 ID，关联 `AthleteGroupTable.AthleteGroupID` |
| `AthleteID` | `int` | 外键 | 运动员 ID，关联 `AthleteTable.AthleteID` |
| `Enabled` | `boolean` | 默认 `true` | 是否启用 |

### 4.6 `ParentTable` - 家长表

| 字段名 | 类型 | 约束 | 描述 |
| --- | --- | --- | --- |
| `ParentID` | `int` | 主键、自增 | 家长 ID，由数据库生成 |
| `ClubID` | `int` | 外键 | 俱乐部 ID，关联 `ClubTable.ClubID` |
| `OpenID` | `varchar(64)` | 唯一 | 家长微信 OpenID |
| `AthleteID` | `int` | 外键 | 运动员 ID，关联 `AthleteTable.AthleteID` |
| `Enabled` | `boolean` | 默认 `true` | 是否启用 |

### 4.7 `RaceInfoTable` - 比赛信息表

| 字段名 | 类型 | 约束 | 描述 |
| --- | --- | --- | --- |
| `RaceID` | `bigint` | 主键、自增 | 比赛 ID，由数据库生成并由后端返回 |
| `ClientRaceKey` | `varchar(64)` | 非空；同一 `ClubID` 内唯一 | 客户端比赛幂等键 |
| `RaceDate` | `datetime` |  | 比赛日期 |
| `ClubID` | `int` | 外键 | 俱乐部 ID，关联 `ClubTable.ClubID` |
| `IsFinished` | `boolean` | 非空；默认 `false` | 比赛是否已结束 |
| `Enabled` | `boolean` | 默认 `true` | 是否启用 |

索引：

- 唯一键 `uk_race_club_client_key (ClubID, ClientRaceKey)`。
- 查询索引 `idx_race_live_history (ClubID, IsFinished, Enabled, RaceDate, RaceID)`，支持活动比赛与稳定历史排序。

### 4.8 `AthleteRaceJoinTable` - 比赛运动员参与关系表

| 字段名 | 类型 | 约束 | 描述 |
| --- | --- | --- | --- |
| `id` | `bigint` | 主键、自增 | 比赛运动员参与关系 ID，由数据库生成 |
| `RaceID` | `bigint` | 外键 | 比赛 ID，关联 `RaceInfoTable.RaceID` |
| `AthleteID` | `int` | 外键 | 运动员 ID，关联 `AthleteTable.AthleteID` |
| `Enabled` | `boolean` | 默认 `true` | 是否启用 |

唯一键 `uk_race_athlete (RaceID, AthleteID)` 防止完整比赛包重传时重复创建参赛关系。

### 4.9 `ScoreTable` - 成绩表

| 字段名 | 类型 | 约束 | 描述 |
| --- | --- | --- | --- |
| `ScoreID` | `bigint` | 主键、自增 | 成绩 ID，由数据库生成 |
| `RaceID` | `bigint` | 外键 | 比赛 ID，关联 `RaceInfoTable.RaceID` |
| `AthleteID` | `int` | 外键 | 运动员 ID，关联 `AthleteTable.AthleteID` |
| `ClientScoreKey` | `varchar(64)` | 非空；同一 `RaceID` 内唯一 | 客户端成绩幂等键 |
| `EventSequence` | `int` | 非空；同一 `RaceID` 内唯一 | 同一比赛内从 1 开始递增的事件序号 |
| `LapCount` | `int` |  | 有效圈数 |
| `SingleLapTime` | `int` |  | 单圈用时，单位百分秒 |
| `TotalTime` | `int` |  | 总用时，单位百分秒 |
| `Rank` | `int` |  | 当前圈排名 |
| `Enabled` | `boolean` | 默认 `true` | 是否启用 |

索引：

- 唯一键 `uk_score_race_client_key (RaceID, ClientScoreKey)`。
- 唯一键 `uk_score_race_sequence (RaceID, EventSequence)`。
- 查询索引 `idx_score_latest (RaceID, AthleteID, Enabled, EventSequence, ScoreID)`，支持按运动员查询最大有效事件序号。

## 5. 表关系

| 来源表 | 来源字段 | 目标表 | 目标字段 | 关系 |
| --- | --- | --- | --- | --- |
| `CoachTable` | `ClubID` | `ClubTable` | `ClubID` | 多个教练属于一个俱乐部 |
| `AthleteTable` | `ClubID` | `ClubTable` | `ClubID` | 多个运动员属于一个俱乐部 |
| `AthleteGroupTable` | `ClubID` | `ClubTable` | `ClubID` | 多个运动员组属于一个俱乐部 |
| `ParentTable` | `ClubID` | `ClubTable` | `ClubID` | 多个家长属于一个俱乐部 |
| `RaceInfoTable` | `ClubID` | `ClubTable` | `ClubID` | 多个比赛属于一个俱乐部 |
| `AthleteGroupFormTable` | `AthleteGroupID` | `AthleteGroupTable` | `AthleteGroupID` | 一个组包含多个运动员 |
| `AthleteGroupFormTable` | `AthleteID` | `AthleteTable` | `AthleteID` | 一个运动员可加入多个组 |
| `ParentTable` | `AthleteID` | `AthleteTable` | `AthleteID` | 家长关联运动员 |
| `AthleteRaceJoinTable` | `RaceID` | `RaceInfoTable` | `RaceID` | 一场比赛有多个参赛运动员 |
| `AthleteRaceJoinTable` | `AthleteID` | `AthleteTable` | `AthleteID` | 一个运动员可参加多场比赛 |
| `ScoreTable` | `RaceID` | `RaceInfoTable` | `RaceID` | 成绩归属比赛 |
| `ScoreTable` | `AthleteID` | `AthleteTable` | `AthleteID` | 成绩归属运动员 |

## 6. 新库最终结构摘要

`db.sql` 中与比赛存储有关的最终列和索引如下：

```sql
`RaceID` BIGINT NOT NULL AUTO_INCREMENT,
`ClientRaceKey` VARCHAR(64) NOT NULL,
`IsFinished` BOOLEAN NOT NULL DEFAULT FALSE,
UNIQUE KEY `uk_race_club_client_key` (`ClubID`, `ClientRaceKey`),
KEY `idx_race_live_history` (`ClubID`, `IsFinished`, `Enabled`, `RaceDate`, `RaceID`)

`ScoreID` BIGINT NOT NULL AUTO_INCREMENT,
`ClientScoreKey` VARCHAR(64) NOT NULL,
`EventSequence` INT NOT NULL,
UNIQUE KEY `uk_score_race_client_key` (`RaceID`, `ClientScoreKey`),
UNIQUE KEY `uk_score_race_sequence` (`RaceID`, `EventSequence`),
KEY `idx_score_latest` (`RaceID`, `AthleteID`, `Enabled`, `EventSequence`, `ScoreID`)

`id` BIGINT NOT NULL AUTO_INCREMENT,
UNIQUE KEY `uk_race_athlete` (`RaceID`, `AthleteID`)
```

## 7. 存量数据库升级

升级文件：

- 只读预检：`wxcloudrun-springboot/src/main/resources/db/migration/V20260907_01__race_identity_live_queries_preflight.sql`
- 正式迁移：`wxcloudrun-springboot/src/main/resources/db/migration/V20260907_01__race_identity_live_queries.sql`
- 数据库生成 ID 只读预检：`wxcloudrun-springboot/src/main/resources/db/migration/V20260910_01__database_generated_ids_preflight.sql`
- 数据库生成 ID 正式迁移：`wxcloudrun-springboot/src/main/resources/db/migration/V20260910_01__database_generated_ids.sql`

执行顺序：

1. 对 `speed_skating` 做完整结构与数据备份，并确认可恢复。
2. 在目标实例先执行只读预检，确认重复、空值、非正 ID 和孤儿引用检查均无异常行；同时核对目标列和索引的当前状态。
3. 在维护窗口执行正式迁移。迁移先增加可空客户端键和结束状态，存量比赛统一回填为已结束，再回填 `legacy:{ID}` 键和按 `ScoreID` 排序的 `EventSequence`。
4. 脚本在发现重复参赛关系、幂等键冲突、事件序号冲突、空身份字段或孤儿引用时使用 `SIGNAL SQLSTATE '45000'` 中止，不会自动删除或合并数据。
5. 迁移成功后检查三张表的 `SHOW CREATE TABLE` 输出，确认列、`AUTO_INCREMENT`、唯一键和查询索引与本文件第 6 节一致。
6. 再次执行正式迁移应无结构和数据变化，用于确认脚本幂等。
### 数据库生成 ID 迁移顺序

1. 生产日志 `Unknown column 'ClientRaceKey'` 说明目标库尚未完成比赛身份迁移；必须先按上述步骤完整执行 `V20260907_01__race_identity_live_queries.sql`。
2. 执行 `V20260910_01__database_generated_ids_preflight.sql`，确认九张表、主键形态、正 ID 和外键引用均正常。
3. 在维护窗口执行 `V20260910_01__database_generated_ids.sql`，将其余六张表的主键改为 `AUTO_INCREMENT`，保留既有 ID 和外键值。
4. 检查九张表的 `SHOW CREATE TABLE`，确认原主键列名不变且全部包含 `AUTO_INCREMENT`。
5. 完成数据库迁移后部署后端，再部署省略新增主键的小程序版本。

正式迁移未在共享或生产数据库上自动执行。迁移中的 `ALTER TABLE` 和数据回填可能已经在报错前部分提交，不能依赖事务整体回滚；如需回退，应停止写入并从执行前备份恢复。直接删除新列会丢失客户端幂等身份，直接移除 `AUTO_INCREMENT` 或唯一键也可能使新版本后端无法安全工作，因此不提供自动降级脚本。
