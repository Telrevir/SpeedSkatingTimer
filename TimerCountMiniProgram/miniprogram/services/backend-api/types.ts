export interface AthleteDto {
  AthleteID: number
  ClubID: number
  AthleteName: string
  AthleteEPC: number
  Enabled: boolean
}

/** 新建运动员由后端生成 AthleteID；请求禁止携带该字段。 */
export type AthleteCreateDto = Omit<AthleteDto, 'AthleteID'>

export interface GroupDto {
  AthleteGroupID: number
  ClubID: number
  AthleteGroupName: string
  Enabled: boolean
}

export interface GroupMemberDto {
  AthleteGroupFormID?: number
  AthleteGroupID: number
  AthleteID: number
  Enabled: boolean
}

/** 新建分组由后端生成主键；请求不包含 AthleteGroupID。 */
export type GroupCreateDto = Omit<GroupDto, 'AthleteGroupID'>

/** 新建分组成员关系由后端绑定父分组并生成关系主键。 */
export type GroupMemberCreateDto = Omit<GroupMemberDto, 'AthleteGroupFormID' | 'AthleteGroupID'>

export interface GroupBundleCreateDto {
  AthleteGroup: GroupCreateDto
  AthleteGroupForms: GroupMemberCreateDto[]
}

/** 更新通过 URL 中的分组 ID 定位；已有成员可附带其关系 ID。 */
export interface GroupBundleUpdateDto {
  AthleteGroup: GroupCreateDto
  AthleteGroupForms: Array<GroupMemberCreateDto & Pick<GroupMemberDto, 'AthleteGroupFormID'>>
}

export interface RaceInfoDto {
  RaceID?: number
  ClientRaceKey: string
  ClubID: number
  RaceDate: string
  IsFinished: boolean
  Enabled: boolean
}

export interface RaceJoinDto {
  id?: number
  RaceID: number
  AthleteID: number
  Enabled: boolean
}

/** 完整比赛包首次上传时，后端允许省略子记录的父比赛 ID。 */
export interface RaceBundleJoinDto extends Omit<RaceJoinDto, 'RaceID'> {
  RaceID?: number
}

export interface ScoreDto {
  ScoreID?: number
  RaceID: number
  AthleteID: number
  ClientScoreKey: string
  EventSequence: number
  LapCount: number
  SingleLapTime: number
  TotalTime: number
  Rank: number
  Enabled: boolean
}

/** 完整比赛包首次上传时，后端允许省略子记录的父比赛 ID。 */
export interface RaceBundleScoreDto extends Omit<ScoreDto, 'RaceID'> {
  RaceID?: number
}

export interface RaceBundleDto {
  RaceInfo: RaceInfoDto
  AthleteRaceJoins: RaceBundleJoinDto[]
  Scores: RaceBundleScoreDto[]
}

export interface PageResultDto<T> {
  list: T[]
  page: number
  pageSize: number
  total: number
  sortBy?: 'RaceDate' | 'RaceID'
  sortOrder?: 'asc' | 'desc'
}

export interface ActiveRacesDto {
  list: RaceInfoDto[]
  total: number
  ServerTime: string
}

export interface LatestScoresDto {
  RaceID: number
  Scores: ScoreDto[]
}

export interface AthleteListQuery {
  ClubID: number
  page: number
  pageSize: number
  includeDisabled: boolean
}

export interface GroupListQuery extends AthleteListQuery {}

export interface GroupMemberListQuery {
  AthleteGroupID: number
  page: number
  pageSize: number
  includeDisabled: boolean
}

export interface RaceBundleListQuery {
  ClubID: number
  page: number
  pageSize: number
  sortBy: 'RaceDate' | 'RaceID'
  sortOrder: 'asc' | 'desc'
}

export interface GroupBundleDto {
  AthleteGroup: GroupDto
  AthleteGroupForms: GroupMemberDto[]
}