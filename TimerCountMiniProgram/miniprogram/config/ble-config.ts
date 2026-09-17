// 蓝牙模块 BT04：当前广播名称。所有连接与状态文案都必须读取此变量。
export const BLE_DEVICE_NAME = 'ESP32-LORA-BRIDGE'
export const BLE_SERVICE_UUID = '0000FFE0-0000-1000-8000-00805F9B34FB'
export const BLE_COMMAND_RX_UUID = '0000FFE2-0000-1000-8000-00805F9B34FB'
export const BLE_NOTIFICATION_TX_UUID = '0000FFE1-0000-1000-8000-00805F9B34FB'
export const BLE_WRITE_CHUNK_SIZE = 20
export interface BleConnectionProfile {
  id: string
  name: string
  serviceUuid: string
  commandRxUuid: string
  notificationTxUuid: string
}

// BT04 当前默认档案；运行时连接配置由本地档案仓储提供。
export const DEFAULT_BLE_PROFILE: BleConnectionProfile = {
  id: 'default-bt04',
  name: BLE_DEVICE_NAME,
  serviceUuid: BLE_SERVICE_UUID,
  commandRxUuid: BLE_COMMAND_RX_UUID,
  notificationTxUuid: BLE_NOTIFICATION_TX_UUID,
}


// 当前使用的 UART UUID 映射。
// export const BLE_DEVICE_NAME = 'SKATING-TIMER'
// export const BLE_SERVICE_UUID = '6E400001-B5A3-F393-E0A9-E50E24DCCA9E'
// export const BLE_COMMAND_RX_UUID = '6E400002-B5A3-F393-E0A9-E50E24DCCA9E'
// export const BLE_NOTIFICATION_TX_UUID = '6E400003-B5A3-F393-E0A9-E50E24DCCA9E'
// export const BLE_WRITE_CHUNK_SIZE = 20
