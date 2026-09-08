import type { ApiResult } from '../backend-api/request'
import type { RaceOutboxTask } from '../race-outbox-repository'

export interface WorkerPlanInput {
  now: number
  tasks: RaceOutboxTask[]
  activeTaskIds: string[]
}

export interface WorkerPlan {
  executeTaskIds: string[]
  nextWakeAt: number | null
}

export type WorkerTransition =
  | { type: 'succeeded'; taskId: string }
  | { type: 'failure'; taskId: string; errorCode: string | number; nextAttemptAt: number | null }

/**
 * 纯调度规则，由 Worker 和主线程降级路径共同使用。
 * 它不依赖 wx、存储、网络、页面或 BLE，也不直接变更任务箱。
 */
export class RaceSyncWorkerEngine {
  plan(input: WorkerPlanInput): WorkerPlan {
    const activeIds = new Set(input.tasks.map((task) => task.taskId))
    const activeRaces = new Set(
      input.tasks.filter((task) => input.activeTaskIds.includes(task.taskId)).map((task) => task.raceLocalId),
    )
    const eligible = input.tasks.filter((task) => task.state === 'pending'
      && task.dependsOn.every((dependency) => !activeIds.has(dependency))
      && !activeRaces.has(task.raceLocalId))
    const due: RaceOutboxTask[] = []
    for (const task of eligible) {
      if (task.nextAttemptAt > input.now || activeRaces.has(task.raceLocalId)) continue
      due.push(task)
      activeRaces.add(task.raceLocalId)
    }
    const future = eligible
      .filter((task) => task.nextAttemptAt > input.now)
      .map((task) => task.nextAttemptAt)
    return {
      executeTaskIds: due.map((task) => task.taskId),
      nextWakeAt: future.length === 0 ? null : Math.min(...future),
    }
  }

  result(task: RaceOutboxTask, result: ApiResult<unknown>, now: number): WorkerTransition {
    if (result.ok) return { type: 'succeeded', taskId: task.taskId }
    const errorCode = failureCode(result)
    if (errorCode === 400 || errorCode === 409) {
      return { type: 'failure', taskId: task.taskId, errorCode, nextAttemptAt: null }
    }
    const backoff = Math.min(60_000, 1_000 * 2 ** Math.min(task.attempt, 6))
    return { type: 'failure', taskId: task.taskId, errorCode, nextAttemptAt: now + backoff }
  }
}

function failureCode(result: Exclude<ApiResult<unknown>, { ok: true }>): string | number {
  if (result.kind === 'business' && (result.code === 400 || result.code === 409)) return result.code
  return result.httpStatus ?? result.code ?? 'network'
}
