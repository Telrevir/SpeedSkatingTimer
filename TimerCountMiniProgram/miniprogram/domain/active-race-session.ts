import type { LocalLapCorrectionState, LocalRacePhase } from './local-race-scoring'
import type { RaceIdentity } from './race-identity'

export interface ActiveRaceSession {
  participantIds: number[]
  activeGroupId: string | null
  athleteDefinitionCount: number
  nonAthleteDefinitionCount: number
  lapCorrectionStates?: LocalLapCorrectionState[]
  localPhase?: Exclude<LocalRacePhase, 'idle'>
  finishLap?: number | null
  /** 版本 3 起保存；旧会话在下一次确认开始比赛后补齐。 */
  raceIdentity?: RaceIdentity
}
