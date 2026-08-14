# DetectOnly固件架构

## 系统职责

DetectOnly运行在STM32 Arduino Core上，负责RFID检测、临时运动员名单、EPC黑名单、两套8秒去重、运动员圈数和总时长，以及LoRa字节协议通信。所有比赛数据只存在于内存，不访问TF卡或数据库。

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
SpeedSkatingTimer.ino    初始化、命令调度和EPC事件发送
RFIDReader.h             RFID轮询、帧校验、EPC接收队列
DetectionController.h    比赛时钟、三张50槽列表、圈数和8秒规则
DetectProtocol.h         命令常量、大小端读写、Payload和数据包编码
LoraManager.h            LoRa收发状态机和命令Payload长度检查
config.h                 引脚、波特率和RFID命令
```

## 内存数据

`DetectionController`集中维护：

- 50条临时运动员记录；
- 50条EPC黑名单记录；
- 50条普通EPC 8秒记录；
- 比赛开始时间和第一名运动员建立的统一时间偏移量。

每张表均使用固定数组和`enabled`字段，不使用动态内存。`0x02`成功结束后清空全部临时数据。

## 数据流

```text
APP命令包
→ LoraManager校验数据包和Payload长度
→ SpeedSkatingTimer分派0x01、0x02、0x03、0x10、0x11
→ DetectionController / RFIDReader
→ LoraManager发送0x04、0x12、0x13、0x14或0xF0

RFID响应
→ RFIDReader EPC队列
→ DetectionController按黑名单、运动员、普通EPC顺序判断
→ 黑名单或8秒重复：静默
→ 运动员：更新圈数和总时长，发送0x12
→ 普通EPC：发送0x14
```

## 关键边界

- `RFIDReader`不处理运动员、黑名单和8秒业务。
- `DetectionController`不执行硬件或LoRa操作。
- `LoraManager`不维护比赛和运动员状态。
- 第一名运动员的初始圈数和总时长均为0；后续运动员共用其时间偏移量。
- 普通EPC和运动员分别维护8秒记录，静默路径不发送协议也不输出日志。
- 固件不包含持久化存储、姓名、排名、领滑和RESET业务。
