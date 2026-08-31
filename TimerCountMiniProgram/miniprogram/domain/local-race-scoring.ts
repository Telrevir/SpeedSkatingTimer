import {
  evaluateLapCorrection,
  LAP_CORRECTION_LIMITS,
} from './lap-correction-engine'

export type LocalRacePhase = 'idle' | 'running' | 'finishing' | 'finished'

export interface LocalLapCorrectionState {
  athleteId: number
  rawLapCount: number
  correctionOffset: number
  lastTotalCentiseconds: number
  lastLapCentiseconds: number
  validLapCentiseconds: number[]
}

export interface LocalAthleteScore {
  athleteId: number
  /** 兼容现有页面和排序逻辑，值等同于 correctedLapCount。 */
  lapCount: number
  rawLapCount: number
  correctionOffset: number
  correctedLapCount: number
  addedLaps: number
  lapCentiseconds: number
  totalCentiseconds: number
  currentRank: number
  previousRank: number
  finished: boolean
}

export class LocalRaceScoring {
  private participantIds = new Set<number>()
  private scores = new Map<number, LocalAthleteScore>()
  private correctionStates = new Map<number, LocalLapCorrectionState>()
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

  get correctionSnapshot(): LocalLapCorrectionState[] {
    return [...this.correctionStates.values()]
      .sort((left, right) => left.athleteId - right.athleteId)
      .map(cloneCorrectionState)
  }

  start(participantIds: number[]): void {
    const normalized = [...new Set(participantIds.filter((id) => Number.isInteger(id) && id > 0))]
    if (normalized.length === 0) throw new Error('当前参赛名单为空')
    this.participantIds = new Set(normalized)
    this.scores = new Map()
    this.correctionStates = new Map()
    this.currentFinishLap = null
    this.currentLeaderAthleteId = null
    this.currentPhase = 'running'
  }

  resume(
    participantIds: number[],
    states: LocalLapCorrectionState[] = [],
    phase: Exclude<LocalRacePhase, 'idle'> = 'running',
    finishLap: number | null = null,
  ): void {
    if (this.currentPhase !== 'idle') return
    this.start(participantIds)
    states.forEach((state) => {
      if (this.participantIds.has(state.athleteId) && isValidCorrectionState(state)) {
        this.correctionStates.set(state.athleteId, cloneCorrectionState(state))
      }
    })
    if (phase !== 'running' && Number.isInteger(finishLap) && finishLap !== null && finishLap >= 0) {
      this.currentPhase = phase
      this.currentFinishLap = finishLap
    }
  }

