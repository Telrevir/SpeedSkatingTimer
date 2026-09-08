import assert from 'node:assert/strict'
import test from 'node:test'

import { RaceSyncWorkerEngine } from '../miniprogram/services/backend-sync/race-sync-worker-engine'
import type { RaceOutboxTask } from '../miniprogram/services/race-outbox-repository'

function task(overrides: Partial<RaceOutboxTask> = {}): RaceOutboxTask {
  return { taskId: 'race-a:create', raceLocalId: 'race-a', kind: 'create', clientKey: 'a', dependsOn: [], attempt: 0, nextAttemptAt: 0, state: 'pending', lastErrorCode: null, ...overrides }
}

test('worker engine emits independent race requests and a future wake', () => {
  const engine = new RaceSyncWorkerEngine()
  const decision = engine.plan({ now: 100, tasks: [task(), task({ taskId: 'race-b:create', raceLocalId: 'race-b', clientKey: 'b' })], activeTaskIds: [] })

  assert.deepEqual(decision.executeTaskIds.sort(), ['race-a:create', 'race-b:create'])
  assert.equal(decision.nextWakeAt, null)
})

test('worker engine caps exponential retry at sixty seconds', () => {
  const engine = new RaceSyncWorkerEngine()
  const transition = engine.result(task({ attempt: 9 }), { ok: false, kind: 'network', message: 'offline' }, 500)

  assert.deepEqual(transition, { type: 'failure', taskId: 'race-a:create', errorCode: 'network', nextAttemptAt: 60_500 })
})

test('worker engine holds business conflict returned through HTTP 200', () => {
  const engine = new RaceSyncWorkerEngine()
  const transition = engine.result(task(), { ok: false, kind: 'business', httpStatus: 200, code: 409, message: 'conflict' }, 500)

  assert.deepEqual(transition, { type: 'failure', taskId: 'race-a:create', errorCode: 409, nextAttemptAt: null })
})
