import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ScoreRepository,
  type ScoreStorage,
} from '../miniprogram/services/score-repository'
import { presentRaceId } from '../miniprogram/domain/race-identity'

class MemoryStorage implements ScoreStorage {
  value: unknown = null
  read(): unknown { return this.value }
  write(value: unknown): void { this.value = value }
}

test('persists a race and ignores historical score recovery', () => {
  const storage = new MemoryStorage()
  const repository = new ScoreRepository(storage, () => 1000)

  repository.beginRace()
  repository.appendScore({
    athleteId: 1,
    name: 'A',
    epc: '01020304',
    lap: 1,
    lapCentiseconds: 4050,
    totalCentiseconds: 4050,
    rank: 1,
  }, false)
  repository.appendScore({
    athleteId: 1,
    name: 'A',
    epc: '01020304',
    lap: 2,
    lapCentiseconds: 4000,
    totalCentiseconds: 8050,
    rank: 1,
  }, true)
  repository.finishRace()

  const records = new ScoreRepository(storage).listRaces()
  assert.equal(records.length, 1)
  assert.equal(records[0]!.scores.length, 1)
  assert.equal(records[0]!.finishedAt, 1000)
})

test('creates unique race ids when starts share a timestamp', () => {
  const storage = new MemoryStorage()
  const repository = new ScoreRepository(storage, () => 1000)
  const first = repository.beginRace()
  repository.finishRace()
  const second = repository.beginRace()

  assert.notEqual(first.id, second.id)
})

test('two offline races keep distinct client identities while presenting -1', () => {
  const storage = new MemoryStorage()
  const repository = new ScoreRepository(storage, () => 1000)
  const first = repository.beginRace()
  repository.markRaceOffline(first.localId)
  repository.finishRace()
  const second = repository.beginRace()
  repository.markRaceOffline(second.localId)

  const reloaded = new ScoreRepository(storage).listRaces()
  assert.equal(reloaded.length, 2)
  assert.deepEqual(reloaded.map((race) => presentRaceId(race)), [-1, -1])
  assert.notEqual(reloaded[0]!.localId, reloaded[1]!.localId)
  assert.notEqual(reloaded[0]!.clientRaceKey, reloaded[1]!.clientRaceKey)
  assert.deepEqual(storage.value, {
    schemaVersion: 2,
    currentLocalId: second.localId,
    records: reloaded,
  })
})

test('score correction preserves client key and event sequence', () => {
  const storage = new MemoryStorage()
  const repository = new ScoreRepository(storage, () => 1000)
  const race = repository.beginRace()
  const identity = repository.appendScore({
    athleteId: 1,
    name: 'A',
    epc: '01020304',
    lap: 2,
    lapCentiseconds: 4050,
    totalCentiseconds: 8050,
    rank: 1,
  }, false)!

  repository.replaceScore(identity.localScoreId, {
    athleteId: 1,
    name: 'A',
    epc: '01020304',
    lap: 3,
    rawLap: 2,
    correctionOffset: 1,
    correctedLap: 3,
    lapCentiseconds: 4050,
    totalCentiseconds: 8050,
    rank: 1,
  })

  const persisted = new ScoreRepository(storage).getWorkingCopy(race.localId)!.scores[0]!
  assert.deepEqual({
    localScoreId: persisted.localScoreId,
    clientScoreKey: persisted.clientScoreKey,
    eventSequence: persisted.eventSequence,
    scoreId: persisted.scoreId,
    lap: persisted.lap,
    correctedLap: persisted.correctedLap,
  }, {
    ...identity,
    lap: 3,
    correctedLap: 3,
  })
})

test('legacy records migrate without losing scores or stable identities', () => {
  const storage = new MemoryStorage()
  storage.value = [{
    id: 'legacy-race',
    startedAt: 900,
    finishedAt: 1200,
    participantIds: [1, 2],
    scores: [{
      athleteId: 1,
      name: 'A',
      epc: '01020304',
      lap: 2,
      rawLap: 1,
      correctionOffset: 1,
      correctedLap: 2,
      lapCentiseconds: 4050,
      totalCentiseconds: 8050,
      rank: 1,
    }],
  }]

  const repository = new ScoreRepository(storage)
  const migrated = repository.getWorkingCopy('legacy-race')!
  repository.markRaceOffline(migrated.localId)
  const reloaded = new ScoreRepository(storage).getWorkingCopy('legacy-race')!

  assert.deepEqual({
    localId: reloaded.localId,
    clientRaceKey: reloaded.clientRaceKey,
    raceId: reloaded.raceId,
    syncState: reloaded.syncState,
    participantIds: reloaded.participantIds,
    score: reloaded.scores[0],
  }, {
    localId: 'legacy-race',
    clientRaceKey: 'legacy:legacy-race',
    raceId: null,
    syncState: 'offline',
    participantIds: [1, 2],
    score: {
      athleteId: 1,
      name: 'A',
      epc: '01020304',
      lap: 2,
      rawLap: 1,
      correctionOffset: 1,
      correctedLap: 2,
      lapCentiseconds: 4050,
      totalCentiseconds: 8050,
      rank: 1,
      localScoreId: 'legacy-race:score:1',
      clientScoreKey: 'score:legacy:legacy-race:1',
      eventSequence: 1,
      scoreId: null,
    },
  })
})
