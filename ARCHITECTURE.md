# DetectOnly 固件架构

## 系统职责

DetectOnly运行在STM32 Arduino Core上，只负责控制RFID检测、8秒EPC去重、比赛总时长计算和LoRa字节协议通信。运动员、圈数、排名、领滑和比赛结束判断均由APP处理。

## 硬件连接

```text
RFID TX -> STM32 PC7
RFID RX -> STM32 PC6
LoRa TXD -> STM32 PA3
LoRa RXD -> STM32 PA2
LoRa AUX -> STM32 PA1
```

## 模块

```text
SpeedSkatingTimer.ino    初始化与主循环调度
RFIDReader.h             RFID单次轮询、响应解析和EPC队列
DetectionController.h    运行状态、开始时间和100条EPC去重记录
DetectProtocol.h         协议常量、校验和和字节编码
LoraManager.h            LoRa协议收发状态机
config.h                 引脚、波特率和RFID命令
```

## 数据流

```text
APP控制包
-> LoraManager
-> SpeedSkatingTimer
-> DetectionController / RFIDReader
-> 0xF0或0x04响应

RFID响应
-> RFIDReader EPC队列
-> DetectionController 8秒去重
-> LoraManager 0x13 EPC事件
-> APP
```

## 关键边界

- RFIDReader不判断8秒重复，只上报硬件检测事件。
- DetectionController不执行硬件或LoRa操作。
- LoraManager不维护比赛状态或EPC去重数据。
- 8秒内重复EPC完全静默。
- 固件不初始化TF卡，也没有本地存储路径。
