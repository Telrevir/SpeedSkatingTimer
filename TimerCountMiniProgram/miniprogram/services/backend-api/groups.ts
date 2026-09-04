import { BackendClient, backendClient, type ApiResult } from './request'

export interface GroupDto {
  AthleteGroupID: number
  ClubID: number
  AthleteGroupName: string
  Enabled: boolean
}

export class GroupsApi {
  constructor(private readonly client: BackendClient = backendClient) {}
  create(group: GroupDto): Promise<ApiResult<GroupDto>> {
    return this.client.request({ method: 'POST', path: '/athlete-groups', data: group })
  }

  // 单页接口返回分页信息；全量读取应使用 SyncDataApi，不能把第一页当成全部。
  list(clubId: number, page = 1): Promise<ApiResult<{ list: GroupDto[]; page: number; pageSize: number; total: number }>> {
    return this.client.request({ method: 'GET', path: '/athlete-groups',
      query: { ClubID: clubId, page, pageSize: 200, includeDisabled: true } })
  }
}
