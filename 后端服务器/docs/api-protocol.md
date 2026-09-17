# 后端接口协议文档

> 本文档冻结 `wxcloudrun-springboot` 比赛存储改造的目标协议，用于前端、小程序和后端共同实现。尚未完成的接口应以本文档作为后续任务验收合同。

## 1. 基础信息

- 服务器地址：`https://springboot-z3m5-307081-12-1465315659.sh.run.tcloudbase.com`
- 数据库名：`speed_skating`
- 数据格式：`application/json`
- 字符编码：`UTF-8`
- 业务接口前缀：`/api/v1`

完整接口地址格式：

```text
https://springboot-z3m5-307081-12-1465315659.sh.run.tcloudbase.com/api/v1/{resource}
```

## 2. 通用约定

### 2.1 请求头

```http
Content-Type: application/json
Accept: application/json
```

当前业务接口暂未接入登录鉴权。如后续增加登录鉴权，再补充 `Authorization`、登录、刷新 Token 等协议。

### 2.2 通用响应格式

成功响应：

```json
{
  "code": 0,
  "message": "success",
  "errorMsg": "",
  "data": {}
}
```

失败响应：

```json
{
  "code": 400,
  "message": "参数错误",
  "errorMsg": "参数错误",
  "data": null
}
```

### 2.3 状态码

| code | 说明 |
| --- | --- |
| `0` | 成功 |
| `400` | 请求参数错误或数据不符合要求 |
| `404` | 数据不存在 |
| `409` | 幂等键、资源归属或已结束比赛发生冲突 |
| `500` | 服务器内部错误 |

### 2.4 分页与软删除

所有业务表均包含 `Enabled` 字段，当前后端删除接口采用软删除：

- `DELETE` 接口不会物理删除数据，只会把对应记录的 `Enabled` 更新为 `false`。
- 列表查询默认只返回 `Enabled = true` 的数据。
- 如需包含禁用数据，列表接口传入 `includeDisabled=true`。
- 新增数据时，如果请求体没有传 `Enabled`，后端默认按 `true` 保存。

列表接口通用参数：

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `page` | `int` | 否 | 页码，默认 `1` |
| `pageSize` | `int` | 否 | 每页数量，默认 `20`，最大 `200` |
| `includeDisabled` | `boolean` | 否 | 是否包含禁用数据，默认 `false` |

列表响应 `data` 格式：

```json
{
  "list": [],
  "page": 1,
  "pageSize": 20,
  "total": 0
}
```

### 2.5 生成 ID 与幂等键

- 新建任何业务资源时，请求必须省略该资源的主键字段，不得发送正整数、`-1` 或 `null`；数据库生成主键后由成功响应返回。
- `RaceID = -1` 只允许作为小程序本地“尚未绑定后端”的显示值，任何后端请求都不得携带该值。
- 成功响应返回服务器规范化后的完整对象，并包含对应数据库生成的正整数主键。
- 新比赛使用 `ClubID + ClientRaceKey` 保证重试幂等；新成绩使用 `RaceID + ClientScoreKey` 保证重试幂等。
- 相同幂等键和相同内容的重试返回原记录；相同幂等键但不可变身份或内容冲突时返回业务码 `409`。
| 新增资源 | 请求必须省略 | 成功响应 `data` 必须包含 |
| --- | --- | --- |
| 俱乐部 | `ClubID` | 正整数 `ClubID` |
| 教练 | `CoachID` | 正整数 `CoachID` |
| 运动员 | `AthleteID` | 正整数 `AthleteID` |
| 运动员组 | `AthleteGroupID` | 正整数 `AthleteGroupID` |
| 运动员组关系 | `AthleteGroupFormID` | 正整数 `AthleteGroupFormID` |
| 家长 | `ParentID` | 正整数 `ParentID` |
| 比赛 | `RaceID` | 正整数 `RaceID` |
| 参赛关系 | `id` | 正整数 `id` |
| 成绩 | `ScoreID` | 正整数 `ScoreID` |

### 2.6 通用 CRUD 路径

每个业务资源均提供以下接口：

