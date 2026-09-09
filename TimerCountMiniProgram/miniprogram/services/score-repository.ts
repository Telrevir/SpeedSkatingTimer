import {
  isRaceIdentity,
  isRaceSyncState,
  isScoreIdentity,
  type RaceIdentity,
  type RaceSyncState,
  type ScoreIdentity,
} from '../domain/race-identity'

export interface LapScoreRecord {
  athleteId: number
  name: string
  epc: string
  lap: number
  rawLap?: number
  correctionOffset?: number
  correctedLap?: number
  lapCentiseconds: number
  totalCentiseconds: number
  rank: number
}

export interface RaceRecord {
  id: string
  startedAt: number
  finishedAt: number | null
  scores: LapScoreRecord[]
  participantIds?: number[]
}

export interface ScoreStorage {
  read(): unknown
  write(value: unknown): void
}

export class ScoreRepository {
  private records: RaceWorkingCopy[]
  private currentId: string | null = null
  private sequence = 0
  private readonly listeners = new Set<(records: RaceWorkingCopy[]) => void>()

  constructor(
    private readonly storage: ScoreStorage,
    private readonly now: () => number = () => Date.now(),
  ) {
    const restored = parseRecords(storage.read())
    this.records = restored.records
    this.currentId = restored.currentLocalId
    this.sequence = nextSequence(this.records)
  }

  beginRace(participantIds?: number[], startedAt: number = this.now()): RaceWorkingCopy {
    if (this.currentId !== null) {
      return cloneRace(this.records.find(({ localId }) => localId === this.currentId)!)
    }
    const timestamp = startedAt
    let id = `race-${timestamp}-${this.sequence++}`
    while (this.records.some((record) => record.localId === id)) {
      id = `race-${timestamp}-${this.sequence++}`
    }
    const record: RaceWorkingCopy = {
      id,
      localId: id,
      clientRaceKey: `race:${id}`,
      raceId: null,
      syncState: 'pending',
      startedAt: timestamp,
      finishedAt: null,
      scores: [],
      ...(participantIds === undefined ? {} : { participantIds: normalizeParticipantIds(participantIds) }),
    }
    this.records.unshift(record)
    this.currentId = id
    this.persist()
    return cloneRace(record)
  }

  appendScore(score: LapScoreRecord, historical: boolean): ScoreIdentity | null {
    if (historical) return null
    if (this.currentId === null) this.beginRace()
    const current = this.records.find(({ localId }) => localId === this.currentId)
    if (!current) return null
    const eventSequence = current.scores.reduce((maximum, item) => Math.max(maximum, item.eventSequence), 0) + 1
    const identity: ScoreIdentity = {
      localScoreId: `${current.localId}:score:${eventSequence}`,
      clientScoreKey: `score:${current.clientRaceKey}:${eventSequence}`,
      eventSequence,
      scoreId: null,
    }
    current.scores.push({ ...score, ...identity })
    this.persist()
    return { ...identity }
  }

  finishRace(localId: string | null = this.currentId): void {
    if (localId === null) return
    const current = this.records.find((record) => record.localId === localId)
    if (current) current.finishedAt = this.now()
    if (this.currentId === localId) this.currentId = null
    this.persist()
  }

  bindRaceOnline(localId: string, raceId: number): RaceWorkingCopy {
    if (!Number.isInteger(raceId) || raceId <= 0) throw new Error('服务器比赛 ID 必须是正整数')
    return this.updateRaceIdentity(localId, { raceId, syncState: 'online' })
  }

  markRaceOffline(localId: string): RaceWorkingCopy {
    return this.updateRaceIdentity(localId, { raceId: null, syncState: 'offline' })
  }

  bindScoreOnline(localScoreId: string, scoreId: number): void {
    if (!Number.isInteger(scoreId) || scoreId <= 0) throw new Error('服务器成绩 ID 必须是正整数')
    const record = this.records.find((item) => item.scores.some((score) => score.localScoreId === localScoreId))
    if (!record) throw new Error('找不到待绑定的本地成绩')
    const score = record.scores.find((item) => item.localScoreId === localScoreId)!
    score.scoreId = scoreId
    this.persist()
  }

