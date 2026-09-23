# RSSI Peak Scoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在保留现有即时计分保险路径的同时，默认按 300ms 内最强 RSSI 样本的原始接收时间确认运动员过线，并生成既有成绩与 `0x12` 上报。

> 状态：本计划的固定300ms窗口方案已被后续确认的分段规则替代。当前实现以`docs/superpowers/specs/2026-09-15-rssi-peak-scoring-design.md`为准：同一EPC连续3次信号下降或静默100ms时，选择该段最高RSSI样本；同强度峰值取后一次样本。

**Architecture:** RFIDReader 将通知帧解析为带 RSSI 和到达时间的轻量事件，不处理业务。RfidTagEvent.h 提供不依赖 Arduino 串口的共享事件类型；新建 RssiScoringController，仅为已定义运动员按 EPC 聚合固定数量的候选样本；窗口到期后把选中的 EPC 与时间交给既有 DetectionController。config.h 的编译期配置选择新默认路径或旧即时路径，二者共用唯一的成绩表和 LoRa 发送逻辑。

**Tech Stack:** STM32 Arduino Core、C++ 固定数组、C++ `assert` 自测、Arduino CLI。

**Spec:** `docs/superpowers/specs/2026-09-15-rssi-peak-scoring-design.md`

## Global Constraints

- 使用 STM32 Arduino Core；不得引入 ESP32 专属 API、动态内存、TF 卡或新库。
- RSSI 通知帧字段为 `byte5`，按有符号 `int8_t` 解释，数值更大表示信号更强。
- RSSI 聚合只用于已定义运动员；普通 EPC 和黑名单保持现有即时行为。
- `RssiPeak` 是默认模式，`LegacyImmediate` 必须可通过 `config.h` 单点切换恢复。
- 不改变 LoRa 命令、`0x12` 九字节 Payload、状态码或 APP 接口。
- RSSI 模块只能选择计分时间；圈数、单圈时长、总时长和 8 秒静默仍由 DetectionController 唯一维护。
- 结束检测时丢弃未满 300ms 的候选窗口，不得在停止后发送新的 `0x12`。

---

### Task 1: 为 RFID 读取事件保留 RSSI 与接收时间

**Files:**

- Create: `RfidTagEvent.h`
- Modify: `RFIDReader.h:18-77, 108-116, 196-204`
- Modify: `SpeedSkatingTimer.ino:218-226`
- Test: `tests/RssiScoringControllerSelfTest/RssiScoringControllerSelfTest.cpp`

**Interfaces:**

- Produces: `RfidTagEvent.h` 中的 `struct RfidTagEvent { uint32_t epc; int8_t rssiDbm; uint32_t detectedMs; };`
- Produces: `bool RFIDReader::readTagEvent(RfidTagEvent& event);`
- Consumes: 单次轮询通知帧，RSSI 为 `frame[5]`，EPC 为 `frame[8]` 至 `frame[11]`。

- [x] **Step 1: 先写事件类型的编译期使用测试**

```cpp
RfidTagEvent weak{0x11111111UL, -70, 1000};
RfidTagEvent strong{0x11111111UL, -45, 1100};
assert(weak.rssiDbm < strong.rssiDbm);
assert(strong.detectedMs == 1100);
```

- [x] **Step 2: 创建共享事件头文件并将 EPC 队列改为读取事件队列**

在 `RfidTagEvent.h` 中只包含 `stdint.h` 并定义事件类型。RFIDReader 和后续 RssiScoringController 都包含该头文件；不得让主机自测包含 `Arduino.h` 或 `HardwareSerial.h`。

把 `uint32_t queue_[QUEUE_CAPACITY]` 替换为 `RfidTagEvent queue_[QUEUE_CAPACITY]`。在 `RFIDReader::processFrame()` 的校验成功路径构造并入队：

```cpp
RfidTagEvent event{
  epc,
  static_cast<int8_t>(frame_[5]),
  millis()
};
enqueue(event);
```

以 `readTagEvent(RfidTagEvent&)` 替代 `readEpc(uint32_t&)`。不得在 RFIDReader 中加入运动员查询、窗口管理或 LoRa 发送。

- [x] **Step 3: 更新主循环读取类型**

