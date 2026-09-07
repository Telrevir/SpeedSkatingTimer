import type { ApiResult, BackendClient } from '../request'
import type { GroupMemberDto, GroupMemberListQuery, PageResultDto } from '../types'

export function listGroupMembers(client: BackendClient, query: GroupMemberListQuery): Promise<ApiResult<PageResultDto<GroupMemberDto>>> {
  return client.request({ method: 'GET', path: '/athlete-group-forms', query })
}
