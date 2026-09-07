import type { ApiResult, BackendClient } from '../request'
import type { GroupDto, GroupListQuery, PageResultDto } from '../types'

export function listGroups(client: BackendClient, query: GroupListQuery): Promise<ApiResult<PageResultDto<GroupDto>>> {
  return client.request({ method: 'GET', path: '/athlete-groups', query })
}
