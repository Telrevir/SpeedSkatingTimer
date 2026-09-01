import assert from 'node:assert/strict'
import test from 'node:test'

import {
  BleDevice,
  BleGattCharacteristic,
  BleGattService,
  BleCharacteristicValueEvent,
  BleConnectionStateEvent,
  WechatBluetoothApi,
} from '../miniprogram/transport/wechat-bluetooth-api'
import { BleTransport } from '../miniprogram/transport/ble-transport'
import { TargetDeviceNotFoundError } from '../miniprogram/domain/race-state'

class RecordingBluetoothApi implements WechatBluetoothApi {
  readonly calls: string[] = []
  readonly writes: Uint8Array[] = []
  readonly writeTargets: string[] = []
  disconnectOnNextWrite = false
  disconnectWhileGettingServices = false
  deviceNotFound = false
  private delayedWrite: {
    started: () => void
    completion: Promise<void>
  } | null = null
  private valueListener: ((event: BleCharacteristicValueEvent) => void) | null = null
  private connectionListener: ((event: BleConnectionStateEvent) => void) | null = null

  async openAdapter(): Promise<void> { this.calls.push('openAdapter') }
  async startDiscovery(): Promise<void> { this.calls.push('startDiscovery') }
  async waitForDevice(name: string): Promise<BleDevice> {
    this.calls.push(`waitForDevice:${name}`)
    if (this.deviceNotFound) throw new TargetDeviceNotFoundError(name)
    return { deviceId: 'device-1', name }
  }
  async stopDiscovery(): Promise<void> { this.calls.push('stopDiscovery') }
  async createConnection(deviceId: string): Promise<void> {
    this.calls.push(`createConnection:${deviceId}`)
  }
  async getServices(deviceId: string): Promise<BleGattService[]> {
    this.calls.push(`getServices:${deviceId}`)
    if (this.disconnectWhileGettingServices) {
      this.disconnectWhileGettingServices = false
      this.emitConnection(false, deviceId)
    }
    return [{ uuid: '0000FFE0-0000-1000-8000-00805F9B34FB' }]
  }
  async getCharacteristics(deviceId: string, serviceId: string): Promise<BleGattCharacteristic[]> {
    this.calls.push(`getCharacteristics:${deviceId}:${serviceId}`)
    return [
      { uuid: '0000FFE2-0000-1000-8000-00805F9B34FB', properties: { write: true, notify: false } },
      { uuid: '0000FFE1-0000-1000-8000-00805F9B34FB', properties: { write: false, notify: true } },
    ]
  }
  async enableNotifications(deviceId: string, serviceId: string, characteristicId: string): Promise<void> {
    this.calls.push(`enableNotifications:${deviceId}:${serviceId}:${characteristicId}`)
  }
  async writeCharacteristic(
    _deviceId: string,
    _serviceId: string,
    characteristicId: string,
    value: Uint8Array,
  ): Promise<void> {
    this.writeTargets.push(characteristicId)
    this.writes.push(value)
    const delayedWrite = this.delayedWrite
    if (delayedWrite) {
      this.delayedWrite = null
      delayedWrite.started()
      await delayedWrite.completion
    }
    if (this.disconnectOnNextWrite) {
      this.disconnectOnNextWrite = false
      this.emitConnection(false)
    }
  }
  onCharacteristicValue(listener: (event: BleCharacteristicValueEvent) => void): void {
    this.valueListener = listener
  }
  onConnectionStateChange(listener: (event: BleConnectionStateEvent) => void): void {
    this.connectionListener = listener
  }
  async closeConnection(): Promise<void> {}

  emitValue(value: Uint8Array): void {
    this.valueListener?.({
      deviceId: 'device-1',
      serviceId: '0000FFE0-0000-1000-8000-00805F9B34FB',
      characteristicId: '0000FFE1-0000-1000-8000-00805F9B34FB',
      value,
    })
  }

  emitConnection(connected: boolean, deviceId = 'device-1'): void {
    this.connectionListener?.({ deviceId, connected })
  }

  delayNextWrite(): { started: Promise<void>; release: () => void } {
    let markStarted!: () => void
    let release!: () => void
    const started = new Promise<void>((resolve) => { markStarted = resolve })
    const completion = new Promise<void>((resolve) => { release = resolve })
    this.delayedWrite = { started: markStarted, completion }
    return { started, release }
  }
}

