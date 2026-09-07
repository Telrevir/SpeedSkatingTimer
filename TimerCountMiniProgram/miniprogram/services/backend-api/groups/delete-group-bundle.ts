import type { ApiResult, BackendClient } from '../request'
import type { GroupBundleDto } from '../types'

export function deleteGroupBundle(client: BackendClient, groupId: number): Promise<ApiResult<GroupBundleDto>> {
  return client.request({ method: 'DELETE', path: `/athlete-group-bundles/${groupId}` })
}
