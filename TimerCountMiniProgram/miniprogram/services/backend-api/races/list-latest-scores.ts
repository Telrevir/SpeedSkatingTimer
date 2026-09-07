import type { ApiResult, BackendClient } from '../request'
import type { LatestScoresDto } from '../types'

export function listLatestScores(client: BackendClient, raceId: number): Promise<ApiResult<LatestScoresDto>> {
  return client.request({ method: 'GET', path: `/races/${raceId}/latest-scores` })
}
