import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ScoreRepository,
  type ScoreStorage,
} from '../miniprogram/services/score-repository'

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
