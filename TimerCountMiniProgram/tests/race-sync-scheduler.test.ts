import assert from 'node:assert/strict'
import test from 'node:test'

import { RaceSyncScheduler } from '../miniprogram/services/backend-sync/race-sync-scheduler'
import { RaceOutboxRepository } from '../miniprogram/services/race-outbox-repository'

class Storage {
  value: unknown = null
  read(): unknown { return this.value }
  write(value: unknown): void { this.value = JSON.parse(JSON.stringify(value)) }
}

function success() { return { ok: true as const, httpStatus: 200, data: {} } }

async function flush(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve))
  await new Promise<void>((resolve) => setImmediate(resolve))
}

test('one race is serial while two races may progress concurrently', async () => {
  const outbox = new RaceOutboxRepository(new Storage(), () => 0)
  outbox.enqueueCreate('race-a', 'a')
  outbox.enqueueScore('race-a', 'a-score')
  outbox.enqueueCreate('race-b', 'b')
  let releaseA!: () => void
  let releaseB!: () => void
  const gateA = new Promise<void>((resolve) => { releaseA = resolve })
  const gateB = new Promise<void>((resolve) => { releaseB = resolve })
  const activeByRace = new Map<string, number>()
  let maximumSameRace = 0
  const starts: string[] = []
  const scheduler = new RaceSyncScheduler({
    outbox,
    now: () => 0,
    execute: async (task) => {
      starts.push(task.taskId)
      const active = (activeByRace.get(task.raceLocalId) ?? 0) + 1
      activeByRace.set(task.raceLocalId, active)
      maximumSameRace = Math.max(maximumSameRace, active)
      if (task.taskId === 'race-a:create') await gateA
      if (task.taskId === 'race-b:create') await gateB
      activeByRace.set(task.raceLocalId, active - 1)
      return success()
    },
  })

  scheduler.wake()
  await flush()
  assert.deepEqual(starts.sort(), ['race-a:create', 'race-b:create'])
  assert.equal(maximumSameRace, 1)

  releaseA()
  await flush()
  assert.deepEqual(starts.sort(), ['race-a:create', 'race-a:score:a-score', 'race-b:create'])
  assert.equal(maximumSameRace, 1)
  releaseB()
  await flush()
})

test('read lane is not delayed by race write retry', async () => {
  let now = 0
  const delays: Array<{ callback: () => void; ms: number }> = []
  const outbox = new RaceOutboxRepository(new Storage(), () => now)
  outbox.enqueueCreate('race-a', 'a')
  const scheduler = new RaceSyncScheduler({
    outbox,
    now: () => now,
    delay: (callback, ms) => { delays.push({ callback, ms }); return callback },
    clearDelay: () => undefined,
    execute: async () => ({ ok: false as const, kind: 'network' as const, message: 'offline' }),
  })

  scheduler.wake()
  await flush()
  const read = await scheduler.runRead(async () => 'fresh-read')

  assert.equal(read, 'fresh-read')
  assert.equal(outbox.listTasks()[0]!.attempt, 1)
  assert.deepEqual(delays.map(({ ms }) => ms), [1000])
})

test('business conflict is held without another timer', async () => {
  const delays: number[] = []
  const outbox = new RaceOutboxRepository(new Storage(), () => 0)
  outbox.enqueueCreate('race-a', 'a')
  const scheduler = new RaceSyncScheduler({
    outbox,
    now: () => 0,
    delay: (_callback, ms) => { delays.push(ms); return ms },
    clearDelay: () => undefined,
    execute: async () => ({
      ok: false as const,
      kind: 'business' as const,
      httpStatus: 200,
      code: 409,
      message: 'conflict',
    }),
  })

  scheduler.wake()
  await flush()

  assert.equal(outbox.listTasks()[0]!.state, 'held')
  assert.equal(outbox.listTasks()[0]!.lastErrorCode, '409')
  assert.deepEqual(delays, [])
})

test('wake without an executor preserves pending outbox work', () => {
  const outbox = new RaceOutboxRepository(new Storage(), () => 0)
  outbox.enqueueCreate('race-a', 'a')
  const before = outbox.listTasks()
  const scheduler = new RaceSyncScheduler({ outbox, now: () => 0 })

  scheduler.wake()

  assert.deepEqual(outbox.listTasks(), before)
})
