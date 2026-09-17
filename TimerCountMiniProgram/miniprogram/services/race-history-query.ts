import { parseRaceDate } from './backend-sync/validation'
import { listRaceBundles } from './backend-api/races/list-race-bundles'
import type { BackendClient } from './backend-api/request'
import type { RaceBundleDto, RaceBundleListQuery } from './backend-api/types'
import type { AthleteCatalogService } from './athlete-catalog-service'
import type { RaceRecord, ScoreRepository } from './score-repository'

export interface RaceHistorySearch {
  page?: number
  pageSize?: number
  sortBy?: 'RaceDate' | 'RaceID'
  sortOrder?: 'asc' | 'desc'
}

export interface RaceHistoryPage {
  records: RaceRecord[]
  page: number
  pageSize: number
  total: number
  hasPrevious: boolean
  hasNext: boolean
}

interface Options {
  client: BackendClient
  clubId: number
  scoreRepository: ScoreRepository
  athleteCatalog: AthleteCatalogService
}

/** 服务端历史是主数据；第一页额外合并尚未成功上传的本地比赛。 */
export class RaceHistoryQuery {
  private generation = 0

  constructor(private readonly options: Options) {}

  cancel(): void { this.generation += 1 }

  async loadPage(search: RaceHistorySearch = {}): Promise<RaceHistoryPage | null> {
    const generation = ++this.generation
    const query: RaceBundleListQuery = {
      ClubID: this.options.clubId,
      page: positive(search.page, 1),
      pageSize: Math.min(200, positive(search.pageSize, 20)),
      sortBy: search.sortBy ?? 'RaceDate',
      sortOrder: search.sortOrder ?? 'desc',
    }
    const response = await listRaceBundles(this.options.client, query)
    if (generation !== this.generation) return null
    if (!response.ok) throw new Error('比赛记录暂时无法加载')
    const data = response.data
    if (!data || !Array.isArray(data.list) || data.page !== query.page || data.pageSize !== query.pageSize
        || !Number.isInteger(data.total) || data.total < 0) throw new Error('服务器返回的比赛记录无效')

    const serverKeys = new Set(data.list.map((bundle) => bundle.RaceInfo.ClientRaceKey))
    const server = data.list.map((bundle) => this.fromServer(bundle))
    const offlineAll = this.options.scoreRepository.listRaces().filter((race) => !serverKeys.has(race.clientRaceKey))
    const offline = query.page === 1 ? offlineAll : []
    const records = [...server, ...offline]
      .sort((left, right) => query.sortOrder === 'desc' ? right.startedAt - left.startedAt : left.startedAt - right.startedAt)
      .slice(0, query.pageSize)
    return {
      records,
      page: data.page,
      pageSize: data.pageSize,
      total: data.total + offlineAll.length,
      hasPrevious: data.page > 1,
      hasNext: data.page * data.pageSize < data.total,
    }
  }

  private fromServer(bundle: RaceBundleDto): RaceRecord {
    const info = bundle?.RaceInfo
    if (!info || !Number.isInteger(info.RaceID) || info.RaceID! < 1 || info.ClubID !== this.options.clubId
        || typeof info.ClientRaceKey !== 'string' || !Array.isArray(bundle.AthleteRaceJoins)
        || !Array.isArray(bundle.Scores)) throw new Error('服务器比赛数据无效')
    const profiles = [...this.options.athleteCatalog.activeSnapshot, ...this.options.athleteCatalog.archivedSnapshot]
    const byId = new Map(profiles.map((profile) => [profile.id, profile]))
    return {
      id: `server-${info.RaceID}`,
      syncState: 'online',
      startedAt: parseRaceDate(info.RaceDate),
      finishedAt: info.IsFinished ? parseRaceDate(info.RaceDate) : null,
      participantIds: bundle.AthleteRaceJoins.filter((join) => join.Enabled).map((join) => join.AthleteID),
      scores: bundle.Scores.filter((score) => score.Enabled).sort(scoreOrder).map((score) => {
        const athlete = byId.get(score.AthleteID)
        return {
          athleteId: score.AthleteID,
          name: athlete?.name ?? `运动员 #${score.AthleteID}`,
          epc: athlete?.epc ?? '',
          lap: score.LapCount,
          correctedLap: score.LapCount,
          lapCentiseconds: score.SingleLapTime,
          totalCentiseconds: score.TotalTime,
          rank: score.Rank,
        }
      }),
    }
  }
}

function positive(value: number | undefined, fallback: number): number {
  return Number.isInteger(value) && value! > 0 ? value! : fallback
}

function scoreOrder(left: RaceBundleDto['Scores'][number], right: RaceBundleDto['Scores'][number]): number {
  return (left.EventSequence - right.EventSequence) || ((left.ScoreID ?? 0) - (right.ScoreID ?? 0))
}