| 操作 | 方法 | 路径 | 说明 |
| --- | --- | --- | --- |
| 新增 | `POST` | `/api/v1/{resource}` | 新增一条数据 |
| 查询列表 | `GET` | `/api/v1/{resource}` | 分页查询数据列表 |
| 查询详情 | `GET` | `/api/v1/{resource}/{id}` | 按主键查询单条数据 |
| 修改 | `PUT` | `/api/v1/{resource}/{id}` | 按主键修改数据 |
| 删除 | `DELETE` | `/api/v1/{resource}/{id}` | 按主键软删除数据 |

## 3. 数据唯一性约束

当前数据库要求以下字段唯一：

| 表 | 字段 | 说明 |
| --- | --- | --- |
| `ClubTable` | `ClubName` | 俱乐部名称不可重复 |
| `ParentTable` | `OpenID` | 家长微信 OpenID 不可重复 |
| `CoachTable` | `OpenID` | 教练微信 OpenID 不可重复 |
| `AthleteTable` | `AthleteEPC` | 运动员 EPC 不可重复 |

`RaceInfoTable` 以 `RaceID` 为主键，并以 `ClubID + ClientRaceKey` 作为客户端重试身份；`ScoreTable` 以 `RaceID + ClientScoreKey` 和 `RaceID + EventSequence` 保证同一场比赛内成绩身份唯一；`AthleteRaceJoinTable` 以 `RaceID + AthleteID` 防止重复参赛关系。

如果新增或修改时违反唯一约束，数据库会拒绝写入，接口会返回失败响应。

## 4. 业务接口

### 4.1 俱乐部 `ClubTable`

资源路径：`/api/v1/clubs`

主键：`ClubID`

字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `ClubID` | `int` | 俱乐部 ID，由数据库生成 |
| `ClubName` | `string` | 俱乐部名称，唯一 |
| `Enabled` | `boolean` | 是否启用 |

列表查询参数：

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `ClubID` | `int` | 按俱乐部 ID 查询 |
| `ClubName` | `string` | 按俱乐部名称模糊查询 |
| `Enabled` | `boolean` | 按启用状态查询 |
| `page` | `int` | 页码 |
| `pageSize` | `int` | 每页数量 |
| `includeDisabled` | `boolean` | 是否包含禁用数据 |

接口：

| 操作 | 方法 | 路径 |
| --- | --- | --- |
| 新增俱乐部 | `POST` | `/api/v1/clubs` |
| 查询俱乐部列表 | `GET` | `/api/v1/clubs` |
| 查询俱乐部详情 | `GET` | `/api/v1/clubs/{ClubID}` |
| 修改俱乐部 | `PUT` | `/api/v1/clubs/{ClubID}` |
| 删除俱乐部 | `DELETE` | `/api/v1/clubs/{ClubID}` |

请求体示例：

```json
{
  "ClubName": "示例俱乐部",
  "Enabled": true
}
```

### 4.2 教练 `CoachTable`

资源路径：`/api/v1/coaches`

主键：`CoachID`

字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `CoachID` | `int` | 教练 ID，由数据库生成 |
| `ClubID` | `int` | 已有俱乐部 ID，新增当前资源时必须提供 |
| `OpenID` | `string` | 教练微信 OpenID，唯一 |
| `Enabled` | `boolean` | 是否启用 |

列表查询参数：

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `CoachID` | `int` | 按教练 ID 查询 |
| `ClubID` | `int` | 按俱乐部筛选 |
| `OpenID` | `string` | 按微信 OpenID 筛选 |
| `Enabled` | `boolean` | 按启用状态查询 |
| `page` | `int` | 页码 |
| `pageSize` | `int` | 每页数量 |
| `includeDisabled` | `boolean` | 是否包含禁用数据 |

接口：

| 操作 | 方法 | 路径 |
| --- | --- | --- |
| 新增教练 | `POST` | `/api/v1/coaches` |
| 查询教练列表 | `GET` | `/api/v1/coaches` |
| 查询教练详情 | `GET` | `/api/v1/coaches/{CoachID}` |
| 修改教练 | `PUT` | `/api/v1/coaches/{CoachID}` |
| 删除教练 | `DELETE` | `/api/v1/coaches/{CoachID}` |

