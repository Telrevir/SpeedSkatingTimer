import {
  DEFAULT_BLE_PROFILE, BLE_WRITE_CHUNK_SIZE, type BleConnectionProfile,
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

  constructor(
    private readonly api: WechatBluetoothApi,
    private readonly profileProvider: () => BleConnectionProfile = () => DEFAULT_BLE_PROFILE,
  ) {
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
      this.diagnostic('连接已断开', { deviceId: event.deviceId })
      this.connectionEpoch += 1
      this.clearConnection()
      this.disconnectListeners.forEach((listener) => listener())
    })
  }

  async connect(): Promise<void> {
    const connectionEpoch = ++this.connectionEpoch
    const profile = this.profileProvider()
    let discoveryStarted = false
    let stage = '打开蓝牙适配器'
    try {
      this.diagnostic(stage)
      await this.api.openAdapter()
      this.state = 'scanning'
      // 必须先监听再扫描，避免设备首次广播发生在监听器注册之前。
      stage = '注册目标设备监听'
      this.diagnostic(stage, { targetName: profile.name, profileId: profile.id })
      const devicePromise = this.api.waitForDevice(profile.name)
      stage = '开始扫描'
      this.diagnostic(stage, { targetName: profile.name, profileId: profile.id })
      await this.api.startDiscovery()
      discoveryStarted = true
      stage = '等待目标设备广播'
      const device = await devicePromise
      this.diagnostic('发现目标设备', { deviceId: device.deviceId, name: device.name })
      stage = '停止扫描'
      await this.api.stopDiscovery()
      discoveryStarted = false

      this.state = 'connecting'
      this.deviceId = device.deviceId
      stage = '建立 BLE 连接'
      this.diagnostic(stage, { deviceId: device.deviceId })
      await this.api.createConnection(device.deviceId)
      this.ensureConnectionAttempt(connectionEpoch, device.deviceId)
      this.diagnostic('BLE 连接已建立', { deviceId: device.deviceId })
      stage = '读取 GATT 服务'
      const services = await this.api.getServices(device.deviceId)
      this.ensureConnectionAttempt(connectionEpoch, device.deviceId)
      this.diagnostic('读取到 GATT 服务', { uuids: services.map(({ uuid }) => uuid) })
      const service = services.find(({ uuid }) => sameUuid(uuid, profile.serviceUuid))
      if (!service) {
        throw new BleCompatibilityError(`${profile.name} 未提供目标 BLE 服务，请核对配置`)
      }
      this.diagnostic('匹配到目标服务', { serviceId: service.uuid })

      stage = '读取 GATT 特征'
      const characteristics = await this.api.getCharacteristics(device.deviceId, service.uuid)
      this.ensureConnectionAttempt(connectionEpoch, device.deviceId)
      this.diagnostic('读取到 GATT 特征', {
        serviceId: service.uuid,
        characteristics: characteristics.map(({ uuid, properties }) => ({ uuid, properties })),
      })
      const commandRx = characteristics.find(({ uuid, properties }) =>
        sameUuid(uuid, profile.commandRxUuid)
        && (properties.write || properties.writeNoResponse))
      const notificationTx = characteristics.find(({ uuid, properties }) =>
        sameUuid(uuid, profile.notificationTxUuid) && properties.notify)
      if (!commandRx || !notificationTx) {
        throw new BleCompatibilityError(`${profile.name} 未提供写入或通知特征，请核对配置`)
      }
      this.diagnostic('匹配到读写特征', {
        commandCharacteristicId: commandRx.uuid,
        notificationCharacteristicId: notificationTx.uuid,
      })

      stage = '启用通知'
      this.diagnostic(stage, { deviceId: device.deviceId, serviceId: service.uuid, characteristicId: notificationTx.uuid })
      await this.api.enableNotifications(device.deviceId, service.uuid, notificationTx.uuid)
      this.ensureConnectionAttempt(connectionEpoch, device.deviceId)
      this.serviceId = service.uuid
      this.commandCharacteristicId = commandRx.uuid
      this.notificationCharacteristicId = notificationTx.uuid
      this.state = 'connected'
      this.diagnostic('蓝牙连接完成', { deviceId: device.deviceId, serviceId: service.uuid })
    } catch (error) {
      this.diagnosticFailure(stage, error)
      if (discoveryStarted) {
        try {
          await this.api.stopDiscovery()
          this.diagnostic('扫描已在失败后停止')
        } catch {
          // 扫描清理失败不能覆盖本轮连接的原始失败原因。
        }
      }
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

  private diagnostic(stage: string, detail?: unknown): void {
    const timestamp = new Date().toISOString()
    if (detail === undefined) {
      console.info(`[BLE ${timestamp}] ${stage}`)
      return
    }
    console.info(`[BLE ${timestamp}] ${stage}`, detail)
  }

  private diagnosticFailure(stage: string, error: unknown): void {
    const detail = error instanceof Error
      ? { name: error.name, message: error.message, ...errorDetails(error) }
      : { error }
    console.error(`[BLE ${new Date().toISOString()}] 连接失败：${stage}`, detail)
  }
}

function sameUuid(left: string, right: string): boolean {
  return left.toUpperCase() === right.toUpperCase()
}

function errorDetails(error: Error): Record<string, unknown> {
  const value = error as Error & { errCode?: unknown; errno?: unknown; code?: unknown }
  const details: Record<string, unknown> = {}
  if (value.errCode !== undefined) details.errCode = value.errCode
  if (value.errno !== undefined) details.errno = value.errno
  if (value.code !== undefined) details.code = value.code
  return details
}
