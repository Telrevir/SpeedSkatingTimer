import type { ApiResult, BackendClient } from '../request'
import type { GroupBundleCreateDto, GroupBundleDto } from '../types'

export function createGroupBundle(client: BackendClient, bundle: GroupBundleCreateDto): Promise<ApiResult<GroupBundleDto>> {
  return client.request({ method: 'POST', path: '/athlete-group-bundles', data: bundle })
}
