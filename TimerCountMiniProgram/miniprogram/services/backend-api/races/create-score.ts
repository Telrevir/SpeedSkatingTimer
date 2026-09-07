import type { ApiResult, BackendClient } from '../request'
import type { ScoreDto } from '../types'

export function createScore(client: BackendClient, score: ScoreDto): Promise<ApiResult<ScoreDto>> {
  const { ScoreID: _scoreId, ...body } = score
  return client.request({ method: 'POST', path: '/scores', data: body })
}
