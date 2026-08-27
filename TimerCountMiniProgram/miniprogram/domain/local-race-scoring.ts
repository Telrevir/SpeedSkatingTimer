export type LocalRacePhase = 'idle' | 'running' | 'finishing' | 'finished'

export interface LocalAthleteScore {
  athleteId: number
  lapCount: number
  lapCentiseconds: number | null
  totalCentiseconds: number
  currentRank: number
  previousRank: number
  finished: boolean
}

export class LocalRaceScoring {
  private participantIds = new Set<number>()
  private scores = new Map<number, LocalAthleteScore>()
  private currentPhase: LocalRacePhase = 'idle'
  private currentFinishLap: number | null = null
  private currentLeaderAthleteId: number | null = null

  get phase(): LocalRacePhase { return this.currentPhase }
  get finishLap(): number | null { return this.currentFinishLap }
  get leaderAthleteId(): number | null { return this.currentLeaderAthleteId }

  get snapshot(): LocalAthleteScore[] {
    return [...this.scores.values()]
      .sort((left, right) => left.athleteId - right.athleteId)
      .map(cloneScore)
  }

  start(participantIds: number[]): void {
    const normalized = [...new Set(participantIds.filter((id) => Number.isInteger(id) && id > 0))]
    if (normalized.length === 0) throw new Error('当前参赛名单为空')
    this.participantIds = new Set(normalized)
    this.scores = new Map()
    this.currentFinishLap = null
    this.currentLeaderAthleteId = null
    this.currentPhase = 'running'
  }

  resume(participantIds: number[]): void {
    if (this.currentPhase === 'idle') this.start(participantIds)
  }

  applyFirmwareScore(
    athleteId: number,
    lapCount: number,
    totalCentiseconds: number,
  ): LocalAthleteScore | null {
    if (this.currentPhase !== 'running' && this.currentPhase !== 'finishing') return null
    if (!this.participantIds.has(athleteId)) return null
    if (!Number.isInteger(lapCount) || lapCount < 0 || lapCount > 0xff) return null
    if (!Number.isInteger(totalCentiseconds)
        || totalCentiseconds < 0
        || totalCentiseconds > 0xffffff) return null

    const previous = this.scores.get(athleteId)
    if (previous?.finished) return null
    if (previous
        && (lapCount <= previous.lapCount || totalCentiseconds <= previous.totalCentiseconds)) {
      return null
    }

    const score: LocalAthleteScore = {
      athleteId,
      lapCount,
      lapCentiseconds: previous && lapCount === previous.lapCount + 1
        ? totalCentiseconds - previous.totalCentiseconds
        : null,
      totalCentiseconds,
      currentRank: previous?.currentRank ?? 0,
      previousRank: previous?.previousRank ?? 0,
      finished: false,
    }

    if (this.currentPhase === 'finishing'
        && this.currentFinishLap !== null
        && score.lapCount >= this.currentFinishLap) {
      score.finished = true
    }
    this.scores.set(athleteId, score)
    this.recalculateRanks()
    this.finishWhenEveryoneIsFrozen()
    return cloneScore(this.scores.get(athleteId)!)
  }

  beginFinishing(): number {
    if (this.currentPhase !== 'running') throw new Error('当前比赛状态不能结束')
    if (this.currentLeaderAthleteId === null) {
      throw new Error('尚无有效运动员通过，无法结束')
    }
    const leader = this.scores.get(this.currentLeaderAthleteId)!
    this.currentFinishLap = leader.lapCount
    this.currentPhase = 'finishing'
    this.scores.forEach((score) => {
      if (score.lapCount >= this.currentFinishLap!) score.finished = true
    })
    this.finishWhenEveryoneIsFrozen()
    return this.currentFinishLap
  }

  getScore(athleteId: number): LocalAthleteScore | null {
    const score = this.scores.get(athleteId)
    return score ? cloneScore(score) : null
  }

  reset(): void {
    this.participantIds = new Set()
    this.scores = new Map()
    this.currentPhase = 'idle'
    this.currentFinishLap = null
    this.currentLeaderAthleteId = null
  }

  private recalculateRanks(): void {
    const previousRanks = new Map<number, number>()
    this.scores.forEach((score) => previousRanks.set(score.athleteId, score.currentRank))
    const ranked = [...this.scores.values()].sort(compareScores)
    ranked.forEach((score, index) => {
      score.previousRank = previousRanks.get(score.athleteId) ?? 0
      score.currentRank = index + 1
    })
    this.currentLeaderAthleteId = ranked[0]?.athleteId ?? null
  }

  private finishWhenEveryoneIsFrozen(): void {
    if (this.currentPhase !== 'finishing') return
    const complete = [...this.participantIds].every((id) => this.scores.get(id)?.finished === true)
    if (complete) this.currentPhase = 'finished'
  }
}

function compareScores(left: LocalAthleteScore, right: LocalAthleteScore): number {
  if (left.lapCount !== right.lapCount) return right.lapCount - left.lapCount
  if (left.totalCentiseconds !== right.totalCentiseconds) {
    return left.totalCentiseconds - right.totalCentiseconds
  }
  return left.athleteId - right.athleteId
}

function cloneScore(score: LocalAthleteScore): LocalAthleteScore {
  return { ...score }
}
