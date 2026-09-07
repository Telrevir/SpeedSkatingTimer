export interface AthleteDto {
  AthleteID: number
  ClubID: number
  AthleteName: string
  AthleteEPC: number
  Enabled: boolean
}

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
  RaceID?: number
  AthleteID: number
  Enabled: boolean
}

export interface ScoreDto {
  ScoreID?: number
  RaceID?: number
  AthleteID: number
  ClientScoreKey: string
  EventSequence: number
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
