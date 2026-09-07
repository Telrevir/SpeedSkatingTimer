import type { ApiResult, BackendClient } from '../request'
import type { RaceBundleDto } from '../types'

export function saveRaceBundle(client: BackendClient, bundle: RaceBundleDto): Promise<ApiResult<RaceBundleDto>> {
  return client.request({ method: 'POST', path: '/race-bundles', data: bundle })
}
