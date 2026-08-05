# SpeedSkatingTimer 架构说明

## 项目定位

本项目是基于 STM32 的速度滑冰计时系统。系统通过 RFID 读写模块识别运动员标签，通过计时逻辑记录圈数、圈速和领滑状态，通过 LoRa 模块与外部设备交换控制命令和比赛数据，并通过 TF 卡保存运动员数据。

当前主控平台为 STM32，代码基于 Arduino 风格工程组织。



## 顶层结构

主入口文件：

```text
SpeedSkatingTimer.ino
```

主要模块：

```text
config.h              硬件引脚、系统参数、RFID 指令配置
AthleteManager.h      运动员数据模型与增删改查
TimingLogic.h         比赛计时、圈数、领滑和套圈判断
RFIDReader.h          RFID 串口通信、EPC 解析、单次轮询接收
LoraManager.h         LoRa 串口通信、命令解析、数据包生成
StorageManager.h      TF 卡运动员数据保存与读取
LORAProtocol.txt      LoRa 通信协议说明
RFIDPollingNotes.md   RFID 单次轮询与多次轮询模式说明
CurrentTask.md        当前任务状态和后续待办
```



## 硬件连接

### RFID

配置位于 `config.h`：

```cpp
#define RFID_SERIAL_RX PC7
#define RFID_SERIAL_TX PC6
#define RFID_BAUDRATE 115200
```

接线含义：

```text
RFID TX -> STM32 PC7
RFID RX -> STM32 PC6
```

### LoRa

配置位于 `config.h`：

```cpp
#define LORA_SERIAL_RX PA3
#define LORA_SERIAL_TX PA2
#define LORA_AUX_PIN PA1
#define LORA_BAUD_RATE 9600
```

接线含义：

```text
LoRa TXD -> STM32 PA3
LoRa RXD -> STM32 PA2
LoRa AUX -> STM32 PA1
```

### TF 卡

存储模块使用 `STM32SD.h`。当前采用 SDIO/SDMMC 方案，文件操作集中在 `StorageManager.h`。

## 主程序职责

`SpeedSkatingTimer.ino` 负责系统编排：

1. 初始化串口、存储、RFID、LoRa。
2. 从 TF 卡加载运动员数据。
3. 如果加载失败，写入示例运动员数据。
4. 在 `loop()` 中处理 RFID 标签、串口命令、LoRa 接收。
5. 在检测到有效标签后调用计时逻辑，并发送 LoRa 数据。

全局核心对象：

```cpp
AthleteManager athleteManager;
RFIDReader rfidReader;
TimingLogic timingLogic(&athleteManager);
StorageManager storageManager;
LoraManager loraManager;
```



## 主循环流程

`loop()` 的核心流程：

```text
如果处于扫描/比赛/等待开始状态：
  1. 从 EPC 队列取出一个 EPC
  2. 调用 processDetectedTag(epc)
  3. 调用 receiveTag() 发送单次盘点指令并读取 RFID 响应

处理 USB 串口命令
处理 LoRa 接收命令
yield()
```

注意：当前 RFID 主流程已恢复为单次轮询模式。多次轮询在上一次实机测试中效果不理想，因此暂不作为主路径使用。



## RFID 模块

实现文件：

```text
RFIDReader.h
```

当前主流程使用单次轮询：

```cpp
rfidReader.startInventory();
rfidReader.receiveTag();
```

含义：

1. `START` 或 `SCAN` 时调用 `startInventory()` 激活 RFID 读取状态。
2. 主循环调用 `receiveTag()`。
3. `receiveTag()` 内部主动发送单次盘点指令并等待响应。
4. STM32 解析响应帧并将 EPC 放入队列。

解析出的 EPC 会进入全局 EPC 队列：

```cpp
EPCEnqueue(...)
EPCDequeue()
```

主程序再通过：

```cpp
rfidReader.readTagEvent()
```

取出 EPC 并调用：

```cpp
processDetectedTag(epc)
```

`startMultiInventory()` 和 `receiveTagMultiInventory()` 仍作为多次轮询备用路径保留，并用 `LEGACY_MULTI_INVENTORY` 注释标记。



