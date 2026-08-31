import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ConnectionState,
  FirmwareDetectionState,
  getConnectionPresentation,
  getRaceControlsState,
} from '../miniprogram/domain/race-state'

test('shows the connect button only while disconnected and uses current connection text', () => {
  assert.deepEqual(getConnectionPresentation(ConnectionState.Disconnected), {
    connectionText: '未连接 ESP32-LORA-BRIDGE',
    showConnectButton: true,
  })
  assert.deepEqual(getConnectionPresentation(ConnectionState.Connected), {
    connectionText: '已连接 ESP32-LORA-BRIDGE',
    showConnectButton: false,
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
