# 小程序本地运动员名单与本地计圈设计

日期：2026-08-13
目标分支：`APP_FullFunction`

## 1. 背景与目标

新版固件不再保存、查询或管理运动员名单。固件只负责：

- 接收开始检测命令 `0x01`；
- 接收停止检测命令 `0x02`；
- 接收比赛状态查询 `0x03`，并通过 `0x04` 返回状态；
- 检测到有效标签后，主动通过 `0x13` 上报 EPC 和从本次开始检测起计算的总用时；
- 通过 `0xF0` 返回命令执行状态或运行错误。

小程序成为运动员主档的唯一数据源，并负责 EPC 与运动员的匹配、圈数、单圈时间、排名、领滑和本场结束逻辑。本阶段使用微信本地存储，同时通过分层接口为后续云同步保留扩展位置。

## 2. 范围

### 2.1 本阶段包含

- 本地保存运动员 ID、姓名、单个 EPC 和归档状态；
- 自动分配永久运动员 ID；
- 新建、编辑、归档、查看归档列表和恢复运动员；
- 持久化有效 EPC 到运动员 ID 的索引；
- 归档时清理分组成员关系；
- 使用 `0x13` 在小程序中计算圈数、单圈时间、排名和领滑；
- 调整开始、结束、重置的控制逻辑；
- 历史成绩继续保存运动员姓名和 EPC 的比赛时快照；
- 为未来云同步和 ID 复用保留明确的接口边界。

### 2.2 本阶段不包含

- 从旧固件导入运动员名单；
- 一名运动员绑定多个 EPC；
- 扫描添加运动员；
- 未绑定 EPC 的记录、提示或补绑；
- 本地数据导入、导出和备份接口；
- 存储损坏恢复工具；
- 面向用户的存储失败恢复流程；
- 云端账号、网络请求、同步和冲突合并；
- 永久删除归档运动员；
- 为原型验证单独开发测试入口或调试页面。

## 3. 已选方案

采用 `AthleteRepository + AthleteStore` 分层方案。

```text
页面
  |
  v
AthleteCatalogService
  |-- AthleteRepository ---- AthleteCatalogStorage ---- 微信本地存储
  |-- AthleteStore --------- 当前比赛临时状态
  `-- GroupStore ----------- 归档时清理分组关系

BLE/协议层 -- 0x13 EPC事件 --> RaceController --> AthleteCatalogService查询EPC
                                                --> AthleteStore更新比赛状态
```

职责如下：

- `AthleteCatalogStorage`：平台存储读写抽象；第一阶段由微信本地存储实现。
- `AthleteRepository`：加载和保存完整目录快照，隔离具体存储方式。
- `AthleteCatalogService`：执行业务校验、ID 分配、新建、编辑、归档、恢复和 EPC 查询。
- `AthleteStore`：只保存本场比赛状态，不再接收固件下发的运动员名单。
- `RaceController`：处理新版协议和比赛状态机，不直接操作微信存储。
- `GroupStore`：继续保存本地分组，运动员归档后删除其所有分组成员关系。

## 4. 持久化数据模型

```ts
interface AthleteCatalog {
  schemaVersion: 1
  revision: number
  nextId: number
  idReusePolicy: 'never'
  athletes: AthleteProfile[]
  activeEpcIndex: Record<string, number>
}

interface AthleteProfile {
  id: number
  name: string
  epc: string
  status: 'active' | 'archived'
  createdAt: number
  updatedAt: number
  archivedAt: number | null
}
```

存储键使用带版本含义的固定名称，例如 `timer_count_athlete_catalog_v1`。目录、`nextId` 和 `activeEpcIndex` 必须作为同一个快照写入，不能使用多个独立存储键。

### 4.1 字段规则

- `schemaVersion` 用于未来本地结构迁移。
- `revision` 每次成功修改目录后递增，为未来云同步冲突判断提供版本号。
- `nextId` 是下一次创建所使用的候选 ID，初始值为 `1`。
- `idReusePolicy` 第一阶段固定为 `never`。ID 分配通过独立分配器接口完成，以便未来增加归档 ID 回收策略。
- `athletes` 同时保存有效和归档运动员。
- `activeEpcIndex` 只包含有效运动员，键为规范化后的大写 EPC，值为运动员 ID。
- 圈数、单圈时间、总用时、排名和领滑等比赛字段不得写入运动员目录。

### 4.2 平台与云同步接口

```ts
interface AthleteCatalogStorage {
  read(): unknown
  write(value: AthleteCatalog): void
}