## 计时模块

实现文件：

```text
TimingLogic.h
```

主要职责：

1. 管理比赛状态：未开始、等待运动员、进行中、领滑结束。
2. 根据 RFID EPC 记录运动员通过。
3. 计算圈数、总用时、单圈时间。
4. 使用 `MIN_LAP_INTERVAL` 防止同一标签短时间重复计圈。
5. 计算当前领滑运动员。
6. 判断套圈状态。
7. 在领滑结束阶段锁定达到目标圈数的运动员成绩。

比赛状态取值：

```text
0x00 未开始
0x01 等待运动员
0x02 进行中
0x03 领滑结束
```

`STOP` 命令不再立即关闭 RFID。存在有效领滑运动员时，系统进入 `领滑结束` 状态，记录当前领滑圈数作为目标圈数；达到目标圈数的运动员会被锁定，不再更新成绩。领滑结束超过五分钟后，主程序关闭计时和 RFID，但比赛状态保持为 `领滑结束`，直到 `RESET` 回到 `未开始`。

关键配置：

```cpp
#define MIN_LAP_INTERVAL 8000
```



## 运动员管理

实现文件：

```text
AthleteManager.h
```

核心数据结构：

```cpp
struct Athlete {
  String id;
  String name;
  String epc;
  int lapCount;
  unsigned long startTime;
  unsigned long lastTime;
  unsigned long totalTime;
  unsigned long lastDetectedTime;
  int rank;
  bool resultLocked;
  LapTime lapTimes[MAX_LAPS];
  bool isActive;
};
```

`AthleteManager` 提供：

```cpp
addAthlete()
removeAthlete()
editAthlete()
getAthleteByEPC()
getAthleteByID()
bindEpcToAthlete()
unbindEpcFromAthlete()
getEpcListForAthlete()
clearAthletes()
getAthletes()
getAthleteCount()
```

新增运动员时，主程序通过 `generateNextAthleteId()` 自动生成三位补零 ID。串口 `ADD` 和 LoRa `COMMAND_ADD` 均不再由外部输入 ID。

EPC 标签与运动员基础资料分离管理。运动员结构保留主 EPC 字段用于兼容旧协议，实际识别链路使用独立 EPC 绑定表：

```text
扫描 EPC -> EpcBinding(epc, athleteId) -> Athlete(id)
```



## LoRa 模块

实现文件：

```text
LoraManager.h
```

LoRa 使用串口透传方式，不使用 SX127x SPI LoRa 库。

主要职责：

1. 初始化 LoRa 串口。
2. 发送比赛数据、扫描数据、运动员列表、命令回复。
3. 接收 LoRa 命令。
4. 解析命令并回调主程序执行。

接收命令包括：

```text
COMMAND_START
COMMAND_SCAN
COMMAND_STOP
COMMAND_RESET
COMMAND_RACE_STATUS
COMMAND_ADD
COMMAND_REMOVE
COMMAND_BIND
COMMAND_BIND_EPC
COMMAND_UNBIND_EPC
COMMAND_GET_EPCS
COMMAND_LIST
```

当前 LoRa 处于双协议过渡期：

```text
文本协议：仍可接收 COMMAND_START / COMMAND_ADD 等旧命令
字节协议：已新增 0xAA 包头、命令ID、长度、Payload、checksum、0xF9 包尾的收发路径
```

当前成绩、领滑、运动员信息、列表状态和通用回复优先通过字节包发送。字节协议尚未经过 STM32 与 ESP32 联调验证，当前仍保留文本协议入口作为过渡测试路径。



## LoRa 命令执行

LoRa 命令由 `LoraManager` 解析为：

```cpp
struct LoraCommand {
  String type;
  String id;
  String name;
  String epc;
};
```

然后回调：

```cpp
handleLoraCommand(const LoraCommand& command)
```

主程序根据命令执行：

