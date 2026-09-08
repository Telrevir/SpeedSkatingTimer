import type { WorkerRequest, WorkerResult } from '../../services/backend-sync/worker-protocol'
import { RaceSyncWorkerEngine, type WorkerPlanInput } from '../../services/backend-sync/race-sync-worker-engine'
import type { RaceOutboxTask } from '../../services/race-outbox-repository'
import type { ApiResult } from '../../services/backend-api/request'

type EnginePlanRequest = { type: 'engine-plan'; requestId: string; input: WorkerPlanInput }
type EngineResultRequest = { type: 'engine-result'; requestId: string; task: RaceOutboxTask; result: ApiResult<unknown>; now: number }
type WorkerMessage = WorkerRequest | WorkerResult | EnginePlanRequest | EngineResultRequest
type WorkerReply = WorkerRequest | WorkerResult
  | { type: 'engine-plan-result'; requestId: string; plan: ReturnType<RaceSyncWorkerEngine['plan']> }
  | { type: 'engine-result-result'; requestId: string; transition: ReturnType<RaceSyncWorkerEngine['result']> }

interface WorkerScope {
  postMessage(message: WorkerReply): void
  onMessage(listener: (message: WorkerMessage) => void): void
}

declare const worker: WorkerScope

const pending = new Set<string>()
const engine = new RaceSyncWorkerEngine()

// Worker 只计算调度决策并中继受限请求；网络、存储、页面和 BLE 均留在主线程。
worker.onMessage((message) => {
  if (message.type === 'engine-plan') {
    worker.postMessage({ type: 'engine-plan-result', requestId: message.requestId, plan: engine.plan(message.input) })
    return
  }
  if (message.type === 'engine-result') {
    worker.postMessage({ type: 'engine-result-result', requestId: message.requestId, transition: engine.result(message.task, message.result, message.now) })
    return
  }
  const key = `${message.requestId}\u0000${message.taskId}`
  if (message.type === 'request') {
    if (pending.has(key)) return
    pending.add(key)
    worker.postMessage(message)
    return
  }
  if (!pending.delete(key)) return
  worker.postMessage(message)
})