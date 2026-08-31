# AGENT 行动准则

该部分为关键行动准则。每次阅读、计划、编写或修改代码前，应优先参考本文档，并结合 `CurrentTask.md`、`ARCHITECTURE.md`、`LORAProtocol-byte.md`、`RFIDPollingNotes.md` 判断当前项目状态。



## 一. 基本规则

### 1. 书面语言

项目中所有文档、代码注释、串口调试提示优先使用中文编写。

涉及二进制协议、字节标识、命令名、字段名、宏名、函数名、类名、文件名时，按代码和协议需要使用英文或 ASCII。

### 2. 文档格式

编写和整理 Markdown 文档时，标题和其自身正文之间保持一行空行。一级标题、二级标题所属正文结束后，如果后面还有其他标题，应在正文和下一个标题之间保留三行空行。三级及以下标题所属正文结束后，与下一个标题之间保留一行空行。

如果用户提出的格式规则存在歧义，例如“标题间隔”没有明确指向标题后还是正文后，应先提出明确定义再修改文档。

协议文档、任务文档和架构文档应保持职责清晰，避免在任务文档中堆叠大段架构说明，避免在架构文档中记录临时待办。

短字节序列、字段格式和命令格式可直接使用纯文本行表达；仅在需要展示代码、命令或多行固定格式示例时使用代码块。

### 3. 项目平台

当前项目运行平台为 STM32 Arduino Core。编写代码时应避免使用 ESP32 专属能力，例如：

```cpp
WiFi.h
WebServer.h
LittleFS.h
ArduinoJson.h
HardwareSerial::onReceive()
```

如确需引入新库或平台能力，必须先确认其适用于 STM32 当前工程环境。

### 4. 当前工程边界

当前分支为 `DetectOnly`，核心目标是速度滑冰计时系统的检测侧精简固件。当前工程只负责控制 RFID 读写器、维护临时运动员列表和单次比赛成绩列表、执行 EPC 8 秒静默规则，并通过 LoRa 字节协议上报检测结果。

当前主要模块包括：

```text
SpeedSkatingTimer.ino
DetectionController.h
DetectProtocol.h
RFIDReader.h
LoraManager.h
config.h
```

除非用户明确要求，不要恢复完整计时主线中的 `AthleteManager`、`TimingLogic`、`StorageManager`、TF 卡存储、运动员姓名、排名、领滑、Web/WiFi/HTTP/JSON/LittleFS 等功能。


## 二. 编程行为准则

请在编写代码或整理计划时，按照以下准则行动：

### 1. 精准修改

只修改必要部分，保持代码整洁性。不要大规模重构无关代码，也不要无故触动核心逻辑。

如修改会影响以下核心链路，应先说明影响范围：

```text
RFID 读取 -> EPC 队列 -> DetectionController -> LoRa 上报
LoRa 字节命令 -> handleLoraCommand -> DetectionController/RFIDReader
DetectionController 临时表和成绩表 -> 0x11/0x12/0x13/0x14 返回
```

### 2. 简单优先

使用最少的代码解决问题，避免不必要的复杂性。

### 3. 保持思考

明确假设内容，不要隐藏困惑，主动提出问题。

如果认为用户提出的计划有问题/不足/隐患，或更好的方案，请主动提出。

### 4. 保持易读

依据项目已有风格命名。如果没有明确风格，默认按驼峰命名法命名。

每次修改或添加代码时，应在关键位置留下清晰、简短、中文注释。注释应解释原因或边界，不要重复代码表面含义。

### 5. 保留旧路径

对于硬件通信、协议切换、轮询模式、存储方案等高风险修改，如用户要求保守处理，应优先注释旧代码并标记，而不是直接删除。

建议标记示例：

```cpp
// LEGACY_MULTI_INVENTORY:
// 旧多次轮询路径保留，用于回退测试。
```

### 6. 测试状态

如果用户明确说明“测试完成后再标记完成”，则在用户确认前不得将该任务移入 `CurrentTask.md` 的已完成列表。

如果修改尚未经过 STM32 实机测试，应在总结中明确说明“未做实机验证”。

### 7. 文件编辑

手动修改文件时优先使用补丁方式，避免整文件重写导致无关内容丢失。

若发现用户已有调试代码、中文日志、临时注释或现场测试改动，不要擅自删除，除非该内容与当前任务冲突且已说明原因。

## 三. 项目关键规则

