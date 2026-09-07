# 后端比赛存储与实时查询设计

## 目标

将小程序比赛历史从“本地完整保存并在启动时全量双向同步”调整为“后端作为在线比赛、历史比赛、运动员和分组的权威来源”。小程序持久保存运动员与分组缓存、未完成的活动比赛、离线比赛以及尚未确认的后台发送任务。

系统必须同时满足：

- 网络正常时，比赛、每圈成绩和完成状态持续保存到后端；
- 网络不可用时，比赛不中断，按离线比赛保存并在后续启动时上传；
- 历史比赛按时间倒序、每页 20 条从后端查询；
- 可以查看同俱乐部所有未结束比赛，并实时查看每名运动员的最新成绩；
- 运动员和分组以服务器数据为准，本地持久缓存用于离线查看和比赛选人；任何管理操作必须获得后端成功回执后才更新缓存；
- 后台写入、前台查询和蓝牙计时互不阻塞；
- 重试不会重复创建比赛或成绩。

## 核心身份规则

小程序中的每场比赛同时维护三种身份：

```text
localId：小程序生成的本地唯一字符串，始终存在且不可变
ClientRaceKey：小程序生成的跨重试幂等键，始终存在且不可变
RaceID：后端数据库 ID；在线为正整数，离线统一显示为 -1
```

`RaceID = -1` 只用于小程序领域模型和界面表示“尚未绑定后端比赛”。向后端创建或上传离线比赛时必须省略 `RaceID`，不得把 `-1` 写入数据库。多场离线比赛依靠不同的 `localId` 和 `ClientRaceKey` 区分。

比赛同步状态独立维护为 `pending`、`online` 或 `offline`。`pending` 表示创建请求尚未得到确定结果，此时 `RaceID` 也显示为 `-1`，但比赛期间产生的成绩仍保留为待发送任务；创建成功后统一补上正 `RaceID` 并发送。只有创建请求超时或明确失败后才进入 `offline`，进入后本场不再发送单条实时成绩。

每条成绩维护：

```text
localScoreId：小程序本地唯一字符串
ClientScoreKey：同一比赛内稳定且唯一的幂等键
EventSequence：同一比赛内从 1 开始递增的事件序号
ScoreID：后端数据库 ID；获得成功回执前为空
```

自动补圈或后续重新计算圈数不得改变 `ClientScoreKey` 和 `EventSequence`。

## 后端数据模型

### 比赛信息

`RaceInfo` 字段：

```text
RaceID: long | null
ClientRaceKey: string
RaceDate: yyyy-MM-dd HH:mm:ss
ClubID: int
IsFinished: boolean
Enabled: boolean
```

新建比赛时 `RaceID` 允许省略，由数据库生成。`ClientRaceKey` 对新客户端必填，在同一 `ClubID` 下唯一。相同俱乐部和幂等键重试时返回原比赛；若幂等键相同但俱乐部、比赛时间等不可变字段冲突，返回 `409`。

`IsFinished` 新建时为 `false`，只允许从 `false` 变为 `true`。比赛完成后，仅允许内容完全相同的幂等重传；禁止新增、改写成绩或把比赛恢复为未结束。

### 比赛成绩

`Score` 字段：

```text
ScoreID: long | null
RaceID: long
AthleteID: int
ClientScoreKey: string
EventSequence: int
LapCount: int
SingleLapTime: int
TotalTime: int
Rank: int
Enabled: boolean
```

时间单位继续使用百分秒。新建成绩时 `ScoreID` 允许省略，由数据库生成。相同 `RaceID + ClientScoreKey` 重试时返回原 `ScoreID`；同一比赛内 `EventSequence` 也必须唯一。

请求携带 `ScoreID` 时，后端先校验该 ID 所属的比赛、运动员、幂等键和事件序号，不允许通过更新把记录移动到另一场比赛或另一名运动员。如果 `ScoreID` 与 `ClientScoreKey` 分别命中不同记录，返回 `409`。

### 参赛关系

`AthleteRaceJoin` 保持现有字段。完整比赛包按 `RaceID + AthleteID` 比较关系；为防止重传重复，数据库增加该组合唯一约束。已有 `id` 时回传原值；新客户端可省略 `id`，由数据库生成。

## 数据库迁移

迁移脚本按以下顺序执行：

