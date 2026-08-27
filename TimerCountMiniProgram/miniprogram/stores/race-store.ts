import type { LocalRacePhase } from '../domain/local-race-scoring'
import type { AthleteTransferState } from '../protocol/athlete-sync-codec'
import { ConnectionState, FirmwareDetectionState } from '../domain/race-state'

export interface RaceSnapshot {
  connectionState: ConnectionState
  firmwareState: FirmwareDetectionState
  localPhase: LocalRacePhase
  finishLap: number | null
  leaderAthleteId: number | null
  leaderLapCount: number | null
  leaderLapCentiseconds: number | null
  athleteTransferState: AthleteTransferState
  syncError: string | null
}

export class RaceStore {
  private readonly listeners = new Set<(snapshot: RaceSnapshot) => void>()
  private value: RaceSnapshot = {
    connectionState: ConnectionState.Disconnected,
    firmwareState: FirmwareDetectionState.Unknown,
    localPhase: 'idle',
    finishLap: null,
    leaderAthleteId: null,
    leaderLapCount: null,
    leaderLapCentiseconds: null,
    athleteTransferState: 'idle',
    syncError: null,
  }

  get snapshot(): RaceSnapshot { return { ...this.value } }

  setConnectionState(connectionState: ConnectionState): void {
    this.value = { ...this.value, connectionState }
    this.notify()
  }

  setFirmwareState(firmwareState: FirmwareDetectionState): void {
    this.value = { ...this.value, firmwareState }
    this.notify()
  }

  setAthleteTransferState(athleteTransferState: AthleteTransferState): void {
    this.value = { ...this.value, athleteTransferState }
    this.notify()
  }

  setSyncError(syncError: string | null): void {
    this.value = { ...this.value, syncError }
    this.notify()
  }

  setRaceState(state: Omit<
    RaceSnapshot,
    'connectionState' | 'firmwareState' | 'athleteTransferState' | 'syncError'
  >): void {
    this.value = { ...this.value, ...state }
    this.notify()
  }

  subscribe(listener: (snapshot: RaceSnapshot) => void): () => void {
    this.listeners.add(listener)
    listener(this.snapshot)
    return () => this.listeners.delete(listener)
  }

  private notify(): void {
    const snapshot = this.snapshot
    this.listeners.forEach((listener) => listener(snapshot))
  }
}