将 `uint32_t epc` 和 `readEpc(epc)` 改为 `RfidTagEvent tagEvent` 和 `readTagEvent(tagEvent)`，临时调用后续任务实现的 `processTagEvent(tagEvent)`。

- [ ] **Step 4: 编译检查**

Run:

```text
arduino-cli compile --fqbn STMicroelectronics:stm32:GenF4:pnum=BLACK_F407VE .
```

Expected: 事件类型、队列入队和读取接口一致，固件可编译。

- [ ] **Step 5: 签入任务**

```text
git add RfidTagEvent.h RFIDReader.h SpeedSkatingTimer.ino tests/RssiScoringControllerSelfTest/RssiScoringControllerSelfTest.cpp
git commit -m "feat: retain RFID RSSI with tag events"
```

### Task 2: 实现独立的 RSSI 峰值窗口模块

**Files:**

- Create: `RssiScoringController.h`
- Modify: `tests/RssiScoringControllerSelfTest/RssiScoringControllerSelfTest.cpp`

**Interfaces:**

- Consumes: `RfidTagEvent`。
- Produces: `struct RssiScoreSelection { uint32_t epc; uint32_t detectedMs; int8_t rssiDbm; };`
- Produces: `enum class RssiAcceptResult : uint8_t { Stored, ExpiredSelection, TableFull };`
- Produces: `RssiAcceptResult RssiScoringController::accept(const RfidTagEvent& event, RssiScoreSelection& expired);`
- Produces: `bool RssiScoringController::takeExpired(uint32_t nowMs, RssiScoreSelection& selection);`
- Produces: `void RssiScoringController::clear();`

- [x] **Step 1: 写失败的窗口行为测试**

```cpp
RssiScoringController scorer(300);
RssiScoreSelection selection{};
assert(scorer.accept({0x11111111UL, -70, 1000}, selection) ==
       RssiAcceptResult::Stored);
assert(scorer.accept({0x11111111UL, -42, 1120}, selection) ==
       RssiAcceptResult::Stored);
assert(!scorer.takeExpired(1299, selection));
assert(scorer.takeExpired(1300, selection));
assert(selection.epc == 0x11111111UL);
assert(selection.rssiDbm == -42);
assert(selection.detectedMs == 1120);
```

同一文件还需覆盖：RSSI 相同时保留较早时间；不同 EPC 独立结算；事件间隔正好 300ms 时返回旧窗口并开始新窗口；`uint32_t` 回绕；`clear()` 后无可结算结果。

- [x] **Step 2: 确认测试在模块缺失时失败**

Run:

```text
cl /std:c++17 /EHsc tests/RssiScoringControllerSelfTest/RssiScoringControllerSelfTest.cpp /Fe:tests/RssiScoringControllerSelfTest/RssiScoringControllerSelfTest.exe
tests/RssiScoringControllerSelfTest/RssiScoringControllerSelfTest.exe
```

Expected: 编译失败，提示缺少 `RssiScoringController.h` 或相关类型。

- [x] **Step 3: 实现固定数组窗口**

在新头文件中使用 50 项固定数组，每项保存 `enabled`、`epc`、`windowStartedMs`、`bestRssiDbm` 和 `bestDetectedMs`。信号更强时更新最佳样本：

```cpp
if (event.rssiDbm > entry.bestRssiDbm) {
  entry.bestRssiDbm = event.rssiDbm;
  entry.bestDetectedMs = event.detectedMs;
}
```

信号相等时不覆盖，从而保留先到样本。所有窗口到期判断使用无符号减法 `nowMs - entry.windowStartedMs >= windowMs_`。没有空槽时 `accept()` 返回 `RssiAcceptResult::TableFull`，调用方映射为既有 `STATUS_QUEUE_OVERFLOW`，不得覆盖任意窗口。`ExpiredSelection` 表示已在 `expired` 写入旧窗口结果且当前事件已开始新窗口。

- [x] **Step 4: 运行窗口自测**

Run:

```text
cl /std:c++17 /EHsc tests/RssiScoringControllerSelfTest/RssiScoringControllerSelfTest.cpp /Fe:tests/RssiScoringControllerSelfTest/RssiScoringControllerSelfTest.exe
tests/RssiScoringControllerSelfTest/RssiScoringControllerSelfTest.exe
```