1. `RaceInfoTable` 增加可空 `ClientRaceKey` 和非空 `IsFinished`；存量比赛的 `IsFinished` 回填为 `true`。
2. 存量比赛回填 `ClientRaceKey = CONCAT('legacy:', RaceID)`，随后改为非空。
3. `RaceID`、`ScoreID` 和参赛关系 `id` 改为数据库自动生成，同时继续允许读取存量 ID。
4. `ScoreTable` 增加可空 `ClientScoreKey` 和 `EventSequence`，为存量成绩按比赛和现有顺序生成稳定回填值，随后改为非空。
5. 增加唯一约束和查询索引前，先检查并处理存量空值与重复记录；迁移不得静默删除冲突数据。

最终索引：

```text
UNIQUE RaceInfoTable(ClubID, ClientRaceKey)
INDEX  RaceInfoTable(ClubID, IsFinished, Enabled, RaceDate, RaceID)
UNIQUE ScoreTable(RaceID, ClientScoreKey)
UNIQUE ScoreTable(RaceID, EventSequence)
INDEX  ScoreTable(RaceID, AthleteID, Enabled, EventSequence, ScoreID)
UNIQUE AthleteRaceJoinTable(RaceID, AthleteID)
```

后端完成后必须提供：初始化数据库使用的完整 `db.sql`、现有数据库升级使用的独立 migration SQL，以及实际执行前用于检查重复和空值的只读 SQL。

## 后端接口

所有接口继续使用现有 `ApiResponse` 外层结构。请求参数非法返回 `400`，数据不存在返回 `404`，幂等键或归属冲突返回 `409`，服务器错误返回 `500`。

### 创建比赛

```http
POST /api/v1/races
```

请求体省略 `RaceID`，包含完整 `RaceInfo`。成功响应返回规范化比赛对象和正整数 `RaceID`。相同 `ClubID + ClientRaceKey` 重试返回同一对象。

### 保存实时成绩

```http
POST /api/v1/scores
```

请求体可省略 `ScoreID`。成功响应返回完整规范化成绩对象，必须包含 `ScoreID`。相同 `RaceID + ClientScoreKey` 重试返回同一成绩。

### 保存完整比赛包

```http
POST /api/v1/race-bundles
```

请求与响应继续使用：

```json
{
  "RaceInfo": {},
  "AthleteRaceJoins": [],
  "Scores": []
}
```

处理规则：

- `RaceInfo.RaceID` 有值时先按 ID 查找，无值时按 `ClubID + ClientRaceKey` 查找；均未找到则创建比赛；
- 参赛关系和成绩逐条比较，内容相同则忽略，有变化则更新，不存在则新增；
- 无 ID 的成绩按 `ClientScoreKey` 识别并返回规范化 `ScoreID`；
- 响应返回所有比赛、参赛关系和成绩的规范化 ID；
- 整个操作使用单一数据库事务；
- 完成比赛时，先保存并核验参赛关系与成绩，最后将 `IsFinished` 更新为 `true`。

### 分页查询比赛包

为保持旧客户端兼容，现有 `GET /api/v1/race-bundles` 全量同步接口暂时保留。新增：

```http
GET /api/v1/race-bundles/page
```

查询参数：

```text
ClubID: 必填
page: 默认 1
pageSize: 默认 20，最大 200
sortBy: RaceDate | RaceID，默认 RaceDate
sortOrder: asc | desc，默认 desc
```

返回：

```json
{
  "list": [
    {
      "RaceInfo": {},
      "AthleteRaceJoins": [],
      "Scores": []
    }
  ],
  "page": 1,
  "pageSize": 20,
  "total": 0,
  "sortBy": "RaceDate",
  "sortOrder": "desc"
}
```

排序字段必须使用白名单映射，不拼接任意请求字符串。按 `RaceDate` 排序时始终追加同方向 `RaceID` 作为稳定次序。后端批量查询该页所有比赛的参赛关系和成绩，避免逐场执行查询。

### 查询实时比赛

```http
GET /api/v1/races/active?ClubID={ClubID}
```

返回该俱乐部下 `Enabled = true` 且 `IsFinished = false` 的比赛列表，按 `RaceDate DESC, RaceID DESC` 排序：

```json
{
  "list": [],
  "total": 0,
  "ServerTime": "2026-09-07 12:00:00"
}
```

