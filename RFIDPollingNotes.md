# RFID 轮询模式说明

本文档记录当前 RFID 轮询策略，以及单次轮询和多次轮询的区别。



## 当前主流程

当前项目通过`config.h`中的`RFID_USE_PASSIVE_INVENTORY`选择轮询方式，默认值为`false`，使用非阻塞单次轮询。

上一次实机测试中多次轮询效果不理想，因此默认保留单次轮询；被动多次轮询作为实机对照路径。

当前主流程调用：

```cpp
rfidReader.startInventory();
rfidReader.poll();
```

使用位置：

- LoRa `COMMAND_START`
- LoRa `COMMAND_SCAN`
- 串口 `START`
- 串口 `SCAN`

主循环中，`poll()` 会读取 RFID 串口已有数据；主动模式还会在本轮结束后发送下一条单次盘点指令。



## 单次轮询

单次轮询由以下函数负责：

```cpp
RFIDReader::startInventory()
RFIDReader::poll()
```

当前含义：

1. `startInventory()` 在进入比赛或扫描模式时激活 RFID 读取状态。
2. `poll()` 在主循环中执行。
3. `poll()` 每次最多读取96字节已到达的串口数据，不等待数据到来。
4. 状态机在首次进入主动模式、收到空盘点帧，或标签帧静默20ms后发送单次盘点指令。
5. 无任何数据时，状态机在300ms超时后重试，不阻塞主循环。
6. STM32在完整帧校验成功时解析为`RfidTagEvent`，将EPC、`byte5`的有符号RSSI和该时刻`millis()`放入队列。
7. 主流程通过`readTagEvent()`取出事件并调用`processTagEvent()`。

当前业务处理仍保留在主循环中执行：

```cpp
processTagEvent(tagEvent);
```

原因是 `processTagEvent()` 包含串口输出、计时逻辑、LoRa 发送等较重操作，不适合放入串口接收事件或中断上下文中运行。


默认`RssiPeak`模式下，已定义运动员不立即计分：主循环按EPC聚合连续事件，同一EPC连续3次信号下降或最后一次信号后静默100ms时，以该段RSSI最高事件的接收时间交给`DetectionController`。RSSI相同时采用后一次事件。普通EPC和黑名单仍立即处理；`LegacyImmediate`模式则让全部事件沿用原即时计分路径。


## 多次轮询备用路径

本项目中“多次轮询”指 RFID 模块自身的持续扫描模式，不是 STM32 在 `loop()` 中反复发送轮询指令。

将`RFID_USE_PASSIVE_INVENTORY`设为`true`后，`RFIDReader::startInventory()`会发送多次盘点命令，`poll()`只读取已有串口数据。其含义为：

1. STM32 只发送一次“开始多次扫描”指令。
2. RFID 模块/天线进入持续扫描状态。
3. 之后只要天线扫描到标签，RFID 模块会自动通过串口引脚把标签数据发送给 STM32。
4. STM32 侧只需要持续读取 RFID 串口数据并解析 EPC。

多次盘点使用`0xFFFF`作为轮次数上限，并非永久运行。使用该模式前应确认读写器持续上报行为、串口数据帧完整性、队列是否溢出，以及达到轮次数上限后的重启策略。



## STM32 接收策略

STM32 Arduino Core 不支持 ESP32 风格的 `HardwareSerial::onReceive()` 用户回调。

当前项目采用主循环读取 RFID 数据的方式：

```cpp
rfidReader.poll();
```

主循环读取逻辑只做轻量处理：

1. 读取 RFID 串口已到达的数据，并按当前模式决定是否发送下一条盘点指令。
2. 组装完整帧。
3. 调用帧解析逻辑。
4. 将`RfidTagEvent`放入队列。

业务处理仍然留在主循环中执行，避免在串口接收路径中执行复杂逻辑。



## 注意事项

后续修改 RFID 扫描逻辑时，应先确认`RFID_USE_PASSIVE_INVENTORY`的取值。默认主动模式应保持：

```cpp
rfidReader.startInventory();
rfidReader.poll();
```

被动模式由配置切换，不应在主循环中额外重复发送多次盘点指令。
