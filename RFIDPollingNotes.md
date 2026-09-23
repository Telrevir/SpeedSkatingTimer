# RFID 轮询模式说明

本文档记录当前 RFID 轮询策略，以及单次轮询和多次轮询的区别。



## 当前主流程

当前项目主流程已恢复为 RFID 单次轮询模式。

恢复原因：上一次实机测试中，多次轮询效果不理想。为保证测试稳定性，当前 `START` 和 `SCAN` 均使用单次轮询路径。

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

主循环中，`poll()` 会主动发送单次盘点指令，并读取 RFID 模块返回的数据帧。



## 单次轮询

单次轮询由以下函数负责：

```cpp
RFIDReader::startInventory()
RFIDReader::poll()
```

当前含义：

1. `startInventory()` 在进入比赛或扫描模式时激活 RFID 读取状态。
2. `poll()` 在主循环中执行。
3. `poll()` 内部主动发送单次盘点指令。
4. RFID 模块返回当前扫描到的标签数据。
5. STM32在完整帧校验成功时解析为`RfidTagEvent`，将EPC、`byte5`的有符号RSSI和该时刻`millis()`放入队列。
6. 主流程通过`readTagEvent()`取出事件并调用`processTagEvent()`。

当前业务处理仍保留在主循环中执行：

```cpp
processTagEvent(tagEvent);
```

原因是 `processTagEvent()` 包含串口输出、计时逻辑、LoRa 发送等较重操作，不适合放入串口接收事件或中断上下文中运行。


默认`RssiPeak`模式下，已定义运动员不立即计分：主循环按EPC聚合连续事件，同一EPC连续3次信号下降或最后一次信号后静默100ms时，以该段RSSI最高事件的接收时间交给`DetectionController`。RSSI相同时采用后一次事件。普通EPC和黑名单仍立即处理；`LegacyImmediate`模式则让全部事件沿用原即时计分路径。


## 多次轮询备用路径

本项目中“多次轮询”指 RFID 模块自身的持续扫描模式，不是 STM32 在 `loop()` 中反复发送轮询指令。

多次轮询相关函数包括：

```cpp
RFIDReader::startMultiInventory()
RFIDReader::receiveTagMultiInventory()
```

其原始设计含义：

1. STM32 只发送一次“开始多次扫描”指令。
2. RFID 模块/天线进入持续扫描状态。
3. 之后只要天线扫描到标签，RFID 模块会自动通过串口引脚把标签数据发送给 STM32。
4. STM32 侧只需要持续读取 RFID 串口数据并解析 EPC。

当前 `startMultiInventory()` 和 `receiveTagMultiInventory()` 仅作为备用路径保留，不作为主流程使用。

如果后续重新测试多次轮询，应先确认 RFID 模块持续上报行为、串口数据帧完整性和主循环处理节奏，再决定是否恢复。



## STM32 接收策略

STM32 Arduino Core 不支持 ESP32 风格的 `HardwareSerial::onReceive()` 用户回调。

当前项目采用主循环读取 RFID 数据的方式：

```cpp
rfidReader.poll();
```

主循环读取逻辑只做轻量处理：

1. 发送或读取 RFID 轮询数据。
2. 组装完整帧。
3. 调用帧解析逻辑。
4. 将`RfidTagEvent`放入队列。

业务处理仍然留在主循环中执行，避免在串口接收路径中执行复杂逻辑。



## 注意事项

后续修改 RFID 扫描逻辑时，应先区分当前目标是单次轮询还是多次轮询。

当前主流程应优先保持：

```cpp
rfidReader.startInventory();
rfidReader.poll();
```

不要在未重新确认前将主流程恢复为：

```cpp
rfidReader.startMultiInventory();
rfidReader.receiveTagMultiInventory();
```