接口允许同时返回多场未结束比赛，不自动选择或清理旧比赛。`ServerTime` 用于小程序校准实时总用时。

### 查询实时比赛最新成绩

```http
GET /api/v1/races/{RaceID}/latest-scores
```

对比赛中的每名运动员返回 `EventSequence` 最大且 `Enabled = true` 的一条成绩。无成绩时返回空数组，比赛不存在时返回 `404`。

```json
{
  "RaceID": 1001,
  "Scores": []
}
```

### 保存分组聚合数据

```http
POST /api/v1/athlete-group-bundles
PUT /api/v1/athlete-group-bundles/{AthleteGroupID}
DELETE /api/v1/athlete-group-bundles/{AthleteGroupID}
```

请求体包含一个 `AthleteGroup` 和完整的 `AthleteGroupForms` 数组。后端在单一事务中保存分组及成员关系；更新时以请求中的完整成员列表为准，新增缺失关系并软删除不再存在的关系。删除接口同时软删除分组和有效成员关系。任何一步失败均回滚整个操作。

## 小程序本地存储

运动员目录、分组及成员关系继续通过现有本地仓库持久缓存，但缓存不是独立数据源：

- 联网启动同步成功后，使用服务器返回的完整数据集原子替换对应俱乐部缓存；
- 离线或同步失败时允许读取最近一次成功缓存，用于查看、选人和继续离线比赛；
- 没有可用缓存时仍可进入小程序和查看连接状态，但不能创建需要运动员名单的新比赛；
- 不允许仅修改缓存；新增、编辑、删除、归档和恢复必须先由服务器确认成功；
- 切换俱乐部时按 `ClubID` 隔离缓存，不得混用其他俱乐部的数据。

比赛相关本地存储调整为：

- `ActiveRaceSession`：保存当前比赛的 `localId`、`ClientRaceKey`、`RaceID`、`syncState`、参赛名单、当前计分状态和事件序号；
- `RaceWorkingCopy`：保存当前比赛的临时成绩，在线和离线比赛都写入；
- `OfflineRaceRepository`：只保存 `RaceID = -1` 且尚未完整上传的比赛；
- `SyncOutboxRepository`：持久保存尚未得到成功回执的比赛创建、成绩保存、比赛完成任务；
- 已完成且后端确认成功的在线比赛不再长期保留完整本地历史，通过分页接口按需读取。

在线比赛完成并确认完整比赛包保存成功后，才可删除工作副本和对应 outbox。离线比赛上传成功并获得正 `RaceID` 后，从离线仓库移除；历史页面随后从后端读取它。

## Worker 与请求通道

小程序配置真实 Worker。Worker 负责纯调度和计算，不直接调用 `wx.request`、页面 API、蓝牙 API 或本地存储。

主线程维护 `WorkerRequestBridge`：

1. Worker 发出带 `requestId` 的请求意图；
2. 主线程通过现有通用 `BackendClient` 执行异步 `wx.request`；
3. 主线程将规范化结果回传 Worker；
4. Worker 决定成功、超时、退避或重试；
5. 每次状态变化同步写入主线程的持久 outbox。

请求分成互不等待的三个通道：

```text
control：运动员和分组操作，页面等待明确结果
race-write：比赛创建、成绩和完成；同一 localId 严格串行，不同比赛可并行
read：历史分页、实时比赛和实时成绩查询
```

`race-write` 中的依赖顺序固定为“创建比赛 -> 成绩 -> 完成比赛”。比赛创建未获得正 `RaceID` 前，成绩任务保留在队列中。相同成绩任务按 `ClientScoreKey` 合并，不并发重复发送。

Worker 被系统终止、应用进入后台或进程退出时，唯一真实状态仍在持久 outbox。下次 `onShow` 重建 Worker 并恢复任务。若 Worker 创建失败，使用相同接口的主线程异步调度器降级运行，仍不得阻塞页面。

超时或非成功响应使用指数退避重试，并设置最大间隔；网络恢复或 `onShow` 时立即触发一次。业务 `400/409` 不无限重试，而是保留任务并记录需要处理的明确错误。

## 启动同步

小程序启动时不再下载或上传全部比赛。启动流程只执行：

