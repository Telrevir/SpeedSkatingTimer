# DetectOnly Firmware Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有完整计时固件精简为只负责控制RFID、8秒EPC去重和LoRa上报的DetectOnly固件。

**Architecture:** 保留RFIDReader的硬件读写能力；新增无动态内存的DetectionController负责业务状态；重写LoraManager和主程序，只暴露确认后的6个协议命令。

**Tech Stack:** STM32 Arduino Core、STM32 HardwareSerial、现有RFID串口协议、LoRa串口透传。

## Global Constraints

- 协议只允许`0x01`、`0x02`、`0x03`、`0x04`、`0x13`、`0xF0`。
- 去重容量固定100，间隔固定8000毫秒。
- 8秒内重复EPC完全静默。
- 时间使用uint24大端序百分秒并在`0xFFFFFF`饱和。
- 不使用本地存储、运动员名单、圈数、排名或领滑逻辑。
- 关键边界使用简短中文注释，错误同时提供中文终端信息和`0xF0`状态码。

---

### Task 1: 检测业务状态与去重

**Files:**
- Create: `DetectionController.h`
- Create: `tests/DetectionControllerSelfTest/DetectionControllerSelfTest.ino`

**Interfaces:**
- Produces: `start(nowMs)`、`stop()`、`evaluateEpc(epc, nowMs)`、`elapsedCentiseconds(nowMs)`、`isRunning()`。

- [ ] 编写覆盖首次EPC、8秒静默、满8秒、100条容量、重复开始和时间饱和的失败测试。
- [ ] 运行测试或结构检查，确认缺少实现时失败。
- [ ] 使用固定数组完成最小实现，不使用`String`和堆分配。
- [ ] 运行测试并确认通过。

### Task 2: 精简LoRa协议

**Files:**
- Rewrite: `LoraManager.h`
- Create: `tests/LoraProtocolSelfTest/LoraProtocolSelfTest.ino`

**Interfaces:**
- Consumes: 控制命令回调。
- Produces: `sendRaceStatus(state)`、`sendDetectedEpc(epc, centiseconds)`、`sendStatus(sourceCommand, status)`。

- [ ] 编写6个命令ID、载荷长度、校验和、非法命令和错误状态的失败测试。
- [ ] 重写接收状态机和发送接口，删除全部运动员及文本协议代码。
- [ ] 验证协议示例字节与文档一致。

### Task 3: 精简RFID队列接口和主程序

**Files:**
- Modify: `RFIDReader.h`
- Rewrite: `SpeedSkatingTimer.ino`
- Modify: `config.h`

**Interfaces:**
- Consumes: `DetectionController`和`LoraManager`接口。
- Produces: 开始、结束、状态查询及EPC上报完整运行链路。

- [ ] 为队列清空、队列溢出状态和主业务引用边界编写失败结构测试。
- [ ] 增加显式队列清空/溢出查询接口。
- [ ] 重写主循环，仅在检测中读取RFID并处理EPC。
- [ ] 确认重复开始不改变运行状态，8秒重复不调用任何输出。

### Task 4: 清理旧依赖并验证

**Files:**
- Delete: `AthleteManager.h`
- Delete: `TimingLogic.h`
- Delete: `StorageManager.h`
- Update: `ARCHITECTURE.md`
- Update: `CurrentTask.md`

**Interfaces:**
- Produces: 无本地存储和运动员依赖的最终DetectOnly工程。

- [ ] 删除旧模块和不再适用的主业务引用。
- [ ] 静态扫描确认不存在旧协议ID、存储库、运动员或领滑符号。
- [ ] 运行全部自测试和`git diff --check`。
- [ ] 若本机存在可用STM32 Arduino构建工具则编译；否则明确记录未编译和未实机验证。
