import { BackendClient, backendClient, type ApiResult } from './request'

export interface GroupMemberDto {
  AthleteGroupFormID: number
  AthleteGroupID: number
  AthleteID: number
  Enabled: boolean
}

export class GroupMembersApi {
  constructor(private readonly client: BackendClient = backendClient) {}
  create(member: GroupMemberDto): Promise<ApiResult<GroupMemberDto>> {
    return this.client.request({ method: 'POST', path: '/athlete-group-forms', data: member })
  }

  // 单页接口返回分页信息；全量读取应使用 SyncDataApi，不能把第一页当成全部。
  list(groupId: number, page = 1): Promise<ApiResult<{ list: GroupMemberDto[]; page: number; pageSize: number; total: number }>> {
    return this.client.request({ method: 'GET', path: '/athlete-group-forms',
      query: { AthleteGroupID: groupId, page, pageSize: 200, includeDisabled: true } })
  }
}