1. 分页读取当前俱乐部的运动员、分组和分组关系；全部页面读取并校验成功后原子替换本地缓存，任一页失败则保留上一次完整缓存并显示离线/同步失败提示；
2. 恢复持久 outbox；
3. 对本地 `syncState = offline` 且已完成的比赛提交完整比赛包；
4. 恢复 `syncState = pending` 比赛的创建任务，并按依赖顺序恢复其成绩和完成任务；
5. 恢复未完成在线比赛的待发送成绩和完成任务；
6. 蓝牙自动连接按现有独立流程运行，不等待网络同步。

离线比赛上传复用原 `ClientRaceKey`。即使此前创建请求已被服务器保存但响应丢失，重传仍返回原 `RaceID`，不会产生重复比赛。

## 比赛流程

### 开始比赛

固件确认开始后，小程序立即创建本地 `ActiveRaceSession` 和 `RaceWorkingCopy`，生成 `localId`、`ClientRaceKey`，初始显示 `RaceID = -1`、`syncState = pending`、`IsFinished = false`，并异步提交比赛创建任务。

该网络校验过程不显示加载遮罩，也不阻止比赛页面和蓝牙处理。后端在超时时间内返回成功时保存正 `RaceID`、切换为 `online`，并释放该比赛的成绩发送队列；超时、网络失败或业务失败时保持 `RaceID = -1`、切换为 `offline`，本场按离线比赛继续。

### 比赛进行中

每收到一条有效成绩，先写入 `RaceWorkingCopy` 并分配稳定 `ClientScoreKey` 和 `EventSequence`。`pending` 状态把成绩作为依赖比赛创建结果的待发送任务；`online` 状态立即进入后台发送队列；`offline` 状态不发送单条成绩。

页面和蓝牙回调不等待网络。后台任务超时或失败后按规则重试；成功回执必须校验比赛 ID、成绩幂等键和内容，随后保存 `ScoreID`。实时查询通道和其他比赛的写入不被该任务阻塞。

### 完成比赛

小程序先在本地将工作副本标记完成，并根据同步状态处理：

- `pending`：持久保存完成任务，等待创建任务得到结果；创建成功后按在线流程发送成绩和完整比赛包，创建超时或失败后转入离线流程；
- `offline`：只保存到离线比赛仓库，不执行本场的单条成绩或完成请求；
- `online`：生成最终完整比赛包任务。

在线比赛的最终完整比赛包任务等待此前成绩任务结束，在同一后端事务内保存参赛关系、核验全部成绩并最后设置 `IsFinished = true`。成功后清理工作副本；失败则持久保留并继续重试。

## 运动员与分组操作

服务器是运动员、分组和成员关系的权威数据源。本地仓库仅作为按俱乐部隔离的持久缓存；离线时允许读取缓存，但禁用运动员与分组的新增、编辑、删除、归档和恢复。

运动员和分组页面使用“远端确认后更新缓存”的事务流程：

1. 根据用户输入构造候选数据，不立即改变现有本地缓存；
2. 通过 `control` 通道调用后端；
3. 等待后端成功回执并严格校验对象身份和内容；
4. 成功后使用服务器返回的规范化对象一次性更新本地缓存并刷新页面；
5. 超时或错误时丢弃候选数据，保持缓存原状并显示明确提示。

运动员使用现有单资源 CRUD。分组名称和成员关系必须作为一个事务保存，后端新增分组聚合写接口，避免多个成员请求中途失败导致远端半完成。归档和恢复也遵循相同规则。

如果后端已成功但小程序本地缓存写入异常，小程序显示“服务器已保存，本地刷新失败”，并立即重新拉取该资源恢复一致，不伪装成后端失败。下次启动同步仍以服务器数据覆盖缓存。

## 历史比赛与搜索模块

历史页默认请求 `page = 1`、`pageSize = 20`、`sortBy = RaceDate`、`sortOrder = desc`。翻页只请求对应服务器页面，不再一次加载全部在线历史。

新建独立 `RaceHistoryQuery` 模块，负责查询条件、分页状态、请求取消和结果缓存。页面不直接拼接接口参数。初版只启用时间倒序，模块预留后续日期、运动员和比赛状态搜索条件。

本地离线比赛在历史页中单独标识，并与当前已加载的服务器结果按时间排序展示；每个视觉页最多 20 条。离线比赛上传成功后使用 `ClientRaceKey` 与服务器结果去重。