test('connects to the named device and subscribes to the configured GATT characteristic', async () => {
  const api = new RecordingBluetoothApi()
  const transport = new BleTransport(api)

  await transport.connect()

  assert.equal(transport.state, 'connected')
  assert.deepEqual(api.calls, [
    'openAdapter',
    'waitForDevice:ESP32-LORA-BRIDGE',
    'startDiscovery',
    'stopDiscovery',
    'createConnection:device-1',
    'getServices:device-1',
    'getCharacteristics:device-1:0000FFE0-0000-1000-8000-00805F9B34FB',
    'enableNotifications:device-1:0000FFE0-0000-1000-8000-00805F9B34FB:0000FFE1-0000-1000-8000-00805F9B34FB',
  ])
})

test('writes a packet sequentially in BLE-sized chunks', async () => {
  const api = new RecordingBluetoothApi()
  const transport = new BleTransport(api)
  await transport.connect()

  await transport.send(Uint8Array.from({ length: 45 }, (_, index) => index))

  assert.deepEqual(api.writes.map((chunk) => [...chunk]), [
    Array.from({ length: 20 }, (_, index) => index),
    Array.from({ length: 20 }, (_, index) => index + 20),
    [40, 41, 42, 43, 44],
  ])
  assert.deepEqual(api.writeTargets, [
    '0000FFE2-0000-1000-8000-00805F9B34FB',
    '0000FFE2-0000-1000-8000-00805F9B34FB',
    '0000FFE2-0000-1000-8000-00805F9B34FB',
  ])
})

test('forwards notification bytes to registered data listeners', async () => {
  const api = new RecordingBluetoothApi()
  const transport = new BleTransport(api)
  const received: number[][] = []
  transport.onData((value) => received.push([...value]))
  await transport.connect()

  api.emitValue(Uint8Array.of(0xaa, 0x08))

  assert.deepEqual(received, [[0xaa, 0x08]])
})

test('stops discovery and returns to disconnected when the target device is not found', async () => {
  const api = new RecordingBluetoothApi()
  api.deviceNotFound = true
  const transport = new BleTransport(api)

  await assert.rejects(() => transport.connect(), TargetDeviceNotFoundError)

  assert.equal(transport.state, 'disconnected')
  assert.equal(api.calls.filter((call) => call === 'stopDiscovery').length, 1)
  assert.equal(api.calls.some((call) => call.startsWith('createConnection:')), false)
})

test('returns to disconnected state and invalidates GATT writes when the active device disconnects', async () => {
  const api = new RecordingBluetoothApi()
  const transport = new BleTransport(api)
  await transport.connect()

  api.emitConnection(false, 'another-device')
  assert.equal(transport.state, 'connected')

  api.emitConnection(false)

  assert.equal(transport.state, 'disconnected')
  await assert.rejects(
    () => transport.send(Uint8Array.of(0xaa)),
    /not connected/,
  )
})

test('stops a chunked write immediately when the active connection drops', async () => {
  const api = new RecordingBluetoothApi()
  const transport = new BleTransport(api)
  await transport.connect()
  api.disconnectOnNextWrite = true

  await assert.rejects(
    () => transport.send(Uint8Array.from({ length: 45 }, (_, index) => index)),
    /not connected/,
  )

  assert.equal(api.writes.length, 1)
})

test('does not commit a connection that drops during GATT setup', async () => {
  const api = new RecordingBluetoothApi()
  api.disconnectWhileGettingServices = true
  const transport = new BleTransport(api)

  await assert.rejects(
    () => transport.connect(),
    /disconnected during setup/,
  )

  assert.equal(transport.state, 'disconnected')
})

test('does not resume an old chunked write after reconnecting the same device', async () => {
  const api = new RecordingBluetoothApi()
  const transport = new BleTransport(api)
  await transport.connect()
  const gate = api.delayNextWrite()
  const sending = transport.send(Uint8Array.from({ length: 45 }, (_, index) => index))
  await gate.started

  api.emitConnection(false)
  await transport.connect()
  gate.release()

  await assert.rejects(() => sending, /not connected/)
  assert.equal(api.writes.length, 1)
})
