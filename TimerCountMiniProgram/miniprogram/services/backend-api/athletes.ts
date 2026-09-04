import { BackendClient, backendClient, type ApiResult } from './request'

export interface AthleteDto {
  AthleteID: number
  ClubID: number
  AthleteName: string
  AthleteEPC: number
  Enabled: boolean
}

export class AthletesApi {
  constructor(private readonly client: BackendClient = backendClient) {}
  create(athlete: AthleteDto): Promise<ApiResult<AthleteDto>> {
    return this.client.request({ method: 'POST', path: '/athletes', data: athlete })
  }

  // 单页接口返回分页信息；全量读取应使用 SyncDataApi，不能把第一页当成全部。
  list(clubId: number, page = 1): Promise<ApiResult<{ list: AthleteDto[]; page: number; pageSize: number; total: number }>> {
    return this.client.request({ method: 'GET', path: '/athletes',
      query: { ClubID: clubId, page, pageSize: 200, includeDisabled: true } })
  }
}