Expected: 退出码为 `0`；峰值、同值、并行、边界、回绕和清空断言通过。

- [ ] **Step 5: 签入任务**

```text
git add RssiScoringController.h tests/RssiScoringControllerSelfTest/RssiScoringControllerSelfTest.cpp
git commit -m "feat: add RSSI peak scoring windows"
```

### Task 3: 添加模式选择并连接唯一成绩链路

**Files:**

- Modify: `config.h:1-18`
- Modify: `DetectionController.h:196-225`
- Modify: `SpeedSkatingTimer.ino:1-7, 168-205, 218-244`
- Modify: `tests/DetectionControllerSelfTest/DetectionControllerSelfTest.cpp`
- Modify: `tests/RssiScoringControllerSelfTest/RssiScoringControllerSelfTest.cpp`

**Interfaces:**

- Produces: `enum class ScoringMode : uint8_t { LegacyImmediate, RssiPeak };`
- Produces: `constexpr ScoringMode ACTIVE_SCORING_MODE = ScoringMode::RssiPeak;`
- Produces: `constexpr uint32_t RSSI_PEAK_WINDOW_MS = 300UL;`
- Produces: `bool DetectionController::isAthleteEpc(uint32_t epc) const;`
- Consumes: `RssiScoreSelection`，通过既有 `evaluateEpc(epc, selectedMs)` 提交选中的时间。

- [x] **Step 1: 写峰值时间不等于结算时间的失败测试**

```cpp
assert(controller.isAthleteEpc(0x11111111UL));
EpcEvent event = controller.evaluateEpc(0x11111111UL, 10120);
assert(event.type == EpcEventType::Athlete);
assert(event.athlete.totalCentiseconds == expectedCentisecondsAt10120);
```

测试必须模拟窗口在 `10300ms` 结算，但选中峰值读数在 `10120ms` 到达；总时长和单圈时长必须以 `10120ms` 为准。

- [x] **Step 2: 添加配置开关和只读运动员查询**

在 `config.h` 增加两个模式、默认 `RssiPeak` 与 `RSSI_PEAK_WINDOW_MS = 300UL`。在 DetectionController 增加只遍历 `athletes_` 的 `isAthleteEpc()`；它不得写入 `lastDetectedMs`、成绩表或普通 EPC 表。

- [x] **Step 3: 重构为统一提交入口并按模式分派**

将 `processDetectedEpc(uint32_t epc)` 拆为：

```cpp
void processScoredEpc(uint32_t epc, uint32_t scoringMs);
void processTagEvent(const RfidTagEvent& event);
void flushRssiSelections(uint32_t nowMs);
```

`processScoredEpc()` 保留当前 `evaluateEpc()`、错误状态、`sendAthlete()`、普通 EPC `0x14` 和日志。

`LegacyImmediate` 调用 `processScoredEpc(event.epc, millis())`，保留原即时保险行为。`RssiPeak` 仅将已定义运动员交给 RSSI 模块；普通 EPC 和黑名单立即调用 `processScoredEpc(event.epc, event.detectedMs)`。

主循环不得延时，并在读取事件前后结算到期窗口：

```cpp
rfidReader.poll();
flushRssiSelections(millis());
while (processed < 4 && rfidReader.readTagEvent(tagEvent)) {
  processTagEvent(tagEvent);
}
flushRssiSelections(millis());
```

处理 `accept()` 返回的跨窗口结果，防止连续帧跨边界时遗漏旧窗口。开始检测成功前和结束检测成功后清空 RSSI 模块；结束后不得结算未到期窗口。

- [ ] **Step 4: 运行集成自测与两种模式编译**

Run:

```text
cl /std:c++17 /EHsc tests/DetectionControllerSelfTest/DetectionControllerSelfTest.cpp /Fe:tests/DetectionControllerSelfTest/DetectionControllerSelfTest.exe
tests/DetectionControllerSelfTest/DetectionControllerSelfTest.exe
cl /std:c++17 /EHsc tests/RssiScoringControllerSelfTest/RssiScoringControllerSelfTest.cpp /Fe:tests/RssiScoringControllerSelfTest/RssiScoringControllerSelfTest.exe
tests/RssiScoringControllerSelfTest/RssiScoringControllerSelfTest.exe
arduino-cli compile --fqbn STMicroelectronics:stm32:GenF4:pnum=BLACK_F407VE .
```

