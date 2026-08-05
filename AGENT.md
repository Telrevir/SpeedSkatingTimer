# AGENT 行动准则

该部分为关键行动准则。每次阅读、计划、编写或修改代码前，应优先参考本文档，并结合 `CurrentTask.md`、`ARCHITECTURE.md`、`LORAProtocol.txt`、`RFIDPollingNotes.md` 判断当前项目状态。



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

当前项目核心目标是速度滑冰计时系统，主要模块包括：

```text
SpeedSkatingTimer.ino
AthleteManager.h
TimingLogic.h
RFIDReader.h
LoraManager.h
StorageManager.h
config.h
```

除非用户明确要求，不要恢复 Web/WiFi/HTTP/JSON/LittleFS 相关功能。


## 二. 编程行为准则

请在编写代码或整理计划时，按照以下准则行动：

### 1. 精准修改

只修改必要部分，保持代码整洁性。不要大规模重构无关代码，也不要无故触动核心逻辑。

如修改会影响以下核心链路，应先说明影响范围：

```text
RFID 读取 -> EPC 队列 -> processDetectedTag -> TimingLogic
LoRa 命令 -> handleLoraCommand -> AthleteManager/StorageManager/RFIDReader
AthleteManager -> StorageManager -> TF 卡 athletes.csv
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

`processDetectedTag()` 包含串口输出、运动员查找、计时逻辑、LoRa 发送等较重操作，不应放入串口接收回调或中断上下文。

推荐保持以下结构：

```text
receiveTag() -> processFrame() -> EPC 队列
loop() -> readTagEvent() -> processDetectedTag()
```

### 3. LoRa 通信

LoRa 当前使用串口透传方式，不使用 SX127x SPI LoRa 库。

LoRa 协议变动必须同步维护：

```text
LORAProtocol.txt
```

当前发送包仍允许保留字段名。后续待办是使用字节规范协议压缩包长度。

此前提出的 `\x1E` 批量合并发送缓存方案已取消，不应在未重新确认前实现。

### 4. StorageManager 存储格式

当前运动员数据保存在 TF 卡：

```text
athletes.csv
```

`athletes.csv` 当前保存格式：

```text
<ID>;<NAME_HEX>;<EPC>
```

其中 `NAME_HEX` 是姓名 UTF-8 原始字节转成的十六进制文本。

不要恢复 JSON、LittleFS 或 EEPROM 旧方案。

当前 `STM32SD` 环境不支持 `SD.rename()`，保存流程应保持为备份旧主文件、直接写主文件、失败时从备份恢复。

### 5. 运动员 ID

新增运动员时，外部不再输入 ID。系统自动生成三位补零 ID：

```text
001
002
003
```

串口新增格式：

```text
ADD,name,epc
```

LoRa 新增格式：

```text
COMMAND_ADD;<运动员姓名>;<EPC>
```

`BIND` 和 `REMOVE` 仍需要指定运动员 ID。



## 四. 核心文档

以下文档为项目核心文档，请勿随意添加/删除文档，并在合适的时间点进行更新维护。

### 计划文档：CurrentTask.md

该文档用于记录任务状态。添加、完成、取消计划时必须同步维护该文档。

`CurrentTask.md` 只记录任务，不应再次堆叠大段架构说明。

### 框架文档：ARCHITECTURE.md

该文档用于记录当前项目架构、模块职责、硬件连接和数据流。对实际架构或模块职责产生影响的修改完成后，应同步维护该文档。

## 五. 其他文档

### LORA协议文档：LORAProtocol.txt

该文档用于记录通过 LoRa 进行通信时使用的协议。协议字段、命令格式、返回格式发生变动时必须更新。

### RFID功能记录文档：RFIDPollingNotes.md

该文档用于记录 RFID 功能、单次轮询与多次轮询模式说明。获知与 RFID 工作机制、硬件行为、轮询方式有关的新信息时，应更新维护该文档。

## 六. 回复与总结要求

完成修改后，应简要说明：

1. 修改了哪些文件。
2. 改动的核心行为。
3. 是否更新了相关文档。
4. 是否做过编译、静态检查或实机测试。
5. 如果存在风险或待验证点，应明确列出。