  /**
   * 完成包回执必须一次性确认整场比赛：先在内存副本中验证所有映射，
   * 再用一次存储写入移除已完成工作副本。任何校验或写入失败都不改内存。
   */
  applyFinishedBundleReceipt(
    localId: string,
    raceId: number,
    receipts: readonly { clientScoreKey: string; scoreId: number; raceId: number }[],
  ): boolean {
    const record = this.records.find((item) => item.localId === localId)
    if (!record || record.finishedAt === null || !isPositiveInteger(raceId)) return false
    if (record.raceId !== null && record.raceId !== raceId) return false
    if (receipts.length !== record.scores.length) return false

    const localByKey = new Map(record.scores.map((score) => [score.clientScoreKey, score]))
    const receiptKeys = receipts.map((receipt) => receipt.clientScoreKey)
    if (!unique(receiptKeys) || receiptKeys.some((key) => !localByKey.has(key))) return false
    if (receipts.some((receipt) => !isPositiveInteger(receipt.scoreId) || receipt.raceId !== raceId)) return false
    if (record.scores.some((score) => score.scoreId !== null
      && receipts.find((receipt) => receipt.clientScoreKey === score.clientScoreKey)?.scoreId !== score.scoreId)) return false

    // 成功回执的最终状态是“已落库且可删除”，故不写入任何中间 online 版本。
    const nextRecords = this.records.filter((item) => item.localId !== localId).map(cloneRace)
    const nextCurrentId = this.currentId === localId ? null : this.currentId
    const stored: StoredScoreRecordsV2 = {
      schemaVersion: 2,
      currentLocalId: nextCurrentId,
      records: nextRecords,
    }
    try {
      this.storage.write(stored)
    } catch {
      return false
    }
    this.records = stored.records.map(cloneRace)
    this.currentId = stored.currentLocalId
    const snapshot = this.listRaces()
    this.listeners.forEach((listener) => listener(snapshot))
    return true
  }

  getWorkingCopy(localId: string): RaceWorkingCopy | null {
    const record = this.records.find((item) => item.localId === localId)
    return record ? cloneRace(record) : null
  }

  /** 自动补圈等重新计算只替换内容，稳定身份与事件序号保持不变。 */
  replaceScore(localScoreId: string, score: LapScoreRecord): void {
    const record = this.records.find((item) => item.scores.some((candidate) => candidate.localScoreId === localScoreId))
    if (!record) throw new Error('找不到待更新的本地成绩')
    const index = record.scores.findIndex((candidate) => candidate.localScoreId === localScoreId)
    const current = record.scores[index]!
    record.scores[index] = {
      ...score,
      localScoreId: current.localScoreId,
      clientScoreKey: current.clientScoreKey,
      eventSequence: current.eventSequence,
      scoreId: current.scoreId,
    }
    this.persist()
  }

  removeCompletedOnlineRace(localId: string): boolean {
    const record = this.records.find((item) => item.localId === localId)
    if (!record || record.finishedAt === null || record.syncState !== 'online') return false
    this.records = this.records.filter((item) => item.localId !== localId)
    if (this.currentId === localId) this.currentId = null
    this.persist()
    return true
  }

  listRaces(): RaceWorkingCopy[] {
    return this.records.map(cloneRace)
  }

  importIfMissing(record: RaceRecord): boolean {
    validateImportedRace(record)
    if (this.records.some(({ id }) => id === record.id)) return false
    const imported = migrateRace(record)
    const next = [...this.records.map(cloneRace), imported]
    // 历史导入不接管 currentId；写入失败不改变内存，也不发布未落盘数据。
    const stored: StoredScoreRecordsV2 = {
      schemaVersion: 2,
      currentLocalId: this.currentId,
      records: next.map(cloneRace),
    }
    this.storage.write(stored)
    this.records = stored.records.map(cloneRace)
    const snapshot = this.listRaces()
    this.listeners.forEach((listener) => listener(snapshot))
    return true
  }

  subscribe(listener: (records: RaceWorkingCopy[]) => void): () => void {
    this.listeners.add(listener)
    listener(this.listRaces())
    return () => this.listeners.delete(listener)
  }

