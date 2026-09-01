import assert from 'node:assert/strict'
import test from 'node:test'

import {
  AutoConnectState,
  ConnectionState,
  FirmwareDetectionState,
  getConnectionPresentation,
  getRaceControlsState,
} from '../miniprogram/domain/race-state'

test('shows the connect button only while disconnected and uses current connection text', () => {
  assert.deepEqual(getConnectionPresentation(ConnectionState.Disconnected, AutoConnectState.Idle), {
    connectionText: '未连接 ESP32-LORA-BRIDGE',
    showConnectButton: true,
    autoConnecting: false,
    connectButtonText: '连接',
  })
  assert.deepEqual(getConnectionPresentation(ConnectionState.Connected, AutoConnectState.Connected), {
    connectionText: '已自动连接 ESP32-LORA-BRIDGE',
    showConnectButton: false,
    autoConnecting: false,
    connectButtonText: '连接',
  })
})

test('shows automatic discovery and not-found states without hiding manual retry', () => {
  assert.deepEqual(getConnectionPresentation(ConnectionState.Disconnected, AutoConnectState.Searching), {
    connectionText: '正在自动查找 ESP32-LORA-BRIDGE',
    showConnectButton: true,
    autoConnecting: true,
    connectButtonText: '正在查找',
  })
  assert.deepEqual(getConnectionPresentation(ConnectionState.Disconnected, AutoConnectState.NotFound), {
    connectionText: '本轮未找到 ESP32-LORA-BRIDGE，可手动连接',
    showConnectButton: true,
    autoConnecting: false,
    connectButtonText: '连接',
  })
  assert.deepEqual(getConnectionPresentation(ConnectionState.Connected, AutoConnectState.Idle), {
    connectionText: '已连接 ESP32-LORA-BRIDGE',
    showConnectButton: false,
    autoConnecting: false,
    connectButtonText: '连接',
  })
})

test('disables both race controls while disconnected', () => {
  assert.deepEqual(
    getRaceControlsState(ConnectionState.Disconnected, FirmwareDetectionState.Stopped, 'idle'),
    { primaryLabel: '开始', primaryEnabled: false, resetEnabled: false },
  )
})

test('enables Start only when connected, locally idle, and firmware stopped', () => {
  assert.deepEqual(
    getRaceControlsState(ConnectionState.Connected, FirmwareDetectionState.Stopped, 'idle'),
    { primaryLabel: '开始', primaryEnabled: true, resetEnabled: false },
  )
})

test('enables End and Reset during a running local race', () => {
  assert.deepEqual(
    getRaceControlsState(ConnectionState.Connected, FirmwareDetectionState.Detecting, 'running'),
    { primaryLabel: '结束', primaryEnabled: true, resetEnabled: true },
  )
})

test('disables the primary action while finishing or finished', () => {
  for (const phase of ['finishing', 'finished'] as const) {
    assert.deepEqual(
      getRaceControlsState(ConnectionState.Connected, FirmwareDetectionState.Detecting, phase),
      { primaryLabel: '结束', primaryEnabled: false, resetEnabled: true },
    )
  }
})

test('requires Reset when firmware is detecting without a local session', () => {
  assert.deepEqual(
    getRaceControlsState(ConnectionState.Connected, FirmwareDetectionState.Detecting, 'idle'),
    { primaryLabel: '开始', primaryEnabled: false, resetEnabled: true },
  )
})
