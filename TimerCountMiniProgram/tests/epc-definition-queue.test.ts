import assert from 'node:assert/strict'
import test from 'node:test'

import type { AthleteClassification } from '../miniprogram/protocol/athlete-sync-codec'
import {
  ActiveRaceSessionRepository,
  type ActiveRaceSessionStorage,
} from '../miniprogram/services/active-race-session-repository'
import { EpcDefinitionQueue } from '../miniprogram/services/epc-definition-queue'

class MemoryStorage implements ActiveRaceSessionStorage {
  value: unknown = null
  read(): unknown { return this.value }
  write(value: unknown): void { this.value = value }
  remove(): void { this.value = null }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function fixture(athleteCount = 0, nonAthleteCount = 0) {
  const repository = new ActiveRaceSessionRepository(new MemoryStorage())
  repository.save({
    participantIds: [1],
    activeGroupId: null,
    athleteDefinitionCount: athleteCount,
    nonAthleteDefinitionCount: nonAthleteCount,
  })
  return repository
}

test('serializes EPC definitions and increments successful category counts', async () => {
  const repository = fixture()
  const first = deferred<void>()
  const calls: AthleteClassification[] = []
  const queue = new EpcDefinitionQueue(repository, async (definition) => {
    calls.push(definition)
    if (calls.length === 1) await first.promise
  })

  const one = queue.enqueue({ isAthlete: true, epc: '3333F337', athleteId: 1 })
  const two = queue.enqueue({ isAthlete: false, epc: 'AABBCCDD', athleteId: null })
  await Promise.resolve()
  assert.equal(calls.length, 1)

  first.resolve()
  await Promise.all([one, two])
  assert.deepEqual(calls.map(({ epc }) => epc), ['3333F337', 'AABBCCDD'])
  assert.equal(repository.load()?.athleteDefinitionCount, 1)
  assert.equal(repository.load()?.nonAthleteDefinitionCount, 1)
})

test('does not retry or count a rejected definition', async () => {
  const repository = fixture()
  let callCount = 0
  const queue = new EpcDefinitionQueue(repository, async () => {
    callCount += 1
    throw new Error('definition failed')
  })

  await assert.rejects(
    queue.enqueue({ isAthlete: true, epc: '3333F337', athleteId: 1 }),
    /definition failed/,
  )
  assert.equal(callCount, 1)
  assert.equal(repository.load()?.athleteDefinitionCount, 0)
})

test('ignores duplicate EPC values while the first definition is pending', async () => {
  const repository = fixture()
  const pending = deferred<void>()
  let callCount = 0
  const queue = new EpcDefinitionQueue(repository, async () => {
    callCount += 1
    await pending.promise
  })
  const definition = { isAthlete: true, epc: '3333F337', athleteId: 1 } as const

  const first = queue.enqueue(definition)
  const duplicate = queue.enqueue(definition)
  await Promise.resolve()
  assert.equal(callCount, 1)

  pending.resolve()
  await Promise.all([first, duplicate])
  assert.equal(callCount, 1)
  assert.equal(repository.load()?.athleteDefinitionCount, 1)
})

test('rejects a full category before invoking the definition callback', async () => {
  const repository = fixture(50, 0)
  let called = false
  const queue = new EpcDefinitionQueue(repository, async () => { called = true })

  await assert.rejects(
    queue.enqueue({ isAthlete: true, epc: '3333F337', athleteId: 1 }),
    /50/,
  )
  assert.equal(called, false)
})

test('clear cancels queued definitions that have not started', async () => {
  const repository = fixture()
  const pending = deferred<void>()
  const calls: string[] = []
  const queue = new EpcDefinitionQueue(repository, async ({ epc }) => {
    calls.push(epc)
    if (calls.length === 1) await pending.promise
  })

  const first = queue.enqueue({ isAthlete: true, epc: '3333F337', athleteId: 1 })
  const queued = queue.enqueue({ isAthlete: false, epc: 'AABBCCDD', athleteId: null })
  await Promise.resolve()
  queue.clear()
  pending.resolve()
  await Promise.all([first, queued])

  assert.deepEqual(calls, ['3333F337'])
  assert.equal(repository.load()?.athleteDefinitionCount, 0)
  assert.equal(repository.load()?.nonAthleteDefinitionCount, 0)
})
