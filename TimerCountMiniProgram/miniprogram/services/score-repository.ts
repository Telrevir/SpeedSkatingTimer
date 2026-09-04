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
  private records: RaceRecord[]
  private currentId: string | null = null
  private sequence = 0
  private readonly listeners = new Set<(records: RaceRecord[]) => void>()

  constructor(
    private readonly storage: ScoreStorage,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.records = parseRecords(storage.read())
  }

  beginRace(): RaceRecord {
    if (this.currentId !== null) {
      return this.records.find(({ id }) => id === this.currentId)!
    }
    const timestamp = this.now()
    let id = `${timestamp}-${this.sequence++}`
    while (this.records.some((record) => record.id === id)) {
      id = `${timestamp}-${this.sequence++}`
    }
    const record: RaceRecord = { id, startedAt: timestamp, finishedAt: null, scores: [] }
    this.records.unshift(record)
    this.currentId = id
    this.persist()
    return cloneRace(record)
  }

  appendScore(score: LapScoreRecord, historical: boolean): void {
    if (historical) return
    if (this.currentId === null) this.beginRace()
    const current = this.records.find(({ id }) => id === this.currentId)
    if (!current) return
    current.scores.push({ ...score })
    this.persist()
  }

  finishRace(): void {
    if (this.currentId === null) return
    const current = this.records.find(({ id }) => id === this.currentId)
    if (current) current.finishedAt = this.now()
    this.currentId = null
    this.persist()
  }

  listRaces(): RaceRecord[] {
    return this.records.map(cloneRace)
  }

  importIfMissing(record: RaceRecord): boolean {
    validateImportedRace(record)
    if (this.records.some(({ id }) => id === record.id)) return false
    const imported = cloneRace(record)
    if (imported.participantIds) imported.participantIds = [...new Set(imported.participantIds)]
    const next = [...this.records.map(cloneRace), imported]
    // 历史导入不接管 currentId；写入失败不改变内存，也不发布未落盘数据。
    this.storage.write(next.map(cloneRace))
    this.records = next
    const snapshot = this.listRaces()
    this.listeners.forEach((listener) => listener(snapshot))
    return true
  }

  subscribe(listener: (records: RaceRecord[]) => void): () => void {
    this.listeners.add(listener)
    listener(this.listRaces())
    return () => this.listeners.delete(listener)
  }

  private persist(): void {
    this.storage.write(this.records)
    const snapshot = this.listRaces()
    this.listeners.forEach((listener) => listener(snapshot))
  }
}

function parseRecords(value: unknown): RaceRecord[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is RaceRecord => {
    if (typeof item !== 'object' || item === null) return false
    const candidate = item as Partial<RaceRecord>
    return typeof candidate.id === 'string'
      && typeof candidate.startedAt === 'number'
      && Array.isArray(candidate.scores)
  }).map(cloneRace)
}

function cloneRace(record: RaceRecord): RaceRecord {
  return { ...record, scores: record.scores.map((score) => ({ ...score })),
    ...(record.participantIds === undefined ? {} : { participantIds: [...record.participantIds] }) }
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
