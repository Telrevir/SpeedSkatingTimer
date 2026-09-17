import type { ApiResult, BackendClient } from '../request'
import type { GroupBundleDto, GroupBundleUpdateDto } from '../types'

export function updateGroupBundle(client: BackendClient, groupId: number, bundle: GroupBundleUpdateDto): Promise<ApiResult<GroupBundleDto>> {
  return client.request({ method: 'PUT', path: `/athlete-group-bundles/${groupId}`, data: bundle })
}