请求体示例：

```json
{
  "ClubID": 1,
  "OpenID": "coach_openid",
  "Enabled": true
}
```

### 4.3 运动员 `AthleteTable`

资源路径：`/api/v1/athletes`

主键：`AthleteID`

字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `AthleteID` | `int` | 运动员 ID，由数据库生成；与 EPC、固件编号无关 |
| `ClubID` | `int` | 已有俱乐部 ID，新增当前资源时必须提供 |
| `AthleteName` | `string` | 运动员姓名 |
| `AthleteEPC` | `long` | 运动员 EPC，8 位 hex 转无符号整数，唯一 |
| `Enabled` | `boolean` | 是否启用 |

列表查询参数：

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `ClubID` | `int` | 按俱乐部筛选 |
| `AthleteName` | `string` | 按姓名模糊查询 |
| `AthleteEPC` | `long` | 按 EPC 查询 |
| `page` | `int` | 页码 |
| `pageSize` | `int` | 每页数量 |
| `includeDisabled` | `boolean` | 是否包含禁用数据 |

接口：

| 操作 | 方法 | 路径 |
| --- | --- | --- |
| 新增运动员 | `POST` | `/api/v1/athletes` |
| 查询运动员列表 | `GET` | `/api/v1/athletes` |
| 查询运动员详情 | `GET` | `/api/v1/athletes/{AthleteID}` |
| 修改运动员 | `PUT` | `/api/v1/athletes/{AthleteID}` |
| 删除运动员 | `DELETE` | `/api/v1/athletes/{AthleteID}` |

请求体示例：

```json
{
  "ClubID": 1,
  "AthleteName": "张三",
  "AthleteEPC": 10001,
  "Enabled": true
}
```

### 4.4 运动员分组 `AthleteGroupTable`

资源路径：`/api/v1/athlete-groups`

主键：`AthleteGroupID`

字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `AthleteGroupID` | `int` | 运动员组 ID，由数据库生成 |
| `ClubID` | `int` | 已有俱乐部 ID，新增当前资源时必须提供 |
| `AthleteGroupName` | `string` | 运动员组名 |
| `Enabled` | `boolean` | 是否启用 |

列表查询参数：

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `ClubID` | `int` | 按俱乐部筛选 |
| `AthleteGroupName` | `string` | 按分组名称模糊查询 |
| `page` | `int` | 页码 |
| `pageSize` | `int` | 每页数量 |
| `includeDisabled` | `boolean` | 是否包含禁用数据 |

接口：

| 操作 | 方法 | 路径 |
| --- | --- | --- |
| 新增运动员组 | `POST` | `/api/v1/athlete-groups` |
| 查询运动员组列表 | `GET` | `/api/v1/athlete-groups` |
| 查询运动员组详情 | `GET` | `/api/v1/athlete-groups/{AthleteGroupID}` |
| 修改运动员组 | `PUT` | `/api/v1/athlete-groups/{AthleteGroupID}` |
| 删除运动员组 | `DELETE` | `/api/v1/athlete-groups/{AthleteGroupID}` |

请求体示例：

```json
{
  "ClubID": 1,
  "AthleteGroupName": "一队",
  "Enabled": true
}
```

### 4.5 运动员分组关系 `AthleteGroupFormTable`

资源路径：`/api/v1/athlete-group-forms`

主键：`AthleteGroupFormID`

字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `AthleteGroupFormID` | `long` | 运动员组关系 ID，由数据库生成 |
| `AthleteGroupID` | `int` | 已有运动员组 ID，新增关系时必须提供 |
| `AthleteID` | `int` | 已有运动员 ID，新增当前资源时必须提供 |
| `Enabled` | `boolean` | 是否启用 |

列表查询参数：

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `AthleteGroupID` | `int` | 按运动员组筛选 |
| `AthleteID` | `int` | 按运动员筛选 |
| `page` | `int` | 页码 |
| `pageSize` | `int` | 每页数量 |
| `includeDisabled` | `boolean` | 是否包含禁用数据 |

接口：

