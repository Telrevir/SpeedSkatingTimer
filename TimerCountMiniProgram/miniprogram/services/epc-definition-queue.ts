import type { AthleteClassification } from '../protocol/athlete-sync-codec'
import type { ActiveRaceSessionRepository } from './active-race-session-repository'

export type DefineEpc = (definition: AthleteClassification) => Promise<void>

export class EpcDefinitionQueue {
  private tail: Promise<void> = Promise.resolve()
  private readonly pendingEpcs = new Set<string>()
  private generation = 0

  constructor(
    private readonly sessionRepository: ActiveRaceSessionRepository,
    private readonly defineEpc: DefineEpc,
  ) {}

  enqueue(definition: AthleteClassification): Promise<void> {
    const epcKey = definition.epc.toUpperCase()
    if (this.pendingEpcs.has(epcKey)) return Promise.resolve()

    this.pendingEpcs.add(epcKey)
    const enqueuedGeneration = this.generation
    const operation = this.tail.then(async () => {
      if (enqueuedGeneration !== this.generation) return
      const session = this.sessionRepository.load()
      if (!session) throw new Error('没有进行中的比赛')
      const count = definition.isAthlete
        ? session.athleteDefinitionCount
        : session.nonAthleteDefinitionCount
      if (count >= 50) throw new Error('每场最多定义 50 个该类 EPC')

      await this.defineEpc(definition)
      if (enqueuedGeneration === this.generation) {
        this.sessionRepository.incrementDefinition(definition.isAthlete)
      }
    }).finally(() => {
      this.pendingEpcs.delete(epcKey)
    })

    this.tail = operation.catch(() => undefined)
    return operation
  }

  clear(): void {
    this.generation += 1
    this.pendingEpcs.clear()
  }
}
