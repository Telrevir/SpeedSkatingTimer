# DetectOnly固件架构

## 系统职责

DetectOnly运行在STM32 Arduino Core上，负责RFID检测、临时运动员名单、单次比赛成绩、EPC黑名单、两套8秒去重，以及LoRa字节协议通信。所有比赛数据只存在于内存，不访问TF卡或数据库。

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
RfidTagEvent.h           RFID事件的EPC、RSSI和完整帧接收时间
RssiScoringController.h  已定义运动员的RSSI峰值窗口，只选择计分时间
DetectionController.h    运动员成绩时钟、四张50槽列表、圈数、单圈时长、近10圈历史、名次和8秒规则
DetectProtocol.h         命令常量、大小端读写、Payload和数据包编码
LoraManager.h            LoRa收发状态机和命令Payload长度检查
config.h                 引脚、波特率和RFID命令
```

## 内存数据

`DetectionController`集中维护：

- 50条临时运动员记录；
- 50条单次比赛成绩记录；
- 每名运动员10条、每条7字节的近10圈固定环形历史；
- 50条EPC黑名单记录；
- 50条普通EPC 8秒记录；
- 首个运动员确认后启动的运动员成绩时钟。

每张表均使用固定数组和`enabled`字段，不使用动态内存。`0x02`成功结束后清空全部临时数据。

`RssiScoringController`另外维护50项短时RSSI候选窗口，不保存成绩；其候选窗口在开始和结束检测时清空。

## 数据流

```text
APP命令包
→ LoraManager校验数据包和Payload长度
→ SpeedSkatingTimer分派0x01、0x02、0x03、0x10、0x11
→ DetectionController / RFIDReader
→ LoraManager发送0x04、0x12、0x13、0x14、0x15或0xF0

RFID响应
→ RFIDReader RfidTagEvent队列（EPC、RSSI、完整帧接收时间）
→ SpeedSkatingTimer按`config.h`选择计分模式
→ `LegacyImmediate`：立即交给DetectionController
→ `RssiPeak`：已定义运动员按EPC聚合，连续3次信号下降或静默100ms后取该段最高RSSI样本的接收时间
→ DetectionController按黑名单、运动员、普通EPC顺序判断
→ 黑名单或8秒重复：静默
→ 运动员：更新圈数、单圈时长和总时长，按圈数、总用时、有效扫描顺序计算即时名次，写入近10圈历史并发送0x12
→ 普通EPC：发送0x14

APP发送0x11
→ STM32发送0x13开始
→ 对每名运动员依次发送0x12当前快照和0x15近10圈历史
→ STM32发送0x13结束
```

## 关键边界

- `RssiScoringController`不维护成绩、8秒静默或LoRa状态，只为已定义运动员选择提交给`DetectionController`的时间。
- `RFIDReader`不处理运动员、黑名单和8秒业务。
- `DetectionController`不执行硬件或LoRa操作。
- `LoraManager`不维护比赛和运动员状态。
- 临时运动员记录只负责EPC匹配和8秒静默，单次比赛成绩记录负责保存运动员ID、圈数、单圈时长、总时长和10条固定字节历史。
- 近10圈历史每条为圈数`uint16`、名次`uint16`、总用时`uint24`，均为大端序；第11条覆盖最早一条，导出时恢复为最早到最新。
- 历史名次仅在有效过线时计算一次：圈数高者优先、总用时短者优先、有效扫描顺序早者优先；后续其他运动员过线不回写旧历史。
- 第一名运动员的初始圈数、单圈时长和总时长均为0；后续运动员共用首个运动员确认时启动的成绩时钟。
- `config.h`默认使用`RssiPeak`；将`ACTIVE_SCORING_MODE`改为`LegacyImmediate`可恢复原即时计分保险路径。
- 普通EPC和运动员分别维护8秒记录，静默路径不发送协议也不输出日志。
- 固件不包含持久化存储、姓名、排名、领滑和RESET业务。
