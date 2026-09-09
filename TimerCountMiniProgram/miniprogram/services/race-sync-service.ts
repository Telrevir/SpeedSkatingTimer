import { createRace } from './backend-api/races/create-race'
import { createScore } from './backend-api/races/create-score'
import { saveRaceBundle } from './backend-api/races/save-race-bundle'
import type { ApiResult, BackendClient } from './backend-api/request'
import type { RaceBundleDto, RaceInfoDto, ScoreDto } from './backend-api/types'
import type { RaceIdentity, ScoreIdentity } from '../domain/race-identity'
import type { RaceOutboxTask } from './race-outbox-repository'
import { RaceOutboxRepository } from './race-outbox-repository'
import { ScoreRepository, type LapScoreRecord, type RaceWorkingCopy } from './score-repository'

export interface RaceSyncWake { wake(): void }

export interface RaceSyncServiceOptions {
  scoreRepository: ScoreRepository
  outbox: RaceOutboxRepository
  scheduler: RaceSyncWake
  client: BackendClient
  clubId: number
  request?: (endpoint: 'create-race' | 'create-score' | 'save-race-bundle', payload: RaceInfoDto | ScoreDto | RaceBundleDto, task: RaceOutboxTask) => Promise<ApiResult<unknown>>
}

/** 比赛生命周期只编排本地工作副本、任务箱与端点，不接触 BLE 或页面。 */
export class RaceSyncService {
  constructor(private readonly options: RaceSyncServiceOptions) {}

  begin(participantIds: number[], startedAt: number): RaceIdentity {
    const race = this.options.scoreRepository.beginRace(participantIds, startedAt)
    this.options.outbox.enqueueCreate(race.localId, race.clientRaceKey)
    this.options.scheduler.wake()
    return identityOf(race)
  }

  recordScore(localId: string, score: LapScoreRecord, historical: boolean): ScoreIdentity | null {
    const race = requiredRace(this.options.scoreRepository, localId)
    if (historical) return null
    const identity = this.options.scoreRepository.appendScore(score, false)
    if (!identity) return null
    if (race.syncState !== 'offline') this.options.outbox.enqueueScore(localId, identity.clientScoreKey)
    this.options.scheduler.wake()
    return identity
  }

  finish(localId: string): void {
    const race = requiredRace(this.options.scoreRepository, localId)
    this.options.scoreRepository.finishRace(localId)
    // 离线比赛同样持久化 finish；下次唤醒用完整包按 ClientRaceKey 对账。
    this.options.outbox.enqueueFinish(localId, race.clientRaceKey)
    this.options.scheduler.wake()
  }

  async execute(task: RaceOutboxTask): Promise<ApiResult<unknown>> {
    const race = this.options.scoreRepository.getWorkingCopy(task.raceLocalId)
    if (!race) return { ok: true, httpStatus: 200, data: {} }
    switch (task.kind) {
      case 'create': return this.create(race, task)
      case 'score': return this.saveScore(race, task)
      case 'finish': return this.saveFinishedBundle(race, task)
    }
  }

  private async create(race: RaceWorkingCopy, task: RaceOutboxTask): Promise<ApiResult<unknown>> {
    if (race.syncState !== 'pending') return { ok: true, httpStatus: 200, data: {} }
    const payload = raceInfo(race, this.options.clubId, false)
    const result = (this.options.request
      ? await this.options.request('create-race', payload, task)
      : await createRace(this.options.client, payload)) as ApiResult<RaceInfoDto>
    if (!result.ok || !validRaceReceipt(result.data, race)) {
      // 创建仅允许一次；失败后退役任务，之后只在完成包中用同一 ClientRaceKey 对账。
      this.options.scoreRepository.markRaceOffline(race.localId)
      return { ok: true, httpStatus: 200, data: {} }
    }
    this.options.scoreRepository.bindRaceOnline(race.localId, result.data.RaceID!)
    return result
  }

  private async saveScore(race: RaceWorkingCopy, task: RaceOutboxTask): Promise<ApiResult<unknown>> {
    if (race.syncState !== 'online' || race.raceId === null) return { ok: true, httpStatus: 200, data: {} }
    const score = race.scores.find((item) => item.clientScoreKey === task.clientKey)
    if (!score) return { ok: true, httpStatus: 200, data: {} }
    const payload = scoreDto(race.raceId, score)
    const result = (this.options.request
      ? await this.options.request('create-score', payload, task)
      : await createScore(this.options.client, payload)) as ApiResult<ScoreDto>
    if (result.ok && validScoreReceipt(result.data, race.raceId, score)) {
      this.options.scoreRepository.bindScoreOnline(score.localScoreId, result.data.ScoreID!)
      return result
    }
    return result.ok ? invalidReceipt('成绩回执与本地幂等键不匹配') : result
  }

  private async saveFinishedBundle(race: RaceWorkingCopy, task: RaceOutboxTask): Promise<ApiResult<unknown>> {
    const payload = bundle(race, this.options.clubId)
    const result = (this.options.request
      ? await this.options.request('save-race-bundle', payload, task)
      : await saveRaceBundle(this.options.client, payload)) as ApiResult<RaceBundleDto>
    if (result.ok && this.applyBundleReceipt(result.data, race)) {
      return result
    }
    return result.ok ? invalidReceipt('完成包回执不完整或与本地比赛不匹配') : result
  }