interface AthleteCatalogSyncAdapter {
  pull(): Promise<AthleteCatalog | null>
  push(catalog: AthleteCatalog): Promise<void>
}
```

第一阶段只实例化 `WechatAthleteCatalogStorage`。同步适配器不实例化、不请求网络、不要求微信登录。`write` 和未来同步接口允许报告失败，但本阶段只保留错误传播边界，不开发专门的恢复或重试交互。

## 5. 运动员目录业务规则

### 5.1 校验

- 姓名去除首尾空格后不能为空；
- 姓名允许重复，以运动员 ID 区分；
- 姓名最长为 32 个 UTF-8 字节；
- EPC 必须是 8 位十六进制字符，保存前去除首尾空格并统一转为大写；
- EPC 在有效运动员中必须唯一；
- 归档运动员的 EPC 不占用有效 EPC 索引。

### 5.2 ID 分配

- 创建运动员时使用 `nextId`；
- 创建成功后 `nextId` 加一；
- ID 合法范围为 `1-65535`；
- 删除或归档后不复用 ID；
- `nextId` 超过 `65535` 时禁止继续创建并提示 ID 已耗尽；
- 运动员创建后 ID 永久不变，编辑和恢复均不得修改 ID。

分配逻辑通过 `AthleteIdAllocator` 边界调用。第一阶段实现单调递增策略，未来可在不改变页面、目录服务和比赛引用方式的前提下增加复用策略。

### 5.3 新建与编辑

- 第一阶段只支持手动填写姓名和 EPC；
- 原“扫描添加”入口暂不实装，不发送旧协议命令；
- 新建成功后更新 `athletes`、`activeEpcIndex`、`nextId` 和 `revision`；
- 编辑允许修改姓名和 EPC，但不允许修改 ID；
- EPC 变更时，从索引移除旧 EPC，再加入新 EPC；
- 比赛处于进行中、等待其他运动员完成或已结束未重置状态时，沿袭现有小程序的比赛期限制，禁止修改运动员目录。

### 5.4 归档

- “删除运动员”在业务上改为归档；
- 归档记录保留 ID、姓名、EPC 和历史时间字段；
- 设置 `status = 'archived'` 和 `archivedAt`；
- 从 `activeEpcIndex` 移除该 EPC；
- 从所有本地分组中移除该运动员 ID；
- 归档运动员不出现在有效名单、分组选择和新比赛参赛名单中；
- 历史比赛成绩使用比赛时保存的姓名和 EPC 快照，不受归档影响。

### 5.5 恢复

- 恢复时保留原 ID；
- 恢复前检查姓名和 EPC 格式；
- 如果原 EPC 已被其他有效运动员占用，恢复失败；
- 允许先在归档记录上修改姓名或 EPC，再执行恢复；
- 恢复成功后写回 `activeEpcIndex`；
- 恢复后不自动加入原有分组。

### 5.6 写操作串行化

- 所有目录修改通过 `AthleteCatalogService` 的单一写队列串行执行；
- 保存动作进行中时，页面禁用其他运动员管理按钮；
- 后续云存储接入后仍沿用同一队列，防止重复 ID 和覆盖写入。

本阶段不设计复杂写入失败恢复。存储接口仍可抛出错误，调用链不得把失败误报为成功。

## 6. EPC 查询与未绑定标签

收到 EPC 后使用持久化的 `activeEpcIndex` 查询运动员：

```ts
lookupActiveAthleteByEpc(epc: string): AthleteProfile | null
```

处理规则：

- EPC 先规范化为 8 位大写十六进制文本；
- 查不到有效运动员时直接忽略；
- 不记录未绑定 EPC，不提示用户，不写入成绩；
- 查到归档运动员等同于未绑定；
- 选择了参赛分组时，不属于开始时锁定名单的 EPC 直接忽略。

虽然 `activeEpcIndex` 可由运动员数组推导，本版本按要求长期保存。目录修改时必须同时更新数组与索引，并以一个完整快照写入。

## 7. 固件状态与小程序比赛阶段

新版协议的固件状态只有：

```ts
type FirmwareDetectionState = 'unknown' | 'stopped' | 'detecting'
```

小程序另外维护本地比赛阶段：

```ts
type LocalRacePhase =
  | 'idle'
  | 'running'
  | 'finishing'
  | 'finished'
