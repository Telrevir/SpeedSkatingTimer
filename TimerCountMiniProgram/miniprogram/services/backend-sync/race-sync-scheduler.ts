import type { ApiResult } from '../backend-api/request'
import type { RaceOutboxRepository, RaceOutboxTask } from '../race-outbox-repository'
import { FallbackEnginePort, type RaceSyncEnginePort } from './race-sync-engine-port'
import type { WorkerTransition } from './race-sync-worker-engine'

export type RaceTaskExecutor = (task: RaceOutboxTask) => Promise<ApiResult<unknown>>
interface Options {
  outbox: RaceOutboxRepository
  /** Task 6 注入比赛 DTO 适配器前可不提供；此时唤醒不修改 outbox。 */
  execute?: RaceTaskExecutor
  now?: () => number
  delay?: (fn: () => void, ms: number) => unknown
  clearDelay?: (id: unknown) => void
  enginePort?: RaceSyncEnginePort
}

/** 不接页面/BLE；Task 6 只需提供 execute DTO 适配器即可消费。 */
export class RaceSyncScheduler {
  private readonly now: () => number
  private readonly delay: (fn: () => void, ms: number) => unknown
  private readonly clearDelay: (id: unknown) => void
  private readonly activeTaskIds = new Set<string>()
  private timer: unknown = null
  private stopped = false
  private controlTail: Promise<void> = Promise.resolve()
  private readTail: Promise<void> = Promise.resolve()
  private readonly enginePort: RaceSyncEnginePort
  private pumping = false
  constructor(private readonly options: Options) {
    this.now = options.now ?? (() => Date.now())
    this.delay = options.delay ?? ((fn, ms) => setTimeout(fn, ms))
    this.clearDelay = options.clearDelay ?? ((id) => clearTimeout(id as ReturnType<typeof setTimeout>))
    this.enginePort = options.enginePort ?? new FallbackEnginePort()
  }
  wake(): void {
    this.stopped = false
    void this.pump()
  }

  terminate(): void {
    this.stopped = true
    if (this.timer !== null) this.clearDelay(this.timer)
    this.timer = null
    this.enginePort.terminate()
  }

  /** 控制请求按自身通道串行，不阻塞成绩上传或读取。 */
  runControl<T>(operation: () => Promise<T>): Promise<T> {
    return this.enqueueLane('control', operation)
  }

  /** 读取请求按自身通道串行，不受比赛写入重试定时影响。 */
  runRead<T>(operation: () => Promise<T>): Promise<T> {
    return this.enqueueLane('read', operation)
  }

  private async pump(): Promise<void> {
    if (this.pumping || this.stopped || !this.options.execute) return
    this.pumping = true
    try {
      const tasks = this.options.outbox.listTasks()
      const plan = await this.enginePort.plan({ now: this.now(), tasks, activeTaskIds: [...this.activeTaskIds] })
      if (this.stopped) return
      plan.executeTaskIds.forEach((taskId) => {
      const task = tasks.find((item) => item.taskId === taskId)
      if (!task) return
      if (this.activeTaskIds.has(task.taskId)) return
      this.activeTaskIds.add(task.taskId)
      void this.execute(task)
      })
      this.schedule(plan.nextWakeAt)
    } finally {
      this.pumping = false
    }
  }
  private async execute(task: RaceOutboxTask): Promise<void> {
    try {
      const result = await this.options.execute!(task)
      if (!this.stopped) this.apply(await this.enginePort.result(task, result, this.now()))
    } catch {
      if (!this.stopped) this.apply(await this.enginePort.result(task, { ok: false, kind: 'network', message: '调度执行失败' }, this.now()))
    } finally {
      this.activeTaskIds.delete(task.taskId)
      if (!this.stopped) {
        void this.pump()
      }
    }
  }
  private schedule(nextAttemptAt: number | null): void {
    if (this.stopped || !this.options.execute) return
    if (this.timer !== null) this.clearDelay(this.timer)
    this.timer = nextAttemptAt === null
      ? null
      : this.delay(() => { this.timer = null; this.wake() }, Math.max(0, nextAttemptAt - this.now()))
  }

  private apply(transition: WorkerTransition): void {
    if (transition.type === 'succeeded') {
      this.options.outbox.markSucceeded(transition.taskId)
      return
    }
    this.options.outbox.markFailure(
      transition.taskId,
      transition.errorCode,
      transition.nextAttemptAt ?? this.now(),
    )
  }

  private enqueueLane<T>(lane: 'control' | 'read', operation: () => Promise<T>): Promise<T> {
    const current = lane === 'control' ? this.controlTail : this.readTail
    const next = current.then(operation, operation)
    const settled = next.then(() => undefined, () => undefined)
    if (lane === 'control') this.controlTail = settled
    else this.readTail = settled
    return next
  }
}