| 操作 | 方法 | 路径 |
| --- | --- | --- |
| 新增分组关系 | `POST` | `/api/v1/athlete-group-forms` |
| 查询分组关系列表 | `GET` | `/api/v1/athlete-group-forms` |
| 查询分组关系详情 | `GET` | `/api/v1/athlete-group-forms/{AthleteGroupFormID}` |
| 修改分组关系 | `PUT` | `/api/v1/athlete-group-forms/{AthleteGroupFormID}` |
| 删除分组关系 | `DELETE` | `/api/v1/athlete-group-forms/{AthleteGroupFormID}` |

请求体示例：

```json
{
  "AthleteGroupID": 1,
  "AthleteID": 1,
  "Enabled": true
}
```

### 4.6 家长 `ParentTable`

资源路径：`/api/v1/parents`

主键：`ParentID`

字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `ParentID` | `int` | 家长 ID，由数据库生成 |
| `ClubID` | `int` | 已有俱乐部 ID，新增当前资源时必须提供 |
| `OpenID` | `string` | 家长微信 OpenID，唯一 |
| `AthleteID` | `int` | 已有运动员 ID，新增当前资源时必须提供 |
| `Enabled` | `boolean` | 是否启用 |

列表查询参数：

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `ClubID` | `int` | 按俱乐部筛选 |
| `OpenID` | `string` | 按微信 OpenID 筛选 |
| `AthleteID` | `int` | 按运动员筛选 |
| `page` | `int` | 页码 |
| `pageSize` | `int` | 每页数量 |
| `includeDisabled` | `boolean` | 是否包含禁用数据 |

接口：

| 操作 | 方法 | 路径 |
| --- | --- | --- |
| 新增家长 | `POST` | `/api/v1/parents` |
| 查询家长列表 | `GET` | `/api/v1/parents` |
| 查询家长详情 | `GET` | `/api/v1/parents/{ParentID}` |
| 修改家长 | `PUT` | `/api/v1/parents/{ParentID}` |
| 删除家长 | `DELETE` | `/api/v1/parents/{ParentID}` |

请求体示例：

```json
{
  "ClubID": 1,
  "OpenID": "parent_openid",
  "AthleteID": 1,
  "Enabled": true
}
```

### 4.7 比赛信息 `RaceInfoTable`

资源路径：`/api/v1/races`

主键：`RaceID`

字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `RaceID` | `long` | 比赛 ID；新增请求省略，由数据库生成并在成功响应中返回 |
| `ClientRaceKey` | `string` | 客户端比赛幂等键，最长 64 字符，同一俱乐部内唯一 |
| `RaceDate` | `string` | 比赛日期，格式 `yyyy-MM-dd HH:mm:ss` |
| `ClubID` | `int` | 已有俱乐部 ID，新增当前资源时必须提供 |
| `IsFinished` | `boolean` | 是否已结束；新建时为 `false`，只能由完整比赛包最终置为 `true` |
| `Enabled` | `boolean` | 是否启用 |

列表查询参数：

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `ClubID` | `int` | 按俱乐部筛选 |
| `startDate` | `string` | 开始日期，格式 `yyyy-MM-dd HH:mm:ss` |
| `endDate` | `string` | 结束日期，格式 `yyyy-MM-dd HH:mm:ss` |
| `page` | `int` | 页码 |
| `pageSize` | `int` | 每页数量 |
| `includeDisabled` | `boolean` | 是否包含禁用数据 |
| `sortBy` | `string` | 仅允许 `RaceDate` 或 `RaceID`，默认 `RaceDate` |
| `sortOrder` | `string` | 仅允许 `asc` 或 `desc`，默认 `desc` |

接口：

| 操作 | 方法 | 路径 |
| --- | --- | --- |
| 新增比赛 | `POST` | `/api/v1/races` |
| 查询比赛列表 | `GET` | `/api/v1/races` |
| 查询比赛详情 | `GET` | `/api/v1/races/{RaceID}` |
| 修改比赛 | `PUT` | `/api/v1/races/{RaceID}` |
| 删除比赛 | `DELETE` | `/api/v1/races/{RaceID}` |

请求体示例：

