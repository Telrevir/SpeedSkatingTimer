import type { ApiResult } from '../backend-api/request'
import type { RaceOutboxTask } from '../race-outbox-repository'
import {
  RaceSyncWorkerEngine,
  type WorkerPlan,
  type WorkerPlanInput,
  type WorkerTransition,
} from './race-sync-worker-engine'

export interface RaceSyncEnginePort {
  plan(input: WorkerPlanInput): Promise<WorkerPlan>
  result(task: RaceOutboxTask, result: ApiResult<unknown>, now: number): Promise<WorkerTransition>
  terminate(): void
}

export interface EngineWorkerPort {
  postMessage(message: unknown): void
  onMessage(listener: (message: unknown) => void): void
  terminate?(): void
}

type EngineRequest =
  | { type: 'engine-plan'; requestId: string; input: WorkerPlanInput }
  | { type: 'engine-result'; requestId: string; task: RaceOutboxTask; result: ApiResult<unknown>; now: number }
type EngineReply =
  | { type: 'engine-plan-result'; requestId: string; plan: WorkerPlan }
  | { type: 'engine-result-result'; requestId: string; transition: WorkerTransition }

/** Worker 创建失败时使用的同接口纯引擎端口。 */
export class FallbackEnginePort implements RaceSyncEnginePort {
  constructor(private readonly engine: RaceSyncWorkerEngine = new RaceSyncWorkerEngine()) {}
  async plan(input: WorkerPlanInput): Promise<WorkerPlan> { return this.engine.plan(input) }
  async result(task: RaceOutboxTask, result: ApiResult<unknown>, now: number): Promise<WorkerTransition> {
    return this.engine.result(task, result, now)
  }
  terminate(): void {}
}

/** 主线程到真实 Worker 的无状态消息端口；不包含调度策略。 */
export class WorkerEnginePort implements RaceSyncEnginePort {
  private nextRequestId = 1
  private readonly pending = new Map<string, (reply: EngineReply) => void>()

  constructor(private readonly worker: EngineWorkerPort) {
    worker.onMessage((message) => this.handle(message))
  }

  plan(input: WorkerPlanInput): Promise<WorkerPlan> {
    return this.send({ type: 'engine-plan', requestId: this.id(), input })
      .then((reply) => reply.type === 'engine-plan-result' ? reply.plan : Promise.reject(new Error('Worker 计划响应类型错误')))
  }

  result(task: RaceOutboxTask, result: ApiResult<unknown>, now: number): Promise<WorkerTransition> {
    return this.send({ type: 'engine-result', requestId: this.id(), task, result, now })
      .then((reply) => reply.type === 'engine-result-result' ? reply.transition : Promise.reject(new Error('Worker 转换响应类型错误')))
  }

  terminate(): void {
    this.worker.terminate?.()
    for (const [requestId, resolve] of this.pending) {
      this.pending.delete(requestId)
      resolve({ type: 'engine-plan-result', requestId, plan: { executeTaskIds: [], nextWakeAt: null } })
    }
  }

  private send(request: EngineRequest): Promise<EngineReply> {
    return new Promise((resolve) => {
      this.pending.set(request.requestId, resolve)
      this.worker.postMessage(request)
    })
  }

  private handle(value: unknown): void {
    if (!value || typeof value !== 'object') return
    const reply = value as Partial<EngineReply>
    if (typeof reply.requestId !== 'string' || (reply.type !== 'engine-plan-result' && reply.type !== 'engine-result-result')) return
    const resolve = this.pending.get(reply.requestId)
    if (!resolve) return
    this.pending.delete(reply.requestId)
    resolve(reply as EngineReply)
  }

  private id(): string { return `engine-${this.nextRequestId++}` }
}

/** 微信 Worker 不可用、创建失败或开发工具不支持时，安全退回主线程纯引擎。 */
export function createWechatEnginePort(): RaceSyncEnginePort {
  // 微信 Worker 入口仅支持 workers 目录中的 JS 且不可引用目录外模块。
  // 当前项目的 Worker 源码尚未具备该独立打包形态；在其完成前，直接使用
  // 同一套纯调度规则的降级端口，避免 createWorker 产生未定义模块错误。
  return new FallbackEnginePort()
}
