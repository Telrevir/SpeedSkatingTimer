# BT04-E 标准固件 UUID 迁移设计

## 目标

把小程序的 BLE GATT 映射从 ESP32 自定义 128 位 UUID 改为 BT04-E 标准固件默认的 16 位 UUID（以 Bluetooth Base UUID 形式传给微信 BLE API），同时保持设备名称、业务帧协议和分片规则不变。

## 已批准映射

- Service：`0000FFE0-0000-1000-8000-00805F9B34FB`
- APP 写入：`0000FFE2-0000-1000-8000-00805F9B34FB`
- 模块通知：`0000FFE1-0000-1000-8000-00805F9B34FB`

BT04-E 串口侧继续透明传输现有 `AA + command + length + payload + checksum + F9` 业务帧。小程序继续按最多 20 字节顺序写入，不改变上层比赛协议。

安装前用 `AT+UUID`、`AT+CHAR`、`AT+WRITE` 查询实物；如果结果不是 `FFE0`、`FFE1`、`FFE2`，以 nRF Connect 发现的实际 GATT 为准，不猜测特征映射。

## 验收

- 自动化测试证明连接过程查询 FFE0、订阅 FFE1、发送数据到 FFE2。
- 原协议、排名、比赛状态和存储测试不受影响。
- TypeScript 类型检查通过。
