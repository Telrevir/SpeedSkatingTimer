import type { ApiResult, BackendClient } from '../request'
import type { AthleteDto } from '../types'

export function createAthlete(client: BackendClient, athlete: AthleteDto): Promise<ApiResult<AthleteDto>> {
  return client.request({ method: 'POST', path: '/athletes', data: athlete })
}
