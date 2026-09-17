# 近10圈历史与名次查询实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为每名运动员保存最近10次有效过线的圈数、即时名次和总用时，并在APP通过`0x11`获取全部运动员时返回对应历史。

**Architecture:** `DetectionController`使用50组固定的10×7字节环形数组，仍是唯一的成绩和名次计算者。既有`0x12`保持实时快照兼容；`0x11`批量传输为每名运动员追加新的`0x15`历史包。小程序在`0x13`传输边界内暂存全部`0x15`，只有完整传输结束才原子替换`RaceStore`中的近10圈快照。

**Tech Stack:** STM32 Arduino Core、C++固定数组、LoRa字节协议、TypeScript、Node测试、pnpm。

**Spec:** `docs/superpowers/specs/2026-09-18-ten-lap-history-ranking-design.md`

## 全局约束

- 使用固定数组，不引入动态内存、持久化或ESP32专属API。
- 一条历史记录严格为7字节：圈数`uint16`、名次`uint16`、总用时`uint24`，均为大端序；总用时单位为百分秒。
- 圈数高优先、总用时短优先、有效扫描顺序早优先；名次从1开始，写入后不回写。
- 仅通过8秒规则的有效运动员过线可新增历史；定义运动员、黑名单和普通EPC不写入历史。
- 第11条历史覆盖最早记录；导出顺序始终为最早至最新。
- `0x12`九字节Payload、`0x13`格式、实时推送行为和APP的`0x11`请求格式保持不变。
- `0x15`仅由STM32响应`0x11`时发送，最大Payload为73字节；不得新增`0x16`或`0x17`。
- `0x02`、新的`0x01`和`DetectionController::stop()`必须清空历史。

---

### Task 1: 固件近10圈环形历史与稳定名次计算

**Files:**

- Modify: `DetectionController.h:20-272`
- Modify: `tests/DetectionControllerSelfTest/DetectionControllerSelfTest.cpp`

**Interfaces:**

- Produces: `struct AthleteLapHistoryRecord { uint16_t lapCount; uint16_t rank; uint32_t totalCentiseconds; };`
- Produces: `uint8_t DetectionController::athleteHistoryCount(size_t slot) const;`
- Produces: `bool DetectionController::athleteHistoryAt(size_t slot, uint8_t historyIndex, AthleteLapHistoryRecord& record) const;`
- Extends: `AthleteScoreEntry` with a 10×7 fixed byte array, `lapHistoryCount` and `nextLapHistoryIndex`.

- [x] **Step 1: 先写环形历史和名次失败自测**

在`DetectionControllerSelfTest.cpp`新增独立控制器。定义两个运动员，在8秒边界后分别过线，验证圈数高者排名第1；同圈数时总用时短者排名第1；构造相同圈数和总用时的两个有效扫描，验证先完成有效扫描者排名更靠前。

增加同一运动员连续11次、每次相隔8000ms的过线断言：`athleteHistoryCount(slot) == 10`，第0项为第2圈，第9项为第11圈。断言每项的`lapCount`、`rank`和`totalCentiseconds`等于写入瞬间的预期值。

```cpp
AthleteLapHistoryRecord record{};
assert(controller.athleteHistoryCount(slot) == 10);
assert(controller.athleteHistoryAt(slot, 0, record));
assert(record.lapCount == 2);
assert(controller.athleteHistoryAt(slot, 9, record));
assert(record.lapCount == 11);
```

同时覆盖：定义运动员后历史为0；8秒内重复检测不增加历史；`stop()`和重新`start()`后槽位无历史。

- [x] **Step 2: 运行自测并确认失败原因正确**

运行：

```text
call "C:\Program Files (x86)\Microsoft Visual Studio\2019\Community\VC\Auxiliary\Build\vcvars64.bat"
cl /nologo /utf-8 /std:c++17 /EHsc /Fe:"%TEMP%\DetectionControllerSelfTest.exe" tests\DetectionControllerSelfTest\DetectionControllerSelfTest.cpp
```

预期：因`AthleteLapHistoryRecord`、历史访问器或名次写入尚不存在而编译失败。

- [x] **Step 3: 添加固定字节环形数组与只读访问器**