```json
{
  "ClientRaceKey": "wx-race-20260907-0001",
  "RaceDate": "2026-09-07 10:00:00",
  "ClubID": 1,
  "IsFinished": false,
  "Enabled": true
}
```

成功响应示例：

```json
{
  "code": 0,
  "message": "success",
  "errorMsg": "",
  "data": {
    "RaceID": 1001,
    "ClientRaceKey": "wx-race-20260907-0001",
    "RaceDate": "2026-09-07 10:00:00",
    "ClubID": 1,
    "IsFinished": false,
    "Enabled": true
  }
}
```

`POST /api/v1/races` 必须省略 `RaceID`，不能发送 `-1` 或 `null`。相同 `ClubID + ClientRaceKey` 且内容相同的重试返回同一 `RaceID`；不可变字段冲突返回业务码 `409`。通用 `PUT /api/v1/races/{RaceID}` 不得把比赛置为结束，`IsFinished=true` 只由 `POST /api/v1/race-bundles` 在全部子记录保存成功后提交。

### 4.8 比赛运动员参与关系 `AthleteRaceJoinTable`

资源路径：`/api/v1/athlete-race-joins`

主键：`id`

字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `long` | 比赛运动员参与关系 ID；新增请求省略，由数据库生成 |
| `RaceID` | `long` | 比赛 ID |
| `AthleteID` | `int` | 已有运动员 ID，新增当前资源时必须提供 |
| `Enabled` | `boolean` | 是否启用 |

列表查询参数：

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `RaceID` | `long` | 按比赛筛选 |
| `AthleteID` | `int` | 按运动员筛选 |
| `page` | `int` | 页码 |
| `pageSize` | `int` | 每页数量 |
| `includeDisabled` | `boolean` | 是否包含禁用数据 |

接口：

| 操作 | 方法 | 路径 |
| --- | --- | --- |
| 新增参赛关系 | `POST` | `/api/v1/athlete-race-joins` |
| 查询参赛关系列表 | `GET` | `/api/v1/athlete-race-joins` |
| 查询参赛关系详情 | `GET` | `/api/v1/athlete-race-joins/{id}` |
| 修改参赛关系 | `PUT` | `/api/v1/athlete-race-joins/{id}` |
| 删除参赛关系 | `DELETE` | `/api/v1/athlete-race-joins/{id}` |

请求体示例：

```json
{
  "RaceID": 1,
  "AthleteID": 1,
  "Enabled": true
}
```

新增参赛关系时省略 `id`，成功响应包含数据库生成的正整数 `id`。同一 `RaceID + AthleteID` 只保留一条关系，重复且内容一致的保存返回原记录。

### 4.9 成绩 `ScoreTable`

资源路径：`/api/v1/scores`

主键：`ScoreID`

字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `ScoreID` | `long` | 成绩 ID；新增请求省略，由数据库生成 |
| `RaceID` | `long` | 比赛 ID |
| `AthleteID` | `int` | 已有运动员 ID，新增当前资源时必须提供 |
| `ClientScoreKey` | `string` | 客户端成绩幂等键，最长 64 字符，同一比赛内唯一 |
| `EventSequence` | `int` | 同一比赛内从 `1` 开始递增的稳定事件序号 |
| `LapCount` | `int` | 圈数 |
| `SingleLapTime` | `int` | 单圈用时，单位百分秒 |
| `TotalTime` | `int` | 总用时，单位百分秒 |
| `Rank` | `int` | 当前圈排名 |
| `Enabled` | `boolean` | 是否启用 |

列表查询参数：

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `RaceID` | `long` | 按比赛筛选 |
| `AthleteID` | `int` | 按运动员筛选 |
| `LapCount` | `int` | 按圈数筛选 |
| `page` | `int` | 页码 |
| `pageSize` | `int` | 每页数量 |
| `includeDisabled` | `boolean` | 是否包含禁用数据 |

接口：

| 操作 | 方法 | 路径 |
| --- | --- | --- |
| 新增成绩 | `POST` | `/api/v1/scores` |
| 查询成绩列表 | `GET` | `/api/v1/scores` |
| 查询成绩详情 | `GET` | `/api/v1/scores/{ScoreID}` |
| 修改成绩 | `PUT` | `/api/v1/scores/{ScoreID}` |
| 删除成绩 | `DELETE` | `/api/v1/scores/{ScoreID}` |