```

- `idle`：比赛未开始，可管理名单和分组；
- `running`：正常计算所有有效 EPC；
- `finishing`：结束按钮已点击，继续等待落后运动员达到结束圈数；
- `finished`：锁定参赛名单中的所有运动员均已达到结束圈数；
- `finishing` 和 `finished` 阶段固件仍为 `detecting`，直到用户点击重置。

开始时锁定当前参赛人员：

- 选择分组时，复制该分组内当前有效运动员 ID；
- 选择“全部运动员”时，复制所有当前有效运动员 ID；
- 锁定名单为空时禁止开始；
- 比赛未重置前禁止切换分组和修改运动员目录。

## 8. 按钮行为

页面保留现有的主按钮和重置按钮布局。主按钮在 `idle` 显示“开始”，在 `running` 显示“结束”。进入 `finishing` 或 `finished` 后主按钮禁用，等待用户重置。

### 8.1 开始

1. 校验已连接设备且锁定参赛名单非空；
2. 发送 `0x01`；
3. 等待 `0xF0 [0x01, 0x00]`；
4. 成功后清空上一场比赛临时数据；
5. 锁定参赛名单和当前分组；
6. 创建本地比赛记录并进入 `running`。

开始失败时不清空原有数据，也不改变本地比赛阶段。

### 8.2 结束

结束是纯本地操作，不向固件发送关闭命令。

1. 必须处于 `running`；
2. 必须已经产生当前领滑，否则提示“尚无有效运动员通过，无法结束”；
3. 记录 `finishLap = 当前领滑圈数`；
4. 将当前圈数已达到 `finishLap` 的运动员立即标记为完成并冻结；
5. 进入 `finishing`；
6. 其他运动员继续处理 `0x13`，达到 `finishLap` 后立即冻结；
7. 冻结后收到该运动员的 EPC 直接忽略，不会记录 `finishLap + 1`；
8. 锁定参赛名单中的所有运动员都完成后进入 `finished`。

未首次通过的运动员也属于锁定名单，必须从第 0 圈开始达到 `finishLap`。若其始终没有通过，比赛保持 `finishing`，用户可以直接重置。

### 8.3 重置

1. 发送 `0x02` 停止检测；
2. 等待 `0xF0 [0x02, 0x00]`；
3. 成功后结束本地比赛记录；
4. 清空圈数、单圈时间、总用时、排名、领滑、结束圈数和完成标记；
5. 清除锁定参赛名单；
6. 解锁运动员目录和分组；
7. 返回 `idle`。

停止命令失败时保留当前本地比赛数据，允许用户重试，避免在固件仍检测时误以为已经重置。

## 9. `0x13` 本地计圈规则

`0x13` Payload 为：

```text
byte0-byte3：EPC 原始 4 字节
byte4-byte6：从最近一次成功开始检测起计算的总用时，uint24 百分秒
```

事件处理顺序：

```text
解码并校验0x13
  -> EPC规范化
  -> 查询activeEpcIndex
  -> 检查运动员属于锁定参赛名单
  -> 检查本地阶段为running或finishing
  -> 检查该运动员尚未冻结
  -> 更新圈数和时间
  -> finishing阶段检查是否达到finishLap
  -> 重算全体排名与领滑
  -> 保存本场成绩快照