在`DetectionController`私有区定义：

```cpp
static constexpr uint8_t LAP_HISTORY_CAPACITY = 10;
static constexpr uint8_t LAP_HISTORY_RECORD_SIZE = 7;
```

在`AthleteScoreEntry`追加：

```cpp
uint8_t lapHistory[LAP_HISTORY_CAPACITY][LAP_HISTORY_RECORD_SIZE];
uint8_t lapHistoryCount;
uint8_t nextLapHistoryIndex;
```

新增私有`writeLapHistory(AthleteScoreEntry&, uint16_t rank)`：使用本地大端写入辅助函数依次写入`lapCount`、`rank`和`totalCentiseconds`；写入后令`nextLapHistoryIndex = (nextLapHistoryIndex + 1) % LAP_HISTORY_CAPACITY`，并把`lapHistoryCount`封顶为10。

新增公共`athleteHistoryCount()`和`athleteHistoryAt()`。后者将逻辑索引0映射到`lapHistoryCount < 10 ? 0 : nextLapHistoryIndex`，再按模10得到物理下标；读取时以位移恢复16位/24位整数。无效槽位、越界逻辑索引返回`false`。

- [x] **Step 4: 使用有效扫描序号计算排名并写入历史**

为`AthleteEntry`增加`lastScoredOrder`，为`DetectionController`增加`nextScoredOrder_`；`clearAll()`重置该计数器。仅在运动员通过8秒规则后递增并赋给当前运动员，不能使用直接比较`millis()`，以避免计时器回绕时破坏“先扫描”规则。

新增`rankFor(const AthleteEntry&, const AthleteScoreEntry&) const`，遍历所有已启用的运动员及其成绩项。其他运动员满足以下任一条件即计在当前运动员之前：圈数更高；圈数相同而总用时更短；二者相同且`lastScoredOrder`更小。返回“此前人数 + 1”。

在`evaluateEpc()`更新当前总用时和圈数后，先更新`lastScoredOrder`，再计算名次、写入历史，最后返回已有`AthleteInfo`快照。不得把名次加入`AthleteInfo`或修改实时`0x12`。

- [x] **Step 5: 运行固件自测并检查原有行为**

运行：

```text
call "C:\Program Files (x86)\Microsoft Visual Studio\2019\Community\VC\Auxiliary\Build\vcvars64.bat"
cl /nologo /utf-8 /std:c++17 /EHsc /Fe:"%TEMP%\DetectionControllerSelfTest.exe" tests\DetectionControllerSelfTest\DetectionControllerSelfTest.cpp
"%TEMP%\DetectionControllerSelfTest.exe"
```

预期：历史、环形覆盖、名次、8秒静默、清空和既有成绩断言全部通过。

- [x] **Step 6: 提交本任务**

```text
git add DetectionController.h tests/DetectionControllerSelfTest/DetectionControllerSelfTest.cpp
git commit -m "feat: store ranked ten-lap history"
```

### Task 2: 扩展固件协议并在`0x11`中返回历史

**Files:**

- Modify: `DetectProtocol.h:13-129`
- Modify: `LoraManager.h:184-212`
- Modify: `SpeedSkatingTimer.ino:80-111`
- Modify: `tests/LoraProtocolSelfTest/LoraProtocolSelfTest.cpp`

**Interfaces:**

- Produces: `DetectProtocol::CMD_ATHLETE_LAP_HISTORY = 0x15`。
- Produces: `uint8_t DetectProtocol::buildAthleteLapHistoryPayload(uint16_t athleteId, const uint8_t* records, uint8_t recordCount, uint8_t* output);`
- Produces: `bool LoraManager::sendAthleteLapHistory(uint16_t athleteId, const uint8_t* records, uint8_t recordCount);`

- [x] **Step 1: 写`0x15`Payload失败自测**

在`LoraProtocolSelfTest.cpp`添加`0x15`常量断言和空历史、两条历史、10条历史断言。两条样本必须验证：Payload前3字节为运动员ID和条数；后续每条恰为7字节且不改动输入记录；最大Payload长度为73；条数11时构建函数返回0。