请求体示例：

```json
{
  "RaceID": 1001,
  "AthleteID": 7,
  "ClientScoreKey": "wx-score-20260907-0001",
  "EventSequence": 1,
  "LapCount": 1,
  "SingleLapTime": 4523,
  "TotalTime": 4523,
  "Rank": 1,
  "Enabled": true
}
```

成功响应示例：

```json
{
  "code": 0,
  "message": "success",
  "errorMsg": "",
  "data": {
    "ScoreID": 3001,
    "RaceID": 1001,
    "AthleteID": 7,
    "ClientScoreKey": "wx-score-20260907-0001",
    "EventSequence": 1,
    "LapCount": 1,
    "SingleLapTime": 4523,
    "TotalTime": 4523,
    "Rank": 1,
    "Enabled": true
  }
}
```

`POST /api/v1/scores` 必须省略 `ScoreID`，不能发送 `-1` 或 `null`。相同 `RaceID + ClientScoreKey` 且内容相同的重试返回同一 `ScoreID`；`RaceID + EventSequence` 也必须唯一。比赛结束后禁止新增、修改或删除成绩，仅接受内容完全相同的幂等重放。


## 5. 聚合写入与比赛查询接口

### 5.1 保存完整比赛包

```http
POST /api/v1/race-bundles HTTP/1.1
Host: springboot-z3m5-307081-12-1465315659.sh.run.tcloudbase.com
Content-Type: application/json
```

请求中的 `RaceInfo` 必填，`AthleteRaceJoins` 和 `Scores` 必须为数组。首次创建时省略 `RaceInfo.RaceID`、参赛关系 `id` 和成绩 `ScoreID`；子记录 `RaceID` 也可省略，由后端统一补为比赛包的 `RaceID`。

请求示例：

```json
{
  "RaceInfo": {
    "ClientRaceKey": "wx-race-20260907-0001",
    "RaceDate": "2026-09-07 10:00:00",
    "ClubID": 1,
    "IsFinished": true,
    "Enabled": true
  },
  "AthleteRaceJoins": [
    {
      "AthleteID": 7,
      "Enabled": true
    }
  ],
  "Scores": [
    {
      "AthleteID": 7,
      "ClientScoreKey": "wx-score-20260907-0001",
      "EventSequence": 1,
      "LapCount": 1,
      "SingleLapTime": 4523,
      "TotalTime": 4523,
      "Rank": 1,
      "Enabled": true
    }
  ]
}
```

成功响应返回所有数据库生成并规范化的 ID：

```json
{
  "code": 0,
  "message": "success",
  "errorMsg": "",
  "data": {
    "RaceInfo": {
      "RaceID": 1001,
      "ClientRaceKey": "wx-race-20260907-0001",
      "RaceDate": "2026-09-07 10:00:00",
      "ClubID": 1,
      "IsFinished": true,
      "Enabled": true
    },
    "AthleteRaceJoins": [
      {
        "id": 2001,
        "RaceID": 1001,
        "AthleteID": 7,
        "Enabled": true
      }
    ],
    "Scores": [
      {
        "ScoreID": 3001,
        "RaceID": 1001,
        "AthleteID": 7,
        "ClientScoreKey": "wx-score-20260907-0001",
        "EventSequence": 1,
        "LapCount": 1,
        "SingleLapTime": 4523,
        "TotalTime": 4523,
        "Rank": 1,
        "Enabled": true
      }
    ]
  }
}
```

整个比赛包在单一事务中处理。后端先解析比赛身份，再逐条比较参赛关系和成绩，最后才把 `IsFinished` 从 `false` 更新为 `true`。已结束比赛只接受内容完全一致的幂等重传，任何新增或改写返回业务码 `409`。

### 5.2 旧版按俱乐部全量同步

兼容接口在本次改造期间保留：

```http
GET /api/v1/race-bundles?ClubID=1&includeDisabled=false HTTP/1.1
```

成功响应 `data` 仍包含 `ClubID`、`Athletes`、`AthleteGroups`、`AthleteGroupForms` 和 `RaceBundles`。新客户端启动时不再依赖该接口下载全部比赛历史。

