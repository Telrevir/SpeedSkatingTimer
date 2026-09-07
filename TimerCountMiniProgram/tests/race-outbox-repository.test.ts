import assert from 'node:assert/strict'
import test from 'node:test'

import {
  RaceOutboxRepository,
  type RaceOutboxStorage,
} from '../miniprogram/services/race-outbox-repository'

class MemoryStorage implements RaceOutboxStorage {
  value: unknown = null
  writes = 0
  read(): unknown { return this.value }
  write(value: unknown): void {
    this.writes += 1
    this.value = value
  }
}

test('outbox persists create score finish dependency order', () => {
  const storage = new MemoryStorage()
  const outbox = new RaceOutboxRepository(storage, () => 1000)
  const create = outbox.enqueueCreate('race-a', 'race-key-a')
  const score = outbox.enqueueScore('race-a', 'score-key-a')
  const finish = outbox.enqueueFinish('race-a', 'race-key-a')

  assert.deepEqual([create.taskId, score.taskId, finish.taskId], [
    'race-a:create',
    'race-a:score:score-key-a',
    'race-a:finish',
  ])
  assert.deepEqual(score.dependsOn, [create.taskId])
  assert.deepEqual(finish.dependsOn, [create.taskId, score.taskId])
  assert.deepEqual(outbox.runnableTasks(), [create])
  outbox.markSucceeded(create.taskId)
  assert.deepEqual(outbox.runnableTasks(), [score])
  outbox.markSucceeded(score.taskId)
  assert.deepEqual(outbox.runnableTasks(), [finish])
  assert.deepEqual(storage.value, { schemaVersion: 1, tasks: [finish] })
})

test('same client score key coalesces to one task', () => {
  const storage = new MemoryStorage()
  const outbox = new RaceOutboxRepository(storage, () => 1000)
  outbox.enqueueCreate('race-a', 'race-key-a')
  const first = outbox.enqueueScore('race-a', 'score-key-a')
  const writesAfterFirst = storage.writes
  const second = outbox.enqueueScore('race-a', 'score-key-a')

  assert.equal(second.taskId, first.taskId)
  assert.equal(outbox.listTasks().filter((task) => task.clientKey === 'score-key-a').length, 1)
  assert.equal(storage.writes, writesAfterFirst)
})

test('outbox keeps distinct races independent and persists retry and hold metadata', () => {
  const storage = new MemoryStorage()
  const outbox = new RaceOutboxRepository(storage, () => 1000)
  const first = outbox.enqueueCreate('race-a', 'race-key-a')
  const second = outbox.enqueueCreate('race-b', 'race-key-b')

  assert.deepEqual(outbox.runnableTasks().map((task) => task.taskId), [first.taskId, second.taskId])
  assert.equal(outbox.markFailure(first.taskId, 503, 5000), true)
  assert.equal(outbox.markFailure(second.taskId, 409), true)

  const reloaded = new RaceOutboxRepository(storage, () => 1000)
  assert.deepEqual(reloaded.listTasks(), [{
    ...first,
    attempt: 1,
    nextAttemptAt: 5000,
    state: 'pending',
    lastErrorCode: '503',
  }, {
    ...second,
    attempt: 1,
    nextAttemptAt: 1000,
    state: 'held',
    lastErrorCode: '409',
  }])
  assert.deepEqual(reloaded.runnableTasks(5000).map((task) => task.taskId), [first.taskId])
  assert.equal(reloaded.markSucceeded(first.taskId), true)
  assert.deepEqual(reloaded.listTasks().map((task) => task.taskId), [second.taskId])
})

test('invalid stored outbox is retained for diagnosis but not executed', () => {
  const storage = new MemoryStorage()
  storage.value = { schemaVersion: 1, tasks: [{ taskId: 'bad' }] }
  const outbox = new RaceOutboxRepository(storage)

  assert.equal(outbox.storageError, '同步任务存储格式无效')
  assert.deepEqual(outbox.runnableTasks(), [])
  assert.throws(() => outbox.enqueueCreate('race-a', 'race-key-a'), /同步任务存储格式无效/)
  assert.deepEqual(storage.value, { schemaVersion: 1, tasks: [{ taskId: 'bad' }] })
})