```cpp
uint8_t records[14] = {
  0x00, 0x02, 0x00, 0x01, 0x00, 0x03, 0x20,
  0x00, 0x03, 0x00, 0x02, 0x00, 0x06, 0x40
};
uint8_t payload[73] = {};
assert(DetectProtocol::buildAthleteLapHistoryPayload(1, records, 2, payload) == 17);
assert(payload[0] == 0 && payload[1] == 1 && payload[2] == 2);
```

- [x] **Step 2: 运行协议自测并确认失败**

运行：

```text
call "C:\Program Files (x86)\Microsoft Visual Studio\2019\Community\VC\Auxiliary\Build\vcvars64.bat"
cl /nologo /utf-8 /std:c++17 /EHsc /Fe:"%TEMP%\LoraProtocolSelfTest.exe" tests\LoraProtocolSelfTest\LoraProtocolSelfTest.cpp
```

预期：缺少`CMD_ATHLETE_LAP_HISTORY`或Payload构建函数而失败。

- [x] **Step 3: 添加`0x15`常量、Payload构建和LoRa发送器**

在`DetectProtocol.h`增加`CMD_ATHLETE_LAP_HISTORY = 0x15`、`LAP_HISTORY_RECORD_SIZE = 7`和`MAX_LAP_HISTORY_RECORDS = 10`。`buildAthleteLapHistoryPayload()`校验运动员ID非0、条数不超过10，输出`id + count + count × 7字节原始记录`，并返回实际Payload长度；失败返回0。

在`LoraManager.h`增加`sendAthleteLapHistory()`。它使用73字节局部Payload缓冲区，构建失败时返回`false`，成功时通过既有`sendPacket(CMD_ATHLETE_LAP_HISTORY, ...)`发送。不得改变收包状态机，因为`0x15`不是APP命令。

- [x] **Step 4: 让`sendAllAthletes()`按每名运动员发送快照和历史**

在`SpeedSkatingTimer.ino`中，为每个启用槽位：先保留现有`sendAthlete(athlete)`；再从`DetectionController::athleteHistoryCount(slot)`获取条数，按`athleteHistoryAt()`把每项重新编码到`uint8_t records[70]`；调用`loraManager.sendAthleteLapHistory(athlete.id, records, count)`。

任一次`0x12`或`0x15`发送失败，调用`sendStatus(CMD_GET_ATHLETES, STATUS_LORA_SEND_FAILED, ...)`并中止遍历；随后仍执行现有`sendAthleteTransfer(false)`。空历史也必须调用发送器，形成3字节`0x15`。

- [x] **Step 5: 运行协议和控制器自测**

运行：

```text
call "C:\Program Files (x86)\Microsoft Visual Studio\2019\Community\VC\Auxiliary\Build\vcvars64.bat"
cl /nologo /utf-8 /std:c++17 /EHsc /Fe:"%TEMP%\LoraProtocolSelfTest.exe" tests\LoraProtocolSelfTest\LoraProtocolSelfTest.cpp
"%TEMP%\LoraProtocolSelfTest.exe"
cl /nologo /utf-8 /std:c++17 /EHsc /Fe:"%TEMP%\DetectionControllerSelfTest.exe" tests\DetectionControllerSelfTest\DetectionControllerSelfTest.cpp
"%TEMP%\DetectionControllerSelfTest.exe"
```

预期：两组测试返回0；`0x12`的9字节断言保持不变。

- [x] **Step 6: 提交本任务**

```text
git add DetectProtocol.h LoraManager.h SpeedSkatingTimer.ino tests/LoraProtocolSelfTest/LoraProtocolSelfTest.cpp
git commit -m "feat: return ten-lap history in athlete sync"
```

### Task 3: 小程序解码并原子替换本次`0x11`历史快照

**Files:**

- Modify: `TimerCountMiniProgram/miniprogram/protocol/commands.ts`
- Modify: `TimerCountMiniProgram/miniprogram/protocol/athlete-sync-codec.ts`
- Modify: `TimerCountMiniProgram/miniprogram/stores/race-store.ts`
- Modify: `TimerCountMiniProgram/miniprogram/services/race-controller.ts:45-80, 349-383, 429-519`
- Modify: `TimerCountMiniProgram/tests/athlete-sync-codec.test.ts`
- Modify: `TimerCountMiniProgram/tests/race-controller.test.ts`