### 1. RFID 轮询模式

当前主流程使用 RFID 单次轮询模式。上一次实机测试中，多次轮询效果不理想，因此 `START` 和 `SCAN` 应调用 `startInventory()`，主循环应调用 `receiveTag()`。

主流程应使用：

```cpp
rfidReader.startInventory();
rfidReader.receiveTag();
```

当前含义：

1. STM32 在进入比赛或扫描模式时激活 RFID 读取状态。
2. 主循环调用 `receiveTag()`。
3. `receiveTag()` 内部主动发送单次盘点指令并读取响应。
4. 解析出的 EPC 进入队列。
5. 主循环再调用 `processDetectedTag()` 进行业务处理。

`startMultiInventory()` 和 `receiveTagMultiInventory()` 作为多次轮询备用路径保留，不应在未重新确认前恢复为主流程。

STM32 Arduino Core 不支持 ESP32 风格的 `HardwareSerial::onReceive()`，不要使用该接口。

### 2. RFID 业务处理边界

DetectOnly 的业务判断由 `DetectionController` 负责，包括临时运动员匹配、单次比赛成绩、黑名单匹配、普通 EPC 记录、圈数、单圈时长和总时长更新。`RFIDReader` 只负责 RFID 串口指令、响应解析和 EPC 队列，不应加入业务状态。

推荐保持以下结构：

```text
receiveTag() -> processFrame() -> EPC 队列
loop() -> readTagEvent() -> DetectionController 业务判断 -> LoRa 字节返回
```

### 3. LoRa 通信

LoRa 当前使用串口透传方式，不使用 SX127x SPI LoRa 库。

DetectOnly 当前只使用字节协议。协议变动必须同步维护：

```text
LORAProtocol-byte.md
```

`LORAProtocol.txt` 仅作为入口说明，指向 `LORAProtocol-byte.md`，不要在其中恢复旧文本协议。

此前提出的 `\x1E` 批量合并发送缓存方案已取消，不应在未重新确认前实现。

### 4. DetectOnly 临时数据边界

当前 DetectOnly 分支不使用 TF 卡、数据库、EEPROM 或动态运动员存储。所有运动员、运动员成绩、黑名单和普通 EPC 记录均为运行期固定数组临时数据。

`0x02` 结束检测成功后，应清空临时运动员、运动员成绩、黑名单、普通 EPC 8 秒记录和运动员成绩时钟。除非用户重新提出完整计时或保存需求，不要添加持久化保存路径。

### 5. 运动员 ID

DetectOnly 中运动员由 APP 通过 `0x10` 定义，协议载荷包含运动员标志、EPC 和运动员 ID。STM32 不生成运动员姓名，不保存运动员资料，也不维护旧主线的 `ADD/BIND/REMOVE` 文本命令。

运动员被定义成功后，STM32 先返回 `0xF0` 成功，再立即返回一条 `0x12` 运动员信息。第一名运动员会启动运动员成绩时钟，其圈数、单圈时长和总时长为 0，后续运动员按该成绩时钟初始化。



## 四. 核心文档

以下文档为项目核心文档，请勿随意添加/删除文档，并在合适的时间点进行更新维护。

### 计划文档：CurrentTask.md

该文档用于记录任务状态。添加、完成、取消计划时必须同步维护该文档。

`CurrentTask.md` 只记录任务，不应再次堆叠大段架构说明。

### 框架文档：ARCHITECTURE.md

该文档用于记录当前项目架构、模块职责、硬件连接和数据流。对实际架构或模块职责产生影响的修改完成后，应同步维护该文档。

## 五. 其他文档

### LORA协议文档：LORAProtocol-byte.md

该文档用于记录通过 LoRa 进行通信时使用的协议。协议字段、命令格式、返回格式发生变动时必须更新。

`LORAProtocol.txt` 仅保留 DetectOnly 协议入口说明，不作为旧文本协议维护入口。

### RFID功能记录文档：RFIDPollingNotes.md

该文档用于记录 RFID 功能、单次轮询与多次轮询模式说明。获知与 RFID 工作机制、硬件行为、轮询方式有关的新信息时，应更新维护该文档。

## 六. 回复与总结要求

完成修改后，应简要说明：

1. 修改了哪些文件。
2. 改动的核心行为。
3. 是否更新了相关文档。
4. 是否做过编译、静态检查或实机测试。
5. 如果存在风险或待验证点，应明确列出。

