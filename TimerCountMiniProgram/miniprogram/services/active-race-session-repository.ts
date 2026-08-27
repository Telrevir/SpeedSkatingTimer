import type { ActiveRaceSession } from '../domain/active-race-session'

export interface ActiveRaceSessionStorage {
  read(): unknown
  write(value: unknown): void
  remove(): void
}

interface StoredActiveRaceSession extends ActiveRaceSession {
  schemaVersion: 1
}

export class ActiveRaceSessionRepository {
  constructor(private readonly storage: ActiveRaceSessionStorage) {}

  load(): ActiveRaceSession | null {
    const parsed = parseSession(this.storage.read())
    return parsed ? cloneSession(parsed) : null
  }

  save(session: ActiveRaceSession): void {
    assertSession(session)
    const stored: StoredActiveRaceSession = {
      schemaVersion: 1,
      ...cloneSession(session),
    }
    this.storage.write(stored)
  }

  incrementDefinition(isAthlete: boolean): ActiveRaceSession {
    const current = this.load()
    if (!current) throw new Error('没有进行中的比赛')
    const key = isAthlete ? 'athleteDefinitionCount' : 'nonAthleteDefinitionCount'
    if (current[key] >= 50) throw new Error('每场最多定义 50 个该类 EPC')
    const next = { ...current, [key]: current[key] + 1 }
    this.save(next)
    return cloneSession(next)
  }

  clear(): void {
    this.storage.remove()
  }
}

function parseSession(value: unknown): ActiveRaceSession | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<StoredActiveRaceSession>
  if (candidate.schemaVersion !== 1) return null
  const session: ActiveRaceSession = {
    participantIds: Array.isArray(candidate.participantIds) ? candidate.participantIds : [],
    activeGroupId: candidate.activeGroupId ?? null,
    athleteDefinitionCount: candidate.athleteDefinitionCount ?? -1,
    nonAthleteDefinitionCount: candidate.nonAthleteDefinitionCount ?? -1,
  }
  try {
    assertSession(session)
    return session
  } catch {
    return null
  }
}

function assertSession(session: ActiveRaceSession): void {
  if (!Array.isArray(session.participantIds)
      || session.participantIds.length === 0
      || session.participantIds.length > 50
      || new Set(session.participantIds).size !== session.participantIds.length
      || session.participantIds.some((id) => !Number.isInteger(id) || id <= 0 || id > 0xffff)) {
    throw new Error('参赛运动员 ID 必须是 1 到 65535 的唯一整数，且人数为 1 到 50')
  }
  if (session.activeGroupId !== null
      && (typeof session.activeGroupId !== 'string' || !session.activeGroupId.trim())) {
    throw new Error('分组 ID 必须是非空字符串或 null')
  }
  for (const count of [session.athleteDefinitionCount, session.nonAthleteDefinitionCount]) {
    if (!Number.isInteger(count) || count < 0 || count > 50) {
      throw new Error('EPC 定义数量必须是 0 到 50 的整数')
    }
  }
}

function cloneSession(session: ActiveRaceSession): ActiveRaceSession {
  return { ...session, participantIds: [...session.participantIds] }
}