**Interfaces:**

- Produces: `CommandId.AthleteLapHistory = 0x15`。
- Produces: `interface FirmwareLapHistoryRecord { lapCount: number; rank: number; totalCentiseconds: number; }`。
- Produces: `interface FirmwareAthleteLapHistory { athleteId: number; records: FirmwareLapHistoryRecord[]; }`。
- Produces: `decodeFirmwareAthleteLapHistory(payload: Uint8Array): FirmwareAthleteLapHistory | null`。
- Extends: `RaceSnapshot` with `firmwareLapHistories: FirmwareAthleteLapHistory[]` and `RaceStore::replaceFirmwareLapHistories()`。

- [x] **Step 1: 写`0x15`解码失败测试**

在`athlete-sync-codec.test.ts`加入有效两条记录、空历史、错误条数、错误长度和ID为0的测试。有效样本断言按大端正确还原圈数、名次和总用时；记录条数大于10，或`payload.length !== 3 + count × 7`时必须返回`null`。

```ts
assert.deepEqual(
  decodeFirmwareAthleteLapHistory(Uint8Array.of(
    0x00, 0x01, 0x01,
    0x00, 0x02, 0x00, 0x03, 0x00, 0x03, 0x20,
  )),
  { athleteId: 1, records: [{ lapCount: 2, rank: 3, totalCentiseconds: 800 }] },
)
```

- [x] **Step 2: 运行小程序测试并确认失败**

运行：

```text
pnpm --dir TimerCountMiniProgram test -- --test-name-pattern="history|athlete"
```

预期：因`AthleteLapHistory`命令和解码器尚不存在而编译或断言失败。

- [x] **Step 3: 添加协议解码和RaceStore快照替换接口**

在`commands.ts`增加`AthleteLapHistory = 0x15`。在`athlete-sync-codec.ts`使用既有`readUint16BE`和`readUint24BE`逐条解码，严格校验ID、条数和精确Payload长度；不得接收长度不足、额外字节或条数超过10的包。

在`RaceStore`的初始`RaceSnapshot`增加冻结约定的普通数组`firmwareLapHistories: []`；新增`replaceFirmwareLapHistories(histories)`，深拷贝每个记录后一次性替换并通知订阅者。此状态只表达最近一次完整`0x11`传输的固件近10圈快照，不写入`ScoreRepository`，避免10圈窗口覆盖小程序既有的完整比赛与后端同步记录。

- [x] **Step 4: 在`0x13`传输边界内暂存并提交`0x15`**

将`pendingAthleteTransfer`扩展为`histories: Map<number, FirmwareLapHistoryRecord[]>`和`historyInvalid: boolean`。收到`0x13=0x01`时清空Map；收到`0x15`时仅在传输进行中解码、验证运动员属于当前比赛参赛名单且ID未重复，然后写入Map。任何无效Payload、传输外的`0x15`、未知参赛ID或重复ID都设置`syncError`并令`historyInvalid = true`。

收到`0x13=0x00`时，只有`started && !historyInvalid`才把Map转换为按运动员ID升序的数组并调用`raceStore.replaceFirmwareLapHistories()`；无效传输保持旧快照，不做部分替换。之后维持既有超时清理和Promise完成逻辑。

- [x] **Step 5: 写并运行控制器传输边界测试**

在`race-controller.test.ts`模拟开始比赛、`0x13=开始`、运动员`0x12`、运动员`0x15`和`0x13=结束`，断言`raceStore`只在结束标记后出现近10圈数据。再模拟错误长度和重复运动员ID，断言`syncError`为`0x15 Payload无效`或对应传输错误，且之前的`firmwareLapHistories`保持不变。

运行：

```text
pnpm --dir TimerCountMiniProgram test
pnpm --dir TimerCountMiniProgram typecheck
```

预期：协议、小程序控制器、历史存储和既有自动补圈测试全部通过。

- [x] **Step 6: 提交本任务**

