import type { LocalLapCorrectionState, LocalRacePhase } from './local-race-scoring'

export interface ActiveRaceSession {
  participantIds: number[]
  activeGroupId: string | null
  athleteDefinitionCount: number
  nonAthleteDefinitionCount: number
  lapCorrectionStates?: LocalLapCorrectionState[]
  localPhase?: Exclude<LocalRacePhase, 'idle'>
  finishLap?: number | null
}