  applyFirmwareScore(
    athleteId: number,
    rawLapCount: number,
    lapCentiseconds: number,
    totalCentiseconds: number,
  ): LocalAthleteScore | null {
    if (!this.participantIds.has(athleteId)) return null
    if (!isProtocolUint(rawLapCount, 0xff)
        || !isProtocolUint(lapCentiseconds, 0xffffff)
        || !isProtocolUint(totalCentiseconds, 0xffffff)) return null

    const previousScore = this.scores.get(athleteId)
    const previousState = this.correctionStates.get(athleteId)
    if (previousState) {
      if (rawLapCount < previousState.rawLapCount
          || totalCentiseconds < previousState.lastTotalCentiseconds) return null
      if (rawLapCount === previousState.rawLapCount
          || totalCentiseconds === previousState.lastTotalCentiseconds) {
        if (rawLapCount !== previousState.rawLapCount
            || totalCentiseconds !== previousState.lastTotalCentiseconds
            || previousScore) return null
        return this.restoreScoreFromSynchronizedPacket(
          previousState,
          lapCentiseconds,
          totalCentiseconds,
        )
      }
    }

    if (this.currentPhase !== 'running' && this.currentPhase !== 'finishing') return null
    if (previousScore?.finished) return null

    const rawLapDelta = previousState ? rawLapCount - previousState.rawLapCount : 0
    const observedCentiseconds = previousState
      ? totalCentiseconds - previousState.lastTotalCentiseconds
      : 0
    const decision = previousState
      ? evaluateLapCorrection({
        rawLapDelta,
        observedCentiseconds,
        validLapCentiseconds: previousState.validLapCentiseconds,
      })
      : null
    const previousOffset = previousState?.correctionOffset ?? 0
    const acceptedAddedLaps = this.limitAddedLapsAtFinish(
      rawLapCount,
      previousOffset,
      decision?.addedLaps ?? 0,
    )
    const correctionOffset = previousOffset + acceptedAddedLaps
    const unboundedCorrectedLapCount = rawLapCount + correctionOffset
    const correctedLapCount = this.currentPhase === 'finishing' && this.currentFinishLap !== null
      ? Math.min(unboundedCorrectedLapCount, this.currentFinishLap)
      : unboundedCorrectedLapCount
    const validLapCentiseconds = [...(previousState?.validLapCentiseconds ?? [])]

    // 只把真实、完整且未触发补圈的单圈加入基准；估算圈永不回灌历史。
    if (previousState
        && rawLapDelta === 1
        && (decision?.addedLaps ?? 0) === 0
        && observedCentiseconds >= LAP_CORRECTION_LIMITS.minValidLapCentiseconds) {
      validLapCentiseconds.push(observedCentiseconds)
      if (validLapCentiseconds.length > LAP_CORRECTION_LIMITS.maxHistorySize) {
        validLapCentiseconds.splice(
          0,
          validLapCentiseconds.length - LAP_CORRECTION_LIMITS.maxHistorySize,
        )
      }
    }

    this.correctionStates.set(athleteId, {
      athleteId,
      rawLapCount,
      correctionOffset,
      lastTotalCentiseconds: totalCentiseconds,
      lastLapCentiseconds: lapCentiseconds,
      validLapCentiseconds,
    })
    this.scores.set(athleteId, {
      athleteId,
      lapCount: correctedLapCount,
      rawLapCount,
      correctionOffset,
      correctedLapCount,
      addedLaps: acceptedAddedLaps,
      lapCentiseconds,
      totalCentiseconds,
      currentRank: previousScore?.currentRank ?? 0,
      previousRank: previousScore?.previousRank ?? 0,
      finished: this.currentPhase === 'finishing'
        && this.currentFinishLap !== null
        && correctedLapCount >= this.currentFinishLap,
    })
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
    this.currentFinishLap = leader.correctedLapCount
    this.currentPhase = 'finishing'
    this.scores.forEach((score) => {
      if (score.correctedLapCount >= this.currentFinishLap!) {
        score.lapCount = this.currentFinishLap!
        score.correctedLapCount = this.currentFinishLap!
        score.finished = true
      }
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
    this.correctionStates = new Map()
    this.currentPhase = 'idle'
    this.currentFinishLap = null
    this.currentLeaderAthleteId = null
  }

  private restoreScoreFromSynchronizedPacket(
    state: LocalLapCorrectionState,
    lapCentiseconds: number,
    totalCentiseconds: number,
  ): LocalAthleteScore {
    const unboundedCorrectedLapCount = state.rawLapCount + state.correctionOffset
    const correctedLapCount = this.currentFinishLap === null
      ? unboundedCorrectedLapCount
      : Math.min(unboundedCorrectedLapCount, this.currentFinishLap)
    this.scores.set(state.athleteId, {
      athleteId: state.athleteId,
      lapCount: correctedLapCount,
      rawLapCount: state.rawLapCount,
      correctionOffset: state.correctionOffset,
      correctedLapCount,
      addedLaps: 0,
      lapCentiseconds,
      totalCentiseconds,
      currentRank: 0,
      previousRank: 0,
      finished: this.currentPhase === 'finished'
        || (this.currentPhase === 'finishing'
          && this.currentFinishLap !== null
          && correctedLapCount >= this.currentFinishLap),
    })
    this.recalculateRanks()
    return cloneScore(this.scores.get(state.athleteId)!)
  }

  private limitAddedLapsAtFinish(
    rawLapCount: number,
    currentOffset: number,
    requestedAddedLaps: number,
  ): number {
    if (this.currentPhase !== 'finishing' || this.currentFinishLap === null) {
      return requestedAddedLaps
    }
    return Math.max(
      0,
      Math.min(requestedAddedLaps, this.currentFinishLap - rawLapCount - currentOffset),
    )
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
  if (left.correctedLapCount !== right.correctedLapCount) {
    return right.correctedLapCount - left.correctedLapCount
  }
  if (left.totalCentiseconds !== right.totalCentiseconds) {
    return left.totalCentiseconds - right.totalCentiseconds
  }
  return left.athleteId - right.athleteId
}

function cloneScore(score: LocalAthleteScore): LocalAthleteScore {
  return { ...score }
}

function isProtocolUint(value: number, maximum: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= maximum
}

function isValidCorrectionState(state: LocalLapCorrectionState): boolean {
  return Number.isInteger(state.athleteId)
    && state.athleteId > 0
    && isProtocolUint(state.rawLapCount, 0xff)
    && Number.isInteger(state.correctionOffset)
    && state.correctionOffset >= 0
    && state.correctionOffset <= 0xffff
    && isProtocolUint(state.lastTotalCentiseconds, 0xffffff)
    && isProtocolUint(state.lastLapCentiseconds, 0xffffff)
    && Array.isArray(state.validLapCentiseconds)
    && state.validLapCentiseconds.length <= LAP_CORRECTION_LIMITS.maxHistorySize
    && state.validLapCentiseconds.every((lap) => (
      Number.isInteger(lap)
        && lap >= LAP_CORRECTION_LIMITS.minValidLapCentiseconds
        && lap <= 0xffffff
    ))
}

function cloneCorrectionState(state: LocalLapCorrectionState): LocalLapCorrectionState {
  return { ...state, validLapCentiseconds: [...state.validLapCentiseconds] }
}
