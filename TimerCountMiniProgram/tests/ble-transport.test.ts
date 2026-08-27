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

class RecordingBluetoothApi implements WechatBluetoothApi {
  readonly calls: string[] = []
  readonly writes: Uint8Array[] = []
  readonly writeTargets: string[] = []
  private valueListener: ((event: BleCharacteristicValueEvent) => void) | null = null
  private connectionListener: ((event: BleConnectionStateEvent) => void) | null = null

  async openAdapter(): Promise<void> { this.calls.push('openAdapter') }
  async startDiscovery(): Promise<void> { this.calls.push('startDiscovery') }
  async waitForDevice(name: string): Promise<BleDevice> {
    this.calls.push(`waitForDevice:${name}`)
    return { deviceId: 'device-1', name }
  }
  async stopDiscovery(): Promise<void> { this.calls.push('stopDiscovery') }
  async createConnection(deviceId: string): Promise<void> {
    this.calls.push(`createConnection:${deviceId}`)
  }
  async getServices(deviceId: string): Promise<BleGattService[]> {
    this.calls.push(`getServices:${deviceId}`)
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
