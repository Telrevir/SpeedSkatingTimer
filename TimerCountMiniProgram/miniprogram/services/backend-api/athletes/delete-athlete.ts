import type { ApiResult, BackendClient } from '../request'
import type { AthleteDto } from '../types'

export function deleteAthlete(client: BackendClient, athleteId: number): Promise<ApiResult<AthleteDto>> {
  return client.request({ method: 'DELETE', path: `/athletes/${athleteId}` })
}
