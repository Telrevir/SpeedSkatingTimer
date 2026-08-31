export interface Athlete {
  id: number
  name: string
  epc: string
  lapCount: number
  /** 旧本地数据兼容：AthleteStore 输出时始终提供以下三个字段。 */
  rawLapCount?: number
  correctionOffset?: number
  correctedLapCount?: number
  lapCentiseconds: number
  totalCentiseconds: number
  previousRank: number
  currentRank: number
  hasRaceScore: boolean
  finished: boolean
}
