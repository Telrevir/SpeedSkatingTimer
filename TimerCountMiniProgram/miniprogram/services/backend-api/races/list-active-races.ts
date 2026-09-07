import type { ApiResult, BackendClient } from '../request'
import type { ActiveRacesDto } from '../types'

export function listActiveRaces(client: BackendClient, clubId: number): Promise<ApiResult<ActiveRacesDto>> {
  return client.request({ method: 'GET', path: '/races/active', query: { ClubID: clubId } })
}