### 5.3 分页查询完整比赛包

```http
GET /api/v1/race-bundles/page?ClubID=1&page=1&pageSize=20&sortBy=RaceDate&sortOrder=desc HTTP/1.1
```

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `ClubID` | `int` | 是 | 俱乐部 ID |
| `page` | `int` | 否 | 默认 `1` |
| `pageSize` | `int` | 否 | 默认 `20`，最大 `200` |
| `sortBy` | `string` | 否 | 只允许 `RaceDate` 或 `RaceID`，默认 `RaceDate` |
| `sortOrder` | `string` | 否 | 只允许 `asc` 或 `desc`，默认 `desc` |

按 `RaceDate` 排序时追加同方向 `RaceID` 作为稳定次序。成功响应示例：

```json
{
  "code": 0,
  "message": "success",
  "errorMsg": "",
  "data": {
    "list": [
      {
        "RaceInfo": {
          "RaceID": 1001,
          "ClientRaceKey": "wx-race-20260907-0001",
          "RaceDate": "2026-09-07 10:00:00",
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
}
```

### 5.4 查询活动比赛

```http
GET /api/v1/races/active?ClubID=1 HTTP/1.1
```

返回该俱乐部全部 `Enabled=true` 且 `IsFinished=false` 的比赛，按 `RaceDate DESC, RaceID DESC` 排序：

```json
{
  "code": 0,
  "message": "success",
  "errorMsg": "",
  "data": {
    "list": [
      {
        "RaceID": 1002,
        "ClientRaceKey": "wx-race-20260907-0002",
        "RaceDate": "2026-09-07 11:00:00",
        "ClubID": 1,
        "IsFinished": false,
        "Enabled": true
      }
    ],
    "total": 1,
    "ServerTime": "2026-09-07 11:05:00"
  }
}
```

### 5.5 查询每名运动员的最新成绩

```http
GET /api/v1/races/1002/latest-scores HTTP/1.1
```

对该比赛中的每名运动员返回 `Enabled=true` 且 `EventSequence` 最大的一条成绩；不得使用 `LapCount` 判断最新事件。比赛存在但尚无成绩时返回空数组，比赛不存在时返回业务码 `404`。

```json
{
  "code": 0,
  "message": "success",
  "errorMsg": "",
  "data": {
    "RaceID": 1002,
    "Scores": [
      {
        "ScoreID": 3012,
        "RaceID": 1002,
        "AthleteID": 7,
        "ClientScoreKey": "wx-score-20260907-0012",
        "EventSequence": 12,
        "LapCount": 6,
        "SingleLapTime": 4310,
        "TotalTime": 26420,
        "Rank": 1,
        "Enabled": true
      }
    ]
  }
}
```

### 5.6 事务化保存运动员分组

新建分组：

```http
POST /api/v1/athlete-group-bundles HTTP/1.1
Content-Type: application/json
```

```json
{
  "AthleteGroup": {
    "ClubID": 1,
    "AthleteGroupName": "一队",
    "Enabled": true
  },
  "AthleteGroupForms": [
    {
      "AthleteID": 7,
      "Enabled": true
    }
  ]
}
```

成功响应返回相同外层结构以及服务器规范化后的分组和完整成员关系：

```json
{
  "code": 0,
  "message": "success",
  "errorMsg": "",
  "data": {
    "AthleteGroup": {
      "AthleteGroupID": 11,
      "ClubID": 1,
      "AthleteGroupName": "一队",
      "Enabled": true
    },
    "AthleteGroupForms": [
      {
        "AthleteGroupFormID": 21,
        "AthleteGroupID": 11,
        "AthleteID": 7,
        "Enabled": true
      }
    ]
  }
}
```

更新分组时以路径 ID 为组身份，请求体中的 `AthleteGroupID` 可省略；如携带则必须与路径相同。请求中的成员数组作为完整成员列表，已有成员可携带数据库 ID，新成员必须省略 `AthleteGroupFormID`：

```http
PUT /api/v1/athlete-group-bundles/11 HTTP/1.1
Content-Type: application/json
```

