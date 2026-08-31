export const LAP_CORRECTION_LIMITS = {
  minValidLapCentiseconds: 800,
  minHistorySize: 2,
  maxHistorySize: 5,
  maxHistoryVariationRatio: 0.15,
  maxImpliedLapErrorRatio: 0.15,
  minEstimatedLaps: 2,
  maxEstimatedLaps: 3,
  maxAddedLaps: 2,
} as const

export type LapCorrectionReason =
  | 'auto-corrected'
  | 'invalid-input'
  | 'raw-lap-delta-not-one'
  | 'insufficient-history'
  | 'unstable-history'
  | 'estimated-laps-out-of-range'
  | 'implied-lap-time-out-of-range'

export interface LapCorrectionInput {
  rawLapDelta: number
  observedCentiseconds: number
  validLapCentiseconds: number[]
}

export interface LapCorrectionDecision {
  addedLaps: number
  baselineCentiseconds: number | null
  impliedLapCentiseconds: number | null
  reason: LapCorrectionReason
}

/**
 * 只判断高置信度 RFID 漏检。估算结果由调用方保存为偏移，不能写回真实圈速历史。
 */
export function evaluateLapCorrection(input: LapCorrectionInput): LapCorrectionDecision {
  if (!isValidInput(input)) return noCorrection('invalid-input')
  if (input.rawLapDelta !== 1) return noCorrection('raw-lap-delta-not-one')

  const history = input.validLapCentiseconds.slice(-LAP_CORRECTION_LIMITS.maxHistorySize)
  if (history.length < LAP_CORRECTION_LIMITS.minHistorySize) {
    return noCorrection('insufficient-history')
  }

  const baselineCentiseconds = robustBaseline(history)
  const historyVariation = (Math.max(...history) - Math.min(...history)) / baselineCentiseconds
  if (historyVariation > LAP_CORRECTION_LIMITS.maxHistoryVariationRatio) {
    return noCorrection('unstable-history', baselineCentiseconds)
  }

  const estimatedLaps = Math.round(input.observedCentiseconds / baselineCentiseconds)
  if (estimatedLaps < LAP_CORRECTION_LIMITS.minEstimatedLaps
      || estimatedLaps > LAP_CORRECTION_LIMITS.maxEstimatedLaps) {
    return noCorrection('estimated-laps-out-of-range', baselineCentiseconds)
  }

  const addedLaps = estimatedLaps - input.rawLapDelta
  const impliedLapCentiseconds = input.observedCentiseconds / estimatedLaps
  const impliedError = Math.abs(impliedLapCentiseconds - baselineCentiseconds)
    / baselineCentiseconds
  if (addedLaps <= 0
      || addedLaps > LAP_CORRECTION_LIMITS.maxAddedLaps
      || impliedError > LAP_CORRECTION_LIMITS.maxImpliedLapErrorRatio) {
    return noCorrection(
      'implied-lap-time-out-of-range',
      baselineCentiseconds,
      impliedLapCentiseconds,
    )
  }

  return {
    addedLaps,
    baselineCentiseconds,
    impliedLapCentiseconds,
    reason: 'auto-corrected',
  }
}

function isValidInput(input: LapCorrectionInput): boolean {
  return Number.isInteger(input.rawLapDelta)
    && input.rawLapDelta >= 0
    && Number.isInteger(input.observedCentiseconds)
    && input.observedCentiseconds >= LAP_CORRECTION_LIMITS.minValidLapCentiseconds
    && Array.isArray(input.validLapCentiseconds)
    && input.validLapCentiseconds.every((lap) => (
      Number.isInteger(lap) && lap >= LAP_CORRECTION_LIMITS.minValidLapCentiseconds
    ))
}

function robustBaseline(history: number[]): number {
  if (history.length === 2) return (history[0]! + history[1]!) / 2
  const sorted = [...history].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2
}

function noCorrection(
  reason: Exclude<LapCorrectionReason, 'auto-corrected'>,
  baselineCentiseconds: number | null = null,
  impliedLapCentiseconds: number | null = null,
): LapCorrectionDecision {
  return { addedLaps: 0, baselineCentiseconds, impliedLapCentiseconds, reason }
}
