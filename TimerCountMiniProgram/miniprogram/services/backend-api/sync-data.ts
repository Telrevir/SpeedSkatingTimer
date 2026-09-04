import { BackendClient, backendClient, type ApiResult } from './request'
import { BACKEND_CONFIG } from './config'
import type { AthleteDto } from './athletes'
import type { GroupDto } from './groups'
import type { GroupMemberDto } from './group-members'
import type { RaceBundleDto } from './race-bundles'

export interface ClubDataDto {
  ClubID: number
  Athletes: AthleteDto[]
  AthleteGroups: GroupDto[]
  AthleteGroupForms: GroupMemberDto[]
  RaceBundles: RaceBundleDto[]
}

export class SyncDataApi {
  constructor(private readonly client: BackendClient = backendClient) {}
  fetchAll(clubId: number = BACKEND_CONFIG.clubId): Promise<ApiResult<ClubDataDto>> {
    // 读取职责独立；后端确认复用 race-bundles，不另设 sync-data 路由。
    // 包含禁用记录，避免下一阶段把服务端软删除误当成服务端缺失而重新上传。
    return this.client.request({ method: 'GET', path: '/race-bundles', query: { ClubID: clubId, includeDisabled: true } })
  }
}