展开比赛时复用现有成绩视图模型。服务器比赛使用返回的完整比赛包；离线比赛使用本地工作副本。

## 当前比赛页面

新增非 Tab 页“当前比赛”，从比赛页和成绩页提供入口，避免超过微信小程序最多五个 Tab 的限制。

页面进入和重新显示时请求当前俱乐部未结束比赛，每 5 秒刷新比赛列表。展开某场比赛后，每 1 秒请求该比赛每名运动员的最新成绩；页面隐藏、折叠或离开时停止对应轮询，前一次请求未结束时不重复发起。

页面复用现有比赛成绩布局和格式化逻辑，展示：

- 从 `RaceDate` 和服务器时间校准后在本地递增的总用时；
- 当前最大圈数；
- 按现有排名规则计算的领滑运动员；
- 每名已有成绩运动员的圈数、单圈、总时长和排名。

运动员姓名和 EPC 优先从当前俱乐部的本地缓存按 `AthleteID` 关联；缓存中不存在的运动员使用 ID 占位，不丢弃成绩。请求失败时保留最近一次成功画面并显示非阻塞错误提示。

## 模块边界

后端按控制器、服务、Mapper 和 migration 的现有结构扩展。比赛包分页、实时比赛和最新成绩分别使用独立服务方法，不把动态排序字符串直接传入 SQL。

小程序侧新增或调整：

- 独立接口文件：比赛创建、成绩写入、比赛包分页、实时比赛、实时成绩、分组聚合；
- `RaceIdentity` 与本地比赛工作副本仓库；
- 持久 outbox、Worker 调度器和主线程请求桥接器；
- 比赛生命周期同步服务；
- 启动同步服务，仅处理运动员、分组和待上传比赛；
- 独立历史查询模块；
- 当前比赛页面及可复用成绩列表视图模型。

通用请求模块只负责 HTTP 发送、超时、通用响应解析和状态归一化。每个接口的路径、参数、DTO 与回执校验仍严格分离。

## 测试与验收

后端自动化测试至少覆盖：

- `ClientRaceKey` 创建重试返回同一 `RaceID`；
- `ScoreID` 为空时生成，`ClientScoreKey` 重试返回同一 `ScoreID`；
- 跨俱乐部、跨比赛和 ID/幂等键冲突返回 `409`；
- 分页默认值、上限、升降序、稳定次序和非法排序字段；
- 多场实时比赛查询；
- 每名运动员只返回最大 `EventSequence` 的成绩；
- 完整比赛包逐条比较、事务回滚和结束状态最后提交；
- 已结束比赛拒绝新增或改写数据；
- 数据库 migration 对存量数据的回填与约束检查。

小程序自动化测试至少覆盖：

- `RaceID = -1` 与多个不同 `localId`、`ClientRaceKey`；
- 开始请求成功、超时、返回丢失和业务失败；
- 成绩本地先保存、同比赛串行、不同比赛并行、查询通道独立；
- Worker 消息关联、超时、重复回执、终止恢复和降级调度；
- outbox 重启恢复、任务合并、退避和依赖顺序；
- 在线完成、离线完成、离线包后续上传和成功清理；
- 启动不再执行比赛全量双向同步；
- 运动员与分组缓存按俱乐部隔离、完整同步后原子替换、分页中断时保留旧缓存；
- 运动员与分组管理成功后更新缓存、失败或离线时缓存不变；
- 历史分页、离线去重、查询取消和后续搜索条件；
- 当前比赛列表轮询、展开轮询、页面隐藏停止和错误保留；
- 现有蓝牙计时、圈历史、自动补圈和后端字段映射测试保持通过。

完成自动化测试后，需要使用微信开发者工具和真实后端验证 Worker 生命周期、网络切换、请求超时、应用前后台切换、多场实时比赛以及数据库升级脚本。数据库修改位置和现有数据库升级 SQL 必须在最终协同总结中明确列出。

## 用量与交接

主管任务在关键阶段检查 5 小时用量。若剩余用量低于 20%，立即要求小程序和后端任务分别把已完成内容、未完成内容、修改文件、测试结果、数据库变更和下一步命令写入各自进度文档，停止开启新的大范围修改，确保后续任务可以接手。
