export interface Athlete {
  id: number
  name: string
  epc: string
  lapCount: number
  lapCentiseconds: number
  totalCentiseconds: number
  previousRank: number
  currentRank: number
  hasRaceScore: boolean
  finished: boolean
}
