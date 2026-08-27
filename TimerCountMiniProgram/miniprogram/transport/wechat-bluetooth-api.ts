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
    await wx.startBluetoothDevicesDiscovery({ allowDuplicatesKey: false })
  }

  waitForDevice(name: string): Promise<BleDevice> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        wx.offBluetoothDeviceFound()
        reject(new Error(`未找到蓝牙设备 ${name}`))
      }, 10_000)
      const listener: WechatMiniprogram.OnBluetoothDeviceFoundCallback = (result) => {
        const match = result.devices.find((device) =>
          device.name === name || device.localName === name)
        if (!match) {
          return
        }
        clearTimeout(timeoutId)
        wx.offBluetoothDeviceFound()
        resolve({ deviceId: match.deviceId, name })
      }
      wx.onBluetoothDeviceFound(listener)
    })
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