```json
{
  "AthleteGroup": {
    "AthleteGroupID": 11,
    "ClubID": 1,
    "AthleteGroupName": "一队（更新）",
    "Enabled": true
  },
  "AthleteGroupForms": []
}
```

成功响应返回更新后的完整聚合对象。请求中缺失的原有效成员关系会被软删除，整个操作在一个事务中提交：

```json
{
  "code": 0,
  "message": "success",
  "errorMsg": "",
  "data": {
    "AthleteGroup": {
      "AthleteGroupID": 11,
      "ClubID": 1,
      "AthleteGroupName": "一队（更新）",
      "Enabled": true
    },
    "AthleteGroupForms": []
  }
}
```

删除分组：

```http
DELETE /api/v1/athlete-group-bundles/11 HTTP/1.1
```

```json
{
  "code": 0,
  "message": "success",
  "errorMsg": "",
  "data": {
    "deleted": true,
    "AthleteGroupID": 11
  }
}
```

删除会在同一事务中软删除分组及其有效成员关系。路径/对象身份、俱乐部归属或成员归属冲突返回业务码 `409`。

### 5.7 小程序字段归属与回拉约定

| 字段 | 归属 | 说明 |
| --- | --- | --- |
| `AthleteID` | 后端 | 新增运动员时省略，响应返回数据库生成的正整数；与 EPC、固件编号无关 |
| `AthleteEPC` | 小程序 | `long`，8 位 hex 转无符号整数 |
| `ClientRaceKey` | 小程序 | 每场比赛生成一次并保持不变，最长 64 字符 |
| `RaceID` | 后端 | 新增请求省略，响应返回正整数；本地 `-1` 不得上传 |
| `AthleteRaceJoin.id` | 后端 | 新增请求省略，响应返回正整数 |
| `ClientScoreKey` | 小程序 | 每条成绩生成一次并保持不变，最长 64 字符 |
| `EventSequence` | 小程序 | 同一比赛内从 `1` 开始递增，自动补圈或重算不得改变 |
| `ScoreID` | 后端 | 新增请求省略，响应返回正整数 |
| 子记录 `RaceID` | 可选 | 比赛包新增时可省略；携带时必须与 `RaceInfo.RaceID` 一致 |
| `SingleLapTime` / `TotalTime` | 小程序 | 单位百分秒 |
| `Enabled` | 双方 | 软删除标记，未传默认 `true` |

服务器历史通过 `GET /api/v1/race-bundles/page` 按需读取，运动员姓名和 EPC 通过 `AthleteID` 关联当前运动员目录。协议暂未增加 `FinishedAt` 或姓名/EPC 快照字段；这些内容不属于本次数据库结构变更范围。
## 6. 调用示例

### 6.1 新增运动员

```http
POST /api/v1/athletes HTTP/1.1
Host: springboot-z3m5-307081-12-1465315659.sh.run.tcloudbase.com
Content-Type: application/json
```

```json
{
  "ClubID": 1,
  "AthleteName": "张三",
  "AthleteEPC": 10001,
  "Enabled": true
}
```

### 6.2 查询运动员列表

```http
GET /api/v1/athletes?ClubID=1&AthleteName=张&page=1&pageSize=20 HTTP/1.1
Host: springboot-z3m5-307081-12-1465315659.sh.run.tcloudbase.com
Accept: application/json
```

### 6.3 查询某场比赛成绩

```http
GET /api/v1/scores?RaceID=1&page=1&pageSize=20 HTTP/1.1
Host: springboot-z3m5-307081-12-1465315659.sh.run.tcloudbase.com
Accept: application/json
```

### 6.4 删除一条成绩

```http
DELETE /api/v1/scores/1 HTTP/1.1
Host: springboot-z3m5-307081-12-1465315659.sh.run.tcloudbase.com
Accept: application/json
```

成功响应示例：

```json
{
  "code": 0,
  "message": "success",
  "errorMsg": "",
  "data": {
    "deleted": true
  }
}
```

## 7. 后续待补充

1. 登录鉴权、角色权限、Token 刷新等接口。
2. 与真实云托管 MySQL 联调后的错误响应细节。