  private applyBundleReceipt(receipt: RaceBundleDto, race: RaceWorkingCopy): boolean {
    if (!validBundleReceipt(receipt, race)) return false
    try {
      const raceId = receipt.RaceInfo.RaceID!
      return this.options.scoreRepository.applyFinishedBundleReceipt(race.localId, raceId, receipt.Scores.map((score) => ({
        clientScoreKey: score.ClientScoreKey,
        scoreId: score.ScoreID!,
        raceId: score.RaceID!,
      })))
    } catch {
      return false
    }
  }
}

function requiredRace(repository: ScoreRepository, localId: string): RaceWorkingCopy {
  const race = repository.getWorkingCopy(localId)
  if (!race) throw new Error('找不到比赛工作副本')
  return race
}

function identityOf(race: RaceWorkingCopy): RaceIdentity {
  return { localId: race.localId, clientRaceKey: race.clientRaceKey, raceId: race.raceId, syncState: race.syncState }
}

function raceInfo(race: RaceWorkingCopy, clubId: number, finished: boolean): RaceInfoDto {
  return { ...(race.raceId === null ? {} : { RaceID: race.raceId }), ClientRaceKey: race.clientRaceKey,
    ClubID: clubId, RaceDate: dateTime(race.startedAt), IsFinished: finished, Enabled: true }
}

function scoreDto(raceId: number, score: RaceWorkingCopy['scores'][number]): ScoreDto {
  return { ...(score.scoreId === null ? {} : { ScoreID: score.scoreId }), RaceID: raceId, AthleteID: score.athleteId,
    ClientScoreKey: score.clientScoreKey, EventSequence: score.eventSequence, LapCount: score.lap,
    SingleLapTime: score.lapCentiseconds, TotalTime: score.totalCentiseconds, Rank: score.rank, Enabled: true }
}

function bundle(race: RaceWorkingCopy, clubId: number): RaceBundleDto {
  return { RaceInfo: raceInfo(race, clubId, true),
    AthleteRaceJoins: (race.participantIds ?? []).map((AthleteID) => ({ ...(race.raceId === null ? {} : { RaceID: race.raceId }), AthleteID, Enabled: true })),
    Scores: race.scores.map((score) => ({
      ...(score.scoreId === null ? {} : { ScoreID: score.scoreId }),
      ...(race.raceId === null ? {} : { RaceID: race.raceId }),
      AthleteID: score.athleteId, ClientScoreKey: score.clientScoreKey, EventSequence: score.eventSequence,
      LapCount: score.lap, SingleLapTime: score.lapCentiseconds, TotalTime: score.totalCentiseconds,
      Rank: score.rank, Enabled: true,
    })),
  }
}

function validRaceReceipt(value: RaceInfoDto, race: RaceWorkingCopy): boolean {
  return Number.isInteger(value.RaceID) && value.RaceID! > 0
    && value.ClientRaceKey === race.clientRaceKey && value.IsFinished === false && value.Enabled === true
}
function validScoreReceipt(value: ScoreDto, raceId: number, local: RaceWorkingCopy['scores'][number]): boolean {
  return Number.isInteger(value.ScoreID) && value.ScoreID! > 0 && value.RaceID === raceId
    && value.ClientScoreKey === local.clientScoreKey && value.AthleteID === local.athleteId
    && value.EventSequence === local.eventSequence && value.Enabled === true
}
function validBundleReceipt(value: RaceBundleDto, race: RaceWorkingCopy): boolean {
  if (!value || !value.RaceInfo || !Array.isArray(value.AthleteRaceJoins) || !Array.isArray(value.Scores)) return false
  if (value.RaceInfo.ClientRaceKey !== race.clientRaceKey || value.RaceInfo.IsFinished !== true
      || !Number.isInteger(value.RaceInfo.RaceID) || value.RaceInfo.RaceID! <= 0) return false
  const raceId = value.RaceInfo.RaceID!
  const participantIds = race.participantIds ?? []
  if (value.AthleteRaceJoins.length !== participantIds.length) return false
  const participantSet = new Set(participantIds)
  const joinIds = value.AthleteRaceJoins.map((join) => join.id)
  if (new Set(value.AthleteRaceJoins.map((join) => join.AthleteID)).size !== value.AthleteRaceJoins.length
      || new Set(joinIds).size !== joinIds.length
      || joinIds.some((id) => !Number.isInteger(id) || id! <= 0)
      || value.AthleteRaceJoins.some((join) => join.RaceID !== raceId || join.Enabled !== true
        || !participantSet.has(join.AthleteID))) return false
  const scoreIds = value.Scores.map((score) => score.ScoreID)
  if (new Set(scoreIds).size !== scoreIds.length) return false
  return value.Scores.length === race.scores.length && race.scores.every((local) => value.Scores.some((remote) => (
    remote.ClientScoreKey === local.clientScoreKey
      && Number.isInteger(remote.ScoreID) && remote.ScoreID! > 0
      && remote.RaceID === raceId
      && remote.AthleteID === local.athleteId
      && remote.EventSequence === local.eventSequence
      && remote.LapCount === local.lap
      && remote.SingleLapTime === local.lapCentiseconds
      && remote.TotalTime === local.totalCentiseconds
      && remote.Rank === local.rank
      && remote.Enabled === true
  )))
}
function invalidReceipt(message: string): ApiResult<never> {
  return { ok: false, kind: 'invalid-response', message }
}
function dateTime(value: number): string {
  const date = new Date(value)
  const n = (part: number) => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${n(date.getMonth() + 1)}-${n(date.getDate())} ${n(date.getHours())}:${n(date.getMinutes())}:${n(date.getSeconds())}`
}