```

### 9.1 首次检测为第 0 圈

每名运动员独立维护上一次总用时。第一次收到有效事件表示刚经过终点线，只建立计时基准：

```text
lapCount = 0
previousTotalCentiseconds = currentTotalCentiseconds
lapCentiseconds = null
totalCentiseconds = currentTotalCentiseconds
```

页面将单圈时间显示为 `—`，不将从固件开始检测到首次经过终点的时间当作一圈时间。

### 9.2 后续检测

```text
candidateLap = previousLap + 1
lapCentiseconds = currentTotalCentiseconds - previousTotalCentiseconds
lapCount = candidateLap
previousTotalCentiseconds = currentTotalCentiseconds
totalCentiseconds = currentTotalCentiseconds
```

- 固件已经执行同 EPC 的 8 秒去重，小程序不增加第二套时间去重；
- 如果当前总用时小于或等于上一次总用时，视为重复或乱序事件，直接忽略；
- 在 `finishing` 阶段，如果运动员已经达到 `finishLap`，事件在计算前被忽略；
- 更新后刚好达到 `finishLap` 时，保存该圈并立即冻结；
- 永远不会把冻结后的下一次通过计为 `finishLap + 1`。

## 10. 排名与领滑

只有已经完成首次有效检测、即已经具有第 0 圈记录的运动员参与实时排名。排序规则固定为：

1. 圈数降序；
2. 圈数相同时，总用时升序；
3. 圈数和总用时都相同时，运动员 ID 升序。

排序后从 1 开始生成连续排名，第一名即当前领滑。尚未首次通过的运动员不显示实时名次。

在 `finishing` 阶段：

- 已完成运动员的成绩被冻结，但仍参与排名；
- 其他运动员每次产生有效成绩后重算全体排名；
- 全部运动员完成时，最后一次重算的结果成为最终排名。

单圈时间完全由同一运动员相邻两次 `0x13` 的总用时之差计算，不跨运动员共享基准。

## 11. 历史成绩

每次有效圈次更新后，继续写入现有成绩仓库。成绩条目包含比赛当时的：

- 运动员 ID；
- 姓名快照；
- EPC 快照；
- 圈数；
- 单圈时间；
- 总用时；
- 当前排名。

后续编辑或归档运动员不得修改已经保存的历史成绩。结束阶段全部运动员完成时将比赛标记为完成；用户提前重置时，保留重置前已经写入的成绩记录并结束该场记录。

## 12. 连接与恢复边界

- 连接成功后只查询固件状态，不再请求运动员名单；
- 小程序在同一运行进程内断线重连时保留本地比赛阶段和已计算成绩；
- 新协议没有历史 EPC 查询能力，断线期间漏掉的圈次无法补算；
- 如果小程序被完全重启，而固件返回 `detecting`，小程序不得凭空重建比赛成绩；页面提示设备仍在检测，要求用户先执行重置再开始新比赛；
- 本地比赛临时状态第一阶段不做跨进程持久化。

## 13. 用户提示

运动员名单仅保存在当前微信客户端的本地存储。需要在运动员管理页明确提示：

> 运动员名单保存在本机。清理微信存储、删除小程序数据或更换手机可能导致名单丢失。

本阶段不提供导入、导出或云备份入口。

## 14. 原型验收清单

本阶段不增加测试专用接口或调试页面，通过现有自动化测试能力和真机原型流程验证：

- 重新打开小程序后有效和归档运动员仍存在；
- ID 从 1 单调递增，归档后不复用；
- 姓名和 EPC 校验符合规则；
- 有效 EPC 唯一，归档后可以被其他运动员使用；
- 恢复归档运动员时正确检测 EPC 冲突；
- 归档后运动员从所有分组移除；
- `activeEpcIndex` 与目录一起长期保存并随增删改恢复更新；
- 未绑定 EPC、归档 EPC 和非参赛分组 EPC 被直接忽略；
- 首次有效 EPC 记为第 0 圈且单圈时间为空；
- 后续单圈时间等于相邻总用时之差；
- 排名按圈数、总用时和 ID 稳定排序；
- 点击结束不发送停止协议；
- 结束后每名运动员最多计算到 `finishLap`；
- 点击重置发送 `0x02`，成功后清空本场数据并解锁管理功能；
- 小程序重启且固件仍在检测时，要求重置而不伪造恢复成绩。

## 15. 后续扩展点

- 增加 `reuse-archived` ID 分配策略；
- 增加多 EPC 数据模型和绑定管理；
- 增加独立扫描绑定协议后恢复扫描添加；
- 增加本地导入、导出和备份；
- 实现 `AthleteCatalogSyncAdapter` 的云端版本；
- 为云同步增加设备标识、冲突检测和 revision 合并；
- 如果固件未来提供历史 EPC 事件查询，再设计断线补算。
