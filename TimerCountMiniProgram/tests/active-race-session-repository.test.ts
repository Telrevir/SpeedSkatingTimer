import assert from 'node:assert/strict'
import test from 'node:test'

import type { ActiveRaceSession } from '../miniprogram/domain/active-race-session'
import type { RaceIdentity } from '../miniprogram/domain/race-identity'
import { ScoreRepository, type ScoreStorage } from '../miniprogram/services/score-repository'
import {
  ActiveRaceSessionRepository,
  type ActiveRaceSessionStorage,
} from '../miniprogram/services/active-race-session-repository'

class MemoryStorage implements ActiveRaceSessionStorage {
  value: unknown = null
  read(): unknown { return this.value }
  write(value: unknown): void { this.value = value }
  remove(): void { this.value = null }
}

const session: ActiveRaceSession = {
  participantIds: [1, 2],
  activeGroupId: 'group-a',
  athleteDefinitionCount: 0,
  nonAthleteDefinitionCount: 0,
}

class ScoreMemoryStorage implements ScoreStorage {
  value: unknown = null
  read(): unknown { return this.value }
  write(value: unknown): void { this.value = value }
}

const savedSession: ActiveRaceSession = {
  ...session,
  lapCorrectionStates: [],
  localPhase: 'running',
  finishLap: null,
}

test('saves, clones and clears an active race session', () => {
  const storage = new MemoryStorage()
  const repository = new ActiveRaceSessionRepository(storage)

  repository.save(session)
  const loaded = repository.load()!
  assert.deepEqual(loaded, savedSession)
  loaded.participantIds.push(3)
  assert.deepEqual(repository.load()?.participantIds, [1, 2])

  repository.clear()
  assert.equal(repository.load(), null)
})

test('increments only the selected successful definition count', () => {
  const repository = new ActiveRaceSessionRepository(new MemoryStorage())
  repository.save(session)

  assert.deepEqual(repository.incrementDefinition(true), {
    ...savedSession,
    athleteDefinitionCount: 1,
  })
  assert.deepEqual(repository.incrementDefinition(false), {
    ...savedSession,
    athleteDefinitionCount: 1,
    nonAthleteDefinitionCount: 1,
  })
})

test('rejects invalid sessions and definition count overflow', () => {
  const storage = new MemoryStorage()
  const repository = new ActiveRaceSessionRepository(storage)
  assert.throws(() => repository.save({ ...session, participantIds: [1, 1] }), /参赛运动员/)
  assert.throws(() => repository.save({ ...session, participantIds: [0] }), /参赛运动员/)
  assert.throws(() => repository.save({ ...session, activeGroupId: '' }), /分组 ID/)
  assert.throws(() => repository.save({ ...session, athleteDefinitionCount: 51 }), /定义数量/)
  assert.throws(() => repository.incrementDefinition(true), /进行中的比赛/)

  repository.save({ ...session, athleteDefinitionCount: 50 })
  assert.throws(() => repository.incrementDefinition(true), /最多定义 50/)
})

test('returns null for absent or malformed storage values', () => {
  const storage = new MemoryStorage()
  const repository = new ActiveRaceSessionRepository(storage)
  assert.equal(repository.load(), null)
  storage.value = { schemaVersion: 1, ...session, participantIds: ['1'] }
  assert.equal(repository.load(), null)
})

test('resume binds active session to the original working copy', () => {
  const scoreStorage = new ScoreMemoryStorage()
  const scoreRepository = new ScoreRepository(scoreStorage, () => 1000)
  const race = scoreRepository.beginRace()
  const raceIdentity: RaceIdentity = {
    localId: race.localId,
    clientRaceKey: race.clientRaceKey,
    raceId: null,
    syncState: 'pending',
  }
  const sessionStorage = new MemoryStorage()
  new ActiveRaceSessionRepository(sessionStorage).save({ ...savedSession, raceIdentity })

  const recoveredSession = new ActiveRaceSessionRepository(sessionStorage).load()!
  const recoveredRace = new ScoreRepository(scoreStorage).getWorkingCopy(recoveredSession.raceIdentity!.localId)

  assert.deepEqual(recoveredSession.raceIdentity, raceIdentity)
  assert.deepEqual(recoveredRace && {
    localId: recoveredRace.localId,
    clientRaceKey: recoveredRace.clientRaceKey,
    raceId: recoveredRace.raceId,
    syncState: recoveredRace.syncState,
  }, raceIdentity)
})
