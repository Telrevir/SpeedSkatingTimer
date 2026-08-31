import type { LocalRacePhase } from './local-race-scoring'
import { TARGET_DEVICE_NAME } from '../config/app-config'

export enum ConnectionState {
  Disconnected = 'disconnected',
  Connected = 'connected',
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
}

export function getConnectionPresentation(
  connectionState: ConnectionState,
): ConnectionPresentation {
  const connected = connectionState === ConnectionState.Connected
  return {
    connectionText: `${connected ? '已连接' : '未连接'} ${TARGET_DEVICE_NAME}`,
    showConnectButton: !connected,
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
