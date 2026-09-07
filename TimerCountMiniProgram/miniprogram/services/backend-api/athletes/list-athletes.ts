import type { ApiResult, BackendClient } from '../request'
import type { AthleteDto, AthleteListQuery, PageResultDto } from '../types'

export function listAthletes(client: BackendClient, query: AthleteListQuery): Promise<ApiResult<PageResultDto<AthleteDto>>> {
  return client.request({ method: 'GET', path: '/athletes', query })
}