```text
git add TimerCountMiniProgram/miniprogram/protocol/commands.ts TimerCountMiniProgram/miniprogram/protocol/athlete-sync-codec.ts TimerCountMiniProgram/miniprogram/stores/race-store.ts TimerCountMiniProgram/miniprogram/services/race-controller.ts TimerCountMiniProgram/tests/athlete-sync-codec.test.ts TimerCountMiniProgram/tests/race-controller.test.ts
git commit -m "feat: decode athlete ten-lap history"
```

### Task 4: 同步对外文档并完成回归检查

**Files:**

- Modify: `LORAProtocol-byte.md`
- Modify: `TimerCountMiniProgram/LORAProtocol-byte.md`
- Modify: `ARCHITECTURE.md`
- Modify: `CurrentTask.md`
- Modify: `docs/superpowers/plans/2026-09-18-ten-lap-history-ranking.md`

**Interfaces:**

- Documents: `0x11 -> 0x13 / 0x12 / 0x15 / 0x13`序列、`0x15`字段、环形覆盖规则、排名规则及未完成实机验证。

- [x] **Step 1: 更新固件和小程序协议说明**

在两份`LORAProtocol-byte.md`中添加`0x15`命令和字段格式，将`0x11`的返回序列改为每名运动员先`0x12`再`0x15`。提供空历史和单条历史示例，明确`0x12`格式不变、`0x15`最大73字节、记录按最早至最新排列。

- [x] **Step 2: 更新架构和待办**

在`ARCHITECTURE.md`增加`DetectionController`近10圈固定环形存储、扫描序号排名规则及`0x11`的数据流。在`CurrentTask.md`仅勾选已通过自动化验证的条目；STM32和微信真机联调继续留在待办或待实机验证。

- [ ] **Step 3: 运行完整静态检查与测试**

2026-09-18执行结果：`git diff --check`、三组固件纯C++自测、`race-controller.test.ts`和TypeScript类型检查通过。完整小程序套件仍有7项既存失败，涉及设备名期望、后端导入以及服务端分组缓存，不属于本任务改动范围；因此本步骤和实机联调仍保持未完成。

运行：

```text
git diff --check
rg -n "CMD_ATHLETE_LAP_HISTORY|AthleteLapHistory|0x15|lapHistory" DetectionController.h DetectProtocol.h LoraManager.h SpeedSkatingTimer.ino TimerCountMiniProgram/miniprogram
call "C:\Program Files (x86)\Microsoft Visual Studio\2019\Community\VC\Auxiliary\Build\vcvars64.bat"
cl /nologo /utf-8 /std:c++17 /EHsc /Fe:"%TEMP%\DetectionControllerSelfTest.exe" tests\DetectionControllerSelfTest\DetectionControllerSelfTest.cpp
"%TEMP%\DetectionControllerSelfTest.exe"
cl /nologo /utf-8 /std:c++17 /EHsc /Fe:"%TEMP%\LoraProtocolSelfTest.exe" tests\LoraProtocolSelfTest\LoraProtocolSelfTest.cpp
"%TEMP%\LoraProtocolSelfTest.exe"
pnpm --dir TimerCountMiniProgram test
pnpm --dir TimerCountMiniProgram typecheck
```

预期：静态检查无输出；C++和TypeScript测试全绿；`0x12`仍为9字节；未安装Arduino CLI时明确记录STM32完整编译未执行。

- [x] **Step 4: 提交文档与计划状态**

```text
git add LORAProtocol-byte.md TimerCountMiniProgram/LORAProtocol-byte.md ARCHITECTURE.md CurrentTask.md docs/superpowers/plans/2026-09-18-ten-lap-history-ranking.md
git commit -m "docs: describe ten-lap history protocol"
```

## 计划自审

- 覆盖性：固定字节存储、名次、环形覆盖、`0x11/0x15`传输、小程序原子替换、文档、固件与小程序测试均有对应任务。
- 一致性：历史仅由`DetectionController`维护；`0x15`只由设备发送；每条记录固定7字节；最大10条和73字节限制在所有任务中一致。
- 兼容性：实时`0x12`、`0x13`、普通EPC、RSSI峰值计分和8秒规则均保留；近10圈小程序快照不覆盖既有完整比赛成绩库。
