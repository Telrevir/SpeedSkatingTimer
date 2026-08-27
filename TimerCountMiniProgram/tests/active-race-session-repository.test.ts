import assert from 'node:assert/strict'
import test from 'node:test'

import type { ActiveRaceSession } from '../miniprogram/domain/active-race-session'
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

test('saves, clones and clears an active race session', () => {
  const storage = new MemoryStorage()
  const repository = new ActiveRaceSessionRepository(storage)

  repository.save(session)
  const loaded = repository.load()!
  assert.deepEqual(loaded, session)
  loaded.participantIds.push(3)
  assert.deepEqual(repository.load()?.participantIds, [1, 2])

  repository.clear()
  assert.equal(repository.load(), null)
})

test('increments only the selected successful definition count', () => {
  const repository = new ActiveRaceSessionRepository(new MemoryStorage())
  repository.save(session)

  assert.deepEqual(repository.incrementDefinition(true), {
    ...session,
    athleteDefinitionCount: 1,
  })
  assert.deepEqual(repository.incrementDefinition(false), {
    ...session,
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
