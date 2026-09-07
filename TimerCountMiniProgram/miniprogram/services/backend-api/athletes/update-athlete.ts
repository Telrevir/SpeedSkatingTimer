import type { ApiResult, BackendClient } from '../request'
import type { AthleteDto } from '../types'

export function updateAthlete(client: BackendClient, athleteId: number, athlete: AthleteDto): Promise<ApiResult<AthleteDto>> {
  return client.request({ method: 'PUT', path: `/athletes/${athleteId}`, data: athlete })
}
