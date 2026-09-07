import type { ApiResult, BackendClient } from '../request'
import type { PageResultDto, RaceBundleDto, RaceBundleListQuery } from '../types'

export function listRaceBundles(client: BackendClient, query: RaceBundleListQuery): Promise<ApiResult<PageResultDto<RaceBundleDto>>> {
  return client.request({ method: 'GET', path: '/race-bundles/page', query })
}
