import type { ApiResult, BackendClient } from '../request'

export interface GroupBundleDeleteDto {
  deleted: true
  AthleteGroupID: number
}

export function deleteGroupBundle(client: BackendClient, groupId: number): Promise<ApiResult<GroupBundleDeleteDto>> {
  return client.request({ method: 'DELETE', path: `/athlete-group-bundles/${groupId}` })
}
