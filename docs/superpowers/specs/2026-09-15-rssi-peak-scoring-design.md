# RSSI Peak Scoring Design

## Goal

在不删除现有即时计分路径的前提下，增加基于 RFID 通知帧 RSSI 峰值的运动员过线确认模块。默认启用新模块；通过 `config.h` 的固定配置可恢复原即时路径。



## Scope

本功能只改变已定义运动员 RFID 读数的确认时刻。RFIDReader 继续负责串口帧解析和事件队列；DetectionController 继续负责 EPC 匹配、8 秒静默、圈数、单圈时长、总时长和成绩表；LoRa 仍使用既有 `0x12` 九字节 Payload。

普通 EPC 和黑名单不进入 RSSI 聚合，保持即时处理。不会增加持久化、动态内存、APP 命令或 LoRa 命令。



## Event Model

新建不依赖 Arduino 串口的 `RfidTagEvent.h`，由 RFIDReader 和 RSSI 计分模块共同使用：

```cpp
struct RfidTagEvent {
  uint32_t epc;
  int8_t rssiDbm;
  uint32_t detectedMs;
};
```

`rssiDbm` 从通知帧 `byte5` 读取并按 `int8_t` 解释，例如 `0xC9` 为 `-55 dBm`。`detectedMs` 在完整帧校验成功的瞬间记录，而不是在主循环稍后出队时记录。



## Scoring Modes

`config.h` 定义两个模式和一个默认选择：

```cpp
enum class ScoringMode : uint8_t {
  LegacyImmediate,
  RssiPeak
};

constexpr ScoringMode ACTIVE_SCORING_MODE = ScoringMode::RssiPeak;
constexpr uint32_t RSSI_PEAK_IDLE_TIMEOUT_MS = 100UL;
```

`LegacyImmediate` 是原保险路径：每条读取事件立即调用 `DetectionController::evaluateEpc(epc, millis())`，保留当前对外行为。

`RssiPeak` 是默认路径：已定义运动员的事件按 EPC 分别聚合为一个信号段。相邻事件的 RSSI 连续3次下降时立即结算；最后一次事件后100ms没有新事件时也结算。结算时使用该段最高RSSI样本的 `detectedMs` 调用 `evaluateEpc()`；最高RSSI相等时取后一次样本，保证峰顶平台使用离开前的时间。每名运动员只维护一个候选，最多50项，使用固定数组。



## Data Flow

```text
RFID 通知帧
-> RFIDReader 解析为 RfidTagEvent
-> 主循环按配置选择路径
-> LegacyImmediate: 立即交给 DetectionController
-> RssiPeak: 已定义运动员进入 RssiScoringController
-> 连续3次下降或静默100ms，取最高 RSSI 的 detectedMs
-> DetectionController 更新成绩
-> 既有 LoRa 0x12 上报
```

主循环不得使用阻塞式延时。每轮在读取事件前后调用 RSSI 模块的静默到期清理函数；这样即使 `RFIDReader::poll()` 或队列处理带来延迟，计分仍使用候选样本的原始接收时间。



## Safety And Reset

开始检测前和结束检测后都清空 RSSI 窗口。停止时不结算尚未到期的窗口，以维持“结束检测后不再产生新成绩”的语义。

RSSI 模块不维护运动员成绩、8 秒静默或 LoRa 状态，因此切换配置项不会产生两套成绩表。它只选择哪个 RFID 接收时间可提交给既有计分模块。



## Verification

- 纯 C++ 自测覆盖连续3次下降、RSSI 最大值和相等峰顶、不同 EPC 并行、100ms 静默边界、跨 `millis()` 回绕和停止清空。
- DetectionController 自测验证使用峰值样本时间计算总时长和单圈时长。
- STM32 实机记录同一过线过程中的 EPC、RSSI、接收时间、选中样本及最终 `0x12`，确认连续下降与100ms静默均能正确结算，并比较新旧模式的成绩。
