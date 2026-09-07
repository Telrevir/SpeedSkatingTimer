import type { ApiResult, BackendClient } from '../request'
import type { RaceInfoDto } from '../types'

export function createRace(client: BackendClient, race: RaceInfoDto): Promise<ApiResult<RaceInfoDto>> {
  const { RaceID: _raceId, ...body } = race
  return client.request({ method: 'POST', path: '/races', data: body })
}
