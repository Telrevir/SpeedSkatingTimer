export type RaceOutboxTaskKind = 'create' | 'score' | 'finish'
export type RaceOutboxTaskState = 'pending' | 'held'

export interface RaceOutboxTask {
  taskId: string
  raceLocalId: string
  kind: RaceOutboxTaskKind
  clientKey: string
  dependsOn: string[]
  attempt: number
  nextAttemptAt: number
  state: RaceOutboxTaskState
  lastErrorCode: string | null
}

interface StoredRaceOutboxV1 {
  schemaVersion: 1
  tasks: RaceOutboxTask[]
}

export interface RaceOutboxStorage {
  read(): unknown
  write(value: unknown): void
}

/** 所有状态变更先同步写入存储，再更新内存中的任务队列。 */
export class RaceOutboxRepository {
  private tasks: RaceOutboxTask[] = []
  private readonly invalidStorage: unknown | null

  constructor(
    private readonly storage: RaceOutboxStorage,
    private readonly now: () => number = () => Date.now(),
  ) {
    const raw = storage.read()
    const parsed = parseTasks(raw)
    this.invalidStorage = parsed === null ? raw : null
    if (parsed !== null) this.tasks = parsed
  }

  get storageError(): string | null {
    return this.invalidStorage === null ? null : '同步任务存储格式无效'
  }

  listTasks(): RaceOutboxTask[] {
    return this.tasks.map(cloneTask)
  }

  runnableTasks(at = this.now()): RaceOutboxTask[] {
    if (this.invalidStorage !== null) return []
    const activeIds = new Set(this.tasks.map((task) => task.taskId))
    return this.tasks
      .filter((task) => task.state === 'pending' && task.nextAttemptAt <= at
        && task.dependsOn.every((dependency) => !activeIds.has(dependency)))
      .map(cloneTask)
  }

  enqueueCreate(raceLocalId: string, clientRaceKey: string): RaceOutboxTask {
    const localId = requiredKey(raceLocalId, '比赛本地 ID')
    return this.enqueue({
      taskId: `${localId}:create`,
      raceLocalId: localId,
      kind: 'create',
      clientKey: requiredKey(clientRaceKey, '比赛幂等键'),
      dependsOn: [],
    })
  }

  enqueueScore(raceLocalId: string, clientScoreKey: string): RaceOutboxTask {
    const localId = requiredKey(raceLocalId, '比赛本地 ID')
    const scoreKey = requiredKey(clientScoreKey, '成绩幂等键')
    return this.enqueue({
      taskId: `${localId}:score:${scoreKey}`,
      raceLocalId: localId,
      kind: 'score',
      clientKey: scoreKey,
      dependsOn: [`${localId}:create`],
    })
  }

  enqueueFinish(raceLocalId: string, clientRaceKey: string): RaceOutboxTask {
    const localId = requiredKey(raceLocalId, '比赛本地 ID')
    return this.enqueue({
      taskId: `${localId}:finish`,
      raceLocalId: localId,
      kind: 'finish',
      clientKey: requiredKey(clientRaceKey, '比赛幂等键'),
      dependsOn: [`${localId}:create`, ...this.tasks
        .filter((task) => task.raceLocalId === localId && task.kind === 'score')
        .map((task) => task.taskId)],
    })
  }

  markSucceeded(taskId: string): boolean {
    this.assertUsable()
    const next = this.tasks.filter((task) => task.taskId !== taskId)
    if (next.length === this.tasks.length) return false
    this.persist(next)
    return true
  }

  markFailure(taskId: string, errorCode: string | number, nextAttemptAt = this.now()): boolean {
    this.assertUsable()
    if (!Number.isFinite(nextAttemptAt) || nextAttemptAt < 0) throw new Error('下次重试时间无效')
    const index = this.tasks.findIndex((task) => task.taskId === taskId)
    if (index === -1) return false
    const code = String(errorCode)
    const held = code === '400' || code === '409'
    const next = this.listTasks()
    const current = next[index]!
    next[index] = {
      ...current,
      attempt: current.attempt + 1,
      nextAttemptAt: held ? current.nextAttemptAt : nextAttemptAt,
      state: held ? 'held' : 'pending',
      lastErrorCode: code,
    }
    this.persist(next)
    return true
  }

  private enqueue(input: Pick<RaceOutboxTask, 'taskId' | 'raceLocalId' | 'kind' | 'clientKey' | 'dependsOn'>): RaceOutboxTask {
    this.assertUsable()
    const existing = this.tasks.find((task) => task.taskId === input.taskId)
    if (existing) {
      const dependencies = uniqueStrings([...existing.dependsOn, ...input.dependsOn])
      if (sameStrings(existing.dependsOn, dependencies)) return cloneTask(existing)
      const next = this.listTasks()
      const index = next.findIndex((task) => task.taskId === input.taskId)
      next[index] = { ...next[index]!, dependsOn: dependencies }
      this.persist(next)
      return cloneTask(next[index]!)
    }
    const task: RaceOutboxTask = {
      ...input,
      dependsOn: uniqueStrings(input.dependsOn),
      attempt: 0,
      nextAttemptAt: this.now(),
      state: 'pending',
      lastErrorCode: null,
    }
    if (!isTask(task)) throw new Error('同步任务格式无效')
    this.persist([...this.tasks, task])
    return cloneTask(task)
  }

  private assertUsable(): void {
    if (this.invalidStorage !== null) throw new Error('同步任务存储格式无效')
  }

  private persist(next: RaceOutboxTask[]): void {
    const stored: StoredRaceOutboxV1 = { schemaVersion: 1, tasks: next.map(cloneTask) }
    this.storage.write(stored)
    this.tasks = stored.tasks.map(cloneTask)
  }
}

function parseTasks(raw: unknown): RaceOutboxTask[] | null {
  if (raw === null || raw === undefined || raw === '') return []
  if (!raw || typeof raw !== 'object') return null
  const candidate = raw as Partial<StoredRaceOutboxV1>
  if (candidate.schemaVersion !== 1 || !Array.isArray(candidate.tasks) || !candidate.tasks.every(isTask)) return null
  const tasks = candidate.tasks.map(cloneTask)
  return uniqueStrings(tasks.map((task) => task.taskId)).length === tasks.length ? tasks : null
}

function isTask(value: unknown): value is RaceOutboxTask {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<RaceOutboxTask>
  return typeof candidate.taskId === 'string' && candidate.taskId.length > 0
    && typeof candidate.raceLocalId === 'string' && candidate.raceLocalId.length > 0
    && (candidate.kind === 'create' || candidate.kind === 'score' || candidate.kind === 'finish')
    && typeof candidate.clientKey === 'string' && candidate.clientKey.length > 0
    && Array.isArray(candidate.dependsOn) && candidate.dependsOn.every((dependency) => typeof dependency === 'string' && dependency.length > 0)
    && typeof candidate.attempt === 'number' && Number.isInteger(candidate.attempt) && candidate.attempt >= 0
    && typeof candidate.nextAttemptAt === 'number' && Number.isFinite(candidate.nextAttemptAt) && candidate.nextAttemptAt >= 0
    && (candidate.state === 'pending' || candidate.state === 'held')
    && (candidate.lastErrorCode === null || typeof candidate.lastErrorCode === 'string')
}

function cloneTask(task: RaceOutboxTask): RaceOutboxTask {
  return { ...task, dependsOn: [...task.dependsOn] }
}

function requiredKey(value: string, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label}不能为空`)
  return value
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)]
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}
