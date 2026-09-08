import assert from 'node:assert/strict'
import test from 'node:test'

import { BackendClient } from '../miniprogram/services/backend-api/request'
import { WorkerRequestBridge, type WorkerPort } from '../miniprogram/services/backend-sync/worker-request-bridge'
import type { WorkerRequest, WorkerResult } from '../miniprogram/services/backend-sync/worker-protocol'
import { RaceSyncScheduler } from '../miniprogram/services/backend-sync/race-sync-scheduler'
import { RaceOutboxRepository } from '../miniprogram/services/race-outbox-repository'

class Storage {
  value: unknown = null
  read(): unknown { return this.value }
  write(value: unknown): void { this.value = JSON.parse(JSON.stringify(value)) }
}

class FakeWorker implements WorkerPort {
  readonly sent: Array<WorkerRequest | WorkerResult> = []
  private messageListener: ((message: WorkerRequest | WorkerResult) => void) | null = null
  private terminationListener: (() => void) | null = null
  postMessage(message: WorkerRequest | WorkerResult): void { this.sent.push(message) }
  onMessage(listener: (message: WorkerRequest | WorkerResult) => void): void { this.messageListener = listener }
  onTerminate(listener: () => void): void { this.terminationListener = listener }
  terminate(): void { this.terminationListener?.() }
  emit(message: WorkerRequest | WorkerResult): void { this.messageListener?.(message) }
}

function createRequest(requestId: string, taskId: string): WorkerRequest {
  return {
    type: 'request', requestId, taskId, endpoint: 'create-race',
    payload: { ClientRaceKey: taskId, ClubID: 1, RaceDate: '2026-09-08 10:00:00', IsFinished: false, Enabled: true },
  }
}

function success(request: WorkerRequest): WorkerResult {
  return { type: 'result', requestId: request.requestId, taskId: request.taskId, result: { ok: true, httpStatus: 200, data: {} } }
}

test('bridge correlates out-of-order replies by requestId', async () => {
  const worker = new FakeWorker()
  const bridge = new WorkerRequestBridge(new BackendClient(), { createWorker: () => worker })
  const firstRequest = createRequest('request-1', 'task-1')
  const secondRequest = createRequest('request-2', 'task-2')
  const first = bridge.request(firstRequest)
  const second = bridge.request(secondRequest)

  worker.emit(success(secondRequest))
  worker.emit(success(firstRequest))

  assert.deepEqual(await first, { ok: true, httpStatus: 200, data: {} })
  assert.deepEqual(await second, { ok: true, httpStatus: 200, data: {} })
})

test('worker termination settles every pending bridge request', async () => {
  const worker = new FakeWorker()
  const bridge = new WorkerRequestBridge(new BackendClient(), { createWorker: () => worker })
  const first = bridge.request(createRequest('request-1', 'task-1'))
  const second = bridge.request(createRequest('request-2', 'task-2'))

  worker.terminate()

  for (const result of await Promise.all([first, second])) {
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.kind, 'network')
  }
})

test('bridge timeout returns a normalized network result', async () => {
  const worker = new FakeWorker()
  let timeoutCallback!: () => void
  const bridge = new WorkerRequestBridge(new BackendClient(), {
    createWorker: () => worker,
    timeoutMs: 1,
    delay: (callback) => { timeoutCallback = callback; return setTimeout(() => undefined, 1) },
  })
  const pending = bridge.request(createRequest('request-1', 'task-1'))

  timeoutCallback()

  assert.deepEqual(await pending, { ok: false, kind: 'network', message: 'Worker 请求超时' })
})

test('duplicate and unknown replies do not mutate outbox', async () => {
  const worker = new FakeWorker()
  const bridge = new WorkerRequestBridge(new BackendClient(), { createWorker: () => worker })
  const outbox = new RaceOutboxRepository(new Storage(), () => 0)
  outbox.enqueueCreate('race-a', 'a')
  const scheduler = new RaceSyncScheduler({
    outbox,
    now: () => 0,
    execute: (task) => bridge.request(createRequest('request-1', task.taskId)),
  })

  scheduler.wake()
  for (let attempt = 0; worker.sent.length === 0 && attempt < 10; attempt += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
  const request = worker.sent[0] as WorkerRequest
  worker.emit(success(request))
  worker.emit(success(request))
  worker.emit(success(createRequest('unknown', 'unknown-task')))
  await new Promise<void>((resolve) => setImmediate(resolve))
  await new Promise<void>((resolve) => setImmediate(resolve))

  assert.deepEqual(outbox.listTasks(), [])
})

test('worker creation failure uses the same request result contract', async () => {
  const bridge = new WorkerRequestBridge(new BackendClient(async () => ({
    statusCode: 200,
    data: { code: 0, data: {} },
  })), { createWorker: () => { throw new Error('Worker unsupported') } })

  assert.deepEqual(await bridge.request(createRequest('request-1', 'task-1')), {
    ok: true, httpStatus: 200, data: {},
  })
})
