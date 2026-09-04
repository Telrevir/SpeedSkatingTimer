import { BackendClient, backendClient, type ApiResult } from './request'

// 后端契约：RaceID 仅在“更新已有比赛”时由小程序携带；首次添加不带 RaceID，
// 由后端生成并在成功响应中返回，小程序随后绑定到本地比赛。Child RaceID 可省略，后端自动补齐。
export interface RaceInfoDto {
  RaceID?: number
  ClubID: number
  RaceDate: string
  Enabled: boolean
}
export interface RaceJoinDto {
  id: number
  RaceID?: number
  AthleteID: number
  Enabled: boolean
}
export interface ScoreDto {
  ScoreID: number
  RaceID?: number
  AthleteID: number
  LapCount: number
  SingleLapTime: number
  TotalTime: number
  Rank: number
  Enabled: boolean
}
export interface RaceBundleDto {
  RaceInfo: RaceInfoDto
  AthleteRaceJoins: RaceJoinDto[]
  Scores: ScoreDto[]
}

export class RaceBundlesApi {
  constructor(private readonly client: BackendClient = backendClient) {}
  upload(bundle: RaceBundleDto): Promise<ApiResult<RaceBundleDto>> {
    // 聚合提交一次，不拆分成多个 POST，不在接口层分配 ID 或制造虚拟成绩。
    return this.client.request({ method: 'POST', path: '/race-bundles', data: bundle })
  }
}