  private persist(): void {
    const stored: StoredScoreRecordsV2 = {
      schemaVersion: 2,
      currentLocalId: this.currentId,
      records: this.records.map(cloneRace),
    }
    this.storage.write(stored)
    this.records = stored.records.map(cloneRace)
    const snapshot = this.listRaces()
    this.listeners.forEach((listener) => listener(snapshot))
  }

  private updateRaceIdentity(
    localId: string,
    patch: Pick<RaceIdentity, 'raceId' | 'syncState'>,
  ): RaceWorkingCopy {
    const record = this.records.find((item) => item.localId === localId)
    if (!record) throw new Error('找不到本地比赛工作副本')
    const identity: RaceIdentity = {
      localId: record.localId,
      clientRaceKey: record.clientRaceKey,
      raceId: patch.raceId,
      syncState: patch.syncState,
    }
    if (!isRaceIdentity(identity)) throw new Error('比赛同步身份格式无效')
    Object.assign(record, identity)
    this.persist()
    return cloneRace(record)
  }
}

function parseRecords(value: unknown): { records: RaceWorkingCopy[]; currentLocalId: string | null } {
  if (Array.isArray(value)) {
    return { records: value.filter(isLegacyRaceRecord).map(migrateRace), currentLocalId: null }
  }
  if (!value || typeof value !== 'object') return { records: [], currentLocalId: null }
  const candidate = value as Partial<StoredScoreRecordsV2>
  if (candidate.schemaVersion !== 2 || !Array.isArray(candidate.records)
    || (candidate.currentLocalId !== null && typeof candidate.currentLocalId !== 'string')) {
    return { records: [], currentLocalId: null }
  }
  const records = candidate.records.filter(isWorkingCopy).map(cloneRace)
  return {
    records,
    currentLocalId: candidate.currentLocalId !== null && records.some((record) => record.localId === candidate.currentLocalId)
      ? candidate.currentLocalId
      : null,
  }
}

function cloneRace(record: RaceWorkingCopy): RaceWorkingCopy {
  return { ...record, scores: record.scores.map((score) => ({ ...score })),
    ...(record.participantIds === undefined ? {} : { participantIds: [...record.participantIds] }) }
}

export interface PersistedLapScoreRecord extends LapScoreRecord, ScoreIdentity {}

/** 只保存活动比赛、离线比赛和等待服务器确认的比赛工作副本。 */
export interface RaceWorkingCopy extends Omit<RaceRecord, 'scores'>, RaceIdentity {
  scores: PersistedLapScoreRecord[]
}

interface StoredScoreRecordsV2 {
  schemaVersion: 2
  currentLocalId: string | null
  records: RaceWorkingCopy[]
}

function validateImportedRace(record: RaceRecord): void {
  if (!record || typeof record.id !== 'string' || !record.id.trim()
    || !Number.isFinite(record.startedAt)
    || (record.finishedAt !== null && !Number.isFinite(record.finishedAt))
    || !Array.isArray(record.scores)
    || (record.participantIds !== undefined && (!Array.isArray(record.participantIds)
      || Array.from(record.participantIds).some((id) => !validAthleteId(id))))) {
    throw new Error('导入比赛资料不合法')
  }
  for (const score of record.scores) {
    if (!score || !validAthleteId(score.athleteId) || typeof score.name !== 'string' || !score.name.trim()
      || typeof score.epc !== 'string' || !/^[0-9A-Fa-f]{8}$/.test(score.epc)
      || !validCount(score.lap) || !validCount(score.rank)
      || !validCount(score.lapCentiseconds) || !validCount(score.totalCentiseconds)
      || [score.rawLap, score.correctionOffset, score.correctedLap].some((count) => count !== undefined && !validCount(count))) {
      throw new Error('导入成绩资料不合法')
    }
  }
}

function validAthleteId(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 65535
}

function validCount(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 0x7fffffff
}

function isLegacyRaceRecord(value: unknown): value is RaceRecord {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<RaceRecord>
  return typeof candidate.id === 'string' && candidate.id.trim().length > 0
    && typeof candidate.startedAt === 'number' && Array.isArray(candidate.scores)
}

