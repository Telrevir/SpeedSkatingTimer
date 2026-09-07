import type { ApiResult, BackendClient } from '../request'
import type { GroupBundleDto } from '../types'

export function createGroupBundle(client: BackendClient, bundle: GroupBundleDto): Promise<ApiResult<GroupBundleDto>> {
  return client.request({ method: 'POST', path: '/athlete-group-bundles', data: bundle })
}
