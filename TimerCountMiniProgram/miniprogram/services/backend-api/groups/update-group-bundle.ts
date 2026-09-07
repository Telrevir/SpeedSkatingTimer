import type { ApiResult, BackendClient } from '../request'
import type { GroupBundleDto } from '../types'

export function updateGroupBundle(client: BackendClient, groupId: number, bundle: GroupBundleDto): Promise<ApiResult<GroupBundleDto>> {
  return client.request({ method: 'PUT', path: `/athlete-group-bundles/${groupId}`, data: bundle })
}
