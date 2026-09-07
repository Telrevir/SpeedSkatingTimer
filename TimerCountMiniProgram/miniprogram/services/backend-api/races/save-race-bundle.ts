import type { ApiResult, BackendClient } from '../request'
import type { RaceBundleDto } from '../types'

export function saveRaceBundle(client: BackendClient, bundle: RaceBundleDto): Promise<ApiResult<RaceBundleDto>> {
  return client.request({ method: 'POST', path: '/race-bundles', data: serializeBundle(bundle) })
}

/** 仅保留后端已生成的正整数 ID；本地 -1、null 和 undefined 均不得上传。 */
function serializeBundle(bundle: RaceBundleDto): RaceBundleDto {
  const { RaceID, ...raceInfo } = bundle.RaceInfo
  return {
    RaceInfo: { ...raceInfo, ...positiveId('RaceID', RaceID) },
    AthleteRaceJoins: bundle.AthleteRaceJoins.map((join) => {
      const { id, RaceID: joinRaceId, ...fields } = join
      return { ...fields, ...positiveId('id', id), ...positiveId('RaceID', joinRaceId) }
    }),
    Scores: bundle.Scores.map((score) => {
      const { ScoreID, RaceID: scoreRaceId, ...fields } = score
      return { ...fields, ...positiveId('ScoreID', ScoreID), ...positiveId('RaceID', scoreRaceId) }
    }),
  }
}

function positiveId<Key extends 'RaceID' | 'ScoreID' | 'id'>(key: Key, value: unknown): Partial<Record<Key, number>> {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? { [key]: value } as Record<Key, number> : {}
}