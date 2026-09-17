import { createRace } from '../backend-api/races/create-race'
import { createScore } from '../backend-api/races/create-score'
import { saveRaceBundle } from '../backend-api/races/save-race-bundle'
import type { ApiResult, BackendClient } from '../backend-api/request'
import type { WorkerRequest, WorkerResult } from './worker-protocol'

export interface WorkerPort {
  postMessage(message: WorkerRequest | WorkerResult): void
  onMessage(listener: (message: WorkerRequest | WorkerResult) => void): void
  terminate(): void
  /** 测试适配器和支持该事件的运行时可在 Worker 异常退出时通知主线程。 */
  onTerminate?(listener: () => void): void
}

interface PendingRequest {
  taskId: string
  resolve: (result: ApiResult<unknown>) => void
  timeoutId: ReturnType<typeof setTimeout>
}

interface Options {
  createWorker?: () => WorkerPort
  timeoutMs?: number
  delay?: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>
  clearDelay?: (timeoutId: ReturnType<typeof setTimeout>) => void
}

/**
 * 主线程唯一网络入口。Worker 只能发送受限 payload；所有网络访问由注入的 BackendClient 统一处理。
 * Worker 不可用时按相同 Promise 契约串行执行，不阻塞页面回调。
 */
export class WorkerRequestBridge {
  private readonly pending = new Map<string, PendingRequest>()
  private readonly timeoutMs: number
  private readonly delay: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>
  private readonly clearDelay: (timeoutId: ReturnType<typeof setTimeout>) => void
  private worker: WorkerPort | null = null
  private workerUnavailable = false
  private fallbackQueue: Promise<void> = Promise.resolve()

  constructor(private readonly client: BackendClient, private readonly options: Options = {}) {
    this.timeoutMs = options.timeoutMs ?? 15_000
    this.delay = options.delay ?? ((callback, ms) => setTimeout(callback, ms))
    this.clearDelay = options.clearDelay ?? ((timeoutId) => clearTimeout(timeoutId))
  }

  request(request: WorkerRequest): Promise<ApiResult<unknown>> {
    const key = pendingKey(request.requestId, request.taskId)
    if (this.pending.has(key)) {
      return Promise.resolve({ ok: false, kind: 'invalid-response', message: 'Worker 请求 ID 重复' })
    }
    return new Promise<ApiResult<unknown>>((resolve) => {
      const timeoutId = this.delay(() => this.settle(key, {
        ok: false, kind: 'network', message: 'Worker 请求超时',
      }), this.timeoutMs)
      this.pending.set(key, { taskId: request.taskId, resolve, timeoutId })
      const worker = this.getWorker()
      if (worker) {
        worker.postMessage(request)
        return
      }
      // 退化路径仍按单一队列执行，避免网络回调挤占 UI 或改变结果契约。
      this.fallbackQueue = this.fallbackQueue
        .then(async () => this.dispatch(request))
        .then((result) => this.handleMessage(result))
        .catch(() => this.settle(key, { ok: false, kind: 'network', message: 'Worker 降级请求失败' }))
    })
  }

  terminate(): void {
    this.worker?.terminate()
    this.handleTermination()
  }

  handleMessage(message: WorkerRequest | WorkerResult): void {
    if (message.type === 'request') {
      void this.dispatch(message).then((result) => this.worker?.postMessage(result))
      return
    }
    const key = pendingKey(message.requestId, message.taskId)
    const pending = this.pending.get(key)
    // 重复、未知或 taskId 不匹配的结果不能触发第二次状态变更。
    if (!pending || pending.taskId !== message.taskId) return
    this.settle(key, message.result)
  }

  async dispatch(request: WorkerRequest): Promise<WorkerResult> {
    let result
    switch (request.endpoint) {
      case 'create-race': result = await createRace(this.client, request.payload as never); break
      case 'create-score': result = await createScore(this.client, request.payload as never); break
      case 'save-race-bundle': result = await saveRaceBundle(this.client, request.payload as never); break
      default: throw new Error('Worker endpoint 不在白名单中')
    }
    return { type: 'result', requestId: request.requestId, taskId: request.taskId, result }
  }

  private getWorker(): WorkerPort | null {
    if (this.workerUnavailable) return null
    if (this.worker) return this.worker
    // 生产环境暂不创建微信 Worker：当前 Worker 入口未能作为独立 JS 包交付，
    // 强行调用 wx.createWorker 会在开发工具中报“module is not defined”。
    // 没有注入测试/平台适配器时，使用下方既有的串行降级请求队列。
    if (!this.options.createWorker) {
      this.workerUnavailable = true
      return null
    }
    try {
      const worker = this.options.createWorker()
      worker.onMessage((message) => this.handleMessage(message))
      worker.onTerminate?.(() => this.handleTermination())
      this.worker = worker
      return worker
    } catch {
      this.workerUnavailable = true
      return null
    }
  }

  private handleTermination(): void {
    this.worker = null
    this.workerUnavailable = true
    for (const [key] of this.pending) {
      this.settle(key, { ok: false, kind: 'network', message: 'Worker 已终止' })
    }
  }

  private settle(key: string, result: ApiResult<unknown>): void {
    const pending = this.pending.get(key)
    if (!pending) return
    this.pending.delete(key)
    this.clearDelay(pending.timeoutId)
    pending.resolve(result)
  }
}

function pendingKey(requestId: string, taskId: string): string {
  return `${requestId}\u0000${taskId}`
}
