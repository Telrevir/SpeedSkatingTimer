import type { LocalRacePhase } from '../domain/local-race-scoring'
import type { AthleteTransferState, FirmwareAthleteLapHistory } from '../protocol/athlete-sync-codec'
import { AutoConnectState, ConnectionState, FirmwareDetectionState } from '../domain/race-state'

export interface RaceSnapshot {
  connectionState: ConnectionState
  autoConnectState: AutoConnectState
  firmwareState: FirmwareDetectionState
  localPhase: LocalRacePhase
  finishLap: number | null
  leaderAthleteId: number | null
  leaderLapCount: number | null
  leaderLapCentiseconds: number | null
  athleteTransferState: AthleteTransferState
  firmwareLapHistories: FirmwareAthleteLapHistory[]
  syncError: string | null
}

export class RaceStore {
  private readonly listeners = new Set<(snapshot: RaceSnapshot) => void>()
  private value: RaceSnapshot = {
    connectionState: ConnectionState.Disconnected,
    autoConnectState: AutoConnectState.Idle,
    firmwareState: FirmwareDetectionState.Unknown,
    localPhase: 'idle',
    finishLap: null,
    leaderAthleteId: null,
    leaderLapCount: null,
    leaderLapCentiseconds: null,
    athleteTransferState: 'idle',
    firmwareLapHistories: [],
    syncError: null,
  }

  get snapshot(): RaceSnapshot { return cloneSnapshot(this.value) }

  setConnectionState(connectionState: ConnectionState): void {
    this.value = { ...this.value, connectionState }
    this.notify()
  }

  setAutoConnectState(autoConnectState: AutoConnectState): void {
    this.value = { ...this.value, autoConnectState }
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

  replaceFirmwareLapHistories(histories: readonly FirmwareAthleteLapHistory[]): void {
    this.value = { ...this.value, firmwareLapHistories: cloneFirmwareLapHistories(histories) }
    this.notify()
  }

  setSyncError(syncError: string | null): void {
    this.value = { ...this.value, syncError }
    this.notify()
  }

  setRaceState(state: Omit<
    RaceSnapshot,
    'connectionState' | 'autoConnectState' | 'firmwareState' | 'athleteTransferState'
      | 'firmwareLapHistories' | 'syncError'
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

function cloneSnapshot(snapshot: RaceSnapshot): RaceSnapshot {
  return {
    ...snapshot,
    firmwareLapHistories: cloneFirmwareLapHistories(snapshot.firmwareLapHistories),
  }
}

function cloneFirmwareLapHistories(
  histories: readonly FirmwareAthleteLapHistory[],
): FirmwareAthleteLapHistory[] {
  return histories.map((history) => ({
    athleteId: history.athleteId,
    records: history.records.map((record) => ({ ...record })),
  }))
}
