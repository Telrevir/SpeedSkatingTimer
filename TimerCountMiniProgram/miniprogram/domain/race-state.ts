import type { LocalRacePhase } from './local-race-scoring'
import { TARGET_DEVICE_NAME } from '../config/app-config'

export enum ConnectionState {
  Disconnected = 'disconnected',
  Connected = 'connected',
}

export enum AutoConnectState {
  Idle = 'idle',
  Searching = 'searching',
  Connected = 'connected',
  NotFound = 'not-found',
  Failed = 'failed',
}

export class TargetDeviceNotFoundError extends Error {
  constructor(deviceName: string) {
    super(`未找到蓝牙设备 ${deviceName}`)
    this.name = 'TargetDeviceNotFoundError'
  }
}

export enum FirmwareDetectionState {
  Unknown = -1,
  Stopped = 0x00,
  Detecting = 0x01,
}

export interface RaceControlsState {
  primaryLabel: '开始' | '结束'
  primaryEnabled: boolean
  resetEnabled: boolean
}

export interface ConnectionPresentation {
  connectionText: string
  showConnectButton: boolean
  autoConnecting: boolean
  connectButtonText: string
}

export function getConnectionPresentation(
  connectionState: ConnectionState,
  autoConnectState: AutoConnectState = AutoConnectState.Idle,
): ConnectionPresentation {
  const connected = connectionState === ConnectionState.Connected
  if (connected) {
    return {
      connectionText: `${autoConnectState === AutoConnectState.Connected ? '已自动连接' : '已连接'} ${TARGET_DEVICE_NAME}`,
      showConnectButton: false,
      autoConnecting: false,
      connectButtonText: '连接',
    }
  }
  if (autoConnectState === AutoConnectState.Searching) {
    return {
      connectionText: `正在自动查找 ${TARGET_DEVICE_NAME}`,
      showConnectButton: true,
      autoConnecting: true,
      connectButtonText: '正在查找',
    }
  }
  if (autoConnectState === AutoConnectState.NotFound) {
    return {
      connectionText: `本轮未找到 ${TARGET_DEVICE_NAME}，可手动连接`,
      showConnectButton: true,
      autoConnecting: false,
      connectButtonText: '连接',
    }
  }
  if (autoConnectState === AutoConnectState.Failed) {
    return {
      connectionText: '自动连接失败，可手动连接',
      showConnectButton: true,
      autoConnecting: false,
      connectButtonText: '连接',
    }
  }
  return {
    connectionText: `未连接 ${TARGET_DEVICE_NAME}`,
    showConnectButton: true,
    autoConnecting: false,
    connectButtonText: '连接',
  }
}

export function getRaceControlsState(
  connectionState: ConnectionState,
  firmwareState: FirmwareDetectionState,
  localPhase: LocalRacePhase,
): RaceControlsState {
  if (connectionState !== ConnectionState.Connected) {
    return { primaryLabel: '开始', primaryEnabled: false, resetEnabled: false }
  }
  if (localPhase === 'running') {
    return { primaryLabel: '结束', primaryEnabled: true, resetEnabled: true }
  }
  if (localPhase === 'finishing' || localPhase === 'finished') {
    return { primaryLabel: '结束', primaryEnabled: false, resetEnabled: true }
  }
  if (firmwareState === FirmwareDetectionState.Detecting) {
    return { primaryLabel: '开始', primaryEnabled: false, resetEnabled: true }
  }
  if (firmwareState === FirmwareDetectionState.Stopped) {
    return { primaryLabel: '开始', primaryEnabled: true, resetEnabled: false }
  }
  return { primaryLabel: '开始', primaryEnabled: false, resetEnabled: false }
}