Expected: 两个自测均返回 `0`；默认 RSSI 模式能编译；将配置临时改为 `LegacyImmediate` 后再次编译也通过。

- [ ] **Step 5: 签入任务**

```text
git add config.h DetectionController.h SpeedSkatingTimer.ino tests/DetectionControllerSelfTest/DetectionControllerSelfTest.cpp tests/RssiScoringControllerSelfTest/RssiScoringControllerSelfTest.cpp
git commit -m "feat: select RSSI peak scoring by configuration"
```

### Task 4: 同步文档、静态检查与实机对照

**Files:**

- Modify: `ARCHITECTURE.md`
- Modify: `RFIDPollingNotes.md`
- Modify: `LORAProtocol-byte.md`
- Modify: `CurrentTask.md`
- Modify: `docs/superpowers/specs/2026-09-15-rssi-peak-scoring-design.md`
- Modify: `docs/superpowers/plans/2026-09-15-rssi-peak-scoring.md`

**Interfaces:**

- Documents: RSSI `byte5`、300ms 选峰、两种配置模式、唯一成绩表和“无 LoRa 协议变更”的结论。

- [x] **Step 1: 更新架构与轮询说明**

在 `ARCHITECTURE.md` 的模块和数据流中增加 RssiScoringController，明确它不持有成绩。修正 `RFIDPollingNotes.md` 中与实际代码不一致的函数名，使其使用 `poll()`、`readTagEvent()` 和 `processTagEvent()`，并记录 RSSI 提取位置与时间戳捕获点。

- [x] **Step 2: 更新任务和协议说明**

在 `CurrentTask.md` 登记实现状态。于 `LORAProtocol-byte.md` 说明 RSSI 峰值选择不改变 `0x12` 格式和返回条件；不得添加协议字段或命令。

- [x] **Step 3: 执行静态检查**

Run:

```text
git diff --check
rg -n "readEpc|processDetectedEpc|receiveTag|readTagEvent|processTagEvent|RssiScoringController" RFIDReader.h SpeedSkatingTimer.ino RFIDPollingNotes.md ARCHITECTURE.md
```

Expected: `git diff --check` 无输出；旧函数名仅在明确的迁移说明中出现。

- [ ] **Step 4: 完成 STM32 实机模式对照**

默认 RSSI 模式下，串口临时输出 `EPC`、候选数、最佳 dBm、`selectedMs` 与最终 `0x12` 时间；完成至少三次单人和三次多人相邻过线。确认同一运动员每个窗口只产生一条 `0x12`，普通 EPC 与黑名单行为不变，停止后没有延迟 `0x12`。

将 `ACTIVE_SCORING_MODE` 临时切换为 `LegacyImmediate`，重复同一组测试，确认保险路径独立可用后恢复默认 `RssiPeak`。在 CurrentTask 记录读写器功率、天线位置、每次的样本数、模式差异和验收结论。

- [ ] **Step 5: 签入任务**

```text
git add ARCHITECTURE.md RFIDPollingNotes.md LORAProtocol-byte.md CurrentTask.md docs/superpowers/specs/2026-09-15-rssi-peak-scoring-design.md docs/superpowers/plans/2026-09-15-rssi-peak-scoring.md
git commit -m "docs: describe RSSI peak scoring mode"
```

## Plan Self-Review

- 覆盖性：计划包含帧级 RSSI 提取、独立窗口、默认/回退模式、唯一成绩表、停止清空、无协议改动、自动化测试、编译和实机对照。
- 占位检查：所有后续调用的 `RfidTagEvent`、`RssiScoreSelection`、`RssiAcceptResult`、`RssiScoringController` 和 `isAthleteEpc()` 都在前置任务中定义。
- 一致性：新模式只以选中 `detectedMs` 调用现有 `evaluateEpc()`；旧模式保持即时 `millis()` 调用，不会生成第二套成绩或不同的 `0x12` 格式。
