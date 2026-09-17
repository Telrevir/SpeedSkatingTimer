import { TargetDeviceNotFoundError } from '../domain/race-state'

const DEVICE_DISCOVERY_TIMEOUT_MS = 20_000

export interface BleDevice {
  deviceId: string
  name: string
}

export interface BleGattService {
  uuid: string
}

export interface BleGattCharacteristic {
  uuid: string
  properties: {
    write: boolean
    writeNoResponse?: boolean
    notify: boolean
  }
}

export interface BleCharacteristicValueEvent {
  deviceId: string
  serviceId: string
  characteristicId: string
  value: Uint8Array
}

export interface BleConnectionStateEvent {
  deviceId: string
  connected: boolean
}

export interface WechatBluetoothApi {
  openAdapter(): Promise<void>
  startDiscovery(): Promise<void>
  waitForDevice(name: string): Promise<BleDevice>
  stopDiscovery(): Promise<void>
  createConnection(deviceId: string): Promise<void>
  getServices(deviceId: string): Promise<BleGattService[]>
  getCharacteristics(deviceId: string, serviceId: string): Promise<BleGattCharacteristic[]>
  enableNotifications(deviceId: string, serviceId: string, characteristicId: string): Promise<void>
  writeCharacteristic(
    deviceId: string,
    serviceId: string,
    characteristicId: string,
    value: Uint8Array,
  ): Promise<void>
  onCharacteristicValue(listener: (event: BleCharacteristicValueEvent) => void): void
  onConnectionStateChange(listener: (event: BleConnectionStateEvent) => void): void
  closeConnection(deviceId: string): Promise<void>
}

export class WechatBluetoothApiAdapter implements WechatBluetoothApi {
  async openAdapter(): Promise<void> {
    await wx.openBluetoothAdapter({ mode: 'central' })
  }

  async startDiscovery(): Promise<void> {
    await wx.startBluetoothDevicesDiscovery({
      // 为排查 Android/微信对 BT04-E 广播的可见性，使用最高扫描强度并立即重复上报。
      allowDuplicatesKey: false,
      interval: 0,
      powerLevel: 'high',
    })
  }

  waitForDevice(name: string): Promise<BleDevice> {
    return new Promise((resolve, reject) => {
      const cachedDevicesTimeoutId = setTimeout(() => {
        void this.logCachedDevices(name)
      }, DEVICE_DISCOVERY_TIMEOUT_MS / 2)
      const timeoutId = setTimeout(() => {
        clearTimeout(cachedDevicesTimeoutId)
        wx.offBluetoothDeviceFound()
        reject(new TargetDeviceNotFoundError(name))
      }, DEVICE_DISCOVERY_TIMEOUT_MS)
      const listener: WechatMiniprogram.OnBluetoothDeviceFoundCallback = (result) => {
        // 使用 warn 而非 info，避免开发者工具仅显示“警告和错误”时漏掉扫描回调。
        console.warn(`[BLE ${new Date().toISOString()}] 扫描回调（${result.devices.length} 台）`,
          result.devices.map((device) => ({
            deviceId: device.deviceId,
            name: device.name,
            localName: device.localName,
            nameMatches: device.name === name,
            localNameMatches: device.localName === name,
          })))
        const match = result.devices.find((device) =>
          device.name === name || device.localName === name)
        if (!match) {
          return
        }
        clearTimeout(timeoutId)
        clearTimeout(cachedDevicesTimeoutId)
        wx.offBluetoothDeviceFound()
        resolve({ deviceId: match.deviceId, name })
      }
      wx.onBluetoothDeviceFound(listener)
    })
  }

  private async logCachedDevices(name: string): Promise<void> {
    try {
      const result = await wx.getBluetoothDevices()
      console.warn(`[BLE ${new Date().toISOString()}] 10 秒缓存设备列表（${result.devices.length} 台）`,
        result.devices.map((device) => ({
          deviceId: device.deviceId,
          name: device.name,
          localName: device.localName,
          nameMatches: device.name === name,
          localNameMatches: device.localName === name,
        })))
    } catch (error) {
      console.warn(`[BLE ${new Date().toISOString()}] 读取缓存设备列表失败`, error)
    }
  }

  async stopDiscovery(): Promise<void> {
    await wx.stopBluetoothDevicesDiscovery()
  }

  async createConnection(deviceId: string): Promise<void> {
    await wx.createBLEConnection({ deviceId, timeout: 10_000 })
  }

  async getServices(deviceId: string): Promise<BleGattService[]> {
    const result = await wx.getBLEDeviceServices({ deviceId })
    return result.services.map(({ uuid }) => ({ uuid }))
  }

  async getCharacteristics(
    deviceId: string,
    serviceId: string,
  ): Promise<BleGattCharacteristic[]> {
    const result = await wx.getBLEDeviceCharacteristics({ deviceId, serviceId })
    return result.characteristics.map(({ uuid, properties }) => ({
      uuid,
      properties: {
        write: properties.write,
        writeNoResponse: properties.writeNoResponse,
        notify: properties.notify || properties.indicate,
      },
    }))
  }

  async enableNotifications(
    deviceId: string,
    serviceId: string,
    characteristicId: string,
  ): Promise<void> {
    await wx.notifyBLECharacteristicValueChange({
      deviceId,
      serviceId,
      characteristicId,
      state: true,
    })
  }

  async writeCharacteristic(
    deviceId: string,
    serviceId: string,
    characteristicId: string,
    value: Uint8Array,
  ): Promise<void> {
    const buffer = value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer
    await wx.writeBLECharacteristicValue({ deviceId, serviceId, characteristicId, value: buffer })
  }

  onCharacteristicValue(listener: (event: BleCharacteristicValueEvent) => void): void {
    wx.onBLECharacteristicValueChange((event) => {
      listener({
        deviceId: event.deviceId,
        serviceId: event.serviceId,
        characteristicId: event.characteristicId,
        value: new Uint8Array(event.value),
      })
    })
  }

  onConnectionStateChange(listener: (event: BleConnectionStateEvent) => void): void {
    wx.onBLEConnectionStateChange(listener)
  }

  async closeConnection(deviceId: string): Promise<void> {
    await wx.closeBLEConnection({ deviceId })
  }
}
