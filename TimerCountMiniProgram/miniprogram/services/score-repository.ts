export interface LapScoreRecord {
  athleteId: number
  name: string
  epc: string
  lap: number
  lapCentiseconds: number
  totalCentiseconds: number
  rank: number
}

export interface RaceRecord {
  id: string
  startedAt: number
  finishedAt: number | null
  scores: LapScoreRecord[]
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
  return { ...record, scores: record.scores.map((score) => ({ ...score })) }
}
