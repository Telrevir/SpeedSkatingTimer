import type { ActiveRaceSession } from '../domain/active-race-session'
import type {
  LocalLapCorrectionState,
  LocalRacePhase,
} from '../domain/local-race-scoring'

export interface ActiveRaceSessionStorage {
  read(): unknown
  write(value: unknown): void
  remove(): void
}

interface StoredActiveRaceSessionV1 extends Omit<ActiveRaceSession, 'lapCorrectionStates'> {
  schemaVersion: 1
}

interface StoredActiveRaceSessionV2 extends ActiveRaceSession {
  schemaVersion: 2
  lapCorrectionStates: LocalLapCorrectionState[]
}

export class ActiveRaceSessionRepository {
  constructor(private readonly storage: ActiveRaceSessionStorage) {}

  load(): ActiveRaceSession | null {
    const parsed = parseSession(this.storage.read())
    return parsed ? cloneSession(parsed) : null
  }

  save(session: ActiveRaceSession): void {
    assertSession(session)
    const stored: StoredActiveRaceSessionV2 = {
      schemaVersion: 2,
      ...cloneSession(session),
      lapCorrectionStates: cloneCorrectionStates(session.lapCorrectionStates ?? []),
    }
    this.storage.write(stored)
  }

  saveLapCorrectionStates(states: LocalLapCorrectionState[]): ActiveRaceSession {
    const current = this.load()
    if (!current) throw new Error('没有进行中的比赛')
    const next = { ...current, lapCorrectionStates: cloneCorrectionStates(states) }
    this.save(next)
    return cloneSession(next)
  }

  saveRaceProgress(
    states: LocalLapCorrectionState[],
    localPhase: Exclude<LocalRacePhase, 'idle'>,
    finishLap: number | null,
  ): ActiveRaceSession {
    const current = this.load()
    if (!current) throw new Error('没有进行中的比赛')
    const next = {
      ...current,
      lapCorrectionStates: cloneCorrectionStates(states),
      localPhase,
      finishLap,
    }
    this.save(next)
    return cloneSession(next)
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
  const candidate = value as Partial<ActiveRaceSession> & { schemaVersion?: unknown }
  if (candidate.schemaVersion !== 1 && candidate.schemaVersion !== 2) return null
  const session: ActiveRaceSession = {
    participantIds: Array.isArray(candidate.participantIds) ? candidate.participantIds : [],
    activeGroupId: candidate.activeGroupId ?? null,
    athleteDefinitionCount: candidate.athleteDefinitionCount ?? -1,
    nonAthleteDefinitionCount: candidate.nonAthleteDefinitionCount ?? -1,
  }
  if (candidate.schemaVersion === 2) {
    if (!Array.isArray(candidate.lapCorrectionStates)) return null
    session.lapCorrectionStates = candidate.lapCorrectionStates
    session.localPhase = candidate.localPhase ?? 'running'
    session.finishLap = candidate.finishLap ?? null
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
  if (session.lapCorrectionStates !== undefined) {
    if (!Array.isArray(session.lapCorrectionStates)
        || session.lapCorrectionStates.some((state) => (
          !isValidCorrectionState(state) || !session.participantIds.includes(state.athleteId)
        ))
        || new Set(session.lapCorrectionStates.map((state) => state.athleteId)).size
          !== session.lapCorrectionStates.length) {
      throw new Error('补圈状态格式无效')
    }
  }
  if (session.localPhase !== undefined) {
    if (!['running', 'finishing', 'finished'].includes(session.localPhase)) {
      throw new Error('本地比赛阶段格式无效')
    }
    const finishLap = session.finishLap ?? null
    if (session.localPhase === 'running' && finishLap !== null) {
      throw new Error('比赛进行中不能设置结束圈')
    }
    if (session.localPhase !== 'running'
        && (!Number.isInteger(finishLap) || finishLap === null || finishLap < 0)) {
      throw new Error('结束阶段必须保存有效结束圈')
    }
  }
}

function cloneSession(session: ActiveRaceSession): ActiveRaceSession {
  return {
    ...session,
    participantIds: [...session.participantIds],
    ...(session.lapCorrectionStates === undefined
      ? {}
      : { lapCorrectionStates: cloneCorrectionStates(session.lapCorrectionStates) }),
  }
}

function isValidCorrectionState(state: unknown): state is LocalLapCorrectionState {
  if (!state || typeof state !== 'object') return false
  const candidate = state as Partial<LocalLapCorrectionState>
  return Number.isInteger(candidate.athleteId)
    && candidate.athleteId! > 0
    && Number.isInteger(candidate.rawLapCount)
    && candidate.rawLapCount! >= 0
    && candidate.rawLapCount! <= 0xff
    && Number.isInteger(candidate.correctionOffset)
    && candidate.correctionOffset! >= 0
    && candidate.correctionOffset! <= 0xffff
    && Number.isInteger(candidate.lastTotalCentiseconds)
    && candidate.lastTotalCentiseconds! >= 0
    && candidate.lastTotalCentiseconds! <= 0xffffff
    && Number.isInteger(candidate.lastLapCentiseconds)
    && candidate.lastLapCentiseconds! >= 0
    && candidate.lastLapCentiseconds! <= 0xffffff
    && Array.isArray(candidate.validLapCentiseconds)
    && candidate.validLapCentiseconds.length <= 5
    && candidate.validLapCentiseconds.every((lap) => (
      Number.isInteger(lap) && lap >= 800 && lap <= 0xffffff
    ))
}

function cloneCorrectionStates(states: LocalLapCorrectionState[]): LocalLapCorrectionState[] {
  return states.map((state) => ({
    ...state,
    validLapCentiseconds: [...state.validLapCentiseconds],
  }))
}