function isWorkingCopy(value: unknown): value is RaceWorkingCopy {
  if (!isLegacyRaceRecord(value) || !isRaceIdentity(value)) return false
  const candidate = value as Partial<RaceWorkingCopy>
  return candidate.id === candidate.localId
    && candidate.scores!.every((score) => isValidScore(score) && isScoreIdentity(score))
    && unique(candidate.scores!.map((score) => score.localScoreId))
    && unique(candidate.scores!.map((score) => score.clientScoreKey))
    && unique(candidate.scores!.map((score) => score.eventSequence))
}

function migrateRace(record: RaceRecord): RaceWorkingCopy {
  const candidate = record as Partial<RaceWorkingCopy>
  const localId = isNonEmptyString(candidate.localId) ? candidate.localId : record.id
  const clientRaceKey = isNonEmptyString(candidate.clientRaceKey) ? candidate.clientRaceKey : `legacy:${localId}`
  const raceId = isPositiveInteger(candidate.raceId) ? candidate.raceId : null
  const syncState: RaceSyncState = isRaceSyncState(candidate.syncState)
    ? candidate.syncState
    : (raceId === null ? 'offline' : 'online')
  const identity: RaceIdentity = { localId, clientRaceKey, raceId, syncState }
  if (!isRaceIdentity(identity)) throw new Error('比赛同步身份格式无效')
  return {
    id: localId,
    ...identity,
    startedAt: record.startedAt,
    finishedAt: record.finishedAt,
    scores: record.scores.map((score, index) => migrateScore(score, localId, clientRaceKey, index + 1)),
    ...(record.participantIds === undefined ? {} : { participantIds: normalizeParticipantIds(record.participantIds) }),
  }
}

function migrateScore(
  score: LapScoreRecord,
  raceLocalId: string,
  clientRaceKey: string,
  fallbackSequence: number,
): PersistedLapScoreRecord {
  const candidate = score as Partial<PersistedLapScoreRecord>
  const eventSequence = isPositiveInteger(candidate.eventSequence) ? candidate.eventSequence : fallbackSequence
  const identity: ScoreIdentity = {
    localScoreId: isNonEmptyString(candidate.localScoreId) ? candidate.localScoreId : `${raceLocalId}:score:${eventSequence}`,
    clientScoreKey: isNonEmptyString(candidate.clientScoreKey)
      ? candidate.clientScoreKey
      : `score:${clientRaceKey}:${eventSequence}`,
    eventSequence,
    scoreId: isPositiveInteger(candidate.scoreId) ? candidate.scoreId : null,
  }
  if (!isScoreIdentity(identity) || !isValidScore(score)) throw new Error('导入成绩资料不合法')
  return { ...score, ...identity }
}

function isValidScore(score: unknown): score is LapScoreRecord {
  if (!score || typeof score !== 'object') return false
  const candidate = score as Partial<LapScoreRecord>
  return validAthleteId(candidate.athleteId as number) && typeof candidate.name === 'string' && candidate.name.trim().length > 0
    && typeof candidate.epc === 'string' && /^[0-9A-Fa-f]{8}$/.test(candidate.epc)
    && validCount(candidate.lap as number) && validCount(candidate.rank as number)
    && validCount(candidate.lapCentiseconds as number) && validCount(candidate.totalCentiseconds as number)
    && [candidate.rawLap, candidate.correctionOffset, candidate.correctedLap]
      .every((count) => count === undefined || validCount(count))
}

function normalizeParticipantIds(ids: number[]): number[] {
  if (!ids.every((id) => validAthleteId(id))) throw new Error('导入比赛资料不合法')
  return [...new Set(ids)]
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

function unique(values: readonly (string | number)[]): boolean {
  return new Set(values).size === values.length
}

function nextSequence(records: readonly RaceWorkingCopy[]): number {
  return records.reduce((maximum, record) => {
    const suffix = /-(\d+)$/.exec(record.localId)
    return Math.max(maximum, suffix ? Number(suffix[1]) + 1 : 0)
  }, 0)
}
