import { TARGET_DEVICE_NAME } from '../config/app-config'
import {
  BLE_COMMAND_RX_UUID,
  BLE_NOTIFICATION_TX_UUID,
  BLE_SERVICE_UUID,
  BLE_WRITE_CHUNK_SIZE,
} from '../config/ble-config'
import type { WechatBluetoothApi } from './wechat-bluetooth-api'

export type BleTransportState = 'disconnected' | 'scanning' | 'connecting' | 'connected'

export class BleCompatibilityError extends Error {}

export class BleTransport {
  state: BleTransportState = 'disconnected'

  private deviceId: string | null = null
  private serviceId: string | null = null
  private commandCharacteristicId: string | null = null
  private notificationCharacteristicId: string | null = null
  private connectionEpoch = 0
  private readonly dataListeners = new Set<(value: Uint8Array) => void>()
  private readonly disconnectListeners = new Set<() => void>()

  constructor(private readonly api: WechatBluetoothApi) {
    this.api.onCharacteristicValue((event) => {
      if (event.deviceId !== this.deviceId
          || !this.notificationCharacteristicId
          || !sameUuid(event.characteristicId, this.notificationCharacteristicId)) {
        return
      }
      this.dataListeners.forEach((listener) => listener(event.value))
    })
    this.api.onConnectionStateChange((event) => {
      if (event.connected || event.deviceId !== this.deviceId) return
      this.connectionEpoch += 1
      this.clearConnection()
      this.disconnectListeners.forEach((listener) => listener())
    })
  }

  async connect(): Promise<void> {
    const connectionEpoch = ++this.connectionEpoch
    await this.api.openAdapter()
    this.state = 'scanning'
    // Register the discovery callback before scanning. With duplicate
    // callbacks disabled, a fast advertiser can otherwise be discovered
    // before the listener exists and never be reported again.
    const devicePromise = this.api.waitForDevice(TARGET_DEVICE_NAME)
    await this.api.startDiscovery()
    const device = await devicePromise
    await this.api.stopDiscovery()

    this.state = 'connecting'
    this.deviceId = device.deviceId
    try {
      await this.api.createConnection(device.deviceId)
      this.ensureConnectionAttempt(connectionEpoch, device.deviceId)
      const services = await this.api.getServices(device.deviceId)
      this.ensureConnectionAttempt(connectionEpoch, device.deviceId)
      const service = services.find(({ uuid }) => sameUuid(uuid, BLE_SERVICE_UUID))
      if (!service) {
        throw new BleCompatibilityError('BT04-E 未提供 FFE0 BLE 服务，请核对 AT+UUID')
      }

      const characteristics = await this.api.getCharacteristics(device.deviceId, service.uuid)
      this.ensureConnectionAttempt(connectionEpoch, device.deviceId)
      const commandRx = characteristics.find(({ uuid, properties }) =>
        sameUuid(uuid, BLE_COMMAND_RX_UUID)
        && (properties.write || properties.writeNoResponse))
      const notificationTx = characteristics.find(({ uuid, properties }) =>
        sameUuid(uuid, BLE_NOTIFICATION_TX_UUID) && properties.notify)
      if (!commandRx || !notificationTx) {
        throw new BleCompatibilityError('BT04-E 未提供 FFE2 写入或 FFE1 通知特征，请核对 AT+WRITE/AT+CHAR')
      }

      await this.api.enableNotifications(device.deviceId, service.uuid, notificationTx.uuid)
      this.ensureConnectionAttempt(connectionEpoch, device.deviceId)
      this.serviceId = service.uuid
      this.commandCharacteristicId = commandRx.uuid
      this.notificationCharacteristicId = notificationTx.uuid
      this.state = 'connected'
    } catch (error) {
      if (this.connectionEpoch === connectionEpoch) this.clearConnection()
      throw error
    }
  }

  onData(listener: (value: Uint8Array) => void): () => void {
    this.dataListeners.add(listener)
    return () => this.dataListeners.delete(listener)
  }

  onDisconnect(listener: () => void): () => void {
    this.disconnectListeners.add(listener)
    return () => this.disconnectListeners.delete(listener)
  }

  async send(packet: Uint8Array): Promise<void> {
    const connectionEpoch = this.connectionEpoch
    const deviceId = this.deviceId
    const serviceId = this.serviceId
    const commandCharacteristicId = this.commandCharacteristicId
    if (this.state !== 'connected' || !deviceId || !serviceId || !commandCharacteristicId) {
      throw new Error('BLE transport is not connected')
    }
    for (let offset = 0; offset < packet.length; offset += BLE_WRITE_CHUNK_SIZE) {
      if (this.connectionEpoch !== connectionEpoch
          || this.state !== 'connected'
          || this.deviceId !== deviceId) {
        throw new Error('BLE transport is not connected')
      }
      await this.api.writeCharacteristic(
        deviceId,
        serviceId,
        commandCharacteristicId,
        packet.slice(offset, offset + BLE_WRITE_CHUNK_SIZE),
      )
      if (this.connectionEpoch !== connectionEpoch
          || this.state !== 'connected'
          || this.deviceId !== deviceId) {
        throw new Error('BLE transport is not connected')
      }
    }
  }

  private ensureConnectionAttempt(connectionEpoch: number, deviceId: string): void {
    if (this.connectionEpoch !== connectionEpoch
        || this.deviceId !== deviceId
        || this.state === 'disconnected') {
      throw new Error('BLE connection disconnected during setup')
    }
  }

  private clearConnection(): void {
    this.state = 'disconnected'
    this.deviceId = null
    this.serviceId = null
    this.commandCharacteristicId = null
    this.notificationCharacteristicId = null
  }
}

function sameUuid(left: string, right: string): boolean {
  return left.toUpperCase() === right.toUpperCase()
}
