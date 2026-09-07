/** 比赛同步使用的稳定身份。 */
export type RaceSyncState = 'pending' | 'online' | 'offline'

export interface RaceIdentity {
  localId: string
  clientRaceKey: string
  raceId: number | null
  syncState: RaceSyncState
}

export interface ScoreIdentity {
  localScoreId: string
  clientScoreKey: string
  eventSequence: number
  scoreId: number | null
}

/** 仅供本地领域和界面展示；提交服务器的 DTO 必须忽略 null raceId。 */
export function presentRaceId(identity: Pick<RaceIdentity, 'raceId'>): number {
  return identity.raceId ?? -1
}

export function isRaceSyncState(value: unknown): value is RaceSyncState {
  return value === 'pending' || value === 'online' || value === 'offline'
}

export function isRaceIdentity(value: unknown): value is RaceIdentity {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<RaceIdentity>
  return isNonEmptyString(candidate.localId)
    && isNonEmptyString(candidate.clientRaceKey)
    && (candidate.raceId === null || isPositiveInteger(candidate.raceId))
    && isRaceSyncState(candidate.syncState)
    && (candidate.syncState !== 'online' || candidate.raceId !== null)
    && (candidate.syncState === 'online' || candidate.raceId === null)
}

export function isScoreIdentity(value: unknown): value is ScoreIdentity {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<ScoreIdentity>
  return isNonEmptyString(candidate.localScoreId)
    && isNonEmptyString(candidate.clientScoreKey)
    && isPositiveInteger(candidate.eventSequence)
    && (candidate.scoreId === null || isPositiveInteger(candidate.scoreId))
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}
