import type { ApiResult, BackendClient } from '../request'
import type { AthleteCreateDto, AthleteDto } from '../types'

export function createAthlete(client: BackendClient, athlete: AthleteCreateDto): Promise<ApiResult<AthleteDto>> {
  return client.request({ method: 'POST', path: '/athletes', data: athlete })
}
