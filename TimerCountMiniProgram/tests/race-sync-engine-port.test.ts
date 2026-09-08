import assert from 'node:assert/strict'
import test from 'node:test'

import { FallbackEnginePort, WorkerEnginePort, type EngineWorkerPort } from '../miniprogram/services/backend-sync/race-sync-engine-port'
import { RaceSyncScheduler } from '../miniprogram/services/backend-sync/race-sync-scheduler'
import { RaceOutboxRepository } from '../miniprogram/services/race-outbox-repository'
import { RaceSyncWorkerEngine } from '../miniprogram/services/backend-sync/race-sync-worker-engine'
import type { RaceOutboxTask } from '../miniprogram/services/race-outbox-repository'

class FakeEngineWorker implements EngineWorkerPort {
  sent: unknown[] = []
  private listener: ((message: unknown) => void) | null = null
  postMessage(message: unknown): void { this.sent.push(message) }
  onMessage(listener: (message: unknown) => void): void { this.listener = listener }
  emit(message: unknown): void { this.listener?.(message) }
}

class EngineBackedWorker extends FakeEngineWorker {
  readonly engineMessages: Array<{ type: string }> = []
  private readonly engine = new RaceSyncWorkerEngine()
  override postMessage(message: unknown): void {
    this.sent.push(message)
    const request = message as { type?: string; requestId?: string; input?: never; task?: RaceOutboxTask; result?: never; now?: number }
    if (request.type === 'engine-plan' && request.requestId) {
      this.engineMessages.push({ type: request.type })
      queueMicrotask(() => this.emit({ type: 'engine-plan-result', requestId: request.requestId,
        plan: this.engine.plan(request.input as never) }))
    }
    if (request.type === 'engine-result' && request.requestId && request.task && request.now !== undefined) {
      this.engineMessages.push({ type: request.type })
      queueMicrotask(() => this.emit({ type: 'engine-result-result', requestId: request.requestId,
        transition: this.engine.result(request.task!, request.result as never, request.now!) }))
    }
  }
}

class Storage {
  value: unknown = null
  read(): unknown { return this.value }
  write(value: unknown): void { this.value = JSON.parse(JSON.stringify(value)) }
}

const task: RaceOutboxTask = {
  taskId: 'race-a:create', raceLocalId: 'race-a', kind: 'create', clientKey: 'a',
  dependsOn: [], attempt: 0, nextAttemptAt: 0, state: 'pending', lastErrorCode: null,
}

test('worker engine port obtains request intent and retry decision from the worker', async () => {
  const worker = new FakeEngineWorker()
  const port = new WorkerEnginePort(worker)
  const planned = port.plan({ now: 0, tasks: [task], activeTaskIds: [] })
  const planRequest = worker.sent[0] as { type: string; requestId: string }
  assert.equal(planRequest.type, 'engine-plan')
  worker.emit({ type: 'engine-plan-result', requestId: planRequest.requestId, plan: { executeTaskIds: [task.taskId], nextWakeAt: null } })
  assert.deepEqual(await planned, { executeTaskIds: [task.taskId], nextWakeAt: null })

  const settled = port.result(task, { ok: false, kind: 'network', message: 'offline' }, 100)
  const resultRequest = worker.sent[1] as { type: string; requestId: string }
  assert.equal(resultRequest.type, 'engine-result')
  worker.emit({ type: 'engine-result-result', requestId: resultRequest.requestId,
    transition: { type: 'failure', taskId: task.taskId, errorCode: 'network', nextAttemptAt: 1100 } })
  assert.deepEqual(await settled, { type: 'failure', taskId: task.taskId, errorCode: 'network', nextAttemptAt: 1100 })
})

test('worker and fallback ports produce identical transitions for one event sequence', async () => {
  const worker = new EngineBackedWorker()
  const workerPort = new WorkerEnginePort(worker)
  const fallback = new FallbackEnginePort()
  const failure = { ok: false as const, kind: 'network' as const, message: 'offline' }

  const workerPlan = await workerPort.plan({ now: 0, tasks: [task], activeTaskIds: [] })
  const fallbackPlan = await fallback.plan({ now: 0, tasks: [task], activeTaskIds: [] })
  const workerTransition = await workerPort.result(task, failure, 0)
  const fallbackTransition = await fallback.result(task, failure, 0)

  assert.deepEqual(workerPlan, fallbackPlan)
  assert.deepEqual(workerTransition, fallbackTransition)
})

test('scheduler persists the held transition returned by a real worker port', async () => {
  const worker = new EngineBackedWorker()
  const outbox = new RaceOutboxRepository(new Storage(), () => 0)
  outbox.enqueueCreate('race-a', 'a')
  const scheduler = new RaceSyncScheduler({
    outbox,
    now: () => 0,
    enginePort: new WorkerEnginePort(worker),
    execute: async () => ({ ok: false as const, kind: 'business' as const, httpStatus: 200, code: 409, message: 'conflict' }),
  })

  scheduler.wake()
  await new Promise<void>((resolve) => setImmediate(resolve))
  await new Promise<void>((resolve) => setImmediate(resolve))

  assert.equal(outbox.listTasks()[0]!.state, 'held')
  assert.deepEqual(worker.engineMessages.map(({ type }) => type), ['engine-plan', 'engine-result', 'engine-plan'])
})