```text
START   -> startRace + startInventory + sendRaceStatus
SCAN    -> scanningMode + startInventory
STOP    -> beginLeaderFinish；无有效领滑时安全停机
RESET   -> resetRaceData + stopInventory + sendRaceStatus
ADD     -> 自动生成 ID + addAthlete + saveAthletes
REMOVE  -> removeAthlete + saveAthletes
BIND    -> editAthlete 或 addAthlete，并确保该 EPC 已绑定 + saveAthletes
BIND_EPC -> bindEpcToAthlete + saveAthletes
UNBIND_EPC -> unbindEpcFromAthlete + saveAthletes
GET_EPCS -> sendAthleteEpcList
LIST    -> sendAthleteListLora
RACE_STATUS -> sendRaceStatus
```



## 存储模块

实现文件：

```text
StorageManager.h
```

当前存储方案：

```text
TF 卡 + STM32SD.h
```

运动员数据文件：

```text
athletes.csv
epc_bindings.csv
```

备份文件：

```text
athletes_bak.csv
```

临时文件：

```text
athletes_tmp.csv
```

保存格式为三段分号分隔：

```text
<ID>;<NAME_HEX>;<EPC>
```

`athletes.csv` 保存运动员基础资料和主 EPC 兼容字段，其中 `NAME_HEX` 是姓名 UTF-8 原始字节的十六进制文本。例如：

```text
004;E5BCA0E4B889;3333F337
```

`epc_bindings.csv` 保存独立 EPC 绑定列表：

```text
<EPC>;<ID>
```

例如：

```text
3333F337;004
4444F337;004
```

读取时会将第二段十六进制还原为 UTF-8 字符串。

当前 `STM32SD` 环境不支持 `SD.rename()`，所以保存采用：

```text
备份旧 athletes.csv -> 直接写 athletes.csv -> 失败时从 athletes_bak.csv 恢复
```



## 数据流

### RFID 到计时

```text
RFID 模块
  -> STM32 UART
  -> RFIDReader::receiveTag()
  -> processFrame()
  -> EPCQueue
  -> SpeedSkatingTimer.loop()
  -> processDetectedTag()
  -> TimingLogic::recordLap()
```

### 计时到 LoRa

```text
TimingLogic::recordLap()
  -> sendAthleteDataLora()
  -> LoraManager::sendAthleteData()
  -> LoRa 串口发送
```

领滑运动员变化时：

```text
TimingLogic::getCurrentLeader()
  -> sendLeaderDataLoraIfChanged()
  -> LoraManager::sendLeaderData()
```

### LoRa 到控制命令

```text
LoRa 模块
  -> LoraManager::handleReceive()
  -> processCommand()
  -> handleLoraCommand()
  -> TimingLogic / RFIDReader / AthleteManager / StorageManager
```

### 运动员数据持久化

```text
ADD / REMOVE / BIND
  -> AthleteManager 更新
  -> StorageManager::saveAthletes()
  -> TF 卡 athletes.csv
```

启动时：

```text
setup()
  -> StorageManager::loadAthletes()
  -> AthleteManager
```

## 串口调试命令

主串口支持：

```text
START
STOP
RESET
LIST
ADD,name,epc
BIND,id,name,epc
REMOVE,id
SCAN
TEST
RFIDDEBUG
STORAGE
FILES
SAVE
LOAD
```

其中：

- `START` 和 `SCAN` 使用 RFID 单次轮询模式。
- `ADD` 自动生成运动员 ID。
- `BIND` 和 `REMOVE` 仍需要指定运动员 ID。



## 当前边界与待办

当前仍保留的重要待办：

1. LoRa 字节协议和 `LORA,<hex bytes>` 串口调试入口需要 STM32 与 ESP32 联调验证。
2. `StorageManager::loadAthletes()` 后续应避免在确认有效数据前清空当前内存数据。
3. `StorageManager` 文件格式校验需要加强。
4. 保存前需检查 `id`、`name`、`epc` 是否包含破坏分号分隔格式的字符。

已取消方案：

- LoRa 发送缓存区与 `\x1E` 批量合并发送方案已取消。测试显示 LoRa 发送耗时与包长度强相关，后续优先通过压缩协议长度优化。
